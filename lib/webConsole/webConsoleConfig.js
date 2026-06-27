export function buildOpenAiCompatibleUrl(baseApi = '', pathSuffix = '') {
  const base = String(baseApi || '').trim().replace(/\/+$/, '');
  const suffix = `/${String(pathSuffix || '').trim().replace(/^\/+/, '')}`;
  if (base.toLowerCase().endsWith('/v1') && suffix.startsWith('/v1/')) {
    return base + suffix.slice(3);
  }
  return base + suffix;
}

export function getPricingConfig(allConfigs = {}) {
  return allConfigs?.coreConfig?.usageControl
    ? {
        enabled: allConfigs.coreConfig.usageControl.pricingEnabled !== false,
        currencySymbol: allConfigs.coreConfig.usageControl.currencySymbol || '$',
        promptPricePer1M: Number(allConfigs.coreConfig.usageControl.promptPricePer1M || 0),
        completionPricePer1M: Number(allConfigs.coreConfig.usageControl.completionPricePer1M || 0),
        modelPricing: allConfigs.coreConfig.usageControl.modelPricing || '',
      }
    : {};
}

export function normalizeWebConsoleHost(value = '', fallback = '0.0.0.0') {
  let host = String(value || '').trim();
  if (!host) return fallback;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1).trim();
  }
  return host || fallback;
}

export function formatWebConsoleHostForUrl(value = '') {
  const host = normalizeWebConsoleHost(value);
  if (host === '0.0.0.0') return '127.0.0.1';
  if (host === '::') return '[::1]';
  if (host.includes(':')) return `[${host}]`;
  return host;
}

export function buildWebConsoleConfig(config = {}, options = {}) {
  const getBackgroundSourceUrl = typeof options.getBackgroundSourceUrl === 'function'
    ? options.getBackgroundSourceUrl
    : (() => '');

  return {
    enabled: config.webConsole !== false,
    authToken: String(config.webConsoleToken || '').trim(),
    readOnly: config.webConsoleReadOnly === true,
    host: normalizeWebConsoleHost(config.webConsoleHost || '0.0.0.0'),
    publicUrl: String(config.webConsolePublicUrl || '').trim(),
    port: Math.min(65535, Math.max(1, Number(config.webConsolePort || 27891))),
    portAutoIncrement: config.webConsolePortAutoIncrement === true,
    pageSize: Math.max(1, Number(config.webConsolePageSize || 20)),
    maxPageSize: Math.max(1, Number(config.webConsoleMaxPageSize || 100)),
    exposeLogs: config.webConsoleExposeLogs !== false,
    logTailLength: Math.max(1000, Number(config.webConsoleLogTailLength || 12000)),
    maskSensitiveConfig: config.webConsoleMaskSensitiveConfig !== false,
    profileRecentMessagesLimit: Math.max(0, Number(config.webConsoleProfileRecentMessagesLimit || 20)),
    affinityHistoryLimit: Math.max(1, Number(config.webConsoleAffinityHistoryLimit || 50)),
    backgroundSourceUrl: getBackgroundSourceUrl(),
  };
}

export function getWebConsoleDisplayUrl(config = {}) {
  const host = formatWebConsoleHostForUrl(config.host || '0.0.0.0');
  const port = Number(config.port) || 27891;
  return `http://${host}:${port}/`;
}

export function createPaginator(options = {}) {
  const getMaxPageSize = typeof options.getMaxPageSize === 'function'
    ? options.getMaxPageSize
    : (() => 100);

  function paginateItems(items = [], page = 1, pageSize = 20) {
    const list = Array.isArray(items) ? items : [];
    const maxPageSize = Math.max(1, Number(getMaxPageSize()) || 100);
    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.min(maxPageSize, Math.max(1, Number(pageSize || 20)));
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const start = (safePage - 1) * safePageSize;
    return {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages,
      items: list.slice(start, start + safePageSize),
    };
  }

  return {
    paginateItems,
  };
}
