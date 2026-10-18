'use strict';

// Run from any directory with:
// node <repository>/scripts/check-agent-workbench-refresh.cjs
// Reads only the two source files below; never imports project modules, opens a
// browser, reads runtime configuration, makes network requests, or writes files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, after } = require('node:test');

const root = path.resolve(__dirname, '..');
const frontendPath = path.join(root, 'lib/webConsole/public/agent-workbench.js');
const backendPath = path.join(root, 'lib/webConsole/agentWorkbenchConsole.js');
const frontend = fs.readFileSync(frontendPath, 'utf8');
const backend = fs.readFileSync(backendPath, 'utf8');

function extract(source, filename, start, end) {
  const startAt = source.indexOf(start);
  assert(startAt >= 0, `Missing source boundary: ${start}`);
  assert.equal(source.indexOf(start, startAt + start.length), -1, `Ambiguous boundary: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert(endAt > startAt, `Missing end boundary: ${end}`);
  return {
    filename,
    lineOffset: source.slice(0, startAt).split('\n').length - 1,
    code: source.slice(startAt, endAt).trimEnd(),
  };
}

const stateBlock = extract(frontend, frontendPath, 'const agentWorkbenchState = {', 'const agentContextCollapsedStorageKey');
const frontendFunctions = [
  ['function setStatus(', 'function setButtonBusy('],
  ['function setButtonBusy(', 'function setSlashCommandBusy('],
  ['function getSelectedTask(', 'function normalizeAgentOutput('],
  ['function renderConversation(', 'function renderNativeMessageActions('],
  ['function renderSelectedTask(', 'function renderTasks('],
  ['function renderPayload(', 'function getNativeWorkspaceId('],
  ['async function refreshAgentWorkbench(', 'function readSettingsDraft('],
].map(([start, end]) => extract(frontend, frontendPath, start, end));
const backendFunctions = [
  ['function getTaskElapsedMs(', 'function serializeAgentMessage('],
  ['function serializeAgentMessage(', '// OpenCode Todo'],
  ['function normalizeTodoItems(', '// 任务基线'],
  ['function serializeGitBaseline(', 'function serializeTask('],
  ['function serializeTask(', 'export function createAgentWorkbenchConsole('],
  ['  function listTasks(', '  function buildUsageStats('],
].map(([start, end]) => extract(backend, backendPath, start, end));

// These helpers are unrelated to refresh ordering. Their substitutes accept
// only synthetic data. Serialization, selection and rendering remain real.
const backendSupport = {
  clampInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
  },
  normalizeSingleLine: (value = '', limit = 160) => String(value).replace(/[\r\n]+/g, ' ').trim().slice(0, limit),
  normalizeOpenCodeMessageId: (value = '') => String(value),
  normalizeModelVariant: (value = '') => String(value),
  normalizeAgentPriority: (value = '') => value || 'normal',
  normalizeAgentDelivery: (value = '') => value || 'steer',
  redactAgentText: (value = '') => String(value),
};
const constants = {};
for (const name of ['AGENT_TASK_LIMIT', 'AGENT_MESSAGE_LIMIT', 'AGENT_MESSAGE_TOOL_LIMIT', 'AGENT_EVENT_LIMIT', 'AGENT_PERMISSION_LIMIT', 'AGENT_QUESTION_LIMIT', 'AGENT_ATTACHMENT_LIMIT', 'AGENT_FOLLOW_UP_LIMIT']) {
  const match = backend.match(new RegExp(`^const ${name} = (\\d+);`, 'm'));
  assert(match, `Missing numeric constant: ${name}`);
  constants[name] = Number(match[1]);
}

function fixtureTask(id, overrides = {}) {
  const createdAt = `2026-10-15T${String(20 - id.charCodeAt(0) + 65).padStart(2, '0')}:00:00Z`;
  return {
    id, title: `Task ${id} searchable-${id}`, prompt: `${id} QUESTION`,
    providerId: 'zcode', providerLabel: 'ZCode', zcodeSessionId: `session-${id}`,
    workspaceId: 'fixture', workspaceLabel: 'Synthetic workspace',
    agent: 'plan', mode: 'analyze', status: 'success',
    createdAt, updatedAt: createdAt, startedAt: createdAt, finishedAt: createdAt,
    outputText: `${id} ANSWER`, stderrText: `${id} STDERR`,
    diffText: `${id} DIFF`, events: [{ message: `${id} EVENT` }],
    messages: [
      { id: `${id}-user`, role: 'user', content: `${id} QUESTION`, createdAt },
      { id: `${id}-assistant`, role: 'assistant', content: `${id} ANSWER`, createdAt, status: 'success' },
    ],
    ...overrides,
  };
}

function element() {
  const classes = new Set();
  return {
    innerHTML: '', textContent: '', title: '', className: '', value: '',
    disabled: false, checked: false, options: [],
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, force) {
        const active = force === undefined ? !classes.has(name) : Boolean(force);
        if (active) classes.add(name);
        else classes.delete(name);
        return active;
      },
    },
  };
}

function runBlock(context, block, suffix = '') {
  new vm.Script(`${block.code}\n${suffix}`, {
    filename: block.filename, lineOffset: block.lineOffset,
  }).runInContext(context, { timeout: 1000 });
}

function harness({ search = '?task=A', taskItems = null, synchronousFetchError = null } = {}) {
  const tasks = new Map((taskItems || [
    fixtureTask('A'), fixtureTask('B'), fixtureTask('C'), fixtureTask('D', { archived: true }),
  ]).map(task => [task.id, task]));
  const elements = new Map();
  const requests = [];
  const rendered = [];
  const buttons = [];
  const statuses = [];
  const calls = [];
  let clock = 1000;
  class FixtureDate extends Date {
    static now() { return clock; }
  }
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const context = vm.createContext({
    ...backendSupport, ...constants, tasks, URLSearchParams, Date: FixtureDate,
    location: { search }, getElement, escapeHtml,
    // Presentation and unrelated settings panels are inert; no browser exists.
    applySettings() {}, renderSummary() {}, renderProviders() {},
    renderZcodeSettingHint() {}, renderWorkspaces() {}, renderTasks() {},
    updateRunState() {}, renderContext() {}, updateModelVariantOptions() {},
    getStatusMeta: status => ({ label: status || 'none', tone: 'neutral' }),
    isFullAccessMode: mode => mode === 'full',
    isWriteMode: mode => mode === 'build' || mode === 'full',
    getModeLabel: mode => mode, getVariantLabel: value => value,
    formatDuration: value => String(value || 0), formatTime: value => String(value || ''),
    updateThinkingBar() {}, captureConversationDetails: () => ({}),
    restoreConversationDetails() {}, upgradeMermaidCodeBlocks() {},
    applyContentSearchHighlights() {}, scrollConversationToBottom() {},
    updateConversationFollowButton() {}, loadTodoAnchors: () => new Map(),
    renderPlanConfirmCard: () => '', renderAssistantArtifacts: () => '',
    renderInlineToolImages: () => '', renderFileChangesCard: () => '',
    renderNativeMessageActions: () => '', renderMessageAttachments: () => '',
    formatAgentMarkdown: escapeHtml, normalizeAgentOutput: value => String(value || ''),
    countLiveFollowUps: () => 0,
    fetchJson(url) {
      if (synchronousFetchError) throw synchronousFetchError;
      const query = new URL(url, 'https://fixture.invalid').searchParams;
      // A snapshot made at request time, so late responses remain genuinely old.
      const packet = { success: true, data: {
        generatedAt: '2026-10-15T20:00:00Z',
        tasks: context.listTasks({
          limit: 30, taskId: query.get('task') || '', query: query.get('q') || '',
          includeArchived: query.get('archived') === '1',
        }),
      } };
      let resolve;
      let reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = {
        url, query, packet, settled: false,
        resolve(value = packet) {
          assert.equal(request.settled, false, 'Request already settled');
          request.settled = true;
          resolve(value);
        },
        reject(error) {
          assert.equal(request.settled, false, 'Request already settled');
          request.settled = true;
          reject(error);
        },
      };
      requests.push(request);
      return promise;
    },
  });
  runBlock(context, stateBlock, 'globalThis.__state = agentWorkbenchState;');
  for (const block of [...frontendFunctions, ...backendFunctions]) runBlock(context, block);
  const state = context.__state;
  const actualRender = context.renderPayload;
  context.renderPayload = packet => {
    actualRender(packet);
    rendered.push({ packet, selected: state.selectedTaskId, html: getElement('agent-output').innerHTML });
  };
  const actualButton = context.setButtonBusy;
  context.setButtonBusy = (...args) => {
    actualButton(...args);
    buttons.push({ id: args[0], busy: args[1], text: getElement(args[0]).textContent });
  };
  const actualStatus = context.setStatus;
  context.setStatus = (...args) => { actualStatus(...args); statuses.push({ text: args[0], tone: args[1] }); };

  return {
    context, state, tasks, requests, rendered, buttons, statuses, calls, getElement,
    setTime(value) { clock = value; },
    prime(id = 'A') {
      state.selectedTaskId = id;
      state.payload = { tasks: context.listTasks({ limit: 30, taskId: id }) };
      context.renderSelectedTask(state.payload);
    },
    select(id) {
      state.selectedTaskId = id;
      state.newSession = false;
      state.formTaskId = '';
      if (state.payload) context.renderSelectedTask(state.payload);
    },
    refresh(options = { quiet: true }) {
      const call = { outcome: null, promise: context.refreshAgentWorkbench(options) };
      // Observe rejection immediately, including joiners, to avoid unhandled rejections.
      call.done = call.promise.then(value => {
        call.outcome = { status: 'fulfilled', value };
        return call.outcome;
      }, reason => {
        call.outcome = { status: 'rejected', reason };
        return call.outcome;
      });
      calls.push(call);
      return call;
    },
    assertClean() {
      assert.equal(state.refreshing, false, 'refreshing must clear');
      assert.equal(state.refreshPromise, null, 'refreshPromise must clear');
      assert.equal(state.refreshPending, null, 'refreshPending must clear');
      const button = getElement('agent-refresh-btn');
      assert.equal(button.disabled, false, 'Refresh button must be enabled');
      assert.equal(button.textContent, '刷新状态', 'Refresh button text must reset');
    },
    assertConversation(id) {
      const selected = context.getSelectedTask(state.payload);
      assert.equal(selected?.id, id);
      assert.equal(selected.messageCount, 2);
      assert.equal(selected.messages.length, 2);
      assert.match(getElement('agent-output').innerHTML, new RegExp(`${id} ANSWER`));
      assert.doesNotMatch(getElement('agent-output').innerHTML, /正在加载会话/);
    },
    async assertFulfilled(packet) {
      for (const call of calls) {
        const outcome = await call.done;
        assert.equal(outcome.status, 'fulfilled');
        assert.equal(outcome.value, packet, 'All joiners must receive the latest result');
      }
      this.assertClean();
    },
    async assertRejected(error) {
      for (const call of calls) {
        const outcome = await call.done;
        assert.equal(outcome.status, 'rejected');
        assert.equal(outcome.reason, error);
      }
      this.assertClean();
    },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const scenario = (name, fn) => test(name, { timeout: 3000 }, fn);

scenario('首次 URL task=B：首个请求直接包含 B，实际会话渲染出 B 消息', async () => {
  const h = harness({ search: '?unrelated=1&task=B' });
  assert.equal(h.state.selectedTaskId, 'B');
  h.refresh();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].query.get('task'), 'B');
  h.requests[0].resolve();
  await h.assertFulfilled(h.requests[0].packet);
  assert.equal(h.requests.length, 1);
  h.assertConversation('B');
});

scenario('无 URL task：一次请求即展示默认首项，不产生自触发补刷', async () => {
  const h = harness({ search: '' });
  assert.equal(h.state.selectedTaskId, '');
  h.refresh();
  assert.equal(h.requests[0].query.has('task'), false);
  h.requests[0].resolve();
  await h.assertFulfilled(h.requests[0].packet);
  assert.equal(h.requests.length, 1);
  h.assertConversation('A');
});

scenario('A 进行中切 B：旧 A 不渲染、不更新时间，立即补拉 B，调用者共同等待 B', async () => {
  const h = harness();
  h.prime('A');
  h.state.lastFullRefreshAt = 12;
  h.refresh();
  h.select('B');
  assert.match(h.getElement('agent-output').innerHTML, /正在加载会话/);
  h.refresh();
  h.requests[0].resolve();
  await flush();
  assert.equal(h.rendered.length, 0);
  assert.equal(h.state.lastFullRefreshAt, 12);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].query.get('task'), 'B');
  assert(h.calls.every(call => call.outcome === null));
  h.setTime(2000);
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
  assert.equal(h.rendered.length, 1);
  assert.equal(h.state.lastFullRefreshAt, 2000);
  h.assertConversation('B');
});

scenario('快速 A-B-C：只请求 A、C，B 不发出，旧 A 不渲染', async () => {
  const h = harness();
  h.prime();
  h.refresh();
  h.select('B'); h.refresh();
  h.select('C'); h.refresh();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve();
  await flush();
  assert.deepEqual(h.requests.map(request => request.query.get('task')), ['A', 'C']);
  assert.equal(h.rendered.length, 0);
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
  h.assertConversation('C');
});

scenario('筛选变化：丢弃未筛选响应，补拉最新 q，首项回退包含消息', async () => {
  const h = harness();
  h.prime(); h.refresh();
  h.state.sessionQuery = 'searchable-B';
  h.refresh();
  h.requests[0].resolve();
  await flush();
  assert.equal(h.rendered.length, 0);
  assert.equal(h.requests[1].query.get('q'), 'searchable-B');
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
  h.assertConversation('B');
});

for (const [initial, final] of [[false, true], [true, false]]) {
  scenario(`归档变化 ${initial}->${final}：响应按最新 archived 重拉且旧响应不渲染`, async () => {
    const h = harness();
    h.state.includeArchived = initial;
    h.refresh();
    h.state.includeArchived = final;
    h.refresh();
    h.requests[0].resolve();
    await flush();
    assert.equal(h.rendered.length, 0);
    assert.equal(h.requests[1].query.has('archived'), final);
    h.requests[1].resolve();
    await h.assertFulfilled(h.requests[1].packet);
    assert.equal(h.state.payload.tasks.some(task => task.id === 'D'), final);
    h.assertConversation('A');
  });
}

scenario('任务/筛选/归档连续变化：中间组合不请求，只请求最终组合', async () => {
  const h = harness();
  h.prime(); h.refresh();
  h.state.sessionQuery = 'searchable-B'; h.refresh();
  h.state.includeArchived = true; h.refresh();
  // Select a task already present in the sidebar; archived D is not visible yet.
  h.select('C'); h.state.sessionQuery = 'searchable-C'; h.refresh();
  h.requests[0].resolve();
  await flush();
  assert.equal(h.requests.length, 2);
  const query = h.requests[1].query;
  assert.equal(query.get('task'), 'C');
  assert.equal(query.get('q'), 'searchable-C');
  assert.equal(query.get('archived'), '1');
  assert.equal(h.rendered.length, 0);
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
  h.assertConversation('C');
});

scenario('同查询并发去重：多个调用共享进行中队列，只发一次请求', async () => {
  const h = harness();
  h.refresh({ quiet: false });
  const shared = h.state.refreshPromise;
  for (let i = 0; i < 8; i++) h.refresh({ quiet: i % 2 === 0 });
  assert.equal(h.state.refreshPromise, shared);
  assert.equal(h.state.refreshPending, null);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve();
  await h.assertFulfilled(h.requests[0].packet);
  assert.equal(h.requests.length, 1);
  assert.equal(h.rendered.length, 1);
});

scenario('force 首次请求保留，普通同查询 join 不产生额外 force 请求', async () => {
  const h = harness();
  h.refresh({ force: true, quiet: false });
  h.refresh();
  assert.equal(h.requests[0].query.get('force'), '1');
  assert.equal(h.state.refreshQuery.includes('force'), false);
  assert.equal(h.state.refreshPending, null);
  h.requests[0].resolve();
  await h.assertFulfilled(h.requests[0].packet);
  assert.equal(h.requests.length, 1);
});

scenario('同查询显式 force：排队补一次强制请求，多次 force 合并', async () => {
  const h = harness();
  h.refresh();
  h.refresh({ force: true, quiet: true });
  h.refresh({ force: true, quiet: true });
  h.requests[0].resolve();
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].query.get('force'), '1');
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
  assert.equal(h.requests.length, 2);
});

scenario('force 保留：待补刷 force 不被 B/C 普通请求覆盖，非 quiet 意图也保留', async () => {
  const h = harness();
  h.prime(); h.refresh();
  h.refresh({ force: true, quiet: true });
  h.select('B'); h.refresh({ quiet: false });
  h.select('C'); h.refresh({ quiet: true });
  assert.equal(h.state.refreshPending.force, true);
  assert.equal(h.state.refreshPending.quiet, false);
  h.requests[0].resolve();
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].query.get('task'), 'C');
  assert.equal(h.requests[1].query.get('force'), '1');
  assert.equal(h.getElement('agent-refresh-btn').disabled, true);
  assert.equal(h.rendered.length, 0);
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
  h.assertConversation('C');
});

scenario('A 失败但已有 pending B：继续 B，全部调用取得 B，旧失败不显示错误', async () => {
  const h = harness();
  h.prime(); h.refresh({ quiet: false });
  h.select('B'); h.refresh();
  h.requests[0].reject(new Error('synthetic A failure'));
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].query.get('task'), 'B');
  assert.equal(h.statuses.some(status => status.tone === 'error'), false);
  assert.equal(h.rendered.length, 0);
  assert.equal(h.getElement('agent-refresh-btn').disabled, true);
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
  h.assertConversation('B');
});

scenario('失败后 pending 继续时保留最新任务、筛选、归档和 force', async () => {
  const h = harness();
  h.prime(); h.refresh();
  h.select('B'); h.refresh({ force: true, quiet: true });
  h.select('C');
  h.state.sessionQuery = 'searchable-C'; h.state.includeArchived = true;
  h.refresh();
  h.requests[0].reject(new Error('synthetic obsolete failure'));
  await flush();
  assert.equal(h.requests.length, 2);
  const query = h.requests[1].query;
  assert.equal(query.get('task'), 'C');
  assert.equal(query.get('q'), 'searchable-C');
  assert.equal(query.get('archived'), '1');
  assert.equal(query.get('force'), '1');
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
  h.assertConversation('C');
});

scenario('无 pending 的失败：所有 joiner 拒绝，标志/按钮清理，后续请求可重试', async () => {
  const h = harness();
  const failure = new Error('synthetic final failure');
  h.state.lastFullRefreshAt = 17;
  h.refresh({ quiet: false }); h.refresh();
  assert.equal(h.getElement('agent-refresh-btn').disabled, true);
  assert.equal(h.getElement('agent-refresh-btn').textContent, '刷新中...');
  h.requests[0].reject(failure);
  await h.assertRejected(failure);
  assert.equal(h.state.lastFullRefreshAt, 17);
  assert.equal(h.rendered.length, 0);
  assert.match(h.getElement('agent-workbench-status').textContent, /加载失败：synthetic final failure/);
  const retry = h.refresh({ quiet: false });
  h.requests[1].resolve();
  assert.equal((await retry.done).status, 'fulfilled');
  h.assertClean();
  h.assertConversation('A');
});

scenario('队列最后一次也失败：旧失败被忽略、最终错误传播，标志/按钮清理', async () => {
  const h = harness();
  h.refresh();
  h.select('B'); h.refresh({ quiet: false });
  h.requests[0].reject(new Error('synthetic first failure'));
  await flush();
  assert.equal(h.getElement('agent-refresh-btn').disabled, true);
  const failure = new Error('synthetic B failure');
  h.requests[1].reject(failure);
  await h.assertRejected(failure);
  assert.equal(h.statuses.filter(status => status.tone === 'error').length, 1);
  assert.match(h.getElement('agent-workbench-status').textContent, /synthetic B failure/);
});

scenario('渲染异常：拒绝并清理 refreshing/promise/pending 和刷新按钮', async () => {
  const h = harness();
  const failure = new Error('synthetic render failure');
  h.context.renderPayload = () => { throw failure; };
  h.refresh({ quiet: false });
  h.requests[0].resolve();
  await h.assertRejected(failure);
  assert.equal(h.state.lastFullRefreshAt, 0);
});

scenario('新建会话切换：移除 task 后补刷，不把旧任务响应画回会话区', async () => {
  const h = harness();
  h.prime(); h.refresh();
  h.state.newSession = true;
  h.context.renderSelectedTask(h.state.payload);
  h.refresh();
  h.requests[0].resolve();
  await flush();
  assert.equal(h.rendered.length, 0);
  assert.equal(h.requests[1].query.has('task'), false);
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
  assert.match(h.getElement('agent-output').innerHTML, /准备好开始工作/);
  assert.doesNotMatch(h.getElement('agent-output').innerHTML, /A ANSWER/);
});

for (const kind of ['missing', 'filtered', 'archived', 'outside-limit']) {
  scenario(`selected 失效 ${kind}：首项附完整消息/详情，实际渲染不再显示加载占位`, async () => {
    const h = harness({ search: `?task=${kind === 'missing' ? 'gone' : kind === 'archived' ? 'D' : 'A'}` });
    let expected = 'A';
    if (kind === 'filtered') {
      h.state.sessionQuery = 'searchable-B';
      expected = 'B';
    }
    if (kind === 'outside-limit') {
      // Keep requested A in storage but move it beyond the actual 30-row API limit.
      for (let index = 0; index < 31; index++) {
        const id = `new-${String(index).padStart(2, '0')}`;
        h.tasks.set(id, fixtureTask('C', { id, updatedAt: `2026-10-16T00:00:${String(index).padStart(2, '0')}Z` }));
      }
      expected = 'new-30';
    }
    h.refresh();
    const items = h.requests[0].packet.data.tasks;
    assert.equal(items.some(task => task.id === h.state.selectedTaskId), false);
    assert.equal(items[0].id, expected);
    assert.equal(items[0].messageCount, 2);
    assert.equal(items[0].messages.length, 2);
    assert(items[0].outputText);
    assert(items[0].diffText);
    assert.equal(items[0].events.length, 1);
    for (const item of items.slice(1)) {
      assert.equal(item.messageCount, 2);
      assert.equal(Object.hasOwn(item, 'messages'), false);
      assert.equal(item.outputText, '');
      assert.equal(item.diffText, '');
      assert.equal(item.events.length, 0);
    }
    h.requests[0].resolve();
    await h.assertFulfilled(h.requests[0].packet);
    assert.equal(h.state.selectedTaskId, expected);
    assert.doesNotMatch(h.getElement('agent-output').innerHTML, /正在加载会话/);
    assert.match(h.getElement('agent-output').innerHTML, /ANSWER/);
    assert.equal(h.requests.length, 1);
  });
}

scenario('列表为空：失效 selected 不抛错，不生成加载占位，也不无限补刷', async () => {
  const h = harness({ taskItems: [] });
  h.refresh();
  assert.equal(h.requests[0].packet.data.tasks.length, 0);
  h.requests[0].resolve();
  await h.assertFulfilled(h.requests[0].packet);
  assert.equal(h.requests.length, 1);
  assert.match(h.getElement('agent-output').innerHTML, /准备好开始工作/);
});

scenario('补充边界 A-B-A：回到进行中的同查询且没有 force，不应多发重复 A', async () => {
  const h = harness();
  h.prime(); h.refresh();
  h.select('B'); h.refresh();
  h.select('A'); h.refresh();
  h.requests[0].resolve();
  await flush();
  const sent = h.requests.map(request => request.query.get('task'));
  // Settle any unexpected extra request before reporting the regression.
  for (const request of h.requests.slice(1)) if (!request.settled) request.resolve();
  await h.assertFulfilled(h.requests[h.requests.length - 1].packet);
  h.assertConversation('A');
  assert.deepEqual(sent, ['A'], 'Pending B must not survive a return to already in-flight A without force');
});

scenario('A-B-A 但 pending 有 force：应保留一次强制补刷', async () => {
  const h = harness();
  h.prime(); h.refresh();
  h.select('B'); h.refresh({ force: true, quiet: true });
  h.select('A'); h.refresh();
  h.requests[0].resolve();
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].query.get('task'), 'A');
  assert.equal(h.requests[1].query.get('force'), '1');
  h.requests[1].resolve();
  await h.assertFulfilled(h.requests[1].packet);
});

after(() => {
  assert.equal(fs.readFileSync(frontendPath, 'utf8'), frontend, 'Frontend source changed during test');
  assert.equal(fs.readFileSync(backendPath, 'utf8'), backend, 'Backend source changed during test');
  process.stdout.write('Source snapshots unchanged; only two source files were read, with no project imports or browser.\n');
});
