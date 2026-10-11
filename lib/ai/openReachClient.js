import axios from 'axios';
import ConfigControl from '../config/configControl.js';

const DEFAULT_BASE_URL = 'http://openreach.changlu.cloud';
const API_PATHS = {
  search: '/api/web/search',
  read: '/api/web/read',
  imageSearch: '/api/web/image-search',
  curl: '/api/web/curl',
};

//公共服务无 SLA，连续失败时短暂熔断，避免主链路每次都白等一趟兜底
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;
let openReachCircuit = { failures: 0, blockedUntil: 0 };

function cleanString(value = '') {
  return String(value || '').trim();
}

function normalizeBaseUrl(value = '') {
  const base = cleanString(value).replace(/\/+$/, '');
  if (!base) return DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(base)) {
    return `http://${base}`;
  }
  return base;
}

function normalizeTimeout(value, fallback = 30000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.round(numeric), 5000), 90000);
}

function normalizeRegion(value = '') {
  const region = cleanString(value).slice(0, 32);
  return region || 'auto';
}

function normalizeLimit(value, fallback, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.min(Math.floor(numeric), max);
}

function normalizeMaxChars(value, fallback, max = 200000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), 1000), max);
}

export function normalizeOpenReachConfig(raw = {}) {
  return {
    enabled: raw?.enabled === true,
    baseUrl: normalizeBaseUrl(raw?.baseUrl),
    timeoutMs: normalizeTimeout(raw?.timeoutMs),
    searchRegion: normalizeRegion(raw?.searchRegion),
  };
}

export async function getOpenReachConfig() {
  const coreConfig = await ConfigControl.get('coreConfig');
  return normalizeOpenReachConfig(coreConfig?.tools?.search?.openReach || {});
}

export async function isOpenReachAvailable() {
  const config = await getOpenReachConfig();
  if (!config.enabled) return null;
  return config;
}

function isCircuitOpen() {
  return openReachCircuit.blockedUntil > Date.now();
}

function recordOpenReachSuccess() {
  openReachCircuit = { failures: 0, blockedUntil: 0 };
}

function recordOpenReachFailure() {
  const failures = openReachCircuit.failures + 1;
  openReachCircuit = {
    failures,
    blockedUntil: failures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_COOLDOWN_MS : 0,
  };
}

function describeOpenReachError(error) {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const message = data?.message || error?.message || '未知错误';
  return status ? `HTTP ${status} ${message}` : message;
}

async function postOpenReach(config, apiPath, body, timeoutMs = 0) {
  if (isCircuitOpen()) {
    return { skipped: true, error: 'OpenReach 连续失败进入短暂熔断' };
  }
  const startedAt = Date.now();
  try {
    const response = await axios.post(`${config.baseUrl}${apiPath}`, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: timeoutMs > 0 ? timeoutMs : config.timeoutMs,
    });
    recordOpenReachSuccess();
    return { skipped: false, data: response.data || {}, latencyMs: Date.now() - startedAt };
  } catch (error) {
    recordOpenReachFailure();
    return {
      skipped: false,
      error: describeOpenReachError(error),
      status: error?.response?.status,
      latencyMs: Date.now() - startedAt,
    };
  }
}

