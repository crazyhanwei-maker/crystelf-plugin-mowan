import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeZcodeGoal,
  mergeZcodeGoalEvent,
  normalizeZcodeCheckpoint,
  mergeZcodeCheckpoints,
  normalizeZcodeCheckpointList,
  buildZcodeGoalCommand,
  buildZcodeCheckpointCommand,
  normalizeZcodeCheckpointTarget,
  parseZcodeGoalCommandResponse,
  resolveZcodeReasoningLevel,
  buildZcodeReasoningMap,
  ZCODE_REASONING_LEVELS,
} from './zcodeSession.js';

test('normalizeZcodeGoal: 读取事件里的 time 字段并归一状态/用量', () => {
  const goal = normalizeZcodeGoal({
    objective: '  修复登录流程  ',
    status: 'active',
    tokensUsed: 1234,
    tokenBudget: 50000,
    timeUsedSeconds: 90,
    summaryTitle: '登录修复',
    time: { created: 1700000000000, updated: 1700000100000 },
  });
  assert.equal(goal.objective, '修复登录流程');
  assert.equal(goal.status, 'active');
  assert.equal(goal.tokensUsed, 1234);
  assert.equal(goal.tokenBudget, 50000);
  assert.equal(goal.timeUsedSeconds, 90);
  assert.equal(goal.summaryTitle, '登录修复');
  assert.equal(goal.createdAt, new Date(1700000000000).toISOString());
  assert.equal(goal.updatedAt, new Date(1700000100000).toISOString());
});

test('normalizeZcodeGoal: 无目标内容返回 null，未知状态回退 active', () => {
  assert.equal(normalizeZcodeGoal({ status: 'active' }), null);
  assert.equal(normalizeZcodeGoal(null), null);
  assert.equal(normalizeZcodeGoal({ objective: 'x', status: 'weird' }).status, 'active');
});

test('normalizeZcodeGoal: tokenBudget 缺省保持 null，负数归零', () => {
  assert.equal(normalizeZcodeGoal({ objective: 'x' }).tokenBudget, null);
  assert.equal(normalizeZcodeGoal({ objective: 'x', tokenBudget: -1 }).tokenBudget, 0);
  assert.equal(normalizeZcodeGoal({ objective: 'x', tokensUsed: -9 }).tokensUsed, 0);
});

test('mergeZcodeGoalEvent: clear 清空目标', () => {
  const current = { objective: '旧目标', status: 'active' };
  assert.equal(mergeZcodeGoalEvent(current, { action: 'clear', target: null }), null);
});

test('mergeZcodeGoalEvent: 新 target 覆盖旧值；缺 target 保留旧值', () => {
  const current = normalizeZcodeGoal({ objective: '旧目标', status: 'active' });
  const next = mergeZcodeGoalEvent(current, {
    action: 'status_updated',
    target: { objective: '新目标', status: 'paused' },
  });
  assert.equal(next.objective, '新目标');
  assert.equal(next.status, 'paused');
  assert.equal(mergeZcodeGoalEvent(current, { action: 'usage_accounted' }).objective, '旧目标');
});

test('normalizeZcodeCheckpoint: 校验 ID 并归一字段', () => {
  const checkpoint = normalizeZcodeCheckpoint({
    checkpointId: 'checkpoint_abc-123',
    scope: 'workspace',
    fileCount: '3',
    targetMessageId: 'msg_1',
    createdAt: 1700000000000,
  });
  assert.equal(checkpoint.id, 'checkpoint_abc-123');
  assert.equal(checkpoint.fileCount, 3);
  assert.equal(checkpoint.targetMessageId, 'msg_1');
  assert.equal(checkpoint.createdAt, new Date(1700000000000).toISOString());
  assert.equal(normalizeZcodeCheckpoint({ checkpointId: 'bad id' }), null);
});

test('mergeZcodeCheckpoints: 去重后按时间倒序并限制长度', () => {
  const older = { id: 'checkpoint_older', createdAt: 1700000000000, fileCount: 1 };
  const newer = { id: 'checkpoint_newer', createdAt: 1700000100000, fileCount: 2 };
  const updatedOlder = { ...older, fileCount: 4 };
  const merged = mergeZcodeCheckpoints([older, newer], updatedOlder);
  assert.deepEqual(merged.map(item => item.id), ['checkpoint_newer', 'checkpoint_older']);
  assert.equal(merged[1].fileCount, 4, '同一检查点重复上报时应更新为最新数据');

  const many = Array.from({ length: 60 }, (_, index) => ({
    id: `checkpoint_${index}`,
    createdAt: 1700000000000 + index,
  }));
  const limited = mergeZcodeCheckpoints(many, null);
  assert.equal(limited.length, 50);
  assert.equal(limited[0].id, 'checkpoint_59');
});

test('normalizeZcodeCheckpointList: 非数组输入安全返回空数组', () => {
  assert.deepEqual(normalizeZcodeCheckpointList(null), []);
  assert.deepEqual(normalizeZcodeCheckpointList({ id: 'checkpoint_x' }), []);
});

test('buildZcodeGoalCommand: 暂停/恢复/清除与设置', () => {
  assert.equal(buildZcodeGoalCommand('pause'), '/goal pause');
  assert.equal(buildZcodeGoalCommand('resume'), '/goal resume');
  assert.equal(buildZcodeGoalCommand('clear'), '/goal clear');
  assert.equal(buildZcodeGoalCommand('set', '修复登录'), '/goal replace 修复登录');
  assert.throws(() => buildZcodeGoalCommand('set', '   '), /不能为空/);
  assert.throws(() => buildZcodeGoalCommand('remove'), /不支持/);
});

