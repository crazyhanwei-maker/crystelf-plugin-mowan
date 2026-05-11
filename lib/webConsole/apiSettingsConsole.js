export function createApiSettingsConsole(options = {}) {
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const setConfig = typeof options.setConfig === 'function' ? options.setConfig : async () => {};
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

  function resolveSecretSaveValue(nextValue, currentValue, preserveExisting = false) {
    const trimmedNext = String(nextValue || '').trim();
    if (trimmedNext) {
      return trimmedNext;
    }
    return preserveExisting ? String(currentValue || '').trim() : '';
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
    saveApiSettings,
    testApiConnection,
    testImageApiConnection,
    testImageMonitorApiConnection,
    testSearchApiConnection,
  };
}
