// 自定义定时任务：控制台创建/管理，灵晶负责调度与执行。
// 支持 4 种动作：发送消息（群/主人私聊）、执行内置命令（模拟主人私聊消息触发）、
// 执行命令行（child_process，带超时与输出截断）、启动 Agent 任务（复用 Agent 工作台 createTask）。
// 调度为分钟级轮询；错过即跳过（进程重启后不补跑），Bot 未就绪时消息动作走 masterNotifier 排队。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Path from '../../constants/path.js';
import { writeJsonAtomic } from '../utils/atomicStore.js';

const MAX_TASKS = 50;
const MAX_RUNS_PER_TASK = 20;
const MAX_NAME_LENGTH = 40;
const MAX_TEXT_LENGTH = 2000;
const MAX_SHELL_LENGTH = 500;
const MAX_OUTPUT_LENGTH = 8 * 1024;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 60 * 24 * 7;
const DEFAULT_SHELL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SHELL_TIMEOUT_MS = 30 * 60 * 1000;
const STORE_FILE = 'custom-tasks.json';
const SCHEDULE_TYPES = ['daily', 'interval', 'weekly'];
const ACTION_TYPES = ['message', 'command', 'shell', 'agent'];

function clampInt(value, min, max, fallback) {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeSchedule(raw = {}) {
  const type = SCHEDULE_TYPES.includes(raw.type) ? raw.type : 'daily';
  if (type === 'interval') {
    return {
      type,
      intervalMinutes: clampInt(raw.intervalMinutes, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES, 30),
    };
  }
  const weekday = clampInt(raw.weekday, 0, 6, 1);
  const hour = clampInt(raw.hour, 0, 23, 8);
  const minute = clampInt(raw.minute, 0, 59, 0);
  return type === 'weekly' ? { type, weekday, hour, minute } : { type, hour, minute };
}

function normalizeAgentAction(raw = {}) {
  return {
    prompt: String(raw.prompt || '').trim().slice(0, MAX_TEXT_LENGTH),
    workspaceId: String(raw.workspaceId || '').trim().slice(0, 80),
    providerId: String(raw.providerId || '').trim().slice(0, 40),
    // 默认 plan 模式（只读分析）；write 需要工作台自身的写授权，这里只透传选择
    mode: raw.mode === 'write' ? 'write' : 'plan',
  };
}

function normalizeAction(raw = {}) {
  const type = ACTION_TYPES.includes(raw.type) ? raw.type : 'message';
  const action = { type };
  if (type === 'message') {
    action.target = raw.target === 'group' ? 'group' : 'master';
    action.groupId = String(raw.groupId || '').trim().replace(/[^0-9]/g, '').slice(0, 20);
    action.content = String(raw.content || '').trim().slice(0, MAX_TEXT_LENGTH);
    if (action.target === 'group' && !action.groupId) return null;
    if (!action.content) return null;
  } else if (type === 'command') {
    action.command = String(raw.command || '').trim().slice(0, MAX_TEXT_LENGTH);
    if (!action.command) return null;
  } else if (type === 'shell') {
    action.shell = String(raw.shell || '').trim().slice(0, MAX_SHELL_LENGTH);
    if (!action.shell) return null;
    action.timeoutMs = clampInt(raw.timeoutMs, 1000, MAX_SHELL_TIMEOUT_MS, DEFAULT_SHELL_TIMEOUT_MS);
  } else if (type === 'agent') {
    const agent = normalizeAgentAction(raw.agent || raw);
    if (!agent.prompt) return null;
    action.agent = agent;
  }
  return action;
}

function normalizeTask(raw = {}) {
  const id = String(raw.id || '').trim().slice(0, 64);
  const name = String(raw.name || '').trim().slice(0, MAX_NAME_LENGTH);
  const action = normalizeAction(raw.action || {});
  if (!id || !name || !action) return null;
  return {
    id,
    name,
    enabled: raw.enabled !== false,
    schedule: normalizeSchedule(raw.schedule || {}),
    action,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Date.now(),
    lastRunAt: Number(raw.lastRunAt) || 0,
    lastStatus: String(raw.lastStatus || ''),
    lastError: String(raw.lastError || '').slice(0, 300),
    runs: Array.isArray(raw.runs) ? raw.runs.slice(-MAX_RUNS_PER_TASK) : [],
  };
}

function describeSchedule(schedule = {}) {
  const pad = value => String(value).padStart(2, '0');
  if (schedule.type === 'interval') return `每 ${schedule.intervalMinutes} 分钟`;
  if (schedule.type === 'weekly') {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `每周${names[schedule.weekday] || '?'} ${pad(schedule.hour)}:${pad(schedule.minute)}`;
  }
  return `每天 ${pad(schedule.hour)}:${pad(schedule.minute)}`;
}

function describeAction(action = {}) {
  if (action.type === 'message') {
    return action.target === 'group' ? `发消息到群 ${action.groupId}` : '发消息给主人';
  }
  if (action.type === 'command') return `执行命令 ${action.command}`;
  if (action.type === 'shell') return `命令行 ${action.shell}`;
  if (action.type === 'agent') return 'Agent 任务';
  return '';
}

function dayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function weekKey(now = new Date()) {
  const start = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - start) / (24 * 60 * 60 * 1000));
  return `${now.getFullYear()}-w${Math.floor((days + start.getDay() + 1) / 7)}`;
}

