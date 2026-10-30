// 聊天 AI 自动调用 Agent 工作台：只读分析 + 主人确认后的全权限执行。
// 约束：仅主人；分析固定 plan；执行必须由主人下一条消息确认，代码设置 writeConfirmed；
// 执行结果异步回推当前聊天并写入历史，下一轮聊天 AI 才能看到任务状态。
import ConfigControl from '../config/configControl.js';
import {
  createAgentAutoGuard,
  createAgentAutoPendingStore,
  getEventUserId,
  isChannelAllowed,
  isExecuteCancel,
  isExecuteConfirmation,
  isMasterForAgent,
  maskAgentSecrets,
  normalizeAgentAutoConfig,
  shouldAutoDelegateLocalAgent,
  truncateAgentResult,
} from './agentAutoConfig.js';

const TASK_TITLE_LIMIT = 80;
const TASK_PROMPT_LIMIT = 4000;
const HISTORY_CONTENT_LIMIT = 4000;
const PLAN_CONTEXT_LIMIT = 3000;
const SESSION_KEY_PREFIX = 'auto';

const PLAN_PROMPT_PREFIX = [
  '你正在执行聊天侧自动只读分析。',
  '不要修改文件、不要执行终端命令、不要访问网络。',
  '不要读取或输出 .env、config/ai.json、config/config.json 等可能包含密钥的文件内容；',
  '如需说明配置，只描述字段和结构，不要粘贴密钥值。',
  '输出控制在 800 字以内，直接给结论和关键证据，不要贴大段代码。',
].join('');

const EXECUTE_PROMPT_PREFIX = [
  '你正在执行主人已确认的 Agent 全权限任务。',
  '允许修改文件、联网、执行终端命令；请保持改动最小，直接开始实际修改，不要重复计划内容。',
  '不要把 .env、config 文件里的密钥/Token 原文输出到聊天；如涉及配置，只描述字段和改动。',
  '完成后给出简明结论和改动文件列表；不要粘贴大段代码。',
].join('');

const guards = createAgentAutoGuard();
const pending = createAgentAutoPendingStore();
const bridges = new Map();

function getLogger() {
  return globalThis.logger || console;
}

function getCoreConfig() {
  return ConfigControl.get('coreConfig') || {};
}

function getPluginConfig() {
  return ConfigControl.get('config') || {};
}

export function getAgentAutoConfig() {
  return normalizeAgentAutoConfig(getCoreConfig()?.tools?.agentAuto || {});
}

function getWorkbenchConfig() {
  return getCoreConfig()?.tools?.agentWorkbench || {};
}

function isWorkbenchEnabled() {
  return getWorkbenchConfig().enabled === true;
}

function isWorkbenchWritable() {
  const workbench = getWorkbenchConfig();
  return workbench.enabled === true
    && workbench.writeEnabled === true
    && workbench.writableWorkspaces?.plugin === true;
}

function getSessionKey(toolCtx = {}) {
  const event = toolCtx?.event || {};
  const groupId = String(toolCtx?.groupId || event.group_id || '').trim();
  const userId = String(toolCtx?.userId || getEventUserId(event) || 'unknown').trim() || 'unknown';
  return groupId
    ? `${SESSION_KEY_PREFIX}:group:${groupId}:${userId}`
    : `${SESSION_KEY_PREFIX}:private:${userId}`;
}

function getDedupKey(toolCtx = {}, task = '') {
  const event = toolCtx?.event || {};
  const messageId = String(event.message_id || event.msg_id || '').trim();
  return `${getSessionKey(toolCtx)}:${messageId || task.slice(0, 120)}`;
}

function normalizeTask(value) {
  const text = String(value || '').trim();
  if (text.length < 2) return '';
  return text.slice(0, TASK_PROMPT_LIMIT);
}

async function replyToChat(toolCtx = {}, text = '') {
  const content = String(text || '').trim();
  if (!content) return false;
  const event = toolCtx?.event;
  try {
    if (typeof event?.reply === 'function') {
      await event.reply(content, true);
      return true;
    }
  } catch (error) {
    getLogger()?.warn?.(`[agent-auto] 回复当前会话失败：${error.message}`);
  }
  try {
    const bot = globalThis.Bot;
    if (toolCtx?.groupId && typeof bot?.pickGroup === 'function') {
      await bot.pickGroup(toolCtx.groupId)?.sendMsg?.(content);
      return true;
    }
    if (toolCtx?.userId && typeof bot?.pickUser === 'function') {
      await bot.pickUser(toolCtx.userId)?.sendMsg?.(content);
      return true;
    }
  } catch (error) {
    getLogger()?.warn?.(`[agent-auto] 兜底发送失败：${error.message}`);
  }
  return false;
}

