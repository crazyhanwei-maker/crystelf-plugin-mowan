import { createRouteUtils } from './routeUtils.js';

export function createConfigBackupRoutes(options = {}) {
  const {
    buildConfigBackupPayload,
    buildConfigHistoryPayload,
    buildConfigRestorePreviewPayload,
    parseRequestBody,
    restoreConfigBackupPayload,
    rollbackConfigHistoryPayload,
    sendJson,
    sendText,
  } = options;

  const { rejectReadOnly } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/config-backup') {
      if (rejectReadOnly(res)) return true;
      sendText(res, JSON.stringify(buildConfigBackupPayload(), null, 2), 200, 'application/json; charset=utf-8');
      return true;
    }
    if (url.pathname === '/api/config-history') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, await buildConfigHistoryPayload({
          limit: url.searchParams.get('limit'),
        }));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/config-history/rollback' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await rollbackConfigHistoryPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/config-restore-preview' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, buildConfigRestorePreviewPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/config-restore' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await restoreConfigBackupPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    return false;
  }

  return {
    handle,
  };
}