test('buildZcodeGoalCommand: 目标内容裁剪到 2000 字符', () => {
  const command = buildZcodeGoalCommand('set', 'a'.repeat(2100));
  assert.equal(command.length, '/goal replace '.length + 2000);
});

test('buildZcodeCheckpointCommand: latest 与指定检查点', () => {
  assert.equal(buildZcodeCheckpointCommand('rewind'), '/rewind latest');
  assert.equal(buildZcodeCheckpointCommand('fork', 'checkpoint_abc'), '/fork checkpoint_abc');
  assert.throws(() => buildZcodeCheckpointCommand('drop', 'latest'), /不支持/);
  assert.throws(() => buildZcodeCheckpointCommand('rewind', '../../etc'), /格式不正确/);
});

test('normalizeZcodeCheckpointTarget: 空值回退 latest', () => {
  assert.equal(normalizeZcodeCheckpointTarget(''), 'latest');
  assert.equal(normalizeZcodeCheckpointTarget(' latest '), 'latest');
});

test('parseZcodeGoalCommandResponse: 设置/暂停/恢复输出解析', () => {
  const active = parseZcodeGoalCommandResponse('Goal active\nObjective: 修复登录\nUsage: 123 tokens / 50000\nTime: 9 seconds');
  assert.equal(active.objective, '修复登录');
  assert.equal(active.status, 'active');
  assert.equal(active.tokensUsed, 123);
  assert.equal(active.tokenBudget, 50000);
  assert.equal(active.timeUsedSeconds, 9);
  const paused = parseZcodeGoalCommandResponse('Goal paused\nObjective: 修复登录\nUsage: 0 tokens / none');
  assert.equal(paused.status, 'paused');
  assert.equal(paused.tokenBudget, null);
});

test('parseZcodeGoalCommandResponse: 清除与无目标返回 null，无法识别返回 undefined', () => {
  assert.equal(parseZcodeGoalCommandResponse('Goal cleared.'), null);
  assert.equal(parseZcodeGoalCommandResponse('No goal is set. Use /goal <objective> to set one.'), null);
  assert.equal(parseZcodeGoalCommandResponse('No goal to pause.'), undefined);
  assert.equal(parseZcodeGoalCommandResponse(''), undefined);
});

test('resolveZcodeReasoningLevel: 空值/默认不注入，关闭类归一，强度原样保留', () => {
  assert.equal(resolveZcodeReasoningLevel(''), 'enabled');
  assert.equal(resolveZcodeReasoningLevel('default'), 'enabled');
  assert.equal(resolveZcodeReasoningLevel('enabled'), 'enabled');
  for (const value of ['none', 'off', 'false', '0', 'disabled']) {
    assert.equal(resolveZcodeReasoningLevel(value), 'disabled');
  }
  for (const value of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    assert.equal(resolveZcodeReasoningLevel(value), value);
    assert.ok(ZCODE_REASONING_LEVELS.includes(value));
  }
  assert.equal(resolveZcodeReasoningLevel('8192'), '8192');
  assert.equal(resolveZcodeReasoningLevel('turbo'), 'turbo');
});

test('buildZcodeReasoningMap: OpenAI chat / Responses 写真实 effort', () => {
  assert.equal(buildZcodeReasoningMap('openai', 'low'), '{"reasoning_effort":"low"}');
  assert.equal(buildZcodeReasoningMap('grok', 'high'), '{"reasoning_effort":"high"}');
  assert.equal(buildZcodeReasoningMap('openai', 'disabled'), '{"reasoning_effort":"none"}');
  assert.equal(buildZcodeReasoningMap('openai', 'enabled'), '{}');
  assert.equal(buildZcodeReasoningMap('openai-responses', 'medium'), '{"reasoning":{"effort":"medium"}}');
  assert.equal(buildZcodeReasoningMap('responses', 'disabled'), '{"reasoning":{"effort":"none"}}');
  assert.equal(buildZcodeReasoningMap('openai-responses', ''), '{}');
});

test('buildZcodeReasoningMap: Anthropic 写 thinking 预算并按最大输出封顶', () => {
  assert.equal(buildZcodeReasoningMap('anthropic', 'minimal', 32000), '{"thinking":{"type":"enabled","budget_tokens":1024}}');
  assert.equal(buildZcodeReasoningMap('anthropic', 'medium', 32000), '{"thinking":{"type":"enabled","budget_tokens":4096}}');
  assert.equal(buildZcodeReasoningMap('anthropic', 'max', 32000), '{"thinking":{"type":"enabled","budget_tokens":24576}}');
  assert.equal(buildZcodeReasoningMap('anthropic', 'max', 8192), '{"thinking":{"type":"enabled","budget_tokens":7168}}');
  assert.equal(buildZcodeReasoningMap('anthropic', 'disabled', 32000), '{"thinking":{"type":"disabled"}}');
  assert.equal(buildZcodeReasoningMap('anthropic', '8192', 32000), '{"thinking":{"type":"enabled","budget_tokens":8192}}');
  assert.equal(buildZcodeReasoningMap('anthropic', 'enabled', 32000), '{}');
  assert.throws(() => buildZcodeReasoningMap('anthropic', 'turbo', 32000), /不支持思考强度/);
});
