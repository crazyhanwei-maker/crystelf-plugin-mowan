const helpDiyState = {
  payload: null,
  activePreview: 'home',
  templates: [],
  lastSavedPayload: null,
  history: [],
};

const HELP_DIY_LOCAL_IMAGE_PREFIX = '/uploads/help-diy/';
const HELP_DIY_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function buildHeaders(extra = {}) {
  return { ...extra };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store', headers: buildHeaders() });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return await response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(data.error || `${url} -> ${response.status}`);
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function isLocalHelpDiyImage(value = '') {
  return String(value || '').trim().startsWith(HELP_DIY_LOCAL_IMAGE_PREFIX);
}

function normalizeHelpDiyBlock(block = {}, fallbackText = '') {
  if (typeof block === 'string') {
    return { mode: 'text', text: block || fallbackText || '', image: '' };
  }
  const image = String(block?.image || '').trim();
  return {
    mode: block?.mode === 'image' && image ? 'image' : 'text',
    text: String(block?.text || fallbackText || '').trim(),
    image,
  };
}

function normalizeHelpDiyPayload(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    ...source,
    enabled: source.enabled === true,
    home: normalizeHelpDiyBlock(source.home),
    categories: {
      ai: normalizeHelpDiyBlock(source.categories?.ai),
      manage: normalizeHelpDiyBlock(source.categories?.manage),
      fun: normalizeHelpDiyBlock(source.categories?.fun),
      debug: normalizeHelpDiyBlock(source.categories?.debug),
    },
  };
}

function collectHelpDiyImages(payload = {}) {
  const normalized = normalizeHelpDiyPayload(payload);
  return new Set([
    normalized.home.image,
    normalized.categories.ai.image,
    normalized.categories.manage.image,
    normalized.categories.fun.image,
    normalized.categories.debug.image,
  ].filter(isLocalHelpDiyImage));
}

function getDraft() {
  return {
    enabled: document.getElementById('help-diy-enabled').checked,
    home: {
      mode: document.getElementById('help-diy-home-mode').value,
      text: document.getElementById('help-diy-home').value,
      image: document.getElementById('help-diy-home-image').value,
    },
    categories: {
      ai: {
        mode: document.getElementById('help-diy-ai-mode').value,
        text: document.getElementById('help-diy-ai').value,
        image: document.getElementById('help-diy-ai-image').value,
      },
      manage: {
        mode: document.getElementById('help-diy-manage-mode').value,
        text: document.getElementById('help-diy-manage').value,
        image: document.getElementById('help-diy-manage-image').value,
      },
      fun: {
        mode: document.getElementById('help-diy-fun-mode').value,
        text: document.getElementById('help-diy-fun').value,
        image: document.getElementById('help-diy-fun-image').value,
      },
      debug: {
        mode: document.getElementById('help-diy-debug-mode').value,
        text: document.getElementById('help-diy-debug').value,
        image: document.getElementById('help-diy-debug-image').value,
      },
    },
  };
}

function sanitizeComparablePayload(payload = {}) {
  const normalized = normalizeHelpDiyPayload(payload);
  return {
    enabled: normalized.enabled === true,
    home: {
      mode: normalized.home.mode || 'text',
      text: normalized.home.text || '',
      image: normalized.home.image || '',
    },
    categories: {
      ai: {
        mode: normalized.categories.ai.mode || 'text',
        text: normalized.categories.ai.text || '',
        image: normalized.categories.ai.image || '',
      },
      manage: {
        mode: normalized.categories.manage.mode || 'text',
        text: normalized.categories.manage.text || '',
        image: normalized.categories.manage.image || '',
      },
      fun: {
        mode: normalized.categories.fun.mode || 'text',
        text: normalized.categories.fun.text || '',
        image: normalized.categories.fun.image || '',
      },
      debug: {
        mode: normalized.categories.debug.mode || 'text',
        text: normalized.categories.debug.text || '',
        image: normalized.categories.debug.image || '',
      },
    },
  };
}

