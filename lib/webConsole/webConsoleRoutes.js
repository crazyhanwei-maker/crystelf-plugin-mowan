import { createFileBrowserRoutes } from './fileBrowserRoutes.js';
import { createBotPluginRoutes } from './botPluginRoutes.js';
import { createPluginCatalogRoutes } from './pluginCatalogRoutes.js';
import { createDependencyRoutes } from './dependencyRoutes.js';
import { createUserDataRoutes } from './userDataRoutes.js';
import { createLogRoutes } from './logRoutes.js';
import { createGroupManagementRoutes } from './groupManagementRoutes.js';
import { createSettingsRoutes } from './settingsRoutes.js';
import { createHelpDiyRoutes } from './helpDiyRoutes.js';
import { createQqSimulatorRoutes } from './qqSimulatorRoutes.js';
import { createSandboxRoutes } from './sandboxRoutes.js';
import { createConfigBackupRoutes } from './configBackupRoutes.js';
import { createMediaRoutes } from './mediaRoutes.js';
import { createRouteUtils } from './routeUtils.js';

export function createWebConsoleHandler(options = {}) {
  const fileBrowserRoutes = createFileBrowserRoutes(options);
  const botPluginRoutes = createBotPluginRoutes(options);
  const pluginCatalogRoutes = createPluginCatalogRoutes(options);
  const dependencyRoutes = createDependencyRoutes(options);
  const userDataRoutes = createUserDataRoutes(options);
  const logRoutes = createLogRoutes(options);
  const groupManagementRoutes = createGroupManagementRoutes(options);
  const settingsRoutes = createSettingsRoutes(options);
  const helpDiyRoutes = createHelpDiyRoutes(options);
  const qqSimulatorRoutes = createQqSimulatorRoutes(options);
  const sandboxRoutes = createSandboxRoutes(options);
  const configBackupRoutes = createConfigBackupRoutes(options);
  const mediaRoutes = createMediaRoutes(options);
  const { rejectReadOnly } = createRouteUtils(options);
  const {
    attachWebConsoleAudit,
    buildAuthStatusPayload,
    buildConfigDiagnosticsPayload,
    buildConfigPayload,
    buildHealthPayload,
    buildOverviewPayload,
    buildVersionCheckPayload,
    buildWebConsoleAuthCookieClearHeader,
    getHttpErrorStatus,
    isBootstrapApiPath,
    isBootstrapSetupRequest,
    loginWebConsole,
    loginWebConsoleWithTicket,
    requireAuth,
    requireCsrf,
    requireSameOrigin,
    sendJson,
    sendText,
    serveStatic,
    listDependencyInstallTasks,
    listPluginCatalogInstallTasks,
  } = options;

  function normalizeTaskStatus(status = '') {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'success') return 'success';
    if (value === 'error' || value === 'failed') return 'error';
    if (value === 'running') return 'running';
    if (value === 'pending' || value === 'queued') return 'pending';
    return value || 'unknown';
  }

  function getTaskStatusLabel(status = '') {
    const value = normalizeTaskStatus(status);
    if (value === 'pending') return '排队中';
    if (value === 'running') return '执行中';
    if (value === 'success') return '成功';
    if (value === 'error') return '失败';
    return '未知';
  }

  function isTaskActive(task = {}) {
    const status = normalizeTaskStatus(task.status);
    return status === 'pending' || status === 'running';
  }

  function normalizeProgressPercent(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function normalizeTaskEvents(events = [], limit = 8) {
    return Array.isArray(events)
      ? events.slice(-limit).map(event => ({
        time: event?.time || '',
        level: String(event?.level || 'info').trim() || 'info',
        stage: String(event?.stage || '').trim(),
        message: String(event?.message || '').trim(),
      })).filter(event => event.message)
      : [];
  }

  function normalizeTaskOutputEvents(events = [], limit = 6) {
    return Array.isArray(events)
      ? events.slice(-limit).map(event => ({
        time: event?.time || '',
        stream: String(event?.stream || 'stdout').trim() === 'stderr' ? 'stderr' : 'stdout',
        stage: String(event?.stage || '').trim(),
        process: String(event?.process || '').trim(),
        text: String(event?.text || '').trim(),
      })).filter(event => event.text)
      : [];
  }

  function buildOperationTaskPayload(task = {}, overrides = {}) {
    return {
      id: task.id,
      key: overrides.key || task.key || task.id || '',
      type: overrides.type || 'task',
      typeLabel: overrides.typeLabel || '任务',
      title: overrides.title || task.name || task.pluginName || task.catalogId || '任务',
      target: overrides.target || task.targetDir || '-',
      status: normalizeTaskStatus(task.status),
      statusLabel: getTaskStatusLabel(task.status),
      stage: overrides.stage || task.progressLabel || task.currentStage || task.stage || task.packageManager || '执行中',
      createdAt: task.createdAt || '',
      startedAt: task.startedAt || '',
      finishedAt: task.finishedAt || '',
      command: Array.isArray(task.command) ? task.command : [],
      error: task.error || '',
      timedOut: task.timedOut === true,
      href: overrides.href || '#',
      active: isTaskActive(task),
      progressPercent: normalizeProgressPercent(task.progressPercent, isTaskActive(task) ? 15 : 0),
      progressLabel: task.progressLabel || task.currentStage || task.stage || '',
      elapsedMs: Math.max(0, Number(task.elapsedMs || 0) || 0),
      latestOutputAt: task.latestOutputAt || '',
      events: normalizeTaskEvents(task.events),
      outputEvents: normalizeTaskOutputEvents(task.outputEvents),
    };
  }

  function buildOperationTaskCenterPayload() {
    const dependencyActive = typeof listDependencyInstallTasks === 'function'
      ? listDependencyInstallTasks({ activeOnly: true, limit: 20 })
      : [];
    const dependencyHistory = typeof listDependencyInstallTasks === 'function'
      ? listDependencyInstallTasks({ finishedOnly: true, limit: 20 })
      : [];
    const pluginTasks = typeof listPluginCatalogInstallTasks === 'function'
      ? listPluginCatalogInstallTasks({ limit: 30 })
      : [];

    const tasks = [
      ...dependencyActive.map(task => buildOperationTaskPayload(task, {
        key: `dependency:${task.id}`,
        type: 'dependency_install',
        typeLabel: '依赖安装',
        title: task.name || '依赖安装',
        target: task.pluginId ? `${task.pluginId} / ${task.dependencyType || '-'}` : (task.dependencyType || '当前插件'),
        stage: task.progressLabel || task.currentStage || task.packageManager || 'install',
        href: '/dependency-check.html',
      })),
      ...dependencyHistory.map(task => buildOperationTaskPayload(task, {
        key: `dependency:${task.id}`,
        type: 'dependency_install',
        typeLabel: '依赖安装',
        title: task.name || '依赖安装',
        target: task.pluginId ? `${task.pluginId} / ${task.dependencyType || '-'}` : (task.dependencyType || '当前插件'),
        stage: task.progressLabel || task.currentStage || task.packageManager || 'install',
        href: '/dependency-check.html',
      })),
      ...pluginTasks.map(task => buildOperationTaskPayload(task, {
        key: `plugin:${task.id}`,
        type: 'plugin_install',
        typeLabel: '插件安装',
        title: task.pluginName || task.catalogId || '插件安装',
        target: task.targetDir || task.directoryName || '-',
        stage: task.progressLabel || task.stage || 'install',
        href: '/bot-plugins.html?tab=catalog',
      })),
    ];

    const uniqueTasks = Array.from(new Map(tasks.map(task => [task.key, task])).values())
      .sort((left, right) => {
        const leftActive = left.active ? 1 : 0;
        const rightActive = right.active ? 1 : 0;
        if (leftActive !== rightActive) return rightActive - leftActive;
        return (Date.parse(right.createdAt || right.startedAt || right.finishedAt || '') || 0)
          - (Date.parse(left.createdAt || left.startedAt || left.finishedAt || '') || 0);
      })
      .slice(0, 24);

    const activeCount = uniqueTasks.filter(task => task.active).length;
    const errorCount = uniqueTasks.filter(task => task.status === 'error').length;
    const successCount = uniqueTasks.filter(task => task.status === 'success').length;

    return {
      success: true,
      checkedAt: new Date().toISOString(),
      summary: {
        total: uniqueTasks.length,
        activeCount,
        successCount,
        errorCount,
        dependencyCount: uniqueTasks.filter(task => task.type === 'dependency_install').length,
        pluginCount: uniqueTasks.filter(task => task.type === 'plugin_install').length,
      },
      tasks: uniqueTasks,
    };
  }

  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (typeof attachWebConsoleAudit === 'function') {
      attachWebConsoleAudit(req, res, url);
    }
    const requiresSameOriginCheck = !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase());
    const bootstrapMode = isBootstrapSetupRequest(req);
    const bootstrapApiAllowed = bootstrapMode && isBootstrapApiPath(url.pathname);
    if (await mediaRoutes.handlePublic(req, res, url)) return;
    if (url.pathname === '/robots.txt') {
      return sendText(res, 'User-agent: *\nDisallow: /\n', 200, 'text/plain; charset=utf-8');
    }
    if (url.pathname === '/api/auth/status') {
      return sendJson(res, buildAuthStatusPayload(req));
    }
    if (url.pathname === '/api/auth/login-ticket' && req.method === 'GET') {
      try {
        const result = await loginWebConsoleWithTicket(req, url.searchParams.get('ticket'));
        return sendJson(res, result.payload, 200, result.headers || {});
      } catch (error) {
        return sendJson(
          res,
          { success: false, error: error.message, code: error.code || '' },
          getHttpErrorStatus(error, 401),
          error?.headers || {},
        );
      }
    }
    if (url.pathname.startsWith('/api/') && requiresSameOriginCheck && !requireSameOrigin(req, res)) {
      return;
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const result = await loginWebConsole(req);
        return sendJson(res, result.payload, 200, result.headers || {});
      } catch (error) {
        return sendJson(
          res,
          { success: false, error: error.message, code: error.code || '' },
          getHttpErrorStatus(error, 401),
          error?.headers || {},
        );
      }
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!requireAuth(req, res)) {
        return;
      }
      if (!requireCsrf(req, res)) {
        return;
      }
      return sendJson(res, { success: true }, 200, {
        'Set-Cookie': buildWebConsoleAuthCookieClearHeader(req),
      });
    }
    if (url.pathname.startsWith('/api/') && !bootstrapApiAllowed && !requireAuth(req, res)) {
      return;
    }
    if (requiresSameOriginCheck && !bootstrapApiAllowed && !requireCsrf(req, res)) {
      return;
    }
    if (await fileBrowserRoutes.handle(req, res, url)) return;
    if (url.pathname === '/api/overview') {
      return sendJson(res, buildOverviewPayload());
    }
    if (url.pathname === '/api/health') {
      return sendJson(res, buildHealthPayload());
    }
    if (url.pathname === '/api/version/check') {
      return sendJson(res, await buildVersionCheckPayload({
        force: url.searchParams.get('force') === '1',
      }));
    }
    if (url.pathname === '/api/version/update' && req.method === 'POST') {
      if (rejectReadOnly(res)) return;
      try {
        const Updater = (await import('../system/updater.js')).default;
        if (!await Updater.isGitRepo()) {
          return sendJson(res, { success: false, error: '当前目录不是 Git 仓库，无法自动更新', code: 'NOT_GIT_REPO' }, 409);
        }
        if (!await Updater.isWorkingTreeClean()) {
          return sendJson(res, { success: false, error: '本地工作区有未提交改动，无法自动更新', code: 'WORKTREE_DIRTY' }, 409);
        }
        const status = await Updater.getUpdateStatus();
        if (!status.hasUpdate) {
          await buildVersionCheckPayload({ force: true });
          return sendJson(res, { success: true, alreadyUpToDate: true, status });
        }
        if (status.state === 'diverged') {
          return sendJson(res, { success: false, error: '本地分支与远端分叉，需要手动处理', code: 'DIVERGED', status }, 409);
        }
        if (status.state === 'local-ahead') {
          return sendJson(res, { success: false, error: '本地分支领先于远端，无需更新', code: 'LOCAL_AHEAD', status }, 409);
        }
        const result = await Updater.update(status);
        await buildVersionCheckPayload({ force: true });
        return sendJson(res, {
          success: true,
          alreadyUpToDate: false,
          manifestChanged: Boolean(result?.manifestChanged),
          fromHash: String(result?.from || status.local || ''),
          toHash: String(result?.to || status.remote || ''),
          stdout: String(result?.stdout || '').slice(-2000),
        });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message || String(error), code: error.code || 'UPDATE_FAILED' }, 500);
      }
    }
    if (url.pathname === '/api/tasks') {
      return sendJson(res, buildOperationTaskCenterPayload());
    }
    if (await botPluginRoutes.handle(req, res, url)) return;
    if (await pluginCatalogRoutes.handle(req, res, url)) return;
    if (await dependencyRoutes.handle(req, res, url)) return;
    if (await userDataRoutes.handle(req, res, url)) return;
    if (url.pathname === '/api/config') {
      return sendJson(res, buildConfigPayload());
    }
    if (url.pathname === '/api/config/diagnostics') {
      return sendJson(res, await buildConfigDiagnosticsPayload());
    }
    if (await sandboxRoutes.handle(req, res, url)) return;
    if (await logRoutes.handle(req, res, url)) return;
    if (await mediaRoutes.handleApi(req, res, url)) return;
    if (await configBackupRoutes.handle(req, res, url)) return;
    if (await groupManagementRoutes.handle(req, res, url)) return;
    if (await settingsRoutes.handle(req, res, url, { bootstrapMode })) return;
    if (await helpDiyRoutes.handle(req, res, url)) return;
    if (await qqSimulatorRoutes.handle(req, res, url)) return;
    return serveStatic(req, res);
  };
}
