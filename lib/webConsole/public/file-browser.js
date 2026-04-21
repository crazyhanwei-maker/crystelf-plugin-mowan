const fileBrowserState = {
  auth: null,
  currentDir: '',
  currentDirectoryInfo: null,
  root: null,
  entries: [],
  selectedFile: null,
  selectedContent: '',
  lastSavedContent: '',
  pendingEditorSelection: null,
  searchKeyword: '',
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
  renamingNode: false,
  deletingNode: false,
  modalResolver: null,
  viewMode: 'edit',
  previewLoading: false,
  previewHtml: '',
  previewLanguage: '',
  previewDetectedLanguage: '',
  previewLineCount: 0,
  previewByteLength: 0,
  previewError: '',
  previewTimer: 0,
  previewRequestId: 0,
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

function getProjectSearchPreviewHtml(text = '', query = '', caseSensitive = false) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!needle) {
    return escapeHtml(source);
  }
  const flags = caseSensitive ? 'g' : 'gi';
  return escapeHtml(source).replace(new RegExp(escapeRegExp(needle), flags), match => `<mark>${match}</mark>`);
}

function renderProjectSearchPanel() {
  const panel = $('file-browser-project-search-panel');
  const status = $('file-browser-project-search-status');
  const results = $('file-browser-project-search-results');
  if (!panel || !status || !results) {
    return;
  }

  const searchState = fileBrowserState.projectSearch;
  const query = String(searchState.query || '').trim();
  panel.classList.toggle('hidden', !searchState.loading && !searchState.searched && !searchState.results.length);

  if (searchState.loading) {
    panel.classList.remove('hidden');
    status.textContent = `正在搜索 “${query}”...`;
    results.innerHTML = '<div class="file-browser-project-search-empty">正在扫描项目中的文本文件，请稍候...</div>';
    return;
  }

  if (!searchState.searched) {
    status.textContent = '输入关键字开始搜索';
    results.innerHTML = '';
    return;
  }

  const scopeLabel = searchState.scopePath ? `目录 ${searchState.scopePath}` : '整个项目';
  if (!searchState.results.length) {
    status.textContent = `在${scopeLabel}中未找到 “${query}”`;
    results.innerHTML = '<div class="file-browser-project-search-empty">没有匹配结果，试试更短的关键字或关闭大小写限制。</div>';
    return;
  }

  status.textContent = `在${scopeLabel}中找到 ${searchState.results.length} 条命中${searchState.truncated ? '，结果已截断' : ''}`;
  results.innerHTML = searchState.results.map((item, index) => `
    <button
      type="button"
      class="file-browser-project-search-result"
      data-project-search-result-index="${index}"
    >
      <div class="file-browser-project-search-meta">
        <span class="file-browser-project-search-path">${escapeHtml(item.path)}</span>
        <span class="file-browser-project-search-line">第 ${item.lineNumber} 行 · 列 ${item.columnNumber}</span>
      </div>
      <div class="file-browser-project-search-preview">${getProjectSearchPreviewHtml(item.preview, query, searchState.caseSensitive)}</div>
    </button>
  `).join('');
}

function findCachedTreeEntry(pathValue = '', entryType = '') {
  const normalizedPath = normalizeRelativePath(pathValue);
  if (!normalizedPath && fileBrowserState.currentDirectoryInfo && entryType === 'directory') {
    return fileBrowserState.currentDirectoryInfo;
  }
  for (const entries of Object.values(fileBrowserState.treeCache)) {
    if (!Array.isArray(entries)) continue;
    const matched = entries.find(entry => (
      normalizeRelativePath(entry.path) === normalizedPath
      && (!entryType || entry.type === entryType)
    ));
    if (matched) {
      return matched;
    }
  }
  if (fileBrowserState.selectedFile?.path && normalizeRelativePath(fileBrowserState.selectedFile.path) === normalizedPath) {
    return fileBrowserState.selectedFile;
  }
  if (fileBrowserState.currentDirectoryInfo?.path !== undefined
    && normalizeRelativePath(fileBrowserState.currentDirectoryInfo.path) === normalizedPath
    && (!entryType || entryType === 'directory')) {
    return fileBrowserState.currentDirectoryInfo;
  }
  return null;
}

function createTreeTarget(pathValue = '', entryType = 'file') {
  const normalizedPath = normalizeRelativePath(pathValue);
  const entry = findCachedTreeEntry(normalizedPath, entryType) || {};
  return {
    type: entryType,
    path: normalizedPath,
    name: entry.name || getPathName(normalizedPath),
    editable: entry.editable,
  };
}

function getActiveTreeDirectoryPath() {
  if (fileBrowserState.selectedFile?.path) {
    return getParentPath(fileBrowserState.selectedFile.path);
  }
  if (fileBrowserState.currentDirectoryInfo) {
    return normalizeRelativePath(fileBrowserState.currentDirectoryInfo.path);
  }
  return '';
}

function getActiveTreePathChain() {
  return new Set(createPathChain(getActiveTreeDirectoryPath()));
}

function createPathChain(pathValue = '') {
  const normalized = normalizeRelativePath(pathValue);
  const chain = [''];
  if (!normalized) {
    return chain;
  }
  let current = '';
  for (const segment of normalized.split('/')) {
    current = current ? `${current}/${segment}` : segment;
    chain.push(current);
  }
  return chain;
}

function fetchDirectoryPayload(pathValue = '') {
  return fetchJson(`/api/file-browser/tree?path=${encodeURIComponent(pathValue)}`);
}

function readPersistedExpandedDirs() {
  try {
    const raw = window.localStorage.getItem(FILE_BROWSER_TREE_STORAGE_KEY);
    const values = JSON.parse(raw || '[]');
    if (!Array.isArray(values)) {
      return new Set(['']);
    }
    return new Set(['', ...values.map(item => normalizeRelativePath(item)).filter(Boolean)]);
  } catch {
    return new Set(['']);
  }
}

function persistExpandedDirs() {
  try {
    const values = Array.from(fileBrowserState.expandedDirs)
      .map(item => normalizeRelativePath(item))
      .filter(Boolean)
      .sort();
    window.localStorage.setItem(FILE_BROWSER_TREE_STORAGE_KEY, JSON.stringify(values));
  } catch {}
}

function resetTreeState(nextRootPath = '') {
  const normalizedRoot = normalizeRelativePath(nextRootPath);
  fileBrowserState.treeCache = Object.create(null);
  fileBrowserState.expandedDirs = readPersistedExpandedDirs();
  fileBrowserState.expandedDirs.add(normalizedRoot);
  fileBrowserState.expandedDirs.add('');
  fileBrowserState.treeLoadingDirs = new Set();
  fileBrowserState.restoredExpandedTree = false;
  persistExpandedDirs();
}

function syncCurrentDirectoryTree() {
  const currentPath = normalizeRelativePath(fileBrowserState.currentDir);
  fileBrowserState.treeCache[currentPath] = Array.isArray(fileBrowserState.entries)
    ? fileBrowserState.entries.map(entry => ({ ...entry }))
    : [];
  for (const pathValue of createPathChain(currentPath)) {
    fileBrowserState.expandedDirs.add(pathValue);
  }
  persistExpandedDirs();
}

function getTreeEntries(pathValue = '') {
  const normalized = normalizeRelativePath(pathValue);
  return Array.isArray(fileBrowserState.treeCache[normalized]) ? fileBrowserState.treeCache[normalized] : [];
}

function isTreeDirectoryExpanded(pathValue = '') {
  return fileBrowserState.expandedDirs.has(normalizeRelativePath(pathValue));
}

function setTreeDirectoryExpanded(pathValue = '', expanded = true) {
  const normalized = normalizeRelativePath(pathValue);
  if (expanded) {
    fileBrowserState.expandedDirs.add(normalized);
    persistExpandedDirs();
    return;
  }
  if (normalized === normalizeRelativePath(fileBrowserState.currentDir)) {
    return;
  }
  fileBrowserState.expandedDirs.delete(normalized);
  persistExpandedDirs();
}

function countExpandedDirectories() {
  return Math.max(0, fileBrowserState.expandedDirs.size - 1);
}

function getTreeFilterLabel() {
  if (fileBrowserState.treeFilter === 'directory') return '仅目录';
  if (fileBrowserState.treeFilter === 'file') return '仅文件';
  return '全部节点';
}

function expandCurrentTreePath() {
  for (const pathValue of createPathChain(getActiveTreeDirectoryPath())) {
    fileBrowserState.expandedDirs.add(pathValue);
  }
  persistExpandedDirs();
  renderTree();
  scheduleTreeFocus();
  updateActionButtons();
}

function collapseTreeToActivePath() {
  fileBrowserState.expandedDirs = new Set(createPathChain(getActiveTreeDirectoryPath()));
  fileBrowserState.expandedDirs.add('');
  persistExpandedDirs();
  renderTree();
  scheduleTreeFocus();
  updateActionButtons();
}

async function ensureTreePathVisible(pathValue = '', options = {}) {
  const targetPath = normalizeRelativePath(pathValue);
  const chain = createPathChain(targetPath);
  for (const currentPath of chain) {
    fileBrowserState.expandedDirs.add(currentPath);
  }
  persistExpandedDirs();

  for (let index = 0; index < chain.length - 1; index += 1) {
    const currentPath = chain[index];
    if (!Array.isArray(fileBrowserState.treeCache[currentPath])) {
      await hydrateTreeDirectory(currentPath, { render: false });
    }
  }

  if (options.finalEntries) {
    fileBrowserState.treeCache[targetPath] = options.finalEntries.map(entry => ({ ...entry }));
    return fileBrowserState.treeCache[targetPath];
  }

  if (!Array.isArray(fileBrowserState.treeCache[targetPath])) {
    await hydrateTreeDirectory(targetPath, { render: false });
  }
  return fileBrowserState.treeCache[targetPath] || [];
}

async function restoreExpandedTreeEntries() {
  if (fileBrowserState.restoredExpandedTree) {
    return;
  }
  fileBrowserState.restoredExpandedTree = true;
  const targets = Array.from(fileBrowserState.expandedDirs)
    .map(item => normalizeRelativePath(item))
    .filter(Boolean)
    .sort((left, right) => left.split('/').length - right.split('/').length);

  for (const pathValue of targets) {
    await ensureTreePathVisible(pathValue);
  }
}

function getPreferredTreeFocusPath() {
  if (fileBrowserState.selectedFile?.path) {
    return normalizeRelativePath(fileBrowserState.selectedFile.path);
  }
  if (fileBrowserState.currentDirectoryInfo) {
    return normalizeRelativePath(fileBrowserState.currentDirectoryInfo.path);
  }
  return '';
}

function focusTreeNodeNow(pathValue = '') {
  const targetPath = normalizeRelativePath(pathValue || getPreferredTreeFocusPath());
  if (!targetPath) {
    return false;
  }
  const list = $('file-browser-entry-list');
  const node = Array.from(document.querySelectorAll('[data-tree-open-path]'))
    .find(item => normalizeRelativePath(item.dataset.treeOpenPath || '') === targetPath);
  if (!node || !list) {
    return false;
  }

  const padding = 12;
  const listRect = list.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const targetTop = nodeRect.top - listRect.top + list.scrollTop - padding;
  const targetBottom = nodeRect.bottom - listRect.top + list.scrollTop + padding;
  const viewportTop = list.scrollTop;
  const viewportBottom = viewportTop + list.clientHeight;

  if (targetTop < viewportTop) {
    list.scrollTop = Math.max(0, targetTop);
    return true;
  }
  if (targetBottom > viewportBottom) {
    list.scrollTop = Math.max(0, targetBottom - list.clientHeight);
    return true;
  }
  return true;
}

