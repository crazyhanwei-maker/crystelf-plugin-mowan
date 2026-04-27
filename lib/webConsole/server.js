import http from 'http';
import dns from 'dns/promises';
import fs from 'fs';
import net from 'net';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import ConfigControl from '../config/configControl.js';
import Path from '../../constants/path.js';
import Version from '../system/version.js';
import { getUsageOverviewSync } from '../ai/usageLogger.js';
import guobaSchema from '../../guoba/configSchema.js';
import UserConfigManager from '../ai/userConfigManager.js';
import { fetchWebMarkdown, searchWeb } from '../ai/toolRegistry.js';
import { runChat } from '../ai/chatEngine.js';
import { EmojiAgent } from '../humanize/index.js';
import { SkillSessionManager } from '../ai/sessionManager.js';
import { getSkillConfig, loadAutoSessionSkills, readDefaultSkillConfig, readRuntimeSkillConfig } from '../ai/httpSkillRegistry.js';
import { getSessionDebugSnapshot } from '../ai/runtimeDebugStore.js';
import { getPokeDebugSnapshot } from '../ai/runtimePokeDebugStore.js';
import Renderer from '../ai/renderer.js';
import Meme from '../core/meme.js';

const WEB_CONSOLE_DIR = path.join(Path.lib, 'webConsole');
const PUBLIC_DIR = path.join(WEB_CONSOLE_DIR, 'public');
const CHAT_DB_FILE = path.join(process.cwd(), 'data', 'chat', 'chat.json');
const AFFINITY_FILE = path.join(process.cwd(), 'data', 'crystelf', 'affinity', 'affinity.json');
const USAGE_LOG_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'ai-usage.log');
const AFFINITY_LOG_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'affinity.log');
const IMAGE_MONITOR_REVIEW_LOG = path.join(process.cwd(), 'data', 'crystelf', 'image-monitor', 'review-log.jsonl');
const IMAGE_MONITOR_MEME_INDEX = path.join(process.cwd(), 'data', 'crystelf', 'image-monitor', 'meme-index.jsonl');
const HELP_DIY_FILE = path.join(Path.config, 'help-diy.json');
const LEGACY_HELP_DIY_FILE = path.join(process.cwd(), 'data', 'crystelf', 'help-diy.json');
const HELP_DIY_UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads', 'help-diy');
const HELP_DIY_HISTORY_FILE = path.join(process.cwd(), 'data', 'crystelf', 'help-diy-history.json');
const CONSOLE_BACKGROUND_SOURCE_URL = '';
const CONSOLE_BACKGROUND_CACHE_DIR = path.join(process.cwd(), 'temp', 'web-console-background');
const CONSOLE_BACKGROUND_CACHE_FILE = path.join(CONSOLE_BACKGROUND_CACHE_DIR, 'current-image.bin');
const CONSOLE_BACKGROUND_CACHE_META_FILE = path.join(CONSOLE_BACKGROUND_CACHE_DIR, 'current-image.json');
const PACKAGE_JSON_FILE = Path.pkg;
const PACKAGE_LOCK_FILE = path.join(Path.root, 'package-lock.json');
const FILE_BROWSER_ROOT_DIR = process.cwd();
const FILE_BROWSER_BLOCKED_NAMES = new Set(['.git', 'node_modules', 'temp']);
const FILE_BROWSER_MAX_FILE_BYTES = 2 * 1024 * 1024;
const FILE_BROWSER_MAX_DIRECTORY_ENTRIES = 500;
const FILE_BROWSER_SEARCH_MAX_RESULTS = 120;
const FILE_BROWSER_SEARCH_MAX_PREVIEW_LENGTH = 180;
const REMOTE_IMAGE_PROXY_TIMEOUT_MS = 10000;
const REMOTE_IMAGE_PROXY_MAX_BYTES = 15 * 1024 * 1024;
const REMOTE_IMAGE_PROXY_MAX_REDIRECTS = 3;
const WEB_CONSOLE_REQUEST_BODY_MAX_BYTES = 8 * 1024 * 1024;
const WEB_CONSOLE_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const WEB_CONSOLE_LOGIN_WINDOW_MS = 10 * 60 * 1000;
const WEB_CONSOLE_LOGIN_MAX_FAILURES = 5;
const WEB_CONSOLE_LOGIN_BLOCK_MS = 15 * 60 * 1000;
const FILE_BROWSER_TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml', '.toml',
  '.ini', '.conf', '.sh', '.ps1', '.py', '.ts', '.tsx', '.jsx', '.vue', '.sql', '.log',
  '.env', '.gitignore', '.editorconfig', '.prettierrc', '.eslintrc',
]);
const require = createRequire(import.meta.url);
const hljs = require('highlight.js');
const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),
  mark: (...args) => console.log(...args),
};

function buildOpenAiCompatibleUrl(baseApi = '', pathSuffix = '') {
  const base = String(baseApi || '').trim().replace(/\/+$/, '');
  const suffix = `/${String(pathSuffix || '').trim().replace(/^\/+/, '')}`;
  if (base.toLowerCase().endsWith('/v1') && suffix.startsWith('/v1/')) {
    return base + suffix.slice(3);
  }
  return base + suffix;
}

let serverInstance = null;
let currentInfo = null;
const webConsoleLoginAttempts = new Map();
const dependencyInstallTasks = new Map();
const dependencyInstallActiveTaskKeys = new Map();
const dependencyInstallTargetLocks = new Map();
const DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT = 4000;
const DEPENDENCY_INSTALL_TASK_TTL_MS = 30 * 60 * 1000;
const DEPENDENCY_INSTALL_TASK_MAX_COUNT = 80;

const DEPENDENCY_GROUPS = [
  { key: 'runtime', label: '运行依赖', field: 'dependencies', required: true, installSupported: true },
  { key: 'dev', label: '开发依赖', field: 'devDependencies', required: false, installSupported: true },
  { key: 'peer', label: 'Peer 依赖', field: 'peerDependencies', required: false, installSupported: false },
  { key: 'optional', label: '可选依赖', field: 'optionalDependencies', required: false, installSupported: false },
];

const SETTINGS_CATEGORY_LABELS = {
  main: '主配置',
  core: '旧核心兼容',
  ai: 'AI',
  auth: '认证',
  extension: '扩展',
  other: '其他',
};

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

const WEB_CONSOLE_AUTH_COOKIE = 'crystelf_web_console_auth';

function isSecureRequest(req) {
  const remoteAddress = String(req?.socket?.remoteAddress || '').trim();
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (isLoopbackAddress(remoteAddress) && forwardedProto) {
    return forwardedProto === 'https';
  }
  return Boolean(req?.socket?.encrypted);
}

function getRequestOrigin(req) {
  const remoteAddress = String(req?.socket?.remoteAddress || '').trim();
  const forwardedHost = isLoopbackAddress(remoteAddress)
    ? String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim()
    : '';
  const host = forwardedHost || String(req?.headers?.host || '').trim();
  if (!host) {
    return '';
  }
  return `${isSecureRequest(req) ? 'https' : 'http'}://${host}`;
}

function getSocketRemoteAddress(req) {
  return String(req?.socket?.remoteAddress || '').trim();
}

function getRequestClientAddress(req) {
  const socketAddress = getSocketRemoteAddress(req);
  const forwardedFor = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  if (isLoopbackAddress(socketAddress) && forwardedFor) {
    return forwardedFor;
  }
  return socketAddress;
}

function hasForwardedClientHeaders(req) {
  const xForwardedFor = String(req?.headers?.['x-forwarded-for'] || '').trim();
  const xRealIp = String(req?.headers?.['x-real-ip'] || '').trim();
  const forwarded = String(req?.headers?.forwarded || '').trim();
  const cfConnectingIp = String(req?.headers?.['cf-connecting-ip'] || '').trim();
  return Boolean(xForwardedFor || xRealIp || forwarded || cfConnectingIp);
}

function isLoopbackAddress(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1'
    || normalized === 'localhost';
}

function isBootstrapSetupRequest(req) {
  const { authToken } = getWebConsoleConfig();
  if (authToken) {
    return false;
  }
  // Bootstrap must come from a direct local connection, not via any proxy headers.
  if (!isLoopbackAddress(getSocketRemoteAddress(req))) {
    return false;
  }
  return !hasForwardedClientHeaders(req);
}

function isBootstrapApiPath(pathname = '') {
  const normalized = String(pathname || '').trim();
  return normalized === '/api/auth/status'
    || normalized === '/api/overview'
    || normalized === '/api/config/editable'
    || normalized === '/api/plugin-settings'
    || normalized === '/api/plugin-settings/save';
}

function getSecurityHeaders(contentType = '') {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };

  if (String(contentType || '').startsWith('text/html')) {
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; ');
  }

  return headers;
}

function sendJson(res, payload, statusCode = 200, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...getSecurityHeaders('application/json; charset=utf-8'),
    ...headers,
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, content, statusCode = 200, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...getSecurityHeaders(contentType),
    ...headers,
  });
  res.end(content);
}

function sendRedirect(res, location, statusCode = 302, headers = {}) {
  res.writeHead(statusCode, {
    Location: location,
    'Cache-Control': 'no-store',
    ...getSecurityHeaders('text/html; charset=utf-8'),
    ...headers,
  });
  res.end();
}

function sendBinary(res, buffer, statusCode = 200, headers = {}) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    ...getSecurityHeaders(),
    ...headers,
  });
  res.end(buffer);
}

function createHttpError(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(String(message || 'Internal Server Error'));
  error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
  if (code) {
    error.code = String(code);
  }
  return error;
}

function parseCookieHeader(headerValue = '') {
  return String(headerValue || '')
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const index = item.indexOf('=');
      if (index <= 0) {
        return acc;
      }
      const key = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();
      if (key) {
        acc[key] = decodeURIComponent(value);
      }
      return acc;
    }, {});
}

function getWebConsoleAuthCookieValue(req) {
  const cookies = parseCookieHeader(req?.headers?.cookie || '');
  return String(cookies[WEB_CONSOLE_AUTH_COOKIE] || '').trim();
}

