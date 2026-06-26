function renderFeatureSection() {
  const data = pluginSettingsState.overview || {};
  const runtime = data.webConsoleRuntime || {};
  const backup = data.featureToggleBackup || {};
  const descriptions = {
    ai: '群聊 AI 主功能',
    music: '点歌与音乐能力',
    rss: 'RSS 推送能力',
    auth: '入群验证能力',
    welcome: '入群欢迎能力',
    groupManagement: '群消息风控与黑白名单',
    groupTitle: '群头衔申请能力',
    poke: '戳一戳能力',
    status: '群内运行状态查询',
    dependencyRepair: 'QQ 内依赖检查、确认修复与修复状态命令',
    webConsole: '本地控制台入口',
    affinity: '好感度系统',
    userProfile: '用户画像系统',
    tts: '语音工具能力',
  };
  const actionPanel = `
    <div class="plugin-settings-feature-toolbox">
      <div class="setting-item plugin-settings-feature-panel-card">
        <div class="plugin-settings-feature-panel-head">
          <div class="kv-label">功能开关工具面板</div>
          <div class="setting-status">按操作类型分区，避免把危险操作、备份操作和预览操作混在一起。</div>
        </div>
        <div class="plugin-settings-feature-action-groups">
          <div class="plugin-settings-feature-action-group">
            <div class="plugin-settings-feature-action-title">开关操作</div>
            <div class="actions plugin-settings-feature-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-feature-manage="enable_all">全部开启</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-danger" data-feature-manage="disable_all">全部关闭</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-warning" data-feature-manage="reset">重置默认</button>
            </div>
            <div class="setting-help">适合快速切换当前插件的整体启用状态，危险操作已保留确认提示。</div>
          </div>
          <div class="plugin-settings-feature-action-group">
            <div class="plugin-settings-feature-action-title">备份与导出</div>
            <div class="actions plugin-settings-feature-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="backup">备份</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="restore">恢复</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="export_current">导出当前</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="export_backup">导出备份</button>
            </div>
            <div class="setting-help">${escapeHtml(backup.hasBackup ? `当前备份时间：${backup.savedAt || '未知'}` : '当前还没有功能开关备份。')}</div>
          </div>
          <div class="plugin-settings-feature-action-group">
            <div class="plugin-settings-feature-action-title">帮助图预览</div>
            <div class="actions plugin-settings-feature-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-help-preview="1">预览帮助图</button>
              ${pluginSettingsState.helpPreviewDataUrl ? '<button type="button" data-feature-help-open="1">新窗口打开</button><button type="button" data-feature-help-download="1">下载 PNG</button>' : ''}
            </div>
            <div class="setting-help">${escapeHtml(pluginSettingsState.helpPreviewStatus || '可在后台生成最新管理员功能开关帮助图预览。')}</div>
          </div>
        </div>
        <div class="setting-help">${escapeHtml(pluginSettingsState.featureManageStatus || '这里提供网页后台的一键功能开关管理。')}</div>
      </div>
      <div class="setting-item plugin-settings-feature-panel-card">
        <div class="plugin-settings-feature-panel-head">
          <div class="kv-label">帮助图预览</div>
          <div class="setting-status">这里展示当前生成的管理员功能开关帮助图，可打开或下载。</div>
        </div>
        ${pluginSettingsState.helpPreviewDataUrl
          ? `<div class="plugin-settings-help-preview"><img src="${pluginSettingsState.helpPreviewDataUrl}" alt="帮助图预览" /></div>`
          : '<div class="plugin-settings-help-preview plugin-settings-help-preview-empty"><div class="setting-help">当前还没有生成帮助图预览，点击上方“预览帮助图”即可生成。</div></div>'}
      </div>
      <div class="setting-item plugin-settings-feature-panel-card">
        <div class="plugin-settings-feature-panel-head">
          <div class="kv-label">最近操作记录</div>
          <div class="setting-status">保留最近的功能开关操作结果，方便回看刚刚做了什么。</div>
        </div>
        <div class="plugin-settings-feature-history">
          ${pluginSettingsState.featureManageHistory.length > 0
            ? pluginSettingsState.featureManageHistory.map(item => `
              <div class="plugin-settings-feature-history-item ${item.success ? '' : 'tone-error'}">
                <div><strong>${escapeHtml(item.createdAt)}</strong> · ${escapeHtml(item.action)}</div>
                <div class="setting-help">${escapeHtml(item.message)}</div>
              </div>
            `).join('')
            : '<div class="setting-help">当前还没有操作记录。</div>'}
        </div>
      </div>
    </div>
  `;
  document.getElementById('plugin-settings-feature-list').innerHTML = actionPanel + Object.entries(data.features || {})
    .map(([key, enabled]) => `
      <div class="feature-toggle-card ${enabled ? '' : 'off'}">
        <div class="feature-toggle-head">
          <span class="feature-toggle-name">${escapeHtml(key)}</span>
          <span class="feature-toggle-state">${enabled ? '开启' : '关闭'}</span>
        </div>
        <div class="feature-toggle-desc">${escapeHtml(descriptions[key] || '功能开关')}</div>
        ${key === 'webConsole' ? `<div class="feature-toggle-source">运行状态：${runtime.running ? `已运行（${escapeHtml(runtime.url || '')}）` : '未运行或需重启后生效'}</div>` : ''}
      </div>
    `).join('');
  document.getElementById('plugin-settings-features-meta').innerHTML = renderPanelMetaChips([
    { label: `功能：${Object.keys(data.features || {}).length} 个`, tone: 'info' },
    { label: runtime.running ? '控制台：运行中' : '控制台：未运行', tone: runtime.running ? 'success' : 'warning' },
    { label: backup.hasBackup ? `备份：${backup.savedAt || '已存在'}` : '备份：暂无', tone: backup.hasBackup ? 'success' : 'warning' },
  ]);
}
