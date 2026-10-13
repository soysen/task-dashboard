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

// 解析命令列參數 (例如 node watch-task-gate.js --agent=antigravity 或 --agent=claude)
let targetAgent = '';
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--agent=')) {
    targetAgent = arg.slice(8).trim().toLowerCase();
  } else if (arg.startsWith('-a=')) {
    targetAgent = arg.slice(3).trim().toLowerCase();
  }
});

// 1. 動態解析真實資料庫目錄 (Single Source of Truth)
function resolveDataDir() {
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
  return `================================================================================\n` +
    `[${triggerType}] 任務開工通知：[${task.id}] ${task.title}\n` +
    `• 專案: ${task.project || '預設'}${projPath ? ` (${projPath})` : ''}\n` +
    `• 需求: ${task.description || '無'}${feedbackText}\n\n` +
    `【Task Dashboard 3-Phase Gate 平台執行標準】：\n` +
    `1. Phase 1 (Pre-Flight): 優先滿足 Feedback；檢閱專案文檔與執行 Harness 驗證；>500 行大檔一律以 grep-n 切片檢索；若勾選需確認後執行且 executionPlan 為空，須先填妥執行計劃供確認。\n` +
    `2. Phase 2 (Implementation): 遵循目錄規範最小範圍實作並補齊測試，嚴禁跨專案副作用。\n` +
    `3. Phase 3 (Review Promotion): 執行測試通過 (Exit Code 0)；撰寫標準結構化『任務執行報告 (Task Execution Report)』(含目標與根因、解決方案與核心異動、歷次審查因應、品質驗證與交付證明、原生輸出折疊)；恪遵 Chat-Report Symmetry 對齊原則；呼叫 API (PUT /api/tasks/${task.id}) 或回寫 tasks.json 推進至 review。\n` +
    `================================================================================`;
}

// 1. 若當前本來就已有進行中或請求 Commit 訊息之任務，立即退出喚醒開工
const immediateTask = findActionableTask();
if (immediateTask) {
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
