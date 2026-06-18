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

  function normalizeImageMonitorViolationAction(value, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'recall' || raw === 'warn' || raw === 'ignore') return raw;
    // 兼容旧字段：autoRecallViolation 是布尔，true → recall，false → warn
    if (value === true) return 'recall';
    if (value === false) return 'warn';
    if (typeof fallback === 'string') {
      const fb = fallback.trim().toLowerCase();
      if (fb === 'recall' || fb === 'warn' || fb === 'ignore') return fb;
    }
    return 'recall';
  }

  function normalizeImageMonitorRiskThreshold(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0 || num > 1) {
      const fb = Number(fallback);
      return Number.isFinite(fb) && fb >= 0 && fb <= 1 ? Math.round(fb * 100) / 100 : 0.7;
    }
    return Math.round(num * 100) / 100;
  }

  function normalizeImageMonitorTemperature(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0 || num > 2) {
      const fb = Number(fallback);
      return Number.isFinite(fb) && fb >= 0 && fb <= 2 ? Math.round(fb * 100) / 100 : 0.2;
    }
    return Math.round(num * 100) / 100;
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
    const aiFallback = aiConfig.fallbackApi || {};
    const imageFallback = aiConfig.imageConfig?.fallbackApi || {};
    const memeFallback = aiConfig.memeConfig?.fallbackApi || {};
    const imageMonitorFallback = imageMonitorConfig.fallbackApi || {};
    const searchFallback = coreConfig.tools?.search?.fallbackApi || {};
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
        fallbackApi: {
          enabled: aiFallback.enabled === true,
          baseApi: aiFallback.baseApi || '',
          apiKey: '',
          apiKeyConfigured: hasConfiguredSecret(aiFallback.apiKey),
          modelType: aiFallback.modelType || '',
          workingModel: aiFallback.workingModel || '',
          multimodalModel: aiFallback.multimodalModel || '',
        },
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
          fallbackApi: {
            enabled: imageFallback.enabled === true,
            imageMode: imageFallback.imageMode || aiConfig.imageConfig?.imageMode || 'openai',
            model: imageFallback.model || '',
            baseApi: imageFallback.baseApi || '',
            jimengApiUrl: imageFallback.jimengApiUrl || '',
            apiKey: '',
            apiKeyConfigured: hasConfiguredSecret(imageFallback.apiKey),
          },
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
          fallbackApi: {
            enabled: memeFallback.enabled === true,
            apiBase: memeFallback.apiBase || '',
          },
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
        violationAction: normalizeImageMonitorViolationAction(imageMonitorConfig.violationAction, imageMonitorConfig.autoRecallViolation),
        riskThreshold: normalizeImageMonitorRiskThreshold(imageMonitorConfig.riskThreshold, 0.7),
        monitorQuotedImages: imageMonitorConfig.monitorQuotedImages === true,
        allowedGroups: normalizeStringList(imageMonitorConfig.allowedGroups),
        blockedGroups: normalizeStringList(imageMonitorConfig.blockedGroups),
        maxImagesPerMessage: normalizePositiveNumber(imageMonitorConfig.maxImagesPerMessage, 3),
        duplicateWindowMs: Number.isFinite(Number(imageMonitorConfig.duplicateWindowMs)) && Number(imageMonitorConfig.duplicateWindowMs) >= 0
          ? Math.round(Number(imageMonitorConfig.duplicateWindowMs))
          : 60000,
        temperature: normalizeImageMonitorTemperature(imageMonitorConfig.temperature, 0.2),
        prompt: String(imageMonitorConfig.prompt || ''),
        fallbackApi: {
          enabled: imageMonitorFallback.enabled === true,
          apiBase: imageMonitorFallback.apiBase || '',
          apiKey: '',
          apiKeyConfigured: hasConfiguredSecret(imageMonitorFallback.apiKey),
          model: imageMonitorFallback.model || '',
        },
      },
      coreConfig: {
        tools: {
          search: {
            enabled: coreConfig.tools?.search?.enabled === true,
            apiUrl: coreConfig.tools?.search?.apiUrl || '',
            apiKey: '',
            apiKeyConfigured: hasConfiguredSecret(coreConfig.tools?.search?.apiKey),
            markdownApiUrl: coreConfig.tools?.search?.markdownApiUrl || '',
            markdownStatusUrl: coreConfig.tools?.search?.markdownStatusUrl || '',
            timeoutMs: normalizePositiveNumber(coreConfig.tools?.search?.timeoutMs, 60000),
            fallbackApi: {
              enabled: searchFallback.enabled === true,
              apiUrl: searchFallback.apiUrl || '',
              apiKey: '',
              apiKeyConfigured: hasConfiguredSecret(searchFallback.apiKey),
              markdownApiUrl: searchFallback.markdownApiUrl || '',
              markdownStatusUrl: searchFallback.markdownStatusUrl || '',
            },
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
    const currentAiFallback = currentAi.fallbackApi || {};
    const currentImageFallback = currentImageConfig.fallbackApi || {};
    const currentMemeFallback = currentAi.memeConfig?.fallbackApi || {};
    const currentImageMonitorFallback = currentImageMonitor.fallbackApi || {};
    const currentSearchFallback = currentSearch.fallbackApi || {};
    const errors = [];
    const warnings = [];
    const changes = [];
    const ai = payload.ai || {};
    const imageConfig = ai.imageConfig || {};
    const memeConfig = ai.memeConfig || {};
    const imageMonitor = payload.imageMonitor || {};
    const search = payload.coreConfig?.tools?.search || {};
    const aiFallback = ai.fallbackApi || {};
    const imageFallback = imageConfig.fallbackApi || {};
    const memeFallback = memeConfig.fallbackApi || {};
    const imageMonitorFallback = imageMonitor.fallbackApi || {};
    const searchFallback = search.fallbackApi || {};

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
    if (aiFallback.enabled === true) {
      if (!String(aiFallback.baseApi || '').trim()) {
        warnings.push('AI 主对话备用 API 已开启，但未填写备用 API 地址。');
      } else if (!isHttpUrl(aiFallback.baseApi)) {
        warnings.push('AI 主对话备用 API 地址不是标准 http(s) URL。');
      }
      if (!hasSecretForPrecheck(aiFallback.apiKey, aiFallback.preserveApiKey, currentAiFallback.apiKey)) {
        warnings.push('AI 主对话备用 API 已开启，但未配置备用 API Key。');
      }
      if (!String(aiFallback.modelType || '').trim()) {
        warnings.push('AI 主对话备用 API 已开启，但未填写备用文本模型。');
      }
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
      if (imageFallback.enabled === true) {
        const fallbackImageMode = String(imageFallback.imageMode || imageConfig.imageMode || '').trim();
        if (fallbackImageMode === 'jimeng') {
          if (!String(imageFallback.jimengApiUrl || '').trim()) {
            warnings.push('图像生成备用 API 已开启即梦模式，但未填写备用即梦 API 地址。');
          } else if (!isHttpUrl(imageFallback.jimengApiUrl)) {
            warnings.push('图像生成备用即梦 API 地址不是标准 http(s) URL。');
          }
        } else {
          if (!String(imageFallback.baseApi || '').trim()) {
            warnings.push('图像生成备用 API 已开启，但未填写备用 API 地址。');
          } else if (!isHttpUrl(imageFallback.baseApi)) {
            warnings.push('图像生成备用 API 地址不是标准 http(s) URL。');
          }
          if (!String(imageFallback.model || '').trim()) {
            warnings.push('图像生成备用 API 已开启，但未填写备用图像模型。');
          }
        }
        if (!hasSecretForPrecheck(imageFallback.apiKey, imageFallback.preserveApiKey, currentImageFallback.apiKey)) {
          warnings.push('图像生成备用 API 已开启，但未配置备用 API Key。');
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
      if (imageMonitorFallback.enabled === true) {
        if (!String(imageMonitorFallback.apiBase || '').trim()) {
          warnings.push('图片监控备用 API 已开启，但未填写备用识别 API 地址。');
        } else if (!isHttpUrl(imageMonitorFallback.apiBase)) {
          warnings.push('图片监控备用 API 地址不是标准 http(s) URL。');
        }
        if (!hasSecretForPrecheck(imageMonitorFallback.apiKey, imageMonitorFallback.preserveApiKey, currentImageMonitorFallback.apiKey)) {
          warnings.push('图片监控备用 API 已开启，但未配置备用 API Key。');
        }
        if (!String(imageMonitorFallback.model || '').trim()) {
          warnings.push('图片监控备用 API 已开启，但未填写备用模型名称。');
        }
      }
    }

    if (search.enabled === true) {
      if (!String(search.apiUrl || '').trim()) {
        warnings.push('搜索工具已启用，但搜索 API 地址为空。');
      } else if (!isHttpUrl(search.apiUrl)) {
        warnings.push('搜索工具 API 地址不是标准 http(s) URL。');
      }
      if (!String(search.markdownApiUrl || '').trim()) {
        warnings.push('搜索工具已启用，但 Markdown API 地址为空。');
      } else if (!isHttpUrl(search.markdownApiUrl)) {
        warnings.push('搜索工具 Markdown API 地址不是标准 http(s) URL。');
      }
      if (String(search.markdownStatusUrl || '').trim() && !isHttpUrl(search.markdownStatusUrl)) {
        warnings.push('搜索工具状态地址不是标准 http(s) URL。');
      }
      if (searchFallback.enabled === true) {
        if (!String(searchFallback.apiUrl || '').trim()) {
          warnings.push('搜索工具备用 API 已开启，但未填写备用搜索 API 地址。');
        } else if (!isHttpUrl(searchFallback.apiUrl)) {
          warnings.push('搜索工具备用搜索 API 地址不是标准 http(s) URL。');
        }
        if (!String(searchFallback.markdownApiUrl || '').trim()) {
          warnings.push('搜索工具备用 API 已开启，但未填写备用网页读取提交地址。');
        } else if (!isHttpUrl(searchFallback.markdownApiUrl)) {
          warnings.push('搜索工具备用网页读取提交地址不是标准 http(s) URL。');
        }
        if (String(searchFallback.markdownStatusUrl || '').trim() && !isHttpUrl(searchFallback.markdownStatusUrl)) {
          warnings.push('搜索工具备用状态地址不是标准 http(s) URL。');
        }
      }
    }

    if (memeFallback.enabled === true) {
      if (!String(memeFallback.apiBase || '').trim()) {
        warnings.push('表情包备用 API 已开启，但未填写备用表情包 API 地址。');
      } else if (!isHttpUrl(memeFallback.apiBase)) {
        warnings.push('表情包备用 API 地址不是标准 http(s) URL。');
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
    addChange(changes, 'AI 主对话备用 API 开关', currentAiFallback.enabled === true, aiFallback.enabled === true);
    addChange(changes, 'AI 主对话备用 API 地址', currentAiFallback.baseApi, aiFallback.baseApi);
    addChange(changes, 'AI 主对话备用文本模型', currentAiFallback.modelType, aiFallback.modelType);
    addChange(changes, 'AI 主对话备用工作模型', currentAiFallback.workingModel, aiFallback.workingModel);
    addChange(changes, 'AI 主对话备用多模态模型', currentAiFallback.multimodalModel, aiFallback.multimodalModel);
    if (String(aiFallback.apiKey || '').trim()) {
      changes.push({ label: 'AI 主对话备用 API Key', before: hasConfiguredSecret(currentAiFallback.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '图像生成开关', currentImageConfig.enabled !== false, imageConfig.enabled !== false);
    addChange(changes, '图像生成模式', currentImageConfig.imageMode, imageConfig.imageMode);
    addChange(changes, '图像生成模型', currentImageConfig.model, imageConfig.model);
    addChange(changes, '图像 API 地址', currentImageConfig.baseApi, imageConfig.baseApi);
    addChange(changes, '即梦 API 地址', currentImageConfig.jimengApiUrl, imageConfig.jimengApiUrl);
    if (String(imageConfig.apiKey || '').trim()) {
      changes.push({ label: '图像生成 API Key', before: hasConfiguredSecret(currentImageConfig.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '图像生成备用 API 开关', currentImageFallback.enabled === true, imageFallback.enabled === true);
    addChange(changes, '图像生成备用模式', currentImageFallback.imageMode, imageFallback.imageMode);
    addChange(changes, '图像生成备用模型', currentImageFallback.model, imageFallback.model);
    addChange(changes, '图像生成备用 API 地址', currentImageFallback.baseApi, imageFallback.baseApi);
    addChange(changes, '图像生成备用即梦 API 地址', currentImageFallback.jimengApiUrl, imageFallback.jimengApiUrl);
    if (String(imageFallback.apiKey || '').trim()) {
      changes.push({ label: '图像生成备用 API Key', before: hasConfiguredSecret(currentImageFallback.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '表情本地目录', currentAi.memeConfig?.localBaseDir, memeConfig.localBaseDir);
    addChange(changes, '表情包备用 API 开关', currentMemeFallback.enabled === true, memeFallback.enabled === true);
    addChange(changes, '表情包备用 API 地址', currentMemeFallback.apiBase, memeFallback.apiBase);
    addChange(changes, '图片监控开关', currentImageMonitor.enabled === true, imageMonitor.enabled === true);
    addChange(changes, '图片监控 API 地址', currentImageMonitor.apiBase, imageMonitor.apiBase);
    addChange(changes, '图片监控模型', currentImageMonitor.model, imageMonitor.model);
    if (String(imageMonitor.apiKey || '').trim()) {
      changes.push({ label: '图片监控 API Key', before: hasConfiguredSecret(currentImageMonitor.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '图片监控备用 API 开关', currentImageMonitorFallback.enabled === true, imageMonitorFallback.enabled === true);
    addChange(changes, '图片监控备用 API 地址', currentImageMonitorFallback.apiBase, imageMonitorFallback.apiBase);
    addChange(changes, '图片监控备用模型', currentImageMonitorFallback.model, imageMonitorFallback.model);
    if (String(imageMonitorFallback.apiKey || '').trim()) {
      changes.push({ label: '图片监控备用 API Key', before: hasConfiguredSecret(currentImageMonitorFallback.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '搜索工具开关', currentSearch.enabled === true, search.enabled === true);
    addChange(changes, '搜索 API', currentSearch.apiUrl, search.apiUrl);
    addChange(changes, '搜索 Markdown API', currentSearch.markdownApiUrl, search.markdownApiUrl);
    addChange(changes, '搜索状态 API', currentSearch.markdownStatusUrl, search.markdownStatusUrl);
    if (String(search.apiKey || '').trim()) {
      changes.push({ label: '搜索工具 API Key', before: hasConfiguredSecret(currentSearch.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '搜索工具备用 API 开关', currentSearchFallback.enabled === true, searchFallback.enabled === true);
    addChange(changes, '搜索工具备用搜索 API', currentSearchFallback.apiUrl, searchFallback.apiUrl);
    addChange(changes, '搜索工具备用 Markdown API', currentSearchFallback.markdownApiUrl, searchFallback.markdownApiUrl);
    addChange(changes, '搜索工具备用状态 API', currentSearchFallback.markdownStatusUrl, searchFallback.markdownStatusUrl);
    if (String(searchFallback.apiKey || '').trim()) {
      changes.push({ label: '搜索工具备用 API Key', before: hasConfiguredSecret(currentSearchFallback.apiKey) ? '已配置' : '空', after: '将更新' });
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

      if (payload.ai.fallbackApi) {
        nextAi.fallbackApi = {
          ...(currentAi.fallbackApi || {}),
          enabled: payload.ai.fallbackApi.enabled === true,
          baseApi: String(payload.ai.fallbackApi.baseApi || ''),
          apiKey: resolveSecretSaveValue(payload.ai.fallbackApi.apiKey, currentAi.fallbackApi?.apiKey, payload.ai.fallbackApi.preserveApiKey === true),
          modelType: String(payload.ai.fallbackApi.modelType || ''),
          workingModel: String(payload.ai.fallbackApi.workingModel || ''),
          multimodalModel: String(payload.ai.fallbackApi.multimodalModel || ''),
        };
      }

      if (payload.ai.imageConfig) {
        nextAi.imageConfig = {
          ...currentAi.imageConfig,
          ...payload.ai.imageConfig,
          apiKey: resolveSecretSaveValue(payload.ai.imageConfig.apiKey, currentAi.imageConfig?.apiKey, payload.ai.imageConfig.preserveApiKey === true),
        };
        if (payload.ai.imageConfig.fallbackApi) {
          nextAi.imageConfig.fallbackApi = {
            ...(currentAi.imageConfig?.fallbackApi || {}),
            enabled: payload.ai.imageConfig.fallbackApi.enabled === true,
            imageMode: String(payload.ai.imageConfig.fallbackApi.imageMode || payload.ai.imageConfig.imageMode || 'openai'),
            model: String(payload.ai.imageConfig.fallbackApi.model || ''),
            baseApi: String(payload.ai.imageConfig.fallbackApi.baseApi || ''),
            jimengApiUrl: String(payload.ai.imageConfig.fallbackApi.jimengApiUrl || ''),
            apiKey: resolveSecretSaveValue(payload.ai.imageConfig.fallbackApi.apiKey, currentAi.imageConfig?.fallbackApi?.apiKey, payload.ai.imageConfig.fallbackApi.preserveApiKey === true),
          };
        }
      }

      if (payload.ai.memeConfig) {
        nextAi.memeConfig = {
          ...currentAi.memeConfig,
          ...payload.ai.memeConfig,
          localEnabled: payload.ai.memeConfig.localEnabled !== false,
          preferLocal: payload.ai.memeConfig.preferLocal === true,
          localBaseDir: normalizeMemeLocalBaseDir(payload.ai.memeConfig.localBaseDir),
        };
        if (payload.ai.memeConfig.fallbackApi) {
          nextAi.memeConfig.fallbackApi = {
            ...(currentAi.memeConfig?.fallbackApi || {}),
            enabled: payload.ai.memeConfig.fallbackApi.enabled === true,
            apiBase: String(payload.ai.memeConfig.fallbackApi.apiBase || ''),
          };
        }
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
        violationAction: normalizeImageMonitorViolationAction(payload.imageMonitor.violationAction, currentImageMonitor.violationAction),
        riskThreshold: normalizeImageMonitorRiskThreshold(payload.imageMonitor.riskThreshold, normalizeImageMonitorRiskThreshold(currentImageMonitor.riskThreshold, 0.7)),
        monitorQuotedImages: payload.imageMonitor.monitorQuotedImages === true,
        allowedGroups: normalizeStringList(payload.imageMonitor.allowedGroups),
        blockedGroups: normalizeStringList(payload.imageMonitor.blockedGroups),
        maxImagesPerMessage: normalizePositiveNumber(payload.imageMonitor.maxImagesPerMessage, normalizePositiveNumber(currentImageMonitor.maxImagesPerMessage, 3)),
        duplicateWindowMs: (() => {
          const raw = Number(payload.imageMonitor.duplicateWindowMs);
          if (Number.isFinite(raw) && raw >= 0) return Math.round(raw);
          const cur = Number(currentImageMonitor.duplicateWindowMs);
          return Number.isFinite(cur) && cur >= 0 ? Math.round(cur) : 60000;
        })(),
        temperature: normalizeImageMonitorTemperature(payload.imageMonitor.temperature, normalizeImageMonitorTemperature(currentImageMonitor.temperature, 0.2)),
        prompt: String(payload.imageMonitor.prompt ?? currentImageMonitor.prompt ?? ''),
      };
      if (payload.imageMonitor.fallbackApi) {
        nextImageMonitor.fallbackApi = {
          ...(currentImageMonitor.fallbackApi || {}),
          enabled: payload.imageMonitor.fallbackApi.enabled === true,
          apiBase: String(payload.imageMonitor.fallbackApi.apiBase || ''),
          apiKey: resolveSecretSaveValue(payload.imageMonitor.fallbackApi.apiKey, currentImageMonitor.fallbackApi?.apiKey, payload.imageMonitor.fallbackApi.preserveApiKey === true),
          model: String(payload.imageMonitor.fallbackApi.model || ''),
        };
      }
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
            apiUrl: payload.coreConfig.tools.search.apiUrl,
            apiKey: resolveSecretSaveValue(payload.coreConfig.tools.search.apiKey, currentCore.tools?.search?.apiKey, payload.coreConfig.tools.search.preserveApiKey === true),
            markdownApiUrl: payload.coreConfig.tools.search.markdownApiUrl,
            markdownStatusUrl: payload.coreConfig.tools.search.markdownStatusUrl,
            timeoutMs: normalizePositiveNumber(payload.coreConfig.tools.search.timeoutMs, normalizePositiveNumber(currentCore.tools?.search?.timeoutMs, 60000)),
            fallbackApi: payload.coreConfig.tools.search.fallbackApi ? {
              ...(currentCore.tools?.search?.fallbackApi || {}),
              enabled: payload.coreConfig.tools.search.fallbackApi.enabled === true,
              apiUrl: String(payload.coreConfig.tools.search.fallbackApi.apiUrl || ''),
              apiKey: resolveSecretSaveValue(payload.coreConfig.tools.search.fallbackApi.apiKey, currentCore.tools?.search?.fallbackApi?.apiKey, payload.coreConfig.tools.search.fallbackApi.preserveApiKey === true),
              markdownApiUrl: String(payload.coreConfig.tools.search.fallbackApi.markdownApiUrl || ''),
              markdownStatusUrl: String(payload.coreConfig.tools.search.fallbackApi.markdownStatusUrl || ''),
            } : currentCore.tools?.search?.fallbackApi,
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
