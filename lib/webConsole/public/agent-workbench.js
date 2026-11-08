const agentWorkbenchState = {
  payload: null,
  selectedTaskId: new URLSearchParams(location.search).get('task') || '',
  settingsDirty: false,
  initialized: false,
  refreshing: false,
  refreshPromise: null,
  refreshQuery: '',
  refreshPending: null,
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
  modelMenuProviderKey: '',
  modelMenuView: 'models',
  modelManagerActiveIndex: 0,
  modelProviderDraft: [],
  workspacePickerPath: '',
  workspacePickerParent: '',
  providerModelsRemote: [],
  providerModelsSelected: new Set(),
  providerModelsLoading: false,
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
  slashSearchQuery: '',
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
  contextCollapsed: true,
  // 会话列表按工作目录（项目）分组；折叠状态本地持久化，避免每次刷新都展开
  collapsedWorkspaceGroups: (() => {
    try {
      const raw = JSON.parse(localStorage.getItem('crystelf.agent.collapsedWorkspaceGroups') || '[]');
      return new Set(Array.isArray(raw) ? raw.filter(Boolean) : []);
    } catch {
      return new Set();
    }
  })(),
  initialSelectionResolved: false,
  projectDraft: null,
  projectEditingId: '',
  workspacePickerTarget: 'custom',
  zcodeSessionBusy: false,
  mcpDraft: [],
  mcpEditingIndex: -1,
  mcpEditingOriginal: null,
  zcodeCapabilities: {
    tab: 'skills',
    query: '',
    skills: [],
    commands: [],
    loading: false,
    error: '',
    diagnostics: [],
    failed: { skills: false, commands: false },
    partial: false,
    loadedKey: '',
  },
  zcodeCommandNames: new Set(),
  zcodeInteractiveCommandNames: new Set(),
  zcodeCommandWorkspaceKey: '',
  pendingZcodeCommand: '',
  zcodeStateRefreshing: new Set(),
};

const COLLAPSED_WORKSPACE_GROUPS_KEY = 'crystelf.agent.collapsedWorkspaceGroups';
// 已完成会话的“已读”时间戳：列表里的完成小圆点只表示未查看，点开会话即消失。
// 用 localStorage 持久化，刷新后不会把已经看过的会话重新标成未读。
const COMPLETED_SEEN_STORAGE_KEY = 'crystelf.agent.completedSeenAt';
let completedSeenFallback = new Map();

function completedTaskStamp(task = {}) {
  return String(task.finishedAt || task.updatedAt || task.createdAt || '').trim();
}

function readCompletedSeenMap() {
  const map = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(COMPLETED_SEEN_STORAGE_KEY) || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [taskId, stamp] of Object.entries(raw)) {
        if (taskId && typeof stamp === 'string' && stamp) map.set(taskId, stamp);
      }
    }
  } catch {
    // 隐私模式/损坏数据：退化为内存记录
  }
  for (const [taskId, stamp] of completedSeenFallback) {
    if (!map.has(taskId)) map.set(taskId, stamp);
  }
  return map;
}

function isCompletedTaskUnread(task = {}, seenMap = null) {
  if (String(task?.status || '').toLowerCase() !== 'success') return false;
  const stamp = completedTaskStamp(task);
  if (!stamp) return true;
  const map = seenMap instanceof Map ? seenMap : readCompletedSeenMap();
  return map.get(task.id) !== stamp;
}