function safeTimingEqual(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function toBase64Url(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function getWebConsoleSessionSecret(authToken = '') {
  return crypto
    .createHash('sha256')
    .update(`crystelf-web-console|${process.cwd()}|${String(authToken || '').trim()}`)
    .digest();
}

function signWebConsoleSessionPayload(payload, authToken = '') {
  return crypto
    .createHmac('sha256', getWebConsoleSessionSecret(authToken))
    .update(String(payload || ''))
    .digest('base64url');
}

function createWebConsoleSession(authToken = '') {
  const sessionPayload = {
    v: 1,
    exp: Date.now() + (WEB_CONSOLE_SESSION_MAX_AGE_SECONDS * 1000),
    nonce: crypto.randomBytes(18).toString('base64url'),
    csrf: crypto.randomBytes(18).toString('base64url'),
  };
  const encodedPayload = toBase64Url(JSON.stringify(sessionPayload));
  const signature = signWebConsoleSessionPayload(encodedPayload, authToken);
  return `${encodedPayload}.${signature}`;
}

function parseWebConsoleSession(req) {
  const { authToken } = getWebConsoleConfig();
  const rawCookie = getWebConsoleAuthCookieValue(req);
  if (!authToken || !rawCookie) {
    return { authorized: false, session: null };
  }

  const [encodedPayload, signature] = String(rawCookie || '').split('.');
  if (!encodedPayload || !signature) {
    return { authorized: false, session: null };
  }

  const expectedSignature = signWebConsoleSessionPayload(encodedPayload, authToken);
  if (!safeTimingEqual(signature, expectedSignature)) {
    return { authorized: false, session: null };
  }

  try {
    const session = JSON.parse(fromBase64Url(encodedPayload));
    if (!session || typeof session !== 'object') {
      return { authorized: false, session: null };
    }
    if (Number(session.exp || 0) <= Date.now()) {
      return { authorized: false, session: null };
    }
    if (typeof session.csrf !== 'string' || !session.csrf) {
      return { authorized: false, session: null };
    }
    return { authorized: true, session };
  } catch {
    return { authorized: false, session: null };
  }
}

function buildWebConsoleAuthCookie(req, sessionValue) {
  const parts = [
    `${WEB_CONSOLE_AUTH_COOKIE}=${encodeURIComponent(String(sessionValue || '').trim())}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${WEB_CONSOLE_SESSION_MAX_AGE_SECONDS}`,
  ];
  if (isSecureRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function buildWebConsoleAuthCookieClearHeader(req) {
  const parts = [
    `${WEB_CONSOLE_AUTH_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (isSecureRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function getHttpErrorStatus(error, fallbackStatus = 500) {
  const statusCode = Number(error?.statusCode || 0);
  if (statusCode >= 400 && statusCode <= 599) {
    return statusCode;
  }
  return fallbackStatus;
}

function safeWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeFileBrowserRelativePath(value = '') {
  const normalized = path.posix.normalize(`/${String(value || '').trim().replace(/\\/g, '/')}`).replace(/^\/+/, '');
  if (!normalized || normalized === '.') {
    return '';
  }
  if (normalized.startsWith('..')) {
    throw createHttpError(400, '文件路径越界', 'FILE_BROWSER_PATH_OUT_OF_RANGE');
  }
  return normalized;
}

function isFileBrowserBlockedSegment(segment = '') {
  const value = String(segment || '').trim().toLowerCase();
  if (!value) return false;
  if (FILE_BROWSER_BLOCKED_NAMES.has(value)) return true;
  return value.startsWith('.');
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

function ensurePathResolvedWithinRoot(targetPath = '', rootPath = '', options = {}) {
  const allowMissing = options.allowMissing === true;
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

function resolveFileBrowserPath(value = '', options = {}) {
  const normalizedRelativePath = normalizeFileBrowserRelativePath(value);
  const segments = normalizedRelativePath.split('/').filter(Boolean);
  if (segments.some(segment => isFileBrowserBlockedSegment(segment))) {
    throw createHttpError(403, '当前路径不允许在网页控制台中访问', 'FILE_BROWSER_PATH_BLOCKED');
  }

  const absolutePath = path.resolve(FILE_BROWSER_ROOT_DIR, normalizedRelativePath || '.');
  if (absolutePath !== FILE_BROWSER_ROOT_DIR && !absolutePath.startsWith(`${FILE_BROWSER_ROOT_DIR}${path.sep}`)) {
    throw createHttpError(400, '文件路径越界', 'FILE_BROWSER_PATH_OUT_OF_RANGE');
  }

  const allowMissing = options.allowMissing === true;
  const expectedType = options.expectedType || 'any';
  let stat = null;

  ensurePathResolvedWithinRoot(absolutePath, FILE_BROWSER_ROOT_DIR, { allowMissing });

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
    rootDir: FILE_BROWSER_ROOT_DIR,
    relativePath: normalizedRelativePath,
    absolutePath,
    stat,
  };
}

function getFileBrowserDisplayName(relativePath = '') {
  if (!relativePath) {
    return path.basename(FILE_BROWSER_ROOT_DIR) || FILE_BROWSER_ROOT_DIR;
  }
  return path.basename(relativePath);
}

function escapeFileBrowserHtml(value = '') {
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
  if (FILE_BROWSER_TEXT_EXTENSIONS.has(extension) || FILE_BROWSER_TEXT_EXTENSIONS.has(baseName.toLowerCase())) {
    return true;
  }
  if (!buffer) {
    return extension === '';
  }
  return !buffer.includes(0);
}

function getFileBrowserHighlightLanguage(filePath = '') {
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

function buildFileBrowserHighlightPayload(payload = {}) {
  const requestedPath = typeof payload?.path === 'string' ? payload.path : '';
  const hasInlineContent = typeof payload?.content === 'string';
  const target = resolveFileBrowserPath(requestedPath, { expectedType: 'file' });
  let content = '';

  if (hasInlineContent) {
    content = payload.content;
  } else {
    if (Number(target.stat?.size || 0) > FILE_BROWSER_MAX_FILE_BYTES) {
      throw createHttpError(413, `文件过大，仅支持读取不超过 ${Math.round(FILE_BROWSER_MAX_FILE_BYTES / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
    }
    content = fs.readFileSync(target.absolutePath, 'utf8');
  }

  if (Buffer.byteLength(content, 'utf8') > FILE_BROWSER_MAX_FILE_BYTES) {
    throw createHttpError(413, `文件过大，仅支持预览不超过 ${Math.round(FILE_BROWSER_MAX_FILE_BYTES / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
  }
  if (!isLikelyTextFile(target.relativePath, Buffer.from(content, 'utf8'))) {
    throw createHttpError(415, '仅支持预览文本文件', 'FILE_BROWSER_UNSUPPORTED_FILE_TYPE');
  }

  const preferredLanguage = getFileBrowserHighlightLanguage(target.relativePath);
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
      value: escapeFileBrowserHtml(content),
      language: preferredLanguage || '',
    };
  }

  return {
    success: true,
    preview: {
      path: target.relativePath,
      name: getFileBrowserDisplayName(target.relativePath),
      language: preferredLanguage || '',
      detectedLanguage: String(highlightResult?.language || preferredLanguage || 'plaintext'),
      lineCount: content ? content.split(/\r?\n/).length : 1,
      byteLength: Buffer.byteLength(content, 'utf8'),
      html: String(highlightResult?.value || '').replace(/\r\n?/g, '\n'),
      generatedAt: Date.now(),
    },
  };
}

function buildFileBrowserTreePayload(pathValue = '') {
  const target = resolveFileBrowserPath(pathValue, { expectedType: 'directory' });
  const entries = fs.readdirSync(target.absolutePath, { withFileTypes: true })
    .filter(item => !isFileBrowserBlockedSegment(item.name))
    .slice(0, FILE_BROWSER_MAX_DIRECTORY_ENTRIES)
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
      name: path.basename(FILE_BROWSER_ROOT_DIR) || FILE_BROWSER_ROOT_DIR,
    },
    current: {
      path: target.relativePath,
      name: getFileBrowserDisplayName(target.relativePath),
    },
    entries,
  };
}

function readFileBrowserFile(pathValue = '') {
  const target = resolveFileBrowserPath(pathValue, { expectedType: 'file' });
  if (Number(target.stat?.size || 0) > FILE_BROWSER_MAX_FILE_BYTES) {
    throw createHttpError(413, `文件过大，仅支持读取不超过 ${Math.round(FILE_BROWSER_MAX_FILE_BYTES / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
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
      name: getFileBrowserDisplayName(target.relativePath),
      size: buffer.length,
      mtimeMs: Number(target.stat?.mtimeMs || 0),
      content,
      editable: true,
    },
  };
}

function writeFileBrowserFile(payload = {}) {
  const pathValue = payload?.path;
  const content = typeof payload?.content === 'string' ? payload.content : '';
  const expectedMtimeMs = Number(payload?.expectedMtimeMs || 0);
  const forceOverwrite = payload?.forceOverwrite === true;
  const target = resolveFileBrowserPath(pathValue, { expectedType: 'file' });
  if (!isLikelyTextFile(target.relativePath)) {
    throw createHttpError(415, '仅支持保存文本文件', 'FILE_BROWSER_UNSUPPORTED_FILE_TYPE');
  }
  if (Buffer.byteLength(content, 'utf8') > FILE_BROWSER_MAX_FILE_BYTES) {
    throw createHttpError(413, `文件过大，仅支持保存不超过 ${Math.round(FILE_BROWSER_MAX_FILE_BYTES / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
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
              name: getFileBrowserDisplayName(target.relativePath),
              size: currentBuffer.length,
              mtimeMs: currentMtimeMs,
              editable: true,
            },
          },
        };
        throw conflictError;
      }

      return {
        success: true,
        file: {
          path: target.relativePath,
          name: getFileBrowserDisplayName(target.relativePath),
          size: currentBuffer.length,
          mtimeMs: currentMtimeMs,
          editable: true,
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
      name: getFileBrowserDisplayName(target.relativePath),
      size: nextStat.size,
      mtimeMs: Number(nextStat.mtimeMs || 0),
      editable: true,
    },
  };
}

function createFileBrowserFile(payload = {}) {
  const pathValue = payload?.path;
  const content = typeof payload?.content === 'string' ? payload.content : '';
  const target = resolveFileBrowserPath(pathValue, { allowMissing: true });
  if (!target.relativePath) {
    throw createHttpError(400, '目标文件路径不能为空', 'FILE_BROWSER_TARGET_EMPTY');
  }
  if (target.stat) {
    throw createHttpError(409, '目标文件已存在', 'FILE_BROWSER_TARGET_EXISTS');
  }
  if (!isLikelyTextFile(target.relativePath, Buffer.from(content, 'utf8'))) {
    throw createHttpError(415, '仅支持创建文本文件', 'FILE_BROWSER_UNSUPPORTED_FILE_TYPE');
  }
  if (Buffer.byteLength(content, 'utf8') > FILE_BROWSER_MAX_FILE_BYTES) {
    throw createHttpError(413, `文件过大，仅支持创建不超过 ${Math.round(FILE_BROWSER_MAX_FILE_BYTES / 1024 / 1024)}MB 的文本文件`, 'FILE_BROWSER_FILE_TOO_LARGE');
  }

  const parentRelativePath = path.posix.dirname(target.relativePath).replace(/^\.$/, '');
  resolveFileBrowserPath(parentRelativePath, { expectedType: 'directory' });
  fs.writeFileSync(target.absolutePath, content, 'utf8');
  const stat = fs.statSync(target.absolutePath);
  return {
    success: true,
    file: {
      path: target.relativePath,
      name: getFileBrowserDisplayName(target.relativePath),
      size: stat.size,
      mtimeMs: Number(stat.mtimeMs || 0),
      editable: true,
      created: true,
    },
  };
}

function buildFileBrowserNodePayload(pathValue = '') {
  const target = resolveFileBrowserPath(pathValue);
  const isDirectory = target.stat?.isDirectory?.() === true;
  const isFile = target.stat?.isFile?.() === true;
  return {
    success: true,
    node: {
      path: target.relativePath,
      name: getFileBrowserDisplayName(target.relativePath),
      type: isDirectory ? 'directory' : isFile ? 'file' : 'other',
      size: Number(target.stat?.size || 0),
      mtimeMs: Number(target.stat?.mtimeMs || 0),
      editable: isFile ? isLikelyTextFile(target.relativePath) : false,
    },
  };
}

function createFileBrowserDirectory(payload = {}) {
  const pathValue = payload?.path;
  const target = resolveFileBrowserPath(pathValue, { allowMissing: true });
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
      name: getFileBrowserDisplayName(target.relativePath),
      type: 'directory',
      size: Number(stat.size || 0),
      mtimeMs: Number(stat.mtimeMs || 0),
      created: true,
    },
  };
}

function renameFileBrowserNode(payload = {}) {
  const sourcePath = payload?.sourcePath;
  const targetPath = payload?.targetPath;
  const source = resolveFileBrowserPath(sourcePath);
  if (!source.relativePath) {
    throw createHttpError(400, '根目录不允许重命名', 'FILE_BROWSER_ROOT_RENAME_FORBIDDEN');
  }

  const target = resolveFileBrowserPath(targetPath, { allowMissing: true });
  if (!target.relativePath) {
    throw createHttpError(400, '目标路径不能为空', 'FILE_BROWSER_TARGET_EMPTY');
  }
  if (target.stat) {
    throw createHttpError(409, '目标路径已存在', 'FILE_BROWSER_TARGET_EXISTS');
  }
  if (source.absolutePath === target.absolutePath) {
    return buildFileBrowserNodePayload(source.relativePath);
  }

  const targetParentPath = path.posix.dirname(target.relativePath).replace(/^\.$/, '');
  resolveFileBrowserPath(targetParentPath, { expectedType: 'directory' });
  fs.renameSync(source.absolutePath, target.absolutePath);
  return buildFileBrowserNodePayload(target.relativePath);
}

function deleteFileBrowserNode(payload = {}) {
  const targetPath = payload?.path;
  const target = resolveFileBrowserPath(targetPath);
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
        name: getFileBrowserDisplayName(target.relativePath),
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
        name: getFileBrowserDisplayName(target.relativePath),
        type: 'file',
      },
    };
  }

  throw createHttpError(400, '当前节点不支持删除', 'FILE_BROWSER_DELETE_UNSUPPORTED');
}

function normalizeFileBrowserSearchLimit(value = 0) {
  const limit = Number(value || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return FILE_BROWSER_SEARCH_MAX_RESULTS;
  }
  return Math.min(FILE_BROWSER_SEARCH_MAX_RESULTS, Math.max(1, Math.round(limit)));
}

function buildFileBrowserSearchPreview(line = '', matchStart = 0, matchLength = 0) {
  const source = String(line || '').replace(/\t/g, '  ');
  if (!source) {
    return '(empty line)';
  }
  if (source.length <= FILE_BROWSER_SEARCH_MAX_PREVIEW_LENGTH) {
    return source.trim();
  }

  const safeMatchStart = Math.max(0, Number(matchStart || 0));
  const safeMatchLength = Math.max(1, Number(matchLength || 1));
  const center = safeMatchStart + Math.floor(safeMatchLength / 2);
  const halfWindow = Math.floor(FILE_BROWSER_SEARCH_MAX_PREVIEW_LENGTH / 2);
  const sliceStart = Math.max(0, center - halfWindow);
  const sliceEnd = Math.min(source.length, sliceStart + FILE_BROWSER_SEARCH_MAX_PREVIEW_LENGTH);
  const prefix = sliceStart > 0 ? '...' : '';
  const suffix = sliceEnd < source.length ? '...' : '';
  return `${prefix}${source.slice(sliceStart, sliceEnd).trim()}${suffix}`;
}

function searchFileBrowserContent(queryValue = '', options = {}) {
  const query = String(queryValue || '').trim();
  if (!query) {
    throw createHttpError(400, '搜索关键字不能为空', 'FILE_BROWSER_SEARCH_EMPTY');
  }

  const caseSensitive = options.caseSensitive === true;
  const limit = normalizeFileBrowserSearchLimit(options.limit);
  const scope = resolveFileBrowserPath(options.path || '', { expectedType: 'directory' });
  const stack = [{ relativePath: scope.relativePath, absolutePath: scope.absolutePath }];
  const results = [];
  const normalizedNeedle = caseSensitive ? query : query.toLocaleLowerCase();
  let truncated = false;

  while (stack.length > 0 && results.length < limit) {
    const current = stack.pop();
    const entries = fs.readdirSync(current.absolutePath, { withFileTypes: true })
      .filter(item => !isFileBrowserBlockedSegment(item.name))
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
      if (Number(stat.size || 0) > FILE_BROWSER_MAX_FILE_BYTES) {
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
            name: getFileBrowserDisplayName(relativePath),
            lineNumber: lineIndex + 1,
            columnNumber: columnIndex + 1,
            matchLength: query.length,
            preview: buildFileBrowserSearchPreview(line, columnIndex, query.length),
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

function isLegacyDefaultMemeCharacter(value = '') {
  return /^zhenxun$/i.test(String(value || '').trim());
}

function normalizePersonaDisplayName(value = '') {
  const cleaned = String(value || '')
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/gu, '');
  if (!cleaned) {
    return '';
  }

  if (Array.from(cleaned).length > 24) {
    return '';
  }

  if (/^(AI|Bot|Assistant|ChatGPT|机器人|助手)$/iu.test(cleaned)) {
    return '';
  }

  return cleaned;
}

function extractPersonaDisplayName(personaText = '') {
  const text = String(personaText || '').trim();
  if (!text) {
    return '';
  }

  const patterns = [
    /(?:名字|昵称|名称)\s*(?:是|叫|为|:|：)\s*[`"'“”‘’]?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})(?=[\s,，。！？!?:：]|$)/u,
    /(?:我是|叫我)\s*[`"'“”‘’]?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})(?=[\s,，。！？!?:：]|$)/u,
    /(?:扮演|饰演)\s*[`"'“”‘’]?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})(?=[\s,，。！？!?:：]|$)/u,
    /you are (?:an? )?(?:ai|assistant|bot)?\s*named\s*[`"']?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,32})/iu,
    /your name is\s*[`"']?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,32})/iu,
  ];

  for (const pattern of patterns) {
    const matched = text.match(pattern);
    const normalized = normalizePersonaDisplayName(matched?.[1] || '');
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function getConfiguredMemeCharacterState(aiConfig = {}, memeConfigOverride = null) {
  const memeConfig = memeConfigOverride || aiConfig.memeConfig || {};
  const raw = String(memeConfig.character || aiConfig.character || '').trim();
  return {
    raw,
    effective: raw && !isLegacyDefaultMemeCharacter(raw) ? raw : '',
    isLegacyDefault: Boolean(raw) && isLegacyDefaultMemeCharacter(raw),
  };
}

function buildBotIdentitySnapshot(allConfigs = {}, memeConfigOverride = null) {
  const aiConfig = allConfigs.ai || {};
  const profileConfig = allConfigs.profile || {};
  const configuredCharacter = getConfiguredMemeCharacterState(aiConfig, memeConfigOverride);
  const botNickname = String(profileConfig.nickName || '').trim() || '灵晶';
  const personaCardName = extractPersonaDisplayName(aiConfig.botPersona || aiConfig.persona || '');
  const recommendedCharacter = configuredCharacter.effective || personaCardName || botNickname || '灵晶';
  const recommendedCharacterSource = configuredCharacter.effective
    ? 'configured'
    : personaCardName
      ? 'persona'
      : botNickname
        ? 'nickname'
        : 'fallback';

  return {
    botNickname,
    personaCardName,
    configuredCharacter: configuredCharacter.raw,
    legacyConfiguredCharacter: configuredCharacter.isLegacyDefault,
    recommendedCharacter,
    recommendedCharacterSource,
  };
}

function resolveRuntimeMemeCharacter(payloadCharacter = '', allConfigs = {}, memeConfigOverride = null) {
  const explicit = String(payloadCharacter || '').trim();
  if (explicit) {
    return explicit;
  }

  return buildBotIdentitySnapshot(allConfigs, memeConfigOverride).recommendedCharacter || '灵晶';
}

function saveBase64Image(dataUrl = '', prefix = 'help') {
  const matched = String(dataUrl || '').match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!matched) {
    throw new Error('图片数据格式不正确');
  }
  const mime = matched[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
  const base64 = matched[3];
  if (!fs.existsSync(HELP_DIY_UPLOAD_DIR)) {
    fs.mkdirSync(HELP_DIY_UPLOAD_DIR, { recursive: true });
  }
  const fileName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = path.join(HELP_DIY_UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return `/uploads/help-diy/${fileName}`;
}

function deleteHelpDiyImage(urlPath = '') {
  const normalized = String(urlPath || '').trim();
  if (!normalized.startsWith('/uploads/help-diy/')) {
    throw createHttpError(400, '只允许删除 help DIY 上传目录中的图片', 'HELP_DIY_IMAGE_DELETE_FORBIDDEN');
  }
  const relativeUploadPath = path.posix.normalize(`/${normalized.slice('/uploads/help-diy/'.length)}`).replace(/^\/+/, '');
  if (!relativeUploadPath || relativeUploadPath.startsWith('..')) {
    throw createHttpError(400, '图片路径越界，拒绝删除', 'HELP_DIY_IMAGE_PATH_OUT_OF_RANGE');
  }
  const filePath = path.resolve(HELP_DIY_UPLOAD_DIR, relativeUploadPath.replace(/\//g, path.sep));
  ensurePathResolvedWithinRoot(filePath, HELP_DIY_UPLOAD_DIR, { allowMissing: true });
  if (fs.existsSync(filePath)) {
    const realFilePath = getRealPathSafe(filePath) || filePath;
    if (!isPathInsideRoot(realFilePath, getRealPathSafe(HELP_DIY_UPLOAD_DIR) || HELP_DIY_UPLOAD_DIR)) {
      throw createHttpError(400, '图片路径越界，拒绝删除', 'HELP_DIY_IMAGE_PATH_OUT_OF_RANGE');
    }
    fs.unlinkSync(realFilePath);
  }
  return true;
}

function getDefaultHelpDiyPayload() {
  return {
    enabled: false,
    updatedAt: '',
    home: {
      mode: 'text',
      text: [
        '魔丸控制台帮助',
        '',
        '可以在这里自定义首页和分类帮助文案，也可以改成自定义图片。',
        '1. 首页帮助可展示插件概览',
        '2. AI 分类可展示对话和模型相关命令',
        '3. 娱乐分类可展示表情包、戳一戳等能力',
        '4. 调试分类可展示控制台和诊断入口',
        '',
        '建议分类入口：',
        '- #灵晶帮助 AI',
        '- #灵晶帮助 管理',
        '- #灵晶帮助 娱乐',
        '- #灵晶帮助 调试',
        '',
        '提示：',
        '修改前可先参考 README.md 或当前插件命令说明，避免帮助内容和实际功能不一致。',
      ].join('\n'),
      image: '',
    },
    categories: {
      ai: {
        mode: 'text',
        text: [
          'AI 功能',
          '',
          '这里可以放常用 AI 命令示例，例如：',
          '1. @机器人 直接对话',
          '2. #灵晶重置对话',
          '',
          '常见能力：',
          '- 群聊或私聊连续对话',
          '- 角色设定与人格卡',
          '- 表情包和回复风格控制',
          '- 多模型或多接口配置',
          '- Markdown/图片等富文本回复',
          '',
          '建议：',
          '如果启用了连续对话，帮助文案里最好同时注明重置、退出、切模型等命令。',
        ].join('\n'),
        image: '',
      },
      manage: {
        mode: 'text',
        text: [
          '管理功能',
          '',
          '这里适合放配置、同步、更新、开关等管理命令。',
          '1. #更新灵晶',
          '2. #灵晶设置',
          '3. #灵晶重载配置',
          '4. #灵晶开启某功能',
          '5. #灵晶关闭某功能',
          '',
          '提示：',
          '如果某些命令受权限限制，建议在帮助里注明主人权限或管理员权限要求。',
        ].join('\n'),
        image: '',
      },
      fun: {
        mode: 'text',
        text: [
          '娱乐功能',
          '',
          '这里适合放表情包、戳一戳、RSS、随机娱乐命令。',
          '1. 60s',
          '2. 戳一戳 / 表情包',
          '3. #灵晶设置 emoji抑制',
          '',
          'RSS 示例：',
          '4. #rss订阅 关键词',
          '5. #rss列表',
          '6. #rss取消 订阅ID',
          '',
          '其他示例：',
          '7. #今日老婆',
          '8. #抽卡',
          '9. #签到',
        ].join('\n'),
        image: '',
      },
      debug: {
        mode: 'text',
        text: [
          '调试与控制台',
          '',
          '控制台默认用于本地调试和配置查看。',
          `- 本地地址通常为 ${getWebConsoleDisplayUrl()}`,
          '- 如果启用了外网访问，请务必设置强口令并确认反向代理或防火墙配置安全',
          '',
          '排查建议：',
          '- 登录后优先检查系统状态、配置页和日志页',
          '- 若页面异常刷新，先确认浏览器 localStorage 中的登录状态和 token 是否匹配',
          '- 若文件浏览器保存失败，查看是否发生并发修改冲突',
          '- 若帮助页或配置页显示异常，优先检查编码是否为 UTF-8',
        ].join('\n'),
        image: '',
      },
    },
  };
}

function normalizeHelpDiyBlock(block, fallbackText = '') {
  if (typeof block === 'string') {
    return { mode: 'text', text: String(block || fallbackText || '').trim(), image: '' };
  }
  return {
    mode: block?.mode === 'image' && String(block?.image || '').trim() ? 'image' : 'text',
    text: String(block?.text || fallbackText || '').trim(),
    image: String(block?.image || '').trim(),
  };
}

function getWebConsoleDisplayUrl() {
  const config = getWebConsoleConfig();
  const rawHost = String(config.host || '127.0.0.1').trim() || '127.0.0.1';
  const host = rawHost === '0.0.0.0' || rawHost === '::' ? '127.0.0.1' : rawHost;
  const port = Number(config.port) || 27891;
  return `http://${host}:${port}/`;
}

function getHelpDiyTemplates() {
  const webConsoleUrl = getWebConsoleDisplayUrl();
  return [
    {
      key: 'simple',
      label: '简洁版',
      description: '适合快速上手，首页只保留最常用的功能分类。',
      payload: {
        enabled: true,
        home: [
          '魔丸帮助',
          '',
          '常用分类',
          '- 对话互动',
          '- 群管理',
          '- 娱乐功能',
          '- 调试入口',
        ].join('\n'),
        categories: {
          ai: ['对话互动', '', '- 直接艾特机器人聊天', '- 查看会话状态', '- 查看知识命中'].join('\n'),
          manage: ['群管理', '', '- 入群验证', '- 欢迎消息', '- 用户画像'].join('\n'),
          fun: ['娱乐功能', '', '- 60s 新闻', '- 点歌', '- RSS 订阅'].join('\n'),
          debug: ['调试入口', '', `- 控制台首页 ${webConsoleUrl}`, '- 查看工具调用记录'].join('\n'),
        },
      },
    },
    {
      key: 'full',
      label: '完整默认版',
      description: '直接恢复为当前内置的完整默认帮助内容。',
      payload: {
        ...getDefaultHelpDiyPayload(),
        enabled: true,
      },
    },
    {
      key: 'admin',
      label: '管理版',
      description: '适合管理员群，突出维护、控制台和排障入口。',
      payload: {
        enabled: true,
        home: [
          '魔丸管理帮助',
          '',
          '管理入口',
          '- 控制台设置',
          '- 用户画像与好感',
          '',
          '调试入口',
          '- 工具调用记录',
          '- 会话状态',
          '- 日志排查',
        ].join('\n'),
        categories: {
          ai: ['对话互动', '', '- 艾特机器人聊天', '- 查看会话状态', '- 查看知识命中', '- 查看工具调用'].join('\n'),
          manage: ['管理功能', '', '- 入群验证', '- 欢迎消息', '- 用户画像', '- 好感排行'].join('\n'),
          fun: ['娱乐功能', '', '- 60s 新闻', '- 点歌', '- RSS 订阅', '- 表情与戳一戳'].join('\n'),
          debug: ['调试入口', '', `- 控制台首页 ${webConsoleUrl}`, '- 日志与运行状态', '- 依赖检查与安装'].join('\n'),
        },
      },
    },
  ];
}

async function getStoredHelpDiyPayload() {
  const cached = ConfigControl.get('help-diy');
  if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
    return cached;
  }

  const local = safeReadJson(HELP_DIY_FILE, null);
  if (local && typeof local === 'object' && !Array.isArray(local)) {
    return local;
  }

  const legacy = safeReadJson(LEGACY_HELP_DIY_FILE, null);
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    await ConfigControl.set('help-diy', legacy);
    return legacy;
  }

  return null;
}

async function buildHelpDiyPayload() {
  const defaults = getDefaultHelpDiyPayload();
  let payload = await getStoredHelpDiyPayload();

  if (!payload) {
    payload = {
      ...defaults,
      updatedAt: new Date().toISOString(),
    };
    await ConfigControl.set('help-diy', payload);
  }

  return {
    ...defaults,
    ...payload,
    home: normalizeHelpDiyBlock(payload?.home, defaults.home.text),
    categories: {
      ai: normalizeHelpDiyBlock(payload?.categories?.ai, defaults.categories.ai.text),
      manage: normalizeHelpDiyBlock(payload?.categories?.manage, defaults.categories.manage.text),
      fun: normalizeHelpDiyBlock(payload?.categories?.fun, defaults.categories.fun.text),
      debug: normalizeHelpDiyBlock(payload?.categories?.debug, defaults.categories.debug.text),
    },
  };
}

function buildHelpDiyHistoryPayload() {
  const items = safeReadJson(HELP_DIY_HISTORY_FILE, null);
  if (Array.isArray(items)) {
    return items.map(item => ({
      ...item,
      note: sanitizeHelpDiyHistoryNote(item?.note),
    }));
  }
  safeWriteJson(HELP_DIY_HISTORY_FILE, []);
  return [];
}

function sanitizeHelpDiyHistoryNote(value = '') {
  return replaceControlCharacters(value, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function replaceControlCharacters(value = '', replacement = ' ') {
  return Array.from(String(value || ''))
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127 ? replacement : char;
    })
    .join('');
}

function pushHelpDiyHistorySnapshot(payload = {}, note = '') {
  const current = buildHelpDiyHistoryPayload();
  const next = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      note: sanitizeHelpDiyHistoryNote(note),
      payload,
    },
    ...current,
  ].slice(0, 20);
  safeWriteJson(HELP_DIY_HISTORY_FILE, next);
  return next;
}

function deleteHelpDiyHistoryItem(id = '') {
  const current = buildHelpDiyHistoryPayload();
  const next = current.filter(item => item?.id !== String(id || '').trim());
  safeWriteJson(HELP_DIY_HISTORY_FILE, next);
  return next;
}

function clearHelpDiyHistory() {
  safeWriteJson(HELP_DIY_HISTORY_FILE, []);
  return [];
}

async function saveHelpDiyPayload(payload = {}) {
  const current = await buildHelpDiyPayload();
  const next = {
    ...current,
    enabled: payload.enabled === true,
    updatedAt: new Date().toISOString(),
    home: normalizeHelpDiyBlock(payload.home, current.home.text),
    categories: {
      ai: normalizeHelpDiyBlock(payload?.categories?.ai, current.categories.ai.text),
      manage: normalizeHelpDiyBlock(payload?.categories?.manage, current.categories.manage.text),
      fun: normalizeHelpDiyBlock(payload?.categories?.fun, current.categories.fun.text),
      debug: normalizeHelpDiyBlock(payload?.categories?.debug, current.categories.debug.text),
    },
  };
  await ConfigControl.set('help-diy', next);
  pushHelpDiyHistorySnapshot(next, payload?.historyNote);
  return next;
}

async function buildHelpDiyImportPreviewPayload(payload = {}) {
  const current = await buildHelpDiyPayload();
  const next = {
    enabled: payload.enabled === true,
    home: normalizeHelpDiyBlock(payload.home, ''),
    categories: {
      ai: normalizeHelpDiyBlock(payload?.categories?.ai, ''),
      manage: normalizeHelpDiyBlock(payload?.categories?.manage, ''),
      fun: normalizeHelpDiyBlock(payload?.categories?.fun, ''),
      debug: normalizeHelpDiyBlock(payload?.categories?.debug, ''),
    },
  };

  const changes = [];
  if (current.enabled !== next.enabled) changes.push('帮助自定义开关已变更');
  if (JSON.stringify(current.home || {}) !== JSON.stringify(next.home || {})) changes.push('首页帮助内容已变更');
  for (const key of ['ai', 'manage', 'fun', 'debug']) {
    if (JSON.stringify(current.categories?.[key] || {}) !== JSON.stringify(next.categories?.[key] || {})) {
      changes.push(`分类帮助内容已变更: ${key}`);
    }
  }

  return {
    success: true,
    changedCount: changes.length,
    changes,
    next,
  };
}

function readTailText(filePath, maxLength = 12000) {
  try {
    if (!fs.existsSync(filePath)) {
      return '';
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return content.length > maxLength ? content.slice(-maxLength) : content;
  } catch {
    return '';
  }
}

function getUsageDateKey(date = new Date()) {
  return typeof date === 'string'
    ? date.slice(0, 10)
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function getDailyUsageLogFile(date = new Date()) {
  return path.join(process.cwd(), 'data', 'crystelf', 'debug', `ai-usage-${getUsageDateKey(date)}.log`);
}

function safeReadUsageEntries(date = new Date()) {
  try {
    const targetFile = getDailyUsageLogFile(date);
    if (!fs.existsSync(targetFile)) {
      return [];
    }
    const content = fs.readFileSync(targetFile, 'utf8');
    if (!content.trim()) {
      return [];
    }
    return parseJsonObjects(content)
      .map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    logger.warn(`[webConsole] Failed to read AI usage records: ${error.message}`);
    return [];
  }
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    let totalBytes = 0;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', chunk => {
      if (settled) return;
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > WEB_CONSOLE_REQUEST_BODY_MAX_BYTES) {
        const error = createHttpError(413, `请求体过大，最大允许 ${Math.round(WEB_CONSOLE_REQUEST_BODY_MAX_BYTES / 1024 / 1024)}MB`, 'REQUEST_BODY_TOO_LARGE');
        req.destroy(error);
        fail(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', fail);
  });
}

function extractOriginFromHeaderValue(value = '') {
  try {
    return new URL(String(value || '').trim()).origin;
  } catch {
    return '';
  }
}

function isSameOriginRequest(req) {
  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin) {
    return false;
  }
  const originHeader = extractOriginFromHeaderValue(req?.headers?.origin || '');
  if (originHeader) {
    return originHeader === requestOrigin;
  }
  const refererOrigin = extractOriginFromHeaderValue(req?.headers?.referer || '');
  if (refererOrigin) {
    return refererOrigin === requestOrigin;
  }
  return false;
}

function requireSameOrigin(req, res) {
  if (isSameOriginRequest(req)) {
    return true;
  }
  sendJson(res, { success: false, error: '跨站请求已被拒绝' }, 403);
  return false;
}

function requireCsrf(req, res) {
  const authState = parseWebConsoleSession(req);
  if (!authState.authorized || !authState.session?.csrf) {
    sendJson(res, { success: false, error: '未登录或登录已失效' }, 401);
    return false;
  }
  const csrfHeader = String(req?.headers?.['x-crystelf-csrf'] || '').trim();
  if (!csrfHeader || !safeTimingEqual(csrfHeader, String(authState.session.csrf))) {
    sendJson(res, { success: false, error: '请求校验失败，请刷新页面后重试' }, 403);
    return false;
  }
  return true;
}

function parseIpv4ToInt(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return null;
    }
    value = (value << 8) + num;
  }
  return value >>> 0;
}

function isIpv4InCidr(ip, base, prefix) {
  const ipValue = parseIpv4ToInt(ip);
  const baseValue = parseIpv4ToInt(base);
  if (ipValue === null || baseValue === null) {
    return false;
  }
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipValue & mask) === (baseValue & mask);
}

function isBlockedProxyIpAddress(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const ipType = net.isIP(normalized);
  if (!ipType) {
    return false;
  }

  if (ipType === 4) {
    return isIpv4InCidr(normalized, '0.0.0.0', 8)
      || isIpv4InCidr(normalized, '10.0.0.0', 8)
      || isIpv4InCidr(normalized, '100.64.0.0', 10)
      || isIpv4InCidr(normalized, '127.0.0.0', 8)
      || isIpv4InCidr(normalized, '169.254.0.0', 16)
      || isIpv4InCidr(normalized, '172.16.0.0', 12)
      || isIpv4InCidr(normalized, '192.168.0.0', 16)
      || isIpv4InCidr(normalized, '198.18.0.0', 15);
  }

  if (normalized === '::' || normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    return net.isIP(mappedIpv4) === 4 ? isBlockedProxyIpAddress(mappedIpv4) : true;
  }
  if (/^fe[89ab]/.test(normalized)) {
    return true;
  }
  if (/^f[cd]/.test(normalized)) {
    return true;
  }
  if (/^ff/.test(normalized)) {
    return true;
  }
  return false;
}

function isBlockedProxyHostname(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) {
    return true;
  }
  if (isLoopbackAddress(normalized)) {
    return true;
  }
  return normalized.endsWith('.localhost');
}

async function assertSafeImageProxyTarget(targetUrl) {
  let parsed;
  try {
    parsed = new URL(String(targetUrl || '').trim());
  } catch {
    throw createHttpError(400, 'Invalid image URL.', 'IMAGE_PROXY_INVALID_URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createHttpError(400, 'Only http/https image URLs are allowed.', 'IMAGE_PROXY_INVALID_PROTOCOL');
  }
  if (parsed.username || parsed.password) {
    throw createHttpError(400, 'Image URL credentials are not allowed.', 'IMAGE_PROXY_INVALID_CREDENTIALS');
  }

  const hostname = String(parsed.hostname || '').trim().toLowerCase();
  if (!hostname) {
    throw createHttpError(400, 'Missing image host.', 'IMAGE_PROXY_MISSING_HOST');
  }
  if (isBlockedProxyHostname(hostname) || isBlockedProxyIpAddress(hostname)) {
    throw createHttpError(403, 'Refusing to proxy local or private network image URLs.', 'IMAGE_PROXY_PRIVATE_TARGET');
  }

  let records = [];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw createHttpError(502, 'Failed to resolve image host.', 'IMAGE_PROXY_DNS_LOOKUP_FAILED');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw createHttpError(502, 'Failed to resolve image host.', 'IMAGE_PROXY_DNS_LOOKUP_FAILED');
  }
  if (records.some(record => isBlockedProxyIpAddress(record?.address))) {
    throw createHttpError(403, 'Refusing to proxy local or private network image URLs.', 'IMAGE_PROXY_PRIVATE_TARGET');
  }

  return parsed.toString();
}

function buildImageProxyHeaders(targetUrl) {
  let referer = targetUrl;
  let origin = '';
  try {
    const parsed = new URL(targetUrl);
    referer = `${parsed.origin}/`;
    origin = parsed.origin;
  } catch {
    // Ignore invalid URLs and fall back to the original target string.
  }
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: referer,
    ...(origin ? { Origin: origin } : {}),
  };
}

function isRedirectResponseStatusSafe(statusCode = 0) {
  return [301, 302, 303, 307, 308].includes(Number(statusCode || 0));
}

function normalizeRemoteImageFetchErrorSafe(error) {
  if (error?.statusCode) {
    return error;
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return createHttpError(504, 'Remote image request timed out.', 'IMAGE_PROXY_TIMEOUT');
  }
  return createHttpError(502, 'Failed to fetch remote image.', 'IMAGE_PROXY_FETCH_FAILED');
}

async function closeRemoteImageResponseBodySafe(response) {
  if (!response?.body || typeof response.body.cancel !== 'function') {
    return;
  }
  try {
    await response.body.cancel();
  } catch {
    // Ignore cancellation failures after the response has already completed.
  }
}

async function fetchRemoteImageResponseSafe(targetUrl) {
  let currentUrl = await assertSafeImageProxyTarget(targetUrl);

  for (let redirectCount = 0; redirectCount <= REMOTE_IMAGE_PROXY_MAX_REDIRECTS; redirectCount += 1) {
    let response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        headers: buildImageProxyHeaders(currentUrl),
        redirect: 'manual',
        signal: AbortSignal.timeout(REMOTE_IMAGE_PROXY_TIMEOUT_MS),
      });
    } catch (error) {
      throw normalizeRemoteImageFetchErrorSafe(error);
    }

    if (!isRedirectResponseStatusSafe(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    await closeRemoteImageResponseBodySafe(response);

    if (redirectCount >= REMOTE_IMAGE_PROXY_MAX_REDIRECTS) {
      throw createHttpError(502, 'Remote image redirected too many times.', 'IMAGE_PROXY_TOO_MANY_REDIRECTS');
    }

    const location = String(response.headers.get('location') || '').trim();
    if (!location) {
      throw createHttpError(502, 'Remote image redirect is missing a location header.', 'IMAGE_PROXY_BAD_REDIRECT');
    }

    let nextUrl;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw createHttpError(502, 'Remote image returned an invalid redirect target.', 'IMAGE_PROXY_BAD_REDIRECT');
    }
    currentUrl = await assertSafeImageProxyTarget(nextUrl);
  }

  throw createHttpError(502, 'Remote image redirected too many times.', 'IMAGE_PROXY_TOO_MANY_REDIRECTS');
}

async function readRemoteImageBufferSafe(response) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
    try {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length > REMOTE_IMAGE_PROXY_MAX_BYTES) {
        throw createHttpError(413, `Remote image exceeds ${Math.round(REMOTE_IMAGE_PROXY_MAX_BYTES / 1024 / 1024)}MB limit.`, 'IMAGE_PROXY_TOO_LARGE');
      }
      return buffer;
    } catch (error) {
      throw normalizeRemoteImageFetchErrorSafe(error);
    }
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    let reading = true;
    while (reading) {
      const { done, value } = await reader.read();
      if (done) {
        reading = false;
        continue;
      }
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > REMOTE_IMAGE_PROXY_MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation errors after enforcing the size limit.
        }
        throw createHttpError(413, `Remote image exceeds ${Math.round(REMOTE_IMAGE_PROXY_MAX_BYTES / 1024 / 1024)}MB limit.`, 'IMAGE_PROXY_TOO_LARGE');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    throw normalizeRemoteImageFetchErrorSafe(error);
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // Ignore release failures from already-closed streams.
    }
  }

  return Buffer.concat(chunks, totalBytes);
}

async function proxyRemoteImageSafe(targetUrl) {
  const { response } = await fetchRemoteImageResponseSafe(targetUrl);
  if (!response.ok) {
    await closeRemoteImageResponseBodySafe(response);
    throw createHttpError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      `Remote image request failed with HTTP ${response.status}.`,
      'IMAGE_PROXY_BAD_STATUS',
    );
  }
  const contentType = String(response.headers.get('content-type') || 'application/octet-stream');
  return {
    buffer: await readRemoteImageBufferSafe(response),
    contentType,
  };
}

function normalizeImageContentTypeSafe(contentType = '') {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!normalized.startsWith('image/')) {
    throw createHttpError(415, 'Remote image URL did not return image content.', 'IMAGE_PROXY_INVALID_CONTENT_TYPE');
  }
  return normalized || 'application/octet-stream';
}

function ensureConsoleBackgroundCacheDir() {
  if (!fs.existsSync(CONSOLE_BACKGROUND_CACHE_DIR)) {
    fs.mkdirSync(CONSOLE_BACKGROUND_CACHE_DIR, { recursive: true });
  }
}

function readConsoleBackgroundCacheMeta() {
  const meta = safeReadJson(CONSOLE_BACKGROUND_CACHE_META_FILE, null);
  if (!meta || !fs.existsSync(CONSOLE_BACKGROUND_CACHE_FILE)) {
    return null;
  }
  return meta;
}

