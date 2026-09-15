// 适配器掉线看门狗：轮询全局 Bot 上的适配器数量，检测到全掉线/恢复时通过 QQ 队列 + 微信桥 + 可选邮件旁路通知主人。
// 告警类消息用 persist 标记：QQ 不在线时无限期保留，恢复瞬间送达，还原完整事故时间线。
// QQ 掉线告警场景下 QQ 通道必然不可用，微信桥（不经过 icqq）与邮件是有效旁路。
// icqq 等适配器断线重连期间会短暂从 Bot.bots 消失（ws 断开即清理），确认窗口需覆盖重连耗时。
const CHECK_INTERVAL_MS = 60 * 1000;
// 连续 N 次检查（约 5 分钟）无适配器才判定掉线：覆盖 icqq 重连窗口，重连成功自然不告警
const OFFLINE_CONFIRM_COUNT = 5;
const REMIND_INTERVAL_MS = 30 * 60 * 1000;
// 启动后前 X 分钟适配器未连上不告警（正常连接窗口）
const BOOT_GRACE_MS = 5 * 60 * 1000;

function getOnlineBotCount() {
  const bot = typeof globalThis !== 'undefined' ? globalThis.Bot : null;
  if (!bot) return 0;
  try {
    // TRSS：Bot.bots 多 bot 注册表
    if (bot.bots && typeof bot.bots === 'object' && !Array.isArray(bot.bots)) {
      return Object.keys(bot.bots).length;
    }
    if (Array.isArray(bot.uin)) return bot.uin.length;
    // Miao-Yunzai 等单 bot 框架：Bot 本身即适配器实例，uin 为数字/字符串
    // （日志特征："已接管主账号身份，Bot.uin=xxx"）
    if (bot.uin) return 1;
    return 0;
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
  const notifyWechatBridge = typeof options.notifyWechatBridge === 'function' ? options.notifyWechatBridge : null;
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
    // 本轮掉线周期内是否推送过告警（区分"确认掉线后恢复"与"重连窗口内自愈"）
    everAlerted: false,
    // 事件日志（掉线/恢复时间线，晨报与状态查询用），上限 20 条防膨胀
    events: [],
  };

  function recordEvent(type, detail = '') {
    state.events.push({ type, detail, at: Date.now() });
    if (state.events.length > 20) state.events.splice(0, state.events.length - 20);
  }

  function getRecentEvents(sinceMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - sinceMs;
    return state.events.filter(event => event.at >= cutoff);
  }

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
      // 重连窗口内自愈（未达告警阈值）：记一条日志供排查，不打扰用户
      if (state.emptyStreak > 0 && !state.offline) {
        logger.mark(`[watchdog] QQ 适配器短暂断连 ${formatDuration(state.offlineSince ? now - state.offlineSince : 0)} 后自愈，未达告警阈值`);
        state.offlineSince = 0;
        state.emptyStreak = 0;
      }
      if (state.offline) {
        state.offline = false;
        const offlineMs = state.offlineSince ? now - state.offlineSince : 0;
        state.offlineSince = 0;
        state.alerted = false;
        recordEvent('recover', `离线 ${formatDuration(offlineMs)}`);
        if (!state.everAlerted) {
          // 从未确认掉线（重连窗口内自动恢复）：只记日志不推送，恢复通知也一并省略
          logger.mark(`[watchdog] QQ 适配器短暂断连后恢复（离线 ${formatDuration(offlineMs)}），未达告警阈值，不推送`);
        } else {
          logger.mark(`[watchdog] QQ 适配器恢复（离线 ${formatDuration(offlineMs)}）`);
          notifyMasters?.(buildRecoverMessage({ ...state, lastOnlineCount: onlineCount }), { label: '看门狗恢复通知', persist: true });
          notifyWechatBridge?.(buildRecoverMessage({ ...state, lastOnlineCount: onlineCount }), { label: '看门狗恢复通知' });
          sendAlertEmail?.('✅ 灵晶看门狗：QQ 适配器已恢复', buildRecoverMessage({ ...state, lastOnlineCount: onlineCount }));
        }
        state.everAlerted = false;
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
    state.everAlerted = true;
    state.lastRemindAt = now;
    recordEvent('offline', `适配器数 ${state.lastOnlineCount} -> 0`);
    logger.warn(`[watchdog] QQ 适配器掉线：适配器数 ${state.lastOnlineCount} -> 0，开始告警`);
    notifyMasters?.(buildOfflineMessage(state), { label: '看门狗掉线告警', persist: true });
    // QQ 链路本身不可用，微信桥（不经过 icqq）与邮件是有效旁路
    notifyWechatBridge?.(buildOfflineMessage(state), { label: '看门狗掉线告警' });
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
      events: getRecentEvents(),
    };
  }

  return { start, stop, check, buildStatusPayload, getRecentEvents };
}
