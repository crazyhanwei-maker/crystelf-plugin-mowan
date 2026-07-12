import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { scheduleCrystelfTempImageCleanup } from './tempImageCleanup.js';

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const DEFAULT_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
];

const DEFAULT_IDLE_CLOSE_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_PAGES = 2;
const DEFAULT_CONTENT_TIMEOUT_MS = 30_000;

let browser = null;
let browserPromise = null;
let activePages = 0;
let idleCloseTimer = null;
const waitQueue = [];
const rendererStats = {
  startedAt: new Date().toISOString(),
  browserLaunchCount: 0,
  browserCloseCount: 0,
  pageTaskCount: 0,
  pageTaskSuccessCount: 0,
  pageTaskFailureCount: 0,
  renderCount: 0,
  renderSuccessCount: 0,
  renderFailureCount: 0,
  totalRenderMs: 0,
  maxRenderMs: 0,
  lastRenderAt: '',
  lastRenderMs: 0,
  lastSuccessAt: '',
  lastErrorAt: '',
  lastError: '',
  recentRenders: [],
};

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clearIdleCloseTimer() {
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
}

function pushRecentRender(item = {}) {
  rendererStats.recentRenders.unshift({
    time: item.time || new Date().toISOString(),
    success: item.success === true,
    elapsedMs: Number(item.elapsedMs || 0),
    outputPath: String(item.outputPath || ''),
    error: String(item.error || ''),
  });
  rendererStats.recentRenders = rendererStats.recentRenders.slice(0, 12);
}

function recordRenderResult(result = {}) {
  const now = new Date().toISOString();
  const elapsedMs = Math.max(0, Number(result.elapsedMs || 0));
  rendererStats.renderCount += 1;
  rendererStats.lastRenderAt = now;
  rendererStats.lastRenderMs = Math.round(elapsedMs);
  rendererStats.totalRenderMs += elapsedMs;
  rendererStats.maxRenderMs = Math.max(rendererStats.maxRenderMs, elapsedMs);
  if (result.success === true) {
    rendererStats.renderSuccessCount += 1;
    rendererStats.lastSuccessAt = now;
  } else {
    rendererStats.renderFailureCount += 1;
    rendererStats.lastErrorAt = now;
    rendererStats.lastError = String(result.error || '渲染失败').slice(0, 240);
  }
  pushRecentRender({
    time: now,
    success: result.success === true,
    elapsedMs,
    outputPath: result.outputPath,
    error: result.error,
  });
}

function scheduleIdleClose(idleCloseMs = DEFAULT_IDLE_CLOSE_MS) {
  clearIdleCloseTimer();
  if (!browser || activePages > 0 || idleCloseMs <= 0) return;
  idleCloseTimer = setTimeout(async () => {
    if (!browser || activePages > 0) return;
    const current = browser;
    browser = null;
    browserPromise = null;
    try {
      await current.close();
      rendererStats.browserCloseCount += 1;
    } catch (error) {
      logger.warn(`[crystelf-renderer] 关闭空闲浏览器失败: ${error.message}`);
    }
  }, idleCloseMs);
  idleCloseTimer.unref?.();
}

async function getBrowser(options = {}) {
  clearIdleCloseTimer();
  if (browser?.connected) return browser;
  if (browserPromise) return browserPromise;

  const launchOptions = {
    headless: true,
    args: DEFAULT_LAUNCH_ARGS,
    ...(options.launchOptions || {}),
  };
  launchOptions.args = Array.from(new Set([
    ...DEFAULT_LAUNCH_ARGS,
    ...(Array.isArray(options.launchOptions?.args) ? options.launchOptions.args : []),
  ]));

  browserPromise = puppeteer.launch(launchOptions)
    .then(instance => {
      rendererStats.browserLaunchCount += 1;
      browser = instance;
      browserPromise = null;
      instance.on?.('disconnected', () => {
        if (browser === instance) browser = null;
      });
      return instance;
    })
    .catch(error => {
      browserPromise = null;
      throw error;
    });
  return browserPromise;
}

