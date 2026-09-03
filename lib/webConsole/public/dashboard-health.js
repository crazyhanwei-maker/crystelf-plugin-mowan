function renderHealth(data) {
  const summary = data.summary || {};
  const statusText = formatHealthStatus(summary.status);
  document.getElementById('health-summary').innerHTML = [
    '<div class="dashboard-health-summary">',
    `<div class="dashboard-health-stat tone-${summary.status === 'error' ? 'error' : summary.status === 'warn' ? 'neutral' : 'success'}"><span>状态</span><strong>${statusText}</strong></div>`,
    `<div class="dashboard-health-stat"><span>问题数</span><strong>${summary.issueCount || 0}</strong></div>`,
    `<div class="dashboard-health-stat"><span>异常 / 告警</span><strong>${summary.errorCount || 0} / ${summary.warnCount || 0}</strong></div>`,
    `<div class="dashboard-health-stat"><span>检查时间</span><strong>${formatTime(summary.checkedAt)}</strong></div>`,
    '</div>',
  ].join('');

  document.getElementById('health-issues').innerHTML = (data.issues || []).length > 0
    ? data.issues.map(item => `
      <div class="list-item tone-${item.level === 'error' ? 'error' : item.level === 'warn' ? 'neutral' : 'success'}">
        <h3>${escapeHtml(translateHealthIssueText(item.title || '未命名问题'))}</h3>
        <div class="setting-help">级别：${escapeHtml(getHealthIssueLevelLabel(item.level))}</div>
        <div>${escapeHtml(translateHealthIssueText(item.detail || '暂无详情'))}</div>
      </div>
    `).join('')
    : '<div class="list-item">暂无健康问题</div>';
}

function getConsoleHealthCardTone(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'error') return 'error';
  if (value === 'warn' || value === 'warning') return 'warning';
  if (value === 'success' || value === 'healthy' || value === 'ok') return 'success';
  return 'neutral';
}

function renderConsoleHealthCard(card = {}) {
  const tone = getConsoleHealthCardTone(card.status);
  const actionAttr = card.action ? ` data-action="${escapeHtml(card.action)}"` : '';
  const quickActions = Array.isArray(card.quickActions) ? card.quickActions : [];
  const quickActionsHtml = quickActions.length > 0
    ? `
      <div class="console-health-card-actions">
        ${quickActions.map(action => {
          const label = escapeHtml(action.label || '处理');
          const actionName = escapeHtml(action.action || '');
          const href = escapeHtml(action.href || '#');
          if (action.href && !action.action) {
            return `<a class="mini-btn" href="${href}">${label}</a>`;
          }
          return `<button type="button" class="mini-btn" data-action="${actionName}" ${action.confirm ? `data-confirm="${escapeHtml(action.confirm)}"` : ''}>${label}</button>`;
        }).join('')}
      </div>
    `
    : '';
  return `
    <div class="console-health-card tone-${tone}">
      <a class="console-health-card-main" href="${escapeHtml(card.href || '#')}"${actionAttr}>
        <div class="console-health-card-head">
          <h3>${escapeHtml(card.title || '-')}</h3>
          <span>${escapeHtml(card.badge || '状态')}</span>
        </div>
        <div class="console-health-card-value">${escapeHtml(card.value || '-')}</div>
        <div class="console-health-card-meta">${escapeHtml(card.meta || '')}</div>
        ${card.detail ? `<div class="console-health-card-detail">${escapeHtml(card.detail)}</div>` : ''}
      </a>
      ${quickActionsHtml}
    </div>
  `;
}

function getStartupSelfCheckFriendlyDetail(check = null) {
  if (!check) return '启动时没有发现需要特别说明的项目。';
  const key = String(check.key || '');
  const detail = String(check.detail || '').trim();
  if (key === 'webConsole.listenHost') {
    if (detail.includes('允许写操作')) {
      return '控制台现在允许外部设备访问，并且可以保存配置。请确认只在可信网络内使用，或开启只读模式。';
    }
    if (detail.includes('只读模式')) {
      return '控制台现在允许外部设备访问，但已经开启只读模式。仍建议限制访问来源。';
    }
    return '控制台当前监听外部地址，请确认这是你想要的访问方式。';
  }
  if (key === 'webConsole.authToken') {
    return check.status === 'ok'
      ? '登录口令已经准备好，可以正常进入控制台。'
      : '还没有可用的登录口令，请先在配置里设置一个口令。';
  }
  if (key === 'webConsole.port') {
    return check.status === 'ok'
      ? '控制台端口已经正常占用，可以直接访问。'
      : '启动端口和配置不一致，可能是原端口被占用。';
  }
  if (key === 'config.jsonIntegrity') {
    return check.status === 'ok'
      ? '配置文件都能正常读取。'
      : '有配置文件格式不正确，需要先修复后再启动。';
  }
  if (key === 'dependency.runtime') {
    return check.status === 'ok'
      ? '运行所需依赖已经准备好。'
      : '运行依赖不完整，部分功能可能无法正常打开。';
  }
  return `${check.label || '检查项'}：${detail || '暂无详情'}`;
}

function buildRuntimeHealthCard(overview = {}) {
  const runtime = overview.runtime || {};
  const webRuntime = overview.webConsoleRuntime || {};
  const running = webRuntime.running === true;
  return {
    title: '控制台运行',
    badge: running ? '运行中' : '未运行',
    value: running ? '可以访问' : '需要检查',
    meta: `Node ${runtime.node || '-'} / ${runtime.platform || '-'} / ${webRuntime.host || '-'}:${webRuntime.port || '-'}`,
    detail: running ? '控制台网页已经启动，可以正常打开。' : '没有读到控制台运行信息，建议刷新页面或重启控制台。',
    status: running ? 'success' : 'error',
    href: '/index.html',
    quickActions: [
      { label: '刷新首页', action: 'reload-dashboard-page' },
    ],
  };
}

function formatWatchdogDuration(ms = 0) {
  const totalMinutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

let botWatchdogStatusCache = null;

function updateBotWatchdogStatus(data = {}) {
  botWatchdogStatusCache = data || null;
  // 总览页运维监控横幅同步刷新（dashboard-overview.js 提供）
  if (typeof renderOpsMonitorBanner === 'function') {
    renderOpsMonitorBanner();
  }
  refreshConsoleHealthOverviewFromCache();
}

function buildBotAdapterWatchdogCard() {
  const data = botWatchdogStatusCache;
  if (!data || data.enabled === false) {
    return {
      title: '适配器看门狗',
      badge: '未启用',
      value: '不监测',
      meta: '配置里 botWatchdogEnabled 已关闭',
      detail: 'QQ 适配器掉线不会主动告警。需要时可在配置中重新开启。',
      status: 'neutral',
    };
  }
  const offline = data.offline === true;
  const onlineCount = Number(data.onlineCount || 0);
  const emailConfigured = data.emailConfigured === true;
  return {
    title: '适配器看门狗',
    badge: offline ? '掉线中' : onlineCount > 0 ? `在线 ${onlineCount} 个` : '待连接',
    value: offline ? 'QQ 已掉线' : onlineCount > 0 ? '消息链路正常' : '等待适配器连接',
    meta: offline
      ? `已离线 ${formatWatchdogDuration(data.offlineDurationMs)}${emailConfigured ? ' / 邮件告警已开' : ''}`
      : `掉线 2 分钟内告警${emailConfigured ? ' / 邮件告警已开' : ''}`,
    detail: offline
      ? '机器人收不到任何 QQ 消息；恢复后会推送离线时长。可检查 NapCat 登录状态。'
      : 'QQ 掉线或恢复时会通过 QQ 通知主人' + (emailConfigured ? '，同时发送邮件告警。' : '。'),
    status: offline ? 'error' : onlineCount > 0 ? 'success' : 'neutral',
    href: '/task-center.html',
  };
}

function buildDependencyHealthCard(health = {}) {
  const summary = health?.dependencyReport?.summary || {};
  const manifestMissing = summary.manifestExists === false;
  const runtimeMissingCount = Number(summary.runtimeMissingCount || 0);
  const problemCount = Number(summary.problemCount || 0);
  const status = manifestMissing || runtimeMissingCount > 0
    ? 'error'
    : problemCount > 0
      ? 'warn'
      : 'success';
  const value = manifestMissing
    ? '检查异常'
    : runtimeMissingCount > 0
      ? `缺失 ${formatNumber(runtimeMissingCount)}`
      : problemCount > 0
        ? `问题 ${formatNumber(problemCount)}`
        : '正常';
  return {
    title: '依赖检查',
    badge: formatHealthStatus(status),
    value,
    meta: `运行依赖缺失 ${formatNumber(runtimeMissingCount)} 项，其他问题 ${formatNumber(Math.max(0, problemCount - runtimeMissingCount))} 项`,
    detail: manifestMissing
      ? '没有找到依赖清单，依赖检查暂时不可用。'
      : runtimeMissingCount > 0
        ? '有运行依赖缺失，可能影响功能使用。点击这里查看并修复。'
        : problemCount > 0
          ? '有一些依赖需要确认，但当前运行依赖没有缺失。'
          : summary.checkedAt
            ? `依赖看起来正常，最近检查时间：${formatTime(summary.checkedAt)}。`
            : '正在等待依赖检查结果。',
    status,
    href: '/dependency-check.html',
    quickActions: [
      { label: runtimeMissingCount > 0 ? '打开修复' : '查看明细', href: '/dependency-check.html' },
    ],
  };
}

function formatDashboardPercent(value = 0) {
  return `${formatNumber(Number(value || 0))}%`;
}

function normalizeApiQualityHealthStatus(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'error') return 'error';
  if (value === 'warn' || value === 'warning') return 'warn';
  if (value === 'healthy' || value === 'success' || value === 'ok') return 'success';
  return 'neutral';
}