function scheduleTreeFocus(pathValue = '') {
  const normalizedPath = normalizeRelativePath(pathValue || getPreferredTreeFocusPath());
  fileBrowserState.pendingTreeFocusPath = normalizedPath;
  if (focusTreeNodeNow(normalizedPath)) {
    return;
  }
  if (fileBrowserState.treeFocusTimer) {
    window.cancelAnimationFrame(fileBrowserState.treeFocusTimer);
    fileBrowserState.treeFocusTimer = 0;
  }
  fileBrowserState.treeFocusTimer = window.requestAnimationFrame(() => {
    fileBrowserState.treeFocusTimer = 0;
    focusTreeNodeNow(fileBrowserState.pendingTreeFocusPath);
  });
}

function resetPreviewState() {
  if (fileBrowserState.previewTimer) {
    window.clearTimeout(fileBrowserState.previewTimer);
    fileBrowserState.previewTimer = 0;
  }
  fileBrowserState.previewLoading = false;
  fileBrowserState.previewHtml = '';
  fileBrowserState.previewLanguage = '';
  fileBrowserState.previewDetectedLanguage = '';
  fileBrowserState.previewLineCount = 0;
  fileBrowserState.previewByteLength = 0;
  fileBrowserState.previewError = '';
  fileBrowserState.previewRequestId += 1;
}

function clearSelectedFile() {
  fileBrowserState.selectedFile = null;
  fileBrowserState.selectedContent = '';
  fileBrowserState.lastSavedContent = '';
  fileBrowserState.pendingEditorSelection = null;
  fileBrowserState.editorSearch.currentMatchIndex = -1;
  resetPreviewState();
}

function getCurrentTarget() {
  if (fileBrowserState.selectedFile?.path) {
    return {
      type: 'file',
      path: fileBrowserState.selectedFile.path,
      name: fileBrowserState.selectedFile.name || fileBrowserState.selectedFile.path,
    };
  }
  if (fileBrowserState.currentDirectoryInfo) {
    return {
      type: 'directory',
      path: fileBrowserState.currentDirectoryInfo.path,
      name: fileBrowserState.currentDirectoryInfo.name || fileBrowserState.currentDirectoryInfo.path,
    };
  }
  return null;
}

function closeContextMenu() {
  fileBrowserState.contextMenu.visible = false;
  fileBrowserState.contextMenu.target = null;
  const menu = $('file-browser-context-menu');
  if (!menu) return;
  menu.classList.add('hidden');
  menu.innerHTML = '';
  menu.style.left = '0px';
  menu.style.top = '0px';
}

function getContextMenuDirectoryBase(target) {
  return target?.type === 'directory'
    ? normalizeRelativePath(target.path)
    : getParentPath(target?.path || '');
}

function getContextMenuItems(target) {
  if (!target?.path && target?.type !== 'directory') {
    return [];
  }
  const readOnly = fileBrowserState.auth?.readOnly === true;
  const isDirectory = target.type === 'directory';
  const targetDirectory = getContextMenuDirectoryBase(target);
  const canMutate = !readOnly && Boolean(target.path);
  const isCurrentDirectory = isDirectory
    && normalizeRelativePath(target.path) === normalizeRelativePath(fileBrowserState.currentDir);
  const items = [
    { id: 'open', label: isDirectory ? '打开目录' : '打开文件', meta: 'Enter' },
    { id: 'copy-path', label: '复制相对路径', meta: 'Path' },
  ];

  if (isDirectory) {
    items.push({
      id: isTreeDirectoryExpanded(target.path) ? 'collapse-dir' : 'expand-dir',
      label: isTreeDirectoryExpanded(target.path)
        ? (isCurrentDirectory ? '当前目录保持展开' : '折叠目录')
        : '展开目录',
      meta: isCurrentDirectory ? 'Lock' : 'Tree',
      disabled: isTreeDirectoryExpanded(target.path) && isCurrentDirectory,
    });
  } else {
    items.push({ id: 'open-parent', label: '打开所在目录', meta: 'Dir' });
  }

  items.push({ type: 'separator' });
  items.push({
    id: 'new-file',
    label: isDirectory ? '在此新建文件' : '在同级新建文件',
    meta: 'New',
    disabled: readOnly,
    baseDir: targetDirectory,
  });
  items.push({
    id: 'new-dir',
    label: isDirectory ? '在此新建目录' : '在同级新建目录',
    meta: 'New',
    disabled: readOnly,
    baseDir: targetDirectory,
  });
  items.push({ type: 'separator' });
  items.push({ id: 'rename', label: '重命名', meta: 'Edit', disabled: !canMutate });
  items.push({ id: 'delete', label: '删除', meta: 'Del', disabled: !canMutate });
  return items;
}

function renderContextMenu() {
  const menu = $('file-browser-context-menu');
  const { visible, target, x, y } = fileBrowserState.contextMenu;
  if (!menu) return;
  if (!visible || !target) {
    closeContextMenu();
    return;
  }

  const items = getContextMenuItems(target);
  if (!items.length) {
    closeContextMenu();
    return;
  }

  menu.innerHTML = `
    <div class="file-browser-context-menu-group">
      ${items.map(item => {
        if (item.type === 'separator') {
          return '<div class="file-browser-context-menu-separator"></div>';
        }
        return `
          <button
            type="button"
            class="file-browser-context-menu-item"
            data-context-action="${escapeHtml(item.id)}"
            ${item.baseDir ? `data-context-base-dir="${escapeHtml(item.baseDir)}"` : ''}
            ${item.disabled ? 'disabled' : ''}
          >
            <span class="file-browser-context-menu-label">${escapeHtml(item.label)}</span>
            <span class="file-browser-context-menu-meta">${escapeHtml(item.meta || '')}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
  menu.classList.remove('hidden');
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;

  window.requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const nextLeft = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - rect.width - 8));
    const nextTop = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - rect.height - 8));
    menu.style.left = `${nextLeft}px`;
    menu.style.top = `${nextTop}px`;
  });
}

function openContextMenu(target, position = {}) {
  fileBrowserState.contextMenu.visible = true;
  fileBrowserState.contextMenu.target = target;
  fileBrowserState.contextMenu.x = Number(position.x || 0);
  fileBrowserState.contextMenu.y = Number(position.y || 0);
  renderContextMenu();
}

async function copyText(text = '') {
  const value = String(text || '').trim();
  if (!value) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back to execCommand for browsers that block clipboard writes without focus.
    }
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', 'readonly');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  input.focus();
  input.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    input.remove();
  }
  return copied;
}

function getEditorContent() {
  return $('file-browser-editor')?.value || '';
}

function isDirty() {
  return Boolean(fileBrowserState.selectedFile) && getEditorContent() !== fileBrowserState.lastSavedContent;
}

function setBanner(message = '', tone = '') {
  const element = $('file-browser-editor-status');
  if (!element) return;
  element.textContent = message;
  element.className = `file-browser-banner${message ? '' : ' hidden'}${tone ? ` tone-${tone}` : ''}`;
}

function setAuthBanner(message = '', tone = '') {
  const element = $('file-browser-auth-banner');
  if (!element) return;
  element.textContent = message;
  element.className = `file-browser-banner${message ? '' : ' hidden'}${tone ? ` tone-${tone}` : ''}`;
}

function closeModal(result = null) {
  $('file-browser-modal-mask')?.classList.add('hidden');
  $('file-browser-modal-confirm-btn')?.classList.remove('danger');
  if (typeof fileBrowserState.modalResolver === 'function') {
    const resolve = fileBrowserState.modalResolver;
    fileBrowserState.modalResolver = null;
    resolve(result);
  }
}

function openModal({
  title = '操作确认',
  content = '',
  html = false,
  confirmText = '确定',
  cancelText = '取消',
  showCancel = true,
  danger = false,
  cardClass = '',
  contentClass = '',
} = {}) {
  $('file-browser-modal-title').textContent = title;
  const cardElement = document.querySelector('#file-browser-modal-mask .modal-card');
  const contentElement = $('file-browser-modal-content');
  if (cardElement) {
    cardElement.className = `modal-card${cardClass ? ` ${cardClass}` : ''}`;
  }
  contentElement.className = `modal-content${contentClass ? ` ${contentClass}` : ''}`;
  if (html) {
    contentElement.innerHTML = content;
  } else {
    contentElement.textContent = content;
  }

  const confirmButton = $('file-browser-modal-confirm-btn');
  const cancelButton = $('file-browser-modal-cancel-btn');
  confirmButton.textContent = confirmText;
  cancelButton.textContent = cancelText;
  cancelButton.classList.toggle('hidden', !showCancel);
  confirmButton.classList.toggle('danger', danger);
  $('file-browser-modal-mask').classList.remove('hidden');

  window.setTimeout(() => {
    const input = $('file-browser-modal-input');
    if (input) {
      input.onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          $('file-browser-modal-confirm-btn')?.click();
        }
      };
      input.focus();
      input.select();
      return;
    }
    confirmButton.focus();
  }, 0);

  return new Promise(resolve => {
    fileBrowserState.modalResolver = resolve;
  });
}

