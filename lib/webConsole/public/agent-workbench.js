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
  conversationStickToBottom: true,
  conversationScrollFrame: 0,
  eventSource: null,
  streamConnected: false,
  fileTaskId: '',
  filePath: '',
  fileLoading: false,
  editorFile: null,
  editorTabs: [],
  activeEditorPath: '',
  composerAttachments: [],
  nativePayload: null,
  nativeWorkspaceId: '',
  nativeView: 'session',
  selectedTerminalId: '',
  selectedModelProviderId: '',
};

const { fetchJson, postJson } = window.CrystelfRequest || {};
const ui = window.CrystelfUi || {};

function getElement(id) {
  return document.getElementById(id);
}

function isConversationNearBottom(element, threshold = 96) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function updateConversationFollowButton() {
  const target = getElement('agent-output');
  const button = getElement('agent-jump-bottom');
  if (!target || !button) return;
  const shouldShow = !agentWorkbenchState.conversationStickToBottom
    && target.scrollHeight > target.clientHeight + 20;
  button.classList.toggle('hidden', !shouldShow);
}

function scrollConversationToBottom(force = false) {
  const target = getElement('agent-output');
  if (!target || (!force && !agentWorkbenchState.conversationStickToBottom)) return;
  if (agentWorkbenchState.conversationScrollFrame) {
    cancelAnimationFrame(agentWorkbenchState.conversationScrollFrame);
  }
  agentWorkbenchState.conversationScrollFrame = requestAnimationFrame(() => {
    agentWorkbenchState.conversationScrollFrame = 0;
    if (!force && !agentWorkbenchState.conversationStickToBottom) return;
    target.scrollTop = target.scrollHeight;
    updateConversationFollowButton();
  });
}

function handleConversationScroll() {
  const target = getElement('agent-output');
  if (!target) return;
  agentWorkbenchState.conversationStickToBottom = isConversationNearBottom(target);
  updateConversationFollowButton();
}

function getDetailStateKey(detail, counts) {
  const summary = Array.from(detail.children).find(child => child.tagName === 'SUMMARY');
  let label = Array.from(summary?.childNodes || [])
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent || '')
    .join('')
    .trim();
  if (!label) label = summary?.querySelector('strong')?.textContent?.trim() || '';
  if (!label) label = summary?.textContent?.trim() || '详情';
  const occurrence = counts.get(label) || 0;
  counts.set(label, occurrence + 1);
  return `${label}#${occurrence}`;
}

function captureConversationDetails(target) {
  const counts = new Map();
  return new Map(Array.from(target.querySelectorAll('details')).map(detail => [
    getDetailStateKey(detail, counts),
    detail.open,
  ]));
}

function restoreConversationDetails(target, state) {
  if (!state?.size) return;
  const counts = new Map();
  target.querySelectorAll('details').forEach(detail => {
    const key = getDetailStateKey(detail, counts);
    if (state.has(key)) detail.open = state.get(key);
  });
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
  target.title = text;
  target.className = `agent-context-status ${tone === 'error' ? 'setting-error' : 'setting-help'}`;
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
  getElement('agent-allow-network').checked = config.allowNetwork === true;
  getElement('agent-allow-all-directories').checked = config.allowAllDirectories === true;
  getElement('agent-allow-terminal').checked = config.allowTerminal === true;
  getElement('agent-default-provider').value = config.defaultProvider || 'opencode';
  const customApi = config.customApi || {};
  getElement('agent-custom-api-enabled').checked = customApi.enabled === true;
  getElement('agent-custom-api-base').value = customApi.baseApi || '';
  getElement('agent-custom-api-key').value = '';
  getElement('agent-custom-api-key').placeholder = customApi.apiKey ? '已配置，留空保持当前密钥' : '请输入 API Key';
  getElement('agent-custom-api-model').value = customApi.model || '';
  getElement('agent-custom-api-ua').value = customApi.userAgent || '';
  updateCustomApiFields();
  getElement('agent-timeout-ms').value = String(config.timeoutMs || 300000);
  getElement('agent-max-concurrent').value = String(config.maxConcurrentTasks || 1);
  getElement('agent-provider-opencode').checked = config.providers?.opencode !== false;
  getElement('agent-write-plugin').checked = config.writableWorkspaces?.plugin !== false;
  getElement('agent-write-plugins').checked = config.writableWorkspaces?.plugins === true;
  getElement('agent-write-yunzai').checked = config.writableWorkspaces?.yunzai === true;
}

function updateCustomApiFields() {
  const enabled = getElement('agent-custom-api-enabled')?.checked === true;
  document.querySelectorAll('.agent-custom-api-field').forEach(field => {
    field.classList.toggle('is-disabled', !enabled);
    field.querySelector('input')?.toggleAttribute('disabled', !enabled);
  });
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
    <details class="agent-event-card">
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
        <button type="button" class="agent-context-file-item" data-agent-file="${escapeHtml(item.path || '')}">
          <code>${escapeHtml(item.status || '?')}</code>
          <span title="${escapeHtml(item.path || '')}">${escapeHtml(item.path || '未命名文件')}</span>
        </button>
      `).join('')
    : '<span class="agent-context-empty">选择一个实际修改任务后显示文件改动。</span>';
  getElement('agent-context-diff-stat').textContent = task?.diffStat || '暂无 Diff';
  renderPermissions(task);
  renderQuestions(task);
  if (task?.id !== agentWorkbenchState.fileTaskId) {
    agentWorkbenchState.fileTaskId = task?.id || '';
    agentWorkbenchState.filePath = '';
    loadAgentFileTree('', task).catch(() => {});
  }
}

function renderPermissions(task = null) {
  const permissions = Array.isArray(task?.pendingPermissions) ? task.pendingPermissions : [];
  const section = getElement('agent-permission-section');
  section.classList.toggle('hidden', permissions.length === 0);
  getElement('agent-permission-count').textContent = String(permissions.length);
  getElement('agent-permission-list').innerHTML = permissions.map(item => `
    <article class="agent-permission-card" data-permission-id="${escapeHtml(item.id)}">
      <div class="agent-permission-head"><strong>${escapeHtml(item.action || '终端操作')}</strong><span>等待你的决定</span></div>
      ${item.resources?.length ? `<pre>${formatAgentText(item.resources.join('\n'))}</pre>` : ''}
      ${item.metadata ? `<details><summary>请求详情</summary><pre>${formatAgentText(item.metadata)}</pre></details>` : ''}
      <div class="agent-permission-actions">
        <button type="button" data-permission-reply="reject">拒绝</button>
        <button type="button" data-permission-reply="once">允许一次</button>
        <button type="button" class="is-primary" data-permission-reply="always">本会话允许</button>
      </div>
    </article>
  `).join('');
}

function renderQuestions(task = null) {
  const questions = Array.isArray(task?.pendingQuestions) ? task.pendingQuestions : [];
  const section = getElement('agent-question-section');
  section.classList.toggle('hidden', questions.length === 0);
  getElement('agent-question-count').textContent = String(questions.length);
  getElement('agent-question-list').innerHTML = questions.map(item => `
    <article class="agent-question-card" data-question-id="${escapeHtml(item.id)}">
      ${(item.questions || []).map((question, index) => `
        <fieldset class="agent-question-item" data-question-index="${index}">
          <legend>${escapeHtml(question.header || `问题 ${index + 1}`)}</legend>
          <p>${formatAgentText(question.question || '请选择一个答案')}</p>
          <div class="agent-question-options">
            ${(question.options || []).map((option, optionIndex) => `
              <label class="agent-question-option">
                <input type="${question.multiple ? 'checkbox' : 'radio'}" name="agent-question-${escapeHtml(item.id)}-${index}" value="${escapeHtml(option.label)}" ${optionIndex === 0 && !question.multiple ? 'checked' : ''} />
                <span><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ''}</span>
              </label>
            `).join('')}
            ${question.custom ? '<input class="agent-question-custom" type="text" placeholder="输入自定义回答" />' : ''}
          </div>
        </fieldset>
      `).join('')}
      <div class="agent-question-actions">
        <button type="button" data-question-reply="reject">拒绝</button>
        <button type="button" class="is-primary" data-question-reply="reply">提交回答</button>
      </div>
    </article>
  `).join('');
}

async function replyAgentQuestion(taskId, requestId, card, reject = false) {
  card?.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
  try {
    const answers = [];
    if (!reject) {
      card.querySelectorAll('.agent-question-item').forEach(item => {
        const values = [...item.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked')].map(input => input.value);
        const custom = item.querySelector('.agent-question-custom')?.value?.trim();
        if (custom) values.push(custom);
        answers.push(values);
      });
    }
    const action = reject ? 'reject' : 'reply';
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(taskId)}/questions/${encodeURIComponent(requestId)}/${action}`, { answers });
    mergeStreamTask(result.task);
  } catch (error) {
    await webConsoleAlert(error.message);
    card?.querySelectorAll('button, input').forEach(control => { control.disabled = false; });
  }
}

