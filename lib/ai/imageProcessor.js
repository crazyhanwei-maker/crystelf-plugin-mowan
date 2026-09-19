import axios from 'axios';
import FormData from 'form-data';
import { logImageUsage } from './imageUsageLogger.js';
import { buildImageFallbackConfig } from './apiFallback.js';
import {
  buildVirtualApiCircuitConfig,
  recordFallbackApiFailure,
  recordFallbackApiSuccess,
  recordPrimaryApiFailure,
  recordPrimaryApiSuccess,
  shouldPreferFallbackApi,
} from './apiCircuitBreaker.js';
import { withRetry } from './retry.js';
import { buildAiUserAgentHeaders } from './userAgent.js';
import {
  buildArkAgentPlanImageRequest,
  buildArkAgentPlanImageUrl,
  isArkAgentPlanImageMode,
  normalizeImageSizeValue,
  supportsImageOperation,
} from './imageApi.js';
import { getImageDimensions, getImagePixelCount } from './imageDimensions.js';
import {
  buildSdWebUiApiUrl,
  buildSdWebUiAuthHeaders,
  buildSdWebUiRequest,
  isSdWebUiImageMode,
  normalizeSdWebUiSettings,
} from './sdWebUiApi.js';

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeOpenAiBaseApi(value = '') {
  return normalizeBaseUrl(value).replace(/\/v1$/i, '');
}

function buildOpenAiApiUrl(baseApi = '', path = '') {
  return `${normalizeOpenAiBaseApi(baseApi)}${path}`;
}

function buildJimengApiUrl(baseApi = '', path = '') {
  return `${normalizeBaseUrl(baseApi)}${path}`;
}

function cleanupExtractedImageUrl(value = '') {
  return String(value || '')
    .trim()
    .replace(/[),，。；;]+$/g, '');
}

function summarizePromptForLog(prompt = '') {
  return `提示词长度 ${String(prompt || '').length}`;
}

function summarizeResponseForLog(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (typeof value !== 'object') {
    return `${typeof value}(length=${String(value).length})`;
  }
  const keys = Object.keys(value).slice(0, 20);
  const summary = {
    keys,
    dataLength: Array.isArray(value.data) ? value.data.length : undefined,
    choicesLength: Array.isArray(value.choices) ? value.choices.length : undefined,
    imagesLength: Array.isArray(value.images) ? value.images.length : undefined,
    error: String(value.error?.message || value.error || value.message || '').replace(/\s+/g, ' ').trim().slice(0, 240) || undefined,
  };
  return JSON.stringify(summary);
}

function summarizeTextForLog(value = '', maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function shouldSendImageStyle(model = '') {
  return /^dall-e-3$/i.test(String(model || '').trim());
}

function encodeImageDataUrlFromBase64(value = '', mimeType = 'image/png') {
  const encoded = String(value || '').trim();
  if (!encoded) return '';
  if (encoded.startsWith('data:image/')) return encoded;
  return `data:${mimeType || 'image/png'};base64,${encoded}`;
}

function resolveImageOutput(imageData = {}) {
  const url = String(imageData?.url || '').trim();
  if (url) return url;
  return encodeImageDataUrlFromBase64(imageData?.b64_json, imageData?.mime_type || 'image/png');
}

function decodeImageDataUrl(value = '') {
  const match = String(value || '').trim().match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    buffer: Buffer.from(match[2], 'base64'),
    mimeType: match[1],
  };
}

function imageExtensionForMime(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  return 'png';
}

class ImageProcessor {
  constructor() {
    this.isInitialized = false;
    this.config = null;
  }

