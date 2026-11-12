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
const { formatTierStrategy, resolveProvider } = require('../src/server/agentProviderAdapter');

const USER_HOME = process.env.HOME || os.homedir();
const DEFAULT_APP_SUPPORT_DIR = process.env.TASK_DASHBOARD_DATA_DIR || path.join(USER_HOME, 'Library/Application Support/TaskDashboard');

// 解析命令列參數 (例如 node watch-task-gate.js --agent=antigravity 或 --conversationId=conv_123)
let targetAgent = '';
let claimerId = process.env.CONVERSATION_ID || '';
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--agent=')) {
    targetAgent = arg.slice(8).trim().toLowerCase();
  } else if (arg.startsWith('-a=')) {
    targetAgent = arg.slice(3).trim().toLowerCase();
  } else if (arg.startsWith('--conversation=') || arg.startsWith('--conversationId=')) {
    claimerId = arg.split('=')[1].trim();
  } else if (arg.startsWith('--claimer=')) {
    claimerId = arg.split('=')[1].trim();
  }
});
if (!claimerId) {
  claimerId = `${targetAgent || 'sentinel'}-${process.pid}`;
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

const DATA_DIR = resolveDataDir();
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

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

function findActionableTask() {
  try {
    if (!fs.existsSync(TASKS_FILE)) return null;
    const content = fs.readFileSync(TASKS_FILE, 'utf8');
    const tasks = JSON.parse(content);
    return tasks.find(t => {
      if (!t) return false;
      // 若哨兵指定了 --agent，檢查任務的 assignee / assignedAgent 是否符合
      if (targetAgent) {
        const taskAgent = (t.assignedAgent || t.assignee || '').trim().toLowerCase();
        // 若任務有明確指定 agent 且不相符，跳過不認領（未指定或設為 all 則通用認領）
        if (taskAgent && taskAgent !== 'all' && taskAgent !== targetAgent) {
          return false;
        }
      }
      if (t.requestCommitGen === true) return true;
      if (t.status === 'in_progress') {
        // Conversation Lock 判定：若已被其他活躍視窗認領（15 分鐘內有效），則跳過避免雙重喚醒搶單
        if (t.claimedBy && t.claimedBy !== claimerId && t.claimedAt) {
          const pidMatch = String(t.claimedBy).match(/-(\d+)$/);
          const isOwnerAlive = pidMatch ? isPidAlive(pidMatch[1]) : true;
          if (isOwnerAlive) {
            const claimAgeMs = Date.now() - new Date(t.claimedAt).getTime();
            const CLAIM_TTL_MS = 15 * 60 * 1000;
            if (!isNaN(claimAgeMs) && claimAgeMs < CLAIM_TTL_MS) {
              return false;
            }
          }
        }
        // 若任務勾選需確認後再執行，且已經產出完整執行計劃，則處於「待確認」等待使用者審閱並點擊「確認並執行」，哨兵暫不喚醒開工
        const isPendingUserConfirmation = t.requiresConfirmation && t.executionPlan && t.executionPlan.trim().length > 0;
        if (isPendingUserConfirmation) return false;
        return true;
      }
      return false;
    }) || null;
  } catch (err) {
    // 檔案正在寫入中或暫時為空時忽略
    return null;
  }
}

let watcher = null;
function cleanupAndExit(code = 0) {
  if (watcher) {
    try { watcher.close(); } catch (e) {}
    watcher = null;
  }
  process.exit(code);
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));

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

  // 4. 根據標題與描述關鍵字推斷
  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();

  const heavyKeywords = ['重構', 'refactor', '架構', 'architecture', 'migration', 'breaking', '資料庫遷移', 'one-way'];
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
  try {
    const projFile = path.join(DATA_DIR, 'projects.json');
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

  if (p && Array.isArray(p.skills) && p.skills.length > 0) {
    // 1. 若 task.tags 有明確命中專案 skill
    if (Array.isArray(task.tags) && task.tags.length > 0) {
      const matched = p.skills.filter(s =>
        task.tags.some(t => {
          const cleanTag = String(t).trim().toLowerCase();
          return cleanTag === (s.id || '').toLowerCase() || cleanTag === (s.label || '').toLowerCase();
        })
      );
      if (matched.length > 0) {
        prioritySkillText = `\n• 【指定專案 Skills (優先必載)】: ${matched.map(s => `${s.label || s.id} (${s.path || s.id})`).join('、')}`;
      }
    }

    // 2. 實作 Skills
    const implSkills = p.skills.filter(s => !VERIFY_SKILL_IDS.includes(s.id) && !IGNORE_SKILL_IDS.includes(s.id));
    if (implSkills.length > 0) {
      implSkillsText = `\n• 【專案實作 Skills】: ${implSkills.map(s => `${s.label || s.id} (${s.path || s.id})`).join('、')}`;
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

  const tier = determineTaskTier(task);
  const strategyText = formatTierStrategy(tier, resolveProvider(task));

  const isPendingPlanCreation = Boolean(task.requiresConfirmation && (!task.executionPlan || !task.executionPlan.trim()));
  const confirmationText = isPendingPlanCreation
    ? `\n• 【需確認後執行門禁 (Confirmation Gate)】: 本任務勾選「需確認後再執行」（requiresConfirmation: true），目前處於待擬定計劃階段！請僅進行需求分析與擬定具體可行的執行計劃 (executionPlan)，並呼叫 PUT http://localhost:3030/api/tasks/${task.id} 回寫 executionPlan（維持 status: in_progress），嚴禁未獲使用者授權前直接實作代碼或推進 review！計劃同時寫入 build-plan Handoff Contract；確認後階段二直接依契約委派，不重新分析。請於回覆中提示使用者於儀表板審閱並點選「確認並執行」。`
    : '';

  const deliveryText = isPendingPlanCreation
    ? `擬定執行計劃並以 PUT http://localhost:3030/api/tasks/${task.id} 回寫 executionPlan (維持 in_progress 待使用者審閱確認)，請勿直接實作代碼或推進 review。`
    : `完成後以結構化 JSON 呼叫 PUT http://localhost:3030/api/tasks/${task.id} 推進 review（推薦欄位：objective, rootCause, resolution, keyChanges, testCommand, exitCode, testSummary, executionLog；後端支援各別名欄位智慧提取與自動組裝）。`;

  return `================================================================================\n` +
    `[${triggerType}] 任務開工通知${isPendingPlanCreation ? '（待擬定執行計劃）' : ''}：[${task.id}] ${task.title}\n` +
    `• 專案: ${task.project || '預設'}${projPath ? ` (${projPath})` : ''}\n` +
    `• 需求: ${cleanDesc}${feedbackText}${confirmationText}${prioritySkillText}${implSkillsText}${verifySkillsText}\n` +
    `${strategyText}\n` +
    `• 執行規範: 遵循 ${STANDARD_DOC} 3-Phase Gate；Phase 1 僅由主 Agent 執行一次；若需求包含【最新需求覆蓋】一律以其為最高優先；Executor 只讀 Handoff Contract，禁止重讀專案文件；僅跑受影響測試 + 專案 harness（無關基線紅燈僅註記）。\n` +
    `• 交付方式: ${deliveryText}\n` +
    `================================================================================`;
}

function claimTaskAndLogEvent(task) {
  try {
    if (!fs.existsSync(TASKS_FILE)) return;
    const tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    const t = tasks.find(item => item && item.id === task.id);
    if (t) {
      t.claimedBy = claimerId;
      t.claimedAt = new Date().toISOString();
      fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');

      const eventsFile = path.join(DATA_DIR, 'task-events.jsonl');
      const entry = {
        timestamp: new Date().toISOString(),
        taskId: t.id,
        type: 'task_claimed_by_sentinel',
        claimedBy: claimerId,
        claimedAt: t.claimedAt
      };
      fs.appendFileSync(eventsFile, JSON.stringify(entry) + '\n', 'utf8');
    }
  } catch (e) {}
}

module.exports = {
  determineTaskTier,
  formatWakeupBrief,
  findActionableTask
};

if (require.main === module) {
  // 1. 若當前本來就已有進行中或請求 Commit 訊息之任務，立即退出喚醒開工
  const immediateTask = findActionableTask();
  if (immediateTask) {
    claimTaskAndLogEvent(immediateTask);
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
          if (task) {
            claimTaskAndLogEvent(task);
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
