# Handoff Contract — TASK-237: 任務彈窗顯示問題

- **Baseline**: Branch `td/TASK-237` (worktree `/Users/nelsonchung/projects/task-dashboard.worktrees/TASK-237`), HEAD `a41e693`
- **Impact**: `MEDIUM` — 移除 `done` 卡片與彈窗之舊版 Commit/過時按鈕及無入口的 `#projectModal`、修正待審核任務「審核與執行成果」欄位橫向捲軸溢出、修正退回給 AI 重做狀態 (`todo`/`in_progress`/`needs_human`) 漏顯 Git Diff 之時序與顯示邏輯，並於 `scripts/test_ui_behavior.js` 補齊回歸測試。
- **Constraints**:
  - 最小範圍實作，零第三方套件；僅修改本任務相關前端與測試檔案。
  - 嚴禁寫入或污染 `data/tasks.json` 或 `~/Library/Application Support/TaskDashboard/`。
  - 保留 `scripts/test_ui_behavior.js` 既有驗證字面契約（如 `#modalLeftColumn` class 前綴 `flex-1 overflow-y-auto pl-1 pr-2`、`renderExecutionReport` 行內 `<code class="px-1.5 py-0.5 rounded`、以及 `#commitModal` 內既有 `#commitErrorBox` / `#commitErrorText` / `#btnAutoFixWithAgent`）。
  - 所有仍保留之 HTML `onclick`/`onchange` 函式維持匯出與 `window.*` 掛載。
  - 不得執行 `git commit`，不得呼叫 Task Dashboard API，不得啟動 `watch-task-gate.js`。
- **Do-Not-Read**: 嚴禁讀取 `README.md`、`HARNESS.md`、`CLAUDE.md`、`docs/*`、`.github/skills/*` 或其他 build plan；嚴禁執行 GitNexus 或 `npm run harness:check` 或 `npm test`。
- **Escalation**: 資訊不足時最多額外讀取 2 次（>500 行檔案須先 `grep -n` 再切片）；仍不足即停止並回報主 Agent。

## Edit Targets & Read Allowlist

1. **`src/public/modules/kanban.js`**
   - Read Allowlist: `L405-435`
   - Edit:
     - 移除 `done` 狀態卡片中舊流程的 `commitTaskFromCard` Commit 按鈕區塊（`L423-427`），僅保留 `封存` (`archiveTaskFromCard`) 按鈕。

2. **`src/public/index.html`**
   - Read Allowlist: `L525-545`, `L720-765`, `L820-920`, `L990-1025`, `L1285-1325`
   - Edit:
     - **消除橫向捲軸**：
       - `#modalLeftColumn` (`L528`)：維持 `flex-1 overflow-y-auto pl-1 pr-2` 前綴並加上 `overflow-x-hidden min-w-0`（即 `class="flex-1 overflow-y-auto pl-1 pr-2 overflow-x-hidden min-w-0 space-y-3.5 custom-scrollbar lg:col-span-5"`）。
       - `#modalReviewPane` (`L721`)：加上 `min-w-0 max-w-full overflow-x-hidden`。
       - `#modalReviewDescFullText` (`L742`)、`#sliceGoalContent` (`L823`)、`#sliceInOutScope` (`L824`)、`#sliceCurrentStepText` (`L836`)、`#sliceEvidenceText` (`L843`) 與 `#formLogVisual` (`L885`)：補齊 `break-words [overflow-wrap:anywhere] max-w-full` 避免長路徑/網址撐出橫向捲軸。
       - `#formExecutionPlanBox` 標題列 (`L748`) 與 `#formLogBox` 標題列 (`L866`)：加上 `flex-wrap` 以確保窄欄不溢出。
     - **盤點移除不需存在的 UI 元素**：
       - 移除 `#modalStandardFooter` 內過時或已由 `#reviewLandStudioPanel` 取代的按鈕：`#btnLandTask` (`L1000-1004`)、`#btnApproveTask` (`L1005-1007`)、`#btnMergeWorktreeModal` (`L1008-1010`)、`#btnCommitTaskModal` (`L1011-1013`)。
       - 移除已無任何觸發入口的 `#projectModal` 彈窗區塊 (`L1286-1318`)。

3. **`src/public/modules/executionReport.js`**
   - Read Allowlist: `L165-210`, `L265-308`, `L360-415`
   - Edit:
     - `formatInlineReportText` (`L169`) 與 `formatInlinePlanText` (`L364`)：維持 `<code class="px-1.5 py-0.5 rounded ` 前綴，補上 `break-all [overflow-wrap:anywhere]` 避免長檔案路徑或 URL 撐寬「審核與執行成果」欄。
     - 報告項目容器 `<ul class="space-y-0.5 text-xs pl-6">` (`L203`) 與計劃容器 `<div class="space-y-1 text-xs pl-6">` (`L404`) 加上 `min-w-0 break-words [overflow-wrap:anywhere]`。
     - 終端機原始輸出 `<pre>` (`L277`, `L302`)：改以 `whitespace-pre-wrap break-all [overflow-wrap:anywhere] max-w-full overflow-x-hidden` 呈現，徹底避免橫向捲軸。