function saveAgentHistory(toolCtx = {}, text = '', config = getAgentAutoConfig()) {
  if (config.saveToHistory !== true) return;
  const content = String(text || '').trim();
  if (!content) return;
  try {
    toolCtx?.db?.saveMessage?.({
      sessionId: toolCtx?.sessionId,
      role: 'assistant',
      content: content.slice(0, HISTORY_CONTENT_LIMIT),
      groupId: toolCtx?.groupId || null,
      timestamp: Date.now(),
    });
  } catch (error) {
    getLogger()?.warn?.(`[agent-auto] 写入聊天历史失败：${error.message}`);
  }
}

function saveUserMessage(toolCtx = {}, text = '') {
  const content = String(text || '').trim();
  if (!content) return;
  const event = toolCtx?.event || {};
  try {
    toolCtx?.db?.saveMessage?.({
      sessionId: toolCtx?.sessionId,
      role: 'user',
      content: content.slice(0, HISTORY_CONTENT_LIMIT),
      userId: toolCtx?.userId || getEventUserId(event),
      userName: event?.sender?.nickname || event?.sender?.card || '',
      userRole: event?.sender?.role || (toolCtx?.groupId ? 'member' : 'private'),
      groupId: toolCtx?.groupId || null,
      timestamp: Date.now(),
      messageId: event?.message_id || 0,
    });
  } catch (error) {
    getLogger()?.warn?.(`[agent-auto] 写入用户消息失败：${error.message}`);
  }
}

function maskedPlanText(result = {}, maxChars = PLAN_CONTEXT_LIMIT) {
  const raw = String(result?.text || '').trim();
  if (!raw) return '';
  return truncateAgentResult(maskAgentSecrets(raw), maxChars).text;
}

function formatAgentResult(result = {}, taskId = '', config = getAgentAutoConfig(), { mode = 'plan', executeAvailable = false } = {}) {
  const ok = result?.ok === true;
  const raw = String(result?.text || '').trim() || (ok ? '任务完成，本轮没有文本产出。' : '任务失败。');
  const { text, truncated } = truncateAgentResult(maskAgentSecrets(raw), config.maxResultChars);
  const idPart = taskId ? `（${taskId}）` : '';
  const label = mode === 'full' ? '执行' : '只读';
  const head = ok ? `✅ Agent ${label}任务完成${idPart}` : `❌ Agent 任务未完成${idPart}`;
  const note = truncated ? '\n\n（内容过长已截断，完整结果见控制台 Agent 工作台）' : '';
  const minutes = Math.max(1, Math.round(Number(config.executeConfirmTtlMs || 0) / 60000));
  const hint = mode === 'plan' && ok && result?.modified !== true && executeAvailable
    ? `\n\n💬 ${minutes} 分钟内回复「执行」可把上面的方案落地；回复「取消」放弃。`
    : '';
  return `${head}\n\n${text}${note}${hint}`;
}

function formatFailure(error) {
  return `❌ Agent 任务提交/执行失败：${String(error?.message || error || '未知错误').slice(0, 300)}`;
}

function getOrCreateBridge(sessionKey, createAgentChatBridge) {
  const key = String(sessionKey || '').trim();
  if (!bridges.has(key)) {
    bridges.set(key, createAgentChatBridge({
      senderId: key,
      config: {
        workspaceId: 'plugin',
      },
    }));
  }
  return bridges.get(key);
}

function buildAnalyzeTool() {
  return {
    name: 'agent_analyze',
    displayName: 'Agent 只读分析',
    description: [
      '把任务交给本地 Agent 工作台做只读分析：可以读取灵晶插件代码、日志和配置文件，但不能修改文件、不能执行终端命令、不能联网。',
      '仅当主人要求查看/分析本地代码、日志、配置，或排查需要读取工作区的报错时调用；普通聊天、常识问答、搜索、天气、新闻等不要调用。',
      '调用后任务在后台执行，结果稍后由 Agent 自动回推到当前聊天；不要在结果到达前编造结论。',
      '如果主人明确要求修改文件或执行开发任务，改用 agent_execute（若可用）。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '完整、自包含的任务描述，写清要查看的文件/模块、要回答的问题和期望输出；不要只写“看看这个”。',
        },
      },
      required: ['task'],
    },
    returnToAI: false,
    // 该工具会自行发送 ack/确认提示；空回复时不要补“模型没有产出内容”
    suppressEmptyReply: true,
    stopOnFailure: true,
    handler: (args, ctx) => handleAgentAnalyze(args, ctx),
  };
}