async function refreshConsoleBackgroundCache() {
  ensureConsoleBackgroundCacheDir();
  if (!CONSOLE_BACKGROUND_SOURCE_URL) {
    return writeConsoleBackgroundFallbackCache();
  }
  const targetUrl = `${CONSOLE_BACKGROUND_SOURCE_URL}${CONSOLE_BACKGROUND_SOURCE_URL.includes('?') ? '&' : '?'}_r=${Date.now()}`;
  const result = await proxyRemoteImageSafe(targetUrl);
  const contentType = normalizeImageContentTypeSafe(result.contentType);
  fs.writeFileSync(CONSOLE_BACKGROUND_CACHE_FILE, result.buffer);
  const meta = {
    sourceUrl: CONSOLE_BACKGROUND_SOURCE_URL,
    contentType,
    size: result.buffer.length,
    updatedAt: new Date().toISOString(),
    version: Date.now(),
  };
  safeWriteJson(CONSOLE_BACKGROUND_CACHE_META_FILE, meta);
  return meta;
}

function writeConsoleBackgroundFallbackCache() {
  ensureConsoleBackgroundCacheDir();
  const fallbackFile = path.join(PUBLIC_DIR, 'assets', 'console-background-light.svg');
  const buffer = fs.readFileSync(fallbackFile);
  const meta = {
    sourceUrl: fallbackFile,
    contentType: 'image/svg+xml',
    size: buffer.length,
    updatedAt: new Date().toISOString(),
    version: Date.now(),
    fallback: true,
  };
  fs.writeFileSync(CONSOLE_BACKGROUND_CACHE_FILE, buffer);
  safeWriteJson(CONSOLE_BACKGROUND_CACHE_META_FILE, meta);
  return meta;
}

async function ensureConsoleBackgroundCache() {
  const cached = readConsoleBackgroundCacheMeta();
  if (cached) {
    return cached;
  }
  try {
    return await refreshConsoleBackgroundCache();
  } catch (error) {
    logger.warn(`[webConsole] 刷新控制台背景图缓存失败，已回退到本地默认背景图: ${error.message}`);
    return writeConsoleBackgroundFallbackCache();
  }
}

async function readConsoleBackgroundCache() {
  const meta = await ensureConsoleBackgroundCache();
  return {
    meta,
    buffer: fs.readFileSync(CONSOLE_BACKGROUND_CACHE_FILE),
  };
}

async function serveConsoleBackgroundImage(res) {
  const { meta, buffer } = await readConsoleBackgroundCache();
  return sendBinary(res, buffer, 200, {
    'Content-Type': meta.contentType,
    'Content-Length': buffer.length,
    'X-Console-Background-Updated-At': meta.updatedAt,
    'X-Console-Background-Version': String(meta.version || ''),
  });
}

function getWebConsoleConfig() {
  const config = ConfigControl.get('config') || {};
  return {
    enabled: config.webConsole !== false,
    authToken: String(config.webConsoleToken || '').trim(),
    readOnly: config.webConsoleReadOnly === true,
    host: String(config.webConsoleHost || '127.0.0.1').trim() || '127.0.0.1',
    port: Math.min(65535, Math.max(1, Number(config.webConsolePort || 27891))),
    portAutoIncrement: config.webConsolePortAutoIncrement === true,
    pageSize: Math.max(1, Number(config.webConsolePageSize || 20)),
    maxPageSize: Math.max(1, Number(config.webConsoleMaxPageSize || 100)),
    exposeLogs: config.webConsoleExposeLogs !== false,
    logTailLength: Math.max(1000, Number(config.webConsoleLogTailLength || 12000)),
    maskSensitiveConfig: config.webConsoleMaskSensitiveConfig !== false,
    profileRecentMessagesLimit: Math.max(0, Number(config.webConsoleProfileRecentMessagesLimit || 20)),
    affinityHistoryLimit: Math.max(1, Number(config.webConsoleAffinityHistoryLimit || 50)),
  };
}

function getSettingsCategory(field = '') {
  const prefix = String(field).split('.')[0];
  if (prefix === 'config') return 'main';
  if (prefix === 'coreConfig') return 'core';
  if (prefix === 'ai') return 'ai';
  if (prefix === 'auth') return 'auth';
  if (['60s', 'music', 'poke', 'profile'].includes(prefix)) return 'extension';
  return 'other';
}

function normalizePositiveNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.round(num);
}

function isReadonlySchemaItem(item = {}) {
  return item?.componentProps?.readonly === true;
}

function isSecretSchemaItem(item = {}) {
  return item?.component === 'InputPassword';
}

function maskPluginSettingsValue(item = {}, value) {
  if (!isSecretSchemaItem(item)) {
    return value;
  }
  return String(value || '').trim() ? '******' : '';
}

function flattenConfigObject(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (String(key).startsWith('?')) continue;
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenConfigObject(value, nextKey));
    } else {
      result[nextKey] = value;
    }
  }
  return result;
}

function setByPath(target, pathKey, value) {
  const segments = String(pathKey).split('.');
  let current = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }
  current[segments[segments.length - 1]] = value;
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return source;
  }
  const output = Array.isArray(target) ? [...target] : { ...(target || {}) };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function buildPluginSettingsValues() {
  const allConfigs = ConfigControl.get() || {};
  const values = flattenConfigObject(allConfigs);
  const usageOverview = getUsageOverviewSync(new Date(), getPricingConfig(allConfigs));
  values['coreConfig.usageControl.dailySummary'] = usageOverview.summary || '暂无今日用量数据';
  values['coreConfig.usageControl.dailySceneSummary'] = usageOverview.sceneSummary || '暂无今日场景统计';
  values['coreConfig.usageControl.dailyModelSummary'] = usageOverview.modelSummary || '暂无今日模型统计';
  values['coreConfig.usageControl.dailyCostSummary'] = usageOverview.costSummary || '暂无今日费用统计';
  values['coreConfig.usageControl.dailyModelCostSummary'] = usageOverview.modelCostSummary || '暂无今日模型费用统计';
  values['coreConfig.usageControl.dailyLogFile'] = USAGE_LOG_FILE;
  values['coreConfig.usageControl.totalLogFile'] = USAGE_LOG_FILE;
  values['coreConfig.tools.tts.modelSummary'] = '此项用于展示当前 TTS 模型摘要，具体内容请以实际配置和控制台返回结果为准。';
  return values;
}

function normalizeSchemaValue(item, value) {
  if (item.component === 'Switch') {
    return value === true || value === 'true';
  }
  if (item.component === 'InputNumber') {
    if (value === '' || value === null || value === undefined) return value;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  if (item.component === 'InputArray') {
    return Array.isArray(value) ? value.map(item => String(item)) : [];
  }
  if (item.component === 'Select' && item.componentProps?.mode === 'multiple') {
    return Array.isArray(value) ? value : [];
  }
  return value;
}

function normalizeSkillTimeoutMs(value, fallback = 15000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(numeric), 1000), 60000);
}

function cloneJsonValue(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value == null ? fallback : value));
  } catch {
    return fallback;
  }
}