async function replyAgentPermission(taskId, requestId, reply) {
  const card = document.querySelector(`[data-permission-id="${CSS.escape(requestId)}"]`);
  card?.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(taskId)}/permissions/${encodeURIComponent(requestId)}`, { reply });
    mergeStreamTask(result.task);
  } catch (error) {
    await webConsoleAlert(error.message);
    card?.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}

function getSelectedWorkspaceTask() {
  return getSelectedTask(agentWorkbenchState.payload || {});
}

function renderEditorTabs() {
  const target = getElement('agent-file-editor-tabs');
  if (!target) return;
  target.innerHTML = agentWorkbenchState.editorTabs.map(tab => `
    <button type="button" class="agent-editor-tab ${tab.path === agentWorkbenchState.activeEditorPath ? 'is-active' : ''}" data-editor-tab="${escapeHtml(tab.path)}" role="tab" aria-selected="${tab.path === agentWorkbenchState.activeEditorPath}">
      <span title="${escapeHtml(tab.path)}">${escapeHtml(tab.name || tab.path.split('/').pop() || tab.path)}</span>
      ${tab.dirty ? '<small>*</small>' : ''}
      <span class="agent-editor-tab-close" data-editor-tab-close="1" aria-label="关闭文件">×</span>
    </button>
  `).join('');
}

function markEditorDirty() {
  const pathValue = agentWorkbenchState.activeEditorPath;
  const tab = agentWorkbenchState.editorTabs.find(item => item.path === pathValue);
  if (!tab || !agentWorkbenchState.editorFile) return;
  tab.dirty = getElement('agent-file-editor-content').value !== String(tab.originalContent || '');
  renderEditorTabs();
}

async function closeEditorTab(pathValue = '') {
  const index = agentWorkbenchState.editorTabs.findIndex(item => item.path === pathValue);
  if (index < 0) return;
  const tab = agentWorkbenchState.editorTabs[index];
  if (tab.dirty && !await webConsoleConfirm(`文件“${tab.name || tab.path}”有未保存修改，确定关闭吗？`, { title: '关闭未保存文件' })) return;
  agentWorkbenchState.editorTabs.splice(index, 1);
  if (agentWorkbenchState.activeEditorPath === pathValue) {
    const next = agentWorkbenchState.editorTabs[index] || agentWorkbenchState.editorTabs[index - 1];
    agentWorkbenchState.activeEditorPath = next?.path || '';
    if (next) openAgentFile(next.path).catch(error => webConsoleAlert(error.message));
    else {
      agentWorkbenchState.editorFile = null;
      getElement('agent-file-editor-mask').classList.add('hidden');
    }
  }
  renderEditorTabs();
}

async function loadAgentFileTree(pathValue = agentWorkbenchState.filePath, task = getSelectedWorkspaceTask()) {
  const target = getElement('agent-file-tree');
  if (!task) {
    target.innerHTML = '<span class="agent-context-empty">选择会话后显示文件。</span>';
    getElement('agent-file-path').textContent = '/';
    return;
  }
  if (task.workspaceId !== 'plugin') {
    target.innerHTML = '<span class="agent-context-empty">此处仅显示灵晶插件目录；其他工作目录请使用完整文件编辑器。</span>';
    getElement('agent-file-path').textContent = task.workspaceLabel || task.workspaceId;
    return;
  }
  if (agentWorkbenchState.fileLoading) return;
  agentWorkbenchState.fileLoading = true;
  target.innerHTML = '<span class="agent-context-empty">正在读取目录...</span>';
  try {
    const result = await fetchJson(`/api/file-browser/tree?path=${encodeURIComponent(pathValue || '')}`);
    agentWorkbenchState.filePath = result.current?.path || '';
    getElement('agent-file-path').textContent = `/${agentWorkbenchState.filePath}`;
    const entries = Array.isArray(result.entries) ? result.entries : [];
    target.innerHTML = entries.length ? entries.map(item => `
      <button type="button" class="agent-file-entry" data-agent-file-path="${escapeHtml(item.path)}" data-agent-file-type="${escapeHtml(item.type)}" ${item.type === 'file' && !item.editable ? 'disabled' : ''}>
        <span class="agent-file-entry-icon">${item.type === 'directory' ? '▸' : '·'}</span>
        <span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <small>${item.type === 'directory' ? '目录' : `${Math.max(1, Math.round(Number(item.size || 0) / 1024))} KB`}</small>
      </button>
    `).join('') : '<span class="agent-context-empty">当前目录为空。</span>';
  } catch (error) {
    target.innerHTML = `<span class="agent-context-empty">目录读取失败：${escapeHtml(error.message)}</span>`;
  } finally {
    agentWorkbenchState.fileLoading = false;
  }
}

async function openAgentFile(pathValue = '') {
  const task = getSelectedWorkspaceTask();
  if (!pathValue || task?.workspaceId !== 'plugin') return;
  const mask = getElement('agent-file-editor-mask');
  mask.classList.remove('hidden');
  const existingTab = agentWorkbenchState.editorTabs.find(item => item.path === pathValue);
  if (!existingTab) {
    agentWorkbenchState.editorTabs.push({ path: pathValue, name: pathValue.split('/').pop() || pathValue, dirty: false });
  }
  agentWorkbenchState.activeEditorPath = pathValue;
  renderEditorTabs();
  getElement('agent-file-editor-title').textContent = '正在读取文件';
  getElement('agent-file-editor-path').textContent = pathValue;
  getElement('agent-file-editor-content').value = '';
  getElement('agent-file-editor-status').textContent = '正在通过文件安全接口读取...';
  getElement('agent-file-editor-save').disabled = true;
  try {
    const result = await fetchJson(`/api/file-browser/read?path=${encodeURIComponent(pathValue)}`);
    agentWorkbenchState.editorFile = result.file;
    const tab = agentWorkbenchState.editorTabs.find(item => item.path === pathValue);
    if (tab) {
      tab.name = result.file?.name || tab.name;
      tab.originalContent = result.file?.content || '';
      tab.dirty = false;
    }
    getElement('agent-file-editor-title').textContent = result.file?.name || '文件编辑器';
    getElement('agent-file-editor-path').textContent = result.file?.path || pathValue;
    getElement('agent-file-editor-content').value = result.file?.content || '';
    getElement('agent-file-editor-meta').textContent = `${Math.max(1, Math.round(Number(result.file?.size || 0) / 1024))} KB`;
    getElement('agent-file-editor-diff').textContent = task?.diffText || '当前会话暂无 Diff。';
    getElement('agent-file-editor-full').href = `/file-browser.html?open=${encodeURIComponent(result.file?.path || pathValue)}`;
    const canSave = task?.mode === 'edit' && task?.writeConfirmed === true
      && agentWorkbenchState.payload?.config?.writeEnabled === true
      && agentWorkbenchState.payload?.config?.writableWorkspaces?.plugin === true;
    getElement('agent-file-editor-content').readOnly = !canSave;
    getElement('agent-file-editor-save').disabled = !canSave;
    getElement('agent-file-editor-status').textContent = canSave ? '可以直接保存；磁盘内容变化时会阻止覆盖。' : '当前会话没有文件写入权限，内容以只读方式打开。';
    renderEditorTabs();
  } catch (error) {
    agentWorkbenchState.editorFile = null;
    getElement('agent-file-editor-status').textContent = `读取失败：${error.message}`;
  }
}

async function saveAgentFile() {
  const file = agentWorkbenchState.editorFile;
  if (!file?.path) return;
  setButtonBusy('agent-file-editor-save', true, '保存文件', '保存中...');
  try {
    const result = await postJson('/api/file-browser/write', {
      path: file.path,
      content: getElement('agent-file-editor-content').value,
      expectedMtimeMs: file.mtimeMs,
    });
    agentWorkbenchState.editorFile = { ...file, ...result.file, content: getElement('agent-file-editor-content').value };
    const tab = agentWorkbenchState.editorTabs.find(item => item.path === file.path);
    if (tab) {
      tab.originalContent = getElement('agent-file-editor-content').value;
      tab.dirty = false;
    }
    renderEditorTabs();
    getElement('agent-file-editor-status').textContent = '文件已保存。';
    await loadAgentFileTree();
  } catch (error) {
    getElement('agent-file-editor-status').textContent = `保存失败：${error.message}`;
  } finally {
    setButtonBusy('agent-file-editor-save', false, '保存文件', '保存中...');
  }
}

function mergeStreamTask(task) {
  if (!task?.id || !agentWorkbenchState.payload) return;
  const tasks = Array.isArray(agentWorkbenchState.payload.tasks) ? agentWorkbenchState.payload.tasks : [];
  const index = tasks.findIndex(item => item.id === task.id);
  if (index >= 0) tasks[index] = task;
  else tasks.unshift(task);
  tasks.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  agentWorkbenchState.payload.tasks = tasks.slice(0, 30);
  const active = tasks.filter(item => ['pending', 'running'].includes(item.status)).length;
  agentWorkbenchState.payload.summary.activeTaskCount = active;
  agentWorkbenchState.payload.summary.successTaskCount = tasks.filter(item => item.status === 'success').length;
  agentWorkbenchState.payload.summary.failedTaskCount = tasks.filter(item => item.status === 'error').length;
  renderSummary(agentWorkbenchState.payload);
  renderTasks(agentWorkbenchState.payload);
  renderSelectedTask(agentWorkbenchState.payload);
  updateRunState(agentWorkbenchState.payload);
}

function connectAgentEventStream() {
  agentWorkbenchState.eventSource?.close?.();
  const source = new EventSource('/api/agent-workbench/events');
  agentWorkbenchState.eventSource = source;
  source.addEventListener('ready', () => {
    agentWorkbenchState.streamConnected = true;
  });
  ['task', 'permission', 'question'].forEach(eventName => {
    source.addEventListener(eventName, event => {
      try {
        const payload = JSON.parse(event.data || '{}');
        mergeStreamTask(payload.task);
      } catch {
        // A malformed stream event is ignored; periodic refresh remains available.
      }
    });
  });
  source.addEventListener('terminal', event => {
    try {
      const payload = JSON.parse(event.data || '{}');
      if (payload.workspaceId !== agentWorkbenchState.nativeWorkspaceId) return;
      if (!agentWorkbenchState.nativePayload) agentWorkbenchState.nativePayload = {};
      agentWorkbenchState.nativePayload.terminals = payload.terminals || [];
      renderNativeTerminals(agentWorkbenchState.nativePayload.terminals);
    } catch {
      // 终端事件异常时由手动刷新恢复状态。
    }
  });
  source.addEventListener('task_removed', event => {
    try {
      const payload = JSON.parse(event.data || '{}');
      const tasks = agentWorkbenchState.payload?.tasks || [];
      agentWorkbenchState.payload.tasks = tasks.filter(task => task.id !== payload.taskId);
      if (agentWorkbenchState.selectedTaskId === payload.taskId) {
        agentWorkbenchState.selectedTaskId = '';
        agentWorkbenchState.newSession = true;
      }
      renderTasks(agentWorkbenchState.payload);
      renderSelectedTask(agentWorkbenchState.payload);
    } catch {
      // 周期刷新会兜底恢复会话列表。
    }
  });
  source.onerror = () => {
    agentWorkbenchState.streamConnected = false;
  };
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
    updateConversationFollowButton();
    return;
  }
  const detailState = captureConversationDetails(target);
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
            <div class="agent-message-bubble">${formatAgentText(message.content || '未记录消息内容')}${renderMessageAttachments(message.attachments)}</div>
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
  restoreConversationDetails(target, detailState);
  if (agentWorkbenchState.conversationStickToBottom) scrollConversationToBottom();
  updateConversationFollowButton();
}

function renderMessageAttachments(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return '';
  return `<div class="agent-message-attachments">${attachments.map(item => `
    <span class="agent-message-attachment"><strong>${escapeHtml(item.name || '附件')}</strong><small>${escapeHtml(item.mime || '')} · ${Math.max(1, Math.round(Number(item.size || 0) / 1024))} KB</small></span>
  `).join('')}</div>`;
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
    getElement('agent-use-worktree').disabled = false;
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
    agentWorkbenchState.selectedModelProviderId = task.modelProviderId || '';
    if ([...getElement('agent-agent').options].some(option => option.value === task.agent)) getElement('agent-agent').value = task.agent;
    getElement('agent-use-worktree').checked = Boolean(task.worktree);
    getElement('agent-use-worktree').disabled = true;
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
  const permissionLabels = [
    data.config?.allowNetwork === true ? '允许联网' : '禁止联网',
    data.config?.allowAllDirectories === true ? '允许全目录' : '目录受限',
    data.config?.allowTerminal === true ? '终端逐项审批' : '禁止终端',
  ];
  getElement('agent-security-title').textContent = writeEnabled ? '受控写入已授权' : '只读执行边界';
  getElement('agent-security-detail').textContent = writeEnabled
    ? `build Agent · ${permissionLabels.join(' · ')}`
    : `plan Agent · pure 模式 · ${permissionLabels.join(' · ')} · 不自动批准`;
  getElement('agent-workbench-meta').textContent = `可用 Agent ${data.summary?.availableProviderCount || 0} 个 · 活跃任务 ${data.summary?.activeTaskCount || 0} 个 · ${formatTime(data.generatedAt)}`;
  setStatus(enabled
    ? (writeEnabled ? 'Agent 工作台已启用，实际修改任务需要目录授权并在会话首次写入时确认。' : 'Agent 工作台已启用，当前仅允许只读任务。')
    : 'Agent 工作台保持关闭，不会启动本地 Agent 进程。');
}

function getNativeWorkspaceId() {
  return getElement('agent-workspace')?.value || getSelectedWorkspaceTask()?.workspaceId || 'plugin';
}

function renderNativeList(items, emptyText, renderer) {
  return Array.isArray(items) && items.length
    ? items.map(renderer).join('')
    : `<span class="agent-context-empty">${escapeHtml(emptyText)}</span>`;
}

function renderNativePayload(payload = {}) {
  const data = payload.data || payload;
  agentWorkbenchState.nativePayload = data;
  agentWorkbenchState.nativeWorkspaceId = data.workspace?.id || agentWorkbenchState.nativeWorkspaceId;
  getElement('agent-native-meta').textContent = `${data.workspace?.label || '工作目录'} · ${formatTime(data.generatedAt)}`;
  const errors = Array.isArray(data.errors) ? data.errors.filter(Boolean) : [];
  if (errors.length) getElement('agent-native-session-status').textContent = `部分能力读取失败（${errors.length}）`;
  renderNativeProviders(data);
  renderNativeAgents(data);
  renderNativeTools(data);
  renderNativeSessionState(data);
  renderNativeWorktrees(data.worktrees || []);
  renderNativeTerminals(data.terminals || []);
  renderNativeDiff(agentWorkbenchState.nativeDiff || []);
}

function renderNativeAgents(data = {}) {
  const agents = Array.isArray(data.agents) ? data.agents : [];
  const task = getSelectedWorkspaceTask();
  const values = agents.length ? agents : [{ name: 'plan', description: '只读规划' }, { name: 'build', description: '实际修改' }];
  const options = values.map(agent => `<option value="${escapeHtml(agent.name)}">${escapeHtml(agent.name)}${agent.description ? ` · ${escapeHtml(agent.description)}` : ''}</option>`).join('');
  ['agent-agent', 'agent-native-agent'].forEach(id => {
    const select = getElement(id);
    const previous = id === 'agent-agent' ? (task?.agent || select.value) : (task?.agent || getElement('agent-agent').value);
    select.innerHTML = options;
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  });
  getElement('agent-native-model').value = task?.model || getElement('agent-model').value || '';
}

function renderNativeProviders(data = {}) {
  const providers = Array.isArray(data.providers) ? data.providers : [];
  getElement('agent-native-provider-list').innerHTML = renderNativeList(providers, '没有读取到 OpenCode Provider。', provider => `
    <article class="agent-native-item">
      <div class="agent-native-item-head"><strong>${escapeHtml(provider.name || provider.id)}</strong><span>${provider.connected ? '已连接' : '未连接'}</span></div>
      <code>${escapeHtml(provider.id || '')}</code>
      <div class="agent-native-model-chips">${renderNativeList(provider.models || [], '暂无模型', model => `<button type="button" class="agent-native-chip" data-native-model="${escapeHtml(model.id)}" data-native-model-provider="${escapeHtml(model.providerId || provider.id)}" title="使用 ${escapeHtml(provider.id)}/${escapeHtml(model.id)}">${escapeHtml(model.name || model.id)}</button>`)}</div>
    </article>
  `);
}

function renderNativeTools(data = {}) {
  const mcp = Array.isArray(data.mcp) ? data.mcp : [];
  const skills = Array.isArray(data.skills) ? data.skills : [];
  const commands = Array.isArray(data.commands) ? data.commands : [];
  const runtimes = [
    ...(Array.isArray(data.lsp) ? data.lsp.map(item => ({ ...item, kind: 'LSP' })) : []),
    ...(Array.isArray(data.formatters) ? data.formatters.map(item => ({ ...item, kind: '格式化器' })) : []),
  ];
  getElement('agent-native-mcp-count').textContent = String(mcp.length);
  getElement('agent-native-skill-count').textContent = String(skills.length);
  getElement('agent-native-command-count').textContent = String(commands.length);
  getElement('agent-native-mcp-list').innerHTML = renderNativeList(mcp, '没有配置 MCP。', item => `<div class="agent-native-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.error || item.status || '未知')}</span></div>`);
  getElement('agent-native-skill-list').innerHTML = renderNativeList(skills, '没有发现 Skills。', item => `<button type="button" class="agent-native-search-result" data-native-skill="${escapeHtml(item.name)}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description || item.location || '')}</span></button>`);
  getElement('agent-native-command-list').innerHTML = renderNativeList(commands, '没有发现 Commands。', item => `<button type="button" class="agent-native-search-result" data-native-command="${escapeHtml(item.name)}"><strong>/${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description || item.source || '')}</span></button>`);
  getElement('agent-native-command-select').innerHTML = `<option value="">选择 Command</option>${commands.map(item => `<option value="${escapeHtml(item.name)}">/${escapeHtml(item.name)}</option>`).join('')}`;
  getElement('agent-native-runtime-list').innerHTML = renderNativeList(runtimes, '没有发现语言服务。', item => `<div class="agent-native-row"><strong>${escapeHtml(item.name || item.id || item.kind)}</strong><span>${escapeHtml(item.kind)}</span></div>`);
}

