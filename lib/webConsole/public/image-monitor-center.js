const state = {
  reviewPage: 1,
  memePage: 1,
  reviewRisk: '',
  reviewIsMeme: '',
  reviewAlerted: '',
  reviewRecalled: '',
  refreshRequestId: 0,
  filterRefreshTimer: null,
};

function buildHeaders(extra = {}) {
  return { ...extra };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: buildHeaders(),
  });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return await response.json();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function renderImageMonitorThumb(url, alt) {
  if (!url) {
    return '<div class="image-monitor-thumb-placeholder">无图片</div>';
  }
  const previewUrl = `/api/image-proxy?url=${encodeURIComponent(url)}`;
  return `
    <a class="image-monitor-thumb-link" href="${url}" target="_blank" rel="noopener noreferrer">
      <img class="image-monitor-thumb" src="${previewUrl}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.image-monitor-thumb-link').outerHTML='<div class=&quot;image-monitor-thumb-placeholder&quot;>图片加载失败</div>'" />
    </a>
  `;
}

function renderImagePreview(url) {
  if (!url) {
    return '<div class="detail-box">这条记录没有可预览的图片地址。</div>';
  }
  const previewUrl = `/api/image-proxy?url=${encodeURIComponent(url)}`;
  return `
    <div class="image-preview-shell">
      <a class="image-preview-link" href="${url}" target="_blank" rel="noopener noreferrer">
        <img class="image-preview" src="${previewUrl}" alt="记录预览图" referrerpolicy="no-referrer" />
      </a>
      <div class="image-preview-actions">
        <a class="link-btn" href="${url}" target="_blank" rel="noopener noreferrer">打开原图</a>
      </div>
    </div>
  `;
}

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function setRefreshStatus(text, tone = 'neutral') {
  const box = document.getElementById('refresh-status');
  if (!box) return;
  box.className = `setting-help tone-${tone}`;
  box.textContent = text;
}

function buildImageMonitorUrl(type, query, page) {
  const params = new URLSearchParams({
    type,
    query,
    page: String(page),
  });

  if (type === 'review') {
    if (state.reviewRisk) params.set('risk', state.reviewRisk);
    if (state.reviewIsMeme) params.set('isMeme', state.reviewIsMeme);
    if (state.reviewAlerted) params.set('alerted', state.reviewAlerted);
    if (state.reviewRecalled) params.set('recalled', state.reviewRecalled);
    const groupId = getValue('image-monitor-log-group-filter');
    const userId = getValue('image-monitor-log-user-filter');
    const startAt = getValue('image-monitor-log-start-at');
    const endAt = getValue('image-monitor-log-end-at');
    if (groupId) params.set('groupId', groupId);
    if (userId) params.set('userId', userId);
    if (startAt) params.set('startAt', startAt);
    if (endAt) params.set('endAt', endAt);
  } else {
    const groupId = getValue('image-monitor-meme-group-filter');
    const userId = getValue('image-monitor-meme-user-filter');
    const startAt = getValue('image-monitor-meme-start-at');
    const endAt = getValue('image-monitor-meme-end-at');
    if (groupId) params.set('groupId', groupId);
    if (userId) params.set('userId', userId);
    if (startAt) params.set('startAt', startAt);
    if (endAt) params.set('endAt', endAt);
  }

  return `/api/logs/image-monitor?${params.toString()}`;
}

function updateFilterButtonState() {
  document.querySelectorAll('[data-review-risk]').forEach(button => {
    button.classList.toggle('active', (button.dataset.reviewRisk || '') === state.reviewRisk);
  });
  document.querySelectorAll('[data-review-is-meme]').forEach(button => {
    button.classList.toggle('active', (button.dataset.reviewIsMeme || '') === state.reviewIsMeme);
  });
  document.querySelectorAll('[data-review-alerted]').forEach(button => {
    button.classList.toggle('active', (button.dataset.reviewAlerted || '') === state.reviewAlerted);
  });
  document.querySelectorAll('[data-review-recalled]').forEach(button => {
    button.classList.toggle('active', (button.dataset.reviewRecalled || '') === state.reviewRecalled);
  });
}

