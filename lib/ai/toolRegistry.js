import axios from 'axios';
import crypto from 'crypto';
import dns from 'dns/promises';
import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import ConfigControl from '../config/configControl.js';
import Group from '../yunzai/group.js';
import { getTtsTools } from './ttsRegistry.js';
import { getYunzaiCommandBridgeTool } from './yunzaiCommandBridge.js';
import { buildBotLogDiagnosisTool } from './botLogDiagnosisTool.js';
import { buildSearchFallbackConfig } from './apiFallback.js';
import {
  buildVirtualApiCircuitConfig,
  recordFallbackApiFailure,
  recordFallbackApiSuccess,
  recordPrimaryApiFailure,
  recordPrimaryApiSuccess,
  shouldPreferFallbackApi,
} from './apiCircuitBreaker.js';

const SEARCH_DEBUG_DIR = path.join(process.cwd(), 'data', 'crystelf', 'debug');
const SEARCH_DEBUG_FILE = path.join(SEARCH_DEBUG_DIR, 'search-web.log');

function normalizeApiTimeout(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 30000;
  }
  return Math.min(Math.max(Math.round(numeric), 1000), 30000);
}

function normalizeClientTimeout(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 60000;
  }
  return Math.min(Math.max(Math.round(numeric), 1000), 60000);
}

function normalizeMarkdownTimeout(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 20000;
  }
  return Math.min(Math.max(Math.round(numeric), 20000), 60000);
}

function normalizeDownloadFilename(value = '', targetUrl = '', contentType = '') {
  const supplied = String(value || '').trim();
  let fallback = '';
  try {
    fallback = decodeURIComponent(new URL(targetUrl).pathname.split('/').pop() || '');
  } catch {
    fallback = '';
  }
  const source = supplied || fallback || 'download';
  const safe = source
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '')
    .slice(0, 120);
  if (safe) return safe;
  const normalizedType = String(contentType || '').toLowerCase();
  const extension = normalizedType.includes('pdf') ? '.pdf'
    : normalizedType.includes('json') ? '.json'
      : normalizedType.includes('text') ? '.txt' : '.bin';
  return `download${extension}`;
}

function normalizeDownloadLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 10 * 1024 * 1024;
  return Math.min(Math.max(Math.round(numeric), 64 * 1024), 20 * 1024 * 1024);
}

