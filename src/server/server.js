const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec, execFile, execSync, spawn } = require('child_process');

const os = require('os');

const PORT = process.env.PORT || 3030;
const USER_HOME = process.env.HOME || os.homedir();
const APP_SUPPORT_DATA_DIR = path.join(USER_HOME, 'Library/Application Support/TaskDashboard');

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

// 若 Application Support 尚未有資料，且專案目錄下有 data，自動遷移/複製過來作為初始資料
['tasks.json', 'projects.json', 'settings.json'].forEach(file => {
  const dest = path.join(BASE_DATA_DIR, file);
  const src = path.join(PROJECT_DATA_DIR, file);
  if (!fs.existsSync(dest) && fs.existsSync(src)) {
    try {
      fs.copyFileSync(src, dest);
    } catch (e) {}
  }
});

let lastInspectionTime = null;
let lastInspectionResult = { inspectedAt: null, updatedCount: 0, inProgressCount: 0, status: 'idle' };

function readSettings() {
  let settings = {
    enableCliAgent: false,
    cliCommand: 'agy',
    defaultProject: 'task-dashboard',
    autoTriggerOnInProgress: true,
    dataDirectoryPath: '',
    fontSize: 'small',
    initialized: true
  };

  // 1. 讀取 Application Support 目錄的 settings.json
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const baseCfg = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      settings = { ...settings, ...baseCfg };
    }
  } catch (err) {
    console.error('Error reading base settings.json:', err);
  }

  // 2. 讀取自訂外部路徑內的 settings.json (若有特別設定且與 BASE_DATA_DIR 不同)
  const customDir = settings.dataDirectoryPath ? settings.dataDirectoryPath.trim() : '';
  if (customDir && customDir !== BASE_DATA_DIR) {
    let resolved = customDir;
    if (resolved.startsWith('~')) {
      resolved = path.join(USER_HOME, resolved.slice(1));
    }
    const customSettingsFile = path.join(resolved, 'settings.json');
    if (fs.existsSync(customSettingsFile)) {
      try {
        const customCfg = JSON.parse(fs.readFileSync(customSettingsFile, 'utf8'));
        settings = { ...settings, ...customCfg, dataDirectoryPath: customDir };
      } catch (err) {
        console.error('Error reading custom settings.json:', err);
      }
    }
  }

  settings.defaultDataDir = BASE_DATA_DIR;
  return checkConfigIntegrity(settings);
}

function checkConfigIntegrity(settings) {
  const customDir = settings.dataDirectoryPath ? settings.dataDirectoryPath.trim() : '';
  if (customDir && customDir !== BASE_DATA_DIR) {
    let resolved = customDir;
    if (resolved.startsWith('~')) {
      resolved = path.join(USER_HOME, resolved.slice(1));
    }
    const tasksPath = path.join(resolved, 'tasks.json');
    const projectsPath = path.join(resolved, 'projects.json');
    if (!fs.existsSync(resolved) || !fs.existsSync(tasksPath) || !fs.existsSync(projectsPath)) {
      settings.configMissing = true;
    }
  }
  return settings;
}

