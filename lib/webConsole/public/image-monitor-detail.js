function getAuthToken() {
  return localStorage.getItem('crystelf-web-console-token') || '';
}

async function fetchJson(url) {
  const token = getAuthToken();
  const response = await fetch(url, {
    cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return await response.json();
}

function formatTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatImageMonitorAction(action) {
  switch (String(action || '').trim().toLowerCase()) {
    case 'alert':
      return '告警提示';
    case 'recall':
      return '自动撤回';
    case 'record':
    default:
      return '仅记录';
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setRawJson(data) {
  document.getElementById('raw-json-box').textContent = JSON.stringify(data, null, 2);
}

function renderCards(cards) {
  document.getElementById('detail-cards').innerHTML = cards.map(item => `
    <div class="card ${item.tone ? `tone-${item.tone}` : ''}">
      <h3>${item.label}</h3>
      <div class="value detail-value">${item.value}</div>
    </div>
  `).join('');
}

function renderKeyValues(items) {
  document.getElementById('detail-main').innerHTML = items.map(item => `
    <div class="kv-item">
      <div class="kv-head">
        <div class="kv-label">${item.label}</div>
      </div>
      <div class="kv-value">${item.value}</div>
    </div>
  `).join('');
}

function renderPreviewSections(items) {
  document.getElementById('detail-preview').innerHTML = items.map(item => `
    <div class="preview-section">
      <div class="preview-head"><h3>${item.label}</h3></div>
      <pre class="preview-box">${escapeHtml(item.value || '无')}</pre>
    </div>
  `).join('');
}

function renderDetailActions(items) {
  document.getElementById('detail-actions').innerHTML = items.map(item => item.href
    ? `<a class="link-btn" href="${item.href}">${item.label}</a>`
    : `<button data-copy-value="${escapeHtml(item.copyValue || '')}">${item.label}</button>`
  ).join('');
  document.getElementById('detail-actions-panel').innerHTML = items.map(item => item.href
    ? `<a class="link-btn" target="_blank" rel="noopener noreferrer" href="${item.href}">${item.label}</a>`
    : `<button data-copy-value="${escapeHtml(item.copyValue || '')}">${item.label}</button>`
  ).join(' ');
}

function renderImagePreview(imageUrl) {
  const box = document.getElementById('detail-image-preview');
  if (!imageUrl) {
    box.innerHTML = '<div class="detail-placeholder">这条记录没有可预览的图片地址</div>';
    return;
  }
  const previewUrl = `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  box.innerHTML = `
    <div class="image-preview-shell">
      <a class="image-preview-link" href="${imageUrl}" target="_blank" rel="noopener noreferrer">
        <img id="detail-image" class="image-preview" src="${previewUrl}" alt="图片监控预览" referrerpolicy="no-referrer" />
      </a>
      <div class="image-preview-actions">
        <a class="link-btn" href="${imageUrl}" target="_blank" rel="noopener noreferrer">打开原图</a>
      </div>
    </div>
  `;
  const img = document.getElementById('detail-image');
  img?.addEventListener('error', () => {
    box.innerHTML = `
      <div class="detail-placeholder">
        图片预览加载失败，可能原图已失效或外链已过期。<br />
        <a class="link-btn" href="${imageUrl}" target="_blank" rel="noopener noreferrer">尝试直接打开原图</a>
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
  }, { once: true });
}

async function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || '';
  const type = params.get('type') || 'review';
  const data = await fetchJson(`/api/logs/image-monitor/detail?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`);
  document.getElementById('detail-meta').textContent = `${type === 'meme' ? '表情包入库记录' : '图片监控审核记录'} · ${formatTime(data.reviewedAt || data.savedAt)}`;
  renderCards([
    { label: '记录类型', value: type === 'meme' ? '表情包入库' : '图片审核' },
    { label: '风险等级', value: formatImageMonitorRisk(data.riskLevel), tone: data.riskLevel === 'high' ? 'error' : data.riskLevel === 'medium' ? 'neutral' : 'success' },
    { label: '表情包判定', value: data.isMeme ? '是' : '否' },
    { label: '处理方式', value: formatImageMonitorAction(data.violationAction) },
    { label: '是否告警', value: data.alerted ? '是' : '否' },
    { label: '是否撤回', value: data.recalled ? '是' : '否' },
  ]);
  renderDetailActions([
    { label: '复制图片地址', copyValue: data.imageUrl || data.sourceUrl || '' },
    { label: '复制消息 ID', copyValue: data.messageId || '' },
    { label: '复制图片哈希', copyValue: data.hash || '' },
    { label: '打开原图', href: data.imageUrl || data.sourceUrl || '' },
  ]);
  renderImagePreview(data.imageUrl || data.sourceUrl || '');
  renderKeyValues([
    { label: '时间', value: formatTime(data.reviewedAt || data.savedAt) },
    { label: '群号', value: data.groupId || '无' },
    { label: '用户', value: data.userId || '无' },
    { label: '角色目录', value: data.character || data.folder || '未知' },
    { label: '消息 ID', value: data.messageId || '无' },
    { label: '风险等级', value: formatImageMonitorRisk(data.riskLevel) },
    { label: '处理方式', value: formatImageMonitorAction(data.violationAction) },
    { label: '是否告警', value: data.alerted ? '是' : '否' },
    { label: '是否撤回', value: data.recalled ? '是' : '否' },
    { label: '文件名', value: data.fileName || '无' },
    { label: '图片哈希', value: data.hash || '无' },
    { label: '图片地址', value: data.imageUrl || data.sourceUrl || '无' },
  ]);
  renderPreviewSections([
    { label: '标签', value: Array.isArray(data.memeTags) ? data.memeTags.join('、') : '无' },
    { label: '文件名关键词', value: Array.isArray(data.keywords) && data.keywords.length > 0 ? data.keywords.join('、') : '无' },
    { label: '风险分类', value: Array.isArray(data.riskCategories) ? data.riskCategories.join('、') : '无' },
    { label: '摘要', value: data.summary || data.error || '无' },
  ]);
  setRawJson(data);
  bindCommonActions();
}

init().catch(error => {
  document.body.innerHTML = `<pre>图片监控详情加载失败: ${error.message}</pre>`;
});
