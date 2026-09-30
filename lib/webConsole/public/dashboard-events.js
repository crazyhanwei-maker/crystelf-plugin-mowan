document.addEventListener('click', async event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const collapsibleHead = target.closest('.collapsible-panel > .section-head, .collapsible-panel > .dashboard-control-head, .collapsible-panel > h2.collapsible-head');
  if (collapsibleHead && !target.closest('a, button')) {
    event.preventDefault();
    collapsibleHead.closest('.collapsible-panel')?.classList.toggle('collapsed');
    return;
  }

  const requestTimingTrigger = target.closest('[data-action="show-request-timing-detail"]');
  if (requestTimingTrigger) {
    event.preventDefault();
    await openRequestTimingDetailModal();
    return;
  }

  const frontendErrorTrigger = target.closest('[data-action="show-frontend-error-detail"]');
  if (frontendErrorTrigger) {
    event.preventDefault();
    await openFrontendErrorDetailModal();
    return;
  }

  const pageLoadTrigger = target.closest('[data-action="show-page-load-diagnostic"]');
  if (pageLoadTrigger) {
    event.preventDefault();
    await openPageLoadDiagnosticModal();
    return;
  }

  if (target.dataset.action === 'reload-dashboard-page') {
    event.preventDefault();
    window.location.reload();
    return;
  }

  if (target.dataset.action === 'clear-page-cache-and-reload') {
    event.preventDefault();
    const confirmed = await openModal(
      '清缓存刷新',
      '将清理当前浏览器保存的控制台本机缓存，然后刷新页面。这不会修改服务器配置，也不会删除机器人数据。',
      { confirmText: '清理并刷新', cancelText: '取消', showCancel: true },
    );
    if (!confirmed) return;
    window.CrystelfPageLoadDiagnostics?.clearCacheAndReload?.();
    return;
  }

  if (target.dataset.action === 'copy-page-load-diagnostic') {
    event.preventDefault();
    try {
      await copyPageLoadDiagnostic();
      pageLoadActionMessage = '已复制页面加载诊断信息。';
      pageLoadDiagnosticPreviewText = '';
    } catch {
      pageLoadActionMessage = '浏览器没有允许自动复制，已在下方展开诊断文本，可手动复制或导出 JSON。';
      pageLoadDiagnosticPreviewText = formatPageLoadDiagnosticText();
    }
    updatePageLoadDiagnosticModal();
    return;
  }

  if (target.dataset.action === 'export-page-load-diagnostic') {
    event.preventDefault();
    try {
      downloadPageLoadDiagnostic();
      pageLoadActionMessage = '已导出页面加载诊断 JSON。';
    } catch (error) {
      pageLoadActionMessage = `导出失败：${error.message || '浏览器下载不可用'}`;
    }
    updatePageLoadDiagnosticModal();
    return;
  }

  if (target.dataset.action === 'export-audit-logs') {
    event.preventDefault();
    try {
      await downloadExport('audit-logs', {});
    } catch (error) {
      await openModal('导出失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'enable-web-console-readonly') {
    event.preventDefault();
    await enableWebConsoleReadOnlyMode();
    return;
  }

  if (target.dataset.action === 'reset-request-timing') {
    event.preventDefault();
    requestTimingActionMessage = '已清空本页请求耗时采样。';
    requestTimingDiagnosticPreviewText = '';
    requestTimingDetailFilter = 'all';
    window.CrystelfRequest?.resetMetrics?.();
    updateRequestTimingDetailModal({ preserveScroll: false });
    return;
  }

  if (target.dataset.action === 'set-request-timing-filter') {
    event.preventDefault();
    const nextFilter = target.dataset.filter || 'all';
    requestTimingDetailFilter = REQUEST_TIMING_FILTERS.some(filter => filter.value === nextFilter) ? nextFilter : 'all';
    updateRequestTimingDetailModal({ preserveScroll: false });
    return;
  }

  if (target.dataset.action === 'copy-request-timing-diagnostic') {
    event.preventDefault();
    try {
      await copyRequestTimingDiagnostic();
      requestTimingActionMessage = '已复制请求耗时诊断信息。';
      requestTimingDiagnosticPreviewText = '';
    } catch {
      requestTimingActionMessage = '浏览器没有允许自动复制，已在下方展开诊断文本，可手动复制或导出 JSON。';
      requestTimingDiagnosticPreviewText = formatRequestTimingDiagnosticText();
    }
    updateRequestTimingDetailModal({ preserveScroll: true });
    return;
  }

  if (target.dataset.action === 'export-request-timing-diagnostic') {
    event.preventDefault();
    try {
      downloadRequestTimingDiagnostic();
      requestTimingActionMessage = '已导出请求耗时诊断 JSON。';
    } catch (error) {
      requestTimingActionMessage = `导出失败：${error.message || '浏览器下载不可用'}`;
    }
    updateRequestTimingDetailModal({ preserveScroll: true });
    return;
  }

  if (target.dataset.action === 'reset-frontend-errors') {
    event.preventDefault();
    frontendErrorActionMessage = '已清空本页前端异常记录。';
    frontendErrorDiagnosticPreviewText = '';
    frontendErrorDetailFilter = 'all';
    window.CrystelfFrontendErrors?.reset?.();
    updateFrontendErrorDetailModal({ preserveScroll: false });
    return;
  }

  if (target.dataset.action === 'set-frontend-error-filter') {
    event.preventDefault();
    const nextFilter = target.dataset.filter || 'all';
    frontendErrorDetailFilter = FRONTEND_ERROR_FILTERS.some(filter => filter.value === nextFilter) ? nextFilter : 'all';
    updateFrontendErrorDetailModal({ preserveScroll: false });
    return;
  }

  if (target.dataset.action === 'copy-frontend-error-diagnostic') {
    event.preventDefault();
    try {
      await copyFrontendErrorDiagnostic();
      frontendErrorActionMessage = '已复制前端异常诊断信息。';
      frontendErrorDiagnosticPreviewText = '';
    } catch {
      frontendErrorActionMessage = '浏览器没有允许自动复制，已在下方展开诊断文本，可手动复制或导出 JSON。';
      frontendErrorDiagnosticPreviewText = formatFrontendErrorDiagnosticText();
    }
    updateFrontendErrorDetailModal({ preserveScroll: true });
    return;
  }

  if (target.dataset.action === 'export-frontend-error-diagnostic') {
    event.preventDefault();
    try {
      downloadFrontendErrorDiagnostic();
      frontendErrorActionMessage = '已导出前端异常诊断 JSON。';
    } catch (error) {
      frontendErrorActionMessage = `导出失败：${error.message || '浏览器下载不可用'}`;
    }
    updateFrontendErrorDetailModal({ preserveScroll: true });
    return;
  }

  if (target.dataset.usageScene !== undefined) {
    const input = document.getElementById('usage-log-scene');
    if (input) {
      input.value = target.dataset.usageScene || '';
      state.usageLogPage = 1;
      scheduleRefresh.cancel?.();
      refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
    }
    return;
  }

  if (target.dataset.restoreSelect) {
    toggleRestoreFileSelection(target.dataset.restoreSelect);
    return;
  }

  if (target.dataset.configHistoryRollback) {
    try {
      const historyId = target.dataset.configHistoryRollback || '';
      const confirmed = await openModal(
        '回滚配置',
        '确认回滚这次配置变更？回滚会把相关配置文件恢复到该次保存之前的状态，并写入一条新的回滚记录。',
        { confirmText: '确认回滚', cancelText: '取消', showCancel: true },
      );
      if (!confirmed) return;
      const result = await rollbackConfigHistory(historyId);
      await refresh();
      await openModal('回滚完成', `已恢复 ${result.count || 0} 个配置文件：${(result.restoredKeys || []).join('、')}`, { showCancel: false });
    } catch (error) {
      await openModal('回滚失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'reset-affinity') {
    try {
      const confirmed = await openModal('重置好感', `确认重置 ${target.dataset.groupId} / ${target.dataset.userId} 的好感数据？`, { confirmText: '确认重置', cancelText: '取消', showCancel: true });
      if (!confirmed) return;
      await postJson('/api/affinity/reset', { groupId: target.dataset.groupId, userId: target.dataset.userId });
      await refresh();
    } catch (error) {
      await openModal('操作失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'show-affinity-history') {
    try {
      const data = await fetchJson(`/api/affinity-history?groupId=${encodeURIComponent(target.dataset.groupId || '')}&userId=${encodeURIComponent(target.dataset.userId || '')}`);
      await openModal('好感历史', renderAffinityHistoryPreview(data), { showCancel: false });
    } catch (error) {
      await openModal('加载失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'delete-profile') {
    try {
      const confirmed = await openModal('删除画像', `确认删除画像 ${target.dataset.sessionId} / ${target.dataset.userId}？`, { confirmText: '确认删除', cancelText: '取消', showCancel: true });
      if (!confirmed) return;
      await postJson('/api/profiles/delete', { sessionId: target.dataset.sessionId, userId: target.dataset.userId });
      await refresh();
    } catch (error) {
      await openModal('删除失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'show-profile-detail') {
    try {
      const data = await fetchJson(`/api/profile-detail?sessionId=${encodeURIComponent(target.dataset.sessionId || '')}&userId=${encodeURIComponent(target.dataset.userId || '')}`);
      await openModal('画像详情', renderProfileDetailPreview(data), { showCancel: false });
    } catch (error) {
      await openModal('加载失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'reset-session') {
    try {
      const confirmed = await openModal('重置会话', `确认重置会话 ${target.dataset.sessionId}？这会清空消息和相关状态。`, { confirmText: '确认重置', cancelText: '取消', showCancel: true });
      if (!confirmed) return;
      await postJson('/api/sessions/reset', { sessionId: target.dataset.sessionId });
      await refresh();
      await openModal('重置完成', `会话 ${target.dataset.sessionId} 已重置。`, { showCancel: false });
    } catch (error) {
      await openModal('操作失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'reset-session-messages') {
    try {
      const confirmed = await openModal('清空会话消息', `确认只清空会话 ${target.dataset.sessionId} 的消息记录？`, { confirmText: '确认清空', cancelText: '取消', showCancel: true });
      if (!confirmed) return;
      await postJson('/api/sessions/reset', { sessionId: target.dataset.sessionId, mode: 'messages_only' });
      await refresh();
      await openModal('清空完成', `会话 ${target.dataset.sessionId} 的消息已清空。`, { showCancel: false });
    } catch (error) {
      await openModal('操作失败', error.message, { showCancel: false });
    }
  }

});

document.addEventListener('change', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.dataset.action === 'set-request-timing-threshold') {
    window.CrystelfRequest?.setSlowThreshold?.(target.value);
    updateRequestTimingDetailModal({ preserveScroll: true });
  }
});

document.addEventListener('error', event => {
  handleImageMonitorThumbError(event.target);
}, true);

['session-search', 'session-id-filter', 'session-user-filter', 'affinity-search', 'affinity-group-filter', 'profile-search', 'profile-session-filter', 'usage-log-search', 'usage-log-scene', 'affinity-log-search', 'affinity-log-group', 'image-monitor-log-search', 'image-monitor-meme-search'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    if (id.startsWith('session')) state.sessionPage = 1;
    if (id.startsWith('affinity')) state.affinityPage = 1;
    if (id.startsWith('profile')) state.profilePage = 1;
    if (id.startsWith('usage-log')) state.usageLogPage = 1;
    if (id.startsWith('affinity-log')) state.affinityLogPage = 1;
    if (id.startsWith('image-monitor-log')) state.imageMonitorLogPage = 1;
    if (id.startsWith('image-monitor-meme')) state.imageMonitorMemePage = 1;
    scheduleRefresh();
  });
});

document.getElementById('refresh-image-monitor-btn')?.addEventListener('click', () => {
});

document.getElementById('clear-filters-btn')?.addEventListener('click', handleClearFilters);
document.getElementById('mobile-clear-filters-btn')?.addEventListener('click', handleClearFilters);
document.getElementById('mobile-refresh-btn')?.addEventListener('click', () => {
  scheduleRefresh.cancel?.();
  refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
});

document.getElementById('refresh-btn')?.addEventListener('click', () => {
  scheduleRefresh.cancel?.();
  refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
});

document.getElementById('log-diagnosis-run-btn')?.addEventListener('click', () => {
  runLogDiagnosis();
});

document.getElementById('console-page-check-run-btn')?.addEventListener('click', () => {
  window.CrystelfConsolePageCheck?.run?.().catch(error => {
    const box = document.getElementById('console-page-check-result');
    if (box) {
      box.innerHTML = `<div class="setting-status tone-error">页面巡检失败：${escapeHtml(error.message || '未知错误')}</div>`;
    }
  });
});

document.getElementById('support-bundle-export-btn')?.addEventListener('click', () => {
  window.CrystelfSupportBundle?.export?.();
});

// 配置备份/恢复入口已移至「系统设置」页（system-settings.html）

document.getElementById('refresh-config-history-btn')?.addEventListener('click', () => {
  refreshConfigHistoryPanel()
    .then(() => openModal('刷新完成', '配置变更历史已刷新。', { showCancel: false }))
    .catch(error => openModal('刷新失败', error.message, { showCancel: false }));
});

document.getElementById('export-usage-logs-btn')?.addEventListener('click', () => {
  const filters = getFilters();
  downloadExport('usage-logs', { query: filters.usageLogQuery, scene: filters.usageLogScene })
    .catch(error => openModal('导出失败', error.message, { showCancel: false }));
});

document.getElementById('export-affinity-logs-btn').addEventListener('click', () => {
  const filters = getFilters();
  downloadExport('affinity-logs', { query: filters.affinityLogQuery, groupId: filters.affinityLogGroup })
    .catch(error => openModal('导出失败', error.message, { showCancel: false }));
});

document.getElementById('modal-cancel-btn').addEventListener('click', () => closeModal(false));
document.getElementById('modal-confirm-btn').addEventListener('click', () => closeModal(true));
document.getElementById('modal-mask').addEventListener('click', event => {
  if (event.target === event.currentTarget) {
    closeModal(false);
  }
});

document.querySelectorAll('.tab-btn').forEach(button => {
  button.addEventListener('click', () => switchTopTab(button.dataset.tabTarget));
});

switchTopTab(state.activeTopTab);

refresh().catch(error => {
  const pre = document.createElement('pre');
  pre.textContent = `控制台初始化失败: ${error?.message || String(error)}`;
  document.body.replaceChildren(pre);
});
