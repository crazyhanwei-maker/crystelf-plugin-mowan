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

function renderOpenFileList() {
  const container = $('file-browser-open-file-list');
  if (!container) {
    return;
  }

  if (!fileBrowserState.openTabs.length) {
    container.innerHTML = '<div class="file-manager-editor-side-empty">暂无已打开文件</div>';
    return;
  }

  const activePath = normalizeRelativePath(fileBrowserState.selectedFile?.path || '');
  container.innerHTML = fileBrowserState.openTabs.map(tab => {
    const isActive = activePath === tab.path;
    const dirty = isActive && isDirty();
    return `
      <button
        type="button"
        class="file-manager-editor-file-item${isActive ? ' is-active' : ''}${dirty ? ' is-dirty' : ''}"
        data-tab-open-path="${escapeHtml(tab.path)}"
        title="${escapeHtml(tab.path)}"
      >
        <span class="file-manager-editor-file-icon" aria-hidden="true"></span>
        <span class="file-manager-editor-file-copy">
          <span class="file-manager-editor-file-name">${escapeHtml(tab.name)}</span>
          <span class="file-manager-editor-file-path">${escapeHtml(tab.path)}</span>
        </span>
      </button>
    `;
  }).join('');
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
    renderOpenFileList();
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
  renderOpenFileList();
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
