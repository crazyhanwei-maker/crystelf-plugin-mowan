import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { withPuppeteerPage, closeSharedPuppeteerBrowser } from '../lib/system/puppeteerRenderer.js';

const root = process.cwd();
const outputDir = path.join(root, 'temp', 'html', 'crystelf-plugin', 'webconsole-e2e');
const pageTimeoutMs = Math.max(5000, Number(process.env.WEB_CONSOLE_E2E_TIMEOUT_MS || 18000) || 18000);
const interactionTimeoutMs = Math.max(5000, Number(process.env.WEB_CONSOLE_E2E_INTERACTION_TIMEOUT_MS || 25000) || 25000);
const cliArgs = new Set(process.argv.slice(2));
const shouldRunDesktop = !cliArgs.has('--mobile-only');
const shouldRunMobile = !cliArgs.has('--desktop-only');

const pages = [
  { path: '/index.html', label: '总览', text: '魔丸控制台' },
  { path: '/plugin-settings.html', label: '插件设置', text: '灵晶设置' },
  { path: '/system-settings.html', label: '系统设置', text: '系统设置' },
  { path: '/api-settings.html', label: 'API 接口', text: 'API' },
  { path: '/config-diagnostics.html', label: '配置诊断', text: '配置来源诊断' },
  { path: '/frontend-diagnostics.html', label: '前端诊断', text: '前端错误诊断' },
  { path: '/group-summary-diagnostics.html', label: '群总结诊断', text: '群总结诊断' },
  { path: '/performance.html', label: '性能监测', text: '性能监测' },
  { path: '/group-management.html', label: '群管理', text: '群管理' },
  { path: '/qq-simulator.html', label: '模拟调试', text: '请求摘要', mobileText: '事件参数、附件与排查' },
  { path: '/command-center.html', label: '命令中心', text: '命令中心' },
  { path: '/agent-workbench.html', label: 'Agent 工作台', text: 'Agent 工作台' },
  { path: '/memory-center.html', label: '记忆与人设', text: '记忆与人设中心' },
  { path: '/data-insight.html', label: '数据洞察', text: '数据洞察中心' },
  { path: '/file-browser.html', label: '文件编辑', text: '文件管理' },
  { path: '/bot-plugins.html', label: '插件管理', text: '机器人插件管理' },
  { path: '/dependency-check.html', label: '依赖健康', text: '依赖健康面板' },
  { path: '/sandbox-chat.html', label: '对话测试', text: '网页对话测试' },
  { path: '/dataflow.html', label: '适配器数据流', text: '适配器数据流' },
];

const mobileViewports = [
  {
    label: '手机竖屏',
    slug: 'mobile-portrait',
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  },
  {
    label: '手机横屏',
    slug: 'mobile-landscape',
    viewport: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  },
];

function fail(message) {
  throw new Error(message);
}

function logPass(message) {
  console.log(`✓ ${message}`);
}

function logSkip(message) {
  console.log(`- 跳过：${message}`);
}

function normalizeBaseUrl(value = '') {
  const url = new URL(String(value || '').trim());
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function sanitizeFilename(value = '') {
  return String(value || 'page')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || 'page';
}

function getIsolatedToken() {
  return String(process.env.WEB_CONSOLE_E2E_TOKEN || 'crystelf-e2e-token').trim();
}

function shouldIgnoreUrl(url = '') {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.pathname === '/favicon.ico';
  } catch {
    return false;
  }
}

function shouldIgnoreRequestFailure(errorText = '') {
  return /net::ERR_ABORTED/i.test(String(errorText || ''));
}

function shouldIgnoreFrontendErrorItem(error = {}) {
  const message = String(error?.message || '');
  return /Host key verification failed|Could not read from remote repository|known_hosts.*Permission denied|unable to access ['"]?https:\/\/gitee\.com\/.*(?:schannel|AcquireCredentialsHandle|SEC_E_NO_CREDENTIALS|SSL|TLS|credential)/i.test(message);
}

async function startIsolatedWebConsole() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crystelf-webconsole-e2e-'));
  const token = getIsolatedToken();
  const preferredPort = Math.min(65535, Math.max(1, Number(process.env.WEB_CONSOLE_E2E_PORT || 27992) || 27992));
  const previousDataDir = process.env.CRYSTELF_DATA_DIR;

  await fs.writeFile(path.join(dataDir, 'config.json'), `${JSON.stringify({
    webConsole: true,
    webConsoleToken: token,
    webConsoleReadOnly: false,
    webConsoleExposeLogs: true,
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
    previousDataDir,
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
  if (isolated.previousDataDir === undefined) {
    delete process.env.CRYSTELF_DATA_DIR;
  } else {
    process.env.CRYSTELF_DATA_DIR = isolated.previousDataDir;
  }
  try {
    await fs.rm(isolated.dataDir, { recursive: true, force: true });
  } catch (error) {
    logSkip(`临时目录清理失败：${error.message}`);
  }
}

async function ensureLoggedIn(page, baseUrl, token) {
  const loginUrl = new URL('/login.html', baseUrl).href;
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
  await page.waitForSelector('body', { timeout: pageTimeoutMs });
  // 登录页品牌在桌面宽度由 CSS 隐藏，innerText 取不到；用 textContent 判断 DOM 文案
  const loginText = await page.evaluate(() => document.body?.textContent || '');
  if (!loginText.includes('魔丸控制台') || !loginText.includes('登录口令')) {
    fail('/login.html 未找到登录页关键文案');
  }

  const result = await page.evaluate(async loginToken => {
    const readJson = async response => {
      try {
        return await response.json();
      } catch {
        return {};
      }
    };
    const statusResponse = await fetch('/api/auth/status', {
      credentials: 'include',
      cache: 'no-store',
    });
    const status = await readJson(statusResponse);
    if (status?.authorized === true || status?.loginConfigured !== true) {
      return status;
    }
    const loginResponse = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ token: loginToken }),
    });
    return await readJson(loginResponse);
  }, token);

  if (result?.loginConfigured === true && result?.authorized !== true) {
    fail('控制台登录失败，无法执行浏览器级 E2E 检查。');
  }
  if (result?.bootstrapMode === true) {
    fail('隔离控制台进入首次初始化模式，未能使用测试口令登录。');
  }
  logPass('浏览器登录成功');
  return result;
}

async function checkCircuitResetApi(page, csrfToken = '') {
  const result = await page.evaluate(async token => {
    const response = await fetch('/api/performance/api-circuit/reset', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(token ? { 'X-Crystelf-CSRF': token } : {}),
      },
      body: JSON.stringify({ all: true }),
    });
    const data = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  }, csrfToken);

  if (!result.ok || result.data?.success !== true || typeof result.data?.resetCount !== 'number') {
    fail(`/api/performance/api-circuit/reset 返回异常：HTTP ${result.status} ${result.data?.error || ''}`.trim());
  }
  logPass('API 主备复位接口正常');
}

async function waitForText(page, selector, matcher, timeout = pageTimeoutMs) {
  await page.waitForFunction((targetSelector, expected) => {
    const element = document.querySelector(targetSelector);
    const text = element?.innerText || element?.textContent || element?.value || '';
    if (expected.startsWith('/') && expected.endsWith('/')) {
      return new RegExp(expected.slice(1, -1)).test(text);
    }
    return text.includes(expected);
  }, { timeout }, selector, String(matcher || ''));
}

async function setInputValue(page, selector, value = '') {
  await page.waitForSelector(selector, { timeout: pageTimeoutMs });
  await page.evaluate((targetSelector, nextValue) => {
    const element = document.querySelector(targetSelector);
    if (!element) return;
    element.focus?.();
    element.value = nextValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, String(value || ''));
}

async function clickAndWait(page, selector, delayMs = 500) {
  await page.waitForSelector(selector, { timeout: pageTimeoutMs });
  await page.click(selector);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

// 本地假供应商：验证「获取模型」确实请求了 Base URL 的 /v1/models
async function withFakeModelProvider(run) {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'e2e-model-b' }, { id: 'e2e-model-a' }] }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function resetFrontendErrorCollector(page) {
  await page.evaluate(() => {
    window.CrystelfFrontendErrors?.reset?.();
  }).catch(() => {});
}

async function readFrontendErrors(page) {
  return await Promise.race([
    page.evaluate(() => {
      const summary = window.CrystelfFrontendErrors?.getSummary?.() || { recentCount: 0, recentItems: [] };
      const recentItems = (summary.recentItems || []).slice(0, 8).map(error => ({
          kind: error.kind,
          message: error.message,
          url: error.url,
          status: error.status,
          code: error.code,
        }));
      return {
        recentCount: recentItems.length,
        recentItems,
      };
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('读取前端错误状态超时')), 5000);
    }),
  ]).catch(error => ({
    recentCount: 1,
    recentItems: [{ kind: 'e2e', message: error.message || String(error) }],
  }));
}

// 本轮移动端修复的针对性断言：仅在窄屏（<=760px）生效，避免横屏误报。
// 元素不存在时跳过（面板/浮动条按页面状态懒渲染）。
async function readMobileFixProbes(page) {
  return await page.evaluate(() => {
    if (window.innerWidth > 760) return [];
    const checks = [];
    const push = (label, ok, detail = '') => checks.push({ label, ok, detail });
    const path = location.pathname;

    if (path.endsWith('/bot-plugins.html')) {
      const grid = document.querySelector('.plugin-catalog-install-grid');
      if (grid) {
        const columns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
        push('插件安装表单小屏单列', columns.length === 1, `columns=${columns.join(' ')}`);
      }
      const bar = document.querySelector('.plugin-catalog-floating-bar');
      const install = document.querySelector('.plugin-catalog-floating-install');
      const close = document.querySelector('.plugin-catalog-floating-close');
      if (bar && getComputedStyle(bar).display !== 'none') {
        const barWidth = bar.getBoundingClientRect().width;
        for (const [label, button] of [['浮动安装按钮', install], ['浮动关闭按钮', close]]) {
          if (!button) continue;
          const width = button.getBoundingClientRect().width;
          push(`${label}未被拉伸`, width < barWidth * 0.5, `button=${Math.round(width)} bar=${Math.round(barWidth)}`);
        }
      }
    }

    if (path.endsWith('/system-settings.html')) {
      const row = document.querySelector('.plugin-settings-nav-save-row');
      const button = document.querySelector('#plugin-settings-nav-save');
      if (row && button) {
        const rowWidth = row.getBoundingClientRect().width;
        const buttonWidth = button.getBoundingClientRect().width;
        push('保存导航设置行可换行', getComputedStyle(row).flexWrap === 'wrap', `flexWrap=${getComputedStyle(row).flexWrap}`);
        push('保存按钮不被拉满整行', buttonWidth < rowWidth - 8, `button=${Math.round(buttonWidth)} row=${Math.round(rowWidth)}`);
      }
    }

    if (path.endsWith('/dependency-check.html')) {
      const title = document.querySelector('.dependency-compact-main h3');
      if (title) {
        push('依赖包名可断行', getComputedStyle(title).overflowWrap === 'anywhere', `overflowWrap=${getComputedStyle(title).overflowWrap}`);
      }
    }

    if (path.endsWith('/sandbox-chat.html')) {
      const workbench = document.querySelector('.sandbox-workbench');
      if (workbench) {
        const columns = getComputedStyle(workbench).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
        push('对话测试工作区小屏单列', columns.length === 1, `columns=${columns.join(' ')}`);
      }
    }

    if (path.endsWith('/dataflow.html')) {
      const meta = document.querySelector('.dataflow-meta');
      if (meta) {
        push('数据流元信息可换行', getComputedStyle(meta).whiteSpace === 'normal', `whiteSpace=${getComputedStyle(meta).whiteSpace}`);
      }
    }

    if (path.endsWith('/agent-workbench.html')) {
      // 全局移动端按钮规则会把弹窗标题栏的 ✕ 撑成整条白块，这里锁定图标尺寸
      for (const [label, selector] of [
        ['工作台设置', '#agent-settings-close'],
        ['管理模型', '#agent-model-manager-close'],
        ['添加模型', '#agent-model-form-close'],
        ['获取模型', '#agent-provider-models-close'],
      ]) {
        const button = document.querySelector(selector);
        if (!button) continue;
        const width = parseFloat(getComputedStyle(button).width) || 0;
        push(`${label}关闭按钮为图标尺寸`, width > 20 && width <= 56, `width=${Math.round(width)}`);
      }
      // 管理模型：手机端必须是单栏（供应商横向滑动条 + 全宽编辑区），不能退回桌面双栏
      const managerLayout = document.querySelector('.agent-model-manager-layout');
      if (managerLayout) {
        push('管理模型弹窗小屏单栏', getComputedStyle(managerLayout).flexDirection === 'column', `flexDirection=${getComputedStyle(managerLayout).flexDirection}`);
      }
      const managerRail = document.querySelector('.agent-model-manager-rail');
      if (managerRail) {
        push('供应商条横向滑动', getComputedStyle(managerRail).overflowX === 'auto', `overflowX=${getComputedStyle(managerRail).overflowX}`);
      }
    }

    return checks;
  });
}

async function readMobileLayoutDiagnostics(page) {
  return await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
    const bodyWidth = document.body?.scrollWidth || 0;
    const documentWidth = Math.max(document.documentElement.scrollWidth || 0, bodyWidth);
    const overflowX = Math.max(0, documentWidth - viewportWidth);
    const hasViewportMeta = Boolean(document.querySelector('meta[name="viewport"]'));
    const wideElements = Array.from(document.body?.querySelectorAll('*') || [])
      .map(element => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = String(element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          className: String(element.className || '').slice(0, 120),
          width: Math.round(rect.width),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          position: style.position,
          overflowX: style.overflowX,
          text,
        };
      })
      .filter(item => item.width > 0 && (item.left < -8 || item.right > viewportWidth + 8))
      .sort((left, right) => (right.right - viewportWidth) - (left.right - viewportWidth))
      .slice(0, 8);

    return {
      hasViewportMeta,
      viewportWidth,
      documentWidth,
      overflowX,
      wideElements,
    };
  });
}

async function runInteractionCheck(page, baseUrl, runtimeErrors, item = {}) {
  const result = {
    label: item.label || '未命名交互',
    path: item.path || '',
    ok: true,
    errors: [],
  };
  const startedErrorIndex = runtimeErrors.length;
  try {
    await Promise.race([
      (async () => {
        await page.goto(new URL(item.path || '/index.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
        await page.waitForSelector('body', { timeout: pageTimeoutMs });
        await new Promise(resolve => setTimeout(resolve, 700));
        await resetFrontendErrorCollector(page);
        await item.run(page, { runtimeErrors });
        await new Promise(resolve => setTimeout(resolve, 700));
      })(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${item.label || '交互'}超过 ${Math.round(interactionTimeoutMs / 1000)} 秒未完成`)), interactionTimeoutMs);
      }),
    ]);
  } catch (error) {
    result.errors.push(error.message || String(error));
  }

  const frontendErrors = await readFrontendErrors(page);
  const visibleFrontendErrors = frontendErrors.recentItems.filter(error => !shouldIgnoreFrontendErrorItem(error));
  if (visibleFrontendErrors.length > 0) {
    result.errors.push(`前端异常 ${visibleFrontendErrors.length} 条：${visibleFrontendErrors.map(error => error.message).join('；')}`);
  }
  result.errors.push(...runtimeErrors.slice(startedErrorIndex));
  result.ok = result.errors.length === 0;
  if (result.ok) {
    logPass(`${result.label}交互正常`);
  }
  return result;
}

