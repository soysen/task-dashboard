/**
 * taskStorage.js
 * 封裝 SSOT 資料庫存取 (tasks.json / tasks-archived.json / projects.json / settings.json)、原子寫入與快取防護
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { healTasksFeedback, normalizeLogText } = require('../feedbackManager');
const { setReadTasksProvider } = require('../worklogParser');
const { scanProjectGithubInfo } = require('./harnessService');

const USER_HOME = process.env.HOME || os.homedir();
const BASE_DATA_DIR = process.env.TASK_DASHBOARD_DATA_DIR || path.join(USER_HOME, 'Library/Application Support/TaskDashboard');
const SETTINGS_FILE = path.join(BASE_DATA_DIR, 'settings.json');
const MARKDOWN_DASHBOARD = path.join(USER_HOME, '.gemini/antigravity/scratch/dashboard.md');
const PROJECTS_ROOT = path.join(USER_HOME, 'projects');

let lastValidProjects = [];
let lastValidTasks = [];
let projectsCache = { mtimeMs: 0, path: '', timestamp: 0, data: [] };
let tasksCache = { mtimeMs: 0, path: '', data: [] };
let archivedTasksCache = { mtimeMs: 0, path: '', data: [] };

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

function readSettings() {
  let settings = {
    enableCliAgent: false,
    cliCommand: 'agy',
    defaultProject: 'task-dashboard',
    autoTriggerOnInProgress: true,
    dataDirectoryPath: '',
    fontSize: 'small',
    cliTimeoutMinutes: 20,
    dailyCliRunCap: 30,
    initialized: true
  };

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const baseCfg = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      settings = { ...settings, ...baseCfg };
    }
  } catch (err) {
    console.error('Error reading base settings.json:', err);
  }

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

function writeSettings(settings) {
  try {
    if (!fs.existsSync(BASE_DATA_DIR)) {
      fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');

    const customDir = settings.dataDirectoryPath ? settings.dataDirectoryPath.trim() : '';
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
    const filesToMove = ['tasks.json', 'projects.json', 'settings.json', 'watch-task-gate.js'];
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

function getArchivedTasksFilePath() {
  return path.join(resolveDataDir(), 'tasks-archived.json');
}

function getProjectsFilePath() {
  return path.join(resolveDataDir(), 'projects.json');
}

function getTaskEventsFilePath() {
  return path.join(resolveDataDir(), 'task-events.jsonl');
}

function appendTaskEvent(event = {}) {
  try {
    const file = getTaskEventsFilePath();
    const entry = {
      timestamp: new Date().toISOString(),
      ...event
    };
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('Error appending task event:', err);
  }
}

function safeAtomicWriteJson(filePath, data) {
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
}

function cleanTaskForArchive(task) {
  if (!task || typeof task !== 'object') return task;
  const { projectPath, projectDocs, projectSkills, projectHarness, sliceInfo, liveStatus, ...rest } = task;
  const stringFields = ['executionLog', 'executionPlan', 'description', 'feedback'];
  stringFields.forEach(field => {
    if (rest[field] !== undefined && rest[field] !== null && typeof rest[field] !== 'string') {
      rest[field] = normalizeLogText(rest[field]);
    }
  });
  const baseDir = resolveDataDir();
  const diffDir = path.join(baseDir, 'diffs');

  if (rest.diff && typeof rest.diff === 'string' && rest.diff.length > 2048 && !rest.diffPath) {
    try {
      if (!fs.existsSync(diffDir)) {
        fs.mkdirSync(diffDir, { recursive: true });
      }
      const diffFile = path.join(diffDir, `${rest.id}.diff`);
      fs.writeFileSync(diffFile, rest.diff, 'utf8');
      rest.diffPath = `diffs/${rest.id}.diff`;
      rest.diff = rest.diff.slice(0, 1500) + '\n\n... (全量完整 Diff 已抽離至 ' + rest.diffPath + ' 檔案保存)';
    } catch (err) {
      console.error(`Error saving diff for archived task ${rest.id}:`, err);
    }
  }
  return rest;
}

function readArchivedTasks() {
  try {
    const file = getArchivedTasksFilePath();
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (archivedTasksCache.path === file && archivedTasksCache.mtimeMs === stat.mtimeMs && Array.isArray(archivedTasksCache.data)) {
        return archivedTasksCache.data.map(t => ({ ...t }));
      }
      const raw = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        const hasChanges = healTasksFeedback(data);
        if (hasChanges) {
          try {
            safeAtomicWriteJson(file, data);
          } catch (e) {}
        }
        archivedTasksCache = { mtimeMs: stat.mtimeMs, path: file, data };
        return data.map(t => ({ ...t }));
      }
    }
  } catch (err) {
    console.error('Error reading tasks-archived.json:', err);
    if (Array.isArray(archivedTasksCache.data) && archivedTasksCache.data.length > 0) {
      return archivedTasksCache.data.map(t => ({ ...t }));
    }
  }
  return Array.isArray(archivedTasksCache.data) ? archivedTasksCache.data.map(t => ({ ...t })) : [];
}

function writeArchivedTasks(archivedList) {
  try {
    const file = getArchivedTasksFilePath();
    const list = Array.isArray(archivedList) ? archivedList : [];
    const cleanedList = list.map(t => cleanTaskForArchive(t));
    cleanedList.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    safeAtomicWriteJson(file, cleanedList);
    try {
      const stat = fs.statSync(file);
      archivedTasksCache = { mtimeMs: stat.mtimeMs, path: file, data: cleanedList };
    } catch (e) {
      archivedTasksCache = { mtimeMs: Date.now(), path: file, data: cleanedList };
    }
  } catch (err) {
    console.error('Error writing tasks-archived.json:', err);
  }
}

function archiveTasksAndFilter(tasks) {
  if (!Array.isArray(tasks)) return [];
  const toArchive = tasks.filter(t => t.status === 'archived');
  const activeTasks = tasks.filter(t => t.status !== 'archived');
  if (toArchive.length > 0) {
    const existingArchived = readArchivedTasks();
    const map = new Map();
    existingArchived.forEach(t => map.set(t.id, t));
    toArchive.forEach(t => {
      const cleaned = cleanTaskForArchive(t);
      map.set(cleaned.id, cleaned);
    });
    const merged = Array.from(map.values());
    writeArchivedTasks(merged);
  }
  return activeTasks;
}

function readProjects() {
  try {
    const file = getProjectsFilePath();
    if (fs.existsSync(file)) {
      const now = Date.now();
      const stat = fs.statSync(file);
      if (projectsCache.path === file && projectsCache.mtimeMs === stat.mtimeMs && (now - projectsCache.timestamp < 5000) && Array.isArray(projectsCache.data) && projectsCache.data.length > 0) {
        return projectsCache.data;
      }
      const raw = fs.readFileSync(file, 'utf8');
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        let hasRedundantKeys = false;
        const cleaned = saved.map(p => {
          const projPath = p.path || p.projectPath || (p.id ? path.join(PROJECTS_ROOT, p.id) : '');
          const githubInfo = scanProjectGithubInfo(projPath);

          if ('projectPath' in p || 'projectDocs' in p || 'projectSkills' in p || 'projectHarness' in p) {
            hasRedundantKeys = true;
          }

          const { projectPath, projectDocs, projectSkills, projectHarness, ...cleanItem } = p;

          return {
            ...cleanItem,
            id: p.id,
            name: p.name || p.id,
            description: p.description || '',
            path: projPath,
            color: p.color || 'indigo',
            conversations: p.conversations || [],
            docs: githubInfo.docs,
            skills: githubInfo.skills,
            prompts: githubInfo.prompts,
            harness: githubInfo.harness
          };
        });

        if (hasRedundantKeys) {
          try {
            safeAtomicWriteJson(file, cleaned);
          } catch (e) {}
        }

        if (cleaned.length > 0) {
          lastValidProjects = cleaned;
        }
        try {
          const newStat = fs.statSync(file);
          projectsCache = { mtimeMs: newStat.mtimeMs, path: file, timestamp: Date.now(), data: cleaned };
        } catch (e) {
          projectsCache = { mtimeMs: stat.mtimeMs, path: file, timestamp: Date.now(), data: cleaned };
        }
        return cleaned;
      }
    }
  } catch (err) {
    console.error('Error reading projects.json:', err);
    if (lastValidProjects.length > 0) {
      console.warn(' [SafeGuard] projects.json 讀取暫態異常，使用上一輪有效快取 (' + lastValidProjects.length + ' 個專案)');
      return lastValidProjects;
    }
  }
  return lastValidProjects.length > 0 ? lastValidProjects : [];
}

function writeProjects(projects) {
  try {
    const file = getProjectsFilePath();
    if (Array.isArray(projects) && projects.length > 0) {
      lastValidProjects = projects;
    }
    safeAtomicWriteJson(file, projects);
    projectsCache = { mtimeMs: 0, path: '', timestamp: 0, data: [] };
  } catch (err) {
    console.error('Error writing projects.json:', err);
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

function readTasks() {
  try {
    const file = getTasksFilePath();
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (tasksCache.path === file && tasksCache.mtimeMs === stat.mtimeMs && Array.isArray(tasksCache.data)) {
        return tasksCache.data.map(t => ({ ...t }));
      }
      const raw = fs.readFileSync(file, 'utf8');
      const tasks = JSON.parse(raw);
      if (Array.isArray(tasks)) {
        const hasArchived = tasks.some(t => t.status === 'archived');
        let activeTasks = tasks;
        if (hasArchived) {
          activeTasks = archiveTasksAndFilter(tasks);
        }
        const hasChanges = healTasksFeedback(activeTasks, (t) => {
          appendTaskEvent({ taskId: t.id, type: 'shim_triggered', shimId: 'GATE-002', action: 'healTasksFeedback' });
        });
        if (hasArchived || hasChanges) {
          try {
            safeAtomicWriteJson(file, activeTasks);
            syncToMarkdown(activeTasks);
          } catch (e) {}
        }
        try {
          const newStat = fs.statSync(file);
          tasksCache = { mtimeMs: newStat.mtimeMs, path: file, data: activeTasks };
        } catch (e) {
          tasksCache = { mtimeMs: stat.mtimeMs, path: file, data: activeTasks };
        }
        if (activeTasks.length > 0) {
          lastValidTasks = activeTasks;
        }
        return activeTasks.map(t => ({ ...t }));
      }
    }
  } catch (err) {
    console.error('Error reading tasks.json:', err);
    if (lastValidTasks.length > 0) {
      console.warn(' [SafeGuard] tasks.json 讀取暫態異常，使用上一輪有效快取 (' + lastValidTasks.length + ' 個任務)');
      return lastValidTasks.map(t => ({ ...t }));
    }
  }
  return lastValidTasks.length > 0 ? lastValidTasks.map(t => ({ ...t })) : [];
}
setReadTasksProvider(readTasks);

function writeTasks(tasks) {
  try {
    const file = getTasksFilePath();
    let listToWrite = Array.isArray(tasks) ? tasks : [];
    const hasArchived = listToWrite.some(t => t.status === 'archived');
    if (hasArchived) {
      listToWrite = archiveTasksAndFilter(listToWrite);
    }
    healTasksFeedback(listToWrite, (t) => {
      appendTaskEvent({ taskId: t.id, type: 'shim_triggered', shimId: 'GATE-002', action: 'healTasksFeedback' });
    });
    if (listToWrite.length > 0) {
      lastValidTasks = listToWrite;
    }
    safeAtomicWriteJson(file, listToWrite);
    try {
      const stat = fs.statSync(file);
      tasksCache = { mtimeMs: stat.mtimeMs, path: file, data: listToWrite };
    } catch (e) {
      tasksCache = { mtimeMs: Date.now(), path: file, data: listToWrite };
    }
    syncToMarkdown(listToWrite);
  } catch (err) {
    console.error('Error writing tasks.json:', err);
  }
}

function getNextTaskId(tasks) {
  let maxId = 0;
  const inspectList = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach(t => {
      if (t && t.id && typeof t.id === 'string') {
        const match = t.id.match(/\d+/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (num > maxId) maxId = num;
        }
      }
    });
  };
  inspectList(tasks);
  inspectList(readArchivedTasks());
  return `TASK-${String(maxId + 1).padStart(3, '0')}`;
}

module.exports = {
  readSettings,
  checkConfigIntegrity,
  writeSettings,
  migrateConfigDirectory,
  resolveDataDir,
  getTasksFilePath,
  getArchivedTasksFilePath,
  getProjectsFilePath,
  getTaskEventsFilePath,
  appendTaskEvent,
  safeAtomicWriteJson,
  cleanTaskForArchive,
  readArchivedTasks,
  writeArchivedTasks,
  archiveTasksAndFilter,
  readProjects,
  writeProjects,
  readTasks,
  writeTasks,
  syncToMarkdown,
  getNextTaskId
};