function sanitizeText(value, maxLength = 240) {
  if (typeof value !== 'string') return '';
  return value.replace(/`+/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function buildSearchSummary(results = []) {
  return results
    .map(item => {
      const meta = [item.source || item.domain, item.publish_time].filter(Boolean).join(' | ');
      return `${item.index}. ${item.title}${meta ? ` [${meta}]` : ''}\n链接: ${item.url || '无'}\n摘要: ${item.snippet || '无'}`;
    })
    .join('\n\n');
}

/**
 * OpenReach 网页搜索（免 Key），用于主搜索链路失败后的兜底
 */
export async function openReachSearch(query, options = {}) {
  const config = await getOpenReachConfig();
  const keyword = cleanString(query).slice(0, 500);
  if (!keyword) {
    return { success: false, error: '搜索关键词不能为空' };
  }
  const body = {
    query: keyword,
    limit: normalizeLimit(options.limit, 5, 20),
    region: normalizeRegion(options.region || config.searchRegion),
    provider: 'auto',
    timeRange: cleanString(options.timeRange || 'any').slice(0, 32) || 'any',
  };
  const response = await postOpenReach(config, API_PATHS.search, body, options.timeout_ms);
  if (response.skipped) {
    return { success: false, error: response.error, skipped: true };
  }
  if (response.error) {
    logger.warn(`[openReach] search 失败 | query="${keyword}" | ${response.error}`);
    return { success: false, error: response.error };
  }
  const items = Array.isArray(response.data.items) ? response.data.items : [];
  const results = items.map((item, index) => ({
    index: index + 1,
    title: sanitizeText(item.title || '无标题', 120),
    url: sanitizeText(item.url || item.link || '', 300),
    snippet: sanitizeText(item.snippet || item.description || '', 320),
    source: sanitizeText(item.source || item.site || item.domain || '', 80),
    domain: sanitizeText(item.domain || '', 120),
  })).filter(item => item.title || item.url);
  return {
    success: true,
    query: keyword,
    count: results.length,
    totalResults: response.data.count ?? results.length,
    results,
    summary: buildSearchSummary(results),
    provider: sanitizeText(response.data.provider || '', 40),
    latencyMs: response.latencyMs,
  };
}

/**
 * OpenReach 公网网页正文读取（免 Key），返回 Markdown 形态文本
 */
export async function openReachRead(targetUrl, options = {}) {
  const config = await getOpenReachConfig();
  const body = {
    url: cleanString(targetUrl).slice(0, 2048),
    maxChars: normalizeMaxChars(options.maxChars, 50000),
  };
  if (!body.url) {
    return { success: false, error: '网页地址不能为空' };
  }
  const response = await postOpenReach(config, API_PATHS.read, body, options.timeout_ms);
  if (response.skipped) {
    return { success: false, error: response.error, skipped: true };
  }
  if (response.error) {
    logger.warn(`[openReach] read 失败 | url="${body.url}" | ${response.error}`);
    return { success: false, error: response.error };
  }
  const data = response.data || {};
  const title = sanitizeText(data.title || '', 200);
  const content = String(data.content || '').replace(/\r\n?/g, '\n').trim();
  const markdown = (title ? `# ${title}\n\n` : '') + content.slice(0, body.maxChars);
  if (!content) {
    return { success: false, error: 'OpenReach 未返回可用正文', url: body.url };
  }
  return {
    success: true,
    url: sanitizeText(data.finalUrl || body.url, 2048),
    title,
    markdown,
    size: markdown.length,
    truncated: data.truncated === true,
    latencyMs: response.latencyMs,
  };
}

/**
 * OpenReach 文搜图（免 Key），返回已通过服务端可下载校验的图片列表
 */
export async function openReachImageSearch(query, options = {}) {
  const config = await getOpenReachConfig();
  const keyword = cleanString(query).slice(0, 500);
  if (!keyword) {
    return { success: false, error: '图片搜索关键词不能为空' };
  }
  const body = {
    query: keyword,
    limit: normalizeLimit(options.limit, 6, 30),
    region: normalizeRegion(options.region || config.searchRegion),
    provider: 'auto',
  };
  const response = await postOpenReach(config, API_PATHS.imageSearch, body, options.timeout_ms);
  if (response.skipped) {
    return { success: false, error: response.error, skipped: true };
  }
  if (response.error) {
    logger.warn(`[openReach] image-search 失败 | query="${keyword}" | ${response.error}`);
    return { success: false, error: response.error };
  }
  const items = Array.isArray(response.data.items) ? response.data.items : [];
  const results = items.map((item, index) => ({
    rank: index + 1,
    title: sanitizeText(item.title || '无标题', 160),
    imageUrl: sanitizeText(item.imageUrl || '', 600),
    thumbnailUrl: sanitizeText(item.thumbnailUrl || '', 600),
    sourcePageUrl: sanitizeText(item.sourcePageUrl || '', 600),
    provider: sanitizeText(item.provider || '', 40),
    source: sanitizeText(item.source || item.domain || '', 120),
    imageFormat: sanitizeText(item.imageFormat || '', 20),
  })).filter(item => item.imageUrl);
  return {
    success: true,
    query: keyword,
    count: results.length,
    items: results,
    summary: results
      .map(item => `${item.rank}. ${item.title}${item.imageFormat ? ` [${item.imageFormat}]` : ''}\n图片: ${item.imageUrl}\n来源页: ${item.sourcePageUrl || '无'}`)
      .join('\n\n'),
    latencyMs: response.latencyMs,
  };
}

/**
 * OpenReach Safe Curl（免 Key），读取公网 JSON/文本/raw 源码
 */
export async function openReachCurl(targetUrl, options = {}) {
  const config = await getOpenReachConfig();
  const body = {
    url: cleanString(targetUrl).slice(0, 2048),
    method: String(options.method || 'GET').toUpperCase() === 'HEAD' ? 'HEAD' : 'GET',
    maxChars: normalizeMaxChars(options.maxChars, 50000),
  };
  if (!body.url) {
    return { success: false, error: '地址不能为空' };
  }
  const response = await postOpenReach(config, API_PATHS.curl, body, options.timeout_ms);
  if (response.skipped) {
    return { success: false, error: response.error, skipped: true };
  }
  if (response.error) {
    logger.warn(`[openReach] curl 失败 | url="${body.url}" | ${response.error}`);
    return { success: false, error: response.error };
  }
  const data = response.data || {};
  const statusCode = Number(data.statusCode || 0);
  const bodyText = String(data.body || '');
  return {
    success: Boolean(statusCode),
    url: sanitizeText(data.url || body.url, 2048),
    finalUrl: sanitizeText(data.finalUrl || '', 2048),
    statusCode,
    contentType: sanitizeText(data.contentType || '', 120),
    body: bodyText,
    truncated: data.truncated === true,
    latencyMs: response.latencyMs,
    //上游 4xx/5xx 属于目标站点响应，原样透传给 Agent 自行判断换源或结束
    upstreamError: statusCode >= 400 ? `目标站点返回 HTTP ${statusCode}` : undefined,
  };
}
