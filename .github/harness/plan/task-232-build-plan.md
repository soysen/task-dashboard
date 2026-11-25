# Handoff Contract — TASK-232: [v3.0-M1] 實作專案×分支導覽、依深度動態顯示白話 CTA 與開單分支綁定

- **Baseline**: Branch `main`, HEAD `82016bd`
- **Impact**: `MEDIUM` — 新增後端分支查詢/建立端點與任務欄位擴充（Additive & Backward-Compatible），新增前端 `branchNavigator.js` 模組並調整 `state.js`、`app.js`、`kanban.js`、`modal.js`、`modalFormEditor.js`、`index.html`。
- **Constraints**:
  - 最小範圍實作，零第三方套件（純 Node.js 原生 `execFileSync('git', [...])` 陣列參數防注入 + Vanilla ES Modules）。
  - 嚴禁寫入或污染 `data/tasks.json`。
  - 所有 HTML `onclick`/`onchange` 函式必須同步掛載至 `window.*`。
  - 全面使用簡單白話文案（禁止「依分支泳道分組」、「在此分支開立任務」等拗口術語）。
  - 不得執行 `git commit`，不得呼叫 Task Dashboard API 推進任務狀態。
- **Do-Not-Read**: 嚴禁讀取 `README.md`、`HARNESS.md`、`CLAUDE.md`、`docs/*`、`.github/skills/*` 或其他 build plan。
- **Escalation**: 資訊不足時最多額外讀取 2 次（>500 行檔案須先 `grep -n` 再切片）；仍不足即停止並回報主 Agent。

## Edit Targets & Read Allowlist

1. **`src/server/services/gitService.js`**
   - Read Allowlist: `L510-555`, `L940-959`
   - Edit: 新增 `getProjectBranches(repoPath, tasks, options)`（5 秒快取、`?refresh=1`、使用 `execFileSync('git', [...])` 取得 `isGitRepo`, `currentCheckoutBranch`, `isMainWorkspaceDirty`, `dirtyFilesCount`, `defaultBranch`, `branches[]` 含 `name, headSha, subject, updatedRelative, isCurrentCheckout, activeTaskCount, reviewTaskCount`）與 `createProjectBranch(repoPath, branchName, fromBranch, options)`（`git check-ref-format --branch` 驗證 + 預設 `git branch <branchName> <fromBranch>` 無損建分支 + 清快取），並匯出於 `module.exports`。

2. **`src/server/server.js`**
   - Read Allowlist: `L40-60`, `L1525-1565`, `L1895-1975`, `L2130-2160`
   - Edit:
     - 匯入 `getProjectBranches`, `createProjectBranch`。
     - 新增 `GET /api/projects/:projectId/branches`（支援 `?refresh=1`）。
     - 新增 `POST /api/projects/:projectId/branches`（驗證與建立新分支，合法回傳 201，錯誤回傳 400/404）。
     - 擴充 `POST /api/tasks` 與 `PUT /api/tasks/:id` 支援選填 `targetBranch`（向下相容同步 `baseBranch`）與 `workspaceMode`（預設 `"worktree"`，支援 `"worktree" | "branch_stream" | "in_place"`）。

3. **`src/public/modules/state.js`**
   - Read Allowlist: `L1-54`
   - Edit: 新增 `currentBranch = "ALL"`, `projectBranchesMap = {}`, `groupByBranch = false` 及 `setCurrentBranch`, `setProjectBranchesMap`, `setGroupByBranch`（同步掛載 `window.*`）。

4. **`src/public/modules/branchNavigator.js`** *(新增獨立模組 < 350 行)*
   - Read Allowlist: 無（新建）
   - Edit: 實作並匯出（同步掛載 `window.*`）：
     - `loadProjectBranches(projectId, forceRefresh)`
     - `selectProjectAndBranch(projectId, branchName)`
     - `renderProjectBranchTree(project)`
     - `renderContextualHeaderActions()`（依 L0~L3 深度動態渲染右上角 CTA 與左側脈絡標題）
     - `toggleBranchGroupView(enabled)`
     - `openCreateBranchPopover` / `submitNewBranch`

