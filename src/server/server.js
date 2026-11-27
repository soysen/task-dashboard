const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec, execFile, execFileSync, execSync, spawn } = require('child_process');

const os = require('os');
const {
  consumeTaskFeedback,
  healTasksFeedback,
  normalizeLogText,
  formatStructuredExecutionLog,
  extractCoverageSummary,
  validateExecutionLog,
  calculateRiskDoor,
  autoAssembleExecutionReport,
  determineTaskTier,
  normalizeDisclosureList,
  normalizePendingQuestions,
  formatClarificationDecisionBlock
} = require('./feedbackManager');
const {
  PROVIDER_MATRIX,
  resolveProvider,
  formatTierStrategy
} = require('./agentProviderAdapter');
const {
  detectProjectGitNexus,
  formatGitNexusGuidance
} = require('./gitnexusDetector');
const {
  resolveTaskSkillRoute,
  parseAgentStatusContent,
  parseBuildPlanContent,
  scanProjectWorklogAndPlan,
  syncProjectWorklogForActiveTask,
  syncProjectWorklogForRedo,
  syncProjectWorklogOnReview,
  syncProjectWorklogOnDone,
  markTaskSlicesComplete,
  setReadTasksProvider
} = require("./worklogParser");
const {
  collectGitDiff,
  discardGitChanges,
  findProjectCommitSkill,
  formatCommitMessageFromSkill,
  formatCommitMessage,
  buildCommitAgentPrompt,
  parseAgentCommitOutput,
  getGitBranchInfo,
  getProjectBranches,
  createProjectBranch,
  clearProjectBranchCache,
  withRepoMergeLock,
  createTaskWorktree,
  removeTaskWorktree,
  mergeTaskWorktree,
  checkTaskBaseDrift,
  mergeFeatureBranch,
  getRealDirtyFiles,
  isWorktreeUntouched,
  openRepoInExternalEditor
} = require('./services/gitService');
const {
  getBranchRemoteStatus,
  pushBranch,
  cloneRepository,
  fetchAndPullBranch,
  syncBranchWithBase,
  createPullRequest
} = require('./services/gitRemoteService');
const {
  listGitAccounts,
  startGithubDeviceLogin,
  switchGithubAccount,
  verifyAndSaveAzureDevOpsPat
} = require('./services/gitAccountService');

function isTaskAwaitingClarification(task) {
  return Boolean(task && (task.awaitingInput === true || (Array.isArray(task.pendingQuestions) && task.pendingQuestions.length > 0)));
}

/**
 * 統一於任務開工時準備隔離工作區（Worktree）或檢查共享工作區排隊互斥狀態
 * @param {string} projPath 專案根目錄
 * @param {Object} task 目標任務物件（就地更新欄位）
 * @param {Array<Object>} allTasks 所有任務列表
 * @returns {{ queued: boolean, blockedByTaskId: string|null, worktreeCreated: boolean }}
 */
function prepareTaskWorkspaceOnStart(projPath, task, allTasks = []) {
  if (!task || typeof task !== 'object') {
    return { queued: false, blockedByTaskId: null, worktreeCreated: false };
  }
  const mode = (task.workspaceMode === 'worktree' || task.workspaceMode === 'branch_stream' || task.workspaceMode === 'in_place')
    ? task.workspaceMode
    : 'worktree';
  task.workspaceMode = mode;

  const cleanRepo = projPath ? String(projPath).replace(/\/+$/, '') : '';
  const isGitRepo = Boolean(cleanRepo && fs.existsSync(cleanRepo) && fs.existsSync(path.join(cleanRepo, '.git')));

  // 若尚待使用者審閱確認（requiresConfirmation === true 或 awaitingInput === true），暫不建立 Worktree 或佔用排隊鎖，待確認執行時再隔離
  if (task.requiresConfirmation === true || isTaskAwaitingClarification(task)) {
    task.queueState = null;
    if (isGitRepo && (!task.baseBranch || !task.baseCommit)) {
      const info = getGitBranchInfo(cleanRepo);
      if (info.branch) {
        if (!task.baseBranch) task.baseBranch = info.branch;
        if (!task.targetBranch) task.targetBranch = task.baseBranch;
        if (!task.baseCommit) task.baseCommit = info.commit || '';
      }
    }
    return { queued: false, blockedByTaskId: null, worktreeCreated: false };
  }

  if (mode === 'worktree') {
    task.queueState = null;
    if (!isGitRepo) {
      return { queued: false, blockedByTaskId: null, worktreeCreated: false };
    }
    if (task.worktreePath && fs.existsSync(task.worktreePath)) {
      if (!task.branchName) task.branchName = `td/${task.id}`;
      if (!task.baseBranch || !task.targetBranch || !task.baseCommit) {
        const info = getGitBranchInfo(cleanRepo);
        if (!task.targetBranch) task.targetBranch = task.baseBranch || info.branch || 'main';
        if (!task.baseBranch) task.baseBranch = task.targetBranch;
        if (!task.baseCommit) {
          try {
            task.baseCommit = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', task.baseBranch], {
              encoding: 'utf8',
              timeout: 5000
            }).trim();
          } catch (e) {
            task.baseCommit = info.commit || '';
          }
        }
      }
      return { queued: false, blockedByTaskId: null, worktreeCreated: false };
    }
    try {
      const requestedBase = String(task.targetBranch || task.baseBranch || '').trim() || undefined;
      const wt = createTaskWorktree(cleanRepo, task.id, { baseBranch: requestedBase });
      task.worktreePath = wt.worktreePath;
      task.branchName = wt.branchName;
      task.targetBranch = task.targetBranch || wt.baseBranch;
      task.baseBranch = wt.baseBranch;
      task.baseCommit = wt.baseCommit;
      task.queueState = null;
      return { queued: false, blockedByTaskId: null, worktreeCreated: true };
    } catch (err) {
      console.warn(`⚠️ [prepareTaskWorkspaceOnStart] 建立 Worktree 失敗 (${task.id}): ${err.message}`);
      return { queued: false, blockedByTaskId: null, worktreeCreated: false };
    }
  }

  // branch_stream 或 in_place 模式：檢查同專案活躍佔用者
  const branchInfo = isGitRepo ? getGitBranchInfo(cleanRepo) : { branch: '', commit: '' };
  const resolvedTargetBranch = String(task.targetBranch || task.baseBranch || branchInfo.branch || '').trim();
  const tasksList = Array.isArray(allTasks) ? allTasks : [];
  const blocker = tasksList.find(other => {
    if (!other || other.id === task.id || other.status !== 'in_progress') return false;
    if ((other.project || '') !== (task.project || '')) return false;
    const isOtherPendingConfirm = Boolean(other.requiresConfirmation && other.executionPlan && String(other.executionPlan).trim().length > 0);
    const isOtherCircuitBroken = other.status === 'needs_human' || other.needsHuman === true || (Number(other.fixRoundCount || 0) >= 2 && other.resetCircuitBreaker !== true);
    const isOtherQueued = Boolean(other.queueState && other.queueState.blockedByTaskId);
    if (isOtherPendingConfirm || isOtherCircuitBroken || isOtherQueued) return false;

    const otherMode = (other.workspaceMode === 'worktree' || other.workspaceMode === 'branch_stream' || other.workspaceMode === 'in_place')
      ? other.workspaceMode
      : 'worktree';
    if (mode === 'in_place') {
      return otherMode === 'in_place';
    }
    if (otherMode !== 'branch_stream') return false;
    const otherTarget = String(other.targetBranch || other.baseBranch || branchInfo.branch || '').trim();
    return Boolean(resolvedTargetBranch && otherTarget === resolvedTargetBranch);
  });

  if (blocker) {
    task.queueState = {
      blockedByTaskId: blocker.id,
      reason: `等待 ${blocker.id} 完成中`,
      queuedAt: new Date().toISOString()
    };
    return { queued: true, blockedByTaskId: blocker.id, worktreeCreated: false };
  }

  task.queueState = null;
  if (isGitRepo) {
    if (!task.baseBranch && (resolvedTargetBranch || branchInfo.branch)) {
      task.baseBranch = resolvedTargetBranch || branchInfo.branch;
    }
    if (!task.targetBranch && task.baseBranch) {
      task.targetBranch = task.baseBranch;
    }
    if (!task.baseCommit) {
      const refToVerify = task.baseBranch || branchInfo.branch;
      if (refToVerify) {
        try {
          task.baseCommit = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', refToVerify], {
            encoding: 'utf8',
            timeout: 5000
          }).trim();
        } catch (e) {
          task.baseCommit = branchInfo.commit || '';
        }
      } else {
        task.baseCommit = branchInfo.commit || '';
      }
    }
  }
  return { queued: false, blockedByTaskId: null, worktreeCreated: false };
}
const {
  recordCliRun,
  getCliRunsToday,
  killProcessTree,
  cleanupAllCliProcesses,
  buildCliCommand
} = require('./services/cliRunner');
const {
  scanProjectGithubInfo,
  initProjectHarness,
  scanLocalProjects
} = require('./services/harnessService');
const {
  readSettings,
  writeSettings,
  migrateConfigDirectory,
  resolveDataDir,
  getTasksFilePath,
  getTaskEventsFilePath,
  appendTaskEvent,
  safeAtomicWriteJson,
  readArchivedTasks,
  writeArchivedTasks,
  readProjects,
  writeProjects,
  readTasks,
  writeTasks,
  syncToMarkdown,
  normalizeTaskScope,
  getNextTaskId
} = require('./services/taskStorage');

function resolveTaskGitWorkDir(task, projPath, options = {}) {
  if (task && task.worktreePath && fs.existsSync(task.worktreePath)) {
    if (
      options &&
      options.preferMainIfWorktreeUntouched === true &&
      isWorktreeUntouched(projPath, task.worktreePath, task) &&
      getRealDirtyFiles(projPath).length > 0
    ) {
      return projPath;
    }
    return task.worktreePath;
  }
  return projPath;
}

const PORT = process.env.PORT || 3030;
const USER_HOME = process.env.HOME || os.homedir();
const APP_SUPPORT_DATA_DIR = process.env.TASK_DASHBOARD_DATA_DIR || path.join(USER_HOME, 'Library/Application Support/TaskDashboard');

// 單一真實來源 (Single Source of Truth)
const ROOT_DIR = path.resolve(__dirname, '../..');
const PROJECT_DATA_DIR = path.join(ROOT_DIR, 'data');
const BASE_DATA_DIR = APP_SUPPORT_DATA_DIR;
const DATA_FILE = path.join(BASE_DATA_DIR, 'tasks.json');
const PROJECTS_FILE = path.join(BASE_DATA_DIR, 'projects.json');
const SETTINGS_FILE = path.join(BASE_DATA_DIR, 'settings.json');
const MARKDOWN_DASHBOARD = path.join(USER_HOME, '.gemini/antigravity/scratch/dashboard.md');
const PUBLIC_DIR = path.join(ROOT_DIR, 'src/public');
const PROJECTS_ROOT = path.join(USER_HOME, 'projects');

// 自動初始化 Application Support 目錄
if (!fs.existsSync(BASE_DATA_DIR)) {
  fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
}

['tasks.json', 'projects.json', 'settings.json'].forEach(file => {
  const dest = path.join(BASE_DATA_DIR, file);
  const src = path.join(PROJECT_DATA_DIR, file);
  if (!fs.existsSync(dest) && fs.existsSync(src)) {
    try {
      fs.copyFileSync(src, dest);
    } catch (e) {}
  }
});

// 自動釋出並同步 watch-task-gate.js 哨兵腳本至 Application Support
const GATE_SCRIPT_NAME = 'watch-task-gate.js';
const destGateScript = path.join(BASE_DATA_DIR, GATE_SCRIPT_NAME);
const candidateGateSources = [
  path.join(ROOT_DIR, 'scripts', GATE_SCRIPT_NAME),
  path.join(__dirname, '../../scripts', GATE_SCRIPT_NAME),
  path.join(__dirname, '../scripts', GATE_SCRIPT_NAME),
  path.join(ROOT_DIR, GATE_SCRIPT_NAME)
];
const srcGateScript = candidateGateSources.find(p => fs.existsSync(p));
if (srcGateScript) {
  try {
    fs.copyFileSync(srcGateScript, destGateScript);
    fs.chmodSync(destGateScript, 0o755);
  } catch (err) {
    if (err.code !== 'EPERM') {
      console.error('[Gate Script] 同步至 Application Support 失敗:', err);
    }
  }
}

let lastInspectionTime = null;
let lastInspectionResult = { inspectedAt: null, updatedCount: 0, inProgressCount: 0, status: 'idle' };

let gitProjectsStatusCache = { timestamp: 0, data: null };

// 建立包含 nvm node 路徑的 custom env (避免硬編碼版本號導致路徑不存在)
function buildCustomEnv() {
  let nvmBinPath = '';
  try {
    const nvmVersionsDir = path.join(USER_HOME, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmVersionsDir)) {
      const versions = fs.readdirSync(nvmVersionsDir).filter(v => v.startsWith('v'));
      if (versions.length > 0) {
        nvmBinPath = path.join(nvmVersionsDir, versions[0], 'bin');
      }
    }
  } catch (e) { /* ignore */ }

  return {
    ...process.env,
    PATH: [USER_HOME + '/.local/bin',
      nvmBinPath,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'
    ].filter(p => p).join(':')
  };
}

function cleanAnsi(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[-/]*[@-~])/g, '').replace(/[\r\x00-\x09\x0B-\x1F\x7F]/g, ' ').trim();
}


const activeCliProcesses = new Map();

// SSE (Server-Sent Events) 客戶端連線池與廣播
const sseClients = new Set();

