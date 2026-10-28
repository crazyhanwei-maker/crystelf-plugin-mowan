(function () {
  const request = window.CrystelfRequest || {};
  const ui = window.CrystelfUi || {};
  const fetchJson = request.fetchJson;
  const postJson = request.postJson;
  const alertConsole = window.webConsoleAlert || (message => window.alert(message));
  const confirmConsole = window.webConsoleConfirm || (message => window.confirm(message));

  const state = {
    payload: null,
    tab: 'memories',
    editingId: null,
    distill: null,
    loading: false,
  };

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

  const KIND_LABELS = {
    fact: '事实',
    preference: '偏好',
    event: '事件',
    relationship: '关系',
    skill: '技能',
    knowledge: '知识',
  };
  const SOURCE_LABELS = {
    distiller: '自动提炼',
    distill: '手动提炼',
    manual: '手动添加',
    marker: '对话记忆',
  };

  function kindLabel(kind) {
    return KIND_LABELS[kind] || kind || '未知';
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || source || '未知';
  }

  function buildQuery() {
    const params = new URLSearchParams();
    const sessionId = getElement('memory-filter-session').value.trim();
    const userId = getElement('memory-filter-user').value.trim();
    const query = getElement('memory-filter-query').value.trim();
    const kind = getElement('memory-filter-kind').value;
    const source = getElement('memory-filter-source').value;
    const includeDisabled = getElement('memory-filter-disabled').checked;
    if (sessionId) params.set('sessionId', sessionId);
    if (userId) params.set('userId', userId);
    if (query) params.set('query', query);
    if (kind) params.set('kind', kind);
    if (source) params.set('source', source);
    if (includeDisabled) params.set('includeDisabled', '1');
    return params.toString();
  }

  async function refresh(options = {}) {
    if (state.loading) return;
    state.loading = true;
    const status = getElement('refresh-status');
    if (status && !options.quiet) status.textContent = '正在刷新...';
    try {
      const query = buildQuery();
      const payload = await fetchJson(`/api/memory-library${query ? `?${query}` : ''}`);
      if (!payload?.success) throw new Error(payload?.error || '读取记忆数据失败');
      state.payload = payload;
      renderAll();
      if (status) status.textContent = `已更新 ${formatTime(new Date().toISOString())}`;
    } catch (error) {
      if (status) status.textContent = `刷新失败：${error.message}`;
      if (!options.quiet) await alertConsole(`读取记忆数据失败：${error.message}`);
    } finally {
      state.loading = false;
    }
  }

  function renderAll() {
    renderPageMeta();
    renderStats();
    renderApplied();
    renderSessions();
    renderMemories();
    renderArtifacts();
  }

  function renderPageMeta() {
    const payload = state.payload;
    const meta = getElement('page-meta');
    if (!meta || !payload) return;
    const memoryCount = payload.items?.length || 0;
    const artifactCount = payload.artifacts?.length || 0;
    meta.textContent = `当前筛选 ${formatNumber(memoryCount)} 条记忆 · 共 ${formatNumber(payload.stats?.total || 0)} 条 · ${formatNumber(artifactCount)} 个人设/技能产物`;
  }

  function renderStats() {
    const container = getElement('memory-stats');
    if (!container || !state.payload) return;
    const stats = state.payload.stats || {};
    const byKind = stats.byKind || {};
    const bySource = stats.bySource || {};
    const cards = [
      { label: '记忆总数', value: stats.total || 0 },
      { label: '已停用', value: stats.disabled || 0 },
      { label: `自动提炼`, value: bySource.distiller || 0 },
      { label: `手动添加`, value: (bySource.manual || 0) + (bySource.marker || 0) },
      { label: `偏好`, value: byKind.preference || 0 },
      { label: `事件/约定`, value: byKind.event || 0 },
      { label: `知识`, value: byKind.knowledge || 0 },
    ];
    container.innerHTML = cards.map(card => `
      <div class="memory-stat-card">
        <span>${escapeHtml(card.label)}</span>
        <strong>${formatNumber(card.value)}</strong>
      </div>
    `).join('');
  }

  function renderApplied() {
    const container = getElement('applied-state');
    if (!container || !state.payload) return;
    const applied = state.payload.applied || {};
    const persona = applied.persona || {};
    const zcode = applied.zcodeInstructions || {};
    container.innerHTML = `
      <span class="memory-applied-chip" title="${escapeHtml(persona.preview || '')}">
        聊天人设：${escapeHtml(persona.name || '未应用')}
      </span>
      <span class="memory-applied-chip" title="${escapeHtml(zcode.preview || '')}">
        ZCode 指令：${zcode.length ? `${formatNumber(zcode.length)} 字` : '未应用'}
      </span>
    `;
  }

  function renderSessions() {
    const list = getElement('memory-session-list');
    if (!list || !state.payload) return;
    const sessions = state.payload.sessions || [];
    list.innerHTML = sessions.map(session => {
      const label = session.type === 'private' ? '私聊' : '群聊';
      return `<option value="${escapeHtml(session.id)}">${escapeHtml(`${session.id}（${label} ${session.targetId || ''}）`)}</option>`;
    }).join('');
  }

  function renderMemories() {
    const container = getElement('memory-list');
    const meta = getElement('memory-list-meta');
    if (!container || !state.payload) return;
    const items = state.payload.items || [];
    if (meta) meta.textContent = `当前筛选 ${formatNumber(items.length)} 条记忆`;
    if (items.length === 0) {
      container.innerHTML = renderEmpty('没有匹配的记忆', '换一个会话或关键词试试，也可以在上方手动添加一条。');
      return;
    }
    container.innerHTML = items.map(item => `
      <div class="list-item memory-list-item${item.disabled ? ' is-disabled' : ''}" data-memory-id="${item.id}">
        <div class="memory-list-head">
          <div class="memory-list-content">${escapeHtml(item.content)}</div>
          <span class="detail-tag">${escapeHtml(kindLabel(item.kind))}</span>
        </div>
        <div class="memory-list-meta">
          <span>${escapeHtml(item.sessionId === 'global' ? '全局知识' : (item.sessionId || '未知会话'))}</span>
          <span>${escapeHtml(item.sessionId === 'global' ? '知识条目' : (item.userName || item.userId || '群级记忆'))}</span>
          <span>${escapeHtml(sourceLabel(item.source))}</span>
          <span>重要度 ${formatNumber(item.importance || 3)}</span>
          <span>${escapeHtml(formatTime(item.updatedAt || item.createdAt))}</span>
          ${(item.tags || []).map(tag => `<span class="memory-tag">${escapeHtml(tag)}</span>`).join('')}
          ${item.disabled ? '<span class="memory-tag">已停用</span>' : ''}
        </div>
        <div class="actions">
          <button type="button" data-action="edit-memory" data-memory-id="${item.id}">编辑</button>
          <button type="button" data-action="toggle-memory" data-memory-id="${item.id}">${item.disabled ? '启用' : '停用'}</button>
          <button type="button" class="danger" data-action="delete-memory" data-memory-id="${item.id}">删除</button>
        </div>
      </div>
    `).join('');
  }

  function renderArtifacts() {
    const container = getElement('artifact-list');
    if (!container || !state.payload) return;
    const artifacts = state.payload.artifacts || [];
    if (artifacts.length === 0) {
      container.innerHTML = renderEmpty('还没有人设或技能产物', '在「从聊天提炼」里生成人设卡或技能，保存后会出现在这里。');
      return;
    }
    container.innerHTML = artifacts.map(artifact => `
      <div class="list-item memory-list-item memory-artifact-item" data-artifact-id="${artifact.id}">
        <div class="memory-list-head">
          <div>
            <div class="memory-list-content">${escapeHtml(artifact.name || artifact.id)}</div>
            <div class="setting-help">${escapeHtml(artifact.preview || '')}</div>
          </div>
          <span class="memory-artifact-type">${artifact.type === 'persona' ? '人设卡' : '技能'}</span>
        </div>
        <div class="memory-list-meta">
          <span>${escapeHtml(artifact.sessionId || '未绑定会话')}</span>
          <span>${escapeHtml(formatTime(artifact.updatedAt || artifact.createdAt))}</span>
        </div>
        <div class="actions">
          <button type="button" data-action="view-artifact" data-artifact-id="${artifact.id}">查看</button>
          <button type="button" data-action="apply-artifact" data-artifact-id="${artifact.id}">${artifact.type === 'persona' ? '应用为人设' : '应用为 ZCode 指令'}</button>
          <button type="button" class="danger" data-action="delete-artifact" data-artifact-id="${artifact.id}">删除</button>
        </div>
      </div>
    `).join('');
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('[data-memory-tab]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.memoryTab === tab);
    });
    ['memories', 'distill', 'artifacts'].forEach(name => {
      const panel = getElement(`memory-tab-${name}`);
      if (panel) panel.classList.toggle('hidden', name !== tab);
    });
  }

  function resetMemoryForm() {
    state.editingId = null;
    getElement('memory-form-id').value = '';
    getElement('memory-form-session').value = getElement('memory-filter-session').value.trim();
    getElement('memory-form-user').value = '';
    getElement('memory-form-user-name').value = '';
    getElement('memory-form-kind').value = 'fact';
    getElement('memory-form-importance').value = '3';
    getElement('memory-form-tags').value = '';
    getElement('memory-form-content').value = '';
    getElement('memory-form-title').textContent = '添加记忆';
    getElement('memory-form-submit').textContent = '添加记忆';
    updateSessionPlaceholder();
  }

  function updateSessionPlaceholder() {
    const kind = getElement('memory-form-kind').value;
    getElement('memory-form-session').placeholder = kind === 'knowledge'
      ? '留空 = 全局知识（所有会话可检索）'
      : '会话，例如 group:123456';
  }

  async function importKnowledge() {
    if (!await confirmConsole('把旧知识库（ai.knowledgeBase）导入为全局知识条目？重复内容会自动跳过，旧配置不会被删除。', { title: '导入旧知识库', confirmText: '导入' })) return;
    const button = getElement('knowledge-import-btn');
    button.disabled = true;
    try {
      const result = await postJson('/api/memory-library/knowledge/import', {});
      const detail = result.total === 0
        ? (result.message || '旧知识库为空。')
        : `新增 ${formatNumber(result.imported || 0)} 条，跳过重复 ${formatNumber(result.skipped || 0)} 条（共 ${formatNumber(result.total || 0)} 条）。`;
      await alertConsole(`导入完成：${detail}`);
      if ((result.imported || 0) > 0) {
        getElement('memory-filter-kind').value = 'knowledge';
        await refresh({ quiet: true });
      }
    } catch (error) {
      await alertConsole(`导入失败：${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  function startEditMemory(id) {
    const item = (state.payload?.items || []).find(memory => String(memory.id) === String(id));
    if (!item) return;
    state.editingId = item.id;
    getElement('memory-form-id').value = String(item.id);
    getElement('memory-form-session').value = item.sessionId || '';
    getElement('memory-form-user').value = item.userId || '';
    getElement('memory-form-user-name').value = item.userName || '';
    getElement('memory-form-kind').value = item.kind || 'fact';
    getElement('memory-form-importance').value = String(item.importance || 3);
    getElement('memory-form-tags').value = (item.tags || []).join(', ');
    getElement('memory-form-content').value = item.content || '';
    getElement('memory-form-title').textContent = '编辑记忆';
    getElement('memory-form-submit').textContent = '保存修改';
    getElement('memory-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submitMemory(event) {
    event.preventDefault();
    const id = getElement('memory-form-id').value;
    const payload = {
      sessionId: getElement('memory-form-session').value.trim(),
      userId: getElement('memory-form-user').value.trim(),
      userName: getElement('memory-form-user-name').value.trim(),
      kind: getElement('memory-form-kind').value,
      importance: Number(getElement('memory-form-importance').value || 3),
      tags: getElement('memory-form-tags').value.split(/[,，\s]+/).filter(Boolean),
      content: getElement('memory-form-content').value.trim(),
    };
    if (!payload.content) {
      await alertConsole('记忆内容不能为空。');
      return;
    }
    if (!payload.sessionId && payload.kind !== 'knowledge') {
      await alertConsole('会话不能为空；只有「知识」类型可以留空（默认全局）。');
      return;
    }
    try {
      if (id) {
        await postJson('/api/memory-library/memories/update', { id, ...payload });
      } else {
        await postJson('/api/memory-library/memories/add', payload);
      }
      resetMemoryForm();
      await refresh({ quiet: true });
    } catch (error) {
      await alertConsole(`保存记忆失败：${error.message}`);
    }
  }

  async function handleMemoryAction(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.memoryId;
    if (!id) return;
    if (action === 'edit-memory') {
      startEditMemory(id);
      return;
    }
    if (action === 'toggle-memory') {
      const item = (state.payload?.items || []).find(memory => String(memory.id) === String(id));
      if (!item) return;
      try {
        await postJson('/api/memory-library/memories/update', { id, disabled: !item.disabled });
        await refresh({ quiet: true });
      } catch (error) {
        await alertConsole(`更新记忆失败：${error.message}`);
      }
      return;
    }
    if (action === 'delete-memory') {
      if (!await confirmConsole('确定删除这条记忆吗？删除后不会再参与聊天检索。', { title: '删除记忆', confirmText: '删除' })) return;
      try {
        await postJson('/api/memory-library/memories/delete', { id });
        if (String(state.editingId) === String(id)) resetMemoryForm();
        await refresh({ quiet: true });
      } catch (error) {
        await alertConsole(`删除记忆失败：${error.message}`);
      }
    }
  }

  async function runDistill(event) {
    event.preventDefault();
    const type = getElement('distill-type').value;
    const payload = {
      sessionId: getElement('distill-session').value.trim(),
      type,
      targetName: getElement('distill-target').value.trim(),
      userId: getElement('distill-user').value.trim(),
      limit: Number(getElement('distill-limit').value || 300),
    };
    if (!payload.sessionId) {
      await alertConsole('请先填写要提炼的会话。');
      return;
    }
    const status = getElement('distill-status');
    const submit = getElement('distill-submit');
    submit.disabled = true;
    status.textContent = type === 'memories' ? '正在提炼长期记忆...' : `正在提炼${type === 'persona' ? '人设卡' : '技能'}...`;
    getElement('distill-output-wrap').classList.add('hidden');
    getElement('distill-memories').classList.add('hidden');
    try {
      const result = await postJson(`/api/memory-library/distill/${type}`, payload);
      if (!result?.success) throw new Error(result?.error || '提炼失败');
      if (type === 'memories') {
        const entries = result.entries || [];
        status.textContent = `提炼完成：${entries.length} 条记忆已写入（可在记忆库中查看/编辑）。`;
        const container = getElement('distill-memories');
        container.classList.remove('hidden');
        container.innerHTML = entries.length
          ? entries.map(entry => `
            <div class="memory-list-item">
              <div class="memory-list-content">${escapeHtml(entry.content)}</div>
              <div class="memory-list-meta">
                <span>${escapeHtml(kindLabel(entry.kind))}</span>
                <span>重要度 ${formatNumber(entry.importance || 3)}</span>
                ${(entry.tags || []).map(tag => `<span class="memory-tag">${escapeHtml(tag)}</span>`).join('')}
              </div>
            </div>
          `).join('')
          : renderEmpty('没有提炼出长期记忆', '这段聊天可能以寒暄为主，换个范围再试。');
        await refresh({ quiet: true });
      } else {
        const content = String(result.content || '').trim();
        state.distill = {
          type,
          content,
          name: result.suggestedName || (type === 'persona' ? '未命名人设卡' : '未命名技能'),
          sessionId: payload.sessionId,
          userId: payload.userId || '',
          userName: payload.targetName || '',
        };
        status.textContent = '提炼完成，请检查内容后保存。';
        const wrap = getElement('distill-output-wrap');
        wrap.classList.remove('hidden');
        getElement('distill-artifact-name').value = state.distill.name;
        getElement('distill-output').value = content;
      }
    } catch (error) {
      status.textContent = `提炼失败：${error.message}`;
      await alertConsole(`提炼失败：${error.message}`);
    } finally {
      submit.disabled = false;
    }
  }

  async function saveDistillArtifact() {
    if (!state.distill) {
      await alertConsole('请先提炼内容。');
      return;
    }
    const content = getElement('distill-output').value.trim();
    if (!content) {
      await alertConsole('产物内容不能为空。');
      return;
    }
    if (state.distill.type === 'memories') return;
    try {
      await postJson('/api/memory-library/artifacts/save', {
        type: state.distill.type,
        name: getElement('distill-artifact-name').value.trim() || state.distill.name,
        content,
        sessionId: state.distill.sessionId,
        userId: state.distill.userId,
        userName: state.distill.userName,
      });
      await refresh({ quiet: true });
      switchTab('artifacts');
    } catch (error) {
      await alertConsole(`保存产物失败：${error.message}`);
    }
  }

  async function copyDistillOutput() {
    const content = getElement('distill-output').value;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      getElement('distill-output').select();
      document.execCommand('copy');
    }
  }

  async function viewArtifact(id) {
    try {
      const result = await postJson('/api/memory-library/artifacts/get', { id });
      if (!result?.artifact) throw new Error('产物不存在');
      const artifact = result.artifact;
      getElement('artifact-preview-panel').classList.remove('hidden');
      getElement('artifact-preview-title').textContent = `${artifact.type === 'persona' ? '人设卡' : '技能'}：${artifact.name}`;
      getElement('artifact-preview-meta').textContent = `会话 ${artifact.sessionId || '未绑定'} · 更新于 ${formatTime(artifact.updatedAt || artifact.createdAt)}`;
      getElement('artifact-preview').textContent = artifact.content || '';
    } catch (error) {
      await alertConsole(`读取产物失败：${error.message}`);
    }
  }

  async function applyArtifact(id) {
    const artifact = (state.payload?.artifacts || []).find(item => String(item.id) === String(id));
    if (!artifact) return;
    const label = artifact.type === 'persona' ? '应用为聊天人设卡（只补充语气/习惯，不覆盖基础身份）' : '追加到 ZCode 自定义指令';
    if (!await confirmConsole(`确定把「${artifact.name}」${label}吗？`, { title: '应用产物', confirmText: '应用' })) return;
    try {
      await postJson('/api/memory-library/artifacts/apply', { id });
      await refresh({ quiet: true });
      await alertConsole('已应用。人设卡只补充表达风格，下一轮聊天生效；ZCode 指令会在下一次任务启动时生效。');
    } catch (error) {
      await alertConsole(`应用产物失败：${error.message}`);
    }
  }

  async function deleteArtifact(id) {
    if (!await confirmConsole('确定删除这个产物吗？删除后无法恢复。', { title: '删除产物', confirmText: '删除' })) return;
    try {
      await postJson('/api/memory-library/artifacts/delete', { id });
      getElement('artifact-preview-panel').classList.add('hidden');
      await refresh({ quiet: true });
    } catch (error) {
      await alertConsole(`删除产物失败：${error.message}`);
    }
  }

  function handleArtifactAction(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const id = target.dataset.artifactId;
    if (!id) return;
    if (target.dataset.action === 'view-artifact') viewArtifact(id);
    if (target.dataset.action === 'apply-artifact') applyArtifact(id);
    if (target.dataset.action === 'delete-artifact') deleteArtifact(id);
  }

  function bindEvents() {
    document.querySelectorAll('[data-memory-tab]').forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.memoryTab));
    });
    getElement('refresh-btn').addEventListener('click', () => refresh());
    getElement('memory-filter-btn').addEventListener('click', () => refresh());
    getElement('memory-filter-query').addEventListener('keydown', event => {
      if (event.key === 'Enter') refresh();
    });
    getElement('memory-filter-session').addEventListener('keydown', event => {
      if (event.key === 'Enter') refresh();
    });
    getElement('memory-filter-user').addEventListener('keydown', event => {
      if (event.key === 'Enter') refresh();
    });
    getElement('memory-form-kind').addEventListener('change', updateSessionPlaceholder);
    getElement('knowledge-import-btn').addEventListener('click', importKnowledge);
    getElement('memory-form').addEventListener('submit', submitMemory);
    getElement('memory-form-reset').addEventListener('click', () => resetMemoryForm());
    getElement('memory-list').addEventListener('click', handleMemoryAction);
    getElement('distill-form').addEventListener('submit', runDistill);
    getElement('distill-save-artifact').addEventListener('click', saveDistillArtifact);
    getElement('distill-copy').addEventListener('click', copyDistillOutput);
    getElement('artifact-list').addEventListener('click', handleArtifactAction);
    getElement('artifact-preview-close').addEventListener('click', () => getElement('artifact-preview-panel').classList.add('hidden'));
  }

  // 支持 /data-insight.html 带参跳转：?sessionId=&userId=&query=&kind=
  function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const map = {
      sessionId: 'memory-filter-session',
      userId: 'memory-filter-user',
      query: 'memory-filter-query',
      kind: 'memory-filter-kind',
    };
    for (const [param, elementId] of Object.entries(map)) {
      const value = String(params.get(param) || '').trim();
      if (!value) continue;
      const element = getElement(elementId);
      if (element) element.value = value;
    }
    updateSessionPlaceholder();
  }

  bindEvents();
  applyUrlParams();
  resetMemoryForm();
  refresh();
})();