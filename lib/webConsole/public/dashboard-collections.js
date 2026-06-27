function renderCollectionEntries(data) {
  const container = document.getElementById('collection-entry-grid');
  if (!container) return;
  const counts = data?.counts || {};
  const usage = data?.usage || {};
  const entries = [
    {
      title: '最近会话',
      description: '会话筛选、翻页、清空消息和重置操作已移到独立页面。',
      countLabel: '会话',
      countValue: counts.sessions || 0,
      href: '/session-center.html',
      actionLabel: '打开最近会话',
    },
    {
      title: '好感度 Top',
      description: '好感记录的筛选、历史查看和重置操作已移到独立页面。',
      countLabel: '用户',
      countValue: counts.affinityUsers || 0,
      href: '/affinity-center.html',
      actionLabel: '打开好感度 Top',
    },
    {
      title: '用户画像',
      description: '画像筛选、快速预览、详情和删除操作已移到独立页面。',
      countLabel: '画像',
      countValue: counts.profiles || 0,
      href: '/profile-center.html',
      actionLabel: '打开用户画像',
    },
    {
      title: '模拟调试',
      description: '构造群消息、连续对话、截图、语音、加群申请、新成员入群和戳一戳事件，安全查看机器人回复、动作和排查信息。',
      countLabel: '模式',
      countValue: 6,
      href: '/qq-simulator.html',
      actionLabel: '打开模拟调试',
    },
    {
      title: 'AI 用量日志',
      description: 'AI 请求日志、场景筛选、趋势图和详情页已移到独立页面，方便单独排查高消耗与失败请求。',
      countLabel: '请求',
      countValue: usage.requestCount || 0,
      href: '/usage-center.html',
      actionLabel: '打开 AI 用量日志中心',
    },
  ];

  container.innerHTML = entries.map(item => `
    <div class="setting-item">
      <h3>${item.title}</h3>
      <div class="setting-help">${item.description}</div>
      <div class="detail-tags">
        <span class="detail-tag tone-success">${item.countLabel} ${formatNumber(item.countValue)}</span>
        <span class="detail-tag">独立页面</span>
      </div>
      <div class="actions">
        <a class="link-btn" href="${item.href}">${item.actionLabel}</a>
      </div>
    </div>
  `).join('');
}

