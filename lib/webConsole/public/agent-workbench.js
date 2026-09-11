const agentWorkbenchState = {
  payload: null,
  selectedTaskId: '',
  settingsDirty: false,
  initialized: false,
  refreshing: false,
  pollTimer: null,
  lastFullRefreshAt: 0,
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
  nativeHistoryByTask: new Map(),
  openCodeRuntimes: [],
  runtimeLoading: false,
  runtimePollTimer: null,
  nativeWorkspaceId: '',
  nativeView: 'session',
  selectedTerminalId: '',
  selectedModelProviderId: '',
  gitSelectedFiles: [],
  terminalHistory: [],
  terminalHistoryIndex: -1,
  sessionQuery: '',
  includeArchived: false,
  monacoEditor: null,
  monacoReady: null,
  xterm: null,
  xtermFit: null,
  xtermTerminalId: '',
  xtermRenderedOutput: '',
  terminalInputQueue: Promise.resolve(),
  terminalResizeTimer: 0,
  slashMenuOpen: false,
  slashActiveIndex: 0,
  slashVisibleCommands: [],
  slashCommandsLoading: false,
  slashCommandsLoaded: false,
  slashCommandsPromise: null,
  slashCommandBusy: false,
  slashCommandBusyText: '',
  slashCommandNotice: '',
  slashCommandNoticeTone: 'neutral',
  slashCommandNoticeUntil: 0,
  followUpDelivery: 'steer',
  contextCollapsed: false,
};

const agentContextCollapsedStorageKey = 'crystelf.agentWorkbench.contextCollapsed';

const agentSlashCommands = Object.freeze([
  { name: 'compact', aliases: ['summarize'], label: '压缩上下文', description: '压缩当前会话，释放上下文空间', kind: 'session', action: 'summarize' },
  { name: 'undo', aliases: ['revert'], label: '撤销上一轮', description: '撤销最近一轮回复及其文件改动', kind: 'session', action: 'revert' },
  { name: 'redo', aliases: ['unrevert'], label: '恢复撤销', description: '恢复最近一次被撤销的内容', kind: 'session', action: 'unrevert' },
  { name: 'fork', aliases: [], label: '创建分支', description: '从当前会话创建独立分支', kind: 'session', action: 'fork' },
  { name: 'rename', aliases: [], label: '重命名会话', description: '用法：/rename 新名称', kind: 'session', action: 'rename', requiresArgument: true },
  { name: 'stop', aliases: ['cancel'], label: '停止任务', description: '取消当前正在执行的 Agent 任务', kind: 'workspace', action: 'stop' },
  { name: 'new', aliases: [], label: '新建会话', description: '清空输入区并开始一个新会话', kind: 'workspace', action: 'new' },
  { name: 'models', aliases: [], label: '选择模型', description: '打开 OpenCode 模型列表', kind: 'workspace', action: 'models' },
  { name: 'commands', aliases: [], label: 'Command 列表', description: '打开 OpenCode 自定义 Command', kind: 'workspace', action: 'commands' },
  { name: 'sessions', aliases: [], label: '会话列表', description: '打开并搜索已有 Agent 会话', kind: 'workspace', action: 'sessions' },
  { name: 'archive', aliases: [], label: '归档会话', description: '把当前会话移入归档列表', kind: 'workspace', action: 'archive' },
  { name: 'unarchive', aliases: [], label: '取消归档', description: '把当前会话恢复到最近会话列表', kind: 'workspace', action: 'unarchive' },
  { name: 'delete', aliases: [], label: '删除会话', description: '删除当前工作台记录及对应 OpenCode 会话', kind: 'workspace', action: 'delete' },
  { name: 'export', aliases: [], label: '导出会话', description: '将当前会话导出为 JSON 文件', kind: 'workspace', action: 'export' },
  { name: 'status', aliases: [], label: '会话状态', description: '打开当前 OpenCode 会话与 Diff 状态', kind: 'workspace', action: 'status' },
  { name: 'terminal', aliases: [], label: '受控终端', description: '打开 OpenCode 受控终端', kind: 'workspace', action: 'terminal' },
  { name: 'search', aliases: [], label: '工作区搜索', description: '打开文件、全文与符号搜索', kind: 'workspace', action: 'search' },
  { name: 'worktrees', aliases: ['worktree'], label: 'Worktree 管理', description: '打开隔离工作目录管理', kind: 'workspace', action: 'worktrees' },
  { name: 'help', aliases: [], label: '命令帮助', description: '显示当前可用的斜杠命令', kind: 'workspace', action: 'help' },
]);

const { fetchJson, postJson } = window.CrystelfRequest || {};
const ui = window.CrystelfUi || {};

function getElement(id) {
  return document.getElementById(id);
}

function getEditorContent() {
  const editor = agentWorkbenchState.monacoEditor;
  if (editor && !getElement('agent-monaco-editor')?.classList.contains('hidden')) {
    return editor.getValue();
  }
  return getElement('agent-file-editor-content')?.value || '';
}

function getEditorLanguage(filePath = '') {
  const extension = String(filePath || '').split('.').pop()?.toLowerCase() || '';
  return {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    json: 'json', md: 'markdown', html: 'html', css: 'css',
    yml: 'yaml', yaml: 'yaml', py: 'python', sh: 'shell', ps1: 'powershell',
  }[extension] || 'plaintext';
}

async function ensureMonacoEditor() {
  if (agentWorkbenchState.monacoReady) return agentWorkbenchState.monacoReady;
  agentWorkbenchState.monacoReady = new Promise(resolve => {
    const loader = window.require;
    if (typeof loader !== 'function' || !window.monaco) {
      if (typeof loader !== 'function') resolve(false);
      else loader.config({ paths: { vs: '/vendor/monaco/vs' } });
    }
    const amdRequire = window.require;
    if (typeof amdRequire !== 'function') {
      resolve(false);
      return;
    }
    amdRequire(['vs/editor/editor.main'], () => {
      try {
        const container = getElement('agent-monaco-editor');
        if (!container) return resolve(false);
        agentWorkbenchState.monacoEditor = window.monaco.editor.create(container, {
          value: '',
          language: 'plaintext',
          theme: document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'on',
          wordWrap: 'on',
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
        });
        agentWorkbenchState.monacoEditor.onDidChangeModelContent(() => markEditorDirty());
        resolve(true);
      } catch {
        resolve(false);
      }
    }, () => resolve(false));
  });
  return agentWorkbenchState.monacoReady;
}

async function setEditorContent(content = '', filePath = '', readOnly = true) {
  const textarea = getElement('agent-file-editor-content');
  textarea.value = content;
  const available = await ensureMonacoEditor();
  const container = getElement('agent-monaco-editor');
  if (!available || !agentWorkbenchState.monacoEditor || !container) {
    container?.classList.add('hidden');
    textarea.classList.remove('hidden');
    textarea.readOnly = readOnly;
    return false;
  }
  container.classList.remove('hidden');
  textarea.classList.add('hidden');
  const editor = agentWorkbenchState.monacoEditor;
  const model = editor.getModel();
  if (model) {
    window.monaco.editor.setModelLanguage(model, getEditorLanguage(filePath));
    model.setValue(content);
  }
  editor.updateOptions({ readOnly });
  editor.layout();
  return true;
}

function ensureXterm() {
  if (agentWorkbenchState.xterm) return true;
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon?.FitAddon;
  const container = getElement('agent-terminal-output');
  if (typeof Terminal !== 'function' || !container) return false;
  try {
    const terminal = new Terminal({ convertEol: true, cursorBlink: true, scrollback: 5000, fontSize: 12, theme: { background: '#0b1220' } });
    const fit = typeof FitAddon === 'function' ? new FitAddon() : null;
    terminal.open(container);
    if (fit) {
      terminal.loadAddon(fit);
      fit.fit();
    }
    agentWorkbenchState.xterm = terminal;
    agentWorkbenchState.xtermFit = fit;
    terminal.onData(data => {
      sendNativeTerminalInput(data).catch(error => setStatus(`终端输入失败：${error.message}`, 'error'));
    });
    terminal.onResize(size => {
      const terminalId = agentWorkbenchState.selectedTerminalId;
      if (!terminalId) return;
      clearTimeout(agentWorkbenchState.terminalResizeTimer);
      agentWorkbenchState.terminalResizeTimer = setTimeout(() => {
        postJson(`/api/agent-workbench/terminals/${encodeURIComponent(terminalId)}/resize`, {
          rows: size.rows,
          cols: size.cols,
        }).catch(() => {});
      }, 120);
    });
    window.addEventListener('resize', () => agentWorkbenchState.xtermFit?.fit?.(), { passive: true });
    return true;
  } catch {
    return false;
  }
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
  let label = String(detail.dataset.detailKey || '').trim();
  if (!label) {
    label = Array.from(summary?.childNodes || [])
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent || '')
      .join('')
      .trim();
  }
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

function formatCompactRelativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!value || Number.isNaN(timestamp)) return '暂无';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}月`;
  return `${Math.floor(months / 12)}年`;
}

function formatDuration(ms = 0) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain ? `${minutes} 分 ${remain} 秒` : `${minutes} 分钟`;
}

function formatMemorySize(bytes = 0) {
  const value = Math.max(0, Number(bytes || 0));
  if (!value) return '未知';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatPercent(value = null) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : '采样中';
}

function formatTokenCount(value = 0) {
  const number = Math.max(0, Number(value || 0));
  if (!Number.isFinite(number)) return '0';
  return Math.round(number).toLocaleString('zh-CN');
}

function formatContextTokenCount(value = 0) {
  const number = Math.max(0, Number(value || 0));
  if (!Number.isFinite(number)) return '0';
  if (number < 10000) return Math.round(number).toLocaleString('zh-CN');
  const units = number / 10000;
  const digits = units >= 100 ? 0 : (units >= 10 ? 1 : 2);
  return `${Number(units.toFixed(digits))}万`;
}

function getChangeKind(item = {}) {
  const explicit = String(item.kind || '').toLowerCase();
  if (['added', 'deleted', 'modified', 'renamed'].includes(explicit)) return explicit;
  const status = String(item.status || '').toUpperCase();
  if (status.includes('??') || status.includes('A')) return 'added';
  if (status.includes('D')) return 'deleted';
  if (status.includes('R')) return 'renamed';
  return 'modified';
}

function getChangeSymbol(kind = 'modified') {
  return kind === 'added' ? '+' : (kind === 'deleted' ? '-' : (kind === 'renamed' ? '>' : '~'));
}

function getChangeLabel(kind = 'modified') {
  return kind === 'added' ? '新增' : (kind === 'deleted' ? '删除' : (kind === 'renamed' ? '重命名' : '修改'));
}

function summarizeChanges(items = [], provided = null) {
  const files = Array.isArray(items) ? items : [];
  const summary = {
    files: files.length,
    additions: 0,
    deletions: 0,
    addedFiles: 0,
    deletedFiles: 0,
    modifiedFiles: 0,
    renamedFiles: 0,
  };
  files.forEach(item => {
    const kind = getChangeKind(item);
    summary.additions += Math.max(0, Number(item.additions || 0));
    summary.deletions += Math.max(0, Number(item.deletions || 0));
    if (kind === 'added') summary.addedFiles += 1;
    else if (kind === 'deleted') summary.deletedFiles += 1;
    else if (kind === 'renamed') summary.renamedFiles += 1;
    else summary.modifiedFiles += 1;
  });
  if (!provided || typeof provided !== 'object') return summary;
  return Object.fromEntries(Object.keys(summary).map(key => [
    key,
    Number.isFinite(Number(provided[key])) ? Math.max(0, Number(provided[key])) : summary[key],
  ]));
}

function renderChangeSummary(summary = {}, options = {}) {
  const normalized = summarizeChanges([], summary);
  if (!normalized.files) return options.emptyText || '';
  const parts = [
    `<span class="agent-change-count is-added">+${formatTokenCount(normalized.additions)}</span>`,
    `<span class="agent-change-count is-deleted">-${formatTokenCount(normalized.deletions)}</span>`,
  ];
  if (normalized.addedFiles) parts.push(`<span class="agent-change-kind is-added">${normalized.addedFiles} 新增</span>`);
  if (normalized.deletedFiles) parts.push(`<span class="agent-change-kind is-deleted">${normalized.deletedFiles} 删除</span>`);
  if (normalized.modifiedFiles) parts.push(`<span class="agent-change-kind is-modified">${normalized.modifiedFiles} 修改</span>`);
  if (normalized.renamedFiles) parts.push(`<span class="agent-change-kind is-renamed">${normalized.renamedFiles} 重命名</span>`);
  if (options.includeFiles !== false) parts.push(`<span class="agent-change-files">${normalized.files} 文件</span>`);
  return parts.join('<span class="agent-change-separator">·</span>');
}

function renderChangeBadge(item = {}) {
  const kind = getChangeKind(item);
  const additions = Math.max(0, Number(item.additions || 0));
  const deletions = Math.max(0, Number(item.deletions || 0));
  const counts = additions || deletions ? ` +${formatTokenCount(additions)} -${formatTokenCount(deletions)}` : '';
  return `<span class="agent-change-badge is-${kind}"><strong>${getChangeSymbol(kind)}</strong>${getChangeLabel(kind)}${counts}</span>`;
}

function renderDiffText(value = '') {
  return String(value || '').split(/\r?\n/).map(line => {
    const className = line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')
      ? 'agent-diff-line is-meta'
      : (line.startsWith('+') ? 'agent-diff-line is-added' : (line.startsWith('-') ? 'agent-diff-line is-deleted' : 'agent-diff-line'));
    return `<span class="${className}">${escapeHtml(line) || '&nbsp;'}</span>`;
  }).join('\n');
}

function renderUsageMeta(usage = {}) {
  usage = usage && typeof usage === 'object' ? usage : {};
  const input = Math.max(0, Number(usage.input || 0));
  const output = Math.max(0, Number(usage.output || 0));
  const total = Math.max(0, Number(usage.total || input + output));
  if (!total) return '';
  return `<div class="agent-usage-meta" title="本轮模型 Token 用量">Token ${formatTokenCount(total)} · 输入 ${formatTokenCount(input)} · 输出 ${formatTokenCount(output)}</div>`;
}

function getStatusMeta(status = '') {
  const key = String(status || '').toLowerCase();
  if (key === 'success') return { label: '已完成', tone: 'success' };
  if (key === 'error') return { label: '失败', tone: 'error' };
  if (key === 'running') return { label: '执行中', tone: 'warn' };
  if (key === 'pending') return { label: '排队中', tone: 'warn' };
  if (key === 'interrupted') return { label: '已中断', tone: 'error' };
  if (key === 'canceled') return { label: '已取消', tone: 'neutral' };
  return { label: '未知', tone: 'neutral' };
}

function getPriorityLabel(priority = '') {
  return { high: '高', low: '低' }[String(priority || '').toLowerCase()] || '普通';
}

const agentVariantLabels = {
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
};
const agentCustomVariantOption = '__custom__';

function getVariantLabel(variant = '') {
  const value = String(variant || '').trim();
  return agentVariantLabels[value.toLowerCase()] || value || '默认';
}

function getSelectedModelVariant() {
  const select = getElement('agent-variant');
  if (!select) return '';
  return select.value === agentCustomVariantOption
    ? String(getElement('agent-variant-custom')?.value || '').trim()
    : String(select.value || '').trim();
}

function updateCustomVariantField(customValue = '') {
  const select = getElement('agent-variant');
  const input = getElement('agent-variant-custom');
  const control = getElement('agent-variant-control');
  if (!select || !input || !control) return;
  const custom = select.value === agentCustomVariantOption;
  input.classList.toggle('hidden', !custom);
  control.classList.toggle('has-custom', custom);
  if (custom && customValue !== undefined) input.value = String(customValue || '').trim();
  if (!custom) input.value = '';
}

function getSelectedNativeModel() {
  const modelId = String(getElement('agent-model')?.value || '').trim();
  const providerId = String(agentWorkbenchState.selectedModelProviderId || '').trim();
  if (!modelId) return null;
  const providers = Array.isArray(agentWorkbenchState.nativePayload?.providers)
    ? agentWorkbenchState.nativePayload.providers
    : [];
  const models = providers.flatMap(provider => (provider.models || []).map(model => ({
    ...model,
    providerId: model.providerId || provider.id,
  })));
  return models.find(model => model.id === modelId && (!providerId || model.providerId === providerId))
    || models.find(model => model.id === modelId)
    || null;
}

function updateModelVariantOptions(preferredValue) {
  const select = getElement('agent-variant');
  if (!select) return;
  const preferred = String(preferredValue === undefined ? getSelectedModelVariant() : preferredValue || '').trim();
  const model = getSelectedNativeModel();
  const modelVariants = Array.isArray(model?.variants) ? model.variants.filter(Boolean) : [];
  const knownVariants = Object.keys(agentVariantLabels);
  const values = modelVariants.length ? modelVariants : knownVariants;
  const seen = new Set();
  const availableValues = values.map(value => String(value).trim()).filter(value => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const matchedValue = availableValues.find(value => value.toLowerCase() === preferred.toLowerCase()) || '';
  const customValue = preferred && !matchedValue ? preferred : '';
  select.innerHTML = [
    '<option value="">默认</option>',
    ...availableValues.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(getVariantLabel(value))}</option>`),
    `<option value="${agentCustomVariantOption}">自定义</option>`,
  ].join('');
  select.disabled = false;
  select.value = customValue ? agentCustomVariantOption : matchedValue;
  select.title = model && model.reasoning !== true && modelVariants.length === 0
    ? '当前模型未声明推理能力，接口可能忽略该参数；可使用自定义值尝试兼容'
    : '设置仅作用于当前 Agent 会话；默认表示由模型决定';
  updateCustomVariantField(customValue);
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

