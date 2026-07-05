import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';
import { renderHtmlToImage } from '../system/puppeteerRenderer.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readImageDataUrl(filePath = '', contentType = '') {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentTypeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return `data:${contentType || contentTypeMap[ext] || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
}

function resolveWallpaperDataUrl() {
  const cacheDir = path.join(Path.root, 'temp', 'web-console-background');
  const metaFile = path.join(cacheDir, 'current-image.json');
  const cacheFile = path.join(cacheDir, 'current-image.bin');
  const bundledFile = path.join(Path.root, 'lib', 'webConsole', 'public', 'assets', 'console-wallpaper-default.webp');

  try {
    if (fs.existsSync(metaFile) && fs.existsSync(cacheFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      return readImageDataUrl(cacheFile, String(meta?.contentType || 'image/webp'));
    }
  } catch {}

  return readImageDataUrl(bundledFile);
}

function formatTime(value = '') {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDateLabel(dateKey = '') {
  const text = String(dateKey || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text || new Date().toLocaleDateString('zh-CN');
  return `${match[1]}年${match[2]}月${match[3]}日`;
}

function formatShortTime(value = '') {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '--:--';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}`;
}

function splitSummaryBlocks(summary = '') {
  const normalized = String(summary || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (normalized.length <= 1) {
    return String(summary || '')
      .split(/(?<=。|！|？|；)\s*/)
      .map(line => line.trim())
      .filter(Boolean);
  }
  return normalized;
}

function renderSummaryItems(summary = '') {
  const blocks = splitSummaryBlocks(summary).slice(0, 12);
  if (!blocks.length) {
    return '<div class="empty">今天还没有生成可展示的总结内容。</div>';
  }
  return blocks.map((block, index) => {
    const text = block
      .replace(/^[-*]\s*/, '')
      .replace(/^\d+[.、)]\s*/, '')
      .trim();
    return `
      <article class="summary-item">
        <div class="summary-index">${String(index + 1).padStart(2, '0')}</div>
        <div class="summary-text">${escapeHtml(text || block)}</div>
      </article>
    `;
  }).join('');
}

function renderRecentMessages(messages = []) {
  const items = Array.isArray(messages) ? messages.slice(-6).reverse() : [];
  if (!items.length) {
    return '<div class="empty compact">暂无可展示的最近消息。</div>';
  }
  return items.map(item => `
    <div class="message-row">
      <span>${escapeHtml(item.userName || `QQ${item.userId || '未知'}`)}</span>
      <strong>${escapeHtml(item.text || '')}</strong>
    </div>
  `).join('');
}

function buildKeywordCloud(summary = '', messages = []) {
  const ignore = new Set(['今天', '群聊', '大家', '主要', '没有', '一个', '这个', '那个', '可以', '进行', '比较', '相关', '总结']);
  const words = [];
  const source = [
    summary,
    ...(Array.isArray(messages) ? messages.map(item => item.text || '') : []),
  ].join('\n');
  for (const match of source.matchAll(/[\u4e00-\u9fa5]{2,6}|[A-Za-z0-9_+-]{3,24}/g)) {
    const word = match[0];
    if (!ignore.has(word)) words.push(word);
  }
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

export function buildDailyGroupSummaryImageHtml(data = {}) {
  const wallpaper = resolveWallpaperDataUrl();
  const title = data.title || '今日群聊总结';
  const groupName = data.groupName || data.groupId || '未知群聊';
  const messageCount = Number(data.messageCount || 0);
  const keywords = buildKeywordCloud(data.summary, data.messages);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: 900px;
    min-height: 1180px;
    font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
    color: #172033;
    background:
      linear-gradient(135deg, rgba(247,250,255,.90), rgba(230,240,255,.78)),
      ${wallpaper ? `url("${wallpaper}") center/cover fixed` : '#eef5ff'};
  }
  .page { padding: 42px; }
  .shell {
    overflow: hidden;
    border: 1px solid rgba(130, 154, 190, .34);
    border-radius: 34px;
    background: rgba(255,255,255,.84);
    box-shadow: 0 28px 90px rgba(26, 45, 82, .24);
    backdrop-filter: blur(14px);
  }
  .hero {
    position: relative;
    padding: 34px 36px 30px;
    color: #f8fbff;
    background:
      linear-gradient(135deg, rgba(20, 61, 136, .92), rgba(27, 122, 156, .84)),
      radial-gradient(circle at 88% 10%, rgba(251, 191, 36, .36), transparent 34%);
  }
  .hero:after {
    content: "";
    position: absolute;
    inset: auto 28px 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.62), transparent);
  }
  .badge {
    display: inline-flex;
    padding: 7px 13px;
    border-radius: 999px;
    background: rgba(255,255,255,.16);
    border: 1px solid rgba(255,255,255,.22);
    font-size: 21px;
    font-weight: 800;
  }
  h1 {
    margin: 18px 0 10px;
    font-size: 56px;
    line-height: 1.04;
    letter-spacing: 0;
  }
  .sub {
    max-width: 760px;
    font-size: 23px;
    line-height: 1.48;
    color: rgba(248,251,255,.86);
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding: 24px 30px 8px;
  }
  .metric {
    min-height: 112px;
    padding: 18px;
    border: 1px solid rgba(140,158,185,.26);
    border-radius: 22px;
    background: rgba(255,255,255,.74);
  }
  .metric span {
    display: block;
    color: #64748b;
    font-size: 18px;
  }
  .metric strong {
    display: block;
    margin-top: 9px;
    color: #12315f;
    font-size: 29px;
    line-height: 1.18;
    overflow-wrap: anywhere;
  }
  .section { padding: 22px 30px; }
  .section h2 {
    margin: 0 0 15px;
    color: #0f2d59;
    font-size: 27px;
  }
  .summary-list {
    display: grid;
    gap: 13px;
  }
  .summary-item {
    display: grid;
    grid-template-columns: 58px 1fr;
    gap: 14px;
    align-items: start;
    padding: 16px 18px;
    border: 1px solid rgba(148,163,184,.24);
    border-radius: 20px;
    background: rgba(248,250,252,.86);
  }
  .summary-index {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: 16px;
    color: #0f766e;
    background: rgba(20,184,166,.15);
    font-weight: 900;
    font-size: 20px;
  }
  .summary-text {
    color: #24324a;
    font-size: 22px;
    line-height: 1.62;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .keywords {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .keyword {
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(14, 116, 144, .11);
    color: #155e75;
    font-size: 18px;
    font-weight: 700;
  }
  .message-list {
    display: grid;
    gap: 10px;
  }
  .message-row {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 15px;
    background: rgba(241,245,249,.78);
    font-size: 18px;
  }
  .message-row span {
    color: #64748b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message-row strong {
    color: #334155;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .empty {
    padding: 18px;
    border-radius: 18px;
    background: rgba(241,245,249,.78);
    color: #64748b;
    font-size: 20px;
  }
  .compact { font-size: 18px; }
  .footer {
    padding: 20px 30px 30px;
    color: #64748b;
    font-size: 18px;
    line-height: 1.6;
  }
</style>
</head>
<body>
  <div class="page">
    <main class="shell">
      <header class="hero">
        <div class="badge">魔丸群聊日报</div>
        <h1>${escapeHtml(title)}</h1>
        <div class="sub">${escapeHtml(groupName)} · ${escapeHtml(formatDateLabel(data.dateKey))}</div>
      </header>
      <section class="metrics">
        <div class="metric"><span>纳入消息</span><strong>${escapeHtml(messageCount)} 条</strong></div>
        <div class="metric"><span>总结类型</span><strong>${escapeHtml(data.sourceLabel || '群聊总结')}</strong></div>
        <div class="metric"><span>生成时间</span><strong>${escapeHtml(formatShortTime(data.generatedAt || Date.now()))}</strong></div>
      </section>
      <section class="section">
        <h2>今日要点</h2>
        <div class="summary-list">${renderSummaryItems(data.summary)}</div>
      </section>
      <section class="section">
        <h2>关键词</h2>
        <div class="keywords">${
          keywords.length
            ? keywords.map(item => `<span class="keyword">${escapeHtml(item)}</span>`).join('')
            : '<span class="keyword">暂无关键词</span>'
        }</div>
      </section>
      <section class="section">
        <h2>最近消息</h2>
        <div class="message-list">${renderRecentMessages(data.messages)}</div>
      </section>
      <div class="footer">只总结已记录的群聊内容，不包含 Bot 自己发送的消息。由魔丸插件生成。</div>
    </main>
  </div>
</body>
</html>`;
}

export async function renderDailyGroupSummaryImage(data = {}) {
  const outputDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `daily_group_summary_${Date.now()}.png`);
  return renderHtmlToImage({
    html: buildDailyGroupSummaryImageHtml(data),
    outputPath,
    viewport: { width: 900, height: 1600, deviceScaleFactor: 2 },
    minHeight: 1180,
    maxHeight: 5200,
  });
}
