function loadDraftFromConfig() {
  const cfg = apiSettingsState.config || {};
  const ai = cfg.ai || {};
  const image = ai.imageConfig || {};
  const imageMonitor = cfg.imageMonitor || {};
  const search = cfg.coreConfig?.tools?.search || {};
  const meme = ai.memeConfig || {};
  const aiFallback = ai.fallbackApi || {};
  const imageFallback = image.fallbackApi || {};
  const imageMonitorFallback = imageMonitor.fallbackApi || {};
  const searchFallback = search.fallbackApi || {};
  const memeFallback = meme.fallbackApi || {};

  apiSettingsState.draft = {
    'ai.baseApi': ai.baseApi || '',
    'ai.apiKey': ai.apiKeyConfigured === true ? SECRET_SENTINEL : (ai.apiKey || ''),
    'ai.apiKeyConfigured': ai.apiKeyConfigured === true,
    'ai.userAgent': ai.userAgent || '',
    'ai.defaultUserAgent': ai.defaultUserAgent || '',
    'ai.modelType': ai.modelType || '',
    'ai.workingModel': ai.workingModel || '',
    'ai.multimodalModel': ai.multimodalModel || '',
    'ai.timeout': normalizePositiveNumber(ai.timeout, 60000),
    'ai.fallbackApi.enabled': aiFallback.enabled === true,
    'ai.fallbackApi.baseApi': aiFallback.baseApi || '',
    'ai.fallbackApi.apiKey': aiFallback.apiKeyConfigured === true ? SECRET_SENTINEL : (aiFallback.apiKey || ''),
    'ai.fallbackApi.apiKeyConfigured': aiFallback.apiKeyConfigured === true,
    'ai.fallbackApi.modelType': aiFallback.modelType || '',
    'ai.fallbackApi.workingModel': aiFallback.workingModel || '',
    'ai.fallbackApi.multimodalModel': aiFallback.multimodalModel || '',
    'ai.fallbackApi.autoSwitchEnabled': aiFallback.autoSwitchEnabled !== false,
    'ai.fallbackApi.failureThreshold': normalizeFallbackFailureThreshold(aiFallback.failureThreshold, 2),
    'ai.fallbackApi.cooldownMs': normalizeFallbackCooldownMs(aiFallback.cooldownMs, 300000),

    'ai.imageConfig.enabled': image.enabled !== false,
    'ai.imageConfig.imageMode': image.imageMode || 'openai',
    'ai.imageConfig.model': image.model || '',
    'ai.imageConfig.baseApi': image.baseApi || '',
    'ai.imageConfig.jimengApiUrl': image.jimengApiUrl || '',
    'ai.imageConfig.apiKey': image.apiKeyConfigured === true ? SECRET_SENTINEL : (image.apiKey || ''),
    'ai.imageConfig.apiKeyConfigured': image.apiKeyConfigured === true,
    'ai.imageConfig.size': image.size || '1024x1024',
    'ai.imageConfig.quality': image.quality || 'high',
    'ai.imageConfig.responseFormat': image.responseFormat || 'b64_json',
    'ai.imageConfig.outputFormat': image.outputFormat || 'png',
    'ai.imageConfig.watermark': image.watermark === true,
    'ai.imageConfig.webSearch': image.webSearch === true,
    'ai.imageConfig.sdWebUi.baseApi': image.sdWebUi?.baseApi || '',
    'ai.imageConfig.sdWebUi.model': image.sdWebUi?.model || '',
    'ai.imageConfig.sdWebUi.username': image.sdWebUi?.username || '',
    'ai.imageConfig.sdWebUi.password': image.sdWebUi?.passwordConfigured === true ? SECRET_SENTINEL : (image.sdWebUi?.password || ''),
    'ai.imageConfig.sdWebUi.passwordConfigured': image.sdWebUi?.passwordConfigured === true,
    'ai.imageConfig.sdWebUi.samplerName': image.sdWebUi?.samplerName || 'DPM++ 2M',
    'ai.imageConfig.sdWebUi.scheduler': image.sdWebUi?.scheduler ?? 'Karras',
    'ai.imageConfig.sdWebUi.steps': normalizePositiveNumber(image.sdWebUi?.steps, 20),
    'ai.imageConfig.sdWebUi.cfgScale': normalizePositiveNumber(image.sdWebUi?.cfgScale, 7),
    'ai.imageConfig.sdWebUi.width': normalizePositiveNumber(image.sdWebUi?.width, 1024),
    'ai.imageConfig.sdWebUi.height': normalizePositiveNumber(image.sdWebUi?.height, 1024),
    'ai.imageConfig.sdWebUi.negativePrompt': image.sdWebUi?.negativePrompt || '',
    'ai.imageConfig.sdWebUi.seed': Number.isFinite(Number(image.sdWebUi?.seed)) ? Number(image.sdWebUi.seed) : -1,
    'ai.imageConfig.sdWebUi.denoisingStrength': Number.isFinite(Number(image.sdWebUi?.denoisingStrength)) ? Number(image.sdWebUi.denoisingStrength) : 0.7,
    'ai.imageConfig.background': image.background || '',
    'ai.imageConfig.timeout': normalizePositiveNumber(image.timeout, 60000),
    'ai.imageConfig.fallbackReply': image.fallbackReply || '',
    'ai.imageConfig.fallbackTimeoutReply': image.fallbackTimeoutReply || '',
    'ai.imageConfig.fallbackApi.enabled': imageFallback.enabled === true,
    'ai.imageConfig.fallbackApi.imageMode': imageFallback.imageMode || image.imageMode || 'openai',
    'ai.imageConfig.fallbackApi.model': imageFallback.model || '',
    'ai.imageConfig.fallbackApi.baseApi': imageFallback.baseApi || '',
    'ai.imageConfig.fallbackApi.jimengApiUrl': imageFallback.jimengApiUrl || '',
    'ai.imageConfig.fallbackApi.apiKey': imageFallback.apiKeyConfigured === true ? SECRET_SENTINEL : (imageFallback.apiKey || ''),
    'ai.imageConfig.fallbackApi.apiKeyConfigured': imageFallback.apiKeyConfigured === true,
    'ai.imageConfig.fallbackApi.size': imageFallback.size || '',
    'ai.imageConfig.fallbackApi.responseFormat': imageFallback.responseFormat || '',
    'ai.imageConfig.fallbackApi.outputFormat': imageFallback.outputFormat || '',
    'ai.imageConfig.fallbackApi.watermark': imageFallback.watermark === true,
    'ai.imageConfig.fallbackApi.webSearch': imageFallback.webSearch === true,
    'ai.imageConfig.fallbackApi.sdWebUi.baseApi': imageFallback.sdWebUi?.baseApi || '',
    'ai.imageConfig.fallbackApi.sdWebUi.model': imageFallback.sdWebUi?.model || '',
    'ai.imageConfig.fallbackApi.sdWebUi.username': imageFallback.sdWebUi?.username || '',
    'ai.imageConfig.fallbackApi.sdWebUi.password': imageFallback.sdWebUi?.passwordConfigured === true ? SECRET_SENTINEL : (imageFallback.sdWebUi?.password || ''),
    'ai.imageConfig.fallbackApi.sdWebUi.passwordConfigured': imageFallback.sdWebUi?.passwordConfigured === true,
    'ai.imageConfig.fallbackApi.sdWebUi.samplerName': imageFallback.sdWebUi?.samplerName || 'DPM++ 2M',
    'ai.imageConfig.fallbackApi.sdWebUi.scheduler': imageFallback.sdWebUi?.scheduler ?? 'Karras',
    'ai.imageConfig.fallbackApi.sdWebUi.steps': normalizePositiveNumber(imageFallback.sdWebUi?.steps, 20),
    'ai.imageConfig.fallbackApi.sdWebUi.cfgScale': normalizePositiveNumber(imageFallback.sdWebUi?.cfgScale, 7),
    'ai.imageConfig.fallbackApi.sdWebUi.width': normalizePositiveNumber(imageFallback.sdWebUi?.width, 1024),
    'ai.imageConfig.fallbackApi.sdWebUi.height': normalizePositiveNumber(imageFallback.sdWebUi?.height, 1024),
    'ai.imageConfig.fallbackApi.sdWebUi.negativePrompt': imageFallback.sdWebUi?.negativePrompt || '',
    'ai.imageConfig.fallbackApi.sdWebUi.seed': Number.isFinite(Number(imageFallback.sdWebUi?.seed)) ? Number(imageFallback.sdWebUi.seed) : -1,
    'ai.imageConfig.fallbackApi.sdWebUi.denoisingStrength': Number.isFinite(Number(imageFallback.sdWebUi?.denoisingStrength)) ? Number(imageFallback.sdWebUi.denoisingStrength) : 0.7,
    'ai.imageConfig.fallbackApi.autoSwitchEnabled': imageFallback.autoSwitchEnabled !== false,
    'ai.imageConfig.fallbackApi.failureThreshold': normalizeFallbackFailureThreshold(imageFallback.failureThreshold, 2),
    'ai.imageConfig.fallbackApi.cooldownMs': normalizeFallbackCooldownMs(imageFallback.cooldownMs, 300000),

    'imageMonitor.enabled': imageMonitor.enabled === true,
    'imageMonitor.storageEnabled': imageMonitor.storageEnabled === true,
    'imageMonitor.saveReviewImages': imageMonitor.saveReviewImages !== false,
    'imageMonitor.saveMemeImages': imageMonitor.saveMemeImages === true,
    'imageMonitor.saveMemeCharacters': normalizeStringList(imageMonitor.saveMemeCharacters),
    'imageMonitor.saveMemeKeywords': normalizeStringList(imageMonitor.saveMemeKeywords),
    'imageMonitor.apiBase': imageMonitor.apiBase || '',
    'imageMonitor.apiKey': imageMonitor.apiKeyConfigured === true ? SECRET_SENTINEL : (imageMonitor.apiKey || ''),
    'imageMonitor.apiKeyConfigured': imageMonitor.apiKeyConfigured === true,
    'imageMonitor.model': imageMonitor.model || '',
    'imageMonitor.analysisTimeoutMs': normalizePositiveNumber(imageMonitor.analysisTimeoutMs, 30000),
    'imageMonitor.fallbackReply': imageMonitor.fallbackReply || '',
    'imageMonitor.fallbackTimeoutReply': imageMonitor.fallbackTimeoutReply || '',
    'imageMonitor.fallbackApi.enabled': imageMonitorFallback.enabled === true,
    'imageMonitor.fallbackApi.apiBase': imageMonitorFallback.apiBase || '',
    'imageMonitor.fallbackApi.apiKey': imageMonitorFallback.apiKeyConfigured === true ? SECRET_SENTINEL : (imageMonitorFallback.apiKey || ''),
    'imageMonitor.fallbackApi.apiKeyConfigured': imageMonitorFallback.apiKeyConfigured === true,
    'imageMonitor.fallbackApi.model': imageMonitorFallback.model || '',
    'imageMonitor.fallbackApi.autoSwitchEnabled': imageMonitorFallback.autoSwitchEnabled !== false,
    'imageMonitor.fallbackApi.failureThreshold': normalizeFallbackFailureThreshold(imageMonitorFallback.failureThreshold, 2),
    'imageMonitor.fallbackApi.cooldownMs': normalizeFallbackCooldownMs(imageMonitorFallback.cooldownMs, 300000),
    'imageMonitor.violationAction': normalizeViolationAction(imageMonitor.violationAction, imageMonitor.autoRecallViolation),
    'imageMonitor.riskThreshold': normalizeRiskThreshold(imageMonitor.riskThreshold, 0.7),
    'imageMonitor.monitorQuotedImages': imageMonitor.monitorQuotedImages === true,
    'imageMonitor.allowedGroups': normalizeStringList(imageMonitor.allowedGroups),
    'imageMonitor.blockedGroups': normalizeStringList(imageMonitor.blockedGroups),
    'imageMonitor.maxImagesPerMessage': normalizePositiveNumber(imageMonitor.maxImagesPerMessage, 3),
    'imageMonitor.duplicateWindowMs': normalizeNonNegativeNumber(imageMonitor.duplicateWindowMs, 60000),
    'imageMonitor.temperature': normalizeTemperature(imageMonitor.temperature, 0.2),
    'imageMonitor.prompt': String(imageMonitor.prompt || ''),

    'search.enabled': search.enabled === true,
    'search.apiUrl': search.apiUrl || '',
    'search.apiKey': search.apiKeyConfigured === true ? SECRET_SENTINEL : (search.apiKey || ''),
    'search.apiKeyConfigured': search.apiKeyConfigured === true,
    'search.markdownApiUrl': search.markdownApiUrl || '',
    'search.markdownStatusUrl': search.markdownStatusUrl || '',
    'search.timeoutMs': normalizePositiveNumber(search.timeoutMs, 60000),
    'search.fallbackApi.enabled': searchFallback.enabled === true,
    'search.fallbackApi.apiUrl': searchFallback.apiUrl || '',
    'search.fallbackApi.apiKey': searchFallback.apiKeyConfigured === true ? SECRET_SENTINEL : (searchFallback.apiKey || ''),
    'search.fallbackApi.apiKeyConfigured': searchFallback.apiKeyConfigured === true,
    'search.fallbackApi.markdownApiUrl': searchFallback.markdownApiUrl || '',
    'search.fallbackApi.markdownStatusUrl': searchFallback.markdownStatusUrl || '',
    'search.fallbackApi.autoSwitchEnabled': searchFallback.autoSwitchEnabled !== false,
    'search.fallbackApi.failureThreshold': normalizeFallbackFailureThreshold(searchFallback.failureThreshold, 2),
    'search.fallbackApi.cooldownMs': normalizeFallbackCooldownMs(searchFallback.cooldownMs, 300000),

    'ai.memeConfig.apiBase': meme.apiBase || '',
    'ai.memeConfig.localEnabled': meme.localEnabled !== false,
    'ai.memeConfig.preferLocal': meme.preferLocal === true,
    'ai.memeConfig.localBaseDir': meme.localBaseDir || 'data/chat/meme',
    'ai.memeConfig.fallbackApi.enabled': memeFallback.enabled === true,
    'ai.memeConfig.fallbackApi.apiBase': memeFallback.apiBase || '',
    'ai.memeConfig.fallbackApi.autoSwitchEnabled': memeFallback.autoSwitchEnabled !== false,
    'ai.memeConfig.fallbackApi.failureThreshold': normalizeFallbackFailureThreshold(memeFallback.failureThreshold, 2),
    'ai.memeConfig.fallbackApi.cooldownMs': normalizeFallbackCooldownMs(memeFallback.cooldownMs, 300000),
  };
}

