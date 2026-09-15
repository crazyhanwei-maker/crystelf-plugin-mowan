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

// 结论正文取值：本轮（turnCount 对应的最后一次用户提问之后）的所有 assistant 消息。
// 不能只取最后一条——模型常把正文发在倒数第二条、把"已在上面展示"这类收尾放在最后一条，
// 只取最后一条会把实际内容全丢掉；也不能从头拼接——前面轮次的过场话术会混进来。
// 都取不到时回退 outputText 提取。
export function pickResultText(task = {}) {
  const messages = Array.isArray(task.messages) ? task.messages : [];
  // 找最后一次用户提问的位置（显式循环，避免 map+lastIndexOf 的稀疏语义坑）
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user' && String(message.content || '').trim()) {
      lastUserIndex = i;
      break;
    }
  }
  const turnAssistants = messages
    .slice(lastUserIndex + 1)
    .filter(message => message?.role === 'assistant' && String(message.content || '').trim())
    .map(message => String(message.content).trim());
  if (turnAssistants.length) {
    // 单条即原样返回；多条用分隔线拼起来（模型把正文和收尾拆成多条消息时内容不丢）
    return turnAssistants.length === 1 ? turnAssistants[0] : turnAssistants.join('\n\n———\n\n');
  }
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
    let text = content || '任务完成，本轮没有文本产出。';
    const usage = Math.max(0, Number(task.contextUsage || 0));
    const limit = Math.max(0, Number(task.contextLimit || 0));
    if (limit > 0 && usage / limit > 0.85) {
      const percent = Math.min(100, Math.round((usage / limit) * 100));
      text += `

⚠ 本轮上下文已用 ${percent}%（接近上限）：模型可能开始遗忘早期细节，建议发 /会话重置 后再开新任务。`;
    }
    return { ok: true, text };
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
  workspaceId = DEFAULTS.workspaceId, model = '', variant = '', attachments = [],
} = {}) {
  return {
    providerId: 'opencode',
    mode: BRIDGE_TASK_MODE,
    writeConfirmed: true,
    workspaceId,
    ...(sessionId ? { sessionId: String(sessionId) } : {}),
    ...(model ? { model } : {}),
    ...(variant ? { variant } : {}),
    ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
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
export function createAgentChatBridge({ senderId, reply, config = {}, consoleApi: injectedApi } = {}) {
  const consoleApi = injectedApi || getConsole();
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

  async function submitTask(promptText, { title = '', sessionId = '', attachments = [] } = {}) {
    const buildPayload = sid => buildBridgeTaskPayload({
      senderKey,
      prompt: promptText,
      title,
      sessionId: sid,
      workspaceId: config.workspaceId || bridgeState.workspaceId || DEFAULTS.workspaceId,
      model: bridgeState.model,
      variant: bridgeState.variant,
      attachments,
    });
    try {
      return await consoleApi.createTask(buildPayload(sessionId));
    } catch (error) {
      // 上次会话已被回收：去掉 sessionId 重新开一轮，避免整条指令失败。
      // 置位提示标记：上下文丢了要明说，不能静默开新会话
      if (sessionId && /AGENT_TASK_NOT_FOUND/.test(String(error?.code || error?.message || ''))) {
        contextResetNotice = true;
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

  let contextResetNotice = false; // 会话失效回退开新会话时置位，提示一次后清除

  // 运行中收到的后续指令：本地排队，本轮结束后立刻在同一会话里接着执行。
  // 不用控制台的运行中跟进（queue 会在收尾窗口被记录却不作答，steer 会把任务打超时）
  const pendingInstructions = [];

  function sendFollowUp(text, attachments = []) {
    const value = String(text || '').trim();
    if (!value || !progressState.running) return { queued: false };
    pendingInstructions.push({ text: value, attachments });
    return { queued: true, position: pendingInstructions.length };
  }

  // 停止：优先取消桥自己跟踪的任务（精确），再退回按标题归属搜索（跨重启/历史任务）。
  // 注意 listTasks 的 activeOnly 只认 pending/running，排队中的任务要取全量列表才看得到
  // 切换本通道的会话锚点到指定任务：之后的新任务会接着那个会话继续（跨任务恢复上下文）
  function switchSession(taskId) {
    const id = String(taskId || '').trim();
    if (!id) throw new Error('缺少要切换的任务 ID');
    if (progressState.running) throw new Error('任务执行中不能切换会话');
    // 校验任务存在且可续（404 在提交时也会再兜底，这里提前给出可读错误）
    const items = consoleApi.listTasks({ limit: 100 });
    const list = Array.isArray(items) ? items : items?.tasks || [];
    const target = list.find(item => String(item.id) === id);
    if (!target) throw new Error('任务不存在或已被清理（超过保留期）');
    if (['pending', 'running', 'queued'].includes(target.status)) throw new Error('该任务仍在执行中，等它结束再切换');
    bridgeState.sessionBySender.set(senderKey, id);
    saveBridgeState(bridgeState);
    progressState.taskId = id;
    pendingInstructions.length = 0;
    return { id, title: String(target.title || '') };
  }

  // 清空本通道的会话锚点：下一条任务从全新会话开始（用户主动要求丢弃上下文）
  function resetSession() {
    bridgeState.sessionBySender.delete(senderKey);
    saveBridgeState(bridgeState);
    progressState.taskId = '';
    pendingInstructions.length = 0;
  }

  // 本通道最近的桥任务（含状态/耗时），供 /任务列表 展示
  function listMyTasks(limit = 5) {
    const items = consoleApi.listTasks({ limit: 40 });
    const list = Array.isArray(items) ? items : items?.tasks || [];
    return list
      .filter(task => isBridgeTask(task, senderKey))
      .slice(0, limit)
      .map(task => ({
        id: String(task.id || ''),
        title: String(task.title || '').replace(`${BRIDGE_TITLE_PREFIX}${senderKey}`, '').trim() || '任务',
        status: String(task.status || ''),
        elapsedMs: Math.max(0, Number(task.elapsedMs || 0)),
        updatedAt: String(task.updatedAt || ''),
        contextUsage: Math.max(0, Number(task.contextUsage || 0)),
        contextLimit: Math.max(0, Number(task.contextLimit || 0)),
        queuePosition: Math.max(0, Number(task.queuePosition || 0)),
      }));
  }

  // /进展：即时拉当前任务最新一步（不等 5 秒轮询节拍）
  function latestProgress() {
    const taskId = progressState.taskId || lastTaskId();
    if (!taskId) return { running: false, text: '当前没有可查询的任务。' };
    const items = consoleApi.listTasks({ limit: 10, taskId });
    const current = (Array.isArray(items) ? items : items?.tasks || []).find(item => String(item.id) === String(taskId)) || null;
    if (!current) return { running: false, text: '任务已不在列表中（可能刚结束或被清理）。' };
    const steps = Array.isArray(current.liveSteps) ? current.liveSteps : [];
    const latest = steps[steps.length - 1] || null;
    const firstLine = latest ? extractReadableOutput(String(latest.content || '')).split(String.fromCharCode(10)).map(line => line.trim()).find(Boolean) || '' : '';
    const running = ['pending', 'running', 'queued'].includes(current.status);
    const elapsedSec = Math.max(1, Math.round((Date.now() - (current.startedAt ? new Date(current.startedAt).getTime() : Date.now())) / 1000));
    return {
      running,
      status: String(current.status || ''),
      elapsedSec,
      text: firstLine || '（暂未产生新的步骤）',
      queuePosition: Math.max(0, Number(current.queuePosition || 0)),
    };
  }

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

  async function runTaskWithReport(promptText, { onProgressReply, onResultReply, onQuestionReply, onEventNotice, title = '', attachments = [] } = {}) {
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
      let turnAttachments = Array.isArray(attachments) ? attachments : [];
      for (let turn = 0; turn < MAX_BRIDGE_TURNS; turn++) {
        const sessionId = turn === 0 ? resumeId : lastTaskId();
        const submit = suffix => submitTask(text, { title: suffix ? `${title}${suffix}` : title, sessionId, attachments: turnAttachments });
        result = await runTaskLoop(submit, text, { onProgressReply, onQuestionReply, onEventNotice });
        if (typeof onResultReply === 'function') await onResultReply(result, { turn, prompt: text });
        // 失败/取消则不再续跑排队指令，避免连环失败；队列保留给下一次触发
        if (!result?.ok || !pendingInstructions.length) break;
        const next = pendingInstructions.shift();
        text = next.text;
        turnAttachments = Array.isArray(next.attachments) ? next.attachments : [];
        progressState.text = '';
        progressState.startedAt = Date.now();
        if (typeof onProgressReply === 'function') onProgressReply(`继续处理后续指令（队列剩余 ${pendingInstructions.length} 条）`);
      }
      return result;
    } finally {
      progressState.running = false;
    }
  }

  async function runTaskLoop(submit, promptText, { onProgressReply, onQuestionReply, onEventNotice }) {
    const trackTask = task => {
      if (!task?.id) return task;
      progressState.taskId = String(task.id);
      setBridgeSession(senderKey, task.id);
      if (contextResetNotice) {
        contextResetNotice = false;
        if (typeof onProgressReply === 'function') onProgressReply('⚠ 原会话已失效，已开启新会话：本轮上下文从零开始。');
      }
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
      let lastQuestionKey = '';
      let lastCompactedAt = '';
      let externalCancelSeen = false;
      const startedAt = Date.now();
      // 轮询任务状态：running 时推送过程简报；模型提问时推给用户选择；终态判断是否需要重试
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
        // 模型提问（question 工具）：推给用户做编号选择，回复经 onQuestionReply 提交控制台
        const pendingQuestion = (Array.isArray(current.pendingQuestions) ? current.pendingQuestions : [])[0] || null;
        if (onQuestionReply && pendingQuestion) {
          const questionKey = `${pendingQuestion.id}:${(pendingQuestion.questions || []).length}`;
          if (questionKey !== lastQuestionKey) {
            lastQuestionKey = questionKey;
            onQuestionReply({ taskId: task.id, request: pendingQuestion });
          }
        }
        // 上下文压缩：让用户知道会话"变笨过"（lastCompactedAt 变化时提示一次）
        if (onEventNotice && current.lastCompactedAt && current.lastCompactedAt !== lastCompactedAt) {
          const firstSeen = !lastCompactedAt;
          lastCompactedAt = current.lastCompactedAt;
          if (!firstSeen) onEventNotice({ type: 'compacted', taskId: task.id });
        }
        // 控制台侧的外部动作（取消/归档）：桥还在轮询就该同步，而不是傻等到终态
        if (onEventNotice && current.cancelRequested === true && !externalCancelSeen) {
          externalCancelSeen = true;
          onEventNotice({ type: 'cancel-external', taskId: task.id });
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

  // 回答模型的提问（question 工具）：answers 为字符串数组（多选时每项可为逗号分隔的多个 label）
  async function answerQuestion(taskId, requestId, answers) {
    const list = (Array.isArray(answers) ? answers : [answers]).map(item => String(item || '').trim()).filter(Boolean);
    if (!list.length) throw new Error('回答内容为空');
    return await consoleApi.replyQuestion(taskId, { requestId, answers: list });
  }

  // 拒绝模型的提问（让模型自行决定下一步）
  async function rejectQuestion(taskId, requestId) {
    return await consoleApi.rejectQuestion(taskId, { requestId });
  }

  return {
    senderKey,
    isBusy,
    submitTask,
    sendFollowUp,
    runTaskWithReport,
    cancelActive,
    answerQuestion,
    rejectQuestion,
    resetSession,
    switchSession,
    listMyTasks,
    latestProgress,
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
