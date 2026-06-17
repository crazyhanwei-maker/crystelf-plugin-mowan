function resetPreviewState() {
  if (fileBrowserState.previewTimer) {
    window.clearTimeout(fileBrowserState.previewTimer);
    fileBrowserState.previewTimer = 0;
  }
  if (fileBrowserState.previewController) {
    try {
      fileBrowserState.previewController.abort();
    } catch {}
    fileBrowserState.previewController = null;
  }
  fileBrowserState.previewLoading = false;
  fileBrowserState.previewHtml = '';
  fileBrowserState.previewLanguage = '';
  fileBrowserState.previewDetectedLanguage = '';
  fileBrowserState.previewLineCount = 0;
  fileBrowserState.previewByteLength = 0;
  fileBrowserState.previewError = '';
  fileBrowserState.previewRequestId += 1;
}

function clearSelectedFile() {
  fileBrowserState.selectedFile = null;
  fileBrowserState.selectedContent = '';
  fileBrowserState.lastSavedContent = '';
  fileBrowserState.pendingEditorSelection = null;
  fileBrowserState.editorSearch.currentMatchIndex = -1;
  fileBrowserState.editorSearch.visible = false;
  fileBrowserState.editorSearch.replaceMode = false;
  resetPreviewState();
  updateEditorShellVisibility();
}

function getCurrentTarget() {
  if (fileBrowserState.selectedFile?.path) {
    return {
      type: 'file',
      path: fileBrowserState.selectedFile.path,
      name: fileBrowserState.selectedFile.name || fileBrowserState.selectedFile.path,
    };
  }
  if (fileBrowserState.currentDirectoryInfo) {
    return {
      type: 'directory',
      path: fileBrowserState.currentDirectoryInfo.path,
      name: fileBrowserState.currentDirectoryInfo.name || fileBrowserState.currentDirectoryInfo.path,
    };
  }
  return null;
}

function closeContextMenu() {
  fileBrowserState.contextMenu.visible = false;
  fileBrowserState.contextMenu.target = null;
  const menu = $('file-browser-context-menu');
  if (!menu) return;
  menu.classList.add('hidden');
  menu.innerHTML = '';
  menu.style.left = '0px';
  menu.style.top = '0px';
}

function getContextMenuDirectoryBase(target) {
  return target?.type === 'directory'
    ? normalizeRelativePath(target.path)
    : getParentPath(target?.path || '');
}

function getContextMenuItems(target) {
  if (!target?.path && target?.type !== 'directory') {
    return [];
  }
  const readOnly = fileBrowserState.auth?.readOnly === true;
  const isDirectory = target.type === 'directory';
  const targetDirectory = getContextMenuDirectoryBase(target);
  const canMutate = !readOnly && Boolean(target.path);
  const isCurrentDirectory = isDirectory
    && normalizeRelativePath(target.path) === normalizeRelativePath(fileBrowserState.currentDir);
  const items = [
    { id: 'open', label: isDirectory ? '打开目录' : '打开文件', meta: 'Enter' },
    { id: 'copy-path', label: '复制相对路径', meta: 'Path' },
  ];

  if (isDirectory) {
    items.push({
      id: isTreeDirectoryExpanded(target.path) ? 'collapse-dir' : 'expand-dir',
      label: isTreeDirectoryExpanded(target.path)
        ? (isCurrentDirectory ? '当前目录保持展开' : '折叠目录')
        : '展开目录',
      meta: isCurrentDirectory ? 'Lock' : 'Tree',
      disabled: isTreeDirectoryExpanded(target.path) && isCurrentDirectory,
    });
  } else {
    items.push({ id: 'open-parent', label: '打开所在目录', meta: 'Dir' });
    items.push({ id: 'copy-file', label: '复制文件备份', meta: 'Copy', disabled: readOnly });
  }

  items.push({ type: 'separator' });
  items.push({
    id: 'new-file',
    label: isDirectory ? '在此新建文件' : '在同级新建文件',
    meta: 'New',
    disabled: readOnly,
    baseDir: targetDirectory,
  });
  items.push({
    id: 'new-dir',
    label: isDirectory ? '在此新建目录' : '在同级新建目录',
    meta: 'New',
    disabled: readOnly,
    baseDir: targetDirectory,
  });
  items.push({ type: 'separator' });
  items.push({ id: 'rename', label: '重命名', meta: 'Edit', disabled: !canMutate });
  items.push({ id: 'delete', label: '删除', meta: 'Del', disabled: !canMutate });
  return items;
}

