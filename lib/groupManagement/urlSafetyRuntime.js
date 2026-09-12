import fs from 'fs';
import path from 'path';
import AiCaller from '../ai/aiCaller.js';
import { fetchWebMarkdown } from '../ai/toolRegistry.js';
import { writeFileAtomic } from '../utils/atomicStore.js';

const URL_SAFETY_CACHE_FILE = path.join(process.cwd(), 'data', 'crystelf', 'group-management', 'url-safety-cache.json');
const URL_SAFETY_CACHE_LIMIT = 2000;
let urlSafetyCacheLoaded = false;
let urlSafetyCacheStore = { items: {} };
const RISK_SCORE = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureCacheLoaded() {
  if (urlSafetyCacheLoaded) return;
  urlSafetyCacheLoaded = true;
  try {
    if (!fs.existsSync(URL_SAFETY_CACHE_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(URL_SAFETY_CACHE_FILE, 'utf8'));
    if (isPlainObject(parsed)) {
      urlSafetyCacheStore = {
        items: isPlainObject(parsed.items) ? parsed.items : {},
      };
    }
  } catch (error) {
    logger.warn(`[group-management] URL安全缓存读取失败: ${error.message}`);
    urlSafetyCacheStore = { items: {} };
  }
}

function writeCacheStore() {
  try {
    fs.mkdirSync(path.dirname(URL_SAFETY_CACHE_FILE), { recursive: true });
    const entries = Object.entries(urlSafetyCacheStore.items || {})
      .filter(([, value]) => isPlainObject(value?.result))
      .sort((left, right) => String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || '')))
      .slice(0, URL_SAFETY_CACHE_LIMIT);
    urlSafetyCacheStore.items = Object.fromEntries(entries);
    writeFileAtomic(URL_SAFETY_CACHE_FILE, JSON.stringify({
      updatedAt: new Date().toISOString(),
      items: urlSafetyCacheStore.items,
    }, null, 2));
  } catch (error) {
    logger.warn(`[group-management] URL安全缓存写入失败: ${error.message}`);
  }
}

function normalizeWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value = '', maxLength = 600) {
  const text = normalizeWhitespace(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeRiskLevel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return ['none', 'low', 'medium', 'high'].includes(normalized) ? normalized : 'none';
}

function riskMeetsThreshold(riskLevel = 'none', threshold = 'high') {
  return Number(RISK_SCORE[normalizeRiskLevel(riskLevel)] || 0) >= Number(RISK_SCORE[normalizeRiskLevel(threshold)] || RISK_SCORE.high);
}

function parseJsonObject(text = '') {
  const source = String(text || '').trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeExtractedUrl(value = '') {
  let raw = String(value || '').trim();
  raw = raw.replace(/^[<([{'"“‘]+/, '').replace(/[>)]}'"”’。，、；;!?！？]+$/g, '');
  if (!raw) return '';
  if (/^www\./i.test(raw)) raw = `https://${raw}`;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function extractUrlsFromGroupMessage(text = '', maxUrls = 2) {
  const source = String(text || '');
  if (!source) return [];
  const urls = [];
  const seen = new Set();
  const pattern = /(?:https?:\/\/|www\.)[^\s<>"'“”‘’]+/gi;
  for (const match of source.matchAll(pattern)) {
    const normalized = normalizeExtractedUrl(match[0]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= maxUrls) break;
  }
  return urls;
}

function buildCacheKey(url = '') {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '').trim();
  }
}

function getCachedReview(url = '') {
  ensureCacheLoaded();
  const key = buildCacheKey(url);
  const cached = urlSafetyCacheStore.items?.[key];
  if (!cached) return null;
  return cached.result || null;
}

function setCachedReview(url = '', result = {}) {
  ensureCacheLoaded();
  const key = buildCacheKey(url);
  urlSafetyCacheStore.items[key] = {
    updatedAt: new Date().toISOString(),
    result,
  };
  writeCacheStore();
}

function normalizeWhitelistRule(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

function getUrlMatchParts(url = '') {
  try {
    const parsed = new URL(url);
    const hostname = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '');
    const pathname = String(parsed.pathname || '/').replace(/\/+$/, '');
    return {
      hostname,
      full: `${hostname}${pathname}${parsed.search || ''}`.replace(/\/+$/, ''),
    };
  } catch {
    return {
      hostname: '',
      full: normalizeWhitelistRule(url),
    };
  }
}

function matchWhitelistRule(url = '', whitelist = []) {
  const rules = Array.isArray(whitelist) ? whitelist : [];
  if (rules.length === 0) return '';
  const parts = getUrlMatchParts(url);
  for (const rawRule of rules) {
    const rule = normalizeWhitelistRule(rawRule);
    if (!rule) continue;
    if (rule.startsWith('*.')) {
      const domain = rule.slice(2);
      if (parts.hostname === domain || parts.hostname.endsWith(`.${domain}`)) return rawRule;
      continue;
    }
    if (rule.includes('/')) {
      if (
        parts.full === rule
        || parts.full.startsWith(`${rule}/`)
        || parts.full.startsWith(`${rule}?`)
      ) {
        return rawRule;
      }
      continue;
    }
    if (parts.hostname === rule || parts.hostname.endsWith(`.${rule}`)) return rawRule;
  }
  return '';
}

function buildUrlSafetyPrompt({ url = '', messageText = '', markdown = '' } = {}) {
  return [
    '你是QQ群链接安全审核助手。请严格只输出 JSON，不要输出 JSON 以外内容。',
    '判断群员发送的 URL 是否存在明显安全风险、诈骗、钓鱼、诱导加群、赌博色情、恶意下载、仿冒登录、虚假中奖、灰产引流、违法交易等问题。',
    '不要因为正常新闻、文档、代码仓库、视频网站、普通商品页而判高风险；证据不足时 riskLevel 用 none 或 low。',
    'JSON 字段必须为：safe(boolean)、riskLevel(none|low|medium|high)、categories(string[])、reason(string)、summary(string)。',
    '',
    `URL: ${url}`,
    `群员原消息: ${truncateText(messageText, 1200)}`,
    '',
    `网页Markdown正文(可能为空或截断):\n${String(markdown || '').slice(0, 12000)}`,
  ].join('\n');
}

function normalizeReviewPayload(raw = {}, url = '', markdown = '', fromCache = false) {
  const riskLevel = normalizeRiskLevel(raw.riskLevel || raw.risk_level);
  return {
    success: true,
    url,
    safe: raw.safe === false ? false : !['medium', 'high'].includes(riskLevel),
    riskLevel,
    categories: Array.isArray(raw.categories)
      ? raw.categories.map(item => truncateText(item, 40)).filter(Boolean).slice(0, 8)
      : [],
    reason: truncateText(raw.reason || '', 240),
    summary: truncateText(raw.summary || '', 240),
    markdownPreview: truncateText(markdown, 360),
    fromCache,
  };
}

async function reviewUrlWithLlm(url = '', messageText = '', markdown = '', context = {}) {
  const prompt = buildUrlSafetyPrompt({ url, messageText, markdown });
  const result = await AiCaller.callAiDirect(prompt, [], [], null, [], {
    scene: 'group_url_safety',
    sessionId: context.groupId ? `group:${context.groupId}` : 'group:url-safety',
    groupId: context.groupId,
    userId: context.userId,
    temperature: 0,
    max_tokens: 360,
    systemPrompt: '你只输出严格 JSON。不要输出 Markdown，不要解释。',
  });
  if (!result.success) {
    return {
      success: false,
      url,
      error: result.error || 'URL 安全审核模型调用失败',
    };
  }
  const parsed = parseJsonObject(result.response);
  if (!parsed) {
    return {
      success: false,
      url,
      error: 'URL 安全审核模型未返回有效 JSON',
      rawResponse: truncateText(result.response || '', 240),
    };
  }
  return normalizeReviewPayload(parsed, url, markdown, false);
}

export async function checkMessageUrlsSafety(messageText = '', cfg = {}, context = {}) {
  const urlSafety = cfg.urlSafety || {};
  if (urlSafety.enabled !== true) {
    return {
      checked: false,
      urls: [],
      results: [],
      signals: [],
    };
  }

  const urls = extractUrlsFromGroupMessage(messageText, Number(urlSafety.maxUrlsPerMessage || 2));
  if (urls.length === 0) {
    return {
      checked: false,
      urls: [],
      results: [],
      signals: [],
    };
  }

  const results = [];
  const signals = [];
  for (const url of urls) {
    const whitelistRule = matchWhitelistRule(url, urlSafety.whitelist || []);
    if (whitelistRule) {
      results.push({
        success: true,
        url,
        skipped: true,
        skipReason: 'whitelist',
        whitelistRule,
        safe: true,
        riskLevel: 'none',
        categories: [],
        reason: 'URL 命中白名单，已跳过安全检查',
        summary: '',
      });
      continue;
    }

    const cached = getCachedReview(url);
    if (cached) {
      results.push({ ...cached, fromCache: true });
      if (riskMeetsThreshold(cached.riskLevel, urlSafety.riskThreshold)) {
        signals.push(`URL安全风险(${cached.riskLevel}): ${cached.reason || cached.summary || url}`);
      }
      continue;
    }

    let markdown = '';
    try {
      const markdownResult = await fetchWebMarkdown({
        url,
        max_length: Number(urlSafety.markdownMaxLength || 6000),
        timeout_ms: Number(urlSafety.timeoutMs || 20000),
      });
      if (!markdownResult.success) {
        const failedReview = {
          success: false,
          url,
          error: markdownResult.error || '网页转 Markdown 失败',
          taskId: markdownResult.task_id || markdownResult.taskId || '',
        };
        setCachedReview(url, failedReview);
        results.push(failedReview);
        continue;
      }
      markdown = markdownResult.markdown || '';
    } catch (error) {
      const failedReview = {
        success: false,
        url,
        error: error.message || '网页转 Markdown 失败',
      };
      setCachedReview(url, failedReview);
      results.push(failedReview);
      continue;
    }

    try {
      const review = await reviewUrlWithLlm(url, messageText, markdown, context);
      if (review.success) {
        setCachedReview(url, review);
        if (riskMeetsThreshold(review.riskLevel, urlSafety.riskThreshold)) {
          signals.push(`URL安全风险(${review.riskLevel}): ${review.reason || review.summary || url}`);
        }
      } else {
        setCachedReview(url, review);
      }
      results.push(review);
    } catch (error) {
      logger.warn(`[group-management] URL安全审核失败: ${error.message}`);
      const failedReview = {
        success: false,
        url,
        error: error.message || 'URL 安全审核失败',
      };
      setCachedReview(url, failedReview);
      results.push(failedReview);
    }
  }

  return {
    checked: true,
    urls,
    results,
    signals: Array.from(new Set(signals)),
  };
}
