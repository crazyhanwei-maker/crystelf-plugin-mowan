import plugin from '../../../lib/plugins/plugin.js';
import { getDependencyConsole } from '../lib/webConsole/server.js';
import ConfigControl from '../lib/config/configControl.js';
import AiCaller from '../lib/ai/aiCaller.js';
import { buildUserFacingErrorReply, isGroupContext } from '../lib/ai/userFacingError.js';

const REPAIR_LIMIT = 80;
const WATCH_INTERVAL_MS = 5000;
const WATCH_TIMEOUT_MS = 10 * 60 * 1000;
const CONFIRM_TIMEOUT_MS = 3 * 60 * 1000;
const RESTART_DELAY_MS = 3000;
const AI_DIAGNOSIS_MAX_FAILED_ITEMS = 3;

let repairRunning = false;
let restartScheduled = false;
const pendingRepairs = new Map();

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

function getGroupRole(e = {}) {
  return String(e.sender?.role || e.member?.role || '').trim().toLowerCase();
}

function isGroupManager(e = {}) {
  const role = getGroupRole(e);
  return e.isMaster === true || role === 'owner' || role === 'admin';
}

function getConfirmKey(e = {}) {
  return `${String(e.group_id || 'private')}:${String(e.user_id || '')}`;
}

function pruneExpiredPendingRepairs() {
  const now = Date.now();
  for (const [key, pending] of pendingRepairs.entries()) {
    if (!pending || Number(pending.expiresAt || 0) <= now) {
      pendingRepairs.delete(key);
    }
  }
}

function formatDependencyType(type = '') {
  const value = String(type || '').trim().toLowerCase();
  const labels = {
    runtime: '运行依赖',
    dependency: '运行依赖',
    dependencies: '运行依赖',
    dev: '开发依赖',
    devdependency: '开发依赖',
    devdependencies: '开发依赖',
    optional: '可选依赖',
    optionaldependency: '可选依赖',
    optionaldependencies: '可选依赖',
    peer: 'Peer 依赖',
    peerdependency: 'Peer 依赖',
    peerdependencies: 'Peer 依赖',
  };
  return labels[value] || value || '依赖';
}

function formatDependencyLabel(item = {}) {
  const name = String(item.name || '').trim() || '-';
  const version = String(item.declaredVersion || '').trim();
  const scope = item.scope === 'plugin'
    ? `插件 ${item.pluginId || '-'}`
    : '当前插件';
  const spec = version ? `${name}@${version}` : name;
  return `${spec}（${scope} / ${formatDependencyType(item.dependencyType)}）`;
}

function buildDependencyNameList(items = [], limit = 15) {
  const normalized = Array.isArray(items) ? items : [];
  const lines = normalized.slice(0, limit).map((item, index) => `${index + 1}. ${formatDependencyLabel(item)}`);
  if (normalized.length > limit) {
    lines.push(`... 还有 ${normalized.length - limit} 个依赖未展示`);
  }
  return lines.join('\n');
}

function buildTaskSummary(tasks = [], skipped = [], options = {}) {
  const normalizedTasks = Array.isArray(tasks) ? tasks : [];
  const normalizedSkipped = Array.isArray(skipped) ? skipped : [];
  const includeReason = options.includeReason !== false;
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
      lines.push(includeReason
        ? `- ${taskLabel(task)}：${String(task.error || '未知错误').slice(0, 120)}`
        : `- ${taskLabel(task)}`);
    }
  }

  if (normalizedSkipped.length > 0) {
    lines.push('', '跳过项：');
    for (const item of normalizedSkipped.slice(0, 5)) {
      lines.push(includeReason
        ? `- ${item.name || '-'}：${String(item.error || '未知原因').slice(0, 120)}`
        : `- ${item.name || '-'}`);
    }
  }

  return lines.join('\n');
}

function hasRepairFailure(tasks = [], skipped = []) {
  const normalizedTasks = Array.isArray(tasks) ? tasks : [];
  const normalizedSkipped = Array.isArray(skipped) ? skipped : [];
  return normalizedSkipped.length > 0 || normalizedTasks.some(task => task.status === 'error');
}

function formatTaskResultLine(item = {}) {
  return `- ${taskLabel(item)}`;
}

function formatFailedTaskResultLine(item = {}, options = {}) {
  if (options.includeReason === false) {
    return `- ${taskLabel(item)}`;
  }
  const reason = String(item.error || '未知错误').slice(0, 120);
  return `- ${taskLabel(item)}：${reason}`;
}

function formatSkippedResultLine(item = {}, options = {}) {
  if (options.includeReason === false) {
    return `- ${formatDependencyLabel(item)}`;
  }
  const reason = String(item.error || '未知原因').slice(0, 120);
  return `- ${formatDependencyLabel(item)}：${reason}`;
}

