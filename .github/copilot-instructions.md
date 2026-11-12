# GitHub Copilot Orchestration Guide for Task Dashboard

本指南供 **VS Code GitHub Copilot (Agent Mode / Subagents)** 遵循，確保在 Task Dashboard 協同架構下維持 3-Phase Execution Gate 與契約化交接。

---

## 1. 核心原則與 SSOT
- **單一真實資料庫**：`~/Library/Application Support/TaskDashboard/tasks.json`（或透過 REST API `http://localhost:3030/api/tasks` 存取）。
- **嚴禁污染**：根目錄下的 `data/tasks.json` 僅為初始範本，嚴禁在開發或執行時寫入或覆蓋。
- **負向守門**：嚴禁盲讀 >500 行之大檔（需先以 `grep-n` 切片檢視 30-50 行）；嚴禁跨專案副作用。

---

## 2. 角色分工與 Subagent 調度 (Role-Based Orchestration)

當接獲 Task Dashboard 開工任務時，Copilot 應依據任務階層 (`tier`) 自動調度 Agent Mode / Subagents：

| 階層 (Tier) | 判定條件 | Copilot 調度模式 | 執行職責 |
| :--- | :--- | :--- | :--- |
| **`micro`** | 文案錯字、小樣式、標註 `tier:micro` | **原地執行** (Single Agent) | 原地直接修改與驗證，免啟動額外 Subagent。 |
| **`standard`** | 一般功能開發、局部缺陷修復 | **Planner $\rightarrow$ Fast Subagent** | 主 Agent (Planner) 擬定 `build-plan.md` 的 `Handoff Contract`；指派 Fast / Balanced Subagent 依契約實作；主 Agent 驗收 Diff。 |
| **`heavy`** | 跨模組重構、破壞性變更、`riskDoor: one-way` | **Planner $\rightarrow$ Subagent $\rightarrow$ Verifier** | 主 Agent 擬定切片契約；指派 Subagent 逐片實作；高風險單向門指派獨立 Reasoning Subagent (o1 / o3-mini) 審核。 |

---

## 3. 待確認門禁與需求覆蓋規範
1. **Confirmation Gate**：
   - 若任務標註 `requiresConfirmation: true` 且尚未具備 `executionPlan`，首要任務**僅為產出執行計劃**並回寫 API，**嚴禁搶跑代碼實作或推進 review**。
2. **最高優先級覆蓋宣告**：
   - 若任務描述中包含 `--- 【執行計劃確認意見 / 最新需求覆蓋】 ---` 區塊，其內容具備**最高優先權**。
   - 若該區塊內容與上方舊有需求存在矛盾或規格調整，一律以最新指示為最高準則並覆蓋舊有描述，切勿自行妥協或混雜過時邏輯。

---

## 4. 結案交付規範
代碼實作與專案驗證（`npm test` / `npm run harness:check`）通過後，以結構化 JSON 呼叫：
```bash
curl -X PUT http://localhost:3030/api/tasks/<TASK_ID> \
  -H "Content-Type: application/json" \
  -d '{
    "status": "review",
    "objective": "實作目標說明",
    "rootCause": "根因分析 (缺陷修復時必填)",
    "resolution": "實作與解決方案",
    "keyChanges": ["變更檔案與說明"],
    "testCommand": "npm test",
    "exitCode": 0,
    "testSummary": "驗證命令與測試通過總結"
  }'
```
推進至 Review 並釋放認領鎖。
