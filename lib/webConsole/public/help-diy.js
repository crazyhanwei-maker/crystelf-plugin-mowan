const helpDiyState = {
  payload: null,
  activePreview: 'home',
  templates: [],
  lastSavedPayload: null,
  history: [],
};

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
  return {
    enabled: payload.enabled === true,
    home: {
      mode: payload.home?.mode || 'text',
      text: payload.home?.text || '',
      image: payload.home?.image || '',
    },
    categories: {
      ai: {
        mode: payload.categories?.ai?.mode || 'text',
        text: payload.categories?.ai?.text || '',
        image: payload.categories?.ai?.image || '',
      },
      manage: {
        mode: payload.categories?.manage?.mode || 'text',
        text: payload.categories?.manage?.text || '',
        image: payload.categories?.manage?.image || '',
      },
      fun: {
        mode: payload.categories?.fun?.mode || 'text',
        text: payload.categories?.fun?.text || '',
        image: payload.categories?.fun?.image || '',
      },
      debug: {
        mode: payload.categories?.debug?.mode || 'text',
        text: payload.categories?.debug?.text || '',
        image: payload.categories?.debug?.image || '',
      },
    },
  };
}

function normalizeForCompare(payload = {}) {
  return JSON.stringify(sanitizeComparablePayload(payload));
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

function renderPreview() {
  const draft = getDraft();
  const mapping = {
    home: draft.home,
    ai: draft.categories.ai,
    manage: draft.categories.manage,
    fun: draft.categories.fun,
    debug: draft.categories.debug,
  };
  const current = mapping[helpDiyState.activePreview] || { mode: 'text', text: '', image: '' };
  const textPreview = document.getElementById('help-diy-preview');
  const imageWrap = document.getElementById('help-diy-image-preview-wrap');
  const imagePreview = document.getElementById('help-diy-image-preview');

  if (current.mode === 'image') {
    textPreview.textContent = `图片发送\n${current.image || '未填写图片地址'}`;
    if (current.image) {
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
  helpDiyState.payload = payload;
  if (markAsSaved) {
    helpDiyState.lastSavedPayload = JSON.parse(JSON.stringify(payload));
  }
  document.getElementById('help-diy-enabled').checked = payload.enabled === true;
  document.getElementById('help-diy-home-mode').value = payload.home?.mode || 'text';
  document.getElementById('help-diy-home').value = payload.home?.text || '';
  document.getElementById('help-diy-home-image').value = payload.home?.image || '';
  document.getElementById('help-diy-ai-mode').value = payload.categories?.ai?.mode || 'text';
  document.getElementById('help-diy-ai').value = payload.categories?.ai?.text || '';
  document.getElementById('help-diy-ai-image').value = payload.categories?.ai?.image || '';
  document.getElementById('help-diy-manage-mode').value = payload.categories?.manage?.mode || 'text';
  document.getElementById('help-diy-manage').value = payload.categories?.manage?.text || '';
  document.getElementById('help-diy-manage-image').value = payload.categories?.manage?.image || '';
  document.getElementById('help-diy-fun-mode').value = payload.categories?.fun?.mode || 'text';
  document.getElementById('help-diy-fun').value = payload.categories?.fun?.text || '';
  document.getElementById('help-diy-fun-image').value = payload.categories?.fun?.image || '';
  document.getElementById('help-diy-debug-mode').value = payload.categories?.debug?.mode || 'text';
  document.getElementById('help-diy-debug').value = payload.categories?.debug?.text || '';
  document.getElementById('help-diy-debug-image').value = payload.categories?.debug?.image || '';
  document.getElementById('help-diy-status').textContent = payload.updatedAt
    ? `上次保存：${new Date(payload.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
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
  container.innerHTML = (helpDiyState.history || []).map(item => `
    <div class="setting-item">
      <div class="kv-label">${item.note || new Date(item.savedAt).toLocaleString('zh-CN', { hour12: false })}</div>
      <div class="setting-help">保存时间：${new Date(item.savedAt).toLocaleString('zh-CN', { hour12: false })}</div>
      <div class="setting-help">版本 ID：${item.id}</div>
      <div class="actions">
        <button data-help-history="${item.id}">恢复此版本</button>
        <button data-help-history-delete="${item.id}">删除</button>
      </div>
    </div>
  `).join('') || '<div class="setting-item">暂无历史版本</div>';
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
  const saved = await postJson('/api/help-diy/save', {
    ...getDraft(),
    historyNote: document.getElementById('help-diy-history-note')?.value || '',
  });
  render(saved.data || saved);
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
  const dataUrl = await readFileAsDataUrl(file);
  const result = await postJson('/api/help-diy/upload-image', { slot, dataUrl });
  const url = result.url || '';
  if (!url) throw new Error('上传成功但未返回图片地址');
  document.getElementById(`help-diy-${slot}-image`).value = url;
  document.getElementById(`help-diy-${slot}-mode`).value = 'image';
  renderPreview();
  document.getElementById('help-diy-status').textContent = `已上传 ${slot} 帮助图片，记得保存帮助内容。`;
  renderDirtyStatus('当前状态：图片已上传，尚未保存');
}

async function clearHelpImage(slot) {
  const imageInput = document.getElementById(`help-diy-${slot}-image`);
  imageInput.value = '';
  document.getElementById(`help-diy-${slot}-mode`).value = 'text';
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
