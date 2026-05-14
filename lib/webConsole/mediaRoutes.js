import { createRouteUtils } from './routeUtils.js';

export function createMediaRoutes(options = {}) {
  const {
    logger,
    normalizeImageContentTypeSafe,
    proxyRemoteImageSafe,
    refreshConsoleBackgroundCache,
    requireAuth,
    sendBinary,
    sendJson,
    sendText,
    serveConsoleBackgroundImage,
  } = options;

  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handlePublic(req, res, url) {
    if (url.pathname !== '/console-background-image') {
      return false;
    }
    if (!['GET', 'HEAD'].includes(String(req.method || 'GET').toUpperCase()) && !requireAuth(req, res)) {
      return true;
    }
    try {
      await serveConsoleBackgroundImage(res);
    } catch (error) {
      logger.warn(`[webConsole] Background image route failed: ${error.message}`);
      sendText(res, 'Background image unavailable', 503);
    }
    return true;
  }

  async function handleApi(req, res, url) {
    if (url.pathname === '/api/image-proxy') {
      if (rejectReadOnly(res)) return true;
      const targetUrl = String(url.searchParams.get('url') || '').trim();
      if (!targetUrl) {
        sendJson(res, { success: false, error: 'Bad request' }, 400);
        return true;
      }
      if (!/^https?:\/\//i.test(targetUrl)) {
        sendJson(res, { success: false, error: 'Bad request' }, 400);
        return true;
      }
      try {
        const result = await proxyRemoteImageSafe(targetUrl);
        const contentType = normalizeImageContentTypeSafe(result.contentType);
        sendBinary(res, result.buffer, 200, {
          'Content-Type': contentType,
          'Content-Length': result.buffer.length,
        });
      } catch (error) {
        sendRouteError(res, error, 502);
      }
      return true;
    }
    if (url.pathname === '/api/console-background-image/refresh' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const meta = await refreshConsoleBackgroundCache();
        sendJson(res, {
          success: true,
          updatedAt: meta.updatedAt,
          version: meta.version,
          contentType: meta.contentType,
          size: meta.size,
          url: `/console-background-image?v=${meta.version}`,
        });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 502);
      }
      return true;
    }
    return false;
  }

  return {
    handlePublic,
    handleApi,
  };
}
