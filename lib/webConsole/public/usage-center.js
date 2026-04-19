const state = {
  page: 1,
  refreshPromise: null,
  filterRefreshTimer: null,
};

function buildHeaders(extra = {}) {
  return { ...extra };
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

function formatSceneLabel(scene) {
  const key = String(scene || '').trim();
  const sceneMap = {
    chat: '普通对话',
    chat_text: '文本对话',
    chat_multimodal: '多模态对话',
    chat_engine: '对话引擎',
    chat_engine_fallback: '对话引擎兜底',
    chat_engine_final: '对话引擎最终回复',
    poke_follow_reply: '戳一戳接话回复',
    poke_ai_reply: '戳一戳 AI 回复',
    poke_image_summary: '戳一戳图片摘要',
    image_monitor_review: '图片监控审核',
  };
  return sceneMap[key] || key || '未知场景';
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: buildHeaders(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `${url} -> ${response.status}`);
  }
  return data;
}

async function downloadExport(type, params = {}) {
  const query = new URLSearchParams({ type, ...params });
  const response = await fetch(`/api/export?${query.toString()}`, { headers: buildHeaders() });
  if (!response.ok) {
    throw new Error(`导出失败: ${response.status}`);
  }
  const text = await response.text();
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${type}-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getFilters() {
  return {
    query: document.getElementById('usage-log-search')?.value?.trim() || '',
    scene: document.getElementById('usage-log-scene')?.value?.trim() || '',
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
  state.page = 1;
  syncSceneButtons();
}

function scheduleRefresh(delay = 260) {
  if (state.filterRefreshTimer) {
    clearTimeout(state.filterRefreshTimer);
  }
  state.filterRefreshTimer = window.setTimeout(() => {
    state.filterRefreshTimer = null;
    refreshUsageCenter().catch(error => window.alert(error.message));
  }, delay);
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
    buildSummaryCard('Token 与成本', [
      { label: '总 Tokens', value: formatNumber(usage.totalTokens || 0) },
      { label: '估算成本', value: `${currency}${Number(usage.totalCost || 0).toFixed(6)}` },
      { label: '错误率', value: `${usage.requestCount > 0 ? ((Number(usage.errorCount || 0) / Number(usage.requestCount || 1)) * 100).toFixed(2) : '0.00'}%` },
    ]),
    buildSummaryCard('图片监控审核', [
      { label: '请求数', value: formatNumber(imageMonitor.requestCount || 0) },
      { label: '总 Tokens', value: formatNumber(imageMonitor.totalTokens || 0) },
      { label: '平均 Tokens', value: formatNumber(imageMonitor.averageTokens || 0) },
    ]),
    buildSummaryCard('戳一戳图片摘要', [
      { label: '请求数', value: formatNumber(pokeImageSummary.requestCount || 0) },
      { label: '总 Tokens', value: formatNumber(pokeImageSummary.totalTokens || 0) },
      { label: '平均 Tokens', value: formatNumber(pokeImageSummary.averageTokens || 0) },
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
    `总 Tokens: ${formatNumber(usage.totalTokens || 0)}`,
    `总成本: ${(usage.currencySymbol || '$')}${Number(usage.totalCost || 0).toFixed(6)}`,
    '',
    '图片相关场景',
    `图片监控审核: ${formatNumber(imageMonitor.requestCount || 0)} 次 / ${formatNumber(imageMonitor.totalTokens || 0)} Tokens`,
    `戳一戳图片摘要: ${formatNumber(pokeImageSummary.requestCount || 0)} 次 / ${formatNumber(pokeImageSummary.totalTokens || 0)} Tokens`,
  ].join('\n');

  const sceneLines = Object.entries(usage.byScene || {})
    .sort((a, b) => Number(b[1]?.requests || 0) - Number(a[1]?.requests || 0))
    .map(([scene, item]) => `${formatSceneLabel(scene)}: ${formatNumber(item?.requests || 0)} 次 / ${formatNumber(item?.total_tokens || 0)} Tokens`);

  document.getElementById('scene-summary-box').textContent = sceneLines.length > 0
    ? sceneLines.join('\n')
    : '今日暂无按场景统计的 AI 用量数据';
}

function renderTrend(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  document.getElementById('trend-chart').textContent = items.length > 0
    ? items.map(item => {
        const bar = '#'.repeat(Math.max(1, Math.min(30, Number(item.requests || 0))));
        return `${item.hour}  ${bar}  请求:${item.requests}  Tokens:${item.tokens}  错误:${item.errors}`;
      }).join('\n')
    : '最近 24 小时暂无 AI 用量趋势数据';
}

function renderLogs(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const html = items.length > 0
    ? items.map(item => `
      <div class="list-item log-entry-card ${item.error ? 'tone-error' : ''}">
        <div class="log-entry-head">
          <div>
            <h3>${escapeHtml(formatSceneLabel(item.scene))}</h3>
            <div class="setting-help">${escapeHtml(formatTime(item.time))}</div>
          </div>
          <div class="detail-tags">
            <span class="detail-tag ${item.error ? 'tone-error' : 'tone-success'}">${item.error ? '失败' : '成功'}</span>
            <span class="detail-tag">${escapeHtml(item.model || '未知模型')}</span>
            <span class="detail-tag">Tokens ${formatNumber(item.total_tokens || 0)}</span>
            ${item.elapsed_ms != null ? `<span class="detail-tag">耗时 ${formatNumber(item.elapsed_ms)}ms</span>` : ''}
          </div>
        </div>
        <div class="log-entry-meta">
          <span>会话 ${escapeHtml(item.session_id || '暂无')}</span>
          <span>群 ${escapeHtml(item.group_id || '暂无')}</span>
          <span>用户 ${escapeHtml(item.user_id || '暂无')}</span>
        </div>
        <div class="log-entry-preview">
          <div class="log-entry-label">提示词预览</div>
          <div class="log-entry-text">${escapeHtml(item.display_prompt_preview || item.prompt_preview || '暂无')}</div>
        </div>
        <div class="log-entry-preview">
          <div class="log-entry-label">${item.error ? '错误信息' : '响应预览'}</div>
          <div class="log-entry-text">${escapeHtml(item.display_response_preview || item.response_preview || item.error || '暂无')}</div>
        </div>
        <div class="actions">
          <a class="link-btn" href="/usage-log-detail.html?id=${encodeURIComponent(item.id || '')}">详情</a>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无 AI 用量日志</div>';

  document.getElementById('usage-log-box').innerHTML = html;
  renderPagination('usage-log-pagination', data?.page, data?.totalPages, page => {
    state.page = page;
    refreshUsageCenter().catch(error => window.alert(error.message));
  });
}

async function refreshUsageCenter() {
  if (state.refreshPromise) {
    return state.refreshPromise;
  }

  const filters = getFilters();
  syncSceneButtons();
  setRefreshStatus('正在刷新 AI 用量页面...', 'neutral');
  setRefreshButtonState(true);

  const params = new URLSearchParams({
    query: filters.query,
    scene: filters.scene,
    page: String(state.page || 1),
  });

  const startedAt = Date.now();
  state.refreshPromise = (async () => {
    try {
      const [overview, trend, logs] = await Promise.all([
        fetchJson('/api/overview'),
        fetchJson('/api/trend/usage'),
        fetchJson(`/api/logs/usage?${params.toString()}`),
      ]);

      renderSummary(overview);
      renderDailyOverview(overview);
      renderTrend(trend);
      renderLogs(logs);

      const total = Number(logs.total || logs.items?.length || 0);
      const elapsedMs = Date.now() - startedAt;
      setPageMeta(`今日 AI 用量日志 ${formatNumber(total)} 条，当前第 ${formatNumber(logs.page || 1)} / ${formatNumber(logs.totalPages || 1)} 页`);
      setRefreshStatus(`最近刷新：${formatTime(Date.now())} / ${elapsedMs} ms / 日志 ${formatNumber(total)} 条`, 'neutral');
      return { overview, trend, logs };
    } catch (error) {
      setPageMeta('AI 用量日志中心加载失败');
      setRefreshStatus(`加载失败：${error.message}`, 'error');
      throw error;
    } finally {
      state.refreshPromise = null;
      setRefreshButtonState(false);
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
    refreshUsageCenter().catch(error => window.alert(error.message));
  }
});

document.addEventListener('DOMContentLoaded', () => {
syncSceneButtons();
document.getElementById('refresh-btn').addEventListener('click', () => {
    refreshUsageCenter().catch(error => window.alert(error.message));
  });

  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    resetFilters();
    refreshUsageCenter().catch(error => window.alert(error.message));
  });

  document.getElementById('export-usage-logs-btn').addEventListener('click', () => {
    const filters = getFilters();
    downloadExport('usage-logs', filters).catch(error => window.alert(error.message));
  });

  ['usage-log-search', 'usage-log-scene'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      state.page = 1;
      syncSceneButtons();
      scheduleRefresh();
    });
  });

  refreshUsageCenter().catch(error => {
    document.body.innerHTML = `<pre>AI 用量日志中心初始化失败：${escapeHtml(error.message)}</pre>`;
  });
});