async function runApiSettingsInteraction(page) {
  await page.waitForSelector('#api-settings-overview-list', { timeout: pageTimeoutMs });
  await waitForText(page, '#api-settings-preview', 'ai');
  await clickAndWait(page, '.api-settings-nav-btn[data-section="ai-image"]', 150);
  await page.waitForSelector('#section-ai-image:not(.hidden)', { timeout: pageTimeoutMs });
  const originalImageModes = await page.evaluate(() => ({
    primary: document.querySelector('#image-imageMode')?.value || 'openai',
    fallback: document.querySelector('#image-fallback-imageMode')?.value || 'openai',
  }));
  const readImageModeVisibility = () => page.evaluate(() => {
    const visible = selector => {
      const element = document.querySelector(selector);
      const field = element?.closest('.setting-item');
      return Boolean(element) && Boolean(field) && !field.classList.contains('hidden');
    };
    return {
      primaryModel: visible('#image-model'),
      primaryBaseApi: visible('#image-baseApi'),
      primaryJimeng: visible('#image-jimengApiUrl'),
      primarySize: visible('#image-size'),
      primaryQuality: visible('#image-quality'),
      primaryResponseFormat: visible('#image-responseFormat'),
      primaryOutputFormat: visible('#image-outputFormat'),
      primaryWatermark: visible('#image-watermark'),
      primaryWebSearch: visible('#image-webSearch'),
      primarySdBaseApi: visible('#image-sdWebUi-baseApi'),
      primarySdSampler: visible('#image-sdWebUi-samplerName'),
      fallbackModel: visible('#image-fallback-model'),
      fallbackBaseApi: visible('#image-fallback-baseApi'),
      fallbackJimeng: visible('#image-fallback-jimengApiUrl'),
      fallbackSize: visible('#image-fallback-size'),
      fallbackOutputFormat: visible('#image-fallback-outputFormat'),
      fallbackWebSearch: visible('#image-fallback-webSearch'),
      fallbackSdBaseApi: visible('#image-fallback-sdWebUi-baseApi'),
      fallbackSdSampler: visible('#image-fallback-sdWebUi-samplerName'),
    };
  });
  await setInputValue(page, '#image-imageMode', 'jimeng');
  await setInputValue(page, '#image-fallback-imageMode', 'jimeng');
  const jimengVisibility = await readImageModeVisibility();
  if (!jimengVisibility.primaryJimeng || jimengVisibility.primaryModel || jimengVisibility.primaryBaseApi || jimengVisibility.primarySize
    || jimengVisibility.primaryWebSearch || !jimengVisibility.fallbackJimeng || jimengVisibility.fallbackModel
    || jimengVisibility.fallbackBaseApi || jimengVisibility.fallbackWebSearch) {
    throw new Error('即梦模式没有正确隐藏 OpenAI 图像字段');
  }
  await setInputValue(page, '#image-imageMode', 'chat');
  const chatVisibility = await readImageModeVisibility();
  if (!chatVisibility.primaryModel || !chatVisibility.primaryBaseApi || chatVisibility.primaryJimeng
    || chatVisibility.primarySize || chatVisibility.primaryWebSearch) {
    throw new Error('对话式生图模式字段显示不正确');
  }
  await setInputValue(page, '#image-imageMode', 'openai');
  await setInputValue(page, '#image-fallback-imageMode', 'openai');
  const openAiVisibility = await readImageModeVisibility();
  if (!openAiVisibility.primaryModel || !openAiVisibility.primaryBaseApi || openAiVisibility.primaryJimeng || !openAiVisibility.primarySize
    || openAiVisibility.primaryWebSearch || !openAiVisibility.fallbackModel || !openAiVisibility.fallbackBaseApi
    || openAiVisibility.fallbackJimeng || openAiVisibility.fallbackWebSearch) {
    throw new Error('OpenAI 生图模式没有正确隐藏即梦字段');
  }
  await setInputValue(page, '#image-imageMode', 'ark-agent-plan');
  await setInputValue(page, '#image-fallback-imageMode', 'ark-agent-plan');
  const agentPlanVisibility = await readImageModeVisibility();
  if (!agentPlanVisibility.primaryModel || !agentPlanVisibility.primaryBaseApi || agentPlanVisibility.primaryJimeng
    || !agentPlanVisibility.primarySize || agentPlanVisibility.primaryQuality || !agentPlanVisibility.primaryResponseFormat
    || !agentPlanVisibility.primaryOutputFormat || !agentPlanVisibility.primaryWatermark || !agentPlanVisibility.primaryWebSearch
    || !agentPlanVisibility.fallbackModel || !agentPlanVisibility.fallbackBaseApi || agentPlanVisibility.fallbackJimeng
    || !agentPlanVisibility.fallbackSize || !agentPlanVisibility.fallbackOutputFormat || !agentPlanVisibility.fallbackWebSearch) {
    throw new Error('火山 Agent Plan 模式字段显示不正确');
  }
  await setInputValue(page, '#image-imageMode', 'sd-webui');
  await setInputValue(page, '#image-fallback-imageMode', 'sd-webui');
  const sdWebUiVisibility = await readImageModeVisibility();
  if (!sdWebUiVisibility.primarySdBaseApi || !sdWebUiVisibility.primarySdSampler
    || sdWebUiVisibility.primaryModel || sdWebUiVisibility.primaryBaseApi || sdWebUiVisibility.primaryJimeng
    || sdWebUiVisibility.primaryWebSearch
    || !sdWebUiVisibility.fallbackSdBaseApi || !sdWebUiVisibility.fallbackSdSampler
    || sdWebUiVisibility.fallbackModel || sdWebUiVisibility.fallbackBaseApi || sdWebUiVisibility.fallbackJimeng
    || sdWebUiVisibility.fallbackWebSearch) {
    throw new Error('SD WebUI 模式字段显示不正确');
  }
  await setInputValue(page, '#image-imageMode', originalImageModes.primary);
  await setInputValue(page, '#image-fallback-imageMode', originalImageModes.fallback);
  await clickAndWait(page, '.api-settings-nav-btn[data-section="image-monitor"]', 250);
  await page.waitForSelector('#section-image-monitor:not(.hidden)', { timeout: pageTimeoutMs });
  const storageWasEnabled = await page.evaluate(() => !document.querySelector('#imageMonitor-storageEnabled')?.classList.contains('off'));
  if (!storageWasEnabled) {
    await clickAndWait(page, '#imageMonitor-storageEnabled', 250);
  }
  const storageState = await page.evaluate(() => ({
    enabled: !document.querySelector('#imageMonitor-storageEnabled')?.classList.contains('off'),
    memeDisabled: Boolean(document.querySelector('#imageMonitor-saveMemeImages')?.disabled),
  }));
  if (!storageState.enabled || storageState.memeDisabled) {
    throw new Error('图片本地入库开关没有正确启用细分保存选项');
  }
  const before = await page.evaluate(() => document.querySelector('#imageMonitor-saveMemeImages')?.textContent || '');
  await clickAndWait(page, '#imageMonitor-saveMemeImages', 250);
  const state = await page.evaluate(previousText => {
    const button = document.querySelector('#imageMonitor-saveMemeImages');
    const unsaved = document.querySelector('#api-settings-unsaved');
    const preview = document.querySelector('#api-settings-preview')?.textContent || '';
    return {
      changed: Boolean(button) && button.textContent !== previousText,
      unsavedVisible: Boolean(unsaved) && !unsaved.classList.contains('hidden'),
      previewHasImageMonitor: preview.includes('imageMonitor') || preview.includes('saveMemeImages'),
    };
  }, before);
  if (!state.changed) {
    throw new Error('图片监控表情保存开关点击后没有变化');
  }
  if (!state.unsavedVisible) {
    throw new Error('API 设置草稿变化后未显示未保存提示');
  }
  if (!state.previewHasImageMonitor) {
    throw new Error('API 设置草稿预览没有跟随刷新');
  }
  await clickAndWait(page, '#imageMonitor-saveMemeImages', 150);
  if (!storageWasEnabled) {
    await clickAndWait(page, '#imageMonitor-storageEnabled', 150);
  }
}

async function runFileBrowserInteraction(page) {
  await page.waitForSelector('#file-browser-directory-table', { timeout: pageTimeoutMs });
  await setInputValue(page, '#file-browser-open-input', 'package.json');
  await clickAndWait(page, '#file-browser-open-btn', 900);
  await page.waitForSelector('#file-browser-editor-shell:not(.hidden)', { timeout: pageTimeoutMs });
  await page.waitForFunction(() => {
    const editor = document.querySelector('#file-browser-editor');
    return String(editor?.value || '').includes('"name"');
  }, { timeout: pageTimeoutMs });
  await clickAndWait(page, '#file-browser-find-btn', 200);
  await setInputValue(page, '#file-browser-find-input', 'version');
  await waitForText(page, '#file-browser-find-status', '/匹配|找到|1/');
  await clickAndWait(page, '#file-browser-view-preview-btn', 400);
  const ok = await page.evaluate(() => {
    const preview = document.querySelector('#file-browser-preview');
    const workspace = document.querySelector('#file-browser-workspace');
    return Boolean(preview)
      && Boolean(workspace)
      && !String(preview.textContent || '').includes('选择文本文件后')
      && workspace.className.includes('mode-preview');
  });
  if (!ok) {
    throw new Error('文件浏览预览模式未正确打开');
  }
  await clickAndWait(page, '#file-browser-editor-close-btn', 200);
}

async function runQqSimulatorInteraction(page) {
  await page.waitForSelector('#qq-simulator-chat-input', { timeout: pageTimeoutMs });
  await page.select('#qq-simulator-include-at', 'false').catch(() => {});
  await page.select('#qq-simulator-dispatch-mode', 'safe').catch(() => {});
  const message = `E2E 普通消息 ${Date.now()}`;
  await setInputValue(page, '#qq-simulator-chat-input', message);
  await page.waitForFunction(sentText => {
    return (document.querySelector('#qq-simulator-message-text')?.value || '') === sentText;
  }, { timeout: pageTimeoutMs }, message);
  await setInputValue(page, '#qq-simulator-segment-user-id', '20001');
  await page.evaluate(() => {
    document.querySelector('[data-segment-insert="at"]')?.click();
  });
  await new Promise(resolve => setTimeout(resolve, 400));
  const previewState = await page.evaluate(async () => {
    const previewText = document.querySelector('#qq-simulator-segment-preview')?.textContent || '';
    const messageText = document.querySelector('#qq-simulator-message-text')?.value || '';
    const response = await fetch('/api/qq-simulator/preview', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        eventType: 'message',
        groupId: '10001',
        userId: '20001',
        nickname: '测试用户',
        messageText,
        includeAt: false,
        dispatchMode: 'safe',
      }),
    });
    const data = await response.json().catch(() => ({}));
    return {
      previewText,
      messageText,
      ok: response.ok && data?.success !== false,
      eventType: data?.preview?.eventType || data?.event?.post_type || '',
    };
  });
  if (!previewState.previewText.includes('at') && !previewState.messageText.includes('[CQ:at')) {
    throw new Error('模拟调试消息段构造器没有插入 @ 用户');
  }
  if (!previewState.ok || !String(previewState.eventType || '').includes('message')) {
    throw new Error('模拟调试后端预览接口没有返回消息事件');
  }
  await clickAndWait(page, '#qq-simulator-clear-top-btn', 300);
  const cleared = await page.evaluate(() => {
    const status = document.querySelector('#qq-simulator-status')?.textContent || '';
    const result = document.querySelector('#qq-simulator-result')?.textContent || '';
    return status.includes('已清空') && result.includes('等待模拟事件');
  });
  if (!cleared) {
    throw new Error('模拟调试清空按钮没有重置消息流状态');
  }

  const imageCommandState = await page.evaluate(async () => {
    const response = await fetch('/api/qq-simulator/send', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        eventType: 'message',
        groupId: '10001',
        userId: '20001',
        nickname: '测试用户',
        messageText: '#灵晶改图 把背景改成蓝色水晶宫殿',
        images: ['https://example.com/source.png'],
        includeAt: false,
        dispatchMode: 'replay',
      }),
    });
    const data = await response.json().catch(() => ({}));
    return {
      ok: response.ok && data?.success !== false,
      replies: Array.isArray(data?.replies) ? data.replies : [],
      actions: Array.isArray(data?.actions) ? data.actions : [],
      timeline: Array.isArray(data?.timeline) ? data.timeline : [],
    };
  });
  if (!imageCommandState.ok
    || !imageCommandState.replies.some(item => String(item).includes('固定返回 1 张图片'))
    || !imageCommandState.actions.some(item => item?.type === 'would_edit_image')
    || !imageCommandState.timeline.some(item => item?.stage === 'ai.imageEditCommand' && item?.status === 'matched')) {
    throw new Error('模拟调试没有正确处理 #灵晶改图 命令');
  }
}

