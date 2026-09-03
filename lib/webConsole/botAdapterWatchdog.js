// 适配器掉线看门狗：轮询全局 Bot 上的适配器数量，检测到全掉线/恢复时通过 QQ 队列 + 可选邮件旁路通知主人。
// 告警类消息用 persist 标记：QQ 不在线时无限期保留，恢复瞬间送达，还原完整事故时间线。
const CHECK_INTERVAL_MS = 60 * 1000;
// 连续 N 次检查无适配器才判定掉线，避开启动窗口与瞬断
const OFFLINE_CONFIRM_COUNT = 2;
const REMIND_INTERVAL_MS = 30 * 60 * 1000;
// 启动后前 X 分钟适配器未连上不告警（正常连接窗口）
const BOOT_GRACE_MS = 5 * 60 * 1000;

function getOnlineBotCount() {
  const bot = typeof globalThis !== 'undefined' ? globalThis.Bot : null;
  if (!bot) return 0;
  try {
    const ids = bot.bots ? Object.keys(bot.bots) : (Array.isArray(bot.uin) ? bot.uin : []);
    return ids.length;
  } catch {
    return 0;
  }
}

function formatDuration(ms = 0) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function buildOfflineMessage(state) {
  const lines = [
    '⏰ 灵晶看门狗：QQ 适配器已掉线',
    '━━━━━━━━━━━━━━━━━━',
    `检测时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `当前适配器数：${state.lastOnlineCount} → 0`,
    '',
    'Bot 进程仍在运行，但收不到任何 QQ 消息。',
    '本条通过重发队列投递，收到即代表已恢复。',
  ];
  return lines.join('\n');
}

function buildRecoverMessage(state) {
  const lines = [
    '✅ 灵晶看门狗：QQ 适配器已恢复',
    '━━━━━━━━━━━━━━━━━━',
    `恢复时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `离线时长：${formatDuration(state.offlineSince ? Date.now() - state.offlineSince : 0)}`,
    `适配器数：${state.lastOnlineCount}`,
    '',
    '离线期间的消息已无法找回，可检查群内是否有遗漏。',
  ];
  return lines.join('\n');
}

export function createBotAdapterWatchdog(options = {}) {
  const logger = options.logger || { warn: () => {}, mark: () => {}, info: () => {} };
  const notifyMasters = typeof options.notifyMasters === 'function' ? options.notifyMasters : null;
  const getEnabled = typeof options.getEnabled === 'function' ? options.getEnabled : () => true;
  const sendAlertEmail = typeof options.sendAlertEmail === 'function' ? options.sendAlertEmail : null;
  const checkIntervalMs = options.checkIntervalMs || CHECK_INTERVAL_MS;

  const state = {
    timer: null,
    startedAt: 0,
    lastOnlineCount: 0,
    // 掉线确认后为 true；offlineSince 记录首次检测到为 0 的时刻（用于算离线时长）
    offline: false,
    offlineSince: 0,
    emptyStreak: 0,
    lastRemindAt: 0,
    alerted: false,
  };

  function stop() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function start() {
    if (state.timer || getEnabled() === false) return;
    state.startedAt = Date.now();
    state.timer = setInterval(() => {
      try {
        check();
      } catch (error) {
        logger.warn(`[watchdog] 检查异常: ${error.message}`);
      }
    }, checkIntervalMs);
  }

  function check() {
    if (getEnabled() === false) return;
    const now = Date.now();
    const onlineCount = getOnlineBotCount();

    if (onlineCount > 0) {
      state.lastOnlineCount = onlineCount;
      state.emptyStreak = 0;
      if (state.offline) {
        state.offline = false;
        const offlineMs = state.offlineSince ? now - state.offlineSince : 0;
        state.offlineSince = 0;
        state.alerted = false;
        logger.mark(`[watchdog] QQ 适配器恢复（离线 ${formatDuration(offlineMs)}）`);
        notifyMasters?.(buildRecoverMessage({ ...state, lastOnlineCount: onlineCount }), { label: '看门狗恢复通知', persist: true });
        sendAlertEmail?.('✅ 灵晶看门狗：QQ 适配器已恢复', buildRecoverMessage({ ...state, lastOnlineCount: onlineCount }));
      }
      return;
    }

    // 无适配器：启动宽限期内只记录不告警
    if (now - state.startedAt < BOOT_GRACE_MS) {
      return;
    }

    state.emptyStreak += 1;
    if (!state.offlineSince) {
      state.offlineSince = now;
    }
    if (state.emptyStreak < OFFLINE_CONFIRM_COUNT || state.offline) {
      if (state.offline && now - state.lastRemindAt >= REMIND_INTERVAL_MS) {
        state.lastRemindAt = now;
        logger.warn(`[watchdog] QQ 适配器持续离线 ${formatDuration(now - state.offlineSince)}（每 30 分钟提醒一次）`);
      }
      return;
    }

    // 首次确认掉线
    state.offline = true;
    state.alerted = true;
    state.lastRemindAt = now;
    logger.warn(`[watchdog] QQ 适配器掉线：适配器数 ${state.lastOnlineCount} -> 0，开始告警`);
    notifyMasters?.(buildOfflineMessage(state), { label: '看门狗掉线告警', persist: true });
    // QQ 链路本身不可用，邮件是唯一即时旁路
    if (sendAlertEmail) {
      Promise.resolve(sendAlertEmail('⏰ 灵晶看门狗：QQ 适配器已掉线', buildOfflineMessage(state)))
        .then(result => {
          if (result?.success) logger.mark('[watchdog] 掉线告警邮件已发送');
        })
        .catch(() => {});
    }
  }

  function buildStatusPayload() {
    const onlineCount = getOnlineBotCount();
    return {
      enabled: getEnabled() !== false,
      running: Boolean(state.timer),
      onlineCount,
      offline: state.offline,
      offlineSince: state.offlineSince ? new Date(state.offlineSince).toISOString() : '',
      offlineDurationMs: state.offlineSince ? Date.now() - state.offlineSince : 0,
      lastOnlineCount: state.lastOnlineCount,
      emailConfigured: Boolean(sendAlertEmail),
      lastRemindAt: state.lastRemindAt ? new Date(state.lastRemindAt).toISOString() : '',
    };
  }

  return { start, stop, check, buildStatusPayload };
}
