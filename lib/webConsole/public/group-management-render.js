// 群管理页面通用渲染层。由 group-management.html 在 group-management.js 前加载。

function updateSelectedGroupModeration(moderation) {
  const group = getSelectedGroup();
  if (!group || !moderation) return;
  group.config = {
    ...(group.config || {}),
    moderation,
  };
}

function getFilteredGroups() {
  const keyword = String($('group-management-search')?.value || '').trim().toLowerCase();
  const groups = getGroups();
  if (!keyword) return groups;
  return groups.filter((item) => [
    item.groupId,
    item.name,
    item.displayName,
    item.sourceText,
  ].some(value => String(value || '').toLowerCase().includes(keyword)));
}

function getBulkFeature() {
  const value = String($('gm-bulk-feature')?.value || groupManagementState.bulkFeature || 'ai').trim();
  return GROUP_MANAGEMENT_BULK_FEATURES[value] ? value : 'ai';
}

function isGroupEnabledForBulkFeature(group = {}, feature = getBulkFeature()) {
  const config = group.config || {};
  if (feature === 'ai') return config.ai?.whitelisted === true;
  if (feature === 'imageMonitor') return config.imageMonitor?.allowed === true;
  if (feature === 'auth') return config.auth?.config?.enable === true;
  if (feature === 'autoApprove') return config.auth?.config?.autoApprove?.enable === true;
  if (feature === 'welcome') return config.welcome?.enabled === true;
  if (feature === 'aiWelcome') return config.welcome?.aiEnabled === true;
  if (feature === 'dailySummary') return config.dailySummary?.effectiveEnabled === true || config.dailySummary?.allowed === true;
  return false;
}

function getBulkSelectedGroupIds() {
  return Array.from(groupManagementState.bulkSelectedGroupIds || new Set())
    .map(normalizeGroupId)
    .filter(Boolean);
}

function setBulkSelectedGroupIds(groupIds = []) {
  groupManagementState.bulkSelectedGroupIds = new Set(
    groupIds.map(normalizeGroupId).filter(Boolean),
  );
}

function renderBulkMeta() {
  const meta = $('group-management-bulk-meta');
  const applyButton = $('group-management-bulk-apply-btn');
  if (!meta || !applyButton) return;
  const selectedCount = getBulkSelectedGroupIds().length;
  const feature = getBulkFeature();
  const featureInfo = GROUP_MANAGEMENT_BULK_FEATURES[feature] || GROUP_MANAGEMENT_BULK_FEATURES.ai;
  meta.textContent = `已选择 ${formatNumber(selectedCount)} 个群 / ${featureInfo.help}`;
  applyButton.disabled = selectedCount <= 0 || groupManagementState.payload?.readOnly === true;
}

function renderBulkPanel() {
  const box = $('group-management-bulk-list');
  if (!box) return;
  const groups = getFilteredGroups();
  const selectedSet = new Set(getBulkSelectedGroupIds());
  const feature = getBulkFeature();
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  box.innerHTML = groups.length > 0
    ? groups.map(group => {
        const isChecked = selectedSet.has(group.groupId);
        const isEnabled = isGroupEnabledForBulkFeature(group, feature);
        return `
          <label class="group-management-bulk-item ${isChecked ? 'active' : ''}">
            <input type="checkbox" data-bulk-group-id="${escapeHtml(group.groupId)}" ${isChecked ? 'checked' : ''} ${disabledAttr} />
            <span>
              <strong>${escapeHtml(group.displayName || group.groupId)}</strong>
              <small>群号 ${escapeHtml(group.groupId)} / ${isEnabled ? '当前已开启' : '当前未开启'}</small>
            </span>
          </label>
        `;
      }).join('')
    : '<div class="group-management-empty">没有匹配的群记录。</div>';
  renderBulkMeta();
}

