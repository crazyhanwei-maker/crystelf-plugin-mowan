function cleanString(value = '') {
  return String(value || '').trim();
}

function normalizeBaseUrl(value = '') {
  return cleanString(value).replace(/\/+$/, '');
}

function normalizePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function isEnabled(config = {}) {
  return config?.enabled === true;
}

function dedupe(values = []) {
  return Array.from(new Set(values.map(item => cleanString(item)).filter(Boolean)));
}

export function shouldRetryWithFallback(result = null) {
  if (!result) return true;
  if (result.success === false) return true;
  if (result.ok === false) return true;
  if (typeof result.content === 'string' && !result.content.trim()) return true;
  if (typeof result.response === 'string' && !result.response.trim()) return true;
  return false;
}

export function buildAiFallbackConfig(config = {}) {
  const fallback = config?.fallbackApi || {};
  if (!isEnabled(fallback)) {
    return null;
  }

  const baseApi = cleanString(fallback.baseApi);
  const apiKey = cleanString(fallback.apiKey);
  const modelType = cleanString(fallback.modelType || fallback.workingModel || config.modelType || config.workingModel || config.model);
  if (!baseApi || !apiKey || !modelType) {
    return null;
  }

  return {
    ...config,
    baseApi,
    apiKey,
    modelType,
    workingModel: cleanString(fallback.workingModel || fallback.modelType || modelType),
    multimodalModel: cleanString(fallback.multimodalModel || fallback.modelType || fallback.workingModel || modelType),
    timeout: normalizePositiveNumber(fallback.timeout, normalizePositiveNumber(config.timeout, 60000)),
    __fallbackApi: true,
  };
}

export function buildImageFallbackConfig(mergedImageConfig = {}) {
  const fallback = mergedImageConfig?.fallbackApi || {};
  if (!isEnabled(fallback)) {
    return null;
  }

  const imageMode = cleanString(fallback.imageMode || mergedImageConfig.imageMode || 'openai');
  const next = {
    ...mergedImageConfig,
    imageMode,
    model: cleanString(fallback.model || mergedImageConfig.model),
    baseApi: normalizeBaseUrl(fallback.baseApi || ''),
    jimengApiUrl: normalizeBaseUrl(fallback.jimengApiUrl || ''),
    apiKey: cleanString(fallback.apiKey || ''),
    __fallbackApi: true,
  };

  if (imageMode === 'jimeng') {
    return next.jimengApiUrl ? next : null;
  }

  if (!next.baseApi || !next.apiKey || !next.model) {
    return null;
  }
  return next;
}

export function buildImageMonitorFallbackConfig(config = {}) {
  const fallback = config?.fallbackApi || {};
  if (!isEnabled(fallback)) {
    return null;
  }

  const next = {
    ...config,
    apiBase: normalizeBaseUrl(fallback.apiBase || ''),
    apiKey: cleanString(fallback.apiKey || ''),
    model: cleanString(fallback.model || ''),
    __fallbackApi: true,
  };

  if (!next.apiBase || !next.apiKey || !next.model) {
    return null;
  }
  return next;
}

export function hasImageMonitorApiConfig(config = {}) {
  return Boolean(cleanString(config.apiBase) && cleanString(config.apiKey) && cleanString(config.model));
}

export function buildSearchFallbackConfig(searchConfig = {}, capability = 'all') {
  const fallback = searchConfig?.fallbackApi || {};
  if (!isEnabled(fallback)) {
    return null;
  }

  const next = {
    ...searchConfig,
    apiUrl: cleanString(fallback.apiUrl || ''),
    markdownApiUrl: cleanString(fallback.markdownApiUrl || ''),
    markdownStatusUrl: cleanString(fallback.markdownStatusUrl || ''),
    apiKey: cleanString(fallback.apiKey || ''),
    __fallbackApi: true,
  };

  if (capability === 'search') {
    return next.apiUrl ? next : null;
  }

  if (capability === 'markdown') {
    return next.markdownApiUrl && next.markdownStatusUrl ? next : null;
  }

  return next.apiUrl || (next.markdownApiUrl && next.markdownStatusUrl) ? next : null;
}

export function getMemeApiBases(memeConfig = {}) {
  const primary = normalizeBaseUrl(memeConfig.apiBase || 'http://38.22.95.201:5555');
  const fallback = memeConfig?.fallbackApi || {};
  return dedupe([
    primary,
    isEnabled(fallback) ? normalizeBaseUrl(fallback.apiBase || '') : '',
  ]);
}
