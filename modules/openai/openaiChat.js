import OpenAI from 'openai';
import { logAiUsage } from '../../lib/ai/usageLogger.js';
import { withRetry } from '../../lib/ai/retry.js';
import { buildAiUserAgentHeaders, resolveAiUserAgent } from '../../lib/ai/userAgent.js';
import {
  buildAnthropicRequest,
  buildOpenAiCompletionFromAnthropic,
  fetchAnthropicMessages,
  providerLabelForProtocol,
  resolveAiProtocol,
} from './protocolAdapter.js';
import { lookupModelOutputLimit } from '../../lib/ai/modelCatalog.js';

const ALLOWED_MESSAGE_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

// 思考型模型可能把输出额度全部花在 thinking block 上（stop=max_tokens 且无 text block），
// 此时加倍 max_tokens 重试一次（上限 32768），正文就能拿到空间
async function fetchAnthropicWithBudgetBoost(request) {
  const parsed = await fetchAnthropicMessages(request);
  if (String(parsed?.text || '').trim() || parsed?.stopReason !== 'max_tokens') {
    return parsed;
  }
  const boosted = {
    ...request,
    body: { ...request.body, max_tokens: Math.max(Number(request.body?.max_tokens) || 0, Math.min((Number(request.body?.max_tokens) || 8192) * 2, lookupModelOutputLimit(request.body.model) || 32768)) },
  };
  logger.warn(`[crystelf-ai][anthropic] 思考占满输出额度（blocks=${(parsed.blockTypes || []).join(',')}），max_tokens 提升到 ${boosted.body.max_tokens} 重试一次`);
  return fetchAnthropicMessages(boosted);
}

/**
 * 把消息数组的 role 限制在 OpenAI 兼容端点公认的白名单内，
 * 避免上游/中转写入的 'developer' 等非法 role 触发 400。
 */
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(msg => msg && typeof msg === 'object')
    .map(msg => {
      let role = String(msg.role || '').trim().toLowerCase();
      if (role === 'developer') role = 'system';
      if (!ALLOWED_MESSAGE_ROLES.has(role)) role = 'user';
      return { ...msg, role };
    });
}

function normalizeAiErrorMessage(error, timeoutMs = 60000) {
  const name = String(error?.name || '').trim();
  const code = String(error?.code || '').trim();
  const message = String(error?.message || error || '').trim();
  const combined = `${name} ${code} ${message}`;

  if (/超时|timeout|timed out|time out|abort/i.test(combined) || code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return `AI请求超时（${timeoutMs}ms）`;
  }

  return message || 'AI调用失败';
}

class OpenaiChat {
  constructor() {
    this.openai = null;
    this.timeout = 60000;
    this.retryCount = 0;
    this.userAgent = '';
    // 接入协议：openai（含 grok，xAI 为 OpenAI 兼容格式）| anthropic
    this.protocol = 'openai';
  }

  /**
   * @param apiKey 密钥
   * @param baseUrl openaiAPI地址
   * @param timeout 超时时间(毫秒)
   * @param retryCount 接口失败重试次数，0 表示不重试
   * @param options 完整 ai 配置，其中 apiProtocol 决定接入协议（openai/anthropic/grok）
   */
  init(apiKey, baseUrl, timeout = 60000, retryCount = 0, options = {}) {
    this.timeout = Number(timeout) > 0 ? Number(timeout) : 60000;
    this.retryCount = Number(retryCount) > 0 ? Number(retryCount) : 0;
    this.userAgent = resolveAiUserAgent(options);
    this.protocol = resolveAiProtocol(options);
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.maxTokens = Number(options?.maxTokens) > 0 ? Number(options.maxTokens) : 0;
    this.openai = new OpenAI({
      apiKey: apiKey,
      baseURL: baseUrl,
      timeout: this.timeout,
      defaultHeaders: buildAiUserAgentHeaders(options),
    });
  }

