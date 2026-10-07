const fs = require('fs');
const path = require('path');

/**
 * 將任務的 feedback 歸檔至 description 歷史區塊，並清空 feedback 欄位
 * @param {Object} task
 */
function consumeTaskFeedback(task) {
  if (task && task.feedback && typeof task.feedback === 'string' && task.feedback.trim().length > 0) {
    const feedbackText = task.feedback.trim();
    // 若該 feedback 內容已存在於描述中，直接清空 feedback 欄位避免重複追加
    if ((task.description || '').includes(feedbackText)) {
      task.feedback = '';
      return;
    }
    const timeStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const formattedLines = feedbackText.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => l.startsWith('- ') ? l : `- ${l}`)
      .join('\n');
    const historyHeader = '\n\n--- 【歷次審查意見 / Feedback 記錄】 ---';
    if (!(task.description || '').includes('--- 【歷次審查意見 / Feedback 記錄】 ---')) {
      task.description = (task.description || '').trim() + historyHeader + `\n[${timeStr}]\n${formattedLines}`;
    } else {
      task.description = (task.description || '').trim() + `\n\n[${timeStr}]\n${formattedLines}`;
    }
    task.feedback = '';
  }
}

/**
 * 針對多個任務陣列進行全域自癒檢查
 * 若 review / done / archived 任務殘留 feedback，自動歸檔並清空
 * @param {Array} tasks
 * @returns {boolean} 是否有產生異動
 */
function healTasksFeedback(tasks) {
  if (!Array.isArray(tasks)) return false;
  let hasChanges = false;
  tasks.forEach(t => {
    if (t && (t.status === 'review' || t.status === 'done' || t.status === 'archived')) {
      if (t.feedback && typeof t.feedback === 'string' && t.feedback.trim().length > 0) {
        consumeTaskFeedback(t);
        hasChanges = true;
      }
    }
  });
  return hasChanges;
}

/**
 * 格式化標準 3-Phase ExecutionLog 模板
 * 若傳入 raw harness/terminal dump 或字串，將其整合成結構化三階段展示，避免純原生字串傾倒
 * @param {string} rawLog 原生或傳入之日誌
 * @param {Object} options { phase1: '', phase2: '', phase3: '' }
 * @returns {string} 結構化日誌
 */
function formatStructuredExecutionLog(rawLog = '', options = {}) {
  const content = rawLog || '';
  if (content.includes('### Phase 1') && content.includes('### Phase 2') && content.includes('### Phase 3')) {
    return content;
  }
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const p1 = options.phase1 || '未提供前置檢閱細節；請以實際執行記錄為準。';
  const p2 = options.phase2 || '未提供實作步驟細節；請以實際執行記錄為準。';
  const p3 = options.phase3 || '未提供驗證命令與結果；不能僅憑摘要判定驗證通過。';

  return `### Phase 1: Pre-Flight & Review Feedback Ingestion
- 時間: [${timestamp}]
- 說明: ${p1}

### Phase 2: Rule-Compliant Implementation
- 說明: ${p2}

### Phase 3: Compliance Manifest & Review Promotion
- 驗證說明: ${p3}${content ? `\n\n--- 執行詳細記錄 / 原生驗證輸出 ---\n${content}` : ''}`;
}

/**
 * 自動從專案目錄採集單元測試覆蓋率報告 (例如 coverage/coverage-summary.json)
 * @param {string} projPath
 * @returns {string|null} 覆蓋率摘要文字
 */
function extractCoverageSummary(projPath) {
  if (!projPath || !fs.existsSync(projPath)) return null;
  const summaryFile = path.join(projPath, 'coverage', 'coverage-summary.json');
  if (fs.existsSync(summaryFile)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
      if (summary && summary.total) {
        const { lines, statements, functions, branches } = summary.total;
        return `語句: ${statements?.pct || 0}% | 行數: ${lines?.pct || 0}% | 函式: ${functions?.pct || 0}% | 分支: ${branches?.pct || 0}%`;
      }
    } catch (e) {}
  }
  return null;
}

module.exports = {
  consumeTaskFeedback,
  healTasksFeedback,
  formatStructuredExecutionLog,
  extractCoverageSummary
};
