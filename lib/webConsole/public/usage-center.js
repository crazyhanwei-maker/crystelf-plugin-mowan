const state = {
  page: 1,
  auditPage: 1,
  refreshRequestId: 0,
  refreshPromise: null,
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

function formatSceneLabel(scene) {
  const key = String(scene || '').trim().toLowerCase();
  const sceneMap = {
    chat: '普通对话',
    chat_text: '文本对话',
    chat_multimodal: '多模态对话',
    chat_engine: '对话引擎',
    chat_engine_fallback: '对话引擎兜底',
    chat_engine_final: '对话引擎最终回复',
    humanize_generate: '拟人化生成',
    poke_follow_reply: '戳一戳接话回复',
    poke_ai_reply: '戳一戳 AI 回复',
    poke_image_summary: '戳一戳图片摘要',
    daily_group_summary: '每日群聊总结',
    image_monitor_review: '图片监控审核',
  };
  return sceneMap[key] || (key === 'unknown' ? '未知场景' : String(scene || '').trim() || '未知场景');
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

function createAbortController() {
  return typeof AbortController === 'function' ? new AbortController() : null;
}

function abortController(controller) {
  try {
    controller?.abort?.();
  } catch {
    // Ignore abort failures in older browser runtimes.
  }
}

function replaceRefreshController() {
  const previous = state.refreshController;
  abortController(previous);
  const controller = createAbortController();
  state.refreshController = controller;
  return controller;
}

function getCancelableRequestOptions(controller) {
  return controller?.signal ? { signal: controller.signal, cancelOnAbort: true } : {};
}

function isRequestCanceled(error) {
  return window.CrystelfRequest?.isCanceled?.(error) === true || error?.code === 'REQUEST_ABORTED';
}

function isImageMonitorReviewUsage(item = {}) {
  return String(item.scene || '').trim().toLowerCase() === 'image_monitor_review';
}

function renderUsagePromptPreview(item = {}) {
  if (isImageMonitorReviewUsage(item)) {
    return '';
  }
  return `
        <div class="log-entry-preview">
          <div class="log-entry-label">提示词预览</div>
          <div class="log-entry-text">${escapeHtml(item.display_prompt_preview || item.prompt_preview || '暂无')}</div>
        </div>`;
}

function getFilters() {
  return {
    query: document.getElementById('usage-log-search')?.value?.trim() || '',
    scene: document.getElementById('usage-log-scene')?.value?.trim() || '',
  };
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

function setPageMeta(text) {
  const el = document.getElementById('page-meta');
  if (el) {
    el.textContent = text;
  }
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

function syncSceneButtons() {
  const activeScene = String(document.getElementById('usage-log-scene')?.value?.trim() || '');
  document.querySelectorAll('[data-usage-scene]').forEach(button => {
    if (!(button instanceof HTMLElement)) return;
    button.classList.toggle('active', String(button.dataset.usageScene || '') === activeScene);
  });
}

function resetFilters() {
  ['usage-log-search', 'usage-log-scene'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  ['audit-log-search', 'audit-log-action'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  ['audit-log-method', 'audit-log-start', 'audit-log-end'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const auditResult = document.getElementById('audit-log-result');
  if (auditResult) auditResult.value = '';
  state.page = 1;
  state.auditPage = 1;
  syncSceneButtons();
}

const scheduleRefresh = createDebouncedTask(() => {
  refreshUsageCenter().catch(error => webConsoleAlert(error.message));
}, 260);

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

function buildSummaryCard(title, rows) {
  return `
    <div class="config-summary-card">
      <h3>${title}</h3>
      <div class="config-summary-list">
        ${rows.map(row => `
          <div class="config-summary-row">
            <span class="config-summary-label">${row.label}</span>
            <span class="config-summary-value">${row.value}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSummary(overview) {
  const usage = overview?.usage || {};
  const imageMonitor = usage.imageMonitor || {};
  const pokeImageSummary = usage.pokeImageSummary || {};
  const currency = escapeHtml(usage.currencySymbol || '$');

  const html = [
    '<div class="config-summary-grid">',
    buildSummaryCard('总体请求', [
      { label: '今日总请求', value: formatNumber(usage.requestCount || 0) },
      { label: '成功请求', value: formatNumber(usage.successCount || 0) },
      { label: '错误请求', value: formatNumber(usage.errorCount || 0) },
    ]),
    buildSummaryCard('用量与成本', [
      { label: '总用量', value: formatNumber(usage.totalTokens || 0) },
      { label: '估算成本', value: `${currency}${Number(usage.totalCost || 0).toFixed(6)}` },
      { label: '错误率', value: `${usage.requestCount > 0 ? ((Number(usage.errorCount || 0) / Number(usage.requestCount || 1)) * 100).toFixed(2) : '0.00'}%` },
    ]),
    buildSummaryCard('图片监控审核', [
      { label: '请求数', value: formatNumber(imageMonitor.requestCount || 0) },
      { label: '总用量', value: formatNumber(imageMonitor.totalTokens || 0) },
      { label: '平均用量', value: formatNumber(imageMonitor.averageTokens || 0) },
    ]),
    buildSummaryCard('戳一戳图片摘要', [
      { label: '请求数', value: formatNumber(pokeImageSummary.requestCount || 0) },
      { label: '总用量', value: formatNumber(pokeImageSummary.totalTokens || 0) },
      { label: '平均用量', value: formatNumber(pokeImageSummary.averageTokens || 0) },
    ]),
    '</div>',
  ].join('');

  document.getElementById('usage-summary').innerHTML = html;
}

function renderDailyOverview(overview) {
  const usage = overview?.usage || {};
  const imageMonitor = usage.imageMonitor || {};
  const pokeImageSummary = usage.pokeImageSummary || {};

  document.getElementById('daily-usage-box').textContent = [
    `请求数: ${formatNumber(usage.requestCount || 0)}`,
    `成功数: ${formatNumber(usage.successCount || 0)}`,
    `失败数: ${formatNumber(usage.errorCount || 0)}`,
    `总用量: ${formatNumber(usage.totalTokens || 0)}`,
    `总成本: ${(usage.currencySymbol || '$')}${Number(usage.totalCost || 0).toFixed(6)}`,
    '',
    '图片相关场景',
    `图片监控审核: ${formatNumber(imageMonitor.requestCount || 0)} 次 / 用量 ${formatNumber(imageMonitor.totalTokens || 0)}`,
    `戳一戳图片摘要: ${formatNumber(pokeImageSummary.requestCount || 0)} 次 / 用量 ${formatNumber(pokeImageSummary.totalTokens || 0)}`,
  ].join('\n');

  const sceneLines = Object.entries(usage.byScene || {})
    .sort((a, b) => Number(b[1]?.requests || 0) - Number(a[1]?.requests || 0))
    .map(([scene, item]) => `${formatSceneLabel(scene)}: ${formatNumber(item?.requests || 0)} 次 / 用量 ${formatNumber(item?.total_tokens || 0)}`);

  document.getElementById('scene-summary-box').textContent = sceneLines.length > 0
    ? sceneLines.join('\n')
    : '今日暂无按场景统计的 AI 用量数据';
}

function renderTrend(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const target = document.getElementById('trend-chart');
  if (items.length === 0) {
    target.textContent = '最近 24 小时暂无 AI 用量趋势数据';
    return;
  }
  target.innerHTML = renderUsageTrendChart(items);
}

function renderUsageTrendChart(items) {
  const W = 820;
  const H = 260;
  const padL = 52;
  const padR = 56;
  const padT = 28;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = items.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;

  const leftMax = Math.max(
    ...items.map(it => Number(it.requests || 0)),
    ...items.map(it => Number(it.errors || 0)),
    1,
  );
  const rightMax = Math.max(...items.map(it => Number(it.tokens || 0)), 1);

  const series = [
    { key: 'requests', label: '请求数', color: '#3b82f6', max: leftMax, axis: 'left' },
    { key: 'tokens', label: '用量', color: '#10b981', max: rightMax, axis: 'right' },
    { key: 'errors', label: '错误数', color: '#ef4444', max: leftMax, axis: 'left' },
  ];

  const xOf = i => (n > 1 ? padL + i * stepX : padL + innerW / 2);
  const yOf = (val, max) => padT + (1 - (Number(val) || 0) / max) * innerH;

  const formatAxisValue = v => {
    const num = Number(v) || 0;
    if (num >= 100000) return `${Math.round(num / 1000)}k`;
    if (num >= 10000) return `${(num / 1000).toFixed(1)}k`;
    return formatNumber(num);
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const gridLines = ticks.map(p => {
    const y = padT + (1 - p) * innerH;
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(148,163,184,0.22)" stroke-width="1" />`;
  }).join('');

  const axisLeft = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="rgba(148,163,184,0.55)" stroke-width="1" />`;
  const axisRight = `<line x1="${W - padR}" y1="${padT}" x2="${W - padR}" y2="${H - padB}" stroke="rgba(148,163,184,0.55)" stroke-width="1" />`;
  const axisBottom = `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="rgba(148,163,184,0.55)" stroke-width="1" />`;

  const leftTickLabels = ticks.map(p => {
    const y = padT + (1 - p) * innerH;
    return `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" font-size="11" fill="currentColor" opacity="0.75" text-anchor="end">${escapeHtml(formatAxisValue(leftMax * p))}</text>`;
  }).join('');

  const rightTickLabels = ticks.map(p => {
    const y = padT + (1 - p) * innerH;
    return `<text x="${W - padR + 8}" y="${(y + 4).toFixed(1)}" font-size="11" fill="currentColor" opacity="0.75" text-anchor="start">${escapeHtml(formatAxisValue(rightMax * p))}</text>`;
  }).join('');

  const leftAxisTitle = `<text x="${padL}" y="${padT - 10}" font-size="11" fill="currentColor" opacity="0.65" text-anchor="middle">请求 / 错误</text>`;
  const rightAxisTitle = `<text x="${W - padR}" y="${padT - 10}" font-size="11" fill="currentColor" opacity="0.65" text-anchor="middle">用量</text>`;

  const polylines = series.map(s => {
    const pts = items.map((it, i) => `${xOf(i).toFixed(1)},${yOf(it[s.key], s.max).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9" />`;
  }).join('');

  const dots = items.map((it, i) => {
    const tip = `${it.hour}\n请求 ${formatNumber(it.requests || 0)} · 用量 ${formatNumber(it.tokens || 0)} · 错误 ${formatNumber(it.errors || 0)}`;
    return series.map(s => {
      const x = xOf(i).toFixed(1);
      const y = yOf(it[s.key], s.max).toFixed(1);
      return `<circle cx="${x}" cy="${y}" r="2.8" fill="${s.color}" stroke="#fff" stroke-width="1"><title>${escapeHtml(tip)}</title></circle>`;
    }).join('');
  }).join('');

  const tickStep = Math.max(1, Math.ceil(n / 8));
  const hourLabels = items.map((it, i) => {
    if (i % tickStep !== 0 && i !== n - 1) return '';
    const x = xOf(i).toFixed(1);
    return `<text x="${x}" y="${H - 12}" font-size="11" fill="currentColor" opacity="0.85" text-anchor="middle">${escapeHtml(it.hour)}</text>`;
  }).join('');

  const xAxisTitle = `<text x="${padL + innerW / 2}" y="${H - 1}" font-size="10" fill="currentColor" opacity="0.55" text-anchor="middle">时间（小时）</text>`;

  const legendHtml = series.map(s =>
    `<span class="usage-trend-legend-item"><span class="usage-trend-legend-dot" style="background:${s.color}"></span>${escapeHtml(s.label)}<span class="usage-trend-legend-axis">${s.axis === 'left' ? '左轴' : '右轴'}</span></span>`
  ).join('');

  return `
    <div class="usage-trend">
      <div class="usage-trend-legend">${legendHtml}</div>
      <svg class="usage-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="最近 24 小时 AI 用量趋势">
        ${gridLines}
        ${axisLeft}
        ${axisRight}
        ${axisBottom}
        ${leftTickLabels}
        ${rightTickLabels}
        ${leftAxisTitle}
        ${rightAxisTitle}
        ${polylines}
        ${dots}
        ${hourLabels}
        ${xAxisTitle}
      </svg>
      <div class="usage-trend-hint">左轴对应请求数 / 错误数，右轴对应用量；将鼠标悬停在数据点上可查看每小时实际数值。</div>
    </div>
  `;
}

function renderLogs(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const html = items.length > 0
    ? items.map(item => `
      <div class="list-item log-entry-card ${item.error ? 'tone-error' : ''}">
        <div class="log-entry-head">
          <div>
            <h3>${escapeHtml(item.scene_label || formatSceneLabel(item.scene))}</h3>
            <div class="setting-help">${escapeHtml(formatTime(item.time))}</div>
          </div>
          <div class="detail-tags">
            <span class="detail-tag ${item.error ? 'tone-error' : 'tone-success'}">${item.error ? '失败' : '成功'}</span>
            <span class="detail-tag">${escapeHtml(item.model || '未知模型')}</span>
            <span class="detail-tag">用量 ${formatNumber(item.total_tokens || 0)}</span>
            ${item.elapsed_ms != null ? `<span class="detail-tag">耗时 ${formatNumber(item.elapsed_ms)}ms</span>` : ''}
          </div>
        </div>
        <div class="log-entry-meta">
          <span>会话 ${escapeHtml(item.session_id || '暂无')}</span>
          <span>群 ${escapeHtml(item.group_id || '暂无')}</span>
          <span>用户 ${escapeHtml(item.user_id || '暂无')}</span>
        </div>
        ${renderUsagePromptPreview(item)}
        <div class="log-entry-preview">
          <div class="log-entry-label">${item.error ? '错误信息' : '响应预览'}</div>
          <div class="log-entry-text">${escapeHtml(item.display_response_preview || item.response_preview || item.error || '暂无')}</div>
        </div>
        <div class="actions">
          <a class="link-btn" href="/usage-log-detail.html?id=${encodeURIComponent(item.id || '')}">详情</a>
        </div>
      </div>
    `).join('')
    : renderEmptyState('暂无 AI 用量日志', '当前筛选条件下没有记录；清空筛选后可以查看全部日志。');

  document.getElementById('usage-log-box').innerHTML = html;
  renderPagination('usage-log-pagination', data?.page, data?.totalPages, page => {
    state.page = page;
    refreshUsageCenter().catch(error => webConsoleAlert(error.message));
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

  document.getElementById('audit-log-box').innerHTML = html;
  renderPagination('audit-log-pagination', data?.page, data?.totalPages, page => {
    state.auditPage = page;
    refreshUsageCenter().catch(error => webConsoleAlert(error.message));
  });
}

async function refreshUsageCenter() {
  const requestId = ++state.refreshRequestId;
  const controller = replaceRefreshController();
  const requestOptions = getCancelableRequestOptions(controller);
  const filters = getFilters();
  const auditFilters = getAuditFilters();
  syncSceneButtons();
  setRefreshStatus('正在刷新 AI 用量页面...', 'neutral');
  setRefreshButtonState(true);

  const params = new URLSearchParams({
    query: filters.query,
    scene: filters.scene,
    page: String(state.page || 1),
  });
  const auditParams = new URLSearchParams({
    query: auditFilters.query,
    action: auditFilters.action,
    method: auditFilters.method,
    result: auditFilters.result,
    startAt: auditFilters.startAt,
    endAt: auditFilters.endAt,
    page: String(state.auditPage || 1),
    pageSize: '10',
  });

  const startedAt = Date.now();
  setContainerState('usage-log-box', 'loading', '正在刷新 AI 用量日志...', '日志返回后会自动更新列表。');
  setContainerState('audit-log-box', 'loading', '正在刷新控制台审计日志...', '审计记录返回后会自动更新列表。');
  state.refreshPromise = (async () => {
    try {
      const [overview, trend, logs, auditLogs] = await Promise.all([
        fetchJson('/api/overview', requestOptions),
        fetchJson('/api/trend/usage', requestOptions),
        fetchJson(`/api/logs/usage?${params.toString()}`, requestOptions),
        fetchJson(`/api/logs/audit?${auditParams.toString()}`, requestOptions),
      ]);

      if (requestId !== state.refreshRequestId) {
        return null;
      }

      renderSummary(overview);
      renderDailyOverview(overview);
      renderTrend(trend);
      renderLogs(logs);
      renderAuditLogs(auditLogs);

      const total = Number(logs.total || logs.items?.length || 0);
      const auditTotal = Number(auditLogs.total || auditLogs.items?.length || 0);
      const elapsedMs = Date.now() - startedAt;
      setPageMeta(`AI 日志 ${formatNumber(total)} 条，审计日志 ${formatNumber(auditTotal)} 条`);
      setRefreshStatus(`最近刷新：${formatTime(Date.now())} / ${elapsedMs} ms / AI 日志 ${formatNumber(total)} 条 / 审计 ${formatNumber(auditTotal)} 条`, 'neutral');
      return { overview, trend, logs, auditLogs };
    } catch (error) {
      if (requestId !== state.refreshRequestId || isRequestCanceled(error)) {
        return null;
      }
      setPageMeta('AI 用量日志中心加载失败');
      setRefreshStatus(`加载失败：${error.message}`, 'error');
      setContainerState('usage-log-box', 'error', 'AI 用量日志加载失败', error.message);
      setContainerState('audit-log-box', 'error', '控制台审计日志加载失败', error.message);
      throw error;
    } finally {
      if (requestId === state.refreshRequestId) {
        state.refreshPromise = null;
        state.refreshController = null;
        setRefreshButtonState(false);
      }
    }
  })();

  return state.refreshPromise;
}

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.dataset.usageScene !== undefined) {
    const input = document.getElementById('usage-log-scene');
    if (!input) return;
    input.value = String(target.dataset.usageScene || '');
    state.page = 1;
    syncSceneButtons();
    scheduleRefresh.cancel?.();
    refreshUsageCenter().catch(error => webConsoleAlert(error.message));
  }
});

document.addEventListener('DOMContentLoaded', () => {
syncSceneButtons();
document.getElementById('refresh-btn').addEventListener('click', () => {
    scheduleRefresh.cancel?.();
    refreshUsageCenter().catch(error => webConsoleAlert(error.message));
  });

  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    resetFilters();
    scheduleRefresh.cancel?.();
    refreshUsageCenter().catch(error => webConsoleAlert(error.message));
  });

  document.getElementById('export-usage-logs-btn').addEventListener('click', () => {
    const filters = getFilters();
    downloadExport('usage-logs', filters).catch(error => webConsoleAlert(error.message));
  });

  document.getElementById('export-audit-logs-btn')?.addEventListener('click', () => {
    const filters = getAuditFilters();
    downloadExport('audit-logs', filters).catch(error => webConsoleAlert(error.message));
  });

  ['usage-log-search', 'usage-log-scene'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      state.page = 1;
      syncSceneButtons();
      scheduleRefresh();
    });
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
      refreshUsageCenter().catch(error => webConsoleAlert(error.message));
    });
  });

  refreshUsageCenter().catch(error => {
    document.body.innerHTML = `<pre>AI 用量日志中心初始化失败：${escapeHtml(error.message)}</pre>`;
  });
});
