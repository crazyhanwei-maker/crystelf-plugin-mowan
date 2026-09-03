import ConfigControl from '../config/configControl.js';
import { getTtsTools } from './ttsRegistry.js';
import { getGroupVoiceModel } from './ttsGroupModelStore.js';
import Group from '../yunzai/group.js';
import YunzaiUtils from '../yunzai/utils.js';

const logger = globalThis.logger || {
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),
};

function getBotUin(e) {
  return e?.bot?.uin || e?.self_id || e?.bot_id || globalThis.Bot?.uin || null;
}

function isBotUser(userId, e) {
  const botUin = getBotUin(e);
  return botUin !== null && String(userId) === String(botUin);
}

// 白名单/黑名单经 JSON 落盘常变字符串，而事件 group_id 是数字；includes 严格相等会全部漏判
function listIncludes(list, value) {
  return Array.isArray(list) && list.some(item => String(item) === String(value));
}

function isGroupAllowed(groupId, config = {}) {
  if (listIncludes(config?.blockGroup, groupId)) return false;
  const white = config?.whiteGroup;
  if (Array.isArray(white) && white.length > 0 && !listIncludes(white, groupId)) return false;
  return true;
}

function tryMarkHandled(e = {}) {
  if (e.crystelfVoiceSynthesisHandled) {
    return false;
  }
  e.crystelfVoiceSynthesisHandled = true;
  return true;
}

export function parseDirectVoiceCommand(text = '') {
  const content = String(text || '').trim();
  if (!content) return null;

  const patterns = [
    /^(#|\/)?合成语音[：:，,\s]*(.+)$/i,
    /^(#|\/)?语音\s+(.+)$/i,
    /^(#|\/)?tts\s+(.+)$/i,
    /^(#|\/)?配音\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[2]) {
      return match[2].trim();
    }
  }

  const naturalPatterns = [
    /用语音说[一下一遍个]?(.+)$/,
    /发语音说[一下一遍个]?(.+)$/,
    /语音说[一下一遍个]?(.+)$/,
    /帮我用语音说[一下一遍个]?(.+)$/,
    /帮我发语音说[一下一遍个]?(.+)$/,
    /发个语音[：:，,\s]*(.+)$/,
    /来个语音[：:，,\s]*(.+)$/,
    /整个语音[：:，,\s]*(.+)$/,
    /念一下[：:，,\s]*(.+)$/,
    /朗读一下[：:，,\s]*(.+)$/,
  ];

  for (const pattern of naturalPatterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/^['"“”‘’]+|['"“”‘’]+$/g, '');
    }
  }

  return null;
}

export async function sendVoiceMessage(e, message) {
  const adapter = await YunzaiUtils.getAdapter(e);
  if (!message?.audioUrl) {
    logger.warn('[crystelf-tts] 语音消息缺少 audioUrl');
    return false;
  }
  await Group.sendGroupRecord(e, e.group_id, message.audioUrl, adapter);
  return true;
}

export async function handleDirectVoiceCommand(e, text) {
  try {
    const ttsTool = getTtsTools().find(tool => tool.name === 'speak_text');
    if (!ttsTool) {
      await e.reply('语音工具暂时不可用。', true);
      return true;
    }

    const toolCtx = {
      event: e,
      groupId: e.group_id,
      userId: e.user_id,
      defaultVoiceModel: getGroupVoiceModel(e.group_id),
      targetMessage: { content: e.msg },
      promptCtx: { replyContext: { type: 'reply' } },
    };

    const result = await ttsTool.handler({ text, force: true }, toolCtx);
    if (result?.voiceMessage) {
      await sendVoiceMessage(e, result.voiceMessage);
      return true;
    }

    await e.reply(result?.error || '语音生成失败。', true);
    return true;
  } catch (error) {
    logger.error(`[crystelf-tts] 处理显式语音命令失败: ${error.message}`);
    await e.reply('语音生成失败，稍后再试。', true);
    return true;
  }
}

export async function handleDirectVoiceEvent(e) {
  if (!tryMarkHandled(e)) {
    return true;
  }

  const config = await ConfigControl.get();
  const aiConfig = config?.ai || {};
  if (!isGroupAllowed(e.group_id, aiConfig)) {
    return false;
  }
  if (isBotUser(e.user_id, e)) {
    return false;
  }

  const text = parseDirectVoiceCommand(e.msg);
  if (!text) {
    await e.reply('请输入要合成的语音内容，例如：#合成语音你好。', true);
    return true;
  }

  return handleDirectVoiceCommand(e, text);
}
