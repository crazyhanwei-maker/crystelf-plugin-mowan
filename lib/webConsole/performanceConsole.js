import os from 'os';
import { getApiCircuitBreakerSnapshot } from '../ai/apiCircuitBreaker.js';
import { getApiQualityLogRetentionStatus } from '../ai/apiQualityLogger.js';
import { classifyAiUsageError, formatAiUsageErrorCategory } from '../ai/usageLogger.js';
import { getSharedPuppeteerRendererStats } from '../system/puppeteerRenderer.js';
import { getCrystelfTempImageCleanupStatus } from '../system/tempImageCleanup.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getLocalDateKey(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function toNumber(value = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundNumber(value = 0, digits = 0) {
  const number = toNumber(value);
  const factor = 10 ** Math.max(0, Number(digits || 0));
  return Math.round(number * factor) / factor;
}

function calcPercent(value = 0, total = 0) {
  const current = toNumber(value);
  const base = toNumber(total);
  if (base <= 0) return 0;
  return Math.min(100, Math.max(0, (current / base) * 100));
}

function normalizeStage(entry = {}) {
  const stage = String(entry.stage || '').trim().toLowerCase();
  if (stage === 'success') return 'success';
  if (stage === 'error' || stage === 'empty_response' || entry.error) return 'error';
  return stage || 'unknown';
}

function normalizeText(value = '', fallback = 'unknown') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeApiRole(entry = {}) {
  const raw = String(entry.api_role || entry.apiRole || '').trim().toLowerCase();
  if (raw === 'fallback' || raw === 'backup' || raw === '备用') return 'fallback';
  if (raw === 'primary' || raw === 'main' || raw === '主') return 'primary';
  if (entry.fallback === true || entry.usedFallback === true) return 'fallback';
  const scene = String(entry.scene || '').trim().toLowerCase();
  const mode = String(entry.mode || '').trim().toLowerCase();
  if (scene.endsWith('_fallback') || /(^|[_:-])fallback($|[_:-])/.test(scene)) return 'fallback';
  if (mode.startsWith('fallback:') || mode.includes(':fallback')) return 'fallback';
  return 'primary';
}

function normalizeApiType(entry = {}) {
  const raw = String(entry.api_type || entry.apiType || '').trim().toLowerCase();
  if (raw) return raw;
  const scene = String(entry.scene || '').trim().toLowerCase();
  const mode = String(entry.mode || '').trim().toLowerCase();
  if (scene.includes('image_monitor')) return 'image_monitor';
  if (scene.includes('group_url_safety') || scene.includes('url_safety')) return 'url_safety';
  if (scene.includes('log_diagnosis')) return 'log_diagnosis';
  if (mode || entry.has_image !== undefined) return 'image_generation';
  if (scene.includes('search') || scene.includes('web')) return 'search';
  if (scene.includes('multimodal')) return 'multimodal';
  return 'chat';
}

