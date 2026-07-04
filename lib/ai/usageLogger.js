import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const USAGE_DEBUG_DIR = path.join(process.cwd(), 'data', 'crystelf', 'debug');
const USAGE_DEBUG_FILE = path.join(USAGE_DEBUG_DIR, 'ai-usage.log');
const IMAGE_MONITOR_REVIEW_SCENE = 'image_monitor_review';

function formatLocalDateTime(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetRemainMinutes = String(absOffset % 60).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${sign}${offsetHours}:${offsetRemainMinutes}`;
}

function getDateKey(date = new Date()) {
  return typeof date === 'string'
    ? date.slice(0, 10)
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function getDailyUsageFile(date = new Date()) {
  return path.join(USAGE_DEBUG_DIR, `ai-usage-${getDateKey(date)}.log`);
}

function sanitizeValue(value, maxLength = 200) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return sanitizeValue(JSON.stringify(value), maxLength);
}

export function classifyAiUsageError(error = '') {
  const text = String(error || '').trim();
  const lower = text.toLowerCase();
  if (!text) return '';
  if (/超时|timeout|timed out|time out|abort|etimedout|econnaborted/i.test(text)) return 'timeout';
  if (/没有产出|空回复|empty response|no content|no valid|invalid.*content/i.test(text)) return 'empty_response';
  if (/429|rate limit|too many requests|quota|余额|额度|限流|请求过多/i.test(text)) return 'rate_limit';
  if (/401|403|unauthorized|forbidden|invalid api key|api key|apikey|认证|鉴权|权限/i.test(text)) return 'auth';
  if (/enotfound|econnreset|econnrefused|network|socket|fetch failed|dns|tls|ssl|证书|连接失败|连接被拒绝|网络/i.test(text)) return 'network';
  if (/400|bad request|invalid schema|invalid_request|参数|schema|json|tool|function/i.test(text)) return 'bad_request';
  if (/500|502|503|504|upstream|server error|gateway|服务不可用|上游|内部错误/i.test(text)) return 'upstream';
  if (/content policy|safety|moderation|blocked|拒绝|安全|合规|策略/i.test(text)) return 'safety';
  if (lower.includes('model')) return 'model';
  return 'other';
}

export function formatAiUsageErrorCategory(category = '') {
  const map = {
    timeout: '请求超时',
    empty_response: '模型空回复',
    rate_limit: '限流或额度',
    auth: '认证或权限',
    network: '网络连接',
    bad_request: '请求参数',
    upstream: '上游服务',
    safety: '安全策略',
    model: '模型错误',
    other: '其他错误',
  };
  return map[String(category || '').trim()] || '未分类';
}

function looksLikeImageMonitorPrompt(value = '') {
  const text = String(value || '');
  return text.includes('群聊图片监控助手')
    || text.includes('isMeme(boolean)')
    || text.includes('riskLevel(low|medium|high|none)');
}

export function normalizeUsageScene(entry = {}) {
  const rawScene = String(entry.scene || '').trim();
  const normalizedScene = rawScene.toLowerCase();
  if (rawScene && normalizedScene !== 'unknown') {
    if (normalizedScene === IMAGE_MONITOR_REVIEW_SCENE) {
      return IMAGE_MONITOR_REVIEW_SCENE;
    }
    return rawScene;
  }
  if (looksLikeImageMonitorPrompt(entry.prompt_preview || entry.promptPreview)) {
    return IMAGE_MONITOR_REVIEW_SCENE;
  }
  return rawScene ? normalizedScene : 'unknown';
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }

  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const totalTokens = Number(
    usage.total_tokens ?? promptTokens + completionTokens
  );

  return {
    prompt_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completion_tokens: Number.isFinite(completionTokens) ? completionTokens : 0,
    total_tokens: Number.isFinite(totalTokens) ? totalTokens : 0,
  };
}

export async function appendAiUsageLog(payload = {}) {
  try {
    await fs.mkdir(USAGE_DEBUG_DIR, { recursive: true });
    const now = new Date();
    const entry = `${JSON.stringify({ time: formatLocalDateTime(now), ...payload }, null, 2)}\n`;
    await fs.appendFile(USAGE_DEBUG_FILE, entry, 'utf8');
    await fs.appendFile(getDailyUsageFile(now), entry, 'utf8');
  } catch (error) {
    logger.warn(`[usageLogger] AI 用量日志写入失败: ${error.message}`);
  }
}

export async function logAiUsage(entry = {}) {
  const usage = normalizeUsage(entry.usage);
  const errorCategory = entry.error ? (entry.errorCategory || classifyAiUsageError(entry.error)) : '';
  const logEntry = {
    stage: entry.stage || 'complete',
    scene: sanitizeValue(normalizeUsageScene(entry), 80),
    model: sanitizeValue(entry.model || 'unknown', 160),
    provider: sanitizeValue(entry.provider || 'openai-compatible', 80),
    session_id: sanitizeValue(entry.sessionId, 120),
    group_id: sanitizeValue(entry.groupId, 80),
    user_id: sanitizeValue(entry.userId, 80),
    message_count: Number.isFinite(Number(entry.messageCount)) ? Number(entry.messageCount) : undefined,
    has_tools: Boolean(entry.hasTools),
    tool_count: Number.isFinite(Number(entry.toolCount)) ? Number(entry.toolCount) : undefined,
    elapsed_ms: Number.isFinite(Number(entry.elapsedMs)) ? Number(entry.elapsedMs) : undefined,
    prompt_preview: sanitizeValue(entry.promptPreview, 240),
    response_preview: sanitizeValue(entry.responsePreview, 240),
    prompt_tokens: usage?.prompt_tokens,
    completion_tokens: usage?.completion_tokens,
    total_tokens: usage?.total_tokens,
    raw_usage: entry.usage || undefined,
    estimated: entry.estimated === true,
    error: sanitizeValue(entry.error, 240),
    error_category: errorCategory ? sanitizeValue(errorCategory, 80) : undefined,
    error_category_label: errorCategory ? sanitizeValue(formatAiUsageErrorCategory(errorCategory), 80) : undefined,
  };

  await appendAiUsageLog(logEntry);
}

function extractJsonObjects(content) {
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth++;
      continue;
    }

    if (char === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(content.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
}

function safeReadUsageFileSync(date = new Date()) {
  try {
    const targetFile = getDailyUsageFile(date);
    if (!fsSync.existsSync(targetFile)) {
      return [];
    }

    const content = fsSync.readFileSync(targetFile, 'utf8');
    if (!content.trim()) {
      return [];
    }

    return extractJsonObjects(content)
      .map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    logger.warn(`[usageLogger] 读取 AI 用量日志失败: ${error.message}`);
    return [];
  }
}

function buildDailyUsageSummary(entries, dateKey) {
  const summary = {
    date: dateKey,
    request_count: 0,
    success_count: 0,
    error_count: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_cost: 0,
    completion_cost: 0,
    total_cost: 0,
    by_scene: {},
    by_model: {},
    by_model_cost: {},
  };

  for (const entry of entries) {
    const entryDate = String(entry?.time || '').slice(0, 10);
    if (entryDate !== dateKey) {
      continue;
    }

    summary.request_count += 1;
    if (entry.stage === 'success') {
      summary.success_count += 1;
    }
    if (entry.stage === 'error' || entry.stage === 'empty_response') {
      summary.error_count += 1;
    }

    const promptTokens = Number(entry.prompt_tokens || 0);
    const completionTokens = Number(entry.completion_tokens || 0);
    const totalTokens = Number(entry.total_tokens || 0);
    summary.prompt_tokens += Number.isFinite(promptTokens) ? promptTokens : 0;
    summary.completion_tokens += Number.isFinite(completionTokens) ? completionTokens : 0;
    summary.total_tokens += Number.isFinite(totalTokens) ? totalTokens : 0;

    const scene = normalizeUsageScene(entry);
    if (!summary.by_scene[scene]) {
      summary.by_scene[scene] = { requests: 0, total_tokens: 0 };
    }
    summary.by_scene[scene].requests += 1;
    summary.by_scene[scene].total_tokens += Number.isFinite(totalTokens) ? totalTokens : 0;

    const model = String(entry.model || 'unknown');
    if (!summary.by_model[model]) {
      summary.by_model[model] = { requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    }
    summary.by_model[model].requests += 1;
    summary.by_model[model].prompt_tokens += Number.isFinite(promptTokens) ? promptTokens : 0;
    summary.by_model[model].completion_tokens += Number.isFinite(completionTokens) ? completionTokens : 0;
    summary.by_model[model].total_tokens += Number.isFinite(totalTokens) ? totalTokens : 0;
  }

  return summary;
}

function formatBreakdownMap(map) {
  const entries = Object.entries(map || {})
    .sort((a, b) => (b[1]?.total_tokens || 0) - (a[1]?.total_tokens || 0))
    .slice(0, 10)
    .map(([key, value]) => `${key}: ${value.requests}次 / ${value.total_tokens} tokens`);

  return entries.length > 0 ? entries.join('\n') : '暂无数据';
}

function parseModelPricingMap(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [model = '', prompt = '', completion = ''] = line.split('|').map(part => part.trim());
      return {
        model,
        promptPricePer1M: Number(prompt || 0),
        completionPricePer1M: Number(completion || 0),
      };
    })
    .filter(item => item.model);
}

function resolveModelPricing(model, pricing = {}) {
  const normalizedModel = String(model || '').trim();
  const modelPricingList = parseModelPricingMap(pricing?.modelPricing);
  const matched = modelPricingList.find(item => item.model === normalizedModel);
  if (matched) {
    return {
      currencySymbol: pricing?.currencySymbol || '$',
      promptPricePer1M: Number(matched.promptPricePer1M || 0),
      completionPricePer1M: Number(matched.completionPricePer1M || 0),
    };
  }

  return {
    currencySymbol: pricing?.currencySymbol || '$',
    promptPricePer1M: Number(pricing?.promptPricePer1M || 0),
    completionPricePer1M: Number(pricing?.completionPricePer1M || 0),
  };
}

function calculateUsageCost(promptTokens, completionTokens, pricing = {}) {
  const promptCost = (Number(promptTokens || 0) / 1000000) * Number(pricing?.promptPricePer1M || 0);
  const completionCost = (Number(completionTokens || 0) / 1000000) * Number(pricing?.completionPricePer1M || 0);
  return {
    prompt_cost: promptCost,
    completion_cost: completionCost,
    total_cost: promptCost + completionCost,
  };
}

function applyPricing(summary, pricing = {}) {
  const enabled = pricing?.enabled !== false;

  if (!enabled) {
    return {
      ...summary,
      prompt_cost: 0,
      completion_cost: 0,
      total_cost: 0,
    };
  }

  const entries = Object.entries(summary.by_model || {});
  let promptCost = 0;
  let completionCost = 0;
  const byModelCost = {};

  for (const [model, value] of entries) {
    const modelPricing = resolveModelPricing(model, pricing);
    const promptTokens = Number(value.prompt_tokens || 0);
    const completionTokens = Number(value.completion_tokens || 0);
    const cost = calculateUsageCost(promptTokens, completionTokens, modelPricing);
    promptCost += cost.prompt_cost;
    completionCost += cost.completion_cost;
    byModelCost[model] = {
      requests: value.requests,
      total_tokens: value.total_tokens,
      total_cost: cost.total_cost,
      currencySymbol: modelPricing.currencySymbol,
    };
  }

  return {
    ...summary,
    prompt_cost: promptCost,
    completion_cost: completionCost,
    total_cost: promptCost + completionCost,
    by_model_cost: byModelCost,
  };
}

function formatMoney(value, pricing = {}) {
  const currency = pricing?.currencySymbol || '$';
  return `${currency}${Number(value || 0).toFixed(6)}`;
}

export function getDailyUsageSummarySync(date = new Date(), pricing = {}) {
  const dateKey = getDateKey(date);
  const entries = safeReadUsageFileSync(date);
  return buildDailyUsageSummary(entries, dateKey);
}

export function getDailyUsageEntriesSync(date = new Date()) {
  return safeReadUsageFileSync(date);
}

export function getLatestUsageEntrySync(date = new Date()) {
  const entries = safeReadUsageFileSync(date)
    .filter(Boolean)
    .sort((a, b) => String(a?.time || '').localeCompare(String(b?.time || '')));
  return entries[entries.length - 1] || null;
}

export function getUsageOverviewSync(date = new Date(), pricing = {}) {
  const summary = applyPricing(getDailyUsageSummarySync(date, pricing), pricing);
  const modelPricingList = parseModelPricingMap(pricing?.modelPricing);
  return {
    ...summary,
    summary_text: [
      `日期: ${summary.date}`,
      `请求数: ${summary.request_count}`,
      `成功: ${summary.success_count}`,
      `失败: ${summary.error_count}`,
      `输入Tokens: ${summary.prompt_tokens}`,
      `输出Tokens: ${summary.completion_tokens}`,
      `总Tokens: ${summary.total_tokens}`,
    ].join('\n'),
    cost_text: [
      `日期: ${summary.date}`,
      `输入成本: ${formatMoney(summary.prompt_cost, pricing)}`,
      `输出成本: ${formatMoney(summary.completion_cost, pricing)}`,
      `预估总成本: ${formatMoney(summary.total_cost, pricing)}`,
      modelPricingList.length > 0 ? `已启用按模型单价(${modelPricingList.length}项)` : `输入单价/1M: ${formatMoney(pricing?.promptPricePer1M || 0, pricing)}`,
      modelPricingList.length > 0 ? `未匹配模型回退全局单价` : `输出单价/1M: ${formatMoney(pricing?.completionPricePer1M || 0, pricing)}`,
    ].join('\n'),
    scene_text: formatBreakdownMap(summary.by_scene),
    model_text: formatBreakdownMap(summary.by_model),
    model_cost_text: Object.entries(summary.by_model_cost || {})
      .sort((a, b) => (b[1]?.total_cost || 0) - (a[1]?.total_cost || 0))
      .slice(0, 10)
      .map(([model, value]) => `${model}: ${value.requests}次 / ${value.total_tokens} tokens / ${value.currencySymbol || pricing?.currencySymbol || '$'}${Number(value.total_cost || 0).toFixed(6)}`)
      .join('\n') || '暂无模型成本统计',
    daily_log_file: getDailyUsageFile(date),
    all_log_file: USAGE_DEBUG_FILE,
  };
}

export function shouldCircuitBreakSync(config = {}, scene = 'chat') {
  const usageConfig = config || {};
  if (!usageConfig.enabled) {
    return { blocked: false, reason: '' };
  }

  if (scene === 'chat' && usageConfig.blockChat === false) {
    return { blocked: false, reason: '' };
  }

  if (scene === 'poke' && usageConfig.blockPoke === false) {
    return { blocked: false, reason: '' };
  }

  const summary = getDailyUsageSummarySync();
  const dailyTokenLimit = Number(usageConfig.dailyTokenLimit || 0);
  const dailyRequestLimit = Number(usageConfig.dailyRequestLimit || 0);

  if (dailyTokenLimit > 0 && summary.total_tokens >= dailyTokenLimit) {
    return {
      blocked: true,
      reason: `今日 token 用量已达上限(${summary.total_tokens}/${dailyTokenLimit})`,
      summary,
    };
  }

  if (dailyRequestLimit > 0 && summary.request_count >= dailyRequestLimit) {
    return {
      blocked: true,
      reason: `今日请求次数已达上限(${summary.request_count}/${dailyRequestLimit})`,
      summary,
    };
  }

  return { blocked: false, reason: '', summary };
}
