import ConfigControl from '../lib/config/configControl.js';
import Version from '../lib/system/version.js';
import Path from '../constants/path.js';
import { getLatestUsageEntrySync, getUsageOverviewSync } from '../lib/ai/usageLogger.js';
import { getDailyImageUsageSummarySync } from '../lib/ai/imageUsageLogger.js';
import { getPricingConfig } from '../lib/webConsole/webConsoleConfig.js';
import { renderStatusImage } from '../lib/system/statusImageRenderer.js';
import { resolveBotIdentity } from '../lib/system/botIdentity.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const START_TIME = Date.now();

function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}天`);
  if (hours) parts.push(`${hours}小时`);
  if (minutes) parts.push(`${minutes}分`);
  if (!parts.length) parts.push(`${seconds}秒`);
  return parts.join('');
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatNumber(value = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
}

function formatMoney(value = 0, currencySymbol = '$') {
  const number = Number(value || 0);
  return `${currencySymbol || '$'}${(Number.isFinite(number) ? number : 0).toFixed(6)}`;
}

function formatElapsed(ms = 0) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return '0ms';
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`;
  return `${Math.round(value)}ms`;
}

function formatTime(value = '') {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 19);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatSceneLabel(scene = '') {
  const key = String(scene || '').trim().toLowerCase();
  const sceneMap = {
    chat: '普通对话',
    chat_text: '文本对话',
    chat_multimodal: '多模态对话',
    chat_engine: '对话引擎',
    chat_engine_fallback: '对话引擎兜底',
    chat_engine_final: '对话引擎最终回复',
    direct: '直接调用',
    complete: '工具调用',
    humanize_generate: '拟人化生成',
    poke_follow_reply: '戳一戳接话回复',
    poke_ai_reply: '戳一戳 AI 回复',
    poke_image_summary: '戳一戳图片摘要',
    daily_group_summary: '每日群聊总结',
    image_monitor_review: '图片监控审核',
  };
  return sceneMap[key] || (key === 'unknown' ? '未知场景' : String(scene || '').trim() || '未知场景');
}

function pickTopUsageEntry(map = {}) {
  return Object.entries(map || {})
    .sort((a, b) => {
      const tokenDiff = Number(b[1]?.total_tokens || 0) - Number(a[1]?.total_tokens || 0);
      if (tokenDiff !== 0) return tokenDiff;
      return Number(b[1]?.requests || 0) - Number(a[1]?.requests || 0);
    })[0] || null;
}

function calcPercent(value = 0, total = 0) {
  const current = Number(value || 0);
  const base = Number(total || 0);
  if (!Number.isFinite(current) || !Number.isFinite(base) || base <= 0) return 0;
  return Math.min(100, Math.max(0, (current / base) * 100));
}

function getCpuPercent() {
  try {
    const cpuUsage = process.cpuUsage();
    const cpuTimeMicros = Number(cpuUsage.user || 0) + Number(cpuUsage.system || 0);
    const elapsedMicros = Math.max(1, process.uptime() * 1000000);
    const cpuCount = Math.max(1, os.cpus?.()?.length || 1);
    return Math.min(100, Math.max(0, (cpuTimeMicros / (elapsedMicros * cpuCount)) * 100));
  } catch {
    return 0;
  }
}

function getAdapterName(e = {}) {
  return String(e.adapter_name || e.bot?.version?.app_name || e.bot?.adapter?.name || '未知');
}

function getWebConsoleText() {
  const appConfig = ConfigControl.get('config') || {};
  return appConfig.webConsole === false ? '已关闭' : '已启用';
}

function normalizePrivateAiAccessList(value = []) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/\r?\n|[,，;；\s]+/);
  return Array.from(new Set(items
    .map(item => String(item || '').trim())
    .filter(item => /^[1-9]\d{4,12}$/.test(item))));
}

function getPrivateAiAccessText(cfg = {}) {
  const whitelistCount = normalizePrivateAiAccessList(cfg.privateAiWhitelist).length;
  const blacklistCount = normalizePrivateAiAccessList(cfg.privateAiBlacklist).length;
  if (whitelistCount <= 0 && blacklistCount <= 0) return '不限';
  return `白${whitelistCount || '不限'} / 黑${blacklistCount}`;
}

