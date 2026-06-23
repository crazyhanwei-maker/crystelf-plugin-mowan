// 插件设置页面渲染层。由 plugin-settings.html 在 plugin-settings.js 前加载。

function renderCategoryTabs() {
  const categories = pluginSettingsState.payload?.categories || [];
  const items = pluginSettingsState.payload?.items || [];
  const visibleCategories = categories.filter(category => items.some(item => item.category === category.key && isMatchedBySearch(item)));
  if (!visibleCategories.some(item => item.key === pluginSettingsState.activeCategory)) {
    pluginSettingsState.activeCategory = visibleCategories[0]?.key || categories[0]?.key || 'main';
  }
  const container = document.getElementById('plugin-settings-category-tabs');
  container.innerHTML = visibleCategories.map(item => {
    const count = items.filter(entry => entry.category === item.key && isMatchedBySearch(entry)).length;
    return `
    <button class="settings-tab-btn ${pluginSettingsState.activeCategory === item.key ? 'active' : ''}" data-settings-category="${item.key}">${escapeHtml(item.label)} (${count})</button>
  `;
  }).join('');
}

function renderGroupTabs() {
  const items = pluginSettingsState.payload?.items || [];
  const groups = [...new Set(items.filter(item => item.category === pluginSettingsState.activeCategory && isMatchedBySearch(item)).map(item => item.group))];
  if (!pluginSettingsState.activeGroup || !groups.includes(pluginSettingsState.activeGroup)) {
    pluginSettingsState.activeGroup = groups[0] || '';
  }
  const container = document.getElementById('plugin-settings-group-tabs');
  container.innerHTML = groups.map(group => {
    const count = items.filter(item => item.category === pluginSettingsState.activeCategory && item.group === group && isMatchedBySearch(item)).length;
    return `
    <button class="plugin-settings-group-btn ${pluginSettingsState.activeGroup === group ? 'active' : ''}" data-settings-group="${escapeHtml(group)}">
      <span>${escapeHtml(group)}</span>
      <span class="plugin-settings-group-count">${count}</span>
    </button>
  `;
  }).join('');
}

