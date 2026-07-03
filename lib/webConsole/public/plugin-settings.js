function buildHeaders(extra = {}) {
  return { ...extra };
}

function setPluginSettingsRisk(message = '', hidden = false) {
  const box = document.getElementById('plugin-settings-risk');
  if (!box) return;
  box.textContent = String(message || '');
  box.classList.toggle('hidden', hidden || !message);
}

async function fetchPluginSettingsAuthStatus() {
  const auth = window.CrystelfAuth;
  if (!auth?.fetchAuthStatus) {
    return pluginSettingsState.authStatus;
  }
  try {
    return await auth.fetchAuthStatus();
  } catch {
    return auth.status || pluginSettingsState.authStatus;
  }
}

function buildFallbackSkillsEditorResponse(reason = '') {
  return {
    data: {
      supported: false,
      reason: String(reason || '').trim(),
      effectiveConfig: {},
      runtimeConfig: {},
      defaultConfig: {},
      stats: {},
    },
  };
}

async function fetchSkillsEditorConfigForAuth(authStatus) {
  if (authStatus?.bootstrapMode === true) {
    return buildFallbackSkillsEditorResponse('初始化模式下暂不提供原始工具配置编辑。');
  }
  try {
    return await fetchJson('/api/plugin-settings/skills-config');
  } catch (error) {
    if (String(error?.message || '').includes('/api/plugin-settings/skills-config -> 404')) {
      return buildFallbackSkillsEditorResponse('当前控制台后端版本不支持原始工具配置编辑，请更新控制台后端后再使用。');
    }
    throw error;
  }
}

async function fetchPrivateAiSafetyForAuth(authStatus) {
  if (authStatus?.bootstrapMode === true) {
    return { data: null };
  }
  try {
    return await fetchJson('/api/plugin-settings/private-ai-safety');
  } catch (error) {
    if (String(error?.message || '').includes('/api/plugin-settings/private-ai-safety -> 404')) {
      return { data: null };
    }
    throw error;
  }
}

function applyBootstrapModeUi() {
  const bootstrapMode = pluginSettingsState.authStatus?.bootstrapMode === true;
  const saveButton = document.getElementById('plugin-settings-save-btn');
  const meta = document.getElementById('plugin-settings-meta');
  const summary = document.getElementById('plugin-settings-summary');
  const consoleBox = document.getElementById('plugin-settings-console-box');
  const skillsBox = document.getElementById('plugin-settings-skills-box');
  const privateSafetyBox = document.getElementById('plugin-settings-private-safety-box');

  document.querySelectorAll('[data-plugin-top-tab]').forEach(button => {
    button.disabled = bootstrapMode && button.dataset.pluginTopTab !== 'plugin-settings-console-panel';
  });

  consoleBox?.querySelectorAll('[data-field], [data-switch-field]').forEach(control => {
    const field = control.dataset.field || control.dataset.switchField || '';
    const tokenOnly = field === 'config.webConsoleToken';
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      control.readOnly = bootstrapMode && !tokenOnly;
      control.disabled = false;
      return;
    }
    if (control instanceof HTMLSelectElement || control instanceof HTMLButtonElement) {
      control.disabled = bootstrapMode && !tokenOnly;
    }
  });

  skillsBox?.querySelectorAll('[data-skills-field], [data-skills-global-toggle], [data-skills-all-toggle], [data-skills-expand-all], [data-skills-preset], [data-skills-filter], [data-skills-search], [data-skills-search-clear], [data-skills-view-reset], [data-skill-toggle], [data-skill-expand], [data-skill-tool-toggle], [data-skills-editor-load], [data-skills-editor-format], [data-skills-editor-validate], [data-skills-editor-save], [data-skills-editor-reset], [data-skills-editor]').forEach(control => {
    if (control instanceof HTMLInputElement || control instanceof HTMLButtonElement) {
      control.disabled = bootstrapMode;
    }
    if (control instanceof HTMLTextAreaElement) {
      control.readOnly = bootstrapMode;
    }
  });
  privateSafetyBox?.querySelectorAll('button, input').forEach(control => {
    control.disabled = bootstrapMode;
  });

  if (saveButton) {
    saveButton.textContent = bootstrapMode ? '保存并完成初始化' : '保存插件设置';
  }

  if (meta) {
    meta.textContent = bootstrapMode
      ? '当前未检测到登录口令。正常启动会自动生成随机口令并输出在日志；这里也可手动设置登录口令。'
      : '基于锅巴配置项渲染，统一管理插件配置、控制台与可选工具。';
  }

  if (bootstrapMode) {
    pluginSettingsState.activeTopTab = 'plugin-settings-console-panel';
    switchPluginTopTab('plugin-settings-console-panel');
    if (summary) {
      summary.textContent = '控制台口令：可手动设置或查看启动日志';
    }
    setPluginSettingsRisk('未检测到登录口令。建议查看启动日志中的自动生成口令；也可以在“控制台设置”中填写“控制台登录口令”，保存后将跳转到登录页。');
    window.requestAnimationFrame(() => {
      document.querySelector('[data-field="config.webConsoleToken"]')?.focus();
    });
    return;
  }

  if (summary && summary.textContent === '控制台口令：可手动设置或查看启动日志') {
    summary.textContent = '正在加载设置项...';
  }
}

