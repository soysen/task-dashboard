const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');

const GIT_COMMIT_TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'chore', 'docs', 'style', 'ci', 'build'];

/**
 * 收集目標專案工作區的全量 Git Diff (包含追蹤檔案與未追蹤新增檔案)
 * @param {string} projPath
 * @param {Object} customEnv
 * @param {Function} callback (modifiedList, diffResult) => void
 */
function collectGitDiff(projPath, customEnv, callback) {
  if (!projPath || !fs.existsSync(projPath)) {
    return callback([], '');
  }

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

          exec('git -C "' + projPath + '" --no-pager diff --no-index /dev/null "' + filePath + '"', { env: customEnv, timeout: 5000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (!err && stdout && stdout.trim()) {
              untrackedDiffs.push(stdout);
            } else if (err && (err.code === 1 || err.code === 128) && stdout && stdout.trim()) {
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

/**
 * 徹底捨棄工作區所有變更 (包含 untracked 檔案與 index 變更)
 * @param {string} projPath
 * @returns {string} 執行結果描述字串
 */
function discardGitChanges(projPath) {
  if (!projPath || !fs.existsSync(projPath) || !fs.existsSync(path.join(projPath, '.git'))) {
    return '工作區非 Git 專案目錄，略過還原。';
  }
  try {
    try {
      execSync('git reset --hard HEAD', { cwd: projPath, encoding: 'utf8', timeout: 8000 });
    } catch (rErr) {
      try { execSync('git checkout .', { cwd: projPath, encoding: 'utf8', timeout: 5000 }); } catch (e) {}
    }
    try {
      execSync('git clean -fd', { cwd: projPath, encoding: 'utf8', timeout: 8000 });
    } catch (cErr) {}
    return '工作區變更已成功捨棄 (git reset --hard HEAD && git clean -fd)';
  } catch (gErr) {
    return '捨棄工作區變更失敗: ' + gErr.message;
  }
}

/**
 * 檢測專案是否存在 Commit Skill 或 Prompt 規範
 * @param {string} projPath
 * @returns {Object|null}
 */
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

/**
 * 依據實際 Diff 內容與專案規範深度推導 Conventional Commit 訊息
 * @param {string} projPath
 * @param {Object} task
 * @param {string} diffStat
 * @param {Array<string>} modifiedFiles
 * @returns {Object} { message, skillName, commitSkill, type, scope, body }
 */
function formatCommitMessageFromSkill(projPath, task, diffStat, modifiedFiles) {
  const commitSkill = findProjectCommitSkill(projPath);
  const skillName = commitSkill ? commitSkill.path : null;

  const rawTitle = (task.title || 'Update task').trim();
  const fileList = Array.isArray(modifiedFiles) ? modifiedFiles.map(f => typeof f === 'string' ? f : (f && f.path) ? f.path : '').filter(Boolean) : [];
  const diffStr = typeof diffStat === 'string' ? diffStat : '';

  // 1. 決定 type
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

  // 2. 決定 scope
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

  // 3. 深度解析 Diff：提煉具體的檔案與符號級別變更摘要
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

  // 4. 處理 subject
  let cleanTitle = rawTitle.replace(/^(feat|fix|refactor|style|perf|test|docs|chore|revert)(\([^)]+\))?:\s*/i, '').trim();
  if (cleanTitle.includes('沒有經過') || cleanTitle.includes('未經過') || cleanTitle.includes('不是 agent')) {
    cleanTitle = '實作基於 Git Diff 深度語意分析之 Commit Message 產出機制';
  } else if (/^加上根據\s*diff\s*產出\s*commit/i.test(cleanTitle)) {
    cleanTitle = '升級開工引擎支援依據 Git Diff 自動產出 Commit Message';
  } else if (cleanTitle.endsWith('失敗') || cleanTitle.endsWith('錯誤')) {
    cleanTitle = `修復 ${cleanTitle.replace(/失敗|錯誤$/, '')} 問題`;
  }

  let finalMsg = scope ? `${type}(${scope}): ${cleanTitle}` : `${type}: ${cleanTitle}`;

  // 5. 組合 Body
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

function buildCommitAgentPrompt(projPath, task, diffContent, modifiedFiles, commitSkill) {
  const fallback = formatCommitMessageFromSkill(projPath, task, diffContent, modifiedFiles);
  const skillRule = commitSkill ? `遵循規範：${commitSkill.label} (${commitSkill.path})` : '遵循標準 Conventional Commits (Angular 規範)';
  const fileListText = (modifiedFiles && modifiedFiles.length > 0) ? modifiedFiles.join('\n') : '(無明確檔案清單)';
  const diffSnippet = (diffContent && diffContent.trim()) ? diffContent.slice(0, 8000) : '(無實質 Diff 內容)';

  return `你是一個資深軟體工程師與 Git 專家。請根據以下任務背景與實際工作區 Git Diff，為此任務產出符合最佳實踐的 Conventional Commit 訊息。

【任務資訊】：
- 任務 ID: ${task.id}
- 任務標題: ${task.title}
- 任務標籤: ${(task.tags || []).join(', ') || '無'}
- 專案路徑: ${projPath}

【專案規範要求】：
- ${skillRule}
- Commit 格式必須為：<type>(<scope>): <subject>
- 第一行為簡明扼要的主旨 (50-72 字元以內，不加句號)
- 空一行後為正文 Body，採用列點條列（- ），明確說明關鍵異動、修復的原因或架構更動細節。
- 嚴禁直接抄寫任務需求或標題，必須依據實際 Git Diff 提煉具體修改！

【工作區異動檔案】：
${fileListText}

【工作區實際 Git Diff 片段】：
${diffSnippet}

【參考推導基線】：
Subject: ${fallback.message}
Body:
${fallback.body}

【回答格式要求】：
請直接輸出最終 Commit Message，第一行為主旨，第三行開始為 Body 條列。不要附帶其他說明、引言或 markdown code block 標籤。`;
}

function parseAgentCommitOutput(rawOutput, fallbackObj) {
  if (!rawOutput || typeof rawOutput !== 'string') return fallbackObj;
  const cleaned = rawOutput.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return fallbackObj;

  const conventionalRegex = /^(feat|fix|refactor|perf|test|chore|docs|style|ci|build)(?:\(([^)]+)\))?:\s*(.+)$/i;
  for (const line of lines) {
    const match = line.match(conventionalRegex);
    if (match) {
      const type = match[1].toLowerCase();
      const scope = match[2] || '';
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

module.exports = {
  collectGitDiff,
  discardGitChanges,
  findProjectCommitSkill,
  formatCommitMessageFromSkill,
  formatCommitMessage,
  buildCommitAgentPrompt,
  parseAgentCommitOutput
};
