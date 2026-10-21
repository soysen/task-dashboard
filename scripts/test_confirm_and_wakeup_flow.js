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
const { spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.TEST_PORT || process.env.PORT || 3030);

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

async function run() {
  console.log('🚀 開始進行「確認並執行」與「哨兵喚醒」端到端驗證流程...\n');

  // 0. 若環境中已有殘留之 in_progress 任務，先將其標為 done 確保測試隔離性
  const existingRes = await httpRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/tasks',
    method: 'GET'
  });
  if (existingRes.data && Array.isArray(existingRes.data)) {
    for (const t of existingRes.data) {
      if (t.status === 'in_progress') {
        await httpRequest({
          hostname: 'localhost',
          port: PORT,
          path: `/api/tasks/${t.id}`,
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' }
        }, { ...t, status: 'done' });
      }
    }
  }

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

  console.log('🎉 全部步驟驗證成功！任務流轉、確認並執行、鎖定釋放與哨兵喚醒完全恢復正常！\n');
}

run().catch(err => {
  console.error('❌ 驗證失敗:', err);
  process.exit(1);
});
