const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { buildNonInteractiveGitEnv } = require('./gitService');

const AZDO_KEYCHAIN_PREFIX = 'TaskDashboard.AzureDevOps.';
const ORG_CACHE_TTL_MS = 10 * 60 * 1000;

let activeDeviceLogin = null;
const githubOrgsCache = new Map(); // username -> { ts, orgs: string[] }

function buildToolEnv(customEnv) {
  const base = customEnv || process.env;
  return {
    ...process.env,
    ...base,
    PATH: (base && base.PATH) ? base.PATH : (process.env.PATH || '')
  };
}

/**
 * 解析 `gh auth status` 輸出，提取所有已登入帳號資訊（純函式，便於測試）
 * @param {string} rawText
 * @returns {Array<{ username: string, host: string, active: boolean, protocol: string, scopes: string[] }>}
 */
function parseGhAuthStatusOutput(rawText) {
  const text = String(rawText || '');
  if (!text.trim()) return [];

  const accounts = [];
  let currentHost = 'github.com';
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // 偵測 host 標題行（例如 github.com）
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(line) && !line.includes(' ')) {
      currentHost = line;
      continue;
    }

    const loginMatch = line.match(/Logged in to\s+(\S+)\s+account\s+([^\s(]+)/i);
    if (loginMatch) {
      if (current) accounts.push(current);
      currentHost = loginMatch[1] || currentHost;
      current = {
        username: loginMatch[2],
        host: currentHost,
        active: false,
        protocol: 'https',
        scopes: []
      };
      continue;
    }

    if (!current) continue;

    const activeMatch = line.match(/Active account:\s*(true|false)/i);
    if (activeMatch) {
      current.active = activeMatch[1].toLowerCase() === 'true';
      continue;
    }

    const protoMatch = line.match(/Git operations protocol:\s*(\S+)/i);
    if (protoMatch) {
      current.protocol = protoMatch[1].toLowerCase();
      continue;
    }

    const scopesMatch = line.match(/Token scopes:\s*(.+)$/i);
    if (scopesMatch) {
      current.scopes = scopesMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
  }

  if (current) accounts.push(current);
  return accounts;
}

function getGhAuthAccounts(customEnv) {
  const env = buildNonInteractiveGitEnv(buildToolEnv(customEnv));
  let output = '';
  try {
    output = execFileSync('gh', ['auth', 'status'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000
    });
  } catch (err) {
    // gh auth status 在部分版本/未登入時會輸出到 stderr 並回傳非 0
    output = [err && err.stdout, err && err.stderr].filter(Boolean).join('\n');
  }
  return parseGhAuthStatusOutput(output);
}

function readForkDetectedGithubAccounts(homeDir = os.homedir()) {
  try {
    const forkAccountsPath = path.join(homeDir, 'Library/Application Support/com.DanPristupov.Fork/accounts.json');
    if (!fs.existsSync(forkAccountsPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(forkAccountsPath, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && String(item.serviceType || '').toLowerCase() === 'github' && item.username)
      .map(item => String(item.username).trim())
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function getAzurePatKeychainService(org) {
  const cleanOrg = String(org || '').trim();
  if (!cleanOrg) return '';
  return `${AZDO_KEYCHAIN_PREFIX}${cleanOrg}`;
}

function hasAzureDevOpsPatInKeychain(org) {
  if (process.platform !== 'darwin') return false;
  const cleanOrg = String(org || '').trim();
  const service = getAzurePatKeychainService(cleanOrg);
  if (!service) return false;
  try {
    execFileSync('/usr/bin/security', ['find-generic-password', '-a', cleanOrg, '-s', service], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 3000
    });
    return true;
  } catch (e) {
    return false;
  }
}

function getAzureDevOpsPatFromKeychain(org) {
  if (process.platform !== 'darwin') return '';
  const cleanOrg = String(org || '').trim();
  const service = getAzurePatKeychainService(cleanOrg);
  if (!service) return '';
  try {
    return execFileSync('/usr/bin/security', ['find-generic-password', '-a', cleanOrg, '-s', service, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    }).trim();
  } catch (e) {
    return '';
  }
}

function saveAzureDevOpsPatToKeychain(org, pat) {
  if (process.platform !== 'darwin') {
    return { success: false, error: '目前僅支援在 macOS Keychain 安全儲存 Azure DevOps PAT。' };
  }
  const cleanOrg = String(org || '').trim();
  const cleanPat = String(pat || '').trim();
  if (!cleanOrg || !cleanPat) {
    return { success: false, error: '請提供組織名稱與 PAT。' };
  }
  const service = getAzurePatKeychainService(cleanOrg);
  try {
    execFileSync('/usr/bin/security', ['add-generic-password', '-U', '-a', cleanOrg, '-s', service, '-w', cleanPat], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000
    });
    return { success: true, org: cleanOrg };
  } catch (err) {
    return { success: false, error: (err && err.message) || '寫入 macOS Keychain 失敗' };
  }
}

async function verifyAndSaveAzureDevOpsPat(org, pat, options = {}) {
  const cleanOrg = String(org || '').trim();
  const cleanPat = String(pat || '').trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!cleanOrg || !cleanPat) {
    return { success: false, error: '請輸入 Azure DevOps 組織名稱與 PAT' };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(cleanOrg)) {
    return { success: false, error: '組織名稱格式不正確（僅允許英數字與 . _ -）' };
  }

  const verifyUrl = `https://dev.azure.com/${encodeURIComponent(cleanOrg)}/_apis/projects?$top=1&api-version=7.1`;
  try {
    const res = await fetchImpl(verifyUrl, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(':' + cleanPat).toString('base64')
      }
    });
    if (!res || !res.ok) {
      const code = res ? res.status : 0;
      return {
        success: false,
        statusCode: code,
        error: code === 401 || code === 403
          ? `Azure DevOps 認證失敗 (HTTP ${code})，請確認 PAT 未過期且具備 Code / Project 讀取權限。`
          : `無法連線至組織 ${cleanOrg} (HTTP ${code})`
      };
    }
  } catch (err) {
    return {
      success: false,
      error: `Azure DevOps 連線驗證失敗：${(err && err.message) || '網路錯誤'}`
    };
  }

  const saveRes = options.skipKeychain === true
    ? { success: true, org: cleanOrg }
    : saveAzureDevOpsPatToKeychain(cleanOrg, cleanPat);
  if (!saveRes.success) return saveRes;

  return {
    success: true,
    org: cleanOrg,
    storedInKeychain: options.skipKeychain !== true
  };
}

