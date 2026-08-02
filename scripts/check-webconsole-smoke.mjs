import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const root = process.cwd();
const defaultConfigPath = path.join(root, 'config', 'config.json');
const requestTimeoutMs = Math.max(1000, Number(process.env.WEB_CONSOLE_SMOKE_TIMEOUT_MS || 8000) || 8000);
const cookieJar = new Map();
let csrfToken = '';

const protectedPages = [
  { path: '/index.html', text: '魔丸控制台' },
  { path: '/dependency-check.html', text: '依赖健康面板' },
  { path: '/file-browser.html', text: '文件浏览编辑器' },
  { path: '/plugin-settings.html', text: '插件设置中心' },
  { path: '/config-diagnostics.html', text: '配置来源诊断' },
  { path: '/frontend-diagnostics.html', text: '前端错误诊断' },
  { path: '/group-summary-diagnostics.html', text: '群总结诊断' },
  { path: '/bot-plugins.html', text: '机器人插件管理' },
  { path: '/group-management.html', text: '群管理' },
  { path: '/qq-simulator.html', text: '模拟调试' },
  { path: '/command-center.html', text: '命令中心' },
  { path: '/agent-workbench.html', text: 'Agent 工作台' },
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
  {
    path: '/api/command-center',
    label: '命令中心',
    validate: data => data?.success === true
      && Array.isArray(data?.data?.commands)
      && data?.data?.summary
      && Array.isArray(data?.data?.risks)
      && data?.data?.bridge?.config
      && Array.isArray(data?.data?.bridge?.commands),
  },
  {
    path: '/api/command-center/bridge',
    label: '命令桥接安全默认值保存',
    method: 'POST',
    body: {
      enabled: false,
      confirmationTimeoutMs: 60000,
      maxCommandLength: 200,
      policies: [],
    },
    validate: data => data?.success === true
      && data?.data?.config?.enabled === false
      && Array.isArray(data?.data?.config?.policies),
  },
  {
    path: '/api/agent-workbench',
    label: 'Agent 工作台',
    validate: data => data?.success === true
      && data?.data?.config
      && Array.isArray(data?.data?.providers)
      && Array.isArray(data?.data?.workspaces)
      && Array.isArray(data?.data?.tasks),
  },
  {
    path: '/api/agent-workbench/stats',
    label: 'Agent 用量统计',
    validate: data => data?.success === true
      && data?.stats
      && typeof data.stats.taskCount === 'number'
      && data.stats.usage
      && typeof data.stats.usage.total === 'number',
  },
  {
    path: '/api/agent-workbench/settings',
    label: 'Agent 工作台安全默认值保存',
    method: 'POST',
    body: {
      enabled: false,
      defaultProvider: 'opencode',
      timeoutMs: 300000,
      maxConcurrentTasks: 1,
      providers: { opencode: true },
      customApi: { enabled: false, baseApi: '', apiKey: '', model: '', userAgent: '' },
      writeEnabled: false,
      allowNetwork: false,
      allowAllDirectories: false,
      writableWorkspaces: { plugin: true, plugins: false, yunzai: false },
    },
    validate: data => data?.success === true
      && data?.data?.config?.enabled === false
      && data?.data?.config?.writeEnabled === false
      && data?.data?.config?.maxConcurrentTasks === 1,
  },
  {
    path: '/api/agent-workbench/settings',
    label: 'Agent 自定义 API 保存与密钥脱敏',
    method: 'POST',
    body: {
      enabled: false,
      defaultProvider: 'opencode',
      timeoutMs: 300000,
      maxConcurrentTasks: 1,
      providers: { opencode: true },
      customApi: {
        enabled: true,
        baseApi: 'https://agent-smoke.example.com/v1',
        apiKey: 'agent-smoke-secret',
        model: 'agent-smoke-model',
        userAgent: 'crystelf-agent-smoke',
      },
      writeEnabled: false,
      allowNetwork: false,
      allowAllDirectories: false,
      writableWorkspaces: { plugin: true, plugins: false, yunzai: false },
    },
    validate: data => data?.success === true
      && data?.data?.config?.customApi?.enabled === true
      && data?.data?.config?.customApi?.baseApi === 'https://agent-smoke.example.com/v1'
      && data?.data?.config?.customApi?.apiKey === '已配置'
      && !JSON.stringify(data).includes('agent-smoke-secret'),
  },
  {
    path: '/api/global-search?q=命令&limit=8',
    label: '全局搜索',
    validate: data => data?.success === true
      && Array.isArray(data?.data?.items)
      && data?.data?.summary
      && data?.data?.sourceSummary,
  },
  {
    path: '/api/group-summary/diagnostics',
    label: '群总结诊断',
    validate: data => data?.success === true
      && data?.data?.summary
      && Array.isArray(data?.data?.groups)
      && Array.isArray(data?.data?.recommendations),
  },
  {
    path: '/api/config/diagnostics',
    label: '配置来源诊断',
    validate: data => data?.success === true
      && data?.data?.summary
      && Array.isArray(data?.data?.allFiles)
      && Array.isArray(data?.data?.effectiveFields),
  },
  {
    path: '/api/api-settings/test-target',
    label: 'API 单项草稿测试',
    method: 'POST',
    body: {
      target: 'ai-main',
      role: 'fallback',
      payload: {
        ai: {
          fallbackApi: {
            enabled: false,
          },
        },
      },
    },
    validate: data => data?.target === 'ai-main'
      && data?.role === 'fallback'
      && data?.configSource === 'draft'
      && typeof data?.error === 'string',
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

function getRuntimeConfigPath() {
  return path.join(
    process.env.CRYSTELF_DATA_DIR ? path.resolve(process.env.CRYSTELF_DATA_DIR) : path.resolve(root, '..', '..', 'data', 'crystelf'),
    'config.json',
  );
}

async function readLocalConfig() {
  return {
    ...((await readJsonFile(defaultConfigPath)) || {}),
    ...((await readJsonFile(getRuntimeConfigPath())) || {}),
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
    if (csrfToken) {
      headers['X-Crystelf-CSRF'] = csrfToken;
    }
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
  csrfToken = String(data.csrfToken || '').trim();
  logPass('控制台登录成功');
}

async function checkApi(baseUrl, check) {
  const requestOptions = { accept: 'application/json' };
  if (check.method) {
    requestOptions.method = check.method;
  }
  if (check.body !== undefined) {
    requestOptions.headers = { 'Content-Type': 'application/json; charset=utf-8' };
    requestOptions.body = JSON.stringify(check.body);
  }
  const response = await request(baseUrl, check.path, requestOptions);
  const data = await readJsonResponse(response, check.path);
  if (!check.validate(data)) {
    fail(`${check.path} 返回结构不符合预期`);
  }
  logPass(`${check.label}接口正常`);
}

function getIsolatedSmokeToken() {
  return String(process.env.WEB_CONSOLE_SMOKE_TOKEN || 'crystelf-smoke-token').trim();
}

async function startIsolatedWebConsole() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crystelf-webconsole-smoke-'));
  const token = getIsolatedSmokeToken();
  const preferredPort = Math.min(65535, Math.max(1, Number(process.env.WEB_CONSOLE_SMOKE_PORT || 27991) || 27991));
  await fs.writeFile(path.join(dataDir, 'config.json'), `${JSON.stringify({
    webConsole: true,
    webConsoleToken: token,
    webConsoleReadOnly: false,
    webConsoleHost: '127.0.0.1',
    webConsolePort: preferredPort,
    webConsolePortAutoIncrement: true,
  }, null, 2)}\n`, 'utf8');

  process.env.CRYSTELF_DATA_DIR = dataDir;
  globalThis.logger = {
    info: (...args) => console.log('[info]', ...args),
    warn: (...args) => console.log('[warn]', ...args),
    error: (...args) => console.error('[error]', ...args),
    mark: (...args) => console.log('[mark]', ...args),
  };

  const ConfigControl = (await import('../lib/config/configControl.js')).default;
  const { startWebConsole, stopWebConsole } = await import('../lib/webConsole/server.js');
  await ConfigControl.init();
  const info = await startWebConsole();
  if (!info?.url) {
    throw new Error('隔离控制台启动失败，没有返回访问地址');
  }
  return {
    baseUrl: normalizeBaseUrl(info.url),
    token,
    dataDir,
    ConfigControl,
    stopWebConsole,
  };
}

async function cleanupIsolatedWebConsole(isolated) {
  if (!isolated) return;
  try {
    await isolated.stopWebConsole?.();
  } catch (error) {
    logSkip(`隔离控制台关闭失败：${error.message}`);
  }
  try {
    isolated.ConfigControl?.closeWatchers?.();
  } catch (error) {
    logSkip(`配置 watcher 关闭失败：${error.message}`);
  }
  try {
    await fs.rm(isolated.dataDir, { recursive: true, force: true });
  } catch (error) {
    logSkip(`临时目录清理失败：${error.message}`);
  }
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

async function runSmokeChecks(baseUrl, token) {

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
    csrfToken = String(authStatus?.csrfToken || '').trim();
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

async function main() {
  const externalUrl = process.env.WEB_CONSOLE_SMOKE_URL || process.env.WEB_CONSOLE_URL || '';
  let isolated = null;
  try {
    if (externalUrl) {
      const config = await readLocalConfig();
      const baseUrl = normalizeBaseUrl(externalUrl);
      await runSmokeChecks(baseUrl, getSmokeToken(config));
      return;
    }

    isolated = await startIsolatedWebConsole();
    await runSmokeChecks(isolated.baseUrl, isolated.token);
  } finally {
    await cleanupIsolatedWebConsole(isolated);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error?.message || error);
    process.exit(1);
  });