async function acquirePageSlot(maxConcurrentPages = DEFAULT_MAX_CONCURRENT_PAGES) {
  const limit = clampNumber(maxConcurrentPages, 1, 8, DEFAULT_MAX_CONCURRENT_PAGES);
  if (activePages < limit) {
    activePages += 1;
    return;
  }
  await new Promise(resolve => waitQueue.push(resolve));
  activePages += 1;
}

function releasePageSlot() {
  activePages = Math.max(0, activePages - 1);
  const next = waitQueue.shift();
  if (next) next();
}

export async function withPuppeteerPage(callback, options = {}) {
  await acquirePageSlot(options.maxConcurrentPages);
  let page = null;
  rendererStats.pageTaskCount += 1;
  try {
    const instance = await getBrowser(options);
    page = await instance.newPage();
    const result = await callback(page);
    rendererStats.pageTaskSuccessCount += 1;
    return result;
  } catch (error) {
    rendererStats.pageTaskFailureCount += 1;
    throw error;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close races after render failures.
      }
    }
    releasePageSlot();
    scheduleIdleClose(clampNumber(options.idleCloseMs, 0, 10 * 60_000, DEFAULT_IDLE_CLOSE_MS));
  }
}

export async function closeSharedPuppeteerBrowser() {
  clearIdleCloseTimer();
  const current = browser;
  browser = null;
  browserPromise = null;
  if (current) {
    await current.close();
    rendererStats.browserCloseCount += 1;
  }
}

export function getSharedPuppeteerRendererStats() {
  const averageRenderMs = rendererStats.renderCount > 0
    ? Math.round(rendererStats.totalRenderMs / rendererStats.renderCount)
    : 0;
  return {
    ...rendererStats,
    browserConnected: Boolean(browser?.connected),
    browserStarting: Boolean(browserPromise),
    activePages,
    queuedRequests: waitQueue.length,
    averageRenderMs,
    maxRenderMs: Math.round(rendererStats.maxRenderMs || 0),
    totalRenderMs: Math.round(rendererStats.totalRenderMs || 0),
    recentRenders: rendererStats.recentRenders.map(item => ({ ...item })),
  };
}

export async function renderHtmlToImage(options = {}) {
  const {
    html = '',
    outputPath = '',
    viewport = {},
    contentOptions = {},
    screenshotOptions = {},
    measureHeight = true,
    minHeight = 600,
    maxHeight = 6000,
    waitForFonts = true,
    setupPage,
    afterContent,
  } = options;

  if (!outputPath) {
    throw new Error('renderHtmlToImage 缺少 outputPath');
  }

  const width = clampNumber(viewport.width, 100, 4000, 900);
  const initialHeight = clampNumber(viewport.height, 100, 8000, 1600);
  const deviceScaleFactor = clampNumber(viewport.deviceScaleFactor, 1, 4, 2);
  scheduleCrystelfTempImageCleanup();
  const startedAt = Date.now();

  try {
    const resultPath = await withPuppeteerPage(async page => {
      await page.setViewport({ width, height: initialHeight, deviceScaleFactor });
      if (typeof setupPage === 'function') {
        await setupPage(page);
      }
      await page.setContent(String(html || ''), {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_CONTENT_TIMEOUT_MS,
        ...contentOptions,
      });
      if (waitForFonts) {
        await page.evaluate(async () => {
          if (document?.fonts?.ready) {
            try {
              await document.fonts.ready;
            } catch {}
          }
        });
      }
      if (typeof afterContent === 'function') {
        await afterContent(page);
      }
      if (measureHeight) {
        const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
        await page.setViewport({
          width,
          height: Math.min(Math.max(height, minHeight), maxHeight),
          deviceScaleFactor,
        });
      }
      const { path: ignoredPath, ...safeScreenshotOptions } = screenshotOptions || {};
      const imageBuffer = await page.screenshot({
        fullPage: true,
        ...safeScreenshotOptions,
      });
      await fs.writeFile(outputPath, imageBuffer);
      return outputPath;
    }, options);
    recordRenderResult({
      success: true,
      elapsedMs: Date.now() - startedAt,
      outputPath: resultPath,
    });
    return resultPath;
  } catch (error) {
    recordRenderResult({
      success: false,
      elapsedMs: Date.now() - startedAt,
      outputPath,
      error: error.message || String(error),
    });
    throw error;
  }
}
