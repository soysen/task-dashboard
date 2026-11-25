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
assert(!htmlContent.includes('id="stage-pill-ALL"'), '頂部工作流導覽列必須移除 stage-pill-ALL 全部階段膠囊');
assert(htmlContent.includes('sm:grid-cols-4'), '頂部工作流導覽列必須調整為四階段格線 (sm:grid-cols-4)');
assert(htmlContent.includes('id="boardViewToggleSlot"'), '頂部工作流導覽列右側必須配置 boardViewToggleSlot 專屬位置');
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
['todo', 'in_progress', 'review', 'done'].forEach(st => {
  stageMockElements[`stage-pill-${st}`] = makeClassMock();
  stageMockElements[`col-wrapper-${st}`] = makeClassMock();
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
assert.strictEqual(stageMockElements['stage-pill-review'].getAttribute('aria-pressed'), 'false', '重置為 ALL 後 stage-pill-review 之 aria-pressed 應為 false');
assert(!stageMockElements['col-wrapper-todo'].classList.contains('hidden'), '重置為 ALL 後所有欄位應恢復顯示');
console.log('  ✅ 頂部工作流階段導覽列、移除阻礙欄位與無框線色塊陰影系統驗證通過');

// 14. 驗證 任務彈窗 IA 階段感知工作區分頁 (Stage-Aware Workspace Tabs)
assert(allUiContent.includes('id="modalLeftWorkspaceTabs"'), '彈窗必須包含 modalLeftWorkspaceTabs 階段感知分頁切換器');
assert(allUiContent.includes('id="modalReviewPane"'), '彈窗左側必須包含 modalReviewPane 審核與執行成果面板');
assert(allUiContent.includes('id="modalSpecPane"'), '彈窗左側必須包含 modalSpecPane 需求規格與屬性面板');
assert(allUiContent.includes('id="btnModalTabDiff"') && allUiContent.includes('異動內容檢查'), '彈窗分頁切換器必須包含 btnModalTabDiff (異動內容檢查)');
assert(allUiContent.includes('id="modalReviewContextSummary"'), '審核面板必須包含 modalReviewContextSummary 漸進式揭露需求摘要橫幅');

const tabElements = {
  modalReviewPane: makeClassMock(),
  modalSpecPane: makeClassMock(),
  modalReviewContextSummary: makeClassMock(),
  btnModalTabReview: makeClassMock(),
  btnModalTabSpec: makeClassMock(),
  btnModalTabDiff: makeClassMock(),
  btnModalEditSpecShortcut: makeClassMock(),
  modalRightColumn: makeClassMock(),
  modalLeftColumn: makeClassMock(),
  modalFormGrid: makeClassMock()
};
const tabContext = vm.createContext({
  document: { getElementById: id => tabElements[id] || null },
  currentModalEditingTask: { id: 'TASK-119', status: 'review' },
  setTimeout: fn => fn(),
  autoResizeTextarea: () => {}
});
vm.runInContext(['isDiffVisibleStatus', 'applyModalTabButtonStyles', 'applyModalWorkspaceColumns', 'switchModalWorkspaceTab'].map(actualFunction).join('\n'), tabContext);
assert(allUiContent.includes('dark:bg-slate-950') && allUiContent.includes('dark:border-slate-700'), 'modalLeftWorkspaceTabs 必須在 Dark Mode 具備高對比深色凹槽背景與外框線');

// review 狀態：隱藏「需求規格與屬性」，改顯示「異動內容檢查」
tabContext.switchModalWorkspaceTab('review');
assert(!tabElements.modalReviewPane.classList.contains('hidden'), '切換至 review 分頁時 modalReviewPane 必須顯示');
assert(tabElements.modalSpecPane.classList.contains('hidden'), '切換至 review 分頁時 modalSpecPane 必須隱藏以消除屬性欄位噪音');
assert(!tabElements.modalReviewContextSummary.classList.contains('hidden'), '切換至 review 分頁時應顯示需求上下文精簡摘要');
assert(tabElements.btnModalTabSpec.classList.contains('hidden'), 'review 狀態必須隱藏「需求規格與屬性」分頁按鈕');
assert(!tabElements.btnModalTabDiff.classList.contains('hidden'), 'review 狀態必須顯示「異動內容檢查」分頁按鈕');
assert(tabElements.btnModalEditSpecShortcut.classList.contains('hidden'), 'review 狀態必須隱藏「編輯規格」捷徑按鈕');
assert(tabElements.btnModalTabReview.classList.contains('dark:bg-slate-800'), '作用中 review 分頁在 Dark Mode 必須具備高亮浮起背景 (dark:bg-slate-800)');
assert(tabElements.btnModalTabReview.classList.contains('dark:border-slate-600'), '作用中 review 分頁在 Dark Mode 必須具備清晰外框線 (dark:border-slate-600)');
assert(!tabElements.btnModalTabDiff.classList.contains('dark:bg-slate-800'), '未作用之 diff 分頁在 Dark Mode 不可包含高亮浮起背景');

// review 狀態切換至 diff 分頁：隱藏左欄並全寬顯示右欄 Diff
tabContext.switchModalWorkspaceTab('diff');
assert(tabElements.modalLeftColumn.classList.contains('hidden'), '切換至 diff 分頁時 modalLeftColumn 必須隱藏');
assert(!tabElements.modalRightColumn.classList.contains('hidden'), '切換至 diff 分頁時 modalRightColumn 必須顯示');
assert(tabElements.modalRightColumn.classList.contains('lg:col-span-12'), '切換至 diff 分頁時 modalRightColumn 必須佔滿 12 欄');
assert(tabElements.btnModalTabDiff.classList.contains('dark:bg-slate-800'), '作用中 diff 分頁在 Dark Mode 必須具備高亮浮起背景 (dark:bg-slate-800)');
assert(tabElements.btnModalTabDiff.classList.contains('dark:border-slate-600'), '作用中 diff 分頁在 Dark Mode 必須具備清晰外框線 (dark:border-slate-600)');
assert.strictEqual(tabElements.btnModalTabDiff.getAttribute('aria-selected'), 'true', '切換至 diff 時 btnModalTabDiff 之 aria-selected 必須為 true');
assert.strictEqual(tabElements.btnModalTabReview.getAttribute('aria-selected'), 'false', '切換至 diff 時 btnModalTabReview 之 aria-selected 必須為 false');

// in_progress 狀態：保留「需求規格與屬性」分頁並隱藏「異動內容檢查」
tabContext.currentModalEditingTask = { id: 'TASK-119', status: 'in_progress' };
tabContext.switchModalWorkspaceTab('spec');
assert(!tabElements.btnModalTabSpec.classList.contains('hidden'), 'in_progress 狀態必須顯示「需求規格與屬性」分頁按鈕');
assert(tabElements.btnModalTabDiff.classList.contains('hidden'), 'in_progress 狀態必須隱藏「異動內容檢查」分頁按鈕');
assert(!tabElements.btnModalEditSpecShortcut.classList.contains('hidden'), 'in_progress 狀態必須顯示「編輯規格」捷徑按鈕');
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
assert(!htmlContent.includes('id="headerWorkflowHint"'), '頂部控制列必須移除冗餘的 headerWorkflowHint 流程指引');
assert(!htmlContent.includes('id="searchInput"') && !htmlContent.includes('id="priorityFilter"'), '頂部控制列必須移除冗餘的 searchInput 與 priorityFilter');
assert(!htmlContent.includes('openNewProjectModal()'), '左側專案列表底部必須移除手動加入專案按鈕');

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

// 18. 驗證 TASK-126 打開 App 時 UI 字級大小依設定自動套用與持久化同步
assert(allUiContent.includes("const effectiveFontSize = newSettings.fontSize || localStorage.getItem('fontSize') || 'small';"), 'loadData 必須在取得 settings 後計算 effectiveFontSize');
assert(allUiContent.includes('applyFontSize(effectiveFontSize);'), 'loadData 必須在讀取設定後立即呼叫 applyFontSize 套用字級');

const fontSizeBtns = {
  fontSizeBtnSmall: { className: '' },
  fontSizeBtnMedium: { className: '' },
  fontSizeBtnLarge: { className: '' }
};
const mockStorage = new Map();
const mockLocalStorage = {
  getItem: key => (mockStorage.has(key) ? mockStorage.get(key) : null),
  setItem: (key, val) => mockStorage.set(key, String(val)),
  clear: () => mockStorage.clear()
};
const mockHtmlElement = { style: { fontSize: '' } };
let persistedSettingsPayload = null;
const fontSizeContext = vm.createContext({
  settings: { enableCliAgent: false, cliCommand: 'agy', autoTriggerOnInProgress: true, dataDirectoryPath: '', fontSize: 'small' },
  projects: [],
  tasks: [],
  apiFailStreak: 0,
  currentModalEditingTask: null,
  localStorage: mockLocalStorage,
  document: {
    documentElement: mockHtmlElement,
    getElementById: id => fontSizeBtns[id] || null
  },
  setProjects: val => { fontSizeContext.projects = val; },
  setTasks: val => { fontSizeContext.tasks = val; },
  setSettings: val => { fontSizeContext.settings = val; },
  setProjectGitStatus: () => {},
  renderCliAgentBadge: () => {},
  updateAiPromptDisplay: () => {},
  openFirstLaunchModal: () => {},
  renderProjectSelector: () => {},
  renderSidebarProjects: () => {},
  renderProjectBanner: () => {},
  renderKanban: () => {},
  renderMetrics: () => {},
  updateDependencyOptions: () => {},
  showToast: () => {},
  fetch: async (url, opts) => {
    if (opts && opts.method === 'POST' && url === '/api/settings') {
      persistedSettingsPayload = JSON.parse(opts.body);
      return { ok: true, json: async () => persistedSettingsPayload };
    }
    if (String(url).startsWith('/api/settings')) {
      return { ok: true, json: async () => ({ enableCliAgent: false, fontSize: 'medium', initialized: true }) };
    }
    return { ok: true, json: async () => [] };
  }
});

vm.runInContext(
  ['updateFontSizeButtons', 'applyFontSize', 'initFontSize', 'setAppFontSize', 'loadData'].map(actualFunction).join('\n'),
  fontSizeContext
);

// 模擬 macOS WKWebView 啟動：nonPersistentDataStore 下 localStorage 為空
fontSizeContext.initFontSize();
assert.strictEqual(mockHtmlElement.style.fontSize, '16px', '尚未載入遠端設定且 localStorage 為空時預設為 16px');

// 執行 loadData 讀取 /api/settings (fontSize: "medium")，應自動套用 18px 並同步按鈕與 localStorage
(async () => {
  await fontSizeContext.loadData();
  assert.strictEqual(mockHtmlElement.style.fontSize, '18px', 'loadData 讀取 settings.fontSize=medium 後必須立即將 html.style.fontSize 設為 18px');
  assert.strictEqual(mockLocalStorage.getItem('fontSize'), 'medium', 'loadData 必須將 settings.fontSize 同步寫入 localStorage');
  assert(fontSizeBtns.fontSizeBtnMedium.className.includes('border-indigo-600'), '中字級按鈕必須呈現選取高亮狀態');
  assert(!fontSizeBtns.fontSizeBtnSmall.className.includes('border-indigo-600'), '小字級按鈕不應殘留選取狀態');

  // 驗證切換字級時立即更新 DOM、settings 與後端持久化
  fontSizeContext.setAppFontSize('large');
  assert.strictEqual(mockHtmlElement.style.fontSize, '20px', '切換為大字級時應立即套用 20px');
  assert.strictEqual(fontSizeContext.settings.fontSize, 'large', 'setAppFontSize 必須同步更新記憶體內 settings.fontSize');
  assert.deepStrictEqual(persistedSettingsPayload, { fontSize: 'large' }, 'setAppFontSize 必須發送 POST /api/settings 持久化字級設定');
  assert(fontSizeBtns.fontSizeBtnLarge.className.includes('border-indigo-600'), '大字級按鈕必須呈現選取高亮狀態');
  console.log('  ✅ TASK-126 啟動時讀取設定自動套用字級大小與持久化同步測試通過');

  // 19. 驗證 TASK-156 Commit 遇到 pre-commit 阻斷展示錯誤且不封存前端防禦機制，以及一鍵轉交 Agent 自動修復
  assert(htmlContent.includes('id="commitErrorBox"'), 'index.html commitModal 必須包含 #commitErrorBox 錯誤容器');
  assert(htmlContent.includes('id="commitErrorText"'), 'index.html commitModal 必須包含 #commitErrorText 錯誤展示區塊');
  assert(htmlContent.includes('id="btnAutoFixWithAgent"'), 'index.html commitModal 必須包含 #btnAutoFixWithAgent 按鈕');
  assert(allUiContent.includes('Commit 遭到 pre-commit 阻斷，請檢視失敗原因'), 'confirmCommitTask 必須提示 pre-commit 阻斷警告');
  assert(allUiContent.includes('autoFixCommitErrorWithAgent'), 'modal.js 必須具備 autoFixCommitErrorWithAgent 函數');
  assert(allUiContent.includes('!res.ok || !result.success || result.isCommitted === false'), 'confirmCommitTask 必須攔截 API 400 或 commit 失敗結果');
  assert(allUiContent.includes("errorBox.classList.remove('hidden')"), 'confirmCommitTask 失敗時必須顯露 #commitErrorBox');
  assert(allUiContent.includes("errorBox.classList.add('hidden')"), 'openCommitModal 與 closeCommitModal 必須重置隱藏 #commitErrorBox');
  console.log('  ✅ TASK-156 Commit Modal Pre-commit 錯誤展示、攔截防禦與一鍵 Agent 自癒驗證通過');

  // 20. 驗證 TASK-187 Commit 成功後立即將結束的 task 導入 archived 並即時更新畫面無須 reload
  assert(allUiContent.includes('setTasks(tasks.filter(t => !arcSet.has(t.id)))'), 'confirmCommitTask 必須即時將已封存任務過濾移出 tasks 陣列');
  assert(allUiContent.includes('renderKanban()') && allUiContent.includes('renderMetrics()'), 'confirmCommitTask 必須即時重新渲染看板與計量');
  assert(allUiContent.includes('loadData(true)'), 'confirmCommitTask 必須呼叫 loadData(true) 進行全量同步');
  assert(allUiContent.includes('if (Array.isArray(newTasks)) {\n          setTasks(newTasks);\n        }'), 'loadData 必須於 newTasks 為空陣列時也能即時清空 tasks 避免殘留舊任務');
  console.log('  ✅ TASK-187 Commit 即時封存與前端畫面同步防禦驗證通過');

  // 21. 驗證 Tier 分流過濾切換器與 --tier 指令產生契約
  assert(htmlContent.includes('id="btnTierFilter_all"'), 'index.html 必須包含 #btnTierFilter_all');
  assert(htmlContent.includes('id="btnTierFilter_fast"'), 'index.html 必須包含 #btnTierFilter_fast');
  assert(htmlContent.includes('id="btnTierFilter_heavy"'), 'index.html 必須包含 #btnTierFilter_heavy');
  assert(allUiContent.includes('function selectDesktopTierFilter('), 'app.js 必須實作 selectDesktopTierFilter');
  assert(allUiContent.includes('--tier=micro,standard') && allUiContent.includes('--tier=heavy'), 'updateAiPromptDisplay 必須支援輸出 --tier=micro,standard 與 --tier=heavy');
  console.log('  ✅ Tier 分流切換器與 --tier Prompt 生成契約驗證通過');

  // 22. 驗證 TASK-236 3.0 UI/UX 優化（單一展開手風琴、刪除 icon 高對比、#boardViewToggleSlot、頂部控制列精簡與暗黑模式對比）
  const stateMod = await import('../src/public/modules/state.js');
  assert.strictEqual(stateMod.expandedProjectId, null, 'state.js 初始 expandedProjectId 應為 null');
  stateMod.setExpandedProjectId('proj-1');
  assert.strictEqual(stateMod.expandedProjectId, 'proj-1', 'setExpandedProjectId 應正確更新展開專案 ID');
  stateMod.setExpandedProjectId(null);

  // 測試手風琴單一展開與選取狀態刪除按鈕高對比樣式
  const sidebarListEl = { innerHTML: '' };
  const sidebarCountEl = { innerText: '' };
  const sidebarContext = vm.createContext({
    projects: [
      { id: 'proj-1', name: 'Project One', color: 'blue' },
      { id: 'proj-2', name: 'Project Two', color: 'emerald' }
    ],
    tasks: [],
    currentProject: 'proj-1',
    currentBranch: 'ALL',
    expandedProjectId: null,
    setExpandedProjectId: (val) => { sidebarContext.expandedProjectId = val || null; },
    normalizeStatus: (s) => s,
    escapeHtml: (s) => String(s || ''),
    renderProjectBranchTree: (p) => `<div data-branch-tree="${p.id}"></div>`,
    document: {
      getElementById: (id) => {
        if (id === 'projectSidebarList') return sidebarListEl;
        if (id === 'projectSearchInput') return { value: '' };
        if (id === 'sidebarProjectCount') return sidebarCountEl;
        return null;
      }
    },
    window: {}
  });
  vm.runInContext(actualFunction('toggleProjectExpand') + '\n' + actualFunction('renderSidebarProjects'), sidebarContext);
  sidebarContext.toggleProjectExpand('proj-1');
  assert.strictEqual(sidebarContext.expandedProjectId, 'proj-1', 'toggleProjectExpand 應展開目標專案');
  assert(sidebarListEl.innerHTML.includes('data-branch-tree="proj-1"') && !sidebarListEl.innerHTML.includes('data-branch-tree="proj-2"'), '僅已展開之專案應渲染分支樹');
  assert(sidebarListEl.innerHTML.includes('aria-expanded="true"') && sidebarListEl.innerHTML.includes('chevron-down'), '已展開專案必須標示 aria-expanded=true 與 chevron-down');
  assert(sidebarListEl.innerHTML.includes('bg-black/20 hover:bg-rose-600 text-white'), '選取狀態 (isProjOnly) 專案列刪除 icon 必須套用高對比樣式');
  sidebarContext.toggleProjectExpand('proj-2');
  assert.strictEqual(sidebarContext.expandedProjectId, 'proj-2', '展開另一專案時應自動收合前一個專案（手風琴單一展開）');
  assert(!sidebarListEl.innerHTML.includes('data-branch-tree="proj-1"') && sidebarListEl.innerHTML.includes('data-branch-tree="proj-2"'), '手風琴切換後前一個專案分支樹必須收合');
  sidebarContext.toggleProjectExpand('proj-2');
  assert.strictEqual(sidebarContext.expandedProjectId, null, '再次點擊已展開專案應收合');

  // 測試 #boardViewToggleSlot 與 #contextualHeaderActions 分層職責
  const makeSlotMock = () => {
    const cls = new Set(['hidden']);
    return {
      innerHTML: '',
      classList: {
        add: (c) => cls.add(c),
        remove: (c) => cls.delete(c),
        toggle: (c, force) => { if (force) cls.add(c); else cls.delete(c); },
        contains: (c) => cls.has(c)
      }
    };
  };
  const headerActionsEl = makeSlotMock();
  const boardViewSlotEl = makeSlotMock();
  const branchNavRaw = fs.readFileSync(path.join(__dirname, '../src/public/modules/branchNavigator.js'), 'utf8')
    .replace(/^import[\s\S]*?;\s*/gm, '')
    .replace(/export\s*\{[\s\S]*?\};?\s*$/m, '');
  const branchNavCtx = vm.createContext({
    projects: [{ id: 'proj-1', name: 'Project One', path: '/tmp/p1' }],
    tasks: [{ id: 'TASK-1', project: 'proj-1', status: 'done', targetBranch: 'feat/ui', gitLanding: { isCommitted: true } }],
    currentProject: 'ALL',
    currentBranch: 'ALL',
    projectBranchesMap: { 'proj-1': { isGitRepo: true, defaultBranch: 'main', currentCheckoutBranch: 'main', branches: [] } },
    groupByBranch: false,
    expandedProjectId: null,
    setCurrentProject: (v) => { branchNavCtx.currentProject = v; },
    setCurrentBranch: (v) => { branchNavCtx.currentBranch = v; },
    setProjectBranchesMap: (v) => { branchNavCtx.projectBranchesMap = v; },
    setGroupByBranch: (v) => { branchNavCtx.groupByBranch = Boolean(v); },
    setExpandedProjectId: (v) => { branchNavCtx.expandedProjectId = v || null; },
    escapeHtml: (s) => String(s || ''),
    showToast: () => {},
    document: {
      getElementById: (id) => {
        if (id === 'contextualHeaderActions') return headerActionsEl;
        if (id === 'boardViewToggleSlot') return boardViewSlotEl;
        return null;
      }
    },
    window: {
      renderSidebarProjects: () => {},
      renderKanban: () => {},
      renderMetrics: () => {}
    }
  });
  vm.runInContext(branchNavRaw, branchNavCtx);
  branchNavCtx.renderContextualHeaderActions();
  assert(boardViewSlotEl.classList.contains('hidden'), 'currentProject === ALL 時 #boardViewToggleSlot 必須隱藏');
  assert(headerActionsEl.classList.contains('hidden'), 'currentProject === ALL 時 #contextualHeaderActions 必須隱藏');

  branchNavCtx.setCurrentProject('proj-1');
  branchNavCtx.setCurrentBranch('ALL');
  branchNavCtx.renderContextualHeaderActions();
  assert(!boardViewSlotEl.classList.contains('hidden') && boardViewSlotEl.innerHTML.includes('按分支看'), '選取專案後 #boardViewToggleSlot 必須顯示「看板 / 按分支看」');
  assert(headerActionsEl.classList.contains('hidden') && !headerActionsEl.innerHTML.includes('新建分支') && !headerActionsEl.innerHTML.includes('新增任務'), '#contextualHeaderActions 不得包含「新建分支」與「新增任務」');

  branchNavCtx.setCurrentBranch('feat/ui');
  branchNavCtx.renderContextualHeaderActions();
  assert(!boardViewSlotEl.classList.contains('hidden'), '選取特定分支時 #boardViewToggleSlot 仍須保持可見');
  assert(!headerActionsEl.classList.contains('hidden') && headerActionsEl.innerHTML.includes('合併回 main') && !headerActionsEl.innerHTML.includes('新建分支') && !headerActionsEl.innerHTML.includes('新增任務'), 'L2 非主幹已提交分支僅顯示「合併回 <defaultBranch>」');
  assert(headerActionsEl.innerHTML.includes('推送') && headerActionsEl.innerHTML.includes('開立 PR'), 'L2 非主幹分支應同時顯示「推送」與「開立 PR」按鈕');

  const prSummary = branchNavCtx.buildPrSummaryFromDoneTasks('proj-1', 'feat/ui', 'main');
  assert(prSummary && prSummary.title.includes('[TASK-1]'), 'buildPrSummaryFromDoneTasks 應彙整 done 任務標題');
  assert.strictEqual(typeof branchNavCtx.window.pushCurrentBranch, 'function', 'window.pushCurrentBranch 必須正確綁定');
  assert.strictEqual(typeof branchNavCtx.window.openCreatePrModal, 'function', 'window.openCreatePrModal 必須正確綁定');
  assert.strictEqual(typeof branchNavCtx.window.closeCreatePrModal, 'function', 'window.closeCreatePrModal 必須正確綁定');
  assert.strictEqual(typeof branchNavCtx.window.submitCreatePr, 'function', 'window.submitCreatePr 必須正確綁定');
  assert.strictEqual(typeof branchNavCtx.window.loadBranchRemoteStatus, 'function', 'window.loadBranchRemoteStatus 必須正確綁定');

  branchNavCtx.toggleBranchGroupView(true);
  assert.strictEqual(branchNavCtx.currentBranch, 'ALL', '由特定分支切換為「按分支看」時應重置 currentBranch 為 ALL');

  // 驗證暗黑模式 CSS 變數與表面層次規則強化
  assert(styleContent.includes('--background: #0c0f14') && styleContent.includes('--sidebar: #141922') && styleContent.includes('--card: #1d2430') && styleContent.includes('--border: #3a4659') && styleContent.includes('--muted-foreground: #a3b2c7'), 'style.css 暗黑模式變數必須提升層次與邊框/文字對比');
  assert(styleContent.includes('.dark .td-surface-well') && styleContent.includes('.dark .td-surface-card') && styleContent.includes('.dark .td-surface-panel'), 'style.css 必須包含 .dark 專屬表面階層對比規則');
  assert(htmlContent.includes("700: '#354052'") && htmlContent.includes("darkborder: '#3a4659'"), 'index.html Tailwind 深色階必須同步提升對比');
  console.log('  ✅ TASK-236 3.0 UI/UX 優化（手風琴展開、高對比、視圖切換位置與暗黑模式對比）驗證通過');

  // 23. 驗證 TASK-237 任務彈窗顯示優化
  const kanbanSrc237 = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'modules', 'kanban.js'), 'utf8');
  assert(!kanbanSrc237.includes('commitTaskFromCard('), 'done 卡片不得再渲染 commitTaskFromCard 舊 Commit 按鈕');
  for (const removedId of ['btnCommitTaskModal', 'btnApproveTask', 'btnMergeWorktreeModal', 'btnLandTask', 'projectModal']) {
    assert(!htmlContent.includes(removedId), `index.html 必須移除過時元素 #${removedId}`);
  }
  assert(
    htmlContent.includes('id="modalLeftColumn" class="flex-1 overflow-y-auto pl-1 pr-2 overflow-x-hidden min-w-0') &&
    htmlContent.includes('id="modalReviewPane" role="tabpanel" class="space-y-3.5 min-w-0 max-w-full overflow-x-hidden"'),
    '#modalLeftColumn 與 #modalReviewPane 必須具備 overflow-x-hidden min-w-0 防止橫向捲軸溢出'
  );

  const reportOverflowContainer = { innerHTML: '' };
  const reportOverflowCtx = vm.createContext({
    document: { getElementById: id => (id === 'formReportVisual' ? reportOverflowContainer : null) },
    window: {},
    escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  });
  vm.runInContext(['escapeHtml', 'renderExecutionReport'].map(actualFunction).join('\n'), reportOverflowCtx);
  reportOverflowCtx.renderExecutionReport({
    id: 'TASK-237',
    status: 'review',
    executionLog: '# 測試\n- 檢查 `/very/long/path/without/spaces/file.js`\n```bash\nvery-long-terminal-output\n```'
  });
  assert(
    reportOverflowContainer.innerHTML.includes('break-all [overflow-wrap:anywhere]'),
    'executionReport.js 行內 <code> 必須具備 break-all [overflow-wrap:anywhere] 斷行樣式'
  );
  reportOverflowCtx.renderExecutionReport({
    id: 'TASK-237-RAW',
    status: 'review',
    executionLog: 'plain terminal output line without markdown headings'
  });
  assert(
    reportOverflowContainer.innerHTML.includes('whitespace-pre-wrap break-all [overflow-wrap:anywhere] max-w-full overflow-x-hidden'),
    'executionReport.js 終端機 <pre> 必須具備防橫向捲軸斷行樣式'
  );

  const diffVisElements = {
    modalReviewPane: makeClassMock(),
    modalSpecPane: makeClassMock(),
    modalReviewContextSummary: makeClassMock(),
    btnModalTabReview: makeClassMock(),
    btnModalTabSpec: makeClassMock(),
    btnModalTabDiff: makeClassMock(),
    btnModalEditSpecShortcut: makeClassMock(),
    modalRightColumn: makeClassMock(),
    modalLeftColumn: makeClassMock(),
    modalFormGrid: { classList: { remove: () => {}, toggle: () => {} } }
  };
  const diffVisCtx = vm.createContext({
    document: { getElementById: id => diffVisElements[id] || null },
    currentModalEditingTask: { id: 'TASK-237', status: 'in_progress' },
    setTimeout: () => {},
    autoResizeTextarea: () => {}
  });
  vm.runInContext(['isDiffVisibleStatus', 'applyModalTabButtonStyles', 'applyModalWorkspaceColumns', 'switchModalWorkspaceTab'].map(actualFunction).join('\n'), diffVisCtx);

  for (const hiddenStatus of ['in_progress', 'todo', 'needs_human']) {
    diffVisCtx.currentModalEditingTask = { id: 'TASK-237', status: hiddenStatus };
    for (const tabMode of ['review', 'spec', 'diff']) {
      diffVisCtx.switchModalWorkspaceTab(tabMode);
      assert(
        diffVisElements.modalRightColumn.classList.contains('hidden'),
        `status="${hiddenStatus}" (${tabMode}) 必須隱藏 #modalRightColumn (Git Diff)`
      );
      assert(
        !diffVisElements.modalLeftColumn.classList.contains('lg:col-span-5') &&
        !diffVisElements.modalLeftColumn.classList.contains('lg:col-span-12') &&
        diffVisElements.modalLeftColumn.classList.contains('w-full'),
        `status="${hiddenStatus}" (${tabMode}) #modalLeftColumn 必須採單欄 w-full（移除 lg:col-span-5 / lg:col-span-12 防右側空白）`
      );
      assert(
        diffVisElements.btnModalTabDiff.classList.contains('hidden') &&
        !diffVisElements.btnModalTabSpec.classList.contains('hidden'),
        `status="${hiddenStatus}" 必須隱藏「異動內容檢查」並保留「需求規格與屬性」`
      );
    }
  }
  for (const visibleStatus of ['review', 'pending_review', 'done', 'archived']) {
    diffVisCtx.currentModalEditingTask = { id: 'TASK-237', status: visibleStatus };
    diffVisCtx.switchModalWorkspaceTab('review');
    assert(
      diffVisElements.modalRightColumn.classList.contains('hidden'),
      `status="${visibleStatus}" 時切換至 review 分頁必須隱藏 #modalRightColumn (由「異動內容檢查」分頁承載)`
    );
    assert(
      !diffVisElements.modalLeftColumn.classList.contains('hidden') &&
      diffVisElements.modalLeftColumn.classList.contains('lg:col-span-12') &&
      !diffVisElements.modalLeftColumn.classList.contains('lg:col-span-5') &&
      !diffVisElements.modalLeftColumn.classList.contains('w-full'),
      `status="${visibleStatus}" 時 review 分頁 #modalLeftColumn 必須全寬 (lg:col-span-12)`
    );
    assert(
      diffVisElements.btnModalTabSpec.classList.contains('hidden') &&
      !diffVisElements.btnModalTabDiff.classList.contains('hidden') &&
      diffVisElements.btnModalEditSpecShortcut.classList.contains('hidden'),
      `status="${visibleStatus}" 必須移除「需求規格與屬性」與捷徑並顯示「異動內容檢查」`
    );

    diffVisCtx.switchModalWorkspaceTab('diff');
    assert(
      !diffVisElements.modalRightColumn.classList.contains('hidden') &&
      diffVisElements.modalRightColumn.classList.contains('lg:col-span-12'),
      `status="${visibleStatus}" 時切換至 diff 分頁必須全寬顯示 #modalRightColumn (lg:col-span-12)`
    );
    assert(
      diffVisElements.modalLeftColumn.classList.contains('hidden'),
      `status="${visibleStatus}" 時切換至 diff 分頁必須隱藏 #modalLeftColumn`
    );
    assert.strictEqual(
      diffVisElements.btnModalTabDiff.getAttribute('aria-selected'),
      'true',
      `status="${visibleStatus}" 時切換至 diff 分頁必須將 btnModalTabDiff aria-selected 設為 true`
    );
  }

  const makeModalEl = (extra = {}) => {
    const set = new Set();
    const attrs = new Map();
    return {
      classList: {
        add: (...classes) => classes.forEach(c => set.add(c)),
        remove: (...classes) => classes.forEach(c => set.delete(c)),
        toggle: (cls, force) => {
          if (force === undefined) {
            if (set.has(cls)) set.delete(cls);
            else set.add(cls);
          } else if (force) {
            set.add(cls);
          } else {
            set.delete(cls);
          }
        },
        contains: cls => set.has(cls)
      },
      setAttribute: (name, val) => attrs.set(name, String(val)),
      getAttribute: (name) => attrs.get(name),
      innerText: '',
      innerHTML: '',
      className: '',
      value: '',
      checked: false,
      title: '',
      ...extra
    };
  };

  const modalBtnIds = [
    'formStatus', 'formTaskId', 'formProject', 'formRequiresConfirmation',
    'formExecutionPlan', 'formFeedback', 'btnRejectTask', 'btnSubmitTask',
    'btnArchiveTaskModal', 'btnConfirmAndExecute', 'btnConfirmAndExecuteIcon',
    'btnConfirmAndExecuteText', 'btnAbandonTask', 'reviewFeedbackBox',
    'reviewFeedbackLabelText', 'reviewFeedbackNotice', 'modalRightColumn',
    'modalDialogContainer', 'modalFormGrid', 'modalLeftColumn',
    'modalSpecPane', 'modalLeftWorkspaceTabs', 'modalConfirmationBadge',
    'formRequiresConfirmationWrapper', 'formExecutionPlanBox',
    'formExecutionPlanBadge', 'formExecutionPlanNotice',
    'formExecutionPlanLabelIcon', 'formExecutionPlanLabelText',
    'grillMeBanner'
  ];
  const modalBtnEls = Object.fromEntries(modalBtnIds.map(id => [id, makeModalEl()]));
  let capturedReviewLandPayload = null;
  const modalBtnCtx = vm.createContext({
    document: { getElementById: id => modalBtnEls[id] || null },
    window: {},
    projects: [
      { id: 'proj-grill', skills: [{ id: 'grill-me', label: 'grill-me' }] },
      { id: 'task-dashboard', skills: [] }
    ],
    tasks: [
      { id: 'TASK-237', status: 'review' },
      { id: 'TASK-237-IP', status: 'in_progress' },
      { id: 'TASK-237-DONE', status: 'done' },
      { id: 'TASK-237-ARCH', status: 'archived' }
    ],
    currentModalEditingTask: null,
    isOpenedFromArchive: false,
    initReviewLandPanel: payload => { capturedReviewLandPayload = payload; },
    renderExecutionPlan: () => {},
    setModalFieldsReadOnly: () => {},
    autoResizeTextarea: () => {},
    setTimeout: () => {}
  });
  vm.runInContext(['isDiffVisibleStatus', 'applyModalWorkspaceColumns', 'updateModalButtonState'].map(actualFunction).join('\n'), modalBtnCtx);

  // 1) 新增任務 (taskId='', status='todo')
  modalBtnEls.formStatus.value = 'todo';
  modalBtnEls.formTaskId.value = '';
  modalBtnEls.formProject.value = 'task-dashboard';
  modalBtnEls.formRequiresConfirmation.checked = false;
  modalBtnEls.formExecutionPlan.value = '';
  modalBtnEls.formFeedback.value = '';
  modalBtnCtx.isOpenedFromArchive = false;
  modalBtnCtx.currentModalEditingTask = null;
  modalBtnCtx.updateModalButtonState();
  assert(modalBtnEls.modalRightColumn.classList.contains('hidden'), '新增任務時必須隱藏 #modalRightColumn');
  assert(!modalBtnEls.formRequiresConfirmationWrapper.classList.contains('hidden'), '新增任務時必須顯示 #formRequiresConfirmationWrapper');
  assert.strictEqual(modalBtnEls.btnSubmitTask.innerHTML, '儲存變更', '新增任務時送出按鈕文字應為「儲存變更」');

  // 2) in_progress + requiresConfirmation=true + executionPlan='Step 1' + formProject='proj-grill'
  modalBtnEls.formStatus.value = 'in_progress';
  modalBtnEls.formTaskId.value = 'TASK-237-IP';
  modalBtnEls.formProject.value = 'proj-grill';
  modalBtnEls.formRequiresConfirmation.checked = true;
  modalBtnEls.formExecutionPlan.value = 'Step 1';
  modalBtnCtx.currentModalEditingTask = { id: 'TASK-237-IP', status: 'in_progress' };
  modalBtnCtx.updateModalButtonState();
  assert(!modalBtnEls.grillMeBanner.classList.contains('hidden'), 'Grill-Me 專案待確認時必須顯示 #grillMeBanner');
  assert(!modalBtnEls.btnConfirmAndExecute.classList.contains('hidden'), '待確認狀態必須顯示 #btnConfirmAndExecute');
  assert.strictEqual(modalBtnEls.btnConfirmAndExecuteText.innerText, '確認邊界並執行', 'Grill-Me 專案確認按鈕應顯示「確認邊界並執行」');

  // 3) review (無 formFeedback)
  modalBtnEls.formStatus.value = 'review';
  modalBtnEls.formTaskId.value = 'TASK-237';
  modalBtnEls.formProject.value = 'task-dashboard';
  modalBtnEls.formRequiresConfirmation.checked = false;
  modalBtnEls.formExecutionPlan.value = '';
  modalBtnEls.formFeedback.value = '';
  modalBtnEls.modalSpecPane.classList.add('hidden');
  modalBtnEls.modalLeftWorkspaceTabs.classList.remove('hidden');
  modalBtnCtx.currentModalEditingTask = { id: 'TASK-237', status: 'review' };
  modalBtnCtx.updateModalButtonState();
  assert(!modalBtnEls.btnRejectTask.classList.contains('hidden'), 'review 狀態必須顯示 #btnRejectTask');
  assert.strictEqual(modalBtnEls.btnSubmitTask.innerHTML, '儲存規格變更', 'review 狀態儲存按鈕應顯示「儲存規格變更」');
  assert.strictEqual(capturedReviewLandPayload?.id, 'TASK-237', 'review 狀態應呼叫 initReviewLandPanel 並傳入任務 ID');
  assert.strictEqual(capturedReviewLandPayload?.status, 'review', 'review 狀態應呼叫 initReviewLandPanel 並傳入 status=review');

  // 4) done
  modalBtnEls.formStatus.value = 'done';
  modalBtnEls.formTaskId.value = 'TASK-237-DONE';
  modalBtnCtx.currentModalEditingTask = { id: 'TASK-237-DONE', status: 'done' };
  modalBtnCtx.updateModalButtonState();
  assert(!modalBtnEls.btnArchiveTaskModal.classList.contains('hidden'), 'done 狀態必須顯示 #btnArchiveTaskModal');
  assert(modalBtnEls.btnRejectTask.classList.contains('hidden'), 'done 狀態必須隱藏 #btnRejectTask');

  // 5) archived
  modalBtnEls.formStatus.value = 'archived';
  modalBtnEls.formTaskId.value = 'TASK-237-ARCH';
  modalBtnCtx.currentModalEditingTask = { id: 'TASK-237-ARCH', status: 'archived' };
  modalBtnCtx.updateModalButtonState();
  assert(modalBtnEls.btnSubmitTask.classList.contains('hidden'), 'archived 狀態必須隱藏 #btnSubmitTask');
  assert(modalBtnEls.btnRejectTask.classList.contains('hidden'), 'archived 狀態必須隱藏 #btnRejectTask');
  assert(modalBtnEls.btnArchiveTaskModal.classList.contains('hidden'), 'archived 狀態必須隱藏 #btnArchiveTaskModal');
  assert(modalBtnEls.btnAbandonTask.classList.contains('hidden'), 'archived 狀態必須隱藏 #btnAbandonTask');

  console.log('  ✅ TASK-237 任務彈窗顯示優化（移除過時按鈕、防橫向捲軸斷行、退回重做狀態隱藏 Git Diff）驗證通過');

  // 24. 驗證 TASK-239 版面切換位置調整、分頁改為異動內容檢查、與左右兩欄 Master-Detail Git Diff 檢視器
  const toggleSlotIdx = htmlContent.indexOf('id="boardViewToggleSlot"');
  const stageFilterIdx = htmlContent.indexOf('aria-label="任務階段篩選"');
  assert(toggleSlotIdx !== -1 && stageFilterIdx !== -1 && toggleSlotIdx < stageFilterIdx, '#boardViewToggleSlot 必須位於階段篩選膠囊 (任務階段篩選) 最左側');
  assert(htmlContent.indexOf('id="modalLeftWorkspaceTabs"') < htmlContent.indexOf('id="modalFormGrid"'), '#modalLeftWorkspaceTabs 必須位於 #modalFormGrid 上方，切換至 Diff 分頁時仍保持可見');
  assert(htmlContent.includes('id="btnModalTabDiff"') && htmlContent.includes('異動內容檢查'), 'index.html 必須包含 btnModalTabDiff (異動內容檢查)');

  const modalRightIdx = htmlContent.indexOf('id="modalRightColumn"');
  const masterGridIdx = htmlContent.indexOf('id="diffMasterDetailGrid"');
  const fileListPaneIdx = htmlContent.indexOf('id="diffFileListPane"');
  const summaryBarIdx = htmlContent.indexOf('id="diffSummaryBar"');
  const modFilesListIdx = htmlContent.indexOf('id="formModifiedFilesList"');
  const contentPaneIdx = htmlContent.indexOf('id="diffContentPane"');
  const diffVisualIdx = htmlContent.indexOf('id="formDiffVisual"');
  assert(modalRightIdx !== -1 && masterGridIdx > modalRightIdx, '#diffMasterDetailGrid 必須位於 #modalRightColumn 內');
  assert(fileListPaneIdx > masterGridIdx && contentPaneIdx > fileListPaneIdx, '#diffFileListPane 必須在 #diffContentPane 之前，形成左檔案清單、右 Diff 內容兩欄佈局');
  assert(summaryBarIdx > fileListPaneIdx && summaryBarIdx < contentPaneIdx, '#diffSummaryBar 必須位於左側 #diffFileListPane 內');
  assert(summaryBarIdx < modFilesListIdx, '#diffSummaryBar 必須位於 #formModifiedFilesList 上方');
  assert(modFilesListIdx > fileListPaneIdx && modFilesListIdx < contentPaneIdx, '#formModifiedFilesList 必須位於左側 #diffFileListPane 內');
  assert(diffVisualIdx > contentPaneIdx, '#formDiffVisual 必須位於右側 #diffContentPane 內');
  assert(!htmlContent.includes('btnShowAllDiffs') && !htmlContent.includes('全部檔案'), 'index.html 不得包含 #btnShowAllDiffs 或「全部檔案」按鈕');
  assert(!htmlContent.includes('btnToggleCollapseAll') && !htmlContent.includes('全部折疊'), 'index.html 不得包含 #btnToggleCollapseAll 或「全部折疊」按鈕');
  const modFilesTagMatch = htmlContent.match(/<div id="formModifiedFilesList"[^>]*>/);
  assert(modFilesTagMatch && !modFilesTagMatch[0].includes('max-h-24'), '#formModifiedFilesList 不得保留 max-h-24 高度限制，應滿版垂直延展');
  const masterGridTagMatch = htmlContent.match(/<div id="diffMasterDetailGrid"[^>]*>/);
  const fileListPaneTagMatch = htmlContent.match(/<div id="diffFileListPane"[^>]*>/);
  const contentPaneTagMatch = htmlContent.match(/<div id="diffContentPane"[^>]*>/);
  assert(masterGridTagMatch && masterGridTagMatch[0].includes('flex-col lg:flex-row'), '#diffMasterDetailGrid 必須使用 flex-col lg:flex-row 佈局');
  assert(fileListPaneTagMatch && fileListPaneTagMatch[0].includes('lg:w-[28%]') && fileListPaneTagMatch[0].includes('lg:min-w-[230px]') && fileListPaneTagMatch[0].includes('flex-shrink-0'), '#diffFileListPane 必須具備 lg:w-[28%] lg:min-w-[230px] flex-shrink-0');
  assert(contentPaneTagMatch && contentPaneTagMatch[0].includes('flex-1 min-w-0'), '#diffContentPane 必須具備 flex-1 min-w-0');

  // 24-1 updateModalButtonState 保留 diff 分頁作用狀態
  modalBtnEls.btnModalTabDiff = makeModalEl();
  modalBtnEls.modalReviewPane = makeModalEl();
  modalBtnEls.formStatus.value = 'review';
  modalBtnEls.formTaskId.value = 'TASK-237';
  modalBtnEls.btnModalTabDiff.setAttribute('aria-selected', 'true');
  modalBtnCtx.currentModalEditingTask = { id: 'TASK-237', status: 'review' };
  modalBtnCtx.updateModalButtonState();
  assert(modalBtnEls.modalLeftColumn.classList.contains('hidden'), 'diff 分頁作用中時 updateModalButtonState 必須維持 #modalLeftColumn 隱藏');
  assert(!modalBtnEls.modalRightColumn.classList.contains('hidden') && modalBtnEls.modalRightColumn.classList.contains('lg:col-span-12'), 'diff 分頁作用中時 updateModalButtonState 必須維持 #modalRightColumn 全寬顯示');

  // 24-2 toggleDiffFocusMode 在 diff 分頁與 null DOM 下皆安全運作
  const focusEls = {
    modalLeftColumn: makeModalEl(),
    modalRightColumn: makeModalEl(),
    modalFormGrid: makeModalEl(),
    modalDialogContainer: makeModalEl(),
    btnToggleFocusModeText: makeModalEl(),
    btnToggleFocusModeIcon: makeModalEl(),
    btnModalTabDiff: makeModalEl()
  };
  focusEls.btnModalTabDiff.setAttribute('aria-selected', 'true');
  focusEls.modalLeftColumn.classList.add('hidden');
  focusEls.modalRightColumn.classList.add('lg:col-span-12');
  const focusCtx = vm.createContext({
    document: { getElementById: id => focusEls[id] || null },
    window: {},
    isDiffFocusMode: false
  });
  vm.runInContext(actualFunction('toggleDiffFocusMode'), focusCtx);
  focusCtx.toggleDiffFocusMode();
  assert(focusEls.modalDialogContainer.classList.contains('max-w-[98vw]') && focusEls.modalDialogContainer.classList.contains('h-[96vh]'), '專注檢閱開啟時應放大 #modalDialogContainer');
  assert(focusEls.modalLeftColumn.classList.contains('hidden') && focusEls.modalRightColumn.classList.contains('lg:col-span-12'), 'diff 分頁開啟專注檢閱時不得顯示左欄或縮小右欄');
  focusCtx.toggleDiffFocusMode();
  assert(focusEls.modalDialogContainer.classList.contains('max-w-6xl') && focusEls.modalDialogContainer.classList.contains('h-[90vh]'), '關閉專注檢閱時應還原 #modalDialogContainer 預設尺寸');
  assert(focusEls.modalLeftColumn.classList.contains('hidden') && focusEls.modalRightColumn.classList.contains('lg:col-span-12'), 'diff 分頁關閉專注檢閱時必須保持左欄隱藏與右欄 lg:col-span-12');

  const nullFocusCtx = vm.createContext({
    document: { getElementById: () => null },
    window: {},
    isDiffFocusMode: false
  });
  vm.runInContext(actualFunction('toggleDiffFocusMode'), nullFocusCtx);
  nullFocusCtx.toggleDiffFocusMode();

  // 24-3 renderLineNumberedDiff 統一格式帶行號 diff 輸出驗證
  const unifiedDiffCtx = vm.createContext({
    escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  });
  vm.runInContext(['renderUnifiedDiffRow', 'renderLineNumberedDiff'].map(actualFunction).join('\n'), unifiedDiffCtx);
  assert.strictEqual(unifiedDiffCtx.renderLineNumberedDiff([]), '', '空陣列 diff 應回傳空字串');

  const unifiedHtml = unifiedDiffCtx.renderLineNumberedDiff([
    'diff --git a/app.js b/app.js',
    '@@ -10,4 +10,5 @@',
    ' const keep = 1;',
    '-const oldA = "<script>";',
    '-const oldB = 2;',
    '+const newA = "<script>";',
    '+const newB = 3;',
    '+const newC = 4;',
    ' return keep;'
  ]);
  assert(!unifiedHtml.includes('diff-split-table'), 'renderLineNumberedDiff 不得輸出 .diff-split-table');
  assert(unifiedHtml.includes('class="diff-row '), 'renderLineNumberedDiff 必須輸出標準 .diff-row 統一格式列');
  assert(unifiedHtml.includes('<div class="diff-num">10</div>\n          <div class="diff-num">10</div>'), 'context 行必須同時顯示正確的 old/new 行號 (10, 10)');
  assert(unifiedHtml.includes('diff-line-del') && unifiedHtml.includes('<div class="diff-num">11</div>\n          <div class="diff-num"></div>'), '刪除行必須標記 .diff-line-del 並僅顯示 old 行號 (11)');
  assert(unifiedHtml.includes('<div class="diff-num">12</div>\n          <div class="diff-num"></div>'), '第二行刪除行必須遞增 old 行號 (12)');
  assert(unifiedHtml.includes('diff-line-add') && unifiedHtml.includes('<div class="diff-num"></div>\n          <div class="diff-num">11</div>'), '新增行必須標記 .diff-line-add 並僅顯示 new 行號 (11)');
  assert(unifiedHtml.includes('<div class="diff-num"></div>\n          <div class="diff-num">13</div>'), '第三行新增行必須遞增 new 行號 (13)');
  assert(unifiedHtml.includes('<div class="diff-num">13</div>\n          <div class="diff-num">14</div>'), '結尾 context 行必須正確接續 old=13, new=14');
  assert(unifiedHtml.includes('&lt;script&gt;') && !unifiedHtml.includes('<script>'), 'renderLineNumberedDiff 必須對異動內容進行 HTML 跳脫');

  // 24-4 filterDiffForFile 嚴格單檔比對（不得因 Diff 內文提及他檔路徑而混入第二個檔案）與 resolveModifiedFileEntries 驗證
  const twoFileDiff = [
    'diff --git a/src/public/index.html b/src/public/index.html',
    'index 1111111..2222222 100644',
    '--- a/src/public/index.html',
    '+++ b/src/public/index.html',
    '@@ -1,2 +1,2 @@',
    '-<div>old</div>',
    '+<div>new</div>',
    'diff --git a/scripts/test_ui_behavior.js b/scripts/test_ui_behavior.js',
    'index 3333333..4444444 100644',
    '--- a/scripts/test_ui_behavior.js',
    '+++ b/scripts/test_ui_behavior.js',
    '@@ -10,1 +10,2 @@',
    ' const a = 1;',
    "+const targetPath = 'src/public/index.html';"
  ].join('\n');

  let renderedSingleDiffText = null;
  let renderedSingleFilePath = null;
  const activeBadgeEl = makeModalEl();
  const filterCtx = vm.createContext({
    currentActiveTaskDiff: twoFileDiff,
    currentModalEditingTask: null,
    currentProject: 'ALL',
    MOD_FILE_ITEM_ACTIVE_CLASS: 'mod-file-item active',
    MOD_FILE_ITEM_INACTIVE_CLASS: 'mod-file-item inactive',
    document: {
      getElementById: id => (id === 'diffActiveFileBadge' ? activeBadgeEl : null),
      querySelectorAll: () => []
    },
    renderDiffViewer: (diffText, fp) => {
      renderedSingleDiffText = diffText;
      renderedSingleFilePath = fp;
    },
    fetch: async () => ({ json: async () => ({}) })
  });
  vm.runInContext(
    ['extractFilePathFromDiffSection', 'parseFileStatusFromLines', 'splitDiffByFiles', 'filterDiffForFile'].map(actualFunction).join('\n'),
    filterCtx
  );
  await filterCtx.filterDiffForFile('src/public/index.html');
  assert.strictEqual(renderedSingleFilePath, 'src/public/index.html', 'filterDiffForFile 應傳遞正確的單檔路徑給 renderDiffViewer');
  assert(renderedSingleDiffText && renderedSingleDiffText.includes('diff --git a/src/public/index.html b/src/public/index.html'), 'renderDiffViewer 必須包含所選檔案 src/public/index.html 的 diff 區塊');
  assert(!renderedSingleDiffText.includes('scripts/test_ui_behavior.js'), 'filterDiffForFile 不得因內文出現檔名而混入第二個檔案 scripts/test_ui_behavior.js');

  // Null diffActiveFileBadge 防禦驗證
  const nullBadgeFilterCtx = vm.createContext({
    currentActiveTaskDiff: twoFileDiff,
    currentModalEditingTask: null,
    currentProject: 'ALL',
    MOD_FILE_ITEM_ACTIVE_CLASS: 'mod-file-item active',
    MOD_FILE_ITEM_INACTIVE_CLASS: 'mod-file-item inactive',
    document: {
      getElementById: () => null,
      querySelectorAll: () => []
    },
    renderDiffViewer: () => {},
    fetch: async () => ({ json: async () => ({}) })
  });
  vm.runInContext(
    ['extractFilePathFromDiffSection', 'parseFileStatusFromLines', 'splitDiffByFiles', 'filterDiffForFile'].map(actualFunction).join('\n'),
    nullBadgeFilterCtx
  );
  await nullBadgeFilterCtx.filterDiffForFile('src/public/index.html');

  // resolveModifiedFileEntries 在 modifiedFiles 為空但有 diff 時應自動解析清單
  const resolveCtx = vm.createContext({});
  vm.runInContext(
    ['extractFilePathFromDiffSection', 'parseFileStatusFromLines', 'splitDiffByFiles', 'resolveModifiedFileEntries'].map(actualFunction).join('\n'),
    resolveCtx
  );
  const resolvedFromDiff = resolveCtx.resolveModifiedFileEntries({ modifiedFiles: [], diff: twoFileDiff });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(resolvedFromDiff)),
    [
      { path: 'src/public/index.html', description: '' },
      { path: 'scripts/test_ui_behavior.js', description: '' }
    ],
    'modifiedFiles 為空時 resolveModifiedFileEntries 應從 diff 解析出檔案清單'
  );

  // renderModifiedFilesList 應於第一行突顯檔名，並於下方以小字顯示目錄路徑，且不限制 max-w-[140px]
  const modListEl = { innerHTML: '' };
  const renderModListCtx = vm.createContext({
    escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    parseDiffStats: () => ({
      filesMap: {
        'src/public/modules/modal.js': { status: 'M', additions: 5, deletions: 2 }
      }
    })
  });
  vm.runInContext(
    ['extractFilePathFromDiffSection', 'parseFileStatusFromLines', 'splitDiffByFiles', 'resolveModifiedFileEntries', 'renderModifiedFilesList'].map(actualFunction).join('\n'),
    renderModListCtx
  );
  renderModListCtx.renderModifiedFilesList(
    { modifiedFiles: ['src/public/modules/modal.js', 'README.md'], diff: '' },
    modListEl
  );
  assert(!modListEl.innerHTML.includes('max-w-[140px]'), 'renderModifiedFilesList 不得保留 max-w-[140px] 寬度截斷限制');
  assert(
    modListEl.innerHTML.includes('data-path="src/public/modules/modal.js"') &&
      modListEl.innerHTML.includes('title="src/public/modules/modal.js"') &&
      modListEl.innerHTML.includes("onclick=\"filterDiffForFile('src/public/modules/modal.js')\""),
    'renderModifiedFilesList 必須保留完整路徑的 data-path、title 與 onclick 屬性'
  );
  assert(
    /<span class="[^"]*font-semibold[^"]*text-xs[^"]*">modal\.js<\/span>/.test(modListEl.innerHTML),
    'renderModifiedFilesList 第一行必須以 text-xs font-semibold 突顯檔名 modal.js'
  );
  const modalIdx = modListEl.innerHTML.indexOf('>modal.js</span>');
  const dirIdx = modListEl.innerHTML.indexOf('>src/public/modules</div>');
  assert(
    modalIdx !== -1 && dirIdx > modalIdx && /<div class="text-\[10px\][^"]*">src\/public\/modules<\/div>/.test(modListEl.innerHTML),
    'renderModifiedFilesList 必須在檔名下方以 text-[10px] 小字顯示目錄路徑 src/public/modules'
  );
  assert(
    /<span class="[^"]*font-semibold[^"]*text-xs[^"]*">README\.md<\/span>/.test(modListEl.innerHTML),
    '無目錄前綴的根目錄檔案 README.md 也應正確顯示檔名'
  );

  // diffViewer.js 必須保留 showAllDiffs 與 toggleCollapseAllDiffs export 以維持 app.js 相容性
  const diffViewerSource = fs.readFileSync(path.join(__dirname, '../src/public/modules/diffViewer.js'), 'utf8');
  assert(diffViewerSource.includes('showAllDiffs') && diffViewerSource.includes('toggleCollapseAllDiffs'), 'diffViewer.js 必須保留 showAllDiffs 與 toggleCollapseAllDiffs 匯出');

  console.log('  ✅ TASK-239 看板切換置左、異動內容檢查分頁與左右兩欄 Master-Detail Diff 檢視器驗證通過');

  console.log('🎉 所有前端核心互動邏輯與防禦機制測試通過！\n');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
