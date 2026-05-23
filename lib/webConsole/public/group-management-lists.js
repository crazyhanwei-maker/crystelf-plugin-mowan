async function loadMembers(page = 1) {
  const group = getSelectedGroup();
  if (!group) return;
  const requestId = ++groupManagementState.memberRequestId;
  const controller = replaceGroupManagementRequestController('memberController');
  const requestOptions = getCancelableGroupManagementRequestOptions(controller);
  const query = String($('group-management-member-search')?.value || '').trim();
  groupManagementState.memberQuery = query;
  groupManagementState.memberPage = page;
  groupManagementState.memberPayload = { pending: true };
  renderMembers();
  try {
    const payload = await fetchJson(
      `/api/group-management/members?groupId=${encodeURIComponent(group.groupId)}&query=${encodeURIComponent(query)}&page=${encodeURIComponent(page)}`,
      requestOptions,
    );
    if (requestId !== groupManagementState.memberRequestId) return;
    groupManagementState.memberPayload = payload;
  } catch (error) {
    if (requestId !== groupManagementState.memberRequestId || isGroupManagementRequestCanceled(error)) return;
    groupManagementState.memberPayload = { success: false, error: error.message };
  } finally {
    if (requestId === groupManagementState.memberRequestId) {
      clearGroupManagementRequestController('memberController', controller);
    }
  }
  if (requestId !== groupManagementState.memberRequestId) return;
  renderMembers();
}

async function loadJoinRequests(page = 1) {
  const group = getSelectedGroup();
  if (!group) return;
  const requestId = ++groupManagementState.joinRequestId;
  const controller = replaceGroupManagementRequestController('joinRequestController');
  const requestOptions = getCancelableGroupManagementRequestOptions(controller);
  const query = String($('group-management-join-request-search')?.value || '').trim();
  groupManagementState.joinRequestQuery = query;
  groupManagementState.joinRequestPage = page;
  groupManagementState.joinRequestPayload = { pending: true };
  renderJoinRequests();
  try {
    const params = new URLSearchParams({
      groupId: group.groupId,
      status: 'pending',
      query,
      page: String(page),
      pageSize: '10',
    });
    const payload = await fetchJson(`/api/group-management/join-requests?${params.toString()}`, requestOptions);
    if (requestId !== groupManagementState.joinRequestId) return;
    groupManagementState.joinRequestPayload = payload;
  } catch (error) {
    if (requestId !== groupManagementState.joinRequestId || isGroupManagementRequestCanceled(error)) return;
    groupManagementState.joinRequestPayload = { success: false, error: error.message };
  } finally {
    if (requestId === groupManagementState.joinRequestId) {
      clearGroupManagementRequestController('joinRequestController', controller);
    }
  }
  if (requestId !== groupManagementState.joinRequestId) return;
  renderJoinRequests();
}

async function loadTitleApplications(page = 1) {
  const group = getSelectedGroup();
  if (!group) return;
  const requestId = ++groupManagementState.titleApplicationRequestId;
  const controller = replaceGroupManagementRequestController('titleApplicationController');
  const requestOptions = getCancelableGroupManagementRequestOptions(controller);
  const query = String($('group-management-title-application-search')?.value || '').trim();
  const status = String($('group-management-title-application-status')?.value || groupManagementState.titleApplicationStatus || 'pending').trim();
  groupManagementState.titleApplicationQuery = query;
  groupManagementState.titleApplicationStatus = ['pending', 'failed', 'approved', 'rejected', 'cancelled', 'expired', 'all'].includes(status)
    ? status
    : 'pending';
  groupManagementState.titleApplicationPage = page;
  groupManagementState.titleApplicationPayload = { pending: true };
  renderTitleApplications();
  try {
    const params = new URLSearchParams({
      groupId: group.groupId,
      status: groupManagementState.titleApplicationStatus,
      query,
      page: String(page),
      pageSize: '10',
    });
    const payload = await fetchJson(`/api/group-management/title-applications?${params.toString()}`, requestOptions);
    if (requestId !== groupManagementState.titleApplicationRequestId) return;
    groupManagementState.titleApplicationPayload = payload;
  } catch (error) {
    if (requestId !== groupManagementState.titleApplicationRequestId || isGroupManagementRequestCanceled(error)) return;
    groupManagementState.titleApplicationPayload = { success: false, error: error.message };
  } finally {
    if (requestId === groupManagementState.titleApplicationRequestId) {
      clearGroupManagementRequestController('titleApplicationController', controller);
    }
  }
  if (requestId !== groupManagementState.titleApplicationRequestId) return;
  renderTitleApplications();
}

