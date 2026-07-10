import {
  getDailyGroupSummaryMessageStats,
  getDailyGroupSummaryRun,
  getDailyGroupSummaryTargetGroupIds,
  getDailySummaryDateKey,
  isDailySummaryScheduleDue,
  isGroupDailySummaryEnabled,
  listDailyGroupSummaryLocks,
  normalizeDailyGroupSummaryConfig,
  readDailyGroupSummaryResults,
} from '../groupSummary/dailyGroupSummaryStore.js';

function normalizeDateKey(value = '') {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return getDailySummaryDateKey();
}

function formatScheduleTime(cfg = {}) {
  return `${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')}`;
}

function normalizeLimit(value, fallback = 120) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(20, Math.min(1000, Math.round(number)));
}

function normalizeStatus(value = '') {
  const status = String(value || '').trim();
  if (status === 'sent') return 'sent';
  if (status === 'skipped') return 'skipped';
  if (status === 'failed') return 'failed';
  if (status === 'manual') return 'manual';
  if (status === 'manual_failed') return 'manual_failed';
  return status || 'none';
}

function getStatusLabel(status = '') {
  const value = normalizeStatus(status);
  if (value === 'sent') return '已发送';
  if (value === 'skipped') return '已跳过';
  if (value === 'failed') return '失败';
  if (value === 'manual') return '手动生成';
  if (value === 'manual_failed') return '手动失败';
  return '暂无记录';
}

function getDiagnosisStatus(item = {}, context = {}) {
  if (context.mainAiDisabled) {
    return { status: 'disabled', label: 'AI 已关闭', tone: 'muted', reason: '主 AI 开关关闭，自动群总结不会执行。' };
  }
  if (!context.summaryEnabled) {
    return { status: 'disabled', label: '总结已关闭', tone: 'muted', reason: '每日群聊总结总开关关闭。' };
  }
  if (item.blocked) {
    return { status: 'blocked', label: '已禁用', tone: 'muted', reason: '该群在每日总结禁用列表中。' };
  }
  if (!item.enabled) {
    return { status: 'not_target', label: '未启用', tone: 'muted', reason: '该群不在当前每日总结范围内。' };
  }
  if (item.lock?.active) {
    return { status: 'running', label: '生成中', tone: 'warning', reason: '该群存在未过期的生成锁，说明当前可能正在生成或发送。' };
  }
  if (item.run?.status === 'sent') {
    return { status: 'sent', label: '今日已发', tone: item.duplicateSentCount > 1 ? 'warning' : 'success', reason: item.duplicateSentCount > 1 ? '今日有重复发送记录。' : '今日已成功发送自动总结。' };
  }
  if (item.run?.status === 'failed') {
    return { status: 'failed', label: '发送失败', tone: 'error', reason: item.run.error || '今日自动总结失败。' };
  }
  if (item.run?.status === 'skipped') {
    return { status: 'skipped', label: '已跳过', tone: 'neutral', reason: item.run.error || '今日自动总结已跳过。' };
  }
  if (item.messageCount < context.minMessages) {
    return { status: 'insufficient', label: '消息不足', tone: 'neutral', reason: `当前记录 ${item.messageCount} 条，低于阈值 ${context.minMessages} 条。` };
  }
  if (!context.scheduleDue) {
    return { status: 'waiting', label: '等待定时', tone: 'neutral', reason: `计划执行时间 ${context.scheduleTime}，尚未到达。` };
  }
  return { status: 'due', label: '待执行', tone: 'warning', reason: '已到计划时间且满足消息数量，等待自动总结任务处理。' };
}

function groupResultsByGroup(results = []) {
  const map = new Map();
  for (const result of results) {
    const groupId = String(result.groupId || '').trim();
    if (!groupId) continue;
    const list = map.get(groupId) || [];
    list.push(result);
    map.set(groupId, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) => (Date.parse(left.time || '') || 0) - (Date.parse(right.time || '') || 0));
  }
  return map;
}

