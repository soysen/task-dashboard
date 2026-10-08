# Build Plan: [TASK-104] 點選”放棄任務“沒有動作

- Status: done
- Skill Route: debugging-and-error-recovery / dashboard-state-and-sync
- Feature Name: 放棄任務按鈕整合、顯示時機控制與 Git Diff Discard 健全化

## 任務卡 (Task Card)

- 目前任務 ID: TASK-104
- 目標: 
  1. 在新增任務與“待處理”(backlog) 欄位的任務不需出現放棄任務。
  2. “刪除任務”與“放棄任務”保留放棄任務，移除多餘的刪除按鈕避免混淆。
  3. 修復點選“放棄任務”無反應問題，跳出確認提示。若有對應的 git diff，則確認是否要 discard changes，確認後 discard 並刪除任務；若無 git diff，則直接刪除任務。
- 路由: debugging-and-error-recovery / dashboard-state-and-sync
- 範圍 (In/Out):
  - In:
    - HTML 結構層級修復：修復 `archiveModal` 標籤閉合問題，使 `taskActionConfirmModal` 正常彈出。
    - 按鈕整合與可見度控制：彈窗移除 `btnDeleteTask` 保留 `btnAbandonTask`；新增任務與 backlog 狀態隱藏放棄按鈕。
    - 放棄與刪除邏輯：有 git diff 提示並支援 discard changes；無 git diff 直接確認刪除。
    - 自動化測試：於 `scripts/test_ui_behavior.js` 補充斷言並跑通 `npm test` 與 `npm run harness:check`。
  - Out:
    - 不改動已封存任務管理 (`archiveModal`) 內之歷史清理邏輯。
- 驗收標準:
  - 待處理欄位卡牌與彈窗均不出現「放棄任務」按鈕。
  - 任務彈窗已無「刪除任務」按鈕，僅保留「放棄任務」。
  - 點擊「放棄任務」能立即開啟確認彈窗，正確顯示 Git Diff 狀態與操作選項。
  - 所有測試與 harness 檢核 100% 通過。
- 阻塞/恢復入口: `.github/worklog/agent-status.md`

## 執行切片規劃 (Slices)

- [x] Slice 1: HTML DOM 結構修復，閉合 `archiveModal` 並使 `taskActionConfirmModal` 移至正確外層層級。
- [x] Slice 2: 彈窗按鈕整合（移除獨立 `btnDeleteTask`，保留 `btnAbandonTask`），並在新增與 backlog 狀態隱藏放棄按鈕。
- [x] Slice 3: 完善卡牌與彈窗之放棄任務確認流程（有 diff 詢問 discard 並刪除；無 diff 直接確認刪除）。
- [x] Slice 4: 撰寫 `test_ui_behavior.js` 單元測試與執行全量驗證。
