import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT = 4000;
const DEPENDENCY_INSTALL_TASK_TTL_MS = 30 * 60 * 1000;
const DEPENDENCY_INSTALL_TASK_MAX_COUNT = 80;

const DEPENDENCY_GROUPS = [
  { key: 'runtime', label: '运行依赖', field: 'dependencies', required: true, installSupported: true },
  { key: 'dev', label: '开发依赖', field: 'devDependencies', required: false, installSupported: true },
  { key: 'peer', label: 'Peer 依赖', field: 'peerDependencies', required: false, installSupported: false },
  { key: 'optional', label: '可选依赖', field: 'optionalDependencies', required: false, installSupported: false },
];

function defaultCreateHttpError(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(String(message || 'Internal Server Error'));
  error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
  if (code) {
    error.code = String(code);
  }
  return error;
}

function defaultReadJsonFileSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function defaultGetResolvedPathSafe(targetPath = '') {
  try {
    if (!targetPath) {
      return '';
    }
    if (typeof fs.realpathSync.native === 'function') {
      return fs.realpathSync.native(targetPath);
    }
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath || '');
  }
}

function defaultIsSubPath(parentPath = '', targetPath = '') {
  if (!parentPath || !targetPath) {
    return false;
  }
  const relativePath = path.relative(parentPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function trimOutputTail(text = '', maxLength = 4000) {
  const content = String(text || '').trim();
  if (!content) {
    return '';
  }
  return content.length > maxLength ? content.slice(-maxLength) : content;
}

function appendOutputTail(current = '', chunk = '', maxLength = DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT) {
  const next = `${current}${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')}`;
  return next.length > maxLength ? next.slice(-maxLength) : next;
}

export function createDependencyConsole(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const yunzaiDir = options.yunzaiDir || process.cwd();
  const packageJsonFile = options.packageJsonFile || path.join(rootDir, 'package.json');
  const packageLockFile = options.packageLockFile || path.join(rootDir, 'package-lock.json');
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : defaultCreateHttpError;
  const readJsonFileSafe = typeof options.readJsonFileSafe === 'function'
    ? options.readJsonFileSafe
    : defaultReadJsonFileSafe;
  const getResolvedPathSafe = typeof options.getResolvedPathSafe === 'function'
    ? options.getResolvedPathSafe
    : defaultGetResolvedPathSafe;
  const toRelativeConsolePath = typeof options.toRelativeConsolePath === 'function'
    ? options.toRelativeConsolePath
    : (targetPath = '') => (targetPath ? path.relative(process.cwd(), targetPath).replace(/\\/g, '/') : '');
  const isSubPath = typeof options.isSubPath === 'function'
    ? options.isSubPath
    : defaultIsSubPath;
  const resolvePluginsDirectory = typeof options.resolvePluginsDirectory === 'function'
    ? options.resolvePluginsDirectory
    : (() => {
      const candidates = [
        path.join(process.cwd(), 'plugins'),
        path.join(yunzaiDir, 'plugins'),
      ];
      for (const candidate of candidates) {
        try {
          if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            return candidate;
          }
        } catch {
          // Ignore inaccessible candidate directories and continue probing.
        }
      }
      return '';
    });
  const logger = {
    info: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
    warn: (...args) => console.warn(...args),
    mark: (...args) => console.log(...args),
    ...(options.logger || {}),
  };

  const dependencyInstallTasks = new Map();
  const dependencyInstallActiveTaskKeys = new Map();
  const dependencyInstallTargetLocks = new Map();

  function getDependencyGroupConfig(groupKey = '') {
    return DEPENDENCY_GROUPS.find(item => item.key === groupKey) || null;
  }

  function isDependencyInstallSupported(groupKey = '') {
    return Boolean(getDependencyGroupConfig(groupKey)?.installSupported);
  }

  function resolveInstalledDependencyInfo(name, startDir = rootDir) {
    const packageNameSegments = String(name || '').split('/').filter(Boolean);
    const searchPaths = Array.from(new Set(
      [getResolvedPathSafe(startDir), getResolvedPathSafe(rootDir), getResolvedPathSafe(process.cwd())].filter(Boolean)
    ));

    const readInstalledPackage = packageJsonPath => {
      if (!packageJsonPath || !fs.existsSync(packageJsonPath)) {
        return null;
      }
      const packageInfo = readJsonFileSafe(packageJsonPath, null);
      if (packageInfo?.name !== name) {
        return null;
      }
      return {
        installed: true,
        version: String(packageInfo.version || '').trim(),
        packagePath: packageJsonPath,
      };
    };

    for (const searchPath of searchPaths) {
      let currentSearchDir = searchPath;
      while (currentSearchDir && currentSearchDir !== path.dirname(currentSearchDir)) {
        const directPackageJsonPath = path.join(currentSearchDir, 'node_modules', ...packageNameSegments, 'package.json');
        const directInstalled = readInstalledPackage(directPackageJsonPath);
        if (directInstalled) {
          return directInstalled;
        }
        currentSearchDir = path.dirname(currentSearchDir);
      }

      try {
        const packageJsonPath = require.resolve(`${name}/package.json`, { paths: [searchPath] });
        const packageInstalled = readInstalledPackage(packageJsonPath);
        if (packageInstalled) {
          return packageInstalled;
        }
      } catch {
        // Ignore package.json resolution failures and fall back to entry probing.
      }

      try {
        const entryPath = require.resolve(name, { paths: [searchPath] });
        let currentDir = path.dirname(entryPath);
        while (currentDir && currentDir !== path.dirname(currentDir)) {
          const installedPackage = readInstalledPackage(path.join(currentDir, 'package.json'));
          if (installedPackage) {
            return installedPackage;
          }
          currentDir = path.dirname(currentDir);
        }
      } catch {
        // Ignore entry resolution failures for missing or non-standard packages.
      }
    }
    return {
      installed: false,
      version: '',
      packagePath: '',
    };
  }

  function createDependencyItem(payload = {}) {
    const dependencyType = payload.dependencyType || payload.group || '';
    const status = payload.status || 'ok';
    return {
      ...payload,
      installable: isDependencyInstallSupported(dependencyType) && (status === 'missing' || status === 'not_installed'),
      installScope: payload.installScope || 'current',
    };
  }

  function buildOtherPluginDependencyReport() {
    const pluginsDir = resolvePluginsDirectory();
    const currentPluginRoot = getResolvedPathSafe(rootDir);
    const items = [];
    const pluginIds = new Set();
    const dependencyGroups = [
      { key: 'runtime', label: '运行依赖', field: 'dependencies', required: true },
      { key: 'dev', label: '开发依赖', field: 'devDependencies', required: false },
      { key: 'peer', label: 'Peer 依赖', field: 'peerDependencies', required: false },
      { key: 'optional', label: '可选依赖', field: 'optionalDependencies', required: false },
    ];

    if (!pluginsDir) {
      return {
        summary: {
          checkedAt: new Date().toISOString(),
          pluginsDir: '',
          pluginsDirExists: false,
          pluginCount: 0,
          totalCount: 0,
          installedCount: 0,
          problemCount: 0,
          runtimeCount: 0,
          runtimeMissingCount: 0,
          devCount: 0,
          devMissingCount: 0,
          peerCount: 0,
          peerMissingCount: 0,
          optionalCount: 0,
          optionalMissingCount: 0,
        },
        items,
      };
    }

    let entries = [];
    try {
      entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry?.isDirectory?.()) {
        continue;
      }

      const pluginDir = path.join(pluginsDir, entry.name);
      const pluginRoot = getResolvedPathSafe(pluginDir);
      if (!pluginRoot || pluginRoot === currentPluginRoot) {
        continue;
      }

      const packageJsonPath = path.join(pluginDir, 'package.json');
      const manifest = readJsonFileSafe(packageJsonPath, null);
      if (!manifest || typeof manifest !== 'object') {
        continue;
      }

      pluginIds.add(entry.name);
      const pluginName = String(manifest.name || entry.name).trim() || entry.name;

      for (const group of dependencyGroups) {
        const groupEntries = manifest[group.field];
        if (!groupEntries || typeof groupEntries !== 'object') {
          continue;
        }

        for (const name of Object.keys(groupEntries).sort((a, b) => a.localeCompare(b))) {
          const declaredVersion = String(groupEntries[name] || '').trim();
          const installedInfo = resolveInstalledDependencyInfo(name, pluginDir);
          let status = 'ok';
          let level = 'success';

          if (!installedInfo.installed) {
            status = group.required ? 'missing' : 'not_installed';
            level = group.required ? 'error' : 'warn';
          }

          items.push(createDependencyItem({
            pluginId: entry.name,
            pluginName,
            pluginDir: toRelativeConsolePath(pluginDir),
            manifestPath: toRelativeConsolePath(packageJsonPath),
            dependencyType: group.key,
            dependencyTypeLabel: group.label,
            name,
            declaredVersion,
            installed: installedInfo.installed,
            installedVersion: installedInfo.version,
            packagePath: installedInfo.packagePath ? toRelativeConsolePath(installedInfo.packagePath) : '',
            status,
            level,
            installScope: 'plugin',
          }));
        }
      }
    }

    const runtimeItems = items.filter(item => item.dependencyType === 'runtime');
    const devItems = items.filter(item => item.dependencyType === 'dev');
    const peerItems = items.filter(item => item.dependencyType === 'peer');
    const optionalItems = items.filter(item => item.dependencyType === 'optional');
    const problemItems = items.filter(item => item.status !== 'ok');

    return {
      summary: {
        checkedAt: new Date().toISOString(),
        pluginsDir: toRelativeConsolePath(pluginsDir),
        pluginsDirExists: true,
        pluginCount: pluginIds.size,
        totalCount: items.length,
        installedCount: items.filter(item => item.installed).length,
        problemCount: problemItems.length,
        runtimeCount: runtimeItems.length,
        runtimeMissingCount: runtimeItems.filter(item => item.status === 'missing').length,
        devCount: devItems.length,
        devMissingCount: devItems.filter(item => item.status === 'not_installed').length,
        peerCount: peerItems.length,
        peerMissingCount: peerItems.filter(item => item.status === 'not_installed').length,
        optionalCount: optionalItems.length,
        optionalMissingCount: optionalItems.filter(item => item.status === 'not_installed').length,
      },
      items,
    };
  }

  function buildDependencyReport(options = {}) {
    const includeOtherPlugins = options.includeOtherPlugins === true;
    const manifest = readJsonFileSafe(packageJsonFile, {}) || {};
    const lockfile = readJsonFileSafe(packageLockFile, {}) || {};
    const lockPackages = lockfile?.packages || {};
    const groups = [
      { key: 'runtime', label: '运行依赖', entries: manifest.dependencies || {}, required: true },
      { key: 'dev', label: '开发依赖', entries: manifest.devDependencies || {}, required: false },
    ];
    const items = [];

    for (const group of groups) {
      for (const name of Object.keys(group.entries || {}).sort((a, b) => a.localeCompare(b))) {
        const declaredVersion = String(group.entries[name] || '').trim();
        const lockVersion = String(lockPackages[`node_modules/${name}`]?.version || '').trim();
        const installedInfo = resolveInstalledDependencyInfo(name, rootDir);
        let status = 'ok';
        let level = 'success';

        if (!installedInfo.installed) {
          status = group.required ? 'missing' : 'not_installed';
          level = group.required ? 'error' : 'warn';
        } else if (lockVersion && installedInfo.version && lockVersion !== installedInfo.version) {
          status = 'version_mismatch';
          level = 'warn';
        }

        items.push(createDependencyItem({
          name,
          group: group.key,
          groupLabel: group.label,
          dependencyType: group.key,
          declaredVersion,
          lockVersion,
          installedVersion: installedInfo.version,
          installed: installedInfo.installed,
          packagePath: installedInfo.packagePath ? toRelativeConsolePath(installedInfo.packagePath) : '',
          status,
          level,
          installScope: 'current',
        }));
      }
    }

    const runtimeItems = items.filter(item => item.group === 'runtime');
    const devItems = items.filter(item => item.group === 'dev');
    const runtimeMissing = runtimeItems.filter(item => item.status === 'missing');
    const runtimeMismatch = runtimeItems.filter(item => item.status === 'version_mismatch');
    const devMissing = devItems.filter(item => item.status === 'not_installed');
    const devMismatch = devItems.filter(item => item.status === 'version_mismatch');
    const problemItems = items.filter(item => item.status !== 'ok');

    return {
      summary: {
        status: runtimeMissing.length > 0 ? 'error' : problemItems.length > 0 ? 'warn' : 'healthy',
        checkedAt: new Date().toISOString(),
        totalCount: items.length,
        installedCount: items.filter(item => item.installed).length,
        problemCount: problemItems.length,
        runtimeCount: runtimeItems.length,
        runtimeInstalledCount: runtimeItems.filter(item => item.installed).length,
        runtimeMissingCount: runtimeMissing.length,
        runtimeMismatchCount: runtimeMismatch.length,
        devCount: devItems.length,
        devInstalledCount: devItems.filter(item => item.installed).length,
        devMissingCount: devMissing.length,
        devMismatchCount: devMismatch.length,
        manifestExists: fs.existsSync(packageJsonFile),
        lockfileExists: fs.existsSync(packageLockFile),
        projectRoot: toRelativeConsolePath(rootDir),
        manifestPath: toRelativeConsolePath(packageJsonFile),
      },
      items,
      problemItems,
      otherPluginDependencies: includeOtherPlugins ? buildOtherPluginDependencyReport() : undefined,
    };
  }

  function buildDependencyReportSummaryOnly(report = {}) {
    const summary = report?.summary && typeof report.summary === 'object' ? report.summary : {};
    const safeSummary = { ...summary };
    delete safeSummary.projectRoot;
    delete safeSummary.manifestPath;
    return {
      summary: safeSummary,
    };
  }

  function createDependencyInstallTaskId() {
    return `dep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function buildDependencyInstallTaskKey(payload = {}) {
    return [
      String(payload.scope || 'current').trim().toLowerCase() || 'current',
      String(payload.pluginId || '').trim() || 'self',
      String(payload.dependencyType || payload.group || '').trim() || 'unknown',
      String(payload.name || '').trim() || '',
    ].join(':');
  }

  function isDependencyInstallTaskFinished(task = {}) {
    const status = String(task.status || '').trim().toLowerCase();
    return status === 'success' || status === 'error';
  }

  function releaseDependencyInstallTaskKey(task = {}) {
    const taskId = String(task.id || '').trim();
    const key = String(task.key || '').trim();
    if (taskId && key && dependencyInstallActiveTaskKeys.get(key) === taskId) {
      dependencyInstallActiveTaskKeys.delete(key);
    }
  }

  function pruneDependencyInstallTasks() {
    const now = Date.now();
    for (const [taskId, task] of dependencyInstallTasks.entries()) {
      if (!task?.finishedAt) {
        continue;
      }
      const finishedAt = Date.parse(task.finishedAt);
      if (Number.isFinite(finishedAt) && now - finishedAt > DEPENDENCY_INSTALL_TASK_TTL_MS) {
        releaseDependencyInstallTaskKey(task);
        dependencyInstallTasks.delete(taskId);
      }
    }

    if (dependencyInstallTasks.size <= DEPENDENCY_INSTALL_TASK_MAX_COUNT) {
      return;
    }

    const removable = Array.from(dependencyInstallTasks.values())
      .filter(task => task?.finishedAt)
      .sort((a, b) => Date.parse(a.finishedAt || 0) - Date.parse(b.finishedAt || 0));

    while (dependencyInstallTasks.size > DEPENDENCY_INSTALL_TASK_MAX_COUNT && removable.length > 0) {
      const task = removable.shift();
      if (task?.id) {
        releaseDependencyInstallTaskKey(task);
        dependencyInstallTasks.delete(task.id);
      }
    }
  }

  function serializeDependencyInstallTask(task = {}) {
    return {
      id: String(task.id || '').trim(),
      key: String(task.key || '').trim(),
      scope: String(task.scope || 'current').trim(),
      pluginId: String(task.pluginId || '').trim(),
      dependencyType: String(task.dependencyType || '').trim(),
      name: String(task.name || '').trim(),
      declaredVersion: String(task.declaredVersion || '').trim(),
      status: String(task.status || 'pending').trim(),
      createdAt: task.createdAt || '',
      startedAt: task.startedAt || '',
      finishedAt: task.finishedAt || '',
      packageManager: String(task.packageManager || '').trim(),
      command: Array.isArray(task.command) ? task.command : [],
      targetDir: String(task.targetDir || '').trim(),
      stdoutTail: trimOutputTail(task.stdoutTail || '', DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT),
      stderrTail: trimOutputTail(task.stderrTail || '', DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT),
      error: String(task.error || '').trim(),
      timedOut: Boolean(task.timedOut),
    };
  }

  function listDependencyInstallTasks(options = {}) {
    pruneDependencyInstallTasks();
    const activeOnly = options.activeOnly === true;
    const finishedOnly = options.finishedOnly === true;
    const parsedLimit = Number.parseInt(String(options.limit || ''), 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(50, parsedLimit))
      : 20;
    return Array.from(dependencyInstallTasks.values())
      .filter(task => {
        const finished = isDependencyInstallTaskFinished(task);
        if (activeOnly) {
          return !finished;
        }
        if (finishedOnly) {
          return finished;
        }
        return true;
      })
      .sort((a, b) => {
        const leftTime = Date.parse((finishedOnly ? a.finishedAt : a.createdAt) || a.finishedAt || a.createdAt || 0);
        const rightTime = Date.parse((finishedOnly ? b.finishedAt : b.createdAt) || b.finishedAt || b.createdAt || 0);
        return rightTime - leftTime;
      })
      .slice(0, limit)
      .map(task => serializeDependencyInstallTask(task));
  }

  function clearDependencyInstallHistory() {
    pruneDependencyInstallTasks();
    let removedCount = 0;
    for (const [taskId, task] of dependencyInstallTasks.entries()) {
      if (!isDependencyInstallTaskFinished(task)) {
        continue;
      }
      releaseDependencyInstallTaskKey(task);
      dependencyInstallTasks.delete(taskId);
      removedCount += 1;
    }
    return {
      removedCount,
      tasks: listDependencyInstallTasks({ finishedOnly: true }),
    };
  }

  async function runDependencyInstallTargetExclusive(targetKey = '', runner = async () => {}) {
    const normalizedTargetKey = String(targetKey || '').trim() || '__default__';
    const previous = dependencyInstallTargetLocks.get(normalizedTargetKey) || Promise.resolve();
    let releaseLock = () => {};
    const current = new Promise(resolve => {
      releaseLock = resolve;
    });

    dependencyInstallTargetLocks.set(normalizedTargetKey, current);
    await previous.catch(() => {});

    try {
      return await runner();
    } finally {
      releaseLock();
      if (dependencyInstallTargetLocks.get(normalizedTargetKey) === current) {
        dependencyInstallTargetLocks.delete(normalizedTargetKey);
      }
    }
  }

  function runProcessAsync(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      let stdoutTail = '';
      let stderrTail = '';
      let timeoutHandle = null;
      let forceKillHandle = null;
      let timedOut = false;
      let settled = false;

      const finish = result => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (forceKillHandle) {
          clearTimeout(forceKillHandle);
        }
        resolve({
          ...result,
          stdoutTail: trimOutputTail(stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT),
          stderrTail: trimOutputTail(stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT),
        });
      };

      const fail = error => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (forceKillHandle) {
          clearTimeout(forceKillHandle);
        }
        error.stdoutTail = trimOutputTail(stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        error.stderrTail = trimOutputTail(stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        reject(error);
      };

      const normalizedCommand = String(command || '').trim();
      const useWindowsCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(normalizedCommand);
      const spawnCommand = useWindowsCmdShim ? (process.env.comspec || 'cmd.exe') : normalizedCommand;
      const spawnArgs = useWindowsCmdShim ? ['/d', '/s', '/c', normalizedCommand, ...args] : args;

      const child = spawn(spawnCommand, spawnArgs, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', chunk => {
        stdoutTail = appendOutputTail(stdoutTail, chunk);
        if (typeof options.onStdout === 'function') {
          options.onStdout(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || ''));
        }
      });

      child.stderr?.on('data', chunk => {
        stderrTail = appendOutputTail(stderrTail, chunk);
        if (typeof options.onStderr === 'function') {
          options.onStderr(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || ''));
        }
      });

      child.on('error', fail);
      child.on('close', (code, signal) => {
        finish({
          status: typeof code === 'number' ? code : -1,
          signal: signal || '',
          timedOut,
        });
      });

      const timeoutMs = Number(options.timeoutMs || 0);
      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          try {
            child.kill('SIGTERM');
          } catch {
            // Ignore termination races when the child has already exited.
          }
          forceKillHandle = setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // Ignore hard-kill failures after the process has exited on its own.
            }
          }, 5000);
        }, timeoutMs);
      }
    });
  }

  function resolveDependencyInstallTarget(payload = {}) {
    const scope = String(payload.scope || 'current').trim().toLowerCase();
    if (scope === 'plugin') {
      const pluginsDir = resolvePluginsDirectory();
      const pluginsRoot = getResolvedPathSafe(pluginsDir);
      const pluginId = String(payload.pluginId || '').trim();
      if (!pluginsRoot || !pluginId || pluginId !== path.basename(pluginId)) {
        throw createHttpError(400, '依赖安装目标无效', 'INVALID_INSTALL_TARGET');
      }

      const targetDir = getResolvedPathSafe(path.join(pluginsRoot, pluginId));
      if (!isSubPath(pluginsRoot, targetDir)) {
        throw createHttpError(400, '依赖安装目标越界', 'INVALID_INSTALL_TARGET');
      }

      const manifestPath = path.join(targetDir, 'package.json');
      if (!fs.existsSync(manifestPath)) {
        throw createHttpError(404, '目标插件缺少 package.json', 'TARGET_MANIFEST_MISSING');
      }

      return {
        scope: 'plugin',
        pluginId,
        targetDir,
        manifestPath,
      };
    }

    if (scope !== 'current') {
      throw createHttpError(400, '不支持的依赖安装范围', 'UNSUPPORTED_INSTALL_SCOPE');
    }

    const targetDir = getResolvedPathSafe(rootDir);
    const manifestPath = packageJsonFile;
    if (!fs.existsSync(manifestPath)) {
      throw createHttpError(500, '当前插件缺少 package.json', 'CURRENT_MANIFEST_MISSING');
    }

    return {
      scope: 'current',
      pluginId: '',
      targetDir,
      manifestPath,
    };
  }

  function resolvePreferredPackageManagers(targetDir, manifest = null) {
    const candidates = [];
    const addCandidate = (value = '') => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized || candidates.includes(normalized)) {
        return;
      }
      if (normalized === 'pnpm' || normalized === 'npm' || normalized === 'yarn') {
        candidates.push(normalized);
      }
    };

    const manifestData = manifest || readJsonFileSafe(path.join(targetDir, 'package.json'), {}) || {};
    const packageManagerName = String(manifestData.packageManager || '').trim().split('@')[0];
    addCandidate(packageManagerName);

    const lockfileChecks = [
      { file: 'pnpm-lock.yaml', manager: 'pnpm' },
      { file: 'package-lock.json', manager: 'npm' },
      { file: 'yarn.lock', manager: 'yarn' },
    ];
    const candidateDirs = Array.from(new Set(
      [targetDir, getResolvedPathSafe(rootDir), getResolvedPathSafe(yunzaiDir)].filter(Boolean)
    ));

    for (const dirPath of candidateDirs) {
      for (const item of lockfileChecks) {
        if (fs.existsSync(path.join(dirPath, item.file))) {
          addCandidate(item.manager);
        }
      }
    }

    addCandidate('npm');
    return candidates;
  }

  function resolvePackageManagerBinary(manager) {
    return process.platform === 'win32' ? `${manager}.cmd` : manager;
  }

  async function resolvePackageManager(targetDir, manifest = null) {
    const candidates = resolvePreferredPackageManagers(targetDir, manifest);
    let lastError = null;
    let lastFailureMessage = '';
    for (const candidate of candidates) {
      const command = resolvePackageManagerBinary(candidate);
      try {
        const result = await runProcessAsync(command, ['--version'], {
          cwd: targetDir,
          env: process.env,
          timeoutMs: 15000,
        });
        if (result.status === 0) {
          return candidate;
        }
        lastFailureMessage = result.stderrTail || result.stdoutTail || `exit ${result.status}`;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError && String(lastError.code || '').trim() && String(lastError.code || '').trim() !== 'ENOENT') {
      throw new Error(`检测包管理器失败: ${String(lastError.message || lastError.code).trim()}`);
    }
    if (lastFailureMessage) {
      throw new Error(`检测包管理器失败: ${lastFailureMessage}`);
    }
    throw new Error('未检测到可用的包管理器，请先安装 npm、pnpm 或 yarn');
  }

  function buildInstallCommandArgs(packageManager, dependencySpec, dependencyType) {
    if (dependencyType === 'dev') {
      if (packageManager === 'pnpm') {
        return ['add', '-D', dependencySpec];
      }
      if (packageManager === 'yarn') {
        return ['add', '--dev', dependencySpec];
      }
      return ['install', dependencySpec, '--save-dev'];
    }

    if (dependencyType === 'runtime') {
      if (packageManager === 'pnpm') {
        return ['add', '--prod', dependencySpec];
      }
      if (packageManager === 'yarn') {
        return ['add', dependencySpec];
      }
      return ['install', dependencySpec, '--save'];
    }

    throw createHttpError(400, '不支持的依赖类型', 'UNSUPPORTED_DEPENDENCY_TYPE');
  }

  function resolveDependencyInstallRequest(payload = {}) {
    const dependencyName = String(payload.name || '').trim();
    if (!dependencyName) {
      throw createHttpError(400, '缺少依赖名称', 'DEPENDENCY_NAME_REQUIRED');
    }

    const dependencyType = String(payload.dependencyType || payload.group || '').trim();
    const group = getDependencyGroupConfig(dependencyType);
    if (!group || !group.installSupported) {
      throw createHttpError(400, '不支持当前依赖类型', 'UNSUPPORTED_DEPENDENCY_TYPE');
    }

    const target = resolveDependencyInstallTarget(payload);
    const manifest = readJsonFileSafe(target.manifestPath, null);
    if (!manifest || typeof manifest !== 'object') {
      throw createHttpError(500, '读取目标 package.json 失败', 'TARGET_MANIFEST_READ_FAILED');
    }

    const declaredDependencies = manifest[group.field];
    if (!declaredDependencies || typeof declaredDependencies !== 'object' || !(dependencyName in declaredDependencies)) {
      throw createHttpError(409, '目标 package.json 中未声明该依赖', 'DEPENDENCY_DECLARATION_MISSING');
    }

    const declaredVersion = String(declaredDependencies[dependencyName] || '').trim();
    const requestedVersion = String(payload.declaredVersion || '').trim();
    if (requestedVersion && declaredVersion && requestedVersion !== declaredVersion) {
      throw createHttpError(409, '依赖声明版本已变化，请刷新后重试', 'DEPENDENCY_VERSION_CHANGED');
    }

    const installedInfo = resolveInstalledDependencyInfo(dependencyName, target.targetDir);
    if (installedInfo.installed) {
      throw createHttpError(409, '该依赖已安装，无需重复安装', 'DEPENDENCY_ALREADY_INSTALLED');
    }

    return {
      scope: target.scope,
      pluginId: target.pluginId,
      dependencyName,
      dependencyType: group.key,
      declaredVersion,
      dependencySpec: declaredVersion ? `${dependencyName}@${declaredVersion}` : dependencyName,
      target,
      manifest,
    };
  }

  function getDependencyInstallTask(taskId = '') {
    pruneDependencyInstallTasks();
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) {
      throw createHttpError(400, '缺少任务 ID', 'TASK_ID_REQUIRED');
    }

    const task = dependencyInstallTasks.get(normalizedTaskId);
    if (!task) {
      throw createHttpError(404, '未找到对应的安装任务', 'TASK_NOT_FOUND');
    }

    return task;
  }

  async function executeDependencyInstallTask(task = {}) {
    return runDependencyInstallTargetExclusive(task.targetKey || task.absoluteTargetDir, async () => {
      task.status = 'running';
      task.startedAt = new Date().toISOString();
      task.finishedAt = '';
      task.error = '';
      task.timedOut = false;
      task.stdoutTail = '';
      task.stderrTail = '';

      try {
        const packageManager = await resolvePackageManager(task.absoluteTargetDir, task.manifest || null);
        const command = resolvePackageManagerBinary(packageManager);
        const args = buildInstallCommandArgs(packageManager, task.dependencySpec, task.dependencyType);
        const commandLine = [command, ...args];

        task.packageManager = packageManager;
        task.command = commandLine;
        logger.mark(`[webConsole] 开始安装依赖: ${commandLine.join(' ')} @ ${task.absoluteTargetDir}`);

        const result = await runProcessAsync(command, args, {
          cwd: task.absoluteTargetDir,
          env: process.env,
          timeoutMs: 10 * 60 * 1000,
          onStdout: chunk => {
            task.stdoutTail = appendOutputTail(task.stdoutTail, chunk);
          },
          onStderr: chunk => {
            task.stderrTail = appendOutputTail(task.stderrTail, chunk);
          },
        });

        task.stdoutTail = trimOutputTail(result.stdoutTail || task.stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        task.stderrTail = trimOutputTail(result.stderrTail || task.stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        task.timedOut = Boolean(result.timedOut);

        if (result.timedOut) {
          task.status = 'error';
          task.error = '依赖安装已超时';
          return task;
        }

        if (result.status !== 0) {
          task.status = 'error';
          task.error = task.stderrTail || task.stdoutTail || `依赖安装失败，退出码: ${result.status}`;
          return task;
        }

        const installedInfo = resolveInstalledDependencyInfo(task.name, task.absoluteTargetDir);
        if (!installedInfo.installed) {
          task.status = 'error';
          task.error = `依赖安装命令已完成，但仍无法解析 ${task.name}。请检查 pnpm node_modules 链接或锁文件状态。`;
          return task;
        }

        task.status = 'success';
        task.error = '';
        logger.mark(`[webConsole] 依赖安装完成: ${commandLine.join(' ')} @ ${task.absoluteTargetDir}`);
        return task;
      } catch (error) {
        task.status = 'error';
        task.timedOut = Boolean(error?.timedOut);
        task.stdoutTail = trimOutputTail(error?.stdoutTail || task.stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        task.stderrTail = trimOutputTail(error?.stderrTail || task.stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        task.error = task.timedOut
          ? '依赖安装已超时'
          : String(error?.message || task.stderrTail || task.stdoutTail || '依赖安装失败').trim();
        logger.error(`[webConsole] 依赖安装失败: ${task.name} -> ${task.error}`);
        return task;
      } finally {
        task.finishedAt = new Date().toISOString();
        releaseDependencyInstallTaskKey(task);
        pruneDependencyInstallTasks();
      }
    });
  }

  async function createDependencyInstallTask(payload = {}) {
    pruneDependencyInstallTasks();

    const taskKey = buildDependencyInstallTaskKey(payload);
    const activeTaskId = dependencyInstallActiveTaskKeys.get(taskKey);
    if (activeTaskId) {
      const activeTask = dependencyInstallTasks.get(activeTaskId);
      if (activeTask && !isDependencyInstallTaskFinished(activeTask)) {
        return { task: activeTask, reused: true };
      }
      dependencyInstallActiveTaskKeys.delete(taskKey);
    }

    const request = resolveDependencyInstallRequest(payload);
    const task = {
      id: createDependencyInstallTaskId(),
      key: taskKey,
      targetKey: request.target.targetDir,
      scope: request.scope,
      pluginId: request.pluginId,
      dependencyType: request.dependencyType,
      name: request.dependencyName,
      declaredVersion: request.declaredVersion,
      status: 'pending',
      createdAt: new Date().toISOString(),
      startedAt: '',
      finishedAt: '',
      packageManager: '',
      command: [],
      targetDir: toRelativeConsolePath(request.target.targetDir),
      absoluteTargetDir: request.target.targetDir,
      dependencySpec: request.dependencySpec,
      manifest: request.manifest,
      stdoutTail: '',
      stderrTail: '',
      error: '',
      timedOut: false,
    };

    dependencyInstallTasks.set(task.id, task);
    dependencyInstallActiveTaskKeys.set(task.key, task.id);
    pruneDependencyInstallTasks();

    setImmediate(() => {
      executeDependencyInstallTask(task).catch(error => {
        task.status = 'error';
        task.finishedAt = new Date().toISOString();
        task.error = String(error?.message || 'Dependency install failed').trim();
        releaseDependencyInstallTaskKey(task);
        logger.error(`[webConsole] Dependency task bootstrap failed: ${task.name} -> ${task.error}`);
      });
    });

    return { task, reused: false };
  }

  return {
    buildDependencyReport,
    buildDependencyReportSummaryOnly,
    createDependencyInstallTask,
    serializeDependencyInstallTask,
    getDependencyInstallTask,
    listDependencyInstallTasks,
    clearDependencyInstallHistory,
  };
}
