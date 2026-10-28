(function () {
  const request = window.CrystelfRequest || {};
  const ui = window.CrystelfUi || {};
  const fetchJson = request.fetchJson;
  const alertConsole = window.webConsoleAlert || (message => window.alert(message));

  const state = {
    tab: 'sessions',
    loading: false,
  };

  const TAB_IDS = ['sessions', 'profiles', 'affinity', 'memory'];
  const LEVEL_LABELS = { close: '亲密', warm: '友好', neutral: '一般', cold: '冷淡' };

  function escapeHtml(value) {
    if (typeof ui.escapeHtml === 'function') return ui.escapeHtml(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getElement(id) {
    return document.getElementById(id);
  }

  function formatTime(value) {
    if (!value) return '暂无';
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return String(value);
    return `${String(time.getMonth() + 1).padStart(2, '0')}/${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
  }

  function renderEmpty(title, detail = '') {
    if (typeof ui.renderEmptyState === 'function') return ui.renderEmptyState(title, detail);
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><div class="setting-help">${escapeHtml(detail)}</div></div>`;
  }

  function truncate(text, limit = 160) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
  }

  function normalizeSessionInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(group|private):/.test(raw)) return raw;
    if (/^\d+$/.test(raw)) return `group:${raw}`;
    return raw;
  }

  function groupOnly(sessionId) {
    return String(sessionId || '').replace(/^group:/, '');
  }

  function readFilters() {
    return {
      sessionId: normalizeSessionInput(getElement('insight-filter-session').value),
      userId: getElement('insight-filter-user').value.trim(),
      query: getElement('insight-filter-query').value.trim(),
    };
  }

  function userChip(userId, userName) {
    if (!userId && !userName) return '';
    return `<button type="button" class="insight-user-chip" data-insight-user="${escapeHtml(userId || userName)}" title="设为筛选：${escapeHtml(userName || userId)}">👤 ${escapeHtml(userName || userId)}</button>`;
  }

  function buildQuery(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && String(value) !== '') search.set(key, String(value));
    }
    return search.toString();
  }

  function updateOpenLinks(filters) {
    const memoryParams = buildQuery({ sessionId: filters.sessionId, userId: filters.userId, query: filters.query });
    getElement('insight-open-sessions').href = `/session-center.html${filters.sessionId ? `?sessionId=${encodeURIComponent(filters.sessionId)}` : ''}`;
    getElement('insight-open-profiles').href = `/profile-center.html${filters.sessionId ? `?sessionId=${encodeURIComponent(filters.sessionId)}` : ''}`;
    getElement('insight-open-affinity').href = `/affinity-center.html${groupOnly(filters.sessionId) ? `?groupId=${encodeURIComponent(groupOnly(filters.sessionId))}` : ''}`;
    getElement('insight-open-memory').href = `/memory-center.html${memoryParams ? `?${memoryParams}` : ''}`;
  }

  function setStatus(text) {
    getElement('insight-status').textContent = text;
  }

  function bindUserChips(container) {
    container.querySelectorAll('[data-insight-user]').forEach(chip => {
      chip.addEventListener('click', () => {
        getElement('insight-filter-user').value = chip.dataset.insightUser || '';
        refreshCurrent();
      });
    });
  }

  // ── 最近会话 ──
  async function loadSessions(filters) {
    const container = getElement('insight-sessions');
    const data = await fetchJson(`/api/sessions?${buildQuery({
      sessionId: filters.sessionId,
      userId: filters.userId,
      query: filters.query,
      page: 1,
      pageSize: 20,
    })}`);
    const items = data?.items || [];
    container.innerHTML = items.length === 0
      ? renderEmpty('没有匹配的会话', '清空筛选或发几条消息后再试。')
      : items.map(item => `
        <div class="list-item memory-list-item">
          <div class="memory-list-head">
            <div>
              <div class="memory-list-content">${escapeHtml(item.sessionId)}</div>
              <div class="setting-help">目标 ${escapeHtml(item.targetId || '无')} · ${escapeHtml(item.type || 'unknown')}</div>
            </div>
            <span class="detail-tag">${item.hasFallback ? '触发兜底' : '正常'}</span>
          </div>
          <div class="memory-list-meta">
            <span>消息 ${formatNumber(item.messageCount)}</span>
            <span>用户 ${formatNumber(item.userMessageCount)} / Bot ${formatNumber(item.assistantMessageCount)}</span>
            <span>活跃于 ${escapeHtml(formatTime(item.lastMessageTime))}</span>
          </div>
          <div class="session-preview-block">
            <div class="session-preview-label">最近消息</div>
            <div class="session-preview-text">${escapeHtml(truncate(item.lastMessagePreview, 120) || '暂无')}</div>
          </div>
          <div class="memory-list-meta insight-participants">
            ${(item.participants || []).slice(0, 8).map(participant => userChip(participant.userId, participant.userName)).join('')}
            ${(item.participants || []).length > 8 ? `<span class="setting-help">+${formatNumber((item.participants || []).length - 8)} 人</span>` : ''}
          </div>
          <div class="actions">
            <a class="link-btn" href="/session-debug.html?sessionId=${encodeURIComponent(item.sessionId)}">会话排查</a>
            <button type="button" data-action="goto-memory" data-session-id="${escapeHtml(item.sessionId)}">看记忆</button>
          </div>
        </div>
      `).join('');
    bindUserChips(container);
    container.querySelectorAll('[data-action="goto-memory"]').forEach(button => {
      button.addEventListener('click', () => {
        getElement('insight-filter-session').value = button.dataset.sessionId || '';
        switchTab('memory');
        refreshCurrent();
      });
    });
  }

  // ── 用户画像 ──
  async function loadProfiles(filters) {
    const container = getElement('insight-profiles');
    const data = await fetchJson(`/api/profiles?${buildQuery({
      sessionId: filters.sessionId,
      query: filters.query,
      page: 1,
      pageSize: 20,
    })}`);
    const items = (data?.items || [])
      .filter(item => !filters.userId || String(item.userId) === String(filters.userId));
    container.innerHTML = items.length === 0
      ? renderEmpty('没有匹配的用户画像', '画像会随聊天自动沉淀，清空筛选再试。')
      : items.map(item => `
        <div class="list-item memory-list-item">
          <div class="memory-list-head">
            <div>
              <div class="memory-list-content">${escapeHtml(item.userName || item.userId || '未知用户')}</div>
              <div class="setting-help">${escapeHtml(item.sessionId || '')}</div>
            </div>
            <span class="detail-tag">${escapeHtml(item.confidence || 'unknown')}</span>
          </div>
          <div class="memory-list-content">${escapeHtml(truncate(item.summary, 140) || '暂无画像摘要')}</div>
          <div class="memory-list-meta">
            ${(item.traits || []).slice(0, 5).map(trait => `<span class="memory-tag">${escapeHtml(trait)}</span>`).join('')}
            <span>${escapeHtml(formatTime(item.updatedAt))}</span>
          </div>
          <div class="actions">
            <a class="link-btn" href="/profile-detail.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">画像详情</a>
            <button type="button" data-action="goto-memory" data-session-id="${escapeHtml(item.sessionId)}" data-user-id="${escapeHtml(item.userId || '')}">看记忆</button>
          </div>
        </div>
      `).join('');
    container.querySelectorAll('[data-action="goto-memory"]').forEach(button => {
      button.addEventListener('click', () => {
        getElement('insight-filter-session').value = button.dataset.sessionId || '';
        getElement('insight-filter-user').value = button.dataset.userId || '';
        switchTab('memory');
        refreshCurrent();
      });
    });
  }

  // ── 好感度 ──
  async function loadAffinity(filters) {
    const container = getElement('insight-affinity');
    const data = await fetchJson(`/api/affinity?${buildQuery({
      groupId: groupOnly(filters.sessionId),
      query: filters.query,
      page: 1,
      pageSize: 20,
    })}`);
    const items = (data?.items || [])
      .filter(item => !filters.userId || String(item.user_id) === String(filters.userId));
    container.innerHTML = items.length === 0
      ? renderEmpty('没有匹配的好感记录', '有互动记录后这里会自动出现。')
      : items.map(item => `
        <div class="list-item memory-list-item">
          <div class="memory-list-head">
            <div>
              <div class="memory-list-content">${escapeHtml(item.display_name || item.user_id || '未知用户')}</div>
              <div class="setting-help">群 ${escapeHtml(item.group_id || '暂无')} / 用户 ${escapeHtml(item.user_id || '暂无')}</div>
            </div>
            <span class="insight-level is-${escapeHtml(item.level || 'neutral')}">${escapeHtml(LEVEL_LABELS[item.level] || item.level || '一般')}</span>
          </div>
          <div class="memory-list-meta">
            <span>好感 ${formatNumber(item.score)}</span>
            <span>互动 ${formatNumber(item.interaction_count)}</span>
            <span>更新于 ${escapeHtml(formatTime(item.updated_at))}</span>
          </div>
          <div class="session-preview-block">
            <div class="session-preview-label">最近原因</div>
            <div class="session-preview-text">${escapeHtml(truncate(item.last_reason, 120) || '暂无')}</div>
          </div>
          <div class="actions">
            <a class="link-btn" href="/affinity-detail.html?groupId=${encodeURIComponent(item.group_id)}&userId=${encodeURIComponent(item.user_id)}">好感历史</a>
            <button type="button" data-action="goto-memory" data-session-id="group:${escapeHtml(item.group_id)}" data-user-id="${escapeHtml(item.user_id)}">看记忆</button>
          </div>
        </div>
      `).join('');
    container.querySelectorAll('[data-action="goto-memory"]').forEach(button => {
      button.addEventListener('click', () => {
        getElement('insight-filter-session').value = button.dataset.sessionId || '';
        getElement('insight-filter-user').value = button.dataset.userId || '';
        switchTab('memory');
        refreshCurrent();
      });
    });
  }

  // ── 记忆 ──
  async function loadMemory(filters) {
    const container = getElement('insight-memory');
    const data = await fetchJson(`/api/memory-library?${buildQuery({
      sessionId: filters.sessionId,
      userId: filters.userId,
      query: filters.query,
      limit: 20,
    })}`);
    const items = data?.items || [];
    container.innerHTML = items.length === 0
      ? renderEmpty('没有匹配的记忆', '在记忆与人设页可以添加或从聊天提炼。')
      : items.map(item => `
        <div class="list-item memory-list-item${item.disabled ? ' is-disabled' : ''}">
          <div class="memory-list-head">
            <div class="memory-list-content">${escapeHtml(item.content)}</div>
            <span class="detail-tag">${escapeHtml(item.kind || 'fact')}</span>
          </div>
          <div class="memory-list-meta">
            <span>${escapeHtml(item.sessionId === 'global' ? '全局知识' : (item.sessionId || '未知会话'))}</span>
            <span>${escapeHtml(item.userName || item.userId || '群级记忆')}</span>
            <span>${escapeHtml(item.source || '')}</span>
            <span>${escapeHtml(formatTime(item.updatedAt || item.createdAt))}</span>
            ${(item.tags || []).map(tag => `<span class="memory-tag">${escapeHtml(tag)}</span>`).join('')}
          </div>
          <div class="actions">
            ${item.userId ? `<a class="link-btn" href="/profile-detail.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">画像</a>` : ''}
            ${item.sessionId && item.sessionId !== 'global' && item.userId ? `<a class="link-btn" href="/affinity-detail.html?groupId=${encodeURIComponent(groupOnly(item.sessionId))}&userId=${encodeURIComponent(item.userId)}">好感</a>` : ''}
            <a class="link-btn" href="/memory-center.html?sessionId=${encodeURIComponent(item.sessionId || '')}&userId=${encodeURIComponent(item.userId || '')}&query=${encodeURIComponent(filters.query)}">编辑</a>
          </div>
        </div>
      `).join('');
  }

  const VIEW_LOADERS = {
    sessions: { container: 'insight-sessions', load: loadSessions },
    profiles: { container: 'insight-profiles', load: loadProfiles },
    affinity: { container: 'insight-affinity', load: loadAffinity },
    memory: { container: 'insight-memory', load: loadMemory },
  };

  async function loadView(name, filters) {
    const view = VIEW_LOADERS[name];
    if (!view) return;
    try {
      await view.load(filters);
    } catch (error) {
      const container = getElement(view.container);
      if (container) container.innerHTML = renderEmpty('加载失败', error.message);
    }
  }

  async function refreshCurrent(options = {}) {
    if (state.loading) return;
    state.loading = true;
    const filters = readFilters();
    updateOpenLinks(filters);
    if (!options.quiet) setStatus('正在刷新...');
    try {
      await loadView(state.tab, filters);
      setStatus(`已更新 ${formatTime(new Date().toISOString())}`);
    } catch (error) {
      setStatus(`刷新失败：${error.message}`);
      if (!options.quiet) await alertConsole(`读取数据失败：${error.message}`);
    } finally {
      state.loading = false;
    }
  }

  async function loadSessionOptions() {
    try {
      const data = await fetchJson('/api/sessions?page=1&pageSize=50');
      const items = data?.items || [];
      getElement('insight-session-list').innerHTML = items.map(item => {
        const label = item.type === 'private' ? '私聊' : '群聊';
        return `<option value="${escapeHtml(item.sessionId)}">${escapeHtml(`${item.sessionId}（${label} ${item.targetId || ''}）`)}</option>`;
      }).join('');
    } catch {
      // 会话建议加载失败不阻塞主流程
    }
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('[data-insight-tab]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.insightTab === tab);
    });
    TAB_IDS.forEach(name => {
      const panel = getElement(`insight-tab-${name}`);
      if (panel) panel.classList.toggle('hidden', name !== tab);
    });
  }

  function bindEvents() {
    document.querySelectorAll('[data-insight-tab]').forEach(button => {
      button.addEventListener('click', () => {
        switchTab(button.dataset.insightTab);
        refreshCurrent();
      });
    });
    getElement('insight-refresh-btn').addEventListener('click', () => refreshCurrent());
    getElement('insight-filter-apply').addEventListener('click', () => refreshCurrent());
    getElement('insight-filter-clear').addEventListener('click', () => {
      getElement('insight-filter-session').value = '';
      getElement('insight-filter-user').value = '';
      getElement('insight-filter-query').value = '';
      refreshCurrent();
    });
    ['insight-filter-session', 'insight-filter-user', 'insight-filter-query'].forEach(id => {
      getElement(id).addEventListener('keydown', event => {
        if (event.key === 'Enter') refreshCurrent();
      });
    });
  }

  // 支持 ?sessionId=&userId=&query=&tab= 直达
  function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = String(params.get('sessionId') || '').trim();
    const userId = String(params.get('userId') || '').trim();
    const query = String(params.get('query') || '').trim();
    const tab = String(params.get('tab') || '').trim();
    if (sessionId) getElement('insight-filter-session').value = sessionId;
    if (userId) getElement('insight-filter-user').value = userId;
    if (query) getElement('insight-filter-query').value = query;
    if (TAB_IDS.includes(tab)) switchTab(tab);
  }

  bindEvents();
  applyUrlParams();
  loadSessionOptions();
  // 首屏并行加载全部视图：避免隐藏 Tab 里残留“加载中”占位
  void (async () => {
    const filters = readFilters();
    updateOpenLinks(filters);
    await Promise.all(TAB_IDS.map(name => loadView(name, filters)));
    setStatus(`已更新 ${formatTime(new Date().toISOString())}`);
  })();
})();