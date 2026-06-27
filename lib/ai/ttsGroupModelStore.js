import fs from 'fs';
import path from 'path';

export const TTS_GROUP_MODEL_STORE_FILE = path.join(
  process.cwd(),
  'data',
  'crystelf',
  'tts-group-models.json',
);

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureDir(filePath = '') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeGroupId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function normalizeModelName(value = '') {
  return String(value ?? '').trim().slice(0, 160);
}

function readStore() {
  try {
    if (!fs.existsSync(TTS_GROUP_MODEL_STORE_FILE)) {
      return { groups: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(TTS_GROUP_MODEL_STORE_FILE, 'utf8'));
    if (!isPlainObject(parsed)) {
      return { groups: {} };
    }
    return {
      ...parsed,
      groups: isPlainObject(parsed.groups) ? parsed.groups : {},
    };
  } catch (error) {
    logger.warn(`[tts-group-model] 读取群语音模型配置失败: ${error.message}`);
    return { groups: {} };
  }
}

function writeStore(store = {}) {
  try {
    ensureDir(TTS_GROUP_MODEL_STORE_FILE);
    const normalized = {
      updatedAt: new Date().toISOString(),
      groups: isPlainObject(store.groups) ? store.groups : {},
    };
    const tempFile = `${TTS_GROUP_MODEL_STORE_FILE}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fs.renameSync(tempFile, TTS_GROUP_MODEL_STORE_FILE);
  } catch (error) {
    logger.warn(`[tts-group-model] 写入群语音模型配置失败: ${error.message}`);
    throw error;
  }
}

export function getGroupVoiceModel(groupId = '') {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return '';

  const store = readStore();
  const record = store.groups?.[normalizedGroupId];
  return normalizeModelName(record?.model);
}

export function getGroupVoiceModelRecord(groupId = '') {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return null;

  const store = readStore();
  const record = store.groups?.[normalizedGroupId];
  if (!isPlainObject(record) || !normalizeModelName(record.model)) {
    return null;
  }

  return {
    groupId: normalizedGroupId,
    model: normalizeModelName(record.model),
    updatedAt: String(record.updatedAt || ''),
    operator: String(record.operator || ''),
  };
}

export function setGroupVoiceModel(groupId = '', model = '', meta = {}) {
  const normalizedGroupId = normalizeGroupId(groupId);
  const normalizedModel = normalizeModelName(model);
  if (!normalizedGroupId) {
    throw new Error('群号无效');
  }
  if (!normalizedModel) {
    throw new Error('语音模型不能为空');
  }

  const store = readStore();
  store.groups[normalizedGroupId] = {
    model: normalizedModel,
    updatedAt: new Date().toISOString(),
    operator: String(meta.operator || ''),
  };
  writeStore(store);
  return getGroupVoiceModelRecord(normalizedGroupId);
}

export function clearGroupVoiceModel(groupId = '') {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) {
    throw new Error('群号无效');
  }

  const store = readStore();
  const existed = Boolean(store.groups?.[normalizedGroupId]);
  if (existed) {
    delete store.groups[normalizedGroupId];
    writeStore(store);
  }
  return existed;
}

export function listGroupVoiceModels() {
  const store = readStore();
  return Object.entries(store.groups || {})
    .map(([groupId, record]) => ({
      groupId,
      model: normalizeModelName(record?.model),
      updatedAt: String(record?.updatedAt || ''),
      operator: String(record?.operator || ''),
    }))
    .filter(item => item.groupId && item.model);
}
