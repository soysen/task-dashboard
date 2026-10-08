---
name: dashboard-state-and-sync
description: "規範 Single Source of Truth 資料庫隔離、全量 Diff 收集與 3-Phase Gate 狀態機保護。使用時機：任務狀態流轉、資料庫持久化、全量 diff 生成或狀態同步核對時觸發。"
argument-hint: "Task status transitions, database persistence, diff generation, or state reconciliation"
user-invocable: true
freedom: low
models-tested: [flash, sonnet, opus]
---

# Dashboard State Machine & Database Synchronization

## 目錄
1. [硬性規則 (Must)](#硬性規則-must)
2. [適用時機與豁免規則](#適用時機與豁免規則)
3. [Single Source of Truth 隔離規範](#single-source-of-truth-隔離規範)
4. [嚴格 3-Phase Execution Gate](#嚴格-3-phase-execution-gate)
5. [防早跳保護 (Anti-Premature Promotion)](#防早跳保護-anti-premature-promotion)
6. [完成前檢核](#完成前檢核)

## 硬性規則 (Must)
1. **[MUST] SSOT 資料庫嚴格隔離**：所有讀寫操作必須以 `~/Library/Application Support/TaskDashboard/` 為唯一真實資料庫，嚴禁覆寫專案倉庫範本 `data/tasks.json`。
2. **[MUST] 優先滿足 Feedback**：若任務具備 `task.feedback`，必須將其視為第一優先執行目標，未滿足前嚴禁直接推進至 `review`。
3. **[MUST] 執行計劃確認門禁 (Confirmation Gate)**：若勾選 `requiresConfirmation: true` 且尚未產出計劃，首要任務為回寫 `task.executionPlan` 並維持 `in_progress`；未獲授權嚴禁實作。
4. **[MUST] 全量完整 Diff 收集**：Phase 3 交付之 diff 必須包含已追蹤與未追蹤 (`--no-index`) 檔案，嚴禁使用 `...` 占位符或截斷。
5. **[MUST] 大檔切片檢索 (Anti-Loop)**：> 500 行檔案一律使用 `grep -n` 定位後閱讀前後 30-50 行，單點檢索上限 2 次。

## 適用時機與豁免規則
- **適用時機**：任務狀態流轉（`todo` ➔ `in_progress` ➔ `review` ➔ `done`）、資料庫寫入、全量 Diff 收集或檢驗。
- **豁免規則**：單純只讀查詢任務列表或執行健康度檢測，無需產生 Diff 或推進狀態。

## Single Source of Truth 隔離規範

- **唯一真實資料庫 (SSOT)**：
  - `~/Library/Application Support/TaskDashboard/tasks.json`
  - `~/Library/Application Support/TaskDashboard/projects.json`
  - `~/Library/Application Support/TaskDashboard/settings.json`
- **倉庫範本防護**：
  - 專案倉庫內的 `data/` 目錄僅作為首次初始化時的結構範本。
  - **嚴禁在執行階段覆寫或污染專案倉庫內的 `data/tasks.json`**。

## 嚴格 3-Phase Execution Gate

所有任務狀態流轉必須遵循三階段門禁：

```text
[todo] ──► [in_progress] ──► [review] ──► [done] / [archived]
                 │              ▲
                 ▼              │ (通過 Phase 3 門禁後才允許推進)
           Phase 1: 前置檢閱
           Phase 2: 合規實作
           Phase 3: 驗證與交付
```

### Phase 1: 審查回饋與前置檢閱 (Pre-Flight & Feedback Ingestion)
- **第一優先級門禁**：先檢查 `task.feedback`。若有審查意見，必須將該 Feedback 視為最高優先執行項目，嚴禁未處理就直接推回 `review`。
- **需確認後執行門禁 (Execution Plan Confirmation Gate)**：若任務勾選 `requiresConfirmation: true` 且尚未產出 `executionPlan`，Agent 必須先產出執行計劃回寫至 `task.executionPlan` 進入「待確認」狀態；在使用者點擊「確認並執行」前嚴禁直接實作。
- 切換至目標專案路徑，閱讀 `AGENTS.md`、`README.md`、`HARNESS.md`。
- **大檔掃描與 Token 節約鐵律**：面對 > 500 行大檔禁止整檔閱讀，必須以 `grep -n` 定位關鍵行號後切片閱讀前後 30-50 行；同一檔案片段檢索上限 2 次，避免陷入 Loop。
- 執行基準測試（如 `npm test`、`npm run harness:check`）。

### Phase 2: 合規實作 (Implementation)
- 僅在該專案的範疇內修改程式碼，不得跨專案產生副作用。
- 遵守大檔切片讀取規範，依最小變更範圍完成實作與補齊測試。

### Phase 3: 全量 Diff 與驗收交付 (Review Promotion)
- 執行專案測試與驗證。
- **全量完整度 Diff 規範**：
  - 必須包含已追蹤 (`git diff HEAD`) 與未追蹤 (`git diff --no-index /dev/null <untracked>`) 檔案。
  - 嚴禁使用 `...` 或占位符替代。
- 將 `modifiedFiles`、`diff`、`executionLog` 寫入 Application Support 資料庫，並將狀態推進至 `review`。

## 防早跳保護 (Anti-Premature Promotion)
- Web Server 後台輪巡或被動檢查不得因「偵測到工作目錄有 git diff」就盲目將任務推至 `review`。
- 狀態變更必須由執行實體（AI 代理人 Phase 3 驗收通過或 CLI Agent 進程結束）主動決定。

## 完成前檢核
- [ ] 已確認讀寫目標為 Application Support 資料庫，專案 `data/` 範本未受污染。
- [ ] 若有 `task.feedback`，已在實作中完全落實並於交付時清空歸入 description。
- [ ] 收集之 `diff` 涵蓋所有新增、刪除與修改之程式檔案，無任何截斷省略符。
- [ ] `npm test` 與 `npm run harness:check` 測試 100% 通過。
