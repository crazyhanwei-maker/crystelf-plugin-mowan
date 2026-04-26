const SECRET_SENTINEL = '******';

const apiSettingsState = {
  config: null,
  draft: {},
  activeSection: 'ai-main',
  testResults: {},
  localMemeScan: null,
  memeTestResult: null,
  memePullResult: null,
};

function buildHeaders(extra = {}) {
  return { ...extra };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: buildHeaders(),
  });
  const data = await response.json();
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || `${url} -> ${response.status}`);
  }
  return data;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || `${url} -> ${response.status}`);
  }
  return data;
}

function $(id) {
  return document.getElementById(id);
}

function maskApiKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text === SECRET_SENTINEL) return SECRET_SENTINEL;
  if (text.length <= 10) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 6)}***${text.slice(-4)}`;
}

function hasSecretValue(value, configured = false) {
  const text = String(value || '').trim();
  return Boolean(text && text !== SECRET_SENTINEL) || configured === true || text === SECRET_SENTINEL;
}

function getSecretDisplayText(value, configured = false, emptyText = '(未配置)') {
  const text = String(value || '').trim();
  if (text && text !== SECRET_SENTINEL) {
    return maskApiKey(text);
  }
  if (configured || text === SECRET_SENTINEL) {
    return `${SECRET_SENTINEL} (已配置，前端脱敏)`;
  }
  return emptyText;
}

function syncSecretInput(id, value, configured, placeholder) {
  const input = $(id);
  if (!(input instanceof HTMLInputElement)) return;
  const normalizedValue = String(value || '').trim();
  input.value = configured && normalizedValue === SECRET_SENTINEL ? '' : normalizedValue;
  input.placeholder = configured
    ? `${placeholder}，留空表示保持当前密钥`
    : placeholder;
}

function normalizePositiveNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.round(num);
}

function readNumberInput(id, fallback) {
  const input = $(id);
  if (!(input instanceof HTMLInputElement)) return fallback;
  return normalizePositiveNumber(input.value, fallback);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showRisk(message) {
  const el = $('api-settings-risk');
  const success = $('api-settings-success');
  if (!el || !success) return;
  el.textContent = message;
  el.classList.remove('hidden');
  success.classList.add('hidden');
}

function showSuccess(message) {
  const el = $('api-settings-success');
  const risk = $('api-settings-risk');
  if (!el || !risk) return;
  el.textContent = message;
  el.classList.remove('hidden');
  risk.classList.add('hidden');
}

function hideMessages() {
  $('api-settings-risk')?.classList.add('hidden');
  $('api-settings-success')?.classList.add('hidden');
}

function renderLocalMemeScan() {
  const meta = $('meme-local-scan-meta');
  const box = $('meme-local-scan-result');
  if (!meta || !box) return;

  const data = apiSettingsState.localMemeScan;
  if (!data) {
    meta.textContent = '尚未扫描';
    box.textContent = '点击“扫描本地目录”后，可查看角色、情绪目录和图片数量。';
    return;
  }

  if (data.pending) {
    meta.textContent = '扫描中...';
    box.textContent = '正在读取本地表情目录，请稍候。';
    return;
  }

  if (data.success === false) {
    meta.textContent = `扫描失败: ${data.error || '未知错误'}`;
    box.textContent = JSON.stringify(data, null, 2);
    return;
  }

  const summary = data.summary || {};
  const exists = data.exists !== false;
  const baseDir = data.resolvedBaseDir || apiSettingsState.draft['ai.memeConfig.localBaseDir'] || 'data/chat/meme';
  meta.textContent = exists
    ? `已扫描 ${summary.characterCount || 0} 个角色 / ${summary.totalImages || 0} 张图片`
    : '目录不存在或没有可用图片';
  box.textContent = JSON.stringify({
    resolvedBaseDir: baseDir,
    exists,
    summary,
    characters: data.characters || data.items || [],
  }, null, 2);
}

function getRecommendedMemeCharacter() {
  const memeConfig = apiSettingsState.config?.ai?.memeConfig || {};
  return String(
    memeConfig.character
    || memeConfig.defaultCharacter
    || memeConfig.personaCardName
    || memeConfig.botNickname
    || 'Bot'
  ).trim() || 'Bot';
}

function applyMemeTestDefaults() {
  const memeConfig = apiSettingsState.config?.ai?.memeConfig || {};
  const characterInput = $('meme-test-character');
  const emotionInput = $('meme-test-emotion');
  const pullCountInput = $('meme-pull-count');
  const recommendedCharacter = getRecommendedMemeCharacter();

  if (characterInput instanceof HTMLInputElement && !characterInput.value.trim()) {
    characterInput.placeholder = `例如：${recommendedCharacter}`;
    characterInput.value = recommendedCharacter;
  }

  if (emotionInput instanceof HTMLInputElement && !emotionInput.value.trim()) {
    const defaultEmotion = Array.isArray(memeConfig.availableEmotions) && memeConfig.availableEmotions.length > 0
      ? memeConfig.availableEmotions[0]
      : 'default';
    emotionInput.value = String(defaultEmotion || 'default').trim() || 'default';
  }

  if (pullCountInput instanceof HTMLInputElement && !pullCountInput.value.trim()) {
    pullCountInput.value = '1';
  }
}

function renderMemeTestResult() {
  const meta = $('meme-test-meta');
  const box = $('meme-test-result');
  if (!meta || !box) return;

  const data = apiSettingsState.memeTestResult;
  if (!data) {
    meta.textContent = '尚未测试';
    box.textContent = '点击“测试发图链路”后，可看到远程图是否能取到、本地是否有兜底，以及最终会走哪条发送路径。';
    return;
  }

  meta.textContent = data.detail || (data.success ? '测试完成' : '测试失败');
  box.textContent = [
    `角色: ${data.character || 'N/A'}`,
    `请求情绪: ${data.requestedEmotion || 'N/A'}`,
    `候选情绪: ${(data.emotionCandidates || []).join(', ') || 'N/A'}`,
    `远程 API: ${data.remote?.configured ? (data.remoteUsable ? '可用' : '不可用') : '未配置'}`,
    `远程 URL: ${data.remote?.resolvedUrl || 'N/A'}`,
    `远程探测: ${data.remote?.reachable
      ? `HTTP ${data.remote?.httpStatus || 200} / ${data.remote?.contentType || 'image/*'} / ${data.remote?.latencyMs || 0}ms`
      : (data.remote?.error || '失败')}`,
    `本地兜底: ${data.localUsable ? '可用' : (data.local?.enabled ? '未命中' : '已关闭')}`,
    `本地目录: ${data.local?.resolvedBaseDir || 'N/A'}`,
    `本地文件: ${data.local?.candidatePath || 'N/A'}`,
    `最终来源: ${data.final?.source || 'none'}`,
    `最终资源: ${data.final?.imagePath || 'N/A'}`,
    `结论: ${data.detail || data.error || 'N/A'}`,
  ].join('\n');
}

function renderMemePullResult() {
  const meta = $('meme-pull-meta');
  const box = $('meme-pull-result');
  if (!meta || !box) return;

  const data = apiSettingsState.memePullResult;
  if (!data) {
    meta.textContent = '尚未拉取';
    box.textContent = '点击“拉取到本地”后，会把远程表情图保存到本地目录，并显示每张图的来源地址与保存路径。';
    return;
  }

  if (data.pending) {
    meta.textContent = '拉取中...';
    box.textContent = '正在从远程表情服务下载并写入本地目录。';
    return;
  }

  meta.textContent = data.detail || (data.success ? '拉取完成' : '拉取失败');
  box.textContent = [
    `角色: ${data.character || 'N/A'}`,
    `请求情绪: ${data.requestedEmotion || 'default'}`,
    `请求数量: ${data.requestedCount || 0}`,
    `保存数量: ${data.savedCount || 0}`,
    `本地目录: ${data.local?.resolvedBaseDir || 'N/A'}`,
    `说明: ${data.detail || data.error || 'N/A'}`,
    ...(data.warning ? [`警告: ${data.warning}`] : []),
    '',
    ...(Array.isArray(data.items) && data.items.length > 0
      ? data.items.flatMap((item, index) => ([
          `#${index + 1} ${item.fileName || 'unnamed'}`,
          `情绪: ${item.emotion || 'default'}`,
          `来源: ${item.sourceUrl || 'N/A'}`,
          `路径: ${item.filePath || 'N/A'}`,
          `大小: ${item.bytes || 0} bytes`,
          '',
        ]))
      : ['没有保存任何图片。', '']),
    ...(Array.isArray(data.errors) && data.errors.length > 0 ? ['错误列表:', ...data.errors] : []),
  ].join('\n').trim();
}

