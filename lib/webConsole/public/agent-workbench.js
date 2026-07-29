const agentWorkbenchState = {
  payload: null,
  selectedTaskId: '',
  settingsDirty: false,
  initialized: false,
  refreshing: false,
  pollTimer: null,
  newSession: false,
  settingsOpen: false,
  formTaskId: '',
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
    ['运行任务', summary.activeTaskCount || 0, data.config?.writeEnabled ? '分析与修改' : '只读任务'],
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
  getElement('agent-write-enabled').checked = config.writeEnabled === true;
  getElement('agent-default-provider').value = config.defaultProvider || 'opencode';
  getElement('agent-timeout-ms').value = String(config.timeoutMs || 300000);
  getElement('agent-max-concurrent').value = String(config.maxConcurrentTasks || 1);
  getElement('agent-provider-opencode').checked = config.providers?.opencode !== false;
  getElement('agent-write-plugin').checked = config.writableWorkspaces?.plugin !== false;
  getElement('agent-write-plugins').checked = config.writableWorkspaces?.plugins === true;
  getElement('agent-write-yunzai').checked = config.writableWorkspaces?.yunzai === true;
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
    <option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${escapeHtml(item.description || '')}${data.config?.writableWorkspaces?.[item.id] ? ' · 可授权写入' : ''}</option>
  `).join('');
  if (workspaces.some(item => item.id === previous)) select.value = previous;
}

function getSelectedTask(data = {}) {
  if (agentWorkbenchState.newSession) return null;
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return tasks.find(task => task.id === agentWorkbenchState.selectedTaskId) || tasks[0] || null;
}

function normalizeAgentOutput(value = '') {
  const content = [];
  String(value || '').split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('{')) {
      content.push(line);
      return;
    }
    try {
      const item = JSON.parse(trimmed);
      const part = item?.part || {};
      const type = String(item?.type || '').toLowerCase();
      const partType = String(part?.type || '').toLowerCase();
      const isTextEvent = type === 'text' || type === 'message' || type.includes('message') || partType === 'text';
      if (!isTextEvent) return;
      const text = part?.text || item?.text || item?.message?.content || item?.content;
      if (typeof text === 'string' && text.trim()) {
        content.push(text);
        return;
      }
      if (Array.isArray(text)) {
        const joined = text.map(entry => entry?.text || '').filter(Boolean).join('\n');
        if (joined) content.push(joined);
      }
    } catch {
      content.push(line);
    }
  });
  return content.join('\n').trim();
}

function getModeLabel(mode = '') {
  if (mode === 'edit') return '实际修改';
  if (mode === 'patch') return '补丁建议';
  return '只读分析';
}

function buildTaskDiffOutput(task = {}) {
  const files = Array.isArray(task.changedFiles) ? task.changedFiles : [];
  const sections = [];
  if (files.length) {
    sections.push(`[变更文件 ${files.length} 个]\n${files.map(item => `${item.status || '?'}  ${item.path || ''}`).join('\n')}`);
  }
  if (task.diffStat) sections.push(`[变更统计]\n${task.diffStat}`);
  if (task.diffText) sections.push(`[Git Diff]\n${task.diffText}`);
  if (!sections.length) {
    return task.status === 'running' || task.status === 'pending'
      ? '任务完成后将在这里显示文件改动。'
      : '本次任务没有检测到文件改动。';
  }
  return sections.join('\n\n');
}

function renderAgentTools(tools = []) {
  if (!Array.isArray(tools) || !tools.length) return '';
  return `
    <details class="agent-artifact-card agent-tool-card">
      <summary>工具调用 <span>${tools.length} 项</span></summary>
      <div class="agent-tool-list">${tools.map(tool => `
        <details class="agent-tool-item">
          <summary><strong>${escapeHtml(tool.name || '工具调用')}</strong><span>${escapeHtml(tool.status || 'unknown')}</span></summary>
          ${tool.input ? `<pre><strong>输入</strong>\n${formatAgentText(tool.input)}</pre>` : ''}
          ${tool.output ? `<pre><strong>输出</strong>\n${formatAgentText(tool.output)}</pre>` : ''}
        </details>
      `).join('')}</div>
    </details>
  `;
}

function renderAssistantArtifacts(message = {}, options = {}) {
  const stderr = normalizeAgentOutput(message.stderrText);
  const reasoning = String(message.reasoning || '').trim();
  const errorOutput = message.error
    ? `<div class="agent-message-error"><strong>本轮未完成</strong><span>${formatAgentText(message.error)}</span></div>`
    : '';
  const reasoningOutput = reasoning
    ? `<details class="agent-artifact-card"><summary>思考过程</summary><pre>${formatAgentText(reasoning)}</pre></details>`
    : '';
  const diagnosticOutput = stderr
    ? `<details class="agent-artifact-card"><summary>运行诊断</summary><pre>${formatAgentText(stderr)}</pre></details>`
    : '';
  const diffOutput = message.changedFiles?.length || message.diffStat || message.diffText
    ? `<details class="agent-artifact-card"><summary>文件改动 <span>${message.changedFiles?.length || 0} 个文件</span></summary><pre>${formatAgentText(buildTaskDiffOutput(message))}</pre></details>`
    : '';
  const events = options.showEvents && Array.isArray(options.events) ? options.events : [];
  const eventOutput = events.length ? `
    <details class="agent-event-card" ${options.running ? 'open' : ''}>
      <summary>执行记录 <span>${events.length} 条</span></summary>
      <div class="agent-event-list">${events.map(event => `
        <div class="agent-event-item">
          <span class="agent-event-dot tone-${escapeHtml(event.level || 'info')}"></span>
          <span>${formatAgentText(event.message || '')}</span>
          <time>${escapeHtml(formatTime(event.time))}</time>
        </div>
      `).join('')}</div>
    </details>
  ` : '';
  return `${errorOutput}${reasoningOutput}${renderAgentTools(message.tools)}${diagnosticOutput}${diffOutput}${eventOutput}`;
}

function formatAgentText(value = '') {
  const text = String(value || '').trim();
  return text ? escapeHtml(text) : '';
}

function renderContext(task = null) {
  const files = Array.isArray(task?.changedFiles) ? task.changedFiles : [];
  getElement('agent-context-file-count').textContent = String(files.length);
  getElement('agent-context-file-list').innerHTML = files.length
    ? files.map(item => `
        <div class="agent-context-file-item">
          <code>${escapeHtml(item.status || '?')}</code>
          <span title="${escapeHtml(item.path || '')}">${escapeHtml(item.path || '未命名文件')}</span>
        </div>
      `).join('')
    : '<span class="agent-context-empty">选择一个实际修改任务后显示文件改动。</span>';
  getElement('agent-context-diff-stat').textContent = task?.diffStat || '暂无 Diff';
}

function renderConversation(task = null) {
  const target = getElement('agent-output');
  if (!task) {
    target.innerHTML = `
      <div class="agent-chat-empty">
        <span class="agent-empty-mark">⌘</span>
        <strong>准备好开始工作</strong>
        <span>描述要检查、设计或修改的内容，Agent 会在当前工作目录中执行。</span>
      </div>
    `;
    return;
  }
  const status = getStatusMeta(task.status);
  const running = task.status === 'running' || task.status === 'pending';
  let messages = Array.isArray(task.messages) ? task.messages : [];
  if (!messages.length && !task.messageCount) {
    messages = [
      { role: 'user', content: task.prompt || task.promptPreview || '未记录任务内容', createdAt: task.createdAt },
      ...(!running ? [{ role: 'assistant', content: normalizeAgentOutput(task.outputText), createdAt: task.startedAt, finishedAt: task.finishedAt, status: task.status, error: task.error, stderrText: task.stderrText, changedFiles: task.changedFiles, diffStat: task.diffStat, diffText: task.diffText }] : []),
    ];
  }
  if (!messages.length && task.messageCount) {
    target.innerHTML = '<div class="agent-chat-empty"><strong>正在加载会话</strong><span>正在读取 OpenCode 多轮上下文...</span></div>';
    return;
  }
  const lastAssistantIndex = messages.reduce((index, message, currentIndex) => message.role === 'assistant' ? currentIndex : index, -1);
  const html = messages.map((message, index) => {
    if (message.role === 'user') {
      return `
        <article class="agent-message agent-message-user">
          <div class="agent-message-avatar">你</div>
          <div class="agent-message-body">
            <div class="agent-message-label">你 <time>${escapeHtml(formatTime(message.createdAt))}</time></div>
            <div class="agent-message-bubble">${formatAgentText(message.content || '未记录消息内容')}</div>
          </div>
        </article>
      `;
    }
    const messageStatus = getStatusMeta(message.status || 'success');
    const outputText = message.content || (message.error ? '本轮没有产出可显示的文本。' : '本轮已完成。');
    return `
      <article class="agent-message agent-message-agent">
        <div class="agent-message-avatar agent-avatar-agent">⌘</div>
        <div class="agent-message-body">
          <div class="agent-message-label">${escapeHtml(task.providerLabel || 'OpenCode')} <span class="agent-message-stage">${escapeHtml(getModeLabel(message.mode || task.mode))} · ${escapeHtml(messageStatus.label)} · ${escapeHtml(formatDuration(message.elapsedMs))}</span></div>
          <div class="agent-message-bubble agent-agent-bubble">${formatAgentText(outputText)}</div>
          ${renderAssistantArtifacts(message, { showEvents: index === lastAssistantIndex && !running, events: task.events })}
        </div>
      </article>
    `;
  }).join('');
  const liveOutput = running ? `
    <article class="agent-message agent-message-agent agent-message-live">
      <div class="agent-message-avatar agent-avatar-agent">⌘</div>
      <div class="agent-message-body">
        <div class="agent-message-label">${escapeHtml(task.providerLabel || 'OpenCode')} <span class="agent-message-stage">${escapeHtml(getModeLabel(task.mode))} · ${escapeHtml(status.label)}</span></div>
        <div class="agent-message-bubble agent-agent-bubble">${formatAgentText(normalizeAgentOutput(task.outputText) || 'Agent 正在准备输出...')}</div>
        ${renderAssistantArtifacts({ tools: [] }, { showEvents: true, events: task.events, running: true })}
      </div>
    </article>
  ` : '';
  target.innerHTML = `${html}${liveOutput}`;
  if (running) target.scrollTop = target.scrollHeight;
}

function renderSelectedTask(data = {}) {
  const task = getSelectedTask(data);
  const status = getStatusMeta(task?.status);
  const statusBadge = getElement('agent-chat-status-badge');
  statusBadge.textContent = task ? status.label : '未开始';
  statusBadge.className = `agent-state-badge tone-${task ? status.tone : 'neutral'}`;
  if (!task) {
    getElement('agent-output-title').textContent = '新建 Agent 会话';
    getElement('agent-output-meta').textContent = '选择工作目录后，输入你希望 Agent 处理的任务。';
    getElement('agent-cancel-btn').disabled = true;
    getElement('agent-output-alert').classList.add('hidden');
    renderContext(null);
    renderConversation(null);
    return;
  }
  agentWorkbenchState.selectedTaskId = task.id;
  if (agentWorkbenchState.formTaskId !== task.id) {
    if ([...getElement('agent-provider').options].some(option => option.value === task.providerId)) getElement('agent-provider').value = task.providerId;
    if ([...getElement('agent-workspace').options].some(option => option.value === task.workspaceId)) getElement('agent-workspace').value = task.workspaceId;
    getElement('agent-mode').value = task.mode || 'analyze';
    getElement('agent-model').value = task.model || '';
    getElement('agent-title').value = '';
    agentWorkbenchState.formTaskId = task.id;
  }
  getElement('agent-output-title').textContent = task.title || 'Agent 任务';
  getElement('agent-output-meta').textContent = `${task.providerLabel || task.providerId} · ${task.workspaceLabel || task.workspaceId} · ${task.turnCount || 1} 轮 · ${getModeLabel(task.mode)} · ${status.label} · ${formatDuration(task.elapsedMs)}`;
  getElement('agent-cancel-btn').disabled = !['running', 'pending'].includes(task.status);
  renderContext(task);
  renderConversation(task);
  const alert = getElement('agent-output-alert');
  if (task.mode === 'edit' && task.workspaceChanged) {
    alert.textContent = `Agent 已实际修改 ${task.changedFiles?.length || 0} 个文件，请在右侧“文件改动”中检查后再提交。`;
    alert.classList.remove('hidden');
  } else if (task.workspaceChanged) {
    alert.textContent = '只读任务意外改变了 Git 工作区，请立即人工检查。';
    alert.classList.remove('hidden');
  } else {
    alert.classList.add('hidden');
  }
}

function renderTasks(data = {}) {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  getElement('agent-history-meta').textContent = tasks.length ? `${tasks.length} 个最近会话` : '暂无会话。';
  getElement('agent-task-list').innerHTML = tasks.length ? tasks.map(task => {
    const status = getStatusMeta(task.status);
    return `
      <button type="button" class="agent-task-item ${task.id === agentWorkbenchState.selectedTaskId && !agentWorkbenchState.newSession ? 'is-selected' : ''}" data-task-id="${escapeHtml(task.id)}">
        <span class="agent-task-main">
          <strong>${escapeHtml(task.title || 'Agent 任务')}</strong>
          <span>${escapeHtml(task.promptPreview || task.providerLabel || task.providerId)} · ${escapeHtml(task.turnCount || 1)} 轮</span>
        </span>
        <span class="agent-task-status tone-${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>
        <span class="agent-task-time">${escapeHtml(formatTime(task.createdAt))}</span>
      </button>
    `;
  }).join('') : '<div class="agent-empty"><strong>还没有会话</strong><span>发送第一条任务后，会话记录显示在这里。</span></div>';
}

function updateRunState(data = {}) {
  const enabled = data.config?.enabled === true;
  const providerAvailable = (data.providers || []).some(item => item.available && item.enabled);
  const active = Number(data.summary?.activeTaskCount || 0);
  const limit = Number(data.config?.maxConcurrentTasks || 1);
  const runButton = getElement('agent-run-btn');
  const mode = getElement('agent-mode').value || 'analyze';
  const providerId = getElement('agent-provider').value || '';
  const workspaceId = getElement('agent-workspace').value || '';
  const writeMode = mode === 'edit';
  const writeAllowed = data.config?.writeEnabled === true
    && providerId === 'opencode'
    && data.config?.writableWorkspaces?.[workspaceId] === true;
  runButton.textContent = writeMode ? '发送并修改' : '发送';
  runButton.classList.toggle('agent-write-run', writeMode);
  runButton.disabled = !enabled || !providerAvailable || active >= limit || (writeMode && !writeAllowed);
  getElement('agent-composer-context-label').textContent = workspaceId
    ? `${workspaceId} · ${providerId || '未选择 Agent'}`
    : '等待 Agent 状态';
  getElement('agent-composer-hint').textContent = !enabled
    ? '请先启用并保存 Agent 工作台。'
    : !providerAvailable
      ? '没有可用的 Agent CLI。'
      : active >= limit
        ? '并发任务已达到上限。'
        : writeMode && !data.config?.writeEnabled
          ? '请先启用并保存“允许实际修改文件”。'
          : writeMode && providerId !== 'opencode'
            ? '实际修改模式当前只支持内置 OpenCode。'
            : writeMode && !data.config?.writableWorkspaces?.[workspaceId]
              ? '所选工作目录尚未获得写入授权。'
              : writeMode
                ? '将使用 build Agent 修改文件；请先备份并在确认窗口核对执行命令。'
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
  const writeEnabled = data.config?.writeEnabled === true;
  const state = getElement('agent-master-state');
  state.textContent = enabled ? '已启用' : '默认关闭';
  state.className = `agent-state-badge tone-${enabled ? 'success' : 'warn'}`;
  getElement('agent-security-title').textContent = writeEnabled ? '受控写入已授权' : '只读执行边界';
  getElement('agent-security-detail').textContent = writeEnabled
    ? 'build Agent 可在授权 Git 仓库内编辑文件 · 禁止终端、联网和外部目录'
    : 'plan Agent · pure 模式 · 不自动批准 · 不直接写文件';
  getElement('agent-workbench-meta').textContent = `可用 Agent ${data.summary?.availableProviderCount || 0} 个 · 活跃任务 ${data.summary?.activeTaskCount || 0} 个 · ${formatTime(data.generatedAt)}`;
  setStatus(enabled
    ? (writeEnabled ? 'Agent 工作台已启用，实际修改任务需要目录授权和每次确认。' : 'Agent 工作台已启用，当前仅允许只读任务。')
    : 'Agent 工作台保持关闭，不会启动本地 Agent 进程。');
}

async function refreshAgentWorkbench(options = {}) {
  if (agentWorkbenchState.refreshing) return agentWorkbenchState.payload;
  agentWorkbenchState.refreshing = true;
  if (!options.quiet) setButtonBusy('agent-refresh-btn', true, '刷新状态', '刷新中...');
  try {
    const query = new URLSearchParams();
    if (options.force) query.set('force', '1');
    if (agentWorkbenchState.selectedTaskId && !agentWorkbenchState.newSession) query.set('task', agentWorkbenchState.selectedTaskId);
    const result = await fetchJson(`/api/agent-workbench${query.size ? `?${query.toString()}` : ''}`);
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
    writeEnabled: getElement('agent-write-enabled').checked === true,
    defaultProvider: getElement('agent-default-provider').value || 'opencode',
    timeoutMs: Number(getElement('agent-timeout-ms').value || 300000),
    maxConcurrentTasks: Number(getElement('agent-max-concurrent').value || 1),
    providers: {
      opencode: getElement('agent-provider-opencode').checked === true,
    },
    writableWorkspaces: {
      plugin: getElement('agent-write-plugin').checked === true,
      plugins: getElement('agent-write-plugins').checked === true,
      yunzai: getElement('agent-write-yunzai').checked === true,
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

async function runTask(event) {
  event?.preventDefault?.();
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
  const writeMode = mode === 'edit';
  const selectedTask = agentWorkbenchState.newSession ? null : getSelectedTask(agentWorkbenchState.payload || {});
  const continuing = Boolean(selectedTask?.id);
  const commandPreview = continuing && selectedTask.opencodeSessionId
    ? `opencode run --pure --format json --agent ${writeMode ? 'build' : 'plan'} --dir "${workspace?.path || workspaceId}" --session ${selectedTask.opencodeSessionId} [你的消息]`
    : `opencode run --pure --format json --agent ${writeMode ? 'build' : 'plan'} --dir "${workspace?.path || workspaceId}" [你的任务]`;
  const confirmed = await webConsoleConfirm(
    writeMode
      ? [
        `将使用 ${provider?.label || providerId} 直接修改“${workspace?.label || workspaceId}”中的文件。`,
        '',
        '重要提醒：务必先备份需要保留的文件，并在继续前看清下面的执行命令。已有未提交修改和非 Git 目录均可继续，但改动需要你自行核对。',
        '',
        `执行命令：${commandPreview}`,
        '',
        'Agent 只能在所选工作目录内读写，不能执行终端命令或访问目录外内容。是否继续？',
      ].join('\n')
      : `将使用 ${provider?.label || providerId} 在“${workspace?.label || workspaceId}”${continuing ? '继续当前会话' : '启动新会话'}并执行${mode === 'patch' ? '补丁建议' : '只读分析'}。任务不会写入文件，是否继续？`,
    { title: writeMode ? '备份与执行命令确认' : (continuing ? '继续 Agent 会话' : '启动 Agent 会话'), confirmText: writeMode ? '已备份并确认执行' : '发送' },
  );
  if (!confirmed) return;
  setButtonBusy('agent-run-btn', true, writeMode ? '发送并修改' : '发送', '启动中...');
  try {
    const result = await postJson('/api/agent-workbench/tasks', {
      confirmed: true,
      writeConfirmed: writeMode,
      providerId,
      workspaceId,
      mode,
      model: String(getElement('agent-model').value || '').trim(),
      title: String(getElement('agent-title').value || '').trim(),
      prompt,
      sessionId: continuing ? selectedTask.id : '',
    });
    agentWorkbenchState.selectedTaskId = result.task?.id || '';
    agentWorkbenchState.newSession = false;
    getElement('agent-prompt').value = '';
    getElement('agent-title').value = '';
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(error.message);
  } finally {
    setButtonBusy('agent-run-btn', false, writeMode ? '发送并修改' : '发送', '启动中...');
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
  getElement('agent-composer-form').addEventListener('submit', runTask);
  getElement('agent-prompt').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    runTask(event);
  });
  getElement('agent-cancel-btn').addEventListener('click', () => {
    cancelSelectedTask().catch(error => webConsoleAlert(error.message));
  });
  const startNewSession = () => {
    agentWorkbenchState.selectedTaskId = '';
    agentWorkbenchState.newSession = true;
    agentWorkbenchState.formTaskId = '';
    getElement('agent-title').value = '';
    getElement('agent-prompt').value = '';
    renderTasks(agentWorkbenchState.payload || {});
    renderSelectedTask(agentWorkbenchState.payload || {});
    getElement('agent-prompt').focus();
  };
  getElement('agent-new-task-btn').addEventListener('click', startNewSession);
  getElement('agent-sidebar-new-btn').addEventListener('click', startNewSession);
  getElement('agent-settings-toggle').addEventListener('click', () => {
    agentWorkbenchState.settingsOpen = !agentWorkbenchState.settingsOpen;
    getElement('agent-settings-panel').classList.toggle('hidden', !agentWorkbenchState.settingsOpen);
    getElement('agent-settings-toggle').classList.toggle('is-active', agentWorkbenchState.settingsOpen);
  });
  getElement('agent-task-list').addEventListener('click', event => {
    const item = event.target.closest?.('[data-task-id]');
    if (!item) return;
    agentWorkbenchState.selectedTaskId = item.dataset.taskId || '';
    agentWorkbenchState.newSession = false;
    agentWorkbenchState.formTaskId = '';
    renderTasks(agentWorkbenchState.payload || {});
    renderSelectedTask(agentWorkbenchState.payload || {});
    refreshAgentWorkbench({ quiet: true }).catch(error => webConsoleAlert(error.message));
  });
  [
    'agent-enabled',
    'agent-write-enabled',
    'agent-default-provider',
    'agent-timeout-ms',
    'agent-max-concurrent',
    'agent-provider-opencode',
    'agent-write-plugin',
    'agent-write-plugins',
    'agent-write-yunzai',
  ].forEach(id => {
    getElement(id).addEventListener('change', () => {
      agentWorkbenchState.settingsDirty = true;
      setStatus('设置已修改，尚未保存。');
    });
  });
  ['agent-provider', 'agent-workspace', 'agent-mode'].forEach(id => {
    getElement(id).addEventListener('change', () => updateRunState(agentWorkbenchState.payload || {}));
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
