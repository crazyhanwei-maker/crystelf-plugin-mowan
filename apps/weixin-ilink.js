// 微信 ilink bot 桥（官方 ClawBot 开放接口）：主人白名单私聊 → #agent / #灵晶状态
// plugin 为 Yunzai 运行时注入的全局基类（与其他 apps 一致，不 import）
// 登录：#微信机器人登录 拿登录链接扫码（二维码内容输出到终端/控制台日志）
import ConfigControl from '../lib/config/configControl.js';
import {
  loadCredentials,
  clearCredentials,
  loginByQrcode,
  longPollUpdates,
  sendTextMessage,
  sendTyping,
} from '../lib/weixin/ilinkClient.js';
import { createAgentChatBridge, getBridgeState, setBridgeEnabled } from '../lib/agent/agentChatBridge.js';

const logger = globalThis.logger || console;

// 每个会话只保留最近一条消息的 contextToken（sendMessage 必须回传）
const sessionContexts = new Map();

function readConfig() {
  try {
    return ConfigControl.get('config') || {};
  } catch {
    return {};
  }
}

function resolveAllowedWeixinIds(config = {}) {
  // 白名单：config.weixinIlink.allowedUsers（微信用户 ID 数组），空 = 仅拒绝所有人
  const raw = config?.weixinIlink?.allowedUsers;
  const list = Array.isArray(raw) ? raw : [];
  return new Set(list.map(item => String(item ?? '').trim()).filter(Boolean));
}

function extractIncomingMessage(update = {}) {
  const message = update?.msg || update?.message || update;
  const senderId = String(message?.from_user_id || message?.fromUserId || message?.sender_id || update?.from_user_id || '').trim();
  const content = String(message?.content || message?.text || '').trim();
  const contextToken = String(update?.context_token || message?.context_token || update?.contextToken || '').trim();
  const messageType = String(message?.msg_type || message?.message_type || 'TEXT').toUpperCase();
  return { senderId, content, contextToken, messageType };
}

export class weixinIlink extends plugin {
  constructor() {
    super({
      name: 'weixin-ilink',
      dsc: '微信 ilink bot 官方接口桥：主人私聊 #agent / #灵晶状态',
      event: 'message',
      priority: -900,
      rule: [
        { reg: '^#微信机器人登录$', fnc: 'startLogin', permission: 'master' },
        { reg: '^#微信机器人登出$', fnc: 'logout', permission: 'master' },
        { reg: '^#微信机器人状态$', fnc: 'bridgeStatus', permission: 'master' },
        { reg: '^#agent开关$', fnc: 'toggleAgent', permission: 'master' },
        { reg: '^#agent停止$', fnc: 'stopAgent', permission: 'master' },
        { reg: '^#agent (.+)$', fnc: 'runAgentTask', permission: 'master' },
      ],
    });
    this.poller = null;
    this.pollerRunning = false;
    this.qrCache = new Map();
    // 延迟启动轮询：Yunzai 装载完成后自起
    setTimeout(() => this.ensurePoller().catch(error => logger.warn(`[weixin-ilink] 轮询启动失败：${error.message}`)), 8000);
  }

  getCredentials() {
    return loadCredentials();
  }