function sanitizePreview(value = '', maxLength = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function parseEntryTime(entry = {}) {
  const timestamp = Date.parse(entry.time || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter(isPlainObject)
    .map(entry => {
      const errorText = normalizeText(entry.error, '');
      const errorCategory = errorText ? normalizeText(entry.error_category || classifyAiUsageError(errorText), '') : '';
      return {
        ...entry,
        _timeMs: parseEntryTime(entry),
        _elapsedMs: Math.max(0, toNumber(entry.elapsed_ms)),
        _stage: normalizeStage(entry),
        _model: normalizeText(entry.model),
        _scene: normalizeText(entry.scene),
        _apiRole: normalizeApiRole(entry),
        _apiType: normalizeApiType(entry),
        _errorCategory: errorCategory,
        _errorCategoryLabel: errorCategory
          ? normalizeText(entry.error_category_label || formatAiUsageErrorCategory(errorCategory), '')
          : '',
      };
    })
    .filter(entry => entry._timeMs > 0);
}

function normalizeSearchStage(entry = {}) {
  const stage = String(entry.stage || '').trim().toLowerCase();
  if (stage === 'success' || stage === 'fallback_success') return 'success';
  if (stage === 'failure' || stage === 'fallback_failure') return 'error';
  return 'unknown';
}

function normalizeSearchApiRole(entry = {}) {
  const stage = String(entry.stage || '').trim().toLowerCase();
  if (stage.startsWith('fallback_') || entry.fallback === true) return 'fallback';
  return 'primary';
}

function normalizeSearchEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter(isPlainObject)
    .filter(entry => {
      const stage = String(entry.stage || '').trim().toLowerCase();
      return ['success', 'failure', 'fallback_success', 'fallback_failure'].includes(stage);
    })
    .map(entry => {
      const errorText = normalizeText(entry.error, '');
      const errorCategory = errorText ? normalizeText(entry.error_category || classifyAiUsageError(errorText), '') : '';
      return {
        ...entry,
        _timeMs: parseEntryTime(entry),
        _elapsedMs: Math.max(0, toNumber(entry.elapsed_ms)),
        _stage: normalizeSearchStage(entry),
        _model: 'search-web',
        _scene: 'search_web',
        _apiRole: normalizeSearchApiRole(entry),
        _apiType: 'search',
        _errorCategory: errorCategory,
        _errorCategoryLabel: errorCategory
          ? normalizeText(entry.error_category_label || formatAiUsageErrorCategory(errorCategory), '')
          : '',
      };
    })
    .filter(entry => entry._timeMs > 0);
}

function normalizeApiQualityEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter(isPlainObject)
    .map(entry => {
      const errorText = normalizeText(entry.error, '');
      const errorCategory = errorText ? normalizeText(entry.error_category || classifyAiUsageError(errorText), '') : '';
      return {
        ...entry,
        _timeMs: parseEntryTime(entry),
        _elapsedMs: Math.max(0, toNumber(entry.elapsed_ms)),
        _stage: normalizeStage(entry),
        _model: normalizeText(entry.model),
        _scene: normalizeText(entry.scene || entry.api_type),
        _apiRole: normalizeApiRole(entry),
        _apiType: normalizeApiType(entry),
        _errorCategory: errorCategory,
        _errorCategoryLabel: errorCategory
          ? normalizeText(entry.error_category_label || formatAiUsageErrorCategory(errorCategory), '')
          : '',
      };
    })
    .filter(entry => entry._timeMs > 0);
}

function createStatsAccumulator() {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    elapsedSamples: [],
    totalElapsedMs: 0,
    maxElapsedMs: 0,
    minElapsedMs: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    slowCount: 0,
  };
}

function createRoleStatsAccumulator() {
  return {
    ...createStatsAccumulator(),
    fallbackTriggerCount: 0,
  };
}

function addEntryToStats(stats, entry, slowThresholdMs = 10000) {
  stats.requestCount += 1;
  if (entry._stage === 'success') stats.successCount += 1;
  if (entry._stage === 'error') stats.errorCount += 1;

  const elapsedMs = toNumber(entry._elapsedMs);
  if (elapsedMs > 0) {
    stats.elapsedSamples.push(elapsedMs);
    stats.totalElapsedMs += elapsedMs;
    stats.maxElapsedMs = Math.max(stats.maxElapsedMs, elapsedMs);
    stats.minElapsedMs = stats.minElapsedMs > 0 ? Math.min(stats.minElapsedMs, elapsedMs) : elapsedMs;
    if (elapsedMs >= slowThresholdMs) stats.slowCount += 1;
  }

  stats.totalTokens += toNumber(entry.total_tokens);
  stats.promptTokens += toNumber(entry.prompt_tokens);
  stats.completionTokens += toNumber(entry.completion_tokens);
}

function percentile(values = [], percent = 95) {
  const list = values.map(toNumber).filter(value => value > 0).sort((a, b) => a - b);
  if (list.length <= 0) return 0;
  const index = Math.min(list.length - 1, Math.max(0, Math.ceil((percent / 100) * list.length) - 1));
  return list[index];
}

function finalizeStats(stats = createStatsAccumulator()) {
  const samples = stats.elapsedSamples || [];
  const requestCount = toNumber(stats.requestCount);
  const successCount = toNumber(stats.successCount);
  const errorCount = toNumber(stats.errorCount);
  const averageElapsedMs = samples.length > 0 ? Math.round(stats.totalElapsedMs / samples.length) : 0;
  return {
    requestCount,
    successCount,
    errorCount,
    successRate: requestCount > 0 ? roundNumber((successCount / requestCount) * 100, 2) : 0,
    errorRate: requestCount > 0 ? roundNumber((errorCount / requestCount) * 100, 2) : 0,
    elapsedSampleCount: samples.length,
    averageElapsedMs,
    p95ElapsedMs: Math.round(percentile(samples, 95)),
    maxElapsedMs: Math.round(stats.maxElapsedMs || 0),
    minElapsedMs: Math.round(stats.minElapsedMs || 0),
    slowCount: toNumber(stats.slowCount),
    totalTokens: toNumber(stats.totalTokens),
    promptTokens: toNumber(stats.promptTokens),
    completionTokens: toNumber(stats.completionTokens),
  };
}

