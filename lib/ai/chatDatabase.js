import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

function normalizeRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

function sortByTimeDesc(a, b) {
  if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
  return (b.id || 0) - (a.id || 0);
}

function sortByCreatedDesc(a, b) {
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return (b.id || 0) - (a.id || 0);
}

function sortByUpdatedDesc(a, b) {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
  return (b.id || 0) - (a.id || 0);
}

const MAX_MESSAGES_PER_SESSION = 200;
const MAX_TOPICS_PER_SESSION = 20;
const MAX_SESSIONS = 500;

function trimMessages(messages) {
  const grouped = new Map();
  for (const message of messages) {
    const list = grouped.get(message.sessionId) || [];
    list.push(message);
    grouped.set(message.sessionId, list);
  }

  const trimmed = [];
  for (const list of grouped.values()) {
    trimmed.push(
      ...list
        .sort(sortByTimeDesc)
        .slice(0, MAX_MESSAGES_PER_SESSION)
    );
  }

  return trimmed.sort((a, b) => (a.id || 0) - (b.id || 0));
}

function trimTopics(topics) {
  const grouped = new Map();
  for (const topic of topics) {
    const list = grouped.get(topic.sessionId) || [];
    list.push(topic);
    grouped.set(topic.sessionId, list);
  }

  const trimmed = [];
  for (const list of grouped.values()) {
    trimmed.push(
      ...list
        .sort(sortByUpdatedDesc)
        .slice(0, MAX_TOPICS_PER_SESSION)
    );
  }

  return trimmed.sort((a, b) => (a.id || 0) - (b.id || 0));
}

function trimSessions(sessions) {
  return sessions
    .sort(sortByUpdatedDesc)
    .slice(0, MAX_SESSIONS);
}

function compactData(data) {
  data.sessions = trimSessions(data.sessions || []);
  data.messages = trimMessages(data.messages || []);
  data.topics = trimTopics(data.topics || []);
  return data;
}

