import fs from 'fs/promises';
import path from 'path';

const root = process.cwd();
const defaultConfigPath = path.join(root, 'config', 'config.json');
const runtimeConfigPath = path.join(
  process.env.CRYSTELF_DATA_DIR ? path.resolve(process.env.CRYSTELF_DATA_DIR) : path.resolve(root, '..', '..', 'data', 'crystelf'),
  'config.json',
);
const requestTimeoutMs = Math.max(1000, Number(process.env.WEB_CONSOLE_SMOKE_TIMEOUT_MS || 8000) || 8000);
const cookieJar = new Map();

const protectedPages = [
  { path: '/index.html', text: '魔丸控制台' },
  { path: '/dependency-check.html', text: '依赖健康面板' },
  { path: '/file-browser.html', text: '文件浏览编辑器' },
  { path: '/plugin-settings.html', text: '插件设置中心' },
  { path: '/bot-plugins.html', text: '机器人插件管理' },
  { path: '/group-management.html', text: '群管理' },
  { path: '/qq-simulator.html', text: '模拟调试' },
];

const apiChecks = [
  {
    path: '/api/auth/status',
    label: '登录状态',
    validate: data => data && data.success === true && typeof data.loginConfigured === 'boolean',
  },
  {
    path: '/api/overview',
    label: '首页总览',
    validate: data => data?.plugin && data?.runtime,
  },
  {
    path: '/api/health',
    label: '健康检查',
    validate: data => data?.summary && Array.isArray(data?.issues),
  },
  {
    path: '/api/tasks',
    label: '任务中心',
    validate: data => data?.success === true && Array.isArray(data?.tasks),
  },
];

function logPass(message) {
  console.log(`✓ ${message}`);
}

