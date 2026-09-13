// 主人私聊 → Agent 工作台 会话桥（QQ 桥 / 微信 ilink 桥 共用的核心壳）
// 职责：#agent 提交任务、等待完成、回报过程内容（不含思考链）、#agent停止 取消
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import ConfigControlModule from '../config/configControl.js';
import { createAgentWorkbenchConsole } from '../webConsole/agentWorkbenchConsole.js';
import Path from '../../constants/path.js';

const BRIDGE_STORE_FILE = path.join(Path.data, 'agent-chat-bridge.json');

const DEFAULTS = {
  enabled: false,
  workspaceId: 'plugin',
  mode: 'analyze',
  sessionBySender: new Map(),
};

// 桥任务固定用完全访问模式（主人侧发起，工作目录可写、可联网、可执行终端命令；
// 控制台配置 writeEnabled/writableWorkspaces 需为 true，高危操作仍由 safety prompt 要求先确认）
const BRIDGE_TASK_MODE = 'full';

// 任务标题前缀：用于按发送者归属桥任务（createTask 不透传 source）
const BRIDGE_TITLE_PREFIX = '[桥]';

// 单次 wait 里最多连续处理的轮数（首轮 + 排队的后续指令），防止无限续跑
const MAX_BRIDGE_TURNS = 6;

let sharedConsole = null;
let consoleRefs = null;

function loadBridgeState() {
  try {
    const raw = JSON.parse(fs.readFileSync(BRIDGE_STORE_FILE, 'utf8'));
    return {
      enabled: raw.enabled === true,
      workspaceId: String(raw.workspaceId || DEFAULTS.workspaceId),
      mode: String(raw.mode || DEFAULTS.mode),
      model: String(raw.model || ''),
      variant: String(raw.variant || ''),
      sessionBySender: new Map(Object.entries(raw.sessionBySender || {})),
    };
  } catch {
    return { ...DEFAULTS, sessionBySender: new Map() };
  }
}

function saveBridgeState(state) {
  try {
    fs.mkdirSync(path.dirname(BRIDGE_STORE_FILE), { recursive: true });
    fs.writeFileSync(BRIDGE_STORE_FILE, JSON.stringify({
      enabled: state.enabled,
      workspaceId: state.workspaceId,
      mode: state.mode,
      model: state.model,
      variant: state.variant,
      sessionBySender: Object.fromEntries(state.sessionBySender),
    }, null, 2));
  } catch { }
}

const bridgeState = loadBridgeState();

function getConsole() {
  if (!sharedConsole) {
    let ConfigControl = null;
    try { ConfigControl = ConfigControlModule; } catch { }
    sharedConsole = createAgentWorkbenchConsole({
      ConfigControl,
      logger: globalThis.logger || console,
      pluginRoot: Path.root,
      yunzaiRoot: Path.yunzai,
    });
  }
  return sharedConsole;
}

function getLogger() {
  return globalThis.logger || console;
}

async function watchTaskCompletion({ taskId, onProgress, onDone, maxWaitMs = 30 * 60 * 1000 }) {
  const consoleApi = getConsole();
  const startedAt = Date.now();
  let lastStepKey = '';
  while (Date.now() - startedAt < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    let task = null;
    try {
      const items = consoleApi.listTasks({ limit: 50, taskId });
      task = (Array.isArray(items) ? items : items?.tasks || []).find(item => item.id === taskId) || null;
    } catch (error) {
      getLogger()?.warn?.(`[agent-chat-bridge] 查询任务失败：${error.message}`);
      continue;
    }
    if (!task) break;
    const steps = Array.isArray(task.liveSteps) ? task.liveSteps : [];
    const latestStep = steps[steps.length - 1];
    const stepKey = latestStep ? `${latestStep.messageId || ''}:${steps.length}` : '';
    if (onProgress && stepKey && stepKey !== lastStepKey) {
      const isFirst = !lastStepKey;
      lastStepKey = stepKey;
      const readable = extractReadableOutput(String(latestStep.content || ''));
      const firstLine = readable.split('\n').map(line => line.trim()).find(Boolean) || '';
      if (firstLine) onProgress({ text: firstLine.slice(0, 120), first: isFirst });
    }
    if (!['pending', 'running', 'queued'].includes(task.status)) {
      onDone(enhanceTaskWithMessages(task));
      return task;
    }
  }
  onDone(null);
  return null;
}

// 任务结束后的正文兜底：outputText 为空时从消息列表取最后一条 assistant 正文
function enhanceTaskWithMessages(task = {}) {
  if (String(task.outputText || '').trim() || !Array.isArray(task.messages)) return task;
  const lastAssistant = [...task.messages].reverse().find(message => message.role === 'assistant' && String(message.content || '').trim());
  if (lastAssistant) task.outputText = String(lastAssistant.content).trim();
  return task;
}

