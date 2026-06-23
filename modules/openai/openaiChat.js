import OpenAI from 'openai';
import { logAiUsage } from '../../lib/ai/usageLogger.js';
import { withRetry } from '../../lib/ai/retry.js';

const ALLOWED_MESSAGE_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

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
  }

  /**
   * @param apiKey 密钥
   * @param baseUrl openaiAPI地址
   * @param timeout 超时时间(毫秒)
   * @param retryCount 接口失败重试次数，0 表示不重试
   */
  init(apiKey, baseUrl, timeout = 60000, retryCount = 0) {
    this.timeout = Number(timeout) > 0 ? Number(timeout) : 60000;
    this.retryCount = Number(retryCount) > 0 ? Number(retryCount) : 0;
    this.openai = new OpenAI({
      apiKey: apiKey,
      baseURL: baseUrl,
      timeout: this.timeout,
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
          onRetry: (info) => logger.warn(`[crystelf-ai] AI请求重试 ${info.attempt}/${this.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
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
        await logAiUsage({
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
      await logAiUsage({
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
      await logAiUsage({
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
