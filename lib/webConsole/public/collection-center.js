const PAGE_CONFIGS = {
  sessions: {
    title: '最近会话',
    endpoint: '/api/sessions',
    loadingText: '正在刷新最近会话...',
    filterParams: ['query', 'sessionId', 'userId'],
    buildMeta: data => `最近会话 ${formatNumber(data.total || 0)} 条，当前第 ${formatNumber(data.page || 1)} / ${formatNumber(data.totalPages || 1)} 页`,
    renderList(data) {
      const items = data.items || [];
      document.getElementById('collection-list').innerHTML = items.length > 0
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
              <a class="link-btn" href="/session-debug.html?sessionId=${encodeURIComponent(item.sessionId)}">会话调试</a>
              <button data-action="reset-session-messages" data-session-id="${escapeHtml(item.sessionId)}">清空消息</button>
              <button class="danger" data-action="reset-session" data-session-id="${escapeHtml(item.sessionId)}">重置会话</button>
            </div>
          </div>
        `).join('')
        : '<div class="list-item">暂无会话记录</div>';
    },
  },
  affinity: {
    title: '好感度 Top',
    endpoint: '/api/affinity',
    loadingText: '正在刷新好感度记录...',
    filterParams: ['query', 'groupId'],
    buildMeta: data => `好感记录 ${formatNumber(data.total || 0)} 条，当前第 ${formatNumber(data.page || 1)} / ${formatNumber(data.totalPages || 1)} 页`,
    renderList(data) {
      const items = data.items || [];
      document.getElementById('collection-list').innerHTML = items.length > 0
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
    },
  },
  profiles: {
    title: '用户画像',
    endpoint: '/api/profiles',
    loadingText: '正在刷新用户画像...',
    filterParams: ['query', 'sessionId'],
    buildMeta: data => `用户画像 ${formatNumber(data.total || 0)} 条，当前第 ${formatNumber(data.page || 1)} / ${formatNumber(data.totalPages || 1)} 页`,
    renderList(data) {
      const items = data.items || [];
      document.getElementById('collection-list').innerHTML = items.length > 0
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
              ${renderTagBlock('特征', item.traits)}
              ${renderTagBlock('风格', item.speakingStyle)}
              ${renderTagBlock('话题', item.notableTopics)}
            </div>
            <div class="actions">
              <a class="link-btn" href="/session-debug.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">会话调试</a>
              <a class="link-btn" href="/profile-detail.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">详情</a>
              <button data-action="show-profile-detail" data-session-id="${escapeHtml(item.sessionId)}" data-user-id="${escapeHtml(item.userId)}">快速预览</button>
              <button class="danger" data-action="delete-profile" data-session-id="${escapeHtml(item.sessionId)}" data-user-id="${escapeHtml(item.userId)}">删除画像</button>
            </div>
          </div>
        `).join('')
        : '<div class="list-item">暂无用户画像</div>';
    },
  },
};

const pageType = document.body.dataset.collectionPage || '';
const pageConfig = PAGE_CONFIGS[pageType];
const state = { page: 1, refreshPromise: null, filterRefreshTimer: null };

function getAuthToken() {
  return localStorage.getItem('crystelf-web-console-token') || '';
}

function buildHeaders(extra = {}) {
  const token = getAuthToken().trim();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: Number.isInteger(number) ? 0 : 2 }).format(number);
}

function renderTagBlock(title, items) {
  return `
    <div class="profile-tag-block">
      <div class="session-preview-label">${title}</div>
      <div class="session-member-list">
        ${(items || []).length > 0
          ? (items || []).map(tag => `<span class="session-member-chip">${escapeHtml(tag)}</span>`).join('')
          : '<span class="active-filter-empty">暂无</span>'}
      </div>
    </div>
  `;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store', headers: buildHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `${url} -> ${response.status}`);
  return data;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `${url} -> ${response.status}`);
  return data;
}

function setMeta(text) {
  document.getElementById('page-meta').textContent = text;
}

