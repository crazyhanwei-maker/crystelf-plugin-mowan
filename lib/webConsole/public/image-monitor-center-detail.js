function closeDetailModal() {
  document.getElementById('detail-modal-mask')?.classList.add('hidden');
}

function buildDetailTags(type, data) {
  const tags = [];
  if (type === 'review') {
    tags.push({ text: formatImageMonitorRisk(data.riskLevel), tone: getImageMonitorRiskTone(data.riskLevel) });
    tags.push({ text: formatImageMonitorAction(data.violationAction) });
    tags.push({ text: `表情包：${formatBool(data.isMeme)}` });
    tags.push({ text: formatMemeSaveStatus(data), tone: data.memeSaved === true ? 'success' : '' });
    tags.push({ text: `情绪：${data.memeEmotion || 'default'}` });
    tags.push({ text: `已告警：${formatBool(data.alerted)}` });
    tags.push({ text: `已撤回：${formatBool(data.recalled)}` });
  } else {
    tags.push({ text: '已保存表情包', tone: 'success' });
    tags.push({ text: `角色：${data.character || data.folder || '未知'}` });
    tags.push({ text: `情绪：${data.emotion || 'default'}` });
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
    { label: '预览来源', value: data.localImageAvailable ? '本地文件' : '原始 URL' },
    { label: '本地预览文件', value: data.localImagePath || data.reviewRelativePath || data.relativeDir || '暂无' },
    { label: '原始图片地址', value: data.originalImageUrl || data.imageUrl || data.sourceUrl || '暂无' },
  ];
  if (type === 'review') {
    items.push(
      { label: '风险等级', value: formatImageMonitorRisk(data.riskLevel) },
      { label: '处理方式', value: formatImageMonitorAction(data.violationAction) },
      { label: '入库状态', value: formatMemeSaveStatus(data) },
      { label: '识别角色', value: data.memeCharacter || '暂无' },
      { label: '识别情绪', value: data.memeEmotion || 'default' },
      { label: '入库文件', value: data.memeFileName || '暂无' },
      { label: '风险分类', value: Array.isArray(data.riskCategories) && data.riskCategories.length > 0 ? data.riskCategories.join(', ') : '暂无' },
      { label: '图片哈希', value: data.hash || '暂无' },
      { label: 'MD5 指纹', value: data.md5 || '暂无' },
    );
  } else {
    items.push(
      { label: '角色目录', value: data.character || data.folder || '未知' },
      { label: '情绪目录', value: data.emotion || 'default' },
      { label: '相对目录', value: data.relativeDir || '暂无' },
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
  if (Array.isArray(data.memeKeywords) && data.memeKeywords.length > 0) {
    sections.push({ label: '入库关键词', value: data.memeKeywords.join(', ') });
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
    navigator.clipboard.writeText(data.originalImageUrl || data.imageUrl || data.sourceUrl || '').catch(() => {});
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
    content.innerHTML = `
      <div class="detail-modal-layout">
        <div class="detail-modal-media">
          ${renderImagePreview(data)}
          ${buildDetailTags(type, data)}
          <div class="actions detail-modal-actions">
            <button id="detail-modal-copy-image-btn" class="mini-btn">复制图片地址</button>
            <button id="detail-modal-copy-message-btn" class="mini-btn">复制消息 ID</button>
            <button id="detail-modal-copy-json-btn" class="mini-btn">复制原始数据</button>
            <button id="detail-modal-toggle-raw-btn" class="mini-btn">展开原始数据</button>
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