function buildApiQualityHealthCard(performance = {}) {
  if (performance?.__error) {
    return {
      title: 'API 质量',
      badge: '读取失败',
      value: '需要检查',
      meta: performance.__error || '性能监测接口暂不可用。',
      detail: '首页暂时没有读到 API 主备质量数据，可以打开性能监测页查看详情。',
      status: 'error',
      href: '/performance.html',
      quickActions: [
        { label: '性能监测', href: '/performance.html' },
      ],
    };
  }

  const apiQuality = performance?.apiQuality || {};
  const alertState = apiQuality.alerts || {};
  const last24h = apiQuality.last24h || {};
  const circuits = Array.isArray(apiQuality.circuitBreaker) ? apiQuality.circuitBreaker : [];
  const openCircuits = circuits.filter(item => item.status === 'open');
  const total = last24h.total || {};
  const fallback = last24h.fallback || {};
  const requestCount = Number(total.requestCount || 0);
  const fallbackCount = Number(fallback.requestCount || 0);
  const fallbackShare = Number(last24h.fallbackShare || 0);
  const status = openCircuits.length > 0 ? 'warn' : normalizeApiQualityHealthStatus(alertState.status);
  const badge = openCircuits.length > 0
    ? '主备切换'
    : status === 'error' ? '异常' : status === 'warn' ? '告警' : status === 'success' ? '正常' : '等待采样';
  const value = requestCount > 0
    ? `备用 ${formatDashboardPercent(fallbackShare)}`
    : '暂无样本';
  const meta = requestCount > 0
    ? `近24小时请求 ${formatNumber(requestCount)} 次，成功率 ${formatDashboardPercent(total.successRate || 0)}。`
    : '产生 API 请求后会自动统计主备线路质量。';
  const firstAlert = Array.isArray(alertState.alerts) ? alertState.alerts[0] : null;
  const detail = openCircuits.length > 0
    ? `当前有 ${formatNumber(openCircuits.length)} 个场景主接口冷却中，正在优先使用备用 API。`
    : firstAlert?.detail
    || alertState.summary
    || (requestCount > 0
      ? `备用接口接管 ${formatNumber(fallbackCount)} 次，失败 ${formatNumber(fallback.errorCount || 0)} 次。`
      : '当前没有足够样本判断接口质量。');

  return {
    title: 'API 质量',
    badge,
    value,
    meta,
    detail,
    status,
    href: '/performance.html',
    quickActions: [
      { label: '性能监测', href: '/performance.html' },
    ],
  };
}

function buildStartupSelfCheckHealthCard(overview = {}) {
  const startupSelfCheck = overview.webConsoleRuntime?.startupSelfCheck || null;
  if (!startupSelfCheck) {
    return {
      title: '启动自检',
      badge: '未记录',
      value: '暂无结果',
      meta: '这次运行还没有自检记录。',
      detail: '重启控制台后，这里会显示启动时发现的问题。',
      status: 'neutral',
      href: '/index.html',
    };
  }

  const summary = startupSelfCheck.summary || {};
  const checks = Array.isArray(startupSelfCheck.checks) ? startupSelfCheck.checks : [];
  const notable = checks.find(item => item.status === 'error')
    || checks.find(item => item.status === 'warn')
    || checks.find(item => item.status === 'ok');
  const status = summary.status || 'neutral';
  const errorCount = Number(summary.errorCount || 0);
  const warnCount = Number(summary.warnCount || 0);
  const okCount = Number(summary.okCount || 0);
  const checkCount = Number(summary.checkCount || checks.length || 0);
  const value = errorCount > 0
    ? `发现 ${formatNumber(errorCount)} 个异常`
    : warnCount > 0
      ? `有 ${formatNumber(warnCount)} 个提醒`
      : '启动正常';

  return {
    title: '启动自检',
    badge: formatHealthStatus(status),
    value,
    meta: `已检查 ${formatNumber(checkCount)} 项，${formatNumber(okCount)} 项通过。${formatTime(summary.checkedAt)}`,
    detail: getStartupSelfCheckFriendlyDetail(notable),
    status,
    href: '#health-summary',
    quickActions: [
      { label: '查看问题', href: '#health-issues' },
    ],
  };
}

function buildVersionHealthCard(version = null) {
  if (!version) {
    return {
      title: '版本状态',
      badge: '检查中',
      value: '正在查看',
      meta: '正在确认是否有可用更新。',
      detail: '检查完成后，这张卡片会自动更新。',
      status: 'neutral',
      href: '/index.html',
    };
  }
  if (version.updateAvailable === true || version.status === 'update_available') {
    return {
      title: '版本状态',
      badge: '可更新',
      value: '有新版本',
      meta: `当前 ${version.localCommitShort || '-'}，最新 ${version.remoteCommitShort || '-'}`,
      detail: version.dirty ? '本地还有未提交的改动，更新前请先确认。' : '线上代码已有新提交，可以考虑更新。',
      status: 'warn',
      href: '/index.html',
    };
  }
  if (version.success === false || version.status === 'check_failed') {
    return {
      title: '版本状态',
      badge: '检查失败',
      value: '暂时无法获取',
      meta: version.error || '未能获取更新信息。',
      detail: version.checkedAt ? `上次尝试时间：${formatTime(version.checkedAt)}。` : '稍后可以重新刷新页面再试。',
      status: 'error',
      href: '/index.html',
    };
  }
  return {
    title: '版本状态',
    badge: '最新',
    value: '已经是最新',
    meta: `当前分支 ${version.branch || '-'}，版本 ${version.localCommitShort || '-'}`,
    detail: version.dirty ? '本地还有未提交的改动，提交或备份后再更新更稳妥。' : `最近确认时间：${formatTime(version.checkedAt)}。`,
    status: version.dirty ? 'warn' : 'success',
    href: '/index.html',
  };
}

