const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const {
  formatStructuredExecutionLog,
  validateExecutionLog,
  calculateRiskDoor,
  autoAssembleExecutionReport
} = require('../src/server/feedbackManager');

const root = path.resolve(__dirname, '..');
const longOutput = 'BEGIN-DETAIL\n' + '執行細節 <script>alert("test")</script>\t✓\n'.repeat(5000) + 'END-DETAIL\n';
const stderrOutput = 'STDERR-DETAIL\nsecond error line\n';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function runFixture() {
  const fs = require('node:fs');
  const mode = process.argv[2];
  const prompt = process.argv[3];
  if (!prompt.includes('工作目錄、退出碼與實際 stdout/stderr')) {
    process.stderr.write('Missing execution evidence instructions\n');
    process.exitCode = 7;
    return;
  }
  if (mode === 'empty' || mode === 'log-write-error') return;
  if (mode === 'changes') fs.writeFileSync('result.txt', 'fixture change\n');
  const output = 'BEGIN-DETAIL\n' + '執行細節 <script>alert("test")</script>\t✓\n'.repeat(5000) + 'END-DETAIL\n';
  process.stdout.write((mode === 'early-error' ? 'HTTP 429\n' : '') + output, () => {
    process.stderr.write('STDERR-DETAIL\nsecond error line\n', () => {
      if (mode === 'failure') process.exitCode = 3;
    });
  });
}

