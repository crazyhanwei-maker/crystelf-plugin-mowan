// 更新日志页：读取 /api/update-log（GIT.md 更新记录章节），artd 时间线风格渲染
(function () {
  'use strict';

  function escapeHtml(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 从条目前缀识别变更类型（新增：xxx / 修复：xxx ...）
  function detectChangeType(item) {
    const match = String(item).match(/^(新增|修复|优化|调整|重构|移除|安全|性能|官网)[:：]/);
    if (!match) return { type: '', text: item };
    const labels = {
      新增: '新增',
      修复: '修复',
      优化: '优化',
      调整: '调整',
      重构: '重构',
      移除: '移除',
      安全: '安全',
      性能: '性能',
      官网: '官网',
    };
    return { type: labels[match[1]] || '', text: String(item).slice(match[0].length).trim() };
  }

  function renderTimeline(versions, currentVersion) {
    const box = document.getElementById('update-log-timeline');
    if (!box) return;
    if (!versions.length) {
      box.innerHTML = '<div class="setting-status">暂无更新记录。GIT.md 中未找到更新记录章节。</div>';
      return;
    }
    box.innerHTML = versions.map((version, index) => {
      const isLatest = version.version === currentVersion || (index === 0 && !currentVersion);
      const items = (version.items || []).map(raw => {
        const { type, text } = detectChangeType(raw);
        const chip = type ? `<span class="update-log-chip update-log-chip-${encodeURIComponent(type)}">${escapeHtml(type)}</span>` : '';
        return `<div class="update-log-item">${chip}<span>${escapeHtml(text || raw)}</span></div>`;
      }).join('');
      return `
        <div class="update-log-version${isLatest ? ' is-latest' : ''}">
          <div class="update-log-version-node"><span class="update-log-version-dot"></span></div>
          <div class="update-log-version-body">
            <div class="update-log-version-head">
              <strong>v${escapeHtml(version.version)}</strong>
              ${isLatest ? '<span class="update-log-current-tag">当前版本</span>' : ''}
            </div>
            <div class="update-log-items">${items}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function load() {
    const box = document.getElementById('update-log-timeline');
    try {
      const data = await fetch('/api/update-log', { cache: 'no-store' }).then(r => r.json());
      if (!data?.success) throw new Error(data?.error || '加载失败');
      const tag = document.getElementById('update-log-version-tag');
      if (tag) tag.textContent = `当前版本 v${data.currentVersion || '?'}`;
      renderTimeline(data.versions || [], data.currentVersion || '');
    } catch (error) {
      if (box) box.innerHTML = `<div class="setting-status tone-error">更新日志加载失败：${escapeHtml(error.message || error)}</div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
