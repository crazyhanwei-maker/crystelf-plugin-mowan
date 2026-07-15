import { buildSystemPrompt } from './promptBuilder.js';
import { getBuiltinTools } from './toolRegistry.js';

const EXPLICIT_URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/gi;

const USER_MESSAGE_FALLBACKS = Object.freeze({
  initial: '请处理系统消息中描述的当前用户请求。',
  tool_followup: '请根据以上工具执行结果继续处理当前请求。',
  fallback: '请根据以上上下文直接完成当前请求，不要再次调用工具。',
  final: '请根据以上上下文和工具结果直接完成当前请求。',
});

function resolveChatModel(config = {}) {
  return config?.modelType || config?.model || config?.workingModel || '';
}

function extractExplicitWebUrls(text = '') {
  const matches = String(text || '').match(EXPLICIT_URL_REGEX) || [];
  return [...new Set(matches.map(url => url.trim().replace(/[),.!?]+$/, '')))].filter(Boolean);
}

function normalizeMessageText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return text || fallback;
}

export function buildChatCompletionMessages({
  prompt,
  targetMessage,
  imageUrls = [],
  phase = 'initial',
} = {}) {
  const normalizedPhase = Object.hasOwn(USER_MESSAGE_FALLBACKS, phase) ? phase : 'initial';
  const systemContent = normalizeMessageText(prompt, '请根据当前上下文完成用户请求。');
  const userText = normalizedPhase === 'initial'
    ? normalizeMessageText(targetMessage?.content, USER_MESSAGE_FALLBACKS.initial)
    : USER_MESSAGE_FALLBACKS[normalizedPhase];
  const normalizedImages = normalizedPhase === 'initial' && Array.isArray(imageUrls)
    ? imageUrls.filter(Boolean)
    : [];

  const userContent = normalizedImages.length > 0
    ? [
        { type: 'text', text: userText },
        ...normalizedImages.map(url => ({ type: 'image_url', image_url: { url } })),
      ]
    : userText;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

export function shouldForceSearch(targetMessage, chatTools = []) {
  const text = String(targetMessage?.content || '').trim();
  if (!text) return false;
  if (extractExplicitWebUrls(text).length > 0) return false;
  if (shouldPreferStructuredSkill(targetMessage, chatTools)) return false;
  return /(什么时候|何时|最新|刚刚|今天|目前|现在|上线|上架|发布|公告|更新|版本|卡池|up|UP|官网|官宣|前瞻)/i.test(text);
}

export async function runChat(ai, toolCtx, history, targetMessage, promptCtx, humanize) {
  const allToolCalls = [];
  let toolResults = [];
  let lastToolReturnToAI = false;
  let lastTextContent = '';
  let finalAnswerFromToolRound = false;
  let hasDeliveredToolOnlyResult = false;
  const calledTools = new Set();
  let forceFinalAnswer = false;
  const builtinTools = getBuiltinTools();
  const skillToolsDisabled = toolCtx.disableSkillTools === true || toolCtx.config?.skillToolsEnabled === false;
  const sessionSkillTools = skillToolsDisabled
    ? []
    : Array.from(toolCtx.skillManager?.getTools(toolCtx.sessionId)?.values?.() || []);
  const toolsDisabled = toolCtx.config?.toolsEnabled === false || toolCtx.disableTools === true;
  const searchDisabled = toolsDisabled || toolCtx.disableSearchTools === true || toolCtx.config?.searchToolsEnabled === false;
  const voiceDisabled = toolCtx.disableVoiceTools === true || toolCtx.config?.voiceToolsEnabled === false;
  const availableTools = toolsDisabled
    ? []
    : mergeChatTools(builtinTools, sessionSkillTools).filter(tool => (
        (!searchDisabled || !['search_web', 'fetch_web_markdown'].includes(tool?.name))
        && (!voiceDisabled || !['list_tts_models', 'speak_text'].includes(tool?.name))
      ));
  const forceSearch = !searchDisabled && shouldForceSearch(targetMessage, availableTools);
  let lastFailureReason = '';
  let usedFallbackPrompt = false;
  let usedFinalToolPrompt = false;
  const explicitUrls = extractExplicitWebUrls(targetMessage?.content);
  const explicitPageUrl = explicitUrls[0] || '';

  logger.info(
    `[chat-engine] Session ${toolCtx.sessionId} | target: ${targetMessage.userName}(${targetMessage.userId}): "${targetMessage.content}"`
  );

  if (explicitPageUrl && !searchDisabled) {
    const fetchWebTool = builtinTools.find(tool => tool.name === 'fetch_web_markdown');
    if (fetchWebTool?.handler) {
      logger.info(
        `[chat-engine] Explicit URL detected, prefetching page markdown: ${explicitPageUrl}`
      );
      try {
        const result = await fetchWebTool.handler({ url: explicitPageUrl }, toolCtx);
        calledTools.add(fetchWebTool.name);
        allToolCalls.push({
          name: fetchWebTool.name,
          args: { url: explicitPageUrl },
          result,
        });
        toolResults = [
          {
            toolName: fetchWebTool.name,
            result,
          },
        ];
        if (result?.success === false) {
          lastFailureReason = result.error || 'fetch_web_markdown failed';
        }
      } catch (error) {
        const result = {
          success: false,
          error: error.message || 'fetch_web_markdown failed',
        };
        calledTools.add(fetchWebTool.name);
        lastFailureReason = result.error;
        toolResults = [
          {
            toolName: fetchWebTool.name,
            result,
          },
        ];
        allToolCalls.push({
          name: fetchWebTool.name,
          args: { url: explicitPageUrl },
          result,
        });
      }
    }
  }

  const maxIterations = toolCtx.config.maxIterations ?? 20;

  for (let iteration = 0; maxIterations === -1 || iteration < maxIterations; iteration++) {
    const prompt = buildSystemPrompt({
      ...promptCtx,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
      chatHistory: history,
      targetMessage,
      emojiAgent: humanize.emojiAgent,
      forceSearch,
        allowAiVoice: toolCtx.config?.tools?.tts?.allowAiTrigger,
    });

    logger.info(`[chat-engine] === Prompt (iter ${iteration}) ===`);
    logger.info(prompt);
    logger.info(`[chat-engine] === End Prompt ===`);

    const openaiTools = buildOpenAITools(availableTools);

    const pendingImages = toolCtx.pendingImageUrls;
    const hasImages = pendingImages && pendingImages.length > 0;

    const messages = buildChatCompletionMessages({
      prompt,
      targetMessage,
      imageUrls: iteration === 0 && hasImages ? pendingImages : [],
      phase: iteration === 0 ? 'initial' : 'tool_followup',
    });

    if (iteration === 0 && hasImages) {
      toolCtx.pendingImageUrls = [];
    }

    const resp = await ai.complete({
      model: resolveChatModel(toolCtx.config),
      messages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      temperature: toolCtx.config.temperature,
      scene: 'chat_engine',
      sessionId: toolCtx.sessionId,
      groupId: toolCtx.groupId,
      userId: toolCtx.userId,
    });

    if (resp.reasoning) {
      logger.info(`[chat-engine] AI reasoning (iter ${iteration}): ${resp.reasoning}`);
    }

    const hasToolCalls = Array.isArray(resp.toolCalls) && resp.toolCalls.length > 0;

    if (resp.error && !resp.content && !hasToolCalls) {
      lastFailureReason = resp.error;
      logger.warn(`[chat-engine] AI complete error (iter ${iteration}): ${resp.error}`);
    }

    if (resp.content) {
      logger.info(`[chat-engine] AI reply (iter ${iteration}): "${resp.content}"`);

      if (!hasToolCalls) {
        lastTextContent = resp.content;
        finalAnswerFromToolRound = false;
      }

      if (toolCtx.onTextContent && resp.content.trim() && !hasToolCalls) {
        const cleanedForCallback = lastTextContent
          .replace(/\[meme:[^\]]+\]/gi, '')
          .replace(/\n{3,}/g, '\n\n')
          .split('\n')
          .map(l => l.trim())
          .join('\n')
          .trim();

        const messages = parseMessages(cleanedForCallback);
        if (messages.length > 0) {
          if (!toolCtx.sentMessageIndices) {
            toolCtx.sentMessageIndices = new Set();
          }
          toolCtx.sentMessageIndices.add(0);

          const callbackResult = toolCtx.onTextContent(cleanedForCallback, 0, messages.length);
          if (callbackResult && typeof callbackResult.then === 'function') {
            callbackResult.catch(err =>
              logger.warn(`[chat-engine] onTextContent callback failed: ${err}`)
            );
          }
        }
      }
    }

    if (!hasToolCalls) {
      break;
    }

    const newToolResults = [];
    let hasReturnToAI = false;

    for (const tc of resp.toolCalls) {
      let args;
      try {
        args = JSON.parse(tc.arguments || '{}');
      } catch {
        args = {};
      }

      if (tc.name === 'end_session') {
        logger.info(`[chat-engine] Session ended: ${args.reason || 'no reason'}`);
        return {
          messages: [],
          pendingAt: [],
          pendingPoke: [],
          pendingQuote: undefined,
          toolCalls: allToolCalls,
          emojiPath: null,
          emojiMeta: null,
          forceSearch,
          usedFallbackPrompt,
          usedFinalToolPrompt,
        };
      }

      logger.info(`[chat-engine] Tool call: ${tc.name}(${JSON.stringify(args).substring(0, 100)})`);
      toolCtx.onToolStatus?.(`正在调用工具：${tc.name}`);

      if (calledTools.has(tc.name)) {
        const result = {
          success: false,
          error: `工具 ${tc.name} 在当前会话轮次中已调用过，禁止重复调用`,
        };
        lastFailureReason = result.error;
        logger.warn(`[chat-engine] Skip duplicate tool call: ${tc.name}`);
        allToolCalls.push({ name: tc.name, args, result });
        newToolResults.push({
          toolName: tc.name,
          result,
        });
        forceFinalAnswer = true;
        continue;
      }

      allToolCalls.push({ name: tc.name, args, result: { processed: true } });
      const matchedTool = availableTools.find(tool => tool.name === tc.name);
      if (matchedTool) {
        calledTools.add(tc.name);
        try {
          const result = await matchedTool.handler(args, toolCtx);
          const toolLabel = matchedTool.displayName || tc.name;
          toolCtx.onToolStatus?.(result?.success === false ? `工具 ${toolLabel} 调用失败` : `工具 ${toolLabel} 调用完成`);
          newToolResults.push({
            toolName: matchedTool.displayName || tc.name,
            result,
          });
          allToolCalls[allToolCalls.length - 1].result = result;
          if (!matchedTool.returnToAI && result?.success !== false) {
            hasDeliveredToolOnlyResult = true;
          }
          if (matchedTool.returnToAI && !(matchedTool.stopOnFailure && result?.success === false)) {
            hasReturnToAI = true;
          }
          if (matchedTool.stopOnFailure && result?.success === false) {
            lastFailureReason = result?.error || `工具 ${tc.name} 调用失败`;
            forceFinalAnswer = true;
          }
        } catch (error) {
          toolCtx.onToolStatus?.(`工具 ${matchedTool.displayName || tc.name} 调用异常`);
          const result = {
            success: false,
            error: error.message,
          };
          lastFailureReason = error.message || `工具 ${tc.name} 调用异常`;
          newToolResults.push({
            toolName: matchedTool.displayName || tc.name,
            result,
          });
          allToolCalls[allToolCalls.length - 1].result = result;
          if (!matchedTool.stopOnFailure) {
            hasReturnToAI = true;
          } else {
            forceFinalAnswer = true;
          }
        }
        continue;
      }
    }

    toolResults = newToolResults;
    lastToolReturnToAI = hasReturnToAI;

    if (forceFinalAnswer) {
      usedFallbackPrompt = true;
      const fallbackPrompt = buildSystemPrompt({
        ...promptCtx,
        toolResults: newToolResults,
        chatHistory: history,
        targetMessage,
        emojiAgent: humanize.emojiAgent,
      });
      logger.info(`[chat-engine] === Fallback Prompt ===`);
      logger.info(fallbackPrompt);
      logger.info(`[chat-engine] === End Fallback Prompt ===`);

      const fallbackResp = await ai.complete({
        model: resolveChatModel(toolCtx.config),
        messages: buildChatCompletionMessages({
          prompt: fallbackPrompt,
          targetMessage,
          phase: 'fallback',
        }),
        temperature: toolCtx.config.temperature,
        scene: 'chat_engine_fallback',
        sessionId: toolCtx.sessionId,
        groupId: toolCtx.groupId,
        userId: toolCtx.userId,
      });

      if (fallbackResp.content) {
        lastTextContent = fallbackResp.content;
        finalAnswerFromToolRound = true;
        logger.info(`[chat-engine] Fallback AI reply: "${fallbackResp.content}"`);
      } else if (fallbackResp.error) {
        lastFailureReason = fallbackResp.error;
      }
      break;
    }

    if (!hasReturnToAI) {
      break;
    }
  }

  if (toolResults.length > 0 && !finalAnswerFromToolRound && lastToolReturnToAI) {
    usedFinalToolPrompt = true;
    const finalPrompt = buildSystemPrompt({
      ...promptCtx,
      toolResults,
      chatHistory: history,
      targetMessage,
      emojiAgent: humanize.emojiAgent,
    });
    logger.info(`[chat-engine] === Final Tool Prompt ===`);
    logger.info(finalPrompt);
    logger.info(`[chat-engine] === End Final Tool Prompt ===`);

    const finalResp = await ai.complete({
      model: resolveChatModel(toolCtx.config),
      messages: buildChatCompletionMessages({
        prompt: finalPrompt,
        targetMessage,
        phase: 'final',
      }),
      temperature: toolCtx.config.temperature,
      scene: 'chat_engine_final',
      sessionId: toolCtx.sessionId,
      groupId: toolCtx.groupId,
      userId: toolCtx.userId,
    });

    if (finalResp.content) {
      lastTextContent = finalResp.content;
      finalAnswerFromToolRound = true;
      logger.info(`[chat-engine] Final AI reply from tool results: "${finalResp.content}"`);
    } else if (finalResp.error) {
      lastFailureReason = finalResp.error;
    }
  }

  if (!lastTextContent.trim() && hasDeliveredToolOnlyResult) {
    return {
      messages: [],
      voiceMessages: toolCtx.voiceMessages || [],
      pendingAt: [],
      pendingPoke: [],
      pendingQuote: undefined,
      toolCalls: allToolCalls,
      emojiPath: null,
      emojiMeta: null,
      failureReason: '',
      forceSearch,
      usedFallbackPrompt,
      usedFinalToolPrompt,
    };
  }

  const cleanedText = cleanMarkers(lastTextContent);
  const messages = parseMessages(cleanedText);

  let emojiPath = null;
  let emojiMeta = null;
  let finalText = cleanedText;
  if (cleanedText.trim()) {
    const memeResult = await humanize.emojiAgent.processMemeResponse(cleanedText, toolCtx.sessionId);
    if (memeResult.success && memeResult.emojiPath) {
      emojiPath = memeResult.emojiPath;
      emojiMeta = memeResult.emojiMeta || null;
      finalText = memeResult.cleanedText || cleanedText;
      logger.info(
        `[chat-engine] Meme selected: ${memeResult.emojiDescription}, cleaned text: "${finalText}"`
      );
    }
  }

  const finalMessages = parseMessages(finalText);

  logger.info(
    `[chat-engine] Session ${toolCtx.sessionId} done | ${finalMessages.length} msg(s), ${allToolCalls.length} tool call(s)`
  );

  return {
    messages: finalMessages,
    voiceMessages: toolCtx.voiceMessages || [],
    pendingAt: [],
    pendingPoke: [],
    pendingQuote: undefined,
    toolCalls: allToolCalls,
    emojiPath,
    emojiMeta,
    failureReason: lastFailureReason,
    forceSearch,
    usedFallbackPrompt,
    usedFinalToolPrompt,
  };
}

