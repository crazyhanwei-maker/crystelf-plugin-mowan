// 戳一戳上下文选择：与 Yunzai 运行时解耦，便于单测。
// live=只读实时群消息；session=只读会话数据库（与群聊 AI 同一 session）；hybrid=两者合并去重。

export const POKE_CONTEXT_SOURCES = ['live', 'session', 'hybrid'];

export const POKE_CONTEXT_DEFAULTS = {
  source: 'live',
  messageLimit: 6,
  lineLimit: 3,
};

export const POKE_CONTEXT_LIMITS = {
  messageLimit: 30,
  lineLimit: 10,
};

function clampInt(value, min, max, fallback) {
  // null / '' 视为未配置：Number(null) 是 0，不能当成“显式填了 0”
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

export function resolvePokeContextConfig(pokeConfig = {}) {
  const source = POKE_CONTEXT_SOURCES.includes(String(pokeConfig.contextSource || ''))
    ? String(pokeConfig.contextSource)
    : POKE_CONTEXT_DEFAULTS.source;
  const messageLimit = clampInt(
    pokeConfig.contextMessageLimit,
    0,
    POKE_CONTEXT_LIMITS.messageLimit,
    POKE_CONTEXT_DEFAULTS.messageLimit,
  );
  const configuredLines = clampInt(
    pokeConfig.contextLines,
    0,
    POKE_CONTEXT_LIMITS.lineLimit,
    POKE_CONTEXT_DEFAULTS.lineLimit,
  );
  return {
    source,
    messageLimit,
    // 不读取任何素材时，注入条数必然为 0，避免返回自相矛盾的配置
    lineLimit: messageLimit === 0 ? 0 : configuredLines,
  };
}

export function needsLiveHistory(source) {
  return source === 'live' || source === 'hybrid';
}

export function needsSessionHistory(source) {
  return source === 'session' || source === 'hybrid';
}

function normalizeContent(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// 合并两路历史：按时间排序、去掉机器人自己、按内容+发言人去重，保留最近 lineLimit 条。
export function mergePokeContextHistory({ sessionHistory = [], liveHistory = [], selfId = '', lineLimit = 3 } = {}) {
  const all = [...sessionHistory, ...liveHistory]
    .filter(item => item && item.userId && String(item.userId) !== String(selfId))
    .map(item => ({ ...item, time: normalizePokeTimestamp(item.time) }))
    .sort((a, b) => a.time - b.time);
  if (lineLimit <= 0) return [];
  const deduped = [];
  const seen = new Set();
  for (const item of all) {
    const key = `${String(item.userId)}|${normalizeContent(item.text)}`;
    // 纯图片消息没有文本，不去重，避免把不同图片当成同一条
    if (item.text && seen.has(key)) continue;
    if (item.text) seen.add(key);
    deduped.push(item);
  }
  return deduped.slice(-lineLimit);
}

export function formatPokeContextLine(item = {}) {
  const nickname = item.nickname || `QQ${item.userId || '未知'}`;
  const text = String(item.text || '').trim();
  if (text) return `${nickname}：${text}`;
  const hasImage = Array.isArray(item.imageUrls) && item.imageUrls.length > 0;
  return `${nickname}：${hasImage ? '[发了一张图片]' : '[无文本内容]'}`;
}

export function describePokeContextSource(source) {
  if (source === 'session') return '会话记录';
  if (source === 'hybrid') return '会话与实时消息';
  return '实时群消息';
}

// 实时消息的 time 是秒级，会话库的 timestamp 是毫秒级；合并排序前必须统一成毫秒，
// 否则会话消息会被整体误判成“更晚”，取最近 N 条就取错。
export function normalizePokeTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  // 1e12 以上视为已经是毫秒（约 2001 年后）；秒级时间戳最大约 1e10
  return num > 1e11 ? Math.trunc(num) : Math.trunc(num * 1000);
}
