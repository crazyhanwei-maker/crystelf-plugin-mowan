import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';

export const LOG_FILE_PATTERN = /\.(log|txt|out|err)$/i;
export const MAX_LOG_FILES = 12;
export const MAX_LOG_WINDOW_BYTES = 3 * 1024 * 1024;
export const MAX_LOG_WINDOW_BYTES_LIMIT = 10 * 1024 * 1024;

export function normalizeInteger(value, fallback = 0, min = 0, max = 1000000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function uniquePush(list, value) {
  if (!value || list.includes(value)) return;
  list.push(value);
}

/**
 * 扫描候选日志目录（bot 根 + 插件根 + 运行目录）。
 * 与 logDiagnosisConsole 原逻辑一致，提取为共享模块供诊断与日志查看复用。
 */
export function getCandidateDirectories(source = 'auto') {
  const normalizedSource = String(source || 'auto').trim().toLowerCase();
  const directories = [];
  const pluginRoot = Path.root || process.cwd();
  const yunzaiRoot = Path.yunzai || process.cwd();

  if (normalizedSource === 'auto' || normalizedSource === 'bot' || normalizedSource === 'all') {
    [
      path.join(yunzaiRoot, 'logs'),
      path.join(yunzaiRoot, 'log'),
      path.join(yunzaiRoot, 'data', 'logs'),
      path.join(process.cwd(), 'logs'),
      path.join(process.cwd(), 'log'),
    ].forEach(item => uniquePush(directories, path.resolve(item)));
  }

  if (normalizedSource === 'auto' || normalizedSource === 'plugin' || normalizedSource === 'all') {
    [
      path.join(pluginRoot, 'logs'),
      path.join(pluginRoot, 'log'),
      path.join(pluginRoot, 'temp'),
      path.join(pluginRoot, 'data', 'crystelf', 'debug'),
      path.join(process.cwd(), 'data', 'crystelf', 'debug'),
      path.join(process.cwd(), 'temp'),
    ].forEach(item => uniquePush(directories, path.resolve(item)));
  }

  return directories;
}

/**
 * 生成「Bot / 插件 / 运行目录」相对展示路径。
 */
export function getDisplayPath(filePath = '') {
  const roots = [
    ['插件', Path.root],
    ['Bot', Path.yunzai],
    ['运行目录', process.cwd()],
  ];
  for (const [rootLabel, root] of roots) {
    if (!root) continue;
    const relative = path.relative(root, filePath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return `${rootLabel}/${relative.replace(/\\/g, '/')}`;
    }
  }
  return path.basename(filePath);
}

/**
 * 列出候选目录下的日志文件，按名称优先级 + 修改时间排序，最多 MAX_LOG_FILES 个。
 */
export function listCandidateLogFiles(source = 'auto', logger = { warn: () => {} }) {
  const files = [];
  const seenPaths = new Set();
  for (const directory of getCandidateDirectories(source)) {
    try {
      if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue;
      for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!dirent.isFile()) continue;
        const name = dirent.name;
        if (!LOG_FILE_PATTERN.test(name) && !/(log|err|stderr|stdout|pm2|yunzai|bot|console)/i.test(name)) continue;
        const filePath = path.join(directory, name);
        const normalizedPath = path.resolve(filePath).toLowerCase();
        if (seenPaths.has(normalizedPath)) continue;
        seenPaths.add(normalizedPath);
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size <= 0) continue;
        const lowerName = name.toLowerCase();
        let priority = 0;
        if (/(error|err|stderr|crash|exception)/i.test(lowerName)) priority += 40;
        if (/(bot|yunzai|trss|miao|console|pm2|command)/i.test(lowerName)) priority += 20;
        if (/(crystelf|group-management|ai-usage|search-web|tts)/i.test(lowerName)) priority += 8;
        files.push({
          filePath,
          displayPath: getDisplayPath(filePath),
          name,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          mtime: stat.mtime.toISOString(),
          priority,
        });
      }
    } catch (error) {
      logger.warn(`[webConsole] 扫描日志目录失败: ${directory} | ${error.message}`);
    }
  }

  return files
    .sort((a, b) => (b.priority - a.priority) || (b.mtimeMs - a.mtimeMs))
    .slice(0, MAX_LOG_FILES);
}

/**
 * 按字节读取文件尾部文本（与 logDiagnosisConsole 原逻辑一致）。
 */
export function readLogTailText(filePath = '', maxLength = 12000) {
  const limit = normalizeInteger(maxLength, 12000, 1000, 240000);
  const readBytes = Math.min(limit * 4, 1024 * 1024);
  let fd = null;
  try {
    const stat = fs.statSync(filePath);
    const size = Number(stat.size || 0);
    if (size <= 0) return '';
    const length = Math.min(size, readBytes);
    const start = Math.max(0, size - length);
    const buffer = Buffer.alloc(length);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, length, start);
    const text = buffer.toString('utf8');
    return text.length > limit ? text.slice(-limit) : text;
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

/**
 * 按行窗口读取日志文件。
 * - mode=tail：返回文件末尾 limit 行
 * - mode=window：返回 [startLine, startLine + limit) 行（用于向前翻页）
 * 单次最多读取尾部 maxBytes（默认 3MB），超出标记 truncated / prefixTruncated。
 */
export function readLogFileWindow(filePath = '', options = {}) {
  const mode = options.mode === 'window' ? 'window' : 'tail';
  const limit = normalizeInteger(options.limit, 2000, 100, 20000);
  const maxBytes = normalizeInteger(options.maxBytes, MAX_LOG_WINDOW_BYTES, 64 * 1024, MAX_LOG_WINDOW_BYTES_LIMIT);
  let fd = null;
  try {
    const stat = fs.statSync(filePath);
    const size = Number(stat.size || 0);
    if (size <= 0) {
      return {
        file: filePath,
        size: 0,
        mtime: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
        mode,
        truncated: false,
        prefixTruncated: false,
        readLines: 0,
        windowStart: 0,
        windowEnd: 0,
        windowLines: 0,
        olderAvailable: false,
        lines: [],
      };
    }
    const truncated = size > maxBytes;
    const readBytes = Math.min(size, maxBytes);
    const start = Math.max(0, size - readBytes);
    const buffer = Buffer.alloc(readBytes);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, readBytes, start);
    const text = buffer.toString('utf8');
    // 行切分：末尾换行产生的空行不计入
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const readLines = lines.length;
    const requestedStart = normalizeInteger(options.startLine, 0, 0, readLines);
    const windowStart = mode === 'window' ? requestedStart : Math.max(0, readLines - limit);
    const windowEnd = Math.min(readLines, windowStart + limit);
    return {
      file: filePath,
      size,
      mtime: stat.mtime.toISOString(),
      mtimeMs: stat.mtimeMs,
      mode,
      truncated,
      prefixTruncated: start > 0,
      readBytes,
      readLines,
      windowStart,
      windowEnd,
      windowLines: windowEnd - windowStart,
      olderAvailable: windowStart > 0,
      lines: lines.slice(windowStart, windowEnd),
    };
  } catch (error) {
    return {
      file: filePath,
      success: false,
      error: error.message,
    };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}
