// 群管理日志与实时事件面板。由 group-management.html 在 group-management.js 前加载。

function buildGroupManagementLogUrl(page = 1) {
  const params = new URLSearchParams();
  const groupId = groupManagementState.selectedGroupId;
  if (groupId) params.set('groupId', groupId);
  if (groupManagementState.logQuery) params.set('query', groupManagementState.logQuery);
  params.set('page', String(page));
  params.set('pageSize', '10');
  return `/api/logs/group-management?${params.toString()}`;
}

function renderGroupManagementLogs() {
  const meta = $('group-management-log-meta');
  const box = $('group-management-log-list');
  if (!meta || !box) return;
  const payload = groupManagementState.logPayload;
  if (!groupManagementState.selectedGroupId) {
    meta.textContent = '请选择一个群后查看对应日志。';
    box.innerHTML = '<div class="list-item">请选择一个群。</div>';
    $('group-management-log-pagination').innerHTML = '';
    return;
  }
  if (!payload) {
    meta.textContent = '正在读取群管理日志...';
    box.innerHTML = '<div class="list-item">日志加载中...</div>';
    $('group-management-log-pagination').innerHTML = '';
    return;
  }
  if (payload.pending) {
    meta.textContent = '正在读取群管理日志...';
    box.innerHTML = '<div class="list-item">日志加载中...</div>';
    $('group-management-log-pagination').innerHTML = '';
    return;
  }
  if (payload.success === false) {
    meta.textContent = '群管理日志读取失败';
    box.innerHTML = `<div class="list-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    $('group-management-log-pagination').innerHTML = '';
    return;
  }

  const groupId = groupManagementState.selectedGroupId;
  meta.textContent = `群 ${groupId} 日志 ${formatNumber(payload.total || 0)} 条 / 第 ${formatNumber(payload.page || 1)} 页`;
  box.innerHTML = (payload.items || []).length > 0
    ? payload.items.map(item => {
        const changes = Array.isArray(item.changes) && item.changes.length > 0
          ? item.changes.join('；')
          : (item.reason || item.error || '暂无详情');
        const sections = Array.isArray(item.sections) && item.sections.length > 0 ? item.sections.join(', ') : item.source || 'runtime';
        return `
          <div class="list-item group-management-log-entry ${item.success === false ? 'tone-error' : ''}">
            <div class="group-management-log-head">
              <div>
                <h3>${escapeHtml(item.action_label || item.action || '未知操作')}</h3>
                <div class="setting-help">${escapeHtml(formatDateTime(item.time))}</div>
              </div>
              <div class="detail-tags">
                <span class="detail-tag ${item.success === false ? 'tone-error' : 'tone-success'}">${item.success === false ? '失败' : '成功'}</span>
                <span class="detail-tag">${escapeHtml(sections)}</span>
              </div>
            </div>
            <div class="group-management-log-meta">
              <span>群 ${escapeHtml(item.group_id || groupId)}</span>
              <span>用户 ${escapeHtml(item.user_id || '暂无')}</span>
              <span>来源 ${escapeHtml(item.source || 'runtime')}</span>
              ${item.client_ip ? `<span>IP ${escapeHtml(item.client_ip)}</span>` : ''}
            </div>
            <div class="log-entry-preview">
              <div class="log-entry-label">详情</div>
              <div class="log-entry-text">${escapeHtml(changes)}</div>
            </div>
            ${item.comment_preview ? `
              <div class="log-entry-preview">
                <div class="log-entry-label">申请理由</div>
                <div class="log-entry-text">${escapeHtml(item.comment_preview)}</div>
              </div>
            ` : ''}
            <div class="group-management-log-actions">
              <button type="button" class="mini-btn" data-action="convert-log-scenario" data-log-id="${escapeHtml(item.id || '')}">转模拟调试场景</button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="list-item">暂无群管理日志。</div>';
  renderPagination('group-management-log-pagination', payload.page, payload.totalPages, 'group-log-page');
}

async function convertGroupManagementLogToScenario(logId = '') {
  const id = String(logId || '').trim();
  if (!id) {
    showRisk('这条日志缺少可转换的 ID。');
    return;
  }
  const entry = (groupManagementState.logPayload?.items || []).find(item => item.id === id) || null;
  try {
    const result = await postJson('/api/group-management/log-to-scenario', { id, entry, save: true });
    const scenarioId = result?.scenario?.id || '';
    showSuccess(result.message || '已转为模拟调试场景。');
    if (scenarioId) {
      window.open(`/qq-simulator.html?scenarioId=${encodeURIComponent(scenarioId)}`, '_blank', 'noopener');
    }
  } catch (error) {
    showRisk(`转模拟调试场景失败：${error.message}`);
  }
}

async function refreshGroupManagementLogs(page = groupManagementState.logPage) {
  if (!$('group-management-log-list')) return;
  const requestId = ++groupManagementState.logRequestId;
  const controller = replaceGroupManagementRequestController('logController');
  const requestOptions = getCancelableGroupManagementRequestOptions(controller);
  groupManagementState.logPage = Math.max(1, Number(page || 1));
  groupManagementState.logPayload = { pending: true };
  renderGroupManagementLogs();
  if (!groupManagementState.selectedGroupId) {
    clearGroupManagementRequestController('logController', controller);
    return;
  }
  try {
    const payload = await fetchJson(buildGroupManagementLogUrl(groupManagementState.logPage), requestOptions);
    if (requestId !== groupManagementState.logRequestId) return;
    groupManagementState.logPayload = payload;
  } catch (error) {
    if (requestId !== groupManagementState.logRequestId || isGroupManagementRequestCanceled(error)) return;
    groupManagementState.logPayload = { success: false, error: error.message };
  } finally {
    if (requestId === groupManagementState.logRequestId) {
      clearGroupManagementRequestController('logController', controller);
    }
  }
  if (requestId !== groupManagementState.logRequestId) return;
  renderGroupManagementLogs();
}

function getGroupManagementEventTone(type = '', success = true) {
  if (success === false) return 'tone-error';
  const value = String(type || '').trim();
  if (value === 'moderation' || value === 'join' || value === 'title') return 'tone-warning';
  if (value === 'welcome' || value === 'summary') return 'tone-success';
  return '';
}

function getGroupManagementEventDetail(item = {}) {
  if (Array.isArray(item.changes) && item.changes.length > 0) {
    return item.changes.join('；');
  }
  if (item.reason) return item.reason;
  if (item.error) return item.error;
  if (item.comment_preview) return item.comment_preview;
  const summary = item.summary && typeof item.summary === 'object' && !Array.isArray(item.summary)
    ? Object.entries(item.summary)
        .filter(([, value]) => value !== undefined && value !== '')
        .slice(0, 4)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('、') : value}`)
        .join('；')
    : '';
  return summary || '暂无详情';
}

function getGroupManagementEventKey(item = {}) {
  return [
    item.id,
    item.time,
    item.action,
    item.group_id || item.groupId,
    item.user_id || item.userId,
    item.reason,
    item.error,
    item.comment_preview,
  ].map(value => String(value || '')).join('|');
}

function pruneGroupManagementEventUnreadKeys() {
  const visibleKeys = new Set((groupManagementState.eventItems || []).map(item => getGroupManagementEventKey(item)));
  for (const key of Array.from(groupManagementState.eventUnreadKeys || [])) {
    if (!visibleKeys.has(key)) {
      groupManagementState.eventUnreadKeys.delete(key);
    }
  }
}

function renderGroupManagementEventStream() {
  const box = $('group-management-event-stream');
  if (!box) return;
  const payload = groupManagementState.eventPayload;
  const toggleButton = $('group-management-event-toggle-btn');
  const typeSelect = $('group-management-event-type');
  const scopeCheckbox = $('group-management-event-current-group');
  const failedOnlyCheckbox = $('group-management-event-failed-only');
  if (toggleButton) {
    toggleButton.textContent = groupManagementState.eventAutoRefresh ? '暂停自动刷新' : '继续自动刷新';
  }
  if (typeSelect) typeSelect.value = groupManagementState.eventType || 'all';
  if (scopeCheckbox instanceof HTMLInputElement) scopeCheckbox.checked = groupManagementState.eventCurrentGroupOnly !== false;
  if (failedOnlyCheckbox instanceof HTMLInputElement) failedOnlyCheckbox.checked = groupManagementState.eventFailedOnly === true;

  if (payload?.pending) {
    setEventStatus('正在读取实时事件...');
    box.innerHTML = '<div class="group-management-empty">事件加载中...</div>';
    return;
  }
  if (payload?.success === false) {
    setEventStatus('实时事件读取失败');
    box.innerHTML = `<div class="group-management-event-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    return;
  }

  const allItems = groupManagementState.eventItems || [];
  const items = groupManagementState.eventFailedOnly
    ? allItems.filter(item => item.success === false)
    : allItems;
  const scopeText = groupManagementState.eventCurrentGroupOnly && groupManagementState.selectedGroupId
    ? `当前群 ${groupManagementState.selectedGroupId}`
    : '全部群';
  const statusText = groupManagementState.eventAutoRefresh ? '自动刷新中' : '已暂停';
  const unreadCount = allItems.filter(item => groupManagementState.eventUnreadKeys.has(getGroupManagementEventKey(item))).length;
  const failedCount = allItems.filter(item => item.success === false).length;
  setEventStatus(`${statusText} / ${scopeText} / 显示 ${formatNumber(items.length)} 条 / 未读 ${formatNumber(unreadCount)} / 失败 ${formatNumber(failedCount)}`);
  box.innerHTML = items.length > 0
    ? items.map((item) => {
        const type = item.eventType || 'config';
        const tone = getGroupManagementEventTone(type, item.success !== false);
        const detail = getGroupManagementEventDetail(item);
        const actor = [item.nickname, item.user_id || item.userId].filter(Boolean).join(' / ') || '暂无用户';
        const sections = Array.isArray(item.sections) && item.sections.length > 0 ? item.sections.join(', ') : item.source || 'runtime';
        const unread = groupManagementState.eventUnreadKeys.has(getGroupManagementEventKey(item));
        return `
          <div class="group-management-event-item ${escapeHtml(tone)} ${unread ? 'is-unread' : ''}">
            <div class="group-management-event-line">
              <div>
                <strong>${escapeHtml(item.action_label || item.action || '未知事件')}</strong>
                <span>${escapeHtml(formatDateTime(item.time))}</span>
              </div>
              <div class="detail-tags">
                ${unread ? '<span class="detail-tag tone-warning">新</span>' : ''}
                <span class="detail-tag ${escapeHtml(tone)}">${escapeHtml(item.eventTypeLabel || '事件')}</span>
                <span class="detail-tag ${item.success === false ? 'tone-error' : 'tone-success'}">${item.success === false ? '失败' : '成功'}</span>
              </div>
            </div>
            <div class="group-management-event-meta">
              <span>群 ${escapeHtml(item.group_id || item.groupId || '暂无')}</span>
              <span>用户 ${escapeHtml(actor)}</span>
              <span>来源 ${escapeHtml(sections)}</span>
            </div>
            <div class="group-management-event-detail">${escapeHtml(detail)}</div>
          </div>
        `;
      }).join('')
    : '<div class="group-management-empty">暂无事件。开启自动刷新后，新触发的风控、申请、欢迎、总结和头衔事件会显示在这里。</div>';
}

