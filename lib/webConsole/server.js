import http from 'http';
import fs from 'fs';
import path from 'path';
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
const CONSOLE_BACKGROUND_SOURCE_URL = 'https://imgapi.badmia.com/index.php?key=bz';
const CONSOLE_BACKGROUND_CACHE_DIR = path.join(process.cwd(), 'temp', 'web-console-background');
const CONSOLE_BACKGROUND_CACHE_FILE = path.join(CONSOLE_BACKGROUND_CACHE_DIR, 'current-image.bin');
const CONSOLE_BACKGROUND_CACHE_META_FILE = path.join(CONSOLE_BACKGROUND_CACHE_DIR, 'current-image.json');
const PACKAGE_JSON_FILE = Path.pkg;
const PACKAGE_LOCK_FILE = path.join(Path.root, 'package-lock.json');
const require = createRequire(import.meta.url);
const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),
  mark: (...args) => console.log(...args),
};

let serverInstance = null;
let currentInfo = null;
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
  auth: '验证',
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

function sendJson(res, payload, statusCode = 200, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, content, statusCode = 200, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(content);
}

function sendRedirect(res, location, statusCode = 302, headers = {}) {
  res.writeHead(statusCode, {
    Location: location,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end();
}

function sendBinary(res, buffer, statusCode = 200, headers = {}) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
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

function buildWebConsoleAuthCookie(token) {
  return [
    `${WEB_CONSOLE_AUTH_COOKIE}=${encodeURIComponent(String(token || '').trim())}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ');
}

function buildWebConsoleAuthCookieClearHeader() {
  return [
    `${WEB_CONSOLE_AUTH_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
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

function isLegacyDefaultMemeCharacter(value = '') {
  return /^zhenxun$/i.test(String(value || '').trim());
}

function normalizePersonaDisplayName(value = '') {
  const cleaned = String(value || '')
    .trim()
    .replace(/^[`"'“”]+|[`"'“”]+$/gu, '');
  if (!cleaned) {
    return '';
  }

  if (Array.from(cleaned).length > 24) {
    return '';
  }

  if (/^(智能助手|助手|机器人|AI|Bot|Assistant|ChatGPT)$/iu.test(cleaned)) {
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
    /你是(?:一个|一位)?名为\s*[`"'“”]?([^\s`"'“”',，。.!！？?]{1,24}?)(?=的|[\s,，。.!！？?]|$)/u,
    /你叫(?:做)?\s*[`"'“”]?([^\s`"'“”',，。.!！？?]{1,24}?)(?=的|[\s,，。.!！？?]|$)/u,
    /你的名字是\s*[`"'“”]?([^\s`"'“”',，。.!！？?]{1,24}?)(?=的|[\s,，。.!！？?]|$)/u,
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
  const botNickname = String(profileConfig.nickName || '').trim() || '芙宁娜';
  const personaCardName = extractPersonaDisplayName(aiConfig.botPersona || aiConfig.persona || '');
  const recommendedCharacter = configuredCharacter.effective || personaCardName || botNickname || '芙宁娜';
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

  return buildBotIdentitySnapshot(allConfigs, memeConfigOverride).recommendedCharacter || '芙宁娜';
}

function saveBase64Image(dataUrl = '', prefix = 'help') {
  const matched = String(dataUrl || '').match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!matched) {
    throw new Error('图片数据格式无效');
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
    throw new Error('仅支持删除帮助 DIY 上传的图片');
  }
  const filePath = path.join(PUBLIC_DIR, normalized.replace(/^\//, '').replace(/\//g, path.sep));
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
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
        '灵晶帮助',
        '',
        '发送以下命令查看分类帮助：',
        '1. #灵晶帮助 AI',
        '2. #灵晶帮助 管理',
        '3. #灵晶帮助 娱乐',
        '4. #灵晶帮助 调试',
        '',
        '常用入口：',
        '- #灵晶帮助 AI',
        '- #灵晶帮助 管理',
        '- #灵晶帮助 调试',
        '',
        '说明',
        '如需更完整说明，请查看插件 README.md',
      ].join('\n'),
      image: '',
    },
    categories: {
      ai: {
        mode: 'text',
        text: [
          '灵晶帮助 · AI',
          '',
          '触发方式',
          '1. @机器人 直接对话',
          '2. 昵称开头直接对话',
          '',
          '支持能力',
          '- 联网搜索',
          '- 网页正文读取',
          '- 表情包',
          '- 语音',
          '- 多模态图片理解',
          '- Markdown 与代码渲染',
          '',
          '使用说明',
          '使用前请先确认 AI 与工具配置可用',
        ].join('\n'),
        image: '',
      },
      manage: {
        mode: 'text',
        text: [
          '灵晶帮助 · 管理',
          '',
          '验证功能',
          '1. #开启验证',
          '2. #关闭验证',
          '3. #切换验证模式',
          '4. #重新验证@某人',
          '5. #绕过验证@某人',
          '',
          '欢迎功能',
          '6. #设置欢迎文案+欢迎词',
          '7. #设置欢迎图片',
          '8. #查看欢迎',
          '9. #清除欢迎',
        ].join('\n'),
        image: '',
      },
      fun: {
        mode: 'text',
        text: [
          '灵晶帮助 · 娱乐',
          '',
          '基础功能',
          '1. 60s / 早报',
          '2. 早安 / 晚安',
          '3. #回应+emoji',
          '',
          'RSS 功能',
          '4. #rss添加+订阅地址',
          '5. #rss移除+id',
          '6. #rss拉取+订阅地址',
          '',
          '点歌功能',
          '7. #点歌 歌名',
          '8. #听 歌名',
          '9. #听 1',
        ].join('\n'),
        image: '',
      },
      debug: {
        mode: 'text',
        text: [
          '灵晶帮助 · 调试',
          '',
          '本地控制台',
          '- 地址：http://127.0.0.1:27891/',
          '- 可查看健康状态、日志、画像、好感和会话',
          '',
          '网页调试沙箱',
          '- 可进行提示词调试',
          '- 可查看工具调用时间线',
          '- 可进行网页阅读测试',
          '- 可查看表情包与语音结果',
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

function getHelpDiyTemplates() {
  return [
    {
      key: 'simple',
      label: '简洁版',
      description: '只保留最常用入口，适合日常群聊快速查看。',
      payload: {
        enabled: true,
        home: ['灵晶帮助', '', '常用命令：', '- #灵晶帮助 AI', '- #灵晶帮助 管理', '- #灵晶帮助 娱乐', '- #灵晶帮助 调试'].join('\n'),
        categories: {
          ai: ['AI 帮助', '', '- @机器人 对话', '- 支持联网搜索 / 网页读取 / 表情包 / 语音'].join('\n'),
          manage: ['管理帮助', '', '- #开启验证', '- #关闭验证', '- #设置欢迎文案', '- #查看欢迎'].join('\n'),
          fun: ['娱乐帮助', '', '- 60s / 早报', '- 早安 / 晚安', '- #rss添加', '- #点歌 歌名'].join('\n'),
          debug: ['调试帮助', '', '- 控制台地址：http://127.0.0.1:27891/', '- 可查看网页调试沙箱与工具时间线'].join('\n'),
        },
      },
    },
    {
      key: 'full',
      label: '完整版',
      description: '覆盖当前默认帮助内容，信息更完整，适合新用户。',
      payload: {
        ...getDefaultHelpDiyPayload(),
        enabled: true,
      },
    },
    {
      key: 'admin',
      label: '管理员版',
      description: '突出管理、验证、欢迎和调试入口，适合群管理使用。',
      payload: {
        enabled: true,
        home: ['灵晶帮助 · 管理员版', '', '重点入口：', '- #灵晶帮助 管理', '- #灵晶帮助 调试', '', '建议管理员优先查看验证、欢迎和控制台功能。'].join('\n'),
        categories: {
          ai: ['灵晶帮助 · AI', '', '- @机器人 直接对话', '- 支持联网搜索 / 网页读取 / 语音 / 表情包', '- 使用前请先确认 AI 配置可用'].join('\n'),
          manage: ['灵晶帮助 · 管理', '', '验证：', '- #开启验证', '- #关闭验证', '- #切换验证模式', '- #重新验证@某人', '- #绕过验证@某人', '', '欢迎：', '- #设置欢迎文案+欢迎词', '- #设置欢迎图片', '- #查看欢迎', '- #清除欢迎'].join('\n'),
          fun: ['灵晶帮助 · 娱乐', '', '- 60s / 早报', '- 早安 / 晚安', '- #rss添加 / #rss移除 / #rss拉取', '- #点歌 / #听'].join('\n'),
          debug: ['灵晶帮助 · 调试', '', '- 本地控制台地址：http://127.0.0.1:27891/', '- 可查看网页调试沙箱、配置管理、日志、画像与好感调试'].join('\n'),
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
    return items;
  }
  safeWriteJson(HELP_DIY_HISTORY_FILE, []);
  return [];
}

function pushHelpDiyHistorySnapshot(payload = {}, note = '') {
  const current = buildHelpDiyHistoryPayload();
  const next = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      note: String(note || '').trim(),
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
  if (current.enabled !== next.enabled) changes.push('启用状态');
  if (JSON.stringify(current.home || {}) !== JSON.stringify(next.home || {})) changes.push('总帮助');
  for (const key of ['ai', 'manage', 'fun', 'debug']) {
    if (JSON.stringify(current.categories?.[key] || {}) !== JSON.stringify(next.categories?.[key] || {})) {
      changes.push(`分类:${key}`);
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
    logger.warn(`[webConsole] 读取 AI 用量明细失败: ${error.message}`);
    return [];
  }
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
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
    req.on('error', reject);
  });
}

function buildImageProxyHeaders(targetUrl) {
  let referer = targetUrl;
  let origin = '';
  try {
    const parsed = new URL(targetUrl);
    referer = `${parsed.origin}/`;
    origin = parsed.origin;
  } catch {
  }
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: referer,
    ...(origin ? { Origin: origin } : {}),
  };
}

async function proxyRemoteImage(targetUrl) {
  const response = await fetch(targetUrl, {
    headers: buildImageProxyHeaders(targetUrl),
  });
  if (!response.ok) {
    throw new Error(`远程图片请求失败: ${response.status}`);
  }
  const contentType = String(response.headers.get('content-type') || 'application/octet-stream');
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  };
}

function normalizeImageContentType(contentType = '') {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!normalized.startsWith('image/')) {
    throw new Error('远程背景返回的不是图片资源');
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
  const targetUrl = `${CONSOLE_BACKGROUND_SOURCE_URL}${CONSOLE_BACKGROUND_SOURCE_URL.includes('?') ? '&' : '?'}_r=${Date.now()}`;
  const result = await proxyRemoteImage(targetUrl);
  const contentType = normalizeImageContentType(result.contentType);
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
    logger.warn(`[webConsole] 远程背景缓存失败，改用本地回退: ${error.message}`);
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
    requireAuth: config.webConsoleRequireAuth === true,
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
  values['coreConfig.usageControl.dailySummary'] = usageOverview.summary || '暂无数据';
  values['coreConfig.usageControl.dailySceneSummary'] = usageOverview.sceneSummary || '暂无数据';
  values['coreConfig.usageControl.dailyModelSummary'] = usageOverview.modelSummary || '暂无数据';
  values['coreConfig.usageControl.dailyCostSummary'] = usageOverview.costSummary || '暂无数据';
  values['coreConfig.usageControl.dailyModelCostSummary'] = usageOverview.modelCostSummary || '暂无数据';
  values['coreConfig.usageControl.dailyLogFile'] = USAGE_LOG_FILE;
  values['coreConfig.usageControl.totalLogFile'] = USAGE_LOG_FILE;
  values['coreConfig.tools.tts.modelSummary'] = '请在运行环境中刷新语音模型缓存后查看';
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

async function buildPluginSettingsPayload() {
  const values = buildPluginSettingsValues();
  let currentGroup = '未分组';
  const items = [];
  for (const item of guobaSchema) {
    if (item.component === 'SOFT_GROUP_BEGIN') {
      currentGroup = item.label || '未分组';
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
      value: values[item.field],
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
  };
}

async function savePluginSettings(payload = {}) {
  const raw = payload?.data || {};
  const groupedUpdates = {};
  for (const item of guobaSchema) {
    if (!item?.field || isReadonlySchemaItem(item)) continue;
    if (!(item.field in raw)) continue;
    const [configName, ...rest] = item.field.split('.');
    if (!configName || rest.length === 0) continue;
    groupedUpdates[configName] ||= {};
    setByPath(groupedUpdates[configName], rest.join('.'), normalizeSchemaValue(item, raw[item.field]));
  }
  for (const [configName, update] of Object.entries(groupedUpdates)) {
    const existing = ConfigControl.get(configName) || {};
    await ConfigControl.set(configName, deepMerge(existing, update));
  }
  return buildPluginSettingsPayload();
}

function isAuthorized(req) {
  const { authToken, requireAuth } = getWebConsoleConfig();
  if (!authToken && !requireAuth) return true;
  if (!authToken && requireAuth) return false;
  return getWebConsoleAuthCookieValue(req) === authToken;
}

function requireAuth(req, res) {
  if (isAuthorized(req)) return true;
  sendJson(res, { success: false, error: '未授权访问' }, 401);
  return false;
}

function isWebConsoleAccessProtected(config = getWebConsoleConfig()) {
  return config.requireAuth === true || Boolean(String(config.authToken || '').trim());
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
  const authorized = isAuthorized(req);
  const accessProtected = isWebConsoleAccessProtected(config);

  return {
    success: true,
    accessProtected,
    requireAuth: config.requireAuth === true,
    loginEnabled: Boolean(config.authToken),
    authorized,
    readOnly: config.readOnly === true,
    canRead: accessProtected ? authorized : true,
    canWrite: authorized && config.readOnly !== true,
  };
}

async function loginWebConsole(req) {
  const config = getWebConsoleConfig();
  const body = await parseRequestBody(req);
  const providedToken = String(body?.token || '').trim();

  if (!config.authToken) {
    throw createHttpError(400, '当前控制台未配置访问令牌', 'NO_AUTH_TOKEN');
  }
  if (!providedToken) {
    throw createHttpError(400, '请输入控制台访问令牌', 'TOKEN_REQUIRED');
  }
  if (providedToken !== config.authToken) {
    throw createHttpError(401, '访问令牌错误', 'TOKEN_INVALID');
  }

  return {
    payload: buildAuthStatusPayload({
      ...req,
      headers: {
        ...(req.headers || {}),
        cookie: `${WEB_CONSOLE_AUTH_COOKIE}=${encodeURIComponent(providedToken)}`,
      },
    }),
    headers: {
      'Set-Cookie': buildWebConsoleAuthCookie(providedToken),
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
        }
        forceKillHandle = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
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
      throw createHttpError(400, '插件依赖安装目标无效', 'INVALID_INSTALL_TARGET');
    }

    const targetDir = getResolvedPathSafe(path.join(pluginsRoot, pluginId));
    if (!isSubPath(pluginsRoot, targetDir)) {
      throw createHttpError(400, '插件依赖安装目标越界', 'INVALID_INSTALL_TARGET');
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
    throw new Error(`包管理器检测失败: ${String(lastError.message || lastError.code).trim()}`);
  }
  if (lastFailureMessage) {
    throw new Error(`包管理器检测失败: ${lastFailureMessage}`);
  }
  throw new Error('未找到可用的包管理器');
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

  throw createHttpError(400, '当前依赖类型不支持一键安装', 'UNSUPPORTED_DEPENDENCY_TYPE');
}

function resolveDependencyInstallRequest(payload = {}) {
  const dependencyName = String(payload.name || '').trim();
  if (!dependencyName) {
    throw createHttpError(400, '缺少依赖名称', 'DEPENDENCY_NAME_REQUIRED');
  }

  const dependencyType = String(payload.dependencyType || payload.group || '').trim();
  const group = getDependencyGroupConfig(dependencyType);
  if (!group || !group.installSupported) {
    throw createHttpError(400, '当前依赖类型不支持一键安装', 'UNSUPPORTED_DEPENDENCY_TYPE');
  }

  const target = resolveDependencyInstallTarget(payload);
  const manifest = readJsonFileSafe(target.manifestPath, null);
  if (!manifest || typeof manifest !== 'object') {
    throw createHttpError(500, '目标插件清单读取失败', 'TARGET_MANIFEST_READ_FAILED');
  }

  const declaredDependencies = manifest[group.field];
  if (!declaredDependencies || typeof declaredDependencies !== 'object' || !(dependencyName in declaredDependencies)) {
    throw createHttpError(409, '目标 package.json 中未声明该依赖', 'DEPENDENCY_DECLARATION_MISSING');
  }

  const declaredVersion = String(declaredDependencies[dependencyName] || '').trim();
  const requestedVersion = String(payload.declaredVersion || '').trim();
  if (requestedVersion && declaredVersion && requestedVersion !== declaredVersion) {
    throw createHttpError(409, '依赖版本已变化，请刷新页面后重试', 'DEPENDENCY_VERSION_CHANGED');
  }

  const installedInfo = resolveInstalledDependencyInfo(dependencyName, target.targetDir);
  if (installedInfo.installed) {
    throw createHttpError(409, '依赖已经安装，无需重复执行', 'DEPENDENCY_ALREADY_INSTALLED');
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
    throw createHttpError(404, '安装任务不存在或已过期', 'TASK_NOT_FOUND');
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
      logger.mark(`[webConsole] 安装依赖任务开始: ${commandLine.join(' ')} @ ${task.absoluteTargetDir}`);

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
        task.error = '依赖安装超时';
        return task;
      }

      if (result.status !== 0) {
        task.status = 'error';
        task.error = task.stderrTail || task.stdoutTail || `安装命令退出码 ${result.status}`;
        return task;
      }

      task.status = 'success';
      task.error = '';
      logger.mark(`[webConsole] 安装依赖任务完成: ${commandLine.join(' ')} @ ${task.absoluteTargetDir}`);
      return task;
    } catch (error) {
      task.status = 'error';
      task.timedOut = Boolean(error?.timedOut);
      task.stdoutTail = trimOutputTail(error?.stdoutTail || task.stdoutTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
      task.stderrTail = trimOutputTail(error?.stderrTail || task.stderrTail, DEPENDENCY_INSTALL_TASK_OUTPUT_LIMIT);
      task.error = task.timedOut
        ? '依赖安装超时'
        : String(error?.message || task.stderrTail || task.stdoutTail || '依赖安装失败').trim();
      logger.error(`[webConsole] 安装依赖任务失败: ${task.name} -> ${task.error}`);
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
      task.error = String(error?.message || '依赖安装失败').trim();
      releaseDependencyInstallTaskKey(task);
      logger.error(`[webConsole] 安装依赖任务异常: ${task.name} -> ${task.error}`);
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
    pushIssue('error', 'AI 配置异常', '当前 AI 主配置不完整，可能无法正常发起请求。');
  }

  const searchApiUrl = String(
    coreConfig?.tools?.search?.apiUrl || coreConfig?.tools?.search?.baseUrl || ''
  ).trim();
  if (coreConfig?.tools?.search?.enabled && !searchApiUrl) {
    pushIssue('warn', '搜索工具配置不完整', '已启用搜索工具，但未发现可用 apiUrl。');
  }

  const ttsApiUrl = String(
    coreConfig?.tools?.tts?.apiUrl || coreConfig?.tools?.tts?.baseUrl || ''
  ).trim();
  if (coreConfig?.tools?.tts?.enabled && !ttsApiUrl) {
    pushIssue('warn', 'TTS 工具配置不完整', '已启用 TTS，但未发现可用 apiUrl。');
  }

  const requestCount = Number(usageOverview.request_count || 0);
  const errorCount = Number(usageOverview.error_count || 0);
  const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
  if (requestCount >= 5 && errorRate >= 0.3) {
    pushIssue('error', 'AI 请求错误率偏高', `今日请求 ${requestCount} 次，其中失败 ${errorCount} 次。`);
  } else if (errorCount > 0) {
    pushIssue('warn', '存在 AI 错误请求', `今日已有 ${errorCount} 次错误请求。`);
  }

  const usageStat = getFileStatSafe(USAGE_LOG_FILE);
  if (!usageStat) {
    pushIssue('warn', 'AI 用量日志缺失', '尚未发现 AI 用量日志文件，可能未产生请求或日志写入异常。');
  } else if (now - usageStat.mtimeMs > 30 * 60 * 1000) {
    pushIssue('warn', 'AI 用量日志长时间未更新', '最近 30 分钟未发现新的 AI 用量日志写入。');
  }

  const affinityStat = getFileStatSafe(AFFINITY_LOG_FILE);
  if (affinityStat && now - affinityStat.mtimeMs > 24 * 60 * 60 * 1000) {
    pushIssue('warn', '好感度日志长时间未更新', '最近 24 小时未发现新的好感日志写入。');
  }

  if (!dependencyReport.summary.manifestExists) {
    pushIssue('error', '依赖清单缺失', '未找到 package.json，无法执行依赖检查。');
  }
  if (dependencyReport.summary.runtimeMissingCount > 0) {
    const names = dependencyReport.problemItems
      .filter(item => item.group === 'runtime' && item.status === 'missing')
      .map(item => item.name)
      .slice(0, 6);
    pushIssue('error', '运行依赖缺失', `缺失 ${dependencyReport.summary.runtimeMissingCount} 个运行依赖：${names.join('、')}${dependencyReport.summary.runtimeMissingCount > names.length ? ' 等' : ''}`);
  } else if (dependencyReport.summary.runtimeMismatchCount > 0) {
    const names = dependencyReport.problemItems
      .filter(item => item.group === 'runtime' && item.status === 'version_mismatch')
      .map(item => item.name)
      .slice(0, 6);
    pushIssue('warn', '运行依赖版本偏差', `检测到 ${dependencyReport.summary.runtimeMismatchCount} 个运行依赖与锁文件版本不一致：${names.join('、')}${dependencyReport.summary.runtimeMismatchCount > names.length ? ' 等' : ''}`);
  }
  if (dependencyReport.summary.devMissingCount > 0) {
    pushIssue('warn', '开发依赖未完整安装', `当前缺失 ${dependencyReport.summary.devMissingCount} 个开发依赖；不影响运行，但会影响格式化、Lint 或后续开发。`);
  }

  const messageCount = Array.isArray(chat?.messages) ? chat.messages.length : 0;
  const profileCount = Array.isArray(chat?.profiles) ? chat.profiles.length : 0;
  const sessionCount = Array.isArray(chat?.sessions) ? chat.sessions.length : 0;
  if (messageCount > 5000) {
    pushIssue('warn', '会话消息规模偏大', `当前已累计 ${messageCount} 条消息，建议关注数据增长和清理策略。`);
  }
  if (sessionCount > 300) {
    pushIssue('warn', '会话数量偏多', `当前已存在 ${sessionCount} 个会话，建议检查是否需要归档或清理。`);
  }
  if (messageCount > 0 && profileCount === 0) {
    pushIssue('warn', '画像覆盖率偏低', '当前已有会话消息，但尚未发现画像数据。');
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
    throw new Error('备份文件格式无效，缺少 files 配置对象');
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
    throw new Error('备份文件格式无效，缺少 files 配置对象');
  }
  const selectedFiles = Array.isArray(payload?.selectedFiles)
    ? payload.selectedFiles.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const filesToRestore = selectedFiles.length > 0
    ? Object.fromEntries(Object.entries(files).filter(([key]) => selectedFiles.includes(key)))
    : files;
  if (Object.keys(filesToRestore).length === 0) {
    throw new Error('未选择任何可恢复的配置文件');
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
        ? '冷淡'
        : Number(item.score || 0) < Number(affinityConfig.neutralThreshold ?? 5)
          ? '普通'
          : Number(item.score || 0) < Number(affinityConfig.warmThreshold ?? 20)
            ? '熟悉'
            : '亲近',
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
        confidence: item.confidence || '中',
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
      const hasFallback = !!runtimeDebug.failureReason || (runtimeDebug.statusHints || []).some(h => String(h).includes('兜底') || String(h).includes('fallback'));
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
        lastMessagePreview: item.lastMessagePreview || '暂无消息',
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
    alerts.push({ tone: 'error', message: '当前会话没有可展示的消息记录。' });
  }
  if (usageSummary.requestCount === 0) {
    alerts.push({ tone: 'neutral', message: '当前会话暂无关联 AI 请求，可能尚未触发回复或日志未记录。' });
  }
  if (usageSummary.errorCount > 0) {
    alerts.push({ tone: 'error', message: `当前会话存在 ${usageSummary.errorCount} 次 AI 错误请求，建议优先查看请求详情。` });
  }
  if (linkedProfiles.length === 0) {
    alerts.push({ tone: 'neutral', message: '当前会话暂无关联画像，可结合消息和请求日志排查画像未生成原因。' });
  }
  if (focusUserId && !linkedProfiles.some(item => String(item.userId) === String(focusUserId))) {
    alerts.push({ tone: 'error', message: '当前聚焦用户暂无画像记录，可能画像功能未触发或尚未学习完成。' });
  }
  if (sessionMessages.length > 0 && !sessionMessages.some(item => item.role === 'assistant')) {
    alerts.push({ tone: 'error', message: '当前会话暂无助手回复记录，可重点检查是否触发回复、是否被限流或是否请求失败。' });
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

  const coreConfig = webConsole.maskSensitiveConfig
    ? {
        ...allConfigs.coreConfig,
        token: maskSensitive(allConfigs.coreConfig?.token),
        tools: {
          ...(allConfigs.coreConfig?.tools || {}),
          search: {
            ...(allConfigs.coreConfig?.tools?.search || {}),
            apiKey: maskSecretValue(allConfigs.coreConfig?.tools?.search?.apiKey),
          },
        },
      }
    : (allConfigs.coreConfig || {});

  const aiConfig = webConsole.maskSensitiveConfig
    ? {
        ...(allConfigs.ai || {}),
        apiKey: maskSecretValue(allConfigs.ai?.apiKey),
        imageConfig: {
          ...(allConfigs.ai?.imageConfig || {}),
          apiKey: maskSecretValue(allConfigs.ai?.imageConfig?.apiKey),
        },
      }
    : (allConfigs.ai || {});

  const maskedWebConsole = webConsole.maskSensitiveConfig
    ? {
        ...webConsole,
        authToken: maskSensitive(webConsole.authToken),
      }
    : webConsole;

  const imageMonitorConfig = webConsole.maskSensitiveConfig
    ? {
        ...(allConfigs.imageMonitor || {}),
        apiKey: maskSecretValue(allConfigs.imageMonitor?.apiKey),
      }
    : (allConfigs.imageMonitor || {});

  return {
    config: allConfigs.config || {},
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
      usage: '当前已关闭日志展示',
      affinity: '当前已关闭日志展示',
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

function attachUsageDisplayFields(entry = {}) {
  return {
    ...entry,
    display_prompt_preview: sanitizeUsagePreviewText(entry.prompt_preview || ''),
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
        timeout: normalizePositiveNumber(aiConfig.imageConfig?.timeout, 60000),
        fallbackReply: aiConfig.imageConfig?.fallbackReply || '',
        fallbackTimeoutReply: aiConfig.imageConfig?.fallbackTimeoutReply || '',
      },
      memeConfig: {
        apiBase: aiConfig.memeConfig?.apiBase || '',
        character: aiConfig.memeConfig?.character || aiConfig.character || '',
        defaultCharacter: identity.recommendedCharacter || '芙宁娜',
        defaultCharacterSource: identity.recommendedCharacterSource,
        personaCardName: identity.personaCardName || '',
        botNickname: identity.botNickname || '芙宁娜',
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
  const apiKey = String(aiConfig.apiKey || '').trim();
  const baseApi = String(aiConfig.baseApi || '').trim();
  const model = String(aiConfig.modelType || '').trim();
  const timeoutMs = normalizePositiveNumber(aiConfig.timeout, 60000);
  
  if (!apiKey || !baseApi || !model) {
    return { success: false, error: 'API 配置不完整，请填写地址、密钥和模型' };
  }
  
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseApi.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 10,
      }),
    });
    
    const latencyMs = Date.now() - startedAt;
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return { success: false, error: `API 返回错误: ${response.status} ${errorText.slice(0, 200)}`, latencyMs };
    }
    
    const data = await response.json();
    const returnedModel = data?.model || model;
    
    return { success: true, model: returnedModel, latencyMs, timeoutMs };
  } catch (error) {
    return { success: false, error: `连接失败: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
  }
}

async function testImageApiConnection() {
  const allConfigs = ConfigControl.get() || {};
  const imageConfig = allConfigs.ai?.imageConfig || {};
  const imageMode = imageConfig.imageMode || 'openai';
  const timeoutMs = normalizePositiveNumber(imageConfig.timeout || allConfigs.ai?.timeout, 60000);
  
  if (imageMode === 'jimeng') {
    const jimengUrl = String(imageConfig.jimengApiUrl || '').trim();
    if (!jimengUrl) {
      return { success: false, error: '即梦接口地址未配置' };
    }
    const startedAt = Date.now();
    try {
      const response = await fetch(jimengUrl, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      const latencyMs = Date.now() - startedAt;
      if (response.ok) {
        return { success: true, detail: `即梦接口响应正常 (${latencyMs}ms)`, latencyMs, timeoutMs };
      }
      return { success: false, error: `即梦接口返回 ${response.status}`, latencyMs, timeoutMs };
    } catch (error) {
      return { success: false, error: `连接失败: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
    }
  }
  
  const baseApi = String(imageConfig.baseApi || allConfigs.ai?.baseApi || '').trim();
  const apiKey = String(imageConfig.apiKey || allConfigs.ai?.apiKey || '').trim();
  const model = String(imageConfig.model || '').trim();
  
  if (!baseApi || !apiKey) {
    return { success: false, error: '图像 API 地址或密钥未配置' };
  }
  
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseApi.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      return { success: true, detail: `API 响应正常 (${latencyMs}ms)${model ? `, 模型: ${model}` : ''}`, latencyMs, timeoutMs };
    }
    return { success: false, error: `API 返回 ${response.status}`, latencyMs, timeoutMs };
  } catch (error) {
    return { success: false, error: `连接失败: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
  }
}

async function testImageMonitorApiConnection() {
  const allConfigs = ConfigControl.get() || {};
  const monitorConfig = allConfigs.imageMonitor || {};
  const timeoutMs = normalizePositiveNumber(monitorConfig.analysisTimeoutMs, 30000);
  
  if (!monitorConfig.enabled) {
    return { success: false, error: '图片监控未启用' };
  }
  
  const baseApi = String(monitorConfig.apiBase || '').trim();
  const apiKey = String(monitorConfig.apiKey || '').trim();
  
  if (!baseApi) {
    return { success: false, error: '图片监控 API 地址未配置' };
  }
  
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseApi.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      return { success: true, detail: `API 响应正常 (${latencyMs}ms)`, latencyMs, timeoutMs };
    }
    return { success: false, error: `API 返回 ${response.status}`, latencyMs, timeoutMs };
  } catch (error) {
    return { success: false, error: `连接失败: ${error.message}`, latencyMs: Date.now() - startedAt, timeoutMs };
  }
}

async function testSearchApiConnection() {
  const allConfigs = ConfigControl.get() || {};
  const searchConfig = allConfigs.coreConfig?.tools?.search || {};
  const timeoutMs = normalizePositiveNumber(searchConfig.timeoutMs, 60000);
  
  if (!searchConfig.enabled) {
    return { success: false, error: '搜索工具未启用' };
  }
  
  const apiKey = String(searchConfig.apiKey || '').trim();
  
  if (!apiKey) {
    return { success: false, error: '搜索 API 密钥未配置' };
  }
  
  return { success: true, detail: `API 密钥已配置（当前超时 ${timeoutMs}ms，实际连接需在运行时验证）`, timeoutMs };
}

async function inspectRemoteMemeImage(url = '') {
  const targetUrl = String(url || '').trim();
  if (!targetUrl) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      latencyMs: 0,
      error: '未解析到远程图片地址',
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - startedAt;
    const contentType = String(response.headers.get('content-type') || '').trim();
    const ok = response.ok && /^image\//i.test(contentType);

    if (response.body && typeof response.body.cancel === 'function') {
      try {
        await response.body.cancel();
      } catch {}
    }

    return {
      ok,
      status: response.status,
      contentType,
      latencyMs,
      error: ok
        ? ''
        : response.ok
          ? `返回内容不是图片: ${contentType || 'unknown'}`
          : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      latencyMs: Date.now() - startedAt,
      error: error.message,
    };
  }
}

function sanitizeMemePathSegment(value = '', fallback = 'default') {
  const sanitized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return sanitized || fallback;
}

function getMemeSavedImageExtension(contentType = '', sourceUrl = '') {
  const normalizedContentType = normalizeImageContentType(contentType);
  if (normalizedContentType === 'image/png') return '.png';
  if (normalizedContentType === 'image/jpeg') return '.jpg';
  if (normalizedContentType === 'image/gif') return '.gif';
  if (normalizedContentType === 'image/webp') return '.webp';

  try {
    const parsed = new URL(String(sourceUrl || ''));
    const ext = path.extname(parsed.pathname || '').toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch {}

  return '.png';
}

function buildMemeSavedFileName(index, extension = '.png') {
  const safeExtension = String(extension || '.png').startsWith('.')
    ? String(extension || '.png')
    : `.${String(extension || 'png')}`;
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `remote-${timestamp}-${String(index).padStart(2, '0')}-${Math.random().toString(36).slice(2, 8)}${safeExtension}`;
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

  const identity = buildBotIdentitySnapshot(allConfigs, mergedMemeConfig);
  const character = resolveRuntimeMemeCharacter(payload.character, allConfigs, mergedMemeConfig);
  const requestedEmotion = String(
    payload.emotion
    || (Array.isArray(mergedMemeConfig.availableEmotions) ? mergedMemeConfig.availableEmotions[0] : '')
    || 'default'
  ).trim() || 'default';
  const fallbackStatuses = [requestedEmotion, 'default'];
  const emotionCandidates = Meme.getEmotionCandidates(requestedEmotion);
  const apiBase = String(mergedMemeConfig.apiBase || '').trim();
  const localRuntime = await Meme.getLocalMemeRuntimeConfig(mergedMemeConfig);
  const localResolved = await Meme.getLocalResolvedMemePath(character, requestedEmotion, fallbackStatuses, mergedMemeConfig);

  let localExists = false;
  if (localResolved.imagePath) {
    try {
      await fs.access(localResolved.imagePath);
      localExists = true;
    } catch {}
  }

  let remoteResolvedUrl = '';
  let remoteResolvedEmotion = '';
  if (apiBase) {
    for (const candidate of emotionCandidates) {
      remoteResolvedUrl = await Meme.getPayloadImageUrl(character, candidate, 1, mergedMemeConfig);
      if (remoteResolvedUrl) {
        remoteResolvedEmotion = candidate;
        break;
      }
    }

    if (!remoteResolvedUrl) {
      remoteResolvedUrl = await Meme.getPayloadImageUrl(character, '', 1, mergedMemeConfig);
      if (remoteResolvedUrl) {
        remoteResolvedEmotion = 'default';
      }
    }
  }

  const remoteCheck = await inspectRemoteMemeImage(remoteResolvedUrl);
  const finalResolved = await Meme.getResolvedMemeUrl(character, requestedEmotion, fallbackStatuses, mergedMemeConfig);
  const remoteUsable = remoteCheck.ok === true;
  const localUsable = localExists === true;

  let detail = '';
  if (remoteUsable && String(finalResolved.source || '').startsWith('remote')) {
    detail = `远程 API 图可用，将优先走远程发送 (${remoteCheck.latencyMs}ms)`;
  } else if (remoteUsable && localUsable && localRuntime.preferLocal) {
    detail = '远程 API 图可用，但当前配置开启了优先本地，实际会先发本地图';
  } else if (!remoteUsable && localUsable) {
    detail = '远程 API 图当前不可用，但本地兜底存在，实际发送仍有机会成功';
  } else if (remoteUsable) {
    detail = `远程 API 图可用 (${remoteCheck.latencyMs}ms)，但未检测到本地兜底`;
  } else if (!apiBase && localUsable) {
    detail = '远程表情 API 未配置，但本地表情包可用';
  } else {
    detail = remoteCheck.error || '远程和本地都没有可用的表情图';
  }

  return {
    success: remoteUsable || localUsable,
    remoteUsable,
    localUsable,
    character,
    defaultCharacter: identity.recommendedCharacter || '芙宁娜',
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
      error: '表情 API 地址未配置',
      detail: '请先填写远程表情 API 地址，再执行拉取',
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
      errors.push(`第 ${index + 1} 张未解析到远程图片地址`);
      continue;
    }

    try {
      const remoteImage = await proxyRemoteImage(resolvedUrl);
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
      errors.push(`第 ${index + 1} 张保存失败: ${error.message}`);
    }
  }

  const success = savedItems.length > 0;
  const detail = success
    ? `已保存 ${savedItems.length}/${requestedCount} 张到本地目录`
    : (errors[0] || '没有成功拉取到可保存的远程表情图');

  return {
    success,
    apiBase,
    character,
    defaultCharacter: identity.recommendedCharacter || '芙宁娜',
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
    warning: localRuntime.enabled ? '' : '本地表情目录当前处于关闭状态，但文件已保存到本地目录',
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
      webConsoleRequireAuth: config.webConsoleRequireAuth === true,
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
  throw new Error('不支持切换该功能');
}

function getManagedFeatureKeys() {
  return ['core', 'poke', '60s', 'zwa', 'rss', 'help', 'welcome', 'faceReply', 'imageMonitor', 'ai', 'music', 'auth', 'autoUpdate'];
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
    enable_all: () => Object.assign(nextConfig, Object.fromEntries(getManagedFeatureKeys().map(key => [key, key === 'imageMonitor' ? true : true]))),
    disable_all: () => Object.assign(nextConfig, Object.fromEntries(getManagedFeatureKeys().map(key => [key, false]))),
    reset: () => Object.assign(nextConfig, buildDefaultManagedFeatureConfig()),
    export_current: async () => ({ message: '已导出当前功能开关', exportText: JSON.stringify(extractManagedFeatureConfig(currentConfig), null, 2) }),
    export_backup: async () => {
      const backup = normalizeFeatureToggleBackup(allConfigs.featureToggleBackup || {});
      return { message: backup.savedAt ? `已导出备份功能开关：${backup.savedAt}` : '已导出备份功能开关', exportText: JSON.stringify(backup.config || {}, null, 2), backup };
    },
    backup: async () => {
      const payload = { savedAt: new Date().toISOString(), config: extractManagedFeatureConfig(currentConfig) };
      await ConfigControl.set('featureToggleBackup', payload);
      return { message: `功能开关已备份：${payload.savedAt}`, backup: payload };
    },
    restore: async () => {
      const backup = normalizeFeatureToggleBackup(allConfigs.featureToggleBackup || {});
      if (!Object.keys(backup.config || {}).length) throw new Error('当前还没有可恢复的功能开关备份');
      Object.assign(nextConfig, backup.config);
      await ConfigControl.set('config', nextConfig);
      return { message: backup.savedAt ? `功能开关已恢复：${backup.savedAt}` : '功能开关已恢复', config: nextConfig };
    },
  };

  if (!actionMap[action]) {
    throw new Error('不支持的功能开关管理动作');
  }

  if (['backup', 'restore', 'export_current', 'export_backup'].includes(action)) {
    return await actionMap[action]();
  }

  actionMap[action]();
  await ConfigControl.set('config', nextConfig);
  return { message: '功能开关操作已完成', config: nextConfig };
}

function buildFeatureToggleHelpMarkdown() {
  return [
    '# 主人功能开关菜单',
    '',
    '> 下面这些命令只给主人用，用来快速开关插件功能。',
    '',
    '## 查看',
    '- #查看功能开关',
    '- #查看已关闭功能',
    '',
    '## 单项开关',
    '- #开启戳一戳 / #关闭戳一戳',
    '- #开启AI / #关闭AI',
    '- #开启欢迎 / #关闭欢迎',
    '',
    '## 批量开关',
    '- #开启全部功能 / #关闭全部功能',
    '- #开启全部AI相关功能 / #关闭全部AI相关功能',
    '- #开启全部群管相关功能 / #关闭全部群管相关功能',
    '- #开启全部内容功能 / #关闭全部内容功能',
    '- #开启全部互动功能 / #关闭全部互动功能',
    '- #开启全部娱乐功能 / #关闭全部娱乐功能',
    '',
    '## 快捷模式',
    '- #只开启AI',
    '- #只保留群管功能',
    '',
    '## 备份管理',
    '- #备份功能开关 / #恢复功能开关',
    '- #导出功能开关 / #导出功能开关备份',
    '- #重置功能开关',
    '',
    '## 提示',
    '- 上面这些命令仅主人可用',
    '- 想先保存当前状态，建议先执行一次 #备份功能开关',
  ].join('\n');
}

async function buildFeatureToggleHelpPreviewPayload() {
  const imagePath = await Renderer.renderMarkdown(buildFeatureToggleHelpMarkdown());
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error('帮助图渲染失败，未生成预览图片');
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
    throw new Error('缺少 sessionId');
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
    throw new Error('缺少 sessionId');
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
        nickname: nickname.trim() || `成员${index + 1}`,
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
        keywords: keywords.trim() || `记忆${index + 1}`,
        data: data.trim() || '',
        createdAt: createdAt.trim() || new Date().toISOString(),
      };
    })
    .filter(item => item.data)
    .slice(-20);
}

function parseSandboxKnowledge(value = '') {
  return String(value || '')
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const [title = `知识片段${index + 1}`, maybeTags = '', ...rest] = lines;
      const hasTagsLine = /^标签[:：]/.test(maybeTags);
      return {
        id: `knowledge-${index + 1}`,
        title,
        tags: (hasTagsLine ? maybeTags.replace(/^标签[:：]/, '').split(/[，,]/) : []).map(item => item.trim()).filter(Boolean),
        content: ((hasTagsLine ? rest : [maybeTags, ...rest]).join('\n').trim()) || title,
      };
    })
    .slice(0, 100);
}

function tokenizeSandboxText(value = '') {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return [];
  const stopWords = new Set(['是谁', '什么', '怎么', '为何', '为什么', '多少', '一下', '一个', '这个', '那个', '一下子']);
  const tokens = new Set();
  const phraseMatches = text.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/g) || [];
  phraseMatches.forEach(token => {
    if (!stopWords.has(token)) tokens.add(token);
  });
  const compact = text.replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  if (/^[\u4e00-\u9fa5]+$/.test(compact) && compact.length >= 2) {
    for (let size = Math.min(4, compact.length); size >= 2; size--) {
      for (let index = 0; index <= compact.length - size; index++) {
        const token = compact.slice(index, index + size);
        if (!stopWords.has(token)) tokens.add(token);
      }
    }
  }
  return Array.from(tokens);
}

function retrieveSandboxKnowledge(query = '', knowledgeItems = [], topK = 3) {
  const queryTokens = tokenizeSandboxText(query);
  if (queryTokens.length === 0 || knowledgeItems.length === 0) {
    return [];
  }
  const requestedTags = String(arguments[3] || '').split(/[，,]/).map(item => item.trim().toLowerCase()).filter(Boolean);
  return knowledgeItems
    .filter(item => requestedTags.length === 0 || (item.tags || []).some(tag => requestedTags.includes(String(tag).toLowerCase())))
    .map(item => {
      const haystack = `${item.title}\n${item.content}`;
      const lowerHaystack = haystack.toLowerCase();
      const lowerTitle = String(item.title || '').toLowerCase();
      const matchedTokens = queryTokens.filter(token => lowerHaystack.includes(token));
      const titleHits = queryTokens.filter(token => lowerTitle.includes(token));
      const exactTitleHit = lowerTitle && String(query || '').toLowerCase().includes(lowerTitle);
      const tagHits = (item.tags || []).filter(tag => queryTokens.some(token => String(tag).toLowerCase().includes(token)));
      return {
        ...item,
        matchedTokens,
        score: matchedTokens.length + titleHits.length * 3 + tagHits.length * 2 + (exactTitleHit ? 10 : 0),
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
    '你可能会用到的知识库片段，请按需使用，如果不相关请忽略：',
    ...matches.map((item, index) => `${index + 1}. 标题:${item.title}\n内容:${item.content}`),
  ].join('\n');
}

async function buildSandboxSystemPrompt(payload = {}, effectiveConfig = {}) {
  const customPrompt = String(payload.systemPrompt || '').trim();
  if (customPrompt) {
    return customPrompt;
  }
  const profileConfig = ConfigControl.get('profile') || {};
  const botName = String(payload.botName || profileConfig.nickName || '芙宁娜').trim() || '芙宁娜';
  const { getSystemPrompt } = await import('../../constants/ai/prompts.js');
  const basePrompt = await getSystemPrompt(botName);
  const userId = String(payload.userId || payload.sessionId || 'webconsole-sandbox').trim() || 'webconsole-sandbox';
  const userName = String(payload.userName || '用户').trim() || '用户';
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
    '以下是当前网页沙箱模拟的上下文信息(仅供你理解对话背景,请勿泄露):',
    '[你的信息]',
    `- 你的昵称：${botName}`,
    `- 你的qq号：${String(payload.botId || '网页沙箱').trim() || '网页沙箱'}`,
    '[跟你对话的用户的信息]',
    `- 他的名字：${userName}`,
    `- 他的qq号(id)：${userId}`,
    `- 他${isMaster ? '是' : '不是'}你的主人`,
    groupId ? `[群聊信息]\n- 当前群号：${groupId}` : '[群聊信息]\n- 当前未指定群号',
    '[环境信息]',
    `现在的Date.now()是:${Date.now()}`,
    `现在的日期是:${now.toLocaleDateString('zh-CN')}`,
    `现在的时间是:${now.toLocaleTimeString('zh-CN')}`,
    contextNote ? `[补充上下文]\n${contextNote}` : '',
  ].filter(Boolean).join('\n');
  if (groupHistory.length > 0) {
    const aiConfig = ConfigControl.get('ai') || {};
    const maxMessageLength = aiConfig?.maxMessageLength || 100;
    contextIntro += '\n[群聊聊天记录(从旧到新)]\n';
    for (const message of groupHistory) {
      if (message.type === 'text') {
        let displayText = message.content;
        if (displayText.length > maxMessageLength) {
          const omittedChars = displayText.length - maxMessageLength;
          displayText = displayText.substring(0, maxMessageLength) + `...(省略${omittedChars}字)`;
        }
        contextIntro += `[${message.userId === String(payload.botId || '网页沙箱') ? '你' : message.nickname},id:${message.userId},seq:${message.seq}]之前说过:${displayText}\n`;
      }
      if (message.type === 'at') {
        if (message.content === String(payload.botId || '网页沙箱')) {
          contextIntro += `[${message.nickname},id:${message.userId},seq:${message.seq}]之前@了你\n`;
        } else {
          contextIntro += `[${message.nickname},id:${message.userId},seq:${message.seq}]之前@了${message.content || '一个人'}\n`;
        }
      }
      if (message.type === 'image') {
        contextIntro += `[${message.nickname},id:${message.userId},seq:${message.seq}]之前发送了一张图片(你可能暂时无法查看)\n`;
      }
    }
  }
  if (memories.length > 0) {
    contextIntro += '你可能会用到的记忆,请按情况使用,如果不合语境请忽略,请结合记忆时间和当前时间智能判断:\n';
    memories.forEach((memory, index) => {
      contextIntro += `${index + 1}. 关键词:${memory.keywords},内容:${memory.data},记忆创建时间:${memory.createdAt}\n`;
    });
  }
  if (knowledgeContext) {
    contextIntro += `\n${knowledgeContext}\n`;
  }
  contextIntro += '请基于以上上下文进行理解,这些信息是当你需要的时候使用的,绝对不能泄露这些信息,也不能主动提起。';
  return `${contextIntro}\n${basePrompt}`;
}

async function buildSandboxPromptPreviewPayload(payload = {}) {
  const { userId, config: effectiveConfig, globalConfig } = await getSandboxEffectiveConfig(payload);
  const systemPrompt = await buildSandboxSystemPrompt(payload, effectiveConfig);
  const knowledgeItems = parseSandboxKnowledge(payload.knowledgeBase);
  const knowledgeMatches = retrieveSandboxKnowledge(String(payload.prompt || ''), knowledgeItems, Number(payload.knowledgeTopK || 3));
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
    throw new Error('网页地址不能为空');
  }
  const result = await fetchWebMarkdown({
    url,
    max_length: payload.maxLength,
    timeout_ms: payload.timeoutMs,
  });
  if (result.success === false) {
    throw new Error(result.error || '网页读取失败');
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
    throw new Error('生成主题不能为空');
  }
  const aiConfig = ConfigControl.get('ai') || {};
  const coreConfig = ConfigControl.get('coreConfig') || {};
  const apiKey = String(aiConfig.apiKey || '').trim();
  const baseApi = String(aiConfig.baseApi || '').trim();
  const model = String(aiConfig.workingModel || aiConfig.modelType || '').trim();
  if (!apiKey || apiKey === 'your-api-key' || apiKey === 'your api key') {
    throw new Error('当前 AI 配置未填写有效 apiKey，无法生成知识库');
  }
  if (!baseApi || !model) {
    throw new Error('当前 AI 配置缺少 baseApi 或 modelType');
  }
  if (!coreConfig?.tools?.search?.enabled) {
    throw new Error('当前未启用联网搜索工具，无法自动生成知识库');
  }

  logger.info(`[knowledge-generate] start query=${JSON.stringify(query)}`);

  const searchResult = await searchWeb({
    query,
    limit: Math.min(Math.max(Number(payload.limit || 5), 1), 5),
    fetch_full: false,
  });
  if (searchResult.success === false) {
    throw new Error(searchResult.error || '联网搜索失败');
  }
  logger.info(`[knowledge-generate] search success count=${Array.isArray(searchResult.results) ? searchResult.results.length : 0}`);
  const searchItems = Array.isArray(searchResult.results) ? searchResult.results.filter(item => item.url) : [];
  if (searchItems.length === 0) {
    throw new Error('没有找到可用于生成知识库的搜索结果');
  }

  const markdownResults = [];
  const markdownEnabled = !!coreConfig?.tools?.search?.markdownApiUrl && !!coreConfig?.tools?.search?.markdownStatusUrl;
  if (markdownEnabled) {
    for (const item of searchItems.slice(0, 2)) {
      try {
        const fetched = await fetchWebMarkdown({
          url: item.url,
          max_length: 4000,
          timeout_ms: 30000,
        });
        if (fetched.success !== false && fetched.markdown) {
          markdownResults.push({ title: item.title, url: item.url, markdown: fetched.markdown });
        }
      } catch {
      }
    }
  }
  logger.info(`[knowledge-generate] markdown success count=${markdownResults.length}`);

  const sourceText = [
    `生成主题：${query}`,
    '### 搜索结果',
    searchResult.summary || '无搜索摘要',
    ...(markdownResults.length > 0 ? ['### 网页正文', ...markdownResults.map((item, index) => `[网页${index + 1}] ${item.title}\n链接: ${item.url}\n${item.markdown}`)] : []),
  ].join('\n\n');

  const response = await fetch(`${baseApi.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      stream: false,
      messages: [
        {
          role: 'system',
          content: [
            '你是一个 RAG 知识库整理助手。',
            '请根据给定的联网搜索结果和网页正文，整理出适合本地 RAG 使用的知识库文本。',
            '输出要求：',
            '1. 只输出最终知识库文本，不要解释，不要加代码块。',
            '2. 每个知识片段之间空一行。',
            '3. 每个片段第一行是标题。',
            '4. 第二行可以是 标签:标签1,标签2 。',
            '5. 后续正文必须简洁、客观、可复用，适合被 AI 检索引用。',
            '6. 不要编造搜索结果里没有的信息。',
            '7. 默认输出 3 到 6 个知识片段。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: sourceText,
        },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `AI 生成失败: ${response.status}`);
  }
  const generatedKnowledgeBase = String(data?.choices?.[0]?.message?.content || '')
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  if (!generatedKnowledgeBase) {
    throw new Error('AI 没有生成有效知识库内容');
  }
  logger.info(`[knowledge-generate] ai success segments=${generatedKnowledgeBase.split(/\r?\n\s*\r?\n/).filter(Boolean).length}`);
  return {
    success: true,
    query,
    generatedKnowledgeBase,
    searchCount: searchItems.length,
    sources: searchItems.map(item => ({ title: item.title, url: item.url, snippet: item.snippet || '' })),
  };
}

async function runSandboxChat(payload = {}) {
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) {
    throw new Error('调试内容不能为空');
  }
  if (prompt.length > 4000) {
    throw new Error('调试内容过长，最多 4000 字');
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
    throw new Error('当前 AI 配置未填写有效 apiKey，无法使用网页沙箱对话');
  }
  if (!baseApi || !model) {
    throw new Error('当前 AI 配置缺少 baseApi 或 modelType');
  }
  const systemPrompt = await buildSandboxSystemPrompt(payload, effectiveConfig);
  const knowledgeItems = parseSandboxKnowledge(payload.knowledgeBase);
  const knowledgeMatches = retrieveSandboxKnowledge(prompt, knowledgeItems, Number(payload.knowledgeTopK || 3), String(payload.knowledgeFilterTags || ''));
  logger.info(`[sandbox-rag-chat] prompt=${JSON.stringify(prompt)} knowledgeBase=${JSON.stringify(String(payload.knowledgeBase || ''))}`);
  logger.info(`[sandbox-rag-chat] knowledgeItems=${JSON.stringify(knowledgeItems)}`);
  logger.info(`[sandbox-rag-chat] queryTokens=${JSON.stringify(tokenizeSandboxText(prompt))}`);
  logger.info(`[sandbox-rag-chat] knowledgeMatches=${JSON.stringify(knowledgeMatches)}`);
  const startedAt = Date.now();
  const ai = {
    async complete({ messages, tools, temperature: innerTemp, scene, sessionId: sid, groupId, userId: uid }) {
      const response = await fetch(`${baseApi.replace(/\/$/, '')}/chat/completions`, {
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
        throw new Error(`模型接口请求失败：${response.status} ${rawText.slice(0, 300)}`);
      }
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        throw new Error('模型接口返回了不可解析的响应');
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
    userName: String(payload.userName || '网页调试用户').trim() || '网页调试用户',
    userRole: 'member',
    userTitle: '',
    content: prompt,
    timestamp: Date.now(),
    messageId: `sandbox-${Date.now()}`,
  };

  const promptCtx = {
    config: effectiveConfig,
    isGroup: Boolean(payload.groupId),
    groupName: String(payload.groupName || '网页调试群').trim() || '网页调试群',
    memberCount: Number(payload.memberCount || 0) || undefined,
    botRole: 'member',
    botNickname: String(payload.botName || ConfigControl.get('profile')?.nickName || '芙宁娜').trim() || '芙宁娜',
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
    plannerThoughts: '',
    reviewMessages: [],
  };

  const sandboxDefaultModel = String(effectiveConfig?.tools?.tts?.defaultModel || '').trim();

  const toolCtx = {
    sessionId,
    groupId: String(payload.groupId || '').trim(),
    userId,
    promptCtx,
    targetMessage,
    defaultVoiceModel: sandboxDefaultModel,
    config: effectiveConfig,
    pendingImageUrls: [],
    voiceMessages: [],
  };

  const emojiAgent = new EmojiAgent(null, effectiveConfig, {
    getMessages() {
      return [];
    },
  });

  const humanize = {
    emojiAgent,
  };

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
    throw new Error('模型未返回有效文本内容');
  }

  return {
    success: true,
    sessionId,
    reply: String(reply),
    usage: {},
    rawResponse: JSON.stringify(result || {}, null, 2),
    systemPrompt,
    note: '当前为网页沙箱对话，仅在控制台内返回结果，不会发送到群，也不会写入真实会话。',
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
      userName: String(payload.userName || '用户').trim() || '用户',
      botName: String(payload.botName || ConfigControl.get('profile')?.nickName || '芙宁娜').trim() || '芙宁娜',
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
  if (!targetPath.startsWith(PUBLIC_DIR)) {
    sendText(res, 'Forbidden', 403);
    return;
  }
  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    sendText(res, 'Not Found', 404);
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const consoleProtected = isWebConsoleAccessProtected();
  if (ext === '.html' && resolvedPathname !== '/login.html' && consoleProtected && !isAuthorized(req)) {
    const redirectTarget = normalizeWebConsoleRedirectPath(`${pathname}${url.search || ''}`);
    sendRedirect(res, `/login.html?redirect=${encodeURIComponent(redirectTarget)}`);
    return;
  }
  if (ext === '.html' && resolvedPathname === '/login.html' && consoleProtected && isAuthorized(req)) {
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
  sendText(res, fs.readFileSync(targetPath, 'utf8'), 200, mimeMap[ext] || 'text/plain; charset=utf-8');
}

function createHandler() {
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/console-background-image') {
      try {
        return await serveConsoleBackgroundImage(res);
      } catch (error) {
        logger.warn(`[webConsole] 本地背景加载失败: ${error.message}`);
        return sendText(res, 'Background image unavailable', 503);
      }
    }
    if (url.pathname === '/api/auth/status') {
      return sendJson(res, buildAuthStatusPayload(req));
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const result = await loginWebConsole(req);
        return sendJson(res, result.payload, 200, result.headers);
      } catch (error) {
        return sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 401));
      }
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      return sendJson(res, { success: true }, 200, {
        'Set-Cookie': buildWebConsoleAuthCookieClearHeader(),
      });
    }
    if (url.pathname.startsWith('/api/') && !requireAuth(req, res)) {
      return;
    }
    if (url.pathname === '/api/overview') {
      return sendJson(res, buildOverviewPayload());
    }
    if (url.pathname === '/api/health') {
      return sendJson(res, buildHealthPayload());
    }
    if (url.pathname === '/api/dependencies/install' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
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
        return sendJson(res, { success: false, error: '未找到图片监控日志详情' }, 404);
      }
      return sendJson(res, payload);
    }
    if (url.pathname === '/api/image-proxy') {
      const targetUrl = String(url.searchParams.get('url') || '').trim();
      if (!targetUrl) {
        return sendJson(res, { success: false, error: '缺少图片地址' }, 400);
      }
      if (!/^https?:\/\//i.test(targetUrl)) {
        return sendJson(res, { success: false, error: '仅支持 http 或 https 图片地址' }, 400);
      }
      try {
        const result = await proxyRemoteImage(targetUrl);
        return sendBinary(res, result.buffer, 200, {
          'Content-Type': result.contentType,
          'Content-Length': result.buffer.length,
          'Access-Control-Allow-Origin': '*',
        });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 502);
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
        return sendJson(res, { success: false, error: '未找到日志详情' }, 404);
      }
      return sendJson(res, payload);
    }
    if (url.pathname === '/api/logs/affinity/detail') {
      const entryId = url.searchParams.get('id');
      const payload = findAffinityLogEntry(entryId);
      if (!payload) {
        return sendJson(res, { success: false, error: '未找到日志详情' }, 404);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
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
        const body = await readJsonBody(req);
        return sendJson(res, await buildLocalMemeScanPayload(body));
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/api-settings/meme-pull' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        deleteHelpDiyImage(body?.url);
        return sendJson(res, { success: true });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/config/save' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const saved = await saveEditableConfig(body);
        return sendJson(res, { success: true, data: saved });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/plugin-settings/save' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const saved = await savePluginSettings(body);
        return sendJson(res, { success: true, data: saved });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/plugin-settings/feature-manage' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        const result = await manageFeatureToggle(String(body?.action || ''));
        return sendJson(res, { success: true, data: result, settings: await buildPluginSettingsPayload(), overview: buildOverviewPayload() });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        if (!body.feature || typeof body.enabled !== 'boolean') {
          return sendJson(res, { success: false, error: '缺少 feature 或 enabled' }, 400);
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
        return sendJson(res, { success: false, error: '未找到画像详情' }, 404);
      }
      return sendJson(res, payload);
    }
    if (url.pathname === '/api/session-debug') {
      const sessionId = url.searchParams.get('sessionId');
      const userId = url.searchParams.get('userId');
      const payload = buildSessionDebugPayload(sessionId, userId);
      if (!payload) {
        return sendJson(res, { success: false, error: '未找到会话调试数据' }, 404);
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
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        if (!body.groupId || !body.userId) {
          return sendJson(res, { success: false, error: '缺少 groupId 或 userId' }, 400);
        }
        resetAffinityRecord(body.groupId, body.userId);
        return sendJson(res, { success: true });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/profiles/delete' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        if (!body.sessionId || !body.userId) {
          return sendJson(res, { success: false, error: '缺少 sessionId 或 userId' }, 400);
        }
        deleteUserProfile(body.sessionId, body.userId);
        return sendJson(res, { success: true });
      } catch (error) {
        return sendJson(res, { success: false, error: error.message }, 500);
      }
    }
    if (url.pathname === '/api/sessions/reset' && req.method === 'POST') {
      if (getWebConsoleConfig().readOnly) {
        return sendJson(res, { success: false, error: '当前为只读模式，禁止写操作' }, 403);
      }
      try {
        const body = await parseRequestBody(req);
        if (!body.sessionId) {
          return sendJson(res, { success: false, error: '缺少 sessionId' }, 400);
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
  logger.info(`[webConsole] 本地控制台已启动: ${info.url}`);
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