async function runQqSimulatorDeepPreviewInteraction(page) {
  await page.waitForSelector('#qq-simulator-chat-input', { timeout: pageTimeoutMs });
  await page.select('#qq-simulator-include-at', 'false').catch(() => {});
  await setInputValue(page, '#qq-simulator-message-text', '');
  await setInputValue(page, '#qq-simulator-chat-input', '');
  await setInputValue(page, '#qq-simulator-segment-user-id', '20001');
  await setInputValue(page, '#qq-simulator-segment-media-url', 'https://example.com/e2e-media.jpg');
  await setInputValue(page, '#qq-simulator-segment-face-id', '14');
  await setInputValue(page, '#qq-simulator-segment-reply-id', '900001');
  await setInputValue(page, '#qq-simulator-segment-meme-character', '芙宁娜');
  await setInputValue(page, '#qq-simulator-segment-meme-emotion', 'happy');
  await setInputValue(page, '#qq-simulator-segment-cq-code', '[CQ:poke,qq=20001]');
  const builderState = await page.evaluate(async () => {
    const buttonTypes = ['at', 'image', 'record', 'face', 'reply', 'cq', 'meme'];
    for (const type of buttonTypes) {
      document.querySelector(`[data-segment-insert="${type}"]`)?.click();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const messageText = document.querySelector('#qq-simulator-message-text')?.value || '';
    const chatText = document.querySelector('#qq-simulator-chat-input')?.value || '';
    const previewText = document.querySelector('#qq-simulator-segment-preview')?.textContent || '';
    return { messageText, chatText, previewText };
  });
  [
    '[CQ:at,qq=20001]',
    '[CQ:image,file=https://example.com/e2e-media.jpg]',
    '[CQ:record,file=https://example.com/e2e-media.jpg]',
    '[CQ:face,id=14]',
    '[CQ:reply,id=900001]',
    '[CQ:poke,qq=20001]',
    '[meme:芙宁娜:happy]',
  ].forEach(snippet => {
    if (!builderState.messageText.includes(snippet)) {
      throw new Error(`消息段构造器缺少片段：${snippet}`);
    }
  });
  if (builderState.chatText !== builderState.messageText) {
    throw new Error('消息段构造器没有同步底部聊天输入框');
  }

  const previewResults = await page.evaluate(async builtMessageText => {
    const readJson = async response => {
      const text = await response.text();
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        return { success: false, error: `接口返回不是 JSON：HTTP ${response.status}` };
      }
    };
    const requestPreview = async (name, payload) => {
      const response = await fetch('/api/qq-simulator/preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);
      return { name, ok: response.ok && data?.success !== false, status: response.status, data };
    };
    const base = {
      groupId: '10001',
      userId: '20001',
      nickname: 'E2E测试用户',
      role: 'member',
      botRole: 'admin',
      dispatchMode: 'safe',
      conversationMode: true,
      comment: 'E2E 深度预览',
    };
    const groupHistory = [
      { nickname: '花花', userId: '20002', type: 'text', content: '上一条群聊文本', messageId: 900010 },
      { nickname: 'Lee', userId: '20003', type: 'image', content: 'https://example.com/history.jpg', messageId: 900011 },
      { nickname: '测试用户', userId: '20001', type: 'reply', content: '900010', messageId: 900012 },
    ];
    const voice = {
      name: 'e2e-voice.wav',
      mimeType: 'audio/wav',
      sizeBytes: 12,
      durationSeconds: 3,
      transcript: '这是一条模拟语音转写',
      dataUrl: '',
    };
    const imageUrl = 'https://example.com/e2e-image.jpg';
    const cases = [
      {
        name: 'onebot_group_media_segments',
        payload: {
          ...base,
          eventType: 'message',
          adapterFormat: 'onebot',
          messageText: builtMessageText,
          includeAt: true,
          images: [imageUrl],
          voice,
          groupHistory,
        },
      },
      {
        name: 'icqq_private_message',
        payload: {
          ...base,
          eventType: 'private_message',
          groupId: '',
          adapterFormat: 'icqq',
          includeAt: false,
          messageText: '私聊测试 [CQ:reply,id=900001] 收到吗',
          images: [],
          voice: null,
          groupHistory,
        },
      },
      {
        name: 'napcat_join_request',
        payload: {
          ...base,
          eventType: 'join_request',
          adapterFormat: 'napcat',
          userId: '30001',
          nickname: '申请入群的人',
          messageText: '',
          includeAt: false,
          applicant: {
            qqLevel: 25,
            age: 18,
            sex: 'unknown',
            warningCount: 0,
            listStatus: 'normal',
          },
          comment: '想加入群聊一起交流',
        },
      },
      {
        name: 'go_cqhttp_group_increase',
        payload: {
          ...base,
          eventType: 'group_increase',
          adapterFormat: 'go-cqhttp',
          userId: '30002',
          nickname: '新成员',
          messageText: '',
          includeAt: false,
          comment: '新成员已入群',
        },
      },
      {
        name: 'onebot_poke',
        payload: {
          ...base,
          eventType: 'poke',
          adapterFormat: 'onebot',
          userId: '20002',
          nickname: '戳戳用户',
          messageText: '',
          includeAt: false,
          comment: '模拟戳一戳',
        },
      },
      {
        name: 'onebot_group_title_command',
        payload: {
          ...base,
          eventType: 'message',
          adapterFormat: 'onebot',
          role: 'member',
          botRole: 'owner',
          messageText: '#申请头衔 测试头衔',
          includeAt: false,
          groupHistory: [],
        },
      },
    ];
    const results = [];
    for (const item of cases) {
      results.push(await requestPreview(item.name, item.payload));
    }
    return results.map(item => ({
      name: item.name,
      ok: item.ok,
      status: item.status,
      error: item.data?.error || '',
      event: item.data?.event || null,
      preview: item.data?.preview || null,
      debugPayload: item.data?.debug?.payload || null,
    }));
  }, builderState.messageText);

  const byName = Object.fromEntries(previewResults.map(item => [item.name, item]));
  const failures = previewResults.filter(item => !item.ok);
  if (failures.length > 0) {
    throw new Error(`模拟调试预览接口失败：${failures.map(item => `${item.name} HTTP ${item.status} ${item.error}`).join('；')}`);
  }
  const getMessageTypes = event => Array.isArray(event?.message)
    ? event.message.map(segment => segment?.type || segment?.data?.type || '').filter(Boolean)
    : [];
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const group = byName.onebot_group_media_segments;
  const groupTypes = getMessageTypes(group.event);
  assert(group.event?.post_type === 'message' && group.event?.message_type === 'group', 'OneBot 群消息事件类型不正确');
  ['at', 'image', 'record', 'face', 'reply', 'poke', 'meme'].forEach(type => {
    assert(groupTypes.includes(type), `OneBot 群消息预览缺少 ${type} 消息段`);
  });
  assert(group.preview?.groupHistoryCount === 3, '群历史上下文没有进入预览事件');
  assert(group.debugPayload?.voice?.hasTranscript === true, '语音转写没有进入预览载荷');

  const privateMessage = byName.icqq_private_message;
  assert(privateMessage.event?.message_type === 'private', 'icqq 私聊事件 message_type 不正确');
  assert(!privateMessage.event?.group_id, '私聊事件不应该携带群号');
  assert(privateMessage.preview?.groupHistoryCount === 0, '私聊事件不应该携带群历史上下文');
  assert(getMessageTypes(privateMessage.event).includes('reply'), 'icqq 私聊回复消息段缺失');

  const joinRequest = byName.napcat_join_request;
  assert(joinRequest.event?.post_type === 'request' && joinRequest.event?.request_type === 'group', '加群申请事件类型不正确');
  assert(joinRequest.event?.applicant?.qqLevel === 25, '加群申请 QQ 等级字段缺失');
  assert(joinRequest.event?.flag, '加群申请 flag 缺失');

  const groupIncrease = byName.go_cqhttp_group_increase;
  assert(groupIncrease.event?.notice_type === 'group_increase', '新成员入群 notice_type 不正确');
  assert(groupIncrease.event?.operator_id, '新成员入群 operator_id 缺失');

  const poke = byName.onebot_poke;
  assert(poke.event?.notice_type === 'notify' && poke.event?.sub_type === 'poke', '戳一戳事件类型不正确');
  assert(poke.event?.target_id && poke.event?.operator_id, '戳一戳 target/operator 缺失');

  const titleCommand = byName.onebot_group_title_command;
  assert(String(titleCommand.event?.raw_message || '').includes('#申请头衔'), '头衔申请命令没有进入 raw_message');
  assert(titleCommand.event?.bot_role === 'owner', '头衔申请命令没有保留 Bot 群主身份');
}

async function runDependencyInteraction(page) {
  await page.waitForSelector('#refresh-btn', { timeout: pageTimeoutMs });
  await clickAndWait(page, '#refresh-btn', 900);
  await waitForText(page, '#dependency-summary', '/运行依赖|开发依赖|依赖/');
  await setInputValue(page, '#other-plugin-dependency-search', 'plugin');
  await new Promise(resolve => setTimeout(resolve, 350));
  const searched = await page.evaluate(() => {
    const input = document.querySelector('#other-plugin-dependency-search');
    const meta = document.querySelector('#other-plugin-dependency-meta')?.textContent || '';
    const list = document.querySelector('#other-plugin-dependency-list')?.textContent || '';
    return {
      inputValue: input?.value || '',
      hasRenderedList: Boolean(list.trim()),
      meta,
    };
  });
  if (searched.inputValue !== 'plugin') {
    throw new Error('依赖面板搜索框输入失败');
  }
  if (!searched.hasRenderedList) {
    throw new Error('依赖面板搜索后列表为空或未渲染');
  }
}

async function runGlobalSearchInteraction(page) {
  await page.waitForSelector('#console-global-search-input', { timeout: pageTimeoutMs });
  await setInputValue(page, '#console-global-search-input', '命令');
  await page.waitForSelector('#console-global-search-panel:not(.hidden) .console-global-search-item', { timeout: pageTimeoutMs });
  const state = await page.evaluate(() => {
    const input = document.querySelector('#console-global-search-input');
    const panel = document.querySelector('#console-global-search-panel');
    const items = Array.from(panel?.querySelectorAll('.console-global-search-item') || []);
    return {
      value: input?.value || '',
      open: Boolean(panel) && !panel.classList.contains('hidden'),
      count: items.length,
      text: items.map(item => item.textContent || '').join('\n'),
      firstSelected: items[0]?.classList.contains('is-selected') === true,
    };
  });
  if (state.value !== '命令' || !state.open || state.count <= 0) {
    throw new Error('全局搜索没有按关键词渲染结果');
  }
  if (!state.text.includes('命令') && !state.text.includes('指令')) {
    throw new Error('全局搜索结果没有包含命令相关内容');
  }
  if (!state.firstSelected) {
    throw new Error('全局搜索没有默认选中第一条结果');
  }
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => document.querySelector('#console-global-search-panel')?.classList.contains('hidden') === true);
  if (!closed) {
    throw new Error('全局搜索按 Escape 后没有关闭');
  }
}

// 上下文容量面板（对齐 ZCode）：标题行 + 细进度条 + 构成分类 + 缓存命中率
async function runContextUsagePanelInteraction(page) {
  await page.waitForSelector('#agent-context-usage-trigger', { timeout: pageTimeoutMs });
  await page.evaluate(() => {
    const menu = document.querySelector('#agent-context-usage-menu');
    menu.open = true;
    menu.dispatchEvent(new Event('toggle'));
  });
  await page.waitForSelector('.agent-context-usage-popover', { timeout: pageTimeoutMs });

  const panel = await page.evaluate(() => {
    const pop = document.querySelector('.agent-context-usage-popover');
    const meter = pop?.querySelector('.agent-context-meter');
    const header = pop?.querySelector('header');
    const title = header?.querySelector('strong')?.textContent?.trim() || '';
    const value = header?.querySelector('span')?.textContent?.trim() || '';
    const rows = [...(pop?.querySelectorAll('.agent-context-breakdown-row') || [])];
    const dot = rows[0]?.querySelector('.agent-context-breakdown-dot');
    return {
      title,
      value,
      meterHeight: meter ? Math.round(meter.getBoundingClientRect().height) : 0,
      // 数值应右对齐并可用等宽数字
      valueMono: header ? /mono/i.test(getComputedStyle(header.querySelector('span')).fontFamily) : false,
      hasBreakdown: Boolean(pop?.querySelector('#agent-context-breakdown')),
      hasCacheRow: Boolean(pop?.querySelector('#agent-context-cache-row')),
      width: pop ? Math.round(pop.getBoundingClientRect().width) : 0,
      height: pop ? Math.round(pop.getBoundingClientRect().height) : 0,
      // 标题行数值要带百分比，形如「34.5万 / 100万（34.5%）」
      valueShowsPercent: /（[\d.]+%）/.test(value),
      // 圆点应为圆角（ZCode 用圆形色点）
      dotRadius: dot ? getComputedStyle(dot).borderRadius : '',
      dotSize: dot ? Math.round(dot.getBoundingClientRect().width) : 0,
      // 明细表已并入摘要，面板内不应再出现旧表格
      hasLegacyDetails: Boolean(pop?.querySelector('.agent-context-usage-details')),
      breakdownLabels: rows.map(row => row.querySelector('.agent-context-breakdown-label')?.textContent?.trim() || ''),
    };
  });
  if (!/上下文容量/.test(panel.title)) {
    throw new Error(`上下文面板标题不对：${panel.title}`);
  }
  if (!panel.value) {
    throw new Error('上下文面板标题行没有容量数值');
  }
  // 空会话没有上下文数据，标题显示「未读取」是正确状态；有数据时才要求「已用/上限（百分比）」
  if (panel.value !== '未读取' && !/^\d/.test(panel.value)) {
    throw new Error(`上下文面板标题行数值格式异常：${panel.value}`);
  }
  if (panel.value !== '未读取' && !panel.valueShowsPercent) {
    throw new Error(`标题行数值缺少百分比：${panel.value}`);
  }
  if (panel.meterHeight !== 8) {
    throw new Error(`上下文进度条高度应对齐 ZCode（8px），实际 ${panel.meterHeight}px`);
  }
  if (!panel.hasBreakdown || !panel.hasCacheRow) {
    throw new Error('上下文面板缺少构成分类或缓存命中率区块');
  }
  if (panel.hasLegacyDetails) {
    throw new Error('上下文面板仍在渲染旧明细表，应已并入摘要行');
  }
  if (panel.width > 340) {
    throw new Error(`上下文面板过宽：${panel.width}`);
  }
  // 空/稀疏内容时面板会缩到 min-width；若被拉满则说明又退回固定宽度
  if (panel.width < 220) {
    throw new Error(`上下文面板过窄，内容被挤压：${panel.width}`);
  }
  if (panel.height > 420) {
    throw new Error(`上下文面板过高：${panel.height}`);
  }
  // 「缓存命中」只能出现在底部命中率一行，不能混进构成来源（会把真实来源压成个位数）
  if (panel.breakdownLabels.some(label => /缓存/.test(label))) {
    throw new Error(`构成列表不应包含缓存类目：${panel.breakdownLabels.join(',')}`);
  }
  if (panel.dotRadius && !/50%/.test(panel.dotRadius)) {
    throw new Error(`构成圆点应为圆形，实际 border-radius=${panel.dotRadius}`);
  }
  // 缓存命中率算法：cacheRead / input（input 已含缓存，不能再加一次）
  const rate = await page.evaluate(() => {
    const row = document.querySelector('#agent-context-cache-row');
    const valueEl = document.querySelector('#agent-context-cache-rate');
    return {
      hidden: row?.classList.contains('hidden') !== false,
      text: valueEl?.textContent?.trim() || '',
    };
  });
  // 无缓存数据的会话里该行隐藏是正确行为；有数据时必须显示百分比
  if (!rate.hidden && !/^[\d.]+%$/.test(rate.text)) {
    throw new Error(`缓存命中率格式异常：${rate.text}`);
  }
  await page.evaluate(() => {
    const menu = document.querySelector('#agent-context-usage-menu');
    menu.open = false;
  });
}