function truncateOutput(text = '') {
  const value = String(text || '');
  if (value.length <= MAX_OUTPUT_LENGTH) return value;
  return `${value.slice(-MAX_OUTPUT_LENGTH)}\n…（输出过长，仅保留末尾）`;
}

export function createCustomTaskScheduler(options = {}) {
  const logger = options.logger || console;
  const storePath = options.storePath || path.join(Path.config, STORE_FILE);
  const notifyMasters = typeof options.notifyMasters === 'function' ? options.notifyMasters : null;
  const getAgentWorkbench = typeof options.getAgentWorkbench === 'function' ? options.getAgentWorkbench : () => null;
  const shellCwd = options.shellCwd || Path.yunzai || process.cwd();

  let tasks = [];
  let timer = null;
  let running = false;

  function loadStore() {
    try {
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const list = Array.isArray(raw?.tasks) ? raw.tasks : [];
      tasks = list.map(normalizeTask).filter(Boolean).slice(0, MAX_TASKS);
    } catch {
      tasks = [];
    }
  }

  function saveStore() {
    try {
      writeJsonAtomic(storePath, { version: 1, tasks }, { pretty: true });
    } catch (error) {
      logger.warn?.(`[custom-tasks] 保存失败: ${error.message}`);
    }
  }

  function recordRun(task, status, message, durationMs = 0) {
    task.lastRunAt = Date.now();
    task.lastStatus = status;
    task.lastError = status === 'failed' ? String(message || '').slice(0, 300) : '';
    task.runs = [
      ...task.runs,
      {
        time: new Date().toISOString(),
        status,
        message: String(message || '').slice(0, 300),
        durationMs,
      },
    ].slice(-MAX_RUNS_PER_TASK);
    saveStore();
  }

  async function getMasterIds() {
    try {
      const mod = await import('../../../../lib/config/config.js');
      const cfg = mod?.default || mod?.cfg || null;
      const ids = Array.isArray(cfg?.masterQQ) ? cfg.masterQQ : [];
      return ids.map(item => String(item ?? '').trim()).filter(id => /^[1-9]\d{4,11}$/.test(id));
    } catch {
      return [];
    }
  }

  async function getBot() {
    return globalThis.Bot || null;
  }

  async function runMessageAction(action) {
    if (action.target === 'master') {
      if (!notifyMasters) return { ok: false, message: '主人通知通道不可用' };
      const result = await notifyMasters(action.content, { label: '自定义任务' });
      if (result?.noMasters) return { ok: false, message: '未配置可用的主人 QQ' };
      if ((result?.sent || 0) > 0) return { ok: true, message: `已发送给主人（${result.sent}/${result.total}）` };
      // Bot 未就绪时 masterNotifier 会排队重试，视为已受理
      return { ok: true, message: '已加入发送队列（Bot 未就绪时自动重试）' };
    }
    const bot = await getBot();
    if (!bot?.pickGroup) return { ok: false, message: 'Bot 尚未就绪，无法发送群消息' };
    await bot.pickGroup(action.groupId).sendMsg(action.content);
    return { ok: true, message: `已发送到群 ${action.groupId}` };
  }

  // 内置命令：模拟主人私聊消息走 Yunzai 事件分发，命令回复会发到主人私聊。
  async function runCommandAction(action) {
    const bot = await getBot();
    if (typeof bot?.em !== 'function') {
      return { ok: false, message: 'Bot 尚未就绪，无法执行内置命令' };
    }
    const masterIds = await getMasterIds();
    if (!masterIds.length) return { ok: false, message: '未配置可用的主人 QQ，无法以主人身份执行命令' };
    const masterId = Number(masterIds[0]);
    const selfId = Number(bot.uin) || 0;
    const pickSelf = bot.pickUser || bot.pickFriend;
    const friend = typeof pickSelf === 'function' ? pickSelf.call(bot, masterId) : null;
    const command = String(action.command || '').trim();
    await bot.em('message.private.friend', {
      post_type: 'message',
      message_type: 'private',
      sub_type: 'friend',
      message_id: `custom-task-${Date.now()}`,
      user_id: masterId,
      self_id: selfId,
      time: Math.floor(Date.now() / 1000),
      font: 0,
      sender: { user_id: masterId, nickname: 'Master', card: 'Master' },
      message: [{ type: 'text', text: command }],
      raw_message: command,
      isGroup: false,
      isPrivate: true,
      isMaster: true,
      friend,
      toUin: masterId,
    });
    return { ok: true, message: `已以主人身份触发命令（回复发送到主人私聊）` };
  }

  function runShellAction(action) {
    return new Promise(resolve => {
      const startedAt = Date.now();
      let child;
      try {
        child = spawn(action.shell, {
          shell: true,
          cwd: shellCwd,
          windowsHide: true,
          timeout: action.timeoutMs || DEFAULT_SHELL_TIMEOUT_MS,
        });
      } catch (error) {
        resolve({ ok: false, message: `启动失败: ${error.message}` });
        return;
      }
      let output = '';
      const append = data => {
        output += String(data || '');
        if (output.length > MAX_OUTPUT_LENGTH * 2) output = output.slice(-MAX_OUTPUT_LENGTH * 2);
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.on('error', error => {
        resolve({ ok: false, message: `执行失败: ${error.message}` });
      });
      child.on('close', (code, signal) => {
        const durationMs = Date.now() - startedAt;
        const tail = truncateOutput(output).trim();
        if (signal) {
          resolve({ ok: false, message: `超时被终止（${Math.round(durationMs / 1000)}s）${tail ? `\n输出末尾:\n${tail}` : ''}`, output: tail });
          return;
        }
        const ok = code === 0;
        resolve({
          ok,
          message: `退出码 ${code}${tail ? `\n输出末尾:\n${tail}` : ''}`,
          output: tail,
        });
      });
    });
  }

  async function runAgentAction(action) {
    const agent = action.agent || {};
    const workbench = getAgentWorkbench();
    if (!workbench?.createTask) return { ok: false, message: 'Agent 工作台模块不可用' };
    const payload = {
      prompt: agent.prompt,
      mode: agent.mode || 'plan',
    };
    if (agent.workspaceId) payload.workspaceId = agent.workspaceId;
    if (agent.providerId) payload.providerId = agent.providerId;
    if (agent.mode === 'write') payload.writeConfirmed = true;
    try {
      const task = await workbench.createTask(payload);
      const taskId = String(task?.id || task?.taskId || '');
      return {
        ok: true,
        message: `Agent 任务已启动${taskId ? `（编号 ${taskId}，进 Agent 工作台查看进度）` : ''}`,
        agentTaskId: taskId,
      };
    } catch (error) {
      return { ok: false, message: `Agent 任务启动失败: ${error.message || error}` };
    }
  }

  async function executeAction(task, trigger = 'scheduled') {
    const startedAt = Date.now();
    let result;
    try {
      const action = task.action;
      if (action.type === 'message') result = await runMessageAction(action);
      else if (action.type === 'command') result = await runCommandAction(action);
      else if (action.type === 'shell') result = await runShellAction(action);
      else if (action.type === 'agent') result = await runAgentAction(action);
      else result = { ok: false, message: `不支持的动作类型: ${action.type}` };
    } catch (error) {
      result = { ok: false, message: error.message || String(error) };
    }
    const durationMs = Date.now() - startedAt;
    const status = result.ok ? 'success' : 'failed';
    const prefix = trigger === 'manual' ? '[手动] ' : '';
    recordRun(task, status, `${prefix}${result.message || ''}`.trim(), durationMs);
    return { ok: result.ok, message: `${prefix}${result.message || ''}`.trim(), durationMs };
  }

  // 到点判定：整分钟命中 + 90 秒补判窗口（轮询抖动时仍能触发）；跨天/跨周用 key 防重复。
  function isDue(task, now) {
    const schedule = task.schedule || {};
    if (schedule.type === 'interval') {
      const last = task.lastRunAt || 0;
      if (!last) return true;
      return now.getTime() - last >= schedule.intervalMinutes * 60 * 1000;
    }
    const slot = new Date(now);
    slot.setHours(schedule.hour ?? 0, schedule.minute ?? 0, 0, 0);
    const elapsed = now.getTime() - slot.getTime();
    if (elapsed < 0 || elapsed > 90 * 1000) return false;
    if (schedule.type === 'weekly') {
      if (now.getDay() !== (schedule.weekday ?? 1)) return false;
      return task.lastRunWeekKey !== weekKey(now);
    }
    return task.lastRunDayKey !== dayKey(now);
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      for (const task of tasks) {
        if (!task.enabled) continue;
        if (!isDue(task, now)) continue;
        if (task.schedule?.type === 'weekly') task.lastRunWeekKey = weekKey(now);
        else task.lastRunDayKey = dayKey(now);
        saveStore();
        logger.info?.(`[custom-tasks] 触发定时任务: ${task.name}`);
        await executeAction(task, 'scheduled');
      }
    } catch (error) {
      logger.warn?.(`[custom-tasks] 调度轮询异常: ${error.message}`);
    } finally {
      running = false;
    }
  }

  function computeNextRunAt(task, now = new Date()) {
    const schedule = task.schedule || {};
    if (schedule.type === 'interval') {
      const base = task.lastRunAt || now.getTime();
      return new Date(base + schedule.intervalMinutes * 60 * 1000).toISOString();
    }
    const slot = new Date(now);
    slot.setHours(schedule.hour ?? 0, schedule.minute ?? 0, 0, 0);
    if (schedule.type === 'weekly') {
      const delta = ((schedule.weekday ?? 1) - now.getDay() + 7) % 7;
      slot.setDate(slot.getDate() + delta);
    }
    if (slot.getTime() <= now.getTime()) {
      slot.setDate(slot.getDate() + (schedule.type === 'weekly' ? 7 : 1));
    }
    return slot.toISOString();
  }

  function buildTaskCards() {
    return tasks.map(task => {
      const actionLabel = describeAction(task.action);
      const recentRuns = (task.runs || []).slice(-3).reverse().map(run => ({
        time: run.time,
        status: run.status,
        message: run.message,
      }));
      return {
        id: task.id,
        name: task.name,
        description: actionLabel || '自定义任务',
        schedule: describeSchedule(task.schedule),
        nextRunAt: task.enabled ? computeNextRunAt(task) : '',
        status: task.enabled ? 'enabled' : 'disabled',
        statusLabel: task.enabled ? '已启用' : '已停用',
        kind: 'custom',
        detail: {
          actionType: task.action.type,
        },
        recentRuns,
        manual: {
          supported: true,
          action: `custom:${task.id}`,
          label: '立即执行',
        },
      };
    });
  }

  function listTasks() {
    return tasks.map(task => ({
      ...task,
      scheduleText: describeSchedule(task.schedule),
      actionText: describeAction(task.action),
      nextRunAt: task.enabled ? computeNextRunAt(task) : '',
    }));
  }

  function saveTask(payload = {}) {
    const id = String(payload.id || '').trim();
    let task;
    if (id) {
      const existing = tasks.find(item => item.id === id);
      if (!existing) return { success: false, error: '任务不存在，可能已被删除' };
      const merged = normalizeTask({
        ...existing,
        ...payload,
        id: existing.id,
        createdAt: existing.createdAt,
        runs: existing.runs,
        lastRunAt: existing.lastRunAt,
        lastStatus: existing.lastStatus,
      });
      if (!merged) return { success: false, error: '任务内容不完整，请检查必填项' };
      const index = tasks.findIndex(item => item.id === id);
      tasks[index] = merged;
      task = merged;
    } else {
      if (tasks.length >= MAX_TASKS) return { success: false, error: `最多创建 ${MAX_TASKS} 个自定义任务` };
      const newId = `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      task = normalizeTask({ ...payload, id: newId });
      if (!task) return { success: false, error: '任务内容不完整，请检查必填项' };
      tasks.push(task);
    }
    saveStore();
    return { success: true, task: listTasks().find(item => item.id === task.id) };
  }

  function deleteTask(id = '') {
    const before = tasks.length;
    tasks = tasks.filter(task => task.id !== String(id || '').trim());
    if (tasks.length === before) return { success: false, error: '任务不存在' };
    saveStore();
    return { success: true };
  }

  function setTaskEnabled(id = '', enabled = true) {
    const task = tasks.find(item => item.id === String(id || '').trim());
    if (!task) return { success: false, error: '任务不存在' };
    task.enabled = enabled === true;
    task.updatedAt = Date.now();
    saveStore();
    return { success: true };
  }

  async function runTaskManually(id = '') {
    const task = tasks.find(item => item.id === String(id || '').trim());
    if (!task) return { success: false, error: '任务不存在' };
    const result = await executeAction(task, 'manual');
    return result.ok
      ? { success: true, message: result.message || '已执行' }
      : { success: false, error: result.message || '执行失败' };
  }

  function start() {
    loadStore();
    if (timer) return;
    timer = setInterval(tick, 60 * 1000);
    timer.unref?.();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
    listTasks,
    saveTask,
    deleteTask,
    setTaskEnabled,
    runTaskManually,
    buildTaskCards,
  };
}
