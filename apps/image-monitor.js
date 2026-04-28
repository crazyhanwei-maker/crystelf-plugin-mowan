import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import OpenAI from 'openai';
import ConfigControl from '../lib/config/configControl.js';
import { logAiUsage } from '../lib/ai/usageLogger.js';
import Message from '../lib/yunzai/message.js';
import YunzaiUtils from '../lib/yunzai/utils.js';
import Path from '../constants/path.js';

const imageMonitorRuntime = {
  recentHashes: new Map(),
};

const IMAGE_MONITOR_DIR = path.join(Path.config, 'image-monitor');
const IMAGE_MONITOR_MEME_DIR = path.join(IMAGE_MONITOR_DIR, 'memes');
const IMAGE_MONITOR_INDEX = path.join(IMAGE_MONITOR_DIR, 'meme-index.jsonl');
const IMAGE_MONITOR_LOG = path.join(IMAGE_MONITOR_DIR, 'review-log.jsonl');
const IMAGE_MONITOR_OUTPUT_CONTRACT = [
  '重要：请严格只输出 JSON。',
  'JSON 字段必须包含 isMeme(boolean)、memeCharacter(string)、memeEmotion(string)、memeTags(string[])、riskLevel(low|medium|high|none)、riskCategories(string[])、summary(string)。',
  'memeCharacter 只能是稳定角色名、人物名或核心形象名，例如 芙宁娜、派蒙、真寻；严禁把动作、情绪、用途、场景、画风、短句当作角色名；无法明确角色时写 未知。',
  'memeEmotion 必须且只能是 happy、sad、angry、confused、shy、surprised、default 之一；无法判断时写 default。',
  '图片会按 memeCharacter/memeEmotion 保存，例如 芙宁娜/happy/xxx.png，所以角色和情绪必须稳定、简短、规范。',
].join('\n');
const MEME_EMOTION_ALIASES = {
  default: 'default',
  normal: 'default',
  neutral: 'default',
  happy: 'happy',
  joy: 'happy',
  smile: 'happy',
  cute: 'happy',
  funny: 'happy',
  sad: 'sad',
  cry: 'sad',
  angry: 'angry',
  mad: 'angry',
  surprised: 'surprised',
  surprise: 'surprised',
  shocked: 'surprised',
  confused: 'confused',
  confuse: 'confused',
  shy: 'shy',
};

