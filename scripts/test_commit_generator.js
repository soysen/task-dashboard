const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { formatCommitMessageFromSkill } = require('../src/server/services/gitService');

console.log('🧪 執行 Conventional Commit 深度語意分析與實質 Diff 提煉測試...');

const BOILERPLATE_BLACKLIST = [
  '後端服務邏輯調校與開工引擎強化',
  '前端面板視圖與彈窗互動優化',
  '補齊自動化測試與規範檢核腳本',
  '程式碼與架構規範檢驗通過',
  '模組功能實作與異動更新'
];

function assertNoBoilerplate(body, label) {
  for (const phrase of BOILERPLATE_BLACKLIST) {
    assert(
      !body.includes(phrase),
      `[${label}] 產出之 Commit Body 嚴禁含有空泛罐頭字串 "${phrase}"，實際輸出:\n${body}`
    );
  }
}

// ==========================================
// Case 1: 既有測試相容性（鎖定任務原始主軸）
// ==========================================
const mockDiffCase1 = `
diff --git a/src/public/device.js b/src/public/device.js
index 123..456 100644
--- a/src/public/device.js
+++ b/src/public/device.js
@@ -10,2 +10,4 @@
+function renderDeviceTable() {}
+<div id="deviceModal"></div>
diff --git a/src/sass/module/_5gsa.sass b/src/sass/module/_5gsa.sass
index 111..222 100644
--- a/src/sass/module/_5gsa.sass
+++ b/src/sass/module/_5gsa.sass
@@ -1 +1,2 @@
+.device-table min-width 100%
`;

const taskCase1 = {
  id: 'TASK-053',
  title: '5GSA device list dialog 調整',
  tags: ['feat'],
  modifiedFiles: ['src/public/device.js', 'src/sass/module/_5gsa.sass']
};

const res1 = formatCommitMessageFromSkill('.', taskCase1, mockDiffCase1, taskCase1.modifiedFiles);
assert(res1.message.includes('5GSA device list dialog 調整'), 'Case 1: 主旨必須維持任務原始主軸');
assert.strictEqual(res1.type, 'feat', 'Case 1: type 應為 feat');
assert(res1.body.includes('#deviceModal') || res1.body.includes('renderDeviceTable'), 'Case 1: Body 必須包含具體元件或函式');
assert(res1.body.includes('.device-table'), 'Case 1: Body 必須包含樣式 selector');
assertNoBoilerplate(res1.body, 'Case 1');
console.log('  ✅ Case 1: 既有標題主軸保留與 DOM/函式/樣式實質特徵提取驗證通過');

// ==========================================
// Case 2: 抱怨/問題陳述標題智慧轉換為正向工程動詞句
// ==========================================
const mockDiffCase2 = `
diff --git a/src/server/services/gitService.js b/src/server/services/gitService.js
index 123..456 100644
--- a/src/server/services/gitService.js
+++ b/src/server/services/gitService.js
@@ -170,5 +170,12 @@
+function extractSubstantiveDiffChanges() {}
`;

const taskCase2 = {
  id: 'TASK-199',
  title: 'commit 提供的內容僅僅只是帶入 harness 結果與任務標題，未針對 diff 的實質變動產出',
  tags: ['feat'],
  modifiedFiles: ['src/server/services/gitService.js']
};

const res2 = formatCommitMessageFromSkill('.', taskCase2, mockDiffCase2, taskCase2.modifiedFiles);
assert(!res2.message.includes('僅僅只是'), 'Case 2: 主旨應移除反面抱怨字眼');
assert(!res2.message.includes('未針對'), 'Case 2: 主旨應移除未針對等陳述');
assert(res2.message.includes('Commit 訊息') && res2.message.includes('Git Diff'), 'Case 2: 主旨應重構為正向工程動詞句');
assert.strictEqual(res2.scope, 'git', 'Case 2: scope 應精準映射為 git');
assertNoBoilerplate(res2.body, 'Case 2');
console.log('  ✅ Case 2: 抱怨/問題陳述型標題智慧動詞句提煉驗證通過');

