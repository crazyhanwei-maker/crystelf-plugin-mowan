const CONSOLE_PAGE_CHECK_TARGETS = [
  { key: 'page.index', label: '控制台首页', type: 'page', url: '/index.html' },
  { key: 'page.apiSettings', label: '接口设置中心', type: 'page', url: '/api-settings.html' },
  { key: 'page.dependency', label: '依赖检查页', type: 'page', url: '/dependency-check.html' },
  { key: 'page.fileBrowser', label: '文件浏览编辑器', type: 'page', url: '/file-browser.html' },
  { key: 'page.pluginSettings', label: '插件设置中心', type: 'page', url: '/plugin-settings.html' },
  { key: 'page.usageCenter', label: '用量日志中心', type: 'page', url: '/usage-center.html' },
  { key: 'script.auth', label: '登录与请求脚本', type: 'asset', url: '/auth.js' },
  { key: 'script.dashboardCore', label: '首页基础脚本', type: 'asset', url: '/dashboard-core.js' },
  { key: 'script.dashboardSupport', label: '巡检脚本', type: 'asset', url: '/dashboard-support.js' },
  { key: 'api.authStatus', label: '登录状态接口', type: 'api', url: '/api/auth/status' },
  { key: 'api.overview', label: '首页概览接口', type: 'api', url: '/api/overview' },
  { key: 'api.health', label: '健康检查接口', type: 'api', url: '/api/health' },
  { key: 'api.tasks', label: '任务中心接口', type: 'api', url: '/api/tasks' },
  { key: 'api.audit', label: '审计日志接口', type: 'api', url: '/api/logs/audit?pageSize=1' },
];

let lastConsolePageCheckPayload = null;

function setLastConsolePageCheckPayload(payload = null) {
  lastConsolePageCheckPayload = payload || null;
  window.CrystelfConsolePageCheckLastResult = lastConsolePageCheckPayload;
  return lastConsolePageCheckPayload;
}

function getLastConsolePageCheckPayload() {
  return lastConsolePageCheckPayload || window.CrystelfConsolePageCheckLastResult || null;
}

function getConsolePageCheckTypeLabel(type = '') {
  if (type === 'api') return '接口';
  if (type === 'asset') return '资源';
  return '页面';
}

function getConsolePageCheckItemTone(item = {}) {
  if (item.status === 'ok') return 'success';
  if (item.status === 'warn') return 'neutral';
  return 'error';
}

function getConsolePageCheckItemStatus(item = {}) {
  if (item.status === 'ok') return item.httpStatus ? `正常 HTTP ${item.httpStatus}` : '正常';
  if (item.status === 'warn') return item.httpStatus ? `需确认 HTTP ${item.httpStatus}` : '需确认';
  if (item.httpStatus === 401) return '需要重新登录';
  if (item.httpStatus === 403) return '权限不足';
  if (item.httpStatus === 404) return '未找到';
  if (item.httpStatus) return `失败 HTTP ${item.httpStatus}`;
  return '读取失败';
}

function getConsolePageCheckSummaryTone(summary = {}) {
  if (Number(summary.errorCount || 0) > 0) return 'error';
  if (Number(summary.warnCount || 0) > 0) return 'neutral';
  if (Number(summary.checkedCount || 0) > 0) return 'success';
  return 'neutral';
}

function renderConsolePageCheckLoading() {
  const box = document.getElementById('console-page-check-result');
  if (!box) return;
  box.innerHTML = `
    <div class="console-page-check-loading">
      <div class="setting-help">正在检查页面、接口和关键脚本，请稍等...</div>
      <div class="console-page-check-progress">
        <span style="width: 12%"></span>
      </div>
    </div>
  `;
}

function updateConsolePageCheckProgress(done = 0, total = 1) {
  const progress = document.querySelector('#console-page-check-result .console-page-check-progress span');
  if (!progress) return;
  const percent = Math.max(6, Math.min(100, Math.round((Number(done || 0) / Math.max(1, Number(total || 1))) * 100)));
  progress.style.width = `${percent}%`;
}

function setConsolePageCheckLoading(isLoading) {
  const runButton = document.getElementById('console-page-check-run-btn');
  if (runButton) {
    runButton.disabled = isLoading;
    runButton.textContent = isLoading ? '巡检中...' : '开始页面巡检';
  }
}

function setSupportBundleExportLoading(isLoading) {
  const button = document.getElementById('support-bundle-export-btn');
  if (button) {
    button.disabled = isLoading;
    button.textContent = isLoading ? '正在导出...' : '导出脱敏排障包';
  }
}

