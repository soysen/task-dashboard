const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec, execFile, execSync, spawn } = require('child_process');

const os = require('os');

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

  // 3. 檢測 Harness (HARNESS.md, .github/harness, .github/scripts/harness-cli.js, scripts/harness_check.sh, package.json scripts)
  const harnessMd = path.join(projPath, 'HARNESS.md');
  const harnessDir = path.join(projPath, '.github', 'harness');
  const harnessCliScript = path.join(projPath, '.github', 'scripts', 'harness-cli.js');
  const harnessScript = path.join(projPath, 'scripts', 'harness_check.sh');
  const pkgPath = path.join(projPath, 'package.json');
  let hasHarnessFound = false;

  if (fs.existsSync(harnessMd)) {
    info.harness.files.push('HARNESS.md');
    hasHarnessFound = true;
  }

  if (fs.existsSync(harnessDir)) {
    hasHarnessFound = true;
    try {
      const hEntries = fs.readdirSync(harnessDir);
      for (const ent of hEntries) {
        if (ent.endsWith('.md')) {
          info.harness.files.push(`.github/harness/${ent}`);
        }
      }
    } catch (e) {}
  }

  if (fs.existsSync(harnessCliScript)) {
    info.harness.files.push('.github/scripts/harness-cli.js');
    hasHarnessFound = true;
  }

  if (fs.existsSync(harnessScript)) {
    info.harness.files.push('scripts/harness_check.sh');
    hasHarnessFound = true;
  }

  // 決定最適 Harness / 測試執行命令
  let pkgScripts = {};
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkgScripts = pkg.scripts || {};
    } catch (e) {}
  }

  if (pkgScripts['harness:check:ai']) {
    info.harness.command = 'npm run harness:check:ai';
  } else if (pkgScripts['harness:check']) {
    info.harness.command = 'npm run harness:check';
  } else if (fs.existsSync(harnessCliScript)) {
    info.harness.command = 'node .github/scripts/harness-cli.js check --ai';
  } else if (pkgScripts['harness:validate']) {
    info.harness.command = 'npm run harness:validate';
  } else if (pkgScripts['harness:verify']) {
    info.harness.command = 'npm run harness:verify';
  } else if (fs.existsSync(harnessScript)) {
    info.harness.command = 'bash scripts/harness_check.sh';
  } else if (pkgScripts['test:unit']) {
    info.harness.command = 'npm run test:unit';
  } else if (pkgScripts['test']) {
    info.harness.command = 'npm test';
  } else if (fs.existsSync(path.join(projPath, 'nx.json'))) {
    info.harness.command = 'npx nx test';
    hasHarnessFound = true;
  } else if (fs.existsSync(path.join(projPath, 'pubspec.yaml'))) {
    info.harness.command = 'flutter test';
    hasHarnessFound = true;
  } else if (fs.existsSync(path.join(projPath, 'Cargo.toml'))) {
    info.harness.command = 'cargo test';
    hasHarnessFound = true;
  } else if (fs.existsSync(path.join(projPath, 'pytest.ini')) || (fs.existsSync(path.join(projPath, 'tests')) && fs.existsSync(path.join(projPath, 'pyproject.toml')))) {
    info.harness.command = 'pytest';
    hasHarnessFound = true;
  } else if (pkgScripts['lint']) {
    info.harness.command = 'npm run lint';
  } else if (pkgScripts['build']) {
    info.harness.command = 'npm run build';
  }

  info.harness.hasHarness = hasHarnessFound || Boolean(info.harness.command) || (info.harness.files.length > 0);

  // 4. 檢測架構文檔與 RFC 規範
  ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', 'README.md', 'HARNESS.md', 'docs/STATE_MACHINE_RFC.md'].forEach(doc => {
    if (fs.existsSync(path.join(projPath, doc)) && !info.docs.includes(doc)) {
      info.docs.push(doc);
    }
  });

  // 加入 .github/harness 文檔至 docs
  if (fs.existsSync(harnessDir)) {
    try {
      const hFiles = fs.readdirSync(harnessDir).filter(f => f.endsWith('.md'));
      hFiles.forEach(f => {
        const docName = `.github/harness/${f}`;
        if (!info.docs.includes(docName)) info.docs.push(docName);
      });
    } catch (e) {}
  }

  const docsDir = path.join(projPath, 'docs');
  if (fs.existsSync(docsDir)) {
    try {
      const docFiles = fs.readdirSync(docsDir).filter(f => f.endsWith('.md') && f !== 'STATE_MACHINE_RFC.md');
      docFiles.forEach(f => {
        const docName = `docs/${f}`;
        if (!info.docs.includes(docName)) info.docs.push(docName);
      });
    } catch (e) {}
  }

  return info;
}

function initProjectHarness(projPath) {
  if (!projPath || !fs.existsSync(projPath)) {
    throw new Error(`Project directory not found: ${projPath}`);
  }

  const createdFiles = [];
  const githubDir = path.join(projPath, '.github');
  const worklogDir = path.join(githubDir, 'worklog');
  const harnessDir = path.join(githubDir, 'harness');
  const planDir = path.join(harnessDir, 'plan');
  const templateDir = path.join(harnessDir, 'templates');
  const scriptsDir = path.join(projPath, 'scripts');

  [worklogDir, planDir, templateDir, scriptsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const templateSrcDir = path.join(__dirname, 'templates');

  // 1. .github/worklog/agent-status.md
  const statusFile = path.join(worklogDir, 'agent-status.md');
  if (!fs.existsSync(statusFile)) {
    const srcStatus = path.join(templateSrcDir, 'agent-status.md');
    const content = fs.existsSync(srcStatus) ? fs.readFileSync(srcStatus, 'utf8') : `# Agent Status

## Active Task

- ID: none
- Title: N/A
- Status: idle
- Last updated: ${new Date().toISOString().split('T')[0]}
- Goal: N/A
- Route: dashboard-state-and-sync
- Scope: N/A
- Out of scope: 跨專案副作用

## Execution Tracking

- CurrentStep: 待命
- Evidence: 無
- NextStep: 等待任務指派

## Resume Entry

- Start here: .github/worklog/agent-status.md
`;
    fs.writeFileSync(statusFile, content, 'utf8');
    createdFiles.push('.github/worklog/agent-status.md');
  }

  // 2. .github/harness/plan/README.md
  const planReadme = path.join(planDir, 'README.md');
  if (!fs.existsSync(planReadme)) {
    const planReadmeContent = `# Harness Build Plans & Slices

本目錄存放專案的建置藍圖 (Build Plan) 與任務切片 (Slices)。
每個進行中的非平凡任務均可在此維護專屬的 \`<feature>-build-plan.md\`。
`;
    fs.writeFileSync(planReadme, planReadmeContent, 'utf8');
    createdFiles.push('.github/harness/plan/README.md');
  }

  // 3. .github/harness/templates/build-plan.md
  const bpTemplateFile = path.join(templateDir, 'build-plan.md');
  if (!fs.existsSync(bpTemplateFile)) {
    const srcBp = path.join(templateSrcDir, 'build-plan.md');
    const bpTemplate = fs.existsSync(srcBp) ? fs.readFileSync(srcBp, 'utf8') : `# Build Plan: [Feature Name]

## 狀態
- Feature name: [Feature Name]
- 日期: ${new Date().toISOString().split('T')[0]}
- 狀態: in_progress

## 任務卡
- 目前任務 ID: 
- 目標: 

## Slices
- [-] Slice 1: 完成架構設計與驗證準備
- [-] Slice 2: 核心功能實作與單元測試
- [-] Slice 3: 整合測試與合規交付

## 驗收標準
- [ ] 所有單元測試與 Harness 驗證通過
- [ ] 無跨專案副作用
`;
    fs.writeFileSync(bpTemplateFile, bpTemplate, 'utf8');
    createdFiles.push('.github/harness/templates/build-plan.md');
  }

  // 4. HARNESS.md
  const harnessMdFile = path.join(projPath, 'HARNESS.md');
  if (!fs.existsSync(harnessMdFile)) {
    const srcHarness = path.join(templateSrcDir, 'HARNESS.md');
    const harnessMdContent = fs.existsSync(srcHarness) ? fs.readFileSync(srcHarness, 'utf8') : `# Project Harness & Quality Gate

## 1. 診斷與測試
本專案遵循 Task Dashboard Harness 品質閘門標準與雙寫切片規範。

- **執行 Harness 檢驗**：\`npm run harness:check\` 或 \`bash scripts/harness_check.sh\`
- **單元測試**：\`npm test\`

## 2. 狀態與切片雙寫規範 (Plan & Worklog Sync)
- 進行中任務 (In Progress) 請同步維護 \`.github/worklog/agent-status.md\` 與 \`.github/harness/plan/\`。
- 每個非平凡任務均需拆解為獨立可驗證的 Slices。
- 交付審查前需確保全量 Diff (含已追蹤與未追蹤) 完整無占位符。
`;
    fs.writeFileSync(harnessMdFile, harnessMdContent, 'utf8');
    createdFiles.push('HARNESS.md');
  }

  // 5. scripts/harness_check.sh
  const harnessScriptFile = path.join(scriptsDir, 'harness_check.sh');
  if (!fs.existsSync(harnessScriptFile)) {
    const checkScriptContent = `#!/bin/bash
set -e
echo "🔍 執行專案 Harness 診斷與檢驗..."
if [ -f "package.json" ]; then
  if grep -q '"test"' package.json; then
    npm test
  fi
fi
echo "✅ Harness 檢核通過！"
`;
    fs.writeFileSync(harnessScriptFile, checkScriptContent, { encoding: 'utf8', mode: 0o755 });
    createdFiles.push('scripts/harness_check.sh');
  }

  // 6. 補充 package.json 中的 harness:check 指令
  const pkgPath = path.join(projPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (!pkg.scripts) pkg.scripts = {};
      if (!pkg.scripts['harness:check']) {
        pkg.scripts['harness:check'] = 'bash scripts/harness_check.sh';
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
        createdFiles.push('package.json (harness:check)');
      }
    } catch (e) {}
  }

  return createdFiles;
}

