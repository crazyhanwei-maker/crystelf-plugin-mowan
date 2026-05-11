import ConfigControl from '../lib/config/configControl.js';
import AiCaller from '../lib/ai/aiCaller.js';
import { appendGroupManagementLog } from '../lib/groupManagement/groupManagementLog.js';
import {
  appendDailyGroupSummaryResult,
  cleanupDailyGroupSummaryFiles,
  getDailyGroupSummaryRun,
  getDailyGroupSummaryTargetGroupIds,
  getDailySummaryDateKey,
  isDailySummaryScheduleDue,
  isGroupDailySummaryEnabled,
  markDailyGroupSummaryRun,
  normalizeDailyGroupSummaryConfig,
  readDailyGroupSummaryMessages,
  recordDailyGroupSummaryMessage,
} from '../lib/groupSummary/dailyGroupSummaryStore.js';

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  mark: (...args) => console.log(...args),
};

function getBotRoot() {
  return typeof globalThis !== 'undefined' ? globalThis.Bot : null;
}

function getBotInstances() {
  const root = getBotRoot();
  const result = [];
  const seen = new Set();
  const add = (bot) => {
    if (!bot || typeof bot !== 'object' || seen.has(bot)) return;
    seen.add(bot);
    result.push(bot);
  };

  add(root);
  for (const field of ['bots', 'clients', 'uin']) {
    const value = root?.[field];
    if (value instanceof Map) {
      for (const bot of value.values()) add(bot);
    } else if (Array.isArray(value) || value instanceof Set) {
      for (const bot of value) add(bot);
    } else if (value && typeof value === 'object') {
      for (const bot of Object.values(value)) add(bot);
    }
  }
  return result;
}

function normalizeGroupId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function getApiGroupId(groupId = '') {
  const numeric = Number(groupId);
  return Number.isSafeInteger(numeric) ? numeric : String(groupId);
}

