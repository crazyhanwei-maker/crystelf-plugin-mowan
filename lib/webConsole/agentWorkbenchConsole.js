import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import Path from '../../constants/path.js';
import {
  buildBundledOpenCodeEnvironment,
  getBundledOpenCodeModelRef,
  resolveBundledOpenCodeCommand,
} from './bundledOpenCodeRuntime.js';

const AGENT_TASK_LIMIT = 40;
const AGENT_OUTPUT_LIMIT = 160000;
const AGENT_EVENT_LIMIT = 80;
const PROVIDER_PROBE_TTL_MS = 30000;
const PROVIDER_PROBE_TIMEOUT_MS = 8000;
const GIT_STATUS_TIMEOUT_MS = 10000;

const PROVIDER_DEFINITIONS = Object.freeze({
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    description: 'OpenCode CLI',
    binary: 'opencode',
  },
  mimo: {
    id: 'mimo',
    label: 'MiMo Code',
    description: 'MiMo Code CLI',
    binary: 'mimo',
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
  return String(value || '').trim().toLowerCase() === 'patch' ? 'patch' : 'analyze';
}

function normalizeModel(value = '') {
  const model = String(value || '').trim();
  if (!model) return '';
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(model)) {
    throw createHttpError(400, '模型名称只能包含字母、数字、点、斜杠、冒号、下划线和短横线', 'AGENT_MODEL_INVALID');
  }
  return model;
}