function renderSummaryCards(review, meme) {
  const container = document.getElementById('image-monitor-summary-cards');
  if (!container) return;

  const reviewItems = Array.isArray(review?.items) ? review.items : [];
  const highCount = reviewItems.filter(item => String(item.riskLevel || '').toLowerCase() === 'high').length;
  const mediumCount = reviewItems.filter(item => String(item.riskLevel || '').toLowerCase() === 'medium').length;
  const lowCount = reviewItems.filter(item => String(item.riskLevel || '').toLowerCase() === 'low').length;
  const warnedCount = reviewItems.filter(item => item.alerted === true).length;
  const recalledCount = reviewItems.filter(item => item.recalled === true).length;

  const cards = [
    { label: '审核日志总数', value: formatNumber(review?.total || 0), meta: '当前筛选后的总记录数', tone: 'neutral' },
    { label: '表情包入库总数', value: formatNumber(meme?.total || 0), meta: '当前筛选后的总记录数', tone: 'success' },
    { label: '当前页高风险', value: formatNumber(highCount), meta: `中风险 ${formatNumber(mediumCount)} / 低风险 ${formatNumber(lowCount)}`, tone: highCount > 0 ? 'error' : mediumCount > 0 ? 'neutral' : 'success' },
    { label: '当前页处置情况', value: `告警 ${formatNumber(warnedCount)}`, meta: `撤回 ${formatNumber(recalledCount)}`, tone: warnedCount > 0 || recalledCount > 0 ? 'neutral' : 'success' },
  ];

  container.innerHTML = cards.map(item => `
    <div class="card ${item.tone ? `tone-${item.tone}` : ''}">
      <h3>${item.label}</h3>
      <div class="value">${item.value}</div>
      <div class="setting-help">${item.meta}</div>
    </div>
  `).join('');
}

function renderPagination(containerId, page, totalPages, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!totalPages || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('...');
  }
  for (let i = start; i <= end; i += 1) {
    pages.push(i);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  container.innerHTML = [
    `<button data-page-target="${containerId}" data-page="${Math.max(1, page - 1)}">上一页</button>`,
    ...pages.map(item => item === '...'
      ? '<span class="page-ellipsis">...</span>'
      : `<button class="${item === page ? 'active' : ''}" data-page-target="${containerId}" data-page="${item}">${item}</button>`),
    `<button data-page-target="${containerId}" data-page="${Math.min(totalPages, page + 1)}">下一页</button>`,
  ].join('');

  container.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => onPageChange(Number(button.dataset.page || 1)));
  });
}

