const assert = require('assert');
const { execFileSync } = require('child_process');
const {
  MODEL_CAPABILITY_ROLES,
  PROVIDER_MATRIX,
  resolveProvider,
  selectModelFromCatalog,
  formatTierStrategy
} = require('../src/server/agentProviderAdapter');

function testAgentProviderAdapter() {
  console.log('🧪 執行 Agent Provider Adapter (跨平台通用調度適配層) 單元測試...');

  // 1. 驗證四大平台與通用矩陣存在性、能力角色常數及版本無關性（移除寫死版本號）
  const requiredProviders = ['antigravity', 'claude', 'codex', 'copilot', 'generic'];
  const hardcodedVersionedModels = [
    'claude-3-5',
    'claude-3-opus',
    'gpt-4o',
    'o3-mini',
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'claude-opus-5-5',
    'gemini-4-argon'
  ];

  assert(MODEL_CAPABILITY_ROLES && MODEL_CAPABILITY_ROLES.fastExecutor && MODEL_CAPABILITY_ROLES.reasoningVerifier, 'MODEL_CAPABILITY_ROLES 必須定義核心能力角色');
  requiredProviders.forEach(p => {
    assert(PROVIDER_MATRIX[p], `PROVIDER_MATRIX 必須包含 ${p}`);
    assert(PROVIDER_MATRIX[p].fastExecutor, `${p} 必須具備 fastExecutor`);
    assert(PROVIDER_MATRIX[p].balancedExecutor, `${p} 必須具備 balancedExecutor`);
    assert(PROVIDER_MATRIX[p].reasoningVerifier, `${p} 必須具備 reasoningVerifier`);
    assert(PROVIDER_MATRIX[p].nativeOrchestrator, `${p} 必須具備 nativeOrchestrator`);
    assert(PROVIDER_MATRIX[p].directExecutor, `${p} 必須具備 directExecutor`);

    const serialized = JSON.stringify(PROVIDER_MATRIX[p]);
    hardcodedVersionedModels.forEach(legacy => {
      assert(!serialized.includes(legacy), `PROVIDER_MATRIX.${p} 不得硬編碼特定版本模型 ${legacy}`);
    });
  });

  assert(PROVIDER_MATRIX.antigravity.swarmPolicy, 'antigravity 必須具備 swarmPolicy');
  assert.equal(PROVIDER_MATRIX.antigravity.swarmPolicy.discoveryCommand, 'swarm({action:"models",all:true})');
  assert(PROVIDER_MATRIX.antigravity.swarmPolicy.executorProfile, 'swarmPolicy 必須具備 executorProfile');
  assert(PROVIDER_MATRIX.antigravity.swarmPolicy.reviewerProfile, 'swarmPolicy 必須具備 reviewerProfile');
  assert.equal(PROVIDER_MATRIX.antigravity.swarmPolicy.workspaceMode, 'share');
  console.log('  ✅ PROVIDER_MATRIX 四大平台、通用矩陣結構與版本無關性驗證通過');

  // 2. 驗證 resolveProvider 優先序與通用模型/家族別名解析
  assert.equal(resolveProvider({ agentProvider: 'copilot' }).name, 'copilot', 'task.agentProvider 優先解析');
  assert.equal(resolveProvider({ provider: 'claude' }).name, 'claude', 'task.provider 別名解析相容');
  assert.equal(resolveProvider({ assignedAgent: 'Claude' }).name, 'claude', 'task.assignedAgent 應正確映射至 claude');
  assert.equal(resolveProvider({ assignee: 'Codex' }).name, 'codex', 'task.assignee 應正確映射至 codex');
  assert.equal(resolveProvider({ assignee: 'All' }).name, 'generic', 'task.assignee=All 應映射至 generic');
  assert.equal(resolveProvider({ assignedAgent: 'Universal' }).name, 'generic', 'task.assignedAgent=Universal 應映射至 generic');
  assert.equal(resolveProvider({ assignedAgent: 'Generic' }).name, 'generic', 'task.assignedAgent=Generic 應映射至 generic');
  assert.equal(resolveProvider({ assignee: 'Auto' }).name, 'generic', 'task.assignee=Auto 應映射至 generic');
  assert.equal(resolveProvider({ assignedAgent: 'Orchestrator' }).name, 'antigravity', '無 env 時 Orchestrator 預設映射至 antigravity');
  assert.equal(resolveProvider({ assignee: 'Hydrogen' }).name, 'antigravity', '無 env 時 Hydrogen 預設映射至 antigravity');
  assert.equal(resolveProvider({ assignee: 'Fast' }).name, 'antigravity', '無 env 時 Fast 預設映射至 antigravity');
  assert.equal(resolveProvider({ assignee: 'Direct' }).name, 'antigravity', '無 env 時 Direct 預設映射至 antigravity');

  assert.equal(resolveProvider({ assignedAgent: 'Orchestrator (Neon)' }).name, 'antigravity', 'Orchestrator (Neon) 應映射至 antigravity');
  assert.equal(resolveProvider({ assignedAgent: 'Orchestrator (Argon)' }).name, 'antigravity', 'Orchestrator (Argon) 應映射至 antigravity');
  assert.equal(resolveProvider({ assignee: 'Neon' }).name, 'antigravity', 'Neon 應映射至 antigravity');
  assert.equal(resolveProvider({ assignee: 'Argon' }).name, 'antigravity', 'Argon 應映射至 antigravity');
  assert.equal(resolveProvider({ assignee: 'Gemini' }).name, 'antigravity', 'Gemini 應映射至 antigravity');
  assert.equal(resolveProvider({ assignee: 'Sonnet' }).name, 'claude', 'Sonnet 應映射至 claude');
  assert.equal(resolveProvider({ assignee: 'Opus' }).name, 'claude', 'Opus 應映射至 claude');
  assert.equal(resolveProvider({ assignee: 'GPT-5' }).name, 'codex', 'GPT-5 應映射至 codex');

  const oldEnv = process.env.AGENT_PROVIDER;
  try {
    process.env.AGENT_PROVIDER = 'codex';
    assert.equal(resolveProvider({}).name, 'codex', '環境變數 AGENT_PROVIDER 解析成功');
    assert.equal(resolveProvider({ assignedAgent: 'Orchestrator' }).name, 'codex', '環境變數指定平台時應優先尊重平台');
    assert.equal(resolveProvider({ assignee: 'Direct' }).name, 'codex', '環境變數指定平台時中性別名 Direct 應尊重平台');
    delete process.env.AGENT_PROVIDER;
    assert.equal(resolveProvider({}).name, 'antigravity', '無配置時預設回退至 antigravity 以保向下相容');
  } finally {
    if (oldEnv !== undefined) process.env.AGENT_PROVIDER = oldEnv;
    else delete process.env.AGENT_PROVIDER;
  }
  console.log('  ✅ resolveProvider 優先序、通用別名解析與預設相容性驗證通過');

  // 3. 驗證 formatTierStrategy 針對各平台生成能力分層策略、單行限制與動態覆寫
  // Copilot
  const copilotStandard = formatTierStrategy('standard', 'copilot');
  assert(copilotStandard.includes('Copilot Subagent'), 'Copilot standard 應包含傳統單階段降級備援 Copilot Subagent');
  assert(copilotStandard.includes('Tier: standard Planner→Executor'), '標準策略語義應完整');
  assert(copilotStandard.includes('0 讀碼第 1 步'), 'Copilot standard 應要求 Planning 階段 0 讀碼第 1 步交棒');
  assert(copilotStandard.includes('Copilot Fast 單線程直行'), 'Copilot standard 應包含內建執行階段直行描述');

  const copilotHeavy = formatTierStrategy('heavy', 'copilot');
  assert(copilotHeavy.includes('Copilot Verifier (Reasoning / 深度推理模式)'), 'Copilot heavy 應包含通用 Reasoning Verifier');
  assert(copilotHeavy.includes('Model: "inherit"'), 'Copilot heavy 應包含 Model: "inherit" 選項');

  // Claude Code
  const claudeStandard = formatTierStrategy('standard', 'claude');
  assert(claudeStandard.includes('Haiku Subagent'), 'Claude standard 應提示 Haiku Subagent');
  assert(claudeStandard.includes('Claude Plan Mode (Plan→Act)'), 'Claude standard 應包含 Plan Mode 0 讀碼交棒指示');
  assert(claudeStandard.includes('Haiku / Sonnet 單線程直行'), 'Claude standard 應帶出內建執行階段直行描述');
  const claudeHeavy = formatTierStrategy('heavy', 'claude');
  assert(claudeHeavy.includes('Opus / Thinking Verifier'), 'Claude heavy 應提示 Opus / Thinking Verifier');

  // OpenAI Codex
  const codexStandard = formatTierStrategy('standard', 'codex');
  assert(codexStandard.includes('Worker Subagent (Fast / Mini 輕量檔位)'), 'Codex standard 應提示 Fast / Mini 輕量檔位');
  const codexHeavy = formatTierStrategy('heavy', 'codex');
  assert(codexHeavy.includes('Reasoner Verifier (Reasoning / 深度推理檔位)'), 'Codex heavy 應提示 Reasoning 深度推理檔位');

  // Antigravity (保留向下相容契約 + 通用能力分層 Swarm 選模策略)
  const agyMicro = formatTierStrategy('micro', 'antigravity');
  assert(!agyMicro.includes('swarm'), 'antigravity micro 不得包含 swarm');
  const agyStandard = formatTierStrategy('standard', 'antigravity');
  assert(!agyStandard.includes('swarm'), 'antigravity standard 不得包含 swarm');
  assert(agyStandard.includes('flash Subagent (Workspace: "inherit")'), 'Antigravity standard 必須保留 flash Subagent 相容鍵字');
  assert(agyStandard.includes('Orchestrator (Plan→Execute 原生雙階段)'), 'Antigravity standard 應包含 Orchestrator 原生雙階段說明');
  assert(agyStandard.includes('0 讀碼第 1 步直接交棒內建執行階段 (Fast / Direct 高速直行模式 (平台內建執行模型))'), 'Antigravity standard 應要求 0 讀碼第 1 步交棒內建執行階段');

  const agyHeavy = formatTierStrategy('heavy', 'antigravity');
  assert(agyHeavy.includes('pro Verifier (Model: "pro", Workspace: "inherit")'), 'Antigravity heavy 必須保持 pro Verifier');
  assert(agyHeavy.includes('0 讀碼第 1 步立即交棒內建執行階段 (Fast / Direct 高速直行模式 (平台內建執行模型))'), 'Antigravity heavy 應要求 0 讀碼第 1 步交棒內建執行階段');
  assert(agyHeavy.includes('Model: "inherit"'), 'Antigravity heavy 分擔切片應支援 Model: "inherit"');
  assert(agyHeavy.includes('cross-model-review'), 'Antigravity heavy 應支援 cross-model-review 觸發 Verifier');
  assert(agyHeavy.includes('swarm'), 'antigravity heavy 必須包含 swarm');
  assert(agyHeavy.includes('Coordinator 不寫碼'), 'antigravity heavy 必須包含 Coordinator 不寫碼');
  assert(agyHeavy.includes('swarm({action:"models",all:true})'), 'antigravity heavy 必須包含 swarm({action:"models",all:true})');
  assert(agyHeavy.includes('依剩餘額度與重置週期選模'), 'antigravity heavy 必須包含依剩餘額度與重置週期選模原則');
  assert(agyHeavy.includes('workspace:"share"'), 'antigravity heavy 必須包含 workspace:"share"');
  assert(agyHeavy.includes('審查禁 inherit'), 'antigravity heavy 必須包含 審查禁 inherit');
  assert(agyHeavy.includes('assumptions/deviations/unverified'), 'antigravity heavy 必須包含 assumptions/deviations/unverified');
  assert(!agyHeavy.includes('\n'), 'antigravity heavy 必須無換行');

  // 預設策略不得硬編碼特定版本號模型
  requiredProviders.forEach(p => {
    ['micro', 'standard', 'heavy'].forEach(tier => {
      const strategy = formatTierStrategy(tier, p);
      hardcodedVersionedModels.forEach(legacy => {
        assert(!strategy.includes(legacy), `預設 ${p} ${tier} 策略不得硬編碼特定版本模型 ${legacy}`);
      });
    });
  });

  // 跨平台隔離：claude / codex / copilot / generic 的 heavy 策略不得包含 swarm({action:"models"
  ['claude', 'codex', 'copilot', 'generic'].forEach(p => {
    const heavy = formatTierStrategy('heavy', p);
    assert(!heavy.includes('swarm({action:"models"'), `${p} heavy 策略不得包含 swarm({action:"models"`);
  });

  // 驗證 options.swarmModels 與環境變數動態覆寫
  const optOverrideHeavy = formatTierStrategy('heavy', 'antigravity', {
    swarmModels: {
      executor: ['custom-fast-a', 'custom-fast-b'],
      reviewer: ['custom-reviewer-1', 'custom-reviewer-2']
    }
  });
  assert(optOverrideHeavy.includes('custom-fast-a / custom-fast-b'), 'options.swarmModels.executor 應覆寫實作模型清單');
  assert(optOverrideHeavy.includes('custom-reviewer-1 → custom-reviewer-2'), 'options.swarmModels.reviewer 應覆寫審查模型清單');
  assert(!optOverrideHeavy.includes('\n'), 'options 覆寫後仍必須維持單行');

  const oldExecEnv = process.env.AGENT_SWARM_EXECUTOR_MODELS;
  const oldRevEnv = process.env.AGENT_SWARM_REVIEWER_MODELS;
  try {
    process.env.AGENT_SWARM_EXECUTOR_MODELS = 'env-fast-1, env-fast-2';
    process.env.AGENT_SWARM_REVIEWER_MODELS = 'env-rev-1, env-rev-2';
    const envOverrideHeavy = formatTierStrategy('heavy', 'antigravity');
    assert(envOverrideHeavy.includes('env-fast-1 / env-fast-2'), '環境變數 AGENT_SWARM_EXECUTOR_MODELS 應覆寫實作模型清單');
    assert(envOverrideHeavy.includes('env-rev-1 → env-rev-2'), '環境變數 AGENT_SWARM_REVIEWER_MODELS 應覆寫審查模型清單');

    // options 應優先於環境變數
    const optPriorityHeavy = formatTierStrategy('heavy', 'antigravity', {
      swarmModels: { executor: 'opt-wins-exec', reviewer: 'opt-wins-rev' }
    });
    assert(optPriorityHeavy.includes('opt-wins-exec') && !optPriorityHeavy.includes('env-fast-1'), 'options.swarmModels 應優先於環境變數');
    assert(optPriorityHeavy.includes('opt-wins-rev') && !optPriorityHeavy.includes('env-rev-1'), 'options.swarmModels 審查清單應優先於環境變數');
  } finally {
    if (oldExecEnv !== undefined) process.env.AGENT_SWARM_EXECUTOR_MODELS = oldExecEnv;
    else delete process.env.AGENT_SWARM_EXECUTOR_MODELS;
    if (oldRevEnv !== undefined) process.env.AGENT_SWARM_REVIEWER_MODELS = oldRevEnv;
    else delete process.env.AGENT_SWARM_REVIEWER_MODELS;
  }

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
  console.log('  ✅ formatTierStrategy 四大平台、能力分層、動態覆寫與單行限制驗證通過');

  // 3.5 驗證 selectModelFromCatalog 動態模型選取（額度、重置週期、跨家族與未來模型名稱泛化）
  const nowMs = Date.parse('2026-11-19T02:00:00Z');
  const sampleCatalog = {
    models: [
      'gemini-pro-orchestrator-neon',
      'gemini-pro-orchestrator-g1-pro',
      'claude-opus-5-5-high',
      'gemini-4-argon-high',
      'gemini-4-neon-medium',
      'gemini-4-neon-xhigh',
      'gemini-4-hydrogen-medium',
      'gemini-3.8-flash-medium'
    ],
    quotas: {
      'gemini-pro-orchestrator-neon': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' },
      'gemini-pro-orchestrator-g1-pro': { quota_remaining: '40%', quota_resets: '2026-11-25T02:27:14Z' },
      'claude-opus-5-5-high': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' },
      'gemini-4-argon-high': { quota_remaining: '40%', quota_resets: '2026-11-25T02:27:14Z' },
      'gemini-4-neon-medium': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' },
      'gemini-4-neon-xhigh': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' },
      'gemini-4-hydrogen-medium': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' },
      'gemini-3.8-flash-medium': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' }
    }
  };

  // (a) executor 選取高速低耗且排除 orchestrator
  const pickedExec = selectModelFromCatalog(sampleCatalog, 'executor', { nowMs });
  assert(pickedExec, '應選出可用的 executor 模型');
  assert.equal(pickedExec.tier, 'fast', 'executor 應優先選擇 fast tier 模型');
  assert(!pickedExec.model.includes('orchestrator'), 'executor 候選必須排除 orchestrator');
  assert(pickedExec.candidates.every(c => c.tier !== 'orchestrator'), 'candidates 不得包含 orchestrator');

  // (b) reviewer 有跨家族額度時選不同家族高階，且排除 currentModel
  const pickedRevCross = selectModelFromCatalog(sampleCatalog, 'reviewer', {
    currentModel: 'gemini-4-neon-medium',
    nowMs
  });
  assert.equal(pickedRevCross.model, 'claude-opus-5-5-high', '跨家族有額度時應優先選不同家族旗艦審查模型');
  assert(!pickedRevCross.candidates.some(c => c.model === 'gemini-4-neon-medium'), 'reviewer 候選必須排除 currentModel (審查禁 inherit)');

  // (c) 跨家族 0% 額度時，100% 短重置高階 (neon-xhigh) 應勝過 40% 長重置旗艦 (argon-high)
  const exhaustedCrossCatalog = {
    ...sampleCatalog,
    quotas: {
      ...sampleCatalog.quotas,
      'claude-opus-5-5-high': { quota_remaining: '0%', quota_resets: '2026-11-19T06:58:16Z' }
    }
  };
  const pickedRevFallback = selectModelFromCatalog(exhaustedCrossCatalog, 'reviewer', {
    currentModel: 'gemini-4-neon-medium',
    nowMs
  });
  assert.equal(pickedRevFallback.model, 'gemini-4-neon-xhigh', '跨家族無額度時應優先選短重置且滿額的 neon-xhigh，而非長重置 40% 的 argon-high');

  // (d) 未來假想模型名稱泛化驗證
  const futureCatalog = {
    models: [
      'gemini-5-orchestrator',
      'gemini-5-flash-medium',
      'gemini-5-neon-xhigh',
      'claude-opus-6-high'
    ],
    quotas: {
      'gemini-5-orchestrator': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' },
      'gemini-5-flash-medium': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' },
      'gemini-5-neon-xhigh': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' },
      'claude-opus-6-high': { quota_remaining: '100%', quota_resets: '2026-11-19T06:58:16Z' }
    }
  };
  assert.equal(selectModelFromCatalog(futureCatalog, 'executor', { nowMs }).model, 'gemini-5-flash-medium', '未來版本 fast 模型應無須改碼自動選中');
  assert.equal(
    selectModelFromCatalog(futureCatalog, 'reviewer', { currentModel: 'gemini-5-neon-xhigh', nowMs }).model,
    'claude-opus-6-high',
    '未來版本跨家族旗艦審查模型應無須改碼自動選中'
  );

  // (e) 全模型 0% 額度回傳 null
  const emptyCatalog = {
    models: ['gemini-4-neon-medium', 'claude-opus-5-5-high'],
    quotas: {
      'gemini-4-neon-medium': { quota_remaining: '0%' },
      'claude-opus-5-5-high': { quota_remaining: '0%' }
    }
  };
  assert.equal(selectModelFromCatalog(emptyCatalog, 'reviewer', { nowMs }), null, '全部模型 0% 額度時應回傳 null');
  console.log('  ✅ selectModelFromCatalog 動態目錄、額度與重置週期自適應選模驗證通過');

  // 4. 驗證 determineTaskTier 針對大型複雜任務 (如 TASK-208 模式) 升級為 heavy 與哨兵 Brief 行數限制
  const { determineTaskTier: gateDetermineTier, formatWakeupBrief } = require('./watch-task-gate');
  const { determineTaskTier: fmDetermineTier } = require('../src/server/feedbackManager');

  const complexTask208Style = {
    id: 'TASK-TEST-208',
    title: '根據文件調整選單與建立畫面，並串接 API',
    description: '根據專案下的 doc/request.md 規劃執行內容',
    project: 'task-dashboard',
    tags: ['cross-model-review', 'frontend-ui-engineering', 'gitnexus', 'orchestrator', 'test-driven-development', 'feat']
  };
  assert.equal(gateDetermineTier(complexTask208Style), 'heavy', '含 orchestrator/cross-model-review 或根據文件串接 API 之任務必須判定為 heavy');
  assert.equal(fmDetermineTier(complexTask208Style), 'heavy', 'feedbackManager determineTaskTier 應同步判定為 heavy');

  const multiDomainTask = {
    id: 'TASK-TEST-MULTI',
    title: '調整表單邏輯',
    description: '補齊欄位驗證',
    tags: ['api-design', 'ui-engineering', 'tdd', 'feat']
  };
  assert.equal(gateDetermineTier(multiDomainTask), 'heavy', '具備 >= 3 個領域技能標籤應升級為 heavy');
  assert.equal(fmDetermineTier(multiDomainTask), 'heavy', 'feedbackManager 應同步升級 >= 3 個領域技能標籤任務');

  const keywordHeavyTask = {
    id: 'TASK-TEST-KW',
    title: '根據文件調整選單與串接 API',
    description: '依規格調整',
    tags: ['feat']
  };
  assert.equal(gateDetermineTier(keywordHeavyTask), 'heavy', '標題含根據文件與串接 API 應判定為 heavy');
  assert.equal(fmDetermineTier(keywordHeavyTask), 'heavy', 'feedbackManager 應同步判定關鍵字 heavy');

  const microTask = { id: 'TASK-TEST-MICRO', title: '修正錯字', tier: 'micro', project: 'task-dashboard' };
  const microBrief = formatWakeupBrief(microTask, 'WAKEUP_IMMEDIATE');
  assert(!/subagent/i.test(microBrief), 'micro 任務哨兵輸出不得包含 Subagent 字樣');
  assert(microBrief.split('\n').length <= 15, `micro 哨兵輸出必須 ≤ 15 行，實際: ${microBrief.split('\n').length}`);

  const heavyBrief = formatWakeupBrief(complexTask208Style, 'WAKEUP_IMMEDIATE');
  assert(heavyBrief.includes('Tier: heavy Planner→Executor'), 'heavyBrief 必須包含 heavy 策略');
  assert(!heavyBrief.includes('免外開'), 'heavyBrief 不得包含免外開 Subagent');
  assert(heavyBrief.split('\n').length <= 15, `heavy 哨兵輸出必須 ≤ 15 行，實際: ${heavyBrief.split('\n').length}`);

  console.log('  ✅ determineTaskTier 複雜任務升級為 heavy 與哨兵 Brief 行數/規範驗證通過');

  // 5. 驗證 GitNexus 動態偵測與跨專案 worklog 狀態字典解析
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { detectProjectGitNexus, formatGitNexusGuidance } = require('../src/server/gitnexusDetector');
  const { resolveWorklogStatusLabel } = require('../src/server/worklogParser');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'td-phase1-test-'));
  try {
    const noGnProj = path.join(tmpRoot, 'plain-proj');
    fs.mkdirSync(noGnProj, { recursive: true });
    assert.equal(detectProjectGitNexus(noGnProj).hasGitNexus, false, '無 .gitnexus 目錄時應回傳 false');
    assert.equal(formatGitNexusGuidance(noGnProj), '', '無 GitNexus 專案不得輸出圖譜指示');
    assert.equal(resolveWorklogStatusLabel(noGnProj, 'in_progress'), 'in_progress', '預設專案維持 in_progress');
    assert.equal(resolveWorklogStatusLabel(noGnProj, 'review'), 'review', '預設專案維持 review');

    const wrapperProj = path.join(tmpRoot, 'wrapper-proj');
    fs.mkdirSync(path.join(wrapperProj, '.gitnexus'), { recursive: true });
    fs.writeFileSync(path.join(wrapperProj, '.gitnexus', 'run.cjs'), '// stub');
    const wrapperInfo = detectProjectGitNexus(wrapperProj);
    assert.equal(wrapperInfo.hasGitNexus, true, '有 run.cjs 時應偵測為 hasGitNexus');
    assert.equal(wrapperInfo.commandPrefix, 'node .gitnexus/run.cjs', '應採用本地 run.cjs');
    assert.equal(wrapperInfo.repoFlag, '--repo .', 'wrapper 模式應帶 --repo .');
    const wrapperLine = formatGitNexusGuidance(wrapperProj);
    assert(wrapperLine.includes('node .gitnexus/run.cjs query') && !/subagent/i.test(wrapperLine), '指示必須含 query 且不含 Subagent');
    // 驗證 stale 時指示必須帶 --index-only 避免覆寫 AGENTS.md / CLAUDE.md
    execFileSync('git', ['-C', wrapperProj, 'init', '-b', 'main']);
    execFileSync('git', ['-C', wrapperProj, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', wrapperProj, 'config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(wrapperProj, 'a.txt'), '1\n');
    execFileSync('git', ['-C', wrapperProj, 'add', 'a.txt']);
    execFileSync('git', ['-C', wrapperProj, 'commit', '-m', 'init']);
    fs.writeFileSync(path.join(wrapperProj, '.gitnexus', 'meta.json'), JSON.stringify({ lastCommit: '0000000' }));
    const staleLine = formatGitNexusGuidance(wrapperProj);
    assert(staleLine.includes('node .gitnexus/run.cjs analyze --index-only'), '索引過期指示必須包含 analyze --index-only');

    const globalGnProj = path.join(tmpRoot, 'my-curation-app');
    fs.mkdirSync(path.join(globalGnProj, '.gitnexus'), { recursive: true });
    fs.writeFileSync(path.join(globalGnProj, '.gitnexus', 'meta.json'), JSON.stringify({ lastCommit: 'abc1234' }));
    const globalInfo = detectProjectGitNexus(globalGnProj);
    assert.equal(globalInfo.commandPrefix, 'npx gitnexus', '無 run.cjs 時應採用 npx gitnexus');
    assert.equal(globalInfo.repoFlag, '-r my-curation-app', '無 run.cjs 時應自動補 -r <repo> 防多倉衝突');

    const dictProj = path.join(tmpRoot, 'dict-proj');
    fs.mkdirSync(path.join(dictProj, '.github', 'harness'), { recursive: true });
    fs.writeFileSync(
      path.join(dictProj, '.github', 'harness', 'harness-status-dictionary.md'),
      '# 狀態字典\n- 未開始：...\n- 進行中：...\n- 已完成：...\n'
    );
    assert.equal(resolveWorklogStatusLabel(dictProj, 'in_progress'), '進行中', '中文狀態字典專案應輸出 進行中');
    assert.equal(resolveWorklogStatusLabel(dictProj, 'review'), '進行中', '中文狀態字典專案於 review 階段應維持 進行中');
    assert.equal(resolveWorklogStatusLabel(dictProj, 'done'), '已完成', '中文狀態字典專案於 done 應輸出 已完成');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  console.log('  ✅ GitNexus 動態偵測與跨專案 worklog 狀態字典解析驗證通過');

  console.log('🎉 所有 Agent Provider Adapter 單元測試順利通過！');
}

testAgentProviderAdapter();
