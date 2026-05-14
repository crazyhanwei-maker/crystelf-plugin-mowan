import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const MEMBER_MODERATION_STORE_FILE = path.join(process.cwd(), 'data', 'crystelf', 'group-management', 'member-moderation.json');

const LIST_LIMIT = 500;
const WARNING_USER_LIMIT = 2000;
const WARNING_ITEM_LIMIT = 100;
const CONTENT_KEYWORD_LIMIT = 100;
const DEFAULT_SAFETY_CONFIG = {
  enabled: true,
  allowAutoRecall: false,
  allowAutoMute: false,
  allowAutoKick: false,
  maxAutoMuteSeconds: 600,
  requireConsoleConfirm: true,
};
const DEFAULT_MODERATION_SETTINGS = {
  enabled: true,
  scoreEnabled: true,
  blockBlacklistAutoApprove: false,
  autoApproveWhitelisted: false,
  holdHighRisk: false,
  highRiskScore: 70,
  warningBlockThreshold: 3,
};
const DEFAULT_CONTENT_MODERATION_CONFIG = {
  enabled: false,
  exemptAdmins: true,
  detectLinks: true,
  urlSafety: {
    enabled: false,
    riskThreshold: 'high',
    maxUrlsPerMessage: 2,
    markdownMaxLength: 6000,
    timeoutMs: 20000,
    whitelist: [],
  },
  detectBlockedKeywords: true,
  blockedKeywords: [],
  repeatLimit: 4,
  repeatWindowSeconds: 45,
  detectSpamMessages: false,
  burstLimit: 8,
  burstWindowSeconds: 60,
  observeNewMembers: false,
  observeMinutes: 60,
  observeBlockLinks: true,
  action: 'log',
  muteSeconds: 600,
  addWarning: false,
};

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureDir(filePath = '') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeReadStore() {
  try {
    if (!fs.existsSync(MEMBER_MODERATION_STORE_FILE)) return { groups: {} };
    const parsed = JSON.parse(fs.readFileSync(MEMBER_MODERATION_STORE_FILE, 'utf8'));
    return isPlainObject(parsed) ? parsed : { groups: {} };
  } catch (error) {
    logger.warn(`[group-management] 读取群管黑白名单失败: ${error.message}`);
    return { groups: {} };
  }
}

function safeWriteStore(store = {}) {
  ensureDir(MEMBER_MODERATION_STORE_FILE);
  fs.writeFileSync(
    MEMBER_MODERATION_STORE_FILE,
    JSON.stringify(isPlainObject(store) ? store : { groups: {} }, null, 2),
    'utf8',
  );
}