function setSlashCommandBusy(busy, text = '处理中...') {
  agentWorkbenchState.slashCommandBusy = busy === true;
  agentWorkbenchState.slashCommandBusyText = busy ? String(text || '处理中...') : '';
  if (busy) {
    agentWorkbenchState.slashCommandNotice = '';
    agentWorkbenchState.slashCommandNoticeUntil = 0;
  }
  const button = getElement('agent-run-btn');
  if (!button) return;
  if (busy) {
    button.disabled = true;
    button.textContent = agentWorkbenchState.slashCommandBusyText;
    button.setAttribute('aria-busy', 'true');
    return;
  }
  button.removeAttribute('aria-busy');
  updateRunState(agentWorkbenchState.payload || {});
}

function setSlashCommandNotice(text, tone = 'neutral', durationMs = 6000) {
  agentWorkbenchState.slashCommandNotice = String(text || '');
  agentWorkbenchState.slashCommandNoticeTone = tone;
  agentWorkbenchState.slashCommandNoticeUntil = Date.now() + Math.max(0, Number(durationMs) || 0);
  setStatus(agentWorkbenchState.slashCommandNotice, tone);
}

function renderSummary(data = {}) {
  const summary = data.summary || {};
  const items = [
    ['可用 Agent', summary.availableProviderCount || 0, `共探测 ${summary.providerCount || 0} 个`],
    ['运行任务', summary.runningTaskCount || 0, `排队 ${summary.queuedTaskCount || 0} 个`],
    ['已完成', summary.successTaskCount || 0, '本次控制台运行'],
    ['异常任务', summary.failedTaskCount || 0, `中断 ${summary.interruptedTaskCount || 0} 个`],
    ['最大并发', data.config?.maxConcurrentTasks || 1, `超时 ${formatDuration(data.config?.timeoutMs || 0)}`],
    ['Token 用量', data.stats?.usage?.total || 0, `输入 ${data.stats?.usage?.input || 0} · 输出 ${data.stats?.usage?.output || 0}`],
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
  getElement('agent-native-config').value = JSON.stringify(config.nativeConfig || { mcp: {}, agent: {}, command: {} }, null, 2);
  ['mcp', 'agent', 'command'].forEach(key => {
    const target = getElement(`agent-native-config-${key}`);
    if (target) target.value = JSON.stringify(config.nativeConfig?.[key] || {}, null, 2);
  });
  updateCustomApiFields();
  getElement('agent-timeout-ms').value = String(config.timeoutMs || 1800000);
  getElement('agent-max-concurrent').value = String(config.maxConcurrentTasks || 1);
  getElement('agent-max-runtimes').value = String(config.maxOpenCodeRuntimes || 2);
  getElement('agent-runtime-idle').value = String(config.runtimeIdleTimeoutMs || 120000);
  getElement('agent-manual-context-limit').value = config.manualContextLimit > 0 ? String(config.manualContextLimit) : '';
  getElement('agent-auto-compact-enabled').checked = config.autoCompactEnabled !== false;
  getElement('agent-auto-compact-threshold').value = String(config.autoCompactThreshold || 80);
  getElement('agent-compact-model').value = config.compactModel || '';
  getElement('agent-compact-provider').value = config.compactProviderId || '';
  getElement('agent-provider-opencode').checked = config.providers?.opencode !== false;
  getElement('agent-output-images').checked = config.outputImagesEnabled === true;
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
  select.innerHTML = workspaces.map(item => {
    const writable = Boolean(data.config?.writableWorkspaces?.[item.id]);
    const titleParts = [item.label, item.description].filter(Boolean).join(' — ');
    const title = `${titleParts}${writable ? '（可授权写入）' : ''}`;
    return `<option value="${escapeHtml(item.id)}" title="${escapeHtml(title)}">${escapeHtml(item.label || item.id)}${writable ? '（可写）' : ''}</option>`;
  }).join('');
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
  if (mode === 'full') return '完全访问';
  if (mode === 'edit') return '实际修改';
  if (mode === 'patch') return '补丁建议';
  return '只读分析';
}

function isWriteMode(mode = '') {
  return ['edit', 'full'].includes(String(mode || '').trim().toLowerCase());
}

function isFullAccessMode(mode = '') {
  return String(mode || '').trim().toLowerCase() === 'full';
}

function buildTaskDiffOutput(task = {}) {
  const files = Array.isArray(task.changedFiles) ? task.changedFiles : [];
  const summary = summarizeChanges(files, task.changeSummary);
  const sections = [];
  if (files.length) {
    sections.push(`[变更文件 ${files.length} 个]\n${renderChangeSummary(summary, { includeFiles: false }).replace(/<[^>]+>/g, '')}\n${files.map(item => `${getChangeSymbol(getChangeKind(item))} ${item.status || '?'}  ${item.path || ''}  (+${Number(item.additions || 0)} -${Number(item.deletions || 0)})`).join('\n')}`);
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
      <div class="agent-tool-list">${tools.map(tool => {
        const toolImages = agentWorkbenchState.payload?.config?.outputImagesEnabled === true
          ? (Array.isArray(tool.images) ? tool.images : [])
          : [];
        const imagesHtml = toolImages.length
          ? `<div class="agent-tool-images">${toolImages.map(img => `<img class="agent-tool-image" src="${escapeHtml(img.url)}" alt="工具输出图片" referrerpolicy="no-referrer" />`).join('')}</div>`
          : '';
        return `
        <details class="agent-tool-item">
          <summary><strong>${escapeHtml(tool.name || '工具调用')}</strong><span>${escapeHtml(tool.status || 'unknown')}</span></summary>
          ${imagesHtml}
          ${tool.input ? `<pre><strong>输入</strong>\n${formatAgentText(tool.input)}</pre>` : ''}
          ${tool.output ? `<pre><strong>输出</strong>\n${formatAgentText(tool.output)}</pre>` : ''}
        </details>
      `;
      }).join('')}</div>
    </details>
  `;
}

const HIDDEN_AGENT_EVENT_LABELS = [
  'OpenCode：plugin.added',
  'OpenCode：catalog.updated',
  'OpenCode：reference.updated',
  'OpenCode：integration.updated',
  'OpenCode：message.part.delta',
  'OpenCode：message.part.updated',
  'OpenCode：message.updated',
  'OpenCode：session.status',
  'OpenCode：session.idle',
];

function isVisibleAgentEvent(event = {}) {
  const message = String(event.message || '');
  return !HIDDEN_AGENT_EVENT_LABELS.some(label => message.startsWith(label));
}

function getAssistantWorkDuration(message = {}) {
  const elapsedMs = Math.max(0, Number(message.elapsedMs || 0));
  if (elapsedMs) return elapsedMs;
  const startedAt = new Date(message.startedAt || message.createdAt || '').getTime();
  const finishedAt = new Date(message.finishedAt || message.updatedAt || '').getTime();
  return Number.isFinite(startedAt) && Number.isFinite(finishedAt)
    ? Math.max(0, finishedAt - startedAt)
    : 0;
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
  const usageOutput = renderUsageMeta(message.usage);
  const diffSummary = summarizeChanges(message.changedFiles, message.changeSummary);
  const diffOutput = message.changedFiles?.length || message.diffStat || message.diffText
    ? `<details class="agent-artifact-card"><summary>文件改动 <span>${renderChangeSummary(diffSummary, { includeFiles: false })}</span></summary><pre class="agent-diff-output">${renderDiffText(buildTaskDiffOutput(message))}</pre></details>`
    : '';
  const events = options.showEvents && Array.isArray(options.events)
    ? options.events.filter(isVisibleAgentEvent)
    : [];
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
  const detailOutput = `${reasoningOutput}${renderAgentTools(message.tools)}${usageOutput}${diagnosticOutput}${diffOutput}${eventOutput}`;
  const workLabel = `已工作 ${formatDuration(getAssistantWorkDuration(message))}`;
  const workOutput = detailOutput
    ? `
      <details class="agent-work-report" data-detail-key="work-report">
        <summary><span>${escapeHtml(workLabel)}</span><span class="agent-work-report-chevron" aria-hidden="true">›</span></summary>
        <div class="agent-work-report-body">${detailOutput}</div>
      </details>
    `
    : `<div class="agent-work-report agent-work-report-empty"><span>${escapeHtml(workLabel)}</span></div>`;
  return `${workOutput}${errorOutput}`;
}

function renderInlineToolImages(message = {}) {
  // 用户要求"显示图片"时，图不该埋在两层折叠面板里：直接渲染在回复正文下方
  if (agentWorkbenchState.payload?.config?.outputImagesEnabled !== true) return '';
  const images = (Array.isArray(message.tools) ? message.tools : [])
    .flatMap(tool => Array.isArray(tool.images) ? tool.images : [])
    .slice(0, 4);
  if (!images.length) return '';
  return `<div class="agent-tool-images agent-message-images">${images.map(img => `<img class="agent-tool-image" src="${escapeHtml(img.url)}" alt="Agent 输出图片" referrerpolicy="no-referrer" />`).join('')}</div>`;
}

function formatAgentText(value = '') {
  const text = String(value || '').trim();
  return text ? escapeHtml(text) : '';
}

let agentMarkdownRenderer = null;

function getAgentMarkdownRenderer() {
  if (agentMarkdownRenderer || typeof window.markdownit !== 'function') return agentMarkdownRenderer;
  const renderer = window.markdownit({ html: false, linkify: true, breaks: true, typographer: false });
  // 图片默认禁用；仅当工作台设置 outputImagesEnabled 开启时在 formatAgentMarkdown 中按需启用
  renderer.disable('image');
  renderer.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    token.attrSet('loading', 'lazy');
    token.attrSet('referrerpolicy', 'no-referrer');
    return self.renderToken(tokens, index, options);
  };
  renderer.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = String(token.info || '').trim().split(/\s+/)[0].replace(/[^a-z0-9_+-]/gi, '').slice(0, 32) || 'text';
    return `<section class="agent-message-code">
      <div class="agent-message-code-head"><span>${escapeHtml(language)}</span><button type="button" class="agent-message-code-copy" data-agent-code-copy aria-label="复制代码">复制</button></div>
      <pre><code class="language-${escapeHtml(language)}">${escapeHtml(String(token.content || '').replace(/\n$/, ''))}</code></pre>
    </section>`;
  };
  const defaultLinkOpen = renderer.renderer.rules.link_open
    || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, index, options, env, self);
  };
  agentMarkdownRenderer = renderer;
  return renderer;
}

function formatAgentMarkdown(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const renderer = getAgentMarkdownRenderer();
  if (!renderer) return escapeHtml(text).replace(/\r?\n/g, '<br>');
  const imagesAllowed = agentWorkbenchState.payload?.config?.outputImagesEnabled === true;
  if (imagesAllowed) {
    renderer.enable('image');
  } else {
    renderer.disable('image');
  }
  const html = renderer.render(text);
  if (!imagesAllowed) return html;
  // 相对/绝对路径图片重写到工作区图片端点（img 同源自动带登录 Cookie）；data:/http(s) 不动。
  // markdownit 会把反斜杠等编码成 %5C，这里先解码回原始路径再统一编码，避免双重编码
  return html.replace(/(<img[^>]*?\ssrc=")(?!data:|https?:|\/\/|\/api\/)([^"]*)"/g, (match, prefix, src) => {
    let decoded = decodeHtmlEntities(src);
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // 非法的百分号序列保持原样
    }
    const normalized = decoded.replace(/^file:\/\//i, '').replace(/\\/g, '/');
    return `${prefix}/api/agent-workbench/workspace-image?path=${encodeURIComponent(normalized)}"`;
  });
}

function decodeHtmlEntities(value = '') {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value || '');
  return textarea.value;
}

async function copyAgentMessageCode(button) {
  const code = button?.closest?.('.agent-message-code')?.querySelector('code')?.textContent || '';
  if (!code) return;
  await navigator.clipboard.writeText(code);
  button.textContent = '已复制';
  window.setTimeout(() => { button.textContent = '复制'; }, 1200);
}

function renderLiveStepBubbles(steps = [], placeholder = '', isRunning = true) {
  // 运行中的实时输出按助手步骤分气泡渲染（ZCode 式）；思考链以单行滚动条展示，点击展开全文。
  // “思考中”只标记当前正在思考的步骤（最后一步且尚未输出正文），已完成的步骤显示静态“思考过程”
  const list = (Array.isArray(steps) ? steps : []).filter(step => String(step?.content || '').trim() || String(step?.reasoning || '').trim());
  if (!list.length) {
    return `<div class="agent-message-bubble agent-agent-bubble">${formatAgentText(placeholder)}</div>`;
  }
  agentWorkbenchState.expandedReasoning = agentWorkbenchState.expandedReasoning || new Set();
  const activeId = isRunning && list.length ? list[list.length - 1].messageId : '';
  return list.map(step => {
    const reasoning = String(step.reasoning || '').replace(/\s+/g, ' ').trim();
    const expanded = reasoning && agentWorkbenchState.expandedReasoning.has(step.messageId);
    const isThinking = step.messageId === activeId && !String(step.content || '').trim();
    const ticker = reasoning ? `
      <div class="agent-reasoning-ticker" data-step-id="${escapeHtml(step.messageId)}" title="点击${expanded ? '收起' : '展开'}思考过程">
        <div class="agent-reasoning-ticker-line">
          <span class="agent-reasoning-ticker-badge${isThinking ? ' is-thinking' : ''}">${isThinking ? '思考中' : '思考过程'}</span>
          <span class="agent-reasoning-ticker-text">${expanded ? '思考过程已展开' : `…${escapeHtml(reasoning.slice(-140))}`}</span>
        </div>
        ${expanded ? `<pre class="agent-reasoning-full">${escapeHtml(String(step.reasoning || '').trim())}</pre>` : ''}
      </div>` : '';
    const bubble = String(step.content || '').trim()
      ? `<div class="agent-message-bubble agent-agent-bubble agent-markdown">${formatAgentMarkdown(step.content)}</div>`
      : '';
    return `${ticker}${bubble}`;
  }).join('');
}

function renderContextUsage(task = null) {
  const reportedContextUsage = Math.max(0, Number(task?.contextUsage || 0));
  const reportedContextLimit = Math.max(0, Number(task?.contextLimit || 0));
  const manualContextLimit = Math.max(0, Number(agentWorkbenchState.payload?.config?.manualContextLimit || 0));
  const contextLimit = reportedContextLimit || manualContextLimit;
  const usingManualLimit = !reportedContextLimit && manualContextLimit > 0;
  const usage = task?.usage && typeof task.usage === 'object' ? task.usage : {};
  const usageInput = Math.max(0, Number(usage.input || 0));
  const usageOutput = Math.max(0, Number(usage.output || 0));
  const usageTotal = Math.max(0, Number(usage.total || usageInput + usageOutput));
  const latestAssistantInput = Array.isArray(task?.messages)
    ? Math.max(0, Number([...task.messages].reverse()
      .find(message => message?.role === 'assistant' && Number(message?.usage?.input || 0) > 0)
      ?.usage?.input || 0))
    : 0;
  const estimatedContextUsage = latestAssistantInput || usageInput;
  const contextUsage = reportedContextUsage || estimatedContextUsage;
  const usingEstimatedUsage = !reportedContextUsage && estimatedContextUsage > 0;
  const selectedModel = String(getElement('agent-model')?.value || task?.model || '').trim() || '默认模型';
  const selectedVariant = String(getSelectedModelVariant() || task?.variant || '').trim();
  const variantLabel = getVariantLabel(selectedVariant);
  const contextLabel = getElement('agent-context-usage-label');
  const contextBar = getElement('agent-context-usage-bar');
  const contextNote = getElement('agent-context-usage-note');
  const contextRing = getElement('agent-context-usage-ring');
  const contextPercentLabel = getElement('agent-context-summary-percent');
  const percent = contextLimit > 0
    ? Math.min(100, Math.round((contextUsage / contextLimit) * 1000) / 10)
    : 0;
  const percentText = Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
  contextRing.style.setProperty('--agent-context-angle', `${Number((percent * 3.6).toFixed(2))}deg`);
  contextRing.classList.toggle('is-warn', percent >= 80 && percent < 95);
  contextRing.classList.toggle('is-danger', percent >= 95);
  getElement('agent-context-model-label').textContent = selectedModel;
  getElement('agent-context-model-label').title = selectedModel;
  getElement('agent-context-variant-label').textContent = `推理 ${variantLabel}`;
  getElement('agent-context-detail-model').textContent = selectedModel;
  getElement('agent-context-detail-model').title = selectedModel;
  getElement('agent-context-detail-variant').textContent = variantLabel;
  getElement('agent-context-detail-input').textContent = formatContextTokenCount(usageInput);
  getElement('agent-context-detail-output').textContent = formatContextTokenCount(usageOutput);
  getElement('agent-context-detail-total').textContent = formatContextTokenCount(usageTotal);
  if (contextLimit > 0) {
    const compactedAt = task?.lastCompactedAt ? ` · 最近压缩 ${formatTime(task.lastCompactedAt)}` : '';
    contextLabel.textContent = `${formatContextTokenCount(contextUsage)} / ${formatContextTokenCount(contextLimit)}`;
    contextBar.style.width = `${percent}%`;
    contextBar.classList.toggle('is-warn', percent >= 80);
    contextPercentLabel.textContent = percentText;
    getElement('agent-context-detail-remaining').textContent = formatContextTokenCount(Math.max(0, contextLimit - contextUsage));
    const limitSource = usingManualLimit ? '手动容量' : '模型容量';
    const usageSource = usingEstimatedUsage ? '输入 Token 估算' : '实时使用量';
    contextNote.textContent = `${percentText} · ${limitSource} · ${usageSource} · ${agentWorkbenchState.payload?.config?.autoCompactEnabled === false ? '自动压缩已关闭' : '达到阈值后自动压缩'}${compactedAt}`;
  } else {
    contextLabel.textContent = contextUsage ? `${formatContextTokenCount(contextUsage)} Token` : '未读取';
    contextBar.style.width = '0%';
    contextBar.classList.remove('is-warn');
    contextPercentLabel.textContent = contextUsage ? formatContextTokenCount(contextUsage) : '未读取';
    getElement('agent-context-detail-remaining').textContent = '未读取';
    contextNote.textContent = contextUsage
      ? '当前模型未返回上下文上限，可在设置中填写手动容量。'
      : '完成一轮对话后显示当前会话用量；也可在设置中填写手动容量。';
  }
}

