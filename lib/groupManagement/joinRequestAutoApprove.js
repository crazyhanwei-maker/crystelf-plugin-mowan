import { appendGroupManagementLog } from './groupManagementLog.js';
import { updateJoinRequestRecord, upsertJoinRequestRecord } from './joinRequestStore.js';
import { getGroupMemberModeration, normalizeGroupModerationSettings } from './memberModerationStore.js';

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const PROFILE_LOOKUP_TIMEOUT_MS = 3500;

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

function normalizeStringList(value = []) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean).slice(0, 50);
  }
  if (typeof value === 'string') {
    return value.split(/\r?\n|[,，、;]/).map(item => item.trim()).filter(Boolean).slice(0, 50);
  }
  return [];
}

function normalizeJoinRequestRiskConfig(value = {}, fallback = {}) {
  const source = isPlainObject(value) ? value : {};
  const base = isPlainObject(fallback) ? fallback : {};
  return normalizeGroupModerationSettings(source, base);
}

export function normalizeJoinRequestAutoApproveConfig(value = {}, fallback = {}) {
  const source = isPlainObject(value) ? value : {};
  const base = isPlainObject(fallback) ? fallback : {};
  return {
    enable: normalizeBoolean(source.enable, base.enable === true),
    minQqLevel: normalizeInteger(source.minQqLevel, normalizeInteger(base.minQqLevel, 0, 0, 255), 0, 255),
    minAge: normalizeInteger(source.minAge, normalizeInteger(base.minAge, 0, 0, 150), 0, 150),
    commentKeywords: normalizeStringList(source.commentKeywords ?? base.commentKeywords),
    blockedKeywords: normalizeStringList(source.blockedKeywords ?? base.blockedKeywords),
    customRules: normalizeStringList(source.customRules ?? base.customRules).slice(0, 20),
    risk: normalizeJoinRequestRiskConfig(source.risk, base.risk || {}),
  };
}

export function getJoinRequestAutoApproveConfig(authConfig = {}, groupId = '') {
  const defaultConfig = normalizeJoinRequestAutoApproveConfig(authConfig?.default?.autoApprove || {});
  const groups = isPlainObject(authConfig?.groups) ? authConfig.groups : {};
  const groupConfig = isPlainObject(groups[String(groupId)]?.autoApprove) ? groups[String(groupId)].autoApprove : {};
  return normalizeJoinRequestAutoApproveConfig(groupConfig, defaultConfig);
}

function unwrapApiData(value) {
  if (isPlainObject(value?.data?.data)) return value.data.data;
  if (isPlainObject(value?.data)) return value.data;
  return isPlainObject(value) ? value : {};
}

