# Task Dashboard - AI Autonomous Inspection & Dual Automation Standard

## 1. 雙軌自動執行機制 (Dual Automation Engines)

本專案支援 **Antigravity IDE / Desktop** 與 **獨立 CLI Agent** 兩種自動化驅動模式：

### 模式 A：Antigravity IDE / Desktop (背景 2 分鐘 Cronjob 巡檢)
- 當 Antigravity 啟動或 App 觸發 Web Server 後，Antigravity 會掛載 2 分鐘一次的循環排程 (`schedule`) 監控 `~/Library/Application Support/TaskDashboard/tasks.json`（或 `http://localhost:3030/api/tasks`）。
- 一旦偵測到 `status === "in_progress"` 任務，Antigravity 將自動執行以下 **3-Phase Execution Gate**。

### 模式 B：本機 CLI Agent 自動即時觸發
- 若使用者在 Dashboard 設定中啟用了 **「CLI Agent 模式」**：
- 當任務被建立或拖曳切換至 `in_progress` 時，Web Server 會**立即自動呼叫本機 CLI 指令**（預設為 `agy` 或自訂 CLI 工具），將當前專案目錄與任務內容帶入執行。
- CLI 執行完畢後，執行日誌 (stdout/stderr) 會自動同步回 `tasks.json` 的 `executionLog`，並將任務推進至 `review` 階段。

---

## 2. 嚴格 3-Phase Execution Gate (執行 SOP)

不論由 Antigravity 還是 CLI Agent 驅動，所有 AI 代理人皆須恪遵三階段門禁標準：

### Phase 1: Pre-Flight & Review Feedback Ingestion (審查回饋與前置檢閱)
1. **最高優先級門禁（Review Feedback 檢查）**：
   - 讀取任務物件中的 `task.feedback`。
   - **若 `feedback` 包含內容**：該內容代表使用者對前次審查提出的最高指示（如具體修改、重構、暫存 `git stash`、切換狀態至 `blocked` 等）。AI **必須優先將 Feedback 作為本次開工的絕對目標**，嚴禁在未滿足 Feedback 要求前直接判斷為已完成並推回 `review`。
2. 切換至目標專案路徑 (`~/projects/<project>`)。
3. **閱讀架構規範文檔**：
   - `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`、`README.md`、`HARNESS.md`
4. 執行該專案的診斷或 Harness 指令（如 `npm run harness:check` 或測試套件）。

### Phase 2: Rule-Compliant Implementation (合規實作)
1. 嚴格遵守該專案的目錄架構與狀態流轉規則。
2. 僅在該專案的範疇內修改程式碼，不得跨專案產生不相關的副作用。

### Phase 3: Compliance Manifest & Review Promotion (合規驗證與交付)
1. 執行該專案的測試與驗證指令（如 `npm test`、`npm run build:app`）。
2. 更新 `tasks.json`（**全量完整度規範**）：
   - 記錄實際修改檔案 `modifiedFiles`
   - 記錄產生的 `diff`：**必須包含已追蹤 (`git diff HEAD`) 與未追蹤 (`git diff --no-index /dev/null <untracked>`) 檔案之全量完整無截斷 diff**。嚴禁使用 `...` 或占位符文字替代。
   - 填寫詳細的 `executionLog`（包含：檢閱文檔、遵循規範、測試結果）
3. 標準 Tasks 回寫 Node.js 指令範例：
   ```bash
   node -e '
   const fs = require("fs"); const { execSync } = require("child_process");
   const projPath = "<project_path>";
   const tracked = execSync("git -C \"" + projPath + "\" diff HEAD", { encoding: "utf8" });
   const status = execSync("git -C \"" + projPath + "\" status --porcelain -uall", { encoding: "utf8" });
   let untrackedDiff = "";
   const lines = status.split("\n").filter(l => l.length >= 4);
   lines.filter(l => l.startsWith("??")).map(l => l.slice(3).trim()).forEach(f => {
     try { untrackedDiff += "\n\n" + execSync("git -C \"" + projPath + "\" --no-pager diff --no-index /dev/null \"" + f + "\"", { encoding: "utf8" }); }
     catch(e) { untrackedDiff += "\n\n" + (e.stdout || ""); }
   });
   const fullDiff = tracked + untrackedDiff;
   // 回寫 tasks.json
   '
   ```
4. 將任務狀態推進為 `status: "review"`。
5. 僅將任務記錄寫入唯一真實資料庫（`~/Library/Application Support/TaskDashboard/tasks.json` 或透過 REST API），**嚴禁覆寫專案倉庫內的 `data/tasks.json` 範本檔案**。同步更新 `dashboard.md`。

---

## 3. Single Source of Truth (唯一真實來源規範)

- **專案路徑**：`~/projects/task-dashboard/`
- **前端面板**：`src/public/index.html`
- **後端服務**：`src/server/server.js`
- **原生封裝**：`src/native/main.m`
- **資料庫**：`~/Library/Application Support/TaskDashboard/`（或透過 REST API `http://localhost:3030/api/tasks`）。專案目錄下的 `data/` 僅作為全新檢出時的初始結構範本，執行時不得污染或覆寫。
- **macOS App**：原生 App 將直接載入本地 Web Server，修改原始碼即可即時熱更新。