function switchSection(sectionId) {
  apiSettingsState.activeSection = sectionId;

  document.querySelectorAll('.api-settings-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });

  document.querySelectorAll('.api-settings-section').forEach(section => {
    section.classList.toggle('hidden', section.id !== `section-${sectionId}`);
  });
}

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
  $('imageMonitor-apiBase').value = d['imageMonitor.apiBase'] || '';
  syncSecretInput('imageMonitor-apiKey', d['imageMonitor.apiKey'], d['imageMonitor.apiKeyConfigured'], 'sk-...');
  $('imageMonitor-model').value = d['imageMonitor.model'] || '';
  $('imageMonitor-analysisTimeoutMs').value = d['imageMonitor.analysisTimeoutMs'] || 30000;
  $('imageMonitor-fallbackReply').value = d['imageMonitor.fallbackReply'] || '';
  $('imageMonitor-fallbackTimeoutReply').value = d['imageMonitor.fallbackTimeoutReply'] || '';

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

function buildPreviewData() {
  const d = apiSettingsState.draft;

  return {
    'AI 主对话': {
      基础接入: {
        baseApi: d['ai.baseApi'] || '(未配置)',
        apiKey: getSecretDisplayText(d['ai.apiKey'], d['ai.apiKeyConfigured']),
        modelType: d['ai.modelType'] || '(未配置)',
        workingModel: d['ai.workingModel'] || '(未配置)',
        multimodalModel: d['ai.multimodalModel'] || '(未配置)',
      },
      超时: {
        timeout: d['ai.timeout'] || 60000,
      },
    },
    图像生成: {
      基础接入: {
        enabled: d['ai.imageConfig.enabled'],
        imageMode: d['ai.imageConfig.imageMode'],
        model: d['ai.imageConfig.model'] || '(未配置)',
        baseApi: d['ai.imageConfig.baseApi'] || '(复用主 API 或未配置)',
        jimengApiUrl: d['ai.imageConfig.jimengApiUrl'] || '(未配置)',
        apiKey: getSecretDisplayText(
          d['ai.imageConfig.apiKey'],
          d['ai.imageConfig.apiKeyConfigured'],
          '(复用主密钥或未配置)'
        ),
        size: d['ai.imageConfig.size'] || '1024x1024',
        quality: d['ai.imageConfig.quality'] || 'high',
        responseFormat: d['ai.imageConfig.responseFormat'] || 'b64_json',
        background: d['ai.imageConfig.background'] || '(不传)',
      },
      超时与保底: {
        timeout: d['ai.imageConfig.timeout'] || 60000,
        fallbackReply: d['ai.imageConfig.fallbackReply'] || '(默认保底)',
        fallbackTimeoutReply: d['ai.imageConfig.fallbackTimeoutReply'] || '(默认超时保底)',
      },
    },
    图片监控: {
      基础接入: {
        enabled: d['imageMonitor.enabled'],
        apiBase: d['imageMonitor.apiBase'] || '(未配置)',
        apiKey: getSecretDisplayText(d['imageMonitor.apiKey'], d['imageMonitor.apiKeyConfigured']),
        model: d['imageMonitor.model'] || '(未配置)',
      },
      超时与保底: {
        analysisTimeoutMs: d['imageMonitor.analysisTimeoutMs'] || 30000,
        fallbackReply: d['imageMonitor.fallbackReply'] || '(静默)',
        fallbackTimeoutReply: d['imageMonitor.fallbackTimeoutReply'] || '(静默)',
      },
    },
    搜索工具: {
      基础接入: {
        enabled: d['search.enabled'],
        apiKey: getSecretDisplayText(d['search.apiKey'], d['search.apiKeyConfigured']),
        markdownApiUrl: d['search.markdownApiUrl'] || '(未配置)',
        markdownStatusUrl: d['search.markdownStatusUrl'] || '(未配置)',
      },
      超时: {
        timeoutMs: d['search.timeoutMs'] || 60000,
      },
    },
    表情包: {
      基础接入: {
        apiBase: d['ai.memeConfig.apiBase'] || '(未配置)',
      },
      本地目录: {
        localEnabled: d['ai.memeConfig.localEnabled'],
        preferLocal: d['ai.memeConfig.preferLocal'],
        localBaseDir: d['ai.memeConfig.localBaseDir'] || 'data/chat/meme',
      },
    },
  };
}

function renderPreview() {
  const preview = buildPreviewData();
  $('api-settings-preview').textContent = JSON.stringify(preview, null, 2);
}

function buildApiOverview() {
  const d = apiSettingsState.draft;
  const sections = [];

  const mainIssues = [];
  if (!d['ai.baseApi']) mainIssues.push('缺少主对话 API 地址');
  if (!hasSecretValue(d['ai.apiKey'], d['ai.apiKeyConfigured'])) mainIssues.push('缺少主对话 API 密钥');
  if (!d['ai.modelType']) mainIssues.push('缺少主对话模型');
  sections.push({
    key: 'ai-main',
    title: 'AI 主对话',
    status: mainIssues.length > 0 ? 'critical' : 'healthy',
    summary: mainIssues.length > 0 ? '主链路未配置完整' : '主链路已可用于聊天',
    tags: [
      `超时 ${d['ai.timeout'] || 60000}ms`,
      d['ai.multimodalModel'] ? `多模态 ${d['ai.multimodalModel']}` : '未单独配置多模态模型',
    ],
    issues: mainIssues,
  });

  if (d['ai.imageConfig.enabled'] === false) {
    sections.push({
      key: 'ai-image',
      title: '图像生成',
      status: 'disabled',
      summary: '图像生成功能已关闭',
      tags: ['已禁用'],
      issues: [],
    });
  } else {
    const imageIssues = [];
    const imageWarnings = [];
    const imageMode = d['ai.imageConfig.imageMode'] || 'openai';
    const hasMainBaseApi = Boolean(d['ai.baseApi']);
    const hasMainApiKey = hasSecretValue(d['ai.apiKey'], d['ai.apiKeyConfigured']);
    const hasImageApiKey = hasSecretValue(d['ai.imageConfig.apiKey'], d['ai.imageConfig.apiKeyConfigured']);

    if (!d['ai.imageConfig.model']) imageIssues.push('缺少图像模型');
    if (imageMode === 'jimeng') {
      if (!d['ai.imageConfig.jimengApiUrl']) imageIssues.push('即梦模式缺少接口地址');
    } else {
      if (!d['ai.imageConfig.baseApi'] && !hasMainBaseApi) {
        imageIssues.push('缺少图像 API 地址，且主 API 地址也未配置');
      }
      if (!hasImageApiKey && !hasMainApiKey) {
        imageIssues.push('缺少图像 API 密钥，且主 API 密钥也未配置');
      }
    }
    if (!d['ai.imageConfig.fallbackReply']) imageWarnings.push('未单独配置图像失败保底文案');
    if (!d['ai.imageConfig.fallbackTimeoutReply']) imageWarnings.push('未单独配置图像超时保底文案');

    sections.push({
      key: 'ai-image',
      title: '图像生成',
      status: imageIssues.length > 0 ? 'critical' : (imageWarnings.length > 0 ? 'warning' : 'healthy'),
      summary: imageIssues.length > 0
        ? '图像生成仍有关键缺口'
        : (imageWarnings.length > 0 ? '图像生成可用，但保底文案仍可补齐' : '图像生成已配置完整'),
      tags: [
        `模式 ${imageMode}`,
        `超时 ${d['ai.imageConfig.timeout'] || 60000}ms`,
        imageMode === 'jimeng'
          ? '即梦接口'
          : (d['ai.imageConfig.baseApi'] ? '独立图像接口' : (hasMainBaseApi ? '复用主 API' : '未配置接口')),
        imageMode === 'jimeng'
          ? (hasImageApiKey ? '已配置即梦密钥' : '未配置即梦密钥')
          : (hasImageApiKey ? '独立图像密钥' : (hasMainApiKey ? '复用主密钥' : '未配置密钥')),
        `质量 ${d['ai.imageConfig.quality'] || 'high'}`,
        `格式 ${d['ai.imageConfig.responseFormat'] || 'b64_json'}`,
      ],
      issues: [...imageIssues, ...imageWarnings],
    });
  }

  if (!d['imageMonitor.enabled']) {
    sections.push({
      key: 'image-monitor',
      title: '图片监控',
      status: 'disabled',
      summary: '图片监控未启用',
      tags: ['已禁用'],
      issues: [],
    });
  } else {
    const monitorIssues = [];
    const monitorWarnings = [];
    if (!d['imageMonitor.apiBase']) monitorIssues.push('缺少图片监控 API 地址');
    if (!hasSecretValue(d['imageMonitor.apiKey'], d['imageMonitor.apiKeyConfigured'])) monitorIssues.push('缺少图片监控 API 密钥');
    if (!d['imageMonitor.model']) monitorIssues.push('缺少图片监控模型');
    if (!d['imageMonitor.fallbackReply']) monitorWarnings.push('识别失败时将保持静默');
    if (!d['imageMonitor.fallbackTimeoutReply']) monitorWarnings.push('识别超时时将保持静默');

    sections.push({
      key: 'image-monitor',
      title: '图片监控',
      status: monitorIssues.length > 0 ? 'critical' : (monitorWarnings.length > 0 ? 'warning' : 'healthy'),
      summary: monitorIssues.length > 0
        ? '图片监控仍有关键缺口'
        : (monitorWarnings.length > 0 ? '图片监控可用，但失败时仍偏静默' : '图片监控已配置完整'),
      tags: [
        `超时 ${d['imageMonitor.analysisTimeoutMs'] || 30000}ms`,
        d['imageMonitor.enabled'] ? '已启用' : '未启用',
      ],
      issues: [...monitorIssues, ...monitorWarnings],
    });
  }

  if (!d['search.enabled']) {
    sections.push({
      key: 'search',
      title: '搜索工具',
      status: 'disabled',
      summary: '联网搜索未启用',
      tags: ['已禁用'],
      issues: [],
    });
  } else {
    const searchWarnings = [];
    if (!hasSecretValue(d['search.apiKey'], d['search.apiKeyConfigured'])) searchWarnings.push('未配置搜索 API 密钥，部分服务可能无法鉴权');
    if (!d['search.markdownApiUrl']) searchWarnings.push('缺少 Markdown 提交地址');
    if (!d['search.markdownStatusUrl']) searchWarnings.push('缺少 Markdown 状态查询地址');

    sections.push({
      key: 'search',
      title: '搜索工具',
      status: searchWarnings.length > 0 ? 'warning' : 'healthy',
      summary: searchWarnings.length > 0 ? '搜索工具已启用，但网页读取链路仍有缺口' : '搜索工具已配置完整',
      tags: [
        `超时 ${d['search.timeoutMs'] || 60000}ms`,
        d['search.enabled'] ? '已启用' : '未启用',
      ],
      issues: searchWarnings,
    });
  }

  const memeRemoteConfigured = Boolean(d['ai.memeConfig.apiBase']);
  const memeLocalEnabled = d['ai.memeConfig.localEnabled'] !== false;
  const memeLocalConfigured = memeLocalEnabled && Boolean(String(d['ai.memeConfig.localBaseDir'] || '').trim());
  const memeIssues = [];
  if (!memeRemoteConfigured && !memeLocalConfigured) {
    memeIssues.push('远程 API 和本地目录至少需要配置一个');
  }
  sections.push({
    key: 'meme',
    title: '表情包',
    status: memeIssues.length > 0 ? 'warning' : 'healthy',
    summary: memeIssues.length > 0 ? '表情包链路尚未完整' : '表情包远程/本地链路可用',
    tags: [
      memeRemoteConfigured ? '远程 API 已配置' : '远程 API 未配置',
      memeLocalEnabled ? `本地目录 ${d['ai.memeConfig.preferLocal'] ? '优先' : '兜底'}` : '本地目录已关闭',
    ],
    issues: memeIssues,
  });

  const counts = {
    healthy: sections.filter(item => item.status === 'healthy').length,
    warning: sections.filter(item => item.status === 'warning').length,
    critical: sections.filter(item => item.status === 'critical').length,
    disabled: sections.filter(item => item.status === 'disabled').length,
  };

  return { sections, counts };
}

function getOverviewStateLabel(status) {
  switch (status) {
    case 'healthy':
      return '健康';
    case 'warning':
      return '待检查';
    case 'critical':
      return '有风险';
    case 'disabled':
      return '已关闭';
    default:
      return '未知';
  }
}

function renderApiOverview() {
  const overview = buildApiOverview();
  $('api-settings-overview-meta').innerHTML = [
    `<span class="api-settings-overview-chip tone-healthy">健康 ${overview.counts.healthy}</span>`,
    `<span class="api-settings-overview-chip tone-warning">警告 ${overview.counts.warning}</span>`,
    `<span class="api-settings-overview-chip tone-critical">风险 ${overview.counts.critical}</span>`,
    `<span class="api-settings-overview-chip tone-disabled">关闭 ${overview.counts.disabled}</span>`,
  ].join('');

  $('api-settings-overview-list').innerHTML = overview.sections.map(item => `
    <article class="api-settings-overview-item tone-${item.status}">
      <div class="api-settings-overview-head">
        <div>
          <h4>${escapeHtml(item.title)}</h4>
          <div class="setting-status">${escapeHtml(item.summary)}</div>
        </div>
        <span class="api-settings-overview-state tone-${item.status}">${escapeHtml(getOverviewStateLabel(item.status))}</span>
      </div>
      <div class="api-settings-overview-tags">
        ${(item.tags || []).map(tag => `<span class="api-settings-overview-tag">${escapeHtml(tag)}</span>`).join('')}
      </div>
      ${(item.issues || []).length > 0
        ? `<ul class="api-settings-overview-issues">${item.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>`
        : '<div class="setting-status">当前没有额外风险项。</div>'}
    </article>
  `).join('');
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
    renderLocalMemeScan();
    renderMemeTestResult();
    renderMemePullResult();
    checkInitialStatus();
    $('api-settings-meta').textContent = `最后更新 ${new Date().toLocaleString('zh-CN')}`;
  } catch (error) {
    showRisk(`加载失败: ${error.message}`);
  }
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
        },
        memeConfig: {
          apiBase: d['ai.memeConfig.apiBase'],
          localEnabled: d['ai.memeConfig.localEnabled'],
          preferLocal: d['ai.memeConfig.preferLocal'],
          localBaseDir: d['ai.memeConfig.localBaseDir'],
        },
      },
      imageMonitor: {
        enabled: d['imageMonitor.enabled'],
        apiBase: d['imageMonitor.apiBase'],
        apiKey: d['imageMonitor.apiKey'] === SECRET_SENTINEL ? '' : d['imageMonitor.apiKey'],
        preserveApiKey: d['imageMonitor.apiKey'] === SECRET_SENTINEL && d['imageMonitor.apiKeyConfigured'] === true,
        model: d['imageMonitor.model'],
        analysisTimeoutMs: d['imageMonitor.analysisTimeoutMs'],
        fallbackReply: d['imageMonitor.fallbackReply'],
        fallbackTimeoutReply: d['imageMonitor.fallbackTimeoutReply'],
      },
      coreConfig: {
        tools: {
          search: {
            enabled: d['search.enabled'],
            apiKey: d['search.apiKey'] === SECRET_SENTINEL ? '' : d['search.apiKey'],
            preserveApiKey: d['search.apiKey'] === SECRET_SENTINEL && d['search.apiKeyConfigured'] === true,
            markdownApiUrl: d['search.markdownApiUrl'],
            markdownStatusUrl: d['search.markdownStatusUrl'],
            timeoutMs: d['search.timeoutMs'],
          },
        },
      },
    };

    await postJson('/api/api-settings/save', payload);
    showSuccess('API 配置已保存，部分配置可能需要重启后完全生效。');
    await loadApiSettings();
  } catch (error) {
    showRisk(`保存失败: ${error.message}`);
  }
}

