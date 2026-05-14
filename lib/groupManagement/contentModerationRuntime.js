import Group from '../yunzai/group.js';
import Message from '../yunzai/message.js';
import { appendGroupManagementLog } from './groupManagementLog.js';
import {
  addGroupMemberWarning,
  getGroupManagementSafetyConfig,
  getGroupModerationState,
  normalizeGroupContentModerationConfig,
} from './memberModerationStore.js';
import { checkMessageUrlsSafety } from './urlSafetyRuntime.js';

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
};

const joinTimeCache = new Map();
const messageState = new Map();
const URL_PATTERN = /(https?:\/\/|www\.|mqqapi:|qm\.qq\.com|jq\.qq\.com|t\.cn\/|b23\.tv\/|tb\.cn\/)/i;

function normalizeId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function nowMs() {
  return Date.now();
}

function getGroupUserKey(groupId = '', userId = '') {
  return `${groupId}:${userId}`;
}

function pruneRuntimeMaps(now = nowMs()) {
  for (const [key, value] of joinTimeCache.entries()) {
    if (now - Number(value || 0) > 10 * 24 * 60 * 60 * 1000) {
      joinTimeCache.delete(key);
    }
  }
  for (const [key, value] of messageState.entries()) {
    if (now - Number(value.lastSeenAt || 0) > 2 * 60 * 60 * 1000) {
      messageState.delete(key);
    }
  }
}

export function rememberGroupNewMember(e = {}) {
  const groupId = normalizeId(e.group_id ?? e.groupId ?? e.gid);
  const userId = normalizeId(e.user_id ?? e.userId ?? e.uid);
  if (!groupId || !userId) return false;
  joinTimeCache.set(getGroupUserKey(groupId, userId), nowMs());
  return true;
}

function extractMessageText(e = {}) {
  const parts = [];
  for (const field of [e.raw_message, e.msg, e.message_text]) {
    if (field) parts.push(String(field));
  }
  const messages = Array.isArray(e.message) ? e.message : [];
  for (const item of messages) {
    if (!item) continue;
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (item.type === 'text') parts.push(String(item.text ?? item.data?.text ?? ''));
    if (item.type === 'json' || item.type === 'xml') parts.push(String(item.data?.data ?? item.data ?? ''));
    if (item.type === 'url' || item.type === 'share') {
      parts.push(String(item.url ?? item.data?.url ?? item.data?.content ?? ''));
      parts.push(String(item.title ?? item.data?.title ?? ''));
    }
  }
  return parts.join('\n').replace(/\s+/g, ' ').trim();
}

function isPrivilegedSender(e = {}) {
  const role = String(e.sender?.role || e.member?.role || '').trim();
  return e.isMaster === true || role === 'owner' || role === 'admin';
}

function getSenderJoinTimeMs(e = {}) {
  const seconds = Number(e.sender?.join_time ?? e.sender?.joinTime ?? e.member?.join_time ?? e.member?.joinTime);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return 0;
}

function isObservedNewMember(e = {}, cfg = {}, now = nowMs()) {
  if (!cfg.observeNewMembers) return false;
  const groupId = normalizeId(e.group_id ?? e.groupId ?? e.gid);
  const userId = normalizeId(e.user_id ?? e.userId ?? e.uid);
  if (!groupId || !userId) return false;
  const windowMs = Number(cfg.observeMinutes || 60) * 60 * 1000;
  const cached = Number(joinTimeCache.get(getGroupUserKey(groupId, userId)) || 0);
  const joinedAt = cached || getSenderJoinTimeMs(e);
  return joinedAt > 0 && now - joinedAt >= 0 && now - joinedAt <= windowMs;
}

function updateMessageWindow(groupId = '', userId = '', text = '', cfg = {}, now = nowMs()) {
  const key = getGroupUserKey(groupId, userId);
  const state = messageState.get(key) || {
    lastText: '',
    lastAt: 0,
    repeatCount: 0,
    timestamps: [],
    lastSpamTriggeredAt: 0,
    lastSeenAt: now,
  };
  const repeatWindowMs = Number(cfg.repeatWindowSeconds || 45) * 1000;
  const burstWindowMs = Number(cfg.burstWindowSeconds || 60) * 1000;
  const normalizedText = String(text || '').trim();
  if (normalizedText && normalizedText === state.lastText && now - Number(state.lastAt || 0) <= repeatWindowMs) {
    state.repeatCount = Number(state.repeatCount || 1) + 1;
  } else {
    state.lastText = normalizedText;
    state.repeatCount = normalizedText ? 1 : 0;
  }
  state.lastAt = now;
  state.lastSeenAt = now;
  state.timestamps = [...(state.timestamps || []), now].filter(item => now - Number(item || 0) <= burstWindowMs);
  messageState.set(key, state);
  return state;
}

