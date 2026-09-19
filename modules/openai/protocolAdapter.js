// 主对话接入协议适配层：在 OpenAI 兼容格式之外支持 Anthropic（Claude Messages API）与 Grok（xAI）。
// - openai：原生 OpenAI 兼容格式（SDK 直连，含绝大多数中转/国产端点）；
// - grok：xAI 官方 API 本身就是 OpenAI 兼容格式，走 openai 同一条请求路径（baseApi 填 https://api.x.ai/v1）；
// - anthropic：wire 格式差异较大（x-api-key 头、system 顶层参数、content blocks、max_tokens 必填），
//   由本模块把内部 OpenAI 形态的消息映射为 Anthropic 请求，并把响应还原回内部形态。
import { buildAiUserAgentHeaders } from '../../lib/ai/userAgent.js';

const PROTOCOLS = new Set(['openai', 'anthropic', 'grok']);

const PROTOCOL_ALIASES = new Map([
  ['gork', 'grok'],
  ['xai', 'grok'],
  ['claude', 'anthropic'],
  ['messages', 'anthropic'],
  ['chatgpt', 'openai'],
  ['', 'openai'],
]);

export function normalizeAiProtocol(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return PROTOCOL_ALIASES.get(raw) || (PROTOCOLS.has(raw) ? raw : 'openai');
}

export function resolveAiProtocol(options = {}) {
  return normalizeAiProtocol(options?.apiProtocol ?? options?.protocol);
}

// 用量日志的提供方展示名
export function providerLabelForProtocol(protocol) {
  const normalized = normalizeAiProtocol(protocol);
  return normalized === 'anthropic' ? 'anthropic' : normalized === 'grok' ? 'grok' : 'openai-compatible';
}

const ANTHROPIC_VERSION = '2023-06-01';
// 思考型模型（GLM/Claude 等）会先输出 thinking block 再输出正文，4096 容易被思考吃满导致正文为空
const DEFAULT_MAX_TOKENS = 8192;

function joinTextParts(parts) {
  return parts.filter(Boolean).join('\n\n');
}

// OpenAI 形态的 content（字符串或分段数组）→ 文本（system 提取/工具结果平铺用）
function contentToPlainText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return joinTextParts(content.map(part => {
      if (part && typeof part === 'object' && part.type === 'text') return String(part.text || '');
      if (typeof part === 'string') return part;
      return '';
    }));
  }
  return '';
}

// image_url 分段 → Anthropic image block：data URL 转 base64 source，http(s) 转 url source
function mapImagePart(url) {
  const raw = String(url || '').trim();
  const dataMatch = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([\s\S]+)$/i);
  if (dataMatch) {
    const mediaType = dataMatch[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : dataMatch[1].toLowerCase();
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: dataMatch[2] } };
  }
  if (/^https?:\/\//i.test(raw)) {
    return { type: 'image', source: { type: 'url', url: raw } };
  }
  return null;
}

// OpenAI 消息分段数组 → Anthropic content blocks；无法映射的分段降级为 JSON 文本
function mapContentParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'text', text: contentToPlainText(content) }];
  const blocks = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: String(part.text || '') });
      continue;
    }
    if (part.type === 'image_url') {
      const imageBlock = mapImagePart(part.image_url?.url);
      if (imageBlock) blocks.push(imageBlock);
      continue;
    }
    if (part.type === 'image' && part.source) {
      blocks.push({ type: 'image', source: part.source });
      continue;
    }
    blocks.push({ type: 'text', text: `[未支持的分段类型 ${part.type}]` });
  }
  return blocks.length ? blocks : [{ type: 'text', text: '' }];
}

// OpenAI tools 定义 → Anthropic tools（function.parameters → input_schema）
export function mapToolsForAnthropic(tools) {
  if (!Array.isArray(tools)) return undefined;
  const mapped = [];
  for (const tool of tools) {
    const fn = tool?.type === 'function' ? tool.function : tool;
    const name = String(fn?.name || '').trim();
    if (!name) continue;
    mapped.push({
      name,
      description: String(fn?.description || ''),
      input_schema: fn?.parameters && typeof fn.parameters === 'object'
        ? fn.parameters
        : { type: 'object', properties: {} },
    });
  }
  return mapped.length ? mapped : undefined;
}

// 内部 OpenAI 形态消息 → { system, messages }
// - system/developer 消息抽出为顶层 system（Anthropic 不支持 system role）；
// - assistant 的 tool_calls → tool_use block；带 tool_call_id 的 tool 结果 → tool_result block；
//   不带 tool_call_id 的 tool 结果平铺为 user 文本（无关联上下文的降级处理）；
// - 相邻同角色合并（Anthropic 要求 user/assistant 交替），首条必须是 user。
export function mapMessagesForAnthropic(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const systemParts = [];
  const turns = [];
  for (const msg of source) {
    if (!msg || typeof msg !== 'object') continue;
    let role = String(msg.role || '').trim().toLowerCase();
    if (role === 'system' || role === 'developer') {
      const text = contentToPlainText(msg.content);
      if (text.trim()) systemParts.push(text);
      continue;
    }
    if (role === 'tool' || role === 'function') {
      const text = contentToPlainText(msg.content);
      if (msg.tool_call_id) {
        turns.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: String(msg.tool_call_id), content: [{ type: 'text', text }] }],
        });
      } else {
        turns.push({ role: 'user', content: [{ type: 'text', text: `[工具调用结果]\n${text}` }] });
      }
      continue;
    }
    if (role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const blocks = [];
      const text = typeof msg.content === 'string' ? msg.content : contentToPlainText(msg.content);
      if (text.trim()) blocks.push({ type: 'text', text });
      for (const call of msg.tool_calls) {
        let input = {};
        try {
          input = JSON.parse(call?.function?.arguments || '{}');
          if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
        } catch {
          input = {};
        }
        blocks.push({
          type: 'tool_use',
          id: String(call?.id || `toolu_${Math.random().toString(36).slice(2, 12)}`),
          name: String(call?.function?.name || ''),
          input,
        });
      }
      turns.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (role !== 'user' && role !== 'assistant') role = 'user';
    turns.push({ role, content: mapContentParts(msg.content) });
  }

  const merged = [];
  for (const turn of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) {
      prev.content = [...prev.content, ...turn.content];
    } else {
      merged.push(turn);
    }
  }
  if (merged.length && merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: [{ type: 'text', text: '（请继续）' }] });
  }
  if (!merged.length) {
    merged.push({ role: 'user', content: [{ type: 'text', text: '（请继续）' }] });
  }

  const system = joinTextParts(systemParts);
  return { system, messages: merged };
}

