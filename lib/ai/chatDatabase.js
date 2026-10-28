import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { writeJsonAtomic, flushJsonAtomic } from '../utils/atomicStore.js';

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

// 记忆条目兼容旧数据：老记录只有 content/createAt，读取时补齐新字段
function normalizeMemoryRecord(memory = {}) {
  const record = normalizeRecord(memory);
  const createdAt = Number(record.createdAt) || Date.now();
  return {
    id: Number(record.id) || 0,
    sessionId: String(record.sessionId || ''),
    content: String(record.content || ''),
    userId: record.userId ?? null,
    userName: record.userName ?? null,
    createdAt,
    updatedAt: Number(record.updatedAt) || createdAt,
    kind: String(record.kind || 'fact'),
    tags: Array.isArray(record.tags) ? record.tags.map(tag => String(tag)).filter(Boolean).slice(0, 20) : [],
    importance: Math.max(1, Math.min(5, Number(record.importance) || 3)),
    source: String(record.source || 'distiller'),
    disabled: record.disabled === true,
    accessCount: Math.max(0, Number(record.accessCount) || 0),
    lastAccessedAt: Number(record.lastAccessedAt) || 0,
  };
}

const MAX_MESSAGES_PER_SESSION = 200;
const MAX_TOPICS_PER_SESSION = 20;
const MAX_SESSIONS = 500;
const MAX_MEMORIES_PER_SESSION = 60;

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

function trimMemories(memories) {
  const grouped = new Map();
  for (const memory of memories) {
    const list = grouped.get(memory.sessionId) || [];
    list.push(memory);
    grouped.set(memory.sessionId, list);
  }

  const trimmed = [];
  for (const list of grouped.values()) {
    trimmed.push(
      ...list
        .sort((a, b) => (b.id || 0) - (a.id || 0))
        .slice(0, MAX_MEMORIES_PER_SESSION)
    );
  }

  return trimmed.sort((a, b) => (a.id || 0) - (b.id || 0));
}

function compactData(data) {
  data.sessions = trimSessions(data.sessions || []);
  data.messages = trimMessages(data.messages || []);
  data.topics = trimTopics(data.topics || []);
  data.memories = trimMemories(data.memories || []);
  return data;
}

// 单例：聊天 AI 与控制台必须共用同一份内存状态，否则各自的 dbState 缓存会互相覆盖
let sharedDatabase = null;
let sharedDatabasePromise = null;

export async function initDatabase() {
  if (sharedDatabase) return sharedDatabase;
  if (!sharedDatabasePromise) {
    sharedDatabasePromise = createDatabaseInstance().finally(() => {
      sharedDatabasePromise = null;
    });
  }
  return await sharedDatabasePromise;
}

