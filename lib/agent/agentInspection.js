// Agent 定时巡检：内置只读模板 + node-schedule 调度 + 结果推送
// 设计约束：
// - 任务固定只读 plan 档、不联网（无人值守场景不做写入）；审计照走工作台，标题前缀 [定时巡检]
// - 同一巡检配置上一轮未结束时跳过本轮（防堆积）；工作台未启用/运行时不可用时静默跳过
// - 推送走全局 Bot（Bot.pickGroup / Bot.pickUser），目标为 QQ 群号与私聊 QQ 号
import schedule from 'node-schedule';
import { formatTaskResult } from './agentChatBridge.js';

// 内置只读巡检模板：全部 plan 档（不执行命令），输出简明报告
export const AGENT_TEMPLATES = [
  {
    id: 'log-patrol',
    name: '日志巡检',
    prompt: '巡检 Yunzai 运行日志目录（logs/）里最近的日志：找出 ERROR/WARN 中值得关注的模式、异常堆栈、重复报错。输出简明巡检报告：① 健康度结论（一句话）② 关键问题（最多 5 条，含时间与要点）③ 处理建议。不要修改任何文件。',
  },
  {
    id: 'deps-check',
    name: '依赖体检',
    prompt: '检查 package.json 与已安装依赖的健康状况：版本锁定是否合理、dependencies 与 devDependencies 划分、明显缺失或重复的依赖。输出简明报告：① 结论 ② 问题清单（最多 5 条）③ 建议命令。不要修改任何文件、不要执行安装命令。',
  },
  {
    id: 'code-health',
    name: '代码健康',
    prompt: '抽查插件核心模块（lib/ 与 apps/）的代码健康：明显的坏味道、重复逻辑、潜在内存泄漏（未清理的定时器/监听器）、超长函数。输出简明报告：① 总体评价 ② 问题清单（最多 5 条，含文件与行号线索）③ 改进建议。不要修改任何文件。',
  },
  {
    id: 'weekly-report',
    name: '周报生成',
    prompt: '基于最近 7 天的 git log（git log --since="7 days ago" --oneline）与仓库现状，生成本周插件开发周报：① 本周完成事项（按主题归组）② 当前分支与待发布状态 ③ 下周建议。不要修改任何文件。',
  },
];

export function findAgentTemplate(nameOrId = '') {
  const key = String(nameOrId || '').trim().toLowerCase();
  if (!key) return null;
  return AGENT_TEMPLATES.find(item => item.id === key)
    || AGENT_TEMPLATES.find(item => item.name.toLowerCase() === key)
    || AGENT_TEMPLATES.find(item => item.name.includes(String(nameOrId || '').trim()))
    || null;
}

export const PUSH_TEXT_LIMIT = 1500;

export function formatPushReport(scheduleName = '', task = {}) {
  const result = formatTaskResult(task);
  const date = new Date().toLocaleString('zh-CN', { hour12: false });
  const head = `📋 ${scheduleName} · Agent 巡检报告（${date}）`;
  if (!result.ok) return `${head}\n\n${result.text}`;
  const body = String(result.text || '').trim();
  const text = `${head}\n\n${body}`;
  if (text.length <= PUSH_TEXT_LIMIT) return text;
  return `${text.slice(0, PUSH_TEXT_LIMIT)}\n\n（内容过长已截断，完整报告见控制台 Agent 工作台）`;
}