function renderReviewLogs(data) {
  const reviewBox = document.getElementById('image-monitor-log-box');
  if (!reviewBox) return;

  reviewBox.innerHTML = (data.items || []).length > 0
    ? data.items.map(item => `
      <div class="list-item tone-${getImageMonitorRiskTone(item.riskLevel)}">
        <div class="image-monitor-card-head">
          ${renderImageMonitorThumb(item.imageUrl, '图片审核预览')}
          <div class="image-monitor-card-main">
            <h3>${formatTime(item.reviewedAt)} <small>群 ${escapeHtml(item.groupId || '暂无')} / 用户 ${escapeHtml(item.userId || '暂无')}</small></h3>
            <div class="detail-tags">
              <span class="detail-tag tone-${getImageMonitorRiskTone(item.riskLevel)}">${formatImageMonitorRisk(item.riskLevel)}</span>
              <span class="detail-tag">${formatImageMonitorAction(item.violationAction)}</span>
              <span class="detail-tag">表情包：${formatBool(item.isMeme)}</span>
              <span class="detail-tag">已告警：${formatBool(item.alerted)}</span>
              <span class="detail-tag">已撤回：${formatBool(item.recalled)}</span>
            </div>
            <div>消息 ID：${escapeHtml(item.messageId || '暂无')}</div>
            <div>标签：${escapeHtml(Array.isArray(item.memeTags) && item.memeTags.length > 0 ? item.memeTags.join(', ') : '暂无')}</div>
            <div>风险分类：${escapeHtml(Array.isArray(item.riskCategories) && item.riskCategories.length > 0 ? item.riskCategories.join(', ') : '暂无')}</div>
            <div>摘要：${escapeHtml(item.summary || item.error || '暂无')}</div>
            <div class="actions">
              <button class="mini-btn" data-preview-type="review" data-preview-id="${encodeURIComponent(item.id || item.__line || '')}">快速预览</button>
              <a class="link-btn" href="/image-monitor-detail.html?type=review&id=${encodeURIComponent(item.id || item.__line || '')}">详情页</a>
            </div>
          </div>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无图片审核日志</div>';

  renderPagination('image-monitor-log-pagination', data.page, data.totalPages, page => {
    state.reviewPage = page;
    refresh().catch(handleRefreshError);
  });
}

function renderMemeLogs(data) {
  const memeBox = document.getElementById('image-monitor-meme-box');
  if (!memeBox) return;

  memeBox.innerHTML = (data.items || []).length > 0
    ? data.items.map(item => `
      <div class="list-item tone-success">
        <div class="image-monitor-card-head">
          ${renderImageMonitorThumb(item.sourceUrl, '表情包预览')}
          <div class="image-monitor-card-main">
            <h3>${escapeHtml(item.fileName || '未命名文件')} <small>${formatTime(item.savedAt)}</small></h3>
            <div class="detail-tags">
              <span class="detail-tag tone-success">已保存表情包</span>
              <span class="detail-tag">角色 ${escapeHtml(item.character || item.folder || '未知')}</span>
              <span class="detail-tag">群 ${escapeHtml(item.groupId || '暂无')}</span>
              <span class="detail-tag">用户 ${escapeHtml(item.userId || '暂无')}</span>
            </div>
            <div>标签：${escapeHtml(Array.isArray(item.memeTags) && item.memeTags.length > 0 ? item.memeTags.join(', ') : '暂无')}</div>
            <div>摘要：${escapeHtml(item.summary || '暂无')}</div>
            <div class="actions">
              <button class="mini-btn" data-preview-type="meme" data-preview-id="${encodeURIComponent(item.id || item.__line || '')}">快速预览</button>
              <a class="link-btn" href="/image-monitor-detail.html?type=meme&id=${encodeURIComponent(item.id || item.__line || '')}">详情页</a>
            </div>
          </div>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无已保存表情包记录</div>';

  renderPagination('image-monitor-meme-pagination', data.page, data.totalPages, page => {
    state.memePage = page;
    refresh().catch(handleRefreshError);
  });
}

function closeDetailModal() {
  document.getElementById('detail-modal-mask')?.classList.add('hidden');
}

function buildDetailTags(type, data) {
  const tags = [];
  if (type === 'review') {
    tags.push({ text: formatImageMonitorRisk(data.riskLevel), tone: getImageMonitorRiskTone(data.riskLevel) });
    tags.push({ text: formatImageMonitorAction(data.violationAction) });
    tags.push({ text: `表情包：${formatBool(data.isMeme)}` });
    tags.push({ text: `已告警：${formatBool(data.alerted)}` });
    tags.push({ text: `已撤回：${formatBool(data.recalled)}` });
  } else {
    tags.push({ text: '已保存表情包', tone: 'success' });
    tags.push({ text: `角色：${data.character || data.folder || '未知'}` });
  }
  return `
    <div class="detail-tags">
      ${tags.map(tag => `<span class="detail-tag ${tag.tone ? `tone-${tag.tone}` : ''}">${escapeHtml(tag.text)}</span>`).join('')}
    </div>
  `;
}

function buildDetailKvItems(type, data) {
  const items = [
    { label: '时间', value: formatTime(data.reviewedAt || data.savedAt) },
    { label: '群号', value: data.groupId || '暂无' },
    { label: '用户', value: data.userId || '暂无' },
    { label: '消息 ID', value: data.messageId || '暂无' },
    { label: '文件名', value: data.fileName || '暂无' },
    { label: '图片地址', value: data.imageUrl || data.sourceUrl || '暂无' },
  ];
  if (type === 'review') {
    items.push(
      { label: '风险等级', value: formatImageMonitorRisk(data.riskLevel) },
      { label: '处理方式', value: formatImageMonitorAction(data.violationAction) },
      { label: '风险分类', value: Array.isArray(data.riskCategories) && data.riskCategories.length > 0 ? data.riskCategories.join(', ') : '暂无' },
      { label: '图片哈希', value: data.hash || '暂无' },
    );
  } else {
    items.push(
      { label: '角色目录', value: data.character || data.folder || '未知' },
      { label: '标签', value: Array.isArray(data.memeTags) && data.memeTags.length > 0 ? data.memeTags.join(', ') : '暂无' },
      { label: '关键词', value: Array.isArray(data.keywords) && data.keywords.length > 0 ? data.keywords.join(', ') : '暂无' },
      { label: '图片哈希', value: data.hash || '暂无' },
    );
  }
  return `
    <div class="kv-grid detail-modal-kv-grid">
      ${items.map(item => `
        <div class="kv-item">
          <div class="kv-label">${escapeHtml(item.label)}</div>
          <div class="kv-value">${escapeHtml(item.value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildDetailPreviewSections(type, data) {
  const sections = [
    { label: '摘要', value: data.summary || data.error || '暂无' },
    { label: '标签', value: Array.isArray(data.memeTags) && data.memeTags.length > 0 ? data.memeTags.join(', ') : '暂无' },
  ];
  if (type === 'review') {
    sections.push({ label: '风险分类', value: Array.isArray(data.riskCategories) && data.riskCategories.length > 0 ? data.riskCategories.join(', ') : '暂无' });
  }
  if (Array.isArray(data.keywords) && data.keywords.length > 0) {
    sections.push({ label: '关键词', value: data.keywords.join(', ') });
  }
  return sections.map(section => `
    <div class="preview-section">
      <div class="preview-head"><h3>${escapeHtml(section.label)}</h3></div>
      <pre class="preview-box">${escapeHtml(section.value)}</pre>
    </div>
  `).join('');
}

function bindDetailModalActions(type, data) {
  const copyImageBtn = document.getElementById('detail-modal-copy-image-btn');
  const copyMessageBtn = document.getElementById('detail-modal-copy-message-btn');
  const copyJsonBtn = document.getElementById('detail-modal-copy-json-btn');
  const toggleRawBtn = document.getElementById('detail-modal-toggle-raw-btn');
  const rawBox = document.getElementById('detail-modal-raw-json');

  copyImageBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(data.imageUrl || data.sourceUrl || '').catch(() => {});
  });
  copyMessageBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(data.messageId || '').catch(() => {});
  });
  copyJsonBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).catch(() => {});
  });
  toggleRawBtn?.addEventListener('click', () => {
    rawBox?.classList.toggle('hidden');
  });

  document.getElementById('detail-modal-title').textContent =
    type === 'review' ? '图片审核详情' : '表情包入库详情';
  document.getElementById('detail-modal-subtitle').textContent =
    `${formatTime(data.reviewedAt || data.savedAt)} / 群 ${data.groupId || '暂无'} / 用户 ${data.userId || '暂无'}`;
}

