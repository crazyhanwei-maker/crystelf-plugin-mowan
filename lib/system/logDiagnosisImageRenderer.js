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

function formatFiles(files = []) {
  if (!Array.isArray(files) || files.length <= 0) {
    return '<div class="empty">没有选中可分析的日志文件。</div>';
  }
  return files.slice(0, 8).map(file => `
    <div class="file-row">
      <strong>${escapeHtml(file.displayPath || '-')}</strong>
      <span>命中 ${escapeHtml(file.hitCount || 0)} · ${escapeHtml(formatTime(file.mtime))}</span>
    </div>
  `).join('');
}

function normalizeAnalysisBlocks(text = '') {
  const content = String(text || '').trim() || 'AI 未返回排查结论。';
  return content
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function buildLogDiagnosisImageHtml(data = {}) {
  const wallpaper = resolveWallpaperDataUrl();
  const analysisBlocks = normalizeAnalysisBlocks(data.analysis);
  const generatedAt = formatTime(data.diagnosedAt || Date.now());
  return `<!DOCTYPE html>
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
    color: #1f2a44;
    background:
      linear-gradient(135deg, rgba(248,250,252,.90), rgba(229,238,255,.82)),
      ${wallpaper ? `url("${wallpaper}") center/cover fixed` : '#eef4ff'};
  }
  .page { padding: 42px; }
  .shell {
    border: 1px solid rgba(148, 163, 184, .34);
    border-radius: 34px;
    background: rgba(255,255,255,.82);
    box-shadow: 0 28px 90px rgba(31, 42, 68, .22);
    overflow: hidden;
    backdrop-filter: blur(14px);
  }
  .hero {
    padding: 34px 36px 28px;
    background: linear-gradient(135deg, rgba(59,130,246,.16), rgba(124,58,237,.12));
    border-bottom: 1px solid rgba(148, 163, 184, .25);
  }
  .badge {
    display: inline-flex;
    padding: 7px 12px;
    border-radius: 999px;
    background: rgba(37, 99, 235, .12);
    color: #2454c6;
    font-size: 22px;
    font-weight: 800;
  }
  h1 {
    margin: 18px 0 10px;
    font-size: 54px;
    line-height: 1.05;
    letter-spacing: 0;
  }
  .sub { font-size: 24px; color: #64748b; line-height: 1.5; }
  .metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding: 24px 30px 4px;
  }
  .metric {
    padding: 18px;
    border: 1px solid rgba(148,163,184,.26);
    border-radius: 22px;
    background: rgba(255,255,255,.72);
  }
  .metric span { display: block; color: #64748b; font-size: 18px; }
  .metric strong { display: block; margin-top: 8px; font-size: 30px; color: #172554; }
  .section { padding: 22px 30px; }
  .section h2 {
    margin: 0 0 14px;
    font-size: 26px;
    color: #172554;
  }
  .analysis {
    display: grid;
    gap: 12px;
  }
  .analysis p {
    margin: 0;
    padding: 15px 17px;
    border-left: 5px solid rgba(37,99,235,.55);
    border-radius: 16px;
    background: rgba(248,250,252,.84);
    color: #334155;
    font-size: 21px;
    line-height: 1.62;
    white-space: pre-wrap;
  }
  .file-list {
    display: grid;
    gap: 10px;
  }
  .file-row {
    display: grid;
    gap: 5px;
    padding: 13px 15px;
    border-radius: 15px;
    background: rgba(241,245,249,.82);
    font-size: 18px;
  }
  .file-row strong { color: #1e293b; overflow-wrap: anywhere; }
  .file-row span, .empty { color: #64748b; }
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
        <div class="badge">魔丸日志诊断</div>
        <h1>AI 排查报告</h1>
        <div class="sub">基于最近 Bot 与插件日志生成，敏感信息已在送检前脱敏。</div>
      </header>
      <section class="metrics">
        <div class="metric"><span>疑似错误/告警</span><strong>${escapeHtml(data.hitCount || 0)}</strong></div>
        <div class="metric"><span>送检日志文件</span><strong>${escapeHtml(Array.isArray(data.selectedFiles) ? data.selectedFiles.length : 0)}</strong></div>
        <div class="metric"><span>日志来源</span><strong>${escapeHtml(data.source || 'auto')}</strong></div>
      </section>
      <section class="section">
        <h2>排查结论</h2>
        <div class="analysis">
          ${analysisBlocks.map(block => `<p>${escapeHtml(block)}</p>`).join('')}
        </div>
      </section>
      <section class="section">
        <h2>日志文件</h2>
        <div class="file-list">${formatFiles(data.selectedFiles)}</div>
      </section>
      <div class="footer">生成时间：${escapeHtml(generatedAt)}<br>Created by crystelf-plugin</div>
    </main>
  </div>
</body>
</html>`;
}

export async function renderLogDiagnosisImage(data = {}) {
  const outputDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `log_diagnosis_${Date.now()}.png`);
  return renderHtmlToImage({
    html: buildLogDiagnosisImageHtml(data),
    outputPath,
    viewport: { width: 900, height: 1600, deviceScaleFactor: 2 },
    minHeight: 1180,
    maxHeight: 5200,
  });
}
