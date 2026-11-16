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

  // 3. 驗證 formatTierStrategy 針對各平台正確生成「0 讀碼秒交棒 + 內建執行階段實作」策略且嚴守單行
  // Copilot (Agent Mode / Subagents)
  const copilotStandard = formatTierStrategy('standard', 'copilot');
  assert(copilotStandard.includes('Copilot Subagent'), 'Copilot standard 應包含傳統單階段降級備援 Copilot Subagent');
  assert(copilotStandard.includes('Tier: standard Planner→Executor'), '標準策略語義應完整');
  assert(copilotStandard.includes('0 讀碼第 1 步'), 'Copilot standard 應要求 Planning 階段 0 讀碼第 1 步交棒');
  assert(copilotStandard.includes('Copilot Fast 單線程直行'), 'Copilot standard 應包含內建執行階段直行描述');

  const copilotHeavy = formatTierStrategy('heavy', 'copilot');
  assert(copilotHeavy.includes('Copilot Verifier (OpenAI o1 Reasoning Mode)'), 'Copilot heavy 應包含 o1 獨立 Verifier');
  assert(copilotHeavy.includes('Model: "inherit"'), 'Copilot heavy 應包含 Model: "inherit" 選項');

  // Claude Code
  const claudeStandard = formatTierStrategy('standard', 'claude');
  assert(claudeStandard.includes('Haiku Subagent'), 'Claude standard 應提示 Haiku Subagent');
  assert(claudeStandard.includes('Claude Plan Mode (Plan→Act)'), 'Claude standard 應包含 Plan Mode 0 讀碼交棒指示');
  assert(claudeStandard.includes('Haiku / Sonnet 單線程直行'), 'Claude standard 應帶出內建執行階段直行描述');
  const claudeHeavy = formatTierStrategy('heavy', 'claude');
  assert(claudeHeavy.includes('Opus / Thinking Verifier'), 'Claude heavy 應提示 Opus Verifier');

  // OpenAI Codex
  const codexStandard = formatTierStrategy('standard', 'codex');
  assert(codexStandard.includes('Worker Subagent (gpt-4o-mini)'), 'Codex standard 應提示 Mini Worker');
  const codexHeavy = formatTierStrategy('heavy', 'codex');
  assert(codexHeavy.includes('Reasoner Verifier (o1 / o3-mini)'), 'Codex heavy 應提示 o1/o3 Reasoner');

  // Antigravity (向下相容 + Orchestrator 0 讀碼第 1 步交棒給內建 Hydrogen 執行階段)
  const agyStandard = formatTierStrategy('standard', 'antigravity');
  assert(agyStandard.includes('flash Subagent (Workspace: "inherit")'), 'Antigravity standard 必須保留 flash Subagent 相容鍵字');
  assert(agyStandard.includes('Orchestrator (Plan→Execute 原生雙階段)'), 'Antigravity standard 應包含 Orchestrator 原生雙階段說明');
  assert(agyStandard.includes('0 讀碼第 1 步直接交棒內建執行階段 (Hydrogen / Fast 直行模式)'), 'Antigravity standard 應要求 0 讀碼第 1 步交棒內建 Hydrogen');
  const agyHeavy = formatTierStrategy('heavy', 'antigravity');
  assert(agyHeavy.includes('pro Verifier (Model: "pro", Workspace: "inherit")'), 'Antigravity heavy 必須保持 pro Verifier');
  assert(agyHeavy.includes('0 讀碼第 1 步立即交棒內建執行階段 (Hydrogen / Fast 直行模式)'), 'Antigravity heavy 應要求 0 讀碼第 1 步交棒內建 Hydrogen');
  assert(agyHeavy.includes('Model: "inherit"'), 'Antigravity heavy 分擔切片應支援 Model: "inherit"');
  assert(agyHeavy.includes('cross-model-review'), 'Antigravity heavy 應支援 cross-model-review 觸發 Verifier');

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
  console.log('  ✅ formatTierStrategy 四大平台、0 讀碼秒交棒與單行限制驗證通過');

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
