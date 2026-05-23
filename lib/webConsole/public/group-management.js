async function refreshGroupManagement(options = {}) {
  const requestId = ++groupManagementState.refreshRequestId;
  const controller = replaceGroupManagementRequestController('refreshController');
  const requestOptions = getCancelableGroupManagementRequestOptions(controller);
  const keepMessage = options.keepMessage === true;
  if (!keepMessage) hideMessages();
  setStatus('正在刷新群数据...');
  const previousSelectedId = groupManagementState.selectedGroupId;
  const url = previousSelectedId
    ? `/api/group-management?groupId=${encodeURIComponent(previousSelectedId)}`
    : '/api/group-management';
  let payload;
  try {
    payload = await fetchJson(url, requestOptions);
  } catch (error) {
    if (requestId !== groupManagementState.refreshRequestId || isGroupManagementRequestCanceled(error)) return null;
    throw error;
  } finally {
    if (requestId === groupManagementState.refreshRequestId) {
      clearGroupManagementRequestController('refreshController', controller);
    }
  }
  if (requestId !== groupManagementState.refreshRequestId) return null;
  groupManagementState.payload = payload;
  if (!groupManagementState.selectedGroupId) {
    groupManagementState.selectedGroupId = payload.selectedGroupId || payload.groups?.[0]?.groupId || '';
  }
  if (
    groupManagementState.selectedGroupId
    && !(payload.groups || []).some(item => item.groupId === groupManagementState.selectedGroupId)
  ) {
    groupManagementState.selectedGroupId = payload.groups?.[0]?.groupId || '';
  }
  if (groupManagementState.selectedGroupId !== previousSelectedId) {
    resetWelcomeImageDraft();
  }
  renderSummary();
  renderHealthPanel();
  renderSafetyPanel();
  renderDefaultsPanel();
  renderBulkPanel();
  renderGroupList();
  renderDetail();
  if (requestId !== groupManagementState.refreshRequestId) return null;
  await loadJoinRequests(groupManagementState.joinRequestPage);
  if (requestId !== groupManagementState.refreshRequestId) return null;
  await loadTitleApplications(groupManagementState.titleApplicationPage);
  if (requestId !== groupManagementState.refreshRequestId) return null;
  await refreshGroupManagementLogs(groupManagementState.logPage);
  if (requestId !== groupManagementState.refreshRequestId) return null;
  try {
    await refreshGroupManagementEventStreamNow({ reset: true });
  } catch (error) {
    if (requestId !== groupManagementState.refreshRequestId) return null;
    throw error;
  }
  return payload;
}

async function saveSafetySettings() {
  hideMessages();
  if (groupManagementState.payload?.readOnly === true) {
    showRisk('控制台处于只读模式，不能保存。');
    return;
  }
  const payload = buildSafetySavePayload();
  if (
    payload.safety.allowAutoKick
    && !await confirmGroupManagementModal('确认允许群消息风控自动踢人？该开关会全局生效。', { title: '放行自动踢人' })
  ) {
    return;
  }
  try {
    const result = await postJson('/api/group-management/safety/save', payload);
    groupManagementState.payload = result;
    groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId;
    showSuccess(result.message || '群管安全开关已保存');
    renderSummary();
    renderHealthPanel();
    renderSafetyPanel();
    renderDefaultsPanel();
    renderBulkPanel();
    renderGroupList();
    renderDetail();
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
  } catch (error) {
    showRisk(`保存安全开关失败：${error.message}`);
  }
}

async function saveDefaultSettings() {
  hideMessages();
  if (groupManagementState.payload?.readOnly === true) {
    showRisk('控制台处于只读模式，不能保存。');
    return;
  }
  const payload = buildDefaultsSavePayload();
  if (!await confirmGroupSaveSafety(payload)) {
    return;
  }
  try {
    const result = await postJson('/api/group-management/defaults/save', payload);
    groupManagementState.payload = result;
    groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId;
    showSuccess(result.message || '群管理默认设置已保存');
    renderSummary();
    renderHealthPanel();
    renderSafetyPanel();
    renderDefaultsPanel();
    renderBulkPanel();
    renderGroupList();
    renderDetail();
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
  } catch (error) {
    showRisk(`保存默认设置失败：${error.message}`);
  }
}

async function saveCurrentGroup(extraPayload = null) {
  hideMessages();
  if (groupManagementState.payload?.readOnly === true) {
    showRisk('控制台处于只读模式，不能保存。');
    return;
  }
  try {
    const payload = extraPayload || (await buildSavePayload());
    if (!extraPayload && !await confirmGroupSaveDiff(payload)) {
      return;
    }
    if (!await confirmGroupSaveSafety(payload)) {
      return;
    }
    const result = await postJson('/api/group-management/save', payload);
    groupManagementState.payload = result;
    groupManagementState.selectedGroupId = result.selectedGroupId || payload.groupId;
    if (payload.welcome && typeof payload.welcome === 'object' && !Array.isArray(payload.welcome)) {
      resetWelcomeImageDraft();
    }
    showSuccess(result.message || '群配置已保存');
    renderSummary();
    renderHealthPanel();
    renderSafetyPanel();
    renderDefaultsPanel();
    renderBulkPanel();
    renderGroupList();
    renderDetail();
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
  } catch (error) {
    showRisk(`保存失败：${error.message}`);
  }
}

