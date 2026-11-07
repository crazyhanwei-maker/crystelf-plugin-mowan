// ZCode 会话控制：目标、检查点与维护命令的归一化/构造。
// 与运行时解耦，便于单测；控制台只消费这里的纯函数，不直接拼上游命令。

export const ZCODE_GOAL_OBJECTIVE_LIMIT = 2000;
export const ZCODE_CHECKPOINT_LIMIT = 50;

export const ZCODE_DEFAULT_MAX_OUTPUT_TOKENS = 32000;

// ZCode 内部 reasoningLevel 的完整取值：enabled = 不注入参数（交给模型/供应商默认），
// disabled = 显式关闭，其余为真实思考强度。顺序同时作为上游模型声明的档位顺序。
export const ZCODE_REASONING_LEVELS = Object.freeze([
  'disabled',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'enabled',
]);

// Anthropic thinking.budget_tokens 映射；实际值会按模型最大输出 Token 封顶
export const ZCODE_ANTHROPIC_THINKING_BUDGETS = Object.freeze({
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
  max: 24576,
});

// 用户侧档位 → 上游 reasoningLevel。空值/默认表示不注入参数；关闭类值统一成 disabled；
// 其余值原样透传（包括模型支持的自定义档位和 Anthropic 的数字预算），绝不折叠成 enabled。
export function resolveZcodeReasoningLevel(variant = '') {
  const value = String(variant || '').trim().toLowerCase();
  if (!value) return 'enabled';
  if (['none', 'off', 'false', '0', 'disabled'].includes(value)) return 'disabled';
  if (['default', 'auto', 'enabled'].includes(value)) return 'enabled';
  return value;
}

// 真实请求参数映射。工具只负责把用户选择的强度原样写进协议字段，是否支持由 API 决定：
// - openai-responses: reasoning.effort
// - openai chat/completions（含 grok）: reasoning_effort
// - anthropic: thinking.{type,budget_tokens}
// enabled 返回空对象 = 不覆盖请求体，由模型默认策略决定。
export function buildZcodeReasoningMap(protocol = 'openai', level = 'enabled', maxOutputTokens = ZCODE_DEFAULT_MAX_OUTPUT_TOKENS) {
  const value = resolveZcodeReasoningLevel(level);
  if (value === 'enabled') return '{}';
  if (normalizeProtocol(protocol) === 'anthropic') {
    if (value === 'disabled') return JSON.stringify({ thinking: { type: 'disabled' } });
    const configuredBudget = /^\d{1,9}$/.test(value)
      ? Number(value)
      : ZCODE_ANTHROPIC_THINKING_BUDGETS[value];
    if (!Number.isFinite(configuredBudget) || configuredBudget <= 0) {
      throw new Error(`Anthropic 不支持思考强度：${level}`);
    }
    const maxTokens = Math.max(1024, Math.round(Number(maxOutputTokens) || ZCODE_DEFAULT_MAX_OUTPUT_TOKENS));
    const budget = Math.max(1024, Math.min(configuredBudget, maxTokens - 1024));
    return JSON.stringify({ thinking: { type: 'enabled', budget_tokens: budget } });
  }
  const effort = value === 'disabled' ? 'none' : value;
  if (normalizeProtocol(protocol) === 'openai-responses') {
    return JSON.stringify({ reasoning: { effort } });
  }
  return JSON.stringify({ reasoning_effort: effort });
}

function normalizeProtocol(value = '') {
  const protocol = String(value || '').trim().toLowerCase();
  if (protocol === 'anthropic' || protocol === 'claude' || protocol === 'messages') return 'anthropic';
  if (protocol === 'openai-responses' || protocol === 'responses' || protocol === 'openai-response' || protocol === 'openai_responses') {
    return 'openai-responses';
  }
  return 'openai';
}

const ZCODE_GOAL_STATUSES = new Set(['active', 'paused', 'budget_limited', 'complete']);

function toNonNegativeInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.trunc(num));
}

