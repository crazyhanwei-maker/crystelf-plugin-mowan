import test from 'node:test';
import assert from 'node:assert/strict';
import ConfigControl from '../config/configControl.js';
import {
  buildAgentAutoTools,
  handleAgentExecute,
  maybeHandleAgentAutoExecution,
} from './agentAutoTask.js';
import {
  createAgentAutoGuard,
  createAgentAutoPendingStore,
  isChannelAllowed,
  isExecuteCancel,
  isExecuteConfirmation,
  isGroupAllowed,
  isMasterForAgent,
  maskAgentSecrets,
  normalizeAgentAutoConfig,
  shouldAutoDelegateLocalAgent,
  shouldPreferLocalAgent,
  truncateAgentResult,
} from './agentAutoConfig.js';

test('normalizeAgentAutoConfig fills defaults and clamps limits', () => {
  const defaults = normalizeAgentAutoConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.allowPrivate, true);
  assert.equal(defaults.maxPerHour, 5);
  assert.equal(defaults.maxConcurrent, 1);
  assert.equal(defaults.timeoutMs, 600000);
  assert.equal(defaults.maxResultChars, 1200);
  assert.equal(defaults.saveToHistory, true);
  assert.equal(defaults.showProgress, false);
  assert.equal(defaults.allowExecute, false);
  assert.equal(defaults.executeTimeoutMs, 1800000);
  assert.equal(defaults.executeConfirmTtlMs, 600000);

  const clamped = normalizeAgentAutoConfig({
    enabled: true,
    maxPerHour: 999,
    maxConcurrent: 99,
    timeoutMs: 1,
    maxResultChars: 1,
    executeTimeoutMs: 1,
    executeConfirmTtlMs: 1,
  });
  assert.equal(clamped.enabled, true);
  assert.equal(clamped.maxPerHour, 60);
  assert.equal(clamped.maxConcurrent, 3);
  assert.equal(clamped.timeoutMs, 60000);
  assert.equal(clamped.maxResultChars, 200);
  assert.equal(clamped.executeTimeoutMs, 60000);
  assert.equal(clamped.executeConfirmTtlMs, 60000);
});

test('allowedGroups normalizes wildcard aliases', () => {
  const config = normalizeAgentAutoConfig({ allowedGroups: ['all', ' 123 ', '123', '*'] });
  assert.deepEqual(config.allowedGroups, ['*', '123']);
  assert.equal(isGroupAllowed('999', config), true);
  assert.equal(isGroupAllowed('999', normalizeAgentAutoConfig({ allowedGroups: ['123'] })), false);
  assert.equal(isGroupAllowed('123', normalizeAgentAutoConfig({ allowedGroups: ['123'] })), true);
});

test('isMasterForAgent honors toolCtx, framework flag and masterQQ', () => {
  assert.equal(isMasterForAgent({ isMaster: true }), true);
  assert.equal(isMasterForAgent({ event: { isMaster: true, user_id: '1' } }), true);
  assert.equal(isMasterForAgent({ event: { user_id: '42' } }, { masterQQ: ['42'] }), true);
  assert.equal(isMasterForAgent({ event: { user_id: '43' } }, { masterQQ: ['42'] }), false);
  assert.equal(isMasterForAgent({}, { masterQQ: ['42'] }), false);
});

test('isChannelAllowed enforces private switch, group whitelist and synthetic events', () => {
  const base = normalizeAgentAutoConfig({ allowPrivate: true, allowedGroups: ['100'] });
  assert.equal(isChannelAllowed({ event: { user_id: '1' } }, base), true);
  assert.equal(isChannelAllowed({ event: { group_id: '100' } }, base), true);
  assert.equal(isChannelAllowed({ event: { group_id: '200' } }, base), false);
  assert.equal(isChannelAllowed({ groupId: '100', event: { group_id: '100' } }, base), true);
  assert.equal(isChannelAllowed({ event: { group_id: '100', crystelfSynthetic: true } }, base), false);
  assert.equal(isChannelAllowed({ event: { group_id: '100', crystelfCommandBridge: true } }, base), false);
  assert.equal(isChannelAllowed({ event: {} }, normalizeAgentAutoConfig({ allowPrivate: false })), false);
});

test('maskAgentSecrets hides common key shapes', () => {
  assert.equal(maskAgentSecrets('sk-abcdefgh12345678'), 'sk-***');
  const text = 'apiKey: sk-abcdefgh12345678\nAuthorization: Bearer abcdefgh12345678\n{"token":"abcdefgh1234"}';
  const masked = maskAgentSecrets(text);
  assert.match(masked, /\*\*\*/);
  assert.doesNotMatch(masked, /abcdefgh12345678/);
  assert.doesNotMatch(masked, /abcdefgh1234/);
});