// 斜杠命令面板（对齐 ZCode）：分组 + 图标 + 搜索过滤 + 快捷键提示
async function runSlashMenuInteraction(page) {
  await page.waitForSelector('#agent-prompt', { timeout: pageTimeoutMs });
  await page.evaluate(() => {
    const input = document.querySelector('#agent-prompt');
    input.value = '/';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  await page.waitForSelector('#agent-slash-menu:not(.hidden)', { timeout: pageTimeoutMs });

  const menu = await page.evaluate(() => {
    const root = document.querySelector('#agent-slash-menu');
    return {
      groups: [...root.querySelectorAll('.agent-slash-group-title')].map(node => node.textContent.trim()),
      items: root.querySelectorAll('.agent-slash-item').length,
      // 每行一个线性图标，不能残留 emoji 或纯文本符号
      icons: root.querySelectorAll('.agent-slash-icon svg').length,
      hasEmoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(root.innerText),
      hasSearch: Boolean(root.querySelector('#agent-slash-search-input')),
      footKbd: root.querySelectorAll('.agent-slash-foot kbd').length,
      count: root.querySelector('#agent-slash-count')?.textContent || '',
    };
  });
  if (menu.groups.length < 2) {
    throw new Error(`斜杠命令没有分组：${JSON.stringify(menu.groups)}`);
  }
  if (menu.items === 0 || menu.icons !== menu.items) {
    throw new Error(`斜杠命令缺少图标：items=${menu.items} icons=${menu.icons}`);
  }
  if (menu.hasEmoji) {
    throw new Error('斜杠命令中仍有 emoji 图标');
  }
  if (!menu.hasSearch || menu.footKbd < 3) {
    throw new Error(`斜杠命令缺少搜索框或快捷键提示：${JSON.stringify(menu)}`);
  }
  if (!/\d+\s*项/.test(menu.count)) {
    throw new Error(`斜杠命令缺少条目计数：${menu.count}`);
  }

  // 搜索过滤：输入 mod 只应留下 /models
  await page.evaluate(() => {
    const search = document.querySelector('#agent-slash-search-input');
    search.value = 'mod';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  const filtered = await page.evaluate(() => [...document.querySelectorAll('.agent-slash-item .agent-slash-command')].map(node => node.textContent.trim()));
  if (filtered.length !== 1 || filtered[0] !== '/models') {
    throw new Error(`斜杠命令搜索过滤异常：${filtered.join(',') || '(空)'}`);
  }
  // 清空搜索后关闭菜单，避免影响后续用例
  await page.evaluate(() => {
    const input = document.querySelector('#agent-prompt');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(resolve => setTimeout(resolve, 200));
}

// 输入区任务模式控件：触发标签、风险色点、与隐藏 select 双向同步
async function runModeSwitchInteraction(page) {
  await page.waitForSelector('#agent-mode-btn', { timeout: pageTimeoutMs });
  const initial = await page.evaluate(() => ({
    label: document.querySelector('#agent-mode-btn-label')?.textContent?.trim() || '',
    mode: document.querySelector('#agent-mode-btn')?.dataset.mode || '',
    select: document.querySelector('#agent-mode')?.value || '',
  }));
  if (!initial.label || initial.mode !== initial.select) {
    throw new Error(`模式控件初始状态未同步：${JSON.stringify(initial)}`);
  }
  await clickAndWait(page, '#agent-mode-btn', 250);
  await page.waitForSelector('#agent-mode-menu:not(.hidden)', { timeout: pageTimeoutMs });
  const options = await page.evaluate(() => [...document.querySelectorAll('.agent-mode-option')].map(option => option.dataset.modeValue));
  if (options.join(',') !== 'analyze,patch,edit,full') {
    throw new Error(`模式菜单选项不完整：${options.join(',')}`);
  }
  await clickAndWait(page, '.agent-mode-option[data-mode-value="patch"]', 350);
  const after = await page.evaluate(() => {
    const icon = document.querySelector('#agent-mode-icon');
    const btn = document.querySelector('#agent-mode-btn');
    return {
      label: document.querySelector('#agent-mode-btn-label')?.textContent?.trim() || '',
      select: document.querySelector('#agent-mode')?.value || '',
      mobile: document.querySelector('#agent-mobile-mode')?.value || '',
      agent: document.querySelector('#agent-agent')?.value || '',
      menuHidden: document.querySelector('#agent-mode-menu')?.classList.contains('hidden') === true,
      iconSvg: icon?.querySelectorAll('svg').length || 0,
      // 幽灵按钮：不能有可见边框，高度要和相邻图标按钮一致
      borderWidth: btn ? parseFloat(getComputedStyle(btn).borderTopWidth) || 0 : -1,
      height: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
      hasRiskClass: btn?.classList.contains('is-risk') === true,
      hasWriteClass: btn?.classList.contains('is-write') === true,
    };
  });
  if (!/补丁建议/.test(after.label) || after.select !== 'patch' || after.mobile !== 'patch') {
    throw new Error(`模式切换没有同步到配置：${JSON.stringify(after)}`);
  }
  if (!after.menuHidden) {
    throw new Error('选择模式后菜单没有关闭');
  }
  if (after.iconSvg !== 1) {
    throw new Error(`模式触发器缺少语义图标：${JSON.stringify(after)}`);
  }
  if (after.borderWidth > 0) {
    throw new Error(`模式触发器不应有边框（与相邻图标按钮不一致）：border=${after.borderWidth}px`);
  }
  if (after.height < 26 || after.height > 36) {
    throw new Error(`模式触发器高度与工具条不匹配：${after.height}px`);
  }
  // 切到「实际修改」验证写入档的风险样式（patch 不属于写入档）
  await clickAndWait(page, '#agent-mode-btn', 200);
  await clickAndWait(page, '.agent-mode-option[data-mode-value="edit"]', 350);
  const writeState = await page.evaluate(() => {
    const btn = document.querySelector('#agent-mode-btn');
    const icon = document.querySelector('#agent-mode-icon');
    return {
      label: document.querySelector('#agent-mode-btn-label')?.textContent?.trim() || '',
      select: document.querySelector('#agent-mode')?.value || '',
      agent: document.querySelector('#agent-agent')?.value || '',
      hasWriteClass: btn?.classList.contains('is-write') === true,
      hasRiskClass: btn?.classList.contains('is-risk') === true,
      color: btn ? getComputedStyle(btn).color : '',
      iconPaths: icon?.querySelectorAll('svg path').length || 0,
    };
  });
  if (writeState.select !== 'edit') {
    throw new Error(`写入档没有同步到配置：${JSON.stringify(writeState)}`);
  }
  // 注意：权限档只在「新建会话」或切到完全访问时才自动改写（既有设计），这里不做断言
  if (!writeState.hasWriteClass || writeState.hasRiskClass) {
    throw new Error(`写入档风险样式类不正确：${JSON.stringify(writeState)}`);
  }
  if (!/rgb\(180, 83, 9\)/.test(writeState.color)) {
    throw new Error(`写入档没有使用警示色：${writeState.color}`);
  }
  // 完全访问：必须转为红色风险态
  await clickAndWait(page, '#agent-mode-btn', 200);
  await clickAndWait(page, '.agent-mode-option[data-mode-value="full"]', 350);
  const fullState = await page.evaluate(() => {
    const btn = document.querySelector('#agent-mode-btn');
    return {
      select: document.querySelector('#agent-mode')?.value || '',
      hasRiskClass: btn?.classList.contains('is-risk') === true,
      hasWriteClass: btn?.classList.contains('is-write') === true,
      color: btn ? getComputedStyle(btn).color : '',
    };
  });
  if (fullState.select !== 'full' || !fullState.hasRiskClass || fullState.hasWriteClass) {
    throw new Error(`完全访问风险样式不正确：${JSON.stringify(fullState)}`);
  }
  if (!/rgb\(185, 28, 28\)/.test(fullState.color)) {
    throw new Error(`完全访问没有使用红色警示：${fullState.color}`);
  }
  // 还原为只读，避免影响后续用例
  await clickAndWait(page, '#agent-mode-btn', 200);
  await clickAndWait(page, '.agent-mode-option[data-mode-value="analyze"]', 300);
}

// 输入区工具条图标：全部为 SVG，不能残留 emoji / 文字符号
// 消息操作条：不依赖 OpenCode 消息 ID（ZCode 会话也要有复制/重发）
async function runMessageActionsInteraction(page) {
  await page.waitForSelector('#agent-output', { timeout: pageTimeoutMs });
  await new Promise(resolve => setTimeout(resolve, 600));
  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.agent-message')];
    const withActions = cards.filter(card => card.querySelector('.agent-message-actions'));
    const first = withActions[0];
    const buttons = first ? [...first.querySelectorAll('.agent-message-action')] : [];
    return {
      messages: cards.length,
      withActions: withActions.length,
      labels: buttons.map(btn => btn.textContent.trim()),
      hasCopyIcon: buttons.some(btn => btn.querySelector('svg') && btn.dataset.messageCopy !== undefined),
      idleOpacity: first ? getComputedStyle(first.querySelector('.agent-message-actions')).opacity : null,
      position: first ? getComputedStyle(first.querySelector('.agent-message-actions')).position : '',
    };
  });
  if (!info.messages) return; // 没有消息时跳过
  if (info.withActions !== info.messages) {
    throw new Error(`不是所有消息都有操作条：${info.withActions}/${info.messages}`);
  }
  if (!info.labels.includes('复制')) {
    throw new Error(`消息操作条缺少复制：${info.labels.join(',')}`);
  }
  if (!info.hasCopyIcon) {
    throw new Error('复制按钮缺少图标');
  }
  // hover 才浮现，避免常驻干扰阅读
  if (info.idleOpacity !== '0') {
    throw new Error(`操作条默认应收起（悬停浮现），实际 opacity=${info.idleOpacity}`);
  }
  // 复制功能：把内容写入剪贴板（用只读权限探测，不实际污染剪贴板）
  const copyable = await page.evaluate(() => {
    const btn = document.querySelector('[data-message-copy]');
    const card = btn?.closest('.agent-message');
    const text = card?.querySelector('.agent-message-bubble')?.innerText || '';
    return { hasButton: Boolean(btn), textLength: text.trim().length };
  });
  if (!copyable.hasButton || copyable.textLength === 0) {
    throw new Error(`复制按钮取不到消息文本：${JSON.stringify(copyable)}`);
  }
}

// 侧栏收起把手：撑满整高、图标居中、有可见边界，而不是只剩一个小箭头
async function runContextHandleInteraction(page) {
  await page.waitForSelector('#agent-context-collapse-btn', { timeout: pageTimeoutMs });
  const read = () => page.evaluate(() => {
    const btn = document.querySelector('#agent-context-collapse-btn');
    const sidebar = document.querySelector('#agent-context-sidebar');
    const shell = document.querySelector('.agent-workbench-shell');
    const svg = btn.querySelector('svg');
    const br = btn.getBoundingClientRect();
    const sr = sidebar.getBoundingClientRect();
    const ir = svg.getBoundingClientRect();
    return {
      collapsed: shell.classList.contains('is-context-collapsed'),
      sidebarW: Math.round(sr.width),
      btnW: Math.round(br.width),
      btnH: Math.round(br.height),
      iconCenterOffsetX: Math.round((ir.left + ir.width / 2) - (br.left + br.width / 2)),
      iconCenterOffsetY: Math.round((ir.top + ir.height / 2) - (br.top + br.height / 2)),
      iconSize: Math.round(ir.width),
      bg: getComputedStyle(btn).backgroundColor,
      label: btn.getAttribute('aria-label'),
      svgCount: btn.querySelectorAll('svg').length,
      text: (btn.textContent || '').trim(),
    };
  });
  const initial = await read();
  if (initial.svgCount !== 1 || initial.text) {
    throw new Error(`折叠把手应为纯 SVG 图标：svg=${initial.svgCount} text=${initial.text}`);
  }
  // 确保处于收起态
  if (!initial.collapsed) {
    await clickAndWait(page, '#agent-context-collapse-btn', 400);
  }
  const collapsed = await read();
  if (!collapsed.collapsed) {
    throw new Error('点击后没有进入收起态');
  }
  if (collapsed.btnH < 200) {
    throw new Error(`收起态把手没有撑满高度：${collapsed.btnH}px`);
  }
  if (Math.abs(collapsed.iconCenterOffsetX) > 2 || Math.abs(collapsed.iconCenterOffsetY) > 2) {
    throw new Error(`把手图标没有居中：x=${collapsed.iconCenterOffsetX} y=${collapsed.iconCenterOffsetY}`);
  }
  if (collapsed.iconSize < 16) {
    throw new Error(`把手图标过小：${collapsed.iconSize}px`);
  }
  // 必须有可见边界（白底或描边），否则和侧栏灰底融为一体
  if (!/rgb\(255, 255, 255\)/.test(collapsed.bg)) {
    throw new Error(`收起态把手缺少可见背景：${collapsed.bg}`);
  }
  if (!/展开/.test(collapsed.label || '')) {
    throw new Error(`收起态 aria-label 应提示展开：${collapsed.label}`);
  }
  // 展开回去，避免影响后续用例
  await clickAndWait(page, '#agent-context-collapse-btn', 400);
  const expanded = await read();
  if (expanded.collapsed || expanded.btnH > 60) {
    throw new Error(`展开态把手尺寸异常：${JSON.stringify(expanded)}`);
  }
}

// ZCode 实时命令展示：多行命令必须用等宽块保留换行，不能挤进单行状态
async function runLiveCommandRenderInteraction(page) {
  await page.waitForSelector('#agent-output', { timeout: pageTimeoutMs });
  const sample = 'echo "=== 阿里云镜像 ==="\ncurl -L -o /dev/null -s -w "速度: %{speed_download} B/s" --max-time 90 "https://mirrors.aliyun.com/x.iso"\necho "=== 清华镜像 ==="';
  await page.evaluate(command => {
    const out = document.querySelector('#agent-output');
    const escaped = command.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    out.innerHTML = `<article class="agent-message agent-message-agent agent-message-live"><div class="agent-message-body">
      <div class="agent-message-live-bubbles">正在执行网络测速...</div>
      <div class="agent-live-progress"><span class="agent-live-progress-dot"></span>
      <span class="agent-live-progress-text">正在执行命令：echo "=== 阿里云镜像 ===" …（第 6 步）</span>
      <pre class="agent-live-command">${escaped}</pre></div></div></article>`;
  }, sample);
  await new Promise(resolve => setTimeout(resolve, 200));

  const probe = await page.evaluate(() => {
    const pre = document.querySelector('.agent-live-command');
    const statusText = document.querySelector('.agent-live-progress-text');
    if (!pre) return { found: false };
    const style = getComputedStyle(pre);
    return {
      found: true,
      whiteSpace: style.whiteSpace,
      fontFamily: style.fontFamily,
      lineCount: pre.textContent.split('\n').length,
      // 命令块必须整行独占（width 接近容器），不能和状态文本并排
      fullWidth: pre.getBoundingClientRect().width >= (pre.parentElement?.getBoundingClientRect().width || 0) * 0.8,
      statusSingleLine: !String(statusText?.textContent || '').includes('\n'),
    };
  });
  if (!probe.found) {
    throw new Error('实时命令块缺失');
  }
  if (!/pre-wrap|pre/.test(probe.whiteSpace)) {
    throw new Error(`命令块没有保留换行：white-space=${probe.whiteSpace}`);
  }
  if (!/mono|Consolas/i.test(probe.fontFamily)) {
    throw new Error(`命令块没有使用等宽字体：${probe.fontFamily}`);
  }
  if (probe.lineCount < 3) {
    throw new Error(`命令块行数异常：${probe.lineCount}`);
  }
  if (!probe.fullWidth) {
    throw new Error('命令块没有整行独占，仍与状态文本挤在一起');
  }
  if (!probe.statusSingleLine) {
    throw new Error('状态行仍包含多行命令');
  }
  await page.evaluate(() => {
    document.querySelector('#agent-output').innerHTML = '';
  });
}

// ZCode 分段输出：一轮任务的多段正文必须各自成块，不能连成一整段
async function runLiveSegmentRenderInteraction(page) {
  await page.waitForSelector('#agent-output', { timeout: pageTimeoutMs });
  await page.evaluate(() => {
    const segments = [
      '我先看看这台机器上有哪些测速工具可用，然后跑一次实际测速。',
      '这台机器上只有 curl 和 wget，没有安装 speedtest 工具。',
      '延迟很好（到 1.1.1.1 平均 5.4ms）。下载大约 1.6 MB/s。',
    ];
    const out = document.querySelector('#agent-output');
    out.innerHTML = `<article class="agent-message agent-message-agent agent-message-live"><div class="agent-message-body">
      <div class="agent-message-live-bubbles">${segments.map(text => `<div class="agent-message-bubble agent-agent-bubble agent-markdown">${text}</div>`).join('')}
      <div class="agent-message-bubble agent-agent-bubble agent-markdown">接下来测试上传速度…</div></div></div></article>`;
  });
  await new Promise(resolve => setTimeout(resolve, 200));

  const probe = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.agent-message-live-bubbles .agent-message-bubble')];
    const tops = bubbles.map(item => Math.round(item.getBoundingClientRect().top));
    return {
      count: bubbles.length,
      // 每段必须纵向递进，不能重叠
      stacked: tops.every((top, index) => index === 0 || top > tops[index - 1]),
      separators: bubbles.slice(1).filter(item => parseFloat(getComputedStyle(item).borderTopWidth) > 0).length,
    };
  });
  if (probe.count < 3) {
    throw new Error(`分段正文数量异常：${probe.count}`);
  }
  if (!probe.stacked) {
    throw new Error('分段正文挤在一起，没有按段分开');
  }
  if (probe.separators < 2) {
    throw new Error(`段落之间缺少分隔线：${probe.separators}`);
  }
  await page.evaluate(() => {
    document.querySelector('#agent-output').innerHTML = '';
  });
}

// 工具调用摘要行（对齐 ZCode ToolSummaryRow）：每项一行，图标+名称+目标+状态+箭头
async function runToolSummaryRowInteraction(page) {
  await page.waitForSelector('#agent-output', { timeout: pageTimeoutMs });
  // 直接调用真实渲染函数（而不是手写 DOM）：渲染器内部的未定义引用只有走真实代码路径才能暴露
  const rendered = await page.evaluate(() => {
    if (typeof window.renderAgentTools !== 'function') {
      return { ok: false, error: 'renderAgentTools 未注册' };
    }
    try {
      const html = window.renderAgentTools([
        { name: 'read_file', status: 'completed', input: { file_path: 'lib/webConsole/public/agent-workbench.js' }, output: 'ok' },
        { name: 'bash', status: 'completed', input: { command: 'npm run check:webconsole:e2e' }, output: 'ok' },
        { name: 'edit_file', status: 'error', input: { path: 'apps/ai.js' }, output: 'failed' },
      ]);
      document.querySelector('#agent-output').innerHTML = `<article class="agent-message agent-message-agent"><div class="agent-message-body">${html}</div></article>`;
      return { ok: true, length: html.length };
    } catch (error) {
      return { ok: false, error: `${error.name}: ${error.message}` };
    }
  });
  if (!rendered.ok) throw new Error(`工具摘要渲染失败：${rendered.error}`);
  await new Promise(resolve => setTimeout(resolve, 200));

  const probe = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.agent-tool-item')];
    return items.map(item => {
      const summary = item.querySelector('summary');
      const kids = [...summary.children].map(el => {
        const rect = el.getBoundingClientRect();
        return { cls: el.className, top: Math.round(rect.top), h: Math.round(rect.height), w: Math.round(rect.width) };
      });
      return {
        height: Math.round(summary.getBoundingClientRect().height),
        scrollWidth: summary.scrollWidth,
        clientWidth: summary.clientWidth,
        icons: summary.querySelectorAll('.agent-tool-icon svg').length,
        target: summary.querySelector('.agent-tool-target')?.textContent || '',
        state: summary.querySelector('.agent-tool-state')?.textContent || '',
        stateColor: getComputedStyle(summary.querySelector('.agent-tool-state')).color,
        kids,
      };
    });
  });
  if (probe.length !== 3) {
    throw new Error(`工具摘要行数量异常：${probe.length}`);
  }
  probe.forEach((row, index) => {
    if (row.icons !== 1) throw new Error(`第 ${index + 1} 行缺少工具图标：${row.icons}`);
    // 单行摘要：整行高度要贴近一行文本，不能因为换行被撑到多行
    if (row.height > 40) throw new Error(`第 ${index + 1} 行被撑成多行：${row.height}px`);
    if (row.scrollWidth > row.clientWidth + 1) throw new Error(`第 ${index + 1} 行横向溢出：${row.scrollWidth}>${row.clientWidth}`);
  });
  if (!probe[0].target.includes('agent-workbench.js')) {
    throw new Error(`工具摘要没有提取操作目标：${probe[0].target}`);
  }
  if (probe[2].state !== '失败') {
    throw new Error(`失败工具没有标记失败：${probe[2].state}`);
  }
  if (probe[2].stateColor === probe[1].stateColor) {
    throw new Error('失败与成功的状态文字颜色没有区分');
  }
  await page.evaluate(() => {
    document.querySelector('#agent-output').innerHTML = '';
  });
}

