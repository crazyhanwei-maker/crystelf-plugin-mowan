(() => {
if (!document.getElementById('plugin-catalog-list')) {
  return;
}

const pluginCatalogState = {
  payload: null,
  selectedId: '',
  loading: false,
  installingIds: new Set(),
  taskPollers: new Map(),
  selectedInstallCatalogId: '',
  tasks: [],
};
const consoleUi = window.CrystelfUi || {};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: Number.isInteger(number) ? 0 : 2,
  }).format(number);
}

function formatTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function trimText(value = '', maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function clipText(value = '', maxLength = 160) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function renderEmptyState(title, detail = '') {
  return consoleUi.renderEmptyState
    ? consoleUi.renderEmptyState(title, detail)
    : `<div class="list-item">${escapeHtml(title)}</div>`;
}

function createDebouncedTask(fn, delay = 140) {
  if (typeof consoleUi.debounce === 'function') {
    return consoleUi.debounce(fn, delay);
  }
  let timer = null;
  const task = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
  task.cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  return task;
}

function setContainerState(containerId, kind, title, detail = '') {
  if (consoleUi.setState) {
    consoleUi.setState(containerId, { kind, title, detail });
    return;
  }
  const target = $(containerId);
  if (target) {
    target.innerHTML = `<div class="list-item">${escapeHtml(title)}</div>`;
  }
}

function getRepoName(repo = '', fallback = '') {
  const raw = String(repo || '').trim();
  let text = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      text = new URL(raw).pathname;
    }
  } catch {
    text = raw;
  }
  text = String(text || '').replace(/[?#].*$/g, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const last = text.split(/[/:]/).filter(Boolean).pop();
  return String(last || fallback || '').trim();
}

function normalizePluginDirectoryName(value = '', fallback = '') {
  for (const candidate of [value, fallback]) {
    const normalized = String(candidate || '')
      .trim()
      .replace(/\.git$/i, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 80);
    if (normalized && /[A-Za-z0-9]/.test(normalized)) {
      return normalized;
    }
  }
  return '';
}

function getCatalogDefaultDirectoryName(item = {}) {
  return normalizePluginDirectoryName(
    item.defaultDirectoryName || item.installState?.defaultDirectoryName || getRepoName(item.repo || ''),
    item.localState?.directoryName || item.id || item.name || '',
  );
}

function setStatus(text, tone = 'neutral') {
  const el = $('plugin-catalog-status');
  if (!el) return;
  el.textContent = text;
  el.className = tone === 'error' ? 'setting-error' : 'setting-help';
}

function setMeta(text) {
  const el = $('plugin-catalog-meta');
  if (el) el.textContent = text;
}

function setInstallPanelVisible(visible) {
  $('plugin-catalog-install-panel')?.classList.toggle('hidden', !visible);
}

function setInstallHint(text) {
  const el = $('plugin-catalog-install-hint');
  if (el) el.textContent = text;
}

function getInstallDirectoryName() {
  const item = getSelectedCatalogItem();
  return normalizePluginDirectoryName(
    $('plugin-catalog-install-directory')?.value || '',
    getCatalogDefaultDirectoryName(item || {}),
  );
}

function getInstallDependencies() {
  return String($('plugin-catalog-install-deps')?.value || 'false').trim() === 'true';
}

function getSelectedCatalogItem() {
  const items = Array.isArray(pluginCatalogState.payload?.items) ? pluginCatalogState.payload.items : [];
  return items.find(entry => entry.id === pluginCatalogState.selectedId) || null;
}

function buildPluginInstallConfirmMessage(item = {}, options = {}) {
  const directoryName = options.directoryName || getCatalogDefaultDirectoryName(item) || '-';
  const targetDir = `plugins/${directoryName}`;
  const installDependencies = options.installDependencies === true;
  const lines = [
    '插件安装预检已完成。',
    `插件：${item.name || item.id || '-'}`,
    `仓库：${item.repo || '-'}`,
    `目标目录：${targetDir}`,
    `克隆命令：git clone --depth=1 ${item.repo || '-'} ${targetDir}`,
    '',
    '安全确认：',
    '- 控制台不会删除 node_modules，不会清理已有插件目录。',
    '- 目标目录必须是 plugins 下的直接新目录，已存在会被后端拒绝。',
    '- 默认只克隆仓库；只有你开启“安装依赖”才会执行包管理器命令。',
  ];

  if (installDependencies) {
    lines.push(
      '',
      '依赖安装已开启：',
      `- 将在 ${targetDir} 执行 npm install --ignore-scripts`,
      '- 该命令可能修改新插件目录内的 package-lock.json 和 node_modules。',
    );
  } else {
    lines.push('', '依赖安装：关闭，本次不会执行 npm install。');
  }

  lines.push('', '确认创建插件安装任务？');
  return lines.join('\n');
}

function syncInstallSelection(item = null) {
  if (!item) {
    pluginCatalogState.selectedInstallCatalogId = '';
    setInstallPanelState(null);
    return;
  }
  if (pluginCatalogState.selectedInstallCatalogId !== item.id) {
    pluginCatalogState.selectedInstallCatalogId = item.id || '';
    setInstallDefaults(item);
  }
  setInstallPanelState(item);
}

function setInstallDefaults(item = {}) {
  const directoryInput = $('plugin-catalog-install-directory');
  const depsSelect = $('plugin-catalog-install-deps');
  if (directoryInput) {
    directoryInput.value = getCatalogDefaultDirectoryName(item);
  }
  if (depsSelect) {
    depsSelect.value = 'false';
  }
}

function setInstallDefaultsFromTask(task = {}, item = null) {
  const directoryInput = $('plugin-catalog-install-directory');
  const depsSelect = $('plugin-catalog-install-deps');
  if (directoryInput) {
    directoryInput.value = normalizePluginDirectoryName(task.directoryName, getCatalogDefaultDirectoryName(item || {}));
  }
  if (depsSelect) {
    depsSelect.value = task.installDependencies === false ? 'false' : 'true';
  }
}

function setInstallPanelState(item = null) {
  const panel = $('plugin-catalog-install-panel');
  const installButton = $('plugin-catalog-install-btn');
  const resetButton = $('plugin-catalog-install-reset-btn');
  if (!panel || !installButton || !resetButton) return;

  const visible = Boolean(item);
  panel.classList.toggle('hidden', !visible);
  if (!item) {
    installButton.disabled = true;
    installButton.textContent = '安装当前插件';
    resetButton.disabled = true;
    setInstallHint('选择左侧目录项后可执行安装。');
    return;
  }

  const local = item.localState || {};
  const supported = item.installState?.supported === true;
  const running = pluginCatalogState.installingIds.has(item.id);
  const canInstall = supported && !local.installed && !running;
  installButton.disabled = !canInstall;
  installButton.textContent = local.installed
    ? '已安装'
    : running
      ? '安装中...'
      : supported
        ? '安装当前插件'
        : '无法自动安装';
  resetButton.disabled = running;
  if (local.installed) {
    setInstallHint('该插件已安装。若要重新安装，请先删除本地目录。');
  } else if (running) {
    setInstallHint('该插件安装任务正在执行中。');
  } else if (supported) {
    const directoryName = getInstallDirectoryName() || getCatalogDefaultDirectoryName(item) || '-';
    setInstallHint(`将安装到 plugins/${directoryName}。`);
  } else {
    setInstallHint('该目录项缺少仓库地址，无法自动安装。');
  }
}

function setRefreshState(loading) {
  pluginCatalogState.loading = loading;
  const button = $('plugin-catalog-refresh-btn');
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? '加载中...' : '刷新目录';
}

async function fetchJson(url, options = {}) {
  if (window.CrystelfRequest?.fetchJson) {
    return await window.CrystelfRequest.fetchJson(url, options);
  }
  const response = await fetch(url, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `${url} -> ${response.status}`);
  }
  return data;
}