function buildConsolePageCheckSummary(items = []) {
  const checkedCount = items.length;
  const errorCount = items.filter(item => item.status === 'error').length;
  const warnCount = items.filter(item => item.status === 'warn').length;
  const okCount = items.filter(item => item.status === 'ok').length;
  const elapsedMs = items.reduce((sum, item) => sum + Number(item.elapsedMs || 0), 0);
  return {
    checkedCount,
    okCount,
    warnCount,
    errorCount,
    elapsedMs,
    status: errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok',
  };
}

function getConsolePageCheckAdvice(item = {}) {
  if (item.status === 'ok') {
    if (item.type === 'api') return '接口返回正常。';
    if (item.type === 'asset') return '关键脚本可以正常加载。';
    return '页面文件可以正常打开。';
  }
  if (item.httpStatus === 401) return '当前登录状态可能已过期，重新登录后再巡检。';
  if (item.httpStatus === 403) return '当前权限不足，确认控制台口令、只读模式或日志暴露设置。';
  if (item.httpStatus === 404) return '文件或接口不存在，可能是脚本版本和后端不一致，建议重启控制台并强制刷新。';
  if (/Failed to fetch|NetworkError|无法连接/i.test(item.error || '')) return '浏览器无法连接控制台后端，确认控制台进程仍在运行。';
  if (item.type === 'asset') return '脚本资源加载异常，建议清缓存刷新或重启控制台。';
  return '建议重试一次；如果持续失败，导出脱敏排障包给远程协助者查看。';
}

function renderConsolePageCheckResult(payload = {}) {
  const box = document.getElementById('console-page-check-result');
  if (!box) return;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const summary = payload.summary || buildConsolePageCheckSummary(items);
  const tone = getConsolePageCheckSummaryTone(summary);
  const failedItems = items.filter(item => item.status !== 'ok');
  const headline = Number(summary.errorCount || 0) > 0
    ? `发现 ${formatNumber(summary.errorCount)} 个异常`
    : Number(summary.warnCount || 0) > 0
      ? `有 ${formatNumber(summary.warnCount)} 个项目需要确认`
      : '页面巡检通过';
  const failedHint = failedItems.length > 0
    ? `优先处理：${failedItems.slice(0, 3).map(item => item.label).join('、')}`
    : '常用页面、关键脚本和主要接口都能正常访问。';

  const rowsHtml = items.map(item => `
    <div class="console-page-check-row tone-${getConsolePageCheckItemTone(item)}">
      <div class="console-page-check-row-main">
        <div class="console-page-check-title">${escapeHtml(item.label || item.url || '-')}</div>
        <div class="console-page-check-meta">
          ${escapeHtml(getConsolePageCheckTypeLabel(item.type))}
          · ${escapeHtml(item.url || '-')}
          · ${escapeHtml(formatNumber(item.elapsedMs || 0))} ms
        </div>
        <div class="console-page-check-advice">${escapeHtml(getConsolePageCheckAdvice(item))}</div>
        ${item.error ? `<div class="console-page-check-error">${escapeHtml(item.error)}</div>` : ''}
      </div>
      <div class="console-page-check-row-side">
        <strong>${escapeHtml(getConsolePageCheckItemStatus(item))}</strong>
        <span>${escapeHtml(formatTime(item.checkedAt))}</span>
      </div>
    </div>
  `).join('');

  box.innerHTML = `
    <div class="console-page-check-summary tone-${tone}">
      <div>
        <div class="console-page-check-summary-title">${escapeHtml(headline)}</div>
        <div class="setting-help">${escapeHtml(failedHint)}</div>
      </div>
      <div class="console-page-check-summary-stats">
        <span>通过 <strong>${formatNumber(summary.okCount || 0)}</strong></span>
        <span>异常 <strong>${formatNumber(summary.errorCount || 0)}</strong></span>
        <span>耗时 <strong>${formatNumber(summary.elapsedMs || 0)} ms</strong></span>
      </div>
    </div>
    <div class="console-page-check-list">${rowsHtml}</div>
  `;
}

