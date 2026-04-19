const apiSettingsState = {
  config: null,
  draft: {},
  activeSection: 'ai-main',
  testResults: {},
  localMemeScan: null,
  memeTestResult: null,
  memePullResult: null,
};

function getAuthToken() {
  return localStorage.getItem('crystelf-web-console-token') || '';
}

function buildHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store', headers: buildHeaders() });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return await response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(data.error || `${url} -> ${response.status}`);
  return data;
}

function maskApiKey(key) {
  if (!key || key.length < 10) return key || '';
  return `${key.slice(0, 6)}***${key.slice(-4)}`;
}

function normalizePositiveNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.round(num);
}

function readNumberInput(id, fallback) {
  const input = document.getElementById(id);
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
  const el = document.getElementById('api-settings-risk');
  el.textContent = message;
  el.classList.remove('hidden');
  document.getElementById('api-settings-success').classList.add('hidden');
}

function showSuccess(message) {
  const el = document.getElementById('api-settings-success');
  el.textContent = message;
  el.classList.remove('hidden');
  document.getElementById('api-settings-risk').classList.add('hidden');
}

function hideMessages() {
  document.getElementById('api-settings-risk').classList.add('hidden');
  document.getElementById('api-settings-success').classList.add('hidden');
}

function renderLocalMemeScan() {
  const meta = document.getElementById('meme-local-scan-meta');
  const box = document.getElementById('meme-local-scan-result');
  if (!meta || !box) return;

  const data = apiSettingsState.localMemeScan;
  if (!data) {
    meta.textContent = '尚未扫描';
    box.textContent = '点击“扫描本地目录”后，可查看角色、情绪目录和图片数量。';
    return;
  }

  if (data.success === false) {
    meta.textContent = `扫描失败：${data.error || '未知错误'}`;
    box.textContent = JSON.stringify(data, null, 2);
    return;
  }

  const summary = data.summary || {};
  const headline = data.exists
    ? `已扫描：${summary.characterCount || 0} 个角色 / ${summary.totalImages || 0} 张图片`
    : '目录不存在，尚未扫描到本地图片';
  meta.textContent = `${headline} · 解析目录：${data.resolvedBaseDir || '(空)'}`;
  box.textContent = JSON.stringify(data, null, 2);
}

function getRecommendedMemeCharacter() {
  const memeConfig = apiSettingsState.config?.ai?.memeConfig || {};
  return String(
    memeConfig.defaultCharacter
    || memeConfig.recommendedCharacter
    || memeConfig.personaCardName
    || memeConfig.botNickname
    || memeConfig.character
    || '芙宁娜'
  ).trim() || '芙宁娜';
}

function applyMemeTestDefaults() {
  const memeConfig = apiSettingsState.config?.ai?.memeConfig || {};
  const characterInput = document.getElementById('meme-test-character');
  const emotionInput = document.getElementById('meme-test-emotion');
  const pullCountInput = document.getElementById('meme-pull-count');
  const recommendedCharacter = getRecommendedMemeCharacter();
  if (characterInput && !characterInput.value.trim()) {
    characterInput.placeholder = recommendedCharacter || '例如：芙宁娜';
    characterInput.value = recommendedCharacter;
  }
  if (emotionInput && !emotionInput.value.trim()) {
    const defaultEmotion = Array.isArray(memeConfig.availableEmotions) && memeConfig.availableEmotions.length > 0
      ? memeConfig.availableEmotions[0]
      : 'default';
    emotionInput.value = String(defaultEmotion || 'default').trim() || 'default';
  }
  if (pullCountInput && !pullCountInput.value.trim()) {
    pullCountInput.value = '1';
  }
}

function renderMemeTestResult() {
  const meta = document.getElementById('meme-test-meta');
  const box = document.getElementById('meme-test-result');
  if (!meta || !box) return;

  const data = apiSettingsState.memeTestResult;
  if (!data) {
    meta.textContent = '尚未测试';
    box.textContent = '点击“测试发图链路”后，可看到远程图是否能取到、本地是否有兜底，以及最终会走哪条发送路径。';
    return;
  }

  meta.textContent = data.detail || (data.success ? '测试完成' : '测试失败');
  box.textContent = [
    `测试角色: ${data.character || '暂无'}`,
    `测试情绪: ${data.requestedEmotion || '暂无'}`,
    `候选情绪: ${(data.emotionCandidates || []).join(', ') || '暂无'}`,
    `远程 API: ${data.remote?.configured ? (data.remoteUsable ? '可用' : '不可用') : '未配置'}`,
    `远程地址: ${data.remote?.resolvedUrl || '未解析到图片地址'}`,
    `远程检测: ${data.remote?.reachable ? `HTTP ${data.remote?.httpStatus || 200} / ${data.remote?.contentType || 'image/*'} / ${data.remote?.latencyMs || 0}ms` : (data.remote?.error || '未通过')}`,
    `本地兜底: ${data.localUsable ? '可用' : (data.local?.enabled ? '未找到匹配图' : '已关闭')}`,
    `本地目录: ${data.local?.resolvedBaseDir || '暂无'}`,
    `本地图: ${data.local?.candidatePath || '未找到'}`,
    `最终路径: ${data.final?.source || 'none'}`,
    `最终资源: ${data.final?.imagePath || '暂无'}`,
    `结论: ${data.detail || data.error || '暂无'}`,
  ].join('\n');
}