function getConsoleWallpaperDataUrl() {
  const cacheFile = path.join(Path.root, 'temp', 'web-console-background', 'current-image.bin');
  const metaFile = path.join(Path.root, 'temp', 'web-console-background', 'current-image.json');
  const bundledFile = path.join(Path.root, 'lib', 'webConsole', 'public', 'assets', 'console-wallpaper-default.webp');
  const contentTypeMap = {
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  const readFileDataUrl = filePath => {
    if (!fs.existsSync(filePath)) return '';
    const ext = path.extname(filePath).toLowerCase();
    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    return `data:${contentType};base64,${fs.readFileSync(filePath).toString('base64')}`;
  };
  try {
    if (fs.existsSync(cacheFile) && fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const contentType = String(meta?.contentType || '').trim();
      if (contentType) {
        return `data:${contentType};base64,${fs.readFileSync(cacheFile).toString('base64')}`;
      }
    }
  } catch {}
  return readFileDataUrl(bundledFile);
}

function getFeatureEntries() {
  const cfg = ConfigControl.get('config') || {};
  return [
    ['AI', cfg.ai !== false],
    ['私聊AI', cfg.privateAi !== false],
    [`私聊名单 ${getPrivateAiAccessText(cfg)}`, cfg.privateAi !== false],
    ['私聊安全', cfg.privateAiSafety?.enabled !== false],
    ['点歌', cfg.music !== false],
    ['RSS', cfg.rss !== false],
    ['戳一戳', cfg.poke !== false],
    ['图片监控', cfg.imageMonitor !== false],
    ['语音模型', cfg.voiceModel !== false],
    ['群管理', cfg.groupManagement !== false],
    ['头衔', cfg.groupTitle !== false],
    ['欢迎', cfg.welcome !== false],
  ];
}

function buildHealthItems(allConfigs = {}) {
  const aiConfig = allConfigs.ai || {};
  const imageConfig = aiConfig.imageConfig || {};
  const coreConfig = allConfigs.coreConfig || {};
  const searchConfig = coreConfig.tools?.search || {};
  const ttsConfig = coreConfig.tools?.tts || {};
  const imageMonitorConfig = allConfigs.imageMonitor || {};

  const chatModel = aiConfig.modelType || aiConfig.model || aiConfig.workingModel;
  const aiReady = Boolean(aiConfig.apiKey && aiConfig.baseApi && chatModel);
  const imageMode = String(imageConfig.imageMode || 'openai');
  const imageReady = imageConfig.enabled === false
    ? false
    : imageMode === 'jimeng'
      ? Boolean(imageConfig.jimengApiUrl)
      : Boolean((imageConfig.apiKey || aiConfig.apiKey) && (imageConfig.baseApi || aiConfig.baseApi) && imageConfig.model);
  const ttsReady = ttsConfig.enabled !== false && Boolean(ttsConfig.apiUrl);
  const searchReady = searchConfig.enabled !== false && Boolean(searchConfig.apiUrl);
  const monitorReady = imageMonitorConfig.enabled !== false && Boolean(imageMonitorConfig.apiBase && imageMonitorConfig.apiKey && imageMonitorConfig.model);

  return [
    {
      label: 'AI 接口',
      tone: aiReady ? 'success' : 'warn',
      detail: aiReady ? `主对话 ${chatModel}` : '未完整配置',
    },
    {
      label: '图片生成',
      tone: imageReady ? 'success' : 'warn',
      detail: imageReady ? `${imageMode} · ${imageConfig.model || '跟随配置'}` : '未启用或未完整配置',
    },
    {
      label: 'TTS 语音',
      tone: ttsReady ? 'success' : 'warn',
      detail: ttsReady ? '配置可用' : '未启用或未配置',
    },
    {
      label: '搜索/Skill',
      tone: searchReady ? 'success' : 'warn',
      detail: searchReady ? '搜索工具配置可用' : '搜索工具未配置',
    },
    {
      label: '图片监控',
      tone: monitorReady ? 'success' : 'warn',
      detail: monitorReady ? `${imageMonitorConfig.model || '视觉模型'} 已配置` : '未启用或未完整配置',
    },
    {
      label: '控制台',
      tone: getWebConsoleText() === '已启用' ? 'success' : 'warn',
      detail: getWebConsoleText(),
    },
  ];
}

function buildAlerts({ memoryPercent, heapPercent, usage, imageUsage, health }) {
  const alerts = [];
  const requestCount = Number(usage.request_count || 0);
  const errorCount = Number(usage.error_count || 0);
  const imageRequests = Number(imageUsage.request_count || 0);
  const imageErrors = Number(imageUsage.error_count || 0);

  if (memoryPercent >= 85) alerts.push({ tone: 'warn', label: '内存', text: `物理内存使用率 ${memoryPercent.toFixed(1)}%` });
  if (heapPercent >= 85) alerts.push({ tone: 'warn', label: 'Heap', text: `进程 Heap 使用率 ${heapPercent.toFixed(1)}%` });
  if (requestCount > 0 && errorCount / requestCount >= 0.2) alerts.push({ tone: 'warn', label: 'AI', text: `今日 AI 错误率 ${((errorCount / requestCount) * 100).toFixed(1)}%` });
  if (imageRequests > 0 && imageErrors / imageRequests >= 0.2) alerts.push({ tone: 'warn', label: '生图', text: `今日生图错误率 ${((imageErrors / imageRequests) * 100).toFixed(1)}%` });

  const unhealthy = health.filter(item => item.tone !== 'success');
  if (unhealthy.length > 0) {
    alerts.push({ tone: 'warn', label: '接口', text: `${unhealthy.slice(0, 2).map(item => item.label).join('、')} 需要检查` });
  }

  return alerts.length > 0 ? alerts.slice(0, 4) : [{ tone: 'success', label: 'OK', text: '暂无运行告警' }];
}

function buildStatusData(e = {}) {
  const allConfigs = ConfigControl.get() || {};
  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryPercent = calcPercent(usedMemory, totalMemory);
  const heapPercent = calcPercent(memory.heapUsed, memory.heapTotal);
  const loadAvg = os.loadavg().map(item => item.toFixed(2)).join(' / ');
  const uptimeMs = Math.max(process.uptime() * 1000, Date.now() - START_TIME);
  const pricing = getPricingConfig(allConfigs);
  const usage = getUsageOverviewSync(new Date(), pricing) || {};
  const latest = getLatestUsageEntrySync(new Date());
  const imageUsage = getDailyImageUsageSummarySync(new Date());
  const topSceneEntry = pickTopUsageEntry(usage.by_scene);
  const topModelEntry = pickTopUsageEntry(usage.by_model);
  const requestCount = Number(usage.request_count || 0);
  const totalTokens = Number(usage.total_tokens || 0);
  const profileName = String(allConfigs?.profile?.nickName || allConfigs?.profile?.nickname || '魔丸').trim();
  const botIdentity = resolveBotIdentity(e, profileName);
  const botId = botIdentity.botId || '未知';
  const { botName } = botIdentity;
  const cpuPercent = getCpuPercent();
  const health = buildHealthItems(allConfigs);
  const imageLatest = imageUsage.latest;

  const data = {
    statusText: health.some(item => item.tone !== 'success') ? '需要检查' : '运行正常',
    statusTone: health.some(item => item.tone !== 'success') ? 'warn' : 'success',
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    resources: {
      cpuPercent,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      totalMemoryBytes: totalMemory,
      usedMemoryBytes: usedMemory,
      memoryPercent,
      heapPercent,
      loadAvg,
      uptimeMs,
    },
    metrics: [
      {
        label: '物理内存',
        value: `${formatBytes(usedMemory)} / ${formatBytes(totalMemory)}`,
        percent: memoryPercent,
      },
      {
        label: '进程 Heap',
        value: `${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}`,
        percent: heapPercent,
      },
    ],
    aiUsage: {
      requestCount: Number(usage.request_count || 0),
      successCount: Number(usage.success_count || 0),
      errorCount: Number(usage.error_count || 0),
      promptTokens: Number(usage.prompt_tokens || 0),
      completionTokens: Number(usage.completion_tokens || 0),
      totalTokens,
      requestCountText: formatNumber(usage.request_count),
      successCountText: formatNumber(usage.success_count),
      errorCountText: formatNumber(usage.error_count),
      promptTokensText: formatNumber(usage.prompt_tokens),
      completionTokensText: formatNumber(usage.completion_tokens),
      totalTokensText: formatNumber(usage.total_tokens),
      costText: pricing.enabled === false ? '未启用' : formatMoney(usage.total_cost, pricing.currencySymbol),
      costSubText: pricing.enabled === false ? '成本估算未启用' : '按当前价格配置估算',
      topScene: topSceneEntry ? {
        label: formatSceneLabel(topSceneEntry[0]),
        requestsText: formatNumber(topSceneEntry[1]?.requests),
        tokensText: formatNumber(topSceneEntry[1]?.total_tokens),
        percent: calcPercent(topSceneEntry[1]?.total_tokens, totalTokens),
      } : null,
      topModel: topModelEntry ? {
        label: topModelEntry[0] || '未知模型',
        requestsText: formatNumber(topModelEntry[1]?.requests),
        tokensText: formatNumber(topModelEntry[1]?.total_tokens),
        percent: calcPercent(topModelEntry[1]?.total_tokens, totalTokens),
      } : null,
      latest: latest ? {
        statusText: latest.stage === 'success' ? '成功' : '失败',
        sceneLabel: formatSceneLabel(latest.scene),
        detail: `${formatTime(latest.time)} · ${latest.model || '未知模型'} · Tokens ${formatNumber(latest.total_tokens)} · 耗时 ${formatElapsed(latest.elapsed_ms)}${latest.error ? ` · ${latest.error}` : ''}`,
      } : null,
    },
    imageUsage: {
      requestCount: Number(imageUsage.request_count || 0),
      requestCountText: formatNumber(imageUsage.request_count),
      successCountText: formatNumber(imageUsage.success_count),
      errorCountText: formatNumber(imageUsage.error_count),
      averageElapsedText: formatElapsed(imageUsage.average_elapsed_ms),
      latest: imageLatest ? {
        statusText: imageLatest.stage === 'success' ? '最近成功' : '最近失败',
        detail: `${formatTime(imageLatest.time)} · ${imageLatest.model || '未知模型'} · ${formatElapsed(imageLatest.elapsed_ms)}${imageLatest.error ? ` · ${imageLatest.error}` : ''}`,
      } : null,
    },
    consoleWallpaper: getConsoleWallpaperDataUrl(),
    health,
    rows: [
      ['插件版本', `${Version.name} v${Version.ver}`],
      ['机器人昵称', botName],
      ['Bot', botId],
      ['适配器', getAdapterName(e)],
      ['进程', `PID ${process.pid}`],
      ['运行时长', formatDuration(uptimeMs)],
      ['Node', process.version],
      ['平台', `${process.platform} ${process.arch}`],
      ['系统负载', loadAvg],
      ['控制台', getWebConsoleText()],
    ],
    botName,
    avatarText: botIdentity.avatarText,
    avatarUrl: botIdentity.avatarUrl,
    features: getFeatureEntries(),
  };

  data.alerts = buildAlerts({ memoryPercent, heapPercent, usage, imageUsage, health });
  data.summaryLines = [
    `插件：${Version.name} v${Version.ver}`,
    `Bot：${botId}`,
    `适配器：${getAdapterName(e)}`,
    `进程：PID ${process.pid}`,
    `运行时长：${formatDuration(uptimeMs)}`,
    `Node：${process.version}`,
    `平台：${process.platform} ${process.arch}`,
    `进程内存：RSS ${formatBytes(memory.rss)} / Heap ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}`,
    `物理内存：${formatBytes(usedMemory)} / ${formatBytes(totalMemory)}`,
    `系统负载：${loadAvg}`,
    requestCount > 0
      ? `AI用量：今日 ${formatNumber(usage.request_count)} 次 / 成功 ${formatNumber(usage.success_count)} / 失败 ${formatNumber(usage.error_count)}`
      : 'AI用量：今日暂无记录',
    `AI Tokens：输入 ${formatNumber(usage.prompt_tokens)} / 输出 ${formatNumber(usage.completion_tokens)} / 总计 ${formatNumber(usage.total_tokens)}`,
    pricing.enabled === false ? 'AI成本：未启用估算' : `AI成本：${formatMoney(usage.total_cost, pricing.currencySymbol)}（预估）`,
    `生图统计：今日 ${formatNumber(imageUsage.request_count)} 次 / 成功 ${formatNumber(imageUsage.success_count)} / 失败 ${formatNumber(imageUsage.error_count)}`,
    latest ? `最近AI：${formatSceneLabel(latest.scene)} / ${latest.stage === 'success' ? '成功' : '失败'} / ${latest.model || '未知模型'}` : '最近AI：暂无记录',
    `接口健康：${health.map(item => `${item.label}:${item.tone === 'success' ? '正常' : '检查'}`).join(' / ')}`,
    `告警：${data.alerts.map(item => item.text).join('；')}`,
    `控制台：${getWebConsoleText()}`,
    `功能：${getFeatureEntries().map(([name, enabled]) => `${name}:${enabled ? '开' : '关'}`).join(' / ')}`,
    `时间：${data.generatedAt}`,
  ];

  return data;
}

function buildStatusText(e = {}) {
  const data = buildStatusData(e);
  return ['灵晶状态', '━━━━━━━━━━━━', ...data.summaryLines].join('\n');
}

export class CrystelfStatus extends plugin {
  constructor() {
    super({
      name: 'crystelf-status',
      dsc: '灵晶插件运行状态',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^#灵晶状态$',
          fnc: 'showStatus',
        },
      ],
    });
  }

  async showStatus(e) {
    const data = buildStatusData(e);
    try {
      const imagePath = await renderStatusImage(data);
      if (imagePath) {
        return e.reply(segment.image(imagePath), true);
      }
    } catch (error) {
      logger.warn(`[crystelf-status] 状态图片渲染失败，回退文本: ${error.message}`);
    }
    return e.reply(['灵晶状态', '━━━━━━━━━━━━', ...data.summaryLines].join('\n'), true);
  }
}

export { buildStatusData, buildStatusText };
