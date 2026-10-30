// 聊天 AI 自动 Agent 的纯配置/权限/限流逻辑。
// 不依赖工作台或桥，便于单测；真正的任务提交在 agentAutoTask.js。

export const DEFAULT_AGENT_AUTO_CONFIG = Object.freeze({
  enabled: false,
  allowPrivate: true,
  allowedGroups: [],
  maxPerHour: 5,
  maxConcurrent: 1,
  timeoutMs: 10 * 60 * 1000,
  maxResultChars: 1200,
  saveToHistory: true,
  showProgress: false,
});

const HOUR_MS = 60 * 60 * 1000;
const DEDUP_WINDOW_MS = 30 * 1000;

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

export function normalizeAgentAutoConfig(value = {}) {
  const rawGroups = Array.isArray(value?.allowedGroups) ? value.allowedGroups : [];
  const allowedGroups = Array.from(new Set(
    rawGroups
      .map(item => String(item ?? '').trim())
      .filter(Boolean)
      .map(item => (/^(all|所有群|\*)$/i.test(item) ? '*' : item)),
  )).slice(0, 100);

  return {
    enabled: value?.enabled === true,
    allowPrivate: value?.allowPrivate !== false,
    allowedGroups,
    maxPerHour: clampInteger(value?.maxPerHour, DEFAULT_AGENT_AUTO_CONFIG.maxPerHour, 1, 60),
    maxConcurrent: clampInteger(value?.maxConcurrent, DEFAULT_AGENT_AUTO_CONFIG.maxConcurrent, 1, 3),
    timeoutMs: clampInteger(value?.timeoutMs, DEFAULT_AGENT_AUTO_CONFIG.timeoutMs, 60 * 1000, 30 * 60 * 1000),
    maxResultChars: clampInteger(value?.maxResultChars, DEFAULT_AGENT_AUTO_CONFIG.maxResultChars, 200, 4000),
    saveToHistory: value?.saveToHistory !== false,
    showProgress: value?.showProgress === true,
  };
}

export function getEventUserId(event = {}) {
  return String(event?.user_id ?? event?.sender?.user_id ?? event?.userId ?? '').trim();
}

// 与 botLogDiagnosisTool 的判定保持一致：框架标记优先，masterQQ 兜底
export function isMasterForAgent(toolCtx = {}, pluginConfig = {}) {
  if (toolCtx?.isMaster === true) return true;
  const event = toolCtx?.event;
  if (!event || typeof event !== 'object') return false;
  if (event.isMaster === true) return true;
  const userId = getEventUserId(event) || String(toolCtx?.userId || '').trim();
  if (!userId) return false;
  const masterQQ = Array.isArray(pluginConfig?.masterQQ) ? pluginConfig.masterQQ : [];
  return masterQQ.some(item => String(item ?? '').trim() === userId);
}

export function isGroupAllowed(groupId = '', config = DEFAULT_AGENT_AUTO_CONFIG) {
  const groups = Array.isArray(config?.allowedGroups) ? config.allowedGroups : [];
  if (groups.includes('*')) return true;
  const normalized = String(groupId || '').trim();
  return Boolean(normalized && groups.includes(normalized));
}

export function isChannelAllowed(toolCtx = {}, config = DEFAULT_AGENT_AUTO_CONFIG) {
  const event = toolCtx?.event;
  if (!event || typeof event !== 'object') return false;
  if (event.crystelfSynthetic === true || event.crystelfCommandBridge === true) return false;
  const groupId = String(toolCtx?.groupId || event.group_id || '').trim();
  if (groupId) return isGroupAllowed(groupId, config);
  return config?.allowPrivate === true;
}

