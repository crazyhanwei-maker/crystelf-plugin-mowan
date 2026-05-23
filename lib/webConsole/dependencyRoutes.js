import { createRouteUtils } from './routeUtils.js';

export function createDependencyRoutes(options = {}) {
  const {
    buildDependencyReport,
    clearDependencyInstallHistory,
    createDependencyInstallTask,
    createMissingDependencyInstallTasks,
    getDependencyInstallTask,
    listDependencyInstallTasks,
    parseRequestBody,
    precheckDependencyInstallRequest,
    precheckMissingDependencyInstallTasks,
    sendJson,
    serializeDependencyInstallTask,
  } = options;

  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/dependencies/install' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const { task, reused } = await createDependencyInstallTask(body);
        sendJson(res, { success: true, reused, task: serializeDependencyInstallTask(task) }, 202);
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/dependencies/install-precheck' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        if (body?.mode === 'missing' || body?.installMissing === true) {
          sendJson(res, { success: true, ...await precheckMissingDependencyInstallTasks(body) });
          return true;
        }
        sendJson(res, { success: true, precheck: await precheckDependencyInstallRequest(body) });
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/dependencies/install-missing' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const result = await createMissingDependencyInstallTasks(body);
        sendJson(res, { success: true, ...result }, 202);
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/dependencies/install-status') {
      if (rejectReadOnly(res)) return true;
      try {
        const task = getDependencyInstallTask(url.searchParams.get('taskId'));
        sendJson(res, { success: true, task: serializeDependencyInstallTask(task) });
      } catch (error) {
        sendRouteError(res, error, 404);
      }
      return true;
    }
    if (url.pathname === '/api/dependencies/install-active') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, {
        success: true,
        tasks: listDependencyInstallTasks({ activeOnly: true }),
      });
      return true;
    }
    if (url.pathname === '/api/dependencies/install-history') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, {
        success: true,
        tasks: listDependencyInstallTasks({
          finishedOnly: true,
          limit: url.searchParams.get('limit'),
        }),
      });
      return true;
    }
    if (url.pathname === '/api/dependencies/install-history/clear' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, {
        success: true,
        ...clearDependencyInstallHistory(),
      });
      return true;
    }
    if (url.pathname === '/api/dependencies') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, buildDependencyReport({ includeOtherPlugins: true }));
      return true;
    }
    return false;
  }

  return {
    handle,
  };
}
