import cfg from '../../../lib/config/config.js';
import tool from '../components/tool.js';
import axios from 'axios';
import OpenAI from 'openai';
import configControl from '../lib/config/configControl.js';
import ConfigControl from '../lib/config/configControl.js';
import AiCaller from '../lib/ai/aiCaller.js';
import ResponseHandler from '../lib/ai/responseHandler.js';
import { logAiUsage, shouldCircuitBreakSync } from '../lib/ai/usageLogger.js';
import Group from '../lib/yunzai/group.js';
import Meme from '../lib/core/meme.js';
import YunzaiUtils from '../lib/yunzai/utils.js';
import { segment } from 'oicq';
import { getTtsTools } from '../lib/ai/ttsRegistry.js';
import { setPokeDebugSnapshot } from '../lib/ai/runtimePokeDebugStore.js';
import { getPokeFollowWindow, setPokeFollowWindow } from '../lib/ai/runtimePokeFollowStore.js';

const pokeRuntimeState = {
  userCooldown: new Map(),
  groupWindow: new Map(),
  followWindows: new Map(),
};

const EMOJI_SEQUENCE_REGEX = /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/gu;
const EMOJI_FLAG_REGEX = /\p{Regional_Indicator}{2}/gu;
const EMOJI_KEYCAP_REGEX = /[#*0-9]\uFE0F?\u20E3/gu;
const EMOJI_MODIFIER_REGEX = /[\u{1F3FB}-\u{1F3FF}]/gu;
const EMOJI_JOINER_REGEX = /[\u200D\uFE0E\uFE0F]/gu;

function stripEmojiCharacters(text = '') {
  return String(text || '')
    .replace(EMOJI_SEQUENCE_REGEX, '')
    .replace(EMOJI_FLAG_REGEX, '')
    .replace(EMOJI_KEYCAP_REGEX, '')
    .replace(EMOJI_MODIFIER_REGEX, '')
    .replace(EMOJI_JOINER_REGEX, '')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();
}

function applyEmojiSuppression(text = '', aiConfig = null) {
  const effectiveAiConfig = aiConfig || configControl.get('ai') || {};
  if (!effectiveAiConfig?.emojiSuppression) {
    return String(text || '');
  }

  return stripEmojiCharacters(text);
}

async function summarizePokeImage(imageUrl, e) {
  const aiConfig = configControl.get('ai') || {};
  const pokeConfig = configControl.get('poke') || {};
  const apiKey = String(aiConfig.apiKey || '').trim();
  const baseURL = String(aiConfig.baseApi || '').trim();
  const model = String(aiConfig.multimodalModel || pokeConfig.model || aiConfig.workingModel || aiConfig.modelType || '').trim();
  const timeout = Number(aiConfig.timeout) > 0 ? Number(aiConfig.timeout) : 60000;
  const startedAt = Date.now();
  if (!imageUrl || !apiKey || !baseURL || !model) {
    return '';
  }
  try {
    const client = new OpenAI({ apiKey, baseURL, timeout });
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请用一句简短中文描述这张图片中最关键的内容，不要分析，不要扩写，不超过30字。' },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }],
      stream: false,
      max_tokens: 60,
    });
    const summary = String(completion?.choices?.[0]?.message?.content || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    await logAiUsage({
      stage: 'success',
      scene: 'poke_image_summary',
      model,
      provider: 'openai-compatible',
      sessionId: e?.group_id ? `poke:${e.group_id}` : `poke:${e?.operator_id || 'unknown'}`,
      groupId: e?.group_id,
      userId: e?.operator_id,
      messageCount: 1,
      elapsedMs: Date.now() - startedAt,
      promptPreview: '请用一句简短中文描述这张图片中最关键的内容，不要分析，不要扩写，不超过30字。',
      responsePreview: summary,
      usage: completion?.usage,
    });
    return summary;
  } catch (error) {
    await logAiUsage({
      stage: 'error',
      scene: 'poke_image_summary',
      model,
      provider: 'openai-compatible',
      sessionId: e?.group_id ? `poke:${e.group_id}` : `poke:${e?.operator_id || 'unknown'}`,
      groupId: e?.group_id,
      userId: e?.operator_id,
      messageCount: 1,
      elapsedMs: Date.now() - startedAt,
      promptPreview: '请用一句简短中文描述这张图片中最关键的内容，不要分析，不要扩写，不超过30字。',
      error: error.message,
    });
    logger.warn(`[poke] 非多模态图片摘要失败: ${error.message}`);
    setPokeDebugSnapshot(e?.group_id, {
      lastAction: 'poke_image_summary_failed',
      lastError: error.message,
    });
    return '';
  }
}

