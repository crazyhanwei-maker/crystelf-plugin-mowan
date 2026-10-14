// 内置 ZCode 运行时（第二个可选 Agent 后端，接口镜像 bundledOpenCodeRuntime.js）。
// 上游：zai-org/ZCode v3.14.3（定版，不追上游）；产物为 dist/zcode.cjs + provider 资产，
// 由 scripts/build-zcode-runtime.mjs 构建到 Path.data 下的运行时目录（仓库外，天然不进 git）。
//
// 与 OpenCode 运行时的两点结构性差异（调研结论，见 zcode-upstream-research.md）：
// 1. OpenCode 走 `serve` 常驻 HTTP 服务；ZCode 走一次性 `-p --output-format stream-json` 子进程。
// 2. ZCode 不支持经环境变量读 API key，key 只能写入 provider_config.json（明文）。
//    因此 key 的传递收敛为：灵晶配置 → 内存生成每任务配置文件（任务成功后删除），
//    环境变量只传文件路径；key 不进 env、不进日志、不进事件流。
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import Path from '../../constants/path.js';
import { normalizeAiProtocol } from '../../modules/openai/protocolAdapter.js';

const ZCODE_VERSION = '3.14.3';
const ZCODE_PROVIDER_ID = 'crystelf-chat';
// 产物 esbuild target=node22；低于该大版本的宿主 Node 无法保证可运行
const ZCODE_NODE_MIN_MAJOR = 22;
// 单行 NDJSON 上限：超过即判定为异常输出，丢弃该行防止刷爆内存
const ZCODE_MAX_LINE_CHARS = 1024 * 1024;
// 聚合上限：最终回复文本与文件变更清单的截断阈值
const ZCODE_MAX_OUTPUT_CHARS = 64 * 1024;
const ZCODE_MAX_FILE_CHANGES = 200;
const ZCODE_MAX_STDERR_CHARS = 8 * 1024;
const ZCODE_DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

// 权限档 → CLI 参数（调研结论：headless 下 `--mode build` 的 ask 无应答面会被全拒，
// 因此"受控写入"由 edit 档承载；yolo 仅在 allowFullAccess 显式开启时可用）。
// disallowTools 在上游是注册级过滤（工具不注册、模型不可见），与权限档双重生效。
const ZCODE_PLAN_DISALLOWED_TOOLS = ['WebSearch', 'Agent', 'Task'];
const ZCODE_BUILD_DISALLOWED_TOOLS = ['Bash', 'WebFetch', 'WebSearch'];

// 事件载荷截断阈值：工具入参/结果预览进事件流前先裁剪，防单条刷爆 QQ 消息
const ZCODE_MAX_EVENT_PREVIEW_CHARS = 2 * 1024;
// runZcodeTask 返回值里保留的事件副本上限（实时事件仍逐条回调，不受此限）
const ZCODE_MAX_RETAINED_EVENTS = 1000;

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function normalizeBaseApi(value = '') {
  return normalizeText(value).replace(/\/+$/, '');
}

// ZCode 与 OpenCode 的 anthropic baseURL 语义一致（上游 model-execution.ts 的归一化同款）：
// 请求打到 {baseURL}/v1/messages，因此 anthropic 协议的地址统一归一成以 /v1 结尾。
function buildAnthropicBase(baseUrl = '') {
  const base = normalizeBaseApi(baseUrl);
  if (!base) return base;
  if (/\/v1$/i.test(base)) return base;
  return `${base}/v1`;
}

function normalizeUserAgent(value = '') {
  return normalizeText(value).replace(/[\r\n]/g, '').slice(0, 200);
}

function normalizeModel(value = '') {
  return normalizeText(value).replace(/[^A-Za-z0-9._:/-]/g, '').slice(0, 160) || 'glm-5.3-flash';
}

