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

function formatTaskResult(task = {}) {
  const content = extractReadableOutput(task.outputText);
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

// 创建主人→Agent 的桥实例（每个消息通道一个）
export function createAgentChatBridge({ senderId, reply, config = {} } = {}) {
  const consoleApi = getConsole();
  const senderKey = String(senderId || 'unknown');
  // 运行态进展：任务执行中收到追问时回报最近一步（内存态，重启丢失可接受）
  const progressState = { running: false, text: '', startedAt: 0, updatedAt: 0 };

const BRIDGE_TITLE_PREFIX = '[桥]';

// createTask 不透传 source：用标题前缀标记本桥发起的任务
function isBridgeTask(task = {}, senderKey = '') {
  return String(task.title || '').startsWith(BRIDGE_TITLE_PREFIX) && (!senderKey || String(task.title || '').includes(senderKey));
}

async function isBusy() {
    try {
      const items = consoleApi.listTasks({ limit: 20, activeOnly: true });
      const tasks = items?.tasks || items || [];
      return tasks.some(task => isBridgeTask(task, senderKey) && ['pending', 'running', 'queued'].includes(task.status));
    } catch {
      return false;
    }
  }

  async function submitTask(promptText, { title = '' } = {}) {
    const task = await consoleApi.createTask({
      providerId: 'opencode',
      mode: config.mode || bridgeState.mode || DEFAULTS.mode,
      workspaceId: config.workspaceId || bridgeState.workspaceId || DEFAULTS.workspaceId,
      ...(bridgeState.model ? { model: bridgeState.model } : {}),
      ...(bridgeState.variant ? { variant: bridgeState.variant } : {}),
      prompt: String(promptText || '').trim(),
      title: `${BRIDGE_TITLE_PREFIX}${senderKey} ${String(title || '').trim() || '任务'}`.slice(0, 80),
    });
    return task;
  }

  async function cancelActive() {
    try {
      const items = consoleApi.listTasks({ limit: 20, activeOnly: true });
      const tasks = items?.tasks || items || [];
      const mine = tasks.find(task => isBridgeTask(task, senderKey) && ['pending', 'running', 'queued'].includes(task.status));
      if (!mine) return false;
      await consoleApi.cancelTask(mine.id);
      return true;
    } catch {
      return false;
    }
  }

  async function runTaskWithReport(promptText, { onProgressReply, title = '' } = {}) {
    const submit = suffix => submitTask(promptText, { title: suffix ? `${title}${suffix}` : title });
    progressState.running = true;
    progressState.text = '';
    progressState.startedAt = Date.now();
    progressState.updatedAt = 0;
    try {
      return await runTaskLoop(submit, promptText, { onProgressReply, title });
    } finally {
      progressState.running = false;
    }
  }

  async function runTaskLoop(submit, promptText, { onProgressReply }) {
    let task = await submit('');
    const UPSTREAM_TIMEOUT_PATTERN = /aborted due to timeout|ECONNRESET|fetch failed|socket hang up/i;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        if (typeof onProgressReply === 'function') onProgressReply('上游请求超时，自动重试一次…');
        task = await submit('（重试）');
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
      if (!result.ok && attempt === 0 && UPSTREAM_TIMEOUT_PATTERN.test(result.text)) {
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
