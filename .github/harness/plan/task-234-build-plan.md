# Handoff Contract — TASK-234: [v3.0-M3] 實作「查看並提交」合一審核面板、精準單卡結案與合併回主幹

- **Baseline**: Branch `main`, HEAD `82016bd` (含 TASK-232 與 TASK-233 工作區實作)
- **Impact**: `MEDIUM` — 新增 `/api/tasks/:taskId/land` 與 `/api/projects/:projectId/branches/merge`，修正 `/api/tasks/:id/commit` 連坐封存問題，新增前端 `reviewLandStudio.js` 模組並更新 `kanban.js`、`modal.js`、`branchNavigator.js`、`index.html`。
- **Constraints**:
  - 最小範圍實作，零第三方套件；Git 操作一律使用 `execFileSync('git', [...])` 陣列參數防注入。
  - 嚴禁寫入或污染 `data/tasks.json`。
  - 所有 HTML `onclick`/`onchange` 函式必須同步匯出並掛載至 `window.*`。
  - 全面使用簡單白話文案（「查看並提交」、「分支檢查：可直接提交 ✓」、「通過並提交」、「請 AI 再修改」、「合併回 <defaultBranch>」）。
  - 不得執行 `git commit`，不得呼叫 Task Dashboard API 推進 TASK-234 狀態（`tasks.json` 寫入 `executionPlan` 由主 Agent 負責）。
- **Do-Not-Read**: 嚴禁讀取 `README.md`、`HARNESS.md`、`CLAUDE.md`、`docs/*`、`.github/skills/*` 或其他 build plan。
- **Escalation**: 資訊不足時最多額外讀取 2 次（>500 行檔案須先 `grep -n` 再切片）；仍不足即停止並回報主 Agent。

## Edit Targets & Read Allowlist

1. **`src/server/services/gitService.js`**
   - Read Allowlist: `L905-990`, `L1125-1200`, `L1335-1354`
   - Edit:
     - 新增 `mergeFeatureBranch(repoPath, sourceBranch, targetBranch, options)`（使用 `withRepoMergeLock` 與 `execFileSync('git', [...])`，支援將功能分支 Rebase/Merge/Squash 合入目標主幹分支，衝突或主目錄髒污且分支不符時安全中止並回傳錯誤狀態，成功後清除分支快取並回傳 `commitSha`）。
     - 匯出 `mergeFeatureBranch`。

2. **`src/server/server.js`**
   - Read Allowlist: `L40-60`, `L1257-1360`, `L2684-2760`, `L2860-2910`
   - Edit:
     - 匯入 `withRepoMergeLock`, `mergeFeatureBranch`。
     - 新增 `POST /api/tasks/:taskId/land`（以 `withRepoMergeLock` 序列化）：
       - 依 `workspaceMode` 分流執行 `mergeTaskWorktree`（worktree）或 `executeProjectCommit`（`branch_stream`/`in_place`），非 Git 專案則直接標記結案。
       - 寫入 `gitLanding: { isCommitted: true, commitSha, landedBranch, landedAt, pushedRemote: false, prUrl }`，並僅將本次任務（及選填 `coLandTaskIds`）標記為 `archiveImmediately ? 'archived' : 'done'`，**絕不連坐封存同專案其他 `done` 任務**。
       - 掃描同專案因 `queueState.blockedByTaskId === taskId` 排隊之任務，自動清除 `queueState = null`、寫入 `tasks.json` 並廣播 SSE。
     - 修正既有 `POST /api/tasks/:id/commit`（L2743-2753）：廢除將同專案所有 `done` 任務連坐封存之邏輯，改為僅封存 `t.id === task.id`（及顯式 `coLandTaskIds`）並寫入 `gitLanding`。
     - 新增 `POST /api/projects/:projectId/branches/merge`，呼叫 `mergeFeatureBranch` 回傳 `200`/`400`/`409`。

3. **`src/public/modules/reviewLandStudio.js`** *(新增獨立模組 < 400 行)*
   - Read Allowlist: 無（新建）
   - Edit: 實作並匯出（同步掛載 `window.*`）：
     - `initReviewLandPanel(task)`：渲染右側「分支檢查：可直接提交 ✓」或衝突提示、Commit 訊息編輯器（`#landSubjectInput`, `#landBodyInput`，自動帶入或非同步呼叫 `/generate-commit`）、「提交後順便封存這張卡片」勾選框與錯誤顯示區。
     - `checkTaskBaseDrift(taskId)`：呼叫 `GET /api/tasks/:taskId/drift-check` 更新分支檢查狀態。
     - `landTaskChanges(event)`：呼叫 `POST /api/tasks/:taskId/land`，處理 409/422/400 原窗錯誤提示與成功後刷新看板。
     - `switchWorkspaceToWorktreeAndStart(taskId)`：切換為 `worktree` 模式並重新開工。