async function applyBulkEnableGroups() {
  hideMessages();
  if (groupManagementState.payload?.readOnly === true) {
    showRisk('控制台处于只读模式，不能保存。');
    return;
  }
  const groupIds = getBulkSelectedGroupIds();
  if (groupIds.length <= 0) {
    showRisk('请先勾选要开启的群。');
    return;
  }
  const feature = getBulkFeature();
  const featureLabel = GROUP_MANAGEMENT_BULK_FEATURES[feature]?.label || '所选功能';
  if (!await confirmGroupManagementModal(`确认给 ${groupIds.length} 个群开启${featureLabel}？`, { title: '批量开启群功能' })) {
    return;
  }
  try {
    const result = await postJson('/api/group-management/bulk-enable', {
      feature,
      groupIds,
      selectedGroupId: groupManagementState.selectedGroupId,
    });
    groupManagementState.payload = result;
    groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId || groupIds[0] || '';
    showSuccess(result.message || '已批量开启所选群');
    renderSummary();
    renderHealthPanel();
    renderSafetyPanel();
    renderDefaultsPanel();
    renderBulkPanel();
    renderGroupList();
    renderDetail();
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
  } catch (error) {
    showRisk(`批量开启失败：${error.message}`);
  }
}

function syncConflictCheckboxes(target) {
  const pairs = [
    ['gm-ai-blocked', 'gm-ai-whitelisted'],
    ['gm-image-allowed', 'gm-image-blocked'],
    ['gm-summary-allowed', 'gm-summary-blocked'],
  ];
  for (const [left, right] of pairs) {
    if (target.id === left && target.checked) {
      const other = $(right);
      if (other) other.checked = false;
    }
    if (target.id === right && target.checked) {
      const other = $(left);
      if (other) other.checked = false;
    }
  }
}

function setChecked(id, value) {
  const el = $(id);
  if (el instanceof HTMLInputElement) el.checked = Boolean(value);
}

function setInputValue(id, value) {
  const el = $(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = String(value ?? '');
  }
}

function applyRuleTemplateToForm(templateKey = '') {
  const template = GROUP_MANAGEMENT_RULE_TEMPLATES[templateKey] || GROUP_MANAGEMENT_RULE_TEMPLATES.relaxed;
  const auto = template.autoApprove || {};
  const risk = auto.risk || {};
  const content = template.content || {};

  setChecked('gm-auto-approve-enable', auto.enable === true);
  setInputValue('gm-auto-min-qq-level', auto.minQqLevel || 0);
  setInputValue('gm-auto-min-age', auto.minAge || 0);
  setInputValue('gm-auto-comment-keywords', (auto.commentKeywords || []).join('\n'));
  setInputValue('gm-auto-blocked-keywords', (auto.blockedKeywords || []).join('\n'));
  setInputValue('gm-auto-custom-rules', (auto.customRules || []).join('\n'));
  setChecked('gm-auto-risk-enabled', risk.enabled !== false);
  setChecked('gm-auto-risk-score-enabled', risk.scoreEnabled !== false);
  setChecked('gm-auto-risk-block-blacklist', risk.blockBlacklistAutoApprove !== false);
  setChecked('gm-auto-risk-auto-whitelist', risk.autoApproveWhitelisted !== false);
  setChecked('gm-auto-risk-hold-high', risk.holdHighRisk === true);
  setInputValue('gm-auto-risk-high-score', risk.highRiskScore || 70);
  setInputValue('gm-auto-risk-warning-threshold', risk.warningBlockThreshold ?? 3);

  setChecked('gm-content-enabled', content.enabled === true);
  setChecked('gm-content-exempt-admins', content.exemptAdmins !== false);
  setChecked('gm-content-detect-links', content.detectLinks !== false);
  setChecked('gm-content-url-safety-enabled', content.urlSafety?.enabled === true);
  setInputValue('gm-content-url-safety-threshold', content.urlSafety?.riskThreshold || 'high');
  setInputValue('gm-content-url-safety-max-urls', content.urlSafety?.maxUrlsPerMessage || 2);
  setInputValue('gm-content-url-safety-md-length', content.urlSafety?.markdownMaxLength || 6000);
  setInputValue('gm-content-url-safety-timeout', content.urlSafety?.timeoutMs || 20000);
  setInputValue('gm-content-url-safety-whitelist', (content.urlSafety?.whitelist || []).join('\n'));
  setChecked('gm-content-detect-keywords', content.detectBlockedKeywords !== false);
  setInputValue('gm-content-blocked-keywords', (content.blockedKeywords || []).join('\n'));
  setInputValue('gm-content-repeat-limit', content.repeatLimit || 4);
  setInputValue('gm-content-repeat-window', content.repeatWindowSeconds || 45);
  setChecked('gm-content-detect-spam', content.detectSpamMessages === true);
  setInputValue('gm-content-burst-limit', content.burstLimit || 8);
  setInputValue('gm-content-burst-window', content.burstWindowSeconds || 60);
  setInputValue('gm-content-action', content.action || 'log');
  setInputValue('gm-content-mute-seconds', content.muteSeconds || 600);
  setChecked('gm-content-add-warning', content.addWarning === true);
  setChecked('gm-content-observe-new', content.observeNewMembers !== false);
  setChecked('gm-content-observe-block-links', content.observeBlockLinks !== false);
  setInputValue('gm-content-observe-minutes', content.observeMinutes || 60);
  showSuccess(`已填入“${template.label}”模板，确认后请保存当前群。`);
}
