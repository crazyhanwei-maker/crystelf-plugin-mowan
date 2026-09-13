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

function limitText(value = '', max = 120) {
  const chars = Array.from(String(value || '').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}...`;
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

function resolveConsoleWallpaperDataUrl() {
  const cacheDir = path.join(Path.root, 'temp', 'web-console-background');
  const metaFile = path.join(cacheDir, 'current-image.json');
  const cacheFile = path.join(cacheDir, 'current-image.bin');
  const bundledFile = path.join(Path.root, 'lib', 'webConsole', 'public', 'assets', 'console-wallpaper-default.webp');

  try {
    if (fs.existsSync(metaFile) && fs.existsSync(cacheFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      return readImageDataUrl(cacheFile, String(meta?.contentType || '').trim() || 'image/webp');
    }
  } catch {}

  return readImageDataUrl(bundledFile);
}

function getRowValue(rows = [], key = '', fallback = '未知') {
  const value = rows.find(item => item?.[0] === key)?.[1];
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function getFeatureEnabled(features = [], key = '') {
  return Boolean(features.find(item => item?.[0] === key)?.[1]);
}

// 完整型号串压缩成卡片友好的短型号：Xeon Platinum 8255C / Ryzen 7 9700X
function summarizeCpuModel(model = '') {
  const text = String(model || '').replace(/\((?:R|TM|C)\)/gi, '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const tokens = text.split(' ');
  let start = tokens.findIndex(token => /^(xeon|ryzen|epyc|athlon|celeron|pentium|atom|core|apple|snapdragon|kirin|exynos|dimensity|helio|unisoc|n\d+)/i.test(token));
  if (start > 0 && /^(intel|amd)$/i.test(tokens[start - 1]) && /^core$/i.test(tokens[start])) start -= 1;
  const from = start >= 0 ? start : 0;
  const picked = [];
  for (let i = from; i < tokens.length && picked.length < 4; i++) {
    if (i > from && (/^@/.test(tokens[i]) || /^(cpu|processor|with|gpu)$/i.test(tokens[i]) || /^\d+-core$/i.test(tokens[i]))) break;
    picked.push(tokens[i]);
  }
  let summary = (picked.join(' ') || text).toUpperCase();
  if (summary.length > 24) summary = `${summary.slice(0, 23).replace(/\s+\S*$/, '')}…`;
  return summary;
}

function renderRing(percent = 0, label = '', value = '', detail = '', tone = 'cyan') {
  const safe = clampPercent(percent);
  return `
    <div class="resource-item tone-${escapeHtml(tone)}">
      <div class="resource-ring" style="--value:${safe}">
        <div class="resource-ring-center"><strong>${Math.round(safe)}</strong><span>%</span></div>
      </div>
      <div class="resource-copy">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(detail)}</small>
      </div>
    </div>
  `;
}

function renderMetric(label = '', value = '', detail = '', tone = 'cyan') {
  const compactClass = Array.from(String(value || '')).length > 8 ? ' is-compact' : '';
  return `
    <div class="metric tone-${escapeHtml(tone)}${compactClass}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function renderDetail(label = '', value = '') {
  return `
    <div class="detail-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(limitText(value, 110))}</strong>
    </div>
  `;
}

function renderHealthItems(health = []) {
  return health.map(item => {
    const ready = item.tone === 'success';
    return `
      <div class="health-item ${ready ? 'is-ready' : 'is-warning'}">
        <div class="health-state"><i></i><span>${ready ? '正常' : '检查'}</span></div>
        <strong>${escapeHtml(item.label || '')}</strong>
        <p>${escapeHtml(limitText(item.detail || '', 72))}</p>
      </div>
    `;
  }).join('');
}

function renderAlertRows(alerts = []) {
  return alerts.map(item => {
    const ready = item.tone === 'success' || item.tone === 'green';
    return `
      <div class="alert-item ${ready ? 'is-ready' : 'is-warning'}">
        <span>${escapeHtml(item.label || '提示')}</span>
        <strong>${escapeHtml(limitText(item.text || '', 88))}</strong>
      </div>
    `;
  }).join('');
}