function normalizeId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function truncateText(value = '', maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function normalizeInteger(value, fallback = 0, min = 0, max = 1000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeStringList(value = [], maxItems = 50) {
  if (Array.isArray(value)) {
    return value.map(item => truncateText(item, 80)).filter(Boolean).slice(0, maxItems);
  }
  if (typeof value === 'string') {
    return value.split(/\r?\n|[,，、;]/).map(item => truncateText(item, 80)).filter(Boolean).slice(0, maxItems);
  }
  return [];
}

function normalizeUrlSafetyRiskThreshold(value = '', fallback = 'high') {
  const normalized = String(value || fallback || 'high').trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : 'high';
}

function normalizeUrlSafetyConfig(value = {}, fallback = {}) {
  const source = isPlainObject(value) ? value : {};
  const base = isPlainObject(fallback) ? fallback : {};
  return {
    enabled: normalizeBoolean(source.enabled, base.enabled === true),
    riskThreshold: normalizeUrlSafetyRiskThreshold(source.riskThreshold, base.riskThreshold || 'high'),
    maxUrlsPerMessage: normalizeInteger(
      source.maxUrlsPerMessage,
      normalizeInteger(base.maxUrlsPerMessage, 2, 1, 5),
      1,
      5,
    ),
    markdownMaxLength: normalizeInteger(
      source.markdownMaxLength,
      normalizeInteger(base.markdownMaxLength, 6000, 1000, 20000),
      1000,
      20000,
    ),
    timeoutMs: normalizeInteger(
      source.timeoutMs,
      normalizeInteger(base.timeoutMs, 20000, 20000, 60000),
      20000,
      60000,
    ),
    whitelist: normalizeStringList(source.whitelist ?? base.whitelist, 100),
  };
}

export function normalizeGroupModerationSettings(value = {}, fallback = {}) {
  const source = isPlainObject(value) ? value : {};
  const base = isPlainObject(fallback) ? fallback : {};
  return {
    enabled: normalizeBoolean(source.enabled, base.enabled === true),
    scoreEnabled: normalizeBoolean(source.scoreEnabled, base.scoreEnabled === true),
    blockBlacklistAutoApprove: normalizeBoolean(
      source.blockBlacklistAutoApprove,
      base.blockBlacklistAutoApprove === true,
    ),
    autoApproveWhitelisted: normalizeBoolean(
      source.autoApproveWhitelisted,
      base.autoApproveWhitelisted === true,
    ),
    holdHighRisk: normalizeBoolean(source.holdHighRisk, base.holdHighRisk === true),
    highRiskScore: normalizeInteger(source.highRiskScore, normalizeInteger(base.highRiskScore, 70, 1, 100), 1, 100),
    warningBlockThreshold: normalizeInteger(
      source.warningBlockThreshold,
      normalizeInteger(base.warningBlockThreshold, 3, 0, 100),
      0,
      100,
    ),
  };
}

export function normalizeGroupContentModerationConfig(value = {}, fallback = {}) {
  const source = isPlainObject(value) ? value : {};
  const base = isPlainObject(fallback) ? fallback : {};
  const action = String(source.action || base.action || 'log').trim();
  const normalizedAction = ['log', 'warn', 'recall', 'mute', 'kick'].includes(action) ? action : 'log';
  return {
    enabled: normalizeBoolean(source.enabled, base.enabled === true),
    exemptAdmins: normalizeBoolean(source.exemptAdmins, base.exemptAdmins === true),
    detectLinks: normalizeBoolean(source.detectLinks, base.detectLinks === true),
    urlSafety: normalizeUrlSafetyConfig(source.urlSafety, base.urlSafety),
    detectBlockedKeywords: normalizeBoolean(source.detectBlockedKeywords, base.detectBlockedKeywords === true),
    blockedKeywords: normalizeStringList(source.blockedKeywords ?? base.blockedKeywords, CONTENT_KEYWORD_LIMIT),
    repeatLimit: normalizeInteger(source.repeatLimit, normalizeInteger(base.repeatLimit, 4, 2, 20), 2, 20),
    repeatWindowSeconds: normalizeInteger(
      source.repeatWindowSeconds,
      normalizeInteger(base.repeatWindowSeconds, 45, 5, 600),
      5,
      600,
    ),
    detectSpamMessages: normalizeBoolean(source.detectSpamMessages, base.detectSpamMessages === true),
    burstLimit: normalizeInteger(source.burstLimit, normalizeInteger(base.burstLimit, 8, 2, 60), 2, 60),
    burstWindowSeconds: normalizeInteger(
      source.burstWindowSeconds,
      normalizeInteger(base.burstWindowSeconds, 60, 5, 600),
      5,
      600,
    ),
    observeNewMembers: normalizeBoolean(source.observeNewMembers, base.observeNewMembers === true),
    observeMinutes: normalizeInteger(source.observeMinutes, normalizeInteger(base.observeMinutes, 60, 1, 10080), 1, 10080),
    observeBlockLinks: normalizeBoolean(source.observeBlockLinks, base.observeBlockLinks === true),
    action: normalizedAction,
    muteSeconds: normalizeInteger(source.muteSeconds, normalizeInteger(base.muteSeconds, 600, 60, 2592000), 60, 2592000),
    addWarning: normalizeBoolean(source.addWarning, base.addWarning === true),
  };
}

export function normalizeGroupManagementSafetyConfig(value = {}, fallback = {}) {
  const source = isPlainObject(value) ? value : {};
  const base = isPlainObject(fallback) ? fallback : {};
  return {
    enabled: normalizeBoolean(source.enabled, normalizeBoolean(base.enabled, DEFAULT_SAFETY_CONFIG.enabled)),
    allowAutoRecall: normalizeBoolean(
      source.allowAutoRecall,
      normalizeBoolean(base.allowAutoRecall, DEFAULT_SAFETY_CONFIG.allowAutoRecall),
    ),
    allowAutoMute: normalizeBoolean(
      source.allowAutoMute,
      normalizeBoolean(base.allowAutoMute, DEFAULT_SAFETY_CONFIG.allowAutoMute),
    ),
    allowAutoKick: normalizeBoolean(
      source.allowAutoKick,
      normalizeBoolean(base.allowAutoKick, DEFAULT_SAFETY_CONFIG.allowAutoKick),
    ),
    maxAutoMuteSeconds: normalizeInteger(
      source.maxAutoMuteSeconds,
      normalizeInteger(base.maxAutoMuteSeconds, DEFAULT_SAFETY_CONFIG.maxAutoMuteSeconds, 60, 2592000),
      60,
      2592000,
    ),
    requireConsoleConfirm: normalizeBoolean(
      source.requireConsoleConfirm,
      normalizeBoolean(base.requireConsoleConfirm, DEFAULT_SAFETY_CONFIG.requireConsoleConfirm),
    ),
    updatedAt: String(source.updatedAt || base.updatedAt || ''),
    operator: truncateText(source.operator || base.operator || '', 80),
  };
}

function parseUserListLine(line = '') {
  const text = String(line || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{5,20})(?:[\s,，:：|-]+([\s\S]+))?$/);
  if (!match) return null;
  return {
    userId: match[1],
    note: truncateText(match[2] || ''),
  };
}

function normalizeUserList(value = [], existing = [], auditContext = {}) {
  const now = new Date().toISOString();
  const existingMap = new Map(
    (Array.isArray(existing) ? existing : [])
      .map(item => [normalizeId(item.userId || item.user_id), item])
      .filter(([userId]) => userId),
  );
  const sourceItems = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isPlainObject(item)) {
        sourceItems.push({
          userId: normalizeId(item.userId || item.user_id || item.qq),
          note: truncateText(item.note || item.reason || item.remark || ''),
        });
      } else {
        sourceItems.push(parseUserListLine(item));
      }
    }
  } else if (typeof value === 'string') {
    for (const line of value.split(/\r?\n/)) {
      sourceItems.push(parseUserListLine(line));
    }
  }

  const result = [];
  const seen = new Set();
  for (const raw of sourceItems) {
    if (!raw?.userId || seen.has(raw.userId)) continue;
    seen.add(raw.userId);
    const current = existingMap.get(raw.userId) || {};
    result.push({
      userId: raw.userId,
      user_id: raw.userId,
      note: truncateText(raw.note || current.note || ''),
      createdAt: current.createdAt || now,
      updatedAt: now,
      operator: truncateText(current.operator || auditContext.operator || 'webConsole', 80),
    });
    if (result.length >= LIST_LIMIT) break;
  }
  return result;
}

