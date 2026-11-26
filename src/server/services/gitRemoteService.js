const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const {
  getGitBranchInfo,
  getProjectBranches,
  clearProjectBranchCache,
  withRepoMergeLock,
  buildNonInteractiveGitEnv
} = require('./gitService');
const {
  getAzureDevOpsPatFromKeychain,
  resolveGithubAccountForOwner
} = require('./gitAccountService');

const execFileAsync = promisify(execFile);

/**
 * 將 URL 中的帳密或 PAT 憑證遮罩，支援多行 stdout / stderr / 錯誤訊息
 * @param {*} input
 * @returns {string}
 */
function redactUrlCredentials(input) {
  if (input === null || input === undefined) return '';
  return String(input).replace(/(https?:\/\/)([^@\s/]+)@/gi, '$1***@');
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (e) {
    return String(value || '');
  }
}

function stripGitSuffix(value) {
  return String(value || '').replace(/\.git$/i, '');
}

/**
 * 辨識 Git 遠端平台 (Azure DevOps / GitHub / Unknown) 並遮罩 URL 憑證
 * @param {string} remoteUrl
 * @returns {{ provider: string, org: string, owner: string, project: string, repo: string, webBaseUrl: string, redactedUrl: string }}
 */
function detectRemoteProvider(remoteUrl) {
  const raw = String(remoteUrl || '').trim();
  const redactedUrl = redactUrlCredentials(raw);

  if (!raw) {
    return {
      provider: 'unknown',
      org: '',
      owner: '',
      project: '',
      repo: '',
      webBaseUrl: '',
      redactedUrl
    };
  }

  // Azure DevOps HTTPS: https://[creds@]dev.azure.com/{org}/{project}/_git/{repo}[.git]
  let m = raw.match(/^https?:\/\/(?:[^@/\s]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i);
  if (!m) {
    // Azure DevOps legacy HTTPS: https://[creds@]{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}[.git]
    m = raw.match(/^https?:\/\/(?:[^@/\s]+@)?([^./\s]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i);
  }
  if (!m) {
    // Azure DevOps SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}[.git]
    m = raw.match(/^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
  }
  if (m) {
    const org = safeDecode(m[1]);
    const project = safeDecode(m[2]);
    const repo = safeDecode(stripGitSuffix(m[3]));
    const webBaseUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}`;
    return {
      provider: 'azure-devops',
      org,
      owner: '',
      project,
      repo,
      webBaseUrl,
      redactedUrl
    };
  }

  // GitHub HTTPS or SSH
  let ghMatch = raw.match(/^https?:\/\/(?:[^@/\s]+@)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i);
  if (!ghMatch) {
    ghMatch = raw.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
  }
  if (ghMatch) {
    const owner = safeDecode(ghMatch[1]);
    const repo = safeDecode(stripGitSuffix(ghMatch[2]));
    const webBaseUrl = `https://github.com/${owner}/${repo}`;
    return {
      provider: 'github',
      org: owner,
      owner,
      project: '',
      repo,
      webBaseUrl,
      redactedUrl
    };
  }

  return {
    provider: 'unknown',
    org: '',
    owner: '',
    project: '',
    repo: '',
    webBaseUrl: '',
    redactedUrl
  };
}

/**
 * 產生各平台網頁手動開立 PR 的降級連結
 * @param {Object} providerInfo
 * @param {string} sourceBranch
 * @param {string} targetBranch
 * @returns {string}
 */
function buildFallbackPrUrl(providerInfo, sourceBranch, targetBranch) {
  if (!providerInfo || !providerInfo.webBaseUrl || !sourceBranch || !targetBranch) return '';
  if (providerInfo.provider === 'azure-devops') {
    return `${providerInfo.webBaseUrl}/pullrequestcreate?sourceRef=${encodeURIComponent(sourceBranch)}&targetRef=${encodeURIComponent(targetBranch)}`;
  }
  if (providerInfo.provider === 'github') {
    return `${providerInfo.webBaseUrl}/compare/${encodeURIComponent(targetBranch)}...${encodeURIComponent(sourceBranch)}?expand=1`;
  }
  return '';
}

function buildLocalGitEnv(customEnv) {
  const base = customEnv || process.env;
  return {
    ...process.env,
    ...base,
    PATH: (base && base.PATH) ? base.PATH : (process.env.PATH || '')
  };
}

function isGitWorkingTree(cleanRepo, customEnv) {
  if (!cleanRepo || !fs.existsSync(cleanRepo)) return false;
  try {
    const out = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--is-inside-work-tree'], {
      env: buildLocalGitEnv(customEnv),
      encoding: 'utf8',
      timeout: 5000
    }).trim();
    return out === 'true';
  } catch (e) {
    return false;
  }
}

