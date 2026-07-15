import fs from 'fs/promises';
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
  { path: '/plugin-settings.html', label: '插件设置', text: '插件设置中心' },
  { path: '/api-settings.html', label: 'API 接口', text: 'API' },
  { path: '/config-diagnostics.html', label: '配置诊断', text: '配置来源诊断' },
  { path: '/frontend-diagnostics.html', label: '前端诊断', text: '前端错误诊断' },
  { path: '/group-summary-diagnostics.html', label: '群总结诊断', text: '群总结诊断' },
  { path: '/performance.html', label: '性能监测', text: '性能监测' },
  { path: '/group-management.html', label: '群管理', text: '群管理' },
  { path: '/qq-simulator.html', label: '模拟调试', text: '请求摘要', mobileText: '事件参数、附件与排查' },
  { path: '/command-center.html', label: '命令中心', text: '命令中心' },
  { path: '/file-browser.html', label: '文件编辑', text: '文件管理' },
  { path: '/bot-plugins.html', label: '插件管理', text: '机器人插件管理' },
  { path: '/dependency-check.html', label: '依赖健康', text: '依赖健康面板' },
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
  return /Host key verification failed|Could not read from remote repository|known_hosts.*Permission denied/i.test(message);
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
  const loginText = await page.evaluate(() => document.body?.innerText || '');
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
        await item.run(page);
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
      primarySdBaseApi: visible('#image-sdWebUi-baseApi'),
      primarySdSampler: visible('#image-sdWebUi-samplerName'),
      fallbackModel: visible('#image-fallback-model'),
      fallbackBaseApi: visible('#image-fallback-baseApi'),
      fallbackJimeng: visible('#image-fallback-jimengApiUrl'),
      fallbackSize: visible('#image-fallback-size'),
      fallbackOutputFormat: visible('#image-fallback-outputFormat'),
      fallbackSdBaseApi: visible('#image-fallback-sdWebUi-baseApi'),
      fallbackSdSampler: visible('#image-fallback-sdWebUi-samplerName'),
    };
  });
  await setInputValue(page, '#image-imageMode', 'jimeng');
  await setInputValue(page, '#image-fallback-imageMode', 'jimeng');
  const jimengVisibility = await readImageModeVisibility();
  if (!jimengVisibility.primaryJimeng || jimengVisibility.primaryModel || jimengVisibility.primaryBaseApi || jimengVisibility.primarySize
    || !jimengVisibility.fallbackJimeng || jimengVisibility.fallbackModel || jimengVisibility.fallbackBaseApi) {
    throw new Error('即梦模式没有正确隐藏 OpenAI 图像字段');
  }
  await setInputValue(page, '#image-imageMode', 'chat');
  const chatVisibility = await readImageModeVisibility();
  if (!chatVisibility.primaryModel || !chatVisibility.primaryBaseApi || chatVisibility.primaryJimeng || chatVisibility.primarySize) {
    throw new Error('对话式生图模式字段显示不正确');
  }
  await setInputValue(page, '#image-imageMode', 'openai');
  await setInputValue(page, '#image-fallback-imageMode', 'openai');
  const openAiVisibility = await readImageModeVisibility();
  if (!openAiVisibility.primaryModel || !openAiVisibility.primaryBaseApi || openAiVisibility.primaryJimeng || !openAiVisibility.primarySize
    || !openAiVisibility.fallbackModel || !openAiVisibility.fallbackBaseApi || openAiVisibility.fallbackJimeng) {
    throw new Error('OpenAI 生图模式没有正确隐藏即梦字段');
  }
  await setInputValue(page, '#image-imageMode', 'ark-agent-plan');
  await setInputValue(page, '#image-fallback-imageMode', 'ark-agent-plan');
  const agentPlanVisibility = await readImageModeVisibility();
  if (!agentPlanVisibility.primaryModel || !agentPlanVisibility.primaryBaseApi || agentPlanVisibility.primaryJimeng
    || !agentPlanVisibility.primarySize || agentPlanVisibility.primaryQuality || !agentPlanVisibility.primaryResponseFormat
    || !agentPlanVisibility.primaryOutputFormat || !agentPlanVisibility.primaryWatermark
    || !agentPlanVisibility.fallbackModel || !agentPlanVisibility.fallbackBaseApi || agentPlanVisibility.fallbackJimeng
    || !agentPlanVisibility.fallbackSize || !agentPlanVisibility.fallbackOutputFormat) {
    throw new Error('火山 Agent Plan 模式字段显示不正确');
  }
  await setInputValue(page, '#image-imageMode', 'sd-webui');
  await setInputValue(page, '#image-fallback-imageMode', 'sd-webui');
  const sdWebUiVisibility = await readImageModeVisibility();
  if (!sdWebUiVisibility.primarySdBaseApi || !sdWebUiVisibility.primarySdSampler
    || sdWebUiVisibility.primaryModel || sdWebUiVisibility.primaryBaseApi || sdWebUiVisibility.primaryJimeng
    || !sdWebUiVisibility.fallbackSdBaseApi || !sdWebUiVisibility.fallbackSdSampler
    || sdWebUiVisibility.fallbackModel || sdWebUiVisibility.fallbackBaseApi || sdWebUiVisibility.fallbackJimeng) {
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

async function runInteractiveChecks(page, baseUrl, runtimeErrors) {
  const checks = [
    { label: 'API 设置草稿', path: '/api-settings.html', run: runApiSettingsInteraction },
    { label: '文件浏览打开与预览', path: '/file-browser.html', run: runFileBrowserInteraction },
    { label: '控制台全局搜索', path: '/index.html', run: runGlobalSearchInteraction },
    { label: '模拟调试安全发送', path: '/qq-simulator.html', run: runQqSimulatorInteraction },
    { label: '模拟调试深度预览', path: '/qq-simulator.html', run: runQqSimulatorDeepPreviewInteraction },
    { label: '依赖面板刷新与搜索', path: '/dependency-check.html', run: runDependencyInteraction },
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
  return results;
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
      hasSettingError: Boolean(document.querySelector('.setting-error')),
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
    await closeSharedPuppeteerBrowser().catch(() => {});
    await cleanupIsolatedWebConsole(isolated);
  }
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
