import ConfigControl from '../lib/config/configControl.js';
import { getUsageTrendByDaysSync } from '../lib/ai/usageLogger.js';
import {
  buildHealthReportForChat,
  listScheduledBackupsForChat,
  runScheduledBackupForChat,
  buildGroupManagementInsightsForChat,
  buildTaskCenterForChat,
} from '../lib/webConsole/server.js';

const RESTART_CONFIRM_TIMEOUT_MS = 3 * 60 * 1000;
const RESTART_EXIT_DELAY_MS = 3000;

const pendingRestarts = new Map();

function isGroupManager(e = {}) {
  const role = String(e.sender?.role || '').trim();
  return e.isMaster === true || role === 'owner' || role === 'admin';
}

function getConfirmKey(e = {}) {
  return `${e.group_id || 'private'}:${e.user_id || 'unknown'}`;
}

function pruneExpiredRestarts() {
  const now = Date.now();
  for (const [key, pending] of pendingRestarts) {
    if (pending.expiresAt <= now) pendingRestarts.delete(key);
  }
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatNumber(value = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
}

function formatShortTime(timeMs = 0) {
  const time = new Date(Number(timeMs) || 0);
  if (Number.isNaN(time.getTime()) || !timeMs) return '—';
  return time.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatNextRun(iso = '') {
  if (!iso) return '—';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '—';
  return time.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function buildBackupListText(backups = [], enabled = true, retention = 7) {
  const lines = ['配置备份列表', '━━━━━━━━━━━━━━━━━━'];
  if (!Array.isArray(backups) || backups.length === 0) {
    lines.push(enabled ? '暂无备份（每日定时任务首次执行后生成）' : '暂无备份（定时备份已停用）');
    return lines.join('\n');
  }
  const totalBytes = backups.reduce((sum, item) => sum + (Number(item.sizeBytes) || 0), 0);
  backups.slice(0, 10).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.name}  ${formatBytes(item.sizeBytes)}  ${formatShortTime(item.time)}`);
  });
  if (backups.length > 10) lines.push(`……其余 ${backups.length - 10} 份略`);
  lines.push('');
  lines.push(`共 ${backups.length} 份 / 占用 ${formatBytes(totalBytes)} / 保留上限 ${retention} 份${enabled ? '' : '（定时备份已停用）'}`);
  return lines.join('\n');
}

function buildInsightsText(payload = {}) {
  const totals = payload.totals || {};
  const trend = Array.isArray(payload.trend) ? payload.trend : [];
  const today = trend[trend.length - 1] || null;
  const topActions = Array.isArray(payload.topActions) ? payload.topActions : [];
  const topGroups = Array.isArray(payload.topGroups) ? payload.topGroups : [];

  const lines = ['群风控日报', '━━━━━━━━━━━━━━━━━━'];

  if (today && (today.total > 0)) {
    lines.push(`今日（${today.date}）：共 ${today.total} 条记录`);
    const parts = [];
    if (today.moderation) parts.push(`风控 ${today.moderation}`);
    if (today.join) parts.push(`入群 ${today.join}`);
    if (today.title) parts.push(`头衔 ${today.title}`);
    if (parts.length) lines.push(`  ${parts.join(' / ')}`);
  } else {
    lines.push('今日（' + (today?.date || new Date().toISOString().slice(0, 10)) + '）：暂无记录');
  }

  lines.push('');
  lines.push(`近 ${payload.days || 7} 天累计：${formatNumber(totals.entries)} 条 / 风控命中 ${formatNumber(totals.moderationTriggered)} / 失败操作 ${formatNumber(totals.failedCount)} / 控制台变更 ${formatNumber(totals.webConsoleChanges)}`);

  if (topActions.length) {
    lines.push('');
    lines.push('高频动作：');
    for (const item of topActions.slice(0, 4)) {
      lines.push(`  ${item.label || item.action} × ${formatNumber(item.count)}`);
    }
  }

  if (topGroups.length) {
    lines.push('');
    lines.push('活跃群：');
    lines.push(`  ${topGroups.slice(0, 3).map(item => `${item.groupId}（${formatNumber(item.count)}）`).join(' / ')}`);
  }

  lines.push('');
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  return lines.join('\n');
}

function buildWeeklyUsageText(trend = []) {
  const days = Array.isArray(trend) ? trend : [];
  const totals = days.reduce((acc, day) => {
    acc.requests += Number(day.requests) || 0;
    acc.success += Number(day.success) || 0;
    acc.errors += Number(day.errors) || 0;
    acc.promptTokens += Number(day.prompt_tokens) || 0;
    acc.completionTokens += Number(day.completion_tokens) || 0;
    acc.totalTokens += Number(day.total_tokens) || 0;
    return acc;
  }, { requests: 0, success: 0, errors: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });

  const lines = [`AI 用量周报（近 ${days.length} 天）`, '━━━━━━━━━━━━━━━━━━'];
  lines.push(`请求：${formatNumber(totals.requests)} 次 / 成功 ${formatNumber(totals.success)} / 失败 ${formatNumber(totals.errors)}`);
  lines.push(`Tokens：输入 ${formatNumber(totals.promptTokens)} / 输出 ${formatNumber(totals.completionTokens)} / 总计 ${formatNumber(totals.totalTokens)}`);

  const peak = days.reduce((best, day) => (Number(day.requests) || 0) > (Number(best?.requests) || 0) ? day : best, null);
  if (peak && peak.requests > 0) {
    lines.push(`峰值：${peak.date}（${formatNumber(peak.requests)} 次）`);
    lines.push(`日均：${formatNumber(Math.round(totals.requests / Math.max(days.length, 1)))} 次`);
  }

  const activeDays = days.filter(day => (Number(day.requests) || 0) > 0);
  if (activeDays.length) {
    lines.push('');
    lines.push('按天：');
    const maxRequests = Math.max(...activeDays.map(day => Number(day.requests) || 0), 1);
    for (const day of activeDays) {
      const barLength = Math.max(1, Math.round((Number(day.requests) / maxRequests) * 8));
      const errorMark = (Number(day.errors) || 0) > 0 ? `（失败 ${formatNumber(day.errors)}）` : '';
      lines.push(`  ${day.date.slice(5)}  ${'▇'.repeat(barLength)} ${formatNumber(day.requests)} 次${errorMark}`);
    }
  }

  lines.push('');
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  return lines.join('\n');
}

function buildTaskCenterText(payload = {}) {
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const lines = ['定时任务一览', '━━━━━━━━━━━━━━━━━━'];
  if (!tasks.length) {
    lines.push('暂无任务信息');
    return lines.join('\n');
  }
  for (const task of tasks) {
    lines.push(`【${task.name}】${task.statusLabel || task.status || '-'}`);
    lines.push(`  周期：${task.schedule || '—'}`);
    if (task.status !== 'disabled' && task.nextRunAt) {
      lines.push(`  下次：${formatNextRun(task.nextRunAt)}`);
    }
  }
  lines.push('');
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  return lines.join('\n');
}

export class CrystelfOpsCommands extends plugin {
  constructor() {
    super({
      name: 'crystelf-ops-commands',
      dsc: '灵晶运维命令（体检/备份/风控/用量/任务/重启）',
      event: 'message',
      priority: -1000,
      rule: [
        { reg: '^#灵晶健康报告$', fnc: 'showHealthReport' },
        { reg: '^#灵晶备份列表$', fnc: 'showBackupList' },
        { reg: '^#灵晶立即备份$', fnc: 'runBackupNow' },
        { reg: '^#群风控日报$', fnc: 'showRiskDaily' },
        { reg: '^#AI周报$', fnc: 'showAiWeekly' },
        { reg: '^#灵晶任务$', fnc: 'showTaskCenter' },
        { reg: '^#灵晶重启$', fnc: 'prepareRestart' },
        { reg: '^#?确认重启灵晶$', fnc: 'confirmRestart' },
        { reg: '^#?取消重启灵晶$', fnc: 'cancelRestart' },
      ],
    });
  }

  async showHealthReport(e) {
    if (!e.isMaster) {
      return e.reply('该命令仅限主人使用。', true);
    }
    try {
      const payload = await buildHealthReportForChat();
      if (!payload?.success || !payload?.text) {
        return e.reply('健康报告生成失败，请稍后重试。', true);
      }
      return e.reply(payload.text, true);
    } catch (error) {
      logger.error(`[crystelf-ops] 健康报告生成失败: ${error.message}`);
      return e.reply(`健康报告生成失败：${error.message}`, true);
    }
  }

  async showBackupList(e) {
    if (!e.isMaster) {
      return e.reply('该命令仅限主人使用。', true);
    }
    try {
      const config = ConfigControl.get('config') || {};
      const retention = Math.max(1, Number(config.scheduledBackupRetention) || 7);
      const backups = listScheduledBackupsForChat();
      return e.reply(buildBackupListText(backups, config.scheduledBackupEnabled !== false, retention), true);
    } catch (error) {
      logger.error(`[crystelf-ops] 备份列表读取失败: ${error.message}`);
      return e.reply(`备份列表读取失败：${error.message}`, true);
    }
  }

  async runBackupNow(e) {
    if (!e.isMaster) {
      return e.reply('该命令仅限主人使用。', true);
    }
    try {
      const result = await runScheduledBackupForChat();
      if (!result?.success) {
        return e.reply(`备份失败：${result?.error || '未知错误'}`, true);
      }
      const lines = [
        '配置备份完成。',
        `快照：${result.stamp}（${result.fileCount} 个文件 / ${formatBytes(result.totalBytes)}）`,
        result.removed ? `已清理 ${result.removed} 份超期旧备份` : '无需清理旧备份',
      ];
      return e.reply(lines.join('\n'), true);
    } catch (error) {
      logger.error(`[crystelf-ops] 手动备份失败: ${error.message}`);
      return e.reply(`备份失败：${error.message}`, true);
    }
  }

  async showRiskDaily(e) {
    if (!isGroupManager(e)) {
      return e.reply('该命令仅限主人或群管理员使用。', true);
    }
    try {
      const payload = buildGroupManagementInsightsForChat(7);
      return e.reply(buildInsightsText(payload), true);
    } catch (error) {
      logger.error(`[crystelf-ops] 风控日报生成失败: ${error.message}`);
      return e.reply(`风控日报生成失败：${error.message}`, true);
    }
  }

  async showAiWeekly(e) {
    try {
      const trend = getUsageTrendByDaysSync(7);
      return e.reply(buildWeeklyUsageText(trend), true);
    } catch (error) {
      logger.error(`[crystelf-ops] AI 周报生成失败: ${error.message}`);
      return e.reply(`AI 周报生成失败：${error.message}`, true);
    }
  }

  async showTaskCenter(e) {
    if (!e.isMaster) {
      return e.reply('该命令仅限主人使用。', true);
    }
    try {
      const payload = buildTaskCenterForChat();
      return e.reply(buildTaskCenterText(payload), true);
    } catch (error) {
      logger.error(`[crystelf-ops] 任务信息生成失败: ${error.message}`);
      return e.reply(`任务信息生成失败：${error.message}`, true);
    }
  }

  async prepareRestart(e) {
    if (!e.isMaster) {
      return e.reply('该命令仅限主人使用。', true);
    }
    pruneExpiredRestarts();
    const key = getConfirmKey(e);
    pendingRestarts.set(key, {
      createdAt: Date.now(),
      expiresAt: Date.now() + RESTART_CONFIRM_TIMEOUT_MS,
    });
    return e.reply([
      '即将重启 Yunzai 机器人进程（灵晶插件随宿主一起重启）。',
      '需要进程管理器（pm2 / systemd）托管才会自动拉起；手动 node 启动的环境不会自动恢复。',
      '',
      `当前进程：PID ${process.pid}`,
      `运行时长：${Math.round(process.uptime() / 60)} 分钟`,
      '',
      '确认执行请在 3 分钟内发送：确认重启灵晶',
      '取消请发送：取消重启灵晶',
    ].join('\n'), true);
  }

  async confirmRestart(e) {
    pruneExpiredRestarts();
    if (!e.isMaster) {
      return e.reply('只有主人才能确认重启。', true);
    }
    const key = getConfirmKey(e);
    if (!pendingRestarts.has(key)) {
      return e.reply('没有待确认的重启任务，或确认已过期。请重新发送 #灵晶重启。', true);
    }
    pendingRestarts.delete(key);

    await e.reply(`已确认重启，${Math.round(RESTART_EXIT_DELAY_MS / 1000)} 秒后退出进程（由进程管理器自动拉起）。`, true);
    logger.mark(`[crystelf-plugin] 主人通过 QQ 命令触发重启，${RESTART_EXIT_DELAY_MS}ms 后退出进程`);
    setTimeout(() => process.exit(0), RESTART_EXIT_DELAY_MS);
    return true;
  }

  async cancelRestart(e) {
    pruneExpiredRestarts();
    const key = getConfirmKey(e);
    if (!pendingRestarts.has(key)) {
      return e.reply('没有待取消的重启确认。', true);
    }
    pendingRestarts.delete(key);
    return e.reply('已取消重启。', true);
  }
}