// 文件变更行（对齐 ZCode changes-group）：单行布局，目录跟在文件名后截断，操作按钮常显
async function runFileChangeRowInteraction(page) {
  await page.waitForSelector('#agent-output', { timeout: pageTimeoutMs });
  await page.evaluate(() => {
    const files = [
      { path: 'lib/webConsole/public/agent-workbench.js', additions: 120, deletions: 8 },
      { path: 'scripts/check-webconsole-e2e.mjs', additions: 31, deletions: 2 },
    ];
    const rows = files.map(file => {
      const name = file.path.split('/').pop();
      const dir = file.path.slice(0, file.path.length - name.length).replace(/\/$/, '');
      const ext = name.split('.').pop();
      return `<div class="agent-file-change-row"><span class="agent-file-ext" data-ext="${ext}">${ext}</span>
        <span class="agent-file-change-name">${name}</span><span class="agent-file-change-dir">${dir}</span>
        <span class="agent-file-change-stats"><span class="is-added">+${file.additions}</span><span class="is-deleted">-${file.deletions}</span></span>
        <span class="agent-file-change-actions"><button type="button">审查</button><button type="button">打开</button></span></div>`;
    }).join('');
    document.querySelector('#agent-output').innerHTML = `<article class="agent-message agent-message-agent"><div class="agent-message-body">
      <details class="agent-artifact-card agent-file-changes" open><summary><span>2 个文件已更改</span>
      <span class="agent-change-inline"><span class="is-added">+151</span><span class="is-deleted">-10</span></span>
      <span class="agent-work-report-chevron">›</span></summary>
      <div class="agent-file-change-list">${rows}</div></details></div></article>`;
  });
  await new Promise(resolve => setTimeout(resolve, 200));

  const probe = await page.evaluate(() => {
    return [...document.querySelectorAll('.agent-file-change-row')].map(row => {
      const rect = row.getBoundingClientRect();
      const name = row.querySelector('.agent-file-change-name').getBoundingClientRect();
      const dir = row.querySelector('.agent-file-change-dir').getBoundingClientRect();
      const actions = row.querySelector('.agent-file-change-actions');
      return {
        height: Math.round(rect.height),
        scrollWidth: row.scrollWidth,
        clientWidth: row.clientWidth,
        dirOnSameLine: Math.abs(dir.top - name.top) < 8,
        actionsVisible: actions.getBoundingClientRect().width > 0,
        buttons: [...actions.querySelectorAll('button')].map(btn => Math.round(btn.getBoundingClientRect().height)),
      };
    });
  });
  if (probe.length !== 2) {
    throw new Error(`文件变更行数量异常：${probe.length}`);
  }
  probe.forEach((row, index) => {
    if (row.height > 46) throw new Error(`第 ${index + 1} 行文件变更被撑成多行：${row.height}px`);
    if (!row.dirOnSameLine) throw new Error(`第 ${index + 1} 行目录换行到下一行`);
    if (row.scrollWidth > row.clientWidth + 1) throw new Error(`第 ${index + 1} 行横向溢出：${row.scrollWidth}>${row.clientWidth}`);
    if (!row.actionsVisible) throw new Error(`第 ${index + 1} 行操作按钮不可见`);
    // 全局 button 规则会带 38px min-height，文件行按钮必须被压回 24px
    row.buttons.forEach(height => {
      if (height > 28) throw new Error(`文件行按钮被全局样式撑高：${height}px`);
    });
  });
  await page.evaluate(() => {
    document.querySelector('#agent-output').innerHTML = '';
  });
}

// 执行过程折叠：任务结束后最终回复只剩最后一段，中间过程必须在消息里保留并可展开
async function runProcessCollapseInteraction(page) {
  await page.waitForSelector('#agent-output', { timeout: pageTimeoutMs });
  const hasHelper = await page.evaluate(() => typeof window.renderMessageProcess === 'function');
  if (!hasHelper) throw new Error('renderMessageProcess 未注册，无法渲染执行过程');

  await page.evaluate(() => {
    const out = document.querySelector('#agent-output');
    out.innerHTML = `<article class="agent-message agent-message-agent"><div class="agent-message-body">
      ${window.renderMessageProcess({ id: 'msg-process-test', content: '最终答复', processSegments: ['第一段过程', '第二段过程'] })}
      <div class="agent-message-bubble agent-agent-bubble">最终答复</div>
    </div></article>`;
  });
  await new Promise(resolve => setTimeout(resolve, 200));

  const probe = await page.evaluate(() => {
    const details = document.querySelector('.agent-process-details');
    const bubbles = [...document.querySelectorAll('.agent-process-bodies .agent-message-bubble')];
    const second = bubbles[1];
    return {
      found: Boolean(details),
      open: details?.open === true,
      summary: details?.querySelector('summary')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      bubbleCount: bubbles.length,
      texts: bubbles.map(item => item.textContent.trim()),
      separator: second ? parseFloat(getComputedStyle(second).borderTopWidth) || 0 : 0,
      chevron: Boolean(details?.querySelector('.agent-work-report-chevron')),
    };
  });
  if (!probe.found) throw new Error('执行过程折叠块缺失');
  if (probe.open) throw new Error('有最终回复时执行过程应默认收起');
  if (!/执行过程/.test(probe.summary) || !/2 段/.test(probe.summary)) {
    throw new Error(`执行过程标题异常：${probe.summary}`);
  }
  if (probe.bubbleCount !== 2) throw new Error(`执行过程分段数量异常：${probe.bubbleCount}`);
  if (probe.texts.join('|') !== '第一段过程|第二段过程') {
    throw new Error(`执行过程分段内容异常：${probe.texts.join('|')}`);
  }
  if (probe.separator <= 0) throw new Error('执行过程分段之间缺少分隔线');
  if (!probe.chevron) throw new Error('执行过程缺少展开箭头');

  // 没有最终正文时（任务中途失败）必须默认展开，避免过程内容被藏起来
  const emptyProbe = await page.evaluate(() => {
    const out = document.querySelector('#agent-output');
    out.innerHTML = window.renderMessageProcess({ id: 'msg-process-empty', content: '', processSegments: ['只有过程'] });
    const details = document.querySelector('.agent-process-details');
    return { open: details?.open === true, count: document.querySelectorAll('.agent-process-bodies .agent-message-bubble').length };
  });
  if (!emptyProbe.open) throw new Error('无最终正文时执行过程应默认展开');
  if (emptyProbe.count !== 1) throw new Error(`无最终正文时过程段数异常：${emptyProbe.count}`);

  await page.evaluate(() => {
    document.querySelector('#agent-output').innerHTML = '';
  });
}

async function runComposerIconInteraction(page) {
  await page.waitForSelector('#agent-composer-footer, .agent-composer-footer', { timeout: pageTimeoutMs });
  const icons = await page.evaluate(() => {
    const pick = id => document.getElementById(id);
    const read = id => {
      const el = pick(id);
      return el ? { svg: el.querySelectorAll('svg').length, text: (el.innerText || '').trim() } : null;
    };
    return {
      plus: read('agent-plus-btn'),
      tools: read('agent-composer-tools-btn'),
      model: read('agent-model-btn'),
      mode: read('agent-mode-btn'),
    };
  });
  for (const [name, info] of Object.entries(icons)) {
    if (!info) throw new Error(`工具条按钮缺失：${name}`);
    if (info.svg < 1) throw new Error(`工具条按钮 ${name} 不是 SVG 图标（残留文字：${info.text}）`);
  }
  // 图标不能被按钮字号撑满（曾出现 30px 图标塞进 30px 按钮，糊成一团）
  const sizes = await page.evaluate(() => {
    const out = {};
    for (const id of ['agent-plus-btn', 'agent-composer-tools-btn', 'agent-model-btn']) {
      const el = document.getElementById(id);
      const svg = el?.querySelector('svg');
      if (!svg) continue;
      out[id] = { btn: Math.round(el.getBoundingClientRect().width), svg: Math.round(svg.getBoundingClientRect().width) };
    }
    return out;
  });
  for (const [id, size] of Object.entries(sizes)) {
    // 桌面端「会话选项」按钮按设计隐藏（宽 0），不参与尺寸判断
    if (size.btn === 0) continue;
    if (size.svg >= size.btn - 2) {
      throw new Error(`${id} 图标被撑满按钮：svg=${size.svg} btn=${size.btn}`);
    }
  }
  // 会话选项面板只保留没有其它入口的字段，重复项应已移除
  const panel = await page.evaluate(() => {
    const root = document.getElementById('agent-composer-options');
    if (!root) return null;
    const visibleLabels = [...root.querySelectorAll('label')]
      .filter(label => getComputedStyle(label).display !== 'none')
      .map(label => (label.innerText || '').trim().split('\n')[0]);
    return { visibleLabels, hasHiddenState: Boolean(root.querySelector('.agent-composer-hidden-state')) };
  });
  if (panel) {
    if (!panel.hasHiddenState) {
      throw new Error('会话选项缺少隐藏状态源（模型/思考档位需要保留唯一数据源）');
    }
    // 模型与思考档位已由工具条/模型卡片承载，面板里不应再出现
    for (const removed of ['模型', '思考等级', '任务模式']) {
      if (panel.visibleLabels.includes(removed)) {
        throw new Error(`会话选项仍重复展示「${removed}」：${panel.visibleLabels.join(',')}`);
      }
    }
  }
}

// 模型选择卡片（对齐 ZCode）：供应商行 / 模型行徽章 / 思考强度滑块三段结构
async function runModelMenuCardInteraction(page) {
  await page.waitForSelector('#agent-model-btn', { timeout: pageTimeoutMs });
  await clickAndWait(page, '#agent-model-btn', 300);
  await page.waitForSelector('#agent-model-menu:not(.hidden)', { timeout: pageTimeoutMs });

  const card = await page.evaluate(() => {
    const menu = document.querySelector('#agent-model-menu');
    const rect = menu?.getBoundingClientRect() || { width: 0, height: 0 };
    return {
      width: Math.round(rect.width),
      hasProviderRow: Boolean(menu?.querySelector('#agent-model-menu-provider-row')),
      hasModelList: Boolean(menu?.querySelector('#agent-model-menu-list')),
      hasEffort: Boolean(menu?.querySelector('#agent-model-menu-effort')),
      hasSlider: Boolean(menu?.querySelector('#agent-effort-range')),
      providerName: menu?.querySelector('#agent-model-menu-provider')?.textContent?.trim() || '',
      stopCount: menu?.querySelectorAll('.agent-effort-stop').length || 0,
      // 三段顺序：供应商行 → 列表 → 滑块
      order: [...(menu?.children || [])].map(child => child.id || child.className).join('>'),
    };
  });
  if (!card.hasProviderRow || !card.hasModelList || !card.hasEffort || !card.hasSlider) {
    throw new Error(`模型卡片结构不完整：${JSON.stringify(card)}`);
  }
  if (card.width < 240 || card.width > 420) {
    throw new Error(`模型卡片宽度异常：${card.width}`);
  }
  if (!card.providerName) {
    throw new Error('供应商行没有显示当前供应商名称');
  }

  // 供应商行：点开为供应商列表，再点同一条目回到模型列表
  await clickAndWait(page, '#agent-model-menu-provider-row', 300);
  const providersView = await page.evaluate(() => {
    const menu = document.querySelector('#agent-model-menu');
    return {
      isProviders: menu?.classList.contains('is-providers') === true,
      items: menu?.querySelectorAll('#agent-model-menu-list .agent-model-provider').length || 0,
      effortHidden: getComputedStyle(menu?.querySelector('#agent-model-menu-effort')).display === 'none',
    };
  });
  if (!providersView.isProviders || providersView.items < 2) {
    throw new Error(`供应商列表没有渲染：${JSON.stringify(providersView)}`);
  }
  if (!providersView.effortHidden) {
    throw new Error('供应商列表视图下思考强度滑块应隐藏');
  }
  // 选中默认供应商，回到模型列表
  await clickAndWait(page, '#agent-model-menu-list .agent-model-provider[data-provider-key="__default__"]', 300);
  const backToModels = await page.evaluate(() => {
    const menu = document.querySelector('#agent-model-menu');
    return {
      isProviders: menu?.classList.contains('is-providers') === true,
      hasModelItem: Boolean(menu?.querySelector('.agent-model-item')),
      effortVisible: menu?.querySelector('#agent-model-menu-effort') && getComputedStyle(menu.querySelector('#agent-model-menu-effort')).display !== 'none',
    };
  });
  if (backToModels.isProviders || !backToModels.hasModelItem || !backToModels.effortVisible) {
    throw new Error(`选中供应商后没有回到模型列表：${JSON.stringify(backToModels)}`);
  }

  // 思考强度滑块：拖到某一档后，隐藏的 select 必须同步，且填充条随之变宽
  const slider = await page.evaluate(() => {
    const range = document.querySelector('#agent-effort-range');
    const options = [...document.querySelector('#agent-variant').options]
      .filter(option => option.value && option.value !== '__custom__');
    return { max: Number(range?.max || 0), optionCount: options.length, first: options[0]?.value || '' };
  });
  if (slider.max < 1) {
    throw new Error(`思考强度滑块档位不足：max=${slider.max} options=${slider.optionCount}`);
  }
  await page.evaluate(() => {
    const range = document.querySelector('#agent-effort-range');
    range.value = range.max;
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  const afterSlide = await page.evaluate(() => {
    const range = document.querySelector('#agent-effort-range');
    const select = document.querySelector('#agent-variant');
    const fill = document.querySelector('#agent-effort-fill');
    const label = document.querySelector('#agent-effort-label');
    return {
      selectValue: select?.value || '',
      rangeValue: Number(range?.value ?? -1),
      fillWidth: fill ? fill.style.width : '',
      isMax: fill?.dataset.max === 'true',
      label: label?.textContent?.trim() || '',
      bubbles: document.querySelectorAll('.agent-effort-bubble').length,
    };
  });
  if (afterSlide.selectValue !== slider.first && !afterSlide.selectValue) {
    throw new Error(`滑块没有同步到档位 select：${JSON.stringify(afterSlide)}`);
  }
  if (afterSlide.rangeValue !== slider.max || !afterSlide.fillWidth) {
    throw new Error(`滑块填充没有更新：${JSON.stringify(afterSlide)}`);
  }
  if (!afterSlide.isMax || afterSlide.bubbles === 0) {
    throw new Error(`最高档没有进入渐变+气泡状态：${JSON.stringify(afterSlide)}`);
  }
  if (!afterSlide.label || afterSlide.label === '默认') {
    throw new Error(`最高档标签没有更新：${afterSlide.label}`);
  }

  // 圆点必须完整显示、圆心压在填充条末端且垂直居中：
  // 曾因圆点放在 overflow:hidden 轨道内被裁掉，又因 margin 折叠整体下移 4px
  const alignment = await page.evaluate(() => {
    const track = document.querySelector('.agent-effort-track');
    const fill = document.querySelector('#agent-effort-fill');
    const thumb = document.querySelector('#agent-effort-thumb');
    const slider = document.querySelector('#agent-effort-slider');
    const t = track.getBoundingClientRect();
    const f = fill.getBoundingClientRect();
    const th = thumb.getBoundingClientRect();
    const s = slider.getBoundingClientRect();
    return {
      centerVsFillRight: Math.round((th.left + th.right) / 2 - f.right),
      thumbOverflowRight: Math.round(th.right - t.right),
      thumbOverflowLeft: Math.round(t.left - th.left),
      thumbWidth: Math.round(th.width),
      // 垂直居中：圆点中心与轨道中心、滑块中心三者应一致
      thumbCenterVsTrackCenter: Math.round((th.top + th.bottom) / 2 - (t.top + t.bottom) / 2),
      thumbCenterVsSliderCenter: Math.round((th.top + th.bottom) / 2 - (s.top + s.bottom) / 2),
      trackHeight: Math.round(t.height),
      thumbHeight: Math.round(th.height),
    };
  });
  if (Math.abs(alignment.centerVsFillRight) > 2) {
    throw new Error(`滑块圆点没有对齐填充末端：${JSON.stringify(alignment)}`);
  }
  if (alignment.thumbOverflowRight > 1 || alignment.thumbOverflowLeft > 1) {
    throw new Error(`滑块圆点被轨道裁切：${JSON.stringify(alignment)}`);
  }
  if (Math.abs(alignment.thumbCenterVsTrackCenter) > 1 || Math.abs(alignment.thumbCenterVsSliderCenter) > 1) {
    throw new Error(`滑块圆点没有垂直居中：${JSON.stringify(alignment)}`);
  }
  if (alignment.thumbWidth !== alignment.thumbHeight) {
    throw new Error(`滑块圆点不是正圆：${JSON.stringify(alignment)}`);
  }

  // 点「主对话 API 模型」把选择复位，避免影响后续用例
  await page.evaluate(() => {
    const item = document.querySelector('.agent-model-item[data-model-value=""]');
    item?.click();
  });
  await new Promise(resolve => setTimeout(resolve, 250));
}

// 模型选择卡片：打开 → 供应商视图 → 进入管理模型（新 UI 的「管理模型」在供应商二级列表里）
async function openModelManagerFromComposerMenu(page) {
  await page.waitForSelector('#agent-model-btn', { timeout: pageTimeoutMs });
  await clickAndWait(page, '#agent-model-btn', 250);
  await page.waitForSelector('#agent-model-menu:not(.hidden) #agent-model-menu-provider-row', { timeout: pageTimeoutMs });
  // 卡片默认展示模型列表，点顶部供应商行切到供应商列表
  await clickAndWait(page, '#agent-model-menu-provider-row', 250);
  await page.waitForSelector('#agent-model-menu-list .agent-model-provider[data-provider-action="manage"]', { timeout: pageTimeoutMs });
  await clickAndWait(page, '#agent-model-menu-list .agent-model-provider[data-provider-action="manage"]', 350);
  await page.waitForSelector('#agent-model-manager-mask:not(.hidden)', { timeout: pageTimeoutMs });
}

// 获取模型：打开管理模型 → 添加供应商 → 点「获取模型」，校验弹窗与按钮布局（不发真实外网请求）
async function runProviderModelsInteraction(page, runtimeErrors = []) {
  await openModelManagerFromComposerMenu(page);
  // 没有供应商时左栏整体收起，添加按钮在空状态卡片里；有供应商时才用左栏按钮
  const emptyAddVisible = await page.evaluate(() => {
    const button = document.querySelector('[data-manager-empty-add]');
    return Boolean(button) && button.getBoundingClientRect().width > 0;
  });
  await clickAndWait(page, emptyAddVisible ? '[data-manager-empty-add]' : '#agent-model-manager-add', 300);
  await page.waitForSelector('[data-manager-model-fetch-btn]', { timeout: pageTimeoutMs });

  // 桌面端：模型列表头部两个按钮都不应被撑成整行
  const headLayout = await page.evaluate(() => {
    const head = document.querySelector('.agent-manager-models-head');
    const fetchBtn = document.querySelector('[data-manager-model-fetch-btn]');
    const addBtn = document.querySelector('[data-manager-model-add-btn]');
    return {
      headWidth: head?.getBoundingClientRect().width || 0,
      fetchWidth: fetchBtn?.getBoundingClientRect().width || 0,
      addWidth: addBtn?.getBoundingClientRect().width || 0,
    };
  });
  if (!headLayout.fetchWidth || headLayout.fetchWidth > headLayout.headWidth * 0.6) {
    throw new Error('「获取模型」按钮宽度异常（疑似被拉伸成整行）');
  }
  if (!headLayout.addWidth || headLayout.addWidth > headLayout.headWidth * 0.6) {
    throw new Error('「添加模型」按钮宽度异常（疑似被拉伸成整行）');
  }

  // 缺 Base URL 时点获取模型：应弹出弹窗并在弹窗内提示，不弹全屏 alert
  await clickAndWait(page, '[data-manager-model-fetch-btn]', 400);
  await page.waitForSelector('#agent-provider-models-mask:not(.hidden)', { timeout: pageTimeoutMs });
  await page.waitForSelector('#agent-provider-models-error:not(.hidden)', { timeout: pageTimeoutMs });
  const errorText = await page.evaluate(() => document.querySelector('#agent-provider-models-error')?.textContent || '');
  if (!/Base URL/.test(errorText)) {
    throw new Error(`获取模型缺少 Base URL 提示不明确：${errorText}`);
  }
  // 关闭后回到管理模型弹窗，不残留遮罩
  await clickAndWait(page, '#agent-provider-models-close', 300);
  const closed = await page.evaluate(() => document.querySelector('#agent-provider-models-mask')?.classList.contains('hidden') === true);
  if (!closed) {
    throw new Error('获取模型弹窗关闭失败');
  }

  // 旧进程场景：路由不存在 → 404，提示应指向“重启 Bot”，而不是通用兜底文案
  await page.setRequestInterception(true);
  const notFoundHandler = request => {
    if (request.url().includes('/api/agent-workbench/provider-models')) {
      request.respond({ status: 404, contentType: 'text/plain', body: 'Not Found' }).catch(() => {});
      return;
    }
    request.continue().catch(() => {});
  };
  page.on('request', notFoundHandler);
  const injectedErrorIndex = runtimeErrors.length;
  try {
    await setInputValue(page, '[data-manager-field="baseApi"]', 'https://stale-route.example.com/v1');
    await clickAndWait(page, '[data-manager-model-fetch-btn]', 700);
    await page.waitForSelector('#agent-provider-models-error:not(.hidden)', { timeout: pageTimeoutMs });
    const notFoundText = await page.evaluate(() => document.querySelector('#agent-provider-models-error')?.textContent || '');
    if (!/重启 Bot/.test(notFoundText) || /没有找到对应的数据或接口/.test(notFoundText)) {
      throw new Error(`路由缺失（404）提示没有指向重启：${notFoundText}`);
    }
  } finally {
    page.off('request', notFoundHandler);
    await page.setRequestInterception(false).catch(() => {});
  }
  await clickAndWait(page, '#agent-provider-models-close', 300);
  await setInputValue(page, '[data-manager-field="baseApi"]', '');
  // 这条 404 是测试主动注入的，不该算作真实前端异常：清掉收集器与本次追加记录
  await resetFrontendErrorCollector(page);
  runtimeErrors.splice(injectedErrorIndex);

  // 全链路：指向本地假供应商 → 拉取 → 勾选 → 添加进草稿
  await withFakeModelProvider(async providerBase => {
    await setInputValue(page, '[data-manager-field="name"]', 'E2E 渠道');
    await setInputValue(page, '[data-manager-field="baseApi"]', providerBase);
    await clickAndWait(page, '[data-manager-model-fetch-btn]', 900);
    await page.waitForSelector('#agent-provider-models-mask:not(.hidden)', { timeout: pageTimeoutMs });
    await page.waitForSelector('#agent-provider-models-list .agent-provider-models-item input:not([disabled])', { timeout: pageTimeoutMs });
    const fetched = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('#agent-provider-models-list .agent-provider-models-item'));
      return {
        names: items.map(item => item.textContent.trim()),
        selected: items.filter(item => item.querySelector('input')?.checked).length,
        countText: document.querySelector('#agent-provider-models-count')?.textContent || '',
      };
    });
    if (fetched.names.length !== 2 || !fetched.names.join(',').includes('e2e-model-a')) {
      throw new Error(`获取模型列表内容异常：${fetched.names.join(',')}`);
    }
    if (fetched.selected !== 2) {
      throw new Error(`获取模型未默认全选未添加模型：selected=${fetched.selected}`);
    }
    // 取消勾选一个，验证筛选框与勾选状态联动
    await clickAndWait(page, '#agent-provider-models-list .agent-provider-models-item:first-child', 200);
    const afterUncheck = await page.evaluate(() => document.querySelector('#agent-provider-models-count')?.textContent || '');
    if (!/已选 1 个/.test(afterUncheck)) {
      throw new Error(`取消勾选后计数未更新：${afterUncheck}`);
    }
    await setInputValue(page, '#agent-provider-models-filter', 'e2e-model-b');
    const filtered = await page.evaluate(() => document.querySelectorAll('#agent-provider-models-list .agent-provider-models-item').length);
    if (filtered !== 1) {
      throw new Error(`筛选框没有过滤列表：可见 ${filtered} 条`);
    }
    await clickAndWait(page, '#agent-provider-models-save', 400);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.agent-manager-model-row strong')).map(item => item.textContent.trim()));
    if (rows.length !== 1 || rows[0] !== 'e2e-model-b') {
      throw new Error(`添加所选结果异常：${rows.join(',') || '(空)'}`);
    }
  });
  await clickAndWait(page, '#agent-model-manager-close', 250);
}

