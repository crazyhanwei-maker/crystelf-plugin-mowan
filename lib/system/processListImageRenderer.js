import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';
import { renderHtmlToImage } from './puppeteerRenderer.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
}

function formatMemoryMB(memoryMB = 0) {
  const value = Number(memoryMB || 0);
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${formatNumber(Math.round(value))} MB`;
}

function clampPercent(value = 0) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
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

function renderProcessRow(item = {}, maxMemoryMB = 0, index = 0) {
  const memoryMB = Number(item.memoryMB || 0);
  const percent = maxMemoryMB > 0 ? clampPercent((memoryMB / maxMemoryMB) * 100) : 0;
  const tone = index === 0 ? 'pink' : index < 3 ? 'amber' : index < 10 ? 'violet' : 'cyan';
  const cpu = item.cpuPercent === null || item.cpuPercent === undefined
    ? '—'
    : `${formatNumber(item.cpuPercent)}%`;
  return `
    <tr>
      <td class="cell-pid">${escapeHtml(item.pid)}</td>
      <td class="cell-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</td>
      <td class="cell-memory">
        <div class="memory-cell">
          <div class="memory-track"><i class="tone-${tone}" style="width:${percent}%"></i></div>
          <span>${escapeHtml(formatMemoryMB(memoryMB))}</span>
        </div>
      </td>
      <td class="cell-cpu">${escapeHtml(cpu)}</td>
    </tr>
  `;
}

function buildProcessImageHtml(data = {}) {
  const wallpaper = resolveWallpaperDataUrl();
  const backgroundImage = wallpaper
    ? `url("${wallpaper}") center top / cover no-repeat fixed`
    : 'linear-gradient(#dce3e8, #dce3e8)';
  const items = Array.isArray(data.items) ? data.items : [];
  const maxMemoryMB = items.reduce((max, item) => Math.max(max, Number(item?.memoryMB || 0)), 0);
  const totalMemoryMB = items.reduce((sum, item) => sum + Number(item?.memoryMB || 0), 0);
  const platformText = data.platform === 'win32' ? 'Windows' : String(data.platform || '未知');
  const cpuNote = data.platform === 'win32' ? 'CPU 数据 Linux 环境显示' : '';
  const rows = items.map((item, index) => renderProcessRow(item, maxMemoryMB, index)).join('');

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
      --red: #d35d62;
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
    .summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .metric {
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.62);
      display: grid;
      gap: 3px;
    }
    .metric span { font-size: 12px; font-weight: 800; color: var(--muted); }
    .metric strong { font-size: 22px; font-weight: 900; overflow-wrap: anywhere; }
    .metric small { font-size: 12px; color: var(--muted); }
    .metric.tone-cyan strong { color: var(--cyan); }
    .metric.tone-green strong { color: var(--green); }
    .metric.tone-violet strong { color: var(--violet); }
    .process-table { width: 100%; border-collapse: collapse; }
    .process-table th {
      padding: 8px 10px;
      border-bottom: 2px solid rgba(35, 42, 53, 0.16);
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      text-align: left;
      white-space: nowrap;
    }
    .process-table td {
      padding: 7px 10px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
      vertical-align: middle;
    }
    .process-table tr:last-child td { border-bottom: none; }
    .cell-pid { width: 78px; font-variant-numeric: tabular-nums; color: var(--muted); font-weight: 700; }
    .cell-name {
      max-width: 0;
      width: 380px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
    }
    .cell-memory { width: 200px; }
    .cell-cpu { width: 70px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
    .memory-cell { display: flex; align-items: center; gap: 8px; }
    .memory-track { flex: 1 1 auto; height: 8px; border-radius: 999px; background: rgba(35, 42, 53, 0.08); overflow: hidden; }
    .memory-track i { display: block; height: 100%; border-radius: inherit; }
    .memory-track i.tone-cyan { background: var(--cyan); }
    .memory-track i.tone-green { background: var(--green); }
    .memory-track i.tone-violet { background: var(--violet); }
    .memory-track i.tone-amber { background: var(--amber); }
    .memory-track i.tone-pink { background: var(--pink); }
    .memory-cell span { flex: 0 0 auto; min-width: 62px; text-align: right; font-size: 12.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .period-note { margin: 12px 0 0; font-size: 12.5px; line-height: 1.7; color: var(--muted); }
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
        <h1>系统进程列表</h1>
        <span class="mode-badge">#查看进程</span>
      </div>
      <div class="hero-meta">
        <span>平台：${escapeHtml(platformText)}</span>
        <span>生成时间：${escapeHtml(data.generatedAt || '')}</span>
        ${cpuNote ? `<span>${escapeHtml(cpuNote)}</span>` : ''}
      </div>
    </header>
    ${data.errorMessage ? `<section class="panel"><p class="period-note">${escapeHtml(data.errorMessage)}</p></section>` : `
    <section class="panel">
      <div class="summary-grid">
        <div class="metric tone-cyan">
          <span>展示进程</span>
          <strong>${escapeHtml(formatNumber(items.length))}</strong>
          <small>共 ${escapeHtml(formatNumber(data.total))} 个${data.query ? `（关键词：${escapeHtml(data.query)}）` : ''}</small>
        </div>
        <div class="metric tone-green">
          <span>合计内存</span>
          <strong>${escapeHtml(formatMemoryMB(totalMemoryMB))}</strong>
          <small>按展示进程汇总</small>
        </div>
        <div class="metric tone-violet">
          <span>最占内存</span>
          <strong style="font-size:16px">${escapeHtml(items[0]?.name || '无')}</strong>
          <small>${items[0] ? `${escapeHtml(formatMemoryMB(items[0].memoryMB))} · PID ${escapeHtml(items[0].pid)}` : ''}</small>
        </div>
      </div>
      <table class="process-table">
        <thead>
          <tr>
            <th>PID</th>
            <th>进程名</th>
            <th>内存占用</th>
            <th style="text-align:right">CPU %</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="period-note">按内存占用降序排列${data.query ? '（已按关键词过滤）' : '，仅展示占用最高的前若干进程'}。</p>
    </section>`}
    <footer class="footer"><span>Created by 魔丸插件</span><span>#查看进程</span></footer>
  </main>
</body>
</html>`;
}

export async function renderProcessListImage(data = {}) {
  const outputDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `process_list_${Date.now()}.png`);
  return renderHtmlToImage({
    html: buildProcessImageHtml(data),
    outputPath,
    viewport: { width: 860, height: 1200, deviceScaleFactor: 2 },
    minHeight: 700,
    maxHeight: 6000,
  });
}