  init(config) {
    try {
      this.config = config;
      this.isInitialized = true;
    } catch (error) {
      logger.error(`[crystelf-ai] 图像处理器初始化失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 生成或编辑图像
   * @param {string} prompt - 图像描述
   * @param {string|null} sourceImageArr - 源图像URL数组
   * @param {Object} config - 配置对象
   * @returns {Promise<Object>} 处理结果
   */
  async generateOrEditImage(prompt, sourceImageArr = [], config = this.config) {
    const startedAt = Date.now();
    if (!this.isInitialized && !config) {
      await logImageUsage({
        stage: 'error',
        prompt,
        error: '图像处理器未初始化',
        elapsedMs: Date.now() - startedAt,
        sourceCount: Array.isArray(sourceImageArr) ? sourceImageArr.length : 0,
      });
      return {
        success: false,
        error: '图像处理器未初始化'
      };
    }

    try {
      const mergedConfig = this.mergeImageConfig(config || this.config);
      let finalConfig = mergedConfig;
      let usedFallback = false;
      const isEdit = sourceImageArr.length > 0;
      const operation = isEdit ? 'edit' : 'generate';
      const scene = isEdit ? 'image_edit' : 'image_generate';
      const primarySupported = supportsImageOperation(mergedConfig.imageMode, operation);
      const fallbackCandidate = buildImageFallbackConfig(mergedConfig);
      const fallbackConfig = fallbackCandidate && supportsImageOperation(fallbackCandidate.imageMode, operation)
        ? fallbackCandidate
        : null;
      const circuitConfig = buildVirtualApiCircuitConfig(mergedConfig, fallbackConfig, 'image');
      const preferFallback = shouldPreferFallbackApi(circuitConfig, scene);
      const runOperation = targetConfig => isEdit
        ? this.editImage(prompt, sourceImageArr, targetConfig)
        : this.generateImage(prompt, targetConfig);
      let result = null;

      if (!primarySupported) {
        if (!fallbackConfig) {
          result = {
            success: false,
            error: `当前图像模式 ${mergedConfig.imageMode || 'unknown'} 不支持改图，且没有可用的改图备用接口`,
          };
        } else {
          usedFallback = true;
          finalConfig = fallbackConfig;
          result = await runOperation(fallbackConfig);
          if (result?.success && result.imageUrl) {
            recordFallbackApiSuccess(circuitConfig, scene);
          } else {
            recordFallbackApiFailure(circuitConfig, scene, result?.error || result?.response || '备用图像接口未返回图片地址');
          }
        }
      } else if (preferFallback.preferFallback && fallbackConfig) {
        usedFallback = true;
        finalConfig = fallbackConfig;
        result = await runOperation(fallbackConfig);
        if (result?.success && result.imageUrl) {
          recordFallbackApiSuccess(circuitConfig, scene);
        } else {
          recordFallbackApiFailure(circuitConfig, scene, result?.error || result?.response || '备用图像接口未返回图片地址');
        }
      } else {
        result = await runOperation(mergedConfig);

        if (result?.success && result.imageUrl) {
          recordPrimaryApiSuccess(circuitConfig, scene);
        } else {
          recordPrimaryApiFailure(circuitConfig, scene, result?.error || result?.response || '图像接口未返回图片地址');
        }

        if ((!result?.success || !result.imageUrl) && fallbackConfig) {
          logger.warn(`[crystelf-ai] 图像主接口失败，尝试备用API: ${result?.error || result?.response || '未返回图片地址'}`);
          const fallbackResult = await runOperation(fallbackConfig);
          if (fallbackResult?.success && fallbackResult.imageUrl) {
            result = fallbackResult;
            finalConfig = fallbackConfig;
            usedFallback = true;
            recordFallbackApiSuccess(circuitConfig, scene);
          } else if (!result?.success) {
            recordFallbackApiFailure(circuitConfig, scene, fallbackResult?.error || fallbackResult?.response || '备用图像接口未返回图片地址');
            result = {
              ...result,
              fallbackError: fallbackResult?.error || fallbackResult?.response || '备用图像接口未返回图片地址',
            };
          }
        }
      }

      await logImageUsage({
        stage: result?.success ? 'success' : 'error',
        mode: `${usedFallback ? 'fallback:' : ''}${sourceImageArr.length > 0 ? `edit:${finalConfig.imageMode || 'openai'}` : `generate:${finalConfig.imageMode || 'openai'}`}`,
        model: result?.model || finalConfig.model,
        prompt,
        elapsedMs: Date.now() - startedAt,
        sourceCount: Array.isArray(sourceImageArr) ? sourceImageArr.length : 0,
        hasImage: Boolean(result?.imageUrl),
        error: result?.success ? '' : ([result?.error || result?.response, result?.fallbackError].filter(Boolean).join('；') || '图像接口未返回图片地址'),
      });

      return result;
    } catch (error) {
      logger.error(`[crystelf-ai] 图像处理失败: ${error.message}`);
      await logImageUsage({
        stage: 'error',
        mode: Array.isArray(sourceImageArr) && sourceImageArr.length > 0 ? 'edit' : 'generate',
        prompt,
        elapsedMs: Date.now() - startedAt,
        sourceCount: Array.isArray(sourceImageArr) ? sourceImageArr.length : 0,
        error: error.message,
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 生成图像 - 根据imageMode选择不同的调用方式
   * @param {string} prompt - 图像描述
   * @param {Object} config - 配置对象
   * @returns {Promise<Object>} 生成结果
   */
  async generateImage(prompt, config) {
    try {
      if (config.imageMode === 'jimeng') {
        return await this.generateImageByJimeng(prompt, config);
      } else if (isSdWebUiImageMode(config.imageMode)) {
        return await this.generateOrEditImageBySdWebUi(prompt, [], config);
      } else if (isArkAgentPlanImageMode(config.imageMode)) {
        return await this.generateImageByArkAgentPlan(prompt, config);
      } else if (config.imageMode === 'chat') {
        return await this.generateImageByChat(prompt, config);
      } else {
        return await this.generateImageByOpenAI(prompt, config);
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 图像生成失败: ${error.message}`);
      return {
        success: false,
        error: `图像生成失败: ${error.message}`
      };
    }
  }