function getGithubUserOrgs(username, customEnv) {
  const cleanUser = String(username || '').trim();
  if (!cleanUser) return [];
  const cached = githubOrgsCache.get(cleanUser);
  if (cached && Date.now() - cached.ts < ORG_CACHE_TTL_MS) {
    return cached.orgs;
  }
  const env = buildNonInteractiveGitEnv(buildToolEnv(customEnv));
  try {
    const token = execFileSync('gh', ['auth', 'token', '--user', cleanUser], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    }).trim();
    if (!token) return [];
    const out = execFileSync('gh', ['api', 'user/orgs', '--jq', '.[].login'], {
      env: { ...env, GH_TOKEN: token },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000
    });
    const orgs = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    githubOrgsCache.set(cleanUser, { ts: Date.now(), orgs });
    return orgs;
  } catch (e) {
    githubOrgsCache.set(cleanUser, { ts: Date.now(), orgs: [] });
    return [];
  }
}

/**
 * 依據 GitHub repo owner (個人或 Org) 解析對應的已登入 gh 帳號名稱
 * @param {string} owner
 * @param {Object} [customEnv]
 * @returns {string}
 */
function resolveGithubAccountForOwner(owner, customEnv) {
  const targetOwner = String(owner || '').trim().toLowerCase();
  if (!targetOwner) return '';
  const accounts = getGhAuthAccounts(customEnv);
  if (accounts.length === 0) return '';

  const exact = accounts.find(a => a.username.toLowerCase() === targetOwner);
  if (exact) return exact.username;

  for (const acc of accounts) {
    const orgs = getGithubUserOrgs(acc.username, customEnv);
    if (orgs.some(o => o.toLowerCase() === targetOwner)) {
      return acc.username;
    }
  }
  return '';
}

function readGlobalGitIdentity(customEnv) {
  const env = buildToolEnv(customEnv);
  const readKey = (key) => {
    try {
      return execFileSync('git', ['config', '--global', '--get', key], {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000
      }).trim();
    } catch (e) {
      return '';
    }
  };
  return {
    name: readKey('user.name'),
    email: readKey('user.email'),
    credentialHelper: readKey('credential.helper') || (process.platform === 'darwin' ? 'osxkeychain' : '')
  };
}

function checkToolsAvailability(customEnv, homeDir = os.homedir()) {
  const env = buildToolEnv(customEnv);
  const hasBin = (bin) => {
    try {
      execFileSync(bin, ['--version'], { env, stdio: ['ignore', 'ignore', 'ignore'], timeout: 3000 });
      return true;
    } catch (e) {
      return false;
    }
  };
  let hasSshKey = false;
  try {
    const sshDir = path.join(homeDir, '.ssh');
    if (fs.existsSync(sshDir)) {
      const files = fs.readdirSync(sshDir);
      hasSshKey = files.some(f => /^id_.*\.(pub)$|^id_(rsa|ed25519|ecdsa)$/i.test(f));
    }
  } catch (e) {}
  return {
    git: hasBin('git'),
    gh: hasBin('gh'),
    hasSshKey
  };
}