function logSkip(message) {
  console.log(`- 跳过：${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function readLocalConfig() {
  return {
    ...((await readJsonFile(defaultConfigPath)) || {}),
    ...((await readJsonFile(runtimeConfigPath)) || {}),
  };
}

function formatHostForUrl(host = '') {
  const value = String(host || '').trim();
  if (!value || value === '0.0.0.0') return '127.0.0.1';
  if (value === '::') return '[::1]';
  if (value.includes(':') && !value.startsWith('[')) return `[${value}]`;
  return value;
}

function normalizeBaseUrl(value = '') {
  const url = new URL(String(value || '').trim());
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function getSmokeToken(config = {}) {
  return String(
    process.env.WEB_CONSOLE_SMOKE_TOKEN
    || process.env.WEB_CONSOLE_TOKEN
    || config.webConsoleToken
    || '',
  ).trim();
}

function splitSetCookieHeader(value = '') {
  return String(value || '')
    .split(/,(?=\s*[^;,]+=)/)
    .map(item => item.trim())
    .filter(Boolean);
}

function storeResponseCookies(response) {
  const setCookieHeaders = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : splitSetCookieHeader(response.headers.get('set-cookie') || '');

  for (const header of setCookieHeaders) {
    const cookiePair = String(header || '').split(';', 1)[0];
    const index = cookiePair.indexOf('=');
    if (index <= 0) continue;

    const name = cookiePair.slice(0, index).trim();
    const value = cookiePair.slice(index + 1).trim();
    if (!name) continue;

    if (/;\s*max-age=0(?:;|$)/i.test(header)) {
      cookieJar.delete(name);
    } else {
      cookieJar.set(name, value);
    }
  }
}

function getCookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function request(baseUrl, pathname, options = {}) {
  const url = new URL(pathname, baseUrl);
  const headers = {
    Accept: options.accept || '*/*',
    'User-Agent': 'crystelf-webconsole-smoke/1.0',
    ...(options.headers || {}),
  };
  const cookie = getCookieHeader();
  if (cookie) {
    headers.Cookie = cookie;
  }

  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.Origin = baseUrl.origin;
    headers.Referer = new URL('/login.html', baseUrl).href;
  }

  const response = await fetch(url, {
    ...options,
    method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  storeResponseCookies(response);
  return response;
}

async function readJsonResponse(response, pathname) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    fail(`${pathname} 返回 HTTP ${response.status}${data?.error ? `：${data.error}` : ''}`);
  }
  return data;
}

async function fetchText(baseUrl, pathname) {
  const response = await request(baseUrl, pathname, { accept: 'text/html,*/*' });
  if (response.status !== 200) {
    const location = response.headers.get('location');
    fail(`${pathname} 返回 HTTP ${response.status}${location ? `，跳转到 ${location}` : ''}`);
  }
  return await response.text();
}

function collectStaticResources(html = '', baseUrl) {
  const resources = new Set();
  const pattern = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = String(match[1] || '').trim();
    if (!raw || raw.startsWith('#') || /^data:/i.test(raw)) {
      continue;
    }

    const url = new URL(raw, baseUrl);
    if (url.origin !== baseUrl.origin) {
      continue;
    }

    const ext = path.posix.extname(url.pathname).toLowerCase();
    if (ext === '.css' || ext === '.js' || ext === '.mjs') {
      resources.add(`${url.pathname}${url.search || ''}`);
    }
  }
  return resources;
}

async function login(baseUrl, token) {
  const response = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    accept: 'application/json',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ token }),
  });
  const data = await readJsonResponse(response, '/api/auth/login');
  if (data?.authorized !== true) {
    fail('/api/auth/login 没有返回已登录状态');
  }
  logPass('控制台登录成功');
}

async function checkApi(baseUrl, check) {
  const response = await request(baseUrl, check.path, { accept: 'application/json' });
  const data = await readJsonResponse(response, check.path);
  if (!check.validate(data)) {
    fail(`${check.path} 返回结构不符合预期`);
  }
  logPass(`${check.label}接口正常`);
}

async function checkProtectedPages(baseUrl) {
  const resources = new Set();
  for (const page of protectedPages) {
    const html = await fetchText(baseUrl, page.path);
    if (!html.includes(page.text)) {
      fail(`${page.path} 未找到关键文案：${page.text}`);
    }
    collectStaticResources(html, baseUrl).forEach(item => resources.add(item));
    logPass(`${page.path} 页面可访问`);
  }

  for (const resource of resources) {
    const response = await request(baseUrl, resource);
    if (response.status !== 200) {
      fail(`${resource} 静态资源返回 HTTP ${response.status}`);
    }
  }
  logPass(`静态资源可访问：${resources.size} 个`);
}

async function main() {
  const config = await readLocalConfig();
  const configuredPort = Math.min(65535, Math.max(1, Number(config.webConsolePort || 27891) || 27891));
  const defaultBase = `http://${formatHostForUrl(config.webConsoleHost || '127.0.0.1')}:${configuredPort}/`;
  const baseUrl = normalizeBaseUrl(process.env.WEB_CONSOLE_SMOKE_URL || process.env.WEB_CONSOLE_URL || defaultBase);
  const token = getSmokeToken(config);

  console.log(`控制台 smoke test：${baseUrl.origin}`);

  let authStatus;
  try {
    const loginHtml = await fetchText(baseUrl, '/login.html');
    if (!loginHtml.includes('魔丸控制台') || !loginHtml.includes('登录口令')) {
      fail('/login.html 未找到登录页关键文案');
    }
    logPass('/login.html 页面可访问');

    const response = await request(baseUrl, '/api/auth/status', { accept: 'application/json' });
    authStatus = await readJsonResponse(response, '/api/auth/status');
    logPass('登录状态接口可访问');
  } catch (error) {
    fail(`控制台连接失败：${error.message}。请确认控制台已启动，或通过 WEB_CONSOLE_SMOKE_URL 指定地址。`);
  }

  if (authStatus?.authorized !== true && authStatus?.loginConfigured === true) {
    if (!token) {
      fail('控制台需要登录，但没有找到口令。请设置 WEB_CONSOLE_SMOKE_TOKEN，或确认 config/config.json 已写入 webConsoleToken。');
    }
    await login(baseUrl, token);
  }

  if (authStatus?.bootstrapMode === true) {
    const html = await fetchText(baseUrl, '/plugin-settings.html?bootstrap=1');
    if (!html.includes('插件设置中心')) {
      fail('/plugin-settings.html?bootstrap=1 未找到初始化页关键文案');
    }
    logPass('初始化设置页可访问');
    logSkip('当前处于首次初始化模式，暂不检查需要完整登录会话的页面');
  } else {
    for (const check of apiChecks) {
      await checkApi(baseUrl, check);
    }
    await checkProtectedPages(baseUrl);
  }

  console.log('控制台 smoke test 通过');
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