export function buildAnthropicMessagesUrl(baseUrl = '') {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Anthropic baseApi 未配置');
  if (/\/messages$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

// 生成 Anthropic Messages API 的 fetch 参数：{ url, headers, body }
export function buildAnthropicRequest({ baseUrl, apiKey, model, temperature, messages, timeout, maxTokens, outputLimit, userAgentOptions, tools } = {}) {
  const { system, messages: anthropicMessages } = mapMessagesForAnthropic(messages);
  // 默认输出上限：优先 models.dev 里该模型的真实输出上限（封顶 32768 防网关挑剔），未知模型回退 8192
  const outputCap = Number.isFinite(Number(outputLimit)) && Number(outputLimit) > 0 ? Math.min(Number(outputLimit), 32768) : 0;
  const body = {
    model: String(model || ''),
    max_tokens: Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0 ? Number(maxTokens) : (outputCap || DEFAULT_MAX_TOKENS),
    messages: anthropicMessages,
  };
  // Anthropic temperature 取值 0-1（OpenAI 0-2），超界会被 400 拒绝
  const temp = Number(temperature);
  if (Number.isFinite(temp)) body.temperature = Math.min(1, Math.max(0, temp));
  if (system.trim()) body.system = system;
  const anthropicTools = mapToolsForAnthropic(tools);
  if (anthropicTools) body.tools = anthropicTools;

  return {
    url: buildAnthropicMessagesUrl(baseUrl),
    headers: {
      'content-type': 'application/json',
      'x-api-key': String(apiKey || ''),
      'anthropic-version': ANTHROPIC_VERSION,
      ...buildAiUserAgentHeaders(userAgentOptions || {}),
    },
    body,
    timeoutMs: Number(timeout) > 0 ? Number(timeout) : 60000,
  };
}

// Anthropic usage → OpenAI 形态（供 usageLogger 等既有消费方使用）
export function mapAnthropicUsageToOpenai(usage = {}) {
  const input = Number(usage?.input_tokens) || 0;
  const output = Number(usage?.output_tokens) || 0;
  const extra = Number(usage?.cache_creation_input_tokens) || 0;
  return {
    prompt_tokens: input + extra,
    completion_tokens: output,
    total_tokens: input + extra + output,
  };
}

// 解析 Anthropic Messages 响应 → { text, usage, stopReason }
// 错误响应（type:error）抛异常；空文本正常返回（由调用方的 isFailureResult 决定是否重试）。
export function parseAnthropicResponse(json) {
  if (json && json.type === 'error') {
    const message = json?.error?.message || json?.error?.type || 'Anthropic 返回错误';
    throw new Error(message);
  }
  const content = Array.isArray(json?.content) ? json.content : [];
  const text = joinTextParts(content.filter(block => block?.type === 'text').map(block => String(block.text || '')));
  const toolUses = content
    .filter(block => block?.type === 'tool_use')
    .map(block => ({ id: String(block.id || ''), name: String(block.name || ''), input: block.input ?? {} }));
  return {
    text,
    toolUses,
    // 观测用：内容块类型（thinking 模型排查空正文时看这个）
    blockTypes: content.map(block => String(block?.type || '')),
    usage: mapAnthropicUsageToOpenai(json?.usage),
    stopReason: String(json?.stop_reason || ''),
  };
}

// Anthropic 解析结果 → OpenAI completion 形态（供 aiCaller 的 direct/tool 补全路径无感消费）
export function buildOpenAiCompletionFromAnthropic(parsed, model = '') {
  const message = { role: 'assistant', content: parsed?.text || '' };
  if (Array.isArray(parsed?.toolUses) && parsed.toolUses.length) {
    message.tool_calls = parsed.toolUses.map(t => ({
      id: t.id || `call_${Math.random().toString(36).slice(2, 12)}`,
      type: 'function',
      function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
    }));
  }
  const finishReason = parsed?.stopReason === 'tool_use'
    ? 'tool_calls'
    : parsed?.stopReason === 'max_tokens' ? 'length' : 'stop';
  return {
    choices: [{ message, finish_reason: finishReason }],
    usage: parsed?.usage,
    model,
  };
}

// fetch 响应 → 解析结果；HTTP 非 2xx 抛错并附带 status（withRetry 据此决定 429/5xx 是否重试）
export async function fetchAnthropicMessages({ url, headers, body, timeoutMs }) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : 60000),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // 非 JSON 响应（网关错误页等）按错误处理
  }
  if (!response.ok) {
    const message = json?.error?.message || json?.error?.type || `Anthropic HTTP ${response.status}`;
    throw Object.assign(new Error(String(message).slice(0, 500)), { status: response.status });
  }
  return parseAnthropicResponse(json);
}
