import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';

const OPENCODE_PROVIDER_ID = 'crystelf-chat';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeBaseApi(value = '') {
  return normalizeText(value).replace(/\/+$/, '');
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

function buildOpenCodePermissions(writeMode = false, options = {}) {
  const fullAccess = options.fullAccess === true;
  const allowNetwork = fullAccess || options.allowNetwork === true;
  const allowAllDirectories = fullAccess || options.allowAllDirectories === true;
  const allowTerminal = writeMode && (fullAccess || options.allowTerminal === true);
  return {
    external_directory: allowAllDirectories ? 'allow' : 'deny',
    bash: fullAccess ? 'allow' : (allowTerminal ? 'ask' : 'deny'),
    webfetch: allowNetwork ? 'allow' : 'deny',
    websearch: allowNetwork ? 'allow' : 'deny',
    edit: writeMode ? 'allow' : 'deny',
    write: writeMode ? 'allow' : 'deny',
  };
}

function buildOpenCodeConfig(aiConfig = {}, requestedModel = '', options = {}) {
  const customApi = options.customApi?.enabled === true ? options.customApi : {};
  const apiSource = Object.keys(customApi).length ? customApi : aiConfig;
  const baseApi = normalizeBaseApi(apiSource.baseApi);
  const apiKey = normalizeText(apiSource.apiKey);
  const model = normalizeModel(requestedModel || apiSource.model || apiSource.modelType || aiConfig.modelType || aiConfig.workingModel);
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
  const nativeConfig = options.nativeConfig && typeof options.nativeConfig === 'object' ? options.nativeConfig : {};
  return {
    '$schema': 'https://opencode.ai/config.json',
    model: `${OPENCODE_PROVIDER_ID}/${model}`,
    small_model: `${OPENCODE_PROVIDER_ID}/${model}`,
    permission: buildOpenCodePermissions(options.writeMode === true, {
      fullAccess: options.fullAccess === true,
      allowNetwork: options.allowNetwork === true,
      allowAllDirectories: options.allowAllDirectories === true,
      allowTerminal: options.allowTerminal === true,
    }),
    provider: {
      [OPENCODE_PROVIDER_ID]: {
        npm: '@ai-sdk/openai-compatible',
        name: customApi.enabled === true ? '魔丸自定义 Agent API' : '魔丸默认聊天 API',
        options: {
          baseURL: baseApi,
          apiKey,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        },
        models: {
          [model]: modelConfig,
        },
      },
    },
    ...(Object.keys(nativeConfig.agent || {}).length ? { agent: nativeConfig.agent } : {}),
    ...(Object.keys(nativeConfig.command || {}).length ? { command: nativeConfig.command } : {}),
    ...(Object.keys(nativeConfig.mcp || {}).length ? { mcp: nativeConfig.mcp } : {}),
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
