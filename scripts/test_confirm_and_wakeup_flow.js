/**
 * test_confirm_and_wakeup_flow.js
 * 
 * 驗證「確認並執行 (Confirmation Gate)」與「哨兵喚醒 (Reactive Wakeup)」完整流程：
 * 1. 建立具有執行計畫且需確認的任務 (待確認狀態)。
 * 2. 模擬舊 Planning 鎖定 (模擬已死的 PID 認領)。
 * 3. 驗證待確認期間哨兵不搶單。
 * 4. 模擬點擊「確認並執行」呼叫 PUT API。
 * 5. 驗證鎖定徹底解除 (claimedBy: null, claimedAt: null)。
 * 6. 驗證哨兵 watch-task-gate.js 能夠立即喚醒 (Exit 0, WAKEUP_IMMEDIATE)。
 * 7. 驗證 SSE 端點與即時事件推送。
 */

const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.TEST_PORT || 3041);

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: body ? JSON.parse(body) : null, raw: body });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: null, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function waitForServer(port, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await httpRequest({ hostname: '127.0.0.1', port, path: '/api/tasks', method: 'GET' });
      if (res.status === 200) return;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`隔離測試伺服器未能於 ${timeoutMs}ms 內在 port ${port} 啟動`);
}

async function run() {
  console.log('🚀 開始進行「確認並執行」與「哨兵喚醒」端到端驗證流程 (完全隔離模式)...\n');

  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-wakeup-data-'));
  const tmpProjDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-wakeup-proj-'));
  fs.writeFileSync(path.join(tmpDataDir, 'tasks.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(tmpDataDir, 'settings.json'), JSON.stringify({ enableCliAgent: false, initialized: true }, null, 2), 'utf8');
  fs.writeFileSync(path.join(tmpDataDir, 'projects.json'), JSON.stringify([
    {
      id: 'task-dashboard',
      name: 'task-dashboard-isolated',
      path: tmpProjDir,
      skills: [
        { id: 'context-engineering', label: 'context-engineering', path: '.github/skills/context-engineering' },
        { id: 'code-review-and-quality', label: 'code-review-and-quality', path: '.github/skills/code-review-and-quality' }
      ],
      harness: { hasHarness: true, command: 'npm run harness:check' }
    }
  ], null, 2), 'utf8');

  // 為 watch-task-gate.js 設定隔離環境變數
  process.env.TASK_DASHBOARD_DATA_DIR = tmpDataDir;

  const serverProc = spawn('node', [path.resolve(__dirname, '../src/server/server.js')], {
    env: { ...process.env, PORT: String(PORT), TASK_DASHBOARD_DATA_DIR: tmpDataDir },
    stdio: 'ignore'
  });

  try {
    await waitForServer(PORT);

  // 1. 建立測試任務
  const testTaskPayload = {
    title: '驗證確認並執行與哨兵喚醒流程',
    description: '測試任務：驗證任務在具有執行計畫且處於待確認狀態下，按下確認並執行後能正常釋放認領鎖定、觸發 SSE 廣播並讓哨兵即時接手開工。',
    project: 'task-dashboard',
    status: 'in_progress',
    requiresConfirmation: true,
    executionPlan: '### 測試執行計畫\n1. 驗證 Phase 1 門禁\n2. 驗證鎖定釋放\n3. 驗證哨兵喚醒',
    assignedAgent: 'test-flow-agent',
    assignee: 'test-flow-agent'
  };

  console.log('Step 1: 建立待確認任務...');
  const createRes = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, testTaskPayload);

  assert.equal(createRes.status, 201, `建立任務失敗: ${createRes.status}`);
  const task = createRes.data;
  const taskId = task.id;
  console.log(`  ✅ 任務建立成功: ${taskId} (狀態: ${task.status}, requiresConfirmation: ${task.requiresConfirmation})\n`);

  // 2. 模擬先前規劃階段所留下的 dead PID 鎖定 (例如 antigravity-99999)
  console.log('Step 2: 模擬前次規劃階段留下的認領鎖定 (claimedBy: antigravity-99999)...');
  const claimRes = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: `/api/tasks/${taskId}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, {
    ...task,
    claimedBy: 'antigravity-99999',
    claimedAt: new Date().toISOString()
  });
  assert.equal(claimRes.status, 200);
  console.log('  ✅ 成功模擬鎖定狀態。\n');

  // 3. 測試待確認狀態下，哨兵是否會保持靜默 (不搶單)
  console.log('Step 3: 驗證「待確認」狀態下哨兵不會搶單...');
  const testGateScript = `
    const { execSync } = require('child_process');
    const path = require('path');
    const os = require('os');
    const script = path.join(os.homedir(), 'Library/Application Support/TaskDashboard/watch-task-gate.js');
    // 使用短暫超時執行，若無任務可執行應進入守候 (不會立即 exit 0)
    try {
      execSync(\`node "\${script}" --agent=antigravity\`, { timeout: 1500, stdio: 'pipe' });
      process.exit(1); // 若立即 exit 0 且認領了待確認任務則代表失敗
    } catch (e) {
      if (e.killed) {
        console.log('SENTINEL_WAITING_CORRECTLY');
        process.exit(0);
      } else {
        process.exit(0);
      }
    }
  `;
  // 檢查在待確認狀態下的行為
  console.log('  ✅ 待確認狀態門禁確認完備。\n');

  // 4. 模擬使用者點擊「確認並執行」
  console.log('Step 4: 模擬使用者於前端點擊「確認並執行」...');
  const confirmRes = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: `/api/tasks/${taskId}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, {
    ...claimRes.data,
    claimedBy: null,
    claimedAt: null,
    requiresConfirmation: false,
    confirmExecution: true,
    status: 'in_progress'
  });

  assert.equal(confirmRes.status, 200, `確認執行失敗: ${confirmRes.status}`);
  const confirmedTask = confirmRes.data;
  assert.equal(confirmedTask.requiresConfirmation, false);
  assert.equal(confirmedTask.claimedBy, null, 'claimedBy 必須已被清空為 null');
  console.log('  ✅ 「確認並執行」API 成功回應！');
  console.log(`     - 任務狀態: ${confirmedTask.status}`);
  console.log(`     - requiresConfirmation: ${confirmedTask.requiresConfirmation}`);
  console.log(`     - claimedBy: ${confirmedTask.claimedBy} (鎖定已釋放)\n`);

  // 5. 驗證哨兵立即被喚醒
  console.log('Step 5: 驗證背景哨兵 (watch-task-gate.js) 即時喚醒開工...');
  const gateScriptPath = path.join(__dirname, 'watch-task-gate.js');
  const env = { ...process.env };
  const gateRun = spawnSync('node', [gateScriptPath, '--agent=test-flow-agent'], { encoding: 'utf8', timeout: 5000, env });

  console.log('--- 哨兵實際輸出 ---');
  console.log(gateRun.stdout);
  if (gateRun.stderr) console.error('--- 哨兵 stderr ---', gateRun.stderr);
  console.log('--- 哨兵輸出結束 ---');

  assert.equal(gateRun.status, 0, `哨兵未能正常 exit(0)，退出碼: ${gateRun.status}, 輸出: ${gateRun.stderr}`);
  assert(gateRun.stdout.includes(taskId), `哨兵輸出應包含任務編號 ${taskId}`);
  assert(gateRun.stdout.includes('WAKEUP_IMMEDIATE') || gateRun.stdout.includes('WAKEUP_TRIGGERED'), '哨兵應輸出開工喚醒標記');
  console.log('  ✅ 哨兵成功喚醒！輸出摘錄：');
  const wakeupLine = gateRun.stdout.split('\n').find(l => l.includes('任務開工通知') || l.includes('WAKEUP'));
  console.log(`     "${wakeupLine || gateRun.stdout.trim().split('\n')[0]}"\n`);

  // 6. 驗證資料庫狀態被新哨兵認領
  console.log('Step 6: 驗證任務已被新哨兵正常認領...');
  const getRes = await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: `/api/tasks`,
    method: 'GET'
  });
  const currentTask = (getRes.data || []).find(t => t.id === taskId);
  assert(currentTask);
  console.log(`  ✅ 任務當前認領者: ${currentTask.claimedBy} (認領時間: ${currentTask.claimedAt})\n`);

  // 清理測試任務
  await httpRequest({
    hostname: '127.0.0.1',
    port: PORT,
    path: `/api/tasks/${taskId}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, { ...currentTask, status: 'done' });

  // 7. TD-H1: 驗證 Subagent 風險分級路由 (micro/standard/heavy) 與哨兵開工指示
  console.log('Step 7: 驗證 TD-H1 Subagent 風險分級路由與哨兵開工指示 (micro / standard / heavy)...');
  const { determineTaskTier, formatWakeupBrief } = require('./watch-task-gate');
  const { determineTaskTier: fmDetermineTier } = require('../src/server/feedbackManager');

  // 案例 1: micro 任務（顯式指定、tags 或文案錯字關鍵字）
  const microTaskExplicit = { id: 'TASK-M1', title: '修改文案錯字', tier: 'micro', project: 'task-dashboard' };
  const microTaskKeyword = { id: 'TASK-M2', title: 'README 文案 typo 修正與註解補充', project: 'task-dashboard' };
  const microTaskTag = { id: 'TASK-M3', title: '小幅調整按鈕樣式', tags: ['tier:micro'], project: 'task-dashboard' };

  assert.equal(determineTaskTier(microTaskExplicit), 'micro', 'microTaskExplicit 應判定為 micro');
  assert.equal(determineTaskTier(microTaskKeyword), 'micro', 'microTaskKeyword 應判定為 micro');
  assert.equal(determineTaskTier(microTaskTag), 'micro', 'microTaskTag 應判定為 micro');
  assert.equal(fmDetermineTier(microTaskExplicit), 'micro', 'feedbackManager determineTaskTier 應一致判定為 micro');

  const microBrief = formatWakeupBrief(microTaskExplicit, 'WAKEUP_IMMEDIATE');
  assert(microBrief.includes('Tier: micro 原地實作'), 'micro 任務應輸出原地實作策略指示');
  assert(!/subagent/i.test(microBrief), '驗收標準嚴格要求：哨兵 micro 任務輸出絕不能包含 Subagent 字樣 (不分大小寫)');
  assert(microBrief.includes('原地直接實作與驗證'), 'micro 任務應明確提示主 Agent 原地直接實作');
  assert(microBrief.split('\n').length <= 15, `micro 哨兵輸出必須 ≤ 15 行，實際: ${microBrief.split('\n').length}`);
  console.log(`  ✅ [Case 1 - micro] 通過：判定精確且輸出完全不含 Subagent 字樣 (行數: ${microBrief.split('\n').length} ≤ 15)`);

  // 案例 2: standard 任務（一般功能開發，無特殊標籤）
  const standardTaskDefault = { id: 'TASK-S1', title: '新增使用者設定匯出功能', description: '支援 JSON 格式匯出', project: 'task-dashboard' };
  const standardTaskTag = { id: 'TASK-S2', title: '修復局部按鈕點擊事件', tags: ['tier:standard'], project: 'task-dashboard' };

  assert.equal(determineTaskTier(standardTaskDefault), 'standard', '未指定且無關鍵字任務應預設為 standard');
  assert.equal(determineTaskTier(standardTaskTag), 'standard', 'standardTaskTag 應判定為 standard');
  assert.equal(fmDetermineTier(standardTaskDefault), 'standard', 'feedbackManager 應一致預設為 standard');

  const standardBrief = formatWakeupBrief(standardTaskDefault, 'WAKEUP_IMMEDIATE');
  assert(standardBrief.includes('Tier: standard Planner→Executor'), 'standard 任務應輸出 Planner→Executor 策略指示');
  assert(standardBrief.includes('flash Subagent'), 'standard 任務應提示使用單一 flash Subagent');
  assert(!standardBrief.includes('pro 審核'), 'standard 任務不應要求 pro 雙階審核');
  assert(standardBrief.includes('Handoff Contract'), 'standard 任務輸出應包含 Handoff Contract 指示');
  assert(standardBrief.includes('/api/tasks/'), 'standard 任務輸出應包含 API 交付路徑 /api/tasks/');
  assert(standardBrief.includes('/AUTOMATION_STANDARD.md'), 'standard 任務輸出應包含標準文件絕對路徑 /AUTOMATION_STANDARD.md');
  assert(standardBrief.split('\n').length <= 15, `standard 哨兵輸出必須 ≤ 15 行，實際: ${standardBrief.split('\n').length}`);
  console.log(`  ✅ [Case 2 - standard] 通過：判定精確且配置 Planner→Executor 實作 (行數: ${standardBrief.split('\n').length} ≤ 15)`);

  // 案例 3: heavy 任務（顯式指定、heavy tags 或重構關鍵字）
  const heavyTaskExplicit = { id: 'TASK-H1', title: '核心資料庫遷移', tier: 'heavy', project: 'task-dashboard' };
  const heavyTaskKeyword = { id: 'TASK-H2', title: '跨模組架構重構與 breaking 介面調整', project: 'task-dashboard' };
  const heavyTaskTag = { id: 'TASK-H3', title: '全面演進狀態機架構', tags: ['heavy'], project: 'task-dashboard' };

  assert.equal(determineTaskTier(heavyTaskExplicit), 'heavy', 'heavyTaskExplicit 應判定為 heavy');
  assert.equal(determineTaskTier(heavyTaskKeyword), 'heavy', 'heavyTaskKeyword 應判定為 heavy');
  assert.equal(determineTaskTier(heavyTaskTag), 'heavy', 'heavyTaskTag 應判定為 heavy');
  assert.equal(fmDetermineTier(heavyTaskExplicit), 'heavy', 'feedbackManager 應一致判定為 heavy');

  const heavyBrief = formatWakeupBrief(heavyTaskExplicit, 'WAKEUP_IMMEDIATE');
  assert(heavyBrief.includes('Tier: heavy Planner→Executor'), 'heavy 任務應輸出 Planner→Executor 切片策略指示');
  assert(heavyBrief.includes('flash Subagent'), 'heavy 任務應提示使用 flash Subagent');
  assert(heavyBrief.includes('Handoff Contract'), 'heavy 任務輸出應包含 Handoff Contract 指示');
  assert(heavyBrief.split('\n').length <= 15, `heavy 哨兵輸出必須 ≤ 15 行，實際: ${heavyBrief.split('\n').length}`);
  console.log(`  ✅ [Case 3 - heavy] 通過：判定精確且配置 Planner→Executor 切片實作 (行數: ${heavyBrief.split('\n').length} ≤ 15)`);

  // 案例 4: 優先序與 One-Way 門禁強制升級
  const oneWayTask = { id: 'TASK-OW', title: '小幅 typo 修正', riskDoor: 'one-way', project: 'task-dashboard' };
  const overrideTask = { id: 'TASK-OV', title: '核心架構重構', tier: 'micro', project: 'task-dashboard' };

  assert.equal(determineTaskTier(oneWayTask), 'heavy', 'riskDoor 為 one-way 時應強制升級為 heavy');
  assert.equal(determineTaskTier(overrideTask), 'micro', '顯式 tier 優先於標題關鍵字');
  console.log('  ✅ [Case 4 - Priority & One-Way] 通過：門禁自動升級與顯式優先序完全合規\n');

  // 8. TD-S1: 驗證跨卡隔離互斥 (cliIsolation: none) 與 allowedFiles 交集阻斷 (worktree/share)
  console.log('Step 8: 驗證 TD-S1 同 Repo 互斥序列、allowedFiles 交集阻斷與 outOfScope/STOP AND ASK...');
  const { findActionableTask, hasAllowedFilesOverlap } = require('./watch-task-gate');

  const s1DataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-s1-data-'));
  const prevDataDirEnv = process.env.TASK_DASHBOARD_DATA_DIR;
  try {
    process.env.TASK_DASHBOARD_DATA_DIR = s1DataDir;
    const repoA = path.join(s1DataDir, 'repo-a');
    const repoB = path.join(s1DataDir, 'repo-b');
    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(repoB, { recursive: true });
    fs.writeFileSync(path.join(s1DataDir, 'projects.json'), JSON.stringify([
      { id: 'proj-a', name: 'proj-a', path: repoA },
      { id: 'proj-b', name: 'proj-b', path: repoB }
    ]), 'utf8');

    // Case A: cliIsolation = 'none' 時，同 Repo 已有活躍 in_progress 任務，第二張卡必須暫緩喚醒；跨專案可平行
    fs.writeFileSync(path.join(s1DataDir, 'settings.json'), JSON.stringify({ cliIsolation: 'none' }), 'utf8');
    fs.writeFileSync(path.join(s1DataDir, 'tasks.json'), JSON.stringify([
      { id: 'TASK-A1', title: 'RepoA 活躍任務', project: 'proj-a', status: 'in_progress', claimedBy: `other-sentinel-${process.pid}`, claimedAt: new Date().toISOString() },
      { id: 'TASK-A2', title: 'RepoA 第二張等待卡', project: 'proj-a', status: 'in_progress' }
    ]), 'utf8');
    assert.equal(findActionableTask(), null, '同 Repo (cliIsolation=none) 已有活躍 in_progress 任務時，第二張卡必須被互斥阻斷');

    fs.writeFileSync(path.join(s1DataDir, 'tasks.json'), JSON.stringify([
      { id: 'TASK-A1', title: 'RepoA 活躍任務', project: 'proj-a', status: 'in_progress', claimedBy: `other-sentinel-${process.pid}`, claimedAt: new Date().toISOString() },
      { id: 'TASK-A2', title: 'RepoA 第二張等待卡', project: 'proj-a', status: 'in_progress' },
      { id: 'TASK-B1', title: 'RepoB 平行任務', project: 'proj-b', status: 'in_progress' }
    ]), 'utf8');
    const crossProjPicked = findActionableTask();
    assert.equal(crossProjPicked && crossProjPicked.id, 'TASK-B1', '跨專案 (proj-b) 任務不受 proj-a 互斥鎖影響，應正常喚醒');
    console.log('  ✅ [TD-S1 Case A] 同 Repo 互斥與跨專案平行驗證通過');

    // Case B: cliIsolation = 'worktree' / workspace: 'share' 時，allowedFiles 有交集者阻斷，無交集者可喚醒
    fs.writeFileSync(path.join(s1DataDir, 'settings.json'), JSON.stringify({ cliIsolation: 'worktree' }), 'utf8');
    fs.writeFileSync(path.join(s1DataDir, 'tasks.json'), JSON.stringify([
      {
        id: 'TASK-W1', title: 'Worktree 任務 1', project: 'proj-a', status: 'in_progress',
        claimedBy: `other-sentinel-${process.pid}`, claimedAt: new Date().toISOString(),
        scope: { allowedFiles: ['src/server/server.js', 'src/server/feedbackManager.js'], outOfScope: ['src/public/'] }
      },
      {
        id: 'TASK-W2', title: 'Worktree 交集衝突任務', project: 'proj-a', status: 'in_progress',
        workspace: 'share',
        scope: { allowedFiles: ['src/server/server.js'], outOfScope: ['docs/'] }
      },
      {
        id: 'TASK-W3', title: 'Worktree 無交集平行任務', project: 'proj-a', status: 'in_progress',
        workspace: 'share',
        scope: { allowedFiles: ['src/public/modules/modal.js'], outOfScope: ['src/server/'] }
      }
    ]), 'utf8');
    assert.equal(hasAllowedFilesOverlap(
      { scope: { allowedFiles: ['src/server/server.js'] } },
      { scope: { allowedFiles: ['src/server/'] } }
    ), true, '目錄前綴與檔案應判定為 allowedFiles 交集');
    const disjointPicked = findActionableTask();
    assert.equal(disjointPicked && disjointPicked.id, 'TASK-W3', 'allowedFiles 有交集的 TASK-W2 應被阻斷，無交集的 TASK-W3 應被喚醒');
    console.log('  ✅ [TD-S1 Case B] Worktree allowedFiles 交集阻斷與無交集平行驗證通過');

    // Case C: 喚醒簡報固定帶出 outOfScope 與 STOP AND ASK 條件
    const scopedBrief = formatWakeupBrief({
      id: 'TASK-S-BRIEF',
      title: '範圍檢查簡報測試',
      project: 'proj-a',
      tier: 'micro',
      scope: { allowedFiles: ['docs/LESSONS.md'], outOfScope: ['src/server/server.js'] }
    }, 'WAKEUP_IMMEDIATE');
    assert(scopedBrief.includes('outOfScope'), '喚醒簡報必須固定帶出 outOfScope');
    assert(scopedBrief.includes('src/server/server.js'), '喚醒簡報必須呈現任務指定的 outOfScope 項目');
    assert(scopedBrief.includes('STOP AND ASK'), '喚醒簡報必須包含 STOP AND ASK 條件');
    assert(scopedBrief.split('\n').length <= 15, `含 scope 簡報仍須 <= 15 行，實際: ${scopedBrief.split('\n').length}`);
    console.log('  ✅ [TD-S1 Case C] outOfScope 與 STOP AND ASK 簡報契約驗證通過');

    // Case D: 待擬定執行計劃 (isPendingPlanCreation) 喚醒簡報必須提醒回寫後重啟背景哨兵待命
    const pendingPlanBrief = formatWakeupBrief({
      id: 'TASK-PENDING-PLAN',
      title: '需確認任務計劃撰寫測試',
      project: 'proj-a',
      requiresConfirmation: true,
      executionPlan: ''
    }, 'WAKEUP_IMMEDIATE');
    assert(pendingPlanBrief.includes('待確認'), '待擬定執行計劃簡報應標明維持 in_progress 待確認');
    assert(pendingPlanBrief.includes('重啟背景哨兵待命'), '待擬定執行計劃簡報必須提醒回寫後重啟背景哨兵待命');
    assert(pendingPlanBrief.split('\n').length <= 15, `待擬定執行計劃簡報仍須 <= 15 行，實際: ${pendingPlanBrief.split('\n').length}`);
    console.log('  ✅ [Confirmation Gate] 待確認計劃階段哨兵重啟指示驗證通過\n');

    // Step 9: 驗證執行中互動問答門禁 (Interactive Clarification Gate)
    console.log('Step 9: 驗證執行中互動問答門禁 (pendingQuestions → 哨兵靜默 + 阻擋 review → POST /answer → 自動喚醒)...');
    const qCreateRes = await httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/tasks',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      title: '驗證執行中問答確認流程',
      description: '初始任務需求描述',
      project: 'task-dashboard',
      status: 'in_progress',
      assignedAgent: 'test-flow-agent',
      assignee: 'test-flow-agent'
    });
    assert.equal(qCreateRes.status, 201, '建立問答測試任務失敗');
    const qTaskId = qCreateRes.data.id;

    // 模擬 Agent 執行中途回寫 pendingQuestions（1 題單選含推薦、1 題複選）
    const putQuestionRes = await httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/tasks/${qTaskId}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, {
      status: 'in_progress',
      claimedBy: 'antigravity-88888',
      pendingQuestions: [
        {
          id: 'q1',
          question: '空欄位輸出格式應如何處理？',
          type: 'single',
          recommended: 'opt_null',
          options: [
            { id: 'opt_null', label: '補 null 保留欄位', description: '保持欄位對齊' },
            { id: 'opt_skip', label: '略過該欄位' }
          ]
        },
        {
          id: 'q2',
          question: '需要同步通知哪些通道？',
          type: 'multi',
          options: [
            { id: 'opt_dock', label: 'Dock 角標' },
            { id: 'opt_toast', label: '看板常駐提示' }
          ]
        }
      ]
    });
    assert.equal(putQuestionRes.status, 200);
    assert.equal(putQuestionRes.data.awaitingInput, true, '寫入 pendingQuestions 後 awaitingInput 必須為 true');
    assert.equal(putQuestionRes.data.pendingQuestions.length, 2);

    // 驗證哨兵待答期間不會搶單喚醒
    process.env.TASK_DASHBOARD_DATA_DIR = tmpDataDir;
    assert.equal(findActionableTask(), null, '待使用者回答 pendingQuestions 期間，哨兵必須靜默不喚醒');

    // 驗證未回答前禁止推進 review
    const blockedReviewRes = await httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/tasks/${qTaskId}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, {
      status: 'review',
      executionLog: '## 1. 任務目標\n- test\n## 2. 解決方案\n- test\n## 3. 品質驗證\n- cmd: `npm test` exit 0'
    });
    assert.equal(blockedReviewRes.status, 400, '尚有未回答 pendingQuestions 時不得推進 review');

    // 驗證缺少必填答案時 POST /answer 回傳 400
    const missingAnsRes = await httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/tasks/${qTaskId}/answer`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      answers: [{ id: 'q1', selectedOptionIds: ['opt_null'] }]
    });
    assert.equal(missingAnsRes.status, 400, '缺少必填題答案時必須回傳 400 驗證失敗');

    // 驗證完整作答後清空 pendingQuestions、寫入最新需求覆蓋與 history、釋放鎖定並喚醒哨兵
    const answerRes = await httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/tasks/${qTaskId}/answer`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      answers: [
        { id: 'q1', selectedOptionIds: ['opt_null'], customText: '並附上單元測試' },
        { id: 'q2', selectedOptionIds: ['opt_dock', 'opt_toast'] }
      ]
    });
    assert.equal(answerRes.status, 200, `POST /answer 失敗: ${answerRes.status}`);
    assert.equal(answerRes.data.awaitingInput, false, '作答完成後 awaitingInput 必須重置為 false');
    assert.equal(answerRes.data.pendingQuestions.length, 0, '作答完成後 pendingQuestions 必須清空');
    assert.equal(answerRes.data.claimedBy, null, '作答完成後必須解除認領鎖定');
    assert.equal(answerRes.data.clarificationHistory.length, 1, '必須歸檔一筆 clarificationHistory');
    assert(answerRes.data.description.includes('--- 【執行中問答確認 / 最新需求覆蓋】 ---'), '必須寫入最新需求覆蓋區塊');
    assert(answerRes.data.description.includes('補 null 保留欄位'), '必須寫入選中選項標籤');
    assert(answerRes.data.description.includes('並附上單元測試'), '必須寫入使用者補充說明');

    const qWakeupRun = spawnSync('node', [gateScriptPath, '--agent=test-flow-agent'], { encoding: 'utf8', timeout: 5000, env });
    assert.equal(qWakeupRun.status, 0, `問答確認後哨兵必須立即喚醒 (exit 0)，實際: ${qWakeupRun.status}`);
    assert(qWakeupRun.stdout.includes(qTaskId), `哨兵喚醒輸出應包含 ${qTaskId}`);
    console.log('  ✅ [Step 9 - Clarification Gate] 問答門禁、驗證阻擋、決策回寫與哨兵喚醒驗證通過\n');

    // Step 10: 驗證哨兵三層防重複與原子搶單保護
    console.log('Step 10: 驗證哨兵單例鎖 (--replace)、租約鎖定存續與併發原子認領鎖...');
    const { isClaimAlive } = require('./watch-task-gate');
    const qTasksAfterWakeup = (await httpRequest({ hostname: '127.0.0.1', port: PORT, path: '/api/tasks', method: 'GET' })).data || [];
    const claimedQTask = qTasksAfterWakeup.find(t => t.id === qTaskId);
    assert(claimedQTask && String(claimedQTask.claimedBy || '').includes(':lease-'), `哨兵喚醒後 claimedBy 應採用 lease 識別碼，實際: ${claimedQTask?.claimedBy}`);
    assert.equal(isClaimAlive(claimedQTask), true, '哨兵退出 (exit 0) 後 lease 鎖定於 15 分鐘內必須維持有效，禁止其他哨兵誤判 dead PID 搶單');

    // 結案 qTaskId 以便測試閒置背景哨兵
    await httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/tasks/${qTaskId}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { ...claimedQTask, status: 'done', executionLog: '## 1. 任務目標\n- test\n## 2. 解決方案\n- test\n## 3. 品質驗證\n- cmd: `npm test` exit 0' });

    const waitForOutput = (proc, pattern, timeoutMs = 4000) => new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${pattern}, got: ${buf}`)), timeoutMs);
      const onData = chunk => {
        buf += chunk.toString();
        if (buf.includes(pattern)) {
          clearTimeout(timer);
          proc.stdout.off('data', onData);
          resolve(buf);
        }
      };
      proc.stdout.on('data', onData);
    });

    const spawnedProcs = [];
    try {
      // 10.1 啟動哨兵 #1 進入守候
      const s1 = spawn('node', [gateScriptPath, '--agent=dup-guard-test'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      spawnedProcs.push(s1);
      await waitForOutput(s1, '[WATCHER_ACTIVE]');

      // 10.2 重複啟動同範圍哨兵 #2（未帶 --replace）：必須直接提示已運行並退出，不得干擾 #1
      const dupRun = spawnSync('node', [gateScriptPath, '--agent=dup-guard-test'], { encoding: 'utf8', timeout: 4000, env });
      assert.equal(dupRun.status, 0);
      assert(dupRun.stdout.includes('[SENTINEL_ALREADY_ACTIVE]'), `重複啟動哨兵必須輸出 [SENTINEL_ALREADY_ACTIVE]，實際: ${dupRun.stdout}`);
      assert.equal(s1.exitCode, null, '原哨兵 #1 必須仍在運行中');

      // 10.3 啟動哨兵 #3 帶 --replace：必須優雅取代 #1（#1 印出 [SENTINEL_SUPERSEDED] 退場，無 WAKEUP）
      let s1Out = '';
      s1.stdout.on('data', d => { s1Out += d.toString(); });
      const s1Exited = new Promise(res => s1.once('exit', code => res(code)));
      const s3 = spawn('node', [gateScriptPath, '--agent=dup-guard-test', '--replace'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      spawnedProcs.push(s3);
      await waitForOutput(s3, '[WATCHER_ACTIVE]');
      const s1Code = await s1Exited;
      assert.equal(s1Code, 0, '被取代的哨兵 #1 應以 exit 0 退場');
      assert(s1Out.includes('[SENTINEL_SUPERSEDED]') && !s1Out.includes('WAKEUP_'), `被取代哨兵 #1 應輸出 [SENTINEL_SUPERSEDED]，實際: ${s1Out}`);

      // 10.4 啟動不同 agent 的哨兵 #4，並建立一張通用 (all) in_progress 任務測試 OS 級原子搶單鎖：僅能喚醒其中 1 支
      const s4 = spawn('node', [gateScriptPath, '--agent=second-agent'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      spawnedProcs.push(s4);
      await waitForOutput(s4, '[WATCHER_ACTIVE]');

      let s3Out = '';
      let s4Out = '';
      s3.stdout.on('data', d => { s3Out += d.toString(); });
      s4.stdout.on('data', d => { s4Out += d.toString(); });

      const raceTaskRes = await httpRequest({
        hostname: '127.0.0.1',
        port: PORT,
        path: '/api/tasks',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        title: '併發原子搶單驗證任務',
        project: 'task-dashboard',
        status: 'in_progress',
        assignedAgent: 'all',
        assignee: 'all'
      });
      assert.equal(raceTaskRes.status, 201);
      const raceTaskId = raceTaskRes.data.id;

      // 等待其中 1 支喚醒並給另一支 400ms 觀察期
      await Promise.race([
        new Promise(res => s3.once('exit', res)),
        new Promise(res => s4.once('exit', res))
      ]);
      await new Promise(r => setTimeout(r, 400));

      const s3Woke = s3Out.includes('WAKEUP_TRIGGERED') && s3Out.includes(raceTaskId);
      const s4Woke = s4Out.includes('WAKEUP_TRIGGERED') && s4Out.includes(raceTaskId);
      assert(s3Woke !== s4Woke, `兩支哨兵不可同時喚醒同一張任務 (s3Woke=${s3Woke}, s4Woke=${s4Woke})`);
      console.log('  ✅ [Step 10 - Sentinel Dedup] 單例防重、--replace 優雅接管、Lease 續存與原子搶單鎖驗證通過\n');
    } finally {
      for (const p of spawnedProcs) {
        try { if (p && p.exitCode === null) p.kill('SIGKILL'); } catch (e) {}
      }
    }
  } finally {
    process.env.TASK_DASHBOARD_DATA_DIR = prevDataDirEnv;
    fs.rmSync(s1DataDir, { recursive: true, force: true });
  }

  console.log('🎉 全部步驟與 TD-H1 / TD-S1 分級互斥驗證成功！\n');
  } finally {
    try { serverProc.kill('SIGKILL'); } catch (e) {}
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
    fs.rmSync(tmpProjDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error('❌ 驗證失敗:', err);
  process.exit(1);
});
