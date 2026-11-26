#!/usr/bin/env node

/**
 * watch-task-gate.js
 * 
 * Task Dashboard - AI 哨兵即時守候門禁 (Reactive Wakeup Gate)
 * 適用於 Antigravity (run_command)、Claude (bash)、OpenAI Codex / Cursor (terminal) 等所有 Desktop AI。
 * 
 * 運作原理：
 * 1. 檢查 tasks.json 是否已有 status === 'in_progress' 或 requestCommitGen === true 的任務。若有，立即印出任務資訊並 exit(0)。
 * 2. 若無任務，透過 Node 原生 fs.watch (macOS 原生 FSEvents) 於背景靜默守候（0 Token 開銷）。
 * 3. 一旦偵測到任務狀態變更為 in_progress 或請求產出 Commit 訊息，立即印出 [WAKEUP_TRIGGERED] 並退出 (exit 0)。
 * 4. 外部 Desktop AI (Antigravity / Claude / Codex) 攔截到背景進程結束事件，觸發 Reactive Wakeup 瞬間開工（實作或產出 Commit 訊息）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const USER_HOME = process.env.HOME || os.homedir();

function loadAgentProviderAdapter() {
  const candidates = [
    path.resolve(__dirname, '../src/server/agentProviderAdapter'),
    path.join(__dirname, 'agentProviderAdapter'),
    path.join(USER_HOME, 'projects/task-dashboard/src/server/agentProviderAdapter')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) || fs.existsSync(c + '.js')) {
        return require(c);
      }
    } catch (e) {}
  }
  return {
    resolveProvider: () => ({
      name: 'antigravity',
      fastExecutor: 'flash Subagent (Workspace: "inherit")',
      reasoningVerifier: 'pro Verifier (Model: "pro", Workspace: "inherit")',
      nativeOrchestrator: 'Orchestrator (Plan→Execute 原生雙階段)',
      directExecutor: 'Hydrogen / Fast 直行模式',
      subagentMechanism: 'invoke_subagent'
    }),
    formatTierStrategy: (tier) => `• 執行策略 (Tier: ${tier})`
  };
}
const { formatTierStrategy, resolveProvider } = loadAgentProviderAdapter();

function loadGitNexusDetector() {
  const candidates = [
    path.resolve(__dirname, '../src/server/gitnexusDetector'),
    path.join(__dirname, 'gitnexusDetector'),
    path.join(USER_HOME, 'projects/task-dashboard/src/server/gitnexusDetector')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) || fs.existsSync(c + '.js')) {
        return require(c);
      }
    } catch (e) {}
  }
  return {
    detectProjectGitNexus: () => ({ hasGitNexus: false }),
    formatGitNexusGuidance: () => ''
  };
}
const { formatGitNexusGuidance } = loadGitNexusDetector();
const DEFAULT_APP_SUPPORT_DIR = process.env.TASK_DASHBOARD_DATA_DIR || path.join(USER_HOME, 'Library/Application Support/TaskDashboard');

// 解析命令列參數 (例如 node watch-task-gate.js --agent=antigravity --tier=micro,standard 或 --conversationId=conv_123 --replace)
let targetAgent = '';
let targetTiers = [];
let claimerId = process.env.CONVERSATION_ID || '';
let replaceExisting = false;
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--agent=')) {
    targetAgent = arg.slice(8).trim().toLowerCase();
  } else if (arg.startsWith('-a=')) {
    targetAgent = arg.slice(3).trim().toLowerCase();
  } else if (arg.startsWith('--tier=') || arg.startsWith('--tiers=')) {
    const raw = arg.split('=')[1] || '';
    targetTiers = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  } else if (arg.startsWith('--conversation=') || arg.startsWith('--conversationId=')) {
    claimerId = arg.split('=')[1].trim();
  } else if (arg.startsWith('--claimer=')) {
    claimerId = arg.split('=')[1].trim();
  } else if (arg === '--replace' || arg === '--force') {
    replaceExisting = true;
  }
});
if (!claimerId) {
  // 使用帶 TTL 的租約識別碼（不以短命哨兵自身 PID 結尾，避免哨兵 exit(0) 喚醒 AI 後立即被誤判為 dead PID 而搶單）
  claimerId = `${targetAgent || 'sentinel'}:lease-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// 1. 動態解析真實資料庫目錄 (Single Source of Truth)
function resolveDataDir() {
  if (process.env.TASK_DASHBOARD_DATA_DIR && process.env.TASK_DASHBOARD_DATA_DIR.trim()) {
    return process.env.TASK_DASHBOARD_DATA_DIR.trim();
  }

  // 優先檢查同目錄或標準 Application Support 目錄中的 settings.json
  const candidateSettingsFiles = [
    path.join(__dirname, 'settings.json'),
    path.join(DEFAULT_APP_SUPPORT_DIR, 'settings.json')
  ];

  for (const settingsFile of candidateSettingsFiles) {
    if (fs.existsSync(settingsFile)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        if (settings && settings.dataDirectoryPath && settings.dataDirectoryPath.trim()) {
          let customDir = settings.dataDirectoryPath.trim();
          if (customDir.startsWith('~')) {
            customDir = path.join(USER_HOME, customDir.slice(1));
          }
          if (fs.existsSync(customDir)) {
            return customDir;
          }
        }
      } catch (e) {}
    }
  }

  // 預設回退至 Application Support
  return DEFAULT_APP_SUPPORT_DIR;
}

function getDataDir() {
  return resolveDataDir();
}

function getTasksFile() {
  return path.join(getDataDir(), 'tasks.json');
}

const DATA_DIR = getDataDir();
const TASKS_FILE = getTasksFile();

function resolveStandardDoc() {
  if (process.env.TASK_DASHBOARD_STANDARD_DOC && process.env.TASK_DASHBOARD_STANDARD_DOC.trim()) {
    return process.env.TASK_DASHBOARD_STANDARD_DOC.trim();
  }
  const candidates = [
    path.resolve(__dirname, '../docs/AUTOMATION_STANDARD.md'),
    path.join(DATA_DIR, 'AUTOMATION_STANDARD.md'),
    path.join(DATA_DIR, 'docs/AUTOMATION_STANDARD.md'),
    path.join(USER_HOME, 'projects/task-dashboard/docs/AUTOMATION_STANDARD.md')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(__dirname, '../docs/AUTOMATION_STANDARD.md');
}

const STANDARD_DOC = resolveStandardDoc();

function isPidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return false;
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {}
  return fallback;
}

function normalizeScopePath(p) {
  return String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function hasAllowedFilesOverlap(taskA, taskB) {
  const listA = Array.isArray(taskA?.scope?.allowedFiles) ? taskA.scope.allowedFiles.map(normalizeScopePath).filter(Boolean) : [];
  const listB = Array.isArray(taskB?.scope?.allowedFiles) ? taskB.scope.allowedFiles.map(normalizeScopePath).filter(Boolean) : [];
  if (listA.length === 0 || listB.length === 0) return false;
  for (const a of listA) {
    for (const b of listB) {
      if (a === b || a.startsWith(b + '/') || b.startsWith(a + '/')) {
        return true;
      }
    }
  }
  return false;
}

function hasPendingQuestions(task) {
  return Boolean(task && (task.awaitingInput === true || (Array.isArray(task.pendingQuestions) && task.pendingQuestions.length > 0)));
}

function isPendingUserConfirmation(task) {
  if (hasPendingQuestions(task)) return true;
  return Boolean(task && task.requiresConfirmation && task.executionPlan && String(task.executionPlan).trim().length > 0);
}

function isTaskCircuitBroken(task) {
  if (!task) return false;
  if (task.status === 'needs_human' || task.needsHuman === true) return true;
  if (Number(task.fixRoundCount || 0) >= 2 && task.resetCircuitBreaker !== true) return true;
  return false;
}

function isClaimAlive(task, selfClaimerId = null) {
  if (!task || !task.claimedBy || !task.claimedAt) return false;
  if (selfClaimerId && task.claimedBy === selfClaimerId) return false;
  const pidMatch = String(task.claimedBy).match(/-(\d+)$/);
  const isOwnerAlive = pidMatch ? isPidAlive(pidMatch[1]) : true;
  if (!isOwnerAlive) return false;
  const claimAgeMs = Date.now() - new Date(task.claimedAt).getTime();
  const CLAIM_TTL_MS = 15 * 60 * 1000;
  return !isNaN(claimAgeMs) && claimAgeMs < CLAIM_TTL_MS;
}

function isClaimDead(task) {
  if (!task || !task.claimedBy) return false;
  const pidMatch = String(task.claimedBy).match(/-(\d+)$/);
  return pidMatch ? !isPidAlive(pidMatch[1]) : false;
}

function resolveTaskRepoKey(task, projects) {
  if (!task) return '';
  if (Array.isArray(projects)) {
    const proj = projects.find(item => item && (item.id === task.project || item.name === task.project));
    if (proj && proj.path) {
      let resolved = proj.path.trim();
      if (resolved.startsWith('~')) resolved = path.join(USER_HOME, resolved.slice(1));
      return path.resolve(resolved);
    }
  }
  if (task.projectPath) {
    let resolved = String(task.projectPath).trim();
    if (resolved.startsWith('~')) resolved = path.join(USER_HOME, resolved.slice(1));
    return path.resolve(resolved);
  }
  return task.project ? `project:${task.project}` : '';
}

function resolveEffectiveWorkspaceMode(task, settings) {
  if (task && (task.workspaceMode === 'worktree' || task.workspaceMode === 'branch_stream' || task.workspaceMode === 'in_place')) {
    return task.workspaceMode;
  }
  const isolationMode = String((task && task.isolation) || (settings && settings.cliIsolation) || 'none').trim().toLowerCase();
  if (isolationMode === 'worktree' || (task && (task.workspace === 'share' || Boolean(task.worktreePath)))) {
    return 'worktree';
  }
  return 'in_place';
}

function hasRepoConflict(task, taskIndex, allTasks, projects, settings) {
  if (task && task.queueState && task.queueState.blockedByTaskId) {
    return true;
  }
  const repoKey = resolveTaskRepoKey(task, projects);
  if (!repoKey) return false;

  const taskMode = resolveEffectiveWorkspaceMode(task, settings);
  const taskTargetBranch = String((task && (task.targetBranch || task.baseBranch)) || '').trim();

  for (let idx = 0; idx < allTasks.length; idx++) {
    const other = allTasks[idx];
    if (!other || other.id === task.id || other.status !== 'in_progress') continue;
    if (isPendingUserConfirmation(other) || isTaskCircuitBroken(other)) continue;
    if (other.queueState && other.queueState.blockedByTaskId) continue;

    const otherRepoKey = resolveTaskRepoKey(other, projects);
    if (otherRepoKey !== repoKey) continue;

    const otherActivelyClaimed = isClaimAlive(other, null);
    const otherIsCliRunning = other.assignee === 'CLI';
    const otherIsAheadUnclaimed = idx < taskIndex && !isClaimDead(other);
    const isOccupant = otherActivelyClaimed || otherIsCliRunning || Boolean(other.worktreePath) || otherIsAheadUnclaimed;
    if (!isOccupant) continue;

    const otherMode = resolveEffectiveWorkspaceMode(other, settings);
    if (taskMode === 'worktree') {
      if (hasAllowedFilesOverlap(task, other)) {
        return true;
      }
      continue;
    }
    if (taskMode === 'branch_stream') {
      if (otherMode === 'branch_stream') {
        const otherTargetBranch = String(other.targetBranch || other.baseBranch || '').trim();
        if (!taskTargetBranch || !otherTargetBranch || taskTargetBranch === otherTargetBranch) {
          return true;
        }
      }
      continue;
    }
    if (otherMode === 'in_place') {
      return true;
    }
  }
  return false;
}

function findActionableTask() {
  try {
    const dataDir = getDataDir();
    const tasksFile = path.join(dataDir, 'tasks.json');
    if (!fs.existsSync(tasksFile)) return null;
    const tasks = readJsonSafe(tasksFile, null);
    if (!Array.isArray(tasks)) return null;
    const projects = readJsonSafe(path.join(dataDir, 'projects.json'), []);
    const settings = readJsonSafe(path.join(dataDir, 'settings.json'), {});

    return tasks.find((t, idx) => {
      if (!t) return false;
      if (!t.requestCommitGen && isTaskCircuitBroken(t)) return false;

      const taskTier = determineTaskTier(t);
      // 若哨兵指定了 --agent，檢查任務的 assignee / assignedAgent 與能力角色是否符合
      if (targetAgent) {
        const taskAgent = (t.assignedAgent || t.assignee || '').trim().toLowerCase();
        const isGenericTaskAgent = !taskAgent || taskAgent === 'all' || taskAgent === 'universal';
        const isPlannerRole = targetAgent === 'orchestrator' || targetAgent === 'planner';
        const isFastRole = targetAgent === 'hydrogen' || targetAgent === 'fast' || targetAgent === 'direct';

        if (isPlannerRole) {
          if (!isGenericTaskAgent && taskAgent !== 'antigravity' && taskAgent !== targetAgent) {
            return false;
          }
          if (!t.requestCommitGen && taskTier !== 'standard' && taskTier !== 'heavy' && t.requiresConfirmation !== true) {
            return false;
          }
        } else if (isFastRole) {
          if (!isGenericTaskAgent && taskAgent !== 'antigravity' && taskAgent !== targetAgent) {
            return false;
          }
          if (!t.requestCommitGen && (t.requiresConfirmation || t.riskDoor === 'one-way' || (taskTier !== 'micro' && taskTier !== 'standard'))) {
            return false;
          }
        } else {
          // 若任務有明確指定 agent 且不相符，跳過不認領（未指定或設為 all / universal 則通用認領）
          if (!isGenericTaskAgent && taskAgent !== targetAgent) {
            return false;
          }
        }
      }
      // 若哨兵顯式指定 --tier 過濾，非 Commit 產出請求時僅認領指定階層任務
      if (targetTiers.length > 0 && !t.requestCommitGen) {
        if (!targetTiers.includes(taskTier)) {
          return false;
        }
      }
      if (t.requestCommitGen === true) return true;
      if (t.status === 'in_progress') {
        // Conversation Lock 判定：若已被其他活躍視窗認領（15 分鐘內有效），則跳過避免雙重喚醒搶單
        if (isClaimAlive(t, claimerId)) {
          return false;
        }
        // 若任務勾選需確認後再執行，且已經產出完整執行計劃，則處於「待確認」等待使用者審閱並點擊「確認並執行」，哨兵暫不喚醒開工
        if (isPendingUserConfirmation(t)) return false;
        // TD-S1: 跨卡同 Repo 互斥與 allowedFiles 交集阻斷
        if (hasRepoConflict(t, idx, tasks, projects, settings)) return false;
        return true;
      }
      return false;
    }) || null;
  } catch (err) {
    // 檔案正在寫入中或暫時為空時忽略
    return null;
  }
}

function sleepSyncMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) {}
}

function getSentinelLockPath() {
  const scopeKey = ((targetAgent || 'all') + (targetTiers.length ? `-${targetTiers.join('_')}` : '')).replace(/[^a-z0-9_-]/gi, '_');
  return path.join(getDataDir(), `sentinel-${scopeKey}.lock`);
}

function acquireSentinelSingletonLock({ replace = replaceExisting } = {}) {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const lockPath = getSentinelLockPath();
  const existing = readJsonSafe(lockPath, null);
  if (existing && existing.pid && Number(existing.pid) !== process.pid && isPidAlive(existing.pid)) {
    if (!replace) {
      console.log(`[SENTINEL_ALREADY_ACTIVE] 偵測到同範圍哨兵已在背景守候中 (PID: ${existing.pid}, Agent: ${existing.targetAgent || '通用'})，自動略過本次重複啟動以避免搶單衝突（如需接管請加上 --replace）。`);
      return { acquired: false, existingPid: Number(existing.pid), lockPath };
    }
    try {
      process.kill(Number(existing.pid), 'SIGTERM');
    } catch (e) {}
    sleepSyncMs(80);
  }
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    targetAgent: targetAgent || 'all',
    tiers: targetTiers,
    claimerId
  }, null, 2), 'utf8');
  return { acquired: true, lockPath };
}

function releaseSentinelSingletonLock() {
  try {
    const lockPath = getSentinelLockPath();
    if (!fs.existsSync(lockPath)) return;
    const data = readJsonSafe(lockPath, null);
    if (data && Number(data.pid) === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch (e) {}
}

function withAtomicClaimLock(dataDir, fn) {
  const claimLockFile = path.join(dataDir, 'tasks.claim.lock');
  let fd = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      fd = fs.openSync(claimLockFile, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const st = fs.statSync(claimLockFile);
        if (Date.now() - st.mtimeMs > 10000) {
          fs.unlinkSync(claimLockFile);
          continue;
        }
      } catch (e) {}
      sleepSyncMs(15);
    }
  }
  if (fd === null) return false;
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch (e) {}
    try { fs.unlinkSync(claimLockFile); } catch (e) {}
  }
}

let watcher = null;
function cleanupAndExit(code = 0) {
  if (watcher) {
    try { watcher.close(); } catch (e) {}
    watcher = null;
  }
  releaseSentinelSingletonLock();
  process.exit(code);
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => {
  console.log('[SENTINEL_SUPERSEDED] 收到結束信號，哨兵安全退場。');
  cleanupAndExit(0);
});
process.on('exit', () => releaseSentinelSingletonLock());

// --- 主流程 ---

function determineTaskTier(task) {
  if (!task) return 'standard';

  // 1. 顯式 tier 欄位指定
  const explicitTier = String(task.tier || '').trim().toLowerCase();
  if (explicitTier === 'micro' || explicitTier === 'standard' || explicitTier === 'heavy') {
    return explicitTier;
  }

  // 2. 標籤 tags 判定
  const tags = Array.isArray(task.tags) ? task.tags.map(t => String(t).trim().toLowerCase()) : [];
  if (tags.some(t => t === 'tier:micro' || t === 'micro')) return 'micro';
  if (tags.some(t => t === 'tier:heavy' || t === 'heavy')) return 'heavy';
  if (tags.some(t => t === 'tier:standard' || t === 'standard')) return 'standard';

  // 3. riskDoor 為 one-way 時自動升級為 heavy
  if (task.riskDoor === 'one-way') return 'heavy';

  // 4. 複雜度標籤升級（編排、跨模型審查、任務拆解或多領域技能疊加）
  const heavyTags = ['orchestrator', 'cross-model-review', 'planning-and-task-breakdown', 'incremental-implementation'];
  if (tags.some(t => heavyTags.includes(t))) {
    return 'heavy';
  }
  const genericTypeTags = new Set(['feat', 'fix', 'docs', 'chore', 'test', 'style', 'perf', 'ci', 'build']);
  const domainSkillTags = tags.filter(t => t && !genericTypeTags.has(t));
  if (domainSkillTags.length >= 3) {
    return 'heavy';
  }

  // 5. 根據標題與描述關鍵字推斷
  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();

  const heavyKeywords = ['重構', 'refactor', '架構', 'architecture', 'migration', 'breaking', '資料庫遷移', 'one-way', '根據文件', '規劃執行', '串接 api', '串接api', '跨模組'];
  if (heavyKeywords.some(k => text.includes(k))) {
    return 'heavy';
  }

  const microKeywords = ['typo', '文案', '錯字', '註解', 'comment', 'readme', '微調', 'formatting', '格式化'];
  if (microKeywords.some(k => text.includes(k))) {
    return 'micro';
  }

  return 'standard';
}

const VERIFY_SKILL_IDS = ['code-review-and-quality', 'cross-model-review', 'write-tests'];
const IGNORE_SKILL_IDS = ['retrospective-and-learnings', 'git-commit', 'git-workflow-and-versioning', 'dev-server'];

function formatWakeupBrief(task, triggerType = 'WAKEUP_TRIGGERED') {
  let projPath = '';
  let p = null;
  const dataDir = getDataDir();
  try {
    const projFile = path.join(dataDir, 'projects.json');
    if (fs.existsSync(projFile)) {
      const projs = JSON.parse(fs.readFileSync(projFile, 'utf8'));
      p = projs.find(item => item.id === task.project);
      if (p && p.path) projPath = p.path;
    }
  } catch (e) {}

  if (task.requestCommitGen) {
    return `[${triggerType}] 任務請求依據 Diff 智慧產出 Commit 訊息：[${task.id}] ${task.title} (專案: ${task.project || '預設'}${projPath ? ` @ ${projPath}` : ''})\n` +
      `請檢閱當前專案 Git Diff，依據 Conventional Commit 規範產出結構化 commitMessage: { subject, body } 並推進。`;
  }

  const cleanDesc = (task.description || '無').replace(/\r?\n/g, ' ').trim();
  const feedbackText = task.feedback ? `\n• 【最高優先 Feedback】: ${task.feedback.replace(/\r?\n/g, ' ').trim()}` : '';

  let prioritySkillText = '';
  let implSkillsText = '';
  let verifySkillsText = '';

  const tier = determineTaskTier(task);
  const strategyText = formatTierStrategy(tier, resolveProvider(task));
  const gitnexusLine = projPath ? formatGitNexusGuidance(projPath) : '';
  const gitnexusText = gitnexusLine ? `\n${gitnexusLine}` : '';

  if (p && Array.isArray(p.skills) && p.skills.length > 0) {
    let matched = [];
    // 1. 若 task.tags 有明確命中專案 skill
    if (Array.isArray(task.tags) && task.tags.length > 0) {
      matched = p.skills.filter(s =>
        task.tags.some(t => {
          const cleanTag = String(t).trim().toLowerCase();
          return cleanTag === (s.id || '').toLowerCase() || cleanTag === (s.label || '').toLowerCase();
        })
      );
      if (matched.length > 0) {
        const skillLabel = tier === 'micro'
          ? '【指定專案 Skills (按需載入)】'
          : '【指定專案 Skills (於執行階段按需載入，Planning 階段禁讀)】';
        prioritySkillText = `\n• ${skillLabel}: ${matched.map(s => `${s.label || s.id} (${s.path || s.id})`).join('、')}`;
      }
    }

    // 2. 實作 Skills（僅在未命中指定 Skills 時才輸出全量實作清單，避免干擾主對話）
    if (matched.length === 0) {
      const implSkills = p.skills.filter(s => !VERIFY_SKILL_IDS.includes(s.id) && !IGNORE_SKILL_IDS.includes(s.id));
      if (implSkills.length > 0) {
        implSkillsText = `\n• 【專案實作 Skills】: ${implSkills.map(s => `${s.label || s.id} (${s.path || s.id})`).join('、')}`;
      }
    }

    // 3. 驗證 Skills 與 Harness
    const verifySkills = p.skills.filter(s => VERIFY_SKILL_IDS.includes(s.id));
    const harnessCmd = (p.harness && p.harness.command) ? p.harness.command : 'npm test';
    const verifyParts = [];
    if (verifySkills.length > 0) {
      verifyParts.push(verifySkills.map(s => `${s.label || s.id} (${s.path || s.id})`).join('、'));
    }
    verifyParts.push(`Harness: ${harnessCmd}`);
    verifySkillsText = `\n• 【專案驗證 Skills & Harness】: ${verifyParts.join(' | ')}`;
  }

  const ruleText = tier === 'micro'
    ? `• 執行規範: 依 ${STANDARD_DOC} 3-Phase Gate，以 grep-n 切片最小實作，Phase 3 須過 Pre-Commit 與 harness。`
    : `• 執行規範: 依 ${STANDARD_DOC} 3-Phase Gate（0 讀碼第 1 步 exit_plan_mode 交棒內建執行、>500 行 grep-n 切片、Phase 3 須過 Pre-Commit 與 harness）。`;

  const isPendingPlanCreation = Boolean(task.requiresConfirmation && (!task.executionPlan || !task.executionPlan.trim()));
  const confirmationText = isPendingPlanCreation
    ? `\n• 【需確認後執行門禁】: 目前待擬定執行計劃！請僅分析需求並呼叫 PUT http://localhost:3030/api/tasks/${task.id} 回寫 executionPlan（維持 status: in_progress，同時寫入 build-plan Handoff Contract），嚴禁直接實作或推進 review。`
    : '';

  const allowedList = Array.isArray(task.scope?.allowedFiles) ? task.scope.allowedFiles.filter(Boolean) : [];
  const outList = Array.isArray(task.scope?.outOfScope) ? task.scope.outOfScope.filter(Boolean) : [];
  const scopeParts = [];
  if (allowedList.length > 0) scopeParts.push(`允許: ${allowedList.join(', ')}`);
  scopeParts.push(`outOfScope: ${outList.length > 0 ? outList.join(', ') : '未授權跨模組/跨專案檔案'}`);
  const scopeLine = `• 邊界與 STOP AND ASK: ${scopeParts.join(' | ')}；遇規格疑問或觸及 outOfScope 嚴禁僅在 Chat 停等，須 PUT http://localhost:3030/api/tasks/${task.id} 寫入 pendingQuestions (含 options/recommended) 並重啟背景哨兵待命。`;

  const deliveryText = isPendingPlanCreation
    ? `PUT http://localhost:3030/api/tasks/${task.id} 回寫 executionPlan (維持 in_progress 待確認)，勿實作或推進 review；回寫後隨即重啟背景哨兵待命等待使用者確認。`
    : `PUT http://localhost:3030/api/tasks/${task.id} 傳入結構化 JSON (objective, rootCause, resolution, keyChanges, testCommand, exitCode, testSummary, assumptions, deviations, unverified, executionLog) 推進 review，隨即重啟背景哨兵待命。`;

  const worktreeLine = task.worktreePath
    ? `\n• 隔離工作區: ${task.worktreePath} (分支: ${task.branchName || `td/${task.id}`} ← ${task.targetBranch || task.baseBranch || 'main'})`
    : '';

  return `================================================================================\n` +
    `[${triggerType}] 任務開工通知${isPendingPlanCreation ? '（待擬定執行計劃）' : ''}：[${task.id}] ${task.title}\n` +
    `• 專案: ${task.project || '預設'}${projPath ? ` (${projPath})` : ''}${worktreeLine}\n` +
    `• 需求: ${cleanDesc}${feedbackText}${confirmationText}${prioritySkillText}${implSkillsText}${verifySkillsText}${gitnexusText}\n` +
    `${scopeLine}\n` +
    `${strategyText}\n` +
    `${ruleText}\n` +
    `• 交付方式: ${deliveryText}\n` +
    `================================================================================`;
}

function ensureWorktreeForSentinelTask(task) {
  try {
    if (!task || task.workspaceMode !== 'worktree') return null;
    if (task.worktreePath && fs.existsSync(task.worktreePath)) {
      return {
        worktreePath: task.worktreePath,
        branchName: task.branchName || `td/${task.id}`,
        baseCommit: task.baseCommit || '',
        baseBranch: task.baseBranch || task.targetBranch || 'main',
        targetBranch: task.targetBranch || task.baseBranch || 'main'
      };
    }

    const dataDir = getDataDir();
    const projFile = path.join(dataDir, 'projects.json');
    if (!fs.existsSync(projFile)) return null;
    const projs = JSON.parse(fs.readFileSync(projFile, 'utf8'));
    const p = Array.isArray(projs) ? projs.find(item => item && item.id === task.project) : null;
    const projPath = p && p.path ? p.path : '';
    const cleanRepo = projPath ? String(projPath).replace(/\/+$/, '') : '';
    if (!cleanRepo || !fs.existsSync(cleanRepo) || !fs.existsSync(path.join(cleanRepo, '.git'))) {
      return null;
    }

    let headBranch = 'main';
    try {
      headBranch = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8',
        timeout: 5000
      }).trim() || 'main';
    } catch (e) {}

    const targetBranch = String(task.targetBranch || task.baseBranch || headBranch || 'main').trim();
    const baseBranch = String(task.baseBranch || targetBranch).trim();
    let baseCommit = '';
    try {
      baseCommit = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', baseBranch], {
        encoding: 'utf8',
        timeout: 5000
      }).trim();
    } catch (e) {
      try {
        baseCommit = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', 'HEAD'], {
          encoding: 'utf8',
          timeout: 5000
        }).trim();
      } catch (e2) {}
    }

    const worktreePath = `${cleanRepo}.worktrees/${task.id}`;
    const branchName = `td/${task.id}`;

    try {
      execFileSync('git', ['-C', cleanRepo, 'worktree', 'prune'], { encoding: 'utf8', timeout: 5000, stdio: 'ignore' });
    } catch (e) {}
    if (fs.existsSync(worktreePath)) {
      try {
        execFileSync('git', ['-C', cleanRepo, 'worktree', 'remove', '--force', worktreePath], { encoding: 'utf8', timeout: 8000, stdio: 'ignore' });
      } catch (e) {
        try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch (e2) {}
      }
    }
    try {
      execFileSync('git', ['-C', cleanRepo, 'branch', '-D', branchName], { encoding: 'utf8', timeout: 5000, stdio: 'ignore' });
    } catch (e) {}

    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const startPoint = baseCommit || baseBranch || 'HEAD';
    execFileSync('git', ['-C', cleanRepo, 'worktree', 'add', '-b', branchName, worktreePath, startPoint], {
      encoding: 'utf8',
      timeout: 15000,
      stdio: 'ignore'
    });

    task.worktreePath = worktreePath;
    task.branchName = branchName;
    task.baseCommit = baseCommit;
    task.baseBranch = baseBranch;
    task.targetBranch = targetBranch;

    return { worktreePath, branchName, baseCommit, baseBranch, targetBranch };
  } catch (e) {
    return null;
  }
}

function claimTaskAndLogEvent(task) {
  if (!task || !task.id) return false;
  try {
    const dataDir = getDataDir();
    const tasksFile = path.join(dataDir, 'tasks.json');
    if (!fs.existsSync(tasksFile)) return false;

    return withAtomicClaimLock(dataDir, () => {
      const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
      const t = tasks.find(item => item && item.id === task.id);
      if (!t) return false;

      if (!t.requestCommitGen) {
        if (t.status !== 'in_progress') return false;
        if (isClaimAlive(t, claimerId)) return false;
        if (isPendingUserConfirmation(t) || isTaskCircuitBroken(t)) return false;
      }

      t.claimedBy = claimerId;
      t.claimedAt = new Date().toISOString();
      const wtInfo = ensureWorktreeForSentinelTask(t);
      if (wtInfo) {
        task.worktreePath = t.worktreePath;
        task.branchName = t.branchName;
        task.baseCommit = t.baseCommit;
        task.baseBranch = t.baseBranch;
        task.targetBranch = t.targetBranch;
      }
      fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), 'utf8');

      const eventsFile = path.join(dataDir, 'task-events.jsonl');
      const entry = {
        timestamp: new Date().toISOString(),
        taskId: t.id,
        type: 'task_claimed_by_sentinel',
        claimedBy: claimerId,
        claimedAt: t.claimedAt
      };
      fs.appendFileSync(eventsFile, JSON.stringify(entry) + '\n', 'utf8');
      return true;
    });
  } catch (e) {
    return false;
  }
}

module.exports = {
  determineTaskTier,
  formatWakeupBrief,
  findActionableTask,
  hasAllowedFilesOverlap,
  hasRepoConflict,
  ensureWorktreeForSentinelTask,
  isTaskCircuitBroken,
  hasPendingQuestions,
  isClaimAlive,
  acquireSentinelSingletonLock,
  releaseSentinelSingletonLock,
  claimTaskAndLogEvent
};

if (require.main === module) {
  const lockStatus = acquireSentinelSingletonLock();
  if (!lockStatus.acquired) {
    process.exit(0);
  }

  // 1. 若當前本來就已有進行中或請求 Commit 訊息之任務，立即退出喚醒開工
  const immediateTask = findActionableTask();
  if (immediateTask && claimTaskAndLogEvent(immediateTask)) {
    console.log(formatWakeupBrief(immediateTask, 'WAKEUP_IMMEDIATE'));
    cleanupAndExit(0);
  }

  console.log(`[WATCHER_ACTIVE] 任務哨兵已啟動 (指定 Agent: ${targetAgent || '全部通用'})，監聽目標: ${TASKS_FILE}`);
  console.log(`[WATCHER_WAITING] 靜默守候中 (0 Token 消耗)，等待${targetAgent ? ` [${targetAgent}] ` : ''}任務切換為 in_progress 或請求產出 Commit 訊息...`);

  let debounceTimer = null;

  function startWatching() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // 監聽父目錄以同時支援檔案直接覆寫與原子性替換 (Atomic Rename)
      watcher = fs.watch(DATA_DIR, (eventType, filename) => {
        if (filename && filename !== 'tasks.json' && !filename.includes('tasks.json')) {
          return;
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const task = findActionableTask();
          if (task && claimTaskAndLogEvent(task)) {
            console.log(formatWakeupBrief(task, 'WAKEUP_TRIGGERED'));
            cleanupAndExit(0);
          }
        }, 150);
      });

      watcher.on('error', () => {
        // 容錯重連
        setTimeout(startWatching, 1000);
      });
    } catch (e) {
      setTimeout(startWatching, 1000);
    }
  }

  startWatching();
}