function renderNativeSessionState(data = {}) {
  const todos = Array.isArray(data.todos) ? data.todos : [];
  const children = Array.isArray(data.children) ? data.children : [];
  getElement('agent-native-todo-count').textContent = String(todos.length);
  getElement('agent-native-child-count').textContent = String(children.length);
  getElement('agent-native-todo-list').innerHTML = renderNativeList(todos, '当前会话没有 Todo。', item => `<div class="agent-native-row"><strong>${escapeHtml(item.content)}</strong><span>${escapeHtml(item.status)} · ${escapeHtml(item.priority)}</span></div>`);
  getElement('agent-native-child-list').innerHTML = renderNativeList(children, '当前会话没有子 Agent。', item => `<div class="agent-native-row"><strong>${escapeHtml(item.title || item.id)}</strong><span>${escapeHtml(item.agent || '未指定 Agent')}</span></div>`);
}

function renderNativeWorktrees(worktrees = []) {
  getElement('agent-worktree-list').innerHTML = renderNativeList(worktrees, '当前工作区没有隔离 Worktree。', item => `
    <article class="agent-native-item">
      <div class="agent-native-item-head"><strong>${escapeHtml(item.name || 'Worktree')}</strong><span>${escapeHtml(item.branch || '独立分支')}</span></div>
      <code>${escapeHtml(item.directory || '')}</code>
      <div class="agent-native-row-actions">
        <span>${Number(item.activeTaskCount || 0)} 个会话使用</span>
        <button type="button" data-worktree-action="reset" data-worktree-directory="${escapeHtml(item.directory || '')}">重置</button>
        <button type="button" data-worktree-action="remove" data-worktree-directory="${escapeHtml(item.directory || '')}">删除</button>
      </div>
    </article>
  `);
}

