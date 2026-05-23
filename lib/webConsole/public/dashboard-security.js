function getPublicSecurityTone(value = '') {
  const tone = String(value || '').trim().toLowerCase();
  if (tone === 'error') return 'error';
  if (tone === 'warn' || tone === 'warning') return 'warning';
  if (tone === 'success' || tone === 'ok') return 'success';
  return 'neutral';
}

function renderPublicSecurityStat(label, value, meta, tone = 'neutral') {
  return `
    <div class="public-security-stat tone-${getPublicSecurityTone(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || '-')}</strong>
      <small>${escapeHtml(meta || '')}</small>
    </div>
  `;
}

function renderPublicSecuritySummary(security = {}) {
  const tone = getPublicSecurityTone(security.riskLevel || 'neutral');
  const label = security.riskLabel || (tone === 'error' ? '高风险' : tone === 'warning' ? '需要注意' : tone === 'success' ? '看起来安全' : '状态未知');
  const title = security.riskTitle || '公网访问安全状态';
  const desc = security.riskDescription || security.publicAccessHint || '暂时没有更多安全说明。';
  return `
    <div class="public-security-summary tone-${tone}">
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(desc)}</p>
      </div>
    </div>
  `;
}

function normalizePublicSecurityRiskItem(item) {
  if (typeof item === 'string') {
    return {
      level: 'warn',
      title: item,
      detail: '',
      action: '',
    };
  }
  return {
    level: item?.level || 'warn',
    title: item?.title || '安全提示',
    detail: item?.detail || '',
    action: item?.action || '',
  };
}

function renderPublicSecurityRiskItem(item) {
  const risk = normalizePublicSecurityRiskItem(item);
  return `
    <div class="public-security-risk-item tone-${getPublicSecurityTone(risk.level)}">
      <strong>${escapeHtml(risk.title)}</strong>
      ${risk.detail ? `<span>${escapeHtml(risk.detail)}</span>` : ''}
      ${risk.action ? `<small>${escapeHtml(risk.action)}</small>` : ''}
    </div>
  `;
}

function renderPublicSecurityRiskList(security = {}) {
  const structuredItems = Array.isArray(security.riskDetails) && security.riskDetails.length > 0
    ? security.riskDetails
    : Array.isArray(security.recommendations) && security.recommendations.length > 0
      ? security.recommendations
      : Array.isArray(security.riskItems)
        ? security.riskItems
        : [];
  if (structuredItems.length <= 0) {
    return '<div class="public-security-risk-list"><div class="public-security-risk-item tone-success"><strong>当前未发现明显公网暴露风险</strong><span>继续保持强口令，并只把控制台开放给可信网络。</span></div></div>';
  }
  return `<div class="public-security-risk-list">${structuredItems.map(renderPublicSecurityRiskItem).join('')}</div>`;
}

function renderPublicSecurityProtectionList(security = {}) {
  const protections = security.protections || {};
  const items = [
    { label: '登录口令', value: protections.loginRequired ? '已启用' : '未启用', tone: protections.loginRequired ? 'success' : 'error' },
    { label: '写操作', value: protections.readOnly ? '只读保护' : '允许写入', tone: protections.readOnly ? 'success' : 'warning' },
    { label: '日志查看', value: protections.logAccessLimited ? '已隐藏' : '已开放', tone: protections.logAccessLimited ? 'success' : 'warning' },
    { label: '失败锁定', value: protections.loginFailureLock ? '已启用' : '未知', tone: protections.loginFailureLock ? 'success' : 'neutral' },
  ];
  return `
    <div class="public-security-protections">
      ${items.map(item => `<span class="tone-${getPublicSecurityTone(item.tone)}">${escapeHtml(item.label)}：${escapeHtml(item.value)}</span>`).join('')}
    </div>
  `;
}

