function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeIntegerInRangeFallback(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function createGroupManagementTitleApplications(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : value => String(value || '').trim();
  const normalizeUserId = typeof options.normalizeUserId === 'function'
    ? options.normalizeUserId
    : value => String(value || '').trim();
  const normalizeIntegerInRange = typeof options.normalizeIntegerInRange === 'function'
    ? options.normalizeIntegerInRange
    : normalizeIntegerInRangeFallback;
  const getTitleConfig = typeof options.getTitleConfig === 'function' ? options.getTitleConfig : () => ({});
  const pruneExpiredApplications = typeof options.pruneExpiredApplications === 'function' ? options.pruneExpiredApplications : () => {};
  const listApplications = typeof options.listApplications === 'function' ? options.listApplications : () => [];
  const findApplicationById = typeof options.findApplicationById === 'function' ? options.findApplicationById : () => null;
  const updateApplicationStatus = typeof options.updateApplicationStatus === 'function' ? options.updateApplicationStatus : () => ({});
  const paginateItems = typeof options.paginateItems === 'function'
    ? options.paginateItems
    : ((items = []) => ({ items: Array.isArray(items) ? items : [] }));
  const pickRuntimeGroup = typeof options.pickRuntimeGroup === 'function' ? options.pickRuntimeGroup : async () => ({});
  const getBotInstances = typeof options.getBotInstances === 'function' ? options.getBotInstances : () => [];
  const withTimeout = typeof options.withTimeout === 'function' ? options.withTimeout : async promiseLike => await promiseLike;
  const appendLog = typeof options.appendLog === 'function' ? options.appendLog : () => {};

  function normalizeStatusFilter(value = '') {
    const status = String(value || 'pending').trim().toLowerCase();
    return ['pending', 'approved', 'rejected', 'failed', 'cancelled', 'expired', 'all'].includes(status)
      ? status
      : 'pending';
  }

  function normalizeExpireHours(config = {}) {
    const source = isPlainObject(config) ? config : {};
    return normalizeIntegerInRange(source.pendingExpireHours, 72, 1, 720);
  }

  function normalizeForbiddenKeywords(value = []) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
      value
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .map(item => item.slice(0, 40)),
    )).slice(0, 200);
  }

  function findForbiddenKeyword(title = '', config = {}) {
    const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalizedTitle) return '';
    return normalizeForbiddenKeywords(config?.forbiddenKeywords)
      .find(keyword => normalizedTitle.includes(String(keyword || '').toLowerCase())) || '';
  }

  function assertForbiddenKeywordAllowed(title = '', config = getTitleConfig() || {}) {
    const keyword = findForbiddenKeyword(title, config);
    if (keyword) {
      throw createHttpError(400, `头衔包含禁用词：${keyword}`, 'GROUP_TITLE_FORBIDDEN_KEYWORD');
    }
  }

  function getApiId(value = '') {
    const normalized = String(value || '').trim();
    const numeric = Number(normalized);
    return Number.isSafeInteger(numeric) ? numeric : normalized;
  }

  async function setTitleFromWebConsole(groupId = '', userId = '', title = '') {
    const normalizedGroupId = normalizeGroupId(groupId);
    const normalizedUserId = normalizeUserId(userId);
    const targetTitle = String(title || '').trim();
    if (!targetTitle) {
      throw createHttpError(400, '头衔内容为空', 'GROUP_TITLE_EMPTY');
    }
    assertForbiddenKeywordAllowed(targetTitle);
    const { bot, group } = await pickRuntimeGroup(normalizedGroupId);
    if (group) {
      if (typeof group.setTitle === 'function') {
        return await withTimeout(
          group.setTitle(getApiId(normalizedUserId), targetTitle, -1),
          'setTitle',
        );
      }
      if (typeof group.setSpecialTitle === 'function') {
        return await withTimeout(
          group.setSpecialTitle(getApiId(normalizedUserId), targetTitle, -1),
          'setSpecialTitle',
        );
      }
    }
    if (typeof bot?.setGroupSpecialTitle === 'function') {
      return await withTimeout(
        bot.setGroupSpecialTitle(
          getApiId(normalizedGroupId),
          getApiId(normalizedUserId),
          targetTitle,
          -1,
        ),
        'setGroupSpecialTitle',
      );
    }
    const apiBot = bot || getBotInstances().find(item => typeof item.sendApi === 'function');
    if (typeof apiBot?.sendApi === 'function') {
      return await withTimeout(
        apiBot.sendApi('set_group_special_title', {
          group_id: getApiId(normalizedGroupId),
          user_id: getApiId(normalizedUserId),
          special_title: targetTitle,
          duration: -1,
        }),
        'set_group_special_title',
      );
    }
    throw createHttpError(400, '当前适配器不支持设置群头衔', 'GROUP_TITLE_ADAPTER_UNSUPPORTED');
  }

  function buildPayload(query = {}) {
    const groupId = query.groupId ? normalizeGroupId(query.groupId) : '';
    const status = normalizeStatusFilter(query.status);
    const queryText = String(query.query || '').trim();
    const titleConfig = getTitleConfig() || {};
    pruneExpiredApplications(normalizeExpireHours(titleConfig));
    const items = listApplications({
      groupId,
      status,
      query: queryText,
    }).map(item => ({
      ...item,
      forbiddenKeyword: findForbiddenKeyword(item.title, titleConfig),
    }));
    return {
      success: true,
      groupId,
      status,
      ...paginateItems(items, Number(query.page || 1), Number(query.pageSize || 10)),
    };
  }

  function getApplicationForReview(id = '') {
    const normalizedId = String(id || '').trim().toUpperCase();
    if (!normalizedId) {
      throw createHttpError(400, '缺少头衔申请编号', 'GROUP_TITLE_APPLICATION_ID_REQUIRED');
    }
    const record = findApplicationById(normalizedId);
    if (!record) {
      throw createHttpError(404, '头衔申请不存在', 'GROUP_TITLE_APPLICATION_NOT_FOUND');
    }
    if (!['pending', 'failed'].includes(String(record.status || ''))) {
      throw createHttpError(400, '该头衔申请当前状态不可审核', 'GROUP_TITLE_APPLICATION_STATUS_INVALID');
    }
    return record;
  }

  async function approvePayload(payload = {}, auditContext = {}) {
    const record = getApplicationForReview(payload?.id);
    try {
      await setTitleFromWebConsole(record.groupId, record.userId, record.title);
      const item = updateApplicationStatus(record.id, 'approved', {
        reviewerId: auditContext.operator || 'webConsole',
        reviewerName: '控制台',
        reason: String(payload.reason || '控制台手动通过').replace(/\s+/g, ' ').trim().slice(0, 120),
        error: '',
      });
      appendLog({
        action: 'group_title_manual_approved',
        source: 'webConsole',
        success: true,
        group_id: record.groupId,
        user_id: record.userId,
        operator: auditContext.operator || 'webConsole',
        client_ip: auditContext.client_ip || '',
        user_agent: auditContext.user_agent || '',
        sections: ['groupTitle'],
        changes: [`已发放头衔：${record.title}`],
        summary: {
          applicationId: record.id,
          title: record.title,
        },
      });
      return {
        success: true,
        item,
        message: `已通过并发放头衔：${record.title}`,
      };
    } catch (error) {
      const isPolicyError = error.code === 'GROUP_TITLE_FORBIDDEN_KEYWORD';
      const item = updateApplicationStatus(record.id, 'failed', {
        reviewerId: auditContext.operator || 'webConsole',
        reviewerName: '控制台',
        reason: String(payload.reason || '控制台手动通过').replace(/\s+/g, ' ').trim().slice(0, 120),
        error: error.message,
      });
      appendLog({
        action: 'group_title_manual_approve_failed',
        source: 'webConsole',
        success: false,
        group_id: record.groupId,
        user_id: record.userId,
        operator: auditContext.operator || 'webConsole',
        client_ip: auditContext.client_ip || '',
        user_agent: auditContext.user_agent || '',
        error: error.message,
        sections: ['groupTitle'],
        changes: [isPolicyError ? `头衔命中禁用词：${record.title}` : `头衔发放失败：${record.title}`],
        summary: {
          applicationId: record.id,
          title: record.title,
        },
      });
      throw createHttpError(
        400,
        isPolicyError ? error.message : `头衔发放失败：${error.message}`,
        isPolicyError ? error.code : 'GROUP_TITLE_APPROVE_FAILED',
        { item },
      );
    }
  }

  async function rejectPayload(payload = {}, auditContext = {}) {
    const record = getApplicationForReview(payload?.id);
    const reason = String(payload.reason || '控制台手动拒绝').replace(/\s+/g, ' ').trim().slice(0, 120) || '控制台手动拒绝';
    const item = updateApplicationStatus(record.id, 'rejected', {
      reviewerId: auditContext.operator || 'webConsole',
      reviewerName: '控制台',
      reason,
      error: '',
    });
    appendLog({
      action: 'group_title_manual_rejected',
      source: 'webConsole',
      success: true,
      group_id: record.groupId,
      user_id: record.userId,
      operator: auditContext.operator || 'webConsole',
      client_ip: auditContext.client_ip || '',
      user_agent: auditContext.user_agent || '',
      reason,
      sections: ['groupTitle'],
      changes: [`已拒绝头衔：${record.title}`],
      summary: {
        applicationId: record.id,
        title: record.title,
      },
    });
    return {
      success: true,
      item,
      message: '已拒绝头衔申请',
    };
  }

  return {
    buildPayload,
    approvePayload,
    rejectPayload,
    findForbiddenKeyword,
    setTitleFromWebConsole,
  };
}