// 截断到指定长度并标注，事件流/聚合输出统一走这里
function truncateText(value, limit) {
  const text = String(value ?? '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…[已截断 ${text.length - limit} 字符]`;
}

// 自定义供应商 id：ascii 残段 + 名称哈希，与 OpenCode 运行时同构，保证中文名不撞车
function modelProviderSlug(name = '') {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  let hash = 5381;
  for (const ch of String(name || '')) hash = ((hash << 5) + hash + ch.codePointAt(0)) >>> 0;
  return `${slug || 'p'}-${hash.toString(36)}`;
}

export function getBundledZcodeRuntimeRoot(options = {}) {
  return path.resolve(options.runtimeRoot || path.join(Path.data, 'agent-cli-runtime', 'zcode'));
}

export function getBundledZcodeStateRoot(options = {}) {
  return path.resolve(options.stateRoot || path.join(Path.data, 'agent-cli-runtime', 'zcode-state'));
}

// 产物完整性：zcode.cjs + manifest + builtin 供应商配置三者齐备才算可用；
// 任一缺失返回 null，由 Agent 工作台引导构建/下载（与 resolveBundledOpenCodeCommand 同构）。
export function resolveBundledZcodeCommand(options = {}) {
  const runtimeRoot = getBundledZcodeRuntimeRoot(options);
  const entry = path.join(runtimeRoot, 'runtime', 'zcode.cjs');
  const manifestPath = path.join(runtimeRoot, 'manifest.json');
  const builtinConfig = path.join(runtimeRoot, 'runtime', 'provider', 'zcode-builtin.json');
  if (!fs.existsSync(entry) || !fs.existsSync(manifestPath) || !fs.existsSync(builtinConfig)) {
    return null;
  }
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    manifest = null;
  }
  const version = normalizeText(manifest?.version) || ZCODE_VERSION;
  const nodeMajor = Number(String(process.versions.node || '0').split('.')[0]);
  const nodeSupported = Number.isFinite(nodeMajor) && nodeMajor >= ZCODE_NODE_MIN_MAJOR;
  return {
    command: entry,
    // zcode.cjs 是 CJS bundle，用宿主 Node 执行；baseArgs 为空与 OpenCode 对齐
    baseArgs: [],
    source: 'plugin-zcode-runtime',
    version,
    nodeSupported,
    nodeRequirement: `>=${ZCODE_NODE_MIN_MAJOR}`,
    builtinConfig,
  };
}

// 手动模型规则只写上游 personal 层 schema 明确开放的叶子（manualModelConfigSchema 白名单）。
// 字段完整性为硬约束（decode 失败会让注册表静默降级为空，报 "Select a model before continuing"）：
// - properties 必填（contextWindow 给默认值，vision 可覆盖 inputFormat.supportsImage）
// - optionSpecs.reasoningLevel 与 optionSpecs.maxOutputTokens.max 必填；
//   reasoningLevel 枚举显式声明后，defaultModelSelection.options.reasoningLevel 的校验才有依据
const ZCODE_REASONING_LEVELS = ['disabled', 'enabled'];
const ZCODE_DEFAULT_CONTEXT_WINDOW = 200000;
const ZCODE_DEFAULT_MAX_OUTPUT_TOKENS = 32000;

function buildManualModelRule(providerId, modelId, options = {}) {
  const contextWindow = Math.max(1, Math.round(Number(options.contextWindow) || ZCODE_DEFAULT_CONTEXT_WINDOW));
  const maxOutputTokens = Math.max(1, Math.round(Number(options.maxOutputTokens) || ZCODE_DEFAULT_MAX_OUTPUT_TOKENS));
  // properties 的布尔叶子与 inputFormat 三项都是 decode 必填，缺一个整份配置就作废
  const properties = {
    contextWindow,
    supportsJsonSchemaOutput: false,
    supportsNativeWebSearch: false,
    supportsMidConversationSystem: false,
    inputFormat: {
      supportsImage: options.vision === true,
      supportsVideo: false,
      supportsPdf: false,
    },
  };
  return {
    providerId,
    modelId,
    config: {
      enabled: true,
      properties,
      optionSpecs: {
        reasoningLevel: { values: [...ZCODE_REASONING_LEVELS], map: '{}' },
        maxOutputTokens: { max: maxOutputTokens },
      },
    },
  };
}