function renderContext(task = null) {
  renderContextUsage(task);
  const files = Array.isArray(task?.changedFiles) ? task.changedFiles : [];
  const changeSummary = summarizeChanges(files, task?.changeSummary);
  getElement('agent-context-file-count').textContent = String(files.length);
  getElement('agent-context-file-summary').innerHTML = renderChangeSummary(changeSummary, { includeFiles: false });
  getElement('agent-context-file-list').innerHTML = files.length
    ? files.map(item => `
        <button type="button" class="agent-context-file-item is-${getChangeKind(item)}" data-agent-file="${escapeHtml(item.path || '')}">
          <code>${getChangeSymbol(getChangeKind(item))}</code>
          <span title="${escapeHtml(item.path || '')}">${escapeHtml(item.path || '未命名文件')}</span>
          <small>+${Number(item.additions || 0)} -${Number(item.deletions || 0)}</small>
        </button>
      `).join('')
    : '<span class="agent-context-empty">选择一个实际修改任务后显示文件改动。</span>';
  getElement('agent-context-diff-stat').textContent = task?.diffStat || '暂无 Diff';
  getElement('agent-context-diff-summary').innerHTML = renderChangeSummary(changeSummary, { includeFiles: false });
  renderPermissions(task);
  renderQuestions(task);
  syncMobileActionTray();
  if (task?.id !== agentWorkbenchState.fileTaskId) {
    agentWorkbenchState.fileTaskId = task?.id || '';
    agentWorkbenchState.filePath = '';
    loadAgentFileTree('', task).catch(() => {});
  }
}

function syncMobileActionTray() {
  // 托盘已废弃：审批/问答卡统一悬浮在输入栏上方（agent-action-dock），保留空实现兼容旧调用
}

function syncActionDock() {
  const dock = getElement('agent-action-dock');
  if (!dock) return;
  const question = getElement('agent-question-section');
  const permission = getElement('agent-permission-section');
  const visible = (question && !question.classList.contains('hidden'))
    || (permission && !permission.classList.contains('hidden'));
  dock.classList.toggle('hidden', !visible);
}

// ===== 全局提醒：会话列表徽章 + 标题闪烁 + 桌面通知（仅本浏览器） =====
const agentNotifyStorageKey = 'crystelf.agentWorkbench.desktopNotify';
let attentionTitleTimer = null;
const attentionNotifiedIds = new Set();
const agentWorkbenchBaseTitle = document.title;

function collectWaitingAttention() {
  const tasks = agentWorkbenchState.payload?.tasks || [];
  const waiting = { tasks: [], question: false, permission: false };
  for (const task of tasks) {
    if (task.archived) continue;
    const questions = Array.isArray(task.pendingQuestions) ? task.pendingQuestions : [];
    const permissions = Array.isArray(task.pendingPermissions) ? task.pendingPermissions : [];
    if (!questions.length && !permissions.length) continue;
    waiting.tasks.push({ task, questions, permissions });
    if (questions.length) waiting.question = true;
    if (permissions.length) waiting.permission = true;
  }
  return waiting;
}

function desktopNotifyEnabled() {
  try { return localStorage.getItem(agentNotifyStorageKey) === '1'; } catch { return false; }
}

function syncDesktopNotifyToggle() {
  const button = getElement('agent-notify-toggle');
  if (!button) return;
  const enabled = desktopNotifyEnabled();
  button.textContent = enabled ? '🔔' : '🔕';
  button.classList.toggle('is-active', enabled);
  button.setAttribute('aria-pressed', String(enabled));
}