function syncImageMonitorStorageControls() {
  const enabled = apiSettingsState.draft['imageMonitor.storageEnabled'] === true;
  for (const id of [
    'imageMonitor-saveReviewImages',
    'imageMonitor-saveMemeImages',
    'imageMonitor-saveMemeCharacters',
    'imageMonitor-saveMemeKeywords',
  ]) {
    const element = $(id);
    if (!element) continue;
    element.disabled = !enabled;
    element.closest('.setting-item')?.classList.toggle('is-storage-disabled', !enabled);
  }
  const status = $('imageMonitor-storage-status');
  if (status) {
    status.textContent = enabled
      ? '本地入库已开启，下面的细分保存选项生效。'
      : '本地入库已关闭：不保存图片，只持久记录 MD5；相同 MD5 不再检测。';
  }
}

function syncInputsFromDraft() {
  const d = apiSettingsState.draft;

  $('ai-baseApi').value = d['ai.baseApi'] || '';
  syncSecretInput('ai-apiKey', d['ai.apiKey'], d['ai.apiKeyConfigured'], 'sk-...');
  $('ai-userAgent').value = d['ai.userAgent'] || '';
  const userAgentHelp = $('ai-userAgent-help');
  if (userAgentHelp) {
    userAgentHelp.textContent = `用于 LLM 请求头，方便中转、CDN 或日志区分来源；留空使用默认：${d['ai.defaultUserAgent'] || 'crystelf-plugin/当前版本'}`;
  }
  $('ai-modelType').value = d['ai.modelType'] || '';
  $('ai-workingModel').value = d['ai.workingModel'] || '';
  $('ai-multimodalModel').value = d['ai.multimodalModel'] || '';
  $('ai-timeout').value = d['ai.timeout'] || 60000;
  updateSwitchButton('ai-fallback-enabled', d['ai.fallbackApi.enabled']);
  $('ai-fallback-baseApi').value = d['ai.fallbackApi.baseApi'] || '';
  syncSecretInput('ai-fallback-apiKey', d['ai.fallbackApi.apiKey'], d['ai.fallbackApi.apiKeyConfigured'], '备用 API Key');
  $('ai-fallback-modelType').value = d['ai.fallbackApi.modelType'] || '';
  $('ai-fallback-workingModel').value = d['ai.fallbackApi.workingModel'] || '';
  $('ai-fallback-multimodalModel').value = d['ai.fallbackApi.multimodalModel'] || '';
  updateSwitchButton('ai-fallback-autoSwitchEnabled', d['ai.fallbackApi.autoSwitchEnabled']);
  $('ai-fallback-failureThreshold').value = d['ai.fallbackApi.failureThreshold'] || 2;
  $('ai-fallback-cooldownMs').value = d['ai.fallbackApi.cooldownMs'] || 300000;

  $('image-imageMode').value = d['ai.imageConfig.imageMode'] || 'openai';
  $('image-model').value = d['ai.imageConfig.model'] || '';
  $('image-baseApi').value = d['ai.imageConfig.baseApi'] || '';
  $('image-jimengApiUrl').value = d['ai.imageConfig.jimengApiUrl'] || '';
  syncSecretInput('image-apiKey', d['ai.imageConfig.apiKey'], d['ai.imageConfig.apiKeyConfigured'], 'sk-...');
  $('image-size').value = d['ai.imageConfig.size'] || '1024x1024';
  $('image-quality').value = d['ai.imageConfig.quality'] || 'high';
  $('image-responseFormat').value = d['ai.imageConfig.responseFormat'] || 'b64_json';
  $('image-outputFormat').value = d['ai.imageConfig.outputFormat'] || 'png';
  updateSwitchButton('image-watermark', d['ai.imageConfig.watermark']);
  updateSwitchButton('image-webSearch', d['ai.imageConfig.webSearch']);
  $('image-sdWebUi-baseApi').value = d['ai.imageConfig.sdWebUi.baseApi'] || '';
  $('image-sdWebUi-model').value = d['ai.imageConfig.sdWebUi.model'] || '';
  $('image-sdWebUi-username').value = d['ai.imageConfig.sdWebUi.username'] || '';
  syncSecretInput('image-sdWebUi-password', d['ai.imageConfig.sdWebUi.password'], d['ai.imageConfig.sdWebUi.passwordConfigured'], '未启用认证时留空');
  $('image-sdWebUi-samplerName').value = d['ai.imageConfig.sdWebUi.samplerName'] || 'DPM++ 2M';
  $('image-sdWebUi-scheduler').value = d['ai.imageConfig.sdWebUi.scheduler'] ?? 'Karras';
  $('image-sdWebUi-steps').value = d['ai.imageConfig.sdWebUi.steps'] || 20;
  $('image-sdWebUi-cfgScale').value = d['ai.imageConfig.sdWebUi.cfgScale'] || 7;
  $('image-sdWebUi-width').value = d['ai.imageConfig.sdWebUi.width'] || 1024;
  $('image-sdWebUi-height').value = d['ai.imageConfig.sdWebUi.height'] || 1024;
  $('image-sdWebUi-negativePrompt').value = d['ai.imageConfig.sdWebUi.negativePrompt'] || '';
  $('image-sdWebUi-seed').value = d['ai.imageConfig.sdWebUi.seed'] ?? -1;
  $('image-sdWebUi-denoisingStrength').value = d['ai.imageConfig.sdWebUi.denoisingStrength'] ?? 0.7;
  $('image-background').value = d['ai.imageConfig.background'] || '';
  $('image-timeout').value = d['ai.imageConfig.timeout'] || 60000;
  $('image-fallbackReply').value = d['ai.imageConfig.fallbackReply'] || '';
  $('image-fallbackTimeoutReply').value = d['ai.imageConfig.fallbackTimeoutReply'] || '';
  updateSwitchButton('image-fallback-enabled', d['ai.imageConfig.fallbackApi.enabled']);
  $('image-fallback-imageMode').value = d['ai.imageConfig.fallbackApi.imageMode'] || d['ai.imageConfig.imageMode'] || 'openai';
  $('image-fallback-model').value = d['ai.imageConfig.fallbackApi.model'] || '';
  $('image-fallback-baseApi').value = d['ai.imageConfig.fallbackApi.baseApi'] || '';
  $('image-fallback-jimengApiUrl').value = d['ai.imageConfig.fallbackApi.jimengApiUrl'] || '';
  syncSecretInput('image-fallback-apiKey', d['ai.imageConfig.fallbackApi.apiKey'], d['ai.imageConfig.fallbackApi.apiKeyConfigured'], '备用生图 API Key');
  $('image-fallback-size').value = d['ai.imageConfig.fallbackApi.size'] || '';
  $('image-fallback-responseFormat').value = d['ai.imageConfig.fallbackApi.responseFormat'] || '';
  $('image-fallback-outputFormat').value = d['ai.imageConfig.fallbackApi.outputFormat'] || '';
  updateSwitchButton('image-fallback-watermark', d['ai.imageConfig.fallbackApi.watermark']);
  updateSwitchButton('image-fallback-webSearch', d['ai.imageConfig.fallbackApi.webSearch']);
  $('image-fallback-sdWebUi-baseApi').value = d['ai.imageConfig.fallbackApi.sdWebUi.baseApi'] || '';
  $('image-fallback-sdWebUi-model').value = d['ai.imageConfig.fallbackApi.sdWebUi.model'] || '';
  $('image-fallback-sdWebUi-username').value = d['ai.imageConfig.fallbackApi.sdWebUi.username'] || '';
  syncSecretInput('image-fallback-sdWebUi-password', d['ai.imageConfig.fallbackApi.sdWebUi.password'], d['ai.imageConfig.fallbackApi.sdWebUi.passwordConfigured'], '未启用认证时留空');
  $('image-fallback-sdWebUi-samplerName').value = d['ai.imageConfig.fallbackApi.sdWebUi.samplerName'] || 'DPM++ 2M';
  $('image-fallback-sdWebUi-scheduler').value = d['ai.imageConfig.fallbackApi.sdWebUi.scheduler'] ?? 'Karras';
  $('image-fallback-sdWebUi-steps').value = d['ai.imageConfig.fallbackApi.sdWebUi.steps'] || 20;
  $('image-fallback-sdWebUi-cfgScale').value = d['ai.imageConfig.fallbackApi.sdWebUi.cfgScale'] || 7;
  $('image-fallback-sdWebUi-width').value = d['ai.imageConfig.fallbackApi.sdWebUi.width'] || 1024;
  $('image-fallback-sdWebUi-height').value = d['ai.imageConfig.fallbackApi.sdWebUi.height'] || 1024;
  $('image-fallback-sdWebUi-negativePrompt').value = d['ai.imageConfig.fallbackApi.sdWebUi.negativePrompt'] || '';
  $('image-fallback-sdWebUi-seed').value = d['ai.imageConfig.fallbackApi.sdWebUi.seed'] ?? -1;
  $('image-fallback-sdWebUi-denoisingStrength').value = d['ai.imageConfig.fallbackApi.sdWebUi.denoisingStrength'] ?? 0.7;
  updateSwitchButton('image-fallback-autoSwitchEnabled', d['ai.imageConfig.fallbackApi.autoSwitchEnabled']);
  $('image-fallback-failureThreshold').value = d['ai.imageConfig.fallbackApi.failureThreshold'] || 2;
  $('image-fallback-cooldownMs').value = d['ai.imageConfig.fallbackApi.cooldownMs'] || 300000;

  updateSwitchButton('imageMonitor-enabled', d['imageMonitor.enabled']);
  updateSwitchButton('imageMonitor-storageEnabled', d['imageMonitor.storageEnabled']);
  updateSwitchButton('imageMonitor-saveReviewImages', d['imageMonitor.saveReviewImages']);
  updateSwitchButton('imageMonitor-saveMemeImages', d['imageMonitor.saveMemeImages']);
  $('imageMonitor-apiBase').value = d['imageMonitor.apiBase'] || '';
  syncSecretInput('imageMonitor-apiKey', d['imageMonitor.apiKey'], d['imageMonitor.apiKeyConfigured'], 'sk-...');
  $('imageMonitor-model').value = d['imageMonitor.model'] || '';
  $('imageMonitor-analysisTimeoutMs').value = d['imageMonitor.analysisTimeoutMs'] || 30000;
  $('imageMonitor-fallbackReply').value = d['imageMonitor.fallbackReply'] || '';
  $('imageMonitor-fallbackTimeoutReply').value = d['imageMonitor.fallbackTimeoutReply'] || '';
  $('imageMonitor-saveMemeCharacters').value = formatListInput(d['imageMonitor.saveMemeCharacters']);
  $('imageMonitor-saveMemeKeywords').value = formatListInput(d['imageMonitor.saveMemeKeywords']);
  updateSwitchButton('imageMonitor-fallback-enabled', d['imageMonitor.fallbackApi.enabled']);
  $('imageMonitor-fallback-apiBase').value = d['imageMonitor.fallbackApi.apiBase'] || '';
  syncSecretInput('imageMonitor-fallback-apiKey', d['imageMonitor.fallbackApi.apiKey'], d['imageMonitor.fallbackApi.apiKeyConfigured'], '备用识别 API Key');
  $('imageMonitor-fallback-model').value = d['imageMonitor.fallbackApi.model'] || '';
  updateSwitchButton('imageMonitor-fallback-autoSwitchEnabled', d['imageMonitor.fallbackApi.autoSwitchEnabled']);
  $('imageMonitor-fallback-failureThreshold').value = d['imageMonitor.fallbackApi.failureThreshold'] || 2;
  $('imageMonitor-fallback-cooldownMs').value = d['imageMonitor.fallbackApi.cooldownMs'] || 300000;
  $('imageMonitor-violationAction').value = d['imageMonitor.violationAction'] || 'recall';
  $('imageMonitor-riskThreshold').value = d['imageMonitor.riskThreshold'] ?? '';
  updateSwitchButton('imageMonitor-monitorQuotedImages', d['imageMonitor.monitorQuotedImages']);
  $('imageMonitor-allowedGroups').value = formatListInput(d['imageMonitor.allowedGroups']);
  $('imageMonitor-blockedGroups').value = formatListInput(d['imageMonitor.blockedGroups']);
  $('imageMonitor-maxImagesPerMessage').value = d['imageMonitor.maxImagesPerMessage'] ?? '';
  $('imageMonitor-duplicateWindowMs').value = d['imageMonitor.duplicateWindowMs'] ?? '';
  $('imageMonitor-temperature').value = d['imageMonitor.temperature'] ?? '';
  $('imageMonitor-prompt').value = d['imageMonitor.prompt'] || '';
  syncImageMonitorStorageControls();

  updateSwitchButton('search-enabled', d['search.enabled']);
  $('search-apiUrl').value = d['search.apiUrl'] || '';
  syncSecretInput('search-apiKey', d['search.apiKey'], d['search.apiKeyConfigured'], '搜索服务 API Key');
  $('search-markdownApiUrl').value = d['search.markdownApiUrl'] || '';
  $('search-markdownStatusUrl').value = d['search.markdownStatusUrl'] || '';
  $('search-timeoutMs').value = d['search.timeoutMs'] || 60000;
  updateSwitchButton('search-fallback-enabled', d['search.fallbackApi.enabled']);
  $('search-fallback-apiUrl').value = d['search.fallbackApi.apiUrl'] || '';
  syncSecretInput('search-fallback-apiKey', d['search.fallbackApi.apiKey'], d['search.fallbackApi.apiKeyConfigured'], '备用搜索服务 API Key');
  $('search-fallback-markdownApiUrl').value = d['search.fallbackApi.markdownApiUrl'] || '';
  $('search-fallback-markdownStatusUrl').value = d['search.fallbackApi.markdownStatusUrl'] || '';
  updateSwitchButton('search-fallback-autoSwitchEnabled', d['search.fallbackApi.autoSwitchEnabled']);
  $('search-fallback-failureThreshold').value = d['search.fallbackApi.failureThreshold'] || 2;
  $('search-fallback-cooldownMs').value = d['search.fallbackApi.cooldownMs'] || 300000;

  $('meme-apiBase').value = d['ai.memeConfig.apiBase'] || '';
  updateSwitchButton('meme-localEnabled', d['ai.memeConfig.localEnabled']);
  updateSwitchButton('meme-preferLocal', d['ai.memeConfig.preferLocal']);
  $('meme-localBaseDir').value = d['ai.memeConfig.localBaseDir'] || 'data/chat/meme';
  updateSwitchButton('meme-fallback-enabled', d['ai.memeConfig.fallbackApi.enabled']);
  $('meme-fallback-apiBase').value = d['ai.memeConfig.fallbackApi.apiBase'] || '';
  updateSwitchButton('meme-fallback-autoSwitchEnabled', d['ai.memeConfig.fallbackApi.autoSwitchEnabled']);
  $('meme-fallback-failureThreshold').value = d['ai.memeConfig.fallbackApi.failureThreshold'] || 2;
  $('meme-fallback-cooldownMs').value = d['ai.memeConfig.fallbackApi.cooldownMs'] || 300000;

  syncImageModeFieldVisibility();
}

