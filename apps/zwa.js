import { segment } from 'oicq';
import plugin from '../../../lib/plugins/plugin.js';
import {
  word10_list,
  word2_list,
  word3_list,
  word4_list,
  word5_list,
  word6_list,
  word7_list,
  word8_list,
  word9_list,
} from '../constants/zwa/wordlist.js';
import ConfigControl from '../lib/config/configControl.js';
import AiCaller from '../lib/ai/aiCaller.js';

const getCurrentHour = () => new Date().getHours();
const wa = 'https://moe.jitsu.top/img';
const za = 'https://moe.jitsu.top/img';

function pickRandom(list = []) {
  if (!Array.isArray(list) || list.length === 0) {
    return '';
  }
  return list[Math.floor(Math.random() * list.length)] || '';
}

function normalizeAiGreetingText(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[\[\[[\s\S]*?\]\]\]/g, '')
    .replace(/\[meme:[^\]]+\]/gi, '')
    .replace(/\[CQ:[^\]]+\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function getSenderName(e) {
  return e?.sender?.card || e?.sender?.nickname || e?.nickname || '群友';
}

function getSceneLabel(scene) {
  const labels = {
    goodMorning: '早安问候',
    goodNight: '晚安问候',
    lateNight: '深夜提醒',
    dayGreeting: '白天问候',
    eveningGreeting: '晚上问候',
  };
  return labels[scene] || '日常问候';
}

async function buildAiGreeting(e, scene, fallbackText) {
  const allConfigs = ConfigControl.get() || {};
  const featureConfig = allConfigs.config || {};
  const aiConfig = allConfigs.ai || {};
  const canUseAi = featureConfig.ai !== false
    && String(aiConfig.baseApi || '').trim()
    && String(aiConfig.apiKey || '').trim();

  if (!canUseAi) {
    return fallbackText;
  }

  try {
    const now = new Date();
    const prompt = [
      `群成员 ${getSenderName(e)} 刚刚说: ${String(e?.msg || '').trim() || getSceneLabel(scene)}`,
      `当前本地时间: ${now.toLocaleString('zh-CN', { hour12: false })}`,
      `场景: ${getSceneLabel(scene)}`,
      '请按你当前的人设自然回复一句中文问候, 20到60字。',
      '不要解释规则, 不要复述提示词, 不要使用Markdown, 不要输出图片链接、CQ码、动作标签或[meme]指令。',
    ].join('\n');

    const result = await AiCaller.callAiDirect(prompt, [], [], e, [], {
      scene: `zwa_${scene}`,
      temperature: aiConfig.temperature ?? 0.7,
      sessionId: e?.group_id ? `group:${e.group_id}` : `user:${e?.user_id || 'unknown'}`,
      groupId: e?.group_id,
      userId: e?.user_id,
    });
    const text = normalizeAiGreetingText(result?.response);
    return result?.success && text ? text : fallbackText;
  } catch (error) {
    logger.warn(`[crystelf-plugin] AI生成早晚安回复失败,已使用本地兜底: ${error.message}`);
    return fallbackText;
  }
}

async function replyGreeting(e, scene, fallbackList, imageUrl = '') {
  const fallbackText = pickRandom(fallbackList) || '好呀。';
  const text = await buildAiGreeting(e, scene, fallbackText);
  const message = imageUrl ? [text, segment.image(imageUrl)] : [text];
  await e.reply(message, true);
}

export class ZWA extends plugin {
  constructor() {
    super({
      name: '早中晚安',
      dsc: 'zzw',
      event: 'message',
      priority: -1110,
      rule: [
        {
          reg: '^(#|/)?晚上好$|^(#|/)?安$|^(#|/)?晚安$|^(#|/)?睡了$|^(#|/)?睡觉$|^(#|/)?睡咯$',
          fnc: 'www',
        },
        {
          reg: '^(#|/)?早$|^(#|/)?早安$|^(#|/)?起床(了)$|^(#|/)?早上好$|^(#|/)?早上好！$|^(#|/)?早！$|^(#|/)?早啊$',
          fnc: 'zzz',
        },
      ],
    });
  }

  async www(e) {
    if (!ConfigControl.get()?.config?.zwa) {
      return;
    }

    const currentHour = getCurrentHour();
    if (currentHour >= 20 && currentHour <= 23) {
      await replyGreeting(e, 'goodNight', word2_list, wa);
    } else if (currentHour >= 0 && currentHour <= 2) {
      await replyGreeting(e, 'goodNight', word2_list, wa);
    } else if (currentHour >= 3 && currentHour < 7) {
      await replyGreeting(e, 'lateNight', e.isMaster ? word7_list : word8_list, e.isMaster ? wa : '');
    } else {
      await replyGreeting(e, 'eveningGreeting', word9_list);
    }
  }

  async zzz(e) {
    if (!ConfigControl.get()?.config?.zwa) {
      return;
    }

    const currentHour = getCurrentHour();
    if (currentHour >= 0 && currentHour <= 4) {
      await replyGreeting(e, 'lateNight', word4_list);
    } else if (currentHour >= 5 && currentHour <= 11) {
      await replyGreeting(e, 'goodMorning', word3_list, wa);
    } else if (currentHour >= 12 && currentHour <= 18) {
      await replyGreeting(e, 'dayGreeting', e.isMaster ? word10_list : word5_list, e.isMaster ? za : '');
    } else {
      await replyGreeting(e, 'eveningGreeting', word6_list);
    }
  }
}