async function fetchJson(url) {
  if (window.CrystelfRequest?.fetchJson) {
    return await window.CrystelfRequest.fetchJson(url);
  }
  const response = await fetch(url, { cache: 'no-store', headers: buildHeaders() });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return await response.json();
}

async function postJson(url, payload) {
  if (window.CrystelfRequest?.postJson) {
    return await window.CrystelfRequest.postJson(url, payload);
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(data.error || `${url} -> ${response.status}`);
  return data;
}


function loadFeatureManageHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FEATURE_MANAGE_HISTORY_STORAGE_KEY) || '[]');
    pluginSettingsState.featureManageHistory = Array.isArray(parsed) ? parsed : [];
  } catch {
    pluginSettingsState.featureManageHistory = [];
  }
}

function persistFeatureManageHistory() {
  localStorage.setItem(FEATURE_MANAGE_HISTORY_STORAGE_KEY, JSON.stringify(pluginSettingsState.featureManageHistory.slice(0, 10)));
}

function pushFeatureManageHistory(action, message, success = true) {
  pluginSettingsState.featureManageHistory.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    message,
    success,
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  });
  pluginSettingsState.featureManageHistory = pluginSettingsState.featureManageHistory.slice(0, 10);
  persistFeatureManageHistory();
}


function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}


function getVisibleItems() {
  const items = pluginSettingsState.payload?.items || [];
  return items.filter(item => item.category === pluginSettingsState.activeCategory && item.group === pluginSettingsState.activeGroup && isMatchedBySearch(item));
}

function isAiKnowledgeField(field = '') {
  return ['ai.knowledgeBaseEnabled', 'ai.knowledgeTopK', 'ai.knowledgeBase'].includes(field);
}

function switchPluginTopTab(tabId) {
  if (pluginSettingsState.authStatus?.bootstrapMode === true && tabId !== 'plugin-settings-console-panel') {
    tabId = 'plugin-settings-console-panel';
  }
  pluginSettingsState.activeTopTab = tabId;
  document.querySelectorAll('[data-plugin-top-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.pluginTopTab === tabId);
  });
  document.querySelectorAll('#plugin-settings-config-panel, #plugin-settings-features-panel, #plugin-settings-console-panel, #plugin-settings-skills-panel, #plugin-settings-private-safety-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== tabId);
  });
  document.getElementById('plugin-settings-config-nav')?.classList.toggle('hidden', tabId !== 'plugin-settings-config-panel');
  const summary = document.getElementById('plugin-settings-summary');
  if (summary && pluginSettingsState.authStatus?.bootstrapMode !== true) {
    const summaryMap = {
      'plugin-settings-config-panel': `当前分组：${pluginSettingsState.activeCategory || '-'} / ${pluginSettingsState.activeGroup || '-'}`,
      'plugin-settings-features-panel': '正在查看：功能状态',
      'plugin-settings-console-panel': '正在查看：控制台设置',
      'plugin-settings-skills-panel': '正在查看：工具设置',
      'plugin-settings-private-safety-panel': '正在查看：私聊安全',
    };
    summary.textContent = summaryMap[tabId] || '正在加载设置项...';
  }
}

function syncNavCollapsedState() {
  document.getElementById('plugin-settings-shell')?.classList.toggle('nav-collapsed', pluginSettingsState.navCollapsed);
  const button = document.getElementById('plugin-settings-nav-toggle-btn');
  if (button) {
    button.textContent = pluginSettingsState.navCollapsed ? '展开导航' : '收起导航';
  }
}