async function scanLocalMemeDirectory() {
  const payload = {
    localEnabled: apiSettingsState.draft['ai.memeConfig.localEnabled'],
    preferLocal: apiSettingsState.draft['ai.memeConfig.preferLocal'],
    localBaseDir: apiSettingsState.draft['ai.memeConfig.localBaseDir'],
  };

  apiSettingsState.localMemeScan = {
    pending: true,
    resolvedBaseDir: payload.localBaseDir || 'data/chat/meme',
  };
  renderLocalMemeScan();

  try {
    const result = await postJson('/api/api-settings/meme-local-scan', payload);
    apiSettingsState.localMemeScan = result;
    renderLocalMemeScan();
    if (result.success !== false) {
      showSuccess(result.exists
        ? `本地表情目录扫描完成：${result.summary?.characterCount || 0} 个角色`
        : '扫描完成：当前目录不存在或还没有图片');
    }
  } catch (error) {
    apiSettingsState.localMemeScan = {
      success: false,
      error: error.message,
    };
    renderLocalMemeScan();
    showRisk(`本地目录扫描失败: ${error.message}`);
  }
}

async function refreshLocalMemeScanSilently() {
  try {
    apiSettingsState.localMemeScan = await postJson('/api/api-settings/meme-local-scan', {
      localEnabled: apiSettingsState.draft['ai.memeConfig.localEnabled'],
      preferLocal: apiSettingsState.draft['ai.memeConfig.preferLocal'],
      localBaseDir: apiSettingsState.draft['ai.memeConfig.localBaseDir'],
    });
  } catch {
    apiSettingsState.localMemeScan = null;
  }
  renderLocalMemeScan();
}

