/**
 * Agent Provider Adapter (跨平台通用 Agent Orchestration 適配層)
 * 支援 Antigravity, Claude Code, OpenAI Codex, VS Code Copilot 及通用能力分層語意
 */

const MODEL_CAPABILITY_ROLES = {
  fastExecutor: 'fastExecutor',
  balancedExecutor: 'balancedExecutor',
  reasoningVerifier: 'reasoningVerifier',
  nativeOrchestrator: 'nativeOrchestrator',
  directExecutor: 'directExecutor'
};

const PROVIDER_MATRIX = {
  antigravity: {
    name: 'antigravity',
    label: 'Google Antigravity',
    fastExecutor: 'flash Subagent (Workspace: "inherit")',
    balancedExecutor: 'flash Subagent (Workspace: "inherit")',
    reasoningVerifier: 'pro Verifier (Model: "pro", Workspace: "inherit")',
    nativeOrchestrator: 'Orchestrator (Plan→Execute 原生雙階段)',
    directExecutor: 'Fast / Direct 高速直行模式 (平台內建執行模型)',
    nativeSwarm: true,
    swarmPolicy: {
      discoveryCommand: 'swarm({action:"models",all:true})',
      executorProfile: '高剩餘額度之高速執行檔位 (Fast / Flash / Direct 等 medium/low)',
      reviewerProfile: '不同模型家族高階推理檔位 (high/xhigh) → 同家族短重置週期高階 (xhigh/high) → 長週期旗艦 (high)',
      workspaceMode: 'share'
    },
    subagentMechanism: 'invoke_subagent'
  },
  claude: {
    name: 'claude',
    label: 'Anthropic Claude Code',
    fastExecutor: 'Haiku Subagent (Fast / 輕量檔位)',
    balancedExecutor: 'Sonnet Subagent (Balanced / 主力檔位)',
    reasoningVerifier: 'Opus / Thinking Verifier (Reasoning / 深度推理檔位)',
    nativeOrchestrator: 'Claude Plan Mode (Plan→Act)',
    directExecutor: 'Haiku / Sonnet 單線程直行',
    subagentMechanism: 'Task Tool / Subagents'
  },
  codex: {
    name: 'codex',
    label: 'OpenAI Codex',
    fastExecutor: 'Worker Subagent (Fast / Mini 輕量檔位)',
    balancedExecutor: 'Core Subagent (Balanced / 主力檔位)',
    reasoningVerifier: 'Reasoner Verifier (Reasoning / 深度推理檔位)',
    nativeOrchestrator: 'Codex Plan→Act 雙階段',
    directExecutor: 'Codex Fast / Mini 單線程直行',
    subagentMechanism: 'Swarm / Handoff Tools'
  },
  copilot: {
    name: 'copilot',
    label: 'VS Code Copilot',
    fastExecutor: 'Copilot Subagent (Fast / Default Agent Mode)',
    balancedExecutor: 'Copilot Subagent (Balanced / Agent Mode)',
    reasoningVerifier: 'Copilot Verifier (Reasoning / 深度推理模式)',
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

const GENERIC_PROVIDER_ALIASES = new Set(['all', 'universal', 'generic', 'auto']);
const NEUTRAL_EXECUTION_ALIASES = new Set(['orchestrator', 'hydrogen', 'fast', 'direct', 'planner', 'executor']);

/**
 * 將平台識別鍵值、執行模式或模型家族別名映射至 PROVIDER_MATRIX 條目
 * @param {string} rawKey
 * @returns {Object} provider 配置物件
 */
function resolveProviderByKey(rawKey) {
  const cleanKey = String(rawKey || '').trim().toLowerCase();
  if (GENERIC_PROVIDER_ALIASES.has(cleanKey)) {
    return PROVIDER_MATRIX.generic;
  }
  if (NEUTRAL_EXECUTION_ALIASES.has(cleanKey)) {
    const envKey = String(process.env.AGENT_PROVIDER || '').trim().toLowerCase();
    return (envKey && PROVIDER_MATRIX[envKey]) || PROVIDER_MATRIX.antigravity;
  }
  if (PROVIDER_MATRIX[cleanKey]) {
    return PROVIDER_MATRIX[cleanKey];
  }
  if (/antigravity|\bagy\b|gemini|neon|argon|flash/.test(cleanKey)) {
    return PROVIDER_MATRIX.antigravity;
  }
  if (/claude|haiku|sonnet|opus/.test(cleanKey)) {
    return PROVIDER_MATRIX.claude;
  }
  if (/codex|openai|gpt|(?:^|[^a-z0-9])o[134](?:[^a-z0-9]|$)/.test(cleanKey)) {
    return PROVIDER_MATRIX.codex;
  }
  if (/copilot|vscode/.test(cleanKey)) {
    return PROVIDER_MATRIX.copilot;
  }
  return PROVIDER_MATRIX.antigravity;
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

function inferModelFamily(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (/claude|opus|sonnet|haiku/.test(id)) return 'claude';
  if (/gemini|argon|neon|hydrogen|flash/.test(id)) return 'gemini';
  if (/gpt|codex|openai|(?:^|[-_])o[1-9](?:$|[-_])/.test(id)) return 'openai';
  return 'other';
}

function inferModelEffort(modelId) {
  const match = String(modelId || '').toLowerCase().match(/(?:^|[-_])(xhigh|high|medium|low)$/);
  return match ? match[1] : 'medium';
}

function inferModelTier(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('orchestrator')) return 'orchestrator';
  if (/flash|hydrogen|haiku|mini|lite|nano|fast/.test(id)) return 'fast';
  if (/opus|argon|pro|reasoner|thinking/.test(id) || /(?:^|-)o[1-9](?:-|$)/.test(id)) return 'flagship';
  return 'workhorse';
}

function parseQuotaInfo(quotaEntry, nowMs) {
  if (!quotaEntry || typeof quotaEntry !== 'object') {
    return { quotaPct: 100, resetHours: 24, available: true };
  }

  let quotaPct = 100;
  if (quotaEntry.quota_remaining !== undefined && quotaEntry.quota_remaining !== null && quotaEntry.quota_remaining !== '') {
    const parsedPct = parseFloat(String(quotaEntry.quota_remaining).replace('%', '').trim());
    if (Number.isFinite(parsedPct)) {
      quotaPct = Math.max(0, Math.min(100, parsedPct));
    }
  }

  const hasQuotaNote = Boolean(quotaEntry.quota_note && String(quotaEntry.quota_note).trim());
  const available = quotaPct > 0 || hasQuotaNote;

  let resetHours = 24;
  if (quotaEntry.quota_resets) {
    const resetMs = Date.parse(quotaEntry.quota_resets);
    if (Number.isFinite(resetMs)) {
      resetHours = Math.max(0, (resetMs - nowMs) / 3600000);
    }
  }

  return { quotaPct, resetHours, available };
}

function scoreModelCandidate(candidate, role, currentFamily) {
  const { family, tier, effort, quotaPct, resetHours } = candidate;
  const resetScore = resetHours <= 24 ? 15 : (resetHours > 48 ? -10 : 0);
  const quotaScore = quotaPct * 0.3;

  if (role === 'reviewer') {
    const crossFamilyBonus = (currentFamily && currentFamily !== 'other' && family !== currentFamily) ? 40 : 0;
    const tierScore = tier === 'flagship' ? 30 : (tier === 'workhorse' ? 22 : -15);
    const effortScore = effort === 'xhigh' ? 20 : (effort === 'high' ? 15 : (effort === 'medium' ? 0 : -10));
    return crossFamilyBonus + tierScore + effortScore + quotaScore + resetScore;
  }

  const tierScore = tier === 'fast' ? 35 : (tier === 'flagship' ? -10 : 0);
  const effortScore = effort === 'medium' ? 15 : (effort === 'low' ? 12 : -5);
  return tierScore + effortScore + quotaScore + resetScore;
}

/**
 * 依據即時模型目錄與額度狀態動態挑選最佳執行或審查模型（版本無關）
 * @param {Object} catalog - { models: string[], quotas?: Object }
 * @param {'executor'|'reviewer'} [role='executor']
 * @param {Object} [options] - { currentModel?: string, excludeModels?: string[], nowMs?: number }
 * @returns {Object|null} 最佳候選與完整評分清單
 */
function selectModelFromCatalog(catalog, role = 'executor', options = {}) {
  if (!catalog || !Array.isArray(catalog.models) || catalog.models.length === 0) {
    return null;
  }

  const normalizedRole = role === 'reviewer' ? 'reviewer' : 'executor';
  const quotas = (catalog.quotas && typeof catalog.quotas === 'object') ? catalog.quotas : {};
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const currentModel = options.currentModel ? String(options.currentModel).trim() : '';
  const currentFamily = currentModel ? inferModelFamily(currentModel) : null;
  const excludedSet = new Set(Array.isArray(options.excludeModels) ? options.excludeModels.map(m => String(m).trim()) : []);

  const candidates = [];
  for (const rawId of catalog.models) {
    const model = String(rawId || '').trim();
    if (!model || excludedSet.has(model)) continue;
    if (normalizedRole === 'reviewer' && currentModel && model === currentModel) continue;

    const tier = inferModelTier(model);
    if (tier === 'orchestrator') continue;

    const quota = parseQuotaInfo(quotas[model], nowMs);
    if (!quota.available) continue;

    const candidate = {
      model,
      family: inferModelFamily(model),
      tier,
      effort: inferModelEffort(model),
      quotaPct: quota.quotaPct,
      resetHours: quota.resetHours
    };
    candidate.score = scoreModelCandidate(candidate, normalizedRole, currentFamily);
    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    ...best,
    candidates
  };
}

function normalizeModelOverride(value, joiner) {
  if (!value) return '';
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items
    .map(item => String(item || '').replace(/[\r\n]+/g, ' ').trim())
    .filter(Boolean)
    .join(joiner);
}

/**
 * 組合 Swarm 平行切片與 Cross-Model 審查指令片段（單行輸出）
 * @param {Object} provider
 * @param {Object|null} [options]
 * @returns {string}
 */
function formatSwarmGuidance(provider, options = null) {
  if (!provider || !provider.nativeSwarm) {
    return '（審查須附 assumptions/deviations/unverified）。';
  }

  const policy = provider.swarmPolicy || {};
  const discoveryCmd = policy.discoveryCommand || 'swarm({action:"models",all:true})';
  const workspaceMode = policy.workspaceMode || 'share';

  const optModels = (options && options.swarmModels) ? options.swarmModels : {};
  const executorOverride = normalizeModelOverride(optModels.executor, ' / ')
    || normalizeModelOverride(process.env.AGENT_SWARM_EXECUTOR_MODELS, ' / ');
  const reviewerOverride = normalizeModelOverride(optModels.reviewer, ' → ')
    || normalizeModelOverride(process.env.AGENT_SWARM_REVIEWER_MODELS, ' → ');

  const executorDesc = executorOverride || policy.executorProfile || '高剩餘額度之高速執行檔位 (medium/low)';
  const reviewerDesc = reviewerOverride || policy.reviewerProfile || '不同模型家族高階推理檔位 (high/xhigh)';

  return `；平行切片或 cross-model-review 可開 swarm（Coordinator 不寫碼，先查 ${discoveryCmd} 依剩餘額度與重置週期選模：實作派${executorDesc} + workspace:"${workspaceMode}"；審查禁 inherit，優先選${reviewerDesc}，無額度再 fallback ${provider.reasoningVerifier}，僅傳規格/git diff/測試輸出，並要求顯性揭露 assumptions/deviations/unverified）。`;
}

/**
 * 依據任務 Tier 與目標 Provider 格式化開工策略文字（單行、緊湊、無多餘換行）
 * @param {string} tier - 'micro' | 'standard' | 'heavy'
 * @param {Object|string} [providerOrName]
 * @param {Object|null} [options]
 * @returns {string} 策略指示字串
 */
function formatTierStrategy(tier, providerOrName = null, options = null) {
  const provider = typeof providerOrName === 'string'
    ? resolveProviderByKey(providerOrName)
    : (providerOrName && providerOrName.fastExecutor ? providerOrName : resolveProvider());

  if (tier === 'micro') {
    return '• 執行策略 (Tier: micro 原地實作): 由主 Agent 原地直接實作與驗證，不啟動額外附屬代理。';
  }

  if (tier === 'heavy') {
    const swarmSuffix = formatSwarmGuidance(provider, options);
    return `• 執行策略 (Tier: heavy Planner→Executor 切片): ${provider.nativeOrchestrator} 0 讀碼第 1 步立即交棒內建執行階段 (${provider.directExecutor}) 拆寫 Handoff Contract 逐片實作（大切片優先 Model: "inherit"，備援 ${provider.fastExecutor}）；含 cross-model-review 或 riskDoor one-way 另開 ${provider.reasoningVerifier}${swarmSuffix}`;
  }

  return `• 執行策略 (Tier: standard Planner→Executor): ${provider.nativeOrchestrator} 0 讀碼第 1 步直接交棒內建執行階段 (${provider.directExecutor}) 實作；直接用 ${provider.directExecutor} 原地切片（免降級）；單階段高階模式寫 Handoff Contract 派單一 ${provider.fastExecutor}，交付須顯性揭露 assumptions/deviations/unverified。`;
}

module.exports = {
  MODEL_CAPABILITY_ROLES,
  PROVIDER_MATRIX,
  resolveProviderByKey,
  resolveProvider,
  selectModelFromCatalog,
  formatSwarmGuidance,
  formatTierStrategy
};
