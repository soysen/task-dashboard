const assert = require('assert');
const {
  PROVIDER_MATRIX,
  resolveProvider,
  formatTierStrategy
} = require('../src/server/agentProviderAdapter');

function testAgentProviderAdapter() {
  console.log('🧪 執行 Agent Provider Adapter (跨平台通用調度適配層) 單元測試...');

  // 1. 驗證四大平台與通用矩陣存在性
  const requiredProviders = ['antigravity', 'claude', 'codex', 'copilot', 'generic'];
  requiredProviders.forEach(p => {
    assert(PROVIDER_MATRIX[p], `PROVIDER_MATRIX 必須包含 ${p}`);
    assert(PROVIDER_MATRIX[p].fastExecutor, `${p} 必須具備 fastExecutor`);
    assert(PROVIDER_MATRIX[p].balancedExecutor, `${p} 必須具備 balancedExecutor`);
    assert(PROVIDER_MATRIX[p].reasoningVerifier, `${p} 必須具備 reasoningVerifier`);
  });
  console.log('  ✅ PROVIDER_MATRIX 四大平台與通用矩陣結構驗證通過');

  // 2. 驗證 resolveProvider 優先序 (task 顯式 > env > 預設)
  assert.equal(resolveProvider({ agentProvider: 'copilot' }).name, 'copilot', 'task.agentProvider 優先解析');
  assert.equal(resolveProvider({ provider: 'claude' }).name, 'claude', 'task.provider 別名解析相容');

  const oldEnv = process.env.AGENT_PROVIDER;
  try {
    process.env.AGENT_PROVIDER = 'codex';
    assert.equal(resolveProvider({}).name, 'codex', '環境變數 AGENT_PROVIDER 解析成功');
    delete process.env.AGENT_PROVIDER;
    assert.equal(resolveProvider({}).name, 'antigravity', '無配置時預設回退至 antigravity 以保向下相容');
  } finally {
    if (oldEnv !== undefined) process.env.AGENT_PROVIDER = oldEnv;
    else delete process.env.AGENT_PROVIDER;
  }
  console.log('  ✅ resolveProvider 優先序與預設相容性驗證通過');

  // 3. 驗證 formatTierStrategy 針對各平台正確生成提示字眼
  // Copilot (Agent Mode / Subagents)
  const copilotStandard = formatTierStrategy('standard', 'copilot');
  assert(copilotStandard.includes('Copilot Subagent'), 'Copilot standard 應指示調度 Copilot Subagent');
  assert(copilotStandard.includes('Tier: standard Planner→Executor'), '標準策略語義應完整');

  const copilotHeavy = formatTierStrategy('heavy', 'copilot');
  assert(copilotHeavy.includes('Copilot Verifier (OpenAI o1 Reasoning Mode)'), 'Copilot heavy 應包含 o1 獨立 Verifier');

  // Claude Code
  const claudeStandard = formatTierStrategy('standard', 'claude');
  assert(claudeStandard.includes('Haiku Subagent'), 'Claude standard 應提示 Haiku Subagent');
  const claudeHeavy = formatTierStrategy('heavy', 'claude');
  assert(claudeHeavy.includes('Opus / Thinking Verifier'), 'Claude heavy 應提示 Opus Verifier');

  // OpenAI Codex
  const codexStandard = formatTierStrategy('standard', 'codex');
  assert(codexStandard.includes('Worker Subagent (gpt-4o-mini)'), 'Codex standard 應提示 Mini Worker');
  const codexHeavy = formatTierStrategy('heavy', 'codex');
  assert(codexHeavy.includes('Reasoner Verifier (o1 / o3-mini)'), 'Codex heavy 應提示 o1/o3 Reasoner');

  // Antigravity (向下相容)
  const agyStandard = formatTierStrategy('standard', 'antigravity');
  assert(agyStandard.includes('flash Subagent (Workspace: "inherit")'), 'Antigravity standard 必須保持 flash Subagent');
  const agyHeavy = formatTierStrategy('heavy', 'antigravity');
  assert(agyHeavy.includes('pro Verifier (Model: "pro", Workspace: "inherit")'), 'Antigravity heavy 必須保持 pro Verifier');

  // Micro (所有平台原地實作)
  ['antigravity', 'claude', 'codex', 'copilot', 'generic'].forEach(p => {
    const micro = formatTierStrategy('micro', p);
    assert(micro.includes('原地直接實作與驗證'), `${p} micro 必須一致指示原地實作`);
    assert(!micro.includes('Subagent'), `${p} micro 不得要求啟動 Subagent`);
  });
  console.log('  ✅ formatTierStrategy 四大平台與 micro 原地模式輸出驗證通過');

  console.log('🎉 所有 Agent Provider Adapter 單元測試順利通過！');
}

testAgentProviderAdapter();
