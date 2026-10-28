// 记忆库与人设/技能提炼（MemOS / Distilly 思路的本地轻量实现）
// - 记忆统一落在 chat.json 的 memories 表，按 session/user 隔离，支持标签、重要度、启停
// - 人设/技能提炼成 Markdown 产物存 data/crystelf/memory-artifacts，可预览、应用、删除
import fs from 'node:fs';
import path from 'node:path';
import ConfigControl from '../config/configControl.js';
import AiCaller from './aiCaller.js';
import { initDatabase } from './chatDatabase.js';
import { writeJsonAtomic } from '../utils/atomicStore.js';

const ARTIFACT_ROOT = path.join(process.cwd(), 'data', 'crystelf', 'memory-artifacts');
const ARTIFACT_INDEX = path.join(ARTIFACT_ROOT, 'index.json');
const ARTIFACT_TYPES = new Set(['persona', 'skill']);
const MAX_ARTIFACT_CONTENT = 40000;

function ensureArtifactRoot() {
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
}

function readArtifactIndex() {
  try {
    const raw = JSON.parse(fs.readFileSync(ARTIFACT_INDEX, 'utf8'));
    return Array.isArray(raw) ? raw.filter(item => item && ARTIFACT_TYPES.has(item.type)) : [];
  } catch {
    return [];
  }
}

function writeArtifactIndex(items = []) {
  ensureArtifactRoot();
  writeJsonAtomic(ARTIFACT_INDEX, items, { pretty: true });
}

function normalizeSessionId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^(group|private):/.test(raw) ? raw : `group:${raw}`;
}

function normalizeArtifactType(value) {
  const type = String(value || '').trim().toLowerCase();
  return ARTIFACT_TYPES.has(type) ? type : '';
}

function libraryError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeArtifactName(value, fallback) {
  const name = String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  return name || fallback;
}

function createArtifactId(type) {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTranscript(messages = [], { maxChars = 12000, targetUserId = null } = {}) {
  const lines = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'Bot' : '';
    const who = message.userName || message.userId || role || '群友';
    const target = targetUserId != null && String(message.userId) === String(targetUserId) ? '（目标）' : '';
    const time = message.timestamp ? new Date(message.timestamp) : null;
    const stamp = time ? `${String(time.getMonth() + 1).padStart(2, '0')}/${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}` : '';
    const content = String(message.content || '').replace(/\s+/g, ' ').trim();
    if (!content) continue;
    lines.push(`[${stamp}] ${who}${target}: ${content.slice(0, 500)}`);
  }
  // 从最新消息往前截取，超长时丢弃最早的部分
  const selected = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (size + line.length + 1 > maxChars && selected.length > 0) break;
    selected.unshift(line);
    size += line.length + 1;
  }
  return selected.join('\n');
}

async function collectMessages({ sessionId, limit = 300, userId = null, from = null, to = null, includeAssistant = true }) {
  const db = await initDatabase();
  const safeLimit = Math.max(20, Math.min(1000, Number(limit) || 300));
  let messages = db.getMessages(normalizeSessionId(sessionId), safeLimit);
  const fromTs = parseTimestamp(from);
  const toTs = parseTimestamp(to);
  if (fromTs) messages = messages.filter(message => Number(message.timestamp || 0) >= fromTs);
  if (toTs) messages = messages.filter(message => Number(message.timestamp || 0) <= toTs);
  if (userId !== null && userId !== undefined && String(userId).trim()) {
    messages = messages.filter(message => String(message.userId) === String(userId));
  }
  if (!includeAssistant) messages = messages.filter(message => message.role !== 'assistant');
  return messages.slice(-safeLimit);
}

async function callAi(prompt, options = {}) {
  const result = await AiCaller.callAiDirect(prompt, [], [], null, [], {
    scene: options.scene || 'memory_library',
    sessionId: options.sessionId || 'webconsole:memory-library',
    userId: options.userId || 'webconsole',
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 2000,
    systemPrompt: options.systemPrompt || '你是严谨的中文信息提炼助手，只根据给定材料输出，不要编造。',
  });
  if (!result?.success) throw new Error(result?.error || 'AI 调用失败');
  return {
    content: String(result.response || '').trim(),
    usage: result.usage || null,
  };
}