function renderNativeDiff(diffs = []) {
  const target = getElement('agent-native-diff-list');
  target.innerHTML = renderNativeList(diffs, '选择会话后读取 OpenCode Diff。', diff => {
    const file = diff.file || diff.path || diff.filename || '未命名文件';
    const text = diff.diff || diff.patch || diff.content || JSON.stringify(diff, null, 2);
    const restore = diff.status === 'added' ? '' : `<button type="button" class="agent-native-diff-restore" data-diff-restore="${escapeHtml(file)}">恢复此文件</button>`;
    return `<details class="agent-native-item agent-native-diff-item"><summary><strong>${escapeHtml(file)}</strong><span>${escapeHtml(diff.status || '')}${restore}</span></summary><pre>${formatAgentText(text)}</pre></details>`;
  });
}

function renderNativeTerminals(terminals = []) {
  const select = getElement('agent-terminal-select');
  const previous = agentWorkbenchState.selectedTerminalId;
  select.innerHTML = terminals.length
    ? terminals.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || item.id)} · ${escapeHtml(item.status || '')}</option>`).join('')
    : '<option value="">暂无终端</option>';
  agentWorkbenchState.selectedTerminalId = terminals.some(item => item.id === previous) ? previous : (terminals[0]?.id || '');
  select.value = agentWorkbenchState.selectedTerminalId;
  const selected = terminals.find(item => item.id === agentWorkbenchState.selectedTerminalId);
  getElement('agent-terminal-output').textContent = selected?.output || (terminals.length ? '终端暂无输出。' : '受控终端默认关闭，请先在设置中授权。');
  getElement('agent-terminal-close').disabled = !selected;
}

async function loadNativePayload() {
  const task = getSelectedWorkspaceTask();
  const result = await fetchJson(`/api/agent-workbench/native?workspace=${encodeURIComponent(getNativeWorkspaceId())}&task=${encodeURIComponent(task?.id || '')}`);
  renderNativePayload(result);
  return result;
}

function setNativeView(view = 'session') {
  agentWorkbenchState.nativeView = view;
  document.querySelectorAll('[data-native-view]').forEach(button => {
    const active = button.dataset.nativeView === view;
    button.classList.toggle('is-active', active);
    if (active) button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
  document.querySelectorAll('[data-native-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.nativePanel !== view));
}

async function openNativeCenter() {
  getElement('agent-native-mask').classList.remove('hidden');
  setNativeView(agentWorkbenchState.nativeView);
  const task = getSelectedWorkspaceTask();
  getElement('agent-native-session-title').value = task?.title || '';
  getElement('agent-native-model').value = task?.model || getElement('agent-model').value || '';
  getElement('agent-native-session-status').textContent = task ? `${task.providerLabel || 'OpenCode'} · ${task.status || ''}` : '未选择';
  try {
    await loadNativePayload();
    if (task) await loadNativeDiff();
  } catch (error) {
    getElement('agent-native-meta').textContent = `读取失败：${error.message}`;
  }
}

async function loadNativeDiff() {
  const task = getSelectedWorkspaceTask();
  if (!task?.id || !task.opencodeSessionId) {
    agentWorkbenchState.nativeDiff = [];
    renderNativeDiff([]);
    return;
  }
  getElement('agent-native-diff-list').innerHTML = '<span class="agent-context-empty">正在读取 Diff...</span>';
  const result = await fetchJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/diff`);
  agentWorkbenchState.nativeDiff = Array.isArray(result.diffs) ? result.diffs : [];
  renderNativeDiff(agentWorkbenchState.nativeDiff);
}

