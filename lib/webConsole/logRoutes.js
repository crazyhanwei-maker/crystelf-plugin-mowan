import { createRouteUtils } from './routeUtils.js';

export function createLogRoutes(options = {}) {
  const {
    buildAffinityLogEntries,
    buildWebConsoleAuditLogEntries,
    buildGroupManagementLogEntries,
    buildImageMonitorLogPayload,
    buildImageMonitorUsageTrendPayload,
    buildSupportBundlePayload,
    diagnoseBotLogsPayload,
    buildLogsPayload,
    buildPerformancePayload,
    buildPokeImageSummaryTrendPayload,
    buildUsageLogEntries,
    buildUsageTrendPayload,
    cleanupImageMonitorNonMemePayload,
    cleanupImageMonitorUnmatchedMemePayload,
    exportDataAsText,
    findAffinityLogEntry,
    findImageMonitorLogEntry,
    findUsageLogEntry,
    getHttpErrorStatus,
    isLogExportType,
    parseRequestBody,
    requireLogsExposed,
    sendJson,
    sendText,
    serveImageMonitorLocalImage,
  } = options;

  const { rejectReadOnly } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/logs') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildLogsPayload());
      return true;
    }
    if (url.pathname === '/api/logs/usage') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildUsageLogEntries({
        query: url.searchParams.get('query'),
        scene: url.searchParams.get('scene'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/performance') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildPerformancePayload({
        slowThresholdMs: url.searchParams.get('slowThresholdMs'),
      }));
      return true;
    }
    if (url.pathname === '/api/logs/affinity') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildAffinityLogEntries({
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/logs/audit') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildWebConsoleAuditLogEntries({
        query: url.searchParams.get('query'),
        action: url.searchParams.get('action'),
        method: url.searchParams.get('method'),
        result: url.searchParams.get('result'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/logs/group-management') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildGroupManagementLogEntries({
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        userId: url.searchParams.get('userId'),
        action: url.searchParams.get('action'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildImageMonitorLogPayload({
        query: url.searchParams.get('query'),
        type: url.searchParams.get('type'),
        risk: url.searchParams.get('risk'),
        isMeme: url.searchParams.get('isMeme'),
        groupId: url.searchParams.get('groupId'),
        userId: url.searchParams.get('userId'),
        alerted: url.searchParams.get('alerted'),
        recalled: url.searchParams.get('recalled'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/logs/diagnose' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await diagnoseBotLogsPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/support-bundle' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const payload = await buildSupportBundlePayload(body);
        sendText(res, JSON.stringify(payload, null, 2), 200, 'application/json; charset=utf-8');
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor/cleanup-non-meme' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, cleanupImageMonitorNonMemePayload());
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor/cleanup-unmatched-meme' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, cleanupImageMonitorUnmatchedMemePayload());
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor/detail') {
      if (!requireLogsExposed(res)) return true;
      const entryId = url.searchParams.get('id');
      const type = url.searchParams.get('type') || 'review';
      const payload = findImageMonitorLogEntry(type, entryId);
      if (!payload) {
        sendJson(res, { success: false, error: 'Not found' }, 404);
        return true;
      }
      sendJson(res, payload);
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor/local-image') {
      if (!requireLogsExposed(res)) return true;
      const entryId = url.searchParams.get('id');
      const type = url.searchParams.get('type') || 'review';
      try {
        serveImageMonitorLocalImage(res, type, entryId);
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs/usage/detail') {
      if (!requireLogsExposed(res)) return true;
      const entryId = url.searchParams.get('id');
      const payload = findUsageLogEntry(entryId);
      if (!payload) {
        sendJson(res, { success: false, error: 'Not found' }, 404);
        return true;
      }
      sendJson(res, payload);
      return true;
    }
    if (url.pathname === '/api/logs/affinity/detail') {
      if (!requireLogsExposed(res)) return true;
      const entryId = url.searchParams.get('id');
      const payload = findAffinityLogEntry(entryId);
      if (!payload) {
        sendJson(res, { success: false, error: 'Not found' }, 404);
        return true;
      }
      sendJson(res, payload);
      return true;
    }
    if (url.pathname === '/api/export') {
      if (rejectReadOnly(res)) return true;
      const type = url.searchParams.get('type');
      if (isLogExportType(type) && !requireLogsExposed(res)) return true;
      const text = exportDataAsText(type, {
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        userId: url.searchParams.get('userId'),
        sessionId: url.searchParams.get('sessionId'),
        action: url.searchParams.get('action'),
        method: url.searchParams.get('method'),
        result: url.searchParams.get('result'),
        scene: url.searchParams.get('scene'),
        risk: url.searchParams.get('risk'),
        isMeme: url.searchParams.get('isMeme'),
        alerted: url.searchParams.get('alerted'),
        recalled: url.searchParams.get('recalled'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
      });
      sendText(res, text, 200, 'application/json; charset=utf-8');
      return true;
    }
    if (url.pathname === '/api/trend/usage') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildUsageTrendPayload());
      return true;
    }
    if (url.pathname === '/api/trend/image-monitor-usage') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildImageMonitorUsageTrendPayload());
      return true;
    }
    if (url.pathname === '/api/trend/poke-image-summary') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildPokeImageSummaryTrendPayload());
      return true;
    }
    return false;
  }

  return {
    handle,
  };
}