async function main() {
  assert(Buffer.byteLength(longOutput) > 100 * 1024);
  const formatted = formatStructuredExecutionLog(longOutput + stderrOutput);
  assert(formatted.includes(longOutput + stderrOutput), 'Formatter must preserve every output character');
  assert(!formatted.includes('已檢閱架構規範文檔'), 'No fabricated pre-flight completion');
  assert(!formatted.includes('完成最小範圍'), 'No fabricated implementation completion');
  assert(formatted.includes('未提供驗證命令與結果'));
  assert.equal(formatStructuredExecutionLog(formatted), formatted, 'Formatting must be idempotent');
  assert(formatStructuredExecutionLog('\n  raw output \t\n\n').endsWith('\n  raw output \t\n\n'), 'Preserve leading/trailing whitespace');
  assert(formatStructuredExecutionLog('').includes('未提供前置檢閱細節'));
  assert(formatStructuredExecutionLog('raw', { phase1: 'read AGENTS.md', phase2: 'changed file', phase3: 'node test: exit 0' }).includes('node test: exit 0'));

  // Task 1.1: Slice Judge 二元驗收門禁單元斷言
  assert.equal(validateExecutionLog('').valid, false, 'Empty log must fail');
  assert.equal(validateExecutionLog('已完成修改').valid, false, 'Superficial single line log must fail');
  assert.equal(validateExecutionLog('修正完畢！').valid, false, 'Superficial short log must fail');
  assert.equal(validateExecutionLog('短字串未滿三十字元長度限制').valid, false, 'Sub-30 character log must fail');
  assert.equal(validateExecutionLog('這是一段超過三十個字的說明，但是裡面完全沒有任何測試結果與驗證指令證據').valid, false, 'Log without test evidence must fail');
  assert.equal(validateExecutionLog('這是一段超過三十個字的修復說明，已執行 npm test 通過，PASS 測試套件零回歸。').valid, true, 'Log with valid test evidence must pass');
  assert.equal(validateExecutionLog('### Phase 1: Pre-flight\n### Phase 2: Impl\n### Phase 3: Exit Code: 0').valid, true, 'Standard 3-phase log must pass');
  const html = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
  const modules = fs.readdirSync(path.join(root, 'src/public/modules')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(root, 'src/public/modules', f), 'utf8')).join('\n');
  const uiContent = html + '\n' + modules;
  assert(uiContent.includes('logVisual.innerText = task.executionLog;'), 'Output remains text, not HTML');
  assert(uiContent.includes('驗證命令、工作目錄、退出碼與完整可用 stdout/stderr'), 'Desktop feedback prompt requires evidence');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-dashboard-logs-'));
  const dataDir = path.join(temp, 'data');
  const project = path.join(temp, 'project');
  const gitProject = path.join(temp, 'git-project');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(project);
  fs.mkdirSync(gitProject);
  execFileSync('git', ['init', '-q', gitProject]);
  const stub = path.join(temp, 'fixture.js');
  fs.writeFileSync(stub, `(${runFixture.toString()})();\n`);
  fs.writeFileSync(path.join(dataDir, 'tasks.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'projects.json'), JSON.stringify([
    { id: 'logs', name: 'logs', path: project },
    { id: 'changes', name: 'changes', path: gitProject }
  ]));
  const settingsFile = path.join(dataDir, 'settings.json');
  const setMode = mode => fs.writeFileSync(settingsFile, JSON.stringify({
    enableCliAgent: true,
    cliCommand: `"${process.execPath}" "${stub}" ${mode}`,
    autoTriggerOnInProgress: true
  }));
  setMode('success');
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const server = spawn(process.execPath, [path.join(root, 'src/server/server.js')], {
    env: { ...process.env, HOME: temp, PORT: String(port), TASK_DASHBOARD_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let diagnostics = '';
  server.stdout.on('data', chunk => { diagnostics += chunk; });
  server.stderr.on('data', chunk => { diagnostics += chunk; });
  const serverClosed = once(server, 'close');
  const base = `http://127.0.0.1:${port}`;
  async function request(route, method = 'GET', body) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    assert(response.ok, `${method} ${route}: ${response.status} ${await response.clone().text()}`);
    return response;
  }
  async function waitFor(check, label) {
    for (let i = 0; i < 300; i++) {
      if (server.exitCode !== null) throw new Error(`Server exited: ${diagnostics}`);
      if (await check()) return;
      await sleep(100);
    }
    throw new Error(`Timed out: ${label}\n${diagnostics}`);
  }
  try {
    await waitFor(async () => {
      // A refused connection is expected only while this isolated server starts.
      try {
        return (await fetch(base + '/api/settings')).ok;
      } catch (err) {
        if (err.cause?.code !== 'ECONNREFUSED') throw err;
        return false;
      }
    }, 'server startup');
    for (const mode of ['success', 'changes', 'plan', 'failure', 'early-error', 'empty', 'log-write-error']) {
      setMode(mode);
      const created = await (await request('/api/tasks', 'POST', {
        title: `log regression ${mode}`,
        project: mode === 'changes' ? 'changes' : 'logs',
        status: 'todo',
        executionLog: 'HISTORY-ONLY-ONCE\n',
        requiresConfirmation: mode === 'plan'
      })).json();
      const diskLog = path.join(dataDir, 'logs', `${created.id}.log`);
      fs.mkdirSync(path.dirname(diskLog), { recursive: true });
      if (mode === 'log-write-error') fs.mkdirSync(diskLog);
      else fs.writeFileSync(diskLog, 'PREVIOUS-DISK-RUN\n');
      await request(`/api/tasks/${created.id}`, 'PATCH', {
        status: 'in_progress',
        ...(mode === 'early-error' || mode === 'log-write-error' ? { _retryCount: 2 } : {})
      });
      const readTask = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8')).find(t => t.id === created.id);
      await waitFor(() => {
        const task = readTask();
        if (mode === 'plan') return task.executionPlan?.includes('END-DETAIL');
        return task.status === (['failure', 'early-error', 'log-write-error'].includes(mode) ? 'todo' : 'review');
      }, mode);
      const task = readTask();
      assert.equal(task.executionLog.split('HISTORY-ONLY-ONCE').length - 1, 1);
      assert(!task.executionLog.includes('PREVIOUS-DISK-RUN'), 'Old disk runs must not be re-appended');
      if (mode === 'log-write-error') {
        assert(task.executionLog.includes('[CLI Log Error]'));
        assert(task.executionLog.includes('完整日誌保存失敗'));
        assert(!task.executionLog.includes('本輪未產生 stdout/stderr'), 'Unavailable output is not empty output');
      } else if (mode === 'empty') {
        assert(task.executionLog.includes('本輪未產生 stdout/stderr'));
      } else {
        const runs = mode === 'failure' ? 3 : 1;
        assert.equal(task.executionLog.split(longOutput).length - 1, runs, `${mode}: entire stdout on every run`);
        assert.equal(task.executionLog.split(stderrOutput).length - 1, runs, `${mode}: entire stderr on every run`);
        const physicalLog = await (await request(`/api/tasks/${created.id}/log`)).text();
        assert(physicalLog.includes(longOutput), 'Physical log matches full saved output');
      }
      if (mode === 'plan') {
        assert.equal(task.status, 'in_progress');
        assert.equal(task.requiresConfirmation, true);
        assert(task.executionPlan.includes(longOutput.trim()), 'Plan output must not use a tail');
        assert(task.executionLog.includes('Exit code: 0'));
      } else if (mode === 'failure') {
        assert(task.executionLog.includes('Exit code: 3'));
        assert(task.executionLog.includes('重試 (2/2)'));
      } else if (mode === 'early-error') {
        assert(task.executionLog.includes('HTTP 429'), 'Early errors remain visible beyond live buffer cap');
      } else {
        assert(task.executionLog.includes('Exit code: 0'));
        assert(!task.executionLog.includes('代碼檢核/測試無誤'), 'Exit 0 alone does not prove checks passed');
      }
      if (mode === 'changes') assert(task.modifiedFiles.includes('result.txt'));
      const apiTasks = await (await request('/api/tasks')).json();
      assert.equal(apiTasks.find(t => t.id === created.id).executionLog, task.executionLog, 'API preserves saved log');
      console.log(`PASS execution logs: ${mode}`);
    }

    // Task 1.1 & 1.3: 測試 PUT /api/tasks/:id 之二元審查門禁與 task-events.jsonl
    const gateTaskRes = await request('/api/tasks', 'POST', {
      title: '二元審查門禁測試任務',
      project: 'logs',
      status: 'in_progress'
    });
    const gateTask = await gateTaskRes.json();

    // 1. 嘗試以敷衍日誌推進至 review (非手動強制) -> 預期被 400 攔截
    const superficialRes = await fetch(base + `/api/tasks/${gateTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'review', executionLog: '已完成修改' })
    });
    assert.equal(superficialRes.status, 400, 'Superficial review transition must be rejected with 400');
    const rejData = await superficialRes.json();
    assert(rejData.error.includes('Review gate failed'), 'Error message must specify Review gate failed');

    // 2. 傳入合規日誌推進至 review -> 預期 200 通過
    const validRes = await fetch(base + `/api/tasks/${gateTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'review',
        executionLog: '### Phase 1: Pre-Flight 分析目標\n### Phase 2: Impl 修正\n### Phase 3: 驗證指令 npm test 通過，Exit Code: 0'
      })
    });
    assert.equal(validRes.status, 200, 'Valid review transition must succeed');

    // 3. 檢驗 task-events.jsonl Append-only 是否正確紀錄
    const eventsFile = path.join(dataDir, 'task-events.jsonl');
    assert(fs.existsSync(eventsFile), 'task-events.jsonl must exist');
    const eventsContent = fs.readFileSync(eventsFile, 'utf8');
    assert(eventsContent.includes(gateTask.id), 'Events log must record events for gateTask');
    assert(eventsContent.includes('status_transition'), 'Events log must record status transitions');
    console.log('PASS Slice 1: Backend Slice Judge Gate & Append-only Event Log');

    // Task 2.1: calculateRiskDoor 判定測試
    const criticalRisk = calculateRiskDoor(['src/server/server.js'], '+ line\n- line');
    assert.equal(criticalRisk.riskDoor, 'one-way', 'Modifying server.js must trigger one-way door');
    assert(criticalRisk.riskReasons.some(r => r.includes('server.js')));

    const deleteRisk = calculateRiskDoor(['D oldFile.js'], 'deleted file mode 100644');
    assert.equal(deleteRisk.riskDoor, 'one-way', 'File deletion must trigger one-way door');

    const largeDiff = '+ test\n'.repeat(350);
    const largeDiffRisk = calculateRiskDoor(['src/public/app.js'], largeDiff);
    assert.equal(largeDiffRisk.riskDoor, 'one-way', 'Diff > 300 lines must trigger one-way door');

    const safeRisk = calculateRiskDoor(['src/public/style.css'], '+ .btn { color: red; }');
    assert.equal(safeRisk.riskDoor, 'two-way', 'Minor UI change must be two-way door');

    // Task 2.2: 確定性報告自動組裝 (Code over LLM)
    const assembled = autoAssembleExecutionReport(
      { title: '優化測試', modifiedFiles: ['src/test.js'] },
      {
        rootCause: '原先缺少單元測試覆蓋',
        resolution: '補充斷言並修復邊界條件',
        testCommand: 'node test.js',
        exitCode: 0,
        rawLog: 'PASS all test cases'
      }
    );
    assert(assembled.includes('## 1. 任務目標與根因分析'));
    assert(assembled.includes('原先缺少單元測試覆蓋'));
    assert(assembled.includes('## 2. 解決方案與核心異動'));
    assert(assembled.includes('## 4. 品質驗證與交付證明'));
    assert(assembled.includes('PASS all test cases'));

    // API 呼叫：透過簡短因果參數推進至 review，由後端自動組裝報告並通過門禁
    const autoTaskRes = await request('/api/tasks', 'POST', {
      title: '自動報告組裝測試任務',
      project: 'logs',
      status: 'in_progress',
      modifiedFiles: ['src/test.js']
    });
    const autoTask = await autoTaskRes.json();
    const autoReviewRes = await fetch(base + `/api/tasks/${autoTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'review',
        autoAssembleReport: true,
        rootCause: 'API 缺乏結構化報告組裝',
        resolution: '後端以確定性程式碼自動組裝報告骨架',
        testCommand: 'npm test',
        exitCode: 0
      })
    });
    assert.equal(autoReviewRes.status, 200, 'Auto-assembled review transition must succeed');
    const autoUpdated = await autoReviewRes.json();
    assert(autoUpdated.executionLog.includes('## 1. 任務目標與根因分析'));
    assert(autoUpdated.executionLog.includes('## 4. 品質驗證與交付證明'));
    console.log('PASS Slice 2: One-Way/Two-Way Door & Deterministic Report Assembly');
  } finally {
    server.kill('SIGTERM');
    await serverClosed;
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('PASS execution evidence formatting, complete CLI output, retries, confirmation and API persistence');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
