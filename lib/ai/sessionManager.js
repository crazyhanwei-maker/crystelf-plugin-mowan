export class SessionManager {
  constructor(db, maxSessions = 100) {
    this.db = db;
    this.maxSessions = maxSessions;
    this.activeSessions = new Map();
  }

  getOrCreate(sessionId, type, targetId) {
    let session = this.activeSessions.get(sessionId);
    if (!session) {
      const existing = this.db.getSession(sessionId);
      if (existing) {
        session = existing;
      } else {
        const now = Date.now();
        session = {
          id: sessionId,
          type,
          targetId,
          createdAt: now,
          updatedAt: now,
          compressedContext: null,
        };
        this.db.saveSession(session);
      }
      this.activeSessions.set(sessionId, session);
    }
    return session;
  }

  touch(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.updatedAt = Date.now();
      this.db.saveSession(session);
    }
  }

  getChatHistory(sessionId, limit = 30) {
    return this.db.getMessages(sessionId, limit);
  }

  addMessage(sessionId, message) {
    this.db.saveMessage({
      sessionId,
      ...message,
      timestamp: message.timestamp || Date.now(),
    });
  }

  resetBotMessages(sessionId) {
    this.db.deleteBotMessages(sessionId);
  }

  clearSession(sessionId) {
    this.activeSessions.delete(sessionId);
    this.db.clearSession(sessionId);
  }

  cleanTimeoutSessions(timeoutMs = 3600000) {
    const now = Date.now();
    for (const [id, session] of this.activeSessions) {
      if (now - session.updatedAt > timeoutMs) {
        this.activeSessions.delete(id);
      }
    }
  }
}

export class RateLimiter {
  constructor(options = {}) {
    this.dynamicDelay = options.dynamicDelay || {};
    this.groupInteractions = new Map();
    this.userRecords = new Map();
  }

  canProcess(userId, groupId) {
    const key = `${userId}:${groupId}`;
    const record = this.userRecords.get(key);
    if (!record) return true;

    const now = Date.now();
    const minInterval = 1000;
    return now - record.lastTime > minInterval;
  }

  record(userId, groupId, text) {
    const key = `${userId}:${groupId}`;
    this.userRecords.set(key, {
      lastTime: Date.now(),
      text,
    });
  }

  recordInteraction(groupId, userId) {
    const key = `${groupId}`;
    const interactions = this.groupInteractions.get(key) || [];
    interactions.push({ userId, time: Date.now() });
    
    const windowMs = this.dynamicDelay.interactionWindowMs || 60000;
    const cutoff = Date.now() - windowMs;
    const filtered = interactions.filter(i => i.time > cutoff);
    this.groupInteractions.set(key, filtered);
  }

  getInteractionCount(groupId) {
    const interactions = this.groupInteractions.get(groupId) || [];
    const windowMs = this.dynamicDelay.interactionWindowMs || 60000;
    const cutoff = Date.now() - windowMs;
    return interactions.filter(i => i.time > cutoff).length;
  }

  getDelayInfo(groupId) {
    if (!this.dynamicDelay.enabled) {
      return { shouldDelay: false };
    }

    const interactionCount = this.getInteractionCount(groupId);
    const baseDelayMs = this.dynamicDelay.baseDelayMs || 3000;
    const maxDelayMs = this.dynamicDelay.maxDelayMs || 15000;

    if (interactionCount >= 3) {
      const delayMs = Math.min(baseDelayMs * interactionCount, maxDelayMs);
      return { shouldDelay: true, delayMs };
    }

    return { shouldDelay: false };
  }

  clearGroupInteractions(groupId) {
    this.groupInteractions.delete(groupId);
  }

  cleanup(maxAgeMs = 300000) {
    const now = Date.now();

    for (const [key, record] of this.userRecords) {
      if (!record?.lastTime || now - record.lastTime > maxAgeMs) {
        this.userRecords.delete(key);
      }
    }

    const windowMs = this.dynamicDelay.interactionWindowMs || 60000;
    for (const [key, interactions] of this.groupInteractions) {
      const filtered = (interactions || []).filter(i => now - i.time <= Math.max(windowMs, maxAgeMs));
      if (filtered.length > 0) {
        this.groupInteractions.set(key, filtered);
      } else {
        this.groupInteractions.delete(key);
      }
    }
  }

