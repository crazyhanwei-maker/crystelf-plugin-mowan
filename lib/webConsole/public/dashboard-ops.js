// 总览页运维速览：审计日志 / API 质量 / 配置备份 / 微信桥状态 + KPI 卡带 24h 迷你趋势图。
// 数据全部复用 app.js refresh() 已拉取的接口结果（auditLogs/performance/trend），仅微信桥在
// refresh() 尾部补一次 /api/weixin-bridge 轻量请求；备份列表因不在 refresh 主并行里，模块自取。
(function () {
  'use strict';

  const opsState = { bridge: null, backups: null, backupsFetching: false };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('zh-CN');
  }

  function formatTime(value) {
    const ts = Date.parse(value || '');
    if (!Number.isFinite(ts)) return '—';
    const date = new Date(ts);
    const pad = input => String(input).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // ===== 审计速览 =====
  function renderAudit(auditLogs = {}) {
    const body = document.querySelector('#opsrow-audit .ops-row-body');
    if (!body) return;
    const items = Array.isArray(auditLogs.items) ? auditLogs.items.slice(0, 5) : [];
    if (!items.length) {
      body.innerHTML = '<div class="ops-row-empty">暂无审计记录。</div>';
      return;
    }
    body.innerHTML = items.map(item => `
      <div class="ops-line"><time>${escapeHtml(formatTime(item.time))}</time><code>${escapeHtml(item.method || '')}</code><span>${escapeHtml(item.path || item.action || '-')}</span></div>
    `).join('');
  }

  // ===== API 质量速览 =====
  function renderApiQuality(performance = {}) {
    const body = document.querySelector('#opsrow-api .ops-row-body');
    if (!body) return;
    const quality = performance?.apiQuality;
    const last24h = quality?.last24h || {};
    const total = last24h.total || {};
    const today = quality?.today?.total || {};
    const fallbackShare = Number(performance?.apiQuality?.today?.fallbackShare || 0);
    const slowCount = Number(last24h.slowCount ?? performance?.apiQuality?.last24h?.slowCount ?? 0);
    const alertSummary = quality?.alerts?.summary || '';
    const errorRatePct = Number(total.errorRate ?? 0); // 接口返回的已是百分数值（如 100 = 100%）
    body.innerHTML = `
      <div class="ops-line"><span>24h 请求</span><strong>${formatNumber(total.requestCount || 0)}</strong><span>失败率 ${errorRatePct.toFixed(1)}%</span></div>
      <div class="ops-line"><span>今日请求</span><strong>${formatNumber(today.requestCount || 0)}</strong><span>备库占比 ${(fallbackShare * 100).toFixed(0)}%</span></div>
      ${slowCount > 0 ? `<div class="ops-line tone-warn"><span>慢请求</span><strong>${formatNumber(slowCount)}</strong><span>超过 10s</span></div>` : ''}
      ${alertSummary ? `<div class="ops-line"><span>告警</span><span class="ops-line-text">${escapeHtml(String(alertSummary).slice(0, 60))}</span></div>` : ''}
    `;
  }

  // ===== 备份状态 =====
  async function fetchBackups() {
    if (opsState.backups || opsState.backupsFetching) return opsState.backups;
    opsState.backupsFetching = true;
    try {
      const resp = await fetch('/api/task-center/backups');
      const data = await resp.json();
      opsState.backups = Array.isArray(data?.backups) ? data.backups : [];
    } catch {
      opsState.backups = [];
    } finally {
      opsState.backupsFetching = false;
    }
    return opsState.backups;
  }

  function renderBackup(backups = null) {
    const body = document.querySelector('#opsrow-backup .ops-row-body');
    if (!body) return;
    const list = Array.isArray(backups) ? backups : [];
    if (!list.length) {
      body.innerHTML = '<div class="ops-row-empty">暂无备份。可在任务中心手动触发。</div>';
      return;
    }
    const latest = list[0];
    body.innerHTML = `
      <div class="ops-line"><span>最近备份</span><strong>${escapeHtml(formatTime(new Date(latest.time).toISOString()))}</strong></div>
      <div class="ops-line"><span>累计 ${formatNumber(list.length)} 份</span><span>最新 ${escapeHtml(String(latest.name || '').replace('config-backup-', '').slice(0, 24))}</span></div>
    `;
  }

  // ===== 微信桥状态 =====
  async function fetchBridge() {
    try {
      const resp = await fetch('/api/weixin-bridge');
      const data = await resp.json();
      opsState.bridge = data?.bridge || null;
    } catch {
      opsState.bridge = null;
    }
    return opsState.bridge;
  }

  function renderBridge(bridge = null) {
    const body = document.querySelector('#opsrow-bridge .ops-row-body');
    if (!body) return;
    if (!bridge) {
      body.innerHTML = '<div class="ops-row-empty">微信桥状态暂不可用。</div>';
      return;
    }
    const stateLabel = !bridge.loggedIn
      ? { text: '未登录', tone: 'tone-error' }
      : (bridge.pollerRunning ? { text: '运行中', tone: 'tone-ok' } : { text: '已登录 · 轮询停止', tone: 'tone-warn' });
    body.innerHTML = `
      <div class="ops-line"><span>状态</span><strong class="${stateLabel.tone}">${escapeHtml(stateLabel.text)}</strong></div>
      <div class="ops-line"><span>botId</span><span class="ops-line-text">${escapeHtml(bridge.botId || '—')}</span><span>白名单 ${formatNumber(bridge.allowedUsers)} 人</span></div>
    `;
  }

  // ===== KPI 卡带 24h 迷你趋势图 =====
  // 只画在「AI 请求」一张卡上（多张卡的跳转目标同为 aidata，不能按 target 区分）
  function renderTrendSparkline(trend = {}) {
    const items = Array.isArray(trend.items) ? trend.items.slice(-24) : [];
    document.querySelectorAll('#dashboard-kpi-band .kpi-card').forEach(card => {
      const old = card.querySelector('.kpi-spark');
      if (old) old.remove();
      if (!items.length) return;
      const label = card.querySelector('.kpi-label')?.textContent || '';
      if (label !== 'AI 请求') return;
      const values = items.map(item => Number(item.requests || 0));
      const max = Math.max(...values, 1);
      const width = 90;
      const height = 26;
      const step = values.length > 1 ? width / (values.length - 1) : width;
      const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - (value / max) * (height - 4) - 2).toFixed(1)}`);
      card.querySelector('.kpi-main')?.insertAdjacentHTML('beforeend', `
        <svg class="kpi-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="${points.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>`);
    });
  }

  // ===== 刷新入口（app.js 每次 refresh 后调用）=====
  async function refresh(payload = {}) {
    renderAudit(payload.auditLogs);
    renderApiQuality(payload.performance);
    renderTrendSparkline(payload.trend);
    // 备份与微信桥：低频数据，60 秒内复用缓存
    const now = Date.now();
    if (!opsState.lastSlowAt || now - opsState.lastSlowAt > 60000) {
      opsState.lastSlowAt = now;
      const [backups, bridge] = await Promise.all([fetchBackups(), fetchBridge()]);
      renderBackup(backups);
      renderBridge(bridge);
    } else {
      renderBackup(opsState.backups || []);
      renderBridge(opsState.bridge);
    }
  }

  window.CrystelfDashboardOps = { refresh };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      refresh({});
    });
  } else {
    refresh({});
  }
})();