function parseMemoryJson(content) {
  const match = String(content || '').match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const raw = Array.isArray(parsed?.memories) ? parsed.memories : [];
  return raw.map(item => {
    if (typeof item === 'string') return { content: item.trim() };
    if (!item || typeof item !== 'object') return null;
    return {
      content: String(item.content || item.text || '').trim(),
      kind: String(item.kind || 'fact'),
      tags: Array.isArray(item.tags) ? item.tags.map(tag => String(tag)).filter(Boolean).slice(0, 8) : [],
      importance: Math.max(1, Math.min(5, Number(item.importance) || 3)),
    };
  }).filter(item => item && item.content).slice(0, 12);
}

export async function listMemories(filters = {}) {
  const db = await initDatabase();
  return db.listMemories({
    sessionId: normalizeSessionId(filters.sessionId),
    userId: filters.userId,
    query: filters.query,
    kind: filters.kind,
    source: filters.source,
    includeDisabled: filters.includeDisabled === true,
    limit: filters.limit,
  });
}

export async function addMemory(entry = {}) {
  const kind = entry.kind || 'fact';
  // 知识条目默认全局（不绑定群），允许更长内容
  const isKnowledge = kind === 'knowledge';
  const sessionId = isKnowledge && !String(entry.sessionId || '').trim()
    ? 'global'
    : normalizeSessionId(entry.sessionId);
  if (!sessionId) throw libraryError('缺少会话 ID');
  const content = String(entry.content || '').trim().slice(0, isKnowledge ? 2000 : 300);
  if (!content) throw libraryError('记忆内容不能为空');
  const db = await initDatabase();
  return db.addMemory({
    sessionId,
    content,
    userId: isKnowledge ? null : (entry.userId || null),
    userName: isKnowledge ? null : (entry.userName || null),
    kind,
    tags: Array.isArray(entry.tags) ? entry.tags : String(entry.tags || '').split(/[,，\s]+/).filter(Boolean),
    importance: entry.importance,
    source: entry.source || 'manual',
  });
}

export async function updateMemory(id, patch = {}) {
  const db = await initDatabase();
  const next = db.updateMemory(id, {
    content: patch.content,
    userId: patch.userId,
    userName: patch.userName,
    kind: patch.kind,
    tags: Array.isArray(patch.tags) ? patch.tags : (patch.tags === undefined ? undefined : String(patch.tags || '').split(/[,，\s]+/).filter(Boolean)),
    importance: patch.importance,
    disabled: patch.disabled,
  });
  if (!next) throw libraryError('记忆不存在或已被清理', 404);
  return next;
}

export async function deleteMemory(id) {
  const db = await initDatabase();
  const removed = db.deleteMemory(id);
  if (!removed) throw libraryError('记忆不存在或已被清理', 404);
  return { removed: true, id };
}

export async function getMemoryStats() {
  const db = await initDatabase();
  return db.getMemoryStats();
}

export function listArtifacts(type = '') {
  const normalizedType = normalizeArtifactType(type);
  return readArtifactIndex()
    .filter(item => !normalizedType || item.type === normalizedType)
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
}

export function getArtifact(id) {
  const artifactId = String(id || '').trim();
  const entry = readArtifactIndex().find(item => item.id === artifactId);
  if (!entry) throw libraryError('产物不存在或已被删除', 404);
  const filePath = path.join(ARTIFACT_ROOT, `${entry.id}.md`);
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw libraryError('产物文件丢失', 404);
  }
  return { ...entry, content };
}

export function saveArtifact({ type, name, content, meta = {} } = {}) {
  const artifactType = normalizeArtifactType(type);
  if (!artifactType) throw libraryError('产物类型必须是 persona 或 skill');
  const text = String(content || '').trim().slice(0, MAX_ARTIFACT_CONTENT);
  if (!text) throw libraryError('产物内容不能为空');
  const now = Date.now();
  const id = createArtifactId(artifactType);
  const artifactName = sanitizeArtifactName(name, artifactType === 'persona' ? '未命名人设卡' : '未命名技能');
  const entry = {
    id,
    type: artifactType,
    name: artifactName,
    preview: text.replace(/\s+/g, ' ').slice(0, 180),
    sessionId: normalizeSessionId(meta.sessionId),
    userId: meta.userId || null,
    userName: meta.userName || null,
    createdAt: now,
    updatedAt: now,
  };
  ensureArtifactRoot();
  fs.writeFileSync(path.join(ARTIFACT_ROOT, `${id}.md`), `${text}\n`, 'utf8');
  const index = readArtifactIndex();
  index.push(entry);
  writeArtifactIndex(index);
  return entry;
}