// 灵晶 AI 配置 → ZCode personal provider 配置（schemaVersion:1，见上游 provider-config-file-codec.ts）。
// 供应商 id 固定 crystelf-chat，与 OpenCode 运行时一致；工作台自定义供应商列表全部声明进去。
export function buildZcodeConfig(aiConfig = {}, requestedModel = '', options = {}) {
  const customApi = options.customApi?.enabled === true ? options.customApi : {};
  const apiSource = Object.keys(customApi).length ? customApi : aiConfig;
  const baseApi = normalizeBaseApi(apiSource.baseApi);
  const apiKey = normalizeText(apiSource.apiKey);
  const requestedProviderId = normalizeText(options.requestedProviderId || '').toLowerCase();
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
      ? 'Agent 自定义 API 地址未配置，无法启动内置 ZCode'
      : 'AI 主对话 API 地址未配置，无法启动内置 ZCode');
    error.code = customApi.enabled === true ? 'AGENT_CUSTOM_API_MISSING' : 'AGENT_CHAT_API_MISSING';
    throw error;
  }
  if (!apiKey) {
    const error = new Error(customApi.enabled === true
      ? 'Agent 自定义 API 密钥未配置，无法启动内置 ZCode'
      : 'AI 主对话 API 密钥未配置，无法启动内置 ZCode');
    error.code = customApi.enabled === true ? 'AGENT_CUSTOM_API_KEY_MISSING' : 'AGENT_CHAT_API_KEY_MISSING';
    throw error;
  }

  // 接入协议跟随主对话 API；anthropic 的地址归一成以 /v1 结尾（见 buildAnthropicBase 注释）
  const protocol = normalizeAiProtocol(apiSource.apiProtocol || aiConfig.apiProtocol);
  const apiType = protocol === 'anthropic' ? 'anthropic-messages' : 'openai-chat-completions';
  const apiConfig = {
    type: apiType,
    baseUrl: protocol === 'anthropic' ? buildAnthropicBase(baseApi) : baseApi,
  };
  const userAgent = normalizeUserAgent(apiSource.userAgent || aiConfig.userAgent);
  if (userAgent) apiConfig.headers = { 'User-Agent': userAgent };

  const defaultProvider = {
    providerId: ZCODE_PROVIDER_ID,
    enabled: true,
    config: {
      group: 'standard-personal',
      access: { type: 'api-key', apiKey },
      api: apiConfig,
      personalModelIds: [model],
      modelOrder: [model],
    },
  };
  const customRules = modelProviders.reduce((rules, item) => {
    const providerId = `custom-${modelProviderSlug(item.name)}`;
    const providerProtocol = normalizeAiProtocol(item.apiProtocol || apiSource.apiProtocol || aiConfig.apiProtocol);
    const providerModels = item.models
      .map(entry => normalizeModel(typeof entry === 'string' ? entry : entry?.name))
      .filter(Boolean);
    rules.push({
      providerId,
      enabled: true,
      config: {
        group: 'standard-personal',
        access: { type: 'api-key', apiKey: normalizeText(item.apiKey) },
        api: {
          type: providerProtocol === 'anthropic' ? 'anthropic-messages' : 'openai-chat-completions',
          baseUrl: providerProtocol === 'anthropic' ? buildAnthropicBase(item.baseApi) : normalizeBaseApi(item.baseApi),
        },
        personalModelIds: providerModels,
        modelOrder: providerModels,
      },
    });
    return rules;
  }, []);

  // 默认模型选择：任务指定自定义供应商时指向它，否则指向主供应商；
  // reasoningLevel 必填（模型声明了枚举时上游校验强制），默认取 enabled
  const selectionProvider = selectedCustomProvider
    ? `custom-${modelProviderSlug(selectedCustomProvider.name)}`
    : ZCODE_PROVIDER_ID;
  const requestedLevel = normalizeText(options.reasoningLevel).toLowerCase();
  const reasoningLevel = ZCODE_REASONING_LEVELS.includes(requestedLevel) ? requestedLevel : 'enabled';
  const manualRules = [buildManualModelRule(selectionProvider, model, {
    contextWindow: options.contextWindow,
    vision: options.vision,
    maxOutputTokens: options.maxOutputTokens,
  })];

  return {
    schemaVersion: 1,
    config: {
      providerOrder: [selectionProvider],
      providerConfigRules: {
        providerRules: [defaultProvider, ...customRules],
      },
      modelConfigRules: {
        // providerModelRules 为必填数组（personal 层 schema strict），无智能规则时给空数组
        providerModelRules: [],
        manualProviderModelRules: manualRules,
      },
      defaultModelSelection: {
        providerId: selectionProvider,
        modelId: model,
        options: { reasoningLevel },
      },
    },
  };
}

