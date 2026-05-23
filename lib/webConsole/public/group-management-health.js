// 群管理健康巡检面板。由 group-management.html 在 group-management.js 前加载。

function getGroupManagementHealthLevelLabel(level = '') {
  if (level === 'error') return '错误';
  if (level === 'warning') return '警告';
  if (level === 'info') return '提示';
  if (level === 'success') return '正常';
  return '未知';
}

function getGroupManagementHealthStatusLabel(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'healthy' || value === 'success' || value === 'ok') return '正常';
  if (value === 'warning' || value === 'warn') return '有警告';
  if (value === 'error') return '有错误';
  return '未知';
}

function getGroupManagementHealthTone(level = '') {
  if (level === 'error') return 'tone-error';
  if (level === 'warning') return 'tone-warning';
  if (level === 'success') return 'tone-success';
  return '';
}

function loadGroupManagementHealthIgnores() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HEALTH_IGNORE_STORAGE_KEY) || '[]');
    groupManagementState.healthIgnoredKeys = new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    groupManagementState.healthIgnoredKeys = new Set();
  }
}

function saveGroupManagementHealthIgnores() {
  try {
    localStorage.setItem(HEALTH_IGNORE_STORAGE_KEY, JSON.stringify(Array.from(groupManagementState.healthIgnoredKeys || [])));
  } catch {}
}

function getGroupManagementHealthIgnoreKey(item = {}) {
  const groupIds = (Array.isArray(item.groups) ? item.groups : [])
    .map(group => String(group.groupId || '').trim())
    .filter(Boolean)
    .join(',');
  if (item.code) {
    return [item.code, item.scope, groupIds].map(value => String(value || '').trim()).join('|');
  }
  return [
    item.title,
    item.level,
    item.scope,
    item.groupCount,
    groupIds,
    item.detail,
  ].map(value => String(value || '').trim()).join('|');
}

function isGroupManagementHealthIgnored(item = {}) {
  return groupManagementState.healthIgnoredKeys.has(getGroupManagementHealthIgnoreKey(item));
}

function findGroupManagementHealthItemByKey(key = '') {
  const items = Array.isArray(groupManagementState.payload?.health?.items)
    ? groupManagementState.payload.health.items
    : [];
  return items.find(item => getGroupManagementHealthIgnoreKey(item) === key) || null;
}

function toggleGroupManagementHealthIgnored(key = '', ignored = true) {
  if (!key) return;
  if (ignored) groupManagementState.healthIgnoredKeys.add(key);
  else groupManagementState.healthIgnoredKeys.delete(key);
  saveGroupManagementHealthIgnores();
  renderHealthPanel();
}

function getGroupManagementHealthActionType(item = {}) {
  if (item.fixAction?.type) return String(item.fixAction.type || '');
  const text = `${item.title || ''} ${item.detail || ''} ${item.suggestion || ''}`;
  if (/API|接口|密钥|模型/i.test(text)) return 'api-settings';
  if (/安全|危险|禁言|撤回|踢人/.test(text)) return 'safety';
  if (/总开关|插件设置|groupManagement|auth|welcome|imageMonitor|ai/.test(text)) return 'plugin-settings';
  if ((item.groups || []).length > 0) return 'group';
  return 'scan';
}

function getGroupManagementHealthActionLabel(actionType = '') {
  if (actionType === 'auto_fix') return '自动修复';
  if (actionType === 'open_page') return '打开设置';
  if (actionType === 'open_panel') return '打开面板';
  if (actionType === 'open_group') return '打开群';
  if (actionType === 'api-settings') return '打开 API 设置';
  if (actionType === 'safety') return '打开安全开关';
  if (actionType === 'plugin-settings') return '打开插件设置';
  if (actionType === 'group') return '打开首个群';
  return '重新扫描';
}

