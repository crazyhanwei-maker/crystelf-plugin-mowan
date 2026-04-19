const state = {
  report: null,
  refreshPromise: null,
  historyPromise: null,
  installingKeys: new Set(),
  installTasks: new Map(),
  installHistory: [],
  installPollers: new Map(),
  restorePromise: null,
};

function getAuthToken() {
  return localStorage.getItem('crystelf-web-console-token') || '';
}

function buildHeaders(extra = {}) {
  const token = getAuthToken().trim();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

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

function setRefreshButtonState(isRefreshing) {
  const button = document.getElementById('refresh-btn');
  if (!button) return;
  button.disabled = isRefreshing;
  button.textContent = isRefreshing ? '重新扫描中...' : '重新扫描依赖';
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: buildHeaders(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${url} -> ${response.status}`);
  }
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: buildHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${url} -> ${response.status}`);
  }
  return data;
}

function setRefreshStatus(text, tone = 'neutral') {
  const el = document.getElementById('refresh-status');
  if (!el) return;
  el.textContent = text;
  el.className = tone === 'error' ? 'setting-error' : 'setting-help';
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
    ...overrides,
  };
}

function buildInstallTaskError(task) {
  return trimText(task?.error || task?.stderrTail || task?.stdoutTail || '安装失败', 160);
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

function renderActiveInstallTaskCard(task) {
  const tone = task.status === 'running' ? 'success' : 'neutral';
  const output = trimText(task.stderrTail || task.stdoutTail, 260);
  const metaLines = [
    `状态：${formatInstallTaskStatus(task.status)}`,
    task.packageManager ? `包管理器：${task.packageManager}` : '',
    task.targetDir ? `目标目录：${task.targetDir}` : '',
    task.startedAt ? `开始时间：${formatTime(task.startedAt)}` : task.createdAt ? `创建时间：${formatTime(task.createdAt)}` : '',
  ].filter(Boolean);

  return `
    <div class="list-item tone-${tone} dependency-active-item">
      <h3>${escapeHtml(task.name || '-')}</h3>
      <div class="dependency-active-meta">
        ${metaLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
      </div>
      ${output ? `<pre class="dependency-active-output">${escapeHtml(output)}</pre>` : ''}
    </div>
  `;
}

function renderActiveInstallTasks() {
  const summary = document.getElementById('active-install-summary');
  const list = document.getElementById('active-install-list');
  if (!summary || !list) {
    return;
  }

  const tasks = getActiveInstallTasks();
  if (tasks.length <= 0) {
    summary.textContent = '当前无进行中的安装任务';
    list.innerHTML = '';
    return;
  }

  summary.textContent = `当前 ${formatNumber(tasks.length)} 个安装任务进行中`;
  list.innerHTML = tasks.map(task => renderActiveInstallTaskCard(task)).join('');
}

function renderInstallHistoryCard(task) {
  const tone = task.status === 'success' ? 'success' : 'error';
  const summaryText = task.status === 'success'
    ? '安装完成'
    : buildInstallTaskError(task);
  const metaLines = [
    `状态：${formatInstallTaskStatus(task.status)}`,
    task.packageManager ? `包管理器：${task.packageManager}` : '',
    task.targetDir ? `目标目录：${task.targetDir}` : '',
    task.finishedAt ? `结束时间：${formatTime(task.finishedAt)}` : task.createdAt ? `创建时间：${formatTime(task.createdAt)}` : '',
  ].filter(Boolean);

  return `
    <div class="list-item tone-${tone} dependency-active-item">
      <h3>${escapeHtml(task.name || '-')}</h3>
      <div class="dependency-active-meta">
        ${metaLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
      </div>
      <div class="setting-help dependency-item-help">${escapeHtml(summaryText)}</div>
      ${renderInstallTaskDetails(task)}
    </div>
  `;
}

function renderInstallHistory() {
  const summary = document.getElementById('install-history-summary');
  const list = document.getElementById('install-history-list');
  if (!summary || !list) {
    return;
  }

  const sourceTasks = Array.isArray(state.installHistory) ? state.installHistory : [];
  const query = getInstallHistoryQuery();
  const statusFilter = getInstallHistoryStatus();
  const tasks = sourceTasks.filter(task => {
    if (statusFilter !== 'all' && task?.status !== statusFilter) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      task?.name,
      task?.pluginId,
      task?.targetDir,
      task?.packageManager,
      task?.error,
      task?.stdoutTail,
      task?.stderrTail,
      Array.isArray(task?.command) ? task.command.join(' ') : '',
    ].some(value => String(value || '').toLowerCase().includes(query));
  });

  if (sourceTasks.length <= 0) {
    summary.textContent = '最近暂无安装记录';
    list.innerHTML = '';
    return;
  }

  summary.textContent = query || statusFilter !== 'all'
    ? `已筛出 ${formatNumber(tasks.length)} / ${formatNumber(sourceTasks.length)} 条记录`
    : `最近记录 ${formatNumber(tasks.length)} 条`;
  list.innerHTML = tasks.length > 0
    ? tasks.map(task => renderInstallHistoryCard(task)).join('')
    : `<div class="list-item">没有匹配的安装记录</div>`;
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

function renderInstallTaskDetails(task) {
  if (!task) {
    return '';
  }

  const commandText = Array.isArray(task.command) ? task.command.join(' ') : '';
  const outputBlocks = [task.stderrTail, task.stdoutTail].filter(Boolean);
  const metaLines = [
    task.packageManager ? `包管理器：${task.packageManager}` : '',
    commandText ? `命令：${commandText}` : '',
    task.targetDir ? `目标目录：${task.targetDir}` : '',
    task.createdAt ? `创建时间：${formatTime(task.createdAt)}` : '',
    task.startedAt ? `开始时间：${formatTime(task.startedAt)}` : '',
    task.finishedAt ? `结束时间：${formatTime(task.finishedAt)}` : '',
    task.timedOut ? '执行结果：已超时' : '',
    task.error ? `错误信息：${task.error}` : '',
  ].filter(Boolean);

  if (metaLines.length <= 0 && outputBlocks.length <= 0) {
    return '';
  }

  const title = task.status === 'error' ? '查看失败详情' : '查看任务详情';
  return `
    <details class="dependency-task-details"${task.status === 'error' ? ' open' : ''}>
      <summary class="dependency-task-summary">${escapeHtml(title)}</summary>
      <div class="dependency-task-meta">
        ${metaLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
      </div>
      ${outputBlocks.length > 0 ? `<pre class="dependency-task-log">${escapeHtml(outputBlocks.join('\n\n'))}</pre>` : ''}
    </details>
  `;
}

async function pollInstallTask(taskId, payload, options = {}) {
  const key = String(options.key || getInstallKey(payload)).trim();
  const taskName = payload?.name || '依赖';

  while (true) {
    try {
      const result = await fetchJson(`/api/dependencies/install-status?taskId=${encodeURIComponent(taskId)}`);
      const task = setInstallTask(result.task, key);
      rerenderDependencyViews();

      if (task?.status === 'pending') {
        setRefreshStatus(`安装任务已创建：${taskName}，等待执行...`, 'neutral');
        await sleep(800);
        continue;
      }

      if (task?.status === 'running') {
        const managerText = task.packageManager ? `，包管理器：${task.packageManager}` : '';
        setRefreshStatus(`正在安装 ${taskName}${managerText}...`, 'neutral');
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
        const managerText = task.packageManager ? `，包管理器：${task.packageManager}` : '';
        const targetText = task.targetDir ? `，目标：${task.targetDir}` : '';
        setRefreshStatus(`已完成 ${taskName} 的安装${managerText}${targetText}`, 'neutral');
        return task;
      }

      try {
        await refreshInstallHistory();
      } catch {
      }
      setRefreshStatus(`安装失败：${buildInstallTaskError(task)}`, 'error');
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

function renderSummary(report) {
  const summary = report?.summary || {};
  const statusText = summary.status === 'error' ? '异常' : summary.status === 'warn' ? '警告' : '正常';
  const note = !summary.totalCount
    ? '暂无依赖检查数据。'
    : summary.problemCount > 0
      ? `当前发现 ${summary.problemCount} 项依赖问题，优先处理运行依赖缺失。`
      : '当前依赖完整，未发现缺失或版本偏差。';

  document.getElementById('dependency-summary').innerHTML = [
    '<div class="config-summary-grid">',
    `<div class="config-summary-card"><h3>总体状态</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">状态</span><span class="config-summary-value tone-${summary.status === 'error' ? 'error' : summary.status === 'warn' ? 'error' : 'success'}">${statusText}</span></div><div class="config-summary-row"><span class="config-summary-label">问题数</span><span class="config-summary-value">${formatNumber(summary.problemCount || 0)}</span></div></div></div>`,
    `<div class="config-summary-card"><h3>运行依赖</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">已安装</span><span class="config-summary-value">${formatNumber(summary.runtimeInstalledCount || 0)} / ${formatNumber(summary.runtimeCount || 0)}</span></div><div class="config-summary-row"><span class="config-summary-label">缺失 / 偏差</span><span class="config-summary-value">${formatNumber(summary.runtimeMissingCount || 0)} / ${formatNumber(summary.runtimeMismatchCount || 0)}</span></div></div></div>`,
    `<div class="config-summary-card"><h3>开发依赖</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">已安装</span><span class="config-summary-value">${formatNumber(summary.devInstalledCount || 0)} / ${formatNumber(summary.devCount || 0)}</span></div><div class="config-summary-row"><span class="config-summary-label">缺失 / 偏差</span><span class="config-summary-value">${formatNumber(summary.devMissingCount || 0)} / ${formatNumber(summary.devMismatchCount || 0)}</span></div></div></div>`,
    `<div class="config-summary-card"><h3>检查时间</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">最近一次</span><span class="config-summary-value">${escapeHtml(formatTime(summary.checkedAt))}</span></div><div class="config-summary-row"><span class="config-summary-label">清单 / 锁文件</span><span class="config-summary-value">${summary.manifestExists === false ? '缺清单' : summary.lockfileExists === false ? '缺锁文件' : '完整'}</span></div></div></div>`,
    '</div>',
    `<div class="config-summary-note">${escapeHtml(note)}</div>`,
  ].join('');
}

function renderInstallAction(item) {
  if (!isInstallableItem(item)) {
    return '';
  }

  const payload = buildInstallPayload(item);
  const key = getInstallKey(payload);
  const task = getInstallTask(payload);
  const isInstalling = state.installingKeys.has(key);
  const baseHint = payload.scope === 'plugin'
    ? `安装到插件：${item.pluginName || item.pluginId || '-'}`
    : '安装到当前插件目录';
  const hint = !task
    ? baseHint
    : task.status === 'error'
      ? `${baseHint} · 最近失败：${buildInstallTaskError(task)}`
      : `${baseHint} · 任务状态：${formatInstallTaskStatus(task.status)}${task.packageManager ? ` (${task.packageManager})` : ''}`;
  const buttonText = isInstalling
    ? task?.status === 'pending'
      ? '排队中...'
      : '安装中...'
    : '修复/安装';
  const taskDetails = renderInstallTaskDetails(task);

  return `
    <div class="dependency-item-actions">
      <button
        class="mini-btn feature-manage-btn feature-manage-btn-safe dependency-install-btn"
        data-scope="${escapeHtml(payload.scope)}"
        data-plugin-id="${escapeHtml(payload.pluginId)}"
        data-dependency-type="${escapeHtml(payload.dependencyType)}"
        data-name="${escapeHtml(payload.name)}"
        data-declared-version="${escapeHtml(payload.declaredVersion)}"
        ${isInstalling ? 'disabled' : ''}
      >${buttonText}</button>
      <div class="setting-help dependency-item-help">${escapeHtml(hint)}</div>
    </div>
    ${taskDetails}
  `;
}

function renderDependencyCard(item) {
  const tone = item.level === 'error' ? 'error' : item.level === 'warn' ? 'neutral' : 'success';
  const versionText = item.installed
    ? `声明 ${item.declaredVersion || '-'} / 已装 ${item.installedVersion || '-'}${item.lockVersion ? ` / 锁定 ${item.lockVersion}` : ''}`
    : `声明 ${item.declaredVersion || '-'} / 当前未安装${item.lockVersion ? ` / 锁定 ${item.lockVersion}` : ''}`;

  const details = [
    `<div>${escapeHtml(item.groupLabel || item.dependencyTypeLabel || '-')} · ${escapeHtml(formatDependencyStatus(item.status))}</div>`,
    `<div>${escapeHtml(versionText)}</div>`,
  ];

  if (item.packagePath) {
    details.push(`<div><small>安装路径：${escapeHtml(item.packagePath)}</small></div>`);
  }

  return `
    <div class="list-item tone-${tone}">
      <h3>${escapeHtml(item.name || '-')}</h3>
      <div class="dependency-item-body">
        ${details.join('')}
      </div>
      ${renderInstallAction(item)}
    </div>
  `;
}

function renderItems(targetId, items, emptyText) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = items.length > 0
    ? items.map(item => renderDependencyCard(item)).join('')
    : `<div class="list-item">${escapeHtml(emptyText)}</div>`;
}

function renderOtherPluginDependencies(report) {
  const block = report?.otherPluginDependencies || {};
  const summary = block.summary || {};
  const target = document.getElementById('other-plugin-dependency-list');
  const meta = document.getElementById('other-plugin-dependency-meta');
  if (!target || !meta) return;

  const query = getOtherPluginDependencyQuery();
  const items = Array.isArray(block.items) ? [...block.items] : [];
  const filtered = items
    .filter(item => {
      if (!query) return true;
      return [
        item.pluginName,
        item.pluginId,
        item.pluginDir,
        item.manifestPath,
        item.name,
        item.declaredVersion,
        item.installedVersion,
        item.packagePath,
        item.dependencyTypeLabel,
      ].some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => {
      const typeOrder = { runtime: 0, dev: 1, peer: 2, optional: 3 };
      const pluginCompare = String(a.pluginName || a.pluginId || '').localeCompare(String(b.pluginName || b.pluginId || ''));
      if (pluginCompare !== 0) return pluginCompare;
      const typeCompare = (typeOrder[a.dependencyType] ?? 99) - (typeOrder[b.dependencyType] ?? 99);
      if (typeCompare !== 0) return typeCompare;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

  const grouped = [];
  const groupedMap = new Map();
  for (const item of filtered) {
    const key = String(item.pluginId || item.pluginName || item.pluginDir || '');
    if (!groupedMap.has(key)) {
      const group = {
        key,
        pluginId: item.pluginId || '',
        pluginName: item.pluginName || item.pluginId || '-',
        pluginDir: item.pluginDir || '',
        manifestPath: item.manifestPath || '',
        items: [],
      };
      groupedMap.set(key, group);
      grouped.push(group);
    }
    groupedMap.get(key).items.push(item);
  }

  const matchedPluginCount = grouped.length;
  if (!summary.pluginsDirExists) {
    meta.textContent = '未找到 plugins 目录，当前无法扫描其他插件依赖。';
  } else if (!summary.pluginCount) {
    meta.textContent = '未发现其他带 package.json 的插件。';
  } else if (query) {
    meta.textContent = `已匹配 ${formatNumber(filtered.length)} 条依赖声明，覆盖 ${formatNumber(matchedPluginCount)} 个插件。总扫描 ${formatNumber(summary.pluginCount)} 个其他插件。`;
  } else {
    meta.textContent = `已扫描 ${formatNumber(summary.pluginCount)} 个其他插件，共 ${formatNumber(summary.totalCount)} 条依赖声明。运行依赖 ${formatNumber(summary.runtimeCount)} 条，缺失 ${formatNumber(summary.runtimeMissingCount)} 条。`;
  }

  target.innerHTML = grouped.length > 0
    ? grouped.map(group => {
      const problemCount = group.items.filter(item => item.status !== 'ok').length;
      const runtimeMissingCount = group.items.filter(item => item.dependencyType === 'runtime' && item.status === 'missing').length;
      const tone = runtimeMissingCount > 0 ? 'error' : problemCount > 0 ? 'neutral' : 'success';
      const summaryText = `依赖 ${formatNumber(group.items.length)} 条 · 问题 ${formatNumber(problemCount)} 项 · 运行缺失 ${formatNumber(runtimeMissingCount)} 项`;

      return `
        <section class="other-plugin-group tone-${tone}">
          <div class="other-plugin-group-head">
            <div class="other-plugin-group-title-row">
              <h3>${escapeHtml(group.pluginName)}</h3>
              <span class="tag">${escapeHtml(group.pluginId || 'unknown')}</span>
            </div>
            <div class="other-plugin-group-meta">${escapeHtml(summaryText)}</div>
            <div class="other-plugin-group-meta"><small>插件目录：${escapeHtml(group.pluginDir || '-')}</small></div>
            <div class="other-plugin-group-meta"><small>清单路径：${escapeHtml(group.manifestPath || '-')}</small></div>
          </div>
          <div class="list other-plugin-group-list">
            ${group.items.map(item => renderDependencyCard(item)).join('')}
          </div>
        </section>
      `;
    }).join('')
    : `<div class="list-item">${escapeHtml(query ? '没有匹配的其他插件依赖。' : '暂无其他插件依赖数据。')}</div>`;
}

function renderReport(report) {
  state.report = report;
  const items = Array.isArray(report?.items) ? [...report.items] : [];
  const problemItems = items
    .filter(item => item.status !== 'ok')
    .sort((a, b) => {
      if (a.level !== b.level) {
        return a.level === 'error' ? -1 : 1;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  const allItems = items.sort((a, b) => {
    if (a.group !== b.group) {
      return a.group === 'runtime' ? -1 : 1;
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  renderSummary(report);
  renderActiveInstallTasks();
  renderInstallHistory();
  renderOtherPluginDependencies(report);
  renderItems('dependency-problems', problemItems, '当前没有依赖问题');
  renderItems('dependency-list', allItems, '暂无依赖数据');

  const summary = report?.summary || {};
  setMeta(`状态：${summary.status || 'unknown'}，运行依赖缺失 ${summary.runtimeMissingCount || 0} 个，问题总数 ${summary.problemCount || 0} 项`);
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

async function installDependency(payload) {
  const key = getInstallKey(payload);
  if (!payload?.name || state.installingKeys.has(key)) {
    return;
  }

  setInstallTask(createInstallTaskDraft(payload), key);
  rerenderDependencyViews();
  setRefreshStatus(`正在创建 ${payload.name} 的安装任务...`, 'neutral');

  try {
    const result = await postJson('/api/dependencies/install', payload);
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

document.addEventListener('click', event => {
  const button = event.target.closest('.dependency-install-btn');
  if (!button) {
    return;
  }
  event.preventDefault();
  handleInstallButtonClick(button).catch(() => {});
});

document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('auth-token');
  if (tokenInput) {
    tokenInput.value = getAuthToken();
  }
  setRefreshButtonState(false);
  renderActiveInstallTasks();
  renderInstallHistory();

  document.getElementById('save-token-btn')?.addEventListener('click', () => {
    localStorage.setItem('crystelf-web-console-token', tokenInput?.value.trim() || '');
    Promise.all([refreshDependencies(), refreshInstallHistory()])
      .then(() => restoreActiveInstallTasks())
      .catch(() => {});
  });

  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    Promise.all([refreshDependencies(), refreshInstallHistory()])
      .then(() => restoreActiveInstallTasks())
      .catch(() => {});
  });

  document.getElementById('other-plugin-dependency-search')?.addEventListener('input', () => {
    if (state.report) {
      renderOtherPluginDependencies(state.report);
    }
  });

  document.getElementById('clear-other-plugin-search-btn')?.addEventListener('click', () => {
    const input = document.getElementById('other-plugin-dependency-search');
    if (input) {
      input.value = '';
    }
    if (state.report) {
      renderOtherPluginDependencies(state.report);
    }
  });

  document.getElementById('install-history-search')?.addEventListener('input', () => {
    renderInstallHistory();
  });

  document.getElementById('install-history-status')?.addEventListener('change', () => {
    renderInstallHistory();
  });

  document.getElementById('clear-install-history-search-btn')?.addEventListener('click', () => {
    const searchInput = document.getElementById('install-history-search');
    const statusSelect = document.getElementById('install-history-status');
    if (searchInput) {
      searchInput.value = '';
    }
    if (statusSelect) {
      statusSelect.value = 'all';
    }
    renderInstallHistory();
  });

  document.getElementById('clear-install-history-btn')?.addEventListener('click', () => {
    clearInstallHistory().catch(error => {
      setRefreshStatus(`清空安装记录失败：${error.message}`, 'error');
    });
  });

  Promise.all([refreshDependencies(), refreshInstallHistory()])
    .then(() => restoreActiveInstallTasks())
    .catch(() => {});
});
