# Agent Status

- Task ID: TASK-126
- Title: 打開 app 時 UI 字級大小未照設定顯示
- Status: review
- Route: dashboard-state-and-sync
- Current Slice Goal: 完成 TASK-126 修正開啟 App 時 `loadData` 讀取 `/api/settings` 後自動套用已紀錄之 `fontSize` 字級設定，並於 `setAppFontSize` 即時同步持久化至後端
- Current Step: 完成實作、單元測試、App 打包同步與 Harness Check 驗證，推進至 review
- Evidence: `node scripts/test_ui_behavior.js && npm test && npm run harness:check && npm run build:app` (exit 0)
- Resume Entry: `src/public/modules/app.js`, `src/public/modules/state.js`, `scripts/test_ui_behavior.js`
