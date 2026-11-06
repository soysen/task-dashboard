# Build Plan: [Feature Name]

## 狀態
- Feature name: [Feature Name]
- 日期: 2026-09-24
- 狀態: in_progress

## 任務卡
- 目前任務 ID: TASK-001
- 目標: 實作與驗證目標

## Handoff Contract
- Baseline: [git 分支與 commit hash，例如 main / ff88b2c]
- Impact: [GitNexus upstream 影響分析結果，例如 formatWakeupBrief LOW]
- Edit Targets:
  1. [檔案路徑:Lstart-Lend (改動摘要)]
- Read Allowlist: [允許讀取之檔案與行號區間]
- Do-Not-Read: [禁讀清單，例如 README/HARNESS/CLAUDE/docs/skills 等重複文件]
- Constraints: [最小範圍、零依賴、不得污染 data/、不得 commit、不得呼叫 Task Dashboard API]
- Escalation: [資訊不足時最多額外讀取 2 次，仍不足即停止並回報]
- Return Format:
  - modifiedFiles[]
  - 每個切片：{ command, cwd, exitCode, rawLog }
  - 偏離契約之處或 Escalation 紀錄

## Slices
- [-] Slice 1: [TASK-001] 完成架構設計與驗證準備，驗收：npm run harness:check
- [-] Slice 2: [TASK-001] 核心功能實作與單元測試，驗收：npm test
- [-] Slice 3: [TASK-001] 整合測試與合規交付，驗收：npm test

## 驗收標準
- [ ] 所有單元測試與 Harness 驗證通過
- [ ] 無跨專案副作用