function buildRecommendations(summary = {}, groups = [], cfg = {}) {
  const items = [];
  if (!cfg.enabled) {
    items.push('每日群聊总结当前关闭。需要自动发送时，请先在群管理或插件设置中启用。');
  }
  if (summary.activeLockCount > 0) {
    items.push(`当前有 ${summary.activeLockCount} 个群总结任务正在运行，等待完成后再判断是否异常。`);
  }
  if (summary.staleLockCount > 0) {
    items.push(`发现 ${summary.staleLockCount} 个过期锁，通常来自异常退出；下一次任务会自动清理或抢占。`);
  }
  if (summary.duplicateGroupCount > 0) {
    items.push(`今天有 ${summary.duplicateGroupCount} 个群出现重复自动总结记录。建议更新到带整轮运行锁的版本并重启 Bot。`);
  }
  if (summary.failedCount > 0) {
    items.push(`今天有 ${summary.failedCount} 个群总结失败，优先查看失败原因列里的 API、发送能力或适配器错误。`);
  }
  if (cfg.targetMode === 'selected' && Number(summary.enabledGroupCount || 0) === 0) {
    items.push('当前是“只总结启用群”模式，但启用群列表为空，自动总结不会覆盖任何群。');
  }
  const insufficient = groups.filter(group => group.status === 'insufficient').length;
  if (insufficient > 0) {
    items.push(`${insufficient} 个群消息数未达到阈值，不会自动发送总结。`);
  }
  if (items.length === 0) {
    items.push('当前群总结任务状态正常，没有发现重复发送、运行锁残留或失败记录。');
  }
  return Array.from(new Set(items)).slice(0, 8);
}