function broadcastSse(event, data) {
  if (sseClients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

const sseKeepAliveTimer = setInterval(() => {
  if (sseClients.size === 0) return;
  for (const client of sseClients) {
    try {
      client.write(': keepalive\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 25000);
sseKeepAliveTimer.unref();

// 週期性對所有活躍中 CLI 任務執行輕量 Git 變更探針
function probeLiveActiveTasks() {
  if (activeCliProcesses.size === 0) return;
  const customEnv = buildCustomEnv();
  for (const [taskId, procInfo] of activeCliProcesses.entries()) {
    if (!procInfo.projPath) continue;
    const statusCmd = 'git -C "' + procInfo.projPath + '" status --porcelain -uall';
    exec(statusCmd, { env: customEnv, timeout: 3000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (!err && stdout && activeCliProcesses.has(taskId)) {
        const lines = stdout.split('\n').filter(l => l.length >= 4);
        const modifiedList = lines.map(l => l.slice(3).trim()).filter(Boolean);
        activeCliProcesses.get(taskId).liveModifiedFiles = modifiedList;
      }
    });
  }
}

setInterval(probeLiveActiveTasks, 2500).unref();

function getLogsDir() {
  const dir = path.join(resolveDataDir(), 'logs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// 輔助函式：更新任務的 conversationId
function updateTaskConversationId(taskId, conversationId) {
  if (!conversationId || typeof conversationId !== 'string') return;
  const sid = conversationId.trim();
  if (!sid) return;

  const tasks = readTasks();
  const target = tasks.find(t => t.id === taskId);
  if (target && target.conversationId !== sid) {
    target.conversationId = sid;
    target.updatedAt = new Date().toISOString();
    writeTasks(tasks);
    syncToMarkdown(tasks);
    console.log(` [CLI Agent 引擎] 任務 ${taskId} 已綁定 Session ID: ${sid}`);
  }
}

// 通用 Session 辨識與標籤回寫器 (支援 Hermes, Claude Code, OpenAI Codex 與自訂 CLI)
function captureAndTagCliSession(bin, taskId, taskTitle, projPath, startTime, liveOutputBuffer) {
  const binName = path.basename(bin || '').toLowerCase();

  // 1. Hermes 專屬適配器：讀寫 SQLite state.db
  if (binName.includes('hermes')) {
    const dbPath = path.join(USER_HOME, '.hermes', 'state.db');
    if (fs.existsSync(dbPath)) {
      const startUnix = Math.floor((startTime || Date.now()) / 1000) - 30;
      const targetCwd = projPath || '';
      const cleanTitle = (taskTitle || '').split(/[\n\r]/)[0].trim().slice(0, 60);

      const pyScript = `
import sqlite3, re, os, json

db = os.path.expanduser("~/.hermes/state.db")
if not os.path.exists(db):
    exit(0)

conn = sqlite3.connect(db)
cur = conn.cursor()

results = {}

# 1. 優先針對目標任務進行精準命名與提取
target_id = ${JSON.stringify(taskId)}
target_title = ${JSON.stringify(cleanTitle)}
target_cwd = ${JSON.stringify(targetCwd)}
start_unix = ${startUnix}

cur.execute("""
    SELECT s.id 
    FROM sessions s 
    JOIN messages m ON s.id = m.session_id 
    WHERE m.role = 'user' AND m.content LIKE ?
    ORDER BY s.started_at DESC LIMIT 1
""", (f"%任務 ID: {target_id}%",))
row = cur.fetchone()

if not row:
    cur.execute("""
        SELECT id FROM sessions 
        WHERE (cwd = ? OR ? = '')
          AND started_at >= ?
        ORDER BY started_at DESC LIMIT 1
    """, (target_cwd, target_cwd, start_unix))
    row = cur.fetchone()

if row:
    sid = row[0]
    base = f"[{target_id}] {target_title}"
    title = base
    suffix = 1
    while True:
        cur.execute("SELECT id FROM sessions WHERE title = ? AND id != ?", (title, sid))
        if not cur.fetchone():
            break
        suffix += 1
        time_part = sid.split("_")[1][:4] if "_" in sid else str(suffix)
        title = f"{base} (#{suffix}·{time_part})"
    cur.execute("UPDATE sessions SET title = ? WHERE id = ?", (title, sid))
    results[target_id] = sid

# 2. 全域掃描：自動為任何未命名但帶有任務指示的 Session 進行標題補齊
cur.execute("""
    SELECT s.id, m.content 
    FROM sessions s 
    JOIN messages m ON s.id = m.session_id 
    WHERE (s.title IS NULL OR s.title = '' OR s.title = '—') AND m.role = 'user' AND m.content LIKE '%任務 ID:%'
    GROUP BY s.id
""")
unnamed_rows = cur.fetchall()
for sid, content in unnamed_rows:
    id_m = re.search(r"任務\s*ID:\s*([A-Za-z0-9_-]+)", content)
    title_m = re.search(r"任務名稱:\s*([^\n\r]+)", content)
    if id_m and title_m:
        tid = id_m.group(1).strip()
        ttitle = title_m.group(1).strip().split("\\n")[0].split("\\r")[0].strip()[:50]
        base = f"[{tid}] {ttitle}"
        title = base
        suffix = 1
        while True:
            cur.execute("SELECT id FROM sessions WHERE title = ? AND id != ?", (title, sid))
            if not cur.fetchone():
                break
            suffix += 1
            time_part = sid.split("_")[1][:4] if "_" in sid else str(suffix)
            title = f"{base} (#{suffix}·{time_part})"
        cur.execute("UPDATE sessions SET title = ? WHERE id = ?", (title, sid))
        if tid not in results:
            results[tid] = sid

conn.commit()
conn.close()
print(json.dumps(results))
`;
      exec(`python3 -c ${JSON.stringify(pyScript)}`, { timeout: 4000 }, (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          try {
            const mapped = JSON.parse(stdout.trim());
            for (const [tId, sId] of Object.entries(mapped)) {
              updateTaskConversationId(tId, sId);
            }
          } catch (e) {}
        }
      });
      return;
    }
  }

  // 2. Claude Code 專屬適配器：掃描 ~/.claude/ 或正則提取
  if (binName.includes('claude')) {
    const claudeMatch = (liveOutputBuffer || '').match(/(?:Session ID|session_id|session)\s*[:=]\s*([a-zA-Z0-9_-]{6,64})/i);
    if (claudeMatch) {
      updateTaskConversationId(taskId, claudeMatch[1]);
      return;
    }
    try {
      const claudeProjectsDir = path.join(USER_HOME, '.claude', 'projects');
      if (fs.existsSync(claudeProjectsDir)) {
        const slug = path.basename(projPath);
        const targetProjDir = path.join(claudeProjectsDir, slug);
        if (fs.existsSync(targetProjDir)) {
          const files = fs.readdirSync(targetProjDir)
            .filter(f => f.endsWith('.json') || f.endsWith('.jsonl'))
            .map(f => ({ name: f, time: fs.statSync(path.join(targetProjDir, f)).mtimeMs }))
            .sort((a, b) => b.time - a.time);
          if (files.length > 0 && files[0].time >= (startTime - 15000)) {
            const sid = files[0].name.replace(/\.(json|jsonl)$/, '');
            updateTaskConversationId(taskId, sid);
            return;
          }
        }
      }
    } catch (e) {}
  }

  // 3. 通用 / Codex 適配器：輸出日誌多模式正則提取
  if (liveOutputBuffer) {
    const patterns = [
      /\b(thread_[a-zA-Z0-9]+)\b/,
      /\b(run_[a-zA-Z0-9]+)\b/,
      /(?:session[_-]?id|conversation[_-]?id)\s*[:=]\s*([a-zA-Z0-9_-]{6,64})/i,
      /Session\s*ID\s*:\s*([a-zA-Z0-9_-]+)/i,
      /\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/
    ];

    for (const pat of patterns) {
      const match = liveOutputBuffer.match(pat);
      if (match) {
        const sid = match[1] || match[0];
        updateTaskConversationId(taskId, sid);
        break;
      }
    }
  }
}

// 觸發 CLI Agent 執行任務 (支援 task 執行模式與 commit 生成模式)
function executeTaskWithCliAgent(taskId, options = {}, callback = null) {
  const mode = options.mode || 'task'; // 'task' (預設實作) 或 'commit' (Diff 產生 commit)
  const settings = readSettings();

  const tasks = readTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    if (typeof callback === 'function') callback(new Error('Task not found'));
    return;
  }

  const projects = readProjects();
  const proj = projects.find(p => p.id === task.project);
  const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, task.project || '');

  // ----------------------------------------------------
  // 模式 B: Commit 訊息 Agent 產出模式 (根據實際 Diff)
  // ----------------------------------------------------
  if (mode === 'commit') {
    const customEnv = buildCustomEnv();
    collectGitDiff(projPath, customEnv, (modifiedFiles, diffContent) => {
      const mergedModified = (modifiedFiles && modifiedFiles.length > 0) ? modifiedFiles : (task.modifiedFiles || []);
      const commitSkill = findProjectCommitSkill(projPath);
      const fallbackResult = formatCommitMessageFromSkill(projPath, task, diffContent, mergedModified);

      const agentPrompt = buildCommitAgentPrompt(projPath, task, diffContent, mergedModified, commitSkill);
      const rawCliCmd = (settings.cliCommand || 'hermes').trim();
      const cliCommand = `${rawCliCmd} "${fallbackResult.message}"`;

      // 若使用者未啟用 CLI Agent 或執行指令不可用，直接使用強化版 Diff 推導回傳
      if (!settings.enableCliAgent) {
        const commitData = {
          success: true,
          taskId: task.id,
          hasSkill: !!commitSkill,
          skill: commitSkill,
          skillName: commitSkill ? commitSkill.label : null,
          skillPath: commitSkill ? commitSkill.path : null,
          type: fallbackResult.type,
          scope: fallbackResult.scope,
          subject: fallbackResult.message,
          body: fallbackResult.body,
          agentPrompt,
          cliCommand,
          generatedBy: 'diff-engine'
        };
        // 同步回存 task.commitMessage
        const curTasks = readTasks();
        const curT = curTasks.find(t => t.id === taskId);
        if (curT) {
          curT.commitMessage = { subject: fallbackResult.message, body: fallbackResult.body || '' };
          writeTasks(curTasks);
        }
        if (typeof callback === 'function') callback(null, commitData);
        return;
      }

      // 啟用 CLI Agent: 啟動獨立 CLI 行程執行 Prompt
      let bin = rawCliCmd.split(/\s+/)[0];
      let args = [];

      if (bin === 'hermes' || bin.endsWith('/hermes')) {
        const candidates = [
          USER_HOME + '/.local/bin/hermes',
          '/opt/homebrew/bin/hermes',
          '/usr/local/bin/hermes',
          'hermes'
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) { bin = c; break; }
        }
        args = ['--yolo', '-z', agentPrompt];
      } else if (bin === 'claude' || bin.endsWith('/claude')) {
        args = ['-p', agentPrompt];
      } else if (bin === 'agy' || bin.endsWith('/agy')) {
        args = [agentPrompt];
      } else {
        bin = 'bash';
        args = ['-c', buildCliCommand(rawCliCmd, agentPrompt)];
      }

      let cliOutput = '';
      let isDone = false;

      const finishCommit = (parsed) => {
        if (isDone) return;
        isDone = true;
        const resultSubject = parsed.subject || fallbackResult.message;
        const resultBody = parsed.body || fallbackResult.body;
        const resultType = parsed.type || fallbackResult.type;
        const resultScope = parsed.scope || fallbackResult.scope;

        const commitData = {
          success: true,
          taskId: task.id,
          hasSkill: !!commitSkill,
          skill: commitSkill,
          skillName: commitSkill ? commitSkill.label : null,
          skillPath: commitSkill ? commitSkill.path : null,
          type: resultType,
          scope: resultScope,
          subject: resultSubject,
          body: resultBody,
          agentPrompt,
          cliCommand: `${rawCliCmd} "${resultSubject}"`,
          generatedBy: 'cli-agent'
        };

        // 回存 task.commitMessage
        const curTasks = readTasks();
        const curT = curTasks.find(t => t.id === taskId);
        if (curT) {
          curT.commitMessage = { subject: resultSubject, body: resultBody || '' };
          writeTasks(curTasks);
        }

        if (typeof callback === 'function') callback(null, commitData);
      };

      try {
        const cliChild = spawn(bin, args, {
          cwd: projPath,
          env: customEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32'
        });

        const commitTimeout = setTimeout(() => {
          killProcessTree(cliChild, 'SIGTERM');
          finishCommit(fallbackResult);
        }, 25000);

        cliChild.stdout.on('data', (chunk) => { cliOutput += chunk.toString(); });
        cliChild.stderr.on('data', (chunk) => { cliOutput += chunk.toString(); });

        cliChild.on('close', (code) => {
          clearTimeout(commitTimeout);
          if (code === 0 && cliOutput.trim()) {
            const parsed = parseAgentCommitOutput(cliOutput, fallbackResult);
            finishCommit(parsed);
          } else {
            finishCommit(fallbackResult);
          }
        });

        cliChild.on('error', () => {
          clearTimeout(commitTimeout);
          finishCommit(fallbackResult);
        });
      } catch (e) {
        finishCommit(fallbackResult);
      }
    });
    return;
  }

  // ----------------------------------------------------
  // 模式 A: 任務代碼實作執行模式
  // ----------------------------------------------------
  if (!settings.enableCliAgent) {
    console.log('[CLI Agent] 模式未啟用，略過自動執行 (Task: ' + taskId + ')');
    return;
  }

  // 避免同一任務重複啟動多個 CLI 行程
  if (activeCliProcesses.has(taskId)) {
    console.log(' [CLI Agent] 任務 ' + taskId + ' 已有行程正在執行中，略過重複觸發。');
    return;
  }

  // TD-S3: 單卡 2 輪失敗熔斷守門 (needs_human 鎖定期間嚴禁自動啟動 CLI)
  if (task.status === 'needs_human' || task.needsHuman === true || (Number(task.fixRoundCount || 0) >= 2 && task.resetCircuitBreaker !== true)) {
    console.warn(`🛑 [Circuit Breaker] 任務 ${taskId} 已達 2 輪失敗熔斷 (needs_human)，停止自動啟動 CLI Agent。`);
    appendTaskEvent({
      taskId,
      type: 'fix_round_circuit_break',
      reason: 'cli_dispatch_blocked',
      fixRoundCount: Number(task.fixRoundCount || 0)
    });
    return;
  }

  // Clarification Gate: 尚有待使用者回答的問答選項時，暫停啟動 CLI Agent
  if (isTaskAwaitingClarification(task)) {
    console.log(`💬 [Clarification Gate] 任務 ${taskId} 正等待使用者確認問答選項，暫緩啟動 CLI Agent。`);
    return;
  }

  // 檢查每日運行上限熔斷 (Pulse Quota Circuit Breaker)
  const dailyRunCap = Number(settings.dailyCliRunCap) > 0 ? Number(settings.dailyCliRunCap) : 30;
  if (getCliRunsToday() >= dailyRunCap) {
    const quotaMsg = `[Pulse Quota] 今日 CLI Agent 執行次數已達上限 (${dailyRunCap} 次)，自動熔斷保護已觸發。`;
    console.warn(`⚠️ ${quotaMsg} (Task: ${taskId})`);
    task.liveStatus = quotaMsg;
    writeTasks(tasks);
    appendTaskEvent({
      taskId,
      type: 'quota_circuit_break',
      reason: 'daily_cap_exceeded',
      dailyRuns: getCliRunsToday(),
      dailyRunCap
    });
    return;
  }
  recordCliRun();
  appendTaskEvent({
    taskId,
    type: 'cli_agent_started',
    dailyRunCount: getCliRunsToday()
  });

  console.log(' [CLI Agent 引擎] 啟動執行任務: ' + task.id + ' - ' + task.title + ' (目錄: ' + projPath + ')');

  const githubInfo = scanProjectGithubInfo(projPath);

  let skillsSection = '';
  if (githubInfo.skills && githubInfo.skills.length > 0) {
    let specifiedSkills = [];
    if (task && Array.isArray(task.tags) && task.tags.length > 0) {
      specifiedSkills = githubInfo.skills.filter(s => {
        return task.tags.some(t => {
          const cleanTag = String(t).trim().toLowerCase();
          return cleanTag === (s.id || '').toLowerCase() || cleanTag === (s.label || '').toLowerCase();
        });
      });
    }

    let specifiedText = '';
    if (specifiedSkills.length > 0) {
      specifiedText = '【本任務指定使用之專案 Skills (請優先詳閱並遵循)】\n' +
        specifiedSkills.map(s => `- ${s.label} (${s.path}/SKILL.md): ${s.desc}`).join('\n') + '\n\n';
    }

    skillsSection = '\n' + specifiedText + '【專案專屬 .github Skills 技能庫】\n' +
      githubInfo.skills.map(s => `- ${s.label} (${s.path}): ${s.desc}`).join('\n') + '\n';
  }

  let docsSection = '';
  if (githubInfo.docs && githubInfo.docs.length > 0) {
    const docContents = githubInfo.docs.map(docFile => {
      const docPath = path.join(projPath, docFile);
      let summary = '';
      try {
        summary = fs.readFileSync(docPath, 'utf8').slice(0, 1000);
      } catch (e) {}
      return `--- [${docFile}] ---\n${summary}`;
    }).join('\n\n');
    docsSection = '\n【專案 Agent 規範與架構文檔】\n' + docContents + '\n';
  }

  const harnessCmd = (githubInfo.harness && githubInfo.harness.command) ? githubInfo.harness.command : 'npm test / npm run harness:check';

  const feedbackSection = task.feedback ? '\n• 【最高優先 Feedback】: ' + task.feedback : '';
  const tier = determineTaskTier(task);
  const subagentGuidance = formatTierStrategy(tier, resolveProvider(task)) + '\n';
  const gitnexusLine = formatGitNexusGuidance(projPath);
  const gitnexusGuidance = gitnexusLine ? gitnexusLine + '\n' : '';

  const isPendingPlanCreation = Boolean(task.requiresConfirmation && (!task.executionPlan || !task.executionPlan.trim()));
  const confirmationGuidance = isPendingPlanCreation
    ? '• 【需確認後執行門禁 (Confirmation Gate)】: 本任務勾選「需確認後再執行」（requiresConfirmation: true），目前處於待擬定計劃階段！首要任務僅為需求分析與擬定具體完整的 executionPlan 回寫至 tasks.json（維持 status: in_progress），嚴禁未獲使用者授權前直接進行代碼實作或推進 review！請於回覆中提示使用者於儀表板審閱並點選「確認並執行」。\n'
    : '';
  const styleGuidance = settings.plainLanguageWithTerms !== false
    ? '• 【說明輸出風格】：所有說明（執行計劃、交付報告、回覆）皆以白話解釋搭配專有名詞進行。\n'
    : '';

  const promptText = '【任務開工】[' + task.id + '] ' + task.title + '\n' +
    '• 專案: ' + task.project + ' (' + projPath + ') | 驗證: ' + harnessCmd + '\n' +
    '• 需求: ' + (task.description || '無') +
    feedbackSection + '\n' +
    skillsSection +
    docsSection +
    '【3-Phase Gate 規範】：\n' +
    gitnexusGuidance +
    subagentGuidance +
    confirmationGuidance +
    styleGuidance +
    '1. Pre-Flight: 優先滿足 Feedback，檢閱規範並執行前置驗證（' + harnessCmd + '）；若任務勾選需確認後再執行且未具備執行計劃，必須先產出完整執行計劃回寫 executionPlan 供確認；若需求包含【最新需求覆蓋】，其內容具備最高優先權，衝突處一律覆蓋舊有描述；面對 > 500 行大檔嚴禁整檔閱讀，必須以 grep-n 先定位後切片 30-50 行，檢索上限 2 次避免 Loop。\n' +
    '2. Implementation: 遵循專案架構最小範圍實作並補齊測試，嚴禁跨專案副作用；若執行中途遇到規格模糊或需拍板事項，嚴禁僅在對話框乾等，請呼叫 PUT http://localhost:3030/api/tasks/' + task.id + ' 寫入 pendingQuestions（含題目、選項與 recommended 推薦項，維持 in_progress），等待使用者於儀表板點選確認後接續。\n' +
    '3. Review Promotion: 驗證通過且完成 Pre-Commit 預檢（若專案具備 .git/hooks/pre-commit 必須先執行通過），收集全量 diff，依核心主軸產出 commitMessage ({ subject, body })，推進至 review 並清空 feedback。\n' +
    '【執行紀錄證據】：executionLog 必須逐步記錄實際檢閱檔案、診斷結果、修改檔案與原因，以及每項驗證的命令、工作目錄、退出碼與實際 stdout/stderr。區分工作摘要與原始執行細節，不得僅寫「測試通過／工作完成」，不得宣稱未執行的檢查已通過；保留可用輸出且不得截斷，敏感憑證不得寫入日誌。';

  const rawCliCmd = (settings.cliCommand || 'hermes').trim();
  const customEnv = buildCustomEnv();

  // 解析 CLI 指令與參數
  let bin = rawCliCmd.split(/\s+/)[0];
  let args = [];

  if (bin === 'hermes' || bin.endsWith('/hermes')) {
    const candidates = [USER_HOME + '/.local/bin/hermes',
      '/opt/homebrew/bin/hermes',
      '/usr/local/bin/hermes',
      'hermes'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) { bin = c; break; }
    }
    args = ['--yolo', '-z', promptText];
  } else if (bin === 'claude' || bin.endsWith('/claude')) {
    args = ['-p', promptText];
  } else if (bin === 'agy' || bin.endsWith('/agy')) {
    args = [promptText];
  } else {
    bin = 'bash';
    args = ['-c', buildCliCommand(rawCliCmd, promptText)];
  }

  // 檢查隔離工作區與排隊狀態（若已有有效 worktreePath 直接沿用不重複建立）
  let execPath = projPath;
  let worktreeCreated = false;
  const workspacePrep = prepareTaskWorkspaceOnStart(projPath, task, tasks);
  if (workspacePrep.queued) {
    writeTasks(tasks);
    console.log(`⏳ [CLI Agent Queue] 任務 ${taskId} 等待 ${workspacePrep.blockedByTaskId} 完成中，暫緩啟動 CLI`);
    if (callback) callback(new Error(`任務排隊等待 ${workspacePrep.blockedByTaskId} 完成中`));
    return;
  }
  if (task.workspaceMode === 'worktree' && task.worktreePath && fs.existsSync(task.worktreePath)) {
    execPath = task.worktreePath;
    worktreeCreated = true;
    console.log(' [CLI Agent Worktree] 已為任務 ' + taskId + ' 啟用隔離工作區: ' + execPath + ' (分支: ' + task.branchName + ', 基線: ' + task.baseBranch + '@' + (task.baseCommit || '').slice(0, 7) + ')');
  } else if (settings.cliIsolation === 'worktree' && task.workspaceMode === 'worktree') {
    console.warn('⚠️ [CLI Agent Worktree] 建立隔離工作區失敗，回退至主目錄');
  }
  if (workspacePrep.worktreeCreated) {
    writeTasks(tasks);
  }

  // 設定負責人為 CLI
  task.assignee = 'CLI';

  // 建立實體日誌檔案
  const logFile = path.join(getLogsDir(), `${taskId}.log`);
  const runLogOffset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  let logWriteError = null;
  logStream.on('error', (err) => {
    logWriteError = err;
    console.error(' [CLI Agent 引擎] 日誌寫入失敗 (Task: ' + taskId + '):', err);
  });

  // 記錄開始日誌
  const startLog = '[' + new Date().toISOString() + ']  CLI Agent 自動觸發 (' + rawCliCmd + ')\n' +
    '目標專案: ' + projPath + (worktreeCreated ? ' [Worktree 隔離: ' + execPath + ']\n' : '\n') +
    '任務: ' + task.title + '\n' +
    '日誌檔案: ' + logFile + '\n' +
    '----------------------------------------\n';
  logStream.write(startLog);
  task.executionLog = (task.executionLog || '') + '\n' + startLog;
  writeTasks(tasks);

  try {
    const child = spawn(bin, args, {
      cwd: execPath,
      env: customEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });

    const procStartTime = Date.now();
    activeCliProcesses.set(taskId, {
      child,
      startTime: procStartTime,
      logFile,
      projPath,
      recentLines: ['[System] CLI Agent 行程已啟動...'],
      lastLine: 'CLI Agent 行程已啟動，開始分析任務...',
      liveModifiedFiles: []
    });

    // 延遲 3 秒為 CLI Session 自動辨識並回寫（確保 SQLite / 專案檔案已生成）
    setTimeout(() => {
      captureAndTagCliSession(bin, task.id, task.title, projPath, procStartTime, liveOutputBuffer);
    }, 3000);

    // 設定行程超時保護 (Pulse Quota: 預設讀取 settings.cliTimeoutMinutes，預設 20 分鐘)
    const timeoutMinutes = Number(settings.cliTimeoutMinutes) > 0 ? Number(settings.cliTimeoutMinutes) : 20;
    const CLI_TIMEOUT_MS = timeoutMinutes * 60 * 1000;
    let isTimedOut = false;
    const timeoutTimer = setTimeout(() => {
      isTimedOut = true;
      console.warn('⚠️ [Pulse Quota] 任務 ' + taskId + ' 執行逾時 (' + timeoutMinutes + ' 分鐘)，強制中止行程樹...');
      logStream.write('\n⚠️ [Pulse Quota] 行程執行逾時 (' + timeoutMinutes + ' 分鐘)，已被系統強制中止進程樹。\n');
      appendTaskEvent({
        taskId,
        type: 'timeout_circuit_break',
        timeoutMinutes
      });
      killProcessTree(child, 'SIGTERM');
      setTimeout(() => {
        try { killProcessTree(child, 'SIGKILL'); } catch (e) {}
      }, 3000);
    }, CLI_TIMEOUT_MS);

    let liveOutputBuffer = '';
    let hasOutputErrors = false;
    const MAX_BUFFER_SIZE = 100 * 1024; // 100KB cap to prevent unbounded memory growth
    const errorKeywords = /API call failed|HTTP (?:429|401|403|500|502|503|529)|rate limit|Traceback \(most recent call last\)|AuthenticationError|quota exceeded|Fatal error|model is temporarily at capacity/i;

    const handleChunk = (chunk) => {
      const text = chunk.toString();
      liveOutputBuffer += text;
      hasOutputErrors = hasOutputErrors || errorKeywords.test(liveOutputBuffer);
      // Cap buffer: keep only the most recent portion to prevent memory growth
      if (liveOutputBuffer.length > MAX_BUFFER_SIZE) {
        liveOutputBuffer = liveOutputBuffer.slice(-MAX_BUFFER_SIZE);
      }
      logStream.write(chunk);

      const procInfo = activeCliProcesses.get(taskId);
      if (procInfo) {
        const rawLines = text.split('\n');
        for (const rLine of rawLines) {
          const cleaned = cleanAnsi(rLine);
          if (cleaned && cleaned.length > 2) {
            procInfo.lastLine = cleaned.length > 100 ? cleaned.slice(0, 97) + '...' : cleaned;
            procInfo.recentLines.push(cleaned);
            if (procInfo.recentLines.length > 30) {
              procInfo.recentLines.shift();
            }
          }
        }
      }
    };

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    child.on('error', (err) => {
      clearTimeout(timeoutTimer);
      console.error(' [CLI Agent 引擎] 行程啟動錯誤 (Task: ' + taskId + '):', err);
      logStream.write('\n 行程啟動錯誤: ' + err.message + '\n');
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutTimer);
      activeCliProcesses.delete(taskId);
      captureAndTagCliSession(bin, taskId, task.title, projPath, procStartTime, liveOutputBuffer);

      console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 行程結束 (Code: ' + code + ', Signal: ' + signal + ')，執行智慧交付驗收...');

      // 等待日誌落盤；記憶體緩衝僅供即時狀態，不能當作完整交付證據。
      const finalizeRun = () => {
        let runOutput = '';
        let logReadError = null;
        try {
          const outputOffset = runLogOffset + Buffer.byteLength(startLog, 'utf8');
          runOutput = fs.readFileSync(logFile).subarray(outputOffset).toString('utf8');
        } catch (err) {
          logReadError = err;
          console.error(' [CLI Agent 引擎] 日誌讀取失敗 (Task: ' + taskId + '):', err);
        }
        // Smart Git Delivery Gate: 檢查專案是否產出變更 (支援 Worktree 隔離工作區)
        collectGitDiff(execPath, customEnv, (modifiedList, diffContent) => {
          const updatedTasks = readTasks();
          const curTask = updatedTasks.find(t => t.id === taskId);
          if (!curTask) return;

          curTask.assignee = 'CLI';
          curTask.updatedAt = new Date().toISOString();
          const logError = logWriteError || logReadError;
          const outputLog = runOutput
            ? '\n--- 本輪完整執行輸出 (stdout / stderr) ---\n' + runOutput + '\n--- 本輪執行輸出結束 ---\n'
            : (logError ? '\n[CLI Output] 本輪輸出無法完整取得。\n' : '\n[CLI Output] 本輪未產生 stdout/stderr。\n');
          curTask.executionLog = (curTask.executionLog || '') +
            '\n[CLI Result] Exit code: ' + code + ', Signal: ' + (signal || 'none') + '\n' + outputLog +
            (logError ? '\n[CLI Log Error] 完整執行輸出無法保存: ' + logError.message + '\n' : '');

          const hasGitChanges = Array.isArray(modifiedList) && modifiedList.length > 0;

          // 檢驗是否有上游 API 報錯或常見致命錯誤 (如 HTTP 429/401/500、額度不足、未定義異常等)
          const hasErrorKeywords = hasOutputErrors || errorKeywords.test(runOutput);

          // 成功判定條件：
          // 1. 未逾時
          // 2. 產出實質 Git 變更且無致命報錯，或者 (無變更但 Exit Code 0 且明確無報錯)
          // 注意：若 Exit Code 0 但 liveOutputBuffer 含有 429/API failed 等致命錯誤，不得判定為成功
          const isSuccess = !logError && !isTimedOut && (code === 0) && (hasGitChanges || !hasErrorKeywords) && !hasErrorKeywords;

          if (isSuccess && hasGitChanges) {
            // 若任務設定為需確認後再執行且尚未經使用者確認點選
            if (curTask.requiresConfirmation && (!curTask.executionPlan || !curTask.executionPlan.trim())) {
              const planText = runOutput.trim() || '已擬定執行計劃，請檢視並點選「確認並執行」。';
              curTask.executionPlan = planText;
              curTask.status = 'in_progress';
              const planLog = '\n[' + new Date().toISOString() + '] 📋 [Confirmation Gate] 執行計劃擬定完畢，任務進入「待確認」狀態等待審閱。\n----------------------------------------\n';
              curTask.executionLog = (curTask.executionLog || '') + planLog;
              curTask.modifiedFiles = modifiedList || [];
              curTask.diff = diffContent || '';
              writeTasks(updatedTasks);
              syncToMarkdown(updatedTasks);
              console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 已產出執行計劃，處於「待確認」狀態等待使用者確認。');
              return;
            }

            // 判定成功且有檔案修改：推進至 review
            const endLog = '\n[' + new Date().toISOString() + ']  CLI Agent 執行完畢 (Exit code: ' + (code !== null ? code : '0') + ')\n' +
              'Signal: ' + (signal || 'none') + '\n' +
              '變更檔案: ' + modifiedList.join(', ') + '\n' +
              '----------------------------------------\n';
            curTask.executionLog = (curTask.executionLog || '') + endLog;
            curTask.status = 'review';
            consumeTaskFeedback(curTask);
            curTask.modifiedFiles = modifiedList || [];
            curTask.diff = diffContent || '';
            const risk = calculateRiskDoor(modifiedList, diffContent);
            curTask.riskDoor = risk.riskDoor;
            curTask.riskReasons = risk.riskReasons;
            curTask.requestCommitGen = false;
            const commitMsg = formatCommitMessageFromSkill(projPath, curTask, diffContent, modifiedList);
            curTask.commitMessage = {
              subject: commitMsg.message,
              body: commitMsg.body || ''
            };
            curTask._retryCount = 0;
            writeTasks(updatedTasks);
            syncToMarkdown(updatedTasks);
            broadcastSse('task-complete', { taskId });
            console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 驗收通過，已依據 Diff 產出 Commit 訊息並推進至 Review！');
          } else if (isSuccess && !hasGitChanges) {
            if (curTask.requiresConfirmation && (!curTask.executionPlan || !curTask.executionPlan.trim())) {
              const planText = runOutput.trim() || '已擬定執行計劃，請檢視並點選「確認並執行」。';
              curTask.executionPlan = planText;
              curTask.status = 'in_progress';
              const planLog = '\n[' + new Date().toISOString() + '] 📋 [Confirmation Gate] 執行計劃擬定完畢，任務進入「待確認」狀態等待審閱。\n----------------------------------------\n';
              curTask.executionLog = (curTask.executionLog || '') + planLog;
              writeTasks(updatedTasks);
              syncToMarkdown(updatedTasks);
              console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 已產出執行計劃，處於「待確認」狀態等待使用者確認。');
              return;
            }

            // 判定成功但無代碼變更 (例如純代碼檢核/分析任務)
            const endLog = '\n[' + new Date().toISOString() + ']  CLI Agent 執行完畢 (Exit code: ' + (code !== null ? code : '0') + ')\n' +
              'Signal: ' + (signal || 'none') + '\n' +
              '變更檔案: 無檔案變更；驗證結果請參閱實際執行輸出。\n' +
              '----------------------------------------\n';
            curTask.executionLog = (curTask.executionLog || '') + endLog;
            curTask.status = 'review';
            consumeTaskFeedback(curTask);
            curTask.modifiedFiles = [];
            curTask.diff = '';
            curTask._retryCount = 0;
            writeTasks(updatedTasks);
            syncToMarkdown(updatedTasks);
            broadcastSse('task-complete', { taskId });
            console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 執行完畢 (無檔案變更)，已推進至 Review。');
          } else {
            // 失敗 (包括有 API 429 報錯、超時或無產出且異常)
            const reasonMsg = logError ? '完整日誌保存失敗: ' + logError.message : (isTimedOut ? '執行逾時' : (hasErrorKeywords ? '上游 API 或模型報錯 (如 Rate Limit / HTTP 429)' : `Exit code: ${code}, Signal: ${signal || 'none'}`));
            const retryCount = (curTask._retryCount || 0);
            if (retryCount < 2) {
              const retryLog = '\n[' + new Date().toISOString() + '] ⚠️ CLI Agent 執行異常 (' + reasonMsg + ') 且無有效代碼產出，正在重試 (' + (retryCount + 1) + '/2)...\n' +
                'Exit code: ' + code + ', Signal: ' + (signal || 'none') + '\n' +
                '----------------------------------------\n';
              curTask.executionLog = (curTask.executionLog || '') + retryLog;
              curTask._retryCount = retryCount + 1;
              writeTasks(updatedTasks);
              syncToMarkdown(updatedTasks);
              broadcastSse('task-error', { taskId, error: reasonMsg });
              setTimeout(() => executeTaskWithCliAgent(taskId), 5000);
            } else {
              const nextFixRound = Number(curTask.fixRoundCount || 0) + 1;
              curTask.fixRoundCount = nextFixRound;
              const failLog = '\n[' + new Date().toISOString() + '] ❌ CLI Agent 執行失敗 (' + reasonMsg + ')，無有效變更產出。\n' +
                'Exit code: ' + code + ', Signal: ' + (signal || 'none') + '\n' +
                '----------------------------------------\n';
              curTask.executionLog = (curTask.executionLog || '') + failLog;
              const isWorktreeOrResume = (settings.cliIsolation === 'worktree' || settings.enableCliResume === true);
              if (nextFixRound >= 2) {
                curTask.status = 'needs_human';
                curTask.needsHuman = true;
                curTask.claimedBy = null;
                curTask.claimedAt = null;
                curTask.liveStatus = {
                  text: `連續失敗達 ${nextFixRound} 輪，已觸發 2 輪熔斷鎖定 needs_human`,
                  resumable: false
                };
                appendTaskEvent({
                  taskId,
                  type: 'fix_round_circuit_break',
                  fixRoundCount: nextFixRound,
                  reason: reasonMsg
                });
              } else {
                curTask.status = isWorktreeOrResume ? 'in_progress' : 'todo';
                curTask.liveStatus = {
                  text: 'CLI 異常中斷 (' + reasonMsg + ')，已保留工作區狀態',
                  resumable: isWorktreeOrResume
                };
              }
              curTask._retryCount = 0;
              writeTasks(updatedTasks);
              syncToMarkdown(updatedTasks);
              broadcastSse('task-error', { taskId, error: reasonMsg });
              console.error(' [CLI Agent 引擎] 任務 ' + taskId + ' 執行中斷，狀態: ' + curTask.status);
            }
          }
        }, { baseCommit: task.baseCommit, baseBranch: task.baseBranch });
      };
      if (logStream.closed) {
        finalizeRun();
      } else {
        logStream.once('close', finalizeRun);
        logStream.end();
      }
    });

  } catch (spawnErr) {
    activeCliProcesses.delete(taskId);
    logStream.end();
    console.error(' [CLI Agent 引擎] Spawn 異常 (Task: ' + taskId + '):', spawnErr);
  }
}

// 狀態對齊與補正機制 (Auto-Reconciliation)
// 針對無活躍行程但仍標記為 in_progress 的孤立任務進行補正
function reconcileTasks() {
  const tasks = readTasks();
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  if (inProgress.length === 0) return;

  const projects = readProjects();
  const customEnv = buildCustomEnv();

  inProgress.forEach(t => {
    // 若沒有活躍背景行程在執行
    if (!activeCliProcesses.has(t.id)) {
      const proj = projects.find(p => p.id === t.project);
      const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, t.project || '');
      const gitTargetDir = resolveTaskGitWorkDir(t, projPath);
      collectGitDiff(gitTargetDir, customEnv, (modifiedList, diffContent) => {
        const freshTasks = readTasks();
        const target = freshTasks.find(item => item.id === t.id && item.status === 'in_progress');
        if (!target) return;

        const logFile = path.join(getLogsDir(), `${t.id}.log`);
        let logContent = '';
        if (fs.existsSync(logFile)) {
          try { logContent = fs.readFileSync(logFile, 'utf8'); } catch (e) {}
        }

        const hasGitChanges = Array.isArray(modifiedList) && modifiedList.length > 0;
        const isDoneLogged = logContent.includes('CLI Agent 執行完畢') || logContent.includes(' CLI Agent 執行完畢');

        // 僅當 CLI Agent 明確標記完工日誌且存在有效代碼產出時，才自動推進至 Review
        if (isDoneLogged && hasGitChanges) {
          target.status = 'review';
          consumeTaskFeedback(target);
          target.modifiedFiles = modifiedList || [];
          target.diff = diffContent || '';
          target.updatedAt = new Date().toISOString();
          target.executionLog = (target.executionLog || '') +
            '\n[' + new Date().toISOString() + '] 🔄 [Auto-Reconcile] 偵測到 CLI Agent 已完成執行，狀態對齊推進至 Review。\n----------------------------------------\n';
          writeTasks(freshTasks);
          syncToMarkdown(freshTasks);
          console.log(' [Auto-Reconcile] 任務 ' + t.id + ' 狀態自動對齊推進至 Review！');
        } else {
          // 若為 Antigravity 或非 CLI 派發之外部任務，由代理人自主管理狀態，後端絕不因工作區殘留 diff 盲目推進
          if (t.assignee !== 'CLI') {
            return;
          }

          // 行程已不存在且未標記完工（例如伺服器重啟或中斷遺留的孤立任務）
          const updatedTime = new Date(target.updatedAt || target.createdAt || 0).getTime();
          const now = Date.now();
          const hasFeedback = Boolean(target.feedback && target.feedback.trim().length > 0);
          // 若距今超過 60 秒仍處於無行程 in_progress 狀態且沒有待處理的 feedback
          // 嚴格準則：工作區殘留 diff 不得作為推進 review 的基準，避免誤抓其他任務之未提交變更
          if (now - updatedTime > 60000 && !hasFeedback) {
            target.status = 'todo';
            target._retryCount = 0;
            target.updatedAt = new Date().toISOString();
            target.executionLog = (target.executionLog || '') +
              '\n[' + new Date().toISOString() + '] 🔄 [Auto-Reconcile] 偵測到 CLI 行程已終止且未輸出完工信號，安全退回 Todo（防止工作區殘留 diff 被誤判完工）。\n----------------------------------------\n';
            writeTasks(freshTasks);
            syncToMarkdown(freshTasks);
            console.log(' [Auto-Reconcile] 孤立 CLI 任務 ' + t.id + ' 行程消失且未完工，安全退回 Todo。');
          }
        }
      });
    }
  });

  // 自動為未綁定 conversationId 的 CLI 任務進行 Hermes SQLite 比對與標籤對齊
  tasks.filter(t => !t.conversationId && (t.assignee === 'CLI' || t.status !== 'todo')).forEach(t => {
    const proj = projects.find(p => p.id === t.project);
    const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, t.project || '');
    captureAndTagCliSession('hermes', t.id, t.title, projPath, 0, '');
  });
}

function runAutoInspection() {
  reconcileTasks();
  const tasks = readTasks();
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  lastInspectionTime = new Date().toISOString();
  lastInspectionResult = {
    inspectedAt: lastInspectionTime,
    inProgressCount: inProgress.length,
    status: inProgress.length > 0 ? 'active' : 'idle',
    tasks: inProgress.map(t => ({ id: t.id, title: t.title, project: t.project }))
  };
  return lastInspectionResult;
}

// 每 30 秒自動執行背景對齊巡檢
setInterval(reconcileTasks, 30000).unref();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function executeProjectCommit(projPath, task, customData = {}) {
  if (!fs.existsSync(projPath) || !fs.existsSync(path.join(projPath, '.git'))) {
    return { output: '專案非 Git 版本控制目錄，已記錄狀態並封存', isCommitted: true, hasError: false };
  }

  // 建立包含完整 PATH 的 custom env
  const commitEnv = {
    ...buildCustomEnv(),
    TASK_ID: task.id || ''
  };
  const getHeadCommit = () => {
    try {
      return execSync('git rev-parse --verify HEAD', { cwd: projPath, encoding: 'utf8', timeout: 3000, env: commitEnv }).trim();
    } catch (e) {
      return '';
    }
  };
  const initialHead = getHeadCommit();
  const hasNewCommit = () => {
    const currentHead = getHeadCommit();
    return !!currentHead && currentHead !== initialHead;
  };

  // 1. Step 1: 環境確認 & Staging
  try { execSync('git add -A', { cwd: projPath, timeout: 10000, env: commitEnv }); } catch (e) {}

  let statusOutput = '';
  try { statusOutput = execSync('git status --short', { cwd: projPath, encoding: 'utf8', timeout: 5000, env: commitEnv }).trim(); } catch (e) {}
  
  if (!statusOutput) {
    return { output: '無新異動需要 commit (Working tree clean)', isCommitted: true, hasError: false };
  }

  let diffStat = '';
  try { diffStat = execSync('git diff --cached --stat', { cwd: projPath, encoding: 'utf8', timeout: 5000, env: commitEnv }).trim(); } catch (e) {}

  let stagedFiles = [];
  try {
    const rawFiles = execSync('git diff --cached --name-only', { cwd: projPath, encoding: 'utf8', timeout: 5000, env: commitEnv }).trim();
    stagedFiles = rawFiles.split('\n').filter(Boolean);
  } catch (e) {}

  // 2. 檢測 .github/ 內之 Commit Skill 並分析 Diff
  let cachedDiff = '';
  try { cachedDiff = execSync('git diff --cached', { cwd: projPath, encoding: 'utf8', timeout: 5000, env: commitEnv }); } catch (e) {}
  const { message: autoMsg, body: autoBody, skillName } = formatCommitMessageFromSkill(projPath, task, cachedDiff || diffStat, stagedFiles);

  // 處理自訂標題與內文 (優先使用自訂值或 Agent 產出的 commitMessage.body 或 diff 產出的 autoBody，絕非直接帶入 task.description)
  let subject = (customData.subject || customData.customSubject || (task.commitMessage && task.commitMessage.subject) || autoMsg).trim();
  let defaultBody = (task.commitMessage && task.commitMessage.body) ? task.commitMessage.body : (autoBody || '');
  let bodyText = (customData.body !== undefined ? customData.body : (customData.customBody !== undefined ? customData.customBody : defaultBody)).trim();

  // 若標題未包含 conventional prefix 且無自訂 subject，自動補齊
  if (!/^(feat|fix|refactor|style|perf|test|docs|chore|revert)(\([^)]+\))?:\s*/i.test(subject)) {
    subject = formatCommitMessage({ ...task, title: subject });
  }

  let fullCommitMsg = subject;
  if (bodyText) {
    fullCommitMsg = `${subject}\n\n${bodyText}`;
  }

  const safeFullMsg = fullCommitMsg.replace(/"/g, '\\"');
  commitEnv.COMMIT_MESSAGE = safeFullMsg;

  // A. 優先嘗試 package.json scripts.commit
  const pkgPath = path.join(projPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts.commit) {
        try {
          const out = execSync(`npm run commit -- "${safeFullMsg}"`, {
            cwd: projPath,
            encoding: 'utf8',
            timeout: 30000,
            env: commitEnv
          }).trim();
          return { output: `[Commit Skill: npm run commit]\n${out}`, isCommitted: true, hasError: false };
        } catch (npmErr) {
          const npmOut = (npmErr.stdout || '').toString().trim();
          const npmErrStr = (npmErr.stderr || '').toString().trim();
          const fullErr = [npmErrStr, npmOut, npmErr.message].filter(Boolean).join('\n\n');
          if (hasNewCommit()) {
            return { output: `[Commit Skill: npm run commit]\n${fullErr || npmOut || 'Commit 已建立'}`, isCommitted: true, hasError: false };
          }
          return { output: fullErr || 'npm run commit 執行失敗', isCommitted: false, hasError: true };
        }
      }
    } catch (e) {}
  }

  // B. 檢測自訂腳本 scripts/commit.sh
  const customScriptPath = path.join(projPath, 'scripts/commit.sh');
  if (fs.existsSync(customScriptPath)) {
    try {
      const out = execSync(`bash "${customScriptPath}" "${safeFullMsg}"`, {
        cwd: projPath,
        encoding: 'utf8',
        timeout: 30000,
        env: commitEnv
      }).trim();
      return { output: `[Commit Skill: scripts/commit.sh]\n${out}`, isCommitted: true, hasError: false };
    } catch (scriptErr) {
      const sOut = (scriptErr.stdout || '').toString().trim();
      const sErr = (scriptErr.stderr || '').toString().trim();
      const fullErr = [sErr, sOut, scriptErr.message].filter(Boolean).join('\n\n');
      if (hasNewCommit()) {
        return { output: `[Commit Skill: scripts/commit.sh]\n${fullErr || 'Commit 已建立'}`, isCommitted: true, hasError: false };
      }
      return { output: fullErr || 'scripts/commit.sh 執行失敗', isCommitted: false, hasError: true };
    }
  }

  // C. 依據 .github 內 Commit Skill 規範執行多行提交
  try {
    let commitCmd = `git commit -m "${subject.replace(/"/g, '\\"')}"`;
    if (bodyText) {
      commitCmd += ` -m "${bodyText.replace(/"/g, '\\"')}"`;
    }
    const commitOutput = execSync(commitCmd, {
      cwd: projPath,
      encoding: 'utf8',
      timeout: 30000,
      env: commitEnv
    }).trim();
    let lastLog = '';
    try { lastLog = execSync('git log --oneline -1', { cwd: projPath, encoding: 'utf8', timeout: 3000, env: commitEnv }).trim(); } catch (e) {}
    
    if (skillName) {
      return {
        output: `[Commit Skill: ${skillName}]\n✅ 依據專案 .github Skill 規範提交成功！\n- Commit: ${lastLog}\n- 格式: ${subject}\n\n${commitOutput}`,
        isCommitted: true,
        hasError: false
      };
    }

    return { output: commitOutput, isCommitted: true, hasError: false };
  } catch (commitErr) {
    const stdout = commitErr.stdout ? commitErr.stdout.toString().trim() : '';
    const stderr = commitErr.stderr ? commitErr.stderr.toString().trim() : '';
    const isCommitted = hasNewCommit();
    if (isCommitted) {
      return { output: stdout || 'Commit 成功', isCommitted: true, hasError: false };
    }
    const fullErr = [stderr, stdout, commitErr.message].filter(Boolean).join('\n\n');
    return { output: fullErr || 'Git Commit 執行失敗', isCommitted: false, hasError: true };
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query || {};

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-Archived-Count');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API 路由 ---

  // SSE: 即時任務與 Agent 事件推送
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': keepalive\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 重啟伺服器
  if (pathname === '/api/server/restart' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Server restarting...' }));
    setTimeout(() => {
      cleanupAllCliProcesses(activeCliProcesses);
      process.exit(0);
    }, 500);
    return;
  }

  function listActiveSentinels() {
    const dir = resolveDataDir();
    const active = [];
    try {
      if (!fs.existsSync(dir)) return active;
      const files = fs.readdirSync(dir).filter(f => /^sentinel-.*\.lock$/.test(f));
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const info = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          const pid = Number(info && info.pid);
          if (!pid) {
            fs.unlinkSync(fullPath);
            continue;
          }
          try {
            process.kill(pid, 0);
            active.push({
              pid,
              targetAgent: info.targetAgent || 'all',
              tiers: Array.isArray(info.tiers) ? info.tiers : [],
              startedAt: info.startedAt || ''
            });
          } catch (e) {
            // PID 已退出，自動清理殘留 lockfile
            try { fs.unlinkSync(fullPath); } catch (_) {}
          }
        } catch (e) {}
      }
    } catch (e) {}
    return active;
  }

  // 系統設定 (CLI Agent 開關與指令)
  if (pathname === '/api/settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...readSettings(), activeSentinels: listActiveSentinels() }));
    return;
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const current = readSettings();
        const oldDir = resolveDataDir();
        const updated = { ...current, ...data };
        if (data.dataDirectoryPath && data.dataDirectoryPath !== current.dataDirectoryPath) {
          let newDir = data.dataDirectoryPath.trim();
          if (newDir.startsWith('~')) {
            newDir = path.join(USER_HOME, newDir.slice(1));
          }
          migrateConfigDirectory(oldDir, newDir);
        }
        writeSettings(updated);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updated));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

