function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

export function createGroupManagementMemberWarnings(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : value => String(value || '').trim();
  const addWarning = typeof options.addWarning === 'function' ? options.addWarning : () => ({});
  const clearWarnings = typeof options.clearWarnings === 'function' ? options.clearWarnings : () => ({});
  const appendLog = typeof options.appendLog === 'function' ? options.appendLog : () => {};

  function normalizeUserId(value = '') {
    const text = String(value ?? '').trim();
    if (!/^\d{5,20}$/.test(text)) {
      throw createHttpError(400, 'QQ 号必须是 5-20 位数字', 'GROUP_MEMBER_ID_INVALID');
    }
    return text;
  }

  function normalizeReason(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 180) || '管理员警告';
  }

  async function addWarningPayload(payload = {}, auditContext = {}) {
    const groupId = normalizeGroupId(payload?.groupId);
    const userId = normalizeUserId(payload?.userId);
    const reason = normalizeReason(payload?.reason);
    try {
      const result = addWarning(groupId, userId, reason, auditContext);
      appendLog({
        action: 'member_warning_added',
        source: 'webConsole',
        success: true,
        group_id: groupId,
        user_id: userId,
        operator: auditContext.operator || 'webConsole',
        client_ip: auditContext.client_ip || '',
        user_agent: auditContext.user_agent || '',
        reason,
        sections: ['moderation'],
        changes: [`已增加警告积分：${reason}`],
        summary: {
          warningCount: result.warning?.count || 0,
        },
      });
      return {
        success: true,
        moderation: result.state,
        warning: result.warning,
        message: '已增加警告积分',
      };
    } catch (error) {
      throw createHttpError(400, error.message, 'GROUP_WARNING_ADD_FAILED');
    }
  }

  async function clearWarningPayload(payload = {}, auditContext = {}) {
    const groupId = normalizeGroupId(payload?.groupId);
    const userId = normalizeUserId(payload?.userId);
    try {
      const result = clearWarnings(groupId, userId);
      appendLog({
        action: 'member_warning_cleared',
        source: 'webConsole',
        success: true,
        group_id: groupId,
        user_id: userId,
        operator: auditContext.operator || 'webConsole',
        client_ip: auditContext.client_ip || '',
        user_agent: auditContext.user_agent || '',
        sections: ['moderation'],
        changes: ['已清空该成员警告积分'],
        summary: {
          removedCount: result.removed?.count || 0,
        },
      });
      return {
        success: true,
        moderation: result.state,
        removed: result.removed,
        message: '已清空警告积分',
      };
    } catch (error) {
      throw createHttpError(400, error.message, 'GROUP_WARNING_CLEAR_FAILED');
    }
  }

  return {
    normalizeUserId,
    addWarningPayload,
    clearWarningPayload,
  };
}
