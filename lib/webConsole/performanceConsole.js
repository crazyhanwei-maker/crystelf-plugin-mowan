import os from 'os';
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
    const aiEntries = normalizeEntries(rawAiEntries);
    const imageEntries = normalizeEntries(rawImageEntries);
    const nowMs = Date.now();
    const since24h = nowMs - 24 * 60 * 60 * 1000;
    const todayAiEntries = filterEntriesByDate(aiEntries, dateKey);
    const last24hAiEntries = filterEntriesSince(aiEntries, since24h);
    const todayImageEntries = filterEntriesByDate(imageEntries, dateKey);
    const last24hImageEntries = filterEntriesSince(imageEntries, since24h);

    const todayAiStats = createStatsAccumulator();
    todayAiEntries.forEach(entry => addEntryToStats(todayAiStats, entry, slowThresholdMs));
    const last24hAiStats = createStatsAccumulator();
    last24hAiEntries.forEach(entry => addEntryToStats(last24hAiStats, entry, slowThresholdMs));
    const todayImageStats = createStatsAccumulator();
    todayImageEntries.forEach(entry => addEntryToStats(todayImageStats, entry, slowThresholdMs));
    const last24hImageStats = createStatsAccumulator();
    last24hImageEntries.forEach(entry => addEntryToStats(last24hImageStats, entry, slowThresholdMs));

    return {
      success: true,
      readOnly: true,
      generatedAt: new Date().toISOString(),
      date: dateKey,
      slowThresholdMs,
      runtime: buildRuntimeMetrics(startedAtMs),
      renderer: buildRendererMetrics(),
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