function buildExecuteTool() {
  return {
    name: 'agent_execute',
    displayName: 'Agent 全权限执行',
    description: [
      '当主人明确要求修改本地文件、执行开发任务，或说“执行/按计划执行/开始改”时调用。',
      '调用只会请求主人确认，不会立即执行；只有主人回复“确认执行”后才会真正以全权限运行，可修改文件、联网、执行终端命令。',
      '不要用于普通聊天、搜索或只读分析；只读分析请用 agent_analyze。不要在结果到达前声称任务已执行完成。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '完整、自包含的执行任务，写清要修改的文件/模块、目标和验收方式；不要只写“执行”。',
        },
      },
      required: ['task'],
    },
    returnToAI: false,
    // 该工具会自行发送确认提示；空回复时不要补“模型没有产出内容”
    suppressEmptyReply: true,
    stopOnFailure: true,
    handler: (args, ctx) => handleAgentExecute(args, ctx),
  };
}

export function buildAgentAutoTools(toolCtx = {}) {
  const config = getAgentAutoConfig();
  if (!config.enabled) return [];
  if (!isWorkbenchEnabled()) return [];
  if (!isMasterForAgent(toolCtx, getPluginConfig())) return [];
  if (!isChannelAllowed(toolCtx, config)) return [];
  const tools = [buildAnalyzeTool()];
  if (config.allowExecute && isWorkbenchWritable()) {
    tools.push(buildExecuteTool());
  }
  return tools;
}

export async function handleAgentAnalyze(args = {}, toolCtx = {}) {
  return await startAgentTask(toolCtx, args?.task, {
    mode: 'plan',
    config: getAgentAutoConfig(),
  });
}

export async function handleAgentExecute(args = {}, toolCtx = {}) {
  return await requestAgentExecution(toolCtx, args?.task, getAgentAutoConfig());
}

async function requestAgentExecution(toolCtx = {}, task = '', config = getAgentAutoConfig()) {
  if (!config.enabled) {
    return { success: false, error: '聊天自动 Agent 未启用（coreConfig.tools.agentAuto.enabled）' };
  }
  if (!config.allowExecute) {
    return { success: false, error: '聊天自动 Agent 执行未启用（coreConfig.tools.agentAuto.allowExecute）' };
  }
  if (!isWorkbenchEnabled()) {
    return { success: false, error: 'Agent 工作台未启用，请先在控制台开启' };
  }
  if (!isWorkbenchWritable()) {
    return { success: false, error: 'Agent 实际修改未开启：需要开启「允许 Agent 修改文件」并授权灵晶插件目录' };
  }
  if (!isMasterForAgent(toolCtx, getPluginConfig())) {
    return { success: false, error: '该工具仅限 Bot 主人使用' };
  }
  if (!isChannelAllowed(toolCtx, config)) {
    return { success: false, error: '当前会话未开启自动 Agent（私聊或群白名单）' };
  }
  const taskText = normalizeTask(task);
  if (!taskText) {
    return { success: false, error: '任务描述不能为空，请写清要修改的文件或目标' };
  }
  if (isExecuteConfirmation(taskText) || isExecuteCancel(taskText)) {
    return { success: false, error: '请说明要执行的具体任务，或在上一轮分析结果后回复「执行」' };
  }
  if (!toolCtx?.sessionId) {
    return { success: false, error: '当前聊天缺少会话标识，无法回推结果' };
  }

  const sessionKey = getSessionKey(toolCtx);
  if (pending.peek(sessionKey, config.executeConfirmTtlMs)) {
    return { success: false, error: '当前会话已有待确认/待执行任务，请先回复「执行」或「取消」' };
  }
  if (guards.getActive(sessionKey)) {
    return { success: false, error: '当前会话已有 Agent 任务在执行，等它结束再试' };
  }

  pending.remember(sessionKey, {
    type: 'confirm',
    prompt: taskText,
    taskId: '',
  }, config.executeConfirmTtlMs);

  const minutes = Math.max(1, Math.round(Number(config.executeConfirmTtlMs || 0) / 60000));
  const preview = taskText.length > 500 ? `${taskText.slice(0, 500)}…` : taskText;
  const message = [
    '⚠ 即将以全权限执行 Agent 任务（可修改文件、联网、执行终端命令）：',
    preview,
    '任务内的终端权限会自动批准；模型提问会自动跳过。',
    `请在 ${minutes} 分钟内回复「确认执行」开始；回复「取消」放弃。`,
    '改动会留在控制台 Agent 工作台，可用 Git 回滚。',
  ].join('\n');
  // 先让用户看到确认提示；历史稍后写入，避免时间戳排在用户提问前面
  const sent = await replyToChat(toolCtx, message);
  if (!sent) {
    pending.clear(sessionKey);
    return { success: false, error: '确认提示发送失败，请稍后再试' };
  }
  setTimeout(() => {
    saveAgentHistory(toolCtx, message, config);
  }, 100);
  return { success: true, delivered: true, confirmationRequired: true };
}

