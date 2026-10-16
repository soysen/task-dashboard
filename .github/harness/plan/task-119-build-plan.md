# Build Plan: [TASK-119] UI UX 優化

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: UI UX 優化

## 任務卡 (Task Card)

- 目前任務 ID: TASK-119
- 目標: [退回重做] 審核與執行成果及需求規格與屬性的 tab 在 dark mode 下不明顯
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: `src/public/index.html`, `scripts/test_ui_behavior.js` / Out: 跨專案副作用
- 驗收標準: Tab 容器與按鈕在 Dark Mode 具備高對比深色凹槽背景、清晰邊界與高亮浮起作用中分頁、狀態標籤不換行、全套自動化測試與 Harness Check 通過
- 驗證證據: `node scripts/test_ui_behavior.js && npm test && npm run harness:check` (exit 0)
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: **左欄階段感知分頁化（Contextual Workspace Tabs）**：
- [x] Slice 2: **長文易讀性與排版人體工學（Readability & Typography）**：
- [x] Slice 3: **資訊架構學（Information Architecture）— 分面導覽與認知分塊**
- [x] Slice 4: **漸進式揭露與降低外在認知負荷（Progressive Disclosure & Cognitive Load）**
- [x] Slice 5: **去 AI 味與現代高密度工具極簡美學（De-AI-ifying & Craft UI）**
- [x] Slice 6: **無邊框階層與長文閱讀排版（Visual Hierarchy & Typography）**
- [x] Slice 7: **資料墨水比（Data-Ink Ratio）**
- [x] Slice 8: [TASK-119] [退回重做] 移除阻礙欄位、單一主色+局部狀態色彩計劃（消除螢光紫）、外接螢幕顯色明度階梯校準、無框線色塊+雙層立體陰影系統
- [x] Slice 9: [TASK-119] [退回重做] 任務執行與驗證報告於 Light Mode 下取消區塊陰影，改用清晰分隔線 (`divide-y` / `border-y` / `border-b`) 強化段落與項目辨識度
- [x] Slice 10: [TASK-119] [退回重做] 統一任務執行與驗證報告為圓角淺灰底 (`td-surface-panel rounded-xl`)、建立三階主次標題與縮排對齊層級、並為全系統狀態標籤加上 `whitespace-nowrap flex-shrink-0` 防止換行
- [x] Slice 11: [TASK-119] [退回重做] 簡化任務執行與驗證報告分隔線，僅保留大項目間分隔線（取消子標題內部底線），並強化 Dark Mode 分隔線對比度 (`divide-slate-300 dark:divide-slate-500`)
- [x] Slice 12: [TASK-119] [退回重做] 強化任務彈窗審核與規格 Tab 在 Dark Mode 下的視覺對比度（容器外框 `dark:border-slate-700/80`、凹槽 `dark:bg-slate-950`、作用中分頁 `dark:bg-slate-800` 與外框 `dark:border-slate-600`）
