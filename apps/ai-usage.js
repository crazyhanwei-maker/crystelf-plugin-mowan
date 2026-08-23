import ConfigControl from '../lib/config/configControl.js';
import Version from '../lib/system/version.js';
import Path from '../constants/path.js';
import { getUsageOverviewSync } from '../lib/ai/usageLogger.js';
import { getPricingConfig } from '../lib/webConsole/webConsoleConfig.js';
import { renderUsageImage } from '../lib/system/usageImageRenderer.js';
import { resolveBotIdentity } from '../lib/system/botIdentity.js';

const FREE_CHAT_USAGE_URL = 'https://chat.furina.info/freechatapi/relay-ip-usage?key=free';
const FREE_CHAT_TIMEOUT_MS = 8000;

function formatNumber(value = 0) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('zh-CN');
}

function isFreeChatConfig(aiConfig = {}) {
  const baseApi = String(aiConfig?.baseApi || '').trim().toLowerCase();
  const apiKey = String(aiConfig?.apiKey || '').trim().toLowerCase();
  return baseApi.includes('freechatapi') || apiKey === 'free';
}

function normalizeQuota(source = {}) {
  const toNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  };
  return {
    used: toNumber(source.used),
    limit: toNumber(source.limit),
    remaining: toNumber(source.remaining),
    percent: Math.min(100, toNumber(source.percent)),
    limitEnabled: source.limit_enabled !== false,
  };
}