// 调度器：每分钟对齐配置（无需重启），到点触发只读巡检并推送
export function initAgentScheduleRunner({ getConsole, getConfig, logger } = {}) {
  const jobs = [];
  const running = new Set();
  let signature = '';
  let stopped = false;

  const getLogger = () => logger || globalThis.logger || console;

  async function pushReport(text, pushTargets = {}) {
    const groups = Array.isArray(pushTargets?.groups) ? pushTargets.groups : [];
    const privates = Array.isArray(pushTargets?.privates) ? pushTargets.privates : [];
    for (const groupId of groups) {
      try { await Bot?.pickGroup?.(groupId)?.sendMsg(text); } catch (error) { getLogger()?.warn?.(`[agent-inspection] 推送群 ${groupId} 失败：${error.message}`); }
    }
    for (const userId of privates) {
      try { await Bot?.pickUser?.(userId)?.sendMsg(text); } catch (error) { getLogger()?.warn?.(`[agent-inspection] 推送私聊 ${userId} 失败：${error.message}`); }
    }
  }

  async function runSchedule(config) {
    if (running.has(config.id)) return;
    running.add(config.id);
    const consoleApi = getConsole();
    try {
      // 运行时前置检查：不可用时静默跳过（定时任务无人值守，不推送错误噪音）
      const probe = await consoleApi.probeProvider('zcode').catch(() => null);
      if (!probe?.available) return;
      const template = AGENT_TEMPLATES.find(item => item.id === config.templateId);
      const prompt = String(config.prompt || template?.prompt || '').trim();
      if (!prompt) return;
      const date = new Date().toLocaleDateString('zh-CN');
      const task = await consoleApi.createTask({
        providerId: 'zcode',
        mode: 'plan',
        allowNetwork: false,
        workspaceId: config.workspaceId || 'plugin',
        prompt,
        title: `[定时巡检]${config.name} ${date}`.slice(0, 80),
      });
      // 跟踪到终态（5 秒轮询，30 分钟上限）
      let finalTask = null;
      const startedAt = Date.now();
      while (Date.now() - startedAt < 30 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const items = consoleApi.listTasks({ limit: 10, taskId: task.id });
        const current = (Array.isArray(items) ? items : items?.tasks || []).find(item => item.id === task.id);
        if (!current) break;
        if (!['pending', 'running', 'queued'].includes(current.status)) {
          finalTask = current;
          break;
        }
      }
      if (!finalTask) {
        getLogger()?.warn?.(`[agent-inspection] 巡检任务 ${task.id} 跟踪超时，取消推送`);
        return;
      }
      await pushReport(formatPushReport(config.name, finalTask), config.pushTargets);
      getLogger()?.info?.(`[agent-inspection] 巡检完成并推送：${config.name}（任务 ${task.id}）`);
    } catch (error) {
      getLogger()?.warn?.(`[agent-inspection] 巡检执行失败（${config.name}）：${error.message}`);
    } finally {
      running.delete(config.id);
    }
  }

  function rebuild() {
    if (stopped) return;
    const config = typeof getConfig === 'function' ? (getConfig() || {}) : {};
    const schedules = Array.isArray(config.agentSchedules) ? config.agentSchedules : [];
    const nextSignature = JSON.stringify(schedules.map(item => `${item.id}|${item.cron}|${item.enabled}`));
    if (nextSignature === signature) return;
    signature = nextSignature;
    for (const job of jobs) job.cancel?.();
    jobs.length = 0;
    for (const item of schedules) {
      if (!item.enabled || !item.cron) continue;
      try {
        const job = schedule.scheduleJob(item.id, item.cron, () => runSchedule(item));
        if (job) jobs.push(job);
      } catch (error) {
        getLogger()?.warn?.(`[agent-inspection] 无效的 cron（${item.name}: ${item.cron}）：${error.message}`);
      }
    }
    getLogger()?.info?.(`[agent-inspection] 定时巡检已加载：${jobs.length} 个计划`);
  }

  // 每分钟对齐配置变更（QQ 指令/控制台改配置后无需重启）
  const alignTimer = setInterval(rebuild, 60 * 1000);
  if (typeof alignTimer.unref === 'function') alignTimer.unref();
  rebuild();

  return {
    rebuild,
    stop() {
      stopped = true;
      for (const job of jobs) job.cancel?.();
      jobs.length = 0;
      clearInterval(alignTimer);
    },
    runScheduleNow: runSchedule,
  };
}