function readRepoRemoteRawUrl(repoPath, customEnv) {
  if (!repoPath || !fs.existsSync(repoPath)) return '';
  try {
    return execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], {
      env: buildToolEnv(customEnv),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    }).trim();
  } catch (e) {
    return '';
  }
}

function parseAzureOrgAndHasPat(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return null;
  let m = raw.match(/^https?:\/\/(?:([^@/\s]+)@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/i);
  if (!m) {
    m = raw.match(/^https?:\/\/(?:([^@/\s]+)@)?([^./\s]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/i);
  }
  if (!m) return null;
  const creds = String(m[1] || '');
  const hasRepoPat = creds.includes(':') ? Boolean(creds.slice(creds.indexOf(':') + 1).trim()) : Boolean(creds.trim());
  return {
    org: decodeURIComponent(m[2]),
    hasRepoPat
  };
}

/**
 * 盤點本機所有 Git 帳號、工具狀態與 Azure DevOps 組織連線（嚴格零明文憑證）
 * @param {Array} projects
 * @param {Object} [options]
 */
function listGitAccounts(projects = [], options = {}) {
  const customEnv = options.customEnv || process.env;
  const homeDir = options.homeDir || os.homedir();
  const extraAzdoOrgs = Array.isArray(options.extraAzdoOrgs) ? options.extraAzdoOrgs : [];

  const globalIdentity = readGlobalGitIdentity(customEnv);
  const tools = checkToolsAvailability(customEnv, homeDir);
  const ghAccounts = tools.gh ? getGhAuthAccounts(customEnv) : [];
  const forkGithubUsers = readForkDetectedGithubAccounts(homeDir);
  const loggedInSet = new Set(ghAccounts.map(a => a.username.toLowerCase()));
  const forkMissingAccounts = forkGithubUsers.filter(u => !loggedInSet.has(u.toLowerCase()));

  const azdoMap = new Map();
  const ensureAzdoOrg = (orgName) => {
    const cleanOrg = String(orgName || '').trim();
    if (!cleanOrg) return null;
    if (!azdoMap.has(cleanOrg)) {
      const hasKeychainPat = hasAzureDevOpsPatInKeychain(cleanOrg);
      const hasEnvPat = Boolean(customEnv.AZURE_DEVOPS_PAT || customEnv.AZDO_PAT);
      azdoMap.set(cleanOrg, {
        org: cleanOrg,
        projectCount: 0,
        projectIds: [],
        hasRepoPat: false,
        hasKeychainPat,
        hasEnvPat,
        ready: hasKeychainPat || hasEnvPat
      });
    }
    return azdoMap.get(cleanOrg);
  };

  for (const orgName of extraAzdoOrgs) {
    ensureAzdoOrg(orgName);
  }

  for (const proj of (Array.isArray(projects) ? projects : [])) {
    if (!proj || !proj.path) continue;
    const rawUrl = readRepoRemoteRawUrl(proj.path, customEnv);
    const parsed = parseAzureOrgAndHasPat(rawUrl);
    if (!parsed) continue;
    const entry = ensureAzdoOrg(parsed.org);
    if (!entry) continue;
    entry.projectCount += 1;
    entry.projectIds.push(proj.id || proj.name || path.basename(proj.path));
    if (parsed.hasRepoPat) {
      entry.hasRepoPat = true;
      entry.ready = true;
    }
  }

  const azdoOrgs = Array.from(azdoMap.values());
  const readyAzdoCount = azdoOrgs.filter(o => o.ready).length;

  return {
    globalIdentity,
    tools,
    github: {
      accounts: ghAccounts,
      forkMissingAccounts
    },
    azureDevOps: {
      orgs: azdoOrgs,
      supportsKeychain: process.platform === 'darwin'
    },
    totalConnected: ghAccounts.length + readyAzdoCount,
    pendingGithubLogin: activeDeviceLogin && activeDeviceLogin.status === 'pending'
      ? {
          active: true,
          deviceCode: activeDeviceLogin.deviceCode,
          verificationUri: activeDeviceLogin.verificationUri,
          startedAt: activeDeviceLogin.startedAt
        }
      : { active: false }
  };
}

/**
 * 啟動 GitHub CLI OAuth Device Flow，立即回傳 One-time code 供 UI 呈現，授權完成後觸發 onComplete
 * @param {Object} [options]
 */
function startGithubDeviceLogin(options = {}) {
  const customEnv = options.customEnv || process.env;
  const onComplete = typeof options.onComplete === 'function' ? options.onComplete : () => {};

  if (activeDeviceLogin && activeDeviceLogin.status === 'pending' && activeDeviceLogin.deviceCode) {
    return Promise.resolve({
      success: true,
      reused: true,
      deviceCode: activeDeviceLogin.deviceCode,
      verificationUri: activeDeviceLogin.verificationUri
    });
  }

  const tools = checkToolsAvailability(customEnv);
  if (!tools.gh) {
    return Promise.resolve({
      success: false,
      error: '本機尚未安裝 GitHub CLI (gh)，請先執行 brew install gh 後再登入。'
    });
  }

  return new Promise((resolve) => {
    const env = buildToolEnv(customEnv);
    const child = spawn('gh', [
      'auth', 'login',
      '--hostname', 'github.com',
      '--git-protocol', 'https',
      '--web',
      '--scopes', 'repo,read:org'
    ], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const session = {
      status: 'pending',
      deviceCode: '',
      verificationUri: 'https://github.com/login/device',
      startedAt: new Date().toISOString(),
      child
    };
    activeDeviceLogin = session;

    let resolved = false;
    let combined = '';

    const finishResolve = (payload) => {
      if (resolved) return;
      resolved = true;
      resolve(payload);
    };

    const startupTimer = setTimeout(() => {
      if (!resolved) {
        session.status = 'timeout';
        try { child.kill(); } catch (e) {}
        activeDeviceLogin = null;
        finishResolve({
          success: false,
          error: '等待 GitHub 產生一次性驗證碼逾時，請稍後再試。'
        });
      }
    }, 15000);

    const overallTimer = setTimeout(() => {
      if (session.status === 'pending') {
        session.status = 'timeout';
        try { child.kill(); } catch (e) {}
        if (activeDeviceLogin === session) activeDeviceLogin = null;
      }
    }, 5 * 60 * 1000);

    const inspectChunk = (chunk) => {
      const text = chunk.toString('utf8');
      combined += text;
      const codeMatch = combined.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
      const urlMatch = combined.match(/https:\/\/github\.com\/login\/device\S*/i);
      if (codeMatch && !resolved) {
        clearTimeout(startupTimer);
        session.deviceCode = codeMatch[1];
        if (urlMatch) session.verificationUri = urlMatch[0];
        finishResolve({
          success: true,
          deviceCode: session.deviceCode,
          verificationUri: session.verificationUri
        });
      }
    };

    child.stdout.on('data', inspectChunk);
    child.stderr.on('data', inspectChunk);

    try {
      child.stdin.write('\n');
      child.stdin.end();
    } catch (e) {}

    child.on('close', (code) => {
      clearTimeout(startupTimer);
      clearTimeout(overallTimer);
      session.status = code === 0 ? 'completed' : 'failed';
      if (activeDeviceLogin === session) activeDeviceLogin = null;
      githubOrgsCache.clear();
      if (!resolved) {
        finishResolve({
          success: false,
          error: combined.trim() || `gh auth login 結束異常 (exit ${code})`
        });
      }
      onComplete({ success: code === 0, exitCode: code });
    });

    child.on('error', (err) => {
      clearTimeout(startupTimer);
      clearTimeout(overallTimer);
      session.status = 'failed';
      if (activeDeviceLogin === session) activeDeviceLogin = null;
      finishResolve({
        success: false,
        error: (err && err.message) || '啟動 gh auth login 失敗'
      });
    });
  });
}

function switchGithubAccount(username, customEnv) {
  const cleanUser = String(username || '').trim();
  if (!cleanUser) return { success: false, error: '缺少帳號名稱' };
  const env = buildNonInteractiveGitEnv(buildToolEnv(customEnv));
  try {
    execFileSync('gh', ['auth', 'switch', '--hostname', 'github.com', '--user', cleanUser], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000
    });
    return { success: true, username: cleanUser };
  } catch (err) {
    return {
      success: false,
      error: [err && err.stderr, err && err.message].filter(Boolean).join('\n').trim() || '切換 GitHub 帳號失敗'
    };
  }
}

module.exports = {
  parseGhAuthStatusOutput,
  getGhAuthAccounts,
  readForkDetectedGithubAccounts,
  getAzurePatKeychainService,
  hasAzureDevOpsPatInKeychain,
  getAzureDevOpsPatFromKeychain,
  saveAzureDevOpsPatToKeychain,
  verifyAndSaveAzureDevOpsPat,
  resolveGithubAccountForOwner,
  listGitAccounts,
  startGithubDeviceLogin,
  switchGithubAccount
};