function groupEntries(entries = [], keyGetter = () => 'unknown', slowThresholdMs = 10000) {
  const map = new Map();
  for (const entry of entries) {
    const key = normalizeText(keyGetter(entry));
    if (!map.has(key)) {
      map.set(key, createStatsAccumulator());
    }
    addEntryToStats(map.get(key), entry, slowThresholdMs);
  }
  return Array.from(map.entries())
    .map(([key, stats]) => ({ key, ...finalizeStats(stats) }))
    .sort((left, right) => {
      const requestDiff = Number(right.requestCount || 0) - Number(left.requestCount || 0);
      if (requestDiff !== 0) return requestDiff;
      return Number(right.averageElapsedMs || 0) - Number(left.averageElapsedMs || 0);
    });
}

function formatApiTypeLabel(type = '') {
  const map = {
    chat: '对话 API',
    multimodal: '多模态 API',
    image_generation: '生图 API',
    image_monitor: '图片监控 API',
    search: '搜索 API',
    meme: '表情包 API',
    tts: '语音合成 API',
    tts_models: '语音模型列表 API',
    url_safety: 'URL 安全检查 API',
    log_diagnosis: '日志排查 API',
  };
  const key = String(type || '').trim().toLowerCase();
  return map[key] || (key || '未知 API');
}

function formatApiRoleLabel(role = '') {
  const key = String(role || '').trim().toLowerCase();
  if (key === 'fallback') return '备用';
  if (key === 'primary') return '主接口';
  return '未知';
}

function buildApiQualityStats(entries = [], slowThresholdMs = 10000) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && entry._timeMs > 0);
  const totalStats = createStatsAccumulator();
  const roleMap = new Map();
  const typeRoleMap = new Map();
  const fallbackEvents = [];

  for (const entry of normalized) {
    addEntryToStats(totalStats, entry, slowThresholdMs);
    const role = normalizeText(entry._apiRole, 'primary');
    const type = normalizeText(entry._apiType, 'chat');
    if (!roleMap.has(role)) {
      roleMap.set(role, createRoleStatsAccumulator());
    }
    addEntryToStats(roleMap.get(role), entry, slowThresholdMs);
    if (role === 'fallback') {
      roleMap.get(role).fallbackTriggerCount += 1;
      fallbackEvents.push(entry);
    }

    const key = `${type}::${role}`;
    if (!typeRoleMap.has(key)) {
      typeRoleMap.set(key, {
        type,
        typeLabel: formatApiTypeLabel(type),
        role,
        roleLabel: formatApiRoleLabel(role),
        stats: createStatsAccumulator(),
      });
    }
    addEntryToStats(typeRoleMap.get(key).stats, entry, slowThresholdMs);
  }

  const total = finalizeStats(totalStats);
  const byRole = Array.from(roleMap.entries())
    .map(([role, stats]) => ({
      role,
      roleLabel: formatApiRoleLabel(role),
      ...finalizeStats(stats),
      fallbackTriggerCount: toNumber(stats.fallbackTriggerCount),
      trafficShare: total.requestCount > 0 ? roundNumber((toNumber(stats.requestCount) / total.requestCount) * 100, 2) : 0,
    }))
    .sort((left, right) => {
      if (left.role === 'primary') return -1;
      if (right.role === 'primary') return 1;
      return Number(right.requestCount || 0) - Number(left.requestCount || 0);
    });

  const byTypeRole = Array.from(typeRoleMap.values())
    .map(item => ({
      type: item.type,
      typeLabel: item.typeLabel,
      role: item.role,
      roleLabel: item.roleLabel,
      ...finalizeStats(item.stats),
    }))
    .sort((left, right) => {
      const typeCompare = String(left.typeLabel || '').localeCompare(String(right.typeLabel || ''), 'zh-CN');
      if (typeCompare !== 0) return typeCompare;
      if (left.role === 'primary') return -1;
      if (right.role === 'primary') return 1;
      return 0;
    });

  const fallback = byRole.find(item => item.role === 'fallback') || {
    role: 'fallback',
    roleLabel: '备用',
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    successRate: 0,
    errorRate: 0,
    averageElapsedMs: 0,
    p95ElapsedMs: 0,
    slowCount: 0,
    fallbackTriggerCount: 0,
    trafficShare: 0,
  };

  return {
    total,
    byRole,
    byTypeRole,
    fallback,
    fallbackShare: total.requestCount > 0 ? roundNumber((toNumber(fallback.requestCount) / total.requestCount) * 100, 2) : 0,
    fallbackSuccessRate: fallback.successRate || 0,
    recentFallbackEvents: fallbackEvents
      .sort((left, right) => toNumber(right._timeMs) - toNumber(left._timeMs))
      .slice(0, 12)
      .map(entry => ({
        time: entry.time || '',
        type: entry._apiType,
        typeLabel: formatApiTypeLabel(entry._apiType),
        scene: entry._scene,
        model: entry._model,
        stage: entry._stage,
        elapsedMs: Math.round(entry._elapsedMs || 0),
        errorCategoryLabel: entry._errorCategoryLabel || '',
        error: sanitizePreview(entry.error || '', 160),
      })),
  };
}