function normalizeWarningItem(value = {}) {
  const raw = isPlainObject(value) ? value : {};
  return {
    id: String(raw.id || crypto.randomUUID?.() || crypto.randomBytes(8).toString('hex')).trim(),
    reason: truncateText(raw.reason || raw.note || '', 180),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    operator: truncateText(raw.operator || 'webConsole', 80),
  };
}

function normalizeWarningBucket(value = {}, fallbackUserId = '') {
  const raw = isPlainObject(value) ? value : {};
  const userId = normalizeId(raw.userId || raw.user_id || fallbackUserId);
  if (!userId) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeWarningItem).filter(Boolean).slice(0, WARNING_ITEM_LIMIT)
    : [];
  const count = normalizeInteger(raw.count, items.length, 0, 10000);
  return {
    userId,
    user_id: userId,
    count: Math.max(count, items.length),
    items,
    updatedAt: String(raw.updatedAt || items[0]?.createdAt || ''),
  };
}

function normalizeWarnings(value = {}) {
  const result = {};
  if (Array.isArray(value)) {
    for (const item of value) {
      const bucket = normalizeWarningBucket(item);
      if (bucket) result[bucket.userId] = bucket;
    }
  } else if (isPlainObject(value)) {
    for (const [userId, item] of Object.entries(value)) {
      const bucket = normalizeWarningBucket(item, userId);
      if (bucket) result[bucket.userId] = bucket;
    }
  }
  return Object.fromEntries(Object.entries(result).slice(0, WARNING_USER_LIMIT));
}

