import Path from '../../constants/path.js';
import { createApiConfigSourceDiagnostics } from './apiConfigSourceDiagnostics.js';
import { buildAiUserAgentHeaders, getDefaultAiUserAgent, normalizeAiUserAgent, validateAiUserAgent } from '../ai/userAgent.js';
import { buildArkAgentPlanImageUrl, isArkAgentPlanImageMode } from '../ai/imageApi.js';
import { ImageProcessor } from '../ai/imageProcessor.js';

const IMAGE_RUNTIME_TEST_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const IMAGE_RUNTIME_TEST_MAX_PREVIEW_CHARS = 7 * 1024 * 1024;

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

  function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

  function normalizeFallbackAutoSwitch(source = {}, fallback = {}) {
    return {
      autoSwitchEnabled: source.autoSwitchEnabled !== undefined
        ? source.autoSwitchEnabled !== false
        : fallback.autoSwitchEnabled !== false,
      failureThreshold: Math.min(10, Math.max(1, Math.round(normalizePositiveNumber(
        source.failureThreshold,
        normalizePositiveNumber(fallback.failureThreshold, 2),
      )))),
      cooldownMs: Math.min(1800000, Math.max(30000, Math.round(normalizePositiveNumber(
        source.cooldownMs,
        normalizePositiveNumber(fallback.cooldownMs, 300000),
      )))),
    };
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

  function normalizeUrlForCompare(value = '') {
    return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
  }

  function sameEndpoint(left = '', right = '') {
    const a = normalizeUrlForCompare(left);
    const b = normalizeUrlForCompare(right);
    return Boolean(a && b && a === b);
  }

  function validateArkAgentPlanImageFields(config = {}, label = '火山 Agent Plan', errors = []) {
    const imageSize = String(config.size || '').trim();
    if (imageSize && !/^(?:2K|3K|4K|\d+x\d+)$/i.test(imageSize)) {
      errors.push(`${label} 图像尺寸应为 2K、3K、4K 或 WIDTHxHEIGHT。`);
    }
    if (!['png', 'jpeg'].includes(String(config.outputFormat || 'png').trim().toLowerCase())) {
      errors.push(`${label} 输出格式必须是 png 或 jpeg。`);
    }
    if (!['url', 'b64_json'].includes(String(config.responseFormat || 'url').trim().toLowerCase())) {
      errors.push(`${label} 响应格式必须是 url 或 b64_json。`);
    }
  }

  function resolveSecretForTest(value = '') {
    return String(value || '').trim();
  }

  function parseImageRuntimeTestSource(value = '') {
    const source = String(value || '').trim();
    if (!source) return null;
    const match = source.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i);
    if (!match) {
      throw Object.assign(new Error('测试参考图只支持 PNG、JPEG 或 WebP。'), { statusCode: 400 });
    }
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (!buffer.length) {
      throw Object.assign(new Error('测试参考图内容为空。'), { statusCode: 400 });
    }
    if (buffer.length > IMAGE_RUNTIME_TEST_MAX_SOURCE_BYTES) {
      throw Object.assign(new Error('测试参考图不能超过 4MB。'), { statusCode: 413 });
    }
    return `data:${match[1].toLowerCase()};base64,${buffer.toString('base64')}`;
  }

  function buildImageRuntimeTestConfig(allConfigs = {}, role = 'primary') {
    const aiConfig = allConfigs.ai || {};
    const imageConfig = aiConfig.imageConfig || {};
    const normalizedRole = String(role || '').trim().toLowerCase() === 'fallback' ? 'fallback' : 'primary';
    const fallback = imageConfig.fallbackApi || {};
    if (normalizedRole === 'fallback' && fallback.enabled !== true) {
      throw Object.assign(new Error('图像生成备用 API 未开启。'), { statusCode: 400 });
    }
    const active = normalizedRole === 'fallback'
      ? {
          ...imageConfig,
          ...fallback,
          imageMode: fallback.imageMode || imageConfig.imageMode || 'openai',
          model: fallback.model || imageConfig.model || '',
          baseApi: fallback.baseApi || '',
          jimengApiUrl: fallback.jimengApiUrl || '',
          apiKey: fallback.apiKey || '',
        }
      : { ...imageConfig };
    active.userAgent = active.userAgent || aiConfig.userAgent || '';
    active.timeout = normalizePositiveNumber(active.timeout, normalizePositiveNumber(imageConfig.timeout, 60000));
    active.retryCount = 0;
    active.fallbackApi = { enabled: false };
    return { aiConfig, imageConfig, active, normalizedRole };
  }

  function buildImageRuntimePreview(imageUrl = '') {
    const value = String(imageUrl || '').trim();
    if (!value) return { previewUrl: '', sourceType: 'none', imageBytes: 0, previewOmitted: false };
    if (/^https?:\/\//i.test(value)) {
      return {
        previewUrl: `/api/image-proxy?url=${encodeURIComponent(value)}`,
        sourceType: 'url',
        imageBytes: 0,
        previewOmitted: false,
      };
    }
    const dataMatch = value.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
    if (!dataMatch) {
      return { previewUrl: '', sourceType: 'unknown', imageBytes: 0, previewOmitted: true };
    }
    const imageBytes = Buffer.from(dataMatch[1], 'base64').length;
    const previewOmitted = value.length > IMAGE_RUNTIME_TEST_MAX_PREVIEW_CHARS;
    return {
      previewUrl: previewOmitted ? '' : value,
      sourceType: 'base64',
      imageBytes,
      previewOmitted,
    };
  }

  function buildTestResultBase(target = '', role = 'primary', label = '') {
    return {
      success: false,
      target,
      role,
      roleLabel: role === 'fallback' ? '备用接口' : '主接口',
      label,
      checkedAt: new Date().toISOString(),
    };
  }

  function buildEndpointDiagnostic({
    endpoint = '',
    model = '',
    timeoutMs = 60000,
    requestConfig = {},
    apiKey = '',
    kind = 'openai',
  } = {}) {
    const normalizedEndpoint = String(endpoint || '').trim();
    let endpointOrigin = '';
    let endpointHost = '';
    let endpointPath = '';
    try {
      const parsed = new URL(normalizedEndpoint);
      endpointOrigin = parsed.origin;
      endpointHost = parsed.host;
      endpointPath = parsed.pathname || '/';
    } catch {
      endpointOrigin = normalizedEndpoint ? '(无效地址)' : '(未配置)';
    }

    const userAgent = kind === 'openai-compatible'
      ? (buildAiUserAgentHeaders(requestConfig)['User-Agent'] || getDefaultAiUserAgent())
      : String(requestConfig?.userAgent || '').trim();
    return {
      kind,
      endpointOrigin,
      endpointHost,
      endpointPath,
      model: String(model || ''),
      timeoutMs: Math.min(300000, Math.max(1000, normalizePositiveNumber(timeoutMs, 60000))),
      userAgent,
      apiKeyConfigured: Boolean(String(apiKey || '').trim()),
    };
  }

  async function probeOpenAiModels({
    target = '',
    role = 'primary',
    label = '',
    baseApi = '',
    apiKey = '',
    model = '',
    timeoutMs = 60000,
    requestConfig = {},
    apiKeyOptional = false,
  } = {}) {
    const resultBase = buildTestResultBase(target, role, label);
    const normalizedBaseApi = String(baseApi || '').trim();
    const normalizedApiKey = resolveSecretForTest(apiKey);
    const safeTimeoutMs = Math.min(300000, Math.max(1000, normalizePositiveNumber(timeoutMs, 60000)));
    const diagnostic = buildEndpointDiagnostic({
      endpoint: normalizedBaseApi,
      model,
      timeoutMs: safeTimeoutMs,
      requestConfig,
      apiKey: normalizedApiKey,
      kind: 'openai-compatible',
    });

    if (!normalizedBaseApi) {
      return { ...resultBase, error: `${label || '接口'}地址未配置。`, timeoutMs: safeTimeoutMs, diagnostic };
    }
    if (!isHttpUrl(normalizedBaseApi)) {
      return { ...resultBase, error: `${label || '接口'}地址不是 http(s) URL。`, timeoutMs: safeTimeoutMs, diagnostic };
    }
    if (!apiKeyOptional && !normalizedApiKey) {
      return { ...resultBase, error: `${label || '接口'} API Key 未配置。`, timeoutMs: safeTimeoutMs, diagnostic };
    }

    const startedAt = Date.now();
    try {
      const response = await fetchFn(buildOpenAiCompatibleUrl(normalizedBaseApi, '/v1/models'), {
        method: 'GET',
        headers: {
          ...(normalizedApiKey ? { Authorization: `Bearer ${normalizedApiKey}` } : {}),
          ...buildAiUserAgentHeaders(requestConfig),
        },
        signal: AbortSignal.timeout(safeTimeoutMs),
      });
      const latencyMs = Date.now() - startedAt;
      if (response.ok) {
        return {
          ...resultBase,
          success: true,
          detail: `${label || '接口'}可访问，耗时 ${latencyMs}ms${model ? `，模型 ${model}` : ''}`,
          latencyMs,
          timeoutMs: safeTimeoutMs,
          model,
          diagnostic,
        };
      }
      return {
        ...resultBase,
        error: `${label || '接口'}返回 HTTP ${response.status}`,
        statusCode: response.status,
        latencyMs,
        timeoutMs: safeTimeoutMs,
        model,
        diagnostic,
      };
    } catch (error) {
      return {
        ...resultBase,
        error: `${label || '接口'}请求失败：${error.message}`,
        latencyMs: Date.now() - startedAt,
        timeoutMs: safeTimeoutMs,
        model,
        diagnostic,
      };
    }
  }

  async function probeHttpEndpoint({
    target = '',
    role = 'primary',
    label = '',
    url = '',
    timeoutMs = 60000,
    headers = {},
  } = {}) {
    const resultBase = buildTestResultBase(target, role, label);
    const normalizedUrl = String(url || '').trim();
    const safeTimeoutMs = Math.min(300000, Math.max(1000, normalizePositiveNumber(timeoutMs, 60000)));
    const diagnostic = buildEndpointDiagnostic({
      endpoint: normalizedUrl,
      timeoutMs: safeTimeoutMs,
      requestConfig: {},
      apiKey: headers?.Authorization ? 'configured' : '',
      kind: 'http-endpoint',
    });

    if (!normalizedUrl) {
      return { ...resultBase, error: `${label || '接口'}地址未配置。`, timeoutMs: safeTimeoutMs, diagnostic };
    }
    if (!isHttpUrl(normalizedUrl)) {
      return { ...resultBase, error: `${label || '接口'}地址不是 http(s) URL。`, timeoutMs: safeTimeoutMs, diagnostic };
    }

    const startedAt = Date.now();
    try {
      let response = await fetchFn(normalizedUrl, {
        method: 'HEAD',
        headers,
        signal: AbortSignal.timeout(safeTimeoutMs),
      });
      if ([405, 403, 404].includes(Number(response.status))) {
        response = await fetchFn(normalizedUrl, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(safeTimeoutMs),
        });
      }
      const latencyMs = Date.now() - startedAt;
      if (response.ok || [401, 403, 404, 405].includes(Number(response.status))) {
        const authHint = [401, 403].includes(Number(response.status)) ? '，端点存在但需要授权或拒绝了探测请求' : '';
        return {
          ...resultBase,
          success: true,
          detail: `${label || '接口'}端点可达，HTTP ${response.status}${authHint}，耗时 ${latencyMs}ms`,
          statusCode: response.status,
          latencyMs,
          timeoutMs: safeTimeoutMs,
          diagnostic,
        };
      }
      return {
        ...resultBase,
        error: `${label || '接口'}返回 HTTP ${response.status}`,
        statusCode: response.status,
        latencyMs,
        timeoutMs: safeTimeoutMs,
        diagnostic,
      };
    } catch (error) {
      return {
        ...resultBase,
        error: `${label || '接口'}请求失败：${error.message}`,
        latencyMs: Date.now() - startedAt,
        timeoutMs: safeTimeoutMs,
        diagnostic,
      };
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
    const imageFallbackIsAgentPlan = isArkAgentPlanImageMode(imageFallback.imageMode);
    const memeFallback = aiConfig.memeConfig?.fallbackApi || {};
    const imageMonitorFallback = imageMonitorConfig.fallbackApi || {};
    const searchFallback = coreConfig.tools?.search?.fallbackApi || {};
    const identity = buildBotIdentitySnapshot(allConfigs);

    return {
      ai: {
        baseApi: aiConfig.baseApi || '',
        apiKey: '',
        apiKeyConfigured: hasConfiguredSecret(aiConfig.apiKey),
        userAgent: aiConfig.userAgent || '',
        defaultUserAgent: getDefaultAiUserAgent(),
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
          ...normalizeFallbackAutoSwitch(aiFallback),
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
          outputFormat: aiConfig.imageConfig?.outputFormat || 'png',
          watermark: aiConfig.imageConfig?.watermark === true,
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
            size: imageFallback.size || (imageFallbackIsAgentPlan ? '2K' : ''),
            responseFormat: imageFallback.responseFormat || (imageFallbackIsAgentPlan ? 'url' : ''),
            outputFormat: imageFallback.outputFormat || (imageFallbackIsAgentPlan ? 'png' : ''),
            watermark: imageFallback.watermark === true,
            ...normalizeFallbackAutoSwitch(imageFallback),
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
            ...normalizeFallbackAutoSwitch(memeFallback),
          },
        },
      },
      imageMonitor: {
        enabled: imageMonitorConfig.enabled === true,
        storageEnabled: imageMonitorConfig.storageEnabled === true,
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
          ...normalizeFallbackAutoSwitch(imageMonitorFallback),
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
              ...normalizeFallbackAutoSwitch(searchFallback),
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
    const userAgentValidation = validateAiUserAgent(ai.userAgent || '');
    if (!userAgentValidation.ok) {
      errors.push(`AI 主对话 User-Agent 不合法：${userAgentValidation.error}`);
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
      } else if (sameEndpoint(ai.baseApi, aiFallback.baseApi)) {
        warnings.push('AI 主对话备用 API 与主 API 地址相同，主接口故障时可能无法真正兜底。');
      }
      if (!hasSecretForPrecheck(aiFallback.apiKey, aiFallback.preserveApiKey, currentAiFallback.apiKey)) {
        warnings.push('AI 主对话备用 API 已开启，但未配置备用 API Key。');
      }
      if (!String(aiFallback.modelType || '').trim()) {
        warnings.push('AI 主对话备用 API 已开启，但未填写备用文本模型。');
      }
      if (aiFallback.autoSwitchEnabled !== false && !String(aiFallback.baseApi || '').trim()) {
        warnings.push('AI 主对话备用自动切换已开启，但备用地址不完整，触发后无法切换。');
      }
    }

    if (imageConfig.enabled !== false) {
      const imageMode = String(imageConfig.imageMode || '').trim();
      const imageSize = String(imageConfig.size || '').trim();
      if (isArkAgentPlanImageMode(imageMode)) {
        validateArkAgentPlanImageFields(imageConfig, '火山 Agent Plan', errors);
      } else if (/^[234]K$/i.test(imageSize)) {
        errors.push('2K、3K、4K 是火山 Agent Plan 专用尺寸，请切换 Agent Plan 模式或选择具体宽高。');
      }
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
        if (isArkAgentPlanImageMode(imageMode) && !/\/api\/plan\/v3(?:\/|$)/i.test(imageBaseApi)) {
          warnings.push('火山 Agent Plan 地址通常应以 /api/plan/v3 结尾。');
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
          } else if (sameEndpoint(imageConfig.baseApi || ai.baseApi, imageFallback.baseApi)) {
            warnings.push('图像生成备用 API 与主图像 API 地址相同，生图故障时可能无法真正兜底。');
          }
          if (!String(imageFallback.model || '').trim()) {
            warnings.push('图像生成备用 API 已开启，但未填写备用图像模型。');
          }
          if (isArkAgentPlanImageMode(fallbackImageMode) && !/\/api\/plan\/v3(?:\/|$)/i.test(String(imageFallback.baseApi || ''))) {
            warnings.push('备用火山 Agent Plan 地址通常应以 /api/plan/v3 结尾。');
          }
          if (isArkAgentPlanImageMode(fallbackImageMode)) {
            validateArkAgentPlanImageFields(imageFallback, '备用火山 Agent Plan', errors);
          } else if (/^[234]K$/i.test(String(imageFallback.size || '').trim())) {
            errors.push('备用图像的 2K、3K、4K 尺寸仅适用于火山 Agent Plan。');
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
        } else if (sameEndpoint(imageMonitor.apiBase, imageMonitorFallback.apiBase)) {
          warnings.push('图片监控备用 API 与主识别 API 地址相同，主接口故障时可能无法真正兜底。');
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
      if (String(search.markdownApiUrl || '').trim() && !String(search.markdownStatusUrl || '').trim()) {
        warnings.push('搜索工具填写了 Markdown 提交地址，但未填写状态查询地址，网页读取可能无法完成。');
      }
      if (String(search.markdownStatusUrl || '').trim() && !isHttpUrl(search.markdownStatusUrl)) {
        warnings.push('搜索工具状态地址不是标准 http(s) URL。');
      }
      if (searchFallback.enabled === true) {
        if (!String(searchFallback.apiUrl || '').trim()) {
          warnings.push('搜索工具备用 API 已开启，但未填写备用搜索 API 地址。');
        } else if (!isHttpUrl(searchFallback.apiUrl)) {
          warnings.push('搜索工具备用搜索 API 地址不是标准 http(s) URL。');
        } else if (sameEndpoint(search.apiUrl, searchFallback.apiUrl)) {
          warnings.push('搜索工具备用搜索 API 与主搜索 API 地址相同，搜索故障时可能无法真正兜底。');
        }
        if (!String(searchFallback.markdownApiUrl || '').trim()) {
          warnings.push('搜索工具备用 API 已开启，但未填写备用网页读取提交地址。');
        } else if (!isHttpUrl(searchFallback.markdownApiUrl)) {
          warnings.push('搜索工具备用网页读取提交地址不是标准 http(s) URL。');
        } else if (sameEndpoint(search.markdownApiUrl, searchFallback.markdownApiUrl)) {
          warnings.push('搜索工具备用网页读取提交地址与主地址相同，网页读取故障时可能无法真正兜底。');
        }
        if (String(searchFallback.markdownApiUrl || '').trim() && !String(searchFallback.markdownStatusUrl || '').trim()) {
          warnings.push('搜索工具备用网页读取已填写提交地址，但缺少备用状态查询地址。');
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
      } else if (sameEndpoint(memeConfig.apiBase, memeFallback.apiBase)) {
        warnings.push('表情包备用 API 与主表情包 API 地址相同，远程服务故障时可能无法真正兜底。');
      }
    }

    addChange(changes, 'AI 主对话 API 地址', currentAi.baseApi, ai.baseApi);
    addChange(changes, 'AI 主对话 User-Agent', currentAi.userAgent, normalizeAiUserAgent(ai.userAgent || ''));
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
    addChange(changes, 'AI 主对话备用自动切换', currentAiFallback.autoSwitchEnabled !== false, aiFallback.autoSwitchEnabled !== false);
    addChange(changes, 'AI 主对话备用失败阈值', normalizeFallbackAutoSwitch(currentAiFallback).failureThreshold, normalizeFallbackAutoSwitch(aiFallback).failureThreshold);
    addChange(changes, 'AI 主对话备用冷却时间', normalizeFallbackAutoSwitch(currentAiFallback).cooldownMs, normalizeFallbackAutoSwitch(aiFallback).cooldownMs);
    if (String(aiFallback.apiKey || '').trim()) {
      changes.push({ label: 'AI 主对话备用 API Key', before: hasConfiguredSecret(currentAiFallback.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '图像生成开关', currentImageConfig.enabled !== false, imageConfig.enabled !== false);
    addChange(changes, '图像生成模式', currentImageConfig.imageMode, imageConfig.imageMode);
    addChange(changes, '图像生成模型', currentImageConfig.model, imageConfig.model);
    addChange(changes, '图像 API 地址', currentImageConfig.baseApi, imageConfig.baseApi);
    addChange(changes, '即梦 API 地址', currentImageConfig.jimengApiUrl, imageConfig.jimengApiUrl);
    addChange(changes, '图像尺寸', currentImageConfig.size, imageConfig.size);
    addChange(changes, '图像响应格式', currentImageConfig.responseFormat, imageConfig.responseFormat);
    addChange(changes, 'Agent Plan 输出格式', currentImageConfig.outputFormat, imageConfig.outputFormat);
    addChange(changes, 'Agent Plan 水印', currentImageConfig.watermark === true, imageConfig.watermark === true);
    if (String(imageConfig.apiKey || '').trim()) {
      changes.push({ label: '图像生成 API Key', before: hasConfiguredSecret(currentImageConfig.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '图像生成备用 API 开关', currentImageFallback.enabled === true, imageFallback.enabled === true);
    addChange(changes, '图像生成备用模式', currentImageFallback.imageMode, imageFallback.imageMode);
    addChange(changes, '图像生成备用模型', currentImageFallback.model, imageFallback.model);
    addChange(changes, '图像生成备用 API 地址', currentImageFallback.baseApi, imageFallback.baseApi);
    addChange(changes, '图像生成备用即梦 API 地址', currentImageFallback.jimengApiUrl, imageFallback.jimengApiUrl);
    addChange(changes, '图像生成备用尺寸', currentImageFallback.size, imageFallback.size);
    addChange(changes, '图像生成备用响应格式', currentImageFallback.responseFormat, imageFallback.responseFormat);
    addChange(changes, '备用 Agent Plan 输出格式', currentImageFallback.outputFormat, imageFallback.outputFormat);
    addChange(changes, '备用 Agent Plan 水印', currentImageFallback.watermark === true, imageFallback.watermark === true);
    addChange(changes, '图像生成备用自动切换', currentImageFallback.autoSwitchEnabled !== false, imageFallback.autoSwitchEnabled !== false);
    addChange(changes, '图像生成备用失败阈值', normalizeFallbackAutoSwitch(currentImageFallback).failureThreshold, normalizeFallbackAutoSwitch(imageFallback).failureThreshold);
    addChange(changes, '图像生成备用冷却时间', normalizeFallbackAutoSwitch(currentImageFallback).cooldownMs, normalizeFallbackAutoSwitch(imageFallback).cooldownMs);
    if (String(imageFallback.apiKey || '').trim()) {
      changes.push({ label: '图像生成备用 API Key', before: hasConfiguredSecret(currentImageFallback.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '表情本地目录', currentAi.memeConfig?.localBaseDir, memeConfig.localBaseDir);
    addChange(changes, '表情包备用 API 开关', currentMemeFallback.enabled === true, memeFallback.enabled === true);
    addChange(changes, '表情包备用 API 地址', currentMemeFallback.apiBase, memeFallback.apiBase);
    addChange(changes, '表情包备用自动切换', currentMemeFallback.autoSwitchEnabled !== false, memeFallback.autoSwitchEnabled !== false);
    addChange(changes, '表情包备用失败阈值', normalizeFallbackAutoSwitch(currentMemeFallback).failureThreshold, normalizeFallbackAutoSwitch(memeFallback).failureThreshold);
    addChange(changes, '表情包备用冷却时间', normalizeFallbackAutoSwitch(currentMemeFallback).cooldownMs, normalizeFallbackAutoSwitch(memeFallback).cooldownMs);
    addChange(changes, '图片监控开关', currentImageMonitor.enabled === true, imageMonitor.enabled === true);
    addChange(changes, '图片本地入库总开关', currentImageMonitor.storageEnabled === true, imageMonitor.storageEnabled === true);
    addChange(changes, '图片监控 API 地址', currentImageMonitor.apiBase, imageMonitor.apiBase);
    addChange(changes, '图片监控模型', currentImageMonitor.model, imageMonitor.model);
    if (String(imageMonitor.apiKey || '').trim()) {
      changes.push({ label: '图片监控 API Key', before: hasConfiguredSecret(currentImageMonitor.apiKey) ? '已配置' : '空', after: '将更新' });
    }
    addChange(changes, '图片监控备用 API 开关', currentImageMonitorFallback.enabled === true, imageMonitorFallback.enabled === true);
    addChange(changes, '图片监控备用 API 地址', currentImageMonitorFallback.apiBase, imageMonitorFallback.apiBase);
    addChange(changes, '图片监控备用模型', currentImageMonitorFallback.model, imageMonitorFallback.model);
    addChange(changes, '图片监控备用自动切换', currentImageMonitorFallback.autoSwitchEnabled !== false, imageMonitorFallback.autoSwitchEnabled !== false);
    addChange(changes, '图片监控备用失败阈值', normalizeFallbackAutoSwitch(currentImageMonitorFallback).failureThreshold, normalizeFallbackAutoSwitch(imageMonitorFallback).failureThreshold);
    addChange(changes, '图片监控备用冷却时间', normalizeFallbackAutoSwitch(currentImageMonitorFallback).cooldownMs, normalizeFallbackAutoSwitch(imageMonitorFallback).cooldownMs);
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
    addChange(changes, '搜索工具备用自动切换', currentSearchFallback.autoSwitchEnabled !== false, searchFallback.autoSwitchEnabled !== false);
    addChange(changes, '搜索工具备用失败阈值', normalizeFallbackAutoSwitch(currentSearchFallback).failureThreshold, normalizeFallbackAutoSwitch(searchFallback).failureThreshold);
    addChange(changes, '搜索工具备用冷却时间', normalizeFallbackAutoSwitch(currentSearchFallback).cooldownMs, normalizeFallbackAutoSwitch(searchFallback).cooldownMs);
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

  function buildApiSettingsConfigSnapshot(payload = {}) {
    const allConfigs = getAllConfigs() || {};
    const nextConfigs = {
      ...allConfigs,
    };

    if (payload.ai) {
      const currentAi = allConfigs.ai || {};
      const nextAi = {
        ...currentAi,
        baseApi: payload.ai.baseApi,
        apiKey: resolveSecretSaveValue(payload.ai.apiKey, currentAi.apiKey, payload.ai.preserveApiKey === true),
        userAgent: normalizeAiUserAgent(payload.ai.userAgent || ''),
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
          ...normalizeFallbackAutoSwitch(payload.ai.fallbackApi, currentAi.fallbackApi || {}),
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
            size: String(payload.ai.imageConfig.fallbackApi.size || ''),
            responseFormat: String(payload.ai.imageConfig.fallbackApi.responseFormat || ''),
            outputFormat: String(payload.ai.imageConfig.fallbackApi.outputFormat || ''),
            watermark: payload.ai.imageConfig.fallbackApi.watermark === true,
            ...normalizeFallbackAutoSwitch(payload.ai.imageConfig.fallbackApi, currentAi.imageConfig?.fallbackApi || {}),
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
            ...normalizeFallbackAutoSwitch(payload.ai.memeConfig.fallbackApi, currentAi.memeConfig?.fallbackApi || {}),
          };
        }
      }

      nextConfigs.ai = nextAi;
    }

    if (payload.imageMonitor) {
      const currentImageMonitor = allConfigs.imageMonitor || {};
      const nextImageMonitor = {
        ...currentImageMonitor,
        enabled: payload.imageMonitor.enabled,
        storageEnabled: payload.imageMonitor.storageEnabled === true,
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
          ...normalizeFallbackAutoSwitch(payload.imageMonitor.fallbackApi, currentImageMonitor.fallbackApi || {}),
        };
      }
      nextConfigs.imageMonitor = nextImageMonitor;
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
              ...normalizeFallbackAutoSwitch(payload.coreConfig.tools.search.fallbackApi, currentCore.tools?.search?.fallbackApi || {}),
            } : currentCore.tools?.search?.fallbackApi,
          },
        },
      };
      nextConfigs.coreConfig = nextCore;
    }

    return nextConfigs;
  }

  async function saveApiSettings(payload = {}) {
    const nextConfigs = buildApiSettingsConfigSnapshot(payload);

    if (payload.ai) {
      await setConfig('ai', nextConfigs.ai);
    }
    if (payload.imageMonitor) {
      await setConfig('imageMonitor', nextConfigs.imageMonitor);
    }
    if (payload.coreConfig?.tools?.search) {
      await setConfig('coreConfig', nextConfigs.coreConfig);
    }

    return buildApiSettingsPayload();
  }

  async function testApiTargetConnection(target = 'ai-main', role = 'primary', draftPayload = null) {
    const usingDraft = isPlainObject(draftPayload);
    const allConfigs = usingDraft ? buildApiSettingsConfigSnapshot(draftPayload) : (getAllConfigs() || {});
    const normalizedTarget = String(target || 'ai-main').trim();
    const normalizedRole = String(role || 'primary').trim().toLowerCase() === 'fallback' ? 'fallback' : 'primary';
    const aiConfig = allConfigs.ai || {};
    const imageConfig = aiConfig.imageConfig || {};
    const imageMonitorConfig = allConfigs.imageMonitor || {};
    const searchConfig = allConfigs.coreConfig?.tools?.search || {};
    const memeConfig = aiConfig.memeConfig || {};
    const attachConfigSource = result => ({
      ...result,
      configSource: usingDraft ? 'draft' : 'saved',
      configSourceLabel: usingDraft ? '当前页面草稿' : '已保存配置',
    });

    if (normalizedTarget === 'ai-main') {
      const fallback = aiConfig.fallbackApi || {};
      const active = normalizedRole === 'fallback' ? fallback : aiConfig;
      if (normalizedRole === 'fallback' && fallback.enabled !== true) {
        return attachConfigSource({ ...buildTestResultBase(normalizedTarget, normalizedRole, 'AI 主对话备用 API'), error: 'AI 主对话备用 API 未开启。' });
      }
      return attachConfigSource(await probeOpenAiModels({
        target: normalizedTarget,
        role: normalizedRole,
        label: normalizedRole === 'fallback' ? 'AI 主对话备用 API' : 'AI 主对话 API',
        baseApi: active.baseApi,
        apiKey: active.apiKey,
        model: active.modelType || active.workingModel || aiConfig.modelType || aiConfig.workingModel || '',
        timeoutMs: aiConfig.timeout,
        requestConfig: normalizedRole === 'fallback' ? { ...aiConfig, ...active } : aiConfig,
      }));
    }

    if (normalizedTarget === 'ai-image') {
      const fallback = imageConfig.fallbackApi || {};
      const active = normalizedRole === 'fallback' ? {
        ...imageConfig,
        ...fallback,
        baseApi: fallback.baseApi || '',
        jimengApiUrl: fallback.jimengApiUrl || '',
        imageMode: fallback.imageMode || imageConfig.imageMode || 'openai',
        model: fallback.model || imageConfig.model || '',
        apiKey: fallback.apiKey || '',
      } : imageConfig;
      if (normalizedRole === 'fallback' && fallback.enabled !== true) {
        return attachConfigSource({ ...buildTestResultBase(normalizedTarget, normalizedRole, '图像生成备用 API'), error: '图像生成备用 API 未开启。' });
      }
      const imageMode = String(active.imageMode || 'openai').trim();
      if (imageMode === 'jimeng') {
        return attachConfigSource(await probeHttpEndpoint({
          target: normalizedTarget,
          role: normalizedRole,
          label: normalizedRole === 'fallback' ? '备用即梦接口' : '即梦接口',
          url: active.jimengApiUrl,
          timeoutMs: imageConfig.timeout,
        }));
      }
      if (isArkAgentPlanImageMode(imageMode)) {
        return attachConfigSource(await probeHttpEndpoint({
          target: normalizedTarget,
          role: normalizedRole,
          label: normalizedRole === 'fallback' ? '备用火山 Agent Plan' : '火山 Agent Plan',
          url: buildArkAgentPlanImageUrl(active.baseApi),
          timeoutMs: imageConfig.timeout,
          headers: active.apiKey ? { Authorization: `Bearer ${active.apiKey}` } : {},
        }));
      }
      return attachConfigSource(await probeOpenAiModels({
        target: normalizedTarget,
        role: normalizedRole,
        label: normalizedRole === 'fallback' ? '图像生成备用 API' : '图像生成 API',
        baseApi: active.baseApi || aiConfig.baseApi,
        apiKey: active.apiKey || (normalizedRole === 'primary' ? aiConfig.apiKey : ''),
        model: active.model || '',
        timeoutMs: imageConfig.timeout || aiConfig.timeout,
        requestConfig: { ...aiConfig, ...active },
      }));
    }

    if (normalizedTarget === 'image-monitor') {
      const fallback = imageMonitorConfig.fallbackApi || {};
      const active = normalizedRole === 'fallback' ? fallback : imageMonitorConfig;
      if (normalizedRole === 'primary' && imageMonitorConfig.enabled !== true) {
        return attachConfigSource({ ...buildTestResultBase(normalizedTarget, normalizedRole, '图片监控 API'), error: '图片监控未开启。' });
      }
      if (normalizedRole === 'fallback' && fallback.enabled !== true) {
        return attachConfigSource({ ...buildTestResultBase(normalizedTarget, normalizedRole, '图片监控备用 API'), error: '图片监控备用 API 未开启。' });
      }
      return attachConfigSource(await probeOpenAiModels({
        target: normalizedTarget,
        role: normalizedRole,
        label: normalizedRole === 'fallback' ? '图片监控备用 API' : '图片监控 API',
        baseApi: active.apiBase,
        apiKey: active.apiKey,
        model: active.model || '',
        timeoutMs: imageMonitorConfig.analysisTimeoutMs || aiConfig.timeout,
        requestConfig: { ...aiConfig, ...active },
        apiKeyOptional: false,
      }));
    }

    if (normalizedTarget === 'search') {
      const fallback = searchConfig.fallbackApi || {};
      const active = normalizedRole === 'fallback' ? fallback : searchConfig;
      if (normalizedRole === 'primary' && searchConfig.enabled !== true) {
        return attachConfigSource({ ...buildTestResultBase(normalizedTarget, normalizedRole, '搜索工具 API'), error: '搜索工具未开启。' });
      }
      if (normalizedRole === 'fallback' && fallback.enabled !== true) {
        return attachConfigSource({ ...buildTestResultBase(normalizedTarget, normalizedRole, '搜索工具备用 API'), error: '搜索工具备用 API 未开启。' });
      }
      const timeoutMs = searchConfig.timeoutMs || aiConfig.timeout || 60000;
      const apiKey = String(active.apiKey || '').trim();
      const headers = {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      };
      const searchProbe = await probeHttpEndpoint({
        target: normalizedTarget,
        role: normalizedRole,
        label: normalizedRole === 'fallback' ? '备用搜索接口' : '搜索接口',
        url: active.apiUrl,
        timeoutMs,
        headers,
      });
      const markdownUrl = active.markdownApiUrl || active.markdownStatusUrl || '';
      const markdownProbe = markdownUrl ? await probeHttpEndpoint({
        target: normalizedTarget,
        role: normalizedRole,
        label: normalizedRole === 'fallback' ? '备用网页读取接口' : '网页读取接口',
        url: markdownUrl,
        timeoutMs,
        headers,
      }) : null;
      return attachConfigSource({
        ...searchProbe,
        success: searchProbe.success === true || markdownProbe?.success === true,
        detail: [
          searchProbe.detail || searchProbe.error,
          markdownProbe ? (markdownProbe.detail || markdownProbe.error) : '网页读取接口未配置。',
        ].filter(Boolean).join('；'),
        markdown: markdownProbe,
      });
    }

    if (normalizedTarget === 'meme') {
      const fallback = memeConfig.fallbackApi || {};
      const activeApiBase = normalizedRole === 'fallback' ? fallback.apiBase : memeConfig.apiBase;
      if (normalizedRole === 'fallback' && fallback.enabled !== true) {
        return attachConfigSource({ ...buildTestResultBase(normalizedTarget, normalizedRole, '表情包备用 API'), error: '表情包备用 API 未开启。' });
      }
      return attachConfigSource(await probeHttpEndpoint({
        target: normalizedTarget,
        role: normalizedRole,
        label: normalizedRole === 'fallback' ? '表情包备用 API' : '表情包 API',
        url: activeApiBase ? `${String(activeApiBase).replace(/\/+$/, '')}/api/characters.php` : '',
        timeoutMs: aiConfig.timeout || 60000,
      }));
    }

    return attachConfigSource({ ...buildTestResultBase(normalizedTarget, normalizedRole, '未知 API'), error: `未知测试目标：${normalizedTarget}` });
  }

  async function testApiConnection() {
    const result = await testApiTargetConnection('ai-main', 'primary');
    return {
      ...result,
      error: result.success ? '' : (result.error || 'API request failed.'),
    };
  }

  async function testImageApiConnection() {
    const result = await testApiTargetConnection('ai-image', 'primary');
    return {
      ...result,
      error: result.success ? '' : (result.error || 'Image API request failed.'),
    };
  }

  async function testImageGenerationRuntime(request = {}) {
    const operation = String(request.operation || 'generate').trim().toLowerCase() === 'edit' ? 'edit' : 'generate';
    const prompt = String(request.prompt || '').trim();
    if (!prompt) {
      throw Object.assign(new Error('请填写真实生图测试提示词。'), { statusCode: 400 });
    }
    if (prompt.length > 2000) {
      throw Object.assign(new Error('真实生图测试提示词不能超过 2000 个字符。'), { statusCode: 400 });
    }
    const usingDraft = isPlainObject(request.payload || request.draft);
    const allConfigs = usingDraft
      ? buildApiSettingsConfigSnapshot(request.payload || request.draft)
      : (getAllConfigs() || {});
    const { aiConfig, active, normalizedRole } = buildImageRuntimeTestConfig(allConfigs, request.role);
    const sourceImage = operation === 'edit' ? parseImageRuntimeTestSource(request.imageDataUrl) : null;
    if (operation === 'edit' && !sourceImage) {
      throw Object.assign(new Error('图生图测试必须选择一张参考图片。'), { statusCode: 400 });
    }

    const processor = new ImageProcessor();
    const runtimeConfig = processor.mergeImageConfig({
      ...aiConfig,
      ...(normalizedRole === 'fallback' ? { baseApi: '', apiKey: '' } : {}),
      retryCount: 0,
      imageConfig: active,
    });
    const validation = processor.validateImageConfig(runtimeConfig);
    if (!validation.isValid) {
      throw Object.assign(new Error(validation.errors.join('；')), { statusCode: 400 });
    }

    const startedAt = Date.now();
    const result = operation === 'edit'
      ? await processor.editImage(prompt, [sourceImage], runtimeConfig)
      : await processor.generateImage(prompt, runtimeConfig);
    const latencyMs = Date.now() - startedAt;
    if (!result?.success || !result.imageUrl) {
      return {
        success: false,
        target: 'ai-image-runtime',
        role: normalizedRole,
        operation,
        configSource: usingDraft ? 'draft' : 'saved',
        configSourceLabel: usingDraft ? '当前页面草稿' : '已保存配置',
        latencyMs,
        mode: runtimeConfig.imageMode || 'openai',
        model: result?.model || runtimeConfig.model || '',
        error: String(result?.error || result?.response || '接口没有返回图片。').slice(0, 800),
      };
    }

    return {
      success: true,
      target: 'ai-image-runtime',
      role: normalizedRole,
      operation,
      configSource: usingDraft ? 'draft' : 'saved',
      configSourceLabel: usingDraft ? '当前页面草稿' : '已保存配置',
      latencyMs,
      mode: runtimeConfig.imageMode || 'openai',
      model: result.model || runtimeConfig.model || '',
      ...buildImageRuntimePreview(result.imageUrl),
    };
  }

  async function testImageMonitorApiConnection() {
    const result = await testApiTargetConnection('image-monitor', 'primary');
    return {
      ...result,
      error: result.success ? '' : (result.error || 'Image monitor API request failed.'),
    };
  }

  async function testSearchApiConnection() {
    const result = await testApiTargetConnection('search', 'primary');
    return {
      ...result,
      error: result.success ? '' : (result.error || 'Search API request failed.'),
    };
  }

  return {
    buildApiSettingsPayload,
    precheckApiSettings,
    saveApiSettings,
    testApiTargetConnection,
    testApiConnection,
    testImageApiConnection,
    testImageGenerationRuntime,
    testImageMonitorApiConnection,
    testSearchApiConnection,
  };
}
