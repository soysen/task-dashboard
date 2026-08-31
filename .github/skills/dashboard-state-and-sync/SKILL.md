---
name: dashboard-state-and-sync
description: "規範 Single Source of Truth 資料庫隔離、全量 Diff 收集與 3-Phase Gate 狀態機保護。"
argument-hint: "Task status transitions, database persistence, diff generation, or state reconciliation"
user-invocable: true
---

# Dashboard State Machine & Database Synchronization

## 1. Single Source of Truth 隔離規範

- **唯一真實資料庫**：
  - `~/Library/Application Support/TaskDashboard/tasks.json`
  - `~/Library/Application Support/TaskDashboard/projects.json`
  - `~/Library/Application Support/TaskDashboard/settings.json`
- **倉庫範本防護**：
  - 專案倉庫內的 `data/` 目錄僅作為首次初始化時的結構範本。
  - **嚴禁在執行階段覆寫或污染專案倉庫內的 `data/tasks.json`**。

## 2. 嚴格 3-Phase Execution Gate

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
- **第一優先級門禁**：先檢查 `task.feedback`。若有審查意見，必須將該 Feedback 視為最高優先執行項目（如特定修改、重構、`git stash` 暫存、切換為 `blocked` 等），嚴禁未處理就直接推回 `review`。
- 切換至目標專案路徑，閱讀 `AGENTS.md`、`README.md`、`HARNESS.md`。
- 執行基準測試（如 `npm test`、`npm run harness:check`）。

### Phase 2: 合規實作 (Implementation)
- 僅在該專案的範疇內修改程式碼，不得跨專案產生副作用。

### Phase 3: 全量 Diff 與驗收交付 (Review Promotion)
- 執行專案測試與驗證。
- **全量完整度 Diff 規範**：
  - 必須包含已追蹤 (`git diff HEAD`) 與未追蹤 (`git diff --no-index /dev/null <untracked>`) 檔案。
  - 嚴禁使用 `...` 或占位符替代。
- 將 `modifiedFiles`、`diff`、`executionLog` 寫入 Application Support 資料庫，並將狀態推進至 `review`。

## 3. 防早跳保護 (Anti-Premature Promotion)
- Web Server 後台輪巡或被動檢查不得因「偵測到工作目錄有 git diff」就盲目將任務推至 `review`。
- 狀態變更必須由執行實體（AI 代理人 Phase 3 驗收通過或 CLI Agent 進程結束）主動決定。
