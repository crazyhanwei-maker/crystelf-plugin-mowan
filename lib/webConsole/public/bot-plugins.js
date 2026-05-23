(() => {
const botPluginsState = {
  payload: null,
  selectedId: '',
  loading: false,
  activeTab: 'installed-tab',
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

function setStatus(text, tone = 'neutral') {
  const el = $('bot-plugins-status');
  if (!el) return;
  el.textContent = text;
  el.className = tone === 'error' ? 'setting-error' : 'setting-help';
}

function setMeta(text) {
  const el = $('bot-plugins-meta');
  if (el) el.textContent = text;
}

function setRefreshState(loading) {
  botPluginsState.loading = loading;
  const button = $('bot-plugins-refresh-btn');
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? '扫描中...' : '重新扫描';
}

function getInitialTab() {
  const params = new URLSearchParams(window.location.search);
  const tab = String(params.get('tab') || '').trim();
  return tab === 'catalog' ? 'catalog-tab' : 'installed-tab';
}

function syncTabQuery(tabId = '') {
  try {
    const url = new URL(window.location.href);
    if (tabId === 'catalog-tab') {
      url.searchParams.set('tab', 'catalog');
    } else {
      url.searchParams.set('tab', 'installed');
    }
    history.replaceState({}, '', url);
  } catch {
    // Ignore history failures in restricted environments.
  }
}

function switchTopTab(tabId = 'installed-tab') {
  botPluginsState.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.tabTarget === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== tabId);
  });
  syncTabQuery(tabId);
}

async function fetchJson(url) {
  if (window.CrystelfRequest?.fetchJson) {
    return await window.CrystelfRequest.fetchJson(url);
  }
  const response = await fetch(url, { cache: 'no-store' });
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
  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `${url} -> ${response.status}`);
  }
  return data;
}

function getSearchQuery() {
  return String($('bot-plugins-search')?.value || '').trim().toLowerCase();
}

function getTypeFilter() {
  return String($('bot-plugins-type-filter')?.value || 'all').trim();
}

function getGitFilter() {
  return String($('bot-plugins-git-filter')?.value || 'all').trim();
}

function getGitLabel(git = {}) {
  if (!git?.isGit) return '非 Git';
  if (git.status === 'dirty') return `有改动 ${formatNumber(git.dirtyCount || 0)}`;
  return '干净';
}

function getGitTone(git = {}) {
  if (!git?.isGit) return 'neutral';
  if (git.status === 'dirty') return 'error';
  return 'success';
}

function getPluginTone(plugin = {}) {
  if (plugin.isCurrentPlugin) return 'success';
  if (plugin.git?.status === 'dirty') return 'error';
  return 'neutral';
}

function getFilteredPlugins() {
  const plugins = Array.isArray(botPluginsState.payload?.plugins)
    ? botPluginsState.payload.plugins
    : [];
  const query = getSearchQuery();
  const typeFilter = getTypeFilter();
  const gitFilter = getGitFilter();
  return plugins.filter(plugin => {
    if (typeFilter !== 'all' && plugin.type !== typeFilter) return false;
    if (gitFilter === 'git' && plugin.git?.isGit !== true) return false;
    if (gitFilter === 'dirty' && plugin.git?.status !== 'dirty') return false;
    if (gitFilter === 'clean' && plugin.git?.status !== 'clean') return false;
    if (gitFilter === 'none' && plugin.git?.isGit === true) return false;
    if (!query) return true;
    return [
      plugin.name,
      plugin.directoryName,
      plugin.packageName,
      plugin.description,
      plugin.type,
      plugin.version,
      plugin.relativePath,
      plugin.git?.branch,
      plugin.git?.remote,
      plugin.git?.commit,
      plugin.git?.commitMessage,
    ].some(value => String(value || '').toLowerCase().includes(query));
  });
}

function buildFileBrowserUrl(pathValue = '') {
  return `/file-browser.html?path=${encodeURIComponent(pathValue || '')}`;
}