function maybeSendDesktopNotifications(waiting) {
  if (!desktopNotifyEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const activeIds = new Set();
  for (const { task, questions, permissions } of waiting.tasks) {
    for (const item of questions) {
      const id = `${task.id}:q:${item.id}`;
      activeIds.add(id);
      if (attentionNotifiedIds.has(id)) continue;
      attentionNotifiedIds.add(id);
      const firstQuestion = item.questions?.[0]?.question || item.questions?.[0]?.header || '';
      notifyDesktop('Agent 等待你的回答', `${task.title || 'Agent 会话'}${firstQuestion ? `：${String(firstQuestion).slice(0, 60)}` : ''}`, task.id);
    }
    for (const item of permissions) {
      const id = `${task.id}:p:${item.id}`;
      activeIds.add(id);
      if (attentionNotifiedIds.has(id)) continue;
      attentionNotifiedIds.add(id);
      notifyDesktop('Agent 请求审批', `${task.title || 'Agent 会话'}：${item.action || '终端操作'}`, task.id);
    }
  }
  for (const id of [...attentionNotifiedIds]) {
    if (!activeIds.has(id)) attentionNotifiedIds.delete(id);
  }
}

function notifyDesktop(title, body, taskId) {
  try {
    const notification = new Notification(title, { body, tag: taskId, silent: false });
    notification.onclick = () => {
      window.focus();
      agentWorkbenchState.selectedTaskId = taskId;
      agentWorkbenchState.newSession = false;
      renderTasks(agentWorkbenchState.payload || {});
      renderSelectedTask(agentWorkbenchState.payload || {});
      refreshAgentWorkbench({ quiet: true }).catch(() => {});
    };
  } catch {
    // 通知构造失败（浏览器限制）时静默忽略，标题闪烁仍然有效
  }
}

function syncAttentionBadge() {
  const waiting = collectWaitingAttention();
  maybeSendDesktopNotifications(waiting);
  const waitingAny = waiting.question || waiting.permission;
  if (waitingAny && !attentionTitleTimer) {
    const label = waiting.question ? '【等待回答】' : '【等待审批】';
    attentionTitleTimer = setInterval(() => {
      if (document.hidden) {
        document.title = document.title.startsWith('【') ? agentWorkbenchBaseTitle : label + agentWorkbenchBaseTitle;
      } else if (document.title !== agentWorkbenchBaseTitle) {
        document.title = agentWorkbenchBaseTitle;
      }
    }, 1400);
  } else if (!waitingAny && attentionTitleTimer) {
    clearInterval(attentionTitleTimer);
    attentionTitleTimer = null;
    if (document.title !== agentWorkbenchBaseTitle) document.title = agentWorkbenchBaseTitle;
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
  syncActionDock();
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
  syncActionDock();
}

// 把用户在输入框里写的答案映射到选项：A/B/序号/选项文本/多选组合（如 "AB"、"A,B"）
function resolveQuestionAnswers(question = {}, text = '') {
  const options = Array.isArray(question.options) ? question.options : [];
  const tokens = String(text || '').split(/[\s,，、;；/]+/).filter(Boolean);
  const values = [];
  for (const token of tokens) {
    const upper = token.toUpperCase();
    // 多选连写："AB" / "ABC" → 拆成各选项（仅当每个字母都对应一个选项）
    if (/^[A-Z]{2,6}$/.test(upper) && upper.split('').every(char => options[char.charCodeAt(0) - 65])) {
      upper.split('').forEach(char => values.push(String(options[char.charCodeAt(0) - 65].label)));
      continue;
    }
    if (/^[A-Z]$/.test(upper)) {
      const index = upper.charCodeAt(0) - 65;
      if (options[index]) {
        values.push(String(options[index].label));
        continue;
      }
    }
    if (/^\d+$/.test(token)) {
      const index = Number(token) - 1;
      if (options[index]) {
        values.push(String(options[index].label));
        continue;
      }
    }
    const exact = options.find(option => String(option.label || '').toLowerCase() === token.toLowerCase());
    values.push(exact ? String(exact.label) : token);
  }
  if (!values.length) values.push(String(text || '').trim());
  return question.multiple ? values : [values[0]];
}

async function answerPendingQuestionsByText(task = {}, text = '') {
  const pending = Array.isArray(task.pendingQuestions) ? task.pendingQuestions : [];
  if (!pending.length) return false;
  try {
    for (const item of pending) {
      const answers = (Array.isArray(item.questions) ? item.questions : [])
        .map(question => resolveQuestionAnswers(question, text));
      const result = await postJson(
        `/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/questions/${encodeURIComponent(item.id)}/reply`,
        { answers },
      );
      mergeStreamTask(result.task);
    }
    getElement('agent-prompt').value = '';
    setStatus('已提交回答，Agent 继续执行中...');
    return true;
  } catch (error) {
    await webConsoleAlert(error.message);
    return false;
  }
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
  tab.content = getEditorContent();
  tab.dirty = tab.content !== String(tab.originalContent || '');
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
      if (tab.content === undefined) tab.content = result.file?.content || '';
      tab.dirty = tab.content !== tab.originalContent;
    }
    getElement('agent-file-editor-title').textContent = result.file?.name || '文件编辑器';
    getElement('agent-file-editor-path').textContent = result.file?.path || pathValue;
    const canSave = ['edit', 'full'].includes(task?.mode) && task?.writeConfirmed === true
      && agentWorkbenchState.payload?.config?.writeEnabled === true
      && agentWorkbenchState.payload?.config?.writableWorkspaces?.plugin === true;
    const editorContent = tab?.content !== undefined ? tab.content : (result.file?.content || '');
    await setEditorContent(editorContent, result.file?.name || pathValue, !canSave);
    const extension = String(result.file?.name || pathValue).split('.').pop()?.toLowerCase() || 'text';
    getElement('agent-file-editor-meta').textContent = `${extension} · ${Math.max(1, Math.round(Number(result.file?.size || 0) / 1024))} KB · Tab 缩进 · Ctrl/Cmd+S 保存`;
    getElement('agent-file-editor-diff').textContent = task?.diffText || '当前会话暂无 Diff。';
    getElement('agent-file-editor-full').href = `/file-browser.html?open=${encodeURIComponent(result.file?.path || pathValue)}`;
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
  if (!file?.path || getElement('agent-file-editor-content').readOnly) return;
  setButtonBusy('agent-file-editor-save', true, '保存文件', '保存中...');
  try {
    const result = await postJson('/api/file-browser/write', {
      path: file.path,
      content: getEditorContent(),
      expectedMtimeMs: file.mtimeMs,
    });
    const content = getEditorContent();
    agentWorkbenchState.editorFile = { ...file, ...result.file, content };
    const tab = agentWorkbenchState.editorTabs.find(item => item.path === file.path);
    if (tab) {
      tab.originalContent = content;
      tab.content = content;
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
  agentWorkbenchState.payload.summary.runningTaskCount = tasks.filter(item => item.status === 'running').length;
  agentWorkbenchState.payload.summary.queuedTaskCount = tasks.filter(item => item.status === 'pending').length;
  agentWorkbenchState.payload.summary.interruptedTaskCount = tasks.filter(item => item.status === 'interrupted').length;
  agentWorkbenchState.payload.summary.successTaskCount = tasks.filter(item => item.status === 'success').length;
  agentWorkbenchState.payload.summary.failedTaskCount = tasks.filter(item => item.status === 'error').length;
  renderSummary(agentWorkbenchState.payload);
  renderTasks(agentWorkbenchState.payload);
  renderSelectedTask(agentWorkbenchState.payload);
  updateRunState(agentWorkbenchState.payload);
}

function appendStreamText(current = '', delta = '', limit = 160000) {
  const next = `${current || ''}${delta || ''}`;
  return next.length > limit ? next.slice(-limit) : next;
}

function mergeStreamTaskDelta(change = {}) {
  if (!change.taskId || !agentWorkbenchState.payload) return;
  const tasks = Array.isArray(agentWorkbenchState.payload.tasks) ? agentWorkbenchState.payload.tasks : [];
  const task = tasks.find(item => item.id === change.taskId);
  if (!task) return;
  if (Array.isArray(change.steps)) task.liveSteps = change.steps;
  if (Object.prototype.hasOwnProperty.call(change, 'outputText')) {
    task.outputText = String(change.outputText || '');
  } else if (change.delta) {
    task.outputText = appendStreamText(task.outputText, change.delta);
  }
  if (change.status) task.status = change.status;
  if (change.stage) task.stage = change.stage;
  if (change.updatedAt) task.updatedAt = change.updatedAt;
  if (task.id !== agentWorkbenchState.selectedTaskId || agentWorkbenchState.newSession) return;

  const liveMessage = getElement('agent-output')?.querySelector('.agent-message-live');
  const bubbles = liveMessage?.querySelector('.agent-message-live-bubbles');
  if (bubbles) {
    const placeholder = task.status === 'pending'
      ? `任务正在排队${task.queuePosition ? `，当前位置 ${task.queuePosition}` : ''}...`
      : 'Agent 正在准备输出...';
    const nextHtml = renderLiveStepBubbles(task.liveSteps, normalizeAgentOutput(task.outputText) || placeholder, task.status === 'running');
    const signature = `${nextHtml.length}:${nextHtml.slice(-60)}`;
    if (bubbles.dataset.liveSignature !== signature) {
      bubbles.dataset.liveSignature = signature;
      bubbles.innerHTML = nextHtml;
    }
  }
  const status = getStatusMeta(task.status);
  const badge = getElement('agent-chat-status-badge');
  if (badge) {
    badge.textContent = status.label;
    badge.className = `agent-state-badge tone-${status.tone}`;
  }
  if (agentWorkbenchState.conversationStickToBottom) scrollConversationToBottom();
  updateConversationFollowButton();
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
  source.addEventListener('task_delta', event => {
    try {
      mergeStreamTaskDelta(JSON.parse(event.data || '{}'));
    } catch {
      // 增量事件异常时由完整任务事件和周期刷新恢复。
    }
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
      agentWorkbenchState.nativeHistoryByTask.delete(payload.taskId);
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
  const running = task.status === 'running' || task.status === 'pending';
  const nativeHistory = !running ? agentWorkbenchState.nativeHistoryByTask.get(task.id) : null;
  let messages = Array.isArray(nativeHistory)
    ? nativeHistory
    : (Array.isArray(task.messages) ? task.messages : []);
  if (!messages.length && !task.messageCount) {
    messages = [
      { role: 'user', content: task.prompt || task.promptPreview || '未记录任务内容', createdAt: task.createdAt },
      ...(!running ? [{ role: 'assistant', content: normalizeAgentOutput(task.outputText), createdAt: task.startedAt, finishedAt: task.finishedAt, status: task.status, error: task.error, stderrText: task.stderrText, changedFiles: task.changedFiles, diffStat: task.diffStat, diffText: task.diffText, usage: task.usage }] : []),
    ];
  }
  if (!messages.length && task.messageCount) {
    target.innerHTML = '<div class="agent-chat-empty"><strong>正在加载会话</strong><span>正在读取 OpenCode 多轮上下文...</span></div>';
    return;
  }
  // 运行中同样展示完整历史：分步实时气泡已能区分当前轮，不再截断旧对话
  const visibleMessages = messages;
  const lastAssistantIndex = visibleMessages.reduce((index, message, currentIndex) => message.role === 'assistant' ? currentIndex : index, -1);
  // 压缩分界线：标记模型上下文从此处折叠为摘要（此前消息模型已看不到原文）
  const compactedAtMs = task.lastCompactedAt ? Date.parse(task.lastCompactedAt) : 0;
  let compactBoundary = -1;
  if (compactedAtMs) {
    compactBoundary = visibleMessages.findIndex(message => {
      const ts = Date.parse(message.createdAt || '');
      return Number.isFinite(ts) && ts >= compactedAtMs;
    });
    if (compactBoundary < 0) compactBoundary = visibleMessages.length;
  }
  const compactDividerHtml = '<div class="agent-compact-divider"><span>⌃ 上下文已压缩，此前内容已折叠为摘要注入模型</span></div>';
  const html = visibleMessages.map((message, index) => {
    const divider = index === compactBoundary ? compactDividerHtml : '';
    if (message.role === 'user') {
      const deliveryLabel = message.delivery === 'steer'
        ? '<span class="agent-followup-label">立即发送</span>'
        : (message.delivery === 'queue' ? '<span class="agent-followup-label">排队跟进</span>' : '');
      return `${divider}
        <article class="agent-message agent-message-user">
          <div class="agent-message-body">
            <div class="agent-message-label">${deliveryLabel}<time>${escapeHtml(formatTime(message.createdAt))}</time></div>
            <div class="agent-message-bubble agent-markdown">${formatAgentMarkdown(message.content || '未记录消息内容')}${renderMessageAttachments(message.attachments)}</div>
            ${renderNativeMessageActions(task, message)}
          </div>
        </article>
      `;
    }
    const outputText = message.content || (message.error ? '本轮没有产出可显示的文本。' : '');
    return `${divider}
      <article class="agent-message agent-message-agent">
        <div class="agent-message-body">
          ${renderAssistantArtifacts(message, { showEvents: index === lastAssistantIndex && !running, events: task.events })}
          ${outputText ? `<div class="agent-message-bubble agent-agent-bubble agent-markdown">${formatAgentMarkdown(outputText)}</div>` : ''}
          ${renderInlineToolImages(message)}
          ${renderNativeMessageActions(task, message)}
        </div>
      </article>
    `;
  }).join('');
  // 所有消息都早于压缩点：分界线追加在末尾（此前全部内容已被折叠为摘要）
  const trailingDivider = visibleMessages.length && compactBoundary >= visibleMessages.length ? compactDividerHtml : '';
  const liveOutput = running ? `
    <article class="agent-message agent-message-agent agent-message-live">
      <div class="agent-message-body">
        ${renderAssistantArtifacts({ tools: [], elapsedMs: task.elapsedMs }, { showEvents: true, events: task.events, running: true })}
        <div class="agent-message-live-bubbles">${renderLiveStepBubbles(task.liveSteps, task.status === 'pending'
          ? `任务正在排队${task.queuePosition ? `，当前位置 ${task.queuePosition}` : ''}...`
          : 'Agent 正在准备输出...', true)}</div>
      </div>
    </article>
  ` : '';
  target.innerHTML = `${html}${trailingDivider}${liveOutput}`;
  restoreConversationDetails(target, detailState);
  if (agentWorkbenchState.conversationStickToBottom) scrollConversationToBottom();
  updateConversationFollowButton();
}

function renderNativeMessageActions(task = {}, message = {}) {
  const messageId = String(message.openCodeMessageId || '').trim();
  if (!task.opencodeSessionId || !messageId || ['running', 'pending'].includes(task.status)) return '';
  return `
    <div class="agent-native-message-actions">
      <button type="button" data-native-message-action="fork" data-native-message-id="${escapeHtml(messageId)}">从这里分支</button>
      <button type="button" class="is-danger" data-native-message-action="delete-message" data-native-message-id="${escapeHtml(messageId)}">删除消息</button>
    </div>
  `;
}

function renderPendingConversation(prompt = '', attachments = []) {
  const target = getElement('agent-output');
  if (!target) return;
  // 追加而不是整屏替换：保留上一轮历史，避免发新消息时旧对话短暂消失
  target.insertAdjacentHTML('beforeend', `
    <article class="agent-message agent-message-user">
      <div class="agent-message-body">
        <div class="agent-message-label"><time>刚刚</time></div>
        <div class="agent-message-bubble agent-markdown">${formatAgentMarkdown(prompt)}${renderMessageAttachments(attachments)}</div>
      </div>
    </article>
    <article class="agent-message agent-message-agent agent-message-live">
      <div class="agent-message-body">
        ${renderAssistantArtifacts({ elapsedMs: 0 }, { running: true })}
        <div class="agent-message-bubble agent-agent-bubble">Agent 正在准备输出...</div>
      </div>
    </article>
  `);
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
    getElement('agent-resume-btn').classList.add('hidden');
    getElement('agent-retry-btn').classList.add('hidden');
    getElement('agent-history-load-btn').classList.add('hidden');
    getElement('agent-archive-btn').classList.add('hidden');
    getElement('agent-export-btn').classList.add('hidden');
    getElement('agent-delete-btn').classList.add('hidden');
    getElement('agent-output-alert').classList.add('hidden');
    getElement('agent-use-worktree').disabled = false;
    getElement('agent-mobile-worktree').checked = false;
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
    updateModelVariantOptions(task.variant || '');
    const taskAgent = isFullAccessMode(task.mode) ? 'build' : task.agent;
    if ([...getElement('agent-agent').options].some(option => option.value === taskAgent)) getElement('agent-agent').value = taskAgent;
    getElement('agent-priority').value = task.priority || 'normal';
    getElement('agent-use-worktree').checked = Boolean(task.worktree);
    getElement('agent-mobile-worktree').checked = Boolean(task.worktree);
    getElement('agent-use-worktree').disabled = true;
    getElement('agent-title').value = '';
    agentWorkbenchState.formTaskId = task.id;
  }
  getElement('agent-output-title').textContent = task.title || 'Agent 任务';
  getElement('agent-output-meta').textContent = `${task.providerLabel || task.providerId} · ${task.workspaceLabel || task.workspaceId} · ${task.turnCount || 1} 轮 · ${getModeLabel(task.mode)}${task.variant ? ` · 思考 ${getVariantLabel(task.variant)}` : ''} · ${status.label} · ${formatDuration(task.elapsedMs)}`;
  getElement('agent-cancel-btn').disabled = !['running', 'pending'].includes(task.status);
  getElement('agent-resume-btn').classList.toggle('hidden', task.resumable !== true);
  getElement('agent-retry-btn').classList.toggle('hidden', task.retryable !== true);
  const historyButton = getElement('agent-history-load-btn');
  historyButton.classList.toggle('hidden', !task.opencodeSessionId || ['running', 'pending'].includes(task.status));
  historyButton.textContent = agentWorkbenchState.nativeHistoryByTask.has(task.id) ? '刷新完整历史' : '加载完整历史';
  getElement('agent-archive-btn').classList.toggle('hidden', ['running', 'pending'].includes(task.status));
  getElement('agent-archive-btn').textContent = task.archived ? '取消归档' : '归档';
  getElement('agent-export-btn').classList.remove('hidden');
  getElement('agent-delete-btn').classList.toggle('hidden', ['running', 'pending'].includes(task.status));
  renderContext(task);
  renderConversation(task);
  const alert = getElement('agent-output-alert');
  if (task.resumable === true) {
    alert.textContent = '本轮任务因控制台重启或执行超时而中断，可以从原 OpenCode 会话继续。';
    alert.classList.remove('hidden');
  } else if (isWriteMode(task.mode) && task.workspaceChanged) {
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
  const managing = agentWorkbenchState.manageMode === true;
  const selectedIds = agentWorkbenchState.selectedTaskIds instanceof Set ? agentWorkbenchState.selectedTaskIds : new Set();
  const listElement = getElement('agent-task-list');
  listElement.classList.toggle('is-managing', managing);
  listElement.innerHTML = tasks.length ? tasks.map(task => {
    const status = getStatusMeta(task.status);
    const title = task.title || 'Agent 任务';
    const activityTime = task.updatedAt || task.createdAt;
    const relativeTime = formatCompactRelativeTime(activityTime);
    const archived = task.archived === true;
    const checked = selectedIds.has(task.id);
    const checkbox = managing
      ? `<input type="checkbox" class="agent-task-check" data-task-check="${escapeHtml(task.id)}" ${checked ? 'checked' : ''} aria-label="选择会话" />`
      : '';
    const archiveButton = managing
      ? ''
      : `<button type="button" class="agent-task-archive" data-archive-task="${escapeHtml(task.id)}" data-archive-state="${archived ? '1' : ''}" title="${archived ? '取消归档' : '归档此会话'}" aria-label="${archived ? '取消归档' : '归档此会话'}">${archived ? '取消归档' : '归档'}</button>`;
    return `
      <div class="agent-task-item ${task.id === agentWorkbenchState.selectedTaskId && !agentWorkbenchState.newSession ? 'is-selected' : ''} ${checked ? 'is-checked' : ''}" role="button" tabindex="0" data-task-id="${escapeHtml(task.id)}" title="${escapeHtml(`${title} · ${status.label} · ${formatTime(activityTime)}`)}" aria-label="${escapeHtml(`${title}，${status.label}，${relativeTime}`)}">
        ${checkbox}
        <strong class="agent-task-title">${escapeHtml(title)}</strong>
        ${(Array.isArray(task.pendingQuestions) && task.pendingQuestions.length) ? `<span class="agent-task-badge is-question">待回答 ${task.pendingQuestions.length}</span>` : ''}
        ${(Array.isArray(task.pendingPermissions) && task.pendingPermissions.length) ? `<span class="agent-task-badge is-permission">待审批 ${task.pendingPermissions.length}</span>` : ''}
        <time class="agent-task-time" datetime="${escapeHtml(activityTime || '')}">${escapeHtml(relativeTime)}</time>
        ${archiveButton}
      </div>
    `;
  }).join('') : '<div class="agent-empty"><strong>还没有会话</strong><span>发送第一条任务后，会话记录显示在这里。</span></div>';
  updateBatchBar(tasks);
  syncAttentionBadge();
}

function updateBatchBar(tasks = []) {
  const bar = getElement('agent-batch-bar');
  if (!bar) return;
  const managing = agentWorkbenchState.manageMode === true;
  bar.classList.toggle('hidden', !managing);
  const manageToggle = getElement('agent-manage-toggle');
  manageToggle?.classList.toggle('is-active', managing);
  manageToggle?.setAttribute('aria-pressed', managing ? 'true' : 'false');
  if (!managing) return;
  const selected = agentWorkbenchState.selectedTaskIds instanceof Set ? agentWorkbenchState.selectedTaskIds : new Set();
  getElement('agent-batch-count').textContent = `已选 ${selected.size} 项`;
  const allBox = getElement('agent-batch-all');
  allBox.checked = tasks.length > 0 && tasks.every(task => selected.has(task.id));
  allBox.indeterminate = selected.size > 0 && !allBox.checked;
  const viewingArchived = getElement('agent-session-archived').checked === true;
  getElement('agent-batch-unarchive').classList.toggle('hidden', !viewingArchived);
  getElement('agent-batch-archive').classList.toggle('hidden', viewingArchived);
  getElement('agent-batch-clear-archived').classList.toggle('hidden', !viewingArchived);
}

function updateRunState(data = {}) {
  const enabled = data.config?.enabled === true;
  const providerAvailable = (data.providers || []).some(item => item.available && item.enabled);
  const active = Number(data.summary?.activeTaskCount || 0);
  const limit = Number(data.config?.maxConcurrentTasks || 1);
  const runButton = getElement('agent-run-btn');
  const mode = getElement('agent-mode').value || 'analyze';
  const mobileMode = getElement('agent-mobile-mode');
  if (mobileMode && mobileMode.value !== mode) mobileMode.value = mode;
  const providerId = getElement('agent-provider').value || '';
  const workspaceId = getElement('agent-workspace').value || '';
  const writeMode = isWriteMode(mode);
  const fullAccess = isFullAccessMode(mode);
  const writeAllowed = data.config?.writeEnabled === true
    && providerId === 'opencode'
    && data.config?.writableWorkspaces?.[workspaceId] === true;
  const selectedTask = agentWorkbenchState.newSession ? null : getSelectedTask(data);
  const selectedTaskRunning = Boolean(selectedTask && ['pending', 'running'].includes(selectedTask.status));
  const canFollowUp = selectedTaskRunning
    && selectedTask.providerId === 'opencode'
    && selectedTask.acceptsFollowUps !== false;
  const hasPendingQuestion = Array.isArray(selectedTask?.pendingQuestions) && selectedTask.pendingQuestions.length > 0;
  if (agentWorkbenchState.slashCommandBusy) {
    runButton.disabled = true;
    runButton.textContent = agentWorkbenchState.slashCommandBusyText || '处理中...';
  } else {
    runButton.textContent = hasPendingQuestion
      ? '提交回答'
      : (canFollowUp
        ? '立即发送'
        : (fullAccess ? '发送并执行' : (writeMode ? '发送并修改' : '发送')));
    runButton.disabled = canFollowUp
      ? !enabled
      : !enabled || !providerAvailable || (writeMode && !writeAllowed);
  }
  const runButtonLabel = String(runButton.textContent || '发送').trim();
  runButton.title = runButtonLabel;
  runButton.setAttribute('aria-label', runButtonLabel);
  runButton.classList.toggle('agent-write-run', writeMode);
  getElement('agent-composer-hint').textContent = !enabled
    ? '请先启用并保存 Agent 工作台。'
    : hasPendingQuestion
      ? 'Agent 正在等待你的回答：可直接输入选项（如 A、B，或选项文字）后发送，也可点输入框上方的悬浮卡片选择提交。'
    : canFollowUp
      ? `立即发送：补充要求会注入当前执行，适合追问或纠正方向。${selectedTask.pendingFollowUpCount ? `已有 ${selectedTask.pendingFollowUpCount} 条等待中。` : ''}`
    : !providerAvailable
      ? '没有可用的 Agent CLI。'
      : active >= limit
        ? `当前并发已满，新会话将进入持久化队列等待执行。`
        : writeMode && !data.config?.writeEnabled
          ? '请先启用并保存“允许实际修改文件”。'
          : writeMode && providerId !== 'opencode'
            ? '实际修改模式当前只支持内置 OpenCode。'
            : writeMode && !data.config?.writableWorkspaces?.[workspaceId]
              ? '所选工作目录尚未获得写入授权。'
              : fullAccess
                ? '将以完全访问模式启动，可修改文件、联网、访问全目录并直接执行终端命令。请确认任务范围。'
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
    data.config?.outputImagesEnabled === true ? '图片显示开' : '图片显示关',
  ];
  getElement('agent-security-title').textContent = writeEnabled ? '受控写入已授权' : '只读执行边界';
  getElement('agent-security-detail').textContent = writeEnabled
    ? `完全访问档 · ${permissionLabels.join(' · ')}`
    : `只读档 · pure 模式 · ${permissionLabels.join(' · ')} · 不自动批准`;
  getElement('agent-workbench-meta').textContent = `可用 Agent ${data.summary?.availableProviderCount || 0} 个 · 活跃任务 ${data.summary?.activeTaskCount || 0} 个 · ${formatTime(data.generatedAt)}`;
  if (agentWorkbenchState.slashCommandBusy) {
    setStatus(agentWorkbenchState.slashCommandBusyText === '压缩中...'
      ? '正在压缩当前会话上下文，请稍候...'
      : `正在执行 ${agentWorkbenchState.slashCommandBusyText || '命令'}...`);
  } else if (agentWorkbenchState.slashCommandNotice && agentWorkbenchState.slashCommandNoticeUntil > Date.now()) {
    setStatus(agentWorkbenchState.slashCommandNotice, agentWorkbenchState.slashCommandNoticeTone);
  } else {
    agentWorkbenchState.slashCommandNotice = '';
    setStatus(enabled
      ? (writeEnabled ? 'Agent 工作台已启用，实际修改任务需要目录授权并在会话首次写入时确认。' : 'Agent 工作台已启用，当前仅允许只读任务。')
      : 'Agent 工作台保持关闭，不会启动本地 Agent 进程。');
  }
}

function getNativeWorkspaceId() {
  return getElement('agent-workspace')?.value || getSelectedWorkspaceTask()?.workspaceId || 'plugin';
}

function setMobilePanel(panel = '') {
  const normalized = ['sessions', 'context'].includes(panel) ? panel : '';
  const sessionPanel = document.querySelector('.agent-session-sidebar');
  const contextPanel = document.querySelector('.agent-context-sidebar');
  sessionPanel?.classList.toggle('is-mobile-visible', normalized === 'sessions');
  contextPanel?.classList.toggle('is-mobile-visible', normalized === 'context');
  document.querySelectorAll('[data-mobile-panel]').forEach(button => {
    const active = button.dataset.mobilePanel === normalized;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-expanded', active ? 'true' : 'false');
  });
}

function setContextCollapsed(collapsed, { persist = true } = {}) {
  agentWorkbenchState.contextCollapsed = collapsed === true;
  const desktop = window.matchMedia('(min-width: 1021px)').matches;
  const active = desktop && agentWorkbenchState.contextCollapsed;
  const shell = document.querySelector('.agent-workbench-shell');
  const button = getElement('agent-context-collapse-btn');
  shell?.classList.toggle('is-context-collapsed', active);
  if (button) {
    button.setAttribute('aria-expanded', active ? 'false' : 'true');
    button.setAttribute('aria-label', active ? '展开任务上下文' : '收起任务上下文');
    button.title = active ? '展开任务上下文' : '收起任务上下文';
    const icon = button.querySelector('[aria-hidden]');
    if (icon) icon.textContent = active ? '‹' : '›';
  }
  if (persist) {
    try {
      window.localStorage.setItem(agentContextCollapsedStorageKey, agentWorkbenchState.contextCollapsed ? '1' : '0');
    } catch {
      // Storage may be unavailable in hardened browser contexts.
    }
  }
}

function restoreContextCollapsed() {
  try {
    agentWorkbenchState.contextCollapsed = window.localStorage.getItem(agentContextCollapsedStorageKey) === '1';
  } catch {
    agentWorkbenchState.contextCollapsed = false;
  }
  setContextCollapsed(agentWorkbenchState.contextCollapsed, { persist: false });
}

function renderNativeList(items, emptyText, renderer) {
  return Array.isArray(items) && items.length
    ? items.map(renderer).join('')
    : `<span class="agent-context-empty">${escapeHtml(emptyText)}</span>`;
}

function renderNativePayload(payload = {}) {
  const data = payload.data || payload;
  agentWorkbenchState.nativePayload = data;
  agentWorkbenchState.slashCommandsLoaded = true;
  agentWorkbenchState.nativeWorkspaceId = data.workspace?.id || agentWorkbenchState.nativeWorkspaceId;
  getElement('agent-native-meta').textContent = `${data.workspace?.label || '工作目录'} · ${formatTime(data.generatedAt)}`;
  const errors = Array.isArray(data.errors) ? data.errors.filter(Boolean) : [];
  if (errors.length) getElement('agent-native-session-status').textContent = `部分能力读取失败（${errors.length}）`;
  renderNativeProviders(data);
  renderNativeAgents(data);
  renderNativeTools(data);
  if (agentWorkbenchState.slashMenuOpen) renderSlashMenu({ keepSelection: true });
  renderNativeSessionState(data);
  renderNativeWorktrees(data.worktrees || []);
  renderNativeTerminals(data.terminals || []);
  renderNativeDiff(agentWorkbenchState.nativeDiff || []);
  renderNativeGit(data.git || {});
}

function renderNativeAgents(data = {}) {
  const agents = Array.isArray(data.agents) ? data.agents : [];
  const task = getSelectedWorkspaceTask();
  const values = agents.length ? agents : [{ name: 'plan', description: '只读规划' }, { name: 'build', description: '实际修改' }];
  const options = values.map(agent => {
    const title = agent.description ? ` title="${escapeHtml(`${agent.name} — ${agent.description}`)}"` : '';
    return `<option value="${escapeHtml(agent.name)}"${title}>${escapeHtml(agent.name)}</option>`;
  }).join('');
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
  updateModelVariantOptions();
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

function renderOpenCodeRuntimes(items = agentWorkbenchState.openCodeRuntimes, payload = {}) {
  const runtimes = Array.isArray(items) ? items : [];
  const target = getElement('agent-opencode-runtime-list');
  if (!target) return;
  const limit = Math.max(0, Number(payload.limit || agentWorkbenchState.payload?.config?.maxOpenCodeRuntimes || 0));
  const resource = payload.resource && typeof payload.resource === 'object' ? payload.resource : {};
  getElement('agent-opencode-runtime-meta').textContent = limit
    ? `${runtimes.length}/${limit} 个运行时`
    : `${runtimes.length} 个运行时`;
  getElement('agent-opencode-resource-summary').innerHTML = [
    ['OpenCode 内存', formatMemorySize(resource.totalRuntimeMemoryBytes), '运行时工作集总和'],
    ['系统内存', `${formatMemorySize(resource.systemUsedMemoryBytes)} / ${formatMemorySize(resource.systemMemoryBytes)}`, `空闲 ${formatMemorySize(resource.systemFreeMemoryBytes)}`],
    ['CPU 占用', formatPercent(resource.totalRuntimeCpuPercent), `${Number(resource.cpuCount || 0) || '-'} 逻辑核心`],
    ['运行时', `${runtimes.length}${limit ? ` / ${limit}` : ''}`, '任务和终端共用'],
  ].map(([label, value, detail]) => `
    <div class="agent-resource-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></div>
  `).join('');
  target.innerHTML = renderNativeList(runtimes, '当前没有运行中的 OpenCode 服务。', runtime => {
    const activeTasks = Array.isArray(runtime.activeTasks) ? runtime.activeTasks : [];
    const busy = Number(runtime.activeTaskCount || 0) > 0 || Number(runtime.terminalCount || 0) > 0;
    const idleText = busy
      ? '使用中'
      : `约 ${formatDuration(runtime.idleRemainingMs || 0)} 后回收`;
    return `
      <article class="agent-native-item agent-opencode-runtime-item">
        <div class="agent-native-item-head">
          <strong>${escapeHtml(runtime.workspace?.label || 'OpenCode 运行时')}</strong>
          <span>${runtime.closing ? '正在关闭' : (busy ? '运行中' : '空闲')}</span>
        </div>
        <code title="${escapeHtml(runtime.workspace?.path || '')}">${escapeHtml(runtime.workspace?.path || runtime.profile || '')}</code>
        <div class="agent-opencode-runtime-metrics">
          <span><small>PID</small><strong>${Number(runtime.pid || 0) || '-'}</strong></span>
          <span><small>内存</small><strong>${escapeHtml(formatMemorySize(runtime.memoryBytes))}</strong></span>
          <span><small>CPU</small><strong>${escapeHtml(formatPercent(runtime.cpuPercent))}</strong></span>
          <span><small>任务</small><strong>${Number(runtime.activeTaskCount || 0)}</strong></span>
          <span><small>终端</small><strong>${Number(runtime.terminalCount || 0)}</strong></span>
        </div>
        <div class="agent-opencode-runtime-foot">
          <span>${escapeHtml(idleText)} · 最近使用 ${escapeHtml(formatTime(runtime.lastUsedAt))}</span>
          <button type="button" class="agent-mini-btn" data-opencode-runtime-close="${escapeHtml(runtime.id || '')}" ${busy || runtime.closing ? 'disabled' : ''}>关闭</button>
        </div>
        ${activeTasks.length ? `<div class="agent-opencode-runtime-tasks">${activeTasks.map(task => `<span>${escapeHtml(task.title || task.id)}</span>`).join('')}</div>` : ''}
      </article>
    `;
  });
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
  const summary = summarizeChanges(diffs);
  getElement('agent-native-diff-summary').innerHTML = renderChangeSummary(summary, { includeFiles: false });
  target.innerHTML = renderNativeList(diffs, '选择会话后读取 OpenCode Diff。', diff => {
    const file = diff.file || diff.path || diff.filename || '未命名文件';
    const text = diff.diff || diff.patch || diff.content || JSON.stringify(diff, null, 2);
    const restore = diff.status === 'added' ? '' : `<button type="button" class="agent-native-diff-restore" data-diff-restore="${escapeHtml(file)}">恢复此文件</button>`;
    return `<details class="agent-native-item agent-native-diff-item"><summary><strong>${escapeHtml(file)}</strong><span>${renderChangeBadge(diff)}${restore}</span></summary><pre class="agent-diff-output">${renderDiffText(text)}</pre></details>`;
  });
}

function renderNativeGit(git = {}) {
  const state = git || {};
  const branchSelect = getElement('agent-native-git-branch');
  const previousBranch = branchSelect.value;
  const branches = Array.isArray(state.branches) ? state.branches : [];
  branchSelect.innerHTML = branches.length
    ? branches.map(branch => `<option value="${escapeHtml(branch)}">${escapeHtml(branch)}</option>`).join('')
    : '<option value="">暂无分支</option>';
  if (branches.includes(previousBranch)) branchSelect.value = previousBranch;
  else if (branches.includes(state.branch)) branchSelect.value = state.branch;
  getElement('agent-native-git-status').textContent = state.available
    ? `${state.branch || '未命名分支'} · ${Array.isArray(state.files) ? state.files.length : 0} 个改动`
    : (state.error || '不是 Git 工作区');
  const files = Array.isArray(state.files) ? state.files : [];
  const selected = new Set(agentWorkbenchState.gitSelectedFiles);
  selected.forEach(file => { if (!files.some(item => item.path === file)) selected.delete(file); });
  agentWorkbenchState.gitSelectedFiles = [...selected];
  getElement('agent-native-git-files').innerHTML = files.length
    ? files.map(item => `
      <label class="agent-native-git-file">
        <input type="checkbox" value="${escapeHtml(item.path)}" ${selected.has(item.path) ? 'checked' : ''} />
        <span class="agent-git-file-status">${escapeHtml(item.status || '?')}</span>
        <code>${escapeHtml(item.path)}</code>
      </label>
    `).join('')
    : '<span class="agent-context-empty">当前没有 Git 改动。</span>';
}

async function loadNativeGit() {
  const task = getSelectedWorkspaceTask();
  if (!task?.id) {
    renderNativeGit({ available: false, error: '请先选择一个已创建会话' });
    return;
  }
  const result = await fetchJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/git`);
  renderNativeGit(result.git || {});
}

function getSelectedGitFiles() {
  const files = [...document.querySelectorAll('#agent-native-git-files input[type="checkbox"]:checked')].map(input => input.value);
  agentWorkbenchState.gitSelectedFiles = files;
  return files;
}

async function runNativeGitAction(action, payload = {}) {
  const task = getSelectedWorkspaceTask();
  if (!task?.id) return webConsoleAlert('请先选择一个已创建会话。');
  await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/git/${action}`, payload);
  await loadNativeGit();
  await loadNativeDiff();
  await refreshAgentWorkbench({ quiet: true });
}

async function checkoutNativeGitBranch() {
  const branch = getElement('agent-native-git-branch').value;
  if (!branch) return;
  const confirmed = await webConsoleConfirm(`确认切换到 Git 分支“${branch}”？未提交修改可能影响切换结果。`, { title: '切换 Git 分支', confirmText: '确认切换' });
  if (confirmed) await runNativeGitAction('branch', { operation: 'checkout', branch, confirmed: true });
}

async function createNativeGitBranch() {
  const branch = String(getElement('agent-native-git-new-branch').value || '').trim();
  if (!branch) return webConsoleAlert('请输入新分支名称。');
  const confirmed = await webConsoleConfirm(`确认创建并切换到分支“${branch}”？`, { title: '创建 Git 分支', confirmText: '确认创建' });
  if (!confirmed) return;
  await runNativeGitAction('branch', { operation: 'create', branch, confirmed: true });
  getElement('agent-native-git-new-branch').value = '';
}

async function commitNativeGit() {
  const message = String(getElement('agent-native-git-message').value || '').trim();
  if (message.length < 2) return webConsoleAlert('请输入提交说明。');
  const confirmed = await webConsoleConfirm(`确认提交当前 Git 改动？\n\n提交说明：${message}`, { title: '提交 Git 改动', confirmText: '确认提交' });
  if (!confirmed) return;
  await runNativeGitAction('commit', { message, confirmed: true });
  getElement('agent-native-git-message').value = '';
}

function renderNativeTerminals(terminals = []) {
  const select = getElement('agent-terminal-select');
  const previous = agentWorkbenchState.selectedTerminalId;
  const terminalAllowed = agentWorkbenchState.payload?.config?.allowTerminal === true;
  select.innerHTML = terminals.length
    ? terminals.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || item.id)} · ${escapeHtml(item.status || '')}</option>`).join('')
    : '<option value="">暂无终端</option>';
  agentWorkbenchState.selectedTerminalId = terminals.some(item => item.id === previous) ? previous : (terminals[0]?.id || '');
  select.value = agentWorkbenchState.selectedTerminalId;
  const selected = terminals.find(item => item.id === agentWorkbenchState.selectedTerminalId);
  const output = selected?.output || (terminals.length
    ? '终端暂无输出。'
    : (terminalAllowed ? '暂无终端，请点击“新建终端”创建一个受控终端。' : '受控终端默认关闭，请先在设置中授权。'));
  if (ensureXterm()) {
    const terminal = agentWorkbenchState.xterm;
    const nextOutput = String(output);
    if (agentWorkbenchState.xtermTerminalId !== selected?.id) {
      terminal.clear();
      agentWorkbenchState.xtermTerminalId = selected?.id || '';
      agentWorkbenchState.xtermRenderedOutput = '';
    }
    if (nextOutput !== agentWorkbenchState.xtermRenderedOutput) {
      if (nextOutput.startsWith(agentWorkbenchState.xtermRenderedOutput)) {
        terminal.write(nextOutput.slice(agentWorkbenchState.xtermRenderedOutput.length).replace(/\r?\n/g, '\r\n'));
      } else {
        terminal.clear();
        terminal.write(nextOutput.replace(/\r?\n/g, '\r\n'));
      }
      agentWorkbenchState.xtermRenderedOutput = nextOutput;
    }
    agentWorkbenchState.xtermFit?.fit?.();
    getElement('agent-terminal-fallback')?.classList.add('hidden');
  } else {
    const fallback = getElement('agent-terminal-fallback') || getElement('agent-terminal-output');
    if (fallback) {
      fallback.textContent = output;
      fallback.classList.remove('hidden');
    }
  }
  const createButton = getElement('agent-terminal-create');
  if (createButton) {
    createButton.disabled = !terminalAllowed;
    createButton.title = terminalAllowed ? '创建受控终端' : '请先在工作台设置中授权受控终端';
  }
  getElement('agent-terminal-close').disabled = !selected;
  getElement('agent-terminal-interrupt').disabled = !selected;
}

async function loadNativePayload() {
  const task = getSelectedWorkspaceTask();
  const result = await fetchJson(`/api/agent-workbench/native?workspace=${encodeURIComponent(getNativeWorkspaceId())}&task=${encodeURIComponent(task?.id || '')}`);
  renderNativePayload(result);
  return result;
}

async function loadSessionHistory(options = {}) {
  const task = getSelectedWorkspaceTask();
  if (!task?.id || !task.opencodeSessionId) {
    if (!options.quiet) await webConsoleAlert('当前会话还没有可读取的 OpenCode 历史。');
    return false;
  }
  setButtonBusy('agent-history-load-btn', true, '加载完整历史', '加载中...');
  try {
    const result = await fetchJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/history?limit=500`);
    agentWorkbenchState.nativeHistoryByTask.set(task.id, Array.isArray(result.messages) ? result.messages : []);
    renderConversation(task);
    getElement('agent-history-load-btn').textContent = result.hasMore
      ? `已加载 ${Number(result.loadedCount || 0)} 条（仍有更多）`
      : `刷新完整历史（${Number(result.loadedCount || 0)}）`;
    return true;
  } catch (error) {
    if (!options.quiet) await webConsoleAlert(`读取完整历史失败：${error.message}`);
    return false;
  } finally {
    setButtonBusy('agent-history-load-btn', false, '加载完整历史', '加载中...');
    const selected = getSelectedWorkspaceTask();
    if (selected?.id === task.id) {
      getElement('agent-history-load-btn').textContent = agentWorkbenchState.nativeHistoryByTask.has(task.id)
        ? '刷新完整历史'
        : '加载完整历史';
    }
  }
}

