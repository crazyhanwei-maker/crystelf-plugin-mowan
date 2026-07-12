import fs from 'fs';
import path from 'path';

const MD5_PATTERN = /^[a-f0-9]{32}$/i;

function normalizeMd5(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return MD5_PATTERN.test(normalized) ? normalized : '';
}

export function createPersistentMd5Store(options = {}) {
  const filePath = String(options.filePath || '').trim();
  const logger = options.logger || globalThis.logger || console;
  const fsApi = options.fs || fs;
  const pathApi = options.path || path;
  const hashes = new Set();
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    if (!filePath || !fsApi.existsSync(filePath)) return;
    try {
      const lines = fsApi.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const md5 = normalizeMd5(typeof parsed === 'string' ? parsed : parsed?.md5);
          if (md5) hashes.add(md5);
        } catch {
          const md5 = normalizeMd5(line);
          if (md5) hashes.add(md5);
        }
      }
    } catch (error) {
      logger.warn?.(`[image-monitor] 读取持久化 MD5 索引失败: ${error.message}`);
    }
  }

  function has(value = '') {
    load();
    const md5 = normalizeMd5(value);
    return Boolean(md5 && hashes.has(md5));
  }

  function add(value = '') {
    load();
    const md5 = normalizeMd5(value);
    if (!md5 || hashes.has(md5) || !filePath) return false;
    try {
      fsApi.mkdirSync(pathApi.dirname(filePath), { recursive: true });
      fsApi.appendFileSync(filePath, `${JSON.stringify({
        md5,
        firstSeenAt: new Date().toISOString(),
      })}\n`, 'utf8');
      hashes.add(md5);
      return true;
    } catch (error) {
      logger.warn?.(`[image-monitor] 写入持久化 MD5 索引失败: ${error.message}`);
      return false;
    }
  }

  function size() {
    load();
    return hashes.size;
  }

  return { add, has, load, size };
}

export { normalizeMd5 };
