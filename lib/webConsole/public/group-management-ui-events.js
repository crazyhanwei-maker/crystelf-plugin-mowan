document.addEventListener('click', async (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.id === 'group-management-modal-mask') {
    closeGroupManagementModal({ confirmed: false, value: '' });
    return;
  }
  const target = event.target.closest('button, a');
  if (!target) return;

  if (target.dataset.action === 'group-management-modal-cancel') {
    closeGroupManagementModal({ confirmed: false, value: '' });
    return;
  }

  if (target.dataset.action === 'group-management-modal-confirm') {
    closeGroupManagementModal({
      confirmed: true,
      value: $('group-management-modal-input')?.value || '',
    });
    return;
  }

  if (target.dataset.action === 'toggle-collapse') {
    event.preventDefault();
    toggleGroupManagementCollapse(target);
    return;
  }

  if (target.dataset.workspace) {
    event.preventDefault();
    setGroupManagementWorkspace(target.dataset.workspace, { scroll: true });
    return;
  }

  if (target.dataset.groupId) {
    const nextGroupId = target.dataset.groupId;
    if (groupManagementState.selectedGroupId !== nextGroupId) {
      resetWelcomeImageDraft();
    }
    groupManagementState.selectedGroupId = nextGroupId;
    groupManagementState.memberPayload = null;
    groupManagementState.memberPage = 1;
    groupManagementState.memberQuery = '';
    groupManagementState.joinRequestPayload = null;
    groupManagementState.joinRequestPage = 1;
    groupManagementState.joinRequestQuery = '';
    groupManagementState.titleApplicationPayload = null;
    groupManagementState.titleApplicationPage = 1;
    groupManagementState.titleApplicationQuery = '';
    groupManagementState.titleApplicationStatus = 'pending';
    groupManagementState.logPayload = null;
    groupManagementState.logPage = 1;
    setGroupManagementWorkspace('current');
    resetGroupManagementEventStream();
    renderGroupList();
    renderDetail();
    await loadJoinRequests(1);
    await loadTitleApplications(1);
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
    return;
  }

  if (target.dataset.action === 'load-members') {
    await loadMembers(1);
    return;
  }

  if (target.dataset.action === 'load-join-requests') {
    await loadJoinRequests(1);
    return;
  }

  if (target.dataset.action === 'load-title-applications') {
    await loadTitleApplications(1);
    return;
  }

  if (target.dataset.action === 'member-page') {
    await loadMembers(Number(target.dataset.page || 1));
    return;
  }

  if (target.dataset.action === 'join-request-page') {
    await loadJoinRequests(Number(target.dataset.page || 1));
    return;
  }

  if (target.dataset.action === 'title-application-page') {
    await loadTitleApplications(Number(target.dataset.page || 1));
    return;
  }

  if (target.dataset.action === 'group-log-page') {
    await refreshGroupManagementLogs(Number(target.dataset.page || 1));
    return;
  }

  if (target.dataset.action === 'run-health-check') {
    await runGroupManagementHealthCheck();
    return;
  }

  if (target.dataset.action === 'export-health-markdown') {
    exportGroupManagementHealth('markdown');
    return;
  }

  if (target.dataset.action === 'export-health-json') {
    exportGroupManagementHealth('json');
    return;
  }

  if (target.dataset.action === 'toggle-health-ignored') {
    groupManagementState.healthShowIgnored = groupManagementState.healthShowIgnored !== true;
    renderHealthPanel();
    return;
  }

  if (target.dataset.action === 'handle-first-health-issue') {
    handleFirstGroupManagementHealthIssue();
    return;
  }

  if (target.dataset.action === 'ignore-health-item' || target.dataset.action === 'unignore-health-item') {
    toggleGroupManagementHealthIgnored(
      String(target.dataset.healthKey || ''),
      target.dataset.action === 'ignore-health-item',
    );
    return;
  }

  if (target.dataset.action === 'handle-health-item') {
    handleGroupManagementHealthItem(
      String(target.dataset.healthKey || ''),
      String(target.dataset.healthAction || ''),
    );
    return;
  }

  if (target.dataset.action === 'load-health-groups') {
    loadHealthGroupsToBulkSelection(String(target.dataset.healthKey || ''));
    return;
  }

  if (target.dataset.action === 'toggle-event-stream') {
    groupManagementState.eventAutoRefresh = groupManagementState.eventAutoRefresh !== true;
    renderGroupManagementEventStream();
    if (groupManagementState.eventAutoRefresh) {
      await refreshGroupManagementEventStreamNow({ incremental: true });
    } else {
      stopGroupManagementEventTimer();
    }
    return;
  }

  if (target.dataset.action === 'refresh-event-stream') {
    await refreshGroupManagementEventStreamNow({ reset: true });
    return;
  }

  if (target.dataset.action === 'mark-event-read') {
    groupManagementState.eventUnreadKeys.clear();
    renderGroupManagementEventStream();
    return;
  }

  if (target.dataset.action === 'convert-log-scenario') {
    await convertGroupManagementLogToScenario(String(target.dataset.logId || ''));
    return;
  }

  if (target.dataset.action === 'bulk-select-filtered') {
    const current = new Set(getBulkSelectedGroupIds());
    for (const group of getFilteredGroups()) {
      current.add(group.groupId);
    }
    setBulkSelectedGroupIds(Array.from(current));
    renderBulkPanel();
    return;
  }

  if (target.dataset.action === 'bulk-select-enabled') {
    const feature = getBulkFeature();
    setBulkSelectedGroupIds(getGroups()
      .filter(group => isGroupEnabledForBulkFeature(group, feature))
      .map(group => group.groupId));
    renderBulkPanel();
    return;
  }

  if (target.dataset.action === 'bulk-clear-selection') {
    setBulkSelectedGroupIds([]);
    renderBulkPanel();
    return;
  }

  if (target.dataset.action === 'bulk-apply') {
    await applyBulkEnableGroups();
    return;
  }

  if (target.dataset.action === 'save-safety') {
    await saveSafetySettings();
    return;
  }

  if (target.dataset.action === 'save-defaults') {
    await saveDefaultSettings();
    return;
  }

  if (target.dataset.action === 'apply-rule-template') {
    applyRuleTemplateToForm(String($('gm-rule-template')?.value || 'relaxed'));
    return;
  }

  if (target.dataset.action === 'rollback-config') {
    const backupId = String(target.dataset.backupId || '').trim();
    if (!backupId) return;
    if (!await confirmGroupManagementModal('确认回滚到这份群配置备份？当前配置会先自动备份一份。', { title: '回滚群配置' })) return;
    try {
      const result = await postJson('/api/group-management/backups/rollback', { id: backupId });
      groupManagementState.payload = result;
      groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId;
      resetWelcomeImageDraft();
      renderSummary();
      renderHealthPanel();
      renderSafetyPanel();
      renderDefaultsPanel();
      renderBulkPanel();
      renderGroupList();
      renderDetail();
      showSuccess(result.message || '群配置已回滚');
      await loadJoinRequests(groupManagementState.joinRequestPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`回滚失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'approve-join-request' || target.dataset.action === 'approve-join-request-whitelist') {
    const requestId = String(target.dataset.requestId || '').trim();
    if (!requestId) return;
    const addWhitelist = target.dataset.action === 'approve-join-request-whitelist';
    if (!await confirmGroupManagementModal(addWhitelist ? '确认同意这条加群申请，并加入本群白名单？' : '确认同意这条加群申请？', { title: '处理加群申请' })) return;
    try {
      const result = await postJson('/api/group-management/join-requests/approve', { id: requestId, whitelist: addWhitelist });
      if (result.moderation) {
        updateSelectedGroupModeration(result.moderation);
        renderGroupList();
        renderDetail();
      }
      showSuccess(result.message || '已同意加群申请');
      await loadJoinRequests(groupManagementState.joinRequestPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`同意失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'reject-join-request' || target.dataset.action === 'reject-join-request-blacklist') {
    const requestId = String(target.dataset.requestId || '').trim();
    if (!requestId) return;
    const addBlacklist = target.dataset.action === 'reject-join-request-blacklist';
    if (!await confirmGroupManagementModal(addBlacklist ? '确认拒绝这条加群申请，并加入本群黑名单？' : '确认拒绝这条加群申请？', { title: '处理加群申请' })) return;
    try {
      const result = await postJson('/api/group-management/join-requests/reject', { id: requestId, blacklist: addBlacklist });
      if (result.moderation) {
        updateSelectedGroupModeration(result.moderation);
        renderGroupList();
        renderDetail();
      }
      showSuccess(result.message || '已拒绝加群申请');
      await loadJoinRequests(groupManagementState.joinRequestPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`拒绝失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'approve-title-application') {
    const applicationId = String(target.dataset.applicationId || '').trim();
    if (!applicationId) return;
    if (!await confirmGroupManagementModal(`确认通过头衔申请 ${applicationId} 并发放群头衔？`, { title: '通过头衔申请' })) return;
    try {
      const result = await postJson('/api/group-management/title-applications/approve', { id: applicationId });
      showSuccess(result.message || '已通过头衔申请');
      await loadTitleApplications(groupManagementState.titleApplicationPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`通过头衔失败：${error.message}`);
      await loadTitleApplications(groupManagementState.titleApplicationPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    }
    return;
  }

  if (target.dataset.action === 'reject-title-application') {
    const applicationId = String(target.dataset.applicationId || '').trim();
    if (!applicationId) return;
    const reason = await promptGroupManagementModal({
      title: '拒绝头衔申请',
      message: `请输入拒绝头衔申请 ${applicationId} 的原因`,
      defaultValue: '不符合头衔规则',
    });
    if (reason === null) return;
    try {
      const result = await postJson('/api/group-management/title-applications/reject', {
        id: applicationId,
        reason: String(reason || '').trim() || '不符合头衔规则',
      });
      showSuccess(result.message || '已拒绝头衔申请');
      await loadTitleApplications(groupManagementState.titleApplicationPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`拒绝头衔失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'add-member-warning') {
    const group = getSelectedGroup();
    const userId = normalizeGroupId($('gm-warning-user-id')?.value);
    const reason = String($('gm-warning-reason')?.value || '').trim();
    if (!group || !userId) {
      showRisk('请输入正确的 QQ 号。');
      return;
    }
    try {
      const result = await postJson('/api/group-management/warnings/add', {
        groupId: group.groupId,
        userId,
        reason,
      });
      updateSelectedGroupModeration(result.moderation);
      showSuccess(result.message || '已增加警告积分');
      renderGroupList();
      renderDetail();
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`增加警告失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'clear-member-warning') {
    const group = getSelectedGroup();
    const userId = normalizeGroupId($('gm-warning-user-id')?.value);
    if (!group || !userId) {
      showRisk('请输入正确的 QQ 号。');
      return;
    }
    if (!await confirmGroupManagementModal(`确认清空 QQ ${userId} 的警告积分？`, { title: '清空警告积分' })) return;
    try {
      const result = await postJson('/api/group-management/warnings/clear', {
        groupId: group.groupId,
        userId,
      });
      updateSelectedGroupModeration(result.moderation);
      showSuccess(result.message || '已清空警告积分');
      renderGroupList();
      renderDetail();
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`清空警告失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'clear-welcome') {
    const group = getSelectedGroup();
    if (
      group
      && await confirmGroupManagementModal(`确认恢复群 ${group.groupId} 的默认欢迎配置？本群单独设置的欢迎文案和图片会被删除。`, { title: '恢复默认欢迎' })
    ) {
      await saveCurrentGroup({ groupId: group.groupId, welcome: { clear: true } });
    }
    return;
  }

  if (target.dataset.action === 'delete-welcome-image') {
    if (groupManagementState.payload?.readOnly === true) return;
    const group = getSelectedGroup();
    if (!group) return;
    const hasSavedImage = group.config?.welcome?.hasImage === true;
    groupManagementState.welcomeImageFile = null;
    if (groupManagementState.welcomeImagePreviewUrl) {
      URL.revokeObjectURL(groupManagementState.welcomeImagePreviewUrl);
    }
    groupManagementState.welcomeImagePreviewUrl = '';
    groupManagementState.welcomeDeleteImage = hasSavedImage;
    renderDetail();
    return;
  }

  if (target.dataset.action === 'clear-auth') {
    const group = getSelectedGroup();
    if (
      group
      && await confirmGroupManagementModal(`确认删除群 ${group.groupId} 的入群验证覆盖配置？`, { title: '删除入群验证覆盖配置' })
    ) {
      await saveCurrentGroup({ groupId: group.groupId, auth: { clear: true } });
    }
  }
});

document.addEventListener('change', async (event) => {
  if (event.target instanceof HTMLSelectElement && event.target.id === 'gm-bulk-feature') {
    groupManagementState.bulkFeature = getBulkFeature();
    renderBulkPanel();
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'group-management-title-application-status') {
    groupManagementState.titleApplicationStatus = String(event.target.value || 'pending');
    await loadTitleApplications(1);
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'group-management-event-type') {
    groupManagementState.eventType = String(event.target.value || 'all');
    resetGroupManagementEventStream();
    await refreshGroupManagementEventStreamNow({ reset: true });
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'gm-rule-template') {
    const template = GROUP_MANAGEMENT_RULE_TEMPLATES[String(event.target.value || 'relaxed')] || GROUP_MANAGEMENT_RULE_TEMPLATES.relaxed;
    const help = $('gm-rule-template-help');
    if (help) help.textContent = template.help || '';
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'gm-content-action') {
    refreshContentSafetyWarning();
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'gm-default-content-action') {
    refreshContentSafetyWarning('gm-default-content-safety-warning', 'gm-default-content-action', 'gm-default-content-mute-seconds');
    return;
  }
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.id === 'gm-content-mute-seconds') {
    refreshContentSafetyWarning();
  }
  if (event.target.id === 'gm-default-content-mute-seconds') {
    refreshContentSafetyWarning('gm-default-content-safety-warning', 'gm-default-content-action', 'gm-default-content-mute-seconds');
  }
  if (event.target.id === 'group-management-event-current-group') {
    groupManagementState.eventCurrentGroupOnly = event.target.checked;
    resetGroupManagementEventStream();
    await refreshGroupManagementEventStreamNow({ reset: true });
    return;
  }
  if (event.target.id === 'group-management-event-failed-only') {
    groupManagementState.eventFailedOnly = event.target.checked;
    renderGroupManagementEventStream();
    return;
  }
  if (event.target.dataset.bulkGroupId) {
    const groupId = normalizeGroupId(event.target.dataset.bulkGroupId);
    if (!groupId) return;
    const selected = new Set(getBulkSelectedGroupIds());
    if (event.target.checked) {
      selected.add(groupId);
    } else {
      selected.delete(groupId);
    }
    setBulkSelectedGroupIds(Array.from(selected));
    event.target.closest('.group-management-bulk-item')?.classList.toggle('active', event.target.checked);
    renderBulkMeta();
    return;
  }
  if (event.target.id === 'gm-welcome-image-input') {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    try {
      validateWelcomeImageFile(file);
      if (groupManagementState.welcomeImagePreviewUrl) {
        URL.revokeObjectURL(groupManagementState.welcomeImagePreviewUrl);
      }
      groupManagementState.welcomeImageFile = file;
      groupManagementState.welcomeImagePreviewUrl = URL.createObjectURL(file);
      groupManagementState.welcomeDeleteImage = false;
      hideMessages();
      renderDetail();
    } catch (error) {
      event.target.value = '';
      showRisk(error.message);
    }
    return;
  }
  if (event.target.type === 'checkbox') {
    syncConflictCheckboxes(event.target);
  }
});

document.addEventListener('keydown', async (event) => {
  if (event.target instanceof HTMLElement && event.target.matches('[data-workspace]')) {
    const tabs = Array.from(document.querySelectorAll('[data-workspace]'));
    const currentIndex = tabs.indexOf(event.target);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex !== currentIndex) {
      event.preventDefault();
      tabs[nextIndex]?.focus();
      tabs[nextIndex]?.click();
      return;
    }
  }
  const modalMask = $('group-management-modal-mask');
  const modalVisible = modalMask && !modalMask.classList.contains('hidden');
  if (modalVisible && event.key === 'Escape') {
    event.preventDefault();
    closeGroupManagementModal({ confirmed: false, value: '' });
    return;
  }
  if (modalVisible && event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.id === 'group-management-modal-input') {
    event.preventDefault();
    closeGroupManagementModal({ confirmed: true, value: event.target.value || '' });
    return;
  }
  if (event.target instanceof HTMLInputElement && event.target.id === 'group-management-member-search' && event.key === 'Enter') {
    await loadMembers(1);
  }
  if (event.target instanceof HTMLInputElement && event.target.id === 'group-management-join-request-search' && event.key === 'Enter') {
    await loadJoinRequests(1);
  }
  if (event.target instanceof HTMLInputElement && event.target.id === 'group-management-title-application-search' && event.key === 'Enter') {
    await loadTitleApplications(1);
  }
});

$('group-management-search')?.addEventListener('input', () => {
  renderBulkPanel();
  renderGroupList();
});

$('group-management-refresh-btn')?.addEventListener('click', async () => {
  try {
    await refreshGroupManagement();
  } catch (error) {
    showRisk(`刷新失败：${error.message}`);
  }
});

$('group-management-log-refresh-btn')?.addEventListener('click', async () => {
  scheduleGroupManagementLogSearch.cancel?.();
  await refreshGroupManagementLogs(1);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && groupManagementState.eventAutoRefresh === true) {
    refreshGroupManagementEventStreamNow({ incremental: true }).catch(() => {});
  }
});

window.addEventListener('beforeunload', () => {
  stopGroupManagementEventTimer();
});

function createGroupManagementDebouncedTask(fn, delay = 250) {
  if (typeof window.CrystelfUi?.debounce === 'function') {
    return window.CrystelfUi.debounce(fn, delay);
  }
  let timer = null;
  const task = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
  task.cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  return task;
}

const scheduleGroupManagementLogSearch = createGroupManagementDebouncedTask(() => {
  refreshGroupManagementLogs(1).catch(error => showRisk(`刷新日志失败：${error.message}`));
}, 250);

$('group-management-log-search')?.addEventListener('input', () => {
  groupManagementState.logQuery = String($('group-management-log-search')?.value || '').trim();
  scheduleGroupManagementLogSearch();
});

$('group-management-save-btn')?.addEventListener('click', async () => {
  await saveCurrentGroup();
});

$('group-management-open-id-btn')?.addEventListener('click', async () => {
  const groupId = normalizeGroupId($('group-management-direct-id')?.value);
  if (!groupId) {
    showRisk('请输入 5-20 位数字群号。');
    return;
  }
  if (groupManagementState.selectedGroupId !== groupId) {
    resetWelcomeImageDraft();
  }
  groupManagementState.selectedGroupId = groupId;
  groupManagementState.memberPayload = null;
  groupManagementState.joinRequestPayload = null;
  groupManagementState.joinRequestPage = 1;
  groupManagementState.joinRequestQuery = '';
  groupManagementState.logPayload = null;
  groupManagementState.logPage = 1;
  try {
    await refreshGroupManagement();
  } catch (error) {
    showRisk(`打开群号失败：${error.message}`);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkStartupElements()) return;
  loadGroupManagementHealthIgnores();
  enhanceGroupManagementStaticCollapses();
  const params = new URLSearchParams(window.location.search);
  setGroupManagementWorkspace(params.has('groupId') ? 'current' : readGroupManagementWorkspace());
  const groupId = normalizeGroupId(params.get('groupId'));
  if (groupId) {
    groupManagementState.selectedGroupId = groupId;
  }
  try {
    await refreshGroupManagement({ keepMessage: true });
  } catch (error) {
    setStatus('群管理数据加载失败');
    showRisk(error.message);
  }
});