function validateSkillConfigPayload(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createHttpError(400, 'Skills 配置必须是 JSON 对象', 'SKILLS_CONFIG_INVALID');
  }
  const config = cloneJsonValue(raw, {});
  if ('enabled' in config && typeof config.enabled !== 'boolean') {
    throw createHttpError(400, 'Skills 配置的 enabled 必须是布尔值', 'SKILLS_CONFIG_INVALID');
  }
  if ('autoLoad' in config && typeof config.autoLoad !== 'boolean') {
    throw createHttpError(400, 'Skills 配置的 autoLoad 必须是布尔值', 'SKILLS_CONFIG_INVALID');
  }
  if ('defaultTimeoutMs' in config) {
    config.defaultTimeoutMs = normalizeSkillTimeoutMs(config.defaultTimeoutMs, 15000);
  }
  if ('definitions' in config && !Array.isArray(config.definitions)) {
    throw createHttpError(400, 'Skills 配置的 definitions 必须是数组', 'SKILLS_CONFIG_INVALID');
  }
  const definitionNames = new Set();
  for (const definition of Array.isArray(config.definitions) ? config.definitions : []) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw createHttpError(400, '每个 skill 定义都必须是对象', 'SKILLS_CONFIG_INVALID');
    }
    const definitionName = String(definition.name || '').trim();
    if (!definitionName) {
      throw createHttpError(400, '每个 skill 都必须提供 name', 'SKILLS_CONFIG_INVALID');
    }
    if (definitionNames.has(definitionName)) {
      throw createHttpError(400, `Skill 名称重复：${definitionName}`, 'SKILLS_CONFIG_DUPLICATE_NAME');
    }
    definitionNames.add(definitionName);
    if ('enabled' in definition && typeof definition.enabled !== 'boolean') {
      throw createHttpError(400, `Skill ${definitionName} 的 enabled 必须是布尔值`, 'SKILLS_CONFIG_INVALID');
    }
    if ('description' in definition && typeof definition.description !== 'string') {
      throw createHttpError(400, `Skill ${definitionName} 的 description 必须是字符串`, 'SKILLS_CONFIG_INVALID');
    }
    if ('allowedHosts' in definition && !Array.isArray(definition.allowedHosts)) {
      throw createHttpError(400, `Skill ${definitionName} 的 allowedHosts 必须是数组`, 'SKILLS_CONFIG_INVALID');
    }
    if ('timeoutMs' in definition) {
      definition.timeoutMs = normalizeSkillTimeoutMs(
        definition.timeoutMs,
        normalizeSkillTimeoutMs(config.defaultTimeoutMs, 15000)
      );
    }
    if ('tools' in definition && !Array.isArray(definition.tools)) {
      throw createHttpError(400, `Skill ${definitionName} 的 tools 必须是数组`, 'SKILLS_CONFIG_INVALID');
    }
    const toolNames = new Set();
    for (const tool of Array.isArray(definition.tools) ? definition.tools : []) {
      if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
        throw createHttpError(400, `Skill ${definitionName} 的 tool 必须是对象`, 'SKILLS_CONFIG_INVALID');
      }
      const toolName = String(tool.name || '').trim();
      if (!toolName) {
        throw createHttpError(400, `Skill ${definitionName} 下存在缺少 name 的 tool`, 'SKILLS_CONFIG_INVALID');
      }
      if (toolNames.has(toolName)) {
        throw createHttpError(400, `Skill ${definitionName} 下的 tool 名称重复：${toolName}`, 'SKILLS_CONFIG_DUPLICATE_TOOL');
      }
      toolNames.add(toolName);
      if ('enabled' in tool && typeof tool.enabled !== 'boolean') {
        throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 enabled 必须是布尔值`, 'SKILLS_CONFIG_INVALID');
      }
      if ('description' in tool && typeof tool.description !== 'string') {
        throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 description 必须是字符串`, 'SKILLS_CONFIG_INVALID');
      }
      if ('request' in tool) {
        if (!tool.request || typeof tool.request !== 'object' || Array.isArray(tool.request)) {
          throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 request 必须是对象`, 'SKILLS_CONFIG_INVALID');
        }
        if ('method' in tool.request && typeof tool.request.method !== 'string') {
          throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 request.method 必须是字符串`, 'SKILLS_CONFIG_INVALID');
        }
        if ('url' in tool.request && typeof tool.request.url !== 'string') {
          throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 request.url 必须是字符串`, 'SKILLS_CONFIG_INVALID');
        }
      }
    }
  }
  return config;
}

function buildSkillConfigEditorPayload() {
  const effectiveConfig = cloneJsonValue(getSkillConfig(), {});
  const runtimeConfig = cloneJsonValue(readRuntimeSkillConfig(), {});
  const defaultConfig = cloneJsonValue(readDefaultSkillConfig(), {});
  const effectiveDefinitions = Array.isArray(effectiveConfig.definitions) ? effectiveConfig.definitions : [];
  const effectiveToolCount = effectiveDefinitions.reduce((sum, item) => sum + (Array.isArray(item?.tools) ? item.tools.length : 0), 0);
  return {
    effectiveConfig,
    runtimeConfig,
    defaultConfig,
    stats: {
      effectiveDefinitionCount: effectiveDefinitions.length,
      effectiveToolCount,
      runtimeDefinitionCount: Array.isArray(runtimeConfig.definitions) ? runtimeConfig.definitions.length : 0,
      defaultDefinitionCount: Array.isArray(defaultConfig.definitions) ? defaultConfig.definitions.length : 0,
    },
  };
}

function buildSkillSettingsPayload() {
  const mergedConfig = getSkillConfig();
  const defaultConfig = readDefaultSkillConfig();
  const customConfig = readRuntimeSkillConfig();
  const defaultDefinitions = Array.isArray(defaultConfig.definitions) ? defaultConfig.definitions : [];
  const customDefinitions = Array.isArray(customConfig.definitions) ? customConfig.definitions : [];
  const defaultNameSet = new Set(defaultDefinitions.map(item => String(item?.name || '').trim()).filter(Boolean));
  const customNameSet = new Set(customDefinitions.map(item => String(item?.name || '').trim()).filter(Boolean));
  const definitions = (Array.isArray(mergedConfig.definitions) ? mergedConfig.definitions : [])
    .filter(item => item?.name)
    .map((item) => {
      const name = String(item.name || '').trim();
      const tools = (Array.isArray(item.tools) ? item.tools : [])
        .filter(tool => tool?.name)
        .map((tool) => {
          const properties = tool?.parameters?.properties;
          return {
            name: String(tool.name || '').trim(),
            enabled: tool.enabled !== false,
            description: String(tool.description || '').trim(),
            method: String(tool?.request?.method || 'GET').trim().toUpperCase(),
            parameterCount: properties && typeof properties === 'object' ? Object.keys(properties).length : 0,
            requiredParameters: Array.isArray(tool?.parameters?.required)
              ? tool.parameters.required.map(entry => String(entry || '').trim()).filter(Boolean)
              : [],
          };
        });
      return {
        name,
        enabled: item.enabled !== false,
        description: String(item.description || '').trim(),
        timeoutMs: normalizeSkillTimeoutMs(item.timeoutMs, normalizeSkillTimeoutMs(mergedConfig.defaultTimeoutMs, 15000)),
        toolCount: tools.length,
        enabledToolCount: tools.filter(tool => tool.enabled).length,
        allowedHosts: Array.isArray(item.allowedHosts) ? item.allowedHosts.map(host => String(host || '').trim()).filter(Boolean) : [],
        origin: defaultNameSet.has(name) ? 'builtin' : 'custom',
        customized: customNameSet.has(name),
        tools,
      };
    });

  return {
    enabled: mergedConfig.enabled === true,
    autoLoad: mergedConfig.autoLoad !== false,
    defaultTimeoutMs: normalizeSkillTimeoutMs(mergedConfig.defaultTimeoutMs, 15000),
    definitionCount: definitions.length,
    enabledDefinitionCount: definitions.filter(item => item.enabled).length,
    toolCount: definitions.reduce((sum, item) => sum + Number(item.toolCount || 0), 0),
    enabledToolCount: definitions.reduce((sum, item) => sum + Number(item.enabledToolCount || 0), 0),
    builtinDefinitionCount: definitions.filter(item => item.origin === 'builtin').length,
    customDefinitionCount: definitions.filter(item => item.origin === 'custom').length,
    definitions,
  };
}

async function buildPluginSettingsPayload() {
  const values = buildPluginSettingsValues();
  let currentGroup = '默认分组';
  const items = [];
  for (const item of guobaSchema) {
    if (item.component === 'SOFT_GROUP_BEGIN') {
      currentGroup = item.label || '默认分组';
      continue;
    }
    if (!item.field) continue;
    items.push({
      field: item.field,
      label: item.label,
      component: item.component,
      bottomHelpMessage: item.bottomHelpMessage || '',
      required: item.required === true,
      componentProps: item.componentProps || {},
      group: currentGroup,
      category: getSettingsCategory(item.field),
      readonly: isReadonlySchemaItem(item),
      value: maskPluginSettingsValue(item, values[item.field]),
    });
  }

  const categoryOrder = ['main', 'core', 'ai', 'auth', 'extension', 'other'];
  const categories = categoryOrder
    .map(key => ({
      key,
      label: SETTINGS_CATEGORY_LABELS[key],
      count: items.filter(item => item.category === key).length,
    }))
    .filter(item => item.count > 0);

  return {
    categories,
    items,
    skills: buildSkillSettingsPayload(),
  };
}

async function savePluginSettings(payload = {}) {
  const beforeConfig = ConfigControl.get('config') || {};
  const hadLoginToken = Boolean(String(beforeConfig.webConsoleToken || '').trim());
  const raw = payload?.data || {};
  const bootstrapMode = payload?.bootstrapMode === true;
  const pendingLoginToken = String(raw['config.webConsoleToken'] || '').trim();
  if (!hadLoginToken && !pendingLoginToken) {
    throw createHttpError(400, '首次初始化必须先设置控制台登录口令', 'BOOTSTRAP_TOKEN_REQUIRED');
  }
  const bootstrapAllowedFields = new Set(['config.webConsoleToken']);
  const groupedUpdates = {};
  for (const item of guobaSchema) {
    if (!item?.field || isReadonlySchemaItem(item)) continue;
    if (!(item.field in raw)) continue;
    if (bootstrapMode && !bootstrapAllowedFields.has(item.field)) continue;
    if (isSecretSchemaItem(item) && String(raw[item.field] || '').trim() === '******') continue;
    const [configName, ...rest] = item.field.split('.');
    if (!configName || rest.length === 0) continue;
    groupedUpdates[configName] ||= {};
    setByPath(groupedUpdates[configName], rest.join('.'), normalizeSchemaValue(item, raw[item.field]));
  }
  for (const [configName, update] of Object.entries(groupedUpdates)) {
    const existing = ConfigControl.get(configName) || {};
    await ConfigControl.set(configName, deepMerge(existing, update));
  }
  const nextConfig = ConfigControl.get('config') || {};
  const hasLoginToken = Boolean(String(nextConfig.webConsoleToken || '').trim());
  if (!hadLoginToken && !hasLoginToken) {
    throw createHttpError(400, '首次初始化必须先设置控制台登录口令', 'BOOTSTRAP_TOKEN_REQUIRED');
  }
  const incomingSkills = payload?.skills;
  if (incomingSkills && typeof incomingSkills === 'object') {
    const mergedSkillConfig = getSkillConfig();
    const defaultSkillConfig = readDefaultSkillConfig();
    const currentSkillConfig = readRuntimeSkillConfig();
    const mergedDefinitions = Array.isArray(mergedSkillConfig.definitions) ? mergedSkillConfig.definitions : [];
    const customDefinitionMap = new Map(
      (Array.isArray(currentSkillConfig.definitions) ? currentSkillConfig.definitions : [])
        .filter(item => item?.name)
        .map(item => [String(item.name || '').trim(), item])
    );
    const defaultDefinitionMap = new Map(
      (Array.isArray(defaultSkillConfig.definitions) ? defaultSkillConfig.definitions : [])
        .filter(item => item?.name)
        .map(item => [String(item.name || '').trim(), item])
    );
    const requestedDefinitionMap = new Map(
      (Array.isArray(incomingSkills.definitions) ? incomingSkills.definitions : [])
        .filter(item => item?.name)
        .map(item => [String(item.name || '').trim(), item])
    );
    const nextSkillDefinitions = mergedDefinitions
      .filter(item => item?.name)
      .map((item) => {
        const name = String(item.name || '').trim();
        const requestedDefinition = requestedDefinitionMap.get(name) || null;
        const enabled = requestedDefinition ? requestedDefinition.enabled !== false : item.enabled !== false;
        const mergedTools = Array.isArray(item.tools) ? item.tools : [];
        const currentCustomDefinition = customDefinitionMap.get(name) || {};
        const defaultDefinition = defaultDefinitionMap.get(name) || {};
        const customToolMap = new Map(
          (Array.isArray(currentCustomDefinition.tools) ? currentCustomDefinition.tools : [])
            .filter(tool => tool?.name)
            .map(tool => [String(tool.name || '').trim(), tool])
        );
        const defaultToolMap = new Map(
          (Array.isArray(defaultDefinition.tools) ? defaultDefinition.tools : [])
            .filter(tool => tool?.name)
            .map(tool => [String(tool.name || '').trim(), tool])
        );
        const requestedToolMap = new Map(
          (Array.isArray(requestedDefinition?.tools) ? requestedDefinition.tools : [])
            .filter(tool => tool?.name)
            .map(tool => [String(tool.name || '').trim(), tool.enabled !== false])
        );
        const nextTools = mergedTools
          .filter(tool => tool?.name)
          .map((tool) => {
            const toolName = String(tool.name || '').trim();
            const requestedToolEnabled = requestedToolMap.has(toolName) ? requestedToolMap.get(toolName) : tool.enabled !== false;
            if (customToolMap.has(toolName)) {
              return {
                ...customToolMap.get(toolName),
                enabled: requestedToolEnabled,
              };
            }
            if (defaultToolMap.has(toolName)) {
              return {
                name: toolName,
                enabled: requestedToolEnabled,
              };
            }
            return {
              ...tool,
              enabled: requestedToolEnabled,
            };
          });
        if (customDefinitionMap.has(name)) {
          return {
            ...customDefinitionMap.get(name),
            enabled,
            tools: nextTools,
          };
        }
        if (defaultDefinitionMap.has(name)) {
          return {
            name,
            enabled,
            tools: nextTools,
          };
        }
        return {
          ...item,
          enabled,
          tools: nextTools,
        };
      });
    const nextSkills = {
      ...currentSkillConfig,
      enabled: incomingSkills.enabled === true,
      autoLoad: incomingSkills.autoLoad !== false,
      defaultTimeoutMs: normalizeSkillTimeoutMs(
        incomingSkills.defaultTimeoutMs,
        normalizeSkillTimeoutMs(mergedSkillConfig.defaultTimeoutMs, 15000)
      ),
      definitions: nextSkillDefinitions,
    };
    await ConfigControl.set('skills', nextSkills);
  }
  return {
    ...(await buildPluginSettingsPayload()),
    bootstrapCompleted: !hadLoginToken && hasLoginToken,
    runtimeLoginConfigured: hasLoginToken,
  };
}

function isAuthorized(req) {
  return parseWebConsoleSession(req).authorized === true;
}

function requireAuth(req, res) {
  if (isAuthorized(req)) return true;
  sendJson(res, { success: false, error: '未登录或登录已失效' }, 401);
  return false;
}

function normalizeWebConsoleRedirectPath(value = '/index.html') {
  const normalized = String(value || '').trim();
  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return '/index.html';
  }
  return normalized;
}

function buildAuthStatusPayload(req) {
  const config = getWebConsoleConfig();
  const authState = parseWebConsoleSession(req);
  const authorized = authState.authorized === true;
  const bootstrapMode = isBootstrapSetupRequest(req);

  return {
    success: true,
    loginConfigured: Boolean(config.authToken),
    authorized,
    bootstrapMode,
    mustChangeToken: bootstrapMode,
    readOnly: config.readOnly === true,
    canRead: authorized || bootstrapMode,
    canWrite: bootstrapMode || (authorized && config.readOnly !== true),
    csrfToken: authorized ? String(authState.session?.csrf || '') : '',
  };
}

function getClientIp(req) {
  return getRequestClientAddress(req) || 'unknown';
}

function pruneLoginAttempts(now = Date.now()) {
  for (const [key, value] of webConsoleLoginAttempts.entries()) {
    if (!value) {
      webConsoleLoginAttempts.delete(key);
      continue;
    }
    if (Number(value.blockedUntil || 0) > now) {
      continue;
    }
    if (Number(value.windowStartedAt || 0) + WEB_CONSOLE_LOGIN_WINDOW_MS < now) {
      webConsoleLoginAttempts.delete(key);
    }
  }
}

function getLoginAttemptState(ip, now = Date.now()) {
  pruneLoginAttempts(now);
  const existing = webConsoleLoginAttempts.get(ip);
  if (!existing) {
    return {
      failures: 0,
      windowStartedAt: now,
      blockedUntil: 0,
    };
  }
  if (Number(existing.windowStartedAt || 0) + WEB_CONSOLE_LOGIN_WINDOW_MS < now) {
    return {
      failures: 0,
      windowStartedAt: now,
      blockedUntil: 0,
    };
  }
  return existing;
}

function ensureLoginAttemptAllowed(req) {
  const now = Date.now();
  const ip = getClientIp(req);
  const state = getLoginAttemptState(ip, now);
  if (Number(state.blockedUntil || 0) > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
    const error = createHttpError(429, `登录尝试过于频繁，请 ${retryAfterSeconds} 秒后再试`, 'LOGIN_RATE_LIMITED');
    error.headers = { 'Retry-After': String(retryAfterSeconds) };
    throw error;
  }
  return { ip, state, now };
}

function recordLoginFailure(ip, state, now = Date.now()) {
  const next = {
    failures: Number(state?.failures || 0) + 1,
    windowStartedAt: Number(state?.windowStartedAt || now),
    blockedUntil: 0,
  };
  if (next.failures >= WEB_CONSOLE_LOGIN_MAX_FAILURES) {
    next.blockedUntil = now + WEB_CONSOLE_LOGIN_BLOCK_MS;
  }
  webConsoleLoginAttempts.set(ip, next);
  return next;
}

function clearLoginFailures(ip) {
  webConsoleLoginAttempts.delete(ip);
}

async function loginWebConsole(req) {
  const config = getWebConsoleConfig();
  const { ip, state, now } = ensureLoginAttemptAllowed(req);
  const body = await parseRequestBody(req);
  const providedToken = String(body?.token || '').trim();

  if (!config.authToken) {
    throw createHttpError(400, '控制台尚未配置登录口令', 'NO_AUTH_TOKEN');
  }
  if (!providedToken) {
    throw createHttpError(400, '请输入控制台登录口令', 'TOKEN_REQUIRED');
  }
  if (!safeTimingEqual(providedToken, config.authToken)) {
    recordLoginFailure(ip, state, now);
    throw createHttpError(401, '控制台登录口令错误', 'TOKEN_INVALID');
  }

  clearLoginFailures(ip);
  const sessionValue = createWebConsoleSession(config.authToken);

  return {
    payload: buildAuthStatusPayload({
      ...req,
      headers: {
        ...(req.headers || {}),
        cookie: `${WEB_CONSOLE_AUTH_COOKIE}=${encodeURIComponent(sessionValue)}`,
      },
    }),
    headers: {
      'Set-Cookie': buildWebConsoleAuthCookie(req, sessionValue),
    },
  };
}

function getPricingConfig(allConfigs = {}) {
  return allConfigs?.coreConfig?.usageControl
    ? {
        enabled: allConfigs.coreConfig.usageControl.pricingEnabled !== false,
        currencySymbol: allConfigs.coreConfig.usageControl.currencySymbol || '$',
        promptPricePer1M: Number(allConfigs.coreConfig.usageControl.promptPricePer1M || 0),
        completionPricePer1M: Number(allConfigs.coreConfig.usageControl.completionPricePer1M || 0),
        modelPricing: allConfigs.coreConfig.usageControl.modelPricing || '',
      }
    : {};
}

function getChatSnapshot() {
  return safeReadJson(CHAT_DB_FILE, {
    sessions: [],
    messages: [],
    topics: [],
    expressions: [],
    profiles: [],
  });
}

function getAffinitySnapshot() {
  return safeReadJson(AFFINITY_FILE, {});
}

function buildUserNameMap() {
  const chat = getChatSnapshot();
  const map = new Map();
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];

  for (const item of messages) {
    if (item?.userId && item?.userName) {
      map.set(`${item.groupId || item.sessionId || ''}:${item.userId}`, item.userName);
      map.set(`:${item.userId}`, item.userName);
    }
  }

  for (const item of profiles) {
    if (item?.userId && item?.userName) {
      map.set(`${item.sessionId || ''}:${item.userId}`, item.userName);
      map.set(`:${item.userId}`, item.userName);
    }
  }

  return map;
}

function resolveDisplayName(nameMap, groupId, sessionId, userId, fallback = '') {
  return nameMap.get(`${groupId || sessionId || ''}:${userId}`)
    || nameMap.get(`:${userId}`)
    || fallback
    || String(userId || '未知用户');
}

function buildEntryId(prefix, entry = {}, index = 0) {
  return [prefix, entry.time || 'unknown', entry.group_id || '', entry.user_id || '', entry.scene || '', entry.model || '', index]
    .join('::');
}

function buildOverviewPayload() {
  const allConfigs = ConfigControl.get() || {};
  const appConfig = allConfigs.config || {};
  const aiConfig = allConfigs.ai || {};
  const featureToggleBackup = normalizeFeatureToggleBackup(allConfigs.featureToggleBackup || {});
  const usageOverview = getUsageOverviewSync(new Date(), getPricingConfig(allConfigs));
  const imageMonitorUsage = usageOverview?.by_scene?.image_monitor_review || { requests: 0, total_tokens: 0 };
  const pokeImageSummaryUsage = usageOverview?.by_scene?.poke_image_summary || { requests: 0, total_tokens: 0 };
  const usageEntries = safeReadUsageEntries(new Date());
  const imageMonitorEntries = usageEntries.filter(item => String(item?.scene || '') === 'image_monitor_review');
  const pokeImageSummaryEntries = usageEntries.filter(item => String(item?.scene || '') === 'poke_image_summary');
  const imageMonitorSuccessCount = imageMonitorEntries.filter(item => item?.stage === 'success').length;
  const imageMonitorErrorCount = imageMonitorEntries.filter(item => item?.stage === 'error' || item?.stage === 'empty_response').length;
  const pokeImageSummarySuccessCount = pokeImageSummaryEntries.filter(item => item?.stage === 'success').length;
  const pokeImageSummaryErrorCount = pokeImageSummaryEntries.filter(item => item?.stage === 'error' || item?.stage === 'empty_response').length;
  const totalTokens = Number(usageOverview.total_tokens || 0);
  const imageMonitorTokens = Number(imageMonitorUsage.total_tokens || 0);
  const pokeImageSummaryTokens = Number(pokeImageSummaryUsage.total_tokens || 0);
  const chat = getChatSnapshot();
  const affinity = getAffinitySnapshot();
  const affinityRecords = Object.values(affinity || {});
  const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
  const runtimeInfo = getWebConsoleInfo();

  return {
    plugin: {
      name: Version.name,
      version: Version.ver,
      author: Version.author,
      description: Version.description,
    },
    runtime: {
      now: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
    },
    webConsoleRuntime: {
      configuredEnabled: appConfig.webConsole !== false,
      running: !!runtimeInfo,
      host: runtimeInfo?.host || null,
      port: runtimeInfo?.port || null,
      url: runtimeInfo?.url || null,
    },
    featureToggleBackup: {
      savedAt: featureToggleBackup.savedAt || '',
      hasBackup: Object.keys(featureToggleBackup.config || {}).length > 0,
    },
    features: {
      ai: appConfig.ai !== false,
      music: appConfig.music !== false,
      rss: appConfig.rss !== false,
      auth: appConfig.auth !== false,
      poke: appConfig.poke !== false,
      webConsole: appConfig.webConsole !== false,
      affinity: aiConfig?.affinity?.enabled !== false,
      userProfile: aiConfig?.userProfile?.enabled !== false,
      tts: allConfigs?.coreConfig?.tools?.tts?.enabled !== false,
    },
    counts: {
      sessions: Array.isArray(chat?.sessions) ? chat.sessions.length : 0,
      messages: Array.isArray(chat?.messages) ? chat.messages.length : 0,
      topics: Array.isArray(chat?.topics) ? chat.topics.length : 0,
      expressions: Array.isArray(chat?.expressions) ? chat.expressions.length : 0,
      profiles: profiles.length,
      affinityUsers: affinityRecords.length,
    },
    usage: {
      requestCount: usageOverview.request_count,
      successCount: usageOverview.success_count,
      errorCount: usageOverview.error_count,
      totalTokens: usageOverview.total_tokens,
      totalCost: usageOverview.total_cost,
      currencySymbol: getPricingConfig(allConfigs).currencySymbol || '$',
      byScene: usageOverview.by_scene || {},
      imageMonitor: {
        requestCount: Number(imageMonitorUsage.requests || 0),
        successCount: imageMonitorSuccessCount,
        errorCount: imageMonitorErrorCount,
        totalTokens: imageMonitorTokens,
        tokenRatio: totalTokens > 0 ? imageMonitorTokens / totalTokens : 0,
        averageTokens: Number(imageMonitorUsage.requests || 0) > 0 ? Math.round(imageMonitorTokens / Number(imageMonitorUsage.requests || 0)) : 0,
      },
      pokeImageSummary: {
        requestCount: Number(pokeImageSummaryUsage.requests || 0),
        successCount: pokeImageSummarySuccessCount,
        errorCount: pokeImageSummaryErrorCount,
        totalTokens: pokeImageSummaryTokens,
        tokenRatio: totalTokens > 0 ? pokeImageSummaryTokens / totalTokens : 0,
        averageTokens: Number(pokeImageSummaryUsage.requests || 0) > 0 ? Math.round(pokeImageSummaryTokens / Number(pokeImageSummaryUsage.requests || 0)) : 0,
      },
    },
  };
}

function getFileStatSafe(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  } catch {
    return null;
  }
}

function readJsonFileSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function getResolvedPathSafe(targetPath = '') {
  try {
    if (!targetPath) {
      return '';
    }
    if (typeof fs.realpathSync.native === 'function') {
      return fs.realpathSync.native(targetPath);
    }
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath || '');
  }
}

function resolvePluginsDirectory() {
  const candidates = [
    path.join(process.cwd(), 'plugins'),
    path.join(Path.yunzai, 'plugins'),
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Ignore inaccessible candidate directories and continue probing.
    }
  }

  return '';
}

function toRelativeConsolePath(targetPath = '') {
  if (!targetPath) {
    return '';
  }
  return path.relative(process.cwd(), targetPath).replace(/\\/g, '/');
}

function isSubPath(parentPath = '', targetPath = '') {
  if (!parentPath || !targetPath) {
    return false;
  }
  const relativePath = path.relative(parentPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getDependencyGroupConfig(groupKey = '') {
  return DEPENDENCY_GROUPS.find(item => item.key === groupKey) || null;
}

function isDependencyInstallSupported(groupKey = '') {
  return Boolean(getDependencyGroupConfig(groupKey)?.installSupported);
}

function resolveInstalledDependencyInfo(name, startDir = Path.root) {
  const packageNameSegments = String(name || '').split('/').filter(Boolean);
  const searchPaths = Array.from(new Set(
    [getResolvedPathSafe(startDir), getResolvedPathSafe(Path.root), getResolvedPathSafe(process.cwd())].filter(Boolean)
  ));

  const readInstalledPackage = packageJsonPath => {
    if (!packageJsonPath || !fs.existsSync(packageJsonPath)) {
      return null;
    }
    const packageInfo = readJsonFileSafe(packageJsonPath, null);
    if (packageInfo?.name !== name) {
      return null;
    }
    return {
      installed: true,
      version: String(packageInfo.version || '').trim(),
      packagePath: packageJsonPath,
    };
  };

  for (const searchPath of searchPaths) {
    let currentSearchDir = searchPath;
    while (currentSearchDir && currentSearchDir !== path.dirname(currentSearchDir)) {
      const directPackageJsonPath = path.join(currentSearchDir, 'node_modules', ...packageNameSegments, 'package.json');
      const directInstalled = readInstalledPackage(directPackageJsonPath);
      if (directInstalled) {
        return directInstalled;
      }
      currentSearchDir = path.dirname(currentSearchDir);
    }

    try {
      const packageJsonPath = require.resolve(`${name}/package.json`, { paths: [searchPath] });
      const packageInstalled = readInstalledPackage(packageJsonPath);
      if (packageInstalled) {
        return packageInstalled;
      }
    } catch {
      // Ignore package.json resolution failures and fall back to entry probing.
    }

    try {
      const entryPath = require.resolve(name, { paths: [searchPath] });
      let currentDir = path.dirname(entryPath);
      while (currentDir && currentDir !== path.dirname(currentDir)) {
        const installedPackage = readInstalledPackage(path.join(currentDir, 'package.json'));
        if (installedPackage) {
          return installedPackage;
        }
        currentDir = path.dirname(currentDir);
      }
    } catch {
      // Ignore entry resolution failures for missing or non-standard packages.
    }
  }
  return {
    installed: false,
    version: '',
    packagePath: '',
  };
}

function createDependencyItem(payload = {}) {
  const dependencyType = payload.dependencyType || payload.group || '';
  const status = payload.status || 'ok';
  return {
    ...payload,
    installable: isDependencyInstallSupported(dependencyType) && (status === 'missing' || status === 'not_installed'),
    installScope: payload.installScope || 'current',
  };
}

function buildOtherPluginDependencyReport() {
  const pluginsDir = resolvePluginsDirectory();
  const currentPluginRoot = getResolvedPathSafe(Path.root);
  const items = [];
  const pluginIds = new Set();
  const dependencyGroups = [
    { key: 'runtime', label: '运行依赖', field: 'dependencies', required: true },
    { key: 'dev', label: '开发依赖', field: 'devDependencies', required: false },
    { key: 'peer', label: 'Peer 依赖', field: 'peerDependencies', required: false },
    { key: 'optional', label: '可选依赖', field: 'optionalDependencies', required: false },
  ];

  if (!pluginsDir) {
    return {
      summary: {
        checkedAt: new Date().toISOString(),
        pluginsDir: '',
        pluginsDirExists: false,
        pluginCount: 0,
        totalCount: 0,
        installedCount: 0,
        problemCount: 0,
        runtimeCount: 0,
        runtimeMissingCount: 0,
        devCount: 0,
        devMissingCount: 0,
        peerCount: 0,
        peerMissingCount: 0,
        optionalCount: 0,
        optionalMissingCount: 0,
      },
      items,
    };
  }

  let entries = [];
  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry?.isDirectory?.()) {
      continue;
    }

    const pluginDir = path.join(pluginsDir, entry.name);
    const pluginRoot = getResolvedPathSafe(pluginDir);
    if (!pluginRoot || pluginRoot === currentPluginRoot) {
      continue;
    }

    const packageJsonPath = path.join(pluginDir, 'package.json');
    const manifest = readJsonFileSafe(packageJsonPath, null);
    if (!manifest || typeof manifest !== 'object') {
      continue;
    }

    pluginIds.add(entry.name);
    const pluginName = String(manifest.name || entry.name).trim() || entry.name;

    for (const group of dependencyGroups) {
      const groupEntries = manifest[group.field];
      if (!groupEntries || typeof groupEntries !== 'object') {
        continue;
      }

      for (const name of Object.keys(groupEntries).sort((a, b) => a.localeCompare(b))) {
        const declaredVersion = String(groupEntries[name] || '').trim();
        const installedInfo = resolveInstalledDependencyInfo(name, pluginDir);
        let status = 'ok';
        let level = 'success';

        if (!installedInfo.installed) {
          status = group.required ? 'missing' : 'not_installed';
          level = group.required ? 'error' : 'warn';
        }

        items.push(createDependencyItem({
          pluginId: entry.name,
          pluginName,
          pluginDir: toRelativeConsolePath(pluginDir),
          manifestPath: toRelativeConsolePath(packageJsonPath),
          dependencyType: group.key,
          dependencyTypeLabel: group.label,
          name,
          declaredVersion,
          installed: installedInfo.installed,
          installedVersion: installedInfo.version,
          packagePath: installedInfo.packagePath ? toRelativeConsolePath(installedInfo.packagePath) : '',
          status,
          level,
          installScope: 'plugin',
        }));
      }
    }
  }

  const runtimeItems = items.filter(item => item.dependencyType === 'runtime');
  const devItems = items.filter(item => item.dependencyType === 'dev');
  const peerItems = items.filter(item => item.dependencyType === 'peer');
  const optionalItems = items.filter(item => item.dependencyType === 'optional');
  const problemItems = items.filter(item => item.status !== 'ok');

  return {
    summary: {
      checkedAt: new Date().toISOString(),
      pluginsDir: toRelativeConsolePath(pluginsDir),
      pluginsDirExists: true,
      pluginCount: pluginIds.size,
      totalCount: items.length,
      installedCount: items.filter(item => item.installed).length,
      problemCount: problemItems.length,
      runtimeCount: runtimeItems.length,
      runtimeMissingCount: runtimeItems.filter(item => item.status === 'missing').length,
      devCount: devItems.length,
      devMissingCount: devItems.filter(item => item.status === 'not_installed').length,
      peerCount: peerItems.length,
      peerMissingCount: peerItems.filter(item => item.status === 'not_installed').length,
      optionalCount: optionalItems.length,
      optionalMissingCount: optionalItems.filter(item => item.status === 'not_installed').length,
    },
    items,
  };
}

function buildDependencyReport(options = {}) {
  const includeOtherPlugins = options.includeOtherPlugins === true;
  const manifest = readJsonFileSafe(PACKAGE_JSON_FILE, {}) || {};
  const lockfile = readJsonFileSafe(PACKAGE_LOCK_FILE, {}) || {};
  const lockPackages = lockfile?.packages || {};
  const groups = [
    { key: 'runtime', label: '运行依赖', entries: manifest.dependencies || {}, required: true },
    { key: 'dev', label: '开发依赖', entries: manifest.devDependencies || {}, required: false },
  ];
  const items = [];

  for (const group of groups) {
    for (const name of Object.keys(group.entries || {}).sort((a, b) => a.localeCompare(b))) {
      const declaredVersion = String(group.entries[name] || '').trim();
      const lockVersion = String(lockPackages[`node_modules/${name}`]?.version || '').trim();
      const installedInfo = resolveInstalledDependencyInfo(name, Path.root);
      let status = 'ok';
      let level = 'success';

      if (!installedInfo.installed) {
        status = group.required ? 'missing' : 'not_installed';
        level = group.required ? 'error' : 'warn';
      } else if (lockVersion && installedInfo.version && lockVersion !== installedInfo.version) {
        status = 'version_mismatch';
        level = 'warn';
      }

      items.push(createDependencyItem({
        name,
        group: group.key,
        groupLabel: group.label,
        dependencyType: group.key,
        declaredVersion,
        lockVersion,
        installedVersion: installedInfo.version,
        installed: installedInfo.installed,
        packagePath: installedInfo.packagePath ? toRelativeConsolePath(installedInfo.packagePath) : '',
        status,
        level,
        installScope: 'current',
      }));
    }
  }

  const runtimeItems = items.filter(item => item.group === 'runtime');
  const devItems = items.filter(item => item.group === 'dev');
  const runtimeMissing = runtimeItems.filter(item => item.status === 'missing');
  const runtimeMismatch = runtimeItems.filter(item => item.status === 'version_mismatch');
  const devMissing = devItems.filter(item => item.status === 'not_installed');
  const devMismatch = devItems.filter(item => item.status === 'version_mismatch');
  const problemItems = items.filter(item => item.status !== 'ok');

  return {
    summary: {
      status: runtimeMissing.length > 0 ? 'error' : problemItems.length > 0 ? 'warn' : 'healthy',
      checkedAt: new Date().toISOString(),
      totalCount: items.length,
      installedCount: items.filter(item => item.installed).length,
      problemCount: problemItems.length,
      runtimeCount: runtimeItems.length,
      runtimeInstalledCount: runtimeItems.filter(item => item.installed).length,
      runtimeMissingCount: runtimeMissing.length,
      runtimeMismatchCount: runtimeMismatch.length,
      devCount: devItems.length,
      devInstalledCount: devItems.filter(item => item.installed).length,
      devMissingCount: devMissing.length,
      devMismatchCount: devMismatch.length,
      manifestExists: fs.existsSync(PACKAGE_JSON_FILE),
      lockfileExists: fs.existsSync(PACKAGE_LOCK_FILE),
      projectRoot: toRelativeConsolePath(Path.root),
      manifestPath: toRelativeConsolePath(PACKAGE_JSON_FILE),
    },
    items,
    problemItems,
    otherPluginDependencies: includeOtherPlugins ? buildOtherPluginDependencyReport() : undefined,
  };
}

function trimOutputTail(text = '', maxLength = 4000) {
  const content = String(text || '').trim();
  if (!content) {
    return '';
  }
  return content.length > maxLength ? content.slice(-maxLength) : content;
}

function appendOutputTail(current = '', chunk = '', maxLength = DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT) {
  const next = `${current}${Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')}`;
  return next.length > maxLength ? next.slice(-maxLength) : next;
}

function createDependencyInstallTaskId() {
  return `dep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildDependencyInstallTaskKey(payload = {}) {
  return [
    String(payload.scope || 'current').trim().toLowerCase() || 'current',
    String(payload.pluginId || '').trim() || 'self',
    String(payload.dependencyType || payload.group || '').trim() || 'unknown',
    String(payload.name || '').trim() || '',
  ].join(':');
}

function isDependencyInstallTaskFinished(task = {}) {
  const status = String(task.status || '').trim().toLowerCase();
  return status === 'success' || status === 'error';
}

function releaseDependencyInstallTaskKey(task = {}) {
  const taskId = String(task.id || '').trim();
  const key = String(task.key || '').trim();
  if (taskId && key && dependencyInstallActiveTaskKeys.get(key) === taskId) {
    dependencyInstallActiveTaskKeys.delete(key);
  }
}

function pruneDependencyInstallTasks() {
  const now = Date.now();
  for (const [taskId, task] of dependencyInstallTasks.entries()) {
    if (!task?.finishedAt) {
      continue;
    }
    const finishedAt = Date.parse(task.finishedAt);
    if (Number.isFinite(finishedAt) && now - finishedAt > DEPENDENCY_INSTALL_TASK_TTL_MS) {
      releaseDependencyInstallTaskKey(task);
      dependencyInstallTasks.delete(taskId);
    }
  }

  if (dependencyInstallTasks.size <= DEPENDENCY_INSTALL_TASK_MAX_COUNT) {
    return;
  }

  const removable = Array.from(dependencyInstallTasks.values())
    .filter(task => task?.finishedAt)
    .sort((a, b) => Date.parse(a.finishedAt || 0) - Date.parse(b.finishedAt || 0));

  while (dependencyInstallTasks.size > DEPENDENCY_INSTALL_TASK_MAX_COUNT && removable.length > 0) {
    const task = removable.shift();
    if (task?.id) {
      releaseDependencyInstallTaskKey(task);
      dependencyInstallTasks.delete(task.id);
    }
  }
}

function serializeDependencyInstallTask(task = {}) {
  return {
    id: String(task.id || '').trim(),
    key: String(task.key || '').trim(),
    scope: String(task.scope || 'current').trim(),
    pluginId: String(task.pluginId || '').trim(),
    dependencyType: String(task.dependencyType || '').trim(),
    name: String(task.name || '').trim(),
    declaredVersion: String(task.declaredVersion || '').trim(),
    status: String(task.status || 'pending').trim(),
    createdAt: task.createdAt || '',
    startedAt: task.startedAt || '',
    finishedAt: task.finishedAt || '',
    packageManager: String(task.packageManager || '').trim(),
    command: Array.isArray(task.command) ? task.command : [],
    targetDir: String(task.targetDir || '').trim(),
    stdoutTail: trimOutputTail(task.stdoutTail || '', DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT),
    stderrTail: trimOutputTail(task.stderrTail || '', DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT),
    error: String(task.error || '').trim(),
    timedOut: Boolean(task.timedOut),
  };
}

function listDependencyInstallTasks(options = {}) {
  pruneDependencyInstallTasks();
  const activeOnly = options.activeOnly === true;
  const finishedOnly = options.finishedOnly === true;
  const parsedLimit = Number.parseInt(String(options.limit || ''), 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(50, parsedLimit))
    : 20;
  return Array.from(dependencyInstallTasks.values())
    .filter(task => {
      const finished = isDependencyInstallTaskFinished(task);
      if (activeOnly) {
        return !finished;
      }
      if (finishedOnly) {
        return finished;
      }
      return true;
    })
    .sort((a, b) => {
      const leftTime = Date.parse((finishedOnly ? a.finishedAt : a.createdAt) || a.finishedAt || a.createdAt || 0);
      const rightTime = Date.parse((finishedOnly ? b.finishedAt : b.createdAt) || b.finishedAt || b.createdAt || 0);
      return rightTime - leftTime;
    })
    .slice(0, limit)
    .map(task => serializeDependencyInstallTask(task));
}

function clearDependencyInstallHistory() {
  pruneDependencyInstallTasks();
  let removedCount = 0;
  for (const [taskId, task] of dependencyInstallTasks.entries()) {
    if (!isDependencyInstallTaskFinished(task)) {
      continue;
    }
    releaseDependencyInstallTaskKey(task);
    dependencyInstallTasks.delete(taskId);
    removedCount += 1;
  }
  return {
    removedCount,
    tasks: listDependencyInstallTasks({ finishedOnly: true }),
  };
}

async function runDependencyInstallTargetExclusive(targetKey = '', runner = async () => {}) {
  const normalizedTargetKey = String(targetKey || '').trim() || '__default__';
  const previous = dependencyInstallTargetLocks.get(normalizedTargetKey) || Promise.resolve();
  let releaseLock = () => {};
  const current = new Promise(resolve => {
    releaseLock = resolve;
  });

  dependencyInstallTargetLocks.set(normalizedTargetKey, current);
  await previous.catch(() => {});

  try {
    return await runner();
  } finally {
    releaseLock();
    if (dependencyInstallTargetLocks.get(normalizedTargetKey) === current) {
      dependencyInstallTargetLocks.delete(normalizedTargetKey);
    }
  }
}

function runProcessAsync(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let stdoutTail = '';
    let stderrTail = '';
    let timeoutHandle = null;
    let forceKillHandle = null;
    let timedOut = false;
    let settled = false;

    const finish = result => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
      resolve({
        ...result,
        stdoutTail: trimOutputTail(stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT),
        stderrTail: trimOutputTail(stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT),
      });
    };

    const fail = error => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
      error.stdoutTail = trimOutputTail(stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
      error.stderrTail = trimOutputTail(stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
      reject(error);
    };

    const normalizedCommand = String(command || '').trim();
    const useWindowsCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(normalizedCommand);
    const spawnCommand = useWindowsCmdShim ? (process.env.comspec || 'cmd.exe') : normalizedCommand;
    const spawnArgs = useWindowsCmdShim ? ['/d', '/s', '/c', normalizedCommand, ...args] : args;

    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', chunk => {
      stdoutTail = appendOutputTail(stdoutTail, chunk);
      if (typeof options.onStdout === 'function') {
        options.onStdout(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || ''));
      }
    });

    child.stderr?.on('data', chunk => {
      stderrTail = appendOutputTail(stderrTail, chunk);
      if (typeof options.onStderr === 'function') {
        options.onStderr(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || ''));
      }
    });

    child.on('error', fail);
    child.on('close', (code, signal) => {
      finish({
        status: typeof code === 'number' ? code : -1,
        signal: signal || '',
        timedOut,
      });
    });

    const timeoutMs = Number(options.timeoutMs || 0);
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore termination races when the child has already exited.
        }
        forceKillHandle = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore hard-kill failures after the process has exited on its own.
          }
        }, 5000);
      }, timeoutMs);
    }
  });
}

function resolveDependencyInstallTarget(payload = {}) {
  const scope = String(payload.scope || 'current').trim().toLowerCase();
  if (scope === 'plugin') {
    const pluginsDir = resolvePluginsDirectory();
    const pluginsRoot = getResolvedPathSafe(pluginsDir);
    const pluginId = String(payload.pluginId || '').trim();
    if (!pluginsRoot || !pluginId || pluginId !== path.basename(pluginId)) {
      throw createHttpError(400, '依赖安装目标无效', 'INVALID_INSTALL_TARGET');
    }

    const targetDir = getResolvedPathSafe(path.join(pluginsRoot, pluginId));
    if (!isSubPath(pluginsRoot, targetDir)) {
      throw createHttpError(400, '依赖安装目标越界', 'INVALID_INSTALL_TARGET');
    }

    const manifestPath = path.join(targetDir, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      throw createHttpError(404, '目标插件缺少 package.json', 'TARGET_MANIFEST_MISSING');
    }

    return {
      scope: 'plugin',
      pluginId,
      targetDir,
      manifestPath,
    };
  }

  if (scope !== 'current') {
    throw createHttpError(400, '不支持的依赖安装范围', 'UNSUPPORTED_INSTALL_SCOPE');
  }

  const targetDir = getResolvedPathSafe(Path.root);
  const manifestPath = PACKAGE_JSON_FILE;
  if (!fs.existsSync(manifestPath)) {
    throw createHttpError(500, '当前插件缺少 package.json', 'CURRENT_MANIFEST_MISSING');
  }

  return {
    scope: 'current',
    pluginId: '',
    targetDir,
    manifestPath,
  };
}

function resolvePreferredPackageManagers(targetDir, manifest = null) {
  const candidates = [];
  const addCandidate = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || candidates.includes(normalized)) {
      return;
    }
    if (normalized === 'pnpm' || normalized === 'npm' || normalized === 'yarn') {
      candidates.push(normalized);
    }
  };

  const manifestData = manifest || readJsonFileSafe(path.join(targetDir, 'package.json'), {}) || {};
  const packageManagerName = String(manifestData.packageManager || '').trim().split('@')[0];
  addCandidate(packageManagerName);

  const lockfileChecks = [
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'package-lock.json', manager: 'npm' },
    { file: 'yarn.lock', manager: 'yarn' },
  ];
  const candidateDirs = Array.from(new Set(
    [targetDir, getResolvedPathSafe(Path.root), getResolvedPathSafe(Path.yunzai)].filter(Boolean)
  ));

  for (const dirPath of candidateDirs) {
    for (const item of lockfileChecks) {
      if (fs.existsSync(path.join(dirPath, item.file))) {
        addCandidate(item.manager);
      }
    }
  }

  addCandidate('npm');
  return candidates;
}

function resolvePackageManagerBinary(manager) {
  return process.platform === 'win32' ? `${manager}.cmd` : manager;
}

async function resolvePackageManager(targetDir, manifest = null) {
  const candidates = resolvePreferredPackageManagers(targetDir, manifest);
  let lastError = null;
  let lastFailureMessage = '';
  for (const candidate of candidates) {
    const command = resolvePackageManagerBinary(candidate);
    try {
      const result = await runProcessAsync(command, ['--version'], {
        cwd: targetDir,
        env: process.env,
        timeoutMs: 15000,
      });
      if (result.status === 0) {
        return candidate;
      }
      lastFailureMessage = result.stderrTail || result.stdoutTail || `exit ${result.status}`;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError && String(lastError.code || '').trim() && String(lastError.code || '').trim() !== 'ENOENT') {
    throw new Error(`检测包管理器失败: ${String(lastError.message || lastError.code).trim()}`);
  }
  if (lastFailureMessage) {
    throw new Error(`检测包管理器失败: ${lastFailureMessage}`);
  }
  throw new Error('未检测到可用的包管理器，请先安装 npm、pnpm 或 yarn');
}

function buildInstallCommandArgs(packageManager, dependencySpec, dependencyType) {
  if (dependencyType === 'dev') {
    if (packageManager === 'pnpm') {
      return ['add', '-D', dependencySpec];
    }
    if (packageManager === 'yarn') {
      return ['add', '--dev', dependencySpec];
    }
    return ['install', dependencySpec, '--save-dev'];
  }

  if (dependencyType === 'runtime') {
    if (packageManager === 'pnpm') {
      return ['add', dependencySpec];
    }
    if (packageManager === 'yarn') {
      return ['add', dependencySpec];
    }
    return ['install', dependencySpec, '--save'];
  }

  throw createHttpError(400, '不支持的依赖类型', 'UNSUPPORTED_DEPENDENCY_TYPE');
}

function resolveDependencyInstallRequest(payload = {}) {
  const dependencyName = String(payload.name || '').trim();
  if (!dependencyName) {
    throw createHttpError(400, '缺少依赖名称', 'DEPENDENCY_NAME_REQUIRED');
  }

  const dependencyType = String(payload.dependencyType || payload.group || '').trim();
  const group = getDependencyGroupConfig(dependencyType);
  if (!group || !group.installSupported) {
    throw createHttpError(400, '不支持当前依赖类型', 'UNSUPPORTED_DEPENDENCY_TYPE');
  }

  const target = resolveDependencyInstallTarget(payload);
  const manifest = readJsonFileSafe(target.manifestPath, null);
  if (!manifest || typeof manifest !== 'object') {
    throw createHttpError(500, '读取目标 package.json 失败', 'TARGET_MANIFEST_READ_FAILED');
  }

  const declaredDependencies = manifest[group.field];
  if (!declaredDependencies || typeof declaredDependencies !== 'object' || !(dependencyName in declaredDependencies)) {
    throw createHttpError(409, '目标 package.json 中未声明该依赖', 'DEPENDENCY_DECLARATION_MISSING');
  }

  const declaredVersion = String(declaredDependencies[dependencyName] || '').trim();
  const requestedVersion = String(payload.declaredVersion || '').trim();
  if (requestedVersion && declaredVersion && requestedVersion !== declaredVersion) {
    throw createHttpError(409, '依赖声明版本已变化，请刷新后重试', 'DEPENDENCY_VERSION_CHANGED');
  }

  const installedInfo = resolveInstalledDependencyInfo(dependencyName, target.targetDir);
  if (installedInfo.installed) {
    throw createHttpError(409, '该依赖已安装，无需重复安装', 'DEPENDENCY_ALREADY_INSTALLED');
  }

  return {
    scope: target.scope,
    pluginId: target.pluginId,
    dependencyName,
    dependencyType: group.key,
    declaredVersion,
    dependencySpec: declaredVersion ? `${dependencyName}@${declaredVersion}` : dependencyName,
    target,
    manifest,
  };
}

function getDependencyInstallTask(taskId = '') {
  pruneDependencyInstallTasks();
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) {
    throw createHttpError(400, '缺少任务 ID', 'TASK_ID_REQUIRED');
  }

  const task = dependencyInstallTasks.get(normalizedTaskId);
  if (!task) {
    throw createHttpError(404, '未找到对应的安装任务', 'TASK_NOT_FOUND');
  }

  return task;
}

async function executeDependencyInstallTask(task = {}) {
  return runDependencyInstallTargetExclusive(task.targetKey || task.absoluteTargetDir, async () => {
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.finishedAt = '';
    task.error = '';
    task.timedOut = false;
    task.stdoutTail = '';
    task.stderrTail = '';

    try {
      const packageManager = await resolvePackageManager(task.absoluteTargetDir, task.manifest || null);
      const command = resolvePackageManagerBinary(packageManager);
      const args = buildInstallCommandArgs(packageManager, task.dependencySpec, task.dependencyType);
      const commandLine = [command, ...args];

      task.packageManager = packageManager;
      task.command = commandLine;
      logger.mark(`[webConsole] 开始安装依赖: ${commandLine.join(' ')} @ ${task.absoluteTargetDir}`);

      const result = await runProcessAsync(command, args, {
        cwd: task.absoluteTargetDir,
        env: process.env,
        timeoutMs: 10 * 60 * 1000,
        onStdout: chunk => {
          task.stdoutTail = appendOutputTail(task.stdoutTail, chunk);
        },
        onStderr: chunk => {
          task.stderrTail = appendOutputTail(task.stderrTail, chunk);
        },
      });

      task.stdoutTail = trimOutputTail(result.stdoutTail || task.stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
      task.stderrTail = trimOutputTail(result.stderrTail || task.stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
      task.timedOut = Boolean(result.timedOut);

      if (result.timedOut) {
        task.status = 'error';
        task.error = '依赖安装已超时';
        return task;
      }

      if (result.status !== 0) {
        task.status = 'error';
        task.error = task.stderrTail || task.stdoutTail || `依赖安装失败，退出码: ${result.status}`;
        return task;
      }

      task.status = 'success';
      task.error = '';
      logger.mark(`[webConsole] 依赖安装完成: ${commandLine.join(' ')} @ ${task.absoluteTargetDir}`);
      return task;
    } catch (error) {
      task.status = 'error';
      task.timedOut = Boolean(error?.timedOut);
      task.stdoutTail = trimOutputTail(error?.stdoutTail || task.stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
      task.stderrTail = trimOutputTail(error?.stderrTail || task.stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
      task.error = task.timedOut
        ? '依赖安装已超时'
        : String(error?.message || task.stderrTail || task.stdoutTail || '依赖安装失败').trim();
      logger.error(`[webConsole] 依赖安装失败: ${task.name} -> ${task.error}`);
      return task;
    } finally {
      task.finishedAt = new Date().toISOString();
      releaseDependencyInstallTaskKey(task);
      pruneDependencyInstallTasks();
    }
  });
}

async function createDependencyInstallTask(payload = {}) {
  pruneDependencyInstallTasks();

  const taskKey = buildDependencyInstallTaskKey(payload);
  const activeTaskId = dependencyInstallActiveTaskKeys.get(taskKey);
  if (activeTaskId) {
    const activeTask = dependencyInstallTasks.get(activeTaskId);
    if (activeTask && !isDependencyInstallTaskFinished(activeTask)) {
      return { task: activeTask, reused: true };
    }
    dependencyInstallActiveTaskKeys.delete(taskKey);
  }

  const request = resolveDependencyInstallRequest(payload);
  const task = {
    id: createDependencyInstallTaskId(),
    key: taskKey,
    targetKey: request.target.targetDir,
    scope: request.scope,
    pluginId: request.pluginId,
    dependencyType: request.dependencyType,
    name: request.dependencyName,
    declaredVersion: request.declaredVersion,
    status: 'pending',
    createdAt: new Date().toISOString(),
    startedAt: '',
    finishedAt: '',
    packageManager: '',
    command: [],
    targetDir: toRelativeConsolePath(request.target.targetDir),
    absoluteTargetDir: request.target.targetDir,
    dependencySpec: request.dependencySpec,
    manifest: request.manifest,
    stdoutTail: '',
    stderrTail: '',
    error: '',
    timedOut: false,
  };

  dependencyInstallTasks.set(task.id, task);
  dependencyInstallActiveTaskKeys.set(task.key, task.id);
  pruneDependencyInstallTasks();

  setImmediate(() => {
    executeDependencyInstallTask(task).catch(error => {
      task.status = 'error';
      task.finishedAt = new Date().toISOString();
      task.error = String(error?.message || 'Dependency install failed').trim();
      releaseDependencyInstallTaskKey(task);
      logger.error(`[webConsole] Dependency task bootstrap failed: ${task.name} -> ${task.error}`);
    });
  });

  return { task, reused: false };
}

function buildHealthPayload() {
  const allConfigs = ConfigControl.get() || {};
  const aiConfig = allConfigs.ai || {};
  const coreConfig = allConfigs.coreConfig || {};
  const dependencyReport = buildDependencyReport();
  const usageOverview = getUsageOverviewSync(new Date(), getPricingConfig(allConfigs));
  const chat = getChatSnapshot();
  const issues = [];
  const now = Date.now();

  const pushIssue = (level, title, detail) => {
    issues.push({ level, title, detail });
  };

  const baseApi = String(aiConfig.baseApi || '').trim();
  const modelType = String(aiConfig.modelType || aiConfig.workingModel || '').trim();
  const apiKey = String(aiConfig.apiKey || '').trim();
  if (!baseApi || !modelType || !apiKey || apiKey === 'your-api-key' || apiKey === 'your api key') {
    pushIssue('error', 'AI config is incomplete', 'Check baseApi, model name, and apiKey.');
  }

  const searchApiUrl = String(
    coreConfig?.tools?.search?.apiUrl || coreConfig?.tools?.search?.baseUrl || ''
  ).trim();
  if (coreConfig?.tools?.search?.enabled && !searchApiUrl) {
    pushIssue('warn', 'Search tool missing apiUrl', 'Search is enabled but apiUrl/baseUrl is empty.');
  }

  const ttsApiUrl = String(
    coreConfig?.tools?.tts?.apiUrl || coreConfig?.tools?.tts?.baseUrl || ''
  ).trim();
  if (coreConfig?.tools?.tts?.enabled && !ttsApiUrl) {
    pushIssue('warn', 'TTS missing apiUrl', 'TTS is enabled but apiUrl/baseUrl is empty.');
  }

  const requestCount = Number(usageOverview.request_count || 0);
  const errorCount = Number(usageOverview.error_count || 0);
  const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
  if (requestCount >= 5 && errorRate >= 0.3) {
    pushIssue('error', 'High AI error rate', `Recent requests: ${requestCount}, errors: ${errorCount}.`);
  } else if (errorCount > 0) {
    pushIssue('warn', 'AI has recent failures', `Recent failed requests: ${errorCount}.`);
  }

  const usageStat = getFileStatSafe(USAGE_LOG_FILE);
  if (!usageStat) {
    pushIssue('warn', 'Usage log not found', 'No usage log file was found yet.');
  } else if (now - usageStat.mtimeMs > 30 * 60 * 1000) {
    pushIssue('warn', 'Usage log is stale', 'Usage log has not been updated for more than 30 minutes.');
  }

  const affinityStat = getFileStatSafe(AFFINITY_LOG_FILE);
  if (affinityStat && now - affinityStat.mtimeMs > 24 * 60 * 60 * 1000) {
    pushIssue('warn', 'Affinity log is stale', 'Affinity log has not been updated for more than 24 hours.');
  }

  if (!dependencyReport.summary.manifestExists) {
    pushIssue('error', 'package.json is missing', 'Dependency inspection and install features are unavailable.');
  }

  if (dependencyReport.summary.runtimeMissingCount > 0) {
    const names = dependencyReport.problemItems
      .filter(item => item.group === 'runtime' && item.status === 'missing')
      .map(item => item.name)
      .slice(0, 6);
    pushIssue(
      'error',
      'Runtime dependencies are missing',
      `Missing runtime dependencies: ${dependencyReport.summary.runtimeMissingCount}${names.length ? ` (${names.join(', ')})` : ''}.`
    );
  } else if (dependencyReport.summary.runtimeMismatchCount > 0) {
    const names = dependencyReport.problemItems
      .filter(item => item.group === 'runtime' && item.status === 'version_mismatch')
      .map(item => item.name)
      .slice(0, 6);
    pushIssue(
      'warn',
      'Runtime dependency versions mismatch lockfile',
      `Mismatched runtime dependencies: ${dependencyReport.summary.runtimeMismatchCount}${names.length ? ` (${names.join(', ')})` : ''}.`
    );
  }

  if (dependencyReport.summary.devMissingCount > 0) {
    pushIssue('warn', 'Dev dependencies are missing', `Missing dev dependencies: ${dependencyReport.summary.devMissingCount}.`);
  }

  const messageCount = Array.isArray(chat?.messages) ? chat.messages.length : 0;
  const profileCount = Array.isArray(chat?.profiles) ? chat.profiles.length : 0;
  const sessionCount = Array.isArray(chat?.sessions) ? chat.sessions.length : 0;
  if (messageCount > 5000) {
    pushIssue('warn', 'Chat history is large', `Message count: ${messageCount}.`);
  }
  if (sessionCount > 300) {
    pushIssue('warn', 'Too many sessions', `Session count: ${sessionCount}.`);
  }
  if (messageCount > 0 && profileCount === 0) {
    pushIssue('warn', 'User profiles are missing', 'Messages exist but no profile data was found.');
  }

  const webConsoleConfig = getWebConsoleConfig();
  const isPublicHost = !['127.0.0.1', 'localhost', '::1'].includes(String(webConsoleConfig.host || '').toLowerCase());
  if (isPublicHost && !webConsoleConfig.authToken) {
    pushIssue('error', 'Public console has no login token', `Web console host ${webConsoleConfig.host} is publicly reachable without a configured login token.`);
  }
  if (isPublicHost && webConsoleConfig.readOnly !== true) {
    pushIssue('warn', 'Public console is writable', `Web console host ${webConsoleConfig.host} allows write operations. Consider enabling read-only mode for internet exposure.`);
  }

  const summary = {
    status: issues.some(item => item.level === 'error') ? 'error' : issues.length > 0 ? 'warn' : 'healthy',
    issueCount: issues.length,
    errorCount: issues.filter(item => item.level === 'error').length,
    warnCount: issues.filter(item => item.level === 'warn').length,
    checkedAt: new Date().toISOString(),
  };

  return {
    summary,
    issues,
    dependencyReport,
  };
}

function buildConfigBackupPayload() {
  const allConfigs = ConfigControl.get() || {};
  return {
    exportedAt: new Date().toISOString(),
    source: 'crystelf-web-console-config-backup',
    configRoot: Path.config,
    files: allConfigs,
  };
}

function flattenConfigEntries(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenConfigEntries(value, nextKey));
    } else {
      result[nextKey] = value;
    }
  }
  return result;
}

function buildConfigRestorePreviewPayload(payload = {}) {
  const files = payload?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('配置备份数据格式不正确，缺少有效的 files 字段');
  }
  const currentFiles = ConfigControl.get() || {};
  const currentFlat = flattenConfigEntries(currentFiles);
  const incomingFlat = flattenConfigEntries(files);
  const allKeys = Array.from(new Set([...Object.keys(currentFlat), ...Object.keys(incomingFlat)])).sort();
  const changes = allKeys
    .filter(key => JSON.stringify(currentFlat[key]) !== JSON.stringify(incomingFlat[key]))
    .map(key => ({
      key,
      file: key.split('.')[0] || 'unknown',
      type: key in currentFlat ? (key in incomingFlat ? 'modified' : 'deleted') : 'added',
      current: currentFlat[key],
      next: incomingFlat[key],
    }));
  const groups = Object.entries(changes.reduce((acc, item) => {
    acc[item.file] ||= [];
    acc[item.file].push(item);
    return acc;
  }, {})).map(([file, items]) => ({ file, count: items.length, items: items.slice(0, 40) }));
  return {
    success: true,
    changedCount: changes.length,
    changedKeys: changes.slice(0, 120),
    restoredKeys: Object.keys(files),
    groups,
  };
}

async function restoreConfigBackupPayload(payload = {}) {
  const files = payload?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('配置备份数据格式不正确，缺少有效的 files 字段');
  }
  const selectedFiles = Array.isArray(payload?.selectedFiles)
    ? payload.selectedFiles.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const filesToRestore = selectedFiles.length > 0
    ? Object.fromEntries(Object.entries(files).filter(([key]) => selectedFiles.includes(key)))
    : files;
  if (Object.keys(filesToRestore).length === 0) {
    throw new Error('没有可恢复的配置文件，请检查 selectedFiles 或备份内容');
  }
  await ConfigControl.setMultiple(filesToRestore);
  return {
    success: true,
    restoredKeys: Object.keys(filesToRestore),
    count: Object.keys(filesToRestore).length,
  };
}

function buildUsageTrendPayload() {
  const content = readTailText(USAGE_LOG_FILE, Math.max(120000, getWebConsoleConfig().logTailLength));
  const items = parseJsonObjects(content)
    .map(item => {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const buckets = new Map();
  for (const item of items) {
    const time = new Date(item.time || Date.now());
    if (Number.isNaN(time.getTime())) continue;
    const key = `${time.getHours().toString().padStart(2, '0')}:00`;
    if (!buckets.has(key)) {
      buckets.set(key, { hour: key, requests: 0, tokens: 0, errors: 0 });
    }
    const bucket = buckets.get(key);
    bucket.requests += 1;
    bucket.tokens += Number(item.total_tokens || 0);
    if (item.error) bucket.errors += 1;
  }

  return {
    items: Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour)).slice(-24),
  };
}

function buildImageMonitorUsageTrendPayload() {
  const content = readTailText(USAGE_LOG_FILE, Math.max(120000, getWebConsoleConfig().logTailLength));
  const items = parseJsonObjects(content)
    .map(item => {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => String(item.scene || '') === 'image_monitor_review');

  const buckets = new Map();
  for (const item of items) {
    const time = new Date(item.time || Date.now());
    if (Number.isNaN(time.getTime())) continue;
    const key = `${time.getHours().toString().padStart(2, '0')}:00`;
    if (!buckets.has(key)) {
      buckets.set(key, { hour: key, requests: 0, tokens: 0, errors: 0 });
    }
    const bucket = buckets.get(key);
    bucket.requests += 1;
    bucket.tokens += Number(item.total_tokens || 0);
    if (item.stage === 'error' || item.stage === 'empty_response' || item.error) {
      bucket.errors += 1;
    }
  }

  return {
    items: Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour)).slice(-24),
  };
}

function buildPokeImageSummaryTrendPayload() {
  const content = readTailText(USAGE_LOG_FILE, Math.max(120000, getWebConsoleConfig().logTailLength));
  const items = parseJsonObjects(content)
    .map(item => {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => String(item.scene || '') === 'poke_image_summary');

  const buckets = new Map();
  for (const item of items) {
    const time = new Date(item.time || Date.now());
    if (Number.isNaN(time.getTime())) continue;
    const key = `${time.getHours().toString().padStart(2, '0')}:00`;
    if (!buckets.has(key)) {
      buckets.set(key, { hour: key, requests: 0, tokens: 0, errors: 0 });
    }
    const bucket = buckets.get(key);
    bucket.requests += 1;
    bucket.tokens += Number(item.total_tokens || 0);
    if (item.stage === 'error' || item.stage === 'empty_response' || item.error) {
      bucket.errors += 1;
    }
  }

  return {
    items: Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour)).slice(-24),
  };
}

function paginateItems(items, page = 1, pageSize = 20) {
  const maxPageSize = getWebConsoleConfig().maxPageSize;
  const safePage = Math.max(1, Number(page || 1));
  const safePageSize = Math.min(maxPageSize, Math.max(1, Number(pageSize || 20)));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const start = (safePage - 1) * safePageSize;
  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    items: items.slice(start, start + safePageSize),
  };
}

function buildAffinityListPayload(filters = {}) {
  const allConfigs = ConfigControl.get() || {};
  const affinityConfig = allConfigs?.ai?.affinity || {};
  const data = getAffinitySnapshot();
  const nameMap = buildUserNameMap();
  const query = String(filters.query || '').trim().toLowerCase();
  const groupId = String(filters.groupId || '').trim();
  const page = Number(filters.page || 1);
  const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);

  const list = Object.values(data || {})
    .map(item => ({
      group_id: item.group_id,
      user_id: item.user_id,
      score: Number(item.score || 0),
      interaction_count: Number(item.interaction_count || 0),
      positive_count: Number(item.positive_count || 0),
      negative_count: Number(item.negative_count || 0),
      display_name: resolveDisplayName(nameMap, item.group_id, '', item.user_id),
      last_reason: item.last_reason || '',
      updated_at: item.updated_at || '',
      decay_date: item.decay_date || '',
      level: Number(item.score || 0) <= Number(affinityConfig.coldThreshold ?? -5)
        ? 'cold'
        : Number(item.score || 0) < Number(affinityConfig.neutralThreshold ?? 5)
          ? 'neutral'
          : Number(item.score || 0) < Number(affinityConfig.warmThreshold ?? 20)
            ? 'warm'
            : 'close',
    }))
    .filter(item => !groupId || String(item.group_id) === groupId)
    .filter(item => {
      if (!query) return true;
      return [item.group_id, item.user_id, item.display_name, item.last_reason, item.level]
        .some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => b.score - a.score);

  return paginateItems(list, page, pageSize);
}

function buildProfilesPayload(filters = {}) {
  const chat = getChatSnapshot();
  const nameMap = buildUserNameMap();
  const query = String(filters.query || '').trim().toLowerCase();
  const sessionId = String(filters.sessionId || '').trim();
  const page = Number(filters.page || 1);
  const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
  const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];

  const items = profiles
      .filter(item => !sessionId || String(item.sessionId) === sessionId)
      .filter(item => {
        if (!query) return true;
        return [item.sessionId, item.userId, item.userName, item.summary, ...(item.traits || []), ...(item.notableTopics || [])]
          .some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 100)
      .map(item => ({
        sessionId: item.sessionId,
        userId: item.userId,
        userName: resolveDisplayName(nameMap, '', item.sessionId, item.userId, item.userName || ''),
        summary: item.summary || '',
        traits: item.traits || [],
        speakingStyle: item.speakingStyle || [],
        interactionPreferences: item.interactionPreferences || [],
        notableTopics: item.notableTopics || [],
        confidence: item.confidence || 'unknown',
        sourceMessageCount: Number(item.sourceMessageCount || 0),
        updatedAt: item.updatedAt || 0,
      }));

  return paginateItems(items, page, pageSize);
}

function detectSessionType(sessionId = '') {
  if (String(sessionId).startsWith('group:')) return 'group';
  if (String(sessionId).startsWith('private:')) return 'private';
  return 'unknown';
}

function buildSessionUsageEntries(sessionId, userId = '') {
  const content = readTailText(USAGE_LOG_FILE, Math.max(180000, getWebConsoleConfig().logTailLength * 6));
  return parseJsonObjects(content)
    .map((item, index) => {
      try {
        const parsed = JSON.parse(item);
        return attachUsageDisplayFields({
          ...parsed,
          id: buildEntryId('usage', parsed, index),
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => String(item.session_id || '') === String(sessionId))
    .filter(item => !userId || String(item.user_id || '') === String(userId))
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
    .slice(0, 30);
}

function buildSessionListPayload(filters = {}) {
  const chat = getChatSnapshot();
  const query = String(filters.query || '').trim().toLowerCase();
  const sessionIdFilter = String(filters.sessionId || '').trim();
  const userIdFilter = String(filters.userId || '').trim();
  const page = Number(filters.page || 1);
  const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
  const sessions = Array.isArray(chat?.sessions) ? chat.sessions : [];
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
  const sessionMap = new Map();

  for (const session of sessions) {
    sessionMap.set(String(session.id), {
      sessionId: String(session.id),
      type: session.type || detectSessionType(session.id),
      targetId: session.targetId || '',
      createdAt: Number(session.createdAt || 0),
      updatedAt: Number(session.updatedAt || 0),
      compressedContext: session.compressedContext ?? null,
      messageCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
      participants: new Map(),
      lastMessagePreview: '',
      lastMessageRole: '',
      lastMessageTime: Number(session.updatedAt || 0),
      profileCount: 0,
    });
  }

  for (const message of messages) {
    const sessionId = String(message.sessionId || '');
    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, {
        sessionId,
        type: detectSessionType(sessionId),
        targetId: sessionId.includes(':') ? sessionId.split(':').slice(1).join(':') : sessionId,
        createdAt: Number(message.timestamp || 0),
        updatedAt: Number(message.timestamp || 0),
        compressedContext: null,
        messageCount: 0,
        userMessageCount: 0,
        assistantMessageCount: 0,
        participants: new Map(),
        lastMessagePreview: '',
        lastMessageRole: '',
        lastMessageTime: 0,
        profileCount: 0,
      });
    }
    const record = sessionMap.get(sessionId);
    const timestamp = Number(message.timestamp || 0);
    record.messageCount += 1;
    if (message.role === 'assistant') record.assistantMessageCount += 1;
    if (message.role === 'user') record.userMessageCount += 1;
    if (message.userId) {
      const key = String(message.userId);
      const existing = record.participants.get(key) || { userId: key, userName: message.userName || key, count: 0 };
      existing.userName = existing.userName || message.userName || key;
      existing.count += 1;
      record.participants.set(key, existing);
    }
    if (timestamp >= Number(record.lastMessageTime || 0)) {
      record.lastMessageTime = timestamp;
      record.lastMessagePreview = String(message.content || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      record.lastMessageRole = message.role || '';
      record.updatedAt = Math.max(Number(record.updatedAt || 0), timestamp);
    }
    if (!record.createdAt || timestamp < record.createdAt) {
      record.createdAt = timestamp;
    }
  }

  for (const profile of profiles) {
    const sessionId = String(profile.sessionId || '');
    if (!sessionMap.has(sessionId)) continue;
    const record = sessionMap.get(sessionId);
    record.profileCount += 1;
    if (profile.userId && !record.participants.has(String(profile.userId))) {
      record.participants.set(String(profile.userId), {
        userId: String(profile.userId),
        userName: profile.userName || String(profile.userId),
        count: 0,
      });
    }
  }

  const items = Array.from(sessionMap.values())
    .map(item => {
      const runtimeDebug = getSessionDebugSnapshot(item.sessionId) || {};
      const hasFallback = !!runtimeDebug.failureReason || (runtimeDebug.statusHints || []).some(h => String(h).toLowerCase().includes('fallback'));
      return {
        sessionId: item.sessionId,
        type: item.type,
        targetId: item.targetId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        messageCount: item.messageCount,
        userMessageCount: item.userMessageCount,
        assistantMessageCount: item.assistantMessageCount,
        participantCount: item.participants.size,
        participants: Array.from(item.participants.values()).slice(0, 5),
        lastMessagePreview: item.lastMessagePreview || '暂无最近消息',
        lastMessageRole: item.lastMessageRole || 'unknown',
        lastMessageTime: item.lastMessageTime || item.updatedAt || item.createdAt || 0,
        profileCount: item.profileCount,
        hasFallback,
        fallbackReason: runtimeDebug.failureReason || '',
      };
    })
    .filter(item => !sessionIdFilter || item.sessionId.includes(sessionIdFilter))
    .filter(item => !userIdFilter || item.participants.some(participant => String(participant.userId) === userIdFilter))
    .filter(item => {
      if (!query) return true;
      return [
        item.sessionId,
        item.targetId,
        item.lastMessagePreview,
        ...item.participants.map(participant => `${participant.userName} ${participant.userId}`),
      ].some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => Number(b.lastMessageTime || 0) - Number(a.lastMessageTime || 0));

  return paginateItems(items, page, pageSize);
}

function buildSessionDebugPayload(sessionId, focusUserId = '') {
  const chat = getChatSnapshot();
  const sessions = Array.isArray(chat?.sessions) ? chat.sessions : [];
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
  const topics = Array.isArray(chat?.topics) ? chat.topics : [];
  const expressions = Array.isArray(chat?.expressions) ? chat.expressions : [];
  const sessionMessages = messages
    .filter(item => String(item.sessionId) === String(sessionId))
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  if (!sessionMessages.length && !sessions.find(item => String(item.id) === String(sessionId))) {
    return null;
  }

  const sessionRecord = sessions.find(item => String(item.id) === String(sessionId)) || {
    id: sessionId,
    type: detectSessionType(sessionId),
    targetId: String(sessionId).includes(':') ? String(sessionId).split(':').slice(1).join(':') : sessionId,
    createdAt: sessionMessages[0]?.timestamp || 0,
    updatedAt: sessionMessages.at(-1)?.timestamp || 0,
    compressedContext: null,
  };

  const participantMap = new Map();
  for (const message of sessionMessages) {
    if (!message.userId) continue;
    const key = String(message.userId);
    const existing = participantMap.get(key) || {
      userId: key,
      userName: message.userName || key,
      count: 0,
      lastTime: 0,
    };
    existing.count += 1;
    existing.userName = existing.userName || message.userName || key;
    existing.lastTime = Math.max(Number(existing.lastTime || 0), Number(message.timestamp || 0));
    participantMap.set(key, existing);
  }

  const linkedProfiles = profiles
    .filter(item => String(item.sessionId) === String(sessionId))
    .sort((a, b) => {
      const aFocus = String(a.userId) === String(focusUserId) ? 1 : 0;
      const bFocus = String(b.userId) === String(focusUserId) ? 1 : 0;
      if (aFocus !== bFocus) return bFocus - aFocus;
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    });

  const usageRequests = buildSessionUsageEntries(sessionId, focusUserId);
  const latestUsage = usageRequests[0] || null;
  const usageSummary = usageRequests.reduce((acc, item) => {
    acc.requestCount += 1;
    acc.errorCount += item.error ? 1 : 0;
    acc.totalTokens += Number(item.total_tokens || 0);
    const scene = String(item.scene || 'unknown');
    acc.byScene[scene] = (acc.byScene[scene] || 0) + 1;
    return acc;
  }, { requestCount: 0, errorCount: 0, totalTokens: 0, byScene: {} });

  const sessionTopics = topics
    .filter(item => String(item.sessionId) === String(sessionId))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, 12);

  const sessionExpressions = expressions
    .filter(item => String(item.sessionId) === String(sessionId))
    .filter(item => !focusUserId || String(item.userId || '') === String(focusUserId))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 20);

  const recentMessages = sessionMessages.slice(-120).map(item => ({
    id: item.id,
    role: item.role,
    content: item.content,
    userId: item.userId,
    userName: item.userName,
    userRole: item.userRole,
    userTitle: item.userTitle,
    groupId: item.groupId,
    groupName: item.groupName,
    timestamp: item.timestamp,
    messageId: item.messageId,
  }));

  const affinityHistory = String(sessionId).startsWith('group:') && focusUserId
    ? buildAffinityHistoryPayload(String(sessionId).slice(6), focusUserId)
    : null;

  const alerts = [];
  if (sessionMessages.length === 0) {
    alerts.push({ tone: 'error', message: 'Current session has no messages.' });
  }
  if (usageSummary.requestCount === 0) {
    alerts.push({ tone: 'neutral', message: 'Current session has no AI request logs yet.' });
  }
  if (usageSummary.errorCount > 0) {
    alerts.push({ tone: 'error', message: `Current session has ${usageSummary.errorCount} AI request errors.` });
  }
  if (linkedProfiles.length === 0) {
    alerts.push({ tone: 'neutral', message: 'Current session has no linked user profile.' });
  }
  if (focusUserId && !linkedProfiles.some(item => String(item.userId) === String(focusUserId))) {
    alerts.push({ tone: 'error', message: 'Focused user has no profile in this session.' });
  }
  if (sessionMessages.length > 0 && !sessionMessages.some(item => item.role === 'assistant')) {
    alerts.push({ tone: 'error', message: 'Current session has no assistant reply.' });
  }

  const latestAssistantMessage = [...sessionMessages].reverse().find(item => item.role === 'assistant') || null;
  const latestUserMessage = [...sessionMessages].reverse().find(item => item.role === 'user') || null;
  const runtimeDebug = getSessionDebugSnapshot(sessionId) || {};
  const pokeDebug = getPokeDebugSnapshot(sessionRecord.targetId || sessionRecord.id?.replace?.(/^group:/, '') || '') || {};
  const debugDigest = {
    requestTime: latestUsage?.time || '',
    scene: latestUsage?.scene || '',
    model: latestUsage?.model || '',
    success: !latestUsage?.error,
    error: latestUsage?.error || '',
    totalTokens: Number(latestUsage?.total_tokens || 0),
    promptPreview: latestUsage?.prompt_preview || '',
    responsePreview: latestUsage?.response_preview || '',
    latestUserMessage: latestUserMessage?.content || '',
    latestAssistantMessage: latestAssistantMessage?.content || '',
    runtimeKnowledgeMatches: Array.isArray(runtimeDebug.knowledgeMatches)
      ? runtimeDebug.knowledgeMatches.map(item => ({
          title: item.title,
          score: item.score || 0,
          tags: Array.isArray(item.tags) ? item.tags : [],
          contentPreview: String(item.content || '').slice(0, 160),
          content: String(item.content || ''),
        }))
      : [],
    runtimeToolCalls: Array.isArray(runtimeDebug.toolCalls)
      ? runtimeDebug.toolCalls.map(item => ({
          name: item.name,
          success: item?.result?.success !== false,
          error: item?.result?.error || '',
          argsPreview: JSON.stringify(item?.args || {}).slice(0, 160),
          resultPreview: JSON.stringify(item?.result || {}).slice(0, 200),
          argsRaw: JSON.stringify(item?.args || {}, null, 2),
          resultRaw: JSON.stringify(item?.result || {}, null, 2),
        }))
      : [],
    runtimeStatusHints: Array.isArray(runtimeDebug.statusHints) ? runtimeDebug.statusHints : [],
    runtimeFailureReason: runtimeDebug.failureReason || '',
    runtimeUpdatedAt: runtimeDebug.updatedAt || 0,
    runtimePromptSummary: runtimeDebug.promptSummary || null,
    runtimeDecisionExplanation: runtimeDebug.decisionExplanation || null,
    pokeDebug,
    messageCount: sessionMessages.length,
    requestCount: usageSummary.requestCount,
    errorCount: usageSummary.errorCount,
  };

  return {
    session: {
      sessionId: String(sessionRecord.id),
      type: sessionRecord.type || detectSessionType(sessionRecord.id),
      targetId: sessionRecord.targetId || '',
      createdAt: Number(sessionRecord.createdAt || 0),
      updatedAt: Number(sessionRecord.updatedAt || 0),
      compressedContext: sessionRecord.compressedContext ?? null,
      messageCount: sessionMessages.length,
      userMessageCount: sessionMessages.filter(item => item.role === 'user').length,
      assistantMessageCount: sessionMessages.filter(item => item.role === 'assistant').length,
      participantCount: participantMap.size,
      lastMessageTime: sessionMessages.at(-1)?.timestamp || sessionRecord.updatedAt || 0,
      firstMessageTime: sessionMessages[0]?.timestamp || sessionRecord.createdAt || 0,
      focusUserId: focusUserId || '',
    },
    participants: Array.from(participantMap.values()).sort((a, b) => Number(b.lastTime || 0) - Number(a.lastTime || 0)),
    profiles: linkedProfiles,
    topics: sessionTopics,
    expressions: sessionExpressions,
    usageRequests,
    usageSummary,
    debugDigest,
    alerts,
    affinityHistory,
    messages: recentMessages,
    raw: {
      session: sessionRecord,
      participants: Array.from(participantMap.values()),
      profiles: linkedProfiles,
      topics: sessionTopics,
      expressions: sessionExpressions,
      usageRequests,
      debugDigest,
      affinityHistory,
      messages: recentMessages,
    },
  };
}

function buildConfigPayload() {
  const allConfigs = ConfigControl.get() || {};
  const webConsole = getWebConsoleConfig();
  const maskSensitive = value => {
    if (typeof value !== 'string') return value;
    if (!value) return value;
    return '******';
  };

  const rawCoreConfig = { ...(allConfigs.coreConfig || {}) };
  delete rawCoreConfig.token;
  const coreConfig = {
    ...rawCoreConfig,
    tools: {
      ...(rawCoreConfig.tools || {}),
      search: {
        ...(rawCoreConfig.tools?.search || {}),
        apiKey: maskSecretValue(rawCoreConfig.tools?.search?.apiKey),
      },
    },
  };

  const aiConfig = {
    ...(allConfigs.ai || {}),
    apiKey: maskSecretValue(allConfigs.ai?.apiKey),
    imageConfig: {
      ...(allConfigs.ai?.imageConfig || {}),
      apiKey: maskSecretValue(allConfigs.ai?.imageConfig?.apiKey),
    },
  };

  const maskedWebConsole = {
    ...webConsole,
    authToken: maskSensitive(webConsole.authToken),
  };

  const imageMonitorConfig = {
    ...(allConfigs.imageMonitor || {}),
    apiKey: maskSecretValue(allConfigs.imageMonitor?.apiKey),
  };

  const mainConfig = {
    ...(allConfigs.config || {}),
    webConsoleToken: maskSecretValue(allConfigs.config?.webConsoleToken),
  };

  return {
    config: mainConfig,
    ai: aiConfig,
    poke: allConfigs.poke || {},
    coreConfig,
    imageMonitor: imageMonitorConfig,
    webConsole: maskedWebConsole,
  };
}

function buildLogsPayload() {
  const webConsole = getWebConsoleConfig();
  if (!webConsole.exposeLogs) {
    return {
      usage: '日志暴露已关闭',
      affinity: '日志暴露已关闭',
    };
  }
  return {
    usage: readTailText(USAGE_LOG_FILE, webConsole.logTailLength),
    affinity: readTailText(AFFINITY_LOG_FILE, webConsole.logTailLength),
  };
}

function sanitizeUsagePreviewText(value = '') {
  return String(value || '')
    .replace(/\[\[\[at:\d+\]\]\]/g, '')
    .replace(/\(\(\(at:\d+\)\)\)/g, '')
    .replace(/\(\(\(\d+\)\)\)/g, '')
    .replace(/\[\[\[poke:\d+\]\]\]/g, '')
    .replace(/\(\(\(poke:\d+\)\)\)/g, '')
    .replace(/\[\[\[reply:[^\]]+\]\]\]/g, '')
    .replace(/\(\(\(reply:[^)]+\)\)\)/g, '')
    .replace(/\[\[\[memory:[^\]]+\]\]\]/g, '')
    .replace(/\[meme:[^\]]+\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isImageMonitorReviewUsage(entry = {}) {
  return String(entry.scene || '').trim().toLowerCase() === 'image_monitor_review';
}

function attachUsageDisplayFields(entry = {}) {
  const hidePromptPreview = isImageMonitorReviewUsage(entry);
  return {
    ...entry,
    prompt_preview: hidePromptPreview ? '' : entry.prompt_preview,
    display_prompt_preview: hidePromptPreview ? '' : sanitizeUsagePreviewText(entry.prompt_preview || ''),
    display_response_preview: sanitizeUsagePreviewText(entry.response_preview || ''),
  };
}

function buildUsageLogEntries(filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  const scene = String(filters.scene || '').trim().toLowerCase();
  const page = Number(filters.page || 1);
  const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
  const content = readTailText(USAGE_LOG_FILE, Math.max(50000, getWebConsoleConfig().logTailLength));
  const items = parseJsonObjects(content)
    .map((item, index) => {
      try {
        const parsed = JSON.parse(item);
        return attachUsageDisplayFields({
          ...parsed,
          id: buildEntryId('usage', parsed, index),
        });
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => !scene || String(item.scene || '').toLowerCase().includes(scene))
    .filter(item => {
      if (!query) return true;
      return [item.scene, item.model, item.group_id, item.user_id, item.prompt_preview, item.response_preview, item.error]
        .some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));

  return paginateItems(items, page, pageSize);
}

function buildAffinityLogEntries(filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  const groupId = String(filters.groupId || '').trim();
  const page = Number(filters.page || 1);
  const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
  const content = readTailText(AFFINITY_LOG_FILE, Math.max(50000, getWebConsoleConfig().logTailLength));
  const items = parseJsonObjects(content)
    .map((item, index) => {
      try {
        const parsed = JSON.parse(item);
        return {
          ...parsed,
          id: buildEntryId('affinity', parsed, index),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => !groupId || String(item.group_id || '') === groupId)
    .filter(item => {
      if (!query) return true;
      return [item.group_id, item.user_id, item.reason, item.guard, item.text_preview, item.level]
        .some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));

  return paginateItems(items, page, pageSize);
}

function findUsageLogEntry(entryId) {
  const items = buildUsageLogEntries({ page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }).items;
  return items.find(item => item.id === entryId) || null;
}

function findAffinityLogEntry(entryId) {
  const items = buildAffinityLogEntries({ page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }).items;
  return items.find(item => item.id === entryId) || null;
}

function exportDataAsText(type, filters = {}) {
  if (type === 'profiles') {
    return JSON.stringify(buildProfilesPayload({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
  }
  if (type === 'affinity') {
    return JSON.stringify(buildAffinityListPayload({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
  }
  if (type === 'usage-logs') {
    return JSON.stringify(buildUsageLogEntries({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
  }
  if (type === 'affinity-logs') {
    return JSON.stringify(buildAffinityLogEntries({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
  }
  if (type === 'image-monitor-review-logs') {
    return JSON.stringify(buildImageMonitorLogPayload({ ...filters, type: 'review', page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
  }
  if (type === 'image-monitor-meme-logs') {
    return JSON.stringify(buildImageMonitorLogPayload({ ...filters, type: 'meme', page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
  }
  if (type === 'overview-trend') {
    return JSON.stringify(buildUsageTrendPayload(), null, 2);
  }
  return JSON.stringify({ error: 'unsupported export type' }, null, 2);
}

const PLACEHOLDER_SECRET_VALUES = new Set(['your-api-key', 'your api key']);

function isPlaceholderSecret(value = '') {
  return PLACEHOLDER_SECRET_VALUES.has(String(value || '').trim().toLowerCase());
}

function hasConfiguredSecret(value = '') {
  const trimmed = String(value || '').trim();
  return Boolean(trimmed) && !isPlaceholderSecret(trimmed);
}

function maskSecretValue(value = '') {
  return hasConfiguredSecret(value) ? '******' : '';
}

function resolveSecretSaveValue(nextValue, currentValue, preserveExisting = false) {
  const trimmedNext = String(nextValue || '').trim();
  if (trimmedNext) {
    return trimmedNext;
  }
  return preserveExisting ? String(currentValue || '').trim() : '';
}

function buildApiSettingsPayload() {
  const allConfigs = ConfigControl.get() || {};
  const aiConfig = allConfigs.ai || {};
  const coreConfig = allConfigs.coreConfig || {};
  const imageMonitorConfig = allConfigs.imageMonitor || {};
  const identity = buildBotIdentitySnapshot(allConfigs);
  
  return {
    ai: {
      baseApi: aiConfig.baseApi || '',
      apiKey: '',
      apiKeyConfigured: hasConfiguredSecret(aiConfig.apiKey),
      modelType: aiConfig.modelType || '',
      workingModel: aiConfig.workingModel || '',
      multimodalModel: aiConfig.multimodalModel || '',
      timeout: normalizePositiveNumber(aiConfig.timeout, 60000),
      imageConfig: {
        enabled: aiConfig.imageConfig?.enabled !== false,
        imageMode: aiConfig.imageConfig?.imageMode || 'openai',
        model: aiConfig.imageConfig?.model || '',
        baseApi: aiConfig.imageConfig?.baseApi || '',
        jimengApiUrl: aiConfig.imageConfig?.jimengApiUrl || '',
        apiKey: '',
        apiKeyConfigured: hasConfiguredSecret(aiConfig.imageConfig?.apiKey),
        size: aiConfig.imageConfig?.size || '1024x1024',
        quality: aiConfig.imageConfig?.quality || 'high',
        responseFormat: aiConfig.imageConfig?.responseFormat || 'b64_json',
        background: aiConfig.imageConfig?.background || '',
        timeout: normalizePositiveNumber(aiConfig.imageConfig?.timeout, 60000),
        fallbackReply: aiConfig.imageConfig?.fallbackReply || '',
        fallbackTimeoutReply: aiConfig.imageConfig?.fallbackTimeoutReply || '',
      },
      memeConfig: {
        apiBase: aiConfig.memeConfig?.apiBase || '',
        character: aiConfig.memeConfig?.character || aiConfig.character || '',
        defaultCharacter: identity.recommendedCharacter || '灵晶',
        defaultCharacterSource: identity.recommendedCharacterSource,
        personaCardName: identity.personaCardName || '',
        botNickname: identity.botNickname || '灵晶',
        legacyConfiguredCharacter: identity.legacyConfiguredCharacter === true,
        availableEmotions: Array.isArray(aiConfig.memeConfig?.availableEmotions) ? aiConfig.memeConfig.availableEmotions : [],
        localEnabled: aiConfig.memeConfig?.localEnabled !== false,
        preferLocal: aiConfig.memeConfig?.preferLocal === true,
        localBaseDir: aiConfig.memeConfig?.localBaseDir || 'data/chat/meme',
      },
    },
    imageMonitor: {
      enabled: imageMonitorConfig.enabled === true,
      apiBase: imageMonitorConfig.apiBase || '',
      apiKey: '',
      apiKeyConfigured: hasConfiguredSecret(imageMonitorConfig.apiKey),
      model: imageMonitorConfig.model || '',
      analysisTimeoutMs: normalizePositiveNumber(imageMonitorConfig.analysisTimeoutMs, 30000),
      fallbackReply: imageMonitorConfig.fallbackReply || '',
      fallbackTimeoutReply: imageMonitorConfig.fallbackTimeoutReply || '',
    },
    coreConfig: {
      tools: {
        search: {
          enabled: coreConfig.tools?.search?.enabled === true,
          apiKey: '',
          apiKeyConfigured: hasConfiguredSecret(coreConfig.tools?.search?.apiKey),
          markdownApiUrl: coreConfig.tools?.search?.markdownApiUrl || '',
          markdownStatusUrl: coreConfig.tools?.search?.markdownStatusUrl || '',
          timeoutMs: normalizePositiveNumber(coreConfig.tools?.search?.timeoutMs, 60000),
        },
      },
    },
  };
}

async function saveApiSettings(payload = {}) {
  const allConfigs = ConfigControl.get() || {};
  
  if (payload.ai) {
    const currentAi = allConfigs.ai || {};
    const nextAi = {
      ...currentAi,
      baseApi: payload.ai.baseApi,
      apiKey: resolveSecretSaveValue(payload.ai.apiKey, currentAi.apiKey, payload.ai.preserveApiKey === true),
      modelType: payload.ai.modelType,
      workingModel: payload.ai.workingModel,
      multimodalModel: payload.ai.multimodalModel,
      timeout: normalizePositiveNumber(payload.ai.timeout, normalizePositiveNumber(currentAi.timeout, 60000)),
    };
    
    if (payload.ai.imageConfig) {
      nextAi.imageConfig = {
        ...currentAi.imageConfig,
        ...payload.ai.imageConfig,
        apiKey: resolveSecretSaveValue(payload.ai.imageConfig.apiKey, currentAi.imageConfig?.apiKey, payload.ai.imageConfig.preserveApiKey === true),
      };
    }
    
    if (payload.ai.memeConfig) {
      nextAi.memeConfig = {
        ...currentAi.memeConfig,
        ...payload.ai.memeConfig,
        localEnabled: payload.ai.memeConfig.localEnabled !== false,
        preferLocal: payload.ai.memeConfig.preferLocal === true,
        localBaseDir: String(payload.ai.memeConfig.localBaseDir || '').trim(),
      };
    }
    
    await ConfigControl.set('ai', nextAi);
  }
  
  if (payload.imageMonitor) {
    const currentImageMonitor = allConfigs.imageMonitor || {};
    const nextImageMonitor = {
      ...currentImageMonitor,
      enabled: payload.imageMonitor.enabled,
      apiBase: payload.imageMonitor.apiBase,
      apiKey: resolveSecretSaveValue(payload.imageMonitor.apiKey, currentImageMonitor.apiKey, payload.imageMonitor.preserveApiKey === true),
      model: payload.imageMonitor.model,
      analysisTimeoutMs: normalizePositiveNumber(payload.imageMonitor.analysisTimeoutMs, normalizePositiveNumber(currentImageMonitor.analysisTimeoutMs, 30000)),
      fallbackReply: String(payload.imageMonitor.fallbackReply || ''),
      fallbackTimeoutReply: String(payload.imageMonitor.fallbackTimeoutReply || ''),
    };
    await ConfigControl.set('imageMonitor', nextImageMonitor);
  }
  
  if (payload.coreConfig?.tools?.search) {
    const currentCore = allConfigs.coreConfig || {};
    const nextCore = {
      ...currentCore,
      tools: {
        ...(currentCore.tools || {}),
        search: {
          ...(currentCore.tools?.search || {}),
          enabled: payload.coreConfig.tools.search.enabled,
          apiKey: resolveSecretSaveValue(payload.coreConfig.tools.search.apiKey, currentCore.tools?.search?.apiKey, payload.coreConfig.tools.search.preserveApiKey === true),
          markdownApiUrl: payload.coreConfig.tools.search.markdownApiUrl,
          markdownStatusUrl: payload.coreConfig.tools.search.markdownStatusUrl,
          timeoutMs: normalizePositiveNumber(payload.coreConfig.tools.search.timeoutMs, normalizePositiveNumber(currentCore.tools?.search?.timeoutMs, 60000)),
        },
      },
    };
    await ConfigControl.set('coreConfig', nextCore);
  }
  
  return buildApiSettingsPayload();
}

async function testApiConnection() {
  const allConfigs = ConfigControl.get() || {};
  const aiConfig = allConfigs.ai || {};
  const timeoutMs = normalizePositiveNumber(aiConfig.timeout, 60000);
  const baseApi = String(aiConfig.baseApi || '').trim();
  const apiKey = String(aiConfig.apiKey || '').trim();
  const model = String(aiConfig.modelType || aiConfig.workingModel || '').trim();

  if (!baseApi || !apiKey) {
    return { success: false, error: 'Missing AI baseApi or apiKey.' };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(buildOpenAiCompatibleUrl(baseApi, '/v1/models'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      return { success: true, detail: `API reachable (${latencyMs}ms)${model ? `, model: ${model}` : ''}`, latencyMs, timeoutMs };
    }
    return { success: false, error: `API HTTP ${response.status}`, latencyMs, timeoutMs };
  } catch (error) {
    return { success: false, error: `API request failed: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
  }
}

