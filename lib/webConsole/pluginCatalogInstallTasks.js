import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  buildPackageInstallCommand,
  resolveAvailablePackageManager,
  resolvePreferredPackageManagers,
} from './packageManagerResolver.js';

const PLUGIN_CATALOG_TASK_OUTPUT_LIMIT = 5000;
const PLUGIN_CATALOG_TASK_TTL_MS = 60 * 60 * 1000;
const PLUGIN_CATALOG_TASK_MAX_COUNT = 80;
const PLUGIN_CATALOG_CLONE_TIMEOUT_MS = 10 * 60 * 1000;
const PLUGIN_CATALOG_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const PLUGIN_CATALOG_TASK_STORE_LIMIT = 40;
const PLUGIN_CATALOG_PRECHECK_TIMEOUT_MS = 15000;

function appendOutputTail(current = '', chunk = '', maxLength = PLUGIN_CATALOG_TASK_OUTPUT_LIMIT) {
  const next = `${current}${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')}`;
  return next.length > maxLength ? next.slice(-maxLength) : next;
}

function readJsonFileSafe(filePath = '', fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function redactTaskText(value = '', task = {}) {
  let text = String(value || '');
  const pathReplacements = [
    [task.targetDir, task.relativeTargetDir || task.directoryName || 'plugin-target'],
    [task.pluginsRoot, 'plugins'],
  ];
  pathReplacements.forEach(([rawPath, label]) => {
    const raw = String(rawPath || '');
    if (!raw) return;
    const normalized = raw.replace(/\\/g, '/');
    text = text.split(raw).join(label);
    text = text.split(normalized).join(label);
  });
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|pwd|secret|cookie|token)\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|pwd|secret|cookie|token)"?\s*:\s*)("[^"]+"|'[^']+'|[^\s,;{}]+)/gi, '$1[REDACTED]');
}

function serializeTask(task = {}) {
  return {
    id: task.id || '',
    catalogId: task.catalogId || '',
    pluginName: task.pluginName || '',
    repo: task.repo || '',
    directoryName: task.directoryName || '',
    targetDir: redactTaskText(task.relativeTargetDir || task.targetDir || task.directoryName || '', task),
    status: task.status || 'unknown',
    stage: task.stage || '',
    canceled: task.canceled === true,
    cancelRequestedAt: task.cancelRequestedAt || '',
    residue: task.residue && typeof task.residue === 'object' ? {
      exists: task.residue.exists === true,
      path: redactTaskText(task.residue.path || '', task),
      reason: redactTaskText(task.residue.reason || '', task),
    } : null,
    createdAt: task.createdAt || '',
    startedAt: task.startedAt || '',
    finishedAt: task.finishedAt || '',
    command: Array.isArray(task.command) ? task.command.map(part => redactTaskText(part, task)) : [],
    installDependencies: task.installDependencies === true,
    packageManager: task.packageManager || '',
    packageManagerCandidates: Array.isArray(task.packageManagerCandidates) ? task.packageManagerCandidates : [],
    steps: Array.isArray(task.steps) ? task.steps.map(step => ({
      key: String(step.key || '').trim(),
      label: String(step.label || '').trim(),
      status: String(step.status || '').trim(),
      command: Array.isArray(step.command) ? step.command.map(part => redactTaskText(part, task)) : [],
      startedAt: step.startedAt || '',
      finishedAt: step.finishedAt || '',
      exitCode: step.exitCode === null || step.exitCode === undefined || step.exitCode === ''
        ? null
        : Number.isFinite(Number(step.exitCode))
          ? Number(step.exitCode)
          : null,
      message: redactTaskText(step.message || '', task),
    })) : [],
    stdoutTail: redactTaskText(task.stdoutTail || '', task),
    stderrTail: redactTaskText(task.stderrTail || '', task),
    error: redactTaskText(task.error || '', task),
    timedOut: task.timedOut === true,
  };
}

function createInstallStep(key = '', label = '', enabled = true, command = []) {
  return {
    key,
    label,
    status: enabled ? 'pending' : 'skipped',
    command: enabled && Array.isArray(command) ? command : [],
    startedAt: '',
    finishedAt: '',
    exitCode: null,
    message: enabled ? '等待执行' : '未启用',
  };
}

