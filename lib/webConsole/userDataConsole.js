export function createUserDataConsole(options = {}) {
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const getChatSnapshot = typeof options.getChatSnapshot === 'function' ? options.getChatSnapshot : () => ({});
  const getAffinitySnapshot = typeof options.getAffinitySnapshot === 'function' ? options.getAffinitySnapshot : () => ({});
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({ pageSize: 20, logTailLength: 12000, profileRecentMessagesLimit: 20, affinityHistoryLimit: 50, exposeLogs: true, maxPageSize: 100 }));
  const paginateItems = typeof options.paginateItems === 'function'
    ? options.paginateItems
    : ((items = []) => ({ items, page: 1, pageSize: items.length, total: items.length, totalPages: 1 }));
  const readTailText = typeof options.readTailText === 'function' ? options.readTailText : () => '';
  const parseJsonObjects = typeof options.parseJsonObjects === 'function' ? options.parseJsonObjects : () => [];
  const attachUsageDisplayFields = typeof options.attachUsageDisplayFields === 'function'
    ? options.attachUsageDisplayFields
    : (entry = {}) => entry;
  const normalizeUsageScene = typeof options.normalizeUsageScene === 'function'
    ? options.normalizeUsageScene
    : (entry = {}) => String(entry?.scene || 'unknown');
  const buildEntryId = typeof options.buildEntryId === 'function'
    ? options.buildEntryId
    : ((prefix, entry = {}, index = 0) => [prefix, entry.time || 'unknown', index].join('::'));
  const getSessionDebugSnapshot = typeof options.getSessionDebugSnapshot === 'function'
    ? options.getSessionDebugSnapshot
    : (() => ({}));
  const getPokeDebugSnapshot = typeof options.getPokeDebugSnapshot === 'function'
    ? options.getPokeDebugSnapshot
    : (() => ({}));
  const safeWriteJson = typeof options.safeWriteJson === 'function' ? options.safeWriteJson : (() => {});
  const usageLogFile = options.usageLogFile || '';
  const affinityLogFile = options.affinityLogFile || '';
  const chatDbFile = options.chatDbFile || '';
  const affinityFile = options.affinityFile || '';

  function buildUserNameMap() {
    const chat = getChatSnapshot();
    const map = new Map();
    for (const message of Array.isArray(chat?.messages) ? chat.messages : []) {
      const userId = String(message.userId || '').trim();
      const userName = String(message.userName || '').trim();
      const sessionId = String(message.sessionId || '').trim();
      const groupId = String(message.groupId || '').trim();
      if (userId && userName) {
        map.set(`${groupId || sessionId}:${userId}`, userName);
        map.set(`:${userId}`, userName);
      }
    }
    for (const profile of Array.isArray(chat?.profiles) ? chat.profiles : []) {
      const userId = String(profile.userId || '').trim();
      const userName = String(profile.userName || '').trim();
      const sessionId = String(profile.sessionId || '').trim();
      if (userId && userName) {
        map.set(`${sessionId}:${userId}`, userName);
        map.set(`:${userId}`, userName);
      }
    }

    return map;
  }

  function resolveDisplayName(nameMap, groupId, sessionId, userId, fallback = '') {
    return nameMap.get(`${groupId || sessionId || ''}:${userId}`)
      || nameMap.get(`:${userId}`)
      || fallback
      || String(userId || '未知用户');
  }

  function buildAffinityListPayload(filters = {}) {
    const allConfigs = getAllConfigs() || {};
    const affinityConfig = allConfigs?.ai?.affinity || {};
    const data = getAffinitySnapshot();
    const nameMap = buildUserNameMap();
    const query = String(filters.query || '').trim().toLowerCase();
    const groupId = String(filters.groupId || '').trim();
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);

    const list = Object.values(data || {})
      .map(item => ({
        group_id: item.group_id,
        user_id: item.user_id,
        score: Number(item.score || 0),
        interaction_count: Number(item.interaction_count || 0),
        positive_count: Number(item.positive_count || 0),
        negative_count: Number(item.negative_count || 0),
        display_name: resolveDisplayName(nameMap, item.group_id, '', item.user_id),
        last_reason: item.last_reason || '',
        updated_at: item.updated_at || '',
        decay_date: item.decay_date || '',
        level: Number(item.score || 0) <= Number(affinityConfig.coldThreshold ?? -5)
          ? 'cold'
          : Number(item.score || 0) < Number(affinityConfig.neutralThreshold ?? 5)
            ? 'neutral'
            : Number(item.score || 0) < Number(affinityConfig.warmThreshold ?? 20)
              ? 'warm'
              : 'close',
      }))
      .filter(item => !groupId || String(item.group_id) === groupId)
      .filter(item => {
        if (!query) return true;
        return [item.group_id, item.user_id, item.display_name, item.last_reason, item.level]
          .some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => b.score - a.score);

    return paginateItems(list, page, pageSize);
  }

  function buildProfilesPayload(filters = {}) {
    const chat = getChatSnapshot();
    const nameMap = buildUserNameMap();
    const query = String(filters.query || '').trim().toLowerCase();
    const sessionId = String(filters.sessionId || '').trim();
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
    const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];

    const items = profiles
        .filter(item => !sessionId || String(item.sessionId) === sessionId)
        .filter(item => {
          if (!query) return true;
          return [item.sessionId, item.userId, item.userName, item.summary, ...(item.traits || []), ...(item.notableTopics || [])]
            .some(value => String(value || '').toLowerCase().includes(query));
        })
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, 100)
        .map(item => ({
          sessionId: item.sessionId,
          userId: item.userId,
          userName: resolveDisplayName(nameMap, '', item.sessionId, item.userId, item.userName || ''),
          summary: item.summary || '',
          traits: item.traits || [],
          speakingStyle: item.speakingStyle || [],
          interactionPreferences: item.interactionPreferences || [],
          notableTopics: item.notableTopics || [],
          confidence: item.confidence || 'unknown',
          sourceMessageCount: Number(item.sourceMessageCount || 0),
          updatedAt: item.updatedAt || 0,
        }));

    return paginateItems(items, page, pageSize);
  }

  function detectSessionType(sessionId = '') {
    if (String(sessionId).startsWith('group:')) return 'group';
    if (String(sessionId).startsWith('private:')) return 'private';
    return 'unknown';
  }

  function buildSessionUsageEntries(sessionId, userId = '') {
    const content = readTailText(usageLogFile, Math.max(180000, getWebConsoleConfig().logTailLength * 6));
    return parseJsonObjects(content)
      .map((item, index) => {
        try {
          const parsed = JSON.parse(item);
          return attachUsageDisplayFields({
            ...parsed,
            id: buildEntryId('usage', parsed, index),
          });
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(item => String(item.session_id || '') === String(sessionId))
      .filter(item => !userId || String(item.user_id || '') === String(userId))
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
      .slice(0, 30);
  }

  function buildSessionListPayload(filters = {}) {
    const chat = getChatSnapshot();
    const query = String(filters.query || '').trim().toLowerCase();
    const sessionIdFilter = String(filters.sessionId || '').trim();
    const userIdFilter = String(filters.userId || '').trim();
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
    const sessions = Array.isArray(chat?.sessions) ? chat.sessions : [];
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
    const sessionMap = new Map();

    for (const session of sessions) {
      sessionMap.set(String(session.id), {
        sessionId: String(session.id),
        type: session.type || detectSessionType(session.id),
        targetId: session.targetId || '',
        createdAt: Number(session.createdAt || 0),
        updatedAt: Number(session.updatedAt || 0),
        compressedContext: session.compressedContext ?? null,
        messageCount: 0,
        userMessageCount: 0,
        assistantMessageCount: 0,
        participants: new Map(),
        lastMessagePreview: '',
        lastMessageRole: '',
        lastMessageTime: Number(session.updatedAt || 0),
        profileCount: 0,
      });
    }

    for (const message of messages) {
      const sessionId = String(message.sessionId || '');
      if (!sessionMap.has(sessionId)) {
        sessionMap.set(sessionId, {
          sessionId,
          type: detectSessionType(sessionId),
          targetId: sessionId.includes(':') ? sessionId.split(':').slice(1).join(':') : sessionId,
          createdAt: Number(message.timestamp || 0),
          updatedAt: Number(message.timestamp || 0),
          compressedContext: null,
          messageCount: 0,
          userMessageCount: 0,
          assistantMessageCount: 0,
          participants: new Map(),
          lastMessagePreview: '',
          lastMessageRole: '',
          lastMessageTime: 0,
          profileCount: 0,
        });
      }
      const record = sessionMap.get(sessionId);
      const timestamp = Number(message.timestamp || 0);
      record.messageCount += 1;
      if (message.role === 'assistant') record.assistantMessageCount += 1;
      if (message.role === 'user') record.userMessageCount += 1;
      if (message.userId) {
        const key = String(message.userId);
        const existing = record.participants.get(key) || { userId: key, userName: message.userName || key, count: 0 };
        existing.userName = existing.userName || message.userName || key;
        existing.count += 1;
        record.participants.set(key, existing);
      }
      if (timestamp >= Number(record.lastMessageTime || 0)) {
        record.lastMessageTime = timestamp;
        record.lastMessagePreview = String(message.content || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        record.lastMessageRole = message.role || '';
        record.updatedAt = Math.max(Number(record.updatedAt || 0), timestamp);
      }
      if (!record.createdAt || timestamp < record.createdAt) {
        record.createdAt = timestamp;
      }
    }

    for (const profile of profiles) {
      const sessionId = String(profile.sessionId || '');
      if (!sessionMap.has(sessionId)) continue;
      const record = sessionMap.get(sessionId);
      record.profileCount += 1;
      if (profile.userId && !record.participants.has(String(profile.userId))) {
        record.participants.set(String(profile.userId), {
          userId: String(profile.userId),
          userName: profile.userName || String(profile.userId),
          count: 0,
        });
      }
    }

    const items = Array.from(sessionMap.values())
      .map(item => {
        const runtimeDebug = getSessionDebugSnapshot(item.sessionId) || {};
        const hasFallback = !!runtimeDebug.failureReason || (runtimeDebug.statusHints || []).some(h => String(h).toLowerCase().includes('fallback'));
        return {
          sessionId: item.sessionId,
          type: item.type,
          targetId: item.targetId,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          messageCount: item.messageCount,
          userMessageCount: item.userMessageCount,
          assistantMessageCount: item.assistantMessageCount,
          participantCount: item.participants.size,
          participants: Array.from(item.participants.values()).slice(0, 5),
          lastMessagePreview: item.lastMessagePreview || '暂无最近消息',
          lastMessageRole: item.lastMessageRole || 'unknown',
          lastMessageTime: item.lastMessageTime || item.updatedAt || item.createdAt || 0,
          profileCount: item.profileCount,
          hasFallback,
          fallbackReason: runtimeDebug.failureReason || '',
        };
      })
      .filter(item => !sessionIdFilter || item.sessionId.includes(sessionIdFilter))
      .filter(item => !userIdFilter || item.participants.some(participant => String(participant.userId) === userIdFilter))
      .filter(item => {
        if (!query) return true;
        return [
          item.sessionId,
          item.targetId,
          item.lastMessagePreview,
          ...item.participants.map(participant => `${participant.userName} ${participant.userId}`),
        ].some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => Number(b.lastMessageTime || 0) - Number(a.lastMessageTime || 0));

    return paginateItems(items, page, pageSize);
  }

  function buildSessionDebugPayload(sessionId, focusUserId = '') {
    const chat = getChatSnapshot();
    const sessions = Array.isArray(chat?.sessions) ? chat.sessions : [];
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
    const topics = Array.isArray(chat?.topics) ? chat.topics : [];
    const expressions = Array.isArray(chat?.expressions) ? chat.expressions : [];
    const sessionMessages = messages
      .filter(item => String(item.sessionId) === String(sessionId))
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

    if (!sessionMessages.length && !sessions.find(item => String(item.id) === String(sessionId))) {
      return null;
    }

    const sessionRecord = sessions.find(item => String(item.id) === String(sessionId)) || {
      id: sessionId,
      type: detectSessionType(sessionId),
      targetId: String(sessionId).includes(':') ? String(sessionId).split(':').slice(1).join(':') : sessionId,
      createdAt: sessionMessages[0]?.timestamp || 0,
      updatedAt: sessionMessages.at(-1)?.timestamp || 0,
      compressedContext: null,
    };

    const participantMap = new Map();
    for (const message of sessionMessages) {
      if (!message.userId) continue;
      const key = String(message.userId);
      const existing = participantMap.get(key) || {
        userId: key,
        userName: message.userName || key,
        count: 0,
        lastTime: 0,
      };
      existing.count += 1;
      existing.userName = existing.userName || message.userName || key;
      existing.lastTime = Math.max(Number(existing.lastTime || 0), Number(message.timestamp || 0));
      participantMap.set(key, existing);
    }

    const linkedProfiles = profiles
      .filter(item => String(item.sessionId) === String(sessionId))
      .sort((a, b) => {
        const aFocus = String(a.userId) === String(focusUserId) ? 1 : 0;
        const bFocus = String(b.userId) === String(focusUserId) ? 1 : 0;
        if (aFocus !== bFocus) return bFocus - aFocus;
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      });

    const logsExposed = getWebConsoleConfig().exposeLogs;
    const usageRequests = logsExposed ? buildSessionUsageEntries(sessionId, focusUserId) : [];
    const latestUsage = usageRequests[0] || null;
    const usageSummary = usageRequests.reduce((acc, item) => {
      acc.requestCount += 1;
      acc.errorCount += item.error ? 1 : 0;
      acc.totalTokens += Number(item.total_tokens || 0);
      const scene = normalizeUsageScene(item);
      acc.byScene[scene] = (acc.byScene[scene] || 0) + 1;
      return acc;
    }, { requestCount: 0, errorCount: 0, totalTokens: 0, byScene: {} });

    const sessionTopics = topics
      .filter(item => String(item.sessionId) === String(sessionId))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 12);

    const sessionExpressions = expressions
      .filter(item => String(item.sessionId) === String(sessionId))
      .filter(item => !focusUserId || String(item.userId || '') === String(focusUserId))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 20);

    const recentMessages = sessionMessages.slice(-120).map(item => ({
      id: item.id,
      role: item.role,
      content: item.content,
      userId: item.userId,
      userName: item.userName,
      userRole: item.userRole,
      userTitle: item.userTitle,
      groupId: item.groupId,
      groupName: item.groupName,
      timestamp: item.timestamp,
      messageId: item.messageId,
    }));

    const affinityHistory = logsExposed && String(sessionId).startsWith('group:') && focusUserId
      ? buildAffinityHistoryPayload(String(sessionId).slice(6), focusUserId)
      : null;

    const alerts = [];
    if (sessionMessages.length === 0) {
      alerts.push({ tone: 'error', message: 'Current session has no messages.' });
    }
    if (!logsExposed) {
      alerts.push({ tone: 'neutral', message: 'Log exposure is disabled; AI request logs are hidden.' });
    } else if (usageSummary.requestCount === 0) {
      alerts.push({ tone: 'neutral', message: 'Current session has no AI request logs yet.' });
    }
    if (usageSummary.errorCount > 0) {
      alerts.push({ tone: 'error', message: `Current session has ${usageSummary.errorCount} AI request errors.` });
    }
    if (linkedProfiles.length === 0) {
      alerts.push({ tone: 'neutral', message: 'Current session has no linked user profile.' });
    }
    if (focusUserId && !linkedProfiles.some(item => String(item.userId) === String(focusUserId))) {
      alerts.push({ tone: 'error', message: 'Focused user has no profile in this session.' });
    }
    if (sessionMessages.length > 0 && !sessionMessages.some(item => item.role === 'assistant')) {
      alerts.push({ tone: 'error', message: 'Current session has no assistant reply.' });
    }

    const latestAssistantMessage = [...sessionMessages].reverse().find(item => item.role === 'assistant') || null;
    const latestUserMessage = [...sessionMessages].reverse().find(item => item.role === 'user') || null;
    const runtimeDebug = getSessionDebugSnapshot(sessionId) || {};
    const pokeDebug = getPokeDebugSnapshot(sessionRecord.targetId || sessionRecord.id?.replace?.(/^group:/, '') || '') || {};
    const debugDigest = {
      requestTime: latestUsage?.time || '',
      scene: latestUsage?.scene || '',
      model: latestUsage?.model || '',
      success: !latestUsage?.error,
      error: latestUsage?.error || '',
      totalTokens: Number(latestUsage?.total_tokens || 0),
      promptPreview: latestUsage?.prompt_preview || '',
      responsePreview: latestUsage?.response_preview || '',
      latestUserMessage: latestUserMessage?.content || '',
      latestAssistantMessage: latestAssistantMessage?.content || '',
      runtimeKnowledgeMatches: Array.isArray(runtimeDebug.knowledgeMatches)
        ? runtimeDebug.knowledgeMatches.map(item => ({
            title: item.title,
            score: item.score || 0,
            tags: Array.isArray(item.tags) ? item.tags : [],
            contentPreview: String(item.content || '').slice(0, 160),
            content: String(item.content || ''),
          }))
        : [],
      runtimeToolCalls: Array.isArray(runtimeDebug.toolCalls)
        ? runtimeDebug.toolCalls.map(item => ({
            name: item.name,
            success: item?.result?.success !== false,
            error: item?.result?.error || '',
            argsPreview: JSON.stringify(item?.args || {}).slice(0, 160),
            resultPreview: JSON.stringify(item?.result || {}).slice(0, 200),
            argsRaw: JSON.stringify(item?.args || {}, null, 2),
            resultRaw: JSON.stringify(item?.result || {}, null, 2),
          }))
        : [],
      runtimeStatusHints: Array.isArray(runtimeDebug.statusHints) ? runtimeDebug.statusHints : [],
      runtimeFailureReason: runtimeDebug.failureReason || '',
      runtimeUpdatedAt: runtimeDebug.updatedAt || 0,
      runtimePromptSummary: runtimeDebug.promptSummary || null,
      runtimeDecisionExplanation: runtimeDebug.decisionExplanation || null,
      pokeDebug,
      messageCount: sessionMessages.length,
      requestCount: usageSummary.requestCount,
      errorCount: usageSummary.errorCount,
    };

    return {
      session: {
        sessionId: String(sessionRecord.id),
        type: sessionRecord.type || detectSessionType(sessionRecord.id),
        targetId: sessionRecord.targetId || '',
        createdAt: Number(sessionRecord.createdAt || 0),
        updatedAt: Number(sessionRecord.updatedAt || 0),
        compressedContext: sessionRecord.compressedContext ?? null,
        messageCount: sessionMessages.length,
        userMessageCount: sessionMessages.filter(item => item.role === 'user').length,
        assistantMessageCount: sessionMessages.filter(item => item.role === 'assistant').length,
        participantCount: participantMap.size,
        lastMessageTime: sessionMessages.at(-1)?.timestamp || sessionRecord.updatedAt || 0,
        firstMessageTime: sessionMessages[0]?.timestamp || sessionRecord.createdAt || 0,
        focusUserId: focusUserId || '',
      },
      participants: Array.from(participantMap.values()).sort((a, b) => Number(b.lastTime || 0) - Number(a.lastTime || 0)),
      profiles: linkedProfiles,
      topics: sessionTopics,
      expressions: sessionExpressions,
      usageRequests,
      usageSummary,
      debugDigest,
      alerts,
      affinityHistory,
      messages: recentMessages,
      raw: {
        session: sessionRecord,
        participants: Array.from(participantMap.values()),
        profiles: linkedProfiles,
        topics: sessionTopics,
        expressions: sessionExpressions,
        usageRequests,
        debugDigest,
        affinityHistory,
        messages: recentMessages,
      },
    };
  }

  function buildProfileDetailPayload(sessionId, userId) {
    const chat = getChatSnapshot();
    const webConsole = getWebConsoleConfig();
    const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const profile = profiles.find(item => String(item.sessionId) === String(sessionId) && String(item.userId) === String(userId));
    if (!profile) {
      return null;
    }

    const recentMessages = messages
      .filter(item => String(item.sessionId) === String(sessionId) && String(item.userId) === String(userId))
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .slice(0, webConsole.profileRecentMessagesLimit)
      .map(item => ({
        content: item.content,
        timestamp: item.timestamp,
        messageId: item.messageId,
        groupId: item.groupId,
        userName: item.userName,
      }));

    return {
      profile,
      recentMessages,
    };
  }

  function buildAffinityHistoryPayload(groupId, userId) {
    const webConsole = getWebConsoleConfig();
    const content = readTailText(affinityLogFile, Math.max(50000, webConsole.logTailLength));
    const entries = parseJsonObjects(content)
      .map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(item => String(item.group_id) === String(groupId) && String(item.user_id) === String(userId))
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
      .slice(0, webConsole.affinityHistoryLimit);

    const affinity = getAffinitySnapshot();
    const current = affinity[`${groupId}:${userId}`] || null;

    return {
      current,
      entries,
    };
  }

  function resetAffinityRecord(groupId, userId) {
    const data = getAffinitySnapshot();
    const next = { ...data };
    const targetKey = `${groupId}:${userId}`;
    delete next[targetKey];
    safeWriteJson(affinityFile, next);
  }

  function deleteUserProfile(sessionId, userId) {
    const chat = getChatSnapshot();
    const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
    chat.profiles = profiles.filter(item => !(String(item.sessionId) === String(sessionId) && String(item.userId) === String(userId)));
    safeWriteJson(chatDbFile, chat);
  }

  function resetSessionRecord(sessionId) {
    const chat = getChatSnapshot();
    const targetId = String(sessionId || '');
    if (!targetId) {
      throw new Error('Missing sessionId');
    }
    chat.sessions = (chat.sessions || []).filter(item => String(item.id) !== targetId);
    chat.messages = (chat.messages || []).filter(item => String(item.sessionId) !== targetId);
    chat.topics = (chat.topics || []).filter(item => String(item.sessionId) !== targetId);
    chat.expressions = (chat.expressions || []).filter(item => String(item.sessionId) !== targetId);
    chat.profiles = (chat.profiles || []).filter(item => String(item.sessionId) !== targetId);
    chat.images = (chat.images || []).filter(item => String(item.sessionId) !== targetId);
    safeWriteJson(chatDbFile, chat);
  }

  function resetSessionMessagesOnly(sessionId) {
    const chat = getChatSnapshot();
    const targetId = String(sessionId || '');
    if (!targetId) {
      throw new Error('Missing sessionId');
    }
    chat.messages = (chat.messages || []).filter(item => String(item.sessionId) !== targetId);
    chat.sessions = (chat.sessions || []).map(item => String(item.id) === targetId
      ? {
          ...item,
          updatedAt: Date.now(),
          compressedContext: null,
        }
      : item);
    safeWriteJson(chatDbFile, chat);
  }

  return {
    buildAffinityListPayload,
    buildProfilesPayload,
    buildSessionListPayload,
    buildSessionDebugPayload,
    buildProfileDetailPayload,
    buildAffinityHistoryPayload,
    resetAffinityRecord,
    deleteUserProfile,
    resetSessionRecord,
    resetSessionMessagesOnly,
  };
}