test('truncateAgentResult respects bounds', () => {
  assert.deepEqual(truncateAgentResult('short', 1200), { text: 'short', truncated: false });
  const long = 'x'.repeat(500);
  const result = truncateAgentResult(long, 200);
  assert.equal(result.text.length, 200);
  assert.equal(result.truncated, true);
});

test('guard enforces per-session concurrency, hourly quota and dedup', () => {
  let now = 1_000_000;
  const guard = createAgentAutoGuard({ now: () => now });
  const config = normalizeAgentAutoConfig({ maxPerHour: 1, maxConcurrent: 1 });

  const first = guard.begin('auto:private:1', config);
  assert.equal(first.ok, true);
  assert.equal(guard.begin('auto:private:1', config).ok, false);
  assert.equal(guard.begin('auto:private:2', config).ok, false);

  guard.markSubmitted('auto:private:1', 'task-1');
  assert.equal(guard.getActive('auto:private:1')?.taskId, 'task-1');
  guard.release('auto:private:1');

  assert.equal(guard.begin('auto:private:1', config).ok, false);
  now += 60 * 60 * 1000 + 1;
  assert.equal(guard.begin('auto:private:1', config).ok, true);
  guard.release('auto:private:1');

  assert.equal(guard.seenRecently('msg-1'), false);
  guard.remember('msg-1');
  assert.equal(guard.seenRecently('msg-1'), true);
  now += 31 * 1000;
  assert.equal(guard.seenRecently('msg-1'), false);

  const duplicateGuard = createAgentAutoGuard({ now: () => now });
  assert.equal(duplicateGuard.begin('auto:private:9', config, 'same-message').ok, true);
  const duplicate = duplicateGuard.begin('auto:private:9', config, 'same-message');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.duplicate, true);
  duplicateGuard.release('auto:private:9');
});

test('execute confirmation/cancel patterns and pending store', () => {
  assert.equal(isExecuteConfirmation('执行'), true);
  assert.equal(isExecuteConfirmation('确认执行'), true);
  assert.equal(isExecuteConfirmation('确认执行。'), true);
  assert.equal(isExecuteConfirmation('执行测试'), false);
  assert.equal(isExecuteCancel('取消'), true);
  assert.equal(isExecuteCancel('取消！'), true);
  assert.equal(isExecuteCancel('算了'), true);
  assert.equal(isExecuteCancel('执行'), false);

  let now = 1_000_000;
  const store = createAgentAutoPendingStore({ now: () => now });
  assert.equal(store.consume('k', '执行'), null);

  store.remember('k', { type: 'plan', prompt: 'plan text' }, 60000);
  const pendingResult = store.consume('k', '继续看看', 60000);
  assert.equal(pendingResult.status, 'pending');
  assert.equal(store.peek('k', 60000)?.type, 'plan');

  const cancelled = store.consume('k', '取消', 60000);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(store.peek('k', 60000), null);

  store.remember('k', { type: 'confirm', prompt: 'direct task' }, 60000);
  const confirmed = store.consume('k', '确认执行', 60000);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.entry.prompt, 'direct task');
  assert.equal(store.peek('k', 60000), null);

  store.remember('k', { type: 'plan', prompt: 'plan text' }, 60000);
  now += 60001;
  assert.equal(store.consume('k', '执行', 60000)?.status, 'expired');

  store.remember('k', { type: 'plan', prompt: 'plan text' }, 60000);
  now += 60001;
  assert.equal(store.consume('k', '你好', 60000), null);
});

