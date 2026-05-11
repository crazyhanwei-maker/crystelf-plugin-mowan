import { createRouteUtils } from './routeUtils.js';

export function createQqSimulatorRoutes(options = {}) {
  const {
    buildQqSimulatorPreviewPayload,
    buildQqSimulatorScenarioBackupListPayload,
    buildQqSimulatorSendPayload,
    clearQqSimulatorScenariosPayload,
    deleteQqSimulatorScenarioPayload,
    enqueueQqSimulatorScenarioTask,
    importQqSimulatorScenariosPayload,
    listQqSimulatorScenariosPayload,
    parseRequestBody,
    restoreQqSimulatorScenarioBackupPayload,
    saveQqSimulatorScenarioPayload,
    sendJson,
  } = options;

  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/qq-simulator')) {
      return false;
    }
    if (url.pathname === '/api/qq-simulator/preview' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        sendJson(res, buildQqSimulatorPreviewPayload(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/qq-simulator/scenarios' && req.method === 'GET') {
      sendJson(res, listQqSimulatorScenariosPayload());
      return true;
    }
    if (url.pathname === '/api/qq-simulator/scenarios/backups' && req.method === 'GET') {
      sendJson(res, buildQqSimulatorScenarioBackupListPayload());
      return true;
    }
    if (url.pathname === '/api/qq-simulator/scenarios/save' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await enqueueQqSimulatorScenarioTask(() => saveQqSimulatorScenarioPayload(body)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/qq-simulator/scenarios/import' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await enqueueQqSimulatorScenarioTask(() => importQqSimulatorScenariosPayload(body)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/qq-simulator/scenarios/delete' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await enqueueQqSimulatorScenarioTask(() => deleteQqSimulatorScenarioPayload(body)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/qq-simulator/scenarios/clear' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, await enqueueQqSimulatorScenarioTask(() => clearQqSimulatorScenariosPayload()));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/qq-simulator/scenarios/restore' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await enqueueQqSimulatorScenarioTask(() => restoreQqSimulatorScenarioBackupPayload(body)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/qq-simulator/send' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await buildQqSimulatorSendPayload(body));
      } catch (error) {
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