5. **`src/public/index.html`**
   - Read Allowlist: `L140-175`, `L305-330`, `L585-620`
   - Edit:
     - 頂部導航列右側新增 `<div id="contextualHeaderActions" class="flex items-center gap-1.5"></div>` 供 L0~L2 動態 CTA 渲染（L3 自動收起）。
     - `#modalSpecPane` 內新增「目標分支」下拉選單 (`#formTargetBranch`)、`＋ 新建分支` 按鈕與行內新建區塊（含白話說明：「直接從 main 開新分支，不會影響目前修改中的檔案」），以及「執行方式」三選一區塊 (`#formWorkspaceMode`: `獨立工作區（推薦）` / `接續同分支` / `直接改目前資料夾`) 與 `#formInPlaceDirtyHint` 提醒區。

6. **`src/public/modules/modalFormEditor.js`**
   - Read Allowlist: `L1-50`, `L520-554`
   - Edit: 新增 `onFormProjectChangeLoadBranches(projId, preselectBranch)`, `selectWorkspaceMode(mode)`, `toggleQuickBranchBox(show)`, `quickCreateBranchInline()`, `updateInPlaceDirtyWarning()`，於 `setFormProject` 觸發載入分支，並匯出及掛載 `window.*`。

7. **`src/public/modules/modal.js`**
   - Read Allowlist: `L49-125`, `L580-628`, `L1209-1263`, `L1925-1940`
   - Edit: `openModal` 與 `openModalForEdit` 支援帶入/回填 `targetBranch` 與 `workspaceMode` 並觸發 `renderContextualHeaderActions()`（L3 收起外層切換）；`closeModal` 恢復 `renderContextualHeaderActions()`；`saveTask` 送出 `targetBranch`, `baseBranch`, `workspaceMode`。

8. **`src/public/modules/kanban.js`**
   - Read Allowlist: `L84-170`, `L200-220`, `L640-663`
   - Edit: `renderKanban()` 支援依 `currentBranch` 過濾、支援 `groupByBranch`（「按分支看」）分組標題渲染，並於任務卡片顯示 `⎇ <targetBranch>` 標籤。

9. **`src/public/modules/app.js`**
   - Read Allowlist: `L1-46`, `L655-750`, `L773-825`, `L1108-1208`
   - Edit: 匯入 `branchNavigator.js` 與 `state.js` 新狀態；`filterByProject` 與 `renderSidebarProjects` 整合專案×分支樹狀導覽；`initApp` / `loadData` 觸發 `renderContextualHeaderActions()`；掛載新增函式至 `window.*`。

10. **`scripts/test_server.sh`**
    - Read Allowlist: `L980-1018`
    - Edit: 新增 TASK-232 整合測試區塊，驗證 `GET /api/projects/:id/branches`、`POST /api/projects/:id/branches`（Dirty 狀態下無損建分支並於測試後清理）、`POST/PUT /api/tasks` 儲存 `targetBranch`/`workspaceMode`。

## Slices
- `[TASK-232-S1]` 後端分支 API 與任務欄位擴充（`gitService.js`, `server.js`）
  - Acceptance: `node -c src/server/services/gitService.js && node -c src/server/server.js`
- `[TASK-232-S2]` 前端狀態、分支導覽模組與深度動態 CTA（`state.js`, `branchNavigator.js`, `index.html`, `app.js`）
  - Acceptance: `node -c src/public/modules/state.js && node -c src/public/modules/branchNavigator.js && node -c src/public/modules/app.js`
- `[TASK-232-S3]` 開單表單分支綁定、執行方式選項與看板按分支檢視（`modalFormEditor.js`, `modal.js`, `kanban.js`）
  - Acceptance: `node -c src/public/modules/modalFormEditor.js && node -c src/public/modules/modal.js && node -c src/public/modules/kanban.js`
- `[TASK-232-S4]` 整合測試補齊與全套門禁驗證（`scripts/test_server.sh`）
  - Acceptance: `npm test && npm run harness:check`

## Return Format
回傳：`modifiedFiles` 清單，以及每個切片的 `{ command, cwd, exitCode, rawLog }`。