function buildStaticCacheHealthCard(overview = {}) {
  const assets = overview.staticAssets || {};
  const pageLoad = getPageLoadDiagnosticSafe();
  const summary = pageLoad?.summary || {};
  const enabled = assets.htmlResourceVersioning === true && assets.conditionalCache === true;
  const failedResourceCount = Number(summary.failedResourceCount || 0);
  const versionMismatchCount = Number(summary.versionMismatchCount || 0);
  const unversionedSameOriginCount = Number(summary.unversionedSameOriginCount || 0);
  const cacheItemCount = Number(summary.cacheItemCount || 0);
  const pageStatus = pageLoad?.status || (enabled ? 'success' : 'warn');
  const status = failedResourceCount > 0 || versionMismatchCount > 0
    ? 'error'
    : pageStatus === 'warn' || unversionedSameOriginCount > 0
      ? 'warn'
      : enabled
        ? 'success'
        : 'warn';
  return {
    title: '页面加载',
    badge: status === 'error' ? '需处理' : status === 'warn' ? '可优化' : '正常',
    value: failedResourceCount > 0
      ? `失败 ${formatNumber(failedResourceCount)}`
      : versionMismatchCount > 0
        ? `版本不一致 ${formatNumber(versionMismatchCount)}`
        : enabled
          ? '已优化'
          : '待确认',
    meta: `脚本/样式 ${formatNumber(summary.sameOriginResourceCount || 0)} 个，本机缓存 ${formatNumber(cacheItemCount)} 项。`,
    detail: failedResourceCount > 0
      ? '有脚本或样式没有加载成功，建议查看诊断后刷新或清理缓存。'
      : versionMismatchCount > 0
        ? '页面里存在不同版本的资源，可能是浏览器缓存了旧脚本。'
        : enabled
          ? '资源版本和浏览器缓存策略已启用，页面加载状态正常。'
          : '还没有读到完整的页面缓存状态，可以打开诊断查看。',
    status,
    href: '#page-load-diagnostic',
    action: 'show-page-load-diagnostic',
    quickActions: [
      { label: '查看诊断', action: 'show-page-load-diagnostic' },
      ...(cacheItemCount > 0 || status !== 'success'
        ? [{ label: '清缓存刷新', action: 'clear-page-cache-and-reload' }]
        : []),
    ],
  };
}

function buildFrontendRequestHealthCard() {
  const metrics = window.CrystelfRequest?.getMetrics?.();
  if (!metrics) {
    return {
      title: '请求耗时',
      badge: '等待采样',
      value: '暂无数据',
      meta: '刷新页面后会自动记录接口耗时。',
      detail: '控制台会在本机浏览器里统计最近请求，用来发现加载慢的接口。',
      status: 'neutral',
      href: '#refresh-status',
    };
  }

  const totalCount = Number(metrics.totalCount || 0);
  const activeCount = Number(metrics.activeCount || 0);
  const recentSlowItems = Array.isArray(metrics.recentSlowItems) ? metrics.recentSlowItems : [];
  const slowItems = Array.isArray(metrics.slowItems) ? metrics.slowItems : [];
  const latestSlow = recentSlowItems[0] || slowItems[0] || null;
  const averageMs = Number(metrics.averageMs || 0);
  const errorCount = Number(metrics.errorCount || 0);
  const slowCount = Number(metrics.slowCount || 0);
  const thresholdMs = Number(metrics.thresholdMs || 1500);
  const status = recentSlowItems.length > 0
    ? 'warn'
    : errorCount > 0
      ? 'warn'
      : totalCount > 0
        ? 'success'
        : 'neutral';

  return {
    title: '请求耗时',
    badge: activeCount > 0 ? '请求中' : recentSlowItems.length > 0 ? '有慢请求' : totalCount > 0 ? '已采样' : '等待采样',
    value: recentSlowItems.length > 0
      ? `慢 ${formatNumber(recentSlowItems.length)} 个`
      : totalCount > 0
        ? `${formatNumber(averageMs)} ms`
        : '暂无数据',
    meta: totalCount > 0
      ? `已采样 ${formatNumber(totalCount)} 个请求，慢请求阈值 ${formatNumber(thresholdMs)} ms。`
      : '还没有完成的接口请求。',
    detail: latestSlow
      ? `${latestSlow.method || 'GET'} ${latestSlow.url || '-'} 用了 ${formatNumber(latestSlow.elapsedMs || 0)} ms。`
      : errorCount > 0
        ? `本页已有 ${formatNumber(errorCount)} 个接口读取失败，建议查看页面提示或刷新重试。`
      : slowCount > 0
        ? `本页累计出现过 ${formatNumber(slowCount)} 个慢请求，最近一分钟没有新的慢请求。`
          : '最近接口响应正常，没有发现明显拖慢页面的请求。点击可查看最近请求明细。',
    status,
    href: '#request-timing-detail',
    action: 'show-request-timing-detail',
    quickActions: [
      { label: '查看耗时', action: 'show-request-timing-detail' },
      ...(errorCount > 0 || slowCount > 0 ? [{ label: '清空采样', action: 'reset-request-timing' }] : []),
    ],
  };
}

function buildFrontendErrorHealthCard() {
  const summary = window.CrystelfFrontendErrors?.getSummary?.();
  if (!summary) {
    return {
      title: '前端异常',
      badge: '未启用',
      value: '暂无数据',
      meta: '当前浏览器没有启用前端异常捕获。',
      detail: '页面脚本、接口或静态资源异常会在这里汇总，方便排查控制台打不开或按钮无响应的问题。',
      status: 'neutral',
      href: '#refresh-status',
    };
  }

  const recentCount = Number(summary.recentCount || 0);
  const storedCount = Number(summary.storedCount || 0);
  const totalCount = Number(summary.totalCount || 0);
  const latest = summary.latest || null;
  const recentWindowMinutes = Math.max(1, Math.round(Number(summary.recentWindowMs || 600000) / 60000));
  const status = recentCount > 0
    ? 'error'
    : storedCount > 0
      ? 'warn'
      : 'success';

  return {
    title: '前端异常',
    badge: recentCount > 0 ? '刚刚发生' : storedCount > 0 ? '有历史' : '正常',
    value: recentCount > 0
      ? `新 ${formatNumber(recentCount)} 个`
      : storedCount > 0
        ? `历史 ${formatNumber(storedCount)} 个`
        : '没有异常',
    meta: storedCount > 0
      ? `本页保存 ${formatNumber(storedCount)} 条，累计捕获 ${formatNumber(totalCount)} 次。`
      : '当前页面还没有捕获到脚本或资源异常。',
    detail: latest
      ? `${latest.kindLabel || '前端异常'}：${latest.message || '暂无错误说明'}。`
      : `最近 ${formatNumber(recentWindowMinutes)} 分钟没有发现前端异常。点击可查看捕获面板。`,
    status,
    href: '#frontend-error-detail',
    action: 'show-frontend-error-detail',
    quickActions: [
      { label: '查看异常', action: 'show-frontend-error-detail' },
      ...(storedCount > 0 ? [{ label: '清空异常', action: 'reset-frontend-errors' }] : []),
    ],
  };
}

function getRequestTimingItemTone(item = {}) {
  if (item.canceled) return 'neutral';
  if (item.success === false) return 'error';
  if (item.slow) return 'warning';
  return 'success';
}

function getRequestTimingItemStatus(item = {}) {
  if (item.canceled) return '已取消';
  if (item.success === false) return item.status ? `失败 HTTP ${item.status}` : '读取失败';
  if (item.slow) return '慢请求';
  return item.status ? `正常 HTTP ${item.status}` : '正常';
}

function renderRequestTimingThresholdControl(metrics = {}) {
  const thresholdMs = Number(metrics.thresholdMs || 1500);
  const options = Array.isArray(metrics.thresholdOptions) && metrics.thresholdOptions.length > 0
    ? metrics.thresholdOptions
    : [800, 1500, 3000, 5000];
  return `
    <label class="request-timing-threshold-control">
      <span>慢请求阈值</span>
      <select data-action="set-request-timing-threshold" aria-label="慢请求阈值">
        ${options.map(value => `
          <option value="${escapeHtml(value)}" ${Number(value) === thresholdMs ? 'selected' : ''}>${formatNumber(value)} ms</option>
        `).join('')}
      </select>
    </label>
  `;
}

const REQUEST_TIMING_MODAL_TITLE = '请求耗时详情';
const REQUEST_TIMING_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'slow', label: '慢请求' },
  { value: 'error', label: '失败' },
  { value: 'canceled', label: '取消' },
];
let requestTimingModalRefreshTimer = 0;
let lastConsoleHealthOverviewPayload = null;
let requestTimingActionMessage = '';
let requestTimingDiagnosticPreviewText = '';
let requestTimingDetailFilter = 'all';
const FRONTEND_ERROR_MODAL_TITLE = '前端异常捕获';
const FRONTEND_ERROR_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'recent', label: '最近' },
  { value: 'runtime', label: '脚本' },
  { value: 'promise', label: '异步' },
  { value: 'request', label: '接口' },
  { value: 'resource', label: '资源' },
];
let frontendErrorModalRefreshTimer = 0;
let frontendErrorActionMessage = '';
let frontendErrorDiagnosticPreviewText = '';
let frontendErrorDetailFilter = 'all';
const PAGE_LOAD_MODAL_TITLE = '页面加载诊断';
let pageLoadActionMessage = '';
let pageLoadDiagnosticPreviewText = '';