function renderGroupManagementHealthActions(item = {}, ignored = false) {
  const key = escapeHtml(getGroupManagementHealthIgnoreKey(item));
  const actionType = getGroupManagementHealthActionType(item);
  const actionLabel = item.fixAction?.label || getGroupManagementHealthActionLabel(actionType);
  const hasGroups = Array.isArray(item.groups) && item.groups.length > 0;
  return `
    <div class="group-management-health-actions">
      <button type="button" class="mini-btn" data-action="handle-health-item" data-health-key="${key}" data-health-action="${escapeHtml(actionType)}">${escapeHtml(actionLabel)}</button>
      ${hasGroups ? `<button type="button" class="mini-btn" data-action="load-health-groups" data-health-key="${key}">载入样本群</button>` : ''}
      <button type="button" class="mini-btn" data-action="${ignored ? 'unignore-health-item' : 'ignore-health-item'}" data-health-key="${key}">${ignored ? '取消忽略' : '忽略'}</button>
    </div>
  `;
}

function renderGroupManagementHealthGroups(item = {}) {
  const groups = Array.isArray(item.groups) ? item.groups : [];
  if (groups.length === 0) {
    return '<div class="setting-help">影响范围：全局配置</div>';
  }
  const hiddenCount = Math.max(0, Number(item.groupCount || 0) - groups.length);
  return `
    <div class="group-management-health-groups">
      ${groups.map(group => `
        <button type="button" class="detail-tag group-management-health-group" data-group-id="${escapeHtml(group.groupId || '')}">
          ${escapeHtml(group.name || group.groupId || '未知群')}
          <span>${escapeHtml(group.groupId || '')}</span>
        </button>
      `).join('')}
      ${hiddenCount > 0 ? `<span class="detail-tag">还有 ${escapeHtml(formatNumber(hiddenCount))} 个群</span>` : ''}
    </div>
  `;
}

function renderHealthPanel() {
  const box = $('group-management-health');
  const meta = $('group-management-health-meta');
  const scanButton = $('group-management-health-scan-btn');
  const ignoredToggle = document.querySelector('[data-action="toggle-health-ignored"]');
  if (!box) return;
  if (scanButton) scanButton.disabled = false;
  if (ignoredToggle) ignoredToggle.textContent = groupManagementState.healthShowIgnored ? '隐藏忽略项' : '显示忽略项';
  const health = groupManagementState.payload?.health || null;
  if (!health) {
    box.innerHTML = '<div class="group-management-empty">暂无健康检查结果，请刷新群数据。</div>';
    if (meta) meta.textContent = '等待扫描群管理配置。';
    return;
  }
  const summary = health.summary || {};
  const rawItems = Array.isArray(health.items) ? health.items : [];
  const ignoredCount = rawItems.filter(item => isGroupManagementHealthIgnored(item)).length;
  const items = rawItems.filter(item => groupManagementState.healthShowIgnored || !isGroupManagementHealthIgnored(item));
  const statusText = health.status === 'healthy'
    ? '未发现明显问题'
    : health.status === 'error'
      ? '存在需要处理的问题'
      : '存在建议优化项';
  if (meta) {
    meta.textContent = `${statusText} / ${formatDateTime(health.generatedAt)} / 显示 ${formatNumber(items.length)} 项 / 已忽略 ${formatNumber(ignoredCount)} 项`;
  }
  const summaryCards = [
    { label: '错误', value: summary.errors || 0, level: 'error' },
    { label: '警告', value: summary.warnings || 0, level: 'warning' },
    { label: '提示', value: summary.infos || 0, level: 'info' },
    { label: '正常', value: summary.success || 0, level: 'success' },
  ];
  box.innerHTML = `
    <div class="group-management-health-summary">
      ${summaryCards.map(item => `
        <div class="group-management-health-summary-item ${escapeHtml(getGroupManagementHealthTone(item.level))}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(formatNumber(item.value))}</strong>
        </div>
      `).join('')}
    </div>
    <div class="group-management-health-list">
      ${items.length > 0 ? items.map(item => {
        const ignored = isGroupManagementHealthIgnored(item);
        return `
        <article class="group-management-health-item ${escapeHtml(getGroupManagementHealthTone(item.level))} ${ignored ? 'is-ignored' : ''}">
          <div class="group-management-health-item-head">
            <div>
              <strong>${escapeHtml(item.title || '未命名检查项')}</strong>
              <span>${escapeHtml(getGroupManagementHealthLevelLabel(item.level))} / ${escapeHtml(item.scope === 'group' ? `影响 ${formatNumber(item.groupCount || 0)} 个群` : '全局')}${ignored ? ' / 已忽略' : ''}</span>
            </div>
            <span class="detail-tag ${escapeHtml(getGroupManagementHealthTone(item.level))}">${escapeHtml(getGroupManagementHealthLevelLabel(item.level))}</span>
          </div>
          <div class="group-management-health-detail">${escapeHtml(item.detail || '暂无详情')}</div>
          ${item.suggestion ? `<div class="group-management-health-suggestion">${escapeHtml(item.suggestion)}</div>` : ''}
          ${renderGroupManagementHealthGroups(item)}
          ${renderGroupManagementHealthActions(item, ignored)}
        </article>
      `;}).join('') : '<div class="group-management-empty">暂无未忽略的健康检查结果。</div>'}
    </div>
  `;
}