function createRuntimeDirectories(stateRoot) {
  const dirs = {
    state: stateRoot,
    home: path.join(stateRoot, 'home'),
    data: path.join(stateRoot, 'data'),
    storage: path.join(stateRoot, 'storage'),
    log: path.join(stateRoot, 'log'),
    config: path.join(stateRoot, 'config'),
  };
  for (const directory of Object.values(dirs)) fs.mkdirSync(directory, { recursive: true });
  return dirs;
}

// 上游不支持 XDG；状态隔离靠这组 ZCODE_* 变量（调研 §3.3 的完整清单）。
// 会话库与日志默认固定在 ~/.zcode 下，必须逐个显式重定向。
// 继承的宿主 env 会剔除 ZCODE_*/OPENCODE_* 命名空间，防止外部变量污染沙箱。
export function buildBundledZcodeEnvironment(options = {}) {
  const runtimeRoot = getBundledZcodeRuntimeRoot(options);
  const resolved = resolveBundledZcodeCommand({ ...options, runtimeRoot });
  if (!resolved) {
    const error = new Error('内置 ZCode 运行时缺失或不完整，请先在控制台构建运行时');
    error.code = 'AGENT_ZCODE_RUNTIME_MISSING';
    throw error;
  }
  if (resolved.nodeSupported === false) {
    const error = new Error(`宿主 Node 版本过低（${process.versions.node}），内置 ZCode 要求 Node ${resolved.nodeRequirement}`);
    error.code = 'AGENT_ZCODE_NODE_UNSUPPORTED';
    throw error;
  }
  // per-task 配置目录：personal 配置内含明文 key，任务成功后由 runZcodeTask 删除
  const taskId = normalizeText(options.taskId) || createBundledZcodeTaskId();
  const stateRoot = path.join(getBundledZcodeStateRoot(options), 'tasks', taskId);
  const dirs = createRuntimeDirectories(stateRoot);
  const config = buildZcodeConfig(options.aiConfig, options.model, {
    customApi: options.customApi,
    requestedProviderId: options.requestedProviderId,
    modelProviders: options.modelProviders,
    allowNetwork: options.allowNetwork === true,
    contextWindow: options.contextWindow,
    vision: options.vision,
    maxOutputTokens: options.maxOutputTokens,
  });
  const personalConfigPath = path.join(dirs.config, 'provider_config.json');
  fs.writeFileSync(personalConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const baseEnv = options.env || process.env;
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (key.startsWith('ZCODE_') || key.startsWith('OPENCODE_')) continue;
    env[key] = value;
  }
  env.HOME = dirs.home;
  env.USERPROFILE = dirs.home;
  env.ZCODE_DATA_BASE_DIR = dirs.data;
  env.ZCODE_STORAGE_DIR = dirs.storage;
  env.ZCODE_SESSION_DB_PATH = path.join(stateRoot, 'zcode-sessions.sqlite');
  env.ZCODE_LOG_DIR = dirs.log;
  env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = resolved.builtinConfig;
  env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = personalConfigPath;
  env.ZCODE_RUNTIME_ENV = 'production';
  // 随包搜索二进制（可选）：rg 缺失只影响搜索类工具，不阻断 -p 主链路
  const rgBinary = path.join(runtimeRoot, 'tools', process.platform === 'win32' ? 'rg.exe' : 'rg');
  if (fs.existsSync(rgBinary)) env.ZCODE_RG_BINARY = rgBinary;
  return {
    runtimeRoot,
    stateRoot,
    dirs,
    config,
    env,
    taskId,
    personalConfigPath,
    builtinConfigPath: resolved.builtinConfig,
    runtime: resolved,
  };
}

