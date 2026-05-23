function renderLogs(data) {
  const usageBox = document.getElementById('usage-log-box');
  const affinityBox = document.getElementById('affinity-log-box');
  const usageHtml = (data.usage?.items || []).length > 0
    ? data.usage.items.map(item => `
      <div class="list-item log-entry-card ${item.error ? 'tone-error' : ''}">
        <div class="log-entry-head">
          <div>
            <h3>${escapeHtml(item.scene_label || formatSceneLabel(item.scene) || '未知场景')}</h3>
            <div class="setting-help">${escapeHtml(formatTime(item.time))}</div>
          </div>
          <div class="detail-tags">
            <span class="detail-tag ${item.error ? 'tone-error' : 'tone-success'}">${item.error ? '失败' : '成功'}</span>
            <span class="detail-tag">${escapeHtml(item.model || '未知模型')}</span>
            <span class="detail-tag">令牌 ${formatNumber(item.total_tokens || 0)}</span>
          </div>
        </div>
        <div class="log-entry-meta">
          <span>会话 ${escapeHtml(item.session_id || '暂无')}</span>
          <span>群 ${escapeHtml(item.group_id || '暂无')}</span>
          <span>用户 ${escapeHtml(item.user_id || '暂无')}</span>
        </div>
        ${renderUsagePromptPreview(item)}
        <div class="log-entry-preview">
          <div class="log-entry-label">${item.error ? '错误信息' : '响应预览'}</div>
          <div class="log-entry-text">${escapeHtml(item.display_response_preview || item.response_preview || item.error || '暂无')}</div>
        </div>
        <div class="actions">
          <a class="link-btn" href="/usage-log-detail.html?id=${encodeURIComponent(item.id || '')}">详情</a>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无 AI 用量日志</div>';

  const affinityHtml = (data.affinity?.items || []).length > 0
    ? data.affinity.items.map(item => `
      <div class="list-item log-entry-card ${Number(item.delta || 0) < 0 ? 'tone-error' : ''}">
        <div class="log-entry-head">
          <div>
            <h3>${escapeHtml(item.level || '未知等级')}</h3>
            <div class="setting-help">${escapeHtml(formatTime(item.time))}</div>
          </div>
          <div class="detail-tags">
            <span class="detail-tag ${Number(item.delta || 0) < 0 ? 'tone-error' : 'tone-success'}">${Number(item.delta || 0) >= 0 ? '+' : ''}${escapeHtml(String(item.delta ?? 0))}</span>
            <span class="detail-tag">群 ${escapeHtml(item.group_id || '暂无')}</span>
            <span class="detail-tag">用户 ${escapeHtml(item.user_id || '暂无')}</span>
          </div>
        </div>
        <div class="log-entry-preview">
          <div class="log-entry-label">原因</div>
          <div class="log-entry-text">${escapeHtml(item.reason || '暂无')}${item.guard ? ` / 保护：${escapeHtml(item.guard)}` : ''}</div>
        </div>
        <div class="log-entry-preview">
          <div class="log-entry-label">关联文本</div>
          <div class="log-entry-text">${escapeHtml(item.text_preview || '暂无')}</div>
        </div>
        <div class="actions">
          <a class="link-btn" href="/affinity-log-detail.html?id=${encodeURIComponent(item.id || '')}">详情</a>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无好感日志</div>';
  if (usageBox) {
    usageBox.innerHTML = usageHtml;
    renderPagination('usage-log-pagination', data.usage?.page, data.usage?.totalPages, page => {
      state.usageLogPage = page;
      refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
    });
  }
  if (affinityBox) {
    affinityBox.innerHTML = affinityHtml;
    renderPagination('affinity-log-pagination', data.affinity?.page, data.affinity?.totalPages, page => {
      state.affinityLogPage = page;
      refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
    });
  }
}
