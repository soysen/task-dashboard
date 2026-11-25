const fs = require('fs');
const path = require('path');
const { exec, execSync, execFileSync } = require('child_process');

const GIT_COMMIT_TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'chore', 'docs', 'style', 'ci', 'build'];
const repoMergeQueues = new Map();

/**
 * 收集目標專案工作區的全量 Git Diff (包含追蹤檔案與未追蹤新增檔案)
 * @param {string} projPath
 * @param {Object} customEnv
 * @param {Function} callback (modifiedList, diffResult) => void
 * @param {Object} [options]
 */
function collectGitDiff(projPath, customEnv, callback, options = {}) {
  if (!projPath || !fs.existsSync(projPath)) {
    return callback([], '');
  }

  const collectCommittedRangeDiff = () => {
    const baseRef = options && (options.baseCommit || options.baseBranch);
    if (!baseRef) return callback([], '');
    try {
      const filesRaw = execFileSync('git', ['-C', projPath, 'diff', '--name-only', `${baseRef}..HEAD`], {
        env: customEnv, encoding: 'utf8', timeout: 10000
      }).trim();
      if (!filesRaw) return callback([], '');
      const files = filesRaw.split('\n').map(s => s.trim()).filter(Boolean);
      const diffText = execFileSync('git', ['-C', projPath, 'diff', `${baseRef}..HEAD`], {
        env: customEnv, encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024
      });
      return callback(files, diffText || '');
    } catch (e) {
      return callback([], '');
    }
  };

  const statusCmd = 'git -C "' + projPath + '" status --porcelain -uall';
  exec(statusCmd, { env: customEnv, timeout: 10000, maxBuffer: 20 * 1024 * 1024 }, (statusErr, statusStdout) => {
    if (statusErr || !statusStdout || !statusStdout.trim()) {
      return collectCommittedRangeDiff();
    }

    const lines = statusStdout.split('\n').filter(l => l.trim().length > 0);
    const parseStatusPath = (l) => l.replace(/^[ A-Z?!]{1,2}\s+/, '').trim();
    const modifiedList = lines.map(parseStatusPath).filter(Boolean);
    const untrackedLines = lines.filter(l => l.trim().startsWith('??'));

    // 收集已追蹤檔案的 diff (git diff HEAD)
    exec('git -C "' + projPath + '" diff HEAD', { env: customEnv, timeout: 15000, maxBuffer: 20 * 1024 * 1024 }, (diffErr, diffContent) => {
      let diffResult = (!diffErr && diffContent && diffContent.trim()) ? diffContent : '';

      // 收集未追蹤檔案的內容 (git diff --no-index /dev/null <file>)
      if (untrackedLines.length > 0 && !diffErr) {
        let pendingCount = untrackedLines.length;
        const untrackedDiffs = [];

        untrackedLines.forEach(line => {
          const filePath = parseStatusPath(line);
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
 * 依據實際 Diff 內容、結構化變更 (keyChanges / resolution) 與專案規範深度推導 Conventional Commit 訊息
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
    if (/修復|修正|fix|error|bug|錯|問題|沒有|未|異常|失效/i.test(rawTitle)) type = 'fix';
    else if (/重構|refactor/i.test(rawTitle)) type = 'refactor';
    else if (/優化|改善|提升|perf|optimize/i.test(rawTitle)) type = 'perf';
    else if (/樣式|style|版面|排版|css|scss|sass/i.test(rawTitle)) type = 'style';
    else if (/文件|doc|readme|md/i.test(rawTitle)) type = 'docs';
    else if (/測試|test|harness/i.test(rawTitle)) type = 'test';
    else type = 'feat';
  }

  // 2. 決定 scope
  let scope = '';
  const filesStr = (fileList.join(' ') + ' ' + diffStr.slice(0, 4000)).toLowerCase();
  if (filesStr.includes('git-status') || filesStr.includes('commit') || filesStr.includes('gitservice')) scope = 'git';
  else if (filesStr.includes('agentprovideradapter') || filesStr.includes('copilot') || filesStr.includes('adapter')) scope = 'orchestration';
  else if (filesStr.includes('watch-task-gate') || (filesStr.includes('gate') && filesStr.includes('server'))) scope = 'engine';
  else if (filesStr.includes('src/native') || filesStr.includes('.m') || filesStr.includes('webkit')) scope = 'native';
  else if (filesStr.includes('server.js') || filesStr.includes('src/server')) scope = 'server';
  else if (filesStr.includes('modal.js') || filesStr.includes('index.html') || filesStr.includes('src/public') || filesStr.includes('views') || filesStr.includes('component')) scope = 'ui';
  else if (filesStr.includes('harness') || filesStr.includes('test_server.sh') || filesStr.includes('scripts/test')) scope = 'harness';
  else if (filesStr.includes('.github/skills') || filesStr.includes('skill.md')) scope = 'skills';
  else if (filesStr.includes('order-management') || filesStr.includes('order')) scope = 'order';
  else if (filesStr.includes('router')) scope = 'router';
  else if (filesStr.includes('store') || filesStr.includes('redux') || filesStr.includes('vuex')) scope = 'store';
  else if (filesStr.includes('api') || filesStr.includes('service')) scope = 'api';
  else if (filesStr.includes('auth') || filesStr.includes('login') || filesStr.includes('permission')) scope = 'auth';
  else if (filesStr.includes('package.json') || filesStr.includes('scripts/build') || filesStr.includes('build_app')) scope = 'build';

  // 3. 深度解析 Diff：提煉具體的意圖註解與程式碼符號特徵
  const fileChunks = diffStr.includes('diff --git') ? diffStr.split(/^diff --git /m).filter(Boolean) : [];
  const chunkMap = {};

  for (const chunk of fileChunks) {
    const firstLine = chunk.split('\n')[0] || '';
    const m = firstLine.match(/a\/(\S+)\s+b\/(\S+)/);
    const fPath = m ? m[2] : '';
    if (fPath) chunkMap[fPath] = chunk;
  }

  const allFiles = Array.from(new Set([...fileList, ...Object.keys(chunkMap)]));
  const diffBullets = [];

  allFiles.forEach(fName => {
    const baseName = path.basename(fName);
    const chunk = chunkMap[fName] || '';

    const detectedComments = [];
    const detectedRoutes = [];
    const detectedFns = [];
    const detectedUI = [];
    const detectedAsserts = [];
    const detectedMdHeaders = [];
    const detectedStyles = [];
    const detectedExports = [];

    if (chunk) {
      const addedLines = chunk.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
      for (const l of addedLines) {
        const lineContent = l.slice(1).trim();
        if (!lineContent) continue;

        // 意圖註解提取：// 或 /*，若包含 [標籤]、中文字元或意圖動詞，視為重要開發意圖
        const commentMatch = lineContent.match(/^(?:\/\/\s*|\/\*\s*|\*\s*)(?:\[([^\]]+)\][:：]?\s*)?([^\n\r*\/]{4,80})/);
        if (commentMatch) {
          const tag = (commentMatch[1] || '').trim();
          let cText = (commentMatch[2] || '').trim().replace(/^[-*]\s*/, '');
          if (cText && !/^(eslint|istanbul|ts-check|ts-ignore|@ts-)/i.test(cText)) {
            // 包含中文字元或常見意圖動詞
            if (/[\u4e00-\u9fa5]/.test(cText) || /^(support|add|fix|refactor|update|handle|check|guard|validate|optimize)\b/i.test(cText)) {
              const fullComment = tag ? `[${tag}] ${cText}` : cText;
              if (!detectedComments.some(c => c.includes(cText) || cText.includes(c))) {
                detectedComments.push(fullComment);
              }
            }
          }
        }

        // API 路由
        const routeMatch = lineContent.match(/(?:app\.(?:get|post|put|delete|patch)|pathname\s*(?:===|\.startsWith\(|\.match\())\s*['"`]?(\/api\/[a-zA-Z0-9_\-\/:*]+)/);
        if (routeMatch && !detectedRoutes.includes(routeMatch[1])) detectedRoutes.push(routeMatch[1]);

        // 函式與方法定義
        const fnDefMatch = lineContent.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(/);
        if (fnDefMatch) {
          const fnName = fnDefMatch[1] || fnDefMatch[2];
          if (fnName && !['require', 'test', 'it', 'describe', 'before', 'after'].includes(fnName) && !detectedFns.includes(fnName)) {
            detectedFns.push(fnName);
          }
        }

        // UI 元件 ID 或事件
        const uiMatch = lineContent.match(/<(?:button|div|input|modal|span|dialog|select|form)[^>]*id=['"]([^'"]+)['"]/);
        if (uiMatch && !detectedUI.includes(uiMatch[1])) detectedUI.push(`#${uiMatch[1]}`);

        // 測試案例與斷言
        const testMatch = lineContent.match(/(?:it|test)\s*\(\s*['"`]([^'"`]{4,60})['"`]|assert(?:\.[a-zA-Z0-9_$]+)?\([^,]+,\s*['"`]([^'"`]{4,60})['"`]/);
        if (testMatch) {
          const testDesc = testMatch[1] || testMatch[2];
          if (testDesc && !detectedAsserts.includes(testDesc)) detectedAsserts.push(testDesc);
        }

        // Markdown 標題變更
        const mdMatch = lineContent.match(/^#{1,4}\s+(.+)$/);
        if (mdMatch && !detectedMdHeaders.includes(mdMatch[1].trim())) {
          detectedMdHeaders.push(mdMatch[1].trim());
        }

        // 樣式 Selector (支援 CSS / SCSS / SASS)
        const styleMatch = lineContent.match(/^([.#][a-zA-Z0-9_\-]+)(?:[\s{:]|$)/);
        if (styleMatch && !detectedStyles.includes(styleMatch[1])) {
          detectedStyles.push(styleMatch[1]);
        }

        // 模組匯出
        const exportMatch = lineContent.match(/(?:module\.exports\s*=\s*\{|export\s+(?:const|function|default)\s+)([a-zA-Z0-9_$,\s]+)/);
        if (exportMatch) {
          const expNames = exportMatch[1].split(',').map(s => s.trim()).filter(s => s && /^[a-zA-Z0-9_$]+$/.test(s));
          expNames.forEach(n => { if (!detectedExports.includes(n)) detectedExports.push(n); });
        }
      }
    }

    // 依據實質提取結果組合描述（絕對不使用硬編碼罐頭！）
    let summary = '';
    if (detectedComments.length > 0) {
      summary = detectedComments[0];
      if (detectedFns.length > 0 && !summary.includes(detectedFns[0])) {
        summary += ` (${detectedFns.slice(0, 2).join(', ')})`;
      }
    } else if (detectedRoutes.length > 0) {
      summary = `調整 API 路由端點 (${detectedRoutes.slice(0, 3).join(', ')})`;
    } else if (detectedUI.length > 0) {
      summary = `更新介面元件與互動控制 (${detectedUI.slice(0, 3).join(', ')})`;
    } else if (detectedStyles.length > 0) {
      summary = `更新樣式規則 (${detectedStyles.slice(0, 3).join(', ')})`;
    } else if (detectedFns.length > 0) {
      summary = `實作/調整模組函式 (${detectedFns.slice(0, 3).join(', ')})`;
    } else if (detectedExports.length > 0) {
      summary = `擴充模組介面匯出 (${detectedExports.slice(0, 3).join(', ')})`;
    } else if (detectedMdHeaders.length > 0) {
      summary = `新增/更新規範章節 (${detectedMdHeaders.slice(0, 2).join(' / ')})`;
    } else if (detectedAsserts.length > 0) {
      summary = `補齊測試驗證 (${detectedAsserts.slice(0, 2).join(' / ')})`;
    } else if (fName.endsWith('.md')) {
      summary = `更新技術說明與架構指引文檔 (${baseName})`;
    } else if (fName.includes('test') || fName.includes('harness')) {
      summary = `擴充自動化測試與規範檢核 (${baseName})`;
    } else {
      summary = `更新代碼邏輯與邊界處理 (${baseName})`;
    }

    diffBullets.push(`- ${summary} (${fName})`);
  });

  // 4. 結構化 keyChanges 與 resolution 優先採納與整合
  const structuredBullets = [];
  if (Array.isArray(task.keyChanges) && task.keyChanges.length > 0) {
    task.keyChanges.forEach(kc => {
      if (typeof kc === 'string' && kc.trim()) {
        const cleanKc = kc.trim().replace(/^[-*]\s*/, '');
        if (cleanKc && !structuredBullets.includes(`- ${cleanKc}`)) {
          structuredBullets.push(`- ${cleanKc}`);
        }
      }
    });
  } else if (typeof task.keyChanges === 'string' && task.keyChanges.trim()) {
    task.keyChanges.split('\n').map(l => l.trim().replace(/^[-*]\s*/, '')).filter(Boolean).forEach(cleanKc => {
      if (!structuredBullets.includes(`- ${cleanKc}`)) {
        structuredBullets.push(`- ${cleanKc}`);
      }
    });
  }

  // 5. 處理 subject (主旨提煉：正向動詞化、去除抱怨與測試語句、保持具體標題原主軸)
  let cleanTitle = rawTitle.replace(/^(feat|fix|refactor|style|perf|test|docs|chore|revert)(\([^)]+\))?:\s*/i, '').trim();

  // 智慧語意轉換：若標題為反面抱怨、問題陳述或測試指令，重構為明確工程動作
  if (/未針對.*diff.*產出|僅僅只是帶入.*harness/i.test(cleanTitle)) {
    cleanTitle = '升級 Commit 訊息產出機制支援依據 Git Diff 深度語意提煉';
  } else if (cleanTitle.includes('沒有經過') || cleanTitle.includes('未經過') || cleanTitle.includes('不是 agent')) {
    cleanTitle = '實作基於 Git Diff 深度語意分析之 Commit Message 產出機制';
  } else if (/^加上根據\s*diff\s*產出\s*commit/i.test(cleanTitle)) {
    cleanTitle = '升級開工引擎支援依據 Git Diff 自動產出 Commit Message';
  } else if (cleanTitle.endsWith('失敗') || cleanTitle.endsWith('錯誤')) {
    cleanTitle = `修復 ${cleanTitle.replace(/失敗|錯誤$/, '')} 問題`;
  } else if (/^優化$/i.test(cleanTitle) || /^測試$/i.test(cleanTitle) || /^修復 bug$/i.test(cleanTitle)) {
    if (diffBullets.length > 0) {
      const firstSummary = diffBullets[0].replace(/^[-\s]+/, '').replace(/\s*\([^)]*\)$/, '');
      cleanTitle = firstSummary;
    }
  }

  let finalMsg = scope ? `${type}(${scope}): ${cleanTitle}` : `${type}: ${cleanTitle}`;

  // 6. 組合 Body (有 keyChanges 優先，輔以 resolution 概述與實質 Diff 條列)
  const bodyLines = [];
  if (task.resolution && typeof task.resolution === 'string' && task.resolution.trim().length > 10) {
    const cleanRes = task.resolution.trim().split('\n')[0].replace(/^1\.\s*/, '').trim();
    if (cleanRes.length > 8 && !cleanRes.includes('程式碼與架構規範檢驗通過')) {
      bodyLines.push(`解決方案：${cleanRes}`);
      bodyLines.push('');
    }
  }

  if (structuredBullets.length > 0) {
    bodyLines.push(...structuredBullets);
    // 若有部分 diff 檔案不在 keyChanges 提及的檔案中，以補充條列補齊
    const keyChangesText = structuredBullets.join(' ');
    diffBullets.forEach(b => {
      const matchFile = b.match(/\(([^)]+)\)$/);
      if (matchFile && !keyChangesText.includes(matchFile[1]) && !bodyLines.includes(b)) {
        bodyLines.push(b);
      }
    });
  } else if (diffBullets.length > 0) {
    bodyLines.push(...diffBullets);
  } else if (allFiles.length > 0) {
    bodyLines.push(...allFiles.map(f => `- 異動檔案: ${f}`));
  } else {
    bodyLines.push('- (無工作區檔案變更之提交)');
  }

  const bodyText = bodyLines.join('\n').trim();

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

/**
 * 取得指定 Git 目錄當前的分支名稱與 HEAD Commit SHA
 * @param {string} repoPath
 * @returns {{ branch: string, commit: string }}
 */
function getGitBranchInfo(repoPath) {
  if (!repoPath || !fs.existsSync(repoPath)) return { branch: '', commit: '' };
  try {
    const branch = execFileSync('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5000
    }).trim();
    const commit = execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5000
    }).trim();
    return { branch: branch === 'HEAD' ? '' : branch, commit };
  } catch (e) {
    return { branch: '', commit: '' };
  }
}

const PROJECT_BRANCH_CACHE_TTL_MS = 5000;
const projectBranchCache = new Map();

function clearProjectBranchCache(repoPath) {
  if (!repoPath) {
    projectBranchCache.clear();
    return;
  }
  projectBranchCache.delete(path.resolve(String(repoPath)));
}

function runGitArgs(repoPath, args, timeout = 5000) {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    timeout
  });
}

function attachBranchTaskCounts(branchInfo, tasks = []) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const activeTasks = safeTasks.filter(t => t && t.status !== 'archived');
  const branches = (branchInfo.branches || []).map(b => {
    const matched = activeTasks.filter(t => (t.targetBranch || t.baseBranch || '') === b.name);
    const activeTaskCount = matched.filter(t => ['todo', 'in_progress', 'needs_human'].includes(t.status)).length;
    const reviewTaskCount = matched.filter(t => t.status === 'review').length;
    return {
      ...b,
      activeTaskCount,
      reviewTaskCount
    };
  });
  return {
    ...branchInfo,
    branches
  };
}

/**
 * 查詢專案 Git 分支清單、目前 Checkout 分支與工作區 Dirty 狀態（含 5 秒快取）
 * @param {string} repoPath
 * @param {Array} [tasks]
 * @param {Object} [options]
 * @returns {{ isGitRepo: boolean, currentCheckoutBranch: string, isMainWorkspaceDirty: boolean, dirtyFilesCount: number, defaultBranch: string, branches: Array }}
 */
function getProjectBranches(repoPath, tasks = [], options = {}) {
  const emptyResult = {
    isGitRepo: false,
    currentCheckoutBranch: '',
    isMainWorkspaceDirty: false,
    dirtyFilesCount: 0,
    defaultBranch: '',
    branches: []
  };
  if (!repoPath || !fs.existsSync(repoPath)) return emptyResult;

  const resolvedPath = path.resolve(String(repoPath));
  const now = Date.now();
  if (!options.refresh) {
    const cached = projectBranchCache.get(resolvedPath);
    if (cached && (now - cached.timestamp) < PROJECT_BRANCH_CACHE_TTL_MS) {
      return attachBranchTaskCounts(cached.data, tasks);
    }
  } else {
    projectBranchCache.delete(resolvedPath);
  }

  try {
    const insideWorkTree = runGitArgs(resolvedPath, ['rev-parse', '--is-inside-work-tree']).trim();
    if (insideWorkTree !== 'true') {
      return emptyResult;
    }
  } catch (e) {
    return emptyResult;
  }

  let currentCheckoutBranch = '';
  try {
    const headRef = runGitArgs(resolvedPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    currentCheckoutBranch = headRef === 'HEAD' ? '' : headRef;
  } catch (e) {
    try {
      currentCheckoutBranch = runGitArgs(resolvedPath, ['symbolic-ref', '--short', 'HEAD']).trim();
    } catch (_) {
      currentCheckoutBranch = '';
    }
  }

  let dirtyFilesCount = 0;
  try {
    const porcelain = runGitArgs(resolvedPath, ['status', '--porcelain']);
    dirtyFilesCount = porcelain.split(/\r?\n/).filter(line => line.trim().length > 0).length;
  } catch (e) {
    dirtyFilesCount = 0;
  }
  const isMainWorkspaceDirty = dirtyFilesCount > 0;

  let rawBranches = [];
  try {
    const formatStr = '%(refname:short)%00%(objectname:short)%00%(committerdate:relative)%00%(subject)';
    const out = runGitArgs(resolvedPath, ['for-each-ref', '--sort=-committerdate', `--format=${formatStr}`, 'refs/heads/']);
    rawBranches = out
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        const parts = line.includes('\0') ? line.split('\0') : line.split('%x1f');
        const [name = '', headSha = '', updatedRelative = '', subject = ''] = parts;
        return {
          name: name.trim(),
          headSha: headSha.trim(),
          subject: subject.trim(),
          updatedRelative: updatedRelative.trim(),
          isCurrentCheckout: name.trim() === currentCheckoutBranch
        };
      })
      .filter(b => b.name);
  } catch (e) {
    rawBranches = [];
  }

  if (currentCheckoutBranch && !rawBranches.some(b => b.name === currentCheckoutBranch)) {
    rawBranches.unshift({
      name: currentCheckoutBranch,
      headSha: '',
      subject: '（尚未有 Commit）',
      updatedRelative: '',
      isCurrentCheckout: true
    });
  }

  let defaultBranch = '';
  try {
    const originHead = runGitArgs(resolvedPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim();
    defaultBranch = originHead.replace(/^origin\//, '');
  } catch (e) {
    // Fallback to main / master / current checkout
  }
  if (!defaultBranch || !rawBranches.some(b => b.name === defaultBranch)) {
    if (rawBranches.some(b => b.name === 'main')) {
      defaultBranch = 'main';
    } else if (rawBranches.some(b => b.name === 'master')) {
      defaultBranch = 'master';
    } else {
      defaultBranch = currentCheckoutBranch || (rawBranches[0] ? rawBranches[0].name : '');
    }
  }

  const snapshot = {
    isGitRepo: true,
    currentCheckoutBranch,
    isMainWorkspaceDirty,
    dirtyFilesCount,
    defaultBranch,
    branches: rawBranches
  };
  projectBranchCache.set(resolvedPath, { timestamp: now, data: snapshot });
  return attachBranchTaskCounts(snapshot, tasks);
}

/**
 * 在不影響工作區現有修改的情況下建立新分支（預設使用 git branch <branchName> <fromBranch>）
 * @param {string} repoPath
 * @param {string} branchName
 * @param {string} [fromBranch]
 * @param {Object} [options]
 * @returns {{ branch: string, fromBranch: string, headSha: string, checkout: boolean }}
 */
function createProjectBranch(repoPath, branchName, fromBranch = '', options = {}) {
  if (!repoPath || !fs.existsSync(repoPath)) {
    const err = new Error('專案路徑不存在');
    err.statusCode = 404;
    throw err;
  }

  const resolvedPath = path.resolve(String(repoPath));
  try {
    const insideWorkTree = runGitArgs(resolvedPath, ['rev-parse', '--is-inside-work-tree']).trim();
    if (insideWorkTree !== 'true') {
      const err = new Error('此專案資料夾不是 Git 儲存庫');
      err.statusCode = 400;
      throw err;
    }
  } catch (e) {
    if (e.statusCode) throw e;
    const err = new Error('此專案資料夾不是 Git 儲存庫');
    err.statusCode = 400;
    throw err;
  }

  const cleanBranch = String(branchName || '').trim();
  if (!cleanBranch || cleanBranch.startsWith('-')) {
    const err = new Error('請提供有效的分支名稱');
    err.statusCode = 400;
    throw err;
  }

  try {
    execFileSync('git', ['check-ref-format', '--branch', cleanBranch], {
      encoding: 'utf8',
      timeout: 5000
    });
  } catch (e) {
    const err = new Error(`無效的分支名稱：${cleanBranch}`);
    err.statusCode = 400;
    throw err;
  }

  // 檢查是否已存在同名分支
  let branchExists = false;
  try {
    runGitArgs(resolvedPath, ['show-ref', '--verify', '--quiet', `refs/heads/${cleanBranch}`]);
    branchExists = true;
  } catch (_) {
    branchExists = false;
  }
  if (branchExists) {
    const err = new Error(`分支 "${cleanBranch}" 已存在`);
    err.statusCode = 400;
    throw err;
  }

  let sourceBranch = String(fromBranch || '').trim();
  if (sourceBranch.startsWith('-')) {
    const err = new Error(`無效的來源分支名稱：${sourceBranch}`);
    err.statusCode = 400;
    throw err;
  }
  if (!sourceBranch) {
    const currentInfo = getProjectBranches(resolvedPath, [], { refresh: true });
    sourceBranch = currentInfo.defaultBranch || currentInfo.currentCheckoutBranch || 'HEAD';
  }

  try {
    runGitArgs(resolvedPath, ['rev-parse', '--verify', `${sourceBranch}^{commit}`]);
  } catch (e) {
    const err = new Error(`找不到來源分支或提交：${sourceBranch}`);
    err.statusCode = 400;
    throw err;
  }

  const shouldCheckout = options && options.checkout === true;
  if (shouldCheckout) {
    runGitArgs(resolvedPath, ['checkout', '-b', cleanBranch, sourceBranch], 10000);
  } else {
    runGitArgs(resolvedPath, ['branch', '--', cleanBranch, sourceBranch], 10000);
  }

  clearProjectBranchCache(resolvedPath);
  const headSha = runGitArgs(resolvedPath, ['rev-parse', '--short', `refs/heads/${cleanBranch}`]).trim();
  return {
    branch: cleanBranch,
    fromBranch: sourceBranch,
    headSha,
    checkout: shouldCheckout
  };
}

/**
 * 依專案路徑加互斥鎖序列化執行非同步合併操作
 * @param {string} repoPath
 * @param {Function} fn
 * @returns {Promise<*>}
 */
function withRepoMergeLock(repoPath, fn) {
  const key = path.resolve(String(repoPath || ''));
  const prev = repoMergeQueues.get(key) || Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  repoMergeQueues.set(key, next.catch(() => {}));
  return next;
}

/**
 * 為任務建立獨立的 Git Worktree 隔離工作區並鎖定來源 baseBranch/baseCommit
 * @param {string} repoPath 原始專案目錄
 * @param {string} taskId 任務 ID (例如 TASK-166)
 * @param {Object} [options]
 * @returns {{ worktreePath: string, branchName: string, baseBranch: string, baseCommit: string }}
 */
function createTaskWorktree(repoPath, taskId, options = {}) {
  if (!repoPath || !fs.existsSync(repoPath) || !fs.existsSync(path.join(repoPath, '.git'))) {
    throw new Error('目標路徑非 Git 儲存庫，無法建立 Worktree: ' + repoPath);
  }
  const cleanRepo = repoPath.replace(/\/+$/, '');
  const worktreePath = `${cleanRepo}.worktrees/${taskId}`;
  const branchName = `td/${taskId}`;

  const headInfo = getGitBranchInfo(cleanRepo);
  const baseBranch = (options && options.baseBranch) ? String(options.baseBranch).trim() : (headInfo.branch || 'main');
  let baseCommit = headInfo.commit || '';
  try {
    baseCommit = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', baseBranch], {
      encoding: 'utf8',
      timeout: 5000
    }).trim();
  } catch (e) {}

  // 1. 防禦性清理：prune 與刪除同名殘留分支/目錄
  try { execSync('git -C "' + cleanRepo + '" worktree prune', { encoding: 'utf8', timeout: 5000, stdio: 'ignore' }); } catch (e) {}
  try {
    if (fs.existsSync(worktreePath)) {
      execSync('git -C "' + cleanRepo + '" worktree remove --force "' + worktreePath + '"', { encoding: 'utf8', timeout: 8000, stdio: 'ignore' });
    }
  } catch (e) {
    try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch (e2) {}
  }
  try { execSync('git -C "' + cleanRepo + '" branch -D "' + branchName + '"', { encoding: 'utf8', timeout: 5000, stdio: 'ignore' }); } catch (e) {}

  // 2. 建立目錄並透過 git worktree add 從鎖定的 baseCommit/baseBranch 開新分支
  const parentDir = path.dirname(worktreePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const startPoint = baseCommit || baseBranch || 'HEAD';
  execFileSync('git', ['-C', cleanRepo, 'worktree', 'add', '-b', branchName, worktreePath, startPoint], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: 'ignore'
  });

  return { worktreePath, branchName, baseBranch, baseCommit };
}

/**
 * 清理並移除任務關聯的 Git Worktree 隔離工作區與分支
 * @param {string} repoPath 原始專案目錄
 * @param {string} taskId 任務 ID
 * @param {string|Object} [branchOrOptions]
 * @returns {boolean}
 */
function removeTaskWorktree(repoPath, taskId, branchOrOptions = '') {
  if (!repoPath || !fs.existsSync(repoPath)) return false;
  const cleanRepo = repoPath.replace(/\/+$/, '');
  const customBranchName = typeof branchOrOptions === 'string' ? branchOrOptions : (branchOrOptions && branchOrOptions.branchName) || '';
  const customWorktreePath = (typeof branchOrOptions === 'object' && branchOrOptions && branchOrOptions.worktreePath) || '';
  const worktreePath = customWorktreePath || `${cleanRepo}.worktrees/${taskId}`;
  const branchName = customBranchName || `td/${taskId}`;

  try {
    execSync('git -C "' + cleanRepo + '" worktree remove --force "' + worktreePath + '"', {
      encoding: 'utf8',
      timeout: 10000,
      stdio: 'ignore'
    });
  } catch (e) {}

  try {
    execSync('git -C "' + cleanRepo + '" branch -D "' + branchName + '"', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: 'ignore'
    });
  } catch (e) {}

  try {
    execSync('git -C "' + cleanRepo + '" worktree prune', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: 'ignore'
    });
  } catch (e) {}

  if (fs.existsSync(worktreePath)) {
    try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch (e) {}
  }

  return true;
}

/**
 * 序列化安全合併管線：Rebase → 基線變動重驗 → 風險門確認 → Squash 合併 → 清理
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function mergeTaskWorktree(options = {}) {
  const {
    repoPath,
    taskId,
    task = {},
    worktreePath: explicitWorktreePath,
    branchName: explicitBranchName,
    baseBranch: explicitBaseBranch,
    baseCommit: explicitBaseCommit,
    verifyCommand = '',
    confirmOneWayMerge = false,
    mode = '',
    customEnv = process.env
  } = options;

  if (!repoPath || !fs.existsSync(repoPath) || !fs.existsSync(path.join(repoPath, '.git'))) {
    return { success: false, merged: false, status: 'not_git_repo', error: '目標專案非 Git 儲存庫' };
  }

  const cleanRepo = repoPath.replace(/\/+$/, '');
  const worktreePath = explicitWorktreePath || task.worktreePath || `${cleanRepo}.worktrees/${taskId}`;
  const branchName = explicitBranchName || task.branchName || `td/${taskId}`;

  return withRepoMergeLock(cleanRepo, async () => {
    if (!fs.existsSync(worktreePath)) {
      return {
        success: false,
        merged: false,
        status: 'worktree_missing',
        error: `找不到任務 ${taskId} 的 Worktree 隔離工作區 (${worktreePath})`
      };
    }

    const mainHead = getGitBranchInfo(cleanRepo);
    const baseBranch = (explicitBaseBranch || task.baseBranch || mainHead.branch || 'main').trim();
    let currentBaseSha = '';
    try {
      currentBaseSha = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', baseBranch], {
        encoding: 'utf8',
        env: customEnv,
        timeout: 5000
      }).trim();
    } catch (e) {
      return {
        success: false,
        merged: false,
        status: 'base_branch_missing',
        error: `找不到來源分支 ${baseBranch}`
      };
    }

    let baseCommit = (explicitBaseCommit || task.baseCommit || '').trim();
    if (!baseCommit) {
      try {
        baseCommit = execFileSync('git', ['-C', worktreePath, 'merge-base', 'HEAD', baseBranch], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 5000
        }).trim();
      } catch (e) {
        baseCommit = currentBaseSha;
      }
    }

    // 1. 檢查主工作區是否有未提交髒狀態；若當前切在 baseBranch 且有非 Harness 暫存之未提交變更則立即阻斷
    const mainStatusRaw = execFileSync('git', ['-C', cleanRepo, 'status', '--porcelain', '-uall'], {
      encoding: 'utf8',
      env: customEnv,
      timeout: 5000
    });
    const realMainDirty = parsePorcelainStatus(mainStatusRaw).filter(entry => !isTransientHarnessPath(entry.path));
    const isMainOnBase = mainHead.branch === baseBranch;
    if (isMainOnBase && realMainDirty.length > 0) {
      const previewList = realMainDirty.slice(0, 5).map(e => e.path).join(', ');
      const suffix = realMainDirty.length > 5 ? ` 等 ${realMainDirty.length} 筆` : '';
      return {
        success: false,
        merged: false,
        status: 'dirty_main_workspace',
        baseBranch,
        dirtyFiles: realMainDirty.map(e => e.path),
        error: `主工作區目前位於 ${baseBranch} 分支且有未提交變更 (${previewList}${suffix})，已阻斷合併以避免覆蓋本地變更。請先提交、暫存或還原上述檔案後再試。`
      };
    }

    // 2. 若 worktree 內有尚未 commit 的變更，先在隔離分支建立 WIP commit 以便 rebase
    const wtStatus = execFileSync('git', ['-C', worktreePath, 'status', '--porcelain'], {
      encoding: 'utf8',
      env: customEnv,
      timeout: 5000
    }).trim();
    const defaultSubject = (task.commitMessage && task.commitMessage.subject)
      ? task.commitMessage.subject.trim()
      : `feat(${String(taskId || 'task').toLowerCase()}): ${task.title || 'Update task'}`;
    const defaultBody = (task.commitMessage && task.commitMessage.body) ? task.commitMessage.body.trim() : '';

    if (wtStatus.length > 0) {
      try {
        execFileSync('git', ['-C', worktreePath, 'add', '-A'], { env: customEnv, timeout: 10000, stdio: 'ignore' });
        const commitArgs = ['-C', worktreePath, 'commit', '-m', defaultSubject];
        if (defaultBody) commitArgs.push('-m', defaultBody);
        execFileSync('git', commitArgs, { encoding: 'utf8', env: customEnv, timeout: 30000 });
      } catch (commitErr) {
        const errOut = [commitErr.stderr, commitErr.stdout, commitErr.message].filter(Boolean).join('\n');
        return {
          success: false,
          merged: false,
          status: 'commit_failed',
          error: `Worktree 暫存變更提交失敗: ${errOut}`
        };
      }
    }

    // 3. 於 worktree 內執行 git rebase <baseBranch>；衝突立即 abort，絕不污染 baseBranch
    try {
      execFileSync('git', ['-C', worktreePath, 'rebase', baseBranch], {
        encoding: 'utf8',
        env: customEnv,
        timeout: 30000
      });
    } catch (rebaseErr) {
      try {
        execFileSync('git', ['-C', worktreePath, 'rebase', '--abort'], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 10000,
          stdio: 'ignore'
        });
      } catch (abortErr) {}
      return {
        success: false,
        merged: false,
        conflict: true,
        status: 'conflict',
        baseBranch,
        branchName,
        error: `Rebase 至 ${baseBranch} 發生衝突，已立即執行 git rebase --abort，${baseBranch} 未受任何污染。`
      };
    }

    // 4. 若 baseBranch 最新 SHA 不等於 baseCommit，強制於 Rebase 後的 worktree 重跑驗證命令 (0 LLM Token)
    const baseMoved = Boolean(baseCommit && currentBaseSha && currentBaseSha !== baseCommit);
    let reVerified = false;
    if (baseMoved && verifyCommand && String(verifyCommand).trim()) {
      try {
        execSync(String(verifyCommand).trim(), {
          cwd: worktreePath,
          env: customEnv,
          encoding: 'utf8',
          timeout: 120000
        });
        reVerified = true;
      } catch (verifyErr) {
        const verifyOut = [verifyErr.stdout, verifyErr.stderr, verifyErr.message].filter(Boolean).join('\n');
        return {
          success: false,
          merged: false,
          status: 'verification_failed',
          baseMoved: true,
          baseBranch,
          baseCommit,
          currentBaseSha,
          exitCode: verifyErr.status || 1,
          output: verifyOut,
          error: `基線分支 ${baseBranch} 已前進，於 Rebase 後之 worktree 重跑驗證 (${verifyCommand}) 失敗，已阻斷合併。`
        };
      }
    }

    // 5. 風險門確認：one-way 高風險任務須顯式確認才可本地 Squash 合併
    const riskDoor = (task && task.riskDoor) || 'two-way';
    if (riskDoor === 'one-way' && !confirmOneWayMerge && mode !== 'squash') {
      return {
        success: false,
        merged: false,
        requiresConfirmation: true,
        status: 'one_way_requires_confirmation',
        branchName,
        baseBranch,
        baseMoved,
        reVerified,
        error: `One-Way 高風險任務須經顯式確認才可本地 Squash 合併至 ${baseBranch}，請傳入 confirmOneWayMerge: true（遠端 Push 與開 PR 請於結案後由交付塢操作）。`
      };
    }

    // 6. Squash Merge：於 worktree 壓縮為單一原子 Commit
    const rebasedHead = execFileSync('git', ['-C', worktreePath, 'rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf8',
      env: customEnv,
      timeout: 5000
    }).trim();

    if (rebasedHead === currentBaseSha) {
      removeTaskWorktree(cleanRepo, taskId, { branchName, worktreePath });
      return {
        success: true,
        merged: true,
        alreadyUpToDate: true,
        status: 'merged',
        strategy: 'squash',
        baseBranch,
        baseCommit,
        mergeCommit: currentBaseSha,
        baseMoved,
        reVerified
      };
    }

    execFileSync('git', ['-C', worktreePath, 'reset', '--soft', currentBaseSha], {
      encoding: 'utf8',
      env: customEnv,
      timeout: 10000
    });

    const stagedChanges = execFileSync('git', ['-C', worktreePath, 'diff', '--cached', '--name-only'], {
      encoding: 'utf8',
      env: customEnv,
      timeout: 5000
    }).trim();

    let squashedSha = currentBaseSha;
    if (stagedChanges.length > 0) {
      const squashArgs = ['-C', worktreePath, 'commit', '-m', defaultSubject];
      if (defaultBody) squashArgs.push('-m', defaultBody);
      execFileSync('git', squashArgs, { encoding: 'utf8', env: customEnv, timeout: 30000 });
      squashedSha = execFileSync('git', ['-C', worktreePath, 'rev-parse', '--verify', 'HEAD'], {
        encoding: 'utf8',
        env: customEnv,
        timeout: 5000
      }).trim();

      // 7. 推進本地 baseBranch：主工作區在同一分支且乾淨時 ff-only；在別的分支或有未提交變更時用 git fetch . HEAD:<baseBranch>
      if (isMainOnBase) {
        execFileSync('git', ['-C', cleanRepo, 'merge', '--ff-only', squashedSha], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 15000
        });
      } else {
        execFileSync('git', ['-C', worktreePath, 'fetch', '.', `HEAD:refs/heads/${baseBranch}`], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 15000
        });
      }
    }

    // 8. 清理 worktree 與暫存分支
    removeTaskWorktree(cleanRepo, taskId, { branchName, worktreePath });

    return {
      success: true,
      merged: true,
      status: 'merged',
      strategy: 'squash',
      baseBranch,
      baseCommit,
      mergeCommit: squashedSha,
      baseMoved,
      reVerified
    };
  });
}

/**
 * 檢查任務基線相對於目標分支的飄移與潛在合併衝突（無副作用）
 * @param {string} repoPath 專案目錄
 * @param {Object} task 任務物件
 * @returns {Object}
 */
function checkTaskBaseDrift(repoPath, task = {}) {
  const cleanRepo = repoPath ? String(repoPath).replace(/\/+$/, '') : '';
  const targetBranchInput = String(task?.targetBranch || task?.baseBranch || '').trim();
  const baseResult = {
    isGitRepo: false,
    targetBranch: targetBranchInput,
    baseCommit: String(task?.baseCommit || '').trim(),
    latestTargetCommit: '',
    aheadCount: 0,
    behindCount: 0,
    hasDrift: false,
    hasConflict: false,
    conflictingFiles: [],
    conflictCheckSupported: true
  };

  if (!cleanRepo || !fs.existsSync(cleanRepo) || !fs.existsSync(path.join(cleanRepo, '.git'))) {
    return baseResult;
  }

  baseResult.isGitRepo = true;
  const headInfo = getGitBranchInfo(cleanRepo);
  const targetBranch = targetBranchInput || headInfo.branch || 'main';
  baseResult.targetBranch = targetBranch;

  let latestTargetCommit = '';
  try {
    latestTargetCommit = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', targetBranch], {
      encoding: 'utf8',
      timeout: 5000
    }).trim();
  } catch (e) {
    return { ...baseResult, error: `無法解析目標分支: ${targetBranch}` };
  }
  baseResult.latestTargetCommit = latestTargetCommit;

  let headOrWorktreeBranch = '';
  if (task?.worktreePath && fs.existsSync(task.worktreePath)) {
    try {
      headOrWorktreeBranch = execFileSync('git', ['-C', task.worktreePath, 'rev-parse', '--verify', 'HEAD'], {
        encoding: 'utf8',
        timeout: 5000
      }).trim();
    } catch (e) {}
  }
  if (!headOrWorktreeBranch && task?.branchName && String(task.branchName).trim() !== targetBranch) {
    try {
      headOrWorktreeBranch = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', String(task.branchName).trim()], {
        encoding: 'utf8',
        timeout: 5000
      }).trim();
    } catch (e) {}
  }

  let baseCommit = String(task?.baseCommit || '').trim();
  if (!baseCommit) {
    if (headOrWorktreeBranch) {
      try {
        baseCommit = execFileSync('git', ['-C', cleanRepo, 'merge-base', headOrWorktreeBranch, targetBranch], {
          encoding: 'utf8',
          timeout: 5000
        }).trim();
      } catch (e) {}
    }
    if (!baseCommit) {
      baseCommit = latestTargetCommit;
    }
  }
  baseResult.baseCommit = baseCommit;

  const compareLeftRef = headOrWorktreeBranch || baseCommit;
  if (compareLeftRef && compareLeftRef !== latestTargetCommit) {
    try {
      const countsRaw = execFileSync('git', ['-C', cleanRepo, 'rev-list', '--left-right', '--count', `${compareLeftRef}...${targetBranch}`], {
        encoding: 'utf8',
        timeout: 5000
      }).trim();
      const parts = countsRaw.split(/\s+/);
      if (parts.length >= 2) {
        baseResult.aheadCount = Number.parseInt(parts[0], 10) || 0;
        baseResult.behindCount = Number.parseInt(parts[1], 10) || 0;
      }
    } catch (e) {
      // 若 baseCommit 失效，保留預設 0 計數
    }
  }

  baseResult.hasDrift = baseResult.behindCount > 0;

  if (baseResult.behindCount > 0 && compareLeftRef && compareLeftRef !== latestTargetCommit) {
    const mergeLeftRef = headOrWorktreeBranch || baseCommit;
    try {
      execFileSync('git', ['-C', cleanRepo, 'merge-tree', '--write-tree', mergeLeftRef, targetBranch], {
        encoding: 'utf8',
        timeout: 10000
      });
      baseResult.hasConflict = false;
      baseResult.conflictingFiles = [];
    } catch (err) {
      const stderr = String(err?.stderr || '');
      const stdout = String(err?.stdout || '');
      if (/unknown option|unrecognized|usage:\s*git merge-tree/i.test(stderr)) {
        baseResult.conflictCheckSupported = false;
        baseResult.hasConflict = false;
        baseResult.conflictingFiles = [];
      } else if (err?.status === 1 || stdout) {
        const filesSet = new Set();
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          if (line.includes('\t')) {
            const filePart = line.split('\t').slice(1).join('\t').trim();
            if (filePart) filesSet.add(filePart);
          } else {
            const conflictMatch = line.match(/^CONFLICT\s+\([^)]+\):.*?\bin\s+(.+)$/);
            if (conflictMatch && conflictMatch[1]) {
              filesSet.add(conflictMatch[1].trim());
            }
          }
        }
        baseResult.hasConflict = filesSet.size > 0 || err?.status === 1;
        baseResult.conflictingFiles = Array.from(filesSet);
      } else {
        baseResult.conflictCheckSupported = false;
      }
    }
  }

  // 若為 worktree 任務且主工作區正位於 targetBranch 且有非暫存未提交變更，提前回報 dirty_main_workspace 讓前端正確提示
  const isWorktreeTask = task?.workspaceMode === 'worktree' || Boolean(task?.worktreePath);
  if (isWorktreeTask && targetBranch) {
    try {
      const mainHead = getGitBranchInfo(cleanRepo);
      if (mainHead.branch === targetBranch) {
        const mainStatusRaw = execFileSync('git', ['-C', cleanRepo, 'status', '--porcelain', '-uall'], {
          encoding: 'utf8',
          timeout: 5000
        });
        const realMainDirty = parsePorcelainStatus(mainStatusRaw).filter(entry => !isTransientHarnessPath(entry.path));
        if (realMainDirty.length > 0) {
          baseResult.dirtyMainWorkspace = true;
          baseResult.dirtyFiles = realMainDirty.map(e => e.path);
          baseResult.status = 'dirty_main_workspace';
        }
      }
    } catch (e) {}
  }

  return baseResult;
}

/**
 * 將功能分支安全合入目標主幹分支（Rebase / Merge / Squash）
 * @param {string} repoPath Git 專案路徑
 * @param {string} sourceBranch 來源功能分支名稱
 * @param {string} targetBranch 目標主幹分支名稱
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function mergeFeatureBranch(repoPath, sourceBranch, targetBranch, options = {}) {
  const {
    strategy = 'merge',
    deleteSourceBranch = false,
    commitMessage = '',
    customEnv = process.env
  } = options || {};

  if (!repoPath || !fs.existsSync(repoPath) || !fs.existsSync(path.join(repoPath, '.git'))) {
    return { success: false, merged: false, status: 'not_git_repo', error: '目標專案非 Git 儲存庫' };
  }

  const cleanRepo = repoPath.replace(/\/+$/, '');
  const src = String(sourceBranch || '').trim();
  const tgt = String(targetBranch || '').trim();

  if (!src || !tgt) {
    return { success: false, merged: false, status: 'invalid_branch', error: '請指定來源分支與目標分支' };
  }
  if (src === tgt) {
    return { success: false, merged: false, status: 'same_branch', error: '來源分支與目標分支相同，無需合併' };
  }

  return withRepoMergeLock(cleanRepo, async () => {
    try {
      execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', `refs/heads/${src}`], {
        encoding: 'utf8',
        env: customEnv,
        timeout: 5000
      });
    } catch (e) {
      try {
        execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', `refs/remotes/origin/${src}`], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 5000
        });
        execFileSync('git', ['-C', cleanRepo, 'branch', '--', src, `origin/${src}`], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 5000
        });
      } catch (_) {
        return { success: false, merged: false, status: 'source_branch_missing', error: `找不到來源分支 ${src}` };
      }
    }

    let targetSha = '';
    try {
      targetSha = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', `refs/heads/${tgt}`], {
        encoding: 'utf8',
        env: customEnv,
        timeout: 5000
      }).trim();
    } catch (e) {
      try {
        execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', `refs/remotes/origin/${tgt}`], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 5000
        });
        execFileSync('git', ['-C', cleanRepo, 'branch', '--', tgt, `origin/${tgt}`], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 5000
        });
        targetSha = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', `refs/heads/${tgt}`], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 5000
        }).trim();
      } catch (_) {
        return { success: false, merged: false, status: 'target_branch_missing', error: `找不到目標分支 ${tgt}` };
      }
    }

    const headInfo = getGitBranchInfo(cleanRepo);
    const originalBranch = headInfo.branch || '';
    const dirtyRaw = execFileSync('git', ['-C', cleanRepo, 'status', '--porcelain', '-uall'], {
      encoding: 'utf8',
      env: customEnv,
      timeout: 5000
    });

    const parsedDirty = parsePorcelainStatus(dirtyRaw);
    const realDirty = parsedDirty.filter(entry => !isTransientHarnessPath(entry.path));
    const transientDirty = parsedDirty.filter(entry => isTransientHarnessPath(entry.path));

    // 若主目錄有非 Harness 暫存檔之未提交變更，立即安全中止避免覆蓋工作區
    if (realDirty.length > 0) {
      const mismatchHint = originalBranch && originalBranch !== tgt
        ? `目前位於 ${originalBranch} 且`
        : '';
      const previewList = realDirty.slice(0, 5).map(e => e.path).join(', ');
      const suffix = realDirty.length > 5 ? ` 等 ${realDirty.length} 筆` : '';
      return {
        success: false,
        merged: false,
        status: 'dirty_main_workspace',
        sourceBranch: src,
        targetBranch: tgt,
        currentBranch: originalBranch,
        dirtyFiles: realDirty.map(e => e.path),
        error: `主目錄${mismatchHint}有未提交變更 (${previewList}${suffix})，已安全中止合併回 ${tgt}。請先提交或清理工作區後再試。`
      };
    }

    let stashedTransient = false;
    const readStashSha = () => {
      try {
        return execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', 'refs/stash'], {
          encoding: 'utf8',
          env: customEnv,
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000
        }).trim();
      } catch (_) {
        return '';
      }
    };

    if (transientDirty.length > 0) {
      const beforeSha = readStashSha();
      const stashPaths = Array.from(new Set(transientDirty.map(e => e.path).filter(Boolean)));
      try {
        execFileSync('git', ['-C', cleanRepo, 'stash', 'push', '-u', '-m', 'td-transient-harness', '--', ...stashPaths], {
          encoding: 'utf8',
          env: customEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000
        });
        const afterSha = readStashSha();
        stashedTransient = Boolean(afterSha && afterSha !== beforeSha);
      } catch (_) {
        // 若暫存失敗，仍依原有狀態檢查確認工作區是否乾淨
      }
    }

    const restoreTransientStash = () => {
      if (!stashedTransient) return;
      stashedTransient = false;
      try {
        execFileSync('git', ['-C', cleanRepo, 'stash', 'pop', '--quiet'], {
          encoding: 'utf8',
          env: customEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000
        });
      } catch (_) {}
    };

    const restoreOriginalBranch = () => {
      if (originalBranch && originalBranch !== tgt) {
        try {
          execFileSync('git', ['-C', cleanRepo, 'checkout', originalBranch], {
            encoding: 'utf8',
            env: customEnv,
            timeout: 10000
          });
        } catch (_) {}
      }
    };

    try {
      // 若來源分支已完全包含於目標分支中，無需再合併
      let isAlreadyAncestor = false;
      try {
        execFileSync('git', ['-C', cleanRepo, 'merge-base', '--is-ancestor', src, tgt], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 5000
        });
        isAlreadyAncestor = true;
      } catch (_) {}

      if (isAlreadyAncestor) {
        clearProjectBranchCache(cleanRepo);
        return {
          success: true,
          merged: true,
          alreadyUpToDate: true,
          status: 'merged',
          strategy,
          sourceBranch: src,
          targetBranch: tgt,
          commitSha: targetSha
        };
      }
      if (strategy === 'rebase') {
        if (originalBranch !== src) {
          execFileSync('git', ['-C', cleanRepo, 'checkout', src], {
            encoding: 'utf8',
            env: customEnv,
            timeout: 10000
          });
        }
        try {
          execFileSync('git', ['-C', cleanRepo, 'rebase', tgt], {
            encoding: 'utf8',
            env: customEnv,
            timeout: 30000
          });
        } catch (rebaseErr) {
          try {
            execFileSync('git', ['-C', cleanRepo, 'rebase', '--abort'], {
              encoding: 'utf8',
              env: customEnv,
              timeout: 10000
            });
          } catch (_) {}
          restoreOriginalBranch();
          return {
            success: false,
            merged: false,
            status: 'conflict',
            strategy: 'rebase',
            sourceBranch: src,
            targetBranch: tgt,
            error: `將 ${src} Rebase 至 ${tgt} 時發生衝突，已安全中止並還原。`
          };
        }

        execFileSync('git', ['-C', cleanRepo, 'checkout', tgt], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 10000
        });
        execFileSync('git', ['-C', cleanRepo, 'merge', '--ff-only', src], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 15000
        });
      } else if (strategy === 'squash') {
        if (originalBranch !== tgt) {
          execFileSync('git', ['-C', cleanRepo, 'checkout', tgt], {
            encoding: 'utf8',
            env: customEnv,
            timeout: 10000
          });
        }
        try {
          execFileSync('git', ['-C', cleanRepo, 'merge', '--squash', src], {
            encoding: 'utf8',
            env: customEnv,
            timeout: 30000
          });
        } catch (squashErr) {
          try {
            execFileSync('git', ['-C', cleanRepo, 'reset', '--hard', targetSha], {
              encoding: 'utf8',
              env: customEnv,
              timeout: 10000
            });
          } catch (_) {}
          restoreOriginalBranch();
          return {
            success: false,
            merged: false,
            status: 'conflict',
            strategy: 'squash',
            sourceBranch: src,
            targetBranch: tgt,
            error: `Squash 合併 ${src} 至 ${tgt} 時發生衝突，已安全中止並還原。`
          };
        }
        const staged = execFileSync('git', ['-C', cleanRepo, 'diff', '--cached', '--name-only'], {
          encoding: 'utf8',
          env: customEnv,
          timeout: 5000
        }).trim();
        if (staged.length > 0) {
          const msg = String(commitMessage || `chore: merge ${src} into ${tgt}`).trim();
          execFileSync('git', ['-C', cleanRepo, 'commit', '-m', msg], {
            encoding: 'utf8',
            env: customEnv,
            timeout: 30000
          });
        }
      } else {
        if (originalBranch !== tgt) {
          execFileSync('git', ['-C', cleanRepo, 'checkout', tgt], {
            encoding: 'utf8',
            env: customEnv,
            timeout: 10000
          });
        }
        const msg = String(commitMessage || `Merge branch '${src}' into ${tgt}`).trim();
        try {
          execFileSync('git', ['-C', cleanRepo, 'merge', '--no-ff', src, '-m', msg], {
            encoding: 'utf8',
            env: customEnv,
            timeout: 30000
          });
        } catch (mergeErr) {
          try {
            execFileSync('git', ['-C', cleanRepo, 'merge', '--abort'], {
              encoding: 'utf8',
              env: customEnv,
              timeout: 10000
            });
          } catch (_) {}
          restoreOriginalBranch();
          return {
            success: false,
            merged: false,
            status: 'conflict',
            strategy: 'merge',
            sourceBranch: src,
            targetBranch: tgt,
            error: `合併 ${src} 至 ${tgt} 時發生衝突，已安全中止合併。`
          };
        }
      }

      const commitSha = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', 'HEAD'], {
        encoding: 'utf8',
        env: customEnv,
        timeout: 5000
      }).trim();

      if (deleteSourceBranch) {
        try {
          execFileSync('git', ['-C', cleanRepo, 'branch', strategy === 'squash' ? '-D' : '-d', src], {
            encoding: 'utf8',
            env: customEnv,
            timeout: 5000
          });
        } catch (_) {}
      }

      clearProjectBranchCache(cleanRepo);
      return {
        success: true,
        merged: true,
        status: 'merged',
        strategy,
        sourceBranch: src,
        targetBranch: tgt,
        commitSha
      };
    } catch (err) {
      restoreOriginalBranch();
      return {
        success: false,
        merged: false,
        status: 'merge_failed',
        sourceBranch: src,
        targetBranch: tgt,
        error: err && err.message ? err.message : '合併分支失敗'
      };
    } finally {
      restoreTransientStash();
    }
  });
}

/**
 * 解析 git status --porcelain 輸出為結構化路徑清單
 * @param {string} rawOutput
 * @returns {Array<{ xy: string, path: string, isUntracked: boolean }>}
 */
function parsePorcelainStatus(rawOutput) {
  if (!rawOutput || typeof rawOutput !== 'string') return [];
  const lines = rawOutput.split(/\r?\n/).filter(line => line.length >= 4);
  return lines.map(line => {
    const xy = line.slice(0, 2);
    let filePath = line.slice(3).trim();
    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ').pop().trim();
    }
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return {
      xy,
      path: filePath.replace(/\\/g, '/'),
      isUntracked: xy === '??'
    };
  }).filter(item => item.path.length > 0);
}

