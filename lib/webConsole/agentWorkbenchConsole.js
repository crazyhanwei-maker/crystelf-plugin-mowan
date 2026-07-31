import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
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
const AGENT_OUTPUT_LIMIT = 160000;
const AGENT_EVENT_LIMIT = 80;
const PROVIDER_PROBE_TTL_MS = 30000;
const PROVIDER_PROBE_TIMEOUT_MS = 8000;
const PROVIDER_BOOTSTRAP_TIMEOUT_MS = 120000;
const GIT_STATUS_TIMEOUT_MS = 10000;
const AGENT_DIFF_LIMIT = 120000;
const AGENT_PERMISSION_LIMIT = 30;
const AGENT_QUESTION_LIMIT = 12;
const AGENT_STREAM_HEARTBEAT_MS = 15000;
const AGENT_TERMINAL_LIMIT = 6;
const AGENT_TERMINAL_OUTPUT_LIMIT = 120000;
const AGENT_ATTACHMENT_LIMIT = 4;
const AGENT_ATTACHMENT_BYTES_LIMIT = 5 * 1024 * 1024;

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
  if (mode === 'edit') return 'edit';
  return mode === 'patch' ? 'patch' : 'analyze';
}

function isWriteMode(mode = '') {
  return normalizeMode(mode) === 'edit';
}

function normalizeModel(value = '') {
  const model = String(value || '').trim();
  if (!model) return '';
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(model)) {
    throw createHttpError(400, '模型名称只能包含字母、数字、点、斜杠、冒号、下划线和短横线', 'AGENT_MODEL_INVALID');
  }
  return model;
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