function buildMemeTestPayload() {
  return {
    apiBase: apiSettingsState.draft['ai.memeConfig.apiBase'],
    localEnabled: apiSettingsState.draft['ai.memeConfig.localEnabled'],
    preferLocal: apiSettingsState.draft['ai.memeConfig.preferLocal'],
    localBaseDir: apiSettingsState.draft['ai.memeConfig.localBaseDir'],
    character: $('meme-test-character')?.value?.trim() || '',
    emotion: $('meme-test-emotion')?.value?.trim() || '',
  };
}

function buildMemePullPayload() {
  return {
    apiBase: apiSettingsState.draft['ai.memeConfig.apiBase'],
    localEnabled: apiSettingsState.draft['ai.memeConfig.localEnabled'],
    preferLocal: apiSettingsState.draft['ai.memeConfig.preferLocal'],
    localBaseDir: apiSettingsState.draft['ai.memeConfig.localBaseDir'],
    character: $('meme-test-character')?.value?.trim() || '',
    emotion: $('meme-test-emotion')?.value?.trim() || '',
    count: Math.min(readNumberInput('meme-pull-count', 1), 20),
  };
}

async function runMemeDeliveryTest() {
  try {
    updateDraftFromInputs();
    applyMemeTestDefaults();
    apiSettingsState.memeTestResult = null;
    renderMemeTestResult();
    showSuccess('正在测试表情发图链路...');
    updateStatusBadge('meme', 'testing');

    const result = await testMemeApi(buildMemeTestPayload());
    apiSettingsState.memeTestResult = result;
    apiSettingsState.testResults.meme = result;
    renderMemeTestResult();

    if (result.remoteUsable) {
      showSuccess(`表情 API 可用: ${result.detail}`);
      updateStatusBadge('meme', 'connected');
    } else if (result.localUsable) {
      showRisk(`远程不可用，但本地兜底可用: ${result.detail}`);
      updateStatusBadge('meme', 'warning');
    } else {
      showRisk(`表情发图链路不可用: ${result.error || result.detail || '未知错误'}`);
      updateStatusBadge('meme', 'failed');
    }
  } catch (error) {
    apiSettingsState.memeTestResult = {
      success: false,
      error: error.message,
      detail: error.message,
    };
    renderMemeTestResult();
    showRisk(`表情发图链路测试失败: ${error.message}`);
    updateStatusBadge('meme', 'failed');
  }
}

