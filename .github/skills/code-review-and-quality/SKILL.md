---
name: code-review-and-quality
description: "執行多維度程式碼審查與品質檢核。專為 Task Dashboard（Vanilla JS + Tailwind + Node.js HTTP 原生 API + Objective-C App 外殼）打造。"
argument-hint: "描述要審查的範圍或 PR，例如：審查任務狀態機與 Diff 收集邏輯"
user-invocable: true
---

# 程式碼審查與品質 (Code Review & Quality)

## 核心原則與邊界

> **[Task Dashboard 專案守則]**：
> 1. **輕量與防噪音 (Lightweight by default)**：單一檔案微調或小 Bugfix 依靠 `npm run harness:check` 與 `npm test` 通過即可，豁免長篇報告。
> 2. **SSOT 資料庫防護**：嚴格檢查是否遵守 Single Source of Truth，執行階段絕不得覆寫專案倉庫內的 `data/tasks.json`。
> 3. **全量 Diff 完整性**：審查 Phase 3 產出時，檢查 Diff 是否包含 untracked 檔案且無截斷或占位符。
> 4. **大檔掃描規範**：審查時若涉及 > 500 行檔案（如 `src/public/index.html`、`src/server/server.js`），必須使用 `grep -n` 定位切片閱讀，嚴禁全量拉取。

## 適用時機

- 完成較大功能切片或提交 Review 交付審查前。
- 自我審查（Self-Review）：驗收任務是否符合 3-Phase Gate 與 Conventional Commit 規範。
- 重構或修改核心後端伺服器（`src/server/server.js`）與前端面板（`src/public/index.html`）。

## 五維審查框架 (Task Dashboard 專屬)

```text
1. CORRECTNESS   → 程式碼是否符合需求規格？邊界與例外是否完善？
2. SSOT & SYNC   → 是否嚴格寫入 Application Support 資料庫而非覆寫 data/ 範本？
3. SECURITY      → 路徑比對、child_process 呼叫、檔案存取是否安全防逃逸？
4. PERFORMANCE   → 是否避免大檔整檔盲讀？是否有過度輪詢或記憶體洩漏？
5. HARNESS GATE  → harness:check 與測試套件是否 100% 綠燈？
```

### 1. 正確性 (Correctness)
- 狀態流轉是否符合狀態機規則（`todo` ➔ `in_progress` ➔ `review` ➔ `done`）。
- 異動欄位更新是否包含 `updatedAt` 與時間戳。
- 前端 DOM 操作是否具備防禦性 `?.` 或 `document.getElementById` 空值檢查。

### 2. SSOT 與同步 (Single Source of Truth)
- 資料持久化是否指向 `~/Library/Application Support/TaskDashboard/`。
- `git diff` 收集是否涵蓋已追蹤與未追蹤檔案之完整內容。
- Commit 訊息是否鎖定任務原始核心主軸與 Conventional Commit 格式。

### 3. 安全防護 (Security)
- 後端路徑處理使用 `path.resolve` 或安全檢查，防止路徑遍歷。
- 前端使用者文字插入 DOM 時，關鍵位置使用 `escapeHtml()`。

### 4. 效能與 Token 節約 (Performance & Token Efficiency)
- 超過 500 行之大檔嚴禁整檔閱讀，必須以 `grep -n` 鎖定前後 30-50 行切片。
- 單點檢索上限最多 2 次，避免陷入 Loop。

### 5. 驗證清單
```bash
# 必跑檢查
npm run harness:check
npm test
```