function setRefreshStatus(text, tone = 'neutral') {
  const el = document.getElementById('refresh-status');
  el.textContent = text;
  el.className = tone === 'error' ? 'setting-error' : 'setting-help';
}

function setRefreshButtonState(isRefreshing) {
  const button = document.getElementById('refresh-btn');
  if (!button) return;
  button.disabled = isRefreshing;
  button.textContent = isRefreshing ? '刷新中...' : '刷新列表';
}

function getFilters() {
  return [
    document.getElementById('collection-search')?.value?.trim() || '',
    document.getElementById('collection-filter-a')?.value?.trim() || '',
    document.getElementById('collection-filter-b')?.value?.trim() || '',
  ];
}

function renderSummary(data, filters) {
  const activeFilters = filters.filter(Boolean).length;
  document.getElementById('collection-summary').innerHTML = [
    '<div class="config-summary-grid">',
    `<div class="config-summary-card"><h3>记录概览</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">总数</span><span class="config-summary-value">${formatNumber(data.total || 0)}</span></div><div class="config-summary-row"><span class="config-summary-label">每页</span><span class="config-summary-value">${formatNumber(data.pageSize || 20)}</span></div></div></div>`,
    `<div class="config-summary-card"><h3>分页状态</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">当前页</span><span class="config-summary-value">${formatNumber(data.page || 1)}</span></div><div class="config-summary-row"><span class="config-summary-label">总页数</span><span class="config-summary-value">${formatNumber(data.totalPages || 1)}</span></div></div></div>`,
    `<div class="config-summary-card"><h3>筛选状态</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">生效条件</span><span class="config-summary-value">${formatNumber(activeFilters)}</span></div><div class="config-summary-row"><span class="config-summary-label">检索词</span><span class="config-summary-value">${escapeHtml(filters[0] || '未设置')}</span></div></div></div>`,
    '</div>',
  ].join('');
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
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  container.innerHTML = [
    `<button data-page="${Math.max(1, page - 1)}">上一页</button>`,
    ...pages.map(item => item === '...'
      ? '<span class="page-ellipsis">...</span>'
      : `<button class="${item === page ? 'active' : ''}" data-page="${item}">${item}</button>`),
    `<button data-page="${Math.min(totalPages, page + 1)}">下一页</button>`,
  ].join('');
  container.querySelectorAll('button[data-page]').forEach(button => {
    button.addEventListener('click', () => onPageChange(Number(button.dataset.page)));
  });
}

function scheduleRefresh(delay = 260) {
  if (state.filterRefreshTimer) clearTimeout(state.filterRefreshTimer);
  state.filterRefreshTimer = setTimeout(() => {
    state.filterRefreshTimer = null;
    refreshCollection().catch(error => window.alert(error.message));
  }, delay);
}

