import fs from 'fs';
import path from 'path';

function defaultCreateHttpError(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(String(message || 'Internal Server Error'));
  error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
  if (code) {
    error.code = String(code);
  }
  return error;
}

export function createGroupWelcomeConsole(options = {}) {
  const configRoot = options.configRoot || process.cwd();
  const imageMaxBytes = Number(options.imageMaxBytes || 5 * 1024 * 1024);
  const imageContentTypes = options.imageContentTypes || {};
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : defaultCreateHttpError;
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const sendBinary = typeof options.sendBinary === 'function' ? options.sendBinary : (() => {});
  const isPlainObject = typeof options.isPlainObject === 'function'
    ? options.isPlainObject
    : (value => Boolean(value && typeof value === 'object' && !Array.isArray(value)));
  const readBoolean = typeof options.readBoolean === 'function'
    ? options.readBoolean
    : ((value, fallback = false) => (value === undefined ? fallback : value === true || value === 'true' || value === 1 || value === '1'));
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : (value => String(value || '').trim());
  const isPathInsideRoot = typeof options.isPathInsideRoot === 'function' ? options.isPathInsideRoot : (() => true);
  const getRealPathSafe = typeof options.getRealPathSafe === 'function' ? options.getRealPathSafe : (targetPath => targetPath);
  const ensurePathResolvedWithinRoot = typeof options.ensurePathResolvedWithinRoot === 'function'
    ? options.ensurePathResolvedWithinRoot
    : (() => {});

  function normalizeWelcomeText(value = '') {
    return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, 1000);
  }

  function getImageDir(groupId = '') {
    const normalizedGroupId = normalizeGroupId(groupId);
    const baseDir = path.resolve(configRoot, 'newcomer');
    const groupDir = path.resolve(baseDir, normalizedGroupId);
    if (!isPathInsideRoot(groupDir, baseDir)) {
      throw createHttpError(400, '欢迎图片目录越界', 'GROUP_WELCOME_IMAGE_PATH_OUT_OF_RANGE');
    }
    return groupDir;
  }

  function getImageContentType(filePath = '') {
    return imageContentTypes[path.extname(filePath).toLowerCase()] || '';
  }

  function resolveImagePath(groupId = '', configuredPath = '') {
    const groupDir = getImageDir(groupId);
    const normalized = String(configuredPath || '').trim();
    let candidates = [];
    if (normalized) {
      candidates.push(path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(groupDir, normalized));
    } else if (fs.existsSync(groupDir)) {
      candidates = fs.readdirSync(groupDir)
        .filter(file => /^1\.(png|jpe?g|webp|gif)$/i.test(file))
        .map(file => path.resolve(groupDir, file));
    }

    const groupDirRoot = getRealPathSafe(groupDir) || groupDir;
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      const contentType = getImageContentType(resolved);
      if (!contentType) continue;
      if (!isPathInsideRoot(resolved, groupDir)) continue;
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
      const realPath = getRealPathSafe(resolved) || resolved;
      if (!isPathInsideRoot(realPath, groupDirRoot)) continue;
      return { filePath: realPath, contentType };
    }
    return null;
  }

  function getImagePreviewUrl(groupId = '', configuredPath = '') {
    const resolved = resolveImagePath(groupId, configuredPath);
    if (!resolved) return '';
    let version = '';
    try {
      version = String(Math.round(fs.statSync(resolved.filePath).mtimeMs));
    } catch {
      version = String(Date.now());
    }
    return `/api/group-management/welcome-image?groupId=${encodeURIComponent(String(groupId))}&v=${encodeURIComponent(version)}`;
  }

  function isAiWelcomeEnabled(welcomeConfig = {}) {
    return welcomeConfig?.aiEnabled === true || welcomeConfig?.ai?.enabled === true;
  }

  function hasWelcomeContent(welcomeConfig = {}) {
    return Boolean(
      String(welcomeConfig?.text || '').trim()
      || String(welcomeConfig?.image || '').trim()
      || isAiWelcomeEnabled(welcomeConfig),
    );
  }

  function isWelcomeEnabled(welcomeConfig = {}) {
    if (!isPlainObject(welcomeConfig) || Object.keys(welcomeConfig).length <= 0) return false;
    if (welcomeConfig.enabled === true) return true;
    if (welcomeConfig.enabled === false) return false;
    return hasWelcomeContent(welcomeConfig);
  }

  function normalizeWelcomeConfig(value = {}, fallback = {}) {
    const source = isPlainObject(value) ? value : {};
    const base = isPlainObject(fallback) ? fallback : {};
    const result = {};
    result.enabled = readBoolean(source.enabled, base.enabled === true);
    const text = Object.prototype.hasOwnProperty.call(source, 'text')
      ? normalizeWelcomeText(source.text)
      : normalizeWelcomeText(base.text || '');
    if (text) result.text = text;
    const image = String(source.image ?? base.image ?? '').trim();
    if (image) result.image = image;
    if (isAiWelcomeEnabled(source) || (!Object.prototype.hasOwnProperty.call(source, 'aiEnabled') && isAiWelcomeEnabled(base))) {
      result.aiEnabled = true;
    }
    return result;
  }

  function getDefaultWelcomeConfig(newcomerConfig = {}) {
    const source = isPlainObject(newcomerConfig?.default) ? newcomerConfig.default : {};
    return normalizeWelcomeConfig(source, {
      enabled: false,
      text: '',
      aiEnabled: false,
    });
  }

  function deleteImageFiles(groupId = '') {
    const groupDir = getImageDir(groupId);
    if (!fs.existsSync(groupDir)) return 0;
    const groupDirRoot = getRealPathSafe(groupDir) || groupDir;
    let count = 0;
    for (const file of fs.readdirSync(groupDir)) {
      if (!/^1\.(png|jpe?g|webp|gif)$/i.test(file)) continue;
      const filePath = path.resolve(groupDir, file);
      if (!isPathInsideRoot(filePath, groupDir)) continue;
      const realPath = getRealPathSafe(filePath) || filePath;
      if (!isPathInsideRoot(realPath, groupDirRoot)) continue;
      fs.unlinkSync(realPath);
      count += 1;
    }
    return count;
  }

  function decodeImageDataUrl(dataUrl = '') {
    const matched = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-zA-Z0-9+/=\r\n]+)$/);
    if (!matched) {
      throw createHttpError(400, '欢迎图片数据格式不正确', 'GROUP_WELCOME_IMAGE_INVALID_DATA');
    }
    const mime = matched[1].toLowerCase();
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
    const buffer = Buffer.from(matched[2].replace(/\s+/g, ''), 'base64');
    if (!buffer.length) {
      throw createHttpError(400, '欢迎图片为空', 'GROUP_WELCOME_IMAGE_EMPTY');
    }
    if (buffer.length > imageMaxBytes) {
      throw createHttpError(413, `欢迎图片不能超过 ${Math.round(imageMaxBytes / 1024 / 1024)}MB`, 'GROUP_WELCOME_IMAGE_TOO_LARGE');
    }
    return { ext, buffer };
  }

  function saveImageDataUrl(groupId = '', dataUrl = '') {
    const groupDir = getImageDir(groupId);
    fs.mkdirSync(groupDir, { recursive: true });
    const { ext, buffer } = decodeImageDataUrl(dataUrl);
    deleteImageFiles(groupId);
    const filePath = path.resolve(groupDir, `1.${ext}`);
    ensurePathResolvedWithinRoot(filePath, groupDir, { allowMissing: true });
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  function serveImage(res, groupId = '') {
    const allConfigs = getAllConfigs() || {};
    const newcomerConfig = isPlainObject(allConfigs.newcomer) ? allConfigs.newcomer : {};
    const welcomeConfig = isPlainObject(newcomerConfig[String(groupId)]) ? newcomerConfig[String(groupId)] : {};
    const resolved = resolveImagePath(groupId, welcomeConfig.image);
    if (!resolved) {
      throw createHttpError(404, '欢迎图片不存在', 'GROUP_WELCOME_IMAGE_NOT_FOUND');
    }
    return sendBinary(res, fs.readFileSync(resolved.filePath), 200, {
      'Content-Type': resolved.contentType,
      'Content-Length': fs.statSync(resolved.filePath).size,
    });
  }

  return {
    normalizeWelcomeText,
    getImageDir,
    resolveImagePath,
    getImagePreviewUrl,
    isAiWelcomeEnabled,
    isWelcomeEnabled,
    normalizeWelcomeConfig,
    getDefaultWelcomeConfig,
    deleteImageFiles,
    saveImageDataUrl,
    serveImage,
  };
}