function renderSummary() {
  const payload = groupManagementState.payload || {};
  const summary = payload.summary || {};
  const runtime = payload.runtime || {};
  const items = [
    { label: '群记录', value: summary.groups || 0, meta: `运行时 ${formatNumber(summary.runtimeGroups || 0)}` },
    { label: 'AI 黑名单', value: summary.aiBlocked || 0, meta: `白名单 ${formatNumber(summary.aiWhitelisted || 0)}` },
    { label: '图片监控', value: summary.imageAllowed || 0, meta: `黑名单 ${formatNumber(summary.imageBlocked || 0)}` },
    { label: '入群配置', value: summary.authCustomGroups || 0, meta: `自定义 ${formatNumber(summary.authCustomGroupCount || 0)} / 自动通过 ${formatNumber(summary.autoApproveGroups || 0)} / 欢迎 ${formatNumber(summary.welcomeGroups || 0)}` },
    { label: '每日总结', value: summary.dailySummaryEnabled || 0, meta: `禁用 ${formatNumber(summary.dailySummaryBlocked || 0)}` },
    { label: '群管风控', value: summary.moderationGroups || 0, meta: `消息风控 ${formatNumber(summary.moderationContentEnabledGroups || 0)} / 黑 ${formatNumber(summary.moderationBlacklistUsers || 0)} / 白 ${formatNumber(summary.moderationWhitelistUsers || 0)} / 警告 ${formatNumber(summary.moderationWarningPoints || 0)}` },
  ];
  $('group-management-summary').innerHTML = items.map(item => `
    <article class="dashboard-strip-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${formatNumber(item.value)}</strong>
      <div>${escapeHtml(item.meta)}</div>
    </article>
  `).join('');

  const warnings = (runtime.warnings || []).length > 0
    ? `，运行时提示：${runtime.warnings.slice(0, 2).join('；')}`
    : '';
  setStatus(runtime.botAvailable
    ? `已读取 ${formatNumber(runtime.groupCount || 0)} 个运行时群${warnings}`
    : '当前控制台未拿到机器人运行时群列表，可直接输入群号管理配置');
}

function getGroupToneTags(group) {
  const config = group.config || {};
  const tags = [];
  tags.push(config.ai?.effectiveEnabled
    ? '<span class="detail-tag tone-success">AI 可用</span>'
    : '<span class="detail-tag tone-error">AI 不工作</span>');
  tags.push(config.imageMonitor?.effectiveEnabled
    ? '<span class="detail-tag tone-success">图片监控开</span>'
    : '<span class="detail-tag">图片监控关</span>');
  tags.push(config.dailySummary?.effectiveEnabled
    ? '<span class="detail-tag tone-success">每日总结开</span>'
    : '<span class="detail-tag">每日总结关</span>');
  tags.push(config.auth?.config?.enable
    ? '<span class="detail-tag tone-warning">入群验证开</span>'
    : '<span class="detail-tag">入群验证关</span>');
  if (config.auth?.config?.autoApprove?.enable) {
    tags.push('<span class="detail-tag tone-success">申请自动过</span>');
  }
  if ((config.moderation?.blacklist || []).length > 0) {
    tags.push(`<span class="detail-tag tone-error">黑名单 ${escapeHtml(formatNumber(config.moderation.blacklist.length))}</span>`);
  }
  if ((config.moderation?.warnings || []).length > 0) {
    tags.push(`<span class="detail-tag tone-warning">警告 ${escapeHtml(formatNumber(config.moderation.warnings.reduce((sum, item) => sum + Number(item.count || 0), 0)))}</span>`);
  }
  if (config.moderation?.content?.enabled === true) {
    tags.push('<span class="detail-tag tone-warning">消息风控开</span>');
  }
  if (config.welcome?.enabled === true) {
    tags.push('<span class="detail-tag tone-success">欢迎开</span>');
  } else if (config.welcome?.hasCustom) {
    tags.push('<span class="detail-tag">欢迎关</span>');
  }
  return tags.join('');
}

function buildGroupSimulatorUrl(group = {}) {
  const params = new URLSearchParams({
    groupId: String(group.groupId || ''),
    eventType: 'message',
    userId: '20001',
    nickname: '测试用户',
    role: 'member',
    botRole: String(group.permissions?.role || group.botRole || 'member'),
    adapterFormat: 'onebot',
    includeAt: 'true',
    dispatchMode: 'safe',
    conversationMode: 'true',
    messageText: '你好，帮我测试一下当前群的回复链路。',
    comment: `从群管理打开：${group.displayName || group.groupId || '未知群'}`,
  });
  return `/qq-simulator.html?${params.toString()}`;
}

