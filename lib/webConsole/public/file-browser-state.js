const fileBrowserState = {
  auth: null,
  currentDir: '',
  history: {
    back: [],
    forward: [],
  },
  directoryPage: 1,
  directoryPageSize: 100,
  currentDirectoryInfo: null,
  root: null,
  entries: [],
  selectedFile: null,
  selectedContent: '',
  lastSavedContent: '',
  pendingEditorSelection: null,
  searchKeyword: '',
  showHidden: true,
  treeFilter: 'all',
  openTabs: [],
  projectSearch: {
    query: '',
    caseSensitive: false,
    loading: false,
    searched: false,
    results: [],
    limit: 120,
    truncated: false,
    scopePath: '',
  },
  loadingTree: false,
  loadingFile: false,
  savingFile: false,
  creatingFile: false,
  creatingDirectory: false,
  copyingFile: false,
  renamingNode: false,
  deletingNode: false,
  modalResolver: null,
  viewMode: 'edit',
  editorWindowMaximized: false,
  editorTheme: 'dark',
  editorLanguageLabel: 'plaintext',
  editorEolLabel: 'LF (Linux)',
  previewLoading: false,
  previewHtml: '',
  previewLanguage: '',
  previewDetectedLanguage: '',
  previewLineCount: 0,
  previewByteLength: 0,
  previewError: '',
  previewTimer: 0,
  previewRequestId: 0,
  previewController: null,
  treeCache: Object.create(null),
  expandedDirs: new Set(),
  treeLoadingDirs: new Set(),
  pendingTreeFocusPath: '',
  treeFocusTimer: 0,
  restoredExpandedTree: false,
  sidebarWidth: 340,
  sidebarResizeActive: false,
  sidebarResizeStartX: 0,
  sidebarResizeStartWidth: 340,
  editorSearch: {
    visible: false,
    replaceMode: false,
    query: '',
    replacement: '',
    caseSensitive: false,
    matches: [],
    currentMatchIndex: -1,
  },
  contextMenu: {
    visible: false,
    x: 0,
    y: 0,
    target: null,
  },
};

const FILE_BROWSER_TREE_STORAGE_KEY = 'crystelf_web_console_file_tree_expanded_dirs';
const FILE_BROWSER_SIDEBAR_WIDTH_STORAGE_KEY = 'crystelf_web_console_sidebar_width';
const FILE_BROWSER_MAX_OPEN_TABS = 8;

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readPersistedSidebarWidth() {
  try {
    const raw = window.localStorage.getItem(FILE_BROWSER_SIDEBAR_WIDTH_STORAGE_KEY);
    const value = Number(raw);
    return Number.isFinite(value) ? value : 340;
  } catch {
    return 340;
  }
}

function getSidebarWidthLimits() {
  const viewportWidth = Math.max(window.innerWidth || 0, 960);
  return {
    min: 280,
    max: Math.max(360, Math.min(560, Math.floor(viewportWidth * 0.52))),
  };
}

function clampSidebarWidth(value) {
  const limits = getSidebarWidthLimits();
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.min(Math.max(340, limits.min), limits.max);
  }
  return Math.min(Math.max(Math.round(numeric), limits.min), limits.max);
}

function persistSidebarWidth() {
  try {
    window.localStorage.setItem(
      FILE_BROWSER_SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampSidebarWidth(fileBrowserState.sidebarWidth)),
    );
  } catch {}
}

function applySidebarWidth() {
  const shell = $('file-browser-shell');
  const resizer = $('file-browser-sidebar-resizer');
  fileBrowserState.sidebarWidth = clampSidebarWidth(fileBrowserState.sidebarWidth);
  if (shell) {
    shell.style.setProperty('--file-browser-sidebar-width', `${fileBrowserState.sidebarWidth}px`);
  }
  if (resizer) {
    resizer.setAttribute('aria-valuemin', String(getSidebarWidthLimits().min));
    resizer.setAttribute('aria-valuemax', String(getSidebarWidthLimits().max));
    resizer.setAttribute('aria-valuenow', String(fileBrowserState.sidebarWidth));
    resizer.title = `拖拽调整目录树宽度（${fileBrowserState.sidebarWidth}px）`;
  }
}

function setSidebarWidth(value, options = {}) {
  fileBrowserState.sidebarWidth = clampSidebarWidth(value);
  applySidebarWidth();
  if (options.persist !== false) {
    persistSidebarWidth();
  }
}

function stopSidebarResize() {
  if (!fileBrowserState.sidebarResizeActive) {
    return;
  }
  fileBrowserState.sidebarResizeActive = false;
  document.body.classList.remove('is-resizing-file-browser');
}

function beginSidebarResize(clientX) {
  if ((window.innerWidth || 0) <= 980) {
    return;
  }
  fileBrowserState.sidebarResizeActive = true;
  fileBrowserState.sidebarResizeStartX = Number(clientX || 0);
  fileBrowserState.sidebarResizeStartWidth = fileBrowserState.sidebarWidth;
  document.body.classList.add('is-resizing-file-browser');
}