function writeSettings(settings) {
  try {
    // 1. 寫入 Application Support 目錄
    if (!fs.existsSync(BASE_DATA_DIR)) {
      fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');

    // 2. 若使用者有自訂非預設外部資料夾，同步寫入
    let customDir = settings.dataDirectoryPath ? settings.dataDirectoryPath.trim() : '';
    let resolved = customDir;
    if (resolved.startsWith('~')) {
      resolved = path.join(USER_HOME, resolved.slice(1));
    }
    if (resolved && resolved !== BASE_DATA_DIR) {
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      const customSettingsFile = path.join(resolved, 'settings.json');
      fs.writeFileSync(customSettingsFile, JSON.stringify(settings, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Error writing settings.json:', err);
  }
}

function migrateConfigDirectory(oldDir, newDir) {
  if (!oldDir || !newDir || oldDir === newDir) return;
  try {
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }
    const filesToMove = ['tasks.json', 'projects.json', 'settings.json'];
    filesToMove.forEach(file => {
      const oldPath = path.join(oldDir, file);
      const newPath = path.join(newDir, file);
      if (fs.existsSync(oldPath)) {
        fs.copyFileSync(oldPath, newPath);
        if (oldDir !== BASE_DATA_DIR) {
          try { fs.unlinkSync(oldPath); } catch (e) {}
        }
      }
    });
    console.log(`[Config Migration] Successfully migrated config files from ${oldDir} to ${newDir}`);
  } catch (err) {
    console.error('Error migrating config directory:', err);
  }
}

function resolveDataDir() {
  const settings = readSettings();
  let customDir = settings.dataDirectoryPath ? settings.dataDirectoryPath.trim() : '';
  if (customDir.startsWith('~')) {
    customDir = path.join(USER_HOME, customDir.slice(1));
  }
  const targetDir = customDir || BASE_DATA_DIR;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const targetTasksFile = path.join(targetDir, 'tasks.json');
  const targetProjectsFile = path.join(targetDir, 'projects.json');
  const targetSettingsFile = path.join(targetDir, 'settings.json');

  if (!fs.existsSync(targetTasksFile)) {
    fs.writeFileSync(targetTasksFile, '[]', 'utf8');
  }

  if (!fs.existsSync(targetProjectsFile)) {
    fs.writeFileSync(targetProjectsFile, '[]', 'utf8');
  }

  if (!fs.existsSync(targetSettingsFile)) {
    fs.writeFileSync(targetSettingsFile, JSON.stringify(settings, null, 2), 'utf8');
  }

  return targetDir;
}

function getTasksFilePath() {
  return path.join(resolveDataDir(), 'tasks.json');
}

function getProjectsFilePath() {
  return path.join(resolveDataDir(), 'projects.json');
}

function scanProjectGithubInfo(projPath) {
  const info = {
    skills: [],
    prompts: [],
    harness: {
      hasHarness: false,
      command: '',
      files: []
    },
    docs: []
  };

  if (!projPath || !fs.existsSync(projPath)) return info;

  // 1. 掃描 .github/skills
  const skillsDir = path.join(projPath, '.github', 'skills');
  if (fs.existsSync(skillsDir)) {
    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
          let label = entry.name;
          let desc = '專案專屬 Skill';
          if (fs.existsSync(skillFile)) {
            try {
              const content = fs.readFileSync(skillFile, 'utf8');
              const nameMatch = content.match(/name:\s*([^\n\r]+)/i);
              const descMatch = content.match(/description:\s*([^\n\r]+)/i);
              if (nameMatch) label = nameMatch[1].replace(/^["']|["']$/g, '').trim();
              if (descMatch) desc = descMatch[1].replace(/^["']|["']$/g, '').trim().slice(0, 45);
            } catch (e) {}
          }
          info.skills.push({
            id: entry.name,
            label: label || entry.name,
            desc: desc || '專案技能',
            path: `.github/skills/${entry.name}`,
            type: 'github_skill'
          });
        }
      }
    } catch (e) {}
  }

  // 2. 掃描 .github/prompts
  const promptsDir = path.join(projPath, '.github', 'prompts');
  if (fs.existsSync(promptsDir)) {
    try {
      const files = fs.readdirSync(promptsDir);
      for (const file of files) {
        if (file.endsWith('.prompt.md') || file.endsWith('.md')) {
          const id = file.replace(/\.prompt\.md$/, '').replace(/\.md$/, '');
          info.prompts.push({
            id,
            label: file,
            desc: 'GitHub Prompt 指令',
            path: `.github/prompts/${file}`,
            type: 'github_prompt'
          });
        }
      }
    } catch (e) {}
  }

  // 3. 檢測 Harness (HARNESS.md, scripts/harness_check.sh, package.json scripts)
  const harnessMd = path.join(projPath, 'HARNESS.md');
  const harnessScript = path.join(projPath, 'scripts', 'harness_check.sh');
  const pkgPath = path.join(projPath, 'package.json');
  let hasHarnessScript = false;

  if (fs.existsSync(harnessMd)) info.harness.files.push('HARNESS.md');
  if (fs.existsSync(harnessScript)) {
    info.harness.files.push('scripts/harness_check.sh');
    info.harness.command = 'bash scripts/harness_check.sh';
    hasHarnessScript = true;
  }

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts['harness:check']) {
        info.harness.command = 'npm run harness:check';
        hasHarnessScript = true;
      } else if (pkg.scripts && pkg.scripts['test']) {
        if (!info.harness.command) info.harness.command = 'npm test';
      }
    } catch (e) {}
  }

  info.harness.hasHarness = hasHarnessScript || info.harness.files.length > 0;

  // 4. 檢測架構文檔
  ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', 'README.md'].forEach(doc => {
    if (fs.existsSync(path.join(projPath, doc))) {
      info.docs.push(doc);
    }
  });

  return info;
}

function scanLocalProjects() {
  const scanned = [];
  try {
    if (fs.existsSync(PROJECTS_ROOT)) {
      const items = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('.')) {
          const projPath = path.join(PROJECTS_ROOT, item.name);
          let name = item.name;
          let description = `本機專案路徑: ~/projects/${item.name}`;
          let color = 'indigo';

          const pkgPath = path.join(projPath, 'package.json');
          if (fs.existsSync(pkgPath)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
              if (pkg.description) description = pkg.description;
              if (pkg.name) name = `${item.name} (${pkg.name})`;
            } catch (e) {}
          }

          if (item.name.includes('cdp') || item.name.includes('campaign')) color = 'purple';
          else if (item.name.includes('fetnet') || item.name.includes('fetix') || item.name.includes('service')) color = 'blue';
          else if (item.name.includes('plan') || item.name.includes('build') || item.name.includes('harness')) color = 'emerald';
          else if (item.name.includes('kgi') || item.name.includes('invest')) color = 'amber';
          else if (item.name.includes('langfuse') || item.name.includes('ai')) color = 'rose';

          const githubInfo = scanProjectGithubInfo(projPath);

          scanned.push({
            id: item.name,
            name: item.name,
            description,
            path: projPath,
            color,
            conversations: [],
            skills: githubInfo.skills,
            prompts: githubInfo.prompts,
            harness: githubInfo.harness,
            docs: githubInfo.docs
          });
        }
      }
    }
  } catch (err) {
    console.error('Error scanning ~/projects:', err);
  }
  return scanned;
}