export async function initDatabase() {
  const dbDir = path.join(process.cwd(), 'data', 'chat');
  await fsp.mkdir(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'chat.json');
  const initialData = {
    counters: {
      messages: 0,
      topics: 0,
      expressions: 0,
      profiles: 0,
      images: 0,
    },
    sessions: [],
    messages: [],
    topics: [],
    expressions: [],
    profiles: [],
    images: [],
  };

  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2), 'utf8');
  }

  const loadDb = () => {
    try {
      const raw = fs.readFileSync(dbPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        counters: {
          messages: parsed?.counters?.messages || 0,
          topics: parsed?.counters?.topics || 0,
          expressions: parsed?.counters?.expressions || 0,
          profiles: parsed?.counters?.profiles || 0,
          images: parsed?.counters?.images || 0,
        },
        sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
        messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
        topics: Array.isArray(parsed?.topics) ? parsed.topics : [],
        expressions: Array.isArray(parsed?.expressions) ? parsed.expressions : [],
        profiles: Array.isArray(parsed?.profiles) ? parsed.profiles : [],
        images: Array.isArray(parsed?.images) ? parsed.images : [],
      };
    } catch {
      fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2), 'utf8');
      return normalizeRecord(initialData);
    }
  };

  const saveDb = (data) => {
    compactData(data);
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  };

  const nextId = (data, key) => {
    data.counters[key] = (data.counters[key] || 0) + 1;
    return data.counters[key];
  };

  return {
    saveSession(meta) {
      const data = loadDb();
      const index = data.sessions.findIndex(session => session.id === meta.id);
      const record = {
        id: meta.id,
        type: meta.type,
        targetId: meta.targetId,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        compressedContext: meta.compressedContext ?? null,
      };

      if (index >= 0) {
        const existing = data.sessions[index];
        data.sessions[index] = {
          ...existing,
          ...record,
          compressedContext: record.compressedContext ?? existing.compressedContext ?? null,
        };
      } else {
        data.sessions.push(record);
      }

      saveDb(data);
    },

    getSession(id) {
      const data = loadDb();
      const session = data.sessions.find(item => item.id === id);
      return session ? normalizeRecord(session) : null;
    },

    saveMessage(msg) {
      const data = loadDb();
      const record = {
        id: nextId(data, 'messages'),
        sessionId: msg.sessionId,
        role: msg.role,
        content: msg.content,
        userId: msg.userId ?? null,
        userName: msg.userName ?? null,
        userRole: msg.userRole ?? null,
        userTitle: msg.userTitle ?? null,
        groupId: msg.groupId ?? null,
        groupName: msg.groupName ?? null,
        timestamp: msg.timestamp,
        messageId: msg.messageId ?? null,
      };
      data.messages.push(record);
      saveDb(data);
    },

    getMessages(sessionId, limit = 30) {
      const data = loadDb();
      return data.messages
        .filter(message => message.sessionId === sessionId)
        .sort(sortByTimeDesc)
        .slice(0, limit)
        .reverse()
        .map(normalizeRecord);
    },

    getBotMessages(groupId, limit = 50) {
      const data = loadDb();
      // groupId 落盘为数字、调用方可能传字符串；按字符串比较与同文件其他查询方法一致
      const normalizedGroupId = String(groupId ?? '');
      return data.messages
        .filter(message => message.groupId != null && String(message.groupId) === normalizedGroupId && message.role === 'assistant')
        .sort(sortByTimeDesc)
        .slice(0, limit)
        .reverse()
        .map(normalizeRecord);
    },

    getMessagesByUser(userId, sessionId, limit = 20) {
      const data = loadDb();
      const normalizedUserId = String(userId);
      const normalizedSessionId = sessionId ? String(sessionId) : '';
      return data.messages
        .filter(message => String(message.userId) === normalizedUserId && (!normalizedSessionId || String(message.sessionId) === normalizedSessionId))
        .sort(sortByTimeDesc)
        .slice(0, limit)
        .reverse()
        .map(normalizeRecord);
    },

    deleteBotMessages(sessionId) {
      const data = loadDb();
      data.messages = data.messages.filter(
        message => !(message.sessionId === sessionId && message.role === 'assistant')
      );
      saveDb(data);
    },

    clearSession(sessionId) {
      const data = loadDb();
      data.sessions = data.sessions.filter(session => session.id !== sessionId);
      data.messages = data.messages.filter(message => message.sessionId !== sessionId);
      data.topics = data.topics.filter(topic => topic.sessionId !== sessionId);
      data.expressions = data.expressions.filter(expression => expression.sessionId !== sessionId);
      data.profiles = data.profiles.filter(profile => profile.sessionId !== sessionId);
      data.images = data.images.filter(image => image.sessionId !== sessionId);
      saveDb(data);
    },

    searchMessages(sessionId, keyword, limit = 20) {
      const data = loadDb();
      return data.messages
        .filter(message => message.sessionId === sessionId && String(message.content).includes(keyword))
        .sort(sortByTimeDesc)
        .slice(0, limit)
        .reverse()
        .map(normalizeRecord);
    },

    saveTopic(topic) {
      const data = loadDb();
      const id = nextId(data, 'topics');
      data.topics.push({
        id,
        sessionId: topic.sessionId,
        title: topic.title,
        keywords: topic.keywords,
        summary: topic.summary,
        messageCount: topic.messageCount,
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt,
      });
      saveDb(data);
      return id;
    },

    getTopics(sessionId, limit = 10) {
      const data = loadDb();
      return data.topics
        .filter(topic => topic.sessionId === sessionId)
        .sort(sortByUpdatedDesc)
        .slice(0, limit)
        .map(normalizeRecord);
    },

    updateTopic(id, updates) {
      const data = loadDb();
      const index = data.topics.findIndex(topic => topic.id === id);
      if (index < 0) return;
      data.topics[index] = {
        ...data.topics[index],
        ...updates,
      };
      saveDb(data);
    },

    saveExpression(expr) {
      const data = loadDb();
      data.expressions.push({
        id: nextId(data, 'expressions'),
        sessionId: expr.sessionId,
        userId: expr.userId,
        userName: expr.userName,
        situation: expr.situation,
        style: expr.style,
        example: expr.example,
        createdAt: expr.createdAt,
      });
      saveDb(data);
    },

    getExpressions(sessionId, limit = 50) {
      const data = loadDb();
      return data.expressions
        .filter(expression => expression.sessionId === sessionId)
        .sort(sortByCreatedDesc)
        .slice(0, limit)
        .map(normalizeRecord);
    },

    getExpressionCount(sessionId) {
      const data = loadDb();
      return data.expressions.filter(expression => expression.sessionId === sessionId).length;
    },

    deleteOldestExpressions(sessionId, keepCount) {
      const data = loadDb();
      const keepIds = new Set(
        data.expressions
          .filter(expression => expression.sessionId === sessionId)
          .sort(sortByCreatedDesc)
          .slice(0, keepCount)
          .map(expression => expression.id)
      );

      data.expressions = data.expressions.filter(
        expression => expression.sessionId !== sessionId || keepIds.has(expression.id)
      );
      saveDb(data);
    },

    saveUserProfile(profile) {
      const data = loadDb();
      const index = data.profiles.findIndex(item => item.sessionId === profile.sessionId && item.userId === profile.userId);
      const baseRecord = {
        sessionId: profile.sessionId,
        userId: profile.userId,
        userName: profile.userName ?? null,
        summary: profile.summary,
        traits: Array.isArray(profile.traits) ? profile.traits : [],
        speakingStyle: Array.isArray(profile.speakingStyle) ? profile.speakingStyle : [],
        interactionPreferences: Array.isArray(profile.interactionPreferences) ? profile.interactionPreferences : [],
        notableTopics: Array.isArray(profile.notableTopics) ? profile.notableTopics : [],
        confidence: profile.confidence ?? '中',
        sourceMessageCount: profile.sourceMessageCount ?? 0,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      };

      if (index >= 0) {
        const existing = data.profiles[index];
        data.profiles[index] = {
          ...existing,
          ...baseRecord,
          id: existing.id,
          createdAt: existing.createdAt || baseRecord.createdAt,
        };
      } else {
        data.profiles.push({
          id: nextId(data, 'profiles'),
          ...baseRecord,
        });
      }

      saveDb(data);
    },

    getUserProfile(sessionId, userId) {
      const data = loadDb();
      const profile = data.profiles.find(item => item.sessionId === sessionId && String(item.userId) === String(userId));
      return profile ? normalizeRecord(profile) : null;
    },

    getProfiles(sessionId, limit = 50) {
      const data = loadDb();
      return data.profiles
        .filter(profile => profile.sessionId === sessionId)
        .sort(sortByUpdatedDesc)
        .slice(0, limit)
        .map(normalizeRecord);
    },

    close() {
      return;
    },
  };
}
