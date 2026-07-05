import fs from 'fs/promises';
import path from 'path';
import screenshot from '../lib/rss/screenshot.js';
import MusicRenderer from '../lib/music/musicRenderer.js';
import aiRenderer from '../lib/ai/renderer.js';
import { renderStatusImage } from '../lib/system/statusImageRenderer.js';
import { renderCommandListImage } from '../lib/system/commandListImageRenderer.js';
import { renderLogDiagnosisImage } from '../lib/system/logDiagnosisImageRenderer.js';
import { renderDailyGroupSummaryImage } from '../lib/groupSummary/dailyGroupSummaryImageRenderer.js';
import { createQqSimulatorConsole } from '../lib/webConsole/qqSimulatorConsole.js';
import { closeSharedPuppeteerBrowser } from '../lib/system/puppeteerRenderer.js';
import { cleanupCrystelfTempImages } from '../lib/system/tempImageCleanup.js';

globalThis.logger ||= {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const keepPreview = process.argv.includes('--keep') || process.env.RENDER_SMOKE_KEEP === '1';
const previewDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin', 'render-smoke-preview');
const created = [];
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensurePreviewDir() {
  if (keepPreview) {
    await fs.mkdir(previewDir, { recursive: true });
  }
}

async function checkImage(label, filePath, previewName) {
  const stat = await fs.stat(filePath);
  assert(stat.size > 1024, `${label} 文件过小：${stat.size}`);
  let finalPath = filePath;
  if (keepPreview && previewName) {
    finalPath = path.join(previewDir, previewName);
    await fs.copyFile(filePath, finalPath);
  }
  created.push(filePath);
  results.push({
    label,
    size: stat.size,
    ...(keepPreview ? { path: finalPath } : {}),
  });
}

async function renderAllImages() {
  await ensurePreviewDir();
  await checkImage('状态图', await renderStatusImage({
    botName: '魔丸',
    avatarText: '魔',
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    rows: [
      { label: '插件版本', value: 'crystelf-plugin v2.0.3' },
      { label: 'Bot', value: '10000' },
      { label: '运行时长', value: '3分' },
      { label: 'Node', value: process.version },
      { label: '平台', value: `${process.platform} ${process.arch}` },
      { label: '控制台', value: '渲染烟测' },
    ],
    features: [['私聊AI', true], ['群管理', false], ['状态', true]],
    health: [
      { label: '渲染', value: '正常', tone: 'success' },
      { label: '配置', value: '正常', tone: 'success' },
    ],
    aiUsage: { requestCount: 2, successCount: 2, errorCount: 0 },
    imageUsage: { requestCount: 1, successCount: 1, errorCount: 0 },
    resources: {
      cpuPercent: 2,
      memoryPercent: 3,
      heapPercent: 4,
      usedMemoryBytes: 128 * 1024 * 1024,
      totalMemoryBytes: 1024 * 1024 * 1024,
      heapUsedBytes: 32 * 1024 * 1024,
      heapTotalBytes: 64 * 1024 * 1024,
      rssBytes: 96 * 1024 * 1024,
      loadAvg: '0.00 / 0.00 / 0.00',
    },
  }), 'status-preview.png');

  await checkImage('命令列表图', await renderCommandListImage({
    botName: '魔丸',
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    categories: [
      {
        title: '基础',
        subtitle: '真实渲染烟测',
        commands: [
          { command: '#灵晶状态', description: '查看运行状态' },
          { command: '#灵晶排查日志', description: 'AI 排查日志' },
        ],
      },
      {
        title: '私聊',
        subtitle: '白黑名单链路',
        commands: [{ command: '私聊发送你好', description: '触发私聊 AI' }],
      },
    ],
  }), 'command-list-preview.png');

  await checkImage('日志排查图', await renderLogDiagnosisImage({
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    summary: { errorCount: 1, warningCount: 1, selectedFileCount: 1, scannedLineCount: 12 },
    issues: [{ level: 'error', title: '测试错误', message: '用于验证日志排查图渲染', count: 1 }],
    analysis: ['这是真实渲染烟测，不访问真实上游。', '图片生成成功表示 Chromium 渲染链路可用。'],
    selectedFiles: ['logs/test.log'],
  }), 'log-diagnosis-preview.png');

  await checkImage('每日群总结图', await renderDailyGroupSummaryImage({
    groupId: '10001',
    groupName: '测试群',
    date: '2026-07-05',
    messageCount: 8,
    memberCount: 3,
    summary: ['今天主要测试了共享渲染器。', '私聊模拟链路正常。'],
    keywords: ['魔丸', '渲染', '私聊'],
    messages: [
      { nickname: '用户A', text: '测试一下群总结图片', time: '10:00' },
      { nickname: '用户B', text: '看起来正常', time: '10:01' },
    ],
  }), 'daily-summary-preview.png');

  const rssPath = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin', `rss_render_smoke_${Date.now()}.png`);
  await fs.mkdir(path.dirname(rssPath), { recursive: true });
  await screenshot.generateScreenshot({
    title: 'RSS 截图烟测',
    author: '魔丸',
    content: '<p>这是本地 HTML 渲染测试。</p>',
    link: 'https://example.com',
    date: Date.now(),
    feedTitle: '测试订阅',
    image: '',
  }, rssPath);
  await checkImage('RSS 截图', rssPath, 'rss-preview.png');

  const musicRenderer = new MusicRenderer();
  await checkImage('音乐列表图', await musicRenderer.renderMusicList([
    { displayTitle: '测试歌曲 A', displayArtist: '歌手 A', displayAlbum: '专辑 A', duration: '03:20', format: 'mp3' },
    { displayTitle: '测试歌曲 B', displayArtist: '歌手 B', displayAlbum: '专辑 B', duration: '04:10', format: 'flac' },
  ], '测试歌曲', '10001'), 'music-list-preview.png');

  await checkImage('Markdown 渲染图', await aiRenderer.renderMarkdown('# Markdown 渲染烟测\n\n- 渲染共享浏览器池\n- 检查图片输出'), 'markdown-preview.png');
  await checkImage('代码渲染图', await aiRenderer.renderCode('console.log("crystelf render smoke")', 'javascript'), 'code-preview.png');
}

async function checkPrivateSimulator() {
  const simulator = createQqSimulatorConsole({
    ConfigControl: {
      get: () => ({
        config: { ai: true, privateAi: true, privateAiWhitelist: ['20001'], privateAiBlacklist: [] },
        ai: {},
        profile: { nickName: '魔丸' },
      }),
    },
    runSandboxChat: async () => ({ success: true, reply: '渲染烟测模拟回复成功', elapsedMs: 1, sessionId: 'render-smoke' }),
  });
  const result = await simulator.buildQqSimulatorSendPayload({
    eventType: 'private_message',
    userId: '20001',
    nickname: '私聊用户',
    messageText: '你好',
    adapterFormat: 'onebot',
    conversationMode: true,
  });
  assert(result.success === true, '私聊模拟失败');
  assert(result.replies.length > 0, '私聊模拟没有回复');
  results.push({ label: '私聊模拟', replyCount: result.replies.length, actionCount: result.actions.length });
}

async function main() {
  try {
    await cleanupCrystelfTempImages();
    await renderAllImages();
    await checkPrivateSimulator();
    console.log(JSON.stringify({ ok: true, keepPreview, previewDir: keepPreview ? previewDir : '', results }, null, 2));
  } finally {
    if (!keepPreview) {
      for (const filePath of created) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
    await closeSharedPuppeteerBrowser().catch(() => {});
  }
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
