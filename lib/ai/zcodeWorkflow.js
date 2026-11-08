// ZCode 动态工作流进度：把 stream-json 的 workflow.run.progress 事件归并成任务卡片可消费的结构。
// 事件形态（上游 headless-workflow.ts）：
// { runId, eventType, payload: { status?, stopReason?, error?, message?, instance?: {siteId, ordinal}, outcome? } }
export const ZCODE_WORKFLOW_RUN_LIMIT = 5;
export const ZCODE_WORKFLOW_EVENT_LIMIT = 30;
export const ZCODE_WORKFLOW_NODE_LIMIT = 40;

function normalizeText(value, limit = 500) {
  return String(value ?? '').trim().slice(0, limit);
}

function instanceLabel(payload = {}) {
  const siteId = normalizeText(payload?.instance?.siteId, 120);
  if (!siteId) return '';
  const ordinal = Number(payload?.instance?.ordinal);
  return Number.isFinite(ordinal) ? `${siteId}@${ordinal}` : siteId;
}

function mapRunStatus(payload = {}) {
  const raw = String(payload.status || '').trim().toLowerCase();
  if (['completed', 'complete', 'success', 'succeeded', 'done'].includes(raw)) return 'success';
  if (['failed', 'failure', 'error'].includes(raw)) return 'error';
  if (['cancelled', 'canceled', 'stopped', 'aborted', 'interrupted'].includes(raw)) return 'canceled';
  if (['partial', 'incomplete'].includes(raw)) return 'warning';
  return 'settled';
}

export function describeZcodeWorkflowEvent(event = {}) {
  const type = String(event.eventType || '').trim();
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const label = instanceLabel(payload);
  if (type === 'run-started') return '工作流开始';
  if (type === 'run-settled') {
    const status = mapRunStatus(payload);
    const error = normalizeText(payload?.error?.message, 300);
    const stop = normalizeText(payload.stopReason, 80);
    return `${status === 'success' ? '工作流完成' : status === 'error' ? '工作流失败' : '工作流结束'}${stop ? `（${stop}）` : ''}${error ? `：${error}` : ''}`;
  }
  if (type === 'log') {
    const message = normalizeText(payload.message, 300);
    return message ? `日志：${message}` : '';
  }
  if (type === 'node-queued') return label ? `节点排队：${label}` : '';
  if (type === 'node-dispatched') return label ? `节点启动：${label}` : '';
  if (type === 'node-repairing') return label ? `节点修复：${label}` : '';
  if (type === 'node-nudged') return label ? `节点催促：${label}` : '';
  if (type === 'node-settled') {
    const outcome = normalizeText(payload.outcome, 80) || 'settled';
    return label ? `节点完成：${label}（${outcome}）` : `节点完成（${outcome}）`;
  }
  if (type === 'concurrency-changed') return '并发现状更新';
  return type ? `工作流事件：${type}` : '';
}

function normalizeEvent(value = {}) {
  const event = value && typeof value === 'object' ? value : {};
  const type = normalizeText(event.type || event.eventType, 80);
  const message = normalizeText(event.message, 500);
  const at = normalizeText(event.at, 40);
  if (!type && !message) return null;
  return { type, message, at };
}

function normalizeNode(value = {}, fallbackLabel = '') {
  const node = value && typeof value === 'object' ? value : {};
  const label = normalizeText(node.label || fallbackLabel, 160);
  if (!label) return null;
  return {
    label,
    status: normalizeText(node.status, 40) || 'running',
    updatedAt: normalizeText(node.updatedAt, 40),
  };
}

