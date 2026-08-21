function renderConsoleSection() {
  const runtime = pluginSettingsState.editableConfig?.webConsole || {};
  const itemMap = new Map((pluginSettingsState.payload?.items || []).map(item => [item.field, item]));
  const themeState = window.CrystelfTheme?.getState?.() || {
    mode: document.documentElement.dataset.themeMode || document.documentElement.dataset.theme || 'dark',
    resolvedMode: document.documentElement.dataset.theme || 'dark',
    accent: document.documentElement.dataset.accent || 'cyan',
    modes: [
      { value: 'dark', label: '深色' },
      { value: 'light', label: '浅色' },
      { value: 'system', label: '跟随系统' },
    ],
    accents: Object.entries(CONSOLE_THEME_ACCENT_META).map(([value, meta]) => ({ value, label: meta.label })),
  };
  const localCache = window.CrystelfLocalCache?.getSummary?.() || {
    available: false,
    count: 0,
    labels: [],
    totalBytesLabel: '0 B',
  };
  const localCacheDetail = localCache.available
    ? localCache.count > 0
      ? `检测到 ${localCache.count} 项本机缓存，约 ${localCache.totalBytesLabel}。${localCache.labels?.length ? `包含：${localCache.labels.slice(0, 5).join('、')}${localCache.labels.length > 5 ? '等' : ''}。` : ''}`
      : '当前浏览器没有检测到控制台本机缓存。'
    : '当前浏览器不允许读取本机缓存。';
  const renderConsoleFieldSection = (title, description, fields) => {
    const sectionItems = fields.map(field => itemMap.get(field)).filter(Boolean);
    if (sectionItems.length === 0) return '';
    return `
      <section class="plugin-settings-special-panel">
        <div class="plugin-settings-special-panel-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <div class="setting-status">${escapeHtml(description)}</div>
          </div>
          <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
            { label: `字段：${sectionItems.length} 项`, tone: 'info' },
          ])}</div>
        </div>
        <div class="plugin-settings-special-panel-grid">
          ${sectionItems.map(renderField).join('')}
        </div>
      </section>
    `;
  };

  const runtimeSection = `
    <section class="plugin-settings-special-panel">
      <div class="plugin-settings-special-panel-head">
        <div>
          <h3>运行状态</h3>
          <div class="setting-status">先确认控制台当前是否真的跑起来，再决定是否调整访问参数。</div>
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: runtime.runtimeRunning ? '当前：已运行' : '当前：未运行', tone: runtime.runtimeRunning ? 'success' : 'warning' },
        ])}</div>
      </div>
      <div class="plugin-settings-special-panel-grid">
        <div class="setting-item">
          <div class="kv-label">运行状态</div>
          <div class="kv-value">${escapeHtml(runtime.runtimeRunning ? `已运行（${runtime.webConsoleReadOnly ? '地址已隐藏' : runtime.runtimeUrl || '地址未知'}）` : '未运行或需重启后生效')}</div>
          <div class="setting-help">这里展示的是当前控制台服务实例的实际运行状态，不等于仅配置层状态。</div>
        </div>
      </div>
    </section>
  `;

  const appearanceSection = `
    <section class="plugin-settings-special-panel console-appearance-panel">
      <div class="plugin-settings-special-panel-head">
        <div>
          <h3>外观主题</h3>
          <div class="setting-status">主题设置只保存在当前浏览器，切换后立即生效，不需要保存插件配置或重启机器人。</div>
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: `模式：${themeState.modes.find(item => item.value === themeState.mode)?.label || themeState.mode}`, tone: 'info' },
          { label: `当前：${themeState.resolvedMode === 'dark' ? '深色' : '浅色'}`, tone: themeState.resolvedMode === 'dark' ? 'success' : 'info' },
          { label: `配色：${CONSOLE_THEME_ACCENT_META[themeState.accent]?.label || themeState.accent}`, tone: 'info' },
        ])}</div>
      </div>
      <div class="console-appearance-grid">
        <div class="setting-item console-appearance-card">
          <div class="kv-label">主题模式</div>
          <div class="console-theme-segmented" role="radiogroup" aria-label="主题模式">
            ${(themeState.modes || []).map(item => `
              <button type="button" class="console-theme-choice ${themeState.mode === item.value ? 'active' : ''}" data-console-theme-mode="${escapeHtml(item.value)}">
                ${escapeHtml(item.label)}
              </button>
            `).join('')}
          </div>
          <div class="setting-help">“跟随系统”会按操作系统深浅色自动切换。</div>
        </div>
        <div class="setting-item console-appearance-card">
          <div class="kv-label">壁纸背景</div>
          <div class="actions console-appearance-actions">
            <button type="button" class="mini-btn" data-console-background-refresh="1">换一张壁纸</button>
          </div>
          <div class="setting-help">使用控制台同款背景缓存接口，只刷新本地后台壁纸。</div>
        </div>
        <div class="setting-item console-appearance-card">
          <div class="kv-label">本机缓存</div>
          <div class="kv-value">${escapeHtml(localCache.available ? `${localCache.count} 项 / ${localCache.totalBytesLabel}` : '不可用')}</div>
          <div class="actions console-appearance-actions">
            <button type="button" class="mini-btn" data-console-cache-action="clear" ${localCache.available && localCache.count > 0 ? '' : 'disabled'}>清理本机缓存</button>
          </div>
          <div class="setting-help">${escapeHtml(localCacheDetail)}</div>
        </div>
      </div>
      <div class="console-accent-grid">
        ${(themeState.accents || []).map((item) => {
          const meta = CONSOLE_THEME_ACCENT_META[item.value] || { label: item.label || item.value, desc: '' };
          return `
            <button type="button" class="console-accent-card ${themeState.accent === item.value ? 'active' : ''}" data-console-theme-accent="${escapeHtml(item.value)}">
              <span class="console-accent-swatch console-accent-swatch-${escapeHtml(item.value)}"></span>
              <span class="console-accent-copy">
                <strong>${escapeHtml(meta.label)}</strong>
                <small>${escapeHtml(meta.desc)}</small>
              </span>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;

  const sections = [
    runtimeSection,
    appearanceSection,
    renderConsoleFieldSection('访问与安全', '控制台是否启用、是否只读，以及登录口令等安全项。控制台网页始终要求登录。', [
      'config.webConsole',
      'config.webConsoleReadOnly',
      'config.webConsoleToken',
      'config.webConsolePublicUrl',
    ]),
    renderConsoleFieldSection('网络与分页', '控制台监听地址、端口冲突处理，以及列表分页规模。', [
      'config.webConsoleHost',
      'config.webConsolePort',
      'config.webConsolePortAutoIncrement',
      'config.webConsoleBackgroundSourceUrl',
      'config.webConsolePageSize',
      'config.webConsoleMaxPageSize',
    ]),
    renderConsoleFieldSection('日志与展示', '控制日志是否暴露、敏感信息是否脱敏，以及详情页展示上限。', [
      'config.webConsoleExposeLogs',
      'config.webConsoleMaskSensitiveConfig',
      'config.webConsoleLogTailLength',
      'config.webConsoleProfileRecentMessagesLimit',
      'config.webConsoleAffinityHistoryLimit',
    ]),
    renderConsoleFieldSection('API 超时', '常用接口的请求超时时间。优先先调这里，再决定是否补保底文案。', [
      'ai.timeout',
      'ai.imageConfig.timeout',
      'imageMonitor.analysisTimeoutMs',
      'coreConfig.tools.search.timeoutMs',
      'coreConfig.tools.webAgent.timeoutMs',
      'coreConfig.tools.webAgent.maxDownloadBytes',
    ]),
    renderConsoleFieldSection('群聊网页 Agent', '群聊 AI 已经可以按需搜索和读取网页；开启增强后，只有用户明确要求时才允许下载并发送公网文件。', [
      'coreConfig.tools.webAgent.enabled',
      'coreConfig.tools.webAgent.allowDownloads',
    ]),
    renderConsoleFieldSection('API 保底文案', '接口失败或超时后的兜底文案。图像生成支持回退到 AI 通用保底，图片监控留空则保持静默。', [
      'ai.imageConfig.fallbackReply',
      'ai.imageConfig.fallbackTimeoutReply',
      'imageMonitor.fallbackReply',
      'imageMonitor.fallbackTimeoutReply',
    ]),
  ].filter(Boolean);

  document.getElementById('plugin-settings-console-box').innerHTML = sections.join('');
  const consoleMetaChips = [
    { label: runtime.runtimeRunning ? '运行状态：已运行' : '运行状态：未运行', tone: runtime.runtimeRunning ? 'success' : 'warning' },
    { label: '鉴权：必须登录', tone: 'success' },
    { label: runtime.runtimeLoginConfigured ? '口令：已设置' : '口令：未设置', tone: runtime.runtimeLoginConfigured ? 'success' : 'warning' },
    { label: '分组：6 类', tone: 'info' },
  ];
  if (!runtime.webConsoleReadOnly) {
    consoleMetaChips.splice(
      1,
      0,
      { label: `主机：${runtime.runtimeHost || runtime.webConsoleHost || '0.0.0.0'}` },
      { label: `端口：${runtime.runtimePort || runtime.webConsolePort || '未设置'}`, tone: 'info' },
    );
  }
  document.getElementById('plugin-settings-console-meta').innerHTML = renderPanelMetaChips(consoleMetaChips);
}