async function runMemoryCenterInteraction(page) {
  await page.waitForSelector('#memory-stats .memory-stat-card', { timeout: interactionTimeoutMs });
  const statCount = await page.$$eval('#memory-stats .memory-stat-card', items => items.length);
  if (statCount < 4) throw new Error(`记忆概览卡片过少：${statCount}`);
  await clickAndWait(page, '[data-memory-tab="distill"]', 200);
  const distillVisible = await page.$eval('#memory-tab-distill', element => !element.classList.contains('hidden'));
  if (!distillVisible) throw new Error('切换到「从聊天提炼」后内容区没有显示');
  await clickAndWait(page, '[data-memory-tab="artifacts"]', 200);
  const artifactsVisible = await page.$eval('#memory-tab-artifacts', element => !element.classList.contains('hidden'));
  if (!artifactsVisible) throw new Error('切换到「人设与技能」后内容区没有显示');
  await clickAndWait(page, '[data-memory-tab="memories"]', 200);
}

async function runDataInsightInteraction(page) {
  await page.waitForSelector('.memory-tabs [data-insight-tab]', { timeout: interactionTimeoutMs });
  for (const tab of ['profiles', 'affinity', 'memory', 'sessions']) {
    await clickAndWait(page, `[data-insight-tab="${tab}"]`, 250);
    const visible = await page.$eval(`#insight-tab-${tab}`, element => !element.classList.contains('hidden'));
    if (!visible) throw new Error(`数据洞察切换到 ${tab} 后内容区没有显示`);
  }
  const tabCount = await page.$$eval('[data-insight-tab]', buttons => buttons.length);
  if (tabCount !== 4) throw new Error(`数据洞察子页数量异常：${tabCount}`);
}

async function runInteractiveChecks(page, baseUrl, runtimeErrors) {
  const checks = [
    { label: 'API 设置草稿', path: '/api-settings.html', run: runApiSettingsInteraction },
    { label: '文件浏览打开与预览', path: '/file-browser.html', run: runFileBrowserInteraction },
    { label: '控制台全局搜索', path: '/index.html', run: runGlobalSearchInteraction },
    { label: '模拟调试安全发送', path: '/qq-simulator.html', run: runQqSimulatorInteraction },
    { label: '模拟调试深度预览', path: '/qq-simulator.html', run: runQqSimulatorDeepPreviewInteraction },
    { label: '依赖面板刷新与搜索', path: '/dependency-check.html', run: runDependencyInteraction },
    { label: 'Agent 斜杠命令面板', path: '/agent-workbench.html', run: runSlashMenuInteraction },
    { label: 'Agent 输入区模式切换', path: '/agent-workbench.html', run: runModeSwitchInteraction },
    { label: 'Agent 输入区图标统一', path: '/agent-workbench.html', run: runComposerIconInteraction },
    { label: 'Agent 实时命令格式', path: '/agent-workbench.html', run: runLiveCommandRenderInteraction },
    { label: 'Agent 分段输出', path: '/agent-workbench.html', run: runLiveSegmentRenderInteraction },
    { label: 'Agent 工具调用摘要行', path: '/agent-workbench.html', run: runToolSummaryRowInteraction },
    { label: 'Agent 文件变更行', path: '/agent-workbench.html', run: runFileChangeRowInteraction },
    { label: 'Agent 执行过程折叠', path: '/agent-workbench.html', run: runProcessCollapseInteraction },
    { label: 'Agent 消息操作条', path: '/agent-workbench.html', run: runMessageActionsInteraction },
    { label: 'Agent 侧栏折叠把手', path: '/agent-workbench.html', run: runContextHandleInteraction },
    { label: 'Agent 模型选择卡片', path: '/agent-workbench.html', run: runModelMenuCardInteraction },
    { label: 'Agent 上下文容量面板', path: '/agent-workbench.html', run: runContextUsagePanelInteraction },
    { label: 'Agent 管理模型获取模型', path: '/agent-workbench.html', run: (page, context = {}) => runProviderModelsInteraction(page, context.runtimeErrors || []) },
    { label: '记忆与人设分页', path: '/memory-center.html', run: runMemoryCenterInteraction },
    { label: '数据洞察分页', path: '/data-insight.html', run: runDataInsightInteraction },
  ];
  const results = [];
  for (const check of checks) {
    results.push(await runInteractionCheck(page, baseUrl, runtimeErrors, check));
  }
  return results;
}

async function inspectMobilePages(page, baseUrl, runtimeErrors, profile) {
  const results = [];
  await page.setViewport(profile.viewport);
  await new Promise(resolve => setTimeout(resolve, 250));
  for (const item of pages) {
    results.push(await inspectPage(page, baseUrl, item, runtimeErrors, {
      viewportLabel: profile.label,
      outputSubdir: profile.slug,
      checkMobileLayout: true,
    }));
  }
  // Agent 工作台的弹窗默认隐藏，静态探针量不到：这里实际打开「获取模型」再测窄屏布局
  results.push(await inspectMobileContextPopover(page, baseUrl, runtimeErrors, profile));
  results.push(await inspectMobileSlashMenu(page, baseUrl, runtimeErrors, profile));
  results.push(await inspectMobileModelMenuCard(page, baseUrl, runtimeErrors, profile));
  results.push(await inspectMobileProviderModels(page, baseUrl, runtimeErrors, profile));
  results.push(await inspectMobileModelRows(page, baseUrl, runtimeErrors, profile));
  results.push(await inspectMobileFileChangeRows(page, baseUrl, runtimeErrors, profile));
  results.push(await inspectMobileDashboardDensity(page, baseUrl, runtimeErrors, profile));
  results.push(await inspectMobileApiOverview(page, baseUrl, runtimeErrors, profile));
  return results;
}