function cleanMarkers(text) {
  return text.trim();
}

function parseMessages(text) {
  if (!text.trim()) return [];

  if (/\n---\n/.test(text)) {
    return text
      .split(/\n---\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  return text
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function buildOpenAITools(chatTools) {
  const tools = [];

  tools.push({
    type: 'function',
    function: {
      name: 'end_session',
      description: 'End the current conversation session immediately. Use this when the conversation is complete or you want to stop responding.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Reason for ending the session (optional)',
          },
        },
      },
    },
  });

  for (const tool of chatTools) {
    tools.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    });
  }

  return tools;
}

function mergeChatTools(builtinTools = [], skillTools = []) {
  const merged = [];
  const seen = new Set();

  for (const tool of [...builtinTools, ...skillTools]) {
    if (!tool?.name || seen.has(tool.name)) {
      continue;
    }
    seen.add(tool.name);
    merged.push(tool);
  }

  return merged;
}

function hasChatTool(chatTools = [], displayName) {
  return Array.isArray(chatTools) && chatTools.some(tool => tool?.displayName === displayName);
}

function shouldPreferStructuredSkill(targetMessage, chatTools = []) {
  const text = String(targetMessage?.content || '').trim();
  if (!text) {
    return false;
  }

  if (
    hasChatTool(chatTools, 'weather.get_weather') &&
    /(天气|气温|温度|下雨|降雨|降水|湿度|风力|风向|天气预报|预报|体感|穿衣|紫外线|空气质量|分钟级降水)/i.test(text)
  ) {
    return true;
  }

  if (
    hasChatTool(chatTools, 'tracking.get_tracking') &&
    /(快递|物流|单号|运单|包裹|查询快递|查物流|tracking)/i.test(text)
  ) {
    return true;
  }

  if (
    hasChatTool(chatTools, 'tracking.detect_carrier') &&
    /(什么快递|哪家快递|识别快递|快递公司|物流公司)/i.test(text)
  ) {
    return true;
  }

  if (
    hasChatTool(chatTools, 'hotboard.get_hotboard') &&
    /(热搜|热榜|热度榜|榜单|热门榜|趋势榜|平台热榜|微博热搜|知乎热榜|B站热榜|抖音热榜|天气预警|地震速报|历史上的今天)/i.test(text)
  ) {
    return true;
  }

  if (
    hasChatTool(chatTools, 'calendar.get_holiday_calendar') &&
    /(节假日|放假吗|放假安排|调休|工作日|休息日|万年历|黄历|节气)/i.test(text)
  ) {
    return true;
  }

  if (
    hasChatTool(chatTools, 'calendar.get_lunartime') &&
    /(农历|阴历|干支|生肖|今天几号|今天是几月几日|今天星期几|周几)/i.test(text)
  ) {
    return true;
  }

  if (
    hasChatTool(chatTools, 'webparse.get_metadata') &&
    /\bhttps?:\/\/[^\s<>"']+/i.test(text) &&
    /(标题|简介|描述|链接预览|元数据|网站信息|favicon|图标|canonical)/i.test(text)
  ) {
    return true;
  }

  if (
    hasChatTool(chatTools, 'webparse.extract_images') &&
    /\bhttps?:\/\/[^\s<>"']+/i.test(text) &&
    /(图片|图链|提取图片|网页图片|页面图片|封面图)/i.test(text)
  ) {
    return true;
  }

  return false;
}
