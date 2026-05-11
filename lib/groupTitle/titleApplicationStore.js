import fs from 'fs';
import path from 'path';

const STORE_DIR = path.join(process.cwd(), 'data', 'crystelf', 'group-title');
const STORE_FILE = path.join(STORE_DIR, 'applications.json');

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return { counter: 0, items: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return {
      counter: Number(parsed?.counter || 0),
      items: Array.isArray(parsed?.items) ? parsed.items : [],
    };
  } catch (error) {
    logger.warn(`[group-title] 读取头衔申请失败: ${error.message}`);
    return { counter: 0, items: [] };
  }
}

function writeStore(store = {}) {
  ensureStoreDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify({
    counter: Number(store.counter || 0),
    items: Array.isArray(store.items) ? store.items : [],
  }, null, 2), 'utf8');
}

function normalizeId(value = '') {
  return String(value ?? '').trim();
}

function normalizeGroupId(value = '') {
  const text = normalizeId(value);
  return /^\d{5,20}$/.test(text) ? text : '';
}

function makeApplicationId(counter = 0) {
  return `T${String(counter).padStart(5, '0')}`;
}

function isPending(item = {}) {
  return String(item.status || '') === 'pending';
}

function normalizeRecord(item = {}) {
  return JSON.parse(JSON.stringify(item));
}

export function createTitleApplication(payload = {}) {
  const store = readStore();
  const groupId = normalizeGroupId(payload.groupId);
  const userId = normalizeId(payload.userId);
  const title = String(payload.title || '').trim();
  const now = new Date().toISOString();

  const existing = store.items.find(item => (
    isPending(item)
    && String(item.groupId) === groupId
    && String(item.userId) === userId
  ));

  if (existing) {
    existing.title = title;
    existing.nickname = String(payload.nickname || existing.nickname || '').trim();
    existing.updatedAt = now;
    existing.replaced = true;
    writeStore(store);
    return normalizeRecord(existing);
  }

  store.counter = Number(store.counter || 0) + 1;
  const record = {
    id: makeApplicationId(store.counter),
    groupId,
    userId,
    nickname: String(payload.nickname || '').trim(),
    title,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    reviewerId: '',
    reviewerName: '',
    reason: '',
    error: '',
  };
  store.items.push(record);
  writeStore(store);
  return normalizeRecord(record);
}

export function listPendingTitleApplications(groupId = '', limit = 10) {
  const normalizedGroupId = normalizeGroupId(groupId);
  return readStore().items
    .filter(item => isPending(item) && (!normalizedGroupId || String(item.groupId) === normalizedGroupId))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, Math.max(1, Math.min(50, Number(limit || 10))))
    .map(normalizeRecord);
}

export function listTitleApplications(filters = {}) {
  const groupId = normalizeGroupId(filters.groupId);
  const status = String(filters.status || 'pending').trim().toLowerCase();
  const query = String(filters.query || '').trim().toLowerCase();
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'failed', 'cancelled', 'expired']);
  return readStore().items
    .filter(item => !groupId || String(item.groupId) === groupId)
    .filter(item => status === 'all' || !allowedStatuses.has(status) || String(item.status || '') === status)
    .filter((item) => {
      if (!query) return true;
      return [item.id, item.groupId, item.userId, item.nickname, item.title, item.reason, item.error, item.reviewerName]
        .some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .map(normalizeRecord);
}

export function findTitleApplicationById(id = '') {
  const normalizedId = normalizeId(id).toUpperCase();
  if (!normalizedId) return null;
  const item = readStore().items.find(record => String(record.id || '').toUpperCase() === normalizedId);
  return item ? normalizeRecord(item) : null;
}

export function findPendingTitleApplication(query = {}) {
  const groupId = normalizeGroupId(query.groupId);
  const id = normalizeId(query.id).toUpperCase();
  const userId = normalizeId(query.userId);
  const items = readStore().items
    .filter(item => isPending(item) && (!groupId || String(item.groupId) === groupId));

  if (id) {
    const byId = items.find(item => String(item.id || '').toUpperCase() === id);
    if (byId) return normalizeRecord(byId);
  }

  if (userId) {
    const byUser = items
      .filter(item => String(item.userId) === userId)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    if (byUser) return normalizeRecord(byUser);
  }

  return null;
}

export function updateTitleApplicationStatus(id = '', status = '', patch = {}) {
  const store = readStore();
  const normalizedId = normalizeId(id).toUpperCase();
  const index = store.items.findIndex(item => String(item.id || '').toUpperCase() === normalizedId);
  if (index < 0) return null;
  store.items[index] = {
    ...store.items[index],
    ...patch,
    status: String(status || store.items[index].status || 'pending'),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return normalizeRecord(store.items[index]);
}

export function pruneExpiredTitleApplications(expireHours = 72) {
  const hours = Math.max(1, Math.min(720, Number(expireHours || 72)));
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const store = readStore();
  let changed = false;
  for (const item of store.items) {
    if (!isPending(item)) continue;
    const time = new Date(item.updatedAt || item.createdAt || 0).getTime();
    if (Number.isFinite(time) && time < cutoff) {
      item.status = 'expired';
      item.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) writeStore(store);
}
