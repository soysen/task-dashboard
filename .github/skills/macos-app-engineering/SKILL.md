---
name: macos-app-engineering
description: "指導 Objective-C Cocoa / WebKit 原生外殼開發、進程守護與 clang 極速打包標準。"
argument-hint: "Native macOS app modifications (e.g. main.m, WebKit IPC, Cocoa lifecycle, build scripts)"
user-invocable: true
---

# macOS App Engineering & Cocoa/WebKit Architecture

## 1. 架構概述 (Architecture Overview)

Task Dashboard 的原生外殼採用 **輕量 Objective-C + Cocoa + WebKit** 封裝：
- **原始碼檔案**：`src/native/main.m`
- **打包腳本**：`scripts/build_app.sh` 與 `scripts/install_to_desktop.sh`
- **編譯產物**：`dist/TaskDashboard.app` 與 `~/Desktop/TaskDashboard.app`

## 2. 核心技術規範 (Key Guidelines)

### A. 極速 clang 編譯標準 (Zero Xcode Dependency)
- 嚴禁引入肥大 Xcode 專案檔或 CocoaPods / Carthage。
- 編譯指令統一使用 Apple Clang：
  ```bash
  clang -fobjc-arc -framework Cocoa -framework WebKit \
    -mmacosx-version-min=11.0 \
    -o dist/TaskDashboard.app/Contents/MacOS/TaskDashboard \
    src/native/main.m
  ```

### B. 生命週期與進程守護 (Process Lifecycle & Port 3030 Guardian)
- **伺服器啟動**：原生 App 啟動時自動透過 `NSTask` 啟動 Node.js 背景伺服器 (`src/server/server.js`)。
- **重啟守護**：`self.serverTask.terminationHandler` 監聽伺服器異常退出，並於 1.0 秒內自動重啟。
- **退出清理**：當原生 App 關閉 (`applicationWillTerminate`) 時，必須主動發送 `SIGTERM`/`SIGKILL` 並確認清理 Port 3030 上的佔用進程。

### C. WebKit 視窗與熱載入 (WebKit Hot-Reload)
- **快取控制**：停用 WKWebsiteDataStore 快取，確保開發時修改前端資源（`src/public/index.html`）後重新整理即可即時生效。
- **原生對話框**：資料夾選擇使用原生 `NSOpenPanel` 實作（支援目錄選擇與權限授予）。

## 3. 驗證與發布流程 (Verification & Release)

修改 `src/native/main.m` 或打包腳本後，必須執行：
1. `npm run build:app` - 驗證編譯無警告與錯誤。
2. `npm run install:desktop` - 同步更新至桌面。
3. `npm run harness:check` - 通過門禁檢核。
