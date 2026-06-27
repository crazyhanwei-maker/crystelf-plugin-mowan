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

function limitText(value = '', max = 120) {
  const text = String(value || '').trim();
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join('')}...`;
}

function clampPercent(value = 0) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

function formatWithUnit(value = 0, unit = '') {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return `0${unit}`;
  const digits = Math.abs(number) >= 100 ? 0 : Math.abs(number) >= 10 ? 1 : 2;
  return `${number.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })}${unit}`;
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

function getRowValue(rows = [], key = '', fallback = '未知') {
  const found = rows.find(item => item?.[0] === key);
  const value = found?.[1];
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function getFeatureEnabled(features = [], key = '') {
  return Boolean(features.find(item => item?.[0] === key)?.[1]);
}

function renderPill(text = '', tone = 'gray') {
  return `<span class="pill tone-${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

function renderProgressRing(percent = 0, label = '', meta = '', submeta = '', tone = 'cyan') {
  const safe = clampPercent(percent);
  return `
    <div class="ring-card tone-${escapeHtml(tone)}">
      <div class="ring" style="--p:${safe}">
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

function renderProgressBar(label = '', value = '', percent = 0, tone = 'cyan') {
  const safe = clampPercent(percent);
  return `<div class="progress-row tone-${escapeHtml(tone)}">
    <div class="progress-label">${escapeHtml(label)}</div>
    <div class="progress-track"><div class="progress-fill" style="width:${safe}%"></div></div>
    <div class="progress-value">${escapeHtml(value)}</div>
  </div>`;
}

function renderMetricCard(title = '', value = '', subtitle = '', tone = 'cyan') {
  return `<div class="metric-card tone-${escapeHtml(tone)}">
    <div class="metric-title">${escapeHtml(title)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
    <div class="metric-sub">${escapeHtml(subtitle)}</div>
  </div>`;
}

function renderInfoLine(label = '', value = '') {
  return `<div class="info-line">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(limitText(value, 120))}</strong>
  </div>`;
}

function renderSectionBlock(title = '', content = '') {
  return `<section class="glass-card section">
    <div class="section-title"><span class="section-dot"></span><span>${escapeHtml(title)}</span></div>
    ${content}
  </section>`;
}

function buildFeaturePills(features = []) {
  return features
    .map(([name, enabled]) => renderPill(`${name} ${enabled ? '开启' : '关闭'}`, enabled ? 'success' : 'off'))
    .join('');
}

function buildHealthItems(health = []) {
  return health.map(item => {
    const tone = item.tone === 'success' ? 'success' : 'warn';
    return `<div class="health-item tone-${tone}">
      <div class="health-head">
        <strong>${escapeHtml(item.label || '')}</strong>
        <span>${tone === 'success' ? '正常' : '检查'}</span>
      </div>
      <p>${escapeHtml(limitText(item.detail || '', 78))}</p>
    </div>`;
  }).join('');
}

function buildAlertRows(alerts = []) {
  return alerts.map(item => {
    const tone = item.tone === 'success' || item.tone === 'green' ? 'success' : 'warn';
    return `<div class="alert-row tone-${tone}">
      <span>${escapeHtml(item.label || '提示')}</span>
      <strong>${escapeHtml(limitText(item.text || '', 90))}</strong>
    </div>`;
  }).join('');
}

function renderCallColumn(label = '', value = 0, maxValue = 1, tone = 'cyan') {
  const number = Number(value || 0);
  const safeMax = Math.max(1, Number(maxValue || 1));
  const height = Math.max(16, Math.round((Math.max(0, number) / safeMax) * 132));
  return `<div class="call-column tone-${escapeHtml(tone)}">
    <div class="call-bar-wrap"><div class="call-bar" style="height:${height}px"></div></div>
    <strong>${Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0'}</strong>
    <span>${escapeHtml(label)}</span>
  </div>`;
}

export function buildStatusImageHtml(data = {}) {
  const aiUsage = data.aiUsage || {};
  const imageUsage = data.imageUsage || {};
  const health = Array.isArray(data.health) ? data.health : [];
  const alerts = Array.isArray(data.alerts) && data.alerts.length > 0
    ? data.alerts
    : [{ tone: 'success', label: '状态', text: '暂无运行告警' }];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const features = Array.isArray(data.features) ? data.features : [];
  const topScene = aiUsage.topScene || {};
  const topModel = aiUsage.topModel || {};
  const latestAi = aiUsage.latest || {};
  const imageLatest = imageUsage.latest || {};
  const consoleWallpaper = String(data.consoleWallpaper || '').trim() || resolveConsoleWallpaperDataUrl();
  const botName = data.botName || '魔丸';
  const avatarText = data.avatarText || '魔';
  const statusTone = data.statusTone === 'warn' ? 'warn' : 'success';
  const generatedAt = data.generatedAt || '';
  const resources = data.resources || {};

  const pluginVersion = getRowValue(rows, '插件版本', 'crystelf-plugin v2.0.2');
  const adapter = getRowValue(rows, '适配器', '未知适配器');
  const botId = getRowValue(rows, 'Bot', '未知');
  const uptime = getRowValue(rows, '运行时长', '0秒');
  const nodeVersion = getRowValue(rows, 'Node', process.version);
  const platform = getRowValue(rows, '平台', `${process.platform} ${process.arch}`);
  const loadAvg = String(resources.loadAvg || getRowValue(rows, '系统负载', '0.00 / 0.00 / 0.00'));
  const consoleState = getRowValue(rows, '控制台', '未知');

  const cpuPercent = clampPercent(resources.cpuPercent || 0);
  const memoryPercent = clampPercent(resources.memoryPercent || 0);
  const heapPercent = clampPercent(resources.heapPercent || 0);
  const healthOkCount = health.filter(item => item.tone === 'success').length;
  const healthPercent = health.length ? clampPercent((healthOkCount / health.length) * 100) : 100;

  const aiRequests = Number(aiUsage.requestCount || 0);
  const aiSuccess = Number(aiUsage.successCount || 0);
  const aiErrors = Number(aiUsage.errorCount || 0);
  const imageRequests = Number(imageUsage.requestCount || 0);
  const imageSuccess = Number(imageUsage.successCount || 0);
  const imageErrors = Number(imageUsage.errorCount || 0);
  const aiSuccessRate = aiRequests > 0 ? clampPercent((aiSuccess / aiRequests) * 100) : 0;
  const imageSuccessRate = imageRequests > 0 ? clampPercent((imageSuccess / imageRequests) * 100) : 0;
  const maxCallValue = Math.max(aiRequests, aiSuccess, aiErrors, imageRequests, imageSuccess, imageErrors, 1);

  const memoryUsedGb = formatWithUnit((resources.usedMemoryBytes || 0) / 1024 / 1024 / 1024, ' GB');
  const memoryTotalGb = formatWithUnit((resources.totalMemoryBytes || 0) / 1024 / 1024 / 1024, ' GB');
  const heapUsedMb = formatWithUnit((resources.heapUsedBytes || 0) / 1024 / 1024, ' MB');
  const heapTotalMb = formatWithUnit((resources.heapTotalBytes || 0) / 1024 / 1024, ' MB');
  const rssMb = formatWithUnit((resources.rssBytes || 0) / 1024 / 1024, ' MB');

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
      --glass-strong: rgba(255, 255, 255, 0.78);
      --shadow: 0 18px 44px rgba(16, 24, 40, 0.22);
      --cyan: #58c7dd;
      --blue: #7aa5f6;
      --violet: #a98af4;
      --pink: #f59bbb;
      --green: #45c987;
      --amber: #f3bd54;
      --red: #ef7171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: var(--page-width);
      min-height: 1180px;
      padding: 34px;
      font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
      background:
        ${bodyBackground}
        radial-gradient(circle at 18% 12%, rgba(255,255,255,0.5), transparent 26%),
        radial-gradient(circle at 86% 24%, rgba(142, 188, 247, 0.2), transparent 30%),
        linear-gradient(135deg, #f3f7fb, #f7edf4 48%, #edf6f7);
      color: var(--text);
    }
    .status-sheet {
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
      position: relative;
    }
    .hero::after {
      content: "";
      position: absolute;
      left: 210px;
      right: 30px;
      top: 86px;
      height: 2px;
      background: linear-gradient(90deg, rgba(21,25,34,0.72), rgba(21,25,34,0.12));
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 154px 1fr;
      gap: 24px;
      align-items: start;
      position: relative;
      z-index: 1;
    }
    .avatar-frame {
      width: 154px;
      height: 154px;
      border-radius: 50%;
      padding: 8px;
      background: linear-gradient(145deg, rgba(255,255,255,0.92), rgba(219,228,241,0.72));
      box-shadow: 0 14px 30px rgba(30, 41, 59, 0.2);
      position: relative;
    }
    .avatar {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 35% 28%, rgba(255,255,255,0.95), rgba(255,255,255,0.2) 34%, transparent 35%),
        linear-gradient(145deg, #fff8fb, #e8f5ff 58%, #f8dce9);
      border: 2px solid rgba(255,255,255,0.86);
      color: #e77da6;
      font-size: 56px;
      font-weight: 900;
      text-shadow: 0 2px 0 rgba(255,255,255,0.8);
    }
    .online-dot {
      position: absolute;
      left: 12px;
      bottom: 20px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--green);
      border: 4px solid rgba(255,255,255,0.95);
      box-shadow: 0 0 0 4px rgba(69, 201, 135, 0.22);
    }
    .hero-main {
      min-width: 0;
      padding-top: 4px;
    }
    .title-line {
      display: flex;
      align-items: flex-end;
      gap: 14px;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0;
      font-size: 42px;
      line-height: 1.1;
      font-weight: 900;
      letter-spacing: 0;
      color: #111827;
      text-shadow: 0 1px 0 rgba(255,255,255,0.4);
    }
    .pro-label {
      margin-bottom: 5px;
      padding: 5px 10px;
      border-radius: 10px;
      background: rgba(17,24,39,0.78);
      color: #fff;
      font-size: 15px;
      font-weight: 900;
    }
    .plugin-version {
      margin-top: 18px;
      color: #273244;
      font-size: 17px;
      font-weight: 900;
    }
    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      margin-top: 13px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 6px 11px;
      border-radius: 10px;
      background: rgba(239,244,251,0.88);
      border: 1px solid rgba(255,255,255,0.66);
      color: #273244;
      font-size: 15px;
      font-weight: 900;
      box-shadow: 0 4px 10px rgba(15,23,42,0.08);
    }
    .pill.tone-success { background: linear-gradient(180deg, rgba(224,249,237,0.96), rgba(191,241,218,0.92)); color: #1d6845; }
    .pill.tone-warn { background: linear-gradient(180deg, rgba(255,242,204,0.98), rgba(255,226,153,0.9)); color: #7a5614; }
    .pill.tone-off { background: linear-gradient(180deg, rgba(244,247,251,0.95), rgba(226,232,240,0.88)); color: #64748b; }
    .pill.tone-red { background: linear-gradient(180deg, rgba(255,225,225,0.96), rgba(255,205,205,0.9)); color: #9f3030; }
    .time-line {
      margin-top: 14px;
      text-align: right;
      color: #252f42;
      font-size: 14px;
      font-weight: 800;
    }
    .section {
      padding: 20px;
    }
    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
      font-size: 22px;
      font-weight: 900;
      color: #111827;
    }
    .section-dot {
      width: 9px;
      height: 24px;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--cyan), var(--pink));
      box-shadow: 0 0 18px rgba(88, 199, 221, 0.4);
    }
    .ring-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }
    .ring-card {
      text-align: center;
      padding: 18px 12px 16px;
      border-radius: 22px;
      background: rgba(255,255,255,0.56);
      border: 1px solid rgba(255,255,255,0.7);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.72);
      --ring-color: var(--cyan);
    }
    .ring-card.tone-blue { --ring-color: var(--blue); }
    .ring-card.tone-violet { --ring-color: var(--violet); }
    .ring-card.tone-green { --ring-color: var(--green); }
    .ring-card.tone-amber { --ring-color: var(--amber); }
    .ring {
      width: 116px;
      height: 116px;
      margin: 0 auto 12px;
      border-radius: 50%;
      position: relative;
      display: grid;
      place-items: center;
      background: conic-gradient(var(--ring-color) calc(var(--p) * 1%), rgba(226,232,240,0.9) 0);
      box-shadow:
        inset 0 2px 6px rgba(15,23,42,0.12),
        0 8px 18px rgba(15,23,42,0.12);
    }
    .ring::before {
      content: "";
      position: absolute;
      inset: 11px;
      border-radius: 50%;
      background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,244,250,0.94));
      box-shadow: inset 0 1px 7px rgba(15,23,42,0.1);
    }
    .ring-inner {
      position: relative;
      z-index: 1;
      width: 74px;
      height: 74px;
      border-radius: 50%;
      display: grid;
      place-items: center;
    }
    .ring-percent {
      font-size: 30px;
      font-weight: 900;
      color: #273244;
    }
    .ring-label {
      font-size: 25px;
      font-weight: 900;
      color: #111827;
      letter-spacing: 0;
    }
    .ring-meta {
      margin-top: 7px;
      color: #334155;
      font-size: 14px;
      font-weight: 900;
      min-height: 18px;
    }
    .ring-submeta {
      margin-top: 4px;
      color: #637083;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.32;
      min-height: 17px;
      word-break: break-word;
    }
    .progress-list {
      display: grid;
      gap: 14px;
    }
    .progress-row {
      display: grid;
      grid-template-columns: 112px 1fr 178px;
      gap: 14px;
      align-items: center;
      padding: 10px 12px;
      border-radius: 16px;
      background: rgba(255,255,255,0.54);
      border: 1px solid rgba(255,255,255,0.65);
    }
    .progress-label {
      font-size: 18px;
      font-weight: 900;
      color: #172033;
    }
    .progress-track {
      height: 23px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(203,213,225,0.82);
      border: 1px solid rgba(148,163,184,0.22);
      box-shadow: inset 0 1px 4px rgba(15,23,42,0.12);
    }
    .progress-fill {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--cyan), var(--blue));
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.4);
    }
    .progress-row.tone-pink .progress-fill { background: linear-gradient(90deg, var(--pink), var(--violet)); }
    .progress-row.tone-green .progress-fill { background: linear-gradient(90deg, var(--green), var(--cyan)); }
    .progress-row.tone-amber .progress-fill { background: linear-gradient(90deg, var(--amber), #ffd27a); }
    .progress-value {
      text-align: right;
      font-size: 17px;
      font-weight: 900;
      color: #172033;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    .metric-card {
      min-height: 106px;
      border-radius: 18px;
      padding: 14px;
      background: rgba(255,255,255,0.58);
      border: 1px solid rgba(255,255,255,0.68);
      position: relative;
      overflow: hidden;
    }
    .metric-card::before {
      content: "";
      position: absolute;
      right: -24px;
      top: -30px;
      width: 76px;
      height: 76px;
      border-radius: 50%;
      background: rgba(88,199,221,0.2);
    }
    .metric-card.tone-blue::before { background: rgba(122,165,246,0.22); }
    .metric-card.tone-pink::before { background: rgba(245,155,187,0.24); }
    .metric-card.tone-green::before { background: rgba(69,201,135,0.22); }
    .metric-card.tone-amber::before { background: rgba(243,189,84,0.23); }
    .metric-title {
      position: relative;
      color: #516071;
      font-size: 14px;
      font-weight: 900;
    }
    .metric-value {
      position: relative;
      margin-top: 8px;
      color: #111827;
      font-size: 27px;
      line-height: 1.1;
      font-weight: 900;
      word-break: break-word;
    }
    .metric-sub {
      position: relative;
      margin-top: 8px;
      color: #64748b;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.28;
      word-break: break-word;
    }
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .sub-card {
      min-width: 0;
      border-radius: 18px;
      padding: 16px;
      background: rgba(255,255,255,0.56);
      border: 1px solid rgba(255,255,255,0.68);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
    }
    .sub-title {
      margin: 0 0 12px;
      color: #111827;
      font-size: 18px;
      font-weight: 900;
    }
    .info-table {
      display: grid;
      gap: 6px;
    }
    .info-line {
      display: grid;
      grid-template-columns: 96px 1fr;
      gap: 14px;
      align-items: start;
      padding: 8px 0;
      border-bottom: 1px dashed rgba(71,85,105,0.22);
      font-size: 15px;
    }
    .info-line:last-child { border-bottom: 0; }
    .info-line span {
      color: #526072;
      font-weight: 900;
    }
    .info-line strong {
      color: #111827;
      font-weight: 900;
      text-align: right;
      line-height: 1.34;
      word-break: break-word;
    }
    .call-grid {
      height: 210px;
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 10px;
      align-items: end;
      padding: 16px 10px 8px;
      border-radius: 18px;
      background:
        linear-gradient(to bottom, rgba(148,163,184,0.18) 1px, transparent 1px) 0 0 / 100% 42px,
        rgba(255,255,255,0.44);
      border: 1px solid rgba(255,255,255,0.68);
    }
    .call-column {
      display: grid;
      grid-template-rows: 1fr auto auto;
      justify-items: center;
      gap: 5px;
      min-width: 0;
      --bar-color: var(--cyan);
    }
    .call-column.tone-blue { --bar-color: var(--blue); }
    .call-column.tone-pink { --bar-color: var(--pink); }
    .call-column.tone-green { --bar-color: var(--green); }
    .call-column.tone-red { --bar-color: var(--red); }
    .call-column.tone-violet { --bar-color: var(--violet); }
    .call-bar-wrap {
      height: 138px;
      width: 28px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }
    .call-bar {
      width: 100%;
      border-radius: 999px 999px 8px 8px;
      background: linear-gradient(180deg, rgba(255,255,255,0.36), var(--bar-color));
      box-shadow: 0 8px 14px rgba(15,23,42,0.14);
    }
    .call-column strong {
      color: #111827;
      font-size: 15px;
      font-weight: 900;
    }
    .call-column span {
      color: #516071;
      font-size: 12px;
      font-weight: 900;
      white-space: nowrap;
    }
    .health-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .health-item {
      border-radius: 16px;
      padding: 13px 14px;
      background: rgba(255,255,255,0.56);
      border: 1px solid rgba(255,255,255,0.68);
    }
    .health-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }
    .health-head strong {
      color: #111827;
      font-size: 16px;
      font-weight: 900;
    }
    .health-head span {
      flex: 0 0 auto;
      min-width: 46px;
      text-align: center;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 900;
      background: rgba(69,201,135,0.16);
      color: #1d6845;
    }
    .health-item.tone-warn .health-head span {
      background: rgba(243,189,84,0.22);
      color: #7a5614;
    }
    .health-item p {
      margin: 7px 0 0;
      color: #5d6a7d;
      font-size: 13px;
      line-height: 1.35;
      font-weight: 700;
      word-break: break-word;
    }
    .alert-list {
      display: grid;
      gap: 10px;
    }
    .alert-row {
      display: grid;
      grid-template-columns: 86px 1fr;
      gap: 12px;
      align-items: center;
      border-radius: 15px;
      padding: 12px 14px;
      background: rgba(255,255,255,0.56);
      border: 1px solid rgba(255,255,255,0.68);
    }
    .alert-row span {
      color: #526072;
      font-size: 14px;
      font-weight: 900;
    }
    .alert-row strong {
      color: #111827;
      font-size: 15px;
      line-height: 1.35;
      font-weight: 900;
      word-break: break-word;
    }
    .alert-row.tone-warn {
      background: rgba(255,244,214,0.66);
    }
    .feature-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
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
  <main class="status-sheet">
    <section class="glass-card hero">
      <div class="hero-grid">
        <div class="avatar-frame">
          <div class="avatar">${escapeHtml(avatarText)}</div>
          <div class="online-dot"></div>
        </div>
        <div class="hero-main">
          <div class="title-line">
            <h1>${escapeHtml(botName)}</h1>
            <span class="pro-label">状态 Pro</span>
          </div>
          <div class="plugin-version">${escapeHtml(pluginVersion)}</div>
          <div class="pill-row">
            ${renderPill(adapter, 'gray')}
            ${renderPill(`Bot ${botId}`, 'gray')}
            ${renderPill(`已运行 ${uptime}`, 'gray')}
            ${renderPill(data.statusText || '运行正常', statusTone)}
          </div>
          <div class="pill-row">
            ${renderPill(`AI ${aiUsage.requestCountText || '0'} 次`, 'gray')}
            ${renderPill(`生图 ${imageUsage.requestCountText || '0'} 次`, 'gray')}
            ${renderPill(`群管理 ${getFeatureEnabled(features, '群管理') ? '开启' : '关闭'}`, getFeatureEnabled(features, '群管理') ? 'success' : 'off')}
            ${renderPill(`控制台 ${consoleState}`, 'gray')}
          </div>
          <div class="time-line">${escapeHtml(generatedAt)}  生成</div>
        </div>
      </div>
    </section>

    ${renderSectionBlock('核心状态', `
      <div class="ring-grid">
        ${renderProgressRing(cpuPercent, 'CPU', `${Math.round(cpuPercent)}%`, '进程估算占用', 'cyan')}
        ${renderProgressRing(memoryPercent, 'RAM', `${memoryUsedGb} / ${memoryTotalGb}`, `RSS ${rssMb}`, 'blue')}
        ${renderProgressRing(heapPercent, 'Heap', `${heapUsedMb} / ${heapTotalMb}`, 'Node 堆内存', 'violet')}
        ${renderProgressRing(healthPercent, 'API', `${healthOkCount}/${health.length || 0}`, '接口配置健康', healthPercent >= 100 ? 'green' : 'amber')}
      </div>
    `)}

    ${renderSectionBlock('资源占用', `
      <div class="progress-list">
        ${renderProgressBar('物理内存', `${memoryUsedGb} / ${memoryTotalGb}`, memoryPercent, 'green')}
        ${renderProgressBar('Node Heap', `${heapUsedMb} / ${heapTotalMb}`, heapPercent, 'pink')}
        ${renderProgressBar('CPU 占用', `${Math.round(cpuPercent)}%`, cpuPercent, 'amber')}
        ${renderProgressBar('接口健康', `${healthOkCount}/${health.length || 0}`, healthPercent, healthPercent >= 100 ? 'green' : 'amber')}
      </div>
    `)}

    ${renderSectionBlock('今日调用', `
      <div class="metric-grid">
        ${renderMetricCard('AI 请求', aiUsage.requestCountText || '0', `成功率 ${Math.round(aiSuccessRate)}%`, 'blue')}
        ${renderMetricCard('AI Tokens', aiUsage.totalTokensText || '0', `成本 ${aiUsage.costText || '$0.000000'}`, 'cyan')}
        ${renderMetricCard('图片生成', imageUsage.requestCountText || '0', `成功率 ${Math.round(imageSuccessRate)}%`, 'pink')}
        ${renderMetricCard('平均生图耗时', imageUsage.averageElapsedText || '0ms', imageLatest.statusText || '暂无记录', 'green')}
      </div>
      <div class="call-grid">
        ${renderCallColumn('AI请求', aiRequests, maxCallValue, 'blue')}
        ${renderCallColumn('AI成功', aiSuccess, maxCallValue, 'green')}
        ${renderCallColumn('AI失败', aiErrors, maxCallValue, 'red')}
        ${renderCallColumn('生图请求', imageRequests, maxCallValue, 'pink')}
        ${renderCallColumn('生图成功', imageSuccess, maxCallValue, 'cyan')}
        ${renderCallColumn('生图失败', imageErrors, maxCallValue, 'violet')}
      </div>
    `)}

    ${renderSectionBlock('AI 与生图明细', `
      <div class="two-col">
        <div class="sub-card">
          <div class="sub-title">AI 用量</div>
          <div class="info-table">
            ${renderInfoLine('请求数', aiUsage.requestCountText || '0')}
            ${renderInfoLine('成功 / 失败', `${aiUsage.successCountText || '0'} / ${aiUsage.errorCountText || '0'}`)}
            ${renderInfoLine('总 Tokens', aiUsage.totalTokensText || '0')}
            ${renderInfoLine('主要场景', topScene.label ? `${topScene.label} · ${topScene.requestsText || '0'} 次` : '暂无记录')}
            ${renderInfoLine('主要模型', topModel.label ? `${topModel.label} · ${topModel.tokensText || '0'} Tokens` : '暂无记录')}
            ${renderInfoLine('最近调用', latestAi.detail || '暂无')}
          </div>
        </div>
        <div class="sub-card">
          <div class="sub-title">图片生成</div>
          <div class="info-table">
            ${renderInfoLine('请求数', imageUsage.requestCountText || '0')}
            ${renderInfoLine('成功 / 失败', `${imageUsage.successCountText || '0'} / ${imageUsage.errorCountText || '0'}`)}
            ${renderInfoLine('平均耗时', imageUsage.averageElapsedText || '0ms')}
            ${renderInfoLine('最近状态', imageLatest.statusText || '暂无记录')}
            ${renderInfoLine('最近生图', imageLatest.detail || '今日还没有记录到图片生成请求')}
            ${renderInfoLine('成本估算', aiUsage.costSubText || '按当前价格配置估算')}
          </div>
        </div>
      </div>
    `)}

    ${renderSectionBlock('接口健康', `
      <div class="health-grid">
        ${buildHealthItems(health)}
      </div>
    `)}

    ${renderSectionBlock('运行告警', `
      <div class="alert-list">
        ${buildAlertRows(alerts)}
      </div>
    `)}

    ${renderSectionBlock('功能开关', `
      <div class="feature-pills">${buildFeaturePills(features)}</div>
    `)}

    ${renderSectionBlock('运行信息', `
      <div class="two-col">
        <div class="sub-card">
          <div class="info-table">
            ${renderInfoLine('Bot', botId)}
            ${renderInfoLine('运行时长', uptime)}
            ${renderInfoLine('Node', nodeVersion)}
            ${renderInfoLine('平台', platform)}
          </div>
        </div>
        <div class="sub-card">
          <div class="info-table">
            ${renderInfoLine('进程', getRowValue(rows, '进程', `PID ${process.pid}`))}
            ${renderInfoLine('系统负载', loadAvg)}
            ${renderInfoLine('控制台', consoleState)}
            ${renderInfoLine('生成时间', generatedAt)}
          </div>
        </div>
      </div>
    `)}

    <div class="footer">
      Created by 魔丸插件 & Node ${escapeHtml(nodeVersion)}<br>
      ${escapeHtml(generatedAt)}
    </div>
  </main>
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

  let page = null;
  try {
    page = await browser.newPage();
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
