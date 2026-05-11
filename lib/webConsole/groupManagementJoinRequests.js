function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function paginateFallback(items = []) {
  return { items: Array.isArray(items) ? items : [] };
}

export function createGroupManagementJoinRequests(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : value => String(value || '').trim();
  const paginateItems = typeof options.paginateItems === 'function' ? options.paginateItems : paginateFallback;
  const listJoinRequests = typeof options.listJoinRequests === 'function' ? options.listJoinRequests : () => [];
  const approveJoinRequest = typeof options.approveJoinRequest === 'function'
    ? options.approveJoinRequest
    : async () => ({});
  const rejectJoinRequest = typeof options.rejectJoinRequest === 'function'
    ? options.rejectJoinRequest
    : async () => ({});
  const addGroupListEntry = typeof options.addGroupListEntry === 'function' ? options.addGroupListEntry : () => null;
  const appendLog = typeof options.appendLog === 'function' ? options.appendLog : () => {};

  function buildPayload(query = {}) {
    const groupId = query.groupId ? normalizeGroupId(query.groupId) : '';
    const queryText = String(query.query || '').trim();
    const status = String(query.status || 'pending').trim();
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 10);
    const items = listJoinRequests({
      groupId,
      status,
      query: queryText,
    });
    return {
      success: true,
      groupId,
      status,
      ...paginateItems(items, page, pageSize),
    };
  }

  async function approvePayload(payload = {}, auditContext = {}) {
    const id = String(payload.id || '').trim();
    if (!id) {
      throw createHttpError(400, '缺少加群申请 ID', 'JOIN_REQUEST_ID_REQUIRED');
    }
    try {
      const item = await approveJoinRequest(id, {
        operator: auditContext.operator || 'webConsole',
        client_ip: auditContext.client_ip || '',
        user_agent: auditContext.user_agent || '',
        reason: payload.reason || '管理员已同意',
      });
      let moderation = null;
      if (payload.whitelist === true) {
        moderation = addGroupListEntry(
          item.groupId,
          'whitelist',
          item.userId,
          payload.note || '加群申请同意后加入白名单',
          auditContext,
        );
        appendLog({
          action: 'member_whitelist_added',
          source: 'webConsole',
          success: true,
          group_id: item.groupId,
          user_id: item.userId,
          operator: auditContext.operator || 'webConsole',
          client_ip: auditContext.client_ip || '',
          user_agent: auditContext.user_agent || '',
          reason: '加群申请同意后加入白名单',
          sections: ['moderation'],
          changes: ['已加入白名单'],
        });
      }
      return {
        success: true,
        item,
        moderation,
        message: '已同意加群申请',
      };
    } catch (error) {
      throw createHttpError(error.message.includes('不存在') ? 404 : 400, error.message, 'JOIN_REQUEST_APPROVE_FAILED');
    }
  }

  async function rejectPayload(payload = {}, auditContext = {}) {
    const id = String(payload.id || '').trim();
    if (!id) {
      throw createHttpError(400, '缺少加群申请 ID', 'JOIN_REQUEST_ID_REQUIRED');
    }
    try {
      const item = await rejectJoinRequest(id, {
        operator: auditContext.operator || 'webConsole',
        client_ip: auditContext.client_ip || '',
        user_agent: auditContext.user_agent || '',
        reason: payload.reason || '管理员已拒绝',
      });
      let moderation = null;
      if (payload.blacklist === true) {
        moderation = addGroupListEntry(
          item.groupId,
          'blacklist',
          item.userId,
          payload.note || '加群申请拒绝后加入黑名单',
          auditContext,
        );
        appendLog({
          action: 'member_blacklist_added',
          source: 'webConsole',
          success: true,
          group_id: item.groupId,
          user_id: item.userId,
          operator: auditContext.operator || 'webConsole',
          client_ip: auditContext.client_ip || '',
          user_agent: auditContext.user_agent || '',
          reason: '加群申请拒绝后加入黑名单',
          sections: ['moderation'],
          changes: ['已加入黑名单'],
        });
      }
      return {
        success: true,
        item,
        moderation,
        message: payload.blacklist === true ? '已拒绝并加入黑名单' : '已拒绝加群申请',
      };
    } catch (error) {
      throw createHttpError(error.message.includes('不存在') ? 404 : 400, error.message, 'JOIN_REQUEST_REJECT_FAILED');
    }
  }

  return {
    buildPayload,
    approvePayload,
    rejectPayload,
  };
}