function renderPagination(containerId, page, totalPages, actionName) {
  const container = $(containerId);
  if (!container) return;
  const current = Number(page || 1);
  const total = Math.max(1, Number(totalPages || 1));
  if (total <= 1) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <button class="mini-btn" data-action="${escapeHtml(actionName)}" data-page="${Math.max(1, current - 1)}" ${current <= 1 ? 'disabled' : ''}>上一页</button>
    <span>${formatNumber(current)} / ${formatNumber(total)}</span>
    <button class="mini-btn" data-action="${escapeHtml(actionName)}" data-page="${Math.min(total, current + 1)}" ${current >= total ? 'disabled' : ''}>下一页</button>
  `;
}

function renderJoinRequests() {
  const meta = $('group-management-join-requests-meta');
  const box = $('group-management-join-requests');
  if (!meta || !box) return;
  const payload = groupManagementState.joinRequestPayload;
  if (!payload) {
    meta.textContent = '点击刷新申请列表。';
    box.innerHTML = '尚未读取。';
    $('group-management-join-request-pagination').innerHTML = '';
    return;
  }
  if (payload.pending) {
    meta.textContent = '正在读取加群申请...';
    box.innerHTML = '<div class="list-item">读取中...</div>';
    $('group-management-join-request-pagination').innerHTML = '';
    return;
  }
  if (payload.success === false) {
    meta.textContent = '加群申请读取失败';
    box.innerHTML = `<div class="list-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    $('group-management-join-request-pagination').innerHTML = '';
    return;
  }

  meta.textContent = `待处理申请 ${formatNumber(payload.total || 0)} 条`;
  box.innerHTML = (payload.items || []).length > 0
    ? payload.items.map((item) => {
        const risk = item.risk?.enabled === false ? null : item.risk || null;
        return `
          <div class="list-item group-management-join-request-item">
            <div class="group-management-join-request-main">
              <div>
                <h3>${escapeHtml(item.nickname || item.userId || item.user_id || '未知用户')}</h3>
                <div class="setting-help">QQ ${escapeHtml(item.userId || item.user_id || '暂无')} / ${escapeHtml(formatDateTime(item.createdAt || item.updatedAt))}</div>
              </div>
              <div class="detail-tags">
                <span class="detail-tag tone-warning">待审核</span>
                ${risk ? `<span class="detail-tag ${getRiskTagTone(risk.level)}">${getRiskLevelLabel(risk.level)} ${escapeHtml(formatNumber(risk.score || 0))}</span>` : ''}
                ${item.qqLevel != null ? `<span class="detail-tag">QQ等级 ${escapeHtml(item.qqLevel)}</span>` : ''}
                ${item.age != null ? `<span class="detail-tag">年龄 ${escapeHtml(item.age)}</span>` : ''}
              </div>
            </div>
            <div class="log-entry-preview">
              <div class="log-entry-label">申请理由</div>
              <div class="log-entry-text">${escapeHtml(item.comment || '暂无')}</div>
            </div>
            <div class="log-entry-preview">
              <div class="log-entry-label">保留原因</div>
              <div class="log-entry-text">${escapeHtml(item.error || item.reason || '等待人工审核')}</div>
            </div>
            ${risk && Array.isArray(risk.reasons) && risk.reasons.length > 0 ? `
              <div class="log-entry-preview">
                <div class="log-entry-label">风险信号</div>
                <div class="group-management-risk-reasons">${risk.reasons.map(reason => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
              </div>
            ` : ''}
            <div class="actions">
              <button type="button" class="mini-btn" data-action="approve-join-request" data-request-id="${escapeHtml(item.id || '')}">同意入群</button>
              <button type="button" class="mini-btn" data-action="approve-join-request-whitelist" data-request-id="${escapeHtml(item.id || '')}">同意并加白</button>
              <button type="button" class="mini-btn danger" data-action="reject-join-request" data-request-id="${escapeHtml(item.id || '')}">拒绝</button>
              <button type="button" class="mini-btn danger" data-action="reject-join-request-blacklist" data-request-id="${escapeHtml(item.id || '')}">拒绝并拉黑</button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="list-item">暂无待处理加群申请。</div>';
  renderPagination('group-management-join-request-pagination', payload.page, payload.totalPages, 'join-request-page');
}

function getTitleApplicationStatusLabel(status = '') {
  const labels = {
    pending: '待审核',
    approved: '已通过',
    rejected: '已拒绝',
    failed: '发放失败',
    cancelled: '已取消',
    expired: '已过期',
  };
  return labels[String(status || '').trim()] || '未知';
}

function getTitleApplicationStatusTone(status = '') {
  const value = String(status || '').trim();
  if (value === 'approved') return 'tone-success';
  if (value === 'pending' || value === 'failed') return 'tone-warning';
  if (value === 'rejected') return 'tone-error';
  return '';
}

function renderTitleApplications() {
  const meta = $('group-management-title-applications-meta');
  const box = $('group-management-title-applications');
  const pagination = $('group-management-title-application-pagination');
  if (!meta || !box || !pagination) return;
  const payload = groupManagementState.titleApplicationPayload;
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  if (!payload) {
    meta.textContent = '点击刷新头衔申请列表。';
    box.innerHTML = '尚未读取。';
    pagination.innerHTML = '';
    return;
  }
  if (payload.pending) {
    meta.textContent = '正在读取头衔申请...';
    box.innerHTML = '<div class="list-item">读取中...</div>';
    pagination.innerHTML = '';
    return;
  }
  if (payload.success === false) {
    meta.textContent = '头衔申请读取失败';
    box.innerHTML = `<div class="list-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    pagination.innerHTML = '';
    return;
  }

  const statusLabel = groupManagementState.titleApplicationStatus === 'all'
    ? '全部'
    : getTitleApplicationStatusLabel(groupManagementState.titleApplicationStatus);
  meta.textContent = `${statusLabel}头衔申请 ${formatNumber(payload.total || 0)} 条`;
  box.innerHTML = (payload.items || []).length > 0
    ? payload.items.map((item) => {
        const status = String(item.status || 'pending');
        const canReview = status === 'pending' || status === 'failed';
        return `
          <div class="list-item group-management-title-application-item">
            <div class="group-management-join-request-main">
              <div>
                <h3>${escapeHtml(item.title || '未命名头衔')}</h3>
                <div class="setting-help">编号 ${escapeHtml(item.id || '')} / QQ ${escapeHtml(item.userId || '')} / ${escapeHtml(item.nickname || '无昵称')}</div>
              </div>
              <div class="detail-tags">
                <span class="detail-tag ${getTitleApplicationStatusTone(status)}">${escapeHtml(getTitleApplicationStatusLabel(status))}</span>
                ${item.forbiddenKeyword ? `<span class="detail-tag tone-error">禁用词 ${escapeHtml(item.forbiddenKeyword)}</span>` : ''}
                <span class="detail-tag">${escapeHtml(formatDateTime(item.updatedAt || item.createdAt))}</span>
              </div>
            </div>
            <div class="log-entry-preview">
              <div class="log-entry-label">申请头衔</div>
              <div class="log-entry-text">${escapeHtml(item.title || '')}</div>
            </div>
            ${(item.reason || item.error || item.reviewerName) ? `
              <div class="log-entry-preview">
                <div class="log-entry-label">审核信息</div>
                <div class="log-entry-text">${escapeHtml([item.reviewerName, item.reason, item.error].filter(Boolean).join(' / ') || '暂无')}</div>
              </div>
            ` : ''}
            ${item.forbiddenKeyword ? `
              <div class="group-management-safety-note">该头衔命中禁用词“${escapeHtml(item.forbiddenKeyword)}”，控制台会阻止通过发放。</div>
            ` : ''}
            <div class="actions">
              <button type="button" class="mini-btn" data-action="approve-title-application" data-application-id="${escapeHtml(item.id || '')}" ${canReview ? disabledAttr : 'disabled'}>通过并发放</button>
              <button type="button" class="mini-btn danger" data-action="reject-title-application" data-application-id="${escapeHtml(item.id || '')}" ${canReview ? disabledAttr : 'disabled'}>拒绝</button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="list-item">暂无头衔申请。</div>';
  renderPagination('group-management-title-application-pagination', payload.page, payload.totalPages, 'title-application-page');
}

function renderMembers() {
  const meta = $('group-management-members-meta');
  const box = $('group-management-members');
  if (!meta || !box) return;
  const payload = groupManagementState.memberPayload;
  if (!payload) {
    meta.textContent = '点击读取成员列表。';
    box.innerHTML = '尚未读取。';
    $('group-management-member-pagination').innerHTML = '';
    return;
  }
  if (payload.pending) {
    meta.textContent = '正在读取成员列表...';
    box.innerHTML = '<div class="list-item">读取中...</div>';
    $('group-management-member-pagination').innerHTML = '';
    return;
  }
  if (payload.success === false) {
    meta.textContent = '成员列表读取失败';
    box.innerHTML = `<div class="list-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    $('group-management-member-pagination').innerHTML = '';
    return;
  }

  const warnings = (payload.warnings || []).length > 0 ? ` / ${payload.warnings[0]}` : '';
  meta.textContent = `成员 ${formatNumber(payload.total || 0)} 人 / 来源 ${payload.source || '未识别'}${warnings}`;
  box.innerHTML = (payload.items || []).length > 0
    ? payload.items.map(member => `
      <div class="list-item group-management-member-item">
        <div>
          <h3>${escapeHtml(member.card || member.nickname || member.userId)}</h3>
          <div class="setting-help">QQ ${escapeHtml(member.userId)} / ${escapeHtml(member.nickname || '无昵称')}</div>
        </div>
        <div class="detail-tags">
          <span class="detail-tag">${escapeHtml(member.role || 'member')}</span>
          <span class="detail-tag">入群 ${escapeHtml(formatUnixTime(member.joinTime))}</span>
          <span class="detail-tag">发言 ${escapeHtml(formatUnixTime(member.lastSentTime))}</span>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">没有成员数据或当前适配器不支持读取成员列表。</div>';
  renderPagination('group-management-member-pagination', payload.page, payload.totalPages, 'member-page');
}
