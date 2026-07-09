async function refreshTtsModelsList() {
  if (pluginSettingsState.ttsModelsRefreshing) return;
  pluginSettingsState.ttsModelsRefreshing = true;
  pluginSettingsState.ttsModelsRefreshStatus = '正在从远端拉取模型列表...';
  renderForm();
  try {
    const result = await postJson('/api/tts/models/refresh', {});
    if (result?.success) {
      pluginSettingsState.ttsModelsRefreshStatus = `刷新成功，共 ${result.count || 0} 个模型。请保存设置并重开本页，让“默认语音模型”下拉项更新。`;
      if (result.summary) {
        pluginSettingsState.draft['coreConfig.tools.tts.modelSummary'] = result.summary;
      }
    } else {
      pluginSettingsState.ttsModelsRefreshStatus = `刷新失败：${result?.error || '未知错误'}`;
    }
  } catch (error) {
    pluginSettingsState.ttsModelsRefreshStatus = `刷新失败：${error?.message || error}`;
  } finally {
    pluginSettingsState.ttsModelsRefreshing = false;
    renderForm();
  }
}

async function clearPluginSettingsLocalCache() {
  const cache = window.CrystelfLocalCache;
  const summary = cache?.getSummary?.() || { available: false, count: 0 };
  if (!summary.available) {
    setPluginSettingsRisk('当前浏览器不允许读取本机缓存。');
    renderConsoleSection();
    return;
  }
  if (summary.count <= 0) {
    setPluginSettingsRisk('当前浏览器没有检测到控制台本机缓存。');
    renderConsoleSection();
    return;
  }

  const labelText = summary.labels?.length
    ? `\n\n将清理：${summary.labels.slice(0, 8).join('、')}${summary.labels.length > 8 ? '等' : ''}`
    : '';
  const confirmed = await webConsoleConfirm(
    `将清理当前浏览器保存的 ${summary.count} 项控制台缓存（约 ${summary.totalBytesLabel}）。这不会修改服务器配置，也不会退出当前登录；刷新页面后会恢复默认视图。${labelText}`,
    { title: '清理本机缓存', confirmText: '清理缓存', cancelText: '取消' },
  );
  if (!confirmed) {
    return;
  }

  const result = cache.clear();
  pluginSettingsState.featureManageHistory = [];
  pluginSettingsState.knowledgeHistory = [];
  pluginSettingsState.skillsFilter = 'all';
  pluginSettingsState.skillsSearchKeyword = '';
  pluginSettingsState.skillsExpanded = {};
  pluginSettingsState.navCollapsed = false;
  syncNavCollapsedState();
  setPluginSettingsRisk(`已清理 ${result.removedCount} 项本机缓存${result.failedCount > 0 ? `，${result.failedCount} 项清理失败` : ''}。刷新页面后会恢复默认视图。`);
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  renderSkillsSection();
}