function markCompletedTaskSeen(task = {}) {
  if (String(task?.status || '').toLowerCase() !== 'success') return false;
  const stamp = completedTaskStamp(task);
  if (!task?.id || !stamp) return false;
  const map = readCompletedSeenMap();
  if (map.get(task.id) === stamp) return false;
  map.set(task.id, stamp);
  // 只保留最近 300 条，避免长期使用后 localStorage 无限增长
  const entries = Array.from(map.entries()).slice(-300);
  completedSeenFallback = new Map(entries);
  try {
    localStorage.setItem(COMPLETED_SEEN_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 存储不可用时内存记录仍然生效
  }
  return true;
}

const agentContextCollapsedStorageKey = 'crystelf.agentWorkbench.contextCollapsed';

// 斜杠命令图标（线性 SVG，统一 16px 描边风格）：按动作语义映射，未命中给通用命令图标
const agentSlashIcons = {
  summarize: '<path d="M4 7h16"/><path d="M4 12h10"/><path d="M4 17h6"/><path d="m17 15 3 3-3 3"/><path d="M20 18h-5"/>',
  revert: '<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.6-9.4"/>',
  unrevert: '<path d="M21 7v6h-6"/><path d="M20.5 13a9 9 0 1 1-2.6-9.4"/>',
  fork: '<circle cx="6" cy="5" r="2.2"/><circle cx="18" cy="5" r="2.2"/><circle cx="12" cy="19" r="2.2"/><path d="M6 7.2v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-2"/><path d="M12 12.2v4.6"/>',
  rename: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  new: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  models: '<path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  commands: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  sessions: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
  unarchive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M12 17v-4"/><path d="m9.5 15.5 2.5-2.5 2.5 2.5"/>',
  delete: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  status: '<path d="M3 12h4l2.5-7 4 14 2.5-7h5"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  worktrees: '<path d="M3 6h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6"/><path d="M12 17h.01"/>',
  command: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  goal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  rewind: '<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.6-9.4"/>',
};
const agentSlashGroupMeta = {
  session: '会话',
  workspace: '工作台',
  native: 'OpenCode Command',
};

function getSlashCommandIcon(command) {
  const key = command.action && agentSlashIcons[command.action] ? command.action : 'command';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${agentSlashIcons[key]}</svg>`;
}

const agentSlashCommands = Object.freeze([
  { name: 'compact', aliases: ['summarize'], label: '压缩上下文', description: '压缩当前会话，可附加要求：/compact 保留接口约定与待办', kind: 'session', action: 'summarize' },
  { name: 'undo', aliases: ['revert'], label: '撤销上一轮', description: '撤销最近一轮回复及其文件改动', kind: 'session', action: 'revert' },
  { name: 'redo', aliases: ['unrevert'], label: '恢复撤销', description: '恢复最近一次被撤销的内容', kind: 'session', action: 'unrevert' },
  { name: 'fork', aliases: [], label: '创建分支', description: 'ZCode 按检查点分叉；OpenCode 从当前会话创建独立分支', kind: 'session', action: 'fork' },
  { name: 'goal', aliases: ['target'], label: 'ZCode 会话目标', description: '用法：/goal <目标>，或 /goal pause|resume|clear', kind: 'session', action: 'zcode-goal' },
  { name: 'rewind', aliases: [], label: 'ZCode 回退检查点', description: '用法：/rewind [latest|检查点 ID]，恢复工作区文件', kind: 'session', action: 'zcode-rewind' },
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

// 控制台自身斜杠命令优先级高于 ZCode 自定义 Command，避免同名命令被抢走
const agentSlashCommandNames = new Set(
  agentSlashCommands.flatMap(command => [command.name, ...(Array.isArray(command.aliases) ? command.aliases : [])])
    .map(name => String(name || '').toLowerCase())
    .filter(Boolean),
);

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

// 任务头部的提供方/工作区/轮次/模式/状态/耗时摘要（耗时由 1 秒定时器实时刷新）
function buildTaskMetaText(task = {}) {
  const status = getStatusMeta(task.status);
  const goal = task.zcodeGoal;
  const goalText = goal ? ` · ${getZcodeGoalMeta(goal).label}` : '';
  return `${task.providerLabel || task.providerId} · ${task.workspaceLabel || task.workspaceId} · ${task.turnCount || 1} 轮 · ${getModeLabel(task.mode)}${task.variant ? ` · 思考 ${getVariantLabel(task.variant)}` : ''}${goalText} · ${status.label} · ${formatDuration(task.elapsedMs)}`;
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

// 统一 diff → 结构化行内视图：文件条 + 行号 + 增/删/上下文底色，hunk 头标记省略区间。
// 超大 diff 截断到 maxRows 行防止卡顿；无 diff --git 头的单文件片段也兼容
function renderDiffText(value = '') {
  const text = String(value || '');
  if (!text.trim()) return '<div class="agent-diff-note">暂无 Diff 内容。</div>';
  const maxRows = 800;
  const lines = text.split(/\r?\n/);
  const sections = [];
  let rows = [];
  let fileHeader = '';
  let oldLn = 0;
  let newLn = 0;
  let rowCount = 0;
  let truncated = false;

  const flushSection = () => {
    if (!rows.length && !fileHeader) return;
    sections.push(`${fileHeader}<div class="agent-diff-body">${rows.join('')}</div>`);
    rows = [];
    fileHeader = '';
  };
  const pushRow = (cls, oldNo, newNo, text) => {
    if (rowCount >= maxRows) {
      truncated = true;
      return;
    }
    rowCount += 1;
    rows.push(`<div class="agent-diff-row ${cls}"><span class="agent-diff-ln">${oldNo || ''}</span><span class="agent-diff-ln">${newNo || ''}</span><code class="agent-diff-code">${escapeHtml(text) || '&nbsp;'}</code></div>`);
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushSection();
      const match = line.match(/^diff --git a\/(\S+) b\/(\S+)/);
      const filePath = match ? match[2] : line.slice(11);
      fileHeader = `<div class="agent-diff-file"><span class="agent-diff-file-name">${escapeHtml(filePath)}</span></div>`;
      oldLn = 0;
      newLn = 0;
      continue;
    }
    if (/^(index |--- |\+\+\+ |old mode|new mode|new file mode|deleted file mode|similarity |rename |copy |Binary files |GIT binary patch)/.test(line)) continue;
    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLn = Number(match[1]);
        newLn = Number(match[2]);
      }
      pushRow('is-hunk', '', '', line);
      continue;
    }
    if (line.startsWith('+')) {
      pushRow('is-added', '', newLn, line.slice(1));
      newLn += 1;
      continue;
    }
    if (line.startsWith('-')) {
      pushRow('is-deleted', oldLn, '', line.slice(1));
      oldLn += 1;
      continue;
    }
    if (line.startsWith('\\')) {
      pushRow('is-meta', '', '', line);
      continue;
    }
    if (line.startsWith(' ') || !line) {
      pushRow('', oldLn, newLn, line.startsWith(' ') ? line.slice(1) : '');
      oldLn += 1;
      newLn += 1;
      continue;
    }
    pushRow('is-meta', '', '', line);
  }
  flushSection();
  if (!sections.length) return `<div class="agent-diff-note">暂无 Diff 内容。</div>`;
  return `<div class="agent-diff-view">${sections.join('')}</div>${truncated ? `<div class="agent-diff-note">改动过大，仅显示前 ${maxRows} 行，完整内容请用「打开」查看。</div>` : ''}`;
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
  disabled: '关闭',
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
  const lower = value.toLowerCase();
  return agentVariantLabels[lower]
    || (lower === 'disabled' ? '关闭' : lower === 'enabled' ? '默认' : '')
    || value
    || '默认';
}

// 思考档位智能（models.dev 表驱动 + 协议语义）：/variant-intelligence 的缓存
let agentVariantIntel = null;
let agentVariantIntelKey = '';

function currentVariantIntelKey() {
  const { model, providerId } = getCurrentModelSelection();
  return `${model}@${providerId}`;
}

// 拉取当前模型+供应商的档位表；失败静默回退（下拉保持原样，行为不变）
async function refreshVariantIntelligence() {
  const key = currentVariantIntelKey();
  if (!key.replace('@', '')) {
    agentVariantIntel = null;
    agentVariantIntelKey = '';
    return null;
  }
  if (agentVariantIntel && agentVariantIntelKey === key) return agentVariantIntel;
  try {
    const providers = getModelProviders();
    const selectedProvider = providers.find(item => customModelProviderId(item.name) === agentWorkbenchState.selectedModelProviderId);
    const mainProtocol = String(agentWorkbenchState.payload?.config?.customApi?.apiProtocol || agentWorkbenchState.payload?.config?.apiProtocol || '').trim();
    const query = new URLSearchParams({
      model: getElement('agent-model')?.value || '',
      providerId: agentWorkbenchState.selectedModelProviderId || '',
      providerProtocol: String(selectedProvider?.apiProtocol || '').trim(),
      mainProtocol,
    });
    agentVariantIntel = await fetchJson(`/api/agent-workbench/variant-intelligence?${query.toString()}`);
    agentVariantIntelKey = key;
    return agentVariantIntel;
  } catch {
    agentVariantIntel = null;
    agentVariantIntelKey = '';
    return null;
  }
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
  // 占位符按协议语义提示：anthropic 填 thinking 预算数字；openai 系填档位名/模型认识的值
  input.placeholder = agentVariantIntel?.protocol === 'anthropic'
    ? '填 thinking 预算数字，如 8192'
    : '填档位名或模型认识的值，如 high';
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
  // 档位来源：模型表（models.dev）已知 → 以表为准（并只保留运行时注册过的档位，剔除跨网关并集噪音）；
  // 表查不到 → bundled 注册 variants → 六档兜底
  const intel = agentVariantIntel && agentVariantIntelKey === currentVariantIntelKey() ? agentVariantIntel : null;
  const intelValues = Array.isArray(intel?.variants)
    ? intel.variants.filter(item => item?.value).map(item => item.value)
    : [];
  const knownVariants = Object.keys(agentVariantLabels);
  let values;
  if (intel?.reasoningKnown && intelValues.length) {
    const tableSet = new Set(intelValues.map(value => value.toLowerCase()));
    const registered = modelVariants.length ? modelVariants : knownVariants;
    values = registered.filter(value => tableSet.has(value.toLowerCase()));
    if (!values.length) {
      values = intelValues.filter(value => knownVariants.includes(value.toLowerCase()));
    }
    if (!values.length) values = knownVariants;
  } else {
    values = modelVariants.length ? modelVariants : knownVariants;
  }
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
  // 切模型回落：上次档位在新模型的档位表里不存在时回落默认，不悬空
  select.value = customValue ? agentCustomVariantOption : matchedValue;
  const intelNote = intel
    ? (intel.reasoningSupported === false
      ? '模型表标记该模型不支持思考；可选自定义值尝试兼容'
      : `接入格式 ${intel.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'}：${intel.variants.find(item => item.value === (matchedValue || customValue))?.semantics || ''}`)
    : '';
  select.title = intelNote
    || (model && model.reasoning !== true && modelVariants.length === 0
      ? '当前模型未声明推理能力，接口可能忽略该参数；可使用自定义值尝试兼容'
      : '设置仅作用于当前 Agent 会话；默认表示由模型决定');
  updateCustomVariantField(customValue);
  syncVariantTrigger();
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

// ===== 模型选择弹层 + 管理模型 =====
function customModelProviderId(name = '') {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  let hash = 5381;
  for (const ch of String(name || '')) hash = ((hash << 5) + hash + ch.codePointAt(0)) >>> 0;
  return `custom-${slug || 'p'}-${hash.toString(36)}`;
}

function getModelProviders() {
  return Array.isArray(agentWorkbenchState.payload?.config?.modelProviders)
    ? agentWorkbenchState.payload.config.modelProviders
    : [];
}

function getCurrentModelSelection() {
  const model = String(getElement('agent-model')?.value || '').trim();
  const providerId = String(agentWorkbenchState.selectedModelProviderId || '').trim();
  return { model, providerId };
}

// 模型名输入框与供应商 id 是两个状态，历史上出现过「保留模型名但清掉供应商」的组合
// （新建会话只重置供应商），导致任务用主对话 API 去跑自定义供应商的模型而报错。
// 统一从这里写入，并持久化到 localStorage，新建会话/刷新页面都跟随上次选择。
const agentModelSelectionStorageKey = 'crystelf-agent-model-selection-v1';

function setComposerModelSelection(model = '', providerId = '') {
  const modelInput = getElement('agent-model');
  if (modelInput) modelInput.value = String(model || '');
  agentWorkbenchState.selectedModelProviderId = String(providerId || '');
  // 模型变了：档位缓存立即失效，并按新模型的档位表校验当前选择（不匹配回落默认）
  agentVariantIntel = null;
  agentVariantIntelKey = '';
  try {
    localStorage.setItem(agentModelSelectionStorageKey, JSON.stringify({
      model: String(model || ''),
      providerId: String(providerId || ''),
    }));
  } catch { /* 隐私模式忽略 */ }
  const select = getElement('agent-variant');
  if (!select) return;
  const currentVariant = String(getSelectedModelVariant() || '').trim();
  if (!currentVariant) return;
  // 先按下拉现有选项粗校验；intelligence 异步补拉后在精确档位表里再校
  const knownValues = [...select.options].map(option => option.value).filter(value => value && value !== agentCustomVariantOption);
  if (!knownValues.some(value => value.toLowerCase() === currentVariant.toLowerCase())) {
    select.value = '';
    updateCustomVariantField('');
    syncVariantTrigger();
  }
}

function restoreComposerModelSelection() {
  try {
    const stored = JSON.parse(localStorage.getItem(agentModelSelectionStorageKey) || 'null');
    if (!stored || typeof stored !== 'object') return false;
    setComposerModelSelection(String(stored.model || ''), String(stored.providerId || ''));
    return true;
  } catch {
    return false;
  }
}

// 模型选择卡片（对齐 ZCode 排版）：顶部供应商行（点开为二级列表）→ 模型列表 → 思考强度滑块。
// agentWorkbenchState.modelMenuView = 'models' | 'providers'，二级列表复用同一块区域，点选后回到模型列表。
function getModelMenuProviderEntries() {
  const entries = [
    { key: '__default__', label: '默认', tag: 'API', baseApi: '主对话 API' },
  ];
  for (const provider of getModelProviders()) {
    entries.push({
      key: customModelProviderId(provider.name),
      label: provider.name,
      tag: String(provider.apiProtocol || '').toLowerCase() === 'anthropic' ? 'Claude'
        : String(provider.apiProtocol || '').toLowerCase() === 'openai-responses' ? 'Responses' : 'API',
      baseApi: provider.baseApi || '',
    });
  }
  entries.push({ key: '__custom__', label: '自定义', tag: 'API', baseApi: '手动填写模型名' });
  entries.push({ key: '__manage__', label: '管理模型', tag: '', baseApi: '添加供应商与模型' });
  return entries;
}

// 当前应展示的供应商 key：显式选择 → 当前模型所属供应商 → 默认
function resolveModelMenuProviderKey({ model, providerId } = {}) {
  const providers = getModelProviders();
  const explicit = agentWorkbenchState.modelMenuProviderKey;
  if (explicit) return explicit;
  if (providerId && providers.some(item => customModelProviderId(item.name) === providerId)) return providerId;
  return '__default__';
}

function renderModelMenu() {
  const list = getElement('agent-model-menu-list');
  if (!list) return;
  const providersView = agentWorkbenchState.modelMenuView === 'providers';
  const entries = getModelMenuProviderEntries();
  const current = getCurrentModelSelection();
  const activeKey = resolveModelMenuProviderKey(current);
  // 供应商二级列表：默认/各渠道/自定义 + 管理模型，末项走管理弹窗
  list.innerHTML = providersView ? entries.map(entry => {
    const selected = entry.key === activeKey;
    return `<button type="button" class="agent-model-provider${selected ? ' is-active' : ''}" data-provider-key="${escapeHtml(entry.key)}"${entry.key === '__manage__' || entry.key === '__custom__' ? ` data-provider-action="${entry.key === '__manage__' ? 'manage' : 'custom'}"` : ''}>
      <span class="agent-model-provider-main"><strong>${escapeHtml(entry.label)}</strong>${entry.tag ? `<small class="agent-model-provider-tag">${escapeHtml(entry.tag)}</small>` : ''}</span>
      ${entry.baseApi && entry.key !== '__custom__' && entry.key !== '__manage__' ? `<small class="agent-model-provider-base">${escapeHtml(String(entry.baseApi).replace(/^https?:\/\//, '').slice(0, 30))}</small>` : ''}
      ${entry.key === '__manage__' ? '<span class="agent-model-provider-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>' : ''}
      ${selected && entry.key !== '__manage__' ? '<span class="agent-model-check" aria-hidden="true">✓</span>' : ''}
    </button>`;
  }).join('') : renderModelMenuModelRows(activeKey, current).join('');

  const menu = getElement('agent-model-menu');
  menu?.classList.toggle('is-providers', providersView);
  // 自定义视图没有模型可选，隐藏列表改用提示
  getElement('agent-model-menu-custom-hint')?.classList.toggle('hidden', providersView || activeKey !== '__custom__');
  syncModelMenuHeader();
  syncEffortSlider();
  positionModelMenu();
}

// 模型行：名称 + 视觉/上下文小徽章 + 选中勾选
function renderModelMenuModelRows(activeKey, current = {}) {
  const { model: currentModel, providerId: currentProviderId } = current;
  if (activeKey === '__custom__' || activeKey === '__manage__') return [];
  if (activeKey === '__default__') {
    const selected = !currentModel && !currentProviderId;
    return [`<button type="button" class="agent-model-item${selected ? ' is-current' : ''}" data-model-provider="" data-model-value="">
      <span class="agent-model-item-main"><strong>主对话 API 模型</strong><small>模型由服务端配置决定</small></span>
      ${selected ? '<span class="agent-model-check" aria-hidden="true">✓</span>' : ''}
    </button>`];
  }
  const provider = getModelProviders().find(item => customModelProviderId(item.name) === activeKey);
  const models = Array.isArray(provider?.models) ? provider.models : [];
  if (!models.length) {
    return ['<p class="agent-model-pane-hint">该供应商还没有模型，点「管理模型」添加。</p>'];
  }
  return models.map(model => {
    // 模型条目支持字符串与 {name, context, vision, output} 对象两种形态
    const modelName = typeof model === 'string' ? model : (model?.name || '');
    const selected = currentProviderId === activeKey && currentModel === modelName;
    const chips = [];
    if (typeof model === 'object') {
      if (model?.vision === true) chips.push('视觉');
      else if (model?.vision === false) chips.push('纯文本');
      const context = Math.round(Number(model?.context) || 0);
      if (context >= 1000) chips.push(context >= 1000000 ? `${Math.round(context / 100000) / 10}M` : `${Math.round(context / 1000)}K`);
    }
    const chipsHtml = chips.length
      ? `<span class="agent-model-item-chips">${chips.map(chip => `<small>${escapeHtml(chip)}</small>`).join('')}</span>`
      : '';
    return `<button type="button" class="agent-model-item${selected ? ' is-current' : ''}" data-model-provider="${escapeHtml(activeKey)}" data-model-value="${escapeHtml(modelName)}">
      <span class="agent-model-item-main"><strong>${escapeHtml(modelName)}</strong>${chipsHtml}</span>
      ${selected ? '<span class="agent-model-check" aria-hidden="true">✓</span>' : ''}
    </button>`;
  });
}

// 供应商行：显示当前供应商名与协议标签；点开切换二级列表
function syncModelMenuHeader() {
  const providers = getModelProviders();
  const { model, providerId } = getCurrentModelSelection();
  const activeKey = resolveModelMenuProviderKey({ model, providerId });
  const entry = getModelMenuProviderEntries().find(item => item.key === activeKey);
  const providerEl = getElement('agent-model-menu-provider');
  const tagEl = getElement('agent-model-menu-provider-tag');
  if (providerEl) providerEl.textContent = entry?.label || '默认';
  if (tagEl) {
    // 协议标签只在自定义渠道且协议明确时展示，避免默认供应商也挂一个无意义标签
    const protocol = providerId && providerId !== 'opencode'
      ? String(providers.find(item => customModelProviderId(item.name) === providerId)?.apiProtocol || '').toLowerCase()
      : '';
    const label = protocol === 'anthropic' ? 'Claude'
      : protocol === 'grok' ? 'Grok'
        : protocol === 'openai-responses' ? 'Responses'
          : protocol === 'openai' ? 'API' : '';
    tagEl.textContent = label;
    tagEl.classList.toggle('hidden', !label);
  }
  const row = getElement('agent-model-menu-provider-row');
  row?.setAttribute('aria-expanded', String(agentWorkbenchState.modelMenuView === 'providers'));
  row?.classList.toggle('is-open', agentWorkbenchState.modelMenuView === 'providers');
  row?.querySelector('.agent-model-menu-provider-chevron')?.classList.toggle('is-back', agentWorkbenchState.modelMenuView === 'providers');
}

// 手机端：模型菜单不能以按钮为锚点向右固定（按钮居中时会向左溢出），
// 改为 fixed 定位并按视口夹取，优先显示在按钮上方，空间不足则放下方。
function positionModelMenu() {
  const menu = getElement('agent-model-menu');
  const btn = getElement('agent-model-btn');
  if (!menu || !btn || menu.classList.contains('hidden')) return;
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  if (!mobile) {
    for (const prop of ['position', 'left', 'right', 'top', 'bottom', 'width', 'maxWidth', 'maxHeight']) {
      menu.style[prop] = '';
    }
    return;
  }
  const margin = 12;
  const rect = btn.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - margin * 2);
  // 卡片含供应商行 + 模型列表 + 思考强度滑块，给到 70dvh 但不超过视口可用高度
  const maxHeight = Math.max(220, Math.min(window.innerHeight * 0.7, window.innerHeight - margin * 2 - 10));
  menu.style.position = 'fixed';
  menu.style.width = `${width}px`;
  menu.style.maxWidth = 'none';
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.right = 'auto';
  menu.style.bottom = 'auto';
  const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - margin - width);
  const menuHeight = Math.min(menu.scrollHeight || 360, maxHeight);
  let top = rect.top - menuHeight - 10;
  if (top < margin) top = Math.min(window.innerHeight - margin - menuHeight, rect.bottom + 10);
  // 上面的上限兜底可能把卡片推到按钮下方但仍超出视口，最后再夹一次
  top = Math.max(margin, Math.min(top, window.innerHeight - margin - menuHeight));
  menu.style.left = `${Math.max(margin, Math.round(left))}px`;
  menu.style.top = `${Math.max(margin, Math.round(top))}px`;
}

function setModelMenuOpen(open) {
  const menu = getElement('agent-model-menu');
  if (!menu) return;
  const visible = open === true;
  menu.classList.toggle('hidden', !visible);
  getElement('agent-model-btn')?.setAttribute('aria-expanded', String(visible));
  if (visible) {
    closeSlashMenu();
    closeComposerOptions();
    // 每次打开回到模型列表，并重新定位到当前选择所在的供应商
    agentWorkbenchState.modelMenuView = 'models';
    agentWorkbenchState.modelMenuProviderKey = '';
    renderModelMenu();
    positionModelMenu();
  }
}

// 思考强度滑块（卡片底部）：#agent-variant select 的镜像 UI，拖到哪档就写入 select 并派发 change
const agentEffortBubbles = [
  { top: 4, size: 2, duration: 2.6, delay: -0.4 },
  { top: 14, size: 3, duration: 3.2, delay: -2.1 },
  { top: 8, size: 4, duration: 2.8, delay: -1.1 },
  { top: 18, size: 2, duration: 3.6, delay: -0.8 },
  { top: 3, size: 3, duration: 3, delay: -2.5 },
  { top: 12, size: 2, duration: 3.4, delay: -1.7 },
  { top: 6, size: 3, duration: 3.1, delay: -0.9 },
  { top: 17, size: 4, duration: 2.9, delay: -2.3 },
];

// 可拖动的档位：排除「自定义」（自定义要填文本，滑块放不下）
function getEffortLevels() {
  const select = getElement('agent-variant');
  if (!select) return [];
  return [...select.options]
    .filter(option => option.value && option.value !== agentCustomVariantOption)
    .map(option => ({ value: option.value, label: option.textContent || option.value }));
}

// 档位改名后只剩滑块一处展示，这里保留入口给 setComposerModelSelection 等调用方
// ===== 输入区任务模式控件：镜像 #agent-mode，选中后走同一条 change 链路 =====
// 图标沿用 ZCode 的语义映射：手=只读/默认，记事本=计划/补丁，盾牌=写入，警示盾=完全访问
const agentModeIcons = {
  analyze: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8"/>',
  patch: '<path d="M15.5 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6.5Z"/><path d="M15 3v4h4"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  edit: '<path d="M20 13c0 5-3.5 7.5-7.6 8.9a2 2 0 0 1-1.4-.2A11 11 0 0 1 4 12V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/>',
  full: '<path d="M20 13c0 5-3.5 7.5-7.6 8.9a2 2 0 0 1-1.4-.2A11 11 0 0 1 4 12V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
};

function getAgentModeIcon(mode = '') {
  const paths = agentModeIcons[mode] || agentModeIcons.analyze;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// 窄屏用的档位简称（工具条空间有限，全名会把相邻按钮挤出去）
const agentModeShortLabels = {
  analyze: '只读',
  patch: '补丁',
  edit: '写入',
  full: '全权',
};

function syncModeTrigger() {
  const select = getElement('agent-mode');
  if (!select) return;
  const mode = String(select.value || 'analyze');
  const label = getElement('agent-mode-btn-label');
  if (label) {
    // 由 CSS 决定显示全名还是简称：两份文本都写进 DOM，避免响应式切换时重算
    label.innerHTML = `<span class="agent-mode-label-full">${escapeHtml(getModeLabel(mode))}</span><span class="agent-mode-label-short">${escapeHtml(agentModeShortLabels[mode] || getModeLabel(mode))}</span>`;
  }
  const btn = getElement('agent-mode-btn');
  if (btn) {
    btn.dataset.mode = mode;
    btn.title = `任务模式：${getModeLabel(mode)}（点击切换）`;
    // 高权限档用警示色文字，其余跟随 muted，和 ZCode 的 tooltip/图标策略一致
    btn.classList.toggle('is-risk', mode === 'full');
    btn.classList.toggle('is-write', mode === 'edit');
  }
  const icon = getElement('agent-mode-icon');
  if (icon) icon.innerHTML = getAgentModeIcon(mode);
  const menu = getElement('agent-mode-menu');
  if (menu) {
    menu.querySelectorAll('[data-mode-value]').forEach(option => {
      const value = option.dataset.modeValue || '';
      option.classList.toggle('is-active', value === mode);
      const icon = option.querySelector('.agent-mode-option-icon');
      if (icon && !icon.dataset.filled) {
        icon.innerHTML = getAgentModeIcon(value);
        icon.dataset.filled = '1';
      }
    });
  }
}

function setModeMenuOpen(open) {
  const menu = getElement('agent-mode-menu');
  if (!menu) return;
  const visible = open === true;
  menu.classList.toggle('hidden', !visible);
  getElement('agent-mode-btn')?.setAttribute('aria-expanded', String(visible));
  if (visible) {
    closeSlashMenu();
    closeComposerOptions();
    setModelMenuOpen(false);
    syncModeTrigger();
  }
}

function applyTaskMode(mode = '') {
  const select = getElement('agent-mode');
  if (!select) return;
  const next = String(mode || '').trim();
  if (!next || select.value === next) {
    setModeMenuOpen(false);
    return;
  }
  // 完全访问属于高风险档位，切到该档时沿用原有确认流程（由 change 链路触发）
  select.value = next;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  syncModeTrigger();
  setModeMenuOpen(false);
  setStatus(`任务模式已切换：${getModeLabel(next)}`);
}

function syncVariantTrigger() {
  syncEffortSlider();
}

// 当前档位在滑块上的位置：未选档（默认）不填充，自定义档不参与滑块
function getEffortSliderState() {
  const levels = getEffortLevels();
  const raw = String(getElement('agent-variant')?.value || '');
  const index = levels.findIndex(level => level.value === raw);
  const custom = raw === agentCustomVariantOption;
  const selected = index >= 0;
  return {
    levels,
    index: Math.max(0, index),
    custom,
    selected,
    label: custom
      ? `自定义：${getVariantLabel(String(getElement('agent-variant-custom')?.value || '').trim())}`
      : (selected ? levels[index]?.label : '默认'),
  };
}

function getEffortProgress(index, levels) {
  if (levels.length < 2 || index < 0) return 0;
  return (index / (levels.length - 1)) * 100;
}

function syncEffortSlider() {
  const slider = getElement('agent-effort-slider');
  const range = getElement('agent-effort-range');
  const stops = getElement('agent-effort-stops');
  const fill = getElement('agent-effort-fill');
  const thumb = getElement('agent-effort-thumb');
  const labelEl = getElement('agent-effort-label');
  if (!slider || !range) return;
  const { levels, index, custom, label, selected } = getEffortSliderState();
  const disabled = levels.length < 2;
  slider.dataset.disabled = String(disabled);
  slider.dataset.custom = String(custom);
  range.min = '0';
  range.max = String(Math.max(0, levels.length - 1));
  range.value = String(index);
  range.disabled = disabled;
  range.setAttribute('aria-valuetext', label);
  if (labelEl) labelEl.textContent = label;
  if (stops) {
    stops.innerHTML = levels.map((level, i) => `<span class="agent-effort-stop" data-filled="${selected && i <= index}" title="${escapeHtml(level.label)}"></span>`).join('');
  }
  // 未选档（默认）不填充：否则看起来像已经选了低档
  const progress = selected ? getEffortProgress(index, levels) : 0;
  const atMax = selected && levels.length > 1 && index === levels.length - 1;
  if (fill) {
    // 行程首尾各留一个圆点半径：圆点直径 24 → 半行程端点距两端 12px
    fill.style.width = selected ? `calc(12px + (100% - 24px) * ${progress / 100})` : '0px';
    fill.dataset.max = String(atMax && !disabled);
    fill.dataset.custom = String(custom);
  }
  if (thumb) {
    // 圆点圆心对齐填充条末端：fill 右缘 = 12 + (100% - 24px) * progress，圆点半径 12
    thumb.style.left = `calc((100% - 24px) * ${progress / 100})`;
  }
  const bubbles = getElement('agent-effort-bubbles');
  if (bubbles) {
    bubbles.innerHTML = atMax && !disabled
      ? agentEffortBubbles.map(b => `<span class="agent-effort-bubble" style="top:${b.top}px;animation-duration:${b.duration}s;animation-delay:${b.delay}s"><i style="width:${b.size}px;height:${b.size}px"></i></span>`).join('')
      : '';
  }
}

// 滑块拖动/点击/键盘：写入 select 并派发 change，复用原有档位联动（自定义输入框、上下文用量）
function applyEffortLevel(rawIndex) {
  const select = getElement('agent-variant');
  if (!select || select.value === agentCustomVariantOption) return;
  const { levels } = getEffortSliderState();
  const level = levels[Number(rawIndex)];
  if (!level || level.value === select.value) return;
  select.value = level.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  syncEffortSlider();
}

function setPlusMenuOpen(open) {
  const menu = getElement('agent-plus-menu');
  if (!menu) return;
  const visible = open === true;
  menu.classList.toggle('hidden', !visible);
  getElement('agent-plus-btn')?.setAttribute('aria-expanded', String(visible));
  if (visible) {
    closeSlashMenu();
    closeComposerOptions();
    setModelMenuOpen(false);
    // ZCode 专属能力在 OpenCode 会话下直接隐藏，避免点了才提示不支持
    const zcodeProvider = typeof getZcodeCapabilityContext === 'function'
      && getZcodeCapabilityContext().providerId === 'zcode';
    menu.querySelector('[data-plus-action="zcode-capabilities"]')?.classList.toggle('hidden', !zcodeProvider);
    menu.querySelector('[data-plus-action="workflow"]')?.classList.toggle('hidden', !zcodeProvider);
  }
}

async function saveModelProviders(providers) {
  setButtonBusy('agent-model-manager-save', true, '保存', '保存中...');
  try {
    const draft = readSettingsDraft();
    draft.modelProviders = providers;
    const result = await postJson('/api/agent-workbench/settings', draft);
    agentWorkbenchState.payload = result;
    renderPayload(result);
    agentWorkbenchState.modelProviderDraft = [];
    closeModelManager();
    setStatus('模型供应商已保存。');
  } catch (error) {
    await webConsoleAlert(error.message);
  } finally {
    setButtonBusy('agent-model-manager-save', false, '保存', '保存中...');
  }
}

// 左栏：供应商列表（状态点 = 名称/地址/模型齐备）；字段编辑时单独重渲染，不动编辑区 DOM
function renderModelManagerRail() {
  const list = getElement('agent-model-manager-list');
  if (!list) return;
  const draft = Array.isArray(agentWorkbenchState.modelProviderDraft) ? agentWorkbenchState.modelProviderDraft : [];
  if (agentWorkbenchState.modelManagerActiveIndex >= draft.length) {
    agentWorkbenchState.modelManagerActiveIndex = Math.max(0, draft.length - 1);
  }
  list.innerHTML = draft.map((provider, index) => {
    const configured = Boolean(provider.name && provider.baseApi && (provider.models || []).length);
    return `<button type="button" class="agent-model-manager-provider${index === agentWorkbenchState.modelManagerActiveIndex ? ' is-active' : ''}" data-manager-provider-index="${index}">
      <span>${escapeHtml(provider.name || '未命名供应商')}</span>
      <small>${escapeHtml((provider.baseApi || '').replace(/^https?:\/\//, '').slice(0, 24))}</small>
      <i class="agent-model-dot${configured ? ' is-ok' : ''}"></i>
    </button>`;
  }).join('');
}

function renderModelManager() {
  renderModelManagerRail();
  renderModelManagerEditor();
}

// 新增供应商草稿：左栏按钮和编辑区空状态共用同一入口
function addModelProviderDraft() {
  if (!Array.isArray(agentWorkbenchState.modelProviderDraft)) agentWorkbenchState.modelProviderDraft = [];
  agentWorkbenchState.modelProviderDraft.push({ name: '', baseApi: '', apiKey: '', apiKeyConfigured: false, models: [] });
  agentWorkbenchState.modelManagerActiveIndex = agentWorkbenchState.modelProviderDraft.length - 1;
  renderModelManager();
  getElement('agent-model-manager-editor')?.querySelector('[data-manager-field="name"]')?.focus();
}

// 右栏：当前供应商编辑器（字段编辑不重渲染此区域，避免打断输入）
function renderModelManagerEditor() {
  const editor = getElement('agent-model-manager-editor');
  if (!editor) return;
  const draft = Array.isArray(agentWorkbenchState.modelProviderDraft) ? agentWorkbenchState.modelProviderDraft : [];
  // 空列表时隐藏左栏，避免和空状态卡片里的“添加供应商”重复
  editor.closest('.agent-model-manager-layout')?.classList.toggle('is-empty', !draft.length);
  if (!draft.length) {
    editor.innerHTML = `
      <div class="agent-manager-empty">
        <span class="agent-manager-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="M2.5 9.5h19"/><path d="M8 15h4"/></svg>
        </span>
        <strong>还没有自定义供应商</strong>
        <p>添加一个渠道后，就能在这里填写接口地址、密钥并维护模型列表。</p>
        <button type="button" class="agent-quiet-btn is-primary" data-manager-empty-add>＋ 添加供应商</button>
      </div>`;
    return;
  }
  const provider = draft[agentWorkbenchState.modelManagerActiveIndex] || draft[0];
  const modelRows = (provider.models || []).map((model, modelIndex) => {
    const modelName = typeof model === 'string' ? model : (model?.name || '');
    const badges = [];
    if (typeof model === 'object') {
      const context = Math.round(Number(model?.context) || 0);
      if (context > 0) badges.push(formatContextBadge(context));
      if (model?.vision === true) badges.push('视觉');
      if (model?.vision === false) badges.push('纯文本');
      if (Number(model?.output) > 0) badges.push(`输出 ${formatContextBadge(Number(model.output))}`);
    }
    return `
    <div class="agent-manager-model-row" data-manager-model-index="${modelIndex}">
      <button type="button" class="agent-manager-model-edit" data-manager-model-edit="${modelIndex}" title="编辑模型参数"><strong>${escapeHtml(modelName)}</strong></button>
      <span class="agent-manager-model-badges" data-manager-badges="${escapeHtml(modelName)}">${badges.map(chip => `<small class="agent-manager-badge">${escapeHtml(chip)}</small>`).join('')}</span>
      <button type="button" class="agent-manager-model-edit" data-manager-model-edit="${modelIndex}" aria-label="编辑模型"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
      <button type="button" class="agent-manager-model-remove" data-manager-model-remove="${modelIndex}" aria-label="删除模型"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
    </div>`;
  }).join('');
  editor.innerHTML = `
    <div class="agent-manager-editor-head">
      <strong>${escapeHtml(provider.name || '未命名供应商')}</strong>
      <button type="button" class="agent-quiet-btn" data-manager-provider-remove="${agentWorkbenchState.modelManagerActiveIndex}">删除供应商</button>
    </div>
    <div class="agent-manager-field-grid">
      <label>名称<input type="text" data-manager-field="name" value="${escapeHtml(provider.name || '')}" maxlength="40" placeholder="如：硅基流动" /></label>
      <label>Base URL<input type="text" data-manager-field="baseApi" value="${escapeHtml(provider.baseApi || '')}" maxlength="300" placeholder="https://api.example.com/v1" /></label>
      <label>API 格式<select data-manager-field="apiProtocol">
        <option value=""${!provider.apiProtocol ? ' selected' : ''}>跟随主接口</option>
        <option value="openai"${provider.apiProtocol === 'openai' ? ' selected' : ''}>OpenAI 兼容（chat/completions）</option>
        <option value="openai-responses"${provider.apiProtocol === 'openai-responses' ? ' selected' : ''}>OpenAI Responses（/v1/responses）</option>
        <option value="anthropic"${provider.apiProtocol === 'anthropic' ? ' selected' : ''}>Anthropic（Claude Messages API）</option>
        <option value="grok"${provider.apiProtocol === 'grok' ? ' selected' : ''}>Grok（xAI，OpenAI 兼容）</option>
      </select></label>
      <label>API Key<span class="agent-manager-key-wrap"><input type="password" data-manager-field="apiKey" value="" placeholder="${provider.apiKeyConfigured ? '已配置（留空保持）' : '未配置'}" autocomplete="new-password" /><button type="button" class="agent-manager-key-eye" data-manager-key-eye aria-label="显示或隐藏密钥"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.2 12S5.6 5.8 12 5.8 21.8 12 21.8 12 18.4 18.2 12 18.2 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label>
    </div>
    <div class="agent-manager-models-head"><span>模型列表</span><span class="agent-manager-models-actions"><button type="button" class="agent-quiet-btn" data-manager-model-fetch-btn title="向供应商请求 /v1/models 并批量添加">⟳ 获取模型</button><button type="button" class="agent-quiet-btn" data-manager-model-add-btn>＋ 添加模型</button></span></div>
    <div class="agent-manager-model-list">${modelRows || '<p class="agent-model-manager-hint">还没有模型。</p>'}</div>`;
  renderModelManagerBadges();
}

// 上下文徽章文本：1M / 200K 形式
function formatContextBadge(limit) {
  return limit >= 1000000 ? `${Math.round(limit / 100000) / 10}M` : `${Math.round(limit / 1000)}K`;
}

// 模型徽章：自定义值（draft 对象条目）优先，无自定义才查 models.dev 表
function renderModelManagerBadges() {
  const editor = getElement('agent-model-manager-editor');
  if (!editor) return;
  const nodes = [...editor.querySelectorAll('[data-manager-badges]')];
  if (!nodes.length) return;
  const provider = agentWorkbenchState.modelProviderDraft[agentWorkbenchState.modelManagerActiveIndex];
  const draftByName = new Map((provider?.models || [])
    .filter(item => typeof item === 'object')
    .map(item => [item.name, item]));
  const autoNames = nodes
    .map(node => node.dataset.managerBadges)
    .filter(name => {
      const custom = draftByName.get(name);
      return !(custom && (Number(custom.context) > 0 || custom.vision !== undefined));
    });
  for (const node of nodes) {
    const custom = draftByName.get(node.dataset.managerBadges);
    if (!custom || (Number(custom.context) <= 0 && custom.vision === undefined)) continue;
    node.innerHTML = [
      ...(Number(custom.context) > 0 ? [formatContextBadge(Number(custom.context))] : []),
      ...(custom.vision === true ? ['视觉'] : custom.vision === false ? ['纯文本'] : []),
    ].map(chip => `<small class="agent-manager-badge">${escapeHtml(chip)}</small>`).join('');
  }
  if (!autoNames.length) return;
  fetchJson(`/api/agent-workbench/model-badges?models=${encodeURIComponent(autoNames.join(','))}`).then(result => {
    const badges = result?.badges || {};
    for (const node of nodes) {
      const badge = badges[node.dataset.managerBadges];
      if (!badge) continue;
      const chips = [];
      if (badge.contextLimit >= 1000) chips.push(formatContextBadge(badge.contextLimit));
      if (badge.vision === true) chips.push('视觉');
      if (chips.length) node.innerHTML = chips.map(chip => `<small class="agent-manager-badge">${escapeHtml(chip)}</small>`).join('');
    }
  }).catch(() => { });
}

// 表单内联错误：不弹全局 alert（其全屏遮罩 z-9999 会盖住 z-90 的表单弹窗，造成整个弹窗假死）
function showModelFormError(text) {
  const errorEl = getElement('agent-model-form-error');
  if (!errorEl) return;
  errorEl.textContent = String(text || '');
  errorEl.classList.remove('hidden');
}

function clearModelFormError() {
  const errorEl = getElement('agent-model-form-error');
  errorEl?.classList.add('hidden');
}

// 添加/编辑模型弹窗：editIndex = -1 时新增，否则编辑 draft.models 里的该条
function openModelForm(editIndex = -1) {
  const provider = agentWorkbenchState.modelProviderDraft[agentWorkbenchState.modelManagerActiveIndex];
  if (!provider) return;
  const existing = editIndex >= 0 ? (provider.models || [])[editIndex] : null;
  const name = typeof existing === 'object' ? existing?.name : existing;
  const context = typeof existing === 'object' ? Math.round(Number(existing?.context) || 0) : 0;
  const output = typeof existing === 'object' ? Math.round(Number(existing?.output) || 0) : 0;
  const vision = typeof existing === 'object' && existing?.vision === true ? 'true' : typeof existing === 'object' && existing?.vision === false ? 'false' : '';
  getElement('agent-model-form-title').textContent = editIndex >= 0 ? '编辑模型' : '添加模型';
  getElement('agent-model-form-name').value = String(name || '');
  getElement('agent-model-form-context').value = context > 0 ? String(context) : '';
  getElement('agent-model-form-output').value = output > 0 ? String(output) : '';
  getElement('agent-model-form-vision').value = vision;
  agentWorkbenchState.modelFormEditIndex = editIndex;
  getElement('agent-model-form-mask').classList.remove('hidden');
  getElement('agent-model-form-name').focus();
}

function closeModelForm() {
  getElement('agent-model-form-mask')?.classList.add('hidden');
}

function submitModelForm() {
  const provider = agentWorkbenchState.modelProviderDraft[agentWorkbenchState.modelManagerActiveIndex];
  if (!provider) return;
  const name = String(getElement('agent-model-form-name').value || '').trim();
  if (!name) {
    showModelFormError('模型 ID 不能为空。');
    return;
  }
  const context = Math.max(0, Math.round(Number(getElement('agent-model-form-context').value) || 0));
  const vision = getElement('agent-model-form-vision').value;
  const output = Math.max(0, Math.round(Number(getElement('agent-model-form-output').value) || 0));
  const entry = { name };
  if (context > 0) entry.context = context;
  if (vision === 'true') entry.vision = true;
  else if (vision === 'false') entry.vision = false;
  if (output > 0) entry.output = output;
  const models = provider.models || [];
  const editIndex = agentWorkbenchState.modelFormEditIndex;
  const duplicateIndex = models.findIndex((item, index) => index !== editIndex && (typeof item === 'string' ? item : item?.name) === name);
  if (duplicateIndex >= 0) {
    showModelFormError(`模型 ${name} 已在列表中（同一供应商不允许重名）。点列表中的模型名可编辑它的参数。`);
    return;
  }
  if (editIndex >= 0 && models[editIndex] !== undefined) models[editIndex] = entry;
  else models.push(entry);
  closeModelForm();
  renderModelManager();
}

// ===== 获取模型：请求供应商 /v1/models，勾选后批量并入当前供应商草稿 =====

// 模型条目的名字：draft 里可能是字符串名或 {name,...} 对象
function modelEntryName(model) {
  return typeof model === 'string' ? model : String(model?.name || '');
}

function getActiveModelProviderDraft() {
  return agentWorkbenchState.modelProviderDraft[agentWorkbenchState.modelManagerActiveIndex] || null;
}

function showProviderModelsError(text) {
  const errorEl = getElement('agent-provider-models-error');
  if (!errorEl) return;
  errorEl.textContent = String(text || '');
  errorEl.classList.remove('hidden');
}

function clearProviderModelsError() {
  getElement('agent-provider-models-error')?.classList.add('hidden');
}

function setProviderModelsBusy(busy, text = '') {
  agentWorkbenchState.providerModelsLoading = busy === true;
  const subtitle = getElement('agent-provider-models-subtitle');
  if (subtitle) subtitle.textContent = text || (busy ? '正在请求供应商的模型列表…' : '勾选要添加的模型');
  const retry = getElement('agent-provider-models-retry');
  if (retry) retry.disabled = busy;
  const save = getElement('agent-provider-models-save');
  if (save) save.disabled = busy;
}

function renderProviderModelsList() {
  const list = getElement('agent-provider-models-list');
  if (!list) return;
  const provider = getActiveModelProviderDraft();
  const existing = new Set((provider?.models || []).map(modelEntryName).filter(Boolean));
  const keyword = String(getElement('agent-provider-models-filter')?.value || '').trim().toLowerCase();
  const source = agentWorkbenchState.providerModelsRemote || [];
  const visible = keyword ? source.filter(name => name.toLowerCase().includes(keyword)) : source;
  if (agentWorkbenchState.providerModelsLoading) {
    list.innerHTML = '<p class="agent-model-manager-hint">正在获取模型列表…</p>';
    updateProviderModelsCount();
    return;
  }
  if (!visible.length) {
    list.innerHTML = `<p class="agent-model-manager-hint">${source.length ? '没有匹配的模型。' : '还没有拿到模型列表，检查 Base URL 后点「重新获取」。'}</p>`;
    updateProviderModelsCount();
    return;
  }
  list.innerHTML = visible.map(name => {
    const added = existing.has(name);
    const checked = agentWorkbenchState.providerModelsSelected.has(name);
    return `<label class="agent-provider-models-item${added ? ' is-added' : ''}" title="${escapeHtml(name)}">
      <input type="checkbox" data-provider-model="${escapeHtml(name)}"${checked ? ' checked' : ''}${added ? ' disabled' : ''} />
      <span>${escapeHtml(name)}</span>
      ${added ? '<small>已在列表</small>' : ''}
    </label>`;
  }).join('');
  updateProviderModelsCount();
}

function updateProviderModelsCount() {
  const provider = getActiveModelProviderDraft();
  const existing = new Set((provider?.models || []).map(modelEntryName).filter(Boolean));
  const source = agentWorkbenchState.providerModelsRemote || [];
  const pending = source.filter(name => !existing.has(name));
  const selected = pending.filter(name => agentWorkbenchState.providerModelsSelected.has(name)).length;
  const countEl = getElement('agent-provider-models-count');
  if (countEl) countEl.textContent = source.length ? `共 ${source.length} 个模型，可添加 ${pending.length} 个，已选 ${selected} 个` : '';
  const selectAll = getElement('agent-provider-models-selectall');
  if (selectAll) {
    selectAll.checked = pending.length > 0 && selected === pending.length;
    selectAll.disabled = pending.length === 0;
  }
  const save = getElement('agent-provider-models-save');
  if (save) save.disabled = agentWorkbenchState.providerModelsLoading || selected === 0;
}

async function requestProviderModels() {
  const provider = getActiveModelProviderDraft();
  if (!provider) return;
  const baseApi = String(provider.baseApi || '').trim();
  if (!baseApi) {
    showProviderModelsError('请先填写 Base URL，再获取模型列表。');
    return;
  }
  clearProviderModelsError();
  agentWorkbenchState.providerModelsRemote = [];
  agentWorkbenchState.providerModelsSelected = new Set();
  setProviderModelsBusy(true);
  getElement('agent-provider-models-toolbar')?.classList.add('hidden');
  renderProviderModelsList();
  try {
    const result = await postJson('/api/agent-workbench/provider-models', {
      name: provider.name || '',
      baseApi,
      apiKey: provider.apiKey || '',
      apiProtocol: provider.apiProtocol || '',
    });
    agentWorkbenchState.providerModelsRemote = Array.isArray(result?.models) ? result.models : [];
    const label = provider.name || baseApi;
    getElement('agent-provider-models-title').textContent = `获取模型 · ${label}`;
    setProviderModelsBusy(false);
    getElement('agent-provider-models-toolbar')?.classList.remove('hidden');
    // 默认勾选全部未添加的模型：常见用法就是「全部加进来」
    const existing = new Set((provider.models || []).map(modelEntryName).filter(Boolean));
    agentWorkbenchState.providerModelsSelected = new Set(
      agentWorkbenchState.providerModelsRemote.filter(name => !existing.has(name))
    );
    renderProviderModelsList();
  } catch (error) {
    agentWorkbenchState.providerModelsRemote = [];
    agentWorkbenchState.providerModelsSelected = new Set();
    setProviderModelsBusy(false, '获取失败');
    renderProviderModelsList();
    // 404 说明当前运行的控制台进程还没注册该路由（前端文件即时生效、路由需重启 Bot 进程），
    // 通用兜底文案「没有找到对应的数据或接口」会让人误以为供应商地址错了
    const message = Number(error?.status) === 404
      ? '当前控制台进程还没有「获取模型」接口，请重启 Bot（Yunzai）后刷新本页再试。'
      : (error?.message || '获取模型列表失败。');
    showProviderModelsError(message);
  }
}

function openProviderModels() {
  const provider = getActiveModelProviderDraft();
  if (!provider) return;
  const modal = getElement('agent-provider-models-mask');
  if (!modal) return;
  agentWorkbenchState.providerModelsRemote = [];
  agentWorkbenchState.providerModelsSelected = new Set();
  agentWorkbenchState.providerModelsLoading = false;
  clearProviderModelsError();
  const filter = getElement('agent-provider-models-filter');
  if (filter) filter.value = '';
  getElement('agent-provider-models-title').textContent = `获取模型 · ${provider.name || provider.baseApi || '未命名供应商'}`;
  getElement('agent-provider-models-toolbar')?.classList.add('hidden');
  modal.classList.remove('hidden');
  requestProviderModels();
}

function closeProviderModels() {
  agentWorkbenchState.providerModelsRemote = [];
  agentWorkbenchState.providerModelsSelected = new Set();
  agentWorkbenchState.providerModelsLoading = false;
  getElement('agent-provider-models-mask')?.classList.add('hidden');
}

// 把勾选的模型并入当前供应商草稿（跳过重名，保持原有条目与自定义参数）
function applyProviderModels() {
  const provider = getActiveModelProviderDraft();
  if (!provider) return;
  const existing = new Set((provider.models || []).map(modelEntryName).filter(Boolean));
  const selected = agentWorkbenchState.providerModelsRemote
    .filter(name => agentWorkbenchState.providerModelsSelected.has(name) && !existing.has(name));
  if (!selected.length) {
    showProviderModelsError('请至少勾选一个要添加的模型。');
    return;
  }
  provider.models = [
    ...(provider.models || []),
    ...selected.map(name => ({ name })),
  ];
  const addedCount = selected.length;
  closeProviderModels();
  renderModelManager();
  setStatus(`已添加 ${addedCount} 个模型，记得点「保存」写入配置。`);
}

function openModelManager() {
  agentWorkbenchState.modelProviderDraft = getModelProviders().map(provider => ({
    name: provider.name || '',
    baseApi: provider.baseApi || '',
    apiKey: '',
    apiProtocol: provider.apiProtocol || '',
    apiKeyConfigured: provider.apiKeyConfigured === true,
    models: [...(provider.models || [])],
  }));
  renderModelManager();
  getElement('agent-model-manager-mask').classList.remove('hidden');
}

function closeModelManager() {
  getElement('agent-model-manager-mask')?.classList.add('hidden');
}

// ===== 自定义工作目录选择器：浏览服务器目录，点选后回填路径 =====
function closeWorkspacePicker() {
  getElement('agent-workspace-picker-mask')?.classList.add('hidden');
}

function renderWorkspacePicker(data = {}) {
  const current = data.current || {};
  agentWorkbenchState.workspacePickerPath = current.path || '';
  agentWorkbenchState.workspacePickerParent = data.parent || '';
  const pathBox = getElement('agent-workspace-picker-path');
  if (pathBox) pathBox.textContent = current.path || '';
  const shortcuts = getElement('agent-workspace-picker-shortcuts');
  if (shortcuts) {
    shortcuts.innerHTML = (data.shortcuts || []).map(item => (
      `<button type="button" class="agent-mini-btn" data-workspace-picker-path="${escapeHtml(item.path)}">${escapeHtml(item.name)}</button>`
    )).join('');
  }
  const list = getElement('agent-workspace-picker-list');
  if (list) {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    list.innerHTML = entries.length
      ? entries.map(item => `<button type="button" class="agent-workspace-picker-item" data-workspace-picker-path="${escapeHtml(item.path)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z"/></svg>
          <span>${escapeHtml(item.name)}</span>
        </button>`).join('')
      : '<p class="agent-model-manager-hint">当前目录下没有子文件夹。</p>';
  }
  const up = getElement('agent-workspace-picker-up');
  if (up) up.disabled = !data.parent;
}

async function loadWorkspacePicker(pathValue = '') {
  const list = getElement('agent-workspace-picker-list');
  if (list) list.innerHTML = '<p class="agent-model-manager-hint">加载中...</p>';
  try {
    const result = await fetchJson(`/api/agent-workbench/workspaces/browse?path=${encodeURIComponent(pathValue)}`);
    renderWorkspacePicker(result?.data || result || {});
    return true;
  } catch (error) {
    if (list) list.innerHTML = `<p class="agent-form-error">${escapeHtml(error.message || '目录读取失败')}</p>`;
    return false;
  }
}

async function openWorkspacePicker(startPath = '', target = 'custom') {
  agentWorkbenchState.workspacePickerTarget = target;
  getElement('agent-workspace-picker-mask')?.classList.remove('hidden');
  const start = String(startPath || '').trim();
  if (start && await loadWorkspacePicker(start)) return;
  await loadWorkspacePicker('');
}

// ===== 项目（多源文件夹工作区）新建/编辑 =====
function closeProjectDialog() {
  getElement('agent-project-mask')?.classList.add('hidden');
  agentWorkbenchState.projectDraft = null;
  agentWorkbenchState.projectEditingId = '';
}

function openProjectDialog(workspace = null) {
  const editing = Boolean(workspace?.id);
  const directories = Array.isArray(workspace?.directories) && workspace.directories.length
    ? workspace.directories.map(item => String(item || ''))
    : [String(workspace?.path || '')];
  agentWorkbenchState.projectEditingId = editing ? String(workspace.id) : '';
  agentWorkbenchState.projectDraft = {
    name: editing ? String(workspace.label || '') : '',
    directories: directories.length ? directories : [''],
  };
  getElement('agent-project-title').textContent = editing ? '编辑项目' : '新建项目';
  getElement('agent-project-delete')?.classList.toggle('hidden', !editing);
  setProjectDialogError('');
  renderProjectDialog();
  getElement('agent-project-mask')?.classList.remove('hidden');
  window.setTimeout(() => getElement('agent-project-name')?.focus(), 30);
}

function setProjectDialogError(message = '') {
  const error = getElement('agent-project-error');
  if (!error) return;
  error.textContent = message;
  error.classList.toggle('hidden', !message);
}

function renderProjectDialog() {
  const draft = agentWorkbenchState.projectDraft;
  if (!draft) return;
  getElement('agent-project-name').value = draft.name;
  const host = getElement('agent-project-folders');
  host.innerHTML = draft.directories.map((directory, index) => `
    <div class="agent-project-folder">
      <span class="agent-project-folder-icon" aria-hidden="true">${AGENT_FOLDER_ICON}</span>
      <input type="text" class="agent-project-folder-input" data-project-folder-input="${index}" value="${escapeHtml(directory)}" maxlength="400" placeholder="D:/projects/my-app 或 /srv/docs" aria-label="源文件夹 ${index + 1}" />
      ${index === 0 ? '<span class="agent-project-folder-primary">主要</span>' : ''}
      <button type="button" class="agent-mini-btn" data-project-folder-browse="${index}">浏览</button>
      ${draft.directories.length > 1 ? `<button type="button" class="agent-icon-btn agent-project-folder-remove" data-project-folder-remove="${index}" title="移除文件夹" aria-label="移除文件夹">✕</button>` : ''}
    </div>
  `).join('');
}

async function saveProjectDialog() {
  const draft = agentWorkbenchState.projectDraft;
  if (!draft) return;
  const directories = draft.directories.map(item => String(item || '').trim()).filter(Boolean);
  if (!directories.length) {
    setProjectDialogError('请至少添加一个源文件夹');
    return;
  }
  setProjectDialogError('');
  setButtonBusy('agent-project-save', true, '保存', '保存中...');
  try {
    const result = await postJson('/api/agent-workbench/projects', {
      id: agentWorkbenchState.projectEditingId || undefined,
      name: String(getElement('agent-project-name').value || '').trim(),
      directories,
    });
    closeProjectDialog();
    await refreshAgentWorkbench({ quiet: true });
    setStatus(agentWorkbenchState.projectEditingId ? '项目已保存。' : '项目已创建。');
    return result;
  } catch (error) {
    setProjectDialogError(error.message);
    return null;
  } finally {
    setButtonBusy('agent-project-save', false, '保存', '保存中...');
  }
}

async function deleteProjectDialog() {
  const projectId = agentWorkbenchState.projectEditingId;
  if (!projectId) return;
  if (!await webConsoleConfirm('删除项目后，其下的会话会移入「已归档」，可在侧栏勾选「已归档」查看。确定删除吗？', { title: '删除项目' })) return;
  setButtonBusy('agent-project-delete', true, '删除项目', '删除中...');
  try {
    await postJson('/api/agent-workbench/projects/delete', { id: projectId });
    closeProjectDialog();
    await refreshAgentWorkbench({ quiet: true });
    setStatus('项目已删除，相关会话已归档。');
  } catch (error) {
    setProjectDialogError(error.message);
  } finally {
    setButtonBusy('agent-project-delete', false, '删除项目', '删除中...');
  }
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
  getElement('agent-native-config').value = JSON.stringify(config.nativeConfig || { mcp: {}, agent: {}, command: {} }, null, 2);
  ['mcp', 'agent', 'command'].forEach(key => {
    const target = getElement(`agent-native-config-${key}`);
    if (target) target.value = JSON.stringify(config.nativeConfig?.[key] || {}, null, 2);
  });
  getElement('agent-timeout-ms').value = String(config.timeoutMs || 1800000);
  getElement('agent-max-concurrent').value = String(config.maxConcurrentTasks || 1);
  getElement('agent-max-runtimes').value = String(config.maxOpenCodeRuntimes || 2);
  getElement('agent-zcode-max-concurrent').value = String(config.zcodeMaxConcurrent || 1);
  getElement('agent-zcode-instructions').value = config.zcodeInstructions || '';
  getElement('agent-zcode-mcp').value = config.zcodeMcpServers || '';
  getElement('agent-zcode-enable-workflow').checked = config.zcodeEnableWorkflow === true;
  renderZcodeMcpSummary();
  getElement('agent-custom-workspaces').value = (config.customWorkspaces || [])
    .map(item => `${item.name || ''}|${item.directory || ''}`)
    .join('\n');
  getElement('agent-runtime-idle').value = String(config.runtimeIdleTimeoutMs || 120000);
  getElement('agent-http-proxy').value = config.httpProxy || '';
  getElement('agent-manual-context-limit').value = config.manualContextLimit > 0 ? String(config.manualContextLimit) : '';
  getElement('agent-auto-compact-enabled').checked = config.autoCompactEnabled !== false;
  getElement('agent-auto-compact-threshold').value = String(config.autoCompactThreshold || 80);
  getElement('agent-compact-model').value = config.compactModel || '';
  getElement('agent-compact-provider').value = config.compactProviderId || '';
  getElement('agent-provider-opencode').checked = config.providers?.opencode !== false;
  getElement('agent-provider-zcode').checked = config.providers?.zcode === true;
  getElement('agent-output-images').checked = config.outputImagesEnabled === true;
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
}

// 设置面板「允许 ZCode」旁的运行时状态：就绪显示版本，缺失/Node 过低时透出后端诊断与处理指引
function renderZcodeSettingHint(data = {}) {
  const target = getElement('agent-zcode-status');
  if (!target) return;
  const provider = (Array.isArray(data.providers) ? data.providers : []).find(item => item.id === 'zcode');
  if (!provider) {
    target.textContent = '';
    target.classList.add('hidden');
    return;
  }
  target.classList.remove('hidden');
  target.textContent = provider.available === true
    ? `运行时就绪：v${provider.version || '未知'}（内置产物，宿主 Node 直接执行）`
    : (provider.error || '运行时不可用');
}

function renderWorkspaces(data = {}) {
  const select = getElement('agent-workspace');
  const previous = select.value;
  const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  const options = workspaces.map(item => {
    const writable = Boolean(data.config?.writableWorkspaces?.[item.id]);
    const titleParts = [item.label, item.description].filter(Boolean).join(' — ');
    const title = `${titleParts}${writable ? '（可授权写入）' : '（只读）'}`;
    return `<option value="${escapeHtml(item.id)}" title="${escapeHtml(title)}">${escapeHtml(item.label || item.id)}${writable ? '（可写）' : '（只读）'}</option>`;
  });
  options.push('<option value="__custom__">＋ 自定义目录…</option>');
  select.innerHTML = options.join('');
  if (workspaces.some(item => item.id === previous)) select.value = previous;
  select.dataset.lastWorkspace = select.value;
}

function getSelectedTask(data = {}) {
  if (agentWorkbenchState.newSession) return null;
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return tasks.find(task => task.id === agentWorkbenchState.selectedTaskId) || tasks[0] || null;
}

// 单行摘要：折叠空白并截断（工具名/路径/命令等短文本展示用）
function normalizeSingleLine(value = '', maxLength = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
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

// 工具调用摘要行（ZCode 式）：图标 + 工具名 + 操作目标 + 状态，一行看完做了什么。
// 输入/输出仍保留在可展开的详情里，但默认不再需要点两次才能看到工具清单。
const agentToolIcons = {
  read: '<path d="M15.5 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6.5Z"/><path d="M15 3v4h4"/>',
  write: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  bash: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  grep: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  glob: '<path d="M3 6h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  default: '<path d="M14.7 6.3a5 5 0 0 0 6 6l-8.4 8.4a2 2 0 0 1-2.8 0l-3.2-3.2a2 2 0 0 1 0-2.8Z"/>',
};

function getAgentToolKind(tool = {}) {
  const name = String(tool.name || '').toLowerCase();
  if (/bash|shell|command|exec|terminal/.test(name)) return 'bash';
  if (/write/.test(name)) return 'write';
  if (/edit|patch|apply/.test(name)) return 'edit';
  if (/read|open|view/.test(name)) return 'read';
  if (/grep|search|find/.test(name)) return 'grep';
  if (/glob|list/.test(name)) return 'glob';
  if (/fetch|web|http|url/.test(name)) return 'web';
  return 'default';
}

function renderAgentToolIcon(tool = {}) {
  const paths = agentToolIcons[getAgentToolKind(tool)] || agentToolIcons.default;
  return `<span class="agent-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></span>`;
}

// 从工具入参里提取一句人类可读的操作目标（文件路径 / 命令 / 查询词）
function describeAgentToolTarget(tool = {}) {
  const raw = tool.input;
  let input = raw;
  if (typeof raw === 'string') {
    try { input = JSON.parse(raw); } catch { input = raw; }
  }
  if (Array.isArray(input)) {
    return normalizeSingleLine(input.map(item => String(item)).join(' '), 90);
  }
  if (input && typeof input === 'object') {
    const target = input.file_path || input.path || input.command || input.pattern
      || input.query || input.url || input.description || input.prompt || '';
    if (target) return normalizeSingleLine(String(target), 90);
    // 没有常见字段时退回第一个字符串值
    const first = Object.values(input).find(item => typeof item === 'string' && item.trim());
    if (first) return normalizeSingleLine(first, 90);
    return '';
  }
  return normalizeSingleLine(String(raw || ''), 90);
}

function renderAgentTools(tools = []) {
  if (!Array.isArray(tools) || !tools.length) return '';
  // 工具输入/输出统一带工具条：复制；输出超高时折叠（展开全部）
  const ioBlock = (label, value) => {
    const text = formatAgentText(value);
    if (!text) return '';
    const isOutput = label === '输出';
    return `<div class="agent-tool-io${isOutput ? ' is-output' : ''}">
      <div class="agent-tool-io-head"><span>${label}</span><span class="agent-tool-io-actions"><button type="button" data-tool-copy>复制</button>${isOutput ? '<button type="button" data-tool-expand>展开全部</button>' : ''}</span></div>
      <pre>${text}</pre>
    </div>`;
  };
  const okCount = tools.filter(tool => !/error|fail/i.test(String(tool.status || ''))).length;
  const summaryText = okCount === tools.length
    ? `${tools.length} 项`
    : `${okCount}/${tools.length} 项成功`;
  return `
    <details class="agent-artifact-card agent-tool-card" data-detail-key="tool-calls">
      <summary><span>工具调用</span><span class="agent-change-inline">${escapeHtml(summaryText)}</span><span class="agent-work-report-chevron" aria-hidden="true">›</span></summary>
      <div class="agent-tool-list">${tools.map(tool => {
        const toolImages = agentWorkbenchState.payload?.config?.outputImagesEnabled === true
          ? (Array.isArray(tool.images) ? tool.images : [])
          : [];
        const imagesHtml = toolImages.length
          ? `<div class="agent-tool-images">${toolImages.map(img => `<img class="agent-tool-image" src="${escapeHtml(img.url)}" alt="工具输出图片" referrerpolicy="no-referrer" />`).join('')}</div>`
          : '';
        const target = describeAgentToolTarget(tool);
        const failed = /error|fail/i.test(String(tool.status || ''));
        return `
        <details class="agent-tool-item${failed ? ' is-failed' : ''}">
          <summary>
            ${renderAgentToolIcon(tool)}
            <strong class="agent-tool-name">${escapeHtml(tool.name || '工具')}</strong>
            ${target ? `<span class="agent-tool-target" title="${escapeHtml(target)}">${escapeHtml(target)}</span>` : ''}
            <span class="agent-tool-state">${failed ? '失败' : '完成'}</span>
            <span class="agent-tool-chevron" aria-hidden="true">›</span>
          </summary>
          ${imagesHtml}
          ${ioBlock('输入', tool.input)}
          ${ioBlock('输出', tool.output)}
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
  const rawErrorDetail = String(message.upstreamErrorDetail || '').trim();
  const errorOutput = (message.error || rawErrorDetail)
    ? `<div class="agent-message-error">
        <strong>本轮未完成</strong>
        ${message.error ? `<span>${formatAgentText(message.error)}</span>` : ''}
        ${rawErrorDetail ? `<details class="agent-error-detail"><summary>原始报错</summary><pre>${formatAgentText(rawErrorDetail)}</pre></details>` : ''}
      </div>`
    : '';
  const reasoningOutput = reasoning
    ? `<details class="agent-artifact-card"><summary>思考过程</summary><pre>${formatAgentText(reasoning)}</pre></details>`
    : '';
  const diagnosticOutput = stderr
    ? `<details class="agent-artifact-card"><summary>运行诊断</summary><pre>${formatAgentText(stderr)}</pre></details>`
    : '';
  const usageOutput = renderUsageMeta(message.usage);
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
  const detailOutput = `${reasoningOutput}${renderAgentTools(message.tools)}${usageOutput}${diagnosticOutput}${eventOutput}`;
  const workLabel = `已工作 ${formatDuration(getAssistantWorkDuration(message))}`;
  const workLabelAttr = options.live === true ? ' data-live-work-label="1"' : '';
  const workOutput = detailOutput
    ? `
      <details class="agent-work-report" data-detail-key="work-report">
        <summary><span${workLabelAttr}>${escapeHtml(workLabel)}</span><span class="agent-work-report-chevron" aria-hidden="true">›</span></summary>
        <div class="agent-work-report-body">${detailOutput}</div>
      </details>
    `
    : `<div class="agent-work-report agent-work-report-empty"><span${workLabelAttr}>${escapeHtml(workLabel)}</span></div>`;
  return `${workOutput}${errorOutput}`;
}

// ZCode 式文件更改卡：独立于"已工作"，渲染在回复正文下方；展开为文件行列表
function renderFileChangesCard(message = {}, task = null) {
  const hasFiles = Array.isArray(message.changedFiles) && message.changedFiles.length > 0;
  // 0 改动时不渲染卡片（diffStat 只是汇总行，0 文件时也是非空文本）
  if (!(hasFiles || message.diffText)) return '';
  const diffSummary = summarizeChanges(message.changedFiles, message.changeSummary);
  const body = hasFiles
    ? renderFileChangeRows(message, task)
    : `<div class="agent-diff-output">${renderDiffText(buildTaskDiffOutput(message))}</div>`;
  return `<details class="agent-artifact-card agent-file-changes" data-detail-key="file-changes"><summary><span>${diffSummary.files ? `${diffSummary.files} 个文件已更改` : '文件更改'}</span><span class="agent-change-inline">${renderChangeSummary(diffSummary, { includeFiles: false })}</span><span class="agent-work-report-chevron" aria-hidden="true">›</span></summary>${body}</details>`;
}

function splitDiffByPath(diffText = '') {
  const text = String(diffText || '');
  const map = new Map();
  if (!text) return map;
  for (const chunk of text.split(/^diff --git /m)) {
    const match = chunk.match(/^a\/(\S+) b\/(\S+)/);
    if (!match) continue;
    map.set(match[2], `diff --git ${match[0]}\n${chunk.slice(match[0].length)}`);
  }
  return map;
}

function renderFileChangeRows(message = {}, task = null) {
  const files = Array.isArray(message.changedFiles) ? message.changedFiles : [];
  const diffMap = splitDiffByPath(message.diffText || task?.diffText || '');
  return `<div class="agent-file-change-list">${files.map(item => {
    const pathValue = String(item.path || '');
    const name = pathValue.split('/').pop() || pathValue;
    const dir = pathValue.slice(0, Math.max(0, pathValue.length - name.length)).replace(/\/$/, '');
    const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase().slice(0, 5) || 'file';
    const diff = diffMap.get(pathValue) || '';
    return `<div class="agent-file-change-row" data-file-path="${escapeHtml(pathValue)}">
      <span class="agent-file-ext" data-ext="${escapeHtml(ext)}">${escapeHtml(ext)}</span>
      <span class="agent-file-change-name" title="${escapeHtml(pathValue)}">${escapeHtml(name)}</span>
      <span class="agent-file-change-dir">${escapeHtml(dir)}</span>
      <span class="agent-file-change-stats"><span class="is-added">+${Number(item.additions || 0)}</span><span class="is-deleted">-${Number(item.deletions || 0)}</span></span>
      <span class="agent-file-change-actions">
        ${diff ? '<button type="button" data-file-action="review">审查</button>' : ''}
        <button type="button" data-file-action="open">打开</button>
      </span>
      ${diff ? `<div class="agent-file-change-diff hidden">${renderDiffText(diff)}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
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
    const code = String(token.content || '').replace(/\n$/, '');
    return `<section class="agent-message-code">
      <div class="agent-message-code-head"><span>${escapeHtml(language)}</span><button type="button" class="agent-message-code-copy" data-agent-code-copy aria-label="复制代码">复制</button></div>
      <pre><code class="language-${escapeHtml(language)}">${highlightAgentCode(code, language)}</code></pre>
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

// 代码块语法高亮：highlight.js（vendor 懒加载，defer 脚本）可用且认识该语言时才高亮，
// 其余情况保持纯转义文本；mermaid 块由 upgradeMermaidCodeBlocks 在渲染后二次处理
function highlightAgentCode(code = '', language = '') {
  const escaped = escapeHtml(code);
  const lang = String(language || '').toLowerCase();
  if (lang === 'mermaid' || lang === 'text' || lang === 'plain' || lang === 'txt') return escaped;
  // highlight.js v11 导出的是对象（非函数），以能力判断为准
  if (typeof window.hljs?.getLanguage !== 'function' || typeof window.hljs?.highlight !== 'function') return escaped;
  try {
    if (window.hljs.getLanguage(lang)) {
      return window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
  } catch {
    // 高亮失败退回纯文本，不影响正文渲染
  }
  return escaped;
}

const markdownRenderCache = new Map();
const markdownRenderCacheLimit = 200;

function formatAgentMarkdown(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const renderer = getAgentMarkdownRenderer();
  if (!renderer) return escapeHtml(text).replace(/\r?\n/g, '<br>');
  const imagesAllowed = agentWorkbenchState.payload?.config?.outputImagesEnabled === true;
  // highlight.js 是 defer 脚本，早期渲染可能尚未就绪：可用性进缓存键，避免把未高亮结果缓存住
  const hljsReady = typeof window.hljs?.getLanguage === 'function' ? 'hl1' : 'hl0';
  const cacheKey = `${imagesAllowed ? 'img' : 'txt'}:${hljsReady}:${text}`;
  if (text.length <= 60000) {
    const cached = markdownRenderCache.get(cacheKey);
    if (cached !== undefined) {
      // LRU：命中后挪到队尾，超限时淘汰最老的条目
      markdownRenderCache.delete(cacheKey);
      markdownRenderCache.set(cacheKey, cached);
      return cached;
    }
  }
  if (imagesAllowed) {
    renderer.enable('image');
  } else {
    renderer.disable('image');
  }
  const html = renderer.render(text);
  const result = !imagesAllowed ? html : html.replace(/(<img[^>]*?\ssrc=")(?!data:|https?:|\/\/|\/api\/)([^"]*)"/g, (match, prefix, src) => {
    let decoded = decodeHtmlEntities(src);
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // 非法的百分号序列保持原样
    }
    const normalized = decoded.replace(/^file:\/\//i, '').replace(/\\/g, '/');
    return `${prefix}/api/agent-workbench/workspace-image?path=${encodeURIComponent(normalized)}"`;
  });
  if (text.length <= 60000) {
    markdownRenderCache.set(cacheKey, result);
    if (markdownRenderCache.size > markdownRenderCacheLimit) {
      markdownRenderCache.delete(markdownRenderCache.keys().next().value);
    }
  }
  return result;
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

// ===== Mermaid 图渲染 =====
// vendor/mermaid.min.js（约 2.5MB）按需加载：只有消息里真的出现 mermaid 代码块才拉取。
// 渲染结果按「主题:源码」缓存，会话重渲染时不重复出图。
const agentMermaidState = { loading: null, api: null, svgCache: new Map(), svgCacheLimit: 60 };

function ensureMermaidApi() {
  if (agentMermaidState.api) return Promise.resolve(agentMermaidState.api);
  if (agentMermaidState.loading) return agentMermaidState.loading;
  agentMermaidState.loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/mermaid.min.js';
    script.onload = () => {
      try {
        const api = window.mermaid;
        if (!api || typeof api.render !== 'function') throw new Error('mermaid 全局对象不可用');
        api.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
        });
        agentMermaidState.api = api;
        resolve(api);
      } catch (error) {
        agentMermaidState.loading = null;
        reject(error);
      }
    };
    script.onerror = () => {
      agentMermaidState.loading = null;
      reject(new Error('mermaid 库加载失败'));
    };
    document.head.appendChild(script);
  });
  return agentMermaidState.loading;
}

async function renderAgentMermaidBlocks(root) {
  const blocks = [...root.querySelectorAll('.agent-mermaid[data-mermaid-source]')]
    .filter(el => !el.dataset.mermaidState);
  if (!blocks.length) return;
  let api = null;
  try {
    api = await ensureMermaidApi();
  } catch (error) {
    blocks.forEach(el => {
      el.dataset.mermaidState = 'error';
      el.innerHTML = `<div class="agent-mermaid-note is-error">流程图渲染失败：${escapeHtml(String(error.message || error).slice(0, 160))}（源码保留在下方）</div>`;
    });
    return;
  }
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  for (const block of blocks) {
    const source = block.dataset.mermaidSource || '';
    block.dataset.mermaidState = 'done';
    const cacheKey = `${theme}:${source}`;
    const cached = agentMermaidState.svgCache.get(cacheKey);
    if (cached) {
      block.innerHTML = cached;
      continue;
    }
    try {
      const { svg } = await api.render(`agent-mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, source);
      block.innerHTML = svg;
      if (agentMermaidState.svgCache.size >= agentMermaidState.svgCacheLimit) {
        agentMermaidState.svgCache.delete(agentMermaidState.svgCache.keys().next().value);
      }
      agentMermaidState.svgCache.set(cacheKey, svg);
    } catch (error) {
      block.dataset.mermaidState = 'error';
      block.innerHTML = `<div class="agent-mermaid-note is-error">图表语法有误：${escapeHtml(String(error?.message || error).slice(0, 200))}（源码保留在下方）</div>`;
    }
  }
}

function upgradeMermaidCodeBlocks(root) {
  let found = false;
  root.querySelectorAll('pre code.language-mermaid').forEach(codeEl => {
    const section = codeEl.closest('.agent-message-code');
    if (!section || section.dataset.mermaidUpgraded === '1') return;
    const source = codeEl.textContent || '';
    section.dataset.mermaidUpgraded = '1';
    section.classList.add('agent-mermaid-block');
    section.querySelector('pre')?.remove();
    section.insertAdjacentHTML('beforeend', `
      <div class="agent-mermaid" data-mermaid-source="${escapeHtml(source)}"><div class="agent-mermaid-note">正在渲染流程图...</div></div>
      <details class="agent-mermaid-source"><summary>图表源码</summary><pre><code>${escapeHtml(source)}</code></pre></details>`);
    found = true;
  });
  if (found) renderAgentMermaidBlocks(root).catch(() => { });
}

function renderLiveStepBubbles(steps = [], placeholder = '', isRunning = true, segments = []) {
  // 运行中的实时输出按助手步骤分气泡渲染（ZCode 式）；思考链以单行滚动条展示，点击展开全文。
  // “思考中”只标记当前正在思考的步骤（最后一步且尚未输出正文），已完成的步骤显示静态“思考过程”
  const list = (Array.isArray(steps) ? steps : []).filter(step => String(step?.content || '').trim() || String(step?.reasoning || '').trim());
  // ZCode 一轮任务会分多段输出（段间夹工具调用）：已完成段落各自成块，当前段追加在末尾
  const doneSegments = (Array.isArray(segments) ? segments : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(text => `<div class="agent-message-bubble agent-agent-bubble agent-markdown">${formatAgentMarkdown(text)}</div>`)
    .join('');
  if (!list.length) {
    // 无分步信息时：已完成的段落各自成块，末尾接当前正在输出的文本
    const tail = String(placeholder || '').trim()
      ? `<div class="agent-message-bubble agent-agent-bubble agent-markdown">${formatAgentMarkdown(placeholder)}</div>`
      : '';
    return `${doneSegments}${tail}`;
  }
  agentWorkbenchState.expandedReasoning = agentWorkbenchState.expandedReasoning || new Set();
  const activeId = isRunning && list.length ? list[list.length - 1].messageId : '';
  return list.map(step => {
    // echoStream：回声模型的思考缓冲（reasoning 部件滞后时用它先行展示）
    const reasoning = String(step.reasoning || step.echoStream || '').replace(/\s+/g, ' ').trim();
    const expanded = reasoning && agentWorkbenchState.expandedReasoning.has(step.messageId);
    const isThinking = step.messageId === activeId && !String(step.content || '').trim();
    // 运行中的思考展示由悬浮思考条承担（信息重复会互相干扰）；流内滚动条仅保留在
    // 已完成消息的"已工作"报告里（renderAssistantArtifacts 路径）
    const ticker = reasoning && !isRunning ? `
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
  // 真实比例用于文案（可能 >100%），进度条宽高仍夹在 100% 内避免溢出
  const rawPercent = contextLimit > 0 ? Math.round((contextUsage / contextLimit) * 1000) / 10 : 0;
  const percent = Math.min(100, rawPercent);
  const percentText = Number.isInteger(rawPercent) ? `${rawPercent}%` : `${rawPercent.toFixed(1)}%`;
  contextRing.style.setProperty('--agent-context-angle', `${Number((percent * 3.6).toFixed(2))}deg`);
  contextRing.classList.toggle('is-warn', percent >= 80 && percent < 95);
  contextRing.classList.toggle('is-danger', percent >= 95);
  getElement('agent-context-model-label').textContent = selectedModel;
  getElement('agent-context-model-label').title = selectedModel;
  getElement('agent-context-variant-label').textContent = `推理 ${variantLabel}`;
  // 明细表已并入摘要行：模型/推理挂在标题行 tooltip，输入/输出/总量进说明文字
  const titleEl = document.querySelector('.agent-context-usage-popover header strong');
  if (titleEl) titleEl.title = `${selectedModel} · 推理 ${variantLabel}`;
  if (contextLimit > 0) {
    const compactedAt = task?.lastCompactedAt ? ` · 最近压缩 ${formatTime(task.lastCompactedAt)}` : '';
    contextLabel.textContent = `${formatContextTokenCount(contextUsage)} / ${formatContextTokenCount(contextLimit)}（${percentText}）`;
    contextBar.style.width = `${percent}%`;
    contextBar.classList.toggle('is-filled', percent > 0);
    contextBar.classList.toggle('is-warn', percent >= 80);
    contextPercentLabel.textContent = percentText;
    const limitSource = usingManualLimit ? '手动容量' : '模型容量';
    const usageSource = usingEstimatedUsage ? '输入 Token 估算' : '实时使用量';
    contextNote.textContent = `${percentText} · ${limitSource} · ${usageSource}${agentWorkbenchState.payload?.config?.autoCompactEnabled === false ? ' · 自动压缩已关闭' : ''}${compactedAt}`;
  } else {
    contextLabel.textContent = contextUsage ? `${formatContextTokenCount(contextUsage)} Token` : '未读取';
    contextBar.style.width = '0%';
    contextBar.classList.remove('is-filled');
    contextBar.classList.remove('is-warn');
    contextPercentLabel.textContent = contextUsage ? formatContextTokenCount(contextUsage) : '未读取';
    contextNote.textContent = contextUsage
      ? '当前模型未返回上下文上限，可在设置中填写手动容量。'
      : '完成一轮对话后显示当前会话用量；也可在设置中填写手动容量。';
  }
  renderContextBreakdown(task, { contextUsage, contextLimit });
  renderContextCacheRate(task);
}

// 上下文构成：按消息角色拆分当前占用（上游只回最后一条 assistant 的 tokens，
// 上下文构成（对齐 ZCode 版式）：按本会话真实消息内容归类。
// ZCode 那六类里的「系统工具 / MCP 工具 / 技能」来自它 CLI 内部估算，不经过结果行，
// 我们拿不到就不硬编；这里只用能真实算出的来源，缺的类别不显示，避免出现假数据。
// 缓存命中不参与构成：它是「同一批消息被复用」的比例，已由底部命中率单独表达，
// 混进来源列表会把真实构成压成个位数百分比。
const AGENT_CONTEXT_SOURCES = [
  { key: 'user', label: '消息' },
  { key: 'assistant', label: '模型回复' },
  { key: 'tool', label: '工具调用' },
  { key: 'system', label: '系统提示词' },
];

function renderContextBreakdown(task = null, { contextUsage = 0 } = {}) {
  const container = getElement('agent-context-breakdown');
  if (!container) return;
  const messages = Array.isArray(task?.messages) ? task.messages : [];
  if (!messages.length || contextUsage <= 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  const weights = new Map(AGENT_CONTEXT_SOURCES.map(source => [source.key, 0]));
  for (const message of messages) {
    const role = String(message?.role || '').trim();
    const key = role === 'user' || role === 'assistant' || role === 'system' ? role : '';
    const text = String(message?.content || message?.text || message?.outputText || '');
    // 字符数近似 token 权重：同一会话内各来源用同一估算器才可比较
    if (key) weights.set(key, weights.get(key) + Math.max(1, text.length));
    // 工具调用：把工具名、参数与结果计入「工具调用」，它们同样是上下文占用
    const tools = Array.isArray(message?.tools) ? message.tools : [];
    for (const tool of tools) {
      const payload = `${tool?.name || tool?.tool || ''}${tool?.input || ''}${tool?.output || tool?.result || ''}`;
      weights.set('tool', weights.get('tool') + Math.max(1, payload.length));
    }
  }
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  const rows = AGENT_CONTEXT_SOURCES
    .map(source => ({ label: source.label, value: weights.get(source.key) || 0 }))
    .filter(row => row.value > 0)
    .sort((left, right) => right.value - left.value)
    .map(row => ({ label: row.label, percent: (row.value / total) * 100 }));
  container.innerHTML = rows.map(row => `
    <div class="agent-context-breakdown-row">
      <span class="agent-context-breakdown-dot" aria-hidden="true"></span>
      <span class="agent-context-breakdown-label">${escapeHtml(row.label)}</span>
      <strong class="agent-context-breakdown-percent">${formatContextBreakdownPercent(row.percent)}</strong>
    </div>`).join('');
  container.classList.remove('hidden');
}

function formatContextBreakdownPercent(value = 0) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  if (percent <= 0) return '0%';
  if (percent < 0.1) return '<0.1%';
  // 与 ZCode 一致：整数不带小数点，非整数保留一位
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

// 平均缓存命中率 = cacheRead / promptTokens。
// 后端 normalizeUsage 的 input 已含 cacheRead + cacheWrite，所以 input 就是完整 prompt 口径，
// 不能再加一次 cacheRead/cacheWrite（会让分母偏大、命中率偏低）。
function renderContextCacheRate(task = null) {
  const row = getElement('agent-context-cache-row');
  const valueEl = getElement('agent-context-cache-rate');
  if (!row || !valueEl) return;
  const usage = task?.usage && typeof task.usage === 'object' ? task.usage : {};
  const cacheRead = Math.max(0, Number(usage.cacheRead || 0));
  const cacheWrite = Math.max(0, Number(usage.cacheWrite || 0));
  const promptTokens = Math.max(0, Number(usage.input || 0));
  if (promptTokens <= 0 || (cacheRead <= 0 && cacheWrite <= 0)) {
    row.classList.add('hidden');
    valueEl.textContent = '—';
    return;
  }
  const rate = Math.min(100, (cacheRead / promptTokens) * 100);
  valueEl.textContent = `${Math.round(rate * 10) / 10}%`;
  row.classList.remove('hidden');
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
    const result = await fetchJson(`/api/file-browser/tree?path=${encodeURIComponent(buildFileBrowserPath(pathValue))}`);
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

// file-browser 根是 Yunzai 进程 cwd，工作台文件路径是插件相对路径，按服务端下发的前缀拼接；
// 绝对路径（用户在文件浏览器里导航到插件目录之外）原样穿透
function buildFileBrowserPath(pathValue = '') {
  const clean = String(pathValue || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (pathValue.startsWith('/')) {
    return pathValue.replace(/\/+$/, '') || '/';
  }
  const prefix = String(agentWorkbenchState.payload?.pluginFilePrefix || '').replace(/\/+$/, '');
  return prefix ? `${prefix}/${clean}` : clean;
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
    const result = await fetchJson(`/api/file-browser/read?path=${encodeURIComponent(buildFileBrowserPath(pathValue))}`);
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
    getElement('agent-file-editor-title').textContent = '读取失败';
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
  // SSE 事件常成串到达：状态先同步更新，渲染合并到 120ms 尾沿执行一次，避免整段会话反复重建
  scheduleMergeRender();
}

let mergeRenderTimer = null;
function scheduleMergeRender() {
  if (mergeRenderTimer) return;
  mergeRenderTimer = setTimeout(() => {
    mergeRenderTimer = null;
    renderSummary(agentWorkbenchState.payload);
    renderTasks(agentWorkbenchState.payload);
    renderSelectedTask(agentWorkbenchState.payload);
    updateRunState(agentWorkbenchState.payload);
  }, 120);
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
  if (change.liveStatus !== undefined) task.liveStatus = String(change.liveStatus || '');
  if (change.liveCommand !== undefined) task.liveCommand = String(change.liveCommand || '');
  if (Array.isArray(change.outputSegments)) task.outputSegments = change.outputSegments.map(item => String(item || ''));
  if (change.liveReasoning !== undefined) task.liveReasoning = String(change.liveReasoning || '');
  if (Object.prototype.hasOwnProperty.call(change, 'outputText')) {
    task.outputText = String(change.outputText || '');
  } else if (change.delta) {
    task.outputText = appendStreamText(task.outputText, change.delta);
  }
  if (change.status) task.status = change.status;
  if (change.stage) task.stage = change.stage;
  if (change.updatedAt) task.updatedAt = change.updatedAt;
  if (task.status === 'running' && task.startedAt) {
    const started = Date.parse(task.startedAt);
    if (Number.isFinite(started)) task.elapsedMs = Math.max(0, Date.now() - started);
  }
  if (task.id !== agentWorkbenchState.selectedTaskId || agentWorkbenchState.newSession) return;

  const liveMessage = getElement('agent-output')?.querySelector('.agent-message-live');
  const bubbles = liveMessage?.querySelector('.agent-message-live-bubbles');
  if (bubbles) {
    const placeholder = task.status === 'pending'
      ? `任务正在排队${task.queuePosition ? `，当前位置 ${task.queuePosition}` : ''}...`
      : (task.liveStatus || 'Agent 正在准备输出...');
    const nextHtml = renderLiveStepBubbles(task.liveSteps, normalizeAgentOutput(task.outputText) || placeholder, task.status === 'running', task.outputSegments);
    const signature = `${nextHtml.length}:${nextHtml.slice(-60)}`;
    if (bubbles.dataset.liveSignature !== signature) {
      bubbles.dataset.liveSignature = signature;
      bubbles.innerHTML = nextHtml;
    }
  }
  const progress = liveMessage?.querySelector('.agent-live-progress');
  if (progress) {
    // 状态行只放一行摘要：历史任务可能把整段多行命令写进了 liveStatus
    const liveStatus = String(task.liveStatus || '').trim().split(/\r?\n/)[0].slice(0, 120);
    const liveCommand = String(task.liveCommand || '').trim();
    progress.classList.toggle('hidden', !liveStatus && !liveCommand);
    const progressText = progress.querySelector('.agent-live-progress-text');
    if (progressText) progressText.textContent = liveStatus;
    // 命令单独用等宽块渲染：多行命令塞进单行状态会被压成一坨
    const commandEl = progress.querySelector('.agent-live-command');
    if (commandEl) {
      const changed = commandEl.dataset.liveCommand !== liveCommand;
      commandEl.classList.toggle('hidden', !liveCommand);
      if (changed) {
        commandEl.dataset.liveCommand = liveCommand;
        commandEl.textContent = liveCommand;
      }
    }
  }
  const liveWorkLabel = liveMessage?.querySelector('[data-live-work-label]');
  if (liveWorkLabel && task.status === 'running') {
    liveWorkLabel.textContent = `已工作 ${formatDuration(Math.max(0, Number(task.elapsedMs || 0)))}`;
  }
  const status = getStatusMeta(task.status);
  const badge = getElement('agent-chat-status-badge');
  if (badge) {
    badge.textContent = status.label;
    badge.className = `agent-state-badge tone-${status.tone}`;
  }
  // 思考增量走这条路径（不整段重渲染），悬浮思考条在这里同步
  updateThinkingBar(task);
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
        closeZcodeSessionDialog();
      }
      renderTasks(agentWorkbenchState.payload);
      renderSelectedTask(agentWorkbenchState.payload);
    } catch {
      // 周期刷新会兜底恢复会话列表。
    }
  });
  source.addEventListener('task_forked', event => {
    try {
      const payload = JSON.parse(event.data || '{}');
      if (!payload.task?.id) return;
      mergeStreamTask(payload.task);
      // 分叉完成即切到新会话，用户可以直接接着输入
      agentWorkbenchState.selectedTaskId = payload.task.id;
      agentWorkbenchState.newSession = false;
      agentWorkbenchState.formTaskId = '';
      expandWorkspaceGroupForTask(payload.task);
      renderTasks(agentWorkbenchState.payload);
      renderSelectedTask(agentWorkbenchState.payload);
      setStatus(`已分叉为新会话「${payload.task.title || 'Agent 会话'}」。`);
    } catch {
      // 周期刷新会兜底恢复会话列表。
    }
  });
  source.onerror = () => {
    agentWorkbenchState.streamConnected = false;
  };
}

// TODO 报告卡锚点：卡片固定在"计划完成那一轮"的助手消息后，后续对话在它下方继续，
// 不会一直钉在会话最底部；todo 内容变化（新一轮计划）时重新锚定到最新一轮。
// 锚点写入 sessionStorage：页面刷新后不重排（否则每次刷新都会重新钉到当时的最后一条）
const TODO_ANCHOR_STORE_KEY = 'crystelf-agent-todo-anchors-v1';

function loadTodoAnchors() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TODO_ANCHOR_STORE_KEY) || '{}');
    return raw && typeof raw === 'object' ? new Map(Object.entries(raw)) : new Map();
  } catch {
    return new Map();
  }
}

function saveTodoAnchor(taskId, entry) {
  try {
    agentWorkbenchState.todoAnchors.set(taskId, entry);
    const raw = JSON.parse(sessionStorage.getItem(TODO_ANCHOR_STORE_KEY) || '{}');
    raw[taskId] = entry;
    const keys = Object.keys(raw);
    if (keys.length > 40) keys.slice(0, keys.length - 40).forEach(key => delete raw[key]);
    sessionStorage.setItem(TODO_ANCHOR_STORE_KEY, JSON.stringify(raw));
  } catch {
    // 存储不可用时退化为内存锚点
  }
}

// ===== TODO 计划卡 / 排队可视化 =====
const TODO_STATUS_META = {
  pending: { icon: '○', cls: 'is-pending' },
  in_progress: { icon: '◔', cls: 'is-active' },
  completed: { icon: '✓', cls: 'is-done' },
  cancelled: { icon: '·', cls: 'is-skip' },
  canceled: { icon: '·', cls: 'is-skip' },
};

function normalizeTodoStatus(status = '') {
  return String(status || 'pending').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function renderTodoCard(todos = [], { collapsed = false } = {}) {
  const items = (Array.isArray(todos) ? todos : []).filter(item => String(item?.content || '').trim());
  if (!items.length) return '';
  const done = items.filter(item => normalizeTodoStatus(item.status) === 'completed').length;
  const rows = items.slice(0, 20).map(item => {
    const meta = TODO_STATUS_META[normalizeTodoStatus(item.status)] || TODO_STATUS_META.pending;
    return `<div class="agent-todo-item ${meta.cls}"><span class="agent-todo-icon" aria-hidden="true">${meta.icon}</span><span class="agent-todo-text">${escapeHtml(String(item.content).slice(0, 300))}</span></div>`;
  }).join('');
  return `
    <details class="agent-todo-card"${collapsed ? '' : ' open'}>
      <summary><span class="agent-todo-badge">计划</span><span>${done}/${items.length} 项已完成</span><span class="agent-work-report-chevron" aria-hidden="true">›</span></summary>
      <div class="agent-todo-list">${rows}</div>
    </details>`;
}

// 排队可视化：任务在队列中等待时，列出前方还有哪些任务
function renderQueueCard(task = {}, payload = {}) {
  if (task.status !== 'pending') return '';
  const active = (Array.isArray(payload.tasks) ? payload.tasks : [])
    .filter(item => ['running', 'pending'].includes(item.status) && item.id !== task.id)
    .sort((left, right) => (left.status === 'running' ? 0 : 1) - (right.status === 'running' ? 0 : 1))
    .slice(0, 5);
  const aheadRows = active.map(item => `
    <div class="agent-queue-item ${item.status === 'running' ? 'is-running' : ''}">
      <span class="agent-queue-dot" aria-hidden="true"></span>
      <span class="agent-queue-title">${escapeHtml(String(item.title || 'Agent 任务').slice(0, 60))}</span>
      <small>${item.status === 'running' ? '执行中' : '排队中'}</small>
    </div>`).join('');
  return `
    <div class="agent-queue-card">
      <strong>⏳ 排队中${task.queuePosition ? ` · 当前第 ${task.queuePosition} 位` : ''}</strong>
      ${aheadRows ? `<div class="agent-queue-list">${aheadRows}</div>` : '<span class="agent-queue-empty">等待调度…</span>'}
    </div>`;
}

// 本轮已并入的追加消息数：steer 消息晚于最近一条助手回复即视为本轮
function countLiveFollowUps(task = {}) {
  if (!['running', 'pending'].includes(task.status)) return 0;
  const messages = Array.isArray(task.messages) ? task.messages : [];
  const lastAssistantAt = [...messages].reverse().find(m => m?.role === 'assistant')?.createdAt || task.startedAt || '';
  const since = Date.parse(lastAssistantAt) || 0;
  return messages.filter(m => m?.role === 'user' && m.delivery === 'steer' && (Date.parse(m.createdAt || '') || 0) >= since).length;
}

// ===== 计划确认卡 =====
// 只读任务（analyze/patch）成功完成后，在会话末尾给出「转为实际修改」入口：
// 一键把模式切到 edit + build Agent，并预填执行指令（首次写入仍会弹确认框，安全门不绕过）
function renderPlanConfirmCard(task = null) {
  if (!task || ['running', 'pending'].includes(task.status)) return '';
  if (task.status !== 'success' || isWriteMode(task.mode)) return '';
  const lastAssistant = [...(Array.isArray(task.messages) ? task.messages : [])]
    .reverse()
    .find(message => message?.role === 'assistant' && String(message.content || '').trim());
  if (!lastAssistant) return '';
  return `
    <div class="agent-plan-confirm" role="group" aria-label="计划确认">
      <div class="agent-plan-confirm-head">
        <span class="agent-plan-confirm-icon" aria-hidden="true">🧭</span>
        <div>
          <strong>${task.mode === 'patch' ? '补丁方案已就绪' : '分析方案已就绪'}</strong>
          <span>把这份结论变成实际修改，或继续追问细节。</span>
        </div>
      </div>
      <div class="agent-plan-confirm-actions">
        <button type="button" class="is-primary" data-plan-action="execute">转为实际修改</button>
        <button type="button" data-plan-action="followup">继续追问</button>
      </div>
    </div>`;
}

function executePlanFromCard() {
  const modeSelect = getElement('agent-mode');
  if (modeSelect) {
    modeSelect.value = 'edit';
    // change 监听会同步移动端模式选择并切换 Agent/安全提示
    modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const agentSelect = getElement('agent-agent');
  if (agentSelect && [...agentSelect.options].some(option => option.value === 'build')) agentSelect.value = 'build';
  const composer = getElement('agent-prompt');
  if (composer && !String(composer.value || '').trim()) {
    composer.value = '请按照上面的方案开始执行实际修改；执行过程中需要确认时随时提问。';
  }
  getElement('agent-composer-form')?.requestSubmit();
}

// ===== 图片灯箱 =====
const agentLightboxState = { images: [], index: 0 };

function openAgentLightbox(images = [], index = 0) {
  const overlay = getElement('agent-lightbox');
  if (!overlay || !images.length) return;
  agentLightboxState.images = [...images];
  agentLightboxState.index = Math.min(Math.max(0, index), images.length - 1);
  overlay.classList.remove('hidden');
  document.body.classList.add('agent-lightbox-open');
  updateAgentLightbox();
}

function updateAgentLightbox() {
  const overlay = getElement('agent-lightbox');
  const image = agentLightboxState.images[agentLightboxState.index];
  if (!overlay || !image) return;
  const target = getElement('agent-lightbox-img');
  target.src = image.currentSrc || image.src || '';
  target.alt = image.alt || '预览图片';
  overlay.classList.remove('is-zoomed');
  const counter = getElement('agent-lightbox-counter');
  if (counter) counter.textContent = agentLightboxState.images.length > 1 ? `${agentLightboxState.index + 1} / ${agentLightboxState.images.length}` : '';
  const caption = getElement('agent-lightbox-caption');
  if (caption) caption.textContent = image.alt && image.alt !== '预览图片' ? image.alt : '';
}

function stepAgentLightbox(delta) {
  if (agentLightboxState.images.length < 2) return;
  const total = agentLightboxState.images.length;
  agentLightboxState.index = (agentLightboxState.index + delta + total) % total;
  updateAgentLightbox();
}

function closeAgentLightbox() {
  const overlay = getElement('agent-lightbox');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.classList.remove('is-zoomed');
  document.body.classList.remove('agent-lightbox-open');
  getElement('agent-lightbox-img').src = '';
  agentLightboxState.images = [];
}

function isAgentLightboxOpen() {
  return !getElement('agent-lightbox')?.classList.contains('hidden');
}

// ===== 悬浮思考条（输入框上方，ZCode 式单行滚动 + 点击展开）=====
// 数据源与主流思考滚动条一致：SSE 实时推进的 liveSteps[].reasoning。
// 仅在"运行中且最新步骤还没有正文"时显示——模型开始写答案后答案本身在主流可见，悬浮条收起
function updateThinkingBar(task = null) {
  const bar = getElement('agent-thinking-bar');
  if (!bar) return;
  const running = task && ['running', 'pending'].includes(task.status);
  const steps = running && Array.isArray(task.liveSteps) ? task.liveSteps : [];
  // 实测 GLM 系思考流与正文交错到达（正文先行也常见），不能要求"最新步骤无正文"：
  // 只要运行中出现 reasoning 流就显示，任务结束/无思考流时收起。
  // echoStream：回声模型的思考暂扣缓冲（reasoning 部件滞后到达，用它先行喂条）
  const latestWithThinking = [...steps].reverse()
    .find(step => String(step?.reasoning || '').trim() || String(step?.echoStream || '').trim()) || null;
  // ZCode 的 reasoning_delta 直接进 task.liveReasoning（不走 liveSteps）
  const liveReasoning = String(task?.liveReasoning || '').trim();
  const reasoning = liveReasoning
    || (latestWithThinking ? (String(latestWithThinking.reasoning || '').trim() || String(latestWithThinking.echoStream || '').trim()) : '');
  if (!running || !reasoning) {
    bar.classList.add('hidden');
    bar.classList.remove('is-expanded');
    return;
  }
  bar.classList.remove('hidden');
  const textEl = getElement('agent-thinking-text');
  if (textEl) textEl.textContent = `…${reasoning.slice(-120)}`;
  const fullEl = getElement('agent-thinking-full');
  if (fullEl) {
    fullEl.textContent = reasoning;
    fullEl.scrollTop = fullEl.scrollHeight;
  }
}

function toggleThinkingBar() {
  const bar = getElement('agent-thinking-bar');
  if (!bar || bar.classList.contains('hidden')) return;
  const expanded = !bar.classList.contains('is-expanded');
  bar.classList.toggle('is-expanded', expanded);
  if (expanded) {
    const fullEl = getElement('agent-thinking-full');
    if (fullEl) fullEl.scrollTop = fullEl.scrollHeight;
  }
}

// ===== 会话内容搜索 =====
// 在当前会话已渲染的消息里做文本搜索：命中包 <mark> 高亮，↑↓ 循环跳转。
// 高亮在每次会话重渲染后重刷（innerHTML 重建会清掉旧 mark，重打即可）
function getSessionContentSearch() {
  agentWorkbenchState.contentSearch = agentWorkbenchState.contentSearch || { open: false, query: '', hits: [], index: -1 };
  return agentWorkbenchState.contentSearch;
}

function clearContentSearchHits(root) {
  root.querySelectorAll('mark.agent-search-hit').forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    parent.normalize();
  });
}

function applyContentSearchHighlights() {
  const root = getElement('agent-output');
  if (!root) return;
  const search = getSessionContentSearch();
  clearContentSearchHits(root);
  search.hits = [];
  search.index = -1;
  const counter = getElement('agent-content-search-count');
  const query = search.open ? String(search.query || '').trim().toLowerCase() : '';
  if (!search.open || query.length < 2) {
    if (counter) counter.textContent = search.open ? '输入至少 2 个字符' : '';
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('mark.agent-search-hit, script, style, textarea')
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT,
  });
  const targets = [];
  let textNode;
  while ((textNode = walker.nextNode())) {
    if ((textNode.nodeValue || '').toLowerCase().includes(query)) targets.push(textNode);
  }
  for (const node of targets) {
    const text = node.nodeValue || '';
    const lower = text.toLowerCase();
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let at = lower.indexOf(query);
    while (at >= 0) {
      if (at > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, at)));
      const mark = document.createElement('mark');
      mark.className = 'agent-search-hit';
      mark.textContent = text.slice(at, at + query.length);
      fragment.appendChild(mark);
      search.hits.push(mark);
      cursor = at + query.length;
      at = lower.indexOf(query, cursor);
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }
  if (counter) counter.textContent = search.hits.length ? `${search.hits.length} 处匹配` : '无匹配';
}

function jumpContentSearchHit(delta) {
  const search = getSessionContentSearch();
  if (!search.hits.length) return;
  const total = search.hits.length;
  search.index = (search.index + delta + total) % total;
  search.hits.forEach((mark, idx) => mark.classList.toggle('is-active', idx === search.index));
  const active = search.hits[search.index];
  // 命中在折叠面板里时先展开再滚动
  active.closest('details:not([open])')?.setAttribute('open', '');
  active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const counter = getElement('agent-content-search-count');
  if (counter) counter.textContent = `${search.index + 1}/${total} 处匹配`;
}

function toggleContentSearchBar(forceOpen) {
  const search = getSessionContentSearch();
  search.open = forceOpen !== undefined ? forceOpen : !search.open;
  getElement('agent-content-search-bar')?.classList.toggle('hidden', !search.open);
  getElement('agent-content-search-toggle')?.classList.toggle('is-active', search.open);
  if (search.open) {
    getElement('agent-content-search-input')?.focus();
  } else {
    search.query = '';
    const input = getElement('agent-content-search-input');
    if (input) input.value = '';
  }
  applyContentSearchHighlights();
}

// ===== 顶栏活跃任务条 =====
// 运行中/排队中的任务在顶栏以小徽条展示：状态点 + 标题 + 耗时/排位，点击切到该任务
function renderActiveTaskStrip(data = {}) {
  const strip = getElement('agent-active-strip');
  if (!strip) return;
  const active = (Array.isArray(data.tasks) ? data.tasks : [])
    .filter(task => ['pending', 'running'].includes(task.status));
  if (!active.length) {
    strip.classList.add('hidden');
    strip.innerHTML = '';
    return;
  }
  strip.classList.remove('hidden');
  strip.innerHTML = active.map(task => {
    const running = task.status === 'running';
    const meta = running
      ? formatDuration(task.elapsedMs || 0)
      : (task.queuePosition ? `#${task.queuePosition}` : '排队');
    return `<button type="button" class="agent-active-chip ${running ? 'is-running' : 'is-queued'}" data-active-task="${escapeHtml(task.id)}" title="${escapeHtml(task.title || 'Agent 任务')}">
      <span class="agent-active-dot" aria-hidden="true"></span>
      <span class="agent-active-title">${escapeHtml(String(task.title || 'Agent 任务').slice(0, 14))}</span>
      <small>${escapeHtml(meta)}</small>
    </button>`;
  }).join('');
}

// 选中指定会话（侧栏点击/活跃任务条共用）
function selectAgentTaskById(taskId = '') {
  if (!taskId) return;
  const targetTask = (agentWorkbenchState.payload?.tasks || []).find(task => task.id === taskId);
  if (targetTask && !isSessionSearchActive()) expandWorkspaceGroupForTask(targetTask);
  agentWorkbenchState.selectedTaskId = taskId;
  agentWorkbenchState.newSession = false;
  agentWorkbenchState.conversationStickToBottom = true;
  agentWorkbenchState.formTaskId = '';
  setMobilePanel('');
  renderTasks(agentWorkbenchState.payload || {});
  renderSelectedTask(agentWorkbenchState.payload || {});
  refreshAgentWorkbench({ quiet: true }).catch(error => webConsoleAlert(error.message));
}

function renderConversation(task = null) {
  const target = getElement('agent-output');
  updateThinkingBar(task);
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
    const providerLabel = task.providerLabel || (task.providerId === 'zcode' ? 'ZCode' : 'OpenCode');
    target.innerHTML = `<div class="agent-chat-empty"><strong>正在加载会话</strong><span>正在读取 ${escapeHtml(providerLabel)} 多轮上下文...</span></div>`;
    return;
  }
  // 运行中同样展示完整历史：分步实时气泡已能区分当前轮，不再截断旧对话
  const visibleMessages = messages;
  const lastAssistantIndex = visibleMessages.reduce((index, message, currentIndex) => message.role === 'assistant' ? currentIndex : index, -1);
  // TODO 报告卡锚点：卡片固定在"计划完成那一轮"的助手消息后，后续对话在它下方继续，
  // 不会一直钉在会话最底部；todo 内容变化（新一轮计划）时重新锚定到最新一轮
  // TODO 报告卡锚点：卡片固定在"计划完成那一轮"的助手消息后，后续对话在它下方继续。
  // 锚点只在非运行态创建/更新（运行中重锚会把卡片钉到最新消息上）；运行中仍按已存锚点展示历史报告
  agentWorkbenchState.todoAnchors = agentWorkbenchState.todoAnchors || loadTodoAnchors();
  const hasTodoData = (Array.isArray(task.todo) ? task.todo : []).some(item => String(item?.content || '').trim());
  const todoSignature = JSON.stringify(task.todo || []);
  let todoAnchor = agentWorkbenchState.todoAnchors.get(task.id);
  if (!running && hasTodoData && (!todoAnchor || todoAnchor.signature !== todoSignature)) {
    const lastAssistant = [...visibleMessages].reverse().find(m => m?.role === 'assistant');
    todoAnchor = { signature: todoSignature, messageId: lastAssistant?.openCodeMessageId || `idx:${lastAssistantIndex}` };
    saveTodoAnchor(task.id, todoAnchor);
  }
  let todoAnchorIndex = -1;
  if (todoAnchor && hasTodoData) {
    todoAnchorIndex = String(todoAnchor.messageId || '').startsWith('idx:')
      ? Number(todoAnchor.messageId.slice(4)) || lastAssistantIndex
      : visibleMessages.findIndex(m => m?.role === 'assistant' && m.openCodeMessageId === todoAnchor.messageId);
    if (todoAnchorIndex < 0) todoAnchorIndex = lastAssistantIndex;
  }
  const todoReportHtml = todoAnchorIndex >= 0 ? renderTodoCard(task.todo, { collapsed: true }) : '';
  const planCardHtml = renderPlanConfirmCard(task);
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
  // 轮次编号：每条 assistant 回复算一轮，用于在长对话里标出边界
  let turnNumber = 0;
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
            ${renderMessageActions(task, message)}
            ${renderNativeMessageActions(task, message)}
          </div>
        </article>
      `;
    }
    const outputText = message.content || (message.error ? '本轮没有产出可显示的文本。' : '');
    turnNumber += 1;
    // 轮次分隔：第 2 轮起在回复上方画一条带编号的细分隔线，
    // 长对话里多轮内容连成一片时靠它区分边界；首轮不加，避免顶部多余装饰
    const turnDivider = turnNumber > 1
      ? `<div class="agent-turn-divider" aria-label="第 ${turnNumber} 轮"><span>第 ${turnNumber} 轮</span></div>`
      : '';
    // 计划报告卡跟随锚点消息；计划确认卡只在"最后一轮就是最新内容"时出现（出现更新对话即失效）
    const trailingCards = !running && index === lastAssistantIndex
      ? `${index === todoAnchorIndex ? todoReportHtml : ''}${index === visibleMessages.length - 1 ? planCardHtml : ''}`
      : (index === todoAnchorIndex ? todoReportHtml : '');
    return `${divider}${turnDivider}
      <article class="agent-message agent-message-agent">
        <div class="agent-message-body">
          ${renderAssistantArtifacts(message, { showEvents: index === lastAssistantIndex && !running, events: task.events })}
          ${renderMessageProcess(message)}
          ${outputText ? `<div class="agent-message-bubble agent-agent-bubble agent-markdown">${formatAgentMarkdown(outputText)}</div>` : ''}
          ${renderInlineToolImages(message)}
          ${renderFileChangesCard(message, task)}
          ${renderMessageActions(task, message)}
          ${renderNativeMessageActions(task, message)}
          ${trailingCards}
        </div>
      </article>
    `;
  }).join('');
  // 所有消息都早于压缩点：分界线追加在末尾（此前全部内容已被折叠为摘要）
  const trailingDivider = visibleMessages.length && compactBoundary >= visibleMessages.length ? compactDividerHtml : '';
  const compactingHtml = task.compacting
    ? '<div class="agent-compact-divider is-active"><span>⏳ 正在压缩上下文，稍等片刻喵...</span></div>'
    : '';
  const liveFollowUpCount = countLiveFollowUps(task);
  // 实时计划卡只在本轮存在进行中事项时显示：上一轮已全部完成的旧计划不再重复出现
  const liveTodoActive = running && (Array.isArray(task.todo) ? task.todo : []).some(item => {
    const status = normalizeTodoStatus(item?.status);
    return String(item?.content || '').trim() && status !== 'completed' && status !== 'cancelled' && status !== 'canceled';
  });
  const liveOutput = running ? `
    <article class="agent-message agent-message-agent agent-message-live">
      <div class="agent-message-body">
        ${renderAssistantArtifacts({ tools: [], elapsedMs: task.elapsedMs }, { showEvents: true, events: task.events, running: true, live: true })}
        ${task.status === 'pending' ? renderQueueCard(task, agentWorkbenchState.payload || {}) : ''}
        ${liveTodoActive ? renderTodoCard(task.todo) : ''}
        <div class="agent-message-live-bubbles">${renderLiveStepBubbles(task.liveSteps, task.status === 'pending'
          ? `任务正在排队${task.queuePosition ? `，当前位置 ${task.queuePosition}` : ''}...`
          : (task.liveStatus || 'Agent 正在准备输出...'), true, task.outputSegments)}</div>
        <div class="agent-live-progress${task.liveStatus || task.liveCommand ? '' : ' hidden'}"><span class="agent-live-progress-dot" aria-hidden="true"></span><span class="agent-live-progress-text">${escapeHtml(task.liveStatus || '')}</span><pre class="agent-live-command${task.liveCommand ? '' : ' hidden'}" data-live-command="${escapeHtml(task.liveCommand || '')}">${escapeHtml(task.liveCommand || '')}</pre></div>
        ${liveFollowUpCount > 0 ? `<div class="agent-live-followups">⚡ 本轮已并入 ${liveFollowUpCount} 条追加消息</div>` : ''}
      </div>
    </article>
  ` : '';
  target.innerHTML = `${renderZcodeGoalBanner(task)}${renderWorkflowCard(task)}${html}${trailingDivider}${compactingHtml}${liveOutput}`;
  restoreConversationDetails(target, detailState);
  upgradeMermaidCodeBlocks(target);
  applyContentSearchHighlights();
  if (agentWorkbenchState.conversationStickToBottom) scrollConversationToBottom();
  updateConversationFollowButton();
}

// 本轮执行过程：任务结束后最终回复只保留最后一段，
// 中间分段（段间通常夹着工具调用）在完成时收进这里的折叠块，
// 与 ZCode 的行为一致——最终结果出现时过程收起而不是消失。
function renderMessageProcess(message = {}) {
  const segments = (Array.isArray(message.processSegments) ? message.processSegments : [])
    .map(item => String(item || '').trim())
    .filter(Boolean);
  if (!segments.length) return '';
  // 没有最终正文时（例如任务中途失败）默认展开，保证过程内容不会被藏起来
  const open = String(message.content || '').trim() ? '' : ' open';
  const key = `process-${message.id || ''}`;
  return `<details class="agent-process-details" data-detail-key="${escapeHtml(key)}"${open}>
    <summary><span>执行过程</span><span class="agent-process-count">${segments.length} 段</span><span class="agent-work-report-chevron" aria-hidden="true">›</span></summary>
    <div class="agent-process-bodies">${segments.map(text => `<div class="agent-message-bubble agent-agent-bubble agent-markdown">${formatAgentMarkdown(text)}</div>`).join('')}</div>
  </details>`;
}

// 通用消息操作条：不依赖 OpenCode 消息 ID，ZCode 会话也能复制/重发。
// OpenCode 会话额外保留回滚/分支/删除（见 renderNativeMessageActions）。
function renderMessageActions(task = {}, message = {}) {
  if (message?.id === undefined && !message?.content) return '';
  const roles = String(message.role || '');
  const text = String(message.content || '');
  if (!text.trim()) return '';
  const isUser = roles === 'user';
  const isLive = ['running', 'pending'].includes(task.status);
  const messageId = escapeHtml(String(message.id || ''));
  return `
    <div class="agent-message-actions">
      <button type="button" class="agent-message-action" title="复制内容" aria-label="复制内容" data-message-copy="${messageId}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg><span>复制</span></button>
      ${isUser && !isLive ? `<button type="button" class="agent-message-action" title="用这条内容重新发送" aria-label="重新发送" data-message-resend="${messageId}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>重发</span></button>` : ''}
    </div>`;
}

function renderNativeMessageActions(task = {}, message = {}) {
  const messageId = String(message.openCodeMessageId || '').trim();
  if (!task.opencodeSessionId || !messageId || ['running', 'pending'].includes(task.status)) return '';
  return `
    <div class="agent-native-message-actions">
      <button type="button" class="is-checkpoint" title="回滚到这条消息之前（撤销它引发的文件改动）" aria-label="回滚检查点" data-native-message-action="revert" data-native-message-id="${escapeHtml(messageId)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg></button>
      <button type="button" title="从这里分支" aria-label="从这里分支" data-native-message-action="fork" data-native-message-id="${escapeHtml(messageId)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/></svg></button>
      <button type="button" class="is-danger" title="删除消息" aria-label="删除消息" data-native-message-action="delete-message" data-native-message-id="${escapeHtml(messageId)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>
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
  return `<div class="agent-message-attachments">${attachments.map(item => {
    // 图片附件带 data URL 时渲染缩略图（点击看原图）；超大图或非图片回退为文件芯片
    const url = /^data:image\//i.test(String(item.url || '')) ? String(item.url) : '';
    if (url) {
      return `<a class="agent-message-attachment-image" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(item.name || '图片附件')}"><img src="${escapeHtml(url)}" alt="${escapeHtml(item.name || '图片附件')}" loading="lazy" referrerpolicy="no-referrer" /></a>`;
    }
    return `<span class="agent-message-attachment"><strong>${escapeHtml(item.name || '附件')}</strong><small>${escapeHtml(item.mime || '')} · ${Math.max(1, Math.round(Number(item.size || 0) / 1024))} KB</small></span>`;
  }).join('')}</div>`;
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
    getElement('agent-resume-btn').classList.add('hidden');
    getElement('agent-zcode-session-btn')?.classList.add('hidden');
    getElement('agent-retry-btn').classList.add('hidden');
    getElement('agent-undo-btn').classList.add('hidden');
    getElement('agent-history-load-btn').classList.add('hidden');
    getElement('agent-export-btn').classList.add('hidden');
    getElement('agent-delete-btn').classList.add('hidden');
    getElement('agent-output-alert').classList.add('hidden');
    getElement('agent-use-worktree').disabled = false;
    getElement('agent-mobile-worktree').checked = false;
    renderContext(null);
    renderConversation(null);
    return;
  }
  // 只在“用户切换选中会话”时展开其所属项目；首次加载尊重本地持久化的折叠状态，
  // 手动折叠后也不会被轮询刷新反复展开
  const initialSelection = agentWorkbenchState.initialSelectionResolved !== true;
  agentWorkbenchState.initialSelectionResolved = true;
  const selectionChanged = agentWorkbenchState.selectedTaskId !== task.id;
  agentWorkbenchState.selectedTaskId = task.id;
  // 打开会话即视为已读：清掉列表里的完成圆点；后续该会话再完成一轮会重新出现
  if (markCompletedTaskSeen(task)) {
    renderTasks(agentWorkbenchState.payload || {});
  }
  // 切换选中会话时从 ZCode 会话库补一次目标/检查点/累计用量（老任务或错过事件时）
  if (selectionChanged && task.providerId === 'zcode' && task.zcodeSessionId) {
    const refreshedAt = Date.parse(task.zcodeStateRefreshedAt || '');
    if (!Number.isFinite(refreshedAt) || Date.now() - refreshedAt > 60000) {
      refreshZcodeSessionStateFromServer({ taskId: task.id, quiet: true }).catch(() => {});
    }
  }
  if (selectionChanged && !initialSelection && !isSessionSearchActive()) {
    expandWorkspaceGroupForTask(task);
    if (getElement('agent-task-list')?.querySelector('.agent-task-project')) {
      renderTasks(agentWorkbenchState.payload || {});
    }
  }
  if (agentWorkbenchState.formTaskId !== task.id) {

    if ([...getElement('agent-workspace').options].some(option => option.value === task.workspaceId)) getElement('agent-workspace').value = task.workspaceId;
    getElement('agent-mode').value = task.mode || 'analyze';
    // 切换到已有会话时同步输入区模式标签（不派发 change，避免触发确认流程）
    // 沙箱/单测可能只注入本函数，syncModeTrigger 不在作用域内时跳过
    if (typeof syncModeTrigger === 'function') syncModeTrigger();
    // 跟随所选任务同步输入框，但不写 localStorage：localStorage 只记用户显式选择，
    // 否则页面加载自动选中最近任务会用旧任务的模型配置冲掉用户偏好
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
  getElement('agent-output-meta').textContent = buildTaskMetaText(task);
  getElement('agent-resume-btn').classList.toggle('hidden', task.resumable !== true);
  // 会话控制只对 ZCode 有意义（目标/检查点/分叉与中途切换模式模型）
  const zcodeSessionButton = getElement('agent-zcode-session-btn');
  if (zcodeSessionButton) {
    zcodeSessionButton.classList.toggle('hidden', task.providerId !== 'zcode');
    zcodeSessionButton.disabled = isZcodeTaskBusy(task);
    zcodeSessionButton.title = isZcodeTaskBusy(task)
      ? '会话正在执行，完成后可设置目标或切换运行配置'
      : 'ZCode 会话控制：目标 / 检查点 / 分叉 / 模式与模型';
  }
  getElement('agent-retry-btn').classList.toggle('hidden', task.retryable !== true);
  // Git 快照回滚：仅写入档任务且有快照分支时显示（终态）
  const undoButton = getElement('agent-undo-btn');
  undoButton.classList.toggle('hidden', !task.gitSnapshotBranch || ['running', 'pending'].includes(task.status));
  undoButton.title = task.gitSnapshotBranch
    ? `把本任务改动的文件恢复为任务开始时的内容（快照分支 ${task.gitSnapshotBranch}；agent 新建的文件会被删除）`
    : '回滚改动';
  const historyButton = getElement('agent-history-load-btn');
  historyButton.classList.toggle('hidden', !task.opencodeSessionId || ['running', 'pending'].includes(task.status));
  historyButton.textContent = agentWorkbenchState.nativeHistoryByTask.has(task.id) ? '刷新完整历史' : '加载完整历史';
  getElement('agent-export-btn').classList.remove('hidden');
  getElement('agent-delete-btn').classList.toggle('hidden', ['running', 'pending'].includes(task.status));
  renderContext(task);
  renderConversation(task);
  const alert = getElement('agent-output-alert');
  if (task.resumable === true) {
    const providerLabel = task.providerLabel || (task.providerId === 'zcode' ? 'ZCode' : 'OpenCode');
    alert.textContent = `本轮任务因控制台重启或执行超时而中断，可以从原 ${providerLabel} 会话继续。`;
    alert.classList.remove('hidden');
  } else if (isWriteMode(task.mode) && task.workspaceChanged) {
    alert.textContent = `Agent 已实际修改 ${task.changedFiles?.length || 0} 个文件，请在“上下文”面板的“文件改动”中检查后再提交。`;
    alert.classList.remove('hidden');
  } else if (task.workspaceChanged) {
    alert.textContent = '只读任务意外改变了 Git 工作区，请立即人工检查。';
    alert.classList.remove('hidden');
  } else {
    alert.classList.add('hidden');
  }
}

function getWorkspaceGroupKey(task = {}) {
  return String(task.workspaceId || task.workspacePath || 'default').trim() || 'default';
}

function getWorkspaceGroupLabel(task = {}, data = {}) {
  const id = String(task.workspaceId || '').trim();
  const fromPayload = (Array.isArray(data.workspaces) ? data.workspaces : [])
    .find(item => String(item?.id || '') === id);
  // 项目重命名后以当前配置为准；配置里已删除的项目回退任务自身记录的历史名称
  if (fromPayload?.label) return String(fromPayload.label).trim();
  const explicit = String(task.workspaceLabel || '').trim();
  if (explicit) return explicit;
  return id || '默认工作区';
}

function findWorkspaceById(workspaceId = '', data = {}) {
  const id = String(workspaceId || '').trim();
  return (Array.isArray(data.workspaces) ? data.workspaces : [])
    .find(item => String(item?.id || '') === id) || null;
}

function persistCollapsedWorkspaceGroups() {
  try {
    const values = agentWorkbenchState.collapsedWorkspaceGroups instanceof Set
      ? [...agentWorkbenchState.collapsedWorkspaceGroups]
      : [];
    localStorage.setItem(COLLAPSED_WORKSPACE_GROUPS_KEY, JSON.stringify(values));
  } catch { /* 忽略隐私模式下的存储失败 */ }
}

function toggleWorkspaceGroup(key = '') {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return;
  if (!(agentWorkbenchState.collapsedWorkspaceGroups instanceof Set)) {
    agentWorkbenchState.collapsedWorkspaceGroups = new Set();
  }
  const groups = agentWorkbenchState.collapsedWorkspaceGroups;
  if (groups.has(normalizedKey)) groups.delete(normalizedKey);
  else groups.add(normalizedKey);
  persistCollapsedWorkspaceGroups();
  renderTasks(agentWorkbenchState.payload || {});
}

function isSessionSearchActive() {
  return Boolean(String(agentWorkbenchState.sessionQuery || '').trim());
}

function expandWorkspaceGroupForTask(task = {}) {
  const key = getWorkspaceGroupKey(task);
  if (!key || !(agentWorkbenchState.collapsedWorkspaceGroups instanceof Set)) return;
  if (agentWorkbenchState.collapsedWorkspaceGroups.delete(key)) persistCollapsedWorkspaceGroups();
}

// 按工作目录聚合会话；分组顺序取组内最近会话的时间顺序（后端已按更新时间倒序）。
function groupTasksByWorkspace(tasks = [], data = {}) {
  const groups = new Map();
  for (const task of tasks) {
    const key = getWorkspaceGroupKey(task);
    if (!groups.has(key)) {
      const workspace = findWorkspaceById(key, data);
      groups.set(key, {
        key,
        label: getWorkspaceGroupLabel(task, data),
        path: String(workspace?.path || task.workspacePath || ''),
        custom: workspace?.custom === true || key.startsWith('custom-'),
        tasks: [],
      });
    }
    groups.get(key).tasks.push(task);
  }
  // 没有会话的自定义项目也要显示，否则新建后看不到项目
  for (const workspace of (Array.isArray(data.workspaces) ? data.workspaces : [])) {
    if (workspace?.custom !== true || groups.has(workspace.id)) continue;
    groups.set(workspace.id, {
      key: workspace.id,
      label: String(workspace.label || workspace.id),
      path: String(workspace.path || ''),
      custom: true,
      tasks: [],
    });
  }
  return Array.from(groups.values());
}

function renderTaskListItem(task = {}, options = {}) {
  const status = getStatusMeta(task.status);
  const title = task.title || 'Agent 任务';
  const activityTime = task.updatedAt || task.createdAt;
  const relativeTime = formatCompactRelativeTime(activityTime);
  const archived = task.archived === true;
  const checked = options.selectedIds instanceof Set && options.selectedIds.has(task.id);
  const checkbox = options.managing
    ? `<input type="checkbox" class="agent-task-check" data-task-check="${escapeHtml(task.id)}" ${checked ? 'checked' : ''} aria-label="选择会话" />`
    : '';
  const archiveButton = options.managing
    ? ''
    : `<button type="button" class="agent-task-archive" data-archive-task="${escapeHtml(task.id)}" data-archive-state="${archived ? '1' : ''}" title="${archived ? '取消归档' : '归档此会话'}" aria-label="${archived ? '取消归档' : '归档此会话'}">${archived ? '取消归档' : '归档'}</button>`;
  // 会话状态指示：执行中/排队中显示转圈；已完成仅在“尚未点开”时显示小圆点，
  // 选中打开后即视为已读并隐藏（对齐未读通知语义）。
  const statusIndicator = ['running', 'pending'].includes(String(task.status || '').toLowerCase())
    ? '<span class="agent-task-state is-running" aria-label="进行中"></span>'
    : isCompletedTaskUnread(task, options.completedSeen)
      ? '<span class="agent-task-state is-done" aria-label="已完成，未查看"></span>'
      : '';
  return `
    <div class="agent-task-item ${task.id === agentWorkbenchState.selectedTaskId && !agentWorkbenchState.newSession ? 'is-selected' : ''} ${checked ? 'is-checked' : ''}" role="button" tabindex="0" data-task-id="${escapeHtml(task.id)}" title="${escapeHtml(`${title} · ${status.label} · ${formatTime(activityTime)}`)}" aria-label="${escapeHtml(`${title}，${status.label}，${relativeTime}`)}">
      ${checkbox}
      <strong class="agent-task-title">${statusIndicator}<span class="agent-task-title-text">${escapeHtml(title)}</span></strong>
      ${(Array.isArray(task.pendingQuestions) && task.pendingQuestions.length) ? `<span class="agent-task-badge is-question">待回答 ${task.pendingQuestions.length}</span>` : ''}
      ${(Array.isArray(task.pendingPermissions) && task.pendingPermissions.length) ? `<span class="agent-task-badge is-permission">待审批 ${task.pendingPermissions.length}</span>` : ''}
      <time class="agent-task-time" datetime="${escapeHtml(activityTime || '')}">${escapeHtml(relativeTime)}</time>
      ${archiveButton}
    </div>
  `;
}

const AGENT_FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';

function renderTasks(data = {}) {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const managing = agentWorkbenchState.manageMode === true;
  const selectedIds = agentWorkbenchState.selectedTaskIds instanceof Set ? agentWorkbenchState.selectedTaskIds : new Set();
  const listElement = getElement('agent-task-list');
  listElement.classList.toggle('is-managing', managing);

  const groups = groupTasksByWorkspace(tasks, data);
  const searching = Boolean(String(agentWorkbenchState.sessionQuery || '').trim());

  getElement('agent-history-meta').textContent = tasks.length
    ? (searching ? `${tasks.length} 个匹配会话` : `${groups.length} 个项目 · ${tasks.length} 个会话`)
    : (searching ? '没有匹配的会话。' : '暂无会话。');

  const completedSeen = readCompletedSeenMap();
  listElement.innerHTML = groups.length ? groups.map(group => {
    const collapsed = !searching && agentWorkbenchState.collapsedWorkspaceGroups instanceof Set
      && agentWorkbenchState.collapsedWorkspaceGroups.has(group.key);
    const activeCount = group.tasks.filter(task => ['pending', 'running'].includes(task.status)).length;
    const groupTitle = group.path ? `${group.label} · ${group.path}` : group.label;
    return `
      <section class="agent-task-project ${collapsed ? 'is-collapsed' : ''}" data-project-key="${escapeHtml(group.key)}">
        <button type="button" class="agent-task-project-head" data-project-toggle="${escapeHtml(group.key)}" aria-expanded="${collapsed ? 'false' : 'true'}" title="${escapeHtml(groupTitle)}">
          <span class="agent-task-project-caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>
          <span class="agent-task-project-icon" aria-hidden="true">${AGENT_FOLDER_ICON}</span>
          <span class="agent-task-project-name">${escapeHtml(group.label)}</span>
          ${activeCount ? `<span class="agent-task-project-dot" title="${activeCount} 个会话运行中"></span>` : ''}
          <span class="agent-task-project-count">${group.tasks.length}</span>
        </button>
        <div class="agent-task-project-actions">
          ${group.custom ? `<button type="button" class="agent-task-project-action agent-task-project-edit" data-edit-project="${escapeHtml(group.key)}" title="编辑项目" aria-label="编辑项目"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg></button>` : ''}
          <button type="button" class="agent-task-project-action agent-task-project-new" data-new-project-task="${escapeHtml(group.key)}" title="新建任务" aria-label="在 ${escapeHtml(group.label)} 中新建任务"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5A8.5 8.5 0 1 1 21 11.5Z"/><path d="M12 8v7"/><path d="M8.5 11.5h7"/></svg></button>
        </div>
        <div class="agent-task-project-items">
          ${group.tasks.map(task => renderTaskListItem(task, { managing, selectedIds, completedSeen })).join('')}
        </div>
      </section>
    `;
  }).join('') : '<div class="agent-empty"><strong>还没有会话</strong><span>发送第一条任务后，会话记录显示在这里。</span></div>';
  updateBatchBar(tasks);
  syncAttentionBadge();
  renderActiveTaskStrip(data);
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
  // 供应商跟随设置的「默认 Agent」（与提交流程一致）；停用的默认回退 OpenCode
  const requestedProvider = data.config?.defaultProvider || 'opencode';
  const providerId = data.config?.providers?.[requestedProvider] === false ? 'opencode' : requestedProvider;
  const workspaceId = getElement('agent-workspace').value || '';
  const writeMode = isWriteMode(mode);
  const fullAccess = isFullAccessMode(mode);
  const writeAllowed = data.config?.writeEnabled === true
    && (providerId === 'opencode' || providerId === 'zcode')
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
    runButton.classList.remove('is-stop');
  } else {
    const promptText = String(getElement('agent-prompt').value || '').trim();
    // 任务运行中且输入框为空：发送键变为停止键；一旦输入内容则回到「立即发送」
    const stopMode = selectedTaskRunning && !promptText && !hasPendingQuestion;
    runButton.classList.toggle('is-stop', stopMode);
    if (stopMode) {
      runButton.textContent = '停止';
      runButton.disabled = false;
    } else {
      runButton.textContent = hasPendingQuestion
        ? '提交回答'
        : (canFollowUp
          ? '立即发送'
          : (fullAccess ? '发送并执行' : (writeMode ? '发送并修改' : '发送')));
      // provider 探测在超售机上会抖动（--version 偶发超时），不再用它禁用发送键：
      // 提示文案保留警示，真正不可用时后端会给出明确错误
      runButton.disabled = canFollowUp
        ? !enabled
        : !enabled || (writeMode && !writeAllowed);
    }
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
          : writeMode && providerId !== 'opencode' && providerId !== 'zcode'
            ? '实际修改模式当前只支持内置 OpenCode / ZCode。'
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
  applySettings(data.config || {});
  renderSummary(data);
  renderProviders(data);
  renderZcodeSettingHint(data);
  renderWorkspaces(data);
  renderTasks(data);
  renderSelectedTask(data);
  updateRunState(data);
  const enabled = data.config?.enabled === true;
  const writeEnabled = data.config?.writeEnabled === true;
  const state = getElement('agent-master-state');
  state.textContent = enabled ? '已启用' : '默认关闭';
  state.className = `agent-state-badge tone-${enabled ? 'success' : 'warn'}`;
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
    // 箭头方向由 CSS 或内联 transform 控制，不改写 DOM（图标是 SVG，不能替换 textContent）
    const svg = button.querySelector('svg');
    if (svg) svg.style.transform = active ? 'rotate(180deg)' : '';
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
    const stored = window.localStorage.getItem(agentContextCollapsedStorageKey);
    // 无历史偏好时默认收起，用户手动展开后按 localStorage 记忆
    agentWorkbenchState.contextCollapsed = stored === null ? true : stored === '1';
  } catch {
    agentWorkbenchState.contextCollapsed = true;
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
    return `<details class="agent-native-item agent-native-diff-item"><summary><strong>${escapeHtml(file)}</strong><span>${renderChangeBadge(diff)}${restore}</span></summary><div class="agent-diff-output">${renderDiffText(text)}</div></details>`;
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
  const isOpenCode = !task || task.providerId === 'opencode';
  getElement('agent-native-session-title').readOnly = !isOpenCode;
  document.querySelectorAll('[data-opencode-only]').forEach(el => el.classList.toggle('hidden', !isOpenCode));
  const providerNote = getElement('agent-native-provider-note');
  if (providerNote) {
    providerNote.classList.toggle('hidden', isOpenCode);
    if (!isOpenCode) providerNote.textContent = `当前为 ${task.providerLabel || task.providerId} 会话。重命名和删除请在会话列表操作，下方 Git 工作流可用。会话分支、手动压缩、Todo、子 Agent 和原生 Diff 仅适用于 OpenCode。`;
  }
  try {
    await loadNativePayload();
    if (task && isOpenCode) await loadNativeDiff();
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

// ===== ZCode 会话控制：目标 / 检查点 / 运行模式与模型 =====
const ZCODE_GOAL_STATUS_META = {
  active: { label: '目标进行中', cls: 'is-active' },
  paused: { label: '目标已暂停', cls: 'is-paused' },
  budget_limited: { label: '目标预算耗尽', cls: 'is-warning' },
  complete: { label: '目标已完成', cls: 'is-done' },
};

function getSelectedZcodeTask() {
  if (agentWorkbenchState.newSession) return null;
  const task = getSelectedTask(agentWorkbenchState.payload || {});
  return task?.providerId === 'zcode' ? task : null;
}

function isZcodeTaskBusy(task = null) {
  return Boolean(task && ['pending', 'running'].includes(task.status));
}

function getZcodeGoalMeta(goal = null) {
  if (!goal) return { label: '未设置', cls: '' };
  return ZCODE_GOAL_STATUS_META[String(goal.status || '').toLowerCase()] || { label: '目标进行中', cls: 'is-active' };
}

function formatZcodeGoalUsage(goal = null) {
  if (!goal) return '';
  const parts = [];
  if (Number(goal.tokensUsed || 0) > 0 || (goal.tokenBudget !== null && goal.tokenBudget !== undefined)) {
    const budget = goal.tokenBudget === null || goal.tokenBudget === undefined ? '无上限' : formatTokenCount(goal.tokenBudget);
    parts.push(`Token ${formatTokenCount(goal.tokensUsed || 0)} / ${budget}`);
  }
  if (Number(goal.timeUsedSeconds || 0) > 0) parts.push(`耗时 ${formatDuration(Number(goal.timeUsedSeconds) * 1000)}`);
  return parts.join(' · ');
}

// 目标横幅固定渲染在对话顶部（随消息滚动），不占额外网格行；状态变化由 renderSelectedTask 触发重绘
function renderZcodeGoalBanner(task = null) {
  const goal = task?.zcodeGoal;
  if (!goal || task.providerId !== 'zcode') return '';
  const meta = getZcodeGoalMeta(goal);
  const usage = formatZcodeGoalUsage(goal);
  const actions = [];
  const busy = isZcodeTaskBusy(task);
  if (!busy && String(goal.status || '') === 'active') {
    actions.push('<button type="button" class="agent-mini-btn" data-zcode-goal-action="pause">暂停</button>');
  } else if (!busy && String(goal.status || '') === 'paused') {
    actions.push('<button type="button" class="agent-mini-btn" data-zcode-goal-action="resume">继续</button>');
  }
  actions.push('<button type="button" class="agent-mini-btn" data-zcode-goal-action="manage">管理</button>');
  return `
    <div class="agent-zcode-goal-banner ${meta.cls}">
      <span class="agent-zcode-goal-dot" aria-hidden="true"></span>
      <div class="agent-zcode-goal-body">
        <strong>${escapeHtml(meta.label)}</strong>
        <span title="${escapeHtml(goal.objective)}">${escapeHtml(goal.objective)}</span>
        ${usage ? `<small>${escapeHtml(usage)}</small>` : ''}
      </div>
      <div class="agent-zcode-goal-actions">${actions.join('')}</div>
    </div>`;
}

const ZCODE_WORKFLOW_STATUS_META = {
  running: { label: '运行中', cls: 'is-running' },
  success: { label: '已完成', cls: 'is-done' },
  error: { label: '失败', cls: 'is-error' },
  canceled: { label: '已停止', cls: 'is-canceled' },
  warning: { label: '部分完成', cls: 'is-warning' },
  settled: { label: '已结束', cls: 'is-done' },
};

function renderWorkflowCard(task = null) {
  const allRuns = Array.isArray(task?.workflowRuns) ? task.workflowRuns.filter(Boolean) : [];
  const runs = allRuns.slice(0, 3);
  if (!runs.length || task.providerId !== 'zcode') return '';
  const runHtml = runs.map(run => {
    const meta = ZCODE_WORKFLOW_STATUS_META[String(run.status || 'running').toLowerCase()] || ZCODE_WORKFLOW_STATUS_META.running;
    const nodes = Object.values(run.nodes && typeof run.nodes === 'object' ? run.nodes : {});
    const done = nodes.filter(node => ['success', 'completed', 'failed', 'error'].includes(String(node?.status || '').toLowerCase())).length;
    const progressText = nodes.length ? `${done}/${nodes.length} 节点` : '';
    const runLabel = String(run.runId || '').replace(/^run[_-]?/i, '').slice(0, 14) || '运行';
    const lastEvent = String(run.lastEvent || '').slice(0, 120);
    const events = (Array.isArray(run.events) ? run.events : []).slice(-8).map(event => `
      <div class="agent-workflow-event">
        <span class="agent-workflow-event-dot"></span>
        <span>${escapeHtml(String(event.message || event.type || '').slice(0, 300))}</span>
        <time>${escapeHtml(formatTime(event.at))}</time>
      </div>`).join('');
    return `
      <details class="agent-workflow-run ${meta.cls}"${meta.cls === 'is-running' ? ' open' : ''}>
        <summary>
          <span class="agent-workflow-dot" aria-hidden="true"></span>
          <strong>${escapeHtml(meta.label)}</strong>
          <code>${escapeHtml(runLabel)}</code>
          ${progressText ? `<span class="agent-workflow-progress">${escapeHtml(progressText)}</span>` : ''}
          <span class="agent-workflow-last">${escapeHtml(lastEvent)}</span>
          <span class="agent-workflow-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="agent-workflow-body">
          ${run.lastMessage ? `<div class="agent-workflow-message">${escapeHtml(String(run.lastMessage).slice(0, 500))}</div>` : ''}
          ${events ? `<div class="agent-workflow-events">${events}</div>` : '<div class="agent-workflow-empty">暂无更多事件</div>'}
        </div>
      </details>`;
  }).join('');
  return `
    <section class="agent-workflow-card">
      <div class="agent-workflow-head"><strong>动态工作流</strong><span>${allRuns.length} 个运行</span></div>
      ${runHtml}
    </section>`;
}

function getZcodeCapabilityContext() {
  const config = agentWorkbenchState.payload?.config || {};
  const selected = agentWorkbenchState.newSession ? null : getSelectedTask(agentWorkbenchState.payload || {});
  const requestedProvider = config.defaultProvider || 'opencode';
  const providerId = selected?.providerId || (config.providers?.[requestedProvider] === false ? 'opencode' : requestedProvider);
  return {
    task: selected,
    providerId,
    workspaceId: selected?.workspaceId || getElement('agent-workspace')?.value || '',
  };
}

function setZcodeCapabilityError(text = '') {
  const target = getElement('agent-capability-error');
  if (!target) return;
  target.textContent = String(text || '');
  target.classList.toggle('hidden', !text);
}

function renderZcodeCapabilities() {
  const state = agentWorkbenchState.zcodeCapabilities;
  const list = getElement('agent-capability-list');
  if (!list) return;
  const skillsTab = state.tab !== 'commands';
  for (const tab of ['skills', 'commands']) {
    const button = getElement(`agent-capability-tab-${tab}`);
    if (!button) continue;
    const active = (tab === 'skills') === skillsTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.textContent = `${tab === 'skills' ? '技能' : '命令'}（${(tab === 'skills' ? state.skills : state.commands).length}）`;
  }
  const search = getElement('agent-capability-search');
  if (search && search.value !== state.query) search.value = state.query;
  const diagnosticText = state.error
    || (state.partial
      ? `部分能力读取失败：${(Array.isArray(state.diagnostics) ? state.diagnostics : [])
        .map(item => String(item?.message || '').trim())
        .filter(Boolean)
        .slice(0, 2)
        .join('；') || '未知错误'}（可点「刷新」重试）`
      : '');
  setZcodeCapabilityError(diagnosticText);
  if (state.loading) {
    list.innerHTML = '<div class="agent-capability-empty">正在读取 ZCode 技能与命令…</div>';
    return;
  }
  const query = String(state.query || '').trim().toLowerCase();
  const items = (skillsTab ? state.skills : state.commands)
    .filter(item => {
      if (!query) return true;
      return [item.name, item.qualifiedName, item.description, item.whenToUse, item.argumentHint]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  if (!items.length) {
    const failedCurrent = skillsTab ? state.failed?.skills === true : state.failed?.commands === true;
    list.innerHTML = failedCurrent
      ? `<div class="agent-capability-empty">${skillsTab ? '技能' : '命令'}列表读取失败，请点「刷新」重试。</div>`
      : skillsTab
        ? '<div class="agent-capability-empty">未发现技能。可在工作区 <code>.zcode/skills/&lt;name&gt;/SKILL.md</code> 添加。</div>'
        : '<div class="agent-capability-empty">未发现自定义命令。可在工作区 <code>.zcode/commands/&lt;name&gt;.md</code> 添加。</div>';
    return;
  }
  list.innerHTML = items.map(item => {
    if (skillsTab) {
      const name = item.qualifiedName || item.name;
      const meta = [item.source, item.scope].filter(Boolean).join(' · ');
      return `<button type="button" class="agent-capability-item" data-capability-type="skill" data-capability-name="${escapeHtml(name)}">
        <span class="agent-capability-icon" aria-hidden="true">◇</span>
        <span class="agent-capability-main">
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(item.description || item.whenToUse || '未提供描述')}</small>
          ${meta ? `<em>${escapeHtml(meta)}</em>` : ''}
        </span>
        <span class="agent-capability-action">使用</span>
      </button>`;
    }
    const interactive = item.disableNonInteractive === true;
    const reserved = agentSlashCommandNames.has(String(item.name || '').toLowerCase());
    const blocked = interactive || reserved;
    const blockedReason = reserved ? '与工作台斜杠命令重名' : (interactive ? '仅交互模式，无头任务无法执行' : '');
    const hint = item.argumentHint ? ` ${item.argumentHint}` : '';
    return `<button type="button" class="agent-capability-item${blocked ? ' is-disabled' : ''}" data-capability-type="command" data-capability-name="${escapeHtml(item.name)}" data-capability-blocked="${blocked ? '1' : '0'}" data-capability-blocked-reason="${escapeHtml(blockedReason)}"${blocked ? ` title="${escapeHtml(blockedReason)}"` : ''}>
      <span class="agent-capability-icon" aria-hidden="true">/</span>
      <span class="agent-capability-main">
        <strong>/${escapeHtml(item.name)}${escapeHtml(hint)}</strong>
        <small>${escapeHtml(item.description || '未提供描述')}</small>
        <em>${escapeHtml([item.source, item.scope, reserved ? '命令冲突' : '', interactive ? '仅交互' : ''].filter(Boolean).join(' · '))}</em>
      </span>
      <span class="agent-capability-action">${blocked ? '不可用' : '使用'}</span>
    </button>`;
  }).join('');
}

async function loadZcodeCapabilities(options = {}) {
  const context = getZcodeCapabilityContext();
  if (context.providerId !== 'zcode') {
    setZcodeCapabilityError('当前会话不是 ZCode，技能与命令列表仅适用于 ZCode。');
    return;
  }
  const state = agentWorkbenchState.zcodeCapabilities;
  state.loading = true;
  state.error = '';
  state.diagnostics = [];
  state.failed = { skills: false, commands: false };
  state.partial = false;
  renderZcodeCapabilities();
  try {
    const query = new URLSearchParams({ workspace: context.workspaceId || '' });
    if (context.task?.id) query.set('task', context.task.id);
    if (options.force === true) query.set('force', '1');
    const result = await fetchJson(`/api/agent-workbench/zcode/capabilities?${query.toString()}`);
    state.skills = Array.isArray(result.skills) ? result.skills : [];
    state.commands = Array.isArray(result.commands) ? result.commands : [];
    state.diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
    state.failed = {
      skills: result.failed?.skills === true,
      commands: result.failed?.commands === true,
    };
    state.partial = result.partial === true;
    state.loadedKey = `${context.workspaceId}|${context.task?.id || ''}`;
    agentWorkbenchState.zcodeCommandWorkspaceKey = state.loadedKey;
    agentWorkbenchState.zcodeCommandNames = new Set(state.commands.map(item => String(item.name || '').toLowerCase()).filter(Boolean));
    agentWorkbenchState.zcodeInteractiveCommandNames = new Set(state.commands
      .filter(item => item.disableNonInteractive === true)
      .map(item => String(item.name || '').toLowerCase())
      .filter(Boolean));
  } catch (error) {
    state.error = error.message;
    state.skills = [];
    state.commands = [];
    state.diagnostics = [];
    state.failed = { skills: false, commands: false };
    state.partial = false;
  } finally {
    state.loading = false;
    renderZcodeCapabilities();
  }
}

function openZcodeCapabilities() {
  const context = getZcodeCapabilityContext();
  if (context.providerId !== 'zcode') {
    webConsoleAlert('技能与命令列表只适用于 ZCode 会话。').catch(() => {});
    return;
  }
  agentWorkbenchState.zcodeCapabilities.tab = 'skills';
  agentWorkbenchState.zcodeCapabilities.query = '';
  getElement('agent-zcode-capabilities-mask')?.classList.remove('hidden');
  loadZcodeCapabilities({ force: false }).catch(error => setZcodeCapabilityError(error.message));
}

function closeZcodeCapabilities() {
  getElement('agent-zcode-capabilities-mask')?.classList.add('hidden');
  setZcodeCapabilityError('');
}

function buildZcodeCapabilityPrompt(type = '', name = '', existing = '') {
  const commandText = type === 'skill' ? `/skill ${name}` : `/${name}`;
  const draft = String(existing || '');
  if (!draft.trim()) return `${commandText} `;
  // 控制台只识别位于开头的斜杠命令；已有命令时不要强行前缀，避免把用户的
  // /workflow、/compact 等参数拼成另一条命令的面板提示词。
  if (/^\s*\//.test(draft)) return null;
  // 保留已输入的任务描述，只把技能/命令放到最前面
  return `${commandText} ${draft.replace(/^\s+/, '')}`;
}

function insertZcodeCapability(type = '', name = '', blocked = false, blockedReason = '') {
  const capabilityName = String(name || '').trim();
  if (!capabilityName) return;
  if (type === 'command' && blocked) {
    webConsoleAlert(blockedReason || '该命令当前不可用。').catch(() => {});
    return;
  }
  const prompt = getElement('agent-prompt');
  if (!prompt) return;
  if (type !== 'skill' && type !== 'command') return;
  const nextPrompt = buildZcodeCapabilityPrompt(type, capabilityName, prompt.value);
  if (nextPrompt === null) {
    webConsoleAlert('输入框已有斜杠命令，无法直接插入技能/命令。请先清空或手动合并后再试。').catch(() => {});
    return;
  }
  prompt.value = nextPrompt;
  if (type === 'skill') {
    agentWorkbenchState.pendingZcodeCommand = '';
  } else {
    agentWorkbenchState.pendingZcodeCommand = capabilityName.toLowerCase();
  }
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  prompt.focus();
  prompt.selectionStart = prompt.value.length;
  prompt.selectionEnd = prompt.value.length;
  closeZcodeCapabilities();
  setStatus(`已插入 ${type === 'skill' ? '技能' : '命令'}：${capabilityName}，补上任务描述后发送。`);
}

function setZcodeSessionError(text = '') {
  const target = getElement('agent-zcode-session-error');
  if (!target) return;
  target.textContent = String(text || '');
}

const ZCODE_SESSION_VARIANT_VALUES = ['', 'disabled', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function syncZcodeSessionVariantCustomField() {
  const select = getElement('agent-zcode-session-variant');
  const field = getElement('agent-zcode-session-variant-custom-field');
  if (!select || !field) return;
  field.classList.toggle('hidden', select.value !== '__custom__');
}

function setZcodeSessionVariantValue(value = '') {
  const select = getElement('agent-zcode-session-variant');
  const input = getElement('agent-zcode-session-variant-custom');
  if (!select || !input) return;
  const normalized = String(value || '').trim();
  const lower = normalized.toLowerCase();
  if (['enabled', 'default', 'auto'].includes(lower)) {
    select.value = '';
    input.value = '';
  } else if (ZCODE_SESSION_VARIANT_VALUES.includes(normalized)) {
    select.value = normalized;
    input.value = '';
  } else {
    select.value = '__custom__';
    input.value = normalized;
  }
  syncZcodeSessionVariantCustomField();
}

function getZcodeSessionVariantValue() {
  const select = getElement('agent-zcode-session-variant');
  if (!select) return '';
  if (select.value === '__custom__') {
    return String(getElement('agent-zcode-session-variant-custom')?.value || '').trim();
  }
  return String(select.value || '').trim();
}

function renderZcodeProviderOptions(selected = '') {
  const select = getElement('agent-zcode-session-provider');
  if (!select) return;
  const providers = getModelProviders();
  const options = ['<option value="">跟随主对话 API</option>'];
  for (const provider of providers) {
    const name = String(provider?.name || '').trim();
    if (!name) continue;
    options.push(`<option value="${escapeHtml(customModelProviderId(name))}">${escapeHtml(name)}</option>`);
  }
  const selectedId = String(selected || '').trim();
  if (selectedId && !providers.some(provider => customModelProviderId(provider?.name || '') === selectedId)) {
    options.push(`<option value="${escapeHtml(selectedId)}">${escapeHtml(selectedId)}（配置中已不存在）</option>`);
  }
  select.innerHTML = options.join('');
  select.value = selectedId;
}

function renderZcodeSessionDialog() {
  const mask = getElement('agent-zcode-session-mask');
  if (!mask || mask.classList.contains('hidden')) return;
  const task = getSelectedZcodeTask();
  if (!task) {
    closeZcodeSessionDialog();
    return;
  }
  const noSession = !task.zcodeSessionId;
  const busy = isZcodeTaskBusy(task) || agentWorkbenchState.zcodeSessionBusy || noSession;
  const subtitle = getElement('agent-zcode-session-subtitle');
  if (subtitle) {
    subtitle.textContent = noSession
      ? '该会话还没有可控制的 ZCode 上下文，请先完成一轮对话。'
      : busy
        ? '会话正在执行，等待本轮结束后才能修改目标或运行配置。'
        : '目标、检查点与运行模式；运行配置从下一轮消息开始生效。';
  }
  const goal = task.zcodeGoal || null;
  const goalMeta = getZcodeGoalMeta(goal);
  const goalStatus = getElement('agent-zcode-goal-status');
  if (goalStatus) {
    goalStatus.textContent = goalMeta.label;
    goalStatus.className = `agent-zcode-session-tag ${goalMeta.cls}`;
  }
  const goalInput = getElement('agent-zcode-goal-input');
  if (goalInput) {
    goalInput.value = goal?.objective || '';
    goalInput.disabled = busy;
  }
  const goalUsage = getElement('agent-zcode-goal-usage');
  if (goalUsage) {
    const usage = formatZcodeGoalUsage(goal);
    goalUsage.textContent = usage
      ? `${usage}。设置目标后 ZCode 会自动继续执行，直到完成、预算耗尽或手动暂停。`
      : '设置目标后 ZCode 会自动继续执行，直到完成、预算耗尽或手动暂停；只读模式只记录目标，不自动执行。';
  }
  const sessionUsageEl = getElement('agent-zcode-session-usage');
  if (sessionUsageEl) {
    const sessionUsage = task.zcodeSessionUsage;
    const total = Number(sessionUsage?.total || 0) || (Number(sessionUsage?.input || 0) + Number(sessionUsage?.output || 0));
    const usageText = sessionUsage?.turns
      ? `会话累计：${formatTokenCount(total)} Token · ${sessionUsage.turns} 轮${sessionUsage.toolCalls ? ` · 工具 ${sessionUsage.toolCalls} 次` : ''}`
      : '';
    sessionUsageEl.textContent = usageText;
    sessionUsageEl.classList.toggle('hidden', !usageText);
  }
  getElement('agent-zcode-goal-save')?.classList.toggle('hidden', busy);
  getElement('agent-zcode-goal-save')?.toggleAttribute('disabled', busy);
  const showPause = !busy && String(goal?.status || '') === 'active';
  const showResume = !busy && String(goal?.status || '') === 'paused';
  getElement('agent-zcode-goal-pause')?.classList.toggle('hidden', !showPause);
  getElement('agent-zcode-goal-resume')?.classList.toggle('hidden', !showResume);
  getElement('agent-zcode-goal-clear')?.classList.toggle('hidden', !goal || busy);

  const checkpoints = Array.isArray(task.zcodeCheckpoints) ? task.zcodeCheckpoints : [];
  const checkpointCount = getElement('agent-zcode-checkpoint-count');
  if (checkpointCount) checkpointCount.textContent = `${checkpoints.length} 个`;
  const select = getElement('agent-zcode-checkpoint-select');
  if (select) {
    const previous = select.value;
    select.innerHTML = [
      '<option value="latest">最新检查点</option>',
      ...checkpoints.map(checkpoint => {
        const shortId = String(checkpoint.id || '').replace(/^checkpoint_/, '').slice(0, 12);
        const time = checkpoint.createdAt ? formatTime(checkpoint.createdAt) : '';
        return `<option value="${escapeHtml(checkpoint.id)}">${escapeHtml(`${shortId} · ${checkpoint.fileCount || 0} 文件${time ? ` · ${time}` : ''}`)}</option>`;
      }),
    ].join('');
    select.value = checkpoints.some(item => item.id === previous) ? previous : 'latest';
    select.disabled = busy;
  }
  for (const id of ['agent-zcode-rewind-btn', 'agent-zcode-fork-btn']) {
    const button = getElement(id);
    if (button) button.disabled = busy;
  }
  const checkpointHint = getElement('agent-zcode-checkpoint-hint');
  if (checkpointHint) {
    const history = [];
    if (task.lastRewindAt) history.push(`上次回退 ${formatTime(task.lastRewindAt)}`);
    if (task.lastForkAt) history.push(`上次分叉 ${formatTime(task.lastForkAt)}`);
    checkpointHint.textContent = [
      '回退会用检查点覆盖工作区文件；分叉会新建会话并恢复检查点文件，父会话保持不变。',
      history.length ? `（${history.join(' · ')}）` : '',
    ].join('');
  }

  const modeSelect = getElement('agent-zcode-session-mode');
  if (modeSelect) {
    modeSelect.value = task.mode || 'analyze';
    modeSelect.disabled = busy;
  }
  renderZcodeProviderOptions(task.modelProviderId || '');
  const modelInput = getElement('agent-zcode-session-model');
  if (modelInput) {
    modelInput.value = task.model || '';
    modelInput.disabled = busy;
  }
  const variantSelect = getElement('agent-zcode-session-variant');
  if (variantSelect) {
    setZcodeSessionVariantValue(task.variant || '');
    variantSelect.disabled = busy;
  }
  const variantCustom = getElement('agent-zcode-session-variant-custom');
  if (variantCustom) variantCustom.disabled = busy;
  getElement('agent-zcode-session-save')?.toggleAttribute('disabled', busy);
}

function openZcodeSessionDialog() {
  const task = getSelectedZcodeTask();
  if (!task) {
    webConsoleAlert('请先选择一个 ZCode 会话。').catch(() => {});
    return;
  }
  setZcodeSessionError('');
  getElement('agent-zcode-session-mask')?.classList.remove('hidden');
  renderZcodeSessionDialog();
  getElement('agent-zcode-goal-input')?.focus();
}

function closeZcodeSessionDialog() {
  getElement('agent-zcode-session-mask')?.classList.add('hidden');
  setZcodeSessionError('');
}

async function setZcodeSessionBusy(busy, label = '处理中…') {
  agentWorkbenchState.zcodeSessionBusy = busy === true;
  const saveButton = getElement('agent-zcode-session-save');
  if (saveButton) setButtonBusy('agent-zcode-session-save', agentWorkbenchState.zcodeSessionBusy, '应用运行配置', label);
  renderZcodeSessionDialog();
}

async function submitZcodeGoal(action = 'set', objective = '') {
  const task = getSelectedZcodeTask();
  if (!task?.id) return false;
  if (isZcodeTaskBusy(task)) {
    await webConsoleAlert('会话正在执行，请等待本轮完成后再设置目标。');
    return false;
  }
  const normalizedAction = String(action || 'set').trim().toLowerCase();
  if (normalizedAction === 'set' || normalizedAction === 'replace') {
    const text = String(objective || getElement('agent-zcode-goal-input')?.value || '').trim();
    if (text.length < 2) {
      setZcodeSessionError('请输入至少 2 个字符的会话目标。');
      return false;
    }
    const confirmed = await webConsoleConfirm([
      `将把「${text.slice(0, 120)}${text.length > 120 ? '…' : ''}」设为该会话目标。`,
      isWriteMode(task.mode)
        ? 'ZCode 会按当前写入权限自动继续执行；设置后可在会话控制里暂停或清除。'
        : '当前是只读模式，ZCode 只记录目标，不会自动执行。',
      '',
      '是否继续？',
    ].join('\n'), { title: '设置会话目标', confirmText: '设置目标' });
    if (!confirmed) return false;
    objective = text;
  } else if (normalizedAction === 'clear') {
    const confirmed = await webConsoleConfirm('确定清除当前会话目标吗？已完成的目标记录也会从会话中移除。', {
      title: '清除会话目标', confirmText: '清除目标',
    });
    if (!confirmed) return false;
  }
  await setZcodeSessionBusy(true, normalizedAction === 'set' || normalizedAction === 'replace' ? '设置中…' : '处理中…');
  try {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/goal`, {
      action: normalizedAction,
      objective: normalizedAction === 'set' || normalizedAction === 'replace' ? objective : '',
      confirmed: true,
    });
    if (result.task) mergeStreamTask(result.task);
    closeZcodeSessionDialog();
    setStatus(normalizedAction === 'set' || normalizedAction === 'replace' ? '会话目标已设置，ZCode 将自动继续执行。' : '会话目标状态已更新。');
    return true;
  } catch (error) {
    setZcodeSessionError(error.message);
    await webConsoleAlert(error.message);
    return false;
  } finally {
    await setZcodeSessionBusy(false);
  }
}

