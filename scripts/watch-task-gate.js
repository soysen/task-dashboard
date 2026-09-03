#!/usr/bin/env node

/**
 * watch-task-gate.js
 * 
 * Task Dashboard - AI 哨兵即時守候門禁 (Reactive Wakeup Gate)
 * 適用於 Antigravity (run_command)、Claude (bash)、OpenAI Codex / Cursor (terminal) 等所有 Desktop AI。
 * 
 * 運作原理：
 * 1. 檢查 tasks.json 是否已有 status === 'in_progress' 的任務。若有，立即印出任務資訊並 exit(0)。
 * 2. 若無任務，透過 Node 原生 fs.watch (macOS 原生 FSEvents) 於背景靜默守候（0 Token 開銷）。
 * 3. 一旦偵測到任務狀態變更為 in_progress，立即印出 [WAKEUP_TRIGGERED] 並退出 (exit 0)。
 * 4. 外部 Desktop AI (Antigravity / Claude / Codex) 攔截到背景進程結束事件，觸發 Reactive Wakeup 瞬間開工。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const USER_HOME = process.env.HOME || os.homedir();
const DEFAULT_APP_SUPPORT_DIR = process.env.TASK_DASHBOARD_DATA_DIR || path.join(USER_HOME, 'Library/Application Support/TaskDashboard');

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

function findInProgressTask() {
  try {
    if (!fs.existsSync(TASKS_FILE)) return null;
    const content = fs.readFileSync(TASKS_FILE, 'utf8');
    const tasks = JSON.parse(content);
    if (!Array.isArray(tasks)) return null;
    return tasks.find(t => t && t.status === 'in_progress') || null;
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

// 1. 若當前本來就已有進行中任務，立即退出喚醒開工
const immediateTask = findInProgressTask();
if (immediateTask) {
  console.log(`[WAKEUP_IMMEDIATE] 偵測到已有進行中任務: [${immediateTask.id}] ${immediateTask.title} (專案: ${immediateTask.project || '預設'})`);
  cleanupAndExit(0);
}

console.log(`[WATCHER_ACTIVE] 任務哨兵已啟動，監聽目標: ${TASKS_FILE}`);
console.log(`[WATCHER_WAITING] 靜默守候中 (0 Token 消耗)，等待任務切換為 in_progress...`);

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
        const task = findInProgressTask();
        if (task) {
          console.log(`[WAKEUP_TRIGGERED] 任務狀態變更為 in_progress: [${task.id}] ${task.title} (專案: ${task.project || '預設'})`);
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
