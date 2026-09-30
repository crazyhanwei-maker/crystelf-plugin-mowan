export function createRouteUtils(options = {}) {
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({ readOnly: false }));
  const sendJson = typeof options.sendJson === 'function' ? options.sendJson : (() => {});
  const getHttpErrorStatus = typeof options.getHttpErrorStatus === 'function'
    ? options.getHttpErrorStatus
    : ((error, fallbackStatus = 500) => Number(error?.statusCode || fallbackStatus));

  function rejectReadOnly(req, res, routeOptions = {}) {
    const allowBootstrap = routeOptions.allowBootstrap === true;
    if (!allowBootstrap && (req?.method === 'GET' || req?.method === 'HEAD')) {
      // 只读模式只锁修改类操作，纯读取请求放行
      return false;
    }
    if (getWebConsoleConfig().readOnly && !allowBootstrap) {
      sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      return true;
    }
    return false;
  }

  function sendRouteError(res, error, fallbackStatus = 500, routeOptions = {}) {
    const payload = {
      success: false,
      error: error.message,
    };
    if (routeOptions.includeCode !== false) {
      payload.code = error.code || '';
    }
    if (routeOptions.includeDetails === true && error.details) {
      Object.assign(payload, error.details);
    }
    return sendJson(res, payload, getHttpErrorStatus(error, fallbackStatus));
  }

  return {
    rejectReadOnly,
    sendRouteError,
  };
}
