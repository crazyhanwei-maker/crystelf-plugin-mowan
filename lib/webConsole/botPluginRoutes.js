import { createRouteUtils } from './routeUtils.js';

export function createBotPluginRoutes(options = {}) {
  const {
    buildBotPluginManagementPayload,
    deleteBotPlugin,
    recordWebConsoleOperation,
    parseRequestBody,
    sendJson,
  } = options;

  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/bot-plugins' && req.method === 'GET') {
      try {
        sendJson(res, buildBotPluginManagementPayload());
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/bot-plugins/delete' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, deleteBotPlugin(body));
      } catch (error) {
        if (typeof recordWebConsoleOperation === 'function') {
          recordWebConsoleOperation({
            action: 'plugin_delete_to_trash',
            method: 'TASK',
            path: 'bot-plugins:delete',
            result: 'error',
            statusCode: Number(error?.statusCode || 500),
            details: {
              directoryName: '',
              error: String(error?.message || '删除插件失败').trim(),
              code: String(error?.code || '').trim(),
            },
          });
        }
        sendRouteError(res, error, 500);
      }
      return true;
    }
    return false;
  }

  return {
    handle,
  };
}