async function postJson(url, body = {}) {
  if (window.CrystelfRequest?.postJson) {
    return await window.CrystelfRequest.postJson(url, body);
  }
  const headers = { 'Content-Type': 'application/json' };
  if (window.CrystelfAuth?.getCsrfToken) {
    headers['X-Crystelf-CSRF'] = window.CrystelfAuth.getCsrfToken();
  }
  return fetchJson(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function getSearchQuery() {
  return String($('plugin-catalog-list-search')?.value || $('plugin-catalog-search')?.value || '').trim().toLowerCase();
}

function syncSearchInputs(sourceId = '') {
  const source = sourceId ? $(sourceId) : null;
  const value = source ? String(source.value || '') : String($('plugin-catalog-search')?.value || $('plugin-catalog-list-search')?.value || '');
  ['plugin-catalog-search', 'plugin-catalog-list-search'].forEach(id => {
    const input = $(id);
    if (input && input !== source) input.value = value;
  });
}

function getCategoryFilter() {
  return String($('plugin-catalog-category-filter')?.value || 'all').trim();
}

function getStateFilter() {
  return String($('plugin-catalog-state-filter')?.value || 'all').trim();
}

function getTaskStatusLabel(status = '') {
  if (status === 'pending') return '排队中';
  if (status === 'running') return '安装中';
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  return status || '未知';
}

function getTaskTone(status = '') {
  if (status === 'success') return 'success';
  if (status === 'error') return 'error';
  if (status === 'running' || status === 'pending') return 'neutral';
  return 'neutral';
}

function getItemTone(item = {}) {
  if (item.localState?.installed) return 'success';
  if (!item.installState?.supported) return 'neutral';
  return 'neutral';
}

function getItemStateLabel(item = {}) {
  if (item.localState?.installed) return '已安装';
  if (item.installState?.supported) return '未安装';
  return '仅查看';
}

function getFilteredItems() {
  const items = Array.isArray(pluginCatalogState.payload?.items)
    ? pluginCatalogState.payload.items
    : [];
  const query = getSearchQuery();
  const category = getCategoryFilter();
  const state = getStateFilter();
  return items.filter(item => {
    if (category !== 'all' && item.category !== category) return false;
    if (state === 'installed' && item.localState?.installed !== true) return false;
    if (state === 'not-installed' && item.localState?.installed === true) return false;
    if (state === 'installable' && item.installState?.supported !== true) return false;
    if (!query) return true;
    return [
      item.name,
      item.category,
      item.description,
      item.repo,
      item.sourceUrl,
      item.readmeUrl,
      ...(Array.isArray(item.tags) ? item.tags : []),
    ].some(value => String(value || '').toLowerCase().includes(query));
  });
}

function renderSummary(payload) {
  const summary = payload?.summary || {};
  const cards = [
    ['目录总数', summary.total, '当前目录中的插件条目数量'],
    ['已安装', summary.installed, '和本地 plugins 目录匹配的条目'],
    ['可自动安装', summary.installable, '带仓库地址的目录条目'],
    ['分类数量', summary.categories, '按目录来源分类统计'],
  ];
  const target = $('plugin-catalog-summary');
  if (!target) return;
  target.innerHTML = cards.map(([label, value, note]) => `
    <div class="card bot-plugin-summary-card">
      <h3>${escapeHtml(label)}</h3>
      <div class="value">${escapeHtml(formatNumber(value || 0))}</div>
      <div class="setting-help">${escapeHtml(note)}</div>
    </div>
  `).join('');
}

function renderCategoryFilter(payload) {
  const select = $('plugin-catalog-category-filter');
  if (!select) return;
  const current = select.value || 'all';
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];
  select.innerHTML = [
    '<option value="all">全部分类</option>',
    ...categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`),
  ].join('');
  select.value = categories.includes(current) ? current : 'all';
}

function renderItemCard(item) {
  const selected = String(item.id || '') === String(pluginCatalogState.selectedId || '');
  const tone = getItemTone(item);
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const taskRunning = pluginCatalogState.installingIds.has(item.id);
  return `
    <button
      type="button"
      class="list-item bot-plugin-card tone-${tone}${selected ? ' is-selected' : ''}"
      data-catalog-id="${escapeHtml(item.id || '')}"
    >
      <div class="bot-plugin-card-head">
        <div>
          <h3>${escapeHtml(item.name || '-')}</h3>
          <div class="bot-plugin-card-path">${escapeHtml(item.repo || item.sourceUrl || '-')}</div>
        </div>
        <div class="detail-tags">
          <span class="detail-tag">${escapeHtml(item.category || '未分类')}</span>
          <span class="detail-tag tone-${item.localState?.installed ? 'success' : 'neutral'}">${escapeHtml(getItemStateLabel(item))}</span>
          ${taskRunning ? '<span class="detail-tag">任务中</span>' : ''}
        </div>
      </div>
      <div class="bot-plugin-card-desc">${escapeHtml(trimText(item.description || '暂无简介', 120))}</div>
      <div class="bot-plugin-card-meta">
        <span>目录 ID：${escapeHtml(item.id || '-')}</span>
        <span>标签：${escapeHtml(tags.length > 0 ? tags.join(' / ') : '-')}</span>
        <span>本地：${escapeHtml(item.localState?.relativePath || '未安装')}</span>
      </div>
    </button>
  `;
}

function renderList() {
  const target = $('plugin-catalog-list');
  const meta = $('plugin-catalog-list-meta');
  if (!target || !meta) return;
  const items = getFilteredItems();
  const allItems = Array.isArray(pluginCatalogState.payload?.items) ? pluginCatalogState.payload.items : [];
  const total = allItems.length;
  if (!pluginCatalogState.selectedId || !items.some(item => item.id === pluginCatalogState.selectedId)) {
    pluginCatalogState.selectedId = items[0]?.id || '';
  }
  meta.textContent = `显示 ${formatNumber(items.length)} / ${formatNumber(total)} 个目录项`;
  target.innerHTML = items.length > 0
    ? items.map(item => renderItemCard(item)).join('')
    : renderEmptyState('没有匹配的插件目录项', '可以清空筛选，或调整插件名、分类、安装状态等条件。');
  renderDetail();
}

const scheduleCatalogListRender = createDebouncedTask(() => {
  renderList();
}, 140);

function renderKv(label, value) {
  return `
    <div class="kv-item">
      <div class="kv-label">${escapeHtml(label)}</div>
      <div class="kv-value">${escapeHtml(value || '-')}</div>
    </div>
  `;
}

function renderDetail() {
  const target = $('plugin-catalog-detail');
  if (!target) return;
  const item = getSelectedCatalogItem();
  if (!item) {
    target.innerHTML = renderEmptyState('选择左侧插件查看详情', '插件仓库、安装状态、依赖摘要会显示在这里。');
    syncInstallSelection(null);
    return;
  }

  syncInstallSelection(item);

  const local = item.localState || {};
  const install = item.installState || {};
  const deps = item.dependencySummary || {};
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const installTarget = getInstallDirectoryName() || getCatalogDefaultDirectoryName(item);

  target.innerHTML = `
    <div class="bot-plugin-detail plugin-catalog-detail">
      <div class="bot-plugin-detail-head">
        <div>
          <h3>${escapeHtml(item.name || '-')}</h3>
          <div class="setting-help">${escapeHtml(item.description || '暂无简介')}</div>
        </div>
        <div class="detail-tags">
          <span class="detail-tag">${escapeHtml(item.category || '未分类')}</span>
          <span class="detail-tag tone-${local.installed ? 'success' : 'neutral'}">${escapeHtml(getItemStateLabel(item))}</span>
        </div>
      </div>

      ${install.reason ? `<div class="setting-help">${escapeHtml(install.reason)}</div>` : ''}
      <div class="setting-help">目标目录：${escapeHtml(installTarget || '-')}，依赖安装：${escapeHtml(getInstallDependencies() ? '开启' : '关闭')}</div>
      <div class="actions bot-plugin-detail-actions">
        ${item.repo ? `<a class="link-btn" href="${escapeHtml(item.repo)}" target="_blank" rel="noopener">打开仓库</a>` : ''}
        ${item.readmeUrl ? `<a class="link-btn" href="${escapeHtml(item.readmeUrl)}" target="_blank" rel="noopener">README</a>` : ''}
        ${local.relativePath ? `<a class="link-btn" href="/file-browser.html?path=${encodeURIComponent(local.relativePath)}">打开本地位置</a>` : ''}
      </div>

      <div class="kv-grid bot-plugin-detail-grid">
        ${renderKv('目录 ID', item.id)}
        ${renderKv('仓库', item.repo)}
        ${renderKv('来源', item.sourceUrl)}
        ${renderKv('安装方式', item.installType)}
        ${renderKv('标签', tags.length > 0 ? tags.join(' / ') : '-')}
        ${renderKv('本地目录', local.relativePath || '未安装')}
        ${renderKv('本地版本', local.version || '未声明')}
        ${renderKv('Git 状态', local.gitStatus || '-')}
        ${renderKv('依赖问题', deps ? `${formatNumber(deps.problemCount || 0)} / ${formatNumber(deps.total || 0)}` : '-')}
        ${renderKv('可修复依赖', deps ? formatNumber(deps.installableCount || 0) : '-')}
      </div>
    </div>
  `;
}

function renderTasks(tasks = []) {
  const meta = $('plugin-catalog-task-meta');
  const list = $('plugin-catalog-task-list');
  if (!meta || !list) return;
  pluginCatalogState.tasks = Array.isArray(tasks) ? tasks : [];
  const running = tasks.filter(task => task.status !== 'success' && task.status !== 'error');
  meta.textContent = running.length > 0
    ? `当前 ${formatNumber(running.length)} 个插件安装任务进行中`
    : '当前无进行中的插件安装任务。';
  list.innerHTML = tasks.length > 0
    ? tasks.map(task => `
      <div class="list-item tone-${getTaskTone(task.status)} plugin-catalog-task-card">
        <div class="bot-plugin-card-head">
          <div>
            <h3>${escapeHtml(task.pluginName || task.catalogId || '-')}</h3>
            <div class="bot-plugin-card-path">${escapeHtml(task.targetDir || '-')}</div>
          </div>
          <div class="detail-tags">
            <span class="detail-tag tone-${getTaskTone(task.status)}">${escapeHtml(getTaskStatusLabel(task.status))}</span>
            ${task.timedOut ? '<span class="detail-tag">超时</span>' : ''}
          </div>
        </div>
        <div class="plugin-catalog-task-meta-line">阶段：${escapeHtml(task.stage || '-')} · 依赖：${escapeHtml(task.installDependencies ? '开启' : '关闭')}</div>
        ${task.command?.length ? `<div class="plugin-catalog-task-command">${escapeHtml(task.command.join(' '))}</div>` : ''}
        ${task.error ? `<div class="setting-error">${escapeHtml(trimText(task.error, 220))}</div>` : ''}
        <div class="plugin-catalog-task-log">
        ${task.stdoutTail ? `<div class="plugin-catalog-task-log-block"><span>stdout</span><pre>${escapeHtml(clipText(task.stdoutTail, 800))}</pre></div>` : ''}
        ${task.stderrTail ? `<div class="plugin-catalog-task-log-block"><span>stderr</span><pre>${escapeHtml(clipText(task.stderrTail, 800))}</pre></div>` : ''}
        </div>
        <div class="plugin-catalog-task-actions actions">
          <small>创建：${escapeHtml(formatTime(task.createdAt))}${task.finishedAt ? ` · 完成：${escapeHtml(formatTime(task.finishedAt))}` : ''}</small>
          ${task.status === 'error' && task.catalogId ? `<button type="button" class="mini-btn" data-plugin-catalog-retry="${escapeHtml(task.catalogId)}">重试</button>` : ''}
        </div>
      </div>
    `).join('')
    : renderEmptyState('暂无插件安装任务', '从插件目录创建安装任务后，执行进度和最近日志会显示在这里。');
}

function renderPayload(payload) {
  pluginCatalogState.payload = payload;
  renderSummary(payload);
  renderCategoryFilter(payload);
  renderList();
  const summary = payload?.summary || {};
  const source = payload?.sourceState || {};
  const sourceText = source.remoteLoaded
    ? `远程索引 ${formatNumber(source.remoteCount || 0)} 项`
    : source.remoteError
      ? `远程索引不可用：${source.remoteError}`
      : '使用本地目录';
  setMeta(`目录 ${formatNumber(summary.total || 0)} 个，已安装 ${formatNumber(summary.installed || 0)} 个，可自动安装 ${formatNumber(summary.installable || 0)} 个；${sourceText}`);
}

async function refreshTasks() {
  try {
    const payload = await fetchJson('/api/plugin-catalog/install-tasks?limit=12');
    const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
    pluginCatalogState.tasks = tasks;
    pluginCatalogState.installingIds = new Set(
      tasks
        .filter(task => task.status !== 'success' && task.status !== 'error')
        .map(task => task.catalogId)
        .filter(Boolean)
    );
    renderTasks(tasks);
    renderList();
  } catch {
    pluginCatalogState.installingIds = new Set();
    renderTasks([]);
  }
}

function pollTask(taskId = '') {
  if (!taskId || pluginCatalogState.taskPollers.has(taskId)) return;
  const poller = setInterval(async () => {
    try {
      const payload = await fetchJson(`/api/plugin-catalog/install-status?taskId=${encodeURIComponent(taskId)}`);
      const task = payload?.task || {};
      if (task.status === 'success' || task.status === 'error') {
        clearInterval(poller);
        pluginCatalogState.taskPollers.delete(taskId);
        await refreshTasks();
        await refreshCatalog();
      } else {
        await refreshTasks();
      }
    } catch {
      clearInterval(poller);
      pluginCatalogState.taskPollers.delete(taskId);
      await refreshTasks();
    }
  }, 2000);
  pluginCatalogState.taskPollers.set(taskId, poller);
}

async function installCatalogItem(catalogId = '') {
  if (!catalogId) return;
  const item = (pluginCatalogState.payload?.items || []).find(entry => entry.id === catalogId);
  if (!item || item.localState?.installed || !item.installState?.supported) return;
  setStatus(`正在创建安装任务：${item.name || catalogId}`, 'neutral');
  try {
    const directoryName = getInstallDirectoryName() || getCatalogDefaultDirectoryName(item);
    const installDependencies = getInstallDependencies();
    const confirmed = await webConsoleConfirm(buildPluginInstallConfirmMessage(item, {
      directoryName,
      installDependencies,
    }), {
      title: '确认安装插件',
      confirmText: '确认安装',
      cancelText: '取消',
    });
    if (!confirmed) {
      setStatus('已取消插件安装，未创建任务。', 'neutral');
      return;
    }

    const payload = await postJson('/api/plugin-catalog/install', {
      catalogId,
      directoryName,
      installDependencies,
      confirmed: true,
    });
    const task = payload?.task || {};
    if (task.catalogId) pluginCatalogState.installingIds.add(task.catalogId);
    setStatus(`插件安装任务已创建：${item.name || catalogId}`, 'neutral');
    syncInstallSelection(item);
    renderList();
    await refreshTasks();
    pollTask(task.id);
  } catch (error) {
    setStatus(`插件安装任务创建失败：${error.message}`, 'error');
  }
}

async function refreshCatalog() {
  if (pluginCatalogState.loading) return;
  setRefreshState(true);
  setStatus('正在读取插件目录...', 'neutral');
  setContainerState('plugin-catalog-list', 'loading', '正在读取插件目录...', '目录返回后会自动更新列表。');
  setContainerState('plugin-catalog-detail', 'loading', '正在等待目录数据...', '选择目录项后会显示安装详情。');
  try {
    const payload = await fetchJson('/api/plugin-catalog');
    renderPayload(payload);
    const source = payload?.sourceState || {};
    const sourceText = source.remoteLoaded
      ? `远程索引已加载 ${formatNumber(source.remoteCount || 0)} 项`
      : source.remoteError
        ? `远程索引不可用，当前使用本地目录：${source.remoteError}`
        : '当前使用本地目录';
    setStatus(`最近更新：${formatTime(payload.generatedAt)}，${sourceText}`, source.remoteError && !source.remoteLoaded ? 'error' : 'neutral');
  } catch (error) {
    setMeta('插件目录加载失败');
    setStatus(`插件目录加载失败：${error.message}`, 'error');
    setContainerState('plugin-catalog-list', 'error', '插件目录加载失败', error.message);
    setContainerState('plugin-catalog-detail', 'error', '插件目录详情暂时不可用', error.message);
  } finally {
    setRefreshState(false);
  }
}

function bindEvents() {
  $('plugin-catalog-refresh-btn')?.addEventListener('click', () => {
    refreshCatalog();
    refreshTasks();
  });
  $('plugin-catalog-search')?.addEventListener('input', () => {
    syncSearchInputs('plugin-catalog-search');
    scheduleCatalogListRender();
  });
  $('plugin-catalog-list-search')?.addEventListener('input', () => {
    syncSearchInputs('plugin-catalog-list-search');
    scheduleCatalogListRender();
  });
  $('plugin-catalog-category-filter')?.addEventListener('change', () => {
    scheduleCatalogListRender.cancel?.();
    renderList();
  });
  $('plugin-catalog-state-filter')?.addEventListener('change', () => {
    scheduleCatalogListRender.cancel?.();
    renderList();
  });
  $('plugin-catalog-clear-filter-btn')?.addEventListener('click', () => {
    if ($('plugin-catalog-search')) $('plugin-catalog-search').value = '';
    if ($('plugin-catalog-list-search')) $('plugin-catalog-list-search').value = '';
    if ($('plugin-catalog-category-filter')) $('plugin-catalog-category-filter').value = 'all';
    if ($('plugin-catalog-state-filter')) $('plugin-catalog-state-filter').value = 'all';
    scheduleCatalogListRender.cancel?.();
    renderList();
  });
  $('plugin-catalog-list-clear-btn')?.addEventListener('click', () => {
    if ($('plugin-catalog-search')) $('plugin-catalog-search').value = '';
    if ($('plugin-catalog-list-search')) $('plugin-catalog-list-search').value = '';
    scheduleCatalogListRender.cancel?.();
    renderList();
  });
  $('plugin-catalog-install-directory')?.addEventListener('input', () => {
    const item = getSelectedCatalogItem();
    if (item) setInstallPanelState(item);
  });
  $('plugin-catalog-install-deps')?.addEventListener('change', () => {
    const item = getSelectedCatalogItem();
    if (item) setInstallPanelState(item);
  });
  $('plugin-catalog-install-btn')?.addEventListener('click', () => {
    const item = getSelectedCatalogItem();
    if (item) installCatalogItem(item.id);
  });
  $('plugin-catalog-install-reset-btn')?.addEventListener('click', () => {
    const item = getSelectedCatalogItem();
    if (!item) return;
    setInstallDefaults(item);
    setInstallPanelState(item);
  });
  $('plugin-catalog-list')?.addEventListener('click', event => {
    const card = event.target.closest('[data-catalog-id]');
    if (!card) return;
    pluginCatalogState.selectedId = card.dataset.catalogId || '';
    scheduleCatalogListRender.cancel?.();
    renderList();
  });
  $('plugin-catalog-task-list')?.addEventListener('click', event => {
    const button = event.target.closest('[data-plugin-catalog-retry]');
    if (!button) return;
    const catalogId = button.dataset.pluginCatalogRetry || '';
    const task = (pluginCatalogState.tasks || []).find(entry => entry.catalogId === catalogId && entry.status === 'error') || null;
    const item = (pluginCatalogState.payload?.items || []).find(entry => entry.id === catalogId) || null;
    if (task) setInstallDefaultsFromTask(task, item);
    if (item) {
      pluginCatalogState.selectedInstallCatalogId = item.id || '';
    }
    installCatalogItem(catalogId);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  refreshCatalog();
  refreshTasks();
});

window.CrystelfPluginCatalog = {
  refreshCatalog,
  refreshTasks,
  installCatalogItem,
};
})();
