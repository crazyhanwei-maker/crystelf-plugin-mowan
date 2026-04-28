async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return await response.json();
}

function formatTime(value) {
  if (!value) return '\u672a\u77e5';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatImageMonitorAction(action) {
  switch (String(action || '').trim().toLowerCase()) {
    case 'alert':
      return '\u544a\u8b66\u63d0\u793a';
    case 'recall':
      return '\u81ea\u52a8\u64a4\u56de';
    case 'record':
    default:
      return '\u4ec5\u8bb0\u5f55';
  }
}

function formatImageMonitorRisk(level) {
  switch (String(level || '').trim().toLowerCase()) {
    case 'high':
      return '\u9ad8\u98ce\u9669';
    case 'medium':
      return '\u4e2d\u98ce\u9669';
    case 'low':
      return '\u4f4e\u98ce\u9669';
    case 'none':
    default:
      return '\u65e0\u98ce\u9669';
  }
}

function formatMemeSaveStatus(data = {}) {
  if (data.memeSaved === true) return '\u5df2\u5165\u5e93';
  if (data.isMeme !== true) return '\u672a\u5165\u5e93\uff1a\u975e\u8868\u60c5\u5305';
  const reasonMap = {
    save_disabled: '\u672a\u5165\u5e93\uff1a\u4fdd\u5b58\u5173\u95ed',
    unknown_character: '\u672a\u5165\u5e93\uff1a\u89d2\u8272\u672a\u77e5',
    filter_not_matched: '\u672a\u5165\u5e93\uff1a\u672a\u547d\u4e2d\u767d\u540d\u5355',
  };
  return reasonMap[String(data.memeSaveReason || '')] || '\u672a\u5165\u5e93';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeUrl(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const allowRelative = options.allowRelative !== false;

  try {
    if (allowRelative && /^\/(?!\/)/.test(raw)) {
      const parsed = new URL(raw, window.location.origin);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    if (!/^https?:\/\//i.test(raw)) {
      return '';
    }

    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function setRawJson(data) {
  document.getElementById('raw-json-box').textContent = JSON.stringify(data, null, 2);
}

function renderFatalError(message) {
  const pre = document.createElement('pre');
  pre.textContent = `\u56fe\u7247\u76d1\u63a7\u8be6\u60c5\u52a0\u8f7d\u5931\u8d25: ${message}`;
  document.body.replaceChildren(pre);
}

function renderCards(cards) {
  document.getElementById('detail-cards').innerHTML = cards.map(item => `
    <div class="card ${item.tone ? `tone-${item.tone}` : ''}">
      <h3>${escapeHtml(item.label)}</h3>
      <div class="value detail-value">${escapeHtml(item.value)}</div>
    </div>
  `).join('');
}

function renderKeyValues(items) {
  document.getElementById('detail-main').innerHTML = items.map(item => `
    <div class="kv-item">
      <div class="kv-head">
        <div class="kv-label">${escapeHtml(item.label)}</div>
      </div>
      <div class="kv-value">${escapeHtml(item.value)}</div>
    </div>
  `).join('');
}

function renderPreviewSections(items) {
  document.getElementById('detail-preview').innerHTML = items.map(item => `
    <div class="preview-section">
      <div class="preview-head"><h3>${escapeHtml(item.label)}</h3></div>
      <pre class="preview-box">${escapeHtml(item.value || '\u65e0')}</pre>
    </div>
  `).join('');
}

function renderActionItem(item, options = {}) {
  const label = escapeHtml(item.label);
  const href = sanitizeUrl(item.href, { allowRelative: true });

  if (href) {
    const externalAttrs = options.newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a class="link-btn" href="${escapeHtml(href)}"${externalAttrs}>${label}</a>`;
  }

  return `<button data-copy-value="${escapeHtml(item.copyValue || '')}">${label}</button>`;
}

function renderDetailActions(items) {
  document.getElementById('detail-actions').innerHTML = items.map(item => renderActionItem(item)).join('');
  document.getElementById('detail-actions-panel').innerHTML = items.map(item => renderActionItem(item, { newTab: true })).join(' ');
}

function buildImageMonitorDisplayUrls(value) {
  const data = typeof value === 'string' ? { originalImageUrl: value } : (value || {});
  const originalImageUrl = String(data.originalImageUrl || data.imageUrl || data.sourceUrl || '').trim();
  const safeOriginalImageUrl = sanitizeUrl(originalImageUrl, { allowRelative: false });
  const safePreviewUrl = sanitizeUrl(data.previewUrl || '', { allowRelative: true });
  const safeOpenImageUrl = sanitizeUrl(data.openImageUrl || '', { allowRelative: true });
  return {
    originalImageUrl,
    previewUrl: safePreviewUrl || (safeOriginalImageUrl ? `/api/image-proxy?url=${encodeURIComponent(safeOriginalImageUrl)}` : ''),
    openImageUrl: safeOpenImageUrl || safeOriginalImageUrl,
  };
}

function renderImagePreview(value) {
  const box = document.getElementById('detail-image-preview');
  const urls = buildImageMonitorDisplayUrls(value);

  if (!urls.previewUrl) {
    box.innerHTML = '<div class="detail-placeholder">\u8fd9\u6761\u8bb0\u5f55\u6ca1\u6709\u53ef\u9884\u89c8\u7684\u56fe\u7247\u5730\u5740</div>';
    return;
  }

  const openImageUrl = urls.openImageUrl || urls.previewUrl;
  box.innerHTML = `
    <div class="image-preview-shell">
      <a class="image-preview-link" href="${escapeHtml(openImageUrl)}" target="_blank" rel="noopener noreferrer">
        <img id="detail-image" class="image-preview" src="${escapeHtml(urls.previewUrl)}" alt="\u56fe\u7247\u76d1\u63a7\u9884\u89c8" referrerpolicy="no-referrer" />
      </a>
      <div class="image-preview-actions">
        <a class="link-btn" href="${escapeHtml(openImageUrl)}" target="_blank" rel="noopener noreferrer">\u6253\u5f00\u56fe\u7247</a>
      </div>
    </div>
  `;

  const img = document.getElementById('detail-image');
  img?.addEventListener('error', () => {
    box.innerHTML = `
      <div class="detail-placeholder">
        \u56fe\u7247\u9884\u89c8\u52a0\u8f7d\u5931\u8d25\uff0c\u672c\u5730\u6587\u4ef6\u53ef\u80fd\u4e0d\u5b58\u5728\uff0c\u6216\u5916\u94fe\u5df2\u8fc7\u671f\u3002<br />
        <a class="link-btn" href="${escapeHtml(openImageUrl)}" target="_blank" rel="noopener noreferrer">\u5c1d\u8bd5\u6253\u5f00\u56fe\u7247</a>
      </div>
    `;
  }, { once: true });
}

function bindCommonActions() {
  document.getElementById('toggle-raw-btn').addEventListener('click', () => {
    document.getElementById('raw-json-box').classList.toggle('hidden');
  });

  document.getElementById('copy-json-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('raw-json-box').textContent).catch(() => {});
  });

  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.copyValue !== undefined) {
      navigator.clipboard.writeText(target.dataset.copyValue).catch(() => {});
    }
  });
}

async function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || '';
  const type = params.get('type') || 'review';
  const data = await fetchJson(`/api/logs/image-monitor/detail?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`);
  const displayUrls = buildImageMonitorDisplayUrls(data);
  const originalImageUrl = data.originalImageUrl || data.imageUrl || data.sourceUrl || '';

  document.getElementById('detail-meta').textContent = `${type === 'meme' ? '\u8868\u60c5\u5305\u5165\u5e93\u8bb0\u5f55' : '\u56fe\u7247\u76d1\u63a7\u5ba1\u6838\u8bb0\u5f55'} \u00b7 ${formatTime(data.reviewedAt || data.savedAt)}`;

  renderCards([
    { label: '\u8bb0\u5f55\u7c7b\u578b', value: type === 'meme' ? '\u8868\u60c5\u5305\u5165\u5e93' : '\u56fe\u7247\u5ba1\u6838' },
    { label: '\u98ce\u9669\u7b49\u7ea7', value: formatImageMonitorRisk(data.riskLevel), tone: data.riskLevel === 'high' ? 'error' : data.riskLevel === 'medium' ? 'neutral' : 'success' },
    { label: '\u8868\u60c5\u5305\u5224\u5b9a', value: data.isMeme ? '\u662f' : '\u5426' },
    { label: '\u5165\u5e93\u72b6\u6001', value: formatMemeSaveStatus(data), tone: data.memeSaved === true ? 'success' : 'neutral' },
    { label: '\u8868\u60c5\u60c5\u7eea', value: data.memeEmotion || data.emotion || 'default' },
    { label: '\u5904\u7406\u65b9\u5f0f', value: formatImageMonitorAction(data.violationAction) },
    { label: '\u662f\u5426\u544a\u8b66', value: data.alerted ? '\u662f' : '\u5426' },
    { label: '\u662f\u5426\u64a4\u56de', value: data.recalled ? '\u662f' : '\u5426' },
  ]);

  renderDetailActions([
    { label: '\u590d\u5236\u56fe\u7247\u5730\u5740', copyValue: originalImageUrl },
    { label: '\u590d\u5236\u6d88\u606f ID', copyValue: data.messageId || '' },
    { label: '\u590d\u5236\u56fe\u7247\u54c8\u5e0c', copyValue: data.hash || '' },
    { label: '\u6253\u5f00\u56fe\u7247', href: displayUrls.openImageUrl || displayUrls.previewUrl },
  ]);

  renderImagePreview(data);

  renderKeyValues([
    { label: '\u65f6\u95f4', value: formatTime(data.reviewedAt || data.savedAt) },
    { label: '\u7fa4\u53f7', value: data.groupId || '\u65e0' },
    { label: '\u7528\u6237', value: data.userId || '\u65e0' },
    { label: '\u89d2\u8272\u76ee\u5f55', value: data.character || data.folder || '\u672a\u77e5' },
    { label: '\u8bc6\u522b\u89d2\u8272', value: data.memeCharacter || '\u65e0' },
    { label: '\u60c5\u7eea\u76ee\u5f55', value: data.emotion || data.memeEmotion || 'default' },
    { label: '\u76f8\u5bf9\u76ee\u5f55', value: data.relativeDir || '\u65e0' },
    { label: '\u6d88\u606f ID', value: data.messageId || '\u65e0' },
    { label: '\u98ce\u9669\u7b49\u7ea7', value: formatImageMonitorRisk(data.riskLevel) },
    { label: '\u5904\u7406\u65b9\u5f0f', value: formatImageMonitorAction(data.violationAction) },
    { label: '\u5165\u5e93\u72b6\u6001', value: formatMemeSaveStatus(data) },
    { label: '\u662f\u5426\u544a\u8b66', value: data.alerted ? '\u662f' : '\u5426' },
    { label: '\u662f\u5426\u64a4\u56de', value: data.recalled ? '\u662f' : '\u5426' },
    { label: '\u6587\u4ef6\u540d', value: data.fileName || '\u65e0' },
    { label: '\u5165\u5e93\u6587\u4ef6', value: data.memeFileName || '\u65e0' },
    { label: '\u56fe\u7247\u54c8\u5e0c', value: data.hash || '\u65e0' },
    { label: '\u56fe\u7247\u5730\u5740', value: data.imageUrl || data.sourceUrl || '\u65e0' },
  ]);

  renderPreviewSections([
    { label: '\u6807\u7b7e', value: Array.isArray(data.memeTags) ? data.memeTags.join('\u3001') : '\u65e0' },
    { label: '\u5165\u5e93\u5173\u952e\u8bcd', value: Array.isArray(data.memeKeywords) && data.memeKeywords.length > 0 ? data.memeKeywords.join('\u3001') : '\u65e0' },
    { label: '\u6587\u4ef6\u540d\u5173\u952e\u8bcd', value: Array.isArray(data.keywords) && data.keywords.length > 0 ? data.keywords.join('\u3001') : '\u65e0' },
    { label: '\u98ce\u9669\u5206\u7c7b', value: Array.isArray(data.riskCategories) ? data.riskCategories.join('\u3001') : '\u65e0' },
    { label: '\u6458\u8981', value: data.summary || data.error || '\u65e0' },
  ]);

  setRawJson(data);
  bindCommonActions();
}

init().catch(error => {
  renderFatalError(error?.message || String(error));
});