function buildSignals(e = {}, cfg = {}, now = nowMs()) {
  const text = extractMessageText(e);
  const hasLink = URL_PATTERN.test(text);
  const groupId = normalizeId(e.group_id ?? e.groupId ?? e.gid);
  const userId = normalizeId(e.user_id ?? e.userId ?? e.uid);
  const signals = [];
  const matchedKeyword = cfg.detectBlockedKeywords
    ? (cfg.blockedKeywords || []).find(keyword => keyword && text.includes(keyword))
    : '';
  if (matchedKeyword) {
    signals.push(`命中关键词: ${matchedKeyword}`);
  }
  if (cfg.detectLinks && hasLink) {
    signals.push('包含链接');
  }
  if (isObservedNewMember(e, cfg, now) && cfg.observeBlockLinks && hasLink) {
    signals.push(`新人观察期内发链接 (${cfg.observeMinutes} 分钟)`);
  }
  const window = updateMessageWindow(groupId, userId, text, cfg, now);
  if (text && window.repeatCount >= cfg.repeatLimit) {
    signals.push(`重复消息 ${window.repeatCount}/${cfg.repeatLimit}`);
  }
  const spamCount = (window.timestamps || []).length;
  const spamWindowMs = Number(cfg.burstWindowSeconds || 60) * 1000;
  if (
    cfg.detectSpamMessages
    && spamCount > cfg.burstLimit
    && now - Number(window.lastSpamTriggeredAt || 0) >= spamWindowMs
  ) {
    window.lastSpamTriggeredAt = now;
    signals.push(`刷屏检测 ${spamCount}/${cfg.burstLimit} 条/${cfg.burstWindowSeconds || 60} 秒`);
  }
  return {
    text,
    signals: Array.from(new Set(signals)),
  };
}

async function muteMember(e = {}, groupId = '', userId = '', duration = 600) {
  const bot = e.bot || globalThis.Bot;
  if (typeof bot?.sendApi === 'function') {
    return await bot.sendApi('set_group_ban', {
      group_id: Number(groupId),
      user_id: Number(userId),
      duration: Number(duration),
    });
  }
  const group = e.group || bot?.pickGroup?.(Number(groupId)) || bot?.pickGroup?.(String(groupId));
  if (typeof group?.muteMember === 'function') {
    return await group.muteMember(Number(userId), Number(duration));
  }
  throw new Error('当前适配器不支持禁言');
}

function getActionLabel(action = '') {
  const labels = {
    log: '只记录',
    warn: '提醒并警告',
    recall: '撤回并警告',
    mute: '禁言并警告',
    kick: '踢出并警告',
  };
  return labels[String(action || '').trim()] || String(action || '未知动作');
}

function resolveModerationSafetyPlan(cfg = {}) {
  const safety = getGroupManagementSafetyConfig();
  const requestedAction = ['log', 'warn', 'recall', 'mute', 'kick'].includes(String(cfg.action || '').trim())
    ? String(cfg.action || '').trim()
    : 'log';
  let action = requestedAction;
  let muteSeconds = Number(cfg.muteSeconds || 600);
  const safetyMessages = [];
  if (!Number.isFinite(muteSeconds)) {
    muteSeconds = 600;
  }
  muteSeconds = Math.min(2592000, Math.max(60, Math.round(muteSeconds)));

  if (safety.enabled !== false) {
    if (requestedAction === 'recall' && safety.allowAutoRecall !== true) {
      action = 'warn';
      safetyMessages.push('安全开关禁止自动撤回，已降级为提醒并警告');
    }
    if (requestedAction === 'mute' && safety.allowAutoMute !== true) {
      action = 'warn';
      safetyMessages.push('安全开关禁止自动禁言，已降级为提醒并警告');
    }
    if (requestedAction === 'kick' && safety.allowAutoKick !== true) {
      action = 'warn';
      safetyMessages.push('安全开关禁止自动踢人，已降级为提醒并警告');
    }
    if (action === 'mute' && muteSeconds > Number(safety.maxAutoMuteSeconds || 600)) {
      const cappedSeconds = Math.max(60, Number(safety.maxAutoMuteSeconds || 600));
      muteSeconds = cappedSeconds;
      safetyMessages.push(`自动禁言时长已按安全上限限制为 ${cappedSeconds} 秒`);
    }
  }

  return {
    safety,
    requestedAction,
    action,
    muteSeconds,
    safetyDowngraded: requestedAction !== action || safetyMessages.length > 0,
    safetyMessages,
    shouldReply: ['warn', 'recall', 'mute', 'kick'].includes(action),
    shouldRecall: ['recall', 'mute', 'kick'].includes(action)
      && (safety.enabled === false || safety.allowAutoRecall === true),
    shouldMute: action === 'mute' && (safety.enabled === false || safety.allowAutoMute === true),
    shouldKick: action === 'kick' && (safety.enabled === false || safety.allowAutoKick === true),
  };
}

