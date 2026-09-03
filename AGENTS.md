# Task Dashboard - AI Autonomous Inspection & Dual Automation Standard

## 1. 雙軌自動執行機制 (Dual Automation Engines)

本專案支援 **Antigravity IDE / Desktop** 與 **獨立 CLI Agent** 兩種自動化驅動模式：

### 模式 A：Desktop AI 哨兵待命 (Reactive Wakeup 即時喚醒 / 或 2 分鐘排程)
- **推薦（即時零延遲）**：透過 `run_command`（Antigravity）、`bash`（Claude）或 terminal（Codex/Cursor）在背景啟動哨兵腳本：
  `node "$HOME/Library/Application Support/TaskDashboard/watch-task-gate.js"`
  腳本透過 macOS 原生 FSEvents 在背景靜默守候（0 Token 開銷）。一旦偵測到 `tasks.json` 有任務變更為 `in_progress`，立即 exit(0) 觸發系統 Reactive Wakeup 喚醒 Agent 自動開工！
- **備用（傳統排程）**：若環境無背景終端權限，亦可掛載 2 分鐘一次的循環排程 (`schedule`) 監控 `tasks.json`。
- 一旦偵測到 `status === "in_progress"` 任務，Agent 將自動執行以下 **3-Phase Execution Gate**，完成推進至 `review` 後再次啟動哨兵進入下一輪待命。

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
4. 若本輪處理包含 `task.feedback`，完成前須將 feedback 內容附加寫入 `task.description` 尾端（保留原始需求，並以 `\n\n--- 【歷次審查意見 / Feedback 記錄】 ---\n[Timestamp]\n- <feedback>` 區分歷次回饋），隨後將 `task.feedback` 欄位清空。
5. 將任務狀態推進為 `status: "review"`。
6. 僅將任務記錄寫入唯一真實資料庫（`~/Library/Application Support/TaskDashboard/tasks.json` 或透過 REST API），**嚴禁覆寫專案倉庫內的 `data/tasks.json` 範本檔案**。同步更新 `dashboard.md`。

---

## 3. Single Source of Truth (唯一真實來源規範)

- **專案路徑**：`~/projects/task-dashboard/`
- **前端面板**：`src/public/index.html`
- **後端服務**：`src/server/server.js`
- **原生封裝**：`src/native/main.m`
- **資料庫**：`~/Library/Application Support/TaskDashboard/`（或透過 REST API `http://localhost:3030/api/tasks`）。專案目錄下的 `data/` 僅作為全新檢出時的初始結構範本，執行時不得污染或覆寫。
- **macOS App**：原生 App 將直接載入本地 Web Server，修改原始碼即可即時熱更新。

---

## 4. 狀態機流轉與 Git Diff 判定準則 (State Machine & Diff Criteria)

詳見架構文件 [`docs/STATE_MACHINE_RFC.md`](docs/STATE_MACHINE_RFC.md)：
1. **Diff 為交付成果物而非觸發條件**：Git Diff 絕不得單獨作為任務推進至 `review` 的自動判斷基準。
2. **顯式完工信號**：任務推進必須由執行者（CLI 行程明確輸出完工標記、或 Antigravity 走完 Phase 1~3 門禁）主動發出指令，後端定時巡檢不得因工作區有未提交 diff 就自動推入 `review`。
3. **產物隔離**：任務切換至 `in_progress` 時自動重置前次殘留之 `diff` 與 `modifiedFiles`，避免跨任務殘留造成誤判。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **task-dashboard** (266 symbols, 913 relationships, 11 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/task-dashboard/context` | Codebase overview, check index freshness |
| `gitnexus://repo/task-dashboard/clusters` | All functional areas |
| `gitnexus://repo/task-dashboard/processes` | All execution flows |
| `gitnexus://repo/task-dashboard/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