function normalizeGroupManagementDefaults(value = {}) {
  const raw = isPlainObject(value) ? value : {};
  return {
    settings: normalizeGroupModerationSettings(raw.settings || {}, DEFAULT_MODERATION_SETTINGS),
    content: normalizeGroupContentModerationConfig(raw.content || {}, DEFAULT_CONTENT_MODERATION_CONFIG),
    updatedAt: String(raw.updatedAt || ''),
    operator: truncateText(raw.operator || '', 80),
  };
}

function isSameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildStoredGroupState(groupId = '', effectiveState = {}, rawState = {}, defaults = {}, options = {}) {
  const normalizedGroupId = normalizeId(groupId);
  const raw = isPlainObject(rawState) ? rawState : {};
  const defaultConfig = normalizeGroupManagementDefaults(defaults);
  const normalized = normalizeGroupState(effectiveState, normalizedGroupId, defaultConfig);
  const settingsTouched = options.settingsTouched === true;
  const contentTouched = options.contentTouched === true;
  const keepSettings = isPlainObject(raw.settings)
    || (settingsTouched && !isSameJsonValue(normalized.settings, defaultConfig.settings));
  const keepContent = isPlainObject(raw.content)
    || (contentTouched && !isSameJsonValue(normalized.content, defaultConfig.content));
  const stored = {
    groupId: normalizedGroupId,
    updatedAt: normalized.updatedAt,
  };

  if (keepSettings) stored.settings = normalized.settings;
  if (keepContent) stored.content = normalized.content;
  if (normalized.blacklist.length > 0) stored.blacklist = normalized.blacklist;
  if (normalized.whitelist.length > 0) stored.whitelist = normalized.whitelist;
  if (Object.keys(normalized.warnings).length > 0) stored.warnings = normalized.warnings;

  if (
    !stored.settings
    && !stored.content
    && !stored.blacklist
    && !stored.whitelist
    && !stored.warnings
  ) {
    return null;
  }
  return stored;
}

function pruneDefaultMirrorOverrides(store = {}, previousDefaults = {}, nextDefaults = {}) {
  const groups = getGroupsStore(store);
  const previous = normalizeGroupManagementDefaults(previousDefaults);
  const next = normalizeGroupManagementDefaults(nextDefaults);
  for (const [groupId, value] of Object.entries(groups)) {
    const normalizedGroupId = normalizeId(groupId);
    if (!normalizedGroupId || !isPlainObject(value)) {
      delete groups[groupId];
      continue;
    }
    const raw = { ...value };
    if (
      isPlainObject(raw.settings)
      && isSameJsonValue(normalizeGroupModerationSettings(raw.settings, previous.settings), previous.settings)
    ) {
      delete raw.settings;
    }
    if (
      isPlainObject(raw.content)
      && isSameJsonValue(normalizeGroupContentModerationConfig(raw.content, previous.content), previous.content)
    ) {
      delete raw.content;
    }
    const normalized = normalizeGroupState(raw, normalizedGroupId, next);
    const stored = buildStoredGroupState(normalizedGroupId, normalized, raw, next);
    if (stored) {
      groups[normalizedGroupId] = stored;
      if (normalizedGroupId !== groupId) delete groups[groupId];
    } else {
      delete groups[groupId];
    }
  }
}

