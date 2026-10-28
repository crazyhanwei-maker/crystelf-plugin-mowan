// 记忆库控制台：记忆 CRUD、从聊天提炼记忆/人设/技能、产物应用
import { initDatabase } from '../ai/chatDatabase.js';
import {
  listMemories,
  addMemory,
  updateMemory,
  deleteMemory,
  getMemoryStats,
  listArtifacts,
  getArtifact,
  saveArtifact,
  deleteArtifact,
  distillMemories,
  distillPersona,
  distillSkill,
  applyPersonaArtifact,
  applySkillArtifact,
  getAppliedState,
  importKnowledgeFromConfig,
} from '../ai/memoryLibrary.js';

function createHttpError(statusCode, message, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeSessionId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^(group|private):/.test(raw) ? raw : `group:${raw}`;
}

export function createMemoryLibraryConsole(options = {}) {
  const logger = options.logger || globalThis.logger;

  async function buildPayload(filters = {}) {
    const db = await initDatabase();
    const sessionId = normalizeSessionId(filters.sessionId);
    const items = await listMemories({
      sessionId,
      userId: filters.userId,
      query: filters.query,
      kind: filters.kind,
      source: filters.source,
      includeDisabled: filters.includeDisabled === true,
      limit: Math.max(1, Math.min(1000, Number(filters.limit) || 500)),
    });
    const stats = await getMemoryStats();
    const sessions = db.listSessions(200).map(session => ({
      id: session.id,
      type: session.type,
      targetId: session.targetId,
      updatedAt: session.updatedAt,
    }));
    return {
      success: true,
      sessionId,
      items,
      stats,
      sessions,
      artifacts: listArtifacts(),
      applied: getAppliedState(),
      generatedAt: new Date().toISOString(),
    };
  }

  async function addMemoryPayload(body = {}) {
    if (!String(body.content || '').trim()) throw createHttpError(400, '记忆内容不能为空', 'MEMORY_CONTENT_REQUIRED');
    const item = await addMemory({
      sessionId: normalizeSessionId(body.sessionId),
      userId: body.userId || null,
      userName: body.userName || null,
      content: body.content,
      kind: body.kind,
      tags: body.tags,
      importance: body.importance,
      source: 'manual',
    });
    return { success: true, item };
  }

  async function updateMemoryPayload(body = {}) {
    if (!body.id) throw createHttpError(400, '缺少记忆 ID', 'MEMORY_ID_REQUIRED');
    const item = await updateMemory(body.id, {
      content: body.content,
      userId: body.userId,
      userName: body.userName,
      kind: body.kind,
      tags: body.tags,
      importance: body.importance,
      disabled: body.disabled,
    });
    return { success: true, item };
  }

  async function deleteMemoryPayload(body = {}) {
    if (!body.id) throw createHttpError(400, '缺少记忆 ID', 'MEMORY_ID_REQUIRED');
    return { success: true, ...(await deleteMemory(body.id)) };
  }

  async function importKnowledgePayload() {
    const result = await importKnowledgeFromConfig();
    if (result.total === 0) {
      return { success: true, ...result, message: '旧知识库（ai.knowledgeBase）为空，没有可导入的条目。' };
    }
    return { success: true, ...result };
  }

  async function distillMemoriesPayload(body = {}) {
    const sessionId = normalizeSessionId(body.sessionId);
    if (!sessionId) throw createHttpError(400, '缺少会话 ID', 'MEMORY_SESSION_REQUIRED');
    try {
      const result = await distillMemories({
        sessionId,
        userId: body.userId || null,
        limit: body.limit,
        from: body.from,
        to: body.to,
        save: body.save !== false,
      });
      return { success: true, ...result };
    } catch (error) {
      logger?.warn?.(`[memory-library] 提炼记忆失败: ${error.message}`);
      if (!error.statusCode) error.statusCode = 502;
      throw error;
    }
  }

  async function distillPersonaPayload(body = {}) {
    const sessionId = normalizeSessionId(body.sessionId);
    if (!sessionId) throw createHttpError(400, '缺少会话 ID', 'MEMORY_SESSION_REQUIRED');
    try {
      const result = await distillPersona({
        sessionId,
        userId: body.userId || null,
        targetName: body.targetName || body.name || '',
        limit: body.limit,
        from: body.from,
        to: body.to,
      });
      return { success: true, ...result };
    } catch (error) {
      logger?.warn?.(`[memory-library] 提炼人设失败: ${error.message}`);
      if (!error.statusCode) error.statusCode = 502;
      throw error;
    }
  }

  async function distillSkillPayload(body = {}) {
    const sessionId = normalizeSessionId(body.sessionId);
    if (!sessionId) throw createHttpError(400, '缺少会话 ID', 'MEMORY_SESSION_REQUIRED');
    try {
      const result = await distillSkill({
        sessionId,
        targetName: body.targetName || body.name || '',
        limit: body.limit,
        from: body.from,
        to: body.to,
      });
      return { success: true, ...result };
    } catch (error) {
      logger?.warn?.(`[memory-library] 提炼技能失败: ${error.message}`);
      if (!error.statusCode) error.statusCode = 502;
      throw error;
    }
  }

  async function saveArtifactPayload(body = {}) {
    const artifact = saveArtifact({
      type: body.type,
      name: body.name,
      content: body.content,
      meta: {
        sessionId: body.sessionId,
        userId: body.userId,
        userName: body.userName,
      },
    });
    return { success: true, artifact };
  }

  async function getArtifactPayload(body = {}) {
    const id = String(body.id || '').trim();
    if (!id) throw createHttpError(400, '缺少产物 ID', 'ARTIFACT_ID_REQUIRED');
    return { success: true, artifact: getArtifact(id) };
  }

  async function deleteArtifactPayload(body = {}) {
    const id = String(body.id || '').trim();
    if (!id) throw createHttpError(400, '缺少产物 ID', 'ARTIFACT_ID_REQUIRED');
    return { success: true, ...(deleteArtifact(id)) };
  }

  async function applyArtifactPayload(body = {}) {
    const id = String(body.id || '').trim();
    if (!id) throw createHttpError(400, '缺少产物 ID', 'ARTIFACT_ID_REQUIRED');
    const artifact = getArtifact(id);
    const result = artifact.type === 'persona'
      ? await applyPersonaArtifact(id)
      : await applySkillArtifact(id);
    return { success: true, ...result, applied: getAppliedState() };
  }

  return {
    buildPayload,
    addMemoryPayload,
    updateMemoryPayload,
    deleteMemoryPayload,
    importKnowledgePayload,
    distillMemoriesPayload,
    distillPersonaPayload,
    distillSkillPayload,
    saveArtifactPayload,
    getArtifactPayload,
    deleteArtifactPayload,
    applyArtifactPayload,
  };
}
