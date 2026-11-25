# Handoff Contract — TASK-233: [v3.0-M2] 實作獨立工作區自動隔離、排隊白話提示與分支同步檢查 (/drift-check)

- **Baseline**: Branch `main`, HEAD `82016bd` (含 TASK-232 工作區實作)
- **Impact**: `MEDIUM` — 統一 `server.js` 與 `watch-task-gate.js` 之 worktree 隔離與排隊邏輯，新增 `checkTaskBaseDrift` 與 `GET /api/tasks/:taskId/drift-check`，並於 `kanban.js` 顯示白話排隊標籤。
- **Constraints**:
  - 最小範圍實作，零第三方套件；Git 操作一律使用 `execFileSync('git', [...])` 陣列參數防注入。
  - 嚴禁寫入或污染 `data/tasks.json`。
  - `scripts/watch-task-gate.js` 會獨立複製至 `~/Library/Application Support/TaskDashboard/`，不可依賴相對路徑 `require('../src/...')` 才能運作（需使用原生 `execFileSync('git', [...])` 自足實作）。
  - 全面使用簡單白話文案（例如：「等待 TASK-XXX 完成中」）。
  - 不得執行 `git commit`，不得呼叫 Task Dashboard API 推進任務狀態。
- **Do-Not-Read**: 嚴禁讀取 `README.md`、`HARNESS.md`、`CLAUDE.md`、`docs/*`、`.github/skills/*` 或其他 build plan。
- **Escalation**: 資訊不足時最多額外讀取 2 次（>500 行檔案須先 `grep -n` 再切片）；仍不足即停止並回報主 Agent。

## Edit Targets & Read Allowlist

1. **`src/server/services/gitService.js`**
   - Read Allowlist: `L809-860`, `L1190-1217`
   - Edit:
     - 新增 `checkTaskBaseDrift(repoPath, task)`：使用 `execFileSync('git', [...])` 解析 `targetBranch` 最新 SHA、透過 `git rev-list --left-right --count <baseCommit>...<targetBranch>` 計算 `aheadCount` 與 `behindCount`，若 `behindCount > 0` 則嘗試無副作用 `git merge-tree --write-tree <headOrWorktreeBranch> <targetBranch>` 偵測 `hasConflict` 與 `conflictingFiles`（若舊版 Git 不支援 `--write-tree` 則安全降級）。
     - 匯出 `checkTaskBaseDrift`。

2. **`src/server/server.js`**
   - Read Allowlist: `L40-60`, `L710-740`, `L1970-2040`, `L2320-2380`
   - Edit:
     - 匯入 `checkTaskBaseDrift`。
     - 新增共用 helper `prepareTaskWorkspaceOnStart(projPath, task, allTasks)`：
       - `workspaceMode === 'worktree'`（預設）：若為 Git repo 且尚未建立有效 `worktreePath`，自動呼叫 `createTaskWorktree(projPath, task.id, { baseBranch: task.targetBranch || task.baseBranch || undefined })`，回寫 `worktreePath`, `branchName`, `targetBranch`, `baseBranch`, `baseCommit`, `queueState: null`。
       - `workspaceMode === 'branch_stream'` 或 `'in_place'`：檢查同專案是否有其他活躍任務（`status === 'in_progress'`、非待確認、非熔斷、非排隊中）佔用相同工作區（`in_place` 為同專案任何其他 `in_place` 任務；`branch_stream` 為同專案同 `targetBranch` 之 `branch_stream` 任務）。若有佔用者，寫入 `task.queueState = { blockedByTaskId: blocker.id, reason: ..., queuedAt }`；否則設 `queueState = null` 並鎖定 `baseBranch`/`baseCommit`。
     - 於 `POST /api/tasks`（當 `status === 'in_progress'`）、`PUT /api/tasks/:id`（當切換至 `in_progress` 或確認執行）及 `executeTaskWithCliAgent`（若已有有效 `worktreePath` 直接沿用不重複建立）串接 `prepareTaskWorkspaceOnStart`，若進入 `queueState` 則暫緩觸發 `executeTaskWithCliAgent`。
     - 新增 `GET /api/tasks/:taskId/drift-check` 端點，呼叫 `checkTaskBaseDrift` 並回傳 JSON（找不到任務回 404）。

