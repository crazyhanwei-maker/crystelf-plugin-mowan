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

  // 紧凑摘要行：状态点 + 风险标签 + 短结论（长描述去掉，具体风险在底部单行展示）
  const tone = getPublicSecurityTone(security.riskLevel || 'neutral');
  const riskLabel = security.riskLabel || (tone === 'error' ? '高风险' : tone === 'warning' ? '需要注意' : tone === 'success' ? '看起来安全' : '状态未知');
  const riskTitle = security.riskTitle || '公网访问安全状态';

  // 关键项紧凑行：label + 值，替代四张大卡
  const facts = [
    { label: '监听', value: security.accessScopeLabel || (publicHost ? '外部可访问' : '仅本机'), tone: publicHost ? 'warning' : 'success' },
    { label: '口令', value: loginConfigured ? (tokenStrength.label || '已配置') : '未配置', tone: loginConfigured ? (tokenStrength.level || 'success') : 'error' },
    { label: '写入', value: readOnly ? '只读模式' : '可写模式', tone: publicHost && !readOnly ? 'warning' : 'success' },
    { label: '防护', value: blocked ? '已临时封禁' : failureText, tone: blocked ? 'error' : Number(attempts.failures || 0) > 0 ? 'warning' : 'success' },
  ];

  // 风险行：仅有内容时逐条单行展示；无风险一行带过
  const structuredItems = Array.isArray(security.riskDetails) && security.riskDetails.length > 0
    ? security.riskDetails
    : Array.isArray(security.recommendations) && security.recommendations.length > 0
      ? security.recommendations
      : Array.isArray(security.riskItems)
        ? security.riskItems
        : [];
  const riskLines = structuredItems.length
    ? `<div class="public-security-risk-lines">${structuredItems.map(item => {
      const risk = normalizePublicSecurityRiskItem(item);
      const riskTone = getPublicSecurityTone(risk.level);
      return `<div class="public-security-risk-line tone-${riskTone}"><strong>${escapeHtml(risk.title)}</strong>${risk.detail ? `<span>${escapeHtml(risk.detail)}</span>` : ''}${risk.action ? `<small>${escapeHtml(risk.action)}</small>` : ''}</div>`;
    }).join('')}</div>`
    : '<div class="public-security-risk-line tone-success"><strong>未发现明显公网暴露风险</strong></div>';

  target.innerHTML = [
    '<div class="public-security-compact">',
    `<div class="public-security-summary-row tone-${tone}"><span class="public-security-dot" aria-hidden="true"></span><strong>${escapeHtml(riskLabel)}</strong><span class="public-security-summary-text">${escapeHtml(riskTitle)}</span></div>`,
    `<div class="public-security-facts">${facts.map(fact => `<span class="public-security-fact tone-${getPublicSecurityTone(fact.tone)}"><em>${escapeHtml(fact.label)}</em><strong>${escapeHtml(fact.value)}</strong></span>`).join('')}</div>`,
    `<div class="public-security-url-row"><code>${escapeHtml(currentUrl || '-')}</code><span class="public-security-url-actions">`,
    `<button class="mini-btn" type="button" data-security-copy-url="${escapeHtml(currentUrl || '')}">复制地址</button>`,
    security.accessUrl && security.accessUrl !== currentUrl
      ? `<button class="mini-btn" type="button" data-security-copy-url="${escapeHtml(security.accessUrl)}">复制本机地址</button>`
      : '',
    localCache.available
      ? `<button class="mini-btn" type="button" data-security-action="clear-local-cache">${escapeHtml(cacheButtonText)}</button>`
      : '',
    readOnlyButton,
    '<a class="link-btn" href="/usage-center.html">审计日志</a>',
    '</span></div>',
    riskLines,
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