function buildGroupManagementEventUrl(options = {}) {
  const params = new URLSearchParams();
  const incremental = options.incremental === true;
  const groupId = groupManagementState.eventCurrentGroupOnly ? groupManagementState.selectedGroupId : '';
  if (groupId) params.set('groupId', groupId);
  params.set('type', groupManagementState.eventType || 'all');
  params.set('limit', incremental ? '30' : '40');
  if (incremental && groupManagementState.eventSince) {
    params.set('since', groupManagementState.eventSince);
  }
  return `/api/group-management/events?${params.toString()}`;
}

function buildGroupManagementEventStreamUrl() {
  const params = new URLSearchParams();
  const groupId = groupManagementState.eventCurrentGroupOnly ? groupManagementState.selectedGroupId : '';
  if (groupId) params.set('groupId', groupId);
  params.set('type', groupManagementState.eventType || 'all');
  params.set('limit', '40');
  params.set('stream', '1');
  return `/api/group-management/events?${params.toString()}`;
}

function addGroupManagementEventItems(items = [], options = {}) {
  const incoming = Array.isArray(items) ? items : [];
  const seen = new Set((groupManagementState.eventItems || []).map(item => getGroupManagementEventKey(item)));
  const fresh = incoming.filter(item => {
    const key = getGroupManagementEventKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) return 0;
  if (options.unread !== false) {
    fresh.forEach(item => groupManagementState.eventUnreadKeys.add(getGroupManagementEventKey(item)));
  }
  groupManagementState.eventItems = [...fresh, ...(groupManagementState.eventItems || [])].slice(0, 80);
  pruneGroupManagementEventUnreadKeys();
  return fresh.length;
}

function resetGroupManagementEventStream(options = {}) {
  groupManagementState.eventRequestId += 1;
  abortGroupManagementController(groupManagementState.eventController);
  groupManagementState.eventController = null;
  groupManagementState.eventLoading = false;
  groupManagementState.eventPayload = null;
  groupManagementState.eventSince = '';
  if (options.keepItems !== true) {
    groupManagementState.eventItems = [];
  }
  if (options.keepUnread !== true) {
    groupManagementState.eventUnreadKeys.clear();
  }
  renderGroupManagementEventStream();
}

async function refreshGroupManagementEventStream(options = {}) {
  if (!$('group-management-event-stream')) return;
  const requestId = ++groupManagementState.eventRequestId;
  const controller = replaceGroupManagementRequestController('eventController');
  const requestOptions = getCancelableGroupManagementRequestOptions(controller);
  const reset = options.reset === true;
  const incremental = options.incremental === true && !reset;
  groupManagementState.eventLoading = true;
  if (reset) {
    groupManagementState.eventPayload = { pending: true };
    groupManagementState.eventItems = [];
    groupManagementState.eventSince = '';
    renderGroupManagementEventStream();
  }
  try {
    const payload = await fetchJson(buildGroupManagementEventUrl({ incremental }), requestOptions);
    if (requestId !== groupManagementState.eventRequestId) return;
    const incoming = Array.isArray(payload.items) ? payload.items : [];
    if (incremental) {
      addGroupManagementEventItems(incoming, { unread: true });
    } else {
      groupManagementState.eventItems = incoming.slice(0, 80);
      groupManagementState.eventUnreadKeys.clear();
    }
    groupManagementState.eventPayload = payload;
    groupManagementState.eventSince = payload.nextSince || groupManagementState.eventSince || new Date().toISOString();
  } catch (error) {
    if (requestId !== groupManagementState.eventRequestId || isGroupManagementRequestCanceled(error)) return;
    groupManagementState.eventPayload = { success: false, error: error.message };
  } finally {
    if (requestId === groupManagementState.eventRequestId) {
      groupManagementState.eventLoading = false;
      clearGroupManagementRequestController('eventController', controller);
      renderGroupManagementEventStream();
    }
  }
}

function stopGroupManagementEventTimer() {
  groupManagementState.eventRequestId += 1;
  abortGroupManagementController(groupManagementState.eventController);
  groupManagementState.eventController = null;
  groupManagementState.eventLoading = false;
  if (groupManagementState.eventTimer) {
    clearInterval(groupManagementState.eventTimer);
    groupManagementState.eventTimer = null;
  }
  if (groupManagementState.eventReconnectTimer) {
    clearTimeout(groupManagementState.eventReconnectTimer);
    groupManagementState.eventReconnectTimer = null;
  }
  if (groupManagementState.eventSource) {
    groupManagementState.eventSource.close();
    groupManagementState.eventSource = null;
  }
}

function startGroupManagementEventTimer() {
  stopGroupManagementEventTimer();
  if (groupManagementState.eventAutoRefresh !== true || !$('group-management-event-stream')) return;
  if (typeof EventSource === 'function') {
    const source = new EventSource(buildGroupManagementEventStreamUrl());
    groupManagementState.eventSource = source;
    source.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        groupManagementState.eventPayload = payload;
        groupManagementState.eventItems = Array.isArray(payload.items) ? payload.items.slice(0, 80) : [];
        groupManagementState.eventSince = payload.nextSince || groupManagementState.eventSince || new Date().toISOString();
        groupManagementState.eventUnreadKeys.clear();
        renderGroupManagementEventStream();
      } catch {}
    });
    source.addEventListener('event', (event) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if (payload.item) {
          addGroupManagementEventItems([payload.item], { unread: true });
          groupManagementState.eventSince = payload.nextSince || payload.item.time || groupManagementState.eventSince;
          groupManagementState.eventPayload = { success: true };
          renderGroupManagementEventStream();
        }
      } catch {}
    });
    source.onerror = () => {
      if (groupManagementState.eventSource !== source) return;
      source.close();
      groupManagementState.eventSource = null;
      groupManagementState.eventReconnectTimer = setTimeout(() => {
        if (groupManagementState.eventAutoRefresh === true) {
          startGroupManagementEventTimer();
        }
      }, 5000);
    };
    return;
  }
  groupManagementState.eventTimer = setInterval(() => {
    if (document.hidden) return;
    refreshGroupManagementEventStream({ incremental: true }).catch(() => {});
  }, 5000);
}

async function refreshGroupManagementEventStreamNow(options = {}) {
  if (options.reset === true) {
    stopGroupManagementEventTimer();
  }
  await refreshGroupManagementEventStream(options);
  startGroupManagementEventTimer();
}