export default class ChuochuoPlugin extends plugin {
  constructor() {
    super({
      name: '戳一戳',
      dsc: '喜欢戳鸡气人',
      event: 'notice.group.poke',
      priority: -114510,
      rule: [
        {
          fnc: 'chuoyichuo',
        },
      ],
    });
  }

  async chuoyichuo(e) {
    if (!ConfigControl.get()?.config?.poke) {
      return;
    }

    if (!allowPokeReply(e)) {
      return;
    }

    if (cfg.masterQQ.includes(e.target_id) && e.operator_id !== e.target_id) {
      return await pokeMaster(e);
    }

    if (cfg.masterQQ.includes(e.operator_id) && e.target_id !== e.self_id) {
      return await masterPoke(e);
    }

    if (e.target_id === e.self_id) {
      return await handleBotPoke(e);
    }
  }

  async accept(e) {
    if (e?.post_type !== 'message' || !e?.group_id || !e?.msg) {
      return false;
    }
    const followWindow = pokeRuntimeState.followWindows.get(String(e.group_id));
    return Boolean(followWindow && Date.now() <= followWindow.expiresAt);
  }

  async handleMessage(e) {
    return await handleFollowGroupMessage(e);
  }
}

function splitPokeReplies(text = '') {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return [];
  }

  const explicitSegments = normalized
    .split(/\n---\n|\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean);

  if (explicitSegments.length > 1) {
    return explicitSegments;
  }

  return normalized
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
}

function startPokeFollowWindow(e, replyText) {
  const pokeConfig = configControl.get('poke') || {};
  if (!pokeConfig.followGroupAfterPoke) {
    return;
  }
  pokeRuntimeState.followWindows.set(String(e.group_id), {
    expiresAt: Date.now() + Math.max(1000, Number(pokeConfig.followGroupWindowMs || 10000)),
    groupId: e.group_id,
    operatorId: e.operator_id,
    seedReply: replyText,
    handledCount: 0,
  });
  setPokeFollowWindow(String(e.group_id), pokeRuntimeState.followWindows.get(String(e.group_id)));
  setPokeDebugSnapshot(e.group_id, {
    followWindow: pokeRuntimeState.followWindows.get(String(e.group_id)),
    lastAction: 'start_follow_window',
    lastReply: replyText,
  });
}

async function handleFollowGroupMessage(e) {
  const windowState = pokeRuntimeState.followWindows.get(String(e.group_id));
  if (!windowState || Date.now() > windowState.expiresAt) {
    pokeRuntimeState.followWindows.delete(String(e.group_id));
    setPokeFollowWindow(String(e.group_id), null);
    setPokeDebugSnapshot(e.group_id, { followWindow: null, lastAction: 'follow_window_expired' });
    return false;
  }
  if (String(e.user_id) === String(e.self_id)) {
    return false;
  }
  const pokeConfig = configControl.get('poke') || {};
  const maxFollowReplies = Math.max(0, Number(pokeConfig.followGroupMaxReplies || 1));
  if (windowState.handledCount >= maxFollowReplies) {
    pokeRuntimeState.followWindows.delete(String(e.group_id));
    setPokeFollowWindow(String(e.group_id), null);
    setPokeDebugSnapshot(e.group_id, { followWindow: null, lastAction: 'follow_limit_reached' });
    return false;
  }
  const replyText = await decideFollowReply(e, windowState);
  if (!replyText) {
    setPokeDebugSnapshot(e.group_id, {
      followWindow: windowState,
      lastAction: 'follow_silence',
      lastObservedMessage: String(e.msg || ''),
    });
    return false;
  }
  windowState.handledCount += 1;
  await sendPokeReply(e, replyText);
  if (windowState.handledCount >= maxFollowReplies) {
    pokeRuntimeState.followWindows.delete(String(e.group_id));
    setPokeFollowWindow(String(e.group_id), null);
  } else {
    pokeRuntimeState.followWindows.set(String(e.group_id), windowState);
    setPokeFollowWindow(String(e.group_id), windowState);
  }
  setPokeDebugSnapshot(e.group_id, {
    followWindow: pokeRuntimeState.followWindows.get(String(e.group_id)) || null,
    lastAction: 'follow_reply',
    lastReply: replyText,
    lastObservedMessage: String(e.msg || ''),
  });
  return false;
}

