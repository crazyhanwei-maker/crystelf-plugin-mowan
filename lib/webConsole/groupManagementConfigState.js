function isPlainObjectFallback(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneJsonValueFallback(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value == null ? fallback : value));
  } catch {
    return fallback;
  }
}

export function createGroupManagementConfigState(options = {}) {
  const path = options.path || { basename: value => String(value || '') };
  const isPlainObject = typeof options.isPlainObject === 'function' ? options.isPlainObject : isPlainObjectFallback;
  const readBoolean = typeof options.readBoolean === 'function' ? options.readBoolean : ((value, fallback = false) => {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
  });
  const normalizeIntegerInRange = typeof options.normalizeIntegerInRange === 'function'
    ? options.normalizeIntegerInRange
    : ((value, fallback, min, max) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.min(max, Math.max(min, Math.round(numeric)));
      });
  const normalizeJoinRequestAutoApproveConfig = typeof options.normalizeJoinRequestAutoApproveConfig === 'function'
    ? options.normalizeJoinRequestAutoApproveConfig
    : ((value, fallback = {}) => ({ ...(fallback || {}), ...(isPlainObjectFallback(value) ? value : {}) }));
  const normalizeGroupManagementId = typeof options.normalizeGroupManagementId === 'function'
    ? options.normalizeGroupManagementId
    : (value => String(value || '').trim());
  const normalizeGroupIdList = typeof options.normalizeGroupIdList === 'function'
    ? options.normalizeGroupIdList
    : (value => (Array.isArray(value) ? Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean))) : []));
  const normalizeDailyGroupSummaryConfig = typeof options.normalizeDailyGroupSummaryConfig === 'function'
    ? options.normalizeDailyGroupSummaryConfig
    : (value => ({ ...(isPlainObjectFallback(value) ? value : {}) }));
  const cloneJsonValue = typeof options.cloneJsonValue === 'function' ? options.cloneJsonValue : cloneJsonValueFallback;
  const getGroupModerationState = typeof options.getGroupModerationState === 'function'
    ? options.getGroupModerationState
    : (() => ({}));
  const getGroupManagementDefaultWelcomeConfig = typeof options.getGroupManagementDefaultWelcomeConfig === 'function'
    ? options.getGroupManagementDefaultWelcomeConfig
    : (() => ({}));
  const normalizeGroupWelcomeConfig = typeof options.normalizeGroupWelcomeConfig === 'function'
    ? options.normalizeGroupWelcomeConfig
    : ((value, fallback = {}) => ({ ...(fallback || {}), ...(isPlainObjectFallback(value) ? value : {}) }));
  const getGroupWelcomeImagePreviewUrl = typeof options.getGroupWelcomeImagePreviewUrl === 'function'
    ? options.getGroupWelcomeImagePreviewUrl
    : (() => '');
  const isGroupWelcomeEnabled = typeof options.isGroupWelcomeEnabled === 'function'
    ? options.isGroupWelcomeEnabled
    : (value => value?.enabled === true);
  const isAiGroupWelcomeEnabled = typeof options.isAiGroupWelcomeEnabled === 'function'
    ? options.isAiGroupWelcomeEnabled
    : (value => value?.aiEnabled === true);
  const listGroupConfigBackups = typeof options.listGroupConfigBackups === 'function'
    ? options.listGroupConfigBackups
    : (() => []);

  function normalizeAuthGroupConfig(value = {}, fallback = {}) {
    const source = isPlainObject(value) ? value : {};
    const base = isPlainObject(fallback) ? fallback : {};
    const sourceCarbon = isPlainObject(source.carbon) ? source.carbon : {};
    const baseCarbon = isPlainObject(base.carbon) ? base.carbon : {};
  
    return {
      enable: readBoolean(source.enable, base.enable === true),
      carbon: {
        enable: readBoolean(sourceCarbon.enable, baseCarbon.enable === true),
        hint: readBoolean(sourceCarbon.hint, baseCarbon.hint !== false),
        'hard-mode': readBoolean(sourceCarbon['hard-mode'], baseCarbon['hard-mode'] === true),
      },
      timeout: normalizeIntegerInRange(source.timeout, normalizeIntegerInRange(base.timeout, 180, 30, 1800), 30, 1800),
      recall: readBoolean(source.recall, base.recall !== false),
      frequency: normalizeIntegerInRange(source.frequency, normalizeIntegerInRange(base.frequency, 5, 1, 20), 1, 20),
      autoApprove: normalizeJoinRequestAutoApproveConfig(source.autoApprove, base.autoApprove || {}),
    };
  }
  
  function getGroupManagementDefaultAuthConfig(authConfig = {}) {
    return normalizeAuthGroupConfig(authConfig?.default || {}, {
      enable: false,
      carbon: {
        enable: false,
        hint: true,
        'hard-mode': false,
      },
      timeout: 180,
      recall: true,
      frequency: 5,
      autoApprove: {
        enable: false,
        minQqLevel: 0,
        minAge: 0,
        commentKeywords: [],
        blockedKeywords: [],
        customRules: [],
        risk: {
          enabled: false,
          scoreEnabled: false,
          blockBlacklistAutoApprove: false,
          autoApproveWhitelisted: false,
          holdHighRisk: false,
          highRiskScore: 70,
          warningBlockThreshold: 3,
        },
      },
    });
  }
  
  function buildGroupManagementConfigSnapshot(groupId = '', allConfigs = {}) {
    const normalizedGroupId = normalizeGroupManagementId(groupId);
    const aiConfig = allConfigs.ai || {};
    const imageMonitorConfig = allConfigs.imageMonitor || {};
    const authConfig = allConfigs.auth || {};
    const newcomerConfig = allConfigs.newcomer || {};
    const dailySummaryConfig = normalizeDailyGroupSummaryConfig(aiConfig.dailyGroupSummary || {});
    const authGroups = isPlainObject(authConfig.groups) ? authConfig.groups : {};
    const newcomerGroups = isPlainObject(newcomerConfig) ? newcomerConfig : {};
    return {
      version: 1,
      groupId: normalizedGroupId,
      ai: {
        blocked: normalizeGroupIdList(aiConfig.blockGroup).includes(normalizedGroupId),
        whitelisted: normalizeGroupIdList(aiConfig.whiteGroup).includes(normalizedGroupId),
      },
      dailySummary: {
        allowed: normalizeGroupIdList(dailySummaryConfig.enabledGroups).includes(normalizedGroupId),
        blocked: normalizeGroupIdList(dailySummaryConfig.blockedGroups).includes(normalizedGroupId),
      },
      imageMonitor: {
        allowed: normalizeGroupIdList(imageMonitorConfig.allowedGroups).includes(normalizedGroupId),
        blocked: normalizeGroupIdList(imageMonitorConfig.blockedGroups).includes(normalizedGroupId),
      },
      auth: {
        hasCustom: isPlainObject(authGroups[normalizedGroupId]),
        value: isPlainObject(authGroups[normalizedGroupId]) ? cloneJsonValue(authGroups[normalizedGroupId], {}) : null,
      },
      welcome: {
        hasCustom: isPlainObject(newcomerGroups[normalizedGroupId]),
        value: isPlainObject(newcomerGroups[normalizedGroupId]) ? cloneJsonValue(newcomerGroups[normalizedGroupId], {}) : null,
      },
      moderation: getGroupModerationState(normalizedGroupId),
    };
  }
  
  function normalizeGroupManagementBotRole(value = '') {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    if (['owner', '群主', 'creator', 'master', 'host'].includes(text) || text.includes('owner') || text.includes('群主')) return 'owner';
    if (['admin', 'administrator', '管理员', 'manager'].includes(text) || text.includes('admin') || text.includes('管理员')) return 'admin';
    if (['member', '成员', 'normal', 'user'].includes(text) || text.includes('member') || text.includes('成员')) return 'member';
    return '';
  }
  
  function buildGroupManagementPermissionState(record = {}) {
    const role = normalizeGroupManagementBotRole(record.botRole);
    const canModerate = role === 'owner' || role === 'admin';
    const canSetTitle = role === 'owner';
    const warnings = [];
    if (!role) {
      warnings.push('当前控制台无法确认 Bot 在该群的权限，运行时操作可能失败。');
    } else if (!canModerate) {
      warnings.push('Bot 不是管理员或群主，撤回、禁言、踢出等群管动作可能失败。');
    } else if (!canSetTitle) {
      warnings.push('Bot 不是群主，群头衔发放不可用。');
    }
    return {
      role,
      roleLabel: role === 'owner' ? '群主' : role === 'admin' ? '管理员' : role === 'member' ? '成员' : '未知',
      canRecall: canModerate,
      canMute: canModerate,
      canKick: canModerate,
      canSetTitle,
      warnings,
    };
  }
  
  function getGroupManagementConfigState(groupId = '', allConfigs = {}) {
    const normalizedGroupId = normalizeGroupManagementId(groupId);
    const mainConfig = allConfigs.config || {};
    const aiConfig = allConfigs.ai || {};
    const imageMonitorConfig = allConfigs.imageMonitor || {};
    const authConfig = allConfigs.auth || {};
    const newcomerConfig = allConfigs.newcomer || {};
  
    const aiBlockGroup = normalizeGroupIdList(aiConfig.blockGroup);
    const aiWhiteGroup = normalizeGroupIdList(aiConfig.whiteGroup);
    const dailySummaryConfig = normalizeDailyGroupSummaryConfig(aiConfig.dailyGroupSummary || {});
    const dailySummaryEnabledGroups = normalizeGroupIdList(dailySummaryConfig.enabledGroups);
    const dailySummaryBlockedGroups = normalizeGroupIdList(dailySummaryConfig.blockedGroups);
    const imageAllowedGroups = normalizeGroupIdList(imageMonitorConfig.allowedGroups);
    const imageBlockedGroups = normalizeGroupIdList(imageMonitorConfig.blockedGroups);
    const authGroups = isPlainObject(authConfig.groups) ? authConfig.groups : {};
    const newcomerGroups = isPlainObject(newcomerConfig) ? newcomerConfig : {};
  
    const authDefault = getGroupManagementDefaultAuthConfig(authConfig);
    const hasAuthCustom = isPlainObject(authGroups[normalizedGroupId]);
    const authEffective = normalizeAuthGroupConfig(hasAuthCustom ? authGroups[normalizedGroupId] : authDefault, authDefault);
    const welcomeDefault = getGroupManagementDefaultWelcomeConfig(newcomerGroups);
    const hasWelcomeCustom = isPlainObject(newcomerGroups[normalizedGroupId]);
    const welcomeRaw = hasWelcomeCustom
      ? normalizeGroupWelcomeConfig(newcomerGroups[normalizedGroupId], welcomeDefault)
      : welcomeDefault;
    const welcomeImagePreviewUrl = getGroupWelcomeImagePreviewUrl(normalizedGroupId, welcomeRaw.image);
    const moderationState = getGroupModerationState(normalizedGroupId);
  
    return {
      features: {
        ai: mainConfig.ai !== false,
        dailySummary: mainConfig.ai !== false && dailySummaryConfig.enabled === true,
        imageMonitor: mainConfig.imageMonitor !== false && imageMonitorConfig.enabled === true,
        auth: mainConfig.auth !== false,
        welcome: mainConfig.welcome !== false,
      },
      ai: {
        blocked: aiBlockGroup.includes(normalizedGroupId),
        whitelisted: aiWhiteGroup.includes(normalizedGroupId),
        whitelistMode: aiWhiteGroup.length > 0,
        effectiveEnabled: mainConfig.ai !== false
          && !aiBlockGroup.includes(normalizedGroupId)
          && (aiWhiteGroup.length === 0 || aiWhiteGroup.includes(normalizedGroupId)),
      },
      dailySummary: {
        enabled: dailySummaryConfig.enabled === true,
        targetMode: dailySummaryConfig.targetMode,
        allowed: dailySummaryEnabledGroups.includes(normalizedGroupId),
        blocked: dailySummaryBlockedGroups.includes(normalizedGroupId),
        effectiveEnabled: mainConfig.ai !== false
          && dailySummaryConfig.enabled === true
          && !dailySummaryBlockedGroups.includes(normalizedGroupId)
          && (dailySummaryConfig.targetMode === 'all' || dailySummaryEnabledGroups.includes(normalizedGroupId)),
      },
      imageMonitor: {
        allowed: imageAllowedGroups.includes(normalizedGroupId),
        blocked: imageBlockedGroups.includes(normalizedGroupId),
        allowlistMode: imageAllowedGroups.length > 0,
        effectiveEnabled: mainConfig.imageMonitor !== false
          && imageMonitorConfig.enabled === true
          && !imageBlockedGroups.includes(normalizedGroupId)
          && (imageAllowedGroups.length === 0 || imageAllowedGroups.includes(normalizedGroupId)),
      },
      auth: {
        hasCustom: hasAuthCustom,
        config: authEffective,
      },
      welcome: {
        hasCustom: hasWelcomeCustom,
        inherited: !hasWelcomeCustom && isGroupWelcomeEnabled(welcomeDefault),
        enabled: isGroupWelcomeEnabled(welcomeRaw),
        text: typeof welcomeRaw.text === 'string' ? welcomeRaw.text : '',
        aiEnabled: isAiGroupWelcomeEnabled(welcomeRaw),
        hasImage: Boolean(welcomeImagePreviewUrl),
        imagePreviewUrl: welcomeImagePreviewUrl,
        imageName: typeof welcomeRaw.image === 'string' && welcomeRaw.image.trim()
          ? path.basename(welcomeRaw.image)
          : '',
      },
      moderation: moderationState,
      backups: listGroupConfigBackups(normalizedGroupId, 5).map(item => ({
        id: item.id,
        createdAt: item.createdAt,
        operator: item.operator,
        action: item.action,
        note: item.note,
      })),
    };
  }

  return {
    normalizeAuthGroupConfig,
    getGroupManagementDefaultAuthConfig,
    buildGroupManagementConfigSnapshot,
    normalizeGroupManagementBotRole,
    buildGroupManagementPermissionState,
    getGroupManagementConfigState,
  };
}
