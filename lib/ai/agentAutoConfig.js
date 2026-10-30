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
  allowExecute: false,
  executeTimeoutMs: 30 * 60 * 1000,
  executeConfirmTtlMs: 10 * 60 * 1000,
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
    allowExecute: value?.allowExecute === true,
    executeTimeoutMs: clampInteger(value?.executeTimeoutMs, DEFAULT_AGENT_AUTO_CONFIG.executeTimeoutMs, 60 * 1000, 2 * 60 * 60 * 1000),
    executeConfirmTtlMs: clampInteger(value?.executeConfirmTtlMs, DEFAULT_AGENT_AUTO_CONFIG.executeConfirmTtlMs, 60 * 1000, 60 * 60 * 1000),
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

// 明确的本地插件/工作区指代：这类问题应该交给本地 Agent 读代码/日志/配置，
// 而不是联网搜索或凭记忆回答（“当前灵晶插件的版本”曾被 Mandatory Search 截胡）。
const LOCAL_AGENT_QUERY_PATTERN = /(灵晶|crystelf(?:-plugin)?|(?:当前|本|这个|咱们|我们的|本地|服务器上的?)(?:的)?(?:插件|项目|代码|工作区|版本|目录|日志|配置)|插件(?:的)?(?:代码|源码|日志|配置|目录)|工作区|本地(?:的)?(?:代码|仓库|插件|项目|日志|配置|目录)|(?:看看?|查一下|检查一下)(?:日志|报错|配置))/i;
const LOCAL_AGENT_INTENT_PATTERN = /(看|查|找|读|分析|检查|确认|版本|日志|配置|代码|目录|多少|什么|哪|问题|报错|实现|结构)/i;

export function shouldPreferLocalAgent(text = '') {
  return LOCAL_AGENT_QUERY_PATTERN.test(String(text || ''));
}

// 确定性转交条件：有本地指代，且是在询问/查看，不是随口提一句“这个插件真好用”。
export function shouldAutoDelegateLocalAgent(text = '') {
  const value = String(text || '').trim();
  if (!value || /^[#/]/.test(value)) return false;
  if (!shouldPreferLocalAgent(value)) return false;
  return LOCAL_AGENT_INTENT_PATTERN.test(value);
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

export const EXECUTE_CONFIRM_PATTERN = /^(执行|执行吧|按计划执行|开始执行|继续执行|确认执行|确认|同意|开始|go)[。.!！]?$/i;
export const EXECUTE_CANCEL_PATTERN = /^(取消|算了|不执行|放弃|退出执行)[。.!！]?$/i;

export function isExecuteConfirmation(text = '') {
  return EXECUTE_CONFIRM_PATTERN.test(String(text || '').trim());
}

export function isExecuteCancel(text = '') {
  return EXECUTE_CANCEL_PATTERN.test(String(text || '').trim());
}

// 待执行计划/待确认执行的短期状态：确认必须由主人下一条真实消息触发，
// 到点自动失效；consume 只在精确匹配“执行/取消”时清除，其他消息保留状态。
export function createAgentAutoPendingStore({ now = () => Date.now() } = {}) {
  const pending = new Map();

  function prune(key, ttlMs) {
    const entry = pending.get(key);
    if (!entry) return null;
    const expiresAt = Number(entry.expiresAt || 0)
      || (Number(entry.createdAt || 0) + Number(ttlMs || DEFAULT_AGENT_AUTO_CONFIG.executeConfirmTtlMs));
    if (expiresAt <= now()) {
      pending.delete(key);
      return { expired: true };
    }
    return entry;
  }

  function remember(key, entry = {}, ttlMs = DEFAULT_AGENT_AUTO_CONFIG.executeConfirmTtlMs) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || !entry || typeof entry !== 'object') return false;
    const createdAt = now();
    pending.set(normalizedKey, {
      ...entry,
      createdAt,
      expiresAt: createdAt + Math.max(60000, Number(ttlMs) || DEFAULT_AGENT_AUTO_CONFIG.executeConfirmTtlMs),
    });
    return true;
  }

  function peek(key, ttlMs = DEFAULT_AGENT_AUTO_CONFIG.executeConfirmTtlMs) {
    const result = prune(String(key || '').trim(), ttlMs);
    if (!result || result.expired) return null;
    return result;
  }

  function consume(key, text = '', ttlMs = DEFAULT_AGENT_AUTO_CONFIG.executeConfirmTtlMs) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return null;
    const entry = prune(normalizedKey, ttlMs);
    if (!entry) return null;
    if (entry.expired) {
      // 过期后只有“执行/取消”才提示失效；普通聊天不拦截
      return (isExecuteConfirmation(text) || isExecuteCancel(text)) ? { status: 'expired' } : null;
    }
    if (isExecuteCancel(text)) {
      pending.delete(normalizedKey);
      return { status: 'cancelled', entry };
    }
    if (isExecuteConfirmation(text)) {
      pending.delete(normalizedKey);
      return { status: 'confirmed', entry };
    }
    return { status: 'pending', entry };
  }

  function clear(key) {
    pending.delete(String(key || '').trim());
  }

  function clearAll() {
    pending.clear();
  }

  return {
    remember,
    peek,
    consume,
    clear,
    clearAll,
    get size() { return pending.size; },
  };
}
