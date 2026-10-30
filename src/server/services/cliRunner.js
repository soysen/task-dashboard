/**
 * cliRunner.js
 * 封裝 CLI Agent 行程啟動、Pulse Quota 配額熔斷與進程樹安全清理
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getCliRunsFilePath() {
  const dataDir = process.env.TASK_DASHBOARD_DATA_DIR || path.join(process.env.HOME || os.homedir(), 'Library/Application Support/TaskDashboard');
  return path.join(dataDir, 'cli-runs.json');
}

function loadPersistedQuota() {
  const today = new Date().toISOString().slice(0, 10);
  const filePath = getCliRunsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && data.date === today && typeof data.count === 'number') {
        return data;
      }
    }
  } catch (e) {}
  return { date: today, count: 0 };
}

function savePersistedQuota(quota) {
  const filePath = getCliRunsFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(quota, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving cli-runs.json:', e);
  }
}

let cliRunsToday = loadPersistedQuota();

function recordCliRun() {
  const today = new Date().toISOString().slice(0, 10);
  if (cliRunsToday.date !== today) {
    cliRunsToday = { date: today, count: 0 };
  }
  cliRunsToday.count++;
  savePersistedQuota(cliRunsToday);
  return cliRunsToday.count;
}

function getCliRunsToday() {
  const today = new Date().toISOString().slice(0, 10);
  // 重新從磁碟讀取以確保跨進程或重啟後資料同步
  const disk = loadPersistedQuota();
  if (disk.date === today) {
    cliRunsToday = disk;
  } else if (cliRunsToday.date !== today) {
    cliRunsToday = { date: today, count: 0 };
  }
  return cliRunsToday.count;
}

/**
 * 級聯清理子進程樹 (Process Group Kill)，避免背景殘留孤兒進程
 * @param {ChildProcess} child
 * @param {string} signal
 */
function killProcessTree(child, signal = 'SIGTERM') {
  if (!child || !child.pid) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (e) {
    try { child.kill(signal); } catch (e2) {}
  }
}

/**
 * 清理 Map 中所有進行中的 CLI 行程
 * @param {Map} activeCliProcesses
 */
function cleanupAllCliProcesses(activeCliProcesses) {
  if (!activeCliProcesses || typeof activeCliProcesses.entries !== 'function') return;
  for (const [taskId, procInfo] of activeCliProcesses.entries()) {
    if (procInfo && procInfo.child) {
      killProcessTree(procInfo.child, 'SIGTERM');
    }
  }
}

/**
 * 解析組裝包含 {prompt} 模板的自訂 CLI 命令
 * @param {string} rawCmd
 * @param {string} promptText
 * @returns {string}
 */
function buildCliCommand(rawCmd, promptText) {
  const trimmed = (rawCmd || 'hermes').trim();
  const escapedPrompt = promptText.replace(/"/g, '\\"');

  if (trimmed.includes('{prompt}') || trimmed.includes('{PROMPT}')) {
    return trimmed.replace(/{prompt}/gi, '"' + escapedPrompt + '"');
  }

  // --yolo MUST come before -z (argparse: -z expects one argument; reversed order causes parse error)
  if (/^hermes(\s|$)/.test(trimmed) && !trimmed.includes('-z') && !trimmed.includes('-q') && !trimmed.includes('chat')) {
    return trimmed + ' --yolo -z "' + escapedPrompt + '"';
  }
  if (/^claude(\s|$)/.test(trimmed) && !trimmed.includes('-p')) {
    return trimmed + ' -p "' + escapedPrompt + '"';
  }

  return trimmed + ' "' + escapedPrompt + '"';
}

module.exports = {
  recordCliRun,
  getCliRunsToday,
  killProcessTree,
  cleanupAllCliProcesses,
  buildCliCommand
};