async function loadOpenCodeRuntimes(options = {}) {
  if (agentWorkbenchState.runtimeLoading) return null;
  const target = getElement('agent-opencode-runtime-list');
  if (target && !options.quiet) target.innerHTML = '<span class="agent-context-empty">正在读取 OpenCode 运行时...</span>';
  agentWorkbenchState.runtimeLoading = true;
  try {
    const result = await fetchJson('/api/agent-workbench/opencode/runtimes');
    agentWorkbenchState.openCodeRuntimes = Array.isArray(result.runtimes) ? result.runtimes : [];
    renderOpenCodeRuntimes(agentWorkbenchState.openCodeRuntimes, result);
    return result;
  } catch (error) {
    if (target) target.innerHTML = `<span class="agent-context-empty">运行时读取失败：${escapeHtml(error.message)}</span>`;
    if (!options.quiet) throw error;
    return null;
  } finally {
    agentWorkbenchState.runtimeLoading = false;
  }
}

async function closeOpenCodeRuntime(runtimeId = '') {
  if (!runtimeId) return;
  const runtime = agentWorkbenchState.openCodeRuntimes.find(item => item.id === runtimeId);
  if (!await webConsoleConfirm(`确定关闭 PID ${runtime?.pid || '-'} 的空闲 OpenCode 运行时吗？`, {
    title: '关闭 OpenCode 运行时',
    confirmText: '关闭运行时',
  })) return;
  await postJson(`/api/agent-workbench/opencode/runtimes/${encodeURIComponent(runtimeId)}/close`, { confirmed: true });
  await loadOpenCodeRuntimes();
}

function stopRuntimePolling() {
  if (!agentWorkbenchState.runtimePollTimer) return;
  window.clearInterval(agentWorkbenchState.runtimePollTimer);
  agentWorkbenchState.runtimePollTimer = null;
}