async function runMemePullToLocal() {
  try {
    updateDraftFromInputs();
    applyMemeTestDefaults();
    apiSettingsState.memePullResult = { pending: true };
    renderMemePullResult();
    showSuccess('正在从远程表情 API 拉取图片到本地...');

    const result = await pullMemeApi(buildMemePullPayload());
    apiSettingsState.memePullResult = result;
    renderMemePullResult();

    if (result.success) {
      await refreshLocalMemeScanSilently();
      updateStatusBadge('meme', 'connected');
      showSuccess(`表情图已保存到本地: ${result.detail}`);
    } else {
      updateStatusBadge('meme', 'failed');
      showRisk(`表情图拉取失败: ${result.error || result.detail || '未知错误'}`);
    }
  } catch (error) {
    apiSettingsState.memePullResult = {
      success: false,
      error: error.message,
      detail: error.message,
      errors: [error.message],
    };
    renderMemePullResult();
    updateStatusBadge('meme', 'failed');
    showRisk(`表情图拉取失败: ${error.message}`);
  }
}

async function testApiConnection() {
  try {
    showSuccess('正在测试主 API 连接...');
    updateStatusBadge('ai-main', 'testing');
    const result = await fetchJson('/api/api-settings/test');
    if (result.success) {
      showSuccess(`连接测试成功，模型: ${result.model || '未知'}，延迟: ${result.latencyMs || '?'}ms`);
      updateStatusBadge('ai-main', 'connected');
    } else {
      showRisk(`连接测试失败: ${result.error || '未知错误'}`);
      updateStatusBadge('ai-main', 'failed');
    }
  } catch (error) {
    showRisk(`测试失败: ${error.message}`);
    updateStatusBadge('ai-main', 'failed');
  }
}

