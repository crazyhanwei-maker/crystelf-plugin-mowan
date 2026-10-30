// 聊天 AI 自动调用 Agent 工作台的只读任务入口。
// 约束：仅主人、默认关闭、固定 plan（不写文件/不联网）、提交后立即返回，
// 结果由桥异步回推当前聊天，并写入聊天历史，下一轮聊天 AI 才能看到。
import ConfigControl from '../config/configControl.js';
import {
  createAgentAutoGuard,
  getEventUserId,
  isChannelAllowed,
  isMasterForAgent,
  maskAgentSecrets,
  normalizeAgentAutoConfig,
  truncateAgentResult,
} from './agentAutoConfig.js';

const TASK_TITLE_LIMIT = 80;
const TASK_PROMPT_LIMIT = 4000;
const HISTORY_CONTENT_LIMIT = 4000;
const SESSION_KEY_PREFIX = 'auto';
const AGENT_AUTO_PROMPT_PREFIX = [
  '你正在执行聊天侧自动只读分析。',
  '不要修改文件、不要执行终端命令、不要访问网络。',
  '不要读取或输出 .env、config/ai.json、config/config.json 等可能包含密钥的文件内容；',
  '如需说明配置，只描述字段和结构，不要粘贴密钥值。',
  '输出控制在 800 字以内，直接给结论和关键证据，不要贴大段代码。',
].join('');

const guards = createAgentAutoGuard();
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

function isWorkbenchEnabled() {
  return getCoreConfig()?.tools?.agentWorkbench?.enabled === true;
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

function formatAgentResult(result = {}, taskId = '', config = getAgentAutoConfig()) {
  const ok = result?.ok === true;
  const raw = String(result?.text || '').trim() || (ok ? '任务完成，本轮没有文本产出。' : '任务失败。');
  const { text, truncated } = truncateAgentResult(maskAgentSecrets(raw), config.maxResultChars);
  const idPart = taskId ? `（${taskId}）` : '';
  const head = ok ? `✅ Agent 任务完成${idPart}` : `❌ Agent 任务未完成${idPart}`;
  const note = truncated ? '\n\n（内容过长已截断，完整结果见控制台 Agent 工作台）' : '';
  return `${head}\n\n${text}${note}`;
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
        // 固定只读档：不写文件、不联网；写操作仍走显式 #zcode / #agent
        taskMode: 'plan',
      },
    }));
  }
  return bridges.get(key);
}

export function buildAgentAutoTool(toolCtx = {}) {
  const config = getAgentAutoConfig();
  if (!config.enabled) return null;
  if (!isWorkbenchEnabled()) return null;
  if (!isMasterForAgent(toolCtx, getPluginConfig())) return null;
  if (!isChannelAllowed(toolCtx, config)) return null;

  return {
    name: 'agent_analyze',
    displayName: 'Agent 只读分析',
    description: [
      '把任务交给本地 Agent 工作台做只读分析：可以读取灵晶插件代码、日志和配置文件，但不能修改文件、不能执行终端命令、不能联网。',
      '仅当主人要求查看/分析本地代码、日志、配置，或排查需要读取工作区的报错时调用；普通聊天、常识问答、搜索、天气、新闻等不要调用。',
      '调用后任务在后台执行，结果稍后由 Agent 自动回推到当前聊天；不要在结果到达前编造结论。',
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
    stopOnFailure: true,
    handler: (args, ctx) => handleAgentAnalyze(args, ctx),
  };
}

export async function handleAgentAnalyze(args = {}, toolCtx = {}) {
  const config = getAgentAutoConfig();
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

  const task = normalizeTask(args?.task);
  if (!task) {
    return { success: false, error: '任务描述不能为空，请写清要分析的文件或问题' };
  }
  if (!toolCtx?.sessionId) {
    return { success: false, error: '当前聊天缺少会话标识，无法回推结果' };
  }

  const sessionKey = getSessionKey(toolCtx);
  const dedupKey = getDedupKey(toolCtx, task);
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
  const providers = getCoreConfig()?.tools?.agentWorkbench?.providers || {};
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

  const taskTitle = `自动:${task.slice(0, 24)}`.slice(0, TASK_TITLE_LIMIT);
  const promptTask = `${AGENT_AUTO_PROMPT_PREFIX}\n\n${task}`;
  const background = bridge.runTaskWithReport(promptTask, {
    title: taskTitle,
    timeoutMs: config.timeoutMs,
    onProgressReply: config.showProgress
      ? line => { void replyToChat(toolCtx, line); }
      : undefined,
    onSubmitted: submittedTask => {
      try {
        const taskId = String(submittedTask?.id || '');
        guards.markSubmitted(sessionKey, taskId);
        const preview = task.length > 120 ? `${task.slice(0, 120)}…` : task;
        const ack = [
          `⏳ 已提交 Agent 只读任务${taskId ? `（${taskId}）` : ''}`,
          preview,
          '完成后结果会发到这里；完整过程可在控制台 Agent 工作台查看。',
        ].join('\n');
        // 让 apps/ai.js 先保存本轮用户消息，避免 ack 的时间戳排在提问前面
        setTimeout(() => {
          saveAgentHistory(toolCtx, ack, config);
          void replyToChat(toolCtx, ack);
        }, 100);
      } catch (error) {
        getLogger()?.warn?.(`[agent-auto] 提交回调失败：${error.message}`);
      }
    },
    onResultReply: async (result, meta = {}) => {
      const active = guards.getActive(sessionKey);
      const taskId = String(meta?.taskId || active?.taskId || '');
      const text = formatAgentResult(result, taskId, config);
      saveAgentHistory(toolCtx, text, config);
      await replyToChat(toolCtx, text);
    },
    onQuestionReply: ({ taskId, request } = {}) => {
      const requestId = String(request?.id || '').trim();
      if (!requestId) return;
      void bridge.rejectQuestion(taskId, requestId).catch(error => {
        getLogger()?.warn?.(`[agent-auto] 自动跳过 Agent 提问失败：${error.message}`);
      });
      getLogger()?.info?.(`[agent-auto] 已自动跳过 Agent 提问：task=${taskId || '?'}`);
    },
    onPermissionReply: ({ taskId, request } = {}) => {
      const requestId = String(request?.id || '').trim();
      if (!requestId) return;
      void bridge.replyPermission(taskId, requestId, 'reject').catch(error => {
        getLogger()?.warn?.(`[agent-auto] 自动拒绝权限审批失败：${error.message}`);
      });
      getLogger()?.info?.(`[agent-auto] 已自动拒绝 Agent 权限审批：task=${taskId || '?'}`);
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

export function getAgentAutoSessionKey(toolCtx = {}) {
  return getSessionKey(toolCtx);
}

export function getAgentAutoActiveTask(toolCtx = {}) {
  return guards.getActive(getSessionKey(toolCtx));
}
