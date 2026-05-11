import { createFileBrowserRoutes } from './fileBrowserRoutes.js';
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

export function createWebConsoleHandler(options = {}) {
  const fileBrowserRoutes = createFileBrowserRoutes(options);
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
  const {
    buildAuthStatusPayload,
    buildConfigPayload,
    buildHealthPayload,
    buildOverviewPayload,
    buildWebConsoleAuthCookieClearHeader,
    getHttpErrorStatus,
    isBootstrapApiPath,
    isBootstrapSetupRequest,
    loginWebConsole,
    requireAuth,
    requireCsrf,
    requireSameOrigin,
    sendJson,
    serveStatic,
  } = options;

  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const requiresSameOriginCheck = !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase());
    const bootstrapMode = isBootstrapSetupRequest(req);
    const bootstrapApiAllowed = bootstrapMode && isBootstrapApiPath(url.pathname);
    if (await mediaRoutes.handlePublic(req, res, url)) return;
    if (url.pathname === '/api/auth/status') {
      return sendJson(res, buildAuthStatusPayload(req));
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
    if (await dependencyRoutes.handle(req, res, url)) return;
    if (await userDataRoutes.handle(req, res, url)) return;
    if (url.pathname === '/api/config') {
      return sendJson(res, buildConfigPayload());
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