function updateSidebarResize(clientX) {
  if (!fileBrowserState.sidebarResizeActive) {
    return;
  }
  const delta = Number(clientX || 0) - fileBrowserState.sidebarResizeStartX;
  setSidebarWidth(fileBrowserState.sidebarResizeStartWidth + delta, { persist: false });
}

function formatBytes(size) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current >= 10 || index === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[index]}`;
}

function formatTime(value) {
  const time = Number(value || 0);
  if (!time) return '-';
  try {
    return new Date(time).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(time);
  }
}

function normalizeRelativePath(value = '') {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function getInitialOpenPathFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return normalizeRelativePath(params.get('path') || params.get('open') || '');
  } catch {
    return '';
  }
}

function getParentPath(value = '') {
  const normalized = normalizeRelativePath(value);
  if (!normalized || !normalized.includes('/')) {
    return '';
  }
  return normalized.split('/').slice(0, -1).join('/');
}

function getPathName(value = '') {
  const normalized = normalizeRelativePath(value);
  if (!normalized) {
    return '/';
  }
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function createOpenTab(file) {
  const pathValue = normalizeRelativePath(file?.path || '');
  return {
    path: pathValue,
    name: file?.name || getPathName(pathValue),
  };
}

function rememberOpenTab(file) {
  const tab = createOpenTab(file);
  if (!tab.path) {
    return;
  }
  const nextTabs = fileBrowserState.openTabs.filter(item => item.path !== tab.path);
  nextTabs.push(tab);
  fileBrowserState.openTabs = nextTabs.slice(-FILE_BROWSER_MAX_OPEN_TABS);
}

function removeOpenTab(pathValue = '') {
  const normalizedPath = normalizeRelativePath(pathValue);
  fileBrowserState.openTabs = fileBrowserState.openTabs.filter(item => item.path !== normalizedPath);
}

function replaceOpenTabPath(sourcePath = '', targetPath = '') {
  const source = normalizeRelativePath(sourcePath);
  const target = normalizeRelativePath(targetPath);
  if (!source || !target) {
    return;
  }
  fileBrowserState.openTabs = fileBrowserState.openTabs.map(item => {
    if (item.path !== source) {
      return item;
    }
    return {
      path: target,
      name: getPathName(target),
    };
  });
}

function getEditorOffsetForLineColumn(content = '', lineNumber = 1, columnNumber = 1) {
  const normalizedLine = Math.max(1, Number(lineNumber || 1));
  const normalizedColumn = Math.max(1, Number(columnNumber || 1));
  const lines = String(content || '').split('\n');
  let offset = 0;
  for (let index = 0; index < normalizedLine - 1 && index < lines.length; index += 1) {
    offset += lines[index].length + 1;
  }
  const currentLine = lines[Math.min(normalizedLine - 1, Math.max(lines.length - 1, 0))] || '';
  offset += Math.min(normalizedColumn - 1, currentLine.length);
  return offset;
}

function focusEditorSelection(selection = null) {
  const editor = $('file-browser-editor');
  if (!editor || !selection) {
    return false;
  }
  const content = editor.value || '';
  const start = getEditorOffsetForLineColumn(content, selection.lineNumber, selection.columnNumber);
  const length = Math.max(0, Number(selection.matchLength || 0));
  const end = Math.min(content.length, start + length);
  editor.focus();
  editor.setSelectionRange(start, end > start ? end : start);
  const lineHeight = Number.parseFloat(window.getComputedStyle(editor).lineHeight || '22') || 22;
  editor.scrollTop = Math.max(0, (Math.max(1, Number(selection.lineNumber || 1)) - 3) * lineHeight);
  return true;
}

function tryApplyPendingEditorSelection(attempt = 0) {
  const pending = fileBrowserState.pendingEditorSelection;
  if (!pending || normalizeRelativePath(fileBrowserState.selectedFile?.path || '') !== normalizeRelativePath(pending.path || '')) {
    return;
  }
  const editor = $('file-browser-editor');
  const expectedStart = getEditorOffsetForLineColumn(
    editor?.value || '',
    pending.lineNumber,
    pending.columnNumber,
  );
  const applied = focusEditorSelection(pending);
  const actualStart = Number(editor?.selectionStart ?? -1);

  if (applied && actualStart === expectedStart) {
    fileBrowserState.pendingEditorSelection = null;
    return;
  }

  if (attempt >= 4) {
    fileBrowserState.pendingEditorSelection = null;
    return;
  }

  window.setTimeout(() => {
    tryApplyPendingEditorSelection(attempt + 1);
  }, attempt === 0 ? 0 : 40);
}

function applyPendingEditorSelection() {
  window.requestAnimationFrame(() => {
    tryApplyPendingEditorSelection(0);
  });
}
