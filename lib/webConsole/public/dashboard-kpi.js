// 总览页增强：① 顶部 KPI 数据汇总卡（图标 + 数字 + 副文本，点击跳转对应模块）
// ② 模块自定义：各大面板可开关/排序，localStorage 按浏览器记忆
// 数据完全复用 app.js refresh() 已拉取的接口结果，不额外发请求
(function () {
  'use strict';

  const LAYOUT_KEY = 'crystelf-dashboard-layout-v1';
  const MODULES = [
    { id: 'kpi', label: '数据汇总卡' },
    { id: 'resource', label: '系统资源' },
    { id: 'opsrows', label: '运维速览' },
    { id: 'tasks', label: '操作任务中心' },
    { id: 'security', label: '公网访问安全' },
    { id: 'pagestatus', label: '页面状态' },
    { id: 'aidata', label: 'AI 数据预览' },
    { id: 'logdiag', label: '日志排查' },
    { id: 'support', label: '巡检与排障包' },
    { id: 'tools', label: '独立工具入口' },
  ];
  const knownIds = new Set(MODULES.map(item => item.id));
  const kpiState = { version: null };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== 模块布局 =====
  function loadLayout() {
    let layout = { order: [], hidden: [] };
    try {
      const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
      if (raw && typeof raw === 'object') {
        layout.order = (Array.isArray(raw.order) ? raw.order : []).filter(id => knownIds.has(id));
        layout.hidden = (Array.isArray(raw.hidden) ? raw.hidden : []).filter(id => knownIds.has(id));
      }
    } catch {
      // 存储损坏时回退默认布局
    }
    // 新增模块补到末尾；已下线的模块剔除；系统资源条紧跟汇总卡（老布局用户也能看到合理位置）
    for (const item of MODULES) {
      if (!layout.order.includes(item.id)) {
        if (item.id === 'resource' && layout.order.includes('kpi')) {
          layout.order.splice(layout.order.indexOf('kpi') + 1, 0, 'resource');
        } else if (item.id === 'opsrows' && layout.order.includes('resource')) {
          layout.order.splice(layout.order.indexOf('resource') + 1, 0, 'opsrows');
        } else {
          layout.order.push(item.id);
        }
      }
    }
    layout.order = layout.order.filter(id => knownIds.has(id));
    layout.hidden = [...new Set(layout.hidden)].filter(id => knownIds.has(id));
    return layout;
  }

  function saveLayout(layout) {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // 隐私模式等存储不可用：本次会话内仍然生效
    }
  }

  function applyLayout(layout) {
    const page = document.querySelector('.page');
    if (!page) return;
    // 依次 appendChild 面板完成排序（hero/mobile 栏不在 MODULES 里，始终保持在最前）。
    // 必须限定 .page 直接子元素：自定义弹层的排序按钮若也用 data-module-id 会被误抓进页面
    for (const id of layout.order) {
      const panel = page.querySelector(`:scope > [data-module-id="${id}"]`);
      if (panel) page.appendChild(panel);
    }
    for (const item of MODULES) {
      const panel = document.querySelector(`[data-module-id="${item.id}"]`);
      if (!panel) continue;
      const hidden = layout.hidden.includes(item.id);
      panel.classList.toggle('module-hidden', hidden);
      panel.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }
  }

  function renderLayoutPopover() {
    const popover = document.getElementById('dashboard-layout-popover');
    if (!popover || popover.classList.contains('hidden')) return;
    const layout = loadLayout();
    const labelById = new Map(MODULES.map(item => [item.id, item.label]));
    popover.innerHTML = [
      '<div class="dashboard-layout-popover-head"><strong>模块自定义</strong><span>开关显示 · 箭头排序，自动保存</span></div>',
      ...layout.order.map((id, index) => {
        const hidden = layout.hidden.includes(id);
        return `<div class="dashboard-layout-row${hidden ? ' is-hidden' : ''}">
          <label><input type="checkbox" data-module-toggle="${escapeHtml(id)}" ${hidden ? '' : 'checked'} /> <span>${escapeHtml(labelById.get(id) || id)}</span></label>
          <span class="dashboard-layout-move">
            <button type="button" class="mini-btn" data-module-move="up" data-layout-move-id="${escapeHtml(id)}" ${index === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
            <button type="button" class="mini-btn" data-module-move="down" data-layout-move-id="${escapeHtml(id)}" ${index === layout.order.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
          </span>
        </div>`;
      }),
      '<div class="dashboard-layout-popover-foot"><button type="button" class="mini-btn" id="dashboard-layout-reset">恢复默认</button></div>',
    ].join('');
  }

  function moveModule(id, delta) {
    const layout = loadLayout();
    const index = layout.order.indexOf(id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= layout.order.length) return;
    [layout.order[index], layout.order[next]] = [layout.order[next], layout.order[index]];
    saveLayout(layout);
    applyLayout(layout);
    renderLayoutPopover();
  }

  function toggleModule(id, visible) {
    const layout = loadLayout();
    layout.hidden = layout.hidden.filter(item => item !== id);
    if (!visible) layout.hidden.push(id);
    saveLayout(layout);
    applyLayout(layout);
    renderLayoutPopover();
  }

  function initLayout() {
    const layout = loadLayout();
    applyLayout(layout);
    const button = document.getElementById('dashboard-customize-btn');
    const popover = document.getElementById('dashboard-layout-popover');
    if (!button || !popover) return;
    // console-modern 布局壳的祖先层叠上下文会把 fixed 弹层压在内容面板之下：
    // 打开时把弹层搬到 body 直下，彻底脱离局部上下文（关闭后留在 body 无碍，display:none）
    if (popover.parentElement !== document.body) document.body.appendChild(popover);
    button.addEventListener('click', () => {
      const willOpen = popover.classList.contains('hidden');
      popover.classList.toggle('hidden', !willOpen);
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) {
        renderLayoutPopover();
        // hero 是 overflow:hidden（背景图裁剪），弹层放 hero 内会被裁掉：
        // 改为 fixed 定位，打开时按按钮当前视口坐标对齐
        const rect = button.getBoundingClientRect();
        popover.style.top = `${Math.round(rect.bottom + 8)}px`;
        popover.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
      }
    });
    // 滚动时按钮坐标失效：直接收起弹层，避免悬浮错位
    window.addEventListener('scroll', () => {
      if (popover.classList.contains('hidden')) return;
      popover.classList.add('hidden');
      button.setAttribute('aria-expanded', 'false');
    }, { passive: true });
    document.addEventListener('click', event => {
      if (popover.classList.contains('hidden')) return;
      if (event.target.closest('#dashboard-layout-popover') || event.target.closest('#dashboard-customize-btn')) return;
      popover.classList.add('hidden');
      button.setAttribute('aria-expanded', 'false');
    });
    popover.addEventListener('change', event => {
      const toggle = event.target.closest?.('[data-module-toggle]');
      if (!toggle) return;
      toggleModule(toggle.dataset.moduleToggle || '', toggle.checked === true);
    });
    popover.addEventListener('click', event => {
      const move = event.target.closest?.('[data-module-move]');
      if (move) {
        moveModule(move.dataset.layoutMoveId || '', move.dataset.moduleMove === 'up' ? -1 : 1);
        return;
      }
      if (event.target.closest?.('#dashboard-layout-reset')) {
        try { localStorage.removeItem(LAYOUT_KEY); } catch { }
        const fresh = loadLayout();
        applyLayout(fresh);
        renderLayoutPopover();
      }
    });
  }

  // ===== KPI 数据汇总卡 =====
  // 图标采用 lucide 风格线性 SVG（与 artd.pro 参考样式一致），色调随状态变化
  const KPI_ICONS = {
    bot: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="15" x2="22" y2="15"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="15" x2="4" y2="15"/>',
    health: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    fail: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    version: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  };

  function kpiIcon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${KPI_ICONS[name] || ''}</svg>`;
  }

  function buildKpiCards(context = {}) {
    const overview = context.overview || {};
    const usage = overview.usage || {};
    const counts = overview.counts || {};
    const image = usage.imageMonitor || {};
    const healthSummary = (context.health && context.health.summary) || {};
    const taskSummary = (context.tasks && context.tasks.summary) || {};
    const security = overview.webConsoleSecurity || {};
    const watchdog = context.botWatchdog || {};
    const versionResult = kpiState.version;
    const cards = [];

    const botOnline = Number(watchdog.onlineCount || 0);
    cards.push({
      icon: kpiIcon('bot'),
      value: watchdog.enabled ? `${botOnline} 个` : '—',
      label: 'Bot 在线',
      sub: watchdog.enabled ? (watchdog.offline ? '看门狗：掉线告警' : '看门狗运行中') : '看门狗未开启',
      tone: watchdog.enabled ? (watchdog.offline ? 'error' : 'ok') : 'neutral',
      target: 'pagestatus',
    });

    const healthStatus = String(healthSummary.status || 'error');
    const healthLabel = healthStatus === 'ok' ? '正常' : (healthStatus === 'warn' ? '告警' : '异常');
    cards.push({
      icon: kpiIcon('health'),
      value: healthLabel,
      label: '运行健康',
      sub: `${formatNumber(healthSummary.issueCount || 0)} 项待处理`,
      tone: healthStatus === 'ok' ? 'ok' : (healthStatus === 'warn' ? 'warn' : 'error'),
      target: 'pagestatus',
    });

    const requestCount = Number(usage.requestCount || 0);
    const successCount = Number(usage.successCount || 0);
    cards.push({
      icon: kpiIcon('zap'),
      value: formatNumber(requestCount),
      label: 'AI 请求',
      sub: requestCount > 0 ? `成功率 ${Math.round((successCount / requestCount) * 1000) / 10}%` : '暂无请求',
      tone: 'neutral',
      target: 'aidata',
    });

    cards.push({
      icon: kpiIcon('chart'),
      value: formatNumber(Number(usage.totalTokens || 0)),
      label: 'Token 用量',
      sub: Number(usage.totalCost || 0) > 0 ? `${usage.currencySymbol || '$'}${usage.totalCost}` : `会话 ${formatNumber(Number(counts.sessions || 0))}`,
      tone: 'neutral',
      target: 'aidata',
    });

    const errorCount = Number(usage.errorCount || 0);
    cards.push({
      icon: kpiIcon('fail'),
      value: formatNumber(errorCount),
      label: '失败请求',
      sub: errorCount > 0 ? '需要关注' : '一切正常',
      tone: errorCount > 0 ? 'error' : 'ok',
      target: 'aidata',
    });

    cards.push({
      icon: kpiIcon('image'),
      value: formatNumber(Number(image.requestCount || 0)),
      label: '图片监控',
      sub: Number(image.requestCount || 0) > 0 ? `成功 ${formatNumber(Number(image.successCount || 0))}` : '暂无产出',
      tone: 'neutral',
      target: 'aidata',
    });

    const activeTasks = Number(taskSummary.activeCount || 0);
    cards.push({
      icon: kpiIcon('layers'),
      value: formatNumber(activeTasks),
      label: '进行中任务',
      sub: `累计 ${formatNumber(Number(taskSummary.total || 0))} 个`,
      tone: activeTasks > 0 ? 'warn' : 'ok',
      target: 'tasks',
    });

    const publicHost = security.publicHost === true;
    cards.push({
      icon: kpiIcon('shield'),
      value: security.accessScopeLabel || (publicHost ? '外部可访问' : '仅本机'),
      label: '访问安全',
      sub: security.loginConfigured ? '口令已配置' : '口令未配置',
      tone: security.riskLevel === 'success' ? 'ok' : (security.riskLevel || (publicHost ? 'warn' : 'ok')),
      target: 'security',
    });

    const version = overview.plugin?.version || '-';
    const hasUpdate = Boolean(versionResult && (versionResult.updateAvailable === true || versionResult.status === 'update_available'));
    cards.push({
      icon: kpiIcon('version'),
      value: `v${version}`,
      label: '插件版本',
      sub: !versionResult ? '待检查' : (hasUpdate ? '有新版本' : '已是最新'),
      tone: hasUpdate ? 'warn' : 'ok',
      target: null,
    });

    return cards;
  }

  function renderKpi(context = {}) {
    const band = document.getElementById('dashboard-kpi-band');
    if (!band) return;
    const cards = buildKpiCards(context);
    band.innerHTML = cards.map(card => `
      <div class="kpi-card tone-${escapeHtml(card.tone)}" ${card.target ? `data-kpi-target="${escapeHtml(card.target)}" role="button" tabindex="0"` : ''}>
        <div class="kpi-main">
          <span class="kpi-label">${escapeHtml(card.label)}</span>
          <strong class="kpi-value">${escapeHtml(card.value)}</strong>
          <small class="kpi-sub">${escapeHtml(card.sub)}</small>
        </div>
        <span class="kpi-icon" aria-hidden="true">${card.icon}</span>
      </div>
    `).join('');
  }

  function setVersion(result) {
    kpiState.version = result;
  }

  // ===== 系统资源条 =====
  // 数据来自 /api/performance 的 runtime 字段（app.js 每次刷新已拉取），纯前端渲染
  function formatResourceBytes(bytes = 0) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let result = value;
    let unitIndex = 0;
    while (result >= 1024 && unitIndex < units.length - 1) {
      result /= 1024;
      unitIndex += 1;
    }
    return `${result >= 100 ? Math.round(result) : result.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatResourceUptime(ms = 0) {
    const totalMinutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days > 0) parts.push(`${days} 天`);
    if (hours > 0) parts.push(`${hours} 小时`);
    if (!parts.length || minutes > 0) parts.push(`${minutes} 分钟`);
    return parts.slice(0, 2).join(' ');
  }

  function renderResourceStrip(performance = {}) {
    const strip = document.getElementById('dashboard-resource-strip');
    if (!strip) return;
    const runtime = performance?.runtime;
    if (!runtime || !runtime.memory) {
      strip.innerHTML = '<div class="kpi-placeholder">资源数据将在下次刷新后显示。</div>';
      return;
    }
    const memory = runtime.memory || {};
    const load = Array.isArray(runtime.loadAverage) ? runtime.loadAverage.map(item => Number(item || 0)) : [];
    const loadMean = load.length ? load.reduce((sum, item) => sum + item, 0) / load.length : 0;
    const cells = [
      {
        label: '内存占用',
        value: `${Number(memory.memoryPercent || 0)}%`,
        bar: Number(memory.memoryPercent || 0),
        tone: Number(memory.memoryPercent || 0) >= 85 ? 'error' : Number(memory.memoryPercent || 0) >= 70 ? 'warn' : 'ok',
        sub: `${formatResourceBytes(memory.usedMemoryBytes)} / ${formatResourceBytes(memory.totalMemoryBytes)}`,
      },
      {
        label: '堆内存',
        value: `${Number(memory.heapPercent || 0)}%`,
        bar: Number(memory.heapPercent || 0),
        // Node 按需扩堆，小进程堆占比天然偏高：不做告警着色，避免误导
        sub: formatResourceBytes(memory.heapUsedBytes),
      },
      {
        label: '运行时长',
        value: formatResourceUptime(runtime.uptimeMs),
        sub: `PID ${runtime.pid || '-'}`,
      },
      {
        label: 'Node',
        value: runtime.nodeVersion || '-',
        sub: `${runtime.platform || '-'} · ${Number(runtime.cpuCount || 0)} 核`,
      },
    ];
    if (loadMean > 0) {
      cells.push({ label: '系统负载', value: loadMean.toFixed(2), sub: load.join(' / ') });
    }
    strip.innerHTML = cells.map(cell => `
      <div class="resource-cell tone-${escapeHtml(cell.tone || 'neutral')}">
        <div class="resource-cell-head"><span>${escapeHtml(cell.label)}</span><strong>${escapeHtml(cell.value)}</strong></div>
        ${cell.bar !== undefined ? `<div class="resource-bar"><span style="width:${Math.min(100, Math.max(0, cell.bar))}%"></span></div>` : ''}
        <small>${escapeHtml(cell.sub || '')}</small>
      </div>
    `).join('');
  }

  function setVersion(result) {
    kpiState.version = result;
  }

  function jumpToModule(targetId) {
    const panel = document.querySelector(`[data-module-id="${targetId}"]`);
    if (!panel) return;
    panel.classList.remove('collapsed');
    panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function init() {
    initLayout();
    const band = document.getElementById('dashboard-kpi-band');
    band?.addEventListener('click', event => {
      const card = event.target.closest?.('[data-kpi-target]');
      if (card) jumpToModule(card.dataset.kpiTarget || '');
    });
  }

  window.CrystelfDashboardKpi = {
    render(context = {}) {
      renderKpi(context);
      renderResourceStrip(context.performance);
    },
    setVersion,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
