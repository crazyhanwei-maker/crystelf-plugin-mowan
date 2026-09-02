import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Path from '../../constants/path.js';
import Renderer from '../ai/renderer.js';
import { createBotIdentityConsole } from './botIdentityConsole.js';
import { createFileBrowserConsole } from './fileBrowserConsole.js';
import { createMasterNotifier } from './masterNotifier.js';
import { createHelpDiyConsole } from './helpDiyConsole.js';
import { createWebConsoleHttpUtils } from './httpUtils.js';
import { createLogFileUtils } from './logFileUtils.js';
import { createSecretUtils } from './secretUtils.js';
import { createStaticConsole } from './staticConsole.js';
import { createWebConsoleAuditLog } from './webConsoleAuditLog.js';
import { createWebConsoleAuth } from './webConsoleAuth.js';
import { getWebConsoleDisplayUrl } from './webConsoleConfig.js';
import {
  DEFAULT_HELP_DIY_IMAGE,
  FILE_BROWSER_BLOCKED_NAMES,
  FILE_BROWSER_MAX_DIRECTORY_ENTRIES,
  FILE_BROWSER_MAX_FILE_BYTES,
  FILE_BROWSER_MAX_UPLOAD_BYTES,
  FILE_BROWSER_ROOT_DIR,
  FILE_BROWSER_SEARCH_MAX_PREVIEW_LENGTH,
  FILE_BROWSER_SEARCH_MAX_RESULTS,
  FILE_BROWSER_TEXT_EXTENSIONS,
  HELP_DIY_FILE,
  HELP_DIY_HISTORY_FILE,
  HELP_DIY_IMAGE_MAX_BYTES,
  HELP_DIY_UPLOAD_DIR,
  LEGACY_HELP_DIY_FILE,
  PUBLIC_DIR,
  WEB_CONSOLE_LOGIN_BLOCK_MS,
  WEB_CONSOLE_LOGIN_MAX_FAILURES,
  WEB_CONSOLE_LOGIN_WINDOW_MS,
  WEB_CONSOLE_AUDIT_LOG_FILE,
  WEB_CONSOLE_AUDIT_LOG_MAX_BYTES,
  WEB_CONSOLE_REQUEST_BODY_MAX_BYTES,
  WEB_CONSOLE_SESSION_MAX_AGE_SECONDS,
} from './webConsoleConstants.js';

