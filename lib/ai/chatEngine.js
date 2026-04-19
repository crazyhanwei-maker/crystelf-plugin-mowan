import { buildSystemPrompt } from './promptBuilder.js';
import { getBuiltinTools } from './toolRegistry.js';

export function shouldForceSearch(targetMessage) {
  const text = String(targetMessage?.content || '').trim();
  if (!text) return false;

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
  const forceSearch = shouldForceSearch(targetMessage);
  let lastFailureReason = '';
  let usedFallbackPrompt = false;
  let usedFinalToolPrompt = false;

  logger.info(
    `[chat-engine] Session ${toolCtx.sessionId} | target: ${targetMessage.userName}(${targetMessage.userId}): "${targetMessage.content}"`
  );

  const maxIterations = toolCtx.config.maxIterations ?? 20;

  for (let iteration = 0; maxIterations === -1 || iteration < maxIterations; iteration++) {
    const prompt = buildSystemPrompt({
      ...promptCtx,
      toolResults: iteration > 0 ? toolResults : undefined,
      chatHistory: history,
      targetMessage,
      emojiAgent: humanize.emojiAgent,
      forceSearch,
        allowAiVoice: toolCtx.config?.tools?.tts?.allowAiTrigger,
    });

    logger.info(`[chat-engine] === Prompt (iter ${iteration}) ===`);
    logger.info(prompt);
    logger.info(`[chat-engine] === End Prompt ===`);

    const builtinTools = getBuiltinTools();
    const openaiTools = buildOpenAITools(builtinTools);

    const pendingImages = toolCtx.pendingImageUrls;
    const hasImages = pendingImages && pendingImages.length > 0;

    let messages = [{ role: 'system', content: prompt }];

    if (iteration === 0 && hasImages) {
      const userContent = [{ type: 'text', text: targetMessage.content }];
      for (const url of pendingImages) {
        userContent.push({ type: 'image_url', image_url: { url } });
      }
      messages.push({ role: 'user', content: userContent });
      toolCtx.pendingImageUrls = [];
    }

    const resp = await ai.complete({
      model: toolCtx.config.workingModel || toolCtx.config.modelType || toolCtx.config.model,
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
      const matchedTool = builtinTools.find(tool => tool.name === tc.name);
      if (matchedTool) {
        calledTools.add(tc.name);
        try {
          const result = await matchedTool.handler(args, toolCtx);
          toolCtx.onToolStatus?.(result?.success === false ? `工具 ${tc.name} 调用失败` : `工具 ${tc.name} 调用完成`);
          newToolResults.push({
            toolName: tc.name,
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
          toolCtx.onToolStatus?.(`工具 ${tc.name} 调用异常`);
          const result = {
            success: false,
            error: error.message,
          };
          lastFailureReason = error.message || `工具 ${tc.name} 调用异常`;
          newToolResults.push({
            toolName: tc.name,
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
        model: toolCtx.config.workingModel || toolCtx.config.modelType || toolCtx.config.model,
        messages: [{ role: 'system', content: fallbackPrompt }],
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
      model: toolCtx.config.workingModel || toolCtx.config.modelType || toolCtx.config.model,
      messages: [{ role: 'system', content: finalPrompt }],
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
