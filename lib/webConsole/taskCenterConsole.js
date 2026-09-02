// 任务中心：聚合插件内定时任务（RSS 推送 / 每日群总结 / AI 会话清理）的调度信息与最近执行结果。
// 只读各模块已有的 state / 结果文件与全局 runner 实例，不改动原有调度逻辑；手动运行复用各模块公开入口。
import { readDailyGroupSummaryState, readDailyGroupSummaryResults, normalizeDailyGroupSummaryConfig } from '../groupSummary/dailyGroupSummaryStore.js';

function safeCall(fn, fallback = null) {
  try {
    const value = typeof fn === 'function' ? fn() : null;
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function formatNextRunForDaily(hour = 23, minute = 55, now = new Date()) {
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  // 过了计划时刻（>= 语义补发）后，下一次常规调度在明天
  if (target.getTime() <= now.getTime() - 60 * 1000) {
    target.setDate(target.getDate() + 1);
  }
  return target.toISOString();
}

function summarizeGroupSummaryResults(results = [], limit = 3) {
  return results.slice(-limit).reverse().map(item => ({
    time: String(item.time || ''),
    groupId: String(item.groupId || ''),
    groupName: String(item.groupName || ''),
    status: String(item.status || ''),
  }));
}

export function createTaskCenterConsole(options = {}) {
  const getMainConfig = typeof options.getMainConfig === 'function' ? options.getMainConfig : () => ({});
  const getAiConfig = typeof options.getAiConfig === 'function' ? options.getAiConfig : () => ({});
  const getRssFeeds = typeof options.getRssFeeds === 'function' ? options.getRssFeeds : () => [];

  function buildGroupSummaryTask(now = new Date()) {
    const mainConfig = getMainConfig() || {};
    const aiConfig = getAiConfig() || {};
    const cfg = normalizeDailyGroupSummaryConfig(aiConfig.dailyGroupSummary || {});
    const disabled = mainConfig.ai === false || !cfg.enabled;
    const state = safeCall(() => readDailyGroupSummaryState(), {}) || {};
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const results = safeCall(() => readDailyGroupSummaryResults({ limit: 50 }), []) || [];
    const todayResults = results.filter(item => String(item.dateKey || '') === todayKey);
    const sentToday = todayResults.filter(item => item.status === 'sent').length;
    const failedToday = todayResults.filter(item => item.status === 'failed').length;
    return {
      id: 'daily-group-summary',
      name: '每日群聊总结',
      description: '按计划时刻为启用群发送当日聊天总结（错过时刻会在之后补发）。',
      schedule: `每天 ${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')}`,
      nextRunAt: disabled ? '' : formatNextRunForDaily(cfg.hour, cfg.minute, now),
      status: disabled ? 'disabled' : 'enabled',
      statusLabel: disabled ? '已停用' : '已启用',
      detail: {
        enabledGroups: cfg.targetMode === 'all' ? '全部群' : `${cfg.enabledGroups.length} 个群`,
        sentToday,
        failedToday,
        retentionDays: cfg.retentionDays,
      },
      recentRuns: summarizeGroupSummaryResults(results),
      manual: {
        supported: true,
        action: 'run-daily-group-summary',
        label: '立即检查并发送',
      },
    };
  }

  function buildRssTask(now = new Date()) {
    const feeds = getRssFeeds();
    const nextRunAt = new Date(now);
    nextRunAt.setSeconds(0, 0);
    nextRunAt.setMinutes(nextRunAt.getMinutes() + (10 - (nextRunAt.getMinutes() % 10)));
    return {
      id: 'rss-push',
      name: 'RSS 订阅推送',
      description: '每 10 分钟检查订阅源并推送新条目。',
      schedule: '每 10 分钟（*/10 * * * *）',
      nextRunAt: nextRunAt.toISOString(),
      status: feeds.length > 0 ? 'enabled' : 'empty',
      statusLabel: feeds.length > 0 ? `已订阅 ${feeds.length} 个源` : '暂无订阅',
      detail: {
        feedCount: feeds.length,
      },
      recentRuns: [],
      manual: {
        supported: true,
        action: 'run-rss-push',
        label: '立即拉取推送',
      },
    };
  }

  function buildSessionCleanupTask() {
    return {
      id: 'ai-session-cleanup',
      name: 'AI 会话清理',
      description: '每 5 分钟清理超时的对话会话与过期技能缓存。',
      schedule: '每 5 分钟',
      nextRunAt: '',
      status: 'enabled',
      statusLabel: '后台常驻',
      detail: {},
      recentRuns: [],
      manual: {
        supported: false,
        action: '',
        label: '',
      },
    };
  }

  function buildTaskCenterPayload() {
    const now = new Date();
    return {
      success: true,
      generatedAt: now.toISOString(),
      tasks: [
        buildGroupSummaryTask(now),
        buildRssTask(now),
        buildSessionCleanupTask(),
      ],
    };
  }

  async function runTaskManually(action = '') {
    if (action === 'run-daily-group-summary') {
      const runner = global.__crystelfDailyGroupSummaryRunner;
      if (!runner?.runScheduledSummaries) {
        return { success: false, error: '群总结模块尚未加载或未初始化' };
      }
      await runner.runScheduledSummaries();
      return { success: true, message: '已触发每日群总结检查（按当前配置的补发规则执行）' };
    }
    if (action === 'run-rss-push') {
      const feedsModule = global.__crystelfRssPushInstance;
      if (!feedsModule?.pushFeeds) {
        return { success: false, error: 'RSS 推送模块尚未加载' };
      }
      await feedsModule.pushFeeds();
      return { success: true, message: '已触发 RSS 拉取推送' };
    }
    return { success: false, error: '不支持的任务操作' };
  }

  return {
    buildTaskCenterPayload,
    runTaskManually,
  };
}