function renderMemePullResult() {
  const meta = document.getElementById('meme-pull-meta');
  const box = document.getElementById('meme-pull-result');
  if (!meta || !box) return;

  const data = apiSettingsState.memePullResult;
  if (!data) {
    meta.textContent = '尚未拉取';
    box.textContent = '点击“拉取到本地”后，会把远程表情图保存到“本地表情包目录/角色/情绪/”下，并显示每张图的来源地址与保存路径。';
    return;
  }

  if (data.pending) {
    meta.textContent = '正在拉取...';
    box.textContent = '正在从远程表情 API 下载图片并写入本地目录，请稍候。';
    return;
  }

  meta.textContent = data.detail || (data.success ? '拉取完成' : '拉取失败');
  box.textContent = [
    `角色: ${data.character || '暂无'}`,
    `请求情绪: ${data.requestedEmotion || 'default'}`,
    `请求数量: ${data.requestedCount || 0}`,
    `保存数量: ${data.savedCount || 0}`,
    `本地目录: ${data.local?.resolvedBaseDir || '暂无'}`,
    `说明: ${data.detail || data.error || '暂无'}`,
    ...(data.warning ? [`警告: ${data.warning}`] : []),
    '',
    ...(Array.isArray(data.items) && data.items.length > 0
      ? data.items.flatMap((item, index) => ([
          `#${index + 1} ${item.fileName || 'unnamed'}`,
          `情绪: ${item.emotion || 'default'}`,
          `来源: ${item.sourceUrl || '暂无'}`,
          `路径: ${item.filePath || '暂无'}`,
          `大小: ${item.bytes || 0} bytes`,
          '',
        ]))
      : ['暂无成功保存的图片', '']),
    ...(Array.isArray(data.errors) && data.errors.length > 0
      ? ['错误信息:', ...data.errors]
      : []),
  ].join('\n').trim();
}

function switchSection(sectionId) {
  apiSettingsState.activeSection = sectionId;
  
  // 更新导航按钮状态
  document.querySelectorAll('.api-settings-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });
  
  // 显示对应区域
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
    // AI 主对话
    'ai.baseApi': ai.baseApi || '',
    'ai.apiKey': ai.apiKey || '',
    'ai.modelType': ai.modelType || '',
    'ai.workingModel': ai.workingModel || '',
    'ai.multimodalModel': ai.multimodalModel || '',
    'ai.timeout': normalizePositiveNumber(ai.timeout, 60000),
    
    // 图像生成
    'ai.imageConfig.enabled': image.enabled !== false,
    'ai.imageConfig.imageMode': image.imageMode || 'openai',
    'ai.imageConfig.model': image.model || '',
    'ai.imageConfig.baseApi': image.baseApi || '',
    'ai.imageConfig.jimengApiUrl': image.jimengApiUrl || '',
    'ai.imageConfig.apiKey': image.apiKey || '',
    'ai.imageConfig.size': image.size || '1024x1024',
    'ai.imageConfig.timeout': normalizePositiveNumber(image.timeout, 60000),
    'ai.imageConfig.fallbackReply': image.fallbackReply || '',
    'ai.imageConfig.fallbackTimeoutReply': image.fallbackTimeoutReply || '',
    
    // 图片监控
    'imageMonitor.enabled': imageMonitor.enabled === true,
    'imageMonitor.apiBase': imageMonitor.apiBase || '',
    'imageMonitor.apiKey': imageMonitor.apiKey || '',
    'imageMonitor.model': imageMonitor.model || '',
    'imageMonitor.analysisTimeoutMs': normalizePositiveNumber(imageMonitor.analysisTimeoutMs, 30000),
    'imageMonitor.fallbackReply': imageMonitor.fallbackReply || '',
    'imageMonitor.fallbackTimeoutReply': imageMonitor.fallbackTimeoutReply || '',
    
    // 搜索工具
    'search.enabled': search.enabled === true,
    'search.apiKey': search.apiKey || '',
    'search.markdownApiUrl': search.markdownApiUrl || '',
    'search.markdownStatusUrl': search.markdownStatusUrl || '',
    'search.timeoutMs': normalizePositiveNumber(search.timeoutMs, 60000),
    
    // 表情包
    'ai.memeConfig.apiBase': meme.apiBase || '',
    'ai.memeConfig.localEnabled': meme.localEnabled !== false,
    'ai.memeConfig.preferLocal': meme.preferLocal === true,
    'ai.memeConfig.localBaseDir': meme.localBaseDir || 'data/chat/meme',
  };
}

