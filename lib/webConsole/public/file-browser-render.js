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
    hintElement.textContent = '当前控制台是只读模式，可以查看文件，但不能保存修改。';
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
    hintElement.textContent = '还没有选择文件。可以从左侧目录树打开，也可以输入项目内路径打开。';
  }

  tagsElement.innerHTML = tags.map(tag => `
    <span class="file-browser-target-tag${tag.tone ? ` tone-${tag.tone}` : ''}">${escapeHtml(tag.label)}</span>
  `).join('');
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
    setAuthBanner('当前控制台是只读模式，可以查看文件，但不能新建、重命名或删除。', 'warning');
  } else {
    setAuthBanner('当前已登录，可在受限范围内浏览、新建、重命名，并安全删除文件或空目录。快捷键 Ctrl/Cmd + S 可直接保存。', 'success');
  }
  renderTargetSummary();
  renderPreview();
  updateActionButtons();
}