async function createDatabaseInstance() {
  const dbDir = path.join(process.cwd(), 'data', 'chat');
  await fsp.mkdir(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'chat.json');
  const initialData = {
    counters: {
      messages: 0,
      topics: 0,
      expressions: 0,
      profiles: 0,
      memories: 0,
      images: 0,
    },
    sessions: [],
    messages: [],
    topics: [],
    expressions: [],
    profiles: [],
    images: [],
    memories: [],
    memoryCursors: {},
  };

  if (!fs.existsSync(dbPath)) {
    writeJsonAtomic(dbPath, initialData, { pretty: true });
  }

  // 常驻内存状态：防抖落盘期间磁盘是旧的，后续读必须走内存，否则丢更新
  let dbState = null;

  const loadDb = () => {
    if (dbState) return normalizeRecord(dbState);
    try {
      const raw = fs.readFileSync(dbPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        counters: {
          messages: parsed?.counters?.messages || 0,
          topics: parsed?.counters?.topics || 0,
          expressions: parsed?.counters?.expressions || 0,
          profiles: parsed?.counters?.profiles || 0,
          memories: parsed?.counters?.memories || 0,
          images: parsed?.counters?.images || 0,
        },
        sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
        messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
        topics: Array.isArray(parsed?.topics) ? parsed.topics : [],
        expressions: Array.isArray(parsed?.expressions) ? parsed.expressions : [],
        profiles: Array.isArray(parsed?.profiles) ? parsed.profiles : [],
        images: Array.isArray(parsed?.images) ? parsed.images : [],
        memories: Array.isArray(parsed?.memories) ? parsed.memories : [],
        memoryCursors: parsed?.memoryCursors && typeof parsed.memoryCursors === 'object' ? parsed.memoryCursors : {},
      };
      dbState = normalizeRecord(parsed);
      return normalizeRecord(dbState);
    } catch (error) {
      // 库文件损坏时先留档再重建，避免直接覆盖丢失全部聊天记忆
      try {
        fs.renameSync(dbPath, `${dbPath}.corrupt-${Date.now()}`);
      } catch {
        // 原文件已不存在等情况忽略
      }
      (globalThis.logger?.warn || console.warn).call(globalThis.logger || console, `[chat-database] 库文件解析失败已重建: ${error.message}`);
      writeJsonAtomic(dbPath, initialData, { pretty: true });
      dbState = normalizeRecord(initialData);
      return normalizeRecord(dbState);
    }
  };

  // 聊天消息高频到达：500ms 防抖合并全量落盘，紧凑 JSON 体积约省一半
  const saveDb = (data) => {
    compactData(data);
    dbState = normalizeRecord(data);
    writeJsonAtomic(dbPath, dbState, { debounceMs: 500 });
  };

  const nextId = (data, key) => {
    data.counters[key] = (data.counters[key] || 0) + 1;
    return data.counters[key];
  };

  sharedDatabase = {
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

    listSessions(limit = 200) {
      const data = loadDb();
      return (data.sessions || [])
        .slice()
        .sort(sortByUpdatedDesc)
        .slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)))
        .map(normalizeRecord);
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

    getMemories(sessionId, limit = 20, options = {}) {
      const data = loadDb();
      const includeDisabled = options?.includeDisabled === true;
      const userId = options?.userId;
      return (data.memories || [])
        .map(normalizeMemoryRecord)
        .filter(memory => memory.sessionId === sessionId)
        .filter(memory => includeDisabled || !memory.disabled)
        .filter(memory => userId == null || memory.userId == null || String(memory.userId) === String(userId))
        .sort((a, b) => (b.id || 0) - (a.id || 0))
        .slice(0, limit);
    },

    listMemories(filters = {}) {
      const data = loadDb();
      const sessionId = String(filters.sessionId || '').trim();
      const userId = filters.userId == null || filters.userId === '' ? null : String(filters.userId);
      const query = String(filters.query || '').trim().toLowerCase();
      const kind = String(filters.kind || '').trim();
      const source = String(filters.source || '').trim();
      const includeDisabled = filters.includeDisabled === true;
      const limit = Math.max(1, Math.min(2000, Number(filters.limit) || 500));
      return (data.memories || [])
        .map(normalizeMemoryRecord)
        .filter(memory => !sessionId || memory.sessionId === sessionId)
        .filter(memory => includeDisabled || !memory.disabled)
        .filter(memory => userId == null || String(memory.userId || '') === userId)
        .filter(memory => !kind || memory.kind === kind)
        .filter(memory => !source || memory.source === source)
        .filter(memory => {
          if (!query) return true;
          const haystack = `${memory.content} ${memory.userName || ''} ${memory.userId || ''} ${memory.tags.join(' ')}`.toLowerCase();
          return haystack.includes(query);
        })
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, limit);
    },

    getMemoryStats() {
      const data = loadDb();
      const items = (data.memories || []).map(normalizeMemoryRecord);
      const byKind = {};
      const bySource = {};
      let disabled = 0;
      for (const item of items) {
        byKind[item.kind] = (byKind[item.kind] || 0) + 1;
        bySource[item.source] = (bySource[item.source] || 0) + 1;
        if (item.disabled) disabled += 1;
      }
      return { total: items.length, disabled, byKind, bySource };
    },

    getMemoryById(id) {
      const data = loadDb();
      const memory = (data.memories || []).find(item => Number(item.id) === Number(id));
      return memory ? normalizeMemoryRecord(memory) : null;
    },

    addMemory(entry = {}) {
      const data = loadDb();
      const now = Date.now();
      let nextIdValue = data.counters.memories || 0;
      const record = normalizeMemoryRecord({
        id: ++nextIdValue,
        sessionId: entry.sessionId,
        content: entry.content,
        userId: entry.userId ?? null,
        userName: entry.userName ?? null,
        createdAt: entry.createdAt || now,
        updatedAt: now,
        kind: entry.kind || 'fact',
        tags: entry.tags || [],
        importance: entry.importance ?? 3,
        source: entry.source || 'manual',
        disabled: entry.disabled === true,
      });
      data.memories.push(record);
      data.counters.memories = nextIdValue;
      saveDb(data);
      return normalizeMemoryRecord(record);
    },

    updateMemory(id, patch = {}) {
      const data = loadDb();
      const index = (data.memories || []).findIndex(item => Number(item.id) === Number(id));
      if (index < 0) return null;
      const current = normalizeMemoryRecord(data.memories[index]);
      const next = normalizeMemoryRecord({
        ...current,
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.userId !== undefined ? { userId: patch.userId } : {}),
        ...(patch.userName !== undefined ? { userName: patch.userName } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.importance !== undefined ? { importance: patch.importance } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.disabled !== undefined ? { disabled: patch.disabled === true } : {}),
        updatedAt: Date.now(),
      });
      data.memories[index] = next;
      saveDb(data);
      return normalizeMemoryRecord(next);
    },

    deleteMemory(id) {
      const data = loadDb();
      const before = (data.memories || []).length;
      data.memories = (data.memories || []).filter(item => Number(item.id) !== Number(id));
      if (data.memories.length === before) return false;
      saveDb(data);
      return true;
    },

    saveMemories(sessionId, entries = [], cursor = null) {
      const data = loadDb();
      let nextIdValue = data.counters.memories || 0;
      const now = Date.now();
      for (const entry of entries) {
        data.memories.push(normalizeMemoryRecord({
          id: ++nextIdValue,
          sessionId,
          content: String(entry.content || '').slice(0, 300),
          userId: entry.userId ?? null,
          userName: entry.userName ?? null,
          createdAt: entry.createdAt || now,
          updatedAt: now,
          kind: entry.kind || 'fact',
          tags: Array.isArray(entry.tags) ? entry.tags : [],
          importance: entry.importance ?? 3,
          source: entry.source || 'distiller',
          disabled: entry.disabled === true,
        }));
      }
      data.counters.memories = nextIdValue;
      if (cursor !== null) data.memoryCursors[sessionId] = cursor;
      saveDb(data);
      return entries.length;
    },

    getMemoryCursor(sessionId) {
      const data = loadDb();
      return Number(data.memoryCursors?.[sessionId] || 0);
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

    // 立即落盘待写的防抖数据：短生命周期进程（迁移脚本等）退出前必须调用，否则丢数据
    flush() {
      try {
        flushJsonAtomic(dbPath);
      } catch {
        // 落盘失败不抛出，下次写入会重试
      }
    },
  };
  return sharedDatabase;
}
