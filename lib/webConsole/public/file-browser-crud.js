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
    help: '只能创建文本文件，位置会限制在当前机器人项目目录内。',
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
    help: '可以一次创建多级目录；隐藏目录和项目外目录会被拦截。',
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

