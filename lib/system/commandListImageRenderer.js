import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import Path from '../../constants/path.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveConsoleWallpaperDataUrl() {
  const cacheDir = path.join(Path.root, 'temp', 'web-console-background');
  const metaFile = path.join(cacheDir, 'current-image.json');
  const cacheFile = path.join(cacheDir, 'current-image.bin');
  const bundledFile = path.join(Path.root, 'lib', 'webConsole', 'public', 'assets', 'console-wallpaper-default.webp');

  try {
    if (fs.existsSync(metaFile) && fs.existsSync(cacheFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const contentType = String(meta?.contentType || '').trim() || 'image/webp';
      const buffer = fs.readFileSync(cacheFile);
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    }
  } catch {}

  if (fs.existsSync(bundledFile)) {
    const buffer = fs.readFileSync(bundledFile);
    return `data:image/webp;base64,${buffer.toString('base64')}`;
  }
  return '';
}

function buildCategoryTitle(title = '', subtitle = '', tone = 'cyan') {
  return `<div class="cat-head tone-${escapeHtml(tone)}">
    <span class="cat-dot"></span>
    <div class="cat-head-text">
      <div class="cat-title">${escapeHtml(title)}</div>
      <div class="cat-sub">${escapeHtml(subtitle)}</div>
    </div>
  </div>`;
}

function buildCommandItem(cmd = '', desc = '', tone = 'cyan') {
  return `<div class="cmd-item tone-${escapeHtml(tone)}">
    <code class="cmd-code">${escapeHtml(cmd)}</code>
    <span class="cmd-desc">${escapeHtml(desc)}</span>
  </div>`;
}

function buildSection(title = '', subtitle = '', commands = [], tone = 'cyan') {
  const items = commands
    .map(item => buildCommandItem(item.cmd || '', item.desc || '', tone))
    .join('');
  return `<section class="glass-card cat-block">
    ${buildCategoryTitle(title, subtitle, tone)}
    <div class="cmd-list">${items}</div>
  </section>`;
}

