// 微信 ilink bot 桥（官方 ClawBot 开放接口）：主人白名单私聊 → #agent / #灵晶状态
// plugin 为 Yunzai 运行时注入的全局基类（与其他 apps 一致，不 import）
// 登录：#微信机器人登录 拿登录链接扫码（二维码内容输出到终端/控制台日志）
import fs from 'fs';
import ConfigControl from '../lib/config/configControl.js';
import {
  loadCredentials,
  clearCredentials,
  loginByQrcode,
  longPollUpdates,
  sendTextMessage,
  sendImageMessage,
  extractTextFromMessage,
} from '../lib/weixin/ilinkClient.js';
import {
  createAgentChatBridge,
  getBridgeState,
  setBridgeEnabled,
  listAvailableModels,
  setBridgeModel,
  setBridgeVariant,
} from '../lib/agent/agentChatBridge.js';

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

    // ── 斜杠指令（微信侧专用）──
    if (trimmed.startsWith('/')) {
      await this.handleSlashCommand(senderId, trimmed, token);
      return;
    }

    // ── 任务输入模式：下一条普通消息直接作为任务提交 ──
    if (this.taskInputUsers?.has(senderId)) {
      this.taskInputUsers.delete(senderId);
      await this.dispatchAgent(senderId, trimmed, token);
      return;
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
    if (/^#agent$/i.test(trimmed)) {
      await this.sendTo(senderId, this.buildGuide(), token);
      return;
    }
    if (/^#灵晶状态$/.test(trimmed)) {
      // 图片版优先（微信 bot 支持图片），失败降级文字版
      try {
        const { buildStatusData } = await import('./status.js');
        const { renderStatusImage } = await import('../lib/system/statusImageRenderer.js');
        const imagePath = await renderStatusImage(await buildStatusData({ self_id: 'weixin-ilink', adapter_name: 'weixin-ilink' }));
        const imageBuffer = fs.readFileSync(imagePath);
        await this.sendImageTo(senderId, imageBuffer, token);
        return;
      } catch (error) {
        logger.warn(`[weixin-ilink] 状态图发送失败，降级文字版：${error.message}`);
        const { buildStatusText } = await import('./status.js');
        const text = await buildStatusText({ self_id: 'weixin-ilink', adapter_name: 'weixin-ilink' });
        await this.sendTo(senderId, text, token);
        return;
      }
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

  // ── 斜杠指令分发 ──
  async handleSlashCommand(senderId, text, token) {
    const [rawCmd, ...rest] = text.slice(1).split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const arg = rest.join(' ').trim();

    if (cmd === '帮助' || cmd === 'help' || cmd === 'start') {
      await this.sendTo(senderId, this.buildGuide(), token);
      return;
    }
    if (cmd === '新建任务') {
      if (this.taskInputUsers?.has(senderId)) {
        await this.sendTo(senderId, '已在任务输入模式：直接发任务内容即可，发 /取消 退出。', token);
        return;
      }
      if (!this.taskInputUsers) this.taskInputUsers = new Set();
      this.taskInputUsers.add(senderId);
      await this.sendTo(senderId, '请直接发送任务内容（下一条消息将提交给 Agent）。发 /取消 退出输入模式。', token);
      return;
    }
    if (cmd === '取消') {
      const inInput = this.taskInputUsers?.delete(senderId);
      await this.sendTo(senderId, inInput ? '已退出任务输入模式。' : '当前没有可取消的输入会话；运行中的任务用 /停止 或 #agent停止。', token);
      return;
    }
    if (cmd === '模型') {
      await this.handleModelCommand(senderId, arg, token);
      return;
    }
    if (cmd === '思考等级') {
      await this.handleVariantCommand(senderId, arg, token);
      return;
    }
    if (cmd === '当前配置' || cmd === '配置') {
      const state = getBridgeState();
      await this.sendTo(senderId, [
        '当前配置',
        `模型：${state.model || '默认（服务端决定）'}`,
        `思考等级：${state.variant || '默认'}`,
        `Agent 桥：${state.enabled ? '开启' : '关闭'}`,
      ].join('\n'), token);
      return;
    }
    if (cmd === '停止' || cmd === 'stop') {
      const bridge = this.getBridge(senderId);
      const stopped = await bridge.cancelActive();
      await this.sendTo(senderId, stopped ? '已发送取消请求，当前任务将中断。' : '当前没有运行中的任务。', token);
      return;
    }
    if (cmd === '灵晶状态' || cmd === '状态') {
      try {
        const { buildStatusData } = await import('./status.js');
        const data = await buildStatusData({ self_id: 'weixin-ilink', adapter_name: 'weixin-ilink' });
        await this.sendTo(senderId, buildCompactStatus(data), token);
      } catch (error) {
        await this.sendTo(senderId, `状态获取失败：${error.message}`, token);
      }
      return;
    }
    await this.sendTo(senderId, this.buildGuide(), token);
  }

  // /状态 的精简文字版（微信文本消息，控制在十几行内）
  buildCompactStatus(data) {
    const rowMap = new Map((Array.isArray(data?.rows) ? data.rows : []).map(([label, value]) => [label, value]));
    const resources = data?.resources || {};
    const ai = data?.aiUsage || {};
    const state = getBridgeState();
    return [
      `灵晶状态：${data?.statusText || '未知'}`,
      `版本：${rowMap.get('插件版本') || '未知'}`,
      `运行时长：${rowMap.get('运行时长') || '未知'}`,
      `内存：${String(resources.memoryPercent ?? '?').slice(0, 5)}%  CPU：${String(resources.cpuPercent ?? '?').slice(0, 5)}%`,
      `今日 AI：${ai.requestCountText || 0} 次 / ${ai.totalTokensText || 0} tokens`,
      `成本：${ai.costText || '未启用'}`,
      `Agent 桥：${state.enabled ? '开启' : '关闭'} · 模型：${state.model || '默认'}`,
      `思考等级：${state.variant || '默认'}`,
    ].join('\n');
  }

  // /模型 [编号|名称]：列出或选择模型
  async handleModelCommand(senderId, arg, token) {
    const models = await listAvailableModels();
    if (!models.length) {
      await this.sendTo(senderId, '暂未获取到可用模型列表（OpenCode 未运行或无可用供应商）。', token);
      return;
    }
    if (!arg) {
      const state = getBridgeState();
      const lines = models.slice(0, 15).map((model, index) => `${index + 1}. ${model.name}${model.id !== model.name ? ` (${model.id})` : ''}${model.reasoning ? ' 🧠' : ''}`);
      lines.push('', `当前：${state.model || '默认'}`, '选择：/模型 <编号或名称>；/模型 0 恢复默认');
      await this.sendTo(senderId, lines.join('\n'), token);
      return;
    }
    const state = getBridgeState();
    let picked = null;
    if (/^\d+$/.test(arg)) {
      const index = Number(arg) - 1;
      if (arg === '0') {
        setBridgeModel('');
        await this.sendTo(senderId, '已恢复默认模型。', token);
        return;
      }
      picked = models.slice(0, 15)[index] || null;
    } else {
      const query = arg.toLowerCase();
      picked = models.find(m => m.id.toLowerCase() === query || m.name.toLowerCase() === query)
        || models.find(m => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)) || null;
    }
    if (!picked) {
      await this.sendTo(senderId, `未找到模型「${arg}」，发 /模型 查看列表。`, token);
      return;
    }
    setBridgeModel(picked.id);
    await this.sendTo(senderId, `模型已切换：${picked.name}（${picked.providerId}）${picked.reasoning ? ' · 支持思考' : ''}`, token);
  }

  // /思考等级 [编号|名称]
  async handleVariantCommand(senderId, arg, token) {
    const state = getBridgeState();
    const VARIANTS = [['', '默认'], ['minimal', '最低'], ['low', '低'], ['medium', '中'], ['high', '高'], ['xhigh', '极高'], ['max', '最大']];
    if (!arg) {
      const current = VARIANTS.find(([value]) => value === state.variant);
      const lines = VARIANTS.map(([value, label], index) => `${index}. ${label}${value === state.variant ? ' ✓' : ''}`);
      lines.push('', '选择：/思考等级 <编号或名称>；/思考等级 0 恢复默认');
      await this.sendTo(senderId, lines.join('\n'), token);
      return;
    }
    const query = arg.toLowerCase();
    let matched = null;
    if (/^\d+$/.test(query)) {
      const index = Number(query);
      if (index < 0 || index >= VARIANTS.length) {
        await this.sendTo(senderId, `编号超出范围（0~${VARIANTS.length - 1}）。发 /思考等级 查看列表。`, token);
        return;
      }
      matched = VARIANTS[index];
    } else {
      matched = VARIANTS.find(([value]) => value === query) || VARIANTS.find(([, label]) => label === arg) || null;
    }
    if (!matched) {
      await this.sendTo(senderId, `未知的思考等级「${arg}」。可选：最低/低/中/高/极高/最大，或发 /思考等级 查看列表。`, token);
      return;
    }
    setBridgeVariant(matched[0]);
    await this.sendTo(senderId, `思考等级已切换：${matched[1] || '默认'}${matched[0] ? `（${matched[0]}）` : ''}`, token);
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
      '更多（斜杠指令）：',
      '· /新建任务 —— 输入模式下一条消息直接作为任务提交',
      '· /模型 —— 查看/切换 Agent 模型，/模型 0 恢复默认',
      '· /思考等级 —— 调节思考深度（最低~最大）',
      '· /当前配置 —— 查看当前模型与思考等级',
      '· /停止 —— 中断运行中的任务（等同 #agent停止）',
      '· /状态 —— 精简状态',
      '· /取消 —— 退出任务输入模式',
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

  async sendImageTo(userId, imageBuffer, tokenOverride = '') {
    const credentials = this.getCredentials();
    const token = tokenOverride || credentials?.botToken || '';
    const contextToken = sessionContexts.get(userId) || '';
    await sendImageMessage({ token, toUserId: userId, contextToken, imageBuffer });
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