async function manageNativeSession(action) {
  const task = getSelectedWorkspaceTask();
  if (!task?.id) return webConsoleAlert('请先选择一个已建立的 Agent 会话。');
  let payload = {};
  if (action === 'background') {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/session/background`, {});
    if (result.task) mergeStreamTask(result.task);
    await loadNativePayload();
    await refreshAgentWorkbench({ quiet: true });
    return;
  }
  if (action === 'rename') {
    payload.title = getElement('agent-native-session-title').value.trim();
    if (!payload.title) return webConsoleAlert('请输入会话名称。');
  } else if (action === 'delete') {
    if (!await webConsoleConfirm(`确定删除会话“${task.title || 'Agent 会话'}”吗？`, { title: '删除会话', confirmText: '删除' })) return;
    payload.confirmed = true;
  } else if (action === 'summarize') {
    const model = (agentWorkbenchState.nativePayload?.providers || []).flatMap(provider => (provider.models || []).map(item => ({ provider, item })))[0];
    if (!model) return webConsoleAlert('没有可用模型，无法压缩上下文。');
    payload.providerId = model.provider.id;
    payload.modelId = model.item.id;
  } else if (action === 'revert') {
    const message = [...(task.messages || [])].reverse().find(item => item.role === 'assistant' && item.openCodeMessageId);
    if (!message) return webConsoleAlert('当前会话没有可撤销的消息。');
    payload.messageId = message.openCodeMessageId;
  }
  try {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/session/${action}`, payload);
    if (result.removed) {
      agentWorkbenchState.selectedTaskId = '';
      agentWorkbenchState.newSession = true;
      getElement('agent-native-mask').classList.add('hidden');
    } else if (result.task) {
      if (action === 'fork') agentWorkbenchState.selectedTaskId = result.task.id;
      mergeStreamTask(result.task);
      getElement('agent-native-session-title').value = result.task.title || '';
      await loadNativeDiff();
    }
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(error.message);
  }
}

