const agentWorkbenchState = {
  payload: null,
  selectedTaskId: '',
  settingsDirty: false,
  initialized: false,
  refreshing: false,
  pollTimer: null,
};

const { fetchJson, postJson } = window.CrystelfRequest || {};
const ui = window.CrystelfUi || {};

function getElement(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  if (typeof ui.escapeHtml === 'function') return ui.escapeHtml(value);
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(ms = 0) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain ? `${minutes} 分 ${remain} 秒` : `${minutes} 分钟`;
}

function getStatusMeta(status = '') {
  const key = String(status || '').toLowerCase();
  if (key === 'success') return { label: '已完成', tone: 'success' };
  if (key === 'error') return { label: '失败', tone: 'error' };
  if (key === 'running') return { label: '执行中', tone: 'warn' };
  if (key === 'pending') return { label: '排队中', tone: 'warn' };
  if (key === 'canceled') return { label: '已取消', tone: 'neutral' };
  return { label: '未知', tone: 'neutral' };
}

function setStatus(text, tone = 'neutral') {
  const target = getElement('agent-workbench-status');
  if (!target) return;
  target.textContent = text;
  target.className = tone === 'error' ? 'setting-error' : 'setting-help';
}

function setButtonBusy(id, busy, normalText, busyText) {
  const button = getElement(id);
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
}

function renderSummary(data = {}) {
  const summary = data.summary || {};
  const items = [
    ['可用 Agent', summary.availableProviderCount || 0, `共探测 ${summary.providerCount || 0} 个`],
    ['运行任务', summary.activeTaskCount || 0, '只读任务'],
    ['已完成', summary.successTaskCount || 0, '本次控制台运行'],
    ['失败任务', summary.failedTaskCount || 0, '含超时'],
    ['最大并发', data.config?.maxConcurrentTasks || 1, `超时 ${formatDuration(data.config?.timeoutMs || 0)}`],
  ];
  getElement('agent-summary').innerHTML = items.map(([label, value, detail]) => `
    <div class="agent-summary-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `).join('');
}

function applySettings(config = {}) {
  if (agentWorkbenchState.settingsDirty) return;
  getElement('agent-enabled').checked = config.enabled === true;
  getElement('agent-default-provider').value = config.defaultProvider || 'opencode';
  getElement('agent-timeout-ms').value = String(config.timeoutMs || 300000);
  getElement('agent-max-concurrent').value = String(config.maxConcurrentTasks || 1);
  getElement('agent-provider-opencode').checked = config.providers?.opencode !== false;
  getElement('agent-provider-mimo').checked = config.providers?.mimo !== false;
}

function renderProviders(data = {}) {
  const providers = Array.isArray(data.providers) ? data.providers : [];
  const target = getElement('agent-provider-list');
  target.innerHTML = providers.length ? providers.map(provider => {
    const available = provider.available === true;
    return `
      <div class="agent-provider-item">
        <div>
          <strong>${escapeHtml(provider.label || provider.id)}</strong>
          <span>${escapeHtml(available ? `版本 ${provider.version || '未知'}` : provider.error || 'CLI 不可用')}</span>
          <code>${escapeHtml(provider.source || '系统 PATH')}</code>
        </div>
        <span class="agent-state-badge tone-${available ? 'success' : 'error'}">${available ? (provider.enabled ? '可使用' : '已停用') : '不可用'}</span>
      </div>
    `;
  }).join('') : '<div class="agent-empty"><strong>未检测到 Agent</strong><span>请确认 CLI 已安装并加入 PATH。</span></div>';

  const providerSelect = getElement('agent-provider');
  const previous = providerSelect.value;
  providerSelect.innerHTML = providers.map(provider => `
    <option value="${escapeHtml(provider.id)}" ${!provider.available || !provider.enabled ? 'disabled' : ''}>${escapeHtml(provider.label)}${provider.available ? '' : '（不可用）'}${provider.enabled ? '' : '（已停用）'}</option>
  `).join('');
  const preferred = providers.find(item => item.id === previous && item.available && item.enabled)
    || providers.find(item => item.id === data.config?.defaultProvider && item.available && item.enabled)
    || providers.find(item => item.available && item.enabled);
  if (preferred) providerSelect.value = preferred.id;
}

function renderWorkspaces(data = {}) {
  const select = getElement('agent-workspace');
  const previous = select.value;
  const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  select.innerHTML = workspaces.map(item => `
    <option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${escapeHtml(item.description || '')}</option>
  `).join('');
  if (workspaces.some(item => item.id === previous)) select.value = previous;
}

function getSelectedTask(data = {}) {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return tasks.find(task => task.id === agentWorkbenchState.selectedTaskId) || tasks[0] || null;
}

function normalizeAgentOutput(value = '') {
  return String(value || '').split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return line;
    try {
      const item = JSON.parse(trimmed);
      const content = item?.part?.text
        || item?.text
        || item?.message?.content
        || item?.content;
      if (typeof content === 'string' && content.trim()) return content;
      if (Array.isArray(content)) {
        const text = content.map(part => part?.text || '').filter(Boolean).join('\n');
        if (text) return text;
      }
      return line;
    } catch {
      return line;
    }
  }).join('\n').trim();
}

