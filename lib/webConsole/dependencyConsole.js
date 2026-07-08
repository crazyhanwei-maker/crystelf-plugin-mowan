import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import {
  resolveAvailablePackageManager,
  resolvePackageManagerBinary,
  resolvePreferredPackageManagers as resolvePreferredPackageManagersShared,
} from './packageManagerResolver.js';

const require = createRequire(import.meta.url);

const DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT = 4000;
const DEPENDENCY_INSTALL_TASK_TTL_MS = 30 * 60 * 1000;
const DEPENDENCY_INSTALL_TASK_MAX_COUNT = 80;
const DEPENDENCY_INSTALL_TASK_OUTPUT_EVENT_LIMIT = 80;

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

function redactDependencyTaskText(value = '') {
  return String(value || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|password|passwd|pwd|secret|cookie|token)\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|password|passwd|pwd|secret|cookie|token)"?\s*:\s*)("[^"]+"|'[^']+'|[^\s,;{}]+)/gi, '$1[REDACTED]');
}

function pushDependencyInstallTaskEvent(task = {}, event = {}) {
  if (!task || typeof task !== 'object') {
    return;
  }
  const events = Array.isArray(task.events) ? task.events : [];
  events.push({
    time: new Date().toISOString(),
    level: String(event.level || 'info').trim() || 'info',
    stage: String(event.stage || task.currentStage || '').trim(),
    message: String(event.message || '').trim(),
  });
  task.events = events.slice(-40);
}