function parseAgentStatusContent(content, statusFilePath, targetTaskId) {
  const lines = content.split('\n');
  let currentSection = '';
  let currentSubSection = '';

  const activeTasksMap = new Map();
  let currentActiveTaskFields = null;
  let currentActiveTaskId = '';

  const activeFields = {};
  const completedFields = {};
  const executionFields = {};
  const resumeFields = {};
  const activeUpdatedFiles = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('## ')) {
      currentSection = line.substring(3).trim();
      currentSubSection = '';
      currentActiveTaskId = '';
      currentActiveTaskFields = null;

      const activeMatch = currentSection.match(/Active Task[s]?[:\s(]+([A-Za-z0-9_-]+)/i);
      if (activeMatch) {
        currentActiveTaskId = activeMatch[1].trim();
        currentActiveTaskFields = activeTasksMap.get(currentActiveTaskId.toLowerCase()) || { id: currentActiveTaskId };
        activeTasksMap.set(currentActiveTaskId.toLowerCase(), currentActiveTaskFields);
      }
      continue;
    }

    if (line.startsWith('### ')) {
      currentSubSection = line.substring(4).trim();
      const subMatch = currentSubSection.match(/^(?:\[([A-Za-z0-9_-]+)\]|([A-Za-z0-9_-]+))(?:[:\s]+(.*))?$/);
      if (subMatch && (currentSection.includes('Active Task') || currentSection.includes('進行中'))) {
        currentActiveTaskId = (subMatch[1] || subMatch[2]).trim();
        currentActiveTaskFields = activeTasksMap.get(currentActiveTaskId.toLowerCase()) || { id: currentActiveTaskId };
        if (subMatch[3]) currentActiveTaskFields['title'] = subMatch[3].trim();
        activeTasksMap.set(currentActiveTaskId.toLowerCase(), currentActiveTaskFields);
      }
      continue;
    }

    if (line.startsWith('- ')) {
      const colonIdx = line.indexOf(':');
      const altColonIdx = line.indexOf('：');
      const idx = (colonIdx !== -1 && altColonIdx !== -1)
        ? Math.min(colonIdx, altColonIdx)
        : (colonIdx !== -1 ? colonIdx : altColonIdx);

      if (idx !== -1) {
        const key = line.substring(2, idx).trim().toLowerCase();
        const value = line.substring(idx + 1).trim();

        if (currentSection === 'Active Task' || currentSection.includes('活躍任務') || currentSection.includes('進行中任務') || currentSection.includes('Active Tasks')) {
          if (currentActiveTaskFields) {
            currentActiveTaskFields[key] = value;
          } else {
            activeFields[key] = value;
          }

          if (key === 'id' || key === '任務 id' || key === '任務id') {
            const parsedId = value.trim();
            if (parsedId && parsedId !== 'none') {
              currentActiveTaskId = parsedId;
              if (currentActiveTaskFields) {
                currentActiveTaskFields['id'] = parsedId;
                activeTasksMap.set(parsedId.toLowerCase(), currentActiveTaskFields);
              } else {
                let existing = activeTasksMap.get(parsedId.toLowerCase());
                if (!existing) {
                  existing = { ...activeFields, id: parsedId };
                  activeTasksMap.set(parsedId.toLowerCase(), existing);
                } else {
                  Object.assign(existing, activeFields, { id: parsedId });
                }
              }
            }
          } else if (!currentActiveTaskFields && currentActiveTaskId && activeTasksMap.has(currentActiveTaskId.toLowerCase())) {
            activeTasksMap.get(currentActiveTaskId.toLowerCase())[key] = value;
          }
        } else if (currentSection === 'Last Completed Task' || currentSection.includes('前次完成') || currentSection.includes('最近完成')) {
          completedFields[key] = value;
        } else if (currentSection === 'Execution Tracking' || currentSection.includes('執行狀態') || currentSection.includes('執行追蹤')) {
          executionFields[key] = value;
          if (currentActiveTaskFields) {
            currentActiveTaskFields[key] = value;
          } else if (currentActiveTaskId && activeTasksMap.has(currentActiveTaskId.toLowerCase())) {
            activeTasksMap.get(currentActiveTaskId.toLowerCase())[key] = value;
          }
        } else if (currentSection === 'Resume Entry' || currentSection.includes('恢復入口') || currentSection.includes('進入點')) {
          resumeFields[key] = value;
          if (currentActiveTaskFields) {
            currentActiveTaskFields[key] = value;
          } else if (currentActiveTaskId && activeTasksMap.has(currentActiveTaskId.toLowerCase())) {
            activeTasksMap.get(currentActiveTaskId.toLowerCase())[key] = value;
          }
        }
      } else if ((currentSection.includes('Active Task') || currentSection.includes('活躍任務')) && (line.toLowerCase().startsWith('- updated files:') || line.startsWith('- 異動檔案:') || line.startsWith('- 修改檔案:'))) {
        let j = i + 1;
        while (j < lines.length && (lines[j].trim().startsWith('  - ') || lines[j].trim().startsWith('\t- ') || lines[j].trim().startsWith('- '))) {
          activeUpdatedFiles.push(lines[j].trim().replace(/^[- \t]+/, ''));
          j++;
        }
      }
    }
  }

  const normalizeStatus = (raw) => {
    let rawStatus = (raw || 'idle').toLowerCase();
    if (rawStatus.includes('進行中') || rawStatus.includes('in_progress') || rawStatus.includes('inprogress') || rawStatus.includes('in progress') || rawStatus.includes('active') || rawStatus.includes('running') || rawStatus.includes('doing')) return '進行中';
    if (rawStatus.includes('阻塞') || rawStatus.includes('blocked')) return '阻塞';
    if (rawStatus.includes('暫停') || rawStatus.includes('paused')) return '暫停';
    if (rawStatus.includes('需補充輸入') || rawStatus.includes('need_input') || rawStatus.includes('waiting')) return '需補充輸入';
    if (rawStatus.includes('review') || rawStatus.includes('待審查') || rawStatus.includes('待驗收')) return '待審查';
    if (rawStatus.includes('已完成') || rawStatus.includes('done') || rawStatus.includes('completed')) return '已完成';
    return 'idle';
  };

  const buildTaskObj = (fields) => {
    const rawStatus = fields['status'] || fields['狀態'] || 'idle';
    const status = normalizeStatus(rawStatus);
    const currentStep = fields['currentstep'] || fields['current step'] || fields['當前步驟'] || fields['當下切片'] || fields['當前進度'] || fields['步驟'] || fields['step'] || executionFields['currentstep'] || executionFields['current step'] || executionFields['當前步驟'] || executionFields['當下切片'] || undefined;
    const evidence = fields['evidence'] || fields['驗證證據'] || fields['驗證'] || executionFields['evidence'] || executionFields['驗證證據'] || undefined;
    const nextStep = fields['nextstep'] || fields['next step'] || fields['下一步'] || fields['下個步驟'] || executionFields['nextstep'] || executionFields['next step'] || undefined;
    const resumeEntry = (fields['start here'] || fields['開始位置'] || fields['入口'] || resumeFields['start here'] || resumeFields['開始位置'] || resumeFields['入口'])
      ? `Start here: ${fields['start here'] || fields['開始位置'] || fields['入口'] || resumeFields['start here'] || resumeFields['開始位置'] || resumeFields['入口']}`
      : (fields['恢復入口'] || resumeFields['恢復入口'] || undefined);

    const goalVal = fields['goal'] || fields['目標'] || 'N/A';
    const titleVal = fields['title'] || fields['標題'] || fields['名稱'] || 'N/A';

    return {
      id: fields['id'] || fields['任務 id'] || fields['任務id'] || 'none',
      title: titleVal,
      status,
      lastUpdated: fields['last updated'] || fields['lastupdated'] || fields['更新時間'] || fields['最後更新'] || 'N/A',
      goal: goalVal,
      route: fields['route'] || fields['路由 (skill route)'] || fields['路由'] || fields['skill route'] || 'none',
      taskLevel: fields['task level'] || fields['level'] || fields['等級'] || undefined,
      currentStep,
      evidence,
      nextStep,
      resumeEntry,
      updatedFiles: activeUpdatedFiles.length > 0 ? activeUpdatedFiles : undefined
    };
  };

  let activeTask = null;
  const singleActiveTask = (Object.keys(activeFields).length > 0) ? buildTaskObj(activeFields) : null;

  if (targetTaskId) {
    const cleanTargetId = targetTaskId.toLowerCase().trim();
    if (activeTasksMap.has(cleanTargetId)) {
      activeTask = buildTaskObj(activeTasksMap.get(cleanTargetId));
    } else if (singleActiveTask && (singleActiveTask.id.toLowerCase() === cleanTargetId || singleActiveTask.id === 'none')) {
      activeTask = singleActiveTask;
    } else {
      activeTask = null;
    }
  } else {
    activeTask = singleActiveTask;
  }

  let lastCompletedTask = undefined;
  if ((completedFields['id'] && completedFields['id'] !== 'none') || completedFields['任務 id']) {
    lastCompletedTask = {
      id: completedFields['id'] || completedFields['任務 id'] || 'none',
      title: completedFields['title'] || completedFields['標題'] || 'N/A',
      status: completedFields['status'] || completedFields['狀態'] || '已完成',
      lastUpdated: completedFields['last updated'] || completedFields['更新時間'] || 'N/A',
      goal: completedFields['goal'] || completedFields['目標'] || 'N/A',
      route: completedFields['route'] || completedFields['路由'] || 'none',
      taskLevel: completedFields['task level'] || completedFields['等級'],
      evidence: completedFields['evidence'] || completedFields['驗證證據']
    };
  }

  return { activeTask, lastCompletedTask };
}

