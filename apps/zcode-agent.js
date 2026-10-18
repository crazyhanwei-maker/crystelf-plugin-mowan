// 群聊/私聊侧 ZCode Agent 入口：主人指令 #zcode 直接下发完整 Agent 任务，结果摘要回聊天
// 设计约束：
// - 仅主人可用（permission: master）
// - #zcode 默认完全访问档（可改文件、联网、执行终端命令——ZCode yolo，无逐条审批），信任模型与微信桥 #agent
//   一致：主人指令即授权，但控制台 writeEnabled/writableWorkspaces 门禁仍生效；
//   #zcode只读 提供安全的分析档（plan、不联网）
// - 复用 Agent 工作台进程级单例（与控制台/桥同一份 tasks 内存），任务实时出现在控制台列表，审计照走工作台
// - 同一发送者多轮对话自动续接上下文（--resume 会话），#zcode新会话 显式重置
import ConfigControl from '../lib/config/configControl.js';
import Path from '../constants/path.js';
import { getOrCreateWorkbenchConsole } from '../lib/webConsole/workbenchSingleton.js';
import { normalizeAgentWorkbenchConfig } from '../lib/webConsole/agentWorkbenchConsole.js';
import { formatTaskResult, pickResultText } from '../lib/agent/agentChatBridge.js';
import { AGENT_TEMPLATES, findAgentTemplate, initAgentScheduleRunner, formatPushReport } from '../lib/agent/agentInspection.js';

// 任务标题前缀：标记聊天侧发起的 ZCode 任务（控制台列表与审计里可区分）
const CHAT_TITLE_PREFIX = '[ZCode聊]';

// 单个发送者同时只跟踪一个活动任务（内存态，重启即清）
const activeBySender = new Map();

// 会话锚点：发送者 → 最近一条任务 id，下一轮任务接着它的会话续跑（内存态）
const sessionBySender = new Map();

// #zcode会话 的编号选择暂存：发送者 → 候选任务数组（内存态，下次列表刷新覆盖）
const sessionChoicesBySender = new Map();

// #zcode回滚 的待确认任务：发送者 → { taskId, askedAt }（10 分钟内有效）
const pendingRollbackBySender = new Map();

// Agent 定时巡检调度器：模块级单例（仅 Yunzai 进程加载 apps，预览环境不受影响）
const scheduleRunner = initAgentScheduleRunner({
  getConsole,
  getConfig: getWorkbenchConfig,
  logger: getLogger(),
});

// #巡检列表 的编号选择暂存
const scheduleChoices = [];

function parsePushTargets(tokens = [], e) {
  const groups = [];
  const privates = [];
  for (const token of tokens) {
    const value = String(token || '').trim();
    if (/^(群)?\d+$/.test(value)) groups.push(value.replace(/^群/, ''));
    else if (/^私\d+$/.test(value)) privates.push(value.replace(/^私/, ''));
  }
  if (!groups.length && !privates.length && e) {
    // 未指定目标时默认推送到当前聊天
    if (e.isGroup) groups.push(String(e.group_id || ''));
    else privates.push(String(e.user_id || ''));
  }
  return { groups: groups.filter(Boolean), privates: privates.filter(Boolean) };
}

const POLL_INTERVAL_MS = 5000;
const TRACK_TIMEOUT_MS = 30 * 60 * 1000;
// QQ 单条消息长度保守上限：超长截断并提示去控制台看全文
const REPLY_TEXT_LIMIT = 1200;

const HELP_TEXT = [
  '#zcode <任务> —— 提交完整 Agent 任务：可修改文件、联网、执行终端命令（仅主人）',
  '#zcode只读 <任务> —— 只读分析档：不改文件、不联网，适合解读/答疑',
  '#zcode状态 / #zcode停止 / #zcode会话 / #zcode回滚 / #zcode新会话 —— 任务管理',
  '#巡检列表 —— 查看 Agent 巡检模板与定时计划',
  '#立即巡检 [模板] [群号/私QQ...] —— 手动跑一次巡检并推送（默认推当前聊天）',
  '#开启巡检 <模板> HH:MM [群号/私QQ...] —— 每天定时巡检（仅主人）',
  '#关闭巡检 <编号> —— 删除定时计划（编号见 #巡检列表）',
  '#zcode新会话 —— 丢弃上下文，下一条从全新会话开始',
  '说明：完全访问档需控制台开启「允许实际修改文件」并授权目录；主人指令即写入确认，无逐条审批，改动自动留 Git 快照、可回滚。巡检固定只读档，报告推送到指定聊天。',
].join('\n');

