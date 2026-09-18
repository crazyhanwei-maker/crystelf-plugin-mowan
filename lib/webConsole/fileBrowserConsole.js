import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const hljs = require('highlight.js');

function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizePathForComparison(value = '') {
  const normalized = path.resolve(String(value || ''));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathInsideRoot(targetPath = '', rootPath = '') {
  const normalizedTarget = normalizePathForComparison(targetPath);
  const normalizedRoot = normalizePathForComparison(rootPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function getRealPathSafe(targetPath = '') {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    try {
      return fs.realpathSync(targetPath);
    } catch {
      return '';
    }
  }
}

function findNearestExistingParent(targetPath = '') {
  let current = path.resolve(String(targetPath || '.'));
  while (current) {
    if (fs.existsSync(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (!parent || parent === current) {
      return '';
    }
    current = parent;
  }
  return '';
}

export function createFileBrowserConsole(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const blockedNames = options.blockedNames || new Set(['.git', 'node_modules', 'temp']);
  const maxFileBytes = Number(options.maxFileBytes || 2 * 1024 * 1024);
  const maxUploadBytes = Number(options.maxUploadBytes || 30 * 1024 * 1024);
  const maxDirectoryEntries = Number(options.maxDirectoryEntries || 500);
  const maxSearchResults = Number(options.maxSearchResults || 120);
  const maxSearchPreviewLength = Number(options.maxSearchPreviewLength || 180);
  const textExtensions = options.textExtensions || new Set([
    '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml', '.toml',
    '.ini', '.conf', '.sh', '.ps1', '.py', '.ts', '.tsx', '.jsx', '.vue', '.sql', '.log',
    '.env', '.gitignore', '.editorconfig', '.prettierrc', '.eslintrc',
  ]);
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const runtimeUserName = (() => {
    try {
      return os.userInfo().username || '';
    } catch {
      return '';
    }
  })();
  let userNameMap = null;
  let groupNameMap = null;

  function readUnixNameMap(filePath = '') {
    if (process.platform === 'win32') {
      return new Map();
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return new Map(content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(':'))
        .filter(parts => parts.length >= 3 && /^\d+$/.test(parts[2]))
        .map(parts => [Number(parts[2]), parts[0]]));
    } catch {
      return new Map();
    }
  }

  function getUserName(uid) {
    if (process.platform === 'win32') {
      return runtimeUserName;
    }
    if (!userNameMap) {
      userNameMap = readUnixNameMap('/etc/passwd');
    }
    return userNameMap.get(Number(uid)) || '';
  }

  function getGroupName(gid) {
    if (process.platform === 'win32') {
      return '';
    }
    if (!groupNameMap) {
      groupNameMap = readUnixNameMap('/etc/group');
    }
    return groupNameMap.get(Number(gid)) || '';
  }

  function formatMode(stat = null) {
    const mode = Number(stat?.mode);
    if (!Number.isFinite(mode)) {
      return '-';
    }
    return (mode & 0o777).toString(8).padStart(3, '0');
  }

  function formatOwner(stat = null) {
    const uid = Number(stat?.uid);
    if (process.platform === 'win32') {
      return runtimeUserName || '-';
    }
    if (!Number.isFinite(uid)) {
      return '-';
    }
    const userName = getUserName(uid);
    return userName ? `${userName} (${uid})` : String(uid);
  }

  function formatGroup(stat = null) {
    const gid = Number(stat?.gid);
    if (process.platform === 'win32') {
      return '-';
    }
    if (!Number.isFinite(gid)) {
      return '-';
    }
    const groupName = getGroupName(gid);
    return groupName ? `${groupName} (${gid})` : String(gid);
  }

  function buildStatMetadata(stat = null) {
    return {
      permission: formatMode(stat),
      owner: formatOwner(stat),
      group: formatGroup(stat),
    };
  }

  function ensurePathResolvedWithinRoot(targetPath = '', rootPath = '', pathOptions = {}) {
    const allowMissing = pathOptions.allowMissing === true;
    const rootRealPath = getRealPathSafe(rootPath) || path.resolve(rootPath);
    const probePath = fs.existsSync(targetPath)
      ? path.resolve(targetPath)
      : allowMissing
        ? findNearestExistingParent(targetPath)
        : '';
    const resolvedProbePath = probePath
      ? (getRealPathSafe(probePath) || path.resolve(probePath))
      : path.resolve(targetPath);

    if (!isPathInsideRoot(resolvedProbePath, rootRealPath)) {
      throw createHttpError(400, '文件路径越界', 'FILE_BROWSER_PATH_OUT_OF_RANGE');
    }

    return {
      rootRealPath,
      resolvedProbePath,
    };
  }

  function normalizeRelativePath(value = '') {
    // 控制台有口令保护：支持绝对路径与 .. 回溯，浏览范围不再限制在根目录内
    const raw = String(value || '').trim().replace(/\\/g, '/');
    if (raw.startsWith('/')) {
      const normalizedAbsolute = path.posix.normalize(raw);
      return normalizedAbsolute === '' ? '/' : normalizedAbsolute;
    }
    const normalized = path.posix.normalize(`/${raw}`).replace(/^\/+/, '');
    if (!normalized || normalized === '.') {
      return '';
    }
    return normalized;
  }

  function isBlockedSegment(segment = '') {
    const value = String(segment || '').trim().toLowerCase();
    if (!value) return false;
    if (blockedNames.has(value)) return true;
    return value.startsWith('.');
  }

  function resolvePath(value = '', pathOptions = {}) {
    const normalizedRelativePath = normalizeRelativePath(value);
    const segments = normalizedRelativePath.split('/').filter(Boolean);
    if (segments.some(segment => isBlockedSegment(segment))) {
      throw createHttpError(403, '当前路径不允许在网页控制台中访问', 'FILE_BROWSER_PATH_BLOCKED');
    }

    const absolutePath = path.resolve(normalizedRelativePath || '.');

    const allowMissing = pathOptions.allowMissing === true;
    const expectedType = pathOptions.expectedType || 'any';
    let stat = null;


    if (fs.existsSync(absolutePath)) {
      stat = fs.statSync(absolutePath);
    } else if (!allowMissing) {
      throw createHttpError(404, '目标文件不存在', 'FILE_BROWSER_TARGET_NOT_FOUND');
    }

    if (stat) {
      if (expectedType === 'directory' && !stat.isDirectory()) {
        throw createHttpError(400, '目标不是目录', 'FILE_BROWSER_TARGET_NOT_DIRECTORY');
      }
      if (expectedType === 'file' && !stat.isFile()) {
        throw createHttpError(400, '目标不是文件', 'FILE_BROWSER_TARGET_NOT_FILE');
      }
    }

    return {
      rootDir,
      relativePath: normalizedRelativePath,
      absolutePath,
      stat,
    };
  }

  function getDisplayName(relativePath = '') {
    if (!relativePath) {
      return path.basename(rootDir) || rootDir;
    }
    return path.basename(relativePath);
  }

  function escapeHtml(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isLikelyTextFile(filePath = '', buffer = null) {
    const baseName = path.basename(filePath);
    const extension = path.extname(filePath).toLowerCase();
    if (textExtensions.has(extension) || textExtensions.has(baseName.toLowerCase())) {
      return true;
    }
    if (!buffer) {
      return extension === '';
    }
    return !buffer.includes(0);
  }

  function getHighlightLanguage(filePath = '') {
    const extension = path.extname(filePath).toLowerCase();
    const baseName = path.basename(filePath).toLowerCase();
    const languageMap = {
      '.js': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.json': 'json',
      '.md': 'markdown',
      '.html': 'xml',
      '.css': 'css',
      '.yml': 'yaml',
      '.yaml': 'yaml',
      '.toml': 'toml',
      '.ini': 'ini',
      '.conf': 'ini',
      '.sh': 'bash',
      '.ps1': 'powershell',
      '.py': 'python',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.jsx': 'javascript',
      '.vue': 'xml',
      '.sql': 'sql',
      '.log': 'plaintext',
      '.txt': 'plaintext',
      '.env': 'bash',
    };
    const baseNameLanguageMap = {
      '.gitignore': 'plaintext',
      '.editorconfig': 'ini',
      '.prettierrc': 'json',
      '.eslintrc': 'json',
    };
    return languageMap[extension] || baseNameLanguageMap[baseName] || '';
  }

  function buildHighlightPayload(payload = {}) {
    const requestedPath = typeof payload?.path === 'string' ? payload.path : '';
    const hasInlineContent = typeof payload?.content === 'string';
    const target = resolvePath(requestedPath, { expectedType: 'file' });
    let content = '';

    if (hasInlineContent) {
      content = payload.content;
    } else {
      if (Number(target.stat?.size || 0) > maxFileBytes) {
        throw createHttpError(413, `文件过大，仅支持读取不超过 ${Math.round(maxFileBytes / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
      }
      content = fs.readFileSync(target.absolutePath, 'utf8');
    }

    if (Buffer.byteLength(content, 'utf8') > maxFileBytes) {
      throw createHttpError(413, `文件过大，仅支持预览不超过 ${Math.round(maxFileBytes / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
    }
    if (!isLikelyTextFile(target.relativePath, Buffer.from(content, 'utf8'))) {
      throw createHttpError(415, '仅支持预览文本文件', 'FILE_BROWSER_UNSUPPORTED_FILE_TYPE');
    }

    const preferredLanguage = getHighlightLanguage(target.relativePath);
    let highlightResult = null;
    try {
      if (preferredLanguage && hljs.getLanguage(preferredLanguage)) {
        highlightResult = hljs.highlight(content, {
          language: preferredLanguage,
          ignoreIllegals: true,
        });
      } else {
        highlightResult = hljs.highlightAuto(content);
      }
    } catch {
      highlightResult = {
        value: escapeHtml(content),
        language: preferredLanguage || '',
      };
    }

    return {
      success: true,
      preview: {
        path: target.relativePath,
        name: getDisplayName(target.relativePath),
        language: preferredLanguage || '',
        detectedLanguage: String(highlightResult?.language || preferredLanguage || 'plaintext'),
        lineCount: content ? content.split(/\r?\n/).length : 1,
        byteLength: Buffer.byteLength(content, 'utf8'),
        html: String(highlightResult?.value || '').replace(/\r\n?/g, '\n'),
        generatedAt: Date.now(),
      },
    };
  }

  function buildTreePayload(pathValue = '') {
    const target = resolvePath(pathValue, { expectedType: 'directory' });
    const entries = fs.readdirSync(target.absolutePath, { withFileTypes: true })
      .filter(item => !isBlockedSegment(item.name))
      .slice(0, maxDirectoryEntries)
      .map(item => {
        const relativePath = path.posix.join(target.relativePath, item.name).replace(/\\/g, '/');
        const absolutePath = path.join(target.absolutePath, item.name);
        const stat = fs.statSync(absolutePath);
        return {
          name: item.name,
          path: relativePath,
          type: item.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          editable: item.isFile() ? isLikelyTextFile(relativePath) : false,
          ...buildStatMetadata(stat),
        };
      })
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === 'directory' ? -1 : 1;
        }
        return left.name.localeCompare(right.name, 'zh-CN');
      });

    return {
      success: true,
      root: {
        path: '',
        name: path.basename(rootDir) || rootDir,
      },
      current: {
        path: target.relativePath,
        name: getDisplayName(target.relativePath),
        type: 'directory',
        size: Number(target.stat?.size || 0),
        mtimeMs: Number(target.stat?.mtimeMs || 0),
        ...buildStatMetadata(target.stat),
      },
      entries,
    };
  }

  function readFile(pathValue = '') {
    const target = resolvePath(pathValue, { expectedType: 'file' });
    if (Number(target.stat?.size || 0) > maxFileBytes) {
      throw createHttpError(413, `文件过大，仅支持读取不超过 ${Math.round(maxFileBytes / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
    }

    const buffer = fs.readFileSync(target.absolutePath);
    if (!isLikelyTextFile(target.relativePath, buffer)) {
      throw createHttpError(415, '仅支持读取文本文件', 'FILE_BROWSER_UNSUPPORTED_FILE_TYPE');
    }

    const content = buffer.toString('utf8');
    return {
      success: true,
      file: {
        path: target.relativePath,
        name: getDisplayName(target.relativePath),
        size: buffer.length,
        mtimeMs: Number(target.stat?.mtimeMs || 0),
        content,
        editable: true,
        ...buildStatMetadata(target.stat),
      },
    };
  }

  function writeFile(payload = {}) {
    const pathValue = payload?.path;
    const content = typeof payload?.content === 'string' ? payload.content : '';
    const expectedMtimeMs = Number(payload?.expectedMtimeMs || 0);
    const forceOverwrite = payload?.forceOverwrite === true;
    const target = resolvePath(pathValue, { expectedType: 'file' });
    if (!isLikelyTextFile(target.relativePath)) {
      throw createHttpError(415, '仅支持保存文本文件', 'FILE_BROWSER_UNSUPPORTED_FILE_TYPE');
    }
    if (Buffer.byteLength(content, 'utf8') > maxFileBytes) {
      throw createHttpError(413, `文件过大，仅支持保存不超过 ${Math.round(maxFileBytes / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
    }

    if (!forceOverwrite && Number.isFinite(expectedMtimeMs) && expectedMtimeMs > 0) {
      const currentStat = fs.statSync(target.absolutePath);
      const currentMtimeMs = Number(currentStat.mtimeMs || 0);
      if (Math.abs(currentMtimeMs - expectedMtimeMs) > 1) {
        const currentBuffer = fs.readFileSync(target.absolutePath);
        if (!isLikelyTextFile(target.relativePath, currentBuffer)) {
          throw createHttpError(415, '仅支持保存文本文件', 'FILE_BROWSER_UNSUPPORTED_FILE_TYPE');
        }
        const currentContent = currentBuffer.toString('utf8');
        if (currentContent !== content) {
          const conflictError = createHttpError(409, '文件已被其他修改，请刷新后确认差异再决定是否覆盖', 'FILE_BROWSER_WRITE_CONFLICT');
          conflictError.details = {
            conflict: {
              path: target.relativePath,
              expectedMtimeMs,
              actualMtimeMs: currentMtimeMs,
              currentContent,
            file: {
                path: target.relativePath,
                name: getDisplayName(target.relativePath),
                size: currentBuffer.length,
                mtimeMs: currentMtimeMs,
                editable: true,
                ...buildStatMetadata(currentStat),
              },
            },
          };
          throw conflictError;
        }

        return {
          success: true,
          file: {
            path: target.relativePath,
            name: getDisplayName(target.relativePath),
            size: currentBuffer.length,
            mtimeMs: currentMtimeMs,
            editable: true,
            ...buildStatMetadata(currentStat),
          },
        };
      }
    }

    fs.writeFileSync(target.absolutePath, content, 'utf8');
    const nextStat = fs.statSync(target.absolutePath);
    return {
      success: true,
      file: {
        path: target.relativePath,
        name: getDisplayName(target.relativePath),
        size: nextStat.size,
        mtimeMs: Number(nextStat.mtimeMs || 0),
        editable: true,
        ...buildStatMetadata(nextStat),
      },
    };
  }

  function createFile(payload = {}) {
    const pathValue = payload?.path;
    const content = typeof payload?.content === 'string' ? payload.content : '';
    const target = resolvePath(pathValue, { allowMissing: true });
    if (!target.relativePath) {
      throw createHttpError(400, '目标文件路径不能为空', 'FILE_BROWSER_TARGET_EMPTY');
    }
    if (target.stat) {
      throw createHttpError(409, '目标文件已存在', 'FILE_BROWSER_TARGET_EXISTS');
    }
    if (!isLikelyTextFile(target.relativePath, Buffer.from(content, 'utf8'))) {
      throw createHttpError(415, '仅支持创建文本文件', 'FILE_BROWSER_UNSUPPORTED_FILE_TYPE');
    }
    if (Buffer.byteLength(content, 'utf8') > maxFileBytes) {
      throw createHttpError(413, `文件过大，仅支持创建不超过 ${Math.round(maxFileBytes / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
    }

    const parentRelativePath = path.posix.dirname(target.relativePath).replace(/^\.$/, '');
    resolvePath(parentRelativePath, { expectedType: 'directory' });
    fs.writeFileSync(target.absolutePath, content, 'utf8');
    const stat = fs.statSync(target.absolutePath);
    return {
      success: true,
      file: {
        path: target.relativePath,
        name: getDisplayName(target.relativePath),
        size: stat.size,
        mtimeMs: Number(stat.mtimeMs || 0),
        editable: true,
        created: true,
        ...buildStatMetadata(stat),
      },
    };
  }

  function uploadFile(payload = {}) {
    const dirValue = payload?.dir;
    const rawName = String(payload?.name || '').trim();
    const data = Buffer.isBuffer(payload?.data) ? payload.data : null;
    const overwrite = payload?.overwrite === true;

    if (!data || data.length === 0) {
      throw createHttpError(400, '上传内容为空', 'FILE_BROWSER_UPLOAD_EMPTY');
    }
    if (!rawName || rawName === '.' || rawName === '..' || /[\/]/.test(rawName) || /[ -]/.test(rawName)) {
      throw createHttpError(400, '文件名不合法', 'FILE_BROWSER_UPLOAD_NAME_INVALID');
    }
    if (data.length > maxUploadBytes) {
      throw createHttpError(413, `文件过大，仅支持上传不超过 ${Math.round(maxUploadBytes / 1024 / 1024)}MB 的文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
    }

    const dirTarget = resolvePath(dirValue, { expectedType: 'directory' });
    const target = resolvePath(dirTarget.relativePath ? `${dirTarget.relativePath}/${rawName}` : rawName, { allowMissing: true });
    if (target.stat) {
      if (!target.stat.isFile()) {
        throw createHttpError(400, '同名目标不是文件', 'FILE_BROWSER_TARGET_NOT_FILE');
      }
      if (!overwrite) {
        throw createHttpError(409, '目标文件已存在', 'FILE_BROWSER_TARGET_EXISTS');
      }
    }

    fs.writeFileSync(target.absolutePath, data);
    const stat = fs.statSync(target.absolutePath);
    return {
      success: true,
      file: {
        path: target.relativePath,
        name: getDisplayName(target.relativePath),
        size: stat.size,
        mtimeMs: Number(stat.mtimeMs || 0),
        editable: isLikelyTextFile(target.relativePath, data),
        uploaded: true,
        ...buildStatMetadata(stat),
      },
    };
  }

  function buildNodePayload(pathValue = '') {
    const target = resolvePath(pathValue);
    const isDirectory = target.stat?.isDirectory?.() === true;
    const isFile = target.stat?.isFile?.() === true;
    return {
      success: true,
      node: {
        path: target.relativePath,
        name: getDisplayName(target.relativePath),
        type: isDirectory ? 'directory' : isFile ? 'file' : 'other',
        size: Number(target.stat?.size || 0),
        mtimeMs: Number(target.stat?.mtimeMs || 0),
        editable: isFile ? isLikelyTextFile(target.relativePath) : false,
        ...buildStatMetadata(target.stat),
      },
    };
  }

  function createDirectory(payload = {}) {
    const pathValue = payload?.path;
    const target = resolvePath(pathValue, { allowMissing: true });
    if (!target.relativePath) {
      throw createHttpError(400, '目标目录路径不能为空', 'FILE_BROWSER_TARGET_EMPTY');
    }
    if (target.stat) {
      throw createHttpError(409, '目标目录已存在', 'FILE_BROWSER_TARGET_EXISTS');
    }
    fs.mkdirSync(target.absolutePath, { recursive: true });
    const stat = fs.statSync(target.absolutePath);
    return {
      success: true,
      directory: {
        path: target.relativePath,
        name: getDisplayName(target.relativePath),
        type: 'directory',
        size: Number(stat.size || 0),
        mtimeMs: Number(stat.mtimeMs || 0),
        created: true,
        ...buildStatMetadata(stat),
      },
    };
  }

  function renameNode(payload = {}) {
    const sourcePath = payload?.sourcePath;
    const targetPath = payload?.targetPath;
    const source = resolvePath(sourcePath);
    if (!source.relativePath) {
      throw createHttpError(400, '根目录不允许重命名', 'FILE_BROWSER_ROOT_RENAME_FORBIDDEN');
    }

    const target = resolvePath(targetPath, { allowMissing: true });
    if (!target.relativePath) {
      throw createHttpError(400, '目标路径不能为空', 'FILE_BROWSER_TARGET_EMPTY');
    }
    if (target.stat) {
      throw createHttpError(409, '目标路径已存在', 'FILE_BROWSER_TARGET_EXISTS');
    }
    if (source.absolutePath === target.absolutePath) {
      return buildNodePayload(source.relativePath);
    }

    const targetParentPath = path.posix.dirname(target.relativePath).replace(/^\.$/, '');
    resolvePath(targetParentPath, { expectedType: 'directory' });
    fs.renameSync(source.absolutePath, target.absolutePath);
    return buildNodePayload(target.relativePath);
  }

  function copyFile(payload = {}) {
    const sourcePath = payload?.sourcePath;
    const targetPath = payload?.targetPath;
    const source = resolvePath(sourcePath, { expectedType: 'file' });
    if (!source.relativePath) {
      throw createHttpError(400, '根目录不允许复制', 'FILE_BROWSER_ROOT_COPY_FORBIDDEN');
    }

    const target = resolvePath(targetPath, { allowMissing: true });
    if (!target.relativePath) {
      throw createHttpError(400, '目标文件路径不能为空', 'FILE_BROWSER_TARGET_EMPTY');
    }
    if (target.stat) {
      throw createHttpError(409, '目标文件已存在', 'FILE_BROWSER_TARGET_EXISTS');
    }

    const sourceSize = Number(source.stat?.size || 0);
    if (sourceSize > maxFileBytes) {
      throw createHttpError(413, `文件过大，仅支持复制不超过 ${Math.round(maxFileBytes / 1024 / 1024)}MB 的文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
    }

    const targetParentPath = path.posix.dirname(target.relativePath).replace(/^\.$/, '');
    resolvePath(targetParentPath, { expectedType: 'directory' });
    fs.copyFileSync(source.absolutePath, target.absolutePath, fs.constants.COPYFILE_EXCL);
    const stat = fs.statSync(target.absolutePath);
    return {
      success: true,
      file: {
        path: target.relativePath,
        name: getDisplayName(target.relativePath),
        size: stat.size,
        mtimeMs: Number(stat.mtimeMs || 0),
        editable: isLikelyTextFile(target.relativePath),
        copied: true,
        sourcePath: source.relativePath,
        ...buildStatMetadata(stat),
      },
    };
  }

  function deleteNode(payload = {}) {
    const targetPath = payload?.path;
    const target = resolvePath(targetPath);
    if (!target.relativePath) {
      throw createHttpError(400, '根目录不允许删除', 'FILE_BROWSER_ROOT_DELETE_FORBIDDEN');
    }

    if (target.stat?.isDirectory?.()) {
      const childEntries = fs.readdirSync(target.absolutePath);
      if (childEntries.length > 0) {
        throw createHttpError(409, '仅允许删除空目录', 'FILE_BROWSER_DIRECTORY_NOT_EMPTY');
      }
      fs.rmdirSync(target.absolutePath);
      return {
        success: true,
        deleted: true,
        node: {
          path: target.relativePath,
          name: getDisplayName(target.relativePath),
          type: 'directory',
        },
      };
    }

    if (target.stat?.isFile?.()) {
      fs.unlinkSync(target.absolutePath);
      return {
        success: true,
        deleted: true,
        node: {
          path: target.relativePath,
          name: getDisplayName(target.relativePath),
          type: 'file',
        },
      };
    }

    throw createHttpError(400, '当前节点不支持删除', 'FILE_BROWSER_DELETE_UNSUPPORTED');
  }

  function normalizeSearchLimit(value = 0) {
    const limit = Number(value || 0);
    if (!Number.isFinite(limit) || limit <= 0) {
      return maxSearchResults;
    }
    return Math.min(maxSearchResults, Math.max(1, Math.round(limit)));
  }

  function buildSearchPreview(line = '', matchStart = 0, matchLength = 0) {
    const source = String(line || '').replace(/\t/g, '  ');
    if (!source) {
      return '(empty line)';
    }
    if (source.length <= maxSearchPreviewLength) {
      return source.trim();
    }

    const safeMatchStart = Math.max(0, Number(matchStart || 0));
    const safeMatchLength = Math.max(1, Number(matchLength || 1));
    const center = safeMatchStart + Math.floor(safeMatchLength / 2);
    const halfWindow = Math.floor(maxSearchPreviewLength / 2);
    const sliceStart = Math.max(0, center - halfWindow);
    const sliceEnd = Math.min(source.length, sliceStart + maxSearchPreviewLength);
    const prefix = sliceStart > 0 ? '...' : '';
    const suffix = sliceEnd < source.length ? '...' : '';
    return `${prefix}${source.slice(sliceStart, sliceEnd).trim()}${suffix}`;
  }

  function searchContent(queryValue = '', searchOptions = {}) {
    const query = String(queryValue || '').trim();
    if (!query) {
      throw createHttpError(400, '搜索关键字不能为空', 'FILE_BROWSER_SEARCH_EMPTY');
    }

    const caseSensitive = searchOptions.caseSensitive === true;
    const limit = normalizeSearchLimit(searchOptions.limit);
    const scope = resolvePath(searchOptions.path || '', { expectedType: 'directory' });
    const stack = [{ relativePath: scope.relativePath, absolutePath: scope.absolutePath }];
    const results = [];
    const normalizedNeedle = caseSensitive ? query : query.toLocaleLowerCase();
    let truncated = false;

    while (stack.length > 0 && results.length < limit) {
      const current = stack.pop();
      const entries = fs.readdirSync(current.absolutePath, { withFileTypes: true })
        .filter(item => !isBlockedSegment(item.name))
        .sort((left, right) => {
          if (left.isDirectory() !== right.isDirectory()) {
            return left.isDirectory() ? -1 : 1;
          }
          return left.name.localeCompare(right.name, 'zh-CN');
        });

      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        const relativePath = path.posix.join(current.relativePath, entry.name).replace(/\\/g, '/');
        const absolutePath = path.join(current.absolutePath, entry.name);

        if (entry.isDirectory()) {
          stack.push({ relativePath, absolutePath });
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        const stat = fs.statSync(absolutePath);
        if (Number(stat.size || 0) > maxFileBytes) {
          continue;
        }

        const buffer = fs.readFileSync(absolutePath);
        if (!isLikelyTextFile(relativePath, buffer)) {
          continue;
        }

        const content = buffer.toString('utf8');
        const lines = content.split(/\r?\n/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex];
          const normalizedLine = caseSensitive ? line : line.toLocaleLowerCase();
          let columnIndex = normalizedLine.indexOf(normalizedNeedle);
          while (columnIndex >= 0) {
            results.push({
              path: relativePath,
              name: getDisplayName(relativePath),
              lineNumber: lineIndex + 1,
              columnNumber: columnIndex + 1,
              matchLength: query.length,
              preview: buildSearchPreview(line, columnIndex, query.length),
            });
            if (results.length >= limit) {
              truncated = true;
              break;
            }
            columnIndex = normalizedLine.indexOf(normalizedNeedle, columnIndex + Math.max(1, normalizedNeedle.length));
          }
          if (results.length >= limit) {
            break;
          }
        }
      }
    }

    return {
      success: true,
      query,
      scopePath: scope.relativePath,
      caseSensitive,
      limit,
      truncated,
      results,
    };
  }

  return {
    buildHighlightPayload,
    buildTreePayload,
    readFile,
    writeFile,
    createFile,
    uploadFile,
    maxUploadBytes,
    buildNodePayload,
    createDirectory,
    renameNode,
    copyFile,
    deleteNode,
    searchContent,
  };
}