function stripAnsi(value = '') {
  return String(value || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
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
    defaultProvider: normalizeProviderId(value?.defaultProvider),
    timeoutMs: clampInteger(value?.timeoutMs, 300000, 60000, 900000),
    maxConcurrentTasks: clampInteger(value?.maxConcurrentTasks, 1, 1, 2),
    providers: {
      opencode: value?.providers?.opencode !== false,
      mimo: value?.providers?.mimo !== false,
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
  const fallbackPath = path.join(options.fallbackRoot, options.fallbackName);
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
  const userHome = String(nextEnv.HOME || nextEnv.USERPROFILE || '').trim();
  const fallbackRoot = path.resolve(options.fallbackRoot || Path.data);
  const fallbackRuntimeRoot = path.join(fallbackRoot, 'agent-cli-runtime');
  applyWritableAgentDirectory(nextEnv, {
    envKey: 'XDG_CONFIG_HOME',
    defaultPath: userHome ? path.join(userHome, '.config') : '',
    fallbackRoot: fallbackRuntimeRoot,
    fallbackName: 'config',
  });
  applyWritableAgentDirectory(nextEnv, {
    envKey: 'XDG_DATA_HOME',
    defaultPath: userHome ? path.join(userHome, '.local', 'share') : '',
    fallbackRoot: fallbackRuntimeRoot,
    fallbackName: 'data',
  });
  applyWritableAgentDirectory(nextEnv, {
    envKey: 'XDG_STATE_HOME',
    defaultPath: userHome ? path.join(userHome, '.local', 'state') : '',
    fallbackRoot: fallbackRuntimeRoot,
    fallbackName: 'state',
  });
  applyWritableAgentDirectory(nextEnv, {
    envKey: 'XDG_CACHE_HOME',
    defaultPath: userHome ? path.join(userHome, '.cache') : '',
    fallbackRoot: fallbackRuntimeRoot,
    fallbackName: 'cache',
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
    if (id === 'mimo') {
      const script = path.join(base, 'node_modules', '@mimo-ai', 'cli', 'bin', 'mimo');
      if (fs.existsSync(script)) {
        return { command: process.execPath, baseArgs: [script], source: script };
      }
    }
  }
  return { command: PROVIDER_DEFINITIONS[id].binary, baseArgs: [], source: 'PATH' };
}

function buildSafetyPrompt(mode, prompt) {
  const modeInstruction = mode === 'patch'
    ? '请给出可审查的修改方案，并在适合时输出 unified diff 补丁文本，但不要实际应用补丁。'
    : '请分析问题、定位相关文件并给出结论与建议。';
  return [
    '你由魔丸控制台以只读 Agent 模式调用。',
    '禁止创建、修改、移动或删除任何文件；禁止安装依赖；禁止执行会改变 Git、进程、服务、网络或系统状态的命令。',
    '可以读取文件并执行只读查询。遇到需要写入或高风险操作时，只说明建议，不要执行。',
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
  const executable = resolveAgentProviderCommand(providerId, options);
  const args = [
    ...executable.baseArgs,
    'run',
    '--pure',
    '--format',
    'json',
    '--agent',
    'plan',
    '--dir',
    workspacePath,
    '--title',
    title,
  ];
  if (model) args.push('--model', model);
  args.push(buildSafetyPrompt(mode, prompt));
  return {
    providerId,
    command: executable.command,
    args,
    source: executable.source,
    workspacePath,
    mode,
    model,
    title,
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

async function readGitStatus(workspacePath = '') {
  const result = await runCapturedProcess('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: workspacePath,
    timeoutMs: GIT_STATUS_TIMEOUT_MS,
    outputLimit: 50000,
  }).catch(() => null);
  if (!result || result.code !== 0) return null;
  return result.stdout.trim();
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

function serializeTask(task = {}) {
  return {
    id: task.id || '',
    title: task.title || '',
    providerId: task.providerId || '',
    providerLabel: task.providerLabel || '',
    workspaceId: task.workspaceId || '',
    workspaceLabel: task.workspaceLabel || '',
    mode: task.mode || 'analyze',
    model: task.model || '',
    promptPreview: task.promptPreview || '',
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
    events: Array.isArray(task.events) ? task.events.slice(-AGENT_EVENT_LIMIT) : [],
    command: Array.isArray(task.command) ? task.command : [],
  };
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
  const providerProbeCache = new Map();

  function getConfig() {
    return normalizeAgentWorkbenchConfig(ConfigControl?.get?.('coreConfig')?.tools?.agentWorkbench || {});
  }

  function listTasks(options = {}) {
    const limit = clampInteger(options.limit, 20, 1, AGENT_TASK_LIMIT);
    const activeOnly = options.activeOnly === true;
    return Array.from(tasks.values())
      .filter(task => !activeOnly || task.status === 'pending' || task.status === 'running')
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, limit)
      .map(serializeTask);
  }

  function pruneTasks() {
    const sorted = Array.from(tasks.values())
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    for (const task of sorted.slice(AGENT_TASK_LIMIT)) {
      if (task.status !== 'running' && task.status !== 'pending') tasks.delete(task.id);
    }
  }

  async function probeProvider(providerId, force = false) {
    const id = normalizeProviderId(providerId);
    const cached = providerProbeCache.get(id);
    if (!force && cached && Date.now() - cached.checkedAtMs < PROVIDER_PROBE_TTL_MS) return cached.value;
    const processEnv = buildAgentProcessEnv();
    const executable = resolveAgentProviderCommand(id, { env: processEnv });
    const result = await runCapturedProcess(executable.command, [...executable.baseArgs, '--version'], {
      timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
      outputLimit: 4000,
      env: processEnv,
    }).catch(error => ({ code: -1, error, stdout: '', stderr: '' }));
    const version = normalizeSingleLine(result.stdout || result.stderr, 120);
    const available = result.code === 0;
    const value = {
      ...PROVIDER_DEFINITIONS[id],
      available,
      version: available ? version : '',
      source: executable.source === 'plugin'
        ? '插件内置'
        : (executable.source === 'PATH' ? '系统 PATH' : '系统安装'),
      error: available ? '' : normalizeSingleLine(result.error?.message || result.stderr || 'CLI 无法启动', 300),
      checkedAt: new Date().toISOString(),
    };
    providerProbeCache.set(id, { checkedAtMs: Date.now(), value });
    return value;
  }

  async function getProviderSnapshots(force = false) {
    return await Promise.all(Object.keys(PROVIDER_DEFINITIONS).map(id => probeProvider(id, force)));
  }

  async function buildPayload(options = {}) {
    const config = getConfig();
    const providers = await getProviderSnapshots(options.force === true);
    const workspaces = getAgentWorkspaceOptions(workspaceOptions).map(item => ({
      id: item.id,
      label: item.label,
      description: item.description,
      path: item.path,
    }));
    const taskItems = listTasks({ limit: 30 });
    return {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        config,
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
          pureMode: true,
          automaticApproval: false,
          directFileWrite: false,
        },
      },
    };
  }

  async function saveConfig(payload = {}) {
    const nextConfig = normalizeAgentWorkbenchConfig(payload);
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
    task.status = 'running';
    task.stage = 'precheck';
    task.startedAt = new Date().toISOString();
    task.updatedAt = task.startedAt;
    addTaskEvent(task, 'info', '开始只读安全检查');
    const beforeGitStatus = await readGitStatus(task.workspacePath);
    task.gitCheckAvailable = beforeGitStatus !== null;
    if (task.cancelRequested) {
      task.canceled = true;
      task.status = 'canceled';
      task.stage = 'canceled';
      task.error = '任务已取消';
      task.finishedAt = new Date().toISOString();
      task.updatedAt = task.finishedAt;
      addTaskEvent(task, 'warn', '任务已取消');
      return;
    }
    let processEnv = buildAgentProcessEnv();
    let commandModel = task.model;
    if (task.providerId === 'opencode' && resolveBundledOpenCodeCommand({ rootPath: Path.root })) {
      const bundledRuntime = buildBundledOpenCodeEnvironment({
        aiConfig: ConfigControl?.get?.('ai') || {},
        model: task.model,
      });
      processEnv = buildAgentProcessEnv(bundledRuntime.env, {
        fallbackRoot: bundledRuntime.runtimeRoot,
      });
      processEnv.OPENCODE_CONFIG_CONTENT = bundledRuntime.env.OPENCODE_CONFIG_CONTENT;
      commandModel = task.model ? getBundledOpenCodeModelRef(task.model) : '';
    }
    const commandSpec = buildAgentRunCommand({
      providerId: task.providerId,
      workspacePath: task.workspacePath,
      mode: task.mode,
      prompt: task.prompt,
      title: task.title,
      model: commandModel,
      env: processEnv,
    });
    task.command = [path.basename(commandSpec.command), ...commandSpec.args.slice(0, -1), '[PROMPT]'];
    task.stage = 'running';
    addTaskEvent(task, 'info', `正在调用 ${task.providerLabel}`);

    const result = await runCapturedProcess(commandSpec.command, commandSpec.args, {
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
      },
      onStderr: chunk => {
        task.stderrText = appendLimited(task.stderrText, chunk);
        task.updatedAt = new Date().toISOString();
      },
    });
    delete task.child;
    task.exitCode = result.code;
    task.timedOut = result.timedOut === true;
    const outputError = extractAgentJsonError(task.outputText || result.stdout);
    task.stage = 'verify';
    const afterGitStatus = await readGitStatus(task.workspacePath);
    task.workspaceChanged = beforeGitStatus !== null && afterGitStatus !== null && beforeGitStatus !== afterGitStatus;
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
    } else {
      task.status = 'success';
      task.stage = 'complete';
      addTaskEvent(task, task.workspaceChanged ? 'warn' : 'success', task.workspaceChanged
        ? '任务结束，但执行期间 Git 工作区状态发生变化，请人工检查'
        : '只读 Agent 任务完成');
    }

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
    if (payload.confirmed !== true) {
      throw createHttpError(428, '启动 Agent 任务前需要确认只读执行范围', 'AGENT_CONFIRMATION_REQUIRED');
    }
    const activeCount = listTasks({ activeOnly: true, limit: AGENT_TASK_LIMIT }).length;
    if (activeCount >= config.maxConcurrentTasks) {
      throw createHttpError(409, '当前 Agent 并发任务已达到上限', 'AGENT_CONCURRENCY_LIMIT');
    }
    const providerId = normalizeProviderId(payload.providerId || config.defaultProvider);
    if (config.providers[providerId] === false) {
      throw createHttpError(403, '所选 Agent 提供方已停用', 'AGENT_PROVIDER_DISABLED');
    }
    const provider = await probeProvider(providerId, true);
    if (!provider.available) {
      throw createHttpError(409, `${provider.label} 当前不可用：${provider.error || 'CLI 启动失败'}`, 'AGENT_PROVIDER_UNAVAILABLE');
    }
    const workspace = resolveAgentWorkspace(payload.workspaceId, workspaceOptions);
    const prompt = normalizePrompt(payload.prompt);
    if (prompt.length < 2) {
      throw createHttpError(400, '请输入需要 Agent 分析的任务', 'AGENT_PROMPT_REQUIRED');
    }
    const mode = normalizeMode(payload.mode);
    const model = normalizeModel(payload.model);
    const title = normalizeSingleLine(payload.title || prompt, 80) || 'Agent 任务';
    const task = {
      id: `agent-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      title,
      providerId,
      providerLabel: provider.label,
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      workspacePath: workspace.path,
      mode,
      model,
      prompt,
      promptPreview: normalizeSingleLine(prompt, 180),
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
    };
    tasks.set(task.id, task);
    addTaskEvent(task, 'info', '任务已进入队列');
    runTask(task).catch(error => {
      delete task.child;
      task.status = 'error';
      task.stage = 'error';
      task.error = normalizeSingleLine(error?.message || String(error), 1000);
      task.finishedAt = new Date().toISOString();
      task.updatedAt = task.finishedAt;
      addTaskEvent(task, 'error', task.error);
      logger.error?.(`[agent-workbench] 任务失败 ${task.id}: ${error.stack || error.message}`);
    });
    return serializeTask(task);
  }

  function getTask(taskId = '') {
    const task = tasks.get(String(taskId || '').trim());
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    return serializeTask(task);
  }

  function cancelTask(taskId = '') {
    const id = String(taskId || '').trim();
    const task = tasks.get(id);
    if (!task) throw createHttpError(404, '未找到 Agent 任务', 'AGENT_TASK_NOT_FOUND');
    if (task.status !== 'pending' && task.status !== 'running') {
      return { canceled: false, task: serializeTask(task) };
    }
    task.cancelRequested = true;
    task.updatedAt = new Date().toISOString();
    addTaskEvent(task, 'warn', '正在取消任务');
    if (task.child && !task.child.killed) task.child.kill('SIGTERM');
    return { canceled: true, task: serializeTask(task) };
  }

  return {
    buildPayload,
    saveConfig,
    createTask,
    getTask,
    cancelTask,
    listTasks,
    serializeTask,
    probeProvider,
  };
}
