/**
 * gitnexusDetector.js
 * 動態偵測受管專案是否建置 GitNexus 索引，並產出單行優先圖譜探索指引
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * 偵測目標專案的 GitNexus 狀態與執行命令形式
 * @param {string} projPath
 * @returns {{ hasGitNexus: boolean, hasWrapper: boolean, repoName: string, commandPrefix: string, repoFlag: string, indexedCommit: string, headCommit: string, isStale: boolean }}
 */
function detectProjectGitNexus(projPath) {
  const empty = {
    hasGitNexus: false,
    hasWrapper: false,
    repoName: '',
    commandPrefix: '',
    repoFlag: '',
    indexedCommit: '',
    headCommit: '',
    isStale: false
  };

  if (!projPath || !fs.existsSync(projPath)) return empty;

  const resolvedPath = path.resolve(projPath);
  const gitnexusDir = path.join(resolvedPath, '.gitnexus');
  const runCjs = path.join(gitnexusDir, 'run.cjs');
  const metaFile = path.join(gitnexusDir, 'meta.json');
  const lbugFile = path.join(gitnexusDir, 'lbug');

  const hasWrapper = fs.existsSync(runCjs);
  const hasGitNexus = hasWrapper || fs.existsSync(metaFile) || fs.existsSync(lbugFile);
  if (!hasGitNexus) return empty;

  const repoName = path.basename(resolvedPath);
  const commandPrefix = hasWrapper ? 'node .gitnexus/run.cjs' : 'npx gitnexus';
  const repoFlag = hasWrapper ? '--repo .' : `-r ${repoName}`;

  let indexedCommit = '';
  if (fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (meta && typeof meta.lastCommit === 'string') {
        indexedCommit = meta.lastCommit.trim();
      }
    } catch (e) {}
  }

  let headCommit = '';
  try {
    headCommit = execFileSync('git', ['-C', resolvedPath, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (e) {}

  const isStale = Boolean(headCommit && (!indexedCommit || indexedCommit !== headCommit));

  return {
    hasGitNexus: true,
    hasWrapper,
    repoName,
    commandPrefix,
    repoFlag,
    indexedCommit,
    headCommit,
    isStale
  };
}

/**
 * 依據偵測結果產出單行 GitNexus 優先分析指引（無索引時回傳空字串，不含 Subagent 字樣）
 * @param {string} projPath
 * @returns {string}
 */
function formatGitNexusGuidance(projPath) {
  const info = detectProjectGitNexus(projPath);
  if (!info.hasGitNexus) return '';

  const staleStep = info.isStale
    ? `索引落後 HEAD，請先執行 ${info.commandPrefix} analyze 更新索引；`
    : '';

  return `• 【專案 Code Graph (先圖譜後讀檔)】: ${staleStep}讀取業務檔案前，請先執行 ${info.commandPrefix} query "<關鍵字>" ${info.repoFlag} 或 ${info.commandPrefix} impact <symbol> --direction upstream ${info.repoFlag} 鎖定呼叫鏈與受影響檔案，再切片 read_file。`;
}

module.exports = {
  detectProjectGitNexus,
  formatGitNexusGuidance
};
