const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../src/public/index.html'), 'utf8');
const functions = [...html.matchAll(/^    (?:async )?function (\w+)\(/gm)];
function source(name) {
  const index = functions.findIndex(match => match[1] === name);
  assert(index !== -1, `Missing actual function ${name}`);
  return html.slice(functions[index].index, functions[index + 1].index);
}

function element(value = '') {
  const classes = new Set();
  return {
    value, disabled: false, checked: false, innerHTML: 'Confirm', style: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    }
  };
}

function fixture() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  get('formTaskId').value = 'UX-001';
  get('formExecutionPlan').value = '  user edited plan  ';
  get('formDescription').value = 'preserve description';
  get('formRequiresConfirmation').checked = true;
  const task = {
    id: 'UX-001', title: 'UX fixture', project: 'fixture', priority: 'P1',
    assignee: 'Copilot', assignedAgent: 'Copilot',
    status: 'in_progress', requiresConfirmation: true, executionPlan: 'old plan',
    executionLog: 'previous evidence\n', modifiedFiles: [], tags: [], dependencies: []
  };
  const calls = [];
  const errors = [];
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: get },
    window: {},
    tasks: [task],
    currentModalEditingTask: task,
    console: { error: (...args) => errors.push(args) },
    showToast: message => calls.push(['toast', message]),
    renderKanban: () => calls.push(['kanban']),
    renderMetrics: () => calls.push(['metrics']),
    loadData: async () => calls.push(['load']),
    fetch: async (url, options) => {
      requests.push([url, JSON.parse(options.body)]);
      return { ok: true, json: async () => ({ ...task, ...JSON.parse(options.body) }) };
    }
  });
  vm.runInContext(source('resetTextareaHeight') + source('closeModal') +
    source('withButtonLoading') + source('confirmAndExecuteTask'), context);
  return { context, get, task, calls, errors, requests };
}

async function main() {
  {
    const f = fixture();
    await f.context.confirmAndExecuteTask();
    assert(f.get('taskModal').classList.contains('hidden'), 'Successful confirmation must close modal');
    assert.equal(f.context.currentModalEditingTask, null);
    assert.equal(f.context.tasks[0].requiresConfirmation, false);
    assert.equal(f.context.tasks[0].status, 'in_progress');
    assert.deepEqual(f.calls.map(call => call[0]), ['kanban', 'metrics', 'toast', 'load']);
    const request = f.requests[0][1];
    assert.equal(request.assignedAgent, 'Copilot');
    assert.equal(request.executionPlan, 'user edited plan');
    assert.equal(request.confirmExecution, true);
    assert(request.executionLog.startsWith('previous evidence\n'));
    assert(request.executionLog.includes('✅ [Confirmation Gate]'));
    assert.equal(f.errors.length, 0, 'No ReferenceError after successful API response');
    assert.equal(f.get('btnConfirmAndExecute').disabled, false);
    assert.equal(f.get('btnSubmitTask').disabled, false);
    console.log('PASS confirmation: successful API result closes modal and updates kanban/metrics');
  }
  for (const [label, response] of [
    ['http failure', { ok: false, status: 409, json: async () => ({ error: 'confirmation conflict' }) }],
    ['malformed JSON', { ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }],
    ['null result', { ok: true, json: async () => null }],
    ['wrong task', { ok: true, json: async () => ({ id: 'OTHER', status: 'in_progress', requiresConfirmation: false }) }],
    ['unconfirmed result', { ok: true, json: async () => ({ id: 'UX-001', status: 'in_progress', requiresConfirmation: true }) }],
    ['wrong status', { ok: true, json: async () => ({ id: 'UX-001', status: 'todo', requiresConfirmation: false }) }],
    ['network failure', null]
  ]) {
    const f = fixture();
    f.context.fetch = async () => {
      if (!response) throw new Error('network unavailable');
      return response;
    };
    await f.context.confirmAndExecuteTask();
    assert(!f.get('taskModal').classList.contains('hidden'), `${label}: modal stays open`);
    assert.equal(f.context.tasks[0].requiresConfirmation, true);
    assert.equal(f.get('formExecutionPlan').value, '  user edited plan  ');
    assert.equal(f.get('formDescription').value, 'preserve description');
    assert.deepEqual(f.calls.map(call => call[0]), ['toast']);
    assert(f.calls[0][1].startsWith('確認執行失敗:'), `${label}: explicit error, not success-shaped fallback`);
    assert.equal(f.errors.length, 1);
    assert.equal(f.get('btnConfirmAndExecute').disabled, false);
    assert.equal(f.get('btnSubmitTask').disabled, false);
    console.log(`PASS confirmation: ${label} preserves modal/input and surfaces error`);
  }
  {
    const f = fixture();
    let resolve;
    let count = 0;
    f.context.fetch = () => {
      count++;
      return new Promise(done => { resolve = done; });
    };
    const pending = f.context.confirmAndExecuteTask();
    assert.equal(f.get('btnConfirmAndExecute').disabled, true);
    assert.equal(f.get('btnSubmitTask').disabled, true);
    await f.context.confirmAndExecuteTask();
    assert.equal(count, 1, 'Duplicate invocation must not issue another request');
    assert.equal(f.get('btnSubmitTask').disabled, true, 'Duplicate invocation must not unlock pending form');
    resolve({ ok: true, json: async () => ({ ...f.task, requiresConfirmation: false }) });
    await pending;
    assert.equal(f.get('btnSubmitTask').disabled, false);
    console.log('PASS confirmation: pending state prevents duplicate requests and keeps form locked');
  }
  {
    const f = fixture();
    f.get('formExecutionPlan').value = '';
    await f.context.confirmAndExecuteTask();
    assert.equal(f.requests[0][1].executionPlan, 'old plan', 'Existing plan preserved when editor is empty');
    f.get('formTaskId').value = '';
    await f.context.confirmAndExecuteTask();
    assert.equal(f.requests.length, 1, 'No request without task selection');
  }
  {
    const elements = new Map();
    const get = id => {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    };
    get('priorityFilter').value = 'ALL';
    const context = vm.createContext({
      document: { getElementById: get }, window: {}, currentProject: 'ALL',
      projects: [{ id: 'fixture', name: 'Fixture' }], tasks: [],
      normalizeStatus: value => value,
      escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    });
    vm.runInContext(source('renderKanban'), context);
    for (const [agent, assigned] of [
      ['Antigravity', 'Antigravity'], ['Claude', 'Claude'], ['Codex', 'Codex'],
      ['Copilot', 'Copilot'], ['CLI', 'Copilot'], ['<script>bad</script>', 'Copilot']
    ]) {
      context.tasks = [{
        id: 'CARD', title: 'Card fixture', project: 'fixture', status: 'todo',
        assignee: agent, assignedAgent: assigned, priority: 'P1', tags: [], dependencies: []
      }];
      context.renderKanban();
      const card = get('col-todo').innerHTML;
      assert(!card.includes('指定執行 Agent:'), 'No top Agent tag');
      const displayed = agent.startsWith('<') ? '&lt;script>bad&lt;/script>' : agent;
      assert.equal(card.split(displayed).length - 1, 1, `${agent}: one footer label`);
      assert(card.indexOf(displayed) > card.indexOf('border-t'), 'Agent label remains in footer');
      assert(!card.includes('<script>bad'), 'Agent text remains escaped');
      assert.equal(context.tasks[0].assignedAgent, assigned, 'Recognition metadata preserved');
    }
    console.log('PASS cards: single footer Agent label for all agents/CLI; metadata and escaping preserved');
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