function parseNumberLike(value) {
  if (value === null || value === undefined || value === '') return null;
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function extractQqLevel(info = {}) {
  const keys = [
    'qqLevel',
    'qq_level',
    'qLevel',
    'level',
    'qq_level_name',
    'qqLevelName',
  ];
  for (const key of keys) {
    const value = parseNumberLike(info[key]);
    if (value !== null) return value;
  }
  return null;
}

function getEventBot(e = {}) {
  return e?.bot || (typeof globalThis !== 'undefined' ? globalThis.Bot : null);
}

async function withTimeout(promiseLike, timeoutMs = PROFILE_LOOKUP_TIMEOUT_MS) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(promiseLike),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('profile lookup timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchStrangerInfo(e = {}, userId = '') {
  const bot = getEventBot(e);
  if (!bot || !userId) return {};

  if (typeof bot.sendApi === 'function') {
    try {
      return unwrapApiData(await withTimeout(bot.sendApi('get_stranger_info', {
        user_id: Number(userId),
        no_cache: true,
      })));
    } catch (error) {
      logger.warn(`[crystelf-plugin] 获取加群申请用户资料失败: ${error.message}`);
    }
  }

  if (typeof bot.getStrangerInfo === 'function') {
    try {
      return unwrapApiData(await withTimeout(bot.getStrangerInfo(Number(userId))));
    } catch (error) {
      logger.warn(`[crystelf-plugin] getStrangerInfo 失败: ${error.message}`);
    }
  }

  if (typeof bot.pickUser === 'function') {
    try {
      const user = bot.pickUser(Number(userId)) || bot.pickUser(String(userId));
      if (typeof user?.getInfo === 'function') {
        return unwrapApiData(await withTimeout(user.getInfo()));
      }
    } catch (error) {
      logger.warn(`[crystelf-plugin] pickUser.getInfo 失败: ${error.message}`);
    }
  }

  return {};
}

export async function buildJoinRequestApplicantProfile(e = {}) {
  const userId = String(e.user_id ?? e.userId ?? e.uid ?? '').trim();
  const groupId = String(e.group_id ?? e.groupId ?? e.gid ?? '').trim();
  const comment = String(e.comment ?? e.reason ?? e.message ?? e.raw_message ?? '').trim();
  const eventInfo = {
    ...(isPlainObject(e.sender) ? e.sender : {}),
    ...(isPlainObject(e.user) ? e.user : {}),
    user_id: userId,
    group_id: groupId,
    nickname: e.nickname ?? e.name ?? e.sender?.nickname ?? e.user?.nickname ?? '',
    age: e.age ?? e.sender?.age ?? e.user?.age,
    level: e.level ?? e.sender?.level ?? e.user?.level,
  };
  const strangerInfo = await fetchStrangerInfo(e, userId);
  const merged = { ...eventInfo, ...strangerInfo };

  return {
    groupId,
    userId,
    comment,
    nickname: String(merged.nickname ?? merged.nickName ?? merged.name ?? '').trim(),
    age: parseNumberLike(merged.age),
    qqLevel: extractQqLevel(merged),
    sex: String(merged.sex ?? '').trim(),
    raw: merged,
  };
}

function normalizeFieldName(field = '') {
  const value = String(field || '').trim().toLowerCase();
  const aliases = {
    qqlevel: 'qqLevel',
    level: 'qqLevel',
    'qq等级': 'qqLevel',
    '等级': 'qqLevel',
    age: 'age',
    '年龄': 'age',
    comment: 'comment',
    reason: 'comment',
    '申请理由': 'comment',
    '答案': 'comment',
    nickname: 'nickname',
    nick: 'nickname',
    '昵称': 'nickname',
    userid: 'userId',
    user_id: 'userId',
    qq: 'userId',
  };
  return aliases[value] || '';
}

function getProfileField(profile = {}, field = '') {
  const normalized = normalizeFieldName(field);
  if (!normalized) return undefined;
  return profile[normalized];
}

function parseCustomRule(line = '') {
  const text = String(line || '').trim();
  if (!text) return null;
  const match = text.match(/^([\w\u4e00-\u9fa5_]+)\s*(>=|<=|>|<|==|=|!=|!contains|contains|includes|包含|不包含)\s*(.+)$/i);
  if (!match) return { invalid: true, text };
  return {
    field: normalizeFieldName(match[1]),
    op: match[2].toLowerCase(),
    value: match[3].trim().replace(/^['"]|['"]$/g, ''),
    text,
  };
}

function evaluateCustomRule(rule = {}, profile = {}) {
  if (!rule || rule.invalid || !rule.field) {
    return { passed: false, reason: `自定义条件无法解析: ${rule?.text || ''}` };
  }

  const actual = getProfileField(profile, rule.field);
  const op = rule.op;
  if (['>', '>=', '<', '<='].includes(op)) {
    const left = parseNumberLike(actual);
    const right = parseNumberLike(rule.value);
    if (left === null || right === null) {
      return { passed: false, reason: `条件 ${rule.text} 需要数字资料` };
    }
    if (op === '>' && !(left > right)) return { passed: false, reason: `未满足 ${rule.text}` };
    if (op === '>=' && !(left >= right)) return { passed: false, reason: `未满足 ${rule.text}` };
    if (op === '<' && !(left < right)) return { passed: false, reason: `未满足 ${rule.text}` };
    if (op === '<=' && !(left <= right)) return { passed: false, reason: `未满足 ${rule.text}` };
    return { passed: true };
  }

  const leftText = String(actual ?? '');
  const rightText = String(rule.value ?? '');
  if (['=', '=='].includes(op)) {
    return leftText === rightText ? { passed: true } : { passed: false, reason: `未满足 ${rule.text}` };
  }
  if (op === '!=') {
    return leftText !== rightText ? { passed: true } : { passed: false, reason: `未满足 ${rule.text}` };
  }
  if (['contains', 'includes', '包含'].includes(op)) {
    return leftText.includes(rightText) ? { passed: true } : { passed: false, reason: `未满足 ${rule.text}` };
  }
  if (['!contains', '不包含'].includes(op)) {
    return !leftText.includes(rightText) ? { passed: true } : { passed: false, reason: `未满足 ${rule.text}` };
  }

  return { passed: false, reason: `不支持的条件: ${rule.text}` };
}

function buildRiskResult(score = 0, reasons = [], extra = {}) {
  const normalizedScore = Math.min(100, Math.max(0, Math.round(score)));
  const level = normalizedScore >= 70 ? 'high' : normalizedScore >= 40 ? 'medium' : 'low';
  return {
    score: normalizedScore,
    level,
    reasons: reasons.slice(0, 12),
    ...extra,
  };
}

export function evaluateJoinRequestRisk(config = {}, profile = {}, moderation = {}) {
  const cfg = normalizeJoinRequestAutoApproveConfig(config);
  const riskCfg = normalizeJoinRequestRiskConfig(cfg.risk);
  const moderationSettings = normalizeGroupModerationSettings(moderation.settings || {}, riskCfg);
  if (!riskCfg.enabled || !moderationSettings.enabled || !riskCfg.scoreEnabled || !moderationSettings.scoreEnabled) {
    return buildRiskResult(0, [], {
      enabled: false,
      blacklisted: false,
      whitelisted: false,
      warningCount: Number(moderation.warningCount || 0),
      highRiskScore: riskCfg.highRiskScore,
      warningBlockThreshold: riskCfg.warningBlockThreshold,
    });
  }

  const reasons = [];
  let score = 0;
  const addRisk = (points, reason) => {
    score += points;
    if (reason) reasons.push(reason);
  };

  const textForKeyword = [profile.comment, profile.nickname, profile.userId].map(item => String(item || '')).join('\n');
  const blockedKeyword = cfg.blockedKeywords.find(keyword => textForKeyword.includes(keyword));
  if (moderation.blacklisted) {
    addRisk(100, `命中群管黑名单${moderation.blacklistEntry?.note ? `: ${moderation.blacklistEntry.note}` : ''}`);
  }
  const warningCount = normalizeInteger(moderation.warningCount, 0, 0, 10000);
  if (warningCount > 0) {
    addRisk(Math.min(60, warningCount * 15), `已有警告积分 ${warningCount}`);
  }
  if (blockedKeyword) {
    addRisk(60, `命中拦截关键词: ${blockedKeyword}`);
  }
  if (cfg.minQqLevel > 0) {
    if (profile.qqLevel === null || profile.qqLevel === undefined) {
      addRisk(30, '无法读取 QQ 等级');
    } else if (Number(profile.qqLevel) < cfg.minQqLevel) {
      addRisk(35, `QQ 等级 ${profile.qqLevel} 小于 ${cfg.minQqLevel}`);
    }
  }
  if (cfg.minAge > 0) {
    if (profile.age === null || profile.age === undefined) {
      addRisk(20, '无法读取年龄');
    } else if (Number(profile.age) < cfg.minAge) {
      addRisk(25, `年龄 ${profile.age} 小于 ${cfg.minAge}`);
    }
  }
  if (cfg.commentKeywords.length > 0) {
    const matched = cfg.commentKeywords.some(keyword => String(profile.comment || '').includes(keyword));
    if (!matched) {
      addRisk(25, '申请理由未命中必要关键词');
    }
  }
  for (const line of cfg.customRules) {
    const result = evaluateCustomRule(parseCustomRule(line), profile);
    if (!result.passed) {
      addRisk(20, result.reason || `未满足 ${line}`);
    }
  }

  if (moderation.whitelisted) {
    reasons.push(`命中群管白名单${moderation.whitelistEntry?.note ? `: ${moderation.whitelistEntry.note}` : ''}`);
    score = Math.max(0, score - 40);
  }

  return buildRiskResult(score, reasons, {
    enabled: true,
    blacklisted: Boolean(moderation.blacklisted),
    whitelisted: Boolean(moderation.whitelisted),
    warningCount,
    highRiskScore: riskCfg.highRiskScore,
    warningBlockThreshold: riskCfg.warningBlockThreshold,
  });
}

export function evaluateJoinRequestAutoApprove(config = {}, profile = {}, moderation = {}) {
  const cfg = normalizeJoinRequestAutoApproveConfig(config);
  const risk = evaluateJoinRequestRisk(cfg, profile, moderation);
  if (!cfg.enable) return { passed: false, reason: '未启用自动通过', risk };

  const textForKeyword = [profile.comment, profile.nickname, profile.userId].map(item => String(item || '')).join('\n');
  const blockedKeyword = cfg.blockedKeywords.find(keyword => textForKeyword.includes(keyword));
  if (blockedKeyword) {
    return { passed: false, reason: `命中拦截关键词: ${blockedKeyword}`, risk };
  }

  if (risk.enabled && risk.blacklisted && cfg.risk.blockBlacklistAutoApprove !== false) {
    return { passed: false, reason: '命中群管黑名单', risk };
  }

  if (
    risk.enabled
    && cfg.risk.warningBlockThreshold > 0
    && risk.warningCount >= cfg.risk.warningBlockThreshold
  ) {
    return { passed: false, reason: `警告积分 ${risk.warningCount} 已达到阈值 ${cfg.risk.warningBlockThreshold}`, risk };
  }

  if (risk.enabled && risk.whitelisted && cfg.risk.autoApproveWhitelisted !== false) {
    return { passed: true, reason: '命中群管白名单', risk };
  }

  if (cfg.minQqLevel > 0) {
    if (profile.qqLevel === null || profile.qqLevel === undefined) {
      return { passed: false, reason: '无法读取 QQ 等级', risk };
    }
    if (Number(profile.qqLevel) < cfg.minQqLevel) {
      return { passed: false, reason: `QQ 等级 ${profile.qqLevel} 小于 ${cfg.minQqLevel}`, risk };
    }
  }

  if (cfg.minAge > 0) {
    if (profile.age === null || profile.age === undefined) {
      return { passed: false, reason: '无法读取年龄', risk };
    }
    if (Number(profile.age) < cfg.minAge) {
      return { passed: false, reason: `年龄 ${profile.age} 小于 ${cfg.minAge}`, risk };
    }
  }

  if (cfg.commentKeywords.length > 0) {
    const matched = cfg.commentKeywords.some(keyword => String(profile.comment || '').includes(keyword));
    if (!matched) {
      return { passed: false, reason: '申请理由未命中必要关键词', risk };
    }
  }

  for (const line of cfg.customRules) {
    const result = evaluateCustomRule(parseCustomRule(line), profile);
    if (!result.passed) return { ...result, risk };
  }

  if (
    risk.enabled
    && cfg.risk.holdHighRisk === true
    && risk.score >= cfg.risk.highRiskScore
  ) {
    return { passed: false, reason: `风险评分 ${risk.score} 达到高风险阈值 ${cfg.risk.highRiskScore}`, risk };
  }

  return { passed: true, reason: '满足自动通过条件', risk };
}

async function approveJoinRequest(e = {}, reason = '') {
  if (typeof e.approve === 'function') {
    return await e.approve(true, reason);
  }

  const bot = getEventBot(e);
  const flag = String(e.flag ?? e.request_flag ?? e.raw?.flag ?? '').trim();
  const subType = String(e.sub_type ?? e.subType ?? 'add').trim() || 'add';
  if (typeof bot?.sendApi === 'function' && flag) {
    return await bot.sendApi('set_group_add_request', {
      flag,
      sub_type: subType,
      approve: true,
      reason,
    });
  }

  if (typeof bot?.setGroupAddRequest === 'function' && flag) {
    return await bot.setGroupAddRequest(flag, subType, true, reason);
  }

  throw new Error('当前适配器不支持自动处理加群申请');
}

export async function handleJoinRequestAutoApprove(e = {}, authConfig = {}) {
  const groupId = String(e.group_id ?? e.groupId ?? e.gid ?? '').trim();
  const userId = String(e.user_id ?? e.userId ?? e.uid ?? '').trim();
  if (!groupId || !userId) return false;

  const profile = await buildJoinRequestApplicantProfile(e);
  const config = getJoinRequestAutoApproveConfig(authConfig, groupId);
  const moderation = getGroupMemberModeration(groupId, userId);
  const result = evaluateJoinRequestAutoApprove(config, profile, moderation);
  const requestRecord = upsertJoinRequestRecord(e, profile, {
    status: 'pending',
    reason: result.reason,
    risk: result.risk,
    source: 'request.group.add',
  });
  if (!config.enable) {
    appendGroupManagementLog({
      action: 'join_request_review_kept',
      source: 'joinRequestAutoApprove',
      success: true,
      group_id: groupId,
      user_id: userId,
      nickname: profile.nickname,
      reason: '未启用自动通过',
      comment_preview: profile.comment,
      summary: {
        qqLevel: profile.qqLevel,
        age: profile.age,
        sex: profile.sex,
        risk: result.risk,
      },
    });
    return false;
  }

  if (!result.passed) {
    logger.info(`[crystelf-plugin] 群[${groupId}]用户[${userId}]加群申请未自动通过: ${result.reason}`);
    if (requestRecord?.id) {
      updateJoinRequestRecord(requestRecord.id, {
        status: 'pending',
        reason: result.reason,
        error: '',
        risk: result.risk,
      });
    }
    appendGroupManagementLog({
      action: 'join_request_review_kept',
      source: 'joinRequestAutoApprove',
      success: true,
      group_id: groupId,
      user_id: userId,
      nickname: profile.nickname,
      reason: result.reason,
      comment_preview: profile.comment,
      summary: {
        qqLevel: profile.qqLevel,
        age: profile.age,
        sex: profile.sex,
        risk: result.risk,
      },
    });
    return false;
  }

  try {
    await approveJoinRequest(e, '符合自动入群条件');
    logger.mark(`[crystelf-plugin] 已自动通过群[${groupId}]用户[${userId}]加群申请: ${result.reason}`);
    if (requestRecord?.id) {
      updateJoinRequestRecord(requestRecord.id, {
        status: 'approved',
        handledBy: 'autoApprove',
        handledAt: new Date().toISOString(),
        reason: result.reason,
        error: '',
        risk: result.risk,
      });
    }
    appendGroupManagementLog({
      action: 'join_request_auto_approved',
      source: 'joinRequestAutoApprove',
      success: true,
      group_id: groupId,
      user_id: userId,
      nickname: profile.nickname,
      reason: result.reason,
      comment_preview: profile.comment,
      summary: {
        qqLevel: profile.qqLevel,
        age: profile.age,
        sex: profile.sex,
        risk: result.risk,
      },
    });
    return true;
  } catch (error) {
    if (requestRecord?.id) {
      updateJoinRequestRecord(requestRecord.id, {
        status: 'pending',
        reason: result.reason,
        error: error.message,
        risk: result.risk,
      });
    }
    appendGroupManagementLog({
      action: 'join_request_auto_approve_failed',
      source: 'joinRequestAutoApprove',
      success: false,
      group_id: groupId,
      user_id: userId,
      nickname: profile.nickname,
      reason: result.reason,
      error: error.message,
      comment_preview: profile.comment,
    });
    throw error;
  }
}