function badgeIdForSection(section) {
  return `status-${section}`;
}

function updateStatusBadge(section, status) {
  const badge = $(badgeIdForSection(section));
  if (!badge) return;

  badge.className = 'status-badge';
  switch (status) {
    case 'connected':
      badge.classList.add('status-connected');
      badge.textContent = 'Connected';
      break;
    case 'failed':
      badge.classList.add('status-failed');
      badge.textContent = 'Failed';
      break;
    case 'testing':
      badge.classList.add('status-testing');
      badge.textContent = 'Testing';
      break;
    case 'configured':
      badge.classList.add('status-configured');
      badge.textContent = 'Configured';
      break;
    case 'warning':
      badge.classList.add('status-warning');
      badge.textContent = 'Check';
      break;
    case 'risk':
      badge.classList.add('status-risk');
      badge.textContent = 'Risk';
      break;
    case 'disabled':
      badge.classList.add('status-disabled');
      badge.textContent = 'Disabled';
      break;
    case 'not-configured':
      badge.classList.add('status-not-configured');
      badge.textContent = 'Not configured';
      break;
    default:
      badge.textContent = '';
      break;
  }
}

function checkInitialStatus() {
  const overview = buildApiOverview();
  const statusMap = Object.fromEntries(overview.sections.map(item => [item.key, item.status]));
  const normalizeStatus = value => {
    if (value === 'critical') return 'risk';
    if (value === 'warning') return 'warning';
    if (value === 'disabled') return 'disabled';
    return 'configured';
  };

  updateStatusBadge('ai-main', normalizeStatus(statusMap['ai-main']));
  updateStatusBadge('ai-image', normalizeStatus(statusMap['ai-image']));
  updateStatusBadge('image-monitor', normalizeStatus(statusMap['image-monitor']));
  updateStatusBadge('search', normalizeStatus(statusMap['search']));
  updateStatusBadge('meme', normalizeStatus(statusMap['meme']));
}

