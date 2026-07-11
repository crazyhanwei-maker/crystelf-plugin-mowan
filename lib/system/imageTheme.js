import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function limitText(value = '', max = 120) {
  const chars = Array.from(String(value || '').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(1, max - 1)).join('')}...`;
}

function readImageDataUrl(filePath = '', contentType = '') {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const ext = path.extname(filePath).toLowerCase();
  const typeMap = {
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  const type = contentType || typeMap[ext] || 'application/octet-stream';
  return `data:${type};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

export function resolveImageWallpaperDataUrl() {
  const cacheDir = path.join(Path.root, 'temp', 'web-console-background');
  const metaFile = path.join(cacheDir, 'current-image.json');
  const cacheFile = path.join(cacheDir, 'current-image.bin');
  const bundledFile = path.join(
    Path.root,
    'lib',
    'webConsole',
    'public',
    'assets',
    'console-wallpaper-default.webp',
  );

  try {
    if (fs.existsSync(metaFile) && fs.existsSync(cacheFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      return readImageDataUrl(cacheFile, String(meta?.contentType || '').trim() || 'image/webp');
    }
  } catch {}
  return readImageDataUrl(bundledFile);
}

export function buildImageThemeCss({ wallpaper = '', width = 900 } = {}) {
  const background = wallpaper
    ? `url("${wallpaper}") center top / cover no-repeat`
    : 'linear-gradient(#dce3e8, #dce3e8)';
  return `
    :root {
      --page-width: ${Math.max(320, Number(width || 900))}px;
      --theme-ink: #171a20;
      --theme-muted: #626b78;
      --theme-line: rgba(35, 42, 53, 0.12);
      --theme-panel: rgba(249, 250, 252, 0.91);
      --theme-panel-strong: rgba(255, 255, 255, 0.95);
      --theme-cyan: #249db2;
      --theme-blue: #5279d8;
      --theme-green: #25a979;
      --theme-pink: #cf638f;
      --theme-violet: #8467d4;
      --theme-amber: #d3972e;
      --theme-red: #d35d62;
      --theme-shadow: 0 14px 34px rgba(12, 18, 28, 0.2);
    }
    * { box-sizing: border-box; }
    html { width: var(--page-width); }
    body {
      margin: 0;
      width: var(--page-width);
      min-height: 0;
      padding: 26px;
      color: var(--theme-ink);
      font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
      letter-spacing: 0;
      background:
        linear-gradient(rgba(13, 16, 22, 0.26), rgba(13, 16, 22, 0.48)),
        ${background};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .theme-sheet { display: grid; gap: 14px; }
    .theme-panel {
      min-width: 0;
      padding: 18px;
      border: 1px solid rgba(255, 255, 255, 0.72);
      border-radius: 8px;
      background: var(--theme-panel);
      box-shadow: var(--theme-shadow);
      backdrop-filter: blur(18px) saturate(1.08);
      overflow: hidden;
    }
    .brand-hero {
      position: relative;
      padding: 22px 24px 20px;
      color: #f7f8fa;
      background: rgba(25, 29, 36, 0.96);
    }
    .brand-hero::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 4px;
      background: linear-gradient(90deg, #20a5b7, #37ad80, #d56f91, #d79a2f);
    }
    .brand-row {
      display: grid;
      grid-template-columns: 82px minmax(0, 1fr) auto;
      gap: 18px;
      align-items: center;
    }
    .brand-avatar {
      position: relative;
      width: 82px;
      height: 82px;
      display: grid;
      place-items: center;
      overflow: hidden;
      border: 3px solid rgba(255,255,255,0.76);
      border-radius: 50%;
      background: #edf0f4;
      color: #252b34;
      font-size: 27px;
      font-weight: 900;
      box-shadow: 0 8px 22px rgba(0,0,0,0.28);
    }
    .brand-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; }
    .brand-avatar img.is-loaded { opacity: 1; }
    .brand-copy { min-width: 0; }
    .brand-name-row { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
    .brand-name { margin: 0; color: #f7f8fa; font-size: 34px; line-height: 1.08; font-weight: 900; text-shadow: none; overflow-wrap: anywhere; }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 4px 9px;
      border: 1px solid rgba(255,255,255,0.24);
      border-radius: 5px;
      background: rgba(255,255,255,0.1);
      color: #dfe4ea;
      font-size: 12px;
      font-weight: 900;
    }
    .brand-title { margin-top: 8px; font-size: 20px; line-height: 1.25; font-weight: 900; }
    .brand-subtitle { margin-top: 5px; color: #b8c0cb; font-size: 12px; line-height: 1.5; font-weight: 700; overflow-wrap: anywhere; }
    .brand-side { min-width: 118px; text-align: right; }
    .brand-side strong { display: block; color: #f1c86f; font-size: 13px; font-weight: 900; }
    .brand-side span { display: block; margin-top: 8px; color: #9da6b2; font-size: 11px; line-height: 1.45; font-weight: 700; }
    .theme-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--theme-line); }
    .theme-panel-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .theme-panel-title::before { content: ""; width: 4px; height: 21px; border-radius: 2px; background: var(--theme-cyan); }
    .theme-panel-title h2 { margin: 0; font-size: 19px; line-height: 1.25; font-weight: 900; }
    .theme-panel-meta { color: #7b8490; font-size: 11px; font-weight: 800; text-align: right; }
    .theme-footer { display: flex; justify-content: space-between; gap: 12px; padding: 1px 4px 0; color: rgba(255,255,255,0.88); font-size: 11px; font-weight: 700; text-shadow: 0 2px 6px rgba(0,0,0,0.65); }
  `;
}

export function buildBrandHero({
  botName = '魔丸',
  avatarText = '魔',
  avatarUrl = '',
  badge = '',
  title = '',
  subtitle = '',
  sideTitle = '',
  sideText = '',
} = {}) {
  return `
    <header class="theme-panel brand-hero">
      <div class="brand-row">
        <div class="brand-avatar">
          <span>${escapeHtml(avatarText)}</span>
          ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="" onload="this.classList.add('is-loaded')" onerror="this.remove()">` : ''}
        </div>
        <div class="brand-copy">
          <div class="brand-name-row">
            <h1 class="brand-name">${escapeHtml(botName)}</h1>
            ${badge ? `<span class="brand-badge">${escapeHtml(badge)}</span>` : ''}
          </div>
          ${title ? `<div class="brand-title">${escapeHtml(title)}</div>` : ''}
          ${subtitle ? `<div class="brand-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        </div>
        <div class="brand-side">
          ${sideTitle ? `<strong>${escapeHtml(sideTitle)}</strong>` : ''}
          ${sideText ? `<span>${escapeHtml(sideText)}</span>` : ''}
        </div>
      </div>
    </header>
  `;
}

export async function waitForThemeImages(page, timeoutMs = 5000) {
  await page.evaluate(async timeout => {
    const images = Array.from(document.querySelectorAll('.brand-avatar img'));
    await Promise.all(images.map(image => {
      if (image.complete) return Promise.resolve();
      return new Promise(resolve => {
        const timer = setTimeout(resolve, timeout);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
      });
    }));
  }, timeoutMs);
}
