import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { withPuppeteerPage, closeSharedPuppeteerBrowser } from '../lib/system/puppeteerRenderer.js';

const root = process.cwd();
const outputDir = path.join(root, 'temp', 'html', 'crystelf-plugin', 'api-image-runtime-visual');
const token = 'crystelf-image-visual-token';

async function startIsolatedConsole() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crystelf-image-visual-'));
  await fs.writeFile(path.join(dataDir, 'config.json'), `${JSON.stringify({
    webConsole: true,
    webConsoleToken: token,
    webConsoleReadOnly: false,
    webConsoleHost: '127.0.0.1',
    webConsolePort: 27993,
    webConsolePortAutoIncrement: true,
  }, null, 2)}\n`, 'utf8');
  const previousDataDir = process.env.CRYSTELF_DATA_DIR;
  process.env.CRYSTELF_DATA_DIR = dataDir;
  globalThis.logger = {
    info: () => {},
    warn: () => {},
    error: (...args) => console.error(...args),
    mark: () => {},
  };
  const ConfigControl = (await import('../lib/config/configControl.js')).default;
  const { startWebConsole, stopWebConsole } = await import('../lib/webConsole/server.js');
  await ConfigControl.init();
  const info = await startWebConsole();
  return { dataDir, previousDataDir, ConfigControl, stopWebConsole, baseUrl: new URL(info.url) };
}

async function stopIsolatedConsole(runtime) {
  if (!runtime) return;
  await runtime.stopWebConsole().catch(() => {});
  runtime.ConfigControl?.closeWatchers?.();
  if (runtime.previousDataDir === undefined) delete process.env.CRYSTELF_DATA_DIR;
  else process.env.CRYSTELF_DATA_DIR = runtime.previousDataDir;
  await fs.rm(runtime.dataDir, { recursive: true, force: true }).catch(() => {});
}

async function login(page, baseUrl) {
  await page.goto(new URL('/login.html', baseUrl).href, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async loginToken => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ token: loginToken }),
    });
    return response.json();
  }, token);
  if (result?.authorized !== true) throw new Error('API 设置视觉检查登录失败');
}

async function capture(page, baseUrl, profile) {
  await page.setViewport(profile.viewport);
  await page.goto(new URL('/api-settings.html', baseUrl).href, { waitUntil: 'networkidle0' });
  await page.click('.api-settings-nav-btn[data-section="ai-image"]');
  await page.waitForSelector('#section-ai-image:not(.hidden)');
  await page.waitForSelector('#image-runtime-test-run-btn');
  await page.select('#image-imageMode', 'sd-webui');
  await page.evaluate(() => {
    const mode = document.querySelector('#image-imageMode');
    mode?.dispatchEvent(new Event('input', { bubbles: true }));
    mode?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('#image-sdWebUi-baseApi:not([disabled])');
  await new Promise(resolve => setTimeout(resolve, 300));
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.image-runtime-test-panel');
    const button = document.getElementById('image-runtime-test-run-btn');
    return {
      panelVisible: Boolean(panel && panel.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().height > 0),
      buttonVisible: Boolean(button && button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0),
      sdFieldsVisible: Boolean(document.querySelector('#image-sdWebUi-baseApi')?.closest('.setting-item')
        && !document.querySelector('#image-sdWebUi-baseApi').closest('.setting-item').classList.contains('hidden')),
      openAiFieldsHidden: Boolean(document.querySelector('#image-baseApi')?.closest('.setting-item')?.classList.contains('hidden')),
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  if (!layout.panelVisible || !layout.buttonVisible) throw new Error(`${profile.label}真实生图测试面板不可见`);
  if (!layout.sdFieldsVisible || !layout.openAiFieldsHidden) throw new Error(`${profile.label} SD WebUI 模式字段显示不正确`);
  if (layout.documentWidth > layout.viewportWidth + 2) throw new Error(`${profile.label}页面存在横向溢出`);
  await fs.mkdir(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, `${profile.slug}-sd-webui.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true, type: 'png' });

  await page.click('.api-settings-nav-btn[data-section="image-monitor"]');
  await page.waitForSelector('#section-image-monitor:not(.hidden)');
  await page.waitForSelector('#imageMonitor-storageEnabled');
  const storageBefore = await page.evaluate(() => ({
    enabled: !document.querySelector('#imageMonitor-storageEnabled')?.classList.contains('off'),
    reviewDisabled: Boolean(document.querySelector('#imageMonitor-saveReviewImages')?.disabled),
    memeDisabled: Boolean(document.querySelector('#imageMonitor-saveMemeImages')?.disabled),
  }));
  if (storageBefore.enabled || !storageBefore.reviewDisabled || !storageBefore.memeDisabled) {
    throw new Error(`${profile.label}图片入库默认关闭状态不正确`);
  }
  await page.click('#imageMonitor-storageEnabled');
  const storageAfter = await page.evaluate(() => ({
    enabled: !document.querySelector('#imageMonitor-storageEnabled')?.classList.contains('off'),
    reviewDisabled: Boolean(document.querySelector('#imageMonitor-saveReviewImages')?.disabled),
    memeDisabled: Boolean(document.querySelector('#imageMonitor-saveMemeImages')?.disabled),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  if (!storageAfter.enabled || storageAfter.reviewDisabled || storageAfter.memeDisabled) {
    throw new Error(`${profile.label}图片入库开关没有恢复细分保存项`);
  }
  if (storageAfter.documentWidth > storageAfter.viewportWidth + 2) {
    throw new Error(`${profile.label}图片监控页面存在横向溢出`);
  }
  const monitorScreenshotPath = path.join(outputDir, `${profile.slug}-image-monitor.png`);
  await page.screenshot({ path: monitorScreenshotPath, fullPage: true, type: 'png' });
  return { ...profile, screenshotPath, monitorScreenshotPath, layout, storageBefore, storageAfter };
}

async function main() {
  let runtime = null;
  try {
    runtime = await startIsolatedConsole();
    const results = await withPuppeteerPage(async page => {
      await login(page, runtime.baseUrl);
      const profiles = [
        { label: '桌面', slug: 'desktop', viewport: { width: 1440, height: 960, deviceScaleFactor: 1 } },
        { label: '手机', slug: 'mobile', viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
      ];
      const output = [];
      for (const profile of profiles) output.push(await capture(page, runtime.baseUrl, profile));
      return output;
    }, { idleCloseMs: 1000, maxConcurrentPages: 1 });
    console.log(JSON.stringify({ ok: true, outputDir, results }, null, 2));
  } finally {
    await closeSharedPuppeteerBrowser().catch(() => {});
    await stopIsolatedConsole(runtime);
  }
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