function syncImageModeFieldVisibility() {
  const modeByScope = {
    primary: String($('image-imageMode')?.value || 'openai').trim().toLowerCase(),
    fallback: String($('image-fallback-imageMode')?.value || 'openai').trim().toLowerCase(),
  };

  document.querySelectorAll('[data-image-mode-scope][data-image-modes]').forEach(item => {
    const scope = String(item.dataset.imageModeScope || 'primary');
    const supportedModes = String(item.dataset.imageModes || '')
      .split(/\s+/)
      .map(mode => mode.trim().toLowerCase())
      .filter(Boolean);
    const visible = supportedModes.includes(modeByScope[scope] || 'openai');

    item.classList.toggle('hidden', !visible);
    item.setAttribute('aria-hidden', visible ? 'false' : 'true');
    item.querySelectorAll('input, select, textarea, button').forEach(control => {
      control.disabled = !visible;
    });
  });

  document.querySelectorAll('#image-size option[data-image-option-modes]').forEach(option => {
    const supportedModes = String(option.dataset.imageOptionModes || '')
      .split(/\s+/)
      .filter(Boolean);
    const visible = supportedModes.includes(modeByScope.primary);
    option.hidden = !visible;
    option.disabled = !visible;
  });
}

function updateSwitchButton(id, enabled) {
  const btn = $(id);
  if (!btn) return;
  btn.classList.toggle('off', !enabled);
  btn.textContent = enabled ? '已开启' : '已关闭';
}

