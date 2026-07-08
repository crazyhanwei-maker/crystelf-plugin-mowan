import crypto from 'crypto';
import { classifyAiUsageError, formatAiUsageErrorCategory } from './usageLogger.js';

const CIRCUIT_BREAKER_DEFAULTS = {
  failureThreshold: 2,
  cooldownMs: 5 * 60 * 1000,
  maxCooldownMs: 30 * 60 * 1000,
};

const apiCircuitStates = new Map();

function cleanString(value = '') {
  return String(value || '').trim();
}

function normalizeScene(scene = '') {
  return cleanString(scene || 'chat').replace(/_fallback$/i, '') || 'chat';
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function hasFallbackConfig(config = {}) {
  if (config?.__hasFallbackApi === true) {
    return true;
  }
  const fallback = config?.fallbackApi || {};
  const type = cleanString(config?.__apiCircuitType || config?.apiCircuitType || '');
  if (fallback.enabled !== true) {
    return false;
  }
  if (type === 'image') {
    const imageMode = cleanString(fallback.imageMode || config.imageMode || 'openai');
    if (imageMode === 'jimeng') {
      return Boolean(cleanString(fallback.jimengApiUrl));
    }
    return Boolean(cleanString(fallback.baseApi))
      && Boolean(cleanString(fallback.apiKey))
      && Boolean(cleanString(fallback.model || config.model));
  }
  if (type === 'image_monitor') {
    return Boolean(cleanString(fallback.apiBase))
      && Boolean(cleanString(fallback.apiKey))
      && Boolean(cleanString(fallback.model || config.model));
  }
  if (type === 'search') {
    return Boolean(cleanString(fallback.apiUrl));
  }
  if (type === 'markdown') {
    return Boolean(cleanString(fallback.markdownApiUrl) && cleanString(fallback.markdownStatusUrl));
  }
  if (type === 'meme') {
    return Boolean(cleanString(fallback.apiBase));
  }
  if (type === 'tts') {
    return Boolean(cleanString(fallback.apiUrl || fallback.modelsUrl));
  }
  return fallback.enabled === true
    && Boolean(cleanString(fallback.baseApi))
    && Boolean(cleanString(fallback.apiKey))
    && Boolean(cleanString(fallback.modelType || fallback.workingModel || config.modelType || config.workingModel || config.model));
}

function resolveCircuitPolicy(config = {}) {
  const fallback = config?.fallbackApi || {};
  const breaker = fallback.circuitBreaker || fallback.autoSwitch || {};
  return {
    enabled: fallback.autoSwitchEnabled !== false && breaker.enabled !== false,
    failureThreshold: clampNumber(
      breaker.failureThreshold ?? fallback.failureThreshold,
      1,
      10,
      CIRCUIT_BREAKER_DEFAULTS.failureThreshold,
    ),
    cooldownMs: clampNumber(
      breaker.cooldownMs ?? fallback.cooldownMs,
      30 * 1000,
      CIRCUIT_BREAKER_DEFAULTS.maxCooldownMs,
      CIRCUIT_BREAKER_DEFAULTS.cooldownMs,
    ),
  };
}

function buildCircuitKey(config = {}, scene = 'chat') {
  return [
    cleanString(config?.__apiCircuitType || config?.apiCircuitType || ''),
    normalizeScene(scene),
    cleanString(config.baseApi || config.apiBase || config.apiUrl || config.markdownApiUrl || config.modelsUrl),
    cleanString(config.modelType || config.workingModel || config.model || config.defaultModel),
    cleanString(config?.fallbackApi?.baseApi || config?.fallbackApi?.apiBase || config?.fallbackApi?.apiUrl || config?.fallbackApi?.markdownApiUrl || config?.fallbackApi?.modelsUrl),
    cleanString(config?.fallbackApi?.modelType || config?.fallbackApi?.workingModel || config?.fallbackApi?.model || config?.fallbackApi?.defaultModel),
  ].join('::');
}

function buildCircuitId(key = '') {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex').slice(0, 16);
}

function getState(key = '') {
  if (!apiCircuitStates.has(key)) {
    apiCircuitStates.set(key, {
      key,
      scene: '',
      status: 'closed',
      consecutivePrimaryFailures: 0,
      fallbackSuccessCount: 0,
      fallbackFailureCount: 0,
      openedAt: 0,
      openUntil: 0,
      lastPrimaryFailureAt: 0,
      lastPrimarySuccessAt: 0,
      lastFallbackSuccessAt: 0,
      lastFallbackFailureAt: 0,
      lastError: '',
      lastErrorCategory: '',
      lastErrorCategoryLabel: '',
    });
  }
  return apiCircuitStates.get(key);
}

function normalizeErrorText(error = '') {
  if (!error) return '';
  return cleanString(error?.message || error);
}

function isCircuitAvailable(config = {}) {
  const policy = resolveCircuitPolicy(config);
  return policy.enabled && hasFallbackConfig(config);
}

export function shouldPreferFallbackApi(config = {}, scene = 'chat') {
  if (!isCircuitAvailable(config)) {
    return { preferFallback: false, reason: 'fallback_disabled' };
  }
  const key = buildCircuitKey(config, scene);
  const state = getState(key);
  const now = Date.now();
  if (state.openUntil > now) {
    state.status = 'open';
    return {
      preferFallback: true,
      reason: 'primary_circuit_open',
      openUntil: state.openUntil,
      consecutivePrimaryFailures: state.consecutivePrimaryFailures,
    };
  }
  if (state.status === 'open' && state.openUntil <= now) {
    state.status = 'half_open';
  }
  return {
    preferFallback: false,
    reason: state.status === 'half_open' ? 'primary_probe_due' : 'primary_available',
    openUntil: state.openUntil,
    consecutivePrimaryFailures: state.consecutivePrimaryFailures,
  };
}

export function recordPrimaryApiSuccess(config = {}, scene = 'chat') {
  if (!isCircuitAvailable(config)) return;
  const key = buildCircuitKey(config, scene);
  const state = getState(key);
  state.scene = normalizeScene(scene);
  state.status = 'closed';
  state.consecutivePrimaryFailures = 0;
  state.openedAt = 0;
  state.openUntil = 0;
  state.lastPrimarySuccessAt = Date.now();
}

export function recordPrimaryApiFailure(config = {}, scene = 'chat', error = '') {
  if (!isCircuitAvailable(config)) return;
  const key = buildCircuitKey(config, scene);
  const state = getState(key);
  const text = normalizeErrorText(error);
  const category = classifyAiUsageError(text) || 'other';
  state.scene = normalizeScene(scene);
  state.consecutivePrimaryFailures += 1;
  state.lastPrimaryFailureAt = Date.now();
  state.lastError = text;
  state.lastErrorCategory = category;
  state.lastErrorCategoryLabel = formatAiUsageErrorCategory(category);
}

export function recordFallbackApiSuccess(config = {}, scene = 'chat') {
  if (!isCircuitAvailable(config)) return;
  const policy = resolveCircuitPolicy(config);
  const key = buildCircuitKey(config, scene);
  const state = getState(key);
  const now = Date.now();
  state.scene = normalizeScene(scene);
  state.fallbackSuccessCount += 1;
  state.lastFallbackSuccessAt = now;
  if (state.consecutivePrimaryFailures >= policy.failureThreshold) {
    state.status = 'open';
    state.openedAt = state.openedAt || now;
    state.openUntil = now + policy.cooldownMs;
  }
}

export function recordFallbackApiFailure(config = {}, scene = 'chat', error = '') {
  if (!isCircuitAvailable(config)) return;
  const key = buildCircuitKey(config, scene);
  const state = getState(key);
  state.scene = normalizeScene(scene);
  state.fallbackFailureCount += 1;
  state.lastFallbackFailureAt = Date.now();
  if (error) {
    state.lastError = normalizeErrorText(error);
  }
}

export function getApiCircuitBreakerSnapshot(now = Date.now()) {
  return Array.from(apiCircuitStates.values())
    .filter(state => state.consecutivePrimaryFailures > 0 || state.status !== 'closed' || state.fallbackSuccessCount > 0 || state.fallbackFailureCount > 0)
    .map(state => ({
      id: buildCircuitId(state.key),
      scene: state.scene || 'chat',
      status: state.openUntil > now ? 'open' : state.status === 'open' ? 'half_open' : state.status,
      consecutivePrimaryFailures: state.consecutivePrimaryFailures,
      fallbackSuccessCount: state.fallbackSuccessCount,
      fallbackFailureCount: state.fallbackFailureCount,
      openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : '',
      openUntil: state.openUntil ? new Date(state.openUntil).toISOString() : '',
      remainingMs: state.openUntil > now ? state.openUntil - now : 0,
      lastPrimaryFailureAt: state.lastPrimaryFailureAt ? new Date(state.lastPrimaryFailureAt).toISOString() : '',
      lastPrimarySuccessAt: state.lastPrimarySuccessAt ? new Date(state.lastPrimarySuccessAt).toISOString() : '',
      lastFallbackSuccessAt: state.lastFallbackSuccessAt ? new Date(state.lastFallbackSuccessAt).toISOString() : '',
      lastFallbackFailureAt: state.lastFallbackFailureAt ? new Date(state.lastFallbackFailureAt).toISOString() : '',
      lastError: state.lastError,
      lastErrorCategory: state.lastErrorCategory,
      lastErrorCategoryLabel: state.lastErrorCategoryLabel,
    }))
    .sort((left, right) => Number(right.remainingMs || 0) - Number(left.remainingMs || 0));
}

export function resetApiCircuitBreakerState(options = {}) {
  const resetAll = options === true || options?.all === true;
  const targetId = cleanString(typeof options === 'string' ? options : options?.id);
  if (resetAll) {
    const resetCount = apiCircuitStates.size;
    apiCircuitStates.clear();
    return {
      success: true,
      resetCount,
      all: true,
    };
  }
  if (!targetId) {
    return {
      success: true,
      resetCount: 0,
      all: false,
      id: '',
    };
  }

  let resetCount = 0;
  for (const [key] of apiCircuitStates.entries()) {
    if (buildCircuitId(key) === targetId) {
      apiCircuitStates.delete(key);
      resetCount += 1;
    }
  }
  return {
    success: true,
    resetCount,
    all: false,
    id: targetId,
  };
}

export function withApiCircuitType(config = {}, type = '') {
  return {
    ...(config || {}),
    __apiCircuitType: cleanString(type),
  };
}

export function buildVirtualApiCircuitConfig(config = {}, fallbackConfig = null, type = '') {
  return {
    ...(config || {}),
    fallbackApi: {
      ...(config?.fallbackApi || {}),
      enabled: Boolean(fallbackConfig),
    },
    __hasFallbackApi: Boolean(fallbackConfig),
    __apiCircuitType: cleanString(type),
  };
}