function renderField(item) {
  const value = pluginSettingsState.draft[item.field];
  const props = item.componentProps || {};
  const readonly = item.readonly ? 'readonly' : '';
  const typeLabel = item.readonly ? '只读' : item.component;
  const matched = isRecommendationMatched(item.field, value);
  if (item.component === 'Switch') {
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
        <div class="plugin-settings-field-head">
          <div class="kv-label">${escapeHtml(item.label)}</div>
          <span class="tag">${escapeHtml(typeLabel)}</span>
        </div>
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <button class="plugin-settings-switch ${value ? '' : 'off'}" data-switch-field="${item.field}">${value ? '已开启' : '已关闭'}</button>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  if (item.component === 'InputTextArea') {
    if (item.field === 'ai.knowledgeBase') {
      const segments = parseKnowledgePreview(value ?? '');
      const previewSegments = parseKnowledgePreview(pluginSettingsState.knowledgeGeneratePreview || '');
      const historyPreview = pluginSettingsState.knowledgeHistory.find(item => item.id === pluginSettingsState.knowledgeHistoryPreviewId);
      const diffSummary = historyPreview ? buildKnowledgeDiffSummary(pluginSettingsState.draft['ai.knowledgeBase'] || '', historyPreview.content || '') : null;
      return `
        <div class="${buildFieldCardClasses(item, matched, 'plugin-settings-knowledge-card')}">
          <div class="plugin-settings-field-head">
            <div class="kv-label">${escapeHtml(item.label)}</div>
            <span class="tag">${escapeHtml(typeLabel)}</span>
          </div>
          ${renderFieldMeta(item)}
          ${renderFieldNotice(item)}
          <div class="plugin-settings-knowledge-toolbar">
            <input data-knowledge-generator-query placeholder="输入主题，例如：崩坏星穹铁道角色培养" value="${escapeHtml(pluginSettingsState.knowledgeGenerateQuery || '')}" />
            <button type="button" data-knowledge-generator-action="generate">${pluginSettingsState.knowledgeGenerateLoading ? '生成中...' : '联网生成知识库'}</button>
            <select data-knowledge-generate-mode>
              <option value="replace" ${pluginSettingsState.knowledgeGenerateMode === 'replace' ? 'selected' : ''}>覆盖模式</option>
              <option value="append" ${pluginSettingsState.knowledgeGenerateMode === 'append' ? 'selected' : ''}>追加模式</option>
            </select>
            <button type="button" data-knowledge-generator-action="apply">应用生成结果</button>
            <button type="button" data-knowledge-editor-action="fill-demo">填入示例</button>
            <button type="button" data-knowledge-editor-action="clear">清空内容</button>
            <span class="setting-status">共 ${segments.length} 条知识片段</span>
          </div>
          <div class="setting-help">${escapeHtml(pluginSettingsState.knowledgeGenerateStatus || '输入主题后点击“联网生成知识库”，后台会搜索资料并整理成机器人可使用的知识片段。')}</div>
          ${pluginSettingsState.knowledgeGenerateSources.length > 0 ? `<div class="plugin-settings-knowledge-preview">${pluginSettingsState.knowledgeGenerateSources.map((item, index) => `<div class="plugin-settings-knowledge-segment"><div class="plugin-settings-knowledge-segment-head"><strong>来源 ${index + 1}. ${escapeHtml(item.title || '未命名来源')}</strong></div><div class="plugin-settings-knowledge-content">${escapeHtml(item.snippet || item.url || '')}</div></div>`).join('')}</div>` : ''}
          ${previewSegments.length > 0 ? `<div class="plugin-settings-knowledge-preview plugin-settings-knowledge-preview-pending"><div class="setting-status">生成结果预览（尚未写入知识库草稿）</div>${previewSegments.map((segment, index) => `<label class="plugin-settings-knowledge-segment plugin-settings-knowledge-selectable"><div class="plugin-settings-knowledge-segment-head"><strong>${index + 1}. ${escapeHtml(segment.title || '未命名片段')}</strong><input type="checkbox" data-knowledge-preview-id="${escapeHtml(segment.id)}" ${pluginSettingsState.knowledgeSelectedPreviewIds.includes(segment.id) ? 'checked' : ''} /></div>${segment.tags.length > 0 ? `<div class="plugin-settings-knowledge-tags">${segment.tags.map(tag => `<span class="sandbox-rag-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}<div class="plugin-settings-knowledge-content">${escapeHtml(segment.content || '（无正文）')}</div></label>`).join('')}</div>` : ''}
          <textarea data-field="${item.field}" rows="${props.rows || 12}" placeholder="${escapeHtml(props.placeholder || '')}" ${readonly}>${escapeHtml(value ?? '')}</textarea>
          <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
          <div class="plugin-settings-knowledge-preview">
            ${segments.length > 0 ? segments.map((segment, index) => `
              <div class="plugin-settings-knowledge-segment">
                <div class="plugin-settings-knowledge-segment-head">
                  <strong>${index + 1}. ${escapeHtml(segment.title || '未命名片段')}</strong>
                  ${segment.tags.length > 0 ? `<div class="plugin-settings-knowledge-tags">${segment.tags.map(tag => `<span class="sandbox-rag-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
                </div>
                <div class="plugin-settings-knowledge-content">${escapeHtml(segment.content || '（无正文）')}</div>
              </div>
            `).join('') : '<div class="setting-status">当前还没有配置知识片段</div>'}
          </div>
          <div class="plugin-settings-knowledge-history">
            <div class="plugin-settings-field-head">
              <div class="kv-label">知识库版本历史</div>
              <span class="tag">最近 ${pluginSettingsState.knowledgeHistory.length} 条</span>
            </div>
            ${pluginSettingsState.knowledgeHistory.length > 0 ? pluginSettingsState.knowledgeHistory.map(item => `<div class="plugin-settings-knowledge-history-item"><div><strong>${escapeHtml(item.createdAt)}</strong> · ${escapeHtml(item.note || item.action || '历史版本')}</div><div class="setting-help">${escapeHtml(item.query ? `主题：${item.query}` : '手动/应用生成结果形成的版本')}</div><div class="plugin-settings-knowledge-tags">${item.mode ? `<span class="sandbox-rag-tag">${escapeHtml(item.mode === 'append' ? '追加' : '覆盖')}</span>` : ''}${Array.isArray(item.sources) ? item.sources.slice(0, 3).map(source => `<span class="sandbox-rag-token">${escapeHtml(source.title || '来源')}</span>`).join('') : ''}</div><div class="plugin-settings-knowledge-history-actions"><button type="button" data-knowledge-history-action="preview" data-knowledge-history-id="${escapeHtml(item.id)}">预览差异</button><button type="button" data-knowledge-history-action="restore" data-knowledge-history-id="${escapeHtml(item.id)}">恢复此版本</button></div></div>`).join('') : '<div class="setting-status">当前还没有知识库版本历史</div>'}
            ${historyPreview ? `<div class="plugin-settings-knowledge-preview plugin-settings-knowledge-history-preview"><div class="setting-status">版本预览：${escapeHtml(historyPreview.createdAt)}</div><div class="setting-help">当前草稿 ${diffSummary?.currentCount ?? 0} 条 → 历史版本 ${diffSummary?.targetCount ?? 0} 条；新增 ${diffSummary?.added.length ?? 0} 条，移除 ${diffSummary?.removed.length ?? 0} 条。</div>${diffSummary?.added.length ? `<div class="plugin-settings-knowledge-tags">${diffSummary.added.map(item => `<span class="sandbox-rag-tag">新增：${escapeHtml(item)}</span>`).join('')}</div>` : ''}${diffSummary?.removed.length ? `<div class="plugin-settings-knowledge-tags">${diffSummary.removed.map(item => `<span class="sandbox-rag-token">移除：${escapeHtml(item)}</span>`).join('')}</div>` : ''}<div class="plugin-settings-knowledge-content">${escapeHtml(historyPreview.content || '（无内容）')}</div></div>` : ''}
          </div>
        </div>
      `;
    }
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
        ${renderFieldHead(item, typeLabel)}
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <textarea data-field="${item.field}" rows="${props.rows || 4}" placeholder="${escapeHtml(props.placeholder || '')}" ${readonly}>${escapeHtml(value ?? '')}</textarea>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  if (item.component === 'Select') {
    const multiple = props.mode === 'multiple';
    const currentValues = multiple ? (Array.isArray(value) ? value : []) : [value];
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
        ${renderFieldHead(item, multiple ? '多选' : typeLabel)}
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <select data-field="${item.field}" ${multiple ? 'multiple' : ''} ${readonly}>
          ${(props.options || []).map(option => `<option value="${escapeHtml(option.value)}" ${currentValues.includes(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
        </select>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  if (item.component === 'InputArray') {
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
      ${renderFieldHead(item, '列表')}
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <textarea data-field="${item.field}" rows="4" placeholder="每行一项" ${readonly}>${escapeHtml((Array.isArray(value) ? value : []).join('\n'))}</textarea>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  const type = item.component === 'InputPassword' ? 'password' : 'text';
  const inputHtml = `<input type="${type}" data-field="${item.field}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(props.placeholder || '')}" ${type === 'password' ? 'autocomplete="new-password"' : ''} ${readonly} />`;
  // 「模型列表地址」字段旁注入「刷新模型列表」按钮，方便在配置语音接口时直接拉取远端模型。
  const ttsRefreshBar = item.field === 'coreConfig.tools.tts.modelsUrl'
    ? `<div class="plugin-settings-tts-refresh-bar">
         <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-tts-models-refresh="1">${pluginSettingsState.ttsModelsRefreshing ? '刷新中...' : '刷新模型列表'}</button>
         <span class="setting-status">${escapeHtml(pluginSettingsState.ttsModelsRefreshStatus || '点击从远端模型列表地址重新拉取，刷新后需保存并重开页面让默认模型下拉项更新。')}</span>
       </div>`
    : '';
  return `
    <div class="${buildFieldCardClasses(item, matched)}">
      ${renderFieldHead(item, typeLabel)}
      ${renderFieldMeta(item)}
      ${renderFieldNotice(item)}
      ${type === 'password'
        ? `<form class="inline-field-form" onsubmit="return false;">
            <input class="visually-hidden" type="text" autocomplete="username" tabindex="-1" aria-hidden="true" />
            ${inputHtml}
          </form>`
        : inputHtml}
      ${ttsRefreshBar}
      <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
    </div>
  `;
}

function renderForm() {
  const items = getVisibleItems();
  const knowledgeItems = pluginSettingsState.activeCategory === 'ai' ? items.filter(item => isAiKnowledgeField(item.field)) : [];
  const normalItems = pluginSettingsState.activeCategory === 'ai' ? items.filter(item => !isAiKnowledgeField(item.field)) : items;
  const category = (pluginSettingsState.payload?.categories || []).find(item => item.key === pluginSettingsState.activeCategory);
  const recommendableItems = normalItems.filter(item => Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field));
  const knowledgePanel = knowledgeItems.length > 0 ? `
    <section class="plugin-settings-special-panel plugin-settings-knowledge-panel">
      <div class="plugin-settings-special-panel-head">
        <div>
          <h3>知识库面板</h3>
          <div class="setting-status">集中管理真实机器人聊天使用的本地知识库开关、召回条数与正文内容。</div>
        </div>
      </div>
      <div class="plugin-settings-special-panel-grid">
        ${knowledgeItems.map(renderField).join('')}
      </div>
    </section>
  ` : '';
  document.getElementById('plugin-settings-form').innerHTML = (knowledgePanel || '') + (normalItems.length > 0
    ? normalItems.map(renderField).join('')
    : '<div class="setting-item">当前分组暂无可展示配置项</div>');
  const summaryEl = document.getElementById('plugin-settings-summary');
  if (recommendableItems.length > 0) {
    summaryEl.innerHTML = `${escapeHtml(category?.label || pluginSettingsState.activeCategory)} / ${escapeHtml(pluginSettingsState.activeGroup)} / ${items.length} 项 <button type="button" class="tag" data-apply-group-recommendation="1">应用本组推荐配置</button>`;
  } else {
    summaryEl.textContent = `${category?.label || pluginSettingsState.activeCategory} / ${pluginSettingsState.activeGroup} / ${items.length} 项`;
  }
  document.getElementById('plugin-settings-group-title').textContent = pluginSettingsState.activeGroup || '配置项';
  const groupDescription = GROUP_DESCRIPTIONS[pluginSettingsState.activeGroup] || '当前分组下集中展示同一类配置，方便按使用场景快速调整。';
  const groupRecommendation = GROUP_RECOMMENDATIONS[pluginSettingsState.activeGroup] || '';
  document.getElementById('plugin-settings-group-desc').textContent = `${groupDescription}${groupRecommendation ? ` 新手建议：${groupRecommendation}` : ''} 当前共 ${items.length} 项。${pluginSettingsState.searchKeyword ? ` 当前搜索：${pluginSettingsState.searchKeyword}` : ''}`;
  document.getElementById('plugin-settings-search-status').textContent = pluginSettingsState.recommendationStatus || (pluginSettingsState.searchKeyword
    ? `当前搜索：${pluginSettingsState.searchKeyword}，已按结果过滤分类、分组和字段。`
    : '可搜索分类、分组、字段名和说明。');
  document.getElementById('plugin-settings-config-meta').innerHTML = renderPanelMetaChips([
    { label: `分类：${category?.label || pluginSettingsState.activeCategory || '未选择'}` },
    { label: `分组：${pluginSettingsState.activeGroup || '未选择'}` },
    { label: `字段：${items.length} 项`, tone: 'info' },
    ...(pluginSettingsState.searchKeyword ? [{ label: `搜索：${pluginSettingsState.searchKeyword}`, tone: 'warning' }] : []),
  ]);
}