function syncInputsFromDraft() {
  const d = apiSettingsState.draft;
  
  // AI 主对话
  document.getElementById('ai-baseApi').value = d['ai.baseApi'] || '';
  document.getElementById('ai-apiKey').value = d['ai.apiKey'] || '';
  document.getElementById('ai-modelType').value = d['ai.modelType'] || '';
  document.getElementById('ai-workingModel').value = d['ai.workingModel'] || '';
  document.getElementById('ai-multimodalModel').value = d['ai.multimodalModel'] || '';
  document.getElementById('ai-timeout').value = d['ai.timeout'] || 60000;
  
  // 图像生成
  document.getElementById('image-imageMode').value = d['ai.imageConfig.imageMode'] || 'openai';
  document.getElementById('image-model').value = d['ai.imageConfig.model'] || '';
  document.getElementById('image-baseApi').value = d['ai.imageConfig.baseApi'] || '';
  document.getElementById('image-jimengApiUrl').value = d['ai.imageConfig.jimengApiUrl'] || '';
  document.getElementById('image-apiKey').value = d['ai.imageConfig.apiKey'] || '';
  document.getElementById('image-size').value = d['ai.imageConfig.size'] || '1024x1024';
  document.getElementById('image-timeout').value = d['ai.imageConfig.timeout'] || 60000;
  document.getElementById('image-fallbackReply').value = d['ai.imageConfig.fallbackReply'] || '';
  document.getElementById('image-fallbackTimeoutReply').value = d['ai.imageConfig.fallbackTimeoutReply'] || '';
  
  // 图片监控
  updateSwitchButton('imageMonitor-enabled', d['imageMonitor.enabled']);
  document.getElementById('imageMonitor-apiBase').value = d['imageMonitor.apiBase'] || '';
  document.getElementById('imageMonitor-apiKey').value = d['imageMonitor.apiKey'] || '';
  document.getElementById('imageMonitor-model').value = d['imageMonitor.model'] || '';
  document.getElementById('imageMonitor-analysisTimeoutMs').value = d['imageMonitor.analysisTimeoutMs'] || 30000;
  document.getElementById('imageMonitor-fallbackReply').value = d['imageMonitor.fallbackReply'] || '';
  document.getElementById('imageMonitor-fallbackTimeoutReply').value = d['imageMonitor.fallbackTimeoutReply'] || '';
  
  // 搜索工具
  updateSwitchButton('search-enabled', d['search.enabled']);
  document.getElementById('search-apiKey').value = d['search.apiKey'] || '';
  document.getElementById('search-markdownApiUrl').value = d['search.markdownApiUrl'] || '';
  document.getElementById('search-markdownStatusUrl').value = d['search.markdownStatusUrl'] || '';
  document.getElementById('search-timeoutMs').value = d['search.timeoutMs'] || 60000;
  
  // 表情包
  document.getElementById('meme-apiBase').value = d['ai.memeConfig.apiBase'] || '';
  updateSwitchButton('meme-localEnabled', d['ai.memeConfig.localEnabled']);
  updateSwitchButton('meme-preferLocal', d['ai.memeConfig.preferLocal']);
  document.getElementById('meme-localBaseDir').value = d['ai.memeConfig.localBaseDir'] || 'data/chat/meme';
  if (document.getElementById('meme-pull-count')) {
    document.getElementById('meme-pull-count').value = document.getElementById('meme-pull-count').value || '1';
  }
}

function updateSwitchButton(id, enabled) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.toggle('off', !enabled);
  btn.textContent = enabled ? '已开启' : '已关闭';
}