async function downloadWebFile(args = {}, toolCtx = {}) {
  const coreConfig = await ConfigControl.get('coreConfig');
  const webAgentConfig = coreConfig?.tools?.webAgent || {};
  if (webAgentConfig.enabled !== true || webAgentConfig.allowDownloads !== true) {
    return { success: false, error: '群聊网页 Agent 下载功能未启用' };
  }
  if (!toolCtx.groupId || !toolCtx.event) {
    return { success: false, error: '网页文件下载目前只支持群聊' };
  }

  const rawTargetUrl = normalizeOptionalString(args.url);
  if (!rawTargetUrl) return { success: false, error: '下载地址不能为空' };
  let targetUrl;
  try {
    targetUrl = await validateWebReadTargetUrl(rawTargetUrl);
  } catch (error) {
    return { success: false, error: error.message };
  }

  const timeoutMs = normalizeClientTimeout(args.timeout_ms || webAgentConfig.timeoutMs || 30000);
  const maxBytes = normalizeDownloadLimit(webAgentConfig.maxDownloadBytes);
  const startedAt = Date.now();
  const downloadDir = path.join(process.cwd(), 'temp', 'crystelf-plugin', 'web-agent-downloads');
  const response = await axios.get(targetUrl, {
    responseType: 'arraybuffer',
    timeout: timeoutMs,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    maxRedirects: 0,
    validateStatus: () => true,
  }).catch(error => ({ error }));

  if (response?.error) {
    return { success: false, error: response.error.response?.data?.message || response.error.message };
  }
  const status = Number(response.status || 0);
  if (status < 200 || status >= 300) {
    return { success: false, status, error: `下载请求返回 HTTP ${status}` };
  }
  const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data || '');
  if (buffer.length > maxBytes) {
    return { success: false, error: `文件超过大小限制（${maxBytes} 字节）` };
  }

  const contentType = String(response.headers?.['content-type'] || '').split(';')[0].trim();
  const filename = normalizeDownloadFilename(args.filename, targetUrl, contentType);
  const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${filename}`;
  const filePath = path.join(downloadDir, storedName);
  await fs.mkdir(downloadDir, { recursive: true });
  await fs.writeFile(filePath, buffer);
  try {
    await Group.sendGroupFile(toolCtx.event, toolCtx.groupId, filePath, filename);
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => {});
    return { success: false, error: `文件发送失败：${error.message}` };
  }

  const cleanupTimer = setTimeout(() => fs.rm(filePath, { force: true }).catch(() => {}), 5 * 60 * 1000);
  cleanupTimer.unref?.();
  logger.info(`[toolRegistry] download_web_file 成功 | group=${toolCtx.groupId} | url="${targetUrl}" | filename="${filename}" | bytes=${buffer.length} | elapsed_ms=${Date.now() - startedAt}`);
  return {
    success: true,
    filename,
    bytes: buffer.length,
    content_type: contentType || 'application/octet-stream',
    sent_to_group: String(toolCtx.groupId),
    elapsed_ms: Date.now() - startedAt,
  };
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseIpv4ToInt(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return null;
    }
    value = (value << 8) + num;
  }
  return value >>> 0;
}

function isIpv4InCidr(ip, base, prefix) {
  const ipValue = parseIpv4ToInt(ip);
  const baseValue = parseIpv4ToInt(base);
  if (ipValue === null || baseValue === null) {
    return false;
  }
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipValue & mask) === (baseValue & mask);
}

function isBlockedWebReadIpAddress(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const ipType = net.isIP(normalized);
  if (!ipType) {
    return false;
  }

  if (ipType === 4) {
    return isIpv4InCidr(normalized, '0.0.0.0', 8)
      || isIpv4InCidr(normalized, '10.0.0.0', 8)
      || isIpv4InCidr(normalized, '100.64.0.0', 10)
      || isIpv4InCidr(normalized, '127.0.0.0', 8)
      || isIpv4InCidr(normalized, '169.254.0.0', 16)
      || isIpv4InCidr(normalized, '172.16.0.0', 12)
      || isIpv4InCidr(normalized, '192.168.0.0', 16)
      || isIpv4InCidr(normalized, '198.18.0.0', 15)
      || isIpv4InCidr(normalized, '224.0.0.0', 4);
  }

  if (normalized === '::' || normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    return net.isIP(mappedIpv4) === 4 ? isBlockedWebReadIpAddress(mappedIpv4) : true;
  }
  if (/^fe[89ab]/.test(normalized)) {
    return true;
  }
  if (/^f[cd]/.test(normalized)) {
    return true;
  }
  if (/^ff/.test(normalized)) {
    return true;
  }
  return false;
}

function isBlockedWebReadHostname(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) {
    return true;
  }
  return normalized === 'localhost' || normalized.endsWith('.localhost');
}

async function validateWebReadTargetUrl(value = '') {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('网页地址格式不正确');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('网页读取仅允许 http/https 地址');
  }
  if (parsed.username || parsed.password) {
    throw new Error('网页读取地址不允许包含账号密码');
  }

  const hostname = String(parsed.hostname || '').trim().toLowerCase();
  if (isBlockedWebReadHostname(hostname) || isBlockedWebReadIpAddress(hostname)) {
    throw new Error('网页读取拒绝访问本机或内网地址');
  }
  const lookupHostname = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(lookupHostname)) {
    return parsed.toString();
  }

  let records = [];
  try {
    records = await dns.lookup(lookupHostname, { all: true, verbatim: true });
  } catch {
    throw new Error('网页读取目标域名解析失败');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('网页读取目标域名解析失败');
  }
  if (records.some(record => isBlockedWebReadIpAddress(record?.address))) {
    throw new Error('网页读取拒绝访问解析到本机或内网的地址');
  }

  return parsed.toString();
}

function sanitizeText(value, maxLength = 240) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeMarkdownText(value, maxLength = 12000) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

async function appendSearchDebugLog(payload) {
  try {
    await fs.mkdir(SEARCH_DEBUG_DIR, { recursive: true });
    await fs.appendFile(
      SEARCH_DEBUG_FILE,
      `${JSON.stringify({ time: new Date().toISOString(), ...payload }, null, 2)}\n`,
      'utf8'
    );
  } catch (error) {
    logger.warn(`[toolRegistry] search_web 本地调试日志写入失败: ${error.message}`);
  }
}

function isSameConfiguredEndpoint(primary = {}, fallback = {}, key = 'apiUrl') {
  return String(primary?.[key] || '').trim() === String(fallback?.[key] || '').trim()
    && String(primary?.apiKey || '').trim() === String(fallback?.apiKey || '').trim();
}

function hasSearchEndpoint(searchConfig = {}) {
  return Boolean(String(searchConfig.apiUrl || '').trim());
}

function hasMarkdownEndpoint(searchConfig = {}) {
  return Boolean(String(searchConfig.markdownApiUrl || '').trim() && String(searchConfig.markdownStatusUrl || '').trim());
}

function formatSearchResponse(data = {}, args = {}, searchConfig = {}, payload = {}) {
  const rawResultsSource = data.results || data.data || data.items || [];
  const rawResults = Array.isArray(rawResultsSource) ? rawResultsSource : [];
  const rawLimit = Number(args.limit ?? searchConfig.maxResults ?? 5);
  const maxResults = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5, 1), 10);
  const results = rawResults.slice(0, maxResults).map((item, index) => ({
    index: index + 1,
    title: sanitizeText(item.title || item.name || '无标题', 120),
    url: sanitizeText(item.url || item.link || '', 300),
    snippet: sanitizeText(item.snippet || item.description || item.content || '', 320),
    content: sanitizeText(item.content || '', 500),
    source: sanitizeText(item.source || item.site || item.domain || '', 80),
    domain: sanitizeText(item.domain || '', 120),
    publish_time: item.publish_time || undefined,
    score: item.score ?? undefined,
  }));

  const validResults = results.filter(item => item.title || item.url || item.snippet);
  const summary = validResults
    .map(item => {
      const meta = [item.source || item.domain, item.publish_time].filter(Boolean).join(' | ');
      return `${item.index}. ${item.title}${meta ? ` [${meta}]` : ''}\n链接: ${item.url || '无'}\n摘要: ${item.snippet || '无'}`;
    })
    .join('\n\n');

  return {
    success: true,
    query: payload.query,
    count: validResults.length,
    totalResults: data.total_results || rawResults.length || 0,
    results: validResults,
    summary,
  };
}

async function requestSearchWeb(searchConfig = {}, payload = {}, args = {}, clientTimeoutMs = 60000) {
  const response = await axios.post(searchConfig.apiUrl, payload, {
    headers: {
      'Content-Type': 'application/json',
      ...(searchConfig.apiKey ? { Authorization: `Bearer ${searchConfig.apiKey}` } : {}),
    },
    timeout: clientTimeoutMs,
  });

  return formatSearchResponse(response.data || {}, args, searchConfig, payload);
}

async function requestWebMarkdown(searchConfig = {}, targetUrl = '', clientTimeoutMs = 20000, markdownMaxLength = 12000) {
  const headers = {
    'Content-Type': 'application/json',
    ...(searchConfig.apiKey ? { Authorization: `Bearer ${searchConfig.apiKey}` } : {}),
  };

  const submitResp = await axios.post(searchConfig.markdownApiUrl, null, {
    headers,
    params: { url: targetUrl },
    timeout: clientTimeoutMs,
  });
  const taskId = submitResp.data?.task_id || submitResp.data?.id || submitResp.data?.data?.task_id || submitResp.data?.data?.id;
  if (!taskId) {
    return {
      success: false,
      error: '网页转 Markdown 接口未返回 task_id',
    };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < clientTimeoutMs) {
    await sleep(1500);
    const statusResp = await axios.get(`${String(searchConfig.markdownStatusUrl || '').replace(/\/+$/, '')}/${encodeURIComponent(taskId)}`, {
      headers,
      timeout: clientTimeoutMs,
    });
    const data = statusResp.data || {};
    if (data.status === 'completed') {
      const markdown = sanitizeMarkdownText(data.result?.markdown || '', markdownMaxLength);
      return {
        success: true,
        url: targetUrl,
        task_id: taskId,
        markdown,
        size: data.result?.size || markdown.length,
      };
    }
    if (data.status === 'failed') {
      return {
        success: false,
        error: data.error || '网页转 Markdown 任务失败',
        task_id: taskId,
      };
    }
  }

  return {
    success: false,
    error: '网页转 Markdown 任务等待超时',
    task_id: taskId,
  };
}

async function retryWebMarkdownFallbackIfNeeded({
  result,
  fallbackMarkdownConfig,
  targetUrl,
  clientTimeoutMs,
  markdownMaxLength,
  reason = '',
}) {
  if (result?.success && String(result.markdown || '').trim()) {
    return result;
  }
  if (!fallbackMarkdownConfig) {
    return result;
  }

  logger.warn(`[toolRegistry] fetch_web_markdown 尝试备用API | url="${targetUrl}" | reason=${reason || result?.error || '主接口未返回可用正文'}`);
  try {
    const fallbackResult = await requestWebMarkdown(fallbackMarkdownConfig, targetUrl, clientTimeoutMs, markdownMaxLength);
    return {
      ...fallbackResult,
      fallback: true,
    };
  } catch (fallbackError) {
    logger.error(`[toolRegistry] fetch_web_markdown 备用失败 | url="${targetUrl}" | error=${fallbackError.response?.data?.message || fallbackError.message}`);
    return result;
  }
}

async function searchWeb(args = {}) {
  const coreConfig = await ConfigControl.get('coreConfig');
  const searchConfig = coreConfig?.tools?.search || {};

  if (!searchConfig.enabled) {
    return {
      success: false,
      error: '内置搜索工具未启用',
    };
  }

  const fallbackSearchConfig = buildSearchFallbackConfig(searchConfig, 'search');
  const circuitConfig = buildVirtualApiCircuitConfig(searchConfig, fallbackSearchConfig, 'search');
  if (!hasSearchEndpoint(searchConfig) && !fallbackSearchConfig?.apiUrl) {
    return {
      success: false,
      error: '未配置搜索API地址',
    };
  }

  const apiTimeoutMs = normalizeApiTimeout(args.timeout_ms || searchConfig.timeoutMs || 30000);
  const clientTimeoutMs = normalizeClientTimeout(searchConfig.timeoutMs || 60000);
  const startedAt = Date.now();

  const payload = {
    query: args.query || '',
    site: normalizeOptionalString(args.site),
    filetype: normalizeOptionalString(args.filetype),
    fetch_full: args.fetch_full ?? searchConfig.fetchFull ?? false,
    timeout_ms: apiTimeoutMs,
  };

  if (!payload.query) {
    return {
      success: false,
      error: '搜索关键词不能为空',
    };
  }

  logger.info(
    `[toolRegistry] search_web 开始 | query="${payload.query}" | site="${payload.site || ''}" | filetype="${payload.filetype || ''}" | fetch_full=${payload.fetch_full} | api_timeout_ms=${apiTimeoutMs} | client_timeout_ms=${clientTimeoutMs}`
  );
  await appendSearchDebugLog({
    stage: 'start',
    query: payload.query,
    site: payload.site || '',
    filetype: payload.filetype || '',
    fetch_full: payload.fetch_full,
    api_timeout_ms: apiTimeoutMs,
    client_timeout_ms: clientTimeoutMs,
  });

  const preferSearchFallback = shouldPreferFallbackApi(circuitConfig, 'search_web');
  const usedSearchFallbackFirst = !hasSearchEndpoint(searchConfig) || (preferSearchFallback.preferFallback && fallbackSearchConfig?.apiUrl);
  try {
    const result = !usedSearchFallbackFirst
      ? await requestSearchWeb(searchConfig, payload, args, clientTimeoutMs)
      : await requestSearchWeb(fallbackSearchConfig, payload, args, clientTimeoutMs);
    if (usedSearchFallbackFirst) {
      recordFallbackApiSuccess(circuitConfig, 'search_web');
    } else {
      recordPrimaryApiSuccess(circuitConfig, 'search_web');
    }

    logger.info(
      `[toolRegistry] search_web 成功 | query="${payload.query}" | result_count=${result.count} | total_results=${result.totalResults || 0} | elapsed_ms=${Date.now() - startedAt}${usedSearchFallbackFirst ? ' | fallback=true' : ''}`
    );
    await appendSearchDebugLog({
      stage: 'success',
      query: payload.query,
      result_count: result.count,
      total_results: result.totalResults || 0,
      elapsed_ms: Date.now() - startedAt,
      fallback: usedSearchFallbackFirst,
      summary: result.summary,
      results: result.results,
    });

    return {
      success: true,
      query: payload.query,
      count: result.count,
      results: result.results,
      summary: result.summary,
      fallback: usedSearchFallbackFirst,
    };
  } catch (error) {
    const failureMessage = error.response?.data?.message || error.message;
    if (usedSearchFallbackFirst) {
      recordFallbackApiFailure(circuitConfig, 'search_web', failureMessage);
    } else {
      recordPrimaryApiFailure(circuitConfig, 'search_web', failureMessage);
    }
    logger.error(
      `[toolRegistry] search_web 失败 | query="${payload.query}" | status=${error.response?.status || 'none'} | api_timeout_ms=${apiTimeoutMs} | client_timeout_ms=${clientTimeoutMs} | elapsed_ms=${Date.now() - startedAt} | error=${failureMessage}`
    );
    await appendSearchDebugLog({
      stage: 'failure',
      query: payload.query,
      status: error.response?.status || 'none',
      api_timeout_ms: apiTimeoutMs,
      client_timeout_ms: clientTimeoutMs,
      elapsed_ms: Date.now() - startedAt,
      error: failureMessage,
      response_data: error.response?.data || null,
    });
    if (!usedSearchFallbackFirst && hasSearchEndpoint(searchConfig) && fallbackSearchConfig && !isSameConfiguredEndpoint(searchConfig, fallbackSearchConfig, 'apiUrl')) {
      try {
        logger.warn(`[toolRegistry] search_web 主接口失败，尝试备用API | query="${payload.query}" | error=${failureMessage}`);
        const fallbackStartedAt = Date.now();
        const fallbackResult = await requestSearchWeb(fallbackSearchConfig, payload, args, clientTimeoutMs);
        recordFallbackApiSuccess(circuitConfig, 'search_web');
        logger.info(
          `[toolRegistry] search_web 备用成功 | query="${payload.query}" | result_count=${fallbackResult.count} | total_results=${fallbackResult.totalResults || 0} | elapsed_ms=${Date.now() - fallbackStartedAt}`
        );
        await appendSearchDebugLog({
          stage: 'fallback_success',
          query: payload.query,
          result_count: fallbackResult.count,
          total_results: fallbackResult.totalResults || 0,
          elapsed_ms: Date.now() - fallbackStartedAt,
          summary: fallbackResult.summary,
          results: fallbackResult.results,
        });
        return {
          success: true,
          query: payload.query,
          count: fallbackResult.count,
          results: fallbackResult.results,
          summary: fallbackResult.summary,
          fallback: true,
        };
      } catch (fallbackError) {
        const fallbackMessage = fallbackError.response?.data?.message || fallbackError.message;
        recordFallbackApiFailure(circuitConfig, 'search_web', fallbackMessage);
        logger.error(`[toolRegistry] search_web 备用失败 | query="${payload.query}" | error=${fallbackMessage}`);
        await appendSearchDebugLog({
          stage: 'fallback_failure',
          query: payload.query,
          status: fallbackError.response?.status || 'none',
          elapsed_ms: Date.now() - startedAt,
          error: fallbackMessage,
          response_data: fallbackError.response?.data || null,
        });
      }
    }
    return {
      success: false,
      error: failureMessage,
    };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWebMarkdown(args = {}) {
  const coreConfig = await ConfigControl.get('coreConfig');
  const searchConfig = coreConfig?.tools?.search || {};
  if (!searchConfig.enabled) {
    return {
      success: false,
      error: '内置搜索工具未启用',
    };
  }
  const fallbackMarkdownConfig = buildSearchFallbackConfig(searchConfig, 'markdown');
  const circuitConfig = buildVirtualApiCircuitConfig(searchConfig, fallbackMarkdownConfig, 'markdown');
  if (!hasMarkdownEndpoint(searchConfig) && !fallbackMarkdownConfig) {
    return {
      success: false,
      error: '未配置网页转 Markdown 接口地址',
    };
  }

  const rawTargetUrl = normalizeOptionalString(args.url);
  if (!rawTargetUrl) {
    return {
      success: false,
      error: '网页地址不能为空',
    };
  }
  let targetUrl;
  try {
    targetUrl = await validateWebReadTargetUrl(rawTargetUrl);
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  const clientTimeoutMs = normalizeMarkdownTimeout(args.timeout_ms || searchConfig.timeoutMs || 20000);
  const markdownMaxLength = Math.min(Math.max(Number(args.max_length || searchConfig.markdownMaxLength || 12000), 1000), 40000);
  logger.info(
    `[toolRegistry] fetch_web_markdown 开始 | url="${targetUrl}" | client_timeout_ms=${clientTimeoutMs} | max_length=${markdownMaxLength}`
  );

  const preferMarkdownFallback = shouldPreferFallbackApi(circuitConfig, 'fetch_web_markdown');
  const usedMarkdownFallbackFirst = !hasMarkdownEndpoint(searchConfig) || (preferMarkdownFallback.preferFallback && fallbackMarkdownConfig);
  try {
    const activeConfig = !usedMarkdownFallbackFirst
      ? searchConfig
      : fallbackMarkdownConfig;
    const result = await requestWebMarkdown(activeConfig, targetUrl, clientTimeoutMs, markdownMaxLength);
    if (usedMarkdownFallbackFirst) {
      if (result?.success && String(result.markdown || '').trim()) {
        recordFallbackApiSuccess(circuitConfig, 'fetch_web_markdown');
      } else {
        recordFallbackApiFailure(circuitConfig, 'fetch_web_markdown', result?.error || '备用网页读取未返回可用正文');
      }
      return { ...result, fallback: true };
    }
    if (result?.success && String(result.markdown || '').trim()) {
      recordPrimaryApiSuccess(circuitConfig, 'fetch_web_markdown');
    } else {
      recordPrimaryApiFailure(circuitConfig, 'fetch_web_markdown', result?.error || '网页读取未返回可用正文');
    }
    const fallbackRetryResult = await retryWebMarkdownFallbackIfNeeded({
      result,
      fallbackMarkdownConfig: fallbackMarkdownConfig && !isSameConfiguredEndpoint(searchConfig, fallbackMarkdownConfig, 'markdownApiUrl') ? fallbackMarkdownConfig : null,
      targetUrl,
      clientTimeoutMs,
      markdownMaxLength,
    });
    if (fallbackRetryResult?.fallback) {
      if (fallbackRetryResult?.success && String(fallbackRetryResult.markdown || '').trim()) {
        recordFallbackApiSuccess(circuitConfig, 'fetch_web_markdown');
      } else {
        recordFallbackApiFailure(circuitConfig, 'fetch_web_markdown', fallbackRetryResult?.error || '备用网页读取未返回可用正文');
      }
    }
    return fallbackRetryResult;
  } catch (error) {
    if (usedMarkdownFallbackFirst) {
      recordFallbackApiFailure(circuitConfig, 'fetch_web_markdown', error.response?.data?.message || error.message);
    } else {
      recordPrimaryApiFailure(circuitConfig, 'fetch_web_markdown', error.response?.data?.message || error.message);
    }
    if (!usedMarkdownFallbackFirst && hasMarkdownEndpoint(searchConfig) && fallbackMarkdownConfig && !isSameConfiguredEndpoint(searchConfig, fallbackMarkdownConfig, 'markdownApiUrl')) {
      const fallbackResult = await retryWebMarkdownFallbackIfNeeded({
        result: { success: false, error: error.response?.data?.message || error.message },
        fallbackMarkdownConfig,
        targetUrl,
        clientTimeoutMs,
        markdownMaxLength,
        reason: error.response?.data?.message || error.message,
      });
      if (fallbackResult?.fallback) {
        if (fallbackResult?.success && String(fallbackResult.markdown || '').trim()) {
          recordFallbackApiSuccess(circuitConfig, 'fetch_web_markdown');
        } else {
          recordFallbackApiFailure(circuitConfig, 'fetch_web_markdown', fallbackResult?.error || '备用网页读取未返回可用正文');
        }
        return fallbackResult;
      }
    }
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

export async function getBuiltinTools(toolCtx = {}) {
  const commandBridgeTool = await getYunzaiCommandBridgeTool(toolCtx).catch(error => {
    logger.warn(`[toolRegistry] Yunzai 命令桥接初始化失败: ${error.message}`);
    return null;
  });
  const coreConfig = await ConfigControl.get('coreConfig');
  const pluginConfig = ConfigControl.get('config') || {};
  const webAgentConfig = coreConfig?.tools?.webAgent || {};
  const botLogDiagnosisTool = coreConfig?.tools?.logDiagnosis?.enabled === true
    && pluginConfig.logDiagnosis !== false
    ? buildBotLogDiagnosisTool(toolCtx, pluginConfig)
    : null;
  const webAgentTools = webAgentConfig.enabled === true
    && webAgentConfig.allowDownloads === true
    && toolCtx.groupId
    ? [{
        name: 'download_web_file',
        description: '使用受限网页 Agent 下载一个公网文件并直接发送到当前群。只有用户明确要求下载、保存或发送文件时才调用；不要下载网页正文、未知链接或可能包含敏感内容的文件。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '需要下载的公网文件 URL' },
            filename: { type: 'string', description: '可选的群文件名，不要包含路径' },
            timeout_ms: { type: 'integer', description: '可选，下载超时时间（毫秒）' },
          },
          required: ['url'],
        },
        returnToAI: true,
        stopOnFailure: true,
        handler: downloadWebFile,
      }]
    : [];
  return [
    {
      name: 'search_web',
      description: '使用内置搜索工具搜索最新网页、文档或指定站点内容。适用于需要外部实时信息时。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词',
          },
          site: {
            type: 'string',
            description: '限定搜索的站点域名，可选',
          },
          filetype: {
            type: 'string',
            description: '限定文件类型，如 pdf/docx/txt，可选',
          },
          limit: {
            type: 'integer',
            description: '返回结果数量，建议 1-10',
          },
          fetch_full: {
            type: 'boolean',
            description: '是否获取完整正文，可选',
          },
          timeout_ms: {
            type: 'integer',
            description: '本次搜索超时时间，可选',
          },
        },
        required: ['query'],
      },
      returnToAI: true,
      stopOnFailure: true,
      handler: searchWeb,
    },
    {
      name: 'fetch_web_markdown',
      description: '读取指定网页正文并转换为 Markdown，适用于搜索后继续阅读网页内容。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '需要读取的网页地址',
          },
          max_length: {
            type: 'integer',
            description: '返回 Markdown 的最大字符数，可选',
          },
          timeout_ms: {
            type: 'integer',
            description: '本次网页读取超时时间，可选',
          },
        },
        required: ['url'],
      },
      returnToAI: true,
      stopOnFailure: true,
      handler: fetchWebMarkdown,
    },
    ...webAgentTools,
    ...(botLogDiagnosisTool ? [botLogDiagnosisTool] : []),
    ...getTtsTools(),
    ...(commandBridgeTool ? [commandBridgeTool] : []),
  ];
}

export { downloadWebFile, fetchWebMarkdown, searchWeb };
