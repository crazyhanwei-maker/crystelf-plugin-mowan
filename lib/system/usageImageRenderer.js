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
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('zh-CN');
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
      const ext = '.webp';
      const typeMap = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
      const contentType = String(meta?.contentType || '').trim() || typeMap[ext] || 'image/webp';
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

function renderRing(percent = 0, label = '', value = '', detail = '', tone = 'cyan') {
  const safe = clampPercent(percent);
  return `
    <div class="quota-item tone-${escapeHtml(tone)}">
      <div class="quota-ring" style="--value:${safe}">
        <div class="quota-ring-center"><strong>${Math.round(safe)}</strong><span>%</span></div>
      </div>
      <div class="quota-copy">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(detail)}</small>
      </div>
    </div>
  `;
}

function renderMetric(label = '', value = '', detail = '', tone = 'cyan') {
  return `
    <div class="metric tone-${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function renderSceneBar(label = '', value = 0, max = 0, tone = 'cyan') {
  const percent = max > 0 ? clampPercent((value / max) * 100) : 0;
  return `
    <div class="scene-row">
      <span class="scene-label">${escapeHtml(label)}</span>
      <div class="scene-track"><i class="tone-${escapeHtml(tone)}" style="width:${percent}%"></i></div>
      <span class="scene-value">${escapeHtml(value)}</span>
    </div>
  `;
}

const SCENE_LABELS = {
  chat: '群聊对话',
  private_chat: '私聊对话',
  poke_image_summary: '戳一戳图片摘要',
  image_monitor_review: '图片监控审核',
  group_summary: '群总结',
  user_profile: '用户画像',
  affinity: '好感度',
  meme: '表情包',
  voice: '语音',
};

function getSceneLabel(scene = '') {
  return SCENE_LABELS[String(scene || '').trim()] || String(scene || '其他').trim() || '其他';
}

function buildFreeChatSection(freeChat = {}) {
  const tokens = freeChat.tokens || {};
  const requests = freeChat.requests || {};
  const period = freeChat.period || {};

  const tokenRing = renderRing(
    tokens.limitEnabled ? tokens.percent : 0,
    '今日 Tokens',
    formatNumber(tokens.used),
    tokens.limitEnabled ? `上限 ${formatNumber(tokens.limit)}` : '未启用限额',
    'cyan',
  );
  const requestRing = renderRing(
    requests.limitEnabled ? requests.percent : 0,
    '今日请求',
    formatNumber(requests.used),
    requests.limitEnabled ? `上限 ${formatNumber(requests.limit)}` : '未启用限额',
    'green',
  );

  const periodText = [
    period.date ? `统计日期：${period.date}` : '',
    period.resetAt ? `重置时间：${period.resetAt}` : '',
    freeChat.timezone ? `时区：${freeChat.timezone}` : '',
  ].filter(Boolean).join('<br>');

  return `
    <section class="panel">
      <h2>FREE CHAT 接口用量</h2>
      <div class="quota-grid">
        ${tokenRing}
        ${requestRing}
      </div>
      <div class="quota-details">
        ${renderMetric('请求成功', formatNumber(requests.success), `失败 ${formatNumber(requests.failed)}`, 'green')}
        ${renderMetric('剩余 Tokens', formatNumber(tokens.remaining), tokens.limitEnabled ? `已用 ${tokens.percent}%` : '不限量', 'cyan')}
        ${renderMetric('剩余请求', formatNumber(requests.remaining), requests.limitEnabled ? `已用 ${requests.percent}%` : '不限量', 'blue')}
      </div>
      ${periodText ? `<p class="period-note">${periodText}</p>` : ''}
    </section>
  `;
}

function buildOwnApiSection(usage = {}, pricing = {}) {
  const requestCount = Number(usage.requestCount || 0);
  const topScene = Array.isArray(usage.topScenes) ? usage.topScenes.slice(0, 6) : [];
  const maxSceneValue = topScene.reduce((max, item) => Math.max(max, Number(item.value || 0)), 0);
  const currency = pricing.currencySymbol || '$';
  const costEnabled = pricing.enabled !== false;

  const toneList = ['cyan', 'green', 'blue', 'violet', 'amber', 'pink'];
  const toneFor = index => toneList[index % toneList.length];

  return `
    <section class="panel">
      <h2>今日 AI 用量统计</h2>
      <div class="metric-grid">
        ${renderMetric('请求总数', formatNumber(requestCount), `成功 ${formatNumber(usage.successCount)} / 失败 ${formatNumber(usage.errorCount)}`, requestCount > 0 ? 'blue' : 'cyan')}
        ${renderMetric('Tokens 总量', formatNumber(usage.totalTokens), `输入 ${formatNumber(usage.promptTokens)} / 输出 ${formatNumber(usage.completionTokens)}`, 'violet')}
        ${costEnabled ? renderMetric('预估成本', `${currency}${formatNumber(usage.totalCost)}`, `模型均价 ${currency}${formatNumber(usage.averageCost)}`, 'amber') : ''}
        ${renderMetric('最常用场景', usage.topSceneLabel || '暂无', usage.topSceneValue > 0 ? `${formatNumber(usage.topSceneValue)} 次` : '', 'green')}
      </div>
      ${topScene.length > 0 ? `
      <div class="scene-block">
        <h3>场景分布</h3>
        ${topScene.map((item, index) => renderSceneBar(item.label, formatNumber(item.value), maxSceneValue, toneFor(index))).join('')}
      </div>
      ` : ''}
      ${topModelHtml(usage)}
    </section>
  `;
}

function topModelHtml(usage = {}) {
  const topModels = Array.isArray(usage.topModels) ? usage.topModels.slice(0, 3) : [];
  if (!topModels.length) return '';
  return `
    <div class="scene-block">
      <h3>模型分布 Top 3</h3>
      ${topModels.map(item => renderSceneBar(item.label, formatNumber(item.value), topModels[0].value, 'violet')).join('')}
    </div>
  `;
}

function buildUsageImageHtml(data = {}) {
  const wallpaper = resolveWallpaperDataUrl();
  const backgroundImage = wallpaper
    ? `url("${wallpaper}") center top / cover no-repeat fixed`
    : 'linear-gradient(#dce3e8, #dce3e8)';
  const isFreeChat = data.mode === 'free-chat';
  const title = isFreeChat ? 'FREE CHAT 接口用量' : '今日 AI 用量统计';
  const modeBadge = isFreeChat ? '内置 FREE CHAT' : '自配 API';
  const body = isFreeChat ? buildFreeChatSection(data.freeChat) : buildOwnApiSection(data.usage, data.pricing || {});

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
    h2 { margin: 0 0 14px; font-size: 17px; font-weight: 900; color: var(--ink); }
    h3 { margin: 0 0 10px; font-size: 14px; font-weight: 800; color: var(--muted); }
    .quota-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .quota-item { display: flex; align-items: center; gap: 14px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255, 255, 255, 0.62); }
    .quota-ring {
      --value: 0;
      flex: 0 0 auto;
      width: 74px;
      height: 74px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background:
        radial-gradient(closest-side, #ffffff 78%, transparent 79% 100%),
        conic-gradient(var(--tone) calc(var(--value) * 1%), rgba(35, 42, 53, 0.1) 0);
    }
    .quota-item.tone-cyan .quota-ring { --tone: var(--cyan); }
    .quota-item.tone-green .quota-ring { --tone: var(--green); }
    .quota-item.tone-blue .quota-ring { --tone: var(--blue); }
    .quota-ring-center { display: flex; align-items: baseline; gap: 2px; }
    .quota-ring-center strong { font-size: 20px; font-weight: 900; color: var(--ink); }
    .quota-ring-center span { font-size: 11px; color: var(--muted); }
    .quota-copy { min-width: 0; display: grid; gap: 3px; }
    .quota-copy span { font-size: 12px; font-weight: 800; color: var(--muted); }
    .quota-copy strong { font-size: 21px; font-weight: 900; overflow-wrap: anywhere; }
    .quota-copy small { font-size: 12px; color: var(--muted); }
    .quota-details { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
    .metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .metric {
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.62);
      display: grid;
      gap: 3px;
    }
    .metric span { font-size: 12px; font-weight: 800; color: var(--muted); }
    .metric strong { font-size: 23px; font-weight: 900; overflow-wrap: anywhere; }
    .metric small { font-size: 12px; color: var(--muted); }
    .metric.tone-cyan strong { color: var(--cyan); }
    .metric.tone-green strong { color: var(--green); }
    .metric.tone-blue strong { color: var(--blue); }
    .metric.tone-violet strong { color: var(--violet); }
    .metric.tone-amber strong { color: var(--amber); }
    .metric.tone-pink strong { color: var(--pink); }
    .scene-block { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--line); }
    .scene-row { display: grid; grid-template-columns: 110px minmax(0, 1fr) 70px; align-items: center; gap: 10px; margin-bottom: 8px; }
    .scene-label { font-size: 12.5px; font-weight: 700; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .scene-track { height: 10px; border-radius: 999px; background: rgba(35, 42, 53, 0.08); overflow: hidden; }
    .scene-track i { display: block; height: 100%; border-radius: inherit; }
    .scene-track i.tone-cyan { background: var(--cyan); }
    .scene-track i.tone-green { background: var(--green); }
    .scene-track i.tone-blue { background: var(--blue); }
    .scene-track i.tone-violet { background: var(--violet); }
    .scene-track i.tone-amber { background: var(--amber); }
    .scene-track i.tone-pink { background: var(--pink); }
    .scene-value { font-size: 13px; font-weight: 800; text-align: right; }
    .period-note { margin: 12px 0 0; font-size: 12.5px; line-height: 1.7; color: var(--muted); }
    .error-note {
      margin: 0;
      padding: 12px 14px;
      border: 1px solid rgba(211, 93, 98, 0.3);
      border-radius: 8px;
      background: rgba(211, 93, 98, 0.08);
      color: #a14448;
      font-size: 13px;
      line-height: 1.7;
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
        <h1>${escapeHtml(title)}</h1>
        <span class="mode-badge">${escapeHtml(modeBadge)}</span>
      </div>
      <div class="hero-meta">
        <span>插件：${escapeHtml(data.pluginName || '')} v${escapeHtml(data.pluginVersion || '')}</span>
        <span>Bot：${escapeHtml(data.botId || '未知')}</span>
        <span>生成时间：${escapeHtml(data.generatedAt || '')}</span>
      </div>
    </header>
    ${data.errorMessage ? `<section class="panel"><p class="error-note">${escapeHtml(data.errorMessage)}</p></section>` : body}
    <footer class="footer"><span>Created by 魔丸插件</span><span>#今日AI用量</span></footer>
  </main>
</body>
</html>`;
}

export async function renderUsageImage(data = {}) {
  const outputDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `ai_usage_${Date.now()}.png`);
  return renderHtmlToImage({
    html: buildUsageImageHtml(data),
    outputPath,
    viewport: { width: 860, height: 1200, deviceScaleFactor: 2 },
    minHeight: 700,
    maxHeight: 2600,
  });
}