function normalizeIso(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

// 上游 target 行可能来自事件（原始 time.created/time.updated）或持久化（createdAt/updatedAt），两种都接
export function normalizeZcodeGoal(target) {
  if (!target || typeof target !== 'object') return null;
  const objective = String(target.objective || '').trim().slice(0, ZCODE_GOAL_OBJECTIVE_LIMIT);
  if (!objective) return null;
  const rawStatus = String(target.status || 'active').trim().toLowerCase();
  const tokenBudget = target.tokenBudget === null || target.tokenBudget === undefined
    ? null
    : toNonNegativeInt(target.tokenBudget);
  return {
    objective,
    status: ZCODE_GOAL_STATUSES.has(rawStatus) ? rawStatus : 'active',
    summaryTitle: String(target.summaryTitle || '').trim().slice(0, 120),
    tokensUsed: toNonNegativeInt(target.tokensUsed),
    tokenBudget,
    timeUsedSeconds: toNonNegativeInt(target.timeUsedSeconds),
    createdAt: normalizeIso(target.time?.created ?? target.createdAt),
    updatedAt: normalizeIso(target.time?.updated ?? target.updatedAt) || new Date().toISOString(),
  };
}

// 目标事件合并：clear 表示目标已删除；其余事件缺 target 时保留旧值（例如仅更新用量）
export function mergeZcodeGoalEvent(current = null, payload = {}) {
  const action = String(payload?.action || '').trim().toLowerCase();
  if (action === 'clear') return null;
  const next = normalizeZcodeGoal(payload?.target);
  return next || current || null;
}

export function normalizeZcodeCheckpoint(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || value.checkpointId || '').trim();
  if (!/^checkpoint_[A-Za-z0-9_-]{1,120}$/.test(id)) return null;
  const createdAt = Number(value.createdAt);
  return {
    id,
    scope: String(value.scope || '').trim().slice(0, 40),
    fileCount: toNonNegativeInt(value.fileCount),
    messageId: String(value.messageId || '').trim().slice(0, 120),
    targetMessageId: String(value.targetMessageId || '').trim().slice(0, 120),
    createdAt: normalizeIso(createdAt) || new Date().toISOString(),
  };
}

// 检查点列表：同一 ID 只保留最新一条，按创建时间倒序（新检查点在前），最多 50 条
export function mergeZcodeCheckpoints(existing = [], incoming = null) {
  const byId = new Map();
  for (const item of [...(Array.isArray(existing) ? existing : []), incoming]) {
    const checkpoint = normalizeZcodeCheckpoint(item);
    if (!checkpoint) continue;
    const previous = byId.get(checkpoint.id);
    if (!previous || String(checkpoint.createdAt) >= String(previous.createdAt)) {
      byId.set(checkpoint.id, checkpoint);
    }
  }
  return Array.from(byId.values())
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, ZCODE_CHECKPOINT_LIMIT);
}

export function normalizeZcodeCheckpointList(value) {
  return mergeZcodeCheckpoints(Array.isArray(value) ? value : [], null);
}

// 目标命令统一走 replace：无目标时等价于 set，有目标时不会在上游触发交互式替换确认（无头下会直接失败）
export function buildZcodeGoalCommand(action = 'set', objective = '') {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (['pause', 'resume', 'clear'].includes(normalizedAction)) return `/goal ${normalizedAction}`;
  if (!['set', 'replace', ''].includes(normalizedAction)) {
    throw new Error('不支持的会话目标操作');
  }
  const text = String(objective || '').trim().slice(0, ZCODE_GOAL_OBJECTIVE_LIMIT);
  if (!text) throw new Error('会话目标不能为空');
  return `/goal replace ${text}`;
}

// 上游 headless 的 /goal 走命令中心，输出的是人类可读文本（不是 stream-json 事件）。
// 这里从响应文本还原目标状态，供控制台在拿不到 target 事件时兜底。
export function parseZcodeGoalCommandResponse(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return undefined;
  if (/^No goal is set/im.test(raw) || /^Goal cleared/im.test(raw)) return null;
  const objective = raw.match(/^Objective:\s*(.+)$/im)?.[1]?.trim();
  if (!objective) return undefined;
  let status = 'active';
  if (/^Goal paused/im.test(raw)) status = 'paused';
  else if (/^Goal complete/im.test(raw)) status = 'complete';
  else if (/^Goal budget_limited/im.test(raw)) status = 'budget_limited';
  const usage = raw.match(/^Usage:\s*(\d+)\s*tokens?\s*\/\s*(.+)$/im);
  const time = raw.match(/^Time:\s*(\d+)\s*seconds?$/im);
  const budgetText = String(usage?.[2] || '').trim().toLowerCase();
  return {
    objective,
    status,
    tokensUsed: usage ? toNonNegativeInt(usage[1]) : 0,
    tokenBudget: usage && budgetText !== 'none' ? toNonNegativeInt(usage[2]) : null,
    timeUsedSeconds: time ? toNonNegativeInt(time[1]) : 0,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeZcodeCheckpointTarget(value = '') {
  const target = String(value || '').trim() || 'latest';
  if (!/^(latest|checkpoint_[A-Za-z0-9_-]{1,120})$/.test(target)) {
    throw new Error('检查点 ID 格式不正确');
  }
  return target;
}

export function buildZcodeCheckpointCommand(action = '', checkpointId = '') {
  const target = normalizeZcodeCheckpointTarget(checkpointId);
  if (action === 'rewind') return `/rewind ${target}`;
  if (action === 'fork') return `/fork ${target}`;
  throw new Error('不支持的检查点操作');
}