async function applyModerationAction(e = {}, cfg = {}, context = {}) {
  const plan = resolveModerationSafetyPlan(cfg);
  const action = plan.action;
  const groupId = context.groupId;
  const userId = context.userId;
  const reason = context.reason;
  const result = {
    requestedAction: plan.requestedAction,
    action,
    muteSeconds: plan.muteSeconds,
    safetyDowngraded: plan.safetyDowngraded,
    safetyMessages: plan.safetyMessages,
    replied: false,
    recalled: false,
    muted: false,
    kicked: false,
    warningAdded: false,
    errors: [],
  };

  if (cfg.addWarning === true || ['warn', 'recall', 'mute', 'kick'].includes(action)) {
    try {
      addGroupMemberWarning(groupId, userId, reason, { operator: 'contentModeration' });
      result.warningAdded = true;
    } catch (error) {
      result.errors.push(`warning: ${error.message}`);
    }
  }

  if (plan.shouldReply) {
    try {
      const atMessage = globalThis.segment?.at ? globalThis.segment.at(Number(userId)) : `@${userId}`;
      await e.reply?.([atMessage, ` 群管理提醒：${reason}`], true, { recallMsg: 20 });
      result.replied = true;
    } catch (error) {
      result.errors.push(`reply: ${error.message}`);
    }
  }

  if (plan.shouldRecall && e.message_id) {
    try {
      await Message.deleteMsg(e, e.message_id);
      result.recalled = true;
    } catch (error) {
      result.errors.push(`recall: ${error.message}`);
    }
  }

  if (plan.shouldMute) {
    try {
      await muteMember(e, groupId, userId, plan.muteSeconds);
      result.muted = true;
    } catch (error) {
      result.errors.push(`mute: ${error.message}`);
    }
  }

  if (plan.shouldKick) {
    try {
      await Group.groupKick(e, Number(userId), Number(groupId), false);
      result.kicked = true;
    } catch (error) {
      result.errors.push(`kick: ${error.message}`);
    }
  }

  return result;
}

export async function handleGroupContentModeration(e = {}) {
  const groupId = normalizeId(e.group_id ?? e.groupId ?? e.gid);
  const userId = normalizeId(e.user_id ?? e.userId ?? e.uid);
  const selfId = normalizeId(e.self_id ?? e.bot?.uin ?? e.bot_id);
  if (!groupId || !userId || userId === selfId) return false;
  pruneRuntimeMaps();

  const state = getGroupModerationState(groupId);
  const cfg = normalizeGroupContentModerationConfig(state.content || {});
  if (!cfg.enabled) return false;
  if (cfg.exemptAdmins && isPrivilegedSender(e)) return false;

  const moderation = state.whitelist?.some(item => item.userId === userId);
  if (moderation) return false;

  const built = buildSignals(e, cfg);
  const urlSafetyResult = await checkMessageUrlsSafety(built.text, cfg, { groupId, userId });
  built.signals.push(...(urlSafetyResult.signals || []));
  built.signals = Array.from(new Set(built.signals));
  if (built.signals.length === 0) return false;

  const reason = built.signals.join('；');
  const actionResult = await applyModerationAction(e, cfg, { groupId, userId, reason });
  appendGroupManagementLog({
    action: 'content_moderation_triggered',
    source: 'contentModeration',
    success: actionResult.errors.length === 0,
    group_id: groupId,
    user_id: userId,
    nickname: e.sender?.nickname || e.nickname || '',
    reason,
    error: actionResult.errors.join('；'),
    comment_preview: built.text,
    sections: ['moderation'],
    summary: {
      requestedAction: actionResult.requestedAction,
      action: actionResult.action,
      actionLabel: getActionLabel(actionResult.action),
      safetyDowngraded: actionResult.safetyDowngraded,
      safetyMessages: actionResult.safetyMessages,
      muteSeconds: actionResult.muteSeconds,
      warningAdded: actionResult.warningAdded,
      recalled: actionResult.recalled,
      muted: actionResult.muted,
      kicked: actionResult.kicked,
      urlSafety: {
        enabled: cfg.urlSafety?.enabled === true,
        checked: urlSafetyResult.checked === true,
        urls: urlSafetyResult.urls || [],
        results: (urlSafetyResult.results || []).map(item => ({
          success: item.success !== false,
          url: item.url || '',
          safe: item.safe,
          skipped: item.skipped === true,
          skipReason: item.skipReason || '',
          whitelistRule: item.whitelistRule || '',
          riskLevel: item.riskLevel || '',
          categories: item.categories || [],
          reason: item.reason || '',
          summary: item.summary || '',
          error: item.error || '',
          fromCache: item.fromCache === true,
        })),
      },
    },
  });
  logger.info(`[group-management] 群[${groupId}]用户[${userId}]触发消息风控: ${reason}`);
  return true;
}
