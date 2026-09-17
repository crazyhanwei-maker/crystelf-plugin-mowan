import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';
import { normalizeAiProtocol } from '../../modules/openai/protocolAdapter.js';

const OPENCODE_PROVIDER_ID = 'crystelf-chat';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeBaseApi(value = '') {
  return normalizeText(value).replace(/\/+$/, '');
}

// @ai-sdk/anthropic 的 baseURL 语义：请求打到 {baseURL}/messages。
// 主对话协议为 anthropic 时地址不带 /v1（如 https://api.qnaigc.com），这里统一归一成以 /v1 结尾。
function buildAnthropicSdkBase(baseUrl = '') {
  const base = normalizeBaseApi(baseUrl);
  if (!base) return base;
  // @ai-sdk/anthropic 在 baseURL 后拼 /messages，因此必须以 /v1 结尾
  if (/\/v1\/messages$/i.test(base)) return base.replace(/\/messages$/i, '');
  if (/\/v1$/i.test(base)) return base;
  return `${base}/v1`;
}

function normalizeUserAgent(value = '') {
  return normalizeText(value).replace(/[\r\n]/g, '').slice(0, 200);
}

function normalizeModel(value = '') {
  return normalizeText(value).replace(/[^A-Za-z0-9._:/-]/g, '').slice(0, 160) || 'gpt-5.4-mini';
}

function getBundledOpenCodeCandidates(rootPath = Path.root) {
  const binRoot = path.join(rootPath, 'node_modules', 'opencode-ai', 'bin');
  if (process.platform === 'win32') {
    return [
      path.join(binRoot, 'opencode.exe'),
      path.join(binRoot, 'opencode.cmd'),
    ];
  }
  return [
    path.join(binRoot, 'opencode'),
    path.join(binRoot, 'opencode.exe'),
  ];
}

export function resolveBundledOpenCodeCommand(options = {}) {
  const rootPath = options.rootPath || Path.root;
  const candidates = getBundledOpenCodeCandidates(rootPath);
  const executable = candidates.find(item => fs.existsSync(item));
  if (!executable) return null;
  return {
    command: executable,
    baseArgs: [],
    source: 'plugin',
    version: '1.18.4',
  };
}

export function resolveBundledOpenCodeBootstrapCommand(options = {}) {
  const rootPath = options.rootPath || Path.root;
  const postinstallScript = path.join(rootPath, 'node_modules', 'opencode-ai', 'postinstall.mjs');
  if (!fs.existsSync(postinstallScript)) return null;
  return {
    command: process.execPath,
    args: [postinstallScript],
    cwd: rootPath,
  };
}