function getSortedRequestTimingItems(metrics = {}) {
  return (Array.isArray(metrics.items) ? metrics.items : [])
    .slice()
    .sort((left, right) => Number(right.elapsedMs || 0) - Number(left.elapsedMs || 0));
}

function getRequestTimingFilterCount(value, metrics = {}) {
  if (value === 'slow') return Number(metrics.slowCount || 0);
  if (value === 'error') return Number(metrics.errorCount || 0);
  if (value === 'canceled') return Number(metrics.canceledCount || 0);
  return Number(metrics.totalCount || 0);
}

function filterRequestTimingItems(items = [], filter = requestTimingDetailFilter) {
  if (filter === 'slow') return items.filter(item => item.slow);
  if (filter === 'error') return items.filter(item => item.success === false && item.canceled !== true);
  if (filter === 'canceled') return items.filter(item => item.canceled === true);
  return items;
}

function renderRequestTimingFilters(metrics = {}) {
  return `
    <div class="request-timing-filter-tabs" role="group" aria-label="请求耗时筛选">
      ${REQUEST_TIMING_FILTERS.map(filter => `
        <button
          type="button"
          class="request-timing-filter-btn ${filter.value === requestTimingDetailFilter ? 'is-active' : ''}"
          data-action="set-request-timing-filter"
          data-filter="${escapeHtml(filter.value)}"
          aria-pressed="${filter.value === requestTimingDetailFilter ? 'true' : 'false'}"
        >
          ${escapeHtml(filter.label)}
          <span>${formatNumber(getRequestTimingFilterCount(filter.value, metrics))}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function buildRequestTimingDiagnostic(metrics = window.CrystelfRequest?.getMetrics?.()) {
  const data = metrics || {};
  const items = getSortedRequestTimingItems(data);
  return {
    generatedAt: new Date().toISOString(),
    pageUrl: window.location.href,
    userAgent: navigator.userAgent || '',
    thresholdMs: Number(data.thresholdMs || 1500),
    recentWindowMs: Number(data.recentWindowMs || 60000),
    summary: {
      activeCount: Number(data.activeCount || 0),
      totalCount: Number(data.totalCount || 0),
      successCount: Number(data.successCount || 0),
      errorCount: Number(data.errorCount || 0),
      canceledCount: Number(data.canceledCount || 0),
      slowCount: Number(data.slowCount || 0),
      averageMs: Number(data.averageMs || 0),
    },
    slowItems: items.filter(item => item.slow),
    errorItems: items.filter(item => item.success === false && item.canceled !== true),
    items,
  };
}

function formatRequestTimingDiagnosticText(diagnostic = buildRequestTimingDiagnostic()) {
  const summary = diagnostic.summary || {};
  const lines = [
    '魔丸控制台请求耗时诊断',
    `生成时间：${formatTime(diagnostic.generatedAt)}`,
    `页面地址：${diagnostic.pageUrl || '-'}`,
    `慢请求阈值：${formatNumber(diagnostic.thresholdMs || 0)} ms`,
    `已采样：${formatNumber(summary.totalCount || 0)} 个 / 平均 ${formatNumber(summary.averageMs || 0)} ms / 慢请求 ${formatNumber(summary.slowCount || 0)} 个 / 失败 ${formatNumber(summary.errorCount || 0)} 个 / 取消 ${formatNumber(summary.canceledCount || 0)} 个`,
    '',
    '耗时最高的请求：',
  ];
  const items = Array.isArray(diagnostic.items) ? diagnostic.items.slice(0, 20) : [];
  if (items.length <= 0) {
    lines.push('暂无请求记录。');
    return lines.join('\n');
  }
  items.forEach((item, index) => {
    lines.push([
      `${index + 1}.`,
      `${item.method || 'GET'} ${item.url || '-'}`,
      `${formatNumber(item.elapsedMs || 0)} ms`,
      getRequestTimingItemStatus(item),
      item.error ? `错误：${item.error}` : '',
    ].filter(Boolean).join(' / '));
  });
  return lines.join('\n');
}

function renderRequestTimingDiagnosticPreview() {
  if (!requestTimingDiagnosticPreviewText) return '';
  return `
    <textarea class="request-timing-diagnostic-preview" readonly aria-label="请求耗时诊断文本">${escapeHtml(requestTimingDiagnosticPreviewText)}</textarea>
  `;
}

async function copyRequestTimingDiagnostic() {
  const text = formatRequestTimingDiagnosticText();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some embedded browsers reject the async clipboard API when the page is not focused.
  }

  const copied = copyRequestTimingDiagnosticFallback(text);
  if (!copied) {
    throw new Error('浏览器没有允许写入剪贴板，可点“导出 JSON”保存诊断信息');
  }
}

