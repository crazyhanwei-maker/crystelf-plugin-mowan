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

function ensureMainConfigFeatureEnabledFallback(writes = {}, allConfigs = {}, featureKey = '', label = '', changes = null) {
  if (!featureKey) return false;
  const currentConfig = writes.config || cloneJsonValueFallback(allConfigs.config || {}, {});
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

function summarizeSavePayloadFallback(payload = {}) {
  return {
    keys: Object.keys(isPlainObjectFallback(payload) ? payload : {}),
    contentSpamDetection: payload?.moderation?.content?.detectSpamMessages,
    urlSafetyEnabled: payload?.moderation?.content?.urlSafety?.enabled,
  };
}

export function createGroupManagementSettings(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const setMultipleConfigs = typeof options.setMultipleConfigs === 'function' ? options.setMultipleConfigs : async () => {};
  const appendLog = typeof options.appendLog === 'function' ? options.appendLog : () => {};
  const saveSafetyConfig = typeof options.saveSafetyConfig === 'function'
    ? options.saveSafetyConfig
    : (() => ({ safety: {}, changes: [] }));
  const getDefaultAuthConfig = typeof options.getDefaultAuthConfig === 'function' ? options.getDefaultAuthConfig : () => ({});
  const normalizeAuthConfig = typeof options.normalizeAuthConfig === 'function'
    ? options.normalizeAuthConfig
    : value => ({ ...(isPlainObjectFallback(value) ? value : {}) });
  const getDefaultWelcomeConfig = typeof options.getDefaultWelcomeConfig === 'function' ? options.getDefaultWelcomeConfig : () => ({});
  const normalizeWelcomeConfig = typeof options.normalizeWelcomeConfig === 'function'
    ? options.normalizeWelcomeConfig
    : value => ({ ...(isPlainObjectFallback(value) ? value : {}) });
  const getModerationDefaults = typeof options.getModerationDefaults === 'function' ? options.getModerationDefaults : () => ({});
  const saveModerationDefaults = typeof options.saveModerationDefaults === 'function'
    ? options.saveModerationDefaults
    : (() => ({ defaults: {}, changes: [] }));
  const isPlainObject = typeof options.isPlainObject === 'function' ? options.isPlainObject : isPlainObjectFallback;
  const isWelcomeEnabled = typeof options.isWelcomeEnabled === 'function' ? options.isWelcomeEnabled : value => value?.enabled === true;
  const isAiWelcomeEnabled = typeof options.isAiWelcomeEnabled === 'function' ? options.isAiWelcomeEnabled : value => value?.aiEnabled === true;
  const readBoolean = typeof options.readBoolean === 'function' ? options.readBoolean : ((value, fallback = false) => (
    typeof value === 'boolean' ? value : fallback
  ));
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : value => String(value || '').trim();
  const cloneJsonValue = typeof options.cloneJsonValue === 'function' ? options.cloneJsonValue : cloneJsonValueFallback;
  const assertContentSafety = typeof options.assertContentSafety === 'function' ? options.assertContentSafety : () => {};
  const ensureMainConfigFeatureEnabled = typeof options.ensureMainConfigFeatureEnabled === 'function'
    ? options.ensureMainConfigFeatureEnabled
    : ensureMainConfigFeatureEnabledFallback;
  const summarizeSavePayload = typeof options.summarizeSavePayload === 'function'
    ? options.summarizeSavePayload
    : summarizeSavePayloadFallback;
  const buildGroupManagementPayload = typeof options.buildGroupManagementPayload === 'function'
    ? options.buildGroupManagementPayload
    : null;

  function buildDefaultsPayload(allConfigs = {}) {
    const authConfig = allConfigs.auth || {};
    const newcomerConfig = allConfigs.newcomer || {};
    const welcomeDefault = getDefaultWelcomeConfig(newcomerConfig);
    const moderationDefaults = getModerationDefaults();
    return {
      auth: getDefaultAuthConfig(authConfig),
      welcome: {
        hasCustom: isPlainObject(newcomerConfig?.default),
        enabled: isWelcomeEnabled(welcomeDefault),
        text: typeof welcomeDefault.text === 'string' ? welcomeDefault.text : '',
        aiEnabled: isAiWelcomeEnabled(welcomeDefault),
      },
      moderation: moderationDefaults,
    };
  }

  async function saveSafetyPayload(payload = {}, auditContext = {}) {
    if (!buildGroupManagementPayload) {
      throw createHttpError(500, '群管理设置模块未完成初始化', 'GROUP_SETTINGS_NOT_READY');
    }
    const source = isPlainObject(payload?.safety) ? payload.safety : payload;
    const selectedGroupId = normalizeGroupId(payload?.selectedGroupId);
    const result = saveSafetyConfig(source, auditContext);
    appendLog({
      action: 'save_safety',
      source: 'webConsole',
      success: true,
      group_id: selectedGroupId,
      operator: auditContext.operator || 'webConsole',
      client_ip: auditContext.client_ip || '',
      user_agent: auditContext.user_agent || '',
      sections: ['safety'],
      changes: result.changes || [],
      summary: {
        enabled: result.safety?.enabled,
        allowAutoRecall: result.safety?.allowAutoRecall,
        allowAutoMute: result.safety?.allowAutoMute,
        allowAutoKick: result.safety?.allowAutoKick,
        maxAutoMuteSeconds: result.safety?.maxAutoMuteSeconds,
        requireConsoleConfirm: result.safety?.requireConsoleConfirm,
      },
    });
    const data = await buildGroupManagementPayload({ groupId: selectedGroupId });
    return {
      ...data,
      message: '群管安全开关已保存',
    };
  }

  async function saveDefaultsConfig(payload = {}, auditContext = {}) {
    if (!buildGroupManagementPayload) {
      throw createHttpError(500, '群管理设置模块未完成初始化', 'GROUP_SETTINGS_NOT_READY');
    }
    const allConfigs = getAllConfigs() || {};
    const writes = {};
    const changes = [];
    const sections = [];

    if (isPlainObject(payload.auth)) {
      const currentAuth = cloneJsonValue(allConfigs.auth || {}, {});
      const currentDefault = getDefaultAuthConfig(currentAuth);
      const nextDefault = normalizeAuthConfig(payload.auth, currentDefault);
      currentAuth.default = nextDefault;
      writes.auth = currentAuth;
      sections.push('auth');
      changes.push('已保存默认入群验证配置');
      if (nextDefault.enable === true || nextDefault.autoApprove?.enable === true) {
        ensureMainConfigFeatureEnabled(writes, allConfigs, 'auth', '入群验证', changes);
      }
    }

    if (isPlainObject(payload.welcome)) {
      const currentNewcomer = cloneJsonValue(allConfigs.newcomer || {}, {});
      const currentDefault = getDefaultWelcomeConfig(currentNewcomer);
      if (payload.welcome.clear === true) {
        delete currentNewcomer.default;
        changes.push('已清空默认入群欢迎');
      } else {
        const nextWelcome = normalizeWelcomeConfig(payload.welcome, currentDefault);
        if (Object.prototype.hasOwnProperty.call(payload.welcome, 'aiEnabled')) {
          if (readBoolean(payload.welcome.aiEnabled, false)) {
            nextWelcome.aiEnabled = true;
          } else {
            delete nextWelcome.aiEnabled;
          }
        }
        currentNewcomer.default = nextWelcome;
        changes.push(nextWelcome.enabled ? '已开启默认入群欢迎' : '已保存默认入群欢迎');
        if (isWelcomeEnabled(nextWelcome)) {
          ensureMainConfigFeatureEnabled(writes, allConfigs, 'welcome', '入群欢迎', changes);
        }
      }
      writes.newcomer = currentNewcomer;
      sections.push('welcome');
    }

    if (isPlainObject(payload.moderation)) {
      try {
        assertContentSafety(payload.moderation.content);
        const result = saveModerationDefaults(payload.moderation, auditContext);
        changes.push(...(result.changes || []));
        if (result.defaults?.content?.enabled === true) {
          ensureMainConfigFeatureEnabled(writes, allConfigs, 'groupManagement', '群管理', changes);
        }
        sections.push('moderation');
      } catch (error) {
        if (error?.statusCode) throw error;
        throw createHttpError(400, error.message, 'GROUP_DEFAULTS_SAVE_FAILED');
      }
    }

    if (Object.keys(writes).length > 0) {
      await setMultipleConfigs(writes);
    }

    appendLog({
      action: 'save_defaults',
      source: 'webConsole',
      success: true,
      operator: auditContext.operator || 'webConsole',
      client_ip: auditContext.client_ip || '',
      user_agent: auditContext.user_agent || '',
      sections,
      changes,
      summary: summarizeSavePayload(payload),
    });

    const data = await buildGroupManagementPayload({ groupId: normalizeGroupId(payload?.selectedGroupId || '') });
    return {
      ...data,
      message: '群管理默认设置已保存',
    };
  }

  return {
    buildDefaultsPayload,
    saveSafetyPayload,
    saveDefaultsConfig,
  };
}
