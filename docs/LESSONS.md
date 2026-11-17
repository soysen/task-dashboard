# Task Dashboard 高頻避坑熱區 (Hot Lessons, 硬上限 30 行)

> 規範：每條格式 `- [YYYY-MM-DD] 教訓與避坑規則`。同類教訓出現 >= 2 次時，強制升格至 `scripts/harness_check.sh` 或 `AGENTS.md`，並從本檔移除該行。

- [2026-10-21] SSOT 鐵律：所有任務資料僅可讀寫 `~/Library/Application Support/TaskDashboard/tasks.json` 或 `/api/tasks`，嚴禁污染 `data/tasks.json`。
- [2026-10-29] 大檔讀取（`server.js`、`modal.js` > 500 行）一律先 `grep -n` 定位後切片讀取，避免盲讀耗盡上下文。
- [2026-10-30] `executionLog` 交付必須提供真實指令、退出碼與終端證據；禁止寫入「已完成修改」等單行敷衍字樣或偽造檢查結果。
- [2026-11-06] 拆分 ESM 前端模組時，所有 HTML `onclick`/`oninput` 函式必須同時在 `window.*` 掛載，否則 WebView 點擊事件將拋出 ReferenceError。
- [2026-11-17] 同 Repo 無 Worktree 平行派工必造成 `HEAD` 與未提交檔案互蓋；開工前須鎖定 `baseBranch`/`baseCommit` 並序列化執行 `Rebase → 重驗 → Merge`。
- [2026-11-17] 單卡退回或驗證失敗達 2 輪立即熔斷鎖定 `needs_human`，停止哨兵與 CLI 自動喚醒，改由人類排查根因。
