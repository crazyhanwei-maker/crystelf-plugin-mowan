import ConfigControl from '../lib/config/configControl.js';
import cfg from '../../../lib/config/config.js';
import { defaultConfig as pluginDefaultConfig } from '../constants/path.js';
import SessionManager, { RateLimiter, MessageQueueManager, SkillSessionManager } from '../lib/ai/sessionManager.js';
import AiCaller from '../lib/ai/aiCaller.js';
import MemorySystem from '../lib/ai/memorySystem.js';
import Renderer from '../lib/ai/renderer.js';
import Meme from '../lib/core/meme.js';
import Group from '../lib/yunzai/group.js';
import Message from '../lib/yunzai/message.js';
import ResponseHandler, { normalizeOutgoingMessageForSend } from '../lib/ai/responseHandler.js';
import YunzaiUtils from '../lib/yunzai/utils.js';
import { initDatabase } from '../lib/ai/chatDatabase.js';
import { HumanizeEngine } from '../lib/humanize/index.js';
import { runChat, shouldForceSearch } from '../lib/ai/chatEngine.js';
import { shouldCircuitBreakSync } from '../lib/ai/usageLogger.js';
import { resolvePreferredMemeCharacter } from '../lib/ai/personaIdentity.js';
import affinityManager from '../lib/ai/affinityManager.js';
import { clearSessionDebugSnapshot, setSessionDebugSnapshot } from '../lib/ai/runtimeDebugStore.js';
import { processPokeFollowUpMessage } from './poke.js';
import { shouldHideAiFailureReason } from '../lib/ai/userFacingError.js';
import {
  clearPrivateAiSafetyRecords,
  evaluatePrivateAiSafety,
  formatPrivateAiSafetyBlacklist,
  formatPrivateAiSafetyStatus,
  unblockPrivateAiSafetyUser,
} from '../lib/ai/privateAiSafety.js';
import { segment } from 'oicq';
import tools from '../components/tool.js';
import {
  handleDirectVoiceCommand as handleSharedDirectVoiceCommand,
  handleDirectVoiceEvent,
  parseDirectVoiceCommand,
  sendVoiceMessage,
} from '../lib/ai/ttsSynthesisCommand.js';
import { getTtsTools, listTtsModels } from '../lib/ai/ttsRegistry.js';
import { getGroupVoiceModel } from '../lib/ai/ttsGroupModelStore.js';
import {
  clearPrivateVoiceModel,
  getPrivateVoiceModel,
  getPrivateVoiceModelRecord,
  setPrivateVoiceModel,
} from '../lib/ai/ttsPrivateModelStore.js';
import {
  resetVoiceModel,
  selectPendingVoiceModel,
  showCurrentVoiceModel,
  showVoiceModelList,
  switchVoiceModelDirectly,
} from '../lib/ai/ttsVoiceModelCommand.js';
import { loadAutoSessionSkills } from '../lib/ai/httpSkillRegistry.js';

const nickname = await ConfigControl.get('profile')?.nickName;

const humanizeAiAdapter = {
  generateText: async (opts) => {
    const result = await AiCaller.callAiDirect(opts.prompt, [], [], null, [], {
      ...opts,
      scene: opts.scene || 'humanize_generate',
    });
    return result.response || '';
  },
  complete: async (opts) => {
    return await AiCaller.callAiComplete({
      ...opts,
      scene: opts.scene || 'humanize_complete',
    });
  }
};

function getBotUin(e) {
  return e?.bot?.uin || e?.self_id || e?.bot_id || Bot?.uin || null;
}

function isAtBot(message, e) {
  const botUin = getBotUin(e);
  return message?.type === 'at' && botUin !== null && String(message.qq) === String(botUin);
}

function isBotUser(userId, e) {
  const botUin = getBotUin(e);
  return botUin !== null && String(userId) === String(botUin);
}

function isNicknameMentioned(text, aiConfig) {
  const lowerText = String(text || '').toLowerCase();
  if (!lowerText) return false;

  const names = [nickname]
    .filter(Boolean)
    .map(name => String(name).toLowerCase());

  return names.some(name => lowerText.includes(name));
}

function sanitizeAssistantHistoryContent(text = '') {
  return String(text || '')
    .replace(/\[\[\[at:\d+\]\]\]/g, '')
    .replace(/\(\(\(at:\d+\)\)\)/g, '')
    .replace(/\(\(\(\d+\)\)\)/g, '')
    .replace(/\[\[\[poke:\d+\]\]\]/g, '')
    .replace(/\(\(\(poke:\d+\)\)\)/g, '')
    .replace(/\[\[\[reply:[^\]]+\]\]\]/g, '')
    .replace(/\(\(\(reply:[^)]+\)\)\)/g, '')
    .replace(/\[\[\[memory:[^\]]+\]\]\]/g, '')
    .replace(/\[meme:[^\]]+\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

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

function applyEmojiSuppression(text = '', aiConfig = {}) {
  if (!aiConfig?.emojiSuppression) {
    return String(text || '');
  }

  return stripEmojiCharacters(text);
}

function getFollowUpConfig(aiConfig) {
  return {
    enabled: aiConfig?.followUp?.enabled !== false,
    windowMs: aiConfig?.followUp?.windowMs || 180000,
    maxMessages: aiConfig?.followUp?.maxMessages || 8,
  };
}

function shouldObserveGroupMessage(e, aiConfig) {
  if (!e?.isGroup && !e?.group_id) return false;
  if (e?.crystelfTriggeredByRule) return true;
  if (isBotUser(e?.user_id, e)) return false;
  if (isNicknameMentioned(e?.msg, aiConfig)) return true;

  if (Array.isArray(e?.message) && e.message.some(message => isAtBot(message, e))) {
    return true;
  }

  return false;
}

function hasRecentBotActivity(lastBotTime, aiConfig) {
  const followUpConfig = getFollowUpConfig(aiConfig);
  if (!followUpConfig.enabled) return false;
  if (!lastBotTime) return false;
  return Date.now() - lastBotTime <= followUpConfig.windowMs;
}

function isCommandPrefixedMessage(text = '') {
  return /^(#|＃|\/)/.test(String(text || '').trim());
}

function hasImageGenerationIntent(text = '') {
  const content = String(text || '').trim();
  if (!content) return false;
  const compact = content.replace(/\s+/g, '');
  if (/(不要|不用|别|不能|无法|不会|没法).{0,12}(生成|画|绘制|做|制作|出).{0,30}(图|图片|图像|照片|插画|壁纸|头像|表情包)/.test(compact)) {
    return false;
  }

  return [
    /(?:生成|生|画|绘制|做|制作|出)(?:一|1|几|多)?(?:张|幅|个|组)?[^，。！？\n]{0,80}(?:图|图片|图像|照片|插画|壁纸|头像|表情包)/,
    /(?:帮我|给我|请|麻烦你)?(?:来|整|搞)(?:一|1|几|多)?(?:张|幅|个|组)?[^，。！？\n]{0,60}(?:图|图片|图像|照片|插画|壁纸|头像|表情包)/,
    /(?:生图|出图|作图|制图)(?:吧|一下|试试)?$/,
  ].some(pattern => pattern.test(content));
}

function getPrivateAiCapabilities(config = {}) {
  return {
    image: config.privateAiImage !== false,
    voice: config.privateAiVoice !== false,
    meme: config.privateAiMeme !== false,
    skills: config.privateAiSkills !== false,
  };
}

function normalizePrivateAiAccessList(value = []) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/\r?\n|[,，;；\s]+/);
  return Array.from(new Set(items
    .map(item => String(item || '').trim())
    .filter(item => /^[1-9]\d{4,12}$/.test(item))));
}

function getPrivateAiAccessDecision(config = {}, e = {}) {
  const userId = String(e?.user_id || '').trim();
  if (!userId) {
    return { allow: false, reason: '缺少用户 ID', replyText: '私聊 AI 暂不可用。' };
  }
  if (isMasterUser(e)) {
    return { allow: true, reason: '主人绕过私聊名单限制' };
  }
  const blacklist = normalizePrivateAiAccessList(config.privateAiBlacklist);
  if (blacklist.includes(userId)) {
    return { allow: false, reason: '命中私聊 AI 手动黑名单', replyText: '你暂时没有使用私聊 AI 的权限。' };
  }
  const whitelist = normalizePrivateAiAccessList(config.privateAiWhitelist);
  if (whitelist.length > 0 && !whitelist.includes(userId)) {
    return { allow: false, reason: '不在私聊 AI 白名单', replyText: '你暂时没有使用私聊 AI 的权限。' };
  }
  return { allow: true, reason: whitelist.length > 0 ? '命中私聊 AI 白名单' : '私聊 AI 未限制用户范围' };
}