function updateInstallStep(task = {}, key = '', patch = {}) {
  if (!task || !key) return null;
  if (!Array.isArray(task.steps)) {
    task.steps = [];
  }
  let step = task.steps.find(item => item.key === key);
  if (!step) {
    step = createInstallStep(key, key);
    task.steps.push(step);
  }
  Object.assign(step, patch);
  return step;
}

function runProcess(command, args = [], options = {}) {
  return new Promise(resolve => {
    const task = options.task || {};
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutTail = '';
    let stderrTail = '';
    let settled = false;
    if (task && typeof task === 'object') {
      task.currentProcess = child;
      task.currentProcessLabel = String(options.label || command || '').trim();
    }
    const timeout = setTimeout(() => {
      if (settled) return;
      task.timedOut = true;
      child.kill('SIGTERM');
    }, Math.max(1000, Number(options.timeoutMs || 60000)));

    child.stdout?.on('data', chunk => {
      stdoutTail = appendOutputTail(stdoutTail, chunk);
      task.stdoutTail = appendOutputTail(task.stdoutTail, chunk);
    });
    child.stderr?.on('data', chunk => {
      stderrTail = appendOutputTail(stderrTail, chunk);
      task.stderrTail = appendOutputTail(task.stderrTail, chunk);
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (task?.currentProcess === child) {
        delete task.currentProcess;
        delete task.currentProcessLabel;
      }
      resolve({ status: -1, error, stdoutTail, stderrTail, timedOut: task.timedOut === true });
    });
    child.on('close', status => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (task?.currentProcess === child) {
        delete task.currentProcess;
        delete task.currentProcessLabel;
      }
      resolve({
        status: Number(status || 0),
        stdoutTail,
        stderrTail,
        timedOut: task.timedOut === true,
        canceled: task.canceled === true,
      });
    });
  });
}

function normalizePersistedTask(task = {}) {
  const interrupted = task.status === 'running' || task.status === 'pending';
  const steps = Array.isArray(task.steps)
    ? task.steps.map(step => {
        if (!interrupted || (step.status !== 'running' && step.status !== 'pending')) {
          return step;
        }
        return {
          ...step,
          status: 'error',
          finishedAt: step.finishedAt || new Date().toISOString(),
          message: '控制台重启时任务未完成，已标记为中断',
        };
      })
    : [];
  return {
    ...task,
    status: interrupted ? 'error' : (task.status || 'unknown'),
    stage: interrupted ? 'interrupted' : (task.stage || ''),
    finishedAt: task.finishedAt || new Date().toISOString(),
    error: interrupted
      ? '控制台重启时任务未完成，已标记为中断'
      : (task.error || ''),
    steps,
  };
}

function fallbackNormalizePluginDirectoryName(value = '', fallback = '') {
  for (const candidate of [value, fallback]) {
    const normalized = String(candidate || '')
      .trim()
      .replace(/\.git$/i, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 80);
    if (normalized && /[A-Za-z0-9]/.test(normalized)) {
      return normalized;
    }
  }
  return '';
}