function updateDraftFromInputs() {
  const d = apiSettingsState.draft;
  
  // AI 主对话
  d['ai.baseApi'] = document.getElementById('ai-baseApi').value.trim();
  d['ai.apiKey'] = document.getElementById('ai-apiKey').value.trim();
  d['ai.modelType'] = document.getElementById('ai-modelType').value.trim();
  d['ai.workingModel'] = document.getElementById('ai-workingModel').value.trim();
  d['ai.multimodalModel'] = document.getElementById('ai-multimodalModel').value.trim();
  d['ai.timeout'] = readNumberInput('ai-timeout', d['ai.timeout'] || 60000);
  
  // 图像生成
  d['ai.imageConfig.imageMode'] = document.getElementById('image-imageMode').value;
  d['ai.imageConfig.model'] = document.getElementById('image-model').value.trim();
  d['ai.imageConfig.baseApi'] = document.getElementById('image-baseApi').value.trim();
  d['ai.imageConfig.jimengApiUrl'] = document.getElementById('image-jimengApiUrl').value.trim();
  d['ai.imageConfig.apiKey'] = document.getElementById('image-apiKey').value.trim();
  d['ai.imageConfig.size'] = document.getElementById('image-size').value;
  d['ai.imageConfig.timeout'] = readNumberInput('image-timeout', d['ai.imageConfig.timeout'] || 60000);
  d['ai.imageConfig.fallbackReply'] = document.getElementById('image-fallbackReply').value.trim();
  d['ai.imageConfig.fallbackTimeoutReply'] = document.getElementById('image-fallbackTimeoutReply').value.trim();
  
  // 图片监控
  d['imageMonitor.apiBase'] = document.getElementById('imageMonitor-apiBase').value.trim();
  d['imageMonitor.apiKey'] = document.getElementById('imageMonitor-apiKey').value.trim();
  d['imageMonitor.model'] = document.getElementById('imageMonitor-model').value.trim();
  d['imageMonitor.analysisTimeoutMs'] = readNumberInput('imageMonitor-analysisTimeoutMs', d['imageMonitor.analysisTimeoutMs'] || 30000);
  d['imageMonitor.fallbackReply'] = document.getElementById('imageMonitor-fallbackReply').value.trim();
  d['imageMonitor.fallbackTimeoutReply'] = document.getElementById('imageMonitor-fallbackTimeoutReply').value.trim();
  
  // 搜索工具
  d['search.apiKey'] = document.getElementById('search-apiKey').value.trim();
  d['search.markdownApiUrl'] = document.getElementById('search-markdownApiUrl').value.trim();
  d['search.markdownStatusUrl'] = document.getElementById('search-markdownStatusUrl').value.trim();
  d['search.timeoutMs'] = readNumberInput('search-timeoutMs', d['search.timeoutMs'] || 60000);
  
  // 表情包
  d['ai.memeConfig.apiBase'] = document.getElementById('meme-apiBase').value.trim();
  d['ai.memeConfig.localBaseDir'] = document.getElementById('meme-localBaseDir').value.trim();
}

function buildPreviewData() {
  const d = apiSettingsState.draft;
  return {
    'AI 主对话': {
      '基础接入': {
        baseApi: d['ai.baseApi'] || '(未配置)',
        apiKey: d['ai.apiKey'] ? maskApiKey(d['ai.apiKey']) : '(未配置)',
        modelType: d['ai.modelType'] || '(未配置)',
        workingModel: d['ai.workingModel'] || '(未配置)',
        multimodalModel: d['ai.multimodalModel'] || '(未配置)',
      },
      '超时': {
        timeout: d['ai.timeout'] || 60000,
      },
    },
    '图像生成': {
      '基础接入': {
        enabled: d['ai.imageConfig.enabled'],
        imageMode: d['ai.imageConfig.imageMode'],
        model: d['ai.imageConfig.model'] || '(未配置)',
        baseApi: d['ai.imageConfig.baseApi'] || '(使用主API)',
        jimengApiUrl: d['ai.imageConfig.jimengApiUrl'] || '(未配置)',
        apiKey: d['ai.imageConfig.apiKey'] ? maskApiKey(d['ai.imageConfig.apiKey']) : '(复用主密钥)',
        size: d['ai.imageConfig.size'] || '1024x1024',
      },
      '超时与保底': {
        timeout: d['ai.imageConfig.timeout'] || 60000,
        fallbackReply: d['ai.imageConfig.fallbackReply'] || '(回退到 AI 通用保底)',
        fallbackTimeoutReply: d['ai.imageConfig.fallbackTimeoutReply'] || '(回退到 AI 通用超时保底)',
      },
    },
    '图片监控': {
      '基础接入': {
        enabled: d['imageMonitor.enabled'],
        apiBase: d['imageMonitor.apiBase'] || '(未配置)',
        apiKey: d['imageMonitor.apiKey'] ? maskApiKey(d['imageMonitor.apiKey']) : '(未配置)',
        model: d['imageMonitor.model'] || '(未配置)',
      },
      '超时与保底': {
        analysisTimeoutMs: d['imageMonitor.analysisTimeoutMs'] || 30000,
        fallbackReply: d['imageMonitor.fallbackReply'] || '(静默)',
        fallbackTimeoutReply: d['imageMonitor.fallbackTimeoutReply'] || '(静默)',
      },
    },
    '搜索工具': {
      '基础接入': {
        enabled: d['search.enabled'],
        apiKey: d['search.apiKey'] ? maskApiKey(d['search.apiKey']) : '(未配置)',
        markdownApiUrl: d['search.markdownApiUrl'] || '(未配置)',
        markdownStatusUrl: d['search.markdownStatusUrl'] || '(未配置)',
      },
      '超时': {
        timeoutMs: d['search.timeoutMs'] || 60000,
      },
    },
    '表情包': {
      '基础接入': {
        apiBase: d['ai.memeConfig.apiBase'] || '(未配置)',
      },
      '本地目录': {
        localEnabled: d['ai.memeConfig.localEnabled'],
        preferLocal: d['ai.memeConfig.preferLocal'],
        localBaseDir: d['ai.memeConfig.localBaseDir'] || 'data/chat/meme',
      },
    },
  };
}