function formatBotRoleLabel(role = '') {
  const text = String(role || '').trim().toLowerCase();
  if (text === 'owner' || text.includes('owner') || text.includes('群主')) return '群主';
  if (text === 'admin' || text.includes('admin') || text.includes('管理员')) return '管理员';
  if (text === 'member' || text.includes('member') || text.includes('成员')) return '成员';
  return String(role || '未知').trim() || '未知';
}

function renderGroupList() {
  const groups = getFilteredGroups();
  const selectedId = groupManagementState.selectedGroupId;
  $('group-management-list-meta').textContent = `共 ${formatNumber(groups.length)} 个群记录`;
  $('group-management-list').innerHTML = groups.length > 0
    ? groups.map(group => `
      <button type="button" class="list-item group-management-group-item ${group.groupId === selectedId ? 'active' : ''}" data-group-id="${escapeHtml(group.groupId)}">
        <div class="group-management-group-main">
          <div>
            <h3>${escapeHtml(group.displayName || group.groupId)}</h3>
            <div class="setting-help">群号 ${escapeHtml(group.groupId)} / 来源 ${escapeHtml(group.sourceText || 'manual')}</div>
          </div>
          <div class="detail-tags">${getGroupToneTags(group)}</div>
        </div>
        <div class="group-management-group-meta">
          <span>成员 ${group.memberCount == null ? '未知' : escapeHtml(formatNumber(group.memberCount))}</span>
          <span>上限 ${group.maxMemberCount == null ? '未知' : escapeHtml(formatNumber(group.maxMemberCount))}</span>
          <span>机器人 ${escapeHtml(formatBotRoleLabel(group.permissions?.role || group.botRole))}</span>
        </div>
      </button>
    `).join('')
    : '<div class="list-item">没有匹配的群记录。</div>';
}

function renderFeatureSwitch(id, label, checked, help, disabled) {
  return `
    <label class="group-management-switch">
      <input id="${escapeHtml(id)}" type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      <span>
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(help)}</small>
      </span>
    </label>
  `;
}

function formatModerationListForEdit(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => `${item.userId || item.user_id || ''}${item.note ? ` ${item.note}` : ''}`.trim())
    .filter(Boolean)
    .join('\n');
}