async function testImageApiConnection() {
  const allConfigs = ConfigControl.get() || {};
  const imageConfig = allConfigs.ai?.imageConfig || {};
  const timeoutMs = normalizePositiveNumber(imageConfig.timeout, 60000);

  if (String(imageConfig.imageMode || '').trim() === 'jimeng') {
    const jimengUrl = String(imageConfig.jimengApiUrl || '').trim();
    if (!jimengUrl) {
      return { success: false, error: 'Missing Jimeng API URL.' };
    }
    const startedAt = Date.now();
    try {
      const response = await fetch(jimengUrl, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      const latencyMs = Date.now() - startedAt;
      if (response.ok) {
        return { success: true, detail: `Jimeng API reachable (${latencyMs}ms)`, latencyMs, timeoutMs };
      }
      return { success: false, error: `Jimeng API HTTP ${response.status}`, latencyMs, timeoutMs };
    } catch (error) {
      return { success: false, error: `Jimeng API request failed: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
    }
  }

  const baseApi = String(imageConfig.baseApi || allConfigs.ai?.baseApi || '').trim();
  const apiKey = String(imageConfig.apiKey || allConfigs.ai?.apiKey || '').trim();
  const model = String(imageConfig.model || '').trim();

  if (!baseApi || !apiKey) {
    return { success: false, error: 'Missing image API baseApi or apiKey.' };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(buildOpenAiCompatibleUrl(baseApi, '/v1/models'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      return { success: true, detail: `Image API reachable (${latencyMs}ms)${model ? `, model: ${model}` : ''}`, latencyMs, timeoutMs };
    }
    return { success: false, error: `Image API HTTP ${response.status}`, latencyMs, timeoutMs };
  } catch (error) {
    return { success: false, error: `Image API request failed: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
  }
}

async function testImageMonitorApiConnection() {
  const allConfigs = ConfigControl.get() || {};
  const monitorConfig = allConfigs.imageMonitor || {};
  const timeoutMs = normalizePositiveNumber(monitorConfig.analysisTimeoutMs, 30000);

  if (!monitorConfig.enabled) {
    return { success: false, error: 'Image monitor is disabled.' };
  }

  const baseApi = String(monitorConfig.apiBase || '').trim();
  const apiKey = String(monitorConfig.apiKey || '').trim();
  if (!baseApi) {
    return { success: false, error: 'Missing image monitor apiBase.' };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(buildOpenAiCompatibleUrl(baseApi, '/v1/models'), {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      return { success: true, detail: `Image monitor API reachable (${latencyMs}ms)`, latencyMs, timeoutMs };
    }
    return { success: false, error: `Image monitor API HTTP ${response.status}`, latencyMs, timeoutMs };
  } catch (error) {
    return { success: false, error: `Image monitor API request failed: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
  }
}

async function testSearchApiConnection() {
  const allConfigs = ConfigControl.get() || {};
  const searchConfig = allConfigs.coreConfig?.tools?.search || {};
  const timeoutMs = normalizePositiveNumber(searchConfig.timeoutMs, 60000);

  if (!searchConfig.enabled) {
    return { success: false, error: 'Search tool is disabled.' };
  }

  const apiKey = String(searchConfig.apiKey || '').trim();
  if (!apiKey) {
    return { success: false, error: 'Missing search API key.' };
  }

  return { success: true, detail: `Search config looks ready. Timeout: ${timeoutMs}ms.`, timeoutMs };
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
    const { response } = await fetchRemoteImageResponseSafe(targetUrl);
    const latencyMs = Date.now() - startedAt;
    const contentType = String(response.headers.get('content-type') || '').trim();
    const ok = response.ok && /^image\//i.test(contentType);

    await closeRemoteImageResponseBodySafe(response);

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
  const allConfigs = ConfigControl.get() || {};
  const memeConfig = allConfigs.ai?.memeConfig || {};
  const mergedMemeConfig = {
    ...memeConfig,
    apiBase: payload.apiBase === undefined ? memeConfig.apiBase : String(payload.apiBase || '').trim(),
    localEnabled: payload.localEnabled === undefined ? memeConfig.localEnabled !== false : payload.localEnabled !== false,
    preferLocal: payload.preferLocal === undefined ? memeConfig.preferLocal === true : payload.preferLocal === true,
    localBaseDir: payload.localBaseDir === undefined ? memeConfig.localBaseDir : String(payload.localBaseDir || '').trim(),
  };

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

function getMemeSavedImageExtension(contentType = '', imageUrl = '') {
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

function buildMemeSavedFileName(index = 1, extension = '.jpg') {
  const safeIndex = Math.max(1, Number(index || 1));
  const safeExtension = /^\.[a-z0-9]+$/i.test(String(extension || '')) ? String(extension).toLowerCase() : '.jpg';
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(safeIndex).padStart(2, '0')}${safeExtension}`;
}

async function pullRemoteMemeToLocal(payload = {}) {
  const allConfigs = ConfigControl.get() || {};
  const currentMemeConfig = allConfigs.ai?.memeConfig || {};
  const mergedMemeConfig = {
    ...currentMemeConfig,
    apiBase: payload.apiBase === undefined ? currentMemeConfig.apiBase : String(payload.apiBase || '').trim(),
    localEnabled: payload.localEnabled === undefined ? currentMemeConfig.localEnabled !== false : payload.localEnabled !== false,
    preferLocal: payload.preferLocal === undefined ? currentMemeConfig.preferLocal === true : payload.preferLocal === true,
    localBaseDir: payload.localBaseDir === undefined ? currentMemeConfig.localBaseDir : String(payload.localBaseDir || '').trim(),
  };

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
      const remoteImage = await proxyRemoteImageSafe(resolvedUrl);
      const safeEmotion = sanitizeMemePathSegment(resolvedEmotion || requestedEmotion || 'default', 'default');
      const saveDir = path.join(resolvedBaseDir, safeCharacter, safeEmotion);
      const extension = getMemeSavedImageExtension(remoteImage.contentType, resolvedUrl);
      const fileName = buildMemeSavedFileName(savedItems.length + 1, extension);
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
async function buildLocalMemeScanPayload(payload = {}) {
  const allConfigs = ConfigControl.get() || {};
  const currentMemeConfig = allConfigs.ai?.memeConfig || {};
  const scanConfig = {
    ...currentMemeConfig,
    localEnabled: payload.localEnabled === undefined ? currentMemeConfig.localEnabled : payload.localEnabled,
    preferLocal: payload.preferLocal === undefined ? currentMemeConfig.preferLocal : payload.preferLocal,
    localBaseDir: payload.localBaseDir === undefined ? currentMemeConfig.localBaseDir : payload.localBaseDir,
  };

  return await Meme.scanLocalMemeDirectory(scanConfig);
}

function buildEditableConfigPayload() {
  const allConfigs = ConfigControl.get() || {};
  const config = allConfigs.config || {};
  const runtimeInfo = getWebConsoleInfo();
  return {
    webConsole: {
      webConsole: config.webConsole !== false,
      webConsoleReadOnly: config.webConsoleReadOnly === true,
      webConsoleHost: config.webConsoleHost || '127.0.0.1',
      webConsolePort: Number(config.webConsolePort || 27891),
      webConsolePageSize: Number(config.webConsolePageSize || 20),
      webConsoleMaxPageSize: Number(config.webConsoleMaxPageSize || 100),
      webConsoleExposeLogs: config.webConsoleExposeLogs !== false,
      webConsoleLogTailLength: Number(config.webConsoleLogTailLength || 12000),
      webConsoleMaskSensitiveConfig: config.webConsoleMaskSensitiveConfig !== false,
      webConsoleProfileRecentMessagesLimit: Number(config.webConsoleProfileRecentMessagesLimit || 20),
      webConsoleAffinityHistoryLimit: Number(config.webConsoleAffinityHistoryLimit || 50),
      runtimeRunning: !!runtimeInfo,
      runtimeUrl: runtimeInfo?.url || '',
      runtimeLoginConfigured: Boolean(String(config.webConsoleToken || '').trim()),
    },
  };
}

async function toggleFeatureState(feature, enabled) {
  const allConfigs = ConfigControl.get() || {};
  if (['ai', 'music', 'rss', 'auth', 'poke', 'webConsole'].includes(feature)) {
    const currentConfig = allConfigs.config || {};
    const nextConfig = { ...currentConfig, [feature]: enabled };
    await ConfigControl.set('config', nextConfig);
    return true;
  }
  if (['affinity', 'userProfile'].includes(feature)) {
    const currentAi = allConfigs.ai || {};
    const nextAi = {
      ...currentAi,
      [feature]: {
        ...(currentAi[feature] || {}),
        enabled,
      },
    };
    await ConfigControl.set('ai', nextAi);
    return true;
  }
  if (feature === 'tts') {
    const currentCore = allConfigs.coreConfig || {};
    const nextCore = {
      ...currentCore,
      tools: {
        ...(currentCore.tools || {}),
        tts: {
          ...(currentCore.tools?.tts || {}),
          enabled,
        },
      },
    };
    await ConfigControl.set('coreConfig', nextCore);
    return true;
  }
  throw new Error('Unsupported managed feature');
}

function getManagedFeatureKeys() {
  return ['poke', '60s', 'zwa', 'rss', 'help', 'welcome', 'faceReply', 'imageMonitor', 'ai', 'music', 'auth', 'autoUpdate'];
}

function extractManagedFeatureConfig(config = {}) {
  const result = {};
  for (const key of getManagedFeatureKeys()) {
    result[key] = config[key];
  }
  return result;
}

function buildDefaultManagedFeatureConfig() {
  const defaults = safeReadJson(Path.defaultConfig, {});
  return extractManagedFeatureConfig(defaults);
}

function normalizeFeatureToggleBackup(raw = {}) {
  if (!raw || typeof raw !== 'object') {
    return { config: {}, savedAt: '' };
  }
  if (raw.config && typeof raw.config === 'object') {
    return { config: extractManagedFeatureConfig(raw.config), savedAt: String(raw.savedAt || '') };
  }
  return { config: extractManagedFeatureConfig(raw), savedAt: '' };
}

async function manageFeatureToggle(action = '') {
  const allConfigs = ConfigControl.get() || {};
  const currentConfig = allConfigs.config || {};
  const nextConfig = { ...currentConfig };
  const actionMap = {
    enable_all: () => Object.assign(nextConfig, Object.fromEntries(getManagedFeatureKeys().map(key => [key, true]))),
    disable_all: () => Object.assign(nextConfig, Object.fromEntries(getManagedFeatureKeys().map(key => [key, false]))),
    reset: () => Object.assign(nextConfig, buildDefaultManagedFeatureConfig()),
    export_current: async () => ({
      message: 'Exported current feature toggle config.',
      exportText: JSON.stringify(extractManagedFeatureConfig(currentConfig), null, 2),
    }),
    export_backup: async () => {
      const backup = normalizeFeatureToggleBackup(allConfigs.featureToggleBackup || {});
      return {
        message: backup.savedAt ? `Exported feature toggle backup from ${backup.savedAt}` : 'No feature toggle backup found.',
        exportText: JSON.stringify(backup.config || {}, null, 2),
        backup,
      };
    },
    backup: async () => {
      const payload = { savedAt: new Date().toISOString(), config: extractManagedFeatureConfig(currentConfig) };
      await ConfigControl.set('featureToggleBackup', payload);
      return { message: `Feature toggle backup saved at ${payload.savedAt}`, backup: payload };
    },
    restore: async () => {
      const backup = normalizeFeatureToggleBackup(allConfigs.featureToggleBackup || {});
      if (!Object.keys(backup.config || {}).length) throw new Error('No feature toggle backup available.');
      Object.assign(nextConfig, backup.config);
      await ConfigControl.set('config', nextConfig);
      return {
        message: backup.savedAt ? `Feature toggle backup restored from ${backup.savedAt}` : 'Feature toggle backup restored.',
        config: nextConfig,
      };
    },
  };

  if (!actionMap[action]) {
    throw new Error('Unsupported feature toggle action');
  }

  if (['backup', 'restore', 'export_current', 'export_backup'].includes(action)) {
    return await actionMap[action]();
  }

  actionMap[action]();
  await ConfigControl.set('config', nextConfig);
  return { message: 'Feature toggle config updated.', config: nextConfig };
}

function buildFeatureToggleHelpMarkdown() {
  return [
    '# Feature Toggle Guide',
    '',
    '> Use the web console or command entry points to quickly enable, disable, backup, or restore common plugin features.',
    '',
    '## Common Actions',
    '- Enable all managed features',
    '- Disable all managed features',
    '- Reset managed features to default config',
    '- Export current feature toggle config',
    '- Export saved feature toggle backup',
    '- Create a feature toggle backup',
    '- Restore feature toggle backup',
    '',
    '## Notes',
    '- This only affects managed feature switches listed by the console.',
    '- Backup and restore operate on the managed subset, not every config file.',
    '- Review generated preview before sharing externally.',
  ].join('\n');
}

async function buildFeatureToggleHelpPreviewPayload() {
  const imagePath = await Renderer.renderMarkdown(buildFeatureToggleHelpMarkdown());
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error('Failed to render feature toggle help preview.');
  }
  const buffer = fs.readFileSync(imagePath);
  return {
    imagePath,
    dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
  };
}
async function saveEditableConfig(payload = {}) {
  const allConfigs = ConfigControl.get() || {};
  const currentConfig = allConfigs.config || {};
  const nextConfig = {
    ...currentConfig,
    ...(payload.webConsole || {}),
  };
  await ConfigControl.set('config', nextConfig);
  return buildEditableConfigPayload();
}

function parseJsonObjects(content = '') {
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        results.push(content.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
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

function buildImageMonitorLogPayload(filters = {}) {
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
  const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
  const raw = readJsonLines(type === 'meme' ? IMAGE_MONITOR_MEME_INDEX : IMAGE_MONITOR_REVIEW_LOG)
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
      if (type !== 'meme' && risk && String(item.riskLevel || '').trim().toLowerCase() !== risk) {
        return false;
      }
      if (type !== 'meme' && isMeme) {
        const flag = item.isMeme === true;
        if (isMeme === 'true' && !flag) return false;
        if (isMeme === 'false' && flag) return false;
      }
      if (type !== 'meme' && alerted) {
        const flag = item.alerted === true;
        if (alerted === 'true' && !flag) return false;
        if (alerted === 'false' && flag) return false;
      }
      if (type !== 'meme' && recalled) {
        const flag = item.recalled === true;
        if (recalled === 'true' && !flag) return false;
        if (recalled === 'false' && flag) return false;
      }
      if (!query) return true;
      return [item.groupId, item.userId, item.messageId, item.summary, ...(item.memeTags || []), ...(item.riskCategories || []), item.error, item.fileName]
        .some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => String(b.reviewedAt || b.savedAt || '').localeCompare(String(a.reviewedAt || a.savedAt || '')));
  return paginateItems(raw, page, pageSize);
}

function findImageMonitorLogEntry(type, entryId) {
  const targetType = String(type || 'review').trim();
  const targetId = String(entryId || '').trim();
  if (!targetId) {
    return null;
  }
  const items = readJsonLines(targetType === 'meme' ? IMAGE_MONITOR_MEME_INDEX : IMAGE_MONITOR_REVIEW_LOG)
    .map(item => ({
      ...item,
      id: String(item.__line || ''),
    }));
  return items.find(item => item.id === targetId || String(item.__line || '') === targetId) || null;
}

function buildProfileDetailPayload(sessionId, userId) {
  const chat = getChatSnapshot();
  const webConsole = getWebConsoleConfig();
  const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const profile = profiles.find(item => String(item.sessionId) === String(sessionId) && String(item.userId) === String(userId));
  if (!profile) {
    return null;
  }

  const recentMessages = messages
    .filter(item => String(item.sessionId) === String(sessionId) && String(item.userId) === String(userId))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, webConsole.profileRecentMessagesLimit)
    .map(item => ({
      content: item.content,
      timestamp: item.timestamp,
      messageId: item.messageId,
      groupId: item.groupId,
      userName: item.userName,
    }));

  return {
    profile,
    recentMessages,
  };
}

function buildAffinityHistoryPayload(groupId, userId) {
  const webConsole = getWebConsoleConfig();
  const content = readTailText(AFFINITY_LOG_FILE, Math.max(50000, webConsole.logTailLength));
  const entries = parseJsonObjects(content)
    .map(item => {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => String(item.group_id) === String(groupId) && String(item.user_id) === String(userId))
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
    .slice(0, webConsole.affinityHistoryLimit);

  const affinity = getAffinitySnapshot();
  const current = affinity[`${groupId}:${userId}`] || null;

  return {
    current,
    entries,
  };
}

function resetAffinityRecord(groupId, userId) {
  const data = getAffinitySnapshot();
  const next = { ...data };
  const targetKey = `${groupId}:${userId}`;
  delete next[targetKey];
  safeWriteJson(AFFINITY_FILE, next);
}

function deleteUserProfile(sessionId, userId) {
  const chat = getChatSnapshot();
  const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
  chat.profiles = profiles.filter(item => !(String(item.sessionId) === String(sessionId) && String(item.userId) === String(userId)));
  safeWriteJson(CHAT_DB_FILE, chat);
}

function resetSessionRecord(sessionId) {
  const chat = getChatSnapshot();
  const targetId = String(sessionId || '');
  if (!targetId) {
    throw new Error('Missing sessionId');
  }
  chat.sessions = (chat.sessions || []).filter(item => String(item.id) !== targetId);
  chat.messages = (chat.messages || []).filter(item => String(item.sessionId) !== targetId);
  chat.topics = (chat.topics || []).filter(item => String(item.sessionId) !== targetId);
  chat.expressions = (chat.expressions || []).filter(item => String(item.sessionId) !== targetId);
  chat.profiles = (chat.profiles || []).filter(item => String(item.sessionId) !== targetId);
  chat.images = (chat.images || []).filter(item => String(item.sessionId) !== targetId);
  safeWriteJson(CHAT_DB_FILE, chat);
}

function resetSessionMessagesOnly(sessionId) {
  const chat = getChatSnapshot();
  const targetId = String(sessionId || '');
  if (!targetId) {
    throw new Error('Missing sessionId');
  }
  chat.messages = (chat.messages || []).filter(item => String(item.sessionId) !== targetId);
  chat.sessions = (chat.sessions || []).map(item => String(item.id) === targetId
    ? {
        ...item,
        updatedAt: Date.now(),
        compressedContext: null,
      }
    : item);
  safeWriteJson(CHAT_DB_FILE, chat);
}

function sanitizeSandboxHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
    .map(item => ({
      role: item.role,
      content: String(item.content || '').slice(0, 4000),
    }))
    .filter(item => item.content.trim())
    .slice(-20);
}

async function buildSandboxConfigStatusPayload(query = {}) {
  const { userId, config: aiConfig } = await getSandboxEffectiveConfig(query);
  const key = String(aiConfig.apiKey || '').trim();
  return {
    baseApi: String(aiConfig.baseApi || '').trim(),
    modelType: String(aiConfig.modelType || aiConfig.workingModel || '').trim(),
    keyPreview: key ? `${key.slice(0, 6)}***${key.slice(-4)}` : '',
    keyLength: key.length,
    isPlaceholder: !key || key === 'your-api-key' || key === 'your api key',
    valid: !!key && key !== 'your-api-key' && key !== 'your api key' && !!String(aiConfig.baseApi || '').trim() && !!String(aiConfig.modelType || aiConfig.workingModel || '').trim(),
    runtimeConfigPath: path.resolve(Path.root, '../../data/crystelf/ai.json'),
    defaultConfigPath: path.join(Path.defaultConfigPath, 'ai.json'),
    resolvedUserId: userId,
    groupId: String(query.groupId || '').trim(),
    configSource: String(query.userId || query.sessionId || '').trim() ? 'user-or-session' : 'global-default',
  };
}

async function getSandboxEffectiveConfig(payload = {}) {
  const userId = String(payload.userId || payload.sessionId || 'webconsole-sandbox').trim() || 'webconsole-sandbox';
  const userConfig = await UserConfigManager.getUserConfig(userId);
  const aiConfig = ConfigControl.get('ai') || {};
  return {
    userId,
    config: userConfig || aiConfig,
    globalConfig: aiConfig,
  };
}

function parseSandboxGroupHistory(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [nickname = '', userId = '', type = 'text', content = ''] = line.split('|');
      return {
        nickname: nickname.trim() || `Member ${index + 1}`,
        userId: userId.trim() || `unknown-${index + 1}`,
        type: type.trim() || 'text',
        content: content.trim(),
        seq: index + 1,
      };
    })
    .slice(-20);
}

function parseSandboxMemories(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [keywords = '', data = '', createdAt = ''] = line.split('|');
      return {
        keywords: keywords.trim() || `memory-${index + 1}`,
        data: data.trim() || '',
        createdAt: createdAt.trim() || new Date().toISOString(),
      };
    })
    .filter(item => item.data)
    .slice(-20);
}

function parseSandboxKnowledge(value = '') {
  const source = String(value || '').trim();
  if (!source) {
    return [];
  }

  const blocks = source
    .split(/\n\s*\n+/)
    .map(item => item.trim())
    .filter(Boolean);

  return blocks.map((block, index) => {
    const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const title = (lines.shift() || `Knowledge ${index + 1}`).replace(/^#+\s*/, '');
    let tags = [];
    if (lines[0] && /^tags?\s*:/i.test(lines[0])) {
      tags = lines.shift().replace(/^tags?\s*:/i, '').split(/[;,，、]/).map(item => item.trim()).filter(Boolean);
    }
    return {
      title,
      tags,
      content: lines.join('\n').trim(),
    };
  }).filter(item => item.content);
}

function tokenizeSandboxText(value = '') {
  const tokens = new Set();
  const normalized = String(value || '').toLowerCase();
  const words = normalized.match(/[a-z0-9_\-\u4e00-\u9fa5]{2,}/g) || [];
  for (const word of words) {
    tokens.add(word);
  }
  return Array.from(tokens);
}

function retrieveSandboxKnowledge(query = '', knowledgeItems = [], topK = 3) {
  const queryTokens = tokenizeSandboxText(query);
  if (queryTokens.length === 0 || knowledgeItems.length === 0) {
    return [];
  }
  const requestedTags = String(arguments[3] || '').split(/[;,，、]/).map(item => item.trim().toLowerCase()).filter(Boolean);
  return knowledgeItems
    .filter(item => requestedTags.length === 0 || (item.tags || []).some(tag => requestedTags.includes(String(tag).toLowerCase())))
    .map(item => {
      const haystack = `${item.title}\n${item.content}`.toLowerCase();
      const title = String(item.title || '').toLowerCase();
      const matchedTokens = queryTokens.filter(token => haystack.includes(token));
      const titleHits = queryTokens.filter(token => title.includes(token));
      const tagHits = (item.tags || []).filter(tag => queryTokens.some(token => String(tag).toLowerCase().includes(token)));
      return {
        ...item,
        matchedTokens,
        score: matchedTokens.length + titleHits.length * 3 + tagHits.length * 2,
      };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function buildSandboxKnowledgeContext(matches = []) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return '';
  }
  return [
    'Relevant knowledge base entries:',
    ...matches.map((item, index) => `${index + 1}. ${item.title}\nTags: ${(item.tags || []).join(', ')}\nContent: ${item.content}`),
  ].join('\n');
}

async function buildSandboxSystemPrompt(payload = {}) {
  const customPrompt = String(payload.systemPrompt || '').trim();
  if (customPrompt) {
    return customPrompt;
  }
  const profileConfig = ConfigControl.get('profile') || {};
  const botName = String(payload.botName || profileConfig.nickName || 'LingJing').trim() || 'LingJing';
  const { getSystemPrompt } = await import('../../constants/ai/prompts.js');
  const basePrompt = await getSystemPrompt(botName);
  const userId = String(payload.userId || payload.sessionId || 'webconsole-sandbox').trim() || 'webconsole-sandbox';
  const userName = String(payload.userName || 'Sandbox User').trim() || 'Sandbox User';
  const groupId = String(payload.groupId || '').trim();
  const isMaster = String(payload.isMaster || '').trim().toLowerCase() === 'true';
  const contextNote = String(payload.contextNote || '').trim();
  const groupHistory = parseSandboxGroupHistory(payload.groupHistory);
  const memories = parseSandboxMemories(payload.memories);
  const knowledgeItems = parseSandboxKnowledge(payload.knowledgeBase);
  const knowledgeMatches = retrieveSandboxKnowledge(String(payload.prompt || ''), knowledgeItems, Number(payload.knowledgeTopK || 3), String(payload.knowledgeFilterTags || ''));
  const knowledgeContext = buildSandboxKnowledgeContext(knowledgeMatches);
  const now = new Date();

  let contextIntro = [
    'Sandbox runtime context:',
    `- Bot name: ${botName}`,
    `- User name: ${userName}`,
    `- User id: ${userId}`,
    `- Group id: ${groupId || '(none)'}`,
    `- User role: ${isMaster ? 'master' : 'normal'}`,
    `- Date: ${now.toLocaleDateString('zh-CN')}`,
    `- Time: ${now.toLocaleTimeString('zh-CN')}`,
    contextNote ? `- Context note: ${contextNote}` : '',
  ].filter(Boolean).join('\n');

  if (groupHistory.length > 0) {
    const aiConfig = ConfigControl.get('ai') || {};
    const maxMessageLength = aiConfig?.maxMessageLength || 100;
    contextIntro += '\nRecent group history:\n';
    for (const message of groupHistory) {
      if (message.type === 'text') {
        let displayText = String(message.content || '');
        if (displayText.length > maxMessageLength) {
          const omittedChars = displayText.length - maxMessageLength;
          displayText = displayText.substring(0, maxMessageLength) + `...(omitted ${omittedChars} chars)`;
        }
        contextIntro += `[${message.nickname || 'unknown'},id:${message.userId},seq:${message.seq}] ${displayText}\n`;
      } else if (message.type === 'at') {
        contextIntro += `[${message.nickname || 'unknown'},id:${message.userId},seq:${message.seq}] @${message.content || 'mention'}\n`;
      } else if (message.type === 'image') {
        contextIntro += `[${message.nickname || 'unknown'},id:${message.userId},seq:${message.seq}] [image]\n`;
      }
    }
  }

  if (memories.length > 0) {
    contextIntro += 'Remembered memories:\n';
    memories.forEach((memory, index) => {
      contextIntro += `${index + 1}. keywords=${memory.keywords} data=${memory.data} createdAt=${memory.createdAt}\n`;
    });
  }

  if (knowledgeContext) {
    contextIntro += `\n${knowledgeContext}\n`;
  }

  return `${contextIntro}\n${basePrompt}`;
}

async function buildSandboxPromptPreviewPayload(payload = {}) {
  const { userId, config: effectiveConfig, globalConfig } = await getSandboxEffectiveConfig(payload);
  const systemPrompt = await buildSandboxSystemPrompt(payload);
  const knowledgeItems = parseSandboxKnowledge(payload.knowledgeBase);
  const knowledgeMatches = retrieveSandboxKnowledge(String(payload.prompt || ''), knowledgeItems, Number(payload.knowledgeTopK || 3), String(payload.knowledgeFilterTags || ''));
  logger.info(`[sandbox-rag-preview] prompt=${JSON.stringify(String(payload.prompt || ''))} knowledgeBase=${JSON.stringify(String(payload.knowledgeBase || ''))}`);
  logger.info(`[sandbox-rag-preview] knowledgeItems=${JSON.stringify(knowledgeItems)}`);
  logger.info(`[sandbox-rag-preview] queryTokens=${JSON.stringify(tokenizeSandboxText(String(payload.prompt || '')))}`);
  logger.info(`[sandbox-rag-preview] knowledgeMatches=${JSON.stringify(knowledgeMatches)}`);
  return {
    success: true,
    systemPrompt,
    systemPromptLength: systemPrompt.length,
    resolvedUserId: userId,
    configSource: effectiveConfig === globalConfig ? 'global' : 'user',
    knowledgeMatches,
    debugKnowledgeBase: String(payload.knowledgeBase || ''),
    debugKnowledgeItems: knowledgeItems,
    debugQueryTokens: tokenizeSandboxText(String(payload.prompt || '')),
  };
}

async function buildSandboxWebReadPayload(payload = {}) {
  const url = String(payload.url || '').trim();
  if (!url) {
    throw new Error('URL is required for web read.');
  }
  const result = await fetchWebMarkdown({
    url,
    max_length: payload.maxLength,
    timeout_ms: payload.timeoutMs,
  });
  if (result.success === false) {
    throw new Error(result.error || 'Web markdown fetch failed.');
  }
  return {
    success: true,
    url: result.url,
    taskId: result.task_id,
    size: result.size,
    markdown: result.markdown,
  };
}

async function generateKnowledgeBaseFromWebPayload(payload = {}) {
  const query = String(payload.query || '').trim();
  if (!query) {
    throw new Error('Search query is required.');
  }
  const aiConfig = ConfigControl.get('ai') || {};
  const coreConfig = ConfigControl.get('coreConfig') || {};
  const apiKey = String(aiConfig.apiKey || '').trim();
  const baseApi = String(aiConfig.baseApi || '').trim();
  const model = String(aiConfig.workingModel || aiConfig.modelType || '').trim();
  if (!apiKey || apiKey === 'your-api-key' || apiKey === 'your api key') {
    throw new Error('AI apiKey is required to generate knowledge base content.');
  }
  if (!baseApi || !model) {
    throw new Error('AI baseApi and modelType are required.');
  }
  if (!coreConfig?.tools?.search?.enabled) {
    throw new Error('Search tool must be enabled first.');
  }

  logger.info(`[knowledge-generate] start query=${JSON.stringify(query)}`);

  const searchResult = await searchWeb({
    query,
    limit: Math.min(Math.max(Number(payload.limit || 5), 1), 5),
    fetch_full: false,
  });
  if (searchResult.success === false) {
    throw new Error(searchResult.error || 'Search request failed.');
  }
  logger.info(`[knowledge-generate] search success count=${Array.isArray(searchResult.results) ? searchResult.results.length : 0}`);

  const searchItems = Array.isArray(searchResult.results) ? searchResult.results.filter(item => item.url) : [];
  if (searchItems.length === 0) {
    throw new Error('No searchable results were returned.');
  }

  const knowledgeBase = searchItems.map((item, index) => {
    const title = String(item.title || `Result ${index + 1}`).trim();
    const content = String(item.snippet || item.description || item.content || '').trim();
    return [
      title,
      `tags: web, search, result-${index + 1}`,
      content || String(item.url || '').trim(),
    ].join('\n');
  }).join('\n\n');

  return {
    success: true,
    query,
    count: searchItems.length,
    items: searchItems,
    knowledgeBase,
  };
}
async function runSandboxChat(payload = {}) {
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) {
    throw new Error('Prompt is required.');
  }
  if (prompt.length > 4000) {
    throw new Error('Prompt is too long. Maximum length is 4000 characters.');
  }

  const history = sanitizeSandboxHistory(payload.history);
  const sessionId = `webconsole:sandbox:${String(payload.sessionId || 'default').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 60) || 'default'}`;
  const { userId, config: effectiveConfig, globalConfig } = await getSandboxEffectiveConfig(payload);
  const apiKey = String(effectiveConfig.apiKey || '').trim();
  const baseApi = String(effectiveConfig.baseApi || '').trim();
  const model = String(payload.model || effectiveConfig.modelType || effectiveConfig.workingModel || '').trim();
  const temperature = Math.max(0, Math.min(2, Number(payload.temperature ?? effectiveConfig.temperature ?? 0.7)));
  const maxTokens = payload.maxTokens === undefined || payload.maxTokens === null || payload.maxTokens === ''
    ? undefined
    : Math.max(1, Math.min(8192, Number(payload.maxTokens)));
  if (!apiKey || apiKey === 'your-api-key' || apiKey === 'your api key') {
    throw new Error('AI apiKey is required.');
  }
  if (!baseApi || !model) {
    throw new Error('AI baseApi and model are required.');
  }

  const systemPrompt = await buildSandboxSystemPrompt(payload);
  const knowledgeItems = parseSandboxKnowledge(payload.knowledgeBase);
  const knowledgeMatches = retrieveSandboxKnowledge(prompt, knowledgeItems, Number(payload.knowledgeTopK || 3), String(payload.knowledgeFilterTags || ''));
  logger.info(`[sandbox-rag-chat] prompt=${JSON.stringify(prompt)} knowledgeBase=${JSON.stringify(String(payload.knowledgeBase || ''))}`);
  logger.info(`[sandbox-rag-chat] knowledgeItems=${JSON.stringify(knowledgeItems)}`);
  logger.info(`[sandbox-rag-chat] queryTokens=${JSON.stringify(tokenizeSandboxText(prompt))}`);
  logger.info(`[sandbox-rag-chat] knowledgeMatches=${JSON.stringify(knowledgeMatches)}`);

  const startedAt = Date.now();
  const ai = {
    async complete({ messages, tools, temperature: innerTemp, scene, sessionId: sid, groupId, userId: uid }) {
      const response = await fetch(buildOpenAiCompatibleUrl(baseApi, '/v1/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          temperature: innerTemp,
          max_tokens: maxTokens,
          stream: false,
        }),
      });
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(`AI completion request failed: ${response.status} ${rawText.slice(0, 300)}`);
      }
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        throw new Error('AI completion returned invalid JSON.');
      }
      const choice = parsed?.choices?.[0] || {};
      const message = choice.message || {};
      return {
        content: message.content || '',
        reasoning: message.reasoning_content || message.reasoning || '',
        toolCalls: (message.tool_calls || []).map(tc => ({
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments || '{}',
        })),
        usage: parsed?.usage || {},
        raw: parsed,
        meta: { scene, sessionId: sid, groupId, userId: uid },
      };
    },
  };

  const targetMessage = {
    userId,
    userName: String(payload.userName || 'Sandbox User').trim() || 'Sandbox User',
    userRole: 'member',
    userTitle: '',
    content: prompt,
    timestamp: Date.now(),
    messageId: `sandbox-${Date.now()}`,
  };

  const promptCtx = {
    config: effectiveConfig,
    isGroup: Boolean(payload.groupId),
    groupName: String(payload.groupName || 'Sandbox Group').trim() || 'Sandbox Group',
    memberCount: Number(payload.memberCount || 0) || undefined,
    botRole: 'member',
    botNickname: String(payload.botName || ConfigControl.get('profile')?.nickName || 'LingJing').trim() || 'LingJing',
    chatHistory: history.map((msg, index) => ({
      ...msg,
      timestamp: Date.now() - (history.length - index) * 60000,
      userName: msg.role === 'assistant' ? undefined : targetMessage.userName,
      userId: msg.role === 'assistant' ? undefined : userId,
      userRole: msg.role === 'assistant' ? undefined : 'member',
    })),
    targetMessage,
    replyContext: { type: 'reply' },
    memoryContext: '',
    knowledgeContext: buildSandboxKnowledgeContext(knowledgeMatches),
    affinityContext: '',
    userProfileContext: '',
    expressionContext: '',
    skillContext: '',
    plannerThoughts: '',
    reviewMessages: [],
  };

  const sandboxDefaultModel = String(effectiveConfig?.tools?.tts?.defaultModel || '').trim();
  const skillManager = new SkillSessionManager();
  await loadAutoSessionSkills(skillManager, sessionId);
  promptCtx.skillContext = skillManager.getActiveSkillsInfo(sessionId);
  const toolCtx = {
    sessionId,
    groupId: String(payload.groupId || '').trim(),
    userId,
    promptCtx,
    targetMessage,
    defaultVoiceModel: sandboxDefaultModel,
    config: effectiveConfig,
    pendingImageUrls: [],
    skillManager,
    voiceMessages: [],
  };

  const emojiAgent = new EmojiAgent(null, effectiveConfig, {
    getMessages() {
      return [];
    },
  });

  const humanize = { emojiAgent };
  const result = await runChat(ai, toolCtx, promptCtx.chatHistory, targetMessage, promptCtx, humanize);
  const reply = Array.isArray(result?.messages) ? result.messages.join('\n') : '';
  const toolCalls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
  const voiceMessages = [
    ...(Array.isArray(result?.voiceMessages) ? result.voiceMessages : []),
    ...toolCalls
      .map(item => item?.result?.voiceMessage)
      .filter(item => item && item.audioUrl),
  ];
  const emojiPath = result?.emojiPath || '';
  if (!reply.trim() && !emojiPath && voiceMessages.length === 0) {
    throw new Error('Sandbox chat returned no visible output.');
  }

  return {
    success: true,
    sessionId,
    reply: String(reply),
    usage: {},
    rawResponse: JSON.stringify(result || {}, null, 2),
    systemPrompt,
    note: 'Sandbox mode is for console-side testing only. Output may differ from live chat flows.',
    elapsedMs: Date.now() - startedAt,
    toolCalls,
    knowledgeMatches,
    debugKnowledgeBase: String(payload.knowledgeBase || ''),
    debugKnowledgeItems: knowledgeItems,
    debugQueryTokens: tokenizeSandboxText(prompt),
    emojiPath,
    voiceMessages,
    request: {
      model,
      temperature,
      maxTokens: maxTokens ?? null,
      historyCount: history.length,
      systemPromptLength: systemPrompt.length,
      configSource: effectiveConfig === globalConfig ? 'global' : 'user',
      resolvedUserId: userId,
      groupId: String(payload.groupId || '').trim(),
      userName: String(payload.userName || 'Sandbox User').trim() || 'Sandbox User',
      botName: String(payload.botName || ConfigControl.get('profile')?.nickName || 'LingJing').trim() || 'LingJing',
    },
  };
}
function serveStatic(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  let resolvedPathname = pathname;
  if (!path.extname(resolvedPathname)) {
    const htmlCandidate = path.join(PUBLIC_DIR, `${resolvedPathname}.html`);
    if (fs.existsSync(htmlCandidate) && fs.statSync(htmlCandidate).isFile()) {
      resolvedPathname = `${resolvedPathname}.html`;
    }
  }
  const targetPath = path.normalize(path.join(PUBLIC_DIR, resolvedPathname));
  if (!isPathInsideRoot(targetPath, PUBLIC_DIR)) {
    sendText(res, 'Forbidden', 403);
    return;
  }
  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    sendText(res, 'Not Found', 404);
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const bootstrapMode = isBootstrapSetupRequest(req);
  if (ext === '.html' && bootstrapMode) {
    if (resolvedPathname !== '/plugin-settings.html') {
      sendRedirect(res, '/plugin-settings.html?bootstrap=1');
      return;
    }
  }
  if (ext === '.html' && !bootstrapMode && resolvedPathname !== '/login.html' && !isAuthorized(req)) {
    const redirectTarget = normalizeWebConsoleRedirectPath(`${pathname}${url.search || ''}`);
    sendRedirect(res, `/login.html?redirect=${encodeURIComponent(redirectTarget)}`);
    return;
  }
  if (ext === '.html' && resolvedPathname === '/login.html' && isAuthorized(req)) {
    sendRedirect(res, normalizeWebConsoleRedirectPath(url.searchParams.get('redirect') || '/index.html'));
    return;
  }
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';
  if (mimeMap[ext]) {
    sendText(res, fs.readFileSync(targetPath, 'utf8'), 200, contentType);
    return;
  }
  sendBinary(res, fs.readFileSync(targetPath), 200, {
    'Content-Type': contentType,
  });
}

