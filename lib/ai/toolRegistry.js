import axios from 'axios';
import dns from 'dns/promises';
import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import ConfigControl from '../config/configControl.js';
import { getTtsTools } from './ttsRegistry.js';

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

async function searchWeb(args = {}) {
  const coreConfig = await ConfigControl.get('coreConfig');
  const searchConfig = coreConfig?.tools?.search || {};

  if (!searchConfig.enabled) {
    return {
      success: false,
      error: '内置搜索工具未启用',
    };
  }

  if (!searchConfig.apiUrl) {
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

  try {
    const response = await axios.post(searchConfig.apiUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(searchConfig.apiKey ? { Authorization: `Bearer ${searchConfig.apiKey}` } : {}),
      },
      timeout: clientTimeoutMs,
    });

    const data = response.data || {};
    const rawResults = data.results || data.data || data.items || [];
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

    logger.info(
      `[toolRegistry] search_web 成功 | query="${payload.query}" | result_count=${validResults.length} | total_results=${data.total_results || rawResults.length || 0} | elapsed_ms=${Date.now() - startedAt}`
    );
    await appendSearchDebugLog({
      stage: 'success',
      query: payload.query,
      result_count: validResults.length,
      total_results: data.total_results || rawResults.length || 0,
      elapsed_ms: Date.now() - startedAt,
      summary,
      results: validResults,
    });

    return {
      success: true,
      query: payload.query,
      count: validResults.length,
      results: validResults,
      summary,
    };
  } catch (error) {
    const failureMessage = error.response?.data?.message || error.message;
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
  if (!searchConfig.markdownApiUrl || !searchConfig.markdownStatusUrl) {
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
  const headers = {
    'Content-Type': 'application/json',
    ...(searchConfig.apiKey ? { Authorization: `Bearer ${searchConfig.apiKey}` } : {}),
  };

  logger.info(
    `[toolRegistry] fetch_web_markdown 开始 | url="${targetUrl}" | client_timeout_ms=${clientTimeoutMs} | max_length=${markdownMaxLength}`
  );

  try {
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
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

export function getBuiltinTools() {
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
    ...getTtsTools(),
  ];
}

export { fetchWebMarkdown, searchWeb };