export async function processPokeFollowUpMessage(e) {
  const windowState = getPokeFollowWindow(String(e?.group_id));
  if (!windowState) {
    return false;
  }
  return await handleFollowGroupMessage(e);
}

async function decideFollowReply(e, windowState) {
  const pokeConfig = configControl.get('poke') || {};
  const aiConfig = configControl.get('ai') || {};
  const operatorName = await getOperatorName({ ...e, operator_id: windowState.operatorId });
  const prompt = [
    `由于 ${operatorName} 刚刚戳了你一下，你开始短暂关注当前群聊。`,
    `刚才你的回复是：${windowState.seedReply || '无'}`,
    `现在群里有人又说了：${String(e.msg || '').trim()}`,
    `请你判断是否值得继续接一句。若不值得，请只输出 [[[silence]]]。若值得，请最多输出 ${Math.max(1, Number(pokeConfig.maxReplyMessages || 1))} 条短句，用空行或 \n---\n 分隔。`,
  ].join('\n\n');
  const result = await AiCaller.callAiDirect(prompt, [], [], e, [], {
    systemPrompt: '你是在群聊里被戳后短暂继续观察的机器人。只在真的自然时才继续接话，不要强行插话。',
    model: pokeConfig.model || aiConfig.workingModel || aiConfig.modelType,
    temperature: pokeConfig.temperature ?? 0.9,
    max_tokens: Math.max(80, Number(pokeConfig.maxTokens || 80)),
    scene: 'poke_follow_reply',
    sessionId: `poke-follow:${e.group_id}`,
    groupId: e.group_id,
    userId: e.user_id,
  });
  if (!result?.success) {
    return '';
  }
  const text = sanitizePokeReply(result.response || '', Math.max(1, Number(pokeConfig.maxReplyMessages || 1)));
  if (text.includes('[[[silence]]]')) {
    return '';
  }
  return text.replace(/\[\[\[silence\]\]\]/g, '').trim();
}

function allowPokeReply(e) {
  const pokeConfig = configControl.get('poke') || {};
  const cooldownMs = Math.max(0, Number(pokeConfig.cooldownMs || 0));
  const groupWindowMs = Math.max(1000, Number(pokeConfig.groupRateWindowMs || 60000));
  const groupMaxReplies = Math.max(1, Number(pokeConfig.groupRateMaxReplies || 6));
  const now = Date.now();
  const userKey = `${e.group_id}:${e.operator_id}`;
  const groupKey = String(e.group_id || 'unknown');

  const lastReplyTime = pokeRuntimeState.userCooldown.get(userKey) || 0;
  if (cooldownMs > 0 && now - lastReplyTime < cooldownMs) {
    setPokeDebugSnapshot(e.group_id, {
      lastAction: 'blocked_by_cooldown',
      cooldownMs,
      lastOperatorId: e.operator_id,
      nextAllowedAt: lastReplyTime + cooldownMs,
    });
    return false;
  }

  const recentTimestamps = (pokeRuntimeState.groupWindow.get(groupKey) || []).filter(ts => now - ts < groupWindowMs);
  if (recentTimestamps.length >= groupMaxReplies) {
    pokeRuntimeState.groupWindow.set(groupKey, recentTimestamps);
    setPokeDebugSnapshot(e.group_id, {
      lastAction: 'blocked_by_group_rate',
      groupRateWindowMs: groupWindowMs,
      groupRateMaxReplies: groupMaxReplies,
      groupRateCount: recentTimestamps.length,
    });
    return false;
  }

  recentTimestamps.push(now);
  pokeRuntimeState.groupWindow.set(groupKey, recentTimestamps);
  pokeRuntimeState.userCooldown.set(userKey, now);
  setPokeDebugSnapshot(e.group_id, {
    lastAction: 'allowed',
    cooldownMs,
    groupRateWindowMs: groupWindowMs,
    groupRateMaxReplies: groupMaxReplies,
    groupRateCount: recentTimestamps.length,
    lastOperatorId: e.operator_id,
  });
  return true;
}