4. **`src/public/modules/modal.js`**
   - Read Allowlist: `L12-67`, `L368-422`, `L585-656`, `L918-1042`, `L1165-1262`, `L1468-1528`
   - Edit:
     - 新增輔助函式 `isDiffVisibleStatus(status)`：僅 `['review', 'pending_review', 'done', 'archived'].includes(status)` 回傳 `true`（`todo`、`in_progress`、`needs_human` 等退回重做或未送審狀態一律回傳 `false`）。
     - `switchModalWorkspaceTab(mode = 'review')` (`L12-41`)：
       - 計算 `const allowDiff = Boolean(currentModalEditingTask && isDiffVisibleStatus(currentModalEditingTask.status));`。
       - `rightCol.classList.toggle('hidden', isSpec || !allowDiff);` — 退回給 AI 重做狀態 (`todo`/`in_progress`/`needs_human`) 絕不顯示 `#modalRightColumn` (Git Diff)。
       - `leftCol` 於 `isSpec || !allowDiff` 時套用 `lg:col-span-12`（並移除 `lg:col-span-5`），僅於 `!isSpec && allowDiff` 時套用 `lg:col-span-5`。
     - `openModalForEdit` (`L406-419`, `L589-595`, `L609-652`)：
       - 僅當 `isDiffVisibleStatus(task.status)` 為 `true` 時才請求 `/api/tasks/${task.id}/diff` 與呼叫 `filterDiffForFile` / `showAllDiffs`；否則主動清空 `setCurrentActiveTaskDiff('')` 與 `renderDiffViewer('')` 並確保 `rightCol` 隱藏。
       - 調整呼叫順序：先執行 `switchModalWorkspaceTab('review')`（當 `showReviewWorkspace` 為 true），再執行 `updateModalButtonState()`，避免後端狀態佈局被覆寫。
     - `updateModalButtonState` (`L931-1039`, `L1166-1200`)：
       - `isSimpleMode` 納入 `status === 'needs_human'` (`status === 'todo' || status === 'in_progress' || status === 'needs_human' || !taskId`)。
       - 更新 `leftCol.className` (`L941`, `L973`) 時保留 `flex-1 overflow-y-auto pl-1 pr-2` 並補齊 `overflow-x-hidden min-w-0`。
       - 對已移除之 `#btnApproveTask` / `#btnCommitTaskModal` / `#btnMergeWorktreeModal` / `#btnLandTask` 改以安全可選鏈或移除顯示控制。
     - `rejectTaskWithFeedback` (`L1476-1506`)：對 `btnApprove` 改安全判斷，送出退回 PUT payload 時一併清空 `modifiedFiles: [], diff: '', diffPath: ''`。

5. **`scripts/test_ui_behavior.js`**
   - Read Allowlist: `L255-315`, `L615-656`
   - Edit:
     - 保留既有所有測試並於結尾新增 `// 23. 驗證 TASK-237 任務彈窗顯示優化` 測試區塊，驗證：
       1. `kanban.js` `done` 卡片不再渲染 `commitTaskFromCard` 舊 Commit 按鈕；`index.html` 已移除 `#btnCommitTaskModal`、`#btnApproveTask`、`#btnMergeWorktreeModal`、`#btnLandTask` 與 `#projectModal`。
       2. `#modalLeftColumn` 與 `#modalReviewPane` 具備 `overflow-x-hidden min-w-0`，`executionReport.js` 行內 `<code>` 與終端機 `<pre>` 具備斷行防橫向捲軸樣式。
       3. `switchModalWorkspaceTab('review')` 於 `status` 為 `'in_progress'`、`'todo'`、`'needs_human'` 時必須隱藏 `#modalRightColumn` (Git Diff)，僅於 `'review'` / `'done'` / `'archived'` 時顯示。

## Slices

- [x] **Slice 1 [TASK-237]**: 更新 `kanban.js` 與 `index.html`（移除過時 Commit/過時按鈕與 `#projectModal`，補齊 `#modalLeftColumn` / `#modalReviewPane` 防橫向捲軸樣式）
- [x] **Slice 2 [TASK-237]**: 更新 `executionReport.js` 與 `modal.js`（報告防橫向捲軸斷行、退回重做狀態隱藏 Git Diff 與時序修正、移除舊鈕控制）
- [x] **Slice 3 [TASK-237]**: 更新並執行 `scripts/test_ui_behavior.js` 與 `scripts/test_confirmation_ux.js`
- [x] **Slice 4 [TASK-237 Feedback]**: 修正 `switchModalWorkspaceTab` 於 `in_progress`/`todo`/`needs_human` 單欄模式誤加 `lg:col-span-12` 造成右側空白之 CSS Grid 隱含欄軌問題，重新打包 `/Applications/TaskDashboard.app` 並以打包資源重啟驗證。

## Return Format

實作完成後，請以簡潔 JSON / 列表回報：
- `modifiedFiles`: 實際異動檔案清單
- `slices`: 各切片之 `{ command, cwd, exitCode, rawLog }`