document.addEventListener('click', async event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.undoRecommendation) {
    const undo = pluginSettingsState.recommendationUndo;
    if (undo?.fields) {
      Object.entries(undo.fields).forEach(([field, value]) => {
        pluginSettingsState.draft[field] = value;
      });
      pluginSettingsState.recommendationStatus = undo.message || '已恢复推荐配置应用前的值';
      pluginSettingsState.recommendationUndo = null;
      renderForm();
      renderConsoleSection();
      return;
    }
  }
  if (target.dataset.applyGroupRecommendation) {
    const groupItems = getVisibleItems().filter(item => !isAiKnowledgeField(item.field));
    const previous = {};
    const appliedLabels = [];
    groupItems.forEach(item => {
      if (Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field)) {
        previous[item.field] = pluginSettingsState.draft[item.field];
        pluginSettingsState.draft[item.field] = FIELD_RECOMMENDATION_VALUES[item.field];
        appliedLabels.push(item.label);
      }
    });
    pluginSettingsState.recommendationUndo = {
      fields: previous,
      message: '已撤销本组推荐配置，恢复到应用前的值',
    };
    pluginSettingsState.recommendationStatus = appliedLabels.length > 0
      ? `已应用本组推荐配置：${appliedLabels.join('、')}`
      : '当前分组没有可应用的推荐配置';
    renderForm();
    renderConsoleSection();
    return;
  }
  if (target.dataset.applyRecommendation) {
    const field = target.dataset.applyRecommendation;
    if (Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, field)) {
      const item = (pluginSettingsState.payload?.items || []).find(entry => entry.field === field);
      pluginSettingsState.recommendationUndo = {
        fields: { [field]: pluginSettingsState.draft[field] },
        message: `已撤销推荐值：${item?.label || field}`,
      };
      pluginSettingsState.draft[field] = FIELD_RECOMMENDATION_VALUES[field];
      pluginSettingsState.recommendationStatus = `已应用推荐值：${item?.label || field}`;
      renderForm();
      renderConsoleSection();
      return;
    }
  }
  if (target.dataset.skillsGlobalToggle) {
    const field = target.dataset.skillsGlobalToggle;
    if (pluginSettingsState.skillsDraft && ['enabled', 'autoLoad'].includes(field)) {
      pluginSettingsState.skillsDraft[field] = !pluginSettingsState.skillsDraft[field];
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.skillsAllToggle) {
    if (pluginSettingsState.skillsDraft) {
      const enabled = target.dataset.skillsAllToggle === 'enable';
      pluginSettingsState.skillsDraft.definitions = (pluginSettingsState.skillsDraft.definitions || []).map(item => ({
        ...item,
        enabled,
        enabledToolCount: (Array.isArray(item.tools) ? item.tools : []).length,
        tools: (Array.isArray(item.tools) ? item.tools : []).map(tool => ({
          ...tool,
          enabled,
        })),
      }));
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.skillsExpandAll) {
    setSkillsExpandedByFilter(target.dataset.skillsExpandAll === 'expand');
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsPreset) {
    applySkillPreset(target.dataset.skillsPreset);
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsFilter) {
    pluginSettingsState.skillsFilter = normalizeSkillFilterValue(target.dataset.skillsFilter || 'all');
    persistSkillFilter();
    schedulePluginSettingsSkillsRender.cancel?.();
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsSearchClear) {
    pluginSettingsState.skillsSearchKeyword = '';
    persistSkillsSearchKeyword();
    schedulePluginSettingsSkillsRender.cancel?.();
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsViewReset) {
    resetSkillsViewState();
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsEditorLoad) {
    syncSkillsEditorFromSource(target.dataset.skillsEditorLoad || 'effective');
    pluginSettingsState.skillsEditorStatus = `已载入${pluginSettingsState.skillsEditorSource === 'runtime' ? '运行时覆盖' : pluginSettingsState.skillsEditorSource === 'default' ? '默认模板' : '当前生效配置'}。`;
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsEditorFormat) {
    try {
      pluginSettingsState.skillsEditorText = formatPrettyJson(getParsedSkillsEditorConfig());
      pluginSettingsState.skillsEditorStatus = '原始工具配置已整理。';
      renderSkillsSection();
    } catch (error) {
      pluginSettingsState.skillsEditorStatus = error.message;
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.skillsEditorValidate) {
    validateSkillsEditorConfig().catch(error => {
      pluginSettingsState.skillsEditorStatus = `校验失败：${error.message}`;
      renderSkillsSection();
    });
    return;
  }
  if (target.dataset.skillsEditorSave) {
    if (await webConsoleConfirm('确认要保存当前原始工具配置吗？这会直接覆盖运行中的工具配置。', { title: '保存原始工具配置' })) {
      saveSkillsEditorConfig().catch(error => {
        pluginSettingsState.skillsEditorStatus = `保存失败：${error.message}`;
        renderSkillsSection();
      });
    }
    return;
  }
  if (target.dataset.skillsEditorReset) {
    if (await webConsoleConfirm('确认要清空运行中的工具配置覆盖，并恢复默认工具配置吗？', { title: '恢复默认工具配置' })) {
      resetSkillsEditorConfig().catch(error => {
        pluginSettingsState.skillsEditorStatus = `恢复默认失败：${error.message}`;
        renderSkillsSection();
      });
    }
    return;
  }
  if (target.dataset.skillToggle) {
    const skillName = target.dataset.skillToggle;
    if (pluginSettingsState.skillsDraft) {
      pluginSettingsState.skillsDraft.definitions = (pluginSettingsState.skillsDraft.definitions || []).map(item => (
        item.name === skillName ? { ...item, enabled: !item.enabled } : item
      ));
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.skillExpand) {
    const skillName = target.dataset.skillExpand;
    const skill = (pluginSettingsState.skillsDraft?.definitions || []).find(item => item.name === skillName);
    setSkillExpanded(skillName, !isSkillExpanded(skill));
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillToolToggle) {
    const skillName = target.dataset.skillToolToggle;
    const toolName = target.dataset.toolName || '';
    if (pluginSettingsState.skillsDraft) {
      pluginSettingsState.skillsDraft.definitions = (pluginSettingsState.skillsDraft.definitions || []).map((item) => {
        if (item.name !== skillName) return item;
        const tools = (Array.isArray(item.tools) ? item.tools : []).map((tool) => (
          tool.name === toolName ? { ...tool, enabled: !tool.enabled } : tool
        ));
        return {
          ...item,
          enabledToolCount: tools.filter(tool => tool.enabled).length,
          tools,
        };
      });
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.featureManage) {
    const action = target.dataset.featureManage;
    const confirmTextMap = {
      disable_all: '确认要关闭全部功能吗？',
      reset: '确认要把功能开关重置为默认配置吗？',
      restore: '确认要从备份恢复当前功能开关吗？',
    };
    if (confirmTextMap[action] && !await webConsoleConfirm(confirmTextMap[action])) {
      return;
    }
    manageFeatureToggles(action).then(result => {
      if (result?.data?.exportText) {
        const filename = action === 'export_backup' ? 'feature-toggle-backup.json' : 'feature-toggle-current.json';
        downloadTextFile(filename, result.data.exportText);
      }
    }).catch(error => {
      pluginSettingsState.featureManageStatus = `操作失败：${error.message}`;
      pushFeatureManageHistory(action, pluginSettingsState.featureManageStatus, false);
      renderFeatureSection();
    });
    return;
  }
  if (target.dataset.featureHelpPreview) {
    loadFeatureHelpPreview().catch(error => {
      pluginSettingsState.helpPreviewStatus = `帮助图预览失败：${error.message}`;
      renderFeatureSection();
    });
    return;
  }
  if (target.dataset.featureHelpOpen) {
    if (pluginSettingsState.helpPreviewDataUrl) {
      window.open(pluginSettingsState.helpPreviewDataUrl, '_blank');
    }
    return;
  }
  if (target.dataset.featureHelpDownload) {
    if (pluginSettingsState.helpPreviewDataUrl) {
      downloadDataUrl('feature-toggle-help-preview.png', pluginSettingsState.helpPreviewDataUrl);
    }
    return;
  }
  if (target.dataset.privateSafetyRefresh) {
    refreshPrivateAiSafetySection().catch(error => {
      pluginSettingsState.privateAiSafetyStatus = `刷新失败：${error.message}`;
      renderPrivateAiSafetySection();
    });
    return;
  }
  if (target.dataset.privateSafetySearchClear) {
    setPrivateSafetyView({
      keyword: '',
      action: 'all',
      blacklistPage: 1,
      warningPage: 1,
      recordPage: 1,
    });
    pluginSettingsState.privateAiSafetyStatus = '已清空筛选条件。';
    renderPrivateAiSafetySection();
    return;
  }
  if (target.dataset.privateSafetyPageKind) {
    const kind = target.dataset.privateSafetyPageKind;
    const step = Number(target.dataset.privateSafetyPageStep || 0);
    const view = getPrivateSafetyView();
    const pageFieldMap = {
      blacklist: 'blacklistPage',
      warning: 'warningPage',
      record: 'recordPage',
    };
    const field = pageFieldMap[kind];
    if (field) {
      setPrivateSafetyView({ [field]: Math.max(1, Number(view[field] || 1) + step) });
      renderPrivateAiSafetySection();
    }
    return;
  }
  if (target.dataset.privateSafetyUnblock) {
    const userId = target.dataset.privateSafetyUnblock;
    if (!await webConsoleConfirm(`确认解除 QQ ${userId} 的私聊安全黑名单吗？`, { title: '解除私聊黑名单' })) {
      return;
    }
    postJson('/api/plugin-settings/private-ai-safety/unblock', { userId }).then(result => {
      pluginSettingsState.privateAiSafety = result?.data || null;
      pluginSettingsState.privateAiSafetyStatus = result?.existed ? `已解除 QQ ${userId} 的黑名单。` : `QQ ${userId} 不在黑名单中。`;
      renderPrivateAiSafetySection();
    }).catch(error => {
      pluginSettingsState.privateAiSafetyStatus = `解除失败：${error.message}`;
      renderPrivateAiSafetySection();
    });
    return;
  }
  if (target.dataset.privateSafetyClearCache) {
    if (!await webConsoleConfirm('确认清理私聊安全 LLM 复审缓存吗？不会删除黑名单和警告记录。', { title: '清理复审缓存' })) {
      return;
    }
    postJson('/api/plugin-settings/private-ai-safety/clear-cache', {}).then(result => {
      pluginSettingsState.privateAiSafety = result?.data || null;
      pluginSettingsState.privateAiSafetyStatus = `已清理 ${result?.removed || 0} 条复审缓存。`;
      renderPrivateAiSafetySection();
    }).catch(error => {
      pluginSettingsState.privateAiSafetyStatus = `清理缓存失败：${error.message}`;
      renderPrivateAiSafetySection();
    });
    return;
  }
  if (target.dataset.privateSafetyClearRecords || target.dataset.privateSafetyClearAll) {
    const clearBlacklist = Boolean(target.dataset.privateSafetyClearAll);
    const message = clearBlacklist
      ? '确认清空私聊安全警告、事件记录和全部黑名单吗？'
      : '确认清空私聊安全警告与事件记录吗？现有黑名单会保留。';
    if (!await webConsoleConfirm(message, { title: clearBlacklist ? '清空含黑名单' : '清空警告记录' })) {
      return;
    }
    postJson('/api/plugin-settings/private-ai-safety/clear-records', { clearBlacklist }).then(result => {
      pluginSettingsState.privateAiSafety = result?.data || null;
      pluginSettingsState.privateAiSafetyStatus = clearBlacklist ? '已清空警告、事件记录和黑名单。' : '已清空警告与事件记录，黑名单保留。';
      renderPrivateAiSafetySection();
    }).catch(error => {
      pluginSettingsState.privateAiSafetyStatus = `清空失败：${error.message}`;
      renderPrivateAiSafetySection();
    });
    return;
  }
  if (target.dataset.consoleThemeMode) {
    window.CrystelfTheme?.setMode?.(target.dataset.consoleThemeMode);
    renderConsoleSection();
    return;
  }
  if (target.dataset.consoleThemeAccent) {
    window.CrystelfTheme?.setAccent?.(target.dataset.consoleThemeAccent);
    renderConsoleSection();
    return;
  }
  if (target.dataset.consoleBackgroundRefresh) {
    const previousText = target.textContent;
    target.textContent = '切换中...';
    target.disabled = true;
    window.CrystelfTheme?.refreshBackground?.()
      .then(() => {
        target.textContent = '已切换';
      })
      .catch(error => {
        target.textContent = '切换失败';
        setPluginSettingsRisk(`壁纸切换失败：${error.message}`);
      })
      .finally(() => {
        window.setTimeout(() => {
          target.disabled = false;
          target.textContent = previousText || '换一张壁纸';
        }, 1200);
    });
    return;
  }
  if (target.dataset.consoleCacheAction === 'clear') {
    await clearPluginSettingsLocalCache();
    return;
  }
  if (target.dataset.knowledgeEditorAction) {
    const field = 'ai.knowledgeBase';
    if (target.dataset.knowledgeEditorAction === 'fill-demo') {
      pluginSettingsState.draft[field] = buildKnowledgeDemoText();
    }
    if (target.dataset.knowledgeEditorAction === 'clear') {
      pluginSettingsState.draft[field] = '';
    }
    renderForm();
    return;
  }
  if (target.dataset.knowledgeGeneratorAction === 'generate') {
    generateKnowledgeBaseFromWeb().catch(() => {});
    return;
  }
  if (target.dataset.knowledgeGeneratorAction === 'apply') {
    applyGeneratedKnowledgePreview();
    return;
  }
  if (target.dataset.ttsModelsRefresh) {
    refreshTtsModelsList();
    return;
  }
  if (target.dataset.knowledgeHistoryAction === 'preview') {
    pluginSettingsState.knowledgeHistoryPreviewId = target.dataset.knowledgeHistoryId || '';
    renderForm();
    return;
  }
  if (target.dataset.knowledgeHistoryAction === 'restore') {
    restoreKnowledgeHistory(target.dataset.knowledgeHistoryId);
    return;
  }
  if (target.dataset.settingsCategory) {
    pluginSettingsState.activeCategory = target.dataset.settingsCategory;
    pluginSettingsState.recommendationStatus = '';
    pluginSettingsState.recommendationUndo = null;
    renderCategoryTabs();
    renderGroupTabs();
    renderForm();
  }
  if (target.dataset.settingsGroup) {
    pluginSettingsState.activeGroup = target.dataset.settingsGroup;
    pluginSettingsState.recommendationStatus = '';
    pluginSettingsState.recommendationUndo = null;
    renderGroupTabs();
    renderForm();
  }
  if (target.dataset.switchField) {
    const field = target.dataset.switchField;
    pluginSettingsState.draft[field] = !pluginSettingsState.draft[field];
    renderForm();
    renderConsoleSection();
  }
  if (target.dataset.pluginTopTab) {
    switchPluginTopTab(target.dataset.pluginTopTab);
  }
});

document.getElementById('plugin-settings-nav-toggle-btn').addEventListener('click', () => {
  pluginSettingsState.navCollapsed = !pluginSettingsState.navCollapsed;
  localStorage.setItem('crystelf-plugin-settings-nav-collapsed', String(pluginSettingsState.navCollapsed));
  syncNavCollapsedState();
});

function createPluginSettingsDebouncedTask(fn, delay = 140) {
  if (typeof window.CrystelfUi?.debounce === 'function') {
    return window.CrystelfUi.debounce(fn, delay);
  }
  let timer = null;
  const task = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
  task.cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  return task;
}

const schedulePluginSettingsSearchRender = createPluginSettingsDebouncedTask(() => {
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
}, 140);

const schedulePluginSettingsSkillsRender = createPluginSettingsDebouncedTask(() => {
  renderSkillsSection();
}, 140);

if (pluginSettingsState.searchKeyword) {
  const searchInput = document.getElementById('plugin-settings-search');
  if (searchInput) searchInput.value = pluginSettingsState.searchKeyword;
}

document.getElementById('plugin-settings-search').addEventListener('input', event => {
  pluginSettingsState.searchKeyword = normalizeSearchText(event.target.value);
  schedulePluginSettingsSearchRender();
});

document.getElementById('plugin-settings-search-clear-btn').addEventListener('click', () => {
  pluginSettingsState.searchKeyword = '';
  document.getElementById('plugin-settings-search').value = '';
  schedulePluginSettingsSearchRender.cancel?.();
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
});

document.addEventListener('input', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.dataset.privateSafetySearch !== undefined) {
    setPrivateSafetyView({
      keyword: target.value,
      blacklistPage: 1,
      warningPage: 1,
      recordPage: 1,
    });
    renderPrivateAiSafetySection();
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.knowledgeGeneratorQuery !== undefined) {
    pluginSettingsState.knowledgeGenerateQuery = target.value;
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.skillsSearch !== undefined) {
    pluginSettingsState.skillsSearchKeyword = target.value;
    persistSkillsSearchKeyword();
    schedulePluginSettingsSkillsRender();
    return;
  }
  if (target instanceof HTMLTextAreaElement && target.dataset.skillsEditor !== undefined) {
    pluginSettingsState.skillsEditorText = target.value;
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.skillsField) {
    if (pluginSettingsState.skillsDraft) {
      pluginSettingsState.skillsDraft[target.dataset.skillsField] = target.value;
    }
    return;
  }
  if (!(target instanceof HTMLElement) || !target.dataset.field) return;
  const field = target.dataset.field;
  if (target instanceof HTMLTextAreaElement) {
    const item = (pluginSettingsState.payload?.items || []).find(entry => entry.field === field);
    if (item?.component === 'InputArray') {
      pluginSettingsState.draft[field] = target.value.split('\n').map(line => line.trim()).filter(Boolean);
    } else {
      pluginSettingsState.draft[field] = target.value;
    }
    return;
  }
  if (target instanceof HTMLInputElement) {
    pluginSettingsState.draft[field] = target.value;
  }
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.dataset.privateSafetyAction !== undefined) {
    setPrivateSafetyView({
      action: target.value || 'all',
      recordPage: 1,
    });
    renderPrivateAiSafetySection();
    return;
  }
  if (target instanceof HTMLSelectElement && target.dataset.privateSafetyPageSize !== undefined) {
    setPrivateSafetyView({
      pageSize: Number(target.value || 10) || 10,
      blacklistPage: 1,
      warningPage: 1,
      recordPage: 1,
    });
    renderPrivateAiSafetySection();
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.skillsField) {
    if (pluginSettingsState.skillsDraft) {
      const numeric = Number(target.value);
      pluginSettingsState.skillsDraft[target.dataset.skillsField] = Number.isFinite(numeric) ? numeric : 15000;
      renderSkillsSection();
    }
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.knowledgePreviewId) {
    const id = target.dataset.knowledgePreviewId;
    if (target.checked) {
      if (!pluginSettingsState.knowledgeSelectedPreviewIds.includes(id)) {
        pluginSettingsState.knowledgeSelectedPreviewIds.push(id);
      }
    } else {
      pluginSettingsState.knowledgeSelectedPreviewIds = pluginSettingsState.knowledgeSelectedPreviewIds.filter(item => item !== id);
    }
    return;
  }
  if (target instanceof HTMLSelectElement && target.dataset.knowledgeGenerateMode !== undefined) {
    pluginSettingsState.knowledgeGenerateMode = target.value || 'replace';
    return;
  }
  if (!(target instanceof HTMLSelectElement) || !target.dataset.field) return;
  const field = target.dataset.field;
  if (target.multiple) {
    pluginSettingsState.draft[field] = Array.from(target.selectedOptions).map(option => option.value);
  } else {
    pluginSettingsState.draft[field] = target.value;
  }
  renderConsoleSection();
});

document.getElementById('plugin-settings-save-btn').addEventListener('click', () => {
  savePluginSettings().catch(error => {
    setPluginSettingsRisk(`保存失败：${error.message}`);
  });
});

refreshPluginSettings().catch(error => {
  setPluginSettingsRisk(`加载失败：${error.message}`);
});

loadKnowledgeHistory();
loadFeatureManageHistory();

window.addEventListener('crystelf-theme-change', () => {
  if (pluginSettingsState.activeTopTab === 'plugin-settings-console-panel') {
    renderConsoleSection();
  }
});

