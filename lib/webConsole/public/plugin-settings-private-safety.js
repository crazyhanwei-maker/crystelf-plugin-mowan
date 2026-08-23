function formatPrivateSafetyTime(value = '') {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value || '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function renderPrivateSafetyEmpty(text = '暂无记录') {
  return `<div class="setting-item"><div class="setting-help">${escapeHtml(text)}</div></div>`;
}

function getPrivateSafetyView() {
  const view = pluginSettingsState.privateAiSafetyView || {};
  return {
    keyword: String(view.keyword || '').trim(),
    action: String(view.action || 'all').trim() || 'all',
    pageSize: Math.max(5, Math.min(50, Number(view.pageSize || 10) || 10)),
    blacklistPage: Math.max(1, Number(view.blacklistPage || 1) || 1),
    warningPage: Math.max(1, Number(view.warningPage || 1) || 1),
    recordPage: Math.max(1, Number(view.recordPage || 1) || 1),
  };
}

function setPrivateSafetyView(patch = {}) {
  pluginSettingsState.privateAiSafetyView = {
    ...getPrivateSafetyView(),
    ...patch,
  };
}

function normalizePrivateSafetySearchText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function privateSafetyMatchesKeyword(item = {}, fields = [], keyword = '') {
  const text = normalizePrivateSafetySearchText(keyword);
  if (!text) return true;
  return fields.some(field => normalizePrivateSafetySearchText(item?.[field]).includes(text));
}

function filterPrivateSafetyItems(items = [], type = 'record') {
  const view = getPrivateSafetyView();
  const list = Array.isArray(items) ? items : [];
  if (type === 'blacklist') {
    return list.filter(item => privateSafetyMatchesKeyword(item, ['userId', 'reason', 'category', 'source', 'createdAt', 'expiresAt'], view.keyword));
  }
  if (type === 'warning') {
    return list.filter(item => privateSafetyMatchesKeyword(item, ['userId', 'latestReason', 'latestCategory', 'latestAt'], view.keyword));
  }
  return list
    .filter(item => view.action === 'all' || String(item?.action || '') === view.action)
    .filter(item => privateSafetyMatchesKeyword(item, ['userId', 'action', 'reason', 'category', 'source', 'contentHash', 'createdAt'], view.keyword));
}

function paginatePrivateSafetyItems(items = [], page = 1, pageSize = 10) {
  const total = Array.isArray(items) ? items.length : 0;
  const size = Math.max(5, Math.min(50, Number(pageSize || 10) || 10));
  const pageCount = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.max(1, Math.min(pageCount, Number(page || 1) || 1));
  const start = (currentPage - 1) * size;
  return {
    items: items.slice(start, start + size),
    total,
    page: currentPage,
    pageCount,
    pageSize: size,
  };
}

function renderPrivateSafetyPagination(kind = '', pageData = {}) {
  const total = Number(pageData.total || 0);
  if (total <= Number(pageData.pageSize || 10)) {
    return `<div class="setting-help">共 ${escapeHtml(total)} 条。</div>`;
  }
  return `
    <div class="plugin-settings-skill-control-footer">
      <span class="setting-status">共 ${escapeHtml(total)} 条，第 ${escapeHtml(pageData.page || 1)} / ${escapeHtml(pageData.pageCount || 1)} 页</span>
      <div class="actions">
        <button type="button" data-private-safety-page-kind="${escapeHtml(kind)}" data-private-safety-page-step="-1" ${pageData.page <= 1 ? 'disabled' : ''}>上一页</button>
        <button type="button" data-private-safety-page-kind="${escapeHtml(kind)}" data-private-safety-page-step="1" ${pageData.page >= pageData.pageCount ? 'disabled' : ''}>下一页</button>
      </div>
    </div>
  `;
}

function renderPrivateSafetyControls(payload = {}) {
  const view = getPrivateSafetyView();
  const records = Array.isArray(payload.recentRecords) ? payload.recentRecords : [];
  const actions = Array.from(new Set(records.map(item => String(item?.action || '').trim()).filter(Boolean))).sort();
  return `
    <div class="plugin-settings-feature-action-group">
      <div class="plugin-settings-feature-action-title">检索与分页</div>
      <div class="plugin-settings-feature-search-row">
        <input data-private-safety-search placeholder="搜索 QQ、原因、类别、来源或内容哈希" value="${escapeHtml(view.keyword)}" />
        <button type="button" data-private-safety-search-clear="1">清空</button>
      </div>
      <div class="actions plugin-settings-feature-actions plugin-settings-private-safety-filters">
        <select data-private-safety-action>
          <option value="all" ${view.action === 'all' ? 'selected' : ''}>全部事件</option>
          ${actions.map(action => `<option value="${escapeHtml(action)}" ${view.action === action ? 'selected' : ''}>${escapeHtml(action)}</option>`).join('')}
        </select>
        <select data-private-safety-page-size>
          ${[5, 10, 20, 50].map(size => `<option value="${size}" ${view.pageSize === size ? 'selected' : ''}>每页 ${size} 条</option>`).join('')}
        </select>
      </div>
      <div class="setting-help">搜索不会请求 LLM，只在当前已加载的黑名单、警告和最近事件中筛选。</div>
    </div>
  `;
}