async function pokeMaster(e) {
  logger.info('谁戳主人了。');
  if (cfg.masterQQ.includes(e.operator_id) || e.self_id === e.operator_id) {
    return;
  }
  await e.reply(`小嘿子不许戳!`, false, { recallMsg: 60 });
  await tool.sleep(1000);
  await Group.groupPoke(e, e.operator_id, e.group_id);
  return true;
}

async function masterPoke(e) {
  if(e.target_id === e.self_id) return;
  logger.info(`跟主人一起戳!`);
  return await Group.groupPoke(e, e.target_id, e.group_id);
}

async function handleBotPoke(e) {
  try {
    const replyPoke = configControl.get('poke')?.replyPoke;
    const replyText = await getPokeReplyText(e);
    if (replyText) {
      await sendPokeReply(e, replyText);
      startPokeFollowWindow(e, replyText);
      setPokeDebugSnapshot(e.group_id, {
        lastAction: 'poke_reply_sent',
        lastReply: replyText,
        lastOperatorId: e.operator_id,
      });
      if (Math.random() < replyPoke) {
        await tool.sleep(1000);
        return await Group.groupPoke(e, e.operator_id, e.group_id);
      }
      return true;
    }
    return await e.reply(
      `戳一戳处理失败。${configControl.get('profile')?.nickName}暂时没有生成可用回复。`,
      false,
      { recallMsg: 60 }
    );
  } catch (err) {
    logger.error('戳一戳请求失败', err);
    return await e.reply(
      `戳一戳处理失败。${configControl.get('profile')?.nickName}暂时没有生成可用回复。`,
      false,
      { recallMsg: 60 }
    );
  }
}

