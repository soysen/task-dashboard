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

function formatWakeupBrief(task, triggerType = 'WAKEUP_TRIGGERED') {
  let projPath = '';
  try {
    const projFile = path.join(DATA_DIR, 'projects.json');
    if (fs.existsSync(projFile)) {
      const projs = JSON.parse(fs.readFileSync(projFile, 'utf8'));
      const p = projs.find(item => item.id === task.project);
      if (p && p.path) projPath = p.path;
    }
  } catch (e) {}

  if (task.requestCommitGen) {
    return `[${triggerType}] 任務請求依據 Diff 智慧產出 Commit 訊息：[${task.id}] ${task.title} (專案: ${task.project || '預設'}${projPath ? ` @ ${projPath}` : ''})\n` +
      `請檢閱當前專案 Git Diff，依據 Conventional Commit 規範產出結構化 commitMessage: { subject, body } 並推進。`;
  }

  const feedbackText = task.feedback ? `\n• 【最高優先 Feedback】: ${task.feedback}` : '';

  let skillsText = '';
  try {
    const projFile = path.join(DATA_DIR, 'projects.json');
    if (fs.existsSync(projFile)) {
      const projs = JSON.parse(fs.readFileSync(projFile, 'utf8'));
      const p = projs.find(item => item.id === task.project);
      if (p && Array.isArray(p.skills) && p.skills.length > 0) {
        let selected = [];
        if (Array.isArray(task.tags) && task.tags.length > 0) {
          selected = p.skills.filter(s => {
            return task.tags.some(t => {
              const cleanTag = String(t).trim().toLowerCase();
              return cleanTag === (s.id || '').toLowerCase() || cleanTag === (s.label || '').toLowerCase();
            });
          });
        }

        if (selected.length > 0) {
          skillsText = `\n• 【任務指定專案 Skills (必須優先載入遵循)】: ${selected.map(m => `${m.label} (${m.path || m.id})`).join('、')}`;
        } else {
          const fullText = `${task.title} ${task.description || ''} ${(task.tags || []).join(' ')}`.toLowerCase();
          const matched = p.skills.filter(s => {
            const l = (s.label || s.id || '').toLowerCase();
            const d = (s.desc || '').toLowerCase();
            if (fullText.includes('ui') || fullText.includes('切版') || fullText.includes('css')) return l.includes('web') || l.includes('ui') || d.includes('ui');
            if (fullText.includes('test') || fullText.includes('測試')) return l.includes('test') || d.includes('test');
            if (fullText.includes('api') || fullText.includes('後端') || fullText.includes('server')) return l.includes('api') || d.includes('api');
            return false;
          }).slice(0, 2);
          if (matched.length > 0) {
            skillsText = `\n• 【推薦動態 Skills】: ${matched.map(m => `${m.label} (${m.path || m.id})`).join('、')}`;
          }
        }
      }
    }
  } catch (e) {}

  const tier = determineTaskTier(task);
  let strategyText = '';
  if (tier === 'micro') {
    strategyText = `• 執行策略 (Tier: micro 原地實作): 由主 Agent 原地直接實作與驗證，不啟動額外附屬代理。`;
  } else if (tier === 'heavy') {
    strategyText = `• 執行策略 (Tier: heavy 雙階審核): 若環境支援 Subagent 啟用 flash 實作 + pro 審核雙階模式。`;
  } else {
    strategyText = `• 執行策略 (Tier: standard 單階實作): 若環境支援 Subagent 啟用單一 flash Subagent 實作，主 Agent 跑確定性驗證。`;
  }

  return `================================================================================\n` +
    `[${triggerType}] 任務開工通知：[${task.id}] ${task.title}\n` +
    `• 專案: ${task.project || '預設'}${projPath ? ` (${projPath})` : ''}\n` +
    `• 需求: ${task.description || '無'}${feedbackText}${skillsText}\n` +
    `${strategyText}\n` +
    `• 執行規範: 遵循 docs/AUTOMATION_STANDARD.md 3-Phase Gate；完成後以結構化 JSON 呼叫 PUT /api/tasks/${task.id} 推進 review (勿手寫報告)。\n` +
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