const API_QUALITY_ALERT_THRESHOLDS = {
  minRequests: 5,
  minFallbackRequests: 3,
  warnErrorRate: 20,
  errorErrorRate: 35,
  warnFallbackShare: 30,
  errorFallbackShare: 60,
  warnFallbackErrorRate: 20,
  errorFallbackErrorRate: 40,
  warnAverageElapsedMs: 30000,
  errorAverageElapsedMs: 60000,
  warnP95ElapsedMs: 60000,
  errorP95ElapsedMs: 120000,
};

function buildApiQualityAlerts(apiQuality = {}, options = {}) {
  const thresholds = {
    ...API_QUALITY_ALERT_THRESHOLDS,
    ...(isPlainObject(options.thresholds) ? options.thresholds : {}),
  };
  const total = apiQuality.total || {};
  const fallback = apiQuality.fallback || {};
  const requestCount = toNumber(total.requestCount);
  const fallbackRequestCount = toNumber(fallback.requestCount);
  const alerts = [];
  const pushAlert = (level, title, detail, metric, value) => {
    alerts.push({ level, title, detail, metric, value });
  };

  if (requestCount < thresholds.minRequests) {
    return {
      status: 'healthy',
      sampleEnough: false,
      checkedRange: 'last24h',
      thresholds,
      alerts,
      summary: `近24小时样本 ${requestCount} 次，少于 ${thresholds.minRequests} 次，暂不判断异常。`,
    };
  }

  const errorRate = toNumber(total.errorRate);
  const fallbackShare = toNumber(apiQuality.fallbackShare);
  const fallbackErrorRate = toNumber(fallback.errorRate);
  const averageElapsedMs = toNumber(total.averageElapsedMs);
  const p95ElapsedMs = toNumber(total.p95ElapsedMs);

  if (errorRate >= thresholds.errorErrorRate) {
    pushAlert('error', 'API 失败率过高', `近24小时失败率 ${roundNumber(errorRate, 2)}%，已经超过异常阈值 ${thresholds.errorErrorRate}%。`, 'errorRate', errorRate);
  } else if (errorRate >= thresholds.warnErrorRate) {
    pushAlert('warn', 'API 失败率偏高', `近24小时失败率 ${roundNumber(errorRate, 2)}%，超过告警阈值 ${thresholds.warnErrorRate}%。`, 'errorRate', errorRate);
  }

  if (fallbackShare >= thresholds.errorFallbackShare) {
    pushAlert('error', '备用接口接管过多', `近24小时备用接口占比 ${roundNumber(fallbackShare, 2)}%，主接口可能不稳定。`, 'fallbackShare', fallbackShare);
  } else if (fallbackShare >= thresholds.warnFallbackShare) {
    pushAlert('warn', '备用接口接管偏多', `近24小时备用接口占比 ${roundNumber(fallbackShare, 2)}%，建议检查主接口连通性和限额。`, 'fallbackShare', fallbackShare);
  }

  if (fallbackRequestCount >= thresholds.minFallbackRequests) {
    if (fallbackErrorRate >= thresholds.errorFallbackErrorRate) {
      pushAlert('error', '备用接口失败率过高', `备用接口近24小时失败率 ${roundNumber(fallbackErrorRate, 2)}%，备用线路本身可能也不可用。`, 'fallbackErrorRate', fallbackErrorRate);
    } else if (fallbackErrorRate >= thresholds.warnFallbackErrorRate) {
      pushAlert('warn', '备用接口存在失败', `备用接口近24小时失败率 ${roundNumber(fallbackErrorRate, 2)}%，建议检查备用模型或地址。`, 'fallbackErrorRate', fallbackErrorRate);
    }
  }

  if (averageElapsedMs >= thresholds.errorAverageElapsedMs) {
    pushAlert('error', 'API 平均耗时过高', `近24小时平均耗时 ${Math.round(averageElapsedMs)}ms，已经影响群聊响应。`, 'averageElapsedMs', averageElapsedMs);
  } else if (averageElapsedMs >= thresholds.warnAverageElapsedMs) {
    pushAlert('warn', 'API 平均耗时偏高', `近24小时平均耗时 ${Math.round(averageElapsedMs)}ms，建议关注网络或模型响应速度。`, 'averageElapsedMs', averageElapsedMs);
  }

  if (p95ElapsedMs >= thresholds.errorP95ElapsedMs) {
    pushAlert('error', 'API P95 耗时异常', `近24小时 P95 耗时 ${Math.round(p95ElapsedMs)}ms，部分请求明显过慢。`, 'p95ElapsedMs', p95ElapsedMs);
  } else if (p95ElapsedMs >= thresholds.warnP95ElapsedMs) {
    pushAlert('warn', 'API P95 耗时偏高', `近24小时 P95 耗时 ${Math.round(p95ElapsedMs)}ms，可能存在间歇性超时。`, 'p95ElapsedMs', p95ElapsedMs);
  }

  const status = alerts.some(item => item.level === 'error')
    ? 'error'
    : alerts.some(item => item.level === 'warn')
      ? 'warn'
      : 'healthy';

  return {
    status,
    sampleEnough: true,
    checkedRange: 'last24h',
    thresholds,
    alerts,
    summary: alerts.length > 0
      ? alerts[0].detail
      : `近24小时 ${requestCount} 次请求，主备质量正常。`,
  };
}

