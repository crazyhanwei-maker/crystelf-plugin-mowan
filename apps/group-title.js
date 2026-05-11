import ConfigControl from '../lib/config/configControl.js';
import AiCaller from '../lib/ai/aiCaller.js';
import { appendGroupManagementLog } from '../lib/groupManagement/groupManagementLog.js';
import {
  createTitleApplication,
  findPendingTitleApplication,
  listPendingTitleApplications,
  pruneExpiredTitleApplications,
  updateTitleApplicationStatus,
} from '../lib/groupTitle/titleApplicationStore.js';

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

const DEFAULT_TITLE_REVIEW_POLICY = '禁止色情、暴力、辱骂、广告、政治敏感、冒充管理、欺诈、引战、泄露隐私；允许普通昵称、角色名、轻度玩梗，但不得攻击他人。';

function normalizeGroupId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function normalizeUserId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function getSelfId(e = {}) {
  return normalizeUserId(e.bot?.uin ?? e.self_id ?? e.bot_id ?? globalThis.Bot?.uin);
}

function getApiId(value = '') {
  const normalized = String(value || '').trim();
  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) ? numeric : normalized;
}

function getRoleLabel(role = '') {
  if (role === 'owner') return '群主';
  if (role === 'admin') return '管理员';
  return '成员';
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeStringList(value = []) {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeKeywordList(value = []) {
  return Array.from(new Set(normalizeStringList(value).map(item => item.slice(0, 40)).filter(Boolean))).slice(0, 200);
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeAiReviewConfig(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const policy = String(source.policy || DEFAULT_TITLE_REVIEW_POLICY).trim();
  return {
    enabled: source.enabled === true,
    autoRejectIllegal: source.autoRejectIllegal !== false,
    model: String(source.model || '').trim(),
    temperature: clampNumber(source.temperature, 0, 2, 0),
    maxTokens: Math.round(clampNumber(source.maxTokens, 100, 1000, 300)),
    policy: policy || DEFAULT_TITLE_REVIEW_POLICY,
  };
}

function normalizeGroupTitleConfig(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    enabled: source.enabled === true,
    allowedGroups: normalizeStringList(source.allowedGroups).map(normalizeGroupId).filter(Boolean),
    blockedGroups: normalizeStringList(source.blockedGroups).map(normalizeGroupId).filter(Boolean),
    approvalRoles: normalizeStringList(source.approvalRoles).filter(role => ['owner', 'admin'].includes(role)),
    forbiddenKeywords: normalizeKeywordList(source.forbiddenKeywords),
    maxDisplayWidth: Math.max(2, Math.min(24, Number(source.maxDisplayWidth || 12))),
    pendingExpireHours: Math.max(1, Math.min(720, Number(source.pendingExpireHours || 72))),
    aiReview: normalizeAiReviewConfig(source.aiReview),
  };
}

function isGroupAllowed(groupId = '', mainConfig = {}, titleConfig = {}) {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return false;
  if (mainConfig.groupTitle === false) return false;
  const cfg = normalizeGroupTitleConfig(titleConfig);
  if (!cfg.enabled) return false;
  if (cfg.blockedGroups.includes(normalizedGroupId)) return false;
  if (cfg.allowedGroups.length > 0 && !cfg.allowedGroups.includes(normalizedGroupId)) return false;
  return true;
}

function getTextWidth(text = '') {
  let width = 0;
  for (const char of String(text || '')) {
    width += char.charCodeAt(0) <= 0x7F ? 1 : 2;
  }
  return width;
}

function hasControlCharacter(text = '') {
  for (const char of String(text || '')) {
    const code = char.charCodeAt(0);
    if (code <= 0x1F || code === 0x7F) return true;
  }
  return false;
}

function sanitizeTitleText(text = '') {
  return String(text || '')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findForbiddenTitleKeyword(title = '', config = {}) {
  const cfg = normalizeGroupTitleConfig(config);
  const normalizedTitle = sanitizeTitleText(title).toLowerCase();
  if (!normalizedTitle) return '';
  return (cfg.forbiddenKeywords || []).find(keyword => normalizedTitle.includes(String(keyword || '').toLowerCase())) || '';
}

function validateTitle(title = '', config = {}) {
  const cfg = normalizeGroupTitleConfig(config);
  const text = sanitizeTitleText(title);
  if (!text) {
    return { ok: false, error: '请在命令后输入要申请的头衔。' };
  }
  if (hasControlCharacter(text)) {
    return { ok: false, error: '头衔不能包含控制字符。' };
  }
  if (/[<>[\]{}]/.test(text)) {
    return { ok: false, error: '头衔不能包含 < > [ ] { } 这类符号。' };
  }
  const forbiddenKeyword = findForbiddenTitleKeyword(text, cfg);
  if (forbiddenKeyword) {
    return { ok: false, error: `头衔包含禁用词：${forbiddenKeyword}` };
  }
  const width = getTextWidth(text);
  if (width > cfg.maxDisplayWidth) {
    return { ok: false, error: `头衔太长了，当前宽度 ${width}，最多 ${cfg.maxDisplayWidth}。` };
  }
  return { ok: true, title: text };
}

function isReviewer(e = {}, config = {}) {
  const cfg = normalizeGroupTitleConfig(config);
  const roles = cfg.approvalRoles.length > 0 ? cfg.approvalRoles : ['owner', 'admin'];
  return e.isMaster === true || roles.includes(String(e.sender?.role || ''));
}

function getSenderName(e = {}) {
  return String(e.sender?.card || e.sender?.nickname || e.nickname || '').trim();
}

function getGroupName(e = {}) {
  return String(e.group?.info?.group_name || e.group_name || e.group?.name || '').trim();
}

function getAtUserId(e = {}) {
  const selfId = getSelfId(e);
  const at = Array.isArray(e.message)
    ? e.message.find(item => item?.type === 'at' && normalizeUserId(item.qq) && String(item.qq) !== selfId)
    : null;
  return normalizeUserId(at?.qq);
}

function parseApplicationId(text = '') {
  const match = String(text || '').trim().match(/\bT\d{5}\b/i);
  return match ? match[0].toUpperCase() : '';
}

function parseReviewCommand(e = {}, prefixPattern) {
  const rest = String(e.msg || '').replace(prefixPattern, '').trim();
  const id = parseApplicationId(rest);
  const userId = getAtUserId(e);
  const reason = rest
    .replace(/\bT\d{5}\b/i, '')
    .replace(/\[CQ:at,qq=\d+[^\]]*\]/g, '')
    .trim();
  return { id, userId, reason };
}

function buildAt(userId = '') {
  if (typeof segment !== 'undefined' && typeof segment.at === 'function') {
    return segment.at(getApiId(userId));
  }
  return `@${userId}`;
}

function appendTitleManagementLog(entry = {}) {
  appendGroupManagementLog({
    source: 'groupTitle',
    sections: ['groupTitle'],
    ...entry,
  });
}

function sanitizeReviewReason(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function isAiTitleReviewAvailable(mainConfig = {}, aiConfig = {}, reviewCfg = {}) {
  if (mainConfig.ai === false) return false;
  return Boolean(
    String(aiConfig.apiKey || '').trim()
    && String(aiConfig.baseApi || '').trim()
    && (reviewCfg.model || aiConfig.workingModel || aiConfig.modelType || aiConfig.model)
  );
}

function buildAiTitleReviewPrompt(e = {}, title = '', cfg = {}) {
  const payload = {
    groupId: normalizeGroupId(e.group_id),
    groupName: getGroupName(e),
    applicantId: normalizeUserId(e.user_id),
    applicantName: getSenderName(e),
    title,
    maxDisplayWidth: cfg.maxDisplayWidth,
    policy: cfg.aiReview.policy,
  };

  return [
    '请审核 QQ 群成员申请的群专属头衔是否合法。',
    '你只判断内容风险，不要因为头衔短、可爱、角色名、普通玩梗而拒绝。',
    '如果头衔包含色情、暴力、辱骂、广告、政治敏感、冒充管理、诈骗、引战、泄露隐私或明显恶意内容，应拒绝。',
    '只输出一个 JSON 对象，不要输出 Markdown、代码块或额外解释。',
    'JSON 格式：{"allow":true,"reason":"通过或拒绝原因，20字以内"}',
    '',
    '审核数据：',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function parseAiTitleReviewResponse(text = '') {
  const cleaned = String(text || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const jsonText = cleaned.startsWith('{') ? cleaned : (cleaned.match(/\{[\s\S]*\}/)?.[0] || '');
  if (!jsonText) {
    throw new Error('AI审核结果不是JSON');
  }

  const parsed = JSON.parse(jsonText);
  let allow = parsed.allow;
  if (typeof allow === 'string') {
    const normalized = allow.trim().toLowerCase();
    if (['true', 'yes', 'allow', 'allowed', 'pass', 'approve', '通过', '允许', '合法'].includes(normalized)) {
      allow = true;
    } else if (['false', 'no', 'deny', 'denied', 'reject', 'rejected', '拒绝', '不通过', '不合法'].includes(normalized)) {
      allow = false;
    }
  }
  if (typeof allow !== 'boolean') {
    throw new Error('AI审核结果缺少 allow 布尔值');
  }

  return {
    allow,
    reason: sanitizeReviewReason(parsed.reason || (allow ? 'AI审核通过' : '不符合头衔规则')),
  };
}

async function reviewTitleWithAi(e = {}, title = '', cfg = {}, aiConfig = {}) {
  const reviewCfg = cfg.aiReview || normalizeAiReviewConfig();
  const prompt = buildAiTitleReviewPrompt(e, title, cfg);
  const groupId = normalizeGroupId(e.group_id);
  const userId = normalizeUserId(e.user_id);
  const result = await AiCaller.callAiDirect(prompt, [], [], null, [], {
    systemPrompt: '你是群头衔安全审核员。必须严格按规则审核，并且只能输出JSON对象。',
    model: reviewCfg.model || aiConfig.workingModel || aiConfig.modelType || aiConfig.model,
    temperature: reviewCfg.temperature,
    max_tokens: reviewCfg.maxTokens,
    scene: 'group_title_review',
    sessionId: `group:${groupId}:title-review`,
    groupId,
    userId,
  });

  if (!result?.success) {
    throw new Error(result?.error || 'AI审核失败');
  }

  return parseAiTitleReviewResponse(result.response);
}

async function getMemberInfo(e = {}, userId = '') {
  const groupId = normalizeGroupId(e.group_id);
  const normalizedUserId = normalizeUserId(userId);
  if (!groupId || !normalizedUserId) return {};
  const bot = e.bot || globalThis.Bot;

  try {
    const member = e.group?.pickMember?.(getApiId(normalizedUserId)) || e.group?.pickMember?.(normalizedUserId);
    if (typeof member?.getInfo === 'function') {
      return await member.getInfo();
    }
    if (member && typeof member === 'object') {
      return member;
    }
  } catch {
    // Try OneBot API below.
  }

  try {
    if (typeof bot?.sendApi === 'function') {
      const result = await bot.sendApi('get_group_member_info', {
        group_id: getApiId(groupId),
        user_id: getApiId(normalizedUserId),
        no_cache: true,
      });
      return result?.data?.data || result?.data || result || {};
    }
  } catch {
    // No reliable member info available.
  }

  return {};
}

async function getBotRole(e = {}) {
  const selfId = getSelfId(e);
  const info = await getMemberInfo(e, selfId);
  return String(info.role || '').trim();
}

async function ensureBotIsGroupOwner(e = {}) {
  const role = await getBotRole(e);
  if (role !== 'owner') {
    return {
      ok: false,
      error: role ? `机器人当前是${getRoleLabel(role)}，只有机器人是群主时才能设置群头衔。` : '无法确认机器人是否为群主，不能设置群头衔。',
    };
  }
  return { ok: true };
}

async function setGroupSpecialTitle(e = {}, userId = '', title = '') {
  const groupId = normalizeGroupId(e.group_id);
  const normalizedUserId = normalizeUserId(userId);
  if (!groupId || !normalizedUserId) {
    throw new Error('群号或用户 QQ 无效');
  }

  const bot = e.bot || globalThis.Bot;
  const group = e.group || bot?.pickGroup?.(getApiId(groupId)) || bot?.pickGroup?.(groupId);
  if (typeof group?.setTitle === 'function') {
    return await group.setTitle(getApiId(normalizedUserId), title, -1);
  }
  if (typeof group?.setSpecialTitle === 'function') {
    return await group.setSpecialTitle(getApiId(normalizedUserId), title, -1);
  }
  if (typeof bot?.setGroupSpecialTitle === 'function') {
    return await bot.setGroupSpecialTitle(getApiId(groupId), getApiId(normalizedUserId), title, -1);
  }
  if (typeof bot?.sendApi === 'function') {
    return await bot.sendApi('set_group_special_title', {
      group_id: getApiId(groupId),
      user_id: getApiId(normalizedUserId),
      special_title: title,
      duration: -1,
    });
  }
  throw new Error('当前适配器不支持设置群头衔');
}

export class groupTitleApplication extends plugin {
  constructor() {
    super({
      name: 'group-title-application',
      dsc: '群头衔申请',
      event: 'message.group',
      priority: -1000,
      rule: [
        { reg: '^#申请头衔[\\s\\S]*$', fnc: 'applyTitle' },
        { reg: '^#头衔申请列表$', fnc: 'listApplications' },
        { reg: '^#同意头衔(?:\\s|$)[\\s\\S]*$', fnc: 'approveTitle' },
        { reg: '^#拒绝头衔(?:\\s|$)[\\s\\S]*$', fnc: 'rejectTitle' },
        { reg: '^#取消头衔申请$', fnc: 'cancelApplication' },
      ],
    });
  }

  async getConfigs() {
    return {
      mainConfig: ConfigControl.get('config') || {},
      titleConfig: ConfigControl.get('groupTitle') || {},
      aiConfig: ConfigControl.get('ai') || {},
    };
  }

  async guardFeature(e = {}) {
    const { mainConfig, titleConfig, aiConfig } = await this.getConfigs();
    const cfg = normalizeGroupTitleConfig(titleConfig);
    pruneExpiredTitleApplications(cfg.pendingExpireHours);

    if (!isGroupAllowed(e.group_id, mainConfig, cfg)) {
      return { ok: false, error: '本群未开启群头衔申请功能。', cfg, mainConfig, aiConfig };
    }

    const ownerCheck = await ensureBotIsGroupOwner(e);
    if (!ownerCheck.ok) {
      return { ok: false, error: ownerCheck.error, cfg, mainConfig, aiConfig };
    }

    return { ok: true, cfg, mainConfig, aiConfig };
  }

  async applyTitle(e) {
    const guard = await this.guardFeature(e);
    if (!guard.ok) return e.reply(guard.error, true);

    const rawTitle = String(e.msg || '').replace(/^#申请头衔/, '').trim();
    const validated = validateTitle(rawTitle, guard.cfg);
    if (!validated.ok) return e.reply(validated.error, true);

    const record = createTitleApplication({
      groupId: e.group_id,
      userId: e.user_id,
      nickname: getSenderName(e),
      title: validated.title,
    });
    appendTitleManagementLog({
      action: 'group_title_application_created',
      success: true,
      group_id: record.groupId,
      user_id: record.userId,
      nickname: record.nickname,
      changes: [`已提交头衔申请：${record.title}`],
      summary: {
        applicationId: record.id,
        title: record.title,
      },
    });

    if (guard.cfg.aiReview.enabled) {
      if (!isAiTitleReviewAvailable(guard.mainConfig, guard.aiConfig, guard.cfg.aiReview)) {
        appendTitleManagementLog({
          action: 'group_title_ai_review_unavailable',
          success: true,
          group_id: record.groupId,
          user_id: record.userId,
          nickname: record.nickname,
          changes: ['AI 头衔审核不可用，转入人工审核'],
          summary: {
            applicationId: record.id,
            title: record.title,
          },
        });
        return e.reply([
          buildAt(e.user_id),
          ` 头衔申请已提交：${record.title}\n`,
          `编号：${record.id}\n`,
          'AI审核暂不可用，已转入人工审核。',
        ], true);
      }

      let review = null;
      try {
        review = await reviewTitleWithAi(e, record.title, guard.cfg, guard.aiConfig);
      } catch (error) {
        logger.warn(`[group-title] AI审核头衔失败: ${error.message}`);
        appendTitleManagementLog({
          action: 'group_title_ai_review_failed',
          success: false,
          group_id: record.groupId,
          user_id: record.userId,
          nickname: record.nickname,
          error: error.message,
          changes: ['AI 头衔审核失败，转入人工审核'],
          summary: {
            applicationId: record.id,
            title: record.title,
          },
        });
        return e.reply([
          buildAt(e.user_id),
          ` 头衔申请已提交：${record.title}\n`,
          `编号：${record.id}\n`,
          'AI审核失败，已转入人工审核。',
        ], true);
      }

      if (review.allow) {
        try {
          await setGroupSpecialTitle(e, record.userId, record.title);
          updateTitleApplicationStatus(record.id, 'approved', {
            reviewerId: 'ai',
            reviewerName: 'AI审核',
            reason: review.reason || 'AI审核通过',
            error: '',
          });
          appendTitleManagementLog({
            action: 'group_title_ai_approved',
            success: true,
            group_id: record.groupId,
            user_id: record.userId,
            nickname: record.nickname,
            reason: review.reason || 'AI审核通过',
            changes: [`AI 审核通过并发放头衔：${record.title}`],
            summary: {
              applicationId: record.id,
              title: record.title,
            },
          });
          return e.reply([buildAt(record.userId), ` AI审核通过，已发放头衔：${record.title}`], true);
        } catch (error) {
          logger.warn(`[group-title] AI审核通过但设置群头衔失败: ${error.message}`);
          updateTitleApplicationStatus(record.id, 'failed', {
            reviewerId: 'ai',
            reviewerName: 'AI审核',
            reason: review.reason || 'AI审核通过',
            error: error.message,
          });
          appendTitleManagementLog({
            action: 'group_title_ai_approve_failed',
            success: false,
            group_id: record.groupId,
            user_id: record.userId,
            nickname: record.nickname,
            reason: review.reason || 'AI审核通过',
            error: error.message,
            changes: [`AI 审核通过但发放头衔失败：${record.title}`],
            summary: {
              applicationId: record.id,
              title: record.title,
            },
          });
          return e.reply(`AI审核通过，但设置群头衔失败：${error.message}`, true);
        }
      }

      const reason = review.reason || '不符合头衔规则';
      if (guard.cfg.aiReview.autoRejectIllegal) {
        updateTitleApplicationStatus(record.id, 'rejected', {
          reviewerId: 'ai',
          reviewerName: 'AI审核',
          reason,
          error: '',
        });
        appendTitleManagementLog({
          action: 'group_title_ai_rejected',
          success: true,
          group_id: record.groupId,
          user_id: record.userId,
          nickname: record.nickname,
          reason,
          changes: [`AI 审核拒绝头衔：${record.title}`],
          summary: {
            applicationId: record.id,
            title: record.title,
          },
        });
        return e.reply([buildAt(record.userId), ` 头衔申请未通过AI审核：${reason}`], true);
      }

      updateTitleApplicationStatus(record.id, 'pending', {
        reviewerId: 'ai',
        reviewerName: 'AI审核',
        reason,
        error: '',
      });
      appendTitleManagementLog({
        action: 'group_title_ai_review_kept',
        success: true,
        group_id: record.groupId,
        user_id: record.userId,
        nickname: record.nickname,
        reason,
        changes: [`AI 建议拒绝，保留人工审核：${record.title}`],
        summary: {
          applicationId: record.id,
          title: record.title,
        },
      });
      return e.reply([
        buildAt(e.user_id),
        ` 头衔申请已提交：${record.title}\n`,
        `编号：${record.id}\n`,
        `AI审核建议不通过：${reason}\n`,
        '已保留为人工审核。',
      ], true);
    }

    return e.reply([
      buildAt(e.user_id),
      ` 头衔申请已提交：${record.title}\n`,
      `编号：${record.id}\n`,
      `管理员发送 #同意头衔 ${record.id} 通过，或 #拒绝头衔 ${record.id} 理由。`,
    ], true);
  }

  async listApplications(e) {
    const guard = await this.guardFeature(e);
    if (!guard.ok) return e.reply(guard.error, true);
    if (!isReviewer(e, guard.cfg)) {
      return e.reply('只有群主或管理员可以查看头衔申请列表。', true);
    }

    const items = listPendingTitleApplications(e.group_id, 10);
    if (items.length === 0) {
      return e.reply('本群暂无待处理头衔申请。', true);
    }

    const lines = items.map(item => `${item.id} / ${item.nickname || item.userId} / ${item.title}`);
    return e.reply(`本群待处理头衔申请：\n${lines.join('\n')}\n\n通过：#同意头衔 编号\n拒绝：#拒绝头衔 编号 理由`, true);
  }

  async approveTitle(e) {
    const guard = await this.guardFeature(e);
    if (!guard.ok) return e.reply(guard.error, true);
    if (!isReviewer(e, guard.cfg)) {
      return e.reply('只有群主或管理员可以审核头衔申请。', true);
    }

    const query = parseReviewCommand(e, /^#同意头衔/);
    const record = findPendingTitleApplication({
      groupId: e.group_id,
      id: query.id,
      userId: query.userId,
    });
    if (!record) {
      return e.reply('未找到待处理头衔申请，请使用 #头衔申请列表 查看编号。', true);
    }

    try {
      await setGroupSpecialTitle(e, record.userId, record.title);
      updateTitleApplicationStatus(record.id, 'approved', {
        reviewerId: String(e.user_id || ''),
        reviewerName: getSenderName(e),
        reason: query.reason || '已通过',
        error: '',
      });
      appendTitleManagementLog({
        action: 'group_title_command_approved',
        success: true,
        group_id: record.groupId,
        user_id: record.userId,
        operator: String(e.user_id || ''),
        nickname: record.nickname,
        reason: query.reason || '已通过',
        changes: [`群内命令通过并发放头衔：${record.title}`],
        summary: {
          applicationId: record.id,
          title: record.title,
        },
      });
      return e.reply([buildAt(record.userId), ` 头衔申请已通过：${record.title}`], true);
    } catch (error) {
      logger.warn(`[group-title] 设置群头衔失败: ${error.message}`);
      updateTitleApplicationStatus(record.id, 'failed', {
        reviewerId: String(e.user_id || ''),
        reviewerName: getSenderName(e),
        reason: query.reason || '已通过',
        error: error.message,
      });
      appendTitleManagementLog({
        action: 'group_title_command_approve_failed',
        success: false,
        group_id: record.groupId,
        user_id: record.userId,
        operator: String(e.user_id || ''),
        nickname: record.nickname,
        reason: query.reason || '已通过',
        error: error.message,
        changes: [`群内命令发放头衔失败：${record.title}`],
        summary: {
          applicationId: record.id,
          title: record.title,
        },
      });
      return e.reply(`设置群头衔失败：${error.message}`, true);
    }
  }

  async rejectTitle(e) {
    const guard = await this.guardFeature(e);
    if (!guard.ok) return e.reply(guard.error, true);
    if (!isReviewer(e, guard.cfg)) {
      return e.reply('只有群主或管理员可以审核头衔申请。', true);
    }

    const query = parseReviewCommand(e, /^#拒绝头衔/);
    const record = findPendingTitleApplication({
      groupId: e.group_id,
      id: query.id,
      userId: query.userId,
    });
    if (!record) {
      return e.reply('未找到待处理头衔申请，请使用 #头衔申请列表 查看编号。', true);
    }

    updateTitleApplicationStatus(record.id, 'rejected', {
      reviewerId: String(e.user_id || ''),
      reviewerName: getSenderName(e),
      reason: query.reason || '未填写理由',
      error: '',
    });
    appendTitleManagementLog({
      action: 'group_title_command_rejected',
      success: true,
      group_id: record.groupId,
      user_id: record.userId,
      operator: String(e.user_id || ''),
      nickname: record.nickname,
      reason: query.reason || '未填写理由',
      changes: [`群内命令拒绝头衔：${record.title}`],
      summary: {
        applicationId: record.id,
        title: record.title,
      },
    });
    return e.reply([buildAt(record.userId), ` 头衔申请已拒绝：${query.reason || '未填写理由'}`], true);
  }

  async cancelApplication(e) {
    const guard = await this.guardFeature(e);
    if (!guard.ok) return e.reply(guard.error, true);

    const record = findPendingTitleApplication({
      groupId: e.group_id,
      userId: e.user_id,
    });
    if (!record) {
      return e.reply('你当前没有待处理的头衔申请。', true);
    }

    updateTitleApplicationStatus(record.id, 'cancelled', {
      reviewerId: String(e.user_id || ''),
      reviewerName: getSenderName(e),
      reason: '申请人取消',
      error: '',
    });
    appendTitleManagementLog({
      action: 'group_title_application_cancelled',
      success: true,
      group_id: record.groupId,
      user_id: record.userId,
      nickname: record.nickname,
      reason: '申请人取消',
      changes: [`申请人取消头衔申请：${record.title}`],
      summary: {
        applicationId: record.id,
        title: record.title,
      },
    });
    return e.reply(`已取消头衔申请：${record.title}`, true);
  }
}
