# Build Plan: [TASK-145] 優化“查看封存任務”

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: 優化“查看封存任務”

## 任務卡 (Task Card)

- 目前任務 ID: TASK-145
- 目標: 查看封存任務時，任務彈窗會出現在封存彈窗後，必須關閉封存任務列表才能閱讀，從資深 UI/UX 設計師角度優化查看封存任務的流程，讓封存任務的查找不會中斷
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: 依執行計劃實作 / Out: 跨專案副作用
- 驗收標準: 執行計劃步驟實作與驗證完成
- 驗證證據: 測試與 Harness 檢驗通過
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: 調整 `taskModal` 與 `archiveModal` 的 Z-Index 階層架構，提升 `taskModal` 至 `z-[70]`，確保子詳情彈窗永遠高於封存母視窗 (`z-50`)。
- [x] Slice 2: 在 `src/public/modules/state.js` 與 `modal.js` 引入 `isOpenedFromArchive` 狀態追蹤。
- [x] Slice 3: 於 `taskModal` 頂部加入情境感知之「‹ 返回封存列表」返回鍵與「已封存」紫色狀態徽章。
- [x] Slice 4: 優化 `closeModal` 邏輯：由封存開啟時僅關閉詳情並保留封存列表之 DOM、篩選器與滾動位置，確保查找任務無縫連貫。
- [x] Slice 5: 實作 ESC 鍵多層彈窗安全出棧機制（Nested Escape Stack），優先關閉頂層任務詳情退回封存庫，再次按 ESC 始退出封存庫。
- [x] Slice 6: 完整手動與自動化檢驗：驗證開啟、閱讀、返回、多筆切換與 ESC 退棧流程。
- [x] Slice 7: 執行 `npm run harness:check` 確保專案規格 100% 合規。
- [x] Slice 8: 產出標準任務執行報告並推進至 review。
