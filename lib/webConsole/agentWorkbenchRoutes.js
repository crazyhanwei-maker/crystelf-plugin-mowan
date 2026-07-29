import { createRouteUtils } from './routeUtils.js';

export function createAgentWorkbenchRoutes(options = {}) {
  const {
    buildAgentWorkbenchPayload,
    cancelAgentWorkbenchTask,
    createAgentWorkbenchTask,
    getAgentWorkbenchTask,
    parseRequestBody,
    saveAgentWorkbenchConfig,
    sendJson,
  } = options;
  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/agent-workbench' && req.method === 'GET') {
      try {
        sendJson(res, await buildAgentWorkbenchPayload({
          force: url.searchParams.get('force') === '1',
          taskId: url.searchParams.get('task') || '',
        }));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/agent-workbench/settings' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, await saveAgentWorkbenchConfig(await parseRequestBody(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/agent-workbench/tasks' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, {
          success: true,
          task: await createAgentWorkbenchTask(await parseRequestBody(req)),
        }, 202);
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    const taskMatch = url.pathname.match(/^\/api\/agent-workbench\/tasks\/([A-Za-z0-9_-]+)(?:\/(cancel))?$/);
    if (taskMatch && req.method === 'GET' && !taskMatch[2]) {
      try {
        sendJson(res, { success: true, task: getAgentWorkbenchTask(taskMatch[1]) });
      } catch (error) {
        sendRouteError(res, error, 404);
      }
      return true;
    }
    if (taskMatch && taskMatch[2] === 'cancel' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, { success: true, ...cancelAgentWorkbenchTask(taskMatch[1]) });
      } catch (error) {
        sendRouteError(res, error, 404);
      }
      return true;
    }
    return false;
  }

  return { handle };
}
