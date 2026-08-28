import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';
import Version from './version.js';
import { renderHtmlToImage } from './puppeteerRenderer.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveWallpaperDataUrl() {
  const cacheDir = path.join(Path.root, 'temp', 'web-console-background');
  const metaFile = path.join(cacheDir, 'current-image.json');
  const cacheFile = path.join(cacheDir, 'current-image.bin');
  const bundledFile = path.join(Path.root, 'lib', 'webConsole', 'public', 'assets', 'console-wallpaper-default.webp');

  try {
    if (fs.existsSync(metaFile) && fs.existsSync(cacheFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const contentType = String(meta?.contentType || '').trim() || 'image/webp';
      return `data:${contentType};base64,${fs.readFileSync(cacheFile).toString('base64')}`;
    }
  } catch {}

  try {
    if (fs.existsSync(bundledFile)) {
      return `data:image/webp;base64,${fs.readFileSync(bundledFile).toString('base64')}`;
    }
  } catch {}

  return '';
}

const HEADING_REGEX = /^##\s+\d+\.\s+更新记录/;
const VERSION_REGEX = /^###\s+(\S+)/;

function parseChangelog() {
  const gitMdPath = path.join(Path.root, 'GIT.md');
  let raw = '';
  try {
    raw = fs.readFileSync(gitMdPath, 'utf8');
  } catch {
    return [];
  }

  const lines = raw.split(/\r?\n/);
  let inChangelog = false;
  const versions = [];
  let current = null;

  for (const line of lines) {
    if (HEADING_REGEX.test(line.trim())) {
      inChangelog = true;
      continue;
    }
    if (!inChangelog) continue;
    // 遇到下一个 ## 章节就结束
    if (/^##\s/.test(line.trim()) && !HEADING_REGEX.test(line.trim())) break;

    const versionMatch = line.trim().match(VERSION_REGEX);
    if (versionMatch) {
      current = { version: versionMatch[1], items: [] };
      versions.push(current);
      continue;
    }

    if (current && line.trim().startsWith('-')) {
      current.items.push(line.trim().replace(/^-\s*/, '').trim());
    }
  }

  return versions;
}

function renderVersionBlock(version = {}, isLatest = false) {
  const items = Array.isArray(version.items) ? version.items : [];
  if (items.length === 0) return '';
  const itemList = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  return `
    <section class="panel version-block${isLatest ? ' version-latest' : ''}">
      <h2>${escapeHtml(version.version)}${isLatest ? '<span class="current-tag">当前</span>' : ''}</h2>
      <ul>${itemList}</ul>
    </section>
  `;
}

function buildChangelogHtml(data = {}) {
  const wallpaper = resolveWallpaperDataUrl();
  const backgroundImage = wallpaper
    ? `url("${wallpaper}") center top / cover no-repeat fixed`
    : 'linear-gradient(#dce3e8, #dce3e8)';
  const versions = Array.isArray(data.versions) ? data.versions : [];
  const currentVersion = String(data.currentVersion || '');
  const blocks = versions.map((version, index) =>
    renderVersionBlock(version, version.version === currentVersion || (index === 0 && !currentVersion)),
  ).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    :root {
      --page-width: 860px;
      --ink: #171a20;
      --muted: #626b78;
      --line: rgba(35, 42, 53, 0.12);
      --panel: rgba(249, 250, 252, 0.9);
      --cyan: #249db2;
      --green: #25a979;
      --pink: #cf638f;
      --violet: #8467d4;
      --amber: #d3972e;
      --shadow: 0 14px 34px rgba(12, 18, 28, 0.2);
    }
    * { box-sizing: border-box; }
    html { width: var(--page-width); }
    body {
      margin: 0;
      width: var(--page-width);
      padding: 26px;
      color: var(--ink);
      font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
      background:
        linear-gradient(rgba(13, 16, 22, 0.26), rgba(13, 16, 22, 0.48)),
        ${backgroundImage};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet { display: grid; gap: 14px; }
    .panel {
      min-width: 0;
      padding: 18px;
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px) saturate(1.08);
    }
    .hero {
      position: relative;
      padding: 22px 24px 20px;
      color: #f7f8fa;
      background: rgba(18, 21, 27, 0.91);
      border-color: rgba(255, 255, 255, 0.18);
    }
    .hero::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 4px;
      background: linear-gradient(90deg, var(--cyan), var(--green), var(--pink), var(--amber));
    }
    .hero-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 32px; line-height: 1.1; font-weight: 900; }
    .mode-badge {
      padding: 6px 12px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      background: rgba(36, 157, 178, 0.22);
      color: #bde6ee;
      font-size: 13px;
      font-weight: 800;
      white-space: nowrap;
    }
    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 18px;
      margin-top: 12px;
      color: #d7dce5;
      font-size: 13.5px;
      font-weight: 700;
    }
    .version-block h2 {
      margin: 0 0 12px;
      font-size: 18px;
      font-weight: 900;
      color: var(--ink);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .version-latest h2 { color: var(--cyan); }
    .current-tag {
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--cyan);
      color: #fff;
      font-size: 11px;
      font-weight: 800;
    }
    .version-block ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 8px;
    }
    .version-block li {
      padding-left: 18px;
      position: relative;
      font-size: 13.5px;
      line-height: 1.7;
      color: #2c3340;
    }
    .version-block li::before {
      content: "▪";
      position: absolute;
      left: 0;
      color: var(--cyan);
      font-weight: 900;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 4px 0;
      color: rgba(255, 255, 255, 0.55);
      font-size: 12px;
      font-weight: 700;
    }
    .footer span { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35); }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="panel hero">
      <div class="hero-top">
        <h1>更新日志</h1>
        <span class="mode-badge">${escapeHtml(data.pluginName || '')} v${escapeHtml(data.currentVersion || '')}</span>
      </div>
      <div class="hero-meta">
        <span>插件：${escapeHtml(data.pluginName || '')}</span>
        <span>当前版本：v${escapeHtml(data.currentVersion || '')}</span>
        <span>生成时间：${escapeHtml(data.generatedAt || '')}</span>
      </div>
    </header>
    ${blocks || '<section class="panel"><p style="margin:0;color:#626b78;font-size:14px">暂无更新记录。GIT.md 中未找到更新记录章节。</p></section>'}
    <footer class="footer"><span>Created by 魔丸插件</span><span>#灵晶查看更新日志</span></footer>
  </main>
</body>
</html>`;
}

export async function renderChangelogImage() {
  const versions = parseChangelog();
  const data = {
    versions,
    currentVersion: Version.ver,
    pluginName: Version.name,
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  };

  const outputDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `changelog_${Date.now()}.png`);
  return renderHtmlToImage({
    html: buildChangelogHtml(data),
    outputPath,
    viewport: { width: 860, height: 1200, deviceScaleFactor: 2 },
    minHeight: 700,
    maxHeight: 8000,
  });
}

export function buildChangelogText() {
  const versions = parseChangelog();
  if (versions.length === 0) return '暂无更新记录。';
  const lines = [`灵晶更新日志（当前 v${Version.ver}）`, '━━━━━━━━━━━━'];
  for (const version of versions.slice(0, 8)) {
    lines.push('', `v${version.version}`, '─'.repeat(6));
    for (const item of version.items) {
      lines.push(`· ${item}`);
    }
  }
  return lines.join('\n');
}
