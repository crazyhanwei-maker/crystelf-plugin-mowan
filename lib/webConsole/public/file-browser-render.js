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
    const entries = getVisibleDirectoryEntries();
    const directoryCount = entries.filter(entry => entry.type === 'directory').length;
    const fileCount = entries.length - directoryCount;
    stats.textContent = `共 ${directoryCount} 个目录，${fileCount} 个文件，当前目录大小 计算`;
    return;
  }

  stats.textContent = '暂无内容';
}

function updateDirectoryPager(entries = []) {
  const total = Array.isArray(entries) ? entries.length : 0;
  const pageSize = Math.max(1, Number(fileBrowserState.directoryPageSize || 100));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  fileBrowserState.directoryPage = Math.min(Math.max(1, Number(fileBrowserState.directoryPage || 1)), totalPages);

  const pageElement = $('file-browser-current-page');
  if (pageElement) {
    pageElement.textContent = String(fileBrowserState.directoryPage);
  }

  const pageSizeSelect = $('file-browser-page-size-select');
  if (pageSizeSelect && pageSizeSelect.value !== String(pageSize)) {
    pageSizeSelect.value = String(pageSize);
  }

  const prevButton = $('file-browser-prev-page-btn');
  if (prevButton) {
    prevButton.disabled = fileBrowserState.directoryPage <= 1;
  }

  const nextButton = $('file-browser-next-page-btn');
  if (nextButton) {
    nextButton.disabled = fileBrowserState.directoryPage >= totalPages;
  }
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

function getEditorLanguageLabel(file = null) {
  const name = String(file?.name || file?.path || '').toLowerCase();
  if (!name) return 'plaintext';
  if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) return 'javascript';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md')) return 'markdown';
  if (name.endsWith('.css')) return 'css';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  if (name.endsWith('.php')) return 'php';
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'yaml';
  if (name.endsWith('.ts')) return 'typescript';
  if (name.endsWith('.vue')) return 'vue';
  if (name.endsWith('.py')) return 'python';
  if (name.endsWith('.sh')) return 'shell';
  if (name.endsWith('.cmd') || name.endsWith('.bat')) return 'batch';
  return 'plaintext';
}

function getEditorEolLabel(content = '') {
  const value = String(content || '');
  return /\r\n/.test(value) ? 'CRLF (Windows)' : 'LF (Linux)';
}

function renderEditorStatusbar() {
  const file = fileBrowserState.selectedFile;
  fileBrowserState.editorLanguageLabel = getEditorLanguageLabel(file);
  fileBrowserState.editorEolLabel = getEditorEolLabel(getEditorContent());

  const languageButton = $('file-browser-editor-language-btn');
  if (languageButton) {
    languageButton.textContent = `语言 ${fileBrowserState.editorLanguageLabel}`;
  }
  const eolButton = $('file-browser-editor-eol-btn');
  if (eolButton) {
    eolButton.textContent = fileBrowserState.editorEolLabel;
  }
  const themeButton = $('file-browser-editor-theme-btn');
  if (themeButton) {
    themeButton.textContent = '主题 VS Dark';
  }
  const languageStatus = $('file-browser-editor-language-status');
  if (languageStatus) {
    languageStatus.textContent = `语言：${fileBrowserState.editorLanguageLabel}`;
  }
}

