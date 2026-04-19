import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const AFFINITY_DIR = path.join(process.cwd(), 'data', 'crystelf', 'affinity');
const AFFINITY_FILE = path.join(AFFINITY_DIR, 'affinity.json');
const AFFINITY_DEBUG_DIR = path.join(process.cwd(), 'data', 'crystelf', 'debug');

function formatLocalDateTime(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetRemainMinutes = String(absOffset % 60).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${sign}${offsetHours}:${offsetRemainMinutes}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildAffinityKey(groupId, userId) {
  return `${groupId}:${userId}`;
}

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDailyAffinityDebugFile(date = new Date()) {
  return path.join(AFFINITY_DEBUG_DIR, `affinity-${getTodayKey(date)}.log`);
}

function sanitizeSnippet(text = '', maxLength = 120) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function createDefaultRecord(groupId, userId) {
  return {
    group_id: String(groupId),
    user_id: String(userId),
    score: 0,
    positive_count: 0,
    negative_count: 0,
    interaction_count: 0,
    last_reason: '',
    last_delta: 0,
    last_keyword: '',
    last_text_preview: '',
    last_delta_at: '',
    same_direction_streak: 0,
    updated_at: '',
    decay_date: getTodayKey(),
  };
}

function getElapsedMsSince(timestamp) {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Date.now() - parsed;
}

function protectAffinityDelta(record, detected, text, config = {}) {
  const current = { ...detected };
  const currentPreview = sanitizeSnippet(text);
  const keywordCooldownMs = Number(config.keywordCooldownMs ?? 300000);
  const duplicateTextCooldownMs = Number(config.duplicateTextCooldownMs ?? 600000);
  const streakThreshold = Number(config.streakAttenuationThreshold ?? 3);
  const streakFactor = Number(config.streakAttenuationFactor ?? 0.5);
  const elapsedMs = getElapsedMsSince(record.last_delta_at);

  if (!current.delta) {
    return { ...current, guard: 'no_change' };
  }

  if (current.matchedKeyword && record.last_keyword === current.matchedKeyword && elapsedMs < keywordCooldownMs) {
    return { ...current, delta: 0, reason: '关键词冷却中', guard: 'keyword_cooldown' };
  }

  if (currentPreview && record.last_text_preview === currentPreview && elapsedMs < duplicateTextCooldownMs) {
    return { ...current, delta: 0, reason: '重复文本不计分', guard: 'duplicate_text' };
  }

  const sameDirection = Math.sign(record.last_delta || 0) === Math.sign(current.delta);
  if (sameDirection && Math.abs(record.last_delta || 0) > 0 && Number(record.same_direction_streak || 0) >= streakThreshold) {
    const attenuated = current.delta > 0
      ? Math.max(0, Math.floor(current.delta * streakFactor))
      : Math.min(0, Math.ceil(current.delta * streakFactor));

    if (attenuated === 0) {
      return { ...current, delta: 0, reason: '连续同向变动已降权', guard: 'streak_zeroed' };
    }

    return { ...current, delta: attenuated, reason: `${current.reason}(连续同向降权)`, guard: 'streak_attenuated' };
  }

  return { ...current, guard: '' };
}

async function ensureStoreFile() {
  await fs.mkdir(AFFINITY_DIR, { recursive: true });
  if (!fsSync.existsSync(AFFINITY_FILE)) {
    await fs.writeFile(AFFINITY_FILE, '{}', 'utf8');
  }
}

async function readStore() {
  await ensureStoreFile();
  try {
    const content = await fs.readFile(AFFINITY_FILE, 'utf8');
    return JSON.parse(content || '{}');
  } catch {
    return {};
  }
}

async function writeStore(data) {
  await ensureStoreFile();
  await fs.writeFile(AFFINITY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function appendAffinityDebugLog(payload = {}) {
  try {
    await fs.mkdir(AFFINITY_DEBUG_DIR, { recursive: true });
    const now = new Date();
    const entry = `${JSON.stringify({ time: formatLocalDateTime(now), ...payload }, null, 2)}\n`;
    await fs.appendFile(path.join(AFFINITY_DEBUG_DIR, 'affinity.log'), entry, 'utf8');
    await fs.appendFile(getDailyAffinityDebugFile(now), entry, 'utf8');
  } catch (error) {
    logger.warn(`[affinityManager] 好感度日志写入失败: ${error.message}`);
  }
}

function applyDecay(record, config = {}) {
  const today = getTodayKey();
  const decayDate = record.decay_date || today;
  if (decayDate === today) {
    return record;
  }

  const decayPerDay = Number(config.decayPerDay ?? 1);
  const previous = new Date(decayDate);
  const current = new Date(today);
  const dayDiff = Math.max(1, Math.floor((current - previous) / 86400000));
  const totalDecay = dayDiff * decayPerDay;

  if (record.score > 0) {
    record.score = Math.max(0, record.score - totalDecay);
  } else if (record.score < 0) {
    record.score = Math.min(0, record.score + totalDecay);
  }

  record.decay_date = today;
  return record;
}

function getAffinityLevel(score = 0, config = {}) {
  const coldThreshold = Number(config.coldThreshold ?? -5);
  const neutralThreshold = Number(config.neutralThreshold ?? 5);
  const warmThreshold = Number(config.warmThreshold ?? 20);

  if (score <= coldThreshold) return '冷淡';
  if (score < neutralThreshold) return '普通';
  if (score < warmThreshold) return '熟悉';
  return '亲近';
}

function parseKeywordList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const items = value
    .split(/[\r\n,，]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function buildKeywordPattern(keywords = []) {
  const normalized = keywords.map(item => String(item).trim()).filter(Boolean);
  if (normalized.length === 0) {
    return null;
  }
  const escaped = normalized.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(${escaped.join('|')})`, 'i');
}

function detectAffinityDelta(text = '', config = {}) {
  const content = String(text || '').trim();
  if (!content) {
    return { delta: 0, reason: '', matchedKeyword: '' };
  }

  const positiveKeywordList = parseKeywordList(config.positiveKeywords, ['谢谢', '辛苦了', '爱你', '喜欢你', '真棒', '厉害', '可爱', '好耶', '真乖', '抱抱']);
  const strongPositiveKeywordList = parseKeywordList(config.strongPositiveKeywords, ['夸你', '表扬你', '你最好了', '最喜欢你']);
  const negativeKeywordList = parseKeywordList(config.negativeKeywords, ['笨蛋', '傻', '闭嘴', '滚', '讨厌你', '废物', '弱智']);
  const strongNegativeKeywordList = parseKeywordList(config.strongNegativeKeywords, ['你真菜', '骂你', '恶心', '去死', '傻逼', '脑残']);

  const positivePatterns = [
    { regex: buildKeywordPattern(positiveKeywordList), delta: Number(config.positiveDelta ?? 1), reason: '友好互动' },
    { regex: buildKeywordPattern(strongPositiveKeywordList), delta: Number(config.strongPositiveDelta ?? 2), reason: '明显夸奖' },
  ];

  const negativePatterns = [
    { regex: buildKeywordPattern(negativeKeywordList), delta: Number(config.negativeDelta ?? -1), reason: '负面互动' },
    { regex: buildKeywordPattern(strongNegativeKeywordList), delta: Number(config.strongNegativeDelta ?? -2), reason: '明显攻击' },
  ];

  for (const rule of negativePatterns) {
    if (rule.regex && rule.regex.test(content)) {
      const matchedKeyword = negativeKeywordList.find(keyword => content.includes(keyword))
        || strongNegativeKeywordList.find(keyword => content.includes(keyword))
        || '';
      return { delta: rule.delta, reason: rule.reason, matchedKeyword };
    }
  }

  for (const rule of positivePatterns) {
    if (rule.regex && rule.regex.test(content)) {
      const matchedKeyword = positiveKeywordList.find(keyword => content.includes(keyword))
        || strongPositiveKeywordList.find(keyword => content.includes(keyword))
        || '';
      return { delta: rule.delta, reason: rule.reason, matchedKeyword };
    }
  }

  return { delta: 0, reason: '', matchedKeyword: '' };
}

class AffinityManager {
  async getRecord(groupId, userId, config = {}) {
    const store = await readStore();
    const key = buildAffinityKey(groupId, userId);
    const record = applyDecay(store[key] || createDefaultRecord(groupId, userId), config);
    return {
      ...record,
      level: getAffinityLevel(record.score, config),
    };
  }

  async updateFromMessage(groupId, userId, text, config = {}) {
    if (config?.enabled === false) {
      return {
        score: 0,
        level: '普通',
        delta: 0,
        reason: '',
      };
    }

    const store = await readStore();
    const key = buildAffinityKey(groupId, userId);
    const record = applyDecay(store[key] || createDefaultRecord(groupId, userId), config);
    const detected = detectAffinityDelta(text, config);
    const protectedResult = protectAffinityDelta(record, detected, text, config);
    const { delta, reason, matchedKeyword, guard } = protectedResult;
    const maxScore = Number(config.maxScore ?? 50);
    const minScore = Number(config.minScore ?? -30);
    const previousScore = Number(record.score || 0);
    const currentPreview = sanitizeSnippet(text);
    const previousLastDelta = Number(record.last_delta || 0);
    const previousStreak = Number(record.same_direction_streak || 0);
    const nextStreak = delta !== 0 && Math.sign(previousLastDelta) === Math.sign(delta)
      ? previousStreak + 1
      : delta !== 0
        ? 1
        : previousStreak;

    record.interaction_count += 1;
    record.last_delta = delta;
    record.last_reason = reason;
    record.last_keyword = matchedKeyword || '';
    record.last_text_preview = currentPreview;
    record.last_delta_at = new Date().toISOString();
    record.same_direction_streak = nextStreak;
    record.updated_at = new Date().toISOString();

    if (delta > 0) {
      record.positive_count += 1;
    } else if (delta < 0) {
      record.negative_count += 1;
    }

    record.score = clamp(record.score + delta, minScore, maxScore);
    store[key] = record;
    await writeStore(store);

    await appendAffinityDebugLog({
      group_id: String(groupId),
      user_id: String(userId),
      delta,
      reason,
      guard,
      matched_keyword: matchedKeyword,
      previous_score: previousScore,
      current_score: record.score,
      level: getAffinityLevel(record.score, config),
      interaction_count: record.interaction_count,
      text_preview: currentPreview,
    });

    return {
      ...record,
      delta,
      level: getAffinityLevel(record.score, config),
    };
  }

  async resetRecord(groupId, userId) {
    const store = await readStore();
    const key = buildAffinityKey(groupId, userId);
    delete store[key];
    await writeStore(store);
    return createDefaultRecord(groupId, userId);
  }

  async getGroupRanking(groupId, config = {}, limit = 10) {
    const store = await readStore();
    const normalizedGroupId = String(groupId);

    return Object.values(store)
      .filter(record => String(record?.group_id) === normalizedGroupId)
      .map(record => {
        const nextRecord = applyDecay({ ...record }, config);
        return {
          ...nextRecord,
          level: getAffinityLevel(nextRecord.score, config),
        };
      })
      .sort((a, b) => {
        const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(b.interaction_count || 0) - Number(a.interaction_count || 0);
      })
      .slice(0, limit);
  }
}

export { getAffinityLevel };
export default new AffinityManager();