function statusLabel(status = '') {
  if (['pending', 'running', 'queued'].includes(status)) return '执行中';
  if (status === 'success') return '完成';
  if (status === 'error') return '失败';
  if (status === 'canceled') return '已取消';
  if (status === 'interrupted' || status === 'timeout') return '中断';
  return status || '未知';
}

// 列出本发送者最近的 ZCode 聊天任务；带编号参数时切换会话锚点
async function listOrSwitchSessions(e) {
  const consoleApi = getConsole();
  const senderKey = senderKeyOf(e);
  const arg = String(e.msg || '').replace(/^#zcode会话/i, '').trim();
  if (arg && /^\d+$/.test(arg)) {
    const choices = sessionChoicesBySender.get(senderKey) || [];
    const picked = choices[Number(arg) - 1];
    if (!picked) {
      await e.reply(`编号无效：先发 #zcode会话 查看列表（当前列表 ${choices.length} 条）。`, true);
      return;
    }
    const current = findTask(consoleApi, picked.id);
    if (!current) {
      await e.reply(`任务 ${picked.id} 已被清理，无法切换。`, true);
      return;
    }
    if (['pending', 'running', 'queued'].includes(current.status)) {
      await e.reply(`任务 ${picked.id} 还在执行中，结束后才能切换。`, true);
      return;
    }
    if (!current.zcodeSessionId) {
      await e.reply(`任务 ${picked.id} 没有 ZCode 会话标识（可能来自旧版本或续接失败），无法作为上下文锚点。`, true);
      return;
    }
    sessionBySender.set(senderKey, current.id);
    await e.reply(`已切换：下一条 #zcode 将接着「${String(current.prompt || '').slice(0, 24)}」的会话继续（${statusLabel(current.status)}）。`, true);
    return;
  }
  const items = consoleApi.listTasks({ limit: 60 });
  const list = Array.isArray(items) ? items : items?.tasks || [];
  const mine = list
    .filter(task => String(task.title || '').startsWith(`${CHAT_TITLE_PREFIX}${senderKey}`))
    .slice(0, 5)
    .map(task => ({
      id: String(task.id || ''),
      status: String(task.status || ''),
      promptPreview: String(task.prompt || task.promptPreview || '').slice(0, 24),
      updatedAt: String(task.updatedAt || ''),
      resumable: Boolean(task.zcodeSessionId) && !['pending', 'running', 'queued'].includes(task.status),
    }));
  if (!mine.length) {
    await e.reply('当前没有 ZCode 聊天任务记录，发送 #zcode <任务> 开始。', true);
    return;
  }
  sessionChoicesBySender.set(senderKey, mine);
  const anchored = sessionBySender.get(senderKey) || '';
  const lines = mine.map((task, index) => {
    const mark = task.id === anchored ? '（当前锚点）' : (task.resumable ? '' : '（不可续接）');
    return `${index + 1}. [${statusLabel(task.status)}] ${task.promptPreview} · ${task.id}${mark}`;
  });
  await e.reply(`最近 ${mine.length} 条 ZCode 聊天任务：\n${lines.join('\n')}\n\n发 #zcode会话 <编号> 切换上下文锚点。`, true);
}

function getLogger() {
  return globalThis.logger || console;
}

function getConsole() {
  return getOrCreateWorkbenchConsole({
    ConfigControl,
    logger: getLogger(),
    pluginRoot: Path.root,
    yunzaiRoot: Path.yunzai,
  });
}

function getWorkbenchConfig() {
  return normalizeAgentWorkbenchConfig(ConfigControl?.get?.('coreConfig')?.tools?.agentWorkbench || {});
}

// 写回定时巡检计划（normalize 兜底），并触发调度器对齐
async function saveAgentSchedules(schedules) {
  const core = ConfigControl.get('coreConfig') || {};
  const next = normalizeAgentWorkbenchConfig({ ...getWorkbenchConfig(), agentSchedules: schedules });
  await ConfigControl.set('coreConfig', { ...core, tools: { ...(core.tools || {}), agentWorkbench: next } });
  scheduleRunner.rebuild();
}

function describeSchedule(item) {
  const targets = [
    ...(item.pushTargets?.groups || []).map(id => `群${id}`),
    ...(item.pushTargets?.privates || []).map(id => `私${id}`),
  ].join('、') || '（未设推送目标）';
  const templateName = AGENT_TEMPLATES.find(t => t.id === item.templateId)?.name || (item.prompt ? '自定义' : '未知模板');
  return `${item.name} · ${templateName} · cron ${item.cron} → ${targets}`;
}

function senderKeyOf(e) {
  return `${e.isGroup ? 'group' : 'private'}:${e.user_id}`;
}

async function precheck(mode = 'full') {
  const config = getWorkbenchConfig();
  if (!config.enabled) return 'Agent 工作台当前未启用：请先到控制台设置里开启。';
  if (config.providers?.zcode !== true) return 'ZCode 尚未开启：请到控制台 Agent 工作台设置里勾选「允许 ZCode」。';
  if (mode === 'full') {
    // 完全访问档的服务端门禁前置提示（createTask 也会再校验，这里给出可操作的指引）
    if (config.writeEnabled !== true) return '完全访问档需要先在控制台 Agent 工作台设置里开启「允许实际修改文件」。';
    if (config.writableWorkspaces?.plugin !== true) return '工作目录「灵晶插件」尚未获得写入授权：请到控制台 Agent 工作台设置里开启。';
  }
  const probe = await getConsole().probeProvider('zcode');
  if (!probe?.available) return `ZCode 运行时不可用：${probe?.error || '未知原因'}`;
  return '';
}

function findTask(consoleApi, taskId) {
  try {
    const items = consoleApi.listTasks({ limit: 10, taskId });
    return (Array.isArray(items) ? items : items?.tasks || []).find(item => item.id === taskId) || null;
  } catch {
    return null;
  }
}

function limitReplyText(text) {
  const value = String(text || '').trim();
  if (value.length <= REPLY_TEXT_LIMIT) return value;
  return `${value.slice(0, REPLY_TEXT_LIMIT)}\n\n（内容过长已截断，完整结果见控制台 Agent 工作台）`;
}

// 提交任务并跟踪到终态；返回文本结果（已格式化）
// mode: 'full'（默认：可改文件/联网/执行命令，主人指令即写入确认）| 'plan'（只读分析）
async function runChatTask(e, taskText, mode = 'full') {
  const consoleApi = getConsole();
  const senderKey = senderKeyOf(e);
  let sessionId = sessionBySender.get(senderKey) || '';
  let anchorDropped = false;
  if (sessionId) {
    // 锚点预检：任务被控制台删除、未产生 ZCode 会话标识或仍在运行时都不能续接，
    // 直接丢弃锚点按新会话提交，避免整轮 #zcode 报 404/409 后卡死
    const anchorTask = findTask(consoleApi, sessionId);
    const resumable = anchorTask
      && anchorTask.zcodeSessionId
      && !['pending', 'running', 'queued'].includes(anchorTask.status);
    if (!resumable) {
      sessionBySender.delete(senderKey);
      sessionId = '';
      anchorDropped = true;
    }
  }
  const buildPayload = sid => ({
    providerId: 'zcode',
    mode,
    // 完全访问档：主人指令即授权（与微信桥 #agent 同一信任模型），允许联网
    ...(mode === 'full' ? { writeConfirmed: true, allowNetwork: true } : { allowNetwork: false }),
    workspaceId: 'plugin',
    ...(sid ? { sessionId: sid } : {}),
    prompt: taskText,
    title: `${CHAT_TITLE_PREFIX}${senderKey} ${taskText.slice(0, 24)}`.slice(0, 80),
  });
  let task;
  try {
    task = await consoleApi.createTask(buildPayload(sessionId));
  } catch (error) {
    // 预检之后任务仍可能被并行删除（控制台操作）：兜底清锚点，按新会话重试一次
    const notFound = /AGENT_TASK_NOT_FOUND|未找到需要继续/.test(`${error.code || ''} ${error.message || ''}`);
    if (!sessionId || !notFound) throw error;
    sessionBySender.delete(senderKey);
    anchorDropped = true;
    task = await consoleApi.createTask(buildPayload(''));
  }
  activeBySender.set(senderKey, { taskId: task.id });
  // 锚点切到本任务：下一轮 #zcode 自动接着这个会话（--resume 续接上下文）
  sessionBySender.set(senderKey, task.id);
  const modeNote = mode === 'full'
    ? '完全访问档（可改文件/联网/执行命令，无逐条审批，改动可在控制台看 Git 差异）'
    : '只读档（不改文件、不联网）';
  const anchorNote = anchorDropped ? '（原会话锚点已失效，本轮起按新会话开始）' : '';
  await e.reply(`已提交 ZCode 任务（${task.id}，${modeNote}${anchorNote}），完成后回到这里；期间 #zcode状态 查看进展，#zcode停止 可中断。`, true);
  const startedAt = Date.now();
  let finalTask = null;
  while (Date.now() - startedAt < TRACK_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    const current = findTask(consoleApi, task.id);
    if (!current) break;
    if (!['pending', 'running', 'queued'].includes(current.status)) {
      finalTask = current;
      break;
    }
  }
  activeBySender.delete(senderKey);
  if (!finalTask) return '任务等待超时（30 分钟）已停止跟踪；任务可能仍在后台，可到控制台查看或 #zcode停止 中断。';
  const result = formatTaskResult(finalTask);
  let text = result.ok ? limitReplyText(result.text) : result.text;
  // 上下文占比提醒：上游会自动压缩，但超阈值后模型可能遗忘早期细节，提示开新会话
  const usage = Math.max(0, Number(finalTask.contextUsage || 0));
  const limit = Math.max(0, Number(finalTask.contextLimit || 0));
  if (result.ok && limit > 0 && usage / limit > 0.8) {
    const percent = Math.min(100, Math.round((usage / limit) * 100));
    text += `\n\n⚠ 上下文已用约 ${percent}%：模型可能开始遗忘早期细节，建议发 #zcode新会话 开新会话。`;
  }
  return text;
}

function latestProgressText(senderKey) {
  const consoleApi = getConsole();
  const taskId = activeBySender.get(senderKey)?.taskId || sessionBySender.get(senderKey) || '';
  if (!taskId) return '当前没有 ZCode 聊天任务记录，发送 #zcode <任务> 开始。';
  const current = findTask(consoleApi, taskId);
  if (!current) return '任务已不在列表中（可能刚结束或被清理）。';
  const running = ['pending', 'running', 'queued'].includes(current.status);
  const elapsedSec = Math.max(1, Math.round((Date.now() - (current.startedAt ? new Date(current.startedAt).getTime() : Date.now())) / 1000));
  const head = running
    ? `任务 ${current.id} 执行中（${elapsedSec}s）：`
    : `任务 ${current.id} 已结束（${current.status}）：`;
  const body = running
    ? String(current.liveOutputText || '').trim().split('\n').map(line => line.trim()).filter(Boolean).slice(-1)[0] || '（暂未产生输出）'
    : limitReplyText(pickResultText(current) || '（无文本产出）');
  return `${head}\n${body}`;
}

async function stopActive(e) {
  const consoleApi = getConsole();
  const senderKey = senderKeyOf(e);
  const taskId = activeBySender.get(senderKey)?.taskId || sessionBySender.get(senderKey) || '';
  if (!taskId) return '当前没有可停止的 ZCode 聊天任务。';
  try {
    const result = await consoleApi.cancelTask(taskId);
    return result?.canceled === true ? `已发送停止指令（任务 ${taskId}）。` : `任务 ${taskId} 未在运行中。`;
  } catch (error) {
    return `停止失败：${error.message}`;
  }
}

// #zcode回滚：撤销最近一条写入任务（有 Git 快照）的文件改动，两步确认防误触
async function rollbackLastWrite(e, confirmed = false) {
  const consoleApi = getConsole();
  const senderKey = senderKeyOf(e);
  const pending = pendingRollbackBySender.get(senderKey);
  if (!confirmed) {
    const items = consoleApi.listTasks({ limit: 40 });
    const list = Array.isArray(items) ? items : items?.tasks || [];
    const target = list.find(task => String(task.title || '').startsWith(`${CHAT_TITLE_PREFIX}${senderKey}`)
      && task.gitSnapshotBranch
      && !['pending', 'running', 'queued'].includes(task.status));
    if (!target) return '最近没有可回滚的写入任务（任务改动会自动留 Git 快照，只读任务不产生快照）。';
    pendingRollbackBySender.set(senderKey, { taskId: target.id, askedAt: Date.now() });
    const files = Array.isArray(target.changedFiles) ? target.changedFiles.length : 0;
    return `将回滚任务 ${target.id}（${statusLabel(target.status)}）的文件改动：\n「${String(target.prompt || '').slice(0, 24)}」\n共 ${files} 个改动文件：恢复为任务开始时的内容，agent 新建的文件会被删除。\n\n10 分钟内发 #zcode回滚 确认 执行；任务结束后的其他修改也会被覆盖，请确认工作树没有未保存的并行改动。`;
  }
  if (!pending) return '没有待确认的回滚：先发 #zcode回滚 查看将要回滚的任务。';
  if (Date.now() - (pending.askedAt || 0) > 10 * 60 * 1000) {
    pendingRollbackBySender.delete(senderKey);
    return '待确认的回滚已过期（10 分钟），重新发 #zcode回滚 查看。';
  }
  pendingRollbackBySender.delete(senderKey);
  try {
    await consoleApi.manageTaskGit(pending.taskId, 'undo', { confirmed: true });
    return `已回滚任务 ${pending.taskId} 的文件改动：内容恢复为任务开始时的状态。可在控制台查看该任务的 Git 面板核对。`;
  } catch (error) {
    return `回滚失败：${String(error.message || error).slice(0, 200)}`;
  }
}

export class CrystelfZcodeAgent extends plugin {
  constructor() {
    super({
      name: 'crystelf-zcode-agent',
      dsc: 'ZCode 聊天侧入口：主人 #zcode 完整 Agent、定时巡检、结果推送',
      event: 'message',
      priority: -1000,
      rule: [
        { reg: '^#zcode停止$', fnc: 'stopTask', permission: 'master' },
        { reg: '^#zcode状态$', fnc: 'showStatus', permission: 'master' },
        { reg: '^#zcode会话(?:\\s+(\\S+))?$', fnc: 'showSessions', permission: 'master' },
        { reg: '^#zcode回滚(?:\\s+(确认))?$', fnc: 'rollbackTask', permission: 'master' },
        { reg: '^#zcode新会话$', fnc: 'resetSession', permission: 'master' },
        { reg: '^#巡检列表$', fnc: 'showInspections', permission: 'master' },
        { reg: '^#开启巡检\\s+([\\s\\S]+)$', fnc: 'addInspection', permission: 'master' },
        { reg: '^#关闭巡检\\s+(\\d+)$', fnc: 'removeInspection', permission: 'master' },
        { reg: '^#立即巡检(?:\\s+([\\s\\S]+))?$', fnc: 'runInspectionNow', permission: 'master' },
        { reg: '^#zcode(?:帮助|用法)?$', fnc: 'showHelp', permission: 'master' },
        { reg: '^#zcode只读\\s+([\\s\\S]+)$', fnc: 'runTaskReadonly', permission: 'master' },
        { reg: '^#zcode\\s+([\\s\\S]+)$', fnc: 'runTask', permission: 'master' },
      ],
    });
  }

  async showHelp(e) {
    await e.reply(HELP_TEXT, true);
    return true;
  }

  async showStatus(e) {
    await e.reply(latestProgressText(senderKeyOf(e)), true);
    return true;
  }

  async showSessions(e) {
    await listOrSwitchSessions(e);
    return true;
  }

  async resetSession(e) {
    sessionBySender.delete(senderKeyOf(e));
    await e.reply('已重置：下一条 #zcode 任务将从全新会话开始（旧任务记录保留）。', true);
    return true;
  }

  async stopTask(e) {
    await e.reply(await stopActive(e), true);
    return true;
  }

  async rollbackTask(e) {
    const confirmed = /(?:^|\s)确认\s*$/.test(String(e.msg || '').trim());
    await e.reply(await rollbackLastWrite(e, confirmed), true);
    return true;
  }

  async showInspections(e) {
    const schedules = getWorkbenchConfig().agentSchedules || [];
    scheduleChoices.length = 0;
    scheduleChoices.push(...schedules);
    const templateLine = `内置模板：${AGENT_TEMPLATES.map(t => t.name).join(' / ')}`;
    if (!schedules.length) {
      await e.reply(`${templateLine}\n\n当前没有定时巡检计划。\n用法：#开启巡检 <模板> HH:MM [群号/私QQ...]（可多个推送目标，不填推当前聊天）\n手动跑一次：#立即巡检 [模板]`, true);
      return true;
    }
    const lines = schedules.map((item, index) => `${index + 1}. [${item.enabled ? '启用' : '停用'}] ${describeSchedule(item)}`);
    await e.reply(`${templateLine}\n\n定时巡检计划：\n${lines.join('\n')}\n\n#关闭巡检 <编号> 删除；#立即巡检 [模板] 手动执行。`, true);
    return true;
  }

  async addInspection(e) {
    const rest = String(e.msg || '').replace(/^#开启巡检\s+/i, '').trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    const template = findAgentTemplate(parts[0] || '');
    if (!template) {
      await e.reply(`未知模板「${parts[0] || ''}」。可用模板：${AGENT_TEMPLATES.map(t => t.name).join(' / ')}\n用法：#开启巡检 <模板> HH:MM [群号/私QQ...]`, true);
      return true;
    }
    const time = /^(\d{1,2}):(\d{2})$/.exec(parts[1] || '');
    if (!time || Number(time[1]) > 23 || Number(time[2]) > 59) {
      await e.reply('时间格式应为 HH:MM（24 小时制），例如：#开启巡检 日志巡检 09:00 群123456', true);
      return true;
    }
    const cron = `${Number(time[2])} ${Number(time[1])} * * *`;
    const pushTargets = parsePushTargets(parts.slice(2), e);
    const current = getWorkbenchConfig().agentSchedules || [];
    const name = `${template.name}·每日${time[1].padStart(2, '0')}:${time[2]}`;
    // 同模板同时间已存在时替换，避免重复堆叠
    const filtered = current.filter(item => !(item.templateId === template.id && item.cron === cron));
    const schedules = [...filtered, {
      id: `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      cron,
      templateId: template.id,
      prompt: '',
      workspaceId: 'plugin',
      pushTargets,
      enabled: true,
    }];
    try {
      await saveAgentSchedules(schedules);
      await e.reply(`已开启：${describeSchedule(schedules[schedules.length - 1])}\n每天 ${time[1].padStart(2, '0')}:${time[2]} 自动跑「${template.name}」并推送报告（只读档，不改文件）。`, true);
    } catch (error) {
      await e.reply(`保存失败：${String(error.message || error).slice(0, 150)}`, true);
    }
    return true;
  }

  async removeInspection(e) {
    const index = Number(String(e.msg || '').replace(/^#关闭巡检\s+/i, '').trim()) - 1;
    const schedules = getWorkbenchConfig().agentSchedules || [];
    if (!Number.isInteger(index) || index < 0 || index >= schedules.length) {
      await e.reply(`编号无效：先发 #巡检列表 查看当前计划（共 ${schedules.length} 条）。`, true);
      return true;
    }
    const removed = schedules[index];
    await saveAgentSchedules(schedules.filter((_, i) => i !== index));
    await e.reply(`已关闭：${describeSchedule(removed)}`, true);
    return true;
  }

  async runInspectionNow(e) {
    const rest = String(e.msg || '').replace(/^#立即巡检\s*/i, '').trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    const named = findAgentTemplate(parts[0] || '');
    const template = named || findAgentTemplate('日志巡检');
    const pushTargets = parsePushTargets(named ? parts.slice(1) : parts, e);
    const precheckError = await precheck();
    if (precheckError) {
      await e.reply(precheckError, true);
      return true;
    }
    await e.reply(`已启动「${template.name}」巡检（只读档），完成后推送结果到${pushTargets.groups.length ? `群 ${pushTargets.groups.join('、')}` : ''}${pushTargets.groups.length && pushTargets.privates.length ? '与' : ''}${pushTargets.privates.length ? `私聊 ${pushTargets.privates.join('、')}` : ''}。`, true);
    scheduleRunner.runScheduleNow({
      id: `manual-${Date.now()}`,
      name: `${template.name}（手动）`,
      templateId: template.id,
      prompt: '',
      workspaceId: 'plugin',
      pushTargets,
    }).catch(() => { });
    return true;
  }

  async runTask(e) {
    return await this.runWithMode(e, 'full');
  }

  async runTaskReadonly(e) {
    return await this.runWithMode(e, 'plan');
  }

  async runWithMode(e, mode) {
    const senderKey = senderKeyOf(e);
    try {
      if (activeBySender.has(senderKey)) {
        await e.reply('你已有一个 ZCode 聊天任务在执行：#zcode状态 查看进展，#zcode停止 中断后再发。', true);
        return true;
      }
      const precheckError = await precheck(mode);
      if (precheckError) {
        await e.reply(precheckError, true);
        return true;
      }
      const taskText = String(e.msg || '')
        .replace(/^#zcode只读\s+/i, '')
        .replace(/^#zcode\s+/i, '')
        .replace(/^(任务|执行)[：:\s]*/, '')
        .trim();
      if (!taskText) {
        await e.reply(HELP_TEXT, true);
        return true;
      }
      await e.reply(await runChatTask(e, taskText, mode), true);
      return true;
    } catch (error) {
      getLogger()?.warn?.(`[zcode-agent] 任务处理失败（${senderKey}）：${error.message}`);
      await e.reply(`ZCode 任务失败：${String(error.message || error).slice(0, 300)}`, true);
      return true;
    }
  }
}