// liveSteps/outputText 偶发混入 OpenCode 事件流原文（JSON 行）：过滤并从中提取 step-start 后的文本部件
function extractReadableOutput(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return '';
  const lines = text.split('\n').filter(Boolean);
  const plain = lines.filter(line => !/^\s*\{/.test(line));
  if (plain.length) return plain.join('\n').trim();
  // 全是 JSON 行：尝试从事件部件里恢复文本
  const parts = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      const part = event?.part || event;
      if (part?.type === 'text' && String(part.text || '').trim()) parts.push(String(part.text).trim());
    } catch { }
  }
  return parts.join('\n').trim();
}

// 结论正文取值顺序：最后一条 assistant 消息（干净结论）> outputText 提取 > 空
// 直接用 outputText 会混入中间的过场话术；outputText 为空时又只剩占位符
export function pickResultText(task = {}) {
  const messages = Array.isArray(task.messages) ? task.messages : [];
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant' && String(message.content || '').trim());
  if (lastAssistant) return String(lastAssistant.content).trim();
  return extractReadableOutput(task.outputText);
}

// 上游/运行时抖动导致的失败文案（自动重试一次）：
// - aborted due to timeout / ECONNRESET 等请求级中断
// - "OpenCode 会话无响应" / "状态查询连续失败" 这类会话失联（注意：跑满 30 分钟预算的"执行超时"不在此列，重试也是白等）
const UPSTREAM_TIMEOUT_PATTERN = /aborted due to timeout|ECONNRESET|fetch failed|socket hang up|会话无响应|状态查询连续失败|暂时不可用/i;

export function isRetryableUpstreamFailure(text = '') {
  return UPSTREAM_TIMEOUT_PATTERN.test(String(text || ''));
}

export function formatTaskResult(task = {}) {
  const content = pickResultText(task);
  if (task.status === 'success') {
    return { ok: true, text: content || '任务完成，本轮没有文本产出。' };
  }
  if (task.status === 'error') {
    return { ok: false, text: `任务失败：${String(task.error || '未知错误').slice(0, 500)}` };
  }
  if (task.status === 'canceled' || task.status === 'interrupted') {
    return { ok: false, text: '任务已取消或中断。' };
  }
  if (task.status === 'timeout') {
    return { ok: false, text: '任务执行超时。' };
  }
  return { ok: false, text: `任务状态：${task.status || '未知'}` };
}

function renderStepLine(step = {}) {
  const text = String(step.text || '').trim();
  return text ? `${step.first ? '⚙ 开始执行' : '⚙ 进展'}：${text}` : '';
}

// 桥任务载荷（导出以便断言：必须带 mode=full + writeConfirmed，控制台才会放开写入权限）
export function buildBridgeTaskPayload({
  senderKey = 'unknown', prompt = '', title = '', sessionId = '',
  workspaceId = DEFAULTS.workspaceId, model = '', variant = '',
} = {}) {
  return {
    providerId: 'opencode',
    mode: BRIDGE_TASK_MODE,
    writeConfirmed: true,
    workspaceId,
    ...(sessionId ? { sessionId: String(sessionId) } : {}),
    ...(model ? { model } : {}),
    ...(variant ? { variant } : {}),
    prompt: String(prompt || '').trim(),
    title: `${BRIDGE_TITLE_PREFIX}${senderKey} ${String(title || '').trim() || '任务'}`.slice(0, 80),
  };
}

// createTask 不透传 source：用标题前缀标记本桥发起的任务
function isBridgeTask(task = {}, senderKey = '') {
  return String(task.title || '').startsWith(BRIDGE_TITLE_PREFIX) && (!senderKey || String(task.title || '').includes(senderKey));
}

// 从任务列表里挑出该通道最近一条桥任务（用于映射缺失时回溯会话，避免上下文断掉）
export function pickLatestBridgeTaskId(tasks = [], senderKey = '') {
  const list = (Array.isArray(tasks) ? tasks : []).filter(task => isBridgeTask(task, senderKey));
  const sorted = list.slice().sort((a, b) => {
    const at = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
    const bt = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
    return bt - at;
  });
  return String(sorted[0]?.id || '');
}