function buildDailyApiQualityTrend(entries = [], slowThresholdMs = 10000, dayCount = 7) {
  const days = [];
  const dayMap = new Map();
  const now = new Date();
  for (let index = dayCount - 1; index >= 0; index -= 1) {
    const date = new Date(now.getTime() - index * 24 * 60 * 60 * 1000);
    const key = getLocalDateKey(date);
    dayMap.set(key, []);
    days.push(key);
  }

  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = String(entry.time || '').slice(0, 10);
    if (dayMap.has(key)) {
      dayMap.get(key).push(entry);
    }
  }

  return days.map(date => {
    const stats = buildApiQualityStats(dayMap.get(date) || [], slowThresholdMs);
    return {
      date,
      label: date.slice(5),
      requestCount: stats.total.requestCount,
      successRate: stats.total.successRate,
      errorRate: stats.total.errorRate,
      fallbackShare: stats.fallbackShare,
      fallbackCount: stats.fallback.requestCount,
      fallbackSuccessRate: stats.fallbackSuccessRate,
      averageElapsedMs: stats.total.averageElapsedMs,
      p95ElapsedMs: stats.total.p95ElapsedMs,
      slowCount: stats.total.slowCount,
    };
  });
}

function getErrorCategoryAdvice(category = '') {
  const map = {
    timeout: '请求超时通常和上游响应慢、跨境网络抖动或超时时间过短有关。可以检查线路、提高超时或启用备用 API。',
    empty_response: '模型空回复通常和模型兼容性、工具调用格式或上游返回结构有关。建议换模型或查看最近请求原始错误。',
    rate_limit: '限流或额度问题通常需要检查余额、并发限制、模型限额或是否被中转服务限速。',
    auth: '认证或权限问题通常是 API Key、模型权限、地址路径或账号策略不匹配。',
    network: '网络连接问题通常是 DNS、路由、防火墙、TLS 或目标服务不可达。',
    bad_request: '请求参数问题通常和模型不支持 tools/schema、消息格式或接口路径不兼容有关。',
    upstream: '上游服务问题通常是服务商 5xx、网关异常或中转后端故障。',
    safety: '安全策略问题通常是上游内容审核拒绝，需要调整提示词或换可用模型。',
    model: '模型错误通常是模型名不存在、模型下线或当前账号无权限。',
    other: '未归类错误建议结合最近错误文本和日志排查继续定位。',
  };
  return map[String(category || '').trim()] || map.other;
}