function renderContextMenu() {
  const menu = $('file-browser-context-menu');
  const { visible, target, x, y } = fileBrowserState.contextMenu;
  if (!menu) return;
  if (!visible || !target) {
    closeContextMenu();
    return;
  }

  const items = getContextMenuItems(target);
  if (!items.length) {
    closeContextMenu();
    return;
  }

  menu.innerHTML = `
    <div class="file-browser-context-menu-group">
      ${items.map(item => {
        if (item.type === 'separator') {
          return '<div class="file-browser-context-menu-separator"></div>';
        }
        return `
          <button
            type="button"
            class="file-browser-context-menu-item"
            data-context-action="${escapeHtml(item.id)}"
            ${item.baseDir ? `data-context-base-dir="${escapeHtml(item.baseDir)}"` : ''}
            ${item.disabled ? 'disabled' : ''}
          >
            <span class="file-browser-context-menu-label">${escapeHtml(item.label)}</span>
            <span class="file-browser-context-menu-meta">${escapeHtml(item.meta || '')}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
  menu.classList.remove('hidden');
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;

  window.requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const nextLeft = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - rect.width - 8));
    const nextTop = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - rect.height - 8));
    menu.style.left = `${nextLeft}px`;
    menu.style.top = `${nextTop}px`;
  });
}

function openContextMenu(target, position = {}) {
  fileBrowserState.contextMenu.visible = true;
  fileBrowserState.contextMenu.target = target;
  fileBrowserState.contextMenu.x = Number(position.x || 0);
  fileBrowserState.contextMenu.y = Number(position.y || 0);
  renderContextMenu();
}

async function copyText(text = '') {
  const value = String(text || '').trim();
  if (!value) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back to execCommand for browsers that block clipboard writes without focus.
    }
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', 'readonly');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  input.focus();
  input.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    input.remove();
  }
  return copied;
}

function getEditorContent() {
  return $('file-browser-editor')?.value || '';
}

function isDirty() {
  return Boolean(fileBrowserState.selectedFile) && getEditorContent() !== fileBrowserState.lastSavedContent;
}

function setBanner(message = '', tone = '') {
  const className = `file-browser-banner${message ? '' : ' hidden'}${tone ? ` tone-${tone}` : ''}`;
  const editorStatus = $('file-browser-editor-status');
  if (editorStatus) {
    editorStatus.textContent = message;
    editorStatus.className = className;
  }
  const overlayStatus = $('file-browser-editor-overlay-status');
  if (overlayStatus) {
    overlayStatus.textContent = message || '就绪';
    overlayStatus.className = `file-manager-editor-message${message ? '' : ' hidden'}${tone ? ` tone-${tone}` : ''}`;
  }
}

function updateEditorShellVisibility() {
  const shell = $('file-browser-editor-shell');
  if (!shell) return;
  const isOpen = Boolean(fileBrowserState.selectedFile?.path);
  shell.classList.toggle('hidden', !isOpen);
  shell.classList.toggle('is-maximized', isOpen && fileBrowserState.editorWindowMaximized === true);
  document.body.classList.toggle('file-browser-editor-open', isOpen);
  $('file-browser-editor-maximize-btn')?.setAttribute(
    'title',
    fileBrowserState.editorWindowMaximized ? '还原' : '最大化',
  );
  $('file-browser-editor-maximize-btn')?.setAttribute(
    'aria-label',
    fileBrowserState.editorWindowMaximized ? '还原编辑窗口' : '最大化编辑窗口',
  );
}

async function closeEditorOverlay() {
  if (!fileBrowserState.selectedFile?.path) {
    updateEditorShellVisibility();
    return;
  }
  if (!await confirmDiscardIfNeeded()) {
    return;
  }
  clearSelectedFile();
  renderSelectedFile();
}

function pushDirectoryHistory(pathValue = '') {
  const normalized = normalizeRelativePath(pathValue);
  const current = normalizeRelativePath(fileBrowserState.currentDir);
  if (normalized === current) {
    return;
  }
  if (fileBrowserState.history.back[fileBrowserState.history.back.length - 1] !== current) {
    fileBrowserState.history.back.push(current);
  }
  fileBrowserState.history.back = fileBrowserState.history.back.slice(-30);
  fileBrowserState.history.forward = [];
}