function renderEditorLineGutter() {
  const gutter = $('file-browser-editor-line-gutter');
  if (!gutter) {
    return;
  }
  const content = getEditorContent();
  const lineCount = Math.max(1, String(content || '').split(/\r?\n/).length);
  const maxVisibleLines = Math.min(lineCount, 1200);
  const lines = [];
  for (let index = 1; index <= maxVisibleLines; index += 1) {
    lines.push(`<span>${index}</span>`);
  }
  if (lineCount > maxVisibleLines) {
    lines.push('<span>...</span>');
  }
  gutter.innerHTML = lines.join('');
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
    && !fileBrowserState.copyingFile
    && !fileBrowserState.renamingNode
    && !fileBrowserState.deletingNode;
  const canCopyFile = Boolean(target?.type === 'file' && target.path)
    && !readOnly
    && !fileBrowserState.copyingFile;

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

  const copyCurrentFileButton = $('file-browser-copy-current-file-btn');
  if (copyCurrentFileButton) {
    copyCurrentFileButton.disabled = !hasFile || readOnly || fileBrowserState.copyingFile;
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

  const backButton = $('file-browser-back-btn');
  if (backButton) {
    backButton.disabled = fileBrowserState.history.back.length <= 0 || fileBrowserState.loadingTree;
  }

  const forwardButton = $('file-browser-forward-btn');
  if (forwardButton) {
    forwardButton.disabled = fileBrowserState.history.forward.length <= 0 || fileBrowserState.loadingTree;
  }

  const upButton = $('file-browser-up-btn');
  if (upButton) {
    upButton.disabled = !normalizeRelativePath(fileBrowserState.currentDir || '') || fileBrowserState.loadingTree;
  }

  const showHiddenButton = $('file-browser-show-hidden-btn');
  if (showHiddenButton) {
    const showHidden = fileBrowserState.showHidden !== false;
    showHiddenButton.classList.toggle('is-active', showHidden);
    showHiddenButton.setAttribute('aria-pressed', String(showHidden));
    showHiddenButton.title = showHidden ? '隐藏点号开头文件' : '显示隐藏文件';
  }

  const newFileButton = $('file-browser-new-file-btn');
  if (newFileButton) {
    newFileButton.disabled = readOnly || fileBrowserState.creatingFile;
  }

  const newDirectoryButton = $('file-browser-new-dir-btn');
  if (newDirectoryButton) {
    newDirectoryButton.disabled = readOnly || fileBrowserState.creatingDirectory;
  }

  const uploadButton = $('file-browser-upload-btn');
  if (uploadButton) {
    uploadButton.disabled = readOnly || fileBrowserState.uploadingFiles;
  }

  const copyFileButton = $('file-browser-copy-file-btn');
  if (copyFileButton) {
    copyFileButton.disabled = !canCopyFile;
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
    projectSearchButton.disabled = fileBrowserState.projectSearch.loading || !String(fileBrowserState.searchKeyword || '').trim();
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
  renderEditorStatusbar();
  renderEditorLineGutter();
  renderEditorSearchPanel();
  renderProjectSearchPanel();
}


function renderSummary() {
  const current = fileBrowserState.currentDir || '/';
  $('file-browser-root-path').textContent = `共 ${getVisibleDirectoryEntries().length} 条，当前目录：${current}`;
  $('file-browser-current-dir').textContent = fileBrowserState.currentDir || '/';
}

function renderBreadcrumbs() {
  const container = $('file-browser-breadcrumbs');
  if (!container) return;
  const parts = fileBrowserState.currentDir ? fileBrowserState.currentDir.split('/') : [];
  const items = [{ label: '', path: '', home: true }];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    items.push({ label: part, path: current });
  }

  container.innerHTML = items.map((item, index) => `
    <button
      type="button"
      class="file-browser-crumb${item.home ? ' is-home' : ''}${index === items.length - 1 ? ' is-active' : ''}"
      data-open-dir="${escapeHtml(item.path)}"
    >${item.home ? '<span aria-hidden="true" class="file-browser-home-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>' : escapeHtml(item.label)}</button>
  `).join('');
}

function getFileBrowserEntryIconClass(entry = {}) {
  if (entry.type === 'directory') return 'is-directory';
  const name = String(entry.name || entry.path || '').toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif|svg)$/.test(name)) return 'is-image';
  if (/\.(zip|tar|gz|7z|rar)$/.test(name)) return 'is-archive';
  return 'is-file';
}

function getFileBrowserEntryTypeLabel(entry = {}) {
  if (entry.type === 'directory') return '目录';
  if (entry.editable === true) return '文本文件';
  return '只读文件';
}

function getVisibleDirectoryEntries() {
  const keyword = String(fileBrowserState.searchKeyword || '').trim().toLowerCase();
  const showHidden = fileBrowserState.showHidden !== false;
  return (Array.isArray(fileBrowserState.entries) ? fileBrowserState.entries : [])
    .filter(entry => showHidden || !String(entry.name || '').startsWith('.'))
    .filter(entry => {
      if (!keyword) return true;
      return `${entry.name || ''} ${entry.path || ''}`.toLowerCase().includes(keyword);
    });
}

