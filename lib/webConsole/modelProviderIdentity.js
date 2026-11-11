// 模型供应商 ID 共享规则：前端与两个 Agent 运行时必须生成完全一致的值。
// OpenCode 运行时只对 providerID 以 "opencode" 开头的模型注入
// x-opencode-session / x-opencode-request / x-opencode-client 请求头；
// OpenCode Zen / Go 现在依赖这些头才能正常计费与鉴权。
// 因此 Zen/Go 渠道使用 opencode-custom-* 前缀，普通自定义渠道继续使用 custom-*。
export function modelProviderSlug(name = '') {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  let hash = 5381;
  for (const ch of String(name || '')) hash = ((hash << 5) + hash + ch.codePointAt(0)) >>> 0;
  return `${slug || 'p'}-${hash.toString(36)}`;
}

export function isOpenCodeZenProvider(provider = {}) {
  const baseApi = typeof provider === 'object' && provider ? provider.baseApi : '';
  return /^https:\/\/opencode\.ai\/zen(?:\/|$)/i.test(String(baseApi || '').trim());
}

export function resolveModelProviderId(provider = {}) {
  const name = typeof provider === 'string' ? provider : provider?.name || '';
  const prefix = isOpenCodeZenProvider(provider) ? 'opencode-custom' : 'custom';
  return `${prefix}-${modelProviderSlug(name)}`.toLowerCase();
}