function renderSummary(payload) {
  const summary = payload?.summary || {};
  const cards = [
    ['插件总数', summary.pluginCount, '扫描到的 plugins 目录子目录数量'],
    ['Git 仓库', summary.gitCount, '可读取 Git 信息的插件数量'],
    ['有本地改动', summary.dirtyCount, 'Git 状态非 clean 的插件数量'],
    ['有依赖清单', summary.packageCount, '可读取依赖清单的插件数量'],
    ['当前插件命中', summary.currentPluginCount, '路径包含当前 crystelf-plugin 的条目'],
  ];
  const target = $('bot-plugins-summary');
  if (!target) return;
  target.innerHTML = cards.map(([label, value, note]) => `
    <div class="card bot-plugin-summary-card">
      <h3>${escapeHtml(label)}</h3>
      <div class="value">${escapeHtml(formatNumber(value || 0))}</div>
      <div class="setting-help">${escapeHtml(note)}</div>
    </div>
  `).join('');
}

function renderWarnings(payload) {
  const panel = $('bot-plugins-warning-panel');
  const target = $('bot-plugins-warnings');
  if (!panel || !target) return;
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  panel.classList.toggle('hidden', warnings.length <= 0);
  target.innerHTML = warnings.length > 0
    ? warnings.map(item => `<div class="list-item tone-error">${escapeHtml(item)}</div>`).join('')
    : '';
}

function renderPluginCard(plugin) {
  const tone = getPluginTone(plugin);
  const gitTone = getGitTone(plugin.git);
  const deps = plugin.dependencyCounts || {};
  const dependencyText = plugin.hasPackage
    ? `运行 ${formatNumber(deps.runtime || 0)} / 开发 ${formatNumber(deps.dev || 0)} / peer ${formatNumber(deps.peer || 0)} / optional ${formatNumber(deps.optional || 0)}`
    : '未发现依赖清单';
  const description = trimText(plugin.description || '暂无描述', 120);
  const selected = String(plugin.id || '') === String(botPluginsState.selectedId || '');

  return `
    <button
      type="button"
      class="list-item bot-plugin-card tone-${tone}${selected ? ' is-selected' : ''}"
      data-plugin-id="${escapeHtml(plugin.id || '')}"
    >
      <div class="bot-plugin-card-head">
        <div>
          <h3>${escapeHtml(plugin.name || plugin.directoryName || '-')}</h3>
          <div class="bot-plugin-card-path">${escapeHtml(plugin.relativePath || plugin.directoryName || '-')}</div>
        </div>
        <div class="detail-tags">
          ${plugin.isCurrentPlugin ? '<span class="detail-tag tone-success">当前插件</span>' : ''}
          <span class="detail-tag">${escapeHtml(plugin.type || 'unknown')}</span>
          <span class="detail-tag tone-${gitTone}">${escapeHtml(getGitLabel(plugin.git))}</span>
        </div>
      </div>
      <div class="bot-plugin-card-desc">${escapeHtml(description)}</div>
      <div class="bot-plugin-card-meta">
        <span>版本：${escapeHtml(plugin.version || '-')}</span>
        <span>依赖：${escapeHtml(dependencyText)}</span>
        <span>更新：${escapeHtml(formatTime(plugin.updatedAt))}</span>
      </div>
    </button>
  `;
}

function renderPluginList() {
  const target = $('bot-plugins-list');
  const meta = $('bot-plugins-list-meta');
  if (!target || !meta) return;
  const plugins = getFilteredPlugins();
  const total = Array.isArray(botPluginsState.payload?.plugins) ? botPluginsState.payload.plugins.length : 0;
  if (!botPluginsState.selectedId || !plugins.some(plugin => plugin.id === botPluginsState.selectedId)) {
    botPluginsState.selectedId = plugins[0]?.id || '';
  }
  meta.textContent = `显示 ${formatNumber(plugins.length)} / ${formatNumber(total)} 个插件`;
  target.innerHTML = plugins.length > 0
    ? plugins.map(plugin => renderPluginCard(plugin)).join('')
    : renderEmptyState('没有匹配的插件', '可以清空筛选，或调整插件名、目录、Git 状态等条件。');
  renderDetail();
}

const schedulePluginListRender = createDebouncedTask(() => {
  renderPluginList();
}, 140);

function renderKv(label, value) {
  return `
    <div class="kv-item">
      <div class="kv-label">${escapeHtml(label)}</div>
      <div class="kv-value">${escapeHtml(value || '-')}</div>
    </div>
  `;
}

function renderScriptTags(scripts = []) {
  if (!Array.isArray(scripts) || scripts.length <= 0) {
    return '<div class="setting-help">未声明 npm scripts。</div>';
  }
  return `<div class="detail-tags">${scripts.map(script => `<span class="detail-tag">${escapeHtml(script)}</span>`).join('')}</div>`;
}