function setNativeView(view = 'session') {
  agentWorkbenchState.nativeView = view;
  document.querySelectorAll('[data-native-view]').forEach(button => {
    const active = button.dataset.nativeView === view;
    button.classList.toggle('is-active', active);
    if (active) button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
  document.querySelectorAll('[data-native-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.nativePanel !== view));
  stopRuntimePolling();
  if (view === 'runtime') {
    agentWorkbenchState.runtimePollTimer = window.setInterval(() => {
      if (document.hidden || getElement('agent-native-mask')?.classList.contains('hidden')) return;
      loadOpenCodeRuntimes({ quiet: true }).catch(() => {});
    }, 5000);
  }
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
    if (agentWorkbenchState.nativeView === 'runtime') await loadOpenCodeRuntimes();
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

async function manageNativeSession(action, options = {}) {
  const task = getSelectedWorkspaceTask();
  if (!task?.id) {
    await webConsoleAlert('请先选择一个已建立的 Agent 会话。');
    return false;
  }
  let payload = {};
  if (action === 'background') {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/session/background`, {});
    if (result.task) mergeStreamTask(result.task);
    await loadNativePayload();
    await refreshAgentWorkbench({ quiet: true });
    return true;
  }
  if (action === 'rename') {
    payload.title = String(options.title ?? getElement('agent-native-session-title').value).trim();
    if (!payload.title) {
      await webConsoleAlert('请输入会话名称，例如：/rename 登录模块排查。');
      return false;
    }
  } else if (action === 'delete') {
    if (!await webConsoleConfirm(`确定删除会话“${task.title || 'Agent 会话'}”吗？`, { title: '删除会话', confirmText: '删除' })) return false;
    payload.confirmed = true;
  } else if (action === 'delete-message') {
    const messageId = String(options.messageId || '').trim();
    if (!messageId) return false;
    if (!await webConsoleConfirm('确定从 OpenCode 会话中删除这条消息吗？此操作不能撤销。', {
      title: '删除消息', confirmText: '删除消息',
    })) return false;
    payload.confirmed = true;
    payload.messageId = messageId;
  } else if (action === 'fork' && options.messageId) {
    payload.messageId = String(options.messageId).trim();
  } else if (action === 'summarize') {
    const selectedModel = String(task.model || '').trim();
    const selectedProvider = String(task.modelProviderId || '').trim();
    const separator = selectedModel.indexOf('/');
    if (selectedProvider && selectedModel) {
      payload.providerId = selectedProvider;
      payload.modelId = selectedModel;
    } else if (separator > 0) {
      payload.providerId = selectedModel.slice(0, separator);
      payload.modelId = selectedModel.slice(separator + 1);
    }
  } else if (action === 'revert') {
    const message = [...(task.messages || [])].reverse().find(item => item.role === 'assistant' && item.openCodeMessageId);
    if (!message) {
      await webConsoleAlert('当前会话没有可撤销的消息。');
      return false;
    }
    payload.messageId = message.openCodeMessageId;
  }
  try {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/session/${action}`, payload);
    if (result.removed) {
      agentWorkbenchState.selectedTaskId = '';
      agentWorkbenchState.newSession = true;
      getElement('agent-native-mask').classList.add('hidden');
      stopRuntimePolling();
    } else if (result.task) {
      if (action === 'fork') agentWorkbenchState.selectedTaskId = result.task.id;
      mergeStreamTask(result.task);
      if (action === 'delete-message') {
        agentWorkbenchState.nativeHistoryByTask.delete(task.id);
        await loadSessionHistory({ quiet: true });
      }
      getElement('agent-native-session-title').value = result.task.title || '';
      if (action !== 'summarize') await loadNativeDiff();
    }
    // 压缩结果已经随当前任务响应和事件流返回，不再等待完整能力中心刷新。
    // 这样长耗时的状态探测不会阻塞输入框清空和发送按钮恢复。
    if (action !== 'summarize') await refreshAgentWorkbench({ quiet: true });
    return true;
  } catch (error) {
    setSlashCommandNotice(`${action === 'summarize' ? '压缩上下文' : '会话操作'}失败：${error.message}`, 'error');
    await webConsoleAlert(error.message);
    return false;
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

async function runNativeCommand(command, argumentsText = '', options = {}) {
  const task = getSelectedWorkspaceTask();
  if (!task?.id) {
    await webConsoleAlert('请先选择一个已建立的 Agent 会话。');
    return false;
  }
  if (!command) {
    await webConsoleAlert('请选择需要执行的 Command。');
    return false;
  }
  const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/command`, {
    command,
    arguments: String(argumentsText || '').trim(),
    agent: getElement('agent-native-agent').value || task.agent,
    model: getElement('agent-native-model').value.trim() || task.model,
    modelProviderId: agentWorkbenchState.selectedModelProviderId || task.modelProviderId,
  });
  if (result.task) mergeStreamTask(result.task);
  await refreshAgentWorkbench({ quiet: true });
  if (options.refreshNative !== false) await loadNativePayload();
  return true;
}

async function executeNativeCommand(event) {
  event?.preventDefault?.();
  const command = getElement('agent-native-command-select').value;
  const completed = await runNativeCommand(command, getElement('agent-native-command-args').value, { refreshNative: true });
  if (completed) getElement('agent-native-command-args').value = '';
}

function insertNativeSkill(name) {
  const prompt = getElement('agent-prompt');
  const prefix = `使用 skill: ${name}`;
  prompt.value = prompt.value.trim() ? `${prompt.value.trim()}\n\n${prefix}` : prefix;
  getElement('agent-native-mask').classList.add('hidden');
  stopRuntimePolling();
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
    agentWorkbenchState.terminalHistory = [input, ...agentWorkbenchState.terminalHistory.filter(item => item !== input)].slice(0, 50);
    agentWorkbenchState.terminalHistoryIndex = -1;
    getElement('agent-terminal-input').value = '';
    await loadNativePayload();
  } catch (error) {
    await webConsoleAlert(error.message);
  }
}

async function sendNativeTerminalInput(input = '') {
  const terminalId = agentWorkbenchState.selectedTerminalId;
  const value = String(input || '').replace(/\u0000/g, '').slice(0, 8000);
  if (!terminalId || !value) return;
  agentWorkbenchState.terminalInputQueue = agentWorkbenchState.terminalInputQueue
    .catch(() => {})
    .then(() => postJson(`/api/agent-workbench/terminals/${encodeURIComponent(terminalId)}/input`, { input: value }));
  await agentWorkbenchState.terminalInputQueue;
}

async function interruptNativeTerminal() {
  const terminalId = agentWorkbenchState.selectedTerminalId;
  if (!terminalId) return;
  try {
    await postJson(`/api/agent-workbench/terminals/${encodeURIComponent(terminalId)}/input`, { input: '\u0003' });
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

async function closeOpenCodeRuntimes() {
  const confirmed = await webConsoleConfirm(
    '将关闭本插件启动的所有 OpenCode 后台服务，断开终端连接，并取消正在运行或排队的 OpenCode Agent 任务。不会影响其他插件或系统进程。是否继续？',
    { title: '关闭 OpenCode', confirmText: '关闭服务' },
  );
  if (!confirmed) return;
  setButtonBusy('agent-close-opencode-btn', true, '关闭 OpenCode', '关闭中...');
  try {
    const result = await postJson('/api/agent-workbench/opencode/close', { confirmed: true });
    const terminalText = result.closedTerminalCount ? `，已断开 ${result.closedTerminalCount} 个终端` : '';
    setStatus(`${result.message || 'OpenCode 服务已关闭'}${terminalText}`);
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(`关闭 OpenCode 失败：${error.message}`);
  } finally {
    setButtonBusy('agent-close-opencode-btn', false, '关闭 OpenCode', '关闭中...');
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
    if (agentWorkbenchState.sessionQuery) query.set('q', agentWorkbenchState.sessionQuery);
    if (agentWorkbenchState.includeArchived) query.set('archived', '1');
    const result = await fetchJson(`/api/agent-workbench${query.size ? `?${query.toString()}` : ''}`);
    renderPayload(result);
    agentWorkbenchState.lastFullRefreshAt = Date.now();
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
  let nativeConfig = { mcp: {}, agent: {}, command: {} };
  const nativeConfigText = getElement('agent-native-config').value.trim();
  if (nativeConfigText) {
    try {
      nativeConfig = JSON.parse(nativeConfigText);
    } catch {
      throw new Error('OpenCode 能力配置不是有效 JSON');
    }
  }
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
    nativeConfig,
    timeoutMs: Number(getElement('agent-timeout-ms').value || 1800000),
    maxConcurrentTasks: Number(getElement('agent-max-concurrent').value || 1),
    maxOpenCodeRuntimes: Number(getElement('agent-max-runtimes').value || 2),
    runtimeIdleTimeoutMs: Number(getElement('agent-runtime-idle').value || 120000),
    manualContextLimit: Number(getElement('agent-manual-context-limit').value || 0),
    autoCompactEnabled: getElement('agent-auto-compact-enabled').checked === true,
    autoCompactThreshold: Number(getElement('agent-auto-compact-threshold').value || 80),
    compactModel: getElement('agent-compact-model').value || '',
    compactProviderId: getElement('agent-compact-provider').value || '',
    providers: {
      opencode: getElement('agent-provider-opencode').checked === true,
    },
    outputImagesEnabled: getElement('agent-output-images').checked === true,
    writableWorkspaces: {
      plugin: getElement('agent-write-plugin').checked === true,
      plugins: getElement('agent-write-plugins').checked === true,
      yunzai: getElement('agent-write-yunzai').checked === true,
    },
  };
}

function readNativeConfigPart(id, label) {
  const text = String(getElement(id)?.value || '').trim();
  if (!text) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label}配置不是有效 JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}配置必须是 JSON 对象`);
  }
  return value;
}

function syncNativeConfigPanels() {
  let value;
  try {
    value = JSON.parse(String(getElement('agent-native-config')?.value || '').trim() || '{}');
  } catch {
    throw new Error('OpenCode 能力配置不是有效 JSON');
  }
  ['mcp', 'agent', 'command'].forEach(key => {
    const target = getElement(`agent-native-config-${key}`);
    if (target) target.value = JSON.stringify(value?.[key] && typeof value[key] === 'object' ? value[key] : {}, null, 2);
  });
}

function applyNativeConfigPanels() {
  const nativeConfig = {
    mcp: readNativeConfigPart('agent-native-config-mcp', 'MCP'),
    agent: readNativeConfigPart('agent-native-config-agent', 'Agent'),
    command: readNativeConfigPart('agent-native-config-command', 'Command'),
  };
  getElement('agent-native-config').value = JSON.stringify(nativeConfig, null, 2);
  agentWorkbenchState.settingsDirty = true;
  setStatus('已把分栏配置合并到 OpenCode 能力 JSON，请点击“保存”。');
}

function setSettingsModalOpen(open) {
  const visible = open === true;
  agentWorkbenchState.settingsOpen = visible;
  getElement('agent-settings-mask').classList.toggle('hidden', !visible);
  getElement('agent-settings-toggle').classList.toggle('is-active', visible);
  getElement('agent-settings-toggle').setAttribute('aria-expanded', visible ? 'true' : 'false');
  document.body.classList.toggle('agent-settings-modal-open', visible);
  if (visible) {
    setMobilePanel('');
    getElement('agent-settings-close').focus();
  } else {
    getElement('agent-settings-toggle').focus();
  }
}

async function saveSettings() {
  setButtonBusy('agent-save-btn', true, '保存设置', '保存中...');
  try {
    const draft = readSettingsDraft();
    const result = await postJson('/api/agent-workbench/settings', draft);
    const savedManualContextLimit = Math.max(0, Number(result?.data?.config?.manualContextLimit || 0));
    if (savedManualContextLimit !== draft.manualContextLimit) {
      agentWorkbenchState.settingsDirty = true;
      throw new Error('手动上下文容量未被后端保存，请重启本地控制台后重试。');
    }
    agentWorkbenchState.settingsDirty = false;
    renderPayload(result);
    setStatus('Agent 工作台设置已保存。');
    setSettingsModalOpen(false);
  } finally {
    setButtonBusy('agent-save-btn', false, '保存设置', '保存中...');
  }
}

function normalizeSlashCommandName(value = '') {
  return String(value || '').trim().replace(/^\/+/, '').split(/\s+/)[0].slice(0, 180);
}

function getAllSlashCommands() {
  const builtins = agentSlashCommands.map(command => ({ ...command, source: '工作台' }));
  const reservedNames = new Set(builtins.flatMap(command => [command.name, ...(command.aliases || [])]).map(name => name.toLowerCase()));
  const nativeCommands = Array.isArray(agentWorkbenchState.nativePayload?.commands)
    ? agentWorkbenchState.nativePayload.commands
      .map(command => {
        const name = normalizeSlashCommandName(command?.name);
        if (!name || reservedNames.has(name.toLowerCase())) return null;
        return {
          name,
          aliases: [],
          label: command.description || `执行 OpenCode Command：/${name}`,
          description: command.description || '执行当前 OpenCode 配置中的自定义 Command',
          kind: 'native',
          action: 'command',
          nativeCommand: name,
          source: 'OpenCode',
        };
      })
      .filter(Boolean)
    : [];
  return [...builtins, ...nativeCommands];
}

function getSlashMenuQuery() {
  const value = String(getElement('agent-prompt')?.value || '').trimStart();
  const match = value.match(/^\/([^\s]*)$/);
  return match ? match[1] : null;
}

function closeSlashMenu() {
  agentWorkbenchState.slashMenuOpen = false;
  agentWorkbenchState.slashActiveIndex = 0;
  agentWorkbenchState.slashVisibleCommands = [];
  getElement('agent-slash-menu')?.classList.add('hidden');
  getElement('agent-slash-btn')?.setAttribute('aria-expanded', 'false');
}

async function ensureSlashCommandsLoaded() {
  if (agentWorkbenchState.slashCommandsLoaded) return agentWorkbenchState.nativePayload?.commands || [];
  if (agentWorkbenchState.slashCommandsPromise) return agentWorkbenchState.slashCommandsPromise;
  agentWorkbenchState.slashCommandsLoading = true;
  if (agentWorkbenchState.slashMenuOpen) renderSlashMenu({ keepSelection: true, skipLoad: true });
  agentWorkbenchState.slashCommandsPromise = loadNativePayload()
    .then(payload => payload?.data?.commands || payload?.commands || [])
    .catch(error => {
      setStatus(`OpenCode Command 暂时无法读取：${error.message}`, 'warn');
      return [];
    })
    .finally(() => {
      agentWorkbenchState.slashCommandsLoading = false;
      agentWorkbenchState.slashCommandsLoaded = true;
      agentWorkbenchState.slashCommandsPromise = null;
      if (agentWorkbenchState.slashMenuOpen) renderSlashMenu({ keepSelection: true, skipLoad: true });
    });
  return agentWorkbenchState.slashCommandsPromise;
}

function renderSlashMenu(options = {}) {
  const prompt = getElement('agent-prompt');
  const menu = getElement('agent-slash-menu');
  const list = getElement('agent-slash-list');
  if (!prompt || !menu || !list) return;
  let query = getSlashMenuQuery();
  if (query === null && options.force === true) {
    prompt.value = '/';
    prompt.setSelectionRange(prompt.value.length, prompt.value.length);
    query = '';
  }
  if (query === null) {
    closeSlashMenu();
    return;
  }
  const normalizedQuery = query.toLowerCase();
  const commands = getAllSlashCommands()
    .filter(command => {
      if (!normalizedQuery) return true;
      const searchText = [command.name, command.label, command.description, ...(command.aliases || [])].join(' ').toLowerCase();
      return searchText.includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftExact = [left.name, ...(left.aliases || [])].some(name => name.toLowerCase() === normalizedQuery);
      const rightExact = [right.name, ...(right.aliases || [])].some(name => name.toLowerCase() === normalizedQuery);
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
      if (left.source !== right.source) return left.source === '工作台' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  if (!options.keepSelection) agentWorkbenchState.slashActiveIndex = 0;
  agentWorkbenchState.slashActiveIndex = Math.max(0, Math.min(commands.length - 1, agentWorkbenchState.slashActiveIndex));
  agentWorkbenchState.slashVisibleCommands = commands;
  const rows = commands.map((command, index) => {
    const aliases = (command.aliases || []).length ? ` · 别名 ${(command.aliases || []).map(name => `/${name}`).join('、')}` : '';
    return `<button type="button" class="agent-slash-item${index === agentWorkbenchState.slashActiveIndex ? ' is-active' : ''}" data-slash-index="${index}" role="option" aria-selected="${index === agentWorkbenchState.slashActiveIndex ? 'true' : 'false'}"><span class="agent-slash-command">/${escapeHtml(command.name)}</span><span class="agent-slash-description">${escapeHtml(`${command.label}${aliases}`)}</span><span class="agent-slash-source">${escapeHtml(command.source)}</span></button>`;
  });
  if (agentWorkbenchState.slashCommandsLoading) rows.push('<span class="agent-slash-empty">正在读取 OpenCode Command...</span>');
  if (!rows.length) rows.push(`<span class="agent-slash-empty">没有匹配“/${escapeHtml(query)}”的命令</span>`);
  list.innerHTML = rows.join('');
  menu.classList.remove('hidden');
  getElement('agent-slash-btn')?.setAttribute('aria-expanded', 'true');
  agentWorkbenchState.slashMenuOpen = true;
  if (!agentWorkbenchState.slashCommandsLoaded && !agentWorkbenchState.slashCommandsLoading && options.skipLoad !== true) {
    ensureSlashCommandsLoaded().catch(() => {});
  }
}

function fillSlashCommand(command) {
  if (!command) return;
  const prompt = getElement('agent-prompt');
  prompt.value = `/${command.name}${command.requiresArgument || command.kind === 'native' ? ' ' : ''}`;
  prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  closeSlashMenu();
  prompt.focus();
}

function moveSlashSelection(delta) {
  const commands = agentWorkbenchState.slashVisibleCommands;
  if (!commands.length) return;
  agentWorkbenchState.slashActiveIndex = (agentWorkbenchState.slashActiveIndex + delta + commands.length) % commands.length;
  renderSlashMenu({ keepSelection: true, skipLoad: true });
  getElement('agent-slash-list')?.querySelector('.agent-slash-item.is-active')?.scrollIntoView?.({ block: 'nearest' });
}

function parseSlashCommand(value = '') {
  const match = String(value || '').trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), arguments: String(match[2] || '').trim() };
}

function findSlashCommand(name = '') {
  const normalized = String(name || '').toLowerCase();
  return getAllSlashCommands().find(command => [command.name, ...(command.aliases || [])].some(value => value.toLowerCase() === normalized)) || null;
}

function clearSlashPrompt() {
  getElement('agent-prompt').value = '';
  closeSlashMenu();
  getElement('agent-prompt').focus();
}

async function executeSlashCommand(parsed) {
  if (!parsed) return false;
  let command = findSlashCommand(parsed.name);
  if (!command && !agentWorkbenchState.slashCommandsLoaded) {
    await ensureSlashCommandsLoaded();
    command = findSlashCommand(parsed.name);
  }
  if (!command) {
    await webConsoleAlert(`未知命令：/${parsed.name}。输入 / 查看当前可用命令。`);
    clearSlashPrompt();
    renderSlashMenu({ force: true });
    return true;
  }
  if (command.requiresArgument && !parsed.arguments) {
    await webConsoleAlert(`/${command.name} 需要参数。${command.description}`);
    fillSlashCommand(command);
    return true;
  }
  if (command.kind === 'native') {
    const completed = await runNativeCommand(command.nativeCommand, parsed.arguments, { refreshNative: false });
    if (completed) clearSlashPrompt();
    return true;
  }
  if (command.kind === 'session') {
    const completed = await manageNativeSession(command.action, { title: parsed.arguments });
    if (completed) {
      clearSlashPrompt();
      setSlashCommandNotice(`/${command.name} 执行完成。`);
    }
    return true;
  }
  if (command.action === 'help') {
    clearSlashPrompt();
    renderSlashMenu({ force: true });
    return true;
  }
  if (command.action === 'new') {
    startNewAgentSession();
    setStatus('已开始新会话。');
    return true;
  }
  if (command.action === 'stop') {
    const task = getSelectedWorkspaceTask();
    if (!task?.id || !['running', 'pending'].includes(task.status)) {
      await webConsoleAlert('当前没有正在执行的 Agent 任务。');
      return true;
    }
    await cancelSelectedTask();
    clearSlashPrompt();
    return true;
  }
  if (command.action === 'models' || command.action === 'commands') {
    agentWorkbenchState.nativeView = command.action === 'models' ? 'models' : 'tools';
    clearSlashPrompt();
    await openNativeCenter();
    setNativeView(agentWorkbenchState.nativeView);
    return true;
  }
  if (command.action === 'sessions') {
    clearSlashPrompt();
    setMobilePanel('sessions');
    getElement('agent-session-search')?.focus();
    return true;
  }
  if (command.action === 'archive' || command.action === 'unarchive') {
    const completed = await archiveSelectedTask(command.action === 'archive');
    if (completed) {
      clearSlashPrompt();
      setStatus(command.action === 'archive' ? '当前会话已归档。' : '当前会话已取消归档。');
    } else {
      await webConsoleAlert('请先选择一个 Agent 会话。');
    }
    return true;
  }
  if (command.action === 'delete') {
    const completed = await deleteAgentTask(agentWorkbenchState.selectedTaskId);
    if (completed) clearSlashPrompt();
    return true;
  }
  if (command.action === 'export') {
    const completed = await exportSelectedTask();
    if (completed) {
      clearSlashPrompt();
      setStatus('当前会话已导出。');
    } else {
      await webConsoleAlert('请先选择一个 Agent 会话。');
    }
    return true;
  }
  if (['status', 'terminal', 'search', 'worktrees'].includes(command.action)) {
    agentWorkbenchState.nativeView = command.action === 'status' ? 'session' : command.action;
    clearSlashPrompt();
    await openNativeCenter();
    setNativeView(agentWorkbenchState.nativeView);
    return true;
  }
  return false;
}

async function runTask(event) {
  event?.preventDefault?.();
  closeComposerOptions();
  const prompt = String(getElement('agent-prompt').value || '').trim();
  const slashCommand = parseSlashCommand(prompt);
  if (slashCommand) {
    const isCompact = ['compact', 'summarize'].includes(slashCommand.name);
    setSlashCommandBusy(true, isCompact ? '压缩中...' : '处理中...');
    setStatus(isCompact ? '正在压缩上下文：等待 Agent 生成会话摘要，通常需要几秒到一分钟...' : `正在执行 /${slashCommand.name}...`);
    try {
      await executeSlashCommand(slashCommand);
    } catch (error) {
      setStatus(`/${slashCommand.name} 执行失败：${error.message}`, 'error');
      await webConsoleAlert(error.message);
    } finally {
      setSlashCommandBusy(false);
    }
    return;
  }
  // Agent 正在提问时，输入框内容优先当作回答（支持 A/B、序号、选项文本、多选组合）
  const pendingQuestionTask = agentWorkbenchState.newSession ? null : getSelectedTask(agentWorkbenchState.payload || {});
  if (pendingQuestionTask?.pendingQuestions?.length && prompt) {
    // 待回答问题期间，输入内容一律按“回答”处理：失败也只提示回答错误，不再误报缺少任务
    await answerPendingQuestionsByText(pendingQuestionTask, prompt);
    return;
  }
  if (prompt.length < 2) {
    await webConsoleAlert('请输入需要 Agent 分析的任务。');
    return;
  }
  const providerId = getElement('agent-provider').value;
  const workspaceId = getElement('agent-workspace').value;
  const mode = getElement('agent-mode').value;
  const provider = (agentWorkbenchState.payload?.providers || []).find(item => item.id === providerId);
  const workspace = (agentWorkbenchState.payload?.workspaces || []).find(item => item.id === workspaceId);
  const writeMode = isWriteMode(mode);
  const fullAccess = isFullAccessMode(mode);
  const selectedTask = agentWorkbenchState.newSession ? null : getSelectedTask(agentWorkbenchState.payload || {});
  const continuing = Boolean(selectedTask?.id);
  const activeFollowUp = Boolean(selectedTask && ['pending', 'running'].includes(selectedTask.status));
  const followUpDelivery = activeFollowUp ? agentWorkbenchState.followUpDelivery : '';
  const requestProviderId = activeFollowUp ? selectedTask.providerId : providerId;
  const requestWorkspaceId = activeFollowUp ? selectedTask.workspaceId : workspaceId;
  if (continuing) agentWorkbenchState.nativeHistoryByTask.delete(selectedTask.id);
  const selectedAgent = getElement('agent-agent').value || (writeMode ? 'build' : 'plan');
  const selectedVariant = getSelectedModelVariant();
  if (getElement('agent-variant').value === agentCustomVariantOption) {
    if (!selectedVariant) {
      await webConsoleAlert('请输入自定义思考强度。');
      return;
    }
    if (!/^[A-Za-z0-9._:/-]{1,80}$/.test(selectedVariant)) {
      await webConsoleAlert('自定义思考强度只能包含字母、数字、点、斜杠、冒号、下划线和短横线。');
      return;
    }
  }
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
        fullAccess
          ? `将使用 ${provider?.label || providerId} 以“完全访问”模式执行“${workspace?.label || workspaceId}”中的任务。`
          : `将使用 ${provider?.label || providerId} 直接修改“${workspace?.label || workspaceId}”中的文件。`,
        fullAccess
          ? '权限范围：允许修改文件 · 允许联网 · 允许访问全目录 · 允许直接执行终端命令。'
          : `权限范围：${agentWorkbenchState.payload?.config?.allowNetwork === true ? '允许联网' : '禁止联网'} · ${agentWorkbenchState.payload?.config?.allowAllDirectories === true ? '允许访问全目录' : '仅限工作目录'}。`,
        '',
        '重要提醒：务必先备份需要保留的文件，并在继续前看清下面的执行命令。高权限会话可能读取工作目录外文件或访问网络，请确认后再继续。',
        '',
        `执行命令：${commandPreview}`,
        '',
        fullAccess
          ? '完全访问会减少终端审批次数；请只提交你明确授权的任务。是否继续？'
          : agentWorkbenchState.payload?.config?.allowTerminal === true
            ? 'Agent 请求终端命令时会暂停，必须在审批卡中逐项决定。是否继续？'
            : 'Agent 不能执行终端命令。是否继续？',
      ].join('\n'), {
        title: fullAccess ? '首次完全访问确认' : '首次写入确认',
        confirmText: fullAccess ? '我已了解风险并允许执行' : '已备份并允许本会话写入',
      });
    if (!writeConfirmed) return;
  }
  agentWorkbenchState.conversationStickToBottom = true;
  updateConversationFollowButton();
  const normalRunText = activeFollowUp
    ? '立即发送'
    : (fullAccess ? '发送并执行' : (writeMode ? '发送并修改' : '发送'));
  setButtonBusy('agent-run-btn', true, normalRunText, activeFollowUp ? '发送中...' : '启动中...');
  if (!activeFollowUp) renderPendingConversation(prompt, agentWorkbenchState.composerAttachments);
  try {
    const result = await postJson('/api/agent-workbench/tasks', {
      confirmed: true,
      writeConfirmed: writeMode && writeConfirmed,
      providerId: requestProviderId,
      workspaceId: requestWorkspaceId,
      mode: activeFollowUp ? selectedTask.mode : mode,
      agent: selectedAgent,
      model: String(getElement('agent-model').value || '').trim(),
      modelProviderId: agentWorkbenchState.selectedModelProviderId,
      variant: selectedVariant,
      title: String(getElement('agent-title').value || '').trim(),
      prompt,
      attachments: agentWorkbenchState.composerAttachments,
      priority: getElement('agent-priority').value || 'normal',
      sessionId: continuing ? selectedTask.id : '',
      ...(activeFollowUp ? { delivery: 'steer' } : {}),
      useWorktree,
      worktreeConfirmed,
    });
    agentWorkbenchState.selectedTaskId = result.task?.id || '';
    agentWorkbenchState.newSession = false;
    if (result.task) mergeStreamTask(result.task);
    getElement('agent-prompt').value = '';
    getElement('agent-title').value = '';
    agentWorkbenchState.composerAttachments = [];
    renderComposerAttachments();
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    renderSelectedTask(agentWorkbenchState.payload || {});
    await webConsoleAlert(error.message);
  } finally {
    setButtonBusy('agent-run-btn', false, normalRunText, '启动中...');
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

function closeComposerOptions() {
  const options = getElement('agent-composer-options');
  options?.classList.remove('is-open');
  document.querySelectorAll('[data-agent-composer-options-toggle]').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
  });
}

