# Project Harness & Quality Gate

## 1. 診斷與測試
本專案遵循 Task Dashboard Harness 品質閘門標準與雙寫切片規範。

- **執行 Harness 檢驗**：`npm run harness:check` 或 `bash scripts/harness_check.sh`
- **單元測試**：`npm test`

## 2. 狀態與切片雙寫規範 (Plan & Worklog Sync)
- 進行中任務 (In Progress) 請同步維護 `.github/worklog/agent-status.md` 與 `.github/harness/plan/`。
- 每個非平凡任務均需拆解為獨立可驗證的 Slices。
- 交付審查前需確保全量 Diff (含已追蹤與未追蹤) 完整無占位符。
