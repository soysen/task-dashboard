const assert = require('assert');
const {
  PROVIDER_MATRIX,
  resolveProvider,
  formatTierStrategy
} = require('../src/server/agentProviderAdapter');

function testAgentProviderAdapter() {
  console.log('🧪 執行 Agent Provider Adapter (跨平台通用調度適配層) 單元測試...');

  // 1. 驗證四大平台與通用矩陣存在性（含三態自適應能力欄位）
  const requiredProviders = ['antigravity', 'claude', 'codex', 'copilot', 'generic'];
  requiredProviders.forEach(p => {
    assert(PROVIDER_MATRIX[p], `PROVIDER_MATRIX 必須包含 ${p}`);
    assert(PROVIDER_MATRIX[p].fastExecutor, `${p} 必須具備 fastExecutor`);
    assert(PROVIDER_MATRIX[p].balancedExecutor, `${p} 必須具備 balancedExecutor`);
    assert(PROVIDER_MATRIX[p].reasoningVerifier, `${p} 必須具備 reasoningVerifier`);
    assert(PROVIDER_MATRIX[p].nativeOrchestrator, `${p} 必須具備 nativeOrchestrator`);
    assert(PROVIDER_MATRIX[p].directExecutor, `${p} 必須具備 directExecutor`);
  });
  console.log('  ✅ PROVIDER_MATRIX 四大平台與通用矩陣結構驗證通過');

  // 2. 驗證 resolveProvider 優先序 (task 顯式 > assignedAgent/assignee > env > 預設)
  assert.equal(resolveProvider({ agentProvider: 'copilot' }).name, 'copilot', 'task.agentProvider 優先解析');
  assert.equal(resolveProvider({ provider: 'claude' }).name, 'claude', 'task.provider 別名解析相容');
  assert.equal(resolveProvider({ assignedAgent: 'Claude' }).name, 'claude', 'task.assignedAgent 應正確映射至 claude');
  assert.equal(resolveProvider({ assignee: 'Codex' }).name, 'codex', 'task.assignee 應正確映射至 codex');
  assert.equal(resolveProvider({ assignee: 'All' }).name, 'generic', 'task.assignee=All 應映射至 generic');
  assert.equal(resolveProvider({ assignedAgent: 'Universal' }).name, 'generic', 'task.assignedAgent=Universal 應映射至 generic');
  assert.equal(resolveProvider({ assignedAgent: 'Orchestrator' }).name, 'antigravity', '無 env 時 Orchestrator 預設映射至 antigravity');
  assert.equal(resolveProvider({ assignee: 'Hydrogen' }).name, 'antigravity', '無 env 時 Hydrogen 預設映射至 antigravity');

  const oldEnv = process.env.AGENT_PROVIDER;
  try {
    process.env.AGENT_PROVIDER = 'codex';
    assert.equal(resolveProvider({}).name, 'codex', '環境變數 AGENT_PROVIDER 解析成功');
    assert.equal(resolveProvider({ assignedAgent: 'Orchestrator' }).name, 'codex', '環境變數指定平台時應優先尊重平台');
    delete process.env.AGENT_PROVIDER;
    assert.equal(resolveProvider({}).name, 'antigravity', '無配置時預設回退至 antigravity 以保向下相容');
  } finally {
    if (oldEnv !== undefined) process.env.AGENT_PROVIDER = oldEnv;
    else delete process.env.AGENT_PROVIDER;
  }
  console.log('  ✅ resolveProvider 優先序、assignedAgent/assignee 串接與預設相容性驗證通過');

  // 3. 驗證 formatTierStrategy 針對各平台正確生成三態自適應提示且嚴守單行
  // Copilot (Agent Mode / Subagents)
  const copilotStandard = formatTierStrategy('standard', 'copilot');
  assert(copilotStandard.includes('Copilot Subagent'), 'Copilot standard 應指示調度 Copilot Subagent');
  assert(copilotStandard.includes('Tier: standard Planner→Executor'), '標準策略語義應完整');
  assert(copilotStandard.includes('Copilot Plan→Agent 雙階段'), 'Copilot standard 應包含原生雙階段指示');
  assert(copilotStandard.includes('Copilot Fast 單線程直行'), 'Copilot standard 應包含輕量直行指示');

  const copilotHeavy = formatTierStrategy('heavy', 'copilot');
  assert(copilotHeavy.includes('Copilot Verifier (OpenAI o1 Reasoning Mode)'), 'Copilot heavy 應包含 o1 獨立 Verifier');

  // Claude Code
  const claudeStandard = formatTierStrategy('standard', 'claude');
  assert(claudeStandard.includes('Haiku Subagent'), 'Claude standard 應提示 Haiku Subagent');
  assert(claudeStandard.includes('Claude Plan Mode (Plan→Act)'), 'Claude standard 應包含 Plan Mode 原生雙階段指示');
  assert(claudeStandard.includes('Haiku / Sonnet 單線程直行'), 'Claude standard 應包含輕量直行指示');
  const claudeHeavy = formatTierStrategy('heavy', 'claude');
  assert(claudeHeavy.includes('Opus / Thinking Verifier'), 'Claude heavy 應提示 Opus Verifier');

  // OpenAI Codex
  const codexStandard = formatTierStrategy('standard', 'codex');
  assert(codexStandard.includes('Worker Subagent (gpt-4o-mini)'), 'Codex standard 應提示 Mini Worker');
  const codexHeavy = formatTierStrategy('heavy', 'codex');
  assert(codexHeavy.includes('Reasoner Verifier (o1 / o3-mini)'), 'Codex heavy 應提示 o1/o3 Reasoner');

  // Antigravity (向下相容 + Orchestrator / Hydrogen 自適應)
  const agyStandard = formatTierStrategy('standard', 'antigravity');
  assert(agyStandard.includes('flash Subagent (Workspace: "inherit")'), 'Antigravity standard 必須保持 flash Subagent');
  assert(agyStandard.includes('Orchestrator (Plan→Execute 原生雙階段)'), 'Antigravity standard 應包含 Orchestrator 原生雙階段說明');
  assert(agyStandard.includes('Hydrogen / Fast 直行模式'), 'Antigravity standard 應包含 Hydrogen 直行模式說明');
  const agyHeavy = formatTierStrategy('heavy', 'antigravity');
  assert(agyHeavy.includes('pro Verifier (Model: "pro", Workspace: "inherit")'), 'Antigravity heavy 必須保持 pro Verifier');
  assert(agyHeavy.includes('Orchestrator (Plan→Execute 原生雙階段)'), 'Antigravity heavy 應包含 Orchestrator 原生雙階段免外開實作 Subagent 說明');

  // Micro (所有平台原地實作) & 單行限制驗證
  ['antigravity', 'claude', 'codex', 'copilot', 'generic'].forEach(p => {
    const micro = formatTierStrategy('micro', p);
    assert(micro.includes('原地直接實作與驗證'), `${p} micro 必須一致指示原地實作`);
    assert(!micro.includes('Subagent'), `${p} micro 不得要求啟動 Subagent`);
    ['micro', 'standard', 'heavy'].forEach(tier => {
      const strategy = formatTierStrategy(tier, p);
      assert(!strategy.includes('\n'), `${p} ${tier} 策略必須為單行無換行，避免哨兵 brief 行數超標`);
    });
  });
  console.log('  ✅ formatTierStrategy 四大平台、三態自適應與單行限制驗證通過');

  console.log('🎉 所有 Agent Provider Adapter 單元測試順利通過！');
}

testAgentProviderAdapter();
