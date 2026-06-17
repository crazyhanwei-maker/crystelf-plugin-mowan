export function createSandboxConsole(options = {}) {
  const UserConfigManager = options.UserConfigManager || options.userConfigManager || { getUserConfig: async () => null };
  const ConfigControl = options.ConfigControl || options.configControl || { get: () => ({}) };
  const fetchWebMarkdown = typeof options.fetchWebMarkdown === 'function'
    ? options.fetchWebMarkdown
    : (async () => ({ success: false, error: 'fetchWebMarkdown is unavailable.' }));
  const searchWeb = typeof options.searchWeb === 'function'
    ? options.searchWeb
    : (async () => ({ success: false, error: 'searchWeb is unavailable.' }));
  const runChat = typeof options.runChat === 'function'
    ? options.runChat
    : (async () => ({ messages: [] }));
  const EmojiAgent = typeof options.EmojiAgent === 'function'
    ? options.EmojiAgent
    : class EmojiAgentFallback {};
  const SkillSessionManager = typeof options.SkillSessionManager === 'function'
    ? options.SkillSessionManager
    : class SkillSessionManagerFallback {
        getActiveSkillsInfo() { return ''; }
      };
  const loadAutoSessionSkills = typeof options.loadAutoSessionSkills === 'function'
    ? options.loadAutoSessionSkills
    : (async () => {});
  const logger = options.logger || { info: () => {}, warn: () => {}, error: () => {} };
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode = 500, message = 'Internal Server Error', code = '') => {
        const error = new Error(String(message || 'Internal Server Error'));
        error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
        if (code) error.code = String(code);
        return error;
      });
  const maskDisplayUrlSecrets = typeof options.maskDisplayUrlSecrets === 'function'
    ? options.maskDisplayUrlSecrets
    : (value => String(value || '').trim());
  const buildOpenAiCompatibleUrl = typeof options.buildOpenAiCompatibleUrl === 'function'
    ? options.buildOpenAiCompatibleUrl
    : ((baseApi = '', pathSuffix = '') => String(baseApi || '').replace(/\/+$/, '') + '/' + String(pathSuffix || '').replace(/^\/+/, ''));
  const fetch = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch?.bind(globalThis);
  const SANDBOX_CHAT_MAX_IMAGES = Math.max(1, Number(options.maxImages || 6) || 6);
  const SANDBOX_CHAT_IMAGE_DATA_MAX_BYTES = Math.max(1, Number(options.imageDataMaxBytes || 2 * 1024 * 1024) || (2 * 1024 * 1024));

  function sanitizeSandboxHistory(history = []) {
    if (!Array.isArray(history)) return [];
    return history
      .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
      .map(item => ({
        role: item.role,
        content: String(item.content || '').slice(0, 4000),
      }))
      .filter(item => item.content.trim())
      .slice(-20);
  }
  
  function estimateDataUrlBytes(value = '') {
    const text = String(value || '');
    const commaIndex = text.indexOf(',');
    if (!/^data:/i.test(text) || commaIndex < 0) {
      return Buffer.byteLength(text, 'utf8');
    }
    const meta = text.slice(5, commaIndex).toLowerCase();
    const data = text.slice(commaIndex + 1).replace(/\s/g, '');
    if (meta.includes(';base64')) {
      const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
      return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
    }
    try {
      return Buffer.byteLength(decodeURIComponent(data), 'utf8');
    } catch {
      return Buffer.byteLength(data, 'utf8');
    }
  }
  
  function getDataUrlMediaType(value = '') {
    const match = String(value || '').match(/^data:([^;,]+)[;,]/i);
    return match ? match[1].toLowerCase() : '';
  }
  
  function normalizeDataUrlAttachment(value = '', options = {}) {
    const text = String(value || '').trim();
    const {
      label = '附件',
      allowedPattern = /^image\//i,
      maxBytes = SANDBOX_CHAT_IMAGE_DATA_MAX_BYTES,
      code = 'ATTACHMENT_INVALID',
    } = options;
    if (!/^data:/i.test(text)) {
      return text;
    }
    const mediaType = getDataUrlMediaType(text);
    if (!allowedPattern.test(mediaType)) {
      throw createHttpError(400, `${label}类型不支持：${mediaType || 'unknown'}`, code);
    }
    const estimatedBytes = estimateDataUrlBytes(text);
    if (estimatedBytes > maxBytes) {
      throw createHttpError(400, `${label}过大，最大允许 ${Math.round(maxBytes / 1024 / 1024)}MB`, code);
    }
    return text;
  }
  
  function normalizeSandboxImageUrls(value = []) {
    const source = Array.isArray(value) ? value : [value];
    const normalized = [];
    const seen = new Set();
    for (const item of source) {
      const text = String(item || '').trim();
      if (!text) continue;
      const imageUrl = normalizeDataUrlAttachment(text, {
        label: '图片附件',
        allowedPattern: /^image\//i,
        maxBytes: SANDBOX_CHAT_IMAGE_DATA_MAX_BYTES,
        code: 'SANDBOX_IMAGE_INVALID',
      }).slice(0, /^data:/i.test(text) ? undefined : 4096);
      if (!imageUrl || seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      normalized.push(imageUrl);
      if (normalized.length >= SANDBOX_CHAT_MAX_IMAGES) break;
    }
    return normalized;
  }
  
  function redactQqSimulatorMediaUrl(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^data:/i.test(text)) {
      const mediaType = getDataUrlMediaType(text) || 'data';
      const sizeKb = Math.ceil(estimateDataUrlBytes(text) / 1024);
      return `[${mediaType}; ${sizeKb}KB data-url]`;
    }
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  }

  function isSandboxPlaceholderApiKey(value = '') {
    const text = String(value || '').trim().toLowerCase();
    return !text || text === 'your-api-key' || text === 'your api key' || text === 'your_api_key';
  }

  function isSandboxPlaceholderBaseApi(value = '') {
    const text = String(value || '').trim().replace(/\/+$/, '').toLowerCase();
    return !text || text.includes('xx.xx.com');
  }

  function normalizeSandboxCompletionMessages(messages = [], fallbackText = '') {
    const normalized = Array.isArray(messages)
      ? messages
          .filter(item => item && typeof item === 'object')
          .map(item => ({
            ...item,
            role: String(item.role || '').trim() || 'user',
          }))
      : [];
    if (!normalized.some(item => item.role === 'user')) {
      normalized.push({
        role: 'user',
        content: String(fallbackText || '请根据上面的上下文回复这条消息。').trim() || '请根据上面的上下文回复这条消息。',
      });
    }
    return normalized;
  }
  
  async function buildSandboxConfigStatusPayload(query = {}) {
    const { userId, config: aiConfig, configSource } = await resolveSandboxEffectiveConfig(query);
    const key = String(aiConfig.apiKey || '').trim();
    const isPlaceholder = isSandboxPlaceholderApiKey(key) || isSandboxPlaceholderBaseApi(aiConfig.baseApi);
    const baseApi = String(aiConfig.baseApi || '').trim();
    return {
      baseApi: maskDisplayUrlSecrets(baseApi),
      modelType: String(aiConfig.modelType || aiConfig.workingModel || '').trim(),
      apiKeyConfigured: !isPlaceholder,
      isPlaceholder,
      valid: !isPlaceholder && !!baseApi && !!String(aiConfig.modelType || aiConfig.workingModel || '').trim(),
      resolvedUserId: userId,
      groupId: String(query.groupId || '').trim(),
      configSource,
    };
  }
  
  async function getSandboxEffectiveConfig(payload = {}) {
    const userId = String(payload.userId || payload.sessionId || 'webconsole-sandbox').trim() || 'webconsole-sandbox';
    const userConfig = await UserConfigManager.getUserConfig(userId);
    const aiConfig = ConfigControl.get('ai') || {};
    return {
      userId,
      config: userConfig || aiConfig,
      globalConfig: aiConfig,
    };
  }

  async function resolveSandboxEffectiveConfig(payload = {}) {
    const userId = String(payload.userId || payload.sessionId || 'webconsole-sandbox').trim() || 'webconsole-sandbox';
    const { config: effectiveConfig, globalConfig } = await getSandboxEffectiveConfig(payload);
    const latestGlobalConfig = ConfigControl.get('ai') || {};
    const hasUserConfig = typeof UserConfigManager.hasUserConfig === 'function'
      ? await UserConfigManager.hasUserConfig(userId)
      : Boolean(effectiveConfig && effectiveConfig !== globalConfig);
    return {
      userId,
      config: hasUserConfig ? (effectiveConfig || latestGlobalConfig) : latestGlobalConfig,
      globalConfig: latestGlobalConfig,
      configSource: hasUserConfig ? 'user' : 'global',
    };
  }
  
  function parseSandboxGroupHistory(value = '') {
    return String(value || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [nickname = '', userId = '', type = 'text', content = ''] = line.split('|');
        return {
          nickname: nickname.trim() || `Member ${index + 1}`,
          userId: userId.trim() || `unknown-${index + 1}`,
          type: type.trim() || 'text',
          content: content.trim(),
          seq: index + 1,
        };
      })
      .slice(-20);
  }
  
  function parseSandboxMemories(value = '') {
    return String(value || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [keywords = '', data = '', createdAt = ''] = line.split('|');
        return {
          keywords: keywords.trim() || `memory-${index + 1}`,
          data: data.trim() || '',
          createdAt: createdAt.trim() || new Date().toISOString(),
        };
      })
      .filter(item => item.data)
      .slice(-20);
  }
  
  function parseSandboxKnowledge(value = '') {
    const source = String(value || '').trim();
    if (!source) {
      return [];
    }
  
    const blocks = source
      .split(/\n\s*\n+/)
      .map(item => item.trim())
      .filter(Boolean);
  
    return blocks.map((block, index) => {
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const title = (lines.shift() || `Knowledge ${index + 1}`).replace(/^#+\s*/, '');
      let tags = [];
      if (lines[0] && /^tags?\s*:/i.test(lines[0])) {
        tags = lines.shift().replace(/^tags?\s*:/i, '').split(/[;,，、]/).map(item => item.trim()).filter(Boolean);
      }
      return {
        title,
        tags,
        content: lines.join('\n').trim(),
      };
    }).filter(item => item.content);
  }
  
  function tokenizeSandboxText(value = '') {
    const tokens = new Set();
    const normalized = String(value || '').toLowerCase();
    const words = normalized.match(/[a-z0-9_\-\u4e00-\u9fa5]{2,}/g) || [];
    for (const word of words) {
      tokens.add(word);
    }
    return Array.from(tokens);
  }
  
  function retrieveSandboxKnowledge(query = '', knowledgeItems = [], topK = 3) {
    const queryTokens = tokenizeSandboxText(query);
    if (queryTokens.length === 0 || knowledgeItems.length === 0) {
      return [];
    }
    const requestedTags = String(arguments[3] || '').split(/[;,，、]/).map(item => item.trim().toLowerCase()).filter(Boolean);
    return knowledgeItems
      .filter(item => requestedTags.length === 0 || (item.tags || []).some(tag => requestedTags.includes(String(tag).toLowerCase())))
      .map(item => {
        const haystack = `${item.title}\n${item.content}`.toLowerCase();
        const title = String(item.title || '').toLowerCase();
        const matchedTokens = queryTokens.filter(token => haystack.includes(token));
        const titleHits = queryTokens.filter(token => title.includes(token));
        const tagHits = (item.tags || []).filter(tag => queryTokens.some(token => String(tag).toLowerCase().includes(token)));
        return {
          ...item,
          matchedTokens,
          score: matchedTokens.length + titleHits.length * 3 + tagHits.length * 2,
        };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  function buildSandboxRagLogSummary(payload = {}) {
    const prompt = String(payload.prompt || '');
    const knowledgeBase = String(payload.knowledgeBase || '');
    const knowledgeItems = Array.isArray(payload.knowledgeItems) ? payload.knowledgeItems : [];
    const knowledgeMatches = Array.isArray(payload.knowledgeMatches) ? payload.knowledgeMatches : [];
    const queryTokens = Array.isArray(payload.queryTokens) ? payload.queryTokens : tokenizeSandboxText(prompt);
    const matchedTokenCount = knowledgeMatches.reduce((sum, item) => (
      sum + (Array.isArray(item?.matchedTokens) ? item.matchedTokens.length : 0)
    ), 0);
    return JSON.stringify({
      promptLength: prompt.length,
      knowledgeBaseLength: knowledgeBase.length,
      knowledgeItemCount: knowledgeItems.length,
      knowledgeMatchCount: knowledgeMatches.length,
      queryTokenCount: queryTokens.length,
      matchedTokenCount,
      topScores: knowledgeMatches.slice(0, 5).map(item => Number(item?.score || 0)),
    });
  }
  
  function buildSandboxKnowledgeContext(matches = []) {
    if (!Array.isArray(matches) || matches.length === 0) {
      return '';
    }
    return [
      'Relevant knowledge base entries:',
      ...matches.map((item, index) => `${index + 1}. ${item.title}\nTags: ${(item.tags || []).join(', ')}\nContent: ${item.content}`),
    ].join('\n');
  }
  
  async function buildSandboxSystemPrompt(payload = {}) {
    const customPrompt = String(payload.systemPrompt || '').trim();
    if (customPrompt) {
      return customPrompt;
    }
    const profileConfig = ConfigControl.get('profile') || {};
    const botName = String(payload.botName || profileConfig.nickName || 'LingJing').trim() || 'LingJing';
    const { getSystemPrompt } = await import('../../constants/ai/prompts.js');
    const basePrompt = await getSystemPrompt(botName);
    const userId = String(payload.userId || payload.sessionId || 'webconsole-sandbox').trim() || 'webconsole-sandbox';
    const userName = String(payload.userName || 'Sandbox User').trim() || 'Sandbox User';
    const groupId = String(payload.groupId || '').trim();
    const isMaster = String(payload.isMaster || '').trim().toLowerCase() === 'true';
    const contextNote = String(payload.contextNote || '').trim();
    const groupHistory = parseSandboxGroupHistory(payload.groupHistory);
    const memories = parseSandboxMemories(payload.memories);
    const knowledgeItems = parseSandboxKnowledge(payload.knowledgeBase);
    const knowledgeMatches = retrieveSandboxKnowledge(String(payload.prompt || ''), knowledgeItems, Number(payload.knowledgeTopK || 3), String(payload.knowledgeFilterTags || ''));
    const knowledgeContext = buildSandboxKnowledgeContext(knowledgeMatches);
    const now = new Date();
  
    let contextIntro = [
      'Sandbox runtime context:',
      `- Bot name: ${botName}`,
      `- User name: ${userName}`,
      `- User id: ${userId}`,
      `- Group id: ${groupId || '(none)'}`,
      `- User role: ${isMaster ? 'master' : 'normal'}`,
      `- Date: ${now.toLocaleDateString('zh-CN')}`,
      `- Time: ${now.toLocaleTimeString('zh-CN')}`,
      contextNote ? `- Context note: ${contextNote}` : '',
    ].filter(Boolean).join('\n');
  
    if (groupHistory.length > 0) {
      const aiConfig = ConfigControl.get('ai') || {};
      const maxMessageLength = aiConfig?.maxMessageLength || 100;
      contextIntro += '\nRecent group history:\n';
      for (const message of groupHistory) {
        if (message.type === 'text') {
          let displayText = String(message.content || '');
          if (displayText.length > maxMessageLength) {
            const omittedChars = displayText.length - maxMessageLength;
            displayText = displayText.substring(0, maxMessageLength) + `...(omitted ${omittedChars} chars)`;
          }
          contextIntro += `[${message.nickname || 'unknown'},id:${message.userId},seq:${message.seq}] ${displayText}\n`;
        } else if (message.type === 'at') {
          contextIntro += `[${message.nickname || 'unknown'},id:${message.userId},seq:${message.seq}] @${message.content || 'mention'}\n`;
        } else if (message.type === 'image') {
          contextIntro += `[${message.nickname || 'unknown'},id:${message.userId},seq:${message.seq}] [image]\n`;
        }
      }
    }
  
    if (memories.length > 0) {
      contextIntro += 'Remembered memories:\n';
      memories.forEach((memory, index) => {
        contextIntro += `${index + 1}. keywords=${memory.keywords} data=${memory.data} createdAt=${memory.createdAt}\n`;
      });
    }
  
    if (knowledgeContext) {
      contextIntro += `\n${knowledgeContext}\n`;
    }
  
    return `${contextIntro}\n${basePrompt}`;
  }
  
  async function buildSandboxPromptPreviewPayload(payload = {}) {
    const { userId, config: effectiveConfig, globalConfig } = await getSandboxEffectiveConfig(payload);
    const systemPrompt = await buildSandboxSystemPrompt(payload);
    const knowledgeItems = parseSandboxKnowledge(payload.knowledgeBase);
    const knowledgeMatches = retrieveSandboxKnowledge(String(payload.prompt || ''), knowledgeItems, Number(payload.knowledgeTopK || 3), String(payload.knowledgeFilterTags || ''));
    const queryTokens = tokenizeSandboxText(String(payload.prompt || ''));
    logger.info(`[sandbox-rag-preview] ${buildSandboxRagLogSummary({
      prompt: payload.prompt,
      knowledgeBase: payload.knowledgeBase,
      knowledgeItems,
      knowledgeMatches,
      queryTokens,
    })}`);
    return {
      success: true,
      systemPrompt,
      systemPromptLength: systemPrompt.length,
      resolvedUserId: userId,
      configSource: effectiveConfig === globalConfig ? 'global' : 'user',
      knowledgeMatches,
      debugKnowledgeBase: String(payload.knowledgeBase || ''),
      debugKnowledgeItems: knowledgeItems,
      debugQueryTokens: queryTokens,
    };
  }
  
  async function buildSandboxWebReadPayload(payload = {}) {
    const url = String(payload.url || '').trim();
    if (!url) {
      throw new Error('URL is required for web read.');
    }
    const result = await fetchWebMarkdown({
      url,
      max_length: payload.maxLength,
      timeout_ms: payload.timeoutMs,
    });
    if (result.success === false) {
      throw new Error(result.error || 'Web markdown fetch failed.');
    }
    return {
      success: true,
      url: result.url,
      taskId: result.task_id,
      size: result.size,
      markdown: result.markdown,
    };
  }
  
  async function generateKnowledgeBaseFromWebPayload(payload = {}) {
    const query = String(payload.query || '').trim();
    if (!query) {
      throw new Error('Search query is required.');
    }
    const aiConfig = ConfigControl.get('ai') || {};
    const coreConfig = ConfigControl.get('coreConfig') || {};
    const apiKey = String(aiConfig.apiKey || '').trim();
    const baseApi = String(aiConfig.baseApi || '').trim();
    const model = String(aiConfig.modelType || aiConfig.workingModel || '').trim();
    if (!apiKey || apiKey === 'your-api-key' || apiKey === 'your api key') {
      throw new Error('AI apiKey is required to generate knowledge base content.');
    }
    if (!baseApi || !model) {
      throw new Error('AI baseApi and modelType are required.');
    }
    if (!coreConfig?.tools?.search?.enabled) {
      throw new Error('Search tool must be enabled first.');
    }
  
    logger.info(`[knowledge-generate] start query=${JSON.stringify(query)}`);
  
    const searchResult = await searchWeb({
      query,
      limit: Math.min(Math.max(Number(payload.limit || 5), 1), 5),
      fetch_full: false,
    });
    if (searchResult.success === false) {
      throw new Error(searchResult.error || 'Search request failed.');
    }
    logger.info(`[knowledge-generate] search success count=${Array.isArray(searchResult.results) ? searchResult.results.length : 0}`);
  
    const searchItems = Array.isArray(searchResult.results) ? searchResult.results.filter(item => item.url) : [];
    if (searchItems.length === 0) {
      throw new Error('No searchable results were returned.');
    }
  
    const knowledgeBase = searchItems.map((item, index) => {
      const title = String(item.title || `Result ${index + 1}`).trim();
      const content = String(item.snippet || item.description || item.content || '').trim();
      return [
        title,
        `tags: web, search, result-${index + 1}`,
        content || String(item.url || '').trim(),
      ].join('\n');
    }).join('\n\n');
  
    return {
      success: true,
      query,
      count: searchItems.length,
      items: searchItems,
      knowledgeBase,
    };
  }
  async function runSandboxChat(payload = {}) {
    const prompt = String(payload.prompt || '').trim();
    if (!prompt) {
      throw new Error('Prompt is required.');
    }
    if (prompt.length > 4000) {
      throw new Error('Prompt is too long. Maximum length is 4000 characters.');
    }
  
    const history = sanitizeSandboxHistory(payload.history);
    const pendingImageUrls = normalizeSandboxImageUrls(
      payload.imageUrls || payload.images || payload.pendingImageUrls || [],
    );
    const sessionId = `webconsole:sandbox:${String(payload.sessionId || 'default').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 60) || 'default'}`;
    const { userId, config: effectiveConfig, globalConfig, configSource } = await resolveSandboxEffectiveConfig(payload);
    const apiKey = String(effectiveConfig.apiKey || '').trim();
    const baseApi = String(effectiveConfig.baseApi || '').trim();
    const model = String(payload.model || effectiveConfig.modelType || effectiveConfig.workingModel || '').trim();
    const temperature = Math.max(0, Math.min(2, Number(payload.temperature ?? effectiveConfig.temperature ?? 0.7)));
    const maxTokens = payload.maxTokens === undefined || payload.maxTokens === null || payload.maxTokens === ''
      ? undefined
      : Math.max(1, Math.min(8192, Number(payload.maxTokens)));
    if (isSandboxPlaceholderApiKey(apiKey)) {
      throw new Error('AI apiKey 未配置或仍是占位值，请到 API 设置页保存主对话 API Key。');
    }
    if (isSandboxPlaceholderBaseApi(baseApi)) {
      throw new Error('AI baseApi 未配置或仍是占位地址，请到 API 设置页保存主对话 API 地址。');
    }
    if (!baseApi || !model) {
      throw new Error('AI baseApi 和模型名称不能为空。');
    }
  
    const systemPrompt = await buildSandboxSystemPrompt(payload);
    const knowledgeItems = parseSandboxKnowledge(payload.knowledgeBase);
    const knowledgeMatches = retrieveSandboxKnowledge(prompt, knowledgeItems, Number(payload.knowledgeTopK || 3), String(payload.knowledgeFilterTags || ''));
    const queryTokens = tokenizeSandboxText(prompt);
    logger.info(`[sandbox-rag-chat] ${buildSandboxRagLogSummary({
      prompt,
      knowledgeBase: payload.knowledgeBase,
      knowledgeItems,
      knowledgeMatches,
      queryTokens,
    })}`);
  
    const startedAt = Date.now();
    const ai = {
      async complete({ messages, tools, temperature: innerTemp, scene, sessionId: sid, groupId, userId: uid }) {
        const requestUrl = buildOpenAiCompatibleUrl(baseApi, '/v1/chat/completions');
        const completionMessages = normalizeSandboxCompletionMessages(messages, prompt);
        let response;
        try {
          response = await fetch(requestUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: completionMessages,
              tools,
              temperature: innerTemp,
              max_tokens: maxTokens,
              stream: false,
            }),
          });
        } catch (error) {
          throw new Error(`AI completion 连接失败：${error.message}；baseApi=${maskDisplayUrlSecrets(baseApi)}，model=${model}`);
        }
        const rawText = await response.text();
        if (!response.ok) {
          throw new Error(`AI completion 请求失败：HTTP ${response.status}，baseApi=${maskDisplayUrlSecrets(baseApi)}，model=${model}，响应=${rawText.slice(0, 300)}`);
        }
        let parsed;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          throw new Error('AI completion returned invalid JSON.');
        }
        const choice = parsed?.choices?.[0] || {};
        const message = choice.message || {};
        return {
          content: message.content || '',
          reasoning: message.reasoning_content || message.reasoning || '',
          toolCalls: (message.tool_calls || []).map(tc => ({
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments || '{}',
          })),
          usage: parsed?.usage || {},
          raw: parsed,
          meta: { scene, sessionId: sid, groupId, userId: uid },
        };
      },
    };
  
    const targetMessage = {
      userId,
      userName: String(payload.userName || 'Sandbox User').trim() || 'Sandbox User',
      userRole: 'member',
      userTitle: '',
      content: prompt,
      timestamp: Date.now(),
      messageId: `sandbox-${Date.now()}`,
    };
  
    const promptCtx = {
      config: effectiveConfig,
      isGroup: Boolean(payload.groupId),
      groupName: String(payload.groupName || 'Sandbox Group').trim() || 'Sandbox Group',
      memberCount: Number(payload.memberCount || 0) || undefined,
      botRole: 'member',
      botNickname: String(payload.botName || ConfigControl.get('profile')?.nickName || 'LingJing').trim() || 'LingJing',
      chatHistory: history.map((msg, index) => ({
        ...msg,
        timestamp: Date.now() - (history.length - index) * 60000,
        userName: msg.role === 'assistant' ? undefined : targetMessage.userName,
        userId: msg.role === 'assistant' ? undefined : userId,
        userRole: msg.role === 'assistant' ? undefined : 'member',
      })),
      targetMessage,
      replyContext: { type: 'reply' },
      memoryContext: '',
      knowledgeContext: buildSandboxKnowledgeContext(knowledgeMatches),
      affinityContext: '',
      userProfileContext: '',
      expressionContext: '',
      skillContext: '',
      plannerThoughts: '',
      reviewMessages: [],
    };
  
    const sandboxDefaultModel = String(effectiveConfig?.tools?.tts?.defaultModel || '').trim();
    const skillManager = new SkillSessionManager();
    await loadAutoSessionSkills(skillManager, sessionId);
    promptCtx.skillContext = skillManager.getActiveSkillsInfo(sessionId);
    const toolCtx = {
      sessionId,
      groupId: String(payload.groupId || '').trim(),
      userId,
      promptCtx,
      targetMessage,
      defaultVoiceModel: sandboxDefaultModel,
      config: effectiveConfig,
      pendingImageUrls,
      skillManager,
      voiceMessages: [],
    };
  
    const emojiAgent = new EmojiAgent(null, effectiveConfig, {
      getMessages() {
        return [];
      },
    });
  
    const humanize = { emojiAgent };
    const result = await runChat(ai, toolCtx, promptCtx.chatHistory, targetMessage, promptCtx, humanize);
    const reply = Array.isArray(result?.messages) ? result.messages.join('\n') : '';
    const toolCalls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
    const voiceMessages = [
      ...(Array.isArray(result?.voiceMessages) ? result.voiceMessages : []),
      ...toolCalls
        .map(item => item?.result?.voiceMessage)
        .filter(item => item && item.audioUrl),
    ];
    const emojiPath = result?.emojiPath || '';
    if (!reply.trim() && !emojiPath && voiceMessages.length === 0) {
      throw new Error('Sandbox chat returned no visible output.');
    }
  
    return {
      success: true,
      sessionId,
      reply: String(reply),
      usage: {},
      rawResponse: JSON.stringify(result || {}, null, 2),
      systemPrompt,
      note: 'Sandbox mode is for console-side testing only. Output may differ from live chat flows.',
      elapsedMs: Date.now() - startedAt,
      toolCalls,
      knowledgeMatches,
      debugKnowledgeBase: String(payload.knowledgeBase || ''),
      debugKnowledgeItems: knowledgeItems,
      debugQueryTokens: queryTokens,
      emojiPath,
      voiceMessages,
      request: {
        model,
        temperature,
        maxTokens: maxTokens ?? null,
        historyCount: history.length,
        imageCount: pendingImageUrls.length,
        systemPromptLength: systemPrompt.length,
        configSource,
        resolvedUserId: userId,
        groupId: String(payload.groupId || '').trim(),
        userName: String(payload.userName || 'Sandbox User').trim() || 'Sandbox User',
        botName: String(payload.botName || ConfigControl.get('profile')?.nickName || 'LingJing').trim() || 'LingJing',
      },
    };
  }

  return {
    sanitizeSandboxHistory,
    estimateDataUrlBytes,
    getDataUrlMediaType,
    normalizeDataUrlAttachment,
    normalizeSandboxImageUrls,
    redactQqSimulatorMediaUrl,
    buildSandboxConfigStatusPayload,
    buildSandboxPromptPreviewPayload,
    buildSandboxWebReadPayload,
    generateKnowledgeBaseFromWebPayload,
    runSandboxChat,
  };
}
