

function switchSection(sectionId) {
  apiSettingsState.activeSection = sectionId;

  document.querySelectorAll('.api-settings-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });

  document.querySelectorAll('.api-settings-section').forEach(section => {
    section.classList.toggle('hidden', section.id !== `section-${sectionId}`);
  });
}

async function loadApiSettings() {
  try {
    hideMessages();
    const data = await fetchJson('/api/api-settings');
    apiSettingsState.config = data;
    apiSettingsState.localMemeScan = null;
    apiSettingsState.memeTestResult = null;
    apiSettingsState.memePullResult = null;
    loadDraftFromConfig();
    syncInputsFromDraft();
    applyMemeTestDefaults();
    renderPreview();
    renderApiOverview();
    renderConfigSourceSummary();
    renderLocalMemeScan();
    renderMemeTestResult();
    renderMemePullResult();
    checkInitialStatus();
    $('api-settings-meta').textContent = `最后更新 ${new Date().toLocaleString('zh-CN')}`;
  } catch (error) {
    showRisk(`加载失败: ${error.message}`);
  }
}

function buildConfigPrecheckMessage(precheck, title = '配置保存预检') {
  const warnings = Array.isArray(precheck?.warnings) ? precheck.warnings : [];
  const changes = Array.isArray(precheck?.changes) ? precheck.changes : [];
  const summary = precheck?.summary || {};
  const lines = [
    `${title}已完成。`,
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

async function confirmApiSettingsPrecheck(payload) {
  const precheck = await postJson('/api/api-settings/precheck', payload);
  const errors = Array.isArray(precheck?.errors) ? precheck.errors : [];
  if (precheck?.ok === false) {
    showRisk(`保存预检未通过：${errors.join('；') || '存在配置错误'}`);
    return false;
  }

  const warningCount = Number(precheck?.summary?.warningCount || 0);
  const changeCount = Number(precheck?.summary?.changeCount || 0);
  if (warningCount > 0 || changeCount > 0) {
    const confirmed = await webConsoleConfirm(buildConfigPrecheckMessage(precheck, 'API 配置保存预检'), {
      title: '保存 API 配置预检',
      confirmText: '继续保存',
      cancelText: '取消',
    });
    if (!confirmed) {
      showRisk('已取消保存，配置未写入。');
      return false;
    }
  }
  return true;
}

async function saveApiSettings() {
  try {
    updateDraftFromInputs();
    const d = apiSettingsState.draft;

    if (!d['ai.baseApi'] || !hasSecretValue(d['ai.apiKey'], d['ai.apiKeyConfigured']) || !d['ai.modelType']) {
      showRisk('AI 主对话的 API 地址、密钥和模型为必填项。');
      return;
    }

    const payload = {
      ai: {
        baseApi: d['ai.baseApi'],
        apiKey: d['ai.apiKey'] === SECRET_SENTINEL ? '' : d['ai.apiKey'],
        preserveApiKey: d['ai.apiKey'] === SECRET_SENTINEL && d['ai.apiKeyConfigured'] === true,
        modelType: d['ai.modelType'],
        workingModel: d['ai.workingModel'],
        multimodalModel: d['ai.multimodalModel'],
        timeout: d['ai.timeout'],
        fallbackApi: {
          enabled: d['ai.fallbackApi.enabled'],
          baseApi: d['ai.fallbackApi.baseApi'],
          apiKey: d['ai.fallbackApi.apiKey'] === SECRET_SENTINEL ? '' : d['ai.fallbackApi.apiKey'],
          preserveApiKey: d['ai.fallbackApi.apiKey'] === SECRET_SENTINEL && d['ai.fallbackApi.apiKeyConfigured'] === true,
          modelType: d['ai.fallbackApi.modelType'],
          workingModel: d['ai.fallbackApi.workingModel'],
          multimodalModel: d['ai.fallbackApi.multimodalModel'],
        },
        imageConfig: {
          enabled: d['ai.imageConfig.enabled'],
          imageMode: d['ai.imageConfig.imageMode'],
          model: d['ai.imageConfig.model'],
          baseApi: d['ai.imageConfig.baseApi'],
          jimengApiUrl: d['ai.imageConfig.jimengApiUrl'],
          apiKey: d['ai.imageConfig.apiKey'] === SECRET_SENTINEL ? '' : d['ai.imageConfig.apiKey'],
          preserveApiKey: d['ai.imageConfig.apiKey'] === SECRET_SENTINEL && d['ai.imageConfig.apiKeyConfigured'] === true,
          size: d['ai.imageConfig.size'],
          quality: d['ai.imageConfig.quality'],
          responseFormat: d['ai.imageConfig.responseFormat'],
          background: d['ai.imageConfig.background'],
          timeout: d['ai.imageConfig.timeout'],
          fallbackReply: d['ai.imageConfig.fallbackReply'],
          fallbackTimeoutReply: d['ai.imageConfig.fallbackTimeoutReply'],
          fallbackApi: {
            enabled: d['ai.imageConfig.fallbackApi.enabled'],
            imageMode: d['ai.imageConfig.fallbackApi.imageMode'],
            model: d['ai.imageConfig.fallbackApi.model'],
            baseApi: d['ai.imageConfig.fallbackApi.baseApi'],
            jimengApiUrl: d['ai.imageConfig.fallbackApi.jimengApiUrl'],
            apiKey: d['ai.imageConfig.fallbackApi.apiKey'] === SECRET_SENTINEL ? '' : d['ai.imageConfig.fallbackApi.apiKey'],
            preserveApiKey: d['ai.imageConfig.fallbackApi.apiKey'] === SECRET_SENTINEL && d['ai.imageConfig.fallbackApi.apiKeyConfigured'] === true,
          },
        },
        memeConfig: {
          apiBase: d['ai.memeConfig.apiBase'],
          localEnabled: d['ai.memeConfig.localEnabled'],
          preferLocal: d['ai.memeConfig.preferLocal'],
          localBaseDir: d['ai.memeConfig.localBaseDir'],
          fallbackApi: {
            enabled: d['ai.memeConfig.fallbackApi.enabled'],
            apiBase: d['ai.memeConfig.fallbackApi.apiBase'],
          },
        },
      },
      imageMonitor: {
        enabled: d['imageMonitor.enabled'],
        apiBase: d['imageMonitor.apiBase'],
        apiKey: d['imageMonitor.apiKey'] === SECRET_SENTINEL ? '' : d['imageMonitor.apiKey'],
        preserveApiKey: d['imageMonitor.apiKey'] === SECRET_SENTINEL && d['imageMonitor.apiKeyConfigured'] === true,
        model: d['imageMonitor.model'],
        saveReviewImages: d['imageMonitor.saveReviewImages'],
        saveMemeImages: d['imageMonitor.saveMemeImages'],
        saveMemeCharacters: d['imageMonitor.saveMemeCharacters'],
        saveMemeKeywords: d['imageMonitor.saveMemeKeywords'],
        analysisTimeoutMs: d['imageMonitor.analysisTimeoutMs'],
        fallbackReply: d['imageMonitor.fallbackReply'],
        fallbackTimeoutReply: d['imageMonitor.fallbackTimeoutReply'],
        fallbackApi: {
          enabled: d['imageMonitor.fallbackApi.enabled'],
          apiBase: d['imageMonitor.fallbackApi.apiBase'],
          apiKey: d['imageMonitor.fallbackApi.apiKey'] === SECRET_SENTINEL ? '' : d['imageMonitor.fallbackApi.apiKey'],
          preserveApiKey: d['imageMonitor.fallbackApi.apiKey'] === SECRET_SENTINEL && d['imageMonitor.fallbackApi.apiKeyConfigured'] === true,
          model: d['imageMonitor.fallbackApi.model'],
        },
      },
      coreConfig: {
        tools: {
          search: {
            enabled: d['search.enabled'],
            apiUrl: d['search.apiUrl'],
            apiKey: d['search.apiKey'] === SECRET_SENTINEL ? '' : d['search.apiKey'],
            preserveApiKey: d['search.apiKey'] === SECRET_SENTINEL && d['search.apiKeyConfigured'] === true,
            markdownApiUrl: d['search.markdownApiUrl'],
            markdownStatusUrl: d['search.markdownStatusUrl'],
            timeoutMs: d['search.timeoutMs'],
            fallbackApi: {
              enabled: d['search.fallbackApi.enabled'],
              apiUrl: d['search.fallbackApi.apiUrl'],
              apiKey: d['search.fallbackApi.apiKey'] === SECRET_SENTINEL ? '' : d['search.fallbackApi.apiKey'],
              preserveApiKey: d['search.fallbackApi.apiKey'] === SECRET_SENTINEL && d['search.fallbackApi.apiKeyConfigured'] === true,
              markdownApiUrl: d['search.fallbackApi.markdownApiUrl'],
              markdownStatusUrl: d['search.fallbackApi.markdownStatusUrl'],
            },
          },
        },
      },
    };

    if (!await confirmApiSettingsPrecheck(payload)) {
      return;
    }

    await postJson('/api/api-settings/save', payload);
    showSuccess('API 配置已保存，部分配置可能需要重启后完全生效。');
    await loadApiSettings();
  } catch (error) {
    showRisk(`保存失败: ${error.message}`);
  }
}

function enhancePasswordFields() {
  document.querySelectorAll('input[type="password"]').forEach(input => {
    if (!(input instanceof HTMLInputElement)) return;
    input.setAttribute('autocomplete', 'new-password');
    if (input.closest('form.inline-field-form')) return;

    const form = document.createElement('form');
    form.className = 'inline-field-form';
    form.addEventListener('submit', event => event.preventDefault());

    const username = document.createElement('input');
    username.className = 'visually-hidden';
    username.type = 'text';
    username.autocomplete = 'username';
    username.tabIndex = -1;
    username.setAttribute('aria-hidden', 'true');

    input.parentNode?.insertBefore(form, input);
    form.appendChild(username);
    form.appendChild(input);
  });
}

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.classList.contains('api-settings-nav-btn')) {
    switchSection(target.dataset.section);
    return;
  }

  const fallbackSwitchMap = {
    'ai-fallback-enabled': 'ai.fallbackApi.enabled',
    'image-fallback-enabled': 'ai.imageConfig.fallbackApi.enabled',
    'imageMonitor-fallback-enabled': 'imageMonitor.fallbackApi.enabled',
    'search-fallback-enabled': 'search.fallbackApi.enabled',
    'meme-fallback-enabled': 'ai.memeConfig.fallbackApi.enabled',
  };
  if (fallbackSwitchMap[target.id]) {
    const draftKey = fallbackSwitchMap[target.id];
    apiSettingsState.draft[draftKey] = !apiSettingsState.draft[draftKey];
    updateSwitchButton(target.id, apiSettingsState.draft[draftKey]);
    renderPreview();
    renderApiOverview();
    checkInitialStatus();
    return;
  }

  if (target.id === 'imageMonitor-enabled') {
    apiSettingsState.draft['imageMonitor.enabled'] = !apiSettingsState.draft['imageMonitor.enabled'];
    updateSwitchButton('imageMonitor-enabled', apiSettingsState.draft['imageMonitor.enabled']);
    renderPreview();
    renderApiOverview();
    checkInitialStatus();
    return;
  }

  if (target.id === 'imageMonitor-saveReviewImages') {
    apiSettingsState.draft['imageMonitor.saveReviewImages'] = !apiSettingsState.draft['imageMonitor.saveReviewImages'];
    updateSwitchButton('imageMonitor-saveReviewImages', apiSettingsState.draft['imageMonitor.saveReviewImages']);
    renderPreview();
    renderApiOverview();
    checkInitialStatus();
    return;
  }

  if (target.id === 'imageMonitor-saveMemeImages') {
    apiSettingsState.draft['imageMonitor.saveMemeImages'] = !apiSettingsState.draft['imageMonitor.saveMemeImages'];
    updateSwitchButton('imageMonitor-saveMemeImages', apiSettingsState.draft['imageMonitor.saveMemeImages']);
    renderPreview();
    renderApiOverview();
    checkInitialStatus();
    return;
  }

  if (target.id === 'search-enabled') {
    apiSettingsState.draft['search.enabled'] = !apiSettingsState.draft['search.enabled'];
    updateSwitchButton('search-enabled', apiSettingsState.draft['search.enabled']);
    renderPreview();
    renderApiOverview();
    checkInitialStatus();
    return;
  }

  if (target.id === 'meme-localEnabled') {
    apiSettingsState.draft['ai.memeConfig.localEnabled'] = !apiSettingsState.draft['ai.memeConfig.localEnabled'];
    updateSwitchButton('meme-localEnabled', apiSettingsState.draft['ai.memeConfig.localEnabled']);
    apiSettingsState.localMemeScan = null;
    apiSettingsState.memeTestResult = null;
    apiSettingsState.memePullResult = null;
    renderLocalMemeScan();
    renderMemeTestResult();
    renderMemePullResult();
    renderPreview();
    renderApiOverview();
    checkInitialStatus();
    return;
  }

  if (target.id === 'meme-preferLocal') {
    apiSettingsState.draft['ai.memeConfig.preferLocal'] = !apiSettingsState.draft['ai.memeConfig.preferLocal'];
    updateSwitchButton('meme-preferLocal', apiSettingsState.draft['ai.memeConfig.preferLocal']);
    apiSettingsState.localMemeScan = null;
    apiSettingsState.memeTestResult = null;
    apiSettingsState.memePullResult = null;
    renderLocalMemeScan();
    renderMemeTestResult();
    renderMemePullResult();
    renderPreview();
    renderApiOverview();
    checkInitialStatus();
    return;
  }

  if (target.id === 'api-settings-save-btn') {
    saveApiSettings();
    return;
  }

  if (target.id === 'api-settings-test-btn') {
    testApiConnection();
    return;
  }

  if (target.id === 'api-settings-batch-test-btn') {
    batchTestAllApis();
    return;
  }

  if (target.id === 'api-settings-export-batch-report-btn') {
    downloadBatchTestReport();
    showSuccess('API 批量测试报告已导出。');
    return;
  }

  if (target.id === 'meme-local-scan-btn') {
    updateDraftFromInputs();
    scanLocalMemeDirectory();
    return;
  }

  if (target.id === 'meme-test-btn') {
    runMemeDeliveryTest();
    return;
  }

  if (target.id === 'meme-pull-btn') {
    runMemePullToLocal();
  }
});

document.addEventListener('input', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
    updateDraftFromInputs();

    if (target.id === 'meme-localBaseDir') {
      apiSettingsState.localMemeScan = null;
      renderLocalMemeScan();
    }

    if (target.id && target.id.startsWith('meme-')) {
      apiSettingsState.memeTestResult = null;
      apiSettingsState.memePullResult = null;
      renderMemeTestResult();
      renderMemePullResult();
    }

    renderPreview();
    renderApiOverview();
    checkInitialStatus();
  }
});

enhancePasswordFields();
loadApiSettings();