function renderPreview() {
  const preview = buildPreviewData();
  document.getElementById('api-settings-preview').textContent = JSON.stringify(preview, null, 2);
}

function buildApiOverview() {
  const d = apiSettingsState.draft;
  const sections = [];

  const aiMissing = [];
  if (!d['ai.baseApi']) aiMissing.push('缺少主对话 API 地址');
  if (!d['ai.apiKey']) aiMissing.push('缺少主对话 API 密钥');
  if (!d['ai.modelType']) aiMissing.push('缺少主对话文本模型');
  sections.push({
    key: 'ai-main',
    title: 'AI 主对话',
    status: aiMissing.length > 0 ? 'critical' : 'healthy',
    summary: aiMissing.length > 0 ? '主链路还没配完整' : '主链路已完整，可直接用于聊天',
    tags: [
      `超时 ${d['ai.timeout'] || 60000}ms`,
      d['ai.multimodalModel'] ? `多模态 ${d['ai.multimodalModel']}` : '多模态未单独配置',
    ],
    issues: aiMissing,
  });

  if (d['ai.imageConfig.enabled'] === false) {
    sections.push({
      key: 'ai-image',
      title: '图像生成',
      status: 'disabled',
      summary: '图像生成当前已关闭',
      tags: ['已禁用'],
      issues: [],
    });
  } else {
    const imageIssues = [];
    const imageMode = d['ai.imageConfig.imageMode'] || 'openai';
    const hasMainBaseApi = Boolean(d['ai.baseApi']);
    const hasMainApiKey = Boolean(d['ai.apiKey']);
    if (!d['ai.imageConfig.model']) imageIssues.push('缺少图像模型');
    if (imageMode === 'jimeng') {
      if (!d['ai.imageConfig.jimengApiUrl']) imageIssues.push('即梦模式缺少接口地址');
    } else {
      if (!d['ai.imageConfig.baseApi'] && !hasMainBaseApi) {
        imageIssues.push('缺少图像 API 地址，且主 AI 地址也未配置');
      }
      if (!d['ai.imageConfig.apiKey'] && !hasMainApiKey) {
        imageIssues.push('缺少图像 API 密钥，且主 AI 密钥也未配置');
      }
    }
    const imageWarnings = [];
    if (!d['ai.imageConfig.fallbackReply']) imageWarnings.push('未单独配置图像失败保底，将回退到 AI 通用保底');
    if (!d['ai.imageConfig.fallbackTimeoutReply']) imageWarnings.push('未单独配置图像超时保底，将回退到 AI 通用超时保底');
    sections.push({
      key: 'ai-image',
      title: '图像生成',
      status: imageIssues.length > 0 ? 'critical' : (imageWarnings.length > 0 ? 'warning' : 'healthy'),
      summary: imageIssues.length > 0 ? '图像生成还有关键缺口' : (imageWarnings.length > 0 ? '图像生成可用，但保底文案还可继续补齐' : '图像生成已完整'),
      tags: [
        `模式 ${imageMode}`,
        `超时 ${d['ai.imageConfig.timeout'] || 60000}ms`,
        imageMode === 'jimeng'
          ? '即梦接口'
          : (d['ai.imageConfig.baseApi'] ? '独立图像接口' : (hasMainBaseApi ? '复用主 API' : '未填独立图像接口')),
        imageMode === 'jimeng'
          ? (d['ai.imageConfig.apiKey'] ? '已填即梦密钥' : '即梦密钥可选')
          : (d['ai.imageConfig.apiKey'] ? '独立图像密钥' : (hasMainApiKey ? '复用主密钥' : '未填独立图像密钥')),
      ],
      issues: [...imageIssues, ...imageWarnings],
    });
  }

  if (!d['imageMonitor.enabled']) {
    sections.push({
      key: 'image-monitor',
      title: '图片监控',
      status: 'disabled',
      summary: '图片监控当前未启用',
      tags: ['已禁用'],
      issues: [],
    });
  } else {
    const monitorIssues = [];
    if (!d['imageMonitor.apiBase']) monitorIssues.push('缺少图片监控 API 地址');
    if (!d['imageMonitor.apiKey']) monitorIssues.push('缺少图片监控 API 密钥');
    if (!d['imageMonitor.model']) monitorIssues.push('缺少图片监控模型');
    const monitorWarnings = [];
    if (!d['imageMonitor.fallbackReply']) monitorWarnings.push('识别失败时保持静默');
    if (!d['imageMonitor.fallbackTimeoutReply']) monitorWarnings.push('识别超时时保持静默');
    sections.push({
      key: 'image-monitor',
      title: '图片监控',
      status: monitorIssues.length > 0 ? 'critical' : (monitorWarnings.length > 0 ? 'warning' : 'healthy'),
      summary: monitorIssues.length > 0 ? '图片监控还有关键缺口' : (monitorWarnings.length > 0 ? '图片监控已可用，但失败时仍可能静默' : '图片监控已完整'),
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
      summary: '联网搜索当前未启用',
      tags: ['已禁用'],
      issues: [],
    });
  } else {
    const searchWarnings = [];
    if (!d['search.apiKey']) searchWarnings.push('未填写搜索 API 密钥，部分服务可能无法鉴权');
    if (!d['search.markdownApiUrl']) searchWarnings.push('缺少 Markdown 提交地址，网页读取链路不完整');
    if (!d['search.markdownStatusUrl']) searchWarnings.push('缺少 Markdown 状态查询地址，网页读取链路不完整');
    sections.push({
      key: 'search',
      title: '搜索工具',
      status: searchWarnings.length > 0 ? 'warning' : 'healthy',
      summary: searchWarnings.length > 0 ? '搜索工具已启用，但网页读取或鉴权还有缺口' : '搜索工具已完整',
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
    summary: memeIssues.length > 0 ? '表情包链路还不完整' : '表情包远程 / 本地能力已可用',
    tags: [
      memeRemoteConfigured ? '远程 API 已配置' : '远程 API 未配置',
      memeLocalEnabled ? `本地目录 ${d['ai.memeConfig.preferLocal'] ? '优先' : '回退'}` : '本地目录已关闭',
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

function renderApiOverview() {
  const overview = buildApiOverview();
  document.getElementById('api-settings-overview-meta').innerHTML = [
    `<span class="api-settings-overview-chip tone-healthy">健康 ${overview.counts.healthy}</span>`,
    `<span class="api-settings-overview-chip tone-warning">警告 ${overview.counts.warning}</span>`,
    `<span class="api-settings-overview-chip tone-critical">风险 ${overview.counts.critical}</span>`,
    `<span class="api-settings-overview-chip tone-disabled">未启用 ${overview.counts.disabled}</span>`,
  ].join('');

  document.getElementById('api-settings-overview-list').innerHTML = overview.sections.map(item => `
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
      ${(item.issues || []).length > 0 ? `<ul class="api-settings-overview-issues">${item.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : '<div class="setting-status">当前没有额外风险项。</div>'}
    </article>
  `).join('');
}

function getOverviewStateLabel(status) {
  switch (status) {
    case 'healthy':
      return '健康';
    case 'warning':
      return '需检查';
    case 'critical':
      return '有风险';
    case 'disabled':
      return '未启用';
    default:
      return '未知';
  }
}

async function loadApiSettings() {
  try {
    const data = await fetchJson('/api/api-settings');
    apiSettingsState.config = data;
    apiSettingsState.localMemeScan = null;
    apiSettingsState.memeTestResult = null;
    apiSettingsState.memePullResult = null;
    loadDraftFromConfig();
    syncInputsFromDraft();
    applyMemeTestDefaults();
    renderPreview();
    renderLocalMemeScan();
    renderMemeTestResult();
    renderMemePullResult();
    document.getElementById('api-settings-meta').textContent = `最后更新: ${new Date().toLocaleString('zh-CN')}`;
  } catch (error) {
    showRisk(`加载失败: ${error.message}`);
  }
}

async function saveApiSettings() {
  try {
    updateDraftFromInputs();
    const d = apiSettingsState.draft;
    
    // 验证必填项
    if (!d['ai.baseApi'] || !d['ai.apiKey'] || !d['ai.modelType']) {
      showRisk('AI 主对话的 API 地址、密钥和模型为必填项');
      return;
    }
    
    const payload = {
      ai: {
        baseApi: d['ai.baseApi'],
        apiKey: d['ai.apiKey'],
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
          apiKey: d['ai.imageConfig.apiKey'],
          size: d['ai.imageConfig.size'],
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
        apiKey: d['imageMonitor.apiKey'],
        model: d['imageMonitor.model'],
        analysisTimeoutMs: d['imageMonitor.analysisTimeoutMs'],
        fallbackReply: d['imageMonitor.fallbackReply'],
        fallbackTimeoutReply: d['imageMonitor.fallbackTimeoutReply'],
      },
      coreConfig: {
        tools: {
          search: {
            enabled: d['search.enabled'],
            apiKey: d['search.apiKey'],
            markdownApiUrl: d['search.markdownApiUrl'],
            markdownStatusUrl: d['search.markdownStatusUrl'],
            timeoutMs: d['search.timeoutMs'],
          },
        },
      },
    };
    
    await postJson('/api/api-settings/save', payload);
    showSuccess('API 配置已保存，部分配置可能需要重启后完全生效');
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
    success: true,
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
        ? `本地表情包目录扫描完成：${result.summary?.characterCount || 0} 个角色`
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
    character: document.getElementById('meme-test-character')?.value?.trim() || '',
    emotion: document.getElementById('meme-test-emotion')?.value?.trim() || '',
  };
}

function buildMemePullPayload() {
  return {
    apiBase: apiSettingsState.draft['ai.memeConfig.apiBase'],
    localEnabled: apiSettingsState.draft['ai.memeConfig.localEnabled'],
    preferLocal: apiSettingsState.draft['ai.memeConfig.preferLocal'],
    localBaseDir: apiSettingsState.draft['ai.memeConfig.localBaseDir'],
    character: document.getElementById('meme-test-character')?.value?.trim() || '',
    emotion: document.getElementById('meme-test-emotion')?.value?.trim() || '',
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
      showSuccess(`表情 API 图可用: ${result.detail}`);
      updateStatusBadge('meme', 'connected');
    } else if (result.localUsable) {
      showRisk(`远程图当前不可用，但本地可兜底: ${result.detail}`);
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
    apiSettingsState.memePullResult = {
      pending: true,
    };
    renderMemePullResult();
    showSuccess('正在从远程表情 API 拉取图片到本地目录...');
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
    showSuccess('正在测试连接...');
    const result = await fetchJson('/api/api-settings/test');
    if (result.success) {
      showSuccess(`连接测试成功! 模型: ${result.model || '未知'}, 延迟: ${result.latencyMs || '?'}ms`);
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

function updateStatusBadge(section, status) {
  const badge = document.getElementById(`status-${section}`);
  if (!badge) return;
  
  badge.className = 'status-badge';
  switch (status) {
    case 'connected':
      badge.classList.add('status-connected');
      badge.textContent = '已连接';
      break;
    case 'failed':
      badge.classList.add('status-failed');
      badge.textContent = '连接失败';
      break;
    case 'testing':
      badge.classList.add('status-testing');
      badge.textContent = '测试中...';
      break;
    case 'configured':
      badge.classList.add('status-configured');
      badge.textContent = '已就绪';
      break;
    case 'warning':
      badge.classList.add('status-warning');
      badge.textContent = '需检查';
      break;
    case 'risk':
      badge.classList.add('status-risk');
      badge.textContent = '有风险';
      break;
    case 'disabled':
      badge.classList.add('status-disabled');
      badge.textContent = '未启用';
      break;
    case 'not-configured':
      badge.classList.add('status-not-configured');
      badge.textContent = '未配置';
      break;
    default:
      badge.textContent = '';
  }
}

function checkInitialStatus() {
  const overview = buildApiOverview();
  const statusMap = Object.fromEntries(overview.sections.map(item => [item.key, item.status]));
  updateStatusBadge('ai-main', statusMap['ai-main'] === 'critical' ? 'risk' : statusMap['ai-main'] === 'warning' ? 'warning' : statusMap['ai-main'] === 'disabled' ? 'disabled' : 'configured');
  updateStatusBadge('ai-image', statusMap['ai-image'] === 'critical' ? 'risk' : statusMap['ai-image'] === 'warning' ? 'warning' : statusMap['ai-image'] === 'disabled' ? 'disabled' : 'configured');
  updateStatusBadge('image-monitor', statusMap['image-monitor'] === 'critical' ? 'risk' : statusMap['image-monitor'] === 'warning' ? 'warning' : statusMap['image-monitor'] === 'disabled' ? 'disabled' : 'configured');
  updateStatusBadge('search', statusMap['search'] === 'critical' ? 'risk' : statusMap['search'] === 'warning' ? 'warning' : statusMap['search'] === 'disabled' ? 'disabled' : 'configured');
  updateStatusBadge('meme', statusMap['meme'] === 'critical' ? 'risk' : statusMap['meme'] === 'warning' ? 'warning' : statusMap['meme'] === 'disabled' ? 'disabled' : 'configured');
}

async function batchTestAllApis() {
  updateDraftFromInputs();
  const resultsContainer = document.getElementById('batch-test-results');
  const listContainer = document.getElementById('batch-test-list');
  
  resultsContainer.classList.remove('hidden');
  listContainer.innerHTML = '<div class="loading">正在测试所有 API 连接...</div>';
  
  const results = [];
  
  // 测试 AI 主对话
  updateStatusBadge('ai-main', 'testing');
  try {
    const result = await fetchJson('/api/api-settings/test');
    if (result.success) {
      results.push({ name: 'AI 主对话', status: 'success', detail: `模型: ${result.model}, 延迟: ${result.latencyMs}ms` });
      updateStatusBadge('ai-main', 'connected');
    } else {
      results.push({ name: 'AI 主对话', status: 'failed', detail: result.error });
      updateStatusBadge('ai-main', 'failed');
    }
  } catch (error) {
    results.push({ name: 'AI 主对话', status: 'failed', detail: error.message });
    updateStatusBadge('ai-main', 'failed');
  }
  
  // 测试图像生成 API
  const d = apiSettingsState.draft;
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
        results.push({ name: '图像生成', status: 'failed', detail: imageResult.error });
        updateStatusBadge('ai-image', 'failed');
      }
    } catch (error) {
      results.push({ name: '图像生成', status: 'failed', detail: error.message });
      updateStatusBadge('ai-image', 'failed');
    }
  } else {
    results.push({ name: '图像生成', status: 'skipped', detail: '未配置独立 API' });
  }
  
  // 测试图片监控 API
  if (d['imageMonitor.enabled'] && d['imageMonitor.apiBase']) {
    updateStatusBadge('image-monitor', 'testing');
    try {
      const monitorResult = await testImageMonitorApi();
      if (monitorResult.success) {
        results.push({ name: '图片监控', status: 'success', detail: monitorResult.detail || '连接正常' });
        updateStatusBadge('image-monitor', 'connected');
      } else {
        results.push({ name: '图片监控', status: 'failed', detail: monitorResult.error });
        updateStatusBadge('image-monitor', 'failed');
      }
    } catch (error) {
      results.push({ name: '图片监控', status: 'failed', detail: error.message });
      updateStatusBadge('image-monitor', 'failed');
    }
  } else {
    results.push({ name: '图片监控', status: 'skipped', detail: '未启用或未配置' });
  }
  
  // 测试搜索工具 API
  if (d['search.enabled'] && d['search.apiKey']) {
    updateStatusBadge('search', 'testing');
    try {
      const searchResult = await testSearchApi();
      if (searchResult.success) {
        results.push({ name: '搜索工具', status: 'success', detail: searchResult.detail || '连接正常' });
        updateStatusBadge('search', 'connected');
      } else {
        results.push({ name: '搜索工具', status: 'failed', detail: searchResult.error });
        updateStatusBadge('search', 'failed');
      }
    } catch (error) {
      results.push({ name: '搜索工具', status: 'failed', detail: error.message });
      updateStatusBadge('search', 'failed');
    }
  } else {
    results.push({ name: '搜索工具', status: 'skipped', detail: '未启用或未配置' });
  }
  
  // 测试表情包 API
  if (d['ai.memeConfig.apiBase']) {
    updateStatusBadge('meme', 'testing');
    try {
      const memeResult = await testMemeApi(buildMemeTestPayload());
      if (memeResult.success) {
        results.push({ name: '表情包', status: 'success', detail: memeResult.detail || '连接正常' });
        updateStatusBadge('meme', 'connected');
      } else {
        results.push({ name: '表情包', status: 'failed', detail: memeResult.error });
        updateStatusBadge('meme', 'failed');
      }
    } catch (error) {
      results.push({ name: '表情包', status: 'failed', detail: error.message });
      updateStatusBadge('meme', 'failed');
    }
  } else {
    results.push({ name: '表情包', status: 'skipped', detail: '未配置' });
  }
  
  // 渲染结果
  renderBatchTestResults(results);
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
  const listContainer = document.getElementById('batch-test-list');
  
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;
  const skippedCount = results.filter(r => r.status === 'skipped').length;
  
  let html = `<div class="batch-summary">成功: ${successCount} | 失败: ${failedCount} | 跳过: ${skippedCount}</div>`;
  html += '<div class="batch-list">';
  
  for (const result of results) {
    const statusClass = result.status === 'success' ? 'result-success' : 
                        result.status === 'failed' ? 'result-failed' : 'result-skipped';
    const statusText = result.status === 'success' ? '✓' : 
                       result.status === 'failed' ? '✗' : '−';
    
    html += `
      <div class="batch-item ${statusClass}">
        <span class="batch-status">${statusText}</span>
        <span class="batch-name">${escapeHtml(result.name)}</span>
        <span class="batch-detail">${escapeHtml(result.detail)}</span>
      </div>
    `;
  }
  
  html += '</div>';
  listContainer.innerHTML = html;
  
  if (failedCount === 0 && successCount > 0) {
    showSuccess(`批量测试完成: ${successCount} 个 API 连接正常`);
  } else if (failedCount > 0) {
    showRisk(`批量测试完成: ${successCount} 成功, ${failedCount} 失败`);
  }
}

// 事件监听
document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  
  // 导航切换
  if (target.classList.contains('api-settings-nav-btn')) {
    switchSection(target.dataset.section);
    return;
  }
  
  // 开关按钮
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
    return;
  }
  
  // 保存按钮
  if (target.id === 'api-settings-save-btn') {
    saveApiSettings();
    return;
  }
  
  // 测试按钮
  if (target.id === 'api-settings-test-btn') {
    testApiConnection();
    return;
  }
  
  // 批量测试按钮
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
    return;
  }
});
function enhancePasswordFields() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    input.setAttribute('autocomplete', 'new-password');
    if (input.closest('form.inline-field-form')) return;
    const form = document.createElement('form');
    form.className = 'inline-field-form';
    form.addEventListener('submit', (event) => event.preventDefault());
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

enhancePasswordFields();

// 输入监听
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

// 初始化
loadApiSettings().then(() => {
  renderApiOverview();
  checkInitialStatus();
});
