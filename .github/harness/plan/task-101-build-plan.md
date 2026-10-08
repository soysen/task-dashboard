# Build Plan: [TASK-101] 有 grill-me 的專案在任務卡牌看到需確認的內容

- Status: done
- Skill Route: dashboard-state-and-sync / context-engineering
- Feature Name: 專案 Grill-Me 邊界確認在卡牌與彈窗的視覺化與替代處理機制

## 任務卡 (Task Card)

- 目前任務 ID: TASK-101
- 目標: 目前如果專案有 grill-me 機制會確認邊界，需要從 ai chat 選擇，需要有替代機制可從任務彈窗顯示狀態並處理
- 路由: dashboard-state-and-sync
- 範圍 (In/Out):
  - In:
    1. 卡牌（Kanban Card）：依據專案是否具備 `grill-me` 技能與 `requiresConfirmation` 狀態，呈現專屬標籤（`🔥 Grill-Me 邊界待確認`）與需確認摘要。
    2. 彈窗（Task Modal）：擴充執行計劃/邊界確認面板，顯示 Grill-Me 提示、邊界質詢內容、提供快速確認/補充邊界輸入，並於「確認並執行」時一鍵提交。
    3. 測試：補充前端與後端測試案例，確保渲染與狀態流轉正確。
  - Out:
    - 不改變專案其他 Skill 規則或破壞現有 Confirmation Gate 邏輯。
- 驗收標準:
  - 專案帶有 `grill-me` 技能且任務為待確認時，卡牌清楚顯示 Grill-Me 待確認標籤及預覽。
  - 任務彈窗能完整顯示需確認內容，並提供替代處理操作（輸入決策/一鍵確認）。
  - `npm run harness:check`、`npm run skills:validate`、`npm test` 100% 綠燈通過。
- 阻塞/恢復入口: `.github/worklog/agent-status.md`

## 執行切片規劃 (Slices)

- [x] Slice 1: 前端卡牌 (Kanban Card) 增加 Grill-Me 專案識別、邊界待確認徽章與內容摘要區塊。
- [x] Slice 2: 前端彈窗 (Task Modal) 升級邊界確認面板，加入 Grill-Me 專屬指引、預設決策快捷按鈕與邊界修訂支援。
- [x] Slice 3: 整合確認動作 (confirmAndExecuteTask) 與後端更新，確保決策寫回 tasks.json 與 executionLog。
- [x] Slice 4: 撰寫自動化測試 (test_ui_behavior.js)，並執行全量 Harness 與測試驗證。