function normalizeGroupState(value = {}, groupId = '', defaults = {}) {
  const raw = isPlainObject(value) ? value : {};
  const defaultConfig = normalizeGroupManagementDefaults(defaults);
  return {
    groupId,
    settings: normalizeGroupModerationSettings(raw.settings || {}, defaultConfig.settings),
    content: normalizeGroupContentModerationConfig(raw.content || {}, defaultConfig.content),
    blacklist: normalizeUserList(raw.blacklist || [], raw.blacklist || []),
    whitelist: normalizeUserList(raw.whitelist || [], raw.whitelist || []),
    warnings: normalizeWarnings(raw.warnings || {}),
    updatedAt: String(raw.updatedAt || ''),
  };
}

function getGroupsStore(store = {}) {
  if (!isPlainObject(store.groups)) store.groups = {};
  return store.groups;
}

function getDefaultsStore(store = {}) {
  return normalizeGroupManagementDefaults(store.defaults || {});
}

function serializePublicState(groupId = '', state = {}, defaults = {}) {
  const normalizedGroupId = normalizeId(groupId);
  const raw = isPlainObject(state) ? state : {};
  const normalized = normalizeGroupState(raw, normalizedGroupId, defaults);
  return {
    groupId: normalizedGroupId,
    settings: normalized.settings,
    content: normalized.content,
    hasCustomSettings: isPlainObject(raw.settings),
    hasCustomContent: isPlainObject(raw.content),
    blacklist: normalized.blacklist,
    whitelist: normalized.whitelist,
    warnings: Object.values(normalized.warnings)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
    updatedAt: normalized.updatedAt,
  };
}

export function getGroupModerationState(groupId = '') {
  const normalizedGroupId = normalizeId(groupId);
  const store = safeReadStore();
  const defaults = getDefaultsStore(store);
  if (!normalizedGroupId) {
    return serializePublicState('', {}, defaults);
  }
  const groups = getGroupsStore(store);
  return serializePublicState(normalizedGroupId, groups[normalizedGroupId] || {}, defaults);
}

export function getGroupMemberModeration(groupId = '', userId = '') {
  const state = getGroupModerationState(groupId);
  const normalizedUserId = normalizeId(userId);
  const blacklistEntry = state.blacklist.find(item => item.userId === normalizedUserId) || null;
  const whitelistEntry = state.whitelist.find(item => item.userId === normalizedUserId) || null;
  const warning = state.warnings.find(item => item.userId === normalizedUserId) || {
    userId: normalizedUserId,
    user_id: normalizedUserId,
    count: 0,
    items: [],
  };
  return {
    groupId: state.groupId,
    userId: normalizedUserId,
    settings: state.settings,
    blacklisted: Boolean(blacklistEntry),
    blacklistEntry,
    whitelisted: Boolean(whitelistEntry),
    whitelistEntry,
    warningCount: Number(warning.count || 0),
    warning,
  };
}

export function getGroupModerationOverview() {
  const store = safeReadStore();
  const groups = getGroupsStore(store);
  const defaults = getDefaultsStore(store);
  const states = Object.entries(groups)
    .map(([groupId, value]) => serializePublicState(groupId, value, defaults))
    .filter(item => item.groupId);
  return {
    groups: states.length,
    blacklistUsers: states.reduce((sum, item) => sum + item.blacklist.length, 0),
    whitelistUsers: states.reduce((sum, item) => sum + item.whitelist.length, 0),
    warningUsers: states.reduce((sum, item) => sum + item.warnings.length, 0),
    warningPoints: states.reduce((sum, item) => sum + item.warnings.reduce((inner, warning) => inner + Number(warning.count || 0), 0), 0),
    contentEnabledGroups: states.filter(item => item.content?.enabled === true).length,
  };
}

export function listGroupModerationGroupIds() {
  const store = safeReadStore();
  return Object.keys(getGroupsStore(store)).map(normalizeId).filter(Boolean);
}

export function getGroupManagementSafetyConfig() {
  const store = safeReadStore();
  return normalizeGroupManagementSafetyConfig(store.safety || {});
}

