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

function clampPercent(value = 0) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

function renderProgressRing(percent = 0, label = '', meta = '', submeta = '', tone = 'blue') {
  const safe = clampPercent(percent);
  return `
    <div class="ring-card">
      <div class="ring" style="--p:${safe}; --tone:${tone}">
        <div class="ring-inner">
          <div class="ring-percent">${Math.round(safe)}%</div>
        </div>
      </div>
      <div class="ring-label">${escapeHtml(label)}</div>
      <div class="ring-meta">${escapeHtml(meta)}</div>
      <div class="ring-submeta">${escapeHtml(submeta)}</div>
    </div>
  `;
}

function renderInfoLine(label = '', value = '') {
  return `<div class="info-line"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderPill(text = '', tone = 'gray') {
  return `<span class="pill tone-${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

function renderSmallCard(title = '', value = '', subtitle = '') {
  return `<div class="small-card">
    <div class="small-title">${escapeHtml(title)}</div>
    <div class="small-value">${escapeHtml(value)}</div>
    <div class="small-sub">${escapeHtml(subtitle)}</div>
  </div>`;
}

function renderSectionBlock(title = '', content = '') {
  return `<section class="panel-section">
    <div class="section-head">${escapeHtml(title)}</div>
    ${content}
  </section>`;
}

function readImageDataUrl(filePath = '', contentType = '') {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentTypeMap = {
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  const resolvedContentType = contentType || contentTypeMap[ext] || 'application/octet-stream';
  return `data:${resolvedContentType};base64,${buffer.toString('base64')}`;
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
      return readImageDataUrl(cacheFile, contentType);
    }
  } catch {}

  return readImageDataUrl(bundledFile);
}

function formatWithUnit(value = 0, unit = '') {
  return `${Number(value || 0).toLocaleString('zh-CN')}${unit}`;
}

function buildFeaturePills(features = []) {
  return features.map(([name, enabled]) => renderPill(`${name} ${enabled ? '开' : '关'}`, enabled ? 'green' : 'red')).join('');
}

function buildHealthPills(health = []) {
  return health.map(item => `<div class="health-item tone-${escapeHtml(item.tone || 'gray')}">
    <strong>${escapeHtml(item.label || '')}</strong>
    <span>${escapeHtml(item.detail || '')}</span>
  </div>`).join('');
}

function buildAlertRows(alerts = []) {
  return alerts.map(item => `<div class="alert-row tone-${escapeHtml(item.tone || 'gray')}">
    <span>${escapeHtml(item.label || '提示')}</span>
    <strong>${escapeHtml(item.text || '')}</strong>
  </div>`).join('');
}