async function openConfirmDialog({
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return await openModal({
    title,
    content: message,
    confirmText,
    cancelText,
    danger,
  });
}

async function openPromptDialog({
  title,
  label,
  value = '',
  placeholder = '',
  help = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  const escapedValue = escapeHtml(value);
  const escapedPlaceholder = escapeHtml(placeholder);
  const escapedLabel = escapeHtml(label);
  const escapedHelp = help ? `<div class="file-browser-modal-help">${escapeHtml(help)}</div>` : '';
  const confirmed = await openModal({
    title,
    confirmText,
    cancelText,
    danger,
    html: true,
    content: `
      <div class="file-browser-modal-form">
        <label for="file-browser-modal-input">${escapedLabel}</label>
        <input id="file-browser-modal-input" type="text" value="${escapedValue}" placeholder="${escapedPlaceholder}" />
        ${escapedHelp}
      </div>
    `,
  });
  if (!confirmed) {
    return null;
  }
  return normalizeRelativePath($('file-browser-modal-input')?.value || '');
}

function normalizeConflictTextLines(content = '') {
  return String(content || '').replace(/\r\n?/g, '\n').split('\n');
}

function countConflictContentLines(content = '') {
  return normalizeConflictTextLines(content).length;
}

function formatConflictLineRange(startIndex = 0, lineCount = 0) {
  const start = Math.max(1, Number(startIndex || 0) + 1);
  const end = Math.max(start, start + Math.max(0, Number(lineCount || 0)) - 1);
  return start === end ? `第 ${start} 行` : `第 ${start}-${end} 行`;
}

function buildConflictPreviewItems(lines = [], startIndex = 0, maxLines = 18) {
  const numbered = lines.map((text, index) => ({
    type: 'line',
    number: startIndex + index + 1,
    text,
  }));
  if (numbered.length <= maxLines) {
    return numbered;
  }
  const headCount = 10;
  const tailCount = 6;
  const hiddenCount = Math.max(0, numbered.length - headCount - tailCount);
  return [
    ...numbered.slice(0, headCount),
    { type: 'gap', text: `... 中间省略 ${hiddenCount} 行 ...` },
    ...numbered.slice(-tailCount),
  ];
}

function buildSaveConflictDiffHtml({
  path = '',
  localContent = '',
  diskContent = '',
  expectedMtimeMs = 0,
  actualMtimeMs = 0,
} = {}) {
  const localLines = normalizeConflictTextLines(localContent);
  const diskLines = normalizeConflictTextLines(diskContent);
  let startIndex = 0;
  while (
    startIndex < localLines.length
    && startIndex < diskLines.length
    && localLines[startIndex] === diskLines[startIndex]
  ) {
    startIndex += 1;
  }

  let localEnd = localLines.length - 1;
  let diskEnd = diskLines.length - 1;
  while (localEnd >= startIndex && diskEnd >= startIndex && localLines[localEnd] === diskLines[diskEnd]) {
    localEnd -= 1;
    diskEnd -= 1;
  }

  const localChanged = localEnd >= startIndex ? localLines.slice(startIndex, localEnd + 1) : [];
  const diskChanged = diskEnd >= startIndex ? diskLines.slice(startIndex, diskEnd + 1) : [];
  const renderPanel = (title, items, tone, lineCount, startLine) => `
    <section class="file-browser-conflict-panel tone-${tone}">
      <div class="file-browser-conflict-panel-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(formatConflictLineRange(startLine, lineCount))}</span>
      </div>
      <div class="file-browser-conflict-code">
        ${items.length ? items.map(item => {
          if (item.type === 'gap') {
            return `<div class="file-browser-conflict-gap">${escapeHtml(item.text)}</div>`;
          }
          return `
            <div class="file-browser-conflict-line">
              <span class="file-browser-conflict-line-no">${item.number}</span>
              <span class="file-browser-conflict-line-text">${escapeHtml(item.text)}</span>
            </div>
          `;
        }).join('') : '<div class="file-browser-conflict-empty">此处没有文本内容。</div>'}
      </div>
    </section>
  `;

  return `
    <div class="file-browser-conflict-summary">
      <div class="file-browser-conflict-title">${escapeHtml(path)}</div>
      <div class="file-browser-conflict-meta">
        <span>你上次载入：${escapeHtml(formatTime(expectedMtimeMs) || '-')}</span>
        <span>磁盘当前：${escapeHtml(formatTime(actualMtimeMs) || '-')}</span>
        <span>本地 ${countConflictContentLines(localContent)} 行</span>
        <span>磁盘 ${countConflictContentLines(diskContent)} 行</span>
      </div>
      <div class="file-browser-conflict-note">检测到磁盘文件在你编辑期间发生变化。确认后会用编辑器里的内容强制覆盖磁盘版本；取消则保留你当前未保存的修改。</div>
    </div>
    <div class="file-browser-conflict-grid">
      ${renderPanel('磁盘当前版本', buildConflictPreviewItems(diskChanged, startIndex), 'warning', diskChanged.length, startIndex)}
      ${renderPanel('你的编辑器版本', buildConflictPreviewItems(localChanged, startIndex), 'success', localChanged.length, startIndex)}
    </div>
  `;
}

async function openSaveConflictDialog({
  path = '',
  localContent = '',
  diskContent = '',
  expectedMtimeMs = 0,
  actualMtimeMs = 0,
} = {}) {
  return await openModal({
    title: '保存冲突确认',
    confirmText: '强制覆盖保存',
    cancelText: '取消',
    danger: true,
    html: true,
    cardClass: 'file-browser-conflict-modal',
    contentClass: 'file-browser-conflict-content',
    content: buildSaveConflictDiffHtml({
      path,
      localContent,
      diskContent,
      expectedMtimeMs,
      actualMtimeMs,
    }),
  });
}

function updateDirtyIndicator() {
  const indicator = $('file-browser-dirty-indicator');
  if (!indicator) return;
  indicator.classList.toggle('hidden', !isDirty());
}

function updateFileStats() {
  const stats = $('file-browser-file-stats');
  if (!stats) return;

  if (fileBrowserState.selectedFile) {
    const content = getEditorContent();
    const lines = content ? content.split(/\r?\n/).length : 1;
    const chars = Array.from(content).length;
    const bytes = new TextEncoder().encode(content).length;
    stats.textContent = `${lines} 行 · ${chars} 字符 · ${formatBytes(bytes)}`;
    return;
  }

  if (fileBrowserState.currentDirectoryInfo) {
    stats.textContent = `目录视图 · 当前目录 ${fileBrowserState.entries.length} 项`;
    return;
  }

  stats.textContent = '暂无内容';
}

function getEditorSearchQuery() {
  return String($('file-browser-find-input')?.value || fileBrowserState.editorSearch.query || '');
}

function getEditorSearchReplacement() {
  return String($('file-browser-replace-input')?.value || fileBrowserState.editorSearch.replacement || '');
}

function normalizeSearchValue(value, caseSensitive = false) {
  return caseSensitive ? String(value || '') : String(value || '').toLocaleLowerCase();
}

function buildEditorSearchMatches(content, query, caseSensitive = false) {
  if (!query) {
    return [];
  }
  const source = normalizeSearchValue(content, caseSensitive);
  const needle = normalizeSearchValue(query, caseSensitive);
  if (!needle) {
    return [];
  }

  const matches = [];
  let cursor = 0;
  while (cursor <= source.length - needle.length) {
    const index = source.indexOf(needle, cursor);
    if (index === -1) {
      break;
    }
    matches.push({ start: index, end: index + query.length });
    cursor = index + Math.max(query.length, 1);
  }
  return matches;
}

function syncEditorSearchInputsFromState() {
  const queryInput = $('file-browser-find-input');
  const replaceInput = $('file-browser-replace-input');
  if (queryInput && queryInput.value !== fileBrowserState.editorSearch.query) {
    queryInput.value = fileBrowserState.editorSearch.query;
  }
  if (replaceInput && replaceInput.value !== fileBrowserState.editorSearch.replacement) {
    replaceInput.value = fileBrowserState.editorSearch.replacement;
  }
}

function updateEditorSearchStateFromInputs() {
  fileBrowserState.editorSearch.query = getEditorSearchQuery();
  fileBrowserState.editorSearch.replacement = getEditorSearchReplacement();
}

function refreshEditorSearchState() {
  updateEditorSearchStateFromInputs();
  const editor = $('file-browser-editor');
  const query = fileBrowserState.editorSearch.query;
  const matches = buildEditorSearchMatches(getEditorContent(), query, fileBrowserState.editorSearch.caseSensitive);
  fileBrowserState.editorSearch.matches = matches;

  if (!editor || !matches.length) {
    fileBrowserState.editorSearch.currentMatchIndex = -1;
    return;
  }

  const selectionStart = Number(editor.selectionStart || 0);
  const selectionEnd = Number(editor.selectionEnd || 0);
  const exactIndex = matches.findIndex(match => match.start === selectionStart && match.end === selectionEnd);
  if (exactIndex >= 0) {
    fileBrowserState.editorSearch.currentMatchIndex = exactIndex;
    return;
  }

  const previousMatch = matches[fileBrowserState.editorSearch.currentMatchIndex];
  if (previousMatch) {
    const stableIndex = matches.findIndex(match => match.start === previousMatch.start && match.end === previousMatch.end);
    fileBrowserState.editorSearch.currentMatchIndex = stableIndex;
    if (stableIndex >= 0) {
      return;
    }
  }

  fileBrowserState.editorSearch.currentMatchIndex = -1;
}

function renderEditorSearchPanel() {
  const panel = $('file-browser-find-panel');
  const replaceRow = $('file-browser-replace-row');
  const status = $('file-browser-find-status');
  const closeButton = $('file-browser-find-close-btn');
  const prevButton = $('file-browser-find-prev-btn');
  const nextButton = $('file-browser-find-next-btn');
  const replaceOneButton = $('file-browser-replace-one-btn');
  const replaceAllButton = $('file-browser-replace-all-btn');
  const caseButton = $('file-browser-find-case-btn');
  const findButton = $('file-browser-find-btn');
  const replaceButton = $('file-browser-replace-btn');
  if (!panel || !replaceRow || !status || !closeButton || !prevButton || !nextButton || !replaceOneButton || !replaceAllButton || !caseButton) {
    return;
  }

  syncEditorSearchInputsFromState();
  const hasFile = Boolean(fileBrowserState.selectedFile?.path);
  const query = fileBrowserState.editorSearch.query;
  const matchCount = fileBrowserState.editorSearch.matches.length;
  const currentIndex = fileBrowserState.editorSearch.currentMatchIndex;
  const readOnly = fileBrowserState.auth?.readOnly === true || fileBrowserState.selectedFile?.editable !== true;

  panel.classList.toggle('hidden', !fileBrowserState.editorSearch.visible || !hasFile);
  panel.classList.toggle('is-replace-mode', fileBrowserState.editorSearch.replaceMode);
  panel.classList.toggle('is-find-empty', !query);
  panel.classList.toggle('is-no-match', Boolean(query) && matchCount === 0);
  replaceRow.classList.toggle('hidden', !fileBrowserState.editorSearch.replaceMode);
  caseButton.classList.toggle('is-active', fileBrowserState.editorSearch.caseSensitive);
  findButton?.classList.toggle('is-active', fileBrowserState.editorSearch.visible && !fileBrowserState.editorSearch.replaceMode);
  replaceButton?.classList.toggle('is-active', fileBrowserState.editorSearch.visible && fileBrowserState.editorSearch.replaceMode);

  if (!query) {
    status.textContent = '输入关键字后开始查找';
  } else if (!matchCount) {
    status.textContent = `未找到 “${query}”`;
  } else if (currentIndex >= 0) {
    status.textContent = `${currentIndex + 1} / ${matchCount} 匹配`;
  } else {
    status.textContent = `共 ${matchCount} 个匹配`;
  }

  prevButton.disabled = !matchCount;
  nextButton.disabled = !matchCount;
  replaceOneButton.disabled = !fileBrowserState.editorSearch.replaceMode || !matchCount || readOnly;
  replaceAllButton.disabled = !fileBrowserState.editorSearch.replaceMode || !matchCount || readOnly;
  closeButton.disabled = false;
}

function renderOpenTabs() {
  const strip = $('file-browser-tab-strip');
  const list = $('file-browser-tab-list');
  if (!strip || !list) {
    return;
  }

  if (!fileBrowserState.openTabs.length) {
    strip.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  const activePath = normalizeRelativePath(fileBrowserState.selectedFile?.path || '');
  const dirtyPath = isDirty() ? activePath : '';
  strip.classList.remove('hidden');
  list.innerHTML = fileBrowserState.openTabs.map(tab => {
    const isActive = activePath === tab.path;
    const isDirty = dirtyPath === tab.path;
    return `
      <div class="file-browser-tab${isActive ? ' is-active' : ''}${isDirty ? ' is-dirty' : ''}">
        <div class="file-browser-tab-main">
          <button
            type="button"
            class="file-browser-tab-open"
            data-tab-open-path="${escapeHtml(tab.path)}"
            title="${escapeHtml(tab.path)}"
          >
            <span class="file-browser-tab-title">${isDirty ? '<span class="file-browser-tab-dirty-dot"></span>' : ''}${escapeHtml(tab.name)}</span>
            <span class="file-browser-tab-path">${escapeHtml(tab.path)}</span>
          </button>
        </div>
        <button
          type="button"
          class="file-browser-tab-close"
          data-tab-close-path="${escapeHtml(tab.path)}"
          aria-label="关闭文件标签 ${escapeHtml(tab.path)}"
          title="关闭 ${escapeHtml(tab.path)}"
        >×</button>
      </div>
    `;
  }).join('');
}

function selectEditorSearchMatch(index) {
  const editor = $('file-browser-editor');
  const matches = fileBrowserState.editorSearch.matches;
  if (!editor || !matches.length) {
    fileBrowserState.editorSearch.currentMatchIndex = -1;
    renderEditorSearchPanel();
    return false;
  }

  const normalizedIndex = ((index % matches.length) + matches.length) % matches.length;
  const match = matches[normalizedIndex];
  fileBrowserState.editorSearch.currentMatchIndex = normalizedIndex;
  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  renderEditorSearchPanel();
  return true;
}

function openEditorSearchPanel(options = {}) {
  if (!fileBrowserState.selectedFile?.path) {
    return;
  }
  const editor = $('file-browser-editor');
  const nextMode = options.replace === true;
  const selectedText = editor?.value?.slice(editor.selectionStart, editor.selectionEnd) || '';
  if (!fileBrowserState.editorSearch.query && selectedText) {
    fileBrowserState.editorSearch.query = selectedText;
  }
  fileBrowserState.editorSearch.visible = true;
  fileBrowserState.editorSearch.replaceMode = nextMode;
  syncEditorSearchInputsFromState();
  refreshEditorSearchState();
  renderEditorSearchPanel();

  window.setTimeout(() => {
    const targetInput = nextMode ? $('file-browser-replace-input') || $('file-browser-find-input') : $('file-browser-find-input');
    targetInput?.focus();
    if (targetInput) {
      targetInput.select();
    }
  }, 0);
}

function closeEditorSearchPanel({ focusEditor = true } = {}) {
  fileBrowserState.editorSearch.visible = false;
  fileBrowserState.editorSearch.replaceMode = false;
  fileBrowserState.editorSearch.currentMatchIndex = -1;
  renderEditorSearchPanel();
  if (focusEditor) {
    $('file-browser-editor')?.focus();
  }
}

function navigateEditorSearch(direction = 1) {
  refreshEditorSearchState();
  const editor = $('file-browser-editor');
  const matches = fileBrowserState.editorSearch.matches;
  if (!editor || !matches.length) {
    renderEditorSearchPanel();
    return false;
  }

  let nextIndex = fileBrowserState.editorSearch.currentMatchIndex;
  if (nextIndex < 0) {
    const selectionAnchor = direction >= 0 ? Number(editor.selectionEnd || 0) : Number(editor.selectionStart || 0);
    if (direction >= 0) {
      nextIndex = matches.findIndex(match => match.start >= selectionAnchor);
      if (nextIndex < 0) {
        nextIndex = 0;
      }
    } else {
      nextIndex = matches.length - 1;
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        if (matches[index].end <= selectionAnchor) {
          nextIndex = index;
          break;
        }
      }
    }
  } else {
    nextIndex += direction;
  }

  return selectEditorSearchMatch(nextIndex);
}

function replaceCurrentEditorSearchMatch() {
  if (fileBrowserState.auth?.readOnly || fileBrowserState.selectedFile?.editable !== true) {
    return;
  }
  refreshEditorSearchState();
  const editor = $('file-browser-editor');
  const matches = fileBrowserState.editorSearch.matches;
  if (!editor || !matches.length) {
    renderEditorSearchPanel();
    return;
  }

  let index = fileBrowserState.editorSearch.currentMatchIndex;
  if (index < 0) {
    const matched = navigateEditorSearch(1);
    if (!matched) {
      return;
    }
    index = fileBrowserState.editorSearch.currentMatchIndex;
  }

  const match = fileBrowserState.editorSearch.matches[index];
  if (!match) {
    return;
  }

  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  editor.setRangeText(fileBrowserState.editorSearch.replacement, match.start, match.end, 'select');
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  refreshEditorSearchState();
  renderEditorSearchPanel();
  setBanner('当前匹配已替换。', 'success');
}

function replaceAllEditorSearchMatches() {
  if (fileBrowserState.auth?.readOnly || fileBrowserState.selectedFile?.editable !== true) {
    return;
  }
  refreshEditorSearchState();
  const editor = $('file-browser-editor');
  const matches = fileBrowserState.editorSearch.matches;
  if (!editor || !matches.length) {
    renderEditorSearchPanel();
    return;
  }

  const content = getEditorContent();
  let cursor = 0;
  let nextContent = '';
  for (const match of matches) {
    nextContent += content.slice(cursor, match.start);
    nextContent += fileBrowserState.editorSearch.replacement;
    cursor = match.end;
  }
  nextContent += content.slice(cursor);

  editor.value = nextContent;
  editor.setSelectionRange(0, 0);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  refreshEditorSearchState();
  renderEditorSearchPanel();
  setBanner(`已替换 ${matches.length} 处匹配。`, 'success');
}

function renderEditorActionBar() {
  const bar = $('file-browser-editor-action-bar');
  const title = $('file-browser-editor-action-title');
  const subtitle = $('file-browser-editor-action-subtitle');
  if (!bar || !title || !subtitle) return;

  const file = fileBrowserState.selectedFile;
  if (!file?.path) {
    bar.classList.add('hidden');
    bar.classList.remove('is-dirty');
    title.textContent = '未选择文件';
    subtitle.textContent = '选择文本文件后即可在这里保存或重载。';
    renderOpenTabs();
    return;
  }

  const readOnly = fileBrowserState.auth?.readOnly === true;
  const editable = file.editable === true && !readOnly;
  const dirty = isDirty();
  bar.classList.remove('hidden');
  bar.classList.toggle('is-dirty', dirty);
  title.textContent = file.path;

  const parts = [];
  parts.push(dirty ? '有未保存修改' : '已与磁盘同步');
  parts.push(editable ? '可直接保存' : '当前只读');
  parts.push('支持 Ctrl/Cmd + S / F / H');
  subtitle.textContent = parts.join(' · ');
  renderOpenTabs();
}

async function switchOpenTab(pathValue = '') {
  const normalizedPath = normalizeRelativePath(pathValue);
  if (!normalizedPath || normalizedPath === normalizeRelativePath(fileBrowserState.selectedFile?.path || '')) {
    return;
  }
  await openPath(normalizedPath);
}

async function closeOpenTabByPath(pathValue = '') {
  const normalizedPath = normalizeRelativePath(pathValue);
  if (!normalizedPath) {
    return;
  }
  const closingActive = normalizedPath === normalizeRelativePath(fileBrowserState.selectedFile?.path || '');
  if (closingActive && !await confirmDiscardIfNeeded()) {
    return;
  }

  const currentTabs = [...fileBrowserState.openTabs];
  const closingIndex = currentTabs.findIndex(item => item.path === normalizedPath);
  const fallbackPath = closingIndex >= 0
    ? currentTabs[closingIndex + 1]?.path || currentTabs[closingIndex - 1]?.path || ''
    : '';

  removeOpenTab(normalizedPath);

  if (!closingActive) {
    renderOpenTabs();
    return;
  }

  if (fallbackPath) {
    renderOpenTabs();
    await openPath(fallbackPath, { skipConfirm: true });
    return;
  }

  clearSelectedFile();
  renderSelectedFile();
  renderOpenTabs();
}

function renderTargetSummary() {
  const tagsElement = $('file-browser-target-tags');
  const hintElement = $('file-browser-target-hint');
  if (!tagsElement || !hintElement) return;

  const tags = [];
  const readOnly = fileBrowserState.auth?.readOnly === true;

  if (fileBrowserState.selectedFile) {
    tags.push({ label: '文件', tone: 'info' });
    tags.push({
      label: fileBrowserState.selectedFile.editable ? '可编辑文本' : '只读内容',
      tone: fileBrowserState.selectedFile.editable ? 'success' : 'warning',
    });
    tags.push({ label: `大小 ${formatBytes(fileBrowserState.selectedFile.size)}`, tone: '' });
    if (fileBrowserState.viewMode !== 'edit') {
      tags.push({
        label: fileBrowserState.viewMode === 'split' ? '分栏预览' : '高亮预览',
        tone: 'info',
      });
    }
    if (readOnly) {
      tags.push({ label: '控制台只读', tone: 'warning' });
      hintElement.textContent = '当前已选中文件，但控制台处于只读模式，只能查看不能保存。';
    } else if (isDirty()) {
      tags.push({ label: '有未保存修改', tone: 'warning' });
      hintElement.textContent = '当前文件可编辑，修改后可用顶部“保存文件”或 Ctrl/Cmd + S 保存。';
    } else {
      hintElement.textContent = '当前文件可编辑，可直接修改内容；如需重命名或删除，可使用顶部操作按钮。';
    }
  } else if (fileBrowserState.currentDirectoryInfo) {
    tags.push({ label: '目录', tone: 'info' });
    tags.push({ label: `${fileBrowserState.entries.length} 项`, tone: '' });
    tags.push({
      label: fileBrowserState.currentDirectoryInfo.path ? '可新建文件/目录' : '根目录视图',
      tone: readOnly ? 'warning' : 'success',
    });
    hintElement.textContent = readOnly
      ? '当前是目录视图。可以浏览和搜索目录内容，但不能新建、重命名或删除。'
      : fileBrowserState.currentDirectoryInfo.path
        ? '当前是目录视图。可以新建文件、创建目录，或对当前目录执行重命名与空目录删除。'
        : '当前是根目录视图。可以浏览整个 Yunzai 目录，并从这里开始新建文件或目录。';
  } else {
    tags.push({ label: '未选中节点', tone: 'warning' });
    hintElement.textContent = '当前未选中文件，可先从左侧目录树或路径输入框打开目标。';
  }

  tagsElement.innerHTML = tags.map(tag => `
    <span class="file-browser-target-tag${tag.tone ? ` tone-${tag.tone}` : ''}">${escapeHtml(tag.label)}</span>
  `).join('');
}

function renderViewMode() {
  const workspace = $('file-browser-workspace');
  const modes = ['edit', 'preview', 'split'];
  if (workspace) {
    workspace.classList.remove('mode-edit', 'mode-preview', 'mode-split');
    workspace.classList.add(`mode-${fileBrowserState.viewMode}`);
  }
  for (const mode of modes) {
    const button = $(`file-browser-view-${mode}-btn`);
    if (!button) continue;
    button.classList.toggle('is-active', fileBrowserState.viewMode === mode);
    button.setAttribute('aria-pressed', String(fileBrowserState.viewMode === mode));
  }
}

function buildPreviewCodeHtml() {
  const lines = String(fileBrowserState.previewHtml || '').split('\n');
  const lineCount = Math.max(fileBrowserState.previewLineCount || 0, lines.length || 1);
  const lineItems = [];
  for (let index = 0; index < lineCount; index += 1) {
    const lineHtml = lines[index] ?? '';
    lineItems.push(`
      <div class="file-browser-code-line">
        <span class="file-browser-code-gutter">${index + 1}</span>
        <span class="file-browser-code-content">${lineHtml || '&nbsp;'}</span>
      </div>
    `);
  }
  return `
    <div class="file-browser-code">
      <div class="file-browser-code-header">
        <span>${escapeHtml(fileBrowserState.previewDetectedLanguage || fileBrowserState.previewLanguage || 'plaintext')}</span>
        <span>${escapeHtml(formatBytes(fileBrowserState.previewByteLength))}</span>
      </div>
      <pre class="hljs">${lineItems.join('')}</pre>
    </div>
  `;
}

function renderPreview() {
  const previewElement = $('file-browser-preview');
  const metaElement = $('file-browser-preview-meta');
  if (!previewElement || !metaElement) return;

  if (!fileBrowserState.selectedFile) {
    previewElement.className = 'file-browser-preview is-placeholder';
    previewElement.textContent = '选择文本文件后可在这里查看语法高亮预览';
    metaElement.textContent = fileBrowserState.viewMode === 'edit'
      ? '当前仅显示编辑区'
      : '当前未选择文件';
    return;
  }

  if (fileBrowserState.viewMode === 'edit') {
    previewElement.className = 'file-browser-preview is-placeholder';
    previewElement.textContent = '切换到“预览”或“分栏”后会显示当前文件的高亮内容';
    metaElement.textContent = '当前仅显示编辑区';
    return;
  }

  if (fileBrowserState.previewLoading) {
    previewElement.className = 'file-browser-preview is-placeholder';
    previewElement.textContent = '正在生成语法高亮预览...';
    metaElement.textContent = '预览生成中';
    return;
  }

  if (fileBrowserState.previewError) {
    previewElement.className = 'file-browser-preview is-error';
    previewElement.textContent = fileBrowserState.previewError;
    metaElement.textContent = '预览生成失败';
    return;
  }

  previewElement.className = 'file-browser-preview';
  previewElement.innerHTML = buildPreviewCodeHtml();
  metaElement.textContent = `高亮语言 ${fileBrowserState.previewDetectedLanguage || fileBrowserState.previewLanguage || 'plaintext'} · ${fileBrowserState.previewLineCount || 1} 行`;
}

function updateActionButtons() {
  const readOnly = fileBrowserState.auth?.readOnly === true;
  const hasFile = Boolean(fileBrowserState.selectedFile?.path);
  const canEdit = hasFile && !readOnly && fileBrowserState.selectedFile?.editable === true;
  const target = getCurrentTarget();
  const canMutateTarget = Boolean(target)
    && !(target.type === 'directory' && !target.path)
    && !readOnly
    && !fileBrowserState.renamingNode
    && !fileBrowserState.deletingNode;

  const editor = $('file-browser-editor');
  if (editor) {
    editor.disabled = !hasFile || fileBrowserState.selectedFile?.editable !== true || readOnly;
  }

  const saveButton = $('file-browser-save-btn');
  if (saveButton) {
    saveButton.disabled = !canEdit || !isDirty() || fileBrowserState.savingFile;
  }

  const inlineSaveButton = $('file-browser-inline-save-btn');
  if (inlineSaveButton) {
    inlineSaveButton.disabled = !canEdit || !isDirty() || fileBrowserState.savingFile;
  }

  const reloadButton = $('file-browser-reload-btn');
  if (reloadButton) {
    reloadButton.disabled = !hasFile || fileBrowserState.loadingFile;
  }

  const inlineReloadButton = $('file-browser-inline-reload-btn');
  if (inlineReloadButton) {
    inlineReloadButton.disabled = !hasFile || fileBrowserState.loadingFile;
  }

  const copyPathButton = $('file-browser-copy-path-btn');
  if (copyPathButton) {
    copyPathButton.disabled = !hasFile;
  }

  const findButton = $('file-browser-find-btn');
  if (findButton) {
    findButton.disabled = !hasFile;
  }

  const replaceButton = $('file-browser-replace-btn');
  if (replaceButton) {
    replaceButton.disabled = !hasFile;
  }

  const refreshButton = $('file-browser-refresh-dir-btn');
  if (refreshButton) {
    refreshButton.disabled = fileBrowserState.loadingTree;
  }

  const newFileButton = $('file-browser-new-file-btn');
  if (newFileButton) {
    newFileButton.disabled = readOnly || fileBrowserState.creatingFile;
  }

  const newDirectoryButton = $('file-browser-new-dir-btn');
  if (newDirectoryButton) {
    newDirectoryButton.disabled = readOnly || fileBrowserState.creatingDirectory;
  }

  const renameButton = $('file-browser-rename-btn');
  if (renameButton) {
    renameButton.disabled = !canMutateTarget;
  }

  const deleteButton = $('file-browser-delete-btn');
  if (deleteButton) {
    deleteButton.disabled = !canMutateTarget;
  }

  const clearSearchButton = $('file-browser-search-clear-btn');
  if (clearSearchButton) {
    clearSearchButton.disabled = !fileBrowserState.searchKeyword;
  }

  const openButton = $('file-browser-open-btn');
  if (openButton) {
    openButton.disabled = fileBrowserState.loadingTree || fileBrowserState.loadingFile;
  }

  const projectSearchButton = $('file-browser-project-search-btn');
  if (projectSearchButton) {
    projectSearchButton.disabled = fileBrowserState.projectSearch.loading || !String(fileBrowserState.projectSearch.query || '').trim();
  }

  const projectSearchClearButton = $('file-browser-project-search-clear-btn');
  if (projectSearchClearButton) {
    projectSearchClearButton.disabled = fileBrowserState.projectSearch.loading
      || (!fileBrowserState.projectSearch.searched && !fileBrowserState.projectSearch.results.length && !String(fileBrowserState.projectSearch.query || '').trim());
  }

  const projectSearchCaseButton = $('file-browser-project-search-case-btn');
  if (projectSearchCaseButton) {
    projectSearchCaseButton.classList.toggle('is-active', fileBrowserState.projectSearch.caseSensitive);
    projectSearchCaseButton.disabled = fileBrowserState.projectSearch.loading;
  }

  const expandPathButton = $('file-browser-expand-path-btn');
  if (expandPathButton) {
    expandPathButton.disabled = fileBrowserState.loadingTree;
  }

  const collapseTreeButton = $('file-browser-collapse-tree-btn');
  if (collapseTreeButton) {
    collapseTreeButton.disabled = fileBrowserState.loadingTree;
  }

  document.querySelectorAll('[data-tree-filter]').forEach(button => {
    const active = button.dataset.treeFilter === fileBrowserState.treeFilter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  refreshEditorSearchState();
  renderEditorActionBar();
  renderEditorSearchPanel();
  renderProjectSearchPanel();
}

async function fetchJson(url, init = undefined) {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.error || `${url} -> ${response.status}`);
    error.code = data.code || '';
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function renderSummary() {
  $('file-browser-root-path').textContent = fileBrowserState.root?.name || '/';
  $('file-browser-current-dir').textContent = fileBrowserState.currentDir || '/';
}

function renderBreadcrumbs() {
  const container = $('file-browser-breadcrumbs');
  if (!container) return;
  const parts = fileBrowserState.currentDir ? fileBrowserState.currentDir.split('/') : [];
  const items = [{ label: fileBrowserState.root?.name || 'root', path: '' }];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    items.push({ label: part, path: current });
  }

  container.innerHTML = items.map((item, index) => `
    <button
      type="button"
      class="file-browser-crumb${index === items.length - 1 ? ' is-active' : ''}"
      data-open-dir="${escapeHtml(item.path)}"
    >${escapeHtml(item.label)}</button>
  `).join('');
}

function entryMatchesSearch(entry) {
  const keyword = String(fileBrowserState.searchKeyword || '').trim().toLowerCase();
  if (!keyword) return true;
  const haystack = `${entry.name || ''} ${entry.path || ''}`.toLowerCase();
  return haystack.includes(keyword);
}

function entryMatchesTreeFilter(entry) {
  if (fileBrowserState.treeFilter === 'directory') {
    return entry.type === 'directory';
  }
  if (fileBrowserState.treeFilter === 'file') {
    return entry.type === 'file';
  }
  return true;
}

function buildTreeNodesMarkup(entries, depth = 0) {
  let html = '';
  let count = 0;
  const activePathChain = getActiveTreePathChain();

  for (const entry of entries) {
    const isDirectory = entry.type === 'directory';
    const isExpanded = isDirectory && isTreeDirectoryExpanded(entry.path);
    const isLoading = isDirectory && fileBrowserState.treeLoadingDirs.has(normalizeRelativePath(entry.path));
    let childrenMarkup = '';
    let childrenCount = 0;

    if (isDirectory && isExpanded) {
      const childResult = buildTreeNodesMarkup(getTreeEntries(entry.path), depth + 1);
      childrenMarkup = childResult.html;
      childrenCount = childResult.count;
    }

    const matches = entryMatchesSearch(entry);
    const passesTypeFilter = entryMatchesTreeFilter(entry);
    const isAncestor = isDirectory && activePathChain.has(normalizeRelativePath(entry.path));
    const shouldShow = (!fileBrowserState.searchKeyword || matches || childrenCount > 0)
      && (passesTypeFilter || childrenCount > 0 || isAncestor);
    if (!shouldShow) {
      continue;
    }

    const activeFile = fileBrowserState.selectedFile?.path === entry.path;
    const activeDirectory = !fileBrowserState.selectedFile?.path && fileBrowserState.currentDirectoryInfo?.path === entry.path;
    const activeClass = activeFile || activeDirectory ? ' is-active' : '';
    const ancestorClass = isAncestor && !activeDirectory ? ' is-ancestor' : '';
    const icon = isDirectory ? 'DIR' : 'FILE';
    const meta = isDirectory
      ? (isLoading ? '正在加载子目录...' : `${formatTime(entry.mtimeMs)}`)
      : `${formatBytes(entry.size)} · ${formatTime(entry.mtimeMs)}`;
    const indentMarkup = depth > 0
      ? new Array(depth).fill('<span class="file-browser-tree-indent"></span>').join('')
      : '';
    const toggleMarkup = isDirectory
      ? `
        <button
          type="button"
          class="file-browser-tree-toggle${isExpanded ? ' is-expanded' : ''}"
          data-tree-toggle-path="${escapeHtml(entry.path)}"
          aria-label="${isExpanded ? '折叠目录' : '展开目录'}"
          aria-expanded="${String(isExpanded)}"
        >${isLoading ? '…' : isExpanded ? '▾' : '▸'}</button>
      `
      : '<span class="file-browser-tree-toggle is-placeholder"></span>';

    html += `
      <div class="file-browser-tree-node">
        <div
          class="file-browser-tree-row${activeClass}${ancestorClass}"
          data-tree-open-path="${escapeHtml(entry.path)}"
          data-tree-entry-type="${escapeHtml(entry.type)}"
        >
          <span class="file-browser-tree-prefix">
            ${indentMarkup}
            ${toggleMarkup}
          </span>
          <button
            type="button"
            class="file-browser-tree-item${activeClass}${ancestorClass}"
            data-tree-open-path="${escapeHtml(entry.path)}"
            data-tree-entry-type="${escapeHtml(entry.type)}"
            data-tree-node-path="${escapeHtml(entry.path)}"
          >
            <span class="file-browser-tree-icon">${icon}</span>
            <span class="file-browser-tree-content">
              <span class="file-browser-tree-name">${escapeHtml(entry.name)}</span>
              <span class="file-browser-tree-meta">${escapeHtml(meta)}</span>
            </span>
          </button>
        </div>
        ${isDirectory && isExpanded && childrenMarkup ? `<div class="file-browser-tree-children">${childrenMarkup}</div>` : ''}
      </div>
    `;
    count += 1 + childrenCount;
  }

  return { html, count };
}

function renderSelectedFile() {
  const title = $('file-browser-file-title');
  const meta = $('file-browser-file-meta');
  const editor = $('file-browser-editor');

  if (fileBrowserState.selectedFile) {
    const file = fileBrowserState.selectedFile;
    title.textContent = file.path || file.name || '未命名文件';
    meta.textContent = `${formatBytes(file.size)} · ${formatTime(file.mtimeMs)} · ${file.path || '-'}`;
    if (editor) {
      editor.value = fileBrowserState.selectedContent;
    }
    updateFileStats();
    renderTargetSummary();
    updateDirtyIndicator();
    renderEditorActionBar();
    renderViewMode();
    renderPreview();
    updateActionButtons();
    applyPendingEditorSelection();
    return;
  }

  if (fileBrowserState.currentDirectoryInfo) {
    title.textContent = fileBrowserState.currentDirectoryInfo.path
      ? `[目录] ${fileBrowserState.currentDirectoryInfo.path}`
      : '[目录] /';
    meta.textContent = fileBrowserState.currentDirectoryInfo.path || '/';
    if (editor) {
      editor.value = '';
    }
    updateFileStats();
    renderTargetSummary();
    updateDirtyIndicator();
    renderEditorActionBar();
    renderViewMode();
    renderPreview();
    updateActionButtons();
    renderProjectSearchPanel();
    return;
  }

  title.textContent = '未选择文件';
  meta.textContent = '选择左侧文本文件后可查看和编辑。';
  if (editor) {
    editor.value = '';
  }
  updateFileStats();
  renderTargetSummary();
  updateDirtyIndicator();
  renderEditorActionBar();
  renderViewMode();
  renderPreview();
  updateActionButtons();
  renderProjectSearchPanel();
}

function renderTree() {
  if (fileBrowserState.contextMenu.visible) {
    closeContextMenu();
  }
  const status = $('file-browser-tree-status');
  if (status) {
    if (fileBrowserState.loadingTree) {
      status.textContent = '正在加载目录树...';
    } else if (fileBrowserState.searchKeyword) {
      status.textContent = `当前目录 ${fileBrowserState.entries.length} 项，筛选 ${getTreeFilterLabel()}，搜索范围为已展开节点`;
    } else {
      status.textContent = `当前目录 ${fileBrowserState.entries.length} 项，筛选 ${getTreeFilterLabel()}，已展开 ${countExpandedDirectories()} 个子目录`;
    }
  }

  renderSummary();
  renderBreadcrumbs();

  const list = $('file-browser-entry-list');
  if (!list) return;

  const result = buildTreeNodesMarkup(getTreeEntries(''), 0);
  if (!result.html) {
    list.innerHTML = `<div class="file-browser-empty">${fileBrowserState.searchKeyword ? '没有匹配当前筛选条件的已加载节点。' : '当前筛选条件下没有可显示的节点。'}</div>`;
    return;
  }

  list.innerHTML = `<div class="file-browser-tree">${result.html}</div>`;
  scheduleTreeFocus();
}

function applyAuthState() {
  const status = fileBrowserState.auth;
  if (!status) return;
  if (status.readOnly) {
    setAuthBanner('当前控制台处于只读模式，文件内容可查看，但不能新建、重命名或删除。', 'warning');
  } else {
    setAuthBanner('当前已登录，可在受限范围内浏览、新建、重命名，并安全删除文件或空目录。快捷键 Ctrl/Cmd + S 可直接保存。', 'success');
  }
  renderTargetSummary();
  renderPreview();
  updateActionButtons();
}

function setViewMode(mode = 'edit') {
  if (!['edit', 'preview', 'split'].includes(mode)) {
    return;
  }
  fileBrowserState.viewMode = mode;
  renderViewMode();
  renderTargetSummary();
  renderPreview();
  if (mode !== 'edit' && fileBrowserState.selectedFile?.path) {
    schedulePreviewRefresh({ immediate: true, force: true });
  }
}

function schedulePreviewRefresh({ immediate = false, force = false } = {}) {
  if (fileBrowserState.previewTimer) {
    window.clearTimeout(fileBrowserState.previewTimer);
    fileBrowserState.previewTimer = 0;
  }

  if (!fileBrowserState.selectedFile?.path) {
    resetPreviewState();
    renderPreview();
    return;
  }

  if (!force && fileBrowserState.viewMode === 'edit') {
    renderPreview();
    return;
  }

  const requestId = ++fileBrowserState.previewRequestId;
  const run = async () => {
    fileBrowserState.previewLoading = true;
    fileBrowserState.previewError = '';
    renderPreview();
    try {
      const data = await fetchJson('/api/file-browser/highlight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: fileBrowserState.selectedFile.path,
          content: getEditorContent(),
        }),
      });
      if (requestId !== fileBrowserState.previewRequestId) {
        return;
      }
      fileBrowserState.previewLoading = false;
      fileBrowserState.previewHtml = data.preview?.html || '';
      fileBrowserState.previewLanguage = data.preview?.language || '';
      fileBrowserState.previewDetectedLanguage = data.preview?.detectedLanguage || '';
      fileBrowserState.previewLineCount = Number(data.preview?.lineCount || 0);
      fileBrowserState.previewByteLength = Number(data.preview?.byteLength || 0);
      fileBrowserState.previewError = '';
      renderPreview();
    } catch (error) {
      if (requestId !== fileBrowserState.previewRequestId) {
        return;
      }
      fileBrowserState.previewLoading = false;
      fileBrowserState.previewHtml = '';
      fileBrowserState.previewLanguage = '';
      fileBrowserState.previewDetectedLanguage = '';
      fileBrowserState.previewLineCount = 0;
      fileBrowserState.previewByteLength = 0;
      fileBrowserState.previewError = error.message || '预览生成失败';
      renderPreview();
    }
  };

  if (immediate) {
    run();
    return;
  }

  fileBrowserState.previewTimer = window.setTimeout(run, 240);
}