function renderFeaturePills(features = []) {
  return features.map(([name, enabled]) => `
    <span class="feature-pill ${enabled ? 'is-on' : 'is-off'}">
      <i></i><b>${escapeHtml(name)}</b><em>${enabled ? '开' : '关'}</em>
    </span>
  `).join('');
}

function renderRuntimeItem(label = '', value = '') {
  return `
    <div class="runtime-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(limitText(value, 72))}</strong>
    </div>
  `;
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
  const resources = data.resources || {};
  const topScene = aiUsage.topScene || {};
  const topModel = aiUsage.topModel || {};
  const latestAi = aiUsage.latest || {};
  const imageLatest = imageUsage.latest || {};

  const wallpaper = String(data.consoleWallpaper || '').trim() || resolveConsoleWallpaperDataUrl();
  const botName = data.botName || '魔丸';
  const avatarText = data.avatarText || '魔';
  const avatarUrl = String(data.avatarUrl || '').trim();
  const generatedAt = data.generatedAt || '';
  const pluginVersion = getRowValue(rows, '插件版本', 'crystelf-plugin v2.3.1');
  const adapter = getRowValue(rows, '适配器', '未知适配器');
  const botId = getRowValue(rows, 'Bot', '未知');
  const uptime = getRowValue(rows, '运行时长', '0秒');
  const nodeVersion = getRowValue(rows, 'Node', process.version);
  const platform = getRowValue(rows, '平台', `${process.platform} ${process.arch}`);
  const processText = getRowValue(rows, '进程', `PID ${process.pid}`);
  const consoleState = getRowValue(rows, '控制台', '未知');
  const loadAvg = String(resources.loadAvg || getRowValue(rows, '系统负载', '0.00 / 0.00 / 0.00'));
  const disks = (Array.isArray(resources.disks) ? resources.disks : []).slice(0, 4).map(disk => {
    const percent = clampPercent(disk.percent || 0);
    return {
      ...disk,
      percent,
      barColor: percent >= 85 ? 'var(--red)' : percent >= 60 ? 'var(--amber)' : 'var(--green)',
    };
  });
  const diskBlock = disks.length ? `
      <div class="disk-grid">
        ${disks.map(disk => `
        <div class="disk-item">
          <div class="disk-head"><span>${escapeHtml(disk.mount)}</span><strong>${disk.percent}%</strong></div>
          <div class="disk-bar"><i style="width:${disk.percent}%;background:${disk.barColor}"></i></div>
          <div class="disk-copy">${escapeHtml(disk.usedText || '')} / ${escapeHtml(disk.totalText || '')}</div>
        </div>`).join('')}
      </div>` : '';

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
  const aiSuccessRate = aiRequests > 0 ? `${Math.round(clampPercent((aiSuccess / aiRequests) * 100))}%` : '--';
  const imageSuccessRate = imageRequests > 0 ? `${Math.round(clampPercent((imageSuccess / imageRequests) * 100))}%` : '--';

  const memoryUsedGb = formatWithUnit((resources.usedMemoryBytes || 0) / 1024 / 1024 / 1024, ' GB');
  const memoryTotalGb = formatWithUnit((resources.totalMemoryBytes || 0) / 1024 / 1024 / 1024, ' GB');
  const heapUsedMb = formatWithUnit((resources.heapUsedBytes || 0) / 1024 / 1024, ' MB');
  const heapTotalMb = formatWithUnit((resources.heapTotalBytes || 0) / 1024 / 1024, ' MB');
  const rssMb = formatWithUnit((resources.rssBytes || 0) / 1024 / 1024, ' MB');
  const cpuModel = summarizeCpuModel(resources.cpuModel);
  const memoryType = String(resources.memoryType || '').trim();
  const swap = resources.swap && Number(resources.swap.totalBytes) > 0 ? resources.swap : null;
  const swapText = swap ? `虚拟内存 ${formatWithUnit(swap.usedBytes / 1024 / 1024 / 1024, ' GB')} / ${formatWithUnit(swap.totalBytes / 1024 / 1024 / 1024, ' GB')}` : '';
  const formatBytesShort = value => {
    const gb = Number(value || 0) / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(Number(value || 0) / 1024 / 1024)} MB`;
  };
  const network = resources.network && (Number(resources.network.rxToday) > 0 || Number(resources.network.txToday) > 0) ? resources.network : null;
  const networkText = network ? `今日网络 ↑${formatBytesShort(network.txToday)} ↓${formatBytesShort(network.rxToday)}` : '';
  const diskIo = resources.diskIo || null;
  const diskIoText = diskIo ? `磁盘 IO ${diskIo.mbps} MB/s · ${diskIo.busy}%` : '';
  const stealText = diskIo && Number.isFinite(Number(diskIo.stealPercent)) ? `宿主抢占 ${diskIo.stealPercent}%` : '';
  const statusWarn = data.statusTone === 'warn';
  const backgroundImage = wallpaper
    ? `url("${wallpaper}") center top / cover no-repeat fixed`
    : 'linear-gradient(#dce3e8, #dce3e8)';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    :root {
      --page-width: 900px;
      --ink: #171a20;
      --muted: #626b78;
      --line: rgba(35, 42, 53, 0.12);
      --panel: rgba(249, 250, 252, 0.9);
      --panel-strong: rgba(255, 255, 255, 0.94);
      --cyan: #249db2;
      --blue: #5279d8;
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
      letter-spacing: 0;
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
      overflow: hidden;
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
    .hero-head {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr) auto;
      gap: 18px;
      align-items: center;
    }
    .avatar {
      position: relative;
      width: 92px;
      height: 92px;
      display: grid;
      place-items: center;
      border: 2px solid rgba(255, 255, 255, 0.72);
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.12);
      color: #f08caf;
      font-size: 42px;
      font-weight: 900;
      box-shadow: inset 0 0 0 7px rgba(255, 255, 255, 0.06);
      overflow: hidden;
    }
    .avatar-fallback { position: relative; z-index: 1; }
    .avatar-image {
      position: absolute;
      inset: 0;
      z-index: 2;
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: inherit;
      opacity: 0;
    }
    .avatar-image.is-loaded { opacity: 1; }
    .avatar::after {
      content: "";
      position: absolute;
      right: 2px;
      bottom: 7px;
      width: 15px;
      height: 15px;
      border: 3px solid #171a20;
      border-radius: 50%;
      background: var(--green);
    }
    .identity { min-width: 0; }
    .identity-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    h1 {
      margin: 0;
      font-size: 39px;
      line-height: 1.08;
      font-weight: 900;
      overflow-wrap: anywhere;
    }
    .edition {
      padding: 4px 8px;
      border: 1px solid rgba(255, 255, 255, 0.26);
      border-radius: 5px;
      color: #d8dde6;
      font-size: 13px;
      font-weight: 800;
    }
    .version { margin-top: 8px; color: #aeb7c5; font-size: 14px; font-weight: 700; }
    .identity-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      margin-top: 12px;
      color: #d7dce5;
      font-size: 14px;
      font-weight: 700;
    }
    .identity-meta span { overflow-wrap: anywhere; }
    .status-block { min-width: 126px; text-align: right; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 11px;
      border-radius: 6px;
      background: ${statusWarn ? 'rgba(211,151,46,0.18)' : 'rgba(37,169,121,0.18)'};
      color: ${statusWarn ? '#ffd890' : '#8ce0bd'};
      font-size: 15px;
      font-weight: 900;
    }
    .status-badge i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .generated { margin-top: 8px; color: #8f99a8; font-size: 12px; line-height: 1.4; }
    .hero-stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
    }
    .hero-stat { min-width: 0; padding: 0 15px; border-left: 1px solid rgba(255,255,255,0.1); }
    .hero-stat:first-child { padding-left: 0; border-left: 0; }
    .hero-stat:last-child { padding-right: 0; }
    .hero-stat span { display: block; color: #8f99a8; font-size: 12px; font-weight: 700; }
    .hero-stat strong {
      display: block;
      margin-top: 5px;
      color: #f4f6f9;
      font-size: 18px;
      line-height: 1.22;
      font-weight: 900;
      overflow-wrap: anywhere;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 15px;
      padding-bottom: 11px;
      border-bottom: 1px solid var(--line);
    }
    .panel-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .panel-title i { width: 4px; height: 19px; border-radius: 2px; background: var(--cyan); }
    .panel-title h2 { margin: 0; font-size: 19px; line-height: 1.2; font-weight: 900; }
    .panel-meta { color: var(--muted); font-size: 12px; font-weight: 700; text-align: right; }
    .resource-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .resource-item {
      min-width: 0;
      display: grid;
      justify-items: center;
      gap: 10px;
      padding: 14px 8px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.56);
      --ring-color: var(--cyan);
    }
    .resource-item.tone-blue { --ring-color: var(--blue); }
    .resource-item.tone-violet { --ring-color: var(--violet); }
    .resource-item.tone-green { --ring-color: var(--green); }
    .resource-item.tone-amber { --ring-color: var(--amber); }
    .resource-ring {
      position: relative;
      width: 94px;
      height: 94px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: conic-gradient(var(--ring-color) calc(var(--value) * 1%), #dce2e9 0);
    }
    .resource-ring::before { content: ""; position: absolute; inset: 9px; border-radius: 50%; background: #f9fafc; }
    .resource-ring-center { position: relative; display: flex; align-items: baseline; gap: 2px; }
    .resource-ring-center strong { font-size: 28px; line-height: 1; font-weight: 900; }
    .resource-ring-center span { color: var(--muted); font-size: 12px; font-weight: 800; }
    .resource-copy { min-width: 0; text-align: center; }
    .resource-copy > span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; }
    .resource-copy > strong { display: block; margin-top: 4px; font-size: 15px; line-height: 1.25; font-weight: 900; overflow-wrap: anywhere; }
    .resource-copy > small { display: block; margin-top: 4px; min-height: 16px; color: #7a8492; font-size: 11px; line-height: 1.35; font-weight: 700; overflow-wrap: anywhere; }
    .disk-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 10px; }
    .disk-item { min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: rgba(255, 255, 255, 0.58); }
    .disk-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 800; }
    .disk-head span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .disk-bar { height: 8px; margin-top: 7px; border-radius: 999px; background: rgba(35, 42, 53, 0.1); overflow: hidden; }
    .disk-bar i { display: block; height: 100%; border-radius: 999px; }
    .disk-copy { margin-top: 6px; color: var(--muted); font-size: 10px; font-weight: 700; overflow-wrap: anywhere; }
    .system-foot {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .system-foot span { padding: 8px 10px; border-left: 2px solid #c8d0da; overflow-wrap: anywhere; }
    .usage-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 0; }
    .usage-column { min-width: 0; padding-right: 17px; }
    .usage-column + .usage-column { padding: 0 0 0 17px; border-left: 1px solid var(--line); }
    .column-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .column-head strong { font-size: 16px; font-weight: 900; }
    .column-head span { color: var(--muted); font-size: 12px; font-weight: 800; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .usage-column + .usage-column .metric-grid { grid-template-columns: repeat(2, 1fr); }
    .metric {
      min-width: 0;
      min-height: 88px;
      padding: 11px;
      border-top: 3px solid var(--cyan);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.62);
    }
    .metric.tone-blue { border-color: var(--blue); }
    .metric.tone-green { border-color: var(--green); }
    .metric.tone-pink { border-color: var(--pink); }
    .metric.tone-red { border-color: var(--red); }
    .metric.tone-amber { border-color: var(--amber); }
    .metric > span { display: block; color: var(--muted); font-size: 11px; font-weight: 800; }
    .metric > strong { display: block; margin-top: 6px; font-size: 24px; line-height: 1; font-weight: 900; overflow-wrap: anywhere; }
    .metric.is-compact > strong { font-size: 18px; line-height: 1.12; }
    .metric > small { display: block; margin-top: 7px; color: #7a8492; font-size: 10px; line-height: 1.3; font-weight: 700; overflow-wrap: anywhere; }
    .details { margin-top: 12px; border-top: 1px solid var(--line); }
    .detail-row {
      display: grid;
      grid-template-columns: 82px minmax(0, 1fr);
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px dashed rgba(35,42,53,0.12);
      font-size: 12px;
      line-height: 1.4;
    }
    .detail-row:last-child { border-bottom: 0; }
    .detail-row span { color: var(--muted); font-weight: 800; }
    .detail-row strong { min-width: 0; text-align: right; font-weight: 800; overflow-wrap: anywhere; }
    .health-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
    .health-item {
      position: relative;
      min-width: 0;
      min-height: 88px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.58);
    }
    .health-state { position: absolute; right: 10px; top: 10px; display: flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 900; }
    .health-state i { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
    .health-item.is-ready .health-state { color: #177554; }
    .health-item.is-warning .health-state { color: #9a6915; }
    .health-item.is-warning .health-state i { background: var(--amber); }
    .health-item > strong { display: block; padding-right: 52px; font-size: 14px; font-weight: 900; }
    .health-item p { margin: 9px 0 0; color: var(--muted); font-size: 11px; line-height: 1.4; font-weight: 700; overflow-wrap: anywhere; }
    .lower-grid { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.45fr); gap: 14px; }
    .lower-grid .panel { height: 100%; }
    .alert-list { display: grid; gap: 8px; }
    .alert-item { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 9px; align-items: center; padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.6); }
    .alert-item span { padding: 4px 5px; border-radius: 4px; text-align: center; background: rgba(37,169,121,0.13); color: #177554; font-size: 10px; font-weight: 900; }
    .alert-item.is-warning span { background: rgba(211,151,46,0.16); color: #8d6118; }
    .alert-item strong { min-width: 0; font-size: 12px; line-height: 1.4; font-weight: 800; overflow-wrap: anywhere; }
    .feature-list { display: flex; flex-wrap: wrap; gap: 7px; }
    .feature-pill { display: inline-flex; align-items: center; gap: 5px; min-height: 29px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: rgba(255,255,255,0.58); font-size: 11px; font-style: normal; }
    .feature-pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
    .feature-pill b { font-weight: 800; }
    .feature-pill em { color: #177554; font-size: 10px; font-style: normal; font-weight: 900; }
    .feature-pill.is-off { color: #78818d; }
    .feature-pill.is-off i { background: #aab1bb; }
    .feature-pill.is-off em { color: #8b939e; }
    .runtime-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; }
    .runtime-item { min-width: 0; padding: 9px 14px; border-left: 1px solid var(--line); }
    .runtime-item:nth-child(3n + 1) { padding-left: 0; border-left: 0; }
    .runtime-item:nth-child(n + 4) { border-top: 1px solid var(--line); }
    .runtime-item span { display: block; color: var(--muted); font-size: 10px; font-weight: 800; }
    .runtime-item strong { display: block; margin-top: 4px; font-size: 12px; line-height: 1.35; font-weight: 900; overflow-wrap: anywhere; }
    .footer { padding: 1px 4px 0; display: flex; justify-content: space-between; gap: 12px; color: rgba(255,255,255,0.88); font-size: 11px; font-weight: 700; text-shadow: 0 2px 6px rgba(0,0,0,0.65); }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="panel hero">
      <div class="hero-head">
        <div class="avatar">
          <span class="avatar-fallback">${escapeHtml(avatarText)}</span>
          ${avatarUrl ? `<img class="avatar-image" src="${escapeHtml(avatarUrl)}" alt="" onload="this.classList.add('is-loaded')" onerror="this.remove()">` : ''}
        </div>
        <div class="identity">
          <div class="identity-top"><h1>${escapeHtml(botName)}</h1><span class="edition">状态 PRO</span></div>
          <div class="version">${escapeHtml(pluginVersion)}</div>
          <div class="identity-meta">
            <span>${escapeHtml(adapter)}</span>
            <span>Bot ${escapeHtml(botId)}</span>
            <span>控制台 ${escapeHtml(consoleState)}</span>
          </div>
        </div>
        <div class="status-block">
          <div class="status-badge"><i></i>${escapeHtml(data.statusText || '运行正常')}</div>
          <div class="generated">${escapeHtml(generatedAt)}<br>状态快照</div>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><span>运行时长</span><strong>${escapeHtml(uptime)}</strong></div>
        <div class="hero-stat"><span>今日 AI</span><strong>${escapeHtml(aiUsage.requestCountText || '0')} 次</strong></div>
        <div class="hero-stat"><span>今日生图</span><strong>${escapeHtml(imageUsage.requestCountText || '0')} 次</strong></div>
        <div class="hero-stat"><span>群管理</span><strong>${getFeatureEnabled(features, '群管理') ? '已开启' : '已关闭'}</strong></div>
      </div>
    </header>

    <section class="panel">
      <div class="panel-head">
        <div class="panel-title"><i></i><h2>系统资源</h2></div>
        <div class="panel-meta">进程与主机实时快照</div>
      </div>
      <div class="resource-grid">
        ${renderRing(cpuPercent, 'CPU', cpuModel || `${Math.round(cpuPercent)}%`, cpuModel ? `进程估算占用 ${Math.round(cpuPercent)}%` : '进程估算占用', 'cyan')}
        ${renderRing(memoryPercent, '物理内存', `${memoryUsedGb} / ${memoryTotalGb}`, `${memoryType ? `${memoryType} · ` : ''}RSS ${rssMb}`, 'blue')}
        ${renderRing(heapPercent, 'Node Heap', `${heapUsedMb} / ${heapTotalMb}`, 'JavaScript 堆内存', 'violet')}
        ${renderRing(healthPercent, '接口健康', `${healthOkCount} / ${health.length || 0}`, '已就绪接口', healthPercent >= 100 ? 'green' : 'amber')}
      </div>
      ${diskBlock}
      <div class="system-foot">
        <span>系统负载 ${escapeHtml(loadAvg)}</span>
        ${swapText ? `<span>${escapeHtml(swapText)}</span>` : ''}
        ${networkText ? `<span>${escapeHtml(networkText)}</span>` : ''}
        ${diskIoText ? `<span>${escapeHtml(diskIoText)}</span>` : ''}
        ${stealText ? `<span>${escapeHtml(stealText)}</span>` : ''}
        <span>${escapeHtml(nodeVersion)}</span>
        <span>${escapeHtml(platform)}</span>
        <span>${escapeHtml(processText)}</span>
        <span>开机 ${escapeHtml(getRowValue(rows, '系统运行时长', '-'))}</span>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div class="panel-title"><i></i><h2>今日 AI 使用</h2></div>
        <div class="panel-meta">文本与图像调用统计</div>
      </div>
      <div class="usage-grid">
        <div class="usage-column">
          <div class="column-head"><strong>对话与工具</strong><span>成功率 ${escapeHtml(aiSuccessRate)}</span></div>
          <div class="metric-grid">
            ${renderMetric('请求', aiUsage.requestCountText || '0', '今日累计', 'blue')}
            ${renderMetric('成功', aiUsage.successCountText || '0', `成功率 ${aiSuccessRate}`, 'green')}
            ${renderMetric('失败', aiUsage.errorCountText || '0', '接口错误', aiErrors > 0 ? 'red' : 'cyan')}
            ${renderMetric('Tokens', aiUsage.totalTokensText || '0', aiUsage.costText || '未估算', 'cyan')}
          </div>
          <div class="details">
            ${renderDetail('输入 / 输出', `${aiUsage.promptTokensText || '0'} / ${aiUsage.completionTokensText || '0'} Tokens`)}
            ${renderDetail('主要场景', topScene.label ? `${topScene.label} · ${topScene.requestsText || '0'} 次` : '暂无记录')}
            ${renderDetail('主要模型', topModel.label ? `${topModel.label} · ${topModel.tokensText || '0'} Tokens` : '暂无记录')}
            ${renderDetail('最近调用', latestAi.detail || '今日暂无调用记录')}
          </div>
        </div>
        <div class="usage-column">
          <div class="column-head"><strong>图片生成</strong><span>成功率 ${escapeHtml(imageSuccessRate)}</span></div>
          <div class="metric-grid">
            ${renderMetric('请求', imageUsage.requestCountText || '0', '今日累计', 'pink')}
            ${renderMetric('平均耗时', imageUsage.averageElapsedText || '0ms', '生成速度', 'green')}
            ${renderMetric('成功', imageUsage.successCountText || '0', `成功率 ${imageSuccessRate}`, 'green')}
            ${renderMetric('失败', imageUsage.errorCountText || '0', '生成错误', imageErrors > 0 ? 'red' : 'cyan')}
          </div>
          <div class="details">
            ${renderDetail('最近状态', imageLatest.statusText || '暂无记录')}
            ${renderDetail('最近生图', imageLatest.detail || '今日暂无图片生成请求')}
            ${renderDetail('成本估算', aiUsage.costSubText || '按当前价格配置估算')}
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div class="panel-title"><i></i><h2>接口健康</h2></div>
        <div class="panel-meta">${healthOkCount} / ${health.length || 0} 项就绪</div>
      </div>
      <div class="health-grid">${renderHealthItems(health)}</div>
    </section>

    <div class="lower-grid">
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title"><i></i><h2>运行告警</h2></div>
        </div>
        <div class="alert-list">${renderAlertRows(alerts)}</div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title"><i></i><h2>功能状态</h2></div>
          <div class="panel-meta">开启 ${features.filter(item => item?.[1]).length} / ${features.length}</div>
        </div>
        <div class="feature-list">${renderFeaturePills(features)}</div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head">
        <div class="panel-title"><i></i><h2>运行信息</h2></div>
        <div class="panel-meta">只读运行环境</div>
      </div>
      <div class="runtime-grid">
        ${renderRuntimeItem('Bot', botId)}
        ${renderRuntimeItem('适配器', adapter)}
        ${renderRuntimeItem('控制台', consoleState)}
        ${renderRuntimeItem('Node', nodeVersion)}
        ${renderRuntimeItem('平台', platform)}
        ${renderRuntimeItem('进程', processText)}
      </div>
    </section>

    <footer class="footer"><span>Created by 魔丸插件</span><span>${escapeHtml(generatedAt)}</span></footer>
  </main>
</body>
</html>`;
}

export async function renderStatusImage(data = {}) {
  const outputDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `status_${Date.now()}.png`);
  return renderHtmlToImage({
    html: buildStatusImageHtml(data),
    outputPath,
    viewport: { width: 900, height: 1500, deviceScaleFactor: 2 },
    minHeight: 900,
    maxHeight: 2800,
    afterContent: async page => {
      await page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll('img.avatar-image'));
        await Promise.all(images.map(image => {
          if (image.complete) return Promise.resolve();
          return new Promise(resolve => {
            const timer = setTimeout(resolve, 5000);
            image.addEventListener('load', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
            image.addEventListener('error', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          });
        }));
      });
    },
  });
}
