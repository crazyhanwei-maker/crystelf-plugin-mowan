import plugin from '../../../lib/plugins/plugin.js';
import { getDependencyConsole } from '../lib/webConsole/server.js';

const REPAIR_LIMIT = 80;
const WATCH_INTERVAL_MS = 5000;
const WATCH_TIMEOUT_MS = 10 * 60 * 1000;

let repairRunning = false;

function formatTaskStatus(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'success') return '成功';
  if (value === 'error') return '失败';
  if (value === 'running') return '运行中';
  if (value === 'pending') return '排队中';
  return value || '未知';
}

function taskLabel(task = {}) {
  const scope = task.scope === 'plugin' ? `插件 ${task.pluginId || '-'}` : '当前插件';
  return `${task.name || '-'}（${scope}）`;
}

function buildTaskSummary(tasks = [], skipped = []) {
  const normalizedTasks = Array.isArray(tasks) ? tasks : [];
  const normalizedSkipped = Array.isArray(skipped) ? skipped : [];
  const successCount = normalizedTasks.filter(task => task.status === 'success').length;
  const errorTasks = normalizedTasks.filter(task => task.status === 'error');
  const activeTasks = normalizedTasks.filter(task => !['success', 'error'].includes(String(task.status || '')));
  const lines = [
    `任务：${normalizedTasks.length} 个`,
    `成功：${successCount}`,
    `失败：${errorTasks.length}`,
    `进行中：${activeTasks.length}`,
    `跳过：${normalizedSkipped.length}`,
  ];

  if (errorTasks.length > 0) {
    lines.push('', '失败项：');
    for (const task of errorTasks.slice(0, 5)) {
      lines.push(`- ${taskLabel(task)}：${String(task.error || '未知错误').slice(0, 120)}`);
    }
  }

  if (normalizedSkipped.length > 0) {
    lines.push('', '跳过项：');
    for (const item of normalizedSkipped.slice(0, 5)) {
      lines.push(`- ${item.name || '-'}：${String(item.error || '未知原因').slice(0, 120)}`);
    }
  }

  return lines.join('\n');
}

function getTaskIds(result = {}) {
  return (Array.isArray(result.tasks) ? result.tasks : [])
    .map(item => item?.task?.id || item?.id || '')
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForRepairTasks(dependencyConsole, taskIds = []) {
  const deadline = Date.now() + WATCH_TIMEOUT_MS;
  let tasks = [];
  while (Date.now() < deadline) {
    tasks = taskIds
      .map(id => {
        try {
          return dependencyConsole.serializeDependencyInstallTask(dependencyConsole.getDependencyInstallTask(id));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (tasks.length > 0 && tasks.every(task => ['success', 'error'].includes(String(task.status || '')))) {
      return { done: true, tasks };
    }
    await sleep(WATCH_INTERVAL_MS);
  }
  return { done: false, tasks };
}

export default class CrystelfDependencyRepair extends plugin {
  constructor() {
    super({
      name: 'crystelf-dependency-repair',
      dsc: 'QQ 内触发灵晶依赖修复',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#灵晶修复依赖$', fnc: 'repairDependencies' },
        { reg: '^#灵晶修复依赖状态$', fnc: 'showRepairStatus' },
      ],
    });
  }

  async repairDependencies(e) {
    if (!e.isMaster) {
      return e.reply('只有主人可以在 QQ 内触发依赖修复。', true);
    }
    if (repairRunning) {
      return e.reply('依赖修复任务正在执行中，可以发送 #灵晶修复依赖状态 查看进度。', true);
    }

    const dependencyConsole = getDependencyConsole();
    repairRunning = true;
    try {
      const precheck = await dependencyConsole.precheckMissingDependencyInstallTasks({
        includeOtherPlugins: true,
        limit: REPAIR_LIMIT,
      });
      if (precheck.requestedCount <= 0) {
        return e.reply('依赖检查完成：当前没有可修复的缺失依赖。', true);
      }
      if (precheck.okCount <= 0) {
        const failed = (precheck.results || [])
          .filter(item => item.ok !== true)
          .slice(0, 5)
          .map(item => `- ${item.name || '-'}：${item.error || '预检失败'}`)
          .join('\n');
        return e.reply(`依赖修复预检未通过，没有创建安装任务。\n${failed}`, true);
      }

      const result = await dependencyConsole.createMissingDependencyInstallTasks({
        includeOtherPlugins: true,
        limit: REPAIR_LIMIT,
        confirmed: true,
      });
      const taskIds = getTaskIds(result);
      await e.reply([
        '已创建灵晶依赖修复任务。',
        `待修复：${result.requestedCount || 0}`,
        `新建：${result.createdCount || 0}`,
        `复用：${result.reusedCount || 0}`,
        `跳过：${result.skippedCount || 0}`,
        result.limited ? `单次最多处理前 ${REPAIR_LIMIT} 个，剩余依赖可稍后再次发送 #灵晶修复依赖。` : '',
        '可发送 #灵晶修复依赖状态 查看进度。',
      ].filter(Boolean).join('\n'), true);

      if (taskIds.length <= 0) {
        return true;
      }

      const watched = await waitForRepairTasks(dependencyConsole, taskIds);
      const message = [
        watched.done ? '灵晶依赖修复任务已完成。' : '灵晶依赖修复任务仍在执行或等待中。',
        buildTaskSummary(watched.tasks, result.skipped),
        watched.done ? '' : '可稍后发送 #灵晶修复依赖状态 查看最新结果。',
      ].filter(Boolean).join('\n');
      return e.reply(message, true);
    } catch (error) {
      logger.error('[crystelf-plugin] QQ 依赖修复失败:', error);
      return e.reply(`灵晶依赖修复失败：${error.message}`, true);
    } finally {
      repairRunning = false;
    }
  }

  async showRepairStatus(e) {
    if (!e.isMaster) {
      return e.reply('只有主人可以查看依赖修复状态。', true);
    }

    const tasks = getDependencyConsole().listDependencyInstallTasks({ limit: 10 });
    if (tasks.length <= 0) {
      return e.reply('最近没有依赖修复任务。', true);
    }

    const lines = ['最近依赖修复任务', '━━━━━━━━━━━━'];
    for (const task of tasks.slice(0, 8)) {
      lines.push(`- ${taskLabel(task)}：${formatTaskStatus(task.status)}${task.error ? `，${String(task.error).slice(0, 80)}` : ''}`);
    }
    return e.reply(lines.join('\n'), true);
  }
}