function readOriginRawUrl(cleanRepo, customEnv) {
  const env = buildLocalGitEnv(customEnv);
  try {
    const url = execFileSync('git', ['-C', cleanRepo, 'remote', 'get-url', 'origin'], {
      env,
      encoding: 'utf8',
      timeout: 5000
    }).trim();
    if (url) return url;
  } catch (e) {}
  try {
    return execFileSync('git', ['-C', cleanRepo, 'config', '--get', 'remote.origin.url'], {
      env,
      encoding: 'utf8',
      timeout: 5000
    }).trim();
  } catch (e) {
    return '';
  }
}

function refExists(cleanRepo, refName, customEnv) {
  try {
    execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--verify', refName], {
      env: buildLocalGitEnv(customEnv),
      encoding: 'utf8',
      timeout: 5000
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 查詢專案與分支的遠端追蹤、Ahead/Behind 與平台辨識狀態
 * @param {string} repoPath
 * @param {string} [branchName]
 * @param {Object} [options]
 */
function getBranchRemoteStatus(repoPath, branchName = '', options = {}) {
  const customEnv = options.customEnv || process.env;
  const cleanRepo = repoPath ? path.resolve(String(repoPath)) : '';

  if (!isGitWorkingTree(cleanRepo, customEnv)) {
    return {
      isGitRepo: false,
      branch: '',
      hasRemote: false,
      hasUpstream: false,
      upstream: '',
      ahead: 0,
      behind: 0,
      provider: 'unknown',
      org: '',
      project: '',
      repo: '',
      remoteUrl: '',
      webBaseUrl: ''
    };
  }

  const branch = String(branchName || getGitBranchInfo(cleanRepo).branch || '').trim();
  const rawUrl = readOriginRawUrl(cleanRepo, customEnv);
  const hasRemote = Boolean(rawUrl);
  const providerInfo = detectRemoteProvider(rawUrl);

  let hasUpstream = false;
  let upstream = '';
  let ahead = 0;
  let behind = 0;

  if (branch) {
    const gitEnv = buildLocalGitEnv(customEnv);
    try {
      const tracked = execFileSync('git', ['-C', cleanRepo, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`], {
        env: gitEnv,
        encoding: 'utf8',
        timeout: 5000
      }).trim();
      if (tracked) {
        upstream = tracked;
        hasUpstream = true;
      }
    } catch (e) {
      if (refExists(cleanRepo, `refs/remotes/origin/${branch}`, customEnv)) {
        upstream = `origin/${branch}`;
        hasUpstream = true;
      }
    }

    const hasLocalBranch = refExists(cleanRepo, `refs/heads/${branch}`, customEnv);
    if (hasUpstream && hasLocalBranch) {
      try {
        const counts = execFileSync('git', ['-C', cleanRepo, 'rev-list', '--left-right', '--count', `${branch}...${upstream}`], {
          env: gitEnv,
          encoding: 'utf8',
          timeout: 5000
        }).trim();
        const [leftRaw = '0', rightRaw = '0'] = counts.split(/\s+/);
        ahead = Number.parseInt(leftRaw, 10) || 0;
        behind = Number.parseInt(rightRaw, 10) || 0;
      } catch (e) {}
    } else if (hasLocalBranch) {
      const branchSummary = getProjectBranches(cleanRepo, [], { refresh: false });
      const defaultBranch = branchSummary.defaultBranch || 'main';
      let baseRef = '';
      if (defaultBranch && defaultBranch !== branch) {
        if (refExists(cleanRepo, `refs/remotes/origin/${defaultBranch}`, customEnv)) {
          baseRef = `origin/${defaultBranch}`;
        } else if (refExists(cleanRepo, `refs/heads/${defaultBranch}`, customEnv)) {
          baseRef = defaultBranch;
        }
      }
      try {
        const rangeArg = baseRef ? `${baseRef}..${branch}` : branch;
        const countOut = execFileSync('git', ['-C', cleanRepo, 'rev-list', '--count', rangeArg], {
          env: gitEnv,
          encoding: 'utf8',
          timeout: 5000
        }).trim();
        ahead = Number.parseInt(countOut, 10) || 0;
      } catch (e) {}
    }
  }

  return {
    isGitRepo: true,
    branch,
    hasRemote,
    hasUpstream,
    upstream,
    ahead,
    behind,
    provider: providerInfo.provider,
    org: providerInfo.org,
    project: providerInfo.project,
    repo: providerInfo.repo,
    remoteUrl: providerInfo.redactedUrl,
    webBaseUrl: providerInfo.webBaseUrl
  };
}

/**
 * 依據遠端 URL 建立非互動式 Git 執行環境與臨時認證參數（不寫入 .git/config）
 * @param {string} rawUrl
 * @param {Object} [customEnv]
 * @returns {{ env: Object, authArgs: string[], providerInfo: Object }}
 */
function buildRemoteAuthGitContext(rawUrl, customEnv) {
  const providerInfo = detectRemoteProvider(rawUrl);
  const env = buildNonInteractiveGitEnv(customEnv);
  const authArgs = [];

  if (providerInfo.provider === 'github' && /^https?:\/\//i.test(rawUrl) && !extractPatFromRemoteUrl(rawUrl)) {
    const ghToken = resolveGitHubToken(providerInfo.owner, customEnv);
    if (ghToken) {
      env.TD_GH_TOKEN = ghToken;
      authArgs.push(
        '-c', 'credential.helper=',
        '-c', 'credential.helper=!f() { echo username=x-access-token; echo password=$TD_GH_TOKEN; }; f'
      );
    }
  } else if (providerInfo.provider === 'azure-devops' && /^https?:\/\//i.test(rawUrl) && !extractPatFromRemoteUrl(rawUrl)) {
    const azPat = getAzureDevOpsPatFromKeychain(providerInfo.org) || (customEnv && (customEnv.AZURE_DEVOPS_PAT || customEnv.AZDO_PAT)) || '';
    if (azPat) {
      env.TD_AZDO_PAT = azPat;
      authArgs.push(
        '-c', 'credential.helper=',
        '-c', 'credential.helper=!f() { echo username=pat; echo password=$TD_AZDO_PAT; }; f'
      );
    }
  }

  return { env, authArgs, providerInfo };
}

/**
 * 從 Git URL 推導安全的預設資料夾名稱
 * @param {string} repoUrl
 * @returns {string}
 */
function deriveFolderNameFromRepoUrl(repoUrl) {
  const raw = String(repoUrl || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!raw) return '';
  const seg = raw.split(/[/:]/).filter(Boolean).pop() || '';
  return stripGitSuffix(safeDecode(seg)).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '');
}

/**
 * 推送指定本地分支至 origin 遠端並設定 upstream
 * @param {string} repoPath
 * @param {string} branchName
 * @param {Object} [options]
 */
async function pushBranch(repoPath, branchName, options = {}) {
  const customEnv = options.customEnv || process.env;
  const cleanRepo = repoPath ? path.resolve(String(repoPath)) : '';
  const branch = String(branchName || '').trim();

  if (!isGitWorkingTree(cleanRepo, customEnv)) {
    return {
      success: false,
      branch,
      error: '目標路徑非 Git 儲存庫',
      stdout: '',
      stderr: ''
    };
  }
  if (!branch) {
    return {
      success: false,
      branch: '',
      error: '缺少要推送的分支名稱',
      stdout: '',
      stderr: ''
    };
  }

  return withRepoMergeLock(cleanRepo, async () => {
    if (!refExists(cleanRepo, `refs/heads/${branch}`, customEnv)) {
      return {
        success: false,
        branch,
        error: `找不到本地分支 ${branch}`,
        stdout: '',
        stderr: ''
      };
    }

    try {
      const rawUrl = readOriginRawUrl(cleanRepo, customEnv);
      const { env: pushEnv, authArgs } = buildRemoteAuthGitContext(rawUrl, customEnv);
      const pushArgs = ['-C', cleanRepo, ...authArgs, 'push', '-u', 'origin', branch];

      const { stdout = '', stderr = '' } = await execFileAsync(
        'git',
        pushArgs,
        {
          env: pushEnv,
          timeout: 60000
        }
      );
      clearProjectBranchCache(cleanRepo);
      const redactedOutput = redactUrlCredentials([stdout, stderr].filter(Boolean).join('\n').trim());
      return {
        success: true,
        branch,
        output: redactedOutput,
        remoteStatus: getBranchRemoteStatus(cleanRepo, branch, { customEnv })
      };
    } catch (err) {
      return {
        success: false,
        branch,
        error: redactUrlCredentials(err && err.message ? err.message : 'git push 失敗'),
        stdout: redactUrlCredentials(err && err.stdout ? err.stdout : ''),
        stderr: redactUrlCredentials(err && err.stderr ? err.stderr : '')
      };
    }
  });
}

/**
 * 將遠端 Git 儲存庫 Clone 至指定父目錄（自動套用 GitHub gh 多帳號與 Azure Keychain PAT，零明文落地）
 * @param {Object} options
 */
async function cloneRepository(options = {}) {
  const {
    repoUrl: rawRepoUrl,
    parentDir: rawParentDir,
    folderName: rawFolderName,
    branch: rawBranch = '',
    customEnv = process.env
  } = options;

  const repoUrl = String(rawRepoUrl || '').trim();
  const branch = String(rawBranch || '').trim();

  if (!repoUrl) {
    return { success: false, error: '請輸入 Git Repository URL' };
  }
  if (repoUrl.startsWith('-')) {
    return { success: false, error: '無效的 Git Repository URL 格式' };
  }
  if (branch && branch.startsWith('-')) {
    return { success: false, error: '無效的分支名稱' };
  }

  let parentDir = String(rawParentDir || '').trim() || path.join(os.homedir(), 'projects');
  if (parentDir.startsWith('~')) {
    parentDir = path.join(os.homedir(), parentDir.slice(1));
  }
  parentDir = path.resolve(parentDir);

  const folderName = String(rawFolderName || '').trim() || deriveFolderNameFromRepoUrl(repoUrl);
  if (!folderName || folderName.includes('/') || folderName.includes('\\') || folderName === '.' || folderName === '..') {
    return { success: false, error: '無效的專案資料夾名稱（不可包含路徑分隔符號或 ..）' };
  }

  const targetPath = path.join(parentDir, folderName);
  if (fs.existsSync(targetPath)) {
    return {
      success: false,
      targetPath,
      error: `目標資料夾已存在：${targetPath}，請更換資料夾名稱或改用「選擇本機資料夾」加入。`
    };
  }

  try {
    fs.mkdirSync(parentDir, { recursive: true });
  } catch (mkErr) {
    return {
      success: false,
      error: `無法建立目標父目錄 ${parentDir}：${mkErr.message}`
    };
  }

  const { env: cloneEnv, authArgs, providerInfo } = buildRemoteAuthGitContext(repoUrl, customEnv);
  const cloneArgs = [...authArgs, 'clone'];
  if (branch) {
    cloneArgs.push('--branch', branch);
  }
  cloneArgs.push('--', repoUrl, targetPath);

  try {
    const { stdout = '', stderr = '' } = await execFileAsync('git', cloneArgs, {
      env: cloneEnv,
      timeout: 180000
    });
    const output = redactUrlCredentials([stdout, stderr].filter(Boolean).join('\n').trim());
    return {
      success: true,
      targetPath,
      folderName,
      provider: providerInfo.provider,
      remoteUrl: providerInfo.redactedUrl,
      output
    };
  } catch (err) {
    // 若 clone 失敗殘留空目錄則安全清理
    try {
      if (fs.existsSync(targetPath) && fs.readdirSync(targetPath).length === 0) {
        fs.rmdirSync(targetPath);
      }
    } catch (_) {}
    const errMsg = [err && err.stderr, err && err.message].filter(Boolean).join('\n').trim() || 'git clone 執行失敗';
    return {
      success: false,
      targetPath,
      provider: providerInfo.provider,
      error: redactUrlCredentials(errMsg)
    };
  }
}

/**
 * 執行 Fetch 或 Pull 同步遠端最新進度（支援非當前 checkout 分支安全快進）
 * @param {string} repoPath
 * @param {string} branchName
 * @param {Object} [options]
 */
async function fetchAndPullBranch(repoPath, branchName = '', options = {}) {
  const customEnv = options.customEnv || process.env;
  const mode = options.mode === 'fetch' ? 'fetch' : 'pull';
  const rebase = options.rebase === true;
  const cleanRepo = repoPath ? path.resolve(String(repoPath)) : '';

  if (!isGitWorkingTree(cleanRepo, customEnv)) {
    return { success: false, branch: '', error: '目標路徑非 Git 儲存庫' };
  }

  const currentInfo = getGitBranchInfo(cleanRepo);
  const branch = String(branchName || currentInfo.branch || '').trim();
  if (!branch) {
    return { success: false, branch: '', error: '找不到要同步的分支名稱' };
  }

  return withRepoMergeLock(cleanRepo, async () => {
    const rawUrl = readOriginRawUrl(cleanRepo, customEnv);
    if (!rawUrl) {
      return { success: false, branch, error: '此專案尚未設定 origin 遠端儲存庫' };
    }

    const { env: gitEnv, authArgs } = buildRemoteAuthGitContext(rawUrl, customEnv);
    try {
      // 1. 先執行 fetch origin --prune 取得遠端最新狀態
      const fetchRes = await execFileAsync('git', ['-C', cleanRepo, ...authArgs, 'fetch', 'origin', '--prune'], {
        env: gitEnv,
        timeout: 60000
      });

      if (mode === 'fetch') {
        clearProjectBranchCache(cleanRepo);
        return {
          success: true,
          mode: 'fetch',
          branch,
          output: redactUrlCredentials([fetchRes.stdout, fetchRes.stderr].filter(Boolean).join('\n').trim()),
          remoteStatus: getBranchRemoteStatus(cleanRepo, branch, { customEnv })
        };
      }

      // 2. Pull 同步指定分支
      const hasRemoteBranch = refExists(cleanRepo, `refs/remotes/origin/${branch}`, customEnv);
      if (!hasRemoteBranch) {
        clearProjectBranchCache(cleanRepo);
        return {
          success: true,
          mode: 'pull',
          branch,
          alreadyUpToDate: true,
          output: `遠端尚無 origin/${branch}，已完成 fetch。`,
          remoteStatus: getBranchRemoteStatus(cleanRepo, branch, { customEnv })
        };
      }

      const isCheckedOut = currentInfo.branch === branch;
      let pullStdout = '';
      let pullStderr = '';

      if (isCheckedOut) {
        const pullArgs = ['-C', cleanRepo, ...authArgs, 'pull', rebase ? '--rebase' : '--ff-only', 'origin', branch];
        const pullRes = await execFileAsync('git', pullArgs, { env: gitEnv, timeout: 60000 });
        pullStdout = pullRes.stdout || '';
        pullStderr = pullRes.stderr || '';
      } else {
        // 非當前 checkout 分支：以無損快進方式同步 refs/heads/<branch>，不干擾目前工作區
        const ffRes = await execFileAsync('git', ['-C', cleanRepo, ...authArgs, 'fetch', 'origin', `${branch}:${branch}`], {
          env: gitEnv,
          timeout: 60000
        });
        pullStdout = ffRes.stdout || '';
        pullStderr = ffRes.stderr || '';
      }

      clearProjectBranchCache(cleanRepo);
      const output = redactUrlCredentials([pullStdout, pullStderr].filter(Boolean).join('\n').trim());
      return {
        success: true,
        mode: 'pull',
        rebase,
        branch,
        output: output || `分支 ${branch} 已同步至遠端最新進度`,
        remoteStatus: getBranchRemoteStatus(cleanRepo, branch, { customEnv })
      };
    } catch (err) {
      clearProjectBranchCache(cleanRepo);
      const errText = redactUrlCredentials([err && err.stderr, err && err.message].filter(Boolean).join('\n').trim() || 'git pull 失敗');
      const canRetryWithRebase = !rebase && /non-fast-forward|Not possible to fast-forward|divergent branches/i.test(errText);
      return {
        success: false,
        mode,
        branch,
        canRetryWithRebase,
        error: errText,
        remoteStatus: getBranchRemoteStatus(cleanRepo, branch, { customEnv })
      };
    }
  });
}

function resolveGitHubToken(owner, customEnv) {
  const env = customEnv || process.env;
  if (env.GH_TOKEN && String(env.GH_TOKEN).trim()) return String(env.GH_TOKEN).trim();
  if (env.GITHUB_TOKEN && String(env.GITHUB_TOKEN).trim()) return String(env.GITHUB_TOKEN).trim();

  const ghEnv = buildNonInteractiveGitEnv(env);
  if (owner) {
    try {
      const ownerToken = execFileSync('gh', ['auth', 'token', '--user', owner], {
        env: ghEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      }).trim();
      if (ownerToken) return ownerToken;
    } catch (e) {}

    // 若 owner 為組織名稱（例如 farfarfar-away），透過所屬 Org 自動對應已登入帳號
    const mappedUser = resolveGithubAccountForOwner(owner, env);
    if (mappedUser) {
      try {
        const mappedToken = execFileSync('gh', ['auth', 'token', '--user', mappedUser], {
          env: ghEnv,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5000
        }).trim();
        if (mappedToken) return mappedToken;
      } catch (e) {}
    }
  }

  try {
    const activeToken = execFileSync('gh', ['auth', 'token'], {
      env: ghEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    }).trim();
    if (activeToken) return activeToken;
  } catch (e) {}

  return '';
}

function extractPatFromRemoteUrl(rawUrl) {
  const m = String(rawUrl || '').match(/^https?:\/\/([^@/\s]+)@/i);
  if (!m) return '';
  const creds = safeDecode(m[1]);
  const colonIdx = creds.indexOf(':');
  if (colonIdx !== -1) {
    return creds.slice(colonIdx + 1).trim();
  }
  return creds.trim();
}

/**
 * 自動或降級開立 Pull Request (支援 Azure DevOps REST API 與 GitHub CLI)
 * @param {string} repoPath
 * @param {Object} [options]
 */
async function createPullRequest(repoPath, options = {}) {
  const {
    sourceBranch: rawSource,
    targetBranch: rawTarget,
    title,
    description = '',
    draft = false,
    autoPush = false,
    customEnv = process.env,
    fetchImpl = globalThis.fetch
  } = options;

  const cleanRepo = repoPath ? path.resolve(String(repoPath)) : '';
  const sourceBranch = String(rawSource || '').trim();
  const targetBranch = String(rawTarget || '').trim();

  if (!isGitWorkingTree(cleanRepo, customEnv)) {
    return {
      success: false,
      degraded: false,
      provider: 'unknown',
      sourceBranch,
      targetBranch,
      fallbackCreateUrl: '',
      error: '目標路徑非 Git 儲存庫'
    };
  }
  if (!sourceBranch || !targetBranch) {
    return {
      success: false,
      degraded: false,
      provider: 'unknown',
      sourceBranch,
      targetBranch,
      fallbackCreateUrl: '',
      error: '缺少來源分支或目標分支'
    };
  }
  if (sourceBranch === targetBranch) {
    return {
      success: false,
      degraded: false,
      provider: 'unknown',
      sourceBranch,
      targetBranch,
      fallbackCreateUrl: '',
      error: '來源分支與目標分支不可相同'
    };
  }

  const rawUrl = readOriginRawUrl(cleanRepo, customEnv);
  const providerInfo = detectRemoteProvider(rawUrl);
  const fallbackCreateUrl = buildFallbackPrUrl(providerInfo, sourceBranch, targetBranch);
  const effectiveTitle = String(title || '').trim() || `PR: ${sourceBranch} → ${targetBranch}`;

  if (autoPush === true) {
    const pushRes = await pushBranch(cleanRepo, sourceBranch, { customEnv });
    if (!pushRes.success) {
      return {
        success: false,
        degraded: false,
        provider: providerInfo.provider,
        sourceBranch,
        targetBranch,
        fallbackCreateUrl,
        error: pushRes.error
      };
    }
  }

  if (providerInfo.provider === 'azure-devops') {
    const pat = extractPatFromRemoteUrl(rawUrl) || getAzureDevOpsPatFromKeychain(providerInfo.org) || customEnv.AZURE_DEVOPS_PAT || customEnv.AZDO_PAT || '';
    if (!pat) {
      return {
        success: false,
        degraded: true,
        provider: 'azure-devops',
        sourceBranch,
        targetBranch,
        fallbackCreateUrl,
        error: '未偵測到 Azure DevOps PAT，已降級為網頁開立 PR。'
      };
    }

    const apiUrl = `https://dev.azure.com/${encodeURIComponent(providerInfo.org)}/${encodeURIComponent(providerInfo.project)}/_apis/git/repositories/${encodeURIComponent(providerInfo.repo)}/pullrequests?api-version=7.1`;
    try {
      const response = await fetchImpl(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(':' + pat).toString('base64')
        },
        body: JSON.stringify({
          sourceRefName: `refs/heads/${sourceBranch}`,
          targetRefName: `refs/heads/${targetBranch}`,
          title: effectiveTitle,
          description: String(description || ''),
          isDraft: Boolean(draft)
        })
      });

      if (response && response.ok) {
        const data = await response.json();
        const prId = data.pullRequestId;
        const prUrl = `${providerInfo.webBaseUrl}/pullrequest/${prId}`;
        return {
          success: true,
          degraded: false,
          provider: 'azure-devops',
          prId,
          prUrl,
          sourceBranch,
          targetBranch,
          title: effectiveTitle
        };
      }

      const statusCode = response ? response.status : 0;
      let errMsg = `Azure DevOps PR API 回傳錯誤 (${statusCode})`;
      try {
        const errText = await response.text();
        if (errText) {
          try {
            const parsed = JSON.parse(errText);
            if (parsed && parsed.message) errMsg = parsed.message;
          } catch (_) {
            errMsg = errText;
          }
        }
      } catch (_) {}

      return {
        success: false,
        degraded: true,
        provider: 'azure-devops',
        statusCode,
        sourceBranch,
        targetBranch,
        fallbackCreateUrl,
        error: redactUrlCredentials(errMsg)
      };
    } catch (err) {
      return {
        success: false,
        degraded: true,
        provider: 'azure-devops',
        statusCode: 0,
        sourceBranch,
        targetBranch,
        fallbackCreateUrl,
        error: redactUrlCredentials(err && err.message ? err.message : 'Azure DevOps PR API 連線失敗')
      };
    }
  }

  if (providerInfo.provider === 'github') {
    const args = [
      'pr',
      'create',
      '--base', targetBranch,
      '--head', sourceBranch,
      '--title', effectiveTitle,
      '--body', String(description || '')
    ];
    if (draft) args.push('--draft');

    try {
      const ghEnv = buildNonInteractiveGitEnv(customEnv);
      if (!ghEnv.GH_TOKEN) {
        const ghToken = resolveGitHubToken(providerInfo.owner, customEnv);
        if (ghToken) ghEnv.GH_TOKEN = ghToken;
      }
      const { stdout = '' } = await execFileAsync('gh', args, {
        cwd: cleanRepo,
        env: ghEnv,
        timeout: 30000
      });
      const urlMatch = stdout.match(/https:\/\/github\.com\/\S+/i);
      const prUrl = urlMatch ? urlMatch[0].trim() : stdout.trim();
      return {
        success: true,
        degraded: false,
        provider: 'github',
        prUrl,
        sourceBranch,
        targetBranch,
        title: effectiveTitle
      };
    } catch (err) {
      const errMsg = [err && err.message, err && err.stderr].filter(Boolean).join('\n') || 'gh pr create 執行失敗';
      return {
        success: false,
        degraded: true,
        provider: 'github',
        sourceBranch,
        targetBranch,
        fallbackCreateUrl,
        error: redactUrlCredentials(errMsg)
      };
    }
  }

  return {
    success: false,
    degraded: true,
    provider: 'unknown',
    sourceBranch,
    targetBranch,
    fallbackCreateUrl: '',
    error: '目前遠端平台不支援自動開立 PR。'
  };
}

module.exports = {
  redactUrlCredentials,
  detectRemoteProvider,
  deriveFolderNameFromRepoUrl,
  buildFallbackPrUrl,
  getBranchRemoteStatus,
  pushBranch,
  cloneRepository,
  fetchAndPullBranch,
  createPullRequest
};
