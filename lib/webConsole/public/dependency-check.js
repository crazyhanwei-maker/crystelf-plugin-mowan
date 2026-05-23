const state = {
  report: null,
  refreshPromise: null,
  historyPromise: null,
  installingKeys: new Set(),
  installTasks: new Map(),
  installHistory: [],
  installPollers: new Map(),
  restorePromise: null,
  bulkFixPromise: null,
  bulkFixBatch: null,
};

const { fetchJson, postJson } = window.CrystelfRequest;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: Number.isInteger(number) ? 0 : 2,
  }).format(number);
}

function formatDependencyStatus(status) {
  switch (String(status || '').trim()) {
    case 'missing':
      return '缺失';
    case 'version_mismatch':
      return '版本偏差';
    case 'not_installed':
      return '未安装';
    case 'ok':
    default:
      return '正常';
  }
}

function formatDependencyReportStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'error') return '异常';
  if (value === 'warn' || value === 'warning') return '警告';
  if (value === 'healthy' || value === 'success' || value === 'ok') return '正常';
  return '未知';
}

function setRefreshButtonState(isRefreshing) {
  const button = document.getElementById('refresh-btn');
  if (!button) return;
  button.disabled = isRefreshing;
  button.textContent = isRefreshing ? '重新扫描中...' : '重新扫描依赖';
}

function setBulkFixButtonState(isRunning) {
  const button = document.getElementById('install-missing-dependencies-btn');
  if (!button) return;
  button.disabled = isRunning;
  button.textContent = isRunning ? '正在创建任务...' : '一键修复依赖';
}

function setRefreshStatus(text, tone = 'neutral') {
  const el = document.getElementById('refresh-status');
  if (!el) return;
  el.textContent = text;
  el.className = tone === 'error' ? 'setting-error' : 'setting-help';
}

function setBulkFixStatusFromBatch() {
  const summary = getBulkFixBatchSummary();
  if (!summary) {
    return;
  }
  const activeText = summary.activeCount > 0 ? `，进行中 ${formatNumber(summary.activeCount)} 个` : '';
  const skippedText = summary.skippedCount > 0 ? `，跳过 ${formatNumber(summary.skippedCount)} 个` : '';
  const failedText = summary.errorCount > 0 ? `，失败 ${formatNumber(summary.errorCount)} 个` : '';
  const text = summary.finishedCount >= summary.totalCount
    ? `一键修复完成：成功 ${formatNumber(summary.successCount)} 个${failedText}${skippedText}`
    : `一键修复进行中：成功 ${formatNumber(summary.successCount)} 个${failedText}${activeText}${skippedText}`;
  setRefreshStatus(text, summary.errorCount > 0 || summary.skippedCount > 0 ? 'error' : 'neutral');
}

function setMeta(text) {
  const el = document.getElementById('page-meta');
  if (!el) return;
  el.textContent = text;
}

function getOtherPluginDependencyQuery() {
  return String(document.getElementById('other-plugin-dependency-search')?.value || '')
    .trim()
    .toLowerCase();
}

function getInstallHistoryQuery() {
  return String(document.getElementById('install-history-search')?.value || '')
    .trim()
    .toLowerCase();
}

function getInstallHistoryStatus() {
  const value = String(document.getElementById('install-history-status')?.value || 'all').trim().toLowerCase();
  return value === 'success' || value === 'error' ? value : 'all';
}

function isInstallableItem(item) {
  return item?.installable === true;
}