async function submitZcodeCheckpoint(action = '', checkpointOverride = '') {
  const task = getSelectedZcodeTask();
  if (!task?.id) return false;
  if (isZcodeTaskBusy(task)) {
    await webConsoleAlert('会话正在执行，请等待本轮完成后再操作检查点。');
    return false;
  }
  const actionName = String(action || '').toLowerCase();
  if (!['rewind', 'fork'].includes(actionName)) return false;
  const checkpointId = String(checkpointOverride || '').trim()
    || getElement('agent-zcode-checkpoint-select')?.value
    || 'latest';
  const targetLabel = checkpointId === 'latest' ? '最新检查点' : checkpointId;
  const confirmed = await webConsoleConfirm(actionName === 'rewind'
    ? [
      `将把工作区文件恢复到 ${targetLabel}。`,
      '检查点之后对文件的修改会丢失；会话历史是否同步回退由 ZCode 的检查点策略决定。',
      '',
      '是否继续？',
    ].join('\n')
    : [
      `将新建一个会话，并从 ${targetLabel} 恢复工作区文件。`,
      '父会话与当前工作区会先被恢复到该检查点；请确认没有未保存的重要改动。',
      '',
      '是否继续？',
    ].join('\n'), {
    title: actionName === 'rewind' ? '回退工作区检查点' : '分叉 ZCode 会话',
    confirmText: actionName === 'rewind' ? '回退到此处' : '从此刻分叉',
  });
  if (!confirmed) return false;
  await setZcodeSessionBusy(true, actionName === 'rewind' ? '回退中…' : '分叉中…');
  try {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/checkpoint`, {
      action: actionName,
      checkpointId,
      confirmed: true,
    });
    if (result.task) mergeStreamTask(result.task);
    closeZcodeSessionDialog();
    setStatus(actionName === 'rewind' ? '已开始回退工作区，结果会显示在会话中。' : '已开始分叉会话，完成后会自动打开新会话。');
    return true;
  } catch (error) {
    setZcodeSessionError(error.message);
    await webConsoleAlert(error.message);
    return false;
  } finally {
    await setZcodeSessionBusy(false);
  }
}

async function saveZcodeSessionConfig() {
  const task = getSelectedZcodeTask();
  if (!task?.id) return false;
  if (isZcodeTaskBusy(task)) {
    await webConsoleAlert('会话正在执行，请等待本轮完成后再切换模式或模型。');
    return false;
  }
  const mode = String(getElement('agent-zcode-session-mode')?.value || 'analyze');
  const model = String(getElement('agent-zcode-session-model')?.value || '').trim();
  const modelProviderId = String(getElement('agent-zcode-session-provider')?.value || '').trim();
  const variant = getZcodeSessionVariantValue();
  if (getElement('agent-zcode-session-variant')?.value === '__custom__' && !variant) {
    setZcodeSessionError('请输入自定义思考强度。');
    return false;
  }
  if (model && !/^[A-Za-z0-9._:/-]{1,160}$/.test(model)) {
    setZcodeSessionError('模型名称只能包含字母、数字、点、斜杠、冒号、下划线和短横线。');
    return false;
  }
  if (variant && !/^[A-Za-z0-9._:/-]{1,80}$/.test(variant) && !/^\d{1,9}$/.test(variant)) {
    setZcodeSessionError('思考档位只能包含字母、数字、点、斜杠、冒号、下划线和短横线，或填 thinking 预算数字。');
    return false;
  }
  let writeConfirmed = task.writeConfirmed === true;
  if (isWriteMode(mode) && !writeConfirmed) {
    const confirmed = await webConsoleConfirm([
      `将把该会话切换为「${getModeLabel(mode)}」模式，从下一轮消息开始生效。`,
      '请确认已备份需要保留的文件，并了解 Agent 会直接修改工作目录中的文件。',
      ...(isFullAccessMode(mode)
        ? ['完全访问还会允许联网、访问工作目录外文件，并直接执行终端命令。']
        : []),
      '',
      '是否继续？',
    ].join('\n'), { title: '切换写入模式', confirmText: '已备份并允许写入' });
    if (!confirmed) return false;
    writeConfirmed = true;
  }
  await setZcodeSessionBusy(true, '保存中…');
  try {
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(task.id)}/session/config`, {
      mode,
      model,
      modelProviderId,
      variant,
      writeConfirmed,
    });
    if (result.task) {
      mergeStreamTask(result.task);
      // 任务记录已换成新配置：让输入区下次渲染时重新同步模式/模型，避免旧值在下一条消息里覆盖回来
      agentWorkbenchState.formTaskId = '';
    }
    closeZcodeSessionDialog();
    setStatus(`会话运行配置已更新为${getModeLabel(mode)}${model ? ` · ${model}` : ''}，下一轮消息生效。`);
    return true;
  } catch (error) {
    setZcodeSessionError(error.message);
    await webConsoleAlert(error.message);
    return false;
  } finally {
    await setZcodeSessionBusy(false);
  }
}

