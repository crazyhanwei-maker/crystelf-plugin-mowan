// 群管理风控面板：聚合 group-management.log 的风控动作统计。
// 只读日志尾部（与日志页同源），统计近 N 天的动作趋势、命中规则 TOP 与被处置用户 TOP。
import fsSync from 'fs';
import path from 'path';

const ACTION_LABELS = {
  content_moderation_triggered: '消息风控命中',
  join_request_auto_approved: '加群自动通过',
  join_request_auto_approve_failed: '加群自动通过失败',
  join_request_manual_approved: '加群手动通过',
  join_request_manual_reject_failed: '加群手动拒绝失败',
  join_request_manual_rejected: '加群手动拒绝',
  join_request_review_kept: '加群申请转人工',
  group_title_application_created: '头衔申请提交',
  group_title_manual_approved: '头衔手动通过',
  group_title_manual_rejected: '头衔手动拒绝',
  group_title_ai_approved: '头衔 AI 通过',
  group_title_ai_rejected: '头衔 AI 拒绝',
};

// 与内容风控直接相关的动作（禁言/警告等执行结果由 summary 字段补充展示）
const MODERATION_ACTIONS = new Set([
  'content_moderation_triggered',
  'content_moderation_action_executed',
  'content_moderation_action_blocked',
]);

function parseLogLines(content = '') {
  const items = [];
  for (const line of String(content || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {
      // 尾部截断产生的半行跳过
    }
  }
  return items;
}

function getTopEntries(map, limit = 5) {
  return Array.from(map.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([key, value]) => ({ key, ...value }));
}

export function createGroupManagementInsightsConsole(options = {}) {
  const logFile = options.groupManagementLogFile || '';
  const readTailBytes = Math.max(Number(options.readTailBytes || 0), 400 * 1024);

  function readRecentEntries(days = 7) {
    if (!logFile) return [];
    let content = '';
    try {
      const stat = fsSync.statSync(logFile);
      const length = Math.min(stat.size, readTailBytes);
      if (length <= 0) return [];
      const fd = fsSync.openSync(logFile, 'r');
      try {
        const buffer = Buffer.alloc(length);
        fsSync.readSync(fd, buffer, 0, length, stat.size - length);
        content = buffer.toString('utf8');
      } finally {
        fsSync.closeSync(fd);
      }
    } catch {
      return [];
    }
    const cutoff = Date.now() - days * 86400000;
    return parseLogLines(content)
      .map(item => {
        const timeMs = new Date(item.time || 0).getTime();
        return Number.isFinite(timeMs) ? { ...item, timeMs } : null;
      })
      .filter(item => item && item.timeMs >= cutoff);
  }

  function buildGroupManagementInsightsPayload(days = 7) {
    const totalDays = Math.min(Math.max(Number(days) || 7, 1), 30);
    const entries = readRecentEntries(totalDays);
    const dayBuckets = new Map();
    const actionCounts = new Map();
    const userCounts = new Map();
    const groupCounts = new Map();
    let moderationTriggered = 0;
    let failedCount = 0;
    let webConsoleChanges = 0;

    for (let offset = totalDays - 1; offset >= 0; offset--) {
      const day = new Date(Date.now() - offset * 86400000);
      const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      dayBuckets.set(dateKey, { date: dateKey, total: 0, moderation: 0, join: 0, title: 0 });
    }

    for (const entry of entries) {
      const action = String(entry.action || entry.type || 'unknown');
      const localDay = new Date(entry.timeMs);
      const dateKey = `${localDay.getFullYear()}-${String(localDay.getMonth() + 1).padStart(2, '0')}-${String(localDay.getDate()).padStart(2, '0')}`;
      const bucket = dayBuckets.get(dateKey);
      if (bucket) {
        bucket.date = dateKey;
        bucket.total += 1;
        if (action.startsWith('join_request')) bucket.join += 1;
        else if (action.startsWith('group_title')) bucket.title += 1;
        else if (MODERATION_ACTIONS.has(action) || action.startsWith('content_moderation')) bucket.moderation += 1;
      }

      const label = ACTION_LABELS[action] || action;
      actionCounts.set(action, {
        count: (actionCounts.get(action)?.count || 0) + 1,
        label,
      });

      if (MODERATION_ACTIONS.has(action) || action === 'content_moderation_triggered') moderationTriggered += 1;
      if (entry.success === false || entry.error) failedCount += 1;
      if (entry.source === 'webConsole') webConsoleChanges += 1;

      const userId = String(entry.user_id || entry.userId || '').trim();
      if (userId) {
        const current = userCounts.get(userId) || { count: 0, nickname: '', actions: 0, mutes: 0 };
        current.count += 1;
        current.nickname = String(entry.nickname || current.nickname || '').slice(0, 40);
        if (MODERATION_ACTIONS.has(action) || action === 'content_moderation_triggered') current.actions += 1;
        const executedAction = String(entry.summary?.action || entry.summary?.executedAction || '');
        if (executedAction === 'mute' || executedAction === 'kick') current.mutes += 1;
        userCounts.set(userId, current);
      }

      const groupId = String(entry.group_id || entry.groupId || '').trim();
      if (groupId) {
        const current = groupCounts.get(groupId) || { count: 0 };
        current.count += 1;
        groupCounts.set(groupId, current);
      }
    }

    return {
      success: true,
      days: totalDays,
      generatedAt: new Date().toISOString(),
      totals: {
        entries: entries.length,
        moderationTriggered,
        failedCount,
        webConsoleChanges,
      },
      trend: Array.from(dayBuckets.values()),
      topActions: getTopEntries(actionCounts, 6).map(item => ({ action: item.key, label: item.label, count: item.count })),
      topUsers: getTopEntries(userCounts, 5).map(item => ({ userId: item.key, ...item })),
      topGroups: getTopEntries(groupCounts, 5).map(item => ({ groupId: item.key, ...item })),
    };
  }

  return {
    buildGroupManagementInsightsPayload,
  };
}
