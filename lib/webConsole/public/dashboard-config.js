async function downloadExport(type, params = {}) {
  if (typeof window.CrystelfRequest?.downloadExport === 'function') {
    return window.CrystelfRequest.downloadExport(type, params);
  }
  const query = new URLSearchParams({ type, ...params });
  const response = await fetch(`/api/export?${query.toString()}`, { headers: window.CrystelfRequest?.buildHeaders?.() || {} });
  if (!response.ok) throw new Error(`导出失败: ${response.status}`);
  const text = await response.text();
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${type}-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadConfigBackup() {
  const response = await fetch('/api/config-backup', { headers: window.CrystelfRequest?.buildHeaders?.() || {} });
  if (!response.ok) throw new Error(`备份失败: ${response.status}`);
  const text = await response.text();
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `crystelf-config-backup-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function restoreConfigBackup(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('备份文件格式不正确，请选择控制台导出的备份文件。');
  }
  return await postJson('/api/config-restore', parsed);
}

async function previewRestoreConfigBackup(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('备份文件格式不正确，请选择控制台导出的备份文件。');
  }
  const preview = await postJson('/api/config-restore-preview', parsed);
  return { parsed, preview };
}
function summarizeFallbackConfigEnhanced(aiConfig) {
  const hasFallbackReply = !!String(aiConfig?.fallbackReply || '').trim();
  const hasSearchFallback = !!String(aiConfig?.fallbackSearchReply || '').trim();
  const hasTimeoutFallback = !!String(aiConfig?.fallbackTimeoutReply || '').trim();
  const hasGenericFallback = !!String(aiConfig?.fallbackGenericReply || '').trim();

  const parts = [];
  if (hasFallbackReply) parts.push('通用');
  if (hasSearchFallback) parts.push('搜索');
  if (hasTimeoutFallback) parts.push('超时');
  if (hasGenericFallback) parts.push('泛化');

  if (parts.length === 0) return '未配置';
  return `已配置（${parts.join('/')}）`;
}
function renderConfig(data) {
  const brief = {
    config: data.config,
    ai: {
      mode: data.ai?.mode,
      modelType: data.ai?.modelType,
      workingModel: data.ai?.workingModel,
      affinity: data.ai?.affinity?.enabled,
      userProfile: data.ai?.userProfile?.enabled,
      fallback: summarizeFallbackConfig(data.ai),
    },
    poke: {
      mode: data.poke?.mode,
      imageEnabled: data.poke?.imageEnabled,
      fallback: data.poke?.fallbackReply ? '已配置' : '未配置（使用内置戳一戳短句）',
    },
    coreConfig: {
      ttsEnabled: data.coreConfig?.tools?.tts?.enabled,
      searchEnabled: data.coreConfig?.tools?.search?.enabled,
      usageControl: data.coreConfig?.usageControl?.enabled,
    },
  };
  document.getElementById('config-box').textContent = JSON.stringify(brief, null, 2);
}

function summarizeFallbackConfig(aiConfig) {
  const hasFallbackReply = !!String(aiConfig?.fallbackReply || '').trim();
  const hasSearchFallback = !!String(aiConfig?.fallbackSearchReply || '').trim();
  const hasTimeoutFallback = !!String(aiConfig?.fallbackTimeoutReply || '').trim();
  const hasGenericFallback = !!String(aiConfig?.fallbackGenericReply || '').trim();

  const parts = [];
  if (hasFallbackReply) parts.push('通用');
  if (hasSearchFallback) parts.push('搜索');
  if (hasTimeoutFallback) parts.push('超时');
  if (hasGenericFallback) parts.push('泛化');

  if (parts.length === 0) return '未配置';
  return `已配置（${parts.join('/')}）`;
}

function formatConfigState(value, enabledText = '已开启', disabledText = '已关闭') {
  return {
    text: value ? enabledText : disabledText,
    tone: value ? 'tone-success' : 'tone-error',
  };
}

function formatConfigFallbackState(value) {
  return {
    text: value,
    tone: value && !String(value).includes('未配置') ? 'tone-success' : 'tone-error',
  };
}

function formatConfigDisplay(value, fallback = '未配置') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function renderConfigRows(rows) {
  return rows.map(row => {
    const state = typeof row.value === 'object' && row.value !== null
      ? row.value
      : { text: formatConfigDisplay(row.value), tone: '' };
    return `
      <div class="config-summary-row">
        <span class="config-summary-label">${escapeHtml(row.label)}</span>
        <span class="config-summary-value ${state.tone || ''}">${escapeHtml(state.text)}</span>
      </div>
    `;
  }).join('');
}

function renderConfigEnhanced(data) {
  const box = document.getElementById('config-box');
  if (!box) return;

  const editableCount = Array.isArray(data.editableFiles) ? data.editableFiles.length : 0;
  const runtimeFiles = Array.isArray(data.configFiles) ? data.configFiles.length : Object.keys(data.configFiles || {}).length;

  const aiRows = [
    { label: '运行模式', value: data.ai?.mode },
    { label: '主对话模型', value: data.ai?.modelType },
    { label: '后台工作模型', value: data.ai?.workingModel },
    { label: '好感系统', value: formatConfigState(data.ai?.affinity?.enabled) },
    { label: '用户画像', value: formatConfigState(data.ai?.userProfile?.enabled) },
    { label: '兜底回复', value: formatConfigFallbackState(summarizeFallbackConfigEnhanced(data.ai)) },
  ];

  const pokeRows = [
    { label: '回复模式', value: data.poke?.mode },
    { label: '图片总结', value: formatConfigState(data.poke?.imageEnabled) },
    {
      label: '兜底回复',
      value: formatConfigFallbackState(
        data.poke?.fallbackReply ? '已配置' : '未配置（使用内置戳一戳短句）'
      ),
    },
  ];

  const toolRows = [
    { label: 'TTS 工具', value: formatConfigState(data.coreConfig?.tools?.tts?.enabled) },
    { label: '联网搜索', value: formatConfigState(data.coreConfig?.tools?.search?.enabled) },
    { label: '用量控制', value: formatConfigState(data.coreConfig?.usageControl?.enabled) },
    { label: '每日用量上限', value: formatConfigDisplay(data.coreConfig?.usageControl?.dailyTokenLimit, '未设置') },
    { label: '可编辑配置文件', value: formatConfigDisplay(editableCount, '0') },
    { label: '已加载配置源', value: formatConfigDisplay(runtimeFiles, '0') },
  ];

  box.innerHTML = `
    <div class="config-summary-grid">
      <section class="config-summary-card">
        <h3>AI 配置</h3>
        <div class="config-summary-list">${renderConfigRows(aiRows)}</div>
      </section>
      <section class="config-summary-card">
        <h3>戳一戳配置</h3>
        <div class="config-summary-list">${renderConfigRows(pokeRows)}</div>
      </section>
      <section class="config-summary-card">
        <h3>工具与额度</h3>
        <div class="config-summary-list">${renderConfigRows(toolRows)}</div>
      </section>
    </div>
    <div class="config-summary-note">
      这里只显示最常用的运行摘要。需要查看更细的配置来源或差异时，可以进入对应设置页。
    </div>
  `;
}

summarizeFallbackConfig = summarizeFallbackConfigEnhanced;
renderConfig = renderConfigEnhanced;

function renderRestorePreviewHtml(preview) {
  if (!preview?.changedCount) {
    return '<div class="restore-preview-empty">该备份未检测到可恢复变更。</div>';
  }
  const groups = (preview.groups || []).slice(0, 12);
  return [
    `<div class="restore-preview-summary">变更项：<strong>${preview.changedCount}</strong> / 可恢复键数：<strong>${preview.restoredKeys?.length || 0}</strong>。可在下方勾选需要恢复的文件。</div>`,
    '<div class="restore-preview-actions"><button data-restore-select="all">全选</button><button data-restore-select="none">全不选</button><button data-restore-select="changed">仅变更项</button></div>',
    ...groups.map(group => `
      <details class="restore-preview-group" open>
        <summary><label class="restore-preview-check"><input type="checkbox" data-restore-file="${escapeHtml(group.file)}" checked /> ${escapeHtml(group.file)} / ${group.count} 项</label></summary>
        <div class="restore-preview-group-body">
          ${(group.items || []).slice(0, 12).map(item => `
            <div class="restore-preview-item ${item.type}">
              <div class="restore-preview-keyword">${item.type === 'added' ? '新增' : item.type === 'deleted' ? '删除' : '修改'} / ${escapeHtml(item.key)}</div>
              <div>当前值：${escapeHtml(JSON.stringify(item.current))}</div>
              <div>恢复后：${escapeHtml(JSON.stringify(item.next))}</div>
            </div>
          `).join('')}
        </div>
      </details>
    `),
  ].join('');
}

function getConfigHistoryActionLabel(action = '') {
  const value = String(action || '').trim();
  const labels = {
    config_set: '保存配置',
    config_set_multiple: '批量保存配置',
    config_history_rollback: '回滚配置',
  };
  return labels[value] || value || '配置变更';
}

function getConfigHistoryChangeTypeLabel(type = '') {
  const value = String(type || '').trim();
  if (value === 'added') return '新增';
  if (value === 'deleted') return '删除';
  if (value === 'modified') return '修改';
  return '变更';
}

function formatConfigHistoryValue(value) {
  if (value === undefined) return '未设置';
  if (value === null) return '空';
  if (typeof value === 'string') return value || '空';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderConfigHistoryChanges(changes = [], truncated = false) {
  const items = (Array.isArray(changes) ? changes : []).slice(0, 8);
  if (items.length === 0) {
    return '<div class="config-history-empty">这次保存没有可展示的字段摘要。</div>';
  }
  return `
    <div class="config-history-changes">
      ${items.map(item => `
        <div class="config-history-change ${item.sensitive ? 'is-sensitive' : ''}">
          <div class="config-history-change-key">
            <span>${escapeHtml(getConfigHistoryChangeTypeLabel(item.type))}</span>
            <strong>${escapeHtml(item.key || item.file || '配置项')}</strong>
          </div>
          <div class="config-history-change-values">
            <span>原来：${escapeHtml(formatConfigHistoryValue(item.before))}</span>
            <span>现在：${escapeHtml(formatConfigHistoryValue(item.after))}</span>
          </div>
        </div>
      `).join('')}
      ${truncated ? '<div class="config-history-more">还有更多变更项未展开显示。</div>' : ''}
    </div>
  `;
}

function renderConfigHistory(payload = {}) {
  const box = document.getElementById('config-history-box');
  if (!box) return;
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (payload.__error) {
    box.innerHTML = `<div class="setting-status tone-error">配置变更历史加载失败：${escapeHtml(payload.error || '未知错误')}</div>`;
    return;
  }
  if (items.length === 0) {
    box.innerHTML = '<div class="config-history-empty">暂时还没有配置保存记录。保存配置后，这里会显示最近变更。</div>';
    return;
  }
  box.innerHTML = items.map(item => `
    <article class="config-history-item">
      <div class="config-history-head">
        <div>
          <h3>${escapeHtml(getConfigHistoryActionLabel(item.action))}</h3>
          <div class="config-history-meta">
            <span>${escapeHtml(formatTime(item.createdAt))}</span>
            <span>${escapeHtml((item.fileKeys || []).join('、') || '未知配置')}</span>
            <span>${escapeHtml(formatNumber(item.changedCount || 0))} 项变更</span>
          </div>
        </div>
        <button class="mini-btn danger" type="button" data-config-history-rollback="${escapeHtml(item.id || '')}">回滚</button>
      </div>
      ${renderConfigHistoryChanges(item.changes, item.truncatedChanges)}
    </article>
  `).join('');
}

async function refreshConfigHistoryPanel() {
  const payload = await fetchJson('/api/config-history?limit=10');
  renderConfigHistory(payload);
  return payload;
}

async function rollbackConfigHistory(id = '') {
  const historyId = String(id || '').trim();
  if (!historyId) {
    throw new Error('缺少配置历史记录 ID。');
  }
  return await postJson('/api/config-history/rollback', { id: historyId });
}

function toggleRestoreFileSelection(mode) {
  const inputs = Array.from(document.querySelectorAll('[data-restore-file]'));
  if (mode === 'all') {
    inputs.forEach(input => {
      input.checked = true;
    });
    return;
  }
  if (mode === 'none') {
    inputs.forEach(input => {
      input.checked = false;
    });
    return;
  }
  if (mode === 'changed') {
    inputs.forEach(input => {
      input.checked = true;
    });
  }
}