function normalizeForCompare(payload = {}) {
  return JSON.stringify(sanitizeComparablePayload(payload));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasUnsavedChanges() {
  return helpDiyState.lastSavedPayload
    ? normalizeForCompare(getDraft()) !== normalizeForCompare(helpDiyState.lastSavedPayload)
    : false;
}

function renderDirtyStatus(message = '') {
  const element = document.getElementById('help-diy-dirty-status');
  if (!element) return;
  if (message) {
    element.textContent = message;
    return;
  }
  const dirty = hasUnsavedChanges();
  element.textContent = dirty ? '当前状态：有未保存修改' : '当前状态：已保存';
}

function syncHelpDiyModeControls() {
  ['home', 'ai', 'manage', 'fun', 'debug'].forEach(slot => {
    const modeSelect = document.getElementById(`help-diy-${slot}-mode`);
    const toolbar = modeSelect?.closest('.help-diy-mode-toolbar');
    const textInput = document.getElementById(`help-diy-${slot}`);
    const imageMode = modeSelect?.value === 'image';
    toolbar?.classList.toggle('is-image-mode', imageMode);
    toolbar?.classList.toggle('is-text-mode', !imageMode);
    textInput?.classList.toggle('is-image-mode', imageMode);
  });
}

function renderPreview() {
  syncHelpDiyModeControls();
  const draft = getDraft();
  const mapping = {
    home: draft.home,
    ai: draft.categories.ai,
    manage: draft.categories.manage,
    fun: draft.categories.fun,
    debug: draft.categories.debug,
  };
  const current = mapping[helpDiyState.activePreview] || { mode: 'text', text: '', image: '' };
  const previewShell = document.getElementById('help-diy-preview-shell');
  const textPreview = document.getElementById('help-diy-preview');
  const imageWrap = document.getElementById('help-diy-image-preview-wrap');
  const imagePreview = document.getElementById('help-diy-image-preview');

  previewShell?.classList.toggle('is-image-mode', current.mode === 'image');
  previewShell?.classList.toggle('is-image-empty', current.mode === 'image' && !isLocalHelpDiyImage(current.image));
  if (current.mode === 'image') {
    const imageMessage = current.image && isLocalHelpDiyImage(current.image)
      ? current.image
      : '未填写本地上传图片地址';
    textPreview.textContent = `图片发送\n${imageMessage}`;
    if (current.image && isLocalHelpDiyImage(current.image)) {
      imagePreview.src = current.image;
      imageWrap.classList.remove('hidden');
    } else {
      imagePreview.removeAttribute('src');
      imageWrap.classList.add('hidden');
    }
    return;
  }

  textPreview.textContent = current.text || '暂无内容';
  imagePreview.removeAttribute('src');
  imageWrap.classList.add('hidden');
}

function render(payload, options = {}) {
  const { markAsSaved = true } = options;
  const normalizedPayload = normalizeHelpDiyPayload(payload);
  helpDiyState.payload = normalizedPayload;
  if (markAsSaved) {
    helpDiyState.lastSavedPayload = JSON.parse(JSON.stringify(normalizedPayload));
  }
  document.getElementById('help-diy-enabled').checked = normalizedPayload.enabled === true;
  document.getElementById('help-diy-home-mode').value = normalizedPayload.home.mode || 'text';
  document.getElementById('help-diy-home').value = normalizedPayload.home.text || '';
  document.getElementById('help-diy-home-image').value = normalizedPayload.home.image || '';
  document.getElementById('help-diy-ai-mode').value = normalizedPayload.categories.ai.mode || 'text';
  document.getElementById('help-diy-ai').value = normalizedPayload.categories.ai.text || '';
  document.getElementById('help-diy-ai-image').value = normalizedPayload.categories.ai.image || '';
  document.getElementById('help-diy-manage-mode').value = normalizedPayload.categories.manage.mode || 'text';
  document.getElementById('help-diy-manage').value = normalizedPayload.categories.manage.text || '';
  document.getElementById('help-diy-manage-image').value = normalizedPayload.categories.manage.image || '';
  document.getElementById('help-diy-fun-mode').value = normalizedPayload.categories.fun.mode || 'text';
  document.getElementById('help-diy-fun').value = normalizedPayload.categories.fun.text || '';
  document.getElementById('help-diy-fun-image').value = normalizedPayload.categories.fun.image || '';
  document.getElementById('help-diy-debug-mode').value = normalizedPayload.categories.debug.mode || 'text';
  document.getElementById('help-diy-debug').value = normalizedPayload.categories.debug.text || '';
  document.getElementById('help-diy-debug-image').value = normalizedPayload.categories.debug.image || '';
  document.getElementById('help-diy-status').textContent = normalizedPayload.updatedAt
    ? `上次保存：${new Date(normalizedPayload.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
    : '当前尚未保存自定义帮助内容';
  renderPreview();
  renderDirtyStatus();
}

function renderTemplates() {
  const container = document.getElementById('help-diy-template-list');
  if (!container) return;
  container.innerHTML = (helpDiyState.templates || []).map(item => `
    <div class="setting-item">
      <div class="kv-label">${item.label}</div>
      <div class="setting-help">${item.description}</div>
      <div class="actions">
        <button data-help-template="${item.key}">套用模板</button>
      </div>
    </div>
  `).join('') || '<div class="setting-item">暂无可用模板</div>';
  container.querySelectorAll('[data-help-template]').forEach(button => {
    button.addEventListener('click', () => applyTemplate(button.dataset.helpTemplate));
  });
}

function renderHistory() {
  const container = document.getElementById('help-diy-history-list');
  if (!container) return;
  const items = helpDiyState.history || [];
  if (items.length === 0) {
    container.innerHTML = '<div class="setting-item">暂无历史版本</div>';
    return;
  }
  container.innerHTML = items.map(item => {
    const savedAt = new Date(item.savedAt).toLocaleString('zh-CN', { hour12: false });
    const title = item.note || savedAt;
    return `
      <div class="setting-item">
        <div class="kv-label">${escapeHtml(title)}</div>
        <div class="setting-help">保存时间：${escapeHtml(savedAt)}</div>
        <div class="setting-help">版本 ID：${escapeHtml(item.id || '')}</div>
        <div class="actions">
          <button data-help-history="${escapeHtml(item.id || '')}">恢复此版本</button>
          <button data-help-history-delete="${escapeHtml(item.id || '')}">删除</button>
        </div>
      </div>
    `;
  }).join('');
  container.querySelectorAll('[data-help-history]').forEach(button => {
    button.addEventListener('click', () => restoreHistoryVersion(button.dataset.helpHistory));
  });
  container.querySelectorAll('[data-help-history-delete]').forEach(button => {
    button.addEventListener('click', () => deleteHistoryVersion(button.dataset.helpHistoryDelete));
  });
}

async function refresh() {
  const payload = await fetchJson('/api/help-diy');
  render(payload);
}

async function refreshTemplates() {
  const payload = await fetchJson('/api/help-diy/templates');
  helpDiyState.templates = payload.items || [];
  renderTemplates();
}

async function refreshHistory() {
  const payload = await fetchJson('/api/help-diy/history');
  helpDiyState.history = payload.items || [];
  renderHistory();
}

async function deleteHistoryVersion(historyId) {
  const ok = window.confirm('确定删除这条历史版本吗？');
  if (!ok) return;
  const result = await postJson('/api/help-diy/history/delete', { id: historyId });
  helpDiyState.history = result.items || [];
  renderHistory();
  document.getElementById('help-diy-status').textContent = '已删除历史版本。';
}

async function clearHistoryVersions() {
  const ok = window.confirm('确定清空全部历史版本吗？此操作不可撤销。');
  if (!ok) return;
  const result = await postJson('/api/help-diy/history/clear', {});
  helpDiyState.history = result.items || [];
  renderHistory();
  document.getElementById('help-diy-status').textContent = '已清空历史版本。';
}

async function save() {
  const previousPayload = helpDiyState.lastSavedPayload
    ? JSON.parse(JSON.stringify(helpDiyState.lastSavedPayload))
    : null;
  const draft = getDraft();
  const saved = await postJson('/api/help-diy/save', {
    ...draft,
    historyNote: document.getElementById('help-diy-history-note')?.value || '',
  });
  const savedPayload = saved.data || saved;
  await cleanupRemovedImages(previousPayload, savedPayload);
  render(savedPayload);
  const noteInput = document.getElementById('help-diy-history-note');
  if (noteInput) noteInput.value = '';
  refreshHistory().catch(() => {});
}

function resetToLastSaved() {
  if (!helpDiyState.lastSavedPayload) return;
  render(JSON.parse(JSON.stringify(helpDiyState.lastSavedPayload)));
  document.getElementById('help-diy-status').textContent = '已恢复到上次保存内容。';
  renderDirtyStatus('当前状态：已恢复为已保存内容');
}

function applyTemplate(templateKey) {
  const template = (helpDiyState.templates || []).find(item => item.key === templateKey);
  if (!template) return;
  render(template.payload || {}, { markAsSaved: false });
  document.getElementById('help-diy-status').textContent = `已套用模板：${template.label}，记得点击“保存帮助内容”生效。`;
  renderDirtyStatus('当前状态：模板已套用，尚未保存');
}

function restoreHistoryVersion(historyId) {
  const item = (helpDiyState.history || []).find(entry => entry.id === historyId);
  if (!item?.payload) return;
  const ok = window.confirm('确定恢复到这个历史版本吗？当前未保存修改将丢失。');
  if (!ok) return;
  render(item.payload, { markAsSaved: false });
  document.getElementById('help-diy-status').textContent = '已恢复历史版本，记得点击“保存帮助内容”生效。';
  renderDirtyStatus('当前状态：历史版本已恢复，尚未保存');
}

async function exportTemplate() {
  const response = await fetch('/api/help-diy/export', { headers: buildHeaders() });
  if (!response.ok) throw new Error(`导出失败: ${response.status}`);
  const text = await response.text();
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `crystelf-help-diy-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importTemplate(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('导入文件不是有效 JSON');
  }
  const preview = await postJson('/api/help-diy/import-preview', parsed);
  if ((preview.changedCount || 0) === 0) {
    render(preview.next || parsed);
    return;
  }
  const ok = window.confirm(`检测到 ${preview.changedCount} 项变更：\n${(preview.changes || []).join('\n')}\n\n是否继续导入并覆盖当前帮助内容？`);
  if (!ok) return;
  const saved = await postJson('/api/help-diy/save', parsed);
  render(saved.data || saved);
}

async function uploadHelpImage(slot, file) {
  if (!String(file?.type || '').startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  if (Number(file?.size || 0) > HELP_DIY_MAX_UPLOAD_BYTES) {
    throw new Error(`图片过大，最大允许 ${Math.round(HELP_DIY_MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }
  const imageInput = document.getElementById(`help-diy-${slot}-image`);
  const previousImage = String(imageInput?.value || '').trim();
  const savedImages = collectHelpDiyImages(helpDiyState.lastSavedPayload || {});
  const dataUrl = await readFileAsDataUrl(file);
  const result = await postJson('/api/help-diy/upload-image', { slot, dataUrl });
  const url = result.url || '';
  if (!url) throw new Error('上传成功但未返回图片地址');
  imageInput.value = url;
  document.getElementById(`help-diy-${slot}-mode`).value = 'image';
  if (isLocalHelpDiyImage(previousImage) && !savedImages.has(previousImage) && previousImage !== url) {
    await deleteHelpDiyImage(previousImage).catch(error => {
      console.warn('[help-diy] delete replaced image failed:', error.message);
    });
  }
  renderPreview();
  document.getElementById('help-diy-status').textContent = `已上传 ${slot} 帮助图片，记得保存帮助内容。`;
  renderDirtyStatus('当前状态：图片已上传，尚未保存');
}

async function deleteHelpDiyImage(url) {
  if (!isLocalHelpDiyImage(url)) return;
  await postJson('/api/help-diy/delete-image', { url });
}

async function cleanupRemovedImages(previousPayload, nextPayload) {
  if (!previousPayload) return;
  const previousImages = collectHelpDiyImages(previousPayload);
  const nextImages = collectHelpDiyImages(nextPayload);
  await Promise.all([...previousImages]
    .filter(url => !nextImages.has(url))
    .map(url => deleteHelpDiyImage(url).catch(error => {
      console.warn('[help-diy] delete old image failed:', error.message);
    })));
}

async function clearHelpImage(slot) {
  const imageInput = document.getElementById(`help-diy-${slot}-image`);
  const previousImage = String(imageInput.value || '').trim();
  const savedImages = collectHelpDiyImages(helpDiyState.lastSavedPayload || {});
  imageInput.value = '';
  document.getElementById(`help-diy-${slot}-mode`).value = 'text';
  if (isLocalHelpDiyImage(previousImage) && !savedImages.has(previousImage)) {
    await deleteHelpDiyImage(previousImage);
  }
  renderPreview();
  document.getElementById('help-diy-status').textContent = `已清除 ${slot} 帮助图片，记得保存帮助内容。`;
  renderDirtyStatus('当前状态：图片已清除，尚未保存');
}

function bindPreviewTabs() {
  document.querySelectorAll('[data-help-preview]').forEach(button => {
    button.addEventListener('click', () => {
      helpDiyState.activePreview = button.dataset.helpPreview;
      document.querySelectorAll('[data-help-preview]').forEach(item => item.classList.toggle('active', item === button));
      renderPreview();
    });
  });
}

function bindLivePreview() {
  document.querySelectorAll('textarea, input[type="checkbox"], input[type="text"], select').forEach(element => {
    const handler = () => {
      renderPreview();
      renderDirtyStatus();
    };
    element.addEventListener('input', handler);
    element.addEventListener('change', handler);
  });
}

function bindImageUpload() {
  document.querySelectorAll('[data-help-upload]').forEach(button => {
    button.addEventListener('click', () => {
      document.getElementById(`help-diy-${button.dataset.helpUpload}-upload`)?.click();
    });
  });
  ['home', 'ai', 'manage', 'fun', 'debug'].forEach(slot => {
    document.getElementById(`help-diy-${slot}-upload`)?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      uploadHelpImage(slot, file).catch(error => {
        document.getElementById('help-diy-status').textContent = `上传失败：${error.message}`;
      }).finally(() => {
        event.target.value = '';
      });
    });
  });
  document.querySelectorAll('[data-help-clear]').forEach(button => {
    button.addEventListener('click', () => {
      clearHelpImage(button.dataset.helpClear).catch(error => {
        document.getElementById('help-diy-status').textContent = `清除失败：${error.message}`;
      });
    });
  });
}

function bindUnsavedWarning() {
  window.addEventListener('beforeunload', event => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  document.querySelector('a.link-btn[href="/"]')?.addEventListener('click', event => {
    if (!hasUnsavedChanges()) return;
    const ok = window.confirm('当前有未保存修改，确定离开此页面吗？');
    if (!ok) {
      event.preventDefault();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('help-diy-save-btn')?.addEventListener('click', () => {
    save().catch(error => {
      document.getElementById('help-diy-status').textContent = `保存失败：${error.message}`;
    });
  });
  document.getElementById('help-diy-reset-btn')?.addEventListener('click', () => {
    if (!hasUnsavedChanges()) {
      document.getElementById('help-diy-status').textContent = '当前没有可恢复的未保存修改。';
      return;
    }
    const ok = window.confirm('确定恢复到上次保存内容吗？当前未保存修改将丢失。');
    if (!ok) return;
    resetToLastSaved();
  });
  document.getElementById('help-diy-export-btn')?.addEventListener('click', () => {
    exportTemplate().catch(error => {
      document.getElementById('help-diy-status').textContent = `导出失败：${error.message}`;
    });
  });
  document.getElementById('help-diy-import-btn')?.addEventListener('click', () => {
    document.getElementById('help-diy-import-input')?.click();
  });
  document.getElementById('help-diy-history-clear-btn')?.addEventListener('click', () => {
    clearHistoryVersions().catch(error => {
      document.getElementById('help-diy-status').textContent = `清空历史失败：${error.message}`;
    });
  });
  document.getElementById('help-diy-import-input')?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    importTemplate(file).catch(error => {
      document.getElementById('help-diy-status').textContent = `导入失败：${error.message}`;
    }).finally(() => {
      event.target.value = '';
    });
  });
  bindPreviewTabs();
  bindLivePreview();
  bindImageUpload();
  bindUnsavedWarning();
  refreshTemplates().catch(error => {
    document.getElementById('help-diy-status').textContent = `模板加载失败：${error.message}`;
  });
  refreshHistory().catch(error => {
    document.getElementById('help-diy-status').textContent = `历史版本加载失败：${error.message}`;
  });
  refresh().catch(error => {
    document.getElementById('help-diy-status').textContent = `加载失败：${error.message}`;
  });
});