async function runGroupManagementHealthCheck() {
  const button = $('group-management-health-scan-btn');
  if (button) button.disabled = true;
  try {
    await refreshGroupManagement({ keepMessage: true });
    showSuccess('群管理配置健康检查已完成。');
  } catch (error) {
    showRisk(`健康检查失败：${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

function buildGroupManagementHealthExportPayload() {
  const health = groupManagementState.payload?.health || {};
  const items = Array.isArray(health.items) ? health.items : [];
  return {
    exportedAt: new Date().toISOString(),
    selectedGroupId: groupManagementState.selectedGroupId || '',
    health: {
      ...health,
      items: items.map(item => ({
        ...item,
        ignored: isGroupManagementHealthIgnored(item),
      })),
    },
  };
}

function formatGroupManagementHealthMarkdown(payload = {}) {
  const health = payload.health || {};
  const items = Array.isArray(health.items) ? health.items : [];
  const lines = [
    '# 群管理配置健康检查',
    '',
    `- 导出时间：${payload.exportedAt || new Date().toISOString()}`,
    `- 状态：${getGroupManagementHealthStatusLabel(health.status)}`,
    `- 错误：${health.summary?.errors || 0}`,
    `- 警告：${health.summary?.warnings || 0}`,
    `- 提示：${health.summary?.infos || 0}`,
    `- 已忽略：${items.filter(item => item.ignored).length}`,
    '',
  ];
  for (const level of ['error', 'warning', 'info', 'success']) {
    const group = items.filter(item => item.level === level);
    if (group.length === 0) continue;
    lines.push(`## ${getGroupManagementHealthLevelLabel(level)}`, '');
    group.forEach((item, index) => {
      const groups = (item.groups || []).map(group => `${group.name || group.groupId}(${group.groupId})`).join('、') || '全局';
      lines.push(`${index + 1}. ${item.title}${item.ignored ? '（已忽略）' : ''}`);
      lines.push(`   - 详情：${item.detail || '暂无'}`);
      if (item.suggestion) lines.push(`   - 建议：${item.suggestion}`);
      lines.push(`   - 范围：${groups}`);
      lines.push('');
    });
  }
  return lines.join('\n');
}

function exportGroupManagementHealth(format = 'markdown') {
  const payload = buildGroupManagementHealthExportPayload();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  if (format === 'json') {
    downloadTextFile(`group-management-health-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
    showSuccess('健康检查原始数据已导出。');
    return;
  }
  downloadTextFile(`group-management-health-${stamp}.md`, formatGroupManagementHealthMarkdown(payload), 'text/markdown');
  showSuccess('健康检查报告已导出。');
}

function handleGroupManagementHealthItem(key = '', actionType = '') {
  const item = findGroupManagementHealthItemByKey(key);
  if (!item) {
    showRisk('健康检查项已变化，请重新扫描。');
    return;
  }
  const type = actionType || getGroupManagementHealthActionType(item);
  const fixAction = item.fixAction || {};
  if (type === 'auto_fix') {
    applyGroupManagementHealthFix(item).catch(error => showRisk(`自动修复失败：${error.message}`));
    return;
  }
  if (type === 'open_page' && fixAction.target) {
    const pageMap = {
      'api-settings': '/api-settings.html',
      'plugin-settings': '/plugin-settings.html',
    };
    window.open(pageMap[fixAction.target] || `/${fixAction.target}.html`, '_blank', 'noopener');
    return;
  }
  if (type === 'open_panel' && fixAction.target === 'safety') {
    document.querySelector('.group-management-safety-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (type === 'open_group' && fixAction.groupId) {
    const button = document.querySelector(`[data-group-id="${escapeCssString(fixAction.groupId)}"]`);
    if (button instanceof HTMLElement) button.click();
    return;
  }
  if (type === 'api-settings') {
    window.open('/api-settings.html', '_blank', 'noopener');
    return;
  }
  if (type === 'plugin-settings') {
    window.open('/plugin-settings.html', '_blank', 'noopener');
    return;
  }
  if (type === 'safety') {
    document.querySelector('.group-management-safety-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const firstGroup = Array.isArray(item.groups) ? item.groups[0] : null;
  if (firstGroup?.groupId) {
    const button = document.querySelector(`[data-group-id="${escapeCssString(firstGroup.groupId)}"]`);
    if (button instanceof HTMLElement) button.click();
    return;
  }
  runGroupManagementHealthCheck().catch(error => showRisk(`健康检查失败：${error.message}`));
}

async function applyGroupManagementHealthFix(item = {}) {
  const code = String(item.code || item.fixAction?.code || '').trim();
  const sourceGroupIds = Array.isArray(item.fixAction?.groupIds)
    ? item.fixAction.groupIds
    : (Array.isArray(item.groups) ? item.groups.map(group => group.groupId) : []);
  const groupIds = sourceGroupIds
    .map(normalizeGroupId)
    .filter(Boolean);
  if (!code || groupIds.length === 0) {
    showRisk('这条检查项没有可自动修复的群样本。');
    return;
  }
  const confirmed = await confirmGroupManagementModal(
    `确认自动修复 ${groupIds.length} 个样本群？\n\n检查项：${item.title || code}\n群号：${groupIds.join('、')}`,
    { title: '自动修复健康检查项' },
  );
  if (!confirmed) return;
  const result = await postJson('/api/group-management/health/fix', {
    code,
    groupIds,
    selectedGroupId: groupManagementState.selectedGroupId,
  });
  groupManagementState.payload = result;
  groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId;
  showSuccess(result.message || '健康检查项已自动修复。');
  renderSummary();
  renderHealthPanel();
  renderSafetyPanel();
  renderDefaultsPanel();
  renderBulkPanel();
  renderGroupList();
  renderDetail();
  await refreshGroupManagementLogs(1);
  await refreshGroupManagementEventStreamNow({ reset: true });
}

function handleFirstGroupManagementHealthIssue() {
  const items = Array.isArray(groupManagementState.payload?.health?.items)
    ? groupManagementState.payload.health.items
    : [];
  const item = items.find(entry => (
    entry.level !== 'success'
    && (groupManagementState.healthShowIgnored || !isGroupManagementHealthIgnored(entry))
  ));
  if (!item) {
    showSuccess('当前没有需要处理的未忽略检查项。');
    return;
  }
  handleGroupManagementHealthItem(
    getGroupManagementHealthIgnoreKey(item),
    getGroupManagementHealthActionType(item),
  );
}

function loadHealthGroupsToBulkSelection(key = '') {
  const item = findGroupManagementHealthItemByKey(key);
  const groupIds = (item?.groups || []).map(group => normalizeGroupId(group.groupId)).filter(Boolean);
  if (groupIds.length === 0) {
    showRisk('这条检查项没有可载入的群样本。');
    return;
  }
  setBulkSelectedGroupIds(groupIds);
  renderBulkPanel();
  document.querySelector('.group-management-bulk-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showSuccess(`已载入 ${groupIds.length} 个样本群到批量选择。`);
}
