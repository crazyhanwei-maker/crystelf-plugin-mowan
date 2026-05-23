function loadDraftFromConfig() {
  const cfg = apiSettingsState.config || {};
  const ai = cfg.ai || {};
  const image = ai.imageConfig || {};
  const imageMonitor = cfg.imageMonitor || {};
  const search = cfg.coreConfig?.tools?.search || {};
  const meme = ai.memeConfig || {};

  apiSettingsState.draft = {
    'ai.baseApi': ai.baseApi || '',
    'ai.apiKey': ai.apiKeyConfigured === true ? SECRET_SENTINEL : (ai.apiKey || ''),
    'ai.apiKeyConfigured': ai.apiKeyConfigured === true,
    'ai.modelType': ai.modelType || '',
    'ai.workingModel': ai.workingModel || '',
    'ai.multimodalModel': ai.multimodalModel || '',
    'ai.timeout': normalizePositiveNumber(ai.timeout, 60000),

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

    'search.enabled': search.enabled === true,
    'search.apiKey': search.apiKeyConfigured === true ? SECRET_SENTINEL : (search.apiKey || ''),
    'search.apiKeyConfigured': search.apiKeyConfigured === true,
    'search.markdownApiUrl': search.markdownApiUrl || '',
    'search.markdownStatusUrl': search.markdownStatusUrl || '',
    'search.timeoutMs': normalizePositiveNumber(search.timeoutMs, 60000),

    'ai.memeConfig.apiBase': meme.apiBase || '',
    'ai.memeConfig.localEnabled': meme.localEnabled !== false,
    'ai.memeConfig.preferLocal': meme.preferLocal === true,
    'ai.memeConfig.localBaseDir': meme.localBaseDir || 'data/chat/meme',
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

  updateSwitchButton('search-enabled', d['search.enabled']);
  syncSecretInput('search-apiKey', d['search.apiKey'], d['search.apiKeyConfigured'], '搜索服务 API Key');
  $('search-markdownApiUrl').value = d['search.markdownApiUrl'] || '';
  $('search-markdownStatusUrl').value = d['search.markdownStatusUrl'] || '';
  $('search-timeoutMs').value = d['search.timeoutMs'] || 60000;

  $('meme-apiBase').value = d['ai.memeConfig.apiBase'] || '';
  updateSwitchButton('meme-localEnabled', d['ai.memeConfig.localEnabled']);
  updateSwitchButton('meme-preferLocal', d['ai.memeConfig.preferLocal']);
  $('meme-localBaseDir').value = d['ai.memeConfig.localBaseDir'] || 'data/chat/meme';
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

  d['imageMonitor.apiBase'] = $('imageMonitor-apiBase').value.trim();
  d['imageMonitor.apiKey'] = $('imageMonitor-apiKey').value.trim() || (d['imageMonitor.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['imageMonitor.model'] = $('imageMonitor-model').value.trim();
  d['imageMonitor.saveMemeCharacters'] = readListInput('imageMonitor-saveMemeCharacters');
  d['imageMonitor.saveMemeKeywords'] = readListInput('imageMonitor-saveMemeKeywords');
  d['imageMonitor.analysisTimeoutMs'] = readNumberInput('imageMonitor-analysisTimeoutMs', d['imageMonitor.analysisTimeoutMs'] || 30000);
  d['imageMonitor.fallbackReply'] = $('imageMonitor-fallbackReply').value.trim();
  d['imageMonitor.fallbackTimeoutReply'] = $('imageMonitor-fallbackTimeoutReply').value.trim();

  d['search.apiKey'] = $('search-apiKey').value.trim() || (d['search.apiKeyConfigured'] ? SECRET_SENTINEL : '');
  d['search.markdownApiUrl'] = $('search-markdownApiUrl').value.trim();
  d['search.markdownStatusUrl'] = $('search-markdownStatusUrl').value.trim();
  d['search.timeoutMs'] = readNumberInput('search-timeoutMs', d['search.timeoutMs'] || 60000);

  d['ai.memeConfig.apiBase'] = $('meme-apiBase').value.trim();
  d['ai.memeConfig.localBaseDir'] = $('meme-localBaseDir').value.trim();
}
