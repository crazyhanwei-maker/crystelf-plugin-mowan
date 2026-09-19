// 微信 ilink bot 桥（官方 ClawBot 开放接口）：主人白名单私聊 → #agent / #灵晶状态
// plugin 为 Yunzai 运行时注入的全局基类（与其他 apps 一致，不 import）
// 登录：#微信机器人登录 拿登录链接扫码（二维码内容输出到终端/控制台日志）
import fs from 'fs';
import path from 'path';
import ConfigControl from '../lib/config/configControl.js';
import { setBridgePollerRunning } from '../lib/weixin/bridgeState.js';
import {
  loadCredentials,
  clearCredentials,
  loginByQrcode,
  longPollUpdates,
  sendTextMessage,
  sendImageMessage,
  extractTextFromMessage,
  probeQrEndpoint,
  extractIncomingAttachments,
} from '../lib/weixin/ilinkClient.js';
import {
  createAgentChatBridge,
  getBridgeState,
  setBridgeEnabled,
  listAvailableModels,
  setBridgePendingQuestion,
  getBridgePendingQuestion,
  clearBridgePendingQuestion,
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
        { reg: '^#微信机器人诊断$', fnc: 'diagnose', permission: 'master' },
        { reg: '^#agent开关$', fnc: 'toggleAgent', permission: 'master' },
        { reg: '^#agent停止$', fnc: 'stopAgent', permission: 'master' },
        { reg: '^#agent (.+)$', fnc: 'runAgentTask', permission: 'master' },
        // 模型提问转发到 QQ 后的作答/跳过入口
        { reg: '^#(?:回答|跳过)(?:\\s+([\\s\\S]+))?$', fnc: 'answerQuestion', permission: 'master' },
        // QQ 侧斜杠指令（/模型 /思考等级 /进展 等）：与微信桥共用 handleSlashCommand，回复走 e.reply
        // TRSS-Yunzai 开了 bot["/→#"] 会把开头 / 归一化成 #，规则必须同时兼容 # / #/ 前缀
        { reg: '^[#/]+(模型|思考等级|当前配置|配置|停止|进展|压缩|恢复|归档|任务列表|任务|新建任务|取消|退出|帮助|help)(\\s|$)', fnc: 'qqSlashCommand', permission: 'master' },
      ],
    });
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
    setBridgePollerRunning(true);
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
        setBridgePollerRunning(false);
      }
    };
    loop();
  }

  // 失败任务的可重试缓存：senderId -> { prompt, at }（30 分钟内回复「重试」可原样重跑）
  stashFailedPrompt(senderId, prompt) {
    if (!this.failedPromptCache) this.failedPromptCache = new Map();
    this.failedPromptCache.set(senderId, { prompt: String(prompt || ''), at: Date.now() });
  }

  getFailedPrompt(senderId) {
    const entry = this.failedPromptCache?.get(senderId) || null;
    if (!entry) return null;
    if (Date.now() - entry.at > 30 * 60 * 1000) {
      this.failedPromptCache.delete(senderId);
      return null;
    }
    return entry.prompt;
  }

  // 待投喂给 Agent 的图片：senderId -> { attachments, askedAt }（5 分钟过期）
  stashAttachments(senderId, attachments) {
    if (!this.attachmentStash) this.attachmentStash = new Map();
    const existing = this.takeAttachments(senderId) || [];
    this.attachmentStash.set(senderId, { attachments: [...existing, ...attachments].slice(0, 5), askedAt: Date.now() });
  }

  takeAttachments(senderId) {
    const entry = this.attachmentStash?.get(senderId) || null;
    if (!entry) return null;
    this.attachmentStash.delete(senderId); // take 语义：取走即清空
    if (Date.now() - entry.askedAt > 5 * 60 * 1000) return null;
    return entry.attachments;
  }

  clearAttachments(senderId) {
    this.attachmentStash?.delete(senderId);
  }

  async handleIncoming(update, token) {
    const { senderId, content, contextToken, messageType } = extractIncomingMessage(update);
    if (!senderId) return;
    if (messageType !== MessageTypeUSER && messageType !== 0) return; // 只处理用户消息(1)，0 视为兼容

    // 图片消息：先提取暂存（5 分钟内发的任务描述会自动带上）
    let incomingAttachments = [];
    try {
      incomingAttachments = await extractIncomingAttachments(update, { logger });
    } catch (error) {
      logger.warn(`[weixin-ilink] 图片提取失败：${error.message}`);
    }
    if (incomingAttachments.length) {
      this.stashAttachments(senderId, incomingAttachments);
      if (!content) {
        await this.sendTo(senderId, `收到 ${incomingAttachments.length} 张图片（保留 5 分钟）。发 /新建任务 后描述任务，或直接发任务描述，图片会一并交给 Agent。`, token);
        return;
      }
    }
    if (!content) return;
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

    // ── 「看全文」：取回最近一次长结论的纯文本（任务模式里也优先响应）──
    if (/^(看全文|全文)$/.test(trimmed)) {
      const fullText = this.takeFullText(senderId);
      if (!fullText) {
        await this.sendTo(senderId, '暂无可查看的长文。长结论任务完成后 10 分钟内回复「看全文」有效。', token);
        return;
      }
      for (const chunk of splitTextChunks(fullText, 1000)) {
        await this.sendTo(senderId, chunk, token);
      }
      return;
    }

    // ── 任务列表后的编号：切换到对应会话（仅刚看完列表后的下一条数字消息生效）──
    if (/^\d+$/.test(trimmed) && this.taskSwitchChoices?.has(`${senderId}:${Number(trimmed) - 1}`)) {
      const targetId = this.taskSwitchChoices.get(`${senderId}:${Number(trimmed) - 1}`);
      this.taskSwitchChoices.delete(`${senderId}:${Number(trimmed) - 1}`);
      this.taskSwitchChoices.clear(); // 一次性选择：消费任意编号后整表作废（避免残留旧列表误触）
      try {
        const switched = this.getBridge(senderId).switchSession(targetId);
        let ctxLine = '';
        const tasks = this.getBridge(senderId).listMyTasks?.(20) || [];
        const matched = tasks.find(t => t.id === switched.id);
        if (matched && matched.contextLimit > 0 && matched.contextUsage > 0) {
          const percent = Math.min(100, Math.round((matched.contextUsage / matched.contextLimit) * 100));
          ctxLine = `上下文已用 ${percent}%${percent > 70 ? '（偏高：可能遗忘早期细节，可用 /会话重置 重开）' : ''}。`;
        }
        await this.sendTo(senderId, `已切换到「${switched.title.slice(0, 24)}」的会话：之后发 /新建任务 或直接发 #agent <任务> 会接着它的上下文继续。${ctxLine}`, token);
      } catch (error) {
        await this.sendTo(senderId, `切换失败：${error.message}`, token);
      }
      return;
    }
    // 数字没匹配到切换选择 → 清掉过期选择表，走正常流程
    if (/^\d+$/.test(trimmed) && this.taskSwitchChoices?.size) {
      this.taskSwitchChoices.clear();
    }

    // ── 「重试」：30 分钟内失败过的任务原样重跑（描述 + 模型/思考等级都是当前配置）──
    if (/^重试$/.test(trimmed)) {
      const failedPrompt = this.getFailedPrompt(senderId);
      if (!failedPrompt) {
        await this.sendTo(senderId, '暂无可重试的失败任务（失败后 30 分钟内回复「重试」有效）。', token);
        return;
      }
      const bridge = this.getBridge(senderId);
      if (await bridge.isBusy()) {
        await this.sendTo(senderId, '当前有任务在执行中，结束后再回「重试」。', token);
        return;
      }
      await this.sendTo(senderId, `重试上次失败的任务：${failedPrompt.slice(0, 60)}${failedPrompt.length > 60 ? '…' : ''}`, token);
      await this.dispatchAgent(senderId, failedPrompt, token);
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
    if (cmd === '进展') {
      const progress = this.getBridge(senderId).latestProgress?.() || { running: false, text: '当前没有可查询的任务。' };
      const head = progress.running
        ? `⏳ ${progress.status === 'queued' ? `排队中（第 ${progress.queuePosition || 1} 位）` : `运行中（已 ${progress.elapsedSec} 秒）`}`
        : `任务不在运行中（状态：${progress.status || '无'}）`;
      await this.sendTo(senderId, `${head}
最新：${String(progress.text || '').slice(0, 300)}`, token);
      return;
    }
    if (cmd === '压缩') {
      const bridge = this.getBridge(senderId);
      if (await bridge.isBusy()) {
        await this.sendTo(senderId, '任务执行中不能压缩，等本轮结束。', token);
        return;
      }
      try {
        const result = await bridge.compactSession();
        const percent = result?.limit > 0 ? `，当前约 ${Math.min(100, Math.round((result.usage / result.limit) * 100))}%` : '';
        await this.sendTo(senderId, `✅ 上下文已压缩${percent}。模型可以继续较长对话了。`, token);
      } catch (error) {
        await this.sendTo(senderId, `压缩失败：${error.message}`, token);
      }
      return;
    }
    if (cmd === '恢复') {
      const bridge = this.getBridge(senderId);
      if (await bridge.isBusy()) {
        await this.sendTo(senderId, '当前有任务在执行中，不能恢复其他任务。', token);
        return;
      }
      const resumable = bridge.findResumable?.();
      if (!resumable) {
        await this.sendTo(senderId, '没有可恢复的任务（只有服务重启时被中断的任务可以恢复）。', token);
        return;
      }
      await this.sendTo(senderId, `正在恢复中断任务「${resumable.title.slice(0, 30)}」，完成后结论会推给你。`, token);
      try {
        await bridge.resumeInterrupted({
          onProgressReply: line => this.sendTo(senderId, line).catch(() => { }),
          onResultReply: result => this.sendReport(senderId, result, token).catch(() => { }),
          onEventNotice: notice => {
            if (notice?.type === 'cancel-external') this.sendTo(senderId, 'ℹ 任务在控制台被取消。', token).catch(() => { });
          },
        });
      } catch (error) {
        await this.sendTo(senderId, `恢复失败：${error.message}`, token);
      }
      return;
    }
    if (cmd === '归档') {
      const bridge = this.getBridge(senderId);
      if (await bridge.isBusy()) {
        await this.sendTo(senderId, '任务执行中不能归档，先发 /停止。', token);
        return;
      }
      const result = bridge.archiveTasks?.();
      await this.sendTo(senderId, result?.archived
        ? `已归档 ${result.archived} 条已结束的任务（/任务列表 更清爽了）。`
        : '没有可归档的任务（运行中的不会被动）。', token);
      return;
    }
    if (cmd === '任务列表' || cmd === '任务') {
      const tasks = this.getBridge(senderId).listMyTasks?.(5) || [];
      if (!tasks.length) {
        await this.sendTo(senderId, '最近没有你的桥任务。发 /新建任务 开始一个。', token);
        return;
      }
      const ICONS = { success: '✅', error: '❌', running: '⏳', pending: '🕐', queued: '⏸', canceled: '✋', timeout: '⚠', interrupted: '⟳' };
      const lines = tasks.map((task, index) => {
        const ctx = task.contextLimit > 0 && task.contextUsage > 0 ? `，上下文 ${Math.min(100, Math.round((task.contextUsage / task.contextLimit) * 100))}%` : '';
        const warn = task.contextLimit > 0 && task.contextUsage / Math.max(1, task.contextLimit) > 0.7 ? '⚠' : '';
        const queue = task.status === 'queued' && task.queuePosition > 0 ? `，排队第 ${task.queuePosition} 位` : '';
        return `${index + 1}. ${ICONS[task.status] || '·'} ${warn}${task.title.slice(0, 22)}（${task.status}，${Math.max(1, Math.round(task.elapsedMs / 1000))} 秒${queue}${ctx}）`;
      });
      // 记住编号 -> taskId：接下来一条纯数字消息会被当作"切换到该会话"
      this.taskSwitchChoices = new Map(tasks.map((task, index) => [`${senderId}:${index}`, task.id]));
      await this.sendTo(senderId, [
        '最近任务',
        ...lines,
        '',
        '回复编号切换到该会话继续对话；不切换直接发别的指令即可。',
      ].join(String.fromCharCode(10)), token);
      return;
    }
    if (cmd === '会话重置' || cmd === '重置会话') {
      const bridge = this.getBridge(senderId);
      if (await bridge.isBusy()) {
        await this.sendTo(senderId, '任务执行中不能重置会话，先发 /停止。', token);
        return;
      }
      bridge.resetSession?.();
      await this.sendTo(senderId, '上下文已清空：下一条任务从全新会话开始。', token);
      return;
    }
    if (cmd === '灵晶状态' || cmd === '状态') {
      try {
        const { buildStatusData } = await import('./status.js');
        const data = await buildStatusData({ self_id: 'weixin-ilink', adapter_name: 'weixin-ilink' });
        await this.sendTo(senderId, this.buildCompactStatus(data), token);
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
      `内存：${Number.isFinite(Number(resources.memoryPercent)) ? Number(resources.memoryPercent).toFixed(1) : '?'}%  CPU：${Number.isFinite(Number(resources.cpuPercent)) ? Number(resources.cpuPercent).toFixed(1) : '?'}%`,
      `今日 AI：${ai.requestCountText || 0} 次 / ${ai.totalTokensText || 0} tokens`,
      `成本：${ai.costText || '未启用'}`,
      `Agent 桥：${state.enabled ? '开启' : '关闭'} · 模型：${state.model || '默认'}`,
      `思考等级：${state.variant || '默认'}`,
    ].join('\n');
  }

  // /模型 [编号|名称]：列出或选择模型。
  // 列表为空多半是 OpenCode 没跑：首次请求会触发运行时拉起，等一会重试两次再放弃
  async fetchModelsWithWake(senderId, token) {
    const wakeDelayMs = this.modelWakeDelayMs || 15000;
    let models = await (this.listModels || listAvailableModels)();
    if (models.length) return models;
    await this.sendTo(senderId, 'OpenCode 未运行，正在唤醒（首次约需 20~40 秒）…', token);
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, wakeDelayMs));
      models = await (this.listModels || listAvailableModels)();
      if (models.length) return models;
    }
    return [];
  }

  async handleModelCommand(senderId, arg, token) {
    let models = await this.fetchModelsWithWake(senderId, token);
    if (!models.length) {
      await this.sendTo(senderId, '唤醒超时：OpenCode 仍不可用。发 #微信机器人诊断 查看原因。', token);
      return;
    }
    if (!arg) {
      const state = getBridgeState();
      const lines = models.slice(0, 15).map((model, index) => `${index + 1}. ${model.name}${model.id !== model.name ? ` (${model.id})` : ''}${model.reasoning ? ' 🧠' : ''}`);
      lines.push('', `当前：${state.model || '默认'}${state.model && state.modelProviderId ? `（${state.modelProviderId}）` : ''}`, '选择：/模型 <编号或名称>；/模型 0 恢复默认');
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
    setBridgeModel(picked.id, picked.providerId || '');
    await this.sendTo(senderId, `模型已切换：${picked.name}（${picked.providerId || '默认'}）${picked.reasoning ? ' · 支持思考' : ''}。对下一个任务生效；运行中的任务不受影响。`, token);
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
      '⑥ /任务列表 · /会话重置 · /归档 —— 任务管理',
      '⑦ /恢复 —— 继续服务重启时被中断的任务 · /压缩 —— 手动压缩上下文',
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

  // 待答问题的微信侧状态：senderId -> { taskId, requestId, options: [label,...], askedAt }
  // 生命周期：轮询发现提问时建立 → 用户数字回复后提交/拒绝 → 清除；超时 10 分钟自动失效
  rememberPendingQuestion(senderId, entry) {
    if (!this.pendingQuestions) this.pendingQuestions = new Map();
    // entry 显式带 askedAt 时保留（重挂/测试回填），否则从现在起算
    const stored = { askedAt: Date.now(), ...entry };
    this.pendingQuestions.set(senderId, stored);
    // 同步到桥状态文件：bot 重启后 #回答 仍可用（内存映射会被重启清空）
    setBridgePendingQuestion(senderId, stored);
  }

  takePendingQuestion(senderId) {
    // 内存映射优先，重启后从桥状态文件恢复（跨重启可作答）
    let entry = this.pendingQuestions?.get(senderId) || getBridgePendingQuestion(senderId);
    if (!entry) return null;
    if (Date.now() - (entry.askedAt || 0) > 10 * 60 * 1000) {
      this.pendingQuestions?.delete(senderId);
      clearBridgePendingQuestion(senderId);
      return null;
    }
    return entry;
  }

  clearPendingQuestion(senderId) {
    this.pendingQuestions?.delete(senderId);
    clearBridgePendingQuestion(senderId);
  }

  // 把模型的提问渲染成编号选择清单（微信没有点选卡片，用数字回复）
  formatQuestion(entry) {
    const lines = [];
    for (const question of entry.questions.slice(0, 3)) {
      if (question.header) lines.push(`【${question.header}】`);
      if (question.question) lines.push(String(question.question).slice(0, 400));
      const options = Array.isArray(question.options) ? question.options.slice(0, 8) : [];
      options.forEach((option, index) => {
        const label = String(option?.label || '').trim();
        if (!label) return;
        lines.push(`${index + 1}. ${label}${option.description ? `（${String(option.description).slice(0, 60)}）` : ''}`);
      });
      if (question.custom !== false) lines.push('也可直接输入自定义回答。');
      lines.push('回复编号选择；发「跳过」让模型自行决定。');
    }
    return lines.join('\n');
  }

  // 任务模式下的消息：模型提问待答 → 数字/文字作答；执行中 → 并入当前任务；空闲 → 同一会话里开新一轮
  async handleTaskMessage(senderId, text, token) {
    const bridgeState = getBridgeState();
    if (!bridgeState.enabled) {
      await this.sendTo(senderId, 'Agent 桥当前关闭：QQ 侧发送 #agent开关 打开后再试。', token);
      return;
    }
    // 暂存的图片附件先取走（任务模式里的任何去向都随消息带上）
    const attachments = this.takeAttachments(senderId) || [];
    if (attachments.length) this.clearAttachments(senderId);
    const bridge = this.getBridge(senderId);
    const progress = bridge.getProgress?.() || {};

    // 模型提问待答：数字 = 选选项，其他文字 = 自定义回答，「跳过」= 拒绝
    const pending = this.takePendingQuestion(senderId);
    if (pending) {
      try {
        if (/^(跳过|skip)$/i.test(text.trim())) {
          await bridge.rejectQuestion(pending.taskId, pending.requestId);
          this.clearPendingQuestion(senderId);
          await this.sendTo(senderId, '已跳过该问题，模型会自行决定下一步。', token);
        } else {
          const numeric = /^\d+$/.test(text.trim())
            ? pending.options[Number(text.trim()) - 1] || null
            : null;
          if (/^\d+$/.test(text.trim()) && !numeric) {
            await this.sendTo(senderId, `编号超出范围（1~${pending.options.length}），请重新选择。`, token);
            this.rememberPendingQuestion(senderId, pending);
            return;
          }
          await bridge.answerQuestion(pending.taskId, pending.requestId, [numeric || text.trim()]);
          this.clearPendingQuestion(senderId);
          await this.sendTo(senderId, `已回答：${numeric || text.trim().slice(0, 50)}`, token);
        }
      } catch (error) {
        this.clearPendingQuestion(senderId);
        await this.sendTo(senderId, `回答提交失败：${error.message}。可直接再发一条消息继续任务。`, token);
      }
      return;
    }

    if (progress.running) {
      if (/^停止$/.test(text)) {
        const stopped = await bridge.cancelActive();
        await this.sendTo(senderId, stopped ? '已发送取消请求，任务将中断。' : '取消请求未生效（任务可能刚结束）。', token);
        return;
      }
      if (/^继续$/.test(text)) {
        await this.sendTo(senderId, '任务仍在执行中，无需操作；完成后结论会自动推送。', token);
        return;
      }
      const res = bridge.sendFollowUp(text, attachments);
      await this.sendTo(senderId, res?.queued
        ? `已加入队列（第 ${res.position} 条）：本轮结束后立即在同一会话里执行，结论会单独推送。`
        : '当前轮次刚好结束，已作为新一轮任务提交。', token);
      if (!res?.queued) await this.dispatchAgent(senderId, text, token, attachments);
      return;
    }
    await this.dispatchAgent(senderId, text, token, attachments);
  }

  async dispatchAgent(senderId, promptText, token, attachments = []) {
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
    const attachmentNote = attachments.length ? `含 ${attachments.length} 张图片附件。` : '';
    await this.sendTo(senderId, `任务已提交（全权限模式：可改文件、联网、执行命令）。${attachmentNote}执行过程分段推送；同一会话保留上下文，直接发消息即可追加指令。`, token);
    try {
      await bridge.runTaskWithReport(promptText, {
        attachments,
        onProgressReply: line => this.sendTo(senderId, line).catch(() => { }),
        // 控制台侧动作 / 会话事件同步到微信（取消、压缩各提示一次，不刷屏）
        onEventNotice: notice => {
          if (notice?.type === 'cancel-external') this.sendTo(senderId, 'ℹ 检测到任务在控制台被取消，即将停止跟踪。', token).catch(() => { });
          if (notice?.type === 'compacted') this.sendTo(senderId, 'ℹ 会话上下文已达阈值，已自动压缩：模型可能遗忘早期细节；本轮结束后可 /会话重置 或切换任务。', token).catch(() => { });
        },
        // 每一轮（含排队执行的后续指令）单独推送结论；失败轮缓存 prompt 供「重试」
        onResultReply: (result, meta) => {
          if (result?.ok === false && meta?.prompt) this.stashFailedPrompt(senderId, meta.prompt);
          return this.sendReport(senderId, result, token).catch(() => { });
        },
        // 模型提问：微信里没有点选卡片，转成编号清单等用户回复
        onQuestionReply: ({ taskId, request }) => {
          const firstQuestion = (request?.questions || [])[0] || {};
          const options = (firstQuestion.options || []).map(option => String(option?.label || '').trim()).filter(Boolean);
          this.rememberPendingQuestion(senderId, {
            taskId,
            requestId: request?.id || '',
            options,
            questions: request?.questions || [],
          });
          const header = firstQuestion.header ? `【${firstQuestion.header}】\n` : '';
          this.sendTo(senderId, `❓ ${header}${this.formatQuestion(this.takePendingQuestion(senderId))}`, token).catch(() => { });
        },
      });
    } catch (error) {
      await this.sendTo(senderId, `任务提交失败：${error.message}`, token);
    }
  }

  // 长结论渲染成图片所需的临时态：senderId -> { text, askedAt }（10 分钟过期）
  stashFullText(senderId, text) {
    if (!this.fullTextCache) this.fullTextCache = new Map();
    this.fullTextCache.set(senderId, { text: String(text || ''), askedAt: Date.now() });
  }

  takeFullText(senderId) {
    const entry = this.fullTextCache?.get(senderId) || null;
    if (!entry) return null;
    if (Date.now() - entry.askedAt > 10 * 60 * 1000) {
      this.fullTextCache.delete(senderId);
      return null;
    }
    return entry.text;
  }

  // 长结论渲染为长图（微信里读长文比刷多条碎片舒服得多）；失败返回 false 走文本分片
  async sendReportAsImage(senderId, body, token, { qqEvent = null, sendImage = null } = {}) {
    try {
      const [{ default: MarkdownIt }, { renderHtmlToImage }, PathNamespace] = await Promise.all([
        import('markdown-it'),
        import('../lib/system/puppeteerRenderer.js'),
        import('../constants/path.js'),
      ]);
      const PathModule = PathNamespace.default || PathNamespace;
      const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
      const contentHtml = markdown.render(String(body).slice(0, 60000));
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        body { margin: 0; padding: 28px 30px; background: #f6f7f9; font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; }
        .card { background: #ffffff; border-radius: 12px; padding: 24px 26px; box-shadow: 0 1px 4px rgba(0,0,0,.08); color: #24292f; font-size: 15px; line-height: 1.7; word-break: break-word; }
        h1, h2, h3, h4 { margin: 18px 0 10px; line-height: 1.4; }
        h1 { font-size: 21px; } h2 { font-size: 18px; } h3 { font-size: 16px; }
        p { margin: 10px 0; } ul, ol { margin: 8px 0; padding-left: 24px; } li { margin: 4px 0; }
        pre { background: #0d1117; color: #e6edf3; padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.55; }
        code { font-family: Consolas, "JetBrains Mono", monospace; }
        :not(pre) > code { background: #eff1f3; color: #d63384; padding: 2px 6px; border-radius: 4px; font-size: 13.5px; }
        table { border-collapse: collapse; margin: 12px 0; width: 100%; }
        th, td { border: 1px solid #d0d7de; padding: 7px 10px; font-size: 13.5px; text-align: left; }
        th { background: #f2f4f7; }
        blockquote { margin: 10px 0; padding: 6px 14px; border-left: 4px solid #d0d7de; color: #57606a; background: #f6f8fa; }
        img { max-width: 100%; }
        a { color: #0969da; }
      </style></head><body><div class="card">${contentHtml}</div></body></html>`;
      const outputDir = path.join(PathModule.root, 'temp', 'html', 'crystelf-plugin');
      fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `report_${Date.now()}.png`);
      await renderHtmlToImage({
        html,
        outputPath,
        viewport: { width: 860, height: 1200, deviceScaleFactor: 2 },
        minHeight: 600,
        maxHeight: 8000,
      });
      const imageBuffer = fs.readFileSync(outputPath);
      fs.unlinkSync(outputPath);
      if (qqEvent) await this.qqSendImage(qqEvent, imageBuffer);
      else await this.sendImageTo(senderId, imageBuffer, token);
      return true;
    } catch (error) {
      logger.warn(`[weixin-ilink] 结论渲染成图失败，退回文本分片：${error.message}`);
      return false;
    }
  }

  // 最终结论：长文渲染成图 + 摘要 + 「看全文」；短文按段落切成多条发。
  // senderId（微信 ilink 通道）或 qqEvent（QQ e.reply 通道）二选一
  async sendReport(senderId, result, token, { qqEvent = null } = {}) {
    const sendText = async (text) => (qqEvent ? this.qqSend(qqEvent, text) : this.sendTo(senderId, text, token));
    const sendImage = async (buffer) => (qqEvent ? this.qqSendImage(qqEvent, buffer) : this.sendImageTo(senderId, buffer, token));
    const ok = result?.ok === true;
    const body = String(result?.text || '').trim() || '任务结束。';
    const LONG_THRESHOLD = 600;
    if (ok && body.length > LONG_THRESHOLD) {
      const rendered = await this.sendReportAsImage(senderId, body, token, { qqEvent, sendImage });
      if (rendered) {
        this.stashFullText(senderId, body);
        const preview = body.replace(/\s+/g, ' ').slice(0, 150);
        await sendText(`📄 结论共 ${body.length} 字，已渲染成上图。\n摘要：${preview}…\n回复「看全文」获取纯文本。`);
        return;
      }
    }
    if (body.length > LONG_THRESHOLD) this.stashFullText(senderId, body);
    const chunks = splitTextChunks(body, 1000);
    for (let i = 0; i < chunks.length; i++) {
      const head = i === 0 ? (ok ? '✅ 任务完成\n\n' : '❌ 任务未成功\n\n') : `（接上，${i + 1}/${chunks.length}）\n`;
      await sendText(`${head}${chunks[i]}`);
    }
    if (!ok) await sendText('可到控制台查看任务详情；需要重试直接再发一次任务。');
  }

  // QQ 侧单条文本/图片发送（走 e.reply，与微信 ilink 通道解耦）
  async qqSend(e, content) {
    await e.reply(content);
  }

  async qqSendImage(e, imageBuffer) {
    const segmentApi = globalThis.segment;
    if (typeof segmentApi?.image !== 'function') throw new Error('当前框架没有可用的图片消息接口（segment.image）');
    await e.reply(segmentApi.image(`base64://${imageBuffer.toString('base64')}`));
  }

  async sendTo(userId, text, tokenOverride = '') {
    // QQ 斜杠指令执行期间（qqSlashCommand 注册了 sink）：回复改道 e.reply，不进微信发送通道
    const sink = this.qqReplySinks?.get(userId);
    if (sink) {
      await sink(text);
      return;
    }
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
    // 登录二维码等同登录凭证：只允许在私聊使用，群里不受理（也彻底杜绝把码发进群）。
    // 私聊里全程用当前会话回复，不依赖各 Yunzai 分支的私聊接口差异（pickUser/pickFriend）
    if (e?.isGroup) {
      await e.reply('涉及登录二维码，请在私聊中使用。');
      return true;
    }
    await e.reply('开始微信 ilink 登录：二维码随后发出，请用手机微信扫码并在 ClawBot 确认（8 分钟内完成，过期自动刷新）。');
    try {
      const credentials = await loginByQrcode({
        logger,
        // onState 由 loginByQrcode 同步调用、不 await：这里整体兜住，
        // 否则 icqq 发图被拒之类的问题会变成未处理的 Promise 拒绝，直接把进程崩掉
        onState: async state => {
          try {
            if (state.state === 'wait' && state.qrcodeUrl) {
              // 二维码用仓库内置编码器（lib/weixin/qrCode.js）生成，不依赖 npm 的 qrcode 包；
              // 图片发不出去就退回私发链接，不让用户干等
              const segmentApi = globalThis.segment;
              const linkText = `\n若二维码无法扫描，把此链接在手机浏览器打开：\n${state.qrcodeUrl}`;
              if (typeof segmentApi?.image === 'function') {
                try {
                  const { renderQrPng } = await import('../lib/weixin/qrCode.js');
                  const pngBuffer = renderQrPng(state.qrcodeUrl, { width: 480, margin: 3 });
                  await e.reply([segmentApi.image(`base64://${pngBuffer.toString('base64')}`), linkText]);
                } catch (error) {
                  logger.warn(`[weixin-ilink] 二维码图片发送失败：${error.message}`);
                  await e.reply(`二维码图片发送失败（${error.message}），请用手机浏览器打开链接扫码：\n${state.qrcodeUrl}`).catch(() => { });
                }
              } else {
                await e.reply(`当前环境无法生成二维码图片，请用手机浏览器打开这个链接扫码：\n${state.qrcodeUrl}`).catch(() => { });
              }
              if (state.refreshCount > 0) return; // 刷新时上面已发新码
            }
            if (state.state === 'scaned') await e.reply('已扫码，请在手机上确认登录。').catch(() => { });
            if (state.state === 'expired') await e.reply('二维码已过期，正在自动刷新，请扫新码。').catch(() => { });
          } catch (error) {
            logger.warn(`[weixin-ilink] 登录状态推送失败：${error.message}`);
          }
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
    pollerState.running = false;  // 让轮询循环自然退出，下次登录 ensurePoller 能干净重启
    pollerState.started = false;
    setBridgePollerRunning(false);
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

  // #微信机器人诊断：一条命令把登录链路上所有可能卡住的地方挨个验一遍。
  // 只在私聊受理（结果里含路径/版本等运维信息），群里只回一句提示。
  async diagnose(e) {
    if (e?.isGroup) {
      await e.reply('请在私聊中使用。');
      return true;
    }
    const lines = ['微信桥自检'];
    try {
      const Path = (await import('../constants/path.js')).default;
      lines.push(`插件目录：${Path.root}`);
      try {
        const { execFileSync } = await import('child_process');
        const head = execFileSync('git', ['log', '--oneline', '-1'], { cwd: Path.root, timeout: 5000, encoding: 'utf8' }).trim();
        lines.push(`代码版本：${head}`);
        const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: Path.root, timeout: 5000, encoding: 'utf8' }).trim();
        if (dirty) lines.push(`未提交改动：${dirty.split('\n').length} 个文件`);
      } catch (error) {
        lines.push(`代码版本：读取失败（${error.message.slice(0, 60)}）`);
      }
    } catch (error) {
      lines.push(`插件目录：读取失败（${error.message.slice(0, 60)}）`);
    }

    lines.push(`Node：${process.version}`);
    try {
      const { renderQrPng } = await import('../lib/weixin/qrCode.js');
      const png = renderQrPng('微信桥自检', { width: 320, margin: 3 });
      lines.push(`二维码生成：可用（${png.length} 字节 PNG）`);
    } catch (error) {
      lines.push(`二维码生成：不可用（${error.message}）`);
    }

    try {
      const probe = await probeQrEndpoint({ timeoutMs: 12000 });
      lines.push(`ilink 接口：${probe.ok ? '可达' : '异常'}（${probe.detail}）`);
    } catch (error) {
      lines.push(`ilink 接口：异常（${error.message}）`);
    }

    const credentials = this.getCredentials();
    lines.push(`登录凭证：${credentials?.botToken ? `已有（${credentials.botId || '未知 botId'}）` : '无'}`);
    lines.push(`轮询：${pollerState.running ? '运行中' : '已停止'}`);
    const segmentApi = globalThis.segment;
    const botApi = globalThis.Bot || {};
    const canPrivate = typeof botApi.pickUser === 'function' || typeof botApi.pickFriend === 'function';
    lines.push(`图片消息：${typeof segmentApi?.image === 'function' ? 'segment 可用' : 'segment 不可用'} / 私聊接口：${canPrivate ? `可用（${typeof botApi.pickUser === 'function' ? 'pickUser' : 'pickFriend'}）` : '不可用'}`);

    await e.reply(lines.join('\n'));
    return true;
  }

  // QQ 侧斜杠指令：与微信桥共用 handleSlashCommand（含 /模型 供应商透传），
  // 执行期间把 sendTo 改道到 e.reply；/新建任务 的黏性任务模式不适用于群聊，改为引导
  async qqSlashCommand(e) {
    // TRSS 的 /→# 会把 /模型 变 #模型；统一剥掉前缀再按 '/命令' 交给 handleSlashCommand
    const text = '/' + String(e.msg || '').trim().replace(/^[#/]+/, '');
    if (/^\/新建任务/i.test(text)) {
      await e.reply([
        'QQ 里不需要任务模式：直接发 #agent <任务描述> 即可（全权限、同一会话续跑）。',
        '常用指令：/模型、/思考等级、/进展、/任务列表、/停止。',
      ].join('\n'));
      return true;
    }
    const senderKey = `qq:${e.user_id}`;
    if (!this.qqReplySinks) this.qqReplySinks = new Map();
    // sendReport 等路径可能用裸 user_id 寻址，两个键都挂上 sink
    const sink = async replyText => { await e.reply(String(replyText || '')); };
    this.qqReplySinks.set(senderKey, sink);
    this.qqReplySinks.set(String(e.user_id), sink);
    try {
      await this.handleSlashCommand(senderKey, text, '');
    } catch (error) {
      await e.reply(`指令执行失败：${error.message}`).catch(() => { });
    } finally {
      this.qqReplySinks.delete(senderKey);
      this.qqReplySinks.delete(String(e.user_id));
    }
    return true;
  }

  // QQ 侧模型提问作答：#回答 编号/自定义答案，#回答 跳过 = 拒绝（模型自行决定）
  async answerQuestion(e) {
    const senderKey = `qq:${e.user_id}`;
    const raw = String(e.msg || '').trim();
    const isSkip = /^#跳过/.test(raw);
    const text = isSkip ? '跳过' : raw.replace(/^#回答\s*/i, '').trim();
    const pending = this.takePendingQuestion(senderKey);
    if (!pending) {
      await e.reply('当前没有待回答的问题。').catch(() => { });
      return true;
    }
    try {
      if (/^(跳过|skip)$/i.test(text)) {
        await this.getBridge(senderKey).rejectQuestion(pending.taskId, pending.requestId);
        this.clearPendingQuestion(senderKey);
        await e.reply('已跳过该问题，模型会自行决定下一步。');
        return true;
      }
      const numeric = /^\d+$/.test(text) ? pending.options[Number(text) - 1] || null : null;
      if (/^\d+$/.test(text) && !numeric) {
        await e.reply(`编号超出范围（1~${pending.options.length}），请重新 #回答。`);
        this.rememberPendingQuestion(senderKey, pending);
        return true;
      }
      await this.getBridge(senderKey).answerQuestion(pending.taskId, pending.requestId, [numeric || text]);
      this.clearPendingQuestion(senderKey);
      await e.reply(`已回答：${String(numeric || text).slice(0, 50)}`);
    } catch (error) {
      this.rememberPendingQuestion(senderKey, pending);
      await e.reply(`回答提交失败：${error.message}`);
    }
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
        // 模型提问转发到 QQ：转编号清单，用 #回答 作答（微信侧同款机制）
        onQuestionReply: ({ taskId, request }) => {
          const senderKey = `qq:${e.user_id}`;
          const firstQuestion = (request?.questions || [])[0] || {};
          const options = (firstQuestion.options || []).map(option => String(option?.label || '').trim()).filter(Boolean);
          this.rememberPendingQuestion(senderKey, {
            taskId,
            requestId: request?.id || '',
            options,
            questions: request?.questions || [],
          });
          const header = firstQuestion.header ? `【${firstQuestion.header}】\n` : '';
          e.reply(`❓ ${header}${this.formatQuestion(this.takePendingQuestion(senderKey))}\n（回复 #回答 编号 或 #回答 你的答案；#回答 跳过 让模型自行决定）`).catch(() => { });
        },
        // 与微信侧一致：长结论渲染成图、失败缓存供「重试」
        onResultReply: (result, meta) => {
          if (result?.ok === false && meta?.prompt) this.stashFailedPrompt(`qq:${e.user_id}`, meta.prompt);
          return this.sendReport(e.user_id, result, '', { qqEvent: e }).catch(error => logger.warn(`[weixin-ilink] QQ 侧结论推送失败：${error.message}`));
        },
        onEventNotice: notice => {
          if (notice?.type === 'cancel-external') e.reply('ℹ 检测到任务在控制台被取消，即将停止跟踪。').catch(() => { });
          if (notice?.type === 'compacted') e.reply('ℹ 会话上下文已达阈值，已自动压缩：模型可能遗忘早期细节。').catch(() => { });
        },
      });
    } catch (error) {
      await e.reply(`任务提交失败：${error.message}`);
    }
    return true;
  }
}

export default weixinIlink;
