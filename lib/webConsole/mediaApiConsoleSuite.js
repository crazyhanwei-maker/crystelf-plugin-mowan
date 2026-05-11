import path from 'path';
import Meme from '../core/meme.js';
import Path from '../../constants/path.js';
import { createApiSettingsConsole } from './apiSettingsConsole.js';
import { createConsoleBackground } from './consoleBackground.js';
import { createMemeConsole } from './memeConsole.js';
import { createMemeLocalPath } from './memeLocalPath.js';
import { createRemoteImageProxy } from './remoteImageProxy.js';
import {
  CONSOLE_BACKGROUND_CACHE_DIR,
  CONSOLE_BACKGROUND_CACHE_FILE,
  CONSOLE_BACKGROUND_CACHE_META_FILE,
  DEFAULT_CONSOLE_BACKGROUND_SOURCE_URL,
  FILE_BROWSER_ROOT_DIR,
  REMOTE_IMAGE_PROXY_MAX_BYTES,
  REMOTE_IMAGE_PROXY_MAX_REDIRECTS,
  REMOTE_IMAGE_PROXY_TIMEOUT_MS,
} from './webConsoleConstants.js';

export function createMediaApiConsoleSuite(options = {}) {
  const {
    ConfigControl,
    createHttpError,
    safeReadJson,
    safeWriteJson,
    sendBinary,
    logger,
    isPathInsideRoot,
    ensurePathResolvedWithinRoot,
    buildBotIdentitySnapshot,
    resolveRuntimeMemeCharacter,
    normalizePositiveNumber,
    replaceControlCharacters,
    buildOpenAiCompatibleUrl,
    hasConfiguredSecret,
    getHttpErrorStatus,
  } = options;

  const getAllConfigs = () => ConfigControl.get() || {};
  const remoteImageProxy = createRemoteImageProxy({
    createHttpError,
    timeoutMs: REMOTE_IMAGE_PROXY_TIMEOUT_MS,
    maxBytes: REMOTE_IMAGE_PROXY_MAX_BYTES,
    maxRedirects: REMOTE_IMAGE_PROXY_MAX_REDIRECTS,
  });

  const {
    fetchResponse: fetchRemoteImageResponseSafe,
    proxyImage: proxyRemoteImageSafe,
    normalizeImageContentType: normalizeImageContentTypeSafe,
  } = remoteImageProxy;

  const consoleBackground = createConsoleBackground({
    cacheDir: CONSOLE_BACKGROUND_CACHE_DIR,
    cacheFile: CONSOLE_BACKGROUND_CACHE_FILE,
    cacheMetaFile: CONSOLE_BACKGROUND_CACHE_META_FILE,
    defaultSourceUrl: DEFAULT_CONSOLE_BACKGROUND_SOURCE_URL,
    bundledFallbackImagePath: path.join(Path.root, 'lib', 'webConsole', 'public', 'assets', 'console-wallpaper-default.webp'),
    getConfig: () => ConfigControl.get('config') || {},
    safeReadJson,
    safeWriteJson,
    proxyRemoteImage: proxyRemoteImageSafe,
    normalizeImageContentType: normalizeImageContentTypeSafe,
    sendBinary,
    logger,
  });

  const {
    normalizeSourceUrl: normalizeConsoleBackgroundSourceUrl,
    getSourceUrl: getConsoleBackgroundSourceUrl,
  } = consoleBackground;

  const memeLocalPath = createMemeLocalPath({
    path,
    rootDir: FILE_BROWSER_ROOT_DIR,
    isPathInsideRoot,
    ensurePathResolvedWithinRoot,
    createHttpError,
  });

  const {
    normalizeLocalBaseDir: normalizeWebConsoleMemeLocalBaseDir,
  } = memeLocalPath;

  const apiSettingsConsole = createApiSettingsConsole({
    getAllConfigs,
    setConfig: (name, value) => ConfigControl.set(name, value),
    buildBotIdentitySnapshot,
    hasConfiguredSecret,
    normalizePositiveNumber,
    normalizeMemeLocalBaseDir: normalizeWebConsoleMemeLocalBaseDir,
    buildOpenAiCompatibleUrl,
  });

  const memeConsole = createMemeConsole({
    Meme,
    getAllConfigs,
    normalizeLocalBaseDir: normalizeWebConsoleMemeLocalBaseDir,
    buildBotIdentitySnapshot,
    resolveRuntimeMemeCharacter,
    normalizePositiveNumber,
    replaceControlCharacters,
    fetchRemoteImageResponse: fetchRemoteImageResponseSafe,
    proxyRemoteImage: proxyRemoteImageSafe,
    getHttpErrorStatus,
  });

  return {
    remoteImageProxy,
    consoleBackground,
    apiSettingsConsole,
    memeConsole,
    memeLocalPath,
    fetchRemoteImageResponseSafe,
    proxyRemoteImageSafe,
    normalizeImageContentTypeSafe,
    normalizeConsoleBackgroundSourceUrl,
    getConsoleBackgroundSourceUrl,
    normalizeWebConsoleMemeLocalBaseDir,
  };
}
