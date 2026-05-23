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
