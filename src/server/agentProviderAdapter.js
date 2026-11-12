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
    subagentMechanism: 'invoke_subagent'
  },
  claude: {
    name: 'claude',
    label: 'Anthropic Claude Code',
    fastExecutor: 'Haiku Subagent (claude-3-5-haiku)',
    balancedExecutor: 'Sonnet Subagent (claude-3-5-sonnet)',
    reasoningVerifier: 'Opus / Thinking Verifier (claude-3-opus)',
    subagentMechanism: 'Task Tool / Subagents'
  },
  codex: {
    name: 'codex',
    label: 'OpenAI Codex',
    fastExecutor: 'Worker Subagent (gpt-4o-mini)',
    balancedExecutor: 'Core Subagent (gpt-4o)',
    reasoningVerifier: 'Reasoner Verifier (o1 / o3-mini)',
    subagentMechanism: 'Swarm / Handoff Tools'
  },
  copilot: {
    name: 'copilot',
    label: 'VS Code Copilot',
    fastExecutor: 'Copilot Subagent (Fast / Default Agent Mode)',
    balancedExecutor: 'Copilot Subagent (Claude 3.5 Sonnet / Agent Mode)',
    reasoningVerifier: 'Copilot Verifier (OpenAI o1 Reasoning Mode)',
    subagentMechanism: 'Agent Mode / Sub-tasks'
  },
  generic: {
    name: 'generic',
    label: 'Universal Generic Agent',
    fastExecutor: 'Executor Subagent (Fast / 輕量檔位)',
    balancedExecutor: 'Executor Subagent (Balanced / 主力檔位)',
    reasoningVerifier: 'Verifier Subagent (Reasoning / 深度推理檔位)',
    subagentMechanism: 'Subagent / Worker'
  }
};

/**
 * 依據任務屬性與環境變數解析生效的 Agent Provider
 * @param {Object} [task]
 * @returns {Object} provider 配置物件
 */
function resolveProvider(task = null) {
  const explicit = (task && (task.agentProvider || task.provider)) || process.env.AGENT_PROVIDER || 'antigravity';
  const cleanKey = String(explicit).trim().toLowerCase();
  return PROVIDER_MATRIX[cleanKey] || PROVIDER_MATRIX.antigravity;
}

/**
 * 依據任務 Tier 與目標 Provider 格式化開工策略文字（單行、緊湊、無多餘換行）
 * @param {string} tier - 'micro' | 'standard' | 'heavy'
 * @param {Object|string} [providerOrName]
 * @returns {string} 策略指示字串
 */
function formatTierStrategy(tier, providerOrName = null) {
  const provider = typeof providerOrName === 'string'
    ? (PROVIDER_MATRIX[providerOrName.toLowerCase()] || PROVIDER_MATRIX.antigravity)
    : (providerOrName && providerOrName.fastExecutor ? providerOrName : resolveProvider());

  if (tier === 'micro') {
    return '• 執行策略 (Tier: micro 原地實作): 由主 Agent 原地直接實作與驗證，不啟動額外附屬代理。';
  }

  if (tier === 'heavy') {
    return `• 執行策略 (Tier: heavy Planner→Executor 切片): 主 Agent 規劃並切片寫入 Handoff Contract，指派 ${provider.fastExecutor} 逐片實作，由主 Agent 審查 diff；riskDoor one-way 才另開獨立 ${provider.reasoningVerifier}。`;
  }

  return `• 執行策略 (Tier: standard Planner→Executor): 主 Agent 執行一次 Phase 1，寫入 build-plan「Handoff Contract」後，指派單一 ${provider.fastExecutor} 僅依契約實作；主 Agent 依契約驗收。`;
}

module.exports = {
  PROVIDER_MATRIX,
  resolveProvider,
  formatTierStrategy
};