function readProjects() {
  try {
    const file = getProjectsFilePath();
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(saved)) {
        // 動態注入最新的 .github skills 與 harness 資訊
        return saved.map(p => {
          const projPath = p.path || (p.id ? path.join(PROJECTS_ROOT, p.id) : '');
          const githubInfo = scanProjectGithubInfo(projPath);
          return {
            ...p,
            skills: githubInfo.skills,
            prompts: githubInfo.prompts,
            harness: githubInfo.harness,
            docs: githubInfo.docs
          };
        });
      }
    }
  } catch (err) {
    console.error('Error reading projects.json:', err);
  }
  return [];
}

function writeProjects(projects) {
  try {
    const file = getProjectsFilePath();
    fs.writeFileSync(file, JSON.stringify(projects, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing projects.json:', err);
  }
}

function readTasks() {
  try {
    const file = getTasksFilePath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading tasks.json:', err);
  }
  return [];
}

function writeTasks(tasks) {
  try {
    const file = getTasksFilePath();
    fs.writeFileSync(file, JSON.stringify(tasks, null, 2), 'utf8');
    syncToMarkdown(tasks);
  } catch (err) {
    console.error('Error writing tasks.json:', err);
  }
}

function syncToMarkdown(tasks) {
  try {
    const todo = tasks.filter(t => t.status === 'todo');
    const inProgress = tasks.filter(t => t.status === 'in_progress');
    const review = tasks.filter(t => t.status === 'review');
    const done = tasks.filter(t => t.status === 'done');

    const mdDir = path.dirname(MARKDOWN_DASHBOARD);
    if (!fs.existsSync(mdDir)) {
      fs.mkdirSync(mdDir, { recursive: true });
    }

    let md = `#  Task Dashboard 任務看板\n\n`;
    md += `> 最後同步時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}\n\n`;
    md += `##  進行中 (In Progress) [${inProgress.length}]\n`;
    if (inProgress.length === 0) md += `*尚無進行中任務*\n\n`;
    else inProgress.forEach(t => { md += `- **[${t.priority || 'P1'}] ${t.id} ${t.title}** (${t.project || 'default'})\n  - ${t.description || '無描述'}\n`; });

    md += `\n##  待處理 (Todo) [${todo.length}]\n`;
    if (todo.length === 0) md += `*尚無待處理任務*\n\n`;
    else todo.forEach(t => { md += `- **[${t.priority || 'P2'}] ${t.id} ${t.title}** (${t.project || 'default'})\n`; });

    md += `\n##  待審查 (Review) [${review.length}]\n`;
    if (review.length === 0) md += `*尚無待審查任務*\n\n`;
    else review.forEach(t => { md += `- **${t.id} ${t.title}** (${t.project || 'default'})\n`; });

    md += `\n##  已完成 (Done) [${done.length}]\n`;
    if (done.length === 0) md += `*尚無已完成任務*\n\n`;
    else done.slice(0, 10).forEach(t => { md += `- [x] **${t.id} ${t.title}**\n`; });

    fs.writeFileSync(MARKDOWN_DASHBOARD, md, 'utf8');
  } catch (err) {
    console.error('Error syncing markdown dashboard:', err);
  }
}

// ============================================
// 收集完整 Git Diff，包含已追蹤與未追蹤檔案
// ============================================
function collectGitDiff(projPath, customEnv, callback) {
  const statusCmd = 'git -C "' + projPath + '" status --porcelain -uall';
  exec(statusCmd, { env: customEnv, timeout: 10000, maxBuffer: 20 * 1024 * 1024 }, (statusErr, statusStdout) => {
    if (statusErr || !statusStdout || !statusStdout.trim()) {
      return callback([], '');
    }

    const lines = statusStdout.split('\n').filter(l => l.length >= 4);
    const modifiedList = lines.map(l => l.slice(3).trim()).filter(Boolean);
    const untrackedLines = lines.filter(l => l.startsWith('??'));

    // 收集已追蹤檔案的 diff (git diff HEAD)
    exec('git -C "' + projPath + '" diff HEAD', { env: customEnv, timeout: 15000, maxBuffer: 20 * 1024 * 1024 }, (diffErr, diffContent) => {
      let diffResult = (!diffErr && diffContent && diffContent.trim()) ? diffContent : '';

      // 收集未追蹤檔案的內容 (git diff --no-index /dev/null <file>)
      if (untrackedLines.length > 0 && !diffErr) {
        let pendingCount = untrackedLines.length;
        const untrackedDiffs = [];

        untrackedLines.forEach(line => {
          const filePath = line.slice(3).trim();
          if (!filePath) {
            pendingCount--;
            if (pendingCount === 0) finalize();
            return;
          }

          // 使用 --no-index 將 /dev/null 與未追蹤檔案比較，產生 diff 格式內容
          exec('git -C "' + projPath + '" --no-pager diff --no-index /dev/null "' + filePath + '"', { env: customEnv, timeout: 5000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (!err && stdout && stdout.trim()) {
              untrackedDiffs.push(stdout);
            } else if (err && (err.code === 1 || err.code === 128) && stdout && stdout.trim()) {
              // git diff --no-index 在有差異時會返回 exit code 1，但 stdout 仍有 diff 內容
              untrackedDiffs.push(stdout);
            }
            pendingCount--;
            if (pendingCount === 0) finalize();
          });
        });

        function finalize() {
          if (untrackedDiffs.length > 0) {
            diffResult += '\n\n' + untrackedDiffs.join('\n\n');
          }
          callback(modifiedList, diffResult);
        }
      } else {
        callback(modifiedList, diffResult);
      }
    });
  });
}

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

setInterval(probeLiveActiveTasks, 2500);

function getLogsDir() {
  const dir = path.join(resolveDataDir(), 'logs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// 觸發 CLI Agent 執行任務 (改為串流 Spawn + 實體日誌 + Smart Git 交付閘門)
function executeTaskWithCliAgent(taskId) {
  const settings = readSettings();
  if (!settings.enableCliAgent) {
    console.log('[CLI Agent] 模式未啟用，略過自動執行 (Task: ' + taskId + ')');
    return;
  }

  // 避免同一任務重複啟動多個 CLI 行程
  if (activeCliProcesses.has(taskId)) {
    console.log(' [CLI Agent] 任務 ' + taskId + ' 已有行程正在執行中，略過重複觸發。');
    return;
  }

  const tasks = readTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const projects = readProjects();
  const proj = projects.find(p => p.id === task.project);
  const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, task.project || '');

  console.log(' [CLI Agent 引擎] 啟動執行任務: ' + task.id + ' - ' + task.title + ' (目錄: ' + projPath + ')');

  const feedbackSection = task.feedback ? '\n【審查退回意見 / 修復要求】\n' + task.feedback + '\n' : '';
  const promptText = '【任務執行指示】\n' +
    '任務 ID: ' + task.id + '\n' +
    '任務名稱: ' + task.title + '\n' +
    '所屬專案: ' + task.project + '\n' +
    '工作目錄: ' + projPath + '\n' +
    '\n詳細需求描述:\n' + (task.description || '無詳細描述') + '\n' +
    feedbackSection +
    '執行規範與驗收要求：\n' +
    '1. 請先檢閱專案內文檔與架構規範（如 AGENTS.md, README.md, package.json）。\n' +
    '2. 在專案目錄下完成相應實作與代碼修改。\n' +
    '3. 實作完成後執行測試或診斷指令驗證並回報結果。\n' +
    '4. 交付時必須擷取全量完整無截斷之 git diff（包含已追蹤與未追蹤檔案），填寫 modifiedFiles, diff 與 executionLog 並推進 status 至 review。';

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

  // 設定負責人為 CLI
  task.assignee = 'CLI';

  // 建立實體日誌檔案
  const logFile = path.join(getLogsDir(), `${taskId}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  // 記錄開始日誌
  const startLog = '[' + new Date().toISOString() + ']  CLI Agent 自動觸發 (' + rawCliCmd + ')\n' +
    '目標專案: ' + projPath + '\n' +
    '任務: ' + task.title + '\n' +
    '日誌檔案: ' + logFile + '\n' +
    '----------------------------------------\n';
  logStream.write(startLog);
  task.executionLog = (task.executionLog || '') + '\n' + startLog;
  writeTasks(tasks);

  try {
    const child = spawn(bin, args, {
      cwd: projPath,
      env: customEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    activeCliProcesses.set(taskId, {
      child,
      startTime: Date.now(),
      logFile,
      projPath,
      recentLines: ['[System] CLI Agent 行程已啟動...'],
      lastLine: 'CLI Agent 行程已啟動，開始分析任務...',
      liveModifiedFiles: []
    });

    let liveOutputBuffer = '';
    const MAX_BUFFER_SIZE = 100 * 1024; // 100KB cap to prevent unbounded memory growth

    const handleChunk = (chunk) => {
      const text = chunk.toString();
      liveOutputBuffer += text;
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
      console.error(' [CLI Agent 引擎] 行程啟動錯誤 (Task: ' + taskId + '):', err);
      logStream.write('\n 行程啟動錯誤: ' + err.message + '\n');
    });

    child.on('close', (code, signal) => {
      activeCliProcesses.delete(taskId);
      logStream.end();

      console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 行程結束 (Code: ' + code + ', Signal: ' + signal + ')，執行智慧交付驗收...');

      // Smart Git Delivery Gate: 檢查專案是否產出變更
      collectGitDiff(projPath, customEnv, (modifiedList, diffContent) => {
        const updatedTasks = readTasks();
        const curTask = updatedTasks.find(t => t.id === taskId);
        if (!curTask) return;

        curTask.assignee = 'CLI';
        curTask.updatedAt = new Date().toISOString();

        const hasGitChanges = Array.isArray(modifiedList) && modifiedList.length > 0;
        const isSuccess = (code === 0) || hasGitChanges;

        let logTail = liveOutputBuffer.trim();
        if (logTail.length > 2000) {
          logTail = logTail.slice(-2000);
        }

        if (isSuccess) {
          // 判定成功：推進至 review
          const endLog = '\n[' + new Date().toISOString() + ']  CLI Agent 執行完畢 (Exit code: ' + (code !== null ? code : '0') + ')\n' +
            '變更檔案: ' + (hasGitChanges ? modifiedList.join(', ') : '無檔案變更 (代碼檢核/測試無誤)') + '\n' +
            (logTail ? '\n--- 執行日誌末端摘要 ---\n' + logTail + '\n' : '') +
            '----------------------------------------\n';
          curTask.executionLog = (curTask.executionLog || '') + endLog;
          curTask.status = 'review';
          curTask.modifiedFiles = modifiedList || [];
          curTask.diff = diffContent || '';
          curTask._retryCount = 0;
          writeTasks(updatedTasks);
          syncToMarkdown(updatedTasks);
          console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 驗收通過，已推進至 Review！');
        } else {
          // 失敗且完全無任何變更產出
          const retryCount = (curTask._retryCount || 0);
          if (retryCount < 2) {
            const retryLog = '\n[' + new Date().toISOString() + ']  CLI Agent 執行異常 (Exit code: ' + code + ') 且無代碼產出，正在重試 (' + (retryCount + 1) + '/2)...\n----------------------------------------\n';
            curTask.executionLog = (curTask.executionLog || '') + retryLog;
            curTask._retryCount = retryCount + 1;
            writeTasks(updatedTasks);
            syncToMarkdown(updatedTasks);
            setTimeout(() => executeTaskWithCliAgent(taskId), 5000);
          } else {
            const failLog = '\n[' + new Date().toISOString() + ']  CLI Agent 執行失敗 (Exit code: ' + code + ')，無變更產出。\n' +
              (logTail ? '\n--- 錯誤日誌摘要 ---\n' + logTail + '\n' : '') +
              '----------------------------------------\n';
            curTask.executionLog = (curTask.executionLog || '') + failLog;
            curTask.status = 'todo';
            curTask._retryCount = 0;
            writeTasks(updatedTasks);
            syncToMarkdown(updatedTasks);
            console.error(' [CLI Agent 引擎] 任務 ' + taskId + ' 執行失敗，已重置為 Todo。');
          }
        }
      });
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
      collectGitDiff(projPath, customEnv, (modifiedList, diffContent) => {
        const freshTasks = readTasks();
        const target = freshTasks.find(item => item.id === t.id && item.status === 'in_progress');
        if (target) {
          const logFile = path.join(getLogsDir(), `${t.id}.log`);
          let logContent = '';
          if (fs.existsSync(logFile)) {
            try { logContent = fs.readFileSync(logFile, 'utf8'); } catch (e) {}
          }

          if (logContent.includes('CLI Agent 執行完畢') || logContent.includes(' CLI Agent 執行完畢')) {
            target.status = 'review';
            target.modifiedFiles = modifiedList || [];
            target.diff = diffContent || '';
            target.updatedAt = new Date().toISOString();
            target.executionLog = (target.executionLog || '') +
              '\n[' + new Date().toISOString() + ']  [Auto-Reconcile] 偵測到 CLI Agent 已完成執行，狀態對齊推進至 Review。\n----------------------------------------\n';
            writeTasks(freshTasks);
            syncToMarkdown(freshTasks);
            console.log(' [Auto-Reconcile] 任務 ' + t.id + ' 狀態自動對齊推進至 Review！');
          }
        }
      });
    }
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
setInterval(reconcileTasks, 30000);

function getNextTaskId(tasks) {
  let maxId = 0;
  tasks.forEach(t => {
    if (t.id && typeof t.id === 'string') {
      const match = t.id.match(/\d+/);
      if (match) {
        const num = parseInt(match[0], 10);
        if (num > maxId) maxId = num;
      }
    }
  });
  return `TASK-${String(maxId + 1).padStart(3, '0')}`;
}

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

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API 路由 ---

  // 系統設定 (CLI Agent 開關與指令)
  if (pathname === '/api/settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(readSettings()));
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
    runNativeFolderPicker('請選擇要加入 Task Dashboard 的專案資料夾', (err, selectedPath) => {
      if (!selectedPath) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ canceled: true }));
        return;
      }
      const folderName = path.basename(selectedPath);
      const projects = readProjects();
      let proj = projects.find(p => p.path === selectedPath || p.id === folderName);
      if (!proj) {
        proj = {
          id: folderName,
          name: folderName,
          description: `自訂專案路徑: ${selectedPath}`,
          path: selectedPath,
          color: 'teal',
          conversations: []
        };
        projects.push(proj);
        writeProjects(projects);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, project: proj }));
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
        const newProj = {
          id: data.id,
          name: data.name || data.id,
          description: data.description || '',
          path: data.path || path.join(PROJECTS_ROOT, data.id),
          color: data.color || 'indigo',
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
    const tasks = readTasks();
    const enriched = tasks.map(t => {
      if (t.status === 'in_progress') {
        const proc = activeCliProcesses.get(t.id);
        if (proc) {
          const elapsed = Math.max(0, Math.floor((Date.now() - proc.startTime) / 1000));
          return {
            ...t,
            liveStatus: {
              isRunning: true,
              elapsedSeconds: elapsed,
              currentAction: proc.lastLine || 'CLI Agent 正在執行中...',
              liveModifiedFiles: proc.liveModifiedFiles || [],
              recentTail: (proc.recentLines || []).slice(-20).join('\n')
            }
          };
        }
      }
      return t;
    });
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
        const tasks = readTasks();
        const newId = getNextTaskId(tasks);
        const newTask = {
          id: newId,
          title: data.title,
          description: data.description || '',
          status: data.status || 'todo',
          priority: data.priority || 'P1',
          project: data.project || 'task-dashboard',
          conversationId: data.conversationId || '',
          assignee: data.assignee || 'Antigravity',
          tags: Array.isArray(data.tags) ? data.tags : (data.tags ? data.tags.split(',').map(s => s.trim()).filter(Boolean) : []),
          dependencies: Array.isArray(data.dependencies) ? data.dependencies : (data.dependencies ? [data.dependencies] : []),
          modifiedFiles: data.modifiedFiles || [],
          diff: data.diff || '',
          executionLog: data.executionLog || '',
          feedback: data.feedback || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        tasks.push(newTask);
        writeTasks(tasks);

        // 若新增任務直接為 in_progress，立即觸發 CLI Agent 執行
        if (newTask.status === 'in_progress') {
          executeTaskWithCliAgent(newTask.id);
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newTask));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
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
        const tasks = readTasks();
        const index = tasks.findIndex(t => t.id === taskId);
        if (index === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task not found' }));
          return;
        }
        const prevStatus = tasks[index].status;
        tasks[index] = {
          ...tasks[index],
          ...data,
          id: taskId,
          tags: Array.isArray(data.tags) ? data.tags : (data.tags ? data.tags.split(',').map(s => s.trim()).filter(Boolean) : tasks[index].tags),
          dependencies: data.dependencies !== undefined ? (Array.isArray(data.dependencies) ? data.dependencies : [data.dependencies]) : (tasks[index].dependencies || []),
          modifiedFiles: Array.isArray(data.modifiedFiles) ? data.modifiedFiles : (tasks[index].modifiedFiles || []),
          updatedAt: new Date().toISOString()
        };
        writeTasks(tasks);

        // 若狀態切換為 in_progress，立即啟動 CLI Agent 執行！
        if (tasks[index].status === 'in_progress' && prevStatus !== 'in_progress') {
          executeTaskWithCliAgent(taskId);
        }

        // 若狀態切換為 review（無論是手動拖曳或 API 呼叫），自動補齊目標專案的 Git Diff
        if (tasks[index].status === 'review' && prevStatus !== 'review') {
          const projects = readProjects();
          const proj = projects.find(p => p.id === tasks[index].project);
          const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, tasks[index].project || '');
          const customEnv = buildCustomEnv();
          collectGitDiff(projPath, customEnv, (modifiedList, diffContent) => {
            const freshTasks = readTasks();
            const freshTask = freshTasks.find(t => t.id === taskId);
            if (freshTask) {
              freshTask.modifiedFiles = modifiedList;
              freshTask.diff = diffContent;
              writeTasks(freshTasks);
              syncToMarkdown(freshTasks);
              console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 自動收集 Git 變更 (' + modifiedList.length + ' 個檔案) 完畢！');
            }
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tasks[index]));
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

  // 手動觸發 CLI Agent 執行指定任務
  if (pathname.match(/^\/api\/tasks\/([^/]+)\/trigger-agent$/) && req.method === 'POST') {
    const taskId = decodeURIComponent(pathname.split('/')[3] || '').trim();
    executeTaskWithCliAgent(taskId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: `CLI Agent 已觸發任務 ${taskId}` }));
    return;
  }

const GIT_COMMIT_TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'chore', 'docs', 'style', 'ci', 'build'];

function formatCommitMessageFromSkill(projPath, task, diffStat, modifiedFiles) {
  const skillFile = path.join(projPath, '.github/skills/git-workflow-and-versioning/SKILL.md');
  const promptFile = path.join(projPath, '.github/prompts/commit.prompt.md');
  let skillName = null;
  if (fs.existsSync(skillFile)) {
    skillName = '.github/skills/git-workflow-and-versioning';
  } else if (fs.existsSync(promptFile)) {
    skillName = '.github/prompts/commit.prompt.md';
  }

  const rawTitle = (task.title || 'Update task').trim();

  // 1. 決定 type (feat, fix, refactor, style, perf, test, docs, chore, revert)
  let type = '';
  if (Array.isArray(task.tags)) {
    const found = task.tags.find(t => ['feat', 'fix', 'refactor', 'style', 'perf', 'test', 'docs', 'chore', 'revert'].includes(t.toLowerCase().trim()));
    if (found) type = found.toLowerCase().trim();
  }
  if (!type) {
    if (/修復|修正|fix|error|bug|錯/i.test(rawTitle)) type = 'fix';
    else if (/優化|改善|提升|perf|optimize/i.test(rawTitle)) type = 'perf';
    else if (/重構|refactor/i.test(rawTitle)) type = 'refactor';
    else if (/樣式|style|版面|排版|css|scss/i.test(rawTitle)) type = 'style';
    else if (/文件|doc|readme/i.test(rawTitle)) type = 'docs';
    else if (/測試|test/i.test(rawTitle)) type = 'test';
    else type = 'feat';
  }

  // 2. 決定 scope (依據 .github/skills 的建議 scope: ui, api, store, router, auth, event, order, report, build, deps, server...)
  let scope = '';
  const filesStr = ((modifiedFiles || []).join(' ') + ' ' + (diffStat || '')).toLowerCase();
  if (filesStr.includes('order-management') || filesStr.includes('order')) scope = 'order';
  else if (filesStr.includes('server.js') || filesStr.includes('/server/')) scope = 'server';
  else if (filesStr.includes('index.html') || filesStr.includes('views') || filesStr.includes('scss') || filesStr.includes('css') || filesStr.includes('component')) scope = 'ui';
  else if (filesStr.includes('router')) scope = 'router';
  else if (filesStr.includes('store') || filesStr.includes('redux') || filesStr.includes('vuex')) scope = 'store';
  else if (filesStr.includes('api') || filesStr.includes('service')) scope = 'api';
  else if (filesStr.includes('auth') || filesStr.includes('login') || filesStr.includes('permission')) scope = 'auth';
  else if (filesStr.includes('package.json') || filesStr.includes('scripts') || filesStr.includes('build')) scope = 'build';

  // 3. 處理 subject (去除既有 conventional 前綴，保留乾淨主旨)
  let cleanTitle = rawTitle.replace(/^(feat|fix|refactor|style|perf|test|docs|chore|revert)(\([^)]+\))?:\s*/i, '').trim();

  let finalMsg = '';
  if (skillName && scope) {
    finalMsg = `${type}(${scope}): ${cleanTitle}`;
  } else if (scope && !rawTitle.startsWith(`${type}(`)) {
    finalMsg = `${type}(${scope}): ${cleanTitle}`;
  } else {
    finalMsg = `${type}: ${cleanTitle}`;
  }

  return { message: finalMsg, skillName, type, scope };
}

function formatCommitMessage(task) {
  const rawTitle = (task.title || 'Update task').trim();
  const conventionalRegex = /^(feat|fix|refactor|perf|test|chore|docs|style|ci|build)(\([^)]+\))?:\s*/i;
  if (conventionalRegex.test(rawTitle)) {
    return rawTitle;
  }
  let gitType = '';
  if (Array.isArray(task.tags)) {
    const found = task.tags.find(t => GIT_COMMIT_TYPES.includes(t.toLowerCase().trim()));
    if (found) gitType = found.toLowerCase().trim();
  }
  if (!gitType) gitType = 'feat';
  return `${gitType}: ${rawTitle}`;
}

function executeProjectCommit(projPath, task, customData = {}) {
  if (!fs.existsSync(projPath) || !fs.existsSync(path.join(projPath, '.git'))) {
    return { output: '專案非 Git 版本控制目錄，已記錄狀態並封存', isCommitted: true };
  }

  // 1. Step 1: 環境確認 & Staging
  try { execSync('git add -A', { cwd: projPath, timeout: 5000 }); } catch (e) {}

  let statusOutput = '';
  try { statusOutput = execSync('git status --short', { cwd: projPath, encoding: 'utf8', timeout: 3000 }).trim(); } catch (e) {}
  
  if (!statusOutput) {
    return { output: '無新異動需要 commit (Working tree clean)', isCommitted: false };
  }

  let diffStat = '';
  try { diffStat = execSync('git diff --cached --stat', { cwd: projPath, encoding: 'utf8', timeout: 3000 }).trim(); } catch (e) {}

  let stagedFiles = [];
  try {
    const rawFiles = execSync('git diff --cached --name-only', { cwd: projPath, encoding: 'utf8', timeout: 3000 }).trim();
    stagedFiles = rawFiles.split('\n').filter(Boolean);
  } catch (e) {}

  // 2. 檢測 .github/ 內之 Commit Skill
  const { message: autoMsg, skillName } = formatCommitMessageFromSkill(projPath, task, diffStat, stagedFiles);

  // 處理自訂標題與內文
  let subject = (customData.subject || customData.customSubject || autoMsg).trim();
  let bodyText = (customData.body !== undefined ? customData.body : (customData.customBody !== undefined ? customData.customBody : (task.description || ''))).trim();

  // 若標題未包含 conventional prefix 且無自訂 subject，自動補齊
  if (!/^(feat|fix|refactor|style|perf|test|docs|chore|revert)(\([^)]+\))?:\s*/i.test(subject)) {
    subject = formatCommitMessage({ ...task, title: subject });
  }

  let fullCommitMsg = subject;
  if (bodyText) {
    fullCommitMsg = `${subject}\n\n${bodyText}`;
  }

  const safeFullMsg = fullCommitMsg.replace(/"/g, '\\"');

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
            timeout: 15000,
            env: { ...process.env, COMMIT_MESSAGE: safeFullMsg, TASK_ID: task.id || '' }
          }).trim();
          return { output: `[Commit Skill: npm run commit]\n${out}`, isCommitted: true };
        } catch (npmErr) {
          const npmOut = (npmErr.stdout || npmErr.message || '').toString().trim();
          if (npmOut.includes('file changed') || npmOut.includes('insertion') || npmOut.includes('deletion')) {
            return { output: `[Commit Skill: npm run commit]\n${npmOut}`, isCommitted: true };
          }
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
        timeout: 15000,
        env: { ...process.env, COMMIT_MESSAGE: safeFullMsg, TASK_ID: task.id || '' }
      }).trim();
      return { output: `[Commit Skill: scripts/commit.sh]\n${out}`, isCommitted: true };
    } catch (scriptErr) {
      const sOut = (scriptErr.stdout || scriptErr.message || '').toString().trim();
      if (sOut.includes('file changed') || sOut.includes('insertion') || sOut.includes('deletion')) {
        return { output: `[Commit Skill: scripts/commit.sh]\n${sOut}`, isCommitted: true };
      }
    }
  }

  // C. 依據 .github 內 Commit Skill 規範執行多行提交
  try {
    let commitCmd = `git commit -m "${subject.replace(/"/g, '\\"')}"`;
    if (bodyText) {
      commitCmd += ` -m "${bodyText.replace(/"/g, '\\"')}"`;
    }
    const commitOutput = execSync(commitCmd, { cwd: projPath, encoding: 'utf8', timeout: 5000 }).trim();
    let lastLog = '';
    try { lastLog = execSync('git log --oneline -1', { cwd: projPath, encoding: 'utf8', timeout: 3000 }).trim(); } catch (e) {}
    
    if (skillName) {
      return {
        output: `[Commit Skill: ${skillName}]\n✅ 依據專案 .github Skill 規範提交成功！\n- Commit: ${lastLog}\n- 格式: ${subject}\n\n${commitOutput}`,
        isCommitted: true
      };
    }

    return { output: commitOutput, isCommitted: true };
  } catch (commitErr) {
    const commitOutput = commitErr.stdout ? commitErr.stdout.toString().trim() : (commitErr.message || '無新異動需要 commit');
    const isCommitted = commitOutput.includes('file changed') || commitOutput.includes('insertion') || commitOutput.includes('deletion');
    return { output: commitOutput, isCommitted };
  }
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
      try {
        const resObj = executeProjectCommit(projPath, task, customData);
        commitOutput = resObj.output;
        isCommitted = resObj.isCommitted;
      } catch (err) {
        commitOutput = err.message || '已處理 Commit';
      }

      // commit 後將該專案所有已完成 (done) 的任務全部封存 (archived)
      const archivedIds = [];
      const nowIso = new Date().toISOString();
      tasks.forEach(t => {
        if ((t.project === task.project || (!t.project && !task.project)) && (t.status === 'done' || t.id === task.id)) {
          t.status = 'archived';
          t.updatedAt = nowIso;
          archivedIds.push(t.id);
        }
      });
      writeTasks(tasks);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: commitOutput, archivedTaskIds: archivedIds }));
    });
    return;
  }

  // 查詢所有專案的 Git Diff 狀態 (是否有未提交異動)
  if (pathname === '/api/git/projects-status' && req.method === 'GET') {
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // 查詢單一檔案的 Git Diff (即時從本機 Git 讀取)
  if (pathname === '/api/git/file-diff' && req.method === 'GET') {
    const projId = query.projectId;
    const targetFilePath = query.filePath;
    
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
        const cleanPath = targetFilePath.replace(/^[^/]+\//, '');
        try {
          diffOutput = execSync(`git diff HEAD~1 -- "${cleanPath}"`, { cwd: projPath, encoding: 'utf8', timeout: 5000 }).trim();
        } catch (e1) {
          try {
            diffOutput = execSync(`git log -p -1 -- "${cleanPath}"`, { cwd: projPath, encoding: 'utf8', timeout: 5000 }).trim();
          } catch (e2) {
            try {
              diffOutput = execSync(`git diff -- "${cleanPath}"`, { cwd: projPath, encoding: 'utf8', timeout: 5000 }).trim();
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
        let filtered;
        if (data.allArchived) {
          filtered = tasks.filter(t => t.status !== 'archived');
        } else if (Array.isArray(data.taskIds)) {
          const idsSet = new Set(data.taskIds);
          filtered = tasks.filter(t => !idsSet.has(t.id));
        } else {
          filtered = tasks;
        }
        writeTasks(filtered);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: tasks.length - filtered.length }));
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
        const nowIso = new Date().toISOString();
        let restoredCount = 0;
        if (Array.isArray(data.taskIds)) {
          const idsSet = new Set(data.taskIds);
          tasks.forEach(t => {
            if (idsSet.has(t.id) && t.status === 'archived') {
              t.status = 'done';
              t.updatedAt = nowIso;
              restoredCount++;
            }
          });
        }
        writeTasks(tasks);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: restoredCount }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 刪除單一任務
  if (pathname.startsWith('/api/tasks/') && req.method === 'DELETE') {
    const taskId = decodeURIComponent(pathname.replace('/api/tasks/', '')).trim();
    const tasks = readTasks();
    const filtered = tasks.filter(t => t.id !== taskId);
    if (tasks.length === filtered.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }
    writeTasks(filtered);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, deleted: taskId }));
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(` Task Dashboard Server running at http://localhost:${PORT}`);
  console.log(` Single Source of Truth: ${ROOT_DIR}`);
  syncToMarkdown(readTasks());
});