export function deleteArtifact(id) {
  const artifactId = String(id || '').trim();
  const index = readArtifactIndex();
  const next = index.filter(item => item.id !== artifactId);
  if (next.length === index.length) throw libraryError('产物不存在或已被删除', 404);
  writeArtifactIndex(next);
  try {
    fs.rmSync(path.join(ARTIFACT_ROOT, `${artifactId}.md`), { force: true });
  } catch {
    // 索引已删除即可，残留文件不影响使用
  }
  return { removed: true, id: artifactId };
}

export async function distillMemories({ sessionId, limit = 300, userId = null, from = null, to = null, save = true } = {}) {
  const normalizedSession = normalizeSessionId(sessionId);
  if (!normalizedSession) throw libraryError('缺少会话 ID');
  const messages = await collectMessages({ sessionId: normalizedSession, limit, userId, from, to });
  const transcript = formatTranscript(messages, { maxChars: 14000, targetUserId: userId });
  if (!transcript) throw libraryError('所选范围内没有可提炼的聊天记录');
  const { content, usage } = await callAi(
    `以下是某QQ群的一段聊天记录。请提炼值得长期记住的信息条目（事件、约定、偏好、关系、重要动向等）。

聊天记录：
${transcript}

要求：
1. 只记录有长期价值的信息，寒暄灌水忽略。
2. 每条一句话，包含必要的谁/什么事，将来单独看也能懂。
3. kind 取值：fact（事实）、preference（偏好）、event（事件/约定）、relationship（关系）。
4. tags 给 2-5 个检索关键词；importance 为 1-5。
5. 最多 12 条，没有值得记的就输出空数组。

输出严格 JSON：{"memories":[{"content":"...","kind":"fact","tags":["..."],"importance":3}]}`,
    { scene: 'memory_library_distill', maxTokens: 2400, sessionId: normalizedSession },
  );
  const entries = parseMemoryJson(content);
  if (save && entries.length > 0) {
    const db = await initDatabase();
    db.saveMemories(normalizedSession, entries.map(entry => ({
      ...entry,
      userId: userId || null,
      source: 'distill',
      createdAt: Date.now(),
    })), null);
  }
  return { entries, usage, saved: save ? entries.length : 0 };
}

export async function distillPersona({ sessionId, userId = null, targetName = '', limit = 300, from = null, to = null } = {}) {
  const normalizedSession = normalizeSessionId(sessionId);
  if (!normalizedSession) throw libraryError('缺少会话 ID');
  const messages = await collectMessages({ sessionId: normalizedSession, limit, userId, from, to });
  if (messages.length === 0) throw libraryError('所选范围内没有可提炼的聊天记录');
  const transcript = formatTranscript(messages, { maxChars: 14000, targetUserId: userId });
  const target = String(targetName || '').trim() || (userId ? `用户 ${userId}` : '本群群友');
  const { content, usage } = await callAi(
    `请根据下面的群聊记录，提炼「${target}」的人设卡。只写有材料支持的内容，不要编造；如果材料不足，直接写明“材料不足”。

聊天记录：
${transcript}

输出 Markdown，结构如下：
# 人设卡：${target}
## 身份与关系
## 说话风格
## 口头禅与常用表达
## 情绪触发与雷区
## 互动习惯
## 示例台词（3-5 条，体现语气即可，不要照抄隐私内容）`,
    { scene: 'memory_library_persona', maxTokens: 2400, sessionId: normalizedSession },
  );
  return {
    content,
    usage,
    suggestedName: `${target}人设卡`,
    sessionId: normalizedSession,
    userId: userId || null,
  };
}

export async function distillSkill({ sessionId, limit = 300, targetName = '', from = null, to = null } = {}) {
  const normalizedSession = normalizeSessionId(sessionId);
  if (!normalizedSession) throw libraryError('缺少会话 ID');
  const messages = await collectMessages({ sessionId: normalizedSession, limit, from, to });
  if (messages.length === 0) throw libraryError('所选范围内没有可提炼的聊天记录');
  const transcript = formatTranscript(messages, { maxChars: 16000 });
  const name = String(targetName || '').trim() || '群聊处理经验';
  const { content, usage } = await callAi(
    `请从下面的群聊记录中提炼可复用的处理技能。只总结记录里真实出现过的做法，不要编造；没有明确可复用的经验时，输出“# 技能：暂无\n材料不足以形成稳定技能”。

聊天记录：
${transcript}

输出 Markdown，结构如下：
# 技能：${name}
## 适用场景
## 前置条件
## 处理步骤
## 注意事项
## 示例`,
    { scene: 'memory_library_skill', maxTokens: 2400, sessionId: normalizedSession },
  );
  return {
    content,
    usage,
    suggestedName: name,
    sessionId: normalizedSession,
  };
}