function buildApiFailureDiagnosis(entries = [], limit = 10) {
  const failureEntries = (Array.isArray(entries) ? entries : [])
    .filter(entry => entry?._stage === 'error');
  const categoryMap = new Map();
  const sceneMap = new Map();

  for (const entry of failureEntries) {
    const category = normalizeText(entry._errorCategory || classifyAiUsageError(entry.error), 'other');
    const label = normalizeText(entry._errorCategoryLabel || formatAiUsageErrorCategory(category), '其他错误');
    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        category,
        label,
        count: 0,
        primaryCount: 0,
        fallbackCount: 0,
        latestAt: '',
        latestError: '',
        scenes: new Map(),
      });
    }
    const item = categoryMap.get(category);
    item.count += 1;
    if (entry._apiRole === 'fallback') item.fallbackCount += 1;
    else item.primaryCount += 1;
    if (!item.latestAt || String(entry.time || '').localeCompare(item.latestAt) > 0) {
      item.latestAt = entry.time || '';
      item.latestError = sanitizePreview(entry.error || '', 180);
    }
    const scene = normalizeText(entry._scene);
    item.scenes.set(scene, (item.scenes.get(scene) || 0) + 1);

    const sceneKey = `${scene}::${category}`;
    if (!sceneMap.has(sceneKey)) {
      sceneMap.set(sceneKey, {
        scene,
        category,
        label,
        count: 0,
        latestAt: '',
        latestError: '',
      });
    }
    const sceneItem = sceneMap.get(sceneKey);
    sceneItem.count += 1;
    if (!sceneItem.latestAt || String(entry.time || '').localeCompare(sceneItem.latestAt) > 0) {
      sceneItem.latestAt = entry.time || '';
      sceneItem.latestError = sanitizePreview(entry.error || '', 180);
    }
  }

  const categories = Array.from(categoryMap.values())
    .map(item => ({
      category: item.category,
      label: item.label,
      count: item.count,
      primaryCount: item.primaryCount,
      fallbackCount: item.fallbackCount,
      latestAt: item.latestAt,
      latestError: item.latestError,
      advice: getErrorCategoryAdvice(item.category),
      topScenes: Array.from(item.scenes.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4)
        .map(([scene, count]) => ({ scene, count })),
    }))
    .sort((left, right) => right.count - left.count || String(right.latestAt || '').localeCompare(String(left.latestAt || '')))
    .slice(0, Math.max(1, Math.min(30, Number(limit || 10))));

  const byScene = Array.from(sceneMap.values())
    .sort((left, right) => right.count - left.count || String(right.latestAt || '').localeCompare(String(left.latestAt || '')))
    .slice(0, Math.max(1, Math.min(40, Number(limit || 10) * 2)));

  return {
    totalFailureCount: failureEntries.length,
    categories,
    byScene,
    topCategory: categories[0] || null,
  };
}

function buildHourlyBuckets(entries = [], slowThresholdMs = 10000) {
  const now = new Date();
  const buckets = [];
  const bucketMap = new Map();
  for (let index = 23; index >= 0; index -= 1) {
    const time = new Date(now.getTime() - index * 60 * 60 * 1000);
    time.setMinutes(0, 0, 0);
    const key = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:00`;
    const bucket = { hour: `${String(time.getHours()).padStart(2, '0')}:00`, key, ...createStatsAccumulator() };
    buckets.push(bucket);
    bucketMap.set(key, bucket);
  }

  for (const entry of entries) {
    const time = new Date(entry._timeMs);
    if (Number.isNaN(time.getTime())) continue;
    time.setMinutes(0, 0, 0);
    const key = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:00`;
    const bucket = bucketMap.get(key);
    if (bucket) addEntryToStats(bucket, entry, slowThresholdMs);
  }

  return buckets.map(bucket => ({
    hour: bucket.hour,
    key: bucket.key,
    ...finalizeStats(bucket),
  }));
}

function buildFailureReasonsByScene(entries = [], limit = 40) {
  const map = new Map();
  for (const entry of entries) {
    if (entry._stage !== 'error') continue;
    const scene = normalizeText(entry._scene);
    const category = normalizeText(entry._errorCategory || classifyAiUsageError(entry.error), 'other');
    const label = normalizeText(entry._errorCategoryLabel || formatAiUsageErrorCategory(category), '其他错误');
    const key = `${scene}::${category}`;
    if (!map.has(key)) {
      map.set(key, {
        scene,
        category,
        label,
        count: 0,
        latestAt: '',
        latestError: '',
        models: new Map(),
      });
    }
    const item = map.get(key);
    item.count += 1;
    if (!item.latestAt || String(entry.time || '').localeCompare(item.latestAt) > 0) {
      item.latestAt = entry.time || '';
      item.latestError = sanitizePreview(entry.error || '', 180);
    }
    const model = normalizeText(entry._model);
    item.models.set(model, (item.models.get(model) || 0) + 1);
  }
  return Array.from(map.values())
    .map(item => ({
      scene: item.scene,
      category: item.category,
      label: item.label,
      count: item.count,
      latestAt: item.latestAt,
      latestError: item.latestError,
      topModels: Array.from(item.models.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([model, count]) => ({ model, count })),
    }))
    .sort((a, b) => b.count - a.count || String(b.latestAt || '').localeCompare(String(a.latestAt || '')))
    .slice(0, Math.max(1, Math.min(100, Number(limit || 40))));
}