async function confirmDiscardIfNeeded() {
  if (!isDirty()) return true;
  return await openConfirmDialog({
    title: '放弃未保存修改',
    message: '当前文件有未保存修改，继续操作会丢失这些内容。',
    confirmText: '放弃修改',
    cancelText: '继续编辑',
    danger: true,
  });
}

async function hydrateTreeDirectory(pathValue = '', options = {}) {
  const normalizedPath = normalizeRelativePath(pathValue);
  if (Array.isArray(fileBrowserState.treeCache[normalizedPath]) && !options.force) {
    return fileBrowserState.treeCache[normalizedPath];
  }
  if (fileBrowserState.treeLoadingDirs.has(normalizedPath)) {
    return fileBrowserState.treeCache[normalizedPath] || [];
  }

  fileBrowserState.treeLoadingDirs.add(normalizedPath);
  if (options.render !== false) {
    renderTree();
  }

  try {
    const data = await fetchDirectoryPayload(normalizedPath);
    fileBrowserState.treeCache[normalizedPath] = Array.isArray(data.entries)
      ? data.entries.map(entry => ({ ...entry }))
      : [];
    return fileBrowserState.treeCache[normalizedPath];
  } finally {
    fileBrowserState.treeLoadingDirs.delete(normalizedPath);
    if (options.render !== false) {
      renderTree();
    }
  }
}

