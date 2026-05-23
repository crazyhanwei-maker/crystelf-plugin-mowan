import Path from '../../constants/path.js';
import { createApiConfigSourceDiagnostics } from './apiConfigSourceDiagnostics.js';

export function createApiSettingsConsole(options = {}) {
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const setConfig = typeof options.setConfig === 'function' ? options.setConfig : async () => {};
  const runtimeConfigDir = options.runtimeConfigDir || Path.config;
  const defaultConfigDir = options.defaultConfigDir || Path.defaultConfigPath;
  const buildBotIdentitySnapshot = typeof options.buildBotIdentitySnapshot === 'function'
    ? options.buildBotIdentitySnapshot
    : (() => ({}));
  const hasConfiguredSecret = typeof options.hasConfiguredSecret === 'function'
    ? options.hasConfiguredSecret
    : (value = '') => Boolean(String(value || '').trim());
  const normalizePositiveNumber = typeof options.normalizePositiveNumber === 'function'
    ? options.normalizePositiveNumber
    : ((value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    });
  const normalizeMemeLocalBaseDir = typeof options.normalizeMemeLocalBaseDir === 'function'
    ? options.normalizeMemeLocalBaseDir
    : (value = '') => String(value || '').trim();
  const buildOpenAiCompatibleUrl = typeof options.buildOpenAiCompatibleUrl === 'function'
    ? options.buildOpenAiCompatibleUrl
    : ((baseApi = '', pathSuffix = '') => `${String(baseApi || '').replace(/\/+$/, '')}/${String(pathSuffix || '').replace(/^\/+/, '')}`);
  const fetchFn = typeof options.fetch === 'function' ? options.fetch : ((...args) => fetch(...args));
  const configSourceDiagnostics = createApiConfigSourceDiagnostics({
    runtimeConfigDir,
    defaultConfigDir,
  });

  function resolveSecretSaveValue(nextValue, currentValue, preserveExisting = false) {
    const trimmedNext = String(nextValue || '').trim();
    if (trimmedNext) {
      return trimmedNext;
    }
    return preserveExisting ? String(currentValue || '').trim() : '';
  }

  function normalizeStringList(value = []) {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean))).slice(0, 200);
    }
    return Array.from(new Set(String(value || '')
      .split(/[\n,，;；]+/)
      .map(item => item.trim())
      .filter(Boolean))).slice(0, 200);
  }

  function isHttpUrl(value = '') {
    const text = String(value || '').trim();
    if (!text) return false;
    try {
      const url = new URL(text);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function hasSecretForPrecheck(nextValue, preserveExisting, currentValue) {
    return Boolean(String(nextValue || '').trim())
      || preserveExisting === true && hasConfiguredSecret(currentValue);
  }

  function normalizeComparableValue(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean).join('\n');
    }
    if (value === true || value === false) {
      return String(value);
    }
    return String(value ?? '').trim();
  }

  function addChange(changes, label, beforeValue, afterValue) {
    const beforeText = normalizeComparableValue(beforeValue);
    const afterText = normalizeComparableValue(afterValue);
    if (beforeText === afterText) {
      return;
    }
    changes.push({
      label,
      before: beforeText || '空',
      after: afterText || '空',
    });
  }

  function buildApiSettingsPayload() {
    const allConfigs = getAllConfigs() || {};
    const aiConfig = allConfigs.ai || {};
    const coreConfig = allConfigs.coreConfig || {};
    const imageMonitorConfig = allConfigs.imageMonitor || {};
    const identity = buildBotIdentitySnapshot(allConfigs);

    return {
      ai: {
        baseApi: aiConfig.baseApi || '',
        apiKey: '',
        apiKeyConfigured: hasConfiguredSecret(aiConfig.apiKey),
        modelType: aiConfig.modelType || '',
        workingModel: aiConfig.workingModel || '',
        multimodalModel: aiConfig.multimodalModel || '',
        timeout: normalizePositiveNumber(aiConfig.timeout, 60000),
        imageConfig: {
          enabled: aiConfig.imageConfig?.enabled !== false,
          imageMode: aiConfig.imageConfig?.imageMode || 'openai',
          model: aiConfig.imageConfig?.model || '',
          baseApi: aiConfig.imageConfig?.baseApi || '',
          jimengApiUrl: aiConfig.imageConfig?.jimengApiUrl || '',
          apiKey: '',
          apiKeyConfigured: hasConfiguredSecret(aiConfig.imageConfig?.apiKey),
          size: aiConfig.imageConfig?.size || '1024x1024',
          quality: aiConfig.imageConfig?.quality || 'high',
          responseFormat: aiConfig.imageConfig?.responseFormat || 'b64_json',
          background: aiConfig.imageConfig?.background || '',
          timeout: normalizePositiveNumber(aiConfig.imageConfig?.timeout, 60000),
          fallbackReply: aiConfig.imageConfig?.fallbackReply || '',
          fallbackTimeoutReply: aiConfig.imageConfig?.fallbackTimeoutReply || '',
        },
        memeConfig: {
          apiBase: aiConfig.memeConfig?.apiBase || '',
          character: aiConfig.memeConfig?.character || aiConfig.character || '',
          defaultCharacter: identity.recommendedCharacter || '灵晶',
          defaultCharacterSource: identity.recommendedCharacterSource,
          personaCardName: identity.personaCardName || '',
          botNickname: identity.botNickname || '灵晶',
          legacyConfiguredCharacter: identity.legacyConfiguredCharacter === true,
          availableEmotions: Array.isArray(aiConfig.memeConfig?.availableEmotions) ? aiConfig.memeConfig.availableEmotions : [],
          localEnabled: aiConfig.memeConfig?.localEnabled !== false,
          preferLocal: aiConfig.memeConfig?.preferLocal === true,
          localBaseDir: aiConfig.memeConfig?.localBaseDir || 'data/chat/meme',
        },
      },
      imageMonitor: {
        enabled: imageMonitorConfig.enabled === true,
        saveReviewImages: imageMonitorConfig.saveReviewImages !== false,
        saveMemeImages: imageMonitorConfig.saveMemeImages === true,
        saveMemeCharacters: normalizeStringList(imageMonitorConfig.saveMemeCharacters),
        saveMemeKeywords: normalizeStringList(imageMonitorConfig.saveMemeKeywords),
        apiBase: imageMonitorConfig.apiBase || '',
        apiKey: '',
        apiKeyConfigured: hasConfiguredSecret(imageMonitorConfig.apiKey),
        model: imageMonitorConfig.model || '',
        analysisTimeoutMs: normalizePositiveNumber(imageMonitorConfig.analysisTimeoutMs, 30000),
        fallbackReply: imageMonitorConfig.fallbackReply || '',
        fallbackTimeoutReply: imageMonitorConfig.fallbackTimeoutReply || '',
      },
      coreConfig: {
        tools: {
          search: {
            enabled: coreConfig.tools?.search?.enabled === true,
            apiKey: '',
            apiKeyConfigured: hasConfiguredSecret(coreConfig.tools?.search?.apiKey),
            markdownApiUrl: coreConfig.tools?.search?.markdownApiUrl || '',
            markdownStatusUrl: coreConfig.tools?.search?.markdownStatusUrl || '',
            timeoutMs: normalizePositiveNumber(coreConfig.tools?.search?.timeoutMs, 60000),
          },
        },
      },
      configSource: configSourceDiagnostics.build(allConfigs),
    };
  }

  function precheckApiSettings(payload = {}) {
    const allConfigs = getAllConfigs() || {};
    const currentAi = allConfigs.ai || {};
    const currentImageConfig = currentAi.imageConfig || {};
    const currentImageMonitor = allConfigs.imageMonitor || {};
    const currentSearch = allConfigs.coreConfig?.tools?.search || {};
    const errors = [];
    const warnings = [];
    const changes = [];
    const ai = payload.ai || {};
    const imageConfig = ai.imageConfig || {};
    const memeConfig = ai.memeConfig || {};
    const imageMonitor = payload.imageMonitor || {};
    const search = payload.coreConfig?.tools?.search || {};

    if (!String(ai.baseApi || '').trim()) {
      errors.push('AI 主对话 API 地址不能为空。');
    } else if (!isHttpUrl(ai.baseApi)) {
      errors.push('AI 主对话 API 地址必须是 http(s) URL。');
    }
    if (!hasSecretForPrecheck(ai.apiKey, ai.preserveApiKey, currentAi.apiKey)) {
      errors.push('AI 主对话 API Key 不能为空。');
    }
    if (!String(ai.modelType || '').trim()) {
      errors.push('AI 主对话模型不能为空。');
    }
    if (!Number.isFinite(Number(ai.timeout)) || Number(ai.timeout) <= 0) {
      errors.push('AI 主对话超时时间必须是正数。');
    }

    if (imageConfig.enabled !== false) {
      const imageMode = String(imageConfig.imageMode || '').trim();
      if (imageMode === 'jimeng') {
        if (!String(imageConfig.jimengApiUrl || '').trim()) {
          warnings.push('图像生成已启用即梦模式，但未填写即梦 API 地址。');
        } else if (!isHttpUrl(imageConfig.jimengApiUrl)) {
          warnings.push('即梦 API 地址不是标准 http(s) URL。');
        }
      } else {
        const imageBaseApi = String(imageConfig.baseApi || ai.baseApi || '').trim();
        if (!imageBaseApi) {
          warnings.push('图像生成已启用，但未填写图像 API 地址，将回退主对话地址或导致不可用。');
        } else if (!isHttpUrl(imageBaseApi)) {
          warnings.push('图像生成 API 地址不是标准 http(s) URL。');
        }
        if (!hasSecretForPrecheck(imageConfig.apiKey, imageConfig.preserveApiKey, currentImageConfig.apiKey) && !hasSecretForPrecheck(ai.apiKey, ai.preserveApiKey, currentAi.apiKey)) {
          warnings.push('图像生成未配置独立或主 API Key，可能无法生成图片。');
        }
        if (!String(imageConfig.model || '').trim()) {
          warnings.push('图像生成已启用，但未填写模型名称。');
        }
      }
    }

    if (imageMonitor.enabled === true) {
      if (!String(imageMonitor.apiBase || '').trim()) {
        warnings.push('图片监控已启用，但未填写识别 API 地址。');
      } else if (!isHttpUrl(imageMonitor.apiBase)) {
        warnings.push('图片监控 API 地址不是标准 http(s) URL。');
      }
      if (!hasSecretForPrecheck(imageMonitor.apiKey, imageMonitor.preserveApiKey, currentImageMonitor.apiKey)) {
        warnings.push('图片监控已启用，但未配置 API Key。');
      }
      if (!String(imageMonitor.model || '').trim()) {
        warnings.push('图片监控已启用，但未填写模型名称。');
      }
    }

    if (search.enabled === true) {
      if (!String(search.markdownApiUrl || '').trim()) {
        warnings.push('搜索工具已启用，但 Markdown API 地址为空。');
      } else if (!isHttpUrl(search.markdownApiUrl)) {
        warnings.push('搜索工具 Markdown API 地址不是标准 http(s) URL。');
      }
      if (String(search.markdownStatusUrl || '').trim() && !isHttpUrl(search.markdownStatusUrl)) {
        warnings.push('搜索工具状态地址不是标准 http(s) URL。');
      }
    }

    addChange(changes, 'AI 主对话 API 地址', currentAi.baseApi, ai.baseApi);
    addChange(changes, 'AI 主对话模型', currentAi.modelType, ai.modelType);
    addChange(changes, '工作模型', currentAi.workingModel, ai.workingModel);
    addChange(changes, '多模态模型', currentAi.multimodalModel, ai.multimodalModel);
    addChange(changes, 'AI 超时时间', currentAi.timeout, ai.timeout);
    if (String(ai.apiKey || '').trim()) {
      changes.push({ label: 'AI 主对话 API Key', before: hasConfiguredSecret(currentAi.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '图像生成开关', currentImageConfig.enabled !== false, imageConfig.enabled !== false);
    addChange(changes, '图像生成模式', currentImageConfig.imageMode, imageConfig.imageMode);
    addChange(changes, '图像生成模型', currentImageConfig.model, imageConfig.model);
    addChange(changes, '图像 API 地址', currentImageConfig.baseApi, imageConfig.baseApi);
    addChange(changes, '即梦 API 地址', currentImageConfig.jimengApiUrl, imageConfig.jimengApiUrl);
    if (String(imageConfig.apiKey || '').trim()) {
      changes.push({ label: '图像生成 API Key', before: hasConfiguredSecret(currentImageConfig.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '表情本地目录', currentAi.memeConfig?.localBaseDir, memeConfig.localBaseDir);
    addChange(changes, '图片监控开关', currentImageMonitor.enabled === true, imageMonitor.enabled === true);
    addChange(changes, '图片监控 API 地址', currentImageMonitor.apiBase, imageMonitor.apiBase);
    addChange(changes, '图片监控模型', currentImageMonitor.model, imageMonitor.model);
    if (String(imageMonitor.apiKey || '').trim()) {
      changes.push({ label: '图片监控 API Key', before: hasConfiguredSecret(currentImageMonitor.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '搜索工具开关', currentSearch.enabled === true, search.enabled === true);
    addChange(changes, '搜索 Markdown API', currentSearch.markdownApiUrl, search.markdownApiUrl);
    addChange(changes, '搜索状态 API', currentSearch.markdownStatusUrl, search.markdownStatusUrl);
    if (String(search.apiKey || '').trim()) {
      changes.push({ label: '搜索工具 API Key', before: hasConfiguredSecret(currentSearch.apiKey) ? '已配置' : '空', after: '将更新' });
    }

    return {
      success: true,
      ok: errors.length === 0,
      errors,
      warnings,
      changes: changes.slice(0, 30),
      truncatedChanges: changes.length > 30,
      summary: {
        errorCount: errors.length,
        warningCount: warnings.length,
        changeCount: changes.length,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  async function saveApiSettings(payload = {}) {
    const allConfigs = getAllConfigs() || {};

    if (payload.ai) {
      const currentAi = allConfigs.ai || {};
      const nextAi = {
        ...currentAi,
        baseApi: payload.ai.baseApi,
        apiKey: resolveSecretSaveValue(payload.ai.apiKey, currentAi.apiKey, payload.ai.preserveApiKey === true),
        modelType: payload.ai.modelType,
        workingModel: payload.ai.workingModel,
        multimodalModel: payload.ai.multimodalModel,
        timeout: normalizePositiveNumber(payload.ai.timeout, normalizePositiveNumber(currentAi.timeout, 60000)),
      };

      if (payload.ai.imageConfig) {
        nextAi.imageConfig = {
          ...currentAi.imageConfig,
          ...payload.ai.imageConfig,
          apiKey: resolveSecretSaveValue(payload.ai.imageConfig.apiKey, currentAi.imageConfig?.apiKey, payload.ai.imageConfig.preserveApiKey === true),
        };
      }

      if (payload.ai.memeConfig) {
        nextAi.memeConfig = {
          ...currentAi.memeConfig,
          ...payload.ai.memeConfig,
          localEnabled: payload.ai.memeConfig.localEnabled !== false,
          preferLocal: payload.ai.memeConfig.preferLocal === true,
          localBaseDir: normalizeMemeLocalBaseDir(payload.ai.memeConfig.localBaseDir),
        };
      }

      await setConfig('ai', nextAi);
    }

    if (payload.imageMonitor) {
      const currentImageMonitor = allConfigs.imageMonitor || {};
      const nextImageMonitor = {
        ...currentImageMonitor,
        enabled: payload.imageMonitor.enabled,
        apiBase: payload.imageMonitor.apiBase,
        apiKey: resolveSecretSaveValue(payload.imageMonitor.apiKey, currentImageMonitor.apiKey, payload.imageMonitor.preserveApiKey === true),
        model: payload.imageMonitor.model,
        saveReviewImages: payload.imageMonitor.saveReviewImages !== false,
        saveMemeImages: payload.imageMonitor.saveMemeImages === true,
        saveMemeCharacters: normalizeStringList(payload.imageMonitor.saveMemeCharacters),
        saveMemeKeywords: normalizeStringList(payload.imageMonitor.saveMemeKeywords),
        analysisTimeoutMs: normalizePositiveNumber(payload.imageMonitor.analysisTimeoutMs, normalizePositiveNumber(currentImageMonitor.analysisTimeoutMs, 30000)),
        fallbackReply: String(payload.imageMonitor.fallbackReply || ''),
        fallbackTimeoutReply: String(payload.imageMonitor.fallbackTimeoutReply || ''),
      };
      await setConfig('imageMonitor', nextImageMonitor);
    }

    if (payload.coreConfig?.tools?.search) {
      const currentCore = allConfigs.coreConfig || {};
      const nextCore = {
        ...currentCore,
        tools: {
          ...(currentCore.tools || {}),
          search: {
            ...(currentCore.tools?.search || {}),
            enabled: payload.coreConfig.tools.search.enabled,
            apiKey: resolveSecretSaveValue(payload.coreConfig.tools.search.apiKey, currentCore.tools?.search?.apiKey, payload.coreConfig.tools.search.preserveApiKey === true),
            markdownApiUrl: payload.coreConfig.tools.search.markdownApiUrl,
            markdownStatusUrl: payload.coreConfig.tools.search.markdownStatusUrl,
            timeoutMs: normalizePositiveNumber(payload.coreConfig.tools.search.timeoutMs, normalizePositiveNumber(currentCore.tools?.search?.timeoutMs, 60000)),
          },
        },
      };
      await setConfig('coreConfig', nextCore);
    }

    return buildApiSettingsPayload();
  }

  async function testApiConnection() {
    const allConfigs = getAllConfigs() || {};
    const aiConfig = allConfigs.ai || {};
    const timeoutMs = normalizePositiveNumber(aiConfig.timeout, 60000);
    const baseApi = String(aiConfig.baseApi || '').trim();
    const apiKey = String(aiConfig.apiKey || '').trim();
    const model = String(aiConfig.modelType || aiConfig.workingModel || '').trim();

    if (!baseApi || !apiKey) {
      return { success: false, error: 'Missing AI baseApi or apiKey.' };
    }

    const startedAt = Date.now();
    try {
      const response = await fetchFn(buildOpenAiCompatibleUrl(baseApi, '/v1/models'), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - startedAt;
      if (response.ok) {
        return { success: true, detail: `API reachable (${latencyMs}ms)${model ? `, model: ${model}` : ''}`, latencyMs, timeoutMs };
      }
      return { success: false, error: `API HTTP ${response.status}`, latencyMs, timeoutMs };
    } catch (error) {
      return { success: false, error: `API request failed: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
    }
  }

  async function testImageApiConnection() {
    const allConfigs = getAllConfigs() || {};
    const imageConfig = allConfigs.ai?.imageConfig || {};
    const timeoutMs = normalizePositiveNumber(imageConfig.timeout, 60000);

    if (String(imageConfig.imageMode || '').trim() === 'jimeng') {
      const jimengUrl = String(imageConfig.jimengApiUrl || '').trim();
      if (!jimengUrl) {
        return { success: false, error: 'Missing Jimeng API URL.' };
      }
      const startedAt = Date.now();
      try {
        const response = await fetchFn(jimengUrl, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
        const latencyMs = Date.now() - startedAt;
        if (response.ok) {
          return { success: true, detail: `Jimeng API reachable (${latencyMs}ms)`, latencyMs, timeoutMs };
        }
        return { success: false, error: `Jimeng API HTTP ${response.status}`, latencyMs, timeoutMs };
      } catch (error) {
        return { success: false, error: `Jimeng API request failed: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
      }
    }

    const baseApi = String(imageConfig.baseApi || allConfigs.ai?.baseApi || '').trim();
    const apiKey = String(imageConfig.apiKey || allConfigs.ai?.apiKey || '').trim();
    const model = String(imageConfig.model || '').trim();

    if (!baseApi || !apiKey) {
      return { success: false, error: 'Missing image API baseApi or apiKey.' };
    }

    const startedAt = Date.now();
    try {
      const response = await fetchFn(buildOpenAiCompatibleUrl(baseApi, '/v1/models'), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - startedAt;
      if (response.ok) {
        return { success: true, detail: `Image API reachable (${latencyMs}ms)${model ? `, model: ${model}` : ''}`, latencyMs, timeoutMs };
      }
      return { success: false, error: `Image API HTTP ${response.status}`, latencyMs, timeoutMs };
    } catch (error) {
      return { success: false, error: `Image API request failed: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
    }
  }

  async function testImageMonitorApiConnection() {
    const allConfigs = getAllConfigs() || {};
    const monitorConfig = allConfigs.imageMonitor || {};
    const timeoutMs = normalizePositiveNumber(monitorConfig.analysisTimeoutMs, 30000);

    if (!monitorConfig.enabled) {
      return { success: false, error: 'Image monitor is disabled.' };
    }

    const baseApi = String(monitorConfig.apiBase || '').trim();
    const apiKey = String(monitorConfig.apiKey || '').trim();
    if (!baseApi) {
      return { success: false, error: 'Missing image monitor apiBase.' };
    }

    const startedAt = Date.now();
    try {
      const response = await fetchFn(buildOpenAiCompatibleUrl(baseApi, '/v1/models'), {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - startedAt;
      if (response.ok) {
        return { success: true, detail: `Image monitor API reachable (${latencyMs}ms)`, latencyMs, timeoutMs };
      }
      return { success: false, error: `Image monitor API HTTP ${response.status}`, latencyMs, timeoutMs };
    } catch (error) {
      return { success: false, error: `Image monitor API request failed: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
    }
  }

  async function testSearchApiConnection() {
    const allConfigs = getAllConfigs() || {};
    const searchConfig = allConfigs.coreConfig?.tools?.search || {};
    const timeoutMs = normalizePositiveNumber(searchConfig.timeoutMs, 60000);

    if (!searchConfig.enabled) {
      return { success: false, error: 'Search tool is disabled.' };
    }

    const apiKey = String(searchConfig.apiKey || '').trim();
    if (!apiKey) {
      return { success: false, error: 'Missing search API key.' };
    }

    return { success: true, detail: `Search config looks ready. Timeout: ${timeoutMs}ms.`, timeoutMs };
  }

  return {
    buildApiSettingsPayload,
    precheckApiSettings,
    saveApiSettings,
    testApiConnection,
    testImageApiConnection,
    testImageMonitorApiConnection,
    testSearchApiConnection,
  };
}