function normalizeProbability(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function shouldHitProbability(enabled, probability) {
  return enabled === true && Math.random() < normalizeProbability(probability, 0);
}

function inferPokeEmotion(replyText = '') {
  const text = String(replyText || '');
  if (!text) {
    return { memeEmotion: 'default', voiceEmotion: '默认' };
  }

  if (/(气死|生气|别戳|烦|讨厌|怒|可恶|揍|滚)/.test(text)) {
    return { memeEmotion: 'angry', voiceEmotion: '生气' };
  }

  if (/(呜|难过|委屈|伤心|可怜|哭|QAQ)/i.test(text)) {
    return { memeEmotion: 'sad', voiceEmotion: '伤心' };
  }

  if (/(欸|诶|啊\?|啊？|真的假的|居然|怎么又|突然|什么情况)/.test(text)) {
    return { memeEmotion: 'surprised', voiceEmotion: '惊讶' };
  }

  if (/(哼|才不是|别这样|别闹|脸红|害羞|不许看)/.test(text)) {
    return { memeEmotion: 'shy', voiceEmotion: '害羞' };
  }

  if (/(？|why|啥|什么|懵|疑惑|看不懂|迷糊)/i.test(text)) {
    return { memeEmotion: 'confused', voiceEmotion: '疑惑' };
  }

  if (/(嘿嘿|哈哈|好呀|喜欢|开心|可爱|乖|抱抱|贴贴)/.test(text)) {
    return { memeEmotion: 'happy', voiceEmotion: '开心' };
  }

  return { memeEmotion: 'default', voiceEmotion: '默认' };
}

async function getRecentPokeContext(e) {
  const aiConfig = configControl.get('ai') || {};
  const result = {
    lines: [],
    latestImageUrls: [],
    latestImageSenderId: '',
    latestImageSenderName: '',
    latestImageSource: 'none',
    latestImageSummary: '',
    useMultimodal: false,
  };
  try {
    const history = await e.group?.getChatHistory?.(e.message_id || 0, 6);
    const normalized = (Array.isArray(history) ? history : [])
      .map(item => {
        const msgArr = Array.isArray(item?.message) ? item.message : [];
        const text = msgArr.filter(msg => msg.type === 'text').map(msg => msg.text).join(' ').trim();
        const imageUrls = msgArr.filter(msg => msg.type === 'image' && msg.url).map(msg => msg.url);
        return {
          userId: item?.user_id,
          nickname: item?.sender?.card || item?.sender?.nickname || `QQ${item?.user_id || '未知'}`,
          text,
          imageUrls,
          time: Number(item?.time || 0),
        };
      })
      .filter(item => item.userId && String(item.userId) !== String(e.self_id))
      .sort((a, b) => a.time - b.time)
      .slice(-3);

    result.lines = normalized.map(item => `${item.nickname}：${item.text || (item.imageUrls.length > 0 ? '[发了一张图片]' : '[无文本内容]')}`);
    const latestOperatorImage = [...normalized].reverse().find(item => item.imageUrls.length > 0 && String(item.userId) === String(e.operator_id));
    const latestWithImage = latestOperatorImage || [...normalized].reverse().find(item => item.imageUrls.length > 0);
    if ((aiConfig?.multimodalEnabled || aiConfig?.smartMultimodal) && latestWithImage) {
      result.latestImageUrls = latestWithImage.imageUrls.slice(0, 1);
      result.latestImageSenderId = String(latestWithImage.userId || '');
      result.latestImageSenderName = String(latestWithImage.nickname || '');
      result.latestImageSource = latestOperatorImage ? 'operator_recent' : 'group_recent';
      result.useMultimodal = result.latestImageUrls.length > 0;
    } else if (latestWithImage) {
      result.latestImageUrls = latestWithImage.imageUrls.slice(0, 1);
      result.latestImageSenderId = String(latestWithImage.userId || '');
      result.latestImageSenderName = String(latestWithImage.nickname || '');
      result.latestImageSource = latestOperatorImage ? 'operator_recent' : 'group_recent';
      result.latestImageSummary = await summarizePokeImage(result.latestImageUrls[0], e);
    }
  } catch (error) {
    logger.warn(`[poke] 获取戳一戳上下文失败: ${error.message}`);
  }
  return result;
}

async function sendPokeReply(e, replyText) {
  const pokeConfig = configControl.get('poke') || {};
  const aiConfig = configControl.get('ai') || {};
  const botCharacter = aiConfig?.character || configControl.get('profile')?.nickName || 'default';
  const enableTextReply = pokeConfig.enableTextReply !== false;
  const normalizedReplyText = applyEmojiSuppression(replyText, aiConfig);
  const replyTexts = splitPokeReplies(normalizedReplyText).slice(0, Math.max(1, Number(pokeConfig.maxReplyMessages || 1)));
  const primaryReply = replyTexts[0] || normalizedReplyText;
  const shouldSendVoice = shouldHitProbability(pokeConfig.enableVoiceReply, pokeConfig.voiceReplyProbability);
  const shouldSendMeme = shouldHitProbability(pokeConfig.enableMemeReply, pokeConfig.memeReplyProbability);
  const inferredEmotion = inferPokeEmotion(primaryReply);
  let voiceSent = false;

  if (shouldSendVoice) {
    const speakTool = getTtsTools().find(item => item.name === 'speak_text');
    if (speakTool?.handler) {
      const voiceResult = await speakTool.handler({
        text: primaryReply,
        force: true,
        emotion: inferredEmotion.voiceEmotion,
      }, {
        event: e,
        groupId: e.group_id,
        userId: e.operator_id,
        targetMessage: { content: `${await getOperatorName(e)} 戳了你一下` },
        promptCtx: { replyContext: { type: 'poked' } },
      });
      if (voiceResult?.success && voiceResult.voiceMessage?.audioUrl) {
        const adapter = await YunzaiUtils.getAdapter(e);
        await Group.sendGroupRecord(e, e.group_id, voiceResult.voiceMessage.audioUrl, adapter);
        voiceSent = true;
      }
    }
  }

  if (enableTextReply && !voiceSent) {
    const parsedMessages = await ResponseHandler.processResponse(
      replyTexts.join('\n\n'),
      String(e.msg || ''),
      e.group_id,
      e.user_id
    );

    for (const message of parsedMessages) {
      if (message?.type === 'message') {
        if (!message.data) continue;
        await e.reply(message.data, false, 110);
      } else if (message?.type === 'poke') {
        if (String(message.id) === String(e.self_id)) continue;
        await Group.groupPoke(e, message.id, e.group_id);
      } else if (message?.type === 'at') {
        if (String(message.id) === String(e.self_id)) continue;
        await e.reply(segment.at(message.id));
      }
      await tool.sleep(200);
    }
  }

  if (shouldSendMeme) {
    try {
      const emotion = pokeConfig.pokeMemeEmotion && pokeConfig.pokeMemeEmotion !== 'default'
        ? pokeConfig.pokeMemeEmotion
        : inferredEmotion.memeEmotion;
      const memeUrl = await Meme.getMeme(botCharacter, emotion);
      if (memeUrl) {
        await e.reply(segment.image(memeUrl));
      }
    } catch (error) {
      logger.warn(`[poke] 发送戳一戳表情包失败: ${error.message}`);
    }
  }
}

function getPokeFallbackReply(maxReplies = 2) {
  const pokeConfig = configControl.get('poke') || {};
  const aiConfig = configControl.get('ai') || {};
  const configuredReply = String(pokeConfig.fallbackReply || aiConfig.fallbackReply || '').trim();
  return sanitizePokeReply(configuredReply || '我在。', maxReplies);
}

async function getPokeReplyText(e) {
  const pokeConfig = configControl.get('poke') || {};
  const replyMode = normalizeReplyMode(pokeConfig);
  const maxReplies = Math.max(1, Number(pokeConfig.maxReplyMessages || 1));

  const fallbackReply = async () => {
    const remoteReply = await fetchRemotePokeReply(maxReplies);
    return remoteReply || getPokeFallbackReply(maxReplies);
  };

  if (replyMode === 'ai') {
    const aiReply = await generateAiPokeReply(e, pokeConfig);
    if (aiReply) {
      logger.info(`[poke] 使用AI生成戳一戳回复: ${aiReply}`);
      return aiReply;
    }
    return await fallbackReply();
  }

  if (replyMode === 'normal') {
    return await fallbackReply();
  }

  const aiReply = await generateAiPokeReply(e, pokeConfig);
  if (aiReply) {
    logger.info(`[poke] 使用AI生成戳一戳回复: ${aiReply}`);
    return aiReply;
  }

  return await fallbackReply();
}

async function generateAiPokeReply(e, pokeConfig) {
  const profileConfig = configControl.get('profile') || {};
  const aiConfig = configControl.get('ai') || {};
  const usageControl = configControl.get('coreConfig')?.usageControl || {};
  const maxReplies = Math.max(1, Number(pokeConfig.maxReplyMessages || 1));
  const breaker = shouldCircuitBreakSync(usageControl, 'poke');
  if (breaker.blocked) {
    logger.warn(`[poke] 戳一戳AI已熔断: ${breaker.reason}`);
    return '';
  }
  const botName = profileConfig.nickName || '晶灵';
  const operatorName = await getOperatorName(e);
  const groupName = e?.group?.info?.group_name || e?.group_name || '当前群聊';
  const context = await getRecentPokeContext(e);
  const model = context.useMultimodal
    ? (aiConfig.multimodalModel || pokeConfig.model || aiConfig.workingModel || aiConfig.modelType)
    : (pokeConfig.model || aiConfig.workingModel || aiConfig.modelType);
  const systemPrompt = renderPokePrompt(pokeConfig.prompt, {
    botName,
    operatorName,
    groupName,
    operatorId: String(e.operator_id || ''),
  });
  const replyInstruction = maxReplies > 1
    ? `请最多输出 ${maxReplies} 条短句，并使用空行或 \\n---\\n 分隔成多条消息，不要编号。`
    : '请只输出 1 条短句。';
  const emojiInstruction = aiConfig?.emojiSuppression ? '不要使用任何 Unicode emoji 字符。' : '';
  const prompt = [
    replyInstruction,
    emojiInstruction,
    `${operatorName} 刚刚戳了你一下，请立即回复一句。`,
    context.lines.length > 0 ? `最近群聊上下文：\n${context.lines.join('\n')}` : '',
    context.latestImageUrls.length > 0 ? '最近一条消息包含图片，请结合图片内容和上下文自然回复。' : '',
    context.latestImageSenderId ? `最近图片发送者：${context.latestImageSenderName || `QQ${context.latestImageSenderId}`}（ID：${context.latestImageSenderId}）` : '',
    context.latestImageSource === 'operator_recent' ? '本次优先使用了戳你的人最近发的图片。' : '',
    context.latestImageSource === 'group_recent' ? '本次未找到戳你的人发图，已回退到群里最近图片。' : '',
    context.latestImageSummary ? `图片内容摘要：${context.latestImageSummary}` : '',
  ].filter(Boolean).join('\n\n');

  const messages = context.useMultimodal
    ? [{
        role: 'system',
        content: systemPrompt,
      }, {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...context.latestImageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
        ],
      }]
    : null;

  const result = await AiCaller.callAiDirect(prompt, [], [], null, [], {
    systemPrompt,
    model,
    temperature: pokeConfig.temperature ?? 0.9,
    max_tokens: pokeConfig.maxTokens ?? 80,
    messages,
    scene: 'poke_ai_reply',
    sessionId: e?.group_id ? `poke:${e.group_id}` : `poke:${e?.operator_id || 'unknown'}`,
    groupId: e?.group_id,
    userId: e?.operator_id,
  });

  if (!result?.success) {
    logger.warn(`[poke] AI生成戳一戳回复失败: ${result?.error || 'unknown error'}`);
    setPokeDebugSnapshot(e.group_id, {
      lastAction: 'poke_ai_failed',
      lastError: result?.error || 'unknown error',
    });
    return '';
  }

  setPokeDebugSnapshot(e.group_id, {
    lastAction: 'poke_ai_success',
    lastPrompt: prompt,
    lastReply: result.response || '',
    lastContextLines: context.lines,
    lastImageUrls: context.latestImageUrls,
    lastImageSenderId: context.latestImageSenderId,
    lastImageSenderName: context.latestImageSenderName,
    lastImageSource: context.latestImageSource,
    lastImageSummary: context.latestImageSummary,
    useMultimodal: context.useMultimodal,
  });
  return sanitizePokeReply(result.response, maxReplies);
}

