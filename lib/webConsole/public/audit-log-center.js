const state = {
  auditPage: 1,
  refreshRequestId: 0,
  refreshController: null,
};

const { fetchJson, downloadExport } = window.CrystelfRequest;
const consoleUi = window.CrystelfUi || {};

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

function renderEmptyState(title, detail = '') {
  return consoleUi.renderEmptyState
    ? consoleUi.renderEmptyState(title, detail)
    : `<div class="list-item">${escapeHtml(title)}</div>`;
}

function setContainerState(containerId, kind, title, detail = '') {
  if (consoleUi.setState) {
    consoleUi.setState(containerId, { kind, title, detail });
    return;
  }
  const target = document.getElementById(containerId);
  if (target) {
    target.innerHTML = `<div class="list-item">${escapeHtml(title)}</div>`;
  }
}

function createDebouncedTask(fn, delay = 260) {
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

function getAuditFilters() {
  return {
    query: document.getElementById('audit-log-search')?.value?.trim() || '',
    action: document.getElementById('audit-log-action')?.value?.trim() || '',
    method: document.getElementById('audit-log-method')?.value?.trim() || '',
    result: document.getElementById('audit-log-result')?.value?.trim() || '',
    startAt: document.getElementById('audit-log-start')?.value?.trim() || '',
    endAt: document.getElementById('audit-log-end')?.value?.trim() || '',
  };
}

function resetFilters() {
  ['audit-log-search', 'audit-log-action', 'audit-log-method', 'audit-log-start', 'audit-log-end'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const auditResult = document.getElementById('audit-log-result');
  if (auditResult) auditResult.value = '';
  state.auditPage = 1;
}

function setPageMeta(text) {
  const el = document.getElementById('page-meta');
  if (el) el.textContent = text;
}

function setRefreshStatus(text, tone = 'neutral') {
  const el = document.getElementById('refresh-status');
  if (!el) return;
  el.textContent = text;
  el.className = tone === 'error' ? 'setting-error' : 'setting-help';
}

function setRefreshButtonState(isRefreshing) {
  const button = document.getElementById('refresh-btn');
  if (!button) return;
  button.disabled = isRefreshing;
  button.textContent = isRefreshing ? '刷新中...' : '刷新数据';
}

function renderPagination(containerId, page, totalPages, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!totalPages || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('...');
  }
  for (let i = start; i <= end; i += 1) {
    pages.push(i);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  container.innerHTML = [
    `<button data-page="${Math.max(1, page - 1)}">上一页</button>`,
    ...pages.map(item => item === '...'
      ? '<span class="page-ellipsis">...</span>'
      : `<button class="${item === page ? 'active' : ''}" data-page="${item}">${item}</button>`),
    `<button data-page="${Math.min(totalPages, page + 1)}">下一页</button>`,
  ].join('');

  container.querySelectorAll('button[data-page]').forEach(button => {
    button.addEventListener('click', () => onPageChange(Number(button.dataset.page)));
  });
}

function formatAuditActionLabel(action = '') {
  const labels = {
    auth_login: '控制台登录',
    auth_logout: '退出登录',
    file_write: '写入文件',
    file_delete: '删除文件',
    file_rename: '重命名文件',
    file_mkdir: '创建目录',
    file_create: '创建文件',
    plugin_install: '安装插件',
    plugin_install_task_created: '插件安装任务创建',
    plugin_install_task_finished: '插件安装任务完成',
    plugin_install_task_cancel_requested: '插件安装任务取消',
    plugin_delete: '删除插件',
    plugin_delete_to_trash: '插件移入回收站',
    dependency_install: '依赖安装',
    dependency_install_task_created: '依赖安装任务创建',
    dependency_install_task_finished: '依赖安装任务完成',
    dependency_install_task_reused: '复用依赖安装任务',
    config_restore: '恢复配置',
    api_settings_save: '保存接口设置',
    plugin_settings_change: '插件设置变更',
    group_management_change: '群管理变更',
    help_diy_change: '帮助页变更',
    qq_simulator_change: '模拟调试变更',
    image_monitor_cleanup: '图片监控清理',
    sandbox_chat: '沙盒对话',
  };
  return labels[action] || action || '未知操作';
}

function formatAuditDetailLabel(key = '') {
  const labels = {
    taskId: '任务',
    catalogId: '目录项',
    pluginName: '插件',
    directoryName: '目录',
    repo: '仓库',
    targetDir: '目标',
    trashPath: '回收站',
    stage: '阶段',
    status: '状态',
    packageManager: '包管理器',
    dependencyType: '依赖类型',
    name: '依赖',
    dependencySpec: '依赖规格',
    command: '命令',
    error: '错误',
    currentStage: '当前阶段',
    failedStage: '失败阶段',
    timedOut: '超时',
    canceled: '已取消',
    reused: '复用任务',
    installDependencies: '安装依赖',
  };
  return labels[key] || key;
}

function formatAuditDetailValue(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  if (Array.isArray(value)) return value.join(' ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

function renderAuditDetails(details = {}) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return '';
  const priority = [
    'taskId',
    'pluginName',
    'directoryName',
    'name',
    'dependencySpec',
    'packageManager',
    'targetDir',
    'trashPath',
    'stage',
    'currentStage',
    'status',
    'error',
  ];
  const keys = Array.from(new Set([
    ...priority,
    ...Object.keys(details),
  ])).filter(key => {
    const value = details[key];
    return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length <= 0);
  }).slice(0, 12);
  if (keys.length <= 0) return '';
  return `
    <div class="audit-detail-grid">
      ${keys.map(key => `
        <div class="audit-detail-item">
          <span>${escapeHtml(formatAuditDetailLabel(key))}</span>
          <strong>${escapeHtml(formatAuditDetailValue(details[key]))}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAuditLogs(data) {
  const box = document.getElementById('audit-log-box');
  if (!box) return;
  const items = Array.isArray(data?.items) ? data.items : [];
  const html = items.length > 0
    ? items.map(item => {
        const isError = item.result === 'error';
        return `
        <div class="list-item log-entry-card ${isError ? 'tone-error' : ''}">
          <div class="log-entry-head">
            <div>
              <h3>${escapeHtml(formatAuditActionLabel(item.action))}</h3>
              <div class="setting-help">${escapeHtml(formatTime(item.time))}</div>
            </div>
            <div class="detail-tags">
              <span class="detail-tag ${isError ? 'tone-error' : 'tone-success'}">${isError ? '失败' : '成功'}</span>
              <span class="detail-tag">${escapeHtml(item.method || '-')}</span>
              <span class="detail-tag">HTTP ${escapeHtml(item.statusCode || '-')}</span>
              <span class="detail-tag">${formatNumber(item.durationMs || 0)}ms</span>
            </div>
          </div>
          <div class="log-entry-meta">
            <span>路径 ${escapeHtml(item.path || '-')}</span>
            <span>IP ${escapeHtml(item.clientIp || '-')}</span>
          </div>
          ${renderAuditDetails(item.details)}
          <div class="log-entry-preview">
            <div class="log-entry-label">User-Agent</div>
            <div class="log-entry-text">${escapeHtml(item.userAgent || '暂无')}</div>
          </div>
        </div>
      `;
      }).join('')
    : renderEmptyState('暂无控制台审计日志', '当前筛选条件下没有审计记录；重要操作发生后会显示在这里。');

  box.innerHTML = html;
  renderPagination('audit-log-pagination', data?.page, data?.totalPages, page => {
    state.auditPage = page;
    refreshAuditCenter().catch(error => webConsoleAlert(error.message));
  });
}

async function refreshAuditCenter() {
  const requestId = ++state.refreshRequestId;
  const previous = state.refreshController;
  try {
    previous?.abort?.();
  } catch {
    // Ignore abort failures.
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  state.refreshController = controller;
  const requestOptions = controller?.signal ? { signal: controller.signal, cancelOnAbort: true } : {};

  const filters = getAuditFilters();
  const params = new URLSearchParams({
    query: filters.query,
    action: filters.action,
    method: filters.method,
    result: filters.result,
    startAt: filters.startAt,
    endAt: filters.endAt,
    page: String(state.auditPage || 1),
    pageSize: '10',
  });

  const startedAt = Date.now();
  setRefreshStatus('正在刷新控制台审计日志...', 'neutral');
  setRefreshButtonState(true);
  setContainerState('audit-log-box', 'loading', '正在刷新控制台审计日志...', '审计记录返回后会自动更新列表。');
  try {
    const auditLogs = await fetchJson(`/api/logs/audit?${params.toString()}`, requestOptions);
    if (requestId !== state.refreshRequestId) return null;
    renderAuditLogs(auditLogs);
    const total = Number(auditLogs?.total || auditLogs?.items?.length || 0);
    const elapsedMs = Date.now() - startedAt;
    setPageMeta(`审计日志 ${formatNumber(total)} 条`);
    setRefreshStatus(`最近刷新：${formatTime(Date.now())} / ${elapsedMs} ms / 审计日志 ${formatNumber(total)} 条`, 'neutral');
    return auditLogs;
  } catch (error) {
    if (requestId !== state.refreshRequestId) return null;
    if (window.CrystelfRequest?.isCanceled?.(error) || error?.code === 'REQUEST_ABORTED') return null;
    setPageMeta('控制台审计日志加载失败');
    setRefreshStatus(`加载失败：${error.message}`, 'error');
    setContainerState('audit-log-box', 'error', '控制台审计日志加载失败', error.message);
    throw error;
  } finally {
    if (requestId === state.refreshRequestId) {
      state.refreshController = null;
      setRefreshButtonState(false);
    }
  }
}

const scheduleRefresh = createDebouncedTask(() => {
  refreshAuditCenter().catch(error => webConsoleAlert(error.message));
}, 260);

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    scheduleRefresh.cancel?.();
    refreshAuditCenter().catch(error => webConsoleAlert(error.message));
  });

  document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
    resetFilters();
    scheduleRefresh.cancel?.();
    refreshAuditCenter().catch(error => webConsoleAlert(error.message));
  });

  document.getElementById('export-audit-logs-btn')?.addEventListener('click', () => {
    const filters = getAuditFilters();
    downloadExport('audit-logs', filters).catch(error => webConsoleAlert(error.message));
  });

  ['audit-log-search', 'audit-log-action'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      state.auditPage = 1;
      scheduleRefresh();
    });
  });

  ['audit-log-method', 'audit-log-result', 'audit-log-start', 'audit-log-end'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      state.auditPage = 1;
      scheduleRefresh.cancel?.();
      refreshAuditCenter().catch(error => webConsoleAlert(error.message));
    });
  });

  refreshAuditCenter().catch(error => {
    console.warn('[auditLogCenter] initial refresh failed:', error?.message);
  });
});
