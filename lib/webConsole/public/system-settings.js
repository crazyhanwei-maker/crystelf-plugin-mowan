// 系统设置页：配置备份/恢复 + 本地控制台设置。
// 控制台设置复用插件设置的渲染层（plugin-settings-render/console-render），
// 保存走 /api/plugin-settings/save（按字段合并，只提交本页渲染出的字段）。
(function () {
  const shared = window.CrystelfConfigBackup || {};
  const request = window.CrystelfRequest || {};
  let modalResolver = null;

  // renderField / renderFieldHead 等复用函数按全局名调用 escapeHtml（auth.js 只挂在 CrystelfUi 上）
  function escapeHtml(value) {
    const text = String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '');
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  window.escapeHtml = escapeHtml;

  function openModal(title, content, { confirmText = '确认', cancelText = '取消', showCancel = true, html = false } = {}) {
    const mask = document.getElementById('modal-mask');
    document.getElementById('modal-title').textContent = title;
    const modalContent = document.getElementById('modal-content');
    if (html) {
      modalContent.innerHTML = content;
    } else {
      modalContent.textContent = content;
    }
    document.getElementById('modal-confirm-btn').textContent = confirmText;
    const cancelBtn = document.getElementById('modal-cancel-btn');
    cancelBtn.textContent = cancelText;
    cancelBtn.classList.toggle('hidden', !showCancel);
    mask.classList.remove('hidden');
    return new Promise(resolve => {
      modalResolver = resolve;
    });
  }

  function closeModal(result) {
    document.getElementById('modal-mask').classList.add('hidden');
    if (modalResolver) {
      const resolve = modalResolver;
      modalResolver = null;
      resolve(result);
    }
  }

  document.getElementById('modal-cancel-btn').addEventListener('click', () => closeModal(false));
  document.getElementById('modal-confirm-btn').addEventListener('click', () => closeModal(true));
  document.getElementById('modal-mask').addEventListener('click', event => {
    if (event.target === event.currentTarget) {
      closeModal(false);
    }
  });

  // 恢复预览中的 全选/全不选（事件委托，弹窗内容为动态 HTML）
  document.getElementById('modal-content').addEventListener('click', event => {
    const mode = event.target.getAttribute?.('data-restore-select');
    if (!mode) return;
    document.querySelectorAll('[data-restore-file]').forEach(box => {
      box.checked = mode !== 'none';
    });
  });

  // ===== 配置备份与恢复 =====
  document.getElementById('sys-backup-btn').addEventListener('click', () => {
    shared
      .downloadConfigBackup()
      .then(() => openModal('备份完成', '配置备份已导出。', { showCancel: false }))
      .catch(error => openModal('备份失败', error.message, { showCancel: false }));
  });

  document.getElementById('sys-restore-btn').addEventListener('click', async () => {
    const confirmed = await openModal('恢复配置', '恢复备份会覆盖当前设置，确认继续？', { confirmText: '确认恢复', cancelText: '取消', showCancel: true });
    if (!confirmed) return;
    document.getElementById('sys-restore-input').click();
  });

  document.getElementById('sys-restore-input').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const { parsed, preview } = await shared.previewRestoreConfigBackup(file);
      const confirmed = await openModal('恢复预览', shared.renderRestorePreviewHtml(preview), { confirmText: '恢复所选项', cancelText: '取消', showCancel: true, html: true });
      if (!confirmed) {
        event.target.value = '';
        return;
      }
      const selectedFiles = Array.from(document.querySelectorAll('[data-restore-file]:checked'))
        .map(input => input.getAttribute('data-restore-file'))
        .filter(Boolean);
      const result = await shared.postJson('/api/config-restore', { ...parsed, selectedFiles });
      await openModal('恢复完成', `已恢复 ${result.count || 0} 个键：${(result.restoredKeys || []).join(', ')}`, { showCancel: false });
      event.target.value = '';
    } catch (error) {
      await openModal('恢复失败', error.message, { showCancel: false });
      event.target.value = '';
    }
  });

  // ===== 本地控制台设置 =====
  // 渲染风格对齐开源 UI（artd.pro / Element Plus）：左标签右控件的设置行，细线分隔
  const consoleBox = document.getElementById('plugin-settings-console-box');
  const saveStatus = document.getElementById('sys-console-save-status');

  const CONSOLE_FIELD_GROUPS = [
    {
      title: '访问与安全',
      description: '控制台是否启用、是否只读，以及登录口令等安全项。控制台网页始终要求登录。',
      fields: ['config.webConsole', 'config.webConsoleReadOnly', 'config.webConsoleToken', 'config.webConsolePublicUrl'],
    },
    {
      title: '网络与分页',
      description: '控制台监听地址、端口冲突处理，以及列表分页规模。',
      fields: ['config.webConsoleHost', 'config.webConsolePort', 'config.webConsolePortAutoIncrement', 'config.webConsoleBackgroundSourceUrl', 'config.webConsolePageSize', 'config.webConsoleMaxPageSize'],
    },
    {
      title: '日志与展示',
      description: '控制日志是否暴露、敏感信息是否脱敏，以及详情页展示上限。',
      fields: ['config.webConsoleExposeLogs', 'config.webConsoleMaskSensitiveConfig', 'config.webConsoleLogTailLength', 'config.webConsoleProfileRecentMessagesLimit', 'config.webConsoleAffinityHistoryLimit'],
    },
    {
      title: 'API 超时',
      description: '常用接口的请求超时时间。优先先调这里，再决定是否补保底文案。',
      fields: ['ai.timeout', 'ai.imageConfig.timeout', 'imageMonitor.analysisTimeoutMs', 'coreConfig.tools.search.timeoutMs', 'coreConfig.tools.webAgent.timeoutMs', 'coreConfig.tools.webAgent.maxDownloadBytes'],
    },
    {
      title: '群聊网页 Agent',
      description: '群聊 AI 已经可以按需搜索和读取网页；开启增强后，只有用户明确要求时才允许下载并发送公网文件。',
      fields: ['coreConfig.tools.webAgent.enabled', 'coreConfig.tools.webAgent.allowDownloads'],
    },
    {
      title: 'API 保底文案',
      description: '接口失败或超时后的兜底文案。图像生成支持回退到 AI 通用保底，图片监控留空则保持静默。',
      fields: ['ai.imageConfig.fallbackReply', 'ai.imageConfig.fallbackTimeoutReply', 'imageMonitor.fallbackReply', 'imageMonitor.fallbackTimeoutReply'],
    },
    {
      title: '自动更新',
      description: '插件维护项：是否自动更新插件，以及 RSS 订阅数量上限。',
      fields: ['config.autoUpdate', 'config.maxFeed'],
    },
  ];

  function renderConsoleFieldControl(item) {
    const value = pluginSettingsState.draft[item.field];
    const props = item.componentProps || {};
    const fieldAttr = `data-field="${escapeHtml(item.field)}"`;
    const placeholder = props.placeholder ? ` placeholder="${escapeHtml(props.placeholder)}"` : '';
    switch (item.component) {
      case 'Switch':
        return `<button type="button" class="plugin-settings-switch ${value ? '' : 'off'}" data-switch-field="${escapeHtml(item.field)}" aria-label="${escapeHtml(item.label)}"></button>`;
      case 'InputPassword':
        return `<input type="password" ${fieldAttr} value="${escapeHtml(value ?? '')}" autocomplete="new-password"${placeholder} />`;
      case 'InputNumber':
        return `<input type="number" ${fieldAttr} value="${escapeHtml(value ?? '')}"${placeholder} />`;
      case 'InputTextArea':
        return `<textarea ${fieldAttr} rows="3"${placeholder}>${escapeHtml(value ?? '')}</textarea>`;
      default:
        return `<input type="text" ${fieldAttr} value="${escapeHtml(value ?? '')}"${placeholder} />`;
    }
  }

  function renderConsoleFieldRow(item) {
    if (!item) return '';
    const isBlock = item.component === 'InputTextArea';
    const label = `
      <div class="console-settings-item-text">
        <span class="console-settings-item-label">${escapeHtml(item.label)}</span>
        ${item.bottomHelpMessage ? `<div class="setting-help">${escapeHtml(item.bottomHelpMessage)}</div>` : ''}
      </div>
    `;
    return `
      <div class="console-settings-item${isBlock ? ' console-settings-item-block' : ''}">
        ${label}
        <div class="console-settings-item-control">${renderConsoleFieldControl(item)}</div>
      </div>
    `;
  }

  function renderConsoleSettings() {
    const itemMap = new Map((pluginSettingsState.payload?.items || []).map(item => [item.field, item]));
    // 运行状态面板已移除：能打开本页即代表控制台在运行
    const groupSections = CONSOLE_FIELD_GROUPS.map(group => {
      const rows = group.fields.map(field => renderConsoleFieldRow(itemMap.get(field))).join('');
      return `
        <section class="panel console-settings-group">
          <div class="section-head">
            <div>
              <h2>${escapeHtml(group.title)}</h2>
              <div class="setting-help">${escapeHtml(group.description)}</div>
            </div>
          </div>
          <div class="console-settings-list">${rows}</div>
        </section>
      `;
    }).join('');
    consoleBox.innerHTML = groupSections;
  }

  async function loadConsoleSettings() {
    const payload = await request.fetchJson('/api/plugin-settings');
    pluginSettingsState.payload = payload;
    pluginSettingsState.draft = {};
    for (const item of payload?.items || []) {
      pluginSettingsState.draft[item.field] = item.value;
    }
    renderConsoleSettings();
  }

  function setSaveStatus(text) {
    if (saveStatus) saveStatus.textContent = text || '';
  }

  // 收集本页实际渲染出的字段（只提交这些，避免覆盖其他页面的未保存草稿）
  function collectRenderedConsoleFields() {
    const fields = new Set();
    consoleBox?.querySelectorAll('[data-field], [data-switch-field]').forEach(control => {
      const field = control.dataset.field || control.dataset.switchField || '';
      if (field) fields.add(field);
    });
    return [...fields];
  }

  document.getElementById('sys-console-save-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('sys-console-save-btn');
    saveBtn.disabled = true;
    setSaveStatus('正在保存...');
    try {
      const data = {};
      for (const field of collectRenderedConsoleFields()) {
        data[field] = pluginSettingsState.draft[field];
      }
      const result = await request.postJson('/api/plugin-settings/save', { data });
      pluginSettingsState.payload = result.data;
      pluginSettingsState.draft = {};
      for (const item of result.data?.items || []) {
        pluginSettingsState.draft[item.field] = item.value;
      }
      renderConsoleSettings();
      setSaveStatus('保存成功，部分配置可能需要重启控制台后生效');
    } catch (error) {
      setSaveStatus(`保存失败：${error.message || error}`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  // 字段编辑：开关点击切换，输入框实时写入草稿，下拉选择后重渲染（与插件设置页行为一致）
  consoleBox?.addEventListener('click', event => {
    const switchBtn = event.target.closest?.('[data-switch-field]');
    if (!switchBtn) return;
    const field = switchBtn.dataset.switchField;
    pluginSettingsState.draft[field] = !pluginSettingsState.draft[field];
    renderConsoleSettings();
  });

  consoleBox?.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.dataset.field) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      pluginSettingsState.draft[target.dataset.field] = target.value;
    }
  });

  consoleBox?.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.dataset.field) return;
    pluginSettingsState.draft[target.dataset.field] = target.multiple
      ? Array.from(target.selectedOptions).map(option => option.value)
      : target.value;
    renderConsoleSettings();
  });

  // 外观主题控件（原插件设置页未接线的功能，这里补齐）
  document.addEventListener('click', async event => {
    const modeBtn = event.target.closest?.('[data-console-theme-mode]');
    if (modeBtn) {
      window.CrystelfTheme?.setMode?.(modeBtn.dataset.consoleThemeMode);
      renderConsoleSettings();
      return;
    }
    const accentBtn = event.target.closest?.('[data-console-theme-accent]');
    if (accentBtn) {
      window.CrystelfTheme?.setAccent?.(accentBtn.dataset.consoleThemeAccent);
      renderConsoleSettings();
      return;
    }
    const wallpaperBtn = event.target.closest?.('[data-console-background-refresh]');
    if (wallpaperBtn) {
      if (wallpaperBtn.disabled) return;
      wallpaperBtn.disabled = true;
      const original = wallpaperBtn.textContent;
      wallpaperBtn.textContent = '切换中...';
      try {
        await window.CrystelfTheme?.refreshBackground?.();
        wallpaperBtn.textContent = '已切换';
      } catch {
        wallpaperBtn.textContent = '切换失败';
      }
      window.setTimeout(() => {
        wallpaperBtn.textContent = original;
        wallpaperBtn.disabled = false;
      }, 1200);
      return;
    }
    const cacheBtn = event.target.closest?.('[data-console-cache-action="clear"]');
    if (cacheBtn) {
      if (cacheBtn.disabled) return;
      cacheBtn.disabled = true;
      try {
        await window.CrystelfLocalCache?.clear?.();
        renderConsoleSettings();
      } finally {
        cacheBtn.disabled = false;
      }
    }
  });

  // 折叠面板：点击标题/头部切换收起态（配置变更历史默认收起）
  document.addEventListener('click', event => {
    const head = event.target.closest('.collapsible-panel > .section-head, .collapsible-panel > h2.collapsible-head');
    if (!head) return;
    if (event.target.closest('button, a, input, select, textarea')) return;
    head.closest('.collapsible-panel')?.classList.toggle('collapsed');
  });

  // 配置变更历史：拉取 / 刷新 / 回滚（渲染函数来自 dashboard-config.js）
  const configHistoryBox = document.getElementById('config-history-box');
  if (configHistoryBox && typeof refreshConfigHistoryPanel === 'function') {
    refreshConfigHistoryPanel().catch(error => {
      configHistoryBox.innerHTML = `<div class="setting-status tone-error">配置变更历史加载失败：${escapeHtml(error.message || error)}</div>`;
    });
    document.getElementById('refresh-config-history-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('refresh-config-history-btn');
      if (btn) btn.disabled = true;
      try {
        await refreshConfigHistoryPanel();
      } catch (error) {
        openModal('刷新失败', error.message || String(error), { showCancel: false });
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    document.addEventListener('click', async event => {
      const rollbackBtn = event.target.closest?.('[data-config-history-rollback]');
      if (!rollbackBtn) return;
      const historyId = rollbackBtn.dataset.configHistoryRollback || '';
      const confirmed = await openModal(
        '回滚配置',
        '确认回滚这次配置变更？回滚会把相关配置文件恢复到该次保存之前的状态，并写入一条新的回滚记录。',
        { confirmText: '确认回滚', cancelText: '取消', showCancel: true },
      );
      if (!confirmed) return;
      try {
        const result = await postJson('/api/config-history/rollback', { id: historyId });
        await refreshConfigHistoryPanel();
        openModal('回滚完成', `已恢复 ${result.count || 0} 个配置文件：${(result.restoredKeys || []).join('、')}`, { showCancel: false });
      } catch (error) {
        openModal('回滚失败', error.message || String(error), { showCancel: false });
      }
    });
  }

  loadConsoleSettings().catch(error => {
    if (consoleBox) {
      consoleBox.innerHTML = `<div class="setting-status tone-error">控制台设置加载失败：${escapeHtml(error.message || error)}</div>`;
    }
  });
})();