function fallbackGetRepoName(repo = '', fallback = '') {
  const raw = String(repo || '').trim();
  let text = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      text = new URL(raw).pathname;
    }
  } catch {
    text = raw;
  }
  text = String(text || '').replace(/[?#].*$/g, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const last = text.split(/[/:]/).filter(Boolean).pop();
  return String(last || fallback || '').trim();
}

export function createPluginCatalogInstallTasks(options = {}) {
  const logger = options.logger || console;
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode, message, code = '') => {
        const error = new Error(message);
        error.statusCode = statusCode;
        error.code = code;
        return error;
      });
  const getResolvedPathSafe = typeof options.getResolvedPathSafe === 'function'
    ? options.getResolvedPathSafe
    : (targetPath = '') => path.resolve(String(targetPath || ''));
  const isSubPath = typeof options.isSubPath === 'function'
    ? options.isSubPath
    : ((parentPath = '', targetPath = '') => {
        const relativePath = path.relative(parentPath, targetPath);
        return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
      });
  const resolvePluginsDirectory = typeof options.resolvePluginsDirectory === 'function'
    ? options.resolvePluginsDirectory
    : (() => path.join(process.cwd(), 'plugins'));
  const toRelativeConsolePath = typeof options.toRelativeConsolePath === 'function'
    ? options.toRelativeConsolePath
    : (targetPath = '') => path.relative(process.cwd(), targetPath).replace(/\\/g, '/');
  const getCatalogItem = typeof options.getCatalogItem === 'function' ? options.getCatalogItem : (() => null);
  const getRepoName = typeof options.getRepoName === 'function' ? options.getRepoName : fallbackGetRepoName;
  const normalizePluginDirectoryName = typeof options.normalizePluginDirectoryName === 'function'
    ? options.normalizePluginDirectoryName
    : fallbackNormalizePluginDirectoryName;
  const getCatalogDefaultDirectoryName = typeof options.getCatalogDefaultDirectoryName === 'function'
    ? options.getCatalogDefaultDirectoryName
    : (item = {}) => normalizePluginDirectoryName(getRepoName(item.repo || ''), item.directoryName || item.defaultDirectoryName || item.id || item.name || '');
  const recordWebConsoleOperation = typeof options.recordWebConsoleOperation === 'function'
    ? options.recordWebConsoleOperation
    : (() => {});
  const taskStoreFile = options.taskStoreFile || path.join(process.cwd(), 'data', 'crystelf', 'plugin-install-tasks.json');
  const pluginInstallTasks = new Map();

  function recordInstallOperation(action = '', task = {}, extra = {}) {
    recordWebConsoleOperation({
      action,
      method: 'TASK',
      path: `plugin-catalog:${action}`,
      result: extra.result || (task.status === 'error' ? 'error' : 'success'),
      statusCode: extra.statusCode || (task.status === 'error' ? 500 : 200),
      details: {
        taskId: task.id || '',
        catalogId: task.catalogId || '',
        pluginName: task.pluginName || '',
        repo: task.repo || '',
        directoryName: task.directoryName || '',
        targetDir: task.relativeTargetDir || toRelativeConsolePath(task.targetDir || ''),
        stage: task.stage || '',
        status: task.status || '',
        installDependencies: task.installDependencies === true,
        packageManager: task.packageManager || '',
        packageManagerCandidates: Array.isArray(task.packageManagerCandidates) ? task.packageManagerCandidates : [],
        error: task.error || '',
        canceled: task.canceled === true,
        residue: task.residue || null,
        ...extra.details,
      },
    });
  }

  function persistTasks() {
    try {
      fs.mkdirSync(path.dirname(taskStoreFile), { recursive: true });
      const tasks = Array.from(pluginInstallTasks.values())
        .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))
        .slice(0, PLUGIN_CATALOG_TASK_STORE_LIMIT)
        .map(task => serializeTask(task));
      fs.writeFileSync(taskStoreFile, JSON.stringify({ updatedAt: new Date().toISOString(), tasks }, null, 2));
    } catch (error) {
      logger.warn?.(`[webConsole] 插件安装任务持久化失败: ${error.message}`);
    }
  }

  function loadPersistedTasks() {
    const payload = readJsonFileSafe(taskStoreFile, null);
    const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
    for (const task of tasks) {
      if (!task?.id || pluginInstallTasks.has(task.id)) continue;
      pluginInstallTasks.set(task.id, normalizePersistedTask(task));
    }
  }

  function pruneTasks() {
    const now = Date.now();
    let changed = false;
    for (const [taskId, task] of pluginInstallTasks.entries()) {
      const finished = task.status === 'success' || task.status === 'error';
      const time = Date.parse(task.finishedAt || task.createdAt || '') || now;
      if (finished && now - time > PLUGIN_CATALOG_TASK_TTL_MS) {
        pluginInstallTasks.delete(taskId);
        changed = true;
      }
    }
    const entries = Array.from(pluginInstallTasks.values())
      .sort((a, b) => (Date.parse(a.createdAt || '') || 0) - (Date.parse(b.createdAt || '') || 0));
    while (pluginInstallTasks.size > PLUGIN_CATALOG_TASK_MAX_COUNT && entries.length > 0) {
      const task = entries.shift();
      if (task?.id) {
        pluginInstallTasks.delete(task.id);
        changed = true;
      }
    }
    if (changed) {
      persistTasks();
    }
  }

  function createTaskId() {
    return `plugin-install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeResolvedPathForCompare(targetPath = '') {
    const resolved = path.resolve(String(targetPath || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  function isSameResolvedPath(leftPath = '', rightPath = '') {
    return normalizeResolvedPathForCompare(leftPath) === normalizeResolvedPathForCompare(rightPath);
  }

  function isTaskActive(task = {}) {
    return task.status === 'pending' || task.status === 'running';
  }

  function findActiveTargetTask(targetDir = '') {
    const normalizedTarget = normalizeResolvedPathForCompare(targetDir);
    return Array.from(pluginInstallTasks.values()).find(task => (
      isTaskActive(task)
      && normalizeResolvedPathForCompare(task.targetDir || '') === normalizedTarget
    )) || null;
  }

  function detectTaskResidue(task = {}, reason = '') {
    try {
      if (!task?.targetDir || !fs.existsSync(task.targetDir)) {
        task.residue = null;
        return null;
      }
      const stat = fs.statSync(task.targetDir);
      if (!stat.isDirectory()) {
        task.residue = null;
        return null;
      }
      task.residue = {
        exists: true,
        path: task.relativeTargetDir || toRelativeConsolePath(task.targetDir),
        reason: reason || '插件安装未成功完成，目标目录可能是半成品，请手动确认后处理。',
      };
      return task.residue;
    } catch {
      task.residue = null;
      return null;
    }
  }

  function assertConfirmedPluginInstall(payload = {}) {
    if (payload.confirmed === true || payload.confirmPluginInstall === true) {
      return;
    }
    throw createHttpError(428, '插件安装需要确认目标目录和命令后才能执行', 'PLUGIN_INSTALL_CONFIRMATION_REQUIRED');
  }

  function resolveInstallRequest(payload = {}) {
    const catalogId = String(payload.catalogId || payload.id || '').trim();
    const item = getCatalogItem(catalogId);
    if (!item) {
      throw createHttpError(404, '未找到插件目录项', 'PLUGIN_CATALOG_ITEM_NOT_FOUND');
    }
    if (!item.repo) {
      throw createHttpError(400, '该目录项缺少仓库地址，无法自动安装', 'PLUGIN_CATALOG_REPO_REQUIRED');
    }

    const pluginsDir = resolvePluginsDirectory();
    const pluginsRoot = getResolvedPathSafe(pluginsDir);
    if (!pluginsRoot || !fs.existsSync(pluginsRoot)) {
      throw createHttpError(500, '未找到 Yunzai plugins 目录', 'PLUGIN_ROOT_NOT_FOUND');
    }

    const directoryName = normalizePluginDirectoryName(
      payload.directoryName,
      getCatalogDefaultDirectoryName(item) || getRepoName(item.repo, item.name),
    );
    if (!directoryName) {
      throw createHttpError(400, '无法识别插件目录名', 'PLUGIN_DIRECTORY_NAME_REQUIRED');
    }

    const declaredTargetDir = path.resolve(pluginsRoot, directoryName);
    const targetDir = getResolvedPathSafe(declaredTargetDir);
    if (isSameResolvedPath(targetDir, pluginsRoot) || !isSubPath(pluginsRoot, targetDir)) {
      throw createHttpError(400, '插件安装路径越界', 'PLUGIN_TARGET_OUTSIDE_ROOT');
    }
    if (!isSameResolvedPath(path.dirname(declaredTargetDir), pluginsRoot)) {
      throw createHttpError(400, '插件安装目标必须是 plugins 下的直接插件目录', 'PLUGIN_TARGET_DEPTH_INVALID');
    }
    if (fs.existsSync(targetDir)) {
      throw createHttpError(409, '目标插件目录已存在', 'PLUGIN_TARGET_EXISTS');
    }

    return {
      item,
      pluginsRoot,
      directoryName,
      targetDir,
      installDependencies: payload.installDependencies === true,
    };
  }

  async function precheckInstallTask(payload = {}) {
    pruneTasks();
    const request = resolveInstallRequest(payload);
    const checks = [];
    const addCheck = (key, label, ok, detail = '') => {
      checks.push({ key, label, ok: ok === true, detail: String(detail || '') });
    };

    addCheck('pluginsRoot', 'plugins 目录可用', true, toRelativeConsolePath(request.pluginsRoot));
    try {
      fs.accessSync(request.pluginsRoot, fs.constants.R_OK | fs.constants.W_OK);
      addCheck('pluginsRootWritable', 'plugins 目录可读写', true);
    } catch {
      addCheck('pluginsRootWritable', 'plugins 目录可读写', false, '当前运行账号无法读写 plugins 目录');
    }

    const activeTask = findActiveTargetTask(request.targetDir);
    addCheck('targetPath', '目标目录安全', true, toRelativeConsolePath(request.targetDir));
    addCheck('targetAvailable', '目标目录未存在', !fs.existsSync(request.targetDir), fs.existsSync(request.targetDir) ? '目标目录已存在' : '');
    addCheck('targetNotBusy', '目标目录没有正在执行的安装任务', !activeTask, activeTask ? `已有任务 ${activeTask.id} 正在执行` : '');

    const gitResult = await runProcess(process.platform === 'win32' ? 'git.exe' : 'git', ['--version'], {
      cwd: request.pluginsRoot,
      timeoutMs: PLUGIN_CATALOG_PRECHECK_TIMEOUT_MS,
      label: 'git-precheck',
    });
    addCheck('git', 'Git 可用', gitResult.status === 0, gitResult.stdoutTail || gitResult.stderrTail || `exit ${gitResult.status}`);

    const packageCandidates = resolvePreferredPackageManagers(request.pluginsRoot, {
      rootDirs: [request.pluginsRoot, process.cwd()],
    });
    addCheck('packageManagerCandidates', '包管理器候选', packageCandidates.length > 0, packageCandidates.join(' / '));

    const ok = checks.every(item => item.ok);
    return {
      success: true,
      ok,
      catalogId: request.item.id,
      pluginName: request.item.name,
      repo: request.item.repo,
      directoryName: request.directoryName,
      targetDir: toRelativeConsolePath(request.targetDir),
      installDependencies: request.installDependencies,
      packageManagerCandidates: packageCandidates,
      checks,
      checkedAt: new Date().toISOString(),
    };
  }

  async function executeTask(task = {}) {
    task.status = 'running';
    task.stage = 'clone';
    task.startedAt = new Date().toISOString();
    task.command = ['git', 'clone', '--depth=1', task.repo, task.targetDir];
    try {
      updateInstallStep(task, 'clone', {
        status: 'running',
        startedAt: task.startedAt,
        command: task.command,
        message: '正在克隆插件仓库',
      });
      logger.mark?.(`[webConsole] 开始安装插件: ${task.pluginName} -> ${task.targetDir}`);
      const cloneResult = await runProcess('git', ['clone', '--depth=1', task.repo, task.targetDir], {
        cwd: task.pluginsRoot,
        task,
        timeoutMs: PLUGIN_CATALOG_CLONE_TIMEOUT_MS,
        label: 'git clone',
      });
      if (cloneResult.canceled || task.canceled === true) {
        updateInstallStep(task, 'clone', {
          status: 'error',
          finishedAt: new Date().toISOString(),
          exitCode: cloneResult.status,
          message: '插件安装任务已取消',
        });
        task.status = 'error';
        task.stage = 'cancelled';
        task.error = '插件安装任务已取消';
        detectTaskResidue(task, '任务取消后目标目录可能残留半成品，请手动检查后处理。');
        return task;
      }
      if (cloneResult.timedOut || cloneResult.status !== 0) {
        updateInstallStep(task, 'clone', {
          status: 'error',
          finishedAt: new Date().toISOString(),
          exitCode: cloneResult.status,
          message: cloneResult.timedOut
            ? '插件仓库克隆超时'
            : cloneResult.stderrTail || cloneResult.stdoutTail || `插件仓库克隆失败，退出码: ${cloneResult.status}`,
        });
        task.status = 'error';
        task.error = cloneResult.timedOut
          ? '插件仓库克隆超时'
          : cloneResult.stderrTail || cloneResult.stdoutTail || `插件仓库克隆失败，退出码: ${cloneResult.status}`;
        detectTaskResidue(task, '克隆失败后目标目录可能残留半成品，请手动检查后处理。');
        return task;
      }
      updateInstallStep(task, 'clone', {
        status: 'success',
        finishedAt: new Date().toISOString(),
        exitCode: cloneResult.status,
        message: '插件仓库克隆成功',
      });

      const manifestPath = path.join(task.targetDir, 'package.json');
      if (task.installDependencies && fs.existsSync(manifestPath)) {
        task.stage = 'install-dependencies';
        const manifest = readJsonFileSafe(manifestPath, {}) || {};
        task.packageManagerCandidates = resolvePreferredPackageManagers(task.targetDir, {
          manifest,
          rootDirs: [task.pluginsRoot, process.cwd()],
        });
        const packageManager = await resolveAvailablePackageManager(task.targetDir, {
          manifest,
          rootDirs: [task.pluginsRoot, process.cwd()],
          runProcess,
          timeoutMs: 15000,
        });
        task.packageManager = packageManager.manager;
        task.packageManagerCandidates = packageManager.candidates;
        const installCommand = buildPackageInstallCommand(packageManager.manager);
        task.command = installCommand.displayCommand;
        updateInstallStep(task, 'dependencies', {
          status: 'running',
          startedAt: new Date().toISOString(),
          command: task.command,
          message: `正在使用 ${packageManager.manager}${packageManager.version ? ` ${packageManager.version}` : ''} 安装插件依赖`,
        });
        const installResult = await runProcess(installCommand.command, installCommand.args, {
          cwd: task.targetDir,
          task,
          timeoutMs: PLUGIN_CATALOG_INSTALL_TIMEOUT_MS,
          label: `${packageManager.manager} install`,
        });
        if (installResult.canceled || task.canceled === true) {
          updateInstallStep(task, 'dependencies', {
            status: 'error',
            finishedAt: new Date().toISOString(),
            exitCode: installResult.status,
            message: '插件依赖安装已取消',
          });
          task.status = 'error';
          task.stage = 'cancelled';
          task.error = '插件依赖安装已取消';
          detectTaskResidue(task, '依赖安装取消后目标目录可能残留半成品，请手动检查后处理。');
          return task;
        }
        if (installResult.timedOut || installResult.status !== 0) {
          updateInstallStep(task, 'dependencies', {
            status: 'error',
            finishedAt: new Date().toISOString(),
            exitCode: installResult.status,
            message: installResult.timedOut
              ? '插件依赖安装超时'
              : installResult.stderrTail || installResult.stdoutTail || `插件依赖安装失败，退出码: ${installResult.status}`,
          });
          task.status = 'error';
          task.error = installResult.timedOut
            ? '插件依赖安装超时'
            : installResult.stderrTail || installResult.stdoutTail || `插件依赖安装失败，退出码: ${installResult.status}`;
          detectTaskResidue(task, '依赖安装失败后插件目录已存在，请手动确认依赖状态。');
          return task;
        }
        updateInstallStep(task, 'dependencies', {
          status: 'success',
          finishedAt: new Date().toISOString(),
          exitCode: installResult.status,
          message: `插件依赖安装成功，包管理器: ${packageManager.manager}`,
        });
      } else if (task.installDependencies) {
        updateInstallStep(task, 'dependencies', {
          status: 'skipped',
          finishedAt: new Date().toISOString(),
          command: [],
          message: '目标插件没有 package.json，已跳过依赖安装',
        });
      }

      task.stage = 'done';
      task.status = 'success';
      task.error = '';
      logger.mark?.(`[webConsole] 插件安装完成: ${task.pluginName}`);
      return task;
    } catch (error) {
      const failedStepKey = task.stage === 'install-dependencies' ? 'dependencies' : 'clone';
      updateInstallStep(task, failedStepKey, {
        status: 'error',
        finishedAt: new Date().toISOString(),
        message: String(error?.message || '插件安装失败').trim(),
      });
      task.status = 'error';
      task.error = String(error?.message || '插件安装失败').trim();
      detectTaskResidue(task, '插件安装异常后目标目录可能残留半成品，请手动检查后处理。');
      logger.error?.(`[webConsole] 插件安装失败: ${task.pluginName} -> ${task.error}`);
      return task;
    } finally {
      task.finishedAt = new Date().toISOString();
      recordInstallOperation('plugin_install_task_finished', task);
      pruneTasks();
      persistTasks();
    }
  }

  async function createInstallTask(payload = {}) {
    pruneTasks();
    assertConfirmedPluginInstall(payload);
    const request = resolveInstallRequest(payload);
    const activeTask = findActiveTargetTask(request.targetDir);
    if (activeTask) {
      throw createHttpError(409, `目标目录已有安装任务正在执行: ${activeTask.id}`, 'PLUGIN_TARGET_INSTALL_BUSY');
    }

    const task = {
      id: createTaskId(),
      catalogId: request.item.id,
      pluginName: request.item.name,
      repo: request.item.repo,
      directoryName: request.directoryName,
      pluginsRoot: request.pluginsRoot,
      targetDir: request.targetDir,
      relativeTargetDir: toRelativeConsolePath(request.targetDir),
      status: 'pending',
      stage: 'pending',
      createdAt: new Date().toISOString(),
      startedAt: '',
      finishedAt: '',
      command: [],
      installDependencies: request.installDependencies,
      packageManager: '',
      packageManagerCandidates: [],
      steps: [
        createInstallStep('clone', '克隆仓库', true, ['git', 'clone', '--depth=1', request.item.repo, request.targetDir]),
        createInstallStep('dependencies', '安装依赖', request.installDependencies, []),
      ],
      stdoutTail: '',
      stderrTail: '',
      error: '',
      timedOut: false,
      canceled: false,
      cancelRequestedAt: '',
      residue: null,
    };
    pluginInstallTasks.set(task.id, task);
    persistTasks();
    recordInstallOperation('plugin_install_task_created', task);
    setImmediate(() => {
      executeTask(task).catch(error => {
        task.status = 'error';
        task.error = String(error?.message || '插件安装任务启动失败').trim();
        task.finishedAt = new Date().toISOString();
        recordInstallOperation('plugin_install_task_finished', task);
        persistTasks();
      });
    });
    return task;
  }

  function getTask(taskId = '') {
    pruneTasks();
    const task = pluginInstallTasks.get(String(taskId || '').trim());
    if (!task) {
      throw createHttpError(404, '未找到插件安装任务', 'PLUGIN_INSTALL_TASK_NOT_FOUND');
    }
    return task;
  }

  function cancelInstallTask(taskId = '') {
    const task = getTask(taskId);
    if (!isTaskActive(task)) {
      throw createHttpError(409, '插件安装任务已经结束，无法取消', 'PLUGIN_INSTALL_TASK_NOT_ACTIVE');
    }
    task.canceled = true;
    task.cancelRequestedAt = new Date().toISOString();
    task.error = '正在取消插件安装任务';
    recordInstallOperation('plugin_install_task_cancel_requested', task, {
      result: 'success',
      statusCode: 202,
    });
    if (task.currentProcess && typeof task.currentProcess.kill === 'function') {
      try {
        task.currentProcess.kill('SIGTERM');
      } catch {
        // Ignore process termination race.
      }
    } else {
      task.status = 'error';
      task.stage = 'cancelled';
      task.finishedAt = new Date().toISOString();
      task.error = '插件安装任务已取消';
      detectTaskResidue(task, '任务取消后目标目录可能残留半成品，请手动检查后处理。');
    }
    persistTasks();
    return task;
  }

  function listTasks(options = {}) {
    pruneTasks();
    const activeOnly = options.activeOnly === true;
    const limit = Math.max(1, Math.min(80, Number(options.limit || 20)));
    return Array.from(pluginInstallTasks.values())
      .filter(task => !activeOnly || (task.status !== 'success' && task.status !== 'error'))
      .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))
      .slice(0, limit)
      .map(serializeTask);
  }

  loadPersistedTasks();

  return {
    precheckInstallTask,
    createInstallTask,
    cancelInstallTask,
    getTask,
    listTasks,
    serializeTask,
  };
}