export function createBundledZcodeTaskId() {
  return `zcode-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

// 强杀子进程树：Windows 用 taskkill /T（含 detached 孙进程），Linux 用进程组信号（spawn detached）。
// 上游对 SIGTERM/SIGKILL 的收尾是安全的：文件写入原子化、SQLite WAL 随进程死亡释放锁。
function killZcodeProcessTree(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) {
      resolve(child?.exitCode ?? null);
      return;
    }
    let settled = false;
    const finish = code => {
      if (settled) return;
      settled = true;
      clearTimeout(guardTimer);
      resolve(code);
    };
    const guardTimer = setTimeout(() => finish(null), 5000);
    try {
      child.once('exit', code => finish(code));
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('exit', () => finish(null));
        killer.once('error', () => finish(null));
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // 进程组已不存在则忽略
        }
      }
      try {
        child.kill('SIGKILL');
      } catch {
        // 进程已退出则忽略
      }
    } catch {
      finish(null);
    }
  });
}

function mapPermissionMode(permissionMode, options = {}) {
  const mode = normalizeText(permissionMode).toLowerCase() || 'plan';
  if (mode === 'plan') {
    return {
      cliMode: 'plan',
      disallowedTools: options.allowNetwork === true
        ? [...ZCODE_PLAN_DISALLOWED_TOOLS]
        : [...ZCODE_PLAN_DISALLOWED_TOOLS, 'WebFetch'],
    };
  }
  if (mode === 'build') {
    return { cliMode: 'edit', disallowedTools: [...ZCODE_BUILD_DISALLOWED_TOOLS] };
  }
  if (mode === 'full') {
    if (options.allowFullAccess !== true) {
      const error = new Error('ZCode 完全权限档未在控制台显式开启，拒绝启动');
      error.code = 'AGENT_ZCODE_FULL_ACCESS_DISABLED';
      throw error;
    }
    return { cliMode: 'yolo', disallowedTools: [] };
  }
  const error = new Error(`不支持的 ZCode 权限档：${mode}（支持 plan/build/full）`);
  error.code = 'AGENT_ZCODE_PERMISSION_MODE_INVALID';
  throw error;
}

// 并发上限 1：运行时模块自身兜底（工作台侧另有任务队列），并发第二个任务直接拒绝
const activeZcodeTasks = new Map();

function assertWorkspaceDir(workspaceDir) {
  const workspace = normalizeText(workspaceDir);
  if (!path.isAbsolute(workspace)) {
    const error = new Error('workspaceDir 必须是绝对路径');
    error.code = 'AGENT_ZCODE_WORKSPACE_INVALID';
    throw error;
  }
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    const error = new Error(`workspaceDir 不存在或不是目录：${workspace}`);
    error.code = 'AGENT_ZCODE_WORKSPACE_INVALID';
    throw error;
  }
  return path.resolve(workspace);
}

// 上游 CLI 会从 --cwd 逐级向上查找 .env（override:false）。工作区预置空 .env 阻断向上查找，
// 防止任务读到 Yunzai 根目录等上层配置；工作区已有 .env 时不动（查找本就会停在那里）。
function ensureWorkspaceEnvBlock(workspaceDir) {
  const envFile = path.join(workspaceDir, '.env');
  if (fs.existsSync(envFile)) return false;
  fs.writeFileSync(envFile, '# crystelf zcode runtime: 阻断 CLI 向上查找 .env\n', 'utf8');
  return true;
}

function resolveWorkspacePath(workspaceDir, value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspaceDir, raw);
}

// stream-json 单行 → onEvent 事件；返回值用于内部聚合（sessionId/filesChanged/文本）
function mapStreamEvent(line, workspaceDir) {
  let event = null;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!event || typeof event !== 'object') return null;
  const type = event.type;
  if (type === 'result') return { kind: 'result', event };
  if (type === 'session.created') {
    return { kind: 'sessionId', sessionId: String(event.sessionId || '') };
  }
  if (type === 'model.streaming') {
    const payload = event.payload || {};
    if (payload.kind === 'text_delta' && payload.delta) {
      return { kind: 'emit', event: { type: 'text', text: truncateText(payload.delta, ZCODE_MAX_EVENT_PREVIEW_CHARS) } };
    }
    return null;
  }
  if (type === 'tool.updated') {
    const payload = event.payload || {};
    const toolName = String(payload.toolName || '');
    if (payload.kind === 'scheduled') {
      const input = payload.input && typeof payload.input === 'object' ? payload.input : {};
      if (toolName === 'Write' || toolName === 'Edit') {
        const file = resolveWorkspacePath(workspaceDir, input.file_path || input.path);
        return { kind: 'fileChange', file, emit: { type: 'file_edit', file, toolName } };
      }
      if (toolName === 'Bash') {
        return { kind: 'emit', event: { type: 'command_exec', command: truncateText(input.command, ZCODE_MAX_EVENT_PREVIEW_CHARS) } };
      }
      return {
        kind: 'emit',
        event: { type: 'tool_call', toolName, input: truncateText(JSON.stringify(input), ZCODE_MAX_EVENT_PREVIEW_CHARS) },
      };
    }
    if (payload.kind === 'result' || payload.kind === 'error') {
      const summary = payload.kind === 'error' ? payload.error : payload.result;
      return {
        kind: 'emit',
        event: {
          type: 'tool_result',
          toolName,
          ok: payload.kind !== 'error',
          summary: truncateText(typeof summary === 'string' ? summary : JSON.stringify(summary), ZCODE_MAX_EVENT_PREVIEW_CHARS),
        },
      };
    }
    return null;
  }
  if (type === 'permission.requested') {
    const payload = event.payload || {};
    return {
      kind: 'emit',
      event: { type: 'permission_request', toolName: payload.toolName, reason: truncateText(payload.reason, ZCODE_MAX_EVENT_PREVIEW_CHARS) },
    };
  }
  if (type === 'turn.failed') {
    const payload = event.payload || {};
    const message = payload.error?.message || payload.error || 'ZCode 回合失败';
    return { kind: 'turnError', message: truncateText(String(message), ZCODE_MAX_STDERR_CHARS) };
  }
  return null;
}

// 冷启动竞态特征：注册表尚未加载个人供应商层（配置文件刚落盘、AV/FS 首开延迟），
// 模型选择解析为空。出现该签名时换新任务目录整体重试一次。
const ZCODE_SELECTION_RACE_PATTERN = /Select a model before continuing/;

export async function runZcodeTask(options = {}) {
  // 首试不接 onEvent（事件留在返回值里）：命中竞态时静默重试，避免 UI 收到两段事件流；
  // 未命中则把首试事件按原序回放，事件语义与单次执行完全一致
  const first = await runZcodeTaskAttempt({ ...options, onEvent: undefined });
  if (first.ok || !ZCODE_SELECTION_RACE_PATTERN.test(String(first.error || ''))) {
    if (typeof options.onEvent === 'function') {
      for (const event of first.events) {
        await options.onEvent(event);
      }
    }
    return first;
  }
  try {
    fs.rmSync(first.stateRoot, { recursive: true, force: true });
  } catch {
    // 清理失败不影响重试
  }
  return await runZcodeTaskAttempt(options);
}

async function runZcodeTaskAttempt(options = {}) {
  const prompt = normalizeText(options.prompt);
  if (!prompt) {
    const error = new Error('prompt 不能为空');
    error.code = 'AGENT_ZCODE_PROMPT_EMPTY';
    throw error;
  }
  if (activeZcodeTasks.size > 0) {
    const error = new Error('已有 ZCode 任务在运行，请等待完成后再试');
    error.code = 'AGENT_ZCODE_TASK_BUSY';
    throw error;
  }
  const workspaceDir = assertWorkspaceDir(options.workspaceDir);
  const permission = mapPermissionMode(options.permissionMode, options);
  const startedAt = Date.now();
  // 运行时缺失/Node 版本过低在 buildBundledZcodeEnvironment 内抛可区分错误
  const bundled = buildBundledZcodeEnvironment(options);
  const taskId = bundled.taskId;
  const envBlockCreated = ensureWorkspaceEnvBlock(workspaceDir);

  const events = [];
  const emitEvent = async event => {
    if (events.length < ZCODE_MAX_RETAINED_EVENTS) events.push(event);
    if (typeof options.onEvent === 'function') {
      await options.onEvent(event);
    }
  };

  const args = [
    bundled.runtime.command,
    '-p', prompt,
    '--mode', permission.cliMode,
    '--output-format', 'stream-json',
    '--cwd', workspaceDir,
  ];
  if (permission.disallowedTools.length > 0) {
    args.push('--disallowedTools', ...permission.disallowedTools);
  }

  const child = spawn(process.execPath, args, {
    cwd: workspaceDir,
    env: bundled.env,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const task = {
    taskId,
    child,
    aborted: false,
    timeout: null,
    finished: false,
  };
  activeZcodeTasks.set(taskId, task);

  const finishTask = async payload => {
    if (task.finished) return payload;
    task.finished = true;
    if (task.timeout) clearTimeout(task.timeout);
    activeZcodeTasks.delete(taskId);
    // 阻断文件不含任何有用信息，无论成败都清掉；含 key 的状态目录仅成功时清（失败保留现场）
    if (envBlockCreated) {
      try {
        fs.rmSync(path.join(workspaceDir, '.env'), { force: true });
      } catch {
        // 清理失败不影响任务结果
      }
    }
    if (payload.ok) {
      // personal 配置内含明文 key：成功任务即时删除 per-task 状态目录
      // （Windows 下 SQLite WAL 句柄可能晚于 exit 释放，重试几次再放弃）
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          fs.rmSync(bundled.stateRoot, { recursive: true, force: true });
          break;
        } catch {
          if (attempt === 2) break;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }
    const result = { ...payload, taskId, sessionId: payload.sessionId || sessionId || '' };
    await emitEvent({ type: 'done', ...result });
    return result;
  };

  let sessionId = '';
  let abortError = '';
  let timeoutError = '';
  let turnErrorMessage = '';
  const stderrTail = [];
  const filesChanged = [];
  const seenFiles = new Set();
  const textParts = [];
  let resultLine = null;

  const pushStderr = chunk => {
    stderrTail.push(truncateText(chunk, ZCODE_MAX_STDERR_CHARS));
    while (stderrTail.join('').length > ZCODE_MAX_STDERR_CHARS && stderrTail.length > 1) {
      stderrTail.shift();
    }
  };

  const stdoutState = { buffer: '', overflow: false };
  // stdout 行处理是异步的（onEvent 回调可能 await）：用 promise 链串行化，保证事件顺序
  let stdoutChain = Promise.resolve();
  const handleStdoutLine = async line => {
    if (stdoutState.overflow) {
      stdoutState.overflow = false;
      return;
    }
    if (!line) return;
    const mapped = mapStreamEvent(line, workspaceDir);
    if (!mapped) return;
    if (mapped.kind === 'sessionId') {
      sessionId = mapped.sessionId;
      return;
    }
    if (mapped.kind === 'result') {
      resultLine = mapped.event;
      return;
    }
    if (mapped.kind === 'turnError') {
      turnErrorMessage = mapped.message;
      await emitEvent({ type: 'error', message: mapped.message });
      return;
    }
    if (mapped.kind === 'fileChange') {
      if (mapped.file && !seenFiles.has(mapped.file) && filesChanged.length < ZCODE_MAX_FILE_CHANGES) {
        seenFiles.add(mapped.file);
        filesChanged.push(mapped.file);
      }
      await emitEvent(mapped.emit);
      return;
    }
    if (mapped.kind === 'emit' && mapped.event.type === 'text') {
      if (textParts.join('').length < ZCODE_MAX_OUTPUT_CHARS) textParts.push(mapped.event.text);
    }
    if (mapped.kind === 'emit') {
      await emitEvent(mapped.event);
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdoutState.buffer += chunk;
    while (stdoutState.buffer.length > 0) {
      const index = stdoutState.buffer.indexOf('\n');
      if (index < 0) {
        if (stdoutState.buffer.length > ZCODE_MAX_LINE_CHARS) {
          stdoutState.buffer = '';
          stdoutState.overflow = true;
        }
        break;
      }
      const line = stdoutState.buffer.slice(0, index).replace(/\r$/, '');
      stdoutState.buffer = stdoutState.buffer.slice(index + 1);
      stdoutChain = stdoutChain.then(() => handleStdoutLine(line)).catch(() => {});
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', pushStderr);
  // stdout 流结束时排空残 buffer（无换行结尾的最后一行）
  child.stdout.once('end', () => {
    if (!stdoutState.buffer || stdoutState.overflow) return;
    const line = stdoutState.buffer.replace(/\r$/, '');
    stdoutState.buffer = '';
    stdoutChain = stdoutChain.then(() => handleStdoutLine(line)).catch(() => {});
  });

  const timeoutMs = Math.max(1000, Math.round(Number(options.timeoutMs) || ZCODE_DEFAULT_TIMEOUT_MS));
  task.timeout = setTimeout(() => {
    timeoutError = `ZCode 任务超时（${Math.round(timeoutMs / 1000)}s），已强制终止进程树`;
    killZcodeProcessTree(child);
  }, timeoutMs);

  // 用 close 而不是 exit 结算：close 在 stdio 流全部关闭后触发，保证最后一批输出已送达
  const exitPromise = new Promise(resolve => {
    child.once('error', error => resolve({ spawnError: error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const exit = await exitPromise;
  // 先等 stdout 事件链排空（异步 onEvent 可能滞后），再结算任务结果
  await stdoutChain;

  let spawnErrorMessage = exit.spawnError ? String(exit.spawnError.message) : '';
  if (task.aborted) abortError = 'ZCode 任务已被手动中止';
  const ok = !spawnErrorMessage && !abortError && !timeoutError && exit.code === 0 && resultLine !== null;
  const errorParts = [spawnErrorMessage, abortError, timeoutError, turnErrorMessage].filter(Boolean);
  if (!ok && errorParts.length === 0) {
    errorParts.push(exit.code === 0
      ? 'ZCode 进程退出但未输出结果行'
      : `ZCode 进程退出码 ${exit.code}${exit.signal ? `（信号 ${exit.signal}）` : ''}`);
  }
  const stderrText = stderrTail.join('').trim();
  if (!ok && stderrText) errorParts.push(truncateText(stderrText, ZCODE_MAX_STDERR_CHARS));

  const response = resultLine && typeof resultLine.response === 'string' && resultLine.response.trim()
    ? resultLine.response
    : textParts.join('');
  return await finishTask({
    ok,
    sessionId: resultLine?.sessionId || sessionId,
    output: truncateText(response, ZCODE_MAX_OUTPUT_CHARS),
    filesChanged: [...filesChanged],
    error: ok ? null : errorParts.join('；') || 'ZCode 任务失败',
    usage: resultLine?.usage || null,
    durationMs: Date.now() - startedAt,
    stateRoot: bundled.stateRoot,
    events,
  });
}

export async function abortZcodeTask(taskId) {
  const task = activeZcodeTasks.get(String(taskId || ''));
  if (!task) return false;
  task.aborted = true;
  await killZcodeProcessTree(task.child);
  return true;
}