3. **`scripts/watch-task-gate.js`**
   - Read Allowlist: `L235-335`, `L397-425`, `L495-538`
   - Edit:
     - 擴充 `hasRepoConflict(task, taskIndex, allTasks, projects, settings)` 支援 `workspaceMode`（`worktree` 隔離僅檢查 `allowedFiles` 重疊；`branch_stream` 同專案同 `targetBranch` 互斥；`in_place` 同專案 `in_place` 互斥）及 `task.queueState?.blockedByTaskId` 檢查。
     - 新增自足 `ensureWorktreeForSentinelTask(task)`（以 `execFileSync('git', [...])` 在 `workspaceMode === 'worktree'` 且未建 `worktreePath` 時自動建立 `.worktrees/<TASK-ID>` 與 `td/<TASK-ID>` 並回寫 `worktreePath`, `branchName`, `baseCommit`, `baseBranch`, `targetBranch` 至 `tasks.json`）。
     - 於 `claimTaskAndLogEvent(task)` 呼叫 `ensureWorktreeForSentinelTask`，並於 `formatWakeupBrief(task, triggerType)` 顯示 `• 隔離工作區: <worktreePath> (分支: <branchName> ← <targetBranch>)`。

4. **`src/public/modules/kanban.js`**
   - Read Allowlist: `L250-295`
   - Edit:
     - 於 `isInProgress` 卡片區塊中，若 `t.queueState && t.queueState.blockedByTaskId`，渲染白話排隊膠囊徽章 `⏳ 等待 ${escapeHtml(t.queueState.blockedByTaskId)} 完成中`（title: `前一張任務提交後會自動接手開工`），並於狀態列顯示 `排隊等待中`。

5. **`scripts/test_server.sh`**
   - Read Allowlist: `L1100-1145`
   - Edit:
     - 新增 TASK-233 整合測試區塊，驗證：
       1. `workspaceMode: "worktree"` 任務進入 `in_progress` 自動建立 `.worktrees/<TASK-ID>` 並回寫 `worktreePath`, `branchName`, `baseCommit`（測畢清理 worktree）。
       2. 兩張同 `targetBranch` 之 `branch_stream` 任務同時 `in_progress`，第二張自動寫入 `queueState.blockedByTaskId`。
       3. `GET /api/tasks/:taskId/drift-check` 驗證無衝突與衝突飄移之 `behindCount`, `aheadCount`, `hasConflict`, `conflictingFiles`。

## Slices
- `[TASK-233-S1]` 後端 `checkTaskBaseDrift` 與 `GET /api/tasks/:taskId/drift-check`（`gitService.js`, `server.js`）
  - Acceptance: `node -c src/server/services/gitService.js && node -c src/server/server.js`
- `[TASK-233-S2]` 統一開工隔離與排隊狀態 `prepareTaskWorkspaceOnStart` + 哨兵隔離 (`server.js`, `watch-task-gate.js`)
  - Acceptance: `node -c src/server/server.js && node -c scripts/watch-task-gate.js`
- `[TASK-233-S3]` 前端看板白話排隊徽章與整合測試 (`kanban.js`, `test_server.sh`)
  - Acceptance: `npm test && npm run harness:check`
- [x] Slice 1: [TASK-233] 【完整規格書參考】: /Users/nelsonchung/.gemini/antigravity/brain/e2af0773-728f-4e7f-921b-7e059857f00e/spec_project_branch_workflow.md 【前置任務】: TASK-232 【M2 實作目標】 1. 統一 Desktop Agent（watch-task-gate.js + server.js）與 CLI Agent 的獨立工作區開工邏輯：當 workspaceMode === "worktree"（預設）進入 in_progress 時，依鎖定的 targetBranch 自動呼叫 createTaskWorktree 建立 .worktrees/<TASK-ID> 並回寫 worktreePath、branchName、baseCommit（同步釋出 watch-task-gate.js 至 Application Support）。 2. 顯性排隊狀態（queueState）：當「接續同分支 (branch_stream)」或「直接改目前資料夾 (in_place)」遇到同一目標工作區有任務執行中時，回寫 queueState: { blockedByTaskId, reason }，看板卡片以簡單白話顯示「等待 TASK-XXX 完成中」。 3. 新增 GET /api/tasks/:taskId/drift-check：比對 baseCommit 與 targetBranch 最新 SHA 差距，並以無副作用 git merge-tree（或相容方式）預檢是否衝突，回傳 behindCount, aheadCount, hasConflict, conflictingFiles，供前端白話顯示「分支檢查：可直接提交 ✓」或衝突提示。 4. 驗證門禁：補齊隔離建立、queueState 與 drift-check 整合測試，通過 npm test 與 npm run harness:check（Exit Code 0）。

## Return Format
回傳：`modifiedFiles` 清單，以及每個切片的 `{ command, cwd, exitCode, rawLog }`。
