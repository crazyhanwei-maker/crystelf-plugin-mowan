// 自定义定时任务 CRUD 与手动执行路由。
import { createRouteUtils } from './routeUtils.js';

export function createCustomTaskRoutes(options = {}) {
  const { parseRequestBody, sendJson, customTaskScheduler } = options;
  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  function getScheduler() {
    return customTaskScheduler || null;
  }

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/custom-tasks')) return false;
    const scheduler = getScheduler();
    if (!scheduler) {
      sendJson(res, { success: false, error: '自定义任务模块不可用' }, 500);
      return true;
    }
    try {
      if (url.pathname === '/api/custom-tasks' && req.method === 'GET') {
        sendJson(res, { success: true, tasks: scheduler.listTasks() });
        return true;
      }
      if (req.method === 'POST') {
        if (rejectReadOnly(req, res)) return true;
        const body = await parseRequestBody(req);
        if (url.pathname === '/api/custom-tasks') {
          sendJson(res, scheduler.saveTask(body));
          return true;
        }
        if (url.pathname === '/api/custom-tasks/delete') {
          sendJson(res, scheduler.deleteTask(String(body?.id || '')));
          return true;
        }
        if (url.pathname === '/api/custom-tasks/enabled') {
          sendJson(res, scheduler.setTaskEnabled(String(body?.id || ''), body?.enabled === true));
          return true;
        }
        if (url.pathname === '/api/custom-tasks/run') {
          sendJson(res, await scheduler.runTaskManually(String(body?.id || '')));
          return true;
        }
      }
    } catch (error) {
      sendRouteError(res, error, 500);
      return true;
    }
    sendJson(res, { success: false, error: '不支持的自定义任务操作' }, 404);
    return true;
  }

  return { handle };
}
