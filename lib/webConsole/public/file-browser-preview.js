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
  if (fileBrowserState.previewController) {
    try {
      fileBrowserState.previewController.abort();
    } catch {}
    fileBrowserState.previewController = null;
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  fileBrowserState.previewController = controller;
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
        ...(controller?.signal ? { signal: controller.signal } : {}),
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
      if (requestId !== fileBrowserState.previewRequestId || error?.name === 'AbortError') {
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
    } finally {
      if (requestId === fileBrowserState.previewRequestId && fileBrowserState.previewController === controller) {
        fileBrowserState.previewController = null;
      }
    }
  };

  if (immediate) {
    run();
    return;
  }

  fileBrowserState.previewTimer = window.setTimeout(run, 240);
}

