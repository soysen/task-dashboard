# Task Dashboard - Harness & Build Specification

本文檔定義 `task-dashboard` 的自動化測試、環境檢核與 macOS App 編譯打包規範。

## 1. 指令說明

| 指令 | 說明 |
| :--- | :--- |
| `npm run dev` / `npm start` | 以 Node.js 啟動本地 Web Server (預設 Port: 3030) |
| `npm run harness:check` | 檢查專案結構、相依性、編譯工具鏈與資料庫完整性 |
| `npm test` | 測試後端 REST API (包括任務 CRUD、專案選擇、CLI Agent 介面) |
| `npm run build:app` | 使用 `clang` 編譯原生 Cocoa + WebKit 應用程式至 `dist/TaskDashboard.app` |
| `npm run install:desktop` | 打包並安裝至 `~/Desktop/TaskDashboard.app` |

---

## 2. macOS 原生 App 打包機制

- **編譯器**：`clang -fobjc-arc -framework Cocoa -framework WebKit`
- **架構支援**：Apple Silicon (arm64) / x86_64
- **特性**：
  - 零 Xcode 肥大相依，單腳本毫秒級編譯。
  - 內建生命週期管理：啟動時自動探測 Node.js 並執行背景 Web Server，結束時自動清理 Port 3030 與行程。
  - 停用 WKWebView 快取，直接掛載 `~/projects/task-dashboard` 本地資源，開發修改免重新打包。

---

## 3. 資料庫結構 (`data/`)

- `data/projects.json`: 專案目錄與對話歷程
- `data/tasks.json`: 任務清單、狀態 (todo / in_progress / review / done)、modifiedFiles、diff、executionLog
- `data/settings.json`: 系統全域設定 (enableCliAgent, cliCommand, defaultProject)
