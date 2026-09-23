# Build Plan: Task Dashboard 代理人切片與狀態追蹤 (task-dashboard)

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: Agent Status & Slice Tracking

## 任務卡 (Task Card)

- 目前任務 ID: TASK-048
- 目標: 選擇關聯前置任務不太方便，需要做以下調整： - 任務選項由新到舊排列 - 任務根據專案分類
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: src/server/server.js, .github/worklog, .github/harness/plan / Out: 跨專案副作用
- 驗收標準: 任務進入 in_progress 時及時同步 agent-status，且多任務並行時依 taskId 精準隔離切片與當前步驟，絕不串味
- 驗證證據: scanProjectWorklogAndPlan 測試通過，harness 檢查合格
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: 解析器升級，支援 Markdown Checkbox 切片清單與 Skill Route
- [x] Slice 2: 建立 task-dashboard 原生 .github/worklog/agent-status.md 與 build-plan.md
- [x] Slice 3: 升級看板卡片，高亮呈現 Skill、Route、當下切片進度條與當前執行步驟
- [x] Slice 4: 強化看板動態獲取最新切片與 agent-status（PUT 回傳、Modal 即時 fetch、即時渲染）
- [x] Slice 5: 執行全套測試與 macOS App 打包驗收
- [x] Slice 6: [退回重做] 退回重做時，切片資訊與 agent-status 未根據 退回重做的需求更新
- [x] Slice 7: [退回重做] commit message 只是帶入 title 與 description，不是 agent 產出的結果
- [x] Slice 8: [退回重做] 移除 Commit 預覽與多餘按鈕，驗收完成自動填入 commit 欄位
- [x] Slice 9: [TASK-021] 重構 server.js 核心解析器，依 taskId 嚴格隔離 agent-status 與切片，實作即時合成與狀態流轉雙向同步
- [x] Slice 10: [退回重做] 移除看板任務卡牌上的 feedback 區塊，保持畫面簡潔並統一由切片與 agent-status 呈現當前目標
- [x] Slice 11: [TASK-037] tool-static-web 執行時，有抓到切片並按照 harness 機制進行，但 plan 沒看到更新，都處在未完成狀態。檢視原因並修正 task 進行時的切片更新與驗證
- [x] Slice 12: [TASK-048] 選擇關聯前置任務不太方便，需要做以下調整： - 任務選項由新到舊排列 - 任務根據專案分類

