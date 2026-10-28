# Build Plan: [TASK-156] task commit 遇到 pre-commit 阻斷仍進入封存庫

- Status: done
- Skill Route: none
- Feature Name: task commit 遇到 pre-commit 阻斷仍進入封存庫

## 任務卡 (Task Card)

- 目前任務 ID: TASK-156
- 目標: task-154 審核完點選 commit 時遇到 pre-commit 阻擋，task 仍進入封存庫，應顯示 pre-commit 失敗原因。
- 路由: none
- 範圍 (In/Out): In: 依執行計劃實作 / Out: 跨專案副作用
- 驗收標準: 執行計劃步驟實作與驗證完成
- 驗證證據: test_server.sh, test_ui_behavior.js, harness:check 全數通過
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: 後端 `executeProjectCommit` (`src/server/server.js`)：使用 `buildCustomEnv()`，timeout 提升至 30000ms，捕捉 stderr + stdout 錯誤輸出，回傳 `{ output, isCommitted: false, hasError: true }`
- [x] Slice 2: 後端 `POST /api/tasks/:id/commit` 路由 (`src/server/server.js`)：判斷 `hasError || !isCommitted`，若失敗保留 `task.commitMessage`，嚴禁變更狀態為 `archived`，回傳 HTTP 400 與完整錯誤訊息；僅在 commit 成功時封存並回傳 200
- [x] Slice 3: 前端 `confirmCommitTask` 與 `commitModal` (`src/public/modules/modal.js` & `src/public/index.html`)：新增 `#commitErrorBox` 與 `#commitErrorText`，失敗時顯示錯誤並維持 modal 開啟，不封存；在打開與關閉 modal 時自動重置清空錯誤
- [x] Slice 4: 測試與驗證 (`scripts/test_server.sh` & `scripts/test_ui_behavior.js`)：增加 pre-commit hook 阻斷 400 與不予封存整合測試、UI behavior 前端防禦測試，並通過 `harness:check`
