import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeZcodeWorkflowEvent,
  normalizeZcodeWorkflowRuns,
  describeZcodeWorkflowEvent,
  zcodeWorkflowNodeProgress,
  ZCODE_WORKFLOW_RUN_LIMIT,
} from './zcodeWorkflow.js';

const at = 1700000000000;

test('mergeZcodeWorkflowEvent: run-started 创建运行并进入 running', () => {
  const runs = mergeZcodeWorkflowEvent([], { runId: 'run-1', eventType: 'run-started', payload: {}, timestamp: at });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runId, 'run-1');
  assert.equal(runs[0].status, 'running');
  assert.equal(runs[0].lastEvent, '工作流开始');
});

test('mergeZcodeWorkflowEvent: 节点事件去重并统计完成数', () => {
  let runs = mergeZcodeWorkflowEvent([], { runId: 'run-1', eventType: 'run-started', payload: {}, timestamp: at });
  runs = mergeZcodeWorkflowEvent(runs, { runId: 'run-1', eventType: 'node-queued', payload: { instance: { siteId: 'worker', ordinal: 0 } }, timestamp: at + 1 });
  runs = mergeZcodeWorkflowEvent(runs, { runId: 'run-1', eventType: 'node-dispatched', payload: { instance: { siteId: 'worker', ordinal: 0 } }, timestamp: at + 2 });
  runs = mergeZcodeWorkflowEvent(runs, { runId: 'run-1', eventType: 'node-queued', payload: { instance: { siteId: 'worker', ordinal: 1 } }, timestamp: at + 3 });
  assert.equal(Object.keys(runs[0].nodes).length, 2);
  assert.equal(zcodeWorkflowNodeProgress(runs[0]).total, 2);
  assert.equal(zcodeWorkflowNodeProgress(runs[0]).done, 0);
  runs = mergeZcodeWorkflowEvent(runs, { runId: 'run-1', eventType: 'node-settled', payload: { instance: { siteId: 'worker', ordinal: 0 }, outcome: 'success' }, timestamp: at + 4 });
  assert.equal(zcodeWorkflowNodeProgress(runs[0]).done, 1);
  assert.equal(runs[0].nodes['worker@0'].status, 'success');
  runs = mergeZcodeWorkflowEvent(runs, { runId: 'run-1', eventType: 'node-settled', payload: { instance: { siteId: 'worker', ordinal: 1 }, outcome: 'cached' }, timestamp: at + 5 });
  assert.equal(runs[0].nodes['worker@1'].status, 'success', 'cached 节点应算已完成');
  assert.equal(zcodeWorkflowNodeProgress(runs[0]).done, 2);
});

test('mergeZcodeWorkflowEvent: run-settled 状态映射', () => {
  const base = mergeZcodeWorkflowEvent([], { runId: 'run-1', eventType: 'run-started', payload: {}, timestamp: at });
  const success = mergeZcodeWorkflowEvent(base, { runId: 'run-1', eventType: 'run-settled', payload: { status: 'completed' }, timestamp: at + 1 });
  assert.equal(success[0].status, 'success');
  assert.match(success[0].lastEvent, /工作流完成/);
  const failed = mergeZcodeWorkflowEvent(base, { runId: 'run-2', eventType: 'run-settled', payload: { status: 'failed', error: { message: 'boom' } }, timestamp: at + 2 });
  assert.equal(failed[0].status, 'error');
  assert.match(failed[0].lastEvent, /boom/);
  const canceled = mergeZcodeWorkflowEvent(base, { runId: 'run-3', eventType: 'run-settled', payload: { status: 'stopped' }, timestamp: at + 3 });
  assert.equal(canceled[0].status, 'canceled');
});

test('mergeZcodeWorkflowEvent: log 记录最近消息与事件', () => {
  let runs = mergeZcodeWorkflowEvent([], { runId: 'run-1', eventType: 'run-started', payload: {}, timestamp: at });
  runs = mergeZcodeWorkflowEvent(runs, { runId: 'run-1', eventType: 'log', payload: { message: '正在分析依赖' }, timestamp: at + 1 });
  assert.equal(runs[0].lastMessage, '正在分析依赖');
  assert.ok(runs[0].events.some(event => event.message.includes('正在分析依赖')));
});

test('mergeZcodeWorkflowEvent: 多运行最多保留 5 个，最新在前', () => {
  let runs = [];
  for (let index = 0; index < 8; index += 1) {
    runs = mergeZcodeWorkflowEvent(runs, { runId: `run-${index}`, eventType: 'run-started', payload: {}, timestamp: at + index });
  }
  assert.equal(runs.length, ZCODE_WORKFLOW_RUN_LIMIT);
  assert.equal(runs[0].runId, 'run-7');
  assert.equal(runs.at(-1).runId, 'run-3');
});

test('normalizeZcodeWorkflowRuns: 持久化结构回读安全', () => {
  const runs = normalizeZcodeWorkflowRuns([
    { runId: 'run-1', status: 'running', nodes: { 'w@0': { label: 'w@0', status: 'success', updatedAt: new Date(at).toISOString() } }, events: [{ type: 'node-settled', message: 'ok', at: new Date(at).toISOString() }] },
    { runId: '', status: 'running' },
    null,
  ]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].nodes['w@0'].status, 'success');
  assert.equal(runs[0].events.length, 1);
});

test('describeZcodeWorkflowEvent: 未知事件有兜底文案', () => {
  assert.equal(describeZcodeWorkflowEvent({ eventType: 'node-queued', payload: { instance: { siteId: 'worker', ordinal: 2 } } }), '节点排队：worker@2');
  assert.equal(describeZcodeWorkflowEvent({ eventType: 'mystery', payload: {} }), '工作流事件：mystery');
  assert.equal(describeZcodeWorkflowEvent({ eventType: '', payload: {} }), '');
});