function copyRequestTimingDiagnosticFallback(text) {
  const textarea = document.createElement('textarea');
  try {
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function downloadRequestTimingDiagnostic() {
  const diagnostic = buildRequestTimingDiagnostic();
  const text = JSON.stringify(diagnostic, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `request-timing-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderRequestTimingDetail() {
  const metrics = window.CrystelfRequest?.getMetrics?.();
  if (!metrics) {
    return '<div class="request-timing-empty">当前浏览器还没有启用请求耗时采样。</div>';
  }

  const items = getSortedRequestTimingItems(metrics);
  const visibleItems = filterRequestTimingItems(items);
  const thresholdMs = Number(metrics.thresholdMs || 1500);
  const activeCount = Number(metrics.activeCount || 0);
  const totalCount = Number(metrics.totalCount || 0);
  const slowCount = Number(metrics.slowCount || 0);
  const errorCount = Number(metrics.errorCount || 0);
  const canceledCount = Number(metrics.canceledCount || 0);
  const averageMs = Number(metrics.averageMs || 0);
  const liveText = activeCount > 0
    ? '有接口正在读取，完成后这里会自动更新。'
    : '详情面板打开时会随着新请求自动更新。';

  const summaryHtml = `
    <div class="request-timing-summary">
      <span>已采样 <strong>${formatNumber(totalCount)}</strong></span>
      <span>平均 <strong>${formatNumber(averageMs)} ms</strong></span>
      <span>慢请求 <strong>${formatNumber(slowCount)}</strong></span>
      <span>失败 <strong>${formatNumber(errorCount)}</strong></span>
      <span>取消 <strong>${formatNumber(canceledCount)}</strong></span>
      <span>进行中 <strong>${formatNumber(activeCount)}</strong></span>
    </div>
    <div class="request-timing-controls">
      ${renderRequestTimingThresholdControl(metrics)}
    </div>
    ${renderRequestTimingFilters(metrics)}
    <div class="setting-help">慢请求阈值：${formatNumber(thresholdMs)} ms。列表按耗时从高到低排列，只保留最近 ${formatNumber(items.length)} 条本页请求，当前显示 ${formatNumber(visibleItems.length)} 条。${liveText}</div>
    ${requestTimingActionMessage ? `<div class="request-timing-action-status">${escapeHtml(requestTimingActionMessage)}</div>` : ''}
    ${renderRequestTimingDiagnosticPreview()}
  `;

  if (items.length <= 0) {
    return `
      <div class="request-timing-detail">
        ${summaryHtml}
        <div class="request-timing-empty">还没有完成的接口请求。刷新一次首页后会自动出现明细。</div>
      </div>
    `;
  }

  if (visibleItems.length <= 0) {
    return `
      <div class="request-timing-detail">
        ${summaryHtml}
        <div class="request-timing-actions">
          <button type="button" class="mini-btn" data-action="copy-request-timing-diagnostic">复制诊断信息</button>
          <button type="button" class="mini-btn" data-action="export-request-timing-diagnostic">导出 JSON</button>
          <button type="button" class="mini-btn" data-action="reset-request-timing">清空本页采样</button>
        </div>
        <div class="request-timing-empty">当前筛选下没有请求记录。</div>
      </div>
    `;
  }

  const listHtml = visibleItems.map(item => {
    const tone = getRequestTimingItemTone(item);
    const status = getRequestTimingItemStatus(item);
    const detail = item.error
      ? `<div class="request-timing-error">${escapeHtml(item.error)}</div>`
      : '';
    return `
      <div class="request-timing-row tone-${tone}">
        <div class="request-timing-row-main">
          <div class="request-timing-url">${escapeHtml(item.method || 'GET')} ${escapeHtml(item.url || '-')}</div>
          <div class="request-timing-meta">${escapeHtml(formatTime(item.finishedAt || item.startedAt))}</div>
          ${detail}
        </div>
        <div class="request-timing-row-side">
          <strong>${formatNumber(item.elapsedMs || 0)} ms</strong>
          <span>${escapeHtml(status)}</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="request-timing-detail">
      ${summaryHtml}
      <div class="request-timing-actions">
        <button type="button" class="mini-btn" data-action="copy-request-timing-diagnostic">复制诊断信息</button>
        <button type="button" class="mini-btn" data-action="export-request-timing-diagnostic">导出 JSON</button>
        <button type="button" class="mini-btn" data-action="reset-request-timing">清空本页采样</button>
      </div>
      <div class="request-timing-list">${listHtml}</div>
    </div>
  `;
}

function isRequestTimingDetailModalOpen() {
  const mask = document.getElementById('modal-mask');
  const title = document.getElementById('modal-title');
  return Boolean(
    mask
    && title
    && !mask.classList.contains('hidden')
    && title.textContent === REQUEST_TIMING_MODAL_TITLE
  );
}

function updateRequestTimingDetailModal(options = {}) {
  if (!isRequestTimingDetailModalOpen()) return;
  const content = document.getElementById('modal-content');
  if (!content) return;
  const previousScrollTop = content.scrollTop;
  content.innerHTML = renderRequestTimingDetail();
  if (options.preserveScroll !== false) {
    content.scrollTop = Math.min(previousScrollTop, Math.max(0, content.scrollHeight - content.clientHeight));
  }
}

function scheduleRequestTimingDetailRefresh() {
  if (!isRequestTimingDetailModalOpen() || requestTimingModalRefreshTimer) return;
  requestTimingModalRefreshTimer = window.setTimeout(() => {
    requestTimingModalRefreshTimer = 0;
    updateRequestTimingDetailModal();
  }, 120);
}

function refreshConsoleHealthOverviewFromCache() {
  if (!lastConsoleHealthOverviewPayload) return;
  renderConsoleHealthOverview(
    lastConsoleHealthOverviewPayload.overview,
    lastConsoleHealthOverviewPayload.health,
    lastConsoleHealthOverviewPayload.version,
    lastConsoleHealthOverviewPayload.audit,
    lastConsoleHealthOverviewPayload.performance,
  );
}

function openRequestTimingDetailModal() {
  return openModal(REQUEST_TIMING_MODAL_TITLE, renderRequestTimingDetail(), {
    confirmText: '关闭',
    showCancel: false,
    html: true,
  });
}

window.addEventListener('crystelf-request-timing-change', () => {
  scheduleRequestTimingDetailRefresh();
  refreshConsoleHealthOverviewFromCache();
});

function getFrontendErrorSummarySafe() {
  try {
    return window.CrystelfFrontendErrors?.getSummary?.() || null;
  } catch {
    return null;
  }
}

function getFrontendErrorItemTimeMs(item = {}) {
  const direct = Number(item.latestAtMs || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const parsed = new Date(item.latestAt || item.firstAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSortedFrontendErrorItems(summary = {}) {
  return (Array.isArray(summary.items) ? summary.items : [])
    .slice()
    .sort((left, right) => getFrontendErrorItemTimeMs(right) - getFrontendErrorItemTimeMs(left));
}

function getFrontendErrorFilterCount(value, summary = {}) {
  const items = getSortedFrontendErrorItems(summary);
  if (value === 'all') return Number(summary.storedCount || items.length || 0);
  if (value === 'recent') return Number(summary.recentCount || 0);
  return items.filter(item => item.kind === value).length;
}

function filterFrontendErrorItems(items = [], filter = frontendErrorDetailFilter, summary = {}) {
  if (filter === 'recent') {
    const recentWindowMs = Number(summary.recentWindowMs || 600000);
    const cutoff = Date.now() - recentWindowMs;
    return items.filter(item => getFrontendErrorItemTimeMs(item) >= cutoff);
  }
  if (FRONTEND_ERROR_FILTERS.some(item => item.value === filter) && filter !== 'all') {
    return items.filter(item => item.kind === filter);
  }
  return items;
}

function renderFrontendErrorFilters(summary = {}) {
  return `
    <div class="frontend-error-filter-tabs" role="group" aria-label="前端异常筛选">
      ${FRONTEND_ERROR_FILTERS.map(filter => `
        <button
          type="button"
          class="frontend-error-filter-btn ${filter.value === frontendErrorDetailFilter ? 'is-active' : ''}"
          data-action="set-frontend-error-filter"
          data-filter="${escapeHtml(filter.value)}"
          aria-pressed="${filter.value === frontendErrorDetailFilter ? 'true' : 'false'}"
        >
          ${escapeHtml(filter.label)}
          <span>${formatNumber(getFrontendErrorFilterCount(filter.value, summary))}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function getPageLoadDiagnosticSafe() {
  try {
    return window.CrystelfPageLoadDiagnostics?.buildDiagnostic?.() || null;
  } catch {
    return null;
  }
}

function getPageLoadStatusText(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'error') return '需要处理';
  if (value === 'warn' || value === 'warning') return '需要确认';
  if (value === 'success' || value === 'ok') return '加载正常';
  return '状态未知';
}

function getPageLoadResourceTypeText(type = '') {
  const value = String(type || '').trim().toLowerCase();
  if (value === 'script') return '脚本';
  if (value === 'stylesheet') return '样式';
  return value || '资源';
}

function formatPageLoadDiagnosticText(diagnostic = getPageLoadDiagnosticSafe()) {
  if (!diagnostic) {
    return '当前浏览器没有启用页面加载诊断。';
  }
  const summary = diagnostic.summary || {};
  const lines = [
    '魔丸控制台页面加载诊断',
    `生成时间：${formatTime(diagnostic.generatedAt)}`,
    `页面地址：${diagnostic.pageUrl || '-'}`,
    `状态：${getPageLoadStatusText(diagnostic.status)}`,
    `资源：总数 ${formatNumber(summary.totalResourceCount || 0)} / 本站 ${formatNumber(summary.sameOriginResourceCount || 0)} / 已带版本 ${formatNumber(summary.versionedResourceCount || 0)}`,
    `版本：期望 ${summary.expectedVersion || '-'} / 版本种类 ${formatNumber(summary.distinctVersionCount || 0)} / 不一致 ${formatNumber(summary.versionMismatchCount || 0)}`,
    `资源失败：${formatNumber(summary.failedResourceCount || 0)} / 本机缓存：${formatNumber(summary.cacheItemCount || 0)} 项，${summary.cacheBytesLabel || '0 B'}`,
    '',
    '建议：',
  ];
  const recommendations = Array.isArray(diagnostic.recommendations) ? diagnostic.recommendations : [];
  if (recommendations.length <= 0) {
    lines.push('当前没有额外建议。');
  } else {
    recommendations.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  }
  const failedItems = Array.isArray(diagnostic.failedResourceItems) ? diagnostic.failedResourceItems.slice(0, 12) : [];
  if (failedItems.length > 0) {
    lines.push('', '加载失败资源：');
    failedItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.message || '资源加载失败'} / ${item.url || '-'}`);
    });
  }
  const mismatchItems = Array.isArray(diagnostic.versionMismatchItems) ? diagnostic.versionMismatchItems.slice(0, 12) : [];
  if (mismatchItems.length > 0) {
    lines.push('', '版本不一致资源：');
    mismatchItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${getPageLoadResourceTypeText(item.type)} / ${item.url || '-'} / v=${item.version || '-'}`);
    });
  }
  return lines.join('\n');
}

function renderPageLoadDiagnosticPreview() {
  if (!pageLoadDiagnosticPreviewText) return '';
  return `
    <textarea class="page-load-diagnostic-preview" readonly aria-label="页面加载诊断文本">${escapeHtml(pageLoadDiagnosticPreviewText)}</textarea>
  `;
}

async function copyPageLoadDiagnostic() {
  const text = formatPageLoadDiagnosticText();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some embedded browsers reject clipboard access when the page is not focused.
  }
  const copied = copyRequestTimingDiagnosticFallback(text);
  if (!copied) {
    throw new Error('浏览器没有允许写入剪贴板，可点“导出 JSON”保存诊断信息');
  }
}

function downloadPageLoadDiagnostic() {
  const diagnostic = getPageLoadDiagnosticSafe() || {};
  const text = JSON.stringify(diagnostic, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `page-load-diagnostic-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderPageLoadDiagnostic() {
  const diagnostic = getPageLoadDiagnosticSafe();
  if (!diagnostic) {
    return '<div class="page-load-empty">当前浏览器没有启用页面加载诊断。</div>';
  }
  const summary = diagnostic.summary || {};
  const recommendations = Array.isArray(diagnostic.recommendations) ? diagnostic.recommendations : [];
  const failedItems = Array.isArray(diagnostic.failedResourceItems) ? diagnostic.failedResourceItems : [];
  const mismatchItems = Array.isArray(diagnostic.versionMismatchItems) ? diagnostic.versionMismatchItems : [];
  const unversionedItems = Array.isArray(diagnostic.unversionedSameOriginItems) ? diagnostic.unversionedSameOriginItems : [];
  const resources = Array.isArray(diagnostic.resources) ? diagnostic.resources : [];
  const summaryHtml = `
    <div class="page-load-summary">
      <span>状态 <strong>${escapeHtml(getPageLoadStatusText(diagnostic.status))}</strong></span>
      <span>本站资源 <strong>${formatNumber(summary.sameOriginResourceCount || 0)}</strong></span>
      <span>版本不一致 <strong>${formatNumber(summary.versionMismatchCount || 0)}</strong></span>
      <span>加载失败 <strong>${formatNumber(summary.failedResourceCount || 0)}</strong></span>
      <span>本机缓存 <strong>${formatNumber(summary.cacheItemCount || 0)}</strong></span>
    </div>
    <div class="setting-help">当前页面会检查脚本和样式是否带有同一资源版本、是否有资源加载失败，以及浏览器本机缓存是否可能影响显示。</div>
    ${pageLoadActionMessage ? `<div class="page-load-action-status">${escapeHtml(pageLoadActionMessage)}</div>` : ''}
    ${renderPageLoadDiagnosticPreview()}
  `;
  const actionHtml = `
    <div class="page-load-actions">
      <button type="button" class="mini-btn" data-action="copy-page-load-diagnostic">复制诊断信息</button>
      <button type="button" class="mini-btn" data-action="export-page-load-diagnostic">导出 JSON</button>
      <button type="button" class="mini-btn" data-action="clear-page-cache-and-reload">清缓存刷新</button>
    </div>
  `;
  const recommendationsHtml = recommendations.length > 0
    ? `<div class="page-load-recommendations">${recommendations.map(item => `<div>${escapeHtml(item)}</div>`).join('')}</div>`
    : '<div class="page-load-empty">当前没有额外建议。</div>';
  const failedHtml = failedItems.length > 0
    ? failedItems.map(item => `
      <div class="page-load-row tone-error">
        <div>
          <div class="page-load-title">${escapeHtml(item.message || '资源加载失败')}</div>
          <div class="page-load-meta">${escapeHtml(item.url || '-')}</div>
        </div>
        <span>失败</span>
      </div>
    `).join('')
    : '';
  const mismatchHtml = mismatchItems.length > 0
    ? mismatchItems.map(item => `
      <div class="page-load-row tone-warning">
        <div>
          <div class="page-load-title">${escapeHtml(getPageLoadResourceTypeText(item.type))}版本不一致</div>
          <div class="page-load-meta">${escapeHtml(item.url || '-')}</div>
        </div>
        <span>v=${escapeHtml(item.version || '-')}</span>
      </div>
    `).join('')
    : '';
  const unversionedHtml = unversionedItems.length > 0
    ? unversionedItems.slice(0, 10).map(item => `
      <div class="page-load-row tone-neutral">
        <div>
          <div class="page-load-title">${escapeHtml(getPageLoadResourceTypeText(item.type))}没有资源版本</div>
          <div class="page-load-meta">${escapeHtml(item.url || '-')}</div>
        </div>
        <span>待确认</span>
      </div>
    `).join('')
    : '';
  const resourceHtml = resources.length > 0
    ? resources.slice(0, 20).map(item => `
      <div class="page-load-resource-chip">
        <span>${escapeHtml(getPageLoadResourceTypeText(item.type))}</span>
        <code>${escapeHtml(item.url || '-')}</code>
      </div>
    `).join('')
    : '<div class="page-load-empty">没有读到脚本或样式资源。</div>';

  return `
    <div class="page-load-detail">
      ${summaryHtml}
      ${actionHtml}
      ${recommendationsHtml}
      ${failedHtml || mismatchHtml || unversionedHtml ? `<div class="page-load-list">${failedHtml}${mismatchHtml}${unversionedHtml}</div>` : ''}
      <details class="page-load-resources">
        <summary>查看当前页面资源</summary>
        <div>${resourceHtml}</div>
      </details>
    </div>
  `;
}

function openPageLoadDiagnosticModal() {
  return openModal(PAGE_LOAD_MODAL_TITLE, renderPageLoadDiagnostic(), {
    confirmText: '关闭',
    showCancel: false,
    html: true,
  });
}

function isPageLoadDiagnosticModalOpen() {
  const mask = document.getElementById('modal-mask');
  const title = document.getElementById('modal-title');
  return Boolean(
    mask
    && title
    && !mask.classList.contains('hidden')
    && title.textContent === PAGE_LOAD_MODAL_TITLE
  );
}

function updatePageLoadDiagnosticModal() {
  if (!isPageLoadDiagnosticModalOpen()) return;
  const content = document.getElementById('modal-content');
  if (content) {
    content.innerHTML = renderPageLoadDiagnostic();
  }
}

function getFrontendErrorKindText(item = {}) {
  if (item.kindLabel) return item.kindLabel;
  if (item.kind === 'runtime') return '页面脚本';
  if (item.kind === 'promise') return '异步任务';
  if (item.kind === 'request') return '接口请求';
  if (item.kind === 'resource') return '静态资源';
  return '前端异常';
}

function getFrontendErrorItemStatus(item = {}) {
  if (item.kind === 'request') {
    return item.status ? `接口失败 HTTP ${item.status}` : '接口读取失败';
  }
  if (item.kind === 'resource') return '资源加载失败';
  if (item.kind === 'promise') return '异步任务异常';
  if (item.kind === 'runtime') {
    return item.line ? `脚本异常 ${item.line}:${item.column || 0}` : '脚本异常';
  }
  return '前端异常';
}

function formatFrontendErrorLocation(item = {}) {
  const parts = [];
  if (item.method || item.url) {
    parts.push([item.method, item.url].filter(Boolean).join(' '));
  }
  if (item.pageUrl) parts.push(`页面 ${item.pageUrl}`);
  if (item.line) parts.push(`位置 ${item.line}:${item.column || 0}`);
  return parts.filter(Boolean).join(' / ') || '暂无位置';
}

function buildFrontendErrorDiagnostic() {
  try {
    const diagnostic = window.CrystelfFrontendErrors?.buildDiagnostic?.();
    if (diagnostic) return diagnostic;
  } catch {
    // Fall through to a minimal diagnostic object.
  }
  const summary = getFrontendErrorSummarySafe() || {};
  return {
    generatedAt: new Date().toISOString(),
    pageUrl: window.location.href,
    userAgent: navigator.userAgent || '',
    summary: {
      status: summary.status || 'unknown',
      totalCount: Number(summary.totalCount || 0),
      storedCount: Number(summary.storedCount || 0),
      recentCount: Number(summary.recentCount || 0),
    },
    items: Array.isArray(summary.items) ? summary.items : [],
  };
}

function formatFrontendErrorDiagnosticText(diagnostic = buildFrontendErrorDiagnostic()) {
  const summary = diagnostic.summary || {};
  const items = Array.isArray(diagnostic.items) ? diagnostic.items.slice(0, 30) : [];
  const lines = [
    '魔丸控制台前端异常诊断',
    `生成时间：${formatTime(diagnostic.generatedAt)}`,
    `页面地址：${diagnostic.pageUrl || '-'}`,
    `捕获概览：累计 ${formatNumber(summary.totalCount || 0)} 次 / 当前保存 ${formatNumber(summary.storedCount || 0)} 条 / 最近 ${formatNumber(summary.recentCount || 0)} 条`,
    '',
    '最近异常：',
  ];

  if (items.length <= 0) {
    lines.push('暂无前端异常记录。');
    return lines.join('\n');
  }

  items.forEach((item, index) => {
    lines.push([
      `${index + 1}.`,
      getFrontendErrorKindText(item),
      item.message || '暂无错误说明',
      formatFrontendErrorLocation(item),
      item.count > 1 ? `重复 ${formatNumber(item.count)} 次` : '',
      `时间：${formatTime(item.latestAt || item.firstAt)}`,
    ].filter(Boolean).join(' / '));
    if (item.detail) {
      lines.push(`   详情：${item.detail}`);
    }
    if (item.stack) {
      lines.push(`   堆栈：${String(item.stack).split('\n').slice(0, 6).join(' | ')}`);
    }
  });
  return lines.join('\n');
}

function renderFrontendErrorDiagnosticPreview() {
  if (!frontendErrorDiagnosticPreviewText) return '';
  return `
    <textarea class="frontend-error-diagnostic-preview" readonly aria-label="前端异常诊断文本">${escapeHtml(frontendErrorDiagnosticPreviewText)}</textarea>
  `;
}

async function copyFrontendErrorDiagnostic() {
  const text = formatFrontendErrorDiagnosticText();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some embedded browsers reject the async clipboard API when the page is not focused.
  }

  const copied = copyRequestTimingDiagnosticFallback(text);
  if (!copied) {
    throw new Error('浏览器没有允许写入剪贴板，可点“导出 JSON”保存诊断信息');
  }
}

function downloadFrontendErrorDiagnostic() {
  const diagnostic = buildFrontendErrorDiagnostic();
  const text = JSON.stringify(diagnostic, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `frontend-errors-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderFrontendErrorDetail() {
  const summary = getFrontendErrorSummarySafe();
  if (!summary) {
    return '<div class="frontend-error-empty">当前浏览器还没有启用前端异常捕获。</div>';
  }

  const items = getSortedFrontendErrorItems(summary);
  const visibleItems = filterFrontendErrorItems(items, frontendErrorDetailFilter, summary);
  const storedCount = Number(summary.storedCount || items.length || 0);
  const totalCount = Number(summary.totalCount || 0);
  const recentCount = Number(summary.recentCount || 0);
  const runtimeCount = items.filter(item => item.kind === 'runtime').length;
  const promiseCount = items.filter(item => item.kind === 'promise').length;
  const requestCount = items.filter(item => item.kind === 'request').length;
  const resourceCount = items.filter(item => item.kind === 'resource').length;
  const recentWindowMinutes = Math.max(1, Math.round(Number(summary.recentWindowMs || 600000) / 60000));

  const summaryHtml = `
    <div class="frontend-error-summary">
      <span>当前保存 <strong>${formatNumber(storedCount)}</strong></span>
      <span>最近 ${formatNumber(recentWindowMinutes)} 分钟 <strong>${formatNumber(recentCount)}</strong></span>
      <span>脚本 <strong>${formatNumber(runtimeCount)}</strong></span>
      <span>异步 <strong>${formatNumber(promiseCount)}</strong></span>
      <span>接口 <strong>${formatNumber(requestCount)}</strong></span>
      <span>资源 <strong>${formatNumber(resourceCount)}</strong></span>
    </div>
    ${renderFrontendErrorFilters(summary)}
    <div class="setting-help">这里只记录当前浏览器页面捕获到的问题，最多保留最近 ${formatNumber(storedCount)} 条。刷新页面后，新的脚本、接口和资源异常会继续自动进入列表。</div>
    ${frontendErrorActionMessage ? `<div class="frontend-error-action-status">${escapeHtml(frontendErrorActionMessage)}</div>` : ''}
    ${renderFrontendErrorDiagnosticPreview()}
  `;

  if (items.length <= 0) {
    return `
      <div class="frontend-error-detail">
        ${summaryHtml}
        <div class="frontend-error-empty">当前页面还没有捕获到前端异常。页面如果出现白屏、按钮无响应或资源加载失败，这里会自动显示。</div>
      </div>
    `;
  }

  const actionsHtml = `
    <div class="frontend-error-actions">
      <button type="button" class="mini-btn" data-action="copy-frontend-error-diagnostic">复制诊断信息</button>
      <button type="button" class="mini-btn" data-action="export-frontend-error-diagnostic">导出 JSON</button>
      <button type="button" class="mini-btn" data-action="reset-frontend-errors">清空本页异常</button>
    </div>
  `;

  if (visibleItems.length <= 0) {
    return `
      <div class="frontend-error-detail">
        ${summaryHtml}
        ${actionsHtml}
        <div class="frontend-error-empty">当前筛选下没有异常记录。</div>
      </div>
    `;
  }

  const listHtml = visibleItems.map(item => {
    const count = Number(item.count || 1);
    const detail = item.detail
      ? `<div class="frontend-error-message">${escapeHtml(item.detail)}</div>`
      : '';
    const stack = item.stack
      ? `<details class="frontend-error-stack"><summary>查看堆栈</summary><pre>${escapeHtml(item.stack)}</pre></details>`
      : '';
    return `
      <div class="frontend-error-row tone-error">
        <div class="frontend-error-row-main">
          <div class="frontend-error-title">${escapeHtml(getFrontendErrorKindText(item))}：${escapeHtml(item.message || '暂无错误说明')}</div>
          <div class="frontend-error-meta">${escapeHtml(formatTime(item.latestAt || item.firstAt))} · ${escapeHtml(formatFrontendErrorLocation(item))}</div>
          ${detail}
          ${stack}
        </div>
        <div class="frontend-error-row-side">
          <strong>${count > 1 ? `${formatNumber(count)} 次` : '1 次'}</strong>
          <span>${escapeHtml(getFrontendErrorItemStatus(item))}</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="frontend-error-detail">
      ${summaryHtml}
      ${actionsHtml}
      <div class="frontend-error-list">${listHtml}</div>
    </div>
  `;
}

function isFrontendErrorDetailModalOpen() {
  const mask = document.getElementById('modal-mask');
  const title = document.getElementById('modal-title');
  return Boolean(
    mask
    && title
    && !mask.classList.contains('hidden')
    && title.textContent === FRONTEND_ERROR_MODAL_TITLE
  );
}

function updateFrontendErrorDetailModal(options = {}) {
  if (!isFrontendErrorDetailModalOpen()) return;
  const content = document.getElementById('modal-content');
  if (!content) return;
  const previousScrollTop = content.scrollTop;
  content.innerHTML = renderFrontendErrorDetail();
  if (options.preserveScroll !== false) {
    content.scrollTop = Math.min(previousScrollTop, Math.max(0, content.scrollHeight - content.clientHeight));
  }
}

function scheduleFrontendErrorDetailRefresh() {
  if (!isFrontendErrorDetailModalOpen() || frontendErrorModalRefreshTimer) return;
  frontendErrorModalRefreshTimer = window.setTimeout(() => {
    frontendErrorModalRefreshTimer = 0;
    updateFrontendErrorDetailModal();
  }, 120);
}

function openFrontendErrorDetailModal() {
  return openModal(FRONTEND_ERROR_MODAL_TITLE, renderFrontendErrorDetail(), {
    confirmText: '关闭',
    showCancel: false,
    html: true,
  });
}

window.addEventListener('crystelf-frontend-error-change', () => {
  scheduleFrontendErrorDetailRefresh();
  refreshConsoleHealthOverviewFromCache();
});

function buildSecurityHealthCard(overview = {}) {
  const security = overview.webConsoleSecurity || {};
  const publicHost = security.publicHost === true;
  const loginConfigured = security.loginConfigured === true;
  const readOnly = security.readOnly === true;
  const status = security.riskLevel || (publicHost && !loginConfigured
    ? 'error'
    : publicHost && !readOnly
      ? 'warn'
      : 'success');
  const riskItems = Array.isArray(security.riskItems) ? security.riskItems : [];
  const riskDetails = Array.isArray(security.riskDetails) ? security.riskDetails : [];
  return {
    title: '访问安全',
    badge: publicHost ? '公网监听' : '本机监听',
    value: security.riskLabel || (loginConfigured ? '需要口令登录' : '没有登录口令'),
    meta: `${security.host || '-'}:${security.port || '-'}，${readOnly ? '只允许查看' : '允许修改配置'}`,
    detail: security.riskDescription
      || riskDetails[0]?.detail
      || riskItems[0]
      || '当前访问策略看起来正常。',
    status,
    href: '/plugin-settings.html',
    quickActions: [
      { label: '安全设置', href: '/plugin-settings.html' },
      ...(publicHost && !readOnly ? [{ label: '开启只读', action: 'enable-web-console-readonly' }] : []),
    ],
  };
}

function buildAuditHealthCard(audit = {}) {
  if (audit.__error) {
    return {
      title: '审计日志',
      badge: '不可用',
      value: '读取失败',
      meta: audit.__error,
      detail: '暂时无法读取操作记录，请检查日志权限或控制台设置。',
      status: 'error',
      href: '/usage-center.html',
      quickActions: [
        { label: '打开日志', href: '/usage-center.html' },
      ],
    };
  }
  const total = Number(audit.total || 0);
  const latest = Array.isArray(audit.items) ? audit.items[0] : null;
  return {
    title: '审计日志',
    badge: total > 0 ? '已有记录' : '暂无记录',
    value: `${formatNumber(total)} 条`,
    meta: latest ? `最近一次：${latest.action || '-'} / ${latest.result || '-'}` : '还没有需要审计的操作。',
    detail: latest?.time ? `最近记录时间：${formatTime(latest.time)}。` : '保存配置、安装依赖、删除数据等操作会自动留下记录。',
    status: total > 0 ? 'success' : 'neutral',
    href: '/usage-center.html',
    quickActions: [
      { label: '查看日志', href: '/usage-center.html' },
      ...(total > 0 ? [{ label: '导出审计', action: 'export-audit-logs' }] : []),
    ],
  };
}

function renderConsoleHealthOverview(overview = {}, health = {}, version = null, audit = {}, performance = null) {
  const target = document.getElementById('console-health-overview');
  if (!target) return;
  lastConsoleHealthOverviewPayload = { overview, health, version, audit, performance };
  const cards = [
    buildRuntimeHealthCard(overview),
    buildBotAdapterWatchdogCard(),
    buildStartupSelfCheckHealthCard(overview),
    buildDependencyHealthCard(health),
    buildApiQualityHealthCard(performance),
    buildVersionHealthCard(version),
    buildStaticCacheHealthCard(overview),
    buildFrontendRequestHealthCard(),
    buildFrontendErrorHealthCard(),
    buildSecurityHealthCard(overview),
    buildAuditHealthCard(audit),
  ];
  target.innerHTML = cards.map(card => renderConsoleHealthCard(card)).join('');
}

function renderLogDiagnosisResult(data = {}) {
  const box = document.getElementById('log-diagnosis-result');
  if (!box) return;
  const files = Array.isArray(data.selectedFiles) && data.selectedFiles.length > 0
    ? data.selectedFiles
    : (Array.isArray(data.files) ? data.files.filter(item => item.selected) : []);
  const fileHtml = files.length > 0
    ? files.map(item => `
      <span class="detail-tag ${Number(item.hitCount || 0) > 0 ? 'tone-error' : 'tone-neutral'}">
        ${escapeHtml(item.displayPath || '未知日志')} · 命中 ${formatNumber(item.hitCount || 0)}
      </span>
    `).join('')
    : '<span class="detail-tag tone-neutral">未选中日志片段</span>';
  const usage = data.usage
    ? `用量 ${formatNumber(Number(data.usage.total_tokens || data.usage.totalTokens || 0))}`
    : '用量暂无';

  box.innerHTML = [
    '<div class="log-diagnosis-summary">',
    `<span>排查时间：${escapeHtml(formatTime(data.diagnosedAt))}</span>`,
    `<span>命中：${escapeHtml(formatNumber(data.hitCount || 0))}</span>`,
    `<span>来源：${escapeHtml(data.source || 'auto')}</span>`,
    `<span>${escapeHtml(usage)}</span>`,
    '</div>',
    `<div class="detail-tags log-diagnosis-files">${fileHtml}</div>`,
    '<div class="log-diagnosis-analysis">',
    `<pre>${escapeHtml(data.analysis || '暂无排查结论')}</pre>`,
    '</div>',
    data.excerptPreview
      ? `<details class="log-diagnosis-preview"><summary>查看送检日志片段预览</summary><pre>${escapeHtml(data.excerptPreview)}</pre></details>`
      : '',
  ].join('');
}

function setLogDiagnosisLoading(isLoading) {
  const button = document.getElementById('log-diagnosis-run-btn');
  if (!button) return;
  button.disabled = isLoading;
  button.textContent = isLoading ? '排查中...' : '开始排查';
}

async function runLogDiagnosis() {
  const box = document.getElementById('log-diagnosis-result');
  if (box) {
    box.innerHTML = '<div class="setting-help">正在读取日志并生成排查建议，请稍等...</div>';
  }
  setLogDiagnosisLoading(true);
  try {
    const data = await postJson('/api/logs/diagnose', {
      source: document.getElementById('log-diagnosis-source')?.value || 'auto',
      includeWarnings: document.getElementById('log-diagnosis-include-warnings')?.checked !== false,
    });
    renderLogDiagnosisResult(data);
  } catch (error) {
    if (box) {
      box.innerHTML = `<div class="setting-status tone-error">日志排查失败：${escapeHtml(error.message)}</div>`;
    }
  } finally {
    setLogDiagnosisLoading(false);
  }
}

function formatDependencyStatus(status) {
  switch (String(status || '').trim()) {
    case 'missing':
      return '缺失';
    case 'version_mismatch':
      return '版本偏差';
    case 'not_installed':
      return '未安装';
    case 'ok':
    default:
      return '正常';
  }
}

function renderDependencies(report) {
  const summary = report?.summary || {};
  const runtimeMissingCount = Number(summary.runtimeMissingCount || 0);
  const problemCount = Number(summary.problemCount || 0);
  const hasManifest = summary.manifestExists !== false;
  const hasMissingRuntimeDependencies = runtimeMissingCount > 0;
  const tone = !hasManifest || hasMissingRuntimeDependencies
    ? 'error'
    : summary.problemCount > 0
      ? 'neutral'
      : 'success';
  const statusText = !hasManifest
    ? '检查异常'
    : hasMissingRuntimeDependencies
      ? '存在缺失'
      : '未发现缺失';
  const note = !summary.totalCount
    ? '暂无依赖检查数据，打开独立页面后可查看完整清单。'
    : !hasManifest
      ? '未找到依赖清单，无法生成完整依赖报告。'
      : hasMissingRuntimeDependencies
        ? `当前缺失 ${runtimeMissingCount} 个运行依赖，请进入依赖检查页处理。`
        : summary.problemCount > 0
          ? `运行依赖未发现缺失，但还有 ${summary.problemCount} 项开发依赖或版本偏差问题。`
          : '当前未发现依赖缺失，完整明细请进入依赖检查页查看。';
  const secondaryText = !summary.totalCount
    ? '等待首次依赖扫描完成'
    : `最近检查：${formatTime(summary.checkedAt)}`;

  document.getElementById('dependency-summary').innerHTML = [
    '<a class="dependency-status-banner-link" href="/dependency-check.html" aria-label="打开依赖检查页">',
    `<div class="dependency-status-banner tone-${tone}">`,
    '<div>',
    `<div class="dependency-status-banner-title">${escapeHtml(statusText)}</div>`,
    `<div class="dependency-status-banner-note">${escapeHtml(note)}</div>`,
    `<div class="dependency-status-banner-meta">${escapeHtml(secondaryText)}</div>`,
    '</div>',
    '<div class="dependency-status-banner-side">',
    '<div class="dependency-status-banner-tags">',
    `<span class="detail-tag tone-${tone}">运行依赖缺失 ${formatNumber(runtimeMissingCount)}</span>`,
    `<span class="detail-tag ${problemCount > 0 ? 'tone-neutral' : 'tone-success'}">其他问题 ${formatNumber(problemCount)}</span>`,
    '</div>',
    '<div class="actions">',
    '<span class="dependency-status-banner-cta">打开依赖检查页</span>',
    '</div>',
    '</div>',
    '</div>',
    '</a>',
  ].join('');
  const list = document.getElementById('dependency-list');
  if (list) {
    list.innerHTML = '';
    list.classList.add('hidden');
  }
}
