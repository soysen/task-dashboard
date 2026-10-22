const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../src/public/index.html'), 'utf8');
const moduleFiles = fs.readdirSync(path.join(__dirname, '../src/public/modules')).filter(f => f.endsWith('.js'));
const allSources = [html, ...moduleFiles.map(m => fs.readFileSync(path.join(__dirname, '../src/public/modules', m), 'utf8'))];

function source(name) {
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

function element(value = '') {
  const classes = new Set();
  return {
    value, disabled: false, checked: false, innerHTML: '', style: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    }
  };
}

async function main() {
  console.log('🧪 執行待確認執行計劃 HTML 視覺化與意見輸入欄位測試...');

  // 1. 驗證 index.html 元素契約
  assert(html.includes('id="formPlanVisual"'), 'index.html 必須具備 formPlanVisual HTML 計劃容器');
  assert(html.includes('id="btnPlanTabVisual"'), 'index.html 必須具備結構化檢視按鈕 btnPlanTabVisual');
  assert(html.includes('id="btnPlanTabRaw"'), 'index.html 必須具備原始文字檢視按鈕 btnPlanTabRaw');
  assert(html.includes('id="reviewFeedbackBox"'), 'index.html 必須具備 reviewFeedbackBox 意見欄位容器');
  assert(html.includes('id="formFeedback"'), 'index.html 必須具備 formFeedback 輸入框');
  console.log('  ✅ index.html 視覺化計劃與意見回饋容器契約驗證通過');

  // 2. 驗證 renderExecutionPlan 渲染能力
  {
    const elements = new Map();
    const get = id => {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    };

    const context = vm.createContext({
      document: { getElementById: get },
      escapeHtml: str => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
      window: { lucide: { createIcons: () => {} } }
    });

    vm.runInContext(source('renderExecutionPlan') + source('switchPlanViewTab'), context);

    // 測試空計劃回退
    context.renderExecutionPlan('');
    assert(get('formPlanVisual').innerHTML.includes('尚未擬定執行計劃'), '空執行計劃應顯示等待規劃提示');

    // 測試 Markdown 格式結構化轉換
    const samplePlan = `### 系統重構執行計劃
#### 1. 需求分析與目標
- **核心目標**：以 \`HTML\` 格式呈現
- 支援高對比色彩
#### 2. 受影響檔案清單
1. src/index.html
2. src/modal.js
#### 3. 實作切片步驟 (Implementation Slices)
- **Slice 1**: 新增 HTML 容器
- **Slice 2**: 開放意見輸入欄位
#### 4. 品質驗證指標
- 通過全量單元測試`;

    context.renderExecutionPlan(samplePlan);
    const rendered = get('formPlanVisual').innerHTML;
    assert(rendered.includes('需求與目標'), '應渲染需求與目標 badge');
    assert(rendered.includes('受影響檔案'), '應渲染受影響檔案 badge');
    assert(rendered.includes('實作切片'), '應渲染實作切片 badge');
    assert(rendered.includes('品質驗證'), '應渲染品質驗證 badge');
    assert(rendered.includes('<strong class="font-semibold text-slate-900 dark:text-slate-100">核心目標</strong>'), '粗體語法應解析為 strong');
    assert(rendered.includes('<code class="px-1.5 py-0.5 rounded bg-white/90 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-[11px] border border-slate-200 dark:border-slate-700/60">HTML</code>'), 'code 語法應解析為 code 標籤');
    assert(rendered.includes('<li class="ml-4 list-decimal'), '有序清單應解析為 list-decimal');
    console.log('  ✅ renderExecutionPlan Markdown 轉 HTML 結構化排版驗證通過');

    // 測試 switchPlanViewTab 切換模式
    get('formExecutionPlan').value = 'raw edited plan';
    context.switchPlanViewTab('raw');
    assert(get('formPlanVisual').classList.contains('hidden'), 'raw 模式下視覺容器應隱藏');
    assert(!get('formExecutionPlan').classList.contains('hidden'), 'raw 模式下 textarea 應顯示');

    context.switchPlanViewTab('visual');
    assert(!get('formPlanVisual').classList.contains('hidden'), 'visual 模式下視覺容器應顯示');
    assert(get('formExecutionPlan').classList.contains('hidden'), 'visual 模式下 textarea 應隱藏');
    assert(get('formPlanVisual').innerHTML.includes('raw edited plan'), '切換回 visual 應使用最新編輯內容重新渲染');
    console.log('  ✅ switchPlanViewTab 雙向切換與即時重繪驗證通過');
  }

  // 3. 驗證 confirmAndExecuteTask 帶入意見回饋並傳遞至 API
  {
    const elements = new Map();
    const get = id => {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    };

    get('formTaskId').value = 'TASK-FEEDBACK-TEST';
    get('formExecutionPlan').value = '### 執行計劃內容';
    get('formFeedback').value = '補充邊界測試並於 Phase 2 交付驗證截圖';
    get('formRequiresConfirmation').checked = true;

    const task = {
      id: 'TASK-FEEDBACK-TEST',
      title: '意見回饋測試',
      project: 'test-project',
      priority: 'P1',
      status: 'in_progress',
      requiresConfirmation: true,
      executionPlan: '### 執行計劃內容',
      executionLog: 'init log\n',
      feedback: ''
    };

    const requests = [];
    const context = vm.createContext({
      document: { getElementById: get },
      window: {},
      tasks: [task],
      currentModalEditingTask: task,
      console: { error: () => {} },
      showToast: () => {},
      renderKanban: () => {},
      renderMetrics: () => {},
      loadData: async () => {},
      fetch: async (url, options) => {
        requests.push([url, JSON.parse(options.body)]);
        return { ok: true, json: async () => ({ ...task, ...JSON.parse(options.body) }) };
      }
    });

    vm.runInContext(source('resetTextareaHeight') + source('closeModal') +
      source('withButtonLoading') + source('confirmAndExecuteTask'), context);

    await context.confirmAndExecuteTask();

    assert.equal(requests.length, 1);
    const req = requests[0][1];
    assert.equal(req.feedback, '補充邊界測試並於 Phase 2 交付驗證截圖', '使用者輸入的審閱意見應寫入 task.feedback');
    assert(req.executionLog.includes('💬 [審閱意見] 補充邊界測試並於 Phase 2 交付驗證截圖'), '審閱意見應記錄於 executionLog');
    assert(req.executionLog.includes('✅ [Confirmation Gate]'), '確認門禁記錄應正常保留');
    console.log('  ✅ confirmAndExecuteTask 審閱意見收集與回寫驗證通過');
  }

  console.log('🎉 所有待確認執行計劃 HTML 視覺化與意見輸入欄位測試通過！');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
