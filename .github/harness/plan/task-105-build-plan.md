# Build Plan: [TASK-105] 放棄任務的 disacard change 無效

- Status: done
- Skill Route: debugging-and-error-recovery / dashboard-state-and-sync
- Feature Name: 徹底修復放棄任務之 Git Discard Changes 健全機制

## 任務卡 (Task Card)

- 目前任務 ID: TASK-105
- 目標: Plan-to-build 專案中點選“放棄任務”，任務已刪除，但 git diff 仍在，未根據功能 discard changes
- 路由: debugging-and-error-recovery / dashboard-state-and-sync
- 範圍 (In/Out):
  - In:
    - 後端 `server.js`：升級 Git discard 執行邏輯為 `git reset --hard HEAD && git clean -fd`，並提升路徑判斷與例外捕捉。
    - 前端 `index.html`：簡化 `shouldDiscard` 判定，確保 `discardCb.checked` 準確傳遞至 API。
    - 自動化測試：於測試中覆蓋包含 intent-to-add / untracked / staged 檔案時的 discard 驗證。
  - Out:
    - 不改動正常任務之 git commit 邏輯。
- 驗收標準:
  - 專案有 untracked、staged 或 intent-to-add 檔案時，點擊放棄任務並勾選 discard changes，工作區能徹底還原乾淨 (git status 乾淨)。
  - `npm test` 與 `npm run harness:check` 100% 綠燈通過。
- 阻塞/恢復入口: `.github/worklog/agent-status.md`

## 執行切片規劃 (Slices)

- [x] Slice 1: 後端 Git Discard 引擎升級 (`server.js`)，改用 `git reset --hard HEAD && git clean -fd`。
- [x] Slice 2: 前端 Discard 傳參防禦與狀態同步 (`src/public/index.html`)。
- [x] Slice 3: 自動化單元測試與 Harness 驗證 (`test_server.sh`, `test_ui_behavior.js`)。