export function createGroupSummaryDiagnosticsConsole(options = {}) {
  const { ConfigControl } = options;

  async function buildPayload(params = {}) {
    const mainConfig = ConfigControl.get('config') || {};
    const aiConfig = ConfigControl.get('ai') || {};
    const cfg = normalizeDailyGroupSummaryConfig(aiConfig.dailyGroupSummary || {});
    const dateKey = normalizeDateKey(params.dateKey || params.date || '');
    const todayKey = getDailySummaryDateKey();
    const limit = normalizeLimit(params.limit, 160);
    const now = new Date();
    const scheduleDue = dateKey === todayKey ? isDailySummaryScheduleDue(now, cfg) : true;
    const scheduleTime = formatScheduleTime(cfg);

    const messageStats = getDailyGroupSummaryMessageStats(dateKey, cfg);
    const results = readDailyGroupSummaryResults({ dateKey, limit: Math.max(limit, 500) });
    const resultsByGroup = groupResultsByGroup(results);
    const locks = listDailyGroupSummaryLocks({ dateKey });
    const locksByGroup = new Map(locks.map(lock => [lock.groupId, lock]));
    const targetGroupIds = getDailyGroupSummaryTargetGroupIds(dateKey, cfg);
    const runsByGroup = Object.keys(messageStats)
      .concat(cfg.enabledGroups, cfg.blockedGroups, targetGroupIds)
      .concat(results.map(item => item.groupId))
      .concat(locks.map(item => item.groupId))
      .filter(Boolean);
    const groupIds = Array.from(new Set(runsByGroup)).sort((left, right) => String(left).localeCompare(String(right), 'zh-CN'));
    const context = {
      mainAiDisabled: mainConfig.ai === false,
      summaryEnabled: cfg.enabled,
      scheduleDue,
      scheduleTime,
      minMessages: cfg.minMessages,
    };

    const groups = groupIds.map((groupId) => {
      const stat = messageStats[groupId] || { count: 0, latestMessages: [] };
      const run = getDailyGroupSummaryRun(dateKey, groupId);
      const groupResults = resultsByGroup.get(groupId) || [];
      const sentResults = groupResults.filter(item => item.status === 'sent');
      const failedResults = groupResults.filter(item => item.status === 'failed' || item.status === 'manual_failed');
      const latestResult = groupResults[groupResults.length - 1] || null;
      const enabled = isGroupDailySummaryEnabled(groupId, mainConfig, aiConfig);
      const blocked = cfg.blockedGroups.includes(groupId);
      const lock = locksByGroup.get(groupId);
      const base = {
        groupId,
        groupName: stat.groupName || latestResult?.groupName || '',
        enabled,
        blocked,
        selected: cfg.enabledGroups.includes(groupId),
        targetMode: cfg.targetMode,
        messageCount: Number(stat.count || 0),
        firstMessageAt: stat.firstMessageAt || '',
        lastMessageAt: stat.lastMessageAt || '',
        latestMessages: Array.isArray(stat.latestMessages) ? stat.latestMessages : [],
        run: run ? {
          time: String(run.time || ''),
          status: normalizeStatus(run.status),
          statusLabel: getStatusLabel(run.status),
          messageCount: Number(run.messageCount || 0),
          error: String(run.error || ''),
        } : null,
        latestResult,
        resultCount: groupResults.length,
        sentCount: sentResults.length,
        failedCount: failedResults.length,
        duplicateSentCount: Math.max(0, sentResults.length),
        lock: lock ? {
          active: lock.stale !== true,
          stale: lock.stale === true,
          time: lock.time || '',
          pid: lock.pid || null,
        } : null,
      };
      const diagnosis = getDiagnosisStatus(base, context);
      return {
        ...base,
        status: diagnosis.status,
        statusLabel: diagnosis.label,
        tone: diagnosis.tone,
        reason: diagnosis.reason,
      };
    });

    const sentCount = groups.filter(group => group.run?.status === 'sent').length;
    const failedCount = groups.filter(group => group.run?.status === 'failed').length;
    const skippedCount = groups.filter(group => group.run?.status === 'skipped').length;
    const duplicateGroupCount = groups.filter(group => group.sentCount > 1).length;
    const activeLockCount = locks.filter(lock => lock.stale !== true).length;
    const staleLockCount = locks.filter(lock => lock.stale === true).length;
    const totalMessages = Object.values(messageStats).reduce((sum, item) => sum + Number(item.count || 0), 0);
    const scheduleRun = globalThis.__crystelfDailyGroupSummaryScheduleRun || null;

    const summary = {
      dateKey,
      todayKey,
      enabled: cfg.enabled,
      mainAiEnabled: mainConfig.ai !== false,
      targetMode: cfg.targetMode,
      enabledGroupCount: cfg.enabledGroups.length,
      blockedGroupCount: cfg.blockedGroups.length,
      scheduleTime,
      scheduleDue,
      minMessages: cfg.minMessages,
      maxMessages: cfg.maxMessages,
      groupCount: groups.length,
      messageGroupCount: Object.keys(messageStats).length,
      totalMessages,
      sentCount,
      failedCount,
      skippedCount,
      duplicateGroupCount,
      activeLockCount,
      staleLockCount,
      running: Boolean(scheduleRun?.runKey),
      runningSince: String(scheduleRun?.startedAt || ''),
      runningKey: String(scheduleRun?.runKey || ''),
    };

    return {
      success: true,
      data: {
        checkedAt: new Date().toISOString(),
        config: {
          enabled: cfg.enabled,
          targetMode: cfg.targetMode,
          enabledGroups: cfg.enabledGroups,
          blockedGroups: cfg.blockedGroups,
          scheduleTime,
          minMessages: cfg.minMessages,
          maxMessages: cfg.maxMessages,
          retentionDays: cfg.retentionDays,
          imageEnabled: cfg.imageEnabled,
        },
        summary,
        recommendations: buildRecommendations(summary, groups, cfg),
        groups,
        recentResults: results.slice(-limit).reverse(),
        locks,
      },
    };
  }

  return { buildPayload };
}
