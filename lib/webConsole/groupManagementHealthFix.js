import { GROUP_MANAGEMENT_HEALTH_AUTO_FIX_CODES } from './groupManagementHealth.js';

function normalizeFixCode(value = '') {
  return String(value || '').trim();
}

function normalizeFixGroupIds(value = [], normalizeGroupId = item => String(item || '').trim()) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,，、;\s]+/);
  return Array.from(new Set(source.map(normalizeGroupId).filter(Boolean))).slice(0, 20);
}

function findCurrentHealthItem(health = {}, code = '') {
  return (Array.isArray(health.items) ? health.items : [])
    .find(item => String(item.code || '').trim() === code) || null;
}

function getCurrentHealthGroupIds(item = {}, normalizeGroupId = value => String(value || '').trim()) {
  return new Set((Array.isArray(item.groups) ? item.groups : [])
    .map(group => normalizeGroupId(group.groupId || group.id || group))
    .filter(Boolean));
}

export function createGroupManagementHealthFix(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode, message, code) => Object.assign(new Error(message), { statusCode, code }));
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : value => String(value || '').trim();
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const getGroupModerationState = typeof options.getGroupModerationState === 'function'
    ? options.getGroupModerationState
    : () => ({});
  const getSafetyConfig = typeof options.getSafetyConfig === 'function' ? options.getSafetyConfig : () => ({});
  const getDefaultAuthConfig = typeof options.getDefaultAuthConfig === 'function' ? options.getDefaultAuthConfig : () => ({});
  const normalizeAuthConfig = typeof options.normalizeAuthConfig === 'function'
    ? options.normalizeAuthConfig
    : value => ({ ...(value || {}) });
  const getDefaultWelcomeConfig = typeof options.getDefaultWelcomeConfig === 'function' ? options.getDefaultWelcomeConfig : () => ({});
  const normalizeWelcomeConfig = typeof options.normalizeWelcomeConfig === 'function'
    ? options.normalizeWelcomeConfig
    : value => ({ ...(value || {}) });
  const buildGroupManagementPayload = typeof options.buildGroupManagementPayload === 'function'
    ? options.buildGroupManagementPayload
    : null;
  const saveGroupManagementConfig = typeof options.saveGroupManagementConfig === 'function'
    ? options.saveGroupManagementConfig
    : null;

  function buildFixPayloadForGroup(code = '', groupId = '') {
    const allConfigs = getAllConfigs() || {};
    if (code === 'ai_group_allow_block_conflict') {
      return { groupId, ai: { blocked: false } };
    }
    if (code === 'image_monitor_allow_block_conflict') {
      return { groupId, imageMonitor: { blocked: false } };
    }
    if (code === 'daily_summary_allow_block_conflict') {
      return { groupId, dailySummary: { blocked: false } };
    }
    if (code === 'dangerous_action_blocked_by_safety') {
      const state = getGroupModerationState(groupId);
      return {
        groupId,
        moderation: {
          content: {
            ...(state.content || {}),
            action: 'warn',
            addWarning: true,
            dangerConfirmed: true,
          },
        },
      };
    }
    if (code === 'mute_seconds_over_safety_limit') {
      const state = getGroupModerationState(groupId);
      const safety = getSafetyConfig();
      return {
        groupId,
        moderation: {
          content: {
            ...(state.content || {}),
            muteSeconds: Number(safety.maxAutoMuteSeconds || 600),
            dangerConfirmed: true,
          },
        },
      };
    }
    if (code === 'auto_approve_without_conditions') {
      const authConfig = allConfigs.auth || {};
      const authDefault = getDefaultAuthConfig(authConfig);
      const currentGroupConfig = normalizeAuthConfig(authConfig.groups?.[groupId] || {}, authDefault);
      currentGroupConfig.autoApprove = {
        ...(currentGroupConfig.autoApprove || {}),
        enable: false,
      };
      return { groupId, auth: currentGroupConfig };
    }
    if (code === 'ai_welcome_enabled_but_welcome_disabled') {
      const newcomer = allConfigs.newcomer || {};
      const welcomeDefault = getDefaultWelcomeConfig(newcomer);
      const currentWelcome = normalizeWelcomeConfig(newcomer[groupId] || {}, welcomeDefault);
      return { groupId, welcome: { ...currentWelcome, aiEnabled: false } };
    }
    if (code === 'welcome_enabled_without_content') {
      const newcomer = allConfigs.newcomer || {};
      const welcomeDefault = getDefaultWelcomeConfig(newcomer);
      const currentWelcome = normalizeWelcomeConfig(newcomer[groupId] || {}, welcomeDefault);
      return { groupId, welcome: { ...currentWelcome, enabled: false } };
    }
    throw createHttpError(400, '这个健康检查项不支持自动修复', 'GROUP_HEALTH_FIX_UNSUPPORTED');
  }

  async function applyPayload(body = {}, auditContext = {}) {
    if (!buildGroupManagementPayload || !saveGroupManagementConfig) {
      throw createHttpError(500, '群管理健康修复模块未完成初始化', 'GROUP_HEALTH_FIX_NOT_READY');
    }
    const code = normalizeFixCode(body.code);
    if (!GROUP_MANAGEMENT_HEALTH_AUTO_FIX_CODES.has(code)) {
      throw createHttpError(400, '这个健康检查项不支持自动修复', 'GROUP_HEALTH_FIX_UNSUPPORTED');
    }
    const groupIds = normalizeFixGroupIds(body.groupIds, normalizeGroupId);
    if (groupIds.length === 0) {
      throw createHttpError(400, '请先选择要修复的群', 'GROUP_HEALTH_FIX_GROUP_EMPTY');
    }
    const selectedGroupId = normalizeGroupId(body.selectedGroupId || groupIds[0]);
    const beforeData = await buildGroupManagementPayload({ groupId: selectedGroupId });
    const currentHealthItem = findCurrentHealthItem(beforeData.health, code);
    if (!currentHealthItem) {
      throw createHttpError(409, '这个健康检查项当前已不存在，请刷新后再试', 'GROUP_HEALTH_FIX_STALE');
    }
    const currentAffectedGroupIds = getCurrentHealthGroupIds(currentHealthItem, normalizeGroupId);
    const allowedGroupIds = groupIds.filter(groupId => currentAffectedGroupIds.has(groupId));
    const skippedGroupIds = groupIds.filter(groupId => !currentAffectedGroupIds.has(groupId));
    if (allowedGroupIds.length === 0) {
      throw createHttpError(409, '请求的群当前不再命中这个健康检查项，请刷新后再试', 'GROUP_HEALTH_FIX_GROUP_STALE');
    }
    const results = [];
    for (const groupId of skippedGroupIds) {
      results.push({
        groupId,
        success: false,
        skipped: true,
        error: '该群当前不属于这个健康检查项，已跳过',
        code: 'GROUP_HEALTH_FIX_GROUP_SKIPPED',
      });
    }
    for (const groupId of allowedGroupIds) {
      try {
        const payload = buildFixPayloadForGroup(code, groupId);
        await saveGroupManagementConfig(payload, {
          ...auditContext,
          operator: auditContext.operator || 'webConsole:healthFix',
        });
        results.push({ groupId, success: true });
      } catch (error) {
        results.push({ groupId, success: false, error: error.message, code: error.code || '' });
      }
    }
    const skipped = results.filter(item => item.skipped === true);
    const failed = results.filter(item => item.success === false && item.skipped !== true);
    const data = await buildGroupManagementPayload({ groupId: selectedGroupId });
    const successCount = results.filter(item => item.success === true).length;
    return {
      ...data,
      fix: {
        code,
        requested: groupIds.length,
        success: successCount,
        failed: failed.length,
        skipped: skipped.length,
        results,
      },
      message: failed.length > 0 || skipped.length > 0
        ? `已修复 ${successCount} 个群，${failed.length} 个失败，${skipped.length} 个已跳过`
        : `已修复 ${successCount} 个群`,
    };
  }

  return {
    applyPayload,
    buildFixPayloadForGroup,
  };
}