export async function applyPersonaArtifact(id) {
  const artifact = getArtifact(id);
  if (artifact.type !== 'persona') throw libraryError('只能把 persona 类型产物应用为人设');
  const aiConfig = ConfigControl.get('ai') || {};
  await ConfigControl.set('ai', {
    ...aiConfig,
    personaCard: artifact.content,
    personaCardName: artifact.name,
    personaCardArtifactId: artifact.id,
    personaCardUpdatedAt: new Date().toISOString(),
  });
  return { applied: true, type: 'persona', id: artifact.id, name: artifact.name };
}

export async function applySkillArtifact(id) {
  const artifact = getArtifact(id);
  if (artifact.type !== 'skill') throw libraryError('只能把 skill 类型产物应用为 ZCode 指令');
  const coreConfig = ConfigControl.get('coreConfig') || {};
  const tools = coreConfig.tools && typeof coreConfig.tools === 'object' ? coreConfig.tools : {};
  const workbench = tools.agentWorkbench && typeof tools.agentWorkbench === 'object' ? tools.agentWorkbench : {};
  const existing = String(workbench.zcodeInstructions || '').trim();
  const marker = `<!-- memory-skill:${artifact.id} -->`;
  const next = existing.includes(marker)
    ? existing
    : [existing, marker, artifact.content].filter(Boolean).join('\n\n').slice(0, 20000);
  await ConfigControl.set('coreConfig', {
    ...coreConfig,
    tools: {
      ...tools,
      agentWorkbench: {
        ...workbench,
        zcodeInstructions: next,
      },
    },
  });
  return { applied: true, type: 'skill', id: artifact.id, name: artifact.name };
}

// ── 知识库统一（方案 C）：旧 ai.knowledgeBase 迁移为 kind=knowledge 的全局记忆条目 ──

export function parseKnowledgeBaseText(value = '') {
  return String(value || '')
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const [title = `知识片段${index + 1}`, maybeTags = '', ...rest] = lines;
      const hasTagsLine = /^标签[:：]/.test(maybeTags);
      return {
        title,
        tags: (hasTagsLine ? maybeTags.replace(/^标签[:：]/, '').split(/[，,]/) : []).map(item => item.trim()).filter(Boolean),
        content: ((hasTagsLine ? rest : [maybeTags, ...rest]).join('\n').trim()) || title,
      };
    })
    .slice(0, 100);
}

function tokenizeKnowledgeQuery(value = '') {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return [];
  const stopWords = new Set(['是谁', '什么', '怎么', '为何', '为什么', '多少', '一下', '一个', '这个', '那个', '一下子']);
  const tokens = new Set();
  (text.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/g) || []).forEach(token => {
    if (!stopWords.has(token)) tokens.add(token);
  });
  const compact = text.replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  if (/^[\u4e00-\u9fa5]+$/.test(compact) && compact.length >= 2) {
    for (let size = Math.min(4, compact.length); size >= 2; size--) {
      for (let index = 0; index <= compact.length - size; index++) {
        const token = compact.slice(index, index + size);
        if (!stopWords.has(token)) tokens.add(token);
      }
    }
  }
  return Array.from(tokens);
}

