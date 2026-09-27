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
    const requestedPath = normalizeRelativePath(pathValue);
    if (options.skipHistory !== true) {
      pushDirectoryHistory(requestedPath);
    }
    const data = await fetchDirectoryPayload(pathValue);
    const nextDir = normalizeRelativePath(data.current?.path || '');

    fileBrowserState.root = data.root || null;
    fileBrowserState.currentDir = nextDir;
    fileBrowserState.currentDirectoryInfo = data.current || null;
    fileBrowserState.entries = Array.isArray(data.entries) ? data.entries : [];
    fileBrowserState.directoryPage = 1;
    // 勾选跨分页保留；切换目录即作废
    if (fileBrowserState.selectedPaths.size) {
      fileBrowserState.selectedPaths.clear();
      updateBatchBar();
    }

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
    updateEditorShellVisibility();
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

// 常见图片扩展名：点击后走内联预览而非文本读取
const FILE_BROWSER_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.avif',
]);

function isImageFilePath(pathValue = '') {
  const name = String(pathValue || '').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return FILE_BROWSER_IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function imagePreviewUrl(pathValue = '') {
  return `/api/file-browser/download?path=${encodeURIComponent(normalizeRelativePath(pathValue))}&inline=1`;
}

async function loadFile(pathValue) {
  if (!pathValue) return;
  // 图片文件：不读文本，取元数据后走内联图片预览
  if (isImageFilePath(pathValue)) {
    fileBrowserState.loadingFile = true;
    updateActionButtons();
    setBanner('正在加载图片...', '');
    try {
      const data = await fetchJson(`/api/file-browser/node?path=${encodeURIComponent(pathValue)}`);
      const node = data.node || {};
      fileBrowserState.selectedFile = {
        path: node.path || pathValue,
        name: node.name || getPathName(pathValue),
        size: Number(node.size || 0),
        mtimeMs: Number(node.mtimeMs || 0),
        editable: false,
        isImage: true,
      };
      fileBrowserState.selectedContent = '';
      fileBrowserState.lastSavedContent = '';
      rememberOpenTab(fileBrowserState.selectedFile);
      resetPreviewState();
      // 图片没有编辑区内容，直接切到预览视图
      if (fileBrowserState.viewMode === 'edit') {
        setViewMode('preview');
      }
      renderSelectedFile();
      renderTree();
      scheduleTreeFocus(fileBrowserState.selectedFile.path);
      setBanner('图片已加载。', 'success');
    } catch (error) {
      setBanner(error.message || '图片加载失败', 'error');
    } finally {
      fileBrowserState.loadingFile = false;
      updateActionButtons();
    }
    return;
  }
  fileBrowserState.loadingFile = true;
  updateActionButtons();
  setBanner('正在加载文件...', '');
  try {
    const data = await fetchJson(`/api/file-browser/read?path=${encodeURIComponent(pathValue)}`);
    fileBrowserState.selectedFile = data.file || null;
    fileBrowserState.selectedContent = data.file?.content || '';
    fileBrowserState.lastSavedContent = data.file?.content || '';
    // 行尾符模式跟随文件现状
    fileBrowserState.editorEolMode = /\r\n/.test(data.file?.content || '') ? 'crlf' : 'lf';
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
    // textarea 的 value 恒为 LF：按行尾符模式在写盘时转换
    const rawContent = getEditorContent();
    const content = fileBrowserState.editorEolMode === 'crlf'
      ? rawContent.replace(/\r?\n/g, '\r\n')
      : rawContent.replace(/\r?\n/g, '\n');
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

