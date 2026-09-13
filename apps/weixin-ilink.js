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
  extractTextFromMessage,
} from '../lib/weixin/ilinkClient.js';
import { createAgentChatBridge, getBridgeState, setBridgeEnabled } from '../lib/agent/agentChatBridge.js';

const logger = globalThis.logger || console;

const MessageTypeUSER = 1; // ilink message_type: 1=USER 2=BOT

// 轮询单例：模块级状态（QQ 侧每条指令都会触发 ensurePoller，实例字段会导致循环叠加、消息重复处理）
const pollerState = { running: false, generation: 0, started: false };

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
  // 权限模型：bot 挂在主人微信上，扫码登录即主人授权，默认放行所有私聊用户。
  // 白名单是可选收紧项：仅当配置了非空 allowedUsers 时才过滤。
  const raw = config?.weixinIlink?.allowedUsers;
  const list = Array.isArray(raw) ? raw : [];
  return new Set(list.map(item => String(item ?? '').trim()).filter(Boolean));
}

function extractIncomingMessage(update = {}) {
  // 官方结构：WeixinMessage 平铺（无 msg 包裹层），文本在 item_list
  const content = extractTextFromMessage(update).trim();
  const senderId = String(update?.from_user_id || '').trim();
  const contextToken = String(update?.context_token || '').trim();
  const messageType = Number(update?.message_type || 0);
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
    this.qrCache = new Map();
    // 延迟启动轮询：Yunzai 装载完成后自起
    setTimeout(() => this.ensurePoller().catch(error => logger.warn(`[weixin-ilink] 轮询启动失败：${error.message}`)), 8000);
  }

  getCredentials() {
    return loadCredentials();
  }

  // 长轮询主循环：游标增量拉消息 → 白名单过滤 → 分发
  async ensurePoller() {
    if (pollerState.running || pollerState.started) return; // started: 启动中防竞态
    const credentials = this.getCredentials();
    if (!credentials?.botToken) return;
    pollerState.running = true;
    pollerState.started = true;
    // 单例保证：杀掉旧 generation 的循环（正常不会存在，双保险）
    const myGeneration = ++pollerState.generation;
    logger.info('[weixin-ilink] 微信桥轮询已启动');
    const loop = async () => {
      let backoffMs = 0;
      let failureCount = 0;
      while (pollerState.running && pollerState.generation === myGeneration) {
        try {
          const { updates, cursorBuf } = await longPollUpdates({
            token: credentials.botToken,
            cursorBuf: pollerState.cursorBuf || '',
          });
          pollerState.cursorBuf = cursorBuf || pollerState.cursorBuf;
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
      if (pollerState.generation === myGeneration) {
        pollerState.started = false;
        pollerState.running = false;
      }
    };
    loop();
  }

  async handleIncoming(update, token) {
    const { senderId, content, contextToken, messageType } = extractIncomingMessage(update);
    if (!senderId || !content) return;
    if (messageType !== MessageTypeUSER && messageType !== 0) return; // 只处理用户消息(1)，0 视为兼容
    if (contextToken) sessionContexts.set(senderId, contextToken);
    const allowed = resolveAllowedWeixinIds(readConfig());
    if (allowed.size && !allowed.has(senderId)) {
      logger.info(`[weixin-ilink] 已拒绝非白名单用户 ${senderId}`);
      return;
    }
    const trimmed = content.trim();
    if (/^#微信机器人/.test(trimmed)) return; // 管理指令走 QQ 侧
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
    if (/^#agent$/i.test(trimmed)) {
      await this.sendTo(senderId, this.buildGuide(), token);
      return;
    }
    if (/^#灵晶状态$/.test(trimmed)) {
      const { buildStatusText } = await import('./status.js');
      const text = await buildStatusText({ self_id: 'weixin-ilink', adapter_name: 'weixin-ilink' });
      await this.sendTo(senderId, text, token);
      return;
    }
    // 非指令内容：回使用引导（首次详细，之后简短，避免刷屏）
    if (!this.greetedUsers) this.greetedUsers = new Set();
    if (this.greetedUsers.has(senderId)) {
      await this.sendTo(senderId, '发 #agent 可查看用法。', token);
      return;
    }
    this.greetedUsers.add(senderId);
    await this.sendTo(senderId, this.buildGuide(), token);
  }

  buildGuide() {
    return [
      '灵晶 Agent 微信桥已就绪。可用指令：',
      '',
      '① #agent <任务描述>',
      '   让 Agent 在插件工作目录执行任务并回报过程与结论。',
      '   示例：#agent 检查 rssCache 的过期清理逻辑是否有内存泄漏',
      '   执行中会分段推送进展（不含思考链），单轮约 30~90 秒。',
      '',
      '② #agent停止',
      '   取消当前正在执行的任务。',
      '',
      '③ #灵晶状态',
      '   查看插件运行状态。',
      '',
      '注意：同一时间只执行一个任务；任务在服务器上真实运行（只读模式，不会改动文件）。',
    ].join('\n');
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
    await e.reply('开始微信 ilink 登录：二维码随后发出，请用手机微信扫码并在 ClawBot 确认（8 分钟内完成，过期自动刷新）。');
    try {
      const credentials = await loginByQrcode({
        logger,
        onState: async state => {
          if (state.state === 'wait' && state.qrcodeUrl) {
            // 生成二维码图片发到 QQ；文字链接兜底
            try {
              const QRCode = (await import('qrcode')).default;
              const pngBuffer = await QRCode.toBuffer(state.qrcodeUrl, { type: 'png', width: 480, margin: 2 });
              await e.reply([segment.image(`base64://${pngBuffer.toString('base64')}`), '\n若二维码无法扫描，把此链接在手机浏览器打开：\n', state.qrcodeUrl]);
            } catch (error) {
              await e.reply(`二维码生成失败（${error.message}），请用手机浏览器打开链接扫码：\n${state.qrcodeUrl}`);
            }
            if (state.refreshCount > 0) return; // 刷新时上面已发新码
          }
          if (state.state === 'scaned') await e.reply('已扫码，请在手机上确认登录。').catch(() => { });
          if (state.state === 'expired') await e.reply('二维码已过期，正在自动刷新，请扫新码。').catch(() => { });
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
      `白名单：${allowed.size ? `仅限 ${[...allowed].join('、')}` : '未启用（所有私聊用户放行）'}`,
      `轮询：${pollerState.running ? '运行中' : '停止'}`,
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