function sanitizeSummaryText(text = '', maxLength = 1200) {
  const normalized = String(text || '')
    .replace(/```[\w-]*\n?/g, '')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function formatSummaryTime(value = '') {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function trimMessageText(value = '', maxLength = 220) {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function extractHistoryMessageText(message = [], config = {}) {
  const cfg = normalizeDailyGroupSummaryConfig(config);
  const text = (Array.isArray(message) ? message : [])
    .map((item) => {
      if (item?.type === 'text') return String(item.text || '');
      if (item?.type === 'at') return `@${item.qq || ''}`;
      if (item?.type === 'image') return '[图片]';
      if (item?.type === 'record') return '[语音]';
      if (item?.type === 'video') return '[视频]';
      return '';
    })
    .join('')
    .trim();
  const normalized = trimMessageText(text, cfg.maxMessageChars);
  if (!normalized) return '';
  if (!cfg.includeCommands && /^(#|＃|\/)/.test(normalized.trim())) return '';
  return normalized;
}

function normalizeHistoryMessageForSummary(item = {}, context = {}) {
  const userId = String(item.user_id ?? item.userId ?? item.sender?.user_id ?? '').trim();
  const selfId = String(context.selfId || '').trim();
  if (!userId || (selfId && userId === selfId)) return null;

  const text = extractHistoryMessageText(item.message, context.config || {});
  if (!text) return null;

  const timeNumber = Number(item.time || item.timestamp || 0);
  const timeMs = Number.isFinite(timeNumber) && timeNumber > 0
    ? (timeNumber > 1000000000000 ? timeNumber : timeNumber * 1000)
    : Date.now();

  return {
    time: new Date(timeMs).toISOString(),
    groupId: context.groupId,
    groupName: context.groupName || '',
    userId,
    userName: item.sender?.card || item.sender?.nickname || item.nickname || `QQ${userId}`,
    messageId: item.message_id ?? item.messageId ?? null,
    text,
  };
}

async function fetchRecentGroupSummaryMessages(e = {}, config = {}) {
  if (typeof e?.group?.getChatHistory !== 'function') return [];
  const cfg = normalizeDailyGroupSummaryConfig(config);
  const limit = Math.min(Math.max(cfg.maxMessages, 10), 200);
  const history = await e.group.getChatHistory(e.message_id || 0, limit);
  const groupId = normalizeGroupId(e.group_id);
  const groupName = e.group?.info?.group_name || e.group_name || '';
  return (Array.isArray(history) ? history : [])
    .map(item => normalizeHistoryMessageForSummary(item, {
      groupId,
      groupName,
      selfId: e.self_id || e.bot?.uin,
      config: cfg,
    }))
    .filter(Boolean)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .slice(-cfg.maxMessages);
}

function buildDailySummaryPrompt(groupId = '', groupName = '', dateKey = '', messages = [], config = {}) {
  const cfg = normalizeDailyGroupSummaryConfig(config);
  const lines = messages.map(item => {
    const userName = item.userName || `QQ${item.userId || '未知'}`;
    return `[${formatSummaryTime(item.time)}] ${userName}: ${item.text}`;
  });
  const customPrompt = cfg.prompt
    ? `\n额外要求：\n${cfg.prompt}\n`
    : '';
  return [
    `请根据以下群聊记录，为群 ${groupName || groupId} 生成 ${dateKey} 的每日群聊总结。`,
    customPrompt,
    '输出要求：',
    `1. 标题使用“${cfg.title}”。`,
    '2. 用中文输出，控制在 3-8 条要点内，内容少时可以更短。',
    '3. 总结主要话题、重要信息、待办或未解决问题。',
    '4. 不要编造聊天记录里没有的信息，不要泄露 QQ 号，不要大段复述原文，不要 @ 任何人。',
    '5. 如果聊天内容以闲聊为主，就自然概括氛围和关键词。',
    '',
    '群聊记录如下：',
    lines.join('\n'),
  ].join('\n');
}

async function generateGroupSummaryText(groupId = '', groupName = '', dateKey = '', messages = [], cfg = {}, aiConfig = {}) {
  const prompt = buildDailySummaryPrompt(groupId, groupName, dateKey, messages, cfg);
  const result = await AiCaller.callAiDirect(prompt, [], [], null, [], {
    systemPrompt: '你是群聊日报助手，只负责把聊天记录总结成适合发回群里的中文日报。',
    model: cfg.model || aiConfig.workingModel || aiConfig.modelType || aiConfig.model,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    scene: 'daily_group_summary',
    sessionId: `group:${groupId}:daily-summary:${dateKey}`,
    groupId,
    userId: 'system',
  });

  if (!result?.success) {
    throw new Error(result?.error || 'AI 总结失败');
  }

  const summary = sanitizeSummaryText(result.response, cfg.maxSummaryChars);
  if (!summary) {
    throw new Error('AI 总结内容为空');
  }
  return summary;
}

async function sendGroupMessage(groupId = '', message = '') {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) {
    throw new Error('群号无效');
  }

  for (const bot of getBotInstances()) {
    if (typeof bot.pickGroup === 'function') {
      for (const id of [getApiGroupId(normalizedGroupId), normalizedGroupId]) {
        try {
          const group = bot.pickGroup(id);
          if (typeof group?.sendMsg === 'function') {
            return await group.sendMsg(message);
          }
        } catch {
          // Try the next supported sending path.
        }
      }
    }

    if (typeof bot.sendApi === 'function') {
      try {
        return await bot.sendApi('send_group_msg', {
          group_id: getApiGroupId(normalizedGroupId),
          message,
        });
      } catch {
        // Try the next bot instance.
      }
    }

    if (typeof bot.sendGroupMsg === 'function') {
      try {
        return await bot.sendGroupMsg(getApiGroupId(normalizedGroupId), message);
      } catch {
        // Try the next bot instance.
      }
    }
  }

  throw new Error('当前运行时不支持发送群消息');
}

export class dailyGroupSummary extends plugin {
  constructor() {
    super({
      name: 'daily-group-summary',
      dsc: '每日群聊总结',
      event: 'message.group',
      priority: 9999,
      rule: [
        {
          reg: '^#群总结$',
          fnc: 'manualGroupSummary',
        },
      ],
    });
    this.processingGroups = new Set();
    this.lastCleanupDate = '';
    this.ensureScheduler();
  }

  ensureScheduler() {
    global.__crystelfDailyGroupSummaryRunner = this;
    if (global.__crystelfDailyGroupSummaryTimer) return;

    global.__crystelfDailyGroupSummaryTimer = setInterval(() => {
      global.__crystelfDailyGroupSummaryRunner?.runScheduledSummaries?.()
        .catch(error => logger.warn(`[daily-group-summary] 定时总结检查失败: ${error.message}`));
    }, 60 * 1000);

    setTimeout(() => {
      global.__crystelfDailyGroupSummaryRunner?.runScheduledSummaries?.()
        .catch(error => logger.warn(`[daily-group-summary] 启动后总结检查失败: ${error.message}`));
    }, 15 * 1000);

    logger.mark('[daily-group-summary] 每日群聊总结定时器已启动');
  }

  async accept(e) {
    try {
      const mainConfig = ConfigControl.get('config') || {};
      const aiConfig = ConfigControl.get('ai') || {};
      const groupId = e?.group_id;
      if (!isGroupDailySummaryEnabled(groupId, mainConfig, aiConfig)) return false;
      recordDailyGroupSummaryMessage(e, aiConfig.dailyGroupSummary || {});
    } catch (error) {
      logger.warn(`[daily-group-summary] 记录群消息失败: ${error.message}`);
    }
    return false;
  }

  async manualGroupSummary(e) {
    const mainConfig = ConfigControl.get('config') || {};
    const aiConfig = ConfigControl.get('ai') || {};
    if (mainConfig.ai === false) {
      return e.reply('AI 功能当前是关闭的，无法生成群总结。', true);
    }

    const groupId = normalizeGroupId(e.group_id);
    if (!groupId) {
      return e.reply('只能在群聊里使用 #群总结。', true);
    }

    const cfg = normalizeDailyGroupSummaryConfig(aiConfig.dailyGroupSummary || {});
    const dateKey = getDailySummaryDateKey();
    const processingKey = `manual:${dateKey}:${groupId}`;
    if (this.processingGroups.has(processingKey)) {
      return e.reply('本群总结正在生成中，请稍等。', true);
    }
    this.processingGroups.add(processingKey);

    try {
      await e.reply('正在生成本群今日总结，请稍等。', true);
      let messages = readDailyGroupSummaryMessages(dateKey, groupId, cfg);
      if (messages.length === 0) {
        messages = await fetchRecentGroupSummaryMessages(e, cfg);
      }

      const minManualMessages = Math.min(Math.max(cfg.minMessages, 1), 3);
      if (messages.length < minManualMessages) {
        return e.reply(`本群今天可总结的消息太少，目前只有 ${messages.length} 条。`, true);
      }

      const groupName = [...messages].reverse().find(item => item.groupName)?.groupName
        || e.group?.info?.group_name
        || e.group_name
        || '';
      const summary = await generateGroupSummaryText(groupId, groupName, dateKey, messages, cfg, aiConfig);
      appendDailyGroupSummaryResult({
        dateKey,
        groupId,
        groupName,
        status: 'manual',
        messageCount: messages.length,
        summary,
      });
      appendGroupManagementLog({
        action: 'daily_group_summary_manual_sent',
        source: 'dailyGroupSummary',
        success: true,
        group_id: groupId,
        user_id: e.user_id,
        sections: ['dailySummary'],
        changes: [`已生成手动群总结，消息数 ${messages.length}`],
        summary: {
          dateKey,
          messageCount: messages.length,
        },
      });
      return e.reply(summary);
    } catch (error) {
      logger.warn(`[daily-group-summary] 手动生成群 ${groupId} 总结失败: ${error.message}`);
      appendDailyGroupSummaryResult({
        dateKey,
        groupId,
        status: 'manual_failed',
        messageCount: readDailyGroupSummaryMessages(dateKey, groupId, cfg).length,
        error: error.message,
      });
      appendGroupManagementLog({
        action: 'daily_group_summary_manual_failed',
        source: 'dailyGroupSummary',
        success: false,
        group_id: groupId,
        user_id: e.user_id,
        error: error.message,
        sections: ['dailySummary'],
        changes: ['手动群总结生成失败'],
        summary: {
          dateKey,
        },
      });
      return e.reply(`群总结生成失败：${error.message}`, true);
    } finally {
      this.processingGroups.delete(processingKey);
    }
  }

  async runScheduledSummaries() {
    const mainConfig = ConfigControl.get('config') || {};
    const aiConfig = ConfigControl.get('ai') || {};
    const cfg = normalizeDailyGroupSummaryConfig(aiConfig.dailyGroupSummary || {});
    if (mainConfig.ai === false || !cfg.enabled) return;

    const now = new Date();
    if (!isDailySummaryScheduleDue(now, cfg)) return;

    const dateKey = getDailySummaryDateKey(now);
    if (this.lastCleanupDate !== dateKey) {
      cleanupDailyGroupSummaryFiles(cfg.retentionDays);
      this.lastCleanupDate = dateKey;
    }

    const targetGroupIds = getDailyGroupSummaryTargetGroupIds(dateKey, cfg)
      .filter(groupId => isGroupDailySummaryEnabled(groupId, mainConfig, aiConfig));

    for (const groupId of targetGroupIds) {
      await this.runGroupSummary(groupId, dateKey, cfg, aiConfig);
    }
  }

  async runGroupSummary(groupId = '', dateKey = getDailySummaryDateKey(), cfg = {}, aiConfig = {}) {
    const normalizedGroupId = normalizeGroupId(groupId);
    if (!normalizedGroupId) return;
    if (getDailyGroupSummaryRun(dateKey, normalizedGroupId)) return;

    const processingKey = `${dateKey}:${normalizedGroupId}`;
    if (this.processingGroups.has(processingKey)) return;
    this.processingGroups.add(processingKey);

    try {
      const messages = readDailyGroupSummaryMessages(dateKey, normalizedGroupId, cfg);
      const groupName = [...messages].reverse().find(item => item.groupName)?.groupName || '';
      if (messages.length < cfg.minMessages) {
        markDailyGroupSummaryRun(dateKey, normalizedGroupId, {
          status: 'skipped',
          messageCount: messages.length,
          error: `消息数 ${messages.length} 小于 ${cfg.minMessages}`,
        });
        appendDailyGroupSummaryResult({
          dateKey,
          groupId: normalizedGroupId,
          groupName,
          status: 'skipped',
          messageCount: messages.length,
          error: `消息数 ${messages.length} 小于 ${cfg.minMessages}`,
        });
        appendGroupManagementLog({
          action: 'daily_group_summary_skipped',
          source: 'dailyGroupSummary',
          success: true,
          group_id: normalizedGroupId,
          sections: ['dailySummary'],
          changes: [`每日群聊总结已跳过，消息数 ${messages.length} 小于 ${cfg.minMessages}`],
          summary: {
            dateKey,
            messageCount: messages.length,
            minMessages: cfg.minMessages,
          },
        });
        return;
      }

      const summary = await generateGroupSummaryText(normalizedGroupId, groupName, dateKey, messages, cfg, aiConfig);

      await sendGroupMessage(normalizedGroupId, summary);
      markDailyGroupSummaryRun(dateKey, normalizedGroupId, {
        status: 'sent',
        messageCount: messages.length,
      });
      appendDailyGroupSummaryResult({
        dateKey,
        groupId: normalizedGroupId,
        groupName,
        status: 'sent',
        messageCount: messages.length,
        summary,
      });
      appendGroupManagementLog({
        action: 'daily_group_summary_sent',
        source: 'dailyGroupSummary',
        success: true,
        group_id: normalizedGroupId,
        sections: ['dailySummary'],
        changes: [`已发送每日群聊总结，消息数 ${messages.length}`],
        summary: {
          dateKey,
          messageCount: messages.length,
        },
      });
      logger.info(`[daily-group-summary] 已发送群 ${normalizedGroupId} 的每日总结，消息数 ${messages.length}`);
    } catch (error) {
      markDailyGroupSummaryRun(dateKey, normalizedGroupId, {
        status: 'failed',
        messageCount: readDailyGroupSummaryMessages(dateKey, normalizedGroupId, cfg).length,
        error: error.message,
      });
      appendDailyGroupSummaryResult({
        dateKey,
        groupId: normalizedGroupId,
        status: 'failed',
        messageCount: readDailyGroupSummaryMessages(dateKey, normalizedGroupId, cfg).length,
        error: error.message,
      });
      appendGroupManagementLog({
        action: 'daily_group_summary_failed',
        source: 'dailyGroupSummary',
        success: false,
        group_id: normalizedGroupId,
        error: error.message,
        sections: ['dailySummary'],
        changes: ['每日群聊总结发送失败'],
        summary: {
          dateKey,
          messageCount: readDailyGroupSummaryMessages(dateKey, normalizedGroupId, cfg).length,
        },
      });
      logger.warn(`[daily-group-summary] 群 ${normalizedGroupId} 每日总结失败: ${error.message}`);
    } finally {
      this.processingGroups.delete(processingKey);
    }
  }
}
