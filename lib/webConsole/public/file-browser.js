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

function createFileBrowserDebouncedTask(fn, delay = 140) {
  if (typeof window.CrystelfUi?.debounce === 'function') {
    return window.CrystelfUi.debounce(fn, delay);
  }
  let timer = null;
  const task = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
  task.cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  return task;
}

const scheduleFileTreeFilterRender = createFileBrowserDebouncedTask(() => {
  renderTree();
  updateActionButtons();
}, 140);

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
    scheduleFileTreeFilterRender();
  });

  $('file-browser-search-clear-btn')?.addEventListener('click', () => {
    fileBrowserState.searchKeyword = '';
    if ($('file-browser-search-input')) {
      $('file-browser-search-input').value = '';
    }
    scheduleFileTreeFilterRender.cancel?.();
    renderTree();
    updateActionButtons();
  });

  document.querySelectorAll('[data-tree-filter]').forEach(button => {
    button.addEventListener('click', () => {
      fileBrowserState.treeFilter = button.dataset.treeFilter || 'all';
      scheduleFileTreeFilterRender.cancel?.();
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
  const initialOpenPath = getInitialOpenPathFromUrl();
  if (initialOpenPath) {
    if ($('file-browser-open-input')) {
      $('file-browser-open-input').value = initialOpenPath;
    }
    await openPath(initialOpenPath, { skipConfirm: true });
  } else {
    await loadDirectory('');
  }
  renderSelectedFile();
}

document.addEventListener('DOMContentLoaded', () => {
  initFileBrowser();
});