async function loadDirectory(pathValue = fileBrowserState.currentDir || '', options = {}) {
  fileBrowserState.loadingTree = true;
  updateActionButtons();
  renderTree();

  try {
    const data = await fetchDirectoryPayload(pathValue);
    const nextDir = normalizeRelativePath(data.current?.path || '');

    fileBrowserState.root = data.root || null;
    fileBrowserState.currentDir = nextDir;
    fileBrowserState.currentDirectoryInfo = data.current || null;
    fileBrowserState.entries = Array.isArray(data.entries) ? data.entries : [];

    if (!Array.isArray(fileBrowserState.treeCache[''])) {
      resetTreeState('');
    }
    fileBrowserState.treeLoadingDirs = new Set();
    await ensureTreePathVisible(nextDir, { finalEntries: fileBrowserState.entries });
    syncCurrentDirectoryTree();
    await restoreExpandedTreeEntries();

    if (options.clearSelection === true) {
      clearSelectedFile();
      renderSelectedFile();
    }

    renderTree();
    scheduleTreeFocus(nextDir);
  } catch (error) {
    setBanner(error.message || '目录加载失败', 'error');
  } finally {
    fileBrowserState.loadingTree = false;
    renderTree();
    scheduleTreeFocus(fileBrowserState.currentDir);
    updateActionButtons();
  }
}

