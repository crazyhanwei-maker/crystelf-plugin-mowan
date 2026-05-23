const state = {
  reviewPage: 1,
  memePage: 1,
  reviewRisk: '',
  reviewIsMeme: '',
  reviewAlerted: '',
  reviewRecalled: '',
  refreshRequestId: 0,
  refreshController: null,
};
const consoleUi = window.CrystelfUi || {};

function buildHeaders(extra = {}) {
  return { ...extra };
}

async function fetchJson(url, options = {}) {
  if (window.CrystelfRequest?.fetchJson) {
    return await window.CrystelfRequest.fetchJson(url, options);
  }
  const fetchOptions = { ...options };
  delete fetchOptions.cancelOnAbort;
  const response = await fetch(url, {
    cache: 'no-store',
    ...fetchOptions,
    headers: buildHeaders(fetchOptions.headers || {}),
  });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return await response.json();
}

async function postJson(url, body = {}) {
  if (window.CrystelfRequest?.postJson) {
    return await window.CrystelfRequest.postJson(url, body);
  }
  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `${url} -> ${response.status}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function formatTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: Number.isInteger(number) ? 0 : 2,
  }).format(number);
}

function formatBool(value) {
  return value === true ? '是' : '否';
}

function formatImageMonitorAction(action) {
  switch (String(action || '').trim().toLowerCase()) {
    case 'alert':
      return '告警';
    case 'recall':
      return '撤回';
    case 'record':
    default:
      return '记录';
  }
}

function formatImageMonitorRisk(level) {
  switch (String(level || '').trim().toLowerCase()) {
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    case 'low':
      return '低风险';
    case 'none':
    default:
      return '无风险';
  }
}

function getImageMonitorRiskTone(level) {
  switch (String(level || '').trim().toLowerCase()) {
    case 'high':
      return 'error';
    case 'medium':
      return 'neutral';
    default:
      return 'success';
  }
}

function formatMemeSaveStatus(item = {}) {
  if (item.memeSaved === true) return '已入库';
  if (item.isMeme !== true) return '未入库：非表情包';
  const reasonMap = {
    save_disabled: '未入库：保存关闭',
    unknown_character: '未入库：角色未知',
    filter_not_matched: '未入库：未命中白名单',
  };
  return reasonMap[String(item.memeSaveReason || '')] || '未入库';
}

function buildImageMonitorDisplayUrls(value) {
  const data = typeof value === 'string' ? { originalImageUrl: value } : (value || {});
  const originalImageUrl = String(data.originalImageUrl || data.imageUrl || data.sourceUrl || '').trim();
  const safeOriginalImageUrl = sanitizeUrl(originalImageUrl, { allowRelative: false });
  const safePreviewUrl = sanitizeUrl(data.previewUrl || '', { allowRelative: true });
  const safeOpenImageUrl = sanitizeUrl(data.openImageUrl || '', { allowRelative: true });
  return {
    previewUrl: safePreviewUrl || (safeOriginalImageUrl ? `/api/image-proxy?url=${encodeURIComponent(safeOriginalImageUrl)}` : ''),
    openImageUrl: safeOpenImageUrl || safeOriginalImageUrl,
    originalImageUrl,
  };
}

function renderSafeImageMonitorThumb(value, alt) {
  const urls = buildImageMonitorDisplayUrls(value);
  if (!urls.previewUrl) {
    return '<div class="image-monitor-thumb-placeholder">无图片</div>';
  }
  const openImageUrl = urls.openImageUrl || urls.previewUrl;
  return `
    <a class="image-monitor-thumb-link" href="${escapeHtml(openImageUrl)}" target="_blank" rel="noopener noreferrer">
      <img class="image-monitor-thumb" src="${escapeHtml(urls.previewUrl)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer" />
    </a>
  `;
}

function handleImageMonitorThumbError(target) {
  if (!(target instanceof HTMLImageElement) || !target.classList.contains('image-monitor-thumb')) {
    return;
  }
  const link = target.closest('.image-monitor-thumb-link');
  if (!link) {
    return;
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'image-monitor-thumb-placeholder';
  placeholder.textContent = '图片加载失败';
  link.replaceWith(placeholder);
}

function renderImagePreview(value) {
  const urls = buildImageMonitorDisplayUrls(value);
  if (!urls.previewUrl) {
    return '<div class="detail-box">这条记录没有可预览的图片地址。</div>';
  }
  const openImageUrl = urls.openImageUrl || urls.previewUrl;
  return `
    <div class="image-preview-shell">
      <a class="image-preview-link" href="${escapeHtml(openImageUrl)}" target="_blank" rel="noopener noreferrer">
        <img class="image-preview" src="${escapeHtml(urls.previewUrl)}" alt="记录预览图" referrerpolicy="no-referrer" />
      </a>
      <div class="image-preview-actions">
        <a class="link-btn" href="${escapeHtml(openImageUrl)}" target="_blank" rel="noopener noreferrer">打开图片</a>
      </div>
    </div>
  `;
}

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function normalizeImageMonitorTone(tone = 'neutral') {
  const value = String(tone || '').trim();
  return ['success', 'error', 'neutral'].includes(value) ? value : 'neutral';
}

function setRefreshStatus(text, tone = 'neutral') {
  const box = document.getElementById('refresh-status');
  if (!box) return;
  box.className = `setting-help tone-${normalizeImageMonitorTone(tone)}`;
  box.textContent = text;
}