function buildRepairCompletionMessage(tasks = [], skipped = [], restart = false, aiDiagnosis = '', options = {}) {
  const normalizedTasks = Array.isArray(tasks) ? tasks : [];
  const normalizedSkipped = Array.isArray(skipped) ? skipped : [];
  const successTasks = normalizedTasks.filter(task => task.status === 'success');
  const errorTasks = normalizedTasks.filter(task => task.status === 'error');
  const failedCount = errorTasks.length + normalizedSkipped.length;
  const lines = [
    '依赖修复完成。',
    `修复成功 ${successTasks.length} 个：`,
    successTasks.length > 0 ? successTasks.slice(0, 12).map(formatTaskResultLine).join('\n') : '- 无',
  ];

  if (successTasks.length > 12) {
    lines.push(`... 还有 ${successTasks.length - 12} 个成功项未展示`);
  }

  lines.push('', `修复失败 ${failedCount} 个：`);
  if (failedCount > 0) {
    const failedLines = [
      ...errorTasks.slice(0, 8).map(item => formatFailedTaskResultLine(item, options)),
      ...normalizedSkipped.slice(0, Math.max(0, 8 - errorTasks.length)).map(item => formatSkippedResultLine(item, options)),
    ];
    lines.push(failedLines.join('\n'));
    if (failedCount > failedLines.length) {
      lines.push(`... 还有 ${failedCount - failedLines.length} 个失败项未展示`);
    }
  } else {
    lines.push('- 无');
  }

  const diagnosisText = String(aiDiagnosis || '').trim();
  if (diagnosisText) {
    lines.push('', 'AI 中文诊断：', diagnosisText);
  }

  if (restart) {
    lines.push('', '开始重启。');
  }
  return lines.join('\n');
}

function truncateText(text = '', maxLength = 1200) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function isAiConfigAvailable(aiConfig = {}) {
  return Boolean(
    String(aiConfig.baseApi || '').trim()
    && String(aiConfig.apiKey || '').trim()
    && (aiConfig.workingModel || aiConfig.modelType || aiConfig.model)
  );
}

function buildDependencyFailureDiagnosisPrompt(tasks = [], skipped = []) {
  const errorTasks = (Array.isArray(tasks) ? tasks : [])
    .filter(task => task.status === 'error')
    .slice(0, AI_DIAGNOSIS_MAX_FAILED_ITEMS)
    .map(task => ({
      dependency: task.name || '',
      declaredVersion: task.declaredVersion || '',
      plugin: task.scope === 'plugin' ? task.pluginId : 'crystelf-plugin',
      dependencyType: task.dependencyType || '',
      packageManager: task.packageManager || '',
      command: Array.isArray(task.command) ? task.command.join(' ') : '',
      targetDir: task.targetDir || '',
      failedStage: task.failedStage || task.currentStage || '',
      timedOut: task.timedOut === true,
      error: truncateText(task.error || '', 1200),
      stderrTail: truncateText(task.stderrTail || '', 1600),
      stdoutTail: truncateText(task.stdoutTail || '', 1000),
    }));
  const skippedItems = (Array.isArray(skipped) ? skipped : [])
    .slice(0, Math.max(0, AI_DIAGNOSIS_MAX_FAILED_ITEMS - errorTasks.length))
    .map(item => ({
      dependency: item.name || '',
      declaredVersion: item.declaredVersion || '',
      plugin: item.scope === 'plugin' ? item.pluginId : 'crystelf-plugin',
      dependencyType: item.dependencyType || '',
      error: truncateText(item.error || '', 1200),
      code: item.code || '',
    }));

  return [
    '请把下面的 Node.js/Yunzai 插件依赖安装失败日志翻译成中文，并告诉用户怎么修复。',
    '要求：',
    '1. 只用中文回答。',
    '2. 先用一句话说明最可能原因。',
    '3. 给出 2-4 条可执行修复建议。',
    '4. 不要建议删除整个 node_modules，除非日志明确指向依赖树严重损坏。',
    '5. 不要输出 Markdown 表格，不要输出代码块。',
    '6. 如果是网络、权限、版本不存在、pnpm included deps conflict、peer 依赖冲突、锁文件问题，要明确点名。',
    '',
    '失败数据：',
    JSON.stringify({ failedTasks: errorTasks, skippedItems }, null, 2),
  ].join('\n');
}