  dispose() {
    this.groupInteractions.clear();
    this.userRecords.clear();
  }
}

export class MessageQueueManager {
  constructor() {
    this.queues = new Map();
    this.activeTargets = new Map();
  }

  enqueue(sessionId, event, content) {
    const queue = this.queues.get(sessionId) || [];
    if (queue.length >= 20) {
      queue.shift();
    }
    queue.push({ event, content, timestamp: Date.now() });
    this.queues.set(sessionId, queue);
  }

  getQueue(sessionId) {
    return this.queues.get(sessionId) || [];
  }

  clearQueue(sessionId) {
    this.queues.delete(sessionId);
  }

  getQueueLength(sessionId) {
    return this.queues.get(sessionId)?.length || 0;
  }

  setActiveTarget(sessionId, target) {
    this.activeTargets.set(sessionId, target);
  }

  getActiveTarget(sessionId) {
    return this.activeTargets.get(sessionId);
  }

  clearActiveTarget(sessionId) {
    this.activeTargets.delete(sessionId);
  }
}

export class SkillSessionManager {
  constructor() {
    this.sessions = new Map();
    this.EXPIRY_MS = 3600000;
  }

  loadSkill(sessionId, skillName, tools, metadata = {}) {
    const sessionSkills = this.sessions.get(sessionId) || new Map();
    const now = Date.now();
    sessionSkills.set(skillName, {
      skillName,
      description: String(metadata?.description || '').trim(),
      tools: new Map(tools.map(t => [t.name, t])),
      loadedAt: now,
      expiresAt: now + this.EXPIRY_MS,
    });
    this.sessions.set(sessionId, sessionSkills);
    return sessionSkills.get(skillName);
  }

  unloadSkill(sessionId, skillName) {
    const sessionSkills = this.sessions.get(sessionId);
    if (!sessionSkills) return false;
    return sessionSkills.delete(skillName);
  }

  getSkillNames(sessionId) {
    const sessionSkills = this.sessions.get(sessionId);
    if (!sessionSkills) return [];
    return Array.from(sessionSkills.keys());
  }

  getTools(sessionId) {
    const sessionSkills = this.sessions.get(sessionId);
    if (!sessionSkills) return new Map();

    const allTools = new Map();
    const now = Date.now();
    for (const session of sessionSkills.values()) {
      if (now < session.expiresAt) {
        for (const [, tool] of session.tools) {
          const exportName = tool?.name || '';
          if (!exportName) continue;
          allTools.set(exportName, tool);
        }
      }
    }
    return allTools;
  }

  getActiveSkillsInfo(sessionId) {
    const sessionSkills = this.sessions.get(sessionId);
    if (!sessionSkills || sessionSkills.size === 0) return '';

    const now = Date.now();
    const lines = [
      '## Active Skills',
      '- Prefer a matching active skill over generic search_web when the user is asking for structured domain data.',
      '- Use search_web for broader real-time news, announcements, documentation, or when no active skill clearly fits.',
    ];
    for (const [name, session] of sessionSkills) {
      if (now < session.expiresAt) {
        const skillSummary = summarizeSkillText(session.description || '', 120);
        lines.push(`- ${name}: ${skillSummary || 'No extra description.'}`);
        for (const tool of session.tools.values()) {
          const toolName = tool.displayName || tool.name;
          const toolSummary = summarizeSkillText(tool.description || '', 140);
          lines.push(`  ${toolName}: ${toolSummary || 'No extra description.'}`);
        }
      }
    }
    return lines.length > 3 ? lines.join('\n') : '';
  }

  cleanup() {
    const now = Date.now();
    for (const [sessionId, sessionSkills] of this.sessions) {
      for (const [name, session] of sessionSkills) {
        if (now >= session.expiresAt) {
          sessionSkills.delete(name);
        }
      }
      if (sessionSkills.size === 0) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

function summarizeSkillText(value, maxLength = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export default SessionManager;
