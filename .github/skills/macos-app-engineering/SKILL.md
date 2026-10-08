---
name: macos-app-engineering
description: "指導 Objective-C Cocoa / WebKit 原生外殼開發、進程守護與 clang 極速打包標準。使用時機：修改原生 Cocoa 外殼 main.m、WebKit IPC、打包發布或守護 Node.js 進程時觸發。"
argument-hint: "Native macOS app modifications (e.g. main.m, WebKit IPC, Cocoa lifecycle, build scripts)"
user-invocable: true
freedom: medium
models-tested: [flash, sonnet, opus]
---

# macOS App Engineering & Cocoa/WebKit Architecture

## 目錄
1. [硬性規則 (Must)](#硬性規則-must)
2. [適用時機與豁免規則](#適用時機與豁免規則)
3. [架構概述 (Architecture Overview)](#架構概述-architecture-overview)
4. [核心技術規範 (Key Guidelines)](#核心技術規範-key-guidelines)
5. [驗證與發布流程 (Verification & Release)](#驗證與發布流程-verification--release)
6. [完成前檢核](#完成前檢核)

## 硬性規則 (Must)
1. **[MUST] Zero Xcode 依賴**：嚴禁引入 Xcode 專案檔或 CocoaPods/Carthage；必須使用 Apple Clang 命令列直接編譯。
2. **[MUST] Port 3030 與子進程乾淨回收**：原生 App 關閉 (`applicationWillTerminate`) 時必須徹底終止 Node.js 伺服器並釋放 Port 3030，嚴禁孤兒進程。
3. **[MUST] 異常退出自動守護**：伺服器異常終止時必須透過 `terminationHandler` 於 1.0 秒內重啟。
4. **[MUST] 禁用 WebKit 快取**：開發外殼必須停用 WKWebsiteDataStore 快取，以支援前端熱載入。

## 適用時機與豁免規則
- **適用時機**：更動 `src/native/main.m` 原生代碼、調整打包腳本 `scripts/build_app.sh`、或原生與 WebKit IPC 互動時。
- **豁免規則**：純前端介面或純 Node.js 後端 API 修改，無需重新編譯原生 App。

## 架構概述 (Architecture Overview)

Task Dashboard 的原生外殼採用 **輕量 Objective-C + Cocoa + WebKit** 封裝：
- **原始碼檔案**：`src/native/main.m`
- **打包腳本**：`scripts/build_app.sh` 與 `scripts/install_to_desktop.sh`
- **編譯產物**：`dist/TaskDashboard.app` 與 `~/Desktop/TaskDashboard.app`

## 核心技術規範 (Key Guidelines)

### A. 極速 clang 編譯標準 (Zero Xcode Dependency)
- 嚴禁引入肥大 Xcode 專案檔或外部套件管理器。
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

## 驗證與發布流程 (Verification & Release)

修改 `src/native/main.m` 或打包腳本後，必須執行：
1. `npm run build:app` - 驗證編譯無警告與錯誤。
2. `npm run install:desktop` - 同步更新至桌面。
3. `npm run harness:check` - 通過門禁檢核。

## 完成前檢核
- [ ] 原生代碼編譯無 Clang Warning 或 Error。
- [ ] 退出原生 App 時確認背景 Node.js 伺服器與 Port 3030 乾淨釋放。
- [ ] 通過 `npm run harness:check` 門禁檢核。