async function diagnoseDependencyFailuresWithAi(tasks = [], skipped = [], e = null) {
  const hasFailures = hasRepairFailure(tasks, skipped);
  if (!hasFailures) return '';
  try {
    const mainConfig = await ConfigControl.get('config');
    const aiConfig = await ConfigControl.get('ai');
    if (mainConfig?.ai === false || !isAiConfigAvailable(aiConfig)) {
      return '';
    }
    const prompt = buildDependencyFailureDiagnosisPrompt(tasks, skipped);
    const result = await AiCaller.callAiDirect(prompt, [], [], null, [], {
      systemPrompt: '你是 Node.js 依赖安装错误排查助手。你只能用中文给出简洁、可执行的原因和修复建议。',
      model: aiConfig.workingModel || aiConfig.modelType || aiConfig.model,
      temperature: 0.2,
      max_tokens: 16384,
      scene: 'dependency_repair_diagnosis',
      sessionId: e?.group_id ? `group:${e.group_id}:dependency-repair` : 'dependency-repair',
      groupId: e?.group_id,
      userId: e?.user_id,
    });
    if (!result?.success || !String(result.response || '').trim()) {
      return '';
    }
    return truncateText(result.response, 900);
  } catch (error) {
    logger.warn(`[crystelf-plugin] 依赖修复 AI 中文诊断失败: ${error.message}`);
    return '';
  }
}

