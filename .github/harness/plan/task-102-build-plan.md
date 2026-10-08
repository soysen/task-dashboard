# Build Plan: [TASK-102] skill 優化

- Status: done
- Skill Route: context-engineering / dashboard-state-and-sync
- Feature Name: 參考 plan-to-build 全面現代化 Task Dashboard 之 Skills 體系

## 任務卡 (Task Card)

- 目前任務 ID: TASK-102
- 目標: 參考 projects/plan-to-build 優化 skills
- 路由: context-engineering
- 範圍 (In/Out):
  - In:
    1. 優化 `.github/skills/` 下的 6 個 Skill（`code-review-and-quality`, `context-engineering`, `dashboard-state-and-sync`, `debugging-and-error-recovery`, `git-workflow-and-versioning`, `macos-app-engineering`）。
    2. 新增 `.github/scripts/validate-skills.js` 驗證腳本。
    3. `package.json` 與 `scripts/harness_check.sh` 整合 Skill 驗證。
  - Out:
    - 不更動伺服器與原生 App 核心執行邏輯。
    - 不更動 `data/` 倉庫範本。
- 驗收標準:
  - 6 個 Skill 全數通過 TOC、前 40 行 Must、freedom 分級、models-tested 與檢核清單斷言。
  - `npm run skills:validate` 及 `npm run harness:check` 100% 綠燈通過。
  - `npm test` 通過無回歸。
- 阻塞/恢復入口: `.github/worklog/agent-status.md`

## 執行切片規劃 (Slices)

- [x] Slice 1: 建立 `.github/scripts/validate-skills.js` 自動驗證器（定義 TOC、前 40 行 Must 規則、Freedom 分級、Checklist 規格斷言）。
- [x] Slice 2: 現代化改造 3 個後端/流程 Skill（`dashboard-state-and-sync`, `git-workflow-and-versioning`, `debugging-and-error-recovery`）。
- [x] Slice 3: 現代化改造 3 個工程/審查 Skill（`code-review-and-quality`, `context-engineering`, `macos-app-engineering`）。
- [x] Slice 4: 整合 `package.json` 與 `scripts/harness_check.sh`，執行全量驗證與 Harness 檢查。
