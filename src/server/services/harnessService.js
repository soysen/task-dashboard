/**
 * harnessService.js
 * 封裝受管專案之 GitHub Skills、Prompts、Harness 檢核與本機專案掃描
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectProjectGitNexus } = require('../gitnexusDetector');

const USER_HOME = process.env.HOME || os.homedir();
const PROJECTS_ROOT = path.join(USER_HOME, 'projects');
const TEMPLATES_DIR = path.resolve(__dirname, '../templates');

function scanProjectGithubInfo(projPath) {
  const info = {
    skills: [],
    prompts: [],
    harness: {
      hasHarness: false,
      command: '',
      files: []
    },
    docs: [],
    gitnexus: detectProjectGitNexus(projPath)
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

  let hasHarnessFound = false;
  if (fs.existsSync(harnessMd)) {
    info.harness.files.push('HARNESS.md');
    hasHarnessFound = true;
  }
  if (fs.existsSync(harnessDir)) {
    try {
      const hEntries = fs.readdirSync(harnessDir);
      hEntries.forEach(ent => {
        if (ent.endsWith('.md') || ent === 'plan' || ent === 'templates') {
          info.harness.files.push(`.github/harness/${ent}`);
          hasHarnessFound = true;
        }
      });
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

  let pkgScripts = {};
  const pkgPath = path.join(projPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        pkgScripts = pkg.scripts;
      }
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
  } else if (fs.existsSync(path.join(projPath, 'pubspec.yaml'))) {
    info.harness.command = 'flutter test';
  } else if (fs.existsSync(path.join(projPath, 'Cargo.toml'))) {
    info.harness.command = 'cargo test';
  } else if (fs.existsSync(path.join(projPath, 'pyproject.toml')) || fs.existsSync(path.join(projPath, 'pytest.ini'))) {
    info.harness.command = 'pytest';
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

const HARNESS_GITIGNORE_ENTRIES = [
  '.github/worklog/',
  '**/agent-status.md',
  '.github/harness/plan/*-build-plan.md'
];

/**
 * 確保目標專案的 .gitignore 已忽略 Harness 執行期暫存檔 (agent-status / build-plan)
 * @param {string} projPath
 * @returns {boolean} 是否建立或更新了 .gitignore
 */
function ensureHarnessGitignore(projPath) {
  if (!projPath || !fs.existsSync(projPath)) return false;
  const gitignorePath = path.join(projPath, '.gitignore');
  const existingContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  const existingLines = new Set(
    existingContent.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  );
  const missingEntries = HARNESS_GITIGNORE_ENTRIES.filter(entry => !existingLines.has(entry));
  if (missingEntries.length === 0) return false;

  const prefix = existingContent.length > 0 && !existingContent.endsWith('\n') ? '\n' : '';
  const headerComment = existingContent.includes('# Harness local runtime worklog') ? '' : `${existingContent ? '\n' : ''}# Harness local runtime worklog & task build plans\n`;
  const appendBlock = `${prefix}${headerComment}${missingEntries.join('\n')}\n`;
  fs.writeFileSync(gitignorePath, `${existingContent}${appendBlock}`, 'utf8');
  return true;
}

function initProjectHarness(projPath) {
  if (!projPath || !fs.existsSync(projPath)) {
    throw new Error(`Project directory not found: ${projPath}`);
  }

  const createdFiles = [];
  if (ensureHarnessGitignore(projPath)) {
    createdFiles.push('.gitignore');
  }
  const githubDir = path.join(projPath, '.github');
  const worklogDir = path.join(githubDir, 'worklog');
  const harnessDir = path.join(githubDir, 'harness');
  const planDir = path.join(harnessDir, 'plan');
  const templateDir = path.join(harnessDir, 'templates');
  const scriptsDir = path.join(projPath, 'scripts');

  [worklogDir, planDir, templateDir, scriptsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const githubInfo = scanProjectGithubInfo(projPath);
  const detectedCmd = (githubInfo.harness && githubInfo.harness.command) ? githubInfo.harness.command : '';

  // 1. .github/worklog/agent-status.md
  const statusFile = path.join(worklogDir, 'agent-status.md');
  if (!fs.existsSync(statusFile)) {
    const srcStatus = path.join(TEMPLATES_DIR, 'agent-status.md');
    const content = fs.existsSync(srcStatus) ? fs.readFileSync(srcStatus, 'utf8') : `# Agent Status

## Active Task

- ID: none
- Title: N/A
- Status: idle
- Last updated: ${new Date().toISOString().split('T')[0]}
- Goal: N/A
- Route: none
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
    const srcBp = path.join(TEMPLATES_DIR, 'build-plan.md');
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
    const srcHarness = path.join(TEMPLATES_DIR, 'HARNESS.md');
    let harnessMdContent = fs.existsSync(srcHarness) ? fs.readFileSync(srcHarness, 'utf8') : `# Project Harness & Quality Gate

## 1. 診斷與測試
本專案遵循 Task Dashboard Harness 品質閘門標準與雙寫切片規範。

- **執行 Harness 檢驗**：\`npm run harness:check\` 或 \`bash scripts/harness_check.sh\`
- **單元測試**：\`npm test\`

## 2. 狀態與切片雙寫規範 (Plan & Worklog Sync)
- 進行中任務 (In Progress) 請同步維護 \`.github/worklog/agent-status.md\` 與 \`.github/harness/plan/\`。
- 每個非平凡任務均需拆解為獨立可驗證的 Slices。
- 交付審查前需確保全量 Diff (含已追蹤與未追蹤) 完整無占位符。
`;
    if (detectedCmd && detectedCmd !== 'npm run harness:check' && detectedCmd !== 'bash scripts/harness_check.sh') {
      harnessMdContent = harnessMdContent.replace(/`npm run harness:check` 或 `bash scripts\/harness_check\.sh`/, `\`${detectedCmd}\``);
    }
    fs.writeFileSync(harnessMdFile, harnessMdContent, 'utf8');
    createdFiles.push('HARNESS.md');
  }

  // 5. scripts/harness_check.sh
  const harnessScriptFile = path.join(scriptsDir, 'harness_check.sh');
  if (!fs.existsSync(harnessScriptFile)) {
    let checkScriptContent = `#!/bin/bash
set -e
echo "🔍 執行專案 Harness 診斷與檢驗..."
`;
    if (detectedCmd && detectedCmd !== 'npm run harness:check' && detectedCmd !== 'bash scripts/harness_check.sh') {
      checkScriptContent += `${detectedCmd}\n`;
    } else {
      checkScriptContent += `if [ -f "package.json" ]; then
  if grep -q '"test"' package.json; then
    npm test
  fi
fi\n`;
    }
    checkScriptContent += `echo "✅ Harness 檢核通過！"\n`;
    fs.writeFileSync(harnessScriptFile, checkScriptContent, { encoding: 'utf8', mode: 0o755 });
    createdFiles.push('scripts/harness_check.sh');
  }

  // 6. 補充 package.json 中的 harness:check 指令 (僅當專案存在 package.json 時)
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

function scanLocalProjects() {
  const scanned = [];
  try {
    if (fs.existsSync(PROJECTS_ROOT)) {
      const items = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('.')) {
          const projPath = path.join(PROJECTS_ROOT, item.name);
          let description = `本機專案路徑: ~/projects/${item.name}`;
          let color = 'indigo';

          const pkgPath = path.join(projPath, 'package.json');
          if (fs.existsSync(pkgPath)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
              if (pkg.description) description = pkg.description;
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

module.exports = {
  scanProjectGithubInfo,
  ensureHarnessGitignore,
  initProjectHarness,
  scanLocalProjects
};
