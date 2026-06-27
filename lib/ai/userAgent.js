import Version from '../system/version.js';

const MAX_USER_AGENT_LENGTH = 200;

export function normalizeAiUserAgent(value = '') {
  return String(value || '')
    .replace(/[\r\n\t\0-\x1F\x7F]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_USER_AGENT_LENGTH);
}

export function getDefaultAiUserAgent() {
  const name = normalizeAiUserAgent(Version.name || 'crystelf-plugin') || 'crystelf-plugin';
  const version = normalizeAiUserAgent(Version.ver || '0.0.0') || '0.0.0';
  return `${name}/${version}`;
}

export function resolveAiUserAgent(config = {}) {
  return normalizeAiUserAgent(config?.userAgent) || getDefaultAiUserAgent();
}

export function buildAiUserAgentHeaders(config = {}) {
  const userAgent = resolveAiUserAgent(config);
  return userAgent ? { 'User-Agent': userAgent } : {};
}

export function validateAiUserAgent(value = '') {
  const raw = String(value || '');
  if (/[\r\n]/.test(raw)) {
    return { ok: false, error: 'User-Agent 不能包含换行。' };
  }
  if (raw.length > MAX_USER_AGENT_LENGTH) {
    return { ok: false, error: `User-Agent 不能超过 ${MAX_USER_AGENT_LENGTH} 个字符。` };
  }
  return { ok: true, value: normalizeAiUserAgent(raw) };
}