async function searchNativeWorkspace(event) {
  event?.preventDefault?.();
  const query = getElement('agent-native-search-query').value.trim();
  if (!query) return webConsoleAlert('请输入搜索内容。');
  const target = getElement('agent-native-search-results');
  target.innerHTML = '<span class="agent-context-empty">正在搜索...</span>';
  try {
    const result = await postJson('/api/agent-workbench/search', {
      workspaceId: getNativeWorkspaceId(),
      taskId: getSelectedWorkspaceTask()?.id || '',
      type: getElement('agent-native-search-type').value,
      query,
    });
    const items = Array.isArray(result.results) ? result.results : [];
    target.innerHTML = renderNativeList(items, '没有找到匹配结果。', item => {
      const pathValue = typeof item === 'string' ? item : (item.path || item.file || item.name || '');
      const label = typeof item === 'string' ? item : (item.text || item.symbol || item.path || item.name || JSON.stringify(item));
      return `<button type="button" class="agent-native-search-result" data-search-path="${escapeHtml(pathValue)}"><strong>${escapeHtml(pathValue || '结果')}</strong><span>${escapeHtml(label)}</span></button>`;
    });
  } catch (error) {
    target.innerHTML = `<span class="agent-context-empty">搜索失败：${escapeHtml(error.message)}</span>`;
  }
}

async function restoreNativeDiffFile(file) {
  const task = getSelectedWorkspaceTask();
  if (!task?.id) return webConsoleAlert('请先选择一个 Agent 会话。');
  const confirmed = await webConsoleConfirm(`确定恢复“${file}”到当前 Git HEAD 吗？该文件的未提交修改会丢失。`, {
    title: '恢复单个文件', confirmText: '确认恢复',
  });
  if (!confirmed) return;
  const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/diff/restore`, { file, confirmed: true });
  if (result.task) mergeStreamTask(result.task);
  await loadNativeDiff();
  await refreshAgentWorkbench({ quiet: true });
}

async function executeNativeCommand(event) {
  event?.preventDefault?.();
  const task = getSelectedWorkspaceTask();
  if (!task?.id) return webConsoleAlert('请先选择一个已建立的 Agent 会话。');
  const command = getElement('agent-native-command-select').value;
  if (!command) return webConsoleAlert('请选择需要执行的 Command。');
  const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/command`, {
    command,
    arguments: getElement('agent-native-command-args').value.trim(),
    agent: getElement('agent-native-agent').value,
    model: getElement('agent-native-model').value.trim(),
    modelProviderId: agentWorkbenchState.selectedModelProviderId,
  });
  if (result.task) mergeStreamTask(result.task);
  getElement('agent-native-command-args').value = '';
  await refreshAgentWorkbench({ quiet: true });
  await loadNativePayload();
}

function insertNativeSkill(name) {
  const prompt = getElement('agent-prompt');
  const prefix = `使用 skill: ${name}`;
  prompt.value = prompt.value.trim() ? `${prompt.value.trim()}\n\n${prefix}` : prefix;
  getElement('agent-native-mask').classList.add('hidden');
  prompt.focus();
}

async function manageNativeWorktree(action, directory = '') {
  const workspaceId = getNativeWorkspaceId();
  if (action === 'create') {
    const name = getElement('agent-worktree-name').value.trim();
    if (!name) return webConsoleAlert('请输入 Worktree 名称。');
    const confirmed = await webConsoleConfirm('创建 Worktree 会建立独立 Git 工作目录，并可能执行项目启动脚本。是否继续？', {
      title: '创建 Worktree', confirmText: '创建',
    });
    if (!confirmed) return;
    await postJson('/api/agent-workbench/worktrees/create', { workspaceId, name, confirmed: true });
    getElement('agent-worktree-name').value = '';
  } else {
    const verb = action === 'reset' ? '重置' : '删除';
    const warning = action === 'reset'
      ? '重置会丢弃该 Worktree 中尚未提交的修改。'
      : '删除会移除该 Worktree 和对应分支，且不会自动备份。';
    const confirmed = await webConsoleConfirm(`${warning}\n\n目录：${directory}`, { title: `${verb} Worktree`, confirmText: verb });
    if (!confirmed) return;
    await postJson(`/api/agent-workbench/worktrees/${action}`, { workspaceId, directory, confirmed: true });
  }
  await loadNativePayload();
}

async function createNativeTerminal() {
  if (agentWorkbenchState.payload?.config?.allowTerminal !== true) return webConsoleAlert('请先在工作台设置中开启受控终端。');
  const confirmed = await webConsoleConfirm('受控终端可以执行工作目录中的命令。请确认已了解风险并自行核对命令。', { title: '开启受控终端', confirmText: '开启终端' });
  if (!confirmed) return;
  try {
    const result = await postJson('/api/agent-workbench/terminals', { workspaceId: getNativeWorkspaceId(), confirmed: true });
    agentWorkbenchState.selectedTerminalId = result.terminal?.id || '';
    await loadNativePayload();
  } catch (error) {
    await webConsoleAlert(error.message);
  }
}

async function submitNativeTerminalInput(event) {
  event?.preventDefault?.();
  const terminalId = agentWorkbenchState.selectedTerminalId;
  const input = getElement('agent-terminal-input').value;
  if (!terminalId || !input) return;
  try {
    await postJson(`/api/agent-workbench/terminals/${encodeURIComponent(terminalId)}/input`, { input: `${input}\r` });
    getElement('agent-terminal-input').value = '';
    await loadNativePayload();
  } catch (error) {
    await webConsoleAlert(error.message);
  }
}

