import { extractUrlsFromGroupMessage } from '../groupManagement/urlSafetyRuntime.js';

const URL_PATTERN = /(https?:\/\/|www\.|mqqapi:|qm\.qq\.com|jq\.qq\.com|t\.cn\/|b23\.tv\/|tb\.cn\/)/i;
const RISK_SCORE = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function normalizeString(value = '', maxLength = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeInteger(value, fallback = 0, min = 0, max = 10000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeStringList(value = []) {
  if (Array.isArray(value)) {
    return value.map(item => normalizeString(item, 80)).filter(Boolean).slice(0, 500);
  }
  if (typeof value === 'string') {
    return value.split(/\r?\n|[,，、;]/).map(item => normalizeString(item, 80)).filter(Boolean).slice(0, 500);
  }
  return [];
}

function parseNumberLike(value) {
  if (value === null || value === undefined || value === '') return null;
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function normalizeRiskLevel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return ['none', 'low', 'medium', 'high'].includes(normalized) ? normalized : 'none';
}

function riskMeetsThreshold(riskLevel = 'none', threshold = 'high') {
  return Number(RISK_SCORE[normalizeRiskLevel(riskLevel)] || 0) >= Number(RISK_SCORE[normalizeRiskLevel(threshold)] || RISK_SCORE.high);
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

function normalizeWhitelistRule(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

function getUrlMatchParts(url = '') {
  try {
    const parsed = new URL(url);
    const hostname = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '');
    const pathname = String(parsed.pathname || '/').replace(/\/+$/, '');
    return {
      hostname,
      full: `${hostname}${pathname}${parsed.search || ''}`.replace(/\/+$/, ''),
    };
  } catch {
    return {
      hostname: '',
      full: normalizeWhitelistRule(url),
    };
  }
}

function matchWhitelistRule(url = '', whitelist = []) {
  const rules = Array.isArray(whitelist) ? whitelist : [];
  const parts = getUrlMatchParts(url);
  for (const rawRule of rules) {
    const rule = normalizeWhitelistRule(rawRule);
    if (!rule) continue;
    if (rule.startsWith('*.')) {
      const domain = rule.slice(2);
      if (parts.hostname === domain || parts.hostname.endsWith(`.${domain}`)) return rawRule;
      continue;
    }
    if (rule.includes('/')) {
      if (parts.full === rule || parts.full.startsWith(`${rule}/`) || parts.full.startsWith(`${rule}?`)) {
        return rawRule;
      }
      continue;
    }
    if (parts.hostname === rule || parts.hostname.endsWith(`.${rule}`)) return rawRule;
  }
  return '';
}

function parseUserListLine(line = '') {
  const text = String(line || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{5,20})(?:[\s,，:：|-]+([\s\S]+))?$/);
  if (!match) return null;
  return {
    userId: match[1],
    note: normalizeString(match[2] || '', 120),
  };
}

function normalizeUserList(value = []) {
  const result = [];
  const seen = new Set();
  const source = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  for (const item of source) {
    const parsed = isPlainObject(item)
      ? { userId: normalizeId(item.userId || item.user_id || item.qq), note: normalizeString(item.note || item.reason || '', 120) }
      : parseUserListLine(item);
    if (!parsed?.userId || seen.has(parsed.userId)) continue;
    seen.add(parsed.userId);
    result.push(parsed);
  }
  return result;
}

function buildModerationForUser(groupId = '', userId = '', options = {}) {
  const getGroupMemberModeration = typeof options.getGroupMemberModeration === 'function'
    ? options.getGroupMemberModeration
    : (() => ({}));
  const existing = getGroupMemberModeration(groupId, userId) || {};
  const draft = isPlainObject(options.draftModeration) ? options.draftModeration : {};
  const blacklist = Object.prototype.hasOwnProperty.call(draft, 'blacklist')
    ? normalizeUserList(draft.blacklist)
    : [];
  const whitelist = Object.prototype.hasOwnProperty.call(draft, 'whitelist')
    ? normalizeUserList(draft.whitelist)
    : [];
  const hasDraftLists = Object.prototype.hasOwnProperty.call(draft, 'blacklist')
    || Object.prototype.hasOwnProperty.call(draft, 'whitelist');
  const blacklistEntry = hasDraftLists
    ? (blacklist.find(item => item.userId === userId) || null)
    : (existing.blacklistEntry || null);
  const whitelistEntry = hasDraftLists
    ? (whitelist.find(item => item.userId === userId) || null)
    : (existing.whitelistEntry || null);
  const warningCount = Object.prototype.hasOwnProperty.call(options, 'warningCount')
    ? normalizeInteger(options.warningCount, 0, 0, 10000)
    : Number(existing.warningCount || 0);
  return {
    groupId,
    userId,
    settings: existing.settings || {},
    blacklisted: Boolean(blacklistEntry),
    blacklistEntry,
    whitelisted: Boolean(whitelistEntry),
    whitelistEntry,
    warningCount,
    warning: existing.warning || { userId, count: warningCount, items: [] },
  };
}

function resolveModerationSafetyPlan(cfg = {}, safety = {}) {
  const requestedAction = ['log', 'warn', 'recall', 'mute', 'kick'].includes(String(cfg.action || '').trim())
    ? String(cfg.action || '').trim()
    : 'log';
  let action = requestedAction;
  let muteSeconds = normalizeInteger(cfg.muteSeconds, 600, 60, 2592000);
  const safetyMessages = [];
  if (safety.enabled !== false) {
    if (requestedAction === 'recall' && safety.allowAutoRecall !== true) {
      action = 'warn';
      safetyMessages.push('安全开关禁止自动撤回，运行时会降级为提醒并警告');
    }
    if (requestedAction === 'mute' && safety.allowAutoMute !== true) {
      action = 'warn';
      safetyMessages.push('安全开关禁止自动禁言，运行时会降级为提醒并警告');
    }
    if (requestedAction === 'kick' && safety.allowAutoKick !== true) {
      action = 'warn';
      safetyMessages.push('安全开关禁止自动踢人，运行时会降级为提醒并警告');
    }
    if (action === 'mute' && muteSeconds > Number(safety.maxAutoMuteSeconds || 600)) {
      muteSeconds = Math.max(60, Number(safety.maxAutoMuteSeconds || 600));
      safetyMessages.push(`自动禁言时长会按安全上限限制为 ${muteSeconds} 秒`);
    }
  }
  return {
    requestedAction,
    requestedActionLabel: getActionLabel(requestedAction),
    action,
    actionLabel: getActionLabel(action),
    muteSeconds,
    safetyDowngraded: requestedAction !== action || safetyMessages.length > 0,
    safetyMessages,
  };
}

function previewUrlSafety(messageText = '', cfg = {}, simulatedRiskLevel = 'none') {
  const urlSafety = cfg.urlSafety || {};
  if (urlSafety.enabled !== true) {
    return {
      checked: false,
      urls: [],
      results: [],
      signals: [],
      note: '链接安全检查未开启',
    };
  }
  const urls = extractUrlsFromGroupMessage(messageText, Number(urlSafety.maxUrlsPerMessage || 2));
  if (urls.length === 0) {
    return {
      checked: false,
      urls: [],
      results: [],
      signals: [],
      note: '消息中没有可检查的 http/https 链接',
    };
  }
  const riskLevel = normalizeRiskLevel(simulatedRiskLevel);
  const results = urls.map(url => {
    const whitelistRule = matchWhitelistRule(url, urlSafety.whitelist || []);
    if (whitelistRule) {
      return {
        url,
        skipped: true,
        skipReason: 'whitelist',
        whitelistRule,
        riskLevel: 'none',
        signal: '',
        note: '命中白名单，真实运行会跳过 LLM 检查',
      };
    }
    const signal = riskMeetsThreshold(riskLevel, urlSafety.riskThreshold)
      ? `URL安全风险(${riskLevel}): 调试器模拟风险等级达到阈值`
      : '';
    return {
      url,
      skipped: false,
      riskLevel,
      threshold: urlSafety.riskThreshold || 'high',
      signal,
      note: '真实运行会读取网页 Markdown 并调用 LLM；调试器只按这里选择的模拟风险等级判断',
    };
  });
  return {
    checked: true,
    urls,
    results,
    signals: results.map(item => item.signal).filter(Boolean),
    note: '调试器不会发起网页读取或 LLM 调用',
  };
}

function evaluateMessageRules(payload = {}, context = {}) {
  const groupId = normalizeId(payload.groupId);
  const userId = normalizeId(payload.userId);
  const text = String(payload.messageText || '');
  const role = String(payload.role || 'member').trim();
  const isAdmin = payload.isMaster === true || role === 'owner' || role === 'admin';
  const draft = isPlainObject(payload.draft) ? payload.draft : {};
  const draftModeration = isPlainObject(draft.moderation) ? draft.moderation : {};
  const cfg = context.normalizeGroupContentModerationConfig(
    isPlainObject(draftModeration.content) ? draftModeration.content : context.configState?.moderation?.content || {},
  );
  const safety = isPlainObject(payload.safety) ? payload.safety : context.getSafetyConfig();
  const moderation = buildModerationForUser(groupId, userId, {
    getGroupMemberModeration: context.getGroupMemberModeration,
    draftModeration,
    warningCount: payload.warningCount,
  });
  const signals = [];
  const notes = [];
  const details = [];

  if (!cfg.enabled) {
    return {
      type: 'message',
      triggered: false,
      tone: 'neutral',
      title: '不会触发',
      reason: '群消息风控未开启',
      config: cfg,
      moderation,
      signals,
      notes,
      details,
    };
  }
  if (!userId) {
    notes.push('未填写有效 QQ 号，黑白名单与警告积分只能按空用户模拟。');
  }
  if (cfg.exemptAdmins && isAdmin) {
    return {
      type: 'message',
      triggered: false,
      tone: 'success',
      title: '不会触发',
      reason: '发送者是群主/管理员，且规则设置为跳过管理人员',
      config: cfg,
      moderation,
      signals,
      notes,
      details,
    };
  }
  if (moderation.whitelisted) {
    return {
      type: 'message',
      triggered: false,
      tone: 'success',
      title: '不会触发',
      reason: `命中本群白名单${moderation.whitelistEntry?.note ? `：${moderation.whitelistEntry.note}` : ''}`,
      config: cfg,
      moderation,
      signals,
      notes,
      details,
    };
  }

  const hasLink = URL_PATTERN.test(text);
  const matchedKeyword = cfg.detectBlockedKeywords
    ? (cfg.blockedKeywords || []).find(keyword => keyword && text.includes(keyword))
    : '';
  if (matchedKeyword) signals.push(`命中关键词: ${matchedKeyword}`);
  if (cfg.detectLinks && hasLink) signals.push('包含链接');
  if (
    cfg.observeNewMembers
    && payload.isNewMember === true
    && normalizeInteger(payload.minutesSinceJoin, 0, 0, 10080) <= Number(cfg.observeMinutes || 60)
    && cfg.observeBlockLinks
    && hasLink
  ) {
    signals.push(`新人观察期内发链接 (${cfg.observeMinutes} 分钟)`);
  }
  const repeatCount = normalizeInteger(payload.repeatCount, 1, 1, 1000);
  if (text.trim() && repeatCount >= Number(cfg.repeatLimit || 4)) {
    signals.push(`重复消息 ${repeatCount}/${cfg.repeatLimit}`);
  }
  const burstCount = normalizeInteger(payload.burstCount, 1, 1, 1000);
  if (cfg.detectSpamMessages && burstCount > Number(cfg.burstLimit || 8)) {
    signals.push(`刷屏检测 ${burstCount}/${cfg.burstLimit} 条/${cfg.burstWindowSeconds || 60} 秒`);
  }
  const urlSafety = previewUrlSafety(text, cfg, payload.simulatedUrlRiskLevel);
  signals.push(...urlSafety.signals);
  details.push({
    label: 'URL 安全预览',
    value: urlSafety.note,
    items: urlSafety.results.map(item => item.skipped
      ? `${item.url}：白名单跳过(${item.whitelistRule})`
      : `${item.url}：模拟风险 ${item.riskLevel} / 阈值 ${item.threshold}`),
  });

  const uniqueSignals = Array.from(new Set(signals));
  const plan = resolveModerationSafetyPlan(cfg, safety);
  return {
    type: 'message',
    triggered: uniqueSignals.length > 0,
    tone: uniqueSignals.length > 0 ? (plan.action === 'log' ? 'warning' : 'error') : 'success',
    title: uniqueSignals.length > 0 ? '会触发群消息风控' : '不会触发',
    reason: uniqueSignals.length > 0 ? uniqueSignals.join('；') : '没有命中关键词、链接、新人观察期、重复消息或刷屏规则',
    config: cfg,
    moderation,
    signals: uniqueSignals,
    safetyPlan: plan,
    urlSafety,
    notes,
    details,
  };
}

function evaluateJoinRules(payload = {}, context = {}) {
  const groupId = normalizeId(payload.groupId);
  const userId = normalizeId(payload.userId);
  const draft = isPlainObject(payload.draft) ? payload.draft : {};
  const draftAuth = isPlainObject(draft.auth) ? draft.auth : {};
  const draftModeration = isPlainObject(draft.moderation) ? draft.moderation : {};
  const config = isPlainObject(draftAuth.autoApprove)
    ? context.normalizeJoinRequestAutoApproveConfig(draftAuth.autoApprove)
    : context.getJoinRequestAutoApproveConfig(context.allConfigs.auth || {}, groupId);
  const profile = {
    groupId,
    userId,
    comment: String(payload.comment || ''),
    nickname: normalizeString(payload.nickname || '', 80),
    age: parseNumberLike(payload.age),
    qqLevel: parseNumberLike(payload.qqLevel),
    sex: String(payload.sex || '').trim(),
    raw: {},
  };
  const moderation = buildModerationForUser(groupId, userId, {
    getGroupMemberModeration: context.getGroupMemberModeration,
    draftModeration,
    warningCount: payload.warningCount,
  });
  const result = context.evaluateJoinRequestAutoApprove(config, profile, moderation);
  return {
    type: 'join',
    triggered: result.passed === true,
    tone: result.passed ? 'success' : 'warning',
    title: result.passed ? '会自动通过加群申请' : '会保留人工审核',
    reason: result.reason || '',
    config,
    profile,
    moderation,
    result,
    signals: result.risk?.reasons || [],
    notes: config.enable
      ? []
      : ['自动通过未开启时，真实运行只会记录申请并保留人工审核。'],
  };
}

function getTextWidth(text = '') {
  let width = 0;
  for (const char of String(text || '')) {
    width += char.charCodeAt(0) <= 0x7F ? 1 : 2;
  }
  return width;
}

function sanitizeTitleText(text = '') {
  return String(text || '')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasControlCharacter(text = '') {
  for (const char of String(text || '')) {
    const code = char.charCodeAt(0);
    if (code <= 0x1F || code === 0x7F) return true;
  }
  return false;
}

function normalizeGroupTitleConfig(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const aiReview = isPlainObject(source.aiReview) ? source.aiReview : {};
  return {
    enabled: source.enabled === true,
    allowedGroups: normalizeStringList(source.allowedGroups).map(normalizeId).filter(Boolean),
    blockedGroups: normalizeStringList(source.blockedGroups).map(normalizeId).filter(Boolean),
    forbiddenKeywords: normalizeStringList(source.forbiddenKeywords).slice(0, 200),
    maxDisplayWidth: normalizeInteger(source.maxDisplayWidth, 12, 2, 24),
    autoApprove: source.autoApprove === true,
    aiReview: {
      enabled: aiReview.enabled === true,
      autoRejectIllegal: aiReview.autoRejectIllegal !== false,
    },
  };
}

function findForbiddenTitleKeyword(title = '', cfg = {}) {
  const normalizedTitle = sanitizeTitleText(title).toLowerCase();
  const exactRoleKeywords = new Set(['管理员', '群主', '官方', '客服']);
  return (cfg.forbiddenKeywords || []).find(keyword => {
    const text = String(keyword || '').toLowerCase();
    if (!text) return false;
    if (exactRoleKeywords.has(keyword)) return normalizedTitle === text;
    return normalizedTitle.includes(text);
  }) || '';
}

function validateTitle(title = '', cfg = {}) {
  const text = sanitizeTitleText(title);
  if (!text) return { ok: false, error: '头衔为空' };
  if (hasControlCharacter(text)) return { ok: false, error: '头衔包含控制字符' };
  if (/[<>[\]{}]/.test(text)) return { ok: false, error: '头衔包含不允许的符号 < > [ ] { }' };
  const forbiddenKeyword = findForbiddenTitleKeyword(text, cfg);
  if (forbiddenKeyword) return { ok: false, error: `头衔包含禁用词：${forbiddenKeyword}` };
  const width = getTextWidth(text);
  if (width > cfg.maxDisplayWidth) {
    return { ok: false, error: `头衔太长，当前宽度 ${width}，最多 ${cfg.maxDisplayWidth}` };
  }
  return { ok: true, title: text, width };
}

function evaluateTitleRules(payload = {}, context = {}) {
  const groupId = normalizeId(payload.groupId);
  const mainConfig = context.allConfigs.config || {};
  const cfg = normalizeGroupTitleConfig(context.allConfigs.groupTitle || {});
  const botRole = String(payload.botRole || context.groupRecord?.permission?.role || context.groupRecord?.botRole || '').trim();
  const notes = [];
  if (mainConfig.groupTitle === false) {
    return { type: 'title', triggered: false, tone: 'neutral', title: '不可申请头衔', reason: '主开关 groupTitle 已关闭', config: cfg, notes };
  }
  if (!cfg.enabled) {
    return { type: 'title', triggered: false, tone: 'neutral', title: '不可申请头衔', reason: '群头衔申请功能未开启', config: cfg, notes };
  }
  if (cfg.blockedGroups.includes(groupId)) {
    return { type: 'title', triggered: false, tone: 'warning', title: '不可申请头衔', reason: '本群在头衔申请黑名单中', config: cfg, notes };
  }
  if (cfg.allowedGroups.length > 0 && !cfg.allowedGroups.includes(groupId)) {
    return { type: 'title', triggered: false, tone: 'warning', title: '不可申请头衔', reason: '头衔申请启用了群白名单，本群不在白名单中', config: cfg, notes };
  }
  if (botRole && botRole !== 'owner') {
    notes.push('真实运行中只有 Bot 是群主时才能发放群头衔。');
  }
  const validated = validateTitle(payload.titleText || '', cfg);
  if (!validated.ok) {
    return {
      type: 'title',
      triggered: false,
      tone: 'error',
      title: '头衔会被拒绝',
      reason: validated.error,
      config: cfg,
      validation: validated,
      notes,
    };
  }
  if (botRole && botRole !== 'owner') {
    return {
      type: 'title',
      triggered: false,
      tone: 'warning',
      title: '规则通过但无法发放',
      reason: 'Bot 当前不是群主，真实运行会提示权限不足',
      config: cfg,
      validation: validated,
      notes,
    };
  }
  if (cfg.autoApprove) {
    return {
      type: 'title',
      triggered: true,
      tone: 'success',
      title: '会自动通过并发放头衔',
      reason: '本地规则校验通过，且已开启头衔自动通过',
      config: cfg,
      validation: validated,
      notes,
    };
  }
  if (cfg.aiReview.enabled) {
    return {
      type: 'title',
      triggered: true,
      tone: 'warning',
      title: '会进入 AI 头衔审核',
      reason: '本地规则校验通过；真实运行会继续调用 AI 审核，调试器不发起模型请求',
      config: cfg,
      validation: validated,
      notes: [...notes, cfg.aiReview.autoRejectIllegal ? 'AI 判定不合法时会自动拒绝。' : 'AI 建议拒绝时会保留人工审核。'],
    };
  }
  return {
    type: 'title',
    triggered: true,
    tone: 'neutral',
    title: '会提交人工审核',
    reason: '本地规则校验通过，但未开启自动通过或 AI 审核',
    config: cfg,
    validation: validated,
    notes,
  };
}

export function createGroupManagementRuleDebugger(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode, message) => Object.assign(new Error(message), { statusCode }));
  const normalizeGroupId = typeof options.normalizeGroupId === 'function' ? options.normalizeGroupId : normalizeId;
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : (() => ({}));
  const getConfigState = typeof options.getConfigState === 'function' ? options.getConfigState : (() => ({}));
  const getSafetyConfig = typeof options.getSafetyConfig === 'function' ? options.getSafetyConfig : (() => ({}));
  const getGroupMemberModeration = typeof options.getGroupMemberModeration === 'function'
    ? options.getGroupMemberModeration
    : (() => ({}));
  const getGroups = typeof options.getGroups === 'function' ? options.getGroups : (async () => []);
  const normalizeGroupContentModerationConfig = typeof options.normalizeGroupContentModerationConfig === 'function'
    ? options.normalizeGroupContentModerationConfig
    : (value => value || {});
  const normalizeJoinRequestAutoApproveConfig = typeof options.normalizeJoinRequestAutoApproveConfig === 'function'
    ? options.normalizeJoinRequestAutoApproveConfig
    : (value => value || {});
  const getJoinRequestAutoApproveConfig = typeof options.getJoinRequestAutoApproveConfig === 'function'
    ? options.getJoinRequestAutoApproveConfig
    : (() => ({}));
  const evaluateJoinRequestAutoApprove = typeof options.evaluateJoinRequestAutoApprove === 'function'
    ? options.evaluateJoinRequestAutoApprove
    : (() => ({ passed: false, reason: '加群申请评估器不可用', risk: {} }));

  async function findGroupRecord(groupId = '') {
    try {
      const groups = await getGroups();
      return (Array.isArray(groups) ? groups : []).find(item => String(item.groupId || '') === groupId) || null;
    } catch {
      return null;
    }
  }

  async function buildPayload(payload = {}) {
    const type = String(payload.type || 'message').trim();
    const groupId = normalizeGroupId(payload.groupId || '');
    if (!groupId) {
      throw createHttpError(400, '群号必须是 5-20 位数字');
    }
    const allConfigs = getAllConfigs() || {};
    const configState = getConfigState(groupId, allConfigs);
    const groupRecord = await findGroupRecord(groupId);
    const context = {
      allConfigs,
      configState,
      groupRecord,
      getSafetyConfig,
      getGroupMemberModeration,
      normalizeGroupContentModerationConfig,
      normalizeJoinRequestAutoApproveConfig,
      getJoinRequestAutoApproveConfig,
      evaluateJoinRequestAutoApprove,
    };
    let result;
    if (type === 'join') {
      result = evaluateJoinRules({ ...payload, groupId }, context);
    } else if (type === 'title') {
      result = evaluateTitleRules({ ...payload, groupId }, context);
    } else {
      result = evaluateMessageRules({ ...payload, groupId }, context);
    }
    return {
      success: true,
      readOnly: true,
      generatedAt: new Date().toISOString(),
      groupId,
      type: result.type,
      result,
    };
  }

  return {
    buildPayload,
  };
}
