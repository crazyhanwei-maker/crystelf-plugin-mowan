import test from 'node:test';
import assert from 'node:assert/strict';
import ConfigControl from '../config/configControl.js';
import { buildAgentAutoTool } from './agentAutoTask.js';
import {
  createAgentAutoGuard,
  isChannelAllowed,
  isGroupAllowed,
  isMasterForAgent,
  maskAgentSecrets,
  normalizeAgentAutoConfig,
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

  const clamped = normalizeAgentAutoConfig({
    enabled: true,
    maxPerHour: 999,
    maxConcurrent: 99,
    timeoutMs: 1,
    maxResultChars: 1,
  });
  assert.equal(clamped.enabled, true);
  assert.equal(clamped.maxPerHour, 60);
  assert.equal(clamped.maxConcurrent, 3);
  assert.equal(clamped.timeoutMs, 60000);
  assert.equal(clamped.maxResultChars, 200);
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

test('buildAgentAutoTool exposes only for enabled master in allowed channel', () => {
  const originalGet = ConfigControl.get;
  const baseCore = {
    tools: {
      agentAuto: { enabled: true, allowPrivate: true, allowedGroups: ['100'] },
      agentWorkbench: { enabled: true, providers: { opencode: true } },
    },
  };
  try {
    ConfigControl.get = key => {
      if (key === 'coreConfig') return baseCore;
      if (key === 'config') return { masterQQ: ['42'] };
      return {};
    };
    const tool = buildAgentAutoTool({
      isMaster: true,
      userId: '42',
      sessionId: 'private:42',
      event: { user_id: '42', message_id: 1 },
    });
    assert.equal(tool?.name, 'agent_analyze');
    assert.equal(tool?.returnToAI, false);
    assert.equal(tool?.stopOnFailure, true);

    assert.equal(buildAgentAutoTool({
      isMaster: false,
      userId: '43',
      sessionId: 'private:43',
      event: { user_id: '43', message_id: 2 },
    }), null);

    assert.equal(buildAgentAutoTool({
      isMaster: true,
      userId: '42',
      groupId: '999',
      sessionId: 'group:999:42',
      event: { user_id: '42', group_id: '999', message_id: 3 },
    }), null);

    ConfigControl.get = key => {
      if (key === 'coreConfig') {
        return { tools: { ...baseCore.tools, agentAuto: { ...baseCore.tools.agentAuto, enabled: false } } };
      }
      if (key === 'config') return { masterQQ: ['42'] };
      return {};
    };
    assert.equal(buildAgentAutoTool({
      isMaster: true,
      userId: '42',
      sessionId: 'private:42',
      event: { user_id: '42', message_id: 4 },
    }), null);
  } finally {
    ConfigControl.get = originalGet;
  }
});