function renderPrivateSafetyMetric(label, value, tone = 'info') {
  return `
    <div class="plugin-settings-skill-metric-card private-safety-metric-card">
      <div class="kv-label">${escapeHtml(label)}</div>
      <div class="plugin-settings-skill-metric-value">${escapeHtml(value)}</div>
      <span class="plugin-settings-meta-chip ${tone ? `tone-${tone}` : ''}">${escapeHtml(tone === 'success' ? '正常' : tone === 'warning' ? '注意' : '统计')}</span>
    </div>
  `;
}

function renderPrivateSafetyBlacklist(items = []) {
  if (!items.length) {
    return renderPrivateSafetyEmpty('当前私聊安全黑名单为空。');
  }
  return items.map(item => `
    <div class="plugin-settings-skill-tool-item">
      <div class="plugin-settings-skill-tool-head">
        <div class="plugin-settings-skill-tool-copy">
          <strong>QQ ${escapeHtml(item.userId || '-')}</strong>
          <div class="plugin-settings-skill-tool-desc">${escapeHtml(item.reason || item.category || '触发安全策略')}</div>
        </div>
        <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-private-safety-unblock="${escapeHtml(item.userId || '')}">解除</button>
      </div>
      <div class="plugin-settings-skill-tool-footer">
        <span>来源：${escapeHtml(item.source || '-')}</span>
        <span>次数：${escapeHtml(item.count || 0)}</span>
        <span>创建：${escapeHtml(formatPrivateSafetyTime(item.createdAt))}</span>
        <span>剩余：${escapeHtml(item.durationLabel || '-')}</span>
      </div>
    </div>
  `).join('');
}

function renderPrivateSafetyWarnings(items = []) {
  if (!items.length) {
    return renderPrivateSafetyEmpty('当前警告窗口内没有用户触发记录。');
  }
  return items.map(item => `
    <div class="plugin-settings-skill-tool-item">
      <div class="plugin-settings-skill-tool-head">
        <div class="plugin-settings-skill-tool-copy">
          <strong>QQ ${escapeHtml(item.userId || '-')}</strong>
          <div class="plugin-settings-skill-tool-desc">${escapeHtml(item.latestReason || item.latestCategory || '触发私聊安全警告')}</div>
        </div>
        <span class="plugin-settings-meta-chip tone-warning">${escapeHtml(item.count || 0)} 次</span>
      </div>
      <div class="plugin-settings-skill-tool-footer">
        <span>最近：${escapeHtml(formatPrivateSafetyTime(item.latestAt))}</span>
        <span>类别：${escapeHtml(item.latestCategory || '-')}</span>
      </div>
    </div>
  `).join('');
}

function renderPrivateSafetyRecords(items = []) {
  if (!items.length) {
    return renderPrivateSafetyEmpty('当前还没有私聊安全事件。');
  }
  return items.map(item => `
    <div class="plugin-settings-feature-history-item ${item.action === 'blacklist' ? 'tone-error' : ''}">
      <div><strong>${escapeHtml(formatPrivateSafetyTime(item.createdAt))}</strong> · QQ ${escapeHtml(item.userId || '-')} · ${escapeHtml(item.action || '-')}</div>
      <div class="setting-help">${escapeHtml(item.reason || item.category || '安全事件')} · 来源 ${escapeHtml(item.source || '-')} · 置信度 ${escapeHtml(Number(item.confidence || 0).toFixed(2))}</div>
      <div class="setting-help">内容哈希：${escapeHtml(item.contentHash || '-')}</div>
    </div>
  `).join('');
}