async function startAgentTask(toolCtx = {}, task = '', { mode = 'plan', config = getAgentAutoConfig(), confirmed = false, titlePrefix = '', displayTask = '' } = {}) {
  const normalizedMode = mode === 'full' ? 'full' : 'plan';
  if (!config.enabled) {
    return { success: false, error: '聊天自动 Agent 未启用（coreConfig.tools.agentAuto.enabled）' };
  }
  if (!isWorkbenchEnabled()) {
    return { success: false, error: 'Agent 工作台未启用，请先在控制台开启' };
  }
  if (!isMasterForAgent(toolCtx, getPluginConfig())) {
    return { success: false, error: '该工具仅限 Bot 主人使用' };
  }
  if (!isChannelAllowed(toolCtx, config)) {
    return { success: false, error: '当前会话未开启自动 Agent（私聊或群白名单）' };
  }
  const taskText = normalizeTask(task);
  if (!taskText) {
    return { success: false, error: '任务描述不能为空，请写清要分析/执行的文件或问题' };
  }
  if (!toolCtx?.sessionId) {
    return { success: false, error: '当前聊天缺少会话标识，无法回推结果' };
  }
  if (normalizedMode === 'full') {
    if (!config.allowExecute) {
      return { success: false, error: '聊天自动 Agent 执行未启用（coreConfig.tools.agentAuto.allowExecute）' };
    }
    if (confirmed !== true) {
      return { success: false, error: '全权限执行需要主人明确确认' };
    }
    if (!isWorkbenchWritable()) {
      return { success: false, error: 'Agent 实际修改未开启：需要开启「允许 Agent 修改文件」并授权灵晶插件目录' };
    }
  }

  const sessionKey = getSessionKey(toolCtx);
  const dedupKey = getDedupKey(toolCtx, taskText);
  if (pending.peek(sessionKey, config.executeConfirmTtlMs)?.type === 'confirm') {
    return { success: false, error: '当前会话已有待确认的执行任务，请先回复「确认执行」或「取消」' };
  }
  if (guards.seenRecently(dedupKey)) {
    return { success: true, delivered: true, duplicate: true };
  }

  let bridgeModule;
  try {
    bridgeModule = await import('../agent/agentChatBridge.js');
  } catch (error) {
    getLogger()?.warn?.(`[agent-auto] Agent 桥加载失败：${error.message}`);
    return { success: false, error: 'Agent 桥加载失败，请查看 Bot 日志' };
  }
  const { createAgentChatBridge, getBridgeProvider } = bridgeModule;
  if (typeof createAgentChatBridge !== 'function') {
    return { success: false, error: 'Agent 桥不可用' };
  }
  const providerId = getBridgeProvider();
  const providers = getWorkbenchConfig().providers || {};
  if (providers[providerId] === false) {
    return { success: false, error: `当前 Agent 后端（${providerId}）已停用` };
  }

  let bridge;
  try {
    bridge = getOrCreateBridge(sessionKey, createAgentChatBridge);
  } catch (error) {
    getLogger()?.warn?.(`[agent-auto] Agent 桥初始化失败：${error.message}`);
    return { success: false, error: 'Agent 桥初始化失败，请查看 Bot 日志' };
  }
  if (await bridge.isBusy()) {
    return { success: false, error: '当前会话已有 Agent 任务在执行，等它结束再试' };
  }

  const guardResult = guards.begin(sessionKey, config, dedupKey);
  if (!guardResult.ok) {
    if (guardResult.duplicate === true) {
      return { success: true, delivered: true, duplicate: true };
    }
    return { success: false, error: guardResult.error };
  }
  guards.remember(dedupKey);

  const defaultPrefix = normalizedMode === 'full' ? '执行' : '自动';
  const displayText = String(displayTask || taskText).trim();
  const taskTitle = `${titlePrefix || defaultPrefix}:${displayText.slice(0, 24)}`.slice(0, TASK_TITLE_LIMIT);
  const promptTask = `${normalizedMode === 'full' ? EXECUTE_PROMPT_PREFIX : PLAN_PROMPT_PREFIX}\n\n${taskText}`;
  const timeoutMs = normalizedMode === 'full' ? config.executeTimeoutMs : config.timeoutMs;
  const background = bridge.runTaskWithReport(promptTask, {
    taskMode: normalizedMode,
    title: taskTitle,
    timeoutMs,
    onProgressReply: config.showProgress
      ? line => { void replyToChat(toolCtx, line); }
      : undefined,
    onSubmitted: submittedTask => {
      try {
        const taskId = String(submittedTask?.id || '');
        guards.markSubmitted(sessionKey, taskId);
        const preview = displayText.length > 120 ? `${displayText.slice(0, 120)}…` : displayText;
        const ack = normalizedMode === 'full'
          ? [
              `⚡ 已提交 Agent 执行任务${taskId ? `（${taskId}）` : ''}`,
              '全权限：可修改文件、联网、执行终端命令；排队时会稍后开始。',
              `任务：${preview}`,
              '完成后结果会发到这里；改动可在控制台 Agent 工作台查看并回滚。',
            ].join('\n')
          : [
              `⏳ 已提交 Agent 只读任务${taskId ? `（${taskId}）` : ''}`,
              preview,
              '完成后结果会发到这里；完整过程可在控制台 Agent 工作台查看。',
            ].join('\n');
        // 先让用户看到 ack；历史稍后写入，避免时间戳排在用户提问前面
        void replyToChat(toolCtx, ack);
        setTimeout(() => {
          saveAgentHistory(toolCtx, ack, config);
        }, 100);
      } catch (error) {
        getLogger()?.warn?.(`[agent-auto] 提交回调失败：${error.message}`);
      }
    },
    onResultReply: async (result, meta = {}) => {
      const active = guards.getActive(sessionKey);
      const taskId = String(meta?.taskId || active?.taskId || '');
      const executeAvailableNow = config.allowExecute && isWorkbenchWritable();
      let canExecutePlan = false;
      if (normalizedMode === 'plan' && executeAvailableNow && result?.ok === true && result?.modified !== true) {
        const planText = maskedPlanText(result, PLAN_CONTEXT_LIMIT);
        if (planText && pending.peek(sessionKey, config.executeConfirmTtlMs)?.type !== 'confirm') {
          pending.remember(sessionKey, {
            type: 'plan',
            prompt: planText,
            task: taskText,
            taskId,
          }, config.executeConfirmTtlMs);
          canExecutePlan = true;
        }
      }
      const text = formatAgentResult(result, taskId, config, { mode: normalizedMode, executeAvailable: canExecutePlan });
      saveAgentHistory(toolCtx, text, config);
      await replyToChat(toolCtx, text);
    },
    onQuestionReply: ({ taskId, request } = {}) => {
      const requestId = String(request?.id || '').trim();
      if (!requestId) return;
      void bridge.rejectQuestion(taskId, requestId).catch(error => {
        getLogger()?.warn?.(`[agent-auto] 自动跳过 Agent 提问失败：${error.message}`);
      });
      if (normalizedMode === 'full') {
        void replyToChat(toolCtx, '❓ Agent 提问已自动跳过（自动执行模式），让它按合理假设继续。');
      }
      getLogger()?.info?.(`[agent-auto] 已自动跳过 Agent 提问：task=${taskId || '?'}`);
    },
    onPermissionReply: ({ taskId, request } = {}) => {
      const requestId = String(request?.id || '').trim();
      if (!requestId) return;
      const reply = normalizedMode === 'full' ? 'once' : 'reject';
      void bridge.replyPermission(taskId, requestId, reply).catch(error => {
        getLogger()?.warn?.(`[agent-auto] Agent 权限审批处理失败：${error.message}`);
      });
      if (normalizedMode === 'full') {
        const title = String(request?.title || request?.command || request?.description || '终端命令').slice(0, 80);
        void replyToChat(toolCtx, `🔐 已自动批准 Agent 操作：${title}`);
      }
      getLogger()?.info?.(`[agent-auto] Agent 权限审批：task=${taskId || '?'} reply=${reply}`);
    },
    onEventNotice: notice => {
      getLogger()?.info?.(`[agent-auto] 事件 ${notice?.type || 'unknown'} task=${notice?.taskId || '?'}`);
    },
  });

  Promise.resolve(background)
    .catch(error => {
      const text = formatFailure(error);
      saveAgentHistory(toolCtx, text, getAgentAutoConfig());
      void replyToChat(toolCtx, text);
      getLogger()?.warn?.(`[agent-auto] 任务失败：${error.message}`);
    })
    .finally(() => {
      guards.release(sessionKey);
    });

  return { success: true, delivered: true, status: 'submitted' };
}

