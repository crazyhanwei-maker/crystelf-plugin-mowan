function renderSkillsSection() {
  const data = pluginSettingsState.skillsDraft || {
    enabled: false,
    autoLoad: true,
    defaultTimeoutMs: 15000,
    definitions: [],
  };
  const definitions = Array.isArray(data.definitions) ? data.definitions : [];
  const sortedDefinitions = [...definitions].sort(compareSkillCards);
  const activeFilter = normalizeSkillFilterValue(pluginSettingsState.skillsFilter);
  const skillsSearchKeyword = String(pluginSettingsState.skillsSearchKeyword || '');
  const normalizedSkillsSearchKeyword = normalizeSearchText(skillsSearchKeyword);
  let visibleDefinitions = sortedDefinitions.filter(item => (
    matchesSkillFilter(item, activeFilter) && matchesSkillSearch(item, skillsSearchKeyword)
  ));
  if (definitions.length > 0 && visibleDefinitions.length === 0 && !normalizedSkillsSearchKeyword && activeFilter !== 'all') {
    pluginSettingsState.skillsFilter = 'all';
    persistSkillFilter();
    visibleDefinitions = sortedDefinitions.filter(item => matchesSkillSearch(item, skillsSearchKeyword));
  }
  const expandedVisibleCount = visibleDefinitions.filter(item => isSkillExpanded(item)).length;
  const enabledCount = definitions.filter(item => item.enabled).length;
  const totalToolCount = definitions.reduce((sum, item) => sum + Number(item.toolCount || 0), 0);
  const enabledToolCount = definitions.reduce((sum, item) => {
    const tools = Array.isArray(item.tools) ? item.tools : [];
    return sum + tools.filter(tool => tool.enabled).length;
  }, 0);
  const filterButtons = Object.entries(SKILL_FILTER_MAP).map(([key, meta]) => {
    const count = definitions.filter(item => matchesSkillFilter(item, key)).length;
    const activeClass = key === activeFilter ? 'is-active' : '';
    return `<button type="button" class="feature-manage-btn feature-manage-btn-secondary plugin-settings-skill-filter-btn ${activeClass}" data-skills-filter="${escapeHtml(key)}">${escapeHtml(`${meta.label} ${count}`)}</button>`;
  }).join('');
  const summarySection = `
    <section class="plugin-settings-special-panel">
      <div class="plugin-settings-special-panel-head">
        <div>
          <h3>Skills 总览</h3>
          <div class="setting-status">这里展示 AI 可使用的扩展工具，并允许你直接开启或关闭。页面只显示用途和开关，不展示密钥细节。</div>
          ${data.previewOnly ? `<div class="setting-help">${escapeHtml(data.previewReason || '当前只显示内置工具目录，部分后端数据暂不可用。')}</div>` : ''}
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: data.enabled ? '系统：已启用' : '系统：已关闭', tone: data.enabled ? 'success' : 'warning' },
          { label: data.autoLoad ? '会话：自动加载' : '会话：手动加载', tone: data.autoLoad ? 'success' : 'warning' },
          { label: `技能：${enabledCount}/${definitions.length}`, tone: 'info' },
          { label: `工具：${enabledToolCount}/${totalToolCount}`, tone: 'info' },
          ...(data.previewOnly ? [{ label: '模式：兼容预览', tone: 'warning' }] : []),
          { label: `当前筛选：${SKILL_FILTER_MAP[activeFilter].label}`, tone: 'info' },
          ...(normalizedSkillsSearchKeyword ? [{ label: `搜索：${skillsSearchKeyword}`, tone: 'info' }] : []),
        ])}</div>
      </div>
      <div class="plugin-settings-skills-summary-grid">
        <div class="setting-item plugin-settings-skill-metric-card">
          <div class="kv-label">已启用技能</div>
          <div class="plugin-settings-skill-metric-value">${escapeHtml(String(enabledCount))}</div>
          <div class="setting-help">共 ${escapeHtml(String(definitions.length))} 个可选工具组，已开启项会优先展示。</div>
        </div>
        <div class="setting-item plugin-settings-skill-metric-card">
          <div class="kv-label">已启用工具</div>
          <div class="plugin-settings-skill-metric-value">${escapeHtml(String(enabledToolCount))}</div>
          <div class="setting-help">这些工具组里一共包含 ${escapeHtml(String(totalToolCount))} 个具体工具。</div>
        </div>
        <div class="setting-item plugin-settings-skill-metric-card">
          <div class="kv-label">自动加载</div>
          <div class="plugin-settings-skill-metric-value">${escapeHtml(data.autoLoad ? '开' : '关')}</div>
          <div class="setting-help">开启后，已启用的工具组会自动提供给每次 AI 对话。</div>
        </div>
        <div class="setting-item plugin-settings-skill-metric-card">
          <div class="kv-label">默认超时</div>
          <div class="plugin-settings-skill-metric-value">${escapeHtml(`${Number(data.defaultTimeoutMs || 15000)} ms`)}</div>
          <div class="setting-help">单个工具组没有单独设置时，会使用这个等待时间。</div>
        </div>
      </div>
      <div class="plugin-settings-skills-control-grid">
        <div class="setting-item plugin-settings-skill-control-card plugin-settings-skill-control-card-system">
          <div class="kv-label">系统开关</div>
          <div class="plugin-settings-skill-inline-metrics">
            <span class="tag">${escapeHtml(data.enabled ? '系统：已开启' : '系统：已关闭')}</span>
            <span class="tag">${escapeHtml(data.autoLoad ? '会话：自动加载' : '会话：手动加载')}</span>
            <span class="tag">${escapeHtml(`内置 ${Number(data.builtinDefinitionCount || 0)} / 自定义 ${Number(data.customDefinitionCount || 0)}`)}</span>
          </div>
          <div class="plugin-settings-skill-control-split">
            <button type="button" class="feature-manage-btn ${data.enabled ? 'feature-manage-btn-danger' : 'feature-manage-btn-safe'}" data-skills-global-toggle="enabled">${data.enabled ? '关闭整个 skills 系统' : '开启整个 skills 系统'}</button>
            <button type="button" class="feature-manage-btn ${data.autoLoad ? 'feature-manage-btn-warning' : 'feature-manage-btn-safe'}" data-skills-global-toggle="autoLoad">${data.autoLoad ? '改为手动加载' : '开启自动加载'}</button>
          </div>
          <label class="plugin-settings-skill-timeout-box">
            <span class="kv-label">默认超时</span>
            <input type="number" data-skills-field="defaultTimeoutMs" min="1000" max="60000" step="1000" value="${escapeHtml(String(data.defaultTimeoutMs || 15000))}" />
          </label>
        </div>
        <div class="setting-item plugin-settings-skill-control-card plugin-settings-skill-control-card-workflow">
          <div class="kv-label">搜索、筛选与批量操作</div>
          <div class="setting-help">可以先搜索或筛选，再对当前结果批量开启、关闭或查看工具详情。</div>
          <div class="plugin-settings-skill-search-row">
            <input type="text" data-skills-search="1" placeholder="搜索工具组、工具名称或使用场景" value="${escapeHtml(skillsSearchKeyword)}" />
            <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-search-clear="1">清空</button>
          </div>
          <div class="actions plugin-settings-skill-filter-actions">
            ${filterButtons}
          </div>
          <div class="plugin-settings-skill-action-cluster-grid">
            <div class="plugin-settings-skill-control-group">
              <div class="plugin-settings-skill-control-group-title">推荐组合</div>
              <div class="actions plugin-settings-skill-preset-actions">
                <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-skills-preset="daily">${escapeHtml(SKILL_PRESET_MAP.daily.label)}</button>
                <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-preset="research">${escapeHtml(SKILL_PRESET_MAP.research.label)}</button>
              </div>
              <div class="setting-help">只会开启推荐工具，不会关闭你已经开启的其他工具。</div>
            </div>
            <div class="plugin-settings-skill-control-group">
              <div class="plugin-settings-skill-control-group-title">批量开关</div>
              <div class="actions plugin-settings-skill-batch-actions">
                <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-skills-all-toggle="enable">全部开启</button>
                <button type="button" class="feature-manage-btn feature-manage-btn-danger" data-skills-all-toggle="disable">全部关闭</button>
              </div>
              <div class="setting-help">会同时处理工具组和组内工具，但不会修改具体请求内容。</div>
            </div>
            <div class="plugin-settings-skill-control-group">
              <div class="plugin-settings-skill-control-group-title">工具视图</div>
              <div class="actions plugin-settings-skill-expand-actions">
                <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-expand-all="expand">全部展开工具</button>
                <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-expand-all="collapse">全部收起工具</button>
              </div>
              <div class="setting-help">只影响当前筛选结果，方便快速查看多个工具组。</div>
            </div>
          </div>
          <div class="plugin-settings-skill-control-footer">
            <div class="setting-status">当前筛选：${escapeHtml(SKILL_FILTER_MAP[activeFilter].label)}${normalizedSkillsSearchKeyword ? `；关键词：${escapeHtml(skillsSearchKeyword)}` : ''}；已展开 ${escapeHtml(String(expandedVisibleCount))}/${escapeHtml(String(visibleDefinitions.length))}</div>
            <div class="actions plugin-settings-skill-reset-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-view-reset="1">重置当前视图</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  const cards = visibleDefinitions.length > 0
    ? visibleDefinitions.map((item) => {
      const guide = getSkillGuide(item.name);
      const toolPreview = buildSkillToolPreview(item.tools);
      const hostSummary = buildSkillHostSummary(item.allowedHosts);
      const examplesMarkup = renderSkillExamples(guide.examples, skillsSearchKeyword);
      const expanded = isSkillExpanded(item);
      const hasToolDetails = Number(item.toolCount || 0) > 0;
      const toolToggleLabel = hasToolDetails
        ? (normalizedSkillsSearchKeyword ? '搜索中自动展开' : expanded ? '收起工具列表' : '展开工具列表')
        : (data.previewOnly ? '工具明细待后端支持' : '暂无工具明细');
      return `
      <article class="setting-item plugin-settings-skill-card ${item.enabled ? '' : 'off'} ${expanded ? '' : 'collapsed'}">
        <div class="plugin-settings-skill-card-top">
          <div class="plugin-settings-skill-card-title">
            <div class="plugin-settings-skill-card-name-row">
              <div class="plugin-settings-skill-name-box">
                <span class="plugin-settings-skill-name-kicker">skill</span>
                <div class="plugin-settings-skill-name">${highlightSkillSearchText(item.name || 'unnamed-skill', skillsSearchKeyword)}</div>
              </div>
              <span class="plugin-settings-skill-scene-pill">${highlightSkillSearchText(guide.scene, skillsSearchKeyword)}</span>
            </div>
            <div class="plugin-settings-skill-card-copy">${highlightSkillSearchText(item.description || '当前没有额外说明。', skillsSearchKeyword)}</div>
            <div class="plugin-settings-panel-meta plugin-settings-skill-card-meta">${renderPanelMetaChips([
              { label: item.enabled ? '当前：已参与会话' : '当前：未参与会话', tone: item.enabled ? 'success' : 'warning' },
              { label: item.origin === 'custom' ? '来源：自定义' : '来源：内置', tone: item.origin === 'custom' ? 'warning' : 'info' },
              { label: getSkillToolSummaryLabel(item, data.previewOnly), tone: 'info' },
              { label: `超时：${Number(item.timeoutMs || data.defaultTimeoutMs || 15000)} ms`, tone: 'info' },
              ...(hostSummary ? [{ label: hostSummary, tone: 'info' }] : []),
              ...(item.customized ? [{ label: '运行时已自定义', tone: 'warning' }] : []),
            ])}</div>
          </div>
          <div class="plugin-settings-skill-card-actions">
            <button type="button" class="feature-manage-btn ${item.enabled ? 'feature-manage-btn-danger' : 'feature-manage-btn-safe'}" data-skill-toggle="${escapeHtml(item.name || '')}">${item.enabled ? '关闭此 skill' : '开启此 skill'}</button>
            <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skill-expand="${escapeHtml(item.name || '')}" ${hasToolDetails ? '' : 'disabled'}>${escapeHtml(toolToggleLabel)}</button>
          </div>
        </div>
        <div class="plugin-settings-skill-guide">
          <div class="plugin-settings-skill-guide-head">
            <div class="plugin-settings-skill-guide-heading">
              <span class="plugin-settings-skill-guide-kicker">Usage</span>
              <div class="plugin-settings-skill-guide-title">${highlightSkillSearchText(guide.recommendation, skillsSearchKeyword)}</div>
            </div>
            <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
              { label: `建议：${guide.recommendation}`, tone: guide.recommendationTone || 'info' },
              ...(data.previewOnly ? [{ label: '当前：兼容预览', tone: 'warning' }] : []),
            ])}</div>
          </div>
          <div class="plugin-settings-skill-guide-summary-card">
            <div class="setting-help plugin-settings-skill-guide-summary">${highlightSkillSearchText(guide.summary, skillsSearchKeyword)}</div>
          </div>
          <div class="plugin-settings-skill-guide-facts">
            <div class="plugin-settings-skill-guide-fact">
              <span class="plugin-settings-skill-guide-fact-label">适合</span>
              <span class="plugin-settings-skill-guide-fact-value">${highlightSkillSearchText(guide.when, skillsSearchKeyword)}</span>
            </div>
            ${guide.caution ? `<div class="plugin-settings-skill-guide-fact">
              <span class="plugin-settings-skill-guide-fact-label">注意</span>
              <span class="plugin-settings-skill-guide-fact-value">${highlightSkillSearchText(guide.caution, skillsSearchKeyword)}</span>
            </div>` : ''}
          </div>
          ${toolPreview ? `<div class="plugin-settings-skill-tool-preview">
            <span class="plugin-settings-skill-guide-fact-label">工具摘要</span>
            <span class="plugin-settings-skill-guide-fact-value">${highlightSkillSearchText(toolPreview, skillsSearchKeyword)}</span>
          </div>` : ''}
          ${examplesMarkup}
        </div>
        ${expanded ? `<div class="plugin-settings-skill-tools">
          <div class="plugin-settings-skill-tools-head">
            <div class="plugin-settings-skill-tools-heading">
              <span class="plugin-settings-skill-tools-kicker">Tools</span>
              <div class="plugin-settings-skill-tools-title">已展开 ${Number(item.toolCount || (Array.isArray(item.tools) ? item.tools.length : 0))} 个工具</div>
            </div>
            <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
              { label: `启用 ${Array.isArray(item.tools) ? item.tools.filter(tool => tool?.enabled).length : 0}/${Number(item.toolCount || (Array.isArray(item.tools) ? item.tools.length : 0))}`, tone: 'info' },
            ])}</div>
          </div>
          <div class="plugin-settings-skill-tools-list">
          ${(Array.isArray(item.tools) ? item.tools : []).map((tool) => `
            <div class="plugin-settings-skill-tool-item">
              <div class="plugin-settings-skill-tool-head">
                <div class="plugin-settings-skill-tool-copy">
                  <strong>${highlightSkillSearchText(tool.name || 'tool', skillsSearchKeyword)}</strong>
                  <div class="plugin-settings-skill-tool-desc">${highlightSkillSearchText(tool.description || '当前没有工具说明。', skillsSearchKeyword)}</div>
                </div>
                <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
                  { label: String(tool.method || 'GET'), tone: 'info' },
                  { label: tool.enabled ? '已开启' : '已关闭', tone: tool.enabled ? 'success' : 'warning' },
                ])}</div>
              </div>
              <div class="plugin-settings-skill-tool-footer">
                <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
                  { label: `参数：${Number(tool.parameterCount || 0)} 个`, tone: 'info' },
                  ...(Array.isArray(tool.requiredParameters) && tool.requiredParameters.length > 0 ? [{ label: `必填：${tool.requiredParameters.join(', ')}`, tone: 'warning' }] : []),
                ])}</div>
                <div class="actions">
                  <button type="button" class="feature-manage-btn ${tool.enabled ? 'feature-manage-btn-warning' : 'feature-manage-btn-safe'}" data-skill-tool-toggle="${escapeHtml(item.name || '')}" data-tool-name="${escapeHtml(tool.name || '')}">${tool.enabled ? '关闭此 tool' : '开启此 tool'}</button>
                </div>
              </div>
            </div>
          `).join('') || '<div class="plugin-settings-skill-tool-empty">当前没有可展示的工具明细。</div>'}
          </div>
        </div>` : `<div class="plugin-settings-skill-tools-collapsed">${escapeHtml(getSkillCollapsedMessage(item, data.previewOnly))}</div>`}
      </article>
    `;
    }).join('')
    : `<div class="setting-item"><div class="kv-label">当前条件下暂无结果</div><div class="setting-help">已应用筛选：${escapeHtml(SKILL_FILTER_MAP[activeFilter].label)}${normalizedSkillsSearchKeyword ? `，搜索关键词：${escapeHtml(skillsSearchKeyword)}` : ''}。可以切回“全部”或清空搜索查看完整工具列表。</div></div>`;

  const editorPayload = pluginSettingsState.skillsEditorPayload || {};
  const editorStats = editorPayload.stats || {};
  const editorSupported = editorPayload.supported !== false;
  const editorReason = String(editorPayload.reason || '').trim();
  const editorStatusText = escapeHtml(pluginSettingsState.skillsEditorStatus || '提示：如果控制台对外开放，不要在这里粘贴包含私钥的原始配置。');
  const editorSection = editorSupported
    ? `
    <details class="plugin-settings-special-panel plugin-settings-skills-editor-panel">
      <summary class="plugin-settings-skills-editor-summary">
        <div>
          <h3>高级原始配置编辑</h3>
          <div class="setting-status">平时建议使用上面的开关；只有需要直接修改原始配置时再展开这里。</div>
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: `当前来源：${pluginSettingsState.skillsEditorSource === 'runtime' ? '运行时覆盖' : pluginSettingsState.skillsEditorSource === 'default' ? '默认模板' : '当前生效配置'}`, tone: 'info' },
          { label: `生效 skill：${Number(editorStats.effectiveDefinitionCount || definitions.length)}`, tone: 'info' },
          { label: `生效 tool：${Number(editorStats.effectiveToolCount || totalToolCount)}`, tone: 'info' },
        ])}</div>
      </summary>
      <div class="plugin-settings-skills-editor-body">
        <div class="plugin-settings-skills-editor-actions">
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-editor-load="effective">载入当前生效</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-editor-load="runtime">载入运行时覆盖</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-editor-load="default">载入默认模板</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-editor-format="1">整理格式</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-warning" data-skills-editor-validate="1">检查格式</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-skills-editor-save="1">保存原始配置</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-danger" data-skills-editor-reset="1">清空运行时覆盖</button>
        </div>
        <textarea class="plugin-settings-skills-editor-textarea" data-skills-editor="1" spellcheck="false">${escapeHtml(pluginSettingsState.skillsEditorText || '{}')}</textarea>
        <div class="setting-help">${editorStatusText}</div>
      </div>
    </details>
  `
    : `
    <details class="plugin-settings-special-panel plugin-settings-skills-editor-panel">
      <summary class="plugin-settings-skills-editor-summary">
        <div>
          <h3>高级原始配置编辑</h3>
          <div class="setting-status">当前控制台后端暂不支持这一块，结构化 Skills 开关仍可继续使用。</div>
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: '状态：暂不可用', tone: 'warning' },
          { label: '原因：后端接口缺失', tone: 'info' },
        ])}</div>
      </summary>
      <div class="plugin-settings-skills-editor-body">
        <div class="setting-item">
          <div class="kv-label">兼容模式</div>
          <div class="setting-help">${escapeHtml(editorReason || '当前控制台后端暂不支持原始配置编辑，因此已自动隐藏编辑区。')}</div>
        </div>
      </div>
    </details>
  `;

  document.getElementById('plugin-settings-skills-box').innerHTML = `${summarySection}<div class="plugin-settings-skills-grid">${cards}</div>${editorSection}`;
  document.getElementById('plugin-settings-skills-meta').innerHTML = renderPanelMetaChips([
    { label: data.enabled ? '系统：已启用' : '系统：已关闭', tone: data.enabled ? 'success' : 'warning' },
    { label: data.autoLoad ? '自动加载：开启' : '自动加载：关闭', tone: data.autoLoad ? 'success' : 'warning' },
    { label: `已启用：${enabledCount}/${definitions.length}`, tone: 'info' },
    { label: `工具：${enabledToolCount}/${totalToolCount}`, tone: 'info' },
    { label: `展示：${visibleDefinitions.length}/${definitions.length}`, tone: 'info' },
    ...(normalizedSkillsSearchKeyword ? [{ label: `匹配：${visibleDefinitions.length}`, tone: 'info' }] : []),
    { label: `默认超时：${Number(data.defaultTimeoutMs || 15000)} ms`, tone: 'info' },
  ]);
  ensureSkillsLayoutObserver();
}


