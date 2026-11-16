/**
 * Agent Provider Adapter (跨平台通用 Agent Orchestration 適配層)
 * 支援 Antigravity, Claude Code, OpenAI Codex, VS Code Copilot 及通用通用語意
 */

const PROVIDER_MATRIX = {
  antigravity: {
    name: 'antigravity',
    label: 'Google Antigravity',
    fastExecutor: 'flash Subagent (Workspace: "inherit")',
    balancedExecutor: 'flash Subagent (Workspace: "inherit")',
    reasoningVerifier: 'pro Verifier (Model: "pro", Workspace: "inherit")',
    nativeOrchestrator: 'Orchestrator (Plan→Execute 原生雙階段)',
    directExecutor: 'Hydrogen / Fast 直行模式',
    subagentMechanism: 'invoke_subagent'
  },
  claude: {
    name: 'claude',
    label: 'Anthropic Claude Code',
    fastExecutor: 'Haiku Subagent (claude-3-5-haiku)',
    balancedExecutor: 'Sonnet Subagent (claude-3-5-sonnet)',
    reasoningVerifier: 'Opus / Thinking Verifier (claude-3-opus)',
    nativeOrchestrator: 'Claude Plan Mode (Plan→Act)',
    directExecutor: 'Haiku / Sonnet 單線程直行',
    subagentMechanism: 'Task Tool / Subagents'
  },
  codex: {
    name: 'codex',
    label: 'OpenAI Codex',
    fastExecutor: 'Worker Subagent (gpt-4o-mini)',
    balancedExecutor: 'Core Subagent (gpt-4o)',
    reasoningVerifier: 'Reasoner Verifier (o1 / o3-mini)',
    nativeOrchestrator: 'Codex Plan→Act 雙階段',
    directExecutor: 'Codex Mini 單線程直行',
    subagentMechanism: 'Swarm / Handoff Tools'
  },
  copilot: {
    name: 'copilot',
    label: 'VS Code Copilot',
    fastExecutor: 'Copilot Subagent (Fast / Default Agent Mode)',
    balancedExecutor: 'Copilot Subagent (Claude 3.5 Sonnet / Agent Mode)',
    reasoningVerifier: 'Copilot Verifier (OpenAI o1 Reasoning Mode)',
    nativeOrchestrator: 'Copilot Plan→Agent 雙階段',
    directExecutor: 'Copilot Fast 單線程直行',
    subagentMechanism: 'Agent Mode / Sub-tasks'
  },
  generic: {
    name: 'generic',
    label: 'Universal Generic Agent',
    fastExecutor: 'Executor Subagent (Fast / 輕量檔位)',
    balancedExecutor: 'Executor Subagent (Balanced / 主力檔位)',
    reasoningVerifier: 'Verifier Subagent (Reasoning / 深度推理檔位)',
    nativeOrchestrator: 'Native Plan→Execute 原生雙階段模式',
    directExecutor: 'Fast Direct 輕量直行模式',
    subagentMechanism: 'Subagent / Worker'
  }
};

/**
 * 將平台識別鍵值映射至 PROVIDER_MATRIX 條目
 * @param {string} rawKey
 * @returns {Object} provider 配置物件
 */
function resolveProviderByKey(rawKey) {
  const cleanKey = String(rawKey || '').trim().toLowerCase();
  if (cleanKey === 'all' || cleanKey === 'universal') {
    return PROVIDER_MATRIX.generic;
  }
  if (cleanKey === 'orchestrator' || cleanKey === 'hydrogen') {
    const envKey = String(process.env.AGENT_PROVIDER || '').trim().toLowerCase();
    return PROVIDER_MATRIX[envKey] || PROVIDER_MATRIX.antigravity;
  }
  return PROVIDER_MATRIX[cleanKey] || PROVIDER_MATRIX.antigravity;
}

/**
 * 依據任務屬性與環境變數解析生效的 Agent Provider
 * @param {Object} [task]
 * @returns {Object} provider 配置物件
 */
function resolveProvider(task = null) {
  const explicit = (task && (task.agentProvider || task.provider || task.assignedAgent || task.assignee)) || process.env.AGENT_PROVIDER || 'antigravity';
  return resolveProviderByKey(explicit);
}

/**
 * 依據任務 Tier 與目標 Provider 格式化開工策略文字（單行、緊湊、無多餘換行）
 * @param {string} tier - 'micro' | 'standard' | 'heavy'
 * @param {Object|string} [providerOrName]
 * @returns {string} 策略指示字串
 */
function formatTierStrategy(tier, providerOrName = null) {
  const provider = typeof providerOrName === 'string'
    ? resolveProviderByKey(providerOrName)
    : (providerOrName && providerOrName.fastExecutor ? providerOrName : resolveProvider());

  if (tier === 'micro') {
    return '• 執行策略 (Tier: micro 原地實作): 由主 Agent 原地直接實作與驗證，不啟動額外附屬代理。';
  }

  if (tier === 'heavy') {
    return `• 執行策略 (Tier: heavy Planner→Executor 切片): 若為 ${provider.nativeOrchestrator}，Planning 階段 0 讀碼第 1 步立即交棒內建執行階段 (${provider.directExecutor}) 讀檔、拆解 Handoff Contract 切片並逐片實作（或視切片大小輔以 ${provider.fastExecutor} / Model: "inherit" 分擔）；若含 cross-model-review 或 riskDoor one-way 則另開獨立 ${provider.reasoningVerifier}。`;
  }

  return `• 執行策略 (Tier: standard Planner→Executor): 若為 ${provider.nativeOrchestrator}，Planning 階段嚴禁讀檔須 0 讀碼第 1 步直接交棒內建執行階段 (${provider.directExecutor}) 讀檔與實作；若直接運行於 ${provider.directExecutor} 則原地切片實作；傳統單階段高階模式則寫入 build-plan「Handoff Contract」指派單一 ${provider.fastExecutor} 依契約實作。`;
}

module.exports = {
  PROVIDER_MATRIX,
  resolveProvider,
  formatTierStrategy
};
