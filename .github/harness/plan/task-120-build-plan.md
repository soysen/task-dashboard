# Build Plan: [TASK-120] UI UX 優化

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: UI UX 優化

## 任務卡 (Task Card)

- 目前任務 ID: TASK-120
- 目標: UI UX 優化（表單加回框線與 borderline focus、無任務卡牌去底色、todo 任務分頁簡化、流程說明遷移至 Header 巡檢位置且以獨立底色/框線與線條連結呈現、開工引擎整合巡檢標示、徹底移除表單 outlined 樣式）
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: `src/public/index.html`, `scripts/test_ui_behavior.js` / Out: 跨專案副作用
- 驗收標準: 流程說明各步驟具備獨立底色與框線並以細線連結、開工引擎整合巡檢標示、表單欄位移除 outlined 樣式保留純淨 borderline focus、無任務卡牌無底色、全套測試通過
- 驗證證據: `node scripts/test_ui_behavior.js && npm test && npm run harness:check` (exit 0)
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: 表單欄位加回外框線 (`border border-slate-300 dark:border-slate-700`) 並徹底移除 `shadow-inner` 內側陰影
- [x] Slice 2: 表單欄位 focus 樣式改為 borderline (`focus:border-sky-500` / `focus:border-amber-500`)，消除外圈 ring 於左側被容器邊界裁切問題
- [x] Slice 3: 看板各階段空狀態「無任務卡片」移除底色 (`td-surface-panel`)，呈現簡潔俐落的純文字排版
- [x] Slice 4: 待處理任務 (`status === 'todo'`) 彈窗比照新增任務，隱藏 `modalLeftWorkspaceTabs` 與 `modalReviewPane`，直接聚焦規格屬性面板
- [x] Slice 5: #modalLeftWorkspaceTabs 移除上方間距（`!mt-0` 與 `hidden` 屬性）、#modalLeftColumn 增加 `pl-1`
- [x] Slice 6: 流程說明移至頂部 Header 原 AI 巡檢位置、開工引擎按鈕整合巡檢狀態標示、表單欄位徹底移除 outlined 樣式保留純 borderline focus
- [x] Slice 7: 流程說明改為各步驟以獨立底色與框線顯示，並將箭頭替換為精緻線條連結