// API 设置「配置摘要」窄屏：卡片不被同行等高原图撑高，标签保持胶囊（不被拉成椭圆）
async function inspectMobileApiOverview(page, baseUrl, runtimeErrors, profile) {
  const result = {
    label: 'API 设置配置摘要',
    path: '/api-settings.html',
    viewport: profile.label,
    ok: true,
    screenshotPath: '',
    size: 0,
    errors: [],
    layout: null,
  };
  const startedErrorIndex = runtimeErrors.length;
  try {
    await page.goto(new URL('/api-settings.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    await page.waitForSelector('.api-settings-overview-item', { timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 1200));

    const probes = await page.evaluate(() => {
      const checks = [];
      const push = (label, ok, detail = '') => checks.push({ label, ok, detail });
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const items = [...document.querySelectorAll('.api-settings-overview-item')];
      if (!items.length) { push('配置摘要卡片存在', false); return checks; }
      items.forEach((item, index) => {
        const title = item.querySelector('h4')?.textContent?.trim() || `#${index + 1}`;
        const tags = [...item.querySelectorAll('.api-settings-overview-tag')];
        // 胶囊高度必须贴住内容：被 grid stretch 拉开时会明显高于字号行高
        const stretched = tags.filter(tag => {
          const rect = tag.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(tag).lineHeight) || 16;
          return rect.height > lineHeight + 14;
        });
        push(`${title} 标签未被拉伸`, stretched.length === 0,
          stretched.map(tag => `${tag.textContent.trim().slice(0, 8)}:${Math.round(tag.getBoundingClientRect().height)}px`).join(','));
      });
      // 卡片本身也不该被同行撑高：高度应贴近内部内容
      const cardHeights = items.map(item => Math.round(item.getBoundingClientRect().height));
      push('卡片未被同行等高拉伸', new Set(cardHeights).size > 1 || cardHeights.length <= 1, `heights=${cardHeights.join('/')}`);
      push('页面无横向溢出', document.documentElement.scrollWidth <= viewportWidth + 1, `scrollW=${document.documentElement.scrollWidth}`);
      return checks;
    });
    const failed = probes.filter(probe => !probe.ok);
    if (failed.length) {
      result.errors.push(...failed.map(probe => `${probe.label}（${probe.detail}）`));
    }
    result.mobileFixProbes = probes;
    result.screenshotPath = path.join(outputDir, profile.slug, 'API 设置配置摘要.png');
    await fs.mkdir(path.dirname(result.screenshotPath), { recursive: true });
    await page.evaluate(() => document.querySelector('.api-settings-overview-panel')?.scrollIntoView({ block: 'start' }));
    await new Promise(resolve => setTimeout(resolve, 300));
    await page.screenshot({ path: result.screenshotPath, fullPage: false });
  } catch (error) {
    result.errors.push(error.message || String(error));
  }
  result.errors.push(...runtimeErrors.slice(startedErrorIndex));
  result.ok = result.errors.length === 0;
  if (result.ok) logPass(`API 设置配置摘要（${profile.label}）正常`);
  return result;
}

// 首页总览窄屏信息密度：标题区收起、操作条单行、KPI/资源双列，首屏必须露出数据
async function inspectMobileDashboardDensity(page, baseUrl, runtimeErrors, profile) {
  const result = {
    label: '总览页信息密度',
    path: '/index.html',
    viewport: profile.label,
    ok: true,
    screenshotPath: '',
    size: 0,
    errors: [],
    layout: null,
  };
  const startedErrorIndex = runtimeErrors.length;
  try {
    await page.goto(new URL('/index.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    await page.waitForSelector('.kpi-band', { timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 1200));
    // 关掉「发现新版本」弹窗，避免遮挡测量
    await page.evaluate(() => document.querySelector('#modal-cancel-btn')?.click());
    await new Promise(resolve => setTimeout(resolve, 400));

    const probes = await page.evaluate(() => {
      const checks = [];
      const push = (label, ok, detail = '') => checks.push({ label, ok, detail });
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      // 标题收起只约束紧凑布局（窄屏或矮视口）；宽屏标题保留
      if (viewportWidth <= 700 || viewportHeight <= 520) {
        const heroCopy = document.querySelector('.hero .hero-copy');
        const heroCopyHidden = !heroCopy || getComputedStyle(heroCopy).display === 'none'
          || heroCopy.getBoundingClientRect().height === 0;
        push('标题区已收起（顶栏已有页面名）', heroCopyHidden);
      }
      const band = document.querySelector('.kpi-band');
      if (band) {
        const cols = getComputedStyle(band).gridTemplateColumns.split(' ').filter(Boolean).length;
        push('KPI 指标卡至少双列', cols >= 2, `cols=${cols}`);
        const firstCard = band.querySelector('.kpi-card');
        if (firstCard) {
          const cardRect = firstCard.getBoundingClientRect();
          push('KPI 卡宽度不超过 55% 屏宽', cardRect.width <= viewportWidth * 0.55, `w=${Math.round(cardRect.width)} vw=${viewportWidth}`);
        }
      } else {
        push('KPI 指标卡存在', false);
      }
      const strip = document.querySelector('.resource-strip');
      if (strip) {
        const cols = getComputedStyle(strip).gridTemplateColumns.split(' ').filter(Boolean).length;
        push('资源条至少双列', cols >= 2, `cols=${cols}`);
      }
      // 首屏必须已经滚到数据：第一个数据面板顶边不超过视口 60% 高度
      // （横屏视口矮，顶栏+搜索+操作条合计约 220px，用同一比例仍然能拦住回归到 400px+ 的情况）
      const firstPanel = document.querySelector('[data-module-id="kpi"]');
      if (firstPanel) {
        const top = firstPanel.getBoundingClientRect().top;
        push('首屏即见数据', top <= viewportHeight * 0.6 && top > 0, `top=${Math.round(top)} vh=${viewportHeight}`);
      }
      push('页面无横向溢出', document.documentElement.scrollWidth <= viewportWidth + 1, `scrollW=${document.documentElement.scrollWidth}`);
      return checks;
    });
    const failed = probes.filter(probe => !probe.ok);
    if (failed.length) {
      result.errors.push(...failed.map(probe => `${probe.label}（${probe.detail}）`));
    }
    result.mobileFixProbes = probes;
    result.screenshotPath = path.join(outputDir, profile.slug, '总览页信息密度.png');
    await fs.mkdir(path.dirname(result.screenshotPath), { recursive: true });
    await page.screenshot({ path: result.screenshotPath, fullPage: false });
  } catch (error) {
    result.errors.push(error.message || String(error));
  }
  result.errors.push(...runtimeErrors.slice(startedErrorIndex));
  result.ok = result.errors.length === 0;
  if (result.ok) logPass(`总览页信息密度（${profile.label}）正常`);
  return result;
}

// 斜杠命令面板窄屏：不溢出、行高够触控、分组与快捷键提示保留
async function inspectMobileSlashMenu(page, baseUrl, runtimeErrors, profile) {
  const result = {
    label: 'Agent 斜杠命令面板',
    path: '/agent-workbench.html',
    viewport: profile.label,
    ok: true,
    screenshotPath: '',
    size: 0,
    errors: [],
    layout: null,
  };
  const startedErrorIndex = runtimeErrors.length;
  try {
    await page.goto(new URL('/agent-workbench.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    await page.waitForSelector('#agent-prompt', { timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 900));
    await page.evaluate(() => {
      const input = document.querySelector('#agent-prompt');
      input.value = '/';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
    await page.waitForSelector('#agent-slash-menu:not(.hidden)', { timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 250));

    const probes = await page.evaluate(() => {
      const checks = [];
      const push = (label, ok, detail = '') => checks.push({ label, ok, detail });
      const menu = document.querySelector('#agent-slash-menu');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      if (!menu) {
        push('斜杠面板存在', false);
        return checks;
      }
      const rect = menu.getBoundingClientRect();
      push('面板不溢出视口', rect.left >= -1 && rect.right <= viewportWidth + 1, `l=${Math.round(rect.left)} r=${Math.round(rect.right)} vw=${viewportWidth}`);
      push('页面无横向滚动', document.documentElement.scrollWidth <= viewportWidth + 1, `scrollW=${document.documentElement.scrollWidth}`);
      const item = menu.querySelector('.agent-slash-item');
      const isNarrow = window.matchMedia('(max-width: 760px)').matches;
      if (item) {
        // 窄屏放大触控目标；横屏（>760px）沿用桌面紧凑行高
        const minHeight = isNarrow ? 40 : 32;
        push('命令行高度合理', item.getBoundingClientRect().height >= minHeight, `h=${Math.round(item.getBoundingClientRect().height)} min=${minHeight}`);
      }
      push('保留分组标题', menu.querySelectorAll('.agent-slash-group-title').length >= 2, `groups=${menu.querySelectorAll('.agent-slash-group-title').length}`);
      push('保留快捷键提示', menu.querySelectorAll('.agent-slash-foot kbd').length >= 3, `kbd=${menu.querySelectorAll('.agent-slash-foot kbd').length}`);
      // 行内别名只在窄屏隐藏，避免把说明挤成省略号
      const alias = menu.querySelector('.agent-slash-alias');
      if (alias && isNarrow) push('窄屏隐藏别名', getComputedStyle(alias).display === 'none', `display=${getComputedStyle(alias).display}`);
      return checks;
    });
    const failed = probes.filter(probe => !probe.ok);
    if (failed.length) {
      result.errors.push(...failed.map(probe => `${probe.label}（${probe.detail}）`));
    }
    result.mobileFixProbes = probes;
    result.screenshotPath = path.join(outputDir, profile.slug, 'Agent 斜杠命令面板.png');
    await fs.mkdir(path.dirname(result.screenshotPath), { recursive: true });
    await page.screenshot({ path: result.screenshotPath, fullPage: false });
  } catch (error) {
    result.errors.push(error.message || String(error));
  }
  result.errors.push(...runtimeErrors.slice(startedErrorIndex));
  result.ok = result.errors.length === 0;
  if (result.ok) logPass(`Agent 斜杠命令面板（${profile.label}）正常`);
  return result;
}

// 上下文容量面板窄屏：居中、不超出视口、不被拉成整行
async function inspectMobileContextPopover(page, baseUrl, runtimeErrors, profile) {
  const result = {
    label: 'Agent 上下文容量面板',
    path: '/agent-workbench.html',
    viewport: profile.label,
    ok: true,
    screenshotPath: '',
    size: 0,
    errors: [],
    layout: null,
  };
  const startedErrorIndex = runtimeErrors.length;
  try {
    await page.goto(new URL('/agent-workbench.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    await page.waitForSelector('#agent-context-usage-trigger', { timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 900));
    await page.evaluate(() => {
      const menu = document.querySelector('#agent-context-usage-menu');
      menu.open = true;
      menu.dispatchEvent(new Event('toggle'));
    });
    // 合成 toggle 事件不保证走完原生流程，用一次 resize 触发同一套定位逻辑
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise(resolve => setTimeout(resolve, 250));
    await page.waitForSelector('.agent-context-usage-popover', { timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 300));

    const probes = await page.evaluate(() => {
      const checks = [];
      const push = (label, ok, detail = '') => checks.push({ label, ok, detail });
      const pop = document.querySelector('.agent-context-usage-popover');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      if (!pop) {
        push('上下文面板存在', false);
        return checks;
      }
      const rect = pop.getBoundingClientRect();
      push('面板不超出视口', rect.left >= -1 && rect.right <= viewportWidth + 1, `left=${Math.round(rect.left)} right=${Math.round(rect.right)} vw=${viewportWidth}`);
      // 不能横向铺满（旧规则是 left/right 都钉 12px，会被拉成整行）
      push('面板宽度随内容而非铺满', rect.width < viewportWidth - 40, `w=${Math.round(rect.width)} vw=${viewportWidth}`);
      // 关键约束：面板必须留在视口内，且宽度跟随内容不被拉满。
      // 不做「相对聊天区居中/贴边」的判断——桌面锚定的是输入区容器，手机是聊天区，两者基准不同。
      const host = pop.closest('.agent-chat-panel') || document.body;
      const hostRect = host.getBoundingClientRect();
      push('面板不超出聊天区', rect.left >= hostRect.left - 1 && rect.right <= hostRect.right + 1, `pop=${Math.round(rect.left)}-${Math.round(rect.right)} host=${Math.round(hostRect.left)}-${Math.round(hostRect.right)}`);
      return checks;
    });
    const failed = probes.filter(probe => !probe.ok);
    if (failed.length) {
      result.errors.push(...failed.map(probe => `${probe.label}（${probe.detail}）`));
    }
    result.mobileFixProbes = probes;
    result.screenshotPath = path.join(outputDir, profile.slug, 'Agent 上下文容量面板.png');
    await fs.mkdir(path.dirname(result.screenshotPath), { recursive: true });
    await page.screenshot({ path: result.screenshotPath, fullPage: false });
  } catch (error) {
    result.errors.push(error.message || String(error));
  }
  result.errors.push(...runtimeErrors.slice(startedErrorIndex));
  result.ok = result.errors.length === 0;
  if (result.ok) logPass(`Agent 上下文容量面板（${profile.label}）正常`);
  return result;
}

// 模型卡片窄屏：卡片不超出视口、模型列表可滚动、滑块可点
async function inspectMobileModelMenuCard(page, baseUrl, runtimeErrors, profile) {
  const result = {
    label: 'Agent 模型选择卡片',
    path: '/agent-workbench.html',
    viewport: profile.label,
    ok: true,
    screenshotPath: '',
    size: 0,
    errors: [],
    layout: null,
  };
  const startedErrorIndex = runtimeErrors.length;
  try {
    await page.goto(new URL('/agent-workbench.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    await page.waitForSelector('#agent-model-btn', { timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 900));
    await clickAndWait(page, '#agent-model-btn', 400);
    await page.waitForSelector('#agent-model-menu:not(.hidden)', { timeout: pageTimeoutMs });

    const probes = await page.evaluate(() => {
      const checks = [];
      const push = (label, ok, detail = '') => checks.push({ label, ok, detail });
      const menu = document.querySelector('#agent-model-menu');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      if (!menu) {
        push('模型卡片存在', false);
        return checks;
      }
      const rect = menu.getBoundingClientRect();
      push('卡片宽度不超出视口', rect.width <= viewportWidth + 1, `card=${Math.round(rect.width)} viewport=${viewportWidth}`);
      push('卡片左右完整可见', rect.left >= -1 && rect.right <= viewportWidth + 1, `left=${Math.round(rect.left)} right=${Math.round(rect.right)}`);
      push('卡片上下不超出视口', rect.top >= -1 && rect.bottom <= viewportHeight + 1, `top=${Math.round(rect.top)} bottom=${Math.round(rect.bottom)}`);
      const list = menu.querySelector('#agent-model-menu-list');
      if (list) {
        push('模型列表可滚动', ['auto', 'scroll'].includes(getComputedStyle(list).overflowY), `overflowY=${getComputedStyle(list).overflowY}`);
      }
      const slider = menu.querySelector('#agent-model-menu-effort');
      if (slider) {
        const sliderRect = slider.getBoundingClientRect();
        push('思考强度滑块在卡片内', sliderRect.bottom <= rect.bottom + 1, `sliderBottom=${Math.round(sliderRect.bottom)} cardBottom=${Math.round(rect.bottom)}`);
      }
      const row = menu.querySelector('#agent-model-menu-provider-row');
      if (row) {
        push('供应商行触控高度足够', row.getBoundingClientRect().height >= 40, `height=${Math.round(row.getBoundingClientRect().height)}`);
      }
      return checks;
    });
    const failed = probes.filter(probe => !probe.ok);
    if (failed.length) {
      result.errors.push(...failed.map(probe => `${probe.label}（${probe.detail}）`));
    }
    result.mobileFixProbes = probes;
    result.screenshotPath = path.join(outputDir, profile.slug, 'Agent 模型选择卡片.png');
    await fs.mkdir(path.dirname(result.screenshotPath), { recursive: true });
    await page.screenshot({ path: result.screenshotPath, fullPage: false });
  } catch (error) {
    result.errors.push(error.message || String(error));
  }
  result.errors.push(...runtimeErrors.slice(startedErrorIndex));
  result.ok = result.errors.length === 0;
  if (result.ok) logPass(`Agent 模型选择卡片（${profile.label}）正常`);
  return result;
}

async function inspectMobileProviderModels(page, baseUrl, runtimeErrors, profile) {
  const result = {
    label: 'Agent 获取模型弹窗',
    path: '/agent-workbench.html',
    viewport: profile.label,
    ok: true,
    screenshotPath: '',
    size: 0,
    errors: [],
    layout: null,
  };
  const startedErrorIndex = runtimeErrors.length;
  try {
    await page.goto(new URL('/agent-workbench.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 900));
    // 一次流程内完成：打开管理模型 → 添加供应商 → 获取模型，然后量布局并截图
    await openModelManagerFromComposerMenu(page);
    const emptyAddVisible = await page.evaluate(() => {
      const button = document.querySelector('[data-manager-empty-add]');
      return Boolean(button) && button.getBoundingClientRect().width > 0;
    });
    await clickAndWait(page, emptyAddVisible ? '[data-manager-empty-add]' : '#agent-model-manager-add', 300);
    await page.waitForSelector('[data-manager-model-fetch-btn]', { timeout: pageTimeoutMs });

    // 窄屏下模型列表头部的两个按钮不能被全局移动端规则拉满
    const headProbe = await page.evaluate(() => {
      const head = document.querySelector('.agent-manager-models-head');
      const headWidth = head?.getBoundingClientRect().width || 0;
      return Array.from(head?.querySelectorAll('.agent-quiet-btn') || []).map(button => ({
        label: button.textContent.trim(),
        width: button.getBoundingClientRect().width,
        headWidth,
      }));
    });
    for (const item of headProbe) {
      if (!item.width || item.width > Math.max(160, item.headWidth * 0.55)) {
        result.errors.push(`「${item.label}」按钮被拉伸（${Math.round(item.width)}/${Math.round(item.headWidth)}）`);
      }
    }

    await clickAndWait(page, '[data-manager-model-fetch-btn]', 500);
    await page.waitForSelector('#agent-provider-models-mask:not(.hidden)', { timeout: pageTimeoutMs });

    const probes = await page.evaluate(() => {
      const checks = [];
      const push = (label, ok, detail = '') => checks.push({ label, ok, detail });
      const dialog = document.querySelector('.agent-provider-models-dialog');
      const footer = dialog?.querySelector('.agent-settings-footer');
      const buttons = Array.from(dialog?.querySelectorAll('.agent-settings-footer .agent-quiet-btn') || []);
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      if (dialog) {
        const rect = dialog.getBoundingClientRect();
        push('获取模型弹窗未超出屏幕', rect.width <= viewportWidth + 1, `dialog=${Math.round(rect.width)} viewport=${viewportWidth}`);
        const close = dialog.querySelector('#agent-provider-models-close');
        const closeWidth = close ? parseFloat(getComputedStyle(close).width) || 0 : 0;
        push('获取模型关闭按钮为图标尺寸', closeWidth > 20 && closeWidth <= 56, `width=${Math.round(closeWidth)}`);
      }
      if (footer && buttons.length) {
        const footerWidth = footer.getBoundingClientRect().width;
        for (const button of buttons) {
          const width = button.getBoundingClientRect().width;
          push(`「${button.textContent.trim()}」按钮未独占整行`, width < footerWidth * 0.95, `button=${Math.round(width)} footer=${Math.round(footerWidth)}`);
        }
      }
      const toolbar = document.querySelector('.agent-provider-models-toolbar');
      if (toolbar && !toolbar.classList.contains('hidden')) {
        push('筛选行窄屏竖排', getComputedStyle(toolbar).flexDirection === 'column', `flexDirection=${getComputedStyle(toolbar).flexDirection}`);
      }
      return checks;
    });
    const failed = probes.filter(probe => !probe.ok);
    if (failed.length) {
      result.errors.push(...failed.map(probe => `${probe.label}（${probe.detail}）`));
    }
    result.mobileFixProbes = probes;
    result.screenshotPath = path.join(outputDir, profile.slug, 'Agent 获取模型弹窗.png');
    await fs.mkdir(path.dirname(result.screenshotPath), { recursive: true });
    await page.screenshot({ path: result.screenshotPath, fullPage: false });
  } catch (error) {
    result.errors.push(error.message || String(error));
  }
  result.errors.push(...runtimeErrors.slice(startedErrorIndex));
  result.ok = result.errors.length === 0;
  if (result.ok) logPass(`Agent 获取模型弹窗（${profile.label}）正常`);
  await clickAndWait(page, '#agent-provider-models-close', 150).catch(() => {});
  return result;
}

// 管理模型 · 已添加模型列表窄屏：一行一个、模型名不被压缩、说明文字不压住列表
async function inspectMobileModelRows(page, baseUrl, runtimeErrors, profile) {
  const result = {
    label: 'Agent 已添加模型列表',
    path: '/agent-workbench.html',
    viewport: profile.label,
    ok: true,
    screenshotPath: '',
    size: 0,
    errors: [],
    layout: null,
  };
  const startedErrorIndex = runtimeErrors.length;
  try {
    await page.goto(new URL('/agent-workbench.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    await page.waitForSelector('#agent-model-btn', { timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 900));
    await openModelManagerFromComposerMenu(page);
    await page.waitForSelector('.agent-manager-model-row', { timeout: pageTimeoutMs }).catch(() => null);
    await new Promise(resolve => setTimeout(resolve, 300));

    const probes = await page.evaluate(() => {
      const checks = [];
      const push = (label, ok, detail = '') => checks.push({ label, ok, detail });
      const rows = [...document.querySelectorAll('.agent-manager-model-row')];
      const hasProvider = Boolean(document.querySelector('.agent-model-manager-provider'));
      if (!rows.length) {
        // 隔离控制台默认没有配置供应商：这种情况跳过，不算失败
        if (!hasProvider) return [];
        push('模型列表有内容', false, '有供应商但没有渲染出模型行');
        return checks;
      }
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      // 每行四个元素（名称/徽章/编辑/删除）必须在同一行
      const first = rows[0];
      const tops = [...first.children].map(child => Math.round(child.getBoundingClientRect().top));
      push('模型行单行排布', Math.max(...tops) - Math.min(...tops) <= 12, `tops=${tops.join(',')}`);

      // 模型名按钮必须占剩余空间，不能被压成图标大小
      const nameBtn = first.querySelector('.agent-manager-model-edit');
      const nameWidth = nameBtn ? Math.round(nameBtn.getBoundingClientRect().width) : 0;
      const rowWidth = Math.round(first.getBoundingClientRect().width);
      push('模型名占据剩余宽度', nameWidth > rowWidth * 0.35, `name=${nameWidth} row=${rowWidth}`);

      // 图标按钮保持内容尺寸，不被全局移动端 100% 规则拉满
      const iconBtns = [...first.querySelectorAll('.agent-manager-model-edit, .agent-manager-model-remove')].slice(1);
      for (const btn of iconBtns) {
        const width = btn.getBoundingClientRect().width;
        push(`图标按钮（${btn.getAttribute('aria-label') || '编辑'}）未被拉满`, width <= 40, `width=${Math.round(width)}`);
      }

      // 行高紧凑：单行约 44px，不能变成多行大方块
      const rowHeight = Math.round(first.getBoundingClientRect().height);
      push('模型行高度紧凑', rowHeight <= 60, `h=${rowHeight}`);

      // 说明文字不得与最后一行模型重叠
      const hint = document.querySelector('.agent-model-manager-hint');
      const last = rows[rows.length - 1];
      if (hint && last) {
        const lr = last.getBoundingClientRect();
        const hr = hint.getBoundingClientRect();
        const overlap = Math.max(0, Math.min(lr.bottom, hr.bottom) - Math.max(lr.top, hr.top));
        push('说明文字未压住模型列表', overlap <= 1, `overlap=${Math.round(overlap)}`);
      }
      push('页面无横向溢出', document.documentElement.scrollWidth <= viewportWidth + 1, `scrollW=${document.documentElement.scrollWidth}`);
      return checks;
    });
    const failed = probes.filter(probe => !probe.ok);
    if (failed.length) {
      result.errors.push(...failed.map(probe => `${probe.label}（${probe.detail}）`));
    }
    result.mobileFixProbes = probes;
    result.screenshotPath = path.join(outputDir, profile.slug, 'Agent 已添加模型列表.png');
    await fs.mkdir(path.dirname(result.screenshotPath), { recursive: true });
    await page.evaluate(() => {
      const body = document.querySelector('.agent-model-manager-body');
      if (body) body.scrollTop = body.scrollHeight;
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    await page.screenshot({ path: result.screenshotPath, fullPage: false });
    await clickAndWait(page, '#agent-model-manager-close', 200).catch(() => {});
  } catch (error) {
    result.errors.push(error.message || String(error));
  }
  result.errors.push(...runtimeErrors.slice(startedErrorIndex));
  result.ok = result.errors.length === 0;
  if (result.ok) logPass(`Agent 已添加模型列表（${profile.label}）正常`);
  return result;
}

// 文件变更行窄屏：保持单行（目录跟在文件名后截断）、按钮紧凑且不被全局 38px 撑高
async function inspectMobileFileChangeRows(page, baseUrl, runtimeErrors, profile) {
  const result = {
    label: 'Agent 文件变更行',
    path: '/agent-workbench.html',
    viewport: profile.label,
    ok: true,
    screenshotPath: '',
    size: 0,
    errors: [],
    layout: null,
  };
  const startedErrorIndex = runtimeErrors.length;
  try {
    await page.goto(new URL('/agent-workbench.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    await page.waitForSelector('#agent-output', { timeout: pageTimeoutMs });
    await new Promise(resolve => setTimeout(resolve, 900));
    await page.evaluate(() => {
      const files = [
        { path: 'lib/webConsole/public/agent-workbench.js', additions: 120, deletions: 8 },
        { path: 'lib/webConsole/agentWorkbenchConsole.js', additions: 45, deletions: 3 },
      ];
      const rows = files.map(file => {
        const name = file.path.split('/').pop();
        const dir = file.path.slice(0, file.path.length - name.length).replace(/\/$/, '');
        const ext = name.split('.').pop();
        return `<div class="agent-file-change-row"><span class="agent-file-ext" data-ext="${ext}">${ext}</span>
          <span class="agent-file-change-name">${name}</span><span class="agent-file-change-dir">${dir}</span>
          <span class="agent-file-change-stats"><span class="is-added">+${file.additions}</span><span class="is-deleted">-${file.deletions}</span></span>
          <span class="agent-file-change-actions"><button type="button">审查</button><button type="button">打开</button></span></div>`;
      }).join('');
      document.querySelector('#agent-output').innerHTML = `<article class="agent-message agent-message-agent"><div class="agent-message-body">
        <details class="agent-artifact-card agent-file-changes" open><summary><span>2 个文件已更改</span>
        <span class="agent-change-inline"><span class="is-added">+165</span><span class="is-deleted">-11</span></span>
        <span class="agent-work-report-chevron">›</span></summary>
        <div class="agent-file-change-list">${rows}</div></details></div></article>`;
    });
    await new Promise(resolve => setTimeout(resolve, 300));

    const probes = await page.evaluate(() => {
      const checks = [];
      const push = (label, ok, detail = '') => checks.push({ label, ok, detail });
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const rows = [...document.querySelectorAll('.agent-file-change-row')];
      if (!rows.length) { push('文件变更行存在', false); return checks; }
      rows.forEach((row, index) => {
        const tag = `第 ${index + 1} 行`;
        const rect = row.getBoundingClientRect();
        const name = row.querySelector('.agent-file-change-name').getBoundingClientRect();
        const dir = row.querySelector('.agent-file-change-dir').getBoundingClientRect();
        push(`${tag}单行显示`, rect.height <= 46, `h=${Math.round(rect.height)}`);
        push(`${tag}目录未独占一行`, Math.abs(dir.top - name.top) < 8, `nameTop=${Math.round(name.top)} dirTop=${Math.round(dir.top)}`);
        push(`${tag}未横向溢出`, row.scrollWidth <= row.clientWidth + 1, `scrollW=${row.scrollWidth} clientW=${row.clientWidth}`);
        const buttons = [...row.querySelectorAll('.agent-file-change-actions button')];
        push(`${tag}操作按钮常显`, buttons.every(btn => btn.getBoundingClientRect().width > 0), `count=${buttons.length}`);
        push(`${tag}按钮未被全局样式撑高`, buttons.every(btn => btn.getBoundingClientRect().height <= 28), buttons.map(btn => Math.round(btn.getBoundingClientRect().height)).join('/'));
      });
      push('页面无横向溢出', document.documentElement.scrollWidth <= viewportWidth + 1, `scrollW=${document.documentElement.scrollWidth}`);
      return checks;
    });
    const failed = probes.filter(probe => !probe.ok);
    if (failed.length) {
      result.errors.push(...failed.map(probe => `${probe.label}（${probe.detail}）`));
    }
    result.mobileFixProbes = probes;
    result.screenshotPath = path.join(outputDir, profile.slug, 'Agent 文件变更行.png');
    await fs.mkdir(path.dirname(result.screenshotPath), { recursive: true });
    const clip = await page.evaluate(() => {
      const el = document.querySelector('.agent-file-changes');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: Math.max(0, rect.x - 8), y: Math.max(0, rect.y - 8), width: rect.width + 16, height: rect.height + 16 };
    });
    await page.screenshot({ path: result.screenshotPath, clip: clip || undefined });
  } catch (error) {
    result.errors.push(error.message || String(error));
  }
  result.errors.push(...runtimeErrors.slice(startedErrorIndex));
  result.ok = result.errors.length === 0;
  if (result.ok) logPass(`Agent 文件变更行（${profile.label}）正常`);
  return result;
}

async function inspectPage(page, baseUrl, item, runtimeErrors, options = {}) {
  const result = {
    label: item.label,
    path: item.path,
    viewport: options.viewportLabel || '桌面',
    ok: true,
    screenshotPath: '',
    size: 0,
    errors: [],
    layout: null,
  };
  const startedErrorIndex = runtimeErrors.length;
  const url = new URL(item.path, baseUrl).href;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
  await page.waitForSelector('body', { timeout: pageTimeoutMs });
  await resetFrontendErrorCollector(page);
  await new Promise(resolve => setTimeout(resolve, 1200));

  const expectedText = options.checkMobileLayout ? item.mobileText || item.text : item.text;
  const diagnostics = await page.evaluate(expectedTextValue => {
    const text = document.body?.innerText || '';
    const loadingTexts = Array.from(document.querySelectorAll('body *'))
      .filter(element => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
          return false;
        }
        // 通知面板未展开时保留“加载中...”占位，属于懒加载常态，不算页面卡住
        if (element.closest('.console-notifications-panel')) return false;
        const value = String(element.innerText || element.textContent || '').trim();
        return value === '加载中...' || value === '正在加载...';
      })
      .map(element => ({
        tag: element.tagName,
        id: element.id || '',
        className: String(element.className || '').slice(0, 120),
        text: String(element.innerText || element.textContent || '').trim(),
      }))
      .slice(0, 12);
    const frontendErrors = window.CrystelfFrontendErrors?.getSummary?.() || { recentCount: 0, recentItems: [] };
    return {
      bodyText: text,
      hasExpectedText: text.includes(expectedTextValue),
      hasSettingError: Array.from(document.querySelectorAll('.setting-error')).some(element => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
        return Boolean(String(element.innerText || element.textContent || '').trim());
      }),
      loadingTexts,
      frontendErrors: {
        recentCount: Number(frontendErrors.recentCount || 0),
        recentItems: (frontendErrors.recentItems || []).slice(0, 5).map(error => ({
          kind: error.kind,
          message: error.message,
          url: error.url,
          status: error.status,
          code: error.code,
        })),
      },
    };
  }, expectedText);

  if (!diagnostics.hasExpectedText) {
    result.errors.push(`未找到关键文案：${expectedText}`);
  }
  if (diagnostics.hasSettingError) {
    result.errors.push('页面存在 .setting-error 错误块');
  }
  if (diagnostics.loadingTexts.length > 0) {
    result.errors.push(`页面仍有加载中元素：${diagnostics.loadingTexts.map(entry => entry.id || entry.className || entry.tag).join(', ')}`);
  }
  const visibleFrontendErrors = diagnostics.frontendErrors.recentItems.filter(error => !shouldIgnoreFrontendErrorItem(error));
  if (visibleFrontendErrors.length > 0) {
    result.errors.push(`前端异常 ${visibleFrontendErrors.length} 条：${visibleFrontendErrors.map(error => error.message).join('；')}`);
  }

  if (options.checkMobileLayout) {
    result.layout = await readMobileLayoutDiagnostics(page);
    if (!result.layout.hasViewportMeta) {
      result.errors.push('缺少移动端 viewport 元标签');
    }
    const fixProbes = await readMobileFixProbes(page);
    result.mobileFixProbes = fixProbes;
    for (const probe of fixProbes) {
      if (!probe.ok) result.errors.push(`移动端样式回退：${probe.label}（${probe.detail}）`);
    }
    if (result.layout.overflowX > 12) {
      const offenders = result.layout.wideElements
        .map(element => element.id || element.className || element.tag)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      result.errors.push(`移动端页面横向溢出 ${result.layout.overflowX}px${offenders ? `，疑似元素：${offenders}` : ''}`);
    }
  }

  const pageRuntimeErrors = runtimeErrors.slice(startedErrorIndex);
  result.errors.push(...pageRuntimeErrors);

  const screenshotDir = options.outputSubdir ? path.join(outputDir, options.outputSubdir) : outputDir;
  await fs.mkdir(screenshotDir, { recursive: true });
  result.screenshotPath = path.join(screenshotDir, `${sanitizeFilename(item.label)}.png`);
  const imageBuffer = await page.screenshot({ fullPage: true, type: 'png' });
  await fs.writeFile(result.screenshotPath, imageBuffer);
  const stat = await fs.stat(result.screenshotPath);
  result.size = stat.size;
  if (stat.size <= 1024) {
    result.errors.push(`截图文件过小：${stat.size}`);
  }

  result.ok = result.errors.length === 0;
  if (result.ok) {
    logPass(`${options.viewportLabel || '桌面'} ${item.label}页面 E2E 正常`);
  }
  return result;
}

async function runBrowserE2e(baseUrl, token) {
  const results = [];
  const interactions = [];
  const mobilePages = [];
  const runtimeErrors = [];
  let csrfToken = '';

  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  await withPuppeteerPage(async page => {
    page.setDefaultTimeout(pageTimeoutMs);
    await page.setViewport(shouldRunDesktop
      ? { width: 1440, height: 960, deviceScaleFactor: 1 }
      : mobileViewports[0].viewport);
    page.on('dialog', async dialog => {
      if (dialog.type() !== 'beforeunload') {
        runtimeErrors.push(`dialog: ${dialog.type()} ${dialog.message()}`);
      }
      await dialog.accept().catch(() => {});
    });
    page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      const text = message.text();
      if (message.type() === 'error' && !/^Failed to load resource:/i.test(text)) {
        runtimeErrors.push(`console.error: ${message.text()}`);
      }
    });
    page.on('requestfailed', request => {
      const requestUrl = request.url();
      const errorText = request.failure()?.errorText || '';
      if (requestUrl.startsWith(baseUrl.origin) && !shouldIgnoreUrl(requestUrl) && !shouldIgnoreRequestFailure(errorText)) {
        runtimeErrors.push(`requestfailed: ${requestUrl} ${errorText}`.trim());
      }
    });
    page.on('response', response => {
      const responseUrl = response.url();
      if (responseUrl.startsWith(baseUrl.origin) && response.status() >= 400 && !shouldIgnoreUrl(responseUrl)) {
        runtimeErrors.push(`HTTP ${response.status()}: ${responseUrl}`);
      }
    });

    const auth = await ensureLoggedIn(page, baseUrl, token);
    csrfToken = String(auth?.csrfToken || '');
    if (shouldRunDesktop) {
      await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
      for (const item of pages) {
        results.push(await inspectPage(page, baseUrl, item, runtimeErrors));
      }
      interactions.push(...await runInteractiveChecks(page, baseUrl, runtimeErrors));
    }
    if (shouldRunMobile) {
      for (const profile of mobileViewports) {
        mobilePages.push(...await inspectMobilePages(page, baseUrl, runtimeErrors, profile));
      }
    }
    await checkCircuitResetApi(page, csrfToken);
  }, { idleCloseMs: 1000, maxConcurrentPages: 1 });

  return {
    pages: results,
    interactions,
    mobilePages,
  };
}

async function main() {
  let isolated = null;
  const externalUrl = process.env.WEB_CONSOLE_E2E_URL || '';
  try {
    if (!shouldRunDesktop && !shouldRunMobile) {
      fail('不能同时指定 --desktop-only 和 --mobile-only');
    }
    isolated = externalUrl
      ? null
      : await startIsolatedWebConsole();
    const baseUrl = externalUrl ? normalizeBaseUrl(externalUrl) : isolated.baseUrl;
    const token = isolated?.token || process.env.WEB_CONSOLE_E2E_TOKEN || process.env.WEB_CONSOLE_TOKEN || '';
    console.log(`控制台浏览器级 E2E：${baseUrl.origin}`);
    const results = await runBrowserE2e(baseUrl, token);
    const failed = [
      ...(results.pages || []),
      ...(results.interactions || []),
      ...(results.mobilePages || []),
    ].filter(item => !item.ok);
    console.log(JSON.stringify({
      ok: failed.length === 0,
      baseUrl: baseUrl.origin,
      outputDir,
      pages: results.pages || [],
      interactions: results.interactions || [],
      mobilePages: results.mobilePages || [],
    }, null, 2));
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    // Windows 上偶发 Chromium close 不返回，限制等待时间后继续清理，避免 CI/手动执行永久挂起
    await Promise.race([
      closeSharedPuppeteerBrowser().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 8000)),
    ]);
    await cleanupIsolatedWebConsole(isolated).catch(() => {});
  }
  // 浏览器句柄可能残留导致事件循环不退出；报告已输出，显式结束进程
  process.exit(process.exitCode || 0);
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