function pickFallbackReply(value = '') {
  const pool = String(value || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
  if (pool.length === 0) return '';
  return pool[Math.floor(Math.random() * pool.length)] || '';
}

function isTimeoutFailureReason(reason = '') {
  return /超时|timeout|timed out|time out|abort/i.test(String(reason || '').trim());
}

function buildImageMonitorFallbackMessage(cfg = {}, failureReason = '') {
  if (isTimeoutFailureReason(failureReason)) {
    return pickFallbackReply(cfg?.fallbackTimeoutReply) || pickFallbackReply(cfg?.fallbackReply) || '';
  }
  return pickFallbackReply(cfg?.fallbackReply) || '';
}

function buildImageMonitorPrompt(prompt = '') {
  const base = String(prompt || '').trim();
  if (base.includes('memeCharacter') && base.includes('memeEmotion')) {
    return base;
  }
  return [base, IMAGE_MONITOR_OUTPUT_CONTRACT].filter(Boolean).join('\n\n');
}

async function notifyImageMonitorFallback(e, cfg = {}, failureReason = '') {
  const message = buildImageMonitorFallbackMessage(cfg, failureReason);
  if (!message) {
    return false;
  }
  await e.reply(message, false, { recallMsg: 20 });
  return true;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function appendJsonLine(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload, null, 0)}\n`, 'utf8');
}

function normalizeRiskLevel(level = '') {
  const normalized = String(level || '').trim().toLowerCase();
  return ['none', 'low', 'medium', 'high'].includes(normalized) ? normalized : 'none';
}

function riskReached(level = 'none', threshold = 'high') {
  const order = { none: 0, low: 1, medium: 2, high: 3 };
  return (order[normalizeRiskLevel(level)] || 0) >= (order[normalizeRiskLevel(threshold)] || 3);
}

function normalizeViolationAction(cfg = {}) {
  const action = String(cfg.violationAction || '').trim().toLowerCase();
  if (['record', 'alert', 'recall'].includes(action)) {
    return action;
  }
  return cfg.autoRecallViolation ? 'recall' : 'record';
}

async function extractImageUrls(e, maxImages = 3, monitorQuotedImages = true) {
  const urls = [];
  if (monitorQuotedImages && (e.source || e.reply_id) && typeof e.getReply === 'function') {
    try {
      const reply = await e.getReply();
      const msgArr = Array.isArray(reply) ? reply : reply?.message || [];
      msgArr.filter(item => item.type === 'image' && item.url).forEach(item => urls.push(item.url));
    } catch {}
  }
  const directImages = await YunzaiUtils.getImages(e, maxImages, true);
  if (Array.isArray(directImages)) {
    directImages.forEach(url => urls.push(url));
  }
  return [...new Set(urls.filter(Boolean))].slice(0, maxImages);
}

async function downloadImageBuffer(url, timeout = 30000) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout });
  return Buffer.from(response.data);
}

function calcBufferHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sanitizeFolderName(name = '') {
  return String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

function normalizeMemeEmotion(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (MEME_EMOTION_ALIASES[normalized]) {
    return MEME_EMOTION_ALIASES[normalized];
  }
  const raw = String(value || '').trim();
  if (/笑|开心|高兴|可爱|萌|哈哈|偷笑|乐|喜/iu.test(raw)) return 'happy';
  if (/哭|难过|伤心|委屈|泪|emo|沮丧/iu.test(raw)) return 'sad';
  if (/怒|生气|火大|气死|炸毛|不爽/iu.test(raw)) return 'angry';
  if (/惊|震惊|吓|愣|讶/iu.test(raw)) return 'surprised';
  if (/疑惑|困惑|懵|问号|不懂/iu.test(raw)) return 'confused';
  if (/害羞|脸红|羞/iu.test(raw)) return 'shy';
  return 'default';
}

function resolveMemeCharacter(analysis = {}) {
  const firstTag = String(analysis.memeCharacter || '').trim()
    || (Array.isArray(analysis.memeTags) ? String(analysis.memeTags[0] || '').trim() : '');
  const normalized = sanitizeFolderName(firstTag);
  return normalized || '未知';
}

function resolveMemeEmotion(analysis = {}) {
  const explicit = normalizeMemeEmotion(analysis.memeEmotion);
  if (explicit !== 'default') {
    return explicit;
  }
  const text = [
    ...(Array.isArray(analysis.memeTags) ? analysis.memeTags : []),
    analysis.summary,
  ].join(' ');
  return normalizeMemeEmotion(text);
}

function resolveMemeKeywords(analysis = {}, character = '未知') {
  const tags = Array.isArray(analysis.memeTags) ? analysis.memeTags : [];
  const keywords = tags
    .map(item => sanitizeFolderName(item))
    .filter(Boolean)
    .filter(item => item !== character)
    .slice(0, 4);
  return keywords;
}

function normalizeMatcherList(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,，;；]/);
  return items
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

function includesTextToken(value = '', token = '') {
  const text = String(value || '').trim().toLowerCase();
  const keyword = String(token || '').trim().toLowerCase();
  return Boolean(text && keyword && text.includes(keyword));
}

function shouldSaveMemeImageByFilter(cfg = {}, analysis = {}, character = '') {
  const allowedCharacters = normalizeMatcherList(cfg.saveMemeCharacters);
  const allowedKeywords = normalizeMatcherList(cfg.saveMemeKeywords);
  if (allowedCharacters.length === 0 && allowedKeywords.length === 0) {
    return { matched: true, reason: 'no_filter' };
  }

  const tags = Array.isArray(analysis.memeTags) ? analysis.memeTags.map(item => String(item || '').trim()).filter(Boolean) : [];
  const summary = String(analysis.summary || '').trim();
  const emotion = resolveMemeEmotion(analysis);
  const searchFields = [character, emotion, ...tags, summary].filter(Boolean);
  const characterMatched = allowedCharacters.some(item => includesTextToken(character, item));
  const keywordMatched = allowedKeywords.some(keyword => searchFields.some(value => includesTextToken(value, keyword)));

  if (characterMatched || keywordMatched) {
    return {
      matched: true,
      reason: characterMatched ? 'character_matched' : 'keyword_matched',
    };
  }
  return { matched: false, reason: 'filter_not_matched' };
}

function shouldSkipHash(hash, windowMs) {
  const now = Date.now();
  const last = imageMonitorRuntime.recentHashes.get(hash) || 0;
  if (now - last < windowMs) {
    return true;
  }
  imageMonitorRuntime.recentHashes.set(hash, now);
  return false;
}

async function analyzeImageWithVisionModel(cfg, imageUrl) {
  const timeout = Number(cfg.analysisTimeoutMs) > 0 ? Number(cfg.analysisTimeoutMs) : 30000;
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.apiBase, timeout });
  const startedAt = Date.now();
  const completion = await client.chat.completions.create({
    model: cfg.model,
    temperature: Number(cfg.temperature ?? 0.1),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildImageMonitorPrompt(cfg.prompt) },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }],
    stream: false,
  });
  const usage = completion?.usage;
  const content = completion?.choices?.[0]?.message?.content || '{}';
  const jsonText = String(content).match(/\{[\s\S]*\}/)?.[0] || '{}';
  const parsed = JSON.parse(jsonText);
  return {
    isMeme: Boolean(parsed.isMeme),
    memeCharacter: String(parsed.memeCharacter || '').trim(),
    memeEmotion: normalizeMemeEmotion(parsed.memeEmotion),
    memeTags: Array.isArray(parsed.memeTags) ? parsed.memeTags.map(item => String(item).trim()).filter(Boolean).slice(0, 12) : [],
    riskLevel: normalizeRiskLevel(parsed.riskLevel),
    riskCategories: Array.isArray(parsed.riskCategories) ? parsed.riskCategories.map(item => String(item).trim()).filter(Boolean).slice(0, 8) : [],
    summary: String(parsed.summary || '').trim(),
    usage,
    elapsedMs: Date.now() - startedAt,
    raw: parsed,
  };
}

function saveMemeImage(buffer, hash, analysis, e, sourceUrl, cfg = {}) {
  const character = resolveMemeCharacter(analysis);
  const emotion = resolveMemeEmotion(analysis);
  const keywords = resolveMemeKeywords(analysis, character);
  
  // 如果没有识别出角色名，不保存
  if (!character || character === '未知') {
    logger.info(`[image-monitor] Skip saving meme: no character identified`);
    return { saved: false, character, emotion, keywords, reason: 'unknown_character' };
  }

  const filterResult = shouldSaveMemeImageByFilter(cfg, analysis, character);
  if (!filterResult.matched) {
    logger.info(`[image-monitor] Skip saving meme: save filter not matched (${character})`);
    return { saved: false, character, emotion, keywords, reason: filterResult.reason };
  }
  
  const emotionDir = path.join(IMAGE_MONITOR_MEME_DIR, character, emotion);
  ensureDir(emotionDir);
  const ext = sourceUrl.includes('.gif') ? 'gif' : sourceUrl.includes('.webp') ? 'webp' : sourceUrl.includes('.png') ? 'png' : 'jpg';
  const fileName = `${character}-${emotion}-${hash.slice(0, 12)}.${ext}`;
  const filePath = path.join(emotionDir, fileName);
  fs.writeFileSync(filePath, buffer);
  appendJsonLine(IMAGE_MONITOR_INDEX, {
    savedAt: new Date().toISOString(),
    character,
    emotion,
    folder: character,
    relativeDir: path.join(character, emotion).replace(/\\/g, '/'),
    fileName,
    filePath,
    hash,
    groupId: String(e.group_id || ''),
    userId: String(e.user_id || ''),
    messageId: String(e.message_id || ''),
    sourceUrl,
    memeTags: [character, ...((analysis.memeTags || []).filter(item => String(item).trim() && String(item).trim() !== character))],
    keywords,
    summary: analysis.summary,
  });
  return { saved: true, character, emotion, keywords, filePath, fileName, reason: 'saved' };
}

async function processImageMonitor(e) {
  const mainConfig = ConfigControl.get('config') || {};
  const monitorConfig = ConfigControl.get('imageMonitor') || {};
  if (!mainConfig.imageMonitor || !monitorConfig.enabled) {
    return false;
  }
  if (!monitorConfig.apiBase || !monitorConfig.apiKey || !monitorConfig.model) {
    return false;
  }
  const groupId = String(e.group_id || '');
  if (Array.isArray(monitorConfig.allowedGroups) && monitorConfig.allowedGroups.length > 0 && !monitorConfig.allowedGroups.map(String).includes(groupId)) {
    return false;
  }
  if (Array.isArray(monitorConfig.blockedGroups) && monitorConfig.blockedGroups.map(String).includes(groupId)) {
    return false;
  }
  const imageUrls = await extractImageUrls(e, Math.max(1, Number(monitorConfig.maxImagesPerMessage || 3)), monitorConfig.monitorQuotedImages !== false);
  if (!imageUrls.length) {
    return false;
  }
  const violationAction = normalizeViolationAction(monitorConfig);
  let failureNotified = false;
  for (const imageUrl of imageUrls) {
    try {
      const buffer = await downloadImageBuffer(imageUrl, Math.max(1000, Number(monitorConfig.analysisTimeoutMs || 30000)));
      const hash = calcBufferHash(buffer);
      if (shouldSkipHash(hash, Math.max(0, Number(monitorConfig.duplicateWindowMs || 300000)))) {
        continue;
      }
      const analysis = await analyzeImageWithVisionModel(monitorConfig, imageUrl);
      await logAiUsage({
        stage: 'success',
        scene: 'image_monitor_review',
        model: monitorConfig.model,
        provider: 'openai-compatible',
        sessionId: groupId ? `group:${groupId}` : `user:${String(e.user_id || 'unknown')}`,
        groupId,
        userId: String(e.user_id || ''),
        messageCount: 1,
        elapsedMs: analysis.elapsedMs,
        responsePreview: analysis.summary || JSON.stringify(analysis.raw || {}),
        usage: analysis.usage,
      });
      let recalled = false;
      let alerted = false;
      let memeSaveResult = {
        saved: false,
        character: resolveMemeCharacter(analysis),
        emotion: resolveMemeEmotion(analysis),
        keywords: resolveMemeKeywords(analysis),
        reason: 'not_meme',
      };
      if (analysis.isMeme && monitorConfig.saveMemeImages !== false) {
        memeSaveResult = saveMemeImage(buffer, hash, analysis, e, imageUrl, monitorConfig);
      } else if (analysis.isMeme) {
        const disabledCharacter = resolveMemeCharacter(analysis);
        memeSaveResult = {
          saved: false,
          character: disabledCharacter,
          emotion: resolveMemeEmotion(analysis),
          keywords: resolveMemeKeywords(analysis, disabledCharacter),
          reason: 'save_disabled',
        };
      }
      if (riskReached(analysis.riskLevel, monitorConfig.riskThreshold || 'high')) {
        if (violationAction === 'recall') {
          await Message.deleteMsg(e, e.message_id);
          recalled = true;
        } else if (violationAction === 'alert') {
          alerted = true;
          await e.reply(`图片监控提示：检测到疑似违规图片，风险等级 ${analysis.riskLevel}。`, false, { recallMsg: 20 });
        }
      }
      appendJsonLine(IMAGE_MONITOR_LOG, {
        reviewedAt: new Date().toISOString(),
        hash,
        groupId,
        userId: String(e.user_id || ''),
        messageId: String(e.message_id || ''),
        imageUrl,
        isMeme: analysis.isMeme,
        memeTags: analysis.memeTags,
        memeCharacter: memeSaveResult.character || '',
        memeEmotion: memeSaveResult.emotion || 'default',
        memeKeywords: memeSaveResult.keywords || [],
        memeSaved: memeSaveResult.saved === true,
        memeSaveReason: memeSaveResult.reason || '',
        memeFilePath: memeSaveResult.filePath || '',
        memeFileName: memeSaveResult.fileName || '',
        riskLevel: analysis.riskLevel,
        riskCategories: analysis.riskCategories,
        summary: analysis.summary,
        violationAction,
        alerted,
        recalled,
      });
    } catch (error) {
      await logAiUsage({
        stage: 'error',
        scene: 'image_monitor_review',
        model: monitorConfig.model,
        provider: 'openai-compatible',
        sessionId: groupId ? `group:${groupId}` : `user:${String(e.user_id || 'unknown')}`,
        groupId,
        userId: String(e.user_id || ''),
        messageCount: 1,
        error: error.message,
      });
      appendJsonLine(IMAGE_MONITOR_LOG, {
        reviewedAt: new Date().toISOString(),
        groupId,
        userId: String(e.user_id || ''),
        messageId: String(e.message_id || ''),
        imageUrl,
        error: error.message,
      });
      if (!failureNotified) {
        try {
          failureNotified = await notifyImageMonitorFallback(e, monitorConfig, error.message);
        } catch (notifyError) {
          logger.warn(`[image-monitor] 发送失败提示失败: ${notifyError.message}`);
        }
      }
    }
  }
  return false;
}

export default class ImageMonitor extends plugin {
  constructor() {
    super({
      name: 'image-monitor',
      dsc: '独立图片监控与审核',
      event: 'message.group',
      priority: -1120,
      rule: [{ reg: '^[\\s\\S]*$', fnc: 'watchGroupImages' }],
    });
  }

  async watchGroupImages(e) {
    return await processImageMonitor(e);
  }
}
