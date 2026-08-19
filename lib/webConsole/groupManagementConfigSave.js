function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(String(message || 'Internal Server Error'));
  error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
  if (code) error.code = String(code);
  return error;
}

function cloneJsonValueFallback(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value == null ? fallback : value));
  } catch {
    return fallback;
  }
}

function isPlainObjectFallback(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function createGroupManagementConfigSave(options = {}) {
  const ConfigControl = options.ConfigControl || options.configControl || { get: () => ({}), setMultiple: async () => {} };
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const normalizeGroupManagementId = typeof options.normalizeGroupManagementId === 'function'
    ? options.normalizeGroupManagementId
    : (value => String(value || '').trim());
  const isPlainObject = typeof options.isPlainObject === 'function' ? options.isPlainObject : isPlainObjectFallback;
  const cloneJsonValue = typeof options.cloneJsonValue === 'function' ? options.cloneJsonValue : cloneJsonValueFallback;
  const updateGroupIdList = typeof options.updateGroupIdList === 'function'
    ? options.updateGroupIdList
    : ((value = [], groupId = '', enabled = false) => {
        const set = new Set(Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : []);
        if (enabled) set.add(String(groupId || '').trim());
        else set.delete(String(groupId || '').trim());
        return Array.from(set);
      });
  const normalizeDailyGroupSummaryConfig = typeof options.normalizeDailyGroupSummaryConfig === 'function'
    ? options.normalizeDailyGroupSummaryConfig
    : (value => ({ ...(isPlainObjectFallback(value) ? value : {}) }));
  const normalizeGroupIdList = typeof options.normalizeGroupIdList === 'function'
    ? options.normalizeGroupIdList
    : (value => (Array.isArray(value) ? Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean))) : []));
  const optionalBoolean = typeof options.optionalBoolean === 'function'
    ? options.optionalBoolean
    : ((value) => {
        if (value === undefined) return undefined;
        if (value === true || value === 'true' || value === 1 || value === '1') return true;
        if (value === false || value === 'false' || value === 0 || value === '0') return false;
        return undefined;
      });
  const normalizeIntegerInRange = typeof options.normalizeIntegerInRange === 'function'
    ? options.normalizeIntegerInRange
    : ((value, fallback, min, max) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.min(max, Math.max(min, Math.round(numeric)));
      });
  const readBoolean = typeof options.readBoolean === 'function'
    ? options.readBoolean
    : ((value, fallback = false) => {
        const normalized = optionalBoolean(value);
        return normalized === undefined ? fallback : normalized;
      });
  const findGroupConfigBackup = typeof options.findGroupConfigBackup === 'function' ? options.findGroupConfigBackup : (() => null);
  const createGroupConfigBackup = typeof options.createGroupConfigBackup === 'function' ? options.createGroupConfigBackup : (() => null);
  const buildGroupManagementConfigSnapshot = typeof options.buildGroupManagementConfigSnapshot === 'function'
    ? options.buildGroupManagementConfigSnapshot
    : (() => ({}));
  const restoreGroupModerationConfig = typeof options.restoreGroupModerationConfig === 'function'
    ? options.restoreGroupModerationConfig
    : (() => null);
  const appendGroupManagementLog = typeof options.appendGroupManagementLog === 'function'
    ? options.appendGroupManagementLog
    : (() => {});
  const buildGroupManagementPayload = typeof options.buildGroupManagementPayload === 'function'
    ? options.buildGroupManagementPayload
    : (async () => ({}));
  const getClientIp = typeof options.getClientIp === 'function' ? options.getClientIp : (() => '');
  const normalizeGroupWelcomeText = typeof options.normalizeGroupWelcomeText === 'function'
    ? options.normalizeGroupWelcomeText
    : (value => String(value || '').trim());
  const getGroupManagementSafetyConfig = typeof options.getGroupManagementSafetyConfig === 'function'
    ? options.getGroupManagementSafetyConfig
    : (() => ({}));
  const getGroupManagementDefaultAuthConfig = typeof options.getGroupManagementDefaultAuthConfig === 'function'
    ? options.getGroupManagementDefaultAuthConfig
    : (() => ({}));
  const normalizeAuthGroupConfig = typeof options.normalizeAuthGroupConfig === 'function'
    ? options.normalizeAuthGroupConfig
    : ((value, fallback = {}) => ({ ...(fallback || {}), ...(isPlainObjectFallback(value) ? value : {}) }));
  const getGroupManagementDefaultWelcomeConfig = typeof options.getGroupManagementDefaultWelcomeConfig === 'function'
    ? options.getGroupManagementDefaultWelcomeConfig
    : (() => ({}));
  const deleteGroupWelcomeImageFiles = typeof options.deleteGroupWelcomeImageFiles === 'function'
    ? options.deleteGroupWelcomeImageFiles
    : (() => {});
  const normalizeGroupWelcomeConfig = typeof options.normalizeGroupWelcomeConfig === 'function'
    ? options.normalizeGroupWelcomeConfig
    : ((value, fallback = {}) => ({ ...(fallback || {}), ...(isPlainObjectFallback(value) ? value : {}) }));
  const isAiGroupWelcomeEnabled = typeof options.isAiGroupWelcomeEnabled === 'function'
    ? options.isAiGroupWelcomeEnabled
    : (value => value?.aiEnabled === true);
  const isGroupWelcomeEnabled = typeof options.isGroupWelcomeEnabled === 'function'
    ? options.isGroupWelcomeEnabled
    : (value => value?.enabled === true);
  const saveGroupWelcomeImageDataUrl = typeof options.saveGroupWelcomeImageDataUrl === 'function'
    ? options.saveGroupWelcomeImageDataUrl
    : (() => '');
  const saveGroupModerationState = typeof options.saveGroupModerationState === 'function'
    ? options.saveGroupModerationState
    : (() => ({ changes: [] }));

  function buildGroupManagementRollbackWrites(groupId = '', snapshot = {}, allConfigs = {}) {
    const normalizedGroupId = normalizeGroupManagementId(groupId);
    const source = isPlainObject(snapshot) ? snapshot : {};
    const writes = {};
    const changes = [];
  
    if (isPlainObject(source.ai)) {
      const currentAi = cloneJsonValue(allConfigs.ai || {}, {});
      currentAi.blockGroup = updateGroupIdList(currentAi.blockGroup, normalizedGroupId, source.ai.blocked === true);
      currentAi.whiteGroup = updateGroupIdList(currentAi.whiteGroup, normalizedGroupId, source.ai.whitelisted === true);
      const currentPseudoHuman = isPlainObject(currentAi.pseudoHuman) ? currentAi.pseudoHuman : {};
      const pseudoGroups = isPlainObject(currentPseudoHuman.groups) ? { ...currentPseudoHuman.groups } : {};
      if (isPlainObject(source.ai.pseudoHuman)) {
        pseudoGroups[normalizedGroupId] = cloneJsonValue(source.ai.pseudoHuman, {});
      } else {
        delete pseudoGroups[normalizedGroupId];
      }
      currentAi.pseudoHuman = { ...currentPseudoHuman, groups: pseudoGroups };
      writes.ai = currentAi;
      changes.push('已回滚 AI 群策略和伪人模式');
    }
  
    if (isPlainObject(source.dailySummary)) {
      const currentAi = writes.ai || cloneJsonValue(allConfigs.ai || {}, {});
      const currentSummary = normalizeDailyGroupSummaryConfig(currentAi.dailyGroupSummary || {});
      const enabledSet = new Set(normalizeGroupIdList(currentSummary.enabledGroups));
      const blockedSet = new Set(normalizeGroupIdList(currentSummary.blockedGroups));
      if (source.dailySummary.allowed === true) {
        enabledSet.add(normalizedGroupId);
        blockedSet.delete(normalizedGroupId);
        currentSummary.enabled = true;
        currentSummary.targetMode = 'selected';
      } else {
        enabledSet.delete(normalizedGroupId);
      }
      if (source.dailySummary.blocked === true) {
        blockedSet.add(normalizedGroupId);
        enabledSet.delete(normalizedGroupId);
      } else {
        blockedSet.delete(normalizedGroupId);
      }
      currentAi.dailyGroupSummary = {
        ...(isPlainObject(currentAi.dailyGroupSummary) ? currentAi.dailyGroupSummary : {}),
        ...currentSummary,
        enabledGroups: Array.from(enabledSet),
        blockedGroups: Array.from(blockedSet),
      };
      writes.ai = currentAi;
      changes.push('已回滚每日群聊总结范围');
    }
  
    if (isPlainObject(source.imageMonitor)) {
      const currentImageMonitor = cloneJsonValue(allConfigs.imageMonitor || {}, {});
      currentImageMonitor.allowedGroups = updateGroupIdList(
        currentImageMonitor.allowedGroups,
        normalizedGroupId,
        source.imageMonitor.allowed === true,
      );
      currentImageMonitor.blockedGroups = updateGroupIdList(
        currentImageMonitor.blockedGroups,
        normalizedGroupId,
        source.imageMonitor.blocked === true,
      );
      writes.imageMonitor = currentImageMonitor;
      changes.push('已回滚图片监控群策略');
    }
  
    if (isPlainObject(source.auth)) {
      const currentAuth = cloneJsonValue(allConfigs.auth || {}, {});
      const currentGroups = isPlainObject(currentAuth.groups) ? { ...currentAuth.groups } : {};
      if (source.auth.hasCustom && isPlainObject(source.auth.value)) {
        currentGroups[normalizedGroupId] = cloneJsonValue(source.auth.value, {});
      } else {
        delete currentGroups[normalizedGroupId];
      }
      currentAuth.groups = currentGroups;
      writes.auth = currentAuth;
      changes.push('已回滚入群验证配置');
    }
  
    if (isPlainObject(source.welcome)) {
      const currentNewcomer = cloneJsonValue(allConfigs.newcomer || {}, {});
      if (source.welcome.hasCustom && isPlainObject(source.welcome.value)) {
        currentNewcomer[normalizedGroupId] = cloneJsonValue(source.welcome.value, {});
      } else {
        delete currentNewcomer[normalizedGroupId];
      }
      writes.newcomer = currentNewcomer;
      changes.push('已回滚入群欢迎配置');
    }
  
    return { writes, changes };
  }
  
  async function rollbackGroupManagementConfigPayload(payload = {}, auditContext = {}) {
    const snapshotId = String(payload.id || payload.snapshotId || '').trim();
    if (!snapshotId) {
      throw createHttpError(400, '缺少备份 ID', 'GROUP_BACKUP_ID_REQUIRED');
    }
    const backup = findGroupConfigBackup(snapshotId);
    if (!backup) {
      throw createHttpError(404, '群配置备份不存在', 'GROUP_BACKUP_NOT_FOUND');
    }
    const groupId = normalizeGroupManagementId(backup.groupId);
    const allConfigs = ConfigControl.get() || {};
    createGroupConfigBackup(groupId, buildGroupManagementConfigSnapshot(groupId, allConfigs), {
      operator: auditContext.operator || 'webConsole',
      action: 'rollback_before_restore',
      note: `回滚到 ${backup.createdAt} 前自动保存`,
    });
  
    const { writes, changes } = buildGroupManagementRollbackWrites(groupId, backup.snapshot || {}, allConfigs);
    if (Object.keys(writes).length > 0) {
      await ConfigControl.setMultiple(writes);
    }
    if (isPlainObject(backup.snapshot?.moderation)) {
      restoreGroupModerationConfig(groupId, backup.snapshot.moderation, auditContext);
      changes.push('已回滚群管风控配置');
    }
    appendGroupManagementLog({
      action: 'rollback_config',
      source: 'webConsole',
      success: true,
      group_id: groupId,
      operator: auditContext.operator || 'webConsole',
      client_ip: auditContext.client_ip || '',
      user_agent: auditContext.user_agent || '',
      sections: [...Object.keys(writes), 'moderation'],
      changes,
      summary: {
        backupId: backup.id,
        backupCreatedAt: backup.createdAt,
      },
    });
    const data = await buildGroupManagementPayload({ groupId });
    return {
      ...data,
      message: `已回滚到 ${backup.createdAt} 的群配置备份`,
    };
  }
  
  function countGroupManagementListItems(value = []) {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean).length;
    }
    if (typeof value === 'string') {
      return value.split(/\r?\n|[,，、;]/).map(item => item.trim()).filter(Boolean).length;
    }
    return 0;
  }
  
  function summarizeGroupManagementSavePayload(payload = {}) {
    const summary = {};
    if (isPlainObject(payload.ai)) {
      summary.ai = {
        blocked: optionalBoolean(payload.ai.blocked),
        whitelisted: optionalBoolean(payload.ai.whitelisted),
        pseudoHuman: isPlainObject(payload.ai.pseudoHuman)
          ? {
              enabled: optionalBoolean(payload.ai.pseudoHuman.enabled),
              probability: normalizeIntegerInRange(payload.ai.pseudoHuman.probability, 10, 0, 100),
            }
          : undefined,
      };
    }
    if (isPlainObject(payload.imageMonitor)) {
      summary.imageMonitor = {
        allowed: optionalBoolean(payload.imageMonitor.allowed),
        blocked: optionalBoolean(payload.imageMonitor.blocked),
      };
    }
    if (isPlainObject(payload.dailySummary)) {
      summary.dailySummary = {
        allowed: optionalBoolean(payload.dailySummary.allowed),
        blocked: optionalBoolean(payload.dailySummary.blocked),
      };
    }
    if (isPlainObject(payload.auth)) {
      summary.auth = payload.auth.clear === true
        ? { clear: true }
        : {
            enable: optionalBoolean(payload.auth.enable),
            carbonEnable: optionalBoolean(payload.auth.carbon?.enable),
            carbonHint: optionalBoolean(payload.auth.carbon?.hint),
            carbonHardMode: optionalBoolean(payload.auth.carbon?.['hard-mode']),
            timeout: normalizeIntegerInRange(payload.auth.timeout, 180, 30, 1800),
            recall: optionalBoolean(payload.auth.recall),
            frequency: normalizeIntegerInRange(payload.auth.frequency, 5, 1, 20),
            autoApproveEnable: optionalBoolean(payload.auth.autoApprove?.enable),
            autoApproveMinQqLevel: normalizeIntegerInRange(payload.auth.autoApprove?.minQqLevel, 0, 0, 255),
            autoApproveMinAge: normalizeIntegerInRange(payload.auth.autoApprove?.minAge, 0, 0, 150),
            commentKeywordCount: countGroupManagementListItems(payload.auth.autoApprove?.commentKeywords),
            blockedKeywordCount: countGroupManagementListItems(payload.auth.autoApprove?.blockedKeywords),
            customRuleCount: countGroupManagementListItems(payload.auth.autoApprove?.customRules),
            riskEnabled: optionalBoolean(payload.auth.autoApprove?.risk?.enabled),
            riskScoreEnabled: optionalBoolean(payload.auth.autoApprove?.risk?.scoreEnabled),
            riskHoldHigh: optionalBoolean(payload.auth.autoApprove?.risk?.holdHighRisk),
          };
    }
    if (isPlainObject(payload.moderation)) {
      summary.moderation = {
        blacklistCount: countGroupManagementListItems(payload.moderation.blacklist),
        whitelistCount: countGroupManagementListItems(payload.moderation.whitelist),
        enabled: optionalBoolean(payload.moderation.settings?.enabled),
        scoreEnabled: optionalBoolean(payload.moderation.settings?.scoreEnabled),
        highRiskScore: normalizeIntegerInRange(payload.moderation.settings?.highRiskScore, 70, 1, 100),
        warningBlockThreshold: normalizeIntegerInRange(payload.moderation.settings?.warningBlockThreshold, 3, 0, 100),
        contentEnabled: optionalBoolean(payload.moderation.content?.enabled),
        detectSpamMessages: optionalBoolean(payload.moderation.content?.detectSpamMessages),
        urlSafetyEnabled: optionalBoolean(payload.moderation.content?.urlSafety?.enabled),
        urlSafetyRiskThreshold: String(payload.moderation.content?.urlSafety?.riskThreshold || '').slice(0, 20),
        contentAction: String(payload.moderation.content?.action || '').slice(0, 20),
        contentKeywordCount: countGroupManagementListItems(payload.moderation.content?.blockedKeywords),
      };
    }
    if (isPlainObject(payload.welcome)) {
      summary.welcome = payload.welcome.clear === true
        ? { clear: true }
        : {
            enabled: Object.prototype.hasOwnProperty.call(payload.welcome, 'enabled')
              ? readBoolean(payload.welcome.enabled, false)
              : undefined,
            textLength: Object.prototype.hasOwnProperty.call(payload.welcome, 'text')
              ? normalizeGroupWelcomeText(payload.welcome.text).length
              : undefined,
            aiEnabled: Object.prototype.hasOwnProperty.call(payload.welcome, 'aiEnabled')
              ? readBoolean(payload.welcome.aiEnabled, false)
              : undefined,
            uploadImage: Boolean(payload.welcome.imageDataUrl),
            deleteImage: payload.welcome.deleteImage === true,
          };
    }
    return summary;
  }
  
  function resolveGroupManagementSaveAction(payload = {}) {
    if (payload?.welcome?.clear === true) return 'clear_welcome';
    if (payload?.auth?.clear === true) return 'clear_auth';
    return 'save_config';
  }
  
  function buildGroupManagementAuditContext(req) {
    return {
      operator: 'webConsole',
      client_ip: getClientIp(req),
      user_agent: String(req?.headers?.['user-agent'] || '').slice(0, 160),
    };
  }
  
  const GROUP_MANAGEMENT_DANGEROUS_ACTION_LABELS = {
    recall: '自动撤回',
    mute: '自动禁言',
    kick: '自动踢人',
  };
  
  function normalizeGroupContentActionValue(value = '') {
    const action = String(value || '').trim();
    return ['log', 'warn', 'recall', 'mute', 'kick'].includes(action) ? action : 'log';
  }
  
  function assertGroupManagementContentSafety(content = {}) {
    if (!isPlainObject(content)) return;
    const action = normalizeGroupContentActionValue(content.action);
    if (!Object.prototype.hasOwnProperty.call(GROUP_MANAGEMENT_DANGEROUS_ACTION_LABELS, action)) {
      return;
    }
    const safety = getGroupManagementSafetyConfig();
    if (safety.enabled === false) {
      return;
    }
    if (action === 'recall' && safety.allowAutoRecall !== true) {
      throw createHttpError(400, '群管安全开关未允许自动撤回，请先在安全开关中放行。', 'GROUP_SAFETY_RECALL_BLOCKED');
    }
    if (action === 'mute' && safety.allowAutoMute !== true) {
      throw createHttpError(400, '群管安全开关未允许自动禁言，请先在安全开关中放行。', 'GROUP_SAFETY_MUTE_BLOCKED');
    }
    if (action === 'kick' && safety.allowAutoKick !== true) {
      throw createHttpError(400, '群管安全开关未允许自动踢人，请先在安全开关中放行。', 'GROUP_SAFETY_KICK_BLOCKED');
    }
    if (
      action === 'mute'
      && normalizeIntegerInRange(content.muteSeconds, 600, 60, 2592000) > Number(safety.maxAutoMuteSeconds || 600)
    ) {
      throw createHttpError(
        400,
        `自动禁言秒数超过群管安全上限 ${safety.maxAutoMuteSeconds} 秒，请降低禁言秒数或调整安全上限。`,
        'GROUP_SAFETY_MUTE_SECONDS_BLOCKED',
      );
    }
    if (safety.requireConsoleConfirm !== false && content.dangerConfirmed !== true) {
      throw createHttpError(
        400,
        `保存“${GROUP_MANAGEMENT_DANGEROUS_ACTION_LABELS[action]}”前需要控制台二次确认，请刷新页面后重试。`,
        'GROUP_SAFETY_CONFIRM_REQUIRED',
      );
    }
  }
  
  function ensureMainConfigFeatureEnabled(writes = {}, allConfigs = {}, featureKey = '', label = '', changes = null) {
    if (!featureKey) return false;
    const currentConfig = writes.config || cloneJsonValue(allConfigs.config || {}, {});
    if (currentConfig[featureKey] === true) {
      if (writes.config) writes.config = currentConfig;
      return false;
    }
    currentConfig[featureKey] = true;
    writes.config = currentConfig;
    if (Array.isArray(changes) && label) {
      changes.push(`已开启全局${label}开关`);
    }
    return true;
  }

  async function saveGroupManagementConfig(payload = {}, auditContext = {}) {
    const groupId = normalizeGroupManagementId(payload?.groupId);
    const allConfigs = ConfigControl.get() || {};
    const writes = {};
    const changes = [];
    let moderationSaved = false;
    let backupCreated = false;
    const ensureConfigBackup = () => {
      if (backupCreated) return;
      createGroupConfigBackup(groupId, buildGroupManagementConfigSnapshot(groupId, allConfigs), {
        operator: auditContext.operator || 'webConsole',
        action: resolveGroupManagementSaveAction(payload),
        note: '保存前自动备份',
      });
      backupCreated = true;
    };
  
    if (isPlainObject(payload.ai)) {
      const aiBlocked = optionalBoolean(payload.ai.blocked);
      const aiWhitelisted = optionalBoolean(payload.ai.whitelisted);
      if (aiBlocked === true && aiWhitelisted === true) {
        throw createHttpError(400, 'AI 黑名单和白名单不能同时选中同一个群', 'GROUP_AI_LIST_CONFLICT');
      }
      const currentAi = cloneJsonValue(allConfigs.ai || {}, {});
      if (aiBlocked !== undefined) {
        currentAi.blockGroup = updateGroupIdList(currentAi.blockGroup, groupId, aiBlocked);
        changes.push(aiBlocked ? '已加入 AI 黑名单' : '已移出 AI 黑名单');
      }
      if (aiWhitelisted !== undefined) {
        currentAi.whiteGroup = updateGroupIdList(currentAi.whiteGroup, groupId, aiWhitelisted);
        changes.push(aiWhitelisted ? '已加入 AI 白名单' : '已移出 AI 白名单');
      }
      if (isPlainObject(payload.ai.pseudoHuman)) {
        const pseudoHuman = payload.ai.pseudoHuman;
        const currentPseudoHuman = isPlainObject(currentAi.pseudoHuman) ? currentAi.pseudoHuman : {};
        const currentGroups = isPlainObject(currentPseudoHuman.groups) ? { ...currentPseudoHuman.groups } : {};
        const enabled = readBoolean(pseudoHuman.enabled, false);
        const probability = normalizeIntegerInRange(pseudoHuman.probability, 10, 0, 100);
        currentGroups[groupId] = { enabled, probability };
        currentAi.pseudoHuman = { ...currentPseudoHuman, groups: currentGroups };
        changes.push(enabled ? `已开启本群伪人模式（${probability}%）` : '已关闭本群伪人模式');
      }
      writes.ai = currentAi;
      if (aiWhitelisted === true) {
        ensureMainConfigFeatureEnabled(writes, allConfigs, 'ai', 'AI', changes);
      }
    }
  
    if (isPlainObject(payload.dailySummary)) {
      const summaryAllowed = optionalBoolean(payload.dailySummary.allowed);
      const summaryBlocked = optionalBoolean(payload.dailySummary.blocked);
      if (summaryAllowed === true && summaryBlocked === true) {
        throw createHttpError(400, '每日群聊总结启用群和禁用群不能同时选中同一个群', 'GROUP_DAILY_SUMMARY_LIST_CONFLICT');
      }
      const currentAi = writes.ai || cloneJsonValue(allConfigs.ai || {}, {});
      const currentSummary = normalizeDailyGroupSummaryConfig(currentAi.dailyGroupSummary || {});
      const enabledSet = new Set(normalizeGroupIdList(currentSummary.enabledGroups));
      const blockedSet = new Set(normalizeGroupIdList(currentSummary.blockedGroups));
      const nextSummary = {
        ...(isPlainObject(currentAi.dailyGroupSummary) ? currentAi.dailyGroupSummary : {}),
        enabled: currentSummary.enabled,
        targetMode: currentSummary.targetMode,
        enabledGroups: Array.from(enabledSet),
        blockedGroups: Array.from(blockedSet),
      };
      if (summaryAllowed !== undefined) {
        if (summaryAllowed) {
          nextSummary.enabled = true;
          nextSummary.targetMode = 'selected';
          enabledSet.add(groupId);
          blockedSet.delete(groupId);
        } else {
          enabledSet.delete(groupId);
        }
        changes.push(summaryAllowed ? '已开启本群每日总结' : '已移出本群每日总结启用群');
      }
      if (summaryBlocked !== undefined) {
        if (summaryBlocked) {
          blockedSet.add(groupId);
          enabledSet.delete(groupId);
        } else {
          blockedSet.delete(groupId);
        }
        changes.push(summaryBlocked ? '已禁用本群每日总结' : '已移出本群每日总结禁用群');
      }
      nextSummary.enabledGroups = Array.from(enabledSet);
      nextSummary.blockedGroups = Array.from(blockedSet);
      currentAi.dailyGroupSummary = nextSummary;
      writes.ai = currentAi;
      if (summaryAllowed === true) {
        ensureMainConfigFeatureEnabled(writes, allConfigs, 'ai', 'AI', changes);
      }
    }
  
    if (isPlainObject(payload.imageMonitor)) {
      const imageAllowed = optionalBoolean(payload.imageMonitor.allowed);
      const imageBlocked = optionalBoolean(payload.imageMonitor.blocked);
      if (imageAllowed === true && imageBlocked === true) {
        throw createHttpError(400, '图片监控白名单和黑名单不能同时选中同一个群', 'GROUP_IMAGE_LIST_CONFLICT');
      }
      const currentImageMonitor = cloneJsonValue(allConfigs.imageMonitor || {}, {});
      if (imageAllowed !== undefined) {
        currentImageMonitor.allowedGroups = updateGroupIdList(currentImageMonitor.allowedGroups, groupId, imageAllowed);
        changes.push(imageAllowed ? '已加入图片监控白名单' : '已移出图片监控白名单');
      }
      if (imageBlocked !== undefined) {
        currentImageMonitor.blockedGroups = updateGroupIdList(currentImageMonitor.blockedGroups, groupId, imageBlocked);
        changes.push(imageBlocked ? '已加入图片监控黑名单' : '已移出图片监控黑名单');
      }
      writes.imageMonitor = currentImageMonitor;
      if (imageAllowed === true) {
        ensureMainConfigFeatureEnabled(writes, allConfigs, 'imageMonitor', '图片监控', changes);
      }
    }
  
    if (isPlainObject(payload.auth)) {
      const currentAuth = cloneJsonValue(allConfigs.auth || {}, {});
      const authDefault = getGroupManagementDefaultAuthConfig(currentAuth);
      const currentGroups = isPlainObject(currentAuth.groups) ? { ...currentAuth.groups } : {};
      if (payload.auth.clear === true) {
        delete currentGroups[groupId];
        changes.push('已恢复默认入群验证配置');
      } else {
        const normalizedAuth = normalizeAuthGroupConfig(payload.auth, authDefault);
        const hadAuthCustom = Object.prototype.hasOwnProperty.call(currentGroups, groupId);
        if (hadAuthCustom || JSON.stringify(normalizedAuth) !== JSON.stringify(authDefault)) {
          currentGroups[groupId] = normalizedAuth;
          changes.push('已保存入群验证配置');
          if (normalizedAuth.enable === true || normalizedAuth.autoApprove?.enable === true) {
            ensureMainConfigFeatureEnabled(writes, allConfigs, 'auth', '入群验证', changes);
          }
        }
      }
      currentAuth.groups = currentGroups;
      if (changes.includes('已恢复默认入群验证配置') || Object.prototype.hasOwnProperty.call(currentGroups, groupId)) {
        writes.auth = currentAuth;
      }
    }
  
    if (isPlainObject(payload.welcome)) {
      const currentNewcomer = cloneJsonValue(allConfigs.newcomer || {}, {});
      const welcomeDefault = getGroupManagementDefaultWelcomeConfig(currentNewcomer);
      const hadWelcomeCustom = isPlainObject(currentNewcomer[groupId]);
      if (payload.welcome.clear === true) {
        delete currentNewcomer[groupId];
        deleteGroupWelcomeImageFiles(groupId);
        changes.push('已恢复默认入群欢迎配置');
      } else if (
        Object.prototype.hasOwnProperty.call(payload.welcome, 'text')
        || Object.prototype.hasOwnProperty.call(payload.welcome, 'enabled')
        || Object.prototype.hasOwnProperty.call(payload.welcome, 'aiEnabled')
        || Object.prototype.hasOwnProperty.call(payload.welcome, 'imageDataUrl')
        || payload.welcome.deleteImage === true
      ) {
        const currentGroupWelcome = hadWelcomeCustom ? { ...currentNewcomer[groupId] } : {};
        const text = normalizeGroupWelcomeText(payload.welcome.text);
        if (Object.prototype.hasOwnProperty.call(payload.welcome, 'enabled')) {
          const enabled = readBoolean(payload.welcome.enabled, false);
          currentGroupWelcome.enabled = enabled;
          changes.push(enabled ? '已开启本群入群欢迎' : '已关闭本群入群欢迎');
        }
        if (Object.prototype.hasOwnProperty.call(payload.welcome, 'text')) {
          if (text) {
            currentGroupWelcome.text = text;
          } else {
            delete currentGroupWelcome.text;
          }
          changes.push('已保存欢迎文案');
        }
        if (Object.prototype.hasOwnProperty.call(payload.welcome, 'aiEnabled')) {
          const aiEnabled = readBoolean(payload.welcome.aiEnabled, false);
          if (aiEnabled) {
            currentGroupWelcome.aiEnabled = true;
          } else {
            delete currentGroupWelcome.aiEnabled;
            if (isPlainObject(currentGroupWelcome.ai)) {
              delete currentGroupWelcome.ai.enabled;
              if (Object.keys(currentGroupWelcome.ai).length === 0) {
                delete currentGroupWelcome.ai;
              }
            }
          }
          changes.push(aiEnabled ? '已开启 AI 入群欢迎' : '已关闭 AI 入群欢迎');
        }
        if (payload.welcome.deleteImage === true) {
          deleteGroupWelcomeImageFiles(groupId);
          delete currentGroupWelcome.image;
          changes.push('已删除欢迎图片');
        }
        if (payload.welcome.imageDataUrl) {
          currentGroupWelcome.image = saveGroupWelcomeImageDataUrl(groupId, payload.welcome.imageDataUrl);
          changes.push('已保存欢迎图片');
        }
        const normalizedGroupWelcome = normalizeGroupWelcomeConfig(currentGroupWelcome, welcomeDefault);
        const hasWelcomeOverride = Object.prototype.hasOwnProperty.call(currentGroupWelcome, 'enabled')
          || String(currentGroupWelcome.text || '').trim()
          || String(currentGroupWelcome.image || '').trim()
          || isAiGroupWelcomeEnabled(currentGroupWelcome);
        const differsFromDefault = JSON.stringify(normalizedGroupWelcome) !== JSON.stringify(welcomeDefault);
        if (hasWelcomeOverride && (hadWelcomeCustom || differsFromDefault)) {
          currentNewcomer[groupId] = currentGroupWelcome;
        } else {
          delete currentNewcomer[groupId];
        }
        if (isGroupWelcomeEnabled(currentGroupWelcome)) {
          ensureMainConfigFeatureEnabled(writes, allConfigs, 'welcome', '入群欢迎', changes);
        }
      }
      writes.newcomer = currentNewcomer;
    }
  
    if (isPlainObject(payload.moderation)) {
      try {
        assertGroupManagementContentSafety(payload.moderation.content);
        if (payload.moderation.content?.enabled === true) {
          ensureMainConfigFeatureEnabled(writes, allConfigs, 'groupManagement', '群管理', changes);
        }
        ensureConfigBackup();
        const moderationResult = saveGroupModerationState(groupId, payload.moderation, auditContext);
        moderationSaved = true;
        changes.push(...(moderationResult.changes || []));
      } catch (error) {
        throw createHttpError(400, error.message, 'GROUP_MODERATION_SAVE_FAILED');
      }
    }
  
    if (Object.keys(writes).length === 0 && !moderationSaved) {
      throw createHttpError(400, '没有可保存的群配置', 'GROUP_CONFIG_EMPTY');
    }
  
    if (Object.keys(writes).length > 0) {
      ensureConfigBackup();
      await ConfigControl.setMultiple(writes);
    }
    appendGroupManagementLog({
      action: resolveGroupManagementSaveAction(payload),
      source: 'webConsole',
      success: true,
      group_id: groupId,
      operator: auditContext.operator || 'webConsole',
      client_ip: auditContext.client_ip || '',
      user_agent: auditContext.user_agent || '',
      sections: [
        ...Object.keys(writes),
        ...(moderationSaved ? ['moderation'] : []),
      ],
      changes,
      summary: summarizeGroupManagementSavePayload(payload),
    });
    const data = await buildGroupManagementPayload({ groupId });
    return {
      ...data,
      message: changes.join('；') || '群配置已保存',
    };
  }

  return {
    buildGroupManagementRollbackWrites,
    rollbackGroupManagementConfigPayload,
    summarizeGroupManagementSavePayload,
    buildGroupManagementAuditContext,
    normalizeGroupContentActionValue,
    assertGroupManagementContentSafety,
    ensureMainConfigFeatureEnabled,
    saveGroupManagementConfig,
  };
}

