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
    nativeSwarm: true,
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
    const swarmSuffix = provider.nativeSwarm
      ? `；平行切片或 cross-model-review 可開 swarm（Coordinator 不寫碼，實作派 gemini-4-hydrogen-medium/low 或 gemini-3.8-flash-medium + workspace:"share"；審查禁 inherit，先查 swarm({action:"models",all:true}) 依額度選 claude-opus-5-5-high→gemini-4-argon-high，無額度再 fallback ${provider.reasoningVerifier}，僅傳規格/git diff/測試輸出，並要求顯性揭露 assumptions/deviations/unverified）。`
      : '（審查須附 assumptions/deviations/unverified）。';
    return `• 執行策略 (Tier: heavy Planner→Executor 切片): ${provider.nativeOrchestrator} 0 讀碼第 1 步立即交棒內建執行階段 (${provider.directExecutor}) 拆寫 Handoff Contract 逐片實作（大切片優先 Model: "inherit"，備援 ${provider.fastExecutor}）；含 cross-model-review 或 riskDoor one-way 另開 ${provider.reasoningVerifier}${swarmSuffix}`;
  }

  return `• 執行策略 (Tier: standard Planner→Executor): ${provider.nativeOrchestrator} 0 讀碼第 1 步直接交棒內建執行階段 (${provider.directExecutor}) 實作；直接用 ${provider.directExecutor} 原地切片（免降級）；單階段高階模式寫 Handoff Contract 派單一 ${provider.fastExecutor}，交付須顯性揭露 assumptions/deviations/unverified。`;
}

module.exports = {
  PROVIDER_MATRIX,
  resolveProvider,
  formatTierStrategy
};
