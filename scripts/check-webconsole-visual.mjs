import fs from 'fs/promises';
import path from 'path';
import { withPuppeteerPage, closeSharedPuppeteerBrowser } from '../lib/system/puppeteerRenderer.js';

const root = process.cwd();
const defaultConfigPath = path.join(root, 'config', 'config.json');
const runtimeConfigPath = path.join(
  process.env.CRYSTELF_DATA_DIR ? path.resolve(process.env.CRYSTELF_DATA_DIR) : path.resolve(root, '..', '..', 'data', 'crystelf'),
  'config.json',
);
const outputDir = path.join(root, 'temp', 'html', 'crystelf-plugin', 'webconsole-visual');
const pageTimeoutMs = Math.max(3000, Number(process.env.WEB_CONSOLE_VISUAL_TIMEOUT_MS || 15000) || 15000);

const pages = [
  { path: '/index.html', label: '总览', text: '魔丸控制台' },
  { path: '/plugin-settings.html', label: '插件设置', text: '插件设置中心' },
  { path: '/api-settings.html', label: 'API接口', text: 'API' },
  { path: '/group-management.html', label: '群管理', text: '群管理' },
  { path: '/qq-simulator.html', label: '模拟调试', text: '模拟调试' },
  { path: '/file-browser.html', label: '文件编辑', text: '文件浏览编辑器' },
  { path: '/bot-plugins.html', label: '插件管理', text: '机器人插件管理' },
  { path: '/performance.html', label: '性能监测', text: '性能监测' },
];

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

function getToken(config = {}) {
  return String(
    process.env.WEB_CONSOLE_VISUAL_TOKEN
    || process.env.WEB_CONSOLE_SMOKE_TOKEN
    || process.env.WEB_CONSOLE_TOKEN
    || config.webConsoleToken
    || '',
  ).trim();
}

function sanitizeFilename(value = '') {
  return String(value || 'page')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || 'page';
}

async function ensureLoggedIn(page, baseUrl, token) {
  const statusUrl = new URL('/api/auth/status', baseUrl).href;
  const status = await page.evaluate(async url => {
    const response = await fetch(url, { credentials: 'include' });
    return response.json();
  }, statusUrl);
  if (status?.authorized === true || status?.loginConfigured !== true) {
    return status;
  }
  if (!token) {
    fail('控制台需要登录，但没有找到口令。请设置 WEB_CONSOLE_VISUAL_TOKEN。');
  }
  const loginUrl = new URL('/api/auth/login', baseUrl).href;
  const login = await page.evaluate(async (url, loginToken) => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ token: loginToken }),
    });
    return response.json();
  }, loginUrl, token);
  if (login?.authorized !== true) {
    fail('控制台登录失败，无法截图巡检。');
  }
  return login;
}

async function inspectPage(page, baseUrl, item) {
  const url = new URL(item.path, baseUrl).href;
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', request => {
    const requestUrl = request.url();
    if (requestUrl.startsWith(baseUrl.origin)) {
      errors.push(`requestfailed: ${requestUrl} ${request.failure()?.errorText || ''}`.trim());
    }
  });
  page.on('response', response => {
    const responseUrl = response.url();
    if (responseUrl.startsWith(baseUrl.origin) && response.status() >= 400) {
      errors.push(`HTTP ${response.status()}: ${responseUrl}`);
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
  await page.waitForSelector('body', { timeout: pageTimeoutMs });
  await new Promise(resolve => setTimeout(resolve, 800));
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  if (!bodyText.includes(item.text)) {
    errors.push(`未找到关键文案：${item.text}`);
  }
  const loadingOnly = await page.evaluate(() => {
    const text = (document.body?.innerText || '').trim();
    return text === '加载中...' || text.endsWith('\n加载中...');
  });
  if (loadingOnly) {
    errors.push('页面停留在加载中状态');
  }
  await fs.mkdir(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, `${sanitizeFilename(item.label)}.png`);
  const imageBuffer = await page.screenshot({ fullPage: true, type: 'png' });
  await fs.writeFile(screenshotPath, imageBuffer);
  const stat = await fs.stat(screenshotPath);
  if (stat.size <= 1024) {
    errors.push(`截图文件过小：${stat.size}`);
  }
  return {
    label: item.label,
    path: item.path,
    screenshotPath,
    size: stat.size,
    ok: errors.length === 0,
    errors,
  };
}

async function main() {
  const config = await readLocalConfig();
  const configuredPort = Math.min(65535, Math.max(1, Number(config.webConsolePort || 27891) || 27891));
  const defaultBase = `http://${formatHostForUrl(config.webConsoleHost || '127.0.0.1')}:${configuredPort}/`;
  const baseUrl = normalizeBaseUrl(process.env.WEB_CONSOLE_VISUAL_URL || process.env.WEB_CONSOLE_URL || defaultBase);
  const token = getToken(config);
  const results = [];

  try {
    await withPuppeteerPage(async page => {
      page.setDefaultTimeout(pageTimeoutMs);
      await page.goto(new URL('/login.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
      await ensureLoggedIn(page, baseUrl, token);
      for (const item of pages) {
        results.push(await inspectPage(page, baseUrl, item));
      }
    }, { idleCloseMs: 1000 });
  } finally {
    await closeSharedPuppeteerBrowser().catch(() => {});
  }

  const failed = results.filter(item => !item.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    baseUrl: baseUrl.origin,
    outputDir,
    results,
  }, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
