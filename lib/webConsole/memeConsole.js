import fs from 'fs';
import path from 'path';

async function closeResponseBody(response) {
  if (!response?.body || typeof response.body.cancel !== 'function') {
    return;
  }
  try {
    await response.body.cancel();
  } catch {
    // Ignore cancellation failures after the response has already completed.
  }
}

export function createMemeConsole(options = {}) {
  const Meme = options.Meme;
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const normalizeLocalBaseDir = typeof options.normalizeLocalBaseDir === 'function'
    ? options.normalizeLocalBaseDir
    : (value = '') => String(value || '').trim();
  const buildBotIdentitySnapshot = typeof options.buildBotIdentitySnapshot === 'function'
    ? options.buildBotIdentitySnapshot
    : (() => ({}));
  const resolveRuntimeMemeCharacter = typeof options.resolveRuntimeMemeCharacter === 'function'
    ? options.resolveRuntimeMemeCharacter
    : ((value = '') => String(value || '').trim() || '灵晶');
  const normalizePositiveNumber = typeof options.normalizePositiveNumber === 'function'
    ? options.normalizePositiveNumber
    : ((value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
    });
  const replaceControlCharacters = typeof options.replaceControlCharacters === 'function'
    ? options.replaceControlCharacters
    : ((value = '') => String(value || ''));
  const fetchRemoteImageResponse = typeof options.fetchRemoteImageResponse === 'function'
    ? options.fetchRemoteImageResponse
    : async () => {
      throw new Error('Remote image fetch is not configured');
    };
  const proxyRemoteImage = typeof options.proxyRemoteImage === 'function'
    ? options.proxyRemoteImage
    : async () => {
      throw new Error('Remote image proxy is not configured');
    };
  const getHttpErrorStatus = typeof options.getHttpErrorStatus === 'function'
    ? options.getHttpErrorStatus
    : (() => 0);

  function assertMemeRuntime() {
    if (!Meme) {
      throw new Error('Meme runtime is not configured');
    }
  }

  async function inspectRemoteMemeImage(url = '') {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) {
      return {
        ok: false,
        status: 0,
        contentType: '',
        latencyMs: 0,
        error: 'Image URL is required.',
      };
    }

    const startedAt = Date.now();
    try {
      const { response } = await fetchRemoteImageResponse(targetUrl);
      const latencyMs = Date.now() - startedAt;
      const contentType = String(response.headers.get('content-type') || '').trim();
      const ok = response.ok && /^image\//i.test(contentType);

      await closeResponseBody(response);

      return {
        ok,
        status: response.status,
        contentType,
        latencyMs,
        error: ok ? '' : response.ok ? `Unexpected content-type: ${contentType || 'unknown'}` : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        status: getHttpErrorStatus(error, 0),
        contentType: '',
        latencyMs: Date.now() - startedAt,
        error: error.message,
      };
    }
  }

  async function testMemeApiConnection(payload = {}) {
    assertMemeRuntime();
    const allConfigs = getAllConfigs() || {};
    const memeConfig = allConfigs.ai?.memeConfig || {};
    const mergedMemeConfig = {
      ...memeConfig,
      apiBase: payload.apiBase === undefined ? memeConfig.apiBase : String(payload.apiBase || '').trim(),
      localEnabled: payload.localEnabled === undefined ? memeConfig.localEnabled !== false : payload.localEnabled !== false,
      preferLocal: payload.preferLocal === undefined ? memeConfig.preferLocal === true : payload.preferLocal === true,
      localBaseDir: payload.localBaseDir === undefined ? memeConfig.localBaseDir : String(payload.localBaseDir || '').trim(),
    };
    try {
      mergedMemeConfig.localBaseDir = normalizeLocalBaseDir(mergedMemeConfig.localBaseDir);
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code || 'MEME_LOCAL_DIR_INVALID',
      };
    }

    const apiBase = String(mergedMemeConfig.apiBase || '').trim();
    const identity = buildBotIdentitySnapshot(allConfigs, mergedMemeConfig);
    const character = resolveRuntimeMemeCharacter(payload.character, allConfigs, mergedMemeConfig);
    const requestedEmotion = String(
      payload.emotion
      || (Array.isArray(mergedMemeConfig.availableEmotions) ? mergedMemeConfig.availableEmotions[0] : '')
      || 'default'
    ).trim() || 'default';
    const emotionCandidates = Meme.getEmotionCandidates(requestedEmotion);
    const remoteResolvedEmotion = emotionCandidates[0] || requestedEmotion;
    const remoteResolvedUrl = apiBase
      ? await Meme.getPayloadImageUrl(character, remoteResolvedEmotion, 1, mergedMemeConfig)
      : '';
    const localRuntime = await Meme.getLocalMemeRuntimeConfig(mergedMemeConfig);
    const localResolved = await Meme.getLocalImagePath(character, requestedEmotion, mergedMemeConfig);
    const localExists = Boolean(localResolved.imagePath) && fs.existsSync(localResolved.imagePath);
    const remoteCheck = await inspectRemoteMemeImage(remoteResolvedUrl);
    const finalResolved = await Meme.getResolvedMemeUrl(character, requestedEmotion, [], mergedMemeConfig);
    const remoteUsable = remoteCheck.ok === true;
    const localUsable = localExists === true;

    let detail = '';
    if (remoteUsable && String(finalResolved.source || '').startsWith('remote')) {
      detail = `Remote meme API is reachable (${remoteCheck.latencyMs}ms).`;
    } else if (remoteUsable && localUsable && localRuntime.preferLocal) {
      detail = 'Remote API is reachable, but local mode is preferred.';
    } else if (!remoteUsable && localUsable) {
      detail = 'Remote API is unavailable, but a local meme image is available.';
    } else if (remoteUsable) {
      detail = `Remote meme API is reachable (${remoteCheck.latencyMs}ms), but current resolution did not end on remote output.`;
    } else if (!apiBase && localUsable) {
      detail = 'Remote meme API is not configured, but a local meme image is available.';
    } else {
      detail = remoteCheck.error || 'No remote or local meme image is currently available.';
    }

    return {
      success: remoteUsable || localUsable,
      remoteUsable,
      localUsable,
      character,
      defaultCharacter: identity.recommendedCharacter || 'LingJing',
      defaultCharacterSource: identity.recommendedCharacterSource,
      requestedEmotion,
      emotionCandidates,
      detail,
      remote: {
        configured: Boolean(apiBase),
        apiBase,
        requestUrl: apiBase ? await Meme.getMeme(character, requestedEmotion, mergedMemeConfig) : '',
        resolvedUrl: remoteResolvedUrl,
        resolvedEmotion: remoteResolvedEmotion,
        reachable: remoteUsable,
        httpStatus: remoteCheck.status,
        contentType: remoteCheck.contentType,
        latencyMs: remoteCheck.latencyMs,
        error: remoteCheck.error,
      },
      local: {
        enabled: localRuntime.enabled,
        preferLocal: localRuntime.preferLocal,
        configuredBaseDir: localRuntime.configuredBaseDir,
        resolvedBaseDir: localRuntime.resolvedBaseDir,
        candidatePath: localResolved.imagePath || '',
        candidateEmotion: localResolved.emotion || '',
        candidateCharacter: localResolved.character || '',
        candidateSource: localResolved.source || '',
        exists: localExists,
      },
      final: {
        source: finalResolved.source || '',
        imagePath: finalResolved.imagePath || finalResolved.imageUrl || '',
        emotion: finalResolved.emotion || '',
        character: finalResolved.character || character,
      },
      error: remoteUsable || localUsable ? '' : detail,
    };
  }

  function sanitizeMemePathSegment(value = '', fallback = 'default') {
    const normalized = replaceControlCharacters(value, '_')
      .trim()
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '');
    const safe = normalized || fallback;
    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    return reserved.test(safe) ? `_${safe}` : safe;
  }

  function getSavedImageExtension(contentType = '', imageUrl = '') {
    const type = String(contentType || '').split(';')[0].trim().toLowerCase();
    const typeMap = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/avif': '.avif',
      'image/bmp': '.bmp',
    };
    if (typeMap[type]) {
      return typeMap[type];
    }
    try {
      const ext = path.extname(new URL(String(imageUrl || '')).pathname).toLowerCase();
      return /^\.(jpg|jpeg|png|gif|webp|avif|bmp)$/i.test(ext) ? ext : '.jpg';
    } catch {
      return '.jpg';
    }
  }

  function buildSavedFileName(index = 1, extension = '.jpg') {
    const safeIndex = Math.max(1, Number(index || 1));
    const safeExtension = /^\.[a-z0-9]+$/i.test(String(extension || '')) ? String(extension).toLowerCase() : '.jpg';
    return `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(safeIndex).padStart(2, '0')}${safeExtension}`;
  }

  async function pullRemoteToLocal(payload = {}) {
    assertMemeRuntime();
    const allConfigs = getAllConfigs() || {};
    const currentMemeConfig = allConfigs.ai?.memeConfig || {};
    const mergedMemeConfig = {
      ...currentMemeConfig,
      apiBase: payload.apiBase === undefined ? currentMemeConfig.apiBase : String(payload.apiBase || '').trim(),
      localEnabled: payload.localEnabled === undefined ? currentMemeConfig.localEnabled !== false : payload.localEnabled !== false,
      preferLocal: payload.preferLocal === undefined ? currentMemeConfig.preferLocal === true : payload.preferLocal === true,
      localBaseDir: payload.localBaseDir === undefined ? currentMemeConfig.localBaseDir : String(payload.localBaseDir || '').trim(),
    };
    mergedMemeConfig.localBaseDir = normalizeLocalBaseDir(mergedMemeConfig.localBaseDir);

    const apiBase = String(mergedMemeConfig.apiBase || '').trim();
    if (!apiBase) {
      return {
        success: false,
        error: 'Missing meme API base URL.',
        detail: 'Configure meme API base URL before pulling remote images to local storage.',
      };
    }

    const identity = buildBotIdentitySnapshot(allConfigs, mergedMemeConfig);
    const character = resolveRuntimeMemeCharacter(payload.character, allConfigs, mergedMemeConfig);
    const requestedEmotion = String(
      payload.emotion
      || (Array.isArray(mergedMemeConfig.availableEmotions) ? mergedMemeConfig.availableEmotions[0] : '')
      || 'default'
    ).trim() || 'default';
    const requestedCount = Math.min(normalizePositiveNumber(payload.count, 1), 20);
    const emotionCandidates = Meme.getEmotionCandidates(requestedEmotion);
    const localRuntime = await Meme.getLocalMemeRuntimeConfig(mergedMemeConfig);
    const resolvedBaseDir = localRuntime.resolvedBaseDir;
    const safeCharacter = sanitizeMemePathSegment(character, 'unknown');
    const savedItems = [];
    const errors = [];

    await fs.promises.mkdir(resolvedBaseDir, { recursive: true });

    for (let index = 0; index < requestedCount; index += 1) {
      let resolvedUrl = '';
      let resolvedEmotion = '';

      for (const candidate of emotionCandidates) {
        resolvedUrl = await Meme.getPayloadImageUrl(character, candidate, 1, mergedMemeConfig);
        if (resolvedUrl) {
          resolvedEmotion = candidate;
          break;
        }
      }

      if (!resolvedUrl) {
        errors.push(`Item ${index + 1}: unable to resolve remote meme image URL.`);
        continue;
      }

      try {
        const remoteImage = await proxyRemoteImage(resolvedUrl);
        const safeEmotion = sanitizeMemePathSegment(resolvedEmotion || requestedEmotion || 'default', 'default');
        const saveDir = path.join(resolvedBaseDir, safeCharacter, safeEmotion);
        const extension = getSavedImageExtension(remoteImage.contentType, resolvedUrl);
        const fileName = buildSavedFileName(savedItems.length + 1, extension);
        const filePath = path.join(saveDir, fileName);

        await fs.promises.mkdir(saveDir, { recursive: true });
        await fs.promises.writeFile(filePath, remoteImage.buffer);

        savedItems.push({
          index: savedItems.length + 1,
          character,
          emotion: safeEmotion,
          sourceUrl: resolvedUrl,
          fileName,
          filePath,
          bytes: remoteImage.buffer.length,
          contentType: remoteImage.contentType,
        });
      } catch (error) {
        errors.push(`Item ${index + 1}: failed to save remote meme image. ${error.message}`);
      }
    }

    const success = savedItems.length > 0;
    const detail = success
      ? `Saved ${savedItems.length}/${requestedCount} remote meme image(s) to local storage.`
      : (errors[0] || 'No remote meme image could be saved.');

    return {
      success,
      apiBase,
      character,
      defaultCharacter: identity.recommendedCharacter || 'LingJing',
      defaultCharacterSource: identity.recommendedCharacterSource,
      requestedEmotion,
      requestedCount,
      savedCount: savedItems.length,
      emotionCandidates,
      local: {
        enabled: localRuntime.enabled,
        preferLocal: localRuntime.preferLocal,
        configuredBaseDir: localRuntime.configuredBaseDir,
        resolvedBaseDir,
      },
      detail,
      warning: localRuntime.enabled ? '' : 'Local meme mode is currently disabled, but files were still written to the resolved directory.',
      items: savedItems,
      errors,
      error: success ? '' : detail,
    };
  }

  async function buildLocalScanPayload(payload = {}) {
    assertMemeRuntime();
    const allConfigs = getAllConfigs() || {};
    const currentMemeConfig = allConfigs.ai?.memeConfig || {};
    const scanConfig = {
      ...currentMemeConfig,
      localEnabled: payload.localEnabled === undefined ? currentMemeConfig.localEnabled : payload.localEnabled,
      preferLocal: payload.preferLocal === undefined ? currentMemeConfig.preferLocal : payload.preferLocal,
      localBaseDir: payload.localBaseDir === undefined ? currentMemeConfig.localBaseDir : payload.localBaseDir,
    };
    scanConfig.localBaseDir = normalizeLocalBaseDir(scanConfig.localBaseDir);

    return await Meme.scanLocalMemeDirectory(scanConfig);
  }

  return {
    inspectRemoteMemeImage,
    testMemeApiConnection,
    pullRemoteToLocal,
    buildLocalScanPayload,
  };
}
