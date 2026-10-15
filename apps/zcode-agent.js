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

// 任务标题前缀：标记聊天侧发起的 ZCode 任务（控制台列表与审计里可区分）
const CHAT_TITLE_PREFIX = '[ZCode聊]';

// 单个发送者同时只跟踪一个活动任务（内存态，重启即清）
const activeBySender = new Map();

// 会话锚点：发送者 → 最近一条任务 id，下一轮任务接着它的会话续跑（内存态）
const sessionBySender = new Map();

const POLL_INTERVAL_MS = 5000;
const TRACK_TIMEOUT_MS = 30 * 60 * 1000;
// QQ 单条消息长度保守上限：超长截断并提示去控制台看全文
const REPLY_TEXT_LIMIT = 1200;

const HELP_TEXT = [
  '#zcode <任务> —— 提交完整 Agent 任务：可修改文件、联网、执行终端命令（仅主人）',
  '#zcode只读 <任务> —— 只读分析档：不改文件、不联网，适合解读/答疑',
  '#zcode状态 —— 查看当前任务进展',
  '#zcode停止 —— 中断当前任务',
  '#zcode新会话 —— 丢弃上下文，下一条从全新会话开始',
  '说明：完全访问档需控制台开启「允许实际修改文件」并授权目录；主人指令即写入确认，无逐条审批，改动在控制台可看 Git 差异。连续提问自动续接上下文。',
].join('\n');

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
  const sessionId = sessionBySender.get(senderKey) || '';
  const task = await consoleApi.createTask({
    providerId: 'zcode',
    mode,
    // 完全访问档：主人指令即授权（与微信桥 #agent 同一信任模型），允许联网
    ...(mode === 'full' ? { writeConfirmed: true, allowNetwork: true } : { allowNetwork: false }),
    workspaceId: 'plugin',
    ...(sessionId ? { sessionId } : {}),
    prompt: taskText,
    title: `${CHAT_TITLE_PREFIX}${senderKey} ${taskText.slice(0, 24)}`.slice(0, 80),
  });
  activeBySender.set(senderKey, { taskId: task.id });
  // 锚点切到本任务：下一轮 #zcode 自动接着这个会话（--resume 续接上下文）
  sessionBySender.set(senderKey, task.id);
  const modeNote = mode === 'full'
    ? '完全访问档（可改文件/联网/执行命令，无逐条审批，改动可在控制台看 Git 差异）'
    : '只读档（不改文件、不联网）';
  await e.reply(`已提交 ZCode 任务（${task.id}，${modeNote}），完成后回到这里；期间 #zcode状态 查看进展，#zcode停止 可中断。`, true);
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
  return result.ok ? limitReplyText(result.text) : result.text;
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

export class CrystelfZcodeAgent extends plugin {
  constructor() {
    super({
      name: 'crystelf-zcode-agent',
      dsc: 'ZCode 聊天侧入口：主人 #zcode 下发只读任务，结果回聊天',
      event: 'message',
      priority: -1000,
      rule: [
        { reg: '^#zcode停止$', fnc: 'stopTask', permission: 'master' },
        { reg: '^#zcode状态$', fnc: 'showStatus', permission: 'master' },
        { reg: '^#zcode新会话$', fnc: 'resetSession', permission: 'master' },
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

  async resetSession(e) {
    sessionBySender.delete(senderKeyOf(e));
    await e.reply('已重置：下一条 #zcode 任务将从全新会话开始（旧任务记录保留）。', true);
    return true;
  }

  async stopTask(e) {
    await e.reply(await stopActive(e), true);
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