  /**
   * 使用OpenAI标准接口生成图像
   * @param {string} prompt - 图像描述
   * @param {Object} config - 配置对象
   * @returns {Promise<Object>} 生成结果
   */
  async generateImageByOpenAI(prompt, config) {
    try {
      logger.info(`[crystelf-ai] 使用OpenAI接口生成图像，${summarizePromptForLog(prompt)}`);

      const model = config.model || 'gpt-image-2';
      const requestBody = {
        prompt: prompt,
        model,
        n: config.n || 1,
        response_format: config.responseFormat || 'b64_json',
      };
      const imageSize = normalizeImageSizeValue(config.size || '1024x1024');
      if (imageSize) requestBody.size = imageSize;
      if (config.quality) requestBody.quality = config.quality;
      if (config.background) requestBody.background = config.background;
      if (config.style && shouldSendImageStyle(model)) requestBody.style = config.style;

      const response = await withRetry(
        () => axios.post(
          buildOpenAiApiUrl(config.baseApi, '/v1/images/generations'),
          requestBody,
          {
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
              ...buildAiUserAgentHeaders(config),
            },
            timeout: config.timeout || 60000
          }
        ),
        {
          retries: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
          onRetry: (info) => logger.warn(`[crystelf-ai] 图像生成重试 ${info.attempt}/${config.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
        },
      );

      if (response.data && response.data.data && response.data.data.length > 0) {
        const imageData = response.data.data[0];
        const imageUrl = resolveImageOutput(imageData);
        
        logger.info(`[crystelf-ai] OpenAI接口图像生成成功: ${imageUrl ? 'URL' : 'Base64数据'}`);
        return {
          success: true,
          imageUrl: imageUrl,
          revisedPrompt: imageData.revised_prompt,
          description: prompt,
          model,
          rawResponse: response.data
        };
      } else {
        logger.error(`[crystelf-ai] 无效的API响应格式: ${summarizeResponseForLog(response.data)}`);
        return {
          success: false,
          error: '无效的API响应格式'
        };
      }
    } catch (error) {
      logger.error(`[crystelf-ai] OpenAI接口图像生成失败: ${error.message}`);
      return {
        success: false,
        error: `OpenAI接口图像生成失败: ${error.message}`
      };
    }
  }

  /**
   * 使用火山方舟 Agent Plan 图像生成接口。
   */
  async generateImageByArkAgentPlan(prompt, config) {
    return this.generateOrEditImageByArkAgentPlan(prompt, [], config);
  }

  async generateOrEditImageByArkAgentPlan(prompt, sourceImageArr = [], config = {}) {
    try {
      const model = config.model || 'doubao-seedream-5.0-lite';
      const endpoint = buildArkAgentPlanImageUrl(config.baseApi);
      await this.validateArkAgentPlanReferenceImages(sourceImageArr);
      const referenceImages = await this.prepareArkAgentPlanReferenceImages(sourceImageArr);
      const requestBody = buildArkAgentPlanImageRequest(prompt, { ...config, model }, referenceImages);
      logger.info(`[crystelf-ai] 使用火山 Agent Plan 生成图像，${summarizePromptForLog(prompt)}，参考图数量: ${referenceImages.length}`);

      const response = await withRetry(
        () => axios.post(endpoint, requestBody, {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            ...buildAiUserAgentHeaders(config),
          },
          timeout: config.timeout || 60000,
        }),
        {
          retries: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
          onRetry: info => logger.warn(`[crystelf-ai] Agent Plan 生图重试 ${info.attempt}/${config.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
        },
      );

      if (Array.isArray(response.data?.data) && response.data.data.length > 0) {
        const imageData = response.data.data[0];
        const imageUrl = resolveImageOutput(imageData);
        if (imageUrl) {
          return {
            success: true,
            imageUrl,
            revisedPrompt: imageData.revised_prompt,
            description: prompt,
            model,
            rawResponse: response.data,
          };
        }
      }

      logger.error(`[crystelf-ai] Agent Plan 返回无效图像数据: ${summarizeResponseForLog(response.data)}`);
      return { success: false, error: 'Agent Plan 未返回可用图片' };
    } catch (error) {
      logger.error(`[crystelf-ai] Agent Plan 图像生成失败: ${error.message}`);
      return { success: false, error: `Agent Plan 图像生成失败: ${error.message}` };
    }
  }

  async prepareArkAgentPlanReferenceImages(sourceImageArr = []) {
    const sources = Array.isArray(sourceImageArr) ? sourceImageArr.filter(Boolean) : [];
    if (sources.length > 14) {
      throw new Error('Seedream 5.0 Lite 最多支持 14 张参考图');
    }
    return Promise.all(sources.map(async source => {
      const value = String(source || '').trim();
      if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) {
        return value;
      }
      const imageFile = await this.loadImageForUpload(value);
      return `data:${imageFile.mimeType || 'image/png'};base64,${imageFile.buffer.toString('base64')}`;
    }));
  }

