import configControl from '../lib/config/configControl.js';
import tools from '../components/tool.js';
import AiCaller from '../lib/ai/aiCaller.js';
import { appendGroupManagementLog } from '../lib/groupManagement/groupManagementLog.js';

const AI_WELCOME_TIMEOUT_MS = 15000;

function isAiWelcomeEnabled(welcomeCfg = {}) {
  return welcomeCfg?.aiEnabled === true || welcomeCfg?.ai?.enabled === true;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasWelcomeContent(welcomeCfg = {}) {
  return Boolean(
    String(welcomeCfg?.text || '').trim()
    || String(welcomeCfg?.image || '').trim()
    || isAiWelcomeEnabled(welcomeCfg),
  );
}

function isWelcomeEnabled(welcomeCfg = {}) {
  if (!isPlainObject(welcomeCfg) || Object.keys(welcomeCfg).length <= 0) return false;
  if (welcomeCfg.enabled === true) return true;
  if (welcomeCfg.enabled === false) return false;
  return hasWelcomeContent(welcomeCfg);
}

function getWelcomeConfigForGroup(newcomerCfg = {}, groupId = '') {
  const groups = isPlainObject(newcomerCfg) ? newcomerCfg : {};
  const key = String(groupId || '').trim();
  if (isPlainObject(groups[key]) && Object.keys(groups[key]).length > 0) {
    return groups[key];
  }
  return isPlainObject(groups.default) ? groups.default : {};
}

function normalizeIdList(value = []) {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];
}

function isAiWelcomeAllowed(groupId, mainConfig = {}, aiConfig = {}) {
  if (mainConfig.ai === false) return false;
  const normalizedGroupId = String(groupId || '').trim();
  if (!normalizedGroupId) return false;
  const blockedGroups = normalizeIdList(aiConfig.blockGroup);
  const whiteGroups = normalizeIdList(aiConfig.whiteGroup);
  if (blockedGroups.includes(normalizedGroupId)) return false;
  if (whiteGroups.length > 0 && !whiteGroups.includes(normalizedGroupId)) return false;
  return Boolean(aiConfig.apiKey && aiConfig.baseApi && (aiConfig.workingModel || aiConfig.modelType || aiConfig.model));
}

function buildPlainWelcomeMessages(e, welcomeCfg = {}, overrideText = '') {
  const text = String(overrideText || welcomeCfg.text || '').trim();
  const msgList = [segment.at(e.user_id)];
  if (text) msgList.push(text);
  if (welcomeCfg.image) msgList.push(segment.image(welcomeCfg.image));
  if (!text && !welcomeCfg.image) msgList.push('欢迎新成员。');
  return msgList;
}

async function getNewcomerName(e) {
  try {
    const member = await e.group?.pickMember?.(e.user_id);
    const info = await member?.getInfo?.();
    return info?.card || info?.nickname || member?.card || member?.nickname || e.nickname || `QQ${e.user_id}`;
  } catch {
    return e.nickname || e.sender?.card || e.sender?.nickname || `QQ${e.user_id}`;
  }
}

