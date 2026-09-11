import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'node:os';
import path from 'path';
import { spawn } from 'child_process';
import Path from '../../constants/path.js';
import {
  buildBundledOpenCodeEnvironment,
  getBundledOpenCodeModelRef,
  isBundledOpenCodeBootstrapError,
  resolveBundledOpenCodeBootstrapCommand,
  resolveBundledOpenCodeCommand,
} from './bundledOpenCodeRuntime.js';

const AGENT_TASK_LIMIT = 40;
const AGENT_MESSAGE_LIMIT = 40;
const AGENT_WORKSPACE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const AGENT_IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};
const AGENT_MESSAGE_TOOL_LIMIT = 20;
const AGENT_OUTPUT_LIMIT = 160000;
const AGENT_EVENT_LIMIT = 80;
const PROVIDER_PROBE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_PROBE_TIMEOUT_MS = 8000;
const PROVIDER_BOOTSTRAP_TIMEOUT_MS = 120000;
const GIT_STATUS_TIMEOUT_MS = 10000;
const AGENT_DIFF_LIMIT = 120000;
const AGENT_PERMISSION_LIMIT = 30;
const AGENT_QUESTION_LIMIT = 12;
const AGENT_STREAM_HEARTBEAT_MS = 15000;
const AGENT_PROGRESS_POLL_MS = 5000;
const AGENT_PROGRESS_MESSAGE_LIMIT = 6;
const AGENT_NOISY_EVENT_TYPES = new Set([
  'plugin.added',
  'catalog.updated',
  'reference.updated',
  'integration.updated',
  'message.part.delta',
  'session.status',
  'session.idle',
]);
const AGENT_TERMINAL_LIMIT = 6;
const AGENT_TERMINAL_OUTPUT_LIMIT = 120000;
const AGENT_ATTACHMENT_LIMIT = 4;
const AGENT_ATTACHMENT_BYTES_LIMIT = 5 * 1024 * 1024;
const AGENT_FOLLOW_UP_LIMIT = 12;
const AGENT_NATIVE_HISTORY_LIMIT = 500;
const AGENT_RUNTIME_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const AGENT_RUNTIME_LIMIT = 2;
const AGENT_SHARED_RUNTIME_KEY = 'opencode-shared';

const PROVIDER_DEFINITIONS = Object.freeze({
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    description: 'OpenCode CLI',
    binary: 'opencode',
  },
});

function createHttpError(statusCode, message, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getAgentRuntimeProfile(task = {}) {
  // 权限档已下沉到按请求 agent（crystelf-read/write/full），运行时只按 API 配置区分；
  // 同一 API 下只读与完全访问复用同一个 OpenCode 进程
  const customApi = task.customApi || {};
  return crypto.createHash('sha256')
    .update(`${customApi.enabled === true}:${customApi.baseApi || ''}:${customApi.apiKey || ''}`)
    .digest('hex')
    .slice(0, 12);
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeSingleLine(value = '', maxLength = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizePrompt(value = '', maxLength = 6000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function normalizeProviderId(value = '') {
  const providerId = String(value || '').trim().toLowerCase();
  return Object.hasOwn(PROVIDER_DEFINITIONS, providerId) ? providerId : 'opencode';
}

function normalizeMode(value = '') {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'full') return 'full';
  if (mode === 'edit') return 'edit';
  return mode === 'patch' ? 'patch' : 'analyze';
}

function normalizeAgentPriority(value = '') {
  const priority = String(value || '').trim().toLowerCase();
  return ['high', 'low'].includes(priority) ? priority : 'normal';
}

function getAgentPriorityWeight(value = '') {
  return { high: 0, normal: 1, low: 2 }[normalizeAgentPriority(value)] ?? 1;
}

function isWriteMode(mode = '') {
  return ['edit', 'full'].includes(normalizeMode(mode));
}

function isFullAccessMode(mode = '') {
  return normalizeMode(mode) === 'full';
}

function normalizeModel(value = '') {
  const model = String(value || '').trim();
  if (!model) return '';
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(model)) {
    throw createHttpError(400, '模型名称只能包含字母、数字、点、斜杠、冒号、下划线和短横线', 'AGENT_MODEL_INVALID');
  }
  return model;
}

function normalizeModelVariant(value = '') {
  const variant = String(value || '').trim();
  if (!variant) return '';
  if (!/^[A-Za-z0-9._:/-]{1,80}$/.test(variant)) {
    throw createHttpError(400, '思考等级只能包含字母、数字、点、斜杠、冒号、下划线和短横线', 'AGENT_MODEL_VARIANT_INVALID');
  }
  return variant;
}

// 解析任务应使用的 OpenCode agent：自定义名透传；内置 plan/build 按模式映射权限档
function resolveOpenCodeTaskAgent(task = {}) {
  const custom = normalizeOpenCodeAgent(task.agent || '', '');
  if (custom && custom !== 'plan' && custom !== 'build') return custom;
  if (isFullAccessMode(task.mode)) return 'crystelf-full';
  if (isWriteMode(task.mode)) return 'crystelf-write';
  return 'crystelf-read';
}

function normalizeOpenCodeAgent(value = '', fallback = '') {
  const agent = String(value || fallback || '').trim();
  if (!agent) return '';
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(agent)) {
    throw createHttpError(400, 'Agent 名称格式无效', 'AGENT_NAME_INVALID');
  }
  return agent;
}

function normalizeModelProviderId(value = '') {
  const providerId = String(value || '').trim();
  if (!providerId) return '';
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(providerId)) {
    throw createHttpError(400, '模型提供方格式无效', 'AGENT_MODEL_PROVIDER_INVALID');
  }
  return providerId;
}

function buildOpenCodeModelSelection(model = '', providerId = '') {
  const modelId = normalizeModel(model);
  if (!modelId) return null;
  const normalizedProvider = normalizeModelProviderId(providerId);
  if (normalizedProvider) return { providerID: normalizedProvider, modelID: modelId };
  const separator = modelId.indexOf('/');
  if (separator > 0) {
    return {
      providerID: normalizeModelProviderId(modelId.slice(0, separator)),
      modelID: normalizeModel(modelId.slice(separator + 1)),
    };
  }
  return { providerID: 'crystelf', modelID: modelId };
}

export function buildAgentDefaultModelSelection(options = {}) {
  const aiConfig = options.aiConfig && typeof options.aiConfig === 'object' ? options.aiConfig : {};
  const customApi = options.customApi?.enabled === true ? options.customApi : {};
  const apiSource = Object.keys(customApi).length ? customApi : aiConfig;
  const model = normalizeSingleLine(
    apiSource.model || apiSource.modelType || aiConfig.modelType || aiConfig.workingModel || '',
    180,
  );
  if (!model) return null;
  return buildOpenCodeModelSelection(getBundledOpenCodeModelRef(model));
}

function normalizeCustomAgentApi(value = {}) {
  const baseApi = String(value?.baseApi || '').trim().replace(/\/+$/, '').slice(0, 500);
  if (baseApi && !/^https?:\/\/[^\s]+$/i.test(baseApi)) {
    throw createHttpError(400, '自定义 API 地址必须是 http 或 https 地址', 'AGENT_CUSTOM_API_URL_INVALID');
  }
  return {
    enabled: value?.enabled === true,
    baseApi,
    apiKey: String(value?.apiKey || '').replace(/[\r\n]/g, '').trim().slice(0, 500),
    model: value?.model ? normalizeModel(value.model) : '',
    userAgent: String(value?.userAgent || '').replace(/[\r\n]/g, '').trim().slice(0, 200),
  };
}

function normalizeNativeOpenCodeConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { mcp: {}, agent: {}, command: {} };
  const normalizeMap = (source, maxEntries = 40) => Object.fromEntries(Object.entries(source || {})
    .filter(([key, item]) => /^[A-Za-z0-9._-]{1,100}$/.test(key) && item && typeof item === 'object' && !Array.isArray(item))
    .slice(0, maxEntries)
    .map(([key, item]) => [key, JSON.parse(JSON.stringify(item))]));
  return {
    mcp: normalizeMap(value.mcp),
    agent: normalizeMap(value.agent),
    command: normalizeMap(value.command),
  };
}

function maskNativeOpenCodeConfig(value = {}) {
  const sensitive = /key|token|secret|password|passwd|authorization|cookie/i;
  const visit = (item, key = '') => {
    if (sensitive.test(key)) return item ? '已配置' : '';
    if (Array.isArray(item)) return item.slice(0, 100).map(entry => visit(entry, key));
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).slice(0, 100).map(([childKey, childValue]) => [childKey, visit(childValue, childKey)]));
  };
  return visit(normalizeNativeOpenCodeConfig(value));
}

function mergeMaskedNativeOpenCodeConfig(nextValue = {}, currentValue = {}) {
  const merge = (next, current) => {
    if (next === '已配置' && current) return current;
    if (Array.isArray(next)) return next.map((item, index) => merge(item, current?.[index]));
    if (!next || typeof next !== 'object') return next;
    return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, merge(value, current?.[key])]));
  };
  return normalizeNativeOpenCodeConfig(merge(nextValue, currentValue));
}

function normalizeOpenCodeSessionId(value = '') {
  const sessionId = String(value || '').trim();
  if (!sessionId) return '';
  if (!/^ses_[A-Za-z0-9]+$/.test(sessionId)) {
    throw createHttpError(400, 'OpenCode 会话 ID 格式无效', 'AGENT_SESSION_ID_INVALID');
  }
  return sessionId;
}

function normalizeOpenCodeMessageId(value = '') {
  const messageId = String(value || '').trim();
  return /^msg_[A-Za-z0-9]+$/.test(messageId) ? messageId : '';
}

function normalizeAgentDelivery(value = '') {
  return String(value || '').trim().toLowerCase() === 'steer' ? 'steer' : 'queue';
}

function extractOpenCodeMessageId(value = '') {
  const matches = String(value || '').match(/"messageID"\s*:\s*"(msg_[A-Za-z0-9]+)"/g) || [];
  return matches.length ? normalizeOpenCodeMessageId(matches.at(-1)?.match(/msg_[A-Za-z0-9]+/)?.[0]) : '';
}

const AGENT_MODEL_VISION_CACHE_RELATIVE = path.join('agent-cli-runtime', 'cache', 'opencode', 'models.json');
let agentModelVisionCache = { mtimeMs: 0, map: null };

// 返回 true/false（有结论）或 null（模型不在模型库里，无法判定）
// 模型库缓存（models.dev）→ Map<短模型名, { vision, contextLimit }>
function getAgentModelMetaMap() {
  try {
    const cachePath = path.join(Path.data, AGENT_MODEL_VISION_CACHE_RELATIVE);
    const mtimeMs = fs.statSync(cachePath).mtimeMs;
    if (!agentModelVisionCache.map || agentModelVisionCache.mtimeMs !== mtimeMs) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const map = new Map();
      for (const provider of Object.values(data)) {
        const models = provider && typeof provider === 'object' ? provider.models : null;
        if (!models || typeof models !== 'object') continue;
        for (const [modelId, meta] of Object.entries(models)) {
          if (!meta || typeof meta !== 'object') continue;
          const shortId = String(modelId).split('/').pop().toLowerCase();
          const vision = meta.attachment === true
            || (Array.isArray(meta.modalities?.input) && meta.modalities.input.includes('image'))
            || meta.capabilities?.input?.image === true;
          const contextLimit = Math.max(0, Number(meta.limit?.context || 0));
          const existing = map.get(shortId);
          if (!existing) {
            map.set(shortId, { vision, contextLimit });
          } else if (!existing.contextLimit && contextLimit) {
            existing.contextLimit = contextLimit;
          }
        }
      }
      agentModelVisionCache = { mtimeMs, map };
    }
    return agentModelVisionCache.map;
  } catch {
    return null;
  }
}

function lookupAgentModelVision(modelName = '') {
  const key = String(modelName || '').trim().toLowerCase();
  if (!key) return null;
  const map = getAgentModelMetaMap();
  if (!map || !map.has(key)) return null;
  return map.get(key).vision === true;
}

function lookupAgentModelContextLimit(modelName = '') {
  const key = String(modelName || '').trim().toLowerCase();
  if (!key) return 0;
  const map = getAgentModelMetaMap();
  return map && map.has(key) ? Math.max(0, Number(map.get(key).contextLimit || 0)) : 0;
}

// models.dev 查不到时的高置信纯文本家族兜底（模糊命名家族如 qwen/glm 不在此列，避免误杀）
const AGENT_TEXT_ONLY_MODEL_PATTERNS = [
  /^deepseek/i,
  /^minimax/i,
  /^kimi/i,
  /^mistral/i,
  /^command-?r/i,
  /^doubao/i,
  /^ernie/i,
  /^hunyuan/i,
];

function isLikelyTextOnlyModel(modelName = '') {
  const name = String(modelName || '').toLowerCase();
  if (!name) return false;
  if (/vl|vision|omni|image|gpt-4o|gpt-4\.1|gpt-5|o[34]-|claude|gemini|pixtral/.test(name)) return false;
  return AGENT_TEXT_ONLY_MODEL_PATTERNS.some(pattern => pattern.test(name));
}

// 带图片附件提交前校验：确定不支持图片的模型直接拒绝，省一轮注定空响应的执行
function assertAgentImageSupport(modelName = '') {
  const model = String(modelName || '').trim();
  if (!model) return;
  const fromCache = lookupAgentModelVision(model);
  const unsupported = fromCache === false || (fromCache === null && isLikelyTextOnlyModel(model));
  if (unsupported) {
    throw createHttpError(
      422,
      `当前模型 ${model} 不支持图片输入，请切换视觉模型或移除图片附件后重试`,
      'AGENT_MODEL_IMAGE_UNSUPPORTED',
    );
  }
}

function normalizeTaskAttachments(value = []) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, AGENT_ATTACHMENT_LIMIT).map(item => {
    const name = normalizeSingleLine(item?.name || '附件', 180);
    const mime = normalizeSingleLine(item?.mime || 'application/octet-stream', 120).toLowerCase();
    const url = String(item?.url || '').trim();
    const match = url.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) throw createHttpError(400, `附件“${name}”格式无效`, 'AGENT_ATTACHMENT_INVALID');
    const size = Math.floor((match[2].length * 3) / 4) - (match[2].endsWith('==') ? 2 : (match[2].endsWith('=') ? 1 : 0));
    if (size > AGENT_ATTACHMENT_BYTES_LIMIT) {
      throw createHttpError(400, `附件“${name}”超过 5 MB`, 'AGENT_ATTACHMENT_TOO_LARGE');
    }
    return { name, mime: match[1] || mime, url, size: Math.max(0, size) };
  });
}

function normalizeAgentFollowUps(value = []) {
  if (!Array.isArray(value)) return [];
  return value.slice(-AGENT_FOLLOW_UP_LIMIT).map(item => ({
    id: normalizeSingleLine(item?.id || '', 120),
    messageId: normalizeSingleLine(item?.messageId || '', 120),
    openCodeMessageId: normalizeOpenCodeMessageId(item?.openCodeMessageId || ''),
    prompt: normalizePrompt(item?.prompt || ''),
    attachments: normalizeTaskAttachments(item?.attachments),
    delivery: normalizeAgentDelivery(item?.delivery),
    state: ['pending', 'admitting'].includes(item?.state) ? 'pending' : String(item?.state || 'pending'),
    createdAt: item?.createdAt || new Date().toISOString(),
    admittedAt: item?.admittedAt || '',
    error: normalizeSingleLine(item?.error || '', 500),
  })).filter(item => item.id && item.messageId && item.prompt.length >= 2);
}

function stripAnsi(value = '') {
  return String(value || '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function normalizeTerminalOutput(value = '') {
  return redactAgentText(value)
    .replace(/\u0000\{"cursor":\d+\}/g, '')
    .replace(/\u0000/g, '');
}

// 模型偶尔把附件 data URL 当输出回吐，超长 base64 会把消息和界面撑爆：统一替换为占位符
function stripInlineImageData(value = '') {
  return String(value || '').replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{200,}/gi, 'data:image/[base64 已省略]');
}

function redactAgentText(value = '') {
  return stripAnsi(stripInlineImageData(value))
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|pwd|secret|cookie|token)\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|pwd|secret|cookie|token)"?\s*:\s*)("[^"]+"|'[^']+'|[^\s,;{}]+)/gi, '$1[REDACTED]');
}

function appendLimited(current = '', chunk = '', limit = AGENT_OUTPUT_LIMIT) {
  const next = `${current}${redactAgentText(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || ''))}`;
  return next.length > limit ? next.slice(-limit) : next;
}

export function extractAgentJsonError(value = '') {
  const lines = String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const payload = JSON.parse(line);
      if (payload?.type !== 'error') continue;
      const errorData = payload.error?.data || {};
      let responseMessage = '';
      try {
        const responseBody = JSON.parse(String(errorData.responseBody || ''));
        responseMessage = responseBody?.error?.message || responseBody?.message || '';
      } catch {
        responseMessage = '';
      }
      return normalizeSingleLine(
        errorData.message
        || responseMessage
        || payload.error?.message
        || payload.error?.name
        || 'Agent 返回错误事件',
        1000
      );
    } catch {
      // Ignore non-JSON output lines.
    }
  }
  return '';
}

export function extractOpenCodeSessionId(value = '') {
  const matches = String(value || '').match(/"sessionID"\s*:\s*"(ses_[A-Za-z0-9]+)"/g) || [];
  for (const match of matches) {
    const sessionId = match.match(/ses_[A-Za-z0-9]+/)?.[0] || '';
    if (sessionId) return sessionId;
  }
  return '';
}

