# Build Plan: [TASK-211] 優化開工引擎調度策略：支援 Antigravity Swarm 分層派工與 Cross-Model 額度自適應

- Status: done
- Skill Route: code-review-and-quality
- Feature Name: 優化開工引擎調度策略
- Tier: heavy (Planner→Executor)

## 任務卡 (Task Card)

- 目前任務 ID: TASK-211
- 目標: 針對 Antigravity Provider 於 `heavy` / `cross-model-review` / `one-way` 任務擴充 Swarm 分層調度與 Cross-Model 額度自適應指引，維持 `micro`/`standard` 零額外開銷與跨平台中立
- 路由: code-review-and-quality
- 範圍 (In/Out): In: `src/server/agentProviderAdapter.js`、`scripts/test_agent_provider_adapter.js` / Out: `data/` 範本、非 Antigravity 平台策略污染、`git commit`
- 驗收標準: `node scripts/test_agent_provider_adapter.js` 與 `npm run harness:check` 全數通過 (exitCode: 0)
- 驗證證據: `node scripts/test_agent_provider_adapter.js && npm run harness:check`
- 阻塞/恢復入口: .github/worklog/agent-status.md

## Handoff Contract

- **Baseline**: `main` @ `01f2662`
- **Impact**: `formatTierStrategy` 由 `src/server/server.js:636`、`scripts/watch-task-gate.js:310` 與 `scripts/test_agent_provider_adapter.js` 呼叫；修改須保持單行無換行，並保留既有測試契約關鍵字（`pro Verifier (Model: "pro", Workspace: "inherit")`、`0 讀碼第 1 步`、`Model: "inherit"`、`cross-model-review`）。
- **Edit Targets**:
  1. `src/server/agentProviderAdapter.js:L6-L16` — 於 `PROVIDER_MATRIX.antigravity` 新增 `nativeSwarm: true` 旗標（其餘 Provider 不加）。
  2. `src/server/agentProviderAdapter.js:L92-L106` — 於 `formatTierStrategy()` 的 `tier === 'heavy'` 分支中：
     - 保留既有單行策略與所有既有契約字樣（`provider.nativeOrchestrator`、`0 讀碼第 1 步立即交棒內建執行階段 (${provider.directExecutor})`、`Model: "inherit"`、`provider.fastExecutor`、`cross-model-review`、`${provider.reasoningVerifier}`）。
     - 僅當 `provider.nativeSwarm === true` 時，於同一行尾端附加精簡 Swarm 分層調度與 Cross-Model 額度自適應指引：
       `；平行切片或 cross-model-review 可開 swarm（Coordinator 不寫碼，實作派 gemini-4-hydrogen-medium/low 或 gemini-3.8-flash-medium + workspace:"share"；審查禁 inherit，先查 swarm({action:"models",all:true}) 依額度選 claude-opus-5-5-high→gemini-4-argon-high，無額度再 fallback ${provider.reasoningVerifier}，僅傳規格/git diff/測試輸出）。`
     - `micro` 與 `standard` 分支維持不變（嚴禁出現 `swarm`）。
  3. `scripts/test_agent_provider_adapter.js:L72-L94` — 補齊單元測試斷言：
     - `antigravity` `micro` / `standard` 不得包含 `swarm`。
     - `antigravity` `heavy` 必須包含 `swarm`、`Coordinator 不寫碼`、`gemini-4-hydrogen-medium/low`、`gemini-3.8-flash-medium`、`workspace:"share"`、`審查禁 inherit`、`swarm({action:"models",all:true})`、`claude-opus-5-5-high`、`gemini-4-argon-high`、`pro Verifier (Model: "pro", Workspace: "inherit")` 且無換行。
     - `claude` / `codex` / `copilot` / `generic` 的 `heavy` 策略不得包含 `gemini-4-hydrogen` 或 `swarm({action:"models"`。
- **Read Allowlist**:
  - `src/server/agentProviderAdapter.js:L1-L112`
  - `scripts/test_agent_provider_adapter.js:L70-L140`
- **Do-Not-Read**:
  - `README.md`, `HARNESS.md`, `CLAUDE.md`, `docs/`, `.github/skills/`, 其他 build-plan 檔案, `src/server/server.js`, `src/public/`
- **Constraints**:
  - 僅修改 `src/server/agentProviderAdapter.js` 與 `scripts/test_agent_provider_adapter.js`
  - 維持策略輸出為單行無 `\n`
  - 嚴禁寫入 `data/` 範本
  - 不得執行 `git commit`
  - 不得呼叫 Task Dashboard API
- **Escalation**: 資訊不足時最多額外讀取 2 次，仍不足即停止並向主 Agent 回報缺口。
- **Slices**:
  - [x] Slice 1: [TASK-211] 更新 `src/server/agentProviderAdapter.js` 支援 Antigravity Swarm 分層派工與 Cross-Model 額度自適應 — 驗收指令: `node scripts/test_agent_provider_adapter.js`
  - [x] Slice 2: [TASK-211] 補齊 `scripts/test_agent_provider_adapter.js` 跨平台隔離與 Swarm 策略斷言 — 驗收指令: `node scripts/test_agent_provider_adapter.js`
- **Return Format**: 回報 `modifiedFiles` 清單與每個切片的 `{command, cwd, exitCode, rawLog}`。
