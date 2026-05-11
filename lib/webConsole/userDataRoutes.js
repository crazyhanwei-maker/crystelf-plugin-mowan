import { createRouteUtils } from './routeUtils.js';

export function createUserDataRoutes(options = {}) {
  const {
    buildAffinityHistoryPayload,
    buildAffinityListPayload,
    buildProfileDetailPayload,
    buildProfilesPayload,
    buildSessionDebugPayload,
    buildSessionListPayload,
    deleteUserProfile,
    parseRequestBody,
    requireLogsExposed,
    resetAffinityRecord,
    resetSessionMessagesOnly,
    resetSessionRecord,
    sendJson,
  } = options;

  const { rejectReadOnly } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/affinity') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, buildAffinityListPayload({
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/profiles') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, buildProfilesPayload({
        query: url.searchParams.get('query'),
        sessionId: url.searchParams.get('sessionId'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/sessions') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, buildSessionListPayload({
        query: url.searchParams.get('query'),
        sessionId: url.searchParams.get('sessionId'),
        userId: url.searchParams.get('userId'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/profile-detail') {
      if (rejectReadOnly(res)) return true;
      const sessionId = url.searchParams.get('sessionId');
      const userId = url.searchParams.get('userId');
      const payload = buildProfileDetailPayload(sessionId, userId);
      if (!payload) {
        sendJson(res, { success: false, error: 'Not found' }, 404);
        return true;
      }
      sendJson(res, payload);
      return true;
    }
    if (url.pathname === '/api/session-debug') {
      if (rejectReadOnly(res)) return true;
      const sessionId = url.searchParams.get('sessionId');
      const userId = url.searchParams.get('userId');
      const payload = buildSessionDebugPayload(sessionId, userId);
      if (!payload) {
        sendJson(res, { success: false, error: 'Not found' }, 404);
        return true;
      }
      sendJson(res, payload);
      return true;
    }
    if (url.pathname === '/api/affinity-history') {
      if (rejectReadOnly(res)) return true;
      if (!requireLogsExposed(res)) return true;
      const groupId = url.searchParams.get('groupId');
      const userId = url.searchParams.get('userId');
      sendJson(res, buildAffinityHistoryPayload(groupId, userId));
      return true;
    }
    if (url.pathname === '/api/affinity/reset' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        if (!body.groupId || !body.userId) {
          sendJson(res, { success: false, error: 'Bad request' }, 400);
          return true;
        }
        resetAffinityRecord(body.groupId, body.userId);
        sendJson(res, { success: true });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/profiles/delete' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        if (!body.sessionId || !body.userId) {
          sendJson(res, { success: false, error: 'Bad request' }, 400);
          return true;
        }
        deleteUserProfile(body.sessionId, body.userId);
        sendJson(res, { success: true });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/sessions/reset' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        if (!body.sessionId) {
          sendJson(res, { success: false, error: 'Bad request' }, 400);
          return true;
        }
        const mode = String(body.mode || 'full').trim();
        if (mode === 'messages_only') {
          resetSessionMessagesOnly(body.sessionId);
        } else {
          resetSessionRecord(body.sessionId);
        }
        sendJson(res, { success: true, sessionId: body.sessionId, mode });
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