async function closeNativeTerminal() {
  const terminalId = agentWorkbenchState.selectedTerminalId;
  if (!terminalId) return;
  try {
    await postJson(`/api/agent-workbench/terminals/${encodeURIComponent(terminalId)}/close`, {});
    agentWorkbenchState.selectedTerminalId = '';
    await loadNativePayload();
  } catch (error) {
    await webConsoleAlert(error.message);
  }
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
    allowNetwork: getElement('agent-allow-network').checked === true,
    allowAllDirectories: getElement('agent-allow-all-directories').checked === true,
    allowTerminal: getElement('agent-allow-terminal').checked === true,
    defaultProvider: getElement('agent-default-provider').value || 'opencode',
    customApi: {
      enabled: getElement('agent-custom-api-enabled').checked === true,
      baseApi: getElement('agent-custom-api-base').value || '',
      apiKey: getElement('agent-custom-api-key').value || '',
      model: getElement('agent-custom-api-model').value || '',
      userAgent: getElement('agent-custom-api-ua').value || '',
    },
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
  const selectedAgent = getElement('agent-agent').value || (writeMode ? 'build' : 'plan');
  const useWorktree = !continuing && getElement('agent-use-worktree').checked === true;
  let worktreeConfirmed = false;
  if (useWorktree) {
    worktreeConfirmed = await webConsoleConfirm('将为本次会话创建独立 Git Worktree。它不会自动删除，后续可在 OpenCode 能力中心手动管理。是否继续？', {
      title: '启用 Worktree 隔离', confirmText: '创建并使用',
    });
    if (!worktreeConfirmed) return;
  }
  let writeConfirmed = selectedTask?.writeConfirmed === true;
  if (writeMode && !writeConfirmed) {
    const commandPreview = continuing && selectedTask.opencodeSessionId
      ? `opencode run --pure --format json --agent ${selectedAgent} --dir "${workspace?.path || workspaceId}" --session ${selectedTask.opencodeSessionId} [你的消息]`
      : `opencode run --pure --format json --agent ${selectedAgent} --dir "${workspace?.path || workspaceId}" [你的任务]`;
    writeConfirmed = await webConsoleConfirm([
        `将使用 ${provider?.label || providerId} 直接修改“${workspace?.label || workspaceId}”中的文件。`,
        `权限范围：${agentWorkbenchState.payload?.config?.allowNetwork === true ? '允许联网' : '禁止联网'} · ${agentWorkbenchState.payload?.config?.allowAllDirectories === true ? '允许访问全目录' : '仅限工作目录'}。`,
        '',
        '重要提醒：务必先备份需要保留的文件，并在继续前看清下面的执行命令。高权限会话可能读取工作目录外文件或访问网络，请确认后再继续。',
        '',
        `执行命令：${commandPreview}`,
        '',
        agentWorkbenchState.payload?.config?.allowTerminal === true
          ? 'Agent 请求终端命令时会暂停，必须在审批卡中逐项决定。是否继续？'
          : 'Agent 不能执行终端命令。是否继续？',
      ].join('\n'), {
        title: '首次写入确认',
        confirmText: '已备份并允许本会话写入',
      });
    if (!writeConfirmed) return;
  }
  agentWorkbenchState.conversationStickToBottom = true;
  updateConversationFollowButton();
  setButtonBusy('agent-run-btn', true, writeMode ? '发送并修改' : '发送', '启动中...');
  try {
    const result = await postJson('/api/agent-workbench/tasks', {
      confirmed: true,
      writeConfirmed: writeMode && writeConfirmed,
      providerId,
      workspaceId,
      mode,
      agent: selectedAgent,
      model: String(getElement('agent-model').value || '').trim(),
      modelProviderId: agentWorkbenchState.selectedModelProviderId,
      title: String(getElement('agent-title').value || '').trim(),
      prompt,
      attachments: agentWorkbenchState.composerAttachments,
      sessionId: continuing ? selectedTask.id : '',
      useWorktree,
      worktreeConfirmed,
    });
    agentWorkbenchState.selectedTaskId = result.task?.id || '';
    agentWorkbenchState.newSession = false;
    getElement('agent-prompt').value = '';
    getElement('agent-title').value = '';
    agentWorkbenchState.composerAttachments = [];
    renderComposerAttachments();
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(error.message);
  } finally {
    setButtonBusy('agent-run-btn', false, writeMode ? '发送并修改' : '发送', '启动中...');
    updateRunState(agentWorkbenchState.payload || {});
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取附件失败'));
    reader.readAsDataURL(file);
  });
}

function renderComposerAttachments() {
  const target = getElement('agent-attachment-list');
  const attachments = agentWorkbenchState.composerAttachments;
  target.innerHTML = attachments.length
    ? attachments.map((item, index) => `<span class="agent-attachment-chip"><strong>${escapeHtml(item.name)}</strong><small>${Math.max(1, Math.round(item.size / 1024))} KB</small><button type="button" data-attachment-remove="${index}" aria-label="移除附件">×</button></span>`).join('')
    : '';
}