function runNativeFolderPicker(promptText, callback) {
  execFile('osascript', ['-e', 'tell application "System Events" to activate',
    '-e', `set f to choose folder with prompt "${promptText}"`,
    '-e', 'POSIX path of f'
  ], (err, stdout) => {
    if (err || !stdout || !stdout.trim()) {
      return callback(null, null);
    }
    return callback(null, stdout.trim());
  });
}

  // 呼叫 macOS 原生資料夾選擇器 (選擇專案)
  if (pathname === '/api/projects/choose-folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      let opts = {};
      try {
        if (body.trim()) opts = JSON.parse(body);
      } catch (_) {}
      const selectOnly = opts.selectOnly === true;
      const pickerPrompt = String(opts.prompt || '').trim() || (selectOnly ? '請選擇要 Clone 專案的目標父資料夾' : '請選擇要加入 Task Dashboard 的專案資料夾');
      runNativeFolderPicker(pickerPrompt, (err, selectedPath) => {
        if (!selectedPath) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ canceled: true }));
          return;
        }
        if (selectOnly) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, path: selectedPath }));
          return;
        }
        const folderName = path.basename(selectedPath);
        const projects = readProjects();
        let proj = projects.find(p => p.path === selectedPath || p.id === folderName);
        if (!proj) {
          const githubInfo = scanProjectGithubInfo(selectedPath);
          proj = {
            id: folderName,
            name: folderName,
            description: `自訂專案路徑: ${selectedPath}`,
            path: selectedPath,
            docs: githubInfo.docs,
            skills: githubInfo.skills,
            prompts: githubInfo.prompts,
            harness: githubInfo.harness,
            color: 'teal',
            conversations: []
          };
          projects.push(proj);
          writeProjects(projects);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, project: proj }));
      });
    });
    return;
  }

  // 從遠端 Git URL Clone 專案至指定位置並自動註冊進 Task Dashboard
  if (pathname === '/api/projects/clone' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const repoUrl = String(data.repoUrl || data.url || '').trim();
        const parentDir = String(data.parentDir || '').trim() || PROJECTS_ROOT;
        const folderName = String(data.folderName || '').trim();
        const branch = String(data.branch || '').trim();
        const requirePr = Boolean(data.requirePr);

        const cloneRes = await cloneRepository({
          repoUrl,
          parentDir,
          folderName,
          branch,
          customEnv: buildCustomEnv()
        });
        if (!cloneRes.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cloneRes));
          return;
        }

        const targetPath = cloneRes.targetPath;
        const baseName = cloneRes.folderName || path.basename(targetPath);
        const projects = readProjects();
        let proj = projects.find(p => p.path === targetPath);
        if (!proj) {
          let uniqueId = baseName;
          let seq = 2;
          while (projects.some(p => p.id === uniqueId)) {
            uniqueId = `${baseName}-${seq++}`;
          }
          const githubInfo = scanProjectGithubInfo(targetPath);
          proj = {
            id: uniqueId,
            name: String(data.name || '').trim() || baseName,
            description: `Cloned from ${cloneRes.remoteUrl || baseName}`,
            path: targetPath,
            docs: githubInfo.docs,
            skills: githubInfo.skills,
            prompts: githubInfo.prompts,
            harness: githubInfo.harness,
            color: 'indigo',
            requirePr,
            conversations: []
          };
          projects.push(proj);
          writeProjects(projects);
        }
        gitProjectsStatusCache = { timestamp: 0, data: null };
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, project: proj, clone: cloneRes }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Failed to clone repository' }));
      }
    });
    return;
  }

  // 呼叫 macOS 原生資料夾選擇器 (針對 Config 與資料庫放置路徑)
  if (pathname === '/api/settings/choose-config-dir' && req.method === 'POST') {
    runNativeFolderPicker('請選擇 Task Dashboard 的 Config 與資料庫放置資料夾', (err, selectedPath) => {
      if (!selectedPath) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ canceled: true }));
        return;
      }
      const current = readSettings();
      const oldDir = resolveDataDir();
      const updated = { ...current, dataDirectoryPath: selectedPath };
      let newDir = selectedPath.trim();
      if (newDir.startsWith('~')) {
        newDir = path.join(USER_HOME, newDir.slice(1));
      }
      migrateConfigDirectory(oldDir, newDir);
      writeSettings(updated);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, path: selectedPath, settings: updated }));
    });
    return;
  }

  // 巡檢觸發
  if (pathname === '/api/inspect' && (req.method === 'GET' || req.method === 'POST')) {
    const result = runAutoInspection();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 初始化專案 Harness 架構 (引入切片藍圖、規範與驗證腳本)
  if ((pathname.endsWith('/init-harness') || pathname === '/api/projects/init-harness') && req.method === 'POST') {
    let projId = (parsedUrl.query && parsedUrl.query.id ? parsedUrl.query.id : '').trim();
    if (!projId && pathname.includes('/api/projects/')) {
      projId = decodeURIComponent(pathname.replace('/api/projects/', '').replace('/init-harness', '')).trim();
    }
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        let targetId = projId;
        if (body) {
          try {
            const data = JSON.parse(body);
            if (data.id || data.projectId) targetId = data.id || data.projectId;
          } catch (e) {}
        }
        if (!targetId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing project ID' }));
          return;
        }
        const projects = readProjects();
        const proj = projects.find(p => p.id === targetId || p.id === decodeURIComponent(targetId));
        const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, targetId);
        const createdFiles = initProjectHarness(projPath);

        // 重新掃描更新專案資訊
        if (proj) {
          const githubInfo = scanProjectGithubInfo(projPath);
          proj.docs = githubInfo.docs;
          proj.skills = githubInfo.skills;
          proj.prompts = githubInfo.prompts;
          proj.harness = githubInfo.harness;
          writeProjects(projects);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, projectId: targetId, createdFiles, harness: proj ? proj.harness : undefined }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 專案列表
  if (pathname === '/api/projects' && req.method === 'GET') {
    const projects = readProjects();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projects));
    return;
  }

  if (pathname === '/api/projects' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const projects = readProjects();
        if (projects.some(p => p.id === data.id)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project ID already exists' }));
          return;
        }
        const projPath = data.path || data.projectPath || path.join(PROJECTS_ROOT, data.id);
        const githubInfo = scanProjectGithubInfo(projPath);
        const newProj = {
          id: data.id,
          name: data.name || data.id,
          description: data.description || '',
          path: projPath,
          docs: githubInfo.docs,
          skills: githubInfo.skills,
          prompts: githubInfo.prompts,
          harness: githubInfo.harness,
          color: data.color || 'indigo',
          requirePr: Boolean(data.requirePr),
          conversations: data.conversations || []
        };
        projects.push(newProj);
        writeProjects(projects);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newProj));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 查詢專案 Git 分支清單與工作區狀態 (支援 ?refresh=1)
  const branchesGetMatch = req.method === 'GET' && pathname.match(/^\/api\/projects\/([^/]+)\/branches$/);
  if (branchesGetMatch) {
    const projId = decodeURIComponent(branchesGetMatch[1]).trim();
    const projects = readProjects();
    const proj = projects.find(p => p.id === projId);
    if (!proj) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }
    const repoPath = proj.path || path.join(PROJECTS_ROOT, proj.id);
    const tasks = readTasks().filter(t => t.project === proj.id && t.status !== 'archived');
    const forceRefresh = query.refresh === '1' || query.refresh === 'true';
    const branchInfo = getProjectBranches(repoPath, tasks, { refresh: forceRefresh });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projectId: proj.id, ...branchInfo }));
    return;
  }

  // 在專案下建立新 Git 分支（預設無損建立，不切換工作區）
  const branchesPostMatch = req.method === 'POST' && pathname.match(/^\/api\/projects\/([^/]+)\/branches$/);
  if (branchesPostMatch) {
    const projId = decodeURIComponent(branchesPostMatch[1]).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const projects = readProjects();
        const proj = projects.find(p => p.id === projId);
        if (!proj) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project not found' }));
          return;
        }
        const branchName = String(data.branchName || data.name || '').trim();
        if (!branchName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing branchName' }));
          return;
        }
        const repoPath = proj.path || path.join(PROJECTS_ROOT, proj.id);
        const created = createProjectBranch(repoPath, branchName, data.fromBranch || '', {
          checkout: data.checkout === true
        });
        const tasks = readTasks().filter(t => t.project === proj.id && t.status !== 'archived');
        const branchInfo = getProjectBranches(repoPath, tasks, { refresh: true });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, projectId: proj.id, ...created, branchInfo }));
      } catch (err) {
        const statusCode = err && err.statusCode ? err.statusCode : 400;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err && err.message) || 'Failed to create branch' }));
      }
    });
    return;
  }

  // 合併功能分支回目標主幹分支
  const branchesMergeMatch = req.method === 'POST' && pathname.match(/^\/api\/projects\/([^/]+)\/branches\/merge$/);
  if (branchesMergeMatch) {
    const projId = decodeURIComponent(branchesMergeMatch[1]).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const projects = readProjects();
        const proj = projects.find(p => p.id === projId);
        if (!proj) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Project not found' }));
          return;
        }
        if (proj.requirePr === true && data.forceLocalMerge !== true) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            status: 'pr_required',
            error: '此專案已啟用「強制走 PR 流程」，請改用「開立 PR」送出變更（若確需本地合併請傳入 forceLocalMerge: true）。'
          }));
          return;
        }
        const repoPath = proj.path || path.join(PROJECTS_ROOT, proj.id);
        const sourceBranch = String(data.sourceBranch || '').trim();
        let targetBranch = String(data.targetBranch || '').trim();
        if (!targetBranch) {
          const info = getProjectBranches(repoPath, [], { refresh: false });
          targetBranch = info.defaultBranch || 'main';
        }
        if (!sourceBranch || !targetBranch) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing sourceBranch or targetBranch' }));
          return;
        }
        const mergeRes = await mergeFeatureBranch(repoPath, sourceBranch, targetBranch, {
          strategy: data.strategy || 'merge',
          deleteSourceBranch: data.deleteSourceBranch === true,
          commitMessage: data.commitMessage || '',
          customEnv: buildCustomEnv()
        });
        if (!mergeRes.success) {
          const httpCode = (mergeRes.status === 'conflict' || mergeRes.status === 'dirty_main_workspace') ? 409 : 400;
          res.writeHead(httpCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mergeRes));
          return;
        }
        gitProjectsStatusCache = { timestamp: 0, data: null };
        const tasks = readTasks().filter(t => t.project === proj.id && t.status !== 'archived');
        const branchInfo = getProjectBranches(repoPath, tasks, { refresh: true });
        broadcastSse('project-branch-merged', {
          projectId: proj.id,
          sourceBranch,
          targetBranch,
          commitSha: mergeRes.commitSha
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...mergeRes, projectId: proj.id, branchInfo }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Failed to merge branch' }));
      }
    });
    return;
  }

  // 查詢專案分支遠端追蹤狀態與平台資訊
  const remoteStatusMatch = req.method === 'GET' && pathname.match(/^\/api\/projects\/([^/]+)\/remote-status$/);
  if (remoteStatusMatch) {
    const projId = decodeURIComponent(remoteStatusMatch[1]).trim();
    const projects = readProjects();
    const proj = projects.find(p => p.id === projId);
    if (!proj) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }
    const repoPath = proj.path || path.join(PROJECTS_ROOT, proj.id);
    const statusInfo = getBranchRemoteStatus(repoPath, String(query.branch || '').trim(), {
      customEnv: buildCustomEnv()
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projectId: proj.id, ...statusInfo }));
    return;
  }

  // 同步遠端分支最新進度 (Fetch / Pull)
  const branchesPullMatch = req.method === 'POST' && pathname.match(/^\/api\/projects\/([^/]+)\/branches\/pull$/);
  if (branchesPullMatch) {
    const projId = decodeURIComponent(branchesPullMatch[1]).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const projects = readProjects();
        const proj = projects.find(p => p.id === projId);
        if (!proj) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Project not found' }));
          return;
        }
        const branch = String(data.branch || data.branchName || '').trim();
        const mode = data.mode === 'fetch' ? 'fetch' : 'pull';
        const rebase = data.rebase === true;
        const merge = data.merge === true;
        const repoPath = proj.path || path.join(PROJECTS_ROOT, proj.id);
        const pullRes = await fetchAndPullBranch(repoPath, branch, {
          mode,
          rebase,
          merge,
          customEnv: buildCustomEnv()
        });
        if (!pullRes.success) {
          const errStatus = (pullRes.canRetryWithRebase || pullRes.conflict || pullRes.status === 'dirty_workspace') ? 409 : 400;
          res.writeHead(errStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...pullRes, projectId: proj.id }));
          return;
        }
        gitProjectsStatusCache = { timestamp: 0, data: null };
        const tasks = readTasks().filter(t => t.project === proj.id && t.status !== 'archived');
        const branchInfo = getProjectBranches(repoPath, tasks, { refresh: true });
        broadcastSse('project-branch-pulled', {
          projectId: proj.id,
          branch: pullRes.branch,
          mode,
          remoteStatus: pullRes.remoteStatus
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...pullRes, projectId: proj.id, branchInfo }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Failed to pull branch' }));
      }
    });
    return;
  }

  // 推送指定分支至 origin 遠端
  const branchesPushMatch = req.method === 'POST' && pathname.match(/^\/api\/projects\/([^/]+)\/branches\/push$/);
  if (branchesPushMatch) {
    const projId = decodeURIComponent(branchesPushMatch[1]).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const projects = readProjects();
        const proj = projects.find(p => p.id === projId);
        if (!proj) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Project not found' }));
          return;
        }
        const branch = String(data.branch || data.branchName || '').trim();
        const taskId = String(data.taskId || '').trim();
        if (!branch) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing branch' }));
          return;
        }
        const repoPath = proj.path || path.join(PROJECTS_ROOT, proj.id);
        const pushRes = await pushBranch(repoPath, branch, { customEnv: buildCustomEnv() });
        if (!pushRes.success) {
          res.writeHead(pushRes.nonFastForward ? 409 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...pushRes, projectId: proj.id }));
          return;
        }
        const nowIso = new Date().toISOString();
        const archiveOnPush = data.archiveTasks !== false;
        const freshTasks = readTasks();
        const updatedTasks = [];
        const updatedTaskIds = [];
        const archivedTaskIds = [];
        for (const t of freshTasks) {
          if (!t || t.project !== proj.id || t.status !== 'done') continue;
          const taskBranch = (t.gitLanding?.landedBranch || t.targetBranch || t.baseBranch || '').trim();
          if ((taskId && t.id === taskId) || taskBranch === branch) {
            t.gitLanding = {
              ...(t.gitLanding || { isCommitted: true, commitSha: t.mergeCommit || '', landedBranch: branch, landedAt: nowIso }),
              pushedRemote: true,
              pushedAt: nowIso
            };
            if (archiveOnPush) {
              t.status = 'archived';
              t.archivedAt = nowIso;
              archivedTaskIds.push(t.id);
            }
            t.updatedAt = nowIso;
            updatedTasks.push(t);
            updatedTaskIds.push(t.id);
          }
        }
        if (updatedTaskIds.length > 0) {
          writeTasks(freshTasks);
          for (const t of updatedTasks) {
            broadcastSse('task-update', { taskId: t.id, status: t.status, gitLanding: t.gitLanding });
          }
        }
        gitProjectsStatusCache = { timestamp: 0, data: null };
        broadcastSse('project-branch-pushed', {
          projectId: proj.id,
          branch,
          remoteStatus: pushRes.remoteStatus,
          updatedTaskIds,
          archivedTaskIds
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...pushRes, projectId: proj.id, updatedTaskIds, archivedTaskIds }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Failed to push branch' }));
      }
    });
    return;
  }

  // 將主幹基線 (如 origin/master 或 main) 安全同步至功能分支 (Merge / Rebase)
  const branchesSyncBaseMatch = req.method === 'POST' && pathname.match(/^\/api\/projects\/([^/]+)\/branches\/sync-base$/);
  if (branchesSyncBaseMatch) {
    const projId = decodeURIComponent(branchesSyncBaseMatch[1]).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const projects = readProjects();
        const proj = projects.find(p => p.id === projId);
        if (!proj) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Project not found' }));
          return;
        }
        const repoPath = proj.path || path.join(PROJECTS_ROOT, proj.id);
        const branch = String(data.branch || data.branchName || '').trim();
        let baseBranch = String(data.baseBranch || '').trim();
        if (!baseBranch) {
          const bInfo = getProjectBranches(repoPath, [], { refresh: false });
          baseBranch = bInfo.defaultBranch || 'main';
        }
        const strategy = data.strategy === 'rebase' ? 'rebase' : 'merge';
        const syncRes = await syncBranchWithBase(repoPath, branch, baseBranch, {
          strategy,
          customEnv: buildCustomEnv()
        });
        if (!syncRes.success) {
          const errStatus = (syncRes.conflict || syncRes.status === 'dirty_workspace') ? 409 : 400;
          res.writeHead(errStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...syncRes, projectId: proj.id }));
          return;
        }
        gitProjectsStatusCache = { timestamp: 0, data: null };
        const tasks = readTasks().filter(t => t.project === proj.id && t.status !== 'archived');
        const branchInfo = getProjectBranches(repoPath, tasks, { refresh: true });
        broadcastSse('project-branch-synced', {
          projectId: proj.id,
          branch: syncRes.branch,
          baseBranch: syncRes.baseBranch,
          strategy: syncRes.strategy,
          remoteStatus: syncRes.remoteStatus
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...syncRes, projectId: proj.id, branchInfo }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Failed to sync base branch' }));
      }
    });
    return;
  }

  // 在外部編輯器或系統工具開啟專案 / Worktree (Antigravity / VS Code / Finder / Terminal)
  const openEditorMatch = req.method === 'POST' && pathname.match(/^\/api\/projects\/([^/]+)\/open-editor$/);
  if (openEditorMatch) {
    const projId = decodeURIComponent(openEditorMatch[1]).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const projects = readProjects();
        const proj = projects.find(p => p.id === projId);
        if (!proj) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Project not found' }));
          return;
        }
        const repoPath = proj.path || path.join(PROJECTS_ROOT, proj.id);
        let targetPath = '';
        if (data.taskId && data.openWorktree === true) {
          const allTasks = readTasks();
          const targetTask = allTasks.find(t => t.id === String(data.taskId).trim());
          if (targetTask && targetTask.worktreePath && fs.existsSync(targetTask.worktreePath)) {
            targetPath = targetTask.worktreePath;
          }
        } else if (data.targetPath) {
          targetPath = String(data.targetPath).trim();
        }
        const openRes = await openRepoInExternalEditor(repoPath, {
          editor: data.editor || 'antigravity',
          targetPath,
          dryRun: data.dryRun === true
        });
        res.writeHead(openRes.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...openRes, projectId: proj.id }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Failed to open external editor' }));
      }
    });
    return;
  }

  // 建立遠端 Pull Request (支援自動建立或降級網頁連結)
  const branchesPrMatch = req.method === 'POST' && pathname.match(/^\/api\/projects\/([^/]+)\/branches\/pr$/);
  if (branchesPrMatch) {
    const projId = decodeURIComponent(branchesPrMatch[1]).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const projects = readProjects();
        const proj = projects.find(p => p.id === projId);
        if (!proj) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Project not found' }));
          return;
        }
        const sourceBranch = String(data.sourceBranch || '').trim();
        const taskId = String(data.taskId || '').trim();
        if (!sourceBranch) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing sourceBranch' }));
          return;
        }
        const repoPath = proj.path || path.join(PROJECTS_ROOT, proj.id);
        let targetBranch = String(data.targetBranch || '').trim();
        if (!targetBranch) {
          targetBranch = getProjectBranches(repoPath, [], { refresh: false }).defaultBranch || 'main';
        }
        const prRes = await createPullRequest(repoPath, {
          sourceBranch,
          targetBranch,
          title: data.title,
          description: data.description,
          draft: Boolean(data.draft),
          autoPush: Boolean(data.autoPush),
          pullTargetBeforePr: data.pullTargetBeforePr !== false,
          syncStrategy: data.syncStrategy === 'rebase' ? 'rebase' : 'merge',
          customEnv: buildCustomEnv()
        });
        const archiveOnPr = data.archiveTasks !== false;
        const applyBranchPrTaskUpdates = (prUrlValue) => {
          const nowIso = new Date().toISOString();
          const freshTasks = readTasks();
          const updatedTasks = [];
          const updatedTaskIds = [];
          const archivedTaskIds = [];
          for (const t of freshTasks) {
            if (!t || t.project !== proj.id || t.status !== 'done') continue;
            const taskBranch = (t.gitLanding?.landedBranch || t.targetBranch || t.baseBranch || '').trim();
            if ((taskId && t.id === taskId) || taskBranch === sourceBranch) {
              if (prUrlValue) t.prUrl = prUrlValue;
              t.gitLanding = {
                ...(t.gitLanding || { isCommitted: true, commitSha: t.mergeCommit || '', landedBranch: sourceBranch, landedAt: nowIso }),
                pushedRemote: true,
                pushedAt: t.gitLanding?.pushedAt || nowIso,
                ...(prUrlValue ? { prUrl: prUrlValue } : {})
              };
              if (archiveOnPr) {
                t.status = 'archived';
                t.archivedAt = nowIso;
                archivedTaskIds.push(t.id);
              }
              t.updatedAt = nowIso;
              updatedTasks.push(t);
              updatedTaskIds.push(t.id);
            }
          }
          if (updatedTaskIds.length > 0) {
            writeTasks(freshTasks);
            for (const t of updatedTasks) {
              broadcastSse('task-update', { taskId: t.id, status: t.status, gitLanding: t.gitLanding, prUrl: t.prUrl });
            }
          } else if (prUrlValue) {
            // 若使用者先前已按「推送」自動封存該分支任務，補寫 prUrl 至最近已推送且尚無 prUrl 的封存紀錄
            const archivedList = readArchivedTasks();
            let archivedChanged = false;
            for (const t of archivedList) {
              if (!t || t.project !== proj.id) continue;
              const taskBranch = (t.gitLanding?.landedBranch || t.targetBranch || t.baseBranch || '').trim();
              const alreadyHasPr = Boolean(t.prUrl || t.gitLanding?.prUrl);
              if (!alreadyHasPr && ((taskId && t.id === taskId) || (taskBranch === sourceBranch && t.gitLanding?.pushedRemote))) {
                t.prUrl = prUrlValue;
                t.gitLanding = {
                  ...(t.gitLanding || { isCommitted: true, landedBranch: sourceBranch }),
                  pushedRemote: true,
                  prUrl: prUrlValue
                };
                t.updatedAt = nowIso;
                updatedTaskIds.push(t.id);
                archivedChanged = true;
              }
            }
            if (archivedChanged) {
              writeArchivedTasks(archivedList);
            }
          }
          return { updatedTaskIds, archivedTaskIds };
        };

        if (prRes.success) {
          const { updatedTaskIds, archivedTaskIds } = applyBranchPrTaskUpdates(prRes.prUrl || '');
          gitProjectsStatusCache = { timestamp: 0, data: null };
          broadcastSse('project-pr-created', {
            projectId: proj.id,
            sourceBranch,
            targetBranch,
            prUrl: prRes.prUrl,
            provider: prRes.provider,
            updatedTaskIds,
            archivedTaskIds
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...prRes, projectId: proj.id, updatedTaskIds, archivedTaskIds }));
          return;
        }
        if (prRes.degraded && prRes.fallbackCreateUrl) {
          let updatedTaskIds = [];
          let archivedTaskIds = [];
          // 若 autoPush 已成功推送至遠端，只是 PR API 降級為網頁開單，仍同步標記已推送並封存對應 done 任務
          if (Boolean(data.autoPush)) {
            const synced = applyBranchPrTaskUpdates('');
            updatedTaskIds = synced.updatedTaskIds;
            archivedTaskIds = synced.archivedTaskIds;
            gitProjectsStatusCache = { timestamp: 0, data: null };
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...prRes, projectId: proj.id, updatedTaskIds, archivedTaskIds }));
          return;
        }
        if (!prRes.success && (prRes.conflict || prRes.status === 'conflict' || prRes.status === 'dirty_workspace')) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...prRes, projectId: proj.id }));
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...prRes, projectId: proj.id }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Failed to create PR' }));
      }
    });
    return;
  }

  // 更新專案資訊 (例如 proxyUrl, name, description)
  if ((pathname === '/api/projects' || pathname.startsWith('/api/projects/')) && !pathname.endsWith('/conversations') && req.method === 'PUT') {
    let projId = (query.id || '').trim();
    if (!projId && pathname.startsWith('/api/projects/')) {
      projId = decodeURIComponent(pathname.replace('/api/projects/', '')).trim();
    }
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const updateData = JSON.parse(body);
        const targetId = projId || (updateData.id || '').trim();
        if (!targetId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing project ID' }));
          return;
        }
        let projects = readProjects();
        const idx = projects.findIndex(p => p.id === targetId || p.id === decodeURIComponent(targetId));
        if (idx === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project not found' }));
          return;
        }
        projects[idx] = { ...projects[idx], ...updateData, id: projects[idx].id };
        writeProjects(projects);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects[idx]));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 刪除專案 (僅從 Task Dashboard 取消追蹤，不刪除本機實體檔案)
  if ((pathname === '/api/projects' || pathname.startsWith('/api/projects/')) && !pathname.endsWith('/conversations') && req.method === 'DELETE') {
    let projId = (query.id || '').trim();
    if (!projId && pathname.startsWith('/api/projects/')) {
      projId = decodeURIComponent(pathname.replace('/api/projects/', '')).trim();
    }

    if (!projId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing project ID' }));
      return;
    }

    let projects = readProjects();
    const cleanId = projId;
    const exists = projects.some(p => p.id === cleanId || p.id === decodeURIComponent(cleanId));
    if (!exists) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }

    projects = projects.filter(p => p.id !== cleanId && p.id !== decodeURIComponent(cleanId));
    writeProjects(projects);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, removedId: cleanId }));
    return;
  }

  // POST 專案取消追蹤 API (優先使用 index 陣列索引精準刪除，100% 免疫字串與特殊字元編碼異常)
  if (pathname === '/api/projects/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const targetId = (data.id || '').trim();
        const rawIndex = data.index;
        const targetIndex = (typeof rawIndex === 'number') ? rawIndex : (rawIndex !== undefined && rawIndex !== null && rawIndex !== '') ? parseInt(rawIndex, 10) : NaN;

        let projects = readProjects();

        // 1. 優先透過 index 陣列索引刪除 (最為精準且完全無視字串編碼)
        if (!isNaN(targetIndex) && targetIndex >= 0 && targetIndex < projects.length) {
          const removed = projects.splice(targetIndex, 1);
          writeProjects(projects);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, removed: removed[0], method: 'index' }));
          return;
        }

        // 2. 備用方案：透過 id / name 比對 (相容 raw string, decoded string, lowerCase)
        if (targetId) {
          const initialLen = projects.length;
          projects = projects.filter(p => {
            const pid = String(p.id || '').trim();
            const pname = String(p.name || '').trim();
            return pid !== targetId &&
                   pid !== decodeURIComponent(targetId) &&
                   pname !== targetId &&
                   pname !== decodeURIComponent(targetId);
          });

          if (projects.length < initialLen) {
            writeProjects(projects);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, removedId: targetId, method: 'id' }));
            return;
          }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Project not found' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON request' }));
      }
    });
    return;
  }

  if (pathname.match(/^\/api\/projects\/([^/]+)\/conversations$/) && req.method === 'POST') {
    const projId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const projects = readProjects();
        const proj = projects.find(p => p.id === projId);
        if (!proj) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project not found' }));
          return;
        }
        if (!proj.conversations) proj.conversations = [];
        const newConv = {
          id: data.id || `conv-${Date.now()}`,
          title: data.title || '新對話紀錄',
          summary: data.summary || '',
          createdAt: new Date().toISOString()
        };
        proj.conversations.push(newConv);
        writeProjects(projects);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newConv));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 任務列表
  if (pathname === '/api/tasks' && req.method === 'GET') {
    try {
      const includeArchived = query.includeArchived === '1' || query.includeArchived === 'true';
      const activeTasks = readTasks();
      const archivedTasks = readArchivedTasks();
      const tasks = includeArchived ? [...activeTasks, ...archivedTasks] : activeTasks;
      const projects = readProjects();
      const enriched = tasks.map(t => {
        try {
          const proj = projects.find(p => p.id === t.project);
          const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, t.project || '');
          const docs = proj ? (proj.docs || []) : scanProjectGithubInfo(projPath).docs;
          const skills = proj ? (proj.skills || []) : scanProjectGithubInfo(projPath).skills;
          const harness = proj ? (proj.harness || {}) : scanProjectGithubInfo(projPath).harness;
          const sliceInfo = (t.status === 'archived' || t.status === 'done')
            ? (t.sliceInfo || undefined)
            : scanProjectWorklogAndPlan(projPath, t.id, tasks);

          let executionLog = t.executionLog || '';
          if (!executionLog) {
            const logFile = path.join(getLogsDir(), `${t.id}.log`);
            if (fs.existsSync(logFile)) {
              try { executionLog = fs.readFileSync(logFile, 'utf8'); } catch (e) {}
            }
          }
          if (executionLog && (executionLog.includes('未提供前置檢閱細節') || executionLog.includes('未提供實作步驟細節'))) {
            executionLog = formatStructuredExecutionLog(executionLog, { task: t, sliceInfo, projPath });
          }

          let item = {
            ...t,
            executionLog: executionLog || t.executionLog || '',
            projectPath: projPath,
            projectDocs: docs,
            projectSkills: skills,
            projectHarness: harness,
            sliceInfo: sliceInfo || undefined
          };

          if (t.status === 'in_progress') {
            const proc = activeCliProcesses.get(t.id);
            const now = Date.now();
            const lastUpdatedMs = (sliceInfo && sliceInfo.statusLastModifiedMs) || (t.updatedAt ? new Date(t.updatedAt).getTime() : 0);
            const stallThresholdSeconds = 600; // 10 分鐘逾時閾值
            const isStalled = lastUpdatedMs > 0 && ((now - lastUpdatedMs) / 1000 > stallThresholdSeconds);

            if (proc) {
              const elapsed = Math.max(0, Math.floor((now - proc.startTime) / 1000));
              item.liveStatus = {
                isRunning: true,
                elapsedSeconds: elapsed,
                isStalled: isStalled,
                lastUpdatedMs: lastUpdatedMs,
                currentAction: proc.lastLine || (sliceInfo && sliceInfo.currentStep) || (sliceInfo && sliceInfo.currentSliceGoal) || 'CLI Agent 正在執行中...',
                liveModifiedFiles: (proc.liveModifiedFiles && proc.liveModifiedFiles.length > 0) ? proc.liveModifiedFiles : (sliceInfo && sliceInfo.updatedFiles) || [],
                recentTail: (proc.recentLines || []).slice(-20).join('\n')
              };
            } else if (sliceInfo) {
              item.liveStatus = {
                isRunning: true,
                elapsedSeconds: 0,
                isStalled: isStalled,
                lastUpdatedMs: lastUpdatedMs,
                currentAction: sliceInfo.currentStep || sliceInfo.currentSliceGoal || 'AI Agent 正在執行切片實作...',
                liveModifiedFiles: sliceInfo.updatedFiles || [],
                recentTail: sliceInfo.evidence ? `[驗證證據]\n${sliceInfo.evidence}` : ''
              };
            }
          }
          return item;
        } catch (itemErr) {
          console.error(`Error enriching task ${t?.id}:`, itemErr);
          return t;
        }
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Archived-Count': String(archivedTasks.length),
        'Access-Control-Expose-Headers': 'X-Archived-Count'
      });
      res.end(JSON.stringify(enriched));
    } catch (routeErr) {
      console.error('Error in GET /api/tasks route:', routeErr);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
    return;
  }

  // 封存任務列表 (按需載入)
  if (pathname === '/api/tasks/archived' && req.method === 'GET') {
    try {
      const archived = readArchivedTasks();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Archived-Count': String(archived.length),
        'Access-Control-Expose-Headers': 'X-Archived-Count'
      });
      res.end(JSON.stringify(archived));
    } catch (routeErr) {
      console.error('Error in GET /api/tasks/archived route:', routeErr);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
    return;
  }

  // 輕量關聯任務摘要清單 (包含 tasks.json 與 tasks-archived.json，符合 Context Engineering 規範)
  if (pathname === '/api/tasks/dependencies-summary' && req.method === 'GET') {
    try {
      const activeTasks = readTasks();
      const archivedTasks = readArchivedTasks();
      const allTasks = [...activeTasks, ...archivedTasks];
      const targetProj = query.project ? String(query.project).trim() : null;
      let filtered = targetProj ? allTasks.filter(t => t.project === targetProj) : allTasks;
      filtered.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;
        const numA = parseInt(String(a.id).replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(String(b.id).replace(/\D/g, ''), 10) || 0;
        return numB - numA;
      });
      const summaryList = filtered.map(t => ({
        id: t.id,
        title: t.title || '',
        status: t.status || 'todo',
        project: t.project || '',
        priority: t.priority || 'P1',
        createdAt: t.createdAt || ''
      }));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Total-Count': String(summaryList.length)
      });
      res.end(JSON.stringify(summaryList));
    } catch (routeErr) {
      console.error('Error in GET /api/tasks/dependencies-summary route:', routeErr);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
    return;
  }

  // 檢查任務基線飄移與潛在合併衝突 (/drift-check)
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/drift-check$/) && req.method === 'GET') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    const tasks = readTasks();
    const archived = readArchivedTasks();
    const task = tasks.find(t => t.id === taskId) || archived.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found: ' + taskId }));
      return;
    }
    const projects = readProjects();
    const proj = projects.find(p => p.id === task.project);
    const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, task.project || '');
    const drift = checkTaskBaseDrift(projPath, task);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      taskId,
      ...drift,
      checkedAt: new Date().toISOString()
    }));
    return;
  }

  // 查詢單一任務完整 Diff (支援封存任務已抽離之 diffPath)
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/diff$/) && req.method === 'GET') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    const tasks = readTasks();
    const archived = readArchivedTasks();
    const task = tasks.find(t => t.id === taskId) || archived.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found: ' + taskId }));
      return;
    }
    let diffContent = task.diff || '';
    if (task.diffPath) {
      const fullDiffFile = path.join(resolveDataDir(), task.diffPath);
      if (fs.existsSync(fullDiffFile)) {
        try {
          diffContent = fs.readFileSync(fullDiffFile, 'utf8');
        } catch (e) {}
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: taskId, diff: diffContent, diffPath: task.diffPath || '' }));
    return;
  }

  // 查詢單一任務詳情 (支援 tasks.json 與 tasks-archived.json 並提供完整元資料)
  if (pathname.match(/^\/api\/tasks\/([^/]+)$/) && req.method === 'GET') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    const tasks = readTasks();
    const archived = readArchivedTasks();
    const task = tasks.find(t => t.id === taskId) || archived.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found: ' + taskId }));
      return;
    }
    const projects = readProjects();
    const proj = projects.find(p => p.id === task.project);
    const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, task.project || '');
    const docs = proj ? (proj.docs || []) : scanProjectGithubInfo(projPath).docs;
    const skills = proj ? (proj.skills || []) : scanProjectGithubInfo(projPath).skills;
    const harness = proj ? (proj.harness || {}) : scanProjectGithubInfo(projPath).harness;
    let diffContent = task.diff || '';
    if (!diffContent && task.diffPath) {
      const fullDiffFile = path.join(resolveDataDir(), task.diffPath);
      if (fs.existsSync(fullDiffFile)) {
        try { diffContent = fs.readFileSync(fullDiffFile, 'utf8'); } catch (e) {}
      }
    }
    let executionLog = task.executionLog || '';
    if (!executionLog) {
      const logFile = path.join(getLogsDir(), `${task.id}.log`);
      if (fs.existsSync(logFile)) {
        try { executionLog = fs.readFileSync(logFile, 'utf8'); } catch (e) {}
      }
    }
    if (executionLog && (executionLog.includes('未提供前置檢閱細節') || executionLog.includes('未提供實作步驟細節'))) {
      const sliceInfo = scanProjectWorklogAndPlan(projPath, task.id);
      executionLog = formatStructuredExecutionLog(executionLog, { task, sliceInfo, projPath });
    }
    const enriched = {
      ...task,
      diff: diffContent,
      executionLog: executionLog,
      projectPath: projPath,
      projectDocs: docs,
      projectSkills: skills,
      projectHarness: harness
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(enriched));
    return;
  }

  if (pathname === '/api/tasks' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        ['executionLog', 'executionPlan', 'description', 'feedback'].forEach(field => {
          if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'string') {
            data[field] = normalizeLogText(data[field]);
          }
        });
        const tasks = readTasks();
        const newId = getNextTaskId(tasks);
        const targetBranch = typeof data.targetBranch === 'string'
          ? data.targetBranch.trim()
          : (typeof data.baseBranch === 'string' ? data.baseBranch.trim() : '');
        const baseBranch = (typeof data.baseBranch === 'string' && data.baseBranch.trim())
          ? data.baseBranch.trim()
          : targetBranch;
        const workspaceMode = (data.workspaceMode === 'worktree' || data.workspaceMode === 'branch_stream' || data.workspaceMode === 'in_place')
          ? data.workspaceMode
          : 'worktree';
        const normalizedQuestions = normalizePendingQuestions(data.pendingQuestions);
        const awaitingInput = Boolean(normalizedQuestions.length > 0 || data.awaitingInput === true);
        const newTask = {
          id: newId,
          title: data.title,
          description: data.description || '',
          status: data.status || 'todo',
          priority: data.priority || 'P1',
          project: data.project !== undefined ? data.project : '',
          conversationId: data.conversationId || '',
          assignee: data.assignee !== undefined ? data.assignee : '',
          assignedAgent: data.assignedAgent || data.assignee || 'Antigravity',
          tags: Array.isArray(data.tags) ? data.tags : (data.tags ? data.tags.split(',').map(s => s.trim()).filter(Boolean) : []),
          dependencies: Array.isArray(data.dependencies) ? data.dependencies : (data.dependencies ? [data.dependencies] : []),
          modifiedFiles: data.modifiedFiles || [],
          diff: data.diff || '',
          executionLog: data.executionLog || '',
          feedback: data.feedback || '',
          requiresConfirmation: data.requiresConfirmation === true,
          executionPlan: data.executionPlan || '',
          pendingQuestions: normalizedQuestions,
          awaitingInput,
          clarificationHistory: Array.isArray(data.clarificationHistory) ? data.clarificationHistory : [],
          tier: data.tier || '',
          riskDoor: data.riskDoor || '',
          riskReasons: Array.isArray(data.riskReasons) ? data.riskReasons : undefined,
          scope: data.scope !== undefined ? normalizeTaskScope(data.scope) : undefined,
          targetBranch,
          baseBranch,
          workspaceMode,
          baseCommit: data.baseCommit || '',
          fixRoundCount: Number(data.fixRoundCount || 0),
          needsHuman: data.needsHuman === true,
          assumptions: data.assumptions !== undefined ? normalizeDisclosureList(data.assumptions) : undefined,
          deviations: data.deviations !== undefined ? normalizeDisclosureList(data.deviations) : undefined,
          unverified: data.unverified !== undefined ? normalizeDisclosureList(data.unverified) : undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        let workspacePrep = { queued: false };
        if (newTask.status === 'in_progress') {
          const projectsForBase = readProjects();
          const projForBase = projectsForBase.find(p => p.id === newTask.project);
          const projPathForBase = projForBase ? projForBase.path : path.join(PROJECTS_ROOT, newTask.project || '');
          workspacePrep = prepareTaskWorkspaceOnStart(projPathForBase, newTask, tasks);
        }
        tasks.push(newTask);
        writeTasks(tasks);

        // 若新增任務直接為 in_progress，同步 worklog 並觸發 CLI Agent 執行（若進入排隊或待問答確認則暫緩）
        if (newTask.status === 'in_progress') {
          const projects = readProjects();
          const proj = projects.find(p => p.id === newTask.project);
          const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, newTask.project || '');
          syncProjectWorklogForActiveTask(projPath, newTask);
          if (newTask.awaitingInput && newTask.pendingQuestions.length > 0) {
            broadcastSse('task-question', {
              taskId: newTask.id,
              title: newTask.title,
              project: newTask.project,
              count: newTask.pendingQuestions.length,
              firstQuestion: newTask.pendingQuestions[0].question || ''
            });
          } else if (!workspacePrep.queued) {
            executeTaskWithCliAgent(newTask.id);
          }
        }

        broadcastSse('task-update', { taskId: newTask.id, status: newTask.status });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newTask));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 回覆進行中任務之待確認問答 (Interactive Clarification Gate)
  const answerRouteMatch = req.method === 'POST' && pathname.match(/^\/api\/tasks\/([^/]+)\/answer$/);
  if (answerRouteMatch) {
    const taskId = decodeURIComponent(answerRouteMatch[1]).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const tasks = readTasks();
        const index = tasks.findIndex(t => t.id === taskId);
        if (index === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task not found' }));
          return;
        }

        const task = tasks[index];
        const result = formatClarificationDecisionBlock(
          task.pendingQuestions || [],
          data.answers !== undefined ? data.answers : {},
          data.feedback || ''
        );
        if (!result.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `請先回答必填確認項目：「${result.missingQuestion}」` }));
          return;
        }

        const nowIso = new Date().toISOString();
        let curDesc = String(task.description || '').trim();
        if (!curDesc.includes(result.sectionHeader)) {
          curDesc = `${curDesc}\n\n${result.sectionHeader}\n${result.entryBlock}`.trim();
        } else {
          curDesc = `${curDesc}\n\n${result.entryBlock}`.trim();
        }
        task.description = curDesc;

        task.clarificationHistory = Array.isArray(task.clarificationHistory) ? task.clarificationHistory : [];
        task.clarificationHistory.push(result.historyEntry);

        const prevLog = normalizeLogText(task.executionLog);
        task.executionLog = `${prevLog}\n[${nowIso}] 💬 [Clarification Gate] ${result.logSummary}\n----------------------------------------\n`;

        task.pendingQuestions = [];
        task.awaitingInput = false;
        task.feedback = '';
        if (typeof data.executionPlan === 'string' && data.executionPlan.trim()) {
          task.executionPlan = data.executionPlan.trim();
        }
        if (data.confirmExecution === true || task.requiresConfirmation === true) {
          task.requiresConfirmation = false;
        }
        task.claimedBy = null;
        task.claimedAt = null;
        task.status = 'in_progress';
        task.updatedAt = nowIso;

        const projectsForStart = readProjects();
        const projForStart = projectsForStart.find(p => p.id === task.project);
        const projPathForStart = projForStart ? projForStart.path : path.join(PROJECTS_ROOT, task.project || '');
        const workspacePrep = prepareTaskWorkspaceOnStart(projPathForStart, task, tasks);
        writeTasks(tasks);

        appendTaskEvent({
          taskId,
          type: 'clarification_answered',
          count: result.historyEntry.items.length
        });
        broadcastSse('task-update', { taskId, status: 'in_progress' });
        if (!workspacePrep.queued) {
          executeTaskWithCliAgent(taskId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Invalid JSON' }));
      }
    });
    return;
  }

  // 任務修改 (狀態變更、拖曳卡片)
  if (pathname.startsWith('/api/tasks/') && (req.method === 'PUT' || req.method === 'PATCH')) {
    const taskId = decodeURIComponent(pathname.replace('/api/tasks/', '')).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        ['executionLog', 'executionPlan', 'description', 'feedback'].forEach(field => {
          if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'string') {
            data[field] = normalizeLogText(data[field]);
          }
        });
        const tasks = readTasks();
        let index = tasks.findIndex(t => t.id === taskId);
        let fromArchived = false;
        let archivedList = null;
        if (index === -1) {
          archivedList = readArchivedTasks();
          const archIdx = archivedList.findIndex(t => t.id === taskId);
          if (archIdx !== -1) {
            fromArchived = true;
            const archTask = { ...archivedList[archIdx] };
            archivedList.splice(archIdx, 1);
            tasks.push(archTask);
            index = tasks.length - 1;
          }
        }
        if (index === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task not found' }));
          return;
        }
        const prevTaskBeforeUpdate = { ...tasks[index] };
        const prevStatus = tasks[index].status;
        const prevFeedback = tasks[index].feedback;

        // [Code over LLM] 確定性程式碼自動組裝標準 4 章節任務執行報告 (支援別名欄位與 Harness 智慧提取)
        const hasStructuredReportFields = Boolean(
          data.autoAssembleReport ||
          (data.rootCause && data.resolution) ||
          (data.objective && (data.keyChanges || data.testCommand)) ||
          data.summary ||
          data.impactAnalysis ||
          data.verifyResult ||
          data.preFlightSummary ||
          data.implementation
        );
        if (hasStructuredReportFields) {
          const projects = readProjects();
          const proj = projects.find(p => p.id === tasks[index].project);
          const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, tasks[index].project || '');
          const sliceInfo = scanProjectWorklogAndPlan(projPath, taskId);
          const coverageStr = extractCoverageSummary(projPath);
          data.executionLog = autoAssembleExecutionReport(tasks[index], data, {
            sliceInfo,
            projPath,
            coverage: coverageStr
          });
        }

        // [Slice Judge Gate] 若將狀態推進至 review，非手動強制推進 (forceReview !== true) 時強制檢驗 executionLog
        if (data.status === 'review' && prevStatus !== 'review' && !data.forceReview) {
          // [Clarification Gate] 若仍有未回答之 pendingQuestions，嚴禁推進至 review
          const stillHasPendingQuestions = data.pendingQuestions === undefined
            ? isTaskAwaitingClarification(tasks[index])
            : normalizePendingQuestions(data.pendingQuestions).length > 0;
          if (stillHasPendingQuestions) {
            appendTaskEvent({
              taskId,
              type: 'review_gate_rejected',
              shimId: 'GATE-002',
              reason: 'Task has unanswered pendingQuestions awaiting user clarification.'
            });
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Clarification gate failed: task has unanswered pendingQuestions. Wait for user confirmation before promoting to review.',
              reason: 'pendingQuestions unanswered.'
            }));
            return;
          }

          // [Confirmation Gate] 若任務 requiresConfirmation 為 true 且尚未確認 (confirmExecution !== true 且 data.requiresConfirmation !== false)，嚴禁推進至 review
          if (tasks[index].requiresConfirmation && data.requiresConfirmation !== false && !data.confirmExecution) {
            appendTaskEvent({
              taskId,
              type: 'review_gate_rejected',
              shimId: 'GATE-002',
              reason: 'Task requires confirmation before implementation. Plan must be confirmed by user.'
            });
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Confirmation gate failed: task has requiresConfirmation: true and has not been confirmed by user. You must formulate executionPlan and remain in in_progress waiting for user confirmation.',
              reason: 'requiresConfirmation is true and unconfirmed.'
            }));
            return;
          }

          // 檢驗 exitCode：若顯式傳入非 0 exitCode，嚴格拒絕推進 review
          if (data.exitCode !== undefined && data.exitCode !== null && Number(data.exitCode) !== 0) {
            const curRounds = Number(tasks[index].fixRoundCount || 0);
            if (curRounds >= 2) {
              tasks[index].status = 'needs_human';
              tasks[index].needsHuman = true;
              tasks[index].claimedBy = null;
              tasks[index].claimedAt = null;
              writeTasks(tasks);
              appendTaskEvent({
                taskId,
                type: 'fix_round_circuit_break',
                fixRoundCount: curRounds,
                reason: `exitCode ${data.exitCode} failed after ${curRounds} fix rounds`
              });
            } else {
              appendTaskEvent({
                taskId,
                type: 'review_gate_rejected',
                shimId: 'GATE-001',
                reason: `exitCode ${data.exitCode} is non-zero`
              });
            }
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Review gate failed: exitCode is non-zero, verification must pass before review promotion.',
              reason: `Exit code is ${data.exitCode}, verification failed.`,
              needsHuman: curRounds >= 2
            }));
            return;
          }

          const logToCheck = data.executionLog !== undefined ? data.executionLog : tasks[index].executionLog;
          const valResult = validateExecutionLog(logToCheck);
          if (!valResult.valid) {
            appendTaskEvent({
              taskId,
              type: 'review_gate_rejected',
              shimId: 'GATE-001',
              reason: valResult.reason
            });
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Review gate failed: executionLog does not satisfy binary acceptance criteria.',
              reason: valResult.reason
            }));
            return;
          }
        }

        // 若前次已有未清空的 feedback，且本次傳入新的 feedback（例如多次退回重做）
        if (prevFeedback && typeof prevFeedback === 'string' && prevFeedback.trim().length > 0 &&
            data.feedback && typeof data.feedback === 'string' && data.feedback.trim() !== prevFeedback.trim()) {
          consumeTaskFeedback(tasks[index]);
        }

        // TD-S3: 單卡 2 輪失敗熔斷 (由 review 退回時累計 fixRoundCount，達 2 輪立即鎖定 needs_human)
        const isReviewRejection = prevStatus === 'review' && (data.status === 'in_progress' || data.status === 'todo');
        let circuitBreakerTriggered = false;
        if (isReviewRejection) {
          const nextFixRound = Number(prevTaskBeforeUpdate.fixRoundCount || 0) + 1;
          data.fixRoundCount = nextFixRound;
          if (nextFixRound >= 2) {
            data.status = 'needs_human';
            data.needsHuman = true;
            data.claimedBy = null;
            data.claimedAt = null;
            circuitBreakerTriggered = true;
          }
        }
        if (data.resetCircuitBreaker === true) {
          data.fixRoundCount = 0;
          data.needsHuman = false;
        } else if (prevStatus === 'needs_human' && data.status === 'in_progress' && data.fixRoundCount === undefined && data.needsHuman !== false) {
          data.status = 'needs_human';
          data.needsHuman = true;
          data.claimedBy = null;
          data.claimedAt = null;
        }

        const normalizedScope = data.scope !== undefined ? normalizeTaskScope(data.scope) : tasks[index].scope;
        const normalizedAssumptions = data.assumptions !== undefined ? normalizeDisclosureList(data.assumptions) : tasks[index].assumptions;
        const normalizedDeviations = data.deviations !== undefined ? normalizeDisclosureList(data.deviations) : tasks[index].deviations;
        const normalizedUnverified = data.unverified !== undefined ? normalizeDisclosureList(data.unverified) : tasks[index].unverified;

        const nextTargetBranch = data.targetBranch !== undefined
          ? String(data.targetBranch || '').trim()
          : (data.baseBranch !== undefined
            ? String(data.baseBranch || '').trim()
            : (tasks[index].targetBranch !== undefined ? tasks[index].targetBranch : (tasks[index].baseBranch || '')));
        const nextBaseBranch = (data.baseBranch !== undefined && String(data.baseBranch || '').trim())
          ? String(data.baseBranch || '').trim()
          : (data.targetBranch !== undefined ? nextTargetBranch : (tasks[index].baseBranch || nextTargetBranch));
        const rawMode = data.workspaceMode !== undefined ? data.workspaceMode : tasks[index].workspaceMode;
        const nextWorkspaceMode = (rawMode === 'worktree' || rawMode === 'branch_stream' || rawMode === 'in_place')
          ? rawMode
          : 'worktree';

        if (data.pendingQuestions !== undefined) {
          data.pendingQuestions = normalizePendingQuestions(data.pendingQuestions);
          data.awaitingInput = data.pendingQuestions.length > 0;
        } else if (data.confirmExecution === true) {
          data.pendingQuestions = [];
          data.awaitingInput = false;
        }

        tasks[index] = {
          ...tasks[index],
          ...data,
          id: taskId,
          targetBranch: nextTargetBranch,
          baseBranch: nextBaseBranch,
          workspaceMode: nextWorkspaceMode,
          scope: normalizedScope,
          assumptions: normalizedAssumptions,
          deviations: normalizedDeviations,
          unverified: normalizedUnverified,
          tags: Array.isArray(data.tags) ? data.tags : (data.tags ? data.tags.split(',').map(s => s.trim()).filter(Boolean) : tasks[index].tags),
          dependencies: data.dependencies !== undefined ? (Array.isArray(data.dependencies) ? data.dependencies : [data.dependencies]) : (tasks[index].dependencies || []),
          modifiedFiles: Array.isArray(data.modifiedFiles) ? data.modifiedFiles : (tasks[index].modifiedFiles || []),
          updatedAt: new Date().toISOString()
        };
        delete tasks[index].resetCircuitBreaker;

        if (data.claimedBy !== undefined && data.claimedBy !== prevTaskBeforeUpdate.claimedBy) {
          tasks[index].claimedBy = data.claimedBy || null;
          tasks[index].claimedAt = data.claimedBy ? new Date().toISOString() : null;
        }

        // 若狀態切換為 todo 或 needs_human（非 in_progress），清除認領鎖定
        if (tasks[index].status === 'todo' || tasks[index].status === 'needs_human') {
          tasks[index].claimedBy = null;
          tasks[index].claimedAt = null;
        }

        // 若更新後狀態為 review、done 或 archived，確保 feedback 已被消耗並寫入描述歷史
        if (tasks[index].status === 'review' || tasks[index].status === 'done' || tasks[index].status === 'archived') {
          consumeTaskFeedback(tasks[index]);
          if (tasks[index].status === 'review' || tasks[index].status === 'done') {
            // 若勾選需確認後再執行，確保進入 review/done 時 executionPlan 不為空以符合品質閘門
            if (tasks[index].requiresConfirmation && (!tasks[index].executionPlan || !tasks[index].executionPlan.trim())) {
              tasks[index].executionPlan = '1. 依據需求擬定架構與驗證方案\n2. 執行代碼實作與單元測試\n3. 通過品質驗證並交付審查';
            }
          }
          if (tasks[index].status === 'review') {
            const projects = readProjects();
            const proj = projects.find(p => p.id === tasks[index].project);
            const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, tasks[index].project || '');
            const coverageStr = extractCoverageSummary(projPath);
            let phase3Option = '驗證命令、退出碼與結果請參閱實際執行記錄；未提供者不視為驗證通過。';
            if (coverageStr) {
              phase3Option += `\n- 單元測試覆蓋率: ${coverageStr}`;
            }
            const sliceInfo = scanProjectWorklogAndPlan(projPath, taskId);
            if (tasks[index].executionLog) {
              tasks[index].executionLog = formatStructuredExecutionLog(tasks[index].executionLog, {
                phase3: phase3Option,
                task: tasks[index],
                payload: data,
                sliceInfo,
                projPath,
                coverage: coverageStr
              });
            }
          }
        }
        if (fromArchived && archivedList) {
          writeArchivedTasks(archivedList);
        }
        writeTasks(tasks);

        // [Append-only Event Log] 紀錄狀態轉移與認領事件
        if (circuitBreakerTriggered) {
          appendTaskEvent({
            taskId,
            type: 'fix_round_circuit_break',
            fixRoundCount: tasks[index].fixRoundCount,
            fromStatus: prevStatus,
            toStatus: 'needs_human',
            feedback: data.feedback || ''
          });
        }
        if (prevStatus !== tasks[index].status) {
          appendTaskEvent({
            taskId,
            type: 'status_transition',
            fromStatus: prevStatus,
            toStatus: tasks[index].status,
            claimedBy: tasks[index].claimedBy || null
          });
        }
        if (data.claimedBy && data.claimedBy !== prevTaskBeforeUpdate.claimedBy) {
          appendTaskEvent({
            taskId,
            type: 'task_claimed',
            claimedBy: tasks[index].claimedBy,
            claimedAt: tasks[index].claimedAt
          });
        }

        const wasPendingConfirmation = prevTaskBeforeUpdate.requiresConfirmation && prevTaskBeforeUpdate.status === 'in_progress';
        const isNowConfirmedAndRunning = tasks[index].status === 'in_progress' && !tasks[index].requiresConfirmation;
        const isStatusTransitionToInProgress = tasks[index].status === 'in_progress' && prevStatus !== 'in_progress';
        const isConfirmedExecutionTrigger = wasPendingConfirmation && isNowConfirmedAndRunning;

        // 若狀態切換為 in_progress，或是由「待確認」點選「確認並執行」，清除前次殘留產出物並啟動執行！
        if (isStatusTransitionToInProgress || isConfirmedExecutionTrigger || data.confirmExecution === true) {
          if (data.diff === undefined) tasks[index].diff = '';
          if (data.modifiedFiles === undefined) tasks[index].modifiedFiles = [];
          tasks[index].commitMessage = null;
          tasks[index].requestCommitGen = false;
          // 若為確認執行觸發，釋放 planning 階段的認領鎖定，使背景守候中的哨兵或 CLI 能夠立即認領
          if (isConfirmedExecutionTrigger || data.confirmExecution === true) {
            tasks[index].claimedBy = null;
            tasks[index].claimedAt = null;

            // [Confirmation Gate 雙層防禦]：若仍有殘留 feedback，自動吸收進 description 並清空 feedback，避免誤觸 isRedo
            const pendingFeedback = String(data.feedback !== undefined ? data.feedback : (tasks[index].feedback || '')).trim();
            if (pendingFeedback) {
              const timeStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
              const formattedLines = pendingFeedback.split('\n')
                .map(l => l.trim())
                .filter(Boolean)
                .map(l => l.startsWith('- ') ? l : `- ${l}`)
                .join('\n');
              const sectionHeader = '--- 【執行計劃確認意見 / 最新需求覆蓋】 ---';
              const directive = '> ⚠️ 【最高優先級覆蓋規範】：本區塊為使用者審閱執行計劃後的最新授權指示。若與上方舊有需求存在矛盾、衝突或規格調整，一律以本區塊最新指示為準並覆蓋舊有描述！';
              let curDesc = String(tasks[index].description || '').trim();

              if (!curDesc.includes(pendingFeedback)) {
                if (!curDesc.includes(sectionHeader)) {
                  tasks[index].description = `${curDesc}\n\n${sectionHeader}\n[${timeStr}]\n${directive}\n${formattedLines}`.trim();
                } else {
                  tasks[index].description = `${curDesc}\n\n[${timeStr}]\n${directive}\n${formattedLines}`.trim();
                }
              }
            }
            tasks[index].feedback = '';
          }
          // TD-S2 / TASK-233: 統一開工隔離與排隊互斥檢查
          let workspacePrep = { queued: false };
          if (tasks[index].status === 'in_progress') {
            const projectsForStart = readProjects();
            const projForStart = projectsForStart.find(p => p.id === tasks[index].project);
            const projPathForStart = projForStart ? projForStart.path : path.join(PROJECTS_ROOT, tasks[index].project || '');
            workspacePrep = prepareTaskWorkspaceOnStart(projPathForStart, tasks[index], tasks);
          }
          writeTasks(tasks);
          if (tasks[index].status === 'in_progress' && !workspacePrep.queued && !isTaskAwaitingClarification(tasks[index])) {
            executeTaskWithCliAgent(taskId);
          }
        }

        // 若於進行中提交了新的 pendingQuestions，確保標記 awaitingInput、記錄事件並廣播 task-question
        const updatedPendingQuestions = Array.isArray(tasks[index].pendingQuestions) ? tasks[index].pendingQuestions : [];
        if (
          tasks[index].status === 'in_progress' &&
          updatedPendingQuestions.length > 0 &&
          JSON.stringify(prevTaskBeforeUpdate.pendingQuestions || []) !== JSON.stringify(updatedPendingQuestions)
        ) {
          tasks[index].awaitingInput = true;
          writeTasks(tasks);
          appendTaskEvent({
            taskId,
            type: 'clarification_requested',
            count: updatedPendingQuestions.length
          });
          broadcastSse('task-question', {
            taskId,
            title: tasks[index].title,
            project: tasks[index].project,
            count: updatedPendingQuestions.length,
            firstQuestion: updatedPendingQuestions[0]?.question || ''
          });
        }

        // 若任務離開 in_progress，清理自身 queueState 並自動解除被此任務阻塞的排隊任務
        if (prevStatus === 'in_progress' && tasks[index].status !== 'in_progress') {
          tasks[index].queueState = null;
          const waitingTasks = tasks.filter(t => t && t.id !== taskId && t.status === 'in_progress' && t.queueState && t.queueState.blockedByTaskId === taskId);
          if (waitingTasks.length > 0) {
            const projectsForUnblock = readProjects();
            const unblockedIds = [];
            for (const waitingTask of waitingTasks) {
              const wProj = projectsForUnblock.find(p => p.id === waitingTask.project);
              const wProjPath = wProj ? wProj.path : path.join(PROJECTS_ROOT, waitingTask.project || '');
              const wPrep = prepareTaskWorkspaceOnStart(wProjPath, waitingTask, tasks);
              if (!wPrep.queued) {
                unblockedIds.push(waitingTask.id);
              }
            }
            writeTasks(tasks);
            for (const unblockedId of unblockedIds) {
              broadcastSse('task-update', { taskId: unblockedId, status: 'in_progress' });
              executeTaskWithCliAgent(unblockedId);
            }
          } else {
            writeTasks(tasks);
          }
        }

        // 若狀態切換為 review 或 done（無論是手動拖曳、驗收結案或 API 呼叫），自動補齊目標專案 (或 Worktree) 的 Git Diff 與 Commit Message
        if ((tasks[index].status === 'review' || tasks[index].status === 'done') && prevStatus !== tasks[index].status) {
          const projects = readProjects();
          const proj = projects.find(p => p.id === tasks[index].project);
          const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, tasks[index].project || '');
          const gitTargetDir = resolveTaskGitWorkDir(tasks[index], projPath, { preferMainIfWorktreeUntouched: true });
          const customEnv = buildCustomEnv();
          collectGitDiff(gitTargetDir, customEnv, (modifiedList, diffContent) => {
            const freshTasks = readTasks();
            const freshTask = freshTasks.find(t => t.id === taskId);
            if (freshTask) {
              freshTask.modifiedFiles = modifiedList;
              freshTask.diff = diffContent;
              const risk = calculateRiskDoor(modifiedList, diffContent);
              if (!freshTask.riskDoor || freshTask.riskDoor === 'two-way') {
                freshTask.riskDoor = risk.riskDoor;
                freshTask.riskReasons = risk.riskReasons;
              }
              const isLegacyDesc = freshTask.commitMessage && freshTask.description && freshTask.commitMessage.body && freshTask.commitMessage.body.trim() === freshTask.description.trim();
              const hasBoilerplateBody = freshTask.commitMessage && freshTask.commitMessage.body && (
                freshTask.commitMessage.body.includes('後端服務邏輯調校與開工引擎強化') ||
                freshTask.commitMessage.body.includes('前端面板視圖與彈窗互動優化') ||
                freshTask.commitMessage.body.includes('補齊自動化測試與規範檢核腳本') ||
                freshTask.commitMessage.body.includes('程式碼與架構規範檢驗通過') ||
                freshTask.commitMessage.body.includes('模組功能實作與異動更新')
              );
              if (!freshTask.commitMessage || !freshTask.commitMessage.subject || isLegacyDesc || hasBoilerplateBody || freshTask.requestCommitGen) {
                const commitMsg = formatCommitMessageFromSkill(projPath, freshTask, diffContent, modifiedList);
                freshTask.commitMessage = {
                  subject: commitMsg.message,
                  body: commitMsg.body || ''
                };
              }
              freshTask.requestCommitGen = false;
              writeTasks(freshTasks);
              syncToMarkdown(freshTasks);
              console.log(' [開工引擎] 任務 ' + taskId + ' 自動收集 Git 變更 (' + modifiedList.length + ' 個檔案) 與 Commit 訊息完畢！');
            }
          }, { baseCommit: tasks[index].baseCommit, baseBranch: tasks[index].baseBranch });
        }

        const projects = readProjects();
        const proj = projects.find(p => p.id === tasks[index].project);
        const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, tasks[index].project || '');

        if (tasks[index].status === 'in_progress') {
          syncProjectWorklogForActiveTask(projPath, tasks[index]);
        } else if (tasks[index].status === 'review' && prevStatus !== 'review') {
          syncProjectWorklogOnReview(projPath, tasks[index]);
        } else if (tasks[index].status === 'done' && prevStatus !== 'done') {
          syncProjectWorklogOnDone(projPath, tasks[index]);
        }
        const sliceInfo = scanProjectWorklogAndPlan(projPath, taskId);

        let responseTask = {
          ...tasks[index],
          projectPath: projPath,
          sliceInfo: sliceInfo || undefined
        };

        if (tasks[index].status === 'in_progress') {
          const proc = activeCliProcesses.get(taskId);
          if (proc) {
            const elapsed = Math.round((Date.now() - proc.startTime) / 1000);
            responseTask.liveStatus = {
              isRunning: true,
              elapsedSeconds: elapsed,
              currentAction: proc.lastLine || (sliceInfo && sliceInfo.currentStep) || (sliceInfo && sliceInfo.currentSliceGoal) || 'CLI Agent 正在執行中...',
              liveModifiedFiles: (proc.liveModifiedFiles && proc.liveModifiedFiles.length > 0) ? proc.liveModifiedFiles : (sliceInfo && sliceInfo.updatedFiles) || [],
              recentTail: (proc.recentLines || []).slice(-20).join('\n')
            };
          } else if (sliceInfo) {
            responseTask.liveStatus = {
              isRunning: true,
              elapsedSeconds: 0,
              currentAction: sliceInfo.currentStep || sliceInfo.currentSliceGoal || 'AI Agent 正在執行切片實作...',
              liveModifiedFiles: sliceInfo.updatedFiles || [],
              recentTail: sliceInfo.evidence ? `[驗證證據]\n${sliceInfo.evidence}` : ''
            };
          }
        }

        broadcastSse('task-update', { taskId, status: tasks[index].status });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseTask));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 取得任務執行實體日誌 (即時日誌檢視)
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/log$/) && req.method === 'GET') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    const logFile = path.join(getLogsDir(), `${taskId}.log`);
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Log not found for ' + taskId }));
    }
    return;
  }

  // 取得任務切片詳情 (Active Slice & Build Plan)
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/slice-info$/) && req.method === 'GET') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId) || readArchivedTasks().find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found: ' + taskId }));
      return;
    }
    const projects = readProjects();
    const proj = projects.find(p => p.id === task.project);
    const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, task.project || '');
    const sliceInfo = scanProjectWorklogAndPlan(projPath, task.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sliceInfo || {}));
    return;
  }

  // 手動觸發 CLI Agent 執行指定任務
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/trigger-agent$/) && req.method === 'POST') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    executeTaskWithCliAgent(taskId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: `CLI Agent 已觸發任務 ${taskId}` }));
    return;
  }

  // Git Commit
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/commit$/) && req.method === 'POST') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    let reqBody = '';
    req.on('data', chunk => { reqBody += chunk; });
    req.on('end', () => {
      let customData = {};
      try {
        if (reqBody.trim()) customData = JSON.parse(reqBody);
      } catch (e) {}

      const tasks = readTasks();
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found' }));
        return;
      }
      const projects = readProjects();
      const proj = projects.find(p => p.id === task.project);
      const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, task.project || '');

      let commitOutput = 'Commit 已觸發';
      let isCommitted = false;
      let hasError = false;
      try {
        const resObj = executeProjectCommit(projPath, task, customData);
        commitOutput = resObj.output;
        isCommitted = !!resObj.isCommitted;
        hasError = !!resObj.hasError;
      } catch (err) {
        commitOutput = [err.stderr ? err.stderr.toString() : '', err.stdout ? err.stdout.toString() : '', err.message].filter(Boolean).join('\n\n') || '已處理 Commit';
        isCommitted = false;
        hasError = true;
      }

      // 若 commit 失敗或被 pre-commit 阻斷，嚴格禁止將任務狀態變更為 archived，保留原始狀態並回傳 400
      if (hasError || !isCommitted) {
        const sub = (customData.customSubject || customData.subject || '').trim();
        const bod = (customData.customBody !== undefined ? customData.customBody : (customData.body !== undefined ? customData.body : '')).trim();
        if (sub || bod) {
          task.commitMessage = {
            subject: sub || (task.commitMessage && task.commitMessage.subject) || '',
            body: bod !== undefined ? bod : (task.commitMessage && task.commitMessage.body) || ''
          };
          writeTasks(tasks);
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          isCommitted: false,
          error: commitOutput,
          message: commitOutput,
          archivedTaskIds: []
        }));
        return;
      }

      // commit 成功後僅封存本次提交之任務（及顯式 coLandTaskIds），不連坐封存同專案其他 done 任務
      const archivedIds = [];
      const nowIso = new Date().toISOString();
      let commitSha = '';
      let landedBranch = task.targetBranch || task.baseBranch || '';
      if (projPath && fs.existsSync(path.join(projPath, '.git'))) {
        try {
          commitSha = execFileSync('git', ['-C', projPath, 'rev-parse', '--verify', 'HEAD'], {
            encoding: 'utf8',
            timeout: 5000
          }).trim();
          const bInfo = getGitBranchInfo(projPath);
          if (bInfo && bInfo.branch) landedBranch = bInfo.branch;
        } catch (_) {}
      }
      const coLandIds = Array.isArray(customData.coLandTaskIds)
        ? customData.coLandTaskIds.map(id => String(id).trim()).filter(Boolean)
        : [];
      const targetLandIds = new Set([task.id, ...coLandIds]);

      tasks.forEach(t => {
        if (targetLandIds.has(t.id) && (t.project === task.project || (!t.project && !task.project))) {
          t.status = 'archived';
          t.updatedAt = nowIso;
          t.gitLanding = {
            isCommitted: true,
            commitSha,
            landedBranch,
            landedAt: nowIso,
            pushedRemote: false,
            prUrl: ''
          };
          archivedIds.push(t.id);
        }
      });
      writeTasks(tasks);
      gitProjectsStatusCache = { timestamp: 0, data: null };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, isCommitted: true, message: commitOutput, output: commitOutput, commitSha, landedBranch, archivedTaskIds: archivedIds }));
    });
    return;
  }

  // 合一通過並提交 (/api/tasks/:taskId/land)：依 workspaceMode 分流提交或合併、寫入 gitLanding、精準單卡結案並解除排隊阻塞
  const landMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/land$/) && req.method === 'POST';
  if (landMatch) {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    let reqBody = '';
    req.on('data', chunk => { reqBody += chunk; });
    req.on('end', async () => {
      let bodyData = {};
      try {
        if (reqBody.trim()) bodyData = JSON.parse(reqBody);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
        return;
      }

      const tasks = readTasks();
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Task not found' }));
        return;
      }

      const projects = readProjects();
      const proj = projects.find(p => p.id === task.project);
      const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, task.project || '');
      const isGitRepo = Boolean(projPath && fs.existsSync(projPath) && fs.existsSync(path.join(projPath, '.git')));
      const workspaceMode = task.workspaceMode || (task.worktreePath ? 'worktree' : 'in_place');
      const archiveImmediately = Boolean(bodyData.archiveImmediately);
      const targetStatus = archiveImmediately ? 'archived' : 'done';
      const sub = String(bodyData.subject || bodyData.customSubject || '').trim();
      const bod = bodyData.body !== undefined
        ? String(bodyData.body).trim()
        : (bodyData.customBody !== undefined ? String(bodyData.customBody).trim() : undefined);

      let commitSha = '';
      let landedBranch = task.targetBranch || task.baseBranch || '';
      let pushedRemote = false;
      let prUrl = '';
      let outputMsg = '已通過並提交';
      let shouldFallbackToInPlace = false;

      try {
        if (isGitRepo) {
          const customEnv = buildCustomEnv();
          const effectiveWorktreePath = task.worktreePath || `${projPath.replace(/\/+$/, '')}.worktrees/${taskId}`;
          const hasPhysicalWorktree = Boolean(effectiveWorktreePath && fs.existsSync(effectiveWorktreePath));
          const wtUntouched = hasPhysicalWorktree ? isWorktreeUntouched(projPath, effectiveWorktreePath, task, customEnv) : true;
          const mainRealDirty = getRealDirtyFiles(projPath, customEnv);
          shouldFallbackToInPlace = workspaceMode === 'worktree' && wtUntouched && (!hasPhysicalWorktree || mainRealDirty.length > 0);

          if (workspaceMode === 'worktree' && hasPhysicalWorktree && !shouldFallbackToInPlace) {
            const taskForMerge = { ...task };
            if (sub || bod !== undefined) {
              taskForMerge.commitMessage = {
                subject: sub || (task.commitMessage && task.commitMessage.subject) || '',
                body: bod !== undefined ? bod : ((task.commitMessage && task.commitMessage.body) || '')
              };
            }
            const mergeResult = await mergeTaskWorktree({
              repoPath: projPath,
              taskId,
              task: taskForMerge,
              baseBranch: task.targetBranch || task.baseBranch,
              verifyCommand: bodyData.verifyCommand || (proj && proj.verifyCommand) || '',
              confirmOneWayMerge: Boolean(bodyData.confirmOneWayMerge),
              mode: bodyData.mode || '',
              customEnv
            });

            if (mergeResult && mergeResult.merged === true) {
              commitSha = mergeResult.mergeCommit || '';
              landedBranch = mergeResult.baseBranch || landedBranch;
              if (!commitSha && landedBranch) {
                try {
                  commitSha = execFileSync('git', ['-C', projPath, 'rev-parse', '--verify', landedBranch], {
                    encoding: 'utf8',
                    timeout: 5000
                  }).trim();
                } catch (_) {}
              }
              outputMsg = `Worktree 已安全合併至 ${landedBranch || '主分支'}`;
            } else {
              const statusCode =
                (mergeResult && mergeResult.status === 'verification_failed') ? 422 :
                (mergeResult && (mergeResult.status === 'conflict' || mergeResult.status === 'rebase_conflict' || mergeResult.status === 'dirty_main_workspace' || mergeResult.status === 'one_way_requires_confirmation')) ? 409 :
                400;
              if (mergeResult && (mergeResult.status === 'conflict' || mergeResult.status === 'rebase_conflict')) {
                appendTaskEvent({ taskId, type: 'merge_conflict', baseBranch: mergeResult.baseBranch, branchName: mergeResult.branchName });
              } else if (mergeResult && mergeResult.status === 'verification_failed') {
                appendTaskEvent({ taskId, type: 'merge_verification_failed', baseBranch: mergeResult.baseBranch, exitCode: mergeResult.exitCode });
              }
              res.writeHead(statusCode, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ...(mergeResult || {}), success: false, merged: false, isCommitted: false, taskId }));
              return;
            }
          } else {
            if (shouldFallbackToInPlace && hasPhysicalWorktree) {
              removeTaskWorktree(projPath, taskId, {
                branchName: task.branchName || `td/${taskId}`,
                worktreePath: effectiveWorktreePath
              });
            }
            const commitRes = await withRepoMergeLock(projPath, async () => {
              return executeProjectCommit(projPath, task, {
                subject: sub,
                body: bod
              });
            });
            if (commitRes.hasError || !commitRes.isCommitted) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                isCommitted: false,
                taskId,
                error: commitRes.output || 'Git Commit 執行失敗',
                message: commitRes.output || 'Git Commit 執行失敗'
              }));
              return;
            }
            outputMsg = commitRes.output || outputMsg;
            try {
              commitSha = execFileSync('git', ['-C', projPath, 'rev-parse', '--verify', 'HEAD'], {
                encoding: 'utf8',
                timeout: 5000
              }).trim();
            } catch (_) {}
            const bInfo = getGitBranchInfo(projPath);
            if (bInfo && bInfo.branch) landedBranch = bInfo.branch;
          }
        } else {
          outputMsg = '專案非 Git 儲存庫，已直接標記結案';
        }
      } catch (landErr) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          isCommitted: false,
          taskId,
          error: landErr && landErr.message ? landErr.message : '提交失敗'
        }));
        return;
      }

      // 重新讀取最新 tasks.json 並僅更新本次任務（及顯式 coLandTaskIds），絕不連坐其他 done 任務
      const freshTasks = readTasks();
      const nowIso = new Date().toISOString();
      const coLandIds = Array.isArray(bodyData.coLandTaskIds)
        ? bodyData.coLandTaskIds.map(id => String(id).trim()).filter(Boolean)
        : [];
      const targetLandIds = new Set([taskId, ...coLandIds]);
      const landedTaskIds = [];
      const unblockedTaskIds = [];
      let primaryGitLanding = null;

      freshTasks.forEach(t => {
        const sameProject = (t.project === task.project || (!t.project && !task.project));
        if (targetLandIds.has(t.id) && (t.id === taskId || sameProject)) {
          const landingObj = {
            isCommitted: true,
            commitSha,
            landedBranch,
            landedAt: nowIso,
            pushedRemote,
            prUrl
          };
          t.status = targetStatus;
          t.updatedAt = nowIso;
          t.gitLanding = landingObj;
          if (sub || bod !== undefined) {
            t.commitMessage = {
              subject: sub || (t.commitMessage && t.commitMessage.subject) || '',
              body: bod !== undefined ? bod : ((t.commitMessage && t.commitMessage.body) || '')
            };
          }
          if (shouldFallbackToInPlace && t.id === taskId) {
            t.workspaceMode = 'in_place';
            t.worktreePath = null;
          } else if (workspaceMode === 'worktree' && t.id === taskId) {
            t.mergeStatus = 'merged';
            t.mergedAt = nowIso;
            t.mergeCommit = commitSha;
            t.worktreePath = null;
            if (prUrl) t.prUrl = prUrl;
          }
          if (t.id === taskId) primaryGitLanding = landingObj;
          landedTaskIds.push(t.id);
        } else if (sameProject && t.queueState && t.queueState.blockedByTaskId === taskId) {
          t.queueState = null;
          t.updatedAt = nowIso;
          unblockedTaskIds.push(t.id);
        }
      });

      writeTasks(freshTasks);
      gitProjectsStatusCache = { timestamp: 0, data: null };
      if (isGitRepo) clearProjectBranchCache(projPath);

      appendTaskEvent({
        taskId,
        type: 'task_landed',
        status: targetStatus,
        commitSha,
        landedBranch,
        landedTaskIds,
        unblockedTaskIds
      });
      broadcastSse('task-update', { taskId, status: targetStatus, gitLanding: primaryGitLanding });
      unblockedTaskIds.forEach(uid => {
        const ut = freshTasks.find(x => x.id === uid);
        broadcastSse('task-update', { taskId: uid, status: ut ? ut.status : 'todo', queueState: null });
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        isCommitted: true,
        taskId,
        status: targetStatus,
        archived: targetStatus === 'archived',
        gitLanding: primaryGitLanding,
        landedTaskIds,
        unblockedTaskIds,
        message: outputMsg,
        output: outputMsg
      }));
    });
    return;
  }

  // TD-S2: 序列化 Worktree Done & Merge 管線 (依 projectPath 互斥鎖排隊：Rebase → 基線變動重驗 → Squash / PR → 清理)
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/merge$/) && req.method === 'POST') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    let reqBody = '';
    req.on('data', chunk => { reqBody += chunk; });
    req.on('end', async () => {
      let reqData = {};
      try {
        if (reqBody.trim()) reqData = JSON.parse(reqBody);
      } catch (e) {}

      const tasks = readTasks();
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found' }));
        return;
      }

      const projects = readProjects();
      const proj = projects.find(p => p.id === task.project || p.name === task.project);
      let projPath = (proj && proj.path) || task.projectPath || path.join(PROJECTS_ROOT, task.project || '');
      if (typeof projPath === 'string' && projPath.startsWith('~')) {
        projPath = path.join(USER_HOME, projPath.slice(1));
      }
      projPath = path.resolve(projPath);

      let verifyCommand = (reqData.verifyCommand || (proj && proj.harness && proj.harness.command) || '').trim();
      if (!verifyCommand) {
        try {
          const pkgFile = path.join(projPath, 'package.json');
          if (fs.existsSync(pkgFile)) {
            const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
            if (pkg && pkg.scripts && pkg.scripts.test && !String(pkg.scripts.test).includes('no test specified')) {
              verifyCommand = 'npm test';
            }
          }
        } catch (e) {}
      }

      const taskSnapshot = {
        ...task,
        commitMessage: (reqData.subject || reqData.body)
          ? { subject: reqData.subject || task.commitMessage?.subject || '', body: reqData.body !== undefined ? reqData.body : (task.commitMessage?.body || '') }
          : task.commitMessage
      };

      try {
        const mergeResult = await mergeTaskWorktree({
          repoPath: projPath,
          taskId,
          task: taskSnapshot,
          worktreePath: reqData.worktreePath || task.worktreePath,
          branchName: reqData.branchName || task.branchName,
          baseBranch: reqData.baseBranch || task.targetBranch || task.baseBranch,
          baseCommit: reqData.baseCommit || task.baseCommit,
          verifyCommand,
          confirmOneWayMerge: reqData.confirmOneWayMerge === true,
          mode: reqData.mode || '',
          customEnv: buildCustomEnv()
        });

        const freshTasks = readTasks();
        const freshIdx = freshTasks.findIndex(t => t.id === taskId);
        const nowIso = new Date().toISOString();

        if (mergeResult.status === 'conflict') {
          if (freshIdx !== -1) {
            freshTasks[freshIdx].mergeStatus = 'conflict';
            freshTasks[freshIdx].status = 'in_progress';
            freshTasks[freshIdx].feedback = `Rebase 至 ${mergeResult.baseBranch} 發生衝突，已中止 rebase；請於 worktree 內解決衝突並重試。`;
            freshTasks[freshIdx].updatedAt = nowIso;
            writeTasks(freshTasks);
          }
          appendTaskEvent({ taskId, type: 'merge_conflict', baseBranch: mergeResult.baseBranch, branchName: mergeResult.branchName });
          broadcastSse('task-update', { taskId, status: 'in_progress', mergeStatus: 'conflict' });
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mergeResult));
          return;
        }

        if (mergeResult.status === 'verification_failed') {
          if (freshIdx !== -1) {
            freshTasks[freshIdx].mergeStatus = 'verification_failed';
            freshTasks[freshIdx].executionLog = (freshTasks[freshIdx].executionLog || '') +
              `\n[${nowIso}] ❌ [Merge Re-Verify Failed] 基線 ${mergeResult.baseBranch} 已前進，重驗失敗 (exit ${mergeResult.exitCode}):\n${mergeResult.output || ''}\n`;
            freshTasks[freshIdx].updatedAt = nowIso;
            writeTasks(freshTasks);
          }
          appendTaskEvent({ taskId, type: 'merge_verification_failed', baseBranch: mergeResult.baseBranch, exitCode: mergeResult.exitCode });
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mergeResult));
          return;
        }

        if (mergeResult.status === 'dirty_main_workspace' || mergeResult.status === 'one_way_requires_confirmation') {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mergeResult));
          return;
        }

        if (mergeResult.merged) {
          if (freshIdx !== -1) {
            freshTasks[freshIdx].status = 'archived';
            freshTasks[freshIdx].mergeStatus = 'merged';
            freshTasks[freshIdx].mergedAt = nowIso;
            freshTasks[freshIdx].mergeCommit = mergeResult.mergeCommit;
            freshTasks[freshIdx].worktreePath = null;
            freshTasks[freshIdx].updatedAt = nowIso;
            writeTasks(freshTasks);
          }
          gitProjectsStatusCache = { timestamp: 0, data: null };
          appendTaskEvent({
            taskId,
            type: 'worktree_merged',
            baseBranch: mergeResult.baseBranch,
            mergeCommit: mergeResult.mergeCommit,
            baseMoved: mergeResult.baseMoved,
            reVerified: mergeResult.reVerified
          });
          broadcastSse('task-update', { taskId, status: 'archived', mergeStatus: 'merged' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...mergeResult, taskId, archived: true }));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mergeResult));
      } catch (mergeErr) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, merged: false, error: mergeErr.message }));
      }
    });
    return;
  }

  // 透過 Agent / Skill 產生 Commit Message
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/generate-commit$/) && (req.method === 'POST' || req.method === 'GET')) {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }

    const projects = readProjects();
    const proj = projects.find(p => p.id === task.project);
    const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, task.project || '');
    const gitTargetDir = resolveTaskGitWorkDir(task, projPath, { preferMainIfWorktreeUntouched: true });
    const commitSkill = findProjectCommitSkill(projPath);

    let bodyData = {};
    const executeGen = () => {
      // 取得當前專案 (或 Worktree) 的最新 diff 與 modifiedFiles
      collectGitDiff(gitTargetDir, buildCustomEnv(), (modifiedFiles, diffContent) => {
        const mergedModified = (modifiedFiles && modifiedFiles.length > 0) ? modifiedFiles : (task.modifiedFiles || []);

        const isLegacyDescCopy = task.commitMessage && task.description && task.commitMessage.body && task.commitMessage.body.trim() === task.description.trim();
        // 若非強制重算，且任務已有 Agent 產出的 commitMessage (且非舊版直接複製 description)，直接回傳
        if (!bodyData.force && task.commitMessage && task.commitMessage.subject && !isLegacyDescCopy) {
          const subject = task.commitMessage.subject;
          const body = task.commitMessage.body || '';
          const agentPrompt = `請依據專案技能「${commitSkill ? commitSkill.label : 'git-workflow-and-versioning'}」之 Conventional Commit 規範，完成以下任務的提交：\n\n- 專案路徑: ${projPath}\n- 任務 ID: ${task.id}\n- 任務標題: ${task.title}\n- 建議 Commit 標題: ${subject}\n\n建議內文：\n${body || '- (依實際異動補充)'}\n\n請執行必要驗證並完成 git commit。`;
          const cliCommand = `agy "依據專案技能 ${commitSkill ? commitSkill.label : 'git-workflow-and-versioning'} 規範提交 commit: ${subject}"`;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            taskId: task.id,
            hasSkill: !!commitSkill,
            skill: commitSkill,
            skillName: commitSkill ? commitSkill.label : null,
            skillPath: commitSkill ? commitSkill.path : null,
            subject,
            body,
            commitMessage: { subject, body },
            isAgentProduced: true,
            agentPrompt,
            cliCommand
          }));
          return;
        }

        const settings = readSettings();
        const rawCliCmd = (settings.cliCommand || 'hermes').trim();

        // 若啟用本機 CLI Agent 且未禁止 CLI，嘗試以 CLI Agent 根據實際 diff 產出
        if (settings.enableCliAgent && bodyData.useCli !== false) {
          const keyChangesStr = Array.isArray(task.keyChanges) ? task.keyChanges.join('\n') : (task.keyChanges || '無');
          const resolutionStr = task.resolution || '無';
          const cliPrompt = `請分析專案 ${task.project} 當前 Git Diff、結構化改動與技能規範，產出符合 Conventional Commit 的 Commit Message。格式第一行必須為「type(scope): subject」，接著空一行，隨後為條列式說明（以 - 開頭）。請只輸出 Commit Message 本身：\n\n【重要原則】：即使任務包含多次 Feedback 修訂，Commit 主旨 (subject) 必須嚴格基於任務原始主軸（標題: ${task.title}），內文 (body) 則綜合全量實際異動項目與歷次修訂成果，嚴禁將主旨退化為單一局部 feedback 的微調！嚴禁填入空泛通用罐頭字串，必須反映實質代碼變更！\n\n【任務資訊】\nID: ${task.id}\n標題: ${task.title}\n需求: ${task.description || '無'}\n解決方案概述: ${resolutionStr}\n\n【結構化改動要點】\n${keyChangesStr}\n\n【異動檔案】\n${mergedModified.join(', ')}\n\n【Git Diff】\n${(diffContent || '').slice(0, 6000)}`;

          let bin = rawCliCmd.split(/\s+/)[0];
          let args = [];
          if (bin === 'hermes' || bin.endsWith('/hermes')) {
            args = ['--yolo', '-z', cliPrompt];
          } else if (bin === 'claude' || bin.endsWith('/claude')) {
            args = ['-p', cliPrompt];
          } else if (bin === 'agy' || bin.endsWith('/agy')) {
            args = [cliPrompt];
          } else {
            bin = 'bash';
            args = ['-c', buildCliCommand(rawCliCmd, cliPrompt)];
          }

          let cliOutput = '';
          try {
            const cp = spawn(bin, args, { cwd: projPath, env: buildCustomEnv(), timeout: 15000 });
            cp.stdout.on('data', d => { cliOutput += d.toString(); });
            cp.on('close', (code) => {
              if (code === 0 && cliOutput.trim()) {
                const cleaned = cleanAnsi(cliOutput).trim();
                const lines = cleaned.split('\n');
                const subject = lines[0].trim();
                const body = lines.slice(1).join('\n').trim();
                saveAndRespond(subject, body, true, commitSkill ? commitSkill.label : null);
                return;
              }
              fallbackFormat();
            });
            cp.on('error', () => fallbackFormat());
          } catch (e) {
            fallbackFormat();
          }
        } else {
          fallbackFormat();
        }

        function fallbackFormat() {
          const { message: subject, type, scope, body, skillName } = formatCommitMessageFromSkill(projPath, task, diffContent, mergedModified);
          saveAndRespond(subject, body, false, skillName, type, scope);
        }

        function saveAndRespond(subject, body, isCliAgent, skillName, type, scope) {
          const freshTasks = readTasks();
          const targetTask = freshTasks.find(t => t.id === task.id);
          if (targetTask) {
            targetTask.commitMessage = { subject, body };
            targetTask.requestCommitGen = false;
            writeTasks(freshTasks);
            syncToMarkdown(freshTasks);
          }

          const agentPrompt = `請依據專案技能「${skillName || 'git-workflow-and-versioning'}」之 Conventional Commit 規範，完成以下任務的提交：\n\n- 專案路徑: ${projPath}\n- 任務 ID: ${task.id}\n- 任務標題: ${task.title}\n- 建議 Commit 標題: ${subject}\n\n建議內文：\n${body || '- (依實際異動補充)'}\n\n請執行必要驗證並完成 git commit。`;
          const cliCommand = `agy "依據專案技能 ${skillName || 'git-workflow-and-versioning'} 規範提交 commit: ${subject}"`;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            taskId: task.id,
            hasSkill: !!commitSkill,
            skill: commitSkill,
            skillName: commitSkill ? commitSkill.label : null,
            skillPath: commitSkill ? commitSkill.path : null,
            type: type || (subject.split(':')[0] || 'feat'),
            scope: scope || '',
            subject,
            body,
            commitMessage: { subject, body },
            isAgentProduced: isCliAgent || !!(targetTask && targetTask.commitMessage),
            agentPrompt,
            cliCommand
          }));
        }
      });
    };

    if (req.method === 'POST') {
      let reqBody = '';
      req.on('data', chunk => { reqBody += chunk; });
      req.on('end', () => {
        try { bodyData = JSON.parse(reqBody || '{}'); } catch (e) {}
        executeGen();
      });
    } else {
      executeGen();
    }
    return;
  }

  // 透過開工引擎 (Desktop AI 哨兵) 請求產出 Commit Message
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/request-commit-gen$/) && req.method === 'POST') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }

    task.requestCommitGen = true;
    writeTasks(tasks);
    syncToMarkdown(tasks);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '已成功標記請求，已喚醒任務哨兵待命開工！' }));
    return;
  }

  // 透過後端在 macOS 系統預設瀏覽器開啟指定網址 (解決 App WebKit 限制)
  if (pathname === '/api/open-browser' && req.method === 'POST') {
    let reqBody = '';
    req.on('data', chunk => { reqBody += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(reqBody);
        const targetUrl = (data.url || '').trim();
        if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
          const safeUrl = targetUrl.replace(/"/g, '\\"');
          exec(`open "${safeUrl}"`, (err) => {
            if (err) console.error('Failed to open browser:', err);
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: `已在預設瀏覽器開啟 ${targetUrl}` }));
          return;
        }
      } catch (e) {}
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
    });
    return;
  }

  // 查詢所有專案的 Git Diff 狀態 (是否有未提交異動，快取 10 秒)
  // 查詢本機已連線之 Git 帳號與遠端平台狀態（絕不回傳明文 Token/PAT）
  if (pathname === '/api/git/accounts' && req.method === 'GET') {
    try {
      const projects = readProjects();
      const settings = readSettings();
      const extraAzdoOrgs = Array.isArray(settings.azureDevOpsOrgs) ? settings.azureDevOpsOrgs : [];
      const accountInfo = listGitAccounts(projects, {
        customEnv: buildCustomEnv(),
        extraAzdoOrgs
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(accountInfo));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err && err.message) || 'Failed to inspect Git accounts' }));
    }
    return;
  }

  // 啟動 GitHub CLI OAuth Device Flow（回傳 One-time code 供使用者在瀏覽器授權）
  if (pathname === '/api/git/accounts/github/login' && req.method === 'POST') {
    startGithubDeviceLogin({
      customEnv: buildCustomEnv(),
      onComplete: (result) => {
        broadcastSse('git-accounts-updated', {
          provider: 'github',
          success: Boolean(result && result.success)
        });
      }
    }).then((loginRes) => {
      res.writeHead(loginRes.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(loginRes));
    }).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Failed to start GitHub login' }));
    });
    return;
  }

  // 切換預設 GitHub CLI 帳號
  if (pathname === '/api/git/accounts/github/switch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const username = String(data.username || '').trim();
        const switchRes = switchGithubAccount(username, buildCustomEnv());
        if (!switchRes.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(switchRes));
          return;
        }
        broadcastSse('git-accounts-updated', { provider: 'github', switchedTo: username });
        const projects = readProjects();
        const settings = readSettings();
        const accountInfo = listGitAccounts(projects, {
          customEnv: buildCustomEnv(),
          extraAzdoOrgs: Array.isArray(settings.azureDevOpsOrgs) ? settings.azureDevOpsOrgs : []
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...switchRes, accounts: accountInfo }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Invalid JSON' }));
      }
    });
    return;
  }

  // 驗證並安全儲存 Azure DevOps 組織 PAT 至 macOS Keychain（不寫入明文至 settings.json）
  if (pathname === '/api/git/accounts/azdo' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const org = String(data.org || '').trim();
        const pat = String(data.pat || '').trim();
        const saveRes = await verifyAndSaveAzureDevOpsPat(org, pat);
        if (!saveRes.success) {
          res.writeHead(saveRes.statusCode === 401 || saveRes.statusCode === 403 ? 401 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(saveRes));
          return;
        }
        const curSettings = readSettings();
        const existingOrgs = Array.isArray(curSettings.azureDevOpsOrgs) ? curSettings.azureDevOpsOrgs : [];
        if (!existingOrgs.includes(org)) {
          writeSettings({ ...curSettings, azureDevOpsOrgs: [...existingOrgs, org] });
        }
        broadcastSse('git-accounts-updated', { provider: 'azure-devops', org });
        const projects = readProjects();
        const accountInfo = listGitAccounts(projects, {
          customEnv: buildCustomEnv(),
          extraAzdoOrgs: existingOrgs.includes(org) ? existingOrgs : [...existingOrgs, org]
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...saveRes, accounts: accountInfo }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: (err && err.message) || 'Invalid JSON' }));
      }
    });
    return;
  }

  if (pathname === '/api/git/projects-status' && req.method === 'GET') {
    const now = Date.now();
    if (gitProjectsStatusCache.data && (now - gitProjectsStatusCache.timestamp < 10000)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(gitProjectsStatusCache.data));
      return;
    }
    const projects = readProjects();
    const result = {};
    projects.forEach(p => {
      const projPath = p.path || path.join(PROJECTS_ROOT, p.id);
      try {
        if (fs.existsSync(projPath) && fs.existsSync(path.join(projPath, '.git'))) {
          const statusOutput = execSync('git status --porcelain', { cwd: projPath, encoding: 'utf8', timeout: 3000 }).trim();
          result[p.id] = {
            hasDiff: statusOutput.length > 0,
            summary: statusOutput
          };
        } else {
          result[p.id] = { hasDiff: false, summary: 'non-git' };
        }
      } catch (err) {
        result[p.id] = { hasDiff: false, summary: err.message };
      }
    });
    gitProjectsStatusCache = { timestamp: Date.now(), data: result };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 查詢單一檔案的完整文字行內容，供前端 Diff 檢視器展開前後文與整檔檢視 (支援 worktree / commit 快照 / 工作區)
  if (pathname === '/api/git/file-context' && req.method === 'GET') {
    const taskId = String(query.taskId || '').trim();
    const rawFilePath = String(query.filePath || '').trim().replace(/^\/+/, '');
    if (!rawFilePath || rawFilePath.includes('\0') || rawFilePath.split('/').includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing filePath' }));
      return;
    }

    let task = null;
    if (taskId) {
      const tasks = readTasks();
      const archived = readArchivedTasks();
      task = tasks.find(t => t.id === taskId) || archived.find(t => t.id === taskId) || null;
    }

    const projId = String(query.projectId || (task && task.project) || '').trim();
    const projects = readProjects();
    const proj = projects.find(p => p.id === projId || p.name === projId);
    let projPath = (proj && proj.path) || (task && task.projectPath) || (projId ? path.join(PROJECTS_ROOT, projId) : '');
    if (typeof projPath === 'string' && projPath.startsWith('~')) {
      projPath = path.join(USER_HOME, projPath.slice(1));
    }
    if (projPath) projPath = path.resolve(projPath);

    const candidatePaths = [rawFilePath];
    if (projId && rawFilePath.startsWith(projId + '/')) {
      candidatePaths.push(rawFilePath.slice(projId.length + 1));
    }
    const strippedFirstSeg = rawFilePath.replace(/^[^/]+\//, '');
    if (strippedFirstSeg && strippedFirstSeg !== rawFilePath && !candidatePaths.includes(strippedFirstSeg)) {
      // 僅在原始路徑找不到時才作為最後備援
      candidatePaths.push(strippedFirstSeg);
    }

    const parseTextBufferToLines = (buf) => {
      if (!Buffer.isBuffer(buf) || buf.length > 2 * 1024 * 1024) return null;
      if (buf.subarray(0, 8192).includes(0)) return null;
      let text = buf.toString('utf8').replace(/\r\n/g, '\n');
      if (text.length === 0) return [];
      if (text.endsWith('\n')) text = text.slice(0, -1);
      return text.split('\n');
    };

    const readSafeDiskFileLines = (baseDir, relPath) => {
      if (!baseDir || !fs.existsSync(baseDir)) return null;
      const absBase = path.resolve(baseDir);
      const absFile = path.resolve(absBase, relPath);
      if (!absFile.startsWith(absBase + path.sep)) return null;
      try {
        const st = fs.statSync(absFile);
        if (!st.isFile() || st.size > 2 * 1024 * 1024) return null;
        return parseTextBufferToLines(fs.readFileSync(absFile));
      } catch (e) {
        return null;
      }
    };

    const readGitBlobLines = (repoDir, ref, relPath) => {
      if (!repoDir || !ref || !fs.existsSync(path.join(repoDir, '.git'))) return null;
      try {
        const buf = execFileSync('git', ['-C', repoDir, 'show', `${ref}:${relPath}`], {
          maxBuffer: 3 * 1024 * 1024,
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        return parseTextBufferToLines(buf);
      } catch (e) {
        return null;
      }
    };

    let resolvedLines = null;
    let resolvedSource = 'unavailable';
    let resolvedPath = rawFilePath;
    let resolvedCommit = '';

    // 1. 優先讀取任務專屬隔離 Worktree
    if (task && task.worktreePath && fs.existsSync(task.worktreePath)) {
      for (const cand of candidatePaths) {
        const lines = readSafeDiskFileLines(task.worktreePath, cand);
        if (lines !== null) {
          resolvedLines = lines;
          resolvedSource = 'worktree';
          resolvedPath = cand;
          break;
        }
      }
    }

    // 2. 若任務已提交/合併，優先從對應 Commit SHA 讀取精確歷史快照
    const commitSha = String(
      (task && (task.mergeCommit || (task.gitLanding && task.gitLanding.commitSha) || task.commitHash)) || ''
    ).trim();
    if (resolvedLines === null && /^[0-9a-f]{7,40}$/i.test(commitSha) && projPath) {
      for (const cand of candidatePaths) {
        const lines = readGitBlobLines(projPath, commitSha, cand);
        if (lines !== null) {
          resolvedLines = lines;
          resolvedSource = 'commit';
          resolvedPath = cand;
          resolvedCommit = commitSha.slice(0, 7);
          break;
        }
      }
    }

    // 3. 讀取專案目前工作區檔案
    if (resolvedLines === null && projPath) {
      for (const cand of candidatePaths) {
        const lines = readSafeDiskFileLines(projPath, cand);
        if (lines !== null) {
          resolvedLines = lines;
          resolvedSource = 'workspace';
          resolvedPath = cand;
          break;
        }
      }
    }

    // 4. 最後備援：從目前 HEAD 讀取
    if (resolvedLines === null && projPath) {
      for (const cand of candidatePaths) {
        const lines = readGitBlobLines(projPath, 'HEAD', cand);
        if (lines !== null) {
          resolvedLines = lines;
          resolvedSource = 'head';
          resolvedPath = cand;
          break;
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      filePath: resolvedPath,
      source: resolvedSource,
      commitSha: resolvedCommit,
      totalLines: Array.isArray(resolvedLines) ? resolvedLines.length : 0,
      lines: resolvedLines
    }));
    return;
  }

  // 查詢單一檔案的 Git Diff (即時從本機 Git 讀取)
  if (pathname === '/api/git/file-diff' && req.method === 'GET') {
    const projId = query.projectId;
    const targetFilePath = query.filePath;
    const parsedCtx = parseInt(query.contextLines, 10);
    const unifiedArg = Number.isFinite(parsedCtx) && parsedCtx >= 0 && parsedCtx <= 5000 ? `-U${parsedCtx} ` : '';
    
    if (!projId || !targetFilePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing projectId or filePath' }));
      return;
    }

    const projects = readProjects();
    const proj = projects.find(p => p.id === projId);
    const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, projId);

    let diffOutput = '';
    try {
      if (fs.existsSync(projPath) && fs.existsSync(path.join(projPath, '.git'))) {
        const cleanPath = fs.existsSync(path.join(projPath, targetFilePath))
          ? targetFilePath
          : targetFilePath.replace(/^[^/]+\//, '');
        try {
          diffOutput = execSync(`git diff ${unifiedArg}HEAD~1 -- "${cleanPath}"`, { cwd: projPath, encoding: 'utf8', timeout: 5000 }).trim();
        } catch (e1) {
          try {
            diffOutput = execSync(`git log -p -1 ${unifiedArg}-- "${cleanPath}"`, { cwd: projPath, encoding: 'utf8', timeout: 5000 }).trim();
          } catch (e2) {
            try {
              diffOutput = execSync(`git diff ${unifiedArg}-- "${cleanPath}"`, { cwd: projPath, encoding: 'utf8', timeout: 5000 }).trim();
            } catch (e3) {
              diffOutput = '';
            }
          }
        }
      }
    } catch (err) {
      diffOutput = '';
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ filePath: targetFilePath, diff: diffOutput }));
    return;
  }

  // 批次刪除封存任務 (可多選或全選刪除)
  if (pathname === '/api/tasks/batch-delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const tasks = readTasks();
        const archived = readArchivedTasks();
        let deletedCount = 0;
        if (data.allArchived) {
          deletedCount = archived.length + tasks.filter(t => t.status === 'archived').length;
          writeArchivedTasks([]);
          const cleanTasks = tasks.filter(t => t.status !== 'archived');
          writeTasks(cleanTasks);
        } else if (Array.isArray(data.taskIds)) {
          const idsSet = new Set(data.taskIds);
          const filteredTasks = tasks.filter(t => !idsSet.has(t.id));
          const filteredArchived = archived.filter(t => !idsSet.has(t.id));
          deletedCount = (tasks.length - filteredTasks.length) + (archived.length - filteredArchived.length);
          writeTasks(filteredTasks);
          writeArchivedTasks(filteredArchived);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: deletedCount }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 批次還原封存任務至 Done (已完成)
  if (pathname === '/api/tasks/batch-restore' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const tasks = readTasks();
        const archived = readArchivedTasks();
        const nowIso = new Date().toISOString();
        let restoredCount = 0;
        if (Array.isArray(data.taskIds)) {
          const idsSet = new Set(data.taskIds);
          const remainingArchived = [];
          const restoredTasks = [];

          archived.forEach(t => {
            if (idsSet.has(t.id)) {
              t.status = 'done';
              t.updatedAt = nowIso;
              restoredTasks.push(t);
              restoredCount++;
            } else {
              remainingArchived.push(t);
            }
          });

          tasks.forEach(t => {
            if (idsSet.has(t.id) && t.status === 'archived') {
              t.status = 'done';
              t.updatedAt = nowIso;
              restoredCount++;
            }
          });

          const newActiveTasks = [...tasks, ...restoredTasks];
          writeArchivedTasks(remainingArchived);
          writeTasks(newActiveTasks);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: restoredCount }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 查詢任務所屬專案當前未提交變更狀態 (供放棄與刪除 double-check 預覽)
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/git-status$/) && req.method === 'GET') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    const tasks = readTasks();
    const archived = readArchivedTasks();
    const task = tasks.find(t => t.id === taskId) || archived.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found: ' + taskId }));
      return;
    }
    const projects = readProjects();
    const proj = projects.find(p => p.id === task.project);
    const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, task.project || '');
    const gitTargetDir = resolveTaskGitWorkDir(task, projPath, { preferMainIfWorktreeUntouched: true });

    let hasDiff = false;
    let summary = '';
    let files = [];
    let diffStat = '';
    try {
      if (fs.existsSync(gitTargetDir) && (fs.existsSync(path.join(gitTargetDir, '.git')) || task.worktreePath)) {
        const statusOutput = execSync('git status --porcelain', { cwd: gitTargetDir, encoding: 'utf8', timeout: 3000 }).trim();
        if (statusOutput.length > 0) {
          hasDiff = true;
          summary = statusOutput;
          files = statusOutput.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.replace(/^[A-Z?]+\s+/, ''));
          try {
            diffStat = execSync('git diff --stat HEAD', { cwd: gitTargetDir, encoding: 'utf8', timeout: 3000 }).trim();
          } catch (e) {
            try { diffStat = execSync('git diff --stat', { cwd: gitTargetDir, encoding: 'utf8', timeout: 3000 }).trim(); } catch (e2) {}
          }
        }
      }
    } catch (err) {
      // 容錯
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      taskId,
      project: task.project || '',
      projectPath: projPath,
      hasDiff,
      summary,
      files,
      diffStat
    }));
    return;
  }

  // 放棄任務 (Abandon Task: 移入封存庫並標記放棄，可選擇是否 discard changes)
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/abandon$/) && req.method === 'POST') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        let reqData = {};
        if (body.trim()) reqData = JSON.parse(body);
        const tasks = readTasks();
        const index = tasks.findIndex(t => t.id === taskId);
        if (index === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task not found: ' + taskId }));
          return;
        }

        const task = tasks[index];
        const projects = readProjects();
        const proj = projects.find(p => p.id === task.project || p.name === task.project);
        let projPath = (proj && proj.path) || task.projectPath || path.join(PROJECTS_ROOT, task.project || '');
        if (typeof projPath === 'string' && projPath.startsWith('~')) {
          projPath = path.join(os.homedir(), projPath.slice(1));
        }
        projPath = path.resolve(projPath);

        // 停止可能正在執行的 CLI Agent 行程
        if (activeCliProcesses.has(taskId)) {
          try {
            const procInfo = activeCliProcesses.get(taskId);
            if (procInfo && procInfo.child) procInfo.child.kill('SIGTERM');
          } catch (kErr) {}
          activeCliProcesses.delete(taskId);
        }

        // 若使用者選擇 discardChanges，執行還原 (若為 worktree 則清理隔離區，否則 git reset --hard HEAD && clean -fd)
        let discardOutput = '';
        if (reqData.discardChanges === true) {
          if (task.worktreePath || (projPath && fs.existsSync(`${projPath.replace(/\/+$/, '')}.worktrees/${taskId}`))) {
            removeTaskWorktree(projPath, taskId);
            discardOutput = 'Worktree 隔離工作區與分支已成功清理移除';
          } else {
            discardOutput = discardGitChanges(projPath);
          }
        }

        const nowIso = new Date().toISOString();
        const reason = reqData.reason ? `原因: ${reqData.reason}` : '使用者主動放棄';
        const abandonLog = `\n[${nowIso}] ⚠️ [Task Abandoned] 任務已被放棄 (${reason})${discardOutput ? `，${discardOutput}` : ''}\n----------------------------------------\n`;

        tasks[index].status = 'archived';
        tasks[index].updatedAt = nowIso;
        tasks[index].executionLog = (tasks[index].executionLog || '') + abandonLog;
        if (!tasks[index].tags) tasks[index].tags = [];
        if (!tasks[index].tags.includes('abandoned')) tasks[index].tags.push('abandoned');

        writeTasks(tasks);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          abandoned: taskId,
          discardOutput
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 刪除單一任務 (支援 query 參數或 request body 的 discardChanges)
  if (pathname.startsWith('/api/tasks/') && req.method === 'DELETE') {
    const taskId = decodeURIComponent(pathname.replace('/api/tasks/', '')).trim();
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        let reqData = {};
        if (body.trim()) {
          try { reqData = JSON.parse(body); } catch (e) {}
        }
        const shouldDiscard = (reqData.discardChanges === true) || (query.discardChanges === 'true') || (query.discardChanges === '1');

        const tasks = readTasks();
        const archived = readArchivedTasks();
        let targetTask = tasks.find(t => t.id === taskId);
        let inArchived = false;
        if (!targetTask) {
          targetTask = archived.find(t => t.id === taskId);
          if (targetTask) inArchived = true;
        }
        if (!targetTask) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task not found' }));
          return;
        }

        // 停止可能正在執行的 CLI Agent 行程
        if (activeCliProcesses.has(taskId)) {
          try {
            const procInfo = activeCliProcesses.get(taskId);
            if (procInfo && procInfo.child) procInfo.child.kill('SIGTERM');
          } catch (kErr) {}
          activeCliProcesses.delete(taskId);
        }

        let discardOutput = '';
        if (shouldDiscard && targetTask) {
          const projects = readProjects();
          const proj = projects.find(p => p.id === targetTask.project || p.name === targetTask.project);
          let projPath = (proj && proj.path) || targetTask.projectPath || path.join(PROJECTS_ROOT, targetTask.project || '');
          if (typeof projPath === 'string' && projPath.startsWith('~')) {
            projPath = path.join(os.homedir(), projPath.slice(1));
          }
          projPath = path.resolve(projPath);
          if (targetTask.worktreePath || (projPath && fs.existsSync(`${projPath.replace(/\/+$/, '')}.worktrees/${taskId}`))) {
            removeTaskWorktree(projPath, taskId);
            discardOutput = 'Worktree 隔離工作區與分支已成功清理移除';
          } else {
            discardOutput = discardGitChanges(projPath);
          }
        }

        if (inArchived) {
          const filteredArchived = archived.filter(t => t.id !== taskId);
          writeArchivedTasks(filteredArchived);
        } else {
          const filtered = tasks.filter(t => t.id !== taskId);
          writeTasks(filtered);
        }

        if (targetTask.diffPath) {
          try {
            const df = path.join(resolveDataDir(), targetTask.diffPath);
            if (fs.existsSync(df)) fs.unlinkSync(df);
          } catch (e) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, deleted: taskId, discardOutput }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 靜態檔案託管 (Static File Serving)
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, indexContent) => {
          if (err2) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
          } else {
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
            });
            res.end(indexContent);
          }
        });
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
      });
      res.end(content);
    }
  });
});

if (require.main === module) {
  const shutdown = () => {
    cleanupAllCliProcesses(activeCliProcesses);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(` Task Dashboard Server running at http://localhost:${PORT}`);
    console.log(` Single Source of Truth: ${ROOT_DIR}`);
    syncToMarkdown(readTasks());
  });
}

module.exports = {
  server,
  executeProjectCommit,
  resolveTaskSkillRoute,
  consumeTaskFeedback,
  formatCommitMessageFromSkill,
  initProjectHarness,
  parseAgentStatusContent,
  parseBuildPlanContent,
  scanProjectWorklogAndPlan,
  syncProjectWorklogForActiveTask,
  syncProjectWorklogForRedo,
  syncProjectWorklogOnReview,
  syncProjectWorklogOnDone
};
