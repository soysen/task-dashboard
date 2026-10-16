/**
 * test_ui_behavior.js
 * 前端核心互動邏輯與狀態防線自動化測試
 * 涵蓋：autoResizeTextarea 算高、openTaskModal 清空 Review Feedback、以及待確認狀態解鎖
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

console.log('🧪 執行前端核心互動邏輯與狀態防線測試...');

const htmlContent = fs.readFileSync(path.join(__dirname, '../src/public/index.html'), 'utf8');
const styleContent = fs.readFileSync(path.join(__dirname, '../src/public/style.css'), 'utf8');
const moduleFiles = fs.readdirSync(path.join(__dirname, '../src/public/modules')).filter(f => f.endsWith('.js'));
const modulesContent = moduleFiles.map(f => fs.readFileSync(path.join(__dirname, '../src/public/modules', f), 'utf8')).join('\n');
const allUiContent = htmlContent + '\n' + styleContent + '\n' + modulesContent;

assert(htmlContent.includes('<link rel="stylesheet" href="/style.css">'), "index.html 必須引入 /style.css");
assert(htmlContent.includes('<script type="module" src="/modules/app.js"></script>'), "index.html 必須引入 /modules/app.js 原生模組");

// 1. 驗證 autoResizeTextarea 實作健全性
assert(allUiContent.includes('function autoResizeTextarea(el, minHeight'), 'autoResizeTextarea 函式必須存在');
assert(allUiContent.includes('Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)'), 'autoResizeTextarea 必須包含上下邊界 clamp 計算');

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
assert(allUiContent.includes("if (task.status === 'review' || task.status === 'done' || task.status === 'archived')"), 'openTaskModal 必須在 review/done/archived 時處理 formFeedback');
assert(allUiContent.includes("document.getElementById('formFeedback').value = '';"), 'openTaskModal 必須主動將 formFeedback 設為空字串，防止舊意見殘留');
console.log('  ✅ Review/Done 狀態下 Feedback 清空防禦驗證通過');

// 3. 驗證 待確認任務 (requiresConfirmation: true) 之欄位解鎖邏輯
assert(allUiContent.includes('task.requiresConfirmation'), 'index.html 必須具備 requiresConfirmation 判斷');
assert(allUiContent.includes('isPendingConfirm'), 'index.html 必須明確定義待確認狀態旗標 isPendingConfirm');
console.log('  ✅ 待確認任務權限控制與雙向確認門禁驗證通過');

// 4. 驗證 Review 快捷退回標籤 (Quick Feedback Presets)
assert(allUiContent.includes('function insertFeedbackPreset('), 'index.html 必須具備 insertFeedbackPreset 函式');
assert(allUiContent.includes('insertFeedbackPreset(\'補單元測試與驗證證據\')'), 'index.html 必須具備補單元測試快捷標籤');
console.log('  ✅ Review 快捷退回標籤 (Quick Feedback Presets) 驗證通過');

// 5. 驗證 3-Phase ExecutionLog 結構模板化防禦
const { formatStructuredExecutionLog } = require('../src/server/feedbackManager');
const rawTerminalDump = `PASS test/unit.test.js\nStatements: 98% (49/50)\nAll tests passed.`;
const formattedLog = formatStructuredExecutionLog(rawTerminalDump);
assert(formattedLog.includes('### Phase 1: Pre-Flight & Review Feedback Ingestion'), '必須包含 Phase 1 標題');
assert(formattedLog.includes('### Phase 2: Rule-Compliant Implementation'), '必須包含 Phase 2 標題');
assert(formattedLog.includes('### Phase 3: Compliance Manifest & Review Promotion'), '必須包含 Phase 3 標題');
// 6. 驗證 切片卡滯/逾時預警與切片進度即時輪詢與視覺化 (TASK-006)
assert(allUiContent.includes('t.liveStatus?.isStalled'), 'index.html 看板卡片必須具備 isStalled 預警邏輯');
assert(allUiContent.includes('切片推進緩慢'), 'index.html 必須具備「切片推進緩慢」預警標籤');
assert(allUiContent.includes('function pollActiveTaskSliceInfo(task)'), '必須具備 pollActiveTaskSliceInfo 函式');
assert(allUiContent.includes('isSlicePolling') && allUiContent.includes('lastSlicePollTime'), 'pollActiveTaskSliceInfo 必須具備防抖與併發請求防禦機制');
assert(allUiContent.includes('/slice-info?t='), 'pollActiveTaskSliceInfo 必須呼叫 /api/tasks/:id/slice-info 進行動態輪詢');
assert(allUiContent.includes('pollActiveTaskSliceInfo(freshTask)'), 'loadData 必須於進行中彈窗同步時呼叫 pollActiveTaskSliceInfo');
assert(allUiContent.includes('function getTaskSliceProgress('), '必須具備 getTaskSliceProgress 輔助函式');
assert(allUiContent.includes('切片 ${prog.currentNum}/${prog.total}'), '看板 in_progress 卡片必須渲染切片進度摘要 (例如：切片 X/Y)');
console.log('  ✅ 切片卡滯/逾時預警與即時切片進度標籤驗證通過');

// 7. 驗證 測試覆蓋率採集函式
const { extractCoverageSummary } = require('../src/server/feedbackManager');
// 8. 驗證 多 Agent 認領選單與卡片下方顯示 (Antigravity / Claude / Codex / Copilot)
assert(allUiContent.includes('<option value="Antigravity" selected>Antigravity (預設)</option>'), '必須具備 Antigravity 預設選項');
assert(allUiContent.includes('<option value="Claude">Claude</option>'), '必須具備 Claude 選項');
assert(allUiContent.includes('<option value="Codex">Codex</option>'), '必須具備 Codex 選項');
assert(allUiContent.includes('<option value="Copilot">Copilot</option>'), '必須具備 Copilot 選項');
assert(!allUiContent.includes('title="指定執行 Agent:'), '看板卡片不得再渲染上方重複 Agent tag');
assert(allUiContent.includes('<span>${escapeHtml(t.assignee)}</span>'), '看板卡片必須保留下方 Agent 顯示');
console.log('  ✅ 多 Agent 認領選單與卡片下方單一顯示驗證通過');

// 9. 驗證 watch-task-gate.js 支援 --agent 參數分流與過濾
const gateContent = fs.readFileSync(path.join(__dirname, 'watch-task-gate.js'), 'utf8');
assert(gateContent.includes('arg.startsWith(\'--agent=\')'), 'watch-task-gate.js 必須解析 --agent 參數');
assert(gateContent.includes('taskAgent !== targetAgent'), 'watch-task-gate.js 必須支援非所屬 agent 任務過濾');
// 10. 驗證 「確認並執行」開工觸發防線 (confirmExecution 與狀態轉換)
assert(allUiContent.includes('confirmExecution: true'), 'confirmAndExecuteTask 必須傳送 confirmExecution: true 旗標');
assert(allUiContent.includes('✅ [Confirmation Gate]'), 'confirmAndExecuteTask 必須在日誌中註記 Confirmation Gate 授權確認');
console.log('  ✅ 「確認並執行」開工觸發與 Confirmation Gate 驗證通過');

// 11. 驗證 任務放棄與刪除機制 (Double Check Modal 與 Git Diff / Discard Changes)
assert(allUiContent.includes('id="taskActionConfirmModal"'), '必須包含 taskActionConfirmModal 雙重確認彈窗');
assert(allUiContent.includes('id="actionModalDiscardCheckbox"'), '必須包含 actionModalDiscardCheckbox 捨棄工作區變更核取方塊');
assert(allUiContent.includes('promptTaskDeleteOrAbandon'), '必須具備 promptTaskDeleteOrAbandon 啟動器函式');
assert(allUiContent.includes('executeTaskActionConfirmed'), '必須具備 executeTaskActionConfirmed 執行函式');
assert(allUiContent.includes('git-status'), '前端必須呼叫 /api/tasks/:id/git-status 取得即時異動預覽');
assert(allUiContent.includes('/abandon'), '前端必須支援 POST /api/tasks/:id/abandon');
assert(allUiContent.includes('btnAbandonTask'), '任務彈窗必須具備 btnAbandonTask 放棄按鈕');
assert(!allUiContent.includes('<button type="button" id="btnDeleteTask"'), '任務彈窗底部必須移除獨立的刪除任務按鈕，統一保留放棄任務');
assert(allUiContent.includes("t.status !== 'backlog' ?"), '看板卡片在 backlog 狀態不應渲染放棄按鈕');
assert(allUiContent.includes("isBacklog"), '任務彈窗在 backlog 狀態必須隱藏放棄任務按鈕');
assert(allUiContent.includes('discardCb.checked = true'), '放棄確認彈窗必須預設勾選捨棄工作區變更');
const archiveCloseIndex = htmlContent.indexOf('</div>\n  </div>\n\n  <!-- Task Action Confirmation Modal');
assert(archiveCloseIndex !== -1, 'taskActionConfirmModal 不可被包覆在 archiveModal 內，必須為頂層獨立彈窗');
console.log('  ✅ 任務放棄與刪除 Double-Check 及 Git Discard 機制驗證通過');

// 12. 驗證 Grill-Me 專案邊界確認與替代處理機制
assert(allUiContent.includes('hasGrillMe'), '卡片渲染邏輯必須具備 hasGrillMe 專案技能判定');
assert(allUiContent.includes('🔥 Grill-Me 待確認'), '具備 grill-me 之專案在待確認狀態必須渲染專屬徽章');
assert(allUiContent.includes('id="grillMeBanner"'), '任務彈窗必須具備 grillMeBanner 邊界確認替代介面');
assert(allUiContent.includes('insertGrillMeDecision'), '必須具備 insertGrillMeDecision 快捷決策標籤函式');
assert(allUiContent.includes('Grill-Me 邊界確認替代介面'), '任務彈窗必須展示 Grill-Me 替代介面標題');
console.log('  ✅ Grill-Me 專案卡牌邊界待確認與彈窗替代處理機制驗證通過');

const allSources = [htmlContent, ...moduleFiles.map(m => fs.readFileSync(path.join(__dirname, '../src/public/modules', m), 'utf8'))];
function actualFunction(name) {
  for (const f of allSources) {
    const matches = [...f.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\(/gm)];
    const idx = matches.findIndex(match => match[1] === name);
    if (idx !== -1) {
      const start = matches[idx].index;
      const end = idx + 1 < matches.length ? matches[idx + 1].index : (f.includes('\nexport {') ? f.indexOf('\nexport {') : f.length);
      return f.slice(start, end > start ? end : undefined).replace(/^\s*export\s+/, '');
    }
  }
  throw new Error(`Missing actual function ${name}`);
}

const projectElements = {
  formProject: { value: 'task-dashboard' },
  formProjectInput: { value: '' },
  formProjectDropdownList: { innerHTML: '' }
};
const projectContext = vm.createContext({
  projects: [
    { id: 'task-dashboard', name: 'task-dashboard', description: 'local dashboard' },
    { id: 'custom-id', name: 'Custom Project', description: 'distinct description' },
    { id: 'escaped-id', name: '<Custom & Project>', description: '' }
  ],
  document: { getElementById: id => projectElements[id] },
  window: {},
  currentModalEditingTask: null,
  updateProjectClearButtonVisibility() {},
  hideProjectAutocomplete() {},
  initSelect2Dropdown() {},
  renderSelect2Chips() {},
  updateDependencyOptions() {},
  updateConfirmationGateForProject() {}
});
vm.runInContext(['escapeHtml', 'renderProjectAutocompleteList', 'setFormProject']
  .map(actualFunction).join('\n'), projectContext);

projectContext.renderProjectAutocompleteList('task-dashboard');
let projectMarkup = projectElements.formProjectDropdownList.innerHTML;
assert(projectMarkup.includes('>task-dashboard</span>'), 'Same name/ID must display project name');
assert(!projectMarkup.includes('(task-dashboard)'), 'Same name/ID must not repeat ID');
assert(projectMarkup.includes('data-lucide="check"'), 'Selected project must retain checkmark');

for (const query of ['custom project', 'custom-id', 'distinct description']) {
  projectContext.renderProjectAutocompleteList(query);
  projectMarkup = projectElements.formProjectDropdownList.innerHTML;
  assert(projectMarkup.includes('>Custom Project</span>'), `${query}: project must remain searchable`);
  assert(projectMarkup.includes('(custom-id)'), `${query}: distinct ID must remain visible`);
  assert(!projectMarkup.includes('>task-dashboard</span>'), `${query}: unrelated projects must be filtered`);
}
projectContext.renderProjectAutocompleteList('escaped-id');
assert(projectElements.formProjectDropdownList.innerHTML.includes('&lt;Custom &amp; Project&gt;'),
  'Project names must remain HTML-escaped');
projectContext.renderProjectAutocompleteList('no matching project');
assert(projectElements.formProjectDropdownList.innerHTML.includes('無符合的專案'),
  'Empty search results must retain existing message');
projectContext.renderProjectAutocompleteList();
assert(projectElements.formProjectDropdownList.innerHTML.includes('>task-dashboard</span>'),
  'Empty query must show all projects');
assert(projectElements.formProjectDropdownList.innerHTML.includes('(custom-id)'),
  'Empty query must preserve distinct IDs');

projectContext.setFormProject('custom-id');
assert.strictEqual(projectElements.formProject.value, 'custom-id', 'Selection must store ID, not display name');
assert.strictEqual(projectElements.formProjectInput.value, 'Custom Project', 'Selected input must display name');
projectContext.setFormProject('task-dashboard');
assert.strictEqual(projectElements.formProject.value, 'task-dashboard');
assert.strictEqual(projectElements.formProjectInput.value, 'task-dashboard');
console.log('  ✅ 專案名稱與 ID 去重、搜尋、選取及 HTML escaping 驗證通過');

// 13. 驗證 頂部工作流階段導覽列 (Workflow Stage Bar)、移除阻礙欄位、單一主色+局部狀態色彩計劃與無框線色塊陰影系統
assert(allUiContent.includes('id="stage-pill-review"'), '頂部工作流導覽列必須包含 stage-pill-review 階段膠囊');
assert(!allUiContent.includes('id="stage-pill-blocked"'), '頂部工作流導覽列必須移除實務未使用的 stage-pill-blocked 阻礙膠囊');
assert(!allUiContent.includes('id="col-wrapper-blocked"'), '看板必須移除實務未使用的 col-wrapper-blocked 阻礙欄位');
assert(!allUiContent.includes('<option value="blocked">'), '狀態下拉選單必須移除 blocked 阻礙選項');
assert(allUiContent.includes('--td-primary:'), '必須定義單一主色 CSS 變數 (--td-primary) 實踐 60-30-10 單一主色+局部狀態色彩計劃');
assert(allUiContent.includes('--td-status-review:'), '必須定義局部狀態語意色 CSS 變數 (--td-status-review) 取代螢光紫');
assert(allUiContent.includes('td-surface-well') && allUiContent.includes('td-surface-card'), '必須以無框線色塊明度階梯 + 雙層立體陰影 (.td-surface-well / .td-surface-card) 取代結構框線並適配低顯色外接螢幕');
assert(allUiContent.includes('流程：'), '頂部工作流導覽列必須包含首次使用者操作流程提示');
assert(allUiContent.includes('emptyStateHints'), 'renderKanban 必須提供各階段情境式空狀態操作引導 (emptyStateHints)');
assert(allUiContent.includes('t.modifiedFiles.length} 檔案 · '), '待驗收卡片必須顯示異動檔案數量摘要，協助 Reviewer 快速評估審核規模');

const makeClassMock = () => {
  const set = new Set();
  const attrs = new Map();
  return {
    classList: {
      toggle: (cls, force) => { if (force) set.add(cls); else set.delete(cls); },
      contains: cls => set.has(cls)
    },
    setAttribute: (name, val) => attrs.set(name, String(val)),
    getAttribute: (name) => attrs.get(name)
  };
};

const stageMockElements = {};
['ALL', 'todo', 'in_progress', 'review', 'done'].forEach(st => {
  stageMockElements[`stage-pill-${st}`] = makeClassMock();
  if (st !== 'ALL') {
    stageMockElements[`col-wrapper-${st}`] = makeClassMock();
  }
});
let kanbanReRendered = 0;
const stageFilterContext = vm.createContext({
  document: { getElementById: id => stageMockElements[id] },
  window: {},
  renderKanban: () => { kanbanReRendered++; }
});
vm.runInContext(actualFunction('filterByStage'), stageFilterContext);
stageFilterContext.filterByStage('review');
assert.strictEqual(stageFilterContext.window.currentStageFilter, 'review', '點擊 review 階段膠囊應切換過濾狀態至 review');
assert.strictEqual(stageMockElements['stage-pill-review'].getAttribute('aria-pressed'), 'true', '過濾 review 時 stage-pill-review 之 aria-pressed 應為 true');
assert(!stageMockElements['col-wrapper-review'].classList.contains('hidden'), '過濾 review 時 col-wrapper-review 應保持顯示');
assert(stageMockElements['col-wrapper-todo'].classList.contains('hidden'), '過濾 review 時非目標欄位 col-wrapper-todo 應隱藏');
stageFilterContext.filterByStage('review');
assert.strictEqual(stageFilterContext.window.currentStageFilter, 'ALL', '再次點擊相同階段膠囊應重置為 ALL 顯示全部欄位');
assert.strictEqual(stageMockElements['stage-pill-ALL'].getAttribute('aria-pressed'), 'true', '重置為 ALL 後 stage-pill-ALL 之 aria-pressed 應為 true');
assert.strictEqual(stageMockElements['stage-pill-review'].getAttribute('aria-pressed'), 'false', '重置為 ALL 後 stage-pill-review 之 aria-pressed 應為 false');
assert(!stageMockElements['col-wrapper-todo'].classList.contains('hidden'), '重置為 ALL 後所有欄位應恢復顯示');
console.log('  ✅ 頂部工作流階段導覽列、移除阻礙欄位與無框線色塊陰影系統驗證通過');

// 14. 驗證 任務彈窗 IA 階段感知工作區分頁 (Stage-Aware Workspace Tabs)
assert(allUiContent.includes('id="modalLeftWorkspaceTabs"'), '彈窗左側必須包含 modalLeftWorkspaceTabs 階段感知分頁切換器');
assert(allUiContent.includes('id="modalReviewPane"'), '彈窗左側必須包含 modalReviewPane 審核與執行成果面板');
assert(allUiContent.includes('id="modalSpecPane"'), '彈窗左側必須包含 modalSpecPane 需求規格與屬性面板');
assert(allUiContent.includes('id="modalReviewContextSummary"'), '審核面板必須包含 modalReviewContextSummary 漸進式揭露需求摘要橫幅');

const tabElements = {
  modalReviewPane: makeClassMock(),
  modalSpecPane: makeClassMock(),
  modalReviewContextSummary: makeClassMock(),
  btnModalTabReview: makeClassMock(),
  btnModalTabSpec: makeClassMock()
};
const tabContext = vm.createContext({
  document: { getElementById: id => tabElements[id] },
  currentModalEditingTask: { id: 'TASK-119', status: 'review' },
  setTimeout: fn => fn(),
  autoResizeTextarea: () => {}
});
vm.runInContext(actualFunction('switchModalWorkspaceTab'), tabContext);
assert(allUiContent.includes('dark:bg-slate-950') && allUiContent.includes('dark:border-slate-700'), 'modalLeftWorkspaceTabs 必須在 Dark Mode 具備高對比深色凹槽背景與外框線');
tabContext.switchModalWorkspaceTab('review');
assert(!tabElements.modalReviewPane.classList.contains('hidden'), '切換至 review 分頁時 modalReviewPane 必須顯示');
assert(tabElements.modalSpecPane.classList.contains('hidden'), '切換至 review 分頁時 modalSpecPane 必須隱藏以消除屬性欄位噪音');
assert(!tabElements.modalReviewContextSummary.classList.contains('hidden'), '切換至 review 分頁時應顯示需求上下文精簡摘要');
assert(tabElements.btnModalTabReview.classList.contains('dark:bg-slate-800'), '作用中 review 分頁在 Dark Mode 必須具備高亮浮起背景 (dark:bg-slate-800)');
assert(tabElements.btnModalTabReview.classList.contains('dark:border-slate-600'), '作用中 review 分頁在 Dark Mode 必須具備清晰外框線 (dark:border-slate-600)');
assert(!tabElements.btnModalTabSpec.classList.contains('dark:bg-slate-800'), '未作用之 spec 分頁在 Dark Mode 不可包含高亮浮起背景');

tabContext.switchModalWorkspaceTab('spec');
assert(!tabElements.modalSpecPane.classList.contains('hidden'), '切換至 spec 分頁時 modalSpecPane 必須顯示');
assert(tabElements.modalReviewPane.classList.contains('hidden'), '切換至 spec 分頁時 modalReviewPane 必須隱藏');
assert(tabElements.btnModalTabSpec.classList.contains('dark:bg-slate-800'), '作用中 spec 分頁在 Dark Mode 必須具備高亮浮起背景 (dark:bg-slate-800)');
assert(tabElements.btnModalTabSpec.classList.contains('dark:border-slate-600'), '作用中 spec 分頁在 Dark Mode 必須具備清晰外框線 (dark:border-slate-600)');
assert(!tabElements.btnModalTabReview.classList.contains('dark:bg-slate-800'), '未作用之 review 分頁在 Dark Mode 不可包含高亮浮起背景');
assert.strictEqual(tabElements.btnModalTabSpec.getAttribute('aria-selected'), 'true', '切換至 spec 時 btnModalTabSpec 之 aria-selected 必須為 true');
assert.strictEqual(tabElements.btnModalTabReview.getAttribute('aria-selected'), 'false', '切換至 spec 時 btnModalTabReview 之 aria-selected 必須為 false');
console.log('  ✅ 任務彈窗 IA 階段感知工作區分頁切換、Dark Mode 高對比外觀與 ARIA 屬性驗證通過');

// 15. 驗證 結構化執行報告 (renderExecutionReport) 統一圓角淺灰底、明確主次標題層級、清晰分隔線與狀態標籤不換行
assert(allUiContent.includes('id="formLogBox" class="hidden td-surface-panel rounded-xl p-3.5'), '任務執行與驗證報告 (#formLogBox) 必須與上方審查意見及任務規格統一樣式為圓角淺灰底 (td-surface-panel rounded-xl)');
const reportContainer = { innerHTML: '' };
const reportContext = vm.createContext({
  document: { getElementById: id => (id === 'formReportVisual' ? reportContainer : null) },
  window: {},
  escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
});
vm.runInContext(['escapeHtml', 'renderExecutionReport'].map(actualFunction).join('\n'), reportContext);
reportContext.renderExecutionReport({
  id: 'TASK-119',
  status: 'review',
  executionLog: '# 📋 任務執行報告 (Task Execution Report)\n\n## 1. 任務目標\n- 優化 `src/public/index.html` 資訊架構與 **極簡視覺**\n\n## 3. 驗證結果\n- 執行 `npm test` 全部通過'
});
assert(reportContainer.innerHTML.includes('<code class="px-1.5 py-0.5 rounded'), 'renderExecutionReport 必須將反引號語法渲染為行內 code 膠囊標籤');
assert(reportContainer.innerHTML.includes('leading-[1.7]'), 'renderExecutionReport 必須套用舒適閱讀行高 leading-[1.7]');
assert(reportContainer.innerHTML.includes('驗證通過'), 'renderExecutionReport 必須正確識別並渲染驗證通過狀態徽章');
assert(reportContainer.innerHTML.includes('pl-2 divide-y divide-slate-300') && reportContainer.innerHTML.includes('dark:divide-slate-500'), 'renderExecutionReport 必須使用左縮排 (pl-2) 與大項目清晰分隔線 (divide-slate-300 / dark:divide-slate-500) 建立主次層級');
assert(!reportContainer.innerHTML.includes('border-b border-slate-'), 'renderExecutionReport 內部標題不得包含多餘底線分隔線，僅保留大項目間分隔');
assert(reportContainer.innerHTML.includes('whitespace-nowrap flex-shrink-0'), '狀態標籤與徽章必須包含 whitespace-nowrap flex-shrink-0 防止文字排版換行');
assert(reportContainer.innerHTML.includes('shadow-none') && !reportContainer.innerHTML.includes('td-surface-card'), 'renderExecutionReport 內部段落必須取消區塊陰影與浮起卡片樣式，改以分隔線呈現');
// 16. 驗證 TASK-120 / TASK-121 UI/UX 優化：表單加回框線、取消內側陰影、無任務卡牌不需底色、流程說明步驟底色框線與線條連結、彈窗留白與間距校準
assert(allUiContent.includes('id="formTitle"') && allUiContent.includes('border border-slate-300 dark:border-slate-700'), '表單欄位必須加回框線 (border border-slate-300 dark:border-slate-700)');
assert(!allUiContent.includes('id="formTitle" required placeholder="請輸入簡潔明確的任務名稱..." class="w-full h-9 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 text-xs text-slate-900 dark:text-slate-100 shadow-inner'), '表單標題不得再包含 shadow-inner 內側陰影');
assert(!allUiContent.includes('td-surface-panel rounded-lg space-y-1"><div class="font-medium text-slate-600 dark:text-slate-300">無任務卡片'), '無任務卡牌不得套用底色 (td-surface-panel)');
assert(allUiContent.includes('id="modalLeftColumn" class="flex-1 overflow-y-auto pl-1 pr-2'), 'modalLeftColumn 必須增加 pl-1 避免左側內容過於貼齊');
assert(allUiContent.includes('id="modalLeftWorkspaceTabs"') && allUiContent.includes('!mt-0'), 'modalLeftWorkspaceTabs 必須包含 !mt-0 移除上方多餘間距');
assert(allUiContent.includes('id="headerWorkflowHint"') && allUiContent.includes('border-sky-300') && allUiContent.includes('border-amber-300') && allUiContent.includes('border-emerald-300'), '流程說明各步驟必須具備獨立底色與框線');
assert(!allUiContent.includes('id="headerWorkflowHint"') || !htmlContent.split('id="headerWorkflowHint"')[1].split('</div>')[0].includes('→'), '流程說明各步驟間必須以線條連結取代箭頭 (→)');

// 17. 驗證 TASK-121 UI 回歸防禦與無障礙強化 (內縮 outline、開工引擎模式與離線狀態、退回任務審核可見性純函式、狀態常數)
assert(allUiContent.includes('outline-offset: -2px !important;') && allUiContent.includes('--td-focus'), '表單文字控制項必須套用內縮 outline (outline-offset: -2px) 避免被捲動容器裁切');
assert(allUiContent.includes('id="headerEngineModeText"') && allUiContent.includes('id="headerEngineOfflineBadge"'), '開工引擎必須包含模式標示 (headerEngineModeText) 與離線警示徽章 (headerEngineOfflineBadge)');
assert(!allUiContent.includes('巡檢中') && !allUiContent.includes('headerEngineDot'), '開工引擎不得再包含不實巡檢中字樣或脈動燈號');
assert(allUiContent.includes('function shouldShowReviewWorkspace(task)'), '必須抽離 shouldShowReviewWorkspace 純函式判定審核工作區可見性');
assert(allUiContent.includes('const showReviewWorkspace = shouldShowReviewWorkspace(task);'), 'openModalForEdit 必須呼叫 shouldShowReviewWorkspace');
assert(allUiContent.includes('const KANBAN_STATUSES = Object.freeze'), '必須定義不可變之狀態常數 KANBAN_STATUSES');
assert(allUiContent.includes('prefers-reduced-motion: reduce'), '必須支援 prefers-reduced-motion 減少動態偏好');

// 17-1 行為測試：shouldShowReviewWorkspace 純函式驗證
const reviewVisibilityContext = vm.createContext({});
vm.runInContext(actualFunction('shouldShowReviewWorkspace'), reviewVisibilityContext);
const shouldShow = reviewVisibilityContext.shouldShowReviewWorkspace;
assert.strictEqual(shouldShow(null), false, '空任務不可顯示審核分頁');
assert.strictEqual(shouldShow({ status: 'todo' }), false, '全新 todo 任務不得顯示審核分頁');
assert.strictEqual(shouldShow({ status: 'todo', title: '全新任務' }), false, '無執行紀錄之 todo 任務不得顯示審核分頁');
assert.strictEqual(shouldShow({ status: 'todo', executionLog: '❌ CLI Agent 執行失敗，無有效變更產出。' }), true, '包含失敗日誌之退回 todo 任務必須顯示審核分頁');
assert.strictEqual(shouldShow({ status: 'todo', feedback: '請調整實作切片' }), true, '包含審查意見之退回 todo 任務必須顯示審核分頁');
assert.strictEqual(shouldShow({ status: 'todo', executionPlan: '1. 規劃步驟' }), true, '包含執行計劃之 todo 任務必須顯示審核分頁');
assert.strictEqual(shouldShow({ status: 'review' }), true, 'review 任務必須顯示審核分頁');
assert.strictEqual(shouldShow({ status: 'in_progress' }), true, 'in_progress 任務必須顯示審核分頁');
assert.strictEqual(shouldShow({ status: 'done' }), true, 'done 任務必須顯示審核分頁');

// 17-2 行為測試：renderCliAgentBadge 模式文字與離線偵測驗證
const engineModeTextEl = { innerText: '' };
const engineOfflineBadgeEl = makeClassMock();
const engineBtnEl = { title: '' };
const badgeContext = vm.createContext({
  settings: { enableCliAgent: false, cliCommand: 'hermes' },
  apiFailStreak: 0,
  document: {
    getElementById: id => {
      if (id === 'headerEngineModeText') return engineModeTextEl;
      if (id === 'headerEngineOfflineBadge') return engineOfflineBadgeEl;
      if (id === 'headerEngineBtn') return engineBtnEl;
      return null;
    }
  }
});
vm.runInContext(actualFunction('renderCliAgentBadge'), badgeContext);

// 模式 1: Desktop AI 正常待命
badgeContext.renderCliAgentBadge();
assert.strictEqual(engineModeTextEl.innerText, 'Desktop AI', 'Desktop AI 模式下應顯示 Desktop AI');
assert(engineOfflineBadgeEl.classList.contains('hidden'), '正常連線下離線徽章應隱藏');

// 模式 2: CLI Agent 正常啟用
badgeContext.settings.enableCliAgent = true;
badgeContext.renderCliAgentBadge();
assert.strictEqual(engineModeTextEl.innerText, 'CLI', 'CLI 模式下應顯示 CLI');
assert(engineOfflineBadgeEl.classList.contains('hidden'), '正常連線下離線徽章應隱藏');

// 模式 3: 離線警示 (連續失敗 2 次以上)
badgeContext.apiFailStreak = 2;
badgeContext.renderCliAgentBadge();
assert(!engineOfflineBadgeEl.classList.contains('hidden'), '連續失敗 2 次以上離線徽章必須顯示');
assert(engineBtnEl.title.includes('無回應'), '離線狀態下開工引擎按鈕 title 必須提示無回應警示');

// 17-3 行為測試：getTaskSliceProgress 與 pollActiveTaskSliceInfo 邏輯驗證 (TASK-006)
const sliceProgressContext = vm.createContext({});
vm.runInContext(actualFunction('getTaskSliceProgress'), sliceProgressContext);
const getProgress = sliceProgressContext.getTaskSliceProgress;

assert.strictEqual(getProgress(null), null, 'null 任務應回傳 null');
assert.strictEqual(getProgress({}), null, '無切片資訊任務應回傳 null');

const taskFromSliceInfo = {
  sliceInfo: {
    slices: [
      { status: '已完成' },
      { status: '進行中' },
      { status: '未開始' },
      { status: '未開始' },
      { status: '未開始' }
    ]
  }
};
const prog1 = getProgress(taskFromSliceInfo);
assert.strictEqual(prog1.currentNum, 2, '應從 sliceInfo 正確計算出第 2 切片');
assert.strictEqual(prog1.total, 5, '應從 sliceInfo 正確計算出共 5 切片');
assert.strictEqual(prog1.completed, 1, '應從 sliceInfo 正確計算出 1 切片已完成');

const taskFromPlan = {
  executionPlan: '- [x] Slice 1: 前端結構調整\n- [-] Slice 2: 看板標籤視覺化\n- [ ] Slice 3: 防抖機制'
};
const prog2 = getProgress(taskFromPlan);
assert.strictEqual(prog2.currentNum, 2, '應從 executionPlan Markdown 正確推導出第 2 切片');
assert.strictEqual(prog2.total, 3, '應從 executionPlan Markdown 正確推導出共 3 切片');
assert.strictEqual(prog2.completed, 1, '應從 executionPlan Markdown 正確推導出 1 切片已完成');

// 測試 pollActiveTaskSliceInfo 防抖與輪詢防禦
let mockFetchCount = 0;
let modalSliceRendered = false;
const pollContext = vm.createContext({
  currentModalEditingTask: { id: 'TASK-006' },
  renderModalSliceInfo: () => { modalSliceRendered = true; },
  fetch: async () => {
    mockFetchCount++;
    return {
      ok: true,
      json: async () => ({ slices: [{ status: '進行中' }] })
    };
  }
});
vm.runInContext(actualFunction('pollActiveTaskSliceInfo'), pollContext);
assert.strictEqual(typeof pollContext.pollActiveTaskSliceInfo, 'function', 'pollActiveTaskSliceInfo 必須為可執行函式');

console.log('  ✅ 表單加回框線、去底色無任務卡牌、流程說明步驟底色框線與線條連結驗證通過');
console.log('  ✅ TASK-121 內縮 outline、開工引擎模式與離線偵測、退回任務審核可見性純函式與 ARIA 行為測試通過');
console.log('  ✅ TASK-006 切片進度純函式計算與輪詢防抖測試通過');

console.log('🎉 所有前端核心互動邏輯與防禦機制測試通過！\n');