function updateDraftFromInputs() {
  const d = apiSettingsState.draft;

  d['ai.baseApi'] = $('ai-baseApi').value.trim();
  d['ai.apiKey'] = $('ai-apiKey').value.trim() || (d['ai.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['ai.userAgent'] = $('ai-userAgent').value.replace(/[\r\n\t\0-\x1F\x7F]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200);
  d['ai.modelType'] = $('ai-modelType').value.trim();
  d['ai.workingModel'] = $('ai-workingModel').value.trim();
  d['ai.multimodalModel'] = $('ai-multimodalModel').value.trim();
  d['ai.timeout'] = readNumberInput('ai-timeout', d['ai.timeout'] || 60000);
  d['ai.fallbackApi.baseApi'] = $('ai-fallback-baseApi').value.trim();
  d['ai.fallbackApi.apiKey'] = $('ai-fallback-apiKey').value.trim() || (d['ai.fallbackApi.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['ai.fallbackApi.modelType'] = $('ai-fallback-modelType').value.trim();
  d['ai.fallbackApi.workingModel'] = $('ai-fallback-workingModel').value.trim();
  d['ai.fallbackApi.multimodalModel'] = $('ai-fallback-multimodalModel').value.trim();
  d['ai.fallbackApi.failureThreshold'] = normalizeFallbackFailureThreshold($('ai-fallback-failureThreshold')?.value, d['ai.fallbackApi.failureThreshold'] || 2);
  d['ai.fallbackApi.cooldownMs'] = normalizeFallbackCooldownMs($('ai-fallback-cooldownMs')?.value, d['ai.fallbackApi.cooldownMs'] || 300000);

  d['ai.imageConfig.imageMode'] = $('image-imageMode').value;
  d['ai.imageConfig.model'] = $('image-model').value.trim();
  d['ai.imageConfig.baseApi'] = $('image-baseApi').value.trim();
  d['ai.imageConfig.jimengApiUrl'] = $('image-jimengApiUrl').value.trim();
  d['ai.imageConfig.apiKey'] = $('image-apiKey').value.trim() || (d['ai.imageConfig.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['ai.imageConfig.size'] = $('image-size').value;
  d['ai.imageConfig.quality'] = $('image-quality').value;
  d['ai.imageConfig.responseFormat'] = $('image-responseFormat').value;
  d['ai.imageConfig.outputFormat'] = $('image-outputFormat').value;
  d['ai.imageConfig.background'] = $('image-background').value;
  d['ai.imageConfig.sdWebUi.baseApi'] = $('image-sdWebUi-baseApi').value.trim();
  d['ai.imageConfig.sdWebUi.model'] = $('image-sdWebUi-model').value.trim();
  d['ai.imageConfig.sdWebUi.username'] = $('image-sdWebUi-username').value.trim();
  d['ai.imageConfig.sdWebUi.password'] = $('image-sdWebUi-password').value.trim() || (d['ai.imageConfig.sdWebUi.passwordConfigured'] ? SECRET_SENTINEL : '');
  d['ai.imageConfig.sdWebUi.samplerName'] = $('image-sdWebUi-samplerName').value.trim();
  d['ai.imageConfig.sdWebUi.scheduler'] = $('image-sdWebUi-scheduler').value;
  d['ai.imageConfig.sdWebUi.steps'] = readNumberInputBounded('image-sdWebUi-steps', d['ai.imageConfig.sdWebUi.steps'] || 20, 1, 150);
  d['ai.imageConfig.sdWebUi.cfgScale'] = readNumberInputBounded('image-sdWebUi-cfgScale', d['ai.imageConfig.sdWebUi.cfgScale'] || 7, 1, 30);
  d['ai.imageConfig.sdWebUi.width'] = readNumberInputBounded('image-sdWebUi-width', d['ai.imageConfig.sdWebUi.width'] || 1024, 64, 4096);
  d['ai.imageConfig.sdWebUi.height'] = readNumberInputBounded('image-sdWebUi-height', d['ai.imageConfig.sdWebUi.height'] || 1024, 64, 4096);
  d['ai.imageConfig.sdWebUi.negativePrompt'] = $('image-sdWebUi-negativePrompt').value.trim();
  d['ai.imageConfig.sdWebUi.seed'] = readNumberInputBounded('image-sdWebUi-seed', d['ai.imageConfig.sdWebUi.seed'] ?? -1, -1, 2147483647);
  d['ai.imageConfig.sdWebUi.denoisingStrength'] = readNumberInputBounded('image-sdWebUi-denoisingStrength', d['ai.imageConfig.sdWebUi.denoisingStrength'] ?? 0.7, 0, 1);
  d['ai.imageConfig.timeout'] = readNumberInput('image-timeout', d['ai.imageConfig.timeout'] || 60000);
  d['ai.imageConfig.fallbackReply'] = $('image-fallbackReply').value.trim();
  d['ai.imageConfig.fallbackTimeoutReply'] = $('image-fallbackTimeoutReply').value.trim();
  d['ai.imageConfig.fallbackApi.imageMode'] = $('image-fallback-imageMode').value;
  d['ai.imageConfig.fallbackApi.model'] = $('image-fallback-model').value.trim();
  d['ai.imageConfig.fallbackApi.baseApi'] = $('image-fallback-baseApi').value.trim();
  d['ai.imageConfig.fallbackApi.jimengApiUrl'] = $('image-fallback-jimengApiUrl').value.trim();
  d['ai.imageConfig.fallbackApi.apiKey'] = $('image-fallback-apiKey').value.trim() || (d['ai.imageConfig.fallbackApi.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['ai.imageConfig.fallbackApi.size'] = $('image-fallback-size').value;
  d['ai.imageConfig.fallbackApi.responseFormat'] = $('image-fallback-responseFormat').value;
  d['ai.imageConfig.fallbackApi.outputFormat'] = $('image-fallback-outputFormat').value;
  d['ai.imageConfig.fallbackApi.sdWebUi.baseApi'] = $('image-fallback-sdWebUi-baseApi').value.trim();
  d['ai.imageConfig.fallbackApi.sdWebUi.model'] = $('image-fallback-sdWebUi-model').value.trim();
  d['ai.imageConfig.fallbackApi.sdWebUi.username'] = $('image-fallback-sdWebUi-username').value.trim();
  d['ai.imageConfig.fallbackApi.sdWebUi.password'] = $('image-fallback-sdWebUi-password').value.trim() || (d['ai.imageConfig.fallbackApi.sdWebUi.passwordConfigured'] ? SECRET_SENTINEL : '');
  d['ai.imageConfig.fallbackApi.sdWebUi.samplerName'] = $('image-fallback-sdWebUi-samplerName').value.trim();
  d['ai.imageConfig.fallbackApi.sdWebUi.scheduler'] = $('image-fallback-sdWebUi-scheduler').value;
  d['ai.imageConfig.fallbackApi.sdWebUi.steps'] = readNumberInputBounded('image-fallback-sdWebUi-steps', d['ai.imageConfig.fallbackApi.sdWebUi.steps'] || 20, 1, 150);
  d['ai.imageConfig.fallbackApi.sdWebUi.cfgScale'] = readNumberInputBounded('image-fallback-sdWebUi-cfgScale', d['ai.imageConfig.fallbackApi.sdWebUi.cfgScale'] || 7, 1, 30);
  d['ai.imageConfig.fallbackApi.sdWebUi.width'] = readNumberInputBounded('image-fallback-sdWebUi-width', d['ai.imageConfig.fallbackApi.sdWebUi.width'] || 1024, 64, 4096);
  d['ai.imageConfig.fallbackApi.sdWebUi.height'] = readNumberInputBounded('image-fallback-sdWebUi-height', d['ai.imageConfig.fallbackApi.sdWebUi.height'] || 1024, 64, 4096);
  d['ai.imageConfig.fallbackApi.sdWebUi.negativePrompt'] = $('image-fallback-sdWebUi-negativePrompt').value.trim();
  d['ai.imageConfig.fallbackApi.sdWebUi.seed'] = readNumberInputBounded('image-fallback-sdWebUi-seed', d['ai.imageConfig.fallbackApi.sdWebUi.seed'] ?? -1, -1, 2147483647);
  d['ai.imageConfig.fallbackApi.sdWebUi.denoisingStrength'] = readNumberInputBounded('image-fallback-sdWebUi-denoisingStrength', d['ai.imageConfig.fallbackApi.sdWebUi.denoisingStrength'] ?? 0.7, 0, 1);
  d['ai.imageConfig.fallbackApi.failureThreshold'] = normalizeFallbackFailureThreshold($('image-fallback-failureThreshold')?.value, d['ai.imageConfig.fallbackApi.failureThreshold'] || 2);
  d['ai.imageConfig.fallbackApi.cooldownMs'] = normalizeFallbackCooldownMs($('image-fallback-cooldownMs')?.value, d['ai.imageConfig.fallbackApi.cooldownMs'] || 300000);

  d['imageMonitor.apiBase'] = $('imageMonitor-apiBase').value.trim();
  d['imageMonitor.apiKey'] = $('imageMonitor-apiKey').value.trim() || (d['imageMonitor.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['imageMonitor.model'] = $('imageMonitor-model').value.trim();
  d['imageMonitor.saveMemeCharacters'] = readListInput('imageMonitor-saveMemeCharacters');
  d['imageMonitor.saveMemeKeywords'] = readListInput('imageMonitor-saveMemeKeywords');
  d['imageMonitor.analysisTimeoutMs'] = readNumberInput('imageMonitor-analysisTimeoutMs', d['imageMonitor.analysisTimeoutMs'] || 30000);
  d['imageMonitor.fallbackReply'] = $('imageMonitor-fallbackReply').value.trim();
  d['imageMonitor.fallbackTimeoutReply'] = $('imageMonitor-fallbackTimeoutReply').value.trim();
  d['imageMonitor.fallbackApi.apiBase'] = $('imageMonitor-fallback-apiBase').value.trim();
  d['imageMonitor.fallbackApi.apiKey'] = $('imageMonitor-fallback-apiKey').value.trim() || (d['imageMonitor.fallbackApi.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['imageMonitor.fallbackApi.model'] = $('imageMonitor-fallback-model').value.trim();
  d['imageMonitor.fallbackApi.failureThreshold'] = normalizeFallbackFailureThreshold($('imageMonitor-fallback-failureThreshold')?.value, d['imageMonitor.fallbackApi.failureThreshold'] || 2);
  d['imageMonitor.fallbackApi.cooldownMs'] = normalizeFallbackCooldownMs($('imageMonitor-fallback-cooldownMs')?.value, d['imageMonitor.fallbackApi.cooldownMs'] || 300000);
  d['imageMonitor.violationAction'] = $('imageMonitor-violationAction').value;
  d['imageMonitor.riskThreshold'] = readNumberInputBounded('imageMonitor-riskThreshold', d['imageMonitor.riskThreshold'] ?? 0.7, 0, 1);
  d['imageMonitor.monitorQuotedImages'] = !document.getElementById('imageMonitor-monitorQuotedImages').classList.contains('off');
  d['imageMonitor.allowedGroups'] = readListInput('imageMonitor-allowedGroups');
  d['imageMonitor.blockedGroups'] = readListInput('imageMonitor-blockedGroups');
  d['imageMonitor.maxImagesPerMessage'] = readNumberInputBounded('imageMonitor-maxImagesPerMessage', d['imageMonitor.maxImagesPerMessage'] ?? 3, 1, 20);
  d['imageMonitor.duplicateWindowMs'] = readNumberInputBounded('imageMonitor-duplicateWindowMs', d['imageMonitor.duplicateWindowMs'] ?? 60000, 0);
  d['imageMonitor.temperature'] = readNumberInputBounded('imageMonitor-temperature', d['imageMonitor.temperature'] ?? 0.2, 0, 2);
  d['imageMonitor.prompt'] = $('imageMonitor-prompt').value;

  d['search.apiKey'] = $('search-apiKey').value.trim() || (d['search.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['search.apiUrl'] = $('search-apiUrl').value.trim();
  d['search.markdownApiUrl'] = $('search-markdownApiUrl').value.trim();
  d['search.markdownStatusUrl'] = $('search-markdownStatusUrl').value.trim();
  d['search.timeoutMs'] = readNumberInput('search-timeoutMs', d['search.timeoutMs'] || 60000);
  d['search.fallbackApi.apiKey'] = $('search-fallback-apiKey').value.trim() || (d['search.fallbackApi.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['search.fallbackApi.apiUrl'] = $('search-fallback-apiUrl').value.trim();
  d['search.fallbackApi.markdownApiUrl'] = $('search-fallback-markdownApiUrl').value.trim();
  d['search.fallbackApi.markdownStatusUrl'] = $('search-fallback-markdownStatusUrl').value.trim();
  d['search.fallbackApi.failureThreshold'] = normalizeFallbackFailureThreshold($('search-fallback-failureThreshold')?.value, d['search.fallbackApi.failureThreshold'] || 2);
  d['search.fallbackApi.cooldownMs'] = normalizeFallbackCooldownMs($('search-fallback-cooldownMs')?.value, d['search.fallbackApi.cooldownMs'] || 300000);

  d['ai.memeConfig.apiBase'] = $('meme-apiBase').value.trim();
  d['ai.memeConfig.localBaseDir'] = $('meme-localBaseDir').value.trim();
  d['ai.memeConfig.fallbackApi.apiBase'] = $('meme-fallback-apiBase').value.trim();
  d['ai.memeConfig.fallbackApi.failureThreshold'] = normalizeFallbackFailureThreshold($('meme-fallback-failureThreshold')?.value, d['ai.memeConfig.fallbackApi.failureThreshold'] || 2);
  d['ai.memeConfig.fallbackApi.cooldownMs'] = normalizeFallbackCooldownMs($('meme-fallback-cooldownMs')?.value, d['ai.memeConfig.fallbackApi.cooldownMs'] || 300000);
}
