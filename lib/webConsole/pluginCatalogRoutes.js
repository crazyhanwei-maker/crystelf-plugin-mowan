import { createRouteUtils } from './routeUtils.js';

export function createPluginCatalogRoutes(options = {}) {
  const {
    buildPluginCatalogPayload,
    cancelPluginCatalogInstallTask,
    createPluginCatalogInstallTask,
    getPluginCatalogInstallTask,
    listPluginCatalogInstallTasks,
    parseRequestBody,
    precheckPluginCatalogInstallTask,
    refreshPluginCatalogRemoteSource,
    sendJson,
    serializePluginCatalogInstallTask,
  } = options;

  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/plugin-catalog' && req.method === 'GET') {
      try {
        if (typeof refreshPluginCatalogRemoteSource === 'function') {
          await refreshPluginCatalogRemoteSource({
            force: url.searchParams.get('refresh') === '1',
          });
        }
        sendJson(res, buildPluginCatalogPayload());
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }

    if (url.pathname === '/api/plugin-catalog/install-precheck' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await precheckPluginCatalogInstallTask(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }

    if (url.pathname === '/api/plugin-catalog/install' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const task = await createPluginCatalogInstallTask(body);
        sendJson(res, { success: true, task: serializePluginCatalogInstallTask(task) }, 202);
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }

    if (url.pathname === '/api/plugin-catalog/install-cancel' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const task = cancelPluginCatalogInstallTask(body.taskId || body.id);
        sendJson(res, { success: true, task: serializePluginCatalogInstallTask(task) });
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }

    if (url.pathname === '/api/plugin-catalog/install-status') {
      if (rejectReadOnly(res)) return true;
      try {
        const task = getPluginCatalogInstallTask(url.searchParams.get('taskId'));
        sendJson(res, { success: true, task: serializePluginCatalogInstallTask(task) });
      } catch (error) {
        sendRouteError(res, error, 404);
      }
      return true;
    }

    if (url.pathname === '/api/plugin-catalog/install-tasks') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, {
        success: true,
        tasks: listPluginCatalogInstallTasks({
          activeOnly: url.searchParams.get('activeOnly') === '1',
          limit: url.searchParams.get('limit'),
        }),
      });
      return true;
    }

    return false;
  }

  return {
    handle,
  };
}