async function fetchRemotePokeReply(maxReplies = 2) {
  try {
    const nickName = configControl.get('profile')?.nickName;
    const legacyCoreUrl = configControl.get('coreConfig')?.coreUrl;
    const targetUrl = `${legacyCoreUrl}/api/words/getText`;
    const res = await axios.post(targetUrl, {
      type: 'poke',
      id: 'poke',
      name: nickName,
    });

    if (res.data.success) {
      return sanitizePokeReply(res.data.data, maxReplies);
    }
  } catch (error) {
    logger.warn(`[poke] 从旧核心兼容服务获取普通戳一戳文案失败: ${error.message}`);
  }

  return '';
}

async function getOperatorName(e) {
  try {
    const member = await e.group?.pickMember?.(e.operator_id);
    const info = await member?.getInfo?.();
    return info?.card || info?.nickname || member?.card || member?.nickname || e.sender?.nickname || `QQ${e.operator_id}`;
  } catch {
    return e.sender?.card || e.sender?.nickname || `QQ${e.operator_id}`;
  }
}

function renderPokePrompt(template, vars) {
  const source = typeof template === 'string' && template.trim()
    ? template
    : '你是{{botName}}，正在群里被 {{operatorName}}(QQ:{{operatorId}}) 戳了一下。请像群友一样立刻回一句自然、短促、有点情绪的吐槽或互动话，不要解释，不要自我分析，不要使用列表，不要超过两句话。可以轻微调侃对方，但不要攻击、辱骂或过度重复。若已知群名为 {{groupName}}，可在语气上贴合群聊氛围。';

  return source.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '');
}

function sanitizePokeReply(text, maxReplies = 2) {
  if (typeof text !== 'string') {
    return '';
  }

  const normalizedMaxReplies = Math.max(1, Number(maxReplies || 1));
  const segments = text
    .replace(/\r/g, '')
    .split(/\n---\n|\n{2,}/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => line.includes('\n') ? line.split('\n').map(item => item.trim()).filter(Boolean) : [line])
    .slice(0, normalizedMaxReplies);

  return applyEmojiSuppression(
    segments
      .join('\n\n')
      .slice(0, 120)
      .trim()
  );
}

function normalizeReplyMode(pokeConfig) {
  const mode = String(pokeConfig?.replyMode || '').trim().toLowerCase();
  if (mode === 'ai' || mode === 'normal' || mode === 'auto') {
    return mode;
  }

  if (pokeConfig?.aiReply === false) {
    return 'normal';
  }

  return 'auto';
}