export function getGroupManagementDefaults() {
  const store = safeReadStore();
  return getDefaultsStore(store);
}

export function saveGroupManagementDefaults(payload = {}, auditContext = {}) {
  const store = safeReadStore();
  const current = getDefaultsStore(store);
  const source = isPlainObject(payload) ? payload : {};
  const next = {
    settings: isPlainObject(source.settings)
      ? normalizeGroupModerationSettings(source.settings, current.settings)
      : current.settings,
    content: isPlainObject(source.content)
      ? normalizeGroupContentModerationConfig(source.content, current.content)
      : current.content,
    updatedAt: new Date().toISOString(),
    operator: truncateText(auditContext.operator || current.operator || 'webConsole', 80),
  };
  pruneDefaultMirrorOverrides(store, current, next);
  store.defaults = next;
  safeWriteStore(store);
  return {
    defaults: next,
    changes: [
      next.settings.enabled ? '默认入群风险评分已开启' : '默认入群风险评分已关闭',
      next.content.enabled ? '默认群消息风控已开启' : '默认群消息风控已关闭',
    ],
  };
}

export function saveGroupManagementSafetyConfig(payload = {}, auditContext = {}) {
  const store = safeReadStore();
  const current = normalizeGroupManagementSafetyConfig(store.safety || {});
  const next = normalizeGroupManagementSafetyConfig(payload, current);
  next.updatedAt = new Date().toISOString();
  next.operator = truncateText(auditContext.operator || current.operator || 'webConsole', 80);
  store.safety = next;
  safeWriteStore(store);
  return {
    safety: next,
    changes: [
      next.enabled ? '已开启群管危险动作保护' : '已关闭群管危险动作保护',
      next.allowAutoRecall ? '允许自动撤回' : '禁止自动撤回',
      next.allowAutoMute ? `允许自动禁言，最长 ${next.maxAutoMuteSeconds} 秒` : '禁止自动禁言',
      next.allowAutoKick ? '允许自动踢人' : '禁止自动踢人',
      next.requireConsoleConfirm ? '控制台保存危险动作需要二次确认' : '控制台保存危险动作不再二次确认',
    ],
  };
}

export function saveGroupModerationState(groupId = '', payload = {}, auditContext = {}) {
  const normalizedGroupId = normalizeId(groupId);
  if (!normalizedGroupId) {
    throw new Error('群号必须是 5-20 位数字');
  }
  const source = isPlainObject(payload) ? payload : {};
  const store = safeReadStore();
  const groups = getGroupsStore(store);
  const defaults = getDefaultsStore(store);
  const rawCurrent = isPlainObject(groups[normalizedGroupId]) ? groups[normalizedGroupId] : {};
  const current = normalizeGroupState(rawCurrent, normalizedGroupId, defaults);
  const next = {
    ...current,
    settings: current.settings,
    content: current.content,
    blacklist: current.blacklist,
    whitelist: current.whitelist,
    warnings: current.warnings,
    updatedAt: new Date().toISOString(),
  };
  const changes = [];

  if (isPlainObject(source.settings)) {
    next.settings = normalizeGroupModerationSettings(source.settings, current.settings);
    changes.push('已保存群管风险设置');
  }
  if (isPlainObject(source.content)) {
    next.content = normalizeGroupContentModerationConfig(source.content, current.content);
    changes.push(next.content.enabled ? '已开启群消息风控配置' : '已关闭群消息风控配置');
  }
  if (Object.prototype.hasOwnProperty.call(source, 'blacklist')) {
    next.blacklist = normalizeUserList(source.blacklist, current.blacklist, auditContext);
    changes.push(`已保存黑名单 ${next.blacklist.length} 人`);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'whitelist')) {
    next.whitelist = normalizeUserList(source.whitelist, current.whitelist, auditContext);
    changes.push(`已保存白名单 ${next.whitelist.length} 人`);
  }

  const blacklistSet = new Set(next.blacklist.map(item => item.userId));
  const conflict = next.whitelist.find(item => blacklistSet.has(item.userId));
  if (conflict) {
    throw new Error(`用户 ${conflict.userId} 不能同时在黑名单和白名单`);
  }

  const stored = buildStoredGroupState(normalizedGroupId, next, rawCurrent, defaults, {
    settingsTouched: isPlainObject(source.settings),
    contentTouched: isPlainObject(source.content),
  });
  if (stored) {
    groups[normalizedGroupId] = stored;
  } else {
    delete groups[normalizedGroupId];
  }
  safeWriteStore(store);
  return {
    state: serializePublicState(normalizedGroupId, groups[normalizedGroupId] || {}, getDefaultsStore(store)),
    changes,
  };
}