function pushDependencyInstallTaskOutputEvent(task = {}, stream = 'stdout', chunk = '') {
  if (!task || typeof task !== 'object') {
    return;
  }
  const text = redactDependencyTaskText(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')).trim();
  if (!text) {
    return;
  }
  const events = Array.isArray(task.outputEvents) ? task.outputEvents : [];
  events.push({
    time: new Date().toISOString(),
    stream: stream === 'stderr' ? 'stderr' : 'stdout',
    stage: String(task.currentStage || '').trim(),
    text: text.length > 1000 ? `${text.slice(0, 1000)}...` : text,
  });
  task.outputEvents = events.slice(-DEPENDENCY_INSTALL_TASK_OUTPUT_EVENT_LIMIT);
  task.latestOutputAt = new Date().toISOString();
}

function getDependencyInstallProgress(task = {}) {
  const status = String(task.status || '').trim();
  if (status === 'success') return { percent: 100, label: '安装完成' };
  if (status === 'error') return { percent: 100, label: task.failedStage ? `失败：${task.failedStage}` : '安装失败' };
  if (status === 'pending') return { percent: 5, label: '等待执行' };
  const stage = String(task.currentStage || '').trim();
  if (stage.includes('检测包管理器')) return { percent: 20, label: stage };
  if (stage.includes('执行安装命令')) return { percent: 60, label: stage };
  if (stage.includes('验证安装结果')) return { percent: 88, label: stage };
  return { percent: status === 'running' ? 35 : 0, label: stage || '准备安装' };
}

function getTaskElapsedMs(task = {}) {
  const start = Date.parse(task.startedAt || task.createdAt || '');
  if (!Number.isFinite(start)) return 0;
  const end = Date.parse(task.finishedAt || '') || Date.now();
  return Math.max(0, end - start);
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
      const rootParentDir = path.dirname(rootDir);
      const rootSiblingPluginsDir = path.join(rootParentDir, 'plugins');
      const candidates = [
        path.join(process.cwd(), 'plugins'),
        path.basename(rootParentDir).toLowerCase() === 'plugins' ? rootParentDir : '',
        rootSiblingPluginsDir,
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
  const recordWebConsoleOperation = typeof options.recordWebConsoleOperation === 'function'
    ? options.recordWebConsoleOperation
    : (() => {});

  const dependencyInstallTasks = new Map();
  const dependencyInstallActiveTaskKeys = new Map();
  const dependencyInstallTargetLocks = new Map();

  function recordDependencyInstallOperation(action = '', task = {}, extra = {}) {
    recordWebConsoleOperation({
      action,
      method: 'TASK',
      path: `dependencies:${action}`,
      result: extra.result || (task.status === 'error' ? 'error' : 'success'),
      statusCode: extra.statusCode || (task.status === 'error' ? 500 : 200),
      details: {
        taskId: task.id || '',
        key: task.key || '',
        scope: task.scope || '',
        pluginId: task.pluginId || '',
        dependencyType: task.dependencyType || '',
        name: task.name || '',
        declaredVersion: task.declaredVersion || '',
        dependencySpec: task.dependencySpec || '',
        packageManager: task.packageManager || '',
        targetDir: task.targetDir || '',
        command: Array.isArray(task.command) ? task.command : [],
        status: task.status || '',
        currentStage: task.currentStage || '',
        failedStage: task.failedStage || '',
        error: task.error || '',
        timedOut: task.timedOut === true,
        reused: extra.reused === true,
        ...extra.details,
      },
    });
  }

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
    const currentManifest = readJsonFileSafe(packageJsonFile, {}) || {};
    const currentPackageName = String(currentManifest.name || '').trim();
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

      const pluginPackageName = String(manifest.name || '').trim();
      if (pluginPackageName && currentPackageName && pluginPackageName === currentPackageName) {
        continue;
      }

      pluginIds.add(entry.name);
      const pluginName = pluginPackageName || entry.name;

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
        runtimeInstalledCount: runtimeItems.filter(item => item.installed).length,
        runtimeMissingCount: runtimeItems.filter(item => item.status === 'missing').length,
        runtimeMismatchCount: 0,
        devCount: devItems.length,
        devInstalledCount: devItems.filter(item => item.installed).length,
        devMissingCount: devItems.filter(item => item.status === 'not_installed').length,
        devMismatchCount: 0,
        peerCount: peerItems.length,
        peerInstalledCount: peerItems.filter(item => item.installed).length,
        peerMissingCount: peerItems.filter(item => item.status === 'not_installed').length,
        optionalCount: optionalItems.length,
        optionalInstalledCount: optionalItems.filter(item => item.installed).length,
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
    const otherPluginDependencies = includeOtherPlugins ? buildOtherPluginDependencyReport() : undefined;
    const otherSummary = otherPluginDependencies?.summary || {};
    const otherProblemItems = Array.isArray(otherPluginDependencies?.items)
      ? otherPluginDependencies.items.filter(item => item.status !== 'ok')
      : [];
    const otherTotalCount = Number(otherSummary.totalCount || 0);
    const otherInstalledCount = Number(otherSummary.installedCount || 0);
    const otherProblemCount = Number(otherSummary.problemCount || 0);
    const otherRuntimeCount = Number(otherSummary.runtimeCount || 0);
    const otherRuntimeInstalledCount = Number(otherSummary.runtimeInstalledCount || 0);
    const otherRuntimeMissingCount = Number(otherSummary.runtimeMissingCount || 0);
    const otherRuntimeMismatchCount = Number(otherSummary.runtimeMismatchCount || 0);
    const otherDevCount = Number(otherSummary.devCount || 0);
    const otherDevInstalledCount = Number(otherSummary.devInstalledCount || 0);
    const otherDevMissingCount = Number(otherSummary.devMissingCount || 0);
    const otherDevMismatchCount = Number(otherSummary.devMismatchCount || 0);
    const aggregateProblemCount = problemItems.length + otherProblemCount;
    const aggregateRuntimeMissingCount = runtimeMissing.length + otherRuntimeMissingCount;
    const aggregateStatus = aggregateRuntimeMissingCount > 0
      ? 'error'
      : aggregateProblemCount > 0
        ? 'warn'
        : 'healthy';

    return {
      summary: {
        status: aggregateStatus,
        checkedAt: new Date().toISOString(),
        totalCount: items.length + otherTotalCount,
        installedCount: items.filter(item => item.installed).length + otherInstalledCount,
        problemCount: aggregateProblemCount,
        runtimeCount: runtimeItems.length + otherRuntimeCount,
        runtimeInstalledCount: runtimeItems.filter(item => item.installed).length + otherRuntimeInstalledCount,
        runtimeMissingCount: aggregateRuntimeMissingCount,
        runtimeMismatchCount: runtimeMismatch.length + otherRuntimeMismatchCount,
        devCount: devItems.length + otherDevCount,
        devInstalledCount: devItems.filter(item => item.installed).length + otherDevInstalledCount,
        devMissingCount: devMissing.length + otherDevMissingCount,
        devMismatchCount: devMismatch.length + otherDevMismatchCount,
        currentPluginTotalCount: items.length,
        currentPluginInstalledCount: items.filter(item => item.installed).length,
        currentPluginProblemCount: problemItems.length,
        currentPluginRuntimeCount: runtimeItems.length,
        currentPluginRuntimeInstalledCount: runtimeItems.filter(item => item.installed).length,
        currentPluginRuntimeMissingCount: runtimeMissing.length,
        currentPluginRuntimeMismatchCount: runtimeMismatch.length,
        currentPluginDevCount: devItems.length,
        currentPluginDevInstalledCount: devItems.filter(item => item.installed).length,
        currentPluginDevMissingCount: devMissing.length,
        currentPluginDevMismatchCount: devMismatch.length,
        otherPluginCount: Number(otherSummary.pluginCount || 0),
        otherPluginTotalCount: otherTotalCount,
        otherPluginInstalledCount: otherInstalledCount,
        otherPluginProblemCount: otherProblemCount,
        otherPluginRuntimeCount: otherRuntimeCount,
        otherPluginRuntimeInstalledCount: otherRuntimeInstalledCount,
        otherPluginRuntimeMissingCount: otherRuntimeMissingCount,
        otherPluginRuntimeMismatchCount: otherRuntimeMismatchCount,
        otherPluginDevCount: otherDevCount,
        otherPluginDevInstalledCount: otherDevInstalledCount,
        otherPluginDevMissingCount: otherDevMissingCount,
        otherPluginDevMismatchCount: otherDevMismatchCount,
        manifestExists: fs.existsSync(packageJsonFile),
        lockfileExists: fs.existsSync(packageLockFile),
        projectRoot: toRelativeConsolePath(rootDir),
        manifestPath: toRelativeConsolePath(packageJsonFile),
      },
      items,
      problemItems: [...problemItems, ...otherProblemItems],
      otherPluginDependencies,
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

  function collectInstallableDependencyItems(report = {}) {
    const items = Array.isArray(report?.items) ? report.items : [];
    const otherPluginItems = Array.isArray(report?.otherPluginDependencies?.items)
      ? report.otherPluginDependencies.items
      : [];
    const seen = new Set();

    return [...items, ...otherPluginItems]
      .filter(item => item?.installable === true)
      .filter(item => item.status === 'missing' || item.status === 'not_installed')
      .map(item => ({
        scope: item.installScope || 'current',
        pluginId: item.pluginId || '',
        dependencyType: item.dependencyType || item.group || '',
        name: item.name || '',
        declaredVersion: item.declaredVersion || '',
      }))
      .filter(item => {
        const key = buildDependencyInstallTaskKey(item);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
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

  function normalizeResolvedPathForCompare(targetPath = '') {
    const resolved = path.resolve(String(targetPath || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  function isSameResolvedPath(leftPath = '', rightPath = '') {
    return normalizeResolvedPathForCompare(leftPath) === normalizeResolvedPathForCompare(rightPath);
  }

  function assertConfirmedDependencyInstall(payload = {}, message = '依赖安装需要确认目标目录和命令后才能执行') {
    if (payload.confirmed === true || payload.confirmDependencyInstall === true) {
      return;
    }
    throw createHttpError(428, message, 'DEPENDENCY_INSTALL_CONFIRMATION_REQUIRED');
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
    const progress = getDependencyInstallProgress(task);
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
      currentStage: String(task.currentStage || '').trim(),
      failedStage: String(task.failedStage || '').trim(),
      events: Array.isArray(task.events) ? task.events.slice(-40) : [],
      outputEvents: Array.isArray(task.outputEvents) ? task.outputEvents.slice(-DEPENDENCY_INSTALL_TASK_OUTPUT_EVENT_LIMIT) : [],
      latestOutputAt: task.latestOutputAt || '',
      progressPercent: progress.percent,
      progressLabel: progress.label,
      elapsedMs: getTaskElapsedMs(task),
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

      const declaredTargetDir = path.resolve(pluginsRoot, pluginId);
      const targetDir = getResolvedPathSafe(declaredTargetDir);
      if (isSameResolvedPath(targetDir, pluginsRoot) || !isSubPath(pluginsRoot, targetDir)) {
        throw createHttpError(400, '依赖安装目标越界', 'INVALID_INSTALL_TARGET');
      }
      if (!isSameResolvedPath(path.dirname(path.resolve(declaredTargetDir)), pluginsRoot)) {
        throw createHttpError(400, '依赖安装目标必须是 plugins 下的直接插件目录', 'INVALID_INSTALL_TARGET_DEPTH');
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
    if (!isSubPath(targetDir, path.resolve(manifestPath))) {
      throw createHttpError(500, '当前插件 package.json 路径异常', 'CURRENT_MANIFEST_OUT_OF_SCOPE');
    }
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
    return resolvePreferredPackageManagersShared(targetDir, {
      manifest: manifest || readJsonFileSafe(path.join(targetDir, 'package.json'), {}) || {},
      rootDirs: [getResolvedPathSafe(rootDir), getResolvedPathSafe(yunzaiDir)],
      fallback: 'npm',
    });
  }

  async function resolvePackageManager(targetDir, manifest = null) {
    const result = await resolveAvailablePackageManager(targetDir, {
      manifest: manifest || readJsonFileSafe(path.join(targetDir, 'package.json'), {}) || {},
      rootDirs: [getResolvedPathSafe(rootDir), getResolvedPathSafe(yunzaiDir)],
      runProcess: runProcessAsync,
      timeoutMs: 15000,
    });
    return result.manager;
  }

  function assertDependencyPrecheckAccess(targetPath = '', mode = 0, message = '依赖安装预检失败', code = 'DEPENDENCY_PRECHECK_FAILED') {
    try {
      fs.accessSync(targetPath, mode);
    } catch {
      throw createHttpError(409, message, code);
    }
  }

  async function precheckDependencyInstallTarget(target = {}, manifest = null, options = {}) {
    const cache = options.precheckCache instanceof Map ? options.precheckCache : null;
    const cacheKey = String(target.targetDir || '').trim();
    if (cache && cacheKey && cache.has(cacheKey)) {
      return await cache.get(cacheKey);
    }

    const precheckPromise = (async () => {
      const targetDir = String(target.targetDir || '').trim();
      const manifestPath = String(target.manifestPath || '').trim();
      if (!targetDir || !fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        throw createHttpError(409, '依赖安装目标目录不存在或不可访问', 'INSTALL_TARGET_DIR_UNAVAILABLE');
      }
      if (!manifestPath || !fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
        throw createHttpError(409, '目标 package.json 不存在或不可访问', 'INSTALL_MANIFEST_UNAVAILABLE');
      }

      assertDependencyPrecheckAccess(
        targetDir,
        fs.constants.R_OK | fs.constants.W_OK,
        '依赖安装目标目录不可读写',
        'INSTALL_TARGET_DIR_NOT_WRITABLE',
      );
      assertDependencyPrecheckAccess(
        manifestPath,
        fs.constants.R_OK | fs.constants.W_OK,
        '目标 package.json 不可读写',
        'INSTALL_MANIFEST_NOT_WRITABLE',
      );

      const packageManager = await resolvePackageManager(targetDir, manifest);
      return {
        ok: true,
        packageManager,
        targetDir: toRelativeConsolePath(targetDir),
        checks: [
          { key: 'targetDir', label: '目标目录可读写', ok: true },
          { key: 'manifest', label: 'package.json 可读写', ok: true },
          { key: 'packageManager', label: `包管理器可用：${packageManager}`, ok: true },
        ],
      };
    })();

    if (cache && cacheKey) {
      cache.set(cacheKey, precheckPromise);
    }
    return await precheckPromise;
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
        return ['add', dependencySpec];
      }
      if (packageManager === 'yarn') {
        return ['add', dependencySpec];
      }
      return ['install', dependencySpec, '--save'];
    }

    throw createHttpError(400, '不支持的依赖类型', 'UNSUPPORTED_DEPENDENCY_TYPE');
  }

  function buildDependencyInstallAffectedFiles(targetDir = '') {
    return [
      'package.json',
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
    ]
      .map(fileName => path.join(targetDir, fileName))
      .filter(filePath => filePath.endsWith('package.json') || fs.existsSync(filePath))
      .map(filePath => toRelativeConsolePath(filePath));
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

  async function precheckDependencyInstallRequest(payload = {}, options = {}) {
    const request = resolveDependencyInstallRequest(payload);
    const targetPrecheck = await precheckDependencyInstallTarget(request.target, request.manifest, options);
    const command = [
      resolvePackageManagerBinary(targetPrecheck.packageManager),
      ...buildInstallCommandArgs(targetPrecheck.packageManager, request.dependencySpec, request.dependencyType),
    ];
    return {
      ok: true,
      scope: request.scope,
      pluginId: request.pluginId,
      dependencyType: request.dependencyType,
      name: request.dependencyName,
      declaredVersion: request.declaredVersion,
      packageManager: targetPrecheck.packageManager,
      command,
      commandText: command.join(' '),
      targetDir: targetPrecheck.targetDir,
      affectedFiles: buildDependencyInstallAffectedFiles(request.target.targetDir),
      safety: {
        requiresConfirmation: true,
        deleteNodeModules: false,
        targetScopeLocked: true,
        manifestDeclarationVerified: true,
      },
      checks: targetPrecheck.checks,
    };
  }

  async function precheckDependencyInstallRequestSafe(payload = {}, options = {}) {
    try {
      return await precheckDependencyInstallRequest(payload, options);
    } catch (error) {
      return {
        ok: false,
        scope: payload.scope || payload.installScope || 'current',
        pluginId: payload.pluginId || '',
        dependencyType: payload.dependencyType || payload.group || '',
        name: payload.name || '',
        declaredVersion: payload.declaredVersion || '',
        error: String(error?.message || '依赖安装预检失败').trim(),
        code: String(error?.code || '').trim(),
        statusCode: Number(error?.statusCode || 500),
      };
    }
  }

  async function precheckMissingDependencyInstallTasks(payload = {}) {
    const includeOtherPlugins = payload.includeOtherPlugins !== false;
    const report = buildDependencyReport({ includeOtherPlugins });
    const installableItems = collectInstallableDependencyItems(report);
    const parsedLimit = Number.parseInt(String(payload.limit || ''), 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(80, parsedLimit))
      : Math.min(80, Math.max(1, installableItems.length || 1));
    const selectedItems = installableItems.slice(0, limit);
    const precheckCache = new Map();
    const results = [];

    for (const item of selectedItems) {
      results.push(await precheckDependencyInstallRequestSafe(item, { precheckCache }));
    }

    return {
      requestedCount: installableItems.length,
      checkedCount: selectedItems.length,
      okCount: results.filter(item => item.ok === true).length,
      errorCount: results.filter(item => item.ok !== true).length,
      limited: installableItems.length > selectedItems.length,
      results,
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
      task.outputEvents = [];
      task.latestOutputAt = '';
      task.currentStage = '准备安装';
      task.failedStage = '';
      pushDependencyInstallTaskEvent(task, { stage: task.currentStage, message: '任务开始执行，正在准备安装环境。' });

      try {
        task.currentStage = '检测包管理器';
        pushDependencyInstallTaskEvent(task, { stage: task.currentStage, message: '正在检测可用的包管理器。' });
        const packageManager = await resolvePackageManager(task.absoluteTargetDir, task.manifest || null);
        const command = resolvePackageManagerBinary(packageManager);
        const args = buildInstallCommandArgs(packageManager, task.dependencySpec, task.dependencyType);
        const commandLine = [command, ...args];

        task.packageManager = packageManager;
        task.command = commandLine;
        task.currentStage = '执行安装命令';
        pushDependencyInstallTaskEvent(task, {
          stage: task.currentStage,
          message: `执行命令：${commandLine.join(' ')}`,
        });
        logger.mark(`[webConsole] 开始安装依赖: ${commandLine.join(' ')} @ ${task.absoluteTargetDir}`);

        const result = await runProcessAsync(command, args, {
          cwd: task.absoluteTargetDir,
          env: process.env,
          timeoutMs: 10 * 60 * 1000,
          onStdout: chunk => {
            task.stdoutTail = appendOutputTail(task.stdoutTail, chunk);
            pushDependencyInstallTaskOutputEvent(task, 'stdout', chunk);
          },
          onStderr: chunk => {
            task.stderrTail = appendOutputTail(task.stderrTail, chunk);
            pushDependencyInstallTaskOutputEvent(task, 'stderr', chunk);
          },
        });

        task.stdoutTail = trimOutputTail(result.stdoutTail || task.stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        task.stderrTail = trimOutputTail(result.stderrTail || task.stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        task.timedOut = Boolean(result.timedOut);

        if (result.timedOut) {
          task.status = 'error';
          task.error = '依赖安装已超时';
          task.failedStage = task.currentStage || '执行安装命令';
          pushDependencyInstallTaskEvent(task, { level: 'error', stage: task.failedStage, message: task.error });
          return task;
        }

        if (result.status !== 0) {
          task.status = 'error';
          task.error = task.stderrTail || task.stdoutTail || `依赖安装失败，退出码: ${result.status}`;
          task.failedStage = task.currentStage || '执行安装命令';
          pushDependencyInstallTaskEvent(task, { level: 'error', stage: task.failedStage, message: `命令退出码：${result.status}` });
          return task;
        }

        task.currentStage = '验证安装结果';
        pushDependencyInstallTaskEvent(task, { stage: task.currentStage, message: `安装命令完成，正在验证 ${task.name} 是否可解析。` });
        const installedInfo = resolveInstalledDependencyInfo(task.name, task.absoluteTargetDir);
        if (!installedInfo.installed) {
          task.status = 'error';
          task.error = `依赖安装命令已完成，但仍无法解析 ${task.name}。请检查 pnpm node_modules 链接或锁文件状态。`;
          task.failedStage = task.currentStage;
          pushDependencyInstallTaskEvent(task, { level: 'error', stage: task.failedStage, message: task.error });
          return task;
        }

        task.status = 'success';
        task.error = '';
        task.currentStage = '安装完成';
        pushDependencyInstallTaskEvent(task, { stage: task.currentStage, message: '依赖安装完成并已通过解析检查。' });
        logger.mark(`[webConsole] 依赖安装完成: ${commandLine.join(' ')} @ ${task.absoluteTargetDir}`);
        return task;
      } catch (error) {
        task.status = 'error';
        task.timedOut = Boolean(error?.timedOut);
        task.stdoutTail = trimOutputTail(error?.stdoutTail || task.stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        task.stderrTail = trimOutputTail(error?.stderrTail || task.stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
        task.failedStage = task.currentStage || '执行安装任务';
        task.error = task.timedOut
          ? '依赖安装已超时'
          : String(error?.message || task.stderrTail || task.stdoutTail || '依赖安装失败').trim();
        pushDependencyInstallTaskEvent(task, { level: 'error', stage: task.failedStage, message: task.error });
        logger.error(`[webConsole] 依赖安装失败: ${task.name} -> ${task.error}`);
        return task;
      } finally {
        task.finishedAt = new Date().toISOString();
        recordDependencyInstallOperation('dependency_install_task_finished', task);
        releaseDependencyInstallTaskKey(task);
        pruneDependencyInstallTasks();
      }
    });
  }

  async function createDependencyInstallTask(payload = {}, options = {}) {
    pruneDependencyInstallTasks();
    assertConfirmedDependencyInstall(payload);

    const taskKey = buildDependencyInstallTaskKey(payload);
    const activeTaskId = dependencyInstallActiveTaskKeys.get(taskKey);
    if (activeTaskId) {
      const activeTask = dependencyInstallTasks.get(activeTaskId);
      if (activeTask && !isDependencyInstallTaskFinished(activeTask)) {
        recordDependencyInstallOperation('dependency_install_task_reused', activeTask, {
          result: 'success',
          statusCode: 200,
          reused: true,
        });
        return { task: activeTask, reused: true };
      }
      dependencyInstallActiveTaskKeys.delete(taskKey);
    }

    const request = resolveDependencyInstallRequest(payload);
    const precheck = await precheckDependencyInstallTarget(request.target, request.manifest, options);
    const command = [
      resolvePackageManagerBinary(precheck.packageManager),
      ...buildInstallCommandArgs(precheck.packageManager, request.dependencySpec, request.dependencyType),
    ];
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
      packageManager: precheck.packageManager || '',
      command,
      targetDir: toRelativeConsolePath(request.target.targetDir),
      absoluteTargetDir: request.target.targetDir,
      dependencySpec: request.dependencySpec,
      manifest: request.manifest,
      stdoutTail: '',
      stderrTail: '',
      outputEvents: [],
      latestOutputAt: '',
      error: '',
      currentStage: '等待执行',
      failedStage: '',
      events: [{
        time: new Date().toISOString(),
        level: 'info',
        stage: '等待执行',
        message: '安装任务已创建，等待执行队列调度。',
      }],
      timedOut: false,
    };

    dependencyInstallTasks.set(task.id, task);
    dependencyInstallActiveTaskKeys.set(task.key, task.id);
    pruneDependencyInstallTasks();
    recordDependencyInstallOperation('dependency_install_task_created', task);

    setImmediate(() => {
      executeDependencyInstallTask(task).catch(error => {
        task.status = 'error';
        task.finishedAt = new Date().toISOString();
        task.failedStage = task.currentStage || '启动安装任务';
        task.error = String(error?.message || 'Dependency install failed').trim();
        pushDependencyInstallTaskEvent(task, {
          level: 'error',
          stage: task.failedStage,
          message: task.error,
        });
        releaseDependencyInstallTaskKey(task);
        recordDependencyInstallOperation('dependency_install_task_finished', task);
        logger.error(`[webConsole] Dependency task bootstrap failed: ${task.name} -> ${task.error}`);
      });
    });

    return { task, reused: false };
  }

  async function createMissingDependencyInstallTasks(payload = {}) {
    assertConfirmedDependencyInstall(payload, '一键修复依赖需要确认目标目录和命令后才能执行');
    const includeOtherPlugins = payload.includeOtherPlugins !== false;
    const report = buildDependencyReport({ includeOtherPlugins });
    const installableItems = collectInstallableDependencyItems(report);
    const parsedLimit = Number.parseInt(String(payload.limit || ''), 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(80, parsedLimit))
      : Math.min(80, Math.max(1, installableItems.length || 1));
    const selectedItems = installableItems.slice(0, limit);
    const tasks = [];
    const skipped = [];
    const precheckCache = new Map();

    for (const item of selectedItems) {
      try {
        const { task, reused } = await createDependencyInstallTask({ ...item, confirmed: true }, { precheckCache });
        tasks.push({ task: serializeDependencyInstallTask(task), reused });
      } catch (error) {
        skipped.push({
          ...item,
          error: String(error?.message || '创建安装任务失败').trim(),
          code: String(error?.code || '').trim(),
        });
      }
    }

    return {
      requestedCount: installableItems.length,
      createdCount: tasks.filter(item => item.reused !== true).length,
      reusedCount: tasks.filter(item => item.reused === true).length,
      skippedCount: skipped.length,
      limited: installableItems.length > selectedItems.length,
      tasks,
      skipped,
    };
  }

  return {
    buildDependencyReport,
    buildDependencyReportSummaryOnly,
    collectInstallableDependencyItems,
    createDependencyInstallTask,
    createMissingDependencyInstallTasks,
    precheckDependencyInstallRequest,
    precheckMissingDependencyInstallTasks,
    serializeDependencyInstallTask,
    getDependencyInstallTask,
    listDependencyInstallTasks,
    clearDependencyInstallHistory,
  };
}