function renderDetail() {
  const target = $('bot-plugins-detail');
  if (!target) return;
  const plugins = Array.isArray(botPluginsState.payload?.plugins) ? botPluginsState.payload.plugins : [];
  const plugin = plugins.find(item => item.id === botPluginsState.selectedId) || null;
  if (!plugin) {
    target.innerHTML = renderEmptyState('选择左侧插件查看详情', '插件的目录、版本、依赖和 Git 状态会显示在这里。');
    return;
  }

  const deps = plugin.dependencyCounts || {};
  const git = plugin.git || {};
  const fileBrowserPath = plugin.fileBrowserPath || plugin.relativePath || '';
  const canDelete = plugin.canDelete === true && plugin.isCurrentPlugin !== true;
  target.innerHTML = `
    <div class="bot-plugin-detail">
      <div class="bot-plugin-detail-head">
        <div>
          <h3>${escapeHtml(plugin.name || plugin.directoryName || '-')}</h3>
          <div class="setting-help">${escapeHtml(plugin.description || '暂无描述')}</div>
        </div>
        <div class="detail-tags">
          ${plugin.isCurrentPlugin ? '<span class="detail-tag tone-success">当前插件</span>' : ''}
          <span class="detail-tag">${escapeHtml(plugin.type || 'unknown')}</span>
          <span class="detail-tag tone-${getGitTone(git)}">${escapeHtml(getGitLabel(git))}</span>
        </div>
      </div>

      <div class="actions bot-plugin-detail-actions">
        <a class="link-btn" href="${escapeHtml(buildFileBrowserUrl(fileBrowserPath))}">打开位置</a>
        <a class="link-btn" href="/dependency-check.html">查看依赖</a>
        <button
          type="button"
          class="mini-btn danger"
          data-action="delete-bot-plugin"
          data-plugin-id="${escapeHtml(plugin.id || '')}"
          ${canDelete ? '' : 'disabled'}
        >删除插件</button>
      </div>
      <div class="setting-help">${canDelete ? '删除会先把插件目录移入 plugins/.crystelf-plugin-trash，不会直接硬删。' : '当前插件或受保护目录不允许删除。'}</div>

      <div class="kv-grid bot-plugin-detail-grid">
        ${renderKv('目录名', plugin.directoryName)}
        ${renderKv('相对路径', plugin.relativePath)}
        ${renderKv('版本', plugin.version || '未声明')}
        ${renderKv('包名', plugin.packageName || '未声明')}
        ${renderKv('入口文件', plugin.main || '未声明')}
        ${renderKv('包管理器', plugin.packageManager || '未声明')}
        ${renderKv('运行依赖', formatNumber(deps.runtime || 0))}
        ${renderKv('开发依赖', formatNumber(deps.dev || 0))}
        ${renderKv('Peer 依赖', formatNumber(deps.peer || 0))}
        ${renderKv('可选依赖', formatNumber(deps.optional || 0))}
        ${renderKv('创建时间', formatTime(plugin.createdAt))}
        ${renderKv('修改时间', formatTime(plugin.updatedAt))}
      </div>

      <section class="bot-plugin-detail-section">
        <h3>Git 信息</h3>
        <div class="kv-grid bot-plugin-detail-grid">
          ${renderKv('Git 仓库', git.isGit ? '是' : '否')}
          ${renderKv('分支', git.branch)}
          ${renderKv('提交', git.commit)}
          ${renderKv('提交说明', git.commitMessage)}
          ${renderKv('远端', git.remote)}
          ${renderKv('状态', getGitLabel(git))}
        </div>
      </section>

      <section class="bot-plugin-detail-section">
        <h3>NPM Scripts</h3>
        ${renderScriptTags(plugin.scripts)}
      </section>
    </div>
  `;
}

