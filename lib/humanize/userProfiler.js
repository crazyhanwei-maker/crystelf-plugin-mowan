export class UserProfiler {
  constructor(ai, config, db) {
    this.ai = ai;
    this.config = config;
    this.db = db;
    this.pendingMessages = new Map();
  }

  async onMessage(sessionId, message) {
    if (!this.config?.userProfile?.enabled) return;
    if (message.role !== 'user') return;
    if (!message.userId) return;
    if (!message.content || message.content.length < 4) return;

    const pendingByUser = this.pendingMessages.get(sessionId) ?? new Map();
    const userPending = pendingByUser.get(message.userId) ?? [];
    userPending.push(message);
    pendingByUser.set(message.userId, userPending);
    this.pendingMessages.set(sessionId, pendingByUser);

    const minMessages = this.config?.userProfile?.minMessagesToBuild ?? 12;
    if (userPending.length >= minMessages) {
      pendingByUser.set(message.userId, []);
      this.learn(sessionId, message.userId, userPending).catch(err =>
        logger.warn(`[UserProfiler] Learning failed: ${err}`)
      );
    }
  }

  getUserProfileContext(sessionId, userId, userName = '该用户') {
    if (!this.config?.userProfile?.enabled || this.config?.userProfile?.injectIntoPrompt === false) {
      return '';
    }

    const profile = this.db.getUserProfile(sessionId, userId);
    if (!profile) return '';

    const lines = [`## User Profile`, `Target user: ${userName}`];

    if (profile.summary) {
      lines.push(`Summary: ${profile.summary}`);
    }
    if (Array.isArray(profile.traits) && profile.traits.length > 0) {
      lines.push(`Traits: ${profile.traits.join('、')}`);
    }
    if (Array.isArray(profile.speakingStyle) && profile.speakingStyle.length > 0) {
      lines.push(`Speaking style: ${profile.speakingStyle.join('、')}`);
    }
    if (Array.isArray(profile.interactionPreferences) && profile.interactionPreferences.length > 0) {
      lines.push(`Interaction preferences: ${profile.interactionPreferences.join('、')}`);
    }
    if (Array.isArray(profile.notableTopics) && profile.notableTopics.length > 0) {
      lines.push(`Notable topics: ${profile.notableTopics.join('、')}`);
    }

    lines.push('Use this only as a soft conversational reference. Do not directly mention profile labels, internal analysis, or profiling behavior.');
    return lines.join('\n');
  }

  getUserProfile(sessionId, userId) {
    return this.db.getUserProfile(sessionId, userId);
  }

  async learn(sessionId, userId, messages) {
    const validMessages = messages.filter(msg => msg?.content && msg?.userId);
    if (validMessages.length < 3) return;

    const userName = validMessages[0].userName || `User${userId}`;
    const msgTexts = validMessages.map(m => m.content).join('\n');
    const profileMaxItems = this.config?.userProfile?.maxProfileItems ?? 4;

    try {
      const content = await this.ai.generateText({
        prompt: `请基于下面这位群成员的聊天消息，为其生成一份简短用户画像。

用户：${userName}
消息：
${msgTexts}

请提取：
- summary：一句话概括这个人的聊天画像
- traits：${profileMaxItems}个以内性格/互动特征
- speakingStyle：${profileMaxItems}个以内说话风格特征
- interactionPreferences：${profileMaxItems}个以内互动偏好
- notableTopics：${profileMaxItems}个以内常聊或明显感兴趣的话题
- confidence：高 / 中 / 低

要求：
1. 必须基于消息内容，不要编造隐私信息。
2. 如果证据不足，字段可以留空数组，confidence 降低。
3. 输出语言与消息语言一致。
4. 严格输出 JSON，不要带解释。

输出格式：
{"summary":"...","traits":["..."],"speakingStyle":["..."],"interactionPreferences":["..."],"notableTopics":["..."],"confidence":"中"}`,
        messages: [],
        model: this.config.workingModel || this.config.modelType || this.config.model,
        temperature: 0.2,
        max_tokens: 600,
      });

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]);
      const now = Date.now();
      this.db.saveUserProfile({
        sessionId,
        userId,
        userName,
        summary: String(parsed.summary || '').trim(),
        traits: Array.isArray(parsed.traits) ? parsed.traits.slice(0, profileMaxItems).map(item => String(item).trim()).filter(Boolean) : [],
        speakingStyle: Array.isArray(parsed.speakingStyle) ? parsed.speakingStyle.slice(0, profileMaxItems).map(item => String(item).trim()).filter(Boolean) : [],
        interactionPreferences: Array.isArray(parsed.interactionPreferences) ? parsed.interactionPreferences.slice(0, profileMaxItems).map(item => String(item).trim()).filter(Boolean) : [],
        notableTopics: Array.isArray(parsed.notableTopics) ? parsed.notableTopics.slice(0, profileMaxItems).map(item => String(item).trim()).filter(Boolean) : [],
        confidence: ['高', '中', '低'].includes(String(parsed.confidence || '').trim()) ? String(parsed.confidence).trim() : '中',
        sourceMessageCount: validMessages.length,
        createdAt: now,
        updatedAt: now,
      });

      logger.info(`[UserProfiler] Updated profile for ${userName}`);
    } catch (err) {
      logger.warn(`[UserProfiler] Analysis failed: ${err}`);
    }
  }
}
