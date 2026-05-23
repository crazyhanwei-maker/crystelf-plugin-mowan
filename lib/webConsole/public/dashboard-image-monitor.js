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

function buildImageMonitorDisplayUrls(value) {
  const data = typeof value === 'string' ? { originalImageUrl: value } : (value || {});
  const originalImageUrl = String(data.originalImageUrl || data.imageUrl || data.sourceUrl || '').trim();
  const safeOriginalImageUrl = sanitizeUrl(originalImageUrl, { allowRelative: false });
  const safePreviewUrl = sanitizeUrl(data.previewUrl || '', { allowRelative: true });
  const safeOpenImageUrl = sanitizeUrl(data.openImageUrl || '', { allowRelative: true });
  return {
    previewUrl: safePreviewUrl || (safeOriginalImageUrl ? `/api/image-proxy?url=${encodeURIComponent(safeOriginalImageUrl)}` : ''),
    openImageUrl: safeOpenImageUrl || safeOriginalImageUrl,
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

function renderImageMonitorLogs(data) {
  const reviewBox = document.getElementById('image-monitor-log-box');
  const memeBox = document.getElementById('image-monitor-meme-box');
  if (!reviewBox || !memeBox) return;

  reviewBox.innerHTML = (data.review?.items || []).length > 0
    ? data.review.items.map(item => `
      <div class="list-item tone-${getImageMonitorRiskTone(item.riskLevel)}">
        <div class="image-monitor-card-head">
          ${renderSafeImageMonitorThumb(item, '图片审核预览')}
          <div class="image-monitor-card-main">
            <h3>${escapeHtml(formatTime(item.reviewedAt))} <small>群 ${escapeHtml(item.groupId || '暂无')} / 用户 ${escapeHtml(item.userId || '暂无')}</small></h3>
            <div class="detail-tags">
              <span class="detail-tag tone-${getImageMonitorRiskTone(item.riskLevel)}">${escapeHtml(formatImageMonitorRisk(item.riskLevel))}</span>
              <span class="detail-tag">${escapeHtml(formatImageMonitorAction(item.violationAction))}</span>
              <span class="detail-tag">表情包：${item.isMeme ? '是' : '否'}</span>
              <span class="detail-tag">已告警：${item.alerted ? '是' : '否'}</span>
              <span class="detail-tag">已撤回：${item.recalled ? '是' : '否'}</span>
            </div>
            <div>消息 ID：${escapeHtml(item.messageId || '暂无')}</div>
            <div>标签：${escapeHtml(Array.isArray(item.memeTags) && item.memeTags.length > 0 ? item.memeTags.join(', ') : '暂无')}</div>
            <div>风险分类：${escapeHtml(Array.isArray(item.riskCategories) && item.riskCategories.length > 0 ? item.riskCategories.join(', ') : '暂无')}</div>
            <div>摘要：${escapeHtml(item.summary || item.error || '暂无')}</div>
            <div class="actions">
              <a class="link-btn" href="/image-monitor-detail.html?type=review&id=${encodeURIComponent(item.id || item.__line || '')}">详情</a>
            </div>
          </div>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无图片审核日志</div>';

  memeBox.innerHTML = (data.meme?.items || []).length > 0
    ? data.meme.items.map(item => `
      <div class="list-item tone-success">
        <div class="image-monitor-card-head">
          ${renderSafeImageMonitorThumb(item, '表情包预览')}
          <div class="image-monitor-card-main">
            <h3>${escapeHtml(item.fileName || '未命名文件')} <small>${escapeHtml(formatTime(item.savedAt))}</small></h3>
            <div class="detail-tags">
              <span class="detail-tag tone-success">已保存表情包</span>
              <span class="detail-tag">角色 ${escapeHtml(item.character || item.folder || '未知')}</span>
              <span class="detail-tag">群 ${escapeHtml(item.groupId || '暂无')}</span>
              <span class="detail-tag">用户 ${escapeHtml(item.userId || '暂无')}</span>
            </div>
            <div>标签：${escapeHtml(Array.isArray(item.memeTags) && item.memeTags.length > 0 ? item.memeTags.join(', ') : '暂无')}</div>
            <div>摘要：${escapeHtml(item.summary || '暂无')}</div>
            <div class="actions">
              <a class="link-btn" href="/image-monitor-detail.html?type=meme&id=${encodeURIComponent(item.id || item.__line || '')}">详情</a>
            </div>
          </div>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无已保存表情包记录</div>';

  renderPagination('image-monitor-log-pagination', data.review?.page, data.review?.totalPages, page => {
    state.imageMonitorLogPage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
  renderPagination('image-monitor-meme-pagination', data.meme?.page, data.meme?.totalPages, page => {
    state.imageMonitorMemePage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
}
