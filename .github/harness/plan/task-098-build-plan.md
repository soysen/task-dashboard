# Build Plan: [TASK-098] UI UX 優化

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: UI UX 優化

## 任務卡 (Task Card)

- 目前任務 ID: TASK-098
- 目標: - 按下“確認並執行”，彈窗內容未根據確認後更新狀態；必須關掉彈窗後再重開，評估是要關掉彈窗，還是動態改變 UI 呈現 - 執行 agent 在卡牌上顯示在兩處，移除上方的 tag，保留下方的顯示
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: 依執行計劃實作 / Out: 跨專案副作用
- 驗收標準: 執行計劃步驟實作與驗證完成
- 驗證證據: 瀏覽器隔離 fixture 重現 renderTasks ReferenceError；修復後實際點擊成功自動關閉彈窗、清除待確認標記且 Agent 只顯示一次。Node VM 真實 handler/renderer、隔離 npm test 與 Harness 均通過。
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: [TASK-098] 重現 API 確認成功但 renderTasks 未定義導致關閉彈窗前拋錯；追蹤真實 handler 與既有 renderKanban/renderMetrics。
- [x] Slice 2: [TASK-098] 成功驗證回傳任務後關閉彈窗並即時更新看板；錯誤保留輸入，等待時阻擋重複請求。
- [x] Slice 3: [TASK-098] 移除卡牌上方 Agent tag，保留下方 Agent/CLI 顯示、選單與 assignedAgent 資料。
- [x] Slice 4: [TASK-098] 實際 handler 成功與七類失敗、重複請求、六類 Agent/CLI 字元轉義、瀏覽器成功/HTTP 409 與完整隔離測試驗證通過。

## 架構風險

- inline script 函式在 GitNexus 中未索引，impact 回傳 UNKNOWN，文字確認按鈕 onclick 與渲染入口；以實際函式 VM 測試與瀏覽器操作補足驗證。
- 修改後刷新索引，detect-changes 為 LOW / 0 affected processes；不能據此宣稱前端無風險，圖譜未涵蓋 inline script 行為。
- 僅修改前端，不改後端狀態機，不重新啟動正式服務、不編譯原生外殼；重新載入頁面即可使用。