async function addComposerAttachments(event) {
  const files = [...(event.target.files || [])];
  event.target.value = '';
  for (const file of files) {
    if (agentWorkbenchState.composerAttachments.length >= 4) break;
    if (file.size > 5 * 1024 * 1024) {
      await webConsoleAlert(`附件“${file.name}”超过 5 MB。`);
      continue;
    }
    try {
      const url = await readFileAsDataUrl(file);
      agentWorkbenchState.composerAttachments.push({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, url });
    } catch (error) {
      await webConsoleAlert(`${file.name}：${error.message}`);
    }
  }
  renderComposerAttachments();
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
  getElement('agent-output').addEventListener('scroll', handleConversationScroll, { passive: true });
  getElement('agent-jump-bottom').addEventListener('click', () => {
    agentWorkbenchState.conversationStickToBottom = true;
    scrollConversationToBottom(true);
  });
  getElement('agent-refresh-btn').addEventListener('click', () => {
    refreshAgentWorkbench({ force: true }).catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-save-btn').addEventListener('click', () => {
    saveSettings().catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-composer-form').addEventListener('submit', runTask);
  getElement('agent-attachment-btn').addEventListener('click', () => getElement('agent-attachment-input').click());
  getElement('agent-attachment-input').addEventListener('change', event => addComposerAttachments(event).catch(error => webConsoleAlert(error.message)));
  getElement('agent-attachment-list').addEventListener('click', event => {
    const button = event.target.closest?.('[data-attachment-remove]');
    if (!button) return;
    agentWorkbenchState.composerAttachments.splice(Number(button.dataset.attachmentRemove), 1);
    renderComposerAttachments();
  });
  getElement('agent-prompt').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    runTask(event);
  });
  getElement('agent-cancel-btn').addEventListener('click', () => {
    cancelSelectedTask().catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-permission-list').addEventListener('click', event => {
    const button = event.target.closest?.('[data-permission-reply]');
    const card = button?.closest?.('[data-permission-id]');
    const task = getSelectedWorkspaceTask();
    if (!button || !card || !task) return;
    replyAgentPermission(task.id, card.dataset.permissionId || '', button.dataset.permissionReply || 'reject').catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-question-list').addEventListener('click', event => {
    const button = event.target.closest?.('[data-question-reply]');
    const card = button?.closest?.('[data-question-id]');
    const task = getSelectedWorkspaceTask();
    if (!button || !card || !task) return;
    replyAgentQuestion(task.id, card.dataset.questionId || '', card, button.dataset.questionReply === 'reject')
      .catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-context-file-list').addEventListener('click', event => {
    const item = event.target.closest?.('[data-agent-file]');
    if (item?.dataset.agentFile) openAgentFile(item.dataset.agentFile).catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-file-tree').addEventListener('click', event => {
    const item = event.target.closest?.('[data-agent-file-path]');
    if (!item) return;
    if (item.dataset.agentFileType === 'directory') loadAgentFileTree(item.dataset.agentFilePath).catch(error => webConsoleAlert(error.message));
    else openAgentFile(item.dataset.agentFilePath).catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-file-refresh-btn').addEventListener('click', () => loadAgentFileTree().catch(error => webConsoleAlert(error.message)));
  getElement('agent-file-up-btn').addEventListener('click', () => {
    const parts = String(agentWorkbenchState.filePath || '').split('/').filter(Boolean);
    parts.pop();
    loadAgentFileTree(parts.join('/')).catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-file-editor-close').addEventListener('click', () => {
    getElement('agent-file-editor-mask').classList.add('hidden');
  });
  getElement('agent-file-editor-mask').addEventListener('click', event => {
    if (event.target === getElement('agent-file-editor-mask')) getElement('agent-file-editor-mask').classList.add('hidden');
  });
  getElement('agent-file-editor-save').addEventListener('click', () => saveAgentFile().catch(error => webConsoleAlert(error.message)));
  getElement('agent-file-editor-content').addEventListener('input', markEditorDirty);
  getElement('agent-file-editor-tabs').addEventListener('click', event => {
    const tab = event.target.closest?.('[data-editor-tab]');
    if (!tab) return;
    const pathValue = tab.dataset.editorTab || '';
    if (event.target.closest?.('[data-editor-tab-close]')) {
      closeEditorTab(pathValue).catch(error => webConsoleAlert(error.message));
      return;
    }
    openAgentFile(pathValue).catch(error => webConsoleAlert(error.message));
  });
  const startNewSession = () => {
    agentWorkbenchState.selectedTaskId = '';
    agentWorkbenchState.newSession = true;
    agentWorkbenchState.conversationStickToBottom = true;
    agentWorkbenchState.formTaskId = '';
    getElement('agent-title').value = '';
    getElement('agent-prompt').value = '';
    getElement('agent-use-worktree').checked = false;
    getElement('agent-use-worktree').disabled = false;
    getElement('agent-agent').value = getElement('agent-mode').value === 'edit' ? 'build' : 'plan';
    agentWorkbenchState.selectedModelProviderId = '';
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
    agentWorkbenchState.conversationStickToBottom = true;
    agentWorkbenchState.formTaskId = '';
    renderTasks(agentWorkbenchState.payload || {});
    renderSelectedTask(agentWorkbenchState.payload || {});
    refreshAgentWorkbench({ quiet: true }).catch(error => webConsoleAlert(error.message));
  });
  [
    'agent-enabled',
    'agent-write-enabled',
    'agent-allow-network',
    'agent-allow-all-directories',
    'agent-allow-terminal',
    'agent-default-provider',
    'agent-custom-api-enabled',
    'agent-custom-api-base',
    'agent-custom-api-key',
    'agent-custom-api-model',
    'agent-custom-api-ua',
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
  getElement('agent-custom-api-enabled').addEventListener('change', updateCustomApiFields);
  ['agent-provider', 'agent-workspace', 'agent-mode'].forEach(id => {
    getElement(id).addEventListener('change', event => {
      if (id === 'agent-mode' && agentWorkbenchState.newSession) getElement('agent-agent').value = event.target.value === 'edit' ? 'build' : 'plan';
      updateRunState(agentWorkbenchState.payload || {});
    });
  });
  getElement('agent-native-toggle').addEventListener('click', () => openNativeCenter().catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-close').addEventListener('click', () => getElement('agent-native-mask').classList.add('hidden'));
  getElement('agent-native-mask').addEventListener('click', event => {
    if (event.target === getElement('agent-native-mask')) getElement('agent-native-mask').classList.add('hidden');
  });
  document.querySelectorAll('[data-native-view]').forEach(button => {
    button.addEventListener('click', () => setNativeView(button.dataset.nativeView || 'session'));
  });
  getElement('agent-native-diff-refresh').addEventListener('click', () => loadNativeDiff().catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-diff-list').addEventListener('click', event => {
    const button = event.target.closest?.('[data-diff-restore]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    restoreNativeDiffFile(button.dataset.diffRestore || '').catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-native-search-form').addEventListener('submit', event => searchNativeWorkspace(event).catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-search-results').addEventListener('click', event => {
    const item = event.target.closest?.('[data-search-path]');
    if (!item?.dataset.searchPath) return;
    if (getNativeWorkspaceId() === 'plugin') openAgentFile(item.dataset.searchPath).catch(error => webConsoleAlert(error.message));
    else webConsoleAlert(`搜索结果：${item.dataset.searchPath}`);
  });
  document.querySelectorAll('[data-session-action]').forEach(button => {
    button.addEventListener('click', () => manageNativeSession(button.dataset.sessionAction || '').catch(error => webConsoleAlert(error.message)));
  });
  getElement('agent-terminal-select').addEventListener('change', event => {
    agentWorkbenchState.selectedTerminalId = event.target.value || '';
    renderNativeTerminals(agentWorkbenchState.nativePayload?.terminals || []);
  });
  getElement('agent-terminal-create').addEventListener('click', () => createNativeTerminal().catch(error => webConsoleAlert(error.message)));
  getElement('agent-terminal-close').addEventListener('click', () => closeNativeTerminal().catch(error => webConsoleAlert(error.message)));
  getElement('agent-terminal-form').addEventListener('submit', event => submitNativeTerminalInput(event).catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-provider-list').addEventListener('click', event => {
    const model = event.target.closest?.('[data-native-model]');
    if (!model) return;
    getElement('agent-model').value = model.dataset.nativeModel || '';
    getElement('agent-native-model').value = model.dataset.nativeModel || '';
    agentWorkbenchState.selectedModelProviderId = model.dataset.nativeModelProvider || '';
    setStatus(`已选择模型：${model.dataset.nativeModel || '默认模型'}`);
  });
  getElement('agent-native-agent').addEventListener('change', event => {
    getElement('agent-agent').value = event.target.value;
  });
  getElement('agent-native-model').addEventListener('input', event => {
    getElement('agent-model').value = event.target.value;
    agentWorkbenchState.selectedModelProviderId = '';
  });
  getElement('agent-agent').addEventListener('change', event => {
    if ([...getElement('agent-native-agent').options].some(option => option.value === event.target.value)) {
      getElement('agent-native-agent').value = event.target.value;
    }
  });
  getElement('agent-model').addEventListener('input', () => {
    agentWorkbenchState.selectedModelProviderId = '';
  });
  getElement('agent-native-command-form').addEventListener('submit', event => executeNativeCommand(event).catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-command-list').addEventListener('click', event => {
    const command = event.target.closest?.('[data-native-command]');
    if (!command) return;
    getElement('agent-native-command-select').value = command.dataset.nativeCommand || '';
    getElement('agent-native-command-args').focus();
  });
  getElement('agent-native-skill-list').addEventListener('click', event => {
    const skill = event.target.closest?.('[data-native-skill]');
    if (skill) insertNativeSkill(skill.dataset.nativeSkill || '');
  });
  getElement('agent-worktree-create-form').addEventListener('submit', event => {
    event.preventDefault();
    manageNativeWorktree('create').catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-worktree-list').addEventListener('click', event => {
    const button = event.target.closest?.('[data-worktree-action]');
    if (!button) return;
    manageNativeWorktree(button.dataset.worktreeAction || '', button.dataset.worktreeDirectory || '').catch(error => webConsoleAlert(error.message));
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    getElement('agent-native-mask').classList.add('hidden');
    getElement('agent-file-editor-mask').classList.add('hidden');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  refreshAgentWorkbench().then(() => connectAgentEventStream()).catch(error => webConsoleAlert(error.message));
  agentWorkbenchState.pollTimer = window.setInterval(() => {
    refreshAgentWorkbench({ quiet: true }).catch(() => {});
  }, 12000);
});

window.addEventListener('beforeunload', () => {
  if (agentWorkbenchState.pollTimer) window.clearInterval(agentWorkbenchState.pollTimer);
  agentWorkbenchState.eventSource?.close?.();
});