// 只读结果也可能包含配置里的 Key，回推聊天前做一层保守掩码
export function maskAgentSecrets(text = '') {
  return String(text || '')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/gi, '$1***')
    .replace(
      /((?:api[_-]?key|apikey|token|secret|password|passwd)\s*[:=]\s*)(["']?)([^\s"',;}\]]{4,})/gi,
      '$1$2***',
    )
    .replace(
      /(["']?(?:api[_-]?key|apikey|token|secret|password|passwd)["']?\s*:\s*["'])([^"']{4,})(["'])/gi,
      '$1***$3',
    );
}

export function truncateAgentResult(text = '', maxChars = DEFAULT_AGENT_AUTO_CONFIG.maxResultChars) {
  const limit = clampInteger(maxChars, DEFAULT_AGENT_AUTO_CONFIG.maxResultChars, 200, 4000);
  const value = String(text || '');
  if (value.length <= limit) return { text: value, truncated: false };
  return { text: value.slice(0, limit).trimEnd(), truncated: true };
}

// 会话级限流/并发/去重：begin 先占位，提交成功后 markSubmitted 才计入每小时配额，
// 提交失败时 release 不会吃掉配额。
export function createAgentAutoGuard({ now = () => Date.now() } = {}) {
  const active = new Map();
  const rate = new Map();
  const seen = new Map();

  function pruneRate(sessionKey) {
    const cutoff = now() - HOUR_MS;
    const list = (rate.get(sessionKey) || []).filter(timestamp => timestamp > cutoff);
    if (list.length > 0) rate.set(sessionKey, list);
    else rate.delete(sessionKey);
    return list;
  }

  function begin(sessionKey, config = DEFAULT_AGENT_AUTO_CONFIG, dedupKey = '') {
    const key = String(sessionKey || '').trim();
    if (!key) return { ok: false, error: '缺少会话标识' };
    if (active.has(key)) {
      const current = active.get(key);
      // 同一触发消息被多个 Bot 实例同时处理时，让后来的那一路静默退出，避免重复提示
      if (dedupKey && current?.dedupKey === dedupKey) {
        return { ok: false, duplicate: true, error: '当前会话已有自动 Agent 任务在执行' };
      }
      return { ok: false, error: '当前会话已有自动 Agent 任务在执行，等它结束再试' };
    }
    if (active.size >= config.maxConcurrent) {
      return { ok: false, error: `自动 Agent 任务并发已满（${config.maxConcurrent} 个），请稍后再试` };
    }
    const list = pruneRate(key);
    if (list.length >= config.maxPerHour) {
      return { ok: false, error: `本小时自动 Agent 任务已达上限（${config.maxPerHour} 次），请稍后再试` };
    }
    active.set(key, { startedAt: now(), taskId: '', dedupKey: String(dedupKey || '') });
    return { ok: true };
  }

  function markSubmitted(sessionKey, taskId = '') {
    const key = String(sessionKey || '').trim();
    if (!key) return;
    const entry = active.get(key);
    if (entry) entry.taskId = String(taskId || '');
    const list = pruneRate(key);
    list.push(now());
    rate.set(key, list);
  }

  function release(sessionKey) {
    active.delete(String(sessionKey || '').trim());
  }

  function getActive(sessionKey) {
    return active.get(String(sessionKey || '').trim()) || null;
  }

  function seenRecently(dedupKey, windowMs = DEDUP_WINDOW_MS) {
    const key = String(dedupKey || '').trim();
    if (!key) return false;
    const at = seen.get(key);
    if (!at) return false;
    if (now() - at > windowMs) {
      seen.delete(key);
      return false;
    }
    return true;
  }

  function remember(dedupKey, windowMs = DEDUP_WINDOW_MS) {
    const key = String(dedupKey || '').trim();
    if (!key) return;
    const cutoff = now() - windowMs;
    for (const [itemKey, timestamp] of seen) {
      if (timestamp <= cutoff) seen.delete(itemKey);
    }
    seen.set(key, now());
  }

  function clear() {
    active.clear();
    rate.clear();
    seen.clear();
  }

  return {
    begin,
    markSubmitted,
    release,
    getActive,
    seenRecently,
    remember,
    clear,
    get activeCount() { return active.size; },
  };
}