function renderWarningList(warnings = []) {
  const items = Array.isArray(warnings) ? warnings : [];
  if (items.length === 0) {
    return '<div class="group-management-empty">暂无警告积分。</div>';
  }
  return `
    <div class="group-management-warning-list">
      ${items.slice(0, 20).map(item => {
        const latest = Array.isArray(item.items) ? item.items[0] : null;
        return `
          <div class="group-management-warning-item">
            <div>
              <strong>QQ ${escapeHtml(item.userId || item.user_id || '')}</strong>
              <div class="setting-help">${escapeHtml(latest?.reason || '暂无备注')}</div>
            </div>
            <div class="detail-tags">
              <span class="detail-tag tone-warning">${escapeHtml(formatNumber(item.count || 0))} 分</span>
              <span class="detail-tag">${escapeHtml(formatDateTime(item.updatedAt || latest?.createdAt))}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function getRiskTagTone(level = '') {
  if (level === 'high') return 'tone-error';
  if (level === 'medium') return 'tone-warning';
  return 'tone-success';
}

function getRiskLevelLabel(level = '') {
  if (level === 'high') return '高风险';
  if (level === 'medium') return '中风险';
  return '低风险';
}

function renderModerationActionOptions(value = 'log') {
  const safety = getSafetyConfig();
  const current = normalizeModerationAction(value);
  return Object.entries(GROUP_MANAGEMENT_ACTION_LABELS).map(([key, label]) => {
    const blocked = safety.enabled !== false && !isModerationActionAllowedBySafety(key, safety);
    const optionLabel = blocked ? `${label}（安全开关未放行）` : label;
    return `<option value="${key}" ${current === key ? 'selected' : ''} ${blocked && current !== key ? 'disabled' : ''}>${escapeHtml(optionLabel)}</option>`;
  }).join('');
}

function renderUrlSafetyRiskOptions(value = 'high') {
  const current = ['low', 'medium', 'high'].includes(String(value || '').trim()) ? String(value || '').trim() : 'high';
  const options = {
    high: '仅高风险',
    medium: '中风险及以上',
    low: '低风险及以上',
  };
  return Object.entries(options).map(([key, label]) => (
    `<option value="${key}" ${current === key ? 'selected' : ''}>${escapeHtml(label)}</option>`
  )).join('');
}

function renderContentSafetyWarning(contentModeration = {}, id = 'gm-content-safety-warning') {
  const safety = getSafetyConfig();
  const action = normalizeModerationAction(contentModeration.action || 'log');
  const actionWarning = getSafetyActionWarning(action, safety);
  const muteSeconds = Number(contentModeration.muteSeconds || 600);
  const secondsWarning = safety.enabled !== false
    && action === 'mute'
    && Number.isFinite(muteSeconds)
    && muteSeconds > Number(safety.maxAutoMuteSeconds || 600)
    ? `禁言秒数超过安全上限 ${safety.maxAutoMuteSeconds} 秒，运行时会按上限裁剪；控制台保存会被拦截。`
    : '';
  const messages = [actionWarning, secondsWarning].filter(Boolean);
  return `<div id="${escapeHtml(id)}" class="group-management-safety-note ${messages.length === 0 ? 'hidden' : ''}">${messages.map(escapeHtml).join(' ')}</div>`;
}

function refreshContentSafetyWarning(id = 'gm-content-safety-warning', actionId = 'gm-content-action', muteId = 'gm-content-mute-seconds') {
  const box = $(id);
  if (!box) return;
  box.outerHTML = renderContentSafetyWarning({
    action: $(actionId)?.value || 'log',
    muteSeconds: $(muteId)?.value || 600,
  }, id);
}

function renderGroupManagementTemplateOptions() {
  return Object.entries(GROUP_MANAGEMENT_RULE_TEMPLATES)
    .map(([key, item]) => `<option value="${escapeHtml(key)}">${escapeHtml(item.label)}</option>`)
    .join('');
}

function renderPermissionSummary(group = {}) {
  const permissions = group.permissions || {};
  const warnings = Array.isArray(permissions.warnings) ? permissions.warnings : [];
  return `
    <div class="group-management-permission-panel">
      <div class="detail-tags">
        <span class="detail-tag ${permissions.role === 'owner' || permissions.role === 'admin' ? 'tone-success' : permissions.role === 'member' ? 'tone-warning' : ''}">机器人 ${escapeHtml(permissions.roleLabel || group.botRole || '未知')}</span>
        <span class="detail-tag ${permissions.canRecall ? 'tone-success' : 'tone-warning'}">撤回 ${permissions.canRecall ? '可用' : '未知/不可用'}</span>
        <span class="detail-tag ${permissions.canMute ? 'tone-success' : 'tone-warning'}">禁言 ${permissions.canMute ? '可用' : '未知/不可用'}</span>
        <span class="detail-tag ${permissions.canKick ? 'tone-success' : 'tone-warning'}">踢人 ${permissions.canKick ? '可用' : '未知/不可用'}</span>
        <span class="detail-tag ${permissions.canSetTitle ? 'tone-success' : 'tone-warning'}">头衔 ${permissions.canSetTitle ? '可用' : '需要群主'}</span>
      </div>
      <div class="setting-help">${warnings.length > 0 ? escapeHtml(warnings.join('；')) : '权限满足常规群管操作。实际结果仍以当前适配器返回为准。'}</div>
    </div>
  `;
}

function formatEnabledText(value) {
  return value ? '开启' : '关闭';
}

function formatSourceText(hasCustom) {
  return hasCustom ? '本群覆盖' : '继承默认';
}

function renderEffectiveConfigSnapshot(group = {}) {
  const config = group.config || {};
  const auth = config.auth?.config || {};
  const autoApprove = auth.autoApprove || {};
  const welcome = config.welcome || {};
  const dailySummary = config.dailySummary || {};
  const imageMonitor = config.imageMonitor || {};
  const moderation = config.moderation || {};
  const content = moderation.content || {};
  const items = [
    {
      label: 'AI 回复',
      value: formatEnabledText(config.ai?.effectiveEnabled === true),
      tone: config.ai?.effectiveEnabled === true ? 'tone-success' : 'tone-error',
      meta: [
        config.ai?.whitelisted ? '白名单允许' : '',
        config.ai?.blocked ? '黑名单阻断' : '',
      ].filter(Boolean).join(' / ') || '按全局 AI 群策略判断',
    },
    {
      label: '图片监控',
      value: formatEnabledText(imageMonitor.effectiveEnabled === true),
      tone: imageMonitor.effectiveEnabled === true ? 'tone-success' : '',
      meta: [
        imageMonitor.allowed ? '监控白名单' : '',
        imageMonitor.blocked ? '监控黑名单' : '',
      ].filter(Boolean).join(' / ') || '按全局图片监控范围判断',
    },
    {
      label: '每日总结',
      value: formatEnabledText(dailySummary.effectiveEnabled === true),
      tone: dailySummary.effectiveEnabled === true ? 'tone-success' : '',
      meta: [
        `模式 ${dailySummary.targetMode || '未知'}`,
        dailySummary.allowed ? '启用群' : '',
        dailySummary.blocked ? '禁用群' : '',
      ].filter(Boolean).join(' / '),
    },
    {
      label: '入群验证',
      value: formatEnabledText(auth.enable === true),
      tone: auth.enable === true ? 'tone-warning' : '',
      meta: [
        formatSourceText(config.auth?.hasCustom),
        `超时 ${auth.timeout || 180}s`,
        `答错 ${auth.frequency || 5} 次`,
      ].join(' / '),
    },
    {
      label: '自动通过',
      value: formatEnabledText(autoApprove.enable === true),
      tone: autoApprove.enable === true ? 'tone-success' : '',
      meta: [
        `QQ等级 >= ${autoApprove.minQqLevel || 0}`,
        `年龄 >= ${autoApprove.minAge || 0}`,
        `必要词 ${(autoApprove.commentKeywords || []).length}`,
        `拦截词 ${(autoApprove.blockedKeywords || []).length}`,
      ].join(' / '),
    },
    {
      label: '入群欢迎',
      value: formatEnabledText(welcome.enabled === true),
      tone: welcome.enabled === true ? 'tone-success' : '',
      meta: [
        formatSourceText(welcome.hasCustom),
        welcome.aiEnabled ? 'AI欢迎' : '普通欢迎',
        welcome.hasImage ? '有图片' : '',
        welcome.text ? '有文案' : '',
      ].filter(Boolean).join(' / ') || '未配置欢迎内容',
    },
    {
      label: '消息风控',
      value: formatEnabledText(content.enabled === true),
      tone: content.enabled === true ? 'tone-warning' : '',
      meta: [
        formatSourceText(moderation.hasCustomContent),
        `动作 ${GROUP_MANAGEMENT_ACTION_LABELS[content.action] || content.action || 'log'}`,
        content.urlSafety?.enabled ? `URL安检 ${content.urlSafety.riskThreshold || 'high'}` : 'URL安检关闭',
        content.detectSpamMessages ? `${content.burstWindowSeconds || 60}s>${content.burstLimit || 8}条` : '刷屏关闭',
        content.addWarning ? '增加警告' : '不加警告',
      ].join(' / '),
    },
    {
      label: '头衔权限',
      value: group.permissions?.canSetTitle ? '可发放' : '不可发放',
      tone: group.permissions?.canSetTitle ? 'tone-success' : 'tone-warning',
      meta: group.permissions?.canSetTitle ? '机器人是群主' : '需要机器人是群主',
    },
  ];
  return `
    <div class="group-management-effective-grid">
      ${items.map(item => `
        <div class="group-management-effective-item">
          <span>${escapeHtml(item.label)}</span>
          <strong class="${escapeHtml(item.tone || '')}">${escapeHtml(item.value)}</strong>
          <small>${escapeHtml(item.meta || '暂无详情')}</small>
        </div>
      `).join('')}
    </div>
  `;
}