async function refreshZcodeSessionStateFromServer(options = {}) {
  const taskId = String(options.taskId || getSelectedZcodeTask()?.id || '').trim();
  if (!taskId) return false;
  if (agentWorkbenchState.zcodeStateRefreshing.has(taskId)) return false;
  agentWorkbenchState.zcodeStateRefreshing.add(taskId);
  const button = getElement('agent-zcode-session-refresh');
  if (!options.quiet && button) setButtonBusy('agent-zcode-session-refresh', true, '刷新', '刷新中...');
  try {
    // 主动刷新用 POST：会更新任务索引；GET 仍保留给旧页面，只读不落库
    const result = await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(taskId)}/zcode-state`, {});
    if (result.task) mergeStreamTask(result.task);
    if (!result.refreshed) {
      if (!options.quiet) setStatus(result.reason || '会话库暂不可读。', 'warn');
      return false;
    }
    if (getElement('agent-zcode-session-mask') && !getElement('agent-zcode-session-mask').classList.contains('hidden')) {
      renderZcodeSessionDialog();
    }
    if (!options.quiet) setStatus('已从 ZCode 会话库刷新目标、检查点与累计用量。');
    return true;
  } catch (error) {
    if (!options.quiet) setZcodeSessionError(error.message);
    return false;
  } finally {
    agentWorkbenchState.zcodeStateRefreshing.delete(taskId);
    if (!options.quiet && button) setButtonBusy('agent-zcode-session-refresh', false, '刷新', '刷新中...');
  }
}

function handleZcodeGoalBannerAction(action = '') {
  const normalized = String(action || '').trim();
  if (!normalized) return;
  if (normalized === 'manage') {
    openZcodeSessionDialog();
    return;
  }
  submitZcodeGoal(normalized).catch(error => webConsoleAlert(error.message));
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
    const instructions = String(options.instructions ?? options.title ?? '').trim();
    if (instructions) payload.instructions = instructions.slice(0, 3000);
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
    // 检查点回滚：优先用消息旁指定的检查点，未指定时回滚到最后一轮助手消息
    const messageId = String(options.messageId || '').trim()
      || [...(task.messages || [])].reverse().find(item => item.role === 'assistant' && item.openCodeMessageId)?.openCodeMessageId
      || '';
    if (!messageId) {
      await webConsoleAlert('当前会话没有可撤销的消息。');
      return false;
    }
    if (!await webConsoleConfirm('回滚到这条消息之前？它引发的文件改动会被撤销，之后轮次的改动也会一并回退（可用能力中心的「恢复撤销」找回）。', {
      title: '回滚检查点', confirmText: '回滚到此处',
    })) return false;
    payload.messageId = messageId;
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
    '将关闭本插件启动的所有 OpenCode 后台服务，断开终端连接，并取消正在运行或排队的 OpenCode Agent 任务（ZCode 任务为一次性子进程，不受影响）。不会影响其他插件或系统进程。是否继续？',
    { title: '关闭服务', confirmText: '关闭服务' },
  );
  if (!confirmed) return;
  setButtonBusy('agent-close-opencode-btn', true, '关闭服务', '关闭中...');
  try {
    const result = await postJson('/api/agent-workbench/opencode/close', { confirmed: true });
    const terminalText = result.closedTerminalCount ? `，已断开 ${result.closedTerminalCount} 个终端` : '';
    setStatus(`${result.message || '服务已关闭'}${terminalText}`);
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(`关闭服务失败：${error.message}`);
  } finally {
    setButtonBusy('agent-close-opencode-btn', false, '关闭服务', '关闭中...');
  }
}

async function cleanupZcodeState() {
  const confirmed = await webConsoleConfirm(
    '将删除全部 ZCode 会话状态目录：任务记录与输出保留，但旧任务无法再续接上下文（追问会当作新会话）。ZCode 运行时与配置不受影响。是否继续？',
    { title: '清理 ZCode 会话缓存', confirmText: '清理' },
  );
  if (!confirmed) return;
  setButtonBusy('agent-zcode-cleanup-btn', true, '清理会话状态', '清理中...');
  try {
    const result = await postJson('/api/agent-workbench/zcode/cleanup-state', { confirmed: true });
    setStatus(result.message || `已清理 ${result.removedCount} 个状态目录`);
    await webConsoleAlert(result.message || `已清理 ${result.removedCount} 个状态目录`);
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(`清理失败：${error.message}`);
  } finally {
    setButtonBusy('agent-zcode-cleanup-btn', false, '清理会话状态', '清理中...');
  }
}

async function refreshAgentWorkbench(options = {}) {
  const buildQuery = () => {
    const query = new URLSearchParams();
    if (agentWorkbenchState.selectedTaskId && !agentWorkbenchState.newSession) query.set('task', agentWorkbenchState.selectedTaskId);
    if (agentWorkbenchState.sessionQuery) query.set('q', agentWorkbenchState.sessionQuery);
    if (agentWorkbenchState.includeArchived) query.set('archived', '1');
    return query;
  };
  if (agentWorkbenchState.refreshing) {
    if (options.force || buildQuery().toString() !== agentWorkbenchState.refreshQuery) {
      agentWorkbenchState.refreshPending = {
        force: options.force === true || agentWorkbenchState.refreshPending?.force === true,
        quiet: options.quiet === true && agentWorkbenchState.refreshPending?.quiet !== false,
      };
    }
    return agentWorkbenchState.refreshPromise;
  }
  agentWorkbenchState.refreshing = true;
  agentWorkbenchState.refreshPromise = (async () => {
    let nextOptions = options;
    let result;
    try {
      do {
        agentWorkbenchState.refreshPending = null;
        const query = buildQuery();
        agentWorkbenchState.refreshQuery = query.toString();
        if (nextOptions.force) query.set('force', '1');
        if (!nextOptions.quiet) setButtonBusy('agent-refresh-btn', true, '刷新状态', '刷新中...');
        try {
          result = await fetchJson(`/api/agent-workbench${query.size ? `?${query.toString()}` : ''}`);
          if (buildQuery().toString() === agentWorkbenchState.refreshQuery) {
            if (!agentWorkbenchState.refreshPending?.force) agentWorkbenchState.refreshPending = null;
            renderPayload(result);
            agentWorkbenchState.lastFullRefreshAt = Date.now();
          } else if (!agentWorkbenchState.refreshPending) {
            agentWorkbenchState.refreshPending = { quiet: true };
          }
        } catch (error) {
          if (!agentWorkbenchState.refreshPending) throw error;
        }
        nextOptions = agentWorkbenchState.refreshPending;
      } while (nextOptions);
      return result;
    } catch (error) {
      setStatus(`加载失败：${error.message}`, 'error');
      throw error;
    } finally {
      agentWorkbenchState.refreshing = false;
      agentWorkbenchState.refreshPromise = null;
      agentWorkbenchState.refreshPending = null;
      setButtonBusy('agent-refresh-btn', false, '刷新状态', '刷新中...');
    }
  })();
  return agentWorkbenchState.refreshPromise;
}

// ===== ZCode MCP 服务器结构化编辑 =====
function mcpServerEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const servers = value.mcpServers && typeof value.mcpServers === 'object' && !Array.isArray(value.mcpServers)
    ? value.mcpServers
    : value;
  return Object.entries(servers)
    .filter(([name, config]) => name && config && typeof config === 'object' && !Array.isArray(config))
    .map(([name, config]) => ({ name, config }));
}

function parseMcpServerText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MCP 配置不是有效 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP 配置必须是 JSON 对象');
  }
  return mcpServerEntries(parsed);
}

function serializeMcpServers(list = []) {
  // 用无原型对象，避免服务器名/env 键为 __proto__ 时污染原型链
  const servers = Object.create(null);
  for (const item of Array.isArray(list) ? list : []) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    servers[name] = item?.config && typeof item.config === 'object' ? item.config : {};
  }
  return Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }, null, 2) : '';
}

function setMcpError(text = '') {
  const target = getElement('agent-mcp-error');
  if (!target) return;
  target.textContent = String(text || '');
  target.classList.toggle('hidden', !text);
}

function renderZcodeMcpSummary() {
  const summary = getElement('agent-zcode-mcp-summary');
  const button = getElement('agent-zcode-mcp-manage');
  let list = [];
  let error = '';
  try {
    list = parseMcpServerText(getElement('agent-zcode-mcp')?.value || '');
  } catch (parseError) {
    error = parseError.message;
  }
  if (summary) {
    summary.textContent = error
      ? '配置有误，请打开管理修正'
      : list.length ? `${list.length} 个：${list.map(item => item.name).join('、')}` : '未配置';
    summary.title = error || list.map(item => item.name).join('、');
  }
  if (button) button.textContent = list.length || error ? '管理' : '添加';
}

function updateMcpTypeFields() {
  const type = String(getElement('agent-mcp-type')?.value || 'stdio').toLowerCase();
  const stdio = type === 'stdio';
  for (const id of ['agent-mcp-command-row', 'agent-mcp-args-row', 'agent-mcp-env-row']) {
    getElement(id)?.classList.toggle('hidden', !stdio);
  }
  for (const id of ['agent-mcp-url-row', 'agent-mcp-headers-row']) {
    getElement(id)?.classList.toggle('hidden', stdio);
  }
}

function resetMcpEditor() {
  agentWorkbenchState.mcpEditingIndex = -1;
  agentWorkbenchState.mcpEditingOriginal = null;
  const editor = getElement('agent-mcp-editor');
  if (editor) editor.classList.add('hidden');
  for (const id of ['agent-mcp-name', 'agent-mcp-command', 'agent-mcp-args', 'agent-mcp-env', 'agent-mcp-url', 'agent-mcp-headers']) {
    const field = getElement(id);
    if (field) field.value = '';
  }
  const type = getElement('agent-mcp-type');
  if (type) type.value = 'stdio';
  updateMcpTypeFields();
  setMcpError('');
}

function startMcpEdit(index = -1) {
  const items = Array.isArray(agentWorkbenchState.mcpDraft) ? agentWorkbenchState.mcpDraft : [];
  const item = index >= 0 ? items[index] : null;
  if (index >= 0 && !item) return;
  agentWorkbenchState.mcpEditingIndex = index;
  agentWorkbenchState.mcpEditingOriginal = item?.config ? JSON.parse(JSON.stringify(item.config)) : null;
  const config = item?.config || {};
  const type = String(config.type || (config.url ? 'http' : 'stdio')).toLowerCase();
  getElement('agent-mcp-name').value = item?.name || '';
  getElement('agent-mcp-type').value = ['stdio', 'sse', 'http'].includes(type) ? type : 'stdio';
  getElement('agent-mcp-command').value = String(config.command || '');
  getElement('agent-mcp-args').value = Array.isArray(config.args) ? config.args.map(itemArg => String(itemArg)).join('\n') : '';
  getElement('agent-mcp-env').value = Object.entries(config.env && typeof config.env === 'object' ? config.env : {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  getElement('agent-mcp-url').value = String(config.url || '');
  getElement('agent-mcp-headers').value = Object.entries(config.headers && typeof config.headers === 'object' ? config.headers : {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  getElement('agent-mcp-editor-title').textContent = index >= 0 ? '编辑服务器' : '添加服务器';
  const editor = getElement('agent-mcp-editor');
  editor?.classList.remove('hidden');
  updateMcpTypeFields();
  setMcpError('');
  editor?.scrollIntoView?.({ block: 'nearest' });
}

function renderMcpDraftList() {
  const items = Array.isArray(agentWorkbenchState.mcpDraft) ? agentWorkbenchState.mcpDraft : [];
  const count = getElement('agent-mcp-count');
  if (count) count.textContent = `${items.length} 个服务器`;
  const list = getElement('agent-mcp-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div class="agent-mcp-empty">还没有 MCP 服务器。点右上角「添加服务器」配置一个。</div>';
    return;
  }
  list.innerHTML = items.map((item, index) => {
    const config = item.config || {};
    const type = String(config.type || (config.url ? 'http' : 'stdio')).toLowerCase();
    const target = type === 'stdio'
      ? [config.command, ...(Array.isArray(config.args) ? config.args : [])].filter(Boolean).join(' ')
      : String(config.url || '');
    return `<div class="agent-mcp-row">
      <div class="agent-mcp-row-main">
        <strong>${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(type)}${target ? ` · ${escapeHtml(target.slice(0, 180))}` : ''}</small>
      </div>
      <div class="agent-mcp-row-actions">
        <button type="button" class="agent-mini-btn" data-mcp-edit="${index}">编辑</button>
        <button type="button" class="agent-mini-btn agent-mcp-delete" data-mcp-delete="${index}">删除</button>
      </div>
    </div>`;
  }).join('');
}

function parseMcpKeyValueLines(value = '', separator = '=') {
  const result = Object.create(null);
  for (const rawLine of String(value || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const index = line.indexOf(separator);
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const itemValue = line.slice(index + separator.length).trim();
    if (key) result[key] = itemValue;
  }
  return result;
}

function saveMcpEditor() {
  const name = String(getElement('agent-mcp-name')?.value || '').trim();
  if (!name) {
    setMcpError('请输入服务器名称。');
    return false;
  }
  if (!/^[^\u0000-\u001f]{1,80}$/.test(name)) {
    setMcpError('服务器名称不能包含控制字符，且最长 80 个字符。');
    return false;
  }
  if (['__proto__', 'prototype', 'constructor'].includes(name.toLowerCase())) {
    setMcpError(`服务器名称“${name}”不可用。`);
    return false;
  }
  const index = agentWorkbenchState.mcpEditingIndex;
  const items = Array.isArray(agentWorkbenchState.mcpDraft) ? agentWorkbenchState.mcpDraft : [];
  if (items.some((item, itemIndex) => itemIndex !== index && item.name === name)) {
    setMcpError(`服务器名称“${name}”已存在。`);
    return false;
  }
  const type = String(getElement('agent-mcp-type')?.value || 'stdio').toLowerCase();
  const config = agentWorkbenchState.mcpEditingOriginal ? { ...agentWorkbenchState.mcpEditingOriginal } : {};
  config.type = type;
  if (type === 'stdio') {
    const command = String(getElement('agent-mcp-command')?.value || '').trim();
    if (!command) {
      setMcpError('stdio 服务器需要填写命令，例如 npx。');
      return false;
    }
    config.command = command;
    const args = String(getElement('agent-mcp-args')?.value || '')
      .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (args.length) config.args = args; else delete config.args;
    const env = parseMcpKeyValueLines(getElement('agent-mcp-env')?.value || '', '=');
    if (Object.keys(env).length) config.env = env; else delete config.env;
    delete config.url;
    delete config.headers;
  } else {
    const url = String(getElement('agent-mcp-url')?.value || '').trim();
    if (!url) {
      setMcpError(`${type} 服务器需要填写 URL。`);
      return false;
    }
    config.url = url;
    const headers = parseMcpKeyValueLines(getElement('agent-mcp-headers')?.value || '', ':');
    if (Object.keys(headers).length) config.headers = headers; else delete config.headers;
    delete config.command;
    delete config.args;
    delete config.env;
  }
  if (index >= 0) items[index] = { name, config };
  else items.push({ name, config });
  agentWorkbenchState.mcpDraft = items;
  const raw = getElement('agent-mcp-raw');
  if (raw) raw.value = serializeMcpServers(items);
  resetMcpEditor();
  renderMcpDraftList();
  return true;
}

function applyMcpRawJson() {
  const raw = String(getElement('agent-mcp-raw')?.value || '');
  try {
    agentWorkbenchState.mcpDraft = parseMcpServerText(raw);
    renderMcpDraftList();
    setMcpError('');
    if (!raw.trim()) getElement('agent-mcp-raw').value = '';
    return true;
  } catch (error) {
    setMcpError(error.message);
    return false;
  }
}

function formatMcpRawJson() {
  try {
    const items = parseMcpServerText(getElement('agent-mcp-raw')?.value || '');
    agentWorkbenchState.mcpDraft = items;
    getElement('agent-mcp-raw').value = serializeMcpServers(items);
    renderMcpDraftList();
    setMcpError('');
  } catch (error) {
    setMcpError(error.message);
  }
}

function openMcpManager() {
  const text = String(getElement('agent-zcode-mcp')?.value || '');
  resetMcpEditor();
  try {
    agentWorkbenchState.mcpDraft = parseMcpServerText(text);
  } catch (error) {
    agentWorkbenchState.mcpDraft = [];
    setMcpError(error.message);
  }
  const raw = getElement('agent-mcp-raw');
  if (raw) raw.value = text;
  renderMcpDraftList();
  getElement('agent-mcp-mask')?.classList.remove('hidden');
}

function closeMcpManager() {
  getElement('agent-mcp-mask')?.classList.add('hidden');
  setMcpError('');
}

function saveMcpManager() {
  if (!getElement('agent-mcp-editor')?.classList.contains('hidden')) {
    if (!saveMcpEditor()) return false;
  }
  const rawText = String(getElement('agent-mcp-raw')?.value || '').trim();
  if (rawText !== serializeMcpServers(agentWorkbenchState.mcpDraft).trim()) {
    if (!applyMcpRawJson()) return false;
  }
  const serialized = serializeMcpServers(agentWorkbenchState.mcpDraft);
  if (serialized.length > 20000) {
    setMcpError('MCP 配置超过 20000 字符，请减少服务器或精简参数。');
    return false;
  }
  const target = getElement('agent-zcode-mcp');
  if (target) {
    target.value = serialized;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closeMcpManager();
  renderZcodeMcpSummary();
  setStatus(serialized ? 'MCP 服务器已更新，保存 Agent 设置后生效。' : '已清空 MCP 服务器，保存 Agent 设置后生效。');
  return true;
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
    // 自定义 API 已从设置界面下线：草稿不带 customApi，后端按“未变更”保留现有配置
    nativeConfig,
    timeoutMs: Number(getElement('agent-timeout-ms').value || 1800000),
    maxConcurrentTasks: Number(getElement('agent-max-concurrent').value || 1),
    maxOpenCodeRuntimes: Number(getElement('agent-max-runtimes').value || 2),
    zcodeMaxConcurrent: Number(getElement('agent-zcode-max-concurrent').value || 1),
    zcodeInstructions: getElement('agent-zcode-instructions').value || '',
    zcodeMcpServers: getElement('agent-zcode-mcp').value || '',
    zcodeEnableWorkflow: getElement('agent-zcode-enable-workflow').checked === true,
    customWorkspaces: String(getElement('agent-custom-workspaces').value || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const sep = line.indexOf('|');
        if (sep < 0) return { name: '', directory: line };
        return { name: line.slice(0, sep).trim(), directory: line.slice(sep + 1).trim() };
      }),
    runtimeIdleTimeoutMs: Number(getElement('agent-runtime-idle').value || 120000),
    httpProxy: String(getElement('agent-http-proxy').value || '').trim(),
    manualContextLimit: Number(getElement('agent-manual-context-limit').value || 0),
    autoCompactEnabled: getElement('agent-auto-compact-enabled').checked === true,
    autoCompactThreshold: Number(getElement('agent-auto-compact-threshold').value || 80),
    compactModel: getElement('agent-compact-model').value || '',
    compactProviderId: getElement('agent-compact-provider').value || '',
    providers: {
      opencode: getElement('agent-provider-opencode').checked === true,
      zcode: getElement('agent-provider-zcode').checked === true,
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
    if (draft.httpProxy && !/^https?:\/\/[^\s]+$/i.test(draft.httpProxy)) {
      throw new Error('HTTP 代理需要以 http:// 或 https:// 开头，例如 http://127.0.0.1:7890');
    }
    if (String(draft.zcodeMcpServers || '').length > 20000) {
      throw new Error('MCP 服务器配置超过 20000 字符，请打开管理精简后再保存');
    }
    try {
      parseMcpServerText(draft.zcodeMcpServers);
    } catch {
      throw new Error('MCP 服务器配置不是有效 JSON，请打开「MCP 服务器 → 管理」修正后再保存');
    }
    // 常规设置表单不编辑渠道，但必须带上现有列表，防止 “保存设置” 把已添加的渠道和模型清空
    draft.modelProviders = getModelProviders();
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
  if (!match) return null;
  // 输入框里的 /abc 直接作为关键词；只键入 "/" 时改用菜单搜索框的内容
  const typed = match[1] || '';
  const search = String(agentWorkbenchState.slashSearchQuery || '').trim();
  return typed || search;
}

function closeSlashMenu() {
  agentWorkbenchState.slashMenuOpen = false;
  agentWorkbenchState.slashActiveIndex = 0;
  agentWorkbenchState.slashVisibleCommands = [];
  agentWorkbenchState.slashSearchQuery = '';
  const searchInput = getElement('agent-slash-search-input');
  if (searchInput) searchInput.value = '';
  getElement('agent-slash-menu')?.classList.add('hidden');
  getElement('agent-plus-btn')?.setAttribute('aria-expanded', 'false');
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
      // 组内按名称排序；组顺序由渲染时的 groupOrder 决定
      return left.name.localeCompare(right.name);
    });
  if (!options.keepSelection) agentWorkbenchState.slashActiveIndex = 0;
  agentWorkbenchState.slashActiveIndex = Math.max(0, Math.min(commands.length - 1, agentWorkbenchState.slashActiveIndex));
  agentWorkbenchState.slashVisibleCommands = commands;
  // 按 kind 分组渲染（会话 / 工作台 / OpenCode Command），组内保持命令顺序
  const groupOrder = ['session', 'workspace', 'native'];
  const grouped = new Map(groupOrder.map(kind => [kind, []]));
  for (const command of commands) {
    const kind = grouped.has(command.kind) ? command.kind : 'workspace';
    grouped.get(kind).push(command);
  }
  const blocks = [];
  for (const kind of groupOrder) {
    const items = grouped.get(kind);
    if (!items.length) continue;
    const rows = items.map(command => {
      // 扁平索引用于键盘上下选择：分组只是视觉分隔
      const index = commands.indexOf(command);
      const selected = index === agentWorkbenchState.slashActiveIndex;
      const aliases = (command.aliases || []).length ? (command.aliases || []).map(name => `/${name}`).join(' ') : '';
      return `<button type="button" class="agent-slash-item${selected ? ' is-active' : ''}" data-slash-index="${index}" role="option" aria-selected="${selected ? 'true' : 'false'}">
        <span class="agent-slash-icon">${getSlashCommandIcon(command)}</span>
        <span class="agent-slash-body">
          <span class="agent-slash-command">/${escapeHtml(command.name)}</span>
          <span class="agent-slash-description">${escapeHtml(command.label)}</span>
        </span>
        ${aliases ? `<span class="agent-slash-alias">${escapeHtml(aliases)}</span>` : ''}
      </button>`;
    }).join('');
    blocks.push(`<div class="agent-slash-group"><span class="agent-slash-group-title">${escapeHtml(agentSlashGroupMeta[kind] || kind)}</span>${rows}</div>`);
  }
  if (agentWorkbenchState.slashCommandsLoading) blocks.push('<span class="agent-slash-empty">正在读取 OpenCode Command...</span>');
  if (!blocks.length) blocks.push(`<span class="agent-slash-empty">没有匹配“/${escapeHtml(query)}”的命令</span>`);
  list.innerHTML = blocks.join('');
  menu.classList.remove('hidden');
  getElement('agent-plus-btn')?.setAttribute('aria-expanded', 'false');
  const countEl = getElement('agent-slash-count');
  if (countEl) countEl.textContent = commands.length ? `${commands.length} 项` : '';
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
  if (command.action === 'fork') {
    const zcodeTask = getSelectedZcodeTask();
    if (zcodeTask) {
      // 不带检查点参数时先打开选择面板，避免直接拿 latest 做破坏性操作
      if (!String(parsed.arguments || '').trim()) {
        clearSlashPrompt();
        openZcodeSessionDialog();
        return true;
      }
      const completed = await submitZcodeCheckpoint('fork', parsed.arguments);
      if (completed) clearSlashPrompt();
      return true;
    }
  }
  if (command.action === 'zcode-goal') {
    const task = getSelectedZcodeTask();
    if (!task) {
      await webConsoleAlert('该命令只适用于 ZCode 会话，请先选择一个 ZCode 会话。');
      return true;
    }
    const args = String(parsed.arguments || '').trim();
    if (!args) {
      clearSlashPrompt();
      openZcodeSessionDialog();
      return true;
    }
    const first = args.split(/\s+/)[0].toLowerCase();
    const handled = ['pause', 'resume', 'clear'].includes(first)
      ? await submitZcodeGoal(first)
      : await submitZcodeGoal('set', args);
    if (handled) clearSlashPrompt();
    return true;
  }
  if (command.action === 'zcode-rewind') {
    const task = getSelectedZcodeTask();
    if (!task) {
      await webConsoleAlert('该命令只适用于 ZCode 会话，请先选择一个 ZCode 会话。');
      return true;
    }
    // 与上游 TUI 一致：不带参数先看检查点列表，不直接回退 latest
    if (!String(parsed.arguments || '').trim()) {
      clearSlashPrompt();
      openZcodeSessionDialog();
      return true;
    }
    const completed = await submitZcodeCheckpoint('rewind', parsed.arguments);
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
  let slashCommand = parseSlashCommand(prompt);
  // 能力面板插入的自定义命令只对紧接着的一次提交生效；无论后续是否命中都要清掉
  const pendingZcodeCommand = String(agentWorkbenchState.pendingZcodeCommand || '').toLowerCase();
  agentWorkbenchState.pendingZcodeCommand = '';
  // /workflow、/init、/skill 是 ZCode 核心内置的提示词命令；自定义 Command 由运行时
  // customCommandPromptResolver 展开。它们必须原样交给 Agent，不能被控制台斜杠分发层吞掉。
  if (slashCommand) {
    const config = agentWorkbenchState.payload?.config || {};
    const selected = agentWorkbenchState.newSession ? null : getSelectedTask(agentWorkbenchState.payload || {});
    const requestedProvider = config.defaultProvider || 'opencode';
    const providerId = selected?.providerId || (config.providers?.[requestedProvider] === false ? 'opencode' : requestedProvider);
    const capabilityWorkspaceKey = `${selected?.workspaceId || getElement('agent-workspace')?.value || ''}|${selected?.id || ''}`;
    const customCommand = agentWorkbenchState.zcodeCommandNames instanceof Set
      && agentWorkbenchState.zcodeCommandWorkspaceKey === capabilityWorkspaceKey
      && agentWorkbenchState.zcodeCommandNames.has(slashCommand.name)
      && !agentSlashCommandNames.has(slashCommand.name);
    const pendingCommand = pendingZcodeCommand === slashCommand.name && !agentSlashCommandNames.has(slashCommand.name);
    const zcodePromptCommand = ['workflow', 'init', 'skill'].includes(slashCommand.name) || customCommand || pendingCommand;
    if (providerId === 'zcode' && zcodePromptCommand) {
      if (slashCommand.name === 'workflow' && config.zcodeEnableWorkflow !== true) {
        await webConsoleAlert('动态工作流未启用：请先在「设置 → ZCode 能力配置」中开启「允许动态工作流」。');
        return;
      }
      if ((customCommand || pendingCommand) && agentWorkbenchState.zcodeInteractiveCommandNames instanceof Set
        && agentWorkbenchState.zcodeInteractiveCommandNames.has(slashCommand.name)) {
        await webConsoleAlert('该自定义命令标记为仅交互模式，无头任务无法执行。');
        return;
      }
      slashCommand = null;
    }
  }
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
  // 任务运行中 + 输入框为空：发送键此刻是「停止」
  if (pendingQuestionTask && ['running', 'pending'].includes(pendingQuestionTask.status) && !prompt) {
    cancelSelectedTask({ skipConfirm: true }).catch(error => webConsoleAlert(error.message));
    return;
  }
  if (prompt.length < 2) {
    await webConsoleAlert('请输入需要 Agent 分析的任务。');
    return;
  }
  // 新会话供应商跟随设置的「默认 Agent」；所选默认被停用时回退 OpenCode（后端创建时仍会再做启停校验）
  const workbenchConfig = agentWorkbenchState.payload?.config || {};
  const requestedProvider = workbenchConfig.defaultProvider || 'opencode';
  const providerId = workbenchConfig.providers?.[requestedProvider] === false ? 'opencode' : requestedProvider;
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
    // 命令预览按供应商还原真实形态：ZCode 是一次性子进程（-p/--mode/--cwd，续接加 --resume），OpenCode 是 run 子命令
    const isZcodePreview = requestProviderId === 'zcode';
    const commandPreview = isZcodePreview
      ? `zcode -p [${continuing ? '你的消息' : '你的任务'}] --mode ${fullAccess ? 'yolo' : 'edit'} --cwd "${workspace?.path || workspaceId}"${continuing && selectedTask.zcodeSessionId ? ` --resume ${selectedTask.zcodeSessionId}` : ''}`
      : continuing && selectedTask.opencodeSessionId
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
          ? isZcodePreview
            ? '完全访问档下终端命令将直接执行、不再逐项审批；请只提交你明确授权的任务。是否继续？'
            : '完全访问会减少终端审批次数；请只提交你明确授权的任务。是否继续？'
          : agentWorkbenchState.payload?.config?.allowTerminal === true
            ? isZcodePreview
              ? '受控写入档已禁用终端命令，模型只能修改工作目录中的文件。是否继续？'
              : 'Agent 请求终端命令时会暂停，必须在审批卡中逐项决定。是否继续？'
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
    if (result.task) {
      mergeStreamTask(result.task);
      expandWorkspaceGroupForTask(result.task);
    }
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

// 手机端：上下文面板 fixed 定位，需按所在聊天区居中（横屏有侧栏时按视口居中会偏）
function positionContextPopover() {
  const popover = document.querySelector('.agent-context-usage-popover');
  if (!popover) return;
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  popover.style.left = '';
  popover.style.right = '';
  popover.style.maxWidth = '';
  if (!mobile) return;
  // css 已给 left:12px 兜底，这里用实际宽度算出聊天区内的居中位置
  const host = popover.closest('.agent-chat-panel') || document.body;
  const hostRect = host.getBoundingClientRect();
  const width = Math.min(popover.offsetWidth || 248, window.innerWidth - 24);
  const left = Math.max(12, hostRect.left + (hostRect.width - width) / 2);
  popover.style.left = `${Math.round(left)}px`;
  popover.style.maxWidth = `${Math.round(Math.min(width, window.innerWidth - 24))}px`;
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

// 展开任务设置面板（弹层里选"自定义"时自动调用，避免自定义输入框藏在收起的面板里不可见）
function openComposerOptions() {
  const options = getElement('agent-composer-options');
  if (!options) return;
  options.classList.add('is-open');
  document.querySelectorAll('[data-agent-composer-options-toggle]').forEach(button => {
    button.setAttribute('aria-expanded', 'true');
  });
}

// 高亮闪烁目标输入框 1.8s：让"输入框在哪"一眼可见
function flashComposerInput(input) {
  if (!input) return;
  input.classList.remove('agent-input-flash');
  void input.offsetWidth;
  input.classList.add('agent-input-flash');
  setTimeout(() => input.classList.remove('agent-input-flash'), 1900);
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

async function cancelSelectedTask(options = {}) {
  const taskId = agentWorkbenchState.selectedTaskId;
  if (!taskId) return;
  if (options.skipConfirm !== true) {
    const confirmed = await webConsoleConfirm('确认取消当前 Agent 任务？', {
      title: '取消 Agent 任务',
      confirmText: '取消任务',
    });
    if (!confirmed) return;
  }
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

// Git 快照回滚：把选中任务改动的文件恢复为任务开始时的内容
async function undoSelectedTaskChanges() {
  const taskId = agentWorkbenchState.selectedTaskId;
  if (!taskId) return;
  const task = getSelectedTask(agentWorkbenchState.payload || {});
  const fileCount = Array.isArray(task?.changedFiles) ? task.changedFiles.length : 0;
  const confirmed = await webConsoleConfirm(
    `将回滚本任务的文件改动（${fileCount} 个文件）：恢复为任务开始时的内容，agent 新建的文件会被删除。\n\n注意：任务结束之后你对这些文件做的其他修改也会被覆盖。是否继续？`,
    { title: '回滚任务改动', confirmText: '确认回滚' },
  );
  if (!confirmed) return;
  setButtonBusy('agent-undo-btn', true, '回滚改动', '回滚中...');
  try {
    await postJson(`/api/agent-workbench/tasks/${encodeURIComponent(taskId)}/git/undo`, { confirmed: true });
    await webConsoleAlert('回滚完成：改动文件已恢复到任务开始时的状态。');
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(`回滚失败：${error.message}`);
  } finally {
    setButtonBusy('agent-undo-btn', false, '回滚改动', '回滚中...');
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
    if (result.task) expandWorkspaceGroupForTask(result.task);
    await refreshAgentWorkbench({ quiet: true });
  } catch (error) {
    await webConsoleAlert(`导入会话失败：${error.message}`);
  }
}

function startNewTaskForProject(workspaceId = '') {
  const id = String(workspaceId || '').trim();
  const workspace = findWorkspaceById(id, agentWorkbenchState.payload || {});
  const select = getElement('agent-workspace');
  const canSelect = id && [...(select?.options || [])].some(option => option.value === id);
  if (canSelect) {
    select.value = id;
    select.dataset.lastWorkspace = id;
    getElement('agent-custom-workspace-field')?.classList.add('hidden');
  }
  startNewAgentSession();
  updateRunState(agentWorkbenchState.payload || {});
  setStatus(`已在「${workspace?.label || id || '当前目录'}」中新建任务，输入内容后发送。`);
  window.setTimeout(() => getElement('agent-prompt')?.focus(), 50);
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
  // 新建会话保留当前模型+供应商选择（清掉供应商会退回主对话 API 跑错误模型）
  agentWorkbenchState.followUpDelivery = 'steer';
  updateModelVariantOptions('');
  renderTasks(agentWorkbenchState.payload || {});
  renderSelectedTask(agentWorkbenchState.payload || {});
  getElement('agent-prompt').focus();
}

function bindEvents() {
  getElement('agent-output').addEventListener('scroll', handleConversationScroll, { passive: true });
  getElement('agent-output').addEventListener('click', event => {
    const goalAction = event.target.closest?.('[data-zcode-goal-action]');
    if (goalAction) {
      handleZcodeGoalBannerAction(goalAction.dataset.zcodeGoalAction || '');
      return;
    }
    const codeCopyButton = event.target.closest?.('[data-agent-code-copy]');
    if (codeCopyButton) {
      copyAgentMessageCode(codeCopyButton).catch(error => webConsoleAlert(error.message));
      return;
    }
    const planAction = event.target.closest?.('[data-plan-action]');
    if (planAction) {
      if (planAction.dataset.planAction === 'execute') executePlanFromCard();
      else getElement('agent-prompt')?.focus();
      return;
    }
    const lightboxImage = event.target.closest?.('img.agent-tool-image, .agent-message-bubble img');
    if (lightboxImage && !event.target.closest('a')) {
      const scope = lightboxImage.closest('.agent-message-body') || event.currentTarget;
      const images = [...scope.querySelectorAll('img.agent-tool-image, .agent-message-bubble img')];
      openAgentLightbox(images, Math.max(0, images.indexOf(lightboxImage)));
      return;
    }
    const fileAction = event.target.closest?.('[data-file-action]');
    if (fileAction) {
      const row = fileAction.closest('.agent-file-change-row');
      const pathValue = row?.dataset.filePath || '';
      if (fileAction.dataset.fileAction === 'open') {
        const task = getSelectedWorkspaceTask();
        if (task?.workspaceId === 'plugin') openAgentFile(pathValue).catch(error => webConsoleAlert(error.message));
        else window.open(`/file-browser.html?open=${encodeURIComponent(pathValue)}`, '_blank', 'noopener');
      } else if (fileAction.dataset.fileAction === 'review') {
        row?.querySelector('.agent-file-change-diff')?.classList.toggle('hidden');
      }
      return;
    }
    // 通用消息操作：复制 / 重发（不依赖 OpenCode 消息 ID，ZCode 会话同样可用）
    const copyBtn = event.target.closest?.('[data-message-copy]');
    if (copyBtn) {
      const card = copyBtn.closest('.agent-message');
      const bubble = card?.querySelector('.agent-message-bubble');
      const text = bubble?.innerText || '';
      navigator.clipboard.writeText(text).then(() => {
        const label = copyBtn.querySelector('span');
        if (!label) return;
        const original = label.textContent;
        label.textContent = '已复制';
        window.setTimeout(() => { label.textContent = original; }, 1200);
      }).catch(error => webConsoleAlert(error.message));
      return;
    }
    const resendBtn = event.target.closest?.('[data-message-resend]');
    if (resendBtn) {
      const card = resendBtn.closest('.agent-message');
      const bubble = card?.querySelector('.agent-message-bubble');
      const text = bubble?.innerText || '';
      if (!text.trim()) return;
      const prompt = getElement('agent-prompt');
      if (prompt) {
        prompt.value = text;
        prompt.focus();
      }
      setStatus('已填入输入框，可直接发送。');
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
  const lightbox = getElement('agent-lightbox');
  getElement('agent-thinking-bar')?.addEventListener('click', toggleThinkingBar);
  lightbox?.addEventListener('click', event => {
    const actionButton = event.target.closest?.('[data-lightbox-action]');
    if (actionButton) {
      const action = actionButton.dataset.lightboxAction;
      if (action === 'close') closeAgentLightbox();
      else if (action === 'prev') stepAgentLightbox(-1);
      else if (action === 'next') stepAgentLightbox(1);
      return;
    }
    if (event.target.id === 'agent-lightbox-img') {
      lightbox.classList.toggle('is-zoomed');
      return;
    }
    closeAgentLightbox();
  });
  document.addEventListener('keydown', event => {
    if (!isAgentLightboxOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAgentLightbox();
    } else if (event.key === 'ArrowLeft') {
      stepAgentLightbox(-1);
    } else if (event.key === 'ArrowRight') {
      stepAgentLightbox(1);
    }
  });
  getElement('agent-refresh-btn').addEventListener('click', () => {
    refreshAgentWorkbench({ force: true }).catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-save-btn').addEventListener('click', () => {
    saveSettings().catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-zcode-mcp-manage')?.addEventListener('click', () => openMcpManager());
  getElement('agent-mcp-close')?.addEventListener('click', () => closeMcpManager());
  getElement('agent-mcp-cancel')?.addEventListener('click', () => closeMcpManager());
  getElement('agent-mcp-save')?.addEventListener('click', () => saveMcpManager());
  getElement('agent-mcp-add')?.addEventListener('click', () => startMcpEdit(-1));
  getElement('agent-mcp-type')?.addEventListener('change', () => updateMcpTypeFields());
  getElement('agent-mcp-editor-save')?.addEventListener('click', () => saveMcpEditor());
  getElement('agent-mcp-editor-cancel')?.addEventListener('click', () => resetMcpEditor());
  getElement('agent-mcp-raw-apply')?.addEventListener('click', () => applyMcpRawJson());
  getElement('agent-mcp-raw-format')?.addEventListener('click', () => formatMcpRawJson());
  getElement('agent-mcp-list')?.addEventListener('click', event => {
    const edit = event.target.closest?.('[data-mcp-edit]');
    if (edit) {
      startMcpEdit(Number(edit.dataset.mcpEdit));
      return;
    }
    const remove = event.target.closest?.('[data-mcp-delete]');
    if (remove) {
      const index = Number(remove.dataset.mcpDelete);
      const item = agentWorkbenchState.mcpDraft?.[index];
      if (!item) return;
      webConsoleConfirm(`确定删除 MCP 服务器“${item.name}”吗？`, {
        title: '删除 MCP 服务器', confirmText: '删除',
      }).then(confirmed => {
        if (!confirmed) return;
        agentWorkbenchState.mcpDraft.splice(index, 1);
        const raw = getElement('agent-mcp-raw');
        if (raw) raw.value = serializeMcpServers(agentWorkbenchState.mcpDraft);
        resetMcpEditor();
        renderMcpDraftList();
      }).catch(error => setMcpError(error.message));
    }
  });
  getElement('agent-mcp-mask')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeMcpManager();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const mask = getElement('agent-mcp-mask');
    if (!mask || mask.classList.contains('hidden')) return;
    event.preventDefault();
    closeMcpManager();
  });
  getElement('agent-zcode-capabilities-close')?.addEventListener('click', () => closeZcodeCapabilities());
  getElement('agent-zcode-capabilities-cancel')?.addEventListener('click', () => closeZcodeCapabilities());
  getElement('agent-zcode-capabilities-mask')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeZcodeCapabilities();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const mask = getElement('agent-zcode-capabilities-mask');
    if (!mask || mask.classList.contains('hidden')) return;
    event.preventDefault();
    closeZcodeCapabilities();
  });
  document.querySelectorAll('[data-capability-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.capabilityTab === 'commands' ? 'commands' : 'skills';
      agentWorkbenchState.zcodeCapabilities.tab = tab;
      renderZcodeCapabilities();
    });
  });
  getElement('agent-capability-search')?.addEventListener('input', event => {
    agentWorkbenchState.zcodeCapabilities.query = String(event.target.value || '');
    renderZcodeCapabilities();
  });
  getElement('agent-capability-refresh')?.addEventListener('click', () => {
    loadZcodeCapabilities({ force: true }).catch(error => setZcodeCapabilityError(error.message));
  });
  getElement('agent-capability-list')?.addEventListener('click', event => {
    const item = event.target.closest?.('[data-capability-type]');
    if (!item) return;
    insertZcodeCapability(
      item.dataset.capabilityType || '',
      item.dataset.capabilityName || '',
      item.dataset.capabilityBlocked === '1',
      item.dataset.capabilityBlockedReason || '',
    );
  });
  getElement('agent-composer-form').addEventListener('submit', runTask);
  // 旧“排队/调整”选择器已移除：运行中提交统一立即发送
  // 旧“排队/调整”选择器已移除：运行中提交统一立即发送
  getElement('agent-resume-btn').addEventListener('click', () => resumeSelectedTask());
  getElement('agent-zcode-session-btn')?.addEventListener('click', () => openZcodeSessionDialog());
  getElement('agent-zcode-session-refresh')?.addEventListener('click', () => refreshZcodeSessionStateFromServer());
  getElement('agent-zcode-session-close')?.addEventListener('click', () => closeZcodeSessionDialog());
  getElement('agent-zcode-session-cancel')?.addEventListener('click', () => closeZcodeSessionDialog());
  getElement('agent-zcode-session-mask')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeZcodeSessionDialog();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const mask = getElement('agent-zcode-session-mask');
    if (!mask || mask.classList.contains('hidden')) return;
    event.preventDefault();
    closeZcodeSessionDialog();
  });
  getElement('agent-zcode-goal-save')?.addEventListener('click', () => submitZcodeGoal('set'));
  getElement('agent-zcode-goal-pause')?.addEventListener('click', () => submitZcodeGoal('pause'));
  getElement('agent-zcode-goal-resume')?.addEventListener('click', () => submitZcodeGoal('resume'));
  getElement('agent-zcode-goal-clear')?.addEventListener('click', () => submitZcodeGoal('clear'));
  getElement('agent-zcode-rewind-btn')?.addEventListener('click', () => submitZcodeCheckpoint('rewind'));
  getElement('agent-zcode-fork-btn')?.addEventListener('click', () => submitZcodeCheckpoint('fork'));
  getElement('agent-zcode-session-save')?.addEventListener('click', () => saveZcodeSessionConfig());
  getElement('agent-zcode-session-variant')?.addEventListener('change', () => syncZcodeSessionVariantCustomField());
  getElement('agent-retry-btn').addEventListener('click', () => retrySelectedTask());
  getElement('agent-undo-btn').addEventListener('click', () => undoSelectedTaskChanges().catch(error => webConsoleAlert(error.message)));
  const actionsToggle = getElement('agent-actions-toggle');
  const actionsMenu = getElement('agent-task-actions');
  if (actionsToggle && actionsMenu) {
    const container = actionsToggle.closest('.agent-chat-actions');
    const setActionsOpen = open => {
      container.classList.toggle('is-open', open);
      actionsToggle.setAttribute('aria-expanded', String(open));
    };
    actionsToggle.addEventListener('click', () => {
      setActionsOpen(!container.classList.contains('is-open'));
    });
    actionsMenu.addEventListener('click', event => {
      if (!event.target.closest?.('button')) return;
      const returnFocus = actionsMenu.contains(document.activeElement);
      setActionsOpen(false);
      if (returnFocus) actionsToggle.focus();
    });
    document.addEventListener('click', event => {
      if (!container.contains(event.target)) setActionsOpen(false);
    });
    document.addEventListener('focusin', event => {
      if (!container.contains(event.target)) setActionsOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !container.classList.contains('is-open')) return;
      setActionsOpen(false);
      actionsToggle.focus();
    });
    window.matchMedia('(max-width: 760px)').addEventListener('change', () => setActionsOpen(false));
  }
  getElement('agent-history-load-btn').addEventListener('click', () => loadSessionHistory());
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
  getElement('agent-plus-btn').addEventListener('click', () => {
    const menu = getElement('agent-plus-menu');
    setPlusMenuOpen(menu.classList.contains('hidden'));
  });
  getElement('agent-plus-menu').addEventListener('click', event => {
    const item = event.target.closest?.('.agent-plus-item');
    if (!item) return;
    setPlusMenuOpen(false);
    if (item.dataset.plusAction === 'attachment') {
      getElement('agent-attachment-input').click();
    } else if (item.dataset.plusAction === 'slash') {
      closeComposerOptions();
      renderSlashMenu({ force: true });
      getElement('agent-prompt').focus();
    } else if (item.dataset.plusAction === 'workflow') {
      const config = agentWorkbenchState.payload?.config || {};
      const selected = getSelectedTask(agentWorkbenchState.payload || {}) || null;
      const requestedProvider = config.defaultProvider || 'opencode';
      const providerId = selected?.providerId || (config.providers?.[requestedProvider] === false ? 'opencode' : requestedProvider);
      if (providerId !== 'zcode') {
        webConsoleAlert('动态工作流只支持 ZCode 会话。').catch(() => {});
      } else if (config.zcodeEnableWorkflow !== true) {
        webConsoleAlert('请先在「设置 → ZCode 能力配置」中启用「允许动态工作流」。').catch(() => {});
      } else {
        const prompt = getElement('agent-prompt');
        prompt.value = '/workflow ';
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
        prompt.focus();
        setStatus('已插入 /workflow，补上任务描述后发送。');
      }
    } else if (item.dataset.plusAction === 'zcode-capabilities') {
      openZcodeCapabilities();
    }
  });
  getElement('agent-composer-tools-btn').addEventListener('click', toggleComposerOptions);
  getElement('agent-context-usage-menu').addEventListener('toggle', event => {
    if (!event.currentTarget.open) return;
    closeComposerOptions();
    closeSlashMenu();
    positionContextPopover();
  });
  document.addEventListener('click', event => {
    // 模型弹层是设置面板的子控件：在弹层里点选（如"自定义"）不算点外部，否则刚自动展开的面板会被立即关掉
    if (!event.target.closest?.('#agent-composer-options, [data-agent-composer-options-toggle], #agent-model-menu, #agent-model-btn')) closeComposerOptions();
    if (!event.target.closest?.('#agent-slash-menu, #agent-plus-btn, #agent-plus-menu')) closeSlashMenu();
    if (!event.target.closest?.('#agent-plus-menu, #agent-plus-btn')) setPlusMenuOpen(false);
    if (!event.target.closest?.('#agent-model-menu, #agent-model-btn')) setModelMenuOpen(false);
    if (!event.target.closest?.('#agent-mode-menu, #agent-mode-btn')) setModeMenuOpen(false);
    if (!event.target.closest?.('#agent-context-usage-menu')) closeContextUsageMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeContextUsageMenu();
    if (event.key === 'Escape') setModelMenuOpen(false);
    if (event.key === 'Escape') setModeMenuOpen(false);
  });
  getElement('agent-attachment-input').addEventListener('change', event => addComposerAttachments(event).catch(error => webConsoleAlert(error.message)));
  getElement('agent-prompt').addEventListener('input', () => {
    updateRunState(agentWorkbenchState.payload || {});
  });
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

  // 模型选择弹层
  getElement('agent-model-btn').addEventListener('click', () => {
    const menu = getElement('agent-model-menu');
    setModelMenuOpen(menu.classList.contains('hidden'));
  });
  // 卡片顶部的供应商行：在「模型列表」与「供应商列表」之间切换
  getElement('agent-model-menu-provider-row').addEventListener('click', event => {
    event.stopPropagation();
    agentWorkbenchState.modelMenuView = agentWorkbenchState.modelMenuView === 'providers' ? 'models' : 'providers';
    renderModelMenu();
  });
  // 思考强度滑块：鼠标/触摸拖动、点击轨道、键盘方向键都走原生 range 的 input/change
  const effortRange = getElement('agent-effort-range');
  effortRange.addEventListener('input', event => applyEffortLevel(event.target.value));
  effortRange.addEventListener('change', event => applyEffortLevel(event.target.value));
  getElement('agent-model-menu-list').addEventListener('click', event => {
    // 弹层内部点击不参与 document 的"点外关闭"判定（重渲染会让 target 游离，closest 失效误关菜单）
    event.stopPropagation();
    // 供应商列表视图：选中即切回模型列表（管理模型/自定义除外）
    const providerButton = event.target.closest?.('.agent-model-provider');
    if (providerButton) {
      if (providerButton.dataset.providerAction === 'manage') {
        setModelMenuOpen(false);
        openModelManager();
        return;
      }
      if (providerButton.dataset.providerAction === 'custom') {
        setModelMenuOpen(false);
        openComposerOptions();
        const modelInput = getElement('agent-model');
        modelInput.focus();
        flashComposerInput(modelInput);
        return;
      }
      agentWorkbenchState.modelMenuProviderKey = providerButton.dataset.providerKey || '__default__';
      agentWorkbenchState.modelMenuView = 'models';
      renderModelMenu();
      return;
    }
    // 模型项 → 写入选择通道
    const item = event.target.closest?.('.agent-model-item');
    if (!item) return;
    setComposerModelSelection(item.dataset.modelValue || '', item.dataset.modelProvider || '');
    updateModelVariantOptions('');
    refreshVariantIntelligence().then(() => updateModelVariantOptions('')).catch(() => { });
    updateRunState(agentWorkbenchState.payload || {});
    setModelMenuOpen(false);
    setStatus('模型已切换：' + (item.dataset.modelProvider ? item.dataset.modelProvider + ' / ' : '') + (item.dataset.modelValue || '默认模型'));
  });

  // 管理模型模态框
  getElement('agent-model-manager-close').addEventListener('click', closeModelManager);
  getElement('agent-model-manager-mask').addEventListener('click', event => {
    if (event.target.id === 'agent-model-manager-mask') closeModelManager();
  });
  getElement('agent-model-manager-add').addEventListener('click', addModelProviderDraft);
  // 左栏供应商切换 + 编辑区结构按钮（删供应商/删模型/加模型/密钥眼睛）
  getElement('agent-model-manager-list').addEventListener('click', event => {
    const providerButton = event.target.closest?.('[data-manager-provider-index]');
    if (providerButton) {
      agentWorkbenchState.modelManagerActiveIndex = Number(providerButton.dataset.managerProviderIndex) || 0;
      renderModelManager();
      return;
    }
  });
  getElement('agent-model-manager-editor').addEventListener('click', event => {
    if (event.target.closest?.('[data-manager-empty-add]')) {
      addModelProviderDraft();
      return;
    }
    const eye = event.target.closest?.('[data-manager-key-eye]');
    if (eye) {
      const input = eye.parentElement?.querySelector('input');
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
      return;
    }
    const providerRemove = event.target.closest?.('[data-manager-provider-remove]');
    if (providerRemove) {
      agentWorkbenchState.modelProviderDraft.splice(Number(providerRemove.dataset.managerProviderRemove), 1);
      agentWorkbenchState.modelManagerActiveIndex = Math.max(0, agentWorkbenchState.modelManagerActiveIndex - 1);
      renderModelManager();
      return;
    }
    const modelRemove = event.target.closest?.('[data-manager-model-remove]');
    if (modelRemove) {
      const provider = agentWorkbenchState.modelProviderDraft[agentWorkbenchState.modelManagerActiveIndex];
      provider?.models?.splice(Number(modelRemove.dataset.managerModelRemove), 1);
      renderModelManager();
      return;
    }
    if (event.target.closest?.('[data-manager-model-fetch-btn]')) {
      openProviderModels();
      return;
    }
    if (event.target.closest?.('[data-manager-model-add-btn]')) {
      openModelForm(-1);
      return;
    }
    const modelRowEdit = event.target.closest?.('[data-manager-model-edit]');
    if (modelRowEdit) {
      openModelForm(Number(modelRowEdit.dataset.managerModelEdit));
      return;
    }
  });
  // 字段编辑直接写入 draft（blur 时重渲染左栏状态点，避免每次按键丢焦点）
  const managerEditor = getElement('agent-model-manager-editor');
  managerEditor.addEventListener('input', event => {
    const field = event.target.closest?.('[data-manager-field]');
    if (!field) return;
    const provider = agentWorkbenchState.modelProviderDraft[agentWorkbenchState.modelManagerActiveIndex];
    if (provider) provider[field.dataset.managerField] = field.value;
  });
  managerEditor.addEventListener('change', event => {
    // 失焦时只刷新左栏状态点/标签；整编辑区重渲染会把正聚焦的下一个输入框换成游离节点打断输入
    if (event.target.closest?.('[data-manager-field]')) renderModelManagerRail();
  });


  // 添加/编辑模型弹窗绑定
  getElement('agent-model-form-close').addEventListener('click', closeModelForm);
  getElement('agent-model-form-cancel').addEventListener('click', closeModelForm);
  getElement('agent-model-form-mask').addEventListener('click', event => {
    if (event.target.id === 'agent-model-form-mask') closeModelForm();
  });
  getElement('agent-model-form-save').addEventListener('click', submitModelForm);
  managerEditor.addEventListener('input', clearModelFormError);
  managerEditor.addEventListener('change', clearModelFormError);
  managerEditor.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      submitModelForm();
    }
  });
  getElement('agent-model-manager-save').addEventListener('click', () => {
    const draft = agentWorkbenchState.modelProviderDraft;
    const invalid = draft.find(item => !item.name || !item.baseApi || !(item.models || []).length);
    if (invalid) {
      webConsoleAlert('每个供应商都需要名称、API 地址和至少一个模型。');
      return;
    }
    saveModelProviders(draft);
  });

  // 获取模型弹窗绑定
  getElement('agent-provider-models-close').addEventListener('click', closeProviderModels);
  getElement('agent-provider-models-cancel').addEventListener('click', closeProviderModels);
  getElement('agent-provider-models-retry').addEventListener('click', () => { requestProviderModels(); });
  getElement('agent-provider-models-save').addEventListener('click', applyProviderModels);
  getElement('agent-provider-models-mask').addEventListener('click', event => {
    if (event.target.id === 'agent-provider-models-mask') closeProviderModels();
  });
  getElement('agent-provider-models-filter').addEventListener('input', renderProviderModelsList);
  getElement('agent-provider-models-selectall').addEventListener('change', event => {
    const provider = getActiveModelProviderDraft();
    const existing = new Set((provider?.models || []).map(modelEntryName).filter(Boolean));
    const pending = (agentWorkbenchState.providerModelsRemote || []).filter(name => !existing.has(name));
    agentWorkbenchState.providerModelsSelected = event.target.checked ? new Set(pending) : new Set();
    renderProviderModelsList();
  });
  // 勾选走 change 事件委托：列表整体重渲染时不会丢监听
  getElement('agent-provider-models-list').addEventListener('change', event => {
    const checkbox = event.target.closest?.('[data-provider-model]');
    if (!checkbox) return;
    const name = checkbox.dataset.providerModel || '';
    if (!name) return;
    if (checkbox.checked) agentWorkbenchState.providerModelsSelected.add(name);
    else agentWorkbenchState.providerModelsSelected.delete(name);
    updateProviderModelsCount();
  });  syncDesktopNotifyToggle();
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
  // 斜杠菜单内搜索框：输入即过滤，键盘行为与输入框一致
  const slashSearch = getElement('agent-slash-search-input');
  slashSearch?.addEventListener('input', event => {
    agentWorkbenchState.slashSearchQuery = String(event.target.value || '').trim();
    agentWorkbenchState.slashActiveIndex = 0;
    renderSlashMenu({ keepSelection: false, skipLoad: true });
    // 过滤后焦点保持在搜索框，方便继续输入
    getElement('agent-slash-search-input')?.focus();
  });
  slashSearch?.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSlashSelection(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSlashMenu();
      getElement('agent-prompt')?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const selected = agentWorkbenchState.slashVisibleCommands[agentWorkbenchState.slashActiveIndex];
      if (!selected) return;
      event.preventDefault();
      fillSlashCommand(selected);
    }
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
  getElement('agent-zcode-cleanup-btn').addEventListener('click', () => cleanupZcodeState().catch(error => webConsoleAlert(error.message)));
  getElement('agent-settings-mask').addEventListener('click', event => {
    if (event.target === getElement('agent-settings-mask')) setSettingsModalOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && agentWorkbenchState.settingsOpen) {
      const mcpMask = getElement('agent-mcp-mask');
      const capabilityMask = getElement('agent-zcode-capabilities-mask');
      // 设置页/输入区上的独立覆盖层：先关它们，别把整个设置页一起关掉
      if (mcpMask && !mcpMask.classList.contains('hidden')) return;
      if (capabilityMask && !capabilityMask.classList.contains('hidden')) return;
      event.preventDefault();
      setSettingsModalOpen(false);
    }
  });
  getElement('agent-task-list').addEventListener('click', event => {
    const newProjectTask = event.target.closest?.('[data-new-project-task]');
    if (newProjectTask) {
      event.preventDefault();
      event.stopPropagation();
      startNewTaskForProject(newProjectTask.dataset.newProjectTask || '');
      return;
    }
    const editProject = event.target.closest?.('[data-edit-project]');
    if (editProject) {
      event.preventDefault();
      event.stopPropagation();
      const workspace = findWorkspaceById(editProject.dataset.editProject || '', agentWorkbenchState.payload || {});
      if (workspace) openProjectDialog(workspace);
      return;
    }
    const projectToggle = event.target.closest?.('[data-project-toggle]');
    if (projectToggle) {
      event.preventDefault();
      toggleWorkspaceGroup(projectToggle.dataset.projectToggle || '');
      return;
    }
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
  // 顶栏活跃任务条：点击切到对应任务（与侧栏选择同一逻辑）
  getElement('agent-active-strip')?.addEventListener('click', event => {
    const chip = event.target.closest?.('[data-active-task]');
    if (!chip) return;
    selectAgentTaskById(chip.dataset.activeTask || '');
  });
  // 会话内容搜索
  getElement('agent-content-search-toggle')?.addEventListener('click', () => toggleContentSearchBar());
  getElement('agent-content-search-close')?.addEventListener('click', () => toggleContentSearchBar(false));
  getElement('agent-content-search-prev')?.addEventListener('click', () => jumpContentSearchHit(-1));
  getElement('agent-content-search-next')?.addEventListener('click', () => jumpContentSearchHit(1));
  getElement('agent-content-search-input')?.addEventListener('input', event => {
    const search = getSessionContentSearch();
    search.query = String(event.target.value || '');
    search.index = -1;
    applyContentSearchHighlights();
  });
  getElement('agent-content-search-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      jumpContentSearchHit(event.shiftKey ? -1 : (getSessionContentSearch().index < 0 ? 0 : 1));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      toggleContentSearchBar(false);
    }
  });
  // 工具输入/输出卡：复制 / 输出展开全部
  getElement('agent-output').addEventListener('click', event => {
    const toolCopy = event.target.closest?.('[data-tool-copy]');
    if (toolCopy) {
      const pre = toolCopy.closest('.agent-tool-io')?.querySelector('pre');
      navigator.clipboard.writeText(pre?.textContent || '').then(() => {
        toolCopy.textContent = '已复制';
        window.setTimeout(() => { toolCopy.textContent = '复制'; }, 1200);
      }).catch(error => webConsoleAlert(error.message));
      return;
    }
    const toolExpand = event.target.closest?.('[data-tool-expand]');
    if (toolExpand) {
      const io = toolExpand.closest('.agent-tool-io');
      const expanded = io?.classList.toggle('is-expanded');
      toolExpand.textContent = expanded ? '收起' : '展开全部';
    }
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
    'agent-native-config',
    'agent-timeout-ms',
    'agent-max-concurrent',
    'agent-max-runtimes',
    'agent-zcode-max-concurrent',
    'agent-zcode-instructions',
    'agent-zcode-mcp',
    'agent-zcode-enable-workflow',
    'agent-custom-workspaces',
    'agent-runtime-idle',
    'agent-http-proxy',
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
      const placeholder = task.status === 'pending' ? '任务正在排队...' : (task.liveStatus || 'Agent 正在准备输出...');
      const nextHtml = renderLiveStepBubbles(task.liveSteps, normalizeAgentOutput(task.outputText) || placeholder, task.status === 'running', task.outputSegments);
      bubbles.dataset.liveSignature = `${nextHtml.length}:${nextHtml.slice(-60)}`;
      bubbles.innerHTML = nextHtml;
    }
  });

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
  ['agent-workspace', 'agent-mode'].forEach(id => {
    getElement(id).addEventListener('change', event => {
      if (id === 'agent-workspace') {
        if (event.target.value === '__custom__') {
          event.target.value = event.target.dataset.lastWorkspace || event.target.options[0]?.value || 'plugin';
          getElement('agent-custom-workspace-field')?.classList.remove('hidden');
          getElement('agent-custom-workspace-path')?.focus();
          return;
        }
        event.target.dataset.lastWorkspace = event.target.value;
        getElement('agent-custom-workspace-field')?.classList.add('hidden');
      }
      if (id === 'agent-mode' && (agentWorkbenchState.newSession || isFullAccessMode(event.target.value))) {
        getElement('agent-agent').value = isWriteMode(event.target.value) ? 'build' : 'plan';
      }
      if (id === 'agent-mode') getElement('agent-mobile-mode').value = event.target.value;
      if (id === 'agent-mode') syncModeTrigger();
      updateRunState(agentWorkbenchState.payload || {});
    });
  });
  getElement('agent-custom-workspace-browse').addEventListener('click', () => {
    openWorkspacePicker(getElement('agent-custom-workspace-path')?.value || '')
      .catch(error => webConsoleAlert(error.message));
  });
  getElement('agent-workspace-picker-close').addEventListener('click', closeWorkspacePicker);
  getElement('agent-workspace-picker-mask').addEventListener('click', event => {
    if (event.target === getElement('agent-workspace-picker-mask')) closeWorkspacePicker();
  });
  getElement('agent-workspace-picker-up').addEventListener('click', () => {
    const parent = agentWorkbenchState.workspacePickerParent;
    if (parent) loadWorkspacePicker(parent);
  });
  getElement('agent-workspace-picker-shortcuts').addEventListener('click', event => {
    const button = event.target.closest?.('[data-workspace-picker-path]');
    if (button) loadWorkspacePicker(button.dataset.workspacePickerPath || '');
  });
  getElement('agent-workspace-picker-list').addEventListener('click', event => {
    const button = event.target.closest?.('[data-workspace-picker-path]');
    if (button) loadWorkspacePicker(button.dataset.workspacePickerPath || '');
  });
  getElement('agent-workspace-picker-select').addEventListener('click', () => {
    const selectedPath = agentWorkbenchState.workspacePickerPath || '';
    const target = agentWorkbenchState.workspacePickerTarget;
    if (typeof target === 'number' && agentWorkbenchState.projectDraft) {
      agentWorkbenchState.projectDraft.directories[target] = selectedPath;
      renderProjectDialog();
    } else {
      getElement('agent-custom-workspace-path').value = selectedPath;
    }
    closeWorkspacePicker();
  });

  // ===== 新建/编辑项目弹窗 =====
  getElement('agent-new-project-btn')?.addEventListener('click', () => openProjectDialog(null));
  getElement('agent-project-close')?.addEventListener('click', closeProjectDialog);
  getElement('agent-project-cancel')?.addEventListener('click', closeProjectDialog);
  getElement('agent-project-mask')?.addEventListener('click', event => {
    if (event.target === getElement('agent-project-mask')) closeProjectDialog();
  });
  getElement('agent-project-save')?.addEventListener('click', () => { saveProjectDialog().catch(error => setProjectDialogError(error.message)); });
  getElement('agent-project-delete')?.addEventListener('click', () => { deleteProjectDialog().catch(error => setProjectDialogError(error.message)); });
  getElement('agent-project-name')?.addEventListener('input', event => {
    if (agentWorkbenchState.projectDraft) agentWorkbenchState.projectDraft.name = String(event.target.value || '');
  });
  getElement('agent-project-add-folder')?.addEventListener('click', () => {
    const draft = agentWorkbenchState.projectDraft;
    if (!draft || draft.directories.length >= 6) return;
    draft.directories.push('');
    renderProjectDialog();
    const inputs = getElement('agent-project-folders')?.querySelectorAll('[data-project-folder-input]');
    inputs?.[inputs.length - 1]?.focus();
  });
  getElement('agent-project-folders')?.addEventListener('input', event => {
    const input = event.target.closest?.('[data-project-folder-input]');
    if (!input || !agentWorkbenchState.projectDraft) return;
    agentWorkbenchState.projectDraft.directories[Number(input.dataset.projectFolderInput)] = String(input.value || '');
  });
  getElement('agent-project-folders')?.addEventListener('click', event => {
    const browse = event.target.closest?.('[data-project-folder-browse]');
    if (browse) {
      const index = Number(browse.dataset.projectFolderBrowse);
      const current = agentWorkbenchState.projectDraft?.directories?.[index] || '';
      openWorkspacePicker(current, index).catch(error => setProjectDialogError(error.message));
      return;
    }
    const remove = event.target.closest?.('[data-project-folder-remove]');
    if (remove && agentWorkbenchState.projectDraft) {
      const index = Number(remove.dataset.projectFolderRemove);
      if (agentWorkbenchState.projectDraft.directories.length <= 1) return;
      agentWorkbenchState.projectDraft.directories.splice(index, 1);
      renderProjectDialog();
    }
  });
  getElement('agent-custom-workspace-add').addEventListener('click', async () => {
    const input = getElement('agent-custom-workspace-path');
    const directory = String(input?.value || '').trim();
    if (!directory) {
      webConsoleAlert('请输入自定义工作目录的绝对路径');
      input?.focus();
      return;
    }
    setButtonBusy('agent-custom-workspace-add', true, '添加', '添加中...');
    try {
      const result = await postJson('/api/agent-workbench/workspaces/custom', { directory });
      renderPayload(result.data || {});
      const select = getElement('agent-workspace');
      const workspace = result.workspace || null;
      if (workspace?.id) {
        select.value = workspace.id;
        select.dataset.lastWorkspace = workspace.id;
      }
      input.value = '';
      getElement('agent-custom-workspace-field')?.classList.add('hidden');
      setStatus(`已添加自定义工作目录：${workspace?.label || directory}`);
    } catch (error) {
      webConsoleAlert(error.message);
    } finally {
      setButtonBusy('agent-custom-workspace-add', false, '添加', '添加中...');
    }
  });
  // 输入区模式控件
  getElement('agent-mode-btn').addEventListener('click', event => {
    event.stopPropagation();
    setModeMenuOpen(getElement('agent-mode-menu')?.classList.contains('hidden') !== false);
  });
  getElement('agent-mode-menu').addEventListener('click', event => {
    const option = event.target.closest?.('[data-mode-value]');
    if (!option) return;
    event.stopPropagation();
    applyTaskMode(option.dataset.modeValue || '');
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
    setComposerModelSelection(model.dataset.nativeModel || '', model.dataset.nativeModelProvider || '');
    getElement('agent-native-model').value = model.dataset.nativeModel || '';
    updateModelVariantOptions('');
    refreshVariantIntelligence().then(() => updateModelVariantOptions('')).catch(() => { });
    renderContextUsage(getSelectedTask(agentWorkbenchState.payload || {}));
    setStatus(`已选择模型：${model.dataset.nativeModel || '默认模型'}`);
  });
  getElement('agent-native-agent').addEventListener('change', event => {
    getElement('agent-agent').value = event.target.value;
  });
  getElement('agent-native-model').addEventListener('input', event => {
    setComposerModelSelection(event.target.value, '');
    updateModelVariantOptions('');
    renderContextUsage(getSelectedTask(agentWorkbenchState.payload || {}));
  });
  getElement('agent-agent').addEventListener('change', event => {
    if ([...getElement('agent-native-agent').options].some(option => option.value === event.target.value)) {
      getElement('agent-native-agent').value = event.target.value;
    }
  });
  getElement('agent-model').addEventListener('input', event => {
    // 手输模型名 = 回到默认供应商；持久化交给 change（失焦/回车）避免每键写 storage
    agentWorkbenchState.selectedModelProviderId = '';
    updateModelVariantOptions('');
    renderContextUsage(getSelectedTask(agentWorkbenchState.payload || {}));
  });
  getElement('agent-model').addEventListener('change', event => {
    setComposerModelSelection(event.target.value, '');
  });
  getElement('agent-variant').addEventListener('change', event => {
    updateCustomVariantField(event.target.value === agentCustomVariantOption ? '' : undefined);
    // 自定义输入框在模型卡片里；切到自定义档时同步展开它
    const customInput = getElement('agent-effort-custom-input');
    if (event.target.value === agentCustomVariantOption && customInput) {
      getElement('agent-effort-custom')?.classList.add('is-open');
      getElement('agent-effort-custom-toggle')?.setAttribute('aria-expanded', 'true');
      customInput.value = '';
      customInput.focus();
    }
    renderContextUsage(getSelectedTask(agentWorkbenchState.payload || {}));
  });
  // 卡片里的自定义思考参数：写入隐藏的 select + 输入框，复用同一条档位链路
  getElement('agent-effort-custom-toggle')?.addEventListener('click', event => {
    event.stopPropagation();
    const wrap = getElement('agent-effort-custom');
    const open = !wrap?.classList.contains('is-open');
    wrap?.classList.toggle('is-open', open);
    getElement('agent-effort-custom-toggle')?.setAttribute('aria-expanded', String(open));
    if (open) getElement('agent-effort-custom-input')?.focus();
  });
  getElement('agent-effort-custom-input')?.addEventListener('input', event => {
    const value = String(event.target.value || '').trim();
    const select = getElement('agent-variant');
    const hidden = getElement('agent-variant-custom');
    if (!select || !hidden) return;
    if (!value) {
      // 清空即回到默认档
      if (select.value === agentCustomVariantOption) {
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    hidden.value = value;
    if (select.value !== agentCustomVariantOption) {
      select.value = agentCustomVariantOption;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncEffortSlider();
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
  syncModeTrigger();
  window.addEventListener('resize', () => {
    syncMobileActionTray();
    setContextCollapsed(agentWorkbenchState.contextCollapsed, { persist: false });
    positionModelMenu();
    positionContextPopover();
  }, { passive: true });
  // 首屏渲染完成后再恢复用户上次显式选择的模型+供应商：
  // 加载时会自动选中最近任务并把它的模型配置同步进输入框，恢复必须放在那之后
  refreshAgentWorkbench().then(() => {
    restoreComposerModelSelection();
    return connectAgentEventStream();
  }).catch(error => webConsoleAlert(error.message));
  agentWorkbenchState.pollTimer = window.setInterval(() => {
    if (document.hidden || agentWorkbenchState.refreshing) return;
    const refreshInterval = agentWorkbenchState.streamConnected ? 60000 : 10000;
    if (Date.now() - agentWorkbenchState.lastFullRefreshAt < refreshInterval) return;
    refreshAgentWorkbench({ quiet: true }).catch(() => {});
  }, 10000);
  // 运行中的耗时本地每秒推进，避免 SSE 没有事件时一直显示 0 秒
  agentWorkbenchState.elapsedTimer = window.setInterval(() => {
    const task = (agentWorkbenchState.payload?.tasks || []).find(item => item.id === agentWorkbenchState.selectedTaskId);
    if (!task || task.status !== 'running') return;
    const started = Date.parse(task.startedAt || '');
    if (!Number.isFinite(started)) return;
    task.elapsedMs = Math.max(0, Date.now() - started);
    const meta = getElement('agent-output-meta');
    if (meta) meta.textContent = buildTaskMetaText(task);
    document.querySelectorAll('[data-live-work-label]').forEach(element => {
      element.textContent = `已工作 ${formatDuration(task.elapsedMs)}`;
    });
  }, 1000);
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
