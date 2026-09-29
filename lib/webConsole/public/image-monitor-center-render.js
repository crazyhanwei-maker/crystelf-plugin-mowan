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

function renderPagination(containerId, page, totalPages, onPageChange, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!totalPages || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const pages = [];
  const start = Math.max(1, current - 2);
  const end = Math.min(totalPages, current + 2);
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

  // ART DESIGN PRO（Element Plus）风格：共 X 条 + ‹ 页码 › + 前往跳页
  const totalText = options.total != null
    ? `<span class="artd-pagination-total">共 ${Number(options.total).toLocaleString('zh-CN')} 条</span>`
    : '';
  const parts = [
    `<button class="artd-page-btn" data-page="prev" ${current <= 1 ? 'disabled' : ''} aria-label="上一页">‹</button>`,
    ...pages.map(item => item === '...'
      ? '<span class="artd-page-ellipsis">···</span>'
      : `<button class="artd-page-btn${item === current ? ' is-active' : ''}" data-page="${item}">${item}</button>`),
    `<button class="artd-page-btn" data-page="next" ${current >= totalPages ? 'disabled' : ''} aria-label="下一页">›</button>`,
  ];
  const jump = `
    <span class="artd-pagination-jump">前往
      <input class="artd-jump-input" type="number" min="1" max="${totalPages}" value="${current}" aria-label="跳转页码" />
    页</span>`;

  container.classList.add('artd-pagination');
  container.innerHTML = [totalText, ...parts, jump].join('');

  const gotoPage = target => {
    const num = Math.min(Math.max(1, Number(target) || 1), totalPages);
    if (num !== current) onPageChange(num);
  };
  container.querySelectorAll('button[data-page]').forEach(button => {
    button.addEventListener('click', () => {
      const raw = button.dataset.page;
      gotoPage(raw === 'prev' ? current - 1 : raw === 'next' ? current + 1 : raw);
    });
  });
  const jumpInput = container.querySelector('.artd-jump-input');
  if (jumpInput) {
    const commit = () => gotoPage(jumpInput.value);
    jumpInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') commit();
    });
    jumpInput.addEventListener('blur', commit);
  }
}

function renderReviewLogs(data) {
  const reviewBox = document.getElementById('image-monitor-log-box');
  if (!reviewBox) return;

  reviewBox.innerHTML = (data.items || []).length > 0
    ? data.items.map(item => `
      <div class="list-item tone-${getImageMonitorRiskTone(item.riskLevel)}">
        <div class="image-monitor-card-head">
          ${renderSafeImageMonitorThumb(item, '图片审核预览')}
          <div class="image-monitor-card-main">
            <h3>${escapeHtml(formatTime(item.reviewedAt))} <small>群 ${escapeHtml(item.groupId || '暂无')} / 用户 ${escapeHtml(item.userId || '暂无')}</small></h3>
            <div class="detail-tags">
              <span class="detail-tag tone-${getImageMonitorRiskTone(item.riskLevel)}">${formatImageMonitorRisk(item.riskLevel)}</span>
              <span class="detail-tag">${formatImageMonitorAction(item.violationAction)}</span>
              <span class="detail-tag">表情包：${formatBool(item.isMeme)}</span>
              <span class="detail-tag">${escapeHtml(formatMemeSaveStatus(item))}</span>
              <span class="detail-tag">情绪 ${escapeHtml(item.memeEmotion || item.emotion || 'default')}</span>
              <span class="detail-tag">已告警：${formatBool(item.alerted)}</span>
              <span class="detail-tag">已撤回：${formatBool(item.recalled)}</span>
            </div>
            <div>消息 ID：${escapeHtml(item.messageId || '暂无')}</div>
            <div>识别角色：${escapeHtml(item.memeCharacter || '暂无')}</div>
            <div>入库关键词：${escapeHtml(Array.isArray(item.memeKeywords) && item.memeKeywords.length > 0 ? item.memeKeywords.join(', ') : '暂无')}</div>
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
          ${renderSafeImageMonitorThumb(item, '表情包预览')}
          <div class="image-monitor-card-main">
            <h3>${escapeHtml(item.fileName || '未命名文件')} <small>${escapeHtml(formatTime(item.savedAt))}</small></h3>
            <div class="detail-tags">
              <span class="detail-tag tone-success">已保存表情包</span>
              <span class="detail-tag">角色 ${escapeHtml(item.character || item.folder || '未知')}</span>
              <span class="detail-tag">情绪 ${escapeHtml(item.emotion || 'default')}</span>
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
