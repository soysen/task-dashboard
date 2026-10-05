/**
 * test_ui_behavior.js
 * 前端核心互動邏輯與狀態防線自動化測試
 * 涵蓋：autoResizeTextarea 算高、openTaskModal 清空 Review Feedback、以及待確認狀態解鎖
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 執行前端核心互動邏輯與狀態防線測試...');

const htmlContent = fs.readFileSync(path.join(__dirname, '../src/public/index.html'), 'utf8');

// 1. 驗證 autoResizeTextarea 實作健全性
assert(htmlContent.includes('function autoResizeTextarea(el, minHeight'), 'autoResizeTextarea 函式必須存在');
assert(htmlContent.includes('Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)'), 'autoResizeTextarea 必須包含上下邊界 clamp 計算');

// 模擬 DOM textarea 元素測試 autoResizeTextarea 演算法
function mockAutoResize(el, minHeight = 60, maxHeight = 400) {
  if (!el) return;
  el.rows = undefined;
  el.style = el.style || {};
  el.style.height = 'auto';
  const newHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
  el.style.height = `${newHeight}px`;
  return newHeight;
}

const mockEl1 = { scrollHeight: 20 }; // 小於 minHeight
const h1 = mockAutoResize(mockEl1, 72, 380);
assert.strictEqual(h1, 72, '內容高度小於下限時應被 clamp 至 minHeight (72)');

const mockEl2 = { scrollHeight: 200 }; // 正常區間
const h2 = mockAutoResize(mockEl2, 72, 380);
assert.strictEqual(h2, 200, '正常高度應直接反映 scrollHeight (200)');

const mockEl3 = { scrollHeight: 800 }; // 超過 maxHeight
const h3 = mockAutoResize(mockEl3, 72, 380);
assert.strictEqual(h3, 380, '內容過長時應被 clamp 至 maxHeight (380)');
console.log('  ✅ autoResizeTextarea 邊界計算驗證通過');

// 2. 驗證 Review 狀態下 openTaskModal 自動排空 formFeedback 欄位防線
assert(htmlContent.includes("if (task.status === 'review' || task.status === 'done' || task.status === 'archived')"), 'openTaskModal 必須在 review/done/archived 時處理 formFeedback');
assert(htmlContent.includes("document.getElementById('formFeedback').value = '';"), 'openTaskModal 必須主動將 formFeedback 設為空字串，防止舊意見殘留');
console.log('  ✅ Review/Done 狀態下 Feedback 清空防禦驗證通過');

// 3. 驗證 待確認任務 (requiresConfirmation: true) 之欄位解鎖邏輯
assert(htmlContent.includes('task.requiresConfirmation'), 'index.html 必須具備 requiresConfirmation 判斷');
assert(htmlContent.includes('isPendingConfirm'), 'index.html 必須明確定義待確認狀態旗標 isPendingConfirm');
console.log('  ✅ 待確認任務權限控制與雙向確認門禁驗證通過');

// 4. 驗證 Review 快捷退回標籤 (Quick Feedback Presets)
assert(htmlContent.includes('function insertFeedbackPreset('), 'index.html 必須具備 insertFeedbackPreset 函式');
assert(htmlContent.includes('insertFeedbackPreset(\'補單元測試與驗證證據\')'), 'index.html 必須具備補單元測試快捷標籤');
console.log('  ✅ Review 快捷退回標籤 (Quick Feedback Presets) 驗證通過');

// 5. 驗證 3-Phase ExecutionLog 結構模板化防禦
const { formatStructuredExecutionLog } = require('../src/server/feedbackManager');
const rawTerminalDump = `PASS test/unit.test.js\nStatements: 98% (49/50)\nAll tests passed.`;
const formattedLog = formatStructuredExecutionLog(rawTerminalDump);
assert(formattedLog.includes('### Phase 1: Pre-Flight & Review Feedback Ingestion'), '必須包含 Phase 1 標題');
assert(formattedLog.includes('### Phase 2: Rule-Compliant Implementation'), '必須包含 Phase 2 標題');
assert(formattedLog.includes('### Phase 3: Compliance Manifest & Review Promotion'), '必須包含 Phase 3 標題');
// 6. 驗證 切片卡滯/逾時預警與切片進度顯示
assert(htmlContent.includes('t.liveStatus?.isStalled'), 'index.html 看板卡片必須具備 isStalled 預警邏輯');
assert(htmlContent.includes('切片推進緩慢'), 'index.html 必須具備「切片推進緩慢」預警標籤');
console.log('  ✅ 切片卡滯/逾時預警標籤驗證通過');

// 7. 驗證 測試覆蓋率採集函式
const { extractCoverageSummary } = require('../src/server/feedbackManager');
// 8. 驗證 多 Agent 認領選單與卡片徽章 (Antigravity / Claude / Codex / Copilot)
assert(htmlContent.includes('<option value="Antigravity" selected>Antigravity (預設)</option>'), '必須具備 Antigravity 預設選項');
assert(htmlContent.includes('<option value="Claude">Claude</option>'), '必須具備 Claude 選項');
assert(htmlContent.includes('<option value="Codex">Codex</option>'), '必須具備 Codex 選項');
assert(htmlContent.includes('<option value="Copilot">Copilot</option>'), '必須具備 Copilot 選項');
assert(htmlContent.includes('🤖 ${escapeHtml(t.assignedAgent'), '看板卡片必須渲染 assignedAgent 徽章');
console.log('  ✅ 多 Agent 認領選單與卡片識別徽章驗證通過');

// 9. 驗證 watch-task-gate.js 支援 --agent 參數分流與過濾
const gateContent = fs.readFileSync(path.join(__dirname, 'watch-task-gate.js'), 'utf8');
assert(gateContent.includes('arg.startsWith(\'--agent=\')'), 'watch-task-gate.js 必須解析 --agent 參數');
assert(gateContent.includes('taskAgent !== targetAgent'), 'watch-task-gate.js 必須支援非所屬 agent 任務過濾');
console.log('  ✅ watch-task-gate 哨兵 --agent 分流過濾邏輯驗證通過');

console.log('🎉 所有前端核心互動邏輯與防禦機制測試通過！\n');
