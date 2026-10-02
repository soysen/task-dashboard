# Build Plan: [TASK-083] UI 優化

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: UI 優化

## 任務卡 (Task Card)

- 目前任務 ID: TASK-083
- 目標: [退回重做] 更新任務 log
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: 依執行計劃實作 / Out: 跨專案副作用
- 驗收標準: 執行計劃步驟實作與驗證完成
- 驗證證據: 測試通過
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [-] Slice 1: 【高度自適應工具函式】實作 autoResizeTextarea(textarea, minHeight, maxHeight)，計算 scrollHeight 自動調整 height。
- [-] Slice 2: 【生命週期與事件連動】在 openModalForEdit (當 status !== "todo" / 進行中及之後任務) 載入描述時呼叫 autoResizeTextarea；在 todo 或 input 輸入時亦可支援彈性自適應。在 closeModal 或切換回 todo 時重設為預設高度。
- [-] Slice 3: 【樣式與體驗檢核】確保 textarea 的 transition 平滑、不破壞右欄異動檔案與切片資訊之雙欄對齊佈局。
- [-] Slice 4: 建立短文字與長文字任務，驗證彈窗中 textarea 在 in_progress/review/done 狀態下自適應高度（短內容緊湊、長內容自適應且支援 scrollbar）。
- [-] Slice 5: 執行 npm run harness:check 與 npm test 確保全量通過。
