// 群管理风控面板：聚合近 N 天风控动作统计。由 group-management.html 在 group-management.js 前加载。

let groupManagementInsightsDays = 7;
let groupManagementInsightsLoading = false;

function formatGmInsightsNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('zh-CN');
}

function formatGmInsightsTime(iso = '') {
  const time = new Date(iso || 0);
  if (!iso || Number.isNaN(time.getTime())) return '—';
  return time.toLocaleString('zh-CN', { hour12: false });
}

function renderGmInsightsTrend(trend = []) {
  const filled = trend.filter(item => item.total > 0);
  if (!filled.length) return '';
  const max = Math.max(...filled.map(item => item.total), 1);
  const cells = trend.map(item => {
    const height = item.total > 0 ? Math.max(8, Math.round((item.total / max) * 56)) : 2;
    const title = `${item.date || '-'}  共 ${item.total} 条（风控 ${item.moderation} / 加群 ${item.join} / 头衔 ${item.title}）`;
    return `<div class="gm-insights-trend-cell" title="${title}">
      <div class="gm-insights-trend-value">${item.total > 0 ? item.total : ''}</div>
      <div class="gm-insights-trend-bar" style="height:${height}px"></div>
      <div class="gm-insights-trend-date">${(item.date || '').slice(5) || '-'}</div>
    </div>`;
  }).join('');
  return `<div class="gm-insights-trend">${cells}</div>`;
}

function renderGmInsightsTopActions(items = []) {
  if (!items.length) return '';
  const max = Math.max(...items.map(item => item.count), 1);
  const rows = items.map(item => `
    <div class="gm-insights-top-row">
      <span class="gm-insights-top-label">${escapeHtml(item.label || item.action)}</span>
      <span class="gm-insights-top-bar"><i style="width:${Math.round((item.count / max) * 100)}%"></i></span>
      <span class="gm-insights-top-count">${formatGmInsightsNumber(item.count)}</span>
    </div>
  `).join('');
  return `<div class="gm-insights-top"><div class="gm-insights-top-title">命中动作 TOP</div>${rows}</div>`;
}

function renderGmInsightsTopUsers(items = []) {
  if (!items.length) return '';
  const rows = items.map(item => `
    <div class="gm-insights-top-row">
      <span class="gm-insights-top-label">${escapeHtml(item.nickname || item.userId || '-')}<small>${escapeHtml(item.userId || '')}</small></span>
      <span class="gm-insights-top-count">${item.count} 条${item.actions ? ` · 处置 ${item.actions}` : ''}</span>
    </div>
  `).join('');
  return `<div class="gm-insights-top"><div class="gm-insights-top-title">被记录用户 TOP</div>${rows}</div>`;
}

function renderGroupManagementInsights(payload = {}) {
  const box = document.getElementById('group-management-insights');
  const meta = document.getElementById('group-management-insights-meta');
  if (!box) return;
  const totals = payload.totals || {};
  const hasData = Number(totals.entries || 0) > 0;

  if (meta) {
    meta.textContent = hasData
      ? `近 ${payload.days || 7} 天共 ${formatGmInsightsNumber(totals.entries)} 条记录 · 生成于 ${formatGmInsightsTime(payload.generatedAt)}`
      : '所选时间范围内暂无风控记录';
  }

  if (!hasData) {
    box.innerHTML = '<div class="setting-help">近 ' + (payload.days || 7) + ' 天暂无风控动作记录。机器人开始处理风控后，这里会展示动作趋势、命中 TOP 与被处置用户。</div>';
    return;
  }

  box.innerHTML = `
    <div class="gm-insights-summary">
      <div class="gm-insights-stat"><span>记录总数</span><strong>${formatGmInsightsNumber(totals.entries)}</strong></div>
      <div class="gm-insights-stat"><span>消息风控命中</span><strong>${formatGmInsightsNumber(totals.moderationTriggered)}</strong></div>
      <div class="gm-insights-stat"><span>失败操作</span><strong>${formatGmInsightsNumber(totals.failedCount)}</strong></div>
      <div class="gm-insights-stat"><span>控制台改动</span><strong>${formatGmInsightsNumber(totals.webConsoleChanges)}</strong></div>
    </div>
    ${renderGmInsightsTrend(payload.trend || [])}
    <div class="gm-insights-tops">
      ${renderGmInsightsTopActions(payload.topActions || [])}
      ${renderGmInsightsTopUsers(payload.topUsers || [])}
    </div>
  `;
}

async function loadGroupManagementInsights(days = groupManagementInsightsDays) {
  const box = document.getElementById('group-management-insights');
  if (!box || groupManagementInsightsLoading) return;
  groupManagementInsightsLoading = true;
  groupManagementInsightsDays = days;
  document.querySelectorAll('.gm-insights-days-toggle').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.days) === Number(days));
  });
  try {
    box.textContent = '正在加载风控统计...';
    const response = await fetch(`/api/group-management/insights?days=${Number(days) || 7}`, { cache: 'no-store', credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      box.textContent = `风控统计加载失败：${data.error || response.status}`;
      return;
    }
    renderGroupManagementInsights(data);
  } catch (error) {
    box.textContent = `风控统计加载失败：${error.message || '未知错误'}`;
  } finally {
    groupManagementInsightsLoading = false;
  }
}

document.addEventListener('click', event => {
  const target = event.target.closest('.gm-insights-days-toggle');
  if (target?.dataset.days) {
    loadGroupManagementInsights(Number(target.dataset.days));
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => loadGroupManagementInsights());
} else {
  loadGroupManagementInsights();
}