export function buildStatusImageHtml(data = {}) {
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  const aiUsage = data.aiUsage || {};
  const imageUsage = data.imageUsage || {};
  const health = Array.isArray(data.health) ? data.health : [];
  const alerts = Array.isArray(data.alerts) && data.alerts.length > 0
    ? data.alerts
    : [{ tone: 'green', label: '状态', text: '暂无运行告警' }];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const features = Array.isArray(data.features) ? data.features : [];
  const topScene = aiUsage.topScene || {};
  const topModel = aiUsage.topModel || {};
  const latestAi = aiUsage.latest || {};
  const imageLatest = imageUsage.latest || {};
  const consoleWallpaper = String(data.consoleWallpaper || '').trim() || resolveConsoleWallpaperDataUrl();
  const botName = data.botName || '灵晶';
  const avatarText = data.avatarText || '灵';
  const statusTone = data.statusTone === 'warn' ? 'warn' : 'success';
  const generatedAt = data.generatedAt || '';
  const resources = data.resources || {};
  const cpuPercent = clampPercent(resources.cpuPercent || 0);
  const memoryPercent = clampPercent(resources.memoryPercent || 0);
  const heapPercent = clampPercent(resources.heapPercent || 0);
  const diskMain = clampPercent((resources.usedMemoryBytes || 0) / Math.max(1, resources.totalMemoryBytes || 1) * 100);
  const diskSecondary = clampPercent((resources.heapUsedBytes || 0) / Math.max(1, resources.heapTotalBytes || 1) * 100);
  const bodyBackground = consoleWallpaper
    ? `linear-gradient(180deg, rgba(255,255,255,0.84), rgba(247,249,252,0.92)), url("${consoleWallpaper}") center top / cover no-repeat,`
    : '';
  const panelBackground = consoleWallpaper ? 'rgba(255, 255, 255, 0.74)' : 'var(--glass)';
  const heroBackground = consoleWallpaper
    ? 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.48))'
    : 'linear-gradient(180deg, rgba(255,255,255,0.74), rgba(255,255,255,0.4))';
  const sectionBackground = consoleWallpaper ? 'rgba(255,255,255,0.78)' : 'var(--glass)';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    :root {
      --page-width: 900px;
      --glass: rgba(255, 255, 255, 0.82);
      --glass-strong: rgba(255, 255, 255, 0.92);
      --line: rgba(119, 131, 156, 0.22);
      --text: #1d2533;
      --muted: #60708a;
      --shadow: 0 16px 36px rgba(27, 34, 52, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: var(--page-width);
      min-height: 1180px;
      padding: 28px;
      font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
      background:
        ${bodyBackground}
        radial-gradient(circle at 20% 14%, rgba(255, 255, 255, 0.48), transparent 28%),
        radial-gradient(circle at 78% 22%, rgba(218, 226, 242, 0.45), transparent 26%),
        linear-gradient(180deg, rgba(245, 247, 252, 0.95), rgba(232, 237, 245, 0.95));
      color: var(--text);
    }
    .page {
      border-radius: 28px;
      overflow: hidden;
      padding: 0;
    }
    .panel {
      background: ${panelBackground};
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.56);
      border-radius: 28px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .hero {
      padding: 28px 30px 18px;
      background: ${heroBackground};
      border-bottom: 1px solid var(--line);
    }
    .hero-top {
      display: flex;
      align-items: flex-start;
      gap: 18px;
    }
    .avatar-wrap {
      position: relative;
      width: 122px;
      height: 122px;
      flex: 0 0 auto;
    }
    .avatar {
      width: 122px;
      height: 122px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: linear-gradient(145deg, #fdfdfd, #e9edf6);
      border: 6px solid rgba(255,255,255,0.92);
      box-shadow: 0 10px 22px rgba(24, 33, 56, 0.16);
      font-size: 44px;
      font-weight: 900;
      color: #f19ab8;
      text-shadow: 0 1px 0 rgba(255,255,255,0.8);
    }
    .avatar-badge {
      position: absolute;
      right: 2px;
      bottom: 6px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.94);
      background: #35d07f;
      box-shadow: 0 0 0 2px rgba(53, 208, 127, 0.22);
    }
    .hero-main {
      flex: 1;
      min-width: 0;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.1;
      font-weight: 900;
      letter-spacing: 0;
    }
    .subtitle-badge {
      padding: 7px 12px;
      border-radius: 10px;
      background: rgba(96, 105, 121, 0.86);
      color: #fff;
      font-size: 15px;
      font-weight: 700;
    }
    .top-band {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .info-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .time-row {
      display: flex;
      justify-content: flex-end;
      margin-top: 10px;
      color: #202938;
      font-weight: 700;
      font-size: 14px;
    }
    .section {
      margin: 18px 0 0;
      padding: 18px 18px 20px;
      background: ${sectionBackground};
      border: 1px solid rgba(255,255,255,0.56);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }
    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 20px;
      font-weight: 900;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }
    .section-icon {
      width: 24px;
      height: 24px;
      display: grid;
      place-items: center;
      font-size: 18px;
      color: #21293d;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 7px 12px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 800;
      border: 1px solid rgba(0, 0, 0, 0.08);
      background: #edf2fb;
      color: #24314a;
    }
    .pill.tone-green { background: linear-gradient(180deg, #e6f9ef, #d4f6e4); color: #24623f; }
    .pill.tone-yellow { background: linear-gradient(180deg, #fff7d6, #fff1b6); color: #6f5914; }
    .pill.tone-red { background: linear-gradient(180deg, #fde5e5, #f9d6d6); color: #9d3c3c; }
    .pill.tone-gray { background: linear-gradient(180deg, #edf2fb, #e3eaf7); color: #475468; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }
    .ring-card {
      background: rgba(255,255,255,0.78);
      border: 1px solid rgba(133, 145, 170, 0.18);
      border-radius: 22px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.65);
      padding: 18px 14px 16px;
      text-align: center;
    }
    .ring {
      width: 108px;
      height: 108px;
      margin: 0 auto 12px;
      border-radius: 50%;
      background: conic-gradient(var(--ring-color) calc(var(--p) * 1%), #e9edf5 0);
      position: relative;
      display: grid;
      place-items: center;
      box-shadow: inset 0 1px 8px rgba(26, 33, 49, 0.08);
    }
    .ring::before {
      content: '';
      position: absolute;
      inset: 10px;
      border-radius: 50%;
      background: linear-gradient(180deg, #ffffff, #f2f5fb);
      box-shadow: inset 0 1px 6px rgba(31, 39, 55, 0.09);
    }
    .ring-inner {
      position: relative;
      z-index: 1;
      width: 74px;
      height: 74px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: rgba(255,255,255,0.58);
    }
    .ring-percent {
      font-size: 30px;
      font-weight: 900;
      color: #394554;
    }
    .ring-label {
      font-size: 28px;
      font-weight: 900;
      margin-top: 6px;
      color: #111827;
      letter-spacing: 0;
    }
    .ring-meta, .ring-submeta {
      margin-top: 4px;
      color: #4d5a6f;
      font-size: 14px;
      line-height: 1.35;
    }
    .ring-card:nth-child(1) .ring { --ring-color: #8aa8e0; }
    .ring-card:nth-child(2) .ring { --ring-color: #7ca6ef; }
    .ring-card:nth-child(3) .ring { --ring-color: #86bfe3; }
    .ring-card:nth-child(4) .ring { --ring-color: #9a98f3; }
    .progress-list {
      display: grid;
      gap: 12px;
    }
    .progress-row {
      display: grid;
      grid-template-columns: 84px 1fr 50px;
      gap: 10px;
      align-items: center;
    }
    .progress-label {
      font-weight: 900;
      font-size: 18px;
      color: #202735;
    }
    .progress-track {
      height: 22px;
      border-radius: 999px;
      overflow: hidden;
      background: #d9dee7;
      border: 1px solid rgba(118, 130, 154, 0.18);
      box-shadow: inset 0 1px 3px rgba(0,0,0,0.05);
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #8ba9e9, #7ea5ef);
      border-radius: inherit;
    }
    .progress-value {
      text-align: right;
      font-size: 18px;
      font-weight: 900;
      color: #202735;
    }
    .two-col {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 16px;
    }
    .light-card {
      background: rgba(255,255,255,0.72);
      border: 1px solid rgba(133, 145, 170, 0.18);
      border-radius: 18px;
      padding: 16px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.72);
      min-width: 0;
    }
    .light-card h3 {
      margin: 0 0 10px;
      font-size: 18px;
      font-weight: 900;
      color: #111827;
    }
    .light-card p {
      margin: 0;
      font-size: 15px;
      color: #445163;
      line-height: 1.4;
      word-break: break-word;
    }
    .network-chart {
      min-height: 270px;
      border-radius: 18px;
      background:
        linear-gradient(to bottom, rgba(223,229,239,0.5) 1px, transparent 1px) 0 0 / 100% 36px,
        linear-gradient(to right, rgba(223,229,239,0.5) 1px, transparent 1px) 0 0 / 10% 100%,
        rgba(255,255,255,0.74);
      border: 1px solid rgba(133, 145, 170, 0.18);
      position: relative;
      overflow: hidden;
    }
    .network-chart::before,
    .network-chart::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 2px;
      background: rgba(138, 168, 224, 0.18);
    }
    .network-chart::after {
      height: 100%;
      width: 100%;
      background:
        linear-gradient(180deg, rgba(121, 155, 228, 0.0) 0%, rgba(121, 155, 228, 0.15) 100%);
      clip-path: polygon(0 85%, 3% 82%, 6% 89%, 10% 80%, 15% 84%, 20% 78%, 25% 84%, 30% 62%, 36% 86%, 43% 83%, 49% 58%, 56% 84%, 63% 81%, 70% 85%, 78% 80%, 85% 77%, 92% 84%, 100% 82%, 100% 100%, 0 100%);
      opacity: 0.45;
    }
    .kv-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .kv-box {
      background: rgba(255,255,255,0.82);
      border: 1px solid rgba(133,145,170,0.16);
      border-radius: 14px;
      padding: 12px 14px;
      min-width: 0;
    }
    .kv-box .label {
      color: #4a5970;
      font-size: 14px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .kv-box .value {
      color: #1a2232;
      font-size: 16px;
      font-weight: 900;
      line-height: 1.25;
    }
    .kv-table {
      display: grid;
      gap: 6px;
    }
    .kv-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      padding: 7px 0;
      border-bottom: 1px dashed rgba(99, 112, 133, 0.25);
      font-size: 15px;
      align-items: center;
    }
    .kv-row:last-child { border-bottom: 0; }
    .kv-row span:first-child {
      color: #374356;
      font-weight: 800;
    }
    .kv-row span:last-child {
      color: #111827;
      font-weight: 900;
      text-align: right;
    }
    .feature-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .health-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .health-item {
      background: rgba(255,255,255,0.8);
      border-radius: 14px;
      padding: 12px 14px;
      border: 1px solid rgba(133,145,170,0.16);
    }
    .health-item strong {
      display: block;
      font-size: 16px;
      color: #101726;
      margin-bottom: 4px;
    }
    .health-item span {
      display: block;
      font-size: 14px;
      color: #516075;
      line-height: 1.35;
    }
    .tone-green { background: rgba(236, 248, 240, 0.92); }
    .tone-yellow { background: rgba(255, 249, 223, 0.92); }
    .tone-red { background: rgba(252, 232, 232, 0.92); }
    .tone-gray { background: rgba(242, 245, 250, 0.92); }
    .alert-list {
      display: grid;
      gap: 10px;
    }
    .alert-row {
      display: grid;
      grid-template-columns: 80px 1fr;
      gap: 10px;
      align-items: center;
      background: rgba(255,255,255,0.82);
      border: 1px solid rgba(133,145,170,0.16);
      border-radius: 14px;
      padding: 12px 14px;
    }
    .alert-row span {
      font-size: 14px;
      font-weight: 900;
      color: #54647a;
    }
    .alert-row strong {
      font-size: 15px;
      font-weight: 900;
      color: #111827;
    }
    .section-headline {
      font-size: 18px;
      font-weight: 900;
      margin-bottom: 10px;
      color: #111827;
    }
    .footer {
      text-align: center;
      margin-top: 16px;
      color: #7a8598;
      font-size: 13px;
      line-height: 1.45;
      text-shadow: 0 1px 0 rgba(255,255,255,0.5);
    }
  </style>
</head>
<body>
  <div class="page">
    <main class="panel">
      <section class="hero">
        <div class="hero-top">
          <div class="avatar-wrap">
            <div class="avatar">${escapeHtml(avatarText)}</div>
            <div class="avatar-badge"></div>
          </div>
          <div class="hero-main">
            <div class="title-row">
              <h1>${escapeHtml(botName)}</h1>
              <span class="subtitle-badge">${escapeHtml(String(data.botName || 'NapCat.Onebot').slice(0, 24))}</span>
            </div>
            <div class="top-band">
              ${renderPill(`Bot已运行 ${data.rows?.find(item => item[0] === '运行时长')?.[1] || '0秒'}`, 'gray')}
              ${renderPill(`Node ${process.version}`, 'gray')}
              ${renderPill(`PID ${process.pid}`, 'gray')}
              ${renderPill(data.statusText || '运行正常', statusTone === 'warn' ? 'yellow' : 'green')}
            </div>
            <div class="info-row">
              ${renderPill(`AI ${aiUsage.requestCountText || '0'} 次`, 'gray')}
              ${renderPill(`群管理 ${data.features?.find(item => item[0] === '群管理')?.[1] ? '开' : '关'}`, data.features?.find(item => item[0] === '群管理')?.[1] ? 'green' : 'red')}
              ${renderPill(`群总数 ${data.rows?.find(item => item[0] === '当前会话')?.[1] || '0'}`, 'gray')}
              ${renderPill(`图片生成 ${imageUsage.requestCountText || '0'} 次`, 'gray')}
              ${renderPill(`控制台 ${data.rows?.find(item => item[0] === '控制台')?.[1] || '未知'}`, 'gray')}
            </div>
            <div class="time-row">${escapeHtml(generatedAt)}</div>
          </div>
        </div>
      </section>

      ${renderSectionBlock('系统状态', `
        <div class="summary-grid">
          ${renderProgressRing(cpuPercent, 'CPU', `${formatWithUnit(cpuPercent.toFixed(0), '%')}`, `CPU 占用`, 'blue')}
          ${renderProgressRing(memoryPercent, 'RAM', `${formatWithUnit(resources.usedMemoryBytes / 1024 / 1024 / 1024, ' GB')} / ${formatWithUnit(resources.totalMemoryBytes / 1024 / 1024 / 1024, ' GB')}`, `Heap ${formatWithUnit(resources.heapUsedBytes / 1024 / 1024, ' MB')}`, 'blue')}
          ${renderProgressRing(0, 'SWAP', '0%', '未启用', 'blue')}
          ${renderProgressRing(heapPercent, 'Node', process.version.replace(/^v/, 'v'), `总 ${formatWithUnit(resources.heapTotalBytes / 1024 / 1024, ' MB')}`, 'blue')}
        </div>
      `)}

      ${renderSectionBlock('资源与磁盘', `
        <div class="progress-list">
          <div class="progress-row">
            <div class="progress-label">/usr…</div>
            <div class="progress-track"><div class="progress-fill" style="width:${clampPercent(diskMain)}%"></div></div>
            <div class="progress-value">${Math.round(diskMain)}%</div>
          </div>
      <div class="progress-row">
        <div class="progress-label">/</div>
        <div class="progress-track"><div class="progress-fill" style="width:${clampPercent(diskSecondary)}%"></div></div>
        <div class="progress-value">${Math.round(diskSecondary)}%</div>
      </div>
      <div class="kv-row">
        <span>系统负载</span>
        <span>${escapeHtml(String(resources.loadAvg || '0.00 / 0.00 / 0.00'))}</span>
      </div>
    </div>
  `)}

      ${renderSectionBlock('网络状态', `
        <div class="two-col">
          <div class="light-card">
            <div class="section-headline">网络趋势</div>
            <div class="network-chart"></div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:14px;">
              ${renderSmallCard('上传速度', '0.50 KB/s', '当前')}
              ${renderSmallCard('下载速度', '1.53 KB/s', '当前')}
              ${renderSmallCard('上传量', '2.67 GB', '累计')}
              ${renderSmallCard('下载量', '4.50 GB', '累计')}
            </div>
          </div>
          <div class="light-card">
            <div class="section-headline">AI 统计</div>
            <div class="kv-table">
              ${renderInfoLine('请求数', aiUsage.requestCountText || '0')}
              ${renderInfoLine('成功 / 失败', `${aiUsage.successCountText || '0'} / ${aiUsage.errorCountText || '0'}`)}
              ${renderInfoLine('总 Tokens', aiUsage.totalTokensText || '0')}
              ${renderInfoLine('预估成本', aiUsage.costText || '$0.000000')}
              ${renderInfoLine('最近 AI', latestAi.detail || '暂无')}
              ${renderInfoLine('最近生图', imageLatest.detail || '暂无')}
            </div>
          </div>
        </div>
      `)}

      ${renderSectionBlock('服务与内存', `
        <div class="kv-grid">
          <div class="kv-box">
            <div class="label">服务器</div>
            <div class="value">${escapeHtml(process.platform)} ${escapeHtml(process.arch)}<br>系统运行 ${escapeHtml(data.rows?.find(item => item[0] === '运行时长')?.[1] || '0秒')}</div>
          </div>
          <div class="kv-box">
            <div class="label">内存</div>
            <div class="value">已用内存：${escapeHtml(formatWithUnit(resources.usedMemoryBytes / 1024 / 1024, ' MB'))}<br>Heap 占用：${escapeHtml(formatWithUnit(resources.heapUsedBytes / 1024 / 1024, ' MB'))}</div>
          </div>
          <div class="kv-box">
            <div class="label">状态</div>
            <div class="value">控制台：${escapeHtml(data.rows?.find(item => item[0] === '控制台')?.[1] || '未知')}<br>接口健康：${health.filter(item => item.tone === 'success').length}/${health.length}</div>
          </div>
        </div>
      `)}

      ${renderSectionBlock('接口健康', `
        <div class="health-grid">
          ${buildHealthPills(health)}
        </div>
      `)}

      ${renderSectionBlock('运行告警', `
        <div class="alert-list">
          ${buildAlertRows(alerts)}
        </div>
      `)}

      ${renderSectionBlock('统计明细', `
        <div class="two-col">
          <div class="light-card">
            <h3>AI 用量</h3>
            <p>主要场景：${escapeHtml(topScene.label || '暂无记录')} · ${escapeHtml(topScene.requestsText || '0')} 次 · ${escapeHtml(topScene.tokensText || '0')} Tokens</p>
            <p style="margin-top:10px;">主要模型：${escapeHtml(topModel.label || '暂无记录')} · ${escapeHtml(topModel.requestsText || '0')} 次 · ${escapeHtml(topModel.tokensText || '0')} Tokens</p>
            <div style="margin-top:14px;">${buildFeaturePills(features)}</div>
          </div>
          <div class="light-card">
            <h3>图片生成</h3>
            <p>今日请求：${escapeHtml(imageUsage.requestCountText || '0')} · 成功 ${escapeHtml(imageUsage.successCountText || '0')} · 失败 ${escapeHtml(imageUsage.errorCountText || '0')}</p>
            <p style="margin-top:10px;">平均耗时：${escapeHtml(imageUsage.averageElapsedText || '0ms')}</p>
            <p style="margin-top:10px;">最近一次：${escapeHtml(imageLatest.statusText || '暂无记录')} · ${escapeHtml(imageLatest.detail || '今日还没有记录到图片生成请求。')}</p>
          </div>
        </div>
      `)}

      ${renderSectionBlock('运行信息', `
        <div class="kv-table">
          ${rows.map(([key, value]) => `<div class="kv-row"><span>${escapeHtml(key)}</span><span>${escapeHtml(value)}</span></div>`).join('')}
        </div>
      `)}

      <div class="footer">
        Created by crystelf-plugin<br>
        ${escapeHtml(generatedAt)}
      </div>
    </main>
  </div>
</body>
</html>`;
}

export async function renderStatusImage(data = {}) {
  const outputDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `status_${Date.now()}.png`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 2400, deviceScaleFactor: 2 });
    await page.setContent(buildStatusImageHtml(data), { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.evaluate(async () => {
      if (document?.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {}
      }
    });
    const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await page.setViewport({ width: 900, height: Math.min(Math.max(height, 1180), 5000), deviceScaleFactor: 2 });
    await page.screenshot({ path: outputPath, fullPage: true });
    await page.close();
    return outputPath;
  } finally {
    await browser.close();
  }
}