function normalizeKnowledgeKey(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function knowledgeTitle(content = '') {
  const firstLine = String(content || '').split(/\r?\n/)[0] || '';
  return firstLine.slice(0, 60) || '知识条目';
}

// ── 旧记忆迁移：data/crystelf/memories/<群号>/<QQ>.json → 新记忆库（chat.json memories 表）──
// 旧系统按 30 天过期，但迁移时不过期、全部保留（用户明确要求旧记忆不丢），来源标记 legacy-import
export async function migrateLegacyMemories({ dryRun = false } = {}) {
  const legacyDir = path.join(process.cwd(), 'data', 'crystelf', 'memories');
  const summary = {
    legacyDir,
    legacyDirExists: fs.existsSync(legacyDir),
    groups: 0,
    files: 0,
    found: 0,
    imported: 0,
    skippedDuplicate: 0,
    skippedEmpty: 0,
    expiredCount: 0,
    dryRun: dryRun === true,
  };
  if (!summary.legacyDirExists) return summary;

  const db = await initDatabase();
  for (const groupEntry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
    if (!groupEntry.isDirectory()) continue;
    const groupId = groupEntry.name;
    const groupPath = path.join(legacyDir, groupId);
    let groupHadFile = false;

    for (const file of fs.readdirSync(groupPath)) {
      if (!file.endsWith('.json')) continue;
      let json;
      try {
        json = JSON.parse(fs.readFileSync(path.join(groupPath, file), 'utf8'));
      } catch {
        continue;
      }
      const entries = json && typeof json === 'object' ? Object.values(json) : [];
      if (entries.length === 0) continue;
      groupHadFile = true;
      summary.files += 1;
      const userId = file.replace(/\.json$/, '');
      const sessionId = `group:${groupId}`;

      // 幂等：同会话+同用户已有相同内容的记忆就跳过，重复执行不产生重复条目
      const existing = new Set(
        db.listMemories({ sessionId, userId, limit: 1000, includeDisabled: true })
          .map(item => normalizeKnowledgeKey(item.content)),
      );

      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        summary.found += 1;
        const content = String(entry.data || '').trim();
        if (!content) {
          summary.skippedEmpty += 1;
          continue;
        }
        const key = normalizeKnowledgeKey(content);
        if (existing.has(key)) {
          summary.skippedDuplicate += 1;
          continue;
        }
        existing.add(key);
        const expired = Number(entry.expireAt) > 0 && Number(entry.expireAt) < Date.now();
        if (expired) summary.expiredCount += 1;
        if (dryRun) {
          summary.imported += 1;
          continue;
        }
        db.addMemory({
          sessionId,
          userId,
          content,
          tags: Array.isArray(entry.keywords) ? entry.keywords.map(tag => String(tag)).filter(Boolean).slice(0, 20) : [],
          kind: 'fact',
          importance: 3,
          source: 'legacy-import',
          createdAt: Number(entry.createdAt) || Date.now(),
        });
        summary.imported += 1;
      }
    }
    if (groupHadFile) summary.groups += 1;
  }
  return summary;
}

export async function importKnowledgeFromConfig() {
  const aiConfig = ConfigControl.get('ai') || {};
  const items = parseKnowledgeBaseText(aiConfig.knowledgeBase || '');
  if (items.length === 0) {
    return { imported: 0, skipped: 0, total: 0 };
  }
  const db = await initDatabase();
  const existing = db.listMemories({ kind: 'knowledge', includeDisabled: true, limit: 500 });
  const seen = new Set(existing.map(item => normalizeKnowledgeKey(item.content)));
  let imported = 0;
  let skipped = 0;
  for (const item of items) {
    const content = [item.title, item.content].filter(Boolean).join('\n').slice(0, 2000);
    const key = normalizeKnowledgeKey(content);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    db.addMemory({
      sessionId: 'global',
      kind: 'knowledge',
      content,
      tags: item.tags,
      importance: 3,
      source: 'knowledge-import',
    });
    imported += 1;
  }
  return { imported, skipped, total: items.length };
}

export async function searchKnowledge(query = '', limit = 3) {
  const tokens = tokenizeKnowledgeQuery(query);
  if (tokens.length === 0) return [];
  const db = await initDatabase();
  const items = db.listMemories({ kind: 'knowledge', limit: 500 });
  return items
    .map(item => {
      const title = knowledgeTitle(item.content);
      const haystack = `${title}\n${item.content}`.toLowerCase();
      const lowerTitle = title.toLowerCase();
      const matchedTokens = tokens.filter(token => haystack.includes(token));
      const titleHits = tokens.filter(token => lowerTitle.includes(token));
      const tagHits = (item.tags || []).filter(tag => tokens.some(token => String(tag).toLowerCase().includes(token)));
      const score = matchedTokens.length + titleHits.length * 3 + tagHits.length * 2;
      return {
        id: `memory-${item.id}`,
        memoryId: item.id,
        title,
        tags: item.tags || [],
        content: item.content,
        score,
      };
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 3)));
}

export function getAppliedState() {
  const aiConfig = ConfigControl.get('ai') || {};
  const coreConfig = ConfigControl.get('coreConfig') || {};
  const zcodeInstructions = String(coreConfig?.tools?.agentWorkbench?.zcodeInstructions || '').trim();
  return {
    persona: {
      name: String(aiConfig.personaCardName || ''),
      artifactId: String(aiConfig.personaCardArtifactId || ''),
      preview: String(aiConfig.personaCard || '').replace(/\s+/g, ' ').slice(0, 160),
      updatedAt: String(aiConfig.personaCardUpdatedAt || ''),
    },
    zcodeInstructions: {
      preview: zcodeInstructions.replace(/\s+/g, ' ').slice(0, 160),
      length: zcodeInstructions.length,
    },
  };
}