function isPrivateAiRoutableMessage(content = '', e = {}, directVoiceText = '') {
  if (!isCommandPrefixedMessage(content)) return true;
  return Boolean(
    directVoiceText
    || /^[#＃/]?灵晶\s*(改图|融合)(?:[：:，,\s]+)?([\s\S]*)$/i.test(String(content || '').trim())
    || isPrivateVoiceModelCommand(content, e)
    || parseSessionControlCommand(content)
    || isChatHelpRequest(content)
    || /^(#|\/)?重置(对话|会话)$/.test(content)
    || /^(#|\/)?(查看)?会话状态([\s\S]*)?$/.test(content)
  );
}

function isImageGenerationRequest(text) {
  const content = String(text || '').trim();
  if (!content) return false;
  if (isCommandPrefixedMessage(content)) return false;
  if (/(^|\s)[#＃/](绘图|画图)(?=\s|$)/.test(content)) return false;
  return ['生成图片', '画一张', '帮我画', '画个', '画一幅', '改图'].some(keyword => content.includes(keyword))
    || hasImageGenerationIntent(content);
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPlainTextFromEvent(e) {
  const textFromSegments = Array.isArray(e?.message)
    ? e.message
        .filter(message => message?.type === 'text' && message.text)
        .map(message => String(message.text || ''))
        .join('')
        .trim()
    : '';
  if (textFromSegments) return textFromSegments;
  return String(e?.msg || '').replace(/\[CQ:[^\]]+\]/g, '').trim();
}

function normalizeImagePromptText(text = '', e = null) {
  const raw = String(text || '').trim();
  const plain = extractPlainTextFromEvent(e);
  let content = plain || raw;
  const saidMatches = [...raw.matchAll(/\[[^\]\n]+,id:\d+,seq:\d+\]说:([^\n]+)/g)]
    .map(match => String(match[1] || '').trim())
    .filter(Boolean);
  if (!plain && saidMatches.length > 0) {
    content = saidMatches.join('\n');
  }

  content = String(content || '')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const botNames = [nickname].filter(Boolean).map(name => String(name).trim()).filter(Boolean);
  for (const botName of botNames.sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`^${escapeRegExp(botName)}[\\s,，:：。！!、-]*`);
    const withoutName = content.replace(pattern, '').trim();
    if (withoutName && withoutName !== content && hasImageGenerationIntent(withoutName)) {
      content = withoutName;
      break;
    }
  }

  return content || raw;
}

function parseImageEditCommand(e = {}) {
  const content = extractPlainTextFromEvent(e);
  const match = content.match(/^[#＃\/]?灵晶\s*(改图|融合)(?:[：:，,\s]+)?([\s\S]*)$/i);
  if (!match) return null;
  return {
    operation: match[1] === '融合' ? 'fusion' : 'edit',
    prompt: String(match[2] || '').trim(),
  };
}

function appendImageUrls(target = [], messageSegments = []) {
  for (const segmentItem of Array.isArray(messageSegments) ? messageSegments : []) {
    if (segmentItem?.type !== 'image') continue;
    const imageUrl = String(segmentItem.url || '').trim();
    if (imageUrl) target.push(imageUrl);
  }
}

async function collectSourceImageUrls(e = {}) {
  const imageUrls = [];
  appendImageUrls(imageUrls, e.message);

  if (e.source || e.reply_id) {
    let reply = null;
    if (typeof e.getReply === 'function') {
      reply = await e.getReply();
    } else if (e.source?.seq && typeof e.group?.getChatHistory === 'function') {
      const history = await e.group.getChatHistory(e.source.seq, 1);
      reply = Array.isArray(history) ? history.at(-1) : null;
    }
    if (reply) {
      appendImageUrls(imageUrls, Array.isArray(reply) ? reply : reply.message);
    }
  }

  return Array.from(new Set(imageUrls));
}

function isImageFollowUpRequest(text = '') {
  return /(这(图|张图)|刚才.*图|上面.*图|那张图|图片里|图里|发了什么图片|什么图片)/i.test(String(text || '').trim());
}

async function getRecentChatImageContext(e) {
  try {
    const history = await e.group?.getChatHistory?.(e.message_id || 0, 8);
    const normalized = (Array.isArray(history) ? history : [])
      .map(item => {
        const msgArr = Array.isArray(item?.message) ? item.message : [];
        const imageUrls = msgArr.filter(msg => msg.type === 'image' && msg.url).map(msg => msg.url);
        return {
          userId: item?.user_id,
          nickname: item?.sender?.card || item?.sender?.nickname || `QQ${item?.user_id || '未知'}`,
          imageUrls,
          time: Number(item?.time || 0),
          messageId: item?.message_id || 0,
        };
      })
      .filter(item => item.imageUrls.length > 0 && String(item.userId) !== String(e.self_id))
      .sort((a, b) => a.time - b.time);

    const latestSameUserImage = [...normalized].reverse().find(item => String(item.userId) === String(e.user_id));
    const latestWithImage = latestSameUserImage || normalized.at(-1);
    if (!latestWithImage) return [];
    return latestWithImage.imageUrls.slice(0, 1).map(url => ({
      url,
      promptText: `[${e.sender?.nickname || '用户'}]刚才发过一张图片，可结合这张最近图片理解当前提问\n`,
    }));
  } catch (error) {
    logger.warn(`[crystelf-ai] 获取最近图片上下文失败: ${error.message}`);
    return [];
  }
}

function parseRuntimeKnowledgeBase(value = '') {
  return String(value || '')
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const [title = `知识片段${index + 1}`, maybeTags = '', ...rest] = lines;
      const hasTagsLine = /^标签[:：]/.test(maybeTags);
      return {
        id: `knowledge-${index + 1}`,
        title,
        tags: (hasTagsLine ? maybeTags.replace(/^标签[:：]/, '').split(/[，,]/) : []).map(item => item.trim()).filter(Boolean),
        content: ((hasTagsLine ? rest : [maybeTags, ...rest]).join('\n').trim()) || title,
      };
    })
    .slice(0, 100);
}

function tokenizeKnowledgeQuery(value = '') {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return [];
  const stopWords = new Set(['是谁', '什么', '怎么', '为何', '为什么', '多少', '一下', '一个', '这个', '那个', '一下子']);
  const tokens = new Set();
  const phraseMatches = text.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/g) || [];
  phraseMatches.forEach(token => {
    if (!stopWords.has(token)) tokens.add(token);
  });
  const compact = text.replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  if (/^[\u4e00-\u9fa5]+$/.test(compact) && compact.length >= 2) {
    for (let size = Math.min(4, compact.length); size >= 2; size--) {
      for (let index = 0; index <= compact.length - size; index++) {
        const token = compact.slice(index, index + size);
        if (!stopWords.has(token)) tokens.add(token);
      }
    }
  }
  return Array.from(tokens);
}

function retrieveRuntimeKnowledge(query = '', knowledgeItems = [], topK = 3) {
  const queryTokens = tokenizeKnowledgeQuery(query);
  if (queryTokens.length === 0 || knowledgeItems.length === 0) {
    return [];
  }
  return knowledgeItems
    .map(item => {
      const haystack = `${item.title}\n${item.content}`.toLowerCase();
      const lowerTitle = String(item.title || '').toLowerCase();
      const matchedTokens = queryTokens.filter(token => haystack.includes(token));
      const titleHits = queryTokens.filter(token => lowerTitle.includes(token));
      const tagHits = (item.tags || []).filter(tag => queryTokens.some(token => String(tag).toLowerCase().includes(token)));
      const exactTitleHit = lowerTitle && String(query || '').toLowerCase().includes(lowerTitle);
      return {
        ...item,
        matchedTokens,
        score: matchedTokens.length + titleHits.length * 3 + tagHits.length * 2 + (exactTitleHit ? 10 : 0),
      };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function buildRuntimeKnowledgeContext(matches = []) {
  if (!Array.isArray(matches) || matches.length === 0) return '';
  return [
    '## Local Knowledge Base',
    'Relevant context retrieved from the configured local knowledge base:',
    ...matches.map((item, index) => `${index + 1}. 标题:${item.title}${item.tags?.length ? `\n标签:${item.tags.join(',')}` : ''}\n内容:${item.content}`),
  ].join('\n');
}

function isChatHelpRequest(text = '') {
  const normalized = String(text || '').toLowerCase();
  return /你能做什么|你会什么|怎么用|如何使用|帮助|help|有哪些功能|能干嘛/.test(normalized);
}

function buildChatHelpMessage(aiConfig = {}) {
  const lines = [
    '# 晶灵帮助菜单',
    '',
    '> 直接选你要用的功能，就像点菜单一样。',
    '',
    '## 01｜聊天',
    '- 群聊问答 / 日常陪聊 / 接梗接话',
    '',
    '## 02｜查询',
    `- ${aiConfig?.knowledgeBaseEnabled ? '知识库问答' : '知识库问答（按配置启用）'}`,
    '- 联网搜索 / 网页总结',
    '',
    '## 03｜多媒体',
    '- 图片理解 / 生图改图',
    '- 表情包回复 / 语音朗读',
    '',
    '## 快捷示例',
    '- 帮我查一下今天的更新公告',
    '- 根据知识库告诉我怎么开启验证',
    '- 帮我总结这个网页讲了什么',
    '- 我刚发了一张什么图片',
    '- #合成语音今天也要好好休息',
    '',
    '## 管理命令',
    '- #查看功能开关',
    '- #开启戳一戳 / #关闭戳一戳',
    '- #开启全部功能 / #关闭全部功能',
    '- #开启全部AI相关功能 / #关闭全部AI相关功能',
    '- #开启私聊AI / #关闭私聊AI',
    '- #开启全部群管相关功能 / #关闭全部群管相关功能',
    '- #开启全部内容功能 / #关闭全部内容功能',
    '- #开启全部互动功能 / #关闭全部互动功能',
    '- #开启全部娱乐功能 / #关闭全部娱乐功能',
    '- #重置功能开关',
    '- #查看已关闭功能',
    '- #只开启AI / #只保留群管功能',
    '- #备份功能开关 / #恢复功能开关',
    '- #导出功能开关 / #导出功能开关备份',
    '',
    '## 使用提示',
    '- 发图后可以直接追问“这是什么图”',
    '- 想测语音时可以发送“#合成语音要读出来的内容”',
    '- 如果管理员配置了知识库，我会优先参考知识库回答',
    '- 管理命令仅主人可用',
  ];
  return lines.join('\n');
}

function buildChatFallbackMessage({ knowledgeEnabled = false, knowledgeMatched = 0, failureReason = '', toolHints = [], hideFailureReason = false } = {}) {
  const aiConfig = ConfigControl.get('ai') || {};
  const customFallbackReply = pickFallbackReply(aiConfig?.fallbackReply);
  const customSearchFallbackReply = pickFallbackReply(aiConfig?.fallbackSearchReply);
  const customTimeoutFallbackReply = pickFallbackReply(aiConfig?.fallbackTimeoutReply);
  const customGenericFallbackReply = pickFallbackReply(aiConfig?.fallbackGenericReply);
  const hiddenFailureReason = shouldHideAiFailureReason(failureReason);
  const shouldUseGenericFailure = hideFailureReason || hiddenFailureReason;

  if (failureReason) {
    if (shouldUseGenericFailure) {
      if (/搜索|网页|markdown|search_web|fetch_web_markdown/i.test(failureReason)) {
        if (customSearchFallbackReply) {
          return customSearchFallbackReply;
        }
        if (customFallbackReply) {
          return customFallbackReply;
        }
        return '外部检索未完成。你可以稍后再试，或改用更短、更明确的问法。';
      }
      if (/超时|timeout|timed out/i.test(failureReason)) {
        if (customTimeoutFallbackReply) {
          return customTimeoutFallbackReply;
        }
        if (customFallbackReply) {
          return customFallbackReply;
        }
        return '本次处理超时。你可以把问题拆短后重新发送。';
      }
      if (customGenericFallbackReply) {
        return customGenericFallbackReply;
      }
      if (customFallbackReply) {
        return customFallbackReply;
      }
      return '本次未生成有效回复。请换个更直接的问法后重试。';
    }
    if (/搜索|网页|markdown|search_web|fetch_web_markdown/i.test(failureReason)) {
      if (customSearchFallbackReply) {
        return customSearchFallbackReply;
      }
      if (customFallbackReply) {
        return customFallbackReply;
      }
      return '外部检索未完成。你可以稍后再试，或改用更短、更明确的问法。';
    }
    if (/超时|timeout|timed out/i.test(failureReason)) {
      if (customTimeoutFallbackReply) {
        return customTimeoutFallbackReply;
      }
      if (customFallbackReply) {
        return customFallbackReply;
      }
      return '本次处理超时。你可以把问题拆短后重新发送。';
    }
    if (customGenericFallbackReply) {
      return customGenericFallbackReply;
    }
    if (customFallbackReply) {
      return customFallbackReply;
    }
    return `本次处理失败：${failureReason}`;
  }
  if (knowledgeEnabled && knowledgeMatched === 0) {
    if (customFallbackReply) {
      return customFallbackReply;
    }
    return '本次未命中本地知识库，将按通用理解回答。你可以补充更贴近知识库的关键词。';
  }
  if (toolHints.length > 0) {
    if (hideFailureReason) {
      if (customGenericFallbackReply) {
        return customGenericFallbackReply;
      }
      if (customFallbackReply) {
        return customFallbackReply;
      }
      return '本次处理未得到稳定结果，请稍后重试。';
    }
    if (customGenericFallbackReply) {
      return customGenericFallbackReply;
    }
    if (customFallbackReply) {
      return customFallbackReply;
    }
    return `本次处理未得到稳定结果。当前状态：${toolHints.slice(-2).join('；')}`;
  }
  if (customGenericFallbackReply) {
    return customGenericFallbackReply;
  }
  if (customFallbackReply) {
    return customFallbackReply;
  }
  return '本次未生成有效回复。请换个更直接的问法后重试。';
}

function pickFallbackReply(value) {
  const pool = String(value || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
  if (pool.length === 0) return '';
  return pool[Math.floor(Math.random() * pool.length)] || '';
}

function isTimeoutFailureReason(reason = '') {
  return /超时|timeout|timed out|time out|abort/i.test(String(reason || '').trim());
}

function buildImageFallbackMessage({ aiConfig = {}, imageConfig = {}, failureReason = '' } = {}) {
  const imageFallbackReply = pickFallbackReply(imageConfig?.fallbackReply);
  const imageTimeoutFallbackReply = pickFallbackReply(imageConfig?.fallbackTimeoutReply);
  const globalFallbackReply = pickFallbackReply(aiConfig?.fallbackReply);
  const globalTimeoutFallbackReply = pickFallbackReply(aiConfig?.fallbackTimeoutReply);

  if (isTimeoutFailureReason(failureReason)) {
    return imageTimeoutFallbackReply
      || globalTimeoutFallbackReply
      || imageFallbackReply
      || globalFallbackReply
      || '图像生成超时。请稍后重试，或把要求说短一点。';
  }

  return imageFallbackReply
    || globalFallbackReply
    || '图像生成失败，稍后再试。';
}

function parseSessionControlCommand(text = '') {
  const content = String(text || '').trim();
  const normalized = content.replace(/^[@＃#\/\s]+/, '');
  const rules = [
    { pattern: /^(本轮|当前会话)?(不要|关闭|禁用)联网$/, patch: { disableSearch: true }, reply: '已在当前会话禁用联网搜索。' },
    { pattern: /^(本轮|当前会话)?(恢复|开启|允许)联网$/, patch: { disableSearch: false }, reply: '已在当前会话恢复联网搜索。' },
    { pattern: /^(本轮|当前会话)?只用知识库$/, patch: { knowledgeOnly: true, disableSearch: true }, reply: '已在当前会话切换为仅使用本地知识库。' },
    { pattern: /^(本轮|当前会话)?恢复正常模式$/, patch: { knowledgeOnly: false, disableSearch: false, responseStyle: '' }, reply: '已在当前会话恢复为正常聊天模式。' },
    { pattern: /^(本轮|当前会话)?简洁回答$/, patch: { responseStyle: 'concise' }, reply: '已在当前会话切换为简洁回答。' },
    { pattern: /^(本轮|当前会话)?详细回答$/, patch: { responseStyle: 'detailed' }, reply: '已在当前会话切换为详细回答。' },
    { pattern: /^(暂停|关闭)接话$/, patch: { pauseFollowUp: true }, reply: '已暂停自动接话。' },
    { pattern: /^(恢复|开启)接话$/, patch: { pauseFollowUp: false }, reply: '已恢复自动接话。' },
  ];
  for (const rule of rules) {
    if (rule.pattern.test(normalized)) {
      return rule;
    }
  }
  return null;
}

function isMasterUser(e) {
  const masterList = Array.isArray(cfg?.masterQQ) ? cfg.masterQQ.map(item => String(item)) : [];
  return masterList.includes(String(e?.user_id || ''));
}

function parseFeatureToggleCommand(text = '') {
  const normalized = String(text || '').trim().replace(/^[#＃/]+/, '');
  if (/^(查看|查询)功能开关$/i.test(normalized)) {
    return { type: 'status' };
  }

  if (/^(功能开关帮助|管理命令列表|列出所有管理命令|主人命令帮助|管理帮助)$/i.test(normalized)) {
    return { type: 'help' };
  }

  if (/^(查看|查询)已关闭功能$/i.test(normalized)) {
    return { type: 'disabled_status' };
  }

  if (/^(导出|查看)功能开关备份$/i.test(normalized)) {
    return { type: 'export_backup' };
  }

  if (/^(导出|查看)功能开关$/i.test(normalized)) {
    return { type: 'export' };
  }

  if (/^重置功能开关$/i.test(normalized)) {
    return { type: 'reset' };
  }

  if (/^备份功能开关$/i.test(normalized)) {
    return { type: 'backup' };
  }

  if (/^恢复功能开关$/i.test(normalized)) {
    return { type: 'restore' };
  }

  const exclusiveMatch = normalized.match(/^(只开启AI|只保留群管功能)$/i);
  if (exclusiveMatch) {
    const command = exclusiveMatch[1];
    const commandMap = {
      '只开启AI': {
        label: '只开启AI',
        enableKeys: ['ai', 'privateAi'],
      },
      '只保留群管功能': {
        label: '只保留群管功能',
        enableKeys: ['auth', 'welcome', 'groupManagement', 'groupTitle'],
      },
    };
    const target = commandMap[command];
    if (target) {
      return {
        type: 'exclusive',
        label: target.label,
        enableKeys: target.enableKeys,
      };
    }
  }

  const allMatch = normalized.match(/^(开启|关闭)(全部功能)$/i);
  if (allMatch) {
    return {
      type: 'batch',
      enabled: allMatch[1] === '开启',
      label: '全部功能',
      keys: ['poke', '60s', 'zwa', 'rss', 'help', 'welcome', 'faceReply', 'imageMonitor', 'ai', 'privateAi', 'privateAiImage', 'privateAiVoice', 'privateAiMeme', 'privateAiSkills', 'music', 'voiceModel', 'auth', 'groupManagement', 'groupTitle'],
    };
  }

  const categoryMatch = normalized.match(/^(开启|关闭)(全部AI相关功能|全部群管相关功能|全部内容功能|全部互动功能)$/i);
  if (categoryMatch) {
    const enabled = categoryMatch[1] === '开启';
    const category = categoryMatch[2];
    const categoryMap = {
      '全部AI相关功能': {
        label: '全部AI相关功能',
        keys: ['ai', 'privateAi', 'privateAiImage', 'privateAiVoice', 'privateAiMeme', 'privateAiSkills', 'help', 'imageMonitor', 'faceReply', 'voiceModel'],
      },
      '全部群管相关功能': {
        label: '全部群管相关功能',
        keys: ['auth', 'welcome', 'groupManagement', 'groupTitle'],
      },
      '全部内容功能': {
        label: '全部内容功能',
        keys: ['help', 'rss', 'music', 'faceReply'],
      },
      '全部互动功能': {
        label: '全部互动功能',
        keys: ['poke', 'welcome', 'ai', 'privateAi', 'privateAiImage', 'privateAiVoice', 'privateAiMeme', 'privateAiSkills', 'zwa'],
      },
    };
    const target = categoryMap[category];
    if (target) {
      return {
        type: 'batch',
        enabled,
        label: target.label,
        keys: target.keys,
      };
    }
  }

  const batchMatch = normalized.match(/^(开启|关闭)(全部娱乐功能)$/i);
  if (batchMatch) {
    return {
      type: 'batch',
      enabled: batchMatch[1] === '开启',
      label: '全部娱乐功能',
      keys: ['poke', 'music', 'faceReply'],
    };
  }

  const match = normalized.match(/^(开启|关闭)(戳一戳|帮助|欢迎|图片监控|验证|群管理|头衔|群头衔|AI|私聊AI|私聊生图|私聊语音|私聊表情包|私聊工具|私聊联网|音乐|语音模型|订阅|表情回复|60s|早晚安|自动更新)$/i);
  if (!match) return null;

  const action = match[1] === '开启';
  const featureName = match[2];
  const featureMap = {
    '戳一戳': { key: 'poke', label: '戳一戳' },
    '帮助': { key: 'help', label: '帮助' },
    '欢迎': { key: 'welcome', label: '欢迎' },
    '图片监控': { key: 'imageMonitor', label: '图片监控' },
    '验证': { key: 'auth', label: '验证' },
    '群管理': { key: 'groupManagement', label: '群管理' },
    '头衔': { key: 'groupTitle', label: '头衔' },
    '群头衔': { key: 'groupTitle', label: '群头衔' },
    'AI': { key: 'ai', label: 'AI' },
    '私聊AI': { key: 'privateAi', label: '私聊AI' },
    '私聊生图': { key: 'privateAiImage', label: '私聊生图' },
    '私聊语音': { key: 'privateAiVoice', label: '私聊语音' },
    '私聊表情包': { key: 'privateAiMeme', label: '私聊表情包' },
    '私聊工具': { key: 'privateAiSkills', label: '私聊工具' },
    '私聊联网': { key: 'privateAiSkills', label: '私聊联网' },
    '音乐': { key: 'music', label: '音乐' },
    '语音模型': { key: 'voiceModel', label: '语音模型' },
    '订阅': { key: 'rss', label: '订阅' },
    '表情回复': { key: 'faceReply', label: '表情回复' },
    '60s': { key: '60s', label: '60s' },
    '早晚安': { key: 'zwa', label: '早晚安' },
    '自动更新': { key: 'autoUpdate', label: '自动更新' },
  };

  const target = featureMap[featureName];
  if (!target) return null;
  return {
    type: 'single',
    enabled: action,
    key: target.key,
    label: target.label,
  };
}

function buildFeatureToggleStatus(config = {}) {
  const lines = [
    '当前功能开关：',
    `- 戳一戳：${config.poke === false ? '关闭' : '开启'}`,
    `- 60s：${config['60s'] === false ? '关闭' : '开启'}`,
    `- 早晚安：${config.zwa === false ? '关闭' : '开启'}`,
    `- 订阅：${config.rss === false ? '关闭' : '开启'}`,
    `- 帮助：${config.help === false ? '关闭' : '开启'}`,
    `- 欢迎：${config.welcome === false ? '关闭' : '开启'}`,
    `- 自动更新：${config.autoUpdate === false ? '关闭' : '开启'}`,
    `- 图片监控：${config.imageMonitor === true ? '开启' : '关闭'}`,
    `- 验证：${config.auth === false ? '关闭' : '开启'}`,
    `- 群管理：${config.groupManagement === false ? '关闭' : '开启'}`,
    `- 群头衔：${config.groupTitle === false ? '关闭' : '开启'}`,
    `- AI：${config.ai === false ? '关闭' : '开启'}`,
    `- 私聊AI：${config.privateAi === false ? '关闭' : '开启'}`,
    `- 私聊生图：${config.privateAiImage === false ? '关闭' : '开启'}`,
    `- 私聊语音：${config.privateAiVoice === false ? '关闭' : '开启'}`,
    `- 私聊表情包：${config.privateAiMeme === false ? '关闭' : '开启'}`,
    `- 私聊联网与 Skills：${config.privateAiSkills === false ? '关闭' : '开启'}`,
    `- 私聊名单：白名单 ${normalizePrivateAiAccessList(config.privateAiWhitelist).length || '不限'} / 黑名单 ${normalizePrivateAiAccessList(config.privateAiBlacklist).length}`,
    `- 私聊安全：${config.privateAiSafety?.enabled === false ? '关闭' : '开启'}`,
    `- 音乐：${config.music === false ? '关闭' : '开启'}`,
    `- 语音模型：${config.voiceModel === false ? '关闭' : '开启'}`,
    `- 表情回复：${config.faceReply === false ? '关闭' : '开启'}`,
  ];
  return lines.join('\n');
}

function buildFeatureToggleCommandHelp() {
  return [
    '# 主人功能开关菜单',
    '',
    '> 下面这些命令只给主人用，用来快速开关插件功能。',
    '',
    '## 查看',
    '- #查看功能开关',
    '- #查看已关闭功能',
    '',
    '## 单项开关',
    '- #开启戳一戳 / #关闭戳一戳',
    '- #开启AI / #关闭AI',
    '- #开启私聊AI / #关闭私聊AI',
    '- #开启私聊生图 / #关闭私聊生图',
    '- #开启私聊语音 / #关闭私聊语音',
    '- #开启私聊表情包 / #关闭私聊表情包',
    '- #开启私聊联网 / #关闭私聊联网',
    '- #开启语音模型 / #关闭语音模型',
    '- #开启欢迎 / #关闭欢迎',
    '- #开启群管理 / #关闭群管理',
    '- #开启群头衔 / #关闭群头衔',
    '',
    '## 批量开关',
    '- #开启全部功能 / #关闭全部功能',
    '- #开启全部AI相关功能 / #关闭全部AI相关功能',
    '- #开启全部群管相关功能 / #关闭全部群管相关功能',
    '- #开启全部内容功能 / #关闭全部内容功能',
    '- #开启全部互动功能 / #关闭全部互动功能',
    '- #开启全部娱乐功能 / #关闭全部娱乐功能',
    '',
    '## 快捷模式',
    '- #只开启AI',
    '- #只保留群管功能',
    '',
    '## 私聊安全',
    '- #灵晶私聊安全状态',
    '- #灵晶私聊黑名单',
    '- #灵晶解除私聊黑名单 QQ号',
    '- #灵晶清空私聊安全记录',
    '',
    '## 备份管理',
    '- #备份功能开关 / #恢复功能开关',
    '- #导出功能开关 / #导出功能开关备份',
    '- #重置功能开关',
    '',
    '## 提示',
    '- 上面这些命令仅主人可用',
    '- 想先保存当前状态，建议先执行一次 #备份功能开关',
  ].join('\n');
}

const PRIVATE_VOICE_MODEL_PENDING_TTL_MS = 3 * 60 * 1000;
const PRIVATE_VOICE_MODEL_LIST_LIMIT = 40;
const privateVoiceModelPendingSelections = new Map();

function getPrivateVoiceModelPendingKey(e = {}) {
  return String(e?.user_id || '').trim();
}

function prunePrivateVoiceModelPendingSelections() {
  const now = Date.now();
  for (const [key, pending] of privateVoiceModelPendingSelections.entries()) {
    if (!pending || Number(pending.expiresAt || 0) <= now) {
      privateVoiceModelPendingSelections.delete(key);
    }
  }
}

function hasPrivateVoiceModelPendingSelection(e = {}) {
  prunePrivateVoiceModelPendingSelections();
  return privateVoiceModelPendingSelections.has(getPrivateVoiceModelPendingKey(e));
}

function normalizeVoiceModelLookupText(value = '') {
  return String(value || '')
    .trim()
    .replace(/[「」『』【】《》〈〉()（）\[\]_\-\s]/g, '')
    .toLowerCase();
}

function describePrivateVoiceModel(item = {}) {
  const languages = Array.isArray(item.languages) ? item.languages : [];
  if (languages.length === 0) {
    return item.model || '-';
  }

  const first = languages[0] || {};
  const emotionText = Array.isArray(first.emotions) && first.emotions.length > 0
    ? first.emotions.slice(0, 4).join('、')
    : '默认';
  const extraLanguageCount = Math.max(0, languages.length - 1);
  const suffix = extraLanguageCount > 0 ? `，另 ${extraLanguageCount} 种语言` : '';
  return `${item.model}（${first.language || '未知'}：${emotionText}${suffix}）`;
}

function formatPrivateVoiceModelList(result = {}, currentModel = '') {
  const models = Array.isArray(result.models) ? result.models : [];
  const lines = [
    '请选择你的私聊默认语音模型：',
    currentModel ? `当前私聊：${currentModel}` : `当前私聊：使用全局默认${result.defaultModel ? `（${result.defaultModel}）` : ''}`,
    '',
    ...models.slice(0, PRIVATE_VOICE_MODEL_LIST_LIMIT).map((item, index) => `${index + 1}. ${describePrivateVoiceModel(item)}`),
  ];

  if (models.length > PRIVATE_VOICE_MODEL_LIST_LIMIT) {
    lines.push(`... 还有 ${models.length - PRIVATE_VOICE_MODEL_LIST_LIMIT} 个模型未展示，可用完整模型名直接切换。`);
  }

  lines.push('', '回复编号即可切换，也可以发送：#灵晶切换语音模型 模型名');
  lines.push('发送 #灵晶重置语音模型 可回到全局默认。');
  return lines.join('\n');
}

function resolvePrivateVoiceModelInput(input = '', models = []) {
  const value = String(input || '').trim();
  if (!value) {
    return { ok: false, error: '请输入模型编号或模型名。' };
  }

  if (/^\d{1,3}$/.test(value)) {
    const index = Number(value);
    if (index < 1 || index > Math.min(models.length, PRIVATE_VOICE_MODEL_LIST_LIMIT)) {
      return { ok: false, error: `编号超出范围，请输入 1-${Math.min(models.length, PRIVATE_VOICE_MODEL_LIST_LIMIT)}。` };
    }
    return { ok: true, model: models[index - 1]?.model || '' };
  }

  const exact = models.find(item => String(item.model || '').trim() === value);
  if (exact) {
    return { ok: true, model: exact.model };
  }

  const lowerValue = value.toLowerCase();
  const caseInsensitive = models.find(item => String(item.model || '').trim().toLowerCase() === lowerValue);
  if (caseInsensitive) {
    return { ok: true, model: caseInsensitive.model };
  }

  const normalizedValue = normalizeVoiceModelLookupText(value);
  const normalizedMatches = models.filter(item => {
    const model = normalizeVoiceModelLookupText(item.model);
    return model && normalizedValue && model.includes(normalizedValue);
  });
  if (normalizedMatches.length === 1) {
    return { ok: true, model: normalizedMatches[0].model };
  }
  if (normalizedMatches.length > 1) {
    return {
      ok: false,
      error: [
        '匹配到多个模型，请输入更完整的模型名：',
        ...normalizedMatches.slice(0, 8).map((item, index) => `${index + 1}. ${item.model}`),
      ].join('\n'),
    };
  }

  return { ok: false, error: '没有找到这个语音模型，请先发送 #灵晶切换语音模型 查看列表。' };
}

function parsePrivateVoiceModelSwitchInput(e = {}) {
  return String(e.msg || '')
    .replace(/^[#＃/]?灵晶\s*切换语音模型\s*/u, '')
    .trim();
}

function isPrivateVoiceModelCommand(content = '', e = null) {
  const text = String(content || '').trim();
  if (/^[#＃/]?灵晶\s*(语音模型|切换语音模型|重置语音模型)(?:\s+[\s\S]+)?$/.test(text)) {
    return true;
  }
  return Boolean(e) && /^\d{1,3}$/.test(text) && hasPrivateVoiceModelPendingSelection(e);
}

async function loadPrivateVoiceModelList() {
  const result = await listTtsModels();
  if (!result?.success) {
    return {
      success: false,
      error: result?.error || '读取语音模型列表失败',
    };
  }

  return {
    success: true,
    defaultModel: result.defaultModel || '',
    models: Array.isArray(result.models) ? result.models : [],
  };
}

function buildDisabledFeatureStatus(config = {}) {
  const entries = [
    ['戳一戳', config.poke !== false],
    ['60s', config['60s'] !== false],
    ['早晚安', config.zwa !== false],
    ['订阅', config.rss !== false],
    ['帮助', config.help !== false],
    ['欢迎', config.welcome !== false],
    ['自动更新', config.autoUpdate !== false],
    ['图片监控', config.imageMonitor === true],
    ['验证', config.auth !== false],
    ['群管理', config.groupManagement !== false],
    ['群头衔', config.groupTitle !== false],
    ['AI', config.ai !== false],
    ['私聊AI', config.privateAi !== false],
    ['私聊生图', config.privateAiImage !== false],
    ['私聊语音', config.privateAiVoice !== false],
    ['私聊表情包', config.privateAiMeme !== false],
    ['私聊联网与 Skills', config.privateAiSkills !== false],
    ['私聊安全', config.privateAiSafety?.enabled !== false],
    ['音乐', config.music !== false],
    ['语音模型', config.voiceModel !== false],
    ['表情回复', config.faceReply !== false],
  ];
  const disabled = entries.filter(([, enabled]) => !enabled).map(([label]) => `- ${label}`);
  return disabled.length > 0 ? ['当前已关闭功能：', ...disabled].join('\n') : '当前所有功能均处于开启状态。';
}

function normalizeFeatureToggleBackup(raw = {}) {
  if (!raw || typeof raw !== 'object') {
    return { config: {}, savedAt: '' };
  }
  if (raw.config && typeof raw.config === 'object') {
    return {
      config: extractManagedFeatureConfig(raw.config),
      savedAt: String(raw.savedAt || ''),
    };
  }
  return {
    config: extractManagedFeatureConfig(raw),
    savedAt: '',
  };
}

function extractManagedFeatureConfig(config = {}) {
  const result = {};
  for (const key of getManagedFeatureKeys()) {
    result[key] = config[key];
  }
  return result;
}

function buildFeatureToggleExport(config = {}, title = '功能开关导出') {
  return [title, '```json', JSON.stringify(extractManagedFeatureConfig(config), null, 2), '```'].join('\n');
}

function createFeatureToggleBackupPayload(config = {}) {
  return {
    savedAt: new Date().toISOString(),
    config: extractManagedFeatureConfig(config),
  };
}

function buildDefaultFeatureConfig() {
  const defaults = pluginDefaultConfig || {};
  return {
    poke: defaults.poke !== false,
    '60s': defaults['60s'] !== false,
    zwa: defaults.zwa !== false,
    rss: defaults.rss !== false,
    help: defaults.help !== false,
    welcome: defaults.welcome !== false,
    faceReply: defaults.faceReply !== false,
    imageMonitor: defaults.imageMonitor === true,
    ai: defaults.ai !== false,
    privateAi: defaults.privateAi !== false,
    privateAiImage: defaults.privateAiImage !== false,
    privateAiVoice: defaults.privateAiVoice !== false,
    privateAiMeme: defaults.privateAiMeme !== false,
    privateAiSkills: defaults.privateAiSkills !== false,
    music: defaults.music !== false,
    voiceModel: defaults.voiceModel !== false,
    auth: defaults.auth !== false,
    groupManagement: defaults.groupManagement !== false,
    groupTitle: defaults.groupTitle !== false,
    autoUpdate: defaults.autoUpdate !== false,
  };
}

function getManagedFeatureKeys() {
  return ['poke', '60s', 'zwa', 'rss', 'help', 'welcome', 'faceReply', 'imageMonitor', 'ai', 'privateAi', 'privateAiImage', 'privateAiVoice', 'privateAiMeme', 'privateAiSkills', 'music', 'voiceModel', 'auth', 'groupManagement', 'groupTitle', 'autoUpdate'];
}

function mergeSessionControlState(base = {}, patch = {}) {
  return {
    disableSearch: patch.disableSearch ?? base.disableSearch ?? false,
    knowledgeOnly: patch.knowledgeOnly ?? base.knowledgeOnly ?? false,
    responseStyle: patch.responseStyle ?? base.responseStyle ?? '',
    pauseFollowUp: patch.pauseFollowUp ?? base.pauseFollowUp ?? false,
  };
}

function buildSessionControlPrompt(state = {}) {
  const lines = [];
  if (state.disableSearch) lines.push('当前会话禁止联网搜索，不要调用 search_web 或 fetch_web_markdown。');
  if (state.knowledgeOnly) lines.push('当前会话优先只使用本地知识库回答；若知识库未命中，就明确说明而不要联网扩展。');
  if (state.responseStyle === 'concise') lines.push('当前会话请尽量简洁回答，优先用 1 到 2 句话说清重点。');
  if (state.responseStyle === 'detailed') lines.push('当前会话请适度详细回答，在必要时补充分点解释。');
  return lines.join('\n');
}

function normalizeDecisionSource(source = '') {
  const value = String(source || '').trim();
  if (!value) return 'direct';
  return value;
}

function resolveDecisionTriggerReason(source, { ruleTriggered, atBot, nicknameMentioned, followUpActive }) {
  switch (source) {
    case 'follow_up':
      return '命中连续对话窗口，按接话逻辑继续回复';
    case 'cooldown_replay':
      return '冷却结束后重新处理积压消息';
    case 'delayed_batch':
      return '群内过于活跃，延迟聚合后再统一回复';
    case 'queued_replay':
      return '上一轮处理中，本条消息在队列中等待后补处理';
    case 'nickname':
      return '消息里提到了机器人昵称';
    case 'direct':
    default:
      if (ruleTriggered) return '命中了 AI 触发规则';
      if (atBot) return '用户直接 @ 机器人';
      if (nicknameMentioned) return '消息里提到了机器人昵称';
      if (followUpActive) return '命中连续对话窗口';
      return '进入常规对话处理流程';
  }
}

function buildDecisionExplanation({
  e,
  aiConfig,
  options = {},
  history = [],
  sessionControl = {},
  knowledgeMatches = [],
  memoryContext = '',
  affinityContext = '',
  topicContext = '',
  expressionContext = '',
  userProfileContext = '',
  pendingImageUrls = [],
  ttsConfig = {},
  groupLastBotTime = 0,
  messageCountAfterBot = 0,
  result = {},
}) {
  const followUpConfig = getFollowUpConfig(aiConfig);
  const ruleTriggered = Boolean(e?.crystelfTriggeredByRule);
  const atBot = Array.isArray(e?.message) && e.message.some(message => isAtBot(message, e));
  const nicknameMentioned = isNicknameMentioned(e?.msg, aiConfig);
  const followUpActive = Boolean(
    followUpConfig.enabled &&
    groupLastBotTime &&
    Date.now() - groupLastBotTime <= followUpConfig.windowMs &&
    messageCountAfterBot > 0 &&
    messageCountAfterBot <= followUpConfig.maxMessages
  );
  const source = normalizeDecisionSource(
    options.decisionSource ||
    (followUpActive ? 'follow_up' : nicknameMentioned ? 'nickname' : 'direct')
  );

  return {
    trigger: {
      source,
      reason: resolveDecisionTriggerReason(source, {
        ruleTriggered,
        atBot,
        nicknameMentioned,
        followUpActive,
      }),
      ruleTriggered,
      atBot,
      nicknameMentioned,
      followUpEnabled: Boolean(followUpConfig.enabled),
      followUpActive,
      followUpPaused: Boolean(sessionControl.pauseFollowUp),
      followUpWindowMs: Number(followUpConfig.windowMs || 0),
      followUpMaxMessages: Number(followUpConfig.maxMessages || 0),
      timeSinceLastBotMs: groupLastBotTime ? Date.now() - groupLastBotTime : 0,
      messageCountAfterBot: Number(messageCountAfterBot || 0),
      customReason: String(options.triggerReason || '').trim(),
    },
    context: {
      historyCount: Array.isArray(history) ? history.length : 0,
      knowledgeEnabled: Boolean(aiConfig?.knowledgeBaseEnabled),
      knowledgeMatchCount: Array.isArray(knowledgeMatches) ? knowledgeMatches.length : 0,
      knowledgeTitles: Array.isArray(knowledgeMatches)
        ? knowledgeMatches.map(item => item?.title).filter(Boolean).slice(0, 5)
        : [],
      memoryUsed: Boolean(memoryContext),
      affinityUsed: Boolean(affinityContext),
      topicUsed: Boolean(topicContext),
      expressionUsed: Boolean(expressionContext),
      userProfileUsed: Boolean(userProfileContext),
      imageContextCount: Array.isArray(pendingImageUrls) ? pendingImageUrls.length : 0,
    },
    sessionControl: {
      disableSearch: Boolean(sessionControl.disableSearch),
      knowledgeOnly: Boolean(sessionControl.knowledgeOnly),
      responseStyle: sessionControl.responseStyle || 'normal',
      pauseFollowUp: Boolean(sessionControl.pauseFollowUp),
    },
    capabilities: {
      forceSearch: shouldForceSearch({ content: e?.msg || '' }),
      multimodalInput: Array.isArray(pendingImageUrls) && pendingImageUrls.length > 0,
      toolStatusHintsEnabled: Boolean(aiConfig?.toolStatusHints),
      knowledgeDebugHintsEnabled: Boolean(aiConfig?.knowledgeDebugHints),
      ttsAllowed: Boolean(ttsConfig?.allowAiTrigger),
    },
    result: {
      status: result.status || 'running',
      hasTextOutput: Boolean(result.hasTextOutput),
      hasVoiceOutput: Boolean(result.hasVoiceOutput),
      hasEmojiOutput: Boolean(result.hasEmojiOutput),
      toolCallCount: Number(result.toolCallCount || 0),
      toolNames: Array.isArray(result.toolNames) ? result.toolNames : [],
      failureReason: result.failureReason || '',
      fallbackUsed: Boolean(result.fallbackUsed),
      invalidChatResult: Boolean(result.invalidChatResult),
    },
  };
}

function createEventSnapshot(e, content) {
  return {
    group_id: e?.group_id,
    group_name: e?.group?.info?.group_name || e?.group_name,
    user_id: e?.user_id,
    message_id: e?.message_id,
    msg: content ?? e?.msg ?? '',
    sender: {
      nickname: e?.sender?.nickname,
      card: e?.sender?.card,
      role: e?.sender?.role,
      title: e?.sender?.title,
    },
    self_id: e?.self_id,
    bot_id: e?.bot_id,
    isGroup: true,
    crystelfTriggeredByRule: Boolean(e?.crystelfTriggeredByRule),
    message: [
      {
        type: 'text',
        text: content ?? e?.msg ?? '',
      },
    ],
  };
}

function restoreEventFromSnapshot(snapshot) {
  const bot = Bot;
  const group = bot?.pickGroup?.(snapshot.group_id);

  return {
    ...snapshot,
    bot,
    group,
    reply: async (message) => {
      if (group?.sendMsg) {
        return await group.sendMsg(message);
      }
      return null;
    },
  };
}

export class crystelfAI extends plugin {
  constructor() {
    super({
      name: 'crystelfAI',
      dsc: '晶灵智能',
      event: 'message.group',
      priority: -1111,
      rule: [
        {
          reg: '^[#＃/]?灵晶\\s*(改图|融合)(?:[：:，,\\s]+)?([\\s\\S]*)$',
          fnc: 'imageEditCommand',
        },
        {
          reg: `^${nickname}([\\s\\S]*)?$`,
          fnc: 'in',
        },
        {
          reg: '^(#|/)?合成语音[：:，,\\s]*([\\s\\S]*)$',
          fnc: 'synthesizeVoiceCommand',
        },
        {
          reg: '^[#＃/]?灵晶\\s*语音模型\\s*$',
          fnc: 'showVoiceModelCommand',
        },
        {
          reg: '^[#＃/]?灵晶\\s*切换语音模型\\s*$',
          fnc: 'showVoiceModelListCommand',
        },
        {
          reg: '^[#＃/]?灵晶\\s*切换语音模型\\s+([\\s\\S]+)$',
          fnc: 'switchVoiceModelCommand',
        },
        {
          reg: '^[#＃/]?灵晶\\s*重置语音模型\\s*$',
          fnc: 'resetVoiceModelCommand',
        },
        {
          reg: '^\\d{1,3}$',
          fnc: 'selectVoiceModelCommand',
        },
        {
          reg: '^[\\s\\S]*$',
          fnc: 'watchGroupMessage',
        },
        {
          reg: '^(#|/)?重置(对话|会话)$',
          fnc: 'clearChatHistory',
        },
        {
          reg: '^(#|/)?(查看)?好感度([\s\S]*)?$',
          fnc: 'showAffinity',
        },
        {
          reg: '^(#|/)?重置好感度([\s\S]*)?$',
          fnc: 'resetAffinity',
        },
        {
          reg: '^(#|/)?好感排行([\s\S]*)?$',
          fnc: 'showAffinityRanking',
        },
        {
          reg: '^(#|/)?(查看)?用户画像([\s\S]*)?$',
          fnc: 'showUserProfile',
        },
        {
          reg: '^(#|/)?(查看)?会话状态([\s\S]*)?$',
          fnc: 'showSessionStatus',
        },
        {
          reg: '^(#|/)?(查看)?知识命中([\s\S]*)?$',
          fnc: 'showKnowledgeDebug',
        },
        {
          reg: '^(#|/)?(查看)?工具调用([\s\S]*)?$',
          fnc: 'showRecentToolCalls',
        },
      ],
    });
    if (global.crystelfAiSingleton) {
      return global.crystelfAiSingleton;
    }
    this.isInitialized = false;
    global.crystelfAiSingleton = this;
  }

  async init() {
    if (this.initPromise) {
      return await this.initPromise;
    }

    this.initPromise = (async () => {
    try {
      logger.info('[crystelf-ai] 开始初始化…');
      
      const config = await ConfigControl.get('ai');
      
      this.db = await initDatabase();
      this.sessionManager = new SessionManager(this.db, config?.maxSessions || 100);
      this.rateLimiter = new RateLimiter({ dynamicDelay: config?.dynamicDelay || {} });
      this.queueManager = new MessageQueueManager();
      this.skillManager = new SkillSessionManager();
      
      this.humanize = new HumanizeEngine(
        humanizeAiAdapter,
        config,
        this.db
      );
      await this.humanize.init();
      
      AiCaller.init();
      MemorySystem.init();
      Renderer.init();
      
      this.groupLastActivityTime = new Map();
      this.groupMessageCount = new Map();
      this.groupLastBotMessageTime = new Map();
      this.groupMessageCountAfterBot = new Map();
      this.groupCooldownUntil = new Map();
      this.groupCooldownMessages = new Map();
      this.cooldownTimeoutIds = new Map();
      this.dynamicDelayQueues = new Map();
      this.processingSet = new Set();
      this.idleCheckProcessing = new Set();
      this.groupLastIdleCheckTime = new Map();
      this.sessionControlState = new Map();
      this.sessionLastKnowledgeMatches = new Map();
      this.sessionLastToolCalls = new Map();
      
      this.startIdleCheckInterval();
      
      this.isInitialized = true;
      logger.info('[crystelf-ai] 初始化完成');
    } catch (error) {
      logger.error(`[crystelf-ai] 初始化失败: ${error.message}`);
      throw error;
    } finally {
      this.initPromise = null;
    }
    })();

    return await this.initPromise;
  }

  startIdleCheckInterval() {
    this.idleCheckInterval = setInterval(async () => {
      try {
        const config = await ConfigControl.get('ai');
        if (!config?.planner?.enabled) return;

        this.cleanupGroupState(config);

        const now = Date.now();
        const idleThreshold = config.planner.idleThresholdMs ?? 1800000;
        const messageCountThreshold = config.planner.idleMessageCount ?? 100;

        for (const [groupSessionId, lastTime] of this.groupLastActivityTime) {
          const lastCheckTime = this.groupLastIdleCheckTime.get(groupSessionId) ?? 0;
          if (now - lastCheckTime < 60000) continue;

          if (this.processingSet.has(groupSessionId) || this.idleCheckProcessing.has(groupSessionId)) {
            continue;
          }

          const groupId = parseInt(groupSessionId.split(':')[1], 10);
          if (!this.isGroupAllowed(groupId, config)) continue;

          let lastBotTime = this.groupLastBotMessageTime.get(groupSessionId) ?? 0;
          if (lastBotTime === 0) {
            const botMsgs = this.db.getBotMessages(groupId, 1);
            if (botMsgs.length > 0) {
              lastBotTime = botMsgs[botMsgs.length - 1].timestamp;
              this.groupLastBotMessageTime.set(groupSessionId, lastBotTime);
            }
          }

          const lastActivityTime = Math.max(lastTime, lastBotTime);
          if (now - lastActivityTime < idleThreshold) continue;

          const messageCountAfterBot = this.groupMessageCountAfterBot.get(groupSessionId) ?? 0;
          const messageCount = lastBotTime > 0 ? messageCountAfterBot : (this.groupMessageCount.get(groupSessionId) ?? 0);
          if (messageCount < messageCountThreshold) continue;

          this.idleCheckProcessing.add(groupSessionId);

          try {
            logger.info(`[IdleCheck] 群 ${groupId} 触发空闲检测`);
            await this.handleIdleCheck(groupSessionId, groupId, config);
            this.groupMessageCount.set(groupSessionId, 0);
            this.groupMessageCountAfterBot.set(groupSessionId, 0);
            this.groupLastIdleCheckTime.set(groupSessionId, now);
          } catch (err) {
            logger.error(`[IdleCheck] 群 ${groupId} 空闲检测失败: ${err}`);
          } finally {
            this.idleCheckProcessing.delete(groupSessionId);
          }
        }
      } catch (err) {}
    }, 60000);
  }

  async handleIdleCheck(groupSessionId, groupId, config) {
    const history = this.db.getMessages(groupSessionId, config.chatHistory || 30);
    const botNickname = nickname || 'Bot';

    const planResult = await this.humanize.actionPlanner.plan(
      groupSessionId,
      botNickname,
      history,
      '[检查是否想要发言]',
      true
    );

    if (planResult.action === 'reply') {
      const targetMessage = {
        userName: 'system',
        userId: 0,
        userRole: 'member',
        content: '[群里没人说话了？我来凑个热闹！]',
        messageId: 0,
        timestamp: Date.now(),
      };

      const toolCtx = {
        sessionId: groupSessionId,
        groupId,
        defaultVoiceModel: getGroupVoiceModel(groupId),
        config,
        db: this.db,
        pendingImageUrls: [],
        skillManager: this.skillManager,
      };

      await loadAutoSessionSkills(this.skillManager, groupSessionId);

      const promptCtx = {
        config,
        botNickname,
        botRole: 'member',
        isGroup: true,
        replyContext: { type: 'idle' },
        skillContext: this.skillManager.getActiveSkillsInfo(groupSessionId),
      };

      const result = await runChat(
        humanizeAiAdapter,
        toolCtx,
        history,
        targetMessage,
        promptCtx,
        this.humanize
      );

      if (result.messages && result.messages.length > 0) {
        for (const msg of result.messages) {
          await this.sendGroupMessage(groupId, msg);
        }
      }

      this.startCooldownTimer(groupSessionId, groupId);
    }
  }

  isGroupAllowed(groupId, config) {
    const normalizedGroupId = String(groupId ?? '').trim();
    const blockGroups = Array.isArray(config?.blockGroup)
      ? config.blockGroup.map(id => String(id ?? '').trim())
      : [];
    const whiteGroups = Array.isArray(config?.whiteGroup)
      ? config.whiteGroup.map(id => String(id ?? '').trim())
      : [];
    if (blockGroups.includes(normalizedGroupId)) return false;
    if (whiteGroups.length > 0 && !whiteGroups.includes(normalizedGroupId)) return false;
    return true;
  }

  async in(e) {
    if (!this.isInitialized) {
      await this.init();
    }
    e.crystelfTriggeredByRule = true;
    return await this.handleMessage(e);
  }

  async watchGroupMessage(e) {
    if (!this.isInitialized) {
      await this.init();
    }
    const aiConfig = await ConfigControl.get('ai');
    const commandPrefixed = isCommandPrefixedMessage(e?.msg);
    if (commandPrefixed) {
      return false;
    }
    const pokeHandled = await processPokeFollowUpMessage(e).catch(() => false);
    if (pokeHandled) {
      return true;
    }
    const groupSessionId = `group:${e.group_id}`;
    if (this.sessionControlState?.get(groupSessionId)?.pauseFollowUp && !shouldObserveGroupMessage(e, aiConfig)) {
      return false;
    }
    const lastBotTime = this.groupLastBotMessageTime?.get(groupSessionId) ?? 0;
    if (!shouldObserveGroupMessage(e, aiConfig) && !hasRecentBotActivity(lastBotTime, aiConfig)) {
      return false;
    }
    return await this.handleMessage(e);
  }

  async synthesizeVoiceCommand(e) {
    if (!this.isInitialized) {
      await this.init();
    }
    return handleDirectVoiceEvent(e);
  }

  async imageEditCommand(e) {
    if (!this.isInitialized) {
      await this.init();
    }
    const command = parseImageEditCommand(e);
    if (!command) return false;
    if (!command.prompt) {
      const example = command.operation === 'fusion'
        ? '#灵晶融合 把两张图片融合成自然的合影'
        : '#灵晶改图 把背景改成樱花海，保持人物不变';
      await e.reply(`请写明图片处理要求。\n示例：${example}`, true);
      return true;
    }

    const sourceImageArr = await collectSourceImageUrls(e);
    const minimumImages = command.operation === 'fusion' ? 2 : 1;
    if (sourceImageArr.length < minimumImages) {
      const guidance = command.operation === 'fusion'
        ? '请在同一条消息中发送至少两张图片，或回复一条包含多张图片的消息。'
        : '请在消息中附带图片，或回复需要修改的图片。';
      await e.reply(`${guidance}\n示例：${command.operation === 'fusion' ? '#灵晶融合 融合成一张自然合影' : '#灵晶改图 把背景改成樱花海'}`, true);
      return true;
    }
    if (sourceImageArr.length > 14) {
      await e.reply(`参考图共有 ${sourceImageArr.length} 张，当前最多支持 14 张，请减少图片后重试。`, true);
      return true;
    }

    await this.handleImageMessage(e, {
      type: 'image',
      data: command.prompt,
      sourceImageArr,
      requireSourceImages: true,
      at: -1,
      quote: -1,
      recall: false,
    });
    return true;
  }

  async showVoiceModelCommand(e) {
    return showCurrentVoiceModel(e);
  }

  async showVoiceModelListCommand(e) {
    return showVoiceModelList(e);
  }

  async switchVoiceModelCommand(e) {
    return switchVoiceModelDirectly(e);
  }

  async resetVoiceModelCommand(e) {
    return resetVoiceModel(e);
  }

  async selectVoiceModelCommand(e) {
    return selectPendingVoiceModel(e);
  }

  async showHelp(e) {
    if (!this.isInitialized) {
      await this.init();
    }
    const aiConfig = await ConfigControl.get('ai');
    await this.sendResponse(e, [{
      type: 'markdown',
      data: buildChatHelpMessage(aiConfig),
      at: -1,
      quote: -1,
      recall: false,
    }], aiConfig);
    return true;
  }

  async clearChatHistory(e) {
    const groupSessionId = `group:${e.group_id}`;
    let session = this.sessionManager.getOrCreate(
      groupSessionId,
      'group',
      e.group_id
    );
    if (!session) return e.reply(`当前有群友正在和${nickname}聊天，请等待会话结束。`, true);
    this.sessionManager.clearSession(groupSessionId);
    this.groupLastActivityTime?.delete(groupSessionId);
    this.groupMessageCount?.delete(groupSessionId);
    this.groupLastBotMessageTime?.delete(groupSessionId);
    this.groupMessageCountAfterBot?.delete(groupSessionId);
    this.groupCooldownUntil?.delete(groupSessionId);
    this.groupCooldownMessages?.delete(groupSessionId);
    this.cooldownTimeoutIds?.delete(groupSessionId);
    this.dynamicDelayQueues?.delete(groupSessionId);
    this.groupLastIdleCheckTime?.delete(groupSessionId);
    this.sessionControlState?.delete(groupSessionId);
    clearSessionDebugSnapshot(groupSessionId);
    this.processingSet?.delete(groupSessionId);
    this.idleCheckProcessing?.delete(groupSessionId);
    this.queueManager?.clearQueue(groupSessionId);
    this.queueManager?.clearActiveTarget(groupSessionId);
    this.rateLimiter?.clearGroupInteractions?.(String(e.group_id));
    return e.reply('聊天已重置，本群当前会话记录与相关状态已清空。', true);
  }

  async showAffinity(e) {
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      const aiConfig = await ConfigControl.get('ai');
      const affinityConfig = aiConfig?.affinity || {};
      if (affinityConfig.enabled === false) {
        return e.reply('当前未启用好感度系统。', true);
      }

      let targetUserId = e.user_id;
      if (Array.isArray(e.message)) {
        const atMessage = e.message.find(message => message.type === 'at' && !isBotUser(message.qq, e));
        if (atMessage?.qq) {
          targetUserId = Number(atMessage.qq);
        }
      }

      const record = await affinityManager.getRecord(e.group_id, targetUserId, affinityConfig);
      const targetMember = targetUserId === e.user_id
        ? e.sender?.card || e.sender?.nickname || '你'
        : await e.group.pickMember(targetUserId).nickname || String(targetUserId);

      const levelDescMap = {
        冷淡: '当前更偏克制和疏离一点',
        普通: '当前是正常自然的互动状态',
        熟悉: '当前已经比较熟了，互动会更放松',
        亲近: '当前会更亲近更有温度一些',
      };

      const lines = [
        `${targetMember} 当前关系档位：${record.level}`,
        levelDescMap[record.level] || '当前是普通互动状态',
      ];

      if (record.last_reason) {
        lines.push(`最近一次变化原因：${record.last_reason}`);
      }

      if (record.interaction_count) {
        lines.push(`累计记录互动：${record.interaction_count} 次`);
      }

      return e.reply(lines.join('\n'), true);
    } catch (error) {
      logger.error(`[crystelf-ai] 查询好感度失败: ${error.message}`);
      return e.reply('查看好感度失败，稍后再试。', true);
    }
  }

  async showSessionStatus(e) {
    const groupSessionId = `group:${e.group_id}`;
    const state = this.sessionControlState?.get(groupSessionId) || {};
    const lines = [
      '当前会话状态：',
      `- 联网搜索：${state.disableSearch ? '已禁用' : '已允许'}`,
      `- 知识库模式：${state.knowledgeOnly ? '只用知识库' : '正常模式'}`,
      `- 回复风格：${state.responseStyle === 'concise' ? '简洁' : state.responseStyle === 'detailed' ? '详细' : '默认'}`,
      `- 自动接话：${state.pauseFollowUp ? '已暂停' : '正常'}`,
    ];
    return e.reply(lines.join('\n'), true);
  }

  async showKnowledgeDebug(e) {
    const groupSessionId = `group:${e.group_id}`;
    const matches = this.sessionLastKnowledgeMatches?.get(groupSessionId) || [];
    if (!matches.length) {
      return e.reply('最近一轮没有记录到知识库命中。', true);
    }
    const lines = ['最近一轮知识库命中：'];
    matches.slice(0, 5).forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}（得分 ${item.score ?? 0}）`);
    });
    return e.reply(lines.join('\n'), true);
  }

  async showRecentToolCalls(e) {
    const groupSessionId = `group:${e.group_id}`;
    const toolCalls = this.sessionLastToolCalls?.get(groupSessionId) || [];
    if (!toolCalls.length) {
      return e.reply('最近一轮没有工具调用记录。', true);
    }
    const lines = ['最近一轮工具调用：'];
    toolCalls.slice(0, 5).forEach((item, index) => {
      const success = item?.result?.success === false ? '失败' : '成功';
      lines.push(`${index + 1}. ${item.name} - ${success}`);
    });
    return e.reply(lines.join('\n'), true);
  }

  async resetAffinity(e) {
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      const aiConfig = await ConfigControl.get('ai');
      const affinityConfig = aiConfig?.affinity || {};
      if (affinityConfig.enabled === false) {
        return e.reply('当前未启用好感度系统。', true);
      }

      let targetUserId = e.user_id;
      if (Array.isArray(e.message)) {
        const atMessage = e.message.find(message => message.type === 'at' && !isBotUser(message.qq, e));
        if (atMessage?.qq) {
          targetUserId = Number(atMessage.qq);
        }
      }

      await affinityManager.resetRecord(e.group_id, targetUserId);
      const targetMember = targetUserId === e.user_id
        ? e.sender?.card || e.sender?.nickname || '你'
        : await e.group.pickMember(targetUserId).nickname || String(targetUserId);

      return e.reply(`已重置 ${targetMember} 的好感度记录。`, true);
    } catch (error) {
      logger.error(`[crystelf-ai] 重置好感度失败: ${error.message}`);
      return e.reply('重置好感度失败，稍后再试。', true);
    }
  }

  async showAffinityRanking(e) {
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      const aiConfig = await ConfigControl.get('ai');
      const affinityConfig = aiConfig?.affinity || {};
      if (affinityConfig.enabled === false) {
        return e.reply('当前未启用好感度系统。', true);
      }

      const ranking = await affinityManager.getGroupRanking(e.group_id, affinityConfig, 10);
      if (!ranking.length) {
        return e.reply('当前群还没有可展示的好感度记录。', true);
      }

      const lines = ['当前群好感排行：'];
      for (let i = 0; i < ranking.length; i++) {
        const item = ranking[i];
        let name = String(item.user_id);
        try {
          const member = await e.group.pickMember(Number(item.user_id));
          name = member?.card || member?.nickname || name;
        } catch {}

        lines.push(`${i + 1}. ${name} - ${item.level}（互动 ${item.interaction_count || 0} 次）`);
      }

      return e.reply(lines.join('\n'), true);
    } catch (error) {
      logger.error(`[crystelf-ai] 查询好感排行失败: ${error.message}`);
      return e.reply('查看好感排行失败，稍后再试。', true);
    }
  }

  async showUserProfile(e) {
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      const aiConfig = await ConfigControl.get('ai');
      const profileConfig = aiConfig?.userProfile || {};
      if (profileConfig.enabled === false) {
        return e.reply('当前未启用群内用户画像。', true);
      }

      const groupSessionId = `group:${e.group_id}`;
      let targetUserId = e.user_id;
      if (Array.isArray(e.message)) {
        const atMessage = e.message.find(message => message.type === 'at' && !isBotUser(message.qq, e));
        if (atMessage?.qq) {
          targetUserId = Number(atMessage.qq);
        }
      }

      const profile = this.humanize.userProfiler.getUserProfile(groupSessionId, targetUserId);
      if (!profile) {
        return e.reply('当前还没有这个成员的画像记录。可以先多聊一段时间后再查看。', true);
      }

      let targetMember = targetUserId === e.user_id
        ? e.sender?.card || e.sender?.nickname || '你'
        : String(targetUserId);
      try {
        const member = await e.group.pickMember(targetUserId);
        targetMember = member?.card || member?.nickname || targetMember;
      } catch {}

      const lines = [`${targetMember} 的群内用户画像：`];
      if (profile.summary) {
        lines.push(`概括：${profile.summary}`);
      }
      if (Array.isArray(profile.traits) && profile.traits.length > 0) {
        lines.push(`特征：${profile.traits.join('、')}`);
      }
      if (Array.isArray(profile.speakingStyle) && profile.speakingStyle.length > 0) {
        lines.push(`说话风格：${profile.speakingStyle.join('、')}`);
      }
      if (Array.isArray(profile.interactionPreferences) && profile.interactionPreferences.length > 0) {
        lines.push(`互动偏好：${profile.interactionPreferences.join('、')}`);
      }
      if (Array.isArray(profile.notableTopics) && profile.notableTopics.length > 0) {
        lines.push(`常聊话题：${profile.notableTopics.join('、')}`);
      }
      lines.push(`画像置信度：${profile.confidence || '中'}`);
      if (profile.sourceMessageCount) {
        lines.push(`参考消息数：${profile.sourceMessageCount}`);
      }

      return e.reply(lines.join('\n'), true);
    } catch (error) {
      logger.error(`[crystelf-ai] 查询用户画像失败: ${error.message}`);
      return e.reply('查看用户画像失败，稍后再试。', true);
    }
  }

  async handleMessage(e) {
    try {
      const config = await ConfigControl.get();
      const aiConfig = config?.ai;
      const usageControl = config?.coreConfig?.usageControl || {};
      const directVoiceText = parseDirectVoiceCommand(e.msg);
      const featureToggleCommand = parseFeatureToggleCommand(e.msg);
      if (!aiConfig) return;

      if (!this.isGroupAllowed(e.group_id, aiConfig)) return;
      if (isBotUser(e.user_id, e)) return;
      const breaker = shouldCircuitBreakSync(usageControl, 'chat');
      if (breaker.blocked) {
        logger.warn(`[crystelf-ai] 聊天AI已熔断: ${breaker.reason}`);
        return;
      }

      if (featureToggleCommand) {
        if (!isMasterUser(e)) {
          await e.reply('该功能开关仅限主人操作。', true);
          return;
        }
        if (featureToggleCommand.type === 'status') {
          await e.reply(buildFeatureToggleStatus(config?.config || {}), true);
          return;
        }
        if (featureToggleCommand.type === 'disabled_status') {
          await e.reply(buildDisabledFeatureStatus(config?.config || {}), true);
          return;
        }
        if (featureToggleCommand.type === 'help') {
          await this.sendResponse(e, [{
            type: 'markdown',
            data: buildFeatureToggleCommandHelp(),
            at: -1,
            quote: -1,
            recall: false,
          }], aiConfig);
          return;
        }
        if (featureToggleCommand.type === 'export') {
          await e.reply(buildFeatureToggleExport(config?.config || {}), true);
          return;
        }
        if (featureToggleCommand.type === 'export_backup') {
          const backup = normalizeFeatureToggleBackup(config?.featureToggleBackup || {});
          const title = backup.savedAt ? `功能开关备份导出：${backup.savedAt}` : '功能开关备份导出：';
          await e.reply(buildFeatureToggleExport(backup.config, title), true);
          return;
        }
        const nextConfig = {
          ...(config?.config || {}),
        };
        if (featureToggleCommand.type === 'backup') {
          const payload = createFeatureToggleBackupPayload(config?.config || {});
          await ConfigControl.set('featureToggleBackup', payload);
          await e.reply(`功能开关已备份。\n时间：${payload.savedAt}`, true);
          return;
        }
        if (featureToggleCommand.type === 'restore') {
          const backup = normalizeFeatureToggleBackup(config?.featureToggleBackup || {});
          const hasBackup = Object.keys(backup.config || {}).length > 0;
          if (!hasBackup) {
            await e.reply('当前还没有可恢复的功能开关备份。', true);
            return;
          }
          Object.assign(nextConfig, backup.config);
          await ConfigControl.set('config', nextConfig);
          await e.reply(backup.savedAt ? `功能开关已从备份恢复。\n备份时间：${backup.savedAt}` : '功能开关已从备份恢复。', true);
          return;
        }
        if (featureToggleCommand.type === 'reset') {
          Object.assign(nextConfig, buildDefaultFeatureConfig());
          await ConfigControl.set('config', nextConfig);
          await e.reply('功能开关已重置为默认配置。', true);
          return;
        }
        if (featureToggleCommand.type === 'batch') {
          for (const key of featureToggleCommand.keys || []) {
            nextConfig[key] = featureToggleCommand.enabled;
          }
          await ConfigControl.set('config', nextConfig);
          await e.reply(`${featureToggleCommand.label}已${featureToggleCommand.enabled ? '开启' : '关闭'}。`, true);
          return;
        }
        if (featureToggleCommand.type === 'exclusive') {
          const enableSet = new Set(featureToggleCommand.enableKeys || []);
          for (const key of getManagedFeatureKeys()) {
            if (key === 'imageMonitor') {
              nextConfig[key] = enableSet.has(key);
              continue;
            }
            nextConfig[key] = enableSet.has(key);
          }
          await ConfigControl.set('config', nextConfig);
          await e.reply(`${featureToggleCommand.label}已执行。`, true);
          return;
        }
        nextConfig[featureToggleCommand.key] = featureToggleCommand.enabled;
        await ConfigControl.set('config', nextConfig);
        await e.reply(`${featureToggleCommand.label}已${featureToggleCommand.enabled ? '开启' : '关闭'}。`, true);
        return;
      }

      if (directVoiceText) {
        await this.handleDirectVoiceCommand(e, directVoiceText, config?.coreConfig);
        return;
      }

      const groupSessionId = `group:${e.group_id}`;
      
      this.groupLastActivityTime.set(groupSessionId, Date.now());
      const currentCount = this.groupMessageCount.get(groupSessionId) ?? 0;
      this.groupMessageCount.set(groupSessionId, currentCount + 1);
      const currentBotCount = this.groupMessageCountAfterBot.get(groupSessionId) ?? 0;
      this.groupMessageCountAfterBot.set(groupSessionId, currentBotCount + 1);

      const cooldownUntil = this.groupCooldownUntil.get(groupSessionId) ?? 0;
      if (Date.now() < cooldownUntil) {
        this.collectCooldownMessage(
          groupSessionId,
          e.group_id,
          e,
          e.msg,
          this.isDirectTrigger(e, aiConfig) || this.shouldFollowUp(groupSessionId, aiConfig)
        );
        return;
      }

      const delayQueue = this.dynamicDelayQueues.get(groupSessionId);
      if (delayQueue && Date.now() < delayQueue.delayUntil) {
        this.collectDynamicDelayMessage(groupSessionId, e, e.msg);
        return;
      }

      let flag = Boolean(e.crystelfTriggeredByRule);
      if (e.message) {
        e.message.forEach((message) => {
          if (isAtBot(message, e)) {
            flag = true;
          }
        });
      }

      if (this.processingSet.has(groupSessionId)) {
        if (flag) {
          this.queueManager.enqueue(groupSessionId, e, e.msg);
          logger.info(`[Queue] 群 ${e.group_id} 正在处理中,消息加入队列,当前队列长度: ${this.queueManager.getQueueLength(groupSessionId)}`);
        }
        return;
      }

      this.processingSet.add(groupSessionId);

      try {
        if (flag) {
          if (!this.rateLimiter.canProcess(e.user_id, e.group_id, e.msg)) return;

          if (aiConfig?.dynamicDelay?.enabled) {
            this.rateLimiter.recordInteraction(e.group_id, e.user_id);
            const delayInfo = this.rateLimiter.getDelayInfo(e.group_id);

            if (delayInfo.shouldDelay) {
              this.rateLimiter.record(e.user_id, e.group_id, e.msg);
              this.collectDynamicDelayMessage(groupSessionId, e, e.msg);
              this.startDynamicDelayTimer(groupSessionId, e.group_id, delayInfo.delayMs, aiConfig);
              return;
            }
          }

          this.rateLimiter.record(e.user_id, e.group_id, e.msg);
          await this.processChat(e, aiConfig, { skipPlanner: true, decisionSource: 'direct' });
          return;
        }

        const mentionedNickname = isNicknameMentioned(e.msg, aiConfig);
        if (mentionedNickname) {
          const history = this.db.getMessages(groupSessionId, aiConfig.chatHistory || 30);
          const botNickname = nickname || 'Bot';

          const planResult = await this.humanize.actionPlanner.plan(
            groupSessionId,
            botNickname,
            history,
            e.msg
          );

          if (planResult.action === 'reply') {
            if (!this.rateLimiter.canProcess(e.user_id, e.group_id, e.msg)) return;
            this.rateLimiter.record(e.user_id, e.group_id, e.msg);
            await this.processChat(e, aiConfig, { skipPlanner: true, decisionSource: 'nickname' });
          }
          return;
        }

        if (!isCommandPrefixedMessage(e.msg) && this.shouldFollowUp(groupSessionId, aiConfig)) {
          const history = this.db.getMessages(groupSessionId, aiConfig.chatHistory || 30);
          const botNickname = nickname || 'Bot';

          const planResult = await this.humanize.actionPlanner.plan(
            groupSessionId,
            botNickname,
            history,
            `[持续关注] ${e.msg}`
          );

          if (planResult.action === 'reply') {
            if (!this.rateLimiter.canProcess(e.user_id, e.group_id, e.msg)) return;
            this.rateLimiter.record(e.user_id, e.group_id, e.msg);
            await this.processChat(e, aiConfig, { skipPlanner: true, triggerReason: '[持续关注接话] ', decisionSource: 'follow_up' });
          }
        }
      } finally {
        this.processingSet.delete(groupSessionId);
        await this.processQueuedMessages(groupSessionId, aiConfig);
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 处理消息失败: ${error.message}`);
      const adapter = await YunzaiUtils.getAdapter(e);
      await Message.emojiLike(e, e.message_id, 10060, e.group_id, adapter);
    }
  }

  async handlePrivateMessage(e) {
    try {
      if (!this.isInitialized) {
        await this.init();
      }

      const config = await ConfigControl.get();
      const aiConfig = config?.ai;
      const featureConfig = config?.config || {};
      const privateCapabilities = getPrivateAiCapabilities(featureConfig);
      const usageControl = config?.coreConfig?.usageControl || {};
      if (!aiConfig || featureConfig.ai === false || featureConfig.privateAi === false) return false;
      if (isBotUser(e.user_id, e)) return false;

      const content = extractPlainTextFromEvent(e);
      const directVoiceText = parseDirectVoiceCommand(content);
      if (!content && !Array.isArray(e.message)) return false;
      if (!isPrivateAiRoutableMessage(content, e, directVoiceText)) {
        return false;
      }
      const accessDecision = getPrivateAiAccessDecision(featureConfig, e);
      if (!accessDecision.allow) {
        logger.info(`[crystelf-ai] 私聊AI访问被拒绝 user=${e.user_id}: ${accessDecision.reason}`);
        if (accessDecision.replyText) {
          await e.reply?.(accessDecision.replyText, true).catch(() => {});
        }
        return true;
      }
      const safetyDecision = await evaluatePrivateAiSafety(e, content, config?.config?.privateAiSafety || {}, {
        aiConfig,
        masterIds: Array.isArray(cfg?.masterQQ) ? cfg.masterQQ : [],
      });
      if (!safetyDecision.allow) {
        if (safetyDecision.replyText) {
          await e.reply?.(safetyDecision.replyText, true).catch(() => {});
        }
        return true;
      }
      const privateImageEditCommand = parseImageEditCommand(e);
      if (privateImageEditCommand) {
        if (!privateCapabilities.image) {
          await e.reply?.('私聊图片功能当前已关闭。', true).catch(() => {});
          return true;
        }
        return await this.imageEditCommand(e);
      }
      if (directVoiceText) {
        if (!privateCapabilities.voice) {
          await e.reply?.('私聊语音功能当前已关闭。', true).catch(() => {});
          return true;
        }
        await this.handlePrivateDirectVoiceCommand(e, directVoiceText);
        return true;
      }
      if (!privateCapabilities.voice && isPrivateVoiceModelCommand(content, e)) {
        await e.reply?.('私聊语音功能当前已关闭。', true).catch(() => {});
        return true;
      }
      const privateVoiceModelHandled = await this.handlePrivateVoiceModelCommand(e, content);
      if (privateVoiceModelHandled) {
        return true;
      }

      const breaker = shouldCircuitBreakSync(usageControl, 'chat');
      if (breaker.blocked) {
        logger.warn(`[crystelf-ai] 私聊AI已熔断: ${breaker.reason}`);
        return true;
      }

      if (!this.rateLimiter.canProcess(e.user_id, 'private', e.msg)) {
        return true;
      }
      this.rateLimiter.record(e.user_id, 'private', e.msg);
      await this.processPrivateChat(e, aiConfig);
      return true;
    } catch (error) {
      logger.error(`[crystelf-ai] 处理私聊消息失败: ${error.message}`);
      await e.reply?.('本次处理失败，请稍后重试。', true).catch(() => {});
      return true;
    }
  }

  async processPrivateChat(e, aiConfig, options = {}) {
    const userId = e.user_id;
    const sessionId = this.getSessionIdForEvent(e);
    this.currentAiConfig = aiConfig;

    try {
      this.sessionManager.getOrCreate(sessionId, 'private', userId);

      const messageData = await this.extractPrivateUserMessage(e, aiConfig);
      if (!messageData || !messageData.text || messageData.text.length === 0) {
        return false;
      }

      if (isChatHelpRequest(messageData.text)) {
        await this.sendPrivateResponse(e, [{
          type: 'markdown',
          data: buildChatHelpMessage(aiConfig),
          at: -1,
          quote: -1,
          recall: false,
        }], aiConfig);
        return true;
      }

      const controlCommand = parseSessionControlCommand(messageData.text);
      if (controlCommand) {
        const currentState = this.sessionControlState?.get(sessionId) || {};
        const nextState = mergeSessionControlState(currentState, controlCommand.patch);
        this.sessionControlState?.set(sessionId, nextState);
        await this.sendPrivateResponse(e, [{
          type: 'message',
          data: controlCommand.reply,
          at: -1,
          quote: -1,
          recall: false,
        }], aiConfig);
        return true;
      }

      const history = this.db.getMessages(sessionId, aiConfig.chatHistory || 30);
      const botNickname = nickname || 'Bot';
      const sessionControl = this.sessionControlState?.get(sessionId) || {};
      const featureConfig = await ConfigControl.get('config') || {};
      const privateCapabilities = getPrivateAiCapabilities(featureConfig);
      const effectiveSessionControl = privateCapabilities.skills
        ? sessionControl
        : { ...sessionControl, disableSearch: true };

      if (isImageGenerationRequest(messageData.text)) {
        if (!privateCapabilities.image) {
          await this.sendPrivateResponse(e, [{
            type: 'message',
            data: '私聊生图功能当前已关闭。',
            at: -1,
            quote: -1,
            recall: false,
          }], aiConfig);
          return true;
        }
        const imagePrompt = normalizeImagePromptText(messageData.text, e);
        logger.info(`[crystelf-ai] 检测到私聊绘图请求: ${imagePrompt}`);
        await this.handleImageMessage(e, {
          type: 'image',
          data: imagePrompt,
          at: -1,
          quote: -1,
          recall: false,
        });
        return true;
      }

      const memoryContext = await this.humanize.memoryRetrieval.retrieve(
        sessionId,
        messageData.text,
        e.sender?.nickname || '用户',
        history
      );
      const topicContext = this.humanize.topicTracker.getTopicContext(sessionId);
      const expressionContext = this.humanize.expressionLearner.getExpressionContext(sessionId);
      const knowledgeItems = aiConfig?.knowledgeBaseEnabled ? parseRuntimeKnowledgeBase(aiConfig?.knowledgeBase || '') : [];
      const knowledgeMatches = aiConfig?.knowledgeBaseEnabled
        ? retrieveRuntimeKnowledge(messageData.text, knowledgeItems, Number(aiConfig?.knowledgeTopK || 3))
        : [];
      const knowledgeContext = buildRuntimeKnowledgeContext(knowledgeMatches);
      this.sessionLastKnowledgeMatches?.set(sessionId, knowledgeMatches);

      const statusHints = [];
      if (aiConfig?.knowledgeDebugHints) {
        statusHints.push(knowledgeMatches.length > 0
          ? `参考了知识库：${knowledgeMatches.map(item => item.title).slice(0, 3).join('、')}`
          : '这次没有命中知识库，主要按通用理解回答');
      }
      if (effectiveSessionControl.disableSearch) {
        statusHints.push('当前会话已禁用联网搜索');
      }
      if (effectiveSessionControl.knowledgeOnly) {
        statusHints.push('当前会话只使用本地知识库模式');
      }

      const coreConfig = await ConfigControl.get('coreConfig');
      if (privateCapabilities.skills) {
        await loadAutoSessionSkills(this.skillManager, sessionId);
      }
      const ttsConfig = {
        ...(coreConfig?.tools?.tts || {}),
        allowAiTrigger: coreConfig?.tools?.tts?.allowAiTrigger === true && privateCapabilities.voice,
      };
      const pendingImageUrls = this.extractImageUrls(messageData.originalMessages);
      const promptSummary = {
        userMessage: messageData.text,
        knowledgeUsed: knowledgeMatches.map(item => item.title),
        memoryUsed: Boolean(memoryContext),
        topicUsed: Boolean(topicContext),
        expressionUsed: Boolean(expressionContext),
        userProfileUsed: false,
        sessionControl: buildSessionControlPrompt(effectiveSessionControl),
      };
      const buildDecisionSnapshot = result => buildDecisionExplanation({
        e,
        aiConfig,
        options: {
          ...options,
          decisionSource: options.decisionSource || 'direct',
        },
        history,
        sessionControl: effectiveSessionControl,
        knowledgeMatches,
        memoryContext,
        affinityContext: '',
        topicContext,
        expressionContext,
        userProfileContext: '',
        pendingImageUrls,
        ttsConfig,
        groupLastBotTime: 0,
        messageCountAfterBot: 0,
        result,
      });

      const targetMessage = {
        userName: e.sender?.nickname || '用户',
        userId,
        userRole: 'private',
        userTitle: '',
        content: messageData.text,
        messageId: e.message_id,
        timestamp: Date.now(),
      };

      const toolCtx = {
        sessionId,
        groupId: null,
        userId,
        defaultVoiceModel: getPrivateVoiceModel(userId),
        config: {
          ...aiConfig,
          searchToolsEnabled: privateCapabilities.skills,
          skillToolsEnabled: privateCapabilities.skills,
          voiceToolsEnabled: privateCapabilities.voice,
          tools: {
            tts: ttsConfig,
          },
        },
        db: this.db,
        pendingImageUrls,
        skillManager: this.skillManager,
        event: e,
        promptCtx: {
          replyContext: {
            type: 'private',
            targetUser: targetMessage.userName,
            targetUserId: targetMessage.userId,
            targetMessageId: targetMessage.messageId,
            targetMessage: targetMessage.content,
          },
        },
        targetMessage,
        onToolStatus(status) {
          if (aiConfig?.toolStatusHints && status && !effectiveSessionControl.disableSearch) {
            statusHints.push(status);
          }
        },
      };

      const promptCtx = {
        config: aiConfig,
        botNickname,
        botRole: 'private',
        isGroup: false,
        memoryContext,
        knowledgeContext,
        affinityContext: '',
        topicContext,
        expressionContext,
        userProfileContext: '',
        sessionControlContext: buildSessionControlPrompt(effectiveSessionControl),
        skillContext: privateCapabilities.skills ? this.skillManager.getActiveSkillsInfo(sessionId) : '',
        replyContext: null,
      };

      const chatResult = await runChat(
        humanizeAiAdapter,
        toolCtx,
        history,
        targetMessage,
        promptCtx,
        this.humanize
      );

      if (!chatResult || !Array.isArray(chatResult.messages)) {
        setSessionDebugSnapshot(sessionId, {
          knowledgeMatches,
          toolCalls: [],
          statusHints,
          failureReason: '聊天引擎没有返回有效结果',
          promptSummary,
          decisionExplanation: buildDecisionSnapshot({
            status: 'invalid',
            hasTextOutput: false,
            hasVoiceOutput: false,
            hasEmojiOutput: false,
            toolCallCount: 0,
            toolNames: [],
            failureReason: '聊天引擎没有返回有效结果',
            fallbackUsed: true,
            invalidChatResult: true,
          }),
        });
        logger.error('[crystelf-ai] private chatEngine 返回无效结果');
        await this.sendPrivateResponse(e, [{
          type: 'message',
          data: buildChatFallbackMessage({
            knowledgeEnabled: !!aiConfig?.knowledgeBaseEnabled,
            knowledgeMatched: knowledgeMatches.length,
            failureReason: '聊天引擎没有返回有效结果',
            toolHints: statusHints,
            hideFailureReason: false,
          }),
          at: -1,
          quote: -1,
          recall: false,
        }], aiConfig);
        return true;
      }

      this.sessionLastToolCalls?.set(sessionId, Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls : []);
      const outputMessages = chatResult.messages
        .map(msg => this.humanize.typoGenerator.apply(msg))
        .filter(Boolean);
      const rawAssistantText = outputMessages.join('\n');
      const effectiveAssistantText = outputMessages.length > 0
        ? applyEmojiSuppression(rawAssistantText, aiConfig)
        : '';
      const hasVoiceMessages = privateCapabilities.voice && Array.isArray(chatResult.voiceMessages) && chatResult.voiceMessages.length > 0;
      const hasEmojiReply = privateCapabilities.meme && Boolean(chatResult.emojiPath);
      const emojiMeta = chatResult.emojiMeta || null;
      let parsedMessages = [];

      if (outputMessages.length === 0 && !hasVoiceMessages && !hasEmojiReply) {
        setSessionDebugSnapshot(sessionId, {
          knowledgeMatches,
          toolCalls: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls : [],
          statusHints,
          failureReason: chatResult.failureReason || '模型没有产出可发送内容',
          promptSummary,
          decisionExplanation: buildDecisionSnapshot({
            status: 'fallback',
            hasTextOutput: false,
            hasVoiceOutput: false,
            hasEmojiOutput: false,
            toolCallCount: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.length : 0,
            toolNames: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.map(item => item?.name).filter(Boolean) : [],
            failureReason: chatResult.failureReason || '模型没有产出可发送内容',
            fallbackUsed: true,
            invalidChatResult: false,
          }),
        });
        await this.sendPrivateResponse(e, [{
          type: 'message',
          data: buildChatFallbackMessage({
            knowledgeEnabled: !!aiConfig?.knowledgeBaseEnabled,
            knowledgeMatched: knowledgeMatches.length,
            failureReason: chatResult.failureReason,
            toolHints: statusHints,
            hideFailureReason: false,
          }),
          at: -1,
          quote: -1,
          recall: false,
        }], aiConfig);
        return true;
      }

      if (outputMessages.length > 0) {
        parsedMessages = await ResponseHandler.processResponse(
          effectiveAssistantText,
          messageData.text,
          null,
          userId
        );

        if (hasEmojiReply) {
          parsedMessages = parsedMessages.filter(message => message?.type !== 'meme');
        }

        if (parsedMessages.length > 0) {
          await this.sendPrivateResponse(e, parsedMessages, aiConfig, {
            includeInlineMemes: !hasEmojiReply,
          });
        }
      }

      let hasSentEmojiReply = false;
      if (hasEmojiReply) {
        hasSentEmojiReply = await this.replyMemeImageWithFallback(e, chatResult.emojiPath, {
          character: emojiMeta?.character || '',
          emotion: emojiMeta?.emotion || emojiMeta?.requestedEmotion || '',
          fallbackStatuses: [emojiMeta?.requestedEmotion, emojiMeta?.emotion, 'default'].filter(Boolean),
          logLabel: '私聊聊天引擎表情包'
        });
        if (hasSentEmojiReply) {
          this.recordMemeTiming(e, sessionId);
        }
      }

      if (hasVoiceMessages) {
        await this.sendPrivateResponse(e, chatResult.voiceMessages, aiConfig);
      }

      const hasTextReply = parsedMessages.length > 0;
      setSessionDebugSnapshot(sessionId, {
        knowledgeMatches,
        toolCalls: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls : [],
        statusHints,
        failureReason: chatResult.failureReason || '',
        promptSummary,
        decisionExplanation: buildDecisionSnapshot({
          status: 'success',
          hasTextOutput: hasTextReply,
          hasVoiceOutput: hasVoiceMessages,
          hasEmojiOutput: hasSentEmojiReply,
          toolCallCount: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.length : 0,
          toolNames: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.map(item => item?.name).filter(Boolean) : [],
          failureReason: chatResult.failureReason || '',
          fallbackUsed: Boolean(chatResult.usedFallbackPrompt),
          invalidChatResult: false,
        }),
      });

      this.db.saveMessage({
        sessionId,
        role: 'user',
        content: messageData.text,
        userId,
        userName: e.sender?.nickname,
        userRole: 'private',
        groupId: null,
        timestamp: Date.now(),
        messageId: e.message_id,
      });

      const assistantHistoryContent = sanitizeAssistantHistoryContent(effectiveAssistantText);
      if (assistantHistoryContent) {
        this.db.saveMessage({
          sessionId,
          role: 'assistant',
          content: assistantHistoryContent,
          groupId: null,
          timestamp: Date.now(),
        });
      }

      this.humanize.topicTracker.onMessage(sessionId).catch(() => {});
      this.humanize.expressionLearner.onMessage(sessionId, {
        role: 'user',
        content: messageData.text,
        userId,
        userName: e.sender?.nickname,
        timestamp: Date.now(),
      }).catch(() => {});
      return true;
    } catch (error) {
      logger.error(`[crystelf-ai] 私聊AI调用失败: ${error.message}`);
      await this.sendPrivateResponse(e, [{
        type: 'message',
        data: buildChatFallbackMessage({
          knowledgeEnabled: !!aiConfig?.knowledgeBaseEnabled,
          knowledgeMatched: 0,
          failureReason: error.message,
          toolHints: [],
          hideFailureReason: false,
        }),
        at: -1,
        quote: -1,
        recall: false,
      }], aiConfig).catch(() => {});
      return true;
    }
  }

  async processChat(e, aiConfig, options = {}) {
    const groupId = e.group_id;
    const userId = e.user_id;
    const groupSessionId = `group:${groupId}`;
    this.currentAiConfig = aiConfig;

    try {
      this.sessionManager.getOrCreate(groupSessionId, 'group', groupId);

      const messageData = await this.extractUserMessage(e.msg, nickname, e, aiConfig);
      if (!messageData || !messageData.text || messageData.text.length === 0) {
        return e.reply(segment.image(await Meme.getMeme(aiConfig.character, 'default')));
      }

      if (isChatHelpRequest(messageData.text)) {
        await this.sendResponse(e, [{
          type: 'markdown',
          data: buildChatHelpMessage(aiConfig),
          at: -1,
          quote: -1,
          recall: false,
        }], aiConfig);
        return;
      }

      const controlCommand = parseSessionControlCommand(messageData.text);
      if (controlCommand) {
        const currentState = this.sessionControlState?.get(groupSessionId) || {};
        const nextState = mergeSessionControlState(currentState, controlCommand.patch);
        this.sessionControlState?.set(groupSessionId, nextState);
        await this.sendResponse(e, [{
          type: 'message',
          data: controlCommand.reply,
          at: -1,
          quote: -1,
          recall: false,
        }], aiConfig);
        return;
      }

      const history = this.db.getMessages(groupSessionId, aiConfig.chatHistory || 30);
      const botNickname = nickname || 'Bot';
      const sessionControl = this.sessionControlState?.get(groupSessionId) || {};

      if (!options?.skipPlanner && aiConfig?.planner?.enabled) {
        const planResult = await this.humanize.actionPlanner.plan(
          groupSessionId,
          botNickname,
          history,
          messageData.text
        );

        if (planResult.action === 'complete' || planResult.action === 'wait') {
          logger.info(`[ActionPlanner] 会话 ${groupSessionId} ${planResult.action}: ${planResult.reason}`);
          return;
        }
      }

      const memories = await MemorySystem.searchMemories(userId, e.msg || '', 5);

      if (isImageGenerationRequest(messageData.text)) {
        const imagePrompt = normalizeImagePromptText(messageData.text, e);
        logger.info(`[crystelf-ai] 检测到用户直接绘图请求: ${imagePrompt}`);
        await this.handleImageMessage(e, {
          type: 'image',
          data: imagePrompt,
          at: -1,
          quote: -1,
          recall: false,
        });
        this.groupLastBotMessageTime.set(groupSessionId, Date.now());
        this.groupMessageCountAfterBot.set(groupSessionId, 0);
        return;
      }
      
      const memoryContext = await this.humanize.memoryRetrieval.retrieve(
        groupSessionId,
        messageData.text,
        e.sender?.nickname || '用户',
        history
      );
      const affinityRecord = await affinityManager.updateFromMessage(
        groupId,
        userId,
        messageData.text,
        aiConfig?.affinity || {}
      );
      const affinityContext = this.buildAffinityContext(e, affinityRecord);

      const topicContext = this.humanize.topicTracker.getTopicContext(groupSessionId);
      const expressionContext = this.humanize.expressionLearner.getExpressionContext(groupSessionId);
      const userProfileContext = this.humanize.userProfiler.getUserProfileContext(
        groupSessionId,
        userId,
        e.sender?.nickname || '该用户'
      );
      const knowledgeItems = aiConfig?.knowledgeBaseEnabled ? parseRuntimeKnowledgeBase(aiConfig?.knowledgeBase || '') : [];
      const knowledgeMatches = aiConfig?.knowledgeBaseEnabled
        ? retrieveRuntimeKnowledge(messageData.text, knowledgeItems, Number(aiConfig?.knowledgeTopK || 3))
        : [];
      const knowledgeContext = buildRuntimeKnowledgeContext(knowledgeMatches);
      this.sessionLastKnowledgeMatches?.set(groupSessionId, knowledgeMatches);
      const statusHints = [];
      if (aiConfig?.knowledgeDebugHints) {
        statusHints.push(knowledgeMatches.length > 0
          ? `参考了知识库：${knowledgeMatches.map(item => item.title).slice(0, 3).join('、')}`
          : '这次没有命中知识库，主要按通用理解回答');
      }
      if (sessionControl.disableSearch) {
        statusHints.push('当前会话已禁用联网搜索');
      }
      if (sessionControl.knowledgeOnly) {
        statusHints.push('当前会话只使用本地知识库模式');
      }

      const coreConfig = await ConfigControl.get('coreConfig');
      await loadAutoSessionSkills(this.skillManager, groupSessionId);
      const ttsConfig = coreConfig?.tools?.tts || {};
      const pendingImageUrls = this.extractImageUrls(messageData.originalMessages);
      const groupLastBotTime = this.groupLastBotMessageTime?.get(groupSessionId) ?? 0;
      const messageCountAfterBot = this.groupMessageCountAfterBot?.get(groupSessionId) ?? 0;
      const promptSummary = {
        userMessage: messageData.text,
        knowledgeUsed: knowledgeMatches.map(item => item.title),
        memoryUsed: Boolean(memoryContext),
        topicUsed: Boolean(topicContext),
        expressionUsed: Boolean(expressionContext),
        userProfileUsed: Boolean(userProfileContext),
        sessionControl: buildSessionControlPrompt(sessionControl),
      };
      const buildDecisionSnapshot = result => buildDecisionExplanation({
        e,
        aiConfig,
        options,
        history,
        sessionControl,
        knowledgeMatches,
        memoryContext,
        affinityContext,
        topicContext,
        expressionContext,
        userProfileContext,
        pendingImageUrls,
        ttsConfig,
        groupLastBotTime,
        messageCountAfterBot,
        result,
      });

      const targetMessage = {
        userName: e.sender?.nickname || '用户',
        userId,
        userRole: e.sender?.role || 'member',
        userTitle: e.sender?.title,
        content: messageData.text,
        messageId: e.message_id,
        timestamp: Date.now(),
      };

      const toolCtx = {
        sessionId: groupSessionId,
        groupId,
        userId,
        defaultVoiceModel: getGroupVoiceModel(groupId),
        config: {
          ...aiConfig,
          tools: {
            tts: ttsConfig,
          },
        },
        db: this.db,
        pendingImageUrls,
        skillManager: this.skillManager,
        event: e,
        promptCtx: {
          replyContext: {
            type: 'reply',
            targetUser: targetMessage.userName,
            targetUserId: targetMessage.userId,
            targetMessageId: targetMessage.messageId,
            targetMessage: targetMessage.content,
          },
        },
        targetMessage,
        onToolStatus(status) {
          if (aiConfig?.toolStatusHints && status && !sessionControl.disableSearch) {
            statusHints.push(status);
          }
        },
      };

      const promptCtx = {
        config: aiConfig,
        botNickname,
        botRole: 'member',
        isGroup: true,
        groupName: e.group?.info?.group_name || e.group_name,
        memoryContext,
        knowledgeContext,
        affinityContext,
        topicContext,
        expressionContext,
        userProfileContext,
        sessionControlContext: buildSessionControlPrompt(sessionControl),
        skillContext: this.skillManager.getActiveSkillsInfo(groupSessionId),
        replyContext: {
          type: 'reply',
          targetUser: targetMessage.userName,
          targetUserId: targetMessage.userId,
          targetMessageId: targetMessage.messageId,
          targetMessage: targetMessage.content,
        },
      };

      const chatResult = await runChat(
        humanizeAiAdapter,
        toolCtx,
        history,
        targetMessage,
        promptCtx,
        this.humanize
      );

      if (!chatResult || !Array.isArray(chatResult.messages)) {
        setSessionDebugSnapshot(groupSessionId, {
          knowledgeMatches,
          toolCalls: [],
          statusHints,
          failureReason: '聊天引擎没有返回有效结果',
          promptSummary,
          decisionExplanation: buildDecisionSnapshot({
            status: 'invalid',
            hasTextOutput: false,
            hasVoiceOutput: false,
            hasEmojiOutput: false,
            toolCallCount: 0,
            toolNames: [],
            failureReason: '聊天引擎没有返回有效结果',
            fallbackUsed: true,
            invalidChatResult: true,
          }),
        });
        logger.error('[crystelf-ai] chatEngine 返回无效结果');
        await this.sendResponse(e, [{
          type: 'message',
          data: buildChatFallbackMessage({
            knowledgeEnabled: !!aiConfig?.knowledgeBaseEnabled,
            knowledgeMatched: knowledgeMatches.length,
            failureReason: '聊天引擎没有返回有效结果',
            toolHints: statusHints,
            hideFailureReason: Boolean(e?.group_id || e?.isGroup),
          }),
          at: -1,
          quote: -1,
          recall: false,
        }], aiConfig);
        return;
      }

      this.sessionLastToolCalls?.set(groupSessionId, Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls : []);
      setSessionDebugSnapshot(groupSessionId, {
        knowledgeMatches,
        toolCalls: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls : [],
        statusHints,
        failureReason: chatResult.failureReason || '',
        promptSummary,
        decisionExplanation: buildDecisionSnapshot({
          status: 'generated',
          hasTextOutput: false,
          hasVoiceOutput: Boolean(Array.isArray(chatResult.voiceMessages) && chatResult.voiceMessages.length > 0),
          hasEmojiOutput: Boolean(chatResult.emojiPath),
          toolCallCount: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.length : 0,
          toolNames: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.map(item => item?.name).filter(Boolean) : [],
          failureReason: chatResult.failureReason || '',
          fallbackUsed: Boolean(chatResult.usedFallbackPrompt),
          invalidChatResult: false,
        }),
      });

      const outputMessages = chatResult.messages
        .map(msg => this.humanize.typoGenerator.apply(msg))
        .filter(Boolean);
      const rawAssistantText = outputMessages.join('\n');
      const effectiveAssistantText = outputMessages.length > 0
        ? applyEmojiSuppression(rawAssistantText, aiConfig)
        : '';
      const hasVoiceMessages = Array.isArray(chatResult.voiceMessages) && chatResult.voiceMessages.length > 0;
      const hasEmojiReply = Boolean(chatResult.emojiPath);
      const emojiMeta = chatResult.emojiMeta || null;
      const emojiDecision = hasEmojiReply
        ? this.shouldSendMemeByTiming(e, groupSessionId, messageData.text, history)
        : { allow: false };
      let parsedMessages = [];

      if (outputMessages.length === 0 && !hasVoiceMessages && !hasEmojiReply) {
        setSessionDebugSnapshot(groupSessionId, {
          knowledgeMatches,
          toolCalls: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls : [],
          statusHints,
          failureReason: chatResult.failureReason || '模型没有产出可发送内容',
          promptSummary,
          decisionExplanation: buildDecisionSnapshot({
            status: 'fallback',
            hasTextOutput: false,
            hasVoiceOutput: false,
            hasEmojiOutput: false,
            toolCallCount: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.length : 0,
            toolNames: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.map(item => item?.name).filter(Boolean) : [],
            failureReason: chatResult.failureReason || '模型没有产出可发送内容',
            fallbackUsed: true,
            invalidChatResult: false,
          }),
        });
        await this.sendResponse(e, [{
          type: 'message',
          data: buildChatFallbackMessage({
            knowledgeEnabled: !!aiConfig?.knowledgeBaseEnabled,
            knowledgeMatched: knowledgeMatches.length,
            failureReason: chatResult.failureReason,
            toolHints: statusHints,
            hideFailureReason: Boolean(e?.group_id || e?.isGroup),
          }),
          at: -1,
          quote: -1,
          recall: false,
        }], aiConfig);
        return;
      }

      if (outputMessages.length > 0) {
        parsedMessages = await ResponseHandler.processResponse(
          effectiveAssistantText,
          messageData.text,
          groupId,
          userId
        );

        if (hasEmojiReply) {
          parsedMessages = parsedMessages.filter(message => message?.type !== 'meme');
        }

        if (parsedMessages.length > 0) {
          await this.sendResponse(e, parsedMessages, aiConfig, {
            includeInlineMemes: !hasEmojiReply,
          });
        }
      }

      const hasTextReply = parsedMessages.length > 0;
      let hasSentEmojiReply = false;

      if (hasEmojiReply && !emojiDecision.allow) {
        logger.info(`[crystelf-ai] 跳过聊天引擎表情包发送: ${emojiDecision.reason || 'timing_blocked'}`);
      }

      if (hasEmojiReply && emojiDecision.allow) {
        hasSentEmojiReply = await this.replyMemeImageWithFallback(e, chatResult.emojiPath, {
          character: emojiMeta?.character || '',
          emotion: emojiMeta?.emotion || emojiMeta?.requestedEmotion || '',
          fallbackStatuses: [emojiMeta?.requestedEmotion, emojiMeta?.emotion, 'default'].filter(Boolean),
          logLabel: '聊天引擎表情包'
        });
        if (hasSentEmojiReply) {
          this.recordMemeTiming(e, groupSessionId);
        }
      }

      if (hasVoiceMessages) {
        await this.sendResponse(e, chatResult.voiceMessages, aiConfig);
      }

      if (hasTextReply || hasSentEmojiReply || hasVoiceMessages) {
        this.groupLastBotMessageTime.set(groupSessionId, Date.now());
        this.groupMessageCountAfterBot.set(groupSessionId, 0);
      }

      setSessionDebugSnapshot(groupSessionId, {
        knowledgeMatches,
        toolCalls: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls : [],
        statusHints,
        failureReason: chatResult.failureReason || '',
        promptSummary,
        decisionExplanation: buildDecisionSnapshot({
          status: 'success',
          hasTextOutput: hasTextReply,
          hasVoiceOutput: hasVoiceMessages,
          hasEmojiOutput: hasSentEmojiReply,
          toolCallCount: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.length : 0,
          toolNames: Array.isArray(chatResult.toolCalls) ? chatResult.toolCalls.map(item => item?.name).filter(Boolean) : [],
          failureReason: chatResult.failureReason || '',
          fallbackUsed: Boolean(chatResult.usedFallbackPrompt),
          invalidChatResult: false,
        }),
      });

      this.db.saveMessage({
        sessionId: groupSessionId,
        role: 'user',
        content: messageData.text,
        userId,
        userName: e.sender?.nickname,
        userRole: e.sender?.role,
        groupId,
        timestamp: Date.now(),
        messageId: e.message_id,
      });

      const assistantHistoryContent = sanitizeAssistantHistoryContent(effectiveAssistantText);
      if (assistantHistoryContent) {
        this.db.saveMessage({
          sessionId: groupSessionId,
          role: 'assistant',
          content: assistantHistoryContent,
          groupId,
          timestamp: Date.now(),
        });
      }

      this.humanize.topicTracker.onMessage(groupSessionId).catch(() => {});
      this.humanize.expressionLearner.onMessage(groupSessionId, {
        role: 'user',
        content: messageData.text,
        userId,
        userName: e.sender?.nickname,
        timestamp: Date.now(),
      }).catch(() => {});
      this.humanize.userProfiler.onMessage(groupSessionId, {
        role: 'user',
        content: messageData.text,
        userId,
        userName: e.sender?.nickname,
        timestamp: Date.now(),
      }).catch(() => {});

      this.startCooldownTimer(groupSessionId, groupId);

    } catch (error) {
      logger.error(`[crystelf-ai] AI调用失败: ${error.message}`);
      await this.sendResponse(e, [{
        type: 'message',
        data: buildChatFallbackMessage({
          knowledgeEnabled: !!aiConfig?.knowledgeBaseEnabled,
          knowledgeMatched: 0,
          failureReason: error.message,
          toolHints: [],
          hideFailureReason: Boolean(e?.group_id || e?.isGroup),
        }),
        at: -1,
        quote: -1,
        recall: false,
      }], aiConfig).catch(() => {});
      const adapter = await YunzaiUtils.getAdapter(e);
      if (typeof (e?.bot || Bot)?.sendApi === 'function') {
        await Message.emojiLike(e, e.message_id, 10060, e.group_id, adapter);
      }
    }
  }

  async extractUserMessage(msg, nickname, e, aiConfig) {
    if (e.message && msg && msg.trim() !== '' && msg !== '\n') {
      let text = [];
      let at = [];
      const maxMessageLength = aiConfig?.maxMessageLength || 100;
      const originalMessages = [];
      
      e.message.forEach((message) => {
        if (message.type === 'text' && message.text !== '' && message.text !== '\n') {
          let displayText = message.text;
          if (message.text && message.text.length > maxMessageLength) {
            const omittedChars = message.text.length - maxMessageLength;
            displayText = message.text.substring(0, maxMessageLength) + `…（省略 ${omittedChars} 字）`;
          }
          text.push(displayText);
        } else if (message.type === 'at') {
          at.push(message.qq);
        } else if (message.type === 'image') {
          if (message.url) {
            originalMessages.push({
              type: 'image_url',
              image_url: { url: message.url }
            });
          }
        }
      });

      let returnMessage = '';
      if (text.length > 0) {
        text.forEach((message) => {
          if (message !== '') {
            const tempMessage = `[${e.sender?.nickname},id:${e.user_id},seq:${e.message_id}]说:${message}\n`;
            returnMessage += tempMessage;
            originalMessages.push({
              type: 'text',
              content: tempMessage
            });
          }
        });
      }

      if (at.length > 0) {
        for (const at1 of at) {
          if (!isBotUser(at1, e)) {
            const atNickname = await e.group.pickMember(at1).nickname || '一个人';
            const tempMessage = `[${e.sender?.nickname},id:${e.user_id},seq:${e.message_id}]@(at)了${atNickname},id是${at1}\n`;
            returnMessage += tempMessage;
            originalMessages.push({
              type: 'text',
              content: tempMessage
            });
          }
        }
      }

      if (e.source || e.reply_id) {
        let reply;
        if (e.getReply) reply = await e.getReply();
        else if (e.source?.seq) {
          const history = await e.group.getChatHistory(e.source.seq, 1);
          reply = history?.pop();
        }
        if (reply) {
          const msgArr = Array.isArray(reply) ? reply : reply.message || [];
          msgArr.forEach((msg) => {
            if (msg.type === 'text') {
              const tempMessage = `[${e.sender?.nickname}]引用了[被引用消息:${isBotUser(reply.user_id, e) ? '你' : reply.sender?.nickname},id:${reply.user_id},seq:${reply.message_id}]发的一段文本:${msg.text}\n`;
              returnMessage += tempMessage;
              originalMessages.push({
                type: 'text',
                content: tempMessage
              });
            }
            if (msg.type === 'image') {
              returnMessage += `[${e.sender?.nickname}]引用了[被引用消息:${isBotUser(reply.user_id, e) ? '你' : reply.sender?.nickname},id:${reply.user_id},seq:${reply.message_id}]发的一张图片\n`;
              originalMessages.push({
                type: 'image_url',
                image_url: { url: msg.url }
              });
            }
          });
        }
      }

      const imgUrls = await YunzaiUtils.getImages(e, 1, true).catch(err => {
        logger.warn(`[crystelf-ai] 获取图片失败: ${err.message}`);
        return [];
      });
      if (Array.isArray(imgUrls) && imgUrls.length > 0) {
        returnMessage += `[${e.sender?.nickname},id:${e.user_id},seq:${e.message_id}]发送了一张图片\n`;
        for (const url of imgUrls) {
          if (!url) continue;
          originalMessages.push({
            type: 'image_url',
            image_url: { url }
          });
        }
      }

      if ((!Array.isArray(imgUrls) || imgUrls.length === 0) && isImageFollowUpRequest(returnMessage || msg)) {
        const recentImages = await getRecentChatImageContext(e);
        for (const item of recentImages) {
          if (!item?.url) continue;
          returnMessage += item.promptText || '';
          originalMessages.push({
            type: 'image_url',
            image_url: { url: item.url }
          });
        }
      }

      if (at.length === 1 && isBotUser(at[0], e) && text.length === 0 && !returnMessage.trim()) {
        return { text: [], originalMessages: originalMessages };
      }

      return { text: returnMessage, originalMessages: originalMessages };
    }
    logger.warn('[crystelf-ai] 字符串匹配失败');
    return { text: [], originalMessages: [] };
  }

  async extractPrivateUserMessage(e, aiConfig) {
    const maxMessageLength = aiConfig?.maxMessageLength || 100;
    const senderName = e.sender?.nickname || e.nickname || '用户';
    const originalMessages = [];
    const textParts = [];
    const messages = Array.isArray(e.message) ? e.message : [];

    for (const message of messages) {
      if (message?.type === 'text' && message.text) {
        let displayText = String(message.text || '');
        if (displayText.length > maxMessageLength) {
          const omittedChars = displayText.length - maxMessageLength;
          displayText = `${displayText.substring(0, maxMessageLength)}…（省略 ${omittedChars} 字）`;
        }
        textParts.push(displayText);
      } else if (message?.type === 'image' && message.url) {
        originalMessages.push({
          type: 'image_url',
          image_url: { url: message.url },
        });
      }
    }

    if (textParts.length === 0 && e.msg) {
      let displayText = String(e.msg || '');
      if (displayText.length > maxMessageLength) {
        const omittedChars = displayText.length - maxMessageLength;
        displayText = `${displayText.substring(0, maxMessageLength)}…（省略 ${omittedChars} 字）`;
      }
      textParts.push(displayText);
    }

    let returnMessage = '';
    if (textParts.length > 0) {
      const text = textParts.join('\n').trim();
      returnMessage += `[${senderName},id:${e.user_id},seq:${e.message_id}]私聊说:${text}\n`;
      originalMessages.push({
        type: 'text',
        content: returnMessage,
      });
    }

    if (originalMessages.some(item => item.type === 'image_url')) {
      returnMessage += `[${senderName},id:${e.user_id},seq:${e.message_id}]私聊发送了一张图片\n`;
    }

    return {
      text: returnMessage.trim(),
      originalMessages,
    };
  }

  async sendResponse(e, messages, aiConfig, sendOptions = {}) {
    try {
      const adapter = await YunzaiUtils.getAdapter(e);
      const normalizedMessages = [];
      for (const message of messages) {
        const expandedMessages = normalizeOutgoingMessageForSend(message, {
          includeInlineMemes: sendOptions.includeInlineMemes !== false,
        });
        if (expandedMessages.length > 0) {
          normalizedMessages.push(...expandedMessages);
        }
      }

      for (const message of normalizedMessages) {
        switch (message.type) {
          case 'message': {
            const messageContent = applyEmojiSuppression(message.data, aiConfig);
            if (!messageContent) {
              break;
            }
            await Message.sendGroupMessage(e, e.group_id, messageContent, message.at, message.quote, adapter);
            break;
          }
          case 'code':
            await this.handleCodeMessage(e, message);
            break;
          case 'markdown':
            await this.handleMarkdownMessage(e, message);
            break;
          case 'meme':
            await this.handleMemeMessage(e, message, aiConfig);
            break;
          case 'memory':
            await ResponseHandler.handleMemoryMessage(e, message, e.group_id, e.user_id);
            break;
          case 'at':
            if (!isBotUser(message.id, e)) e.reply(segment.at(message.id));
            break;
          case 'poke':
            await this.handlePokeMessage(e, message);
            break;
          case 'image':
            await this.handleImageMessage(e, message);
            break;
          case 'voice':
            await this.handleVoiceMessage(e, message);
            break;
          default:
            logger.warn(`[crystelf-ai] 不支持的消息类型: ${message.type}`);
        }
        await tools.sleep(40);
      }
    } catch (error) {
      const adapter = await YunzaiUtils.getAdapter(e);
      if (typeof (e?.bot || Bot)?.sendApi === 'function') {
        await Message.emojiLike(e, e.message_id, 10060, e.group_id, adapter);
      }
      logger.error(`[crystelf-ai] 发送回复失败: ${error}`);
    }
  }

  async sendPrivateResponse(e, messages, aiConfig, sendOptions = {}) {
    try {
      const privateCapabilities = getPrivateAiCapabilities(await ConfigControl.get('config') || {});
      const normalizedMessages = [];
      for (const message of messages) {
        const expandedMessages = normalizeOutgoingMessageForSend(message, {
          includeInlineMemes: privateCapabilities.meme && sendOptions.includeInlineMemes !== false,
        });
        if (expandedMessages.length > 0) {
          normalizedMessages.push(...expandedMessages);
        }
      }

      for (const message of normalizedMessages) {
        switch (message.type) {
          case 'message': {
            const messageContent = Message.cleanOutgoingText(applyEmojiSuppression(message.data, aiConfig));
            if (!messageContent) {
              break;
            }
            await e.reply(messageContent, true);
            break;
          }
          case 'code':
            await this.handleCodeMessage(e, message);
            break;
          case 'markdown':
            await this.handleMarkdownMessage(e, message);
            break;
          case 'meme':
            if (!privateCapabilities.meme) {
              break;
            }
            await this.handleMemeMessage(e, message, aiConfig);
            break;
          case 'memory':
            await ResponseHandler.handleMemoryMessage(e, message, this.getSessionIdForEvent(e), e.user_id);
            break;
          case 'image':
            if (!privateCapabilities.image) {
              break;
            }
            await this.handleImageMessage(e, message);
            break;
          case 'voice':
            if (!privateCapabilities.voice) {
              break;
            }
            await this.handlePrivateVoiceMessage(e, message);
            break;
          case 'at':
          case 'poke':
            break;
          default:
            logger.warn(`[crystelf-ai] 私聊不支持的消息类型: ${message.type}`);
        }
        await tools.sleep(40);
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 发送私聊回复失败: ${error.message}`);
    }
  }

  async handlePrivateVoiceMessage(e, message) {
    try {
      if (message?.audioUrl && typeof segment?.record === 'function') {
        await e.reply(segment.record(message.audioUrl));
        return true;
      }
      if (message?.text) {
        await e.reply(message.text, true);
        return true;
      }
    } catch (error) {
      logger.warn(`[crystelf-ai] 私聊语音发送失败: ${error.message}`);
      if (message?.text) {
        await e.reply(message.text, true).catch(() => {});
      }
    }
    return false;
  }

  async handlePrivateDirectVoiceCommand(e, text) {
    try {
      const ttsTool = getTtsTools().find(tool => tool.name === 'speak_text');
      if (!ttsTool) {
        await e.reply('语音工具暂时不可用。', true);
        return true;
      }

      const toolCtx = {
        event: e,
        groupId: null,
        userId: e.user_id,
        defaultVoiceModel: getPrivateVoiceModel(e.user_id),
        targetMessage: { content: e.msg },
        promptCtx: { replyContext: { type: 'private' } },
      };

      const result = await ttsTool.handler({ text, force: true }, toolCtx);
      if (result?.voiceMessage) {
        await this.handlePrivateVoiceMessage(e, result.voiceMessage);
        return true;
      }

      await e.reply(result?.error || '语音生成失败。', true);
      return true;
    } catch (error) {
      logger.error(`[crystelf-ai] 私聊显式语音命令失败: ${error.message}`);
      await e.reply('语音生成失败，稍后再试。', true);
      return true;
    }
  }

  async handlePrivateVoiceModelCommand(e, content = '') {
    const text = String(content || '').trim();
    if (!text) return false;

    const config = await ConfigControl.get('config') || {};
    if (config.voiceModel === false) {
      return false;
    }

    if (/^[#＃/]?灵晶\s*语音模型\s*$/.test(text)) {
      return this.showPrivateVoiceModel(e);
    }
    if (/^[#＃/]?灵晶\s*切换语音模型\s*$/.test(text)) {
      return this.showPrivateVoiceModelList(e);
    }
    if (/^[#＃/]?灵晶\s*切换语音模型\s+([\s\S]+)$/.test(text)) {
      return this.switchPrivateVoiceModelDirectly(e);
    }
    if (/^[#＃/]?灵晶\s*重置语音模型\s*$/.test(text)) {
      return this.resetPrivateVoiceModel(e);
    }
    if (/^\d{1,3}$/.test(text)) {
      return this.selectPrivateVoiceModel(e);
    }

    return false;
  }

  async showPrivateVoiceModel(e) {
    const record = getPrivateVoiceModelRecord(e.user_id);
    const coreConfig = ConfigControl.get('coreConfig') || {};
    const defaultModel = String(coreConfig?.tools?.tts?.defaultModel || '').trim();
    if (!record) {
      await e.reply(`私聊未单独设置语音模型，当前使用全局默认${defaultModel ? `：${defaultModel}` : '。'}`, true);
      return true;
    }

    await e.reply([
      `私聊语音模型：${record.model}`,
      record.updatedAt ? `设置时间：${record.updatedAt.replace('T', ' ').slice(0, 19)}` : '',
      '发送 #灵晶切换语音模型 可重新选择。',
    ].filter(Boolean).join('\n'), true);
    return true;
  }

  async showPrivateVoiceModelList(e) {
    const result = await loadPrivateVoiceModelList();
    if (!result.success) {
      await e.reply(`语音模型列表读取失败：${result.error}`, true);
      return true;
    }

    const currentModel = getPrivateVoiceModelRecord(e.user_id)?.model || '';
    privateVoiceModelPendingSelections.set(getPrivateVoiceModelPendingKey(e), {
      userId: String(e.user_id || ''),
      models: result.models,
      expiresAt: Date.now() + PRIVATE_VOICE_MODEL_PENDING_TTL_MS,
    });

    await e.reply(formatPrivateVoiceModelList(result, currentModel), true);
    return true;
  }

  async switchPrivateVoiceModelDirectly(e) {
    const result = await loadPrivateVoiceModelList();
    if (!result.success) {
      await e.reply(`语音模型列表读取失败：${result.error}`, true);
      return true;
    }

    return this.applyPrivateVoiceModelSelection(e, parsePrivateVoiceModelSwitchInput(e), result.models);
  }

  async selectPrivateVoiceModel(e) {
    prunePrivateVoiceModelPendingSelections();
    const key = getPrivateVoiceModelPendingKey(e);
    const pending = privateVoiceModelPendingSelections.get(key);
    if (!pending) {
      return false;
    }
    return this.applyPrivateVoiceModelSelection(e, e.msg, pending.models);
  }

  async resetPrivateVoiceModel(e) {
    clearPrivateVoiceModel(e.user_id);
    privateVoiceModelPendingSelections.delete(getPrivateVoiceModelPendingKey(e));
    await e.reply('已重置私聊语音模型，之后将使用全局默认语音模型。', true);
    return true;
  }

  async applyPrivateVoiceModelSelection(e, input, models) {
    const resolved = resolvePrivateVoiceModelInput(input, models);
    if (!resolved.ok || !resolved.model) {
      await e.reply(resolved.error || '语音模型选择失败。', true);
      return true;
    }

    setPrivateVoiceModel(e.user_id, resolved.model, { operator: e.user_id });
    privateVoiceModelPendingSelections.delete(getPrivateVoiceModelPendingKey(e));
    await e.reply(`已切换你的私聊默认语音模型：${resolved.model}`, true);
    return true;
  }

  extractImageUrls(originalMessages = []) {
    return originalMessages
      .filter(msg => msg.type === 'image_url' && msg.image_url?.url)
      .map(msg => msg.image_url.url);
  }

  async handleCodeMessage(e, message) {
    try {
      const imagePath = await Renderer.renderCode(message.data, message.language);
      if (imagePath) {
        await e.reply(segment.image(imagePath));
      } else {
        await e.reply('渲染代码失败，稍后再试。', true);
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 处理代码消息失败: ${error.message}`);
      await e.reply('渲染代码失败，稍后再试。', true);
    }
  }

  async handleMarkdownMessage(e, message) {
    try {
      const imagePath = await Renderer.renderMarkdown(message.data);
      if (imagePath) {
        await e.reply(segment.image(imagePath));
      } else {
        await e.reply('渲染 Markdown 失败，稍后再试。', true);
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 处理Markdown消息失败: ${error.message}`);
      await e.reply('渲染 Markdown 失败，稍后再试。', true);
    }
  }

  getSessionIdForEvent(e) {
    if (e?.group_id) {
      return `group:${e.group_id}`;
    }
    return `private:${e?.user_id || 'unknown'}`;
  }

  shouldSendMemeByTiming(e, sessionId, messageText = '', chatHistory = []) {
    const memeTiming = this.humanize?.memeTiming;
    if (!memeTiming) {
      return { allow: true };
    }

    try {
      return memeTiming.shouldSendMeme(sessionId, e?.group_id || null, messageText, chatHistory);
    } catch (error) {
      logger.warn(`[crystelf-ai] 表情包时机检查失败，按允许处理: ${error.message}`);
      return { allow: true };
    }
  }

  recordMemeTiming(e, sessionId) {
    const memeTiming = this.humanize?.memeTiming;
    if (!memeTiming) {
      return;
    }

    try {
      memeTiming.recordMemeSent(sessionId, e?.group_id || null);
    } catch (error) {
      logger.warn(`[crystelf-ai] 记录表情包发送时机失败: ${error.message}`);
    }
  }

  async replyMemeImageWithFallback(e, primaryImage, options = {}) {
    const {
      character = '',
      emotion = '',
      fallbackStatuses = [],
      failureText = '',
      logLabel = '表情包'
    } = options;

    if (!primaryImage) {
      if (failureText) {
        await e.reply(failureText, true).catch(() => {});
      }
      return false;
    }

    try {
      await e.reply(segment.image(primaryImage));
      return true;
    } catch (primaryError) {
      logger.warn(`[crystelf-ai] ${logLabel}发送失败，尝试本地兜底: ${primaryError.message}`);

      if (character) {
        const localMeme = await Meme.getLocalResolvedMemePath(character, emotion, fallbackStatuses);
        if (localMeme.imagePath && localMeme.imagePath !== primaryImage) {
          try {
            await e.reply(segment.image(localMeme.imagePath));
            logger.info(`[crystelf-ai] ${logLabel}本地兜底成功: ${localMeme.character || character}/${localMeme.emotion || emotion || 'default'}`);
            return true;
          } catch (localError) {
            logger.error(`[crystelf-ai] ${logLabel}本地兜底发送失败: ${localError.message}`);
          }
        }
      }

      if (failureText) {
        await e.reply(failureText, true).catch(() => {});
      }

      return false;
    }
  }

  async handleMemeMessage(e, message, aiConfig) {
    try {
      const sessionId = this.getSessionIdForEvent(e);
      const timingDecision = this.shouldSendMemeByTiming(e, sessionId, e?.msg || '', []);
      if (!timingDecision.allow) {
        logger.info(`[crystelf-ai] 跳过表情消息发送: ${timingDecision.reason || 'timing_blocked'}`);
        return;
      }

      const memeConfig = aiConfig?.memeConfig || {};
      const character = resolvePreferredMemeCharacter({
        explicitCharacter: message.character,
        configuredCharacter: memeConfig.character || aiConfig?.character || '',
        fallbackCharacter: nickname || '芙宁娜',
      });
      const emotion = message.emotion || message.data || 'default';
      const resolvedMeme = await Meme.getResolvedMemeUrl(character, emotion, ['default']);
      const sent = await this.replyMemeImageWithFallback(e, resolvedMeme.imagePath || resolvedMeme.imageUrl, {
        character,
        emotion: resolvedMeme.emotion || emotion,
        fallbackStatuses: [emotion, 'default'],
        logLabel: '表情消息'
      });
      if (sent) {
        this.recordMemeTiming(e, sessionId);
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 处理表情消息失败: ${error.message}`);
    }
  }

  async handlePokeMessage(e, message) {
    try {
      if (!isBotUser(message.id, e)) {
        await Group.groupPoke(e, message.id, e.group_id);
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 戳一戳失败: ${error.message}`);
    }
  }

  async handleImageMessage(e, message) {
    try {
      const { default: userConfigManager } = await import('../lib/ai/userConfigManager.js');
      const userConfig = await userConfigManager.getUserConfig(String(e.user_id));
      const imageConfig = await userConfigManager.getUserImageConfig(String(e.user_id));
      const imageFallback = (failureReason = '') => buildImageFallbackMessage({
        aiConfig: userConfig,
        imageConfig,
        failureReason,
      });

      logger.info(`[crystelf-ai] 图像模式: ${imageConfig?.imageMode || 'openai'}, 接口: ${imageConfig?.imageMode === 'jimeng' ? imageConfig?.jimengApiUrl : imageConfig?.baseApi}`);

      if (!imageConfig?.enabled) {
        logger.warn('[crystelf-ai] 图像生成功能未启用');
        if (message?.requireSourceImages) {
          await e.reply('图像生成功能当前未开启，请先在控制台启用图像生成 API。', true);
        }
        return;
      }

      const providedImages = Array.isArray(message?.sourceImageArr)
        ? message.sourceImageArr.map(item => String(item || '').trim()).filter(Boolean)
        : null;
      const imageMessages = providedImages || await collectSourceImageUrls(e);
      const sourceImageArr = Array.from(new Set(imageMessages));

      if (sourceImageArr.length > 0) {
        logger.info(`[crystelf-ai] 已收集 ${sourceImageArr.length} 张参考图。`);
      } else if (message?.requireSourceImages) {
        logger.warn('[crystelf-ai] 改图命令未找到参考图片。');
        await e.reply('没有找到参考图片，请附带图片或回复图片后重试。', true);
        return;
      } else {
        logger.warn('[crystelf-ai] 未找到用户发送的图片，将使用生成模式。');
      }

      const imageMessage = {
        data: message.data,
        sourceImageArr: sourceImageArr
      };

      const { default: aiCaller } = await import('../lib/ai/aiCaller.js');
      const result = await aiCaller.callAi('', [], [], e, [], [imageMessage]);

      if (result.success) {
        let imageUrl = null;
        let description = message.data;

        try {
          const responseData = JSON.parse(result.rawResponse);
          if (Array.isArray(responseData) && responseData.length > 0) {
            const imageResult = responseData.find(item => item?.type === 'image' && item?.url);
            if (imageResult) {
              imageUrl = imageResult.url;
              description = imageResult.description || message.data;
            }
          }
        } catch (parseError) {
          logger.warn(`[crystelf-ai] 解析图像响应失败,响应文本: ${parseError.message}`);
          await e.reply(imageFallback(parseError.message), true);
          return;
        }

        if (imageUrl) {
          await e.reply(segment.image(imageUrl), true);
        } else {
          logger.info(`[crystelf-ai] 图像生成响应 - 用户: ${e.user_id}, 响应: ${result.response}`);
          await e.reply(imageFallback(result.response || '图像接口未返回图片地址'), true);
        }
      } else {
        logger.error(`[crystelf-ai] 图像生成/编辑失败 - 用户: ${e.user_id}, 错误: ${result.error}`);
        await e.reply(imageFallback(result.error), true);
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 处理图像消息失败 - 用户: ${e.user_id}, 错误: ${error.message}`);
      const aiConfig = await ConfigControl.get('ai') || {};
      await e.reply(buildImageFallbackMessage({
        aiConfig,
        imageConfig: aiConfig?.imageConfig || {},
        failureReason: error.message,
      }), true);
    }
  }

  async handleVoiceMessage(e, message) {
    try {
      await sendVoiceMessage(e, message);
    } catch (error) {
      logger.error(`[crystelf-ai] 处理语音消息失败: ${error.message}`);
      if (message?.text) {
        await e.reply(message.text, true);
      }
    }
  }

  async handleDirectVoiceCommand(e, text, coreConfig = {}) {
    return handleSharedDirectVoiceCommand(e, text, coreConfig);
  }

  buildAffinityContext(e, affinityRecord = {}) {
    if (!affinityRecord || !affinityRecord.level) {
      return '';
    }

    const nickname = e?.sender?.nickname || '该用户';
    const toneByLevel = this.currentAiConfig?.affinity?.toneByLevel || {};
    const levelAdviceMap = {
      冷淡: toneByLevel.cold || '可以稍微克制、简短、保持距离，但仍需自然且不过度刻薄。',
      普通: toneByLevel.neutral || '保持自然、平衡、正常的聊天语气，不要额外亲昵。',
      熟悉: toneByLevel.familiar || '可以更自然、更放松一些，适度接梗，表现出熟悉感。',
      亲近: toneByLevel.warm || '可以更亲近、更有温度一些，语气自然放松，但不要显得夸张或失控。',
    };

    const parts = [
      `当前你对 ${nickname} 的关系倾向：${affinityRecord.level}`,
      levelAdviceMap[affinityRecord.level] || '请把它仅作为表达语气参考。',
      '请只在对话表达和语气上体现差异，不要直接提到好感度、分值、升降变化、规则或内部判断。',
    ];

    return parts.join('\n');
  }

  startCooldownTimer(groupSessionId, groupId) {
    const existingTimer = this.cooldownTimeoutIds.get(groupSessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const cooldownMs = this.getCooldownMs();

    const timer = setTimeout(async () => {
      await this.flushCooldownMessages(groupSessionId, groupId);
    }, cooldownMs);

    this.cooldownTimeoutIds.set(groupSessionId, timer);
    this.groupCooldownUntil.set(groupSessionId, Date.now() + cooldownMs);
    this.groupCooldownMessages.set(groupSessionId, []);
  }

  async flushCooldownMessages(groupSessionId, groupId) {
    this.cooldownTimeoutIds.delete(groupSessionId);
    const collected = this.groupCooldownMessages.get(groupSessionId) || [];

    if (collected.length === 0) {
      this.groupCooldownMessages.delete(groupSessionId);
      this.groupCooldownUntil.delete(groupSessionId);
      return;
    }

    const actionableMessages = collected.filter(m => m.isDirectAt);

    try {
      if (actionableMessages.length > 0) {
        logger.info(`[Cooldown] 群 ${groupId} 处理冷却期间收集的后续消息`);
        const latestMessage = actionableMessages[actionableMessages.length - 1];
        if (latestMessage?.event) {
          const mergedContent = actionableMessages.map(m => m.content).join('\n');
          const restoredEvent = restoreEventFromSnapshot({
            ...latestMessage.event,
            msg: mergedContent,
            message: [
              {
                type: 'text',
                text: mergedContent,
              },
            ],
          });
          await this.processChat(restoredEvent, {
            ...(await ConfigControl.get('ai')),
          }, { skipPlanner: true, triggerReason: '[冷却结束处理消息] ', decisionSource: 'cooldown_replay' });
        }
      }
    } catch (err) {
      logger.error(`[Cooldown] 群 ${groupId} 处理失败: ${err}`);
    } finally {
      this.groupCooldownMessages.delete(groupSessionId);
      this.groupCooldownUntil.delete(groupSessionId);
    }
  }

  collectCooldownMessage(groupSessionId, groupId, event, content, isDirectAt) {
    const userName = event.sender?.card || event.sender?.nickname || String(event.user_id);
    const messages = this.groupCooldownMessages.get(groupSessionId) || [];
    if (messages.length >= 20) {
      messages.shift();
    }
    messages.push({
      event: createEventSnapshot(event, content),
      content,
      userName,
      userId: event.user_id,
      messageId: event.message_id,
      timestamp: Date.now(),
      isDirectAt,
    });
    this.groupCooldownMessages.set(groupSessionId, messages);
  }

  isDirectTrigger(e, aiConfig) {
    if (e?.crystelfTriggeredByRule) return true;
    if (isNicknameMentioned(e?.msg, aiConfig)) return true;

    if (Array.isArray(e?.message)) {
      return e.message.some(message => isAtBot(message, e));
    }

    return false;
  }

  shouldFollowUp(groupSessionId, aiConfig) {
    const followUpConfig = getFollowUpConfig(aiConfig);
    if (!followUpConfig.enabled) return false;

    const lastBotTime = this.groupLastBotMessageTime.get(groupSessionId) ?? 0;
    if (!lastBotTime) return false;

    const sinceLastBot = Date.now() - lastBotTime;
    if (sinceLastBot > followUpConfig.windowMs) return false;

    const messageCountAfterBot = this.groupMessageCountAfterBot.get(groupSessionId) ?? 0;
    if (messageCountAfterBot <= 0) return false;

    return messageCountAfterBot <= followUpConfig.maxMessages;
  }

  cleanupGroupState(aiConfig) {
    const now = Date.now();
    const followUpConfig = getFollowUpConfig(aiConfig);
    const expiryMs = Math.max(
      aiConfig?.planner?.idleThresholdMs || 1800000,
      followUpConfig.windowMs,
      aiConfig?.cooldownAfterReplyMs || 20000,
      aiConfig?.dynamicDelay?.maxDelayMs || 15000,
      300000
    );

    for (const [groupSessionId, lastTime] of this.groupLastActivityTime) {
      const cooldownUntil = this.groupCooldownUntil.get(groupSessionId) ?? 0;
      const delayUntil = this.dynamicDelayQueues.get(groupSessionId)?.delayUntil ?? 0;
      const hasProcessing = this.processingSet.has(groupSessionId) || this.idleCheckProcessing.has(groupSessionId);
      const hasCooldown = cooldownUntil > now;
      const hasDelay = delayUntil > now;

      if (hasProcessing || hasCooldown || hasDelay) continue;
      if (now - lastTime <= expiryMs) continue;

      this.groupLastActivityTime.delete(groupSessionId);
      this.groupMessageCount.delete(groupSessionId);
      this.groupLastBotMessageTime.delete(groupSessionId);
      this.groupMessageCountAfterBot.delete(groupSessionId);
      this.groupCooldownUntil.delete(groupSessionId);
      this.groupCooldownMessages.delete(groupSessionId);
      this.cooldownTimeoutIds.delete(groupSessionId);
      this.dynamicDelayQueues.delete(groupSessionId);
      this.groupLastIdleCheckTime.delete(groupSessionId);
      this.queueManager.clearQueue(groupSessionId);
      this.queueManager.clearActiveTarget(groupSessionId);
    }

    this.rateLimiter.cleanup(expiryMs);
  }

  getCooldownMs() {
    const config = ConfigControl.getConfigData?.('ai');
    return config?.cooldownAfterReplyMs || 20000;
  }

  startDynamicDelayTimer(groupSessionId, groupId, delayMs, config) {
    let queueData = this.dynamicDelayQueues.get(groupSessionId);

    if (!queueData) {
      queueData = {
        messages: [],
        timer: null,
        delayUntil: Date.now() + delayMs,
      };
      this.dynamicDelayQueues.set(groupSessionId, queueData);
    }

    if (queueData.timer) {
      clearTimeout(queueData.timer);
    }

    queueData.delayUntil = Date.now() + delayMs;

    logger.info(`[DynamicDelay] 群 ${groupId} 开始延迟 ${delayMs / 1000} 秒`);

    queueData.timer = setTimeout(async () => {
      await this.processDynamicDelayQueue(groupSessionId, groupId, config);
    }, delayMs);
  }

  collectDynamicDelayMessage(groupSessionId, event, content) {
    let queueData = this.dynamicDelayQueues.get(groupSessionId);

    if (!queueData) {
      queueData = {
        messages: [],
        timer: null,
        delayUntil: 0,
      };
      this.dynamicDelayQueues.set(groupSessionId, queueData);
    }

    const userName = event.sender?.card || event.sender?.nickname || String(event.user_id);

    if (queueData.messages.length >= 20) {
      queueData.messages.shift();
    }
    queueData.messages.push({
      event: createEventSnapshot(event, content),
      content,
      userName,
      userId: event.user_id,
      messageId: event.message_id,
      timestamp: Date.now(),
    });
  }

  async processDynamicDelayQueue(groupSessionId, groupId, config) {
    const queueData = this.dynamicDelayQueues.get(groupSessionId);
    if (!queueData || queueData.messages.length === 0) {
      this.dynamicDelayQueues.delete(groupSessionId);
      return;
    }

    const messages = queueData.messages;
    this.dynamicDelayQueues.delete(groupSessionId);

    logger.info(`[DynamicDelay] 群 ${groupId} 延迟结束,处理 ${messages.length} 条消息`);

    if (this.processingSet.has(groupSessionId)) {
      logger.info(`[DynamicDelay] 群 ${groupId} 正在处理中,跳过`);
      return;
    }

    this.processingSet.add(groupSessionId);

    try {
      const firstMsg = messages[0];
      if (firstMsg?.event) {
        const mergedContent = messages.map(m => m.content).join('\n');
        const restoredEvent = restoreEventFromSnapshot({
          ...firstMsg.event,
          msg: mergedContent,
          message: [
            {
              type: 'text',
              text: mergedContent,
            },
          ],
        });
        await this.processChat(restoredEvent, config, { skipPlanner: true, triggerReason: '[批量处理延迟消息] ', decisionSource: 'delayed_batch' });
      }
    } catch (err) {
      logger.error(`[DynamicDelay] 群 ${groupId} 处理失败: ${err}`);
    } finally {
      this.processingSet.delete(groupSessionId);
    }
  }

  async processQueuedMessages(groupSessionId, config) {
    const queue = this.queueManager.getQueue(groupSessionId);
    if (!queue || queue.length === 0) {
      this.queueManager.clearActiveTarget(groupSessionId);
      return;
    }

    logger.info(`[Queue] 群 ${groupSessionId} 批量处理队列,队列长度: ${queue.length}`);

    this.queueManager.clearQueue(groupSessionId);

    if (queue.length > 0) {
      const firstItem = queue[0];
      await this.processChat(firstItem.event, config, { skipPlanner: true, decisionSource: 'queued_replay' });
    }
  }

  async sendGroupMessage(groupId, content) {
    try {
      const bot = Array.from(Bot.uin).find(b => b);
      if (bot) {
        await Bot.pickGroup(groupId).sendMsg(content);
      }
    } catch (err) {
      logger.error(`[crystelf-ai] 发送群消息失败: ${err}`);
    }
  }
}

export class crystelfAIPrivate extends plugin {
  constructor() {
    super({
      name: 'crystelfAI-private',
      dsc: '晶灵私聊智能',
      event: 'message',
      priority: -1111,
      rule: [
        {
          reg: '^(#|/)?灵晶私聊安全状态$',
          fnc: 'showPrivateAiSafetyStatus',
        },
        {
          reg: '^(#|/)?灵晶私聊黑名单$',
          fnc: 'showPrivateAiSafetyBlacklist',
        },
        {
          reg: '^(#|/)?灵晶解除私聊黑名单\\s*([1-9]\\d{4,12})$',
          fnc: 'unblockPrivateAiSafety',
        },
        {
          reg: '^(#|/)?灵晶清空私聊安全记录$',
          fnc: 'clearPrivateAiSafetyRecords',
        },
        {
          reg: '^(#|/)?重置(私聊)?(对话|会话)$',
          fnc: 'clearPrivateChatHistory',
        },
        {
          reg: '^(#|/)?(查看)?会话状态([\\s\\S]*)?$',
          fnc: 'showPrivateSessionStatus',
        },
        {
          reg: '^[\\s\\S]*$',
          fnc: 'privateChat',
        },
      ],
    });
  }

  getRuntime() {
    return global.crystelfAiSingleton || new crystelfAI();
  }

  async privateChat(e) {
    if (e?.group_id) return false;
    const runtime = this.getRuntime();
    return runtime.handlePrivateMessage(e);
  }

  async showPrivateAiSafetyStatus(e) {
    if (e?.group_id) return false;
    if (!isMasterUser(e)) {
      return e.reply('该私聊安全命令仅限主人使用。', true);
    }
    const config = await ConfigControl.get();
    return e.reply(formatPrivateAiSafetyStatus(config?.config?.privateAiSafety || {}), true);
  }

  async showPrivateAiSafetyBlacklist(e) {
    if (e?.group_id) return false;
    if (!isMasterUser(e)) {
      return e.reply('该私聊安全命令仅限主人使用。', true);
    }
    return e.reply(formatPrivateAiSafetyBlacklist(30), true);
  }

  async unblockPrivateAiSafety(e) {
    if (e?.group_id) return false;
    if (!isMasterUser(e)) {
      return e.reply('该私聊安全命令仅限主人使用。', true);
    }
    const match = String(e.msg || '').match(/灵晶解除私聊黑名单\s*([1-9]\d{4,12})/);
    const userId = match?.[1] || '';
    const existed = unblockPrivateAiSafetyUser(userId);
    return e.reply(existed ? `已解除 ${userId} 的私聊 AI 安全黑名单。` : `${userId || '该用户'} 不在私聊 AI 安全黑名单中。`, true);
  }

  async clearPrivateAiSafetyRecords(e) {
    if (e?.group_id) return false;
    if (!isMasterUser(e)) {
      return e.reply('该私聊安全命令仅限主人使用。', true);
    }
    clearPrivateAiSafetyRecords();
    return e.reply('已清空私聊 AI 安全警告与记录，现有黑名单保留。', true);
  }

  async clearPrivateChatHistory(e) {
    if (e?.group_id) return false;
    const runtime = this.getRuntime();
    if (!runtime.isInitialized) {
      await runtime.init();
    }
    const sessionId = runtime.getSessionIdForEvent(e);
    runtime.sessionManager.clearSession(sessionId);
    runtime.sessionControlState?.delete(sessionId);
    runtime.sessionLastKnowledgeMatches?.delete(sessionId);
    runtime.sessionLastToolCalls?.delete(sessionId);
    clearSessionDebugSnapshot(sessionId);
    return e.reply('私聊会话已重置。', true);
  }

  async showPrivateSessionStatus(e) {
    if (e?.group_id) return false;
    const runtime = this.getRuntime();
    if (!runtime.isInitialized) {
      await runtime.init();
    }
    const sessionId = runtime.getSessionIdForEvent(e);
    const state = runtime.sessionControlState?.get(sessionId) || {};
    const lines = [
      '当前私聊会话状态：',
      `- 联网搜索：${state.disableSearch ? '已禁用' : '已允许'}`,
      `- 知识库模式：${state.knowledgeOnly ? '只用知识库' : '正常模式'}`,
      `- 回复风格：${state.responseStyle === 'concise' ? '简洁' : state.responseStyle === 'detailed' ? '详细' : '默认'}`,
    ];
    return e.reply(lines.join('\n'), true);
  }
}

setInterval(async () => {
  try {
    const plugin = global.crystelfAiSingleton;
    if (plugin?.sessionManager) {
      plugin.sessionManager.cleanTimeoutSessions();
    }
    if (plugin?.skillManager) {
      plugin.skillManager.cleanup();
    }
  } catch (error) {
    logger.error(`[crystelf-ai] 清理过期sessions失败: ${error.message}`);
  }
}, 5 * 60 * 1000);