function parseOpenCodeTurn(value = '') {
  const textParts = [];
  const reasoningParts = [];
  const tools = [];
  for (const line of String(value || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      if (trimmed) textParts.push(trimmed);
      continue;
    }
    try {
      const item = JSON.parse(trimmed);
      const part = item?.part || item;
      const partType = String(part?.type || item?.type || '').toLowerCase();
      const content = typeof part?.text === 'string'
        ? part.text
        : (typeof item?.text === 'string' ? item.text : '');
      if (partType === 'text' && content.trim()) textParts.push(stripInlineImageData(content.trim()));
      if (partType === 'reasoning' && content.trim()) reasoningParts.push(stripInlineImageData(content.trim()));
      if (partType === 'tool') {
        // read 等工具展示图片时，图片在 state.attachments 里以 data URL 存在；
        // 只保留小体积图片（各限 2 张 / ≤1.2MB base64），避免消息负载膨胀
        const toolImages = (Array.isArray(part?.state?.attachments) ? part.state.attachments : [])
          .filter(item => /^image\//i.test(String(item?.mime || '')))
          .filter(item => /^data:image\//i.test(String(item?.url || '')) && String(item.url).length <= 1600000)
          .slice(0, 2)
          .map(item => ({
            mime: normalizeSingleLine(item.mime, 80),
            url: String(item.url),
          }));
        tools.push({
          id: normalizeSingleLine(part?.id || item?.id || '', 120),
          name: normalizeSingleLine(part?.tool || part?.name || item?.tool || '工具调用', 120),
          status: normalizeSingleLine(part?.state?.status || part?.status || 'unknown', 40),
          input: redactAgentText(JSON.stringify(part?.state?.input ?? part?.input ?? {}, null, 2)).slice(0, 4000),
          output: redactAgentText(String(part?.state?.output ?? part?.output ?? '')).slice(0, 8000),
          images: toolImages,
        });
      }
    } catch {
      // Ignore non-JSON output lines here; raw output remains available for diagnostics.
    }
  }
  return {
    messageId: extractOpenCodeMessageId(value),
    content: textParts.join('\n\n').trim(),
    reasoning: reasoningParts.join('\n\n').trim(),
    tools: tools.slice(-AGENT_MESSAGE_TOOL_LIMIT),
  };
}

// 把一段 JSONL（每行 {type:'part', part}）按 messageID 拆成独立的助手步骤，
// 用于分步渲染：每步各自的正文/思考/工具调用，而不是全部拼接成一大段
function parseOpenCodeTurnSteps(value = '') {
  const steps = [];
  const indexByMessage = new Map();
  for (const line of String(value || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let item;
    try {
      item = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const part = item?.part || item;
    const partType = String(part?.type || item?.type || '').toLowerCase();
    if (part.synthetic === true) continue;
    const messageId = normalizeOpenCodeMessageId(part?.messageID || item?.messageID) || `step-${steps.length + 1}`;
    let step = indexByMessage.get(messageId);
    if (!step) {
      step = { messageId, content: '', reasoning: '', tools: [] };
      indexByMessage.set(messageId, step);
      steps.push(step);
    }
    const content = typeof part?.text === 'string' ? part.text : '';
    if (partType === 'text' && content.trim()) {
      const safeContent = stripInlineImageData(content.trim());
      step.content = step.content ? `${step.content}\n\n${safeContent}` : safeContent;
    } else if (partType === 'reasoning' && content.trim()) {
      const safeReasoning = stripInlineImageData(content.trim());
      step.reasoning = step.reasoning ? `${step.reasoning}\n\n${safeReasoning}` : safeReasoning;
    } else if (partType === 'tool') {
      step.tools.push({
        id: normalizeSingleLine(part?.id || item?.id || '', 120),
        name: normalizeSingleLine(part?.tool || part?.name || item?.tool || '工具调用', 120),
        status: normalizeSingleLine(part?.state?.status || part?.status || 'unknown', 40),
        input: redactAgentText(JSON.stringify(part?.state?.input ?? part?.input ?? {}, null, 2)).slice(0, 4000),
        output: redactAgentText(String(part?.state?.output ?? part?.output ?? '')).slice(0, 8000),
        images: [],
      });
    }
  }
  return steps;
}

function describeOpenCodeSessionError(value = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const name = String(raw.name || '').trim();
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  let message = String(data.message || raw.message || '').trim();
  // Bun 编译产物会把 "at fn (/chunk.js:1:2)" 调用栈拼进 message，只保留首句
  message = message.split(/\s+at\s+/)[0].replace(/[\s.]+$/, '').trim();
  if (/ProviderModelNotFound/i.test(name) || /^Model not found/i.test(message)) {
    const modelRef = (message.match(/Model not found:\s*([^\s.]+)/i)?.[1] || '').replace(/^[^/]+\//, '');
    return `模型不存在或当前服务商不可用${modelRef ? `：${modelRef}` : ''}`;
  }
  if (/ProviderAuthError/i.test(name) || /invalid api key|unauthorized|authentication/i.test(message)) {
    return 'API 密钥无效或无权限，请检查 API Key 配置';
  }
  if (/MessageOutputLength/i.test(name)) {
    return '模型输出长度达到上限，请缩小任务范围后重试';
  }
  const statusCode = Number(data.statusCode || 0);
  if (statusCode === 401 || statusCode === 403) return 'API 密钥无效或无权限，请检查 API Key 配置';
  if (statusCode === 402) return 'API 额度不足，请检查服务商账户余额';
  if (statusCode === 429) return '触发服务商限流，请稍后重试';
  if (statusCode >= 500) return `服务商服务异常（HTTP ${statusCode}），请稍后重试`;
  const label = [name === 'UnknownError' ? '' : name, message].filter(Boolean).join(': ');
  return normalizeSingleLine(label ? `OpenCode 执行异常：${label}` : 'OpenCode 执行异常：未知错误', 300);
}

function normalizeUsage(value = {}) {
  if (!value || typeof value !== 'object') return { input: 0, output: 0, total: 0 };
  const cache = value.cache && typeof value.cache === 'object' ? value.cache : {};
  const cacheRead = Number(cache.read ?? value.cacheRead ?? value.cache_read ?? value.cachedTokens ?? 0);
  const cacheWrite = Number(cache.write ?? value.cacheWrite ?? value.cache_write ?? 0);
  const reasoning = Number(value.reasoning ?? value.reasoningTokens ?? value.reasoning_tokens ?? 0);
  const rawInput = Number(value.input ?? value.inputTokens ?? value.promptTokens ?? value.prompt_tokens ?? 0);
  const rawOutput = Number(value.output ?? value.outputTokens ?? value.completionTokens ?? value.completion_tokens ?? 0);
  // OpenCode 的 input 只含本轮未缓存部分，历史上下文在 cache.read/write 里：
  // 上下文容量与 Token 用量都必须把缓存部分计回来（实测 total = input + cache.read/write + output）
  const input = rawInput
    + (Number.isFinite(cacheRead) ? Math.max(0, cacheRead) : 0)
    + (Number.isFinite(cacheWrite) ? Math.max(0, cacheWrite) : 0);
  const output = rawOutput + (Number.isFinite(reasoning) ? Math.max(0, reasoning) : 0);
  const total = Number(value.total ?? value.totalTokens ?? value.total_tokens ?? (input + output));
  return {
    input: Math.max(0, Number.isFinite(input) ? input : 0),
    output: Math.max(0, Number.isFinite(output) ? output : 0),
    total: Math.max(0, Number.isFinite(total) ? total : input + output),
  };
}

function extractOpenCodeUsage(messages = []) {
  const total = { input: 0, output: 0, total: 0 };
  if (!Array.isArray(messages)) return total;
  for (const message of messages) {
    const usage = normalizeUsage(message?.usage || message?.tokens || message?.info?.tokens || message?.info?.usage);
    total.input += usage.input;
    total.output += usage.output;
    total.total += usage.total;
  }
  return total;
}

function extractLatestOpenCodeContext(messages = []) {
  if (!Array.isArray(messages)) return { usage: 0, modelProviderId: '', modelId: '' };
  for (const message of [...messages].reverse()) {
    if (message?.info?.role !== 'assistant') continue;
    const info = message.info || message;
    const usage = normalizeUsage(info.tokens || info.usage || message.tokens || message.usage);
    const model = info.model && typeof info.model === 'object' ? info.model : {};
    return {
      usage: Math.max(0, Number(usage.input || usage.total || 0)),
      modelProviderId: normalizeSingleLine(
        info.providerID || info.providerId || model.providerID || model.providerId || '',
        120,
      ),
      modelId: normalizeSingleLine(
        info.modelID || info.modelId || model.modelID || model.modelId || model.id || '',
        180,
      ),
    };
  }
  return { usage: 0, modelProviderId: '', modelId: '' };
}

function normalizeOpenCodeTimestamp(value = '') {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    const milliseconds = number < 100000000000 ? number * 1000 : number;
    return new Date(milliseconds).toISOString();
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function normalizeOpenCodeHistoryMessages(messages = [], task = {}) {
  return (Array.isArray(messages) ? messages : []).map(item => {
    const info = item?.info && typeof item.info === 'object' ? item.info : item;
    const role = String(info?.role || '').toLowerCase();
    if (role !== 'user' && role !== 'assistant') return null;
    const messageId = normalizeOpenCodeMessageId(info?.id || info?.messageID || item?.messageID);
    const createdAt = normalizeOpenCodeTimestamp(info?.time?.created || info?.createdAt || info?.created);
    const finishedAt = normalizeOpenCodeTimestamp(info?.time?.completed || info?.finishedAt || info?.completed);
    if (role === 'user') {
      const localMessage = (Array.isArray(task.messages) ? task.messages : [])
        .find(message => message?.openCodeMessageId === messageId);
      const content = (Array.isArray(item?.parts) ? item.parts : [])
        .filter(part => String(part?.type || '').toLowerCase() === 'text')
        .map(part => String(part?.text || '').trim())
        .filter(Boolean)
        .join('\n\n');
      const attachments = (Array.isArray(item?.parts) ? item.parts : [])
        .filter(part => String(part?.type || '').toLowerCase() === 'file')
        .slice(0, AGENT_ATTACHMENT_LIMIT)
        .map(part => ({
          name: normalizeSingleLine(part?.filename || part?.name || '附件', 180),
          mime: normalizeSingleLine(part?.mime || part?.mediaType || '', 120),
          size: Math.max(0, Number(part?.size || 0)),
        }));
      return {
        id: messageId || `native-user-${crypto.randomBytes(4).toString('hex')}`,
        openCodeMessageId: messageId,
        role: 'user',
        content: redactAgentText(content),
        attachments,
        createdAt,
        mode: task.mode || 'analyze',
        status: 'sent',
        delivery: localMessage?.delivery || '',
      };
    }
    const parsed = parseOpenCodeTurn(openCodePartsToJsonl(item?.parts, task.opencodeSessionId));
    // 仅含工具调用/思考的中间步骤是正常链路；无文本+无思考+无工具才是空响应
    const emptyResponse = !parsed.content && !parsed.reasoning && parsed.tools.length === 0;
    return {
      id: messageId || `native-assistant-${crypto.randomBytes(4).toString('hex')}`,
      openCodeMessageId: messageId || parsed.messageId,
      role: 'assistant',
      content: parsed.content,
      reasoning: parsed.reasoning,
      tools: parsed.tools,
      createdAt,
      finishedAt,
      elapsedMs: createdAt && finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(createdAt)) : 0,
      mode: task.mode || 'analyze',
      status: emptyResponse ? 'error' : 'success',
      error: emptyResponse ? '模型返回了空响应（LLM 故障）' : '',
      stderrText: '',
      changedFiles: [],
      diffStat: '',
      diffText: '',
      usage: normalizeUsage(info?.tokens || info?.usage),
    };
  }).filter(Boolean);
}

function isPathInside(parentPath = '', targetPath = '') {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getComparablePath(targetPath = '') {
  const resolved = path.resolve(String(targetPath || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSamePath(left = '', right = '') {
  return getComparablePath(left) === getComparablePath(right);
}

function resolveExistingDirectory(targetPath = '') {
  try {
    const resolved = fs.realpathSync(path.resolve(String(targetPath || '')));
    return fs.statSync(resolved).isDirectory() ? resolved : '';
  } catch {
    return '';
  }
}

function normalizeWorktree(value = {}, baseWorkspace = null) {
  if (!value || typeof value !== 'object') return null;
  const directory = resolveExistingDirectory(value.directory || '');
  if (!directory || !baseWorkspace) return null;
  return {
    name: normalizeSingleLine(value.name || path.basename(directory), 120),
    branch: normalizeSingleLine(value.branch || '', 200),
    directory,
    baseWorkspaceId: baseWorkspace.id,
  };
}

export function normalizeAgentWorkbenchConfig(value = {}) {
  return {
    enabled: value?.enabled === true,
    writeEnabled: value?.writeEnabled === true,
    allowNetwork: value?.allowNetwork === true,
    allowAllDirectories: value?.allowAllDirectories === true,
    allowTerminal: value?.allowTerminal === true,
    outputImagesEnabled: value?.outputImagesEnabled === true,
    defaultProvider: normalizeProviderId(value?.defaultProvider),
    timeoutMs: clampInteger(value?.timeoutMs, 1800000, 60000, 7200000),
    maxConcurrentTasks: clampInteger(value?.maxConcurrentTasks, 1, 1, 2),
    maxOpenCodeRuntimes: clampInteger(value?.maxOpenCodeRuntimes, AGENT_RUNTIME_LIMIT, 1, 4),
    runtimeIdleTimeoutMs: clampInteger(value?.runtimeIdleTimeoutMs, AGENT_RUNTIME_IDLE_TIMEOUT_MS, 60000, 600000),
    manualContextLimit: clampInteger(value?.manualContextLimit, 0, 0, 10000000),
    autoCompactEnabled: value?.autoCompactEnabled !== false,
    autoCompactThreshold: clampInteger(value?.autoCompactThreshold, 80, 50, 95),
    compactModel: value?.compactModel ? normalizeModel(value.compactModel) : '',
    compactProviderId: value?.compactProviderId ? normalizeModelProviderId(value.compactProviderId) : '',
    providers: {
      opencode: value?.providers?.opencode !== false,
    },
    customApi: normalizeCustomAgentApi(value?.customApi),
    nativeConfig: normalizeNativeOpenCodeConfig(value?.nativeConfig),
    writableWorkspaces: {
      plugin: value?.writableWorkspaces?.plugin !== false,
      plugins: value?.writableWorkspaces?.plugins === true,
      yunzai: value?.writableWorkspaces?.yunzai === true,
    },
  };
}

export function getAgentWorkspaceOptions(options = {}) {
  const pluginRoot = resolveExistingDirectory(options.pluginRoot || Path.root);
  const yunzaiRoot = resolveExistingDirectory(options.yunzaiRoot || Path.yunzai);
  const pluginsRoot = resolveExistingDirectory(options.pluginsRoot || path.join(yunzaiRoot || Path.yunzai, 'plugins'));
  const candidates = [
    { id: 'plugin', label: '灵晶插件', path: pluginRoot, description: '仅分析 crystelf-plugin' },
    { id: 'plugins', label: 'Bot 插件目录', path: pluginsRoot, description: '分析已安装插件' },
    { id: 'yunzai', label: 'Yunzai 根目录', path: yunzaiRoot, description: '分析 Bot 整体项目' },
  ];
  const seen = new Set();
  return candidates.filter(item => {
    if (!item.path) return false;
    const key = process.platform === 'win32' ? item.path.toLowerCase() : item.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveAgentWorkspace(workspaceId = '', options = {}) {
  const id = String(workspaceId || '').trim();
  const workspaces = getAgentWorkspaceOptions(options);
  const workspace = workspaces.find(item => item.id === id) || workspaces[0];
  if (!workspace) {
    throw createHttpError(500, '没有可用的 Agent 工作目录', 'AGENT_WORKSPACE_UNAVAILABLE');
  }
  if (!workspaces.some(item => item.path === workspace.path && isPathInside(item.path, workspace.path))) {
    throw createHttpError(400, 'Agent 工作目录不在允许范围内', 'AGENT_WORKSPACE_DENIED');
  }
  return workspace;
}

function getWindowsNpmBases(env = process.env) {
  const values = [
    env.APPDATA ? path.join(env.APPDATA, 'npm') : '',
    ...String(env.PATH || '').split(path.delimiter),
  ];
  return Array.from(new Set(values.map(item => String(item || '').trim()).filter(Boolean)));
}

function canUseConfigDirectory(targetPath = '') {
  const resolved = path.resolve(String(targetPath || ''));
  let probeFile = '';
  let probeHandle = null;
  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return false;
    probeFile = path.join(resolved, `.crystelf-agent-write-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
    probeHandle = fs.openSync(probeFile, 'wx');
    fs.closeSync(probeHandle);
    probeHandle = null;
    fs.unlinkSync(probeFile);
    probeFile = '';
    return true;
  } catch {
    return false;
  } finally {
    if (probeHandle !== null) {
      try {
        fs.closeSync(probeHandle);
      } catch {
        // Ignore cleanup errors for the permission probe.
      }
    }
    if (probeFile) {
      try {
        fs.unlinkSync(probeFile);
      } catch {
        // Ignore cleanup errors for the permission probe.
      }
    }
  }
}

function applyWritableAgentDirectory(env, options = {}) {
  const envKey = String(options.envKey || '').trim();
  if (!envKey) return;
  const fallbackPath = path.join(options.fallbackRoot, options.fallbackName);
  if (options.forceFallback === true) {
    fs.mkdirSync(fallbackPath, { recursive: true });
    env[envKey] = fallbackPath;
    return;
  }
  const configuredPath = String(env[envKey] || '').trim();
  if (configuredPath) {
    try {
      fs.mkdirSync(configuredPath, { recursive: true });
    } catch {
      // Fall back to the plugin-owned runtime directory below.
    }
    if (canUseConfigDirectory(configuredPath)) return;
  }
  if (options.defaultPath && canUseConfigDirectory(options.defaultPath)) {
    delete env[envKey];
    return;
  }
  fs.mkdirSync(fallbackPath, { recursive: true });
  env[envKey] = fallbackPath;
}

export function buildAgentProcessEnv(env = process.env, options = {}) {
  const nextEnv = {
    ...env,
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
  const fallbackRoot = path.resolve(options.fallbackRoot || Path.data);
  const fallbackRuntimeRoot = path.join(fallbackRoot, 'agent-cli-runtime');
  if (options.forcePrivateRuntime === true) {
    const privateHome = path.join(fallbackRuntimeRoot, 'home');
    fs.mkdirSync(path.join(privateHome, '.config'), { recursive: true });
    nextEnv.HOME = privateHome;
    nextEnv.USERPROFILE = privateHome;
  }
  const userHome = String(nextEnv.HOME || nextEnv.USERPROFILE || '').trim();
  applyWritableAgentDirectory(nextEnv, {
    envKey: 'XDG_CONFIG_HOME',
    defaultPath: userHome ? path.join(userHome, '.config') : '',
    fallbackRoot: fallbackRuntimeRoot,
    fallbackName: 'config',
    forceFallback: options.forcePrivateRuntime === true,
  });
  applyWritableAgentDirectory(nextEnv, {
    envKey: 'XDG_DATA_HOME',
    defaultPath: userHome ? path.join(userHome, '.local', 'share') : '',
    fallbackRoot: fallbackRuntimeRoot,
    fallbackName: 'data',
    forceFallback: options.forcePrivateRuntime === true,
  });
  applyWritableAgentDirectory(nextEnv, {
    envKey: 'XDG_STATE_HOME',
    defaultPath: userHome ? path.join(userHome, '.local', 'state') : '',
    fallbackRoot: fallbackRuntimeRoot,
    fallbackName: 'state',
    forceFallback: options.forcePrivateRuntime === true,
  });
  applyWritableAgentDirectory(nextEnv, {
    envKey: 'XDG_CACHE_HOME',
    defaultPath: userHome ? path.join(userHome, '.cache') : '',
    fallbackRoot: fallbackRuntimeRoot,
    fallbackName: 'cache',
    forceFallback: options.forcePrivateRuntime === true,
  });
  return nextEnv;
}

export function resolveAgentProviderCommand(providerId = '', options = {}) {
  const id = normalizeProviderId(providerId);
  const env = options.env || process.env;
  if (id === 'opencode') {
    const bundled = resolveBundledOpenCodeCommand({ rootPath: Path.root });
    if (bundled) return bundled;
  }
  if (process.platform !== 'win32') {
    return { command: PROVIDER_DEFINITIONS[id].binary, baseArgs: [], source: 'PATH' };
  }
  for (const base of getWindowsNpmBases(env)) {
    if (id === 'opencode') {
      const executable = path.join(base, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
      if (fs.existsSync(executable)) {
        return { command: executable, baseArgs: [], source: executable };
      }
    }
  }
  return { command: PROVIDER_DEFINITIONS[id].binary, baseArgs: [], source: 'PATH' };
}

let agentWorkbenchImageDisplayEnabled = false;

function buildSafetyPrompt(mode, prompt, options = {}) {
  const fullAccess = isFullAccessMode(mode);
  const allowNetwork = options.allowNetwork === true;
  const allowAllDirectories = options.allowAllDirectories === true;
  // 图片显示开启时，教模型用 Markdown 相对路径引用工作区图片（控制台有专用端点渲染）
  const imageInstruction = agentWorkbenchImageDisplayEnabled
    ? '【图片展示规则】当任务涉及“工作区里的图片文件”（截图、生成的图片、下载的图片等）时，必须用 Markdown 图片语法直接插入展示：![简短描述](相对路径)，例如 ![截图](temp/images/demo.png)，路径写相对于工作区根目录的形式，不要用绝对路径或盘符。注意：用户在对话中上传的图片已经直接显示给用户看了，请正常查看并评价/回答，但不要再把它嵌入回复；回复中禁止输出 data:image/... 这类 base64 图片数据。'
    : '';
  const directoryInstruction = allowAllDirectories
    ? '已授予全目录权限，可以访问当前工作目录以外的目录；仍不得访问密钥、Cookie、口令、运行日志、运行时数据和依赖目录。'
    : '严禁访问当前工作目录以外的路径。';
  const networkInstruction = allowNetwork
    ? '已授予联网权限，可以使用网页读取和搜索工具；严禁进行账号登录、上传隐私数据或修改远程系统。'
    : '联网工具已被禁用。';
  const terminalInstruction = options.allowTerminal === true
    ? '终端工具已启用，但每条命令都必须等待控制台中的人工审批。'
    : '终端命令已被禁用。';
  if (fullAccess) {
    return [
      '你由魔丸控制台以完全访问模式调用。',
      '当前会话已明确授权修改文件、访问当前工作目录以外的目录、联网和执行终端命令；请只围绕用户任务工作，不要主动扩大任务范围。',
      '执行删除、安装依赖、Git、进程、服务、账户或系统配置等高风险操作前，先在对话中说明影响并等待用户明确同意。',
      '完成后说明执行了哪些操作、修改了哪些文件以及仍需人工验证的事项。',
      imageInstruction,
      '用户任务：',
      prompt,
    ].join('\n');
  }
  if (isWriteMode(mode)) {
    return [
      '你由魔丸控制台以受控代码修改模式调用。',
      '请直接在当前工作目录内创建或修改完成任务所需的文件，不要只给出补丁建议。',
      `${directoryInstruction} 严禁安装或删除依赖；严禁操作 Git、进程、服务、账户和系统配置。`,
      `${terminalInstruction}${networkInstruction} 只能使用已授权的工具完成任务。`,
      '完成后说明修改了哪些文件以及仍需人工验证的事项。',
      imageInstruction,
      '用户任务：',
      prompt,
    ].join('\n');
  }
  const modeInstruction = mode === 'patch'
    ? '请给出可审查的修改方案，并在适合时输出 unified diff 补丁文本，但不要实际应用补丁。'
    : '请分析问题、定位相关文件并给出结论与建议。';
  return [
    '你由魔丸控制台以只读 Agent 模式调用。',
    `禁止创建、修改、移动或删除任何文件；禁止安装依赖；禁止执行会改变 Git、进程、服务或系统状态的命令。${directoryInstruction}`,
    `可以读取文件并执行只读查询。${terminalInstruction}${networkInstruction} 遇到需要写入或高风险操作时，只说明建议，不要执行。`,
    modeInstruction,
    imageInstruction,
    '用户任务：',
    prompt,
  ].join('\n');
}

function buildOpenCodeFollowUpRequest(task = {}, followUp = {}) {
  const attachments = Array.isArray(followUp.attachments) ? followUp.attachments : [];
  return {
    delivery: normalizeAgentDelivery(followUp.delivery),
    resume: true,
    prompt: {
      text: buildSafetyPrompt(task.mode, followUp.prompt, {
        fullAccess: isFullAccessMode(task.mode),
        allowNetwork: task.allowNetwork === true,
        allowAllDirectories: task.allowAllDirectories === true,
        allowTerminal: task.allowTerminal === true,
      }),
      ...(attachments.length ? {
        files: attachments.map(item => ({ uri: item.url, name: item.name })),
      } : {}),
    },
  };
}

export function buildAgentRunCommand(options = {}) {
  const providerId = normalizeProviderId(options.providerId);
  const workspacePath = resolveExistingDirectory(options.workspacePath);
  if (!workspacePath) {
    throw createHttpError(400, 'Agent 工作目录不存在', 'AGENT_WORKSPACE_NOT_FOUND');
  }
  const mode = normalizeMode(options.mode);
  const prompt = normalizePrompt(options.prompt);
  if (prompt.length < 2) {
    throw createHttpError(400, '请输入需要 Agent 分析的任务', 'AGENT_PROMPT_REQUIRED');
  }
  const title = normalizeSingleLine(options.title || prompt, 80) || '魔丸控制台 Agent 任务';
  const model = normalizeModel(options.model);
  const variant = normalizeModelVariant(options.variant);
  const sessionId = normalizeOpenCodeSessionId(options.sessionId);
  const executable = resolveAgentProviderCommand(providerId, options);
  const agentName = isWriteMode(mode) ? 'build' : 'plan';
  const args = [
    ...executable.baseArgs,
    'run',
    '--pure',
    '--format',
    'json',
    '--agent',
    agentName,
    '--dir',
    workspacePath,
  ];
  if (sessionId) args.push('--session', sessionId);
  else args.push('--title', title);
  if (options.attachUrl) {
    args.push('--attach', String(options.attachUrl));
    if (options.attachPassword) args.push('--password', String(options.attachPassword));
  }
  if (model) args.push('--model', model);
  if (variant) args.push('--variant', variant);
  args.push(buildSafetyPrompt(mode, prompt, {
    fullAccess: isFullAccessMode(mode),
    allowNetwork: options.allowNetwork === true,
    allowAllDirectories: options.allowAllDirectories === true,
    allowTerminal: options.allowTerminal === true,
  }));
  return {
    providerId,
    command: executable.command,
    args,
    source: executable.source,
    workspacePath,
    mode,
    model,
    variant,
    title,
    sessionId,
    allowNetwork: options.allowNetwork === true,
    allowAllDirectories: options.allowAllDirectories === true,
  };
}

function runCapturedProcess(command, args = [], options = {}) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let forceKillTimer = null;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 3000);
    }, Math.max(1000, Number(options.timeoutMs || 10000)));
    child.stdout?.on('data', chunk => {
      stdout = appendLimited(stdout, chunk, Number(options.outputLimit || 12000));
      options.onStdout?.(chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr = appendLimited(stderr, chunk, Number(options.outputLimit || 12000));
      options.onStderr?.(chunk);
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ code: -1, error, stdout, stderr, timedOut, child });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ code: Number(code ?? -1), stdout, stderr, timedOut, child });
    });
    options.onSpawn?.(child);
  });
}

async function readProcessResource(pid = 0) {
  const processId = Math.max(0, Math.trunc(Number(pid || 0)));
  if (!processId) return { memoryBytes: 0, cpuPercent: null, cpuTimeMs: 0, threads: 0 };
  const result = process.platform === 'win32'
    ? await runCapturedProcess('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$target = Get-Process -Id ${processId} -ErrorAction Stop; [Console]::Write(([pscustomobject]@{ memoryBytes = [int64]$target.WorkingSet64; cpuTimeMs = [double]$target.TotalProcessorTime.TotalMilliseconds; threads = [int]$target.Threads.Count } | ConvertTo-Json -Compress))`,
    ], { timeoutMs: 3000, outputLimit: 500 })
    : await runCapturedProcess('ps', ['-o', 'rss=', '-o', '%cpu=', '-o', 'nlwp=', '-p', String(processId)], { timeoutMs: 3000, outputLimit: 200 });
  if (result.code !== 0) return { memoryBytes: 0, cpuPercent: null, cpuTimeMs: 0, threads: 0 };
  if (process.platform === 'win32') {
    try {
      const parsed = JSON.parse(String(result.stdout || '').trim());
      return {
        memoryBytes: Math.max(0, Number(parsed?.memoryBytes || 0)),
        cpuPercent: null,
        cpuTimeMs: Math.max(0, Number(parsed?.cpuTimeMs || 0)),
        threads: Math.max(0, Number(parsed?.threads || 0)),
      };
    } catch {
      return { memoryBytes: 0, cpuPercent: null, cpuTimeMs: 0, threads: 0 };
    }
  }
  const [memoryKb, cpuPercent, threads] = String(result.stdout || '').trim().split(/\s+/);
  return {
    memoryBytes: Math.max(0, Number(memoryKb || 0) * 1024),
    cpuPercent: Number.isFinite(Number(cpuPercent)) ? Math.max(0, Number(cpuPercent)) : null,
    cpuTimeMs: 0,
    threads: Math.max(0, Number(threads || 0)),
  };
}

function getFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = Number(server.address()?.port || 0);
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function buildBasicAuthHeader(username = '', password = '') {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

async function requestOpenCodeJson(server, pathname, options = {}) {
  if (!server?.url || !server?.password) throw new Error('OpenCode 服务尚未启动');
  const timeoutSignal = AbortSignal.timeout(Math.max(1000, Number(options.timeoutMs || 5000)));
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(`${server.url}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      authorization: buildBasicAuthHeader(server.username, server.password),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal,
  });
  if (!response.ok) {
    const details = normalizeSingleLine(await response.text().catch(() => ''), 500);
    throw new Error(`OpenCode 请求失败（${response.status}）${details ? `：${details}` : ''}`);
  }
  if (response.status === 204) return true;
  const text = await response.text();
  return text ? JSON.parse(text) : true;
}

function waitForAbortableDelay(delayMs = 250, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(20, Number(delayMs || 0)));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer.unref?.();
  });
}

async function waitForOpenCodeSessionIdle(server, sessionId = '', directory = '', options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 300000));
  const signal = options.signal;
  const completionCheck = typeof options.completionCheck === 'function'
    ? options.completionCheck
    : null;
  const errorCheck = typeof options.errorCheck === 'function' ? options.errorCheck : null;
  const isTurnComplete = async () => !completionCheck || await completionCheck();
  const checkSessionError = () => {
    const message = errorCheck ? errorCheck() : '';
    if (!message) return;
    const error = new Error(message);
    error.name = 'OpenCodeSessionError';
    throw error;
  };
  let waitResult = true;
  try {
    checkSessionError();
    waitResult = await requestOpenCodeJson(
      server,
      `/api/session/${encodeURIComponent(sessionId)}/wait`,
      { method: 'POST', timeoutMs, signal },
    );
    checkSessionError();
    if (await isTurnComplete()) return waitResult;
  } catch (error) {
    if (error?.name === 'OpenCodeSessionError') throw error;
    if (signal?.aborted) throw error;
    // /wait 不可用、超时或被 OpenCode 掐断：降级为状态轮询，不作为任务失败
  }
  const startedAt = Date.now();
  const query = `?directory=${encodeURIComponent(directory)}`;
  let observedBusy = false;
  let statusPollFailures = 0;
  while (Date.now() - startedAt < timeoutMs) {
    checkSessionError();
    let statuses = null;
    try {
      // OpenCode 忙时（流式输出/工具执行）对本机请求也可能超过 5s，单次失败不能判定任务超时
      statuses = await requestOpenCodeJson(server, `/session/status${query}`, {
        timeoutMs: Math.min(15000, timeoutMs),
        signal,
      });
      statusPollFailures = 0;
    } catch (error) {
      if (error?.name === 'OpenCodeSessionError') throw error;
      if (signal?.aborted) throw error;
      statusPollFailures += 1;
      if (statusPollFailures === 1) options.onPollFailure?.('OpenCode 状态查询暂时失败，继续等待本轮完成');
      // 连续约 2 分钟无任何响应才判定为执行异常
      if (statusPollFailures >= 40) {
        const failureError = new Error('OpenCode 状态查询连续失败，会话可能已停止响应');
        failureError.name = 'TimeoutError';
        throw failureError;
      }
      await waitForAbortableDelay(1000, signal);
      continue;
    }
    const status = statuses && typeof statuses === 'object' ? statuses[sessionId] : null;
    const type = String(status?.type || '').toLowerCase();
    if (type === 'busy' || type === 'retry') observedBusy = true;
    if (type === 'idle' || (!type && (observedBusy || Date.now() - startedAt >= 2000))) {
      checkSessionError();
      if (await isTurnComplete()) return waitResult;
    }
    await waitForAbortableDelay(300, signal);
  }
  const timeoutError = new Error(`OpenCode 会话等待超时（${Math.round(timeoutMs / 60000)} 分钟未完成）`);
  timeoutError.name = 'TimeoutError';
  throw timeoutError;
}

function startOpenCodeEventStream(server, directory, onEvent) {
  const controller = new AbortController();
  const query = `?directory=${encodeURIComponent(directory)}`;
  const promise = (async () => {
    try {
      const response = await fetch(`${server.url}/event${query}`, {
        headers: { authorization: buildBasicAuthHeader(server.username, server.password) },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`OpenCode 事件流连接失败（${response.status}）`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const data = frame.split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())
            .join('\n');
          if (!data) continue;
          try {
            onEvent?.(JSON.parse(data));
          } catch {
            // 忽略无法解析的事件帧，轮询仍会提供兜底状态。
          }
        }
      }
      reader.releaseLock();
      if (!controller.signal.aborted) {
        onEvent?.({ type: 'crystelf.event_stream_closed', properties: {} });
      }
    } catch (error) {
      if (!controller.signal.aborted) onEvent?.({ type: 'crystelf.event_stream_error', properties: { message: error.message } });
    }
  })();
  return { controller, promise };
}

function openCodePartsToJsonl(parts = [], sessionId = '') {
  return (Array.isArray(parts) ? parts : []).map(part => JSON.stringify({
    type: part?.type || 'part',
    sessionID: sessionId,
    part,
  })).join('\n');
}

function getLatestOpenCodeAssistantOutput(messages = [], sessionId = '', excludedMessageIds = new Set()) {
  const items = Array.isArray(messages) ? messages : [];
  const excluded = excludedMessageIds instanceof Set ? excludedMessageIds : new Set();
  const assistants = items.filter(item => item?.info?.role === 'assistant');
  if (excluded.size) {
    const freshAssistants = assistants.filter(item => {
      const messageId = normalizeOpenCodeMessageId(item?.info?.id || item?.info?.messageID || item?.messageID);
      return messageId && !excluded.has(messageId);
    });
    if (freshAssistants.length) {
      return freshAssistants
        .map(item => openCodePartsToJsonl(item.parts, sessionId))
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }
  let lastUserIndex = -1;
  items.forEach((item, index) => {
    if (item?.info?.role === 'user') lastUserIndex = index;
  });
  return items
    .slice(lastUserIndex + 1)
    .filter(item => item?.info?.role === 'assistant')
    .map(item => openCodePartsToJsonl(item.parts, sessionId))
    .filter(Boolean)
    .join('\n');
}

export function hasCompletedOpenCodeAssistantTurn(messages = [], excludedMessageIds = new Set()) {
  const items = Array.isArray(messages) ? messages : [];
  const excluded = excludedMessageIds instanceof Set ? excludedMessageIds : new Set();
  return items.some(item => {
    if (item?.info?.role !== 'assistant') return false;
    const messageId = normalizeOpenCodeMessageId(item?.info?.id || item?.info?.messageID || item?.messageID);
    if (!messageId || excluded.has(messageId)) return false;
    const info = item?.info && typeof item.info === 'object' ? item.info : item;
    return Boolean(info?.time?.completed || info?.finishedAt || info?.completedAt || info?.completed);
  });
}

async function startAttachedOpenCodeServer(executable, processEnv, workspacePath) {
  // 低配 VPS 上 Bun 二进制冷启动可能超过 12s（加载/杀软扫描），失败自动重试一次
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await spawnAttachedOpenCodeServer(executable, processEnv, workspacePath);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  throw lastError;
}

async function spawnAttachedOpenCodeServer(executable, processEnv, workspacePath) {
  const port = await getFreeLoopbackPort();
  const username = 'opencode';
  const password = crypto.randomBytes(24).toString('base64url');
  const child = spawn(executable.command, [
    ...executable.baseArgs,
    'serve',
    '--pure',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ], {
    cwd: workspacePath,
    env: {
      ...processEnv,
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
    },
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server = {
    child,
    username,
    password,
    url: `http://127.0.0.1:${port}`,
    stdout: '',
    stderr: '',
  };
  child.stdout?.on('data', chunk => {
    server.stdout = appendLimited(server.stdout, chunk, 12000);
  });
  child.stderr?.on('data', chunk => {
    server.stderr = appendLimited(server.stderr, chunk, 12000);
  });
  let spawnError = null;
  child.once('error', error => {
    spawnError = error;
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (spawnError) break;
    if (child.exitCode !== null) break;
    try {
      await requestOpenCodeJson(server, '/global/health', { timeoutMs: 3000 });
      return server;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  await stopAttachedOpenCodeServer(server);
  throw new Error(normalizeSingleLine(
    spawnError?.message || server.stderr || server.stdout || 'OpenCode 后台服务启动超时',
    800,
  ));
}

async function stopAttachedOpenCodeServer(server) {
  const child = server?.child;
  if (!child || child.exitCode !== null) return false;
  await new Promise(resolve => {
    let settled = false;
    let forceTimer;
    let settleTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(settleTimer);
      resolve();
    };
    child.once('exit', finish);
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
      return;
    }
    forceTimer = setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          // 进程已经退出时忽略强制终止异常。
        }
      }
      settleTimer = setTimeout(finish, 500);
      settleTimer.unref?.();
    }, 1500);
    forceTimer.unref?.();
  });
  return true;
}

async function readGitStatus(workspacePath = '') {
  const result = await runCapturedProcess('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: workspacePath,
    timeoutMs: GIT_STATUS_TIMEOUT_MS,
    outputLimit: 50000,
  }).catch(() => null);
  if (!result || result.code !== 0) return null;
  return result.stdout.trimEnd();
}

function normalizeGitFileList(value = []) {
  return Array.isArray(value)
    ? value.slice(0, 300).map(item => String(item || '').replace(/\\/g, '/').trim()).filter(item => item && !path.posix.isAbsolute(item) && !item.split('/').includes('..'))
    : [];
}

function parseGitChangedFiles(status = '') {
  return String(status || '')
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .slice(0, 300)
    .map(line => ({
      status: line.slice(0, 2).trim() || '?',
      path: line.slice(3).trim().replace(/^"|"$/g, ''),
    }))
    .filter(item => item.path);
}

function getGitChangeKind(status = '') {
  const normalized = String(status || '').toUpperCase();
  if (normalized.includes('??') || normalized.includes('A')) return 'added';
  if (normalized.includes('D')) return 'deleted';
  if (normalized.includes('R')) return 'renamed';
  return 'modified';
}

function parseGitNumstat(value = '') {
  const result = new Map();
  String(value || '').split(/\r?\n/).filter(Boolean).forEach(line => {
    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
    if (!match) return;
    const file = match[3].trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
    if (!file) return;
    result.set(file, {
      additions: match[1] === '-' ? 0 : Math.max(0, Number(match[1] || 0)),
      deletions: match[2] === '-' ? 0 : Math.max(0, Number(match[2] || 0)),
    });
  });
  return result;
}

function buildGitChangeSummary(changedFiles = []) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  return files.reduce((summary, item) => {
    const kind = item.kind || getGitChangeKind(item.status);
    summary.files += 1;
    summary.additions += Math.max(0, Number(item.additions || 0));
    summary.deletions += Math.max(0, Number(item.deletions || 0));
    if (kind === 'added') summary.addedFiles += 1;
    else if (kind === 'deleted') summary.deletedFiles += 1;
    else if (kind === 'renamed') summary.renamedFiles += 1;
    else summary.modifiedFiles += 1;
    return summary;
  }, {
    files: 0,
    additions: 0,
    deletions: 0,
    addedFiles: 0,
    deletedFiles: 0,
    modifiedFiles: 0,
    renamedFiles: 0,
  });
}

async function readGitChangeAudit(workspacePath = '') {
  const status = await readGitStatus(workspacePath);
  if (status === null) return { available: false, status: '', changedFiles: [], changeSummary: buildGitChangeSummary(), diffStat: '', diffText: '' };
  const [statResult, numstatResult, diffResult] = await Promise.all([
    runCapturedProcess('git', ['diff', 'HEAD', '--no-ext-diff', '--stat', '--'], {
      cwd: workspacePath,
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
      outputLimit: 30000,
    }).catch(() => null),
    runCapturedProcess('git', ['diff', 'HEAD', '--no-ext-diff', '--numstat', '--'], {
      cwd: workspacePath,
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
      outputLimit: 30000,
    }).catch(() => null),
    runCapturedProcess('git', ['diff', 'HEAD', '--no-ext-diff', '--unified=3', '--'], {
      cwd: workspacePath,
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
      outputLimit: AGENT_DIFF_LIMIT,
    }).catch(() => null),
  ]);
  const numstat = parseGitNumstat(numstatResult?.stdout || '');
  const changedFiles = parseGitChangedFiles(status).map(item => ({
    ...item,
    kind: getGitChangeKind(item.status),
    additions: numstat.get(item.path)?.additions || 0,
    deletions: numstat.get(item.path)?.deletions || 0,
  }));
  const untracked = changedFiles.filter(item => item.status === '??').map(item => item.path);
  const untrackedNote = untracked.length
    ? `\n\n未跟踪的新文件（Git diff 不包含内容）：\n${untracked.map(item => `- ${item}`).join('\n')}`
    : '';
  return {
    available: true,
    status,
    changedFiles,
    changeSummary: buildGitChangeSummary(changedFiles),
    diffStat: String(statResult?.stdout || '').trim(),
    diffText: `${String(diffResult?.stdout || '').trim()}${untrackedNote}`.trim(),
  };
}

function addTaskEvent(task, level, message) {
  task.events.push({
    time: new Date().toISOString(),
    level,
    message: normalizeSingleLine(message, 500),
  });
  task.events = task.events.slice(-AGENT_EVENT_LIMIT);
  task.updatedAt = new Date().toISOString();
}

function resetTaskTurnState(task) {
  task.outputText = '';
  task.liveOutputText = '';
  task.liveSteps = [];
  task.liveStepsSignature = '';
  task.stderrText = '';
  task.error = '';
  task.events = [];
  task.command = [];
  task.pendingPermissions = [];
  task.pendingQuestions = [];
  task.workspaceChanged = false;
  task.gitCheckAvailable = false;
  task.gitCleanBefore = false;
  task.changedFiles = [];
  task.diffStat = '';
  task.diffText = '';
}

function trimTaskMessages(task) {
  task.messages = Array.isArray(task?.messages)
    ? task.messages.slice(-AGENT_MESSAGE_LIMIT)
    : [];
}

function getTaskElapsedMs(task = {}) {
  const start = Date.parse(task.startedAt || task.createdAt || '');
  const end = Date.parse(task.finishedAt || '') || Date.now();
  return Number.isFinite(start) ? Math.max(0, end - start) : 0;
}

function serializeAgentMessage(message = {}) {
  return {
    id: message.id || '',
    role: message.role === 'assistant' ? 'assistant' : 'user',
    openCodeMessageId: normalizeOpenCodeMessageId(message.openCodeMessageId),
    content: redactAgentText(message.content || '').slice(-40000),
    reasoning: redactAgentText(message.reasoning || '').slice(-20000),
    tools: Array.isArray(message.tools) ? message.tools.slice(-AGENT_MESSAGE_TOOL_LIMIT).map(tool => ({
      id: tool.id || '',
      name: tool.name || '工具调用',
      status: tool.status || 'unknown',
      input: redactAgentText(tool.input || '').slice(-4000),
      output: redactAgentText(tool.output || '').slice(-8000),
      images: (Array.isArray(tool.images) ? tool.images : [])
        .filter(item => /^data:image\//i.test(String(item?.url || '')) && String(item.url).length <= 1600000)
        .slice(0, 2)
        .map(item => ({ mime: normalizeSingleLine(item.mime || 'image/png', 80), url: String(item.url) })),
    })) : [],
    attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, AGENT_ATTACHMENT_LIMIT).map(item => ({
      name: normalizeSingleLine(item.name || '附件', 180),
      mime: normalizeSingleLine(item.mime || 'application/octet-stream', 120),
      size: Math.max(0, Number(item.size || 0)),
    })) : [],
    createdAt: message.createdAt || '',
    finishedAt: message.finishedAt || '',
    elapsedMs: Math.max(0, Number(message.elapsedMs || 0)),
    usage: message.usage && typeof message.usage === 'object' ? {
      input: Math.max(0, Number(message.usage.input || 0)),
      output: Math.max(0, Number(message.usage.output || 0)),
      total: Math.max(0, Number(message.usage.total || 0)),
    } : null,
    mode: message.mode || '',
    status: message.status || '',
    error: redactAgentText(message.error || '').slice(-4000),
    stderrText: redactAgentText(message.stderrText || '').slice(-8000),
    changedFiles: Array.isArray(message.changedFiles) ? message.changedFiles.slice(0, 300) : [],
    diffStat: redactAgentText(message.diffStat || '').slice(-12000),
    diffText: redactAgentText(message.diffText || '').slice(-12000),
    delivery: message.delivery ? normalizeAgentDelivery(message.delivery) : '',
  };
}

function serializeTask(task = {}, options = {}) {
  const includeDetails = options.includeDetails !== false;
  const result = {
    id: task.id || '',
    opencodeSessionId: task.opencodeSessionId || '',
    title: task.title || '',
    providerId: task.providerId || '',
    providerLabel: task.providerLabel || '',
    workspaceId: task.workspaceId || '',
    workspaceLabel: task.workspaceLabel || '',
    workspacePath: task.workspacePath || '',
    agent: task.agent || '',
    mode: task.mode || 'analyze',
    model: task.model || '',
    modelProviderId: task.modelProviderId || '',
    variant: normalizeModelVariant(task.variant),
    worktree: task.worktree ? {
      name: task.worktree.name || '',
      branch: task.worktree.branch || '',
      directory: task.worktree.directory || '',
      baseWorkspaceId: task.worktree.baseWorkspaceId || task.workspaceId || '',
    } : null,
    allowNetwork: task.allowNetwork === true,
    allowAllDirectories: task.allowAllDirectories === true,
    allowTerminal: task.allowTerminal === true,
    pendingPermissions: Array.isArray(task.pendingPermissions)
      ? task.pendingPermissions.slice(0, AGENT_PERMISSION_LIMIT).map(item => ({
        id: normalizeSingleLine(item.id, 120),
        action: normalizeSingleLine(item.action || item.permission || 'terminal', 120),
        resources: Array.isArray(item.resources || item.patterns)
          ? (item.resources || item.patterns).slice(0, 20).map(value => redactAgentText(value).slice(0, 1000))
          : [],
        metadata: item.metadata && typeof item.metadata === 'object'
          ? redactAgentText(JSON.stringify(item.metadata, null, 2)).slice(0, 8000)
          : '',
      }))
      : [],
    pendingQuestions: Array.isArray(task.pendingQuestions)
      ? task.pendingQuestions.slice(0, AGENT_QUESTION_LIMIT).map(item => ({
        id: normalizeSingleLine(item.id || item.requestID || item.requestId, 120),
        questions: Array.isArray(item.questions) ? item.questions.slice(0, 8).map(question => ({
          header: normalizeSingleLine(question.header || '', 120),
          question: redactAgentText(question.question || question.text || '').slice(0, 1000),
          multiple: question.multiple === true,
          custom: question.custom === true,
          options: Array.isArray(question.options) ? question.options.slice(0, 20).map(option => ({
            label: redactAgentText(option?.label || option?.value || option || '').slice(0, 300),
            description: redactAgentText(option?.description || '').slice(0, 500),
          })) : [],
        })) : [],
      }))
      : [],
    timeoutMs: Math.max(0, Number(task.timeoutMs || 0)),
    contextUsage: Math.max(0, Number(task.contextUsage || 0)),
    contextLimit: Math.max(0, Number(task.contextLimit || 0)),
    lastCompactedAt: task.lastCompactedAt || '',
    priority: normalizeAgentPriority(task.priority),
    retryCount: Math.max(0, Number(task.retryCount || 0)),
    pendingFollowUpCount: Array.isArray(task.followUps)
      ? task.followUps.filter(item => item?.state === 'pending' || item?.state === 'admitting').length
      : 0,
    followUpCount: Array.isArray(task.messages)
      ? task.messages.filter(message => message?.role === 'user' && message?.delivery).length
      : 0,
    followUpDelivery: normalizeAgentDelivery(task.followUpDelivery),
    acceptsFollowUps: task.providerId === 'opencode'
      && ['pending', 'running'].includes(task.status)
      && task.followUpClosing !== true
      && task.stage !== 'verify',
    retryable: task.status === 'error' || task.stage === 'timeout',
    queuedAt: task.queuedAt || '',
    queuePosition: Math.max(0, Number(task.queuePosition || 0)),
    resumeCount: Math.max(0, Number(task.resumeCount || 0)),
    resumable: task.status === 'interrupted' || task.stage === 'timeout',
    prompt: redactAgentText(task.prompt || ''),
    promptPreview: task.promptPreview || '',
    // 附件 data URL 体积大：只在落盘（includeSecrets）时保留，供重试恢复；API 载荷不携带
    ...(options.includeSecrets === true ? {
      promptAttachments: (Array.isArray(task.promptAttachments) ? task.promptAttachments : []).slice(0, AGENT_ATTACHMENT_LIMIT).map(item => ({
        name: normalizeSingleLine(item.name || '附件', 180),
        mime: normalizeSingleLine(item.mime || 'application/octet-stream', 120),
        url: String(item.url || ''),
        size: Math.max(0, Number(item.size || 0)),
      })),
    } : {}),
    turnCount: Math.max(0, Number(task.turnCount || 0)),
    messageCount: Array.isArray(task.messages) ? task.messages.length : 0,
    writeConfirmed: task.writeConfirmed === true,
    customApi: {
      enabled: task.customApi?.enabled === true,
      baseApi: task.customApi?.baseApi || '',
      apiKey: options.includeSecrets === true ? (task.customApi?.apiKey || '') : (task.customApi?.apiKey ? '已配置' : ''),
      model: task.customApi?.model || '',
      userAgent: task.customApi?.userAgent || '',
    },
    status: task.status || 'unknown',
    ...(task.status === 'running' && Array.isArray(task.liveSteps) && task.liveSteps.length ? {
      liveSteps: task.liveSteps.slice(-20).map(step => ({
        messageId: normalizeSingleLine(step.messageId || '', 120),
        content: redactAgentText(step.content || '').slice(-6000),
        reasoning: redactAgentText(step.reasoning || '').slice(-2000),
      })),
    } : {}),
    archived: task.archived === true,
    stage: task.stage || '',
    createdAt: task.createdAt || '',
    startedAt: task.startedAt || '',
    finishedAt: task.finishedAt || '',
    updatedAt: task.updatedAt || '',
    elapsedMs: getTaskElapsedMs(task),
    timedOut: task.timedOut === true,
    canceled: task.canceled === true,
    cancelRequested: task.cancelRequested === true,
    exitCode: Number.isFinite(Number(task.exitCode)) ? Number(task.exitCode) : null,
    outputText: includeDetails ? redactAgentText(task.liveOutputText || task.outputText || '') : '',
    stderrText: includeDetails ? redactAgentText(task.stderrText || '') : '',
    error: redactAgentText(task.error || ''),
    usage: task.usage && typeof task.usage === 'object' ? {
      input: Math.max(0, Number(task.usage.input || 0)),
      output: Math.max(0, Number(task.usage.output || 0)),
      total: Math.max(0, Number(task.usage.total || 0)),
    } : { input: 0, output: 0, total: 0 },
    workspaceChanged: task.workspaceChanged === true,
    gitCheckAvailable: task.gitCheckAvailable === true,
    gitCleanBefore: task.gitCleanBefore === true,
    changedFiles: Array.isArray(task.changedFiles) ? task.changedFiles.slice(0, 300) : [],
    diffStat: redactAgentText(task.diffStat || ''),
    diffText: includeDetails ? redactAgentText(task.diffText || '') : '',
    events: includeDetails && Array.isArray(task.events) ? task.events.slice(-AGENT_EVENT_LIMIT) : [],
    command: includeDetails && Array.isArray(task.command) ? task.command : [],
  };
  if (options.includeSecrets === true) {
    result.currentAttachments = Array.isArray(task.currentAttachments)
      ? task.currentAttachments.slice(0, AGENT_ATTACHMENT_LIMIT)
      : [];
  }
  if (options.includeMessages === true) {
    result.messages = Array.isArray(task.messages)
      ? task.messages.slice(-AGENT_MESSAGE_LIMIT).map(serializeAgentMessage)
      : [];
  }
  if (options.includeSecrets === true) {
    result.pendingFollowUps = Array.isArray(task.followUps)
      ? task.followUps.slice(-AGENT_FOLLOW_UP_LIMIT).map(item => ({
        id: item.id,
        messageId: item.messageId,
        openCodeMessageId: item.openCodeMessageId || '',
        prompt: item.prompt,
        attachments: item.attachments,
        delivery: normalizeAgentDelivery(item.delivery),
        state: item.state,
        createdAt: item.createdAt,
        admittedAt: item.admittedAt || '',
        error: item.error || '',
      }))
      : [];
  }
  return result;
}

export function createAgentWorkbenchConsole(options = {}) {
  const ConfigControl = options.ConfigControl;
  agentWorkbenchImageDisplayEnabled = ConfigControl?.get?.('coreConfig')?.tools?.agentWorkbench?.outputImagesEnabled === true;
  const logger = options.logger || console;
  const recordWebConsoleOperation = typeof options.recordWebConsoleOperation === 'function'
    ? options.recordWebConsoleOperation
    : (() => {});
  const workspaceOptions = {
    pluginRoot: options.pluginRoot || Path.root,
    yunzaiRoot: options.yunzaiRoot || Path.yunzai,
    pluginsRoot: options.pluginsRoot || path.join(options.yunzaiRoot || Path.yunzai, 'plugins'),
  };
  const tasks = new Map();
  const sessionStorePath = path.resolve(options.sessionStorePath || path.join(Path.data, 'agent-workbench-sessions.json'));
  const providerProbeCache = new Map();
  const providerBootstrapInFlight = new Map();
  const streamSubscribers = new Set();
  const streamTimers = new Map();
  const streamDeltaBuffers = new Map();
  const workspaceRuntimes = new Map();
  const runtimeResourceSamples = new Map();
  const runtimeStartupInFlight = new Map();
  const terminals = new Map();
  let dispatchScheduled = false;

  function clearWorkspaceRuntimeIdleTimer(runtime) {
    if (!runtime?.idleTimer) return;
    clearTimeout(runtime.idleTimer);
    runtime.idleTimer = null;
  }

  function hasActiveRuntimeTerminals(runtime) {
    return Array.from(terminals.values()).some(terminal => (
      terminal.runtimeKey === runtime?.runtimeKey && terminal.status === 'running'
    ));
  }

  function hasActiveRuntimeTasks(runtime) {
    return Boolean(runtime?.activeTaskIds?.size);
  }

  async function closeWorkspaceRuntime(runtime) {
    if (!runtime) return false;
    if (runtime.closePromise) return runtime.closePromise;
    runtime.closing = true;
    clearWorkspaceRuntimeIdleTimer(runtime);
    runtime.closePromise = (async () => {
      const closed = await stopAttachedOpenCodeServer(runtime.server);
      if (workspaceRuntimes.get(runtime.runtimeKey) === runtime) workspaceRuntimes.delete(runtime.runtimeKey);
      emitWorkbenchUpdate('terminal', { workspaceId: runtime.workspace.id, terminals: listTerminals(runtime.workspace.id) });
      return closed;
    })();
    return runtime.closePromise;
  }

  function scheduleWorkspaceRuntimeCleanup(runtime) {
    if (!runtime || runtime.closing) return;
    clearWorkspaceRuntimeIdleTimer(runtime);
    const idleTimeoutMs = getConfig().runtimeIdleTimeoutMs;
    const remaining = Math.max(1000, idleTimeoutMs - (Date.now() - runtime.lastUsedAt));
    runtime.idleTimer = setTimeout(async () => {
      runtime.idleTimer = null;
      if (workspaceRuntimes.get(runtime.runtimeKey) !== runtime || runtime.closing) return;
      if (hasActiveRuntimeTasks(runtime) || hasActiveRuntimeTerminals(runtime)) {
        runtime.lastUsedAt = Date.now();
        scheduleWorkspaceRuntimeCleanup(runtime);
        return;
      }
      await closeWorkspaceRuntime(runtime).catch(error => {
        logger.warn?.(`[agent-workbench] 自动回收 OpenCode 服务失败: ${error.message}`);
      });
    }, remaining);
    runtime.idleTimer.unref?.();
  }

  async function ensureWorkspaceRuntimeCapacity(runtimeKey = '') {
    const limit = getConfig().maxOpenCodeRuntimes;
    const pendingCount = Array.from(runtimeStartupInFlight.keys()).filter(key => key !== runtimeKey).length;
    let projectedCount = workspaceRuntimes.size + pendingCount;
    while (projectedCount >= limit) {
      const candidate = Array.from(workspaceRuntimes.values())
        .filter(runtime => runtime.runtimeKey !== runtimeKey
          && !runtime.closing
          && !hasActiveRuntimeTasks(runtime)
          && !hasActiveRuntimeTerminals(runtime))
        .sort((left, right) => Number(left.lastUsedAt || 0) - Number(right.lastUsedAt || 0))[0];
      if (!candidate) {
        throw createHttpError(
          429,
          `OpenCode 运行时已达到上限 ${limit}，请关闭空闲会话或在设置中提高上限`,
          'AGENT_RUNTIME_LIMIT_REACHED',
        );
      }
      await closeWorkspaceRuntime(candidate);
      projectedCount = workspaceRuntimes.size + pendingCount;
    }
  }

  function writeStreamEvent(res, eventName, payload) {
    if (res.writableEnded || res.destroyed) return false;
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  }

  function flushTaskDelta(taskId = '') {
    const pending = streamDeltaBuffers.get(taskId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    streamDeltaBuffers.delete(taskId);
    const task = tasks.get(taskId);
    const payload = {
      taskId,
      updatedAt: task?.updatedAt || new Date().toISOString(),
      status: task?.status || 'running',
      stage: task?.stage || 'running',
      ...(pending.steps
        ? { steps: pending.steps }
        : (pending.outputText !== null ? { outputText: pending.outputText } : { delta: pending.delta })),
    };
    for (const res of streamSubscribers) {
      if (!writeStreamEvent(res, 'task_delta', payload)) streamSubscribers.delete(res);
    }
  }

  function emitTaskDelta(task, change = {}) {
    if (!task?.id || streamSubscribers.size === 0) return;
    const pending = streamDeltaBuffers.get(task.id) || { delta: '', outputText: null, steps: null, timer: null };
    if (change.outputText !== undefined) {
      pending.outputText = redactAgentText(change.outputText || '');
      pending.delta = '';
    } else if (Array.isArray(change.steps)) {
      pending.steps = change.steps;
      pending.delta = '';
    } else if (pending.outputText === null && !pending.steps && change.delta) {
      pending.delta = appendLimited(pending.delta, change.delta, 24000);
    }
    if (!pending.timer) {
      pending.timer = setTimeout(() => flushTaskDelta(task.id), 60);
      pending.timer.unref?.();
    }
    streamDeltaBuffers.set(task.id, pending);
  }

  function emitTaskUpdate(task, eventName = 'task', immediate = false) {
    if (!task) return;
    const emit = () => {
      streamTimers.delete(task.id);
      const payload = { task: serializeTask(task, { includeMessages: true }) };
      for (const res of streamSubscribers) {
        if (!writeStreamEvent(res, eventName, payload)) streamSubscribers.delete(res);
      }
    };
    if (immediate) {
      flushTaskDelta(task.id);
      const timer = streamTimers.get(task.id);
      if (timer) clearTimeout(timer);
      emit();
      return;
    }
    if (!streamTimers.has(task.id)) {
      streamTimers.set(task.id, setTimeout(emit, 120));
    }
  }

  function emitWorkbenchUpdate(eventName, payload) {
    for (const res of streamSubscribers) {
      if (!writeStreamEvent(res, eventName, payload)) streamSubscribers.delete(res);
    }
  }

  function subscribeEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 2000\n\n`);
    writeStreamEvent(res, 'ready', { time: new Date().toISOString() });
    streamSubscribers.add(res);
    const heartbeat = setInterval(() => {
      if (!writeStreamEvent(res, 'ping', { time: new Date().toISOString() })) {
        clearInterval(heartbeat);
        streamSubscribers.delete(res);
      }
    }, AGENT_STREAM_HEARTBEAT_MS);
    heartbeat.unref?.();
    const cleanup = () => {
      clearInterval(heartbeat);
      streamSubscribers.delete(res);
    };
    req.once('close', cleanup);
    res.once('close', cleanup);
  }

  function getConfig() {
    const config = normalizeAgentWorkbenchConfig(ConfigControl?.get?.('coreConfig')?.tools?.agentWorkbench || {});
    // 每次都同步图片展示开关：插件加载时配置可能尚未就绪，开关也可能被即时修改
    agentWorkbenchImageDisplayEnabled = config.outputImagesEnabled === true;
    return config;
  }

  function buildNativeOpenCodeEnvironment(config = getConfig()) {
    let processEnv = buildAgentProcessEnv();
    if (resolveBundledOpenCodeCommand({ rootPath: Path.root })) {
      const bundledRuntime = buildBundledOpenCodeEnvironment({
        aiConfig: ConfigControl?.get?.('ai') || {},
        model: config.customApi?.model || '',
        writeMode: true,
        customApi: config.customApi,
        allowNetwork: config.allowNetwork === true,
        allowAllDirectories: config.allowAllDirectories === true,
        allowTerminal: config.allowTerminal === true,
        nativeConfig: config.nativeConfig,
      });
      processEnv = buildAgentProcessEnv(bundledRuntime.env, { fallbackRoot: bundledRuntime.runtimeRoot });
      processEnv.OPENCODE_CONFIG_CONTENT = bundledRuntime.env.OPENCODE_CONFIG_CONTENT;
    }
    return processEnv;
  }

  function getRuntimeKey(workspaceId = '', directory = '', runtimeOptions = {}) {
    return `${AGENT_SHARED_RUNTIME_KEY}:${runtimeOptions.profile || 'native'}`;
  }

  async function getDirectoryRuntime(workspaceId = '', directory = '', runtimeOptions = {}) {
    const config = getConfig();
    if (!config.enabled) throw createHttpError(403, 'Agent 工作台当前未启用', 'AGENT_WORKBENCH_DISABLED');
    const workspace = resolveAgentWorkspace(workspaceId, workspaceOptions);
    const resolvedDirectory = resolveExistingDirectory(directory || workspace.path);
    if (!resolvedDirectory) throw createHttpError(404, 'Agent 实际工作目录不存在', 'AGENT_DIRECTORY_NOT_FOUND');
    const runtimeKey = getRuntimeKey(workspace.id, resolvedDirectory, runtimeOptions);
    const existing = workspaceRuntimes.get(runtimeKey);
    if (existing?.closing) {
      await existing.closePromise?.catch(() => {});
    }
    const current = workspaceRuntimes.get(runtimeKey);
    if (current?.server?.child?.exitCode === null && !current.server.child.killed && !current.closing) {
      current.lastUsedAt = Date.now();
      scheduleWorkspaceRuntimeCleanup(current);
      return current;
    }
    if (current) {
      clearWorkspaceRuntimeIdleTimer(current);
      workspaceRuntimes.delete(runtimeKey);
    }
    const pending = runtimeStartupInFlight.get(runtimeKey);
    if (pending) return await pending;
    const startup = (async () => {
      const active = workspaceRuntimes.get(runtimeKey);
      if (active?.server?.child?.exitCode === null && !active.server.child.killed && !active.closing) return active;
      await ensureWorkspaceRuntimeCapacity(runtimeKey);
      const processEnv = runtimeOptions.processEnv || buildNativeOpenCodeEnvironment(config);
      const executable = resolveAgentProviderCommand('opencode', { env: processEnv });
      const server = await startAttachedOpenCodeServer(executable, processEnv, resolvedDirectory);
      const createdAt = new Date().toISOString();
      const runtime = {
        id: `runtime-${crypto.randomBytes(6).toString('hex')}`,
        workspace: { ...workspace, path: resolvedDirectory },
        baseWorkspace: workspace,
        runtimeKey,
        profile: runtimeOptions.profile || 'native',
        server,
        activeTaskIds: new Set(),
        createdAt,
        lastUsedAt: Date.now(),
        idleTimer: null,
        closing: false,
        closePromise: null,
      };
      workspaceRuntimes.set(runtimeKey, runtime);
      server.child.once('exit', () => {
        clearWorkspaceRuntimeIdleTimer(runtime);
        if (workspaceRuntimes.get(runtimeKey)?.server === server) workspaceRuntimes.delete(runtimeKey);
        for (const terminal of terminals.values()) {
          if (terminal.runtimeKey !== runtimeKey) continue;
          terminal.status = 'exited';
          terminal.updatedAt = new Date().toISOString();
        }
        emitWorkbenchUpdate('terminal', { workspaceId: workspace.id, terminals: listTerminals(workspace.id) });
      });
      scheduleWorkspaceRuntimeCleanup(runtime);
      return runtime;
    })();
    runtimeStartupInFlight.set(runtimeKey, startup);
    try {
      return await startup;
    } finally {
      if (runtimeStartupInFlight.get(runtimeKey) === startup) runtimeStartupInFlight.delete(runtimeKey);
    }
  }

  async function getWorkspaceRuntime(workspaceId = '') {
    const workspace = resolveAgentWorkspace(workspaceId, workspaceOptions);
    return await getDirectoryRuntime(workspace.id, workspace.path);
  }

  async function requestDirectoryOpenCode(workspaceId, directory, pathname, options = {}, runtimeOptions = {}) {
    const runtime = await getDirectoryRuntime(workspaceId, directory, runtimeOptions);
    runtime.lastUsedAt = Date.now();
    scheduleWorkspaceRuntimeCleanup(runtime);
    const separator = pathname.includes('?') ? '&' : '?';
    const resolvedDirectory = resolveExistingDirectory(directory) || runtime.workspace.path;
    return await requestOpenCodeJson(runtime.server, `${pathname}${separator}directory=${encodeURIComponent(resolvedDirectory)}`, options);
  }

  async function requestWorkspaceOpenCode(workspaceId, pathname, options = {}) {
    const workspace = resolveAgentWorkspace(workspaceId, workspaceOptions);
    return await requestDirectoryOpenCode(workspace.id, workspace.path, pathname, options);
  }

  async function listWorkspaceWorktrees(workspaceId = '') {
    const workspace = resolveAgentWorkspace(workspaceId, workspaceOptions);
    const result = await requestWorkspaceOpenCode(workspace.id, '/experimental/worktree', { timeoutMs: 10000 });
    return Array.isArray(result)
      ? result.map(resolveExistingDirectory).filter(Boolean)
      : [];
  }

  async function resolveTaskWorkspacePath(task = {}) {
    const workspace = resolveAgentWorkspace(task.workspaceId, workspaceOptions);
    if (!task.worktree) return workspace.path;
    const expected = resolveExistingDirectory(task.worktree.directory || task.workspacePath || '');
    if (!expected) throw createHttpError(409, '该会话的 Worktree 已不存在，请在能力中心检查', 'AGENT_WORKTREE_MISSING');
    const available = await listWorkspaceWorktrees(workspace.id);
    const matched = available.find(item => isSamePath(item, expected));
    if (!matched) throw createHttpError(403, '该目录不是 OpenCode 为当前工作区创建的 Worktree', 'AGENT_WORKTREE_DENIED');
    task.workspacePath = matched;
    task.worktree.directory = matched;
    return matched;
  }

  async function requestTaskOpenCode(task, pathname, options = {}) {
    if (!task) throw createHttpError(404, '未找到 Agent 会话', 'AGENT_TASK_NOT_FOUND');
    const directory = await resolveTaskWorkspacePath(task);
    return await requestDirectoryOpenCode(task.workspaceId, directory, pathname, options, {
      profile: task.openCodeRuntimeProfile || 'native',
    });
  }

  async function createWorkspaceWorktree(workspaceId = '', name = '') {
    const workspace = resolveAgentWorkspace(workspaceId, workspaceOptions);
    const result = await requestWorkspaceOpenCode(workspace.id, '/experimental/worktree', {
      method: 'POST',
      body: { name: normalizeSingleLine(name || `agent-${Date.now().toString(36)}`, 120) },
      timeoutMs: 30000,
    });
    const worktree = normalizeWorktree({ ...result, baseWorkspaceId: workspace.id }, workspace);
    if (!worktree) throw createHttpError(500, 'OpenCode 已返回 Worktree，但目录不可用', 'AGENT_WORKTREE_CREATE_INVALID');
    const available = await listWorkspaceWorktrees(workspace.id);
    if (!available.some(item => isSamePath(item, worktree.directory))) {
      throw createHttpError(500, '新 Worktree 未出现在 OpenCode 目录列表中', 'AGENT_WORKTREE_CREATE_UNVERIFIED');
    }
    return worktree;
  }

  function serializeTerminal(terminal = {}) {
    return {
      id: terminal.id || '',
      workspaceId: terminal.workspaceId || '',
      title: terminal.title || '终端',
      command: terminal.command || '',
      cwd: terminal.cwd || '',
      status: terminal.status || 'unknown',
      pid: Math.max(0, Number(terminal.pid || 0)),
      exitCode: terminal.exitCode === undefined ? null : Number(terminal.exitCode),
      output: redactAgentText(terminal.output || '').slice(-AGENT_TERMINAL_OUTPUT_LIMIT),
      createdAt: terminal.createdAt || '',
      updatedAt: terminal.updatedAt || '',
    };
  }

  function listTerminals(workspaceId = '') {
    return Array.from(terminals.values())
      .filter(item => !workspaceId || item.workspaceId === workspaceId)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, AGENT_TERMINAL_LIMIT)
      .map(serializeTerminal);
  }

  function persistTasks() {
    try {
      refreshQueuePositions();
      fs.mkdirSync(path.dirname(sessionStorePath), { recursive: true });
      const payload = Array.from(tasks.values())
        .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
        .slice(0, AGENT_TASK_LIMIT)
        .map(task => serializeTask(task, { includeMessages: true, includeSecrets: true }));
      fs.writeFileSync(sessionStorePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } catch (error) {
      logger.warn?.(`[agent-workbench] 保存会话记录失败: ${error.message}`);
    }
  }

  function restoreTasks() {
    let stored = [];
    try {
      stored = JSON.parse(fs.readFileSync(sessionStorePath, 'utf8'));
    } catch {
      return;
    }
    if (!Array.isArray(stored)) return;
    const config = getConfig();
    for (const item of stored.slice(0, AGENT_TASK_LIMIT)) {
      const id = String(item?.id || '').trim();
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) continue;
      let workspace;
      let opencodeSessionId = '';
      let model = '';
      let agent = '';
      let modelProviderId = '';
      let variant = '';
      let customApi;
      try {
        workspace = resolveAgentWorkspace(item.workspaceId, workspaceOptions);
        opencodeSessionId = normalizeOpenCodeSessionId(item.opencodeSessionId);
        model = normalizeModel(item.model);
        agent = normalizeOpenCodeAgent(item.agent, isWriteMode(item.mode) ? 'build' : 'plan');
        modelProviderId = normalizeModelProviderId(item.modelProviderId);
        variant = normalizeModelVariant(item.variant);
        customApi = normalizeCustomAgentApi(item.customApi);
      } catch {
        continue;
      }
      const storedWorktreeDirectory = String(item.worktree?.directory || '').trim();
      const worktree = storedWorktreeDirectory ? {
        name: normalizeSingleLine(item.worktree?.name || path.basename(storedWorktreeDirectory), 120),
        branch: normalizeSingleLine(item.worktree?.branch || '', 200),
        directory: path.resolve(storedWorktreeDirectory),
        baseWorkspaceId: workspace.id,
      } : null;
      const wasPending = item.status === 'pending';
      const wasRunning = item.status === 'running';
      const interrupted = wasRunning;
      const task = {
        id,
        opencodeSessionId,
        title: normalizeSingleLine(item.title || 'Agent 会话', 80),
        providerId: 'opencode',
        providerLabel: PROVIDER_DEFINITIONS.opencode.label,
        workspaceId: workspace.id,
        workspaceLabel: workspace.label,
        workspacePath: worktree?.directory || workspace.path,
        worktree,
        agent,
        mode: normalizeMode(item.mode),
        model,
        modelProviderId,
        variant,
        customApi,
        archived: item.archived === true,
        allowNetwork: item.allowNetwork === true,
        allowAllDirectories: item.allowAllDirectories === true,
        allowTerminal: item.allowTerminal === true,
        pendingPermissions: [],
        pendingQuestions: [],
        currentAttachments: wasPending ? normalizeTaskAttachments(item.currentAttachments) : [],
        promptAttachments: normalizeTaskAttachments(item.promptAttachments),
        prompt: normalizePrompt(item.prompt),
        currentPrompt: normalizePrompt(item.prompt),
        promptPreview: normalizeSingleLine(item.promptPreview || item.prompt, 180),
         turnCount: Math.max(0, Number(item.turnCount || 0)),
         messages: Array.isArray(item.messages) ? item.messages.slice(-AGENT_MESSAGE_LIMIT).map(serializeAgentMessage) : [],
         followUps: normalizeAgentFollowUps(item.pendingFollowUps),
         followUpDelivery: normalizeAgentDelivery(item.followUpDelivery),
         followUpRevision: 0,
         followUpClosing: false,
         openCodePromptAdmitted: false,
         writeConfirmed: item.writeConfirmed === true,
        timeoutMs: clampInteger(item.timeoutMs, config.timeoutMs, 60000, config.timeoutMs),
        status: wasPending ? 'pending' : (interrupted ? 'interrupted' : String(item.status || 'success')),
        stage: interrupted ? 'interrupted' : String(item.stage || ''),
        queuedAt: wasPending ? (item.queuedAt || item.updatedAt || item.createdAt || new Date().toISOString()) : '',
        queuePosition: 0,
        resumeCount: Math.max(0, Number(item.resumeCount || 0)),
        priority: normalizeAgentPriority(item.priority),
        retryCount: Math.max(0, Number(item.retryCount || 0)),
        createdAt: item.createdAt || new Date().toISOString(),
        startedAt: item.startedAt || '',
        finishedAt: interrupted ? new Date().toISOString() : (item.finishedAt || ''),
        updatedAt: interrupted ? new Date().toISOString() : (item.updatedAt || item.createdAt || new Date().toISOString()),
        outputText: '',
        stderrText: redactAgentText(item.stderrText || ''),
        error: interrupted ? '控制台重启时本轮任务仍在执行，已标记为中断，可从当前会话继续' : redactAgentText(item.error || ''),
        events: Array.isArray(item.events) ? item.events.slice(-AGENT_EVENT_LIMIT) : [],
        command: Array.isArray(item.command) ? item.command : [],
        cancelRequested: false,
        canceled: item.canceled === true,
        timedOut: item.timedOut === true,
        workspaceChanged: item.workspaceChanged === true,
        gitCheckAvailable: item.gitCheckAvailable === true,
        gitCleanBefore: item.gitCleanBefore === true,
        changedFiles: Array.isArray(item.changedFiles) ? item.changedFiles.slice(0, 300) : [],
        diffStat: redactAgentText(item.diffStat || ''),
        diffText: redactAgentText(item.diffText || ''),
      usage: normalizeUsage(item.usage),
        contextUsage: Math.max(0, Number(item.contextUsage || 0)),
        contextLimit: Math.max(0, Number(item.contextLimit || 0)),
        lastCompactedAt: item.lastCompactedAt || '',
      };
      if (wasPending) addTaskEvent(task, 'info', '控制台重启后已恢复到任务队列');
      if (interrupted) addTaskEvent(task, 'warn', task.error);
      tasks.set(task.id, task);
    }
    refreshQueuePositions();
  }

  restoreTasks();

  function listTasks(options = {}) {
    const limit = clampInteger(options.limit, 20, 1, AGENT_TASK_LIMIT);
    const activeOnly = options.activeOnly === true;
    const query = normalizeSingleLine(options.query || '', 200).toLowerCase();
    const status = normalizeSingleLine(options.status || '', 40).toLowerCase();
    const includeArchived = options.includeArchived === true;
    const sorted = Array.from(tasks.values())
      .filter(task => includeArchived || task.archived !== true)
      .filter(task => !status || task.status === status)
      .filter(task => !query || `${task.title} ${task.prompt} ${task.workspaceLabel} ${task.model}`.toLowerCase().includes(query))
      .filter(task => !activeOnly || task.status === 'pending' || task.status === 'running')
      .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))
      .slice(0, limit);
    const detailedTaskId = String(options.taskId || sorted[0]?.id || '').trim();
    return sorted.map(task => {
      const selected = task.id === detailedTaskId;
      return serializeTask(task, { includeMessages: selected, includeDetails: selected });
    });
  }

  function buildUsageStats() {
    const allTasks = Array.from(tasks.values());
    const usage = allTasks.reduce((sum, task) => ({
      input: sum.input + Number(task.usage?.input || 0),
      output: sum.output + Number(task.usage?.output || 0),
      total: sum.total + Number(task.usage?.total || 0),
    }), { input: 0, output: 0, total: 0 });
    return {
      taskCount: allTasks.length,
      activeTaskCount: allTasks.filter(task => ['pending', 'running'].includes(task.status)).length,
      completedTaskCount: allTasks.filter(task => task.status === 'success').length,
      failedTaskCount: allTasks.filter(task => task.status === 'error').length,
      archivedTaskCount: allTasks.filter(task => task.archived === true).length,
      turnCount: allTasks.reduce((sum, task) => sum + Number(task.turnCount || 0), 0),
      toolCallCount: allTasks.reduce((sum, task) => sum + (Array.isArray(task.messages) ? task.messages.reduce((inner, message) => inner + (Array.isArray(message.tools) ? message.tools.length : 0), 0) : 0), 0),
      changedFileCount: allTasks.reduce((sum, task) => sum + (Array.isArray(task.changedFiles) ? task.changedFiles.length : 0), 0),
      elapsedMs: allTasks.reduce((sum, task) => sum + getTaskElapsedMs(task), 0),
      usage,
    };
  }

  function archiveTask(taskId = '', archived = true) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 会话', 'AGENT_TASK_NOT_FOUND');
    if (task.status === 'running' || task.status === 'pending') throw createHttpError(409, '执行中的会话不能归档', 'AGENT_SESSION_BUSY');
    task.archived = archived === true;
    task.updatedAt = new Date().toISOString();
    addTaskEvent(task, 'info', task.archived ? '会话已归档' : '会话已恢复到会话列表');
    persistTasks();
    emitWorkbenchUpdate('task', { task: serializeTask(task, { includeMessages: true }) });
    return { task: serializeTask(task, { includeMessages: true }) };
  }

  // 批量管理：归档/取消归档/删除多会话。执行中的会话会被跳过并回报原因
  async function batchManageTasks(options = {}) {
    const action = String(options.action || '').trim().toLowerCase();
    if (!['archive', 'unarchive', 'delete'].includes(action)) {
      throw createHttpError(400, '不支持的批量操作', 'AGENT_BATCH_ACTION_INVALID');
    }
    if (action === 'delete' && options.confirmed !== true) {
      throw createHttpError(428, '批量删除会话需要确认', 'AGENT_BATCH_DELETE_CONFIRMATION_REQUIRED');
    }
    const requested = Array.isArray(options.taskIds) ? options.taskIds : [];
    const ids = [...new Set(requested.map(id => String(id || '').trim()).filter(Boolean))].slice(0, 200);
    if (!ids.length) throw createHttpError(400, '请选择要操作的会话', 'AGENT_BATCH_IDS_REQUIRED');
    const done = [];
    const skipped = [];
    for (const taskId of ids) {
      const task = tasks.get(taskId);
      if (!task) {
        skipped.push({ id: taskId, reason: '会话不存在' });
        continue;
      }
      if (task.status === 'running' || task.status === 'pending') {
        skipped.push({ id: taskId, reason: '执行中的会话已跳过' });
        continue;
      }
      try {
        if (action === 'archive' || action === 'unarchive') {
          archiveTask(taskId, action === 'archive');
        } else {
          if (task.opencodeSessionId) {
            // 与单条删除一致：DELETE /session/{id}，directory 由 requestDirectoryOpenCode 附加
            await requestTaskOpenCode(task, `/session/${encodeURIComponent(task.opencodeSessionId)}`, { method: 'DELETE', timeoutMs: 8000 })
              .catch(error => {
                logger.warn?.(`[agent-workbench] 批量删除时清理 OpenCode 会话失败，仍删除本地记录: ${error.message}`);
              });
          }
          tasks.delete(task.id);
          persistTasks();
          emitWorkbenchUpdate('task_removed', { taskId: task.id });
        }
        done.push(taskId);
      } catch (error) {
        skipped.push({ id: taskId, reason: normalizeSingleLine(error?.message || '操作失败', 120) });
      }
    }
    if (done.length) persistTasks();
    pruneTasks();
    return { action, done, skipped };
  }

  function exportTask(taskId = '') {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 会话', 'AGENT_TASK_NOT_FOUND');
    return {
      format: 'crystelf-agent-session',
      version: 1,
      exportedAt: new Date().toISOString(),
      task: serializeTask(task, { includeMessages: true }),
    };
  }

  function importTask(payload = {}) {
    const source = payload.task && typeof payload.task === 'object' ? payload.task : payload;
    const workspace = resolveAgentWorkspace(source.workspaceId, workspaceOptions);
    const createdAt = new Date().toISOString();
    const task = {
      id: `agent-import-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      opencodeSessionId: normalizeOpenCodeSessionId(source.opencodeSessionId),
      title: normalizeSingleLine(source.title || '导入的 Agent 会话', 80),
      providerId: 'opencode', providerLabel: PROVIDER_DEFINITIONS.opencode.label,
      workspaceId: workspace.id, workspaceLabel: workspace.label, workspacePath: workspace.path,
      worktree: null, agent: normalizeOpenCodeAgent(source.agent, 'plan'), mode: normalizeMode(source.mode),
      model: normalizeModel(source.model), modelProviderId: normalizeModelProviderId(source.modelProviderId),
      variant: normalizeModelVariant(source.variant),
      customApi: normalizeCustomAgentApi({}), allowNetwork: source.allowNetwork === true,
      allowAllDirectories: source.allowAllDirectories === true, allowTerminal: false,
      pendingPermissions: [], pendingQuestions: [], currentAttachments: [],
      prompt: normalizePrompt(source.prompt), currentPrompt: '', promptPreview: normalizeSingleLine(source.promptPreview || source.prompt, 180),
      turnCount: Math.max(0, Number(source.turnCount || 0)),
      messages: Array.isArray(source.messages) ? source.messages.slice(-AGENT_MESSAGE_LIMIT).map(serializeAgentMessage) : [],
      writeConfirmed: false, timeoutMs: clampInteger(source.timeoutMs, getConfig().timeoutMs, 60000, 7200000),
      status: 'success', stage: 'imported', queuedAt: '', queuePosition: 0, resumeCount: 0,
      priority: normalizeAgentPriority(source.priority), retryCount: 0, createdAt, startedAt: source.startedAt || '',
      finishedAt: source.finishedAt || createdAt, updatedAt: createdAt, outputText: redactAgentText(source.outputText || ''),
      stderrText: redactAgentText(source.stderrText || ''), error: redactAgentText(source.error || ''), events: [], command: [],
      cancelRequested: false, canceled: false, timedOut: false, workspaceChanged: false, gitCheckAvailable: false,
      gitCleanBefore: false, changedFiles: [], diffStat: '', diffText: '', archived: false, usage: normalizeUsage(source.usage),
      contextUsage: Math.max(0, Number(source.contextUsage || 0)),
      contextLimit: Math.max(0, Number(source.contextLimit || 0)),
      lastCompactedAt: source.lastCompactedAt || '',
    };
    tasks.set(task.id, task);
    pruneTasks();
    emitTaskUpdate(task, 'task', true);
    return serializeTask(task, { includeMessages: true });
  }

  function pruneTasks() {
    const sorted = Array.from(tasks.values())
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    for (const task of sorted.slice(AGENT_TASK_LIMIT)) {
      if (task.status !== 'running' && task.status !== 'pending') tasks.delete(task.id);
    }
    persistTasks();
  }

  function refreshQueuePositions() {
    const queued = Array.from(tasks.values())
      .filter(task => task.status === 'pending')
      .sort((left, right) => getAgentPriorityWeight(left.priority) - getAgentPriorityWeight(right.priority)
        || String(left.queuedAt || left.createdAt || '').localeCompare(String(right.queuedAt || right.createdAt || '')));
    queued.forEach((task, index) => {
      task.queuePosition = index + 1;
    });
    for (const task of tasks.values()) {
      if (task.status !== 'pending') task.queuePosition = 0;
    }
  }

  function failQueuedTask(task, error) {
    delete task.child;
    task.currentAttachments = [];
    task.status = 'error';
    task.stage = 'error';
    task.error = normalizeSingleLine(error?.message || String(error), 1000);
    task.finishedAt = new Date().toISOString();
    task.updatedAt = task.finishedAt;
    addTaskEvent(task, 'error', task.error);
    task.messages.push({
      id: `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      role: 'assistant',
      content: '',
      createdAt: task.startedAt || task.updatedAt,
      finishedAt: task.finishedAt,
      elapsedMs: getTaskElapsedMs(task),
      mode: task.mode,
      status: 'error',
      error: task.error,
      stderrText: task.stderrText,
    });
    trimTaskMessages(task);
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    logger.error?.(`[agent-workbench] 任务失败 ${task.id}: ${error.stack || error.message}`);
  }

  async function dispatchTaskQueue() {
    refreshQueuePositions();
    const config = getConfig();
    let runningCount = Array.from(tasks.values()).filter(task => task.status === 'running').length;
    while (runningCount < config.maxConcurrentTasks) {
      const nextTask = Array.from(tasks.values())
        .filter(task => task.status === 'pending')
        .sort((left, right) => getAgentPriorityWeight(left.priority) - getAgentPriorityWeight(right.priority)
          || String(left.queuedAt || left.createdAt || '').localeCompare(String(right.queuedAt || right.createdAt || '')))[0];
      if (!nextTask) break;
      runningCount += 1;
      runTask(nextTask)
        .catch(error => failQueuedTask(nextTask, error))
        .finally(() => scheduleTaskDispatch());
    }
    refreshQueuePositions();
    persistTasks();
  }

  function scheduleTaskDispatch() {
    if (dispatchScheduled) return;
    dispatchScheduled = true;
    setTimeout(() => {
      dispatchScheduled = false;
      dispatchTaskQueue().catch(error => logger.error?.(`[agent-workbench] 任务队列调度失败: ${error.stack || error.message}`));
    }, 0).unref?.();
  }

  async function probeProvider(providerId, force = false) {
    const id = normalizeProviderId(providerId);
    const cached = providerProbeCache.get(id);
    if (!force && cached && Date.now() - cached.checkedAtMs < PROVIDER_PROBE_TTL_MS) return cached.value;
    const usePrivateRuntime = id === 'opencode' && Boolean(resolveBundledOpenCodeCommand({ rootPath: Path.root }));
    const processEnv = buildAgentProcessEnv(process.env, {
      fallbackRoot: Path.data,
      forcePrivateRuntime: usePrivateRuntime,
    });
    const executable = resolveAgentProviderCommand(id, { env: processEnv });
    let result = await runCapturedProcess(executable.command, [...executable.baseArgs, '--version'], {
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
      outputLimit: 4000,
      env: processEnv,
    }).catch(error => ({ code: -1, error, stdout: '', stderr: '' }));
    const probeFailure = `${result.error?.message || ''}\n${result.stderr || ''}\n${result.stdout || ''}`;
    if (id === 'opencode' && usePrivateRuntime && result.code !== 0 && isBundledOpenCodeBootstrapError(probeFailure)) {
      const bootstrapResult = await bootstrapBundledOpenCode(processEnv);
      if (bootstrapResult?.code === 0) {
        result = await runCapturedProcess(executable.command, [...executable.baseArgs, '--version'], {
          timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
          outputLimit: 4000,
          env: processEnv,
        }).catch(error => ({ code: -1, error, stdout: '', stderr: '' }));
      } else if (bootstrapResult) {
        result.bootstrapError = normalizeSingleLine(
          bootstrapResult.error?.message || bootstrapResult.stderr || bootstrapResult.stdout || '运行文件自动补全失败',
          300,
        );
      }
    }
    const version = normalizeSingleLine(result.stdout || result.stderr, 120);
    const available = result.code === 0;
    const value = {
      ...PROVIDER_DEFINITIONS[id],
      available,
      version: available ? version : '',
      source: executable.source === 'plugin'
        ? '插件内置'
        : (executable.source === 'PATH' ? '系统 PATH' : '系统安装'),
      error: available ? '' : normalizeSingleLine(result.bootstrapError || result.error?.message || result.stderr || 'CLI 无法启动', 300),
      checkedAt: new Date().toISOString(),
    };
    providerProbeCache.set(id, { checkedAtMs: Date.now(), value });
    return value;
  }

  async function bootstrapBundledOpenCode(processEnv) {
    const existing = providerBootstrapInFlight.get('opencode');
    if (existing) return await existing;
    const bootstrap = resolveBundledOpenCodeBootstrapCommand({ rootPath: Path.root });
    if (!bootstrap) return null;
    const task = runCapturedProcess(bootstrap.command, bootstrap.args, {
      cwd: bootstrap.cwd,
      env: processEnv,
      timeoutMs: PROVIDER_BOOTSTRAP_TIMEOUT_MS,
      outputLimit: 8000,
    }).finally(() => {
      providerBootstrapInFlight.delete('opencode');
    });
    providerBootstrapInFlight.set('opencode', task);
    logger.mark?.('[agent-workbench] 检测到 OpenCode 运行文件缺失，正在自动补全。');
    return await task;
  }

  async function getProviderSnapshots(force = false) {
    return await Promise.all(Object.keys(PROVIDER_DEFINITIONS).map(id => probeProvider(id, force)));
  }

  async function buildPayload(options = {}) {
    const config = getConfig();
    const publicConfig = {
      ...config,
      customApi: {
        ...config.customApi,
        apiKey: config.customApi.apiKey ? '已配置' : '',
      },
      nativeConfig: maskNativeOpenCodeConfig(config.nativeConfig),
    };
    const providers = await getProviderSnapshots(options.force === true);
    const workspaces = getAgentWorkspaceOptions(workspaceOptions).map(item => ({
      id: item.id,
      label: item.label,
      description: item.description,
      path: item.path,
    }));
    const taskItems = listTasks({ limit: 30, taskId: options.taskId, query: options.query, status: options.status, includeArchived: options.includeArchived === true });
    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        config: publicConfig,
        providers: providers.map(provider => ({
          ...provider,
          enabled: config.providers[provider.id] !== false,
        })),
        workspaces,
        tasks: taskItems,
        summary: {
          providerCount: providers.length,
          availableProviderCount: providers.filter(item => item.available).length,
          activeTaskCount: taskItems.filter(item => item.status === 'pending' || item.status === 'running').length,
          runningTaskCount: taskItems.filter(item => item.status === 'running').length,
          queuedTaskCount: taskItems.filter(item => item.status === 'pending').length,
          interruptedTaskCount: taskItems.filter(item => item.status === 'interrupted').length,
          successTaskCount: taskItems.filter(item => item.status === 'success').length,
          failedTaskCount: taskItems.filter(item => item.status === 'error').length,
          archivedTaskCount: buildUsageStats().archivedTaskCount,
        },
        stats: buildUsageStats(),
        safety: {
          readOnlyAgent: 'plan',
          writeAgent: 'build',
          writeEnabled: config.writeEnabled === true,
          networkAccess: config.allowNetwork === true,
          pureMode: true,
          automaticApproval: false,
          directFileWrite: config.writeEnabled === true,
          shellAccess: false,
          terminalApproval: config.allowTerminal === true,
          externalDirectoryAccess: config.allowAllDirectories === true,
        },
      },
    };
  }

  async function saveConfig(payload = {}) {
    const nextConfig = normalizeAgentWorkbenchConfig(payload);
    const currentConfig = getConfig();
    if (!String(payload.customApi?.apiKey || '').trim() && currentConfig.customApi.apiKey) {
      nextConfig.customApi.apiKey = currentConfig.customApi.apiKey;
    }
    nextConfig.nativeConfig = payload.nativeConfig === undefined
      ? currentConfig.nativeConfig
      : mergeMaskedNativeOpenCodeConfig(nextConfig.nativeConfig, currentConfig.nativeConfig);
    const coreConfig = ConfigControl.get('coreConfig') || {};
    await ConfigControl.set('coreConfig', {
      ...coreConfig,
      tools: {
        ...(coreConfig.tools || {}),
        agentWorkbench: nextConfig,
      },
    }, {
      action: 'agent_workbench_save',
      source: 'web_console',
    });
    return await buildPayload({ force: false });
  }

  function findTaskMessage(task, messageId = '') {
    return (Array.isArray(task?.messages) ? task.messages : []).find(message => message.id === messageId);
  }

  async function admitTaskFollowUp(task, followUp, server) {
    if (!server?.url || !task.opencodeSessionId || followUp.state !== 'pending') return false;
    followUp.state = 'admitting';
    followUp.attempts = Math.max(0, Number(followUp.attempts || 0)) + 1;
    const message = findTaskMessage(task, followUp.messageId);
    if (message) message.status = 'sending';
    emitTaskUpdate(task, 'task', true);
    try {
      const result = await requestOpenCodeJson(
        server,
        `/api/session/${encodeURIComponent(task.opencodeSessionId)}/prompt`,
        {
          method: 'POST',
          body: buildOpenCodeFollowUpRequest(task, followUp),
          timeoutMs: 10000,
        },
      );
      const admitted = result?.data && typeof result.data === 'object' ? result.data : result;
      followUp.openCodeMessageId = normalizeOpenCodeMessageId(admitted?.id || extractOpenCodeMessageId(JSON.stringify(result)));
      followUp.admittedAt = new Date().toISOString();
      if (message) {
        message.openCodeMessageId = followUp.openCodeMessageId;
        message.status = 'sent';
        message.error = '';
      }
      task.followUps = task.followUps.filter(item => item.id !== followUp.id);
      task.followUpRevision = Math.max(0, Number(task.followUpRevision || 0)) + 1;
      task.updatedAt = followUp.admittedAt;
      addTaskEvent(task, 'info', followUp.delivery === 'steer' ? '补充要求已注入当前执行' : '补充要求已加入 OpenCode 队列');
      emitTaskUpdate(task, 'task', true);
      persistTasks();
      return true;
    } catch (error) {
      followUp.state = followUp.attempts >= 2 || /请求失败（(?:400|404)）/.test(error.message)
        ? 'failed'
        : 'pending';
      followUp.error = normalizeSingleLine(error.message, 500);
      if (message) {
        message.status = followUp.state === 'failed' ? 'error' : 'queued';
        message.error = followUp.state === 'failed' ? `跟进消息未送达：${followUp.error}` : '';
      }
      task.updatedAt = new Date().toISOString();
      addTaskEvent(task, followUp.state === 'failed' ? 'error' : 'warn', followUp.state === 'failed'
        ? `跟进消息发送失败：${followUp.error}`
        : `跟进消息暂未送达，将自动重试（${followUp.error}）`);
      if (followUp.state === 'failed') task.followUps = task.followUps.filter(item => item.id !== followUp.id);
      emitTaskUpdate(task, 'task', true);
      persistTasks();
      return false;
    }
  }

  function scheduleTaskFollowUpFlush(task) {
    if (!task?.openCodeServer || !task.opencodeSessionId) return Promise.resolve(false);
    if (task.followUpFlushPromise) return task.followUpFlushPromise;
    const promise = (async () => {
      let admitted = false;
      while (!task.cancelRequested && !task.followUpClosing) {
        const pending = task.followUps.filter(item => item.state === 'pending');
        if (!pending.length) break;
        for (const followUp of pending) {
          if (task.cancelRequested || task.followUpClosing) break;
          admitted = await admitTaskFollowUp(task, followUp, task.openCodeServer) || admitted;
        }
      }
      return admitted;
    })().finally(() => {
      if (task.followUpFlushPromise === promise) delete task.followUpFlushPromise;
    });
    task.followUpFlushPromise = promise;
    return promise;
  }

  async function enqueueTaskFollowUp(task, payload = {}) {
    if (task.providerId !== 'opencode') {
      throw createHttpError(409, '当前 Agent 提供方不支持运行中跟进', 'AGENT_FOLLOW_UP_UNSUPPORTED');
    }
    if (task.followUpClosing === true || task.stage === 'verify') {
      throw createHttpError(409, '当前任务正在收尾，请等待完成后再发送', 'AGENT_FOLLOW_UP_CLOSING');
    }
    const prompt = normalizePrompt(payload.prompt);
    if (prompt.length < 2) throw createHttpError(400, '请输入需要跟进的内容', 'AGENT_PROMPT_REQUIRED');
    const attachments = normalizeTaskAttachments(payload.attachments);
    if (attachments.some(item => /^image\//i.test(item.mime))) {
      const effectiveModel = task.model
        || (task.customApi?.enabled === true ? task.customApi.model : '')
        || normalizeModel(ConfigControl?.get?.('ai')?.modelType || ConfigControl?.get?.('ai')?.workingModel || '');
      assertAgentImageSupport(effectiveModel);
    }
    const delivery = normalizeAgentDelivery(payload.delivery);
    const createdAt = new Date().toISOString();
    const messageId = `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const followUp = {
      id: `followup-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      messageId,
      prompt,
      attachments,
      delivery,
      state: 'pending',
      attempts: 0,
      createdAt,
      admittedAt: '',
      error: '',
    };
    task.followUps = [...(Array.isArray(task.followUps) ? task.followUps : []), followUp].slice(-AGENT_FOLLOW_UP_LIMIT);
    task.followUpDelivery = delivery;
    task.turnCount = Math.max(0, Number(task.turnCount || 0)) + 1;
    task.updatedAt = createdAt;
    task.messages = Array.isArray(task.messages) ? task.messages : [];
    task.messages.push({
      id: messageId,
      role: 'user',
      content: prompt,
      createdAt,
      mode: task.mode,
      status: 'queued',
      delivery,
      attachments: attachments.map(item => ({ name: item.name, mime: item.mime, size: item.size })),
    });
    trimTaskMessages(task);
    addTaskEvent(task, 'info', delivery === 'steer' ? '已收到立即调整要求' : '已收到排队跟进要求');
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    if (task.openCodeServer && task.opencodeSessionId && task.openCodePromptAdmitted === true) {
      await scheduleTaskFollowUpFlush(task);
    }
    return serializeTask(task, { includeMessages: true });
  }

  async function runTask(task) {
    task.openCodePromptAdmitted = false;
    task.outputText = '';
    task.liveOutputText = '';
    task.stderrText = '';
    task.error = '';
    task.command = [];
    task.cancelRequested = false;
    task.canceled = false;
    task.timedOut = false;
    task.workspaceChanged = false;
    task.changedFiles = [];
    task.diffStat = '';
    task.diffText = '';
    task.pendingPermissions = [];
    task.pendingQuestions = [];
    task.status = 'running';
    task.stage = 'precheck';
    task.startedAt = new Date().toISOString();
    task.updatedAt = task.startedAt;
    addTaskEvent(task, 'info', isWriteMode(task.mode) ? '开始写入安全检查' : '开始只读安全检查');
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    task.workspacePath = await resolveTaskWorkspacePath(task);
    const beforeGitStatus = await readGitStatus(task.workspacePath);
    task.gitCheckAvailable = beforeGitStatus !== null;
    task.gitCleanBefore = beforeGitStatus === '';
    if (isWriteMode(task.mode) && beforeGitStatus === null) {
      addTaskEvent(task, 'warn', '无法读取 Git 状态，将继续执行，但无法自动汇总文件改动');
    } else if (isWriteMode(task.mode) && beforeGitStatus) {
      addTaskEvent(task, 'warn', '工作目录已有未提交修改，将继续执行；请根据备份和任务前后的差异自行核对');
    }
    if (task.cancelRequested) {
      task.canceled = true;
      task.status = 'canceled';
      task.stage = 'canceled';
      task.error = '任务已取消';
      task.finishedAt = new Date().toISOString();
      task.updatedAt = task.finishedAt;
      addTaskEvent(task, 'warn', '任务已取消');
      persistTasks();
      return;
    }
    let processEnv = buildAgentProcessEnv();
    let commandModel = task.model;
    if (task.providerId === 'opencode' && resolveBundledOpenCodeCommand({ rootPath: Path.root })) {
      const bundledRuntime = buildBundledOpenCodeEnvironment({
        aiConfig: ConfigControl?.get?.('ai') || {},
        model: task.model,
        writeMode: isWriteMode(task.mode),
        fullAccess: isFullAccessMode(task.mode),
        customApi: task.customApi,
        allowNetwork: task.allowNetwork === true,
        allowAllDirectories: task.allowAllDirectories === true,
        allowTerminal: task.allowTerminal === true,
        nativeConfig: normalizeAgentWorkbenchConfig(ConfigControl?.get?.('coreConfig')?.tools?.agentWorkbench || {}).nativeConfig,
      });
      processEnv = buildAgentProcessEnv(bundledRuntime.env, {
        fallbackRoot: bundledRuntime.runtimeRoot,
      });
      processEnv.OPENCODE_CONFIG_CONTENT = bundledRuntime.env.OPENCODE_CONFIG_CONTENT;
      commandModel = task.model
        ? (task.modelProviderId ? `${task.modelProviderId}/${task.model}` : getBundledOpenCodeModelRef(task.model))
        : '';
    }
    let attachedServer = null;
    let attachedRuntime = null;
    if (task.providerId === 'opencode') {
      addTaskEvent(task, 'info', '正在连接 OpenCode 受控服务');
      emitTaskUpdate(task);
      task.openCodeRuntimeProfile = getAgentRuntimeProfile(task);
      attachedRuntime = await getDirectoryRuntime(task.workspaceId, task.workspacePath, {
        processEnv,
        profile: task.openCodeRuntimeProfile,
      });
      attachedRuntime.activeTaskIds.add(task.id);
      attachedServer = attachedRuntime.server;
      task.openCodeServer = attachedServer;
    }
    const commandSpec = attachedServer ? null : buildAgentRunCommand({
      providerId: task.providerId,
      workspacePath: task.workspacePath,
      mode: task.mode,
      prompt: task.prompt,
      title: task.title,
      model: commandModel,
      variant: task.variant,
      sessionId: task.opencodeSessionId,
      env: processEnv,
      allowNetwork: task.allowNetwork === true,
      allowAllDirectories: task.allowAllDirectories === true,
      allowTerminal: task.allowTerminal === true,
      fullAccess: isFullAccessMode(task.mode),
    });
    const openCodeQuery = `?directory=${encodeURIComponent(task.workspacePath)}`;
    const opencodeAgent = resolveOpenCodeTaskAgent(task);
    const opencodeModel = commandModel ? buildOpenCodeModelSelection(commandModel) : null;
    if (attachedServer) {
      if (!task.opencodeSessionId) {
        const session = await requestOpenCodeJson(attachedServer, `/session${openCodeQuery}`, {
          method: 'POST',
          body: { title: task.title, agent: opencodeAgent },
          timeoutMs: 5000,
        });
        task.opencodeSessionId = normalizeOpenCodeSessionId(session?.id || '');
      } else {
        await requestOpenCodeJson(attachedServer, `/session/${encodeURIComponent(task.opencodeSessionId)}${openCodeQuery}`, {
          timeoutMs: 5000,
        });
      }
      task.command = [
        'opencode', 'session.message', '--agent', opencodeAgent, '--dir', task.workspacePath,
        ...(task.variant ? ['--variant', task.variant] : []),
        '[PROMPT]',
      ];
    } else {
      task.command = [path.basename(commandSpec.command), ...commandSpec.args.slice(0, -1), '[PROMPT]'];
    }
    task.stage = 'running';
    addTaskEvent(task, 'info', `正在调用 ${task.providerLabel}`);

    const previousOpenCodeMessageIds = new Set(
      (Array.isArray(task.messages) ? task.messages : [])
        .filter(message => message?.role === 'assistant')
        .map(message => normalizeOpenCodeMessageId(message.openCodeMessageId))
        .filter(Boolean),
    );
    if (attachedServer && task.opencodeSessionId) {
      const existingMessages = await requestOpenCodeJson(
        attachedServer,
        `/session/${encodeURIComponent(task.opencodeSessionId)}/message${openCodeQuery}&limit=20`,
        { timeoutMs: 3000 },
      ).catch(() => []);
      for (const message of Array.isArray(existingMessages) ? existingMessages : []) {
        if (message?.info?.role !== 'assistant') continue;
        const messageId = normalizeOpenCodeMessageId(message?.info?.id || message?.info?.messageID || message?.messageID);
        if (messageId) previousOpenCodeMessageIds.add(messageId);
      }
    }
    let permissionPollBusy = false;
    let nativeEventStreamFailed = false;
    let liveMessagesRead = false;
    const refreshPendingPermissions = async () => {
      if (!attachedServer || permissionPollBusy) return;
      permissionPollBusy = true;
      try {
        const permissions = await requestOpenCodeJson(attachedServer, `/permission${openCodeQuery}`, { timeoutMs: 1800 });
        const next = Array.isArray(permissions) ? permissions.slice(0, AGENT_PERMISSION_LIMIT) : [];
        const previousIds = (task.pendingPermissions || []).map(item => item.id).join(',');
        const nextIds = next.map(item => item.id).join(',');
        task.pendingPermissions = next;
        if (previousIds !== nextIds) {
          if (next.length) addTaskEvent(task, 'warn', `等待审批 ${next.length} 项终端操作`);
          emitTaskUpdate(task, 'permission', true);
        }
        if (task.opencodeSessionId && (!liveMessagesRead || nativeEventStreamFailed)) {
          const messages = await requestOpenCodeJson(
            attachedServer,
            `/session/${encodeURIComponent(task.opencodeSessionId)}/message${openCodeQuery}&limit=${AGENT_PROGRESS_MESSAGE_LIMIT}`,
            { timeoutMs: 1800 },
          );
          liveMessagesRead = true;
          const liveSteps = parseOpenCodeTurnSteps(
            getLatestOpenCodeAssistantOutput(messages, task.opencodeSessionId, previousOpenCodeMessageIds),
          )
            .filter(step => step.content || step.reasoning || step.tools.length)
            .slice(-20)
            .map(step => ({
              messageId: step.messageId,
              content: step.content,
              reasoning: (step.reasoning || '').slice(-4000),
            }));
          if (liveSteps.length) {
            task.liveSteps = liveSteps;
            const signature = JSON.stringify(liveSteps);
            if (signature !== task.liveStepsSignature) {
              task.liveStepsSignature = signature;
              emitTaskDelta(task, { steps: task.liveSteps });
            }
          }
        }
      } catch (error) {
        if (task.status === 'running') logger.warn?.(`[agent-workbench] 权限队列读取失败: ${error.message}`);
      } finally {
        permissionPollBusy = false;
      }
    };
    const permissionPollTimer = attachedServer
      ? setInterval(() => refreshPendingPermissions().catch(() => {}), AGENT_PROGRESS_POLL_MS)
      : null;
    permissionPollTimer?.unref?.();
    if (attachedServer) await refreshPendingPermissions();
    const nativeEventStream = attachedServer
      ? startOpenCodeEventStream(attachedServer, task.workspacePath, event => {
        const type = String(event?.type || '').toLowerCase();
        const properties = event?.properties && typeof event.properties === 'object' ? event.properties : {};
        const requestId = normalizeSingleLine(properties.id || properties.requestID || properties.requestId || '', 120);
        if (type.includes('permission') && type.includes('asked')) {
          const next = {
            id: requestId,
            action: properties.permission || properties.action || '终端操作',
            resources: properties.patterns || properties.resources || [],
            metadata: properties.metadata || properties,
          };
          if (next.id && !(task.pendingPermissions || []).some(item => item.id === next.id)) {
            task.pendingPermissions = [next, ...(task.pendingPermissions || [])].slice(0, AGENT_PERMISSION_LIMIT);
            addTaskEvent(task, 'warn', `OpenCode 请求审批：${next.action}`);
            emitTaskUpdate(task, 'permission', true);
          }
          return;
        }
        if (type.includes('permission') && (type.includes('replied') || type.includes('resolved'))) {
          task.pendingPermissions = (task.pendingPermissions || []).filter(item => item.id !== requestId);
          emitTaskUpdate(task, 'permission', true);
          return;
        }
        if (type.includes('question') && type.includes('asked')) {
          const next = {
            id: requestId,
            questions: Array.isArray(properties.questions) ? properties.questions : [],
          };
          if (next.id && !(task.pendingQuestions || []).some(item => item.id === next.id)) {
            task.pendingQuestions = [next, ...(task.pendingQuestions || [])].slice(0, AGENT_QUESTION_LIMIT);
            addTaskEvent(task, 'warn', 'OpenCode 正在等待你的回答');
            emitTaskUpdate(task, 'question', true);
          }
          return;
        }
        if (type.includes('question') && (type.includes('replied') || type.includes('rejected'))) {
          task.pendingQuestions = (task.pendingQuestions || []).filter(item => item.id !== requestId);
          emitTaskUpdate(task, 'question', true);
          return;
        }
        if (type === 'crystelf.event_stream_error' || type === 'crystelf.event_stream_closed') {
          nativeEventStreamFailed = true;
          addTaskEvent(task, 'warn', type === 'crystelf.event_stream_closed'
            ? '原生事件流已断开，已切换为低频消息轮询'
            : `原生事件流暂时不可用：${properties.message || '未知错误'}`);
          emitTaskUpdate(task);
          return;
        }
        if (type === 'session.error') {
          const errorSessionId = String(properties.sessionID || properties.sessionId || '').trim();
          const errorName = String(properties.error?.name || '').trim();
          // MessageAbortedError 来自主动取消，由取消链路收尾；sessionID 缺失时不归属到本任务
          if (errorSessionId && errorSessionId === task.opencodeSessionId && errorName !== 'MessageAbortedError') {
            task.openCodeSessionError = describeOpenCodeSessionError(properties.error);
            addTaskEvent(task, 'error', `OpenCode 会话错误：${task.openCodeSessionError}`);
            emitTaskUpdate(task);
          }
          return;
        }
        if (type === 'message.updated') {
          // 记录消息角色：part.updated 不带角色，靠这张表过滤用户消息部件（防止安全提示词泄漏进实时输出）
          const info = properties.info && typeof properties.info === 'object'
            ? properties.info
            : (properties.message && typeof properties.message === 'object' ? properties.message : {});
          const messageId = normalizeOpenCodeMessageId(info.id || info.messageID || '');
          const role = String(info.role || '').toLowerCase();
          if (messageId && role) {
            if (!task.openCodeMessageRoles || typeof task.openCodeMessageRoles !== 'object') task.openCodeMessageRoles = {};
            task.openCodeMessageRoles[messageId] = role;
          }
          return;
        }
        if (type === 'message.part.updated' || type === 'message.part.delta') {
          // 1.18.4 的流式增量走 part.updated（part 为累计快照，含 type/messageID）；
          // 兼容旧版纯 delta 事件时退化为追加。按 messageID 分步：text 进正文、reasoning 进思考滚动条
          const part = properties.part && typeof properties.part === 'object' ? properties.part : null;
          const sessionId = String(properties.sessionID || properties.sessionId || part?.sessionID || '').trim();
          if (sessionId && sessionId !== task.opencodeSessionId) return;
          const partType = String(part?.type || '').toLowerCase();
          if (part && (partType !== 'text' && partType !== 'reasoning')) return;
          if (part && part.synthetic === true) return;
          const messageId = normalizeOpenCodeMessageId(part?.messageID || properties.messageID || '') || 'live';
          // 用户消息部件（内含安全提示词）不属于助手输出
          if (String(task.openCodeMessageRoles?.[messageId] || '').toLowerCase() === 'user') return;
          const text = part ? String(part.text || '') : String(properties.delta || properties.text || '');
          if (!text) return;
          if (!Array.isArray(task.liveSteps)) task.liveSteps = [];
          let step = task.liveSteps.find(item => item.messageId === messageId);
          if (!step) {
            step = { messageId, content: '', reasoning: '' };
            task.liveSteps.push(step);
            if (task.liveSteps.length > 20) task.liveSteps = task.liveSteps.slice(-20);
          }
          if (partType === 'reasoning') {
            step.reasoning = text.slice(-4000);
          } else {
            step.content = part ? text.slice(-12000) : appendLimited(step.content, text, 12000);
          }
          task.updatedAt = new Date().toISOString();
          emitTaskDelta(task, { steps: task.liveSteps.slice(-20) });
          return;
        }
        if (AGENT_NOISY_EVENT_TYPES.has(type) || type.includes('heartbeat')) return;
        if (type && !type.includes('heartbeat')) {
          const eventDetail = normalizeSingleLine(
            properties.title || properties.name || properties.action || properties.command || properties.path || '',
            220,
          );
          addTaskEvent(task, 'info', `OpenCode：${type}${eventDetail ? ` · ${eventDetail}` : ''}`);
          emitTaskUpdate(task);
        }
      })
      : null;
    task.openCodeEventStream = nativeEventStream;

    let result;
    try {
      if (attachedServer) {
        const requestAbort = new AbortController();
        task.openCodeRequestAbort = requestAbort;
        try {
          await maybeAutoCompactSession(task, attachedServer, openCodeQuery);
          const promptBody = {
            agent: opencodeAgent,
            ...(opencodeModel ? { model: opencodeModel } : {}),
            ...(task.variant ? { variant: task.variant } : {}),
            parts: [
              {
                type: 'text',
                text: buildSafetyPrompt(task.mode, task.prompt, {
                  fullAccess: isFullAccessMode(task.mode),
                  allowNetwork: task.allowNetwork === true,
                  allowAllDirectories: task.allowAllDirectories === true,
                  allowTerminal: task.allowTerminal === true,
                }),
              },
              ...(Array.isArray(task.currentAttachments) ? task.currentAttachments.map(item => ({
                type: 'file', mime: item.mime, filename: item.name, url: item.url,
              })) : []),
            ],
          };
          await requestOpenCodeJson(
            attachedServer,
            `/session/${encodeURIComponent(task.opencodeSessionId)}/prompt_async${openCodeQuery}`,
            {
              method: 'POST',
              body: promptBody,
              timeoutMs: 10000,
              signal: requestAbort.signal,
            },
          );
          task.openCodePromptAdmitted = true;
          delete task.openCodeSessionError;
          task.stage = 'waiting';
          task.updatedAt = new Date().toISOString();
          addTaskEvent(task, 'info', 'OpenCode 已接收任务，正在异步执行');
          emitTaskUpdate(task, 'task', true);
          await scheduleTaskFollowUpFlush(task);
          while (true) {
            const revisionBeforeWait = Math.max(0, Number(task.followUpRevision || 0));
            await waitForOpenCodeSessionIdle(
              attachedServer,
              task.opencodeSessionId,
              task.workspacePath,
              {
                timeoutMs: task.timeoutMs,
                signal: requestAbort.signal,
                onPollFailure: message => {
                  addTaskEvent(task, 'warn', message);
                  emitTaskUpdate(task);
                },
                errorCheck: () => (task.openCodeSessionError ? `OpenCode 会话错误：${task.openCodeSessionError}` : ''),
                completionCheck: async () => {
                  const messages = await requestOpenCodeJson(
                    attachedServer,
                    `/session/${encodeURIComponent(task.opencodeSessionId)}/message${openCodeQuery}&limit=20`,
                    { timeoutMs: 3000, signal: requestAbort.signal },
                  ).catch(() => []);
                  return hasCompletedOpenCodeAssistantTurn(messages, previousOpenCodeMessageIds);
                },
              },
            );
            delete task.openCodeSessionError;
            task.followUpClosing = true;
            await task.followUpFlushPromise?.catch(() => false);
            const hasPendingFollowUps = task.followUps.some(item => item.state === 'pending' || item.state === 'admitting');
            const followUpsChanged = Math.max(0, Number(task.followUpRevision || 0)) !== revisionBeforeWait;
            if (!hasPendingFollowUps && !followUpsChanged) break;
            task.followUpClosing = false;
            await scheduleTaskFollowUpFlush(task);
          }
          task.stage = 'verify';
          task.updatedAt = new Date().toISOString();
          emitTaskUpdate(task, 'task', true);
          const messages = await requestOpenCodeJson(
            attachedServer,
            `/session/${encodeURIComponent(task.opencodeSessionId)}/message${openCodeQuery}&limit=20`,
            { timeoutMs: 3000 },
          ).catch(() => []);
          task.usage = extractOpenCodeUsage(messages);
          const latestContext = extractLatestOpenCodeContext(messages);
          task.contextUsage = latestContext.usage;
          // 上下文档位优先用模型库里的真实 context window（此前只能回退到手填容量）
          const modelLimit = lookupAgentModelContextLimit(latestContext.modelId);
          if (modelLimit > 0) task.contextLimit = modelLimit;
          task.outputText = getLatestOpenCodeAssistantOutput(messages, task.opencodeSessionId, previousOpenCodeMessageIds)
            || task.liveOutputText;
          result = { code: 0, stdout: task.outputText, stderr: '', timedOut: false };
        } catch (error) {
          const timedOut = !task.cancelRequested && (error?.name === 'TimeoutError' || /timeout|timed out|超时/i.test(String(error?.message || '')));
          if ((timedOut || task.cancelRequested) && task.opencodeSessionId) {
            await requestOpenCodeJson(
              attachedServer,
              `/session/${encodeURIComponent(task.opencodeSessionId)}/abort${openCodeQuery}`,
              { method: 'POST', timeoutMs: 3000 },
            ).catch(() => false);
          }
          result = {
            code: -1,
            error,
            stdout: task.outputText || task.liveOutputText,
            stderr: timedOut ? 'OpenCode 会话执行超时' : normalizeSingleLine(error?.message || String(error), 1000),
            timedOut,
          };
          task.stderrText = appendLimited(task.stderrText, result.stderr);
        } finally {
          delete task.openCodeRequestAbort;
        }
      } else {
        result = await runCapturedProcess(commandSpec.command, commandSpec.args, {
          cwd: task.workspacePath,
          timeoutMs: task.timeoutMs,
          outputLimit: AGENT_OUTPUT_LIMIT,
          env: processEnv,
          onSpawn: child => {
            task.child = child;
          },
          onStdout: chunk => {
            task.outputText = appendLimited(task.outputText, chunk);
            task.updatedAt = new Date().toISOString();
            emitTaskDelta(task, { outputText: task.outputText });
          },
          onStderr: chunk => {
            task.stderrText = appendLimited(task.stderrText, chunk);
            task.updatedAt = new Date().toISOString();
          },
        });
      }
    } finally {
      if (permissionPollTimer) clearInterval(permissionPollTimer);
      task.pendingPermissions = [];
      task.pendingQuestions = [];
      task.currentAttachments = [];
      task.openCodeEventStream?.controller?.abort?.();
      delete task.openCodeEventStream;
      delete task.openCodeServer;
      if (attachedRuntime) {
        attachedRuntime.activeTaskIds.delete(task.id);
        attachedRuntime.lastUsedAt = Date.now();
        scheduleWorkspaceRuntimeCleanup(attachedRuntime);
      } else {
        await stopAttachedOpenCodeServer(attachedServer);
      }
    }
    delete task.child;
    task.exitCode = result.code;
    task.timedOut = result.timedOut === true;
    const finalOutput = task.outputText || result.stdout || task.liveOutputText;
    task.liveOutputText = '';
    const detectedSessionId = extractOpenCodeSessionId(finalOutput);
    if (detectedSessionId) task.opencodeSessionId = detectedSessionId;
    const outputError = extractAgentJsonError(finalOutput);
     task.stage = 'verify';
     for (const followUp of task.followUps) {
       const message = findTaskMessage(task, followUp.messageId);
       if (message) {
         message.status = task.cancelRequested ? 'canceled' : 'error';
         message.error = task.cancelRequested ? '任务已取消，跟进消息未送达' : (followUp.error || '跟进消息未送达');
       }
     }
     task.followUps = [];
    const changeAudit = await readGitChangeAudit(task.workspacePath);
    task.workspaceChanged = beforeGitStatus !== null && changeAudit.available && beforeGitStatus !== changeAudit.status;
    task.changedFiles = changeAudit.changedFiles;
    task.diffStat = changeAudit.diffStat;
    task.diffText = changeAudit.diffText;
    task.finishedAt = new Date().toISOString();
    task.updatedAt = task.finishedAt;

    const parsedTurn = parseOpenCodeTurn(finalOutput);
    const parsedSteps = parseOpenCodeTurnSteps(finalOutput);
    const hasStepContent = parsedSteps.some(step => step.content);
    const lastUserMessage = [...(Array.isArray(task.messages) ? task.messages : [])]
      .reverse()
      .find(message => message?.role === 'user');
    const turnHadAttachments = (lastUserMessage?.attachments || []).length > 0;

    // 可复用的“自动重试一轮”逻辑：把失败轮记为一条消息，恢复附件并重新排队
    const scheduleTurnAutoRetry = (eventMessage) => {
      task.retryCount = Math.max(0, Number(task.retryCount || 0)) + 1;
      task.messages.push({
        id: `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        role: 'assistant',
        openCodeMessageId: parsedTurn.messageId,
        content: '',
        reasoning: parsedTurn.reasoning,
        tools: parsedTurn.tools,
        createdAt: task.startedAt || task.queuedAt || new Date().toISOString(),
        finishedAt: task.finishedAt,
        elapsedMs: getTaskElapsedMs(task),
        mode: task.mode,
        status: 'error',
        error: eventMessage,
        stderrText: task.stderrText,
        changedFiles: [],
        diffStat: '',
        diffText: '',
        usage: task.usage,
      });
      trimTaskMessages(task);
      resetTaskTurnState(task);
      task.currentAttachments = (Array.isArray(task.promptAttachments) ? task.promptAttachments : []).slice(0, AGENT_ATTACHMENT_LIMIT);
      task.status = 'pending';
      task.stage = 'pending';
      task.error = '';
      task.queuedAt = new Date().toISOString();
      task.startedAt = '';
      task.finishedAt = '';
      task.updatedAt = task.queuedAt;
      addTaskEvent(task, 'warn', eventMessage);
      persistTasks();
      emitTaskUpdate(task, 'task', true);
      recordWebConsoleOperation({
        action: 'agent_workbench_task',
        method: 'TASK',
        path: 'agent-workbench:task',
        result: 'error',
        statusCode: 500,
        durationMs: getTaskElapsedMs(task),
        details: {
          taskId: task.id,
          providerId: task.providerId,
          workspaceId: task.workspaceId,
          mode: task.mode,
          model: task.model,
          status: 'auto_retry',
          autoRetried: true,
        },
      });
      scheduleTaskDispatch();
    };

    if (task.cancelRequested) {
      task.canceled = true;
      task.status = 'canceled';
      task.stage = 'canceled';
      task.error = '任务已取消';
      addTaskEvent(task, 'warn', '任务已取消');
    } else if (task.timedOut) {
      task.status = 'error';
      task.stage = 'timeout';
      task.error = `Agent 执行超时：本轮运行 ${Math.max(1, Math.round(getTaskElapsedMs(task) / 60000))} 分钟未完成，已中止`;
      addTaskEvent(task, 'error', task.error);
    } else if (result.code !== 0 || outputError) {
      task.status = 'error';
      task.stage = 'error';
      task.error = outputError || normalizeSingleLine(task.stderrText || result.error?.message || `Agent 退出码 ${result.code}`, 1000);
      addTaskEvent(task, 'error', task.error);
    } else if (!isWriteMode(task.mode) && task.workspaceChanged) {
      task.status = 'error';
      task.stage = 'write_violation';
      task.error = '只读任务意外改变了 Git 工作区，请立即人工检查';
      addTaskEvent(task, 'error', task.error);
    } else if (!hasStepContent) {
      // OpenCode 退出码为 0 不代表模型真的回复了：空响应要标成 LLM 故障而不是成功
      const canAutoRetry = !isWriteMode(task.mode)
        && parsedSteps.every(step => step.tools.length === 0)
        && !task.workspaceChanged
        && !turnHadAttachments
        && Number(task.retryCount || 0) < 1;
      if (canAutoRetry) {
        // 只读 + 无工具调用 + 无文件改动 + 无附件：重跑没有任何副作用，自动重试一次自愈瞬时故障
        scheduleTurnAutoRetry(`模型返回了空响应（LLM 故障），已自动重试（第 ${Number(task.retryCount || 0) + 1} 次）`);
        return;
      }
      task.status = 'error';
      task.stage = 'llm_empty';
      task.error = turnHadAttachments
        ? '模型返回了空响应（LLM 故障）：整轮未生成任何文本回复，当前模型可能不支持图片等附件输入，请更换支持视觉的模型后重试'
        : '模型返回了空响应（LLM 故障）：整轮未生成任何文本回复，请检查模型/服务商状态后重试';
      addTaskEvent(task, 'error', task.error);
    } else if (turnHadAttachments
      && !isWriteMode(task.mode)
      && !task.workspaceChanged
      && Number(task.retryCount || 0) < 1
      && /((没有|未能|无法|不能)(看到|查看|识别|读取|接收|获得)[^。\n]{0,16}(图片|图像|照片))|(看不到[^。\n]{0,10}(图片|图像|照片))|(cannot (see|view|read|access)[^.\n]{0,24}(image|photo))|(does not support image)/i.test(parsedSteps.map(step => step.content).join('\n'))) {
      // 免费中转偶发把图片请求路由到不支持视觉的上游：模型报告看不到附件图时自动重试一次
      scheduleTurnAutoRetry(`模型未收到附件图片（可能中转丢图），已自动重试（第 ${Number(task.retryCount || 0) + 1} 次）`);
      return;
    } else {
      task.status = 'success';
      task.stage = 'complete';
      if (isWriteMode(task.mode)) {
        addTaskEvent(task, task.changedFiles.length ? 'success' : 'warn', task.changedFiles.length
          ? `代码修改任务完成，共变更 ${task.changedFiles.length} 个文件`
          : '代码修改任务完成，但没有产生文件改动');
      } else {
        addTaskEvent(task, 'success', '只读 Agent 任务完成');
      }
    }

    if (parsedSteps.length) {
      // 每个助手步骤独立成一条消息（ZCode 式分步展示），聚合信息挂在最后一步
      parsedSteps.forEach((step, index) => {
        const isLast = index === parsedSteps.length - 1;
        task.messages.push({
          id: `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${index}`,
          role: 'assistant',
          openCodeMessageId: step.messageId || parsedTurn.messageId,
          content: step.content,
          reasoning: step.reasoning,
          tools: step.tools,
          createdAt: task.startedAt || task.createdAt || new Date().toISOString(),
          finishedAt: task.finishedAt,
          elapsedMs: isLast ? getTaskElapsedMs(task) : 0,
          mode: task.mode,
          status: isLast ? task.status : 'success',
          error: isLast ? task.error : '',
          stderrText: isLast ? task.stderrText : '',
          changedFiles: isLast ? task.changedFiles : [],
          diffStat: isLast ? task.diffStat : '',
          diffText: '',
          usage: isLast ? task.usage : { input: 0, output: 0, total: 0 },
        });
      });
    } else {
      task.messages.push({
        id: `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        role: 'assistant',
        openCodeMessageId: parsedTurn.messageId,
        content: parsedTurn.content,
        reasoning: parsedTurn.reasoning,
        tools: parsedTurn.tools,
        createdAt: task.startedAt,
        finishedAt: task.finishedAt,
        elapsedMs: getTaskElapsedMs(task),
        mode: task.mode,
        status: task.status,
        error: task.error,
        stderrText: task.stderrText,
        changedFiles: task.changedFiles,
        diffStat: task.diffStat,
        diffText: '',
        usage: task.usage,
      });
    }
    trimTaskMessages(task);
    persistTasks();
    emitTaskUpdate(task, 'task', true);

    recordWebConsoleOperation({
      action: 'agent_workbench_task',
      method: 'TASK',
      path: 'agent-workbench:task',
      result: task.status === 'success' ? 'success' : 'error',
      statusCode: task.status === 'success' ? 200 : 500,
      durationMs: getTaskElapsedMs(task),
      details: {
        taskId: task.id,
        providerId: task.providerId,
        workspaceId: task.workspaceId,
        mode: task.mode,
        model: task.model,
        status: task.status,
        timedOut: task.timedOut,
        canceled: task.canceled,
        workspaceChanged: task.workspaceChanged,
      },
    });
    pruneTasks();
  }

  async function createTask(payload = {}) {
    const config = getConfig();
    if (!config.enabled) {
      throw createHttpError(403, 'Agent 工作台当前未启用', 'AGENT_WORKBENCH_DISABLED');
    }
    const requestedTaskId = normalizeSingleLine(payload.sessionId || '', 120);
    const existingTask = requestedTaskId ? tasks.get(requestedTaskId) : null;
    if (requestedTaskId && !existingTask) {
      throw createHttpError(404, '未找到需要继续的 Agent 会话，请新建会话后重试', 'AGENT_TASK_NOT_FOUND');
    }
    if (existingTask && (existingTask.status === 'pending' || existingTask.status === 'running')) {
      if (existingTask.providerId !== 'opencode') {
        throw createHttpError(409, '当前 Agent 提供方不支持运行中跟进', 'AGENT_FOLLOW_UP_UNSUPPORTED');
      }
      if (payload.providerId && normalizeProviderId(payload.providerId) !== existingTask.providerId) {
        throw createHttpError(409, '跟进消息必须使用当前会话的 Agent 提供方', 'AGENT_FOLLOW_UP_PROVIDER_MISMATCH');
      }
      if (payload.workspaceId && payload.workspaceId !== existingTask.workspaceId) {
        throw createHttpError(409, '跟进消息必须使用当前会话的工作目录', 'AGENT_SESSION_WORKSPACE_MISMATCH');
      }
      return await enqueueTaskFollowUp(existingTask, payload);
    }
    const providerId = existingTask?.providerId || normalizeProviderId(payload.providerId || config.defaultProvider);
    if (config.providers[providerId] === false) {
      throw createHttpError(403, '所选 Agent 提供方已停用', 'AGENT_PROVIDER_DISABLED');
    }
    const provider = await probeProvider(providerId, false);
    if (!provider.available) {
      throw createHttpError(409, `${provider.label} 当前不可用：${provider.error || 'CLI 启动失败'}`, 'AGENT_PROVIDER_UNAVAILABLE');
    }
    const workspace = resolveAgentWorkspace(existingTask?.workspaceId || payload.workspaceId, workspaceOptions);
    if (existingTask && payload.workspaceId && payload.workspaceId !== existingTask.workspaceId) {
      throw createHttpError(409, '同一 Agent 会话不能切换工作目录，请新建会话', 'AGENT_SESSION_WORKSPACE_MISMATCH');
    }
    const prompt = normalizePrompt(payload.prompt);
    if (prompt.length < 2) {
      throw createHttpError(400, '请输入需要 Agent 分析的任务', 'AGENT_PROMPT_REQUIRED');
    }
    const attachments = normalizeTaskAttachments(payload.attachments);
    const mode = normalizeMode(payload.mode);
    if (isWriteMode(mode)) {
      if (!config.writeEnabled) {
        throw createHttpError(403, 'Agent 实际修改功能尚未启用', 'AGENT_WRITE_DISABLED');
      }
      if (providerId !== 'opencode') {
        throw createHttpError(400, '实际修改模式当前只支持内置 OpenCode', 'AGENT_WRITE_PROVIDER_UNSUPPORTED');
      }
      if (!resolveBundledOpenCodeCommand({ rootPath: Path.root })) {
        throw createHttpError(409, '实际修改模式要求插件内置 OpenCode 可用', 'AGENT_WRITE_BUNDLED_REQUIRED');
      }
      if (existingTask?.writeConfirmed !== true && payload.writeConfirmed !== true) {
        throw createHttpError(428, '实际修改任务需要单独确认写入风险', 'AGENT_WRITE_CONFIRMATION_REQUIRED');
      }
      if (config.writableWorkspaces[workspace.id] !== true) {
        throw createHttpError(403, '所选工作目录没有获得 Agent 写入授权', 'AGENT_WRITE_WORKSPACE_DENIED');
      }
    }
    const model = payload.model === undefined ? (existingTask?.model || '') : normalizeModel(payload.model);
    const modelProviderId = payload.modelProviderId === undefined
      ? (existingTask?.modelProviderId || '')
      : normalizeModelProviderId(payload.modelProviderId);
    const variant = payload.variant === undefined
      ? (existingTask?.variant || '')
      : normalizeModelVariant(payload.variant);
    const customApi = existingTask?.customApi || normalizeCustomAgentApi(config.customApi);
    if (providerId === 'opencode' && attachments.some(item => /^image\//i.test(item.mime))) {
      // 与 bundledOpenCodeRuntime 的模型回退链保持一致：任务指定 > 自定义 API > AI 主对话模型
      const effectiveModel = model
        || (customApi.enabled === true ? customApi.model : '')
        || normalizeModel(ConfigControl?.get?.('ai')?.modelType || ConfigControl?.get?.('ai')?.workingModel || '');
      assertAgentImageSupport(effectiveModel);
    }
    const agent = isFullAccessMode(mode)
      ? 'build'
      : normalizeOpenCodeAgent(payload.agent, existingTask?.agent || (isWriteMode(mode) ? 'build' : 'plan'));
    const fullAccess = isFullAccessMode(mode);
    const allowNetwork = fullAccess
      ? true
      : (existingTask ? existingTask.allowNetwork === true : config.allowNetwork === true);
    const allowAllDirectories = fullAccess
      ? true
      : (existingTask
        ? existingTask.allowAllDirectories === true
        : config.allowAllDirectories === true);
    const allowTerminal = fullAccess
      ? true
      : (existingTask
        ? existingTask.allowTerminal === true
        : (isWriteMode(mode) && config.allowTerminal === true));
    const title = existingTask?.title || normalizeSingleLine(payload.title || prompt, 80) || 'Agent 任务';
    let worktree = existingTask?.worktree || null;
    let workspacePath = workspace.path;
    if (existingTask) {
      workspacePath = await resolveTaskWorkspacePath(existingTask);
    } else if (payload.useWorktree === true) {
      if (payload.worktreeConfirmed !== true) {
        throw createHttpError(428, '创建隔离 Worktree 需要确认', 'AGENT_WORKTREE_CONFIRMATION_REQUIRED');
      }
      worktree = await createWorkspaceWorktree(workspace.id, normalizeSingleLine(payload.worktreeName || title, 120));
      workspacePath = worktree.directory;
    }
    const task = existingTask || {
      id: `agent-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      opencodeSessionId: '',
      title,
      providerId,
      providerLabel: provider.label,
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      workspacePath,
      worktree,
      agent,
      mode,
      model,
      modelProviderId,
      variant,
      customApi,
      allowNetwork,
      allowAllDirectories,
      allowTerminal,
      pendingPermissions: [],
      pendingQuestions: [],
      currentAttachments: [],
      promptAttachments: [],
      prompt: '',
      promptPreview: '',
      turnCount: 0,
      messages: [],
      followUps: [],
      followUpDelivery: 'queue',
      followUpRevision: 0,
      followUpClosing: false,
      openCodePromptAdmitted: false,
      writeConfirmed: false,
      timeoutMs: clampInteger(payload.timeoutMs, config.timeoutMs, 60000, config.timeoutMs),
      status: 'pending',
      stage: 'pending',
      queuedAt: new Date().toISOString(),
      queuePosition: 0,
      resumeCount: 0,
      priority: normalizeAgentPriority(payload.priority),
      retryCount: 0,
      createdAt: new Date().toISOString(),
      startedAt: '',
      finishedAt: '',
      updatedAt: new Date().toISOString(),
      outputText: '',
      stderrText: '',
      error: '',
      events: [],
      command: [],
      cancelRequested: false,
      canceled: false,
      timedOut: false,
      workspaceChanged: false,
      gitCheckAvailable: false,
      gitCleanBefore: false,
      changedFiles: [],
      diffStat: '',
      diffText: '',
      archived: false,
      usage: { input: 0, output: 0, total: 0 },
      contextUsage: 0,
      contextLimit: 0,
      lastCompactedAt: '',
    };
    task.providerId = providerId;
    task.providerLabel = provider.label;
    task.workspacePath = workspacePath;
    task.worktree = worktree;
    task.agent = agent;
    task.mode = mode;
    task.model = model;
    task.modelProviderId = modelProviderId;
    task.variant = variant;
    task.customApi = customApi;
    task.allowNetwork = allowNetwork;
    task.allowAllDirectories = allowAllDirectories;
    task.allowTerminal = allowTerminal;
    task.prompt = prompt;
    task.currentPrompt = prompt;
    task.promptPreview = normalizeSingleLine(prompt, 180);
    task.currentAttachments = attachments;
    task.promptAttachments = attachments;
    task.archived = false;
    task.timeoutMs = clampInteger(payload.timeoutMs, config.timeoutMs, 60000, config.timeoutMs);
    task.status = 'pending';
    task.stage = 'pending';
    task.followUps = [];
    task.followUpClosing = false;
    task.openCodePromptAdmitted = false;
    task.queuedAt = new Date().toISOString();
    task.queuePosition = 0;
    task.priority = normalizeAgentPriority(payload.priority === undefined ? task.priority : payload.priority);
    task.startedAt = '';
    task.finishedAt = '';
    task.updatedAt = new Date().toISOString();
    task.turnCount = Math.max(0, Number(task.turnCount || 0)) + 1;
    resetTaskTurnState(task);
    if (isWriteMode(mode) && payload.writeConfirmed === true) task.writeConfirmed = true;
    task.messages = Array.isArray(task.messages) ? task.messages : [];
    task.messages.push({
      id: `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      role: 'user',
      content: prompt,
      createdAt: task.updatedAt,
      mode,
      status: 'sent',
      attachments: attachments.map(item => ({ name: item.name, mime: item.mime, size: item.size })),
    });
    trimTaskMessages(task);
    tasks.set(task.id, task);
    addTaskEvent(task, 'info', existingTask
      ? `已发送第 ${task.turnCount} 轮消息`
      : (worktree ? `会话已进入队列，使用隔离 Worktree：${worktree.name}` : '会话已进入队列'));
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    scheduleTaskDispatch();
    return serializeTask(task, { includeMessages: true });
  }

  function getTask(taskId = '') {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    return serializeTask(task, { includeMessages: true });
  }

  async function getSessionHistory(taskId = '', options = {}) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 会话', 'AGENT_TASK_NOT_FOUND');
    if (!task.opencodeSessionId) {
      throw createHttpError(409, '该记录还没有 OpenCode 会话 ID', 'AGENT_NATIVE_SESSION_UNAVAILABLE');
    }
    const limit = clampInteger(options.limit, AGENT_NATIVE_HISTORY_LIMIT, 20, AGENT_NATIVE_HISTORY_LIMIT);
    const result = await requestTaskOpenCode(
      task,
      `/session/${encodeURIComponent(task.opencodeSessionId)}/message?limit=${limit}`,
      { timeoutMs: 15000 },
    );
    const rawMessages = Array.isArray(result)
      ? result
      : (Array.isArray(result?.messages) ? result.messages : []);
    const messages = normalizeOpenCodeHistoryMessages(rawMessages, task);
    return {
      success: true,
      taskId: task.id,
      messages: messages.map(serializeAgentMessage),
      loadedCount: messages.length,
      hasMore: rawMessages.length >= limit,
    };
  }

  async function cancelTask(taskId = '') {
    const id = String(taskId || '').trim();
    const task = tasks.get(id);
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    if (task.status !== 'pending' && task.status !== 'running') {
      return { canceled: false, task: serializeTask(task, { includeMessages: true }) };
    }
    task.followUpClosing = true;
    for (const followUp of Array.isArray(task.followUps) ? task.followUps : []) {
      const message = findTaskMessage(task, followUp.messageId);
      if (message) {
        message.status = 'canceled';
        message.error = '任务已取消，跟进消息未送达';
      }
    }
    task.followUps = [];
    if (task.status === 'pending') {
      task.cancelRequested = true;
      task.canceled = true;
      task.status = 'canceled';
      task.stage = 'canceled';
      task.error = '排队任务已取消';
      task.currentAttachments = [];
      task.finishedAt = new Date().toISOString();
      task.updatedAt = task.finishedAt;
      addTaskEvent(task, 'warn', task.error);
      persistTasks();
      emitTaskUpdate(task, 'task', true);
      scheduleTaskDispatch();
      return { canceled: true, task: serializeTask(task, { includeMessages: true }) };
    }
    task.cancelRequested = true;
    task.updatedAt = new Date().toISOString();
    addTaskEvent(task, 'warn', '正在取消任务');
    if (task.child && !task.child.killed) task.child.kill('SIGTERM');
    if (task.openCodeServer && task.opencodeSessionId) {
      const query = `?directory=${encodeURIComponent(task.workspacePath)}`;
      await requestOpenCodeJson(
        task.openCodeServer,
        `/session/${encodeURIComponent(task.opencodeSessionId)}/abort${query}`,
        { method: 'POST', timeoutMs: 3000 },
      ).catch(error => {
        logger.warn?.(`[agent-workbench] 中止 OpenCode 会话失败: ${error.message}`);
      });
    }
    task.openCodeRequestAbort?.abort?.();
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    return { canceled: true, task: serializeTask(task, { includeMessages: true }) };
  }

  function resumeTask(taskId = '') {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    if (task.status === 'pending' || task.status === 'running') {
      throw createHttpError(409, '当前 Agent 会话仍在执行', 'AGENT_SESSION_BUSY');
    }
    if (task.status !== 'interrupted' && task.stage !== 'timeout') {
      throw createHttpError(409, '只有中断或超时的 Agent 任务可以恢复', 'AGENT_TASK_NOT_RESUMABLE');
    }
    const prompt = '继续完成上一轮尚未完成的任务。请先检查当前会话上下文和工作区状态，避免重复修改已经完成的内容。';
    task.prompt = prompt;
    task.currentPrompt = prompt;
    task.promptPreview = '恢复中断任务并继续执行';
    task.currentAttachments = [];
    task.status = 'pending';
    task.stage = 'pending';
    task.followUps = [];
    task.followUpClosing = false;
    task.openCodePromptAdmitted = false;
    task.queuedAt = new Date().toISOString();
    task.startedAt = '';
    task.finishedAt = '';
    task.updatedAt = task.queuedAt;
    task.error = '';
    task.cancelRequested = false;
    task.canceled = false;
    task.timedOut = false;
    resetTaskTurnState(task);
    task.resumeCount = Math.max(0, Number(task.resumeCount || 0)) + 1;
    task.turnCount = Math.max(0, Number(task.turnCount || 0)) + 1;
    task.messages.push({
      id: `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      role: 'user',
      content: '继续中断的任务',
      createdAt: task.updatedAt,
      mode: task.mode,
      status: 'sent',
      attachments: [],
    });
    trimTaskMessages(task);
    addTaskEvent(task, 'info', `已恢复中断任务，第 ${task.resumeCount} 次恢复`);
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    scheduleTaskDispatch();
    return { resumed: true, task: serializeTask(task, { includeMessages: true }) };
  }

  function retryTask(taskId = '') {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    if (task.status === 'pending' || task.status === 'running') throw createHttpError(409, '当前 Agent 会话仍在执行', 'AGENT_SESSION_BUSY');
    if (task.status !== 'error' && task.stage !== 'timeout') throw createHttpError(409, '只有失败或超时任务可以重试', 'AGENT_TASK_NOT_RETRYABLE');
    if (Number(task.retryCount || 0) >= 3) throw createHttpError(409, '本任务已达到最多 3 次重试次数', 'AGENT_RETRY_LIMIT_REACHED');
    const prompt = normalizePrompt(task.prompt || '');
    if (prompt.length < 2) throw createHttpError(409, '任务没有可重试的请求内容', 'AGENT_RETRY_PROMPT_MISSING');
    task.status = 'pending';
    task.stage = 'pending';
    task.followUps = [];
    task.followUpClosing = false;
    task.openCodePromptAdmitted = false;
    task.queuedAt = new Date().toISOString();
    task.startedAt = '';
    task.finishedAt = '';
    task.updatedAt = task.queuedAt;
    task.error = '';
    task.cancelRequested = false;
    task.canceled = false;
    task.timedOut = false;
    resetTaskTurnState(task);
    // 重试恢复上一轮提交时的附件（含图片 data URL），否则带图任务重试会变成纯文本假修复
    task.currentAttachments = (Array.isArray(task.promptAttachments) ? task.promptAttachments : []).slice(0, AGENT_ATTACHMENT_LIMIT);
    task.retryCount = Math.max(0, Number(task.retryCount || 0)) + 1;
    task.messages.push({
      id: `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      role: 'user',
      content: `重试上一轮任务（第 ${task.retryCount} 次）`,
      createdAt: task.updatedAt,
      mode: task.mode,
      status: 'sent',
      attachments: (task.currentAttachments || []).map(item => ({
        name: normalizeSingleLine(item.name || '附件', 180),
        mime: normalizeSingleLine(item.mime || 'application/octet-stream', 120),
        size: Math.max(0, Number(item.size || 0)),
      })),
    });
    trimTaskMessages(task);
    addTaskEvent(task, 'info', `已加入重试队列，第 ${task.retryCount} 次重试`);
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    scheduleTaskDispatch();
    return { retried: true, task: serializeTask(task, { includeMessages: true }) };
  }

  async function replyPermission(taskId = '', payload = {}) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    const requestId = normalizeSingleLine(payload.requestId || '', 120);
    if (!/^per[A-Za-z0-9_-]+$/.test(requestId)) {
      throw createHttpError(400, '权限请求 ID 无效', 'AGENT_PERMISSION_ID_INVALID');
    }
    const reply = ['once', 'always', 'reject'].includes(payload.reply) ? payload.reply : '';
    if (!reply) throw createHttpError(400, '权限审批结果无效', 'AGENT_PERMISSION_REPLY_INVALID');
    if (!task.openCodeServer || task.status !== 'running') {
      throw createHttpError(409, '权限请求已失效或任务已经结束', 'AGENT_PERMISSION_EXPIRED');
    }
    if (!(task.pendingPermissions || []).some(item => item.id === requestId)) {
      throw createHttpError(404, '没有找到待处理的权限请求', 'AGENT_PERMISSION_NOT_FOUND');
    }
    const query = `?directory=${encodeURIComponent(task.workspacePath)}`;
    await requestOpenCodeJson(task.openCodeServer, `/permission/${encodeURIComponent(requestId)}/reply${query}`, {
      method: 'POST',
      body: { reply },
      timeoutMs: 5000,
    });
    task.pendingPermissions = task.pendingPermissions.filter(item => item.id !== requestId);
    addTaskEvent(task, reply === 'reject' ? 'warn' : 'success', reply === 'reject' ? '已拒绝终端操作' : '已批准终端操作');
    emitTaskUpdate(task, 'permission', true);
    return serializeTask(task, { includeMessages: true });
  }

  async function replyQuestion(taskId = '', payload = {}) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    const requestId = normalizeSingleLine(payload.requestId || '', 120);
    if (!requestId) throw createHttpError(400, '问题请求 ID 无效', 'AGENT_QUESTION_ID_INVALID');
    if (!task.openCodeServer || task.status !== 'running') {
      throw createHttpError(409, '问题请求已失效或任务已经结束', 'AGENT_QUESTION_EXPIRED');
    }
    if (!(task.pendingQuestions || []).some(item => item.id === requestId)) {
      throw createHttpError(404, '没有找到待处理的问题请求', 'AGENT_QUESTION_NOT_FOUND');
    }
    const answers = Array.isArray(payload.answers)
      ? payload.answers.slice(0, 20).map(answer => Array.isArray(answer) ? answer.slice(0, 20).map(value => normalizeSingleLine(value, 500)) : [normalizeSingleLine(answer, 500)])
      : [];
    if (!answers.length || answers.some(answer => !answer.length || answer.some(value => !value))) {
      throw createHttpError(400, '请先完成问题回答', 'AGENT_QUESTION_ANSWERS_REQUIRED');
    }
    const query = `?directory=${encodeURIComponent(task.workspacePath)}`;
    await requestOpenCodeJson(task.openCodeServer, `/question/${encodeURIComponent(requestId)}/reply${query}`, {
      method: 'POST', body: { answers }, timeoutMs: 5000,
    });
    task.pendingQuestions = task.pendingQuestions.filter(item => item.id !== requestId);
    addTaskEvent(task, 'success', '已提交 OpenCode 问题回答');
    emitTaskUpdate(task, 'question', true);
    return serializeTask(task, { includeMessages: true });
  }

  async function rejectQuestion(taskId = '', payload = {}) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    const requestId = normalizeSingleLine(payload.requestId || '', 120);
    if (!requestId || !(task.pendingQuestions || []).some(item => item.id === requestId)) {
      throw createHttpError(404, '没有找到待处理的问题请求', 'AGENT_QUESTION_NOT_FOUND');
    }
    const query = `?directory=${encodeURIComponent(task.workspacePath)}`;
    await requestOpenCodeJson(task.openCodeServer, `/question/${encodeURIComponent(requestId)}/reject${query}`, {
      method: 'POST', body: {}, timeoutMs: 5000,
    });
    task.pendingQuestions = task.pendingQuestions.filter(item => item.id !== requestId);
    addTaskEvent(task, 'warn', '已拒绝 OpenCode 问题请求');
    emitTaskUpdate(task, 'question', true);
    return serializeTask(task, { includeMessages: true });
  }

  async function readGitWorkspaceState(workspacePath = '') {
    const [statusResult, branchResult, branchListResult] = await Promise.all([
      runCapturedProcess('git', ['status', '--short'], { cwd: workspacePath, timeoutMs: GIT_STATUS_TIMEOUT_MS, outputLimit: AGENT_DIFF_LIMIT }),
      runCapturedProcess('git', ['branch', '--show-current'], { cwd: workspacePath, timeoutMs: GIT_STATUS_TIMEOUT_MS, outputLimit: 4000 }),
      runCapturedProcess('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: workspacePath, timeoutMs: GIT_STATUS_TIMEOUT_MS, outputLimit: 12000 }),
    ]);
    if (statusResult.code !== 0 || branchResult.code !== 0) {
      return { available: false, error: normalizeSingleLine(statusResult.stderr || branchResult.stderr || '当前目录不是 Git 工作区', 500), branch: '', branches: [], files: [] };
    }
    return {
      available: true,
      error: '',
      branch: normalizeSingleLine(branchResult.stdout, 200),
      branches: String(branchListResult.stdout || '').split(/\r?\n/).map(item => normalizeSingleLine(item, 200)).filter(Boolean).slice(0, 200),
      files: parseGitChangedFiles(String(statusResult.stdout || '')).slice(0, 300),
    };
  }

  function assertGitWriteAccess(task) {
    const config = getConfig();
    if (config.writeEnabled !== true || config.writableWorkspaces?.[task.workspaceId] !== true) {
      throw createHttpError(403, '当前工作目录没有获得 Agent Git 写入授权', 'AGENT_GIT_WRITE_DENIED');
    }
  }

  async function getTaskGitState(taskId = '') {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 会话', 'AGENT_TASK_NOT_FOUND');
    const workspacePath = await resolveTaskWorkspacePath(task);
    return { success: true, git: await readGitWorkspaceState(workspacePath) };
  }

  async function manageTaskGit(taskId = '', action = '', payload = {}) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 会话', 'AGENT_TASK_NOT_FOUND');
    if (task.status === 'running' || task.status === 'pending') throw createHttpError(409, '会话正在执行，暂时不能操作 Git', 'AGENT_SESSION_BUSY');
    assertGitWriteAccess(task);
    const workspacePath = await resolveTaskWorkspacePath(task);
    const files = normalizeGitFileList(payload.files);
    if (['stage', 'unstage'].includes(action) && !files.length) throw createHttpError(400, '请选择至少一个文件', 'AGENT_GIT_FILES_REQUIRED');
    if (action === 'stage') {
      const result = await runCapturedProcess('git', ['add', '--', ...files], { cwd: workspacePath, timeoutMs: GIT_STATUS_TIMEOUT_MS, outputLimit: 20000 });
      if (result.code !== 0) throw createHttpError(500, normalizeSingleLine(result.stderr || '暂存文件失败', 1000), 'AGENT_GIT_STAGE_FAILED');
    } else if (action === 'unstage') {
      const result = await runCapturedProcess('git', ['restore', '--staged', '--', ...files], { cwd: workspacePath, timeoutMs: GIT_STATUS_TIMEOUT_MS, outputLimit: 20000 });
      if (result.code !== 0) throw createHttpError(500, normalizeSingleLine(result.stderr || '取消暂存失败', 1000), 'AGENT_GIT_UNSTAGE_FAILED');
    } else if (action === 'commit') {
      if (payload.confirmed !== true) throw createHttpError(428, '提交 Git 需要确认', 'AGENT_GIT_COMMIT_CONFIRMATION_REQUIRED');
      const message = normalizeSingleLine(payload.message || '', 200);
      if (message.length < 2) throw createHttpError(400, '请输入提交说明', 'AGENT_GIT_COMMIT_MESSAGE_REQUIRED');
      const result = await runCapturedProcess('git', ['commit', '-m', message], { cwd: workspacePath, timeoutMs: 30000, outputLimit: 30000 });
      if (result.code !== 0) throw createHttpError(500, normalizeSingleLine(result.stderr || result.stdout || 'Git 提交失败', 1200), 'AGENT_GIT_COMMIT_FAILED');
      addTaskEvent(task, 'success', `Git 提交完成：${message}`);
    } else if (action === 'branch') {
      if (payload.confirmed !== true) throw createHttpError(428, '切换或创建分支需要确认', 'AGENT_GIT_BRANCH_CONFIRMATION_REQUIRED');
      const branch = normalizeSingleLine(payload.branch || '', 200);
      if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw createHttpError(400, '分支名称无效', 'AGENT_GIT_BRANCH_INVALID');
      const operation = payload.operation === 'create' ? 'create' : 'checkout';
      const args = operation === 'create' ? ['switch', '-c', branch] : ['switch', branch];
      const result = await runCapturedProcess('git', args, { cwd: workspacePath, timeoutMs: 30000, outputLimit: 30000 });
      if (result.code !== 0) throw createHttpError(500, normalizeSingleLine(result.stderr || result.stdout || 'Git 分支操作失败', 1200), 'AGENT_GIT_BRANCH_FAILED');
      addTaskEvent(task, 'success', `${operation === 'create' ? '创建并切换' : '切换'}分支：${branch}`);
    } else {
      throw createHttpError(400, '不支持的 Git 操作', 'AGENT_GIT_ACTION_INVALID');
    }
    const audit = await readGitChangeAudit(workspacePath);
    task.workspaceChanged = audit.available && audit.changedFiles.length > 0;
    task.changedFiles = audit.changedFiles;
    task.diffStat = audit.diffStat;
    task.diffText = audit.diffText;
    task.updatedAt = new Date().toISOString();
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    return { success: true, git: await readGitWorkspaceState(workspacePath), task: serializeTask(task, { includeMessages: true }) };
  }

  async function buildNativePayload(workspaceId = '', taskId = '') {
    const selectedTask = tasks.get(String(taskId || '').trim()) || null;
    const workspace = resolveAgentWorkspace(selectedTask?.workspaceId || workspaceId, workspaceOptions);
    const query = pathName => (selectedTask
      ? requestTaskOpenCode(selectedTask, pathName, { timeoutMs: 8000 })
      : requestWorkspaceOpenCode(workspace.id, pathName, { timeoutMs: 8000 }))
      .catch(error => ({ __error: error.message }));
    const sessionQuery = suffix => selectedTask?.opencodeSessionId
      ? query(`/session/${encodeURIComponent(selectedTask.opencodeSessionId)}${suffix}`)
      : Promise.resolve([]);
    const worktreeQuery = requestWorkspaceOpenCode(workspace.id, '/experimental/worktree', { timeoutMs: 10000 })
      .catch(error => ({ __error: error.message }));
    const gitQuery = readGitWorkspaceState(selectedTask?.workspacePath || workspace.path).catch(error => ({ available: false, error: error.message, branch: '', branches: [], files: [] }));
    const [providerResult, agentsResult, skillsResult, commandsResult, mcpResult, lspResult, formatterResult, ptyResult, worktreeResult, todoResult, childrenResult, gitResult] = await Promise.all([
      query('/provider'), query('/agent'), query('/skill'), query('/command'), query('/mcp'), query('/lsp'), query('/formatter'), query('/pty'),
      worktreeQuery, sessionQuery('/todo'), sessionQuery('/children'), gitQuery,
    ]);
    const providers = Array.isArray(providerResult?.all) ? providerResult.all.map(provider => ({
      id: normalizeSingleLine(provider.id, 120),
      name: normalizeSingleLine(provider.name || provider.id, 180),
      source: normalizeSingleLine(provider.source || '', 40),
      connected: Array.isArray(providerResult.connected) && providerResult.connected.includes(provider.id),
      models: Object.values(provider.models || {}).slice(0, 300).map(model => ({
        id: normalizeSingleLine(model?.id || '', 180),
        name: normalizeSingleLine(model?.name || model?.id || '', 180),
        providerId: normalizeSingleLine(model?.providerID || provider.id, 120),
        family: normalizeSingleLine(model?.family || '', 120),
        status: normalizeSingleLine(model?.status || '', 40),
        context: Math.max(0, Number(model?.limit?.context || 0)),
        output: Math.max(0, Number(model?.limit?.output || 0)),
        attachment: model?.capabilities?.attachment === true,
        reasoning: model?.capabilities?.reasoning === true,
        toolcall: model?.capabilities?.toolcall === true,
        variants: Object.keys(model?.variants && typeof model.variants === 'object' ? model.variants : {})
          .map(value => normalizeSingleLine(value, 80))
          .filter(Boolean),
      })),
    })) : [];
    const skills = Array.isArray(skillsResult) ? skillsResult.slice(0, 200).map(skill => ({
      name: normalizeSingleLine(skill.name || '', 180),
      description: redactAgentText(skill.description || '').slice(0, 1000),
      location: redactAgentText(skill.location || '').slice(0, 500),
    })) : [];
    const commands = Array.isArray(commandsResult) ? commandsResult.slice(0, 300).map(command => ({
      name: normalizeSingleLine(command.name || '', 180),
      description: redactAgentText(command.description || '').slice(0, 1000),
      source: normalizeSingleLine(command.source || 'command', 40),
      agent: normalizeSingleLine(command.agent || '', 120),
      model: normalizeSingleLine(command.model || '', 180),
      hints: Array.isArray(command.hints) ? command.hints.slice(0, 20).map(value => normalizeSingleLine(value, 300)) : [],
    })) : [];
    const mcp = mcpResult && !mcpResult.__error && typeof mcpResult === 'object'
      ? Object.entries(mcpResult).slice(0, 100).map(([name, status]) => ({
        name: normalizeSingleLine(name, 180),
        status: normalizeSingleLine(status?.status || status?.type || 'unknown', 80),
        error: redactAgentText(status?.error || status?.message || '').slice(0, 1000),
      }))
      : [];
    const agents = Array.isArray(agentsResult) ? agentsResult.slice(0, 100).map(agent => ({
      name: normalizeOpenCodeAgent(agent?.name || ''),
      description: redactAgentText(agent?.description || '').slice(0, 1000),
      mode: normalizeSingleLine(agent?.mode || '', 40),
      native: agent?.native === true,
      hidden: agent?.hidden === true,
      model: agent?.model ? {
        providerId: normalizeSingleLine(agent.model.providerID || '', 120),
        modelId: normalizeSingleLine(agent.model.modelID || '', 180),
      } : null,
    })).filter(agent => agent.name && !agent.hidden) : [];
    const knownWorktrees = new Map(Array.from(tasks.values())
      .filter(task => task.workspaceId === workspace.id && task.worktree?.directory)
      .map(task => [getComparablePath(task.worktree.directory), task.worktree]));
    const worktrees = Array.isArray(worktreeResult) ? worktreeResult.slice(0, 100).map(directory => {
      const resolved = resolveExistingDirectory(directory) || path.resolve(String(directory || ''));
      const known = knownWorktrees.get(getComparablePath(resolved));
      return {
        name: known?.name || path.basename(resolved),
        branch: known?.branch || '',
        directory: resolved,
        activeTaskCount: Array.from(tasks.values()).filter(task => task.worktree?.directory && isSamePath(task.worktree.directory, resolved)).length,
      };
    }) : [];
    const todos = Array.isArray(todoResult) ? todoResult.slice(0, 100).map(item => ({
      content: redactAgentText(item?.content || '').slice(0, 1000),
      status: normalizeSingleLine(item?.status || 'pending', 40),
      priority: normalizeSingleLine(item?.priority || 'medium', 40),
    })) : [];
    const children = Array.isArray(childrenResult) ? childrenResult.slice(0, 100).map(item => ({
      id: normalizeOpenCodeSessionId(item?.id || ''),
      title: normalizeSingleLine(item?.title || '子会话', 180),
      agent: normalizeOpenCodeAgent(item?.agent || ''),
      directory: redactAgentText(item?.directory || '').slice(0, 500),
      updatedAt: Number(item?.time?.updated || 0),
    })) : [];
    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        workspace: {
          id: workspace.id,
          label: workspace.label,
          path: selectedTask?.workspacePath || workspace.path,
          basePath: workspace.path,
          isolated: Boolean(selectedTask?.worktree),
        },
        selectedTaskId: selectedTask?.id || '',
        providers,
        defaults: providerResult?.default || {},
        agents,
        skills,
        commands,
        mcp,
        worktrees,
        todos,
        children,
        git: gitResult,
        lsp: Array.isArray(lspResult) ? lspResult.slice(0, 100) : [],
        formatters: Array.isArray(formatterResult) ? formatterResult.slice(0, 100) : [],
        terminals: listTerminals(workspace.id),
        nativePtys: Array.isArray(ptyResult) ? ptyResult.slice(0, AGENT_TERMINAL_LIMIT) : [],
        errors: [providerResult, agentsResult, skillsResult, commandsResult, mcpResult, lspResult, formatterResult, ptyResult, worktreeResult, todoResult, childrenResult, gitResult]
          .filter(item => item?.__error).map(item => item.__error),
      },
    };
  }

  async function resolveSessionSummaryModel(task, payload = {}) {
    const requestedModel = normalizeSingleLine(payload.modelId || '', 180);
    const requestedProvider = normalizeSingleLine(payload.providerId || '', 120);
    if (requestedModel) {
      return buildOpenCodeModelSelection(requestedModel, requestedProvider);
    }
    const taskSelection = buildOpenCodeModelSelection(task.model, task.modelProviderId);
    if (taskSelection) return taskSelection;
    const messageResult = await requestTaskOpenCode(
      task,
      `/session/${encodeURIComponent(task.opencodeSessionId)}/message?limit=20`,
      { timeoutMs: 10000 },
    ).catch(() => []);
    const messages = Array.isArray(messageResult) ? messageResult : (Array.isArray(messageResult?.messages) ? messageResult.messages : []);
    for (const message of [...messages].reverse()) {
      const info = message?.info || message || {};
      const model = info.model || {};
      const providerId = normalizeSingleLine(info.providerID || info.providerId || model.providerID || model.providerId || '', 120);
      const modelId = normalizeSingleLine(info.modelID || info.modelId || model.modelID || model.modelId || model.id || '', 180);
      if (providerId && modelId) return buildOpenCodeModelSelection(modelId, providerId);
    }
    const config = getConfig();
    const configuredSelection = buildAgentDefaultModelSelection({
      customApi: task.customApi?.enabled === true ? task.customApi : config.customApi,
      aiConfig: ConfigControl?.get?.('ai') || {},
    });
    if (configuredSelection) return configuredSelection;
    const providerResult = await requestTaskOpenCode(task, '/provider', { timeoutMs: 10000 }).catch(() => null);
    const providers = Array.isArray(providerResult?.all) ? providerResult.all : [];
    const connected = new Set(Array.isArray(providerResult?.connected) ? providerResult.connected : []);
    const orderedProviders = [...providers].sort((left, right) => Number(connected.has(right?.id)) - Number(connected.has(left?.id)));
    for (const provider of orderedProviders) {
      const model = Object.values(provider?.models || {}).find(item => item?.id);
      if (provider?.id && model?.id) return buildOpenCodeModelSelection(model.id, provider.id);
    }
    return null;
  }

  async function readSessionContextState(task) {
    const config = getConfig();
    if (!task?.opencodeSessionId) {
      const reportedLimit = Math.max(0, Number(task?.contextLimit || 0));
      const manualLimit = Math.max(0, Number(config.manualContextLimit || 0));
      return { usage: 0, limit: reportedLimit || manualLimit, manual: !reportedLimit && manualLimit > 0 };
    }
    const messageResult = await requestTaskOpenCode(
      task,
      `/session/${encodeURIComponent(task.opencodeSessionId)}/message?limit=20`,
      { timeoutMs: 10000 },
    );
    const messages = Array.isArray(messageResult)
      ? messageResult
      : (Array.isArray(messageResult?.messages) ? messageResult.messages : []);
    const latest = extractLatestOpenCodeContext(messages);
    let limit = Math.max(0, Number(task.contextLimit || 0));
    const providerId = latest.modelProviderId || task.modelProviderId;
    const modelId = latest.modelId || task.model;
    if (!limit && providerId && modelId) {
      const providerResult = await requestTaskOpenCode(task, '/provider', { timeoutMs: 10000 }).catch(() => null);
      const provider = Array.isArray(providerResult?.all)
        ? providerResult.all.find(item => String(item?.id || '') === providerId)
        : null;
      const model = provider?.models && typeof provider.models === 'object'
        ? Object.values(provider.models).find(item => String(item?.id || '') === modelId)
          || provider.models[modelId]
        : null;
      limit = Math.max(0, Number(model?.limit?.context || 0));
    }
    let manual = false;
    if (!limit && config.manualContextLimit > 0) {
      limit = config.manualContextLimit;
      manual = true;
    }
    return { usage: latest.usage, limit, manual };
  }

  // OpenCode 的 /summarize 是异步的：接口立即返回，压缩轮在后台执行。
  // 这里 POST 后等待压缩消息真正落库，再回读上下文用量，避免 UI 一直显示旧容量。
  async function runSessionSummarize(task, request, { startedUsage = null, timeoutMs = 180000, modelSelection = null } = {}) {
    const beforeUsage = startedUsage ?? Number(task.contextUsage?.total ?? task.contextUsage ?? 0);
    const sessionPath = `/session/${encodeURIComponent(task.opencodeSessionId)}`;
    const beforeMessages = await request(`${sessionPath}/message?limit=200`, { timeoutMs: 10000 })
      .then(value => (Array.isArray(value) ? value : (value?.messages || [])))
      .catch(() => []);
    const beforeIds = new Set(beforeMessages.map(message => (message?.info || message || {}).id).filter(Boolean));
    await request(`${sessionPath}/summarize`, {
      method: 'POST',
      body: modelSelection
        ? { providerID: modelSelection.providerID, modelID: modelSelection.modelID, auto: false }
        : { auto: true },
      timeoutMs: 15000,
    });
    const startedAt = Date.now();
    let compacted = false;
    while (Date.now() - startedAt < timeoutMs) {
      await waitForAbortableDelay(2000);
      const messages = await request(`${sessionPath}/message?limit=200`, { timeoutMs: 10000 })
        .then(value => (Array.isArray(value) ? value : (value?.messages || [])))
        .catch(() => []);
      const compactedNow = messages.some(message => {
        const info = message?.info || message || {};
        return (info.summary === true || String(info.mode || info.agent || '') === 'compaction')
          && !beforeIds.has(info.id);
      });
      const statuses = await request('/session/status', { timeoutMs: 10000 }).catch(() => null);
      const statusType = String(statuses?.[task.opencodeSessionId]?.type || '').toLowerCase();
      if (compactedNow && statusType !== 'busy' && statusType !== 'retry') {
        compacted = true;
        break;
      }
      if (!compactedNow && statusType === 'idle' && Date.now() - startedAt > 10000 && beforeMessages.length) {
        // 状态已空闲但没有新增压缩消息：可能上游不支持该标记，视为完成以兼容旧版本
        compacted = true;
        break;
      }
    }
    if (!compacted) throw new Error('压缩超时：OpenCode 未在限定时间内完成上下文压缩');
    const after = await readSessionContextState(task).catch(() => ({ usage: beforeUsage, limit: task.contextLimit, manual: false }));
    task.contextUsage = after.usage;
    if (after.manual !== true) task.contextLimit = after.limit;
    task.lastCompactedAt = new Date().toISOString();
    return { usageBefore: beforeUsage, usageAfter: task.contextUsage };
  }

  async function maybeAutoCompactSession(task, server, openCodeQuery) {
    const config = getConfig();
    if (!config.autoCompactEnabled || !task?.opencodeSessionId || !server) return;
    try {
      const state = await readSessionContextState(task);
      task.contextUsage = state.usage;
      if (state.manual !== true) task.contextLimit = state.limit;
      emitTaskUpdate(task);
      if (!state.limit || state.usage < (state.limit * config.autoCompactThreshold) / 100) return;
      addTaskEvent(task, 'info', `上下文已使用 ${state.usage}/${state.limit} Token，开始自动压缩`);
      emitTaskUpdate(task, 'task', true);
      const modelSelection = await resolveSessionSummaryModel(task, {
        modelId: config.compactModel,
        providerId: config.compactProviderId,
      });
      await runSessionSummarize(task, (pathname, options = {}) => requestOpenCodeJson(
        server,
        `${pathname}${pathname.includes('?') ? '&' : '?'}${openCodeQuery.slice(1)}`,
        options,
      ), { startedUsage: state.usage, timeoutMs: task.timeoutMs || 180000, modelSelection });
      addTaskEvent(task, 'success', `上下文压缩完成，当前约 ${Number(task.contextUsage?.total ?? task.contextUsage ?? 0)} Token`);
      persistTasks();
      emitTaskUpdate(task, 'task', true);
    } catch (error) {
      addTaskEvent(task, 'warn', `自动压缩上下文失败，将继续本轮任务：${error.message}`);
      persistTasks();
      emitTaskUpdate(task, 'task', true);
    }
  }

  async function manageSession(taskId = '', action = '', payload = {}) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 会话', 'AGENT_TASK_NOT_FOUND');
    if (task.status === 'running' || task.status === 'pending') {
      throw createHttpError(409, '会话正在执行，暂时不能管理', 'AGENT_SESSION_BUSY');
    }
    const queryPath = suffix => `/session/${encodeURIComponent(task.opencodeSessionId)}${suffix}`;
    if (action === 'delete-message') {
      if (payload.confirmed !== true) {
        throw createHttpError(428, '删除消息需要确认', 'AGENT_MESSAGE_DELETE_CONFIRMATION_REQUIRED');
      }
      if (!task.opencodeSessionId) {
        throw createHttpError(409, '该记录还没有 OpenCode 会话 ID', 'AGENT_NATIVE_SESSION_UNAVAILABLE');
      }
      const messageId = normalizeOpenCodeMessageId(payload.messageId);
      if (!messageId) throw createHttpError(400, '缺少需要删除的消息 ID', 'AGENT_MESSAGE_DELETE_ID_REQUIRED');
      await requestTaskOpenCode(
        task,
        `${queryPath(`/message/${encodeURIComponent(messageId)}`)}`,
        { method: 'DELETE', timeoutMs: 10000 },
      );
      task.messages = (Array.isArray(task.messages) ? task.messages : [])
        .filter(message => normalizeOpenCodeMessageId(message.openCodeMessageId || message.id) !== messageId);
      task.updatedAt = new Date().toISOString();
      addTaskEvent(task, 'success', '已删除所选 OpenCode 消息');
      persistTasks();
      emitTaskUpdate(task, 'task', true);
      return { success: true, messageRemoved: true, messageId, task: serializeTask(task, { includeMessages: true }) };
    }
    if (action === 'rename') {
      const title = normalizeSingleLine(payload.title || '', 80);
      if (!title) throw createHttpError(400, '请输入会话名称', 'AGENT_SESSION_TITLE_REQUIRED');
      if (task.opencodeSessionId) {
        await requestTaskOpenCode(task, queryPath(''), { method: 'PATCH', body: { title }, timeoutMs: 8000 });
      }
      task.title = title;
      task.updatedAt = new Date().toISOString();
      addTaskEvent(task, 'success', '会话名称已更新');
      persistTasks();
      emitTaskUpdate(task, 'task', true);
      return { task: serializeTask(task, { includeMessages: true }) };
    }
    if (action === 'delete') {
      if (payload.confirmed !== true) throw createHttpError(428, '删除会话需要确认', 'AGENT_SESSION_DELETE_CONFIRMATION_REQUIRED');
      if (task.opencodeSessionId) {
        await requestTaskOpenCode(task, queryPath(''), { method: 'DELETE', timeoutMs: 8000 }).catch(error => {
          logger.warn?.(`[agent-workbench] 删除 OpenCode 会话失败，将保留本地记录: ${error.message}`);
          throw error;
        });
      }
      tasks.delete(task.id);
      persistTasks();
      emitWorkbenchUpdate('task_removed', { taskId: task.id });
      return { removed: true, taskId: task.id };
    }
    if (!task.opencodeSessionId) throw createHttpError(409, '该记录还没有 OpenCode 会话 ID', 'AGENT_NATIVE_SESSION_UNAVAILABLE');
    if (action === 'fork') {
      const messageId = normalizeOpenCodeMessageId(payload.messageId);
      const session = await requestTaskOpenCode(task, queryPath('/fork'), {
        method: 'POST', body: messageId ? { messageID: messageId } : {}, timeoutMs: 10000,
      });
      const createdAt = new Date().toISOString();
      const clone = {
        ...task,
        id: `agent-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        opencodeSessionId: normalizeOpenCodeSessionId(session?.id || ''),
        title: normalizeSingleLine(`${task.title} - 分支`, 80),
        messages: task.messages.map(message => ({ ...message, tools: Array.isArray(message.tools) ? message.tools.map(tool => ({ ...tool })) : [] })),
        pendingPermissions: [], pendingQuestions: [], status: 'success', stage: 'forked',
        createdAt, updatedAt: createdAt, startedAt: '', finishedAt: createdAt,
        outputText: '', stderrText: '', error: '', events: [], command: [],
        cancelRequested: false, canceled: false, timedOut: false,
      };
      addTaskEvent(clone, 'success', `已从“${task.title}”创建会话分支`);
      tasks.set(clone.id, clone);
      pruneTasks();
      emitTaskUpdate(clone, 'task', true);
      return { task: serializeTask(clone, { includeMessages: true }) };
    }
    if (action === 'summarize') {
      const modelSelection = await resolveSessionSummaryModel(task, payload);
      await runSessionSummarize(task, (pathname, options = {}) => requestTaskOpenCode(task, pathname, options), {
        timeoutMs: task.timeoutMs || 180000,
        modelSelection,
      });
      addTaskEvent(task, 'success', modelSelection
        ? `OpenCode 会话上下文已压缩，当前约 ${Number(task.contextUsage?.total ?? task.contextUsage ?? 0)} Token`
        : `OpenCode 会话上下文已压缩（使用默认模型），当前约 ${Number(task.contextUsage?.total ?? task.contextUsage ?? 0)} Token`);
    } else if (action === 'revert') {
      const messageId = normalizeOpenCodeMessageId(payload.messageId);
      if (!messageId) throw createHttpError(400, '缺少可撤销的消息 ID', 'AGENT_REVERT_MESSAGE_REQUIRED');
      await requestTaskOpenCode(task, queryPath('/revert'), {
        method: 'POST', body: { messageID: messageId }, timeoutMs: 15000,
      });
      addTaskEvent(task, 'warn', '已撤销所选 OpenCode 消息及其文件改动');
    } else if (action === 'unrevert') {
      await requestTaskOpenCode(task, queryPath('/unrevert'), { method: 'POST', body: {}, timeoutMs: 15000 });
      addTaskEvent(task, 'success', '已恢复此前撤销的 OpenCode 消息');
    } else {
      throw createHttpError(400, '不支持的会话操作', 'AGENT_SESSION_ACTION_INVALID');
    }
    task.updatedAt = new Date().toISOString();
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    return { task: serializeTask(task, { includeMessages: true }) };
  }

  async function getSessionDiff(taskId = '') {
    const task = tasks.get(String(taskId || '').trim());
    if (!task?.opencodeSessionId) throw createHttpError(404, '该会话没有可读取的 OpenCode Diff', 'AGENT_SESSION_DIFF_UNAVAILABLE');
    const [sessionDiffs, workspaceDiffs] = await Promise.all([
      requestTaskOpenCode(task, `/session/${encodeURIComponent(task.opencodeSessionId)}/diff`, { timeoutMs: 10000 }).catch(() => []),
      requestTaskOpenCode(task, '/vcs/diff?mode=git&context=6', { timeoutMs: 10000 }).catch(() => []),
    ]);
    const normalizedSessionDiffs = Array.isArray(sessionDiffs) ? sessionDiffs.slice(0, 300) : [];
    const normalizedWorkspaceDiffs = Array.isArray(workspaceDiffs) ? workspaceDiffs.slice(0, 300) : [];
    return {
      success: true,
      diffs: normalizedWorkspaceDiffs.length ? normalizedWorkspaceDiffs : normalizedSessionDiffs,
      sessionDiffs: normalizedSessionDiffs,
      workspaceDiffs: normalizedWorkspaceDiffs,
    };
  }

  async function restoreSessionDiffFile(taskId = '', payload = {}) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 会话', 'AGENT_TASK_NOT_FOUND');
    if (task.status === 'running' || task.status === 'pending') {
      throw createHttpError(409, '会话正在执行，暂时不能恢复文件', 'AGENT_SESSION_BUSY');
    }
    if (payload.confirmed !== true) {
      throw createHttpError(428, '恢复文件需要确认', 'AGENT_DIFF_RESTORE_CONFIRMATION_REQUIRED');
    }
    const file = String(payload.file || '').replace(/\\/g, '/').trim();
    if (!file || path.posix.isAbsolute(file) || file.split('/').includes('..')) {
      throw createHttpError(400, '文件路径无效', 'AGENT_DIFF_FILE_INVALID');
    }
    const diffs = await requestTaskOpenCode(task, '/vcs/diff?mode=git&context=3', { timeoutMs: 10000 });
    const diff = Array.isArray(diffs) ? diffs.find(item => String(item?.file || item?.path || '').replace(/\\/g, '/') === file) : null;
    if (!diff) throw createHttpError(404, '该文件不在当前 Git Diff 中', 'AGENT_DIFF_FILE_NOT_FOUND');
    if (diff.status === 'added') {
      throw createHttpError(409, '新增文件不会自动删除，请在文件管理器中人工核对', 'AGENT_DIFF_ADDED_FILE_UNSUPPORTED');
    }
    const workspacePath = await resolveTaskWorkspacePath(task);
    const result = await runCapturedProcess('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', file], {
      cwd: workspacePath,
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
      outputLimit: 20000,
    });
    if (result.code !== 0) {
      throw createHttpError(500, normalizeSingleLine(result.stderr || 'Git 恢复失败', 1000), 'AGENT_DIFF_RESTORE_FAILED');
    }
    const audit = await readGitChangeAudit(workspacePath);
    task.workspaceChanged = audit.changedFiles.length > 0;
    task.changedFiles = audit.changedFiles;
    task.diffStat = audit.diffStat;
    task.diffText = audit.diffText;
    task.updatedAt = new Date().toISOString();
    addTaskEvent(task, 'success', `已恢复文件：${file}`);
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    return { success: true, file, task: serializeTask(task, { includeMessages: true }) };
  }

  async function manageWorktree(workspaceId = '', action = '', payload = {}) {
    const workspace = resolveAgentWorkspace(workspaceId, workspaceOptions);
    if (action === 'create') {
      if (payload.confirmed !== true) throw createHttpError(428, '创建 Worktree 需要确认', 'AGENT_WORKTREE_CONFIRMATION_REQUIRED');
      return { success: true, worktree: await createWorkspaceWorktree(workspace.id, payload.name) };
    }
    const available = await listWorkspaceWorktrees(workspace.id);
    const requested = resolveExistingDirectory(payload.directory || '');
    const directory = requested && available.find(item => isSamePath(item, requested));
    if (!directory) throw createHttpError(404, '没有找到该 OpenCode Worktree', 'AGENT_WORKTREE_NOT_FOUND');
    if (!['reset', 'remove'].includes(action)) {
      throw createHttpError(400, '不支持的 Worktree 操作', 'AGENT_WORKTREE_ACTION_INVALID');
    }
    if (payload.confirmed !== true) {
      throw createHttpError(428, `${action === 'reset' ? '重置' : '删除'} Worktree 需要确认`, 'AGENT_WORKTREE_CONFIRMATION_REQUIRED');
    }
    if (action === 'remove') {
      const referenced = Array.from(tasks.values()).filter(task => task.worktree?.directory && isSamePath(task.worktree.directory, directory));
      if (referenced.length) {
        throw createHttpError(409, `仍有 ${referenced.length} 个会话使用该 Worktree，请先删除对应会话`, 'AGENT_WORKTREE_IN_USE');
      }
    }
    const endpoint = action === 'reset' ? '/experimental/worktree/reset' : '/experimental/worktree';
    const result = await requestWorkspaceOpenCode(workspace.id, endpoint, {
      method: action === 'reset' ? 'POST' : 'DELETE',
      body: { directory },
      timeoutMs: 30000,
    });
    return { success: true, action, directory, result };
  }

  async function executeSessionCommand(taskId = '', payload = {}) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task?.opencodeSessionId) throw createHttpError(404, '该会话还不能执行 OpenCode Command', 'AGENT_SESSION_COMMAND_UNAVAILABLE');
    if (task.status === 'running' || task.status === 'pending') {
      throw createHttpError(409, '会话正在执行，请等待当前任务完成', 'AGENT_SESSION_BUSY');
    }
    const command = normalizeSingleLine(payload.command || '', 180);
    const argumentsText = normalizePrompt(payload.arguments || '', 3000);
    if (!command) throw createHttpError(400, '请选择需要执行的 Command', 'AGENT_COMMAND_REQUIRED');
    const commands = await requestTaskOpenCode(task, '/command', { timeoutMs: 8000 });
    const definition = Array.isArray(commands) ? commands.find(item => item?.name === command) : null;
    if (!definition) throw createHttpError(404, '该 Command 不存在或已经失效', 'AGENT_COMMAND_NOT_FOUND');
    task.agent = normalizeOpenCodeAgent(payload.agent, task.agent || definition.agent || (isWriteMode(task.mode) ? 'build' : 'plan'));
    if (payload.model !== undefined) task.model = normalizeModel(payload.model);
    if (payload.modelProviderId !== undefined) task.modelProviderId = normalizeModelProviderId(payload.modelProviderId);
    const modelSelection = buildOpenCodeModelSelection(task.model, task.modelProviderId);
    const startedAt = new Date().toISOString();
    task.status = 'running';
    task.stage = 'command';
    task.startedAt = startedAt;
    task.updatedAt = startedAt;
    addTaskEvent(task, 'info', `正在执行 Command：/${command}`);
    emitTaskUpdate(task, 'task', true);
    try {
      const response = await requestTaskOpenCode(task, `/session/${encodeURIComponent(task.opencodeSessionId)}/command`, {
        method: 'POST',
        body: {
          command,
          arguments: argumentsText,
          agent: task.agent,
          ...(modelSelection ? { model: `${modelSelection.providerID}/${modelSelection.modelID}` } : {}),
          parts: [],
        },
        timeoutMs: task.timeoutMs,
      });
      const userCreatedAt = startedAt;
      const finishedAt = new Date().toISOString();
      const parsed = parseOpenCodeTurn(openCodePartsToJsonl(response?.parts, task.opencodeSessionId));
      const commandUsage = normalizeUsage(response?.info?.tokens || response?.info?.usage);
      task.usage = {
        input: Number(task.usage?.input || 0) + commandUsage.input,
        output: Number(task.usage?.output || 0) + commandUsage.output,
        total: Number(task.usage?.total || 0) + commandUsage.total,
      };
      task.messages.push({
        id: `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        role: 'user', content: `/${command}${argumentsText ? ` ${argumentsText}` : ''}`,
        createdAt: userCreatedAt, mode: task.mode, status: 'sent', attachments: [],
      });
      task.messages.push({
        id: `message-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
        role: 'assistant', openCodeMessageId: normalizeOpenCodeMessageId(response?.info?.id || parsed.messageId),
        content: parsed.content, reasoning: parsed.reasoning, tools: parsed.tools,
        createdAt: userCreatedAt, finishedAt, elapsedMs: Math.max(0, Date.parse(finishedAt) - Date.parse(userCreatedAt)),
        mode: task.mode, status: 'success', error: '', stderrText: '', changedFiles: [], diffStat: '', diffText: '',
        usage: commandUsage,
      });
      trimTaskMessages(task);
      task.turnCount = Math.max(0, Number(task.turnCount || 0)) + 1;
      task.status = 'success';
      task.stage = 'complete';
      task.finishedAt = finishedAt;
      task.updatedAt = finishedAt;
      addTaskEvent(task, 'success', `Command /${command} 执行完成`);
      persistTasks();
      emitTaskUpdate(task, 'task', true);
      return { success: true, task: serializeTask(task, { includeMessages: true }) };
    } catch (error) {
      task.status = 'error';
      task.stage = 'error';
      task.error = normalizeSingleLine(error?.message || String(error), 1000);
      task.finishedAt = new Date().toISOString();
      task.updatedAt = task.finishedAt;
      addTaskEvent(task, 'error', task.error);
      persistTasks();
      emitTaskUpdate(task, 'task', true);
      throw error;
    }
  }

  async function backgroundSession(taskId = '') {
    const task = tasks.get(String(taskId || '').trim());
    if (!task?.opencodeSessionId) throw createHttpError(404, '该会话没有可转入后台的子 Agent', 'AGENT_SESSION_BACKGROUND_UNAVAILABLE');
    const result = await requestTaskOpenCode(task, `/experimental/session/${encodeURIComponent(task.opencodeSessionId)}/background`, {
      method: 'POST', body: {}, timeoutMs: 10000,
    });
    addTaskEvent(task, result === true ? 'success' : 'warn', result === true ? '已将阻塞中的子 Agent 转入后台' : '当前没有可转入后台的子 Agent');
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    return { success: true, backgrounded: result === true, task: serializeTask(task, { includeMessages: true }) };
  }

  async function searchWorkspace(payload = {}) {
    const task = tasks.get(String(payload.taskId || '').trim()) || null;
    const workspace = resolveAgentWorkspace(task?.workspaceId || payload.workspaceId, workspaceOptions);
    const query = normalizeSingleLine(payload.query || '', 300);
    if (!query) throw createHttpError(400, '请输入搜索内容', 'AGENT_SEARCH_QUERY_REQUIRED');
    const type = ['text', 'symbol'].includes(payload.type) ? payload.type : 'file';
    const pathname = type === 'text'
      ? `/find?pattern=${encodeURIComponent(query)}`
      : type === 'symbol'
        ? `/find/symbol?query=${encodeURIComponent(query)}`
        : `/find/file?query=${encodeURIComponent(query)}&limit=100`;
    const result = task
      ? await requestTaskOpenCode(task, pathname, { timeoutMs: 12000 })
      : await requestWorkspaceOpenCode(workspace.id, pathname, { timeoutMs: 12000 });
    return { success: true, type, results: Array.isArray(result) ? result.slice(0, 200) : [] };
  }

  async function createTerminal(payload = {}) {
    const config = getConfig();
    if (!config.allowTerminal) throw createHttpError(403, '请先在 Agent 设置中开启受控终端', 'AGENT_TERMINAL_DISABLED');
    if (payload.confirmed !== true) throw createHttpError(428, '首次创建终端需要确认', 'AGENT_TERMINAL_CONFIRMATION_REQUIRED');
    const workspace = resolveAgentWorkspace(payload.workspaceId, workspaceOptions);
    const activeCount = Array.from(terminals.values()).filter(item => item.status === 'running').length;
    if (activeCount >= AGENT_TERMINAL_LIMIT) throw createHttpError(409, '终端数量已达到上限', 'AGENT_TERMINAL_LIMIT');
    const command = normalizeSingleLine(payload.command || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'), 300);
    const args = Array.isArray(payload.args) ? payload.args.slice(0, 20).map(value => normalizeSingleLine(value, 500)) : [];
    const pty = await requestWorkspaceOpenCode(workspace.id, '/pty', {
      method: 'POST', body: { command, args, cwd: workspace.path, title: normalizeSingleLine(payload.title || 'Agent 终端', 80) }, timeoutMs: 10000,
    });
    const runtime = await getWorkspaceRuntime(workspace.id);
    let token;
    let socket;
    try {
      token = await requestOpenCodeJson(runtime.server, `/pty/${encodeURIComponent(pty.id)}/connect-token?directory=${encodeURIComponent(workspace.path)}`, {
        method: 'POST',
        timeoutMs: 5000,
        headers: {
          origin: runtime.server.url,
          'x-opencode-ticket': '1',
        },
      });
      const wsUrl = `${runtime.server.url.replace(/^http/i, 'ws')}/pty/${encodeURIComponent(pty.id)}/connect?ticket=${encodeURIComponent(token.ticket)}&directory=${encodeURIComponent(workspace.path)}`;
      socket = new WebSocket(wsUrl, { headers: { origin: runtime.server.url } });
    } catch (error) {
      await requestWorkspaceOpenCode(workspace.id, `/pty/${encodeURIComponent(pty.id)}`, { method: 'DELETE', timeoutMs: 5000 }).catch(() => false);
      throw error;
    }
    const now = new Date().toISOString();
    const terminal = {
      id: pty.id, workspaceId: workspace.id, runtimeKey: runtime.runtimeKey, title: pty.title || 'Agent 终端', command: pty.command || command,
      cwd: pty.cwd || workspace.path, status: pty.status || 'running', pid: pty.pid || 0, exitCode: pty.exitCode,
      output: '', socket, createdAt: now, updatedAt: now,
    };
    terminals.set(terminal.id, terminal);
    socket.addEventListener('message', event => {
      Promise.resolve(event.data instanceof Blob ? event.data.text() : event.data).then(value => {
        const text = typeof value === 'string'
          ? value
          : Buffer.from(value instanceof ArrayBuffer ? value : String(value)).toString('utf8');
        terminal.output = appendLimited(terminal.output, normalizeTerminalOutput(text), AGENT_TERMINAL_OUTPUT_LIMIT);
        terminal.updatedAt = new Date().toISOString();
        emitWorkbenchUpdate('terminal', { workspaceId: workspace.id, terminals: listTerminals(workspace.id) });
      }).catch(() => {});
    });
    socket.addEventListener('close', () => {
      terminal.status = 'exited';
      terminal.updatedAt = new Date().toISOString();
      emitWorkbenchUpdate('terminal', { workspaceId: workspace.id, terminals: listTerminals(workspace.id) });
    });
    socket.addEventListener('error', () => {
      terminal.output = appendLimited(terminal.output, '\n[终端连接异常]\n', AGENT_TERMINAL_OUTPUT_LIMIT);
      emitWorkbenchUpdate('terminal', { workspaceId: workspace.id, terminals: listTerminals(workspace.id) });
    });
    emitWorkbenchUpdate('terminal', { workspaceId: workspace.id, terminals: listTerminals(workspace.id) });
    return serializeTerminal(terminal);
  }

  async function sendTerminalInput(terminalId = '', payload = {}) {
    const terminal = terminals.get(String(terminalId || '').trim());
    if (!terminal || terminal.status !== 'running') throw createHttpError(404, '终端不存在或已经退出', 'AGENT_TERMINAL_NOT_FOUND');
    const input = String(payload.input || '').replace(/\u0000/g, '').slice(0, 8000);
    if (!input) throw createHttpError(400, '请输入终端内容', 'AGENT_TERMINAL_INPUT_REQUIRED');
    if (terminal.socket.readyState !== WebSocket.OPEN) throw createHttpError(409, '终端连接尚未就绪', 'AGENT_TERMINAL_NOT_READY');
    terminal.socket.send(input);
    terminal.updatedAt = new Date().toISOString();
    return serializeTerminal(terminal);
  }

  async function resizeTerminal(terminalId = '', payload = {}) {
    const terminal = terminals.get(String(terminalId || '').trim());
    if (!terminal) throw createHttpError(404, '终端不存在', 'AGENT_TERMINAL_NOT_FOUND');
    const rows = clampInteger(payload.rows, 30, 4, 200);
    const cols = clampInteger(payload.cols, 100, 20, 400);
    await requestWorkspaceOpenCode(terminal.workspaceId, `/pty/${encodeURIComponent(terminal.id)}`, {
      method: 'PUT', body: { size: { rows, cols } }, timeoutMs: 5000,
    });
    return serializeTerminal(terminal);
  }

  async function closeTerminal(terminalId = '') {
    const terminal = terminals.get(String(terminalId || '').trim());
    if (!terminal) throw createHttpError(404, '终端不存在', 'AGENT_TERMINAL_NOT_FOUND');
    await requestWorkspaceOpenCode(terminal.workspaceId, `/pty/${encodeURIComponent(terminal.id)}`, { method: 'DELETE', timeoutMs: 5000 }).catch(() => false);
    terminal.socket?.close?.();
    terminal.status = 'exited';
    terminal.updatedAt = new Date().toISOString();
    emitWorkbenchUpdate('terminal', { workspaceId: terminal.workspaceId, terminals: listTerminals(terminal.workspaceId) });
    return serializeTerminal(terminal);
  }

  async function closeOpenCodeRuntimes() {
    const runtimes = Array.from(workspaceRuntimes.values());
    const activeTasks = Array.from(tasks.values())
      .filter(task => task.providerId === 'opencode' && (task.status === 'running' || task.status === 'pending'));
    const taskServers = activeTasks
      .filter(task => task.openCodeServer?.child?.exitCode === null)
      .map(task => ({ task, server: task.openCodeServer }));
    const servers = new Map();
    const addServer = server => {
      if (!server) return;
      const key = server.child?.pid || server.url || server;
      if (!servers.has(key)) servers.set(key, server);
    };
    runtimes.forEach(runtime => addServer(runtime.server));
    taskServers.forEach(item => addServer(item.server));
    let closedTerminalCount = 0;
    let canceledTaskCount = 0;
    for (const task of activeTasks) {
      task.cancelRequested = true;
      task.updatedAt = new Date().toISOString();
      addTaskEvent(task, 'warn', '已关闭 OpenCode 服务，当前 Agent 任务已取消');
      task.openCodeRequestAbort?.abort?.();
      task.openCodeEventStream?.controller?.abort?.();
      canceledTaskCount += 1;
      emitTaskUpdate(task, 'task', true);
    }
    if (canceledTaskCount) persistTasks();
    for (const runtime of runtimes) {
      const workspaceTerminals = Array.from(terminals.values())
        .filter(terminal => terminal.workspaceId === runtime.workspace.id && terminal.status === 'running');
      for (const terminal of workspaceTerminals) {
        const endpoint = `/pty/${encodeURIComponent(terminal.id)}?directory=${encodeURIComponent(runtime.workspace.path)}`;
        await requestOpenCodeJson(runtime.server, endpoint, { method: 'DELETE', timeoutMs: 3000 }).catch(() => false);
        terminal.socket?.close?.();
        terminal.status = 'exited';
        terminal.updatedAt = new Date().toISOString();
        closedTerminalCount += 1;
      }
      await closeWorkspaceRuntime(runtime);
    }
    const runtimeServers = new Set(runtimes.map(runtime => runtime.server));
    for (const server of servers.values()) {
      if (runtimeServers.has(server)) continue;
      await stopAttachedOpenCodeServer(server);
    }
    const messageParts = [];
    if (servers.size) messageParts.push(`已关闭 ${servers.size} 个 OpenCode 后台服务`);
    if (canceledTaskCount) messageParts.push(`已取消 ${canceledTaskCount} 个 OpenCode Agent 任务`);
    return {
      success: true,
      closedCount: servers.size,
      closedTerminalCount,
      canceledTaskCount,
      message: messageParts.join('，') || '当前没有运行中的 OpenCode 后台服务',
    };
  }

  async function listOpenCodeRuntimes() {
    const config = getConfig();
    const now = Date.now();
    const runtimes = Array.from(workspaceRuntimes.values())
      .filter(runtime => runtime?.server?.child?.exitCode === null && !runtime.server.child.killed);
    const items = await Promise.all(runtimes.map(async runtime => {
      const activeTasks = Array.from(runtime.activeTaskIds || [])
        .map(taskId => tasks.get(taskId))
        .filter(Boolean)
        .map(task => ({
          id: task.id,
          title: normalizeSingleLine(task.title || task.promptPreview || 'Agent 任务', 120),
          status: task.status || 'running',
        }));
      const runtimeTerminals = Array.from(terminals.values())
        .filter(terminal => terminal.runtimeKey === runtime.runtimeKey && terminal.status === 'running');
      const lastUsedAt = Math.max(0, Number(runtime.lastUsedAt || 0));
      const busy = activeTasks.length > 0 || runtimeTerminals.length > 0;
      const pid = Math.max(0, Number(runtime.server?.child?.pid || 0));
      const resource = await readProcessResource(pid);
      const previous = runtimeResourceSamples.get(pid);
      const sampleAt = Date.now();
      let cpuPercent = resource.cpuPercent;
      if (cpuPercent === null && previous && resource.cpuTimeMs >= previous.cpuTimeMs && sampleAt > previous.sampleAt) {
        const elapsedMs = sampleAt - previous.sampleAt;
        const cpuDeltaMs = resource.cpuTimeMs - previous.cpuTimeMs;
        cpuPercent = (cpuDeltaMs / elapsedMs / Math.max(1, os.cpus().length)) * 100;
      }
      if (pid) runtimeResourceSamples.set(pid, { cpuTimeMs: resource.cpuTimeMs, sampleAt });
      return {
        id: runtime.id || runtime.runtimeKey,
        pid,
        profile: normalizeSingleLine(runtime.profile || 'native', 180),
        workspace: {
          id: runtime.workspace?.id || '',
          label: runtime.workspace?.label || 'OpenCode 运行时',
          path: runtime.workspace?.path || '',
        },
        activeTaskCount: activeTasks.length,
        activeTasks,
        terminalCount: runtimeTerminals.length,
        createdAt: runtime.createdAt || '',
        lastUsedAt: lastUsedAt ? new Date(lastUsedAt).toISOString() : '',
        idleRemainingMs: busy ? null : Math.max(0, config.runtimeIdleTimeoutMs - (now - lastUsedAt)),
        closing: runtime.closing === true,
        memoryBytes: resource.memoryBytes,
        cpuPercent: Number.isFinite(Number(cpuPercent)) ? Math.min(1000, Math.max(0, Number(cpuPercent))) : null,
        threads: resource.threads,
      };
    }));
    const activePids = new Set(items.map(item => item.pid).filter(Boolean));
    runtimeResourceSamples.forEach((_, pid) => {
      if (!activePids.has(pid)) runtimeResourceSamples.delete(pid);
    });
    const totalRuntimeMemoryBytes = items.reduce((total, item) => total + Math.max(0, Number(item.memoryBytes || 0)), 0);
    const totalRuntimeCpuPercent = items.reduce((total, item) => total + Math.max(0, Number(item.cpuPercent || 0)), 0);
    const systemMemoryBytes = Math.max(0, Number(os.totalmem() || 0));
    const systemFreeMemoryBytes = Math.max(0, Number(os.freemem() || 0));
    return {
      success: true,
      generatedAt: new Date().toISOString(),
      limit: config.maxOpenCodeRuntimes,
      idleTimeoutMs: config.runtimeIdleTimeoutMs,
      resource: {
        totalRuntimeMemoryBytes,
        totalRuntimeCpuPercent,
        systemMemoryBytes,
        systemFreeMemoryBytes,
        systemUsedMemoryBytes: Math.max(0, systemMemoryBytes - systemFreeMemoryBytes),
        cpuCount: Math.max(1, os.cpus().length),
      },
      runtimes: items.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))),
    };
  }

  async function closeOpenCodeRuntime(runtimeId = '', payload = {}) {
    if (payload.confirmed !== true) {
      throw createHttpError(428, '关闭 OpenCode 运行时需要确认', 'AGENT_RUNTIME_CLOSE_CONFIRMATION_REQUIRED');
    }
    const id = String(runtimeId || '').trim();
    const runtime = Array.from(workspaceRuntimes.values())
      .find(item => (item.id || item.runtimeKey) === id);
    if (!runtime) throw createHttpError(404, 'OpenCode 运行时不存在或已经关闭', 'AGENT_RUNTIME_NOT_FOUND');
    const activeTaskCount = runtime.activeTaskIds?.size || 0;
    const terminalCount = Array.from(terminals.values())
      .filter(terminal => terminal.runtimeKey === runtime.runtimeKey && terminal.status === 'running').length;
    if (activeTaskCount || terminalCount) {
      throw createHttpError(
        409,
        `该运行时仍有 ${activeTaskCount} 个任务和 ${terminalCount} 个终端正在使用，不能关闭`,
        'AGENT_RUNTIME_IN_USE',
      );
    }
    await closeWorkspaceRuntime(runtime);
    return { success: true, closed: true, runtimeId: id };
  }

  scheduleTaskDispatch();

  // 读取工作区内的图片文件（供回复中 Markdown 相对路径图片渲染）：
  // 仅允许图片扩展名，realpath 解析后必须落在已配置的工作区根内，防目录穿越
  function readAgentWorkspaceImage(pathValue = '') {
    const raw = String(pathValue || '').trim().replace(/^file:\/\//i, '');
    if (!raw || raw.includes('\0')) throw createHttpError(400, '图片路径无效', 'AGENT_IMAGE_PATH_INVALID');
    // 兼容客户端编码差异：容忍残留的 %5C（反斜杠）等，做一次解码与分隔符规范化后逐个尝试
    const candidates = [raw];
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded !== raw) candidates.push(decoded);
    } catch {
      // 含非法百分号序列时忽略解码候选
    }
    candidates.push(...candidates.slice().map(item => item.replace(/\\/g, '/')));
    for (const candidatePath of [...new Set(candidates)]) {
      const ext = path.extname(candidatePath).toLowerCase();
      const mime = AGENT_IMAGE_MIME_BY_EXT[ext];
      if (!mime) continue;
      for (const workspace of getAgentWorkspaceOptions(workspaceOptions)) {
        let candidate = path.resolve(workspace.path, candidatePath);
        try {
          candidate = fs.realpathSync.native(candidate);
        } catch {
          continue;
        }
        const candidateKey = getComparablePath(candidate);
        const rootKey = getComparablePath(workspace.path);
        if (candidateKey !== rootKey && !candidateKey.startsWith(`${rootKey}${path.sep}`)) continue;
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        if (stat.size > AGENT_WORKSPACE_IMAGE_MAX_BYTES) {
          throw createHttpError(413, '图片超过 10MB，无法展示', 'AGENT_IMAGE_TOO_LARGE');
        }
        return { buffer: fs.readFileSync(candidate), mime };
      }
    }
    throw createHttpError(404, '工作区内未找到该图片', 'AGENT_IMAGE_NOT_FOUND');
  }

  return {
    buildPayload,
    saveConfig,
    createTask,
    batchManageTasks,
    readAgentWorkspaceImage,
    getTask,
    getSessionHistory,
    cancelTask,
    resumeTask,
    retryTask,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    buildNativePayload,
    manageSession,
    getSessionDiff,
    getTaskGitState,
    manageTaskGit,
    restoreSessionDiffFile,
    manageWorktree,
    executeSessionCommand,
    backgroundSession,
    searchWorkspace,
    createTerminal,
    sendTerminalInput,
    resizeTerminal,
    closeTerminal,
    closeOpenCodeRuntimes,
    listOpenCodeRuntimes,
    closeOpenCodeRuntime,
    listTerminals,
    subscribeEvents,
    listTasks,
    buildUsageStats,
    archiveTask,
    exportTask,
    importTask,
    serializeTask,
    probeProvider,
  };
}
