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

// 长文本按行边界切块：微信单条过长会被截断
function splitTextChunks(text, limit = 1000) {
  const source = String(text || '').trim();
  if (!source) return [];
  const chunks = [];
  let current = '';
  for (const line of source.split('\n')) {
    if (line.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    if ((current + '\n' + line).length > limit && current) {
      chunks.push(current);
      current = line;
      continue;
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);
  return chunks;
}

function extractIncomingMessage(update = {}) {  // 官方结构：WeixinMessage 平铺（无 msg 包裹层），文本在 item_list
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

    // ── 任务模式（/新建任务 进入，黏性）：除 / 指令与 # 指令外的消息都作为当前任务指令 ──
    if (this.taskModeUsers?.has(senderId) && !trimmed.startsWith('#') && !trimmed.startsWith('/')) {
      await this.handleTaskMessage(senderId, trimmed, token);
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
    // 非指令内容：任务进行中则回报最近进展，否则给使用引导
    const progress = this.getBridge(senderId).getProgress?.();
    if (progress?.running) {
      const elapsed = progress.startedAt ? Math.max(1, Math.round((Date.now() - progress.startedAt) / 1000)) : 0;
      await this.sendTo(senderId, [
        `任务执行中（已 ${elapsed} 秒）`,
        progress.text ? `最近进展：${progress.text}` : '暂未产生新的进展。',
        '完成后会推送结论；发送 #agent停止 或 /停止 可中断。',
      ].join('\n'), token);
      return;
    }
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
      if (!this.taskModeUsers) this.taskModeUsers = new Set();
      this.taskModeUsers.add(senderId);
      await this.sendTo(senderId, [
        '已进入任务模式（全权限）：接下来直接发消息即可。',
        '· 任务执行中发的消息会作为后续指令并入当前任务',
        '· 任务结束后发的消息会在同一会话里继续（上下文保留）',
        '· / 开头的指令随时可用（/取消 退出任务模式）',
        '现在请直接发送任务内容。',
      ].join('\n'), token);
      return;
    }
    if (cmd === '取消' || cmd === '退出') {
      const inTask = this.taskModeUsers?.delete(senderId);
      await this.sendTo(senderId, inTask
        ? '已退出任务模式，需要时再发 /新建任务。'
        : '当前不在任务模式；运行中的任务用 /停止 或 #agent停止 中断。', token);
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
    if (cmd === '停止' || cmd === '停止任务' || cmd === 'stop') {
      const bridge = this.getBridge(senderId);
      const stopped = await bridge.cancelActive();
      await this.sendTo(senderId, stopped ? '已发送取消请求，当前任务将中断（含排队的后续指令）。' : '当前没有运行中的任务。', token);
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
      '① /新建任务 —— 进入任务模式（推荐）',
      '   之后直接发消息即任务；执行中发的消息会作为后续指令并入当前任务，',
      '   任务结束后继续发消息会在同一会话里接着聊（上下文保留）。',
      '   /取消 退出任务模式。',
      '',
      '② #agent <任务描述> —— 单次提交任务（不进入任务模式）',
      '   示例：#agent 检查 rssCache 的过期清理逻辑是否有内存泄漏',
      '',
      '③ #agent停止 或 /停止 —— 中断当前任务',
      '',
      '④ /模型 · /思考等级 · /当前配置 —— 选择模型与思考深度',
      '',
      '⑤ #灵晶状态 或 /状态 —— 查看插件运行状态',
      '',
      '说明：任务以全权限模式在服务器上真实执行，可修改文件、联网、执行命令，请谨慎描述任务。',
      '同一时间只执行一个任务；执行中的进展会分段推送，结束时给出结论。',
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

  // 任务模式下的消息：执行中 → 并入当前任务；空闲 → 同一会话里开新一轮
  async handleTaskMessage(senderId, text, token) {
    const bridgeState = getBridgeState();
    if (!bridgeState.enabled) {
      await this.sendTo(senderId, 'Agent 桥当前关闭：QQ 侧发送 #agent开关 打开后再试。', token);
      return;
    }
    const bridge = this.getBridge(senderId);
    const progress = bridge.getProgress?.() || {};
    if (progress.running) {
      const res = bridge.sendFollowUp(text);
      await this.sendTo(senderId, res?.queued
        ? `已加入队列（第 ${res.position} 条）：本轮结束后立即在同一会话里执行，结论会单独推送。`
        : '当前轮次刚好结束，已作为新一轮任务提交。', token);
      if (!res?.queued) await this.dispatchAgent(senderId, text, token);
      return;
    }
    await this.dispatchAgent(senderId, text, token);
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
    await this.sendTo(senderId, '任务已提交（全权限模式：可改文件、联网、执行命令）。执行过程分段推送；同一会话保留上下文，直接发消息即可追加指令。', token);
    try {
      await bridge.runTaskWithReport(promptText, {
        onProgressReply: line => this.sendTo(senderId, line).catch(() => { }),
        // 每一轮（含排队执行的后续指令）单独推送结论
        onResultReply: result => this.sendReport(senderId, result, token).catch(() => { }),
      });
    } catch (error) {
      await this.sendTo(senderId, `任务提交失败：${error.message}`, token);
    }
  }

  // 最终结论：微信文本较长易被截断，按段落切成多条发
  async sendReport(senderId, result, token) {
    const ok = result?.ok === true;
    const body = String(result?.text || '').trim() || '任务结束。';
    const chunks = splitTextChunks(body, 1000);
    for (let i = 0; i < chunks.length; i++) {
      const head = i === 0 ? (ok ? '✅ 任务完成\n\n' : '❌ 任务未成功\n\n') : `（接上，${i + 1}/${chunks.length}）\n`;
      await this.sendTo(senderId, `${head}${chunks[i]}`, token);
    }
    if (!ok) await this.sendTo(senderId, '可到控制台查看任务详情；需要重试直接再发一次任务。', token);
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

  // 登录凭证只发给「发起这条指令的那一位主人」：其他主人既不需要、也不该拿到这张码。
  // 定向私发失败时不外泄（群里如实报失败），也不广播给其他主人。
  async sendPrivateToUser(userId, message) {
    const bot = globalThis.Bot;
    if (!bot?.pickUser) throw new Error('Bot 未就绪，无法私发');
    await bot.pickUser(userId).sendMsg(message);
  }

  async sendLoginMessage(e, message, { groupNotice = '' } = {}) {
    const isGroup = e?.isGroup === true;
    const requesterId = String(e?.user_id || '').trim();
    let status = 'failed';
    if (/^[1-9]\d{4,11}$/.test(requesterId)) {
      for (let attempt = 0; attempt < 2 && status !== 'sent'; attempt++) {
        try {
          await this.sendPrivateToUser(requesterId, message);
          status = 'sent';
        } catch (error) {
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1000));
          else logger.warn(`[weixin-ilink] 登录信息私发 ${requesterId} 失败：${error.message}`);
        }
      }
    }
    if (status !== 'sent' && !isGroup) {
      // 本来就在私聊里：退化为当前会话直接回复
      try {
        await e.reply(message);
        status = 'sent';
      } catch {
        status = 'failed';
      }
    }
    if (isGroup) {
      const notice = groupNotice
        || (status === 'sent' ? '详情已私发给发起指令的主人。' : '私发失败：请主人先加 bot 为好友，并在私聊中执行该指令。');
      await e.reply(notice).catch(() => { });
    }
    return status;
  }

  async startLogin(e) {
    // 登录二维码等同登录凭证：只私发发起人，群里最多留一句不含凭证的提示
    const queued = await this.sendLoginMessage(e, '开始微信 ilink 登录：二维码随后发出，请用手机微信扫码并在 ClawBot 确认（8 分钟内完成，过期自动刷新）。', {
      groupNotice: '登录流程已私发给发起人，请在私聊中查看。',
    });
    if (queued !== 'sent') return true; // 私发不成功就不启动登录流程，避免二维码无处可送
    try {
      const credentials = await loginByQrcode({
        logger,
        onState: async state => {
          if (state.state === 'wait' && state.qrcodeUrl) {
            // 生成二维码图片私发主人；文字链接兜底。
            // 用仓库内置编码器（lib/weixin/qrCode.js）而不是 npm 的 qrcode 包：
            // 新机器上第三方依赖常缺失，一旦缺失登录就只剩一条不能直接扫的链接。
            try {
              const { renderQrPng } = await import('../lib/weixin/qrCode.js');
              const pngBuffer = renderQrPng(state.qrcodeUrl, { width: 480, margin: 3 });
              await this.sendLoginMessage(e, [segment.image(`base64://${pngBuffer.toString('base64')}`), '\n若二维码无法扫描，把此链接在手机浏览器打开：\n', state.qrcodeUrl], {
                groupNotice: '二维码已私发给主人。',
              });
            } catch (error) {
              await this.sendLoginMessage(e, `二维码生成失败（${error.message}），请用手机浏览器打开链接扫码：\n${state.qrcodeUrl}`, {
                groupNotice: '二维码生成失败，详情已私发主人。',
              });
            }
            if (state.refreshCount > 0) return; // 刷新时上面已发新码
          }
          if (state.state === 'scaned') await this.sendLoginMessage(e, '已扫码，请在手机上确认登录。');
          if (state.state === 'expired') await this.sendLoginMessage(e, '二维码已过期，正在自动刷新，请扫新码。', {
            groupNotice: '二维码已过期，正在刷新，详情见私聊。',
          });
        },
      });
      await this.sendLoginMessage(e, `微信桥登录成功（botId: ${credentials.botId || '未知'}）。轮询已启动，发送 #微信机器人状态 查看详情。`, {
        groupNotice: '微信桥登录成功。',
      });
      await this.ensurePoller();
    } catch (error) {
      await this.sendLoginMessage(e, `微信桥登录失败：${error.message}`, {
        groupNotice: `微信桥登录失败：${error.message}`,
      });
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
    await e.reply('任务已提交（全权限模式）。执行过程会分段推送；同一会话保留上下文，直接发消息即可追加指令。');
    try {
      await bridge.runTaskWithReport(promptText, {
        onProgressReply: line => e.reply(line).catch(() => { }),
        onResultReply: async result => {
          const body = String(result?.text || '').trim() || '任务结束。';
          const chunks = splitTextChunks(body, 1500);
          for (let i = 0; i < chunks.length; i++) {
            const head = i === 0 ? (result?.ok ? '✅ 任务完成\n\n' : '❌ 任务未成功\n\n') : `（接上，${i + 1}/${chunks.length}）\n`;
            await e.reply(`${head}${chunks[i]}`);
          }
        },
      });
    } catch (error) {
      await e.reply(`任务提交失败：${error.message}`);
    }
    return true;
  }
}

export default weixinIlink;
