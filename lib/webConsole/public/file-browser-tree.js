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
