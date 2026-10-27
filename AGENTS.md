# Task Dashboard — 專案開發與 AI Agent 指南

本文件為 **Task Dashboard** 專案的架構導覽、開發指令與程式碼規範指南。
> [!NOTE]
> 關於 Task Dashboard 平台的雙軌自動化機制、3-Phase 執行門禁與任務執行報告標準，請參閱平台核心規範：[`docs/AUTOMATION_STANDARD.md`](docs/AUTOMATION_STANDARD.md)。

---

## 1. 專案概述與系統架構

Task Dashboard 是一個專為 AI Pair Programming 與自主 Agent 協作設計的本機輕量任務總控台。系統採用無繁重依賴的極簡架構：

- **原生 macOS 外殼 (Native Host)**：由 Objective-C (`src/native/main.m`) 封裝的輕量 macOS 視窗，內嵌 WebKit (WKWebView) 直接載入本機 Web 服務，修改前端檔案即可享受即時熱更新。
- **後端服務 (HTTP/REST Server)**：基於 Node.js 原生模組 (`http`, `fs`, `path`, `child_process`) 建構，零第三方套件依賴，負責任務調度、API、Git Diff 採集與 CLI Agent 行程管理。
- **前端儀表板 (SPA UI)**：單一檔案前端架構 (`src/public/index.html`)，基於 Vanilla JavaScript 與 Tailwind CSS，提供看板拖曳、雙行號 Git Diff 檢視器、任務執行報告與即時終端輸出。
- **後台哨兵 (Zero-Token Sentinel)**：`scripts/watch-task-gate.js` 運用 macOS 原生 FSEvents 在背景靜默監聽任務狀態，以 0 Token 消耗支援 Desktop AI（Antigravity、Claude 等）即時喚醒。

---

## 2. 目錄架構導覽

```text
task-dashboard/
├── src/
│   ├── native/
│   │   └── main.m                 # 原生 macOS Cocoa / WebKit 封裝應用
│   ├── server/
│   │   ├── server.js              # REST API 伺服器、任務調度與 CLI 行程管理器
│   │   ├── feedbackManager.js     # Feedback 歷史歸檔、結構化執行報告與覆蓋率採集
│   │   └── worklogParser.js       # agent-status.md 與 build-plan.md 雙向同步解析
│   └── public/
│       └── index.html             # 單頁應用前端 (看板、Diff 檢視器、執行報告、設定)
├── scripts/
│   ├── build_app.sh               # 編譯原生 macOS .app 產物
│   ├── harness_check.sh           # 專案 Harness 健康度與規範合規檢查
│   ├── test_server.sh             # 後端 API 與狀態防線整合測試
│   ├── watch-task-gate.js         # 哨兵待命守候腳本 (Reactive Wakeup)
│   ├── start.sh / stop.sh         # 本地服務啟動與關閉腳本
│   └── test_execution_logs.js     # 執行報告結構化單元測試
├── docs/
│   ├── AUTOMATION_STANDARD.md     # 平台雙軌自動化、3-Phase Gate 與執行報告標準
│   ├── STATE_MACHINE_RFC.md       # 狀態機流轉規範與 Git Diff 判定準則
│   └── RETROSPECTIVE.md           # 系統架構演進技術回顧
└── data/                          # 初始資料庫範本 (執行時嚴禁直接寫入此目錄)
```

---

## 3. 開發、測試與 Harness 驗證指令

在進行任何功能修改或交付前，必須在專案根目錄執行以下驗證指令：

- **啟動本地開發伺服器**：
  ```bash
  npm start
  # 預設監聽 http://localhost:3030
  ```
- **執行全套整合測試**：
  ```bash
  npm test
  # 執行 scripts/test_server.sh，包含所有 API、狀態防線與日誌解析測試
  ```
- **執行專案 Harness 規範檢核**：
  ```bash
  npm run harness:check
  # 檢查架構完整度、編譯器、JSON 格式、Diff 完整性與 Skills 規範
  ```
- **單獨執行執行日誌與報告測試**：
  ```bash
  node scripts/test_execution_logs.js
  ```
- **編譯原生 macOS App**：
  ```bash
  npm run build:app
  # 編譯產物輸出至 dist/TaskDashboard.app
  ```

---

## 4. 核心工程規範與開發鐵律

1. **Single Source of Truth (資料庫唯一真實來源)**：
   - 運行期資料庫唯一路徑為：`~/Library/Application Support/TaskDashboard/tasks.json`（或透過 REST API `http://localhost:3030/api/tasks` 存取）。
   - 專案根目錄下的 `data/` 目錄僅為全新檢出時的結構範本，**嚴禁在開發或執行時寫入或污染 `data/tasks.json`**。
2. **零肥大依賴 (Zero Bloat Dependency)**：
   - 後端維護保持純 Node.js 原生 API，嚴禁引入非必要大型 NPM 依賴。
   - 前端維持 Vanilla JavaScript，避免重型框架打包複雜度，確保直接修改即可在 macOS 視窗熱更新。
3. **平台標準遵照 (Platform Execution SOP)**：
   - 執行本專案任務時，須依循 [`docs/AUTOMATION_STANDARD.md`](docs/AUTOMATION_STANDARD.md) 規範：
     - 恪遵 3-Phase Gate（Pre-Flight、Implementation、Review Promotion）。
     - 在支援 Subagent 的環境執行任務時，於條件允許下自動啟用 Subagent 雙階模式（以 `flash` 負責執行實作、再由 `pro` 進行審核把關，並共用 `Workspace: "inherit"`）。
     - 交付時必須產出符合規範的**結構化任務執行報告**，並落實 **Chat-Report Symmetry（對齊回報原則）**。
     - 依任務核心主軸產出標準 Conventional Commit 訊息。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **task-dashboard** (266 symbols, 913 relationships, 11 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST create plan and slice tasks for MEDIUM+ risk.** 若 impact 分析評估為 **MEDIUM（中級）、HIGH（高級）、CRITICAL（極高）** 或 `UNKNOWN`，**必須建立 Implementation Plan 並進行切片處理（Task Slicing）**，分步實作驗證。
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