// 由 apps/ai.js 在正常聊天前调用：只有存在待执行计划/待确认任务，且主人发来精确的
// “执行/确认执行/取消”时才拦截，避免把普通聊天误当成执行授权。
export async function maybeHandleAgentAutoExecution(toolCtx = {}, text = '') {
  const config = getAgentAutoConfig();
  if (!config.enabled || !config.allowExecute) return false;
  if (!isMasterForAgent(toolCtx, getPluginConfig())) return false;
  if (!isChannelAllowed(toolCtx, config)) return false;

  const sessionKey = getSessionKey(toolCtx);
  const result = pending.consume(sessionKey, text, config.executeConfirmTtlMs);
  if (!result) return false;

  if (result.status === 'expired') {
    saveUserMessage(toolCtx, text);
    const notice = '待执行任务已超过有效期，请重新发起 Agent 任务。';
    saveAgentHistory(toolCtx, notice, config);
    await replyToChat(toolCtx, notice);
    return true;
  }
  if (result.status === 'cancelled') {
    saveUserMessage(toolCtx, text);
    const notice = '已取消待执行/待确认的 Agent 任务。';
    saveAgentHistory(toolCtx, notice, config);
    await replyToChat(toolCtx, notice);
    return true;
  }
  if (result.status !== 'confirmed') return false;

  saveUserMessage(toolCtx, text);
  const entry = result.entry || {};
  const stored = String(entry.prompt || '').trim();
  const originalTask = String(entry.task || '').trim().slice(0, 800);
  let task = stored;
  if (entry.type === 'plan') {
    const contextParts = [];
    if (originalTask) contextParts.push(`原始任务：\n${originalTask}`);
    if (stored) contextParts.push(`上一轮只读分析给出的方案/结论：\n${stored}`);
    task = `请按照下面的方案/计划直接开始执行实际修改，不要重复计划内容。${contextParts.length ? `\n\n${contextParts.join('\n\n')}` : ''}`;
  }
  if (!task) {
    const notice = '待执行任务内容为空，请重新描述执行任务。';
    saveAgentHistory(toolCtx, notice, config);
    await replyToChat(toolCtx, notice);
    return true;
  }

  const startResult = await startAgentTask(toolCtx, task, {
    mode: 'full',
    config,
    confirmed: true,
    titlePrefix: '执行',
    displayTask: originalTask || stored || '按上一轮方案执行',
  });
  if (startResult?.success !== true) {
    const text = `❌ Agent 执行任务未启动：${String(startResult?.error || '未知错误').slice(0, 300)}`;
    saveAgentHistory(toolCtx, text, config);
    await replyToChat(toolCtx, text);
  }
  return true;
}

export async function maybeHandleAgentAutoAnalysis(toolCtx = {}, text = '') {
  const config = getAgentAutoConfig();
  if (!config.enabled) return false;
  if (!isMasterForAgent(toolCtx, getPluginConfig())) return false;
  if (!isChannelAllowed(toolCtx, config)) return false;
  if (!shouldAutoDelegateLocalAgent(text)) return false;
  if (isExecuteConfirmation(text) || isExecuteCancel(text)) return false;
  const result = await handleAgentAnalyze({ task: text }, toolCtx);
  if (result?.success === true) return true;
  const error = String(result?.error || '');
  // 会话正忙时明确告知，避免模型继续编“我没有本地权限”
  if (/已有 Agent 任务|待确认|等它结束/.test(error)) {
    await replyToChat(toolCtx, `⚠ ${error}`);
    return true;
  }
  return false;
}

export function getAgentAutoSessionKey(toolCtx = {}) {
  return getSessionKey(toolCtx);
}

export function getAgentAutoActiveTask(toolCtx = {}) {
  return guards.getActive(getSessionKey(toolCtx));
}
