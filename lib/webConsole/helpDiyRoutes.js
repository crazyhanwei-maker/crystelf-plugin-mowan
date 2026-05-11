import { createRouteUtils } from './routeUtils.js';

export function createHelpDiyRoutes(options = {}) {
  const {
    buildHelpDiyHistoryPayload,
    buildHelpDiyImportPreviewPayload,
    buildHelpDiyPayload,
    clearHelpDiyHistory,
    deleteHelpDiyHistoryItem,
    deleteHelpDiyImage,
    getHelpDiyTemplates,
    getHttpErrorStatus,
    parseRequestBody,
    saveBase64Image,
    saveHelpDiyPayload,
    sendJson,
    sendText,
  } = options;

  const { rejectReadOnly } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/help-diy')) {
      return false;
    }
    if (url.pathname === '/api/help-diy') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, await buildHelpDiyPayload());
      return true;
    }
    if (url.pathname === '/api/help-diy/templates') {
      sendJson(res, {
        success: true,
        items: getHelpDiyTemplates().map(item => ({
          key: item.key,
          label: item.label,
          description: item.description,
          payload: item.payload,
        })),
      });
      return true;
    }
    if (url.pathname === '/api/help-diy/history') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, {
        success: true,
        items: buildHelpDiyHistoryPayload(),
      });
      return true;
    }
    if (url.pathname === '/api/help-diy/history/delete' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, { success: true, items: deleteHelpDiyHistoryItem(body?.id) });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/help-diy/history/clear' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, { success: true, items: clearHelpDiyHistory() });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/help-diy/export') {
      if (rejectReadOnly(res)) return true;
      sendText(res, JSON.stringify(await buildHelpDiyPayload(), null, 2), 200, 'application/json; charset=utf-8');
      return true;
    }
    if (url.pathname === '/api/help-diy/import-preview' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await buildHelpDiyImportPreviewPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/help-diy/upload-image' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const urlPath = saveBase64Image(body?.dataUrl, String(body?.slot || 'help'));
        sendJson(res, { success: true, url: urlPath });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/help-diy/delete-image' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        deleteHelpDiyImage(body?.url);
        sendJson(res, { success: true });
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/help-diy/save' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, { success: true, data: await saveHelpDiyPayload(body) });
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