function renderPublicSecurityOverview(overview = {}, authStatus = {}) {
  const target = document.getElementById('public-security-overview');
  if (!target) return;
  const security = overview.webConsoleSecurity || {};
  const attempts = authStatus.loginAttempts || {};
  const publicHost = security.publicHost === true;
  const readOnly = security.readOnly === true;
  const loginConfigured = security.loginConfigured === true;
  const tokenStrength = security.tokenStrength || {};
  const currentUrl = window.location.origin ? `${window.location.origin}/` : (security.accessUrl || '');
  const blocked = attempts.blocked === true;
  const failureText = `${formatNumber(attempts.failures || 0)} / ${formatNumber(attempts.maxFailures || 0)}`;
  const localCache = window.CrystelfLocalCache?.getSummary?.() || { available: false, count: 0, totalBytesLabel: '0 B' };
  const cacheButtonText = localCache.count > 0
    ? `清理本机缓存（${formatNumber(localCache.count)} 项）`
    : '清理本机缓存';

  const readOnlyButton = publicHost && !readOnly
    ? '<button class="mini-btn" type="button" data-security-action="enable-readonly">一键开启只读</button>'
    : '';

  target.innerHTML = [
    renderPublicSecuritySummary(security),
    '<div class="public-security-stats">',
    renderPublicSecurityStat(
      '监听范围',
      security.accessScopeLabel || (publicHost ? '外部可访问' : '仅本机'),
      `${security.host || '-'}:${security.port || '-'}`,
      security.riskLevel || (publicHost ? 'warning' : 'success'),
    ),
    renderPublicSecurityStat(
      '登录口令',
      loginConfigured ? (tokenStrength.label || '已配置') : '未配置',
      tokenStrength.detail || (attempts.clientIp ? `当前 IP：${attempts.clientIp}` : '当前 IP 未识别'),
      loginConfigured ? (tokenStrength.level || 'success') : 'error',
    ),
    renderPublicSecurityStat(
      '写入策略',
      readOnly ? '只读模式' : '可写模式',
      security.exposeLogs === false ? '日志接口隐藏' : '日志接口可读',
      publicHost && !readOnly ? 'warning' : 'success',
    ),
    renderPublicSecurityStat(
      '登录防护',
      blocked ? '已临时封禁' : failureText,
      blocked ? `解封：${formatTime(attempts.blockedUntil)}` : `剩余尝试：${formatNumber(attempts.remainingFailures || 0)}`,
      blocked ? 'error' : Number(attempts.failures || 0) > 0 ? 'warning' : 'success',
    ),
    '</div>',
    '<div class="public-security-detail">',
    `<div class="public-security-url"><span>当前访问地址</span><code>${escapeHtml(currentUrl || '-')}</code></div>`,
    `<div class="setting-help">${escapeHtml(security.publicAccessHint || '暂无安全提示。')}</div>`,
    renderPublicSecurityProtectionList(security),
    renderPublicSecurityRiskList(security),
    '<div class="actions public-security-actions">',
    `<button class="mini-btn" type="button" data-security-copy-url="${escapeHtml(currentUrl || '')}">复制访问地址</button>`,
    security.accessUrl && security.accessUrl !== currentUrl
      ? `<button class="mini-btn" type="button" data-security-copy-url="${escapeHtml(security.accessUrl)}">复制本机地址</button>`
      : '',
    localCache.available
      ? `<button class="mini-btn" type="button" data-security-action="clear-local-cache">${escapeHtml(cacheButtonText)}</button>`
      : '',
    readOnlyButton,
    '<a class="link-btn" href="/usage-center.html">查看审计日志</a>',
    '</div>',
    '</div>',
  ].join('');
}

async function copyPublicSecurityUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    await openModal('复制失败', '当前没有可复制的访问地址。', { showCancel: false });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    await openModal('已复制', text, { showCancel: false });
  } catch {
    await openModal('复制地址', text, { showCancel: false });
  }
}

async function enableWebConsoleReadOnlyMode() {
  const confirmed = await openModal(
    '开启只读模式',
    '开启后控制台会拒绝保存配置、安装依赖、清理日志等写操作；如需恢复可写，需要在本机配置文件中把 webConsoleReadOnly 改回 false。确认继续？',
    { confirmText: '开启只读', cancelText: '取消', showCancel: true },
  );
  if (!confirmed) return;
  await postJson('/api/plugin-settings/save', {
    data: {
      'config.webConsoleReadOnly': true,
    },
  });
  await openModal('已开启只读', '控制台只读模式已写入配置，后续写操作会被拒绝。', { showCancel: false });
  await refresh();
}

async function clearDashboardLocalCache() {
  const cache = window.CrystelfLocalCache;
  const summary = cache?.getSummary?.() || { available: false, count: 0 };
  if (!summary.available) {
    await openModal('无法清理', '当前浏览器不允许读取本机缓存。', { showCancel: false });
    return;
  }
  if (summary.count <= 0) {
    await openModal('无需清理', '当前浏览器没有检测到控制台本机缓存。', { showCancel: false });
    return;
  }

  const labelText = summary.labels?.length
    ? `\n\n将清理：${summary.labels.slice(0, 8).join('、')}${summary.labels.length > 8 ? '等' : ''}`
    : '';
  const confirmed = await openModal(
    '清理本机缓存',
    `将清理当前浏览器保存的 ${summary.count} 项控制台缓存（约 ${summary.totalBytesLabel}）。这不会修改服务器配置，也不会退出当前登录；刷新页面后会恢复默认视图。${labelText}`,
    { confirmText: '清理缓存', cancelText: '取消', showCancel: true },
  );
  if (!confirmed) return;

  const result = cache.clear();
  const failedText = result.failedCount > 0 ? `，${result.failedCount} 项清理失败` : '';
  await openModal('清理完成', `已清理 ${result.removedCount} 项本机缓存${failedText}。如果页面仍显示旧筛选或旧主题，刷新页面即可恢复默认视图。`, { showCancel: false });
  await refresh();
}

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.securityCopyUrl !== undefined) {
    copyPublicSecurityUrl(target.dataset.securityCopyUrl).catch(error => openModal('复制失败', error.message, { showCancel: false }));
    return;
  }
  if (target.dataset.securityAction === 'copy-current-url') {
    copyPublicSecurityUrl(window.location.origin ? `${window.location.origin}/` : '').catch(error => openModal('复制失败', error.message, { showCancel: false }));
    return;
  }
  if (target.dataset.securityAction === 'enable-readonly') {
    enableWebConsoleReadOnlyMode().catch(error => openModal('开启失败', error.message, { showCancel: false }));
    return;
  }
  if (target.dataset.securityAction === 'clear-local-cache') {
    clearDashboardLocalCache().catch(error => openModal('清理失败', error.message, { showCancel: false }));
  }
});
