import { createRouteUtils } from './routeUtils.js';

export function createSandboxRoutes(options = {}) {
  const {
    buildSandboxConfigStatusPayload,
    buildSandboxPromptPreviewPayload,
    buildSandboxWebReadPayload,
    parseRequestBody,
    runSandboxChat,
    sendJson,
  } = options;

  const { rejectReadOnly } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/sandbox-config-status') {
      sendJson(res, await buildSandboxConfigStatusPayload({
        sessionId: url.searchParams.get('sessionId'),
        userId: url.searchParams.get('userId'),
      }));
      return true;
    }
    if (url.pathname === '/api/sandbox-prompt-preview' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await buildSandboxPromptPreviewPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/sandbox-web-read' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await buildSandboxWebReadPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/sandbox-chat' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const data = await runSandboxChat(body);
        sendJson(res, data);
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