export function buildCommandListHtml(data = {}) {
  const consoleWallpaper = String(data.consoleWallpaper || '').trim() || resolveConsoleWallpaperDataUrl();
  const botName = data.botName || '魔丸';
  const avatarText = data.avatarText || '魔';
  const generatedAt = data.generatedAt || '';
  const nodeVersion = process.version;
  const categories = Array.isArray(data.categories) ? data.categories : [];

  const bodyBackground = consoleWallpaper
    ? `linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.18)), url("${consoleWallpaper}") center top / cover no-repeat,`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    :root {
      --page-width: 900px;
      --text: #151922;
      --muted: #4f5b70;
      --line: rgba(55, 65, 86, 0.16);
      --glass: rgba(255, 255, 255, 0.66);
      --shadow: 0 18px 44px rgba(16, 24, 40, 0.22);
      --cyan: #58c7dd;
      --blue: #7aa5f6;
      --violet: #a98af4;
      --pink: #f59bbb;
      --green: #45c987;
      --amber: #f3bd54;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: var(--page-width);
      padding: 34px;
      font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
      background:
        ${bodyBackground}
        radial-gradient(circle at 18% 12%, rgba(255,255,255,0.5), transparent 26%),
        radial-gradient(circle at 86% 24%, rgba(142, 188, 247, 0.2), transparent 30%),
        linear-gradient(135deg, #f3f7fb, #f7edf4 48%, #edf6f7);
      color: var(--text);
    }
    .sheet {
      display: grid;
      gap: 22px;
    }
    .glass-card {
      background: var(--glass);
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 26px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px) saturate(1.2);
      overflow: hidden;
    }
    .hero {
      padding: 28px 30px 24px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 118px 1fr;
      gap: 24px;
      align-items: center;
    }
    .avatar {
      width: 118px;
      height: 118px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 35% 28%, rgba(255,255,255,0.95), rgba(255,255,255,0.2) 34%, transparent 35%),
        linear-gradient(145deg, #fff8fb, #e8f5ff 58%, #f8dce9);
      border: 3px solid rgba(255,255,255,0.86);
      color: #e77da6;
      font-size: 46px;
      font-weight: 900;
      text-shadow: 0 2px 0 rgba(255,255,255,0.8);
      box-shadow: 0 14px 30px rgba(30, 41, 59, 0.2);
    }
    .hero-main { min-width: 0; }
    h1 {
      margin: 0;
      font-size: 40px;
      line-height: 1.1;
      font-weight: 900;
      color: #111827;
      text-shadow: 0 1px 0 rgba(255,255,255,0.4);
    }
    .pro-label {
      display: inline-block;
      margin-top: 10px;
      padding: 5px 12px;
      border-radius: 10px;
      background: rgba(17,24,39,0.78);
      color: #fff;
      font-size: 15px;
      font-weight: 900;
    }
    .hero-sub {
      margin-top: 12px;
      color: #2c3a50;
      font-size: 16px;
      font-weight: 800;
      line-height: 1.5;
    }
    .time-line {
      margin-top: 14px;
      text-align: right;
      color: #252f42;
      font-size: 14px;
      font-weight: 800;
    }
    .cat-block {
      padding: 22px;
    }
    .cat-head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
    }
    .cat-dot {
      width: 10px;
      height: 26px;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--cyan), var(--pink));
      box-shadow: 0 0 18px rgba(88, 199, 221, 0.4);
    }
    .cat-head.tone-blue .cat-dot { background: linear-gradient(180deg, var(--blue), var(--violet)); }
    .cat-head.tone-pink .cat-dot { background: linear-gradient(180deg, var(--pink), var(--violet)); }
    .cat-head.tone-amber .cat-dot { background: linear-gradient(180deg, var(--amber), #ffd27a); }
    .cat-head.tone-green .cat-dot { background: linear-gradient(180deg, var(--green), var(--cyan)); }
    .cat-title {
      font-size: 23px;
      font-weight: 900;
      color: #111827;
    }
    .cat-sub {
      margin-top: 3px;
      color: #5d6a7d;
      font-size: 14px;
      font-weight: 800;
    }
    .cmd-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .cmd-item {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
      padding: 12px 14px;
      border-radius: 16px;
      background: rgba(255,255,255,0.56);
      border: 1px solid rgba(255,255,255,0.68);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
    }
    .cmd-code {
      font-family: "Consolas", "Microsoft YaHei", monospace;
      font-size: 16px;
      font-weight: 900;
      color: #172033;
      word-break: break-word;
      padding: 4px 8px;
      border-radius: 8px;
      background: rgba(226,232,240,0.6);
    }
    .cmd-item.tone-blue .cmd-code { background: rgba(219,234,254,0.7); color: #1e3a8a; }
    .cmd-item.tone-pink .cmd-code { background: rgba(252,233,244,0.7); color: #9d174d; }
    .cmd-item.tone-amber .cmd-code { background: rgba(254,243,199,0.75); color: #854d0e; }
    .cmd-item.tone-green .cmd-code { background: rgba(220,252,231,0.7); color: #14532d; }
    .cmd-desc {
      font-size: 13px;
      font-weight: 700;
      color: #5d6a7d;
      line-height: 1.4;
      word-break: break-word;
    }
    .footer {
      text-align: center;
      color: rgba(255,255,255,0.92);
      font-size: 13px;
      font-weight: 800;
      text-shadow: 0 2px 6px rgba(15,23,42,0.55);
      line-height: 1.5;
      padding: 0 0 4px;
    }
  </style>
</head>
<body>
  <main class="sheet">
    <section class="glass-card hero">
      <div class="hero-grid">
        <div class="avatar">${escapeHtml(avatarText)}</div>
        <div class="hero-main">
          <h1>${escapeHtml(botName)}</h1>
          <span class="pro-label">命令列表</span>
          <div class="hero-sub">灵晶插件全部功能命令一览，按分类整理<br>带 # 为指令，其余为关键词触发</div>
          <div class="time-line">${escapeHtml(generatedAt)}  生成</div>
        </div>
      </div>
    </section>

    ${categories
      .map(cat => buildSection(cat.title || '', cat.subtitle || '', cat.commands || [], cat.tone || 'cyan'))
      .join('')}

    <div class="footer">
      Created by 魔丸插件 & Node ${escapeHtml(nodeVersion)}<br>
      ${escapeHtml(generatedAt)}
    </div>
  </main>
</body>
</html>`;
}

export async function renderCommandListImage(data = {}) {
  const outputDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `command_list_${Date.now()}.png`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let page = null;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 900, height: 2400, deviceScaleFactor: 2 });
    await page.setContent(buildCommandListHtml(data), { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.evaluate(async () => {
      if (document?.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {}
      }
    });
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewport({ width: 900, height: Math.min(Math.max(height, 1180), 6000), deviceScaleFactor: 2 });
    await page.screenshot({ path: outputPath, fullPage: true });
    return outputPath;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close races after render failures.
      }
    }
    await browser.close();
  }
}