export function addGroupListEntry(groupId = '', listType = 'blacklist', userId = '', note = '', auditContext = {}) {
  const normalizedGroupId = normalizeId(groupId);
  const normalizedUserId = normalizeId(userId);
  const targetList = String(listType || '').trim() === 'whitelist' ? 'whitelist' : 'blacklist';
  const oppositeList = targetList === 'blacklist' ? 'whitelist' : 'blacklist';
  if (!normalizedGroupId) throw new Error('群号必须是 5-20 位数字');
  if (!normalizedUserId) throw new Error('QQ 号必须是 5-20 位数字');

  const store = safeReadStore();
  const groups = getGroupsStore(store);
  const defaults = getDefaultsStore(store);
  const rawCurrent = isPlainObject(groups[normalizedGroupId]) ? groups[normalizedGroupId] : {};
  const current = normalizeGroupState(rawCurrent, normalizedGroupId, defaults);
  const now = new Date().toISOString();
  current[oppositeList] = current[oppositeList].filter(item => item.userId !== normalizedUserId);
  const existing = current[targetList].find(item => item.userId === normalizedUserId);
  if (existing) {
    existing.note = truncateText(note || existing.note || '');
    existing.updatedAt = now;
    existing.operator = truncateText(auditContext.operator || existing.operator || 'webConsole', 80);
  } else {
    current[targetList].unshift({
      userId: normalizedUserId,
      user_id: normalizedUserId,
      note: truncateText(note || ''),
      createdAt: now,
      updatedAt: now,
      operator: truncateText(auditContext.operator || 'webConsole', 80),
    });
    current[targetList] = current[targetList].slice(0, LIST_LIMIT);
  }
  current.updatedAt = now;
  const stored = buildStoredGroupState(normalizedGroupId, current, rawCurrent, defaults);
  if (stored) {
    groups[normalizedGroupId] = stored;
  } else {
    delete groups[normalizedGroupId];
  }
  safeWriteStore(store);
  return serializePublicState(normalizedGroupId, groups[normalizedGroupId] || {}, getDefaultsStore(store));
}

export function restoreGroupModerationConfig(groupId = '', payload = {}, auditContext = {}) {
  const normalizedGroupId = normalizeId(groupId);
  if (!normalizedGroupId) {
    throw new Error('群号必须是 5-20 位数字');
  }
  const source = isPlainObject(payload) ? payload : {};
  const store = safeReadStore();
  const groups = getGroupsStore(store);
  const defaults = getDefaultsStore(store);
  const rawCurrent = isPlainObject(groups[normalizedGroupId]) ? groups[normalizedGroupId] : {};
  const current = normalizeGroupState(rawCurrent, normalizedGroupId, defaults);
  const next = {
    ...current,
    settings: normalizeGroupModerationSettings(source.settings || {}, current.settings),
    content: normalizeGroupContentModerationConfig(source.content || {}, current.content),
    blacklist: normalizeUserList(source.blacklist || [], current.blacklist, auditContext),
    whitelist: normalizeUserList(source.whitelist || [], current.whitelist, auditContext),
    warnings: current.warnings,
    updatedAt: new Date().toISOString(),
  };
  const blacklistSet = new Set(next.blacklist.map(item => item.userId));
  const conflict = next.whitelist.find(item => blacklistSet.has(item.userId));
  if (conflict) {
    throw new Error(`用户 ${conflict.userId} 不能同时在黑名单和白名单`);
  }
  const settingsTouched = Object.prototype.hasOwnProperty.call(source, 'hasCustomSettings')
    ? source.hasCustomSettings === true
    : isPlainObject(source.settings);
  const contentTouched = Object.prototype.hasOwnProperty.call(source, 'hasCustomContent')
    ? source.hasCustomContent === true
    : isPlainObject(source.content);
  const stored = buildStoredGroupState(normalizedGroupId, next, rawCurrent, defaults, {
    settingsTouched,
    contentTouched,
  });
  if (stored) {
    groups[normalizedGroupId] = stored;
  } else {
    delete groups[normalizedGroupId];
  }
  safeWriteStore(store);
  return serializePublicState(normalizedGroupId, groups[normalizedGroupId] || {}, getDefaultsStore(store));
}

