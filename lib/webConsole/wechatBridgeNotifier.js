// 微信桥通知通道：仅在桥已登录且轮询运行时，把看门狗告警发给微信白名单用户。
// 与 QQ（masterNotifier）/邮件（smtpAlertMailer）并行成第三通道——icqq 掉线、被踢时，
// 它是进程内唯一不经过 QQ 协议的即时告警路径（ilink 发送只依赖 botToken + 网络）。
// 收件人复用 weixinIlink.allowedUsers 白名单；白名单未配置或桥离线时静默跳过（低频记录原因）。
import { isBridgePollerRunning } from '../weixin/bridgeState.js';
import { loadCredentials, sendTextMessage } from '../weixin/ilinkClient.js';
import ConfigControl from '../config/configControl.js';

// 通道不可用原因最多每小时记录一次，避免每 10 分钟的看门狗检查刷屏
const SKIP_LOG_INTERVAL_MS = 60 * 60 * 1000;

export function createWechatBridgeNotifier({ logger = console, deps = {} } = {}) {
  const bridgeOnline = deps.isBridgePollerRunning || isBridgePollerRunning;
  const loadCreds = deps.loadCredentials || loadCredentials;
  const sendText = deps.sendTextMessage || sendTextMessage;
  const readConfig = deps.readConfig || (() => {
    try {
      return ConfigControl.get('config') || {};
    } catch {
      return {};
    }
  });

  function readRecipients() {
    // ID 归一化：配置里可能混有数字/字符串形态的微信号，统一 String 化再比较
    const raw = readConfig()?.weixinIlink?.allowedUsers;
    const list = Array.isArray(raw) ? raw : [];
    return list.map(item => String(item ?? '').trim()).filter(Boolean);
  }

  async function notifyWechatBridge(message, { label = '通知' } = {}) {
    const text = String(message || '').trim();
    if (!text) return { ok: false, skipped: 'empty-message' };
    try {
      if (!bridgeOnline()) {
        return skip('桥未登录或轮询未运行');
      }
      const recipients = readRecipients();
      if (!recipients.length) {
        return skip('未配置 weixinIlink.allowedUsers，无告警收件人');
      }
      const credentials = loadCreds();
      if (!credentials?.botToken) {
        return skip('ilink 凭证缺失');
      }
      // 告警文案自带标题（🚨/⏰/✅ 开头），不再叠加 label 前缀
      const content = text.slice(0, 4000);
      for (const toUserId of recipients) {
        await sendText({ token: credentials.botToken, toUserId, content, contextToken: '' });
      }
      return { ok: true, sent: recipients.length, label };
    } catch (error) {
      logger.warn?.(`[wechat-bridge-notifier] 发送失败：${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  let lastSkipLogAt = 0;
  function skip(reason) {
    const now = Date.now();
    if (now - lastSkipLogAt >= SKIP_LOG_INTERVAL_MS) {
      lastSkipLogAt = now;
      logger.info?.(`[wechat-bridge-notifier] 通道跳过：${reason}`);
    }
    return { ok: false, skipped: reason };
  }

  return { notifyWechatBridge };
}