4. **`src/public/index.html`** & **`src/public/modules/modal.js`**
   - Read Allowlist: `index.html` `L949-1055`; `modal.js` `L897-995`, `L1372-1425`, `L2050-2168`
   - Edit:
     - `index.html`：於 `#modalRightColumn` 新增 `#reviewLandStudioPanel` 容器；將 `#btnRejectTask` 文案改為 `請 AI 再修改`；新增 `#btnLandTask`（文案 `通過並提交` + 目標分支徽章 `寫入 ⎇ <targetBranch>`，呼叫 `landTaskChanges(event)`）。
     - `modal.js`：匯入 `reviewLandStudio.js` 並在 `openModalForEdit` / `updateModalButtonState` 觸發 `initReviewLandPanel(task)`（於 `review` 狀態顯示 `#reviewLandStudioPanel` 與 `#btnLandTask`）。

5. **`src/public/modules/kanban.js`** & **`src/public/modules/branchNavigator.js`**
   - Read Allowlist: `kanban.js` `L335-375`; `branchNavigator.js` `L121-190`, `L305-331`
   - Edit:
     - `kanban.js`：`isReviewStatus` 卡片按鈕統一改為 `查看並提交`（呼叫 `openModalForEdit('${t.id}')`）；`done` 卡片若具 `t.gitLanding?.commitSha` 則顯示 `✓ 已提交 <shortSha>` 與 `⎇ <landedBranch>`。
     - `branchNavigator.js`：於 L2 單一非主幹分支且該分支有已提交 `done` 任務時，右上角動態顯示 `合併回 <defaultBranch>` 按鈕（呼叫 `openMergeBranchModal`），並實作 `openMergeBranchModal` 呼叫 `POST /api/projects/:id/branches/merge` 並掛載至 `window.*`。

6. **`scripts/test_server.sh`**
   - Read Allowlist: `L1250-1305`
   - Edit: 新增 TASK-234 整合測試區塊，驗證：
     - 精準單卡結案不連坐（`TASK-A` 為 `done`，`TASK-B` 呼叫 `/land` 並 `archiveImmediately: true` 後 `TASK-A` 仍維持 `done`）。
     - `/land` 成功寫入 `gitLanding` 並自動解除同專案排隊任務之 `queueState`。
     - `POST /api/projects/:id/branches/merge` 成功將功能分支合入主幹。

## Slices
- `[TASK-234-S1]` 後端 `mergeFeatureBranch`、`POST /api/tasks/:taskId/land`、廢除連坐封存與 `/branches/merge` (`gitService.js`, `server.js`)
  - Acceptance: `node -c src/server/services/gitService.js && node -c src/server/server.js`
- `[TASK-234-S2]` 前端 `reviewLandStudio.js` 與「查看並提交」審核整合 (`reviewLandStudio.js`, `index.html`, `modal.js`)
  - Acceptance: `node -c src/public/modules/reviewLandStudio.js && node -c src/public/modules/modal.js`
- `[TASK-234-S3]` 看板卡片文案、`commitSha` 展示、L2 `合併回主幹` CTA 與整合測試 (`kanban.js`, `branchNavigator.js`, `test_server.sh`)
  - Acceptance: `npm test && npm run harness:check`
- [x] Slice 1: [TASK-234] 【完整規格書與白話規範參考】: /Users/nelsonchung/.gemini/antigravity/brain/e2af0773-728f-4e7f-921b-7e059857f00e/spec_project_branch_workflow.md 【前置任務】: TASK-233 【M3 實作目標】 1. 新增統一交付端點 POST /api/tasks/:taskId/land（以 withRepoMergeLock 互斥鎖序列化）：    - 自動依 workspaceMode 分流執行獨立工作區 Squash 合入 targetBranch（含基線變動自動 Rebase + 重跑測試 + 回收 Worktree）或原地 Commit。    - 成功後寫入 gitLanding: { isCommitted: true, commitSha, landedBranch, landedAt }，並自動掃描同專案因 queueState.blockedByTaskId === taskId 排隊的下一張任務，解除排隊鎖定並廣播 SSE。 2. 廢除跨分支連坐封存：修正舊版提交成功後將同專案所有 done 任務全部強制封存的行為，僅精準結案本次提交的卡片（依選項標為 done 或 archived），於「已提交」卡片展示 commitSha 短碼。 3. 前端「查看並提交」白話合一體驗（新增獨立模組 src/public/modules/reviewLandStudio.js 並同步掛載 window.*）：    - 待審核卡片按鈕統一為「查看並提交」。    - 審核視窗整合左欄測試結果/Diff 與右欄「分支檢查：可直接提交 ✓」、Commit 訊息編輯器、「請 AI 再修改」與「通過並提交」（標註寫入 ⎇ <targetBranch>）主按鈕。    - 於 L2 單一非主幹分支且該分支有已提交任務時，右上角動態顯示「合併回 <defaultBranch>」按鈕（對應 POST /api/projects/:projectId/branches/merge）。 4. 驗證門禁：補齊精準單卡結案不連坐測試與 /land 整合測試，通過 npm test 與 npm run harness:check（Exit Code 0）。

## Return Format
回傳：`modifiedFiles` 清單，以及每個切片的 `{ command, cwd, exitCode, rawLog }`。