async function testImageApi() {
  try {
    return await fetchJson('/api/api-settings/test-image');
  } catch {
    return { success: false, error: '测试接口不可用' };
  }
}

async function testImageMonitorApi() {
  try {
    return await fetchJson('/api/api-settings/test-image-monitor');
  } catch {
    return { success: false, error: '测试接口不可用' };
  }
}

async function testSearchApi() {
  try {
    return await fetchJson('/api/api-settings/test-search');
  } catch {
    return { success: false, error: '测试接口不可用' };
  }
}

async function testMemeApi(payload = null) {
  try {
    if (payload) {
      return await postJson('/api/api-settings/test-meme', payload);
    }
    return await fetchJson('/api/api-settings/test-meme');
  } catch {
    return { success: false, error: '测试接口不可用' };
  }
}

async function pullMemeApi(payload) {
  try {
    return await postJson('/api/api-settings/meme-pull', payload);
  } catch {
    return { success: false, error: '拉取接口不可用' };
  }
}

function renderBatchTestResults(results) {
  const listContainer = $('batch-test-list');
  const successCount = results.filter(item => item.status === 'success').length;
  const failedCount = results.filter(item => item.status === 'failed').length;
  const skippedCount = results.filter(item => item.status === 'skipped').length;

  let html = `<div class="batch-summary">成功: ${successCount} | 失败: ${failedCount} | 跳过: ${skippedCount}</div>`;
  html += '<div class="batch-list">';

  for (const result of results) {
    const statusClass = result.status === 'success'
      ? 'result-success'
      : (result.status === 'failed' ? 'result-failed' : 'result-skipped');
    const statusText = result.status === 'success'
      ? 'OK'
      : (result.status === 'failed' ? 'NO' : '--');

    html += `
      <div class="batch-item ${statusClass}">
        <span class="batch-status">${statusText}</span>
        <span class="batch-name">${escapeHtml(result.name)}</span>
        <span class="batch-detail">${escapeHtml(result.detail || '')}</span>
      </div>
    `;
  }

  html += '</div>';
  listContainer.innerHTML = html;

  if (failedCount === 0 && successCount > 0) {
    showSuccess(`批量测试完成: ${successCount} 项连接正常`);
  } else if (failedCount > 0) {
    showRisk(`批量测试完成: ${successCount} 成功, ${failedCount} 失败`);
  }
}

