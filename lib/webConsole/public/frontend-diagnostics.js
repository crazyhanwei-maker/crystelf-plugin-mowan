(function () {
  const state = {
    kind: 'all',
    search: '',
    payload: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    if (window.CrystelfUi?.escapeHtml) {
      return window.CrystelfUi.escapeHtml(value);
    }
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return new Intl.NumberFormat('zh-CN').format(number);
  }

  function formatTime(value) {
    if (!value) return '暂无';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function formatDuration(value) {
    const ms = Math.max(0, Number(value || 0));
    if (!Number.isFinite(ms) || ms <= 0) return '0ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  }

  function getFrontendSummary() {
    return window.CrystelfFrontendErrors?.getSummary?.() || {
      status: 'success',
      totalCount: 0,
      storedCount: 0,
      recentCount: 0,
      runtimeCount: 0,
      promiseCount: 0,
      requestCount: 0,
      resourceCount: 0,
      items: [],
      recentItems: [],
    };
  }

  function getRequestMetrics() {
    return window.CrystelfRequest?.getMetrics?.() || {
      thresholdMs: 1500,
      totalCount: 0,
      successCount: 0,
      errorCount: 0,
      canceledCount: 0,
      slowCount: 0,
      averageMs: 0,
      activeCount: 0,
      items: [],
      slowItems: [],
      recentSlowItems: [],
    };
  }

  function getPageLoadDiagnostics() {
    return window.CrystelfPageLoadDiagnostics?.getSummary?.() || {
      status: 'success',
      summary: {},
      recommendations: ['当前浏览器不支持页面资源诊断接口。'],
      resources: [],
      failedResourceItems: [],
      versionMismatchItems: [],
      unversionedSameOriginItems: [],
      localCache: {},
    };
  }

  function buildPayload() {
    return {
      generatedAt: new Date().toISOString(),
      frontend: getFrontendSummary(),
      requests: getRequestMetrics(),
      pageLoad: getPageLoadDiagnostics(),
    };
  }

  function getToneForStatus(status = '') {
    if (status === 'error') return 'error';
    if (status === 'warn' || status === 'warning') return 'warning';
    return 'success';
  }

  function getErrorTone(item = {}) {
    if (item.kind === 'request' && Number(item.status || 0) >= 500) return 'error';
    if (item.kind === 'request' && Number(item.status || 0) >= 400) return 'warning';
    if (item.kind === 'resource') return 'error';
    return 'error';
  }

  function getRequestTone(item = {}) {
    if (item.success === true) return item.slow ? 'warning' : 'success';
    if (item.canceled === true) return 'warning';
    return 'error';
  }

  function renderKpi(label, value, meta = '', tone = 'neutral') {
    return `
      <article class="frontend-diagnostics-kpi ${tone ? `tone-${escapeHtml(tone)}` : ''}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <em>${escapeHtml(meta)}</em>
      </article>
    `;
  }

  function renderSummary(payload = {}) {
    const target = $('frontend-diagnostics-summary');
    if (!target) return;
    const frontend = payload.frontend || {};
    const requests = payload.requests || {};
    const pageLoad = payload.pageLoad || {};
    target.innerHTML = [
      renderKpi('最近异常', formatNumber(frontend.recentCount || 0), '最近 10 分钟记录', Number(frontend.recentCount || 0) > 0 ? 'error' : 'success'),
      renderKpi('累计记录', formatNumber(frontend.storedCount || 0), `总触发 ${formatNumber(frontend.totalCount || 0)} 次`, Number(frontend.storedCount || 0) > 0 ? 'warning' : 'success'),
      renderKpi('接口失败', formatNumber(frontend.requestCount || 0), `当前页请求失败 ${formatNumber(requests.errorCount || 0)} 次`, Number(frontend.requestCount || 0) > 0 || Number(requests.errorCount || 0) > 0 ? 'error' : 'success'),
      renderKpi('脚本异常', formatNumber((frontend.runtimeCount || 0) + (frontend.promiseCount || 0)), '页面脚本和异步任务', Number((frontend.runtimeCount || 0) + (frontend.promiseCount || 0)) > 0 ? 'error' : 'success'),
      renderKpi('慢请求', formatNumber(requests.slowCount || 0), `阈值 ${formatDuration(requests.thresholdMs || 0)}，平均 ${formatDuration(requests.averageMs || 0)}`, Number(requests.slowCount || 0) > 0 ? 'warning' : 'success'),
      renderKpi('资源状态', pageLoad.status === 'success' ? '正常' : pageLoad.status === 'warn' ? '需检查' : '异常', `资源 ${formatNumber(pageLoad.summary?.totalResourceCount || 0)} 个`, getToneForStatus(pageLoad.status)),
    ].join('');
  }

  function buildRecommendations(payload = {}) {
    const frontend = payload.frontend || {};
    const requests = payload.requests || {};
    const pageLoad = payload.pageLoad || {};
    const items = [];
    if (Number(frontend.recentCount || 0) > 0) {
      items.push(`最近 10 分钟记录到 ${frontend.recentCount} 条前端异常，优先查看“异常记录”里最新的页面和接口。`);
    }
    if (Number(frontend.requestCount || 0) > 0 || Number(requests.errorCount || 0) > 0) {
      items.push('存在接口请求失败。若状态码是 404，多半是前端引用了未注册接口；若是 500，需要查看 Bot 控制台后端日志。');
    }
    if (Number(frontend.resourceCount || 0) > 0 || Number(pageLoad.summary?.failedResourceCount || 0) > 0) {
      items.push('存在脚本或样式资源加载失败。先刷新页面；如果仍失败，重启控制台并检查静态资源文件是否存在。');
    }
    if (Number(requests.slowCount || 0) > 0) {
      items.push(`当前页面有 ${requests.slowCount} 个慢请求超过 ${formatDuration(requests.thresholdMs || 0)}，可结合接口名判断是网络慢、日志读取慢还是后端处理慢。`);
    }
    if (pageLoad.status !== 'success' && Array.isArray(pageLoad.recommendations)) {
      items.push(...pageLoad.recommendations.slice(0, 3));
    }
    if (items.length <= 0) {
      items.push('当前浏览器没有记录到明显前端异常。页面如果仍表现异常，可以先刷新后再打开本页观察是否出现新记录。');
    }
    return Array.from(new Set(items)).slice(0, 8);
  }

  function renderRecommendations(payload = {}) {
    const target = $('frontend-diagnostics-recommendations');
    if (!target) return;
    target.innerHTML = buildRecommendations(payload)
      .map(item => `<div class="frontend-diagnostics-recommendation">${escapeHtml(item)}</div>`)
      .join('');
  }

  function itemMatchesSearch(item = {}, query = '') {
    if (!query) return true;
    return [
      item.kindLabel,
      item.message,
      item.detail,
      item.url,
      item.pageUrl,
      item.status,
      item.code,
      item.method,
    ].join(' ').toLowerCase().includes(query);
  }

  function getFilteredErrors(payload = {}) {
    const frontend = payload.frontend || {};
    const query = String(state.search || '').trim().toLowerCase();
    const kind = String(state.kind || 'all');
    return (Array.isArray(frontend.items) ? frontend.items : []).filter(item => {
      if (kind !== 'all' && item.kind !== kind) return false;
      return itemMatchesSearch(item, query);
    });
  }

  function renderErrorCard(item = {}) {
    const tone = getErrorTone(item);
    const meta = [
      item.method ? `${item.method}` : '',
      item.status ? `HTTP ${item.status}` : '',
      item.code || '',
      item.elapsedMs ? `耗时 ${formatDuration(item.elapsedMs)}` : '',
      item.count > 1 ? `重复 ${formatNumber(item.count)} 次` : '',
    ].filter(Boolean);
    return `
      <article class="frontend-diagnostics-error-card tone-${escapeHtml(tone)}">
        <div class="frontend-diagnostics-card-head">
          <div>
            <h3>${escapeHtml(item.message || '未知前端异常')}</h3>
            <p class="frontend-diagnostics-card-meta">${escapeHtml(item.pageUrl || '未知页面')}</p>
          </div>
          <span class="frontend-diagnostics-pill tone-${escapeHtml(tone)}">${escapeHtml(item.kindLabel || item.kind || '异常')}</span>
        </div>
        <div class="frontend-diagnostics-meta-row">
          <span>最近：${escapeHtml(formatTime(item.latestAt))}</span>
          <span>首次：${escapeHtml(formatTime(item.firstAt))}</span>
          ${meta.map(value => `<span>${escapeHtml(value)}</span>`).join('')}
        </div>
        <div class="frontend-diagnostics-kv-grid">
          <div class="frontend-diagnostics-field">
            <span class="frontend-diagnostics-field-label">来源</span>
            <code>${escapeHtml(item.url || '-')}</code>
          </div>
          <div class="frontend-diagnostics-field">
            <span class="frontend-diagnostics-field-label">详情</span>
            <code>${escapeHtml(item.detail || '-')}</code>
          </div>
        </div>
        ${item.stack ? `<details class="frontend-diagnostics-stack"><summary>查看堆栈</summary><pre>${escapeHtml(item.stack)}</pre></details>` : ''}
      </article>
    `;
  }

  function renderErrors(payload = {}) {
    const target = $('frontend-diagnostics-errors');
    const meta = $('frontend-diagnostics-error-meta');
    if (!target) return;
    const errors = getFilteredErrors(payload);
    const total = Array.isArray(payload.frontend?.items) ? payload.frontend.items.length : 0;
    if (meta) meta.textContent = `当前显示 ${formatNumber(errors.length)} / ${formatNumber(total)} 条本机异常记录。`;
    target.innerHTML = errors.length > 0
      ? errors.map(renderErrorCard).join('')
      : '<div class="frontend-diagnostics-empty">当前筛选条件下没有异常记录。</div>';
  }

  function renderRequestCard(item = {}) {
    const tone = getRequestTone(item);
    const status = item.canceled ? '已取消' : item.success ? '成功' : '失败';
    return `
      <article class="frontend-diagnostics-request-card tone-${escapeHtml(tone)}">
        <div class="frontend-diagnostics-card-head">
          <div>
            <h3>${escapeHtml(item.url || '-')}</h3>
            <p class="frontend-diagnostics-card-meta">${escapeHtml(formatTime(item.finishedAt || item.startedAt))}</p>
          </div>
          <span class="frontend-diagnostics-pill tone-${escapeHtml(tone)}">${escapeHtml(status)}</span>
        </div>
        <div class="frontend-diagnostics-stat-row">
          <span>${escapeHtml(item.method || 'GET')}</span>
          <span>HTTP ${escapeHtml(item.status || 0)}</span>
          <span>耗时 ${escapeHtml(formatDuration(item.elapsedMs || 0))}</span>
          ${item.slow ? '<span>慢请求</span>' : ''}
          ${item.code ? `<span>${escapeHtml(item.code)}</span>` : ''}
        </div>
        ${item.error ? `<div class="setting-help">${escapeHtml(item.error)}</div>` : ''}
      </article>
    `;
  }

  function renderRequests(payload = {}) {
    const target = $('frontend-diagnostics-requests');
    const meta = $('frontend-diagnostics-request-meta');
    if (!target) return;
    const metrics = payload.requests || {};
    const items = Array.isArray(metrics.items) ? metrics.items.slice(0, 16) : [];
    if (meta) {
      meta.textContent = `当前页会话请求 ${formatNumber(metrics.totalCount || 0)} 次，失败 ${formatNumber(metrics.errorCount || 0)} 次，慢请求 ${formatNumber(metrics.slowCount || 0)} 次。`;
    }
    target.innerHTML = items.length > 0
      ? items.map(renderRequestCard).join('')
      : '<div class="frontend-diagnostics-empty">当前页面还没有接口请求记录。</div>';
  }

  function renderResourceCard(item = {}, tone = 'warning') {
    return `
      <article class="frontend-diagnostics-resource-card tone-${escapeHtml(tone)}">
        <div class="frontend-diagnostics-card-head">
          <div>
            <h3>${escapeHtml(item.url || item.message || '-')}</h3>
            <p class="frontend-diagnostics-card-meta">${escapeHtml(item.type || item.kindLabel || '资源')}</p>
          </div>
          <span class="frontend-diagnostics-pill tone-${escapeHtml(tone)}">${escapeHtml(tone === 'error' ? '异常' : '需检查')}</span>
        </div>
        <div class="frontend-diagnostics-stat-row">
          ${item.version ? `<span>版本 ${escapeHtml(item.version)}</span>` : ''}
          ${item.pageUrl ? `<span>${escapeHtml(item.pageUrl)}</span>` : ''}
          ${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ''}
        </div>
      </article>
    `;
  }

  function renderResources(payload = {}) {
    const target = $('frontend-diagnostics-resources');
    const meta = $('frontend-diagnostics-resource-meta');
    if (!target) return;
    const diagnostic = payload.pageLoad || {};
    const summary = diagnostic.summary || {};
    const failed = Array.isArray(diagnostic.failedResourceItems) ? diagnostic.failedResourceItems : [];
    const mismatched = Array.isArray(diagnostic.versionMismatchItems) ? diagnostic.versionMismatchItems : [];
    const unversioned = Array.isArray(diagnostic.unversionedSameOriginItems) ? diagnostic.unversionedSameOriginItems : [];
    const cards = [
      ...failed.map(item => renderResourceCard(item, 'error')),
      ...mismatched.map(item => renderResourceCard(item, 'warning')),
      ...unversioned.slice(0, 6).map(item => renderResourceCard(item, 'warning')),
    ];
    if (meta) {
      meta.textContent = `资源 ${formatNumber(summary.totalResourceCount || 0)} 个，失败 ${formatNumber(summary.failedResourceCount || 0)} 个，版本不一致 ${formatNumber(summary.versionMismatchCount || 0)} 个。`;
    }
    target.innerHTML = cards.length > 0
      ? cards.join('')
      : '<div class="frontend-diagnostics-empty">当前页面资源加载状态正常。</div>';
  }

  function render(payload = buildPayload()) {
    state.payload = payload;
    const meta = $('frontend-diagnostics-meta');
    if (meta) {
      meta.textContent = `诊断时间：${formatTime(payload.generatedAt)}。记录保存在当前浏览器本机。`;
    }
    renderSummary(payload);
    renderRecommendations(payload);
    renderErrors(payload);
    renderRequests(payload);
    renderResources(payload);
  }

  function copyDiagnosticSummary() {
    const payload = buildPayload();
    const frontend = payload.frontend || {};
    const requests = payload.requests || {};
    const pageLoad = payload.pageLoad || {};
    const latest = frontend.latest || null;
    const lines = [
      `前端错误诊断：${formatTime(payload.generatedAt)}`,
      `异常记录：最近 ${frontend.recentCount || 0}，本机保存 ${frontend.storedCount || 0}，累计触发 ${frontend.totalCount || 0}`,
      `类型统计：接口 ${frontend.requestCount || 0}，脚本 ${frontend.runtimeCount || 0}，异步 ${frontend.promiseCount || 0}，资源 ${frontend.resourceCount || 0}`,
      `请求统计：总数 ${requests.totalCount || 0}，失败 ${requests.errorCount || 0}，慢请求 ${requests.slowCount || 0}，平均 ${formatDuration(requests.averageMs || 0)}`,
      `资源状态：${pageLoad.status || 'unknown'}，资源 ${pageLoad.summary?.totalResourceCount || 0}，失败 ${pageLoad.summary?.failedResourceCount || 0}`,
      latest ? `最新异常：${latest.kindLabel || latest.kind} / ${latest.pageUrl || '-'} / ${latest.message || '-'}` : '最新异常：无',
    ];
    const text = lines.join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      window.webConsoleAlert?.('诊断摘要已复制。');
    }).catch(() => {
      window.webConsoleAlert?.(text, { title: '诊断摘要' });
    });
  }

  async function clearLocalDiagnostics() {
    const confirmed = await window.webConsoleConfirm?.('确认清空当前浏览器保存的前端错误记录吗？这不会修改服务器文件，也不会清空 Bot 日志。', {
      title: '清空本机诊断记录',
      confirmText: '清空',
      cancelText: '取消',
    });
    if (!confirmed) return;
    window.CrystelfFrontendErrors?.reset?.();
    window.CrystelfRequest?.resetMetrics?.();
    render(buildPayload());
  }

  function bindEvents() {
    $('frontend-diagnostics-refresh-btn')?.addEventListener('click', () => render(buildPayload()));
    $('frontend-diagnostics-copy-btn')?.addEventListener('click', copyDiagnosticSummary);
    $('frontend-diagnostics-clear-btn')?.addEventListener('click', () => {
      clearLocalDiagnostics().catch(error => window.webConsoleAlert?.(error.message || String(error)));
    });
    $('frontend-diagnostics-search')?.addEventListener('input', event => {
      state.search = String(event.target.value || '');
      renderErrors(state.payload || buildPayload());
    });
    $('frontend-diagnostics-kind')?.addEventListener('change', event => {
      state.kind = String(event.target.value || 'all');
      renderErrors(state.payload || buildPayload());
    });
    window.addEventListener('crystelf-frontend-error-change', () => render(buildPayload()));
    window.addEventListener('crystelf-request-timing-change', () => render(buildPayload()));
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    render(buildPayload());
  });
})();
