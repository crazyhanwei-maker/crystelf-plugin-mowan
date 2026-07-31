import { createRouteUtils } from './routeUtils.js';

export function createAgentWorkbenchRoutes(options = {}) {
  const {
    buildAgentWorkbenchPayload,
    buildAgentWorkbenchNativePayload,
    cancelAgentWorkbenchTask,
    closeAgentWorkbenchTerminal,
    createAgentWorkbenchTask,
    createAgentWorkbenchTerminal,
    getAgentWorkbenchSessionDiff,
    getAgentWorkbenchTask,
    listAgentWorkbenchTerminals,
    manageAgentWorkbenchSession,
    parseRequestBody,
    replyAgentWorkbenchPermission,
    replyAgentWorkbenchQuestion,
    rejectAgentWorkbenchQuestion,
    resizeAgentWorkbenchTerminal,
    saveAgentWorkbenchConfig,
    searchAgentWorkbenchWorkspace,
    sendJson,
    sendAgentWorkbenchTerminalInput,
    subscribeAgentWorkbenchEvents,
  } = options;
  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/agent-workbench/events' && req.method === 'GET') {
      subscribeAgentWorkbenchEvents(req, res);
      return true;
    }
    if (url.pathname === '/api/agent-workbench' && req.method === 'GET') {
      try {
        sendJson(res, await buildAgentWorkbenchPayload({
          force: url.searchParams.get('force') === '1',
          taskId: url.searchParams.get('task') || '',
        }));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/agent-workbench/native' && req.method === 'GET') {
      try {
        sendJson(res, await buildAgentWorkbenchNativePayload(url.searchParams.get('workspace') || ''));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/agent-workbench/settings' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, await saveAgentWorkbenchConfig(await parseRequestBody(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/agent-workbench/tasks' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, {
          success: true,
          task: await createAgentWorkbenchTask(await parseRequestBody(req)),
        }, 202);
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    const permissionMatch = url.pathname.match(/^\/api\/agent-workbench\/tasks\/([A-Za-z0-9_-]+)\/permissions\/([A-Za-z0-9_-]+)$/);
    if (permissionMatch && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, {
          success: true,
          task: await replyAgentWorkbenchPermission(permissionMatch[1], {
            ...(await parseRequestBody(req)),
            requestId: permissionMatch[2],
          }),
        });
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    const questionMatch = url.pathname.match(/^\/api\/agent-workbench\/tasks\/([A-Za-z0-9_-]+)\/questions\/([A-Za-z0-9_-]+)\/(reply|reject)$/);
    if (questionMatch && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const payload = await parseRequestBody(req);
        const handler = questionMatch[3] === 'reply' ? replyAgentWorkbenchQuestion : rejectAgentWorkbenchQuestion;
        sendJson(res, {
          success: true,
          task: await handler(questionMatch[1], {
            ...payload,
            requestId: questionMatch[2],
          }),
        });
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    const sessionActionMatch = url.pathname.match(/^\/api\/agent-workbench\/tasks\/([A-Za-z0-9_-]+)\/session\/(rename|fork|delete|summarize|revert|unrevert)$/);
    if (sessionActionMatch && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, await manageAgentWorkbenchSession(sessionActionMatch[1], sessionActionMatch[2], await parseRequestBody(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    const diffMatch = url.pathname.match(/^\/api\/agent-workbench\/tasks\/([A-Za-z0-9_-]+)\/diff$/);
    if (diffMatch && req.method === 'GET') {
      try {
        sendJson(res, await getAgentWorkbenchSessionDiff(diffMatch[1]));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/agent-workbench/search' && req.method === 'POST') {
      try {
        sendJson(res, await searchAgentWorkbenchWorkspace(await parseRequestBody(req)));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/agent-workbench/terminals' && req.method === 'GET') {
      sendJson(res, { success: true, terminals: listAgentWorkbenchTerminals(url.searchParams.get('workspace') || '') });
      return true;
    }
    if (url.pathname === '/api/agent-workbench/terminals' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, { success: true, terminal: await createAgentWorkbenchTerminal(await parseRequestBody(req)) }, 202);
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    const terminalActionMatch = url.pathname.match(/^\/api\/agent-workbench\/terminals\/([A-Za-z0-9_-]+)\/(input|resize|close)$/);
    if (terminalActionMatch && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const payload = await parseRequestBody(req);
        const handlers = { input: sendAgentWorkbenchTerminalInput, resize: resizeAgentWorkbenchTerminal, close: closeAgentWorkbenchTerminal };
        sendJson(res, { success: true, terminal: await handlers[terminalActionMatch[2]](terminalActionMatch[1], payload) });
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    const taskMatch = url.pathname.match(/^\/api\/agent-workbench\/tasks\/([A-Za-z0-9_-]+)(?:\/(cancel))?$/);
    if (taskMatch && req.method === 'GET' && !taskMatch[2]) {
      try {
        sendJson(res, { success: true, task: getAgentWorkbenchTask(taskMatch[1]) });
      } catch (error) {
        sendRouteError(res, error, 404);
      }
      return true;
    }
    if (taskMatch && taskMatch[2] === 'cancel' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, { success: true, ...cancelAgentWorkbenchTask(taskMatch[1]) });
      } catch (error) {
        sendRouteError(res, error, 404);
      }
      return true;
    }
    return false;
  }

  return { handle };
}