async function deleteSelectedPlugin(pluginId = '') {
  const plugins = Array.isArray(botPluginsState.payload?.plugins) ? botPluginsState.payload.plugins : [];
  const plugin = plugins.find(item => String(item.id || '') === String(pluginId || '')) || null;
  if (!plugin) {
    setStatus('插件信息已变化，请重新扫描后再试。', 'error');
    return;
  }
  if (plugin.isCurrentPlugin || plugin.canDelete !== true) {
    setStatus('当前插件或受保护目录不允许删除。', 'error');
    return;
  }
  const directoryName = String(plugin.directoryName || plugin.id || '').trim();
  const confirmed = window.prompt(
    `确认删除插件「${plugin.name || directoryName}」？\n\n该操作会把目录移入 plugins/.crystelf-plugin-trash。\n请输入目录名确认：${directoryName}`,
    '',
  );
  if (confirmed === null) return;
  if (String(confirmed || '').trim() !== directoryName) {
    setStatus('目录名输入不一致，已取消删除。', 'error');
    return;
  }
  setStatus(`正在删除插件：${directoryName}`, 'neutral');
  try {
    const result = await postJson('/api/bot-plugins/delete', { directoryName });
    botPluginsState.selectedId = '';
    await refreshBotPlugins();
    window.CrystelfPluginCatalog?.refreshCatalog?.();
    setStatus(result.message || `插件 ${directoryName} 已移入回收站。`, 'neutral');
  } catch (error) {
    setStatus(`删除插件失败：${error.message}`, 'error');
  }
}

function renderPayload(payload) {
  botPluginsState.payload = payload;
  const summary = payload?.summary || {};
  renderSummary(payload);
  renderWarnings(payload);
  renderPluginList();
  setMeta(`插件 ${formatNumber(summary.pluginCount || 0)} 个，Git 仓库 ${formatNumber(summary.gitCount || 0)} 个，有改动 ${formatNumber(summary.dirtyCount || 0)} 个`);
}

async function refreshBotPlugins() {
  if (botPluginsState.loading) return;
  setRefreshState(true);
  setStatus('正在扫描机器人插件目录...', 'neutral');
  setContainerState('bot-plugins-list', 'loading', '正在扫描机器人插件目录...', '扫描完成后会自动更新插件列表。');
  setContainerState('bot-plugins-detail', 'loading', '正在等待插件扫描结果...', '选择插件后会显示版本、依赖和 Git 状态。');
  try {
    const payload = await fetchJson('/api/bot-plugins');
    renderPayload(payload);
    setStatus(`最近扫描：${formatTime(payload.generatedAt)}，根目录：${payload.rootRelativePath || payload.rootDir || '-'}`, 'neutral');
  } catch (error) {
    setMeta('机器人插件管理加载失败');
    setStatus(`机器人插件管理加载失败：${error.message}`, 'error');
    setContainerState('bot-plugins-list', 'error', '机器人插件管理加载失败', error.message);
    setContainerState('bot-plugins-detail', 'error', '插件详情暂时不可用', error.message);
  } finally {
    setRefreshState(false);
  }
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      switchTopTab(button.dataset.tabTarget || 'installed-tab');
    });
  });
  $('bot-plugins-refresh-btn')?.addEventListener('click', () => {
    refreshBotPlugins();
    window.CrystelfPluginCatalog?.refreshCatalog?.();
    window.CrystelfPluginCatalog?.refreshTasks?.();
  });
  $('bot-plugins-search')?.addEventListener('input', () => {
    schedulePluginListRender();
  });
  $('bot-plugins-type-filter')?.addEventListener('change', () => {
    schedulePluginListRender.cancel?.();
    renderPluginList();
  });
  $('bot-plugins-git-filter')?.addEventListener('change', () => {
    schedulePluginListRender.cancel?.();
    renderPluginList();
  });
  $('bot-plugins-clear-filter-btn')?.addEventListener('click', () => {
    if ($('bot-plugins-search')) $('bot-plugins-search').value = '';
    if ($('bot-plugins-type-filter')) $('bot-plugins-type-filter').value = 'all';
    if ($('bot-plugins-git-filter')) $('bot-plugins-git-filter').value = 'all';
    schedulePluginListRender.cancel?.();
    renderPluginList();
  });
  $('bot-plugins-list')?.addEventListener('click', event => {
    const card = event.target.closest('[data-plugin-id]');
    if (!card) return;
    botPluginsState.selectedId = card.dataset.pluginId || '';
    schedulePluginListRender.cancel?.();
    renderPluginList();
  });
  $('bot-plugins-detail')?.addEventListener('click', event => {
    const button = event.target.closest('[data-action="delete-bot-plugin"]');
    if (!button) return;
    deleteSelectedPlugin(button.dataset.pluginId || '');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  switchTopTab(getInitialTab());
  bindEvents();
  refreshBotPlugins();
});

window.CrystelfBotPlugins = {
  refreshBotPlugins,
  switchTopTab,
};
})();
