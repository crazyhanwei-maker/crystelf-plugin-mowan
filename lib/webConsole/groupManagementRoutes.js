import { createRouteUtils } from './routeUtils.js';

export function createGroupManagementRoutes(options = {}) {
  const {
    addGroupManagementWarningPayload,
    applyGroupManagementHealthFixPayload,
    approveGroupManagementJoinRequestPayload,
    approveGroupManagementTitleApplicationPayload,
    buildGroupManagementAuditContext,
    buildGroupManagementEventFeedPayload,
    buildGroupManagementJoinRequestsPayload,
    buildGroupManagementMembersPayload,
    buildGroupManagementPayload,
    buildGroupManagementRuleDebugPayload,
    buildGroupManagementTitleApplicationsPayload,
    bulkEnableGroupManagementConfig,
    clearGroupManagementWarningPayload,
    convertGroupManagementLogToScenarioPayload,
    enqueueQqSimulatorScenarioTask,
    listGroupConfigBackups,
    normalizeGroupManagementId,
    parseRequestBody,
    rejectGroupManagementJoinRequestPayload,
    rejectGroupManagementTitleApplicationPayload,
    requireLogsExposed,
    rollbackGroupManagementConfigPayload,
    saveGroupManagementConfig,
    saveGroupManagementDefaultsConfig,
    saveGroupManagementSafetyPayload,
    sendJson,
    serveGroupManagementEventStream,
    serveGroupWelcomeImage,
  } = options;

  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/group-management')) {
      return false;
    }
    if (url.pathname === '/api/group-management') {
      try {
        sendJson(res, await buildGroupManagementPayload({
          groupId: url.searchParams.get('groupId'),
        }));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/events') {
      try {
        if (url.searchParams.get('stream') === '1' || String(req.headers.accept || '').includes('text/event-stream')) {
          serveGroupManagementEventStream(req, res, {
            groupId: url.searchParams.get('groupId'),
            type: url.searchParams.get('type'),
            limit: url.searchParams.get('limit'),
          });
          return true;
        }
        sendJson(res, buildGroupManagementEventFeedPayload({
          groupId: url.searchParams.get('groupId'),
          type: url.searchParams.get('type'),
          since: url.searchParams.get('since'),
          limit: url.searchParams.get('limit'),
        }));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/log-to-scenario' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const payload = body.save === true
          ? await enqueueQqSimulatorScenarioTask(() => convertGroupManagementLogToScenarioPayload(body))
          : convertGroupManagementLogToScenarioPayload(body);
        sendJson(res, payload);
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/rule-debug' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await buildGroupManagementRuleDebugPayload(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/health/fix' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await applyGroupManagementHealthFixPayload(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/safety/save' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await saveGroupManagementSafetyPayload(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/defaults/save' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await saveGroupManagementDefaultsConfig(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/members') {
      try {
        sendJson(res, await buildGroupManagementMembersPayload({
          groupId: url.searchParams.get('groupId'),
          query: url.searchParams.get('query'),
          page: url.searchParams.get('page'),
          pageSize: url.searchParams.get('pageSize'),
        }));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/join-requests') {
      try {
        sendJson(res, buildGroupManagementJoinRequestsPayload({
          groupId: url.searchParams.get('groupId'),
          query: url.searchParams.get('query'),
          status: url.searchParams.get('status') || 'pending',
          page: url.searchParams.get('page'),
          pageSize: url.searchParams.get('pageSize'),
        }));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/join-requests/approve' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await approveGroupManagementJoinRequestPayload(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/join-requests/reject' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await rejectGroupManagementJoinRequestPayload(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/title-applications') {
      try {
        sendJson(res, buildGroupManagementTitleApplicationsPayload({
          groupId: url.searchParams.get('groupId'),
          query: url.searchParams.get('query'),
          status: url.searchParams.get('status') || 'pending',
          page: url.searchParams.get('page'),
          pageSize: url.searchParams.get('pageSize'),
        }));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/title-applications/approve' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await approveGroupManagementTitleApplicationPayload(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/title-applications/reject' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await rejectGroupManagementTitleApplicationPayload(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/warnings/add' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await addGroupManagementWarningPayload(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/warnings/clear' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await clearGroupManagementWarningPayload(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/welcome-image') {
      try {
        serveGroupWelcomeImage(res, url.searchParams.get('groupId'));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/bulk-enable' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await bulkEnableGroupManagementConfig(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/backups') {
      try {
        const groupId = normalizeGroupManagementId(url.searchParams.get('groupId'));
        sendJson(res, {
          success: true,
          groupId,
          items: listGroupConfigBackups(groupId, Number(url.searchParams.get('limit') || 12)).map(item => ({
            id: item.id,
            groupId: item.groupId,
            createdAt: item.createdAt,
            operator: item.operator,
            action: item.action,
            note: item.note,
          })),
        });
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/backups/rollback' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await rollbackGroupManagementConfigPayload(body, buildGroupManagementAuditContext(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/group-management/save' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await saveGroupManagementConfig(body, buildGroupManagementAuditContext(req)));
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
