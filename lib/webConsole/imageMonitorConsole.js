import fs from 'fs';
import path from 'path';

function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function stripJsonLineInternalFields(item = {}) {
  const rest = { ...item };
  delete rest.__line;
  delete rest.id;
  return rest;
}

function readJsonLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return { ...JSON.parse(line), __line: index + 1 };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeJsonLines(filePath, items = []) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = items
    .map(item => JSON.stringify(stripJsonLineInternalFields(item), null, 0))
    .join('\n');
  fs.writeFileSync(filePath, content ? `${content}\n` : '', 'utf8');
}

function isPathInsideDir(targetPath = '', baseDir = '') {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeMatcherList(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,，;；]/);
  return items.map(item => String(item || '').trim()).filter(Boolean);
}

function textIncludesToken(value = '', token = '') {
  const text = String(value || '').trim().toLowerCase();
  const keyword = String(token || '').trim().toLowerCase();
  return Boolean(text && keyword && text.includes(keyword));
}

export function createImageMonitorConsole(options = {}) {
  const imageMonitorDir = options.imageMonitorDir || '';
  const reviewLogFile = options.reviewLogFile || path.join(imageMonitorDir, 'review-log.jsonl');
  const memeIndexFile = options.memeIndexFile || path.join(imageMonitorDir, 'meme-index.jsonl');
  const memeDir = options.memeDir || path.join(imageMonitorDir, 'memes');
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const getRealPathSafe = typeof options.getRealPathSafe === 'function' ? options.getRealPathSafe : value => path.resolve(value);
  const getImageMonitorConfig = typeof options.getImageMonitorConfig === 'function' ? options.getImageMonitorConfig : () => ({});
  const getPageSize = typeof options.getPageSize === 'function' ? options.getPageSize : () => 20;
  const paginateItems = typeof options.paginateItems === 'function'
    ? options.paginateItems
    : ((items = []) => ({ items: Array.isArray(items) ? items : [] }));
  const sendJson = typeof options.sendJson === 'function' ? options.sendJson : null;
  const sendBinary = typeof options.sendBinary === 'function' ? options.sendBinary : null;

  function resolveCandidatePath(filePath = '') {
    const rawPath = String(filePath || '').trim();
    if (!rawPath) {
      return '';
    }
    const resolvedPath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(imageMonitorDir, rawPath);
    if (!isPathInsideDir(resolvedPath, imageMonitorDir)) {
      return '';
    }
    return resolvedPath;
  }

  function getLocalImageContentType(filePath = '') {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.avif': 'image/avif',
    };
    const contentType = contentTypes[extension];
    if (!contentType) {
      throw createHttpError(415, 'Unsupported local image type.', 'IMAGE_MONITOR_LOCAL_IMAGE_UNSUPPORTED_TYPE');
    }
    return contentType;
  }

  function pushPathCandidate(candidates, filePath = '') {
    const normalized = String(filePath || '').trim();
    if (normalized) {
      candidates.push(normalized);
    }
  }

  function pushJoinedPathCandidate(candidates, ...segments) {
    const normalizedSegments = segments.map(segment => String(segment || '').trim()).filter(Boolean);
    if (normalizedSegments.length === segments.length) {
      candidates.push(path.join(...normalizedSegments));
    }
  }

  function findMemeEntryByHash(hash = '', memeEntries = []) {
    const normalizedHash = String(hash || '').trim();
    if (!normalizedHash || !Array.isArray(memeEntries)) {
      return null;
    }
    return memeEntries.find(item => String(item.hash || '').trim() === normalizedHash) || null;
  }

  function buildLocalPathCandidates(entry = {}, type = 'review', memeEntries = []) {
    const candidates = [];
    const targetType = String(type || 'review').trim();
    const appendMemeEntryCandidates = memeEntry => {
      if (!memeEntry) {
        return;
      }
      pushPathCandidate(candidates, memeEntry.filePath);
      pushJoinedPathCandidate(candidates, memeDir, memeEntry.relativeDir, memeEntry.fileName);
      pushJoinedPathCandidate(
        candidates,
        memeDir,
        memeEntry.character || memeEntry.folder,
        memeEntry.emotion || 'default',
        memeEntry.fileName,
      );
      pushJoinedPathCandidate(candidates, memeDir, memeEntry.folder, memeEntry.fileName);
    };

    if (targetType === 'meme') {
      appendMemeEntryCandidates(entry);
      return candidates;
    }

    pushPathCandidate(candidates, entry.reviewFilePath);
    pushJoinedPathCandidate(candidates, imageMonitorDir, entry.reviewRelativePath);
    pushJoinedPathCandidate(candidates, imageMonitorDir, 'reviews', entry.reviewFileName);
    const reviewDate = String(entry.reviewedAt || '').slice(0, 10);
    const reviewGroupId = String(entry.groupId || 'unknown').trim() || 'unknown';
    if (entry.hash && reviewDate) {
      for (const ext of ['jpg', 'png', 'gif', 'webp', 'avif', 'bmp']) {
        pushJoinedPathCandidate(candidates, imageMonitorDir, 'reviews', reviewDate, reviewGroupId, `${String(entry.hash).slice(0, 16)}.${ext}`);
      }
    }
    pushPathCandidate(candidates, entry.memeFilePath);
    pushPathCandidate(candidates, entry.filePath);
    appendMemeEntryCandidates(findMemeEntryByHash(entry.hash, memeEntries));
    pushJoinedPathCandidate(candidates, memeDir, entry.memeCharacter, entry.memeEmotion || 'default', entry.memeFileName);
    pushJoinedPathCandidate(candidates, memeDir, entry.memeCharacter, entry.memeFileName);
    return candidates;
  }

  function resolveLocalImagePath(entry = {}, type = 'review', memeEntries = []) {
    const candidates = buildLocalPathCandidates(entry, type, memeEntries);
    for (const candidate of candidates) {
      const resolvedPath = resolveCandidatePath(candidate);
      if (!resolvedPath) {
        continue;
      }
      try {
        if (!fs.existsSync(resolvedPath)) {
          continue;
        }
        const realPath = getRealPathSafe(resolvedPath) || resolvedPath;
        const realBasePath = getRealPathSafe(imageMonitorDir) || path.resolve(imageMonitorDir);
        if (!isPathInsideDir(realPath, realBasePath)) {
          continue;
        }
        const stat = fs.statSync(realPath);
        if (stat.isFile()) {
          return realPath;
        }
      } catch {
        // Try the next candidate.
      }
    }
    return '';
  }

  function buildLocalImageUrl(type = 'review', entryId = '') {
    const targetType = String(type || 'review').trim() === 'meme' ? 'meme' : 'review';
    const id = String(entryId || '').trim();
    if (!id) {
      return '';
    }
    return `/api/logs/image-monitor/local-image?type=${encodeURIComponent(targetType)}&id=${encodeURIComponent(id)}`;
  }

  function getOriginalImageUrl(entry = {}, type = 'review') {
    return String(type === 'meme' ? entry.sourceUrl || entry.imageUrl || '' : entry.imageUrl || entry.sourceUrl || '').trim();
  }

  function decorateLogEntry(entry = {}, type = 'review', memeEntries = []) {
    const targetType = String(type || 'review').trim() === 'meme' ? 'meme' : 'review';
    const id = String(entry.id || entry.__line || '').trim();
    const localPath = resolveLocalImagePath(entry, targetType, memeEntries);
    const localImageUrl = localPath ? buildLocalImageUrl(targetType, id) : '';
    const originalImageUrl = getOriginalImageUrl(entry, targetType);
    const remotePreviewUrl = originalImageUrl ? `/api/image-proxy?url=${encodeURIComponent(originalImageUrl)}` : '';
    return {
      ...entry,
      localImageAvailable: Boolean(localImageUrl),
      localImagePath: localPath ? path.relative(imageMonitorDir, localPath).replace(/\\/g, '/') : '',
      originalImageUrl,
      previewUrl: localImageUrl || remotePreviewUrl,
      openImageUrl: localImageUrl || originalImageUrl,
    };
  }

  function findRawLogEntry(type, entryId) {
    const targetType = String(type || 'review').trim();
    const targetId = String(entryId || '').trim();
    if (!targetId) {
      return null;
    }
    const items = readJsonLines(targetType === 'meme' ? memeIndexFile : reviewLogFile)
      .map(item => ({
        ...item,
        id: String(item.__line || ''),
      }));
    return items.find(item => item.id === targetId || String(item.__line || '') === targetId) || null;
  }

  function serveLocalImage(res, type, entryId) {
    if (!sendJson || !sendBinary) {
      throw createHttpError(500, '图片监控本地图片服务未完成初始化', 'IMAGE_MONITOR_CONSOLE_NOT_READY');
    }
    const targetType = String(type || 'review').trim() === 'meme' ? 'meme' : 'review';
    const entry = findRawLogEntry(targetType, entryId);
    if (!entry) {
      return sendJson(res, { success: false, error: 'Not found' }, 404);
    }
    const memeEntries = targetType === 'review' ? readJsonLines(memeIndexFile) : [];
    const filePath = resolveLocalImagePath(entry, targetType, memeEntries);
    if (!filePath) {
      return sendJson(res, { success: false, error: 'Local image not found' }, 404);
    }
    const contentType = getLocalImageContentType(filePath);
    const buffer = fs.readFileSync(filePath);
    return sendBinary(res, buffer, 200, {
      'Content-Type': contentType,
      'Content-Length': buffer.length,
    });
  }

  function deleteLocalFile(filePath = '') {
    const targetPath = String(filePath || '').trim();
    if (!targetPath) {
      return { skipped: true, reason: 'empty_path' };
    }
    const resolvedPath = path.resolve(targetPath);
    if (!isPathInsideDir(resolvedPath, imageMonitorDir)) {
      return { skipped: true, reason: 'outside_image_monitor_dir', filePath: resolvedPath };
    }
    try {
      if (!fs.existsSync(resolvedPath)) {
        return { skipped: true, reason: 'not_found', filePath: resolvedPath };
      }
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return { skipped: true, reason: 'not_file', filePath: resolvedPath };
      }
      fs.unlinkSync(resolvedPath);
      return { deleted: true, filePath: resolvedPath };
    } catch (error) {
      return { failed: true, filePath: resolvedPath, error: error.message };
    }
  }

  function cleanupEmptyDirectories(rootDir = '') {
    const root = path.resolve(rootDir);
    if (!fs.existsSync(root)) {
      return { removedDirs: 0, failedDirs: 0 };
    }
    let removedDirs = 0;
    let failedDirs = 0;

    const visit = dirPath => {
      const resolvedDir = path.resolve(dirPath);
      if (resolvedDir !== root && !isPathInsideDir(resolvedDir, root)) {
        return false;
      }
      let entries = [];
      try {
        entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
      } catch {
        failedDirs += 1;
        return false;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          visit(path.join(resolvedDir, entry.name));
        }
      }
      if (resolvedDir === root) {
        return false;
      }
      try {
        if (fs.readdirSync(resolvedDir).length === 0) {
          fs.rmdirSync(resolvedDir);
          removedDirs += 1;
          return true;
        }
      } catch {
        failedDirs += 1;
      }
      return false;
    };

    visit(root);
    return { removedDirs, failedDirs };
  }

  function matchesMemeSaveFilter(entry = {}, cfg = {}) {
    const allowedCharacters = normalizeMatcherList(cfg.saveMemeCharacters);
    const allowedKeywords = normalizeMatcherList(cfg.saveMemeKeywords);
    if (allowedCharacters.length === 0 && allowedKeywords.length === 0) {
      return true;
    }
    const character = String(entry.character || entry.memeCharacter || entry.folder || '').trim();
    const emotion = String(entry.emotion || entry.memeEmotion || '').trim();
    const searchFields = [
      character,
      emotion,
      entry.summary,
      entry.fileName,
      entry.relativeDir,
      ...(Array.isArray(entry.memeTags) ? entry.memeTags : []),
      ...(Array.isArray(entry.keywords) ? entry.keywords : []),
      ...(Array.isArray(entry.memeKeywords) ? entry.memeKeywords : []),
    ].filter(Boolean);
    return allowedCharacters.some(item => textIncludesToken(character, item))
      || allowedKeywords.some(keyword => searchFields.some(value => textIncludesToken(value, keyword)));
  }

  function cleanupNonMemePayload() {
    const reviewEntries = readJsonLines(reviewLogFile);
    const memeEntries = readJsonLines(memeIndexFile);
    const memeHashes = new Set(
      reviewEntries
        .filter(item => item.isMeme === true && item.hash)
        .map(item => String(item.hash)),
    );
    const nonMemeEntries = reviewEntries.filter(item => item.isMeme === false);
    const nonMemeHashes = new Set(
      nonMemeEntries
        .filter(item => item.hash && !memeHashes.has(String(item.hash)))
        .map(item => String(item.hash)),
    );
    const keptReviewEntries = reviewEntries.filter(item => item.isMeme !== false);
    const removedMemeEntries = memeEntries.filter(item => item.hash && nonMemeHashes.has(String(item.hash)));
    const keptMemeEntries = memeEntries.filter(item => !(item.hash && nonMemeHashes.has(String(item.hash))));
    const fileResults = [];

    for (const item of [...nonMemeEntries, ...removedMemeEntries]) {
      for (const filePath of [item.filePath, item.memeFilePath, item.reviewFilePath]) {
        const result = deleteLocalFile(filePath);
        if (!result.skipped || result.reason !== 'empty_path') {
          fileResults.push(result);
        }
      }
    }

    if (keptReviewEntries.length !== reviewEntries.length) {
      writeJsonLines(reviewLogFile, keptReviewEntries);
    }
    if (keptMemeEntries.length !== memeEntries.length) {
      writeJsonLines(memeIndexFile, keptMemeEntries);
    }
    const emptyDirResult = cleanupEmptyDirectories(memeDir);

    return {
      success: true,
      scannedReviewRecords: reviewEntries.length,
      removedReviewRecords: nonMemeEntries.length,
      keptReviewRecords: keptReviewEntries.length,
      scannedMemeRecords: memeEntries.length,
      removedMemeRecords: removedMemeEntries.length,
      deletedFiles: fileResults.filter(item => item.deleted).length,
      skippedFiles: fileResults.filter(item => item.skipped).length,
      failedFiles: fileResults.filter(item => item.failed).length,
      removedEmptyDirs: emptyDirResult.removedDirs,
      failedEmptyDirs: emptyDirResult.failedDirs,
      fileResults: fileResults.slice(0, 50),
    };
  }

  function cleanupUnmatchedMemePayload() {
    const imageMonitorConfig = getImageMonitorConfig() || {};
    const allowedCharacters = normalizeMatcherList(imageMonitorConfig.saveMemeCharacters);
    const allowedKeywords = normalizeMatcherList(imageMonitorConfig.saveMemeKeywords);
    if (allowedCharacters.length === 0 && allowedKeywords.length === 0) {
      return {
        success: true,
        skipped: true,
        reason: 'no_save_filter',
        message: '未配置入库角色或关键词白名单，跳过清理',
        removedMemeRecords: 0,
        deletedFiles: 0,
        removedEmptyDirs: 0,
      };
    }

    const memeEntries = readJsonLines(memeIndexFile);
    const keptMemeEntries = memeEntries.filter(item => matchesMemeSaveFilter(item, imageMonitorConfig));
    const removedMemeEntries = memeEntries.filter(item => !matchesMemeSaveFilter(item, imageMonitorConfig));
    const fileResults = [];

    for (const item of removedMemeEntries) {
      const result = deleteLocalFile(item.filePath);
      if (!result.skipped || result.reason !== 'empty_path') {
        fileResults.push(result);
      }
    }

    if (keptMemeEntries.length !== memeEntries.length) {
      writeJsonLines(memeIndexFile, keptMemeEntries);
    }
    const emptyDirResult = cleanupEmptyDirectories(memeDir);

    return {
      success: true,
      scannedMemeRecords: memeEntries.length,
      removedMemeRecords: removedMemeEntries.length,
      keptMemeRecords: keptMemeEntries.length,
      deletedFiles: fileResults.filter(item => item.deleted).length,
      skippedFiles: fileResults.filter(item => item.skipped).length,
      failedFiles: fileResults.filter(item => item.failed).length,
      removedEmptyDirs: emptyDirResult.removedDirs,
      failedEmptyDirs: emptyDirResult.failedDirs,
      fileResults: fileResults.slice(0, 50),
    };
  }

  function buildLogPayload(filters = {}) {
    const query = String(filters.query || '').trim().toLowerCase();
    const type = String(filters.type || 'review').trim();
    const risk = String(filters.risk || '').trim().toLowerCase();
    const isMeme = String(filters.isMeme || '').trim().toLowerCase();
    const groupId = String(filters.groupId || '').trim();
    const userId = String(filters.userId || '').trim();
    const alerted = String(filters.alerted || '').trim().toLowerCase();
    const recalled = String(filters.recalled || '').trim().toLowerCase();
    const startAt = String(filters.startAt || '').trim();
    const endAt = String(filters.endAt || '').trim();
    const startMs = startAt ? Date.parse(startAt) : NaN;
    const endMs = endAt ? Date.parse(endAt) : NaN;
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || getPageSize());
    const targetType = type === 'meme' ? 'meme' : 'review';
    const memeEntries = targetType === 'review' ? readJsonLines(memeIndexFile) : [];
    const raw = readJsonLines(targetType === 'meme' ? memeIndexFile : reviewLogFile)
      .map(item => ({
        ...item,
        id: String(item.__line || ''),
      }))
      .filter(item => {
        if (groupId && String(item.groupId || '') !== groupId) {
          return false;
        }
        if (userId && String(item.userId || '') !== userId) {
          return false;
        }
        const itemTime = Date.parse(String(item.reviewedAt || item.savedAt || ''));
        if (Number.isFinite(startMs) && (!Number.isFinite(itemTime) || itemTime < startMs)) {
          return false;
        }
        if (Number.isFinite(endMs) && (!Number.isFinite(itemTime) || itemTime > endMs)) {
          return false;
        }
        if (targetType !== 'meme' && risk && String(item.riskLevel || '').trim().toLowerCase() !== risk) {
          return false;
        }
        if (targetType !== 'meme' && isMeme) {
          const flag = item.isMeme === true;
          if (isMeme === 'true' && !flag) return false;
          if (isMeme === 'false' && flag) return false;
        }
        if (targetType !== 'meme' && alerted) {
          const flag = item.alerted === true;
          if (alerted === 'true' && !flag) return false;
          if (alerted === 'false' && flag) return false;
        }
        if (targetType !== 'meme' && recalled) {
          const flag = item.recalled === true;
          if (recalled === 'true' && !flag) return false;
          if (recalled === 'false' && flag) return false;
        }
        if (!query) return true;
        return [
          item.groupId,
          item.userId,
          item.messageId,
          item.summary,
          item.memeCharacter,
          item.memeEmotion,
          item.character,
          item.emotion,
          item.relativeDir,
          ...(item.memeKeywords || []),
          ...(item.keywords || []),
          ...(item.memeTags || []),
          ...(item.riskCategories || []),
          item.error,
          item.fileName,
          item.memeFileName,
          item.memeSaveReason,
        ]
          .some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => String(b.reviewedAt || b.savedAt || '').localeCompare(String(a.reviewedAt || a.savedAt || '')));
    const payload = paginateItems(raw, page, pageSize);
    return {
      ...payload,
      items: payload.items.map(item => decorateLogEntry(item, targetType, memeEntries)),
    };
  }

  function findLogEntry(type, entryId) {
    const targetType = String(type || 'review').trim() === 'meme' ? 'meme' : 'review';
    const item = findRawLogEntry(targetType, entryId);
    if (!item) {
      return null;
    }
    const memeEntries = targetType === 'review' ? readJsonLines(memeIndexFile) : [];
    return decorateLogEntry(item, targetType, memeEntries);
  }

  return {
    buildLogPayload,
    cleanupNonMemePayload,
    cleanupUnmatchedMemePayload,
    findLogEntry,
    serveLocalImage,
  };
}