function resetFilters() {
  ['collection-search', 'collection-filter-a', 'collection-filter-b'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  state.page = 1;
}

async function refreshCollection() {
  if (!pageConfig) throw new Error('未识别的集合页面类型');
  if (state.refreshPromise) return state.refreshPromise;

  const filters = getFilters();
  const params = new URLSearchParams({ page: String(state.page || 1) });
  pageConfig.filterParams.forEach((param, index) => {
    if (filters[index]) params.set(param, filters[index]);
  });

  setRefreshStatus(pageConfig.loadingText, 'neutral');
  setRefreshButtonState(true);
  state.refreshPromise = (async () => {
    try {
      const data = await fetchJson(`${pageConfig.endpoint}?${params.toString()}`);
      pageConfig.renderList(data);
      renderSummary(data, filters);
      renderPagination('collection-pagination', data.page, data.totalPages, page => {
        state.page = page;
        refreshCollection().catch(error => window.alert(error.message));
      });
      setMeta(pageConfig.buildMeta(data));
      setRefreshStatus(`最近刷新：${formatTime(Date.now())}`, 'neutral');
      return data;
    } catch (error) {
      setMeta(`${pageConfig.title}加载失败`);
      setRefreshStatus(`${pageConfig.title}加载失败：${error.message}`, 'error');
      throw error;
    } finally {
      state.refreshPromise = null;
      setRefreshButtonState(false);
    }
  })();

  return state.refreshPromise;
}

async function handleAction(target) {
  if (target.dataset.action === 'show-affinity-history') {
    const data = await fetchJson(`/api/affinity-history?groupId=${encodeURIComponent(target.dataset.groupId || '')}&userId=${encodeURIComponent(target.dataset.userId || '')}`);
    const lines = [data?.current ? `当前分数：${data.current.score || 0}` : '暂无当前好感分数', ...(data?.entries || []).slice(0, 6).map(item => `${formatTime(item.updated_at || item.time)} / ${item.delta ?? 0} / ${item.reason || '暂无原因'}`)];
    window.alert(lines.join('\n'));
    return;
  }
  if (target.dataset.action === 'reset-affinity') {
    if (!window.confirm(`确认重置 ${target.dataset.groupId} / ${target.dataset.userId} 的好感数据？`)) return;
    await postJson('/api/affinity/reset', { groupId: target.dataset.groupId, userId: target.dataset.userId });
    await refreshCollection();
    return;
  }
  if (target.dataset.action === 'show-profile-detail') {
    const data = await fetchJson(`/api/profile-detail?sessionId=${encodeURIComponent(target.dataset.sessionId || '')}&userId=${encodeURIComponent(target.dataset.userId || '')}`);
    const profile = data?.profile;
    window.alert([
      `用户：${profile?.userName || profile?.userId || '未知'}`,
      `摘要：${profile?.summary || '暂无'}`,
      `特征：${(profile?.traits || []).join('、') || '暂无'}`,
      `风格：${(profile?.speakingStyle || []).join('、') || '暂无'}`,
      `话题：${(profile?.notableTopics || []).join('、') || '暂无'}`,
    ].join('\n'));
    return;
  }
  if (target.dataset.action === 'delete-profile') {
    if (!window.confirm(`确认删除画像 ${target.dataset.sessionId} / ${target.dataset.userId}？`)) return;
    await postJson('/api/profiles/delete', { sessionId: target.dataset.sessionId, userId: target.dataset.userId });
    await refreshCollection();
    return;
  }
  if (target.dataset.action === 'reset-session') {
    if (!window.confirm(`确认重置会话 ${target.dataset.sessionId}？这会清空消息和相关状态。`)) return;
    await postJson('/api/sessions/reset', { sessionId: target.dataset.sessionId });
    await refreshCollection();
    return;
  }
  if (target.dataset.action === 'reset-session-messages') {
    if (!window.confirm(`确认只清空会话 ${target.dataset.sessionId} 的消息记录？`)) return;
    await postJson('/api/sessions/reset', { sessionId: target.dataset.sessionId, mode: 'messages_only' });
    await refreshCollection();
  }
}

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.dataset.action) return;
  handleAction(target).catch(error => window.alert(error.message));
});

document.addEventListener('DOMContentLoaded', () => {
  if (!pageConfig) {
    document.body.innerHTML = '<pre>未识别的集合页面类型</pre>';
    return;
  }

  const tokenInput = document.getElementById('auth-token');
  if (tokenInput) {
    tokenInput.value = getAuthToken();
  }
  setRefreshButtonState(false);

  document.getElementById('save-token-btn')?.addEventListener('click', () => {
    localStorage.setItem('crystelf-web-console-token', tokenInput?.value.trim() || '');
    refreshCollection().catch(error => window.alert(error.message));
  });
  document.getElementById('refresh-btn').addEventListener('click', () => {
    refreshCollection().catch(error => window.alert(error.message));
  });
  document.getElementById('clear-filters-btn').addEventListener('click', () => {
    resetFilters();
    refreshCollection().catch(error => window.alert(error.message));
  });
  ['collection-search', 'collection-filter-a', 'collection-filter-b'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      state.page = 1;
      scheduleRefresh();
    });
  });

  refreshCollection().catch(error => {
    document.body.innerHTML = `<pre>${pageConfig.title}初始化失败：${escapeHtml(error.message)}</pre>`;
  });
});
