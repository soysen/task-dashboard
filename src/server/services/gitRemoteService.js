const fs = require('fs');
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
      const { stdout = '', stderr = '' } = await execFileAsync(
        'git',
        ['-C', cleanRepo, 'push', '-u', 'origin', branch],
        {
          env: buildNonInteractiveGitEnv(customEnv),
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
    const pat = extractPatFromRemoteUrl(rawUrl) || customEnv.AZURE_DEVOPS_PAT || customEnv.AZDO_PAT || '';
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
      const { stdout = '' } = await execFileAsync('gh', args, {
        cwd: cleanRepo,
        env: buildNonInteractiveGitEnv(customEnv),
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
  buildFallbackPrUrl,
  getBranchRemoteStatus,
  pushBranch,
  createPullRequest
};