function closeContextUsageMenu() {
  const menu = getElement('agent-context-usage-menu');
  if (menu) menu.open = false;
}

function toggleComposerOptions() {
  const options = getElement('agent-composer-options');
  if (!options) return;
  const open = !options.classList.contains('is-open');
  options.classList.toggle('is-open', open);
  document.querySelectorAll('[data-agent-composer-options-toggle]').forEach(button => {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
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

async function resumeSelectedTask() {
  const taskId = agentWorkbenchState.selectedTaskId;
  if (!taskId) return;
  setButtonBusy('agent-resume-btn', true, '继续任务', '恢复中...');
  try {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(taskId)}/resume`, {});
    if (result.task) mergeStreamTask(result.task);
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(error.message);
  } finally {
    setButtonBusy('agent-resume-btn', false, '继续任务', '恢复中...');
  }
}

async function retrySelectedTask() {
  const taskId = agentWorkbenchState.selectedTaskId;
  if (!taskId) return;
  setButtonBusy('agent-retry-btn', true, '重试', '排队中...');
  try {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(taskId)}/retry`, {});
    if (result.task) mergeStreamTask(result.task);
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(error.message);
  } finally {
    setButtonBusy('agent-retry-btn', false, '重试', '排队中...');
  }
}

async function archiveTaskById(taskId = '', archived = true) {
  if (!taskId) return false;
  await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(taskId)}/${archived ? 'archive' : 'unarchive'}`, {});
  await refreshAgentWorkbench({ quiet: true });
  return true;
}

async function archiveSelectedTask(forceArchived) {
  const task = getSelectedWorkspaceTask();
  if (!task?.id) return false;
  const shouldArchive = typeof forceArchived === 'boolean' ? forceArchived : !task.archived;
  return await archiveTaskById(task.id, shouldArchive);
}

async function exportSelectedTask() {
  const task = getSelectedWorkspaceTask();
  if (!task?.id) return false;
  const result = await fetchJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/export`);
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${String(task.title || 'agent-session').replace(/[^A-Za-z0-9\u4e00-\u9fff._-]+/g, '_').slice(0, 80)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  return true;
}