function sanitizeAiWelcomeText(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/@[\w\u4e00-\u9fa5-]+/g, '')
    .replace(/QQ[:：]?\s*\d{5,20}/gi, '')
    .replace(/^\s*["'“”‘’]+|["'“”‘’]+\s*$/g, '')
    .split(/\n+/)
    .map(line => line.replace(/^[-*•\d.、\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('\n')
    .slice(0, 180)
    .trim();
}

async function withAiWelcomeTimeout(promise, timeoutMs) {
  let timeoutHandle = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`AI欢迎生成超时（${timeoutMs}ms）`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function generateAiWelcomeText(e, welcomeCfg = {}) {
  try {
    const groupId = String(e.group_id || '').trim();
    const [mainConfig, aiConfig, profileConfig] = await Promise.all([
      configControl.get('config'),
      configControl.get('ai'),
      configControl.get('profile'),
    ]);
    if (!isAiWelcomeAllowed(groupId, mainConfig || {}, aiConfig || {})) {
      return '';
    }

    const newcomerName = await getNewcomerName(e);
    const groupName = e.group?.info?.group_name || e.group_name || `群 ${groupId}`;
    const botName = profileConfig?.nickName || profileConfig?.nickname || '机器人';
    const baseWelcome = String(welcomeCfg.text || '欢迎新成员。').trim();
    const prompt = [
      `你是群聊里的 ${botName}，需要欢迎刚入群的新成员。`,
      `群名：${groupName}`,
      `新成员：${newcomerName}（QQ：${e.user_id}）`,
      `普通欢迎文案：${baseWelcome}`,
      '请生成一条自然、友好、适合群聊发送的中文欢迎语。',
      '要求：不要使用 @，不要输出 QQ 号，不要解释，不要列表，不要 Markdown，不要提到 AI 或接口；最多 60 个中文字符。',
    ].join('\n');

    const result = await withAiWelcomeTimeout(AiCaller.callAiDirect(prompt, [], [], null, [], {
      systemPrompt: '你只负责生成群聊新人欢迎语。输出最终欢迎语本身，不要补充说明。',
      model: aiConfig.workingModel || aiConfig.modelType || aiConfig.model,
      temperature: aiConfig.welcomeTemperature ?? aiConfig.temperature ?? 0.8,
      max_tokens: 120,
      scene: 'ai_welcome',
      sessionId: `welcome:${groupId}`,
      groupId,
      userId: e.user_id,
    }), Math.min(Number(aiConfig.timeout) > 0 ? Number(aiConfig.timeout) : AI_WELCOME_TIMEOUT_MS, AI_WELCOME_TIMEOUT_MS));

    if (!result?.success) {
      logger.warn(`[welcome-newcomer] AI欢迎生成失败，回退普通欢迎：${result?.error || 'unknown error'}`);
      return '';
    }
    const text = sanitizeAiWelcomeText(result.response);
    if (!text) {
      logger.warn('[welcome-newcomer] AI欢迎生成空内容，回退普通欢迎');
    }
    return text;
  } catch (err) {
    logger.warn(`[welcome-newcomer] AI欢迎生成异常，回退普通欢迎：${err.message}`);
    return '';
  }
}

async function refreshPendingWelcomeWithAi(e, welcomeCfg = {}, redisKey = '') {
  const aiText = await generateAiWelcomeText(e, welcomeCfg);
  if (!aiText) return;
  const cached = await redis.get(redisKey);
  if (!cached) return;
  await redis.set(redisKey, JSON.stringify(buildPlainWelcomeMessages(e, welcomeCfg, aiText)), { EX: 300 });
}

export class welcomeNewcomer extends plugin {
  constructor() {
    super({
      name: 'welcome-newcomer',
      dsc: '新人入群欢迎',
      event: 'notice.group.increase',
      priority: -1000,
    });
  }

  async accept(e) {
    try {
      await tools.sleep(600);
      if (e.user_id === e.self_id) return;
      const groupId = e.group_id;
      const cdKey = `Yz:newcomers:${groupId}`;
      if (await redis.get(cdKey)) return;
      await redis.set(cdKey, '1', { EX: 30 });
      const newcomerCfg = (await configControl.get('newcomer')) || {};
      const welcomeCfg = getWelcomeConfigForGroup(newcomerCfg, groupId);
      if (!isWelcomeEnabled(welcomeCfg)) return;
      const authCfg = await configControl.get('auth');
      const groupAuthCfg = authCfg?.groups?.[groupId] || authCfg?.default || {};
      const plainMsgList = buildPlainWelcomeMessages(e, welcomeCfg);
      if (groupAuthCfg?.enable) {
        const redisKey = `Yz:pendingWelcome:${groupId}:${e.user_id}`;
        await redis.set(redisKey, JSON.stringify(plainMsgList), { EX: 300 });
        if (isAiWelcomeEnabled(welcomeCfg)) {
          refreshPendingWelcomeWithAi(e, welcomeCfg, redisKey).catch(err => {
            logger.warn(`[welcome-newcomer] 刷新 AI 欢迎缓存失败，保留普通欢迎：${err.message}`);
          });
        }
        appendGroupManagementLog({
          action: 'group_welcome_pending',
          source: 'welcome',
          success: true,
          group_id: groupId,
          user_id: e.user_id,
          nickname: e.nickname || e.sender?.nickname || '',
          sections: ['welcome'],
          changes: ['入群欢迎已缓存，等待验证通过后发送'],
          summary: {
            aiWelcome: isAiWelcomeEnabled(welcomeCfg),
            hasImage: Boolean(welcomeCfg.image),
          },
        });
        return;
      }
      const aiText = isAiWelcomeEnabled(welcomeCfg) ? await generateAiWelcomeText(e, welcomeCfg) : '';
      const msgList = aiText ? buildPlainWelcomeMessages(e, welcomeCfg, aiText) : plainMsgList;
      // 未开启验证
      await e.reply(msgList);
      appendGroupManagementLog({
        action: 'group_welcome_sent',
        source: 'welcome',
        success: true,
        group_id: groupId,
        user_id: e.user_id,
        nickname: e.nickname || e.sender?.nickname || '',
        sections: ['welcome'],
        changes: [aiText ? '已发送 AI 入群欢迎' : '已发送普通入群欢迎'],
        summary: {
          aiWelcome: Boolean(aiText),
          hasImage: Boolean(welcomeCfg.image),
        },
      });
    } catch (err) {
      appendGroupManagementLog({
        action: 'group_welcome_failed',
        source: 'welcome',
        success: false,
        group_id: e.group_id,
        user_id: e.user_id,
        nickname: e.nickname || e.sender?.nickname || '',
        error: err.message,
        sections: ['welcome'],
        changes: ['入群欢迎发送失败'],
      });
      return e.reply('加群欢迎出现错误，请重新设置欢迎内容。', true);
    }
  }
}