async function batchTestAllApis() {
  updateDraftFromInputs();
  $('batch-test-results').classList.remove('hidden');
  $('batch-test-list').innerHTML = '<div class="loading">正在测试所有 API 连接...</div>';

  const results = [];
  const d = apiSettingsState.draft;

  updateStatusBadge('ai-main', 'testing');
  try {
    const result = await fetchJson('/api/api-settings/test');
    if (result.success) {
      results.push({
        name: 'AI 主对话',
        status: 'success',
        detail: `模型: ${result.model || '未知'}, 延迟: ${result.latencyMs || '?'}ms`,
      });
      updateStatusBadge('ai-main', 'connected');
    } else {
      results.push({ name: 'AI 主对话', status: 'failed', detail: result.error || '未知错误' });
      updateStatusBadge('ai-main', 'failed');
    }
  } catch (error) {
    results.push({ name: 'AI 主对话', status: 'failed', detail: error.message });
    updateStatusBadge('ai-main', 'failed');
  }

  const canTestImageApi = d['ai.imageConfig.imageMode'] === 'jimeng'
    ? Boolean(d['ai.imageConfig.jimengApiUrl'])
    : Boolean(d['ai.imageConfig.baseApi'] || d['ai.baseApi']);
  if (canTestImageApi) {
    updateStatusBadge('ai-image', 'testing');
    try {
      const imageResult = await testImageApi();
      if (imageResult.success) {
        results.push({ name: '图像生成', status: 'success', detail: imageResult.detail || '连接正常' });
        updateStatusBadge('ai-image', 'connected');
      } else {
        results.push({ name: '图像生成', status: 'failed', detail: imageResult.error || '未知错误' });
        updateStatusBadge('ai-image', 'failed');
      }
    } catch (error) {
      results.push({ name: '图像生成', status: 'failed', detail: error.message });
      updateStatusBadge('ai-image', 'failed');
    }
  } else {
    results.push({ name: '图像生成', status: 'skipped', detail: '未配置可测试的图像接口地址' });
  }

  if (d['imageMonitor.enabled'] && d['imageMonitor.apiBase']) {
    updateStatusBadge('image-monitor', 'testing');
    try {
      const monitorResult = await testImageMonitorApi();
      if (monitorResult.success) {
        results.push({ name: '图片监控', status: 'success', detail: monitorResult.detail || '连接正常' });
        updateStatusBadge('image-monitor', 'connected');
      } else {
        results.push({ name: '图片监控', status: 'failed', detail: monitorResult.error || '未知错误' });
        updateStatusBadge('image-monitor', 'failed');
      }
    } catch (error) {
      results.push({ name: '图片监控', status: 'failed', detail: error.message });
      updateStatusBadge('image-monitor', 'failed');
    }
  } else {
    results.push({ name: '图片监控', status: 'skipped', detail: '未启用或缺少接口地址' });
  }

  if (d['search.enabled']) {
    updateStatusBadge('search', 'testing');
    try {
      const searchResult = await testSearchApi();
      if (searchResult.success) {
        results.push({ name: '搜索工具', status: 'success', detail: searchResult.detail || '连接正常' });
        updateStatusBadge('search', 'connected');
      } else {
        results.push({ name: '搜索工具', status: 'failed', detail: searchResult.error || '未知错误' });
        updateStatusBadge('search', 'failed');
      }
    } catch (error) {
      results.push({ name: '搜索工具', status: 'failed', detail: error.message });
      updateStatusBadge('search', 'failed');
    }
  } else {
    results.push({ name: '搜索工具', status: 'skipped', detail: '未启用' });
  }

  if (d['ai.memeConfig.apiBase']) {
    updateStatusBadge('meme', 'testing');
    try {
      const memeResult = await testMemeApi(buildMemeTestPayload());
      if (memeResult.success) {
        results.push({ name: '表情包', status: 'success', detail: memeResult.detail || '连接正常' });
        updateStatusBadge('meme', 'connected');
      } else {
        results.push({ name: '表情包', status: 'failed', detail: memeResult.error || '未知错误' });
        updateStatusBadge('meme', 'failed');
      }
    } catch (error) {
      results.push({ name: '表情包', status: 'failed', detail: error.message });
      updateStatusBadge('meme', 'failed');
    }
  } else if (d['ai.memeConfig.localEnabled'] && d['ai.memeConfig.localBaseDir']) {
    results.push({ name: '表情包', status: 'skipped', detail: '仅配置了本地目录，远程 API 未配置' });
  } else {
    results.push({ name: '表情包', status: 'skipped', detail: '未配置' });
  }

  renderBatchTestResults(results);
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

  if (target.id === 'imageMonitor-enabled') {
    apiSettingsState.draft['imageMonitor.enabled'] = !apiSettingsState.draft['imageMonitor.enabled'];
    updateSwitchButton('imageMonitor-enabled', apiSettingsState.draft['imageMonitor.enabled']);
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
