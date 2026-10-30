# Task Dashboard — AI Agent 指南

本機輕量任務總控台：原生 macOS 外殼 (Cocoa/WebKit) + Node.js 零依賴 REST Server + Vanilla JS 單頁前端。

## 核心指令
- `npm start`：啟動本地伺服器 (`http://localhost:3030`)
- `npm test`：執行全套整合測試 (`scripts/test_server.sh`)
- `npm run harness:check`：執行 Harness 規範檢核
- `npm run build:app`：編譯原生 macOS App (`dist/TaskDashboard.app`)

## SSOT 資料庫鐵律
- 唯一真實資料庫路徑：`~/Library/Application Support/TaskDashboard/tasks.json`（或透過 REST API `/api/tasks` 存取）。
- 專案根目錄下 `data/` 僅為初始範本，**嚴禁在開發或執行時寫入或污染 `data/tasks.json`**。

## 負向守門邊界 (Never Do)
- 嚴禁整檔盲讀大檔（>500 行以 grep-n 切片）；嚴禁未經 Impact Analysis 任意搜尋取代。
- 嚴禁引入大型第三方套件（保持純 Node.js 原生模組與原生前端）。
- 純調查任務嚴禁變更原始碼；實作僅限任務最小必要範圍，禁止跨專案副作用。

## 平台標準與能力路標 (Navigation Roadmaps)
- **平台執行標準 (3-Phase Gate & 3-Tier Routing)**：參閱 [`docs/AUTOMATION_STANDARD.md`](docs/AUTOMATION_STANDARD.md)。
- **架構狀態機與門禁規範**：參閱 [`docs/STATE_MACHINE_RFC.md`](docs/STATE_MACHINE_RFC.md)。
- **專案 Skills 模組**：參閱 `.github/skills/`。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence
- **Impact Analysis**：`node .gitnexus/run.cjs impact <symbol> --direction upstream --repo .` (修改前必跑)
- **Change Detect**：`node .gitnexus/run.cjs detect-changes --scope all --repo .` (提交前必跑)
- **詳細指南**：參閱 `.claude/skills/gitnexus-guide/SKILL.md`
<!-- gitnexus:end -->
