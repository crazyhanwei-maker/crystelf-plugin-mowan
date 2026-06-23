import axios from 'axios';
import FormData from 'form-data';
import { logImageUsage } from './imageUsageLogger.js';
import { buildImageFallbackConfig } from './apiFallback.js';
import { withRetry } from './retry.js';

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

function normalizeImageSize(value = '') {
  const size = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!size || size === 'auto') return '';
  return size;
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
      let result = sourceImageArr.length > 0
        ? await this.editImage(prompt, sourceImageArr, mergedConfig)
        : await this.generateImage(prompt, mergedConfig);

      if (!result?.success || !result.imageUrl) {
        const fallbackConfig = buildImageFallbackConfig(mergedConfig);
        if (fallbackConfig) {
          logger.warn(`[crystelf-ai] 图像主接口失败，尝试备用API: ${result?.error || result?.response || '未返回图片地址'}`);
          const fallbackResult = sourceImageArr.length > 0
            ? await this.editImage(prompt, sourceImageArr, fallbackConfig)
            : await this.generateImage(prompt, fallbackConfig);
          if (fallbackResult?.success && fallbackResult.imageUrl) {
            result = fallbackResult;
            finalConfig = fallbackConfig;
            usedFallback = true;
          } else if (!result?.success) {
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
      logger.info(`[crystelf-ai] 使用OpenAI接口生成图像: ${prompt}`);

      const model = config.model || 'gpt-image-2';
      const requestBody = {
        prompt: prompt,
        model,
        n: config.n || 1,
        response_format: config.responseFormat || 'b64_json',
      };
      const imageSize = normalizeImageSize(config.size || '1024x1024');
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
              'Content-Type': 'application/json'
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
        logger.error(`[crystelf-ai] 无效的API响应格式: ${JSON.stringify(response.data)}`);
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
   * 使用对话式接口生成图像（如gemini-3-pro-image-preview）
   * @param {string} prompt - 图像描述
   * @param {Object} config - 配置对象
   * @returns {Promise<Object>} 生成结果
   */
  async generateImageByChat(prompt, config) {
    try {
      logger.info(`[crystelf-ai] 使用对话接口生成图像: ${prompt}`);
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
              'Content-Type': 'application/json'
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
            logger.info(`[crystelf-ai] 从响应内容中提取到图像URL: ${imageUrl}`);
            return {
              success: true,
              imageUrl: imageUrl,
              description: prompt,
              model: config.model || 'google/gemini-3-pro-image-preview',
              rawResponse: response.data
            };
          } else {
            logger.info(`[crystelf-ai] 收到文本响应: ${choice.message.content}`);
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
        logger.error(`[crystelf-ai] 无效的API响应格式: ${JSON.stringify(response.data)}`);
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
      logger.info(`[crystelf-ai] 开始编辑图像: ${prompt}, 源图像数量: ${sourceImageArr.length}`);
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
              'Content-Type': 'application/json'
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
            logger.info(`[crystelf-ai] 从响应内容中提取到图像URL: ${imageUrl}`);
            return {
              success: true,
              imageUrl: imageUrl,
              description: prompt,
              model: config.model || 'google/gemini-3-pro-image-preview',
              rawResponse: response.data
            };
          } else {
            logger.info(`[crystelf-ai] 收到文本响应: ${choice.message.content}`);
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
      logger.info(`[crystelf-ai] 开始编辑图像: ${prompt}, 源图像数量: ${sourceImageArr.length}`);
      
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
              ...form.getHeaders()
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
        logger.error(`[crystelf-ai] 无效的API响应格式: ${JSON.stringify(response.data)}`);
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
      logger.info(`[crystelf-ai] 使用即梦接口生成图像: ${prompt}`);
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
      logger.info(`[crystelf-ai] 使用即梦接口改图: ${prompt}, 源图数量: ${sourceImageArr.length}`);

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
      imageMode: 'openai',
      model: 'gpt-image-2',
      baseApi: 'https://api.openai.com',
      jimengApiUrl: 'http://127.0.0.1:985',
      apiKey: '',
      maxTokens: 4000,
      temperature: 0.7,
      size: '1024x1024',
      responseFormat: 'b64_json',
      modalities: ['text', 'image'],
      timeout: 30000,
      fallbackReply: '图像生成失败，请稍后再试。',
      fallbackTimeoutReply: '图像生成超时。请稍后重试，或把要求说短一点。',
      quality: 'high',
      background: '',
      style: 'vivid'
    };

    const mergedConfig = { ...defaultImageConfig };

    if (userConfig?.imageConfig) {
      Object.assign(mergedConfig, userConfig.imageConfig);
    } else {
      const imageRelatedKeys = [
        'enabled', 'imageMode', 'model', 'baseApi', 'jimengApiUrl', 'apiKey', 'maxTokens', 'temperature',
        'size', 'responseFormat', 'modalities', 'timeout', 'fallbackReply', 'fallbackTimeoutReply', 'quality', 'background', 'style'
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
    } else {
      if (!config.apiKey) {
        errors.push('API密钥不能为空');
      }

      if (!config.baseApi) {
        errors.push('API基础地址不能为空');
      }
    }

    if (!config.model) {
      errors.push('模型名称不能为空');
    }

    const imageSize = normalizeImageSize(config.size);
    if (imageSize) {
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

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }
}

const imageProcessor = new ImageProcessor();

export { imageProcessor, ImageProcessor };