function renderPagination(containerId, page, totalPages, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!totalPages || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('...');
  }
  for (let i = start; i <= end; i += 1) {
    pages.push(i);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  container.innerHTML = [
    `<button data-page-target="${containerId}" data-page="${Math.max(1, page - 1)}">上一页</button>`,
    ...pages.map(item => item === '...'
      ? '<span class="page-ellipsis">...</span>'
      : `<button class="${item === page ? 'active' : ''}" data-page-target="${containerId}" data-page="${item}">${item}</button>`),
    `<button data-page-target="${containerId}" data-page="${Math.min(totalPages, page + 1)}">下一页</button>`,
  ].join('');
  container.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => onPageChange(Number(button.dataset.page)));
  });
}
function renderAffinity(data) {
  const items = data.items || [];
  const rendered = items.length > 0
    ? items.map(item => `
      <div class="list-item affinity-list-item">
        <div class="session-list-head">
          <div class="session-list-title">
            <h3>${escapeHtml(item.display_name || item.user_id || '未知用户')}</h3>
            <div class="setting-help">群 ${escapeHtml(item.group_id || '暂无')} / 用户 ${escapeHtml(item.user_id || '暂无')}</div>
          </div>
          <div class="detail-tags session-list-tags">
            <span class="detail-tag tone-success">${escapeHtml(item.level || '未知')}</span>
            <span class="detail-tag">更新于 ${escapeHtml(formatTime(item.updated_at))}</span>
          </div>
        </div>
        <div class="session-list-stats">
          <div class="session-stat-card">
            <span class="session-stat-label">好感分数</span>
            <strong>${formatNumber(item.score)}</strong>
            <div class="setting-help">当前好感累计值</div>
          </div>
          <div class="session-stat-card">
            <span class="session-stat-label">互动次数</span>
            <strong>${formatNumber(item.interaction_count)}</strong>
            <div class="setting-help">历史互动总次数</div>
          </div>
          <div class="session-stat-card">
            <span class="session-stat-label">最近原因</span>
            <strong>${escapeHtml(item.last_reason ? '已记录' : '暂无')}</strong>
            <div class="setting-help">最近一次分数变化原因</div>
          </div>
        </div>
        <div class="session-preview-block">
          <div class="session-preview-label">最近原因</div>
          <div class="session-preview-text">${escapeHtml(item.last_reason || '暂无')}</div>
        </div>
        <div class="actions">
          <a class="link-btn" href="/affinity-detail.html?groupId=${encodeURIComponent(item.group_id)}&userId=${encodeURIComponent(item.user_id)}">详情</a>
          <button data-action="show-affinity-history" data-group-id="${escapeHtml(item.group_id)}" data-user-id="${escapeHtml(item.user_id)}">历史</button>
          <button class="danger" data-action="reset-affinity" data-group-id="${escapeHtml(item.group_id)}" data-user-id="${escapeHtml(item.user_id)}">重置好感</button>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无好感记录</div>';
  document.getElementById('affinity-list').innerHTML = rendered;
  renderPagination('affinity-pagination', data.page, data.totalPages, page => {
    state.affinityPage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
}
function renderSessions(data) {
  const items = data.items || [];
  const rendered = items.length > 0
    ? items.map(item => `
      <div class="list-item session-list-item ${item.hasFallback ? 'tone-error' : ''}">
        <div class="session-list-head">
          <div class="session-list-title">
            <h3>${escapeHtml(item.sessionId || '未知会话')}</h3>
            <div class="setting-help">${escapeHtml(item.type || 'unknown')} / ${escapeHtml(item.targetId || '无目标')}</div>
          </div>
          <div class="detail-tags session-list-tags">
            ${item.hasFallback ? '<span class="detail-tag tone-error">触发兜底</span>' : '<span class="detail-tag tone-success">正常</span>'}
            <span class="detail-tag">活跃于 ${escapeHtml(formatTime(item.lastMessageTime))}</span>
          </div>
        </div>
        <div class="session-list-stats">
          <div class="session-stat-card">
            <span class="session-stat-label">消息数</span>
            <strong>${formatNumber(item.messageCount)}</strong>
            <div class="setting-help">用户 ${formatNumber(item.userMessageCount)} / 助手 ${formatNumber(item.assistantMessageCount)}</div>
          </div>
          <div class="session-stat-card">
            <span class="session-stat-label">参与用户</span>
            <strong>${formatNumber(item.participantCount)}</strong>
            <div class="setting-help">画像 ${formatNumber(item.profileCount)}</div>
          </div>
          <div class="session-stat-card">
            <span class="session-stat-label">最近角色</span>
            <strong>${escapeHtml(item.lastMessageRole === 'assistant' ? '助手' : item.lastMessageRole === 'user' ? '用户' : '未知')}</strong>
            <div class="setting-help">最后一条消息的角色</div>
          </div>
        </div>
        <div class="session-preview-block">
          <div class="session-preview-label">最近消息</div>
          <div class="session-preview-text">${escapeHtml(item.lastMessagePreview || '暂无消息')}</div>
        </div>
        <div class="session-preview-block">
          <div class="session-preview-label">参与者</div>
          <div class="session-member-list">
            ${(item.participants || []).length > 0
              ? (item.participants || []).map(participant => `<span class="session-member-chip">${escapeHtml(participant.userName || participant.userId || '未知')}</span>`).join('')
              : '<span class="active-filter-empty">暂无</span>'}
          </div>
        </div>
        ${item.hasFallback ? `<div class="session-fallback-note">兜底原因：${escapeHtml(item.fallbackReason || '未知')}</div>` : ''}
        <div class="actions">
          <a class="link-btn" href="/session-debug.html?sessionId=${encodeURIComponent(item.sessionId)}">会话排查</a>
          <button data-action="reset-session-messages" data-session-id="${escapeHtml(item.sessionId)}">清空消息</button>
          <button class="danger" data-action="reset-session" data-session-id="${escapeHtml(item.sessionId)}">重置会话</button>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无会话记录</div>';
  document.getElementById('session-list').innerHTML = rendered;
  renderPagination('session-pagination', data.page, data.totalPages, page => {
    state.sessionPage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
}
function renderProfiles(data) {
  const items = data.items || [];
  const rendered = items.length > 0
    ? items.map(item => `
      <div class="list-item profile-list-item">
        <div class="session-list-head">
          <div class="session-list-title">
            <h3>${escapeHtml(item.userName || item.userId || '未知用户')}</h3>
            <div class="setting-help">${escapeHtml(item.sessionId || '未知会话')} / 用户 ${escapeHtml(item.userId || '暂无')}</div>
          </div>
          <div class="detail-tags session-list-tags">
            <span class="detail-tag tone-success">置信度 ${escapeHtml(String(item.confidence ?? 0))}</span>
            <span class="detail-tag">消息 ${escapeHtml(String(item.sourceMessageCount ?? 0))}</span>
          </div>
        </div>
        <div class="session-preview-block">
          <div class="session-preview-label">摘要</div>
          <div class="session-preview-text">${escapeHtml(item.summary || '暂无')}</div>
        </div>
        <div class="profile-tag-group">
          <div class="profile-tag-block">
            <div class="session-preview-label">特征</div>
            <div class="session-member-list">
              ${(item.traits || []).length > 0
                ? (item.traits || []).map(tag => `<span class="session-member-chip">${escapeHtml(tag)}</span>`).join('')
                : '<span class="active-filter-empty">暂无</span>'}
            </div>
          </div>
          <div class="profile-tag-block">
            <div class="session-preview-label">风格</div>
            <div class="session-member-list">
              ${(item.speakingStyle || []).length > 0
                ? (item.speakingStyle || []).map(tag => `<span class="session-member-chip">${escapeHtml(tag)}</span>`).join('')
                : '<span class="active-filter-empty">暂无</span>'}
            </div>
          </div>
          <div class="profile-tag-block">
            <div class="session-preview-label">话题</div>
            <div class="session-member-list">
              ${(item.notableTopics || []).length > 0
                ? (item.notableTopics || []).map(tag => `<span class="session-member-chip">${escapeHtml(tag)}</span>`).join('')
                : '<span class="active-filter-empty">暂无</span>'}
            </div>
          </div>
        </div>
        <div class="actions">
              <a class="link-btn" href="/session-debug.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">会话排查</a>
          <a class="link-btn" href="/profile-detail.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">详情</a>
          <button data-action="show-profile-detail" data-session-id="${escapeHtml(item.sessionId)}" data-user-id="${escapeHtml(item.userId)}">快速预览</button>
          <button class="danger" data-action="delete-profile" data-session-id="${escapeHtml(item.sessionId)}" data-user-id="${escapeHtml(item.userId)}">删除画像</button>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无画像</div>';
  document.getElementById('profile-list').innerHTML = rendered;
  renderPagination('profile-pagination', data.page, data.totalPages, page => {
    state.profilePage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
}

function renderProfileDetailPreview(data) {
  const profile = data?.profile;
  if (!profile) return '画像详情暂不可用';
  return [
    `用户：${profile.userName || profile.userId}`,
    `摘要：${profile.summary || '暂无'}`,
    `特征：${(profile.traits || []).join(', ') || '暂无'}`,
    `话题：${(profile.notableTopics || []).join(', ') || '暂无'}`,
  ].join('\n');
}
function renderAffinityHistoryPreview(data) {
  const current = data?.current;
  const first = data?.entries?.[0];
  return [
    current ? `当前分数：${current.score || 0}` : '暂无当前好感分数',
    first ? `最近变化：${first.delta ?? 0} / ${first.reason || '暂无'}` : '暂无好感历史记录',
  ].join('\n');
}