export function normalizeZcodeWorkflowRuns(value = []) {
  return (Array.isArray(value) ? value : [])
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const runId = normalizeText(item.runId, 160);
      if (!runId) return null;
      const nodes = Object.create(null);
      for (const nodeValue of Object.values(item.nodes && typeof item.nodes === 'object' ? item.nodes : {})) {
        const node = normalizeNode(nodeValue);
        if (node) nodes[node.label] = node;
        if (Object.keys(nodes).length >= ZCODE_WORKFLOW_NODE_LIMIT) break;
      }
      const events = (Array.isArray(item.events) ? item.events : [])
        .map(normalizeEvent)
        .filter(Boolean)
        .slice(-ZCODE_WORKFLOW_EVENT_LIMIT);
      return {
        runId,
        status: normalizeText(item.status, 40) || 'running',
        startedAt: normalizeText(item.startedAt, 40),
        settledAt: normalizeText(item.settledAt, 40),
        lastEventType: normalizeText(item.lastEventType, 80),
        lastEvent: normalizeText(item.lastEvent, 500),
        lastMessage: normalizeText(item.lastMessage, 500),
        nodes,
        events,
      };
    })
    .filter(Boolean)
    .slice(0, ZCODE_WORKFLOW_RUN_LIMIT);
}

export function mergeZcodeWorkflowEvent(runs = [], event = {}) {
  const normalizedRuns = normalizeZcodeWorkflowRuns(runs);
  const runId = normalizeText(event?.runId, 160);
  if (!runId) return normalizedRuns;
  const eventType = normalizeText(event?.eventType, 80);
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const at = new Date(Number(event?.timestamp) || Date.now()).toISOString();
  const description = describeZcodeWorkflowEvent({ eventType, payload });
  const existingIndex = normalizedRuns.findIndex(item => item.runId === runId);
  const run = existingIndex >= 0
    ? { ...normalizedRuns[existingIndex], nodes: Object.assign(Object.create(null), normalizedRuns[existingIndex].nodes) }
    : { runId, status: 'running', startedAt: at, settledAt: '', lastEventType: '', lastEvent: '', lastMessage: '', nodes: Object.create(null), events: [] };
  if (eventType === 'run-started') {
    run.status = 'running';
    run.startedAt = at;
  } else if (eventType === 'run-settled') {
    run.status = mapRunStatus(payload);
    run.settledAt = at;
  } else if (eventType === 'log') {
    run.lastMessage = normalizeText(payload.message, 500);
  }
  const label = instanceLabel(payload);
  if (label && /^node-/.test(eventType)) {
    const current = run.nodes[label] || {};
    const outcome = normalizeText(payload.outcome, 40).toLowerCase();
    // node-settled 的 outcome 可能是 cached/skipped 等非失败值，统一算作已完成；
    // 只有明确的 failed/error 才计入失败。
    const status = eventType === 'node-settled'
      ? (['failed', 'failure', 'error'].includes(outcome) ? 'failed' : 'success')
      : 'running';
    run.nodes[label] = { label, status, updatedAt: at };
    const nodeKeys = Object.keys(run.nodes);
    if (nodeKeys.length > ZCODE_WORKFLOW_NODE_LIMIT) {
      for (const key of nodeKeys.slice(0, nodeKeys.length - ZCODE_WORKFLOW_NODE_LIMIT)) delete run.nodes[key];
    }
  }
  if (description) {
    run.lastEventType = eventType;
    run.lastEvent = description;
    run.events = [...(run.events || []), { type: eventType, message: description, at }].slice(-ZCODE_WORKFLOW_EVENT_LIMIT);
  }
  if (existingIndex >= 0) normalizedRuns[existingIndex] = run;
  else normalizedRuns.unshift(run);
  return normalizedRuns.slice(0, ZCODE_WORKFLOW_RUN_LIMIT);
}

export function zcodeWorkflowNodeProgress(run = {}) {
  const nodes = Object.values(run?.nodes && typeof run.nodes === 'object' ? run.nodes : {});
  const total = nodes.length;
  const done = nodes.filter(node => {
    const status = String(node?.status || '').toLowerCase();
    return status === 'success' || status === 'completed' || status === 'failed' || status === 'error';
  }).length;
  return { total, done };
}