function scheduleBotRestart(reason = 'dependency repair') {
  if (restartScheduled) {
    return false;
  }
  restartScheduled = true;
  setTimeout(() => {
    logger.mark(`[crystelf-plugin] 依赖修复完成，正在重启 Bot: ${reason}`);
    process.exit(0);
  }, RESTART_DELAY_MS);
  return true;
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

function buildPrecheckConfirmMessage(precheck = {}) {
  const results = Array.isArray(precheck.results) ? precheck.results : [];
  const okItems = results.filter(item => item.ok === true);
  const failedItems = results.filter(item => item.ok !== true);
  const lines = [
    '依赖检查完成，发现可修复的缺失依赖。',
    `可修复：${okItems.length} / ${precheck.requestedCount || 0}`,
    precheck.limited ? `单次最多处理前 ${REPAIR_LIMIT} 个，剩余依赖可稍后再次发送 #修复依赖。` : '',
    '',
    '准备修复：',
    buildDependencyNameList(okItems) || '- 暂无',
  ].filter(line => line !== '');

  if (failedItems.length > 0) {
    lines.push('', '以下依赖预检未通过，本次可能会跳过：');
    lines.push(buildDependencyNameList(failedItems.slice(0, 5), 5));
  }

  lines.push(
    '',
    '确认执行请在 3 分钟内发送：确认修复依赖',
    '取消请发送：取消修复依赖',
    '确认后会创建安装任务；全部完成且无失败时，Bot 会自动重启。'
  );
  return lines.join('\n');
}

async function runRepairTasks(e, options = {}) {
  if (repairRunning) {
    return e.reply(`依赖修复任务正在执行中，可以发送 ${options.statusCommand || '#灵晶修复依赖状态'} 查看进度。`, true);
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
        .map(item => isGroupContext(e)
          ? `- ${formatDependencyLabel(item)}`
          : `- ${formatDependencyLabel(item)}：${item.error || '预检失败'}`)
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
      result.limited ? `单次最多处理前 ${REPAIR_LIMIT} 个，剩余依赖可稍后再次发送 ${options.commandHint || '#灵晶修复依赖'}。` : '',
      `可发送 ${options.statusCommand || '#灵晶修复依赖状态'} 查看进度。`,
    ].filter(Boolean).join('\n'), true);

    if (taskIds.length <= 0) {
      return true;
    }

    const watched = await waitForRepairTasks(dependencyConsole, taskIds);
    const failed = hasRepairFailure(watched.tasks, result.skipped);
    const shouldRestart = options.restartAfterSuccess === true && watched.done;
    const aiDiagnosis = watched.done && failed
      ? await diagnoseDependencyFailuresWithAi(watched.tasks, result.skipped, e)
      : '';
    const includeFailureReason = !isGroupContext(e);
    const message = watched.done
      ? buildRepairCompletionMessage(watched.tasks, result.skipped, shouldRestart, aiDiagnosis, {
        includeReason: includeFailureReason,
      })
      : [
          '灵晶依赖修复任务仍在执行或等待中。',
          buildTaskSummary(watched.tasks, result.skipped, {
            includeReason: includeFailureReason,
          }),
          `可稍后发送 ${options.statusCommand || '#灵晶修复依赖状态'} 查看最新结果。`,
        ].filter(Boolean).join('\n');
    await e.reply(message, true);
    if (shouldRestart) {
      scheduleBotRestart('QQ #修复依赖');
    }
    return true;
  } catch (error) {
    logger.error('[crystelf-plugin] QQ 依赖修复失败:', error);
    return e.reply(buildUserFacingErrorReply(e, {
      groupMessage: '灵晶依赖修复失败，请稍后重试或去控制台查看依赖检查。',
      prefix: '灵晶依赖修复失败',
      error,
    }), true);
  } finally {
    repairRunning = false;
  }
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
        { reg: '^#修复依赖$', fnc: 'prepareAdminRepairDependencies' },
        { reg: '^#修复依赖状态$', fnc: 'showRepairStatus' },
        { reg: '^#?确认修复依赖$', fnc: 'confirmAdminRepairDependencies' },
        { reg: '^#?取消修复依赖$', fnc: 'cancelAdminRepairDependencies' },
      ],
    });
  }

  async repairDependencies(e) {
    if (!e.isMaster) {
      return e.reply('只有主人可以在 QQ 内触发依赖修复。', true);
    }
    return runRepairTasks(e, {
      commandHint: '#灵晶修复依赖',
      statusCommand: '#灵晶修复依赖状态',
      restartAfterSuccess: false,
    });
  }

  async prepareAdminRepairDependencies(e) {
    pruneExpiredPendingRepairs();
    if (!e.group_id) {
      return e.reply('请在群聊中由群主、管理员或主人使用 #修复依赖。', true);
    }
    if (!isGroupManager(e)) {
      return e.reply('只有群主、管理员或主人可以使用 #修复依赖。', true);
    }
    if (repairRunning) {
      return e.reply('依赖修复任务正在执行中，可以发送 #修复依赖状态 查看进度。', true);
    }

    const dependencyConsole = getDependencyConsole();
    try {
      const precheck = await dependencyConsole.precheckMissingDependencyInstallTasks({
        includeOtherPlugins: true,
        limit: REPAIR_LIMIT,
      });
      if (precheck.requestedCount <= 0) {
        pendingRepairs.delete(getConfirmKey(e));
        return e.reply('依赖检查完成：当前没有可修复的缺失依赖。', true);
      }
      if (precheck.okCount <= 0) {
        const failed = (precheck.results || [])
          .filter(item => item.ok !== true)
          .slice(0, 5)
          .map(item => isGroupContext(e)
            ? `- ${formatDependencyLabel(item)}`
            : `- ${formatDependencyLabel(item)}：${item.error || '预检失败'}`)
          .join('\n');
        pendingRepairs.delete(getConfirmKey(e));
        return e.reply(`依赖修复预检未通过，没有创建确认任务。\n${failed}`, true);
      }

      pendingRepairs.set(getConfirmKey(e), {
        groupId: String(e.group_id || ''),
        userId: String(e.user_id || ''),
        createdAt: Date.now(),
        expiresAt: Date.now() + CONFIRM_TIMEOUT_MS,
        precheck,
      });
      return e.reply(buildPrecheckConfirmMessage(precheck), true);
    } catch (error) {
      logger.error('[crystelf-plugin] QQ 管理员依赖修复预检失败:', error);
      return e.reply(buildUserFacingErrorReply(e, {
        groupMessage: '依赖检查失败，请稍后重试或去控制台查看依赖检查。',
        prefix: '依赖检查失败',
        error,
      }), true);
    }
  }

  async confirmAdminRepairDependencies(e) {
    pruneExpiredPendingRepairs();
    if (!e.group_id) {
      return e.reply('请在发起 #修复依赖 的群里确认。', true);
    }
    if (!isGroupManager(e)) {
      return e.reply('只有群主、管理员或主人可以确认依赖修复。', true);
    }

    const key = getConfirmKey(e);
    const pending = pendingRepairs.get(key);
    if (!pending) {
      return e.reply('没有待确认的依赖修复任务，或确认已过期。请重新发送 #修复依赖。', true);
    }
    pendingRepairs.delete(key);
    await e.reply('已确认依赖修复，开始创建安装任务。修复完成后会自动重启 Bot。', true);
    return runRepairTasks(e, {
      commandHint: '#修复依赖',
      statusCommand: '#修复依赖状态',
      restartAfterSuccess: true,
    });
  }

  async cancelAdminRepairDependencies(e) {
    pruneExpiredPendingRepairs();
    const key = getConfirmKey(e);
    if (!pendingRepairs.has(key)) {
      return e.reply('没有待取消的依赖修复确认。', true);
    }
    pendingRepairs.delete(key);
    return e.reply('已取消本次依赖修复，未创建安装任务。', true);
  }

  async showRepairStatus(e) {
    if (!e.isMaster && !(e.group_id && isGroupManager(e))) {
      return e.reply('只有主人、群主或管理员可以查看依赖修复状态。', true);
    }

    const tasks = getDependencyConsole().listDependencyInstallTasks({ limit: 10 });
    if (tasks.length <= 0) {
      return e.reply('最近没有依赖修复任务。', true);
    }

    const lines = ['最近依赖修复任务', '━━━━━━━━━━━━'];
    for (const task of tasks.slice(0, 8)) {
      const errorText = task.error && !isGroupContext(e) ? `，${String(task.error).slice(0, 80)}` : '';
      lines.push(`- ${taskLabel(task)}：${formatTaskStatus(task.status)}${errorText}`);
    }
    return e.reply(lines.join('\n'), true);
  }
}
