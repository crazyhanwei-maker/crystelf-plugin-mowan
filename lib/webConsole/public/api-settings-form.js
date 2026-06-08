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

    'imageMonitor.enabled': imageMonitor.enabled === true,
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

    'ai.memeConfig.apiBase': meme.apiBase || '',
    'ai.memeConfig.localEnabled': meme.localEnabled !== false,
    'ai.memeConfig.preferLocal': meme.preferLocal === true,
    'ai.memeConfig.localBaseDir': meme.localBaseDir || 'data/chat/meme',
    'ai.memeConfig.fallbackApi.enabled': memeFallback.enabled === true,
    'ai.memeConfig.fallbackApi.apiBase': memeFallback.apiBase || '',
  };
}

function syncInputsFromDraft() {
  const d = apiSettingsState.draft;

  $('ai-baseApi').value = d['ai.baseApi'] || '';
  syncSecretInput('ai-apiKey', d['ai.apiKey'], d['ai.apiKeyConfigured'], 'sk-...');
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

  $('image-imageMode').value = d['ai.imageConfig.imageMode'] || 'openai';
  $('image-model').value = d['ai.imageConfig.model'] || '';
  $('image-baseApi').value = d['ai.imageConfig.baseApi'] || '';
  $('image-jimengApiUrl').value = d['ai.imageConfig.jimengApiUrl'] || '';
  syncSecretInput('image-apiKey', d['ai.imageConfig.apiKey'], d['ai.imageConfig.apiKeyConfigured'], 'sk-...');
  $('image-size').value = d['ai.imageConfig.size'] || '1024x1024';
  $('image-quality').value = d['ai.imageConfig.quality'] || 'high';
  $('image-responseFormat').value = d['ai.imageConfig.responseFormat'] || 'b64_json';
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

  updateSwitchButton('imageMonitor-enabled', d['imageMonitor.enabled']);
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

  $('meme-apiBase').value = d['ai.memeConfig.apiBase'] || '';
  updateSwitchButton('meme-localEnabled', d['ai.memeConfig.localEnabled']);
  updateSwitchButton('meme-preferLocal', d['ai.memeConfig.preferLocal']);
  $('meme-localBaseDir').value = d['ai.memeConfig.localBaseDir'] || 'data/chat/meme';
  updateSwitchButton('meme-fallback-enabled', d['ai.memeConfig.fallbackApi.enabled']);
  $('meme-fallback-apiBase').value = d['ai.memeConfig.fallbackApi.apiBase'] || '';
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
  d['ai.modelType'] = $('ai-modelType').value.trim();
  d['ai.workingModel'] = $('ai-workingModel').value.trim();
  d['ai.multimodalModel'] = $('ai-multimodalModel').value.trim();
  d['ai.timeout'] = readNumberInput('ai-timeout', d['ai.timeout'] || 60000);
  d['ai.fallbackApi.baseApi'] = $('ai-fallback-baseApi').value.trim();
  d['ai.fallbackApi.apiKey'] = $('ai-fallback-apiKey').value.trim() || (d['ai.fallbackApi.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['ai.fallbackApi.modelType'] = $('ai-fallback-modelType').value.trim();
  d['ai.fallbackApi.workingModel'] = $('ai-fallback-workingModel').value.trim();
  d['ai.fallbackApi.multimodalModel'] = $('ai-fallback-multimodalModel').value.trim();

  d['ai.imageConfig.imageMode'] = $('image-imageMode').value;
  d['ai.imageConfig.model'] = $('image-model').value.trim();
  d['ai.imageConfig.baseApi'] = $('image-baseApi').value.trim();
  d['ai.imageConfig.jimengApiUrl'] = $('image-jimengApiUrl').value.trim();
  d['ai.imageConfig.apiKey'] = $('image-apiKey').value.trim() || (d['ai.imageConfig.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['ai.imageConfig.size'] = $('image-size').value;
  d['ai.imageConfig.quality'] = $('image-quality').value;
  d['ai.imageConfig.responseFormat'] = $('image-responseFormat').value;
  d['ai.imageConfig.background'] = $('image-background').value;
  d['ai.imageConfig.timeout'] = readNumberInput('image-timeout', d['ai.imageConfig.timeout'] || 60000);
  d['ai.imageConfig.fallbackReply'] = $('image-fallbackReply').value.trim();
  d['ai.imageConfig.fallbackTimeoutReply'] = $('image-fallbackTimeoutReply').value.trim();
  d['ai.imageConfig.fallbackApi.imageMode'] = $('image-fallback-imageMode').value;
  d['ai.imageConfig.fallbackApi.model'] = $('image-fallback-model').value.trim();
  d['ai.imageConfig.fallbackApi.baseApi'] = $('image-fallback-baseApi').value.trim();
  d['ai.imageConfig.fallbackApi.jimengApiUrl'] = $('image-fallback-jimengApiUrl').value.trim();
  d['ai.imageConfig.fallbackApi.apiKey'] = $('image-fallback-apiKey').value.trim() || (d['ai.imageConfig.fallbackApi.apiKeyConfigured'] ? SECRET_SENTINEL : '');

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

  d['search.apiKey'] = $('search-apiKey').value.trim() || (d['search.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['search.apiUrl'] = $('search-apiUrl').value.trim();
  d['search.markdownApiUrl'] = $('search-markdownApiUrl').value.trim();
  d['search.markdownStatusUrl'] = $('search-markdownStatusUrl').value.trim();
  d['search.timeoutMs'] = readNumberInput('search-timeoutMs', d['search.timeoutMs'] || 60000);
  d['search.fallbackApi.apiKey'] = $('search-fallback-apiKey').value.trim() || (d['search.fallbackApi.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['search.fallbackApi.apiUrl'] = $('search-fallback-apiUrl').value.trim();
  d['search.fallbackApi.markdownApiUrl'] = $('search-fallback-markdownApiUrl').value.trim();
  d['search.fallbackApi.markdownStatusUrl'] = $('search-fallback-markdownStatusUrl').value.trim();

  d['ai.memeConfig.apiBase'] = $('meme-apiBase').value.trim();
  d['ai.memeConfig.localBaseDir'] = $('meme-localBaseDir').value.trim();
  d['ai.memeConfig.fallbackApi.apiBase'] = $('meme-fallback-apiBase').value.trim();
}