function renderPrivateAiSafetySection() {
  const box = document.getElementById('plugin-settings-private-safety-box');
  if (!box) return;
  const payload = pluginSettingsState.privateAiSafety || null;
  const meta = document.getElementById('plugin-settings-private-safety-meta');
  if (!payload) {
    box.innerHTML = renderPrivateSafetyEmpty('当前后端暂不支持私聊安全管理，请更新控制台后端。');
    if (meta) meta.innerHTML = '';
    return;
  }

  const summary = payload.summary || {};
  const config = payload.config || {};
  const view = getPrivateSafetyView();
  const blacklistPage = paginatePrivateSafetyItems(
    filterPrivateSafetyItems(payload.blacklist || [], 'blacklist'),
    view.blacklistPage,
    view.pageSize,
  );
  const warningPage = paginatePrivateSafetyItems(
    filterPrivateSafetyItems(payload.warningUsers || [], 'warning'),
    view.warningPage,
    view.pageSize,
  );
  const recordPage = paginatePrivateSafetyItems(
    filterPrivateSafetyItems(payload.recentRecords || [], 'record'),
    view.recordPage,
    view.pageSize,
  );
  setPrivateSafetyView({
    blacklistPage: blacklistPage.page,
    warningPage: warningPage.page,
    recordPage: recordPage.page,
  });
  const statusText = pluginSettingsState.privateAiSafetyStatus || '可在这里解除黑名单、清空警告记录或清理 LLM 复审缓存。';
  box.innerHTML = `
    <section class="plugin-settings-feature-panel-card">
      <div class="plugin-settings-feature-panel-head">
        <div>
          <div class="kv-label">私聊安全概览</div>
          <div class="setting-status">${escapeHtml(statusText)}</div>
        </div>
        <div class="actions plugin-settings-feature-actions">
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-private-safety-refresh="1">刷新</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-private-safety-clear-cache="1">清理复审缓存</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-warning" data-private-safety-clear-records="1">清空警告记录</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-danger" data-private-safety-clear-all="1">清空含黑名单</button>
        </div>
        ${renderPrivateSafetyControls(payload)}
      </div>
      <div class="plugin-settings-skills-summary-grid private-safety-metric-grid">
        ${renderPrivateSafetyMetric('黑名单', `${summary.blacklistCount || 0} 人`, summary.blacklistCount ? 'warning' : 'success')}
        ${renderPrivateSafetyMetric('警告用户', `${summary.warningUserCount || 0} 人`, summary.warningUserCount ? 'warning' : 'success')}
        ${renderPrivateSafetyMetric('最近事件', `${summary.recentRecordCount || 0} 条`, 'info')}
        ${renderPrivateSafetyMetric('复审缓存', `${summary.reviewCacheCount || 0} 条`, config.reviewCacheEnabled ? 'success' : 'warning')}
      </div>
      <div class="setting-help">
        安全检查：${config.enabled ? '开启' : '关闭'}；内容拦截：${config.contentGuard ? '开启' : '关闭'}；LLM 复审：${config.llmReview ? '开启' : '关闭'}；全量复审：${config.llmReviewAll ? '开启' : '关闭'}；缓存：${config.reviewCacheEnabled ? `${config.reviewCacheTtlHours || 24} 小时` : '关闭'}；本地规则：${config.hasLocalRules ? '已配置' : '未配置'}。
      </div>
    </section>
    <section class="plugin-settings-feature-panel-card">
      <div class="plugin-settings-feature-panel-head">
        <div>
          <div class="kv-label">私聊黑名单</div>
          <div class="setting-status">被拉黑用户不会继续进入私聊 AI 主流程。</div>
        </div>
      </div>
      <div class="plugin-settings-skill-tools-list">${renderPrivateSafetyBlacklist(blacklistPage.items)}</div>
      ${renderPrivateSafetyPagination('blacklist', blacklistPage)}
    </section>
    <section class="plugin-settings-feature-panel-card">
      <div class="plugin-settings-feature-panel-head">
        <div>
          <div class="kv-label">警告窗口用户</div>
          <div class="setting-status">只展示当前统计窗口内仍有效的警告次数。</div>
        </div>
      </div>
      <div class="plugin-settings-skill-tools-list">${renderPrivateSafetyWarnings(warningPage.items)}</div>
      ${renderPrivateSafetyPagination('warning', warningPage)}
    </section>
    <section class="plugin-settings-feature-panel-card">
      <div class="plugin-settings-feature-panel-head">
        <div>
          <div class="kv-label">最近安全事件</div>
          <div class="setting-status">仅展示事件摘要和内容哈希，不展示私聊原文。</div>
        </div>
      </div>
      <div class="plugin-settings-feature-history">${renderPrivateSafetyRecords(recordPage.items)}</div>
      ${renderPrivateSafetyPagination('record', recordPage)}
    </section>
  `;

  if (meta) {
    meta.innerHTML = renderPanelMetaChips([
      { label: config.enabled ? '私聊安全：开启' : '私聊安全：关闭', tone: config.enabled ? 'success' : 'warning' },
      { label: config.reviewCacheEnabled ? `复审缓存：${config.reviewCacheTtlHours || 24} 小时` : '复审缓存：关闭', tone: config.reviewCacheEnabled ? 'success' : 'warning' },
      { label: `事件：${summary.recentRecordCount || 0} 条`, tone: 'info' },
    ]);
  }
}

async function refreshPrivateAiSafetySection() {
  const response = await fetchJson('/api/plugin-settings/private-ai-safety');
  pluginSettingsState.privateAiSafety = response?.data || null;
  pluginSettingsState.privateAiSafetyStatus = '已刷新私聊安全数据。';
  renderPrivateAiSafetySection();
}