function getInstallableDependencyItems(report = state.report) {
  const items = Array.isArray(report?.items) ? report.items : [];
  const otherPluginItems = Array.isArray(report?.otherPluginDependencies?.items)
    ? report.otherPluginDependencies.items
    : [];
  const seen = new Set();

  return [...items, ...otherPluginItems]
    .filter(item => isInstallableItem(item))
    .filter(item => item.status === 'missing' || item.status === 'not_installed')
    .filter(item => {
      const key = getInstallKey(buildInstallPayload(item));
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function buildInstallPayload(item) {
  return {
    scope: item.installScope || 'current',
    pluginId: item.pluginId || '',
    dependencyType: item.dependencyType || item.group || '',
    name: item.name || '',
    declaredVersion: item.declaredVersion || '',
  };
}

function buildInstallPayloadFromTask(task) {
  return {
    scope: task?.scope || 'current',
    pluginId: task?.pluginId || '',
    dependencyType: task?.dependencyType || '',
    name: task?.name || '',
    declaredVersion: task?.declaredVersion || '',
  };
}

function getInstallKey(input) {
  return [
    input?.scope || input?.installScope || 'current',
    input?.pluginId || 'self',
    input?.dependencyType || input?.group || 'unknown',
    input?.name || '',
  ].join(':');
}

function sleep(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function trimText(value, maxLength = 120) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function getInstallTask(input) {
  return state.installTasks.get(getInstallKey(input)) || null;
}

function setInstallTask(task, fallbackKey = '') {
  const key = String(task?.key || fallbackKey || '').trim();
  if (!key) {
    return null;
  }

  if (!task) {
    state.installTasks.delete(key);
    state.installingKeys.delete(key);
    return null;
  }

  state.installTasks.set(key, task);
  if (task.status === 'pending' || task.status === 'running') {
    state.installingKeys.add(key);
  } else {
    state.installingKeys.delete(key);
  }
  return task;
}

function formatInstallTaskStatus(status) {
  switch (String(status || '').trim()) {
    case 'pending':
      return '等待执行';
    case 'running':
      return '正在安装';
    case 'success':
      return '已完成';
    case 'error':
      return '失败';
    default:
      return '未知';
  }
}

function createInstallTaskDraft(payload, overrides = {}) {
  return {
    key: getInstallKey(payload),
    status: 'pending',
    name: payload?.name || '',
    scope: payload?.scope || 'current',
    pluginId: payload?.pluginId || '',
    dependencyType: payload?.dependencyType || '',
    declaredVersion: payload?.declaredVersion || '',
    packageManager: '',
    command: [],
    targetDir: '',
    createdAt: '',
    startedAt: '',
    finishedAt: '',
    error: '',
    stdoutTail: '',
    stderrTail: '',
    timedOut: false,
    currentStage: '等待执行',
    failedStage: '',
    events: [],
    ...overrides,
  };
}

function buildInstallTaskError(task) {
  return trimText(task?.error || task?.stderrTail || task?.stdoutTail || '安装失败', 160);
}

function getInstallTaskFailureContext(task = {}) {
  const events = Array.isArray(task.events) ? task.events : [];
  return [
    task.error,
    task.stderrTail,
    task.stdoutTail,
    task.currentStage,
    task.failedStage,
    task.packageManager,
    Array.isArray(task.command) ? task.command.join(' ') : '',
    ...events.map(event => `${event?.stage || ''} ${event?.message || ''}`),
  ].filter(Boolean).join('\n').toLowerCase();
}

function getInstallTaskFailureAdvice(task = {}) {
  if (!task || task.status !== 'error') {
    return [];
  }

  const context = getInstallTaskFailureContext(task);
  const advice = [];
  const pushAdvice = (title, detail) => {
    if (!advice.some(item => item.title === title)) {
      advice.push({ title, detail });
    }
  };

  if (task.timedOut || /timed?\s*out|timeout|etimedout|超时/.test(context)) {
    pushAdvice(
      '安装命令执行超时',
      '先检查网络和 npm 源是否可用，再重试修复；网络较慢时可以在服务器终端手动执行同一条安装命令观察完整输出。',
    );
  }

  if (/eai_again|enotfound|getaddrinfo|network|fetch failed|socket hang up|ecconnreset|econnreset|etimedout|registry|代理|网络|证书|certificate|ssl|tls/.test(context)) {
    pushAdvice(
      '网络或镜像源可能不可用',
      '确认服务器能访问 npm 镜像源；如果使用代理，检查代理环境变量。也可以临时切换为稳定镜像后重新执行修复。',
    );
  }

  if (/eacces|eperm|permission denied|access denied|operation not permitted|readonly|not writable|不可读写|拒绝访问|权限/.test(context)) {
    pushAdvice(
      '目标目录权限不足',
      '用当前运行机器人的账号检查插件目录和 package.json 是否可写；必要时调整目录权限后再重试。',
    );
  }

  if (/enoent|no such file or directory|manifest|package\.json|目标 package\.json|目标目录不存在|找不到/.test(context)) {
    pushAdvice(
      '安装目标不完整',
      '确认目标插件目录还存在，并且目录内有 package.json。插件被移动、删除或路径配置错误时，需要先修正目录。',
    );
  }

  if (/not found|404|e404|no matching version|notarget|version not found|包不存在|版本不存在|无法找到|不存在/.test(context)) {
    pushAdvice(
      '依赖名或版本可能不存在',
      '检查 package.json 中声明的依赖名和版本范围；如果版本已经下架或写错，先修正版本再执行修复。',
    );
  }

  if (/eresolve|peer dep|peer dependency|conflicting peer dependency|dependency conflict|冲突|peer/.test(context)) {
    pushAdvice(
      '依赖版本存在冲突',
      '优先检查 peerDependencies 提示的版本范围。确认兼容后再调整 package.json，避免直接强制安装导致运行时异常。',
    );
  }

  if (/lockfile|package-lock|pnpm-lock|yarn.lock|integrity checksum|shrinkwrap|锁文件|integrity/.test(context)) {
    pushAdvice(
      '锁文件或缓存状态可能异常',
      '先查看锁文件是否被旧版本包管理器生成；必要时备份后重新生成锁文件，再执行依赖修复。',
    );
  }

  if (/仍无法解析|cannot find module|module not found|resolve|无法解析|node_modules/.test(context)) {
    pushAdvice(
      '安装完成后仍无法解析依赖',
      '检查 node_modules 链接和包管理器工作区设置。pnpm 场景下尤其要确认依赖安装到了正确插件目录。',
    );
  }

  if (/npm|pnpm|yarn|包管理器/.test(context) && /not recognized|not found|无法识别|不是内部或外部命令|未检测到可用的包管理器/.test(context)) {
    pushAdvice(
      '包管理器不可用',
      '确认当前环境已安装 npm、pnpm 或 yarn，并且机器人启动账号的 PATH 能找到对应命令。',
    );
  }

  if (advice.length <= 0) {
    pushAdvice(
      '需要查看完整日志定位',
      '先复制安装日志，重点看 stderr 最后一段和失败阶段；如果只显示退出码，可以在目标目录手动执行同一条命令获取更完整的错误。',
    );
  }

  return advice.slice(0, 4);
}

function getInstallTaskCommandText(task = {}) {
  return Array.isArray(task.command) ? task.command.filter(Boolean).join(' ') : '';
}

function getPrecheckCommandText(precheck = {}) {
  if (precheck.commandText) {
    return String(precheck.commandText || '').trim();
  }
  return Array.isArray(precheck.command) ? precheck.command.filter(Boolean).join(' ') : '';
}

function buildDependencyInstallPrecheckMessage(precheck = {}, title = '依赖安装预检') {
  const affectedFiles = Array.isArray(precheck.affectedFiles) ? precheck.affectedFiles : [];
  const checks = Array.isArray(precheck.checks) ? precheck.checks : [];
  const lines = [
    `${title}已完成。`,
    `依赖：${precheck.name || '-'}`,
    `范围：${precheck.scope === 'plugin' ? `其他插件 ${precheck.pluginId || '-'}` : '当前插件'}`,
    `目标目录：${precheck.targetDir || '-'}`,
    `包管理器：${precheck.packageManager || '-'}`,
    `命令：${getPrecheckCommandText(precheck) || '-'}`,
    '',
    '安全确认：',
    '- 控制台不会删除 node_modules，不会清理锁文件。',
    '- 后端会再次校验依赖必须已声明在目标 package.json 中。',
    '- 安装命令可能修改 package.json、锁文件和目标目录下的 node_modules。',
  ];

  if (affectedFiles.length > 0) {
    lines.push('', '可能被包管理器改动的文件：');
    affectedFiles.slice(0, 8).forEach(file => lines.push(`- ${file}`));
    if (affectedFiles.length > 8) lines.push(`- 还有 ${affectedFiles.length - 8} 个文件未展示`);
  }

  if (checks.length > 0) {
    lines.push('', '预检项：');
    checks.slice(0, 8).forEach(check => lines.push(`- ${check.ok ? '通过' : '失败'}：${check.label || check.key || '-'}`));
  }

  lines.push('', '确认创建安装任务？');
  return lines.join('\n');
}

function buildBulkDependencyInstallPrecheckMessage(precheck = {}, installableItems = []) {
  const results = Array.isArray(precheck.results) ? precheck.results : [];
  const passed = results.filter(item => item.ok === true);
  const failed = results.filter(item => item.ok !== true);
  const targetDirs = Array.from(new Set(passed.map(item => item.targetDir).filter(Boolean)));
  const otherPluginCount = passed.filter(item => item.scope === 'plugin').length;
  const lines = [
    '一键修复依赖预检已完成。',
    `准备创建任务：${formatNumber(passed.length)} 个`,
    `预检失败：${formatNumber(failed.length)} 个`,
    `涉及目标目录：${formatNumber(targetDirs.length)} 个`,
    `其他插件依赖：${formatNumber(otherPluginCount)} 个`,
    '',
    '安全确认：',
    '- 控制台不会删除 node_modules，不会清理锁文件。',
    '- 每个任务只会在预检显示的目标目录执行。',
    '- 包管理器可能修改对应目录的 package.json、锁文件和 node_modules。',
  ];

  if (targetDirs.length > 0) {
    lines.push('', '目标目录预览：');
    targetDirs.slice(0, 10).forEach(dir => lines.push(`- ${dir}`));
    if (targetDirs.length > 10) lines.push(`- 还有 ${targetDirs.length - 10} 个目录未展示`);
  }

  if (passed.length > 0) {
    lines.push('', '命令预览：');
    passed.slice(0, 12).forEach(item => {
      lines.push(`- ${item.name || '-'} @ ${item.targetDir || '-'}：${getPrecheckCommandText(item) || '-'}`);
    });
    if (passed.length > 12) lines.push(`- 还有 ${passed.length - 12} 条命令未展示`);
  }

  if (failed.length > 0) {
    lines.push('', '预检失败项：');
    failed.slice(0, 8).forEach(item => lines.push(`- ${item.name || '-'}：${item.error || '预检失败'}`));
    if (failed.length > 8) lines.push(`- 还有 ${failed.length - 8} 个失败项未展示`);
  }

  if (installableItems.length > results.length) {
    lines.push('', `本次只预检前 ${formatNumber(results.length)} 个，剩余依赖不会在本次执行。`);
  }

  lines.push('', '确认为预检通过的依赖创建安装任务？');
  return lines.join('\n');
}

function getInstallTaskLogText(task = {}) {
  const events = Array.isArray(task.events) ? task.events : [];
  const commandText = getInstallTaskCommandText(task);
  const adviceLines = getInstallTaskFailureAdvice(task).map((item, index) => `${index + 1}. ${item.title}：${item.detail}`);
  const metaLines = [
    '依赖修复任务日志',
    `生成时间：${formatTime(new Date().toISOString())}`,
    `依赖：${task.name || '-'}`,
    `状态：${formatInstallTaskStatus(task.status)}`,
    task.currentStage ? `当前阶段：${task.currentStage}` : '',
    task.failedStage ? `失败阶段：${task.failedStage}` : '',
    task.packageManager ? `包管理器：${task.packageManager}` : '',
    task.targetDir ? `目标目录：${task.targetDir}` : '',
    commandText ? `安装命令：${commandText}` : '',
    task.createdAt ? `创建时间：${formatTime(task.createdAt)}` : '',
    task.startedAt ? `开始时间：${formatTime(task.startedAt)}` : '',
    task.finishedAt ? `结束时间：${formatTime(task.finishedAt)}` : '',
    task.timedOut ? '执行结果：已超时' : '',
    task.error ? `错误信息：${task.error}` : '',
  ].filter(Boolean);
  const eventLines = events.map(event => [
    `[${formatTime(event.time)}]`,
    event.level ? `[${event.level}]` : '',
    event.stage ? `${event.stage}：` : '',
    event.message || '',
  ].filter(Boolean).join(' '));

  return [
    metaLines.join('\n'),
    adviceLines.length > 0 ? `处理建议\n${adviceLines.join('\n')}` : '',
    eventLines.length > 0 ? `事件时间线\n${eventLines.join('\n')}` : '',
    task.stderrTail ? `[stderr]\n${task.stderrTail}` : '',
    task.stdoutTail ? `[stdout]\n${task.stdoutTail}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildInstallTaskDiagnostic(task = {}) {
  return {
    generatedAt: new Date().toISOString(),
    id: task.id || '',
    key: task.key || '',
    name: task.name || '',
    status: task.status || '',
    statusText: formatInstallTaskStatus(task.status),
    scope: task.scope || 'current',
    pluginId: task.pluginId || '',
    dependencyType: task.dependencyType || '',
    declaredVersion: task.declaredVersion || '',
    packageManager: task.packageManager || '',
    command: Array.isArray(task.command) ? task.command : [],
    commandText: getInstallTaskCommandText(task),
    targetDir: task.targetDir || '',
    currentStage: task.currentStage || '',
    failedStage: task.failedStage || '',
    createdAt: task.createdAt || '',
    startedAt: task.startedAt || '',
    finishedAt: task.finishedAt || '',
    timedOut: task.timedOut === true,
    error: task.error || '',
    advice: getInstallTaskFailureAdvice(task),
    stdoutTail: task.stdoutTail || '',
    stderrTail: task.stderrTail || '',
    events: Array.isArray(task.events) ? task.events : [],
  };
}

function findInstallTaskByKey(key = '') {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return null;
  return state.installTasks.get(normalizedKey)
    || state.bulkFixBatch?.tasks?.get?.(normalizedKey)
    || state.bulkFixBatch?.skipped?.get?.(normalizedKey)
    || state.installHistory.find(task => task?.key === normalizedKey)
    || null;
}

function copyTextFallback(text = '') {
  const textarea = document.createElement('textarea');
  try {
    textarea.value = String(text || '');
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function copyDependencyText(text = '') {
  const value = String(text || '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to textarea copy below.
  }
  if (copyTextFallback(value)) {
    return true;
  }
  throw new Error('浏览器没有允许写入剪贴板');
}

function downloadDependencyJson(data = {}, filePrefix = 'dependency-install-task') {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `${filePrefix}-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getBulkFixBatchTasks() {
  const batch = state.bulkFixBatch;
  if (!batch) return [];
  return [
    ...Array.from(batch.tasks.values()).filter(Boolean),
    ...Array.from(batch.skipped.values()).filter(Boolean),
  ];
}

function buildBulkFixDiagnostic() {
  const summary = getBulkFixBatchSummary();
  const batch = state.bulkFixBatch || {};
  const tasks = getBulkFixBatchTasks();
  return {
    generatedAt: new Date().toISOString(),
    batchId: batch.id || '',
    startedAt: batch.startedAt || '',
    finishedAt: batch.finishedAt || '',
    summary,
    tasks: tasks.map(buildInstallTaskDiagnostic),
  };
}

function downloadBulkFixDiagnostic() {
  downloadDependencyJson(buildBulkFixDiagnostic(), 'dependency-bulk-fix-report');
}

function createBulkFixBatch(items = []) {
  const keys = items.map(item => getInstallKey(buildInstallPayload(item))).filter(Boolean);
  state.bulkFixBatch = {
    id: `bulk-${Date.now().toString(36)}`,
    totalCount: keys.length,
    keys: new Set(keys),
    tasks: new Map(),
    skipped: new Map(),
    startedAt: new Date().toISOString(),
    finishedAt: '',
  };
  return state.bulkFixBatch;
}

function updateBulkFixBatchTask(task, fallbackKey = '') {
  const batch = state.bulkFixBatch;
  const key = String(task?.key || fallbackKey || '').trim();
  if (!batch || !key || !batch.keys.has(key)) {
    return false;
  }
  batch.tasks.set(key, task);
  const summary = getBulkFixBatchSummary();
  if (summary && summary.finishedCount >= summary.totalCount && !batch.finishedAt) {
    batch.finishedAt = new Date().toISOString();
  }
  return true;
}

function addBulkFixSkipped(item = {}) {
  const batch = state.bulkFixBatch;
  const key = getInstallKey(item);
  if (!batch || !key || !batch.keys.has(key)) {
    return false;
  }
  batch.skipped.set(key, {
    ...item,
    status: 'error',
    error: String(item?.error || '创建安装任务失败').trim(),
    finishedAt: new Date().toISOString(),
  });
  return true;
}

function getBulkFixBatchSummary() {
  const batch = state.bulkFixBatch;
  if (!batch) {
    return null;
  }

  const tasks = Array.from(batch.tasks.values()).filter(Boolean);
  const skipped = Array.from(batch.skipped.values()).filter(Boolean);
  const pendingCount = tasks.filter(task => task.status === 'pending').length;
  const runningCount = tasks.filter(task => task.status === 'running').length;
  const successCount = tasks.filter(task => task.status === 'success').length;
  const taskErrorCount = tasks.filter(task => task.status === 'error').length;
  const skippedCount = skipped.length;
  const errorCount = taskErrorCount + skippedCount;
  const finishedCount = successCount + errorCount;
  const activeCount = Math.max(0, Number(batch.totalCount || 0) - finishedCount);
  const failures = [
    ...tasks.filter(task => task.status === 'error'),
    ...skipped,
  ].slice(0, 6);

  return {
    totalCount: Number(batch.totalCount || 0),
    pendingCount,
    runningCount,
    successCount,
    errorCount,
    skippedCount,
    finishedCount,
    activeCount,
    failures,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt,
  };
}

function getActiveInstallTasks() {
  const tasks = Array.from(state.installTasks.values())
    .filter(task => task && (task.status === 'pending' || task.status === 'running'));

  tasks.sort((left, right) => {
    const statusOrder = { running: 0, pending: 1 };
    const statusCompare = (statusOrder[left.status] ?? 99) - (statusOrder[right.status] ?? 99);
    if (statusCompare !== 0) {
      return statusCompare;
    }

    const leftTime = Date.parse(left.startedAt || left.createdAt || 0);
    const rightTime = Date.parse(right.startedAt || right.createdAt || 0);
    return rightTime - leftTime;
  });

  return tasks;
}

async function refreshInstallHistory() {
  if (state.historyPromise) {
    return state.historyPromise;
  }

  state.historyPromise = (async () => {
    const result = await fetchJson('/api/dependencies/install-history?limit=12');
    state.installHistory = Array.isArray(result?.tasks) ? result.tasks : [];
    renderInstallHistory();
    return state.installHistory;
  })().finally(() => {
    state.historyPromise = null;
  });

  return state.historyPromise;
}

async function clearInstallHistory() {
  const result = await postJson('/api/dependencies/install-history/clear', {});
  state.installHistory = Array.isArray(result?.tasks) ? result.tasks : [];
  renderInstallHistory();
  setRefreshStatus(`已清空 ${formatNumber(result?.removedCount || 0)} 条安装记录`, 'neutral');
  return result;
}

function rerenderDependencyViews() {
  if (state.report) {
    renderReport(state.report);
    return;
  }
  renderActiveInstallTasks();
  renderInstallHistory();
}

async function restoreActiveInstallTasks() {
  if (state.restorePromise) {
    return state.restorePromise;
  }

  state.restorePromise = (async () => {
    const result = await fetchJson('/api/dependencies/install-active');
    const tasks = Array.isArray(result?.tasks) ? result.tasks : [];
    let restoredCount = 0;

    for (const task of tasks) {
      if (!task?.id) {
        continue;
      }

      const payload = buildInstallPayloadFromTask(task);
      const key = String(task.key || getInstallKey(payload)).trim();
      setInstallTask(task, key);
      restoredCount += 1;
      startInstallTaskPolling(task, payload, { key }).catch(() => {});
    }

    if (restoredCount > 0) {
      rerenderDependencyViews();
      setRefreshStatus(`已恢复 ${restoredCount} 个安装任务的状态追踪`, 'neutral');
    } else {
      renderActiveInstallTasks();
    }

    return tasks;
  })().finally(() => {
    state.restorePromise = null;
  });

  return state.restorePromise;
}

async function pollInstallTask(taskId, payload, options = {}) {
  const key = String(options.key || getInstallKey(payload)).trim();
  const taskName = payload?.name || '依赖';
  const bulkFix = options.bulkFix === true;

  while (true) {
    try {
      const result = await fetchJson(`/api/dependencies/install-status?taskId=${encodeURIComponent(taskId)}`);
      const task = setInstallTask(result.task, key);
      const belongsToBulkFix = updateBulkFixBatchTask(task, key) || bulkFix;
      rerenderDependencyViews();

      if (task?.status === 'pending') {
        if (belongsToBulkFix) {
          setBulkFixStatusFromBatch();
        } else {
          setRefreshStatus(`安装任务已创建：${taskName}，等待执行...`, 'neutral');
        }
        await sleep(800);
        continue;
      }

      if (task?.status === 'running') {
        if (belongsToBulkFix) {
          setBulkFixStatusFromBatch();
        } else {
          const managerText = task.packageManager ? `，包管理器：${task.packageManager}` : '';
          setRefreshStatus(`正在安装 ${taskName}${managerText}...`, 'neutral');
        }
        await sleep(1200);
        continue;
      }

      if (task?.status === 'success') {
        try {
          await refreshDependencies();
        } catch {
        }
        try {
          await refreshInstallHistory();
        } catch {
        }
        state.installTasks.delete(key);
        rerenderDependencyViews();
        if (belongsToBulkFix) {
          setBulkFixStatusFromBatch();
        } else {
          const managerText = task.packageManager ? `，包管理器：${task.packageManager}` : '';
          const targetText = task.targetDir ? `，目标：${task.targetDir}` : '';
          setRefreshStatus(`已完成 ${taskName} 的安装${managerText}${targetText}`, 'neutral');
        }
        return task;
      }

      try {
        await refreshInstallHistory();
      } catch {
      }
      if (belongsToBulkFix) {
        setBulkFixStatusFromBatch();
      } else {
        setRefreshStatus(`安装失败：${buildInstallTaskError(task)}`, 'error');
      }
      return task;
    } catch (error) {
      const message = String(error?.message || '').trim();
      if (message.includes('任务不存在') || message.includes('已过期') || message.includes('404')) {
        throw error;
      }
      setRefreshStatus(`任务状态查询失败，正在重试：${message}`, 'error');
      await sleep(1500);
    }
  }
}

function startInstallTaskPolling(task, payload, options = {}) {
  const key = String(options.key || task?.key || getInstallKey(payload)).trim();
  if (!key || !task?.id) {
    return Promise.resolve(task || null);
  }

  const existing = state.installPollers.get(key);
  if (existing) {
    return existing;
  }

  const poller = pollInstallTask(task.id, payload, { ...options, key }).finally(() => {
    if (state.installPollers.get(key) === poller) {
      state.installPollers.delete(key);
    }
  });

  state.installPollers.set(key, poller);
  return poller;
}

async function refreshDependencies() {
  if (state.refreshPromise) {
    return state.refreshPromise;
  }

  setRefreshStatus('正在刷新依赖检查...', 'neutral');
  setRefreshButtonState(true);

  state.refreshPromise = (async () => {
    try {
      const report = await fetchJson('/api/dependencies');
      renderReport(report);
      setRefreshStatus(`最近刷新：${formatTime(report?.summary?.checkedAt)}`, report?.summary?.status === 'error' ? 'error' : 'neutral');
      return report;
    } catch (error) {
      setMeta('依赖检查加载失败');
      setRefreshStatus(`依赖检查加载失败：${error.message}`, 'error');
      throw error;
    } finally {
      state.refreshPromise = null;
      setRefreshButtonState(false);
    }
  })();

  return state.refreshPromise;
}

async function precheckDependencyInstall(payload) {
  const result = await postJson('/api/dependencies/install-precheck', payload);
  return result?.precheck || result;
}

async function installDependency(payload) {
  const key = getInstallKey(payload);
  if (!payload?.name || state.installingKeys.has(key)) {
    return;
  }

  setRefreshStatus(`正在预检 ${payload.name} 的安装环境...`, 'neutral');

  try {
    const precheck = await precheckDependencyInstall(payload);
    const packageManagerText = precheck?.packageManager ? `，包管理器：${precheck.packageManager}` : '';
    const confirmed = await webConsoleConfirm(buildDependencyInstallPrecheckMessage(precheck), {
      title: '确认依赖安装',
      confirmText: '确认安装',
      cancelText: '取消',
    });
    if (!confirmed) {
      setRefreshStatus(`已取消 ${payload.name} 的依赖安装。`, 'neutral');
      return;
    }

    setInstallTask(createInstallTaskDraft(payload, {
      packageManager: precheck?.packageManager || '',
      command: Array.isArray(precheck?.command) ? precheck.command : [],
      targetDir: precheck?.targetDir || '',
      currentStage: '等待执行（已确认）',
    }), key);
    rerenderDependencyViews();
    setRefreshStatus(`预检通过，正在创建 ${payload.name} 的安装任务${packageManagerText}...`, 'neutral');

    const result = await postJson('/api/dependencies/install', { ...payload, confirmed: true });
    const task = setInstallTask(result.task, key);
    rerenderDependencyViews();
    if (!task?.id) {
      throw new Error('安装任务创建失败');
    }
    if (result.reused) {
      setRefreshStatus(`已复用正在执行的安装任务：${payload.name}`, 'neutral');
    }
    await startInstallTaskPolling(task, payload, { key });
  } catch (error) {
    setInstallTask(createInstallTaskDraft(payload, {
      status: 'error',
      error: String(error?.message || '安装失败').trim(),
      finishedAt: new Date().toISOString(),
    }), key);
    setRefreshStatus(`安装失败：${error.message}`, 'error');
    rerenderDependencyViews();
  }
}

async function installMissingDependencies() {
  if (state.bulkFixPromise) {
    return state.bulkFixPromise;
  }

  const installableItems = getInstallableDependencyItems();
  if (installableItems.length <= 0) {
    setRefreshStatus('当前没有可一键修复的缺失依赖。', 'neutral');
    renderBulkFixPanel(state.report);
    return null;
  }

  const limitedCount = Math.min(80, installableItems.length);

  setBulkFixButtonState(true);
  setRefreshStatus('正在执行批量安装预检...', 'neutral');

  state.bulkFixPromise = (async () => {
    try {
      const selectedItems = installableItems.slice(0, limitedCount);
      const precheck = await postJson('/api/dependencies/install-precheck', {
        mode: 'missing',
        includeOtherPlugins: true,
        limit: 80,
      });
      const precheckResults = Array.isArray(precheck?.results) ? precheck.results : [];
      const precheckFailures = precheckResults.filter(item => item?.ok !== true);
      const okCount = Number(precheck?.okCount || 0);
      const errorCount = Number(precheck?.errorCount || 0);

      if (okCount > 0) {
        const confirmed = await webConsoleConfirm(buildBulkDependencyInstallPrecheckMessage(precheck, installableItems), {
          title: '确认一键修复依赖',
          confirmText: '确认创建任务',
          cancelText: '取消',
        });
        if (!confirmed) {
          setRefreshStatus('已取消一键修复，未创建安装任务。', 'neutral');
          return precheck;
        }
      }

      if (errorCount > 0 && okCount <= 0) {
        createBulkFixBatch(selectedItems);
        for (const failed of precheckFailures) {
          addBulkFixSkipped(failed);
          setInstallTask(createInstallTaskDraft(failed, {
            status: 'error',
            error: String(failed?.error || '安装预检失败').trim(),
            finishedAt: new Date().toISOString(),
          }), getInstallKey(failed));
        }
        rerenderDependencyViews();
        setBulkFixStatusFromBatch();
        return precheck;
      }

      createBulkFixBatch(selectedItems);
      for (const failed of precheckFailures) {
        addBulkFixSkipped(failed);
        setInstallTask(createInstallTaskDraft(failed, {
          status: 'error',
          error: String(failed?.error || '安装预检失败').trim(),
          finishedAt: new Date().toISOString(),
        }), getInstallKey(failed));
      }

      for (const item of selectedItems) {
        const payload = buildInstallPayload(item);
        if (precheckFailures.some(failed => getInstallKey(failed) === getInstallKey(payload))) {
          continue;
        }
        setInstallTask(createInstallTaskDraft(payload), getInstallKey(payload));
      }
      rerenderDependencyViews();
      setRefreshStatus(`预检通过 ${formatNumber(okCount)} 个，正在批量创建依赖安装任务...`, errorCount > 0 ? 'error' : 'neutral');

      const result = await postJson('/api/dependencies/install-missing', {
        includeOtherPlugins: true,
        limit: 80,
        confirmed: true,
      });
      const taskEntries = Array.isArray(result?.tasks) ? result.tasks : [];
      const resolvedKeys = new Set();

      for (const entry of taskEntries) {
        const task = entry?.task;
        const payload = buildInstallPayloadFromTask(task);
        const key = String(task?.key || getInstallKey(payload)).trim();
        if (!task?.id || !key) {
          continue;
        }
        resolvedKeys.add(key);
        setInstallTask(task, key);
        updateBulkFixBatchTask(task, key);
        startInstallTaskPolling(task, payload, { key, bulkFix: true }).catch(() => {});
      }

      const skippedEntries = Array.isArray(result?.skipped) ? result.skipped : [];
      for (const skipped of skippedEntries) {
        const key = getInstallKey(skipped);
        resolvedKeys.add(key);
        addBulkFixSkipped(skipped);
        setInstallTask(createInstallTaskDraft(skipped, {
          status: 'error',
          error: String(skipped?.error || '创建安装任务失败').trim(),
          finishedAt: new Date().toISOString(),
        }), key);
      }

      for (const item of selectedItems) {
        const payload = buildInstallPayload(item);
        const key = getInstallKey(payload);
        if (!resolvedKeys.has(key) && !precheckFailures.some(failed => getInstallKey(failed) === key)) {
          setInstallTask(null, key);
        }
      }

      await refreshInstallHistory().catch(() => {});
      rerenderDependencyViews();

      const created = Number(result?.createdCount || 0);
      const reused = Number(result?.reusedCount || 0);
      const skipped = Number(result?.skippedCount || 0);
      const limitedText = result?.limited ? '，已达到单次上限 80 个' : '';
      setRefreshStatus(`已创建 ${formatNumber(created)} 个安装任务，复用 ${formatNumber(reused)} 个，跳过 ${formatNumber(skipped)} 个${limitedText}`, skipped > 0 ? 'error' : 'neutral');
      setBulkFixStatusFromBatch();
      return result;
    } catch (error) {
      setRefreshStatus(`一键修复启动失败：${error.message}`, 'error');
      rerenderDependencyViews();
      throw error;
    } finally {
      state.bulkFixPromise = null;
      setBulkFixButtonState(false);
      renderBulkFixPanel(state.report);
    }
  })();

  return state.bulkFixPromise;
}

function handleInstallButtonClick(button) {
  const payload = {
    scope: button.dataset.scope || 'current',
    pluginId: button.dataset.pluginId || '',
    dependencyType: button.dataset.dependencyType || '',
    name: button.dataset.name || '',
    declaredVersion: button.dataset.declaredVersion || '',
  };
  return installDependency(payload);
}