function renderSelectedTask(data = {}) {
  const task = getSelectedTask(data);
  if (!task) {
    getElement('agent-output-title').textContent = '任务输出';
    getElement('agent-output-meta').textContent = '尚未选择任务。';
    getElement('agent-output').textContent = '等待任务...';
    getElement('agent-cancel-btn').disabled = true;
    getElement('agent-output-alert').classList.add('hidden');
    return;
  }
  agentWorkbenchState.selectedTaskId = task.id;
  const status = getStatusMeta(task.status);
  getElement('agent-output-title').textContent = task.title || 'Agent 任务';
  getElement('agent-output-meta').textContent = `${task.providerLabel || task.providerId} · ${task.workspaceLabel || task.workspaceId} · ${status.label} · ${formatDuration(task.elapsedMs)}`;
  const output = normalizeAgentOutput(task.outputText);
  const stderr = normalizeAgentOutput(task.stderrText);
  const sections = [output, stderr ? `\n[stderr]\n${stderr}` : '', task.error ? `\n[错误]\n${task.error}` : ''].filter(Boolean);
  getElement('agent-output').textContent = sections.join('\n').trim() || (task.status === 'running' || task.status === 'pending' ? 'Agent 正在准备输出...' : '任务没有返回文本。');
  getElement('agent-cancel-btn').disabled = !['running', 'pending'].includes(task.status);
  const alert = getElement('agent-output-alert');
  if (task.workspaceChanged) {
    alert.textContent = '执行期间 Git 工作区状态发生变化，请在文件编辑或 Git 中人工核对。';
    alert.classList.remove('hidden');
  } else {
    alert.classList.add('hidden');
  }
}

function renderTasks(data = {}) {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  getElement('agent-history-meta').textContent = tasks.length ? `共 ${tasks.length} 个任务，点击任务查看输出。` : '暂无任务。';
  getElement('agent-task-list').innerHTML = tasks.length ? tasks.map(task => {
    const status = getStatusMeta(task.status);
    return `
      <button type="button" class="agent-task-item ${task.id === agentWorkbenchState.selectedTaskId ? 'is-selected' : ''}" data-task-id="${escapeHtml(task.id)}">
        <span class="agent-task-main">
          <strong>${escapeHtml(task.title || 'Agent 任务')}</strong>
          <span>${escapeHtml(task.providerLabel || task.providerId)} · ${escapeHtml(task.workspaceLabel || task.workspaceId)} · ${escapeHtml(task.promptPreview || '')}</span>
        </span>
        <span class="agent-task-status tone-${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>
        <span class="agent-task-time">${escapeHtml(formatTime(task.createdAt))}</span>
      </button>
    `;
  }).join('') : '<div class="agent-empty"><strong>暂无 Agent 任务</strong><span>启用工作台后可创建只读分析任务。</span></div>';
}

function updateRunState(data = {}) {
  const enabled = data.config?.enabled === true;
  const providerAvailable = (data.providers || []).some(item => item.available && item.enabled);
  const active = Number(data.summary?.activeTaskCount || 0);
  const limit = Number(data.config?.maxConcurrentTasks || 1);
  const runButton = getElement('agent-run-btn');
  runButton.disabled = !enabled || !providerAvailable || active >= limit;
  getElement('agent-composer-hint').textContent = !enabled
    ? '请先启用并保存 Agent 工作台。'
    : !providerAvailable
      ? '没有可用的 Agent CLI。'
      : active >= limit
        ? '并发任务已达到上限。'
        : '任务将以只读 plan Agent 启动。';
}

function renderPayload(payload = {}) {
  const data = payload.data || payload;
  agentWorkbenchState.payload = data;
  if (!agentWorkbenchState.selectedTaskId) {
    const queryTask = new URLSearchParams(location.search).get('task') || '';
    agentWorkbenchState.selectedTaskId = queryTask;
  }
  applySettings(data.config || {});
  renderSummary(data);
  renderProviders(data);
  renderWorkspaces(data);
  renderTasks(data);
  renderSelectedTask(data);
  updateRunState(data);
  const enabled = data.config?.enabled === true;
  const state = getElement('agent-master-state');
  state.textContent = enabled ? '已启用' : '默认关闭';
  state.className = `agent-state-badge tone-${enabled ? 'success' : 'warn'}`;
  getElement('agent-workbench-meta').textContent = `可用 Agent ${data.summary?.availableProviderCount || 0} 个 · 活跃任务 ${data.summary?.activeTaskCount || 0} 个 · ${formatTime(data.generatedAt)}`;
  setStatus(enabled ? 'Agent 工作台已启用，所有任务仍固定使用只读安全参数。' : 'Agent 工作台保持关闭，不会启动本地 Agent 进程。');
}

