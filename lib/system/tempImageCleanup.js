import fs from 'fs/promises';
import path from 'path';

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const DEFAULT_RETENTION_DAYS = 3;
const DEFAULT_MAX_FILES = 300;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastCleanupAt = 0;
let cleanupPromise = null;
const cleanupStats = {
  totalRuns: 0,
  totalRemoved: 0,
  totalFreedBytes: 0,
  lastStartedAt: '',
  lastFinishedAt: '',
  lastErrorAt: '',
  lastError: '',
  lastResult: null,
};

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function isInsideRoot(rootDir = '', target = '') {
  const relative = path.relative(rootDir, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function listImageFiles(dir, rootDir, output = []) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (!isInsideRoot(rootDir, fullPath)) continue;
    if (entry.isDirectory()) {
      await listImageFiles(fullPath, rootDir, output);
      continue;
    }
    if (!entry.isFile() || !IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    try {
      const stat = await fs.stat(fullPath);
      output.push({
        path: fullPath,
        mtimeMs: Number(stat.mtimeMs || 0),
        size: Number(stat.size || 0),
      });
    } catch {
      // Ignore files deleted during traversal.
    }
  }
  return output;
}

export async function cleanupCrystelfTempImages(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin'));
  const retentionDays = clampInteger(options.retentionDays ?? process.env.CRYSTELF_TEMP_IMAGE_RETENTION_DAYS, 0, 365, DEFAULT_RETENTION_DAYS);
  const maxFiles = clampInteger(options.maxFiles ?? process.env.CRYSTELF_TEMP_IMAGE_MAX_FILES, 0, 100000, DEFAULT_MAX_FILES);
  const now = Date.now();
  const cutoffMs = retentionDays > 0 ? now - retentionDays * 24 * 60 * 60 * 1000 : 0;
  cleanupStats.lastStartedAt = new Date(now).toISOString();

  try {
    const files = await listImageFiles(rootDir, rootDir);
    const deletions = new Set();
    if (cutoffMs > 0) {
      files
        .filter(item => item.mtimeMs > 0 && item.mtimeMs < cutoffMs)
        .forEach(item => deletions.add(item.path));
    }
    if (maxFiles > 0 && files.length > maxFiles) {
      files
        .slice()
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(maxFiles)
        .forEach(item => deletions.add(item.path));
    }

    let removed = 0;
    let freedBytes = 0;
    for (const filePath of deletions) {
      if (!isInsideRoot(rootDir, filePath)) continue;
      const found = files.find(item => item.path === filePath);
      try {
        await fs.unlink(filePath);
        removed += 1;
        freedBytes += Number(found?.size || 0);
      } catch {
        // Ignore files already removed or locked by another render.
      }
    }

    const result = {
      rootDir,
      scanned: files.length,
      removed,
      freedBytes,
      retentionDays,
      maxFiles,
    };
    cleanupStats.totalRuns += 1;
    cleanupStats.totalRemoved += removed;
    cleanupStats.totalFreedBytes += freedBytes;
    cleanupStats.lastFinishedAt = new Date().toISOString();
    cleanupStats.lastResult = result;
    cleanupStats.lastError = '';
    return result;
  } catch (error) {
    cleanupStats.lastErrorAt = new Date().toISOString();
    cleanupStats.lastError = error.message || String(error);
    throw error;
  }
}

export function scheduleCrystelfTempImageCleanup(options = {}) {
  const intervalMs = clampInteger(options.intervalMs ?? process.env.CRYSTELF_TEMP_IMAGE_CLEANUP_INTERVAL_MS, 60_000, 24 * 60 * 60 * 1000, DEFAULT_INTERVAL_MS);
  const now = Date.now();
  if (cleanupPromise || now - lastCleanupAt < intervalMs) {
    return cleanupPromise || Promise.resolve(null);
  }
  lastCleanupAt = now;
  cleanupPromise = cleanupCrystelfTempImages(options)
    .then(result => {
      if (result?.removed > 0) {
        logger.info(`[crystelf-temp] 已清理渲染临时图片 ${result.removed} 个，释放 ${result.freedBytes} 字节`);
      }
      return result;
    })
    .catch(error => {
      logger.warn(`[crystelf-temp] 清理渲染临时图片失败: ${error.message}`);
      return null;
    })
    .finally(() => {
      cleanupPromise = null;
    });
  return cleanupPromise;
}

export function getCrystelfTempImageCleanupStatus(options = {}) {
  const intervalMs = clampInteger(options.intervalMs ?? process.env.CRYSTELF_TEMP_IMAGE_CLEANUP_INTERVAL_MS, 60_000, 24 * 60 * 60 * 1000, DEFAULT_INTERVAL_MS);
  const retentionDays = clampInteger(options.retentionDays ?? process.env.CRYSTELF_TEMP_IMAGE_RETENTION_DAYS, 0, 365, DEFAULT_RETENTION_DAYS);
  const maxFiles = clampInteger(options.maxFiles ?? process.env.CRYSTELF_TEMP_IMAGE_MAX_FILES, 0, 100000, DEFAULT_MAX_FILES);
  const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin'));
  const nextCleanupAt = lastCleanupAt > 0 ? new Date(lastCleanupAt + intervalMs).toISOString() : '';
  return {
    rootDir,
    retentionDays,
    maxFiles,
    intervalMs,
    running: Boolean(cleanupPromise),
    lastCleanupAt: lastCleanupAt > 0 ? new Date(lastCleanupAt).toISOString() : '',
    nextCleanupAt,
    ...cleanupStats,
    lastResult: cleanupStats.lastResult ? { ...cleanupStats.lastResult } : null,
  };
}