function clonePayload(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function formatPrettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function syncDraftFromPayload() {
  const next = {};
  for (const item of pluginSettingsState.payload?.items || []) {
    next[item.field] = item.value;
  }
  pluginSettingsState.draft = next;
}

async function refreshPluginSettings() {
  const authStatus = await fetchPluginSettingsAuthStatus();
  const [payload, overview, editableConfig, skillsEditorResponse, privateAiSafetyResponse] = await Promise.all([
    fetchJson('/api/plugin-settings'),
    fetchJson('/api/overview'),
    fetchJson('/api/config/editable'),
    fetchSkillsEditorConfigForAuth(authStatus),
    fetchPrivateAiSafetyForAuth(authStatus),
  ]);
  pluginSettingsState.payload = payload;
  pluginSettingsState.overview = overview;
  pluginSettingsState.editableConfig = editableConfig;
  pluginSettingsState.authStatus = authStatus || pluginSettingsState.authStatus;
  pluginSettingsState.skillsEditorPayload = skillsEditorResponse?.data || {};
  pluginSettingsState.privateAiSafety = privateAiSafetyResponse?.data || null;
  if (!pluginSettingsState.activeCategory && payload.categories?.[0]) {
    pluginSettingsState.activeCategory = payload.categories[0].key;
  }
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  syncSkillsEditorFromSource(pluginSettingsState.skillsEditorSource || 'effective');
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  renderSkillsSection();
  renderPrivateAiSafetySection();
  switchPluginTopTab(pluginSettingsState.activeTopTab);
  syncNavCollapsedState();
  applyBootstrapModeUi();
}

function buildPluginConfigPrecheckMessage(precheck) {
  const warnings = Array.isArray(precheck?.warnings) ? precheck.warnings : [];
  const changes = Array.isArray(precheck?.changes) ? precheck.changes : [];
  const summary = precheck?.summary || {};
  const lines = [
    '插件配置保存预检已完成。',
    `警告 ${Number(summary.warningCount || warnings.length)} 项，变更 ${Number(summary.changeCount || changes.length)} 项。`,
  ];

  if (warnings.length > 0) {
    lines.push('', '警告：');
    warnings.slice(0, 8).forEach(item => lines.push(`- ${item}`));
    if (warnings.length > 8) lines.push(`- 还有 ${warnings.length - 8} 项警告未展示`);
  }

  if (changes.length > 0) {
    lines.push('', '将保存的变更：');
    changes.slice(0, 10).forEach(item => {
      lines.push(`- ${item.label}: ${item.before} -> ${item.after}`);
    });
    if (precheck?.truncatedChanges || changes.length > 10) {
      lines.push('- 还有更多变更未展示');
    }
  }

  lines.push('', '确认继续保存？');
  return lines.join('\n');
}

async function confirmPluginSettingsPrecheck(payload) {
  const precheck = await postJson('/api/plugin-settings/precheck', payload);
  const errors = Array.isArray(precheck?.errors) ? precheck.errors : [];
  if (precheck?.ok === false) {
    setPluginSettingsRisk(`保存预检未通过：${errors.join('；') || '存在配置错误'}`);
    return false;
  }

  const warningCount = Number(precheck?.summary?.warningCount || 0);
  const changeCount = Number(precheck?.summary?.changeCount || 0);
  if (warningCount > 0 || changeCount > 0) {
    const confirmed = await webConsoleConfirm(buildPluginConfigPrecheckMessage(precheck), {
      title: '保存插件配置预检',
      confirmText: '继续保存',
      cancelText: '取消',
    });
    if (!confirmed) {
      setPluginSettingsRisk('已取消保存，配置未写入。');
      return false;
    }
  }
  return true;
}

async function savePluginSettings() {
  const payload = { data: pluginSettingsState.draft, skills: pluginSettingsState.skillsDraft };
  if (!await confirmPluginSettingsPrecheck(payload)) {
    return;
  }
  const result = await postJson('/api/plugin-settings/save', payload);
  pluginSettingsState.payload = result.data;
  const authStatus = await fetchPluginSettingsAuthStatus();
  const [editableConfig, skillsEditorResponse] = await Promise.all([
    fetchJson('/api/config/editable'),
    fetchSkillsEditorConfigForAuth(authStatus),
  ]);
  pluginSettingsState.editableConfig = editableConfig;
  pluginSettingsState.authStatus = authStatus || pluginSettingsState.authStatus;
  pluginSettingsState.skillsEditorPayload = skillsEditorResponse?.data || pluginSettingsState.skillsEditorPayload;
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  syncSkillsEditorFromSource(pluginSettingsState.skillsEditorSource || 'effective');
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  renderSkillsSection();
  applyBootstrapModeUi();
  document.getElementById('plugin-settings-summary').textContent = result.data?.bootstrapCompleted
    ? '控制台登录口令已保存，正在跳转到登录页...'
    : '保存成功，部分配置可能需要重启后完全生效';
  if (result.data?.bootstrapCompleted) {
    setPluginSettingsRisk('控制台登录口令已保存，请使用刚设置的口令重新登录。');
    window.setTimeout(() => {
      window.location.href = `/login.html?redirect=${encodeURIComponent('/plugin-settings.html')}`;
    }, 500);
  } else {
    setPluginSettingsRisk('', true);
  }
}

async function manageFeatureToggles(action) {
  const result = await postJson('/api/plugin-settings/feature-manage', { action });
  pluginSettingsState.payload = result.settings;
  pluginSettingsState.overview = result.overview;
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  pluginSettingsState.featureManageStatus = result.data?.message || '功能开关操作已完成';
  if (result.data?.exportText) {
    try {
      await navigator.clipboard.writeText(result.data.exportText);
      pluginSettingsState.featureManageStatus += '，已复制到剪贴板';
    } catch {
      pluginSettingsState.featureManageStatus += '，复制到剪贴板失败，可直接使用下载文件';
    }
  }
  pushFeatureManageHistory(action, pluginSettingsState.featureManageStatus, true);
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  renderSkillsSection();
  return result;
}

async function validateSkillsEditorConfig() {
  const config = getParsedSkillsEditorConfig();
  const result = await postJson('/api/plugin-settings/skills-config/validate', {
    config,
    source: pluginSettingsState.skillsEditorSource || 'effective',
  });
  pluginSettingsState.skillsEditorText = formatPrettyJson(result.data?.config || config);
  pluginSettingsState.skillsEditorStatus = `格式检查通过：${Number(result.data?.summary?.definitionCount || 0)} 个工具组，${Number(result.data?.summary?.toolCount || 0)} 个工具。`;
  renderSkillsSection();
}

async function saveSkillsEditorConfig() {
  const config = getParsedSkillsEditorConfig();
  pluginSettingsState.skillsEditorStatus = '正在保存原始工具配置...';
  renderSkillsSection();
  const result = await postJson('/api/plugin-settings/skills-config/save', {
    config,
    source: pluginSettingsState.skillsEditorSource || 'effective',
  });
  pluginSettingsState.payload = result.settings || pluginSettingsState.payload;
  pluginSettingsState.skillsEditorPayload = result.data || pluginSettingsState.skillsEditorPayload;
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  syncSkillsEditorFromSource(pluginSettingsState.skillsEditorSource || 'effective');
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  pluginSettingsState.skillsEditorStatus = '原始工具配置已保存，后续新会话会按最新配置加载。';
  renderSkillsSection();
  document.getElementById('plugin-settings-summary').textContent = '工具原始配置保存成功';
}

async function resetSkillsEditorConfig() {
  pluginSettingsState.skillsEditorStatus = '正在清空运行时工具配置覆盖...';
  renderSkillsSection();
  const result = await postJson('/api/plugin-settings/skills-config/reset', {});
  pluginSettingsState.payload = result.settings || pluginSettingsState.payload;
  pluginSettingsState.skillsEditorPayload = result.data || pluginSettingsState.skillsEditorPayload;
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  syncSkillsEditorFromSource('effective');
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  pluginSettingsState.skillsEditorStatus = '已清空运行时工具配置覆盖，当前已恢复默认配置视图。';
  renderSkillsSection();
  document.getElementById('plugin-settings-summary').textContent = '工具配置已恢复默认';
}

async function loadFeatureHelpPreview() {
  pluginSettingsState.helpPreviewStatus = '正在生成帮助图预览...';
  renderFeatureSection();
  const result = await fetchJson('/api/plugin-settings/help-preview');
  pluginSettingsState.helpPreviewDataUrl = result.data?.dataUrl || '';
  pluginSettingsState.helpPreviewStatus = pluginSettingsState.helpPreviewDataUrl ? '帮助图预览已更新。' : '帮助图预览生成失败。';
  renderFeatureSection();
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(filename, dataUrl) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