async function refreshAgentWorkbench(options = {}) {
  if (agentWorkbenchState.refreshing) return agentWorkbenchState.payload;
  agentWorkbenchState.refreshing = true;
  if (!options.quiet) setButtonBusy('agent-refresh-btn', true, '刷新状态', '刷新中...');
  try {
    const result = await fetchJson(`/api/agent-workbench${options.force ? '?force=1' : ''}`);
    renderPayload(result);
    return result;
  } catch (error) {
    setStatus(`加载失败：${error.message}`, 'error');
    throw error;
  } finally {
    agentWorkbenchState.refreshing = false;
    if (!options.quiet) setButtonBusy('agent-refresh-btn', false, '刷新状态', '刷新中...');
  }
}

function readSettingsDraft() {
  return {
    enabled: getElement('agent-enabled').checked === true,
    defaultProvider: getElement('agent-default-provider').value || 'opencode',
    timeoutMs: Number(getElement('agent-timeout-ms').value || 300000),
    maxConcurrentTasks: Number(getElement('agent-max-concurrent').value || 1),
    providers: {
      opencode: getElement('agent-provider-opencode').checked === true,
      mimo: getElement('agent-provider-mimo').checked === true,
    },
  };
}

async function saveSettings() {
  setButtonBusy('agent-save-btn', true, '保存设置', '保存中...');
  try {
    const result = await postJson('/api/agent-workbench/settings', readSettingsDraft());
    agentWorkbenchState.settingsDirty = false;
    renderPayload(result);
    setStatus('Agent 工作台设置已保存。');
  } finally {
    setButtonBusy('agent-save-btn', false, '保存设置', '保存中...');
  }
}

async function runTask() {
  const prompt = String(getElement('agent-prompt').value || '').trim();
  if (prompt.length < 2) {
    await webConsoleAlert('请输入需要 Agent 分析的任务。');
    return;
  }
  const providerId = getElement('agent-provider').value;
  const workspaceId = getElement('agent-workspace').value;
  const mode = getElement('agent-mode').value;
  const provider = (agentWorkbenchState.payload?.providers || []).find(item => item.id === providerId);
  const workspace = (agentWorkbenchState.payload?.workspaces || []).find(item => item.id === workspaceId);
  const confirmed = await webConsoleConfirm(
    `将使用 ${provider?.label || providerId} 在“${workspace?.label || workspaceId}”启动${mode === 'patch' ? '补丁建议' : '只读分析'}任务。任务不会自动批准写入权限，是否继续？`,
    { title: '启动 Agent 任务', confirmText: '开始任务' },
  );
  if (!confirmed) return;
  setButtonBusy('agent-run-btn', true, '开始只读任务', '启动中...');
  try {
    const result = await postJson('/api/agent-workbench/tasks', {
      confirmed: true,
      providerId,
      workspaceId,
      mode,
      model: String(getElement('agent-model').value || '').trim(),
      title: String(getElement('agent-title').value || '').trim(),
      prompt,
    });
    agentWorkbenchState.selectedTaskId = result.task?.id || '';
    getElement('agent-prompt').value = '';
    getElement('agent-title').value = '';
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(error.message);
  } finally {
    setButtonBusy('agent-run-btn', false, '开始只读任务', '启动中...');
    updateRunState(agentWorkbenchState.payload || {});
  }
}

async function cancelSelectedTask() {
  const taskId = agentWorkbenchState.selectedTaskId;
  if (!taskId) return;
  const confirmed = await webConsoleConfirm('确认取消当前 Agent 任务？', {
    title: '取消 Agent 任务',
    confirmText: '取消任务',
  });
  if (!confirmed) return;
  setButtonBusy('agent-cancel-btn', true, '取消任务', '取消中...');
  try {
    await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(taskId)}/cancel`, {});
    await refreshAgentWorkbench({ quiet: true });
  } finally {
    setButtonBusy('agent-cancel-btn', false, '取消任务', '取消中...');
  }
}

function bindEvents() {
  getElement('agent-refresh-btn').addEventListener('click', () => {
    refreshAgentWorkbench({ force: true }).catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-save-btn').addEventListener('click', () => {
    saveSettings().catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-run-btn').addEventListener('click', runTask);
  getElement('agent-cancel-btn').addEventListener('click', () => {
    cancelSelectedTask().catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-task-list').addEventListener('click', event => {
    const item = event.target.closest?.('[data-task-id]');
    if (!item) return;
    agentWorkbenchState.selectedTaskId = item.dataset.taskId || '';
    renderTasks(agentWorkbenchState.payload || {});
    renderSelectedTask(agentWorkbenchState.payload || {});
  });
  [
    'agent-enabled',
    'agent-default-provider',
    'agent-timeout-ms',
    'agent-max-concurrent',
    'agent-provider-opencode',
    'agent-provider-mimo',
  ].forEach(id => {
    getElement(id).addEventListener('change', () => {
      agentWorkbenchState.settingsDirty = true;
      setStatus('设置已修改，尚未保存。');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  refreshAgentWorkbench().catch(error => webConsoleAlert(error.message));
  agentWorkbenchState.pollTimer = window.setInterval(() => {
    refreshAgentWorkbench({ quiet: true }).catch(() => {});
  }, 1800);
});

window.addEventListener('beforeunload', () => {
  if (agentWorkbenchState.pollTimer) window.clearInterval(agentWorkbenchState.pollTimer);
});
