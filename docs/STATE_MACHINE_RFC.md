# RFC: Task Dashboard 任務狀態機與 Git Diff 判定準則 (State Machine & Diff Criteria)

## 1. 背景與問題陳述 (Background & Problem)

在目前的 Task Dashboard 機制中，曾出現以下狀況：
> *「如果有專案當下有 diff file，但又有 task 從待處理 (todo) 放到進行中 (in_progress)，會因為專案工作區存在 diff 而直接被系統移動到待驗證 (review)。除非給了 review 才會繼續進行處理。diff 檔應該是 task status 被改變的基準嗎？有沒有其他方式可以辨別？」*

### 核心痛點分析：
1. **工作區狀態 (Workspace State) 與任務成果 (Task Outcome) 混淆**：
   - Git Diff 是整個專案 Working Directory 的當前狀態。
   - 若前一個任務尚未 commit、或者開發者手動修改了代碼，該專案的工作區就會處於 "dirty" 狀態。
   - 原後端 `reconcileTasks()` 機制每 30 秒輪詢，當發現任務處於 `in_progress` 且工作區有 diff 時，直接將其判定為「已完工」並強行推進至 `review`，造成新任務尚未開始實作即被誤判完成（False Positive Completion）。
2. **多代理人 (Dual Automation Engines) 權責衝突**：
   - 任務若由 Antigravity 或人工負責 (`assignee !== "CLI"`)，其生命週期由外部代理人自主驅動。
   - 後端若僅憑「無活躍 CLI 行程 + 工作區有 diff」就單方面篡改任務狀態，會嚴重干擾 Antigravity 的 3-Phase Gate 運作。

---

## 2. 核心結論：diff 檔不應作為 status 被改變的觸發基準

### 結論：
**Git Diff 絕對不應單獨作為任務狀態被改變的觸發基準（Trigger）。**
- **Diff 的本質是「成果交付物 (Deliverable/Artifact)」**，而非「狀態轉移條件 (State Transition Trigger)」。
- 唯有在「確認任務實作完成」之後，才去擷取 diff 作為審查依據；絕不可倒果為因，因為偵測到 diff 就將任務標記為完成。
- 部分任務根本不產生代碼 diff（如架構設計討論、效能調研、環境排查、代碼檢核等），純依賴 diff 判定會導致此類任務永遠無法正常流轉。

---

## 3. 更可靠的任務狀態辨別與流轉機制 (Alternative Recognition Mechanisms)

建議並已落地的四重判定機制：

### 機制一：顯式完工信號 (Explicit Completion Manifest & Agent Signaling)
- **原則**：狀態轉移為 `review` 必須由執行者（Agent、CLI 或開發者）主動發出**顯式信號**（Explicit Signal），後端絕不可因計時器逾時而自動「猜測」完工。
- **實作**：
  - CLI Agent 模式：後端僅在行程結束且日誌中包含明確完工標記（`CLI Agent 執行完畢`）時，才收集 diff 並推進。
  - Antigravity 模式：由 Antigravity 走完 Phase 1~3 後，主動透過 API/檔案回寫將狀態更新為 `review`，後端 `reconcileTasks()` 嚴禁對 Antigravity 任務進行推進。

### 機制二：進度隔離與產出重置 (Clean Slate on in_progress)
- **原則**：任務一旦從 `todo` 切換至 `in_progress`，必須徹底清除前次遺留的產物。
- **實作**：
  - 在後端 `PUT /api/tasks/:id` 中，當狀態轉為 `in_progress` 時，自動將 `diff` 重置為 `""`、`modifiedFiles` 重置為 `[]`。
  - 確保任務在開工當下呈現乾淨的待交付狀態。

### 機制三：基準快照與增量 Delta Diff 比對 (Git Baseline Snapshot)
- **原則**：只計算該任務執行期間新產生的變更，排除開工前已存在的既有髒污。
- **實作**：
  - 任務開工時記錄專案當下的 commit hash (`git rev-parse HEAD`) 與未提交檔案清單（Baseline）。
  - 交付驗收時，比對相對於 Baseline 的 Delta 異動，避免將前一個任務的殘留代碼算入新任務。

### 機制四：品質門禁驗收 (Quality Gate Verification)
- **原則**：代碼變更必須伴隨測試或 Harness 檢核通過 (`exitCode === 0`)，才具備進入 `review` 的資格。

---

## 4. 本次架構調整實作清單

1. **修正 `src/server/server.js` 中的 `reconcileTasks()`**：
   - 增加檢查：`if (t.assignee !== "CLI") return;`，嚴禁干涉 Antigravity 或非 CLI 任務。
   - 移除無行程時「偵測到 diff 即推進 review」的盲目推斷邏輯；若 CLI 行程異常退出且無完工日誌，安全退回 `todo`，不再誤抓工作區 diff。
2. **修正 `src/server/server.js` 中的狀態更新路由**：
   - 切入 `in_progress` 時，自動初始化清空舊有 `diff` 與 `modifiedFiles`。
3. **更新 `AGENTS.md` 狀態流轉章節**：
   - 明確收錄此狀態機判定規範，作為後續所有開發與 AI 代理人的最高遵循標準。