  async validateArkAgentPlanReferenceImages(sourceImageArr = []) {
    const sources = Array.isArray(sourceImageArr) ? sourceImageArr.filter(Boolean) : [];
    if (sources.length === 0) return;

    const minimumPixels = 3686400;
    const results = await Promise.all(sources.map(async (source, index) => {
      try {
        const imageFile = await this.loadImageForUpload(source);
        const dimensions = getImageDimensions(imageFile.buffer);
        const pixels = getImagePixelCount(dimensions);
        if (pixels > 0 && pixels < minimumPixels) {
          return { index: index + 1, pixels, dimensions };
        }
      } catch {
        // 读取失败交给原有上传或上游接口处理，避免预检改变既有兼容性。
      }
      return null;
    }));

    const invalid = results.filter(Boolean);
    if (invalid.length > 0) {
      const detail = invalid.map(item => `${item.index} (${item.dimensions.width}x${item.dimensions.height})`).join('、');
      throw new Error(`参考图像素不足（第 ${detail} 张），火山 Agent Plan 图生图要求参考图至少达到 3686400 像素，请发送更大的原图`);
    }
  }

  async generateOrEditImageBySdWebUi(prompt, sourceImageArr = [], config = {}) {
    try {
      const settings = normalizeSdWebUiSettings(config);
      if (!settings.baseApi) {
        return { success: false, error: 'SD WebUI 地址不能为空' };
      }

      const sourceImage = Array.isArray(sourceImageArr) ? sourceImageArr.find(Boolean) : sourceImageArr;
      if (Array.isArray(sourceImageArr) && sourceImageArr.filter(Boolean).length > 1) {
        logger.warn('[crystelf-ai] SD WebUI 标准图生图仅使用第一张参考图，其余参考图已忽略');
      }
      let initImageBase64 = '';
      if (sourceImage) {
        const imageFile = await this.loadImageForUpload(sourceImage);
        initImageBase64 = imageFile.buffer.toString('base64');
      }

      const isEdit = Boolean(initImageBase64);
      const endpoint = buildSdWebUiApiUrl(
        settings.baseApi,
        isEdit ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img',
      );
      const requestBody = buildSdWebUiRequest(prompt, { ...config, sdWebUi: settings }, initImageBase64);
      logger.info(`[crystelf-ai] 使用 SD WebUI ${isEdit ? '图生图' : '文生图'}，${summarizePromptForLog(prompt)}，固定生成 1 张`);

      const response = await withRetry(
        () => axios.post(endpoint, requestBody, {
          headers: {
            'Content-Type': 'application/json',
            ...buildSdWebUiAuthHeaders(settings),
            ...buildAiUserAgentHeaders(config),
          },
          timeout: config.timeout || 60000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
        {
          retries: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
          onRetry: info => logger.warn(`[crystelf-ai] SD WebUI 生图重试 ${info.attempt}/${config.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
        },
      );

      const firstImage = Array.isArray(response.data?.images) ? response.data.images[0] : '';
      const imageUrl = encodeImageDataUrlFromBase64(firstImage, 'image/png');
      if (!imageUrl) {
        logger.error(`[crystelf-ai] SD WebUI 返回无效图像数据: ${summarizeResponseForLog(response.data)}`);
        return { success: false, error: 'SD WebUI 未返回可用图片' };
      }

      return {
        success: true,
        imageUrl,
        description: prompt,
        model: settings.model || 'SD WebUI 当前模型',
        rawResponse: {
          imageCount: Array.isArray(response.data?.images) ? response.data.images.length : 0,
          info: response.data?.info,
          parameters: response.data?.parameters,
        },
      };
    } catch (error) {
      logger.error(`[crystelf-ai] SD WebUI 图像生成失败: ${error.message}`);
      return { success: false, error: `SD WebUI 图像生成失败: ${error.message}` };
    }
  }

  /**
   * 使用对话式接口生成图像（如gemini-3-pro-image-preview）
   * @param {string} prompt - 图像描述
   * @param {Object} config - 配置对象
   * @returns {Promise<Object>} 生成结果
   */
  async generateImageByChat(prompt, config) {
    try {
      logger.info(`[crystelf-ai] 使用对话接口生成图像，${summarizePromptForLog(prompt)}`);
      const messages = [
        {
          role: 'system',
          content: [
            {type: 'text', text: '请你根据用户的描述生成高质量且准确的图像,条件允许的情况下,请先思考用户的意图再生成图像,请直接返回图像url,不要任何其他内容'}
          ]
        },
        {
          role: 'user',
          content: [
            {type: 'text', text: prompt}
          ]
        }
      ];
      const requestBody = {
        model: config.model || 'google/gemini-3-pro-image-preview',
        messages: messages,
        temperature: config.temperature || 0.7,
        modalities: config.modalities || ['text', 'image'],
      };

      const response = await withRetry(
        () => axios.post(
          buildOpenAiApiUrl(config.baseApi, '/v1/chat/completions'),
          requestBody,
          {
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
              ...buildAiUserAgentHeaders(config),
            },
            timeout: config.timeout || 60000
          }
        ),
        {
          retries: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
          onRetry: (info) => logger.warn(`[crystelf-ai] 图像生成重试 ${info.attempt}/${config.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
        },
      );

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        const choice = response.data.choices[0];
        if (choice.message && choice.message.images && choice.message.images.length > 0) {
          const imageData = choice.message.images[0];
          const imageUrl = imageData.image_url ? imageData.image_url.url : null;
          
          if (imageUrl) {
            logger.info(`[crystelf-ai] 对话接口图像生成成功: ${imageUrl.substring(0, 50)}...`);
            return {
              success: true,
              imageUrl: imageUrl,
              description: prompt,
              model: config.model || 'google/gemini-3-pro-image-preview',
              rawResponse: response.data
            };
          }
        }
        if (choice.message && choice.message.content) {
          const imageUrl = this.extractImageUrl(choice.message.content);
          if (imageUrl) {
            logger.info('[crystelf-ai] 已从响应内容中提取到图像URL');
            return {
              success: true,
              imageUrl: imageUrl,
              description: prompt,
              model: config.model || 'google/gemini-3-pro-image-preview',
              rawResponse: response.data
            };
          } else {
            logger.info(`[crystelf-ai] 收到文本响应摘要: ${summarizeTextForLog(choice.message.content)}`);
            return {
              success: true,
              response: choice.message.content,
              description: prompt,
              model: config.model || 'google/gemini-3-pro-image-preview',
              rawResponse: response.data
            };
          }
        }
      } else {
        logger.error(`[crystelf-ai] 无效的API响应格式: ${summarizeResponseForLog(response.data)}`);
        return {
          success: false,
          error: '无效的API响应格式'
        };
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 对话接口图像生成失败: ${error.message}`);
      return {
        success: false,
        error: `对话接口图像生成失败: ${error.message}`
      };
    }
  }

  async editImage(prompt, sourceImageArr, config){
    if(config.imageMode==='jimeng'){
      return await this.editImageByJimeng(prompt, sourceImageArr, config);
    } else if(isSdWebUiImageMode(config.imageMode)){
      return await this.generateOrEditImageBySdWebUi(prompt, sourceImageArr, config);
    } else if(isArkAgentPlanImageMode(config.imageMode)){
      return await this.generateOrEditImageByArkAgentPlan(prompt, sourceImageArr, config);
    } else if(config.imageMode==='openai'){
      return await this.editImageByOpenAI(prompt, sourceImageArr, config);
    } else if(config.imageMode==='chat'){
      return await this.editImageByChat(prompt, sourceImageArr, config);
    } else {
      return await this.editImageByChat(prompt, sourceImageArr, config);
    }
  }

  /**
   * 使用对话式接口编辑图像（如gemini-3-pro-image-preview）
   * @param {string} prompt - 编辑描述
   * @param {string} sourceImageArr - 源图像URL数组
   * @param {Object} config - 配置对象
   * @returns {Promise<Object>} 编辑结果
   */
  async editImageByChat(prompt, sourceImageArr, config) {
    try{
      logger.info(`[crystelf-ai] 开始编辑图像，${summarizePromptForLog(prompt)}，源图像数量: ${sourceImageArr.length}`);
      if(!sourceImageArr||sourceImageArr.length===0){
        return {
          success: false,
          error: '编辑图像需要提供源图像'
        };
      }
      let messages = [];
      messages.push({
        role: 'system',
        content: [
          {type: 'text', text: '请你根据用户的描述编辑图像,条件允许的情况下,请先思考用户的意图再编辑图像,请直接返回图像url,不要任何其他内容'}
        ]
      });
      let userContent = [];
      userContent.push({type: 'text', text: prompt});
      sourceImageArr.forEach((img) => {
        userContent.push({type: 'image_url', image_url: {url: img}});
      });
      messages.push({
        role: 'user',
        content: userContent
      });

      const requestBody = {
        model: config.model || 'google/gemini-3-pro-image-preview',
        messages: messages,
        temperature: config.temperature || 0.7,
        modalities: config.modalities || ['text', 'image'],
      };

      const response = await withRetry(
        () => axios.post(
          buildOpenAiApiUrl(config.baseApi, '/v1/chat/completions'),
          requestBody,
          {
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
              ...buildAiUserAgentHeaders(config),
            },
            timeout: config.timeout || 60000
          }
        ),
        {
          retries: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
          onRetry: (info) => logger.warn(`[crystelf-ai] 图像生成重试 ${info.attempt}/${config.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
        },
      );

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        const choice = response.data.choices[0];
        if (choice.message && choice.message.images && choice.message.images.length > 0) {
          const imageData = choice.message.images[0];
          const imageUrl = imageData.image_url ? imageData.image_url.url : null;

          if (imageUrl) {
            logger.info(`[crystelf-ai] 对话接口图像生成成功: ${imageUrl.substring(0, 50)}...`);
            return {
              success: true,
              imageUrl: imageUrl,
              description: prompt,
              model: config.model || 'google/gemini-3-pro-image-preview',
              rawResponse: response.data
            };
          }
        }
        if (choice.message && choice.message.content) {
          const imageUrl = this.extractImageUrl(choice.message.content);
          if (imageUrl) {
            logger.info('[crystelf-ai] 已从响应内容中提取到图像URL');
            return {
              success: true,
              imageUrl: imageUrl,
              description: prompt,
              model: config.model || 'google/gemini-3-pro-image-preview',
              rawResponse: response.data
            };
          } else {
            logger.info(`[crystelf-ai] 收到文本响应摘要: ${summarizeTextForLog(choice.message.content)}`);
            return {
              success: true,
              response: choice.message.content,
              description: prompt,
              model: config.model || 'google/gemini-3-pro-image-preview',
              rawResponse: response.data
            };
          }
        }
      }
    } catch (err){
      logger.error(`[crystelf-ai] 图像编辑失败: ${err.message}`);
      return {
        success: false,
        error: `图像编辑失败: ${err.message}`
      };
    }
  }

  /**
   * 编辑图像 - 使用OpenAI标准接口
   * @param {string} prompt - 编辑描述
   * @param {string} sourceImageArr - 源图像URL数组
   * @param {Object} config - 配置对象
   * @returns {Promise<Object>} 编辑结果
   */
  async editImageByOpenAI(prompt, sourceImageArr, config) {
    try {
      logger.info(`[crystelf-ai] 开始编辑图像，${summarizePromptForLog(prompt)}，源图像数量: ${sourceImageArr.length}`);
      
      if (!sourceImageArr || sourceImageArr.length === 0) {
        return {
          success: false,
          error: '编辑图像需要提供源图像'
        };
      }
      const form = new FormData();
      const model = config.model || 'gpt-image-2';
      form.append('prompt', prompt);
      form.append('model', model);
      form.append('response_format', config.responseFormat || 'b64_json');

      for (let index = 0; index < sourceImageArr.length; index++) {
        const sourceImage = sourceImageArr[index];
        const imageFile = await this.loadImageForUpload(sourceImage);
        form.append('image', imageFile.buffer, {
          filename: `image-${index + 1}.${imageExtensionForMime(imageFile.mimeType)}`,
          contentType: imageFile.mimeType || 'image/png',
        });
      }

      const response = await withRetry(
        () => axios.post(
          buildOpenAiApiUrl(config.baseApi, '/v1/images/edits'),
          form,
          {
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
              ...form.getHeaders(),
              ...buildAiUserAgentHeaders(config),
            },
            timeout: config.timeout || 60000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity
          }
        ),
        {
          retries: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
          onRetry: (info) => logger.warn(`[crystelf-ai] 图像生成重试 ${info.attempt}/${config.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
        },
      );

      if (response.data && response.data.data && response.data.data.length > 0) {
        const imageData = response.data.data[0];
        const imageUrl = resolveImageOutput(imageData);
        
        logger.info(`[crystelf-ai] 图像编辑成功: ${imageUrl ? 'URL' : 'Base64数据'}`);
        return {
          success: true,
          imageUrl: imageUrl,
          description: prompt,
          model,
          rawResponse: response.data
        };
      } else {
        logger.error(`[crystelf-ai] 无效的API响应格式: ${summarizeResponseForLog(response.data)}`);
        return {
          success: false,
          error: '无效的API响应格式'
        };
      }
    } catch (error) {
      logger.error(`[crystelf-ai] 图像编辑失败: ${error.message}`);
      return {
        success: false,
        error: `图像编辑失败: ${error.message}`
      };
    }
  }

  async generateImageByJimeng(prompt, config) {
    try {
      logger.info(`[crystelf-ai] 使用即梦接口生成图像，${summarizePromptForLog(prompt)}`);
      const response = await withRetry(
        () => axios.post(
          buildJimengApiUrl(config.jimengApiUrl, '/api/jimeng-yunzai.php'),
          {
            prompt,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
              ...buildAiUserAgentHeaders(config),
            },
            timeout: config.timeout || 60000,
          }
        ),
        {
          retries: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
          onRetry: (info) => logger.warn(`[crystelf-ai] 图像生成重试 ${info.attempt}/${config.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
        },
      );

      if (response.data?.success && response.data?.images?.length > 0) {
        return {
          success: true,
          imageUrl: response.data.images[0],
          description: prompt,
          model: config.model || 'jimeng',
          rawResponse: response.data,
        };
      }

      return {
        success: false,
        error: response.data?.error || response.data?.message || '即梦图片生成失败',
      };
    } catch (error) {
      logger.error(`[crystelf-ai] 即梦接口图像生成失败: ${error.message}`);
      return {
        success: false,
        error: `即梦接口图像生成失败: ${error.message}`,
      };
    }
  }

  async editImageByJimeng(prompt, sourceImageArr, config) {
    try {
      logger.info(`[crystelf-ai] 使用即梦接口改图，${summarizePromptForLog(prompt)}，源图数量: ${sourceImageArr.length}`);

      if (!sourceImageArr || sourceImageArr.length === 0) {
        return {
          success: false,
          error: '即梦改图需要提供源图像',
        };
      }

      const response = await withRetry(
        () => axios.post(
          buildJimengApiUrl(config.jimengApiUrl, '/api/jimeng-yunzai.php'),
          {
            prompt: prompt || '将这张图片风格转换一下，保持内容不变',
            image_url: sourceImageArr[0],
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
              ...buildAiUserAgentHeaders(config),
            },
            timeout: config.timeout || 60000,
          }
        ),
        {
          retries: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
          onRetry: (info) => logger.warn(`[crystelf-ai] 图像生成重试 ${info.attempt}/${config.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
        },
      );

      if (response.data?.success && response.data?.images?.length > 0) {
        return {
          success: true,
          imageUrl: response.data.images[0],
          description: prompt,
          model: config.model || 'jimeng',
          rawResponse: response.data,
        };
      }

      return {
        success: false,
        error: response.data?.error || response.data?.message || '即梦改图失败',
      };
    } catch (error) {
      logger.error(`[crystelf-ai] 即梦接口改图失败: ${error.message}`);
      return {
        success: false,
        error: `即梦接口改图失败: ${error.message}`,
      };
    }
  }

  /**
   * 从响应内容中提取图像URL
   * @param {string} content - 响应内容
   * @returns {string|null} 图像URL
   */
  extractImageUrl(content) {
    if (!content) return null;
    const urlPatterns = [
      /!\[.*?\]\((https?:\/\/[^\s]+)\)/i,
      /\[.*?\]\((https?:\/\/[^\s]+)\)/i,
      /(https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s"'<>)]*)?)/i,
      /(https?:\/\/[^\s"'<>)]*)/i,
    ];

    for (const pattern of urlPatterns) {
      const match = content.match(pattern);
      if (match) {
        return cleanupExtractedImageUrl(match[1] || match[0]);
      }
    }
    if (content.startsWith('http')) {
      return cleanupExtractedImageUrl(content);
    }

    return null;
  }

  async loadImageForUpload(sourceImage) {
    const source = String(sourceImage || '').trim();
    if (!source) {
      throw new Error('源图像为空');
    }

    const dataImage = decodeImageDataUrl(source);
    if (dataImage) {
      return dataImage;
    }

    if (/^https?:\/\//i.test(source)) {
      const imageResponse = await axios.get(source, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      return {
        buffer: Buffer.from(imageResponse.data),
        mimeType: String(imageResponse.headers?.['content-type'] || 'image/png').split(';')[0].trim() || 'image/png',
      };
    }

    return {
      buffer: Buffer.from(source, 'base64'),
      mimeType: 'image/png',
    };
  }

  /**
   * 合并图像配置
   * @param {Object} userConfig - 用户配置
   * @returns {Object} 合并后的配置
   */
  mergeImageConfig(userConfig) {
    const defaultImageConfig = {
      enabled: true,
      userAgent: '',
      imageMode: 'openai',
      model: 'gpt-image-2',
      baseApi: 'https://api.openai.com',
      jimengApiUrl: 'http://127.0.0.1:985',
      apiKey: '',
      maxTokens: 16384,
      temperature: 0.7,
      size: '1024x1024',
      responseFormat: 'b64_json',
      modalities: ['text', 'image'],
      timeout: 30000,
      fallbackReply: '图像生成失败，请稍后再试。',
      fallbackTimeoutReply: '图像生成超时。请稍后重试，或把要求说短一点。',
      quality: 'high',
      background: '',
      style: 'vivid',
      outputFormat: 'png',
      watermark: false,
      webSearch: false,
      sdWebUi: {
        baseApi: '',
        model: '',
        username: '',
        password: '',
        samplerName: 'DPM++ 2M',
        scheduler: 'Karras',
        steps: 20,
        cfgScale: 7,
        width: 1024,
        height: 1024,
        negativePrompt: '',
        seed: -1,
        denoisingStrength: 0.7,
      },
    };

    const mergedConfig = { ...defaultImageConfig };

    if (userConfig?.imageConfig) {
      Object.assign(mergedConfig, userConfig.imageConfig);
      if (!mergedConfig.userAgent && userConfig.userAgent) {
        mergedConfig.userAgent = userConfig.userAgent;
      }
    } else {
      const imageRelatedKeys = [
        'enabled', 'imageMode', 'model', 'baseApi', 'jimengApiUrl', 'apiKey', 'maxTokens', 'temperature',
        'size', 'responseFormat', 'modalities', 'timeout', 'fallbackReply', 'fallbackTimeoutReply', 'quality', 'background', 'style', 'outputFormat', 'watermark', 'webSearch', 'sdWebUi', 'userAgent'
      ];
    
      for (const key of imageRelatedKeys) {
        if (userConfig[key] !== undefined) {
          mergedConfig[key] = userConfig[key];
        }
      }
    }

    const imageMode = String(mergedConfig.imageMode || 'openai').trim();
    if (imageMode === 'jimeng') {
      mergedConfig.jimengApiUrl = String(mergedConfig.jimengApiUrl || '').trim();
      mergedConfig.apiKey = String(mergedConfig.apiKey || '').trim();
      mergedConfig.retryCount = Number(userConfig?.retryCount) > 0 ? Number(userConfig.retryCount) : 0;
      return mergedConfig;
    }

    if (isSdWebUiImageMode(imageMode)) {
      mergedConfig.sdWebUi = normalizeSdWebUiSettings(mergedConfig);
      mergedConfig.baseApi = mergedConfig.sdWebUi.baseApi;
      mergedConfig.model = mergedConfig.sdWebUi.model;
      mergedConfig.apiKey = '';
      mergedConfig.retryCount = Number(userConfig?.retryCount) > 0 ? Number(userConfig.retryCount) : 0;
      return mergedConfig;
    }

    mergedConfig.baseApi = normalizeOpenAiBaseApi(mergedConfig.baseApi || userConfig?.baseApi || '');
    mergedConfig.apiKey = String(mergedConfig.apiKey || userConfig?.apiKey || '').trim();
    mergedConfig.retryCount = Number(userConfig?.retryCount) > 0 ? Number(userConfig.retryCount) : 0;

    return mergedConfig;
  }

  /**
   * 验证图像配置
   * @param {Object} config - 配置对象
   * @returns {Object} 验证结果
   */
  validateImageConfig(config) {
    const errors = [];

    const imageMode = config.imageMode || 'openai';

    if (imageMode === 'jimeng') {
      if (!config.jimengApiUrl) {
        errors.push('即梦接口地址不能为空');
      }
    } else if (isSdWebUiImageMode(imageMode)) {
      const settings = normalizeSdWebUiSettings(config);
      if (!settings.baseApi) errors.push('SD WebUI 地址不能为空');
      if (!/^https?:\/\//i.test(settings.baseApi)) errors.push('SD WebUI 地址必须是 http(s) URL');
      if (settings.width % 8 !== 0 || settings.height % 8 !== 0) errors.push('SD WebUI 宽高必须是 8 的倍数');
      if (settings.steps < 1 || settings.steps > 150) errors.push('SD WebUI 采样步数必须在 1-150 之间');
      if (settings.cfgScale < 1 || settings.cfgScale > 30) errors.push('SD WebUI CFG 必须在 1-30 之间');
      if (settings.denoisingStrength < 0 || settings.denoisingStrength > 1) errors.push('SD WebUI 重绘强度必须在 0-1 之间');
    } else {
      if (!config.apiKey) {
        errors.push('API密钥不能为空');
      }

      if (!config.baseApi) {
        errors.push('API基础地址不能为空');
      }
    }

    if (imageMode !== 'jimeng' && !isSdWebUiImageMode(imageMode) && !config.model) {
      errors.push('模型名称不能为空');
    }

    const imageSize = normalizeImageSizeValue(config.size);
    if (imageSize && !isSdWebUiImageMode(imageMode)) {
      if (isArkAgentPlanImageMode(imageMode) && /^[234]K$/.test(imageSize)) {
        // Agent Plan supports named resolution presets.
      } else {
      const legacySizes = ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'];
      if (!legacySizes.includes(imageSize)) {
        const sizeMatch = imageSize.match(/^(\d+)x(\d+)$/);
        const width = sizeMatch ? Number(sizeMatch[1]) : 0;
        const height = sizeMatch ? Number(sizeMatch[2]) : 0;
        const pixels = width * height;
        if (!sizeMatch || width % 16 !== 0 || height % 16 !== 0 || Math.max(width, height) > 3840 || pixels < 655360 || pixels > 8294400) {
          errors.push('图像尺寸必须为 WIDTHxHEIGHT，宽高需为16的倍数，最长边不超过3840，总像素在655360到8294400之间；或使用 256x256、512x512、1024x1024、1792x1024、1024x1792');
        }
      }
      }
    }

    if (isArkAgentPlanImageMode(imageMode)) {
      const outputFormat = String(config.outputFormat || 'png').trim().toLowerCase();
      if (!['png', 'jpeg'].includes(outputFormat)) {
        errors.push('Agent Plan 输出格式必须是 png 或 jpeg');
      }
      const responseFormat = String(config.responseFormat || 'url').trim().toLowerCase();
      if (!['url', 'b64_json'].includes(responseFormat)) {
        errors.push('Agent Plan 响应格式必须是 url 或 b64_json');
      }
    }

    if (imageMode === 'openai') {
      const validQualities = ['low', 'medium', 'high', 'standard', 'hd'];
      if (config.quality && !validQualities.includes(config.quality)) {
        errors.push(`图像质量必须是以下之一: ${validQualities.join(', ')}`);
      }

      const validBackgrounds = ['', 'auto', 'opaque', 'transparent'];
      if (config.background !== undefined && !validBackgrounds.includes(String(config.background || '').trim())) {
        errors.push(`图像背景必须是以下之一: ${validBackgrounds.filter(Boolean).join(', ')}`);
      }

      const validStyles = ['vivid', 'natural'];
      if (config.style && !validStyles.includes(config.style)) {
        errors.push(`图像风格必须是以下之一: ${validStyles.join(', ')}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }
}

const imageProcessor = new ImageProcessor();

export { imageProcessor, ImageProcessor };