async function goBackDirectory() {
  if (!fileBrowserState.history.back.length) return;
  const target = fileBrowserState.history.back.pop();
  const current = normalizeRelativePath(fileBrowserState.currentDir);
  fileBrowserState.history.forward.push(current);
  fileBrowserState.history.forward = fileBrowserState.history.forward.slice(-30);
  await loadDirectory(target || '', { clearSelection: true, skipHistory: true });
}

async function goForwardDirectory() {
  if (!fileBrowserState.history.forward.length) return;
  const target = fileBrowserState.history.forward.pop();
  const current = normalizeRelativePath(fileBrowserState.currentDir);
  fileBrowserState.history.back.push(current);
  fileBrowserState.history.back = fileBrowserState.history.back.slice(-30);
  await loadDirectory(target || '', { clearSelection: true, skipHistory: true });
}

async function goUpDirectory() {
  if (!await confirmDiscardIfNeeded()) return;
  const target = getParentPath(fileBrowserState.currentDir || '');
  await loadDirectory(target, { clearSelection: true });
}

function setAuthBanner(message = '', tone = '') {
  const element = $('file-browser-auth-banner');
  if (!element) return;
  element.textContent = message;
  element.className = `file-browser-banner${message ? '' : ' hidden'}${tone ? ` tone-${tone}` : ''}`;
}

function closeModal(result = null) {
  $('file-browser-modal-mask')?.classList.add('hidden');
  $('file-browser-modal-confirm-btn')?.classList.remove('danger');
  if (typeof fileBrowserState.modalResolver === 'function') {
    const resolve = fileBrowserState.modalResolver;
    fileBrowserState.modalResolver = null;
    resolve(result);
  }
}

function openModal({
  title = '操作确认',
  content = '',
  html = false,
  confirmText = '确定',
  cancelText = '取消',
  showCancel = true,
  danger = false,
  cardClass = '',
  contentClass = '',
} = {}) {
  $('file-browser-modal-title').textContent = title;
  const cardElement = document.querySelector('#file-browser-modal-mask .modal-card');
  const contentElement = $('file-browser-modal-content');
  if (cardElement) {
    cardElement.className = `modal-card${cardClass ? ` ${cardClass}` : ''}`;
  }
  contentElement.className = `modal-content${contentClass ? ` ${contentClass}` : ''}`;
  if (html) {
    contentElement.innerHTML = content;
  } else {
    contentElement.textContent = content;
  }

  const confirmButton = $('file-browser-modal-confirm-btn');
  const cancelButton = $('file-browser-modal-cancel-btn');
  confirmButton.textContent = confirmText;
  cancelButton.textContent = cancelText;
  cancelButton.classList.toggle('hidden', !showCancel);
  confirmButton.classList.toggle('danger', danger);
  $('file-browser-modal-mask').classList.remove('hidden');

  window.setTimeout(() => {
    const input = $('file-browser-modal-input');
    if (input) {
      input.onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          $('file-browser-modal-confirm-btn')?.click();
        }
      };
      input.focus();
      input.select();
      return;
    }
    confirmButton.focus();
  }, 0);

  return new Promise(resolve => {
    fileBrowserState.modalResolver = resolve;
  });
}

async function openConfirmDialog({
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return await openModal({
    title,
    content: message,
    confirmText,
    cancelText,
    danger,
  });
}

async function openPromptDialog({
  title,
  label,
  value = '',
  placeholder = '',
  help = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  const escapedValue = escapeHtml(value);
  const escapedPlaceholder = escapeHtml(placeholder);
  const escapedLabel = escapeHtml(label);
  const escapedHelp = help ? `<div class="file-browser-modal-help">${escapeHtml(help)}</div>` : '';
  const confirmed = await openModal({
    title,
    confirmText,
    cancelText,
    danger,
    html: true,
    content: `
      <div class="file-browser-modal-form">
        <label for="file-browser-modal-input">${escapedLabel}</label>
        <input id="file-browser-modal-input" type="text" value="${escapedValue}" placeholder="${escapedPlaceholder}" />
        ${escapedHelp}
      </div>
    `,
  });
  if (!confirmed) {
    return null;
  }
  return normalizeRelativePath($('file-browser-modal-input')?.value || '');
}