  /**
   * @param prompt 用户说的话
   * @param chatHistory 聊天历史记录
   * @param model 模型
   * @param temperature 温度
   * @param customPrompt 提示词
   * @param messages 多模态消息数组
   * @returns {Promise<{success: boolean, aiResponse: string}|{}>}
   */
  async callAi({ prompt, chatHistory = [], model, temperature, customPrompt, messages = [], usageContext = {} }) {
    if (!this.openai) {
      logger.error('[crystelf-ai] ai未初始化..');
      return { success: false };
    }
    if (this.protocol === 'anthropic') {
      return this.callAiAnthropic({ prompt, chatHistory, model, temperature, customPrompt, messages, usageContext });
    }
    let finalMessages;
    if (messages.length > 0) {
      finalMessages = messages;
    } else {
      let systemMessage = {
        role: 'system',
        content: customPrompt || '',
      };
      finalMessages = [
        systemMessage,
        ...chatHistory,
        {
          role: 'user',
          content: prompt,
        },
      ];
    }

    const startedAt = Date.now();

    try {
     // logger.info("[DEBUG] 请求体:", {
        //model: model,
       // messages: finalMessages,
      //});

      const completion = await withRetry(
        () => this.openai.chat.completions.create({
          messages: sanitizeMessages(finalMessages),
          model: model,
          temperature: temperature,
          frequency_penalty: 0.2,
          presence_penalty: 0.2,
          stream: false,
        }),
        {
          retries: this.retryCount,
          isFailureResult: (completion) => {
            const parsed = typeof completion === 'string' ? (() => {
              try { return JSON.parse(completion); } catch { return null; }
            })() : completion;
            return !String(parsed?.choices?.[0]?.message?.content || '').trim();
          },
          onRetry: (info) => logger.warn(`[crystelf-ai] AI请求重试 ${info.attempt}/${this.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error || '模型没有产出可发送内容'}`),
        },
      );
      let parsedCompletion = completion;
      if (typeof completion === 'string') {
        try {
          parsedCompletion = JSON.parse(completion);
        } catch (parseError) {
          logger.error('[crystelf-ai] 响应JSON解析失败:', parseError);
          return { success: false };
        }
      }
      
      //logger.info("[DEBUG] 解析后的响应:", JSON.stringify(parsedCompletion));
      let aiResponse = null;
      
      if (parsedCompletion && parsedCompletion.choices && Array.isArray(parsedCompletion.choices) && parsedCompletion.choices.length > 0) {
        const choice = parsedCompletion.choices[0];
        if (choice && choice.message && choice.message.content) {
          aiResponse = choice.message.content;
        }
      }
      
      if (!aiResponse) {
        logger.error('[crystelf-ai] 无法从响应中提取AI回复内容:', parsedCompletion);
        const errorMessage = '模型没有产出可发送内容';
        await logAiUsage({ provider: providerLabelForProtocol(this.protocol),
          stage: 'empty_response',
          scene: usageContext.scene || 'chat',
          model,
          sessionId: usageContext.sessionId,
          groupId: usageContext.groupId,
          userId: usageContext.userId,
          messageCount: finalMessages.length,
          elapsedMs: Date.now() - startedAt,
          promptPreview: typeof prompt === 'string' ? prompt : customPrompt,
          usage: parsedCompletion?.usage,
          responsePreview: '',
          error: errorMessage,
        });
        return { success: false, error: errorMessage };
      }
      
      logger.info("[DEBUG] AI响应内容:", aiResponse);
      await logAiUsage({ provider: providerLabelForProtocol(this.protocol),
        stage: 'success',
        scene: usageContext.scene || 'chat',
        model,
        sessionId: usageContext.sessionId,
        groupId: usageContext.groupId,
        userId: usageContext.userId,
        messageCount: finalMessages.length,
        elapsedMs: Date.now() - startedAt,
        promptPreview: typeof prompt === 'string' ? prompt : customPrompt,
        responsePreview: aiResponse,
        usage: parsedCompletion?.usage,
      });
      return {
        success: true,
        aiResponse: aiResponse,
        usage: parsedCompletion?.usage,
      };
    } catch (err) {
      const errorMessage = normalizeAiErrorMessage(err, this.timeout);
      logger.error(err);
      await logAiUsage({ provider: providerLabelForProtocol(this.protocol),
        stage: 'error',
        scene: usageContext.scene || 'chat',
        model,
        sessionId: usageContext.sessionId,
        groupId: usageContext.groupId,
        userId: usageContext.userId,
        messageCount: finalMessages?.length,
        elapsedMs: Date.now() - startedAt,
        promptPreview: typeof prompt === 'string' ? prompt : customPrompt,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  // 协议感知的单轮补全（aiCaller 的 direct/tool 补全路径用；重试由调用方的 withRetry 负责）
  // anthropic 时把 OpenAI 形态的请求/响应双向转换，调用方无感
  async createChatCompletion({ model, messages, tools, temperature, max_tokens }) {
    if (this.protocol !== 'anthropic') {
      return this.openai.chat.completions.create({
        model,
        messages,
        ...(tools ? { tools } : {}),
        temperature,
        ...(max_tokens ? { max_tokens } : {}),
        stream: false,
      });
    }
    const request = buildAnthropicRequest({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      model,
      temperature,
      messages,
      timeout: this.timeout,
      maxTokens: max_tokens || this.maxTokens,
      outputLimit: lookupModelOutputLimit(model),
      userAgentOptions: { userAgent: this.userAgent },
      tools,
    });
    const parsed = await fetchAnthropicWithBudgetBoost(request);
    logger.info(`[crystelf-ai][anthropic] 响应 blocks=[${(parsed?.blockTypes || []).join(',')}] stop=${parsed?.stopReason} out_tokens=${parsed?.usage?.completion_tokens ?? '?'}`);
    return buildOpenAiCompletionFromAnthropic(parsed, model);
  }

  // Anthropic Messages API 路径：与 callAi 同构（withRetry/日志/返回形态），仅 wire 格式不同
  async callAiAnthropic({ prompt, chatHistory = [], model, temperature, customPrompt, messages = [], usageContext = {} }) {
    let finalMessages;
    if (messages.length > 0) {
      finalMessages = messages;
    } else {
      finalMessages = [
        { role: 'system', content: customPrompt || '' },
        ...chatHistory,
        { role: 'user', content: prompt },
      ];
    }

    const startedAt = Date.now();
    let request;
    try {
      request = buildAnthropicRequest({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        model,
        temperature,
        messages: finalMessages,
        timeout: this.timeout,
        maxTokens: this.maxTokens,
        userAgentOptions: { userAgent: this.userAgent },
      });
    } catch (error) {
      logger.error(`[crystelf-ai] Anthropic 请求构造失败: ${error.message}`);
      return { success: false, error: error.message };
    }

    try {
      const parsed = await withRetry(
        () => fetchAnthropicWithBudgetBoost(request),
        {
          retries: this.retryCount,
          isFailureResult: (result) => !String(result?.text || '').trim(),
          onRetry: (info) => logger.warn(`[crystelf-ai] AI请求重试 ${info.attempt}/${this.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error || '模型没有产出可发送内容'}`),
        },
      );
      logger.info(`[crystelf-ai][anthropic] 响应 blocks=[${(parsed?.blockTypes || []).join(',')}] stop=${parsed?.stopReason} out_tokens=${parsed?.usage?.completion_tokens ?? '?'}`);

      const aiResponse = String(parsed?.text || '').trim();
      if (!aiResponse) {
        logger.error('[crystelf-ai] 无法从 Anthropic 响应中提取AI回复内容:', parsed);
        const errorMessage = '模型没有产出可发送内容';
        await logAiUsage({ provider: providerLabelForProtocol(this.protocol),
          stage: 'empty_response',
          scene: usageContext.scene || 'chat',
          model,
          sessionId: usageContext.sessionId,
          groupId: usageContext.groupId,
          userId: usageContext.userId,
          messageCount: finalMessages.length,
          elapsedMs: Date.now() - startedAt,
          promptPreview: typeof prompt === 'string' ? prompt : customPrompt,
          usage: parsed?.usage,
          responsePreview: '',
          error: errorMessage,
        });
        return { success: false, error: errorMessage };
      }

      await logAiUsage({ provider: providerLabelForProtocol(this.protocol),
        stage: 'success',
        scene: usageContext.scene || 'chat',
        model,
        sessionId: usageContext.sessionId,
        groupId: usageContext.groupId,
        userId: usageContext.userId,
        messageCount: finalMessages.length,
        elapsedMs: Date.now() - startedAt,
        promptPreview: typeof prompt === 'string' ? prompt : customPrompt,
        responsePreview: aiResponse,
        usage: parsed?.usage,
      });
      return {
        success: true,
        aiResponse: aiResponse,
        usage: parsed?.usage,
      };
    } catch (err) {
      const errorMessage = normalizeAiErrorMessage(err, this.timeout);
      logger.error(err);
      await logAiUsage({ provider: providerLabelForProtocol(this.protocol),
        stage: 'error',
        scene: usageContext.scene || 'chat',
        model,
        sessionId: usageContext.sessionId,
        groupId: usageContext.groupId,
        userId: usageContext.userId,
        messageCount: finalMessages?.length,
        elapsedMs: Date.now() - startedAt,
        promptPreview: typeof prompt === 'string' ? prompt : customPrompt,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }
}

export default OpenaiChat;