test('buildAgentAutoTools exposes analyze and gated execute', () => {
  const originalGet = ConfigControl.get;
  const baseCore = {
    tools: {
      agentAuto: { enabled: true, allowPrivate: true, allowedGroups: ['100'], allowExecute: false },
      agentWorkbench: {
        enabled: true,
        writeEnabled: true,
        writableWorkspaces: { plugin: true },
        providers: { opencode: true },
      },
    },
  };
  const masterCtx = {
    isMaster: true,
    userId: '42',
    sessionId: 'private:42',
    event: { user_id: '42', message_id: 1 },
  };
  const setCore = core => {
    ConfigControl.get = key => {
      if (key === 'coreConfig') return core;
      if (key === 'config') return { masterQQ: ['42'] };
      return {};
    };
  };
  try {
    setCore(baseCore);
    const analyzeOnly = buildAgentAutoTools(masterCtx);
    assert.deepEqual(analyzeOnly.map(tool => tool.name), ['agent_analyze']);
    assert.equal(analyzeOnly[0].returnToAI, false);
    assert.equal(analyzeOnly[0].stopOnFailure, true);
    assert.equal(analyzeOnly[0].suppressEmptyReply, true);

    assert.deepEqual(buildAgentAutoTools({
      ...masterCtx,
      isMaster: false,
      userId: '43',
      event: { user_id: '43', message_id: 2 },
    }), []);

    assert.deepEqual(buildAgentAutoTools({
      ...masterCtx,
      groupId: '999',
      sessionId: 'group:999:42',
      event: { user_id: '42', group_id: '999', message_id: 3 },
    }), []);

    setCore({
      tools: {
        ...baseCore.tools,
        agentAuto: { ...baseCore.tools.agentAuto, allowExecute: true },
      },
    });
    const withExecute = buildAgentAutoTools(masterCtx);
    assert.deepEqual(withExecute.map(tool => tool.name), ['agent_analyze', 'agent_execute']);
    assert.equal(withExecute[1].suppressEmptyReply, true);

    setCore({
      tools: {
        ...baseCore.tools,
        agentAuto: { ...baseCore.tools.agentAuto, allowExecute: true },
        agentWorkbench: { ...baseCore.tools.agentWorkbench, writeEnabled: false },
      },
    });
    assert.deepEqual(buildAgentAutoTools(masterCtx).map(tool => tool.name), ['agent_analyze']);

    setCore({
      tools: {
        ...baseCore.tools,
        agentAuto: { ...baseCore.tools.agentAuto, allowExecute: true },
        agentWorkbench: { ...baseCore.tools.agentWorkbench, writableWorkspaces: { plugin: false } },
      },
    });
    assert.deepEqual(buildAgentAutoTools(masterCtx).map(tool => tool.name), ['agent_analyze']);

    setCore({
      tools: {
        ...baseCore.tools,
        agentAuto: { ...baseCore.tools.agentAuto, enabled: false },
      },
    });
    assert.deepEqual(buildAgentAutoTools(masterCtx), []);
  } finally {
    ConfigControl.get = originalGet;
  }
});

test('agent_execute requests confirmation and consumes it once', async () => {
  const originalGet = ConfigControl.get;
  const core = {
    tools: {
      agentAuto: {
        enabled: true,
        allowPrivate: true,
        allowExecute: true,
        executeConfirmTtlMs: 600000,
      },
      agentWorkbench: {
        enabled: true,
        writeEnabled: true,
        writableWorkspaces: { plugin: true },
        providers: { opencode: true },
      },
    },
  };
  ConfigControl.get = key => {
    if (key === 'coreConfig') return core;
    if (key === 'config') return { masterQQ: ['4242'] };
    return {};
  };
  const replies = [];
  const saved = [];
  const ctx = {
    isMaster: true,
    userId: '4242',
    sessionId: 'private:4242',
    groupId: null,
    event: {
      user_id: '4242',
      message_id: 100,
      sender: { nickname: 'master' },
      reply: async text => { replies.push(text); },
    },
    db: { saveMessage: message => { saved.push(message); } },
  };
  try {
    const request = await handleAgentExecute({ task: '把日志级别改成 debug' }, ctx);
    assert.equal(request.success, true);
    assert.equal(request.confirmationRequired, true);
    assert.match(replies[0], /确认执行/);

    // 确认前关闭工作台：验证确认状态会被消费，并且不会重复执行
    core.tools.agentWorkbench.enabled = false;
    assert.equal(await maybeHandleAgentAutoExecution(ctx, '确认执行'), true);
    assert.match(replies.at(-1), /Agent 执行任务未启动/);
    assert.ok(saved.some(message => message.role === 'user' && message.content === '确认执行'));
    assert.ok(saved.some(message => message.role === 'assistant' && message.content.includes('Agent 执行任务未启动')));
    assert.equal(await maybeHandleAgentAutoExecution(ctx, '确认执行'), false);

    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(saved.some(message => message.role === 'assistant' && message.content.includes('即将以全权限执行')));
  } finally {
    ConfigControl.get = originalGet;
  }
});

test('local workspace questions route to agent deterministically', () => {
  assert.equal(shouldPreferLocalAgent('看下当前灵晶插件的版本'), true);
  assert.equal(shouldPreferLocalAgent('原神最新版本几点上线'), false);
  assert.equal(shouldAutoDelegateLocalAgent('看下当前灵晶插件的版本'), true);
  assert.equal(shouldAutoDelegateLocalAgent('去本地目录里找'), true);
  assert.equal(shouldAutoDelegateLocalAgent('看看日志'), true);
  assert.equal(shouldAutoDelegateLocalAgent('这个插件真好用'), false);
  assert.equal(shouldAutoDelegateLocalAgent('玛德，你踏马不会调用工具找么'), false);
  assert.equal(shouldAutoDelegateLocalAgent('#模型'), false);
});