async function deleteAgentTask(taskId = '') {
  const normalizedTaskId = String(taskId || '').trim();
  const task = (agentWorkbenchState.payload?.tasks || []).find(item => item.id === normalizedTaskId);
  if (!task?.id) {
    await webConsoleAlert('请先选择一个 Agent 会话。');
    return false;
  }
  if (['running', 'pending'].includes(task.status)) {
    await webConsoleAlert('运行中或排队中的会话不能删除，请先停止任务。');
    return false;
  }
  const confirmed = await webConsoleConfirm(`确定删除会话“${task.title || 'Agent 会话'}”吗？\n\n工作台记录和对应的 OpenCode 会话都会被删除，此操作无法撤销。`, {
    title: '删除会话',
    confirmText: '确认删除',
  });
  if (!confirmed) return false;
  const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/session/delete`, { confirmed: true });
  if (result.removed && agentWorkbenchState.selectedTaskId === task.id) {
    agentWorkbenchState.selectedTaskId = '';
    agentWorkbenchState.newSession = true;
    agentWorkbenchState.formTaskId = '';
  }
  await refreshAgentWorkbench({ quiet: true });
  setStatus('会话已删除。');
  return result.removed === true;
}

async function importAgentSession(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const source = JSON.parse(await file.text());
    const result = await postJson('/api/agent-workbench/import', source);
    agentWorkbenchState.selectedTaskId = result.task?.id || '';
    agentWorkbenchState.newSession = false;
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(`导入会话失败：${error.message}`);
  }
}

function startNewAgentSession() {
  setMobilePanel('');
  closeSlashMenu();
  agentWorkbenchState.selectedTaskId = '';
  agentWorkbenchState.newSession = true;
  agentWorkbenchState.conversationStickToBottom = true;
  agentWorkbenchState.formTaskId = '';
  getElement('agent-title').value = '';
  getElement('agent-prompt').value = '';
  getElement('agent-use-worktree').checked = false;
  getElement('agent-mobile-worktree').checked = false;
  getElement('agent-use-worktree').disabled = false;
  getElement('agent-agent').value = isWriteMode(getElement('agent-mode').value) ? 'build' : 'plan';
  agentWorkbenchState.selectedModelProviderId = '';
  agentWorkbenchState.followUpDelivery = 'steer';
  updateModelVariantOptions('');
  renderTasks(agentWorkbenchState.payload || {});
  renderSelectedTask(agentWorkbenchState.payload || {});
  getElement('agent-prompt').focus();
}

function bindEvents() {
  getElement('agent-output').addEventListener('scroll', handleConversationScroll, { passive: true });
  getElement('agent-output').addEventListener('click', event => {
    const codeCopyButton = event.target.closest?.('[data-agent-code-copy]');
    if (codeCopyButton) {
      copyAgentMessageCode(codeCopyButton).catch(error => webConsoleAlert(error.message));
      return;
    }
    const button = event.target.closest?.('[data-native-message-action]');
    if (!button) return;
    manageNativeSession(button.dataset.nativeMessageAction || '', {
      messageId: button.dataset.nativeMessageId || '',
    }).catch(error => webConsoleAlert(error.message));
  });
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
  // 旧“排队/调整”选择器已移除：运行中提交统一立即发送
  // 旧“排队/调整”选择器已移除：运行中提交统一立即发送
  getElement('agent-resume-btn').addEventListener('click', () => resumeSelectedTask());
  getElement('agent-retry-btn').addEventListener('click', () => retrySelectedTask());
  getElement('agent-history-load-btn').addEventListener('click', () => loadSessionHistory());
  getElement('agent-archive-btn').addEventListener('click', () => archiveSelectedTask().catch(error => webConsoleAlert(error.message)));
  getElement('agent-export-btn').addEventListener('click', () => exportSelectedTask().catch(error => webConsoleAlert(error.message)));
  getElement('agent-delete-btn').addEventListener('click', () => deleteAgentTask(agentWorkbenchState.selectedTaskId).catch(error => webConsoleAlert(error.message)));
  getElement('agent-session-search').addEventListener('input', event => {
    agentWorkbenchState.sessionQuery = String(event.target.value || '').trim();
    refreshAgentWorkbench({ quiet: true }).catch(() => {});
  });
  getElement('agent-session-archived').addEventListener('change', event => {
    agentWorkbenchState.includeArchived = event.target.checked === true;
    refreshAgentWorkbench({ quiet: true }).catch(() => {});
  });
  getElement('agent-session-import').addEventListener('click', () => getElement('agent-session-import-input').click());
  getElement('agent-session-import-input').addEventListener('change', event => importAgentSession(event));
  getElement('agent-file-editor-content').addEventListener('keydown', event => {
    const editor = event.currentTarget;
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText('  ', start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveAgentFile().catch(error => webConsoleAlert(error.message));
    }
  });
  getElement('agent-attachment-btn').addEventListener('click', () => getElement('agent-attachment-input').click());
  getElement('agent-slash-btn').addEventListener('click', () => {
    closeComposerOptions();
    if (agentWorkbenchState.slashMenuOpen) closeSlashMenu();
    else renderSlashMenu({ force: true });
    getElement('agent-prompt').focus();
  });
  getElement('agent-composer-tools-btn').addEventListener('click', toggleComposerOptions);
  getElement('agent-composer-settings-btn').addEventListener('click', toggleComposerOptions);
  getElement('agent-context-usage-menu').addEventListener('toggle', event => {
    if (!event.currentTarget.open) return;
    closeComposerOptions();
    closeSlashMenu();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest?.('#agent-composer-options, [data-agent-composer-options-toggle]')) closeComposerOptions();
    if (!event.target.closest?.('#agent-slash-menu, #agent-slash-btn')) closeSlashMenu();
    if (!event.target.closest?.('#agent-context-usage-menu')) closeContextUsageMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeContextUsageMenu();
  });
  getElement('agent-attachment-input').addEventListener('change', event => addComposerAttachments(event).catch(error => webConsoleAlert(error.message)));
  // 直接粘贴截图/图片文件作为附件（Ctrl+V），不影响文本粘贴
  getElement('agent-prompt').addEventListener('paste', event => {
    const files = [...(event.clipboardData?.items || [])]
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    addComposerAttachments({ target: { files } }).catch(error => webConsoleAlert(error.message));
  });
  const notifyToggle = getElement('agent-notify-toggle');
  notifyToggle.addEventListener('click', async () => {
    if (desktopNotifyEnabled()) {
      try { localStorage.removeItem(agentNotifyStorageKey); } catch { /* 隐私模式忽略 */ }
      syncDesktopNotifyToggle();
      setStatus('桌面提醒已关闭。');
      return;
    }
    if (typeof Notification === 'undefined') {
      await webConsoleAlert('当前浏览器不支持桌面通知。');
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      await webConsoleAlert('浏览器拒绝了桌面通知权限，可在浏览器地址栏的网站设置里重新允许。');
      return;
    }
    try { localStorage.setItem(agentNotifyStorageKey, '1'); } catch { /* 隐私模式忽略 */ }
    syncDesktopNotifyToggle();
    setStatus('桌面提醒已开启：Agent 提问或等待审批时会通知你（仅本浏览器生效）。');
  });
  syncDesktopNotifyToggle();
  getElement('agent-attachment-list').addEventListener('click', event => {
    const button = event.target.closest?.('[data-attachment-remove]');
    if (!button) return;
    agentWorkbenchState.composerAttachments.splice(Number(button.dataset.attachmentRemove), 1);
    renderComposerAttachments();
  });
  getElement('agent-slash-list').addEventListener('click', event => {
    const item = event.target.closest?.('[data-slash-index]');
    const command = agentWorkbenchState.slashVisibleCommands[Number(item?.dataset.slashIndex)];
    if (command) fillSlashCommand(command);
  });
  getElement('agent-prompt').addEventListener('input', () => renderSlashMenu());
  getElement('agent-prompt').addEventListener('keydown', event => {
    if (agentWorkbenchState.slashMenuOpen && !event.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveSlashSelection(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSlashMenu();
        return;
      }
      if (event.key === 'Tab') {
        const selected = agentWorkbenchState.slashVisibleCommands[agentWorkbenchState.slashActiveIndex];
        if (selected) {
          event.preventDefault();
          fillSlashCommand(selected);
        }
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        const selected = agentWorkbenchState.slashVisibleCommands[agentWorkbenchState.slashActiveIndex];
        const query = getSlashMenuQuery();
        const exact = selected && [selected.name, ...(selected.aliases || [])].some(name => name.toLowerCase() === String(query || '').toLowerCase());
        if (selected && !exact) {
          event.preventDefault();
          fillSlashCommand(selected);
          return;
        }
      }
    }
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
  // 悬浮 dock 各节标题可折叠：只收起列表，标题条保留计数提醒
  [['agent-question-section', 'agent-question-dock-toggle'], ['agent-permission-section', 'agent-permission-dock-toggle']].forEach(([sectionId, toggleId]) => {
    const section = getElement(sectionId);
    const toggle = getElement(toggleId);
    if (!section || !toggle) return;
    toggle.addEventListener('click', () => {
      const collapsed = section.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
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
  getElement('agent-new-task-btn').addEventListener('click', startNewAgentSession);
  getElement('agent-sidebar-new-btn').addEventListener('click', startNewAgentSession);
  document.querySelectorAll('[data-mobile-panel]').forEach(button => {
    button.addEventListener('click', () => {
      const next = button.classList.contains('is-active') ? '' : button.dataset.mobilePanel;
      setMobilePanel(next);
    });
  });
  getElement('agent-context-collapse-btn').addEventListener('click', () => {
    setContextCollapsed(!agentWorkbenchState.contextCollapsed);
  });
  getElement('agent-settings-toggle').addEventListener('click', () => setSettingsModalOpen(true));
  getElement('agent-settings-close').addEventListener('click', () => setSettingsModalOpen(false));
  getElement('agent-settings-cancel').addEventListener('click', () => setSettingsModalOpen(false));
  getElement('agent-settings-mask').addEventListener('click', event => {
    if (event.target === getElement('agent-settings-mask')) setSettingsModalOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && agentWorkbenchState.settingsOpen) {
      event.preventDefault();
      setSettingsModalOpen(false);
    }
  });
  getElement('agent-task-list').addEventListener('click', event => {
    const archiveButton = event.target.closest?.('[data-archive-task]');
    if (archiveButton) {
      event.stopPropagation();
      const archiveTaskId = archiveButton.dataset.archiveTask || '';
      const alreadyArchived = archiveButton.dataset.archiveState === '1';
      archiveTaskById(archiveTaskId, !alreadyArchived).catch(error => webConsoleAlert(error.message));
      return;
    }
    if (event.target.closest?.('[data-task-check]')) return; // 复选框由 change 事件处理，避免双触发
    const item = event.target.closest?.('[data-task-id]');
    if (!item) return;
    if (agentWorkbenchState.manageMode === true) {
      event.preventDefault();
      toggleTaskSelection(item.dataset.taskId || '', item.querySelector('[data-task-check]'));
      return;
    }
    agentWorkbenchState.selectedTaskId = item.dataset.taskId || '';
    agentWorkbenchState.newSession = false;
    agentWorkbenchState.conversationStickToBottom = true;
    agentWorkbenchState.formTaskId = '';
    setMobilePanel('');
    renderTasks(agentWorkbenchState.payload || {});
    renderSelectedTask(agentWorkbenchState.payload || {});
    refreshAgentWorkbench({ quiet: true }).catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-task-list').addEventListener('keydown', event => {
    // div[role=button] 的键盘可达性：Enter/空格等同点击（归档按钮自身除外）
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest?.('[data-archive-task]')) return;
    const item = event.target.closest?.('[data-task-id]');
    if (!item) return;
    event.preventDefault();
    item.click();
  });

  // ===== 会话批量管理 =====
  function toggleTaskSelection(taskId = '', checkboxElement = null) {
    if (!taskId) return;
    if (!(agentWorkbenchState.selectedTaskIds instanceof Set)) agentWorkbenchState.selectedTaskIds = new Set();
    const selected = agentWorkbenchState.selectedTaskIds;
    if (selected.has(taskId)) selected.delete(taskId);
    else selected.add(taskId);
    const tasks = agentWorkbenchState.payload?.tasks || [];
    // 就地更新勾选态，避免整列表重渲染（会丢焦点/闪屏，并让连续勾选落在旧节点上）
    const checkbox = checkboxElement || document.querySelector(`[data-task-check="${CSS.escape(taskId)}"]`);
    if (checkbox) {
      checkbox.checked = selected.has(taskId);
      checkbox.closest('.agent-task-item')?.classList.toggle('is-checked', selected.has(taskId));
      updateBatchBar(tasks);
    } else {
      renderTasks(agentWorkbenchState.payload || {});
    }
  }

  function setManageMode(enabled) {
    agentWorkbenchState.manageMode = enabled === true;
    if (!agentWorkbenchState.manageMode) agentWorkbenchState.selectedTaskIds = new Set();
    renderTasks(agentWorkbenchState.payload || {});
  }

  async function readBatchTaskIds() {
    const selected = agentWorkbenchState.selectedTaskIds;
    const ids = selected instanceof Set ? [...selected] : [];
    if (!ids.length) {
      await webConsoleAlert('请先勾选要操作的会话。');
      return [];
    }
    return ids;
  }

  async function runBatchAction(action) {
    const ids = await readBatchTaskIds();
    if (!ids.length) return;
    const labels = { archive: '归档', unarchive: '取消归档', delete: '删除' };
    const confirmed = await webConsoleConfirm(
      action === 'delete'
        ? `确定删除选中的 ${ids.length} 个会话吗？

工作台记录和对应的 OpenCode 会话都会被删除，此操作无法撤销。`
        : `确定${labels[action]}选中的 ${ids.length} 个会话吗？`,
      { title: `批量${labels[action]}`, confirmText: action === 'delete' ? '确认删除' : `确认${labels[action]}` },
    );
    if (!confirmed) return;
    const result = await postJson('/api/agent-workbench/tasks/batch', {
      action,
      taskIds: ids,
      ...(action === 'delete' ? { confirmed: true } : {}),
    });
    const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
    agentWorkbenchState.selectedTaskIds = new Set();
    if (action === 'delete' && ids.includes(agentWorkbenchState.selectedTaskId)) {
      agentWorkbenchState.selectedTaskId = '';
      agentWorkbenchState.newSession = true;
      agentWorkbenchState.formTaskId = '';
    }
    await refreshAgentWorkbench({ quiet: true });
    setStatus(`${labels[action]}完成：${(result?.done || []).length} 个${skipped.length ? `，跳过 ${skipped.length} 个（${skipped[0].reason}）` : ''}`);
  }

  async function clearArchivedTasks() {
    const tasks = (agentWorkbenchState.payload?.tasks || []).filter(task => task.archived === true);
    if (!tasks.length) {
      await webConsoleAlert('当前没有已归档的会话。');
      return;
    }
    const confirmed = await webConsoleConfirm(
      `确定清空已归档的 ${tasks.length} 个会话吗？

工作台记录和对应的 OpenCode 会话都会被删除，此操作无法撤销。`,
      { title: '清空已归档', confirmText: '确认清空' },
    );
    if (!confirmed) return;
    const result = await postJson('/api/agent-workbench/tasks/batch', {
      action: 'delete',
      taskIds: tasks.map(task => task.id),
      confirmed: true,
    });
    await refreshAgentWorkbench({ quiet: true });
    setStatus(`已清空 ${(result?.done || []).length} 个归档会话`);
  }

  getElement('agent-manage-toggle').addEventListener('click', () => setManageMode(agentWorkbenchState.manageMode !== true));
  getElement('agent-batch-exit').addEventListener('click', () => setManageMode(false));
  getElement('agent-batch-archive').addEventListener('click', () => runBatchAction('archive').catch(error => webConsoleAlert(error.message)));
  getElement('agent-batch-unarchive').addEventListener('click', () => runBatchAction('unarchive').catch(error => webConsoleAlert(error.message)));
  getElement('agent-batch-delete').addEventListener('click', () => runBatchAction('delete').catch(error => webConsoleAlert(error.message)));
  getElement('agent-batch-clear-archived').addEventListener('click', () => clearArchivedTasks().catch(error => webConsoleAlert(error.message)));
  getElement('agent-batch-all').addEventListener('change', event => {
    const tasks = agentWorkbenchState.payload?.tasks || [];
    agentWorkbenchState.selectedTaskIds = event.target.checked === true
      ? new Set(tasks.map(task => task.id))
      : new Set();
    renderTasks(agentWorkbenchState.payload || {});
  });
  getElement('agent-task-list').addEventListener('change', event => {
    const check = event.target.closest?.('[data-task-check]');
    if (!check) return;
    event.stopPropagation();
    toggleTaskSelection(check.dataset.taskCheck || '', check);
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
    'agent-native-config',
    'agent-timeout-ms',
    'agent-max-concurrent',
    'agent-max-runtimes',
    'agent-runtime-idle',
    'agent-manual-context-limit',
    'agent-auto-compact-enabled',
    'agent-auto-compact-threshold',
    'agent-compact-model',
    'agent-compact-provider',
    'agent-provider-opencode',
    'agent-output-images',
    'agent-write-plugin',
    'agent-write-plugins',
    'agent-write-yunzai',
  ].forEach(id => {
    getElement(id).addEventListener('change', () => {
      agentWorkbenchState.settingsDirty = true;
      setStatus('设置已修改，尚未保存。');
    });
  });
  const SESSIONS_COLLAPSE_KEY = 'crystelf.agent.sessionsCollapsed';
  const shellElement = document.querySelector('.agent-workbench-shell');
  const brandMark = document.querySelector('.agent-brand-mark');
  const applySessionsCollapsed = collapsed => {
    shellElement?.classList.toggle('is-sessions-collapsed', collapsed === true);
    if (brandMark) brandMark.title = collapsed ? '展开会话列表' : '收起会话列表';
    try {
      localStorage.setItem(SESSIONS_COLLAPSE_KEY, collapsed ? '1' : '');
    } catch { /* 忽略隐私模式下的存储失败 */ }
  };
  brandMark?.addEventListener('click', () => {
    applySessionsCollapsed(!shellElement?.classList.contains('is-sessions-collapsed'));
  });
  try {
    applySessionsCollapsed(localStorage.getItem(SESSIONS_COLLAPSE_KEY) === '1');
  } catch { /* 忽略 */ }

  getElement('agent-output')?.addEventListener('click', event => {
    const ticker = event.target.closest?.('.agent-reasoning-ticker');
    if (!ticker) return;
    const stepId = ticker.dataset.stepId || '';
    agentWorkbenchState.expandedReasoning = agentWorkbenchState.expandedReasoning || new Set();
    if (agentWorkbenchState.expandedReasoning.has(stepId)) agentWorkbenchState.expandedReasoning.delete(stepId);
    else agentWorkbenchState.expandedReasoning.add(stepId);
    const task = (agentWorkbenchState.payload?.tasks || []).find(item => item.id === agentWorkbenchState.selectedTaskId);
    if (!task) return;
    const bubbles = getElement('agent-output')?.querySelector('.agent-message-live .agent-message-live-bubbles');
    if (bubbles) {
      const placeholder = task.status === 'pending' ? '任务正在排队...' : 'Agent 正在准备输出...';
      const nextHtml = renderLiveStepBubbles(task.liveSteps, normalizeAgentOutput(task.outputText) || placeholder, task.status === 'running');
      bubbles.dataset.liveSignature = `${nextHtml.length}:${nextHtml.slice(-60)}`;
      bubbles.innerHTML = nextHtml;
    }
  });

  getElement('agent-custom-api-enabled').addEventListener('change', updateCustomApiFields);
  getElement('agent-native-config-load').addEventListener('click', () => {
    try {
      syncNativeConfigPanels();
      setStatus('已从总配置载入 MCP、Agent、Command 分栏。');
    } catch (error) {
      webConsoleAlert(error.message);
    }
  });
  getElement('agent-native-config-apply').addEventListener('click', () => {
    try {
      applyNativeConfigPanels();
    } catch (error) {
      webConsoleAlert(error.message);
    }
  });
  ['agent-provider', 'agent-workspace', 'agent-mode'].forEach(id => {
    getElement(id).addEventListener('change', event => {
      if (id === 'agent-mode' && (agentWorkbenchState.newSession || isFullAccessMode(event.target.value))) {
        getElement('agent-agent').value = isWriteMode(event.target.value) ? 'build' : 'plan';
      }
      if (id === 'agent-mode') getElement('agent-mobile-mode').value = event.target.value;
      updateRunState(agentWorkbenchState.payload || {});
    });
  });
  getElement('agent-mobile-mode').addEventListener('change', event => {
    getElement('agent-mode').value = event.target.value;
    getElement('agent-mode').dispatchEvent(new Event('change', { bubbles: true }));
  });
  getElement('agent-use-worktree').addEventListener('change', event => {
    getElement('agent-mobile-worktree').checked = event.target.checked;
  });
  getElement('agent-mobile-worktree').addEventListener('change', event => {
    if (!getElement('agent-use-worktree').disabled) getElement('agent-use-worktree').checked = event.target.checked;
  });
  getElement('agent-native-toggle').addEventListener('click', () => openNativeCenter().catch(error => webConsoleAlert(error.message)));
  getElement('agent-close-opencode-btn').addEventListener('click', () => closeOpenCodeRuntimes());
  getElement('agent-native-close').addEventListener('click', () => {
    getElement('agent-native-mask').classList.add('hidden');
    stopRuntimePolling();
  });
  getElement('agent-native-mask').addEventListener('click', event => {
    if (event.target === getElement('agent-native-mask')) {
      getElement('agent-native-mask').classList.add('hidden');
      stopRuntimePolling();
    }
  });
  document.querySelectorAll('[data-native-view]').forEach(button => {
    button.addEventListener('click', () => {
      const view = button.dataset.nativeView || 'session';
      setNativeView(view);
      if (view === 'runtime') loadOpenCodeRuntimes().catch(error => webConsoleAlert(error.message));
    });
  });
  getElement('agent-opencode-runtime-refresh').addEventListener('click', () => loadOpenCodeRuntimes().catch(error => webConsoleAlert(error.message)));
  getElement('agent-opencode-runtime-list').addEventListener('click', event => {
    const button = event.target.closest?.('[data-opencode-runtime-close]');
    if (!button) return;
    closeOpenCodeRuntime(button.dataset.opencodeRuntimeClose || '').catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-native-history-load').addEventListener('click', async () => {
    if (await loadSessionHistory()) {
      getElement('agent-native-mask').classList.add('hidden');
      stopRuntimePolling();
    }
  });
  getElement('agent-native-diff-refresh').addEventListener('click', () => loadNativeDiff().catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-diff-list').addEventListener('click', event => {
    const button = event.target.closest?.('[data-diff-restore]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    restoreNativeDiffFile(button.dataset.diffRestore || '').catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-native-git-refresh').addEventListener('click', () => loadNativeGit().catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-git-checkout').addEventListener('click', () => checkoutNativeGitBranch().catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-git-create-branch').addEventListener('click', () => createNativeGitBranch().catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-git-stage').addEventListener('click', () => runNativeGitAction('stage', { files: getSelectedGitFiles() }).catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-git-unstage').addEventListener('click', () => runNativeGitAction('unstage', { files: getSelectedGitFiles() }).catch(error => webConsoleAlert(error.message)));
  getElement('agent-native-git-commit').addEventListener('click', () => commitNativeGit().catch(error => webConsoleAlert(error.message)));
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
  getElement('agent-terminal-interrupt').addEventListener('click', () => interruptNativeTerminal());
  getElement('agent-terminal-close').addEventListener('click', () => closeNativeTerminal().catch(error => webConsoleAlert(error.message)));
  getElement('agent-terminal-form').addEventListener('submit', event => submitNativeTerminalInput(event).catch(error => webConsoleAlert(error.message)));
  getElement('agent-terminal-input').addEventListener('keydown', event => {
    const input = event.currentTarget;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!agentWorkbenchState.terminalHistory.length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowUp' ? 1 : -1;
      agentWorkbenchState.terminalHistoryIndex = Math.max(-1, Math.min(agentWorkbenchState.terminalHistory.length - 1, agentWorkbenchState.terminalHistoryIndex + delta));
      input.value = agentWorkbenchState.terminalHistoryIndex < 0 ? '' : agentWorkbenchState.terminalHistory[agentWorkbenchState.terminalHistoryIndex];
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      interruptNativeTerminal();
    }
  });
  getElement('agent-native-provider-list').addEventListener('click', event => {
    const model = event.target.closest?.('[data-native-model]');
    if (!model) return;
    getElement('agent-model').value = model.dataset.nativeModel || '';
    getElement('agent-native-model').value = model.dataset.nativeModel || '';
    agentWorkbenchState.selectedModelProviderId = model.dataset.nativeModelProvider || '';
    updateModelVariantOptions('');
    renderContextUsage(getSelectedTask(agentWorkbenchState.payload || {}));
    setStatus(`已选择模型：${model.dataset.nativeModel || '默认模型'}`);
  });
  getElement('agent-native-agent').addEventListener('change', event => {
    getElement('agent-agent').value = event.target.value;
  });
  getElement('agent-native-model').addEventListener('input', event => {
    getElement('agent-model').value = event.target.value;
    agentWorkbenchState.selectedModelProviderId = '';
    updateModelVariantOptions('');
    renderContextUsage(getSelectedTask(agentWorkbenchState.payload || {}));
  });
  getElement('agent-agent').addEventListener('change', event => {
    if ([...getElement('agent-native-agent').options].some(option => option.value === event.target.value)) {
      getElement('agent-native-agent').value = event.target.value;
    }
  });
  getElement('agent-model').addEventListener('input', () => {
    agentWorkbenchState.selectedModelProviderId = '';
    updateModelVariantOptions('');
    renderContextUsage(getSelectedTask(agentWorkbenchState.payload || {}));
  });
  getElement('agent-variant').addEventListener('change', event => {
    updateCustomVariantField(event.target.value === agentCustomVariantOption ? '' : undefined);
    if (event.target.value === agentCustomVariantOption) getElement('agent-variant-custom').focus();
    renderContextUsage(getSelectedTask(agentWorkbenchState.payload || {}));
  });
  getElement('agent-variant-custom').addEventListener('input', () => renderContextUsage(getSelectedTask(agentWorkbenchState.payload || {})));
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
    stopRuntimePolling();
    getElement('agent-file-editor-mask').classList.add('hidden');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  restoreContextCollapsed();
  syncMobileActionTray();
  window.addEventListener('resize', () => {
    syncMobileActionTray();
    setContextCollapsed(agentWorkbenchState.contextCollapsed, { persist: false });
  }, { passive: true });
  refreshAgentWorkbench().then(() => connectAgentEventStream()).catch(error => webConsoleAlert(error.message));
  agentWorkbenchState.pollTimer = window.setInterval(() => {
    if (document.hidden || agentWorkbenchState.refreshing) return;
    const refreshInterval = agentWorkbenchState.streamConnected ? 60000 : 10000;
    if (Date.now() - agentWorkbenchState.lastFullRefreshAt < refreshInterval) return;
    refreshAgentWorkbench({ quiet: true }).catch(() => {});
  }, 10000);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden || agentWorkbenchState.refreshing) return;
  const refreshInterval = agentWorkbenchState.streamConnected ? 60000 : 10000;
  if (Date.now() - agentWorkbenchState.lastFullRefreshAt >= refreshInterval) {
    refreshAgentWorkbench({ quiet: true }).catch(() => {});
  }
});

window.addEventListener('beforeunload', () => {
  if (agentWorkbenchState.pollTimer) window.clearInterval(agentWorkbenchState.pollTimer);
  stopRuntimePolling();
  agentWorkbenchState.eventSource?.close?.();
});
