# 📋 Task Dashboard (macOS App & Web Hub)

Task Dashboard 是為本機開發打造的輕量任務看板與 AI 代理人調度中心。結合了 **Cocoa/WebKit 原生 macOS App**、**內嵌 Node.js Web Server**、**macOS 原生專案資料夾選擇** 與 **Antigravity / 本機 CLI Agent 雙軌自動執行引擎**。

---

## 🌟 核心特色

1. **極速原生 macOS 視窗**：
   - 透過 `clang` 編譯出的輕量 Cocoa + WebKit 原生外殼 (`TaskDashboard.app`)。
   - 零快取直接載入 `~/projects/task-dashboard` 本地資源，開發修改立即生效。
2. **雙軌 AI 自動開工引擎**：
   - **Antigravity 引擎**：透過 2 分鐘循環排程監控 `tasks.json`，發現 `in_progress` 自動開工並完成 3-Phase Gate。
   - **本機 CLI Agent 引擎**：支援在 UI 上開啟「CLI Agent 模式」，任務拖入進行中時自動呼叫本機 CLI (`agy` / `claude`) 執行並紀錄輸出日誌。
3. **原生資料夾選擇**：
   - 點擊 UI 上的「選擇資料夾」按鈕即可彈出 macOS 原生 Finder 選擇框，自動引入並鎖定專案。

---

## 🚀 快速指令

```bash
# 1. 執行 Harness 診斷與規範檢核
npm run harness:check

# 2. 執行 API 整合測試
npm test

# 3. 編譯獨立 macOS App (輸出至 dist/TaskDashboard.app)
npm run build:app

# 4. 編譯並直接安裝至桌面 ~/Desktop/TaskDashboard.app
npm run install:desktop

# 5. 本地開發伺服器模式
npm run dev
```

---

## 📁 目錄結構

```text
~/projects/task-dashboard/
├── AGENTS.md                  # AI 代理人規範與 3-Phase Gate SOP
├── HARNESS.md                 # Harness 測試與建置規範
├── package.json               # 專案相依與指令
├── src/
│   ├── native/main.m          # Objective-C Cocoa/WebKit 原生外殼
│   ├── server/server.js       # 後端 HTTP 伺服器與 CLI Agent 派發
│   └── public/index.html      # 前端看板與控制台 UI
├── data/
│   ├── tasks.json             # 任務資料庫
│   ├── projects.json          # 專案列表
│   └── settings.json          # 系統設定 (CLI Agent 開關與指令)
├── scripts/                   # 打包、安裝與測試腳本
└── assets/                    # App 圖示與靜態資源
```
