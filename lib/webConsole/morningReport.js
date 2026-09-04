// 每日运维晨报：每天早上聚合看门狗事件 / 昨日 AI 用量 / 备份状态 / 当前水位，推送给主人。
// 全部数据源复用现有模块，仅在已配置主人 QQ 且晨报开启时工作；推送走 masterNotifier（QQ 恢复瞬间送达）。
// 服务器常为 UTC 时区：显示与调度统一按 timezoneOffset（分钟，默认 +480 北京时间）换算。
const DEFAULT_HOUR = 8;
const DEFAULT_TIMEZONE_OFFSET_MINUTES = 480;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 每小时醒一次，跨过发送时刻即发

function formatNumber(value = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
}

function toDisplayDate(date = new Date(), offsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  return new Date(date.getTime() + offsetMinutes * 60000);
}

function formatLocalTime(ms = 0) {
  const time = new Date(Number(ms) || 0);
  if (!ms || Number.isNaN(time.getTime())) return '—';
  return time.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function createMorningReport(options = {}) {
  const logger = options.logger || { warn: () => {}, mark: () => {}, info: () => {} };
  const notifyMasters = typeof options.notifyMasters === 'function' ? options.notifyMasters : null;
  const getEnabled = typeof options.getEnabled === 'function' ? options.getEnabled : () => true;
  const getHour = typeof options.getHour === 'function' ? options.getHour : () => DEFAULT_HOUR;
  const getTimezoneOffset = typeof options.getTimezoneOffset === 'function' ? options.getTimezoneOffset : () => DEFAULT_TIMEZONE_OFFSET_MINUTES;
  // 数据源注入（均返回同步或 Promise 数据）
  const getWatchdogEvents = typeof options.getWatchdogEvents === 'function' ? options.getWatchdogEvents : () => [];
  const getYesterdayUsage = typeof options.getYesterdayUsage === 'function' ? options.getYesterdayUsage : () => null;
  const getWeeklyTrend = typeof options.getWeeklyTrend === 'function' ? options.getWeeklyTrend : () => null;
  const getBackupStatus = typeof options.getBackupStatus === 'function' ? options.getBackupStatus : () => null;
  const getResourceStatus = typeof options.getResourceStatus === 'function' ? options.getResourceStatus : () => null;
  // 已发日期持久化：内存态在 pm2 重启后丢失会导致"重启即补发"，读写回调由宿主注入（落到运行配置目录）
  const getSavedDay = typeof options.getSavedDay === 'function' ? options.getSavedDay : () => '';
  const saveSentDay = typeof options.saveSentDay === 'function' ? options.saveSentDay : (() => {});

  const state = {
    timer: null,
    lastSentDay: '',
  };

  function resolveOffsetMinutes() {
    const raw = Number(getTimezoneOffset());
    return Number.isFinite(raw) && raw >= -720 && raw <= 840 ? Math.round(raw) : DEFAULT_TIMEZONE_OFFSET_MINUTES;
  }

  function buildReportText() {
    const offsetMinutes = resolveOffsetMinutes();
    const displayNow = toDisplayDate(new Date(), offsetMinutes);
    const lines = [`🌅 灵晶晨报 ${displayNow.getFullYear()}-${String(displayNow.getMonth() + 1).padStart(2, '0')}-${String(displayNow.getDate()).padStart(2, '0')}`];
    lines.push('━━━━━━━━━━━━━━━━━━');

    // 看门狗事件（近 24h）
    const events = Array.isArray(getWatchdogEvents()) ? getWatchdogEvents() : [];
    if (events.length === 0) {
      lines.push('✅ 昨夜无掉线记录（看门狗值守正常）');
    } else {
      lines.push(`⚠️ 近 24 小时有 ${events.length} 次连接事件：`);
      for (const event of events.slice(-5)) {
        const label = event.type === 'offline' ? '掉线' : '恢复';
        lines.push(`  ${formatLocalTime(toDisplayDate(new Date(event.at), offsetMinutes).getTime())} ${label}（${event.detail || '-'}）`);
      }
    }

    // 昨日 AI 用量
    const usage = getYesterdayUsage();
    if (usage) {
      lines.push(`📊 昨日 AI：${formatNumber(usage.requests)} 次请求 / 失败 ${formatNumber(usage.errors)} / ${formatNumber(usage.total_tokens)} tokens`);
    } else {
      lines.push('📊 昨日 AI：暂无用量记录');
    }

    // 本周 vs 上周环比（数据源给趋势序列时才显示）
    const weeklyTrend = getWeeklyTrend();
    if (Array.isArray(weeklyTrend) && weeklyTrend.length >= 14) {
      const lastWeek = weeklyTrend.slice(-14, -7);
      const thisWeek = weeklyTrend.slice(-7);
      const sum = days => days.reduce((acc, day) => acc + (Number(day?.requests) || 0), 0);
      const lastSum = sum(lastWeek);
      const thisSum = sum(thisWeek);
      let trendText;
      if (lastSum === 0) {
        trendText = thisSum > 0 ? '上周无请求' : '两周均无请求';
      } else {
        const delta = ((thisSum - lastSum) / lastSum) * 100;
        const direction = delta >= 0 ? '+' : '';
        trendText = `${direction}${delta.toFixed(0)}%`;
      }
      lines.push(`📈 本周 AI：${formatNumber(thisSum)} 次（对比上周 ${formatNumber(lastSum)} 次，${trendText}）`);
    }

    // 备份状态
    const backup = getBackupStatus();
    if (backup) {
      if (backup.latest) {
        lines.push(`💾 备份：${backup.latest.name}（${backup.count} 份存量，最近 ${formatLocalTime(toDisplayDate(new Date(backup.latest.time), offsetMinutes).getTime())}）`);
      } else {
        lines.push('💾 备份：暂无备份文件');
      }
    }

    // 资源水位
    const resource = getResourceStatus();
    if (resource) {
      const normal = Array.isArray(resource.normal) ? resource.normal : [];
      const alerts = Array.isArray(resource.alerts) ? resource.alerts : [];
      if (alerts.length > 0) {
        lines.push(`🚨 水位告警中：${alerts.join('；')}`);
      } else if (normal.length > 0) {
        lines.push(`🩺 水位：${normal.slice(0, 4).join(' / ')}`);
      }
    }

    lines.push('');
    lines.push(`生成时间：${displayNow.toLocaleString('zh-CN', { hour12: false, timeZone: 'UTC' })}`);
    return lines.join('\n');
  }

  function shouldSendNow() {
    if (getEnabled() === false) return false;
    const offsetMinutes = resolveOffsetMinutes();
    const displayNow = toDisplayDate(new Date(), offsetMinutes);
    const dayKey = `${displayNow.getFullYear()}-${displayNow.getMonth() + 1}-${displayNow.getDate()}`;
    // 今天已发过就不再发（内存态 + 持久化态双重判断，重启不丢）；没到发送时刻也跳过
    if (state.lastSentDay === dayKey) return false;
    if (String(getSavedDay() || '') === dayKey) return false;
    const hour = Math.min(Math.max(Number(getHour()) || DEFAULT_HOUR, 0), 23);
    return displayNow.getHours() >= hour;
  }

  async function runReport({ trigger = 'scheduled' } = {}) {
    if (!notifyMasters) return { success: false, error: '通知通道不可用' };
    const text = buildReportText();
    const offsetMinutes = resolveOffsetMinutes();
    const displayNow = toDisplayDate(new Date(), offsetMinutes);
    state.lastSentDay = `${displayNow.getFullYear()}-${displayNow.getMonth() + 1}-${displayNow.getDate()}`;
    saveSentDay(state.lastSentDay);
    logger.mark(`[morning-report] 发送晨报（${trigger}）`);
    const result = await notifyMasters(text, { label: '每日晨报' });
    return { success: true, result };
  }

  function start() {
    if (state.timer) return;
    state.timer = setInterval(() => {
      try {
        if (shouldSendNow()) {
          runReport().catch(error => logger.warn(`[morning-report] 发送失败: ${error.message}`));
        }
      } catch (error) {
        logger.warn(`[morning-report] 检查异常: ${error.message}`);
      }
    }, CHECK_INTERVAL_MS);
  }

  function stop() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  return {
    start,
    stop,
    buildReportText,
    runReport,
    // 状态查询（任务中心展示用）
    describeTask() {
      const enabled = getEnabled() !== false;
      const hour = Math.min(Math.max(Number(getHour()) || DEFAULT_HOUR, 0), 23);
      return {
        id: 'morning-report',
        name: '每日运维晨报',
        schedule: `每天 ${String(hour).padStart(2, '0')}:00`,
        status: enabled ? 'enabled' : 'disabled',
        statusLabel: enabled ? `每天 ${String(hour).padStart(2, '0')}:00 推送` : '已停用',
        nextRunAt: '',
      };
    },
  };
}