async function loadFile(pathValue) {
  if (!pathValue) return;
  fileBrowserState.loadingFile = true;
  updateActionButtons();
  setBanner('正在加载文件...', '');
  try {
    const data = await fetchJson(`/api/file-browser/read?path=${encodeURIComponent(pathValue)}`);
    fileBrowserState.selectedFile = data.file || null;
    fileBrowserState.selectedContent = data.file?.content || '';
    fileBrowserState.lastSavedContent = data.file?.content || '';
    rememberOpenTab(data.file || { path: pathValue });
    resetPreviewState();
    renderSelectedFile();
    renderTree();
    scheduleTreeFocus(data.file?.path || pathValue);
    schedulePreviewRefresh({ immediate: fileBrowserState.viewMode !== 'edit', force: true });
    setBanner('文件已加载。', 'success');
  } catch (error) {
    setBanner(error.message || '文件加载失败', 'error');
  } finally {
    fileBrowserState.loadingFile = false;
    updateActionButtons();
  }
}

async function saveCurrentFile(options = {}) {
  if (!fileBrowserState.selectedFile?.path || fileBrowserState.auth?.readOnly) {
    return;
  }
  const forceOverwrite = options.forceOverwrite === true;
  fileBrowserState.savingFile = true;
  updateActionButtons();
  setBanner(forceOverwrite ? '检测到冲突后正在覆盖保存...' : '正在保存文件...', '');
  try {
    const content = getEditorContent();
    const data = await fetchJson('/api/file-browser/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: fileBrowserState.selectedFile.path,
        content,
        expectedMtimeMs: fileBrowserState.selectedFile.mtimeMs,
        forceOverwrite,
      }),
    });
    fileBrowserState.selectedFile = { ...fileBrowserState.selectedFile, ...(data.file || {}) };
    fileBrowserState.selectedContent = content;
    fileBrowserState.lastSavedContent = content;
    renderSelectedFile();
    await loadDirectory(fileBrowserState.currentDir);
    renderSelectedFile();
    schedulePreviewRefresh({ immediate: fileBrowserState.viewMode !== 'edit', force: true });
    setBanner(forceOverwrite ? '检测到冲突后已覆盖保存。' : '文件已保存。', 'success');
  } catch (error) {
    if (!forceOverwrite && error.code === 'FILE_BROWSER_WRITE_CONFLICT') {
      fileBrowserState.savingFile = false;
      updateActionButtons();
      const conflict = error.data?.conflict || {};
      const confirmed = await openSaveConflictDialog({
        path: conflict.path || fileBrowserState.selectedFile.path,
        localContent: getEditorContent(),
        diskContent: String(conflict.currentContent || ''),
        expectedMtimeMs: conflict.expectedMtimeMs || fileBrowserState.selectedFile.mtimeMs || 0,
        actualMtimeMs: conflict.actualMtimeMs || conflict.file?.mtimeMs || 0,
      });
      if (confirmed) {
        return await saveCurrentFile({ forceOverwrite: true });
      }
      setBanner('已取消覆盖保存，当前修改仍保留在编辑器中。', 'warning');
      return;
    }
    setBanner(error.message || '文件保存失败', 'error');
  } finally {
    if (fileBrowserState.savingFile) {
      fileBrowserState.savingFile = false;
      updateActionButtons();
    }
  }
}

async function runProjectSearch(rawQuery = '') {
  const query = String(rawQuery || $('file-browser-project-search-input')?.value || '').trim();
  fileBrowserState.projectSearch.query = query;
  fileBrowserState.projectSearch.searched = false;
  fileBrowserState.projectSearch.results = [];
  fileBrowserState.projectSearch.truncated = false;
  if (!query) {
    renderProjectSearchPanel();
    updateActionButtons();
    return;
  }

  fileBrowserState.projectSearch.loading = true;
  fileBrowserState.projectSearch.scopePath = '';
  renderProjectSearchPanel();
  updateActionButtons();
  try {
    const data = await fetchJson(
      `/api/file-browser/search?query=${encodeURIComponent(query)}&caseSensitive=${fileBrowserState.projectSearch.caseSensitive ? '1' : '0'}&limit=${encodeURIComponent(fileBrowserState.projectSearch.limit)}`,
    );
    fileBrowserState.projectSearch.loading = false;
    fileBrowserState.projectSearch.searched = true;
    fileBrowserState.projectSearch.results = Array.isArray(data.results) ? data.results : [];
    fileBrowserState.projectSearch.truncated = data.truncated === true;
    fileBrowserState.projectSearch.scopePath = String(data.scopePath || '');
    renderProjectSearchPanel();
  } catch (error) {
    fileBrowserState.projectSearch.loading = false;
    fileBrowserState.projectSearch.searched = true;
    fileBrowserState.projectSearch.results = [];
    fileBrowserState.projectSearch.truncated = false;
    renderProjectSearchPanel();
    setBanner(error.message || '全文搜索失败', 'error');
  } finally {
    updateActionButtons();
  }
}