async function openDetailModal(type, id) {
  const mask = document.getElementById('detail-modal-mask');
  const content = document.getElementById('detail-modal-content');
  if (!mask || !content) return;

  document.getElementById('detail-modal-title').textContent = '记录详情';
  document.getElementById('detail-modal-subtitle').textContent = '正在加载...';
  content.innerHTML = '<div class="detail-box">正在加载详情...</div>';
  mask.classList.remove('hidden');

  try {
    const data = await fetchJson(`/api/logs/image-monitor/detail?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`);
    const imageUrl = data.imageUrl || data.sourceUrl || '';
    content.innerHTML = `
      <div class="detail-modal-layout">
        <div class="detail-modal-media">
          ${renderImagePreview(imageUrl)}
          ${buildDetailTags(type, data)}
          <div class="actions detail-modal-actions">
            <button id="detail-modal-copy-image-btn" class="mini-btn">复制图片地址</button>
            <button id="detail-modal-copy-message-btn" class="mini-btn">复制消息 ID</button>
            <button id="detail-modal-copy-json-btn" class="mini-btn">复制 JSON</button>
            <button id="detail-modal-toggle-raw-btn" class="mini-btn">展开原始 JSON</button>
            <a class="link-btn" href="/image-monitor-detail.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">详情页</a>
          </div>
          <pre id="detail-modal-raw-json" class="preview-box hidden">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
        </div>
        <div class="detail-modal-panels">
          ${buildDetailKvItems(type, data)}
          ${buildDetailPreviewSections(type, data)}
        </div>
      </div>
    `;
    bindDetailModalActions(type, data);
  } catch (error) {
    document.getElementById('detail-modal-title').textContent = '详情加载失败';
    document.getElementById('detail-modal-subtitle').textContent = '';
    content.innerHTML = `<div class="detail-box">${escapeHtml(error.message)}</div>`;
  }
}

