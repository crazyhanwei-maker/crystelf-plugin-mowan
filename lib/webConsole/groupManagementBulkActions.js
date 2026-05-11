const GROUP_MANAGEMENT_BULK_FEATURE_LABELS = {
  ai: 'AI 白名单',
  imageMonitor: '图片监控白名单',
  auth: '入群验证',
  autoApprove: '加群申请自动通过',
  welcome: '入群欢迎',
  aiWelcome: 'AI 入群欢迎',
  dailySummary: '每日群聊总结',
};

function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function cloneJsonValueFallback(value, fallback = {}) {
  try {
    return value === undefined ? fallback : JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function isPlainObjectFallback(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createGroupManagementBulkActions(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : value => String(value || '').trim();
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const setMultipleConfigs = typeof options.setMultipleConfigs === 'function' ? options.setMultipleConfigs : async () => {};
  const cloneJsonValue = typeof options.cloneJsonValue === 'function' ? options.cloneJsonValue : cloneJsonValueFallback;
  const normalizeGroupIdList = typeof options.normalizeGroupIdList === 'function' ? options.normalizeGroupIdList : value => (
    Array.isArray(value) ? Array.from(new Set(value.map(normalizeGroupId).filter(Boolean))) : []
  );
  const ensureMainConfigFeatureEnabled = typeof options.ensureMainConfigFeatureEnabled === 'function'
    ? options.ensureMainConfigFeatureEnabled
    : (() => false);
  const normalizeDailySummaryConfig = typeof options.normalizeDailySummaryConfig === 'function'
    ? options.normalizeDailySummaryConfig
    : value => ({ ...(isPlainObjectFallback(value) ? value : {}) });
  const getDefaultAuthConfig = typeof options.getDefaultAuthConfig === 'function' ? options.getDefaultAuthConfig : () => ({});
  const normalizeAuthConfig = typeof options.normalizeAuthConfig === 'function'
    ? options.normalizeAuthConfig
    : value => ({ ...(isPlainObjectFallback(value) ? value : {}) });
  const normalizeAutoApproveConfig = typeof options.normalizeAutoApproveConfig === 'function'
    ? options.normalizeAutoApproveConfig
    : value => ({ ...(isPlainObjectFallback(value) ? value : {}) });
  const isPlainObject = typeof options.isPlainObject === 'function' ? options.isPlainObject : isPlainObjectFallback;
  const appendLog = typeof options.appendLog === 'function' ? options.appendLog : () => {};
  const buildGroupManagementPayload = typeof options.buildGroupManagementPayload === 'function'
    ? options.buildGroupManagementPayload
    : null;

  function normalizeBulkFeature(value = '') {
    const feature = String(value || '').trim();
    if (!Object.prototype.hasOwnProperty.call(GROUP_MANAGEMENT_BULK_FEATURE_LABELS, feature)) {
      throw createHttpError(400, '不支持的批量开启功能', 'GROUP_BULK_FEATURE_INVALID');
    }
    return feature;
  }

  function normalizeBulkGroupIds(value = []) {
    if (!Array.isArray(value)) {
      throw createHttpError(400, '群号列表必须是数组', 'GROUP_BULK_GROUP_IDS_INVALID');
    }
    const ids = [];
    for (const item of value) {
      const normalized = normalizeGroupId(item);
      if (!normalized) {
        throw createHttpError(400, '群号列表中包含无效群号', 'GROUP_BULK_GROUP_ID_INVALID');
      }
      ids.push(normalized);
    }
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      throw createHttpError(400, '请至少选择一个群', 'GROUP_BULK_GROUP_IDS_EMPTY');
    }
    if (uniqueIds.length > 200) {
      throw createHttpError(400, '单次最多批量开启 200 个群', 'GROUP_BULK_GROUP_IDS_TOO_MANY');
    }
    return uniqueIds;
  }

  async function bulkEnableConfig(payload = {}, auditContext = {}) {
    if (!buildGroupManagementPayload) {
      throw createHttpError(500, '群管理批量操作模块未完成初始化', 'GROUP_BULK_NOT_READY');
    }
    const feature = normalizeBulkFeature(payload?.feature);
    const groupIds = normalizeBulkGroupIds(payload?.groupIds);
    const requestedSelectedGroupId = normalizeGroupId(payload?.selectedGroupId);
    const selectedGroupId = requestedSelectedGroupId || groupIds[0];
    const allConfigs = getAllConfigs() || {};
    const writes = {};
    const perGroupChanges = new Map(groupIds.map(groupId => [groupId, []]));

    const addGroupChange = (groupId, change) => {
      const changes = perGroupChanges.get(groupId) || [];
      changes.push(change);
      perGroupChanges.set(groupId, changes);
    };

    if (feature === 'ai') {
      const currentAi = cloneJsonValue(allConfigs.ai || {}, {});
      const whiteSet = new Set(normalizeGroupIdList(currentAi.whiteGroup));
      const blockSet = new Set(normalizeGroupIdList(currentAi.blockGroup));
      for (const groupId of groupIds) {
        whiteSet.add(groupId);
        blockSet.delete(groupId);
        addGroupChange(groupId, '已批量加入 AI 白名单');
      }
      currentAi.whiteGroup = Array.from(whiteSet);
      currentAi.blockGroup = Array.from(blockSet);
      writes.ai = currentAi;
      ensureMainConfigFeatureEnabled(writes, allConfigs, 'ai');
    }

    if (feature === 'imageMonitor') {
      const currentImageMonitor = cloneJsonValue(allConfigs.imageMonitor || {}, {});
      const allowedSet = new Set(normalizeGroupIdList(currentImageMonitor.allowedGroups));
      const blockedSet = new Set(normalizeGroupIdList(currentImageMonitor.blockedGroups));
      for (const groupId of groupIds) {
        allowedSet.add(groupId);
        blockedSet.delete(groupId);
        addGroupChange(groupId, '已批量加入图片监控白名单');
      }
      currentImageMonitor.allowedGroups = Array.from(allowedSet);
      currentImageMonitor.blockedGroups = Array.from(blockedSet);
      writes.imageMonitor = currentImageMonitor;
      ensureMainConfigFeatureEnabled(writes, allConfigs, 'imageMonitor');
    }

    if (feature === 'dailySummary') {
      const currentAi = cloneJsonValue(allConfigs.ai || {}, {});
      const currentSummary = normalizeDailySummaryConfig(currentAi.dailyGroupSummary || {});
      const enabledSet = new Set(normalizeGroupIdList(currentSummary.enabledGroups));
      const blockedSet = new Set(normalizeGroupIdList(currentSummary.blockedGroups));
      for (const groupId of groupIds) {
        enabledSet.add(groupId);
        blockedSet.delete(groupId);
        addGroupChange(groupId, '已批量开启每日群聊总结');
      }
      currentAi.dailyGroupSummary = {
        ...(isPlainObject(currentAi.dailyGroupSummary) ? currentAi.dailyGroupSummary : {}),
        enabled: true,
        targetMode: 'selected',
        enabledGroups: Array.from(enabledSet),
        blockedGroups: Array.from(blockedSet),
      };
      writes.ai = currentAi;
      ensureMainConfigFeatureEnabled(writes, allConfigs, 'ai');
    }

    if (feature === 'auth' || feature === 'autoApprove') {
      const currentAuth = cloneJsonValue(allConfigs.auth || {}, {});
      const authDefault = getDefaultAuthConfig(currentAuth);
      const currentGroups = isPlainObject(currentAuth.groups) ? { ...currentAuth.groups } : {};
      for (const groupId of groupIds) {
        const normalizedAuth = normalizeAuthConfig(
          isPlainObject(currentGroups[groupId]) ? currentGroups[groupId] : authDefault,
          authDefault,
        );
        if (feature === 'auth') {
          normalizedAuth.enable = true;
          addGroupChange(groupId, '已批量开启入群验证');
        } else {
          normalizedAuth.autoApprove = normalizeAutoApproveConfig(
            normalizedAuth.autoApprove,
            authDefault.autoApprove || {},
          );
          normalizedAuth.autoApprove.enable = true;
          addGroupChange(groupId, '已批量开启加群申请自动通过');
        }
        currentGroups[groupId] = normalizedAuth;
      }
      currentAuth.groups = currentGroups;
      writes.auth = currentAuth;
      ensureMainConfigFeatureEnabled(writes, allConfigs, 'auth');
    }

    if (feature === 'welcome' || feature === 'aiWelcome') {
      const currentNewcomer = cloneJsonValue(allConfigs.newcomer || {}, {});
      for (const groupId of groupIds) {
        const currentWelcome = isPlainObject(currentNewcomer[groupId]) ? { ...currentNewcomer[groupId] } : {};
        currentWelcome.enabled = true;
        if (feature === 'aiWelcome') currentWelcome.aiEnabled = true;
        currentNewcomer[groupId] = currentWelcome;
        addGroupChange(groupId, feature === 'aiWelcome' ? '已批量开启 AI 入群欢迎' : '已批量开启入群欢迎');
      }
      writes.newcomer = currentNewcomer;
      ensureMainConfigFeatureEnabled(writes, allConfigs, 'welcome');
    }

    if (Object.keys(writes).length === 0) {
      throw createHttpError(400, '没有可批量开启的群配置', 'GROUP_BULK_CONFIG_EMPTY');
    }

    await setMultipleConfigs(writes);
    for (const groupId of groupIds) {
      appendLog({
        action: 'bulk_enable_groups',
        source: 'webConsole',
        success: true,
        group_id: groupId,
        operator: auditContext.operator || 'webConsole',
        client_ip: auditContext.client_ip || '',
        user_agent: auditContext.user_agent || '',
        sections: Object.keys(writes),
        changes: perGroupChanges.get(groupId) || [],
        summary: {
          feature,
          featureLabel: GROUP_MANAGEMENT_BULK_FEATURE_LABELS[feature],
          selectedCount: groupIds.length,
        },
      });
    }

    const data = await buildGroupManagementPayload({ groupId: selectedGroupId });
    return {
      ...data,
      message: `已为 ${groupIds.length} 个群开启${GROUP_MANAGEMENT_BULK_FEATURE_LABELS[feature]}`,
    };
  }

  return {
    bulkEnableConfig,
    featureLabels: GROUP_MANAGEMENT_BULK_FEATURE_LABELS,
    normalizeBulkFeature,
    normalizeBulkGroupIds,
  };
}