function clearProjectSearch() {
  fileBrowserState.projectSearch.query = '';
  fileBrowserState.projectSearch.loading = false;
  fileBrowserState.projectSearch.searched = false;
  fileBrowserState.projectSearch.results = [];
  fileBrowserState.projectSearch.truncated = false;
  fileBrowserState.projectSearch.scopePath = '';
  if ($('file-browser-project-search-input')) {
    $('file-browser-project-search-input').value = '';
  }
  renderProjectSearchPanel();
  updateActionButtons();
}

async function openProjectSearchResult(result = null) {
  if (!result?.path) {
    return;
  }
  const targetSelection = {
    path: result.path,
    lineNumber: result.lineNumber,
    columnNumber: result.columnNumber,
    matchLength: result.matchLength,
  };
  const applyFinalSelection = () => {
    if (normalizeRelativePath(fileBrowserState.selectedFile?.path || '') !== normalizeRelativePath(targetSelection.path || '')) {
      return false;
    }
    const applied = focusEditorSelection(targetSelection);
    if (applied) {
      fileBrowserState.pendingEditorSelection = null;
    }
    return applied;
  };
  fileBrowserState.pendingEditorSelection = targetSelection;
  if (normalizeRelativePath(fileBrowserState.selectedFile?.path || '') === normalizeRelativePath(result.path)) {
    applyPendingEditorSelection();
    window.setTimeout(() => {
      applyFinalSelection();
    }, 40);
    return;
  }
  await openPath(result.path);
  if (normalizeRelativePath(fileBrowserState.selectedFile?.path || '') !== normalizeRelativePath(result.path)) {
    fileBrowserState.pendingEditorSelection = null;
    return;
  }
  applyFinalSelection();
  window.requestAnimationFrame(() => {
    applyFinalSelection();
  });
  window.setTimeout(() => {
    applyFinalSelection();
  }, 80);
}

async function openPath(pathValue = '', options = {}) {
  const normalizedPath = normalizeRelativePath(pathValue || $('file-browser-open-input')?.value || '');
  if (!normalizedPath) {
    setBanner('请输入要打开的相对路径。', 'error');
    return;
  }
  if (!options.skipConfirm && !await confirmDiscardIfNeeded()) {
    return;
  }
  setBanner('正在判断路径...', '');
  try {
    const data = await fetchJson(`/api/file-browser/node?path=${encodeURIComponent(normalizedPath)}`);
    const node = data.node || {};
    if (node.type === 'directory') {
      fileBrowserState.searchKeyword = '';
      if ($('file-browser-search-input')) {
        $('file-browser-search-input').value = '';
      }
      await loadDirectory(node.path || '', { clearSelection: true });
      setBanner('目录已打开。', 'success');
      return;
    }

    if (node.type === 'file') {
      const parentDir = getParentPath(node.path);
      fileBrowserState.searchKeyword = '';
      if ($('file-browser-search-input')) {
        $('file-browser-search-input').value = '';
      }
      await loadDirectory(parentDir);
      await loadFile(node.path);
      setBanner('文件已打开。', 'success');
      return;
    }

    setBanner('当前路径不是可打开的目录或文本文件。', 'error');
  } catch (error) {
    setBanner(error.message || '路径打开失败', 'error');
  }
}

async function createNewFile(options = {}) {
  if (fileBrowserState.auth?.readOnly) {
    return;
  }

  const baseDir = normalizeRelativePath(options.baseDir ?? fileBrowserState.currentDir);
  const suggestedName = normalizeRelativePath(options.suggestedPath || (baseDir ? `${baseDir}/untitled.txt` : 'untitled.txt'));
  const normalizedInput = await openPromptDialog({
    title: '新建文件',
    label: '相对文件路径',
    value: suggestedName,
    placeholder: '例如 notes/todo.txt',
    help: '仅支持创建文本文件，路径会限制在当前 Yunzai 运行目录内。',
    confirmText: '创建文件',
  });
  if (!normalizedInput) {
    return;
  }

  fileBrowserState.creatingFile = true;
  updateActionButtons();
  setBanner('正在创建文件...', '');
  try {
    const data = await fetchJson('/api/file-browser/create-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: normalizedInput,
        content: '',
      }),
    });
    const targetPath = data.file?.path || normalizedInput;
    const nextDir = getParentPath(targetPath);
    fileBrowserState.searchKeyword = '';
    if ($('file-browser-search-input')) {
      $('file-browser-search-input').value = '';
    }
    await loadDirectory(nextDir);
    await loadFile(targetPath);
    setBanner('新文件已创建，可直接开始编辑。', 'success');
  } catch (error) {
    setBanner(error.message || '创建文件失败', 'error');
  } finally {
    fileBrowserState.creatingFile = false;
    updateActionButtons();
  }
}

async function createNewDirectory(options = {}) {
  if (fileBrowserState.auth?.readOnly) {
    return;
  }

  const baseDir = normalizeRelativePath(options.baseDir ?? fileBrowserState.currentDir);
  const suggestedName = normalizeRelativePath(options.suggestedPath || (baseDir ? `${baseDir}/new-folder` : 'new-folder'));
  const normalizedInput = await openPromptDialog({
    title: '新建目录',
    label: '相对目录路径',
    value: suggestedName,
    placeholder: '例如 notes/draft',
    help: '支持一次创建多级目录，隐藏目录和越界路径会被拦截。',
    confirmText: '创建目录',
  });
  if (!normalizedInput) {
    return;
  }

  fileBrowserState.creatingDirectory = true;
  updateActionButtons();
  setBanner('正在创建目录...', '');
  try {
    const data = await fetchJson('/api/file-browser/create-directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: normalizedInput,
      }),
    });
    const targetPath = data.directory?.path || normalizedInput;
    fileBrowserState.searchKeyword = '';
    if ($('file-browser-search-input')) {
      $('file-browser-search-input').value = '';
    }
    await loadDirectory(targetPath, { clearSelection: true });
    setBanner('新目录已创建并打开。', 'success');
  } catch (error) {
    setBanner(error.message || '创建目录失败', 'error');
  } finally {
    fileBrowserState.creatingDirectory = false;
    updateActionButtons();
  }
}

async function renameCurrentTarget(nextTarget = getCurrentTarget()) {
  const target = nextTarget;
  if (!target || fileBrowserState.auth?.readOnly) {
    return;
  }
  if (target.type === 'file' && !await confirmDiscardIfNeeded()) {
    return;
  }

  const normalizedInput = await openPromptDialog({
    title: target.type === 'file' ? '重命名文件' : '重命名目录',
    label: '新的相对路径',
    value: target.path,
    placeholder: target.path,
    help: `当前${target.type === 'file' ? '文件' : '目录'}：${target.path}`,
    confirmText: '确认重命名',
  });
  if (!normalizedInput || normalizedInput === target.path) {
    return;
  }

  fileBrowserState.renamingNode = true;
  updateActionButtons();
  setBanner('正在重命名...', '');
  try {
    const data = await fetchJson('/api/file-browser/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePath: target.path,
        targetPath: normalizedInput,
      }),
    });
    const nextPath = data.node?.path || normalizedInput;
    if (target.type === 'file') {
      replaceOpenTabPath(target.path, nextPath);
    }
    if (target.type === 'file') {
      await loadDirectory(getParentPath(nextPath));
      await loadFile(nextPath);
    } else {
      await loadDirectory(nextPath, { clearSelection: true });
    }
    setBanner('重命名完成。', 'success');
  } catch (error) {
    setBanner(error.message || '重命名失败', 'error');
  } finally {
    fileBrowserState.renamingNode = false;
    updateActionButtons();
  }
}

async function deleteCurrentTarget(nextTarget = getCurrentTarget()) {
  const target = nextTarget;
  if (!target || fileBrowserState.auth?.readOnly) {
    return;
  }
  if (target.type === 'file' && !await confirmDiscardIfNeeded()) {
    return;
  }

  const confirmed = await openConfirmDialog({
    title: target.type === 'file' ? '删除文件' : '删除目录',
    message: `${target.path}\n${target.type === 'directory' ? '仅支持删除空目录。' : '此操作不可撤销。'}`,
    confirmText: '确认删除',
    cancelText: '取消',
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  fileBrowserState.deletingNode = true;
  updateActionButtons();
  setBanner('正在删除...', '');
  try {
    await fetchJson('/api/file-browser/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: target.path,
      }),
    });
    if (target.type === 'file') {
      removeOpenTab(target.path);
    }
    clearSelectedFile();
    await loadDirectory(getParentPath(target.path), { clearSelection: true });
    renderSelectedFile();
    setBanner('删除完成。', 'success');
  } catch (error) {
    setBanner(error.message || '删除失败', 'error');
  } finally {
    fileBrowserState.deletingNode = false;
    updateActionButtons();
  }
}

async function handleContextMenuAction(action, target, baseDir = '') {
  if (!action || !target) {
    return;
  }

  if (action === 'open') {
    await openPath(target.path || '', { skipConfirm: false });
    return;
  }

  if (action === 'copy-path') {
    try {
      const copied = await copyText(target.path);
      setBanner(copied ? `已复制路径：${target.path}` : '复制路径失败', copied ? 'success' : 'error');
    } catch (error) {
      setBanner(error.message || '复制路径失败', 'error');
    }
    return;
  }

  if (action === 'expand-dir' && target.type === 'directory') {
    setTreeDirectoryExpanded(target.path, true);
    await hydrateTreeDirectory(target.path);
    renderTree();
    return;
  }

  if (action === 'collapse-dir' && target.type === 'directory') {
    setTreeDirectoryExpanded(target.path, false);
    renderTree();
    return;
  }

  if (action === 'open-parent' && target.type === 'file') {
    await openPath(getParentPath(target.path), { skipConfirm: false });
    return;
  }

  if (action === 'new-file') {
    await createNewFile({ baseDir: normalizeRelativePath(baseDir || getContextMenuDirectoryBase(target)) });
    return;
  }

  if (action === 'new-dir') {
    await createNewDirectory({ baseDir: normalizeRelativePath(baseDir || getContextMenuDirectoryBase(target)) });
    return;
  }

  if (action === 'rename') {
    await renameCurrentTarget(target);
    return;
  }

  if (action === 'delete') {
    await deleteCurrentTarget(target);
  }
}