async function inspectConsolePageTarget(target = {}) {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(target.url, {
      cache: 'no-store',
      headers: { Accept: target.type === 'api' ? 'application/json' : 'text/html,application/javascript,text/css,*/*' },
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.clone().text().catch(() => '');
    const elapsedMs = Date.now() - startedAt;
    const ok = response.ok;
    let status = ok ? 'ok' : 'error';
    let error = '';
    if (!ok) {
      error = `服务器返回 HTTP ${response.status}`;
    } else if (response.redirected && /\/login\.html(?:\?|$)/.test(response.url || '')) {
      status = 'warn';
      error = '请求被重定向到登录页';
    } else if (target.type === 'page' && !/text\/html/i.test(contentType)) {
      status = 'warn';
      error = `返回内容不是 HTML：${contentType || '未知类型'}`;
    } else if (target.type === 'api' && !/json/i.test(contentType)) {
      status = 'warn';
      error = `返回内容不是 JSON：${contentType || '未知类型'}`;
    } else if (target.type === 'asset' && text.length <= 0) {
      status = 'warn';
      error = '资源内容为空';
    }

    return {
      ...target,
      status,
      httpStatus: response.status,
      contentType,
      elapsedMs,
      checkedAt,
      error,
      size: text.length,
    };
  } catch (error) {
    return {
      ...target,
      status: 'error',
      httpStatus: 0,
      contentType: '',
      elapsedMs: Date.now() - startedAt,
      checkedAt,
      error: error?.message || '读取失败',
      size: 0,
    };
  }
}

async function runConsolePageCheck() {
  setConsolePageCheckLoading(true);
  renderConsolePageCheckLoading();
  const items = [];
  try {
    for (const target of CONSOLE_PAGE_CHECK_TARGETS) {
      const item = await inspectConsolePageTarget(target);
      items.push(item);
      setLastConsolePageCheckPayload({
        success: true,
        generatedAt: new Date().toISOString(),
        pageUrl: window.location.href,
        summary: buildConsolePageCheckSummary(items),
        items,
      });
      renderConsolePageCheckResult(lastConsolePageCheckPayload);
      updateConsolePageCheckProgress(items.length, CONSOLE_PAGE_CHECK_TARGETS.length);
    }
    setLastConsolePageCheckPayload({
      success: true,
      generatedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      summary: buildConsolePageCheckSummary(items),
      items,
    });
    renderConsolePageCheckResult(lastConsolePageCheckPayload);
    return lastConsolePageCheckPayload;
  } finally {
    setConsolePageCheckLoading(false);
  }
}

function buildSupportBundleFrontendPayload() {
  const metrics = window.CrystelfRequest?.getMetrics?.() || null;
  const requestTiming = metrics
    ? {
        summary: {
          totalCount: metrics.totalCount,
          successCount: metrics.successCount,
          errorCount: metrics.errorCount,
          slowCount: metrics.slowCount,
          averageMs: metrics.averageMs,
          thresholdMs: metrics.thresholdMs,
        },
        items: Array.isArray(metrics.items) ? metrics.items.slice(0, 30) : [],
      }
    : null;
  return {
    source: document.getElementById('log-diagnosis-source')?.value || 'auto',
    includeWarnings: document.getElementById('log-diagnosis-include-warnings')?.checked !== false,
    pageUrl: window.location.href,
    userAgent: navigator.userAgent || '',
    pageCheck: getLastConsolePageCheckPayload(),
    pageLoadDiagnostics: window.CrystelfPageLoadDiagnostics?.buildDiagnostic?.() || null,
    frontendErrors: window.CrystelfFrontendErrors?.buildDiagnostic?.() || null,
    requestTiming,
  };
}

function downloadSupportBundleFile(payload = {}) {
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = payload.fileName || `crystelf-support-bundle-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportSupportBundle() {
  setSupportBundleExportLoading(true);
  try {
    if (!getLastConsolePageCheckPayload()) {
      await runConsolePageCheck();
    }
    const response = await postJson('/api/support-bundle', buildSupportBundleFrontendPayload());
    downloadSupportBundleFile(response);
    const safeTip = response?.privacy?.note || '排障包已脱敏，发送前仍建议快速浏览一遍。';
    await openModal('脱敏排障包已导出', safeTip, { showCancel: false });
  } catch (error) {
    await openModal('导出失败', error.message || '排障包导出失败', { showCancel: false });
  } finally {
    setSupportBundleExportLoading(false);
  }
}

window.CrystelfConsolePageCheck = {
  run: runConsolePageCheck,
  getLastResult() {
    return getLastConsolePageCheckPayload();
  },
  render: renderConsolePageCheckResult,
};

window.CrystelfSupportBundle = {
  export: exportSupportBundle,
  buildFrontendPayload: buildSupportBundleFrontendPayload,
};
