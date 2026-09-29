function renderConsoleSection() {
  const runtime = pluginSettingsState.editableConfig?.webConsole || {};
  const itemMap = new Map((pluginSettingsState.payload?.items || []).map(item => [item.field, item]));
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

  // 外观主题面板已移除：主题模式/配色/壁纸统一走顶栏的主题设置抽屉，避免两处重复

  const sections = [
    runtimeSection,
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