function buildSlowRequests(entries = [], slowThresholdMs = 10000, limit = 20) {
  return entries
    .filter(entry => toNumber(entry._elapsedMs) >= slowThresholdMs || entry._stage === 'error')
    .sort((left, right) => {
      const elapsedDiff = toNumber(right._elapsedMs) - toNumber(left._elapsedMs);
      if (elapsedDiff !== 0) return elapsedDiff;
      return toNumber(right._timeMs) - toNumber(left._timeMs);
    })
    .slice(0, limit)
    .map(entry => ({
      time: entry.time || '',
      stage: entry._stage,
      scene: entry._scene,
      model: entry._model,
      provider: entry.provider || '',
      elapsedMs: Math.round(entry._elapsedMs || 0),
      totalTokens: toNumber(entry.total_tokens),
      groupId: entry.group_id || '',
      userId: entry.user_id || '',
      errorCategory: entry._errorCategory || '',
      errorCategoryLabel: entry._errorCategoryLabel || '',
      error: sanitizePreview(entry.error || '', 180),
    }));
}

function buildRuntimeMetrics(startedAtMs = Date.now()) {
  const memory = process.memoryUsage();
  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
  const heapPercent = calcPercent(memory.heapUsed, memory.heapTotal);
  const memoryPercent = calcPercent(usedMemoryBytes, totalMemoryBytes);
  const uptimeMs = Math.max(process.uptime() * 1000, Date.now() - startedAtMs);

  return {
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    pid: process.pid,
    uptimeMs: Math.round(uptimeMs),
    loadAverage: os.loadavg().map(item => roundNumber(item, 2)),
    cpuCount: os.cpus?.()?.length || 0,
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      totalMemoryBytes,
      usedMemoryBytes,
      freeMemoryBytes,
      memoryPercent: roundNumber(memoryPercent, 2),
      heapPercent: roundNumber(heapPercent, 2),
    },
  };
}

function buildRendererMetrics() {
  const renderer = getSharedPuppeteerRendererStats();
  const cleanup = getCrystelfTempImageCleanupStatus();
  return {
    ...renderer,
    cleanup,
  };
}

function filterEntriesByDate(entries = [], dateKey = getLocalDateKey()) {
  return entries.filter(entry => String(entry.time || '').slice(0, 10) === dateKey);
}

function filterEntriesSince(entries = [], sinceMs = 0) {
  return entries.filter(entry => toNumber(entry._timeMs) >= sinceMs);
}