function handleRefreshError(error) {
  setRefreshStatus(`刷新失败：${error.message}`, 'error');
}

function scheduleRefresh(section) {
  if (section === 'review') state.reviewPage = 1;
  if (section === 'meme') state.memePage = 1;
  clearTimeout(state.filterRefreshTimer);
  state.filterRefreshTimer = setTimeout(() => {
    refresh().catch(handleRefreshError);
  }, 180);
}

function clearAllFilters() {
  state.reviewPage = 1;
  state.memePage = 1;
  state.reviewRisk = '';
  state.reviewIsMeme = '';
  state.reviewAlerted = '';
  state.reviewRecalled = '';

  [
    'image-monitor-log-search',
    'image-monitor-log-group-filter',
    'image-monitor-log-user-filter',
    'image-monitor-log-start-at',
    'image-monitor-log-end-at',
    'image-monitor-meme-search',
    'image-monitor-meme-group-filter',
    'image-monitor-meme-user-filter',
    'image-monitor-meme-start-at',
    'image-monitor-meme-end-at',
  ].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });

  updateFilterButtonState();
  refresh().catch(handleRefreshError);
}

async function downloadExport(type, params, fileName) {
  const query = new URLSearchParams({ type, ...params });
  const response = await fetch(`/api/export?${query.toString()}`, {
    cache: 'no-store',
    headers: buildHeaders(),
  });
  if (!response.ok) {
    throw new Error(`/api/export -> ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getReviewExportParams() {
  const params = {
    query: getValue('image-monitor-log-search'),
    groupId: getValue('image-monitor-log-group-filter'),
    userId: getValue('image-monitor-log-user-filter'),
    startAt: getValue('image-monitor-log-start-at'),
    endAt: getValue('image-monitor-log-end-at'),
  };
  if (state.reviewRisk) params.risk = state.reviewRisk;
  if (state.reviewIsMeme) params.isMeme = state.reviewIsMeme;
  if (state.reviewAlerted) params.alerted = state.reviewAlerted;
  if (state.reviewRecalled) params.recalled = state.reviewRecalled;
  return params;
}

function getMemeExportParams() {
  return {
    query: getValue('image-monitor-meme-search'),
    groupId: getValue('image-monitor-meme-group-filter'),
    userId: getValue('image-monitor-meme-user-filter'),
    startAt: getValue('image-monitor-meme-start-at'),
    endAt: getValue('image-monitor-meme-end-at'),
  };
}

async function refresh() {
  const requestId = ++state.refreshRequestId;
  setRefreshStatus('正在刷新图片监控数据...', 'neutral');

  const reviewQuery = getValue('image-monitor-log-search');
  const memeQuery = getValue('image-monitor-meme-search');
  const startTime = Date.now();

  const [overview, review, meme] = await Promise.all([
    fetchJson('/api/overview'),
    fetchJson(buildImageMonitorUrl('review', reviewQuery, state.reviewPage)),
    fetchJson(buildImageMonitorUrl('meme', memeQuery, state.memePage)),
  ]);
  if (requestId !== state.refreshRequestId) return;

  document.getElementById('page-meta').textContent =
    `crystelf-plugin v${overview?.plugin?.version || '-'} / 图片监控与表情包入库记录`;

  updateFilterButtonState();
  renderSummaryCards(review, meme);
  renderReviewLogs(review);
  renderMemeLogs(meme);

  const elapsedMs = Date.now() - startTime;
  setRefreshStatus(
    `最近刷新：${formatTime(Date.now())} / ${elapsedMs} ms / 审核日志 ${formatNumber(review?.total || 0)} 条 / 入库记录 ${formatNumber(meme?.total || 0)} 条`,
    'success'
  );
}
document.getElementById('refresh-btn')?.addEventListener('click', () => {
  refresh().catch(handleRefreshError);
});

document.getElementById('refresh-image-monitor-btn')?.addEventListener('click', () => {
  refresh().catch(handleRefreshError);
});

document.getElementById('clear-all-filters-btn')?.addEventListener('click', clearAllFilters);

[
  'image-monitor-log-search',
  'image-monitor-log-group-filter',
  'image-monitor-log-user-filter',
  'image-monitor-log-start-at',
  'image-monitor-log-end-at',
].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => scheduleRefresh('review'));
});

[
  'image-monitor-meme-search',
  'image-monitor-meme-group-filter',
  'image-monitor-meme-user-filter',
  'image-monitor-meme-start-at',
  'image-monitor-meme-end-at',
].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => scheduleRefresh('meme'));
});

document.querySelectorAll('[data-review-risk]').forEach(button => {
  button.addEventListener('click', () => {
    state.reviewRisk = button.dataset.reviewRisk || '';
    state.reviewPage = 1;
    updateFilterButtonState();
    refresh().catch(handleRefreshError);
  });
});

document.querySelectorAll('[data-review-is-meme]').forEach(button => {
  button.addEventListener('click', () => {
    state.reviewIsMeme = button.dataset.reviewIsMeme || '';
    state.reviewPage = 1;
    updateFilterButtonState();
    refresh().catch(handleRefreshError);
  });
});

document.querySelectorAll('[data-review-alerted]').forEach(button => {
  button.addEventListener('click', () => {
    state.reviewAlerted = button.dataset.reviewAlerted || '';
    state.reviewPage = 1;
    updateFilterButtonState();
    refresh().catch(handleRefreshError);
  });
});

document.querySelectorAll('[data-review-recalled]').forEach(button => {
  button.addEventListener('click', () => {
    state.reviewRecalled = button.dataset.reviewRecalled || '';
    state.reviewPage = 1;
    updateFilterButtonState();
    refresh().catch(handleRefreshError);
  });
});

document.getElementById('export-review-btn')?.addEventListener('click', async () => {
  try {
    await downloadExport(
      'image-monitor-review-logs',
      getReviewExportParams(),
      `image-monitor-review-${Date.now()}.json`
    );
    setRefreshStatus('审核日志导出完成', 'success');
  } catch (error) {
    handleRefreshError(error);
  }
});

document.getElementById('export-meme-btn')?.addEventListener('click', async () => {
  try {
    await downloadExport(
      'image-monitor-meme-logs',
      getMemeExportParams(),
      `image-monitor-meme-${Date.now()}.json`
    );
    setRefreshStatus('表情包入库记录导出完成', 'success');
  } catch (error) {
    handleRefreshError(error);
  }
});

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.dataset.previewType && target.dataset.previewId) {
    openDetailModal(target.dataset.previewType, target.dataset.previewId).catch(handleRefreshError);
  }
});

document.getElementById('detail-modal-close-btn')?.addEventListener('click', closeDetailModal);
document.getElementById('detail-modal-close-top')?.addEventListener('click', closeDetailModal);
document.getElementById('detail-modal-mask')?.addEventListener('click', event => {
  if (event.target === event.currentTarget) {
    closeDetailModal();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeDetailModal();
  }
});

refresh().catch(error => {
  document.body.innerHTML = `<pre>图片监控中心加载失败：${error.message}</pre>`;
});
