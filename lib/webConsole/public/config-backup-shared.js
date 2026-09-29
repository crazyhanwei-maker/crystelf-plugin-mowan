// 配置备份/恢复共享逻辑：首页与系统设置页共用。
// 同时挂到 window 全局函数名上，dashboard-events.js 沿用旧调用方式无需改动。
(function () {
  function escapeHtml(value) {
    const text = String(value ?? '');
    if (window.CrystelfUi?.escapeHtml) {
      return window.CrystelfUi.escapeHtml(text);
    }
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function postJson(url, payload = {}) {
    if (window.CrystelfRequest?.postJson) {
      return window.CrystelfRequest.postJson(url, payload);
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload || {}),
    }).then(async response => {
      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }
      return response.json();
    });
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

  function renderRestorePreviewHtml(preview) {
    if (!preview?.changedCount) {
      return '<div class="restore-preview-empty">该备份未检测到可恢复变更。</div>';
    }
    const groups = (preview.groups || []).slice(0, 12);
    return [
      `<div class="restore-preview-summary">变更项：<strong>${preview.changedCount}</strong> / 可恢复键数：<strong>${preview.restoredKeys?.length || 0}</strong>。可在下方勾选需要恢复的文件。</div>`,
      '<div class="restore-preview-actions"><button type="button" data-restore-select="all">全选</button><button type="button" data-restore-select="none">全不选</button></div>',
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

  window.CrystelfConfigBackup = { downloadConfigBackup, previewRestoreConfigBackup, renderRestorePreviewHtml, postJson };
  // 旧全局函数名：dashboard-events.js 仍以裸函数形式调用
  window.downloadConfigBackup = downloadConfigBackup;
  window.previewRestoreConfigBackup = previewRestoreConfigBackup;
  window.renderRestorePreviewHtml = renderRestorePreviewHtml;
})();