function extractOpenCodeMessageId(value = '') {
  const matches = String(value || '').match(/"messageID"\s*:\s*"(msg_[A-Za-z0-9]+)"/g) || [];
  return matches.length ? normalizeOpenCodeMessageId(matches.at(-1)?.match(/msg_[A-Za-z0-9]+/)?.[0]) : '';
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

function redactAgentText(value = '') {
  return stripAnsi(value)
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
      if (partType === 'text' && content.trim()) textParts.push(content.trim());
      if (partType === 'reasoning' && content.trim()) reasoningParts.push(content.trim());
      if (partType === 'tool') {
        tools.push({
          id: normalizeSingleLine(part?.id || item?.id || '', 120),
          name: normalizeSingleLine(part?.tool || part?.name || item?.tool || '工具调用', 120),
          status: normalizeSingleLine(part?.state?.status || part?.status || 'unknown', 40),
          input: redactAgentText(JSON.stringify(part?.state?.input ?? part?.input ?? {}, null, 2)).slice(0, 12000),
          output: redactAgentText(String(part?.state?.output ?? part?.output ?? '')).slice(0, 20000),
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
    tools: tools.slice(-60),
  };
}

function isPathInside(parentPath = '', targetPath = '') {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveExistingDirectory(targetPath = '') {
  try {
    const resolved = fs.realpathSync(path.resolve(String(targetPath || '')));
    return fs.statSync(resolved).isDirectory() ? resolved : '';
  } catch {
    return '';
  }
}

export function normalizeAgentWorkbenchConfig(value = {}) {
  return {
    enabled: value?.enabled === true,
    writeEnabled: value?.writeEnabled === true,
    allowNetwork: value?.allowNetwork === true,
    allowAllDirectories: value?.allowAllDirectories === true,
    allowTerminal: value?.allowTerminal === true,
    defaultProvider: normalizeProviderId(value?.defaultProvider),
    timeoutMs: clampInteger(value?.timeoutMs, 300000, 60000, 900000),
    maxConcurrentTasks: clampInteger(value?.maxConcurrentTasks, 1, 1, 2),
    providers: {
      opencode: value?.providers?.opencode !== false,
    },
    customApi: normalizeCustomAgentApi(value?.customApi),
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

function buildSafetyPrompt(mode, prompt, options = {}) {
  const allowNetwork = options.allowNetwork === true;
  const allowAllDirectories = options.allowAllDirectories === true;
  const directoryInstruction = allowAllDirectories
    ? '已授予全目录权限，可以访问当前工作目录以外的目录；仍不得访问密钥、Cookie、口令、运行日志、运行时数据和依赖目录。'
    : '严禁访问当前工作目录以外的路径。';
  const networkInstruction = allowNetwork
    ? '已授予联网权限，可以使用网页读取和搜索工具；严禁进行账号登录、上传隐私数据或修改远程系统。'
    : '联网工具已被禁用。';
  const terminalInstruction = options.allowTerminal === true
    ? '终端工具已启用，但每条命令都必须等待控制台中的人工审批。'
    : '终端命令已被禁用。';
  if (isWriteMode(mode)) {
    return [
      '你由魔丸控制台以受控代码修改模式调用。',
      '请直接在当前工作目录内创建或修改完成任务所需的文件，不要只给出补丁建议。',
      `${directoryInstruction} 严禁安装或删除依赖；严禁操作 Git、进程、服务、账户和系统配置。`,
      `${terminalInstruction}${networkInstruction} 只能使用已授权的工具完成任务。`,
      '完成后说明修改了哪些文件以及仍需人工验证的事项。',
      '',
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
    '',
    '用户任务：',
    prompt,
  ].join('\n');
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
  args.push(buildSafetyPrompt(mode, prompt, {
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

function getLatestOpenCodeAssistantOutput(messages = [], sessionId = '') {
  const items = Array.isArray(messages) ? messages : [];
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

async function startAttachedOpenCodeServer(executable, processEnv, workspacePath) {
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
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (spawnError) break;
    if (child.exitCode !== null) break;
    try {
      await requestOpenCodeJson(server, '/global/health', { timeoutMs: 800 });
      return server;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  }
  if (!child.killed) child.kill('SIGTERM');
  throw new Error(normalizeSingleLine(
    spawnError?.message || server.stderr || server.stdout || 'OpenCode 后台服务启动超时',
    800,
  ));
}

function stopAttachedOpenCodeServer(server) {
  if (server?.child && !server.child.killed && server.child.exitCode === null) {
    server.child.kill('SIGTERM');
  }
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

async function readGitChangeAudit(workspacePath = '') {
  const status = await readGitStatus(workspacePath);
  if (status === null) return { available: false, status: '', changedFiles: [], diffStat: '', diffText: '' };
  const [statResult, diffResult] = await Promise.all([
    runCapturedProcess('git', ['diff', 'HEAD', '--no-ext-diff', '--stat', '--'], {
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
  const changedFiles = parseGitChangedFiles(status);
  const untracked = changedFiles.filter(item => item.status === '??').map(item => item.path);
  const untrackedNote = untracked.length
    ? `\n\n未跟踪的新文件（Git diff 不包含内容）：\n${untracked.map(item => `- ${item}`).join('\n')}`
    : '';
  return {
    available: true,
    status,
    changedFiles,
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
    reasoning: redactAgentText(message.reasoning || '').slice(-30000),
    tools: Array.isArray(message.tools) ? message.tools.slice(-60).map(tool => ({
      id: tool.id || '',
      name: tool.name || '工具调用',
      status: tool.status || 'unknown',
      input: redactAgentText(tool.input || '').slice(-12000),
      output: redactAgentText(tool.output || '').slice(-20000),
    })) : [],
    attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, AGENT_ATTACHMENT_LIMIT).map(item => ({
      name: normalizeSingleLine(item.name || '附件', 180),
      mime: normalizeSingleLine(item.mime || 'application/octet-stream', 120),
      size: Math.max(0, Number(item.size || 0)),
    })) : [],
    createdAt: message.createdAt || '',
    finishedAt: message.finishedAt || '',
    elapsedMs: Math.max(0, Number(message.elapsedMs || 0)),
    mode: message.mode || '',
    status: message.status || '',
    error: redactAgentText(message.error || '').slice(-4000),
    stderrText: redactAgentText(message.stderrText || '').slice(-20000),
    changedFiles: Array.isArray(message.changedFiles) ? message.changedFiles.slice(0, 300) : [],
    diffStat: redactAgentText(message.diffStat || '').slice(-12000),
    diffText: redactAgentText(message.diffText || '').slice(-60000),
  };
}

function serializeTask(task = {}, options = {}) {
  const result = {
    id: task.id || '',
    opencodeSessionId: task.opencodeSessionId || '',
    title: task.title || '',
    providerId: task.providerId || '',
    providerLabel: task.providerLabel || '',
    workspaceId: task.workspaceId || '',
    workspaceLabel: task.workspaceLabel || '',
    mode: task.mode || 'analyze',
    model: task.model || '',
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
    prompt: redactAgentText(task.prompt || ''),
    promptPreview: task.promptPreview || '',
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
    outputText: redactAgentText(task.outputText || ''),
    stderrText: redactAgentText(task.stderrText || ''),
    error: redactAgentText(task.error || ''),
    workspaceChanged: task.workspaceChanged === true,
    gitCheckAvailable: task.gitCheckAvailable === true,
    gitCleanBefore: task.gitCleanBefore === true,
    changedFiles: Array.isArray(task.changedFiles) ? task.changedFiles.slice(0, 300) : [],
    diffStat: redactAgentText(task.diffStat || ''),
    diffText: redactAgentText(task.diffText || ''),
    events: Array.isArray(task.events) ? task.events.slice(-AGENT_EVENT_LIMIT) : [],
    command: Array.isArray(task.command) ? task.command : [],
  };
  if (options.includeMessages === true) {
    result.messages = Array.isArray(task.messages)
      ? task.messages.slice(-80).map(serializeAgentMessage)
      : [];
  }
  return result;
}

export function createAgentWorkbenchConsole(options = {}) {
  const ConfigControl = options.ConfigControl;
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
  const workspaceRuntimes = new Map();
  const terminals = new Map();

  function writeStreamEvent(res, eventName, payload) {
    if (res.writableEnded || res.destroyed) return false;
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
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
    return normalizeAgentWorkbenchConfig(ConfigControl?.get?.('coreConfig')?.tools?.agentWorkbench || {});
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
      });
      processEnv = buildAgentProcessEnv(bundledRuntime.env, { fallbackRoot: bundledRuntime.runtimeRoot });
      processEnv.OPENCODE_CONFIG_CONTENT = bundledRuntime.env.OPENCODE_CONFIG_CONTENT;
    }
    return processEnv;
  }

  async function getWorkspaceRuntime(workspaceId = '') {
    const config = getConfig();
    if (!config.enabled) throw createHttpError(403, 'Agent 工作台当前未启用', 'AGENT_WORKBENCH_DISABLED');
    const workspace = resolveAgentWorkspace(workspaceId, workspaceOptions);
    const existing = workspaceRuntimes.get(workspace.id);
    if (existing?.server?.child?.exitCode === null && !existing.server.child.killed) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    if (existing) workspaceRuntimes.delete(workspace.id);
    const processEnv = buildNativeOpenCodeEnvironment(config);
    const executable = resolveAgentProviderCommand('opencode', { env: processEnv });
    const server = await startAttachedOpenCodeServer(executable, processEnv, workspace.path);
    const runtime = { workspace, server, lastUsedAt: Date.now() };
    workspaceRuntimes.set(workspace.id, runtime);
    server.child.once('exit', () => {
      if (workspaceRuntimes.get(workspace.id)?.server === server) workspaceRuntimes.delete(workspace.id);
      for (const terminal of terminals.values()) {
        if (terminal.workspaceId !== workspace.id) continue;
        terminal.status = 'exited';
        terminal.updatedAt = new Date().toISOString();
      }
      emitWorkbenchUpdate('terminal', { workspaceId: workspace.id, terminals: listTerminals(workspace.id) });
    });
    return runtime;
  }

  async function requestWorkspaceOpenCode(workspaceId, pathname, options = {}) {
    const runtime = await getWorkspaceRuntime(workspaceId);
    runtime.lastUsedAt = Date.now();
    const separator = pathname.includes('?') ? '&' : '?';
    return await requestOpenCodeJson(runtime.server, `${pathname}${separator}directory=${encodeURIComponent(runtime.workspace.path)}`, options);
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
      let customApi;
      try {
        workspace = resolveAgentWorkspace(item.workspaceId, workspaceOptions);
        opencodeSessionId = normalizeOpenCodeSessionId(item.opencodeSessionId);
        model = normalizeModel(item.model);
        customApi = normalizeCustomAgentApi(item.customApi);
      } catch {
        continue;
      }
      const interrupted = item.status === 'pending' || item.status === 'running';
      const task = {
        id,
        opencodeSessionId,
        title: normalizeSingleLine(item.title || 'Agent 会话', 80),
        providerId: 'opencode',
        providerLabel: PROVIDER_DEFINITIONS.opencode.label,
        workspaceId: workspace.id,
        workspaceLabel: workspace.label,
        workspacePath: workspace.path,
        mode: normalizeMode(item.mode),
        model,
        customApi,
        allowNetwork: item.allowNetwork === true,
        allowAllDirectories: item.allowAllDirectories === true,
        allowTerminal: item.allowTerminal === true,
        pendingPermissions: [],
        pendingQuestions: [],
        currentAttachments: [],
        prompt: normalizePrompt(item.prompt),
        currentPrompt: normalizePrompt(item.prompt),
        promptPreview: normalizeSingleLine(item.promptPreview || item.prompt, 180),
        turnCount: Math.max(0, Number(item.turnCount || 0)),
        messages: Array.isArray(item.messages) ? item.messages.slice(-80).map(serializeAgentMessage) : [],
        writeConfirmed: item.writeConfirmed === true,
        timeoutMs: clampInteger(item.timeoutMs, config.timeoutMs, 60000, config.timeoutMs),
        status: interrupted ? 'error' : String(item.status || 'success'),
        stage: interrupted ? 'interrupted' : String(item.stage || ''),
        createdAt: item.createdAt || new Date().toISOString(),
        startedAt: item.startedAt || '',
        finishedAt: interrupted ? new Date().toISOString() : (item.finishedAt || ''),
        updatedAt: interrupted ? new Date().toISOString() : (item.updatedAt || item.createdAt || new Date().toISOString()),
        outputText: '',
        stderrText: redactAgentText(item.stderrText || ''),
        error: interrupted ? '控制台重启时本轮任务仍在执行，已标记为中断，可继续发送下一轮' : redactAgentText(item.error || ''),
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
      };
      if (interrupted) addTaskEvent(task, 'warn', task.error);
      tasks.set(task.id, task);
    }
  }

  restoreTasks();

  function listTasks(options = {}) {
    const limit = clampInteger(options.limit, 20, 1, AGENT_TASK_LIMIT);
    const activeOnly = options.activeOnly === true;
    const sorted = Array.from(tasks.values())
      .filter(task => !activeOnly || task.status === 'pending' || task.status === 'running')
      .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))
      .slice(0, limit);
    const detailedTaskId = String(options.taskId || sorted[0]?.id || '').trim();
    return sorted.map(task => serializeTask(task, { includeMessages: task.id === detailedTaskId }));
  }

  function pruneTasks() {
    const sorted = Array.from(tasks.values())
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    for (const task of sorted.slice(AGENT_TASK_LIMIT)) {
      if (task.status !== 'running' && task.status !== 'pending') tasks.delete(task.id);
    }
    persistTasks();
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
    };
    const providers = await getProviderSnapshots(options.force === true);
    const workspaces = getAgentWorkspaceOptions(workspaceOptions).map(item => ({
      id: item.id,
      label: item.label,
      description: item.description,
      path: item.path,
    }));
    const taskItems = listTasks({ limit: 30, taskId: options.taskId });
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
          successTaskCount: taskItems.filter(item => item.status === 'success').length,
          failedTaskCount: taskItems.filter(item => item.status === 'error').length,
        },
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

  async function runTask(task) {
    task.outputText = '';
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
        customApi: task.customApi,
        allowNetwork: task.allowNetwork === true,
        allowAllDirectories: task.allowAllDirectories === true,
        allowTerminal: task.allowTerminal === true,
      });
      processEnv = buildAgentProcessEnv(bundledRuntime.env, {
        fallbackRoot: bundledRuntime.runtimeRoot,
      });
      processEnv.OPENCODE_CONFIG_CONTENT = bundledRuntime.env.OPENCODE_CONFIG_CONTENT;
      commandModel = task.model ? getBundledOpenCodeModelRef(task.model) : '';
    }
    let attachedServer = null;
    if (task.providerId === 'opencode') {
      const executable = resolveAgentProviderCommand(task.providerId, { env: processEnv });
      addTaskEvent(task, 'info', '正在启动 OpenCode 受控服务');
      emitTaskUpdate(task);
      attachedServer = await startAttachedOpenCodeServer(executable, processEnv, task.workspacePath);
      task.openCodeServer = attachedServer;
    }
    const commandSpec = attachedServer ? null : buildAgentRunCommand({
      providerId: task.providerId,
      workspacePath: task.workspacePath,
      mode: task.mode,
      prompt: task.prompt,
      title: task.title,
      model: commandModel,
      sessionId: task.opencodeSessionId,
      env: processEnv,
      allowNetwork: task.allowNetwork === true,
      allowAllDirectories: task.allowAllDirectories === true,
      allowTerminal: task.allowTerminal === true,
    });
    const openCodeQuery = `?directory=${encodeURIComponent(task.workspacePath)}`;
    const opencodeAgent = isWriteMode(task.mode) ? 'build' : 'plan';
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
      task.command = ['opencode', 'session.message', '--agent', opencodeAgent, '--dir', task.workspacePath, '[PROMPT]'];
    } else {
      task.command = [path.basename(commandSpec.command), ...commandSpec.args.slice(0, -1), '[PROMPT]'];
    }
    task.stage = 'running';
    addTaskEvent(task, 'info', `正在调用 ${task.providerLabel}`);

    let permissionPollBusy = false;
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
        if (task.opencodeSessionId) {
          const messages = await requestOpenCodeJson(
            attachedServer,
            `/session/${encodeURIComponent(task.opencodeSessionId)}/message${openCodeQuery}&limit=12`,
            { timeoutMs: 1800 },
          );
          const liveOutput = getLatestOpenCodeAssistantOutput(messages, task.opencodeSessionId);
          if (liveOutput && liveOutput !== task.outputText) {
            task.outputText = liveOutput;
            task.updatedAt = new Date().toISOString();
            emitTaskUpdate(task);
          }
        }
      } catch (error) {
        if (task.status === 'running') logger.warn?.(`[agent-workbench] 权限队列读取失败: ${error.message}`);
      } finally {
        permissionPollBusy = false;
      }
    };
    const permissionPollTimer = attachedServer
      ? setInterval(() => refreshPendingPermissions().catch(() => {}), 350)
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
        if (type === 'crystelf.event_stream_error') {
          addTaskEvent(task, 'warn', `原生事件流暂时不可用：${properties.message || '未知错误'}`);
          emitTaskUpdate(task);
          return;
        }
        if (type && !type.includes('heartbeat')) {
          addTaskEvent(task, 'info', `OpenCode：${type}`);
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
          const response = await requestOpenCodeJson(
            attachedServer,
            `/session/${encodeURIComponent(task.opencodeSessionId)}/message${openCodeQuery}`,
            {
              method: 'POST',
              body: {
                agent: opencodeAgent,
                parts: [
                  {
                    type: 'text',
                    text: buildSafetyPrompt(task.mode, task.prompt, {
                      allowNetwork: task.allowNetwork === true,
                      allowAllDirectories: task.allowAllDirectories === true,
                      allowTerminal: task.allowTerminal === true,
                    }),
                  },
                  ...(Array.isArray(task.currentAttachments) ? task.currentAttachments.map(item => ({
                    type: 'file', mime: item.mime, filename: item.name, url: item.url,
                  })) : []),
                ],
              },
              timeoutMs: task.timeoutMs,
              signal: requestAbort.signal,
            },
          );
          const messages = await requestOpenCodeJson(
            attachedServer,
            `/session/${encodeURIComponent(task.opencodeSessionId)}/message${openCodeQuery}&limit=20`,
            { timeoutMs: 3000 },
          ).catch(() => []);
          task.outputText = getLatestOpenCodeAssistantOutput(messages, task.opencodeSessionId)
            || openCodePartsToJsonl(response?.parts, task.opencodeSessionId);
          result = { code: 0, stdout: task.outputText, stderr: '', timedOut: false };
        } catch (error) {
          const timedOut = error?.name === 'TimeoutError';
          result = {
            code: -1,
            error,
            stdout: task.outputText,
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
            emitTaskUpdate(task);
          },
          onStderr: chunk => {
            task.stderrText = appendLimited(task.stderrText, chunk);
            task.updatedAt = new Date().toISOString();
            emitTaskUpdate(task);
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
      stopAttachedOpenCodeServer(attachedServer);
    }
    delete task.child;
    task.exitCode = result.code;
    task.timedOut = result.timedOut === true;
    const detectedSessionId = extractOpenCodeSessionId(task.outputText || result.stdout);
    if (detectedSessionId) task.opencodeSessionId = detectedSessionId;
    const outputError = extractAgentJsonError(task.outputText || result.stdout);
    task.stage = 'verify';
    const changeAudit = await readGitChangeAudit(task.workspacePath);
    task.workspaceChanged = beforeGitStatus !== null && changeAudit.available && beforeGitStatus !== changeAudit.status;
    task.changedFiles = changeAudit.changedFiles;
    task.diffStat = changeAudit.diffStat;
    task.diffText = changeAudit.diffText;
    task.finishedAt = new Date().toISOString();
    task.updatedAt = task.finishedAt;

    if (task.cancelRequested) {
      task.canceled = true;
      task.status = 'canceled';
      task.stage = 'canceled';
      task.error = '任务已取消';
      addTaskEvent(task, 'warn', '任务已取消');
    } else if (task.timedOut) {
      task.status = 'error';
      task.stage = 'timeout';
      task.error = 'Agent 执行超时，进程已终止';
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

    const parsedTurn = parseOpenCodeTurn(task.outputText || result.stdout);
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
      diffText: task.diffText,
    });
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
      throw createHttpError(409, '当前 Agent 会话仍在执行，请等待完成后继续发送', 'AGENT_SESSION_BUSY');
    }
    const activeCount = listTasks({ activeOnly: true, limit: AGENT_TASK_LIMIT }).length;
    if (activeCount >= config.maxConcurrentTasks) {
      throw createHttpError(409, '当前 Agent 并发任务已达到上限', 'AGENT_CONCURRENCY_LIMIT');
    }
    const providerId = existingTask?.providerId || normalizeProviderId(payload.providerId || config.defaultProvider);
    if (config.providers[providerId] === false) {
      throw createHttpError(403, '所选 Agent 提供方已停用', 'AGENT_PROVIDER_DISABLED');
    }
    const provider = await probeProvider(providerId, true);
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
    const model = normalizeModel(payload.model);
    const customApi = existingTask?.customApi || normalizeCustomAgentApi(config.customApi);
    const allowNetwork = existingTask ? existingTask.allowNetwork === true : config.allowNetwork === true;
    const allowAllDirectories = existingTask
      ? existingTask.allowAllDirectories === true
      : config.allowAllDirectories === true;
    const allowTerminal = existingTask
      ? existingTask.allowTerminal === true
      : (isWriteMode(mode) && config.allowTerminal === true);
    const title = existingTask?.title || normalizeSingleLine(payload.title || prompt, 80) || 'Agent 任务';
    const task = existingTask || {
      id: `agent-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      opencodeSessionId: '',
      title,
      providerId,
      providerLabel: provider.label,
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      workspacePath: workspace.path,
      mode,
      model,
      customApi,
      allowNetwork,
      allowAllDirectories,
      allowTerminal,
      pendingPermissions: [],
      pendingQuestions: [],
      currentAttachments: [],
      prompt: '',
      promptPreview: '',
      turnCount: 0,
      messages: [],
      writeConfirmed: false,
      timeoutMs: clampInteger(payload.timeoutMs, config.timeoutMs, 60000, config.timeoutMs),
      status: 'pending',
      stage: 'pending',
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
    };
    task.providerId = providerId;
    task.providerLabel = provider.label;
    task.mode = mode;
    task.model = model;
    task.customApi = customApi;
    task.allowNetwork = allowNetwork;
    task.allowAllDirectories = allowAllDirectories;
    task.allowTerminal = allowTerminal;
    task.prompt = prompt;
    task.currentPrompt = prompt;
    task.promptPreview = normalizeSingleLine(prompt, 180);
    task.currentAttachments = attachments;
    task.timeoutMs = clampInteger(payload.timeoutMs, config.timeoutMs, 60000, config.timeoutMs);
    task.status = 'pending';
    task.stage = 'pending';
    task.startedAt = '';
    task.finishedAt = '';
    task.updatedAt = new Date().toISOString();
    task.turnCount = Math.max(0, Number(task.turnCount || 0)) + 1;
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
    tasks.set(task.id, task);
    addTaskEvent(task, 'info', existingTask ? `已发送第 ${task.turnCount} 轮消息` : '会话已进入队列');
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    runTask(task).catch(error => {
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
      persistTasks();
      emitTaskUpdate(task, 'task', true);
      logger.error?.(`[agent-workbench] 任务失败 ${task.id}: ${error.stack || error.message}`);
    });
    return serializeTask(task, { includeMessages: true });
  }

  function getTask(taskId = '') {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    return serializeTask(task, { includeMessages: true });
  }

  function cancelTask(taskId = '') {
    const id = String(taskId || '').trim();
    const task = tasks.get(id);
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    if (task.status !== 'pending' && task.status !== 'running') {
      return { canceled: false, task: serializeTask(task, { includeMessages: true }) };
    }
    task.cancelRequested = true;
    task.updatedAt = new Date().toISOString();
    addTaskEvent(task, 'warn', '正在取消任务');
    if (task.child && !task.child.killed) task.child.kill('SIGTERM');
    task.openCodeRequestAbort?.abort?.();
    persistTasks();
    emitTaskUpdate(task, 'task', true);
    return { canceled: true, task: serializeTask(task, { includeMessages: true }) };
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

  async function buildNativePayload(workspaceId = '') {
    const workspace = resolveAgentWorkspace(workspaceId, workspaceOptions);
    const query = pathName => requestWorkspaceOpenCode(workspace.id, pathName, { timeoutMs: 8000 }).catch(error => ({ __error: error.message }));
    const [providerResult, skillsResult, commandsResult, mcpResult, lspResult, formatterResult, ptyResult] = await Promise.all([
      query('/provider'), query('/skill'), query('/command'), query('/mcp'), query('/lsp'), query('/formatter'), query('/pty'),
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
    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        workspace: { id: workspace.id, label: workspace.label, path: workspace.path },
        providers,
        defaults: providerResult?.default || {},
        skills,
        commands,
        mcp,
        lsp: Array.isArray(lspResult) ? lspResult.slice(0, 100) : [],
        formatters: Array.isArray(formatterResult) ? formatterResult.slice(0, 100) : [],
        terminals: listTerminals(workspace.id),
        nativePtys: Array.isArray(ptyResult) ? ptyResult.slice(0, AGENT_TERMINAL_LIMIT) : [],
        errors: [providerResult, skillsResult, commandsResult, mcpResult, lspResult, formatterResult, ptyResult]
          .filter(item => item?.__error).map(item => item.__error),
      },
    };
  }

  async function manageSession(taskId = '', action = '', payload = {}) {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 会话', 'AGENT_TASK_NOT_FOUND');
    if (task.status === 'running' || task.status === 'pending') {
      throw createHttpError(409, '会话正在执行，暂时不能管理', 'AGENT_SESSION_BUSY');
    }
    const queryPath = suffix => `/session/${encodeURIComponent(task.opencodeSessionId)}${suffix}`;
    if (action === 'rename') {
      const title = normalizeSingleLine(payload.title || '', 80);
      if (!title) throw createHttpError(400, '请输入会话名称', 'AGENT_SESSION_TITLE_REQUIRED');
      if (task.opencodeSessionId) {
        await requestWorkspaceOpenCode(task.workspaceId, queryPath(''), { method: 'PATCH', body: { title }, timeoutMs: 8000 });
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
        await requestWorkspaceOpenCode(task.workspaceId, queryPath(''), { method: 'DELETE', timeoutMs: 8000 }).catch(error => {
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
      const session = await requestWorkspaceOpenCode(task.workspaceId, queryPath('/fork'), {
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
      const providerId = normalizeSingleLine(payload.providerId || '', 120);
      const modelId = normalizeSingleLine(payload.modelId || '', 180);
      if (!providerId || !modelId) throw createHttpError(400, '请选择用于压缩会话的模型', 'AGENT_SUMMARY_MODEL_REQUIRED');
      await requestWorkspaceOpenCode(task.workspaceId, queryPath('/summarize'), {
        method: 'POST', body: { providerID: providerId, modelID: modelId, auto: false }, timeoutMs: task.timeoutMs,
      });
      addTaskEvent(task, 'success', 'OpenCode 会话上下文已压缩');
    } else if (action === 'revert') {
      const messageId = normalizeOpenCodeMessageId(payload.messageId);
      if (!messageId) throw createHttpError(400, '缺少可撤销的消息 ID', 'AGENT_REVERT_MESSAGE_REQUIRED');
      await requestWorkspaceOpenCode(task.workspaceId, queryPath('/revert'), {
        method: 'POST', body: { messageID: messageId }, timeoutMs: 15000,
      });
      addTaskEvent(task, 'warn', '已撤销所选 OpenCode 消息及其文件改动');
    } else if (action === 'unrevert') {
      await requestWorkspaceOpenCode(task.workspaceId, queryPath('/unrevert'), { method: 'POST', body: {}, timeoutMs: 15000 });
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
    const diffs = await requestWorkspaceOpenCode(task.workspaceId, `/session/${encodeURIComponent(task.opencodeSessionId)}/diff`, { timeoutMs: 10000 });
    return { success: true, diffs: Array.isArray(diffs) ? diffs.slice(0, 300) : [] };
  }

  async function searchWorkspace(payload = {}) {
    const workspace = resolveAgentWorkspace(payload.workspaceId, workspaceOptions);
    const query = normalizeSingleLine(payload.query || '', 300);
    if (!query) throw createHttpError(400, '请输入搜索内容', 'AGENT_SEARCH_QUERY_REQUIRED');
    const type = ['text', 'symbol'].includes(payload.type) ? payload.type : 'file';
    const pathname = type === 'text'
      ? `/find?pattern=${encodeURIComponent(query)}`
      : type === 'symbol'
        ? `/find/symbol?query=${encodeURIComponent(query)}`
        : `/find/file?query=${encodeURIComponent(query)}&limit=100`;
    const result = await requestWorkspaceOpenCode(workspace.id, pathname, { timeoutMs: 12000 });
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
      id: pty.id, workspaceId: workspace.id, title: pty.title || 'Agent 终端', command: pty.command || command,
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

  return {
    buildPayload,
    saveConfig,
    createTask,
    getTask,
    cancelTask,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    buildNativePayload,
    manageSession,
    getSessionDiff,
    searchWorkspace,
    createTerminal,
    sendTerminalInput,
    resizeTerminal,
    closeTerminal,
    listTerminals,
    subscribeEvents,
    listTasks,
    serializeTask,
    probeProvider,
  };
}