export function createCoreWebConsoleSuite(options = {}) {
  const {
    ConfigControl,
    logger,
    getWebConsoleConfig,
    normalizeUsageScene,
  } = options;

  const masterNotifier = createMasterNotifier({ logger });

  async function notifyLoginSuccess({ req, ip = '', method = 'token' } = {}) {
    const origin = (() => {
      try { return req?.headers?.origin || req?.headers?.referer || ''; } catch { return ''; }
    })();
    const userAgent = String(req?.headers?.['user-agent'] || '未知').slice(0, 120);
    const time = new Date().toLocaleString('zh-CN', { hour12: false });
    const methodLabel = method === 'ticket' ? '一次性登录链接' : '口令';
    const message = [
      '🔐 魔丸控制台登录通知',
      '━━━━━━━━━━━━━━',
      `登录方式：${methodLabel}`,
      `登录 IP：${ip || '未知'}`,
      `来源：${origin || '未知'}`,
      `客户端：${userAgent}`,
      `时间：${time}`,
      '',
      '若不是你本人登录，请立即检查口令与访问来源。',
    ].join('\n');
    await masterNotifier.notifyMasters(message, { label: '登录通知' });
  }

  const httpUtils = createWebConsoleHttpUtils({
    fs,
    path,
    crypto,
    requestBodyMaxBytes: WEB_CONSOLE_REQUEST_BODY_MAX_BYTES,
  });

  const {
    getSecurityHeaders,
    sendJson,
    sendText,
    sendRedirect,
    sendBinary,
    createHttpError,
    getHttpErrorStatus,
    parseRequestBody,
    readRawBody,
    safeReadJson,
    safeWriteJson,
    isPathInsideRoot,
    getRealPathSafe,
    ensurePathResolvedWithinRoot,
  } = httpUtils;

  const fileBrowserConsole = createFileBrowserConsole({
    rootDir: FILE_BROWSER_ROOT_DIR,
    blockedNames: FILE_BROWSER_BLOCKED_NAMES,
    maxFileBytes: FILE_BROWSER_MAX_FILE_BYTES,
    maxUploadBytes: FILE_BROWSER_MAX_UPLOAD_BYTES,
    maxDirectoryEntries: FILE_BROWSER_MAX_DIRECTORY_ENTRIES,
    maxSearchResults: FILE_BROWSER_SEARCH_MAX_RESULTS,
    maxSearchPreviewLength: FILE_BROWSER_SEARCH_MAX_PREVIEW_LENGTH,
    textExtensions: FILE_BROWSER_TEXT_EXTENSIONS,
    createHttpError,
  });

  const botIdentityConsole = createBotIdentityConsole();

  const {
    buildBotIdentitySnapshot,
    resolveRuntimeMemeCharacter,
    replaceControlCharacters,
  } = botIdentityConsole;

  const helpDiyConsole = createHelpDiyConsole({
    helpDiyFile: HELP_DIY_FILE,
    legacyHelpDiyFile: LEGACY_HELP_DIY_FILE,
    uploadDir: HELP_DIY_UPLOAD_DIR,
    historyFile: HELP_DIY_HISTORY_FILE,
    defaultImage: DEFAULT_HELP_DIY_IMAGE,
    imageMaxBytes: HELP_DIY_IMAGE_MAX_BYTES,
    createHttpError,
    safeReadJson,
    safeWriteJson,
    getStoredConfig: () => ConfigControl.get('help-diy'),
    setStoredConfig: payload => ConfigControl.set('help-diy', payload),
    ensurePathResolvedWithinRoot,
    getRealPathSafe,
    isPathInsideRoot,
    getWebConsoleDisplayUrl: () => getWebConsoleDisplayUrl(getWebConsoleConfig()),
    replaceControlCharacters,
    renderMarkdown: markdown => Renderer.renderMarkdown(markdown),
    renderHtml: html => Renderer.renderHtml(html),
  });

  const logFileUtils = createLogFileUtils({
    fs,
    path,
    logger,
    normalizeUsageScene,
  });

  const {
    parseJsonObjects,
    readTailText,
    safeReadUsageEntries,
  } = logFileUtils;

  const webConsoleAuth = createWebConsoleAuth({
    crypto,
    getWebConsoleConfig,
    createHttpError,
    parseRequestBody,
    sendJson,
    notifyLoginSuccess,
    sessionMaxAgeSeconds: WEB_CONSOLE_SESSION_MAX_AGE_SECONDS,
    loginWindowMs: WEB_CONSOLE_LOGIN_WINDOW_MS,
    loginMaxFailures: WEB_CONSOLE_LOGIN_MAX_FAILURES,
    loginBlockMs: WEB_CONSOLE_LOGIN_BLOCK_MS,
  });

  const {
    isLoopbackAddress,
    isBootstrapSetupRequest,
    isAuthorized,
    normalizeWebConsoleRedirectPath,
    getClientIp,
  } = webConsoleAuth;

  const auditConsole = createWebConsoleAuditLog({
    fs,
    path,
    logger,
    auditLogFile: WEB_CONSOLE_AUDIT_LOG_FILE,
    auditLogMaxBytes: WEB_CONSOLE_AUDIT_LOG_MAX_BYTES,
    getClientIp,
  });

  const secretUtils = createSecretUtils();

  const {
    hasConfiguredSecret,
    maskSecretValue,
  } = secretUtils;

  const staticConsole = createStaticConsole({
    fs,
    path,
    publicDir: PUBLIC_DIR,
    vendorRoots: {
      monaco: path.join(Path.root, 'node_modules', 'monaco-editor', 'min'),
      xterm: path.join(Path.root, 'node_modules', '@xterm', 'xterm'),
      'xterm-fit': path.join(Path.root, 'node_modules', '@xterm', 'addon-fit'),
    },
    helpDiyUploadDir: HELP_DIY_UPLOAD_DIR,
    sendText,
    sendBinary,
    sendRedirect,
    getSecurityHeaders,
    isPathInsideRoot,
    isBootstrapSetupRequest,
    isAuthorized,
    normalizeWebConsoleRedirectPath,
  });

  return {
    masterNotifier,
    httpUtils,
    fileBrowserConsole,
    botIdentityConsole,
    helpDiyConsole,
    logFileUtils,
    webConsoleAuth,
    auditConsole,
    secretUtils,
    staticConsole,
    getSecurityHeaders,
    sendJson,
    sendText,
    sendRedirect,
    sendBinary,
    createHttpError,
    getHttpErrorStatus,
    parseRequestBody,
    safeReadJson,
    safeWriteJson,
    isPathInsideRoot,
    getRealPathSafe,
    ensurePathResolvedWithinRoot,
    buildBotIdentitySnapshot,
    resolveRuntimeMemeCharacter,
    replaceControlCharacters,
    parseJsonObjects,
    readTailText,
    safeReadUsageEntries,
    isLoopbackAddress,
    isBootstrapSetupRequest,
    isAuthorized,
    normalizeWebConsoleRedirectPath,
    getClientIp,
    hasConfiguredSecret,
    maskSecretValue,
  };
}