function bindEvents() {
  $('file-browser-modal-cancel-btn')?.addEventListener('click', () => closeModal(false));
  $('file-browser-modal-confirm-btn')?.addEventListener('click', () => closeModal(true));
  $('file-browser-modal-mask')?.addEventListener('click', event => {
    if (event.target === $('file-browser-modal-mask')) {
      closeModal(false);
    }
  });

  $('file-browser-refresh-dir-btn')?.addEventListener('click', () => {
    loadDirectory(fileBrowserState.currentDir);
  });

  $('file-browser-new-dir-btn')?.addEventListener('click', () => {
    createNewDirectory();
  });

  $('file-browser-new-file-btn')?.addEventListener('click', () => {
    createNewFile();
  });

  $('file-browser-rename-btn')?.addEventListener('click', () => {
    renameCurrentTarget();
  });

  $('file-browser-delete-btn')?.addEventListener('click', () => {
    deleteCurrentTarget();
  });

  $('file-browser-open-btn')?.addEventListener('click', () => {
    openPath();
  });

  $('file-browser-open-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      openPath();
    }
  });

  $('file-browser-project-search-input')?.addEventListener('input', event => {
    fileBrowserState.projectSearch.query = String(event.target.value || '').trim();
    updateActionButtons();
  });

  $('file-browser-project-search-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runProjectSearch(event.target.value || '');
    }
  });

  $('file-browser-project-search-btn')?.addEventListener('click', () => {
    runProjectSearch();
  });

  $('file-browser-project-search-case-btn')?.addEventListener('click', () => {
    fileBrowserState.projectSearch.caseSensitive = !fileBrowserState.projectSearch.caseSensitive;
    updateActionButtons();
    renderProjectSearchPanel();
    if (String(fileBrowserState.projectSearch.query || '').trim() && fileBrowserState.projectSearch.searched) {
      runProjectSearch(fileBrowserState.projectSearch.query);
    }
  });

  $('file-browser-project-search-clear-btn')?.addEventListener('click', () => {
    clearProjectSearch();
  });

  $('file-browser-project-search-results')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-project-search-result-index]');
    if (!button) {
      return;
    }
    const index = Number(button.dataset.projectSearchResultIndex || -1);
    const result = fileBrowserState.projectSearch.results[index];
    await openProjectSearchResult(result);
  });

  $('file-browser-reload-btn')?.addEventListener('click', async () => {
    if (!fileBrowserState.selectedFile?.path) return;
    if (!await confirmDiscardIfNeeded()) return;
    await loadFile(fileBrowserState.selectedFile.path);
  });

  $('file-browser-save-btn')?.addEventListener('click', () => {
    saveCurrentFile();
  });

  $('file-browser-inline-save-btn')?.addEventListener('click', () => {
    saveCurrentFile();
  });

  $('file-browser-inline-reload-btn')?.addEventListener('click', async () => {
    if (!fileBrowserState.selectedFile?.path) return;
    if (!await confirmDiscardIfNeeded()) return;
    await loadFile(fileBrowserState.selectedFile.path);
  });

  $('file-browser-copy-path-btn')?.addEventListener('click', async () => {
    if (!fileBrowserState.selectedFile?.path) return;
    try {
      const copied = await copyText(fileBrowserState.selectedFile.path);
      setBanner(
        copied ? `已复制路径：${fileBrowserState.selectedFile.path}` : '复制路径失败',
        copied ? 'success' : 'error',
      );
    } catch (error) {
      setBanner(error.message || '复制路径失败', 'error');
    }
  });

  $('file-browser-find-btn')?.addEventListener('click', () => {
    openEditorSearchPanel({ replace: false });
  });

  $('file-browser-replace-btn')?.addEventListener('click', () => {
    openEditorSearchPanel({ replace: true });
  });

  $('file-browser-find-close-btn')?.addEventListener('click', () => {
    closeEditorSearchPanel();
  });

  $('file-browser-find-input')?.addEventListener('input', () => {
    refreshEditorSearchState();
    renderEditorSearchPanel();
  });

  $('file-browser-find-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      navigateEditorSearch(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeEditorSearchPanel();
    }
  });

  $('file-browser-replace-input')?.addEventListener('input', () => {
    updateEditorSearchStateFromInputs();
    renderEditorSearchPanel();
  });

  $('file-browser-replace-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      replaceCurrentEditorSearchMatch();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeEditorSearchPanel();
    }
  });

  $('file-browser-find-prev-btn')?.addEventListener('click', () => {
    navigateEditorSearch(-1);
  });

  $('file-browser-find-next-btn')?.addEventListener('click', () => {
    navigateEditorSearch(1);
  });

  $('file-browser-find-case-btn')?.addEventListener('click', () => {
    fileBrowserState.editorSearch.caseSensitive = !fileBrowserState.editorSearch.caseSensitive;
    refreshEditorSearchState();
    renderEditorSearchPanel();
  });

  $('file-browser-replace-one-btn')?.addEventListener('click', () => {
    replaceCurrentEditorSearchMatch();
  });

  $('file-browser-replace-all-btn')?.addEventListener('click', () => {
    replaceAllEditorSearchMatches();
  });

  $('file-browser-tab-list')?.addEventListener('click', async event => {
    const closeButton = event.target.closest('[data-tab-close-path]');
    if (closeButton) {
      event.preventDefault();
      event.stopPropagation();
      await closeOpenTabByPath(closeButton.dataset.tabClosePath || '');
      return;
    }

    const openButton = event.target.closest('[data-tab-open-path]');
    if (!openButton) {
      return;
    }
    event.preventDefault();
    await switchOpenTab(openButton.dataset.tabOpenPath || '');
  });

  $('file-browser-sidebar-resizer')?.addEventListener('pointerdown', event => {
    event.preventDefault();
    beginSidebarResize(event.clientX);
  });

  $('file-browser-sidebar-resizer')?.addEventListener('dblclick', () => {
    setSidebarWidth(340);
  });

  $('file-browser-sidebar-resizer')?.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSidebarWidth(fileBrowserState.sidebarWidth - (event.shiftKey ? 36 : 18));
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setSidebarWidth(fileBrowserState.sidebarWidth + (event.shiftKey ? 36 : 18));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setSidebarWidth(getSidebarWidthLimits().min);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setSidebarWidth(getSidebarWidthLimits().max);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      setSidebarWidth(340);
    }
  });

  document.querySelectorAll('[data-view-mode]').forEach(button => {
    button.addEventListener('click', () => {
      setViewMode(button.dataset.viewMode || 'edit');
    });
  });

  $('file-browser-editor')?.addEventListener('input', () => {
    updateFileStats();
    renderTargetSummary();
    updateDirtyIndicator();
    updateActionButtons();
    schedulePreviewRefresh();
  });

  $('file-browser-editor')?.addEventListener('select', () => {
    if (!fileBrowserState.editorSearch.visible) {
      return;
    }
    refreshEditorSearchState();
    renderEditorSearchPanel();
  });

  $('file-browser-search-input')?.addEventListener('input', event => {
    fileBrowserState.searchKeyword = String(event.target.value || '').trim();
    renderTree();
    updateActionButtons();
  });

  $('file-browser-search-clear-btn')?.addEventListener('click', () => {
    fileBrowserState.searchKeyword = '';
    if ($('file-browser-search-input')) {
      $('file-browser-search-input').value = '';
    }
    renderTree();
    updateActionButtons();
  });

  document.querySelectorAll('[data-tree-filter]').forEach(button => {
    button.addEventListener('click', () => {
      fileBrowserState.treeFilter = button.dataset.treeFilter || 'all';
      renderTree();
      updateActionButtons();
    });
  });

  $('file-browser-expand-path-btn')?.addEventListener('click', () => {
    expandCurrentTreePath();
  });

  $('file-browser-collapse-tree-btn')?.addEventListener('click', () => {
    collapseTreeToActivePath();
  });

  $('file-browser-breadcrumbs')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-open-dir]');
    if (!button) return;
    closeContextMenu();
    if (!await confirmDiscardIfNeeded()) return;
    await loadDirectory(button.dataset.openDir || '', { clearSelection: true });
  });

  $('file-browser-entry-list')?.addEventListener('click', async event => {
    closeContextMenu();
    const toggleButton = event.target.closest('[data-tree-toggle-path]');
    if (toggleButton) {
      event.preventDefault();
      event.stopPropagation();
      const pathValue = normalizeRelativePath(toggleButton.dataset.treeTogglePath || '');
      const shouldExpand = !isTreeDirectoryExpanded(pathValue);
      setTreeDirectoryExpanded(pathValue, shouldExpand);
      if (shouldExpand) {
        try {
          await hydrateTreeDirectory(pathValue);
        } catch (error) {
          setBanner(error.message || '目录展开失败', 'error');
        }
      }
      renderTree();
      return;
    }

    const button = event.target.closest('[data-tree-open-path]');
    if (!button) return;
    const pathValue = normalizeRelativePath(button.dataset.treeOpenPath || '');
    const entryType = button.dataset.treeEntryType || 'file';
    if (!await confirmDiscardIfNeeded()) return;

    if (entryType === 'directory') {
      await loadDirectory(pathValue, { clearSelection: true });
      setBanner('目录已打开。', 'success');
      return;
    }
    await loadFile(pathValue);
  });

  $('file-browser-entry-list')?.addEventListener('contextmenu', event => {
    const button = event.target.closest('[data-tree-open-path]');
    if (!button) {
      closeContextMenu();
      return;
    }
    event.preventDefault();
    const target = createTreeTarget(
      button.dataset.treeOpenPath || '',
      button.dataset.treeEntryType || 'file',
    );
    openContextMenu(target, { x: event.clientX, y: event.clientY });
  });

  $('file-browser-context-menu')?.addEventListener('click', async event => {
    const actionButton = event.target.closest('[data-context-action]');
    if (!actionButton || actionButton.disabled) return;
    const target = fileBrowserState.contextMenu.target;
    const action = actionButton.dataset.contextAction || '';
    const baseDir = actionButton.dataset.contextBaseDir || '';
    closeContextMenu();
    await handleContextMenuAction(action, target, baseDir);
  });

  document.addEventListener('click', event => {
    const menu = $('file-browser-context-menu');
    if (!menu || menu.classList.contains('hidden')) {
      return;
    }
    if (event.target.closest('#file-browser-context-menu')) {
      return;
    }
    closeContextMenu();
  });

  document.addEventListener('contextmenu', event => {
    if (!event.target.closest('#file-browser-entry-list')) {
      closeContextMenu();
    }
  });

  window.addEventListener('scroll', () => {
    closeContextMenu();
  }, true);

  window.addEventListener('resize', () => {
    closeContextMenu();
    applySidebarWidth();
  });

  window.addEventListener('pointermove', event => {
    updateSidebarResize(event.clientX);
  });

  window.addEventListener('pointerup', () => {
    if (!fileBrowserState.sidebarResizeActive) {
      return;
    }
    persistSidebarWidth();
    stopSidebarResize();
  });

  window.addEventListener('pointercancel', () => {
    if (!fileBrowserState.sidebarResizeActive) {
      return;
    }
    persistSidebarWidth();
    stopSidebarResize();
  });

  window.addEventListener('beforeunload', event => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('file-browser-modal-mask')?.classList.contains('hidden')) {
      event.preventDefault();
      closeModal(false);
      return;
    }
    if (event.key === 'Escape' && !$('file-browser-find-panel')?.classList.contains('hidden')) {
      event.preventDefault();
      closeEditorSearchPanel();
      return;
    }
    if (event.key === 'Escape' && !$('file-browser-context-menu')?.classList.contains('hidden')) {
      event.preventDefault();
      closeContextMenu();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      $('file-browser-project-search-input')?.focus();
      $('file-browser-project-search-input')?.select();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openEditorSearchPanel({ replace: false });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      openEditorSearchPanel({ replace: true });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!$('file-browser-save-btn')?.disabled) {
        saveCurrentFile();
      }
    }
  });
}

async function initFileBrowser() {
  bindEvents();
  fileBrowserState.sidebarWidth = readPersistedSidebarWidth();
  applySidebarWidth();
  try {
    fileBrowserState.auth = window.CrystelfAuth?.status || await window.CrystelfAuth?.fetchAuthStatus?.();
  } catch (error) {
    setAuthBanner(error.message || '登录状态获取失败', 'error');
  }
  applyAuthState();
  renderViewMode();
  renderPreview();
  resetTreeState('');
  await loadDirectory('');
  renderSelectedFile();
}

document.addEventListener('DOMContentLoaded', () => {
  initFileBrowser();
});
