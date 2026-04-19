const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

export class MemeTimingController {
  constructor(config) {
    this.config = {
      minIntervalMs: 30000,        // 同一群聊最小间隔 30 秒
      maxMemesPerSession: 5,       // 单个会话最多表情数
      seriousTopicThreshold: 0.7,  // 严肃话题阈值
      cooldownAfterSerious: 60000, // 严肃话题后冷却 60 秒
      ...config,
    };
    this.lastMemeTime = new Map();     // groupId -> timestamp
    this.sessionMemeCount = new Map(); // sessionId -> count
    this.seriousTopicUntil = new Map(); // groupId -> timestamp
  }

  shouldSendMeme(sessionId, groupId, messageText, chatHistory) {
    const now = Date.now();

    // 1. 检查是否超过会话表情上限
    const currentCount = this.sessionMemeCount.get(sessionId) || 0;
    if (currentCount >= this.config.maxMemesPerSession) {
      return { allow: false, reason: '会话表情已达上限' };
    }

    // 2. 检查群聊冷却时间
    if (groupId) {
      const lastTime = this.lastMemeTime.get(groupId);
      if (lastTime && (now - lastTime) < this.config.minIntervalMs) {
        return { 
          allow: false, 
          reason: `群聊表情冷却中 (${Math.ceil((this.config.minIntervalMs - (now - lastTime)) / 1000)}秒)` 
        };
      }
    }

    // 3. 检查是否在严肃话题冷却期
    if (groupId) {
      const seriousUntil = this.seriousTopicUntil.get(groupId);
      if (seriousUntil && now < seriousUntil) {
        return { 
          allow: false, 
          reason: `严肃话题冷却中 (${Math.ceil((seriousUntil - now) / 1000)}秒)` 
        };
      }
    }

    // 4. 检测当前是否为严肃话题
    const isSerious = this.detectSeriousTopic(messageText, chatHistory);
    if (isSerious) {
      if (groupId) {
        this.seriousTopicUntil.set(groupId, now + this.config.cooldownAfterSerious);
      }
      return { allow: false, reason: '检测到严肃话题' };
    }

    return { allow: true };
  }

  detectSeriousTopic(messageText, chatHistory) {
    const text = String(messageText || '').toLowerCase();
    
    // 严肃关键词
    const seriousKeywords = [
      '投诉', '举报', '违规', '封禁', '踢人', '管理', '群主',
      '法律', '律师', '警察', '报警', '法院', '起诉',
      '自杀', '自残', '抑郁', '死亡', '去世',
      '诈骗', '骗子', '被骗', '盗号', '黑客',
    ];
    
    // 检查当前消息
    if (seriousKeywords.some(kw => text.includes(kw))) {
      return true;
    }
    
    // 检查最近 5 条消息的氛围
    if (chatHistory && chatHistory.length > 0) {
      const recentMessages = chatHistory.slice(-5);
      const seriousCount = recentMessages.filter(msg => {
        const msgText = String(msg.content || '').toLowerCase();
        return seriousKeywords.some(kw => msgText.includes(kw));
      }).length;
      
      // 如果最近 5 条有 2 条以上含严肃内容，判定为严肃氛围
      if (seriousCount >= 2) {
        return true;
      }
    }
    
    return false;
  }

  recordMemeSent(sessionId, groupId) {
    const now = Date.now();
    
    // 更新会话计数
    const currentCount = this.sessionMemeCount.get(sessionId) || 0;
    this.sessionMemeCount.set(sessionId, currentCount + 1);
    
    // 更新群聊最后发送时间
    if (groupId) {
      this.lastMemeTime.set(groupId, now);
    }
    
    logger.info(`[meme-timing] Meme sent | session: ${sessionId}, count: ${currentCount + 1}, group: ${groupId || 'private'}`);
  }

  getStats(sessionId, groupId) {
    const now = Date.now();
    return {
      sessionCount: this.sessionMemeCount.get(sessionId) || 0,
      sessionLimit: this.config.maxMemesPerSession,
      lastMemeAgo: groupId ? (now - (this.lastMemeTime.get(groupId) || 0)) : null,
      cooldownRemaining: groupId ? Math.max(0, this.config.minIntervalMs - (now - (this.lastMemeTime.get(groupId) || 0))) : null,
      inSeriousCooldown: groupId ? (now < (this.seriousTopicUntil.get(groupId) || 0)) : false,
    };
  }

  resetSession(sessionId) {
    this.sessionMemeCount.delete(sessionId);
  }
}