export function addGroupMemberWarning(groupId = '', userId = '', reason = '', auditContext = {}) {
  const normalizedGroupId = normalizeId(groupId);
  const normalizedUserId = normalizeId(userId);
  if (!normalizedGroupId) throw new Error('群号必须是 5-20 位数字');
  if (!normalizedUserId) throw new Error('QQ 号必须是 5-20 位数字');

  const store = safeReadStore();
  const groups = getGroupsStore(store);
  const defaults = getDefaultsStore(store);
  const rawCurrent = isPlainObject(groups[normalizedGroupId]) ? groups[normalizedGroupId] : {};
  const current = normalizeGroupState(rawCurrent, normalizedGroupId, defaults);
  const now = new Date().toISOString();
  const bucket = current.warnings[normalizedUserId] || {
    userId: normalizedUserId,
    user_id: normalizedUserId,
    count: 0,
    items: [],
    updatedAt: '',
  };
  const item = normalizeWarningItem({
    reason: truncateText(reason || '管理员警告', 180),
    createdAt: now,
    operator: auditContext.operator || 'webConsole',
  });
  bucket.items = [item, ...(bucket.items || [])].slice(0, WARNING_ITEM_LIMIT);
  bucket.count = normalizeInteger(bucket.count, 0, 0, 10000) + 1;
  bucket.updatedAt = now;
  current.warnings[normalizedUserId] = bucket;
  current.updatedAt = now;
  const stored = buildStoredGroupState(normalizedGroupId, current, rawCurrent, defaults);
  if (stored) {
    groups[normalizedGroupId] = stored;
  } else {
    delete groups[normalizedGroupId];
  }
  safeWriteStore(store);
  return {
    state: serializePublicState(normalizedGroupId, groups[normalizedGroupId] || {}, getDefaultsStore(store)),
    warning: bucket,
    item,
  };
}

export function clearGroupMemberWarnings(groupId = '', userId = '') {
  const normalizedGroupId = normalizeId(groupId);
  const normalizedUserId = normalizeId(userId);
  if (!normalizedGroupId) throw new Error('群号必须是 5-20 位数字');
  if (!normalizedUserId) throw new Error('QQ 号必须是 5-20 位数字');

  const store = safeReadStore();
  const groups = getGroupsStore(store);
  const defaults = getDefaultsStore(store);
  const rawCurrent = isPlainObject(groups[normalizedGroupId]) ? groups[normalizedGroupId] : {};
  const current = normalizeGroupState(rawCurrent, normalizedGroupId, defaults);
  const removed = current.warnings[normalizedUserId] || null;
  delete current.warnings[normalizedUserId];
  current.updatedAt = new Date().toISOString();
  const stored = buildStoredGroupState(normalizedGroupId, current, rawCurrent, defaults);
  if (stored) {
    groups[normalizedGroupId] = stored;
  } else {
    delete groups[normalizedGroupId];
  }
  safeWriteStore(store);
  return {
    state: serializePublicState(normalizedGroupId, groups[normalizedGroupId] || {}, getDefaultsStore(store)),
    removed,
  };
}
