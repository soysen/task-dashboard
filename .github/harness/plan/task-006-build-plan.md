# Build Plan: [TASK-006] test(slices): 4-Slice 即時進度更新與看板輪詢驗證

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: test(slices): 4-Slice 即時進度更新與看板輪詢驗證

## 任務卡 (Task Card)

- 目前任務 ID: TASK-006
- 目標: 用於即時驗證切片流轉：看板標籤 (切片 X/4)、進度條比例與彈窗切片狀態的即時平滑同步
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: 依執行計劃實作 / Out: 跨專案副作用
- 驗收標準: 執行計劃步驟實作與驗證完成
- 驗證證據: 測試通過
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: 前端 loadData 輪詢循環整合 /api/tasks/:id/slice-info 動態更新彈窗切片
- [x] Slice 2: 看板 in_progress 卡片整合切片計數視覺化標籤
- [x] Slice 3: 輪詢快取防抖與本機 I/O 輕量化保護
- [x] Slice 4: 測試腳本 scripts/test_ui_behavior.js 驗證與 Harness 規範合規