// 创建主人→Agent 的桥实例（每个消息通道一个）
export function createAgentChatBridge({ senderId, reply, config = {} } = {}) {
  const consoleApi = getConsole();
  const senderKey = String(senderId || 'unknown');
  // 运行态进展：任务执行中收到追问时回报最近一步（内存态，重启丢失可接受）
  const progressState = { running: false, text: '', startedAt: 0, updatedAt: 0, taskId: '' };

  async function isBusy() {
    try {
      const items = consoleApi.listTasks({ limit: 50 });
      const tasks = Array.isArray(items) ? items : items?.tasks || [];
      return tasks.some(task => isBridgeTask(task, senderKey) && ['pending', 'running', 'queued'].includes(task.status));
    } catch {
      return false;
    }
  }

  async function submitTask(promptText, { title = '', sessionId = '' } = {}) {
    const buildPayload = sid => buildBridgeTaskPayload({
      senderKey,
      prompt: promptText,
      title,
      sessionId: sid,
      workspaceId: config.workspaceId || bridgeState.workspaceId || DEFAULTS.workspaceId,
      model: bridgeState.model,
      variant: bridgeState.variant,
    });
    try {
      return await consoleApi.createTask(buildPayload(sessionId));
    } catch (error) {
      // 上次会话已被回收：去掉 sessionId 重新开一轮，避免整条指令失败
      if (sessionId && /AGENT_TASK_NOT_FOUND/.test(String(error?.code || error?.message || ''))) {
        return await consoleApi.createTask(buildPayload(''));
      }
      throw error;
    }
  }

  // 会话延续用的任务 id（同一通道的下一轮任务接着上一轮的 OpenCode 会话）
  // 映射缺失时（重启/历史数据/首次部署）从任务列表回溯，避免上下文断掉
  function lastTaskId() {
    const stored = String(bridgeState.sessionBySender.get(senderKey) || '');
    if (stored) return stored;
    try {
      const items = consoleApi.listTasks({ limit: 60 });
      const list = Array.isArray(items) ? items : items?.tasks || [];
      const found = pickLatestBridgeTaskId(list, senderKey);
      if (found) {
        setBridgeSession(senderKey, found);
        getLogger()?.info?.(`[agent-chat-bridge] 回溯到最近桥任务 ${found}（${senderKey}）`);
        return found;
      }
    } catch (error) {
      getLogger()?.warn?.(`[agent-chat-bridge] 回溯最近任务失败：${error.message}`);
    }
    return '';
  }

  // 运行中收到的后续指令：本地排队，本轮结束后立刻在同一会话里接着执行。
  // 不用控制台的运行中跟进（queue 会在收尾窗口被记录却不作答，steer 会把任务打超时）
  const pendingInstructions = [];

  function sendFollowUp(text) {
    const value = String(text || '').trim();
    if (!value || !progressState.running) return { queued: false };
    pendingInstructions.push(value);
    return { queued: true, position: pendingInstructions.length };
  }

  // 停止：优先取消桥自己跟踪的任务（精确），再退回按标题归属搜索（跨重启/历史任务）。
  // 注意 listTasks 的 activeOnly 只认 pending/running，排队中的任务要取全量列表才看得到
  async function cancelActive() {
    const ACTIVE = ['pending', 'running', 'queued'];
    const listAll = () => {
      const items = consoleApi.listTasks({ limit: 50 });
      return Array.isArray(items) ? items : items?.tasks || [];
    };
    try {
      const tracked = progressState.taskId || lastTaskId();
      let targetId = '';
      if (tracked) {
        const found = listAll().find(task => String(task.id) === String(tracked));
        if (found && ACTIVE.includes(found.status)) targetId = found.id;
      }
      if (!targetId) {
        const mine = listAll().find(task => isBridgeTask(task, senderKey) && ACTIVE.includes(task.status));
        targetId = mine ? mine.id : '';
      }
      if (!targetId) {
        getLogger()?.info?.(`[agent-chat-bridge] 停止请求：未找到活动任务（${senderKey}）`);
        return false;
      }
      const result = await consoleApi.cancelTask(targetId);
      const canceled = result?.canceled === true;
      if (canceled) pendingInstructions.length = 0; // 已停止：丢弃本地排队的后续指令
      getLogger()?.info?.(`[agent-chat-bridge] 停止请求：task=${targetId} canceled=${canceled}`);
      return canceled;
    } catch (error) {
      getLogger()?.warn?.(`[agent-chat-bridge] 停止失败：${error.message}`);
      return false;
    }
  }

  async function runTaskWithReport(promptText, { onProgressReply, onResultReply, title = '' } = {}) {
    // 同一通道的后续任务接着上一轮的 OpenCode 会话（传 sessionId 即续跑）
    const resumeId = lastTaskId();
    progressState.running = true;
    progressState.text = '';
    progressState.startedAt = Date.now();
    progressState.updatedAt = 0;
    progressState.taskId = '';
    pendingInstructions.length = 0;
    try {
      let text = promptText;
      let result = null;
      // 每轮一个任务；运行中排队的后续指令在上一轮结论发出后立即开下一轮
      for (let turn = 0; turn < MAX_BRIDGE_TURNS; turn++) {
        const sessionId = turn === 0 ? resumeId : lastTaskId();
        const submit = suffix => submitTask(text, { title: suffix ? `${title}${suffix}` : title, sessionId });
        result = await runTaskLoop(submit, text, { onProgressReply });
        if (typeof onResultReply === 'function') await onResultReply(result, { turn, prompt: text });
        // 失败/取消则不再续跑排队指令，避免连环失败；队列保留给下一次触发
        if (!result?.ok || !pendingInstructions.length) break;
        text = pendingInstructions.shift();
        progressState.text = '';
        progressState.startedAt = Date.now();
        if (typeof onProgressReply === 'function') onProgressReply(`继续处理后续指令（队列剩余 ${pendingInstructions.length} 条）`);
      }
      return result;
    } finally {
      progressState.running = false;
    }
  }

  async function runTaskLoop(submit, promptText, { onProgressReply }) {
    const trackTask = task => {
      if (!task?.id) return task;
      progressState.taskId = String(task.id);
      setBridgeSession(senderKey, task.id);
      return task;
    };
    let task = trackTask(await submit(''));
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        if (typeof onProgressReply === 'function') onProgressReply('上游请求超时，自动重试一次…');
        // 重试会新建任务（或续跑同一会话），当前任务指向必须同步更新
        task = trackTask(await submit('（重试）'));
      }
      let finalTask = null;
      let lastStepKey = '';
      const startedAt = Date.now();
      // 轮询任务状态：running 时推送过程简报；终态判断是否需要重试
      while (Date.now() - startedAt < 30 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const items = consoleApi.listTasks({ limit: 10, taskId: task.id });
        const current = (Array.isArray(items) ? items : items?.tasks || []).find(item => item.id === task.id);
        if (!current) break;
        const steps = Array.isArray(current.liveSteps) ? current.liveSteps : [];
        const latestStep = steps[steps.length - 1];
        const stepKey = latestStep ? `${latestStep.messageId || ''}:${steps.length}` : '';
        if (onProgressReply && stepKey && stepKey !== lastStepKey) {
          lastStepKey = stepKey;
          const firstLine = extractReadableOutput(String(latestStep.content || '')).split('\n').map(line => line.trim()).find(Boolean) || '';
          if (firstLine) {
            progressState.text = firstLine.slice(0, 200);
            progressState.updatedAt = Date.now();
            onProgressReply(`⚙ 进展：${firstLine.slice(0, 120)}`);
          }
        }
        if (['pending', 'running', 'queued'].includes(current.status)) continue;
        finalTask = current;
        break;
      }
      if (!finalTask) {
        return { ok: false, text: '任务等待超时（30 分钟），已停止跟踪；可到控制台查看任务实际状态。' };
      }
      const result = formatTaskResult(finalTask);
      if (!result.ok && attempt === 0 && isRetryableUpstreamFailure(result.text)) {
        continue; // 上游偶发超时：自动重试一次
      }
      return result;
    }
    return { ok: false, text: '任务失败：连续两次上游超时，建议稍后再试。' };
  }

  return {
    senderKey,
    isBusy,
    submitTask,
    sendFollowUp,
    runTaskWithReport,
    cancelActive,
    getProgress: () => ({ ...progressState }),
  };
}

export function getBridgeState() {
  return bridgeState;
}

export function setBridgeEnabled(enabled) {
  bridgeState.enabled = enabled === true;
  saveBridgeState(bridgeState);
  return bridgeState.enabled;
}

export function setBridgeSession(senderKey, taskId) {
  bridgeState.sessionBySender.set(String(senderKey), String(taskId));
  saveBridgeState(bridgeState);
}

export function generateBridgeTaskId() {
  return `bridge-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

// 可用模型列表：来自内置 OpenCode 的 provider 快照（含 variants）
export async function listAvailableModels() {
  try {
    const payload = await getConsole().buildNativePayload();
    const models = [];
    for (const provider of Array.isArray(payload?.providers) ? payload.providers : []) {
      for (const model of Array.isArray(provider.models) ? provider.models : []) {
        models.push({
          id: model.id || '',
          name: model.name || model.id || '',
          providerId: model.providerId || provider.id || '',
          reasoning: model.reasoning === true,
          variants: Array.isArray(model.variants) ? model.variants.filter(Boolean) : [],
        });
      }
    }
    return models;
  } catch (error) {
    getLogger()?.warn?.(`[agent-chat-bridge] 获取模型列表失败：${error.message}`);
    return [];
  }
}

// 选择模型（空串 = 恢复默认）
export function setBridgeModel(model) {
  bridgeState.model = String(model || '').trim();
  saveBridgeState(bridgeState);
  return bridgeState.model;
}

// 选择思考等级（空串 = 默认）
export function setBridgeVariant(variant) {
  bridgeState.variant = String(variant || '').trim();
  saveBridgeState(bridgeState);
  return bridgeState.variant;
}