async function fetchFreeChatUsage() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FREE_CHAT_TIMEOUT_MS);
  try {
    const response = await fetch(FREE_CHAT_USAGE_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'crystelf-plugin/ai-usage',
      },
    });
    if (!response.ok) {
      throw new Error(`FREE CHAT 用量接口返回 HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data || data.ok !== true) {
      throw new Error(String(data?.error || 'FREE CHAT 用量接口返回异常'));
    }
    return {
      success: true,
      tokens: normalizeQuota(data.tokens),
      requests: {
        ...normalizeQuota(data.requests),
        success: Number(data.requests?.success) || 0,
        failed: Number(data.requests?.failed) || 0,
      },
      period: {
        date: String(data.period?.date || ''),
        resetAt: String(data.period?.resetAt || ''),
      },
      timezone: String(data.timezone || ''),
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`FREE CHAT 用量接口请求超时（${FREE_CHAT_TIMEOUT_MS}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const SCENE_LABELS = {
  chat: '群聊对话',
  private_chat: '私聊对话',
  poke_image_summary: '戳一戳图片摘要',
  image_monitor_review: '图片监控审核',
  group_summary: '群总结',
  user_profile: '用户画像',
  affinity: '好感度',
  meme: '表情包',
  voice: '语音',
};

function getSceneLabel(scene = '') {
  return SCENE_LABELS[String(scene || '').trim()] || String(scene || '其他').trim() || '其他';
}

function buildTopEntries(map = {}, limit = 6) {
  return Object.entries(map || {})
    .map(([key, value]) => ({ label: getSceneLabel(key), value: Number(value?.requests ?? value) || 0 }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function buildUsageData(e = {}) {
  const allConfigs = ConfigControl.get() || {};
  const aiConfig = allConfigs.ai || {};
  const profileName = String(allConfigs?.profile?.nickName || allConfigs?.profile?.nickname || '魔丸').trim();
  const botIdentity = resolveBotIdentity(e, profileName);

  const base = {
    pluginName: Version.name,
    pluginVersion: Version.ver,
    botId: botIdentity.botId || '未知',
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  };

  if (isFreeChatConfig(aiConfig)) {
    return { mode: 'free-chat', ...base, aiConfig };
  }

  const pricing = getPricingConfig(allConfigs);
  const usage = getUsageOverviewSync(new Date(), pricing) || {};
  const requestCount = Number(usage.request_count || 0);
  const totalCost = Number(usage.total_cost || 0);
  const topScenes = buildTopEntries(usage.by_scene, 6);
  const topModels = Object.entries(usage.by_model || {})
    .map(([key, value]) => ({ label: key, value: Number(value?.requests ?? value) || 0 }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  return {
    mode: 'own-api',
    ...base,
    pricing,
    usage: {
      requestCount,
      successCount: Number(usage.success_count || 0),
      errorCount: Number(usage.error_count || 0),
      totalTokens: Number(usage.total_tokens || 0),
      promptTokens: Number(usage.prompt_tokens || 0),
      completionTokens: Number(usage.completion_tokens || 0),
      totalCost,
      averageCost: requestCount > 0 ? totalCost / requestCount : 0,
      topScenes,
      topSceneLabel: topScenes[0]?.label || '暂无',
      topSceneValue: topScenes[0]?.value || 0,
      topModels,
    },
  };
}

function buildUsageText(data = {}) {
  if (data.mode === 'free-chat') {
    if (data.errorMessage) {
      return `今日AI用量（FREE CHAT）\n━━━━━━━━━━━━\n${data.errorMessage}`;
    }
    const tokens = data.freeChat?.tokens || {};
    const requests = data.freeChat?.requests || {};
    return [
      '今日AI用量（FREE CHAT）',
      '━━━━━━━━━━━━',
      `Tokens：已用 ${formatNumber(tokens.used)}${tokens.limitEnabled ? ` / 上限 ${formatNumber(tokens.limit)}（${tokens.percent}%）` : '（未限额）'}`,
      `请求：已用 ${formatNumber(requests.used)}${requests.limitEnabled ? ` / 上限 ${formatNumber(requests.limit)}（${requests.percent}%）` : '（未限额）'}`,
      `成功 ${formatNumber(requests.success)} / 失败 ${formatNumber(requests.failed)}`,
      data.freeChat?.period?.date ? `统计日期：${data.freeChat.period.date}` : '',
      `生成时间：${data.generatedAt}`,
    ].filter(Boolean).join('\n');
  }

  const usage = data.usage || {};
  const pricing = data.pricing || {};
  const currency = pricing.currencySymbol || '$';
  const lines = [
    '今日AI用量（自配 API）',
    '━━━━━━━━━━━━',
    `请求：${formatNumber(usage.requestCount)} 次 / 成功 ${formatNumber(usage.successCount)} / 失败 ${formatNumber(usage.errorCount)}`,
    `Tokens：输入 ${formatNumber(usage.promptTokens)} / 输出 ${formatNumber(usage.completionTokens)} / 总计 ${formatNumber(usage.totalTokens)}`,
  ];
  if (pricing.enabled !== false) {
    lines.push(`成本：${currency}${formatNumber(usage.totalCost)}（预估，均价 ${currency}${formatNumber(usage.averageCost)}）`);
  }
  if (Array.isArray(usage.topScenes) && usage.topScenes.length > 0) {
    lines.push(`场景：${usage.topScenes.map(item => `${item.label} ${formatNumber(item.value)}`).join(' / ')}`);
  }
  lines.push(`生成时间：${data.generatedAt}`);
  return lines.join('\n');
}

export class CrystelfAiUsage extends plugin {
  constructor() {
    super({
      name: 'crystelf-ai-usage',
      dsc: '灵晶今日 AI 用量查询',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^#今日AI用量$',
          fnc: 'showAiUsage',
        },
      ],
    });
  }

  async showAiUsage(e) {
    const data = buildUsageData(e);

    if (data.mode === 'free-chat') {
      try {
        data.freeChat = await fetchFreeChatUsage();
      } catch (error) {
        data.errorMessage = `FREE CHAT 用量读取失败：${error.message}`;
        logger.warn(`[crystelf-ai-usage] FREE CHAT 用量读取失败: ${error.message}`);
      }
    }

    try {
      const imagePath = await renderUsageImage(data);
      if (imagePath) {
        return e.reply(segment.image(imagePath), true);
      }
    } catch (error) {
      logger.warn(`[crystelf-ai-usage] 用量图片渲染失败，回退文本: ${error.message}`);
    }
    return e.reply(buildUsageText(data), true);
  }
}