function readEntriesFromFile(readTailText, parseJsonObjects, filePath = '', tailLength = 120000) {
  const content = readTailText(filePath, Math.max(120000, toNumber(tailLength)));
  return parseJsonObjects(content)
    .map(item => {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function createPerformanceConsole(options = {}) {
  const usageLogFile = options.usageLogFile || '';
  const imageUsageLogFile = options.imageUsageLogFile || '';
  const searchDebugLogFile = options.searchDebugLogFile || '';
  const apiQualityLogFile = options.apiQualityLogFile || '';
  const readTailText = typeof options.readTailText === 'function' ? options.readTailText : (() => '');
  const parseJsonObjects = typeof options.parseJsonObjects === 'function' ? options.parseJsonObjects : (() => []);
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({ logTailLength: 120000 }));
  const startedAtMs = Date.now();

  function buildPayload(options = {}) {
    const dateKey = getLocalDateKey();
    const slowThresholdMs = Math.max(500, toNumber(options.slowThresholdMs) || 10000);
    const webConsoleConfig = getWebConsoleConfig();
    const tailLength = Math.max(120000, toNumber(webConsoleConfig.logTailLength));
    const rawAiEntries = readEntriesFromFile(readTailText, parseJsonObjects, usageLogFile, tailLength);
    const rawImageEntries = readEntriesFromFile(readTailText, parseJsonObjects, imageUsageLogFile, tailLength);
    const rawSearchEntries = readEntriesFromFile(readTailText, parseJsonObjects, searchDebugLogFile, tailLength);
    const rawApiQualityEntries = readEntriesFromFile(readTailText, parseJsonObjects, apiQualityLogFile, tailLength);
    const aiEntries = normalizeEntries(rawAiEntries);
    const imageEntries = normalizeEntries(rawImageEntries);
    const searchEntries = normalizeSearchEntries(rawSearchEntries);
    const apiQualityEntries = normalizeApiQualityEntries(rawApiQualityEntries);
    const nowMs = Date.now();
    const since24h = nowMs - 24 * 60 * 60 * 1000;
    const since7d = nowMs - 7 * 24 * 60 * 60 * 1000;
    const todayAiEntries = filterEntriesByDate(aiEntries, dateKey);
    const last24hAiEntries = filterEntriesSince(aiEntries, since24h);
    const todayImageEntries = filterEntriesByDate(imageEntries, dateKey);
    const last24hImageEntries = filterEntriesSince(imageEntries, since24h);
    const todaySearchEntries = filterEntriesByDate(searchEntries, dateKey);
    const last24hSearchEntries = filterEntriesSince(searchEntries, since24h);
    const todayGenericApiEntries = filterEntriesByDate(apiQualityEntries, dateKey);
    const last24hGenericApiEntries = filterEntriesSince(apiQualityEntries, since24h);
    const todayApiEntries = [...todayAiEntries, ...todayImageEntries, ...todaySearchEntries, ...todayGenericApiEntries];
    const last24hApiEntries = [...last24hAiEntries, ...last24hImageEntries, ...last24hSearchEntries, ...last24hGenericApiEntries];
    const last7dApiEntries = filterEntriesSince([...aiEntries, ...imageEntries, ...searchEntries, ...apiQualityEntries], since7d);

    const todayAiStats = createStatsAccumulator();
    todayAiEntries.forEach(entry => addEntryToStats(todayAiStats, entry, slowThresholdMs));
    const last24hAiStats = createStatsAccumulator();
    last24hAiEntries.forEach(entry => addEntryToStats(last24hAiStats, entry, slowThresholdMs));
    const todayImageStats = createStatsAccumulator();
    todayImageEntries.forEach(entry => addEntryToStats(todayImageStats, entry, slowThresholdMs));
    const last24hImageStats = createStatsAccumulator();
    last24hImageEntries.forEach(entry => addEntryToStats(last24hImageStats, entry, slowThresholdMs));

    const todayApiQuality = buildApiQualityStats(todayApiEntries, slowThresholdMs);
    const last24hApiQuality = buildApiQualityStats(last24hApiEntries, slowThresholdMs);

    return {
      success: true,
      readOnly: true,
      generatedAt: new Date().toISOString(),
      date: dateKey,
      slowThresholdMs,
      runtime: buildRuntimeMetrics(startedAtMs),
      renderer: buildRendererMetrics(),
      apiQuality: {
        today: todayApiQuality,
        last24h: last24hApiQuality,
        dailyTrend: buildDailyApiQualityTrend(last7dApiEntries, slowThresholdMs, 7),
        failureDiagnosis: buildApiFailureDiagnosis(last24hApiEntries, 10),
        alerts: buildApiQualityAlerts(last24hApiQuality),
        retention: getApiQualityLogRetentionStatus(),
        circuitBreaker: getApiCircuitBreakerSnapshot(),
      },
      ai: {
        today: finalizeStats(todayAiStats),
        last24h: finalizeStats(last24hAiStats),
        byModel: groupEntries(todayAiEntries, entry => entry._model, slowThresholdMs).slice(0, 16),
        byScene: groupEntries(todayAiEntries, entry => entry._scene, slowThresholdMs).slice(0, 16),
        failureReasonsByScene: buildFailureReasonsByScene(todayAiEntries, 40),
        hourly: buildHourlyBuckets(last24hAiEntries, slowThresholdMs),
        slowRequests: buildSlowRequests(todayAiEntries, slowThresholdMs, 20),
      },
      image: {
        today: finalizeStats(todayImageStats),
        last24h: finalizeStats(last24hImageStats),
        byModel: groupEntries(todayImageEntries, entry => entry._model, slowThresholdMs).slice(0, 12),
        hourly: buildHourlyBuckets(last24hImageEntries, slowThresholdMs),
        slowRequests: buildSlowRequests(todayImageEntries, slowThresholdMs, 12),
      },
    };
  }

  return {
    buildPayload,
  };
}