  // 长轮询主循环：游标增量拉消息 → 白名单过滤 → 分发
  async ensurePoller() {
    if (this.pollerRunning) return;
    const credentials = this.getCredentials();
    if (!credentials?.botToken) return;
    this.pollerRunning = true;
    logger.info('[weixin-ilink] 微信桥轮询已启动');
    const loop = async () => {
      let backoffMs = 0;
      let failureCount = 0;
      while (this.pollerRunning) {
        try {
          const { updates, cursorBuf } = await longPollUpdates({
            token: credentials.botToken,
            cursorBuf: this.cursorBuf || '',
          });
          this.cursorBuf = cursorBuf || this.cursorBuf;
          failureCount = 0;
          backoffMs = 0;
          for (const update of updates) {
            await this.handleIncoming(update, credentials.botToken).catch(error => {
              logger.warn(`[weixin-ilink] 处理消息失败：${error.message}`);
            });
          }
        } catch (error) {
          failureCount += 1;
          backoffMs = failureCount <= 5 ? 2000 : 30000;
          logger.warn(`[weixin-ilink] 长轮询失败（连续 ${failureCount} 次）：${error.message}，${backoffMs}ms 后重试`);
        }
        if (backoffMs) await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    };
    this.poller = loop();
  }

  async handleIncoming(update, token) {
    const { senderId, content, contextToken, messageType } = extractIncomingMessage(update);
    if (!senderId || !content) return;
    if (messageType !== 'TEXT' && messageType !== 'USER' && messageType !== '') return;
    if (contextToken) sessionContexts.set(senderId, contextToken);
    const allowed = resolveAllowedWeixinIds(readConfig());
    if (!allowed.has(senderId)) {
      logger.info(`[weixin-ilink] 已拒绝非白名单用户 ${senderId}`);
      return;
    }
    const trimmed = content.trim();
    if (/^#微信机器人/.test(trimmed)) return; // 管理指令走 QQ 侧
    if (/^#agent/i.test(trimmed) || /^#灵晶状态/.test(trimmed)) {
      await sendTyping({ token, toUserId: senderId, contextToken });
    }
    if (/^#agent停止$/i.test(trimmed)) {
      const bridge = this.getBridge(senderId);
      const stopped = await bridge.cancelActive();
      await this.sendTo(senderId, stopped ? '已发送取消请求，当前桥接任务将中断。' : '当前没有运行中的桥接任务。', token);
      return;
    }
    if (/^#agent\s+/i.test(trimmed)) {
      await this.dispatchAgent(senderId, trimmed.replace(/^#agent\s+/i, ''), token);
      return;
    }
    if (/^#灵晶状态$/.test(trimmed)) {
      const { buildStatusText } = await import('./status.js');
      const text = await buildStatusText({ self_id: 'weixin-ilink', adapter_name: 'weixin-ilink' });
      await this.sendTo(senderId, text, token);
      return;
    }
    // 非指令内容：给出提示，不做自由对话（避免误解与滥用）
    await this.sendTo(senderId, '支持指令：#agent <任务描述>、#agent停止、#灵晶状态', token);
  }

  getBridge(senderId) {
    if (!this.bridges) this.bridges = new Map();
    if (!this.bridges.has(senderId)) {
      this.bridges.set(senderId, createAgentChatBridge({
        senderId,
        reply: (text) => this.sendTo(senderId, text).catch(error => logger.warn(`[weixin-ilink] 回报失败：${error.message}`)),
      }));
    }
    return this.bridges.get(senderId);
  }

  async dispatchAgent(senderId, promptText, token) {
    const bridgeState = getBridgeState();
    if (!bridgeState.enabled) {
      await this.sendTo(senderId, 'Agent 桥当前关闭：QQ 侧发送 #agent开关 打开后再试。', token);
      return;
    }
    const bridge = this.getBridge(senderId);
    if (await bridge.isBusy()) {
      await this.sendTo(senderId, '已有桥接任务在执行中，可发送 #agent停止 取消后重试。', token);
      return;
    }
    await this.sendTo(senderId, '任务已提交，执行过程会分段推送（不含思考链）。', token);
    try {
      await bridge.runTaskWithReport(promptText, {
        onProgressReply: line => this.sendTo(senderId, line).catch(() => { }),
      });
    } catch (error) {
      await this.sendTo(senderId, `任务提交失败：${error.message}`, token);
    }
  }

  async sendTo(userId, text, tokenOverride = '') {
    const credentials = this.getCredentials();
    const token = tokenOverride || credentials?.botToken || '';
    const contextToken = sessionContexts.get(userId) || '';
    await sendTextMessage({ token, toUserId: userId, content: String(text || '').slice(0, 4000), contextToken });
  }

  // ── QQ 侧管理指令 ──

  async startLogin(e) {
    await e.reply('开始微信 ilink 登录：请在手机微信 → ClawBot 入口扫码确认（2 分钟内完成，过期自动刷新二维码）。');
    try {
      const credentials = await loginByQrcode({
        logger,
        onState: state => {
          if (state.state === 'wait' && state.qrcodeContent) {
            logger.info(`[weixin-ilink] 登录二维码内容（可用手机浏览器打开或微信扫码）：${state.qrcodeContent}`);
            if (state.refreshCount > 0) e.reply('二维码已过期，已自动刷新，请重新扫码。').catch(() => { });
          }
          if (state.state === 'scaned') e.reply('已扫码，请在手机上确认登录。').catch(() => { });
        },
      });
      await e.reply(`微信桥登录成功（botId: ${credentials.botId || '未知'}）。轮询已启动，发送 #微信机器人状态 查看详情。`);
      await this.ensurePoller();
    } catch (error) {
      await e.reply(`微信桥登录失败：${error.message}`);
    }
    return true;
  }

  async logout(e) {
    clearCredentials();
    this.pollerRunning = false;
    await e.reply('微信桥已登出，凭证已删除，轮询已停止。');
    return true;
  }

  async bridgeStatus(e) {
    const credentials = this.getCredentials();
    const bridgeState = getBridgeState();
    const allowed = resolveAllowedWeixinIds(readConfig());
    const lines = [
      '微信 ilink 桥状态',
      `登录：${credentials?.botToken ? '已登录' : '未登录（发送 #微信机器人登录 扫码）'}`,
      `botId：${credentials?.botId || '—'}`,
      `Agent 桥：${bridgeState.enabled ? '开启' : '关闭（#agent开关）'}`,
      `白名单用户：${allowed.size ? [...allowed].join('、') : '空（所有人拒绝）'}`,
      `轮询：${this.pollerRunning ? '运行中' : '停止'}`,
    ];
    await e.reply(lines.join('\n'));
    return true;
  }

  async toggleAgent(e) {
    const next = !getBridgeState().enabled;
    setBridgeEnabled(next);
    await e.reply(`Agent 桥已${next ? '开启' : '关闭'}。`);
    return true;
  }

  async stopAgent(e) {
    const bridge = this.getBridge(`qq:${e.user_id}`);
    const stopped = await bridge.cancelActive();
    await e.reply(stopped ? '已发送取消请求。' : '当前没有运行中的桥接任务。');
    return true;
  }

  async runAgentTask(e) {
    const promptText = String(e.msg || '').replace(/^#agent\s+/i, '').trim();
    if (!promptText) {
      await e.reply('用法：#agent <任务描述>，例如 #agent 检查 rssCache 的过期清理逻辑');
      return true;
    }
    const bridgeState = getBridgeState();
    if (!bridgeState.enabled) {
      await e.reply('Agent 桥当前关闭，先发送 #agent开关 打开。');
      return true;
    }
    const bridge = this.getBridge(`qq:${e.user_id}`);
    if (await bridge.isBusy()) {
      await e.reply('已有桥接任务在执行中，可发送 #agent停止 取消后重试。');
      return true;
    }
    await e.reply('任务已提交，执行过程会分段推送（不含思考链）。');
    try {
      await bridge.runTaskWithReport(promptText, {
        onProgressReply: line => e.reply(line).catch(() => { }),
      });
    } catch (error) {
      await e.reply(`任务提交失败：${error.message}`);
    }
    return true;
  }
}

export default weixinIlink;