/**
 * 判斷路徑是否為不應阻斷合併的 Harness 執行期暫存檔
 * @param {string} relPath
 * @returns {boolean}
 */
function isTransientHarnessPath(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!norm) return false;
  if (norm === '.github/worklog' || norm.startsWith('.github/worklog/')) return true;
  if (norm === 'agent-status.md' || norm.endsWith('/agent-status.md')) return true;
  if (norm.startsWith('.github/harness/plan/')) {
    const base = path.posix.basename(norm);
    return base.endsWith('-build-plan.md');
  }
  return false;
}

/**
 * 建立非互動式 Git 執行環境，避免 git push 等命令掛起等候終端輸入帳密而超時
 * @param {Object} [customEnv]
 * @returns {Object}
 */
function buildNonInteractiveGitEnv(customEnv) {
  return {
    ...(customEnv || process.env),
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never'
  };
}

module.exports = {
  collectGitDiff,
  discardGitChanges,
  findProjectCommitSkill,
  formatCommitMessageFromSkill,
  formatCommitMessage,
  buildCommitAgentPrompt,
  parseAgentCommitOutput,
  getGitBranchInfo,
  getProjectBranches,
  createProjectBranch,
  clearProjectBranchCache,
  withRepoMergeLock,
  createTaskWorktree,
  removeTaskWorktree,
  mergeTaskWorktree,
  checkTaskBaseDrift,
  mergeFeatureBranch,
  parsePorcelainStatus,
  isTransientHarnessPath,
  buildNonInteractiveGitEnv
};