function createHandler() {
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const requiresSameOriginCheck = !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase());
    const bootstrapMode = isBootstrapSetupRequest(req);
    const bootstrapApiAllowed = bootstrapMode && isBootstrapApiPath(url.pathname);
    if (url.pathname === '/console-background-image') {
      try {
        return await serveConsoleBackgroundImage(res);
      } catch (error) {
        logger.warn(`[webConsole] Background image route failed: ${error.message}`);
        return sendText(res, 'Background image unavailable', 503);
      }
    }
    if (url.pathname === '/api/auth/status') {
      return sendJson(res, buildAuthStatusPayload(req));
    }
    if (url.pathname.startsWith('/api/') && requiresSameOriginCheck && !requireSameOrigin(req, res)) {
      return;
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const result = await loginWebConsole(req);
        return sendJson(res, result.payload, 200, result.headers || {});
      } catch (error) {
        return sendJson(
          res,
          { success: false, error: error.message, code: error.code || '' },
          getHttpErrorStatus(error, 401),
          error?.headers || {},
        );
      }
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!requireAuth(req, res)) {
        return;
      }
      if (!requireCsrf(req, res)) {
        return;
      }
      return sendJson(res, { success: true }, 200, {
        'Set-Cookie': buildWebConsoleAuthCookieClearHeader(req),
      });
    }
    if (url.pathname.startsWith('/api/') && !bootstrapApiAllowed && !requireAuth(req, res)) {
      return;
    }
    if (requiresSameOriginCheck && !bootstrapApiAllowed && !requireCsrf(req, res)) {
      return;
    }
    if (url.pathname === '/api/file-browser/tree') {
      try {
        return sendJson(res, buildFileBrowserTreePayload(url.searchParams.get('path') || ''));
      } catch (error) {
        return sendJson(
          res,
          { success: false, error: error.message, code: error.code || '', ...(error.details || {}) },
          getHttpErrorStatus(error, 500),
        );
      }
    }
    if (url.pathname === '/api/file-browser/read') {
      try {
        return sendJson(res, readFileBrowserFile(url.searchParams.get('path') || ''));
      } catch (error) {
        return sendJson(
          res,
          { success: false, error: error.message, code: error.code || '', ...(error.details || {}) },
          getHttpErrorStatus(error, 500),
        );
      }
    }
    if (url.pathname === '/api/file-browser/node') {
      try {
        return sendJson(res, buildFileBrowserNodePayload(url.searchParams.get('path') || ''));
      } catch (error) {
        return sendJson(
          res,
          { success: false, error: error.message, code: error.code || '', ...(error.details || {}) },
          getHttpErrorStatus(error, 500),
        );
      }
    }
    if (url.pathname === '/api/file-browser/search') {
      try {
        return sendJson(res, searchFileBrowserContent(url.searchParams.get('query') || '', {
          path: url.searchParams.get('path') || '',
          caseSensitive: url.searchParams.get('caseSensitive') === '1',
          limit: url.searchParams.get('limit') || '',
        }));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/file-browser/highlight' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, buildFileBrowserHighlightPayload(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/file-browser/create-directory' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, createFileBrowserDirectory(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/file-browser/rename' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, renameFileBrowserNode(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/file-browser/delete' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, deleteFileBrowserNode(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/file-browser/create-file' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, createFileBrowserFile(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/file-browser/write' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, writeFileBrowserFile(body));
      } catch (error) {
        return sendJson(
          res,
          { success: false, error: error.message, code: error.code || '', ...(error.details || {}) },
          getHttpErrorStatus(error, 500),
        );
      }
    }
    if (url.pathname === '/api/overview') {
      return sendJson(res, buildOverviewPayload());
    }
    if (url.pathname === '/api/health') {
      return sendJson(res, buildHealthPayload());
    }
    if (url.pathname === '/api/dependencies/install' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const { task, reused } = await createDependencyInstallTask(body);
        return sendJson(res, { success: true, reused, task: serializeDependencyInstallTask(task) }, 202);
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/dependencies/install-status') {
      try {
        const task = getDependencyInstallTask(url.searchParams.get('taskId'));
        return sendJson(res, { success: true, task: serializeDependencyInstallTask(task) });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 404));
      }
    }
    if (url.pathname === '/api/dependencies/install-active') {
      return sendJson(res, {
        success: true,
        tasks: listDependencyInstallTasks({ activeOnly: true }),
      });
    }
    if (url.pathname === '/api/dependencies/install-history') {
      return sendJson(res, {
        success: true,
        tasks: listDependencyInstallTasks({
          finishedOnly: true,
          limit: url.searchParams.get('limit'),
        }),
      });
    }
    if (url.pathname === '/api/dependencies/install-history/clear' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      return sendJson(res, {
        success: true,
        ...clearDependencyInstallHistory(),
      });
    }
    if (url.pathname === '/api/dependencies') {
      return sendJson(res, buildDependencyReport({ includeOtherPlugins: true }));
    }
    if (url.pathname === '/api/affinity') {
      return sendJson(res, buildAffinityListPayload({
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
    }
    if (url.pathname === '/api/profiles') {
      return sendJson(res, buildProfilesPayload({
        query: url.searchParams.get('query'),
        sessionId: url.searchParams.get('sessionId'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
    }
    if (url.pathname === '/api/sessions') {
      return sendJson(res, buildSessionListPayload({
        query: url.searchParams.get('query'),
        sessionId: url.searchParams.get('sessionId'),
        userId: url.searchParams.get('userId'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
    }
    if (url.pathname === '/api/config') {
      return sendJson(res, buildConfigPayload());
    }
    if (url.pathname === '/api/sandbox-config-status') {
      return sendJson(res, await buildSandboxConfigStatusPayload({
        sessionId: url.searchParams.get('sessionId'),
        userId: url.searchParams.get('userId'),
      }));
    }
    if (url.pathname === '/api/sandbox-prompt-preview' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, await buildSandboxPromptPreviewPayload(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/sandbox-web-read' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, await buildSandboxWebReadPayload(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/logs') {
      return sendJson(res, buildLogsPayload());
    }
    if (url.pathname === '/api/logs/usage') {
      return sendJson(res, buildUsageLogEntries({
        query: url.searchParams.get('query'),
        scene: url.searchParams.get('scene'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
    }
    if (url.pathname === '/api/logs/affinity') {
      return sendJson(res, buildAffinityLogEntries({
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
    }
    if (url.pathname === '/api/logs/image-monitor') {
      return sendJson(res, buildImageMonitorLogPayload({
        query: url.searchParams.get('query'),
        type: url.searchParams.get('type'),
        risk: url.searchParams.get('risk'),
        isMeme: url.searchParams.get('isMeme'),
        groupId: url.searchParams.get('groupId'),
        userId: url.searchParams.get('userId'),
        alerted: url.searchParams.get('alerted'),
        recalled: url.searchParams.get('recalled'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
    }
    if (url.pathname === '/api/logs/image-monitor/detail') {
      const entryId = url.searchParams.get('id');
      const type = url.searchParams.get('type') || 'review';
      const payload = findImageMonitorLogEntry(type, entryId);
      if (!payload) {
        return sendJson(res, { success: false, error: 'Not found' }, 404);
      }
      return sendJson(res, payload);
    }
    if (url.pathname === '/api/image-proxy') {
      const targetUrl = String(url.searchParams.get('url') || '').trim();
      if (!targetUrl) {
        return sendJson(res, { success: false, error: 'Bad request' }, 400);
      }
      if (!/^https?:\/\//i.test(targetUrl)) {
        return sendJson(res, { success: false, error: 'Bad request' }, 400);
      }
      try {
        const result = await proxyRemoteImageSafe(targetUrl);
        const contentType = normalizeImageContentTypeSafe(result.contentType);
        return sendBinary(res, result.buffer, 200, {
          'Content-Type': contentType,
          'Content-Length': result.buffer.length,
        });
      } catch (error) {
        return sendJson(
          res,
          { success: false, error: error.message, code: error.code || '' },
          getHttpErrorStatus(error, 502),
        );
      }
    }
    if (url.pathname === '/api/console-background-image/refresh' && req.method === 'POST') {
      try {
        const meta = await refreshConsoleBackgroundCache();
        return sendJson(res, {
          success: true,
          updatedAt: meta.updatedAt,
          version: meta.version,
          contentType: meta.contentType,
          size: meta.size,
          url: `/console-background-image?v=${meta.version}`,
        });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 502);
      }
    }
    if (url.pathname === '/api/logs/usage/detail') {
      const entryId = url.searchParams.get('id');
      const payload = findUsageLogEntry(entryId);
      if (!payload) {
        return sendJson(res, { success: false, error: 'Not found' }, 404);
      }
      return sendJson(res, payload);
    }
    if (url.pathname === '/api/logs/affinity/detail') {
      const entryId = url.searchParams.get('id');
      const payload = findAffinityLogEntry(entryId);
      if (!payload) {
        return sendJson(res, { success: false, error: 'Not found' }, 404);
      }
      return sendJson(res, payload);
    }
    if (url.pathname === '/api/export') {
      const type = url.searchParams.get('type');
      const text = exportDataAsText(type, {
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        userId: url.searchParams.get('userId'),
        sessionId: url.searchParams.get('sessionId'),
        scene: url.searchParams.get('scene'),
        risk: url.searchParams.get('risk'),
        isMeme: url.searchParams.get('isMeme'),
        alerted: url.searchParams.get('alerted'),
        recalled: url.searchParams.get('recalled'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
      });
      return sendText(res, text, 200, 'application/json; charset=utf-8');
    }
    if (url.pathname === '/api/config-backup') {
      return sendText(res, JSON.stringify(buildConfigBackupPayload(), null, 2), 200, 'application/json; charset=utf-8');
    }
    if (url.pathname === '/api/config-restore-preview' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, buildConfigRestorePreviewPayload(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/config-restore' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, await restoreConfigBackupPayload(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/trend/usage') {
      return sendJson(res, buildUsageTrendPayload());
    }
    if (url.pathname === '/api/trend/image-monitor-usage') {
      return sendJson(res, buildImageMonitorUsageTrendPayload());
    }
    if (url.pathname === '/api/trend/poke-image-summary') {
      return sendJson(res, buildPokeImageSummaryTrendPayload());
    }
    if (url.pathname === '/api/config/editable') {
      return sendJson(res, buildEditableConfigPayload());
    }
    if (url.pathname === '/api/plugin-settings') {
      return sendJson(res, await buildPluginSettingsPayload());
    }
    if (url.pathname === '/api/api-settings') {
      return sendJson(res, buildApiSettingsPayload());
    }
    if (url.pathname === '/api/api-settings/save' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const saved = await saveApiSettings(body);
        return sendJson(res, { success: true, data: saved });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/api-settings/test') {
      return sendJson(res, await testApiConnection());
    }
    if (url.pathname === '/api/api-settings/test-image') {
      return sendJson(res, await testImageApiConnection());
    }
    if (url.pathname === '/api/api-settings/test-image-monitor') {
      return sendJson(res, await testImageMonitorApiConnection());
    }
    if (url.pathname === '/api/api-settings/test-search') {
      return sendJson(res, await testSearchApiConnection());
    }
    if (url.pathname === '/api/api-settings/test-meme' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, await testMemeApiConnection(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/api-settings/test-meme') {
      return sendJson(res, await testMemeApiConnection({
        character: url.searchParams.get('character'),
        emotion: url.searchParams.get('emotion'),
      }));
    }
    if (url.pathname === '/api/api-settings/meme-local-scan' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, await buildLocalMemeScanPayload(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/api-settings/meme-pull' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, await pullRemoteMemeToLocal(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/plugin-settings/knowledge-generate' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, await generateKnowledgeBaseFromWebPayload(body));
      } catch (error) {
        logger.error(`[knowledge-generate] failed: ${error.stack || error.message}`);
        return sendJson(res, { success: false, error: error.message, detail: error.stack || '' }, 500);
      }
    }
    if (url.pathname === '/api/plugin-settings/skills-config') {
      return sendJson(res, { success: true, data: buildSkillConfigEditorPayload() });
    }
    if (url.pathname === '/api/plugin-settings/skills-config/validate' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        const config = validateSkillConfigPayload(body?.config || {});
        const definitions = Array.isArray(config.definitions) ? config.definitions : [];
        const toolCount = definitions.reduce((sum, item) => sum + (Array.isArray(item?.tools) ? item.tools.length : 0), 0);
        return sendJson(res, {
          success: true,
          data: {
            config,
            summary: {
              definitionCount: definitions.length,
              toolCount,
            },
          },
        });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/plugin-settings/skills-config/save' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const config = validateSkillConfigPayload(body?.config || {});
        await ConfigControl.set('skills', config);
        return sendJson(res, {
          success: true,
          data: buildSkillConfigEditorPayload(),
          settings: await buildPluginSettingsPayload(),
        });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/plugin-settings/skills-config/reset' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        await ConfigControl.set('skills', {});
        return sendJson(res, {
          success: true,
          data: buildSkillConfigEditorPayload(),
          settings: await buildPluginSettingsPayload(),
        });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/help-diy') {
      return sendJson(res, await buildHelpDiyPayload());
    }
    if (url.pathname === '/api/help-diy/templates') {
      return sendJson(res, {
        success: true,
        items: getHelpDiyTemplates().map(item => ({
          key: item.key,
          label: item.label,
          description: item.description,
          payload: item.payload,
        })),
      });
    }
    if (url.pathname === '/api/help-diy/history') {
      return sendJson(res, {
        success: true,
        items: buildHelpDiyHistoryPayload(),
      });
    }
    if (url.pathname === '/api/help-diy/history/delete' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, { success: true, items: deleteHelpDiyHistoryItem(body?.id) });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/help-diy/history/clear' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        return sendJson(res, { success: true, items: clearHelpDiyHistory() });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/help-diy/export') {
      return sendText(res, JSON.stringify(await buildHelpDiyPayload(), null, 2), 200, 'application/json; charset=utf-8');
    }
    if (url.pathname === '/api/help-diy/import-preview' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, await buildHelpDiyImportPreviewPayload(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/help-diy/upload-image' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const urlPath = saveBase64Image(body?.dataUrl, String(body?.slot || 'help'));
        return sendJson(res, { success: true, url: urlPath });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/help-diy/delete-image' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        deleteHelpDiyImage(body?.url);
        return sendJson(res, { success: true });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/config/save' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const saved = await saveEditableConfig(body);
        return sendJson(res, { success: true, data: saved });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/plugin-settings/save' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly && !bootstrapMode) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const saved = await savePluginSettings({
          ...body,
          bootstrapMode,
        });
        return sendJson(res, { success: true, data: saved });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/plugin-settings/feature-manage' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const result = await manageFeatureToggle(String(body?.action || ''));
        return sendJson(res, { success: true, data: result, settings: await buildPluginSettingsPayload(), overview: buildOverviewPayload() });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
    }
    if (url.pathname === '/api/plugin-settings/help-preview') {
      try {
        return sendJson(res, { success: true, data: await buildFeatureToggleHelpPreviewPayload() });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/help-diy/save' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        return sendJson(res, { success: true, data: await saveHelpDiyPayload(body) });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/features/toggle' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        if (!body.feature || typeof body.enabled !== 'boolean') {
        return sendJson(res, { success: false, error: 'Bad request' }, 400);
        }
        await toggleFeatureState(String(body.feature), body.enabled);
        return sendJson(res, { success: true, features: buildOverviewPayload().features });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/sandbox-chat' && req.method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        const data = await runSandboxChat(body);
        return sendJson(res, data);
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/profile-detail') {
      const sessionId = url.searchParams.get('sessionId');
      const userId = url.searchParams.get('userId');
      const payload = buildProfileDetailPayload(sessionId, userId);
      if (!payload) {
        return sendJson(res, { success: false, error: 'Not found' }, 404);
      }
      return sendJson(res, payload);
    }
    if (url.pathname === '/api/session-debug') {
      const sessionId = url.searchParams.get('sessionId');
      const userId = url.searchParams.get('userId');
      const payload = buildSessionDebugPayload(sessionId, userId);
      if (!payload) {
        return sendJson(res, { success: false, error: 'Not found' }, 404);
      }
      return sendJson(res, payload);
    }
    if (url.pathname === '/api/affinity-history') {
      const groupId = url.searchParams.get('groupId');
      const userId = url.searchParams.get('userId');
      return sendJson(res, buildAffinityHistoryPayload(groupId, userId));
    }
    if (url.pathname === '/api/affinity/reset' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        if (!body.groupId || !body.userId) {
        return sendJson(res, { success: false, error: 'Bad request' }, 400);
        }
        resetAffinityRecord(body.groupId, body.userId);
        return sendJson(res, { success: true });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/profiles/delete' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        if (!body.sessionId || !body.userId) {
        return sendJson(res, { success: false, error: 'Bad request' }, 400);
        }
        deleteUserProfile(body.sessionId, body.userId);
        return sendJson(res, { success: true });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/sessions/reset' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        if (!body.sessionId) {
        return sendJson(res, { success: false, error: 'Bad request' }, 400);
        }
        const mode = String(body.mode || 'full').trim();
        if (mode === 'messages_only') {
          resetSessionMessagesOnly(body.sessionId);
        } else {
          resetSessionRecord(body.sessionId);
        }
        return sendJson(res, { success: true, sessionId: body.sessionId, mode });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    return serveStatic(req, res);
  };
}

export async function startWebConsole() {
  if (serverInstance && currentInfo) {
    return currentInfo;
  }

  const appConfig = getWebConsoleConfig();
  if (appConfig.enabled === false) {
    return null;
  }
  if (!isLoopbackAddress(appConfig.host) && !appConfig.authToken) {
    throw new Error('非本机地址启动控制台前必须先设置 webConsoleToken');
  }

  await fs.promises.mkdir(PUBLIC_DIR, { recursive: true });
  const host = appConfig.host;
  const preferredPort = appConfig.port;

  const server = http.createServer(createHandler());
  const info = await new Promise((resolve, reject) => {
    const tryListen = (port) => {
      server.once('error', (error) => {
        if (error?.code === 'EADDRINUSE') {
          if (!appConfig.portAutoIncrement) {
            reject(error);
            return;
          }
          server.removeAllListeners('error');
          tryListen(port + 1);
          return;
        }
        reject(error);
      });
      server.listen(port, host, () => {
        const address = server.address();
        resolve({
          host,
          port: address?.port || port,
          url: `http://${host}:${address?.port || port}/`,
        });
      });
    };
    tryListen(preferredPort);
  });

  serverInstance = server;
  currentInfo = info;
  logger.info(`[webConsole] Web console is running at ${info.url}`);
  return info;
}

export async function stopWebConsole() {
  if (!serverInstance) {
    return;
  }
  const server = serverInstance;
  serverInstance = null;
  currentInfo = null;
  await new Promise(resolve => server.close(() => resolve()));
}

export function getWebConsoleInfo() {
  return currentInfo;
}
