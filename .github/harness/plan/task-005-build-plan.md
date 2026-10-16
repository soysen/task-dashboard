# Build Plan: [TASK-005] refactor(ui): 拆分 index.html 為靜態 CSS 與模組化 JS

- Status: done
- Skill Route: dashboard-state-and-sync
- Feature Name: refactor(ui): 拆分 index.html 為靜態 CSS 與模組化 JS

## 任務卡 (Task Card)

- 目前任務 ID: TASK-005
- 目標: 【任務目標】 將當前長達 6,200+ 行的單檔 src/public/index.html 進行靜態分離與原生模組化： 1. 抽離 <style> 樣式至 src/public/style.css 2. 抽離核心 JS 邏輯並以原生 ES Modules (<script type="module">) 拆分為模組 (app.js, kanban.js, modal.js, diffViewer.js, executionReport.js) 3. 維持零打包工具 (No Webpack/Vite) 與修改即熱更新特性 4. 同步更新所有測試 (test_ui_behavior.js, test_confirmation_ux.js, harness_check.sh) 確保驗證無縫通過 【範疇邊界】 - In: src/public/ (index.html, style.css, modules/*.js), scripts/ 測試相容性 - Out: HTML 結構不作非同步 fetch 拆分，避免 FOUC 與生命週期競態；不修改後端 API 與原生 main.m
- 路由: dashboard-state-and-sync
- 範圍 (In/Out): In: 依執行計劃實作 / Out: 跨專案副作用
- 驗收標準: 執行計劃步驟實作與驗證完成
- 驗證證據: 測試通過
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Slices
- [x] Slice 1: 零依賴打包：維持純原生 ES Modules，後端 static server 直接託管，零 Webpack/Vite 複雜度。
- [x] Slice 2: 熱更新保留：直接修改 JS/CSS 檔案，macOS 原生視窗按 Cmd+R 即可秒級重整生效。
- [x] Slice 3: 測試 Harness 無縫銜接：更新 test_ui_behavior.js 與 test_confirmation_ux.js，確保測試讀取拆分後的檔案或模組。
- [x] Slice 4: [TASK-005] 【任務目標】 將當前長達 6,200+ 行的單檔 src/public/index.html 進行靜態分離與原生模組化： 1. 抽離 <style> 樣式至 src/public/style.css 2. 抽離核心 JS 邏輯並以原生 ES Modules (<script type="module">) 拆分為模組 (app.js, kanban.js, modal.js, diffViewer.js, executionReport.js) 3. 維持零打包工具 (No Webpack/Vite) 與修改即熱更新特性 4. 同步更新所有測試 (test_ui_behavior.js, test_confirmation_ux.js, harness_check.sh) 確保驗證無縫通過 【範疇邊界】 - In: src/public/ (index.html, style.css, modules/*.js), scripts/ 測試相容性 - Out: HTML 結構不作非同步 fetch 拆分，避免 FOUC 與生命週期競態；不修改後端 API 與原生 main.m

