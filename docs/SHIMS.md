# Task Dashboard — 墊片與防禦門禁登錄表 (Shims & Gates Registry)

本登錄表追蹤所有為了因應特定模型限制（Model Shim）或落實領域安全規範（Domain Gate）所設置的工程防禦與規則墊片。透過 `task-events.jsonl` 與 `scripts/shim_report.js` 實現量化觸發率追蹤，以作為定期淘汰過期模型補丁、持續精簡 Context 的依據。

---

## 1. 墊片與門禁清冊

| ID | 規則條文 | 類型 | 新增原因 / 關聯任務 | 量測方式 | 淘汰標準 / 處置建議 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`SHIM-001`** | `>500 行大檔禁整檔讀`，必須以 `grep -n` 切片 30~50 行檢索 | Model Shim | TASK-079 防範小模型全檔盲讀致使 Context 爆滿與幻覺 | 質性量測：觀察 Feedback 與執行日誌是否再出現讀取超載 | 連續 30 任務無大檔讀取溢位問題時，評估放寬或淘汰 |
| **`SHIM-002`** | 同區塊最多檢索 2 次避免迴圈 | Model Shim | TASK-080 防範模型在同一個函數重覆無效 grep | 質性量測：觀察重試次數與日誌迴圈 | 連續 30 任務無搜尋迴圈時，評估淘汰 |
| **`GATE-001`** | `validateExecutionLog` 阻擋敷衍日誌與非 0 Exit Code | Domain Gate | TASK-113~ 確保交付品質與驗證客觀真實性 | `task-events.jsonl`：`type === "review_gate_rejected"` | **永久保留 (Core Domain Gate)**，不因次數少而淘汰 |
| **`GATE-002`** | Feedback 自癒清理 `healTasksFeedback` | Model Shim | TASK-068 自動修復歷史 review/done 任務殘留 feedback | `task-events.jsonl`：`type === "shim_triggered", shimId === "GATE-002"` | 最近 30 個任務觸發次數為 0 時，代表狀態機流轉健全，建議淘汰 |

---

## 2. 觸發事件記錄格式 (Event Contract)

所有量化 Shim/Gate 觸發事件均以 Append-Only 方式寫入 `~/Library/Application Support/TaskDashboard/task-events.jsonl`：

```json
{
  "timestamp": "2026-10-30T10:30:00.000Z",
  "taskId": "TASK-165",
  "type": "review_gate_rejected",
  "shimId": "GATE-001",
  "reason": "缺少客觀驗證證據（未包含測試指令、Exit Code、PASS 驗證或 3-Phase 驗證記錄）。"
}
```

```json
{
  "timestamp": "2026-10-30T10:30:00.000Z",
  "taskId": "TASK-165",
  "type": "shim_triggered",
  "shimId": "GATE-002",
  "action": "healTasksFeedback"
}
```

---

## 3. 量測報告指令

執行以下指令可統計最近 30 個任務中各 Shim 的觸發率：
```bash
node scripts/shim_report.js
```
