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

