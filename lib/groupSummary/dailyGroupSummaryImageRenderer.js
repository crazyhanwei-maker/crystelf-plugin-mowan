import fs from 'fs';
import path from 'path';
import { renderHtmlToImage } from '../system/puppeteerRenderer.js';
import { resolveBotIdentity } from '../system/botIdentity.js';
import {
  buildBrandHero,
  buildImageThemeCss,
  resolveImageWallpaperDataUrl,
  waitForThemeImages,
} from '../system/imageTheme.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const source = Array.isArray(summary) ? summary.join('\n') : String(summary || '');
  const normalized = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (normalized.length <= 1) {
    return source
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
      <span>${escapeHtml(item.userName || item.nickname || `QQ${item.userId || '未知'}`)}</span>
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
  const wallpaper = String(data.consoleWallpaper || '').trim() || resolveImageWallpaperDataUrl();
  const identity = {
    ...resolveBotIdentity({}, data.botName || '魔丸'),
    ...data,
  };
  const title = data.title || '今日群聊总结';
  const groupName = data.groupName || data.groupId || '未知群聊';
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const messageCount = Number(data.messageCount ?? messages.length ?? 0);
  const keywords = Array.isArray(data.keywords) && data.keywords.length
    ? data.keywords.slice(0, 12).map(item => String(item || '').trim()).filter(Boolean)
    : buildKeywordCloud(data.summary, messages);
  const generatedAt = formatTime(data.generatedAt || Date.now());
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
  ${buildImageThemeCss({ wallpaper, width: 900 })}
  .page { padding: 0; }
  .shell { display: grid; gap: 14px; border: 0; border-radius: 0; background: transparent; box-shadow: none; overflow: visible; backdrop-filter: none; }
  .metrics { padding: 18px; }
  .metric { min-height: 92px; padding: 14px; border: 1px solid var(--theme-line); border-radius: 7px; background: rgba(255,255,255,0.62); }
  .metric span { color: var(--theme-muted); font-size: 12px; font-weight: 800; }
  .metric strong { margin-top: 7px; color: var(--theme-ink); font-size: 22px; }
  .section { padding: 18px; }
  .section h2 { margin: 0 0 13px; color: var(--theme-ink); font-size: 19px; }
  .summary-list { gap: 9px; }
  .summary-item { grid-template-columns: 43px minmax(0,1fr); gap: 11px; padding: 12px 13px; border: 1px solid var(--theme-line); border-radius: 7px; background: rgba(255,255,255,0.62); }
  .summary-index { width: 34px; height: 34px; border-radius: 5px; color: #177554; background: rgba(37,169,121,0.13); font-size: 13px; }
  .summary-text { color: #343b46; font-size: 15px; line-height: 1.58; }
  .keywords { gap: 7px; }
  .keyword { padding: 6px 9px; border: 1px solid rgba(36,157,178,0.15); border-radius: 5px; background: rgba(36,157,178,0.09); color: #176c7a; font-size: 12px; }
  .message-list { gap: 7px; }
  .message-row { grid-template-columns: 130px minmax(0,1fr); gap: 10px; padding: 9px 11px; border: 1px solid var(--theme-line); border-radius: 6px; background: rgba(255,255,255,0.58); font-size: 12px; }
  .message-row span { color: var(--theme-muted); }
  .empty { padding: 13px; border-radius: 6px; background: rgba(255,255,255,0.58); color: var(--theme-muted); font-size: 13px; }
</style>
</head>
<body>
  <div class="page theme-sheet">
    <main class="shell">
      ${buildBrandHero({
        botName: identity.botName,
        avatarText: identity.avatarText,
        avatarUrl: identity.avatarUrl,
        badge: '群聊日报',
        title,
        subtitle: `${groupName} · ${formatDateLabel(data.dateKey || data.date)}`,
        sideTitle: `${messageCount} 条消息`,
        sideText: generatedAt,
      })}
      <section class="theme-panel metrics">
        <div class="metric"><span>纳入消息</span><strong>${escapeHtml(messageCount)} 条</strong></div>
        <div class="metric"><span>总结类型</span><strong>${escapeHtml(data.sourceLabel || '群聊总结')}</strong></div>
        <div class="metric"><span>生成时间</span><strong>${escapeHtml(formatShortTime(data.generatedAt || Date.now()))}</strong></div>
      </section>
      <section class="theme-panel section">
        <h2>今日要点</h2>
        <div class="summary-list">${renderSummaryItems(data.summary)}</div>
      </section>
      <section class="theme-panel section">
        <h2>关键词</h2>
        <div class="keywords">${
          keywords.length
            ? keywords.map(item => `<span class="keyword">${escapeHtml(item)}</span>`).join('')
            : '<span class="keyword">暂无关键词</span>'
        }</div>
      </section>
      <section class="theme-panel section">
        <h2>最近消息</h2>
        <div class="message-list">${renderRecentMessages(messages)}</div>
      </section>
      <footer class="theme-footer"><span>仅总结已记录的群聊内容，不包含 Bot 消息</span><span>Created by 魔丸插件</span></footer>
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
    viewport: { width: 900, height: 400, deviceScaleFactor: 2 },
    minHeight: 400,
    maxHeight: 5200,
    afterContent: page => waitForThemeImages(page),
  });
}
