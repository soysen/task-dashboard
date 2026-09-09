# Build Plan: Task Dashboard 代理人切片與狀態追蹤 (task-dashboard)

- Status: in_progress
- Skill Route: dashboard-state-and-sync
- Feature Name: Agent Status & Slice Tracking

## 任務卡 (Task Card)

- 目前任務 ID: TASK-015
- 目標: [退回重做] 退回重做時，切片資訊與 agent-status 未根據 退回重做的需求更新
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: .github/worklog, .github/harness/plan, 看板卡片即時呈現 Skill/Route/Slice/CurrentStep / Out: 跨專案副作用
- 驗收標準: 看板執行中卡片與彈窗可直觀看見切片目標、進度條、Skill標籤、Route標籤與當前步驟
- 驗證證據: 6項後端 API 測試通過，harness 檢查合格
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: 解析器升級，支援 Markdown Checkbox 切片清單與 Skill Route
- [x] Slice 2: 建立 task-dashboard 原生 .github/worklog/agent-status.md 與 build-plan.md
- [x] Slice 3: 升級看板卡片，高亮呈現 Skill、Route、當下切片進度條與當前執行步驟
- [x] Slice 4: 強化看板動態獲取最新切片與 agent-status（PUT 回傳、Modal 即時 fetch、即時渲染）
- [x] Slice 5: 執行全套測試與 macOS App 打包驗收
- [x] Slice 6: [退回重做] 退回重做時，切片資訊與 agent-status 未根據 退回重做的需求更新