// ==========================================
// Case 3: 提取開發意圖註解與程式碼符號特徵
// ==========================================
const mockDiffCase3 = `
diff --git a/src/server/server.js b/src/server/server.js
index 123..456 100644
--- a/src/server/server.js
+++ b/src/server/server.js
@@ -2950,5 +2950,10 @@
+ // [Confirmation Gate 雙層防禦]：自動消化殘留 feedback 入 description
+ function consumeResidualFeedback() {}
+ app.post('/api/tasks/:id/confirm-gate', (req, res) => {});
`;

const taskCase3 = {
  id: 'TASK-200',
  title: '優化任務開工雙層防禦',
  tags: ['fix'],
  modifiedFiles: ['src/server/server.js']
};

const res3 = formatCommitMessageFromSkill('.', taskCase3, mockDiffCase3, taskCase3.modifiedFiles);
assert(res3.body.includes('Confirmation Gate 雙層防禦'), 'Case 3: Body 應優先提取開發意圖註解');
assert(res3.body.includes('/api/tasks/:id/confirm-gate') || res3.body.includes('consumeResidualFeedback'), 'Case 3: 應提取 API 端點或函式');
assertNoBoilerplate(res3.body, 'Case 3');
console.log('  ✅ Case 3: 意圖註解與 API 路由符號提取驗證通過');

// ==========================================
// Case 4: 結構化 keyChanges 與 resolution 優先採納
// ==========================================
const taskCase4 = {
  id: 'TASK-197',
  title: '5GSA API 參數判斷優化',
  tags: ['fix'],
  resolution: '修改 src/service/5gsaService.js 中的 checkReservation，支援傳入並在 payload 中帶入 eventCode',
  keyChanges: [
    'src/service/5gsaService.js: checkReservation payload 增加 eventCode 支援',
    'src/pages/5gsaController/apply/venue-selection.js: handleSubmit 呼叫 checkReservation 帶入 eventCode',
    'src/pages/5gsaController/components/OfferConfirmationBase.js: matchedEvent.available === false 時顯示「慢了一步！該日期已額滿」圖文'
  ],
  modifiedFiles: [
    'src/service/5gsaService.js',
    'src/pages/5gsaController/apply/venue-selection.js',
    'src/pages/5gsaController/components/OfferConfirmationBase.js'
  ]
};

const res4 = formatCommitMessageFromSkill('.', taskCase4, '', taskCase4.modifiedFiles);
assert(res4.body.includes('checkReservation payload 增加 eventCode 支援'), 'Case 4: Body 必須包含 keyChanges 核心要點');
assert(res4.body.includes('解決方案：'), 'Case 4: Body 應包含 resolution 概述');
assertNoBoilerplate(res4.body, 'Case 4');
console.log('  ✅ Case 4: 結構化 keyChanges 與 resolution 優先採納驗證通過');

// ==========================================
// Case 5: 前端 HTML 與 modal.js 契約驗證
// ==========================================
const htmlContent = fs.readFileSync(path.join(__dirname, '../src/public/index.html'), 'utf8');
assert(htmlContent.includes('id="btnRegenCommit"'), 'Case 5: index.html 必須包含重新提煉按鈕 (#btnRegenCommit)');
assert(htmlContent.includes('regenerateCommitMessage()'), 'Case 5: index.html 必須綁定 regenerateCommitMessage() 事件');

const modalJsContent = fs.readFileSync(path.join(__dirname, '../src/public/modules/modal.js'), 'utf8');
assert(modalJsContent.includes('hasBoilerplateBody'), 'Case 5: modal.js 必須包含 hasBoilerplateBody 檢查');
assert(modalJsContent.includes('regenerateCommitMessage'), 'Case 5: modal.js 必須實作並匯出 regenerateCommitMessage');
console.log('  ✅ Case 5: 前端介面契約與防偽自動刷新機制驗證通過');

console.log('🎉 所有 Conventional Commit 深度語意分析與實質 Diff 提煉測試通過！');