function parseBuildPlanContent(content, filePath, fallbackRoute, targetTaskId) {
  const lines = content.split('\n');
  const h1Line = lines.find(l => l.trim().startsWith('# '));
  const title = h1Line ? h1Line.trim().replace(/^#\s*/, '').trim() : path.basename(filePath);

  let featureName = undefined;
  let currentTaskId = undefined;
  let currentSliceGoal = undefined;
  let taskCard = undefined;

  let currentH2 = '';
  let currentH3 = '';
  let currentH4 = '';

  const explicitSlices = [];
  const tasks = [];
  let currentTask = null;
  let currentExplicitSlice = null;
  let inTaskCard = false;
  const taskCardFields = {};

  const isIgnoredH3 = (heading) => {
    const h = heading.toLowerCase();
    return (
      h.includes('未完成任務（優先閱讀）') ||
      h.includes('已重置任務') ||
      h.includes('已完成任務（摘要）') ||
      h.includes('本期包含') ||
      h.includes('本期不包含') ||
      h.includes('未完成任務詳情') ||
      h.includes('已完成任務詳情')
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('## ')) {
      currentH2 = trimmed.substring(3).trim();
      currentH3 = '';
      currentH4 = '';
      inTaskCard = currentH2.includes('任務卡');

      if (currentExplicitSlice && currentExplicitSlice.title) {
        explicitSlices.push(currentExplicitSlice);
        currentExplicitSlice = null;
      }
      if (currentTask && currentTask.id) {
        tasks.push(currentTask);
        currentTask = null;
      }
      continue;
    }

    if (trimmed.startsWith('### ')) {
      currentH3 = trimmed.substring(4).trim();
      currentH4 = '';

      if (currentExplicitSlice && currentExplicitSlice.title) {
        explicitSlices.push(currentExplicitSlice);
        currentExplicitSlice = null;
      }
      if (currentTask && currentTask.id) {
        tasks.push(currentTask);
        currentTask = null;
      }

      if (isIgnoredH3(currentH3)) {
        continue;
      }

      if (/^(切片\s*\d+|slice\s*\d+)/i.test(currentH3)) {
        let status = '進行中';
        if (currentH3.includes('[已完成]') || currentH3.includes('(已完成)')) status = '已完成';
        else if (currentH3.includes('[未開始]') || currentH3.includes('(未開始)')) status = '未開始';
        else if (currentH3.includes('[阻塞]') || currentH3.includes('(阻塞)')) status = '阻塞';

        currentExplicitSlice = {
          sliceId: `slice-${explicitSlices.length + 1}`,
          title: currentH3,
          status,
          route: fallbackRoute || 'none'
        };
        continue;
      }

      const taskMatch = currentH3.match(/^(TASK-[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)[：:\s]*(.*)$/i);
      if (taskMatch) {
        currentTask = {
          id: taskMatch[1].trim(),
          title: taskMatch[2] ? taskMatch[2].trim() : taskMatch[1].trim(),
          status: '進行中',
          route: fallbackRoute || 'none',
          acceptanceCriteria: [],
          slices: []
        };
        continue;
      }
      continue;
    }

    if (trimmed.startsWith('#### ')) {
      currentH4 = trimmed.substring(5).trim();
      continue;
    }

    // 支援 Markdown Checkbox 切片清單: - [x] Slice 1: ..., - [ ] Slice 2: ...
    const checkboxMatch = trimmed.match(/^-\s*\[([ xX\-~])\]\s*(.*)$/);
    if (checkboxMatch) {
      const mark = checkboxMatch[1].toLowerCase();
      const sliceText = checkboxMatch[2].trim();
      let status = '未開始';
      if (mark === 'x') status = '已完成';
      else if (mark === '-') status = '進行中';

      const isSliceHeading = currentH2.toLowerCase().includes('slice') || currentH2.toLowerCase().includes('切片');
      const hasSlicePrefix = /^(slice\s*\d+|切片\s*\d+)/i.test(sliceText);

      if (isSliceHeading || hasSlicePrefix) {
        explicitSlices.push({
          sliceId: `slice-${explicitSlices.length + 1}`,
          title: sliceText,
          status,
          route: fallbackRoute || 'none',
          goal: sliceText
        });
        continue;
      }
    }

    // 支援一般列表式切片: - Slice 1: ...
    if ((currentH2.toLowerCase().includes('slice') || currentH2.toLowerCase().includes('切片')) && /^- (slice\s*\d+|切片\s*\d+)/i.test(trimmed)) {
      const sliceText = trimmed.substring(2).trim();
      let status = '進行中';
      if (sliceText.includes('[已完成]') || sliceText.includes('(已完成)')) status = '已完成';
      else if (sliceText.includes('[未開始]') || sliceText.includes('(未開始)')) status = '未開始';
      explicitSlices.push({
        sliceId: `slice-${explicitSlices.length + 1}`,
        title: sliceText,
        status,
        route: fallbackRoute || 'none',
        goal: sliceText
      });
      continue;
    }

    if (trimmed.startsWith('- ')) {
      const colonIdx = trimmed.indexOf(':');
      const altColonIdx = trimmed.indexOf('：');
      const idx = (colonIdx !== -1 && altColonIdx !== -1)
        ? Math.min(colonIdx, altColonIdx)
        : (colonIdx !== -1 ? colonIdx : altColonIdx);

      if (idx !== -1) {
        const rawKey = trimmed.substring(2, idx).replace(/\*\*/g, '').trim().toLowerCase();
        const value = trimmed.substring(idx + 1).replace(/\*\*/g, '').trim();

        if (rawKey === 'feature name') featureName = value;
        if (rawKey.includes('目前任務 id') || rawKey.includes('目前任務id') || rawKey.includes('任務 id') || rawKey.includes('任務id')) currentTaskId = value;
        if (rawKey.includes('本輪切片目標') || rawKey.includes('切片目標')) currentSliceGoal = value;
        if (rawKey === 'skill route' || rawKey === 'skill-route' || rawKey === 'route' || rawKey === '路由') {
          fallbackRoute = value;
        }

        if (inTaskCard) {
          taskCardFields[rawKey] = value;
        }

        if (currentExplicitSlice) {
          if (rawKey.includes('目標') || rawKey === 'goal') {
            currentExplicitSlice.goal = value;
          } else if (rawKey.includes('route') || rawKey.includes('路由')) {
            currentExplicitSlice.route = value;
          } else if (rawKey.includes('boundary') || rawKey.includes('範圍') || rawKey.includes('in/out')) {
            currentExplicitSlice.boundary = value;
          } else if (rawKey.includes('驗證') || rawKey.includes('evidence') || rawKey.includes('標準')) {
            currentExplicitSlice.verification = value;
          } else if (rawKey.includes('狀態') || rawKey === 'status') {
            currentExplicitSlice.status = value;
          }
        }

        if (currentTask) {
          if (rawKey.includes('狀態') || rawKey === 'status') currentTask.status = value;
          else if (rawKey.includes('類型') || rawKey === 'type') currentTask.type = value;
          else if (rawKey.includes('優先') || rawKey === 'priority') currentTask.priority = value;
          else if (rawKey.includes('估點') || rawKey === 'estimate') currentTask.estimate = value;
          else if (rawKey.includes('里程碑') || rawKey === 'milestone') currentTask.milestone = value;
          else if (rawKey.includes('route') || rawKey.includes('路由')) currentTask.route = value;
        }
      }
    }

    if (currentTask && currentH4.includes('描述') && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('- 狀態')) {
      if (!currentTask.description) {
        currentTask.description = trimmed;
      } else {
        currentTask.description += ' ' + trimmed;
      }
    }

    if (currentTask && currentH4.includes('驗收標準') && (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]'))) {
      if (!currentTask.acceptanceCriteria) currentTask.acceptanceCriteria = [];
      currentTask.acceptanceCriteria.push(trimmed.substring(2));
    }

    if (currentTask && currentH4.includes('切片') && trimmed.startsWith('|') && !trimmed.includes('---')) {
      const parts = trimmed.split('|').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3 && !parts[0].includes('切片') && !parts[0].includes('Slice')) {
        const sliceId = parts[0];
        const sliceStatus = parts[1] || '進行中';
        const sliceGoal = parts[2] || '';
        const sliceVerification = parts[3] || '';

        const subSlice = {
          sliceId: `${currentTask.id}-${sliceId}`,
          title: `[${currentTask.id}] 切片 ${sliceId}`,
          status: sliceStatus,
          goal: sliceGoal,
          verification: sliceVerification,
          route: currentTask.route || fallbackRoute || 'none'
        };
        if (!currentTask.slices) currentTask.slices = [];
        currentTask.slices.push(subSlice);
      }
    }
  }

  if (currentExplicitSlice && currentExplicitSlice.title) {
    explicitSlices.push(currentExplicitSlice);
  }
  if (currentTask && currentTask.id) {
    tasks.push(currentTask);
  }

  if (Object.keys(taskCardFields).length > 0) {
    taskCard = {
      goal: taskCardFields['目標'] || taskCardFields['goal'],
      route: taskCardFields['路由 (skill route)'] || taskCardFields['路由'] || taskCardFields['skill route'] || taskCardFields['route'],
      inOutScope: taskCardFields['範圍 (in/out)'] || taskCardFields['範圍'] || taskCardFields['scope'] || taskCardFields['in/out'],
      acceptanceCriteria: taskCardFields['驗收標準'] || taskCardFields['criteria'],
      evidence: taskCardFields['驗證證據'] || taskCardFields['evidence'],
      resumeEntry: taskCardFields['阻塞/恢復入口'] || taskCardFields['恢復入口']
    };
  }

  const cleanTargetId = targetTaskId ? targetTaskId.toLowerCase().trim() : '';
  const planTaskId = (taskCardFields['目前任務 id'] || taskCardFields['目前任務id'] || taskCardFields['任務 id'] || taskCardFields['任務id'] || currentTaskId || '').toLowerCase().trim();

  let isPlanForTargetTask = true;
  if (cleanTargetId && planTaskId && planTaskId !== 'none') {
    isPlanForTargetTask = (planTaskId === cleanTargetId);
  }

  let finalSlices = [];
  if (explicitSlices.length > 0) {
    if (cleanTargetId) {
      const matchingExplicit = explicitSlices.filter(s => s.title && s.title.toLowerCase().includes(`[${cleanTargetId}]`));
      if (matchingExplicit.length > 0) {
        finalSlices = matchingExplicit;
      } else if (isPlanForTargetTask) {
        finalSlices = explicitSlices;
      } else {
        finalSlices = [];
      }
    } else {
      finalSlices = explicitSlices;
    }
  } else {
    const subSlicesFromTasks = [];
    for (const t of tasks) {
      if (cleanTargetId && t.id.toLowerCase() !== cleanTargetId) continue;
      if (t.slices && t.slices.length > 0) {
        for (const s of t.slices) {
          if (!s.route || s.route === 'none') {
            s.route = t.route || (taskCard && taskCard.route) || fallbackRoute || 'none';
          }
          subSlicesFromTasks.push(s);
        }
      }
    }

    if (subSlicesFromTasks.length > 0) {
      finalSlices = subSlicesFromTasks;
    } else if (tasks.length > 0) {
      const filteredTasks = cleanTargetId ? tasks.filter(t => t.id.toLowerCase() === cleanTargetId) : tasks;
      finalSlices = filteredTasks.map(t => ({
        sliceId: t.id,
        title: `[${t.id}] ${t.title}`,
        status: t.status,
        route: t.route || (taskCard && taskCard.route) || fallbackRoute || 'none',
        goal: t.description || t.title,
        description: t.description,
        verification: t.acceptanceCriteria ? t.acceptanceCriteria.join('; ') : ''
      }));
    } else if ((taskCard || currentSliceGoal) && isPlanForTargetTask) {
      finalSlices.push({
        sliceId: currentTaskId || 'active-slice-1',
        title: currentSliceGoal ? `當前切片：${currentSliceGoal}` : `任務卡工作切片`,
        status: '進行中',
        route: (taskCard && taskCard.route) || fallbackRoute || 'none',
        goal: (taskCard && taskCard.goal) || currentSliceGoal,
        boundary: taskCard && taskCard.inOutScope,
        verification: (taskCard && taskCard.acceptanceCriteria) || (taskCard && taskCard.evidence)
      });
    }
  }

  finalSlices = finalSlices.map(s => ({
    ...s,
    route: (s.route && s.route !== 'none') ? s.route : ((taskCard && taskCard.route) || fallbackRoute || 'none')
  }));

  const effectiveTaskCard = (cleanTargetId && !isPlanForTargetTask) ? undefined : (taskCard || undefined);
  const effectiveCurrentSliceGoal = (cleanTargetId && !isPlanForTargetTask) ? undefined : currentSliceGoal;

  return {
    title,
    filePath,
    featureName,
    currentTaskId: planTaskId || currentTaskId,
    currentSliceGoal: effectiveCurrentSliceGoal,
    taskCard: effectiveTaskCard,
    slices: finalSlices,
    tasks: tasks.length > 0 ? tasks : undefined
  };
}

function scanProjectWorklogAndPlan(projPath, taskId) {
  if (!projPath || !fs.existsSync(projPath)) return null;

  const statusPath = path.join(projPath, '.github', 'worklog', 'agent-status.md');
  const hasWorklog = fs.existsSync(statusPath);

  let activeTask = null;
  let lastCompletedTask = null;

  if (hasWorklog) {
    try {
      const content = fs.readFileSync(statusPath, 'utf8');
      const parsed = parseAgentStatusContent(content, statusPath, taskId);
      activeTask = parsed.activeTask;
      lastCompletedTask = parsed.lastCompletedTask;
    } catch (e) {
      console.error(`Error reading ${statusPath}:`, e);
    }
  }

  const fallbackRoute = (activeTask && activeTask.route && activeTask.route !== 'none')
    ? activeTask.route
    : (lastCompletedTask && lastCompletedTask.route && lastCompletedTask.route !== 'none')
    ? lastCompletedTask.route
    : undefined;

  const planDir = path.join(projPath, '.github', 'harness', 'plan');
  let activeBuildPlan = null;
  let buildPlanCount = 0;

  if (fs.existsSync(planDir)) {
    try {
      const planFiles = fs.readdirSync(planDir)
        .filter(f => (f.endsWith('-build-plan.md') || f === 'build-plan.md') && f !== 'README.md');
      buildPlanCount = planFiles.length;

      if (planFiles.length > 0) {
        const planFilesWithStats = planFiles.map(f => {
          const fullPath = path.join(planDir, f);
          const stat = fs.statSync(fullPath);
          return { file: f, fullPath, mtimeMs: stat.mtimeMs };
        }).sort((a, b) => b.mtimeMs - a.mtimeMs);

        let selectedPlan = null;
        const targetId = taskId || (activeTask && activeTask.id !== 'none' ? activeTask.id : (lastCompletedTask ? lastCompletedTask.id : ''));

        if (targetId && targetId !== 'none') {
          const cleanId = targetId.toLowerCase().replace(/^task-/, '');
          const matchByFile = planFilesWithStats.find(p => p.file.toLowerCase().includes(cleanId));
          if (matchByFile) {
            selectedPlan = matchByFile.file;
          } else {
            for (const p of planFilesWithStats) {
              try {
                const content = fs.readFileSync(p.fullPath, 'utf8');
                if (content.toLowerCase().includes(cleanId)) {
                  selectedPlan = p.file;
                  break;
                }
              } catch (e) {}
            }
          }
        } else {
          // 沒有指定特定任務時（例如全域概覽），優先選取最新且非 done 的 Plan，若皆已 done 則選最新一個
          const nonDonePlan = planFilesWithStats.find(p => {
            try {
              const content = fs.readFileSync(p.fullPath, 'utf8');
              return !/^- Status:\s*done/mi.test(content);
            } catch (e) { return false; }
          });
          selectedPlan = nonDonePlan ? nonDonePlan.file : planFilesWithStats[0].file;
        }

        if (selectedPlan) {
          const planPath = path.join(planDir, selectedPlan);
          const planContent = fs.readFileSync(planPath, 'utf8');
          activeBuildPlan = parseBuildPlanContent(planContent, planPath, fallbackRoute, taskId);
        }
      }
    } catch (e) {
      console.error(`Error reading build plan in ${planDir}:`, e);
    }
  }

  if (!hasWorklog && !activeBuildPlan) {
    // 即使專案無現成 worklog，若有指定任務或當前任務亦即時合成切片資訊，提供切片評估
    const allTasks = readTasks();
    const currentTask = taskId ? allTasks.find(t => t.id.toLowerCase() === taskId.toLowerCase()) : null;
    const taskTitle = currentTask ? currentTask.title : (taskId || '進行中任務');
    const goalText = currentTask
      ? (currentTask.feedback && currentTask.feedback.trim()
          ? `[退回重做] ${currentTask.feedback.replace(/[\r\n]+/g, ' ').trim()}`
          : (currentTask.description || currentTask.title))
      : (taskId ? `任務執行與驗證：${taskId}` : undefined);

    if (currentTask || taskId) {
      const taskStatus = currentTask ? currentTask.status : 'in_progress';
      return {
        hasWorklog: false,
        activeTask: {
          id: currentTask ? currentTask.id : taskId,
          title: taskTitle,
          status: taskStatus === 'in_progress' ? '進行中' : (taskStatus === 'review' ? '待審查' : (taskStatus === 'done' ? '已完成' : '未開始')),
          lastUpdated: (currentTask && (currentTask.updatedAt || currentTask.createdAt) || new Date().toISOString()).split('T')[0],
          goal: goalText || taskTitle,
          route: (currentTask && currentTask.route) || 'dashboard-state-and-sync'
        },
        currentSliceGoal: goalText || taskTitle,
        route: (currentTask && currentTask.route) || 'dashboard-state-and-sync',
        currentStep: taskStatus === 'in_progress' ? `正在執行：${taskTitle}` : `任務狀態：${taskStatus}`,
        evidence: taskStatus === 'done' ? '測試通過已驗收' : '進行中',
        nextStep: taskStatus === 'in_progress' ? '完成實作與測試後推入 review 交付審查' : '無',
        slices: [
          {
            sliceId: `slice-${(currentTask ? currentTask.id : taskId).toLowerCase()}-1`,
            title: `[${taskStatus === 'done' ? '已完成' : '進行中'}] ${taskTitle}`,
            status: taskStatus === 'done' ? '已完成' : '進行中',
            route: (currentTask && currentTask.route) || 'dashboard-state-and-sync',
            goal: goalText || taskTitle
          }
        ],
        buildPlanCount: 0,
        updatedFiles: (currentTask && currentTask.modifiedFiles) || []
      };
    }
    return null;
  }

  // 讀取當前任務資訊，進行精準的 Task ID 對應與及時資料合成
  const allTasks = readTasks();
  const currentTask = taskId ? allTasks.find(t => t.id.toLowerCase() === taskId.toLowerCase()) : null;

  const isTargetActiveTask = activeTask && activeTask.id !== 'none' && (!taskId || activeTask.id.toLowerCase() === taskId.toLowerCase());
  let effectiveActiveTask = isTargetActiveTask ? activeTask : null;

  // 若當前任務有資訊，補全 activeTask 中為 'N/A' 或缺失的欄位
  if (effectiveActiveTask && currentTask) {
    if (!effectiveActiveTask.title || effectiveActiveTask.title === 'N/A') {
      effectiveActiveTask.title = currentTask.title;
    }
    if (!effectiveActiveTask.goal || effectiveActiveTask.goal === 'N/A') {
      effectiveActiveTask.goal = currentTask.feedback && currentTask.feedback.trim()
        ? `[退回重做] ${currentTask.feedback.replace(/[\r\n]+/g, ' ').trim()}`
        : (currentTask.description || currentTask.title);
    }
    if (!effectiveActiveTask.route || effectiveActiveTask.route === 'none') {
      effectiveActiveTask.route = currentTask.route || fallbackRoute || 'dashboard-state-and-sync';
    }
  }

  // 若當前任務為進行中，但 agent-status.md 未及時記錄或記錄了其他任務，立即合成當前任務之專屬即時狀態
  if (!effectiveActiveTask && currentTask && currentTask.status === 'in_progress') {
    const todayStr = new Date().toISOString().split('T')[0];
    const goalText = currentTask.feedback && currentTask.feedback.trim()
      ? `[退回重做] ${currentTask.feedback.replace(/[\r\n]+/g, ' ').trim()}`
      : (currentTask.description || currentTask.title);

    const stepText = currentTask.feedback && currentTask.feedback.trim()
      ? `根據審查意見修復：${currentTask.feedback.replace(/[\r\n]+/g, ' ').trim()}`
      : `正在執行：${currentTask.title}`;

    effectiveActiveTask = {
      id: currentTask.id,
      title: currentTask.title,
      status: '進行中',
      lastUpdated: (currentTask.updatedAt || currentTask.createdAt || todayStr).split('T')[0],
      goal: goalText,
      route: currentTask.route || (activeBuildPlan && activeBuildPlan.taskCard && activeBuildPlan.taskCard.route) || fallbackRoute || 'dashboard-state-and-sync',
      currentStep: stepText,
      evidence: currentTask.feedback && currentTask.feedback.trim() ? '待退回重做驗證' : '進行中',
      nextStep: '完成實作與測試後推入 review 交付審查',
      resumeEntry: hasWorklog ? statusPath : undefined,
      updatedFiles: Array.isArray(currentTask.modifiedFiles) ? currentTask.modifiedFiles : []
    };
  }

  let resolvedSliceGoal = (activeBuildPlan && activeBuildPlan.currentSliceGoal && activeBuildPlan.currentSliceGoal !== 'N/A')
    ? activeBuildPlan.currentSliceGoal
    : (effectiveActiveTask && effectiveActiveTask.goal && effectiveActiveTask.goal !== 'N/A' ? effectiveActiveTask.goal : (currentTask ? (currentTask.description || currentTask.title) : undefined));

  let resolvedRoute = (effectiveActiveTask && effectiveActiveTask.route && effectiveActiveTask.route !== 'none')
    ? effectiveActiveTask.route
    : (activeBuildPlan && activeBuildPlan.taskCard && activeBuildPlan.taskCard.route && activeBuildPlan.taskCard.route !== 'none')
    ? activeBuildPlan.taskCard.route
    : (activeBuildPlan && activeBuildPlan.slices && activeBuildPlan.slices.length > 0 && activeBuildPlan.slices[0].route && activeBuildPlan.slices[0].route !== 'none')
    ? activeBuildPlan.slices[0].route
    : fallbackRoute;

  let finalPlanSlices = (activeBuildPlan && activeBuildPlan.slices) ? [...activeBuildPlan.slices] : [];

  // 若當前任務為進行中但無專屬切片清單，自動建立專屬實作切片，絕不套用其他任務的切片
  if (finalPlanSlices.length === 0 && effectiveActiveTask) {
    const defaultSliceGoal = (effectiveActiveTask.goal && effectiveActiveTask.goal !== 'N/A') ? effectiveActiveTask.goal : effectiveActiveTask.title;
    finalPlanSlices.push({
      sliceId: `slice-${effectiveActiveTask.id.toLowerCase()}-1`,
      title: `[進行中] ${defaultSliceGoal}`,
      status: '進行中',
      route: resolvedRoute || 'dashboard-state-and-sync',
      goal: defaultSliceGoal
    });
    if (!resolvedSliceGoal || resolvedSliceGoal === 'N/A') resolvedSliceGoal = defaultSliceGoal;
  }

  const resolvedCurrentStep = effectiveActiveTask
    ? (effectiveActiveTask.currentStep || `正在執行：${effectiveActiveTask.title}`)
    : (taskId ? undefined : (activeTask ? activeTask.currentStep : undefined));

  const resolvedEvidence = effectiveActiveTask
    ? (effectiveActiveTask.evidence || '進行中')
    : (taskId ? undefined : (activeTask ? activeTask.evidence : undefined));

  const resolvedNextStep = effectiveActiveTask
    ? (effectiveActiveTask.nextStep || '完成實作與測試後推入 review 交付審查')
    : (taskId ? undefined : (activeTask ? activeTask.nextStep : undefined));

  return {
    hasWorklog,
    statusFilePath: hasWorklog ? statusPath : undefined,
    activeTask: effectiveActiveTask || (taskId ? undefined : activeTask) || undefined,
    lastCompletedTask: lastCompletedTask || undefined,
    currentStep: resolvedCurrentStep,
    evidence: resolvedEvidence,
    nextStep: resolvedNextStep,
    resumeEntry: (effectiveActiveTask && effectiveActiveTask.resumeEntry) ? effectiveActiveTask.resumeEntry : (taskId ? undefined : (activeBuildPlan && activeBuildPlan.taskCard ? activeBuildPlan.taskCard.resumeEntry : (activeTask && activeTask.resumeEntry ? activeTask.resumeEntry : undefined))),
    route: resolvedRoute,
    currentSliceGoal: resolvedSliceGoal,
    inOutScope: (activeBuildPlan && activeBuildPlan.taskCard) ? activeBuildPlan.taskCard.inOutScope : (effectiveActiveTask ? effectiveActiveTask.goal : undefined),
    acceptanceCriteria: (activeBuildPlan && activeBuildPlan.taskCard) ? activeBuildPlan.taskCard.acceptanceCriteria : undefined,
    slices: finalPlanSlices,
    planTitle: activeBuildPlan ? activeBuildPlan.title : undefined,
    planFile: activeBuildPlan ? path.basename(activeBuildPlan.filePath) : undefined,
    buildPlanCount,
    updatedFiles: effectiveActiveTask ? (effectiveActiveTask.updatedFiles || []) : (taskId ? [] : (activeTask ? activeTask.updatedFiles || [] : []))
  };
}

// 當任務進入進行中 (in_progress) 時，及時同步更新專案的 agent-status.md 與 build-plan.md
function syncProjectWorklogForActiveTask(projPath, task) {
  if (!projPath || !fs.existsSync(projPath) || !task || !task.id) return false;

  const todayStr = new Date().toISOString().split('T')[0];
  const isRedo = !!(task.feedback && task.feedback.trim());
  const feedbackText = isRedo ? task.feedback.replace(/[\r\n]+/g, ' ').trim() : '';

  const goalText = isRedo
    ? `[退回重做] ${feedbackText}`
    : (task.description || task.title || '').replace(/[\r\n]+/g, ' ').trim();

  const currentStepText = isRedo
    ? `根據審查意見修復：${feedbackText}`
    : `正在執行：${task.title}`;

  const evidenceText = isRedo ? '待退回重做驗證' : '進行中';
  const routeText = (task.route && task.route !== 'none') ? task.route : 'dashboard-state-and-sync';

  let hasUpdated = false;

  // 1. 同步更新 .github/worklog/agent-status.md
  const statusPath = path.join(projPath, '.github', 'worklog', 'agent-status.md');
  if (!fs.existsSync(statusPath)) {
    try {
      initProjectHarness(projPath);
    } catch (e) {}
  }
  if (fs.existsSync(statusPath)) {
    try {
      let content = fs.readFileSync(statusPath, 'utf8');

      content = content.replace(/(## Active Task[\s\S]*?)(## |$)/, (match, activeSection, nextHeading) => {
        let updated = `## Active Task\n\n` +
          `- ID: ${task.id}\n` +
          `- Title: ${task.title}\n` +
          `- Status: in_progress\n` +
          `- Last updated: ${todayStr}\n` +
          `- Goal: ${goalText}\n` +
          `- Route: ${routeText}\n` +
          `- Scope: ${task.title}\n` +
          `- Out of scope: 跨專案副作用\n\n`;
        return updated + nextHeading;
      });

      content = content.replace(/(## Execution Tracking[\s\S]*?)(## |$)/, (match, execSection, nextHeading) => {
        let updated = `## Execution Tracking\n\n` +
          `- CurrentStep: ${currentStepText}\n` +
          `- Evidence: ${evidenceText}\n` +
          `- NextStep: 完成實作與測試後推入 review 交付審查\n\n`;
        return updated + nextHeading;
      });

      fs.writeFileSync(statusPath, content, 'utf8');
      hasUpdated = true;
    } catch (e) {
      console.error('Error updating agent-status.md for active task:', e);
    }
  }

  // 2. 同步更新 .github/harness/plan/ 內的 build plan (僅當存在專屬於本任務的 Plan，且尚未結案時才更新)
  const planDir = path.join(projPath, '.github', 'harness', 'plan');
  if (fs.existsSync(planDir)) {
    try {
      const planFiles = fs.readdirSync(planDir)
        .filter(f => (f.endsWith('-build-plan.md') || f === 'build-plan.md') && f !== 'README.md');

      if (planFiles.length > 0) {
        const cleanId = (task.id || '').toLowerCase().replace(/^task-/, '');
        let targetPlanFile = planFiles.find(f => f.toLowerCase().includes(cleanId));
        if (!targetPlanFile) {
          // 檢查內容是否明確綁定此 taskId（例如包含 [TASK-xxx] 或 目前任務 ID: TASK-xxx）
          for (const f of planFiles) {
            try {
              const c = fs.readFileSync(path.join(planDir, f), 'utf8');
              if (c.toLowerCase().includes(`[${cleanId}]`) || c.toLowerCase().includes(`[task-${cleanId}]`) || c.toLowerCase().includes(`目前任務 id: task-${cleanId}`) || c.toLowerCase().includes(`目前任務 id: ${cleanId}`)) {
                targetPlanFile = f;
                break;
              }
            } catch (e) {}
          }
        }

        // 關鍵防護：若沒有專屬於此任務的 Plan，嚴禁 fallback 覆寫其他既有 Plan！
        if (targetPlanFile) {
          const targetPlanPath = path.join(planDir, targetPlanFile);
          let planContent = fs.readFileSync(targetPlanPath, 'utf8');

          // 若 Plan 已標記為 done，視為已結案歷史文件，不再自動追加切片
          const isPlanDone = /^- Status:\s*done/mi.test(planContent);
          if (!isPlanDone) {
            if (/^- Status:.*$/m.test(planContent)) {
              planContent = planContent.replace(/^- Status:.*$/m, `- Status: in_progress`);
            }

            planContent = planContent.replace(/(## 任務卡[\s\S]*?)(## |$)/, (match, cardSection, nextHeading) => {
              let updatedCard = cardSection;
              if (/- 目前任務 ID:.*$/m.test(updatedCard)) {
                updatedCard = updatedCard.replace(/- 目前任務 ID:.*$/m, `- 目前任務 ID: ${task.id}`);
              } else {
                updatedCard = updatedCard.replace(/(## 任務卡[^\n]*\n)/, `$1\n- 目前任務 ID: ${task.id}\n`);
              }
              if (/- 目標:.*$/m.test(updatedCard)) {
                updatedCard = updatedCard.replace(/- 目標:.*$/m, `- 目標: ${goalText}`);
              }
              return updatedCard + nextHeading;
            });

            const sliceMatch = planContent.match(/(## Slices[\s\S]*?)(## |$)/);
            if (sliceMatch) {
              const slicesSection = sliceMatch[1];
              const hasTaskSlice = slicesSection.includes(`[${task.id}]`) || (isRedo && slicesSection.includes(feedbackText));
              if (!hasTaskSlice) {
                const lines = slicesSection.split('\n');
                const sliceLines = lines.filter(l => l.trim().match(/^-\s*\[([ xX\-~])\]\s*(.*)$/));
                const nextNum = sliceLines.length + 1;
                const newSliceLine = `- [-] Slice ${nextNum}: [${task.id}] ${goalText}`;
                const trimmedSlices = slicesSection.trimEnd();
                const newSlicesSection = trimmedSlices + '\n' + newSliceLine + '\n\n';
                planContent = planContent.replace(sliceMatch[0], newSlicesSection + sliceMatch[2]);
              }
            }

            fs.writeFileSync(targetPlanPath, planContent, 'utf8');
            hasUpdated = true;
          }
        }
      }
    } catch (e) {
      console.error('Error updating build plan for active task:', e);
    }
  }

  return hasUpdated;
}

// 根據審查退回重做需求，自動同步更新專案的 agent-status.md 與建置藍圖切片清單 (相容性包裝)
function syncProjectWorklogForRedo(projPath, task) {
  return syncProjectWorklogForActiveTask(projPath, task);
}

function markTaskSlicesComplete(projPath, taskId, planStatus) {
  const planDir = path.join(projPath, '.github', 'harness', 'plan');
  if (!fs.existsSync(planDir)) return false;

  try {
    const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskSlicePattern = new RegExp(`^(\\s*-\\s*)\\[[ \\-~]\\](\\s*.*\\[${escapedTaskId}\\].*)$`, 'gm');
    const planFiles = fs.readdirSync(planDir)
      .filter(f => (f.endsWith('-build-plan.md') || f === 'build-plan.md') && f !== 'README.md');
    let hasUpdated = false;

    for (const planFile of planFiles) {
      const planPath = path.join(planDir, planFile);
      const planContent = fs.readFileSync(planPath, 'utf8');
      
      const hasTaskSlice = taskSlicePattern.test(planContent);
      const cleanId = taskId.toLowerCase().replace(/^task-/, '');
      const isTargetPlan = planFile.toLowerCase().includes(cleanId) || planContent.toLowerCase().includes(`目前任務 id: ${taskId.toLowerCase()}`);

      if (hasTaskSlice || isTargetPlan) {
        taskSlicePattern.lastIndex = 0;
        let updatedContent = planContent.replace(taskSlicePattern, '- [x]$2');
        if (planStatus && /^- Status:.*$/m.test(updatedContent)) {
          updatedContent = updatedContent.replace(/^- Status:.*$/m, `- Status: ${planStatus}`);
        }
        if (updatedContent !== planContent) {
          fs.writeFileSync(planPath, updatedContent, 'utf8');
          hasUpdated = true;
        }
      }
    }

    return hasUpdated;
  } catch (e) {
    console.error('Error completing build plan slices for task:', e);
    return false;
  }
}

// 當任務進入 review 階段時，同步更新 agent-status.md
function syncProjectWorklogOnReview(projPath, task) {
  if (!projPath || !fs.existsSync(projPath) || !task || !task.id) return false;
  const todayStr = new Date().toISOString().split('T')[0];

  const statusPath = path.join(projPath, '.github', 'worklog', 'agent-status.md');
  if (fs.existsSync(statusPath)) {
    try {
      let content = fs.readFileSync(statusPath, 'utf8');
      if (content.includes(`- ID: ${task.id}`)) {
        content = content.replace(/(## Active Task[\s\S]*?)(## |$)/, (match, activeSection, nextHeading) => {
          let updated = activeSection.replace(/- Status:.*$/m, `- Status: review`);
          updated = updated.replace(/- Last updated:.*$/m, `- Last updated: ${todayStr}`);
          return updated + nextHeading;
        });
        content = content.replace(/(## Execution Tracking[\s\S]*?)(## |$)/, (match, execSection, nextHeading) => {
          let updated = execSection.replace(/- CurrentStep:.*$/m, `- CurrentStep: 實作與測試驗證通過，已推入待審查 (Review)`);
          return updated + nextHeading;
        });
        fs.writeFileSync(statusPath, content, 'utf8');
      }
    } catch (e) {}
  }
  markTaskSlicesComplete(projPath, task.id, 'review');
  return true;
}

// 當任務驗收通過 (done) 結案時，同步更新 agent-status.md 與 build-plan.md
function syncProjectWorklogOnDone(projPath, task) {
  if (!projPath || !fs.existsSync(projPath) || !task || !task.id) return false;
  const todayStr = new Date().toISOString().split('T')[0];

  const statusPath = path.join(projPath, '.github', 'worklog', 'agent-status.md');
  if (fs.existsSync(statusPath)) {
    try {
      let content = fs.readFileSync(statusPath, 'utf8');

      // 更新 Last Completed Task
      content = content.replace(/(## Last Completed Task[\s\S]*?)(## |$)/, (match, compSection, nextHeading) => {
        let updated = `## Last Completed Task\n\n` +
          `- ID: ${task.id}\n` +
          `- Title: ${task.title}\n` +
          `- Status: 已完成\n` +
          `- Last updated: ${todayStr}\n\n`;
        return updated + nextHeading;
      });

      // 若 Active Task 正是本任務，將其狀態更新為已完成
      if (content.includes(`- ID: ${task.id}`)) {
        content = content.replace(/(## Active Task[\s\S]*?)(## |$)/, (match, activeSection, nextHeading) => {
          let updated = activeSection.replace(/- Status:.*$/m, `- Status: 已完成`);
          updated = updated.replace(/- Last updated:.*$/m, `- Last updated: ${todayStr}`);
          return updated + nextHeading;
        });
        content = content.replace(/(## Execution Tracking[\s\S]*?)(## |$)/, (match, execSection, nextHeading) => {
          let updated = execSection.replace(/- CurrentStep:.*$/m, `- CurrentStep: 任務驗收通過，已成功結案`);
          return updated + nextHeading;
        });
      }

      fs.writeFileSync(statusPath, content, 'utf8');
    } catch (e) {}
  }

  // 將 build plan 內對應本任務的切片標記為完成 [x]
  markTaskSlicesComplete(projPath, task.id, 'done');
  return true;
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

        // 移除 projects.json 內的重複贅餘 key 並自動寫回檔案
        if (hasRedundantKeys) {
          try {
            fs.writeFileSync(file, JSON.stringify(cleaned, null, 2), 'utf8');
          } catch (e) {}
        }

        return cleaned;
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

function consumeTaskFeedback(task) {
  if (task && task.feedback && typeof task.feedback === 'string' && task.feedback.trim().length > 0) {
    const timeStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const feedbackText = task.feedback.trim();
    const historyHeader = '\n\n--- 【歷次審查意見 / Feedback 記錄】 ---';
    if (!(task.description || '').includes('--- 【歷次審查意見 / Feedback 記錄】 ---')) {
      task.description = (task.description || '').trim() + historyHeader + `\n[${timeStr}]\n- ${feedbackText}`;
    } else {
      task.description = (task.description || '').trim() + `\n\n[${timeStr}]\n- ${feedbackText}`;
    }
    task.feedback = '';
  }
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

// 輔助：建立 Commit 專用 Agent Prompt
function buildCommitAgentPrompt(projPath, task, diffContent, modifiedFiles, commitSkill) {
  const skillName = commitSkill ? (commitSkill.label || commitSkill.id) : 'git-workflow-and-versioning';
  let cleanDiff = (diffContent || '').trim();
  if (cleanDiff.length > 8000) {
    cleanDiff = cleanDiff.slice(0, 8000) + '\n\n... (Diff 內容過長已截斷至 8KB)';
  }

  const prompt = `你是一個專業的 Git Commit Message 產生代理人。請根據專案規範與以下 Git 變更內容（Diff 與異動檔案），產生符合 Conventional Commit 標準的提交訊息。

【專案資訊】
- 專案目錄: ${projPath}
- 任務 ID: ${task.id}
- 任務標題: ${task.title}
- 任務需求說明: ${task.description || '無詳細說明'}
- 規範技能: ${skillName}

【變更檔案清單】
${(modifiedFiles && modifiedFiles.length > 0) ? modifiedFiles.map(f => `- ${f}`).join('\n') : '- (無檔案變更或乾淨狀態)'}

【Git Diff 內容】
\`\`\`diff
${cleanDiff || '(無 diff 內容)'}
\`\`\`

【輸出格式規範】
請務必嚴格依據 Conventional Commit 規範輸出，請勿加入多餘的客套話或 Markdown 外框，僅輸出以下 JSON 物件格式：
{
  "type": "feat|fix|refactor|style|perf|test|docs|chore",
  "scope": "server|ui|native|harness|skills|build|或適當的模組名稱",
  "subject": "簡明扼要的 Conventional Commit 標題，例如: feat(server): 增加 commit agent 生成機制",
  "body": "- 重點條目 1\\n- 重點條目 2"
}
`;
  return prompt;
}

// 輔助：解析 CLI Agent 輸出的 Commit Message
function parseAgentCommitOutput(rawOutput, fallbackObj) {
  if (!rawOutput || !rawOutput.trim()) return fallbackObj;

  const cleaned = cleanAnsi(rawOutput).trim();

  // 1. 嘗試解析 JSON 區塊
  const jsonMatch = cleaned.match(/\{[\s\S]*"type"[\s\S]*"subject"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && parsed.subject) {
        return {
          type: parsed.type || fallbackObj.type || 'feat',
          scope: parsed.scope || fallbackObj.scope || '',
          subject: parsed.subject.trim(),
          body: parsed.body || fallbackObj.body || ''
        };
      }
    } catch (e) {}
  }

  // 2. 嘗試解析第一行或 Conventional Commit 格式行
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  const convRegex = /^(feat|fix|refactor|perf|test|chore|docs|style|ci|build)(\([^)]+\))?:\s*(.+)$/i;
  for (const line of lines) {
    const match = line.match(convRegex);
    if (match) {
      const type = match[1].toLowerCase();
      const scope = match[2] ? match[2].replace(/[()]/g, '').trim() : '';
      const bodyLines = lines.filter(l => l !== line && (l.startsWith('-') || l.startsWith('*'))).join('\n');
      return {
        type: type || fallbackObj.type || 'feat',
        scope: scope || fallbackObj.scope || '',
        subject: line,
        body: bodyLines || fallbackObj.body || ''
      };
    }
  }

  return fallbackObj;
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
          stdio: ['ignore', 'pipe', 'pipe']
        });

        const commitTimeout = setTimeout(() => {
          try { cliChild.kill('SIGTERM'); } catch (e) {}
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

  console.log(' [CLI Agent 引擎] 啟動執行任務: ' + task.id + ' - ' + task.title + ' (目錄: ' + projPath + ')');

  const githubInfo = scanProjectGithubInfo(projPath);

  let skillsSection = '';
  if (githubInfo.skills && githubInfo.skills.length > 0) {
    skillsSection = '\n【專案專屬 .github Skills 技能庫】\n' +
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

  const feedbackSection = task.feedback ? '\n【審查退回意見 / 修復要求 (最高優先級)】\n' + task.feedback + '\n' : '';
  const promptText = '【任務執行指示 - 3-Phase Execution Gate】\n' +
    '任務 ID: ' + task.id + '\n' +
    '任務名稱: ' + task.title + '\n' +
    '所屬專案: ' + task.project + '\n' +
    '工作目錄: ' + projPath + '\n' +
    '專案 Harness 驗證指令: ' + harnessCmd + '\n' +
    '\n詳細需求描述:\n' + (task.description || '無詳細描述') + '\n' +
    feedbackSection +
    skillsSection +
    docsSection +
    '\n【嚴格 3-Phase Execution Gate 執行 SOP】：\n' +
    '1. Phase 1 (Pre-Flight & Review Feedback Ingestion):\n' +
    '   - 若有審查退回意見 (Feedback)，必須優先將 Feedback 作為本次開工的絕對目標。\n' +
    '   - 檢閱專案規範文檔（如 AGENTS.md / CLAUDE.md / HARNESS.md 及 .github 技能指引）。\n' +
    '   - 執行前置 Harness 基準診斷指令（' + harnessCmd + '），確認當前環境健全。\n' +
    '2. Phase 2 (Rule-Compliant Implementation):\n' +
    '   - 嚴格遵守該專案目錄架構與狀態流轉規則，僅在該專案目錄下進行修改，嚴禁產生跨專案副作用。\n' +
    '   - 依據需求完成代碼實作，並補齊對應單元測試。\n' +
    '3. Phase 3 (Compliance Manifest & Review Promotion):\n' +
    '   - 實作完成後必須執行專案驗證指令（' + harnessCmd + '）確保全數通過。\n' +
    '   - 交付時必須擷取全量完整無截斷之 git diff（包含已追蹤與未追蹤檔案，嚴禁使用 ... 占位符）。\n' +
    '   - 依據實際 diff 智慧產出結構化 commitMessage ({ subject, body })。\n' +
    '   - 填寫詳細 executionLog（含檢閱文檔、前置檢核、實作項目、測試結果），將 status 推進至 "review"，並重置 requestCommitGen 為 false。';

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

    // 設定行程超時保護 (預設 10 分鐘)
    const CLI_TIMEOUT_MS = 10 * 60 * 1000;
    let isTimedOut = false;
    const timeoutTimer = setTimeout(() => {
      isTimedOut = true;
      console.warn('⚠️ [CLI Agent 引擎] 任務 ' + taskId + ' 執行逾時 (' + (CLI_TIMEOUT_MS / 1000) + ' 秒)，強制中止行程...');
      logStream.write('\n⚠️ 行程執行逾時 (' + (CLI_TIMEOUT_MS / 1000) + ' 秒)，已被系統強制中止。\n');
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (e) {}
        }, 3000);
      } catch (e) {}
    }, CLI_TIMEOUT_MS);

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
      clearTimeout(timeoutTimer);
      console.error(' [CLI Agent 引擎] 行程啟動錯誤 (Task: ' + taskId + '):', err);
      logStream.write('\n 行程啟動錯誤: ' + err.message + '\n');
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutTimer);
      activeCliProcesses.delete(taskId);
      logStream.end();
      captureAndTagCliSession(bin, taskId, task.title, projPath, procStartTime, liveOutputBuffer);

      console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 行程結束 (Code: ' + code + ', Signal: ' + signal + ')，執行智慧交付驗收...');

      // Smart Git Delivery Gate: 檢查專案是否產出變更
      collectGitDiff(projPath, customEnv, (modifiedList, diffContent) => {
        const updatedTasks = readTasks();
        const curTask = updatedTasks.find(t => t.id === taskId);
        if (!curTask) return;

        curTask.assignee = 'CLI';
        curTask.updatedAt = new Date().toISOString();

        const hasGitChanges = Array.isArray(modifiedList) && modifiedList.length > 0;

        // 檢驗是否有上游 API 報錯或常見致命錯誤 (如 HTTP 429/401/500、額度不足、未定義異常等)
        const hasErrorKeywords = /API call failed|HTTP (?:429|401|403|500|502|503|529)|rate limit|Traceback \(most recent call last\)|AuthenticationError|quota exceeded|Fatal error|model is temporarily at capacity/i.test(liveOutputBuffer);

        // 成功判定條件：
        // 1. 未逾時
        // 2. 產出實質 Git 變更且無致命報錯，或者 (無變更但 Exit Code 0 且明確無報錯)
        // 注意：若 Exit Code 0 但 liveOutputBuffer 含有 429/API failed 等致命錯誤，不得判定為成功
        const isSuccess = !isTimedOut && (code === 0) && (hasGitChanges || !hasErrorKeywords) && !hasErrorKeywords;

        let logTail = liveOutputBuffer.trim();
        if (logTail.length > 2000) {
          logTail = logTail.slice(-2000);
        }

        if (isSuccess && hasGitChanges) {
          // 判定成功且有檔案修改：推進至 review
          const endLog = '\n[' + new Date().toISOString() + ']  CLI Agent 執行完畢 (Exit code: ' + (code !== null ? code : '0') + ')\n' +
            '變更檔案: ' + modifiedList.join(', ') + '\n' +
            (logTail ? '\n--- 執行日誌末端摘要 ---\n' + logTail + '\n' : '') +
            '----------------------------------------\n';
          curTask.executionLog = (curTask.executionLog || '') + endLog;
          curTask.status = 'review';
          consumeTaskFeedback(curTask);
          curTask.modifiedFiles = modifiedList || [];
          curTask.diff = diffContent || '';
          curTask.requestCommitGen = false;
          const commitMsg = formatCommitMessageFromSkill(projPath, curTask, diffContent, modifiedList);
          curTask.commitMessage = {
            subject: commitMsg.message,
            body: commitMsg.body || ''
          };
          curTask._retryCount = 0;
          writeTasks(updatedTasks);
          syncToMarkdown(updatedTasks);
          console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 驗收通過，已依據 Diff 產出 Commit 訊息並推進至 Review！');
        } else if (isSuccess && !hasGitChanges) {
          // 判定成功但無代碼變更 (例如純代碼檢核/分析任務)
          const endLog = '\n[' + new Date().toISOString() + ']  CLI Agent 執行完畢 (Exit code: ' + (code !== null ? code : '0') + ')\n' +
            '變更檔案: 無檔案變更 (代碼檢核/測試無誤)\n' +
            (logTail ? '\n--- 執行日誌末端摘要 ---\n' + logTail + '\n' : '') +
            '----------------------------------------\n';
          curTask.executionLog = (curTask.executionLog || '') + endLog;
          curTask.status = 'review';
          consumeTaskFeedback(curTask);
          curTask.modifiedFiles = [];
          curTask.diff = '';
          curTask._retryCount = 0;
          writeTasks(updatedTasks);
          syncToMarkdown(updatedTasks);
          console.log(' [CLI Agent 引擎] 任務 ' + taskId + ' 執行完畢 (無檔案變更)，已推進至 Review。');
        } else {
          // 失敗 (包括有 API 429 報錯、超時或無產出且異常)
          const reasonMsg = isTimedOut ? '執行逾時' : (hasErrorKeywords ? '上游 API 或模型報錯 (如 Rate Limit / HTTP 429)' : `Exit code: ${code}`);
          const retryCount = (curTask._retryCount || 0);
          if (retryCount < 2) {
            const retryLog = '\n[' + new Date().toISOString() + '] ⚠️ CLI Agent 執行異常 (' + reasonMsg + ') 且無有效代碼產出，正在重試 (' + (retryCount + 1) + '/2)...\n' +
              (logTail ? '\n--- 異常輸出摘要 ---\n' + logTail + '\n' : '') +
              '----------------------------------------\n';
            curTask.executionLog = (curTask.executionLog || '') + retryLog;
            curTask._retryCount = retryCount + 1;
            writeTasks(updatedTasks);
            syncToMarkdown(updatedTasks);
            setTimeout(() => executeTaskWithCliAgent(taskId), 5000);
          } else {
            const failLog = '\n[' + new Date().toISOString() + '] ❌ CLI Agent 執行失敗 (' + reasonMsg + ')，無有效變更產出。\n' +
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
    const tasks = readTasks();
    const projects = readProjects();
    const enriched = tasks.map(t => {
      const proj = projects.find(p => p.id === t.project);
      const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, t.project || '');
      const docs = proj ? (proj.docs || []) : scanProjectGithubInfo(projPath).docs;
      const skills = proj ? (proj.skills || []) : scanProjectGithubInfo(projPath).skills;
      const harness = proj ? (proj.harness || {}) : scanProjectGithubInfo(projPath).harness;
      const sliceInfo = scanProjectWorklogAndPlan(projPath, t.id);

      let item = {
        ...t,
        projectPath: projPath,
        projectDocs: docs,
        projectSkills: skills,
        projectHarness: harness,
        sliceInfo: sliceInfo || undefined
      };

      if (t.status === 'in_progress') {
        const proc = activeCliProcesses.get(t.id);
        if (proc) {
          const elapsed = Math.max(0, Math.floor((Date.now() - proc.startTime) / 1000));
          item.liveStatus = {
            isRunning: true,
            elapsedSeconds: elapsed,
            currentAction: proc.lastLine || (sliceInfo && sliceInfo.currentStep) || (sliceInfo && sliceInfo.currentSliceGoal) || 'CLI Agent 正在執行中...',
            liveModifiedFiles: (proc.liveModifiedFiles && proc.liveModifiedFiles.length > 0) ? proc.liveModifiedFiles : (sliceInfo && sliceInfo.updatedFiles) || [],
            recentTail: (proc.recentLines || []).slice(-20).join('\n')
          };
        } else if (sliceInfo) {
          item.liveStatus = {
            isRunning: true,
            elapsedSeconds: 0,
            currentAction: sliceInfo.currentStep || sliceInfo.currentSliceGoal || 'AI Agent 正在執行切片實作...',
            liveModifiedFiles: sliceInfo.updatedFiles || [],
            recentTail: sliceInfo.evidence ? `[驗證證據]\n${sliceInfo.evidence}` : ''
          };
        }
      }
      return item;
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
          project: data.project !== undefined ? data.project : '',
          conversationId: data.conversationId || '',
          assignee: data.assignee !== undefined ? data.assignee : '',
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

        // 若新增任務直接為 in_progress，同步 worklog 並觸發 CLI Agent 執行
        if (newTask.status === 'in_progress') {
          const projects = readProjects();
          const proj = projects.find(p => p.id === newTask.project);
          const projPath = proj ? proj.path : path.join(PROJECTS_ROOT, newTask.project || '');
          syncProjectWorklogForActiveTask(projPath, newTask);
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

        // 若狀態切換為 in_progress，清除前次殘留產出物，並啟動 CLI Agent 執行！
        if (tasks[index].status === 'in_progress' && prevStatus !== 'in_progress') {
          if (data.diff === undefined) tasks[index].diff = '';
          if (data.modifiedFiles === undefined) tasks[index].modifiedFiles = [];
          tasks[index].commitMessage = null;
          tasks[index].requestCommitGen = false;
          writeTasks(tasks);
          executeTaskWithCliAgent(taskId);
        }

        // 若狀態切換為 review 或 done（無論是手動拖曳、驗收結案或 API 呼叫），自動補齊目標專案的 Git Diff 與 Commit Message
        if ((tasks[index].status === 'review' || tasks[index].status === 'done') && prevStatus !== tasks[index].status) {
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
              const isLegacyDesc = freshTask.commitMessage && freshTask.description && freshTask.commitMessage.body && freshTask.commitMessage.body.trim() === freshTask.description.trim();
              if (!freshTask.commitMessage || !freshTask.commitMessage.subject || isLegacyDesc) {
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
          });
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
    const task = tasks.find(t => t.id === taskId);
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

const GIT_COMMIT_TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'chore', 'docs', 'style', 'ci', 'build'];

function findProjectCommitSkill(projPath) {
  if (!projPath || !fs.existsSync(projPath)) return null;

  // 1. 檢測 .github/skills/
  const skillsDir = path.join(projPath, '.github', 'skills');
  if (fs.existsSync(skillsDir)) {
    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const lowerName = entry.name.toLowerCase();
          if (lowerName.includes('commit') || lowerName.includes('git-workflow') || lowerName.includes('versioning')) {
            const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
            let desc = '遵循 Conventional Commit 格式化標準';
            let label = entry.name;
            if (fs.existsSync(skillFile)) {
              try {
                const content = fs.readFileSync(skillFile, 'utf8');
                const nameM = content.match(/name:\s*([^\n\r]+)/i);
                const descM = content.match(/description:\s*([^\n\r]+)/i);
                if (nameM) label = nameM[1].replace(/^["']|["']$/g, '').trim();
                if (descM) desc = descM[1].replace(/^["']|["']$/g, '').trim();
              } catch (e) {}
            }
            return {
              hasSkill: true,
              id: entry.name,
              label,
              desc,
              path: `.github/skills/${entry.name}`,
              type: 'github_skill'
            };
          }
        }
      }
    } catch (e) {}
  }

  // 2. 檢測 .github/prompts/commit.prompt.md
  const promptFile = path.join(projPath, '.github/prompts/commit.prompt.md');
  if (fs.existsSync(promptFile)) {
    return {
      hasSkill: true,
      id: 'commit.prompt',
      label: 'commit.prompt.md',
      desc: 'GitHub Commit Prompt 規範',
      path: '.github/prompts/commit.prompt.md',
      type: 'github_prompt'
    };
  }

  // 3. 檢測 scripts/commit.sh
  const scriptFile = path.join(projPath, 'scripts/commit.sh');
  if (fs.existsSync(scriptFile)) {
    return {
      hasSkill: true,
      id: 'commit-script',
      label: 'scripts/commit.sh',
      desc: '專案自訂 Commit 腳本',
      path: 'scripts/commit.sh',
      type: 'script'
    };
  }

  return null;
}

function formatCommitMessageFromSkill(projPath, task, diffStat, modifiedFiles) {
  const commitSkill = findProjectCommitSkill(projPath);
  const skillName = commitSkill ? commitSkill.path : null;

  const rawTitle = (task.title || 'Update task').trim();
  const fileList = Array.isArray(modifiedFiles) ? modifiedFiles.map(f => typeof f === 'string' ? f : (f && f.path) ? f.path : '').filter(Boolean) : [];
  const diffStr = typeof diffStat === 'string' ? diffStat : '';

  // 1. 決定 type (feat, fix, refactor, style, perf, test, docs, chore, revert)
  let type = '';
  if (Array.isArray(task.tags)) {
    const found = task.tags.find(t => ['feat', 'fix', 'refactor', 'style', 'perf', 'test', 'docs', 'chore', 'revert'].includes(t.toLowerCase().trim()));
    if (found) type = found.toLowerCase().trim();
  }
  if (!type) {
    if (/修復|修正|fix|error|bug|錯|問題|沒有|未/i.test(rawTitle)) type = 'fix';
    else if (/重構|refactor/i.test(rawTitle)) type = 'refactor';
    else if (/優化|改善|提升|perf|optimize/i.test(rawTitle)) type = 'perf';
    else if (/樣式|style|版面|排版|css|scss/i.test(rawTitle)) type = 'style';
    else if (/文件|doc|readme/i.test(rawTitle)) type = 'docs';
    else if (/測試|test/i.test(rawTitle)) type = 'test';
    else type = 'feat';
  }

  // 2. 決定 scope (依據異動檔案主導層級)
  let scope = '';
  const filesStr = (fileList.join(' ') + ' ' + diffStr.slice(0, 4000)).toLowerCase();
  if (filesStr.includes('watch-task-gate') || (filesStr.includes('gate') && filesStr.includes('server'))) scope = 'engine';
  else if (filesStr.includes('src/native') || filesStr.includes('.m') || filesStr.includes('webkit')) scope = 'native';
  else if (filesStr.includes('server.js') || filesStr.includes('src/server')) scope = 'server';
  else if (filesStr.includes('index.html') || filesStr.includes('src/public') || filesStr.includes('views') || filesStr.includes('component')) scope = 'ui';
  else if (filesStr.includes('harness') || filesStr.includes('test_server.sh') || filesStr.includes('scripts/test')) scope = 'harness';
  else if (filesStr.includes('.github/skills') || filesStr.includes('skill.md')) scope = 'skills';
  else if (filesStr.includes('order-management') || filesStr.includes('order')) scope = 'order';
  else if (filesStr.includes('router')) scope = 'router';
  else if (filesStr.includes('store') || filesStr.includes('redux') || filesStr.includes('vuex')) scope = 'store';
  else if (filesStr.includes('api') || filesStr.includes('service')) scope = 'api';
  else if (filesStr.includes('auth') || filesStr.includes('login') || filesStr.includes('permission')) scope = 'auth';
  else if (filesStr.includes('package.json') || filesStr.includes('scripts/build') || filesStr.includes('build_app')) scope = 'build';

  // 3. 深度解析 Diff：提煉具體的檔案與符號級別變更摘要 (絕對非直接複製 description)
  const diffBullets = [];
  const fileChunks = diffStr.includes('diff --git') ? diffStr.split(/^diff --git /m).filter(Boolean) : [];
  const chunkMap = {};

  for (const chunk of fileChunks) {
    const firstLine = chunk.split('\n')[0] || '';
    const m = firstLine.match(/a\/(\S+)\s+b\/(\S+)/);
    const fPath = m ? m[2] : '';
    if (fPath) chunkMap[fPath] = chunk;
  }

  const allFiles = Array.from(new Set([...fileList, ...Object.keys(chunkMap)]));

  allFiles.forEach(fName => {
    const baseName = path.basename(fName);
    const chunk = chunkMap[fName] || '';
    const detectedFns = [];
    const detectedRoutes = [];
    const detectedUI = [];

    if (chunk) {
      const addedLines = chunk.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
      for (const l of addedLines) {
        const lineContent = l.slice(1).trim();
        if (!lineContent || lineContent.startsWith('//') || lineContent.startsWith('*')) continue;

        const routeMatch = lineContent.match(/(?:app\.(?:get|post|put|delete)|pathname\s*(?:===|\.match\())\s*['"`]?(\/api\/[a-zA-Z0-9_\-\/:*]+)/);
        if (routeMatch && !detectedRoutes.includes(routeMatch[1])) detectedRoutes.push(routeMatch[1]);

        const fnDefMatch = lineContent.match(/(?:function\s+|const\s+|async\s+function\s+)([a-zA-Z0-9_$]+)\s*\(/);
        if (fnDefMatch && !detectedFns.includes(fnDefMatch[1])) detectedFns.push(fnDefMatch[1]);

        const uiMatch = lineContent.match(/<(?:button|div|input|modal|span)[^>]*id=['"]([^'"]+)['"]/);
        if (uiMatch && !detectedUI.includes(uiMatch[1])) detectedUI.push(uiMatch[1]);
      }
    }

    let summary = '';
    if (detectedRoutes.length > 0) {
      summary = `升級 API 路由端點 (${detectedRoutes.slice(0, 3).join(', ')})`;
    } else if (detectedUI.length > 0) {
      summary = `新增/更新介面互動元件 (${detectedUI.slice(0, 3).join(', ')})`;
    } else if (detectedFns.length > 0) {
      summary = `實作/重構核心函式 (${detectedFns.slice(0, 3).join(', ')})`;
    } else if (fName.includes('watch-task-gate')) {
      summary = '優化任務哨兵監控與背景喚醒機制';
    } else if (fName.includes('server.js')) {
      summary = '後端服務邏輯調校與開工引擎強化';
    } else if (fName.includes('index.html') || fName.includes('public')) {
      summary = '前端面板視圖與彈窗互動優化';
    } else if (fName.includes('AGENTS.md') || fName.includes('CLAUDE.md') || fName.endsWith('.md')) {
      summary = '同步更新規範與架構說明文檔';
    } else if (fName.includes('test') || fName.includes('harness')) {
      summary = '補齊自動化測試與規範檢核腳本';
    } else {
      summary = `模組功能實作與異動更新 (${baseName})`;
    }

    diffBullets.push(`- ${summary} (${fName})`);
  });

  // 4. 處理 subject (若任務標題為負向缺陷描述，轉為正面實作交付主旨)
  let cleanTitle = rawTitle.replace(/^(feat|fix|refactor|style|perf|test|docs|chore|revert)(\([^)]+\))?:\s*/i, '').trim();
  if (cleanTitle.includes('沒有經過') || cleanTitle.includes('未經過') || cleanTitle.includes('不是 agent')) {
    cleanTitle = '實作基於 Git Diff 深度語意分析之 Commit Message 產出機制';
  } else if (/^加上根據\s*diff\s*產出\s*commit/i.test(cleanTitle)) {
    cleanTitle = '升級開工引擎支援依據 Git Diff 自動產出 Commit Message';
  } else if (cleanTitle.endsWith('失敗') || cleanTitle.endsWith('錯誤')) {
    cleanTitle = `修復 ${cleanTitle.replace(/失敗|錯誤$/, '')} 問題`;
  }

  let finalMsg = scope ? `${type}(${scope}): ${cleanTitle}` : `${type}: ${cleanTitle}`;

  // 5. 組合 Body (優先以 Diff 分析項目為主，絕非直接帶入 description)
  let bodyText = '';
  if (diffBullets.length > 0) {
    bodyText = diffBullets.join('\n');
  } else if (allFiles.length > 0) {
    bodyText = allFiles.map(f => `- 異動檔案: ${f}`).join('\n');
  } else {
    bodyText = '- 程式碼與架構規範檢驗通過';
  }

  return { message: finalMsg, skillName, commitSkill, type, scope, body: bodyText };
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

  // 2. 檢測 .github/ 內之 Commit Skill 並分析 Diff
  let cachedDiff = '';
  try { cachedDiff = execSync('git diff --cached', { cwd: projPath, encoding: 'utf8', timeout: 3000 }); } catch (e) {}
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
    const commitSkill = findProjectCommitSkill(projPath);

    let bodyData = {};
    const executeGen = () => {
      // 取得當前專案的最新 diff 與 modifiedFiles
      collectGitDiff(projPath, buildCustomEnv(), (modifiedFiles, diffContent) => {
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
          const cliPrompt = `請分析專案 ${task.project} 當前 Git Diff 與技能規範，產出符合 Conventional Commit 的 Commit Message。格式第一行必須為「type(scope): subject」，接著空一行，隨後為條列式說明（以 - 開頭）。請只輸出 Commit Message 本身：\n\n【任務資訊】\nID: ${task.id}\n標題: ${task.title}\n需求: ${task.description || '無'}\n\n【異動檔案】\n${mergedModified.join(', ')}\n\n【Git Diff】\n${(diffContent || '').slice(0, 6000)}`;

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

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(` Task Dashboard Server running at http://localhost:${PORT}`);
    console.log(` Single Source of Truth: ${ROOT_DIR}`);
    syncToMarkdown(readTasks());
  });
}

module.exports = {
  server,
  initProjectHarness,
  parseAgentStatusContent,
  parseBuildPlanContent,
  scanProjectWorklogAndPlan,
  syncProjectWorklogForActiveTask,
  syncProjectWorklogForRedo,
  syncProjectWorklogOnReview,
  syncProjectWorklogOnDone
};