export function isBundledOpenCodeBootstrapError(value = '') {
  return /opencode-ai['’]s postinstall script was not run|failed to install the right opencode cli package|binary not found at/i.test(String(value || ''));
}

// 推理等级 variants：opencode 按 model.variants[variant] 合并 providerOptions，
// 不声明的话 UI 选择任何等级都会被忽略（模型跑上游默认档）
const REASONING_VARIANTS = {
  minimal: { reasoningEffort: 'minimal' },
  low: { reasoningEffort: 'low' },
  medium: { reasoningEffort: 'medium' },
  high: { reasoningEffort: 'high' },
  xhigh: { reasoningEffort: 'xhigh' },
  max: { reasoningEffort: 'max' },
};

// anthropic 供应商的思考等级映射（实测确认：variant 顶层键直接合并进 AI SDK 调用参数，
// { thinking: {...} } 会出现在请求体，且 SDK 自动把 max_tokens 抬高预算额度防截断）。
// 预算下限 1024 为 Anthropic 规范最小值；minimal 直接关闭思考。
const ANTHROPIC_REASONING_VARIANTS = {
  minimal: { thinking: { type: 'disabled' } },
  low: { thinking: { type: 'enabled', budgetTokens: 1024 } },
  medium: { thinking: { type: 'enabled', budgetTokens: 4096 } },
  high: { thinking: { type: 'enabled', budgetTokens: 12288 } },
  xhigh: { thinking: { type: 'enabled', budgetTokens: 24576 } },
  max: { thinking: { type: 'enabled', budgetTokens: 24576 } },
};

// 供应商 id：ascii 残段 + 名称哈希，保证中文名不撞车
function modelProviderSlug(name = '') {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  let hash = 5381;
  for (const ch of String(name || '')) hash = ((hash << 5) + hash + ch.codePointAt(0)) >>> 0;
  return `${slug || 'p'}-${hash.toString(36)}`;
}

function buildOpenCodeConfig(aiConfig = {}, requestedModel = '', options = {}) {
  const customApi = options.customApi?.enabled === true ? options.customApi : {};
  const apiSource = Object.keys(customApi).length ? customApi : aiConfig;
  const baseApi = normalizeBaseApi(apiSource.baseApi);
  const apiKey = normalizeText(apiSource.apiKey);
  const requestedProviderId = normalizeText(options.requestedProviderId || '').toLowerCase();
  // 工作台配置的自定义供应商列表：与默认供应商一起全部声明进 opencode，任务按需选择
  const modelProviders = (Array.isArray(options.modelProviders) ? options.modelProviders : [])
    .filter(item => item?.name && item?.baseApi && Array.isArray(item?.models) && item.models.length > 0);
  const selectedCustomProvider = modelProviders.find(item => normalizeText(item.name).toLowerCase() === requestedProviderId);
  const model = normalizeModel(
    (selectedCustomProvider && requestedModel)
      ? requestedModel
      : (requestedModel && !requestedProviderId ? requestedModel : (apiSource.model || apiSource.modelType || aiConfig.modelType || aiConfig.workingModel)),
  );
  if (!baseApi) {
    const error = new Error(customApi.enabled === true
      ? 'Agent 自定义 API 地址未配置，无法启动内置 OpenCode'
      : 'AI 主对话 API 地址未配置，无法启动内置 OpenCode');
    error.code = customApi.enabled === true ? 'AGENT_CUSTOM_API_MISSING' : 'AGENT_CHAT_API_MISSING';
    throw error;
  }
  if (!apiKey) {
    const error = new Error(customApi.enabled === true
      ? 'Agent 自定义 API 密钥未配置，无法启动内置 OpenCode'
      : 'AI 主对话 API 密钥未配置，无法启动内置 OpenCode');
    error.code = customApi.enabled === true ? 'AGENT_CUSTOM_API_KEY_MISSING' : 'AGENT_CHAT_API_KEY_MISSING';
    throw error;
  }

  const headers = {};
  const userAgent = normalizeUserAgent(apiSource.userAgent || aiConfig.userAgent);
  if (userAgent) headers['User-Agent'] = userAgent;
  // attachment + modalities.input.image 同时声明才有效：缺失时 OpenCode 按纯文本模型处理，
  // 图片附件会被替换成 "does not support image input" 的文本说明，模型根本看不到图
  const modelConfig = {
    name: model,
    attachment: true,
    modalities: { input: ['text', 'image'], output: ['text'] },
  };
  // 接入协议跟随主对话 API（工作台自定义 API 未单独声明时同样跟随）。
  // anthropic 走 @ai-sdk/anthropic 供应商（x-api-key/版本头由 SDK 处理）；
  // 思考等级按供应商语义映射：openai-compatible → reasoningEffort，anthropic → thinking 预算。
  const protocol = normalizeAiProtocol(apiSource.apiProtocol || aiConfig.apiProtocol);
  const isAnthropic = protocol === 'anthropic';
  modelConfig.variants = isAnthropic ? ANTHROPIC_REASONING_VARIANTS : REASONING_VARIANTS;
  const nativeConfig = options.nativeConfig && typeof options.nativeConfig === 'object' ? options.nativeConfig : {};
  // 权限模型（已实测验证）：全局一律 deny 作为基线，权限档定义在 agent 上、按请求选择。
  // 这样任何逃逸到默认 agent 的调用（如 task 子 agent 回退）都会落到拒绝，而不是拿到过大的权限。
  // - crystelf-read：只读分析（禁 task 子 agent，杜绝借道 build 档写入）
  // - crystelf-write：受控写入（edit 开放，bash 按终端授权 ask/deny）
  // - crystelf-full：完全访问
  // - plan：旧会话兼容别名（只读档）；build：默认子 agent（完全访问档，供 task 派生提权）
  const allowNetwork = options.allowNetwork === true;
  const allowAllDirectories = options.allowAllDirectories === true;
  const tierPermission = {
    edit: 'allow',
    webfetch: allowNetwork ? 'allow' : 'deny',
    external_directory: allowAllDirectories ? 'allow' : 'deny',
    // question 工具需要显式 allow，否则运行时会把工具从清单剔除，模型无法发起提问
    question: 'allow',
  };
  return {
    '$schema': 'https://opencode.ai/config.json',
    model: `${OPENCODE_PROVIDER_ID}/${model}`,
    small_model: `${OPENCODE_PROVIDER_ID}/${model}`,
    permission: {
      edit: 'deny',
      write: 'deny',
      bash: 'deny',
      webfetch: 'deny',
      websearch: 'deny',
      external_directory: 'deny',
      question: 'allow',
    },
    agent: {
      'crystelf-read': {
        mode: 'primary',
        description: '只读分析：禁止写入与终端命令',
        tools: { task: false, question: true },
        permission: {
          webfetch: allowNetwork ? 'allow' : 'deny',
          external_directory: allowAllDirectories ? 'allow' : 'deny',
          question: 'allow',
        },
      },
      'crystelf-write': {
        mode: 'primary',
        description: '受控写入：可修改文件，终端命令需审批',
        permission: {
          ...tierPermission,
          bash: options.allowTerminal === true ? 'ask' : 'deny',
        },
      },
      'crystelf-full': {
        mode: 'primary',
        description: '完全访问：可修改文件、执行终端命令',
        permission: {
          ...tierPermission,
          bash: 'allow',
        },
      },
      plan: {
        mode: 'primary',
        description: '只读分析（旧会话兼容别名）',
        tools: { task: false, question: true },
        permission: {
          webfetch: allowNetwork ? 'allow' : 'deny',
          external_directory: allowAllDirectories ? 'allow' : 'deny',
          question: 'allow',
        },
      },
      build: {
        mode: 'primary',
        description: '完全访问（默认子 agent 权限档）',
        permission: {
          edit: 'allow',
          bash: 'allow',
          webfetch: 'allow',
          websearch: 'allow',
          external_directory: 'allow',
        },
      },
      ...(nativeConfig.agent && typeof nativeConfig.agent === 'object' ? nativeConfig.agent : {}),
    },
    provider: {
      [OPENCODE_PROVIDER_ID]: {
        npm: isAnthropic ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
        name: customApi.enabled === true ? '魔丸自定义 Agent API' : '魔丸默认聊天 API',
        options: {
          baseURL: isAnthropic ? buildAnthropicSdkBase(baseApi) : baseApi,
          apiKey,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        },
        models: {
          [model]: modelConfig,
        },
      },
      ...modelProviders.reduce((providers, item) => {
        const providerId = `custom-${modelProviderSlug(item.name)}`;
        // 供应商协议：未声明时跟随主接口；anthropic 走 @ai-sdk/anthropic 并按其 baseURL 语义归一
        const rawProviderProtocol = normalizeText(item.apiProtocol).toLowerCase();
        const providerProtocol = rawProviderProtocol
          ? normalizeAiProtocol(rawProviderProtocol)
          : protocol;
        const providerIsAnthropic = providerProtocol === 'anthropic';
        providers[providerId] = {
          npm: providerIsAnthropic ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
          name: item.name,
          options: {
            baseURL: providerIsAnthropic ? buildAnthropicSdkBase(normalizeBaseApi(item.baseApi)) : normalizeBaseApi(item.baseApi),
            apiKey: normalizeText(item.apiKey),
          },
          models: item.models.reduce((models, modelName) => {
            models[normalizeModel(modelName)] = {
              name: normalizeModel(modelName),
              attachment: true,
              modalities: { input: ['text', 'image'], output: ['text'] },
              variants: providerIsAnthropic ? ANTHROPIC_REASONING_VARIANTS : REASONING_VARIANTS,
            };
            return models;
          }, {}),
        };
        return providers;
      }, {}),
    },
    ...(Object.keys(nativeConfig.mcp || {}).length ? { mcp: nativeConfig.mcp } : {}),
    ...(Object.keys(nativeConfig.command || {}).length ? { command: nativeConfig.command } : {}),
  };
}

function createRuntimeDirectories(runtimeRoot) {
  const dirs = {
    home: path.join(runtimeRoot, 'home'),
    config: path.join(runtimeRoot, 'config'),
    data: path.join(runtimeRoot, 'data'),
    state: path.join(runtimeRoot, 'state'),
    cache: path.join(runtimeRoot, 'cache'),
  };
  for (const directory of Object.values(dirs)) fs.mkdirSync(directory, { recursive: true });
  // OpenCode on Windows also initializes under HOME/.config. Keep that state private.
  fs.mkdirSync(path.join(dirs.home, '.config'), { recursive: true });
  return dirs;
}

export function buildBundledOpenCodeEnvironment(options = {}) {
  const runtimeRoot = path.resolve(options.runtimeRoot || path.join(Path.data, 'agent-cli-runtime'));
  const dirs = createRuntimeDirectories(runtimeRoot);
  const config = buildOpenCodeConfig(options.aiConfig, options.model, {
    writeMode: options.writeMode === true,
    fullAccess: options.fullAccess === true,
    customApi: options.customApi,
    requestedProviderId: options.requestedProviderId,
    modelProviders: options.modelProviders,
    nativeConfig: options.nativeConfig,
    allowNetwork: options.allowNetwork === true,
    allowAllDirectories: options.allowAllDirectories === true,
    allowTerminal: options.allowTerminal === true,
  });
  return {
    runtimeRoot,
    dirs,
    config,
    env: {
      ...(options.env || process.env),
      HOME: dirs.home,
      USERPROFILE: dirs.home,
      XDG_CONFIG_HOME: dirs.config,
      XDG_DATA_HOME: dirs.data,
      XDG_STATE_HOME: dirs.state,
      XDG_CACHE_HOME: dirs.cache,
      // serve 模式下 client 不是 app/cli/desktop，question 工具默认被剔除；显式开启模型才能发起提问
      OPENCODE_ENABLE_QUESTION_TOOL: '1',
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    },
  };
}

export function getBundledOpenCodeModelRef(model = '') {
  return `${OPENCODE_PROVIDER_ID}/${normalizeModel(model)}`;
}

export function createBundledOpenCodeTaskId() {
  return `opencode-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}
