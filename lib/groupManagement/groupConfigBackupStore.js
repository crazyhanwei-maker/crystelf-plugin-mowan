import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../utils/atomicStore.js';

export const GROUP_CONFIG_BACKUP_FILE = path.join(process.cwd(), 'data', 'crystelf', 'group-management', 'config-backups.json');

const GROUP_BACKUP_LIMIT = 20;
const TOTAL_BACKUP_LIMIT = 1000;

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

function ensureDir(filePath = '') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeGroupId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function cloneJsonValue(value, fallback = null) {
  try {
    return value === undefined ? fallback : JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function safeReadBackups() {
  try {
    if (!fs.existsSync(GROUP_CONFIG_BACKUP_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(GROUP_CONFIG_BACKUP_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    logger.warn(`[group-management] 读取群配置备份失败: ${error.message}`);
    return [];
  }
}

function safeWriteBackups(items = []) {
  ensureDir(GROUP_CONFIG_BACKUP_FILE);
  writeFileAtomic(GROUP_CONFIG_BACKUP_FILE, JSON.stringify(items.slice(0, TOTAL_BACKUP_LIMIT), null, 2));
}

function normalizeBackupItem(value = {}) {
  const raw = isPlainObject(value) ? value : {};
  const groupId = normalizeGroupId(raw.groupId || raw.group_id);
  if (!groupId || !isPlainObject(raw.snapshot)) return null;
  return {
    id: String(raw.id || crypto.randomUUID?.() || crypto.randomBytes(8).toString('hex')).trim(),
    groupId,
    group_id: groupId,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    operator: String(raw.operator || 'webConsole').slice(0, 80),
    action: String(raw.action || 'save_config').slice(0, 80),
    note: String(raw.note || '').slice(0, 160),
    snapshot: cloneJsonValue(raw.snapshot, {}),
  };
}

export function createGroupConfigBackup(groupId = '', snapshot = {}, meta = {}) {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId || !isPlainObject(snapshot)) return null;
  const item = normalizeBackupItem({
    groupId: normalizedGroupId,
    snapshot,
    operator: meta.operator || 'webConsole',
    action: meta.action || 'save_config',
    note: meta.note || '',
  });
  if (!item) return null;

  const current = safeReadBackups()
    .map(normalizeBackupItem)
    .filter(Boolean);
  const next = [
    item,
    ...current,
  ];
  const perGroupCount = new Map();
  const pruned = [];
  for (const backup of next) {
    const count = perGroupCount.get(backup.groupId) || 0;
    if (count >= GROUP_BACKUP_LIMIT) continue;
    perGroupCount.set(backup.groupId, count + 1);
    pruned.push(backup);
  }
  safeWriteBackups(pruned);
  return item;
}

export function listGroupConfigBackups(groupId = '', limit = 8) {
  const normalizedGroupId = normalizeGroupId(groupId);
  const max = Math.min(50, Math.max(1, Number(limit || 8)));
  return safeReadBackups()
    .map(normalizeBackupItem)
    .filter(Boolean)
    .filter(item => !normalizedGroupId || item.groupId === normalizedGroupId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, max);
}

export function findGroupConfigBackup(id = '') {
  const targetId = String(id || '').trim();
  if (!targetId) return null;
  return safeReadBackups()
    .map(normalizeBackupItem)
    .filter(Boolean)
    .find(item => item.id === targetId) || null;
}
