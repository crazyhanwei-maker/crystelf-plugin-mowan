import fs from 'fs';
import path from 'path';

export const TTS_PRIVATE_MODEL_STORE_FILE = path.join(
  process.cwd(),
  'data',
  'crystelf',
  'tts-private-models.json',
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

function normalizeUserId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function normalizeModelName(value = '') {
  return String(value ?? '').trim().slice(0, 160);
}

function readStore() {
  try {
    if (!fs.existsSync(TTS_PRIVATE_MODEL_STORE_FILE)) {
      return { users: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(TTS_PRIVATE_MODEL_STORE_FILE, 'utf8'));
    if (!isPlainObject(parsed)) {
      return { users: {} };
    }
    return {
      ...parsed,
      users: isPlainObject(parsed.users) ? parsed.users : {},
    };
  } catch (error) {
    logger.warn(`[tts-private-model] 读取私聊语音模型配置失败: ${error.message}`);
    return { users: {} };
  }
}

function writeStore(store = {}) {
  try {
    ensureDir(TTS_PRIVATE_MODEL_STORE_FILE);
    const normalized = {
      updatedAt: new Date().toISOString(),
      users: isPlainObject(store.users) ? store.users : {},
    };
    const tempFile = `${TTS_PRIVATE_MODEL_STORE_FILE}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fs.renameSync(tempFile, TTS_PRIVATE_MODEL_STORE_FILE);
  } catch (error) {
    logger.warn(`[tts-private-model] 写入私聊语音模型配置失败: ${error.message}`);
    throw error;
  }
}

export function getPrivateVoiceModel(userId = '') {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return '';

  const store = readStore();
  const record = store.users?.[normalizedUserId];
  return normalizeModelName(record?.model);
}

export function getPrivateVoiceModelRecord(userId = '') {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  const store = readStore();
  const record = store.users?.[normalizedUserId];
  if (!isPlainObject(record) || !normalizeModelName(record.model)) {
    return null;
  }

  return {
    userId: normalizedUserId,
    model: normalizeModelName(record.model),
    updatedAt: String(record.updatedAt || ''),
    operator: String(record.operator || ''),
  };
}

export function setPrivateVoiceModel(userId = '', model = '', meta = {}) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedModel = normalizeModelName(model);
  if (!normalizedUserId) {
    throw new Error('用户 ID 无效');
  }
  if (!normalizedModel) {
    throw new Error('语音模型不能为空');
  }

  const store = readStore();
  store.users[normalizedUserId] = {
    model: normalizedModel,
    updatedAt: new Date().toISOString(),
    operator: String(meta.operator || ''),
  };
  writeStore(store);
  return getPrivateVoiceModelRecord(normalizedUserId);
}

export function clearPrivateVoiceModel(userId = '') {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    throw new Error('用户 ID 无效');
  }

  const store = readStore();
  const existed = Boolean(store.users?.[normalizedUserId]);
  if (existed) {
    delete store.users[normalizedUserId];
    writeStore(store);
  }
  return existed;
}