function renderDirectoryTable() {
  const table = $('file-browser-directory-table');
  const status = $('file-browser-directory-status');
  if (!table) return;

  const entries = getVisibleDirectoryEntries();
  updateDirectoryPager(entries);
  const directoryCount = entries.filter(entry => entry.type === 'directory').length;
  const fileCount = entries.filter(entry => entry.type !== 'directory').length;
  if (status) {
    const dir = fileBrowserState.currentDir || '/';
    status.textContent = fileBrowserState.loadingTree
      ? '正在加载目录内容...'
      : `${dir} · ${directoryCount} 个目录 / ${fileCount} 个文件`;
  }

  if (!entries.length) {
    table.innerHTML = '<div class="file-browser-empty">当前目录没有可显示的文件或目录。</div>';
    return;
  }

  const activePath = normalizeRelativePath(fileBrowserState.selectedFile?.path || fileBrowserState.currentDirectoryInfo?.path || '');
  const pageSize = Math.max(1, Number(fileBrowserState.directoryPageSize || 100));
  const page = Math.max(1, Number(fileBrowserState.directoryPage || 1));
  const pageEntries = entries.slice((page - 1) * pageSize, page * pageSize);
  const rows = pageEntries.map(entry => {
    const pathValue = normalizeRelativePath(entry.path || '');
    const active = pathValue && activePath === pathValue;
    const isDirectory = entry.type === 'directory';
    const permission = entry.permission || '-';
    const ownerGroup = [entry.owner || '-', entry.group || '-'].join(' / ');
    return `
      <button
        type="button"
        class="file-browser-file-row${active ? ' is-active' : ''}"
        data-file-row-path="${escapeHtml(pathValue)}"
        data-file-row-type="${escapeHtml(entry.type || 'file')}"
        title="${escapeHtml(pathValue)}"
      >
        <span class="file-browser-file-cell file-browser-file-name-cell">
          <span class="file-browser-file-icon ${getFileBrowserEntryIconClass(entry)}" aria-hidden="true"></span>
          <span class="file-browser-file-name-wrap">
            <strong>${escapeHtml(entry.name || getPathName(pathValue))}</strong>
          </span>
        </span>
        <span class="file-browser-file-cell">${escapeHtml(permission)}</span>
        <span class="file-browser-file-cell">${escapeHtml(ownerGroup)}</span>
        <span class="file-browser-file-cell file-browser-link-cell">${isDirectory ? '计算' : escapeHtml(formatBytes(entry.size))}</span>
        <span class="file-browser-file-cell">${escapeHtml(formatTime(entry.mtimeMs))}</span>
        <span class="file-browser-file-cell">-</span>
        <span class="file-browser-file-cell file-browser-row-actions">
          <span data-file-row-action="open">打开</span>
          ${isDirectory ? '' : '<span data-file-row-action="copy">复制</span>'}
          <span data-file-row-action="more">更多</span>
        </span>
      </button>
    `;
  }).join('');

  table.innerHTML = `
    <div class="file-browser-file-table-head">
      <span>名称</span>
      <span>权限</span>
      <span>用户 / 用户组</span>
      <span>大小</span>
      <span>修改时间</span>
      <span>备注</span>
      <span>操作</span>
    </div>
    <div class="file-browser-file-table-body">${rows}</div>
  `;
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
    renderDirectoryTable();
    updateDirtyIndicator();
    renderEditorActionBar();
    renderEditorStatusbar();
    renderEditorLineGutter();
    renderViewMode();
    renderPreview();
    updateActionButtons();
    updateEditorShellVisibility();
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
    renderDirectoryTable();
    updateDirtyIndicator();
    renderEditorActionBar();
    renderEditorStatusbar();
    renderEditorLineGutter();
    renderViewMode();
    renderPreview();
    updateActionButtons();
    renderProjectSearchPanel();
    updateEditorShellVisibility();
    return;
  }

  title.textContent = '未选择文件';
  meta.textContent = '选择左侧文本文件后可查看和编辑。';
  if (editor) {
    editor.value = '';
  }
  updateFileStats();
  renderTargetSummary();
  renderDirectoryTable();
  updateDirtyIndicator();
  renderEditorActionBar();
  renderEditorStatusbar();
  renderEditorLineGutter();
  renderViewMode();
  renderPreview();
  updateActionButtons();
  renderProjectSearchPanel();
  updateEditorShellVisibility();
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
  renderDirectoryTable();

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
    setAuthBanner('', '');
  }
  renderTargetSummary();
  renderPreview();
  updateActionButtons();
}

