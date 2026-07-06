import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { classifyAiUsageError, formatAiUsageErrorCategory } from './usageLogger.js';

const API_QUALITY_DIR = path.join(process.cwd(), 'data', 'crystelf', 'debug');
const API_QUALITY_FILE = path.join(API_QUALITY_DIR, 'api-quality.log');
const API_QUALITY_MAX_BYTES = 5 * 1024 * 1024;
const API_QUALITY_BACKUP_COUNT = 3;
const API_QUALITY_ROTATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let lastRotateCheckAt = 0;
let rotateQueue = Promise.resolve();

const fallbackLogger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

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

function sanitizeValue(value, maxLength = 240) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeStage(entry = {}) {
  const raw = String(entry.stage || '').trim().toLowerCase();
  if (raw === 'success' || entry.success === true) return 'success';
  if (raw === 'error' || raw === 'failure' || entry.success === false || entry.error) return 'error';
  return raw || 'unknown';
}

function normalizeApiRole(entry = {}) {
  const raw = String(entry.apiRole || entry.api_role || '').trim().toLowerCase();
  if (raw === 'fallback' || raw === 'backup' || raw === '备用') return 'fallback';
  if (raw === 'primary' || raw === 'main' || raw === '主') return 'primary';
  if (entry.fallback === true || entry.usedFallback === true) return 'fallback';
  return 'primary';
}

function isExpectedApiQualityLogPath(filePath = '') {
  const resolvedDir = path.resolve(API_QUALITY_DIR);
  const resolvedFile = path.resolve(filePath);
  const basename = path.basename(resolvedFile);
  return path.dirname(resolvedFile) === resolvedDir && /^api-quality\.log(?:\.\d+)?$/.test(basename);
}

function getApiQualityBackupFile(index = 1) {
  return `${API_QUALITY_FILE}.${Number(index || 1)}`;
}

async function removeApiQualityFileSafe(filePath = '') {
  if (!isExpectedApiQualityLogPath(filePath)) {
    return;
  }
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function renameApiQualityFileSafe(source = '', target = '') {
  if (!isExpectedApiQualityLogPath(source) || !isExpectedApiQualityLogPath(target)) {
    return;
  }
  try {
    await removeApiQualityFileSafe(target);
    await fs.rename(source, target);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function rotateApiQualityLogNow() {
  await fs.mkdir(API_QUALITY_DIR, { recursive: true });
  const stat = await fs.stat(API_QUALITY_FILE).catch(() => null);
  if (!stat || Number(stat.size || 0) < API_QUALITY_MAX_BYTES) {
    return false;
  }
  await removeApiQualityFileSafe(getApiQualityBackupFile(API_QUALITY_BACKUP_COUNT));
  for (let index = API_QUALITY_BACKUP_COUNT - 1; index >= 1; index -= 1) {
    await renameApiQualityFileSafe(getApiQualityBackupFile(index), getApiQualityBackupFile(index + 1));
  }
  await renameApiQualityFileSafe(API_QUALITY_FILE, getApiQualityBackupFile(1));
  return true;
}

async function rotateApiQualityLogIfNeeded() {
  const now = Date.now();
  if (now - lastRotateCheckAt < API_QUALITY_ROTATE_CHECK_INTERVAL_MS) {
    return false;
  }
  lastRotateCheckAt = now;
  rotateQueue = rotateQueue
    .then(() => rotateApiQualityLogNow())
    .catch(error => {
      fallbackLogger.warn(`[apiQualityLogger] API质量日志轮转失败: ${error.message}`);
      return false;
    });
  return rotateQueue;
}

function getFileStatSafe(filePath = '') {
  try {
    return fsSync.existsSync(filePath) ? fsSync.statSync(filePath) : null;
  } catch {
    return null;
  }
}

export function getApiQualityLogRetentionStatus() {
  const current = getFileStatSafe(API_QUALITY_FILE);
  const backups = [];
  for (let index = 1; index <= API_QUALITY_BACKUP_COUNT; index += 1) {
    const filePath = getApiQualityBackupFile(index);
    const stat = getFileStatSafe(filePath);
    backups.push({
      index,
      file: filePath,
      exists: Boolean(stat),
      sizeBytes: Number(stat?.size || 0),
      updatedAt: stat ? stat.mtime.toISOString() : '',
    });
  }
  return {
    file: API_QUALITY_FILE,
    maxBytes: API_QUALITY_MAX_BYTES,
    backupCount: API_QUALITY_BACKUP_COUNT,
    rotateCheckIntervalMs: API_QUALITY_ROTATE_CHECK_INTERVAL_MS,
    current: {
      exists: Boolean(current),
      sizeBytes: Number(current?.size || 0),
      updatedAt: current ? current.mtime.toISOString() : '',
      usagePercent: current ? Math.min(100, Math.round((Number(current.size || 0) / API_QUALITY_MAX_BYTES) * 10000) / 100) : 0,
    },
    backups,
  };
}

export async function logExternalApiUsage(entry = {}) {
  try {
    await fs.mkdir(API_QUALITY_DIR, { recursive: true });
    await rotateApiQualityLogIfNeeded();
    const errorCategory = entry.error ? (entry.errorCategory || classifyAiUsageError(entry.error)) : '';
    const payload = {
      time: formatLocalDateTime(new Date()),
      stage: normalizeStage(entry),
      api_type: sanitizeValue(entry.apiType || entry.api_type || 'external', 80),
      api_role: sanitizeValue(normalizeApiRole(entry), 40),
      scene: sanitizeValue(entry.scene || entry.apiType || 'external', 100),
      provider: sanitizeValue(entry.provider || 'external-api', 80),
      model: sanitizeValue(entry.model || 'unknown', 160),
      endpoint: sanitizeValue(entry.endpoint || entry.url || '', 220),
      status_code: Number.isFinite(Number(entry.statusCode)) ? Number(entry.statusCode) : undefined,
      elapsed_ms: Number.isFinite(Number(entry.elapsedMs)) ? Number(entry.elapsedMs) : undefined,
      request_preview: sanitizeValue(entry.requestPreview, 240),
      response_preview: sanitizeValue(entry.responsePreview, 240),
      error: sanitizeValue(entry.error, 240),
      error_category: errorCategory ? sanitizeValue(errorCategory, 80) : undefined,
      error_category_label: errorCategory ? sanitizeValue(formatAiUsageErrorCategory(errorCategory), 80) : undefined,
    };
    await fs.appendFile(API_QUALITY_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (error) {
    fallbackLogger.warn(`[apiQualityLogger] API质量日志写入失败: ${error.message}`);
  }
}

export {
  API_QUALITY_BACKUP_COUNT,
  API_QUALITY_FILE,
  API_QUALITY_MAX_BYTES,
};
