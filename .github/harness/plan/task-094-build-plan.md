# Build Plan: [TASK-094] 取消 markdown 預覽機制

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: 取消 markdown 預覽機制

## 任務卡 (Task Card)

- 目前任務 ID: TASK-094
- 目標: markdown 預覽機制實際效益不高，移除此機制
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: 依執行計劃實作 / Out: 跨專案副作用
- 驗收標準: 執行計劃步驟實作與驗證完成
- 驗證證據: 測試通過
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [-] Slice 1: 需求：markdown 預覽機制實際效益不高，移除此機制。
- [-] Slice 2: 盤點異動標的：
- [-] Slice 3: 精簡 index.html 相關 UI 結構與 JavaScript 程式碼。
- [-] Slice 4: 調整 test_server.sh 測試套件。
- [-] Slice 5: 執行 npm test 與 npm run harness:check 確認 100% 通過。
- [-] Slice 6: 等待使用者審閱並點擊「確認並執行」。
