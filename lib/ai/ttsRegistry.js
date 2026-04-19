import axios from 'axios';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import ConfigControl from '../config/configControl.js';

const TTS_DEBUG_DIR = path.join(process.cwd(), 'data', 'crystelf', 'debug');
const TTS_MODELS_CACHE = path.join(process.cwd(), 'data', 'crystelf', 'cache', 'tts-models-v4.json');

function normalizeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/^`+|`+$/g, '').replace(/^"+|"+$/g, '').trim();
  return trimmed || fallback;
}

function normalizeModelName(value, fallback = '') {
  const normalized = normalizeString(value, fallback);
  if (!normalized) return fallback;
  if (normalized.toLowerCase() === 'default') {
    return fallback;
  }
  return normalized;
}

function sanitizeText(value, maxLength = 120) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseAllowedScenes(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function detectReplyScene(toolCtx = {}) {
  const replyType = toolCtx?.promptCtx?.replyContext?.type || '';
  return replyType || 'unknown';
}

function hasExplicitVoiceIntent(text) {
  return /(语音|念出来|读出来|说出来|发语音|配音|朗读)/i.test(String(text || ''));
}

function shouldAllowAutoVoice(ttsConfig, text, toolCtx, args = {}) {
  if (!ttsConfig.allowAiTrigger) {
    return { allowed: false, reason: '未启用AI自动语音' };
  }

  if (args.force === true) {
    return { allowed: true, reason: '' };
  }

  const scene = detectReplyScene(toolCtx);
  const allowedScenes = parseAllowedScenes(ttsConfig.allowedAutoScenes || 'reply,poked');
  if (allowedScenes.length > 0 && !allowedScenes.includes(scene)) {
    return { allowed: false, reason: `当前场景 ${scene} 不允许自动语音` };
  }

  const maxAutoVoiceTextLength = normalizeNumber(ttsConfig.maxAutoVoiceTextLength, 40);
  if (String(text || '').length > maxAutoVoiceTextLength) {
    return { allowed: false, reason: `文本长度超过自动语音限制(${maxAutoVoiceTextLength})` };
  }

  if (ttsConfig.requireVoiceKeywords !== false && !hasExplicitVoiceIntent(toolCtx?.targetMessage?.content || '')) {
    return { allowed: false, reason: '当前消息未出现显式语音意图关键词' };
  }

  return { allowed: true, reason: '' };
}

function normalizeAudioUrl(audioUrl, dlUrl) {
  const normalizedAudioUrl = normalizeString(audioUrl, '');
  const normalizedDlUrl = normalizeString(dlUrl, '');
  if (!normalizedAudioUrl) {
    return '';
  }

  try {
    const parsedAudioUrl = new URL(normalizedAudioUrl);
    if (parsedAudioUrl.hostname === '0.0.0.0' && normalizedDlUrl) {
      const parsedDlUrl = new URL(normalizedDlUrl);
      parsedAudioUrl.protocol = parsedDlUrl.protocol;
      parsedAudioUrl.hostname = parsedDlUrl.hostname;
      parsedAudioUrl.port = parsedDlUrl.port;
      return parsedAudioUrl.toString();
    }
  } catch {
    return normalizedAudioUrl;
  }

  return normalizedAudioUrl;
}

async function ensureDir(targetFile) {
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
}

async function appendTtsDebugLog(payload) {
  try {
    const targetFile = path.join(TTS_DEBUG_DIR, 'tts.log');
    await ensureDir(targetFile);
    await fs.appendFile(
      targetFile,
      `${JSON.stringify({ time: new Date().toISOString(), ...payload }, null, 2)}\n`,
      'utf8'
    );
  } catch (error) {
    logger.warn(`[ttsRegistry] 写入TTS日志失败: ${error.message}`);
  }
}

async function fetchTtsModels() {
  const coreConfig = await ConfigControl.get('coreConfig');
  const ttsConfig = coreConfig?.tools?.tts || {};
  if (!ttsConfig.enabled) {
    return { success: false, error: '内置语音工具未启用' };
  }

  if (!ttsConfig.modelsUrl) {
    return { success: false, error: '未配置语音模型列表地址' };
  }

  try {
    const response = await axios.get(ttsConfig.modelsUrl, {
      timeout: 20000,
    });
    const data = response.data || {};
    const models = data.models || {};
    await ensureDir(TTS_MODELS_CACHE);
    await fs.writeFile(
      TTS_MODELS_CACHE,
      JSON.stringify({ updatedAt: new Date().toISOString(), models }, null, 2),
      'utf8'
    );

    const summary = Object.entries(models).slice(0, 20).map(([model, langs]) => ({
      model,
      languages: Object.keys(langs || {}),
    }));
    await appendTtsDebugLog({
      stage: 'models_success',
      count: Object.keys(models).length,
      summary,
    });

    return {
      success: true,
      count: Object.keys(models).length,
      models,
      summary,
    };
  } catch (error) {
    await appendTtsDebugLog({
      stage: 'models_failure',
      error: error.message,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

async function loadCachedModels() {
  try {
    const content = await fs.readFile(TTS_MODELS_CACHE, 'utf8');
    const parsed = JSON.parse(content);
    return parsed.models || {};
  } catch {
    return {};
  }
}

function loadCachedModelsSync() {
  try {
    if (!fsSync.existsSync(TTS_MODELS_CACHE)) {
      return {};
    }
    const content = fsSync.readFileSync(TTS_MODELS_CACHE, 'utf8');
    const parsed = JSON.parse(content);
    return parsed.models || {};
  } catch {
    return {};
  }
}

function pickFallbackModel(models = {}) {
  const entries = Object.keys(models || {});
  return entries.length > 0 ? entries[0] : '';
}

function normalizeModelAlias(value) {
  return String(value || '')
    .replace(/[「」『』【】《》〈〉()（）\[\]_\-\s]/g, '')
    .replace(/原神|中文|日语|英语|韩语|ZH|JP|EN|KR/gi, '')
    .trim()
    .toLowerCase();
}

function extractQuotedRoleName(text) {
  const match = String(text || '').match(/[「『【《〈](.+?)[」』】》〉]/);
  return match?.[1]?.trim() || '';
}

const ROLE_ALIAS_MAP = {
  水神: '芙宁娜',
  芙芙: '芙宁娜',
  芙卡洛斯: '芙宁娜',
  岩神: '钟离',
  钟离先生: '钟离',
  客卿大人: '钟离',
  往生堂堂主: '胡桃',
  堂主: '胡桃',
  小草神: '纳西妲',
  雷神: '雷电将军',
  将军大人: '雷电将军',
  审判官: '那维莱特',
  最高审判官: '那维莱特',
  公爵大人: '莱欧斯利',
};

const VOICE_STYLE_ALIAS_MAP = {
  普通女声: ['芙宁娜', '胡桃', '纳西妲'],
  女声: ['芙宁娜', '胡桃', '纳西妲'],
  少女音: ['芙宁娜', '胡桃', '纳西妲'],
  御姐音: ['雷电将军', '八重神子', '丽莎'],
  普通男声: ['钟离', '那维莱特', '莱欧斯利'],
  男声: ['钟离', '那维莱特', '莱欧斯利'],
  少年音: ['温迪', '魈', '流浪者'],
  成熟男声: ['钟离', '那维莱特', '莱欧斯利'],
};

function findAliasTarget(text) {
  const normalizedText = normalizeModelAlias(text);
  for (const [alias, target] of Object.entries(ROLE_ALIAS_MAP)) {
    if (normalizedText.includes(normalizeModelAlias(alias))) {
      return target;
    }
  }
  return '';
}

function pickStyleMatchedModel(text, models = {}) {
  const entries = Object.keys(models || {});
  if (entries.length === 0) return '';
  const normalizedText = normalizeModelAlias(text);

  for (const [style, candidates] of Object.entries(VOICE_STYLE_ALIAS_MAP)) {
    if (!normalizedText.includes(normalizeModelAlias(style))) continue;
    for (const candidate of candidates) {
      const matched = entries.find(model => normalizeModelAlias(model).includes(normalizeModelAlias(candidate)));
      if (matched) return matched;
    }
  }

  return '';
}

function pickRoleMatchedModel(text, models = {}) {
  const entries = Object.keys(models || {});
  if (entries.length === 0) return '';

  const rawText = String(text || '');
  const normalizedText = normalizeModelAlias(rawText);
  const quotedRole = extractQuotedRoleName(rawText);
  const normalizedQuotedRole = normalizeModelAlias(quotedRole);
  const aliasTarget = findAliasTarget(rawText);
  const normalizedAliasTarget = normalizeModelAlias(aliasTarget);

  if (normalizedAliasTarget) {
    const aliasMatch = entries.find(model => normalizeModelAlias(model).includes(normalizedAliasTarget));
    if (aliasMatch) return aliasMatch;
  }

  if (normalizedQuotedRole) {
    const exactQuoted = entries.find(model => normalizeModelAlias(model).includes(normalizedQuotedRole));
    if (exactQuoted) return exactQuoted;
  }

  const directMatches = entries.filter(model => {
    const normalizedModel = normalizeModelAlias(model);
    return normalizedModel && normalizedText && normalizedText.includes(normalizedModel);
  });
  if (directMatches.length > 0) {
    return directMatches.sort((a, b) => normalizeModelAlias(b).length - normalizeModelAlias(a).length)[0];
  }

  return '';
}

function findLanguageAndEmotion(modelName, requestedLanguage, requestedEmotion, models, defaultLanguage, defaultEmotion) {
  const modelData = models?.[modelName] || {};
  const languages = Object.keys(modelData);
  const language = languages.includes(requestedLanguage)
    ? requestedLanguage
    : languages.includes(defaultLanguage)
      ? defaultLanguage
      : languages[0] || requestedLanguage || defaultLanguage || '中文';

  const emotions = Array.isArray(modelData?.[language]) ? modelData[language] : [];
  const emotion = emotions.includes(requestedEmotion)
    ? requestedEmotion
    : emotions.includes(defaultEmotion)
      ? defaultEmotion
      : emotions[0] || requestedEmotion || defaultEmotion || '默认';

  return { language, emotion, availableEmotions: emotions };
}

async function synthesizeVoice(args = {}, toolCtx = {}) {
  const coreConfig = await ConfigControl.get('coreConfig');
  const ttsConfig = coreConfig?.tools?.tts || {};
  if (!ttsConfig.enabled) {
    return { success: false, error: '内置语音工具未启用' };
  }
  if (!ttsConfig.apiUrl) {
    return { success: false, error: '未配置语音合成接口地址' };
  }

  const text = normalizeString(args.text || '', '').slice(0, normalizeNumber(ttsConfig.maxTextLength, 120));
  const roleHintText = [
    text,
    toolCtx?.targetMessage?.content || '',
    toolCtx?.promptCtx?.targetMessage?.content || '',
  ].filter(Boolean).join('\n');
  if (!text) {
    return { success: false, error: '语音文本不能为空' };
  }

  const autoVoiceCheck = shouldAllowAutoVoice(ttsConfig, text, toolCtx, args);
  if (!autoVoiceCheck.allowed) {
    return { success: false, error: autoVoiceCheck.reason };
  }

  let models = await loadCachedModels();
  if (!models || Object.keys(models).length === 0) {
    const fetched = await fetchTtsModels();
    if (fetched.success) {
      models = fetched.models;
    }
  }

  const roleMatchedModel = !normalizeString(args.model, '') || /^default$/i.test(String(args.model || '').trim())
    ? pickRoleMatchedModel(roleHintText, models)
    : '';
  const styleMatchedModel = roleMatchedModel
    ? ''
    : (!normalizeString(args.model, '') || /^default$/i.test(String(args.model || '').trim()))
      ? pickStyleMatchedModel(roleHintText, models)
      : '';

  const fallbackModel = normalizeString(
    roleMatchedModel || styleMatchedModel || ttsConfig.defaultModel || toolCtx?.defaultVoiceModel || pickFallbackModel(models),
    ''
  );
  const modelName = normalizeModelName(args.model, fallbackModel);
  if (!modelName) {
    return { success: false, error: '未配置默认语音模型' };
  }

  const { language, emotion, availableEmotions } = findLanguageAndEmotion(
    modelName,
    normalizeString(args.language || '', ttsConfig.defaultLanguage || '中文'),
    normalizeString(args.emotion || '', ttsConfig.defaultEmotion || '默认'),
    models,
    ttsConfig.defaultLanguage || '中文',
    ttsConfig.defaultEmotion || '默认'
  );

  const payload = {
    dl_url: normalizeString(args.dl_url || ttsConfig.dlUrl || '', ''),
    version: ttsConfig.version || 'v4',
    model_name: modelName,
    prompt_text_lang: language,
    emotion,
    text,
    text_lang: language,
    top_k: normalizeNumber(args.top_k ?? ttsConfig.topK, 10),
    top_p: normalizeNumber(args.top_p ?? ttsConfig.topP, 1),
    temperature: normalizeNumber(args.temperature ?? ttsConfig.temperature, 1),
    text_split_method: normalizeString(args.text_split_method || ttsConfig.textSplitMethod, '按标点符号切'),
    batch_size: normalizeNumber(args.batch_size ?? ttsConfig.batchSize, 10),
    batch_threshold: normalizeNumber(args.batch_threshold ?? ttsConfig.batchThreshold, 0.75),
    split_bucket: args.split_bucket ?? ttsConfig.splitBucket ?? false,
    speed_facter: normalizeNumber(args.speed_facter ?? ttsConfig.speed, 1),
    fragment_interval: normalizeNumber(args.fragment_interval ?? ttsConfig.fragmentInterval, 0.3),
    media_type: normalizeString(args.media_type || ttsConfig.mediaType, 'wav'),
    parallel_infer: args.parallel_infer ?? ttsConfig.parallelInfer ?? false,
    repetition_penalty: normalizeNumber(args.repetition_penalty ?? ttsConfig.repetitionPenalty, 1.35),
    seed: normalizeNumber(args.seed ?? ttsConfig.seed, -1),
    sample_steps: normalizeNumber(args.sample_steps ?? ttsConfig.sampleSteps, 16),
    if_sr: args.if_sr ?? false,
  };

  const startedAt = Date.now();
  await appendTtsDebugLog({
    stage: 'start',
    model: modelName,
    language,
    emotion,
    dl_url: payload.dl_url,
    text: sanitizeText(text, 180),
  });

  try {
    const response = await axios.post(ttsConfig.apiUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    });
    const data = response.data || {};
    if (data.msg === '合成成功' && data.audio_url) {
      const normalizedAudioUrl = normalizeAudioUrl(data.audio_url, payload.dl_url);
      logger.info(`[ttsRegistry] 合成成功: ${modelName} => ${normalizedAudioUrl}`);
      await appendTtsDebugLog({
        stage: 'success',
        model: modelName,
        language,
        emotion,
        elapsed_ms: Date.now() - startedAt,
        audio_url: normalizedAudioUrl,
        raw_audio_url: data.audio_url,
      });

      if (toolCtx?.event && toolCtx?.groupId && ttsConfig.autoSendVoice) {
        if (!toolCtx.voiceMessages) {
          toolCtx.voiceMessages = [];
        }
        toolCtx.voiceMessages.push({
          type: 'voice',
          audioUrl: normalizedAudioUrl,
          text,
          model: modelName,
          language,
          emotion,
        });
      }

      return {
        success: true,
        model: modelName,
        language,
        emotion,
        availableEmotions,
        audioUrl: normalizedAudioUrl,
        voiceMessage: {
          type: 'voice',
          audioUrl: normalizedAudioUrl,
          text,
          model: modelName,
          language,
          emotion,
        },
      };
    }

    await appendTtsDebugLog({
      stage: 'failure',
      model: modelName,
      language,
      emotion,
      elapsed_ms: Date.now() - startedAt,
      response: data,
    });
    logger.warn(`[ttsRegistry] 合成失败: ${modelName} => ${JSON.stringify(data)}`);
    return {
      success: false,
      error: data.msg || '语音合成失败',
    };
  } catch (error) {
    await appendTtsDebugLog({
      stage: 'failure',
      model: modelName,
      language,
      emotion,
      elapsed_ms: Date.now() - startedAt,
      error: error.message,
    });
    logger.error(`[ttsRegistry] 请求异常: ${modelName} => ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

export function getTtsModelSummarySync() {
  const models = loadCachedModelsSync();
  const entries = Object.entries(models);
  const lines = entries.map(([model, langs]) => {
    const firstLanguage = Object.keys(langs || {})[0] || '未知';
    const emotions = Array.isArray(langs?.[firstLanguage]) ? langs[firstLanguage] : [];
    return `${model} => ${firstLanguage}: ${emotions.join('、') || '默认'}`;
  });

  if (lines.length === 0) {
    return '暂无语音模型信息';
  }

  return [`共 ${entries.length} 个模型`, ...lines].join('\n');
}

export async function refreshTtsModelsAndGetSummary() {
  const fetched = await fetchTtsModels();
  if (!fetched.success) {
    return {
      success: false,
      error: fetched.error,
      summary: getTtsModelSummarySync(),
    };
  }

  return {
    success: true,
    summary: getTtsModelSummarySync(),
    count: fetched.count,
  };
}

async function listTtsModels() {
  const coreConfig = await ConfigControl.get('coreConfig');
  const ttsConfig = coreConfig?.tools?.tts || {};
  if (!ttsConfig.enabled) {
    return { success: false, error: '内置语音工具未启用' };
  }

  let models = await loadCachedModels();
  if (!models || Object.keys(models).length === 0) {
    const fetched = await fetchTtsModels();
    if (fetched.success) {
      models = fetched.models;
    }
  }

  const entries = Object.entries(models || {});
  if (entries.length === 0) {
    return { success: false, error: '暂无可用语音模型信息' };
  }

  const items = entries.slice(0, 100).map(([model, langs]) => ({
    model,
    languages: Object.entries(langs || {}).map(([language, emotions]) => ({
      language,
      emotions: Array.isArray(emotions) ? emotions : [],
    })),
  }));

  return {
    success: true,
    count: entries.length,
    defaultModel: normalizeString(ttsConfig.defaultModel, ''),
    summary: getTtsModelSummarySync(),
    models: items,
  };
}

export function getTtsTools() {
  return [
    {
      name: 'list_tts_models',
      description: '读取当前可用的语音角色列表、支持语言与情感。在调用 speak_text 前，若不确定可用角色，应先使用这个工具。',
      parameters: {
        type: 'object',
        properties: {},
      },
      returnToAI: true,
      stopOnFailure: false,
      handler: listTtsModels,
    },
    {
      name: 'speak_text',
      description: '使用内置语音合成工具，将文本转换成语音。在需要朗读、配音或发送语音时使用。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '需要合成的文本内容' },
          model: { type: 'string', description: '语音模型名称，可选' },
          language: { type: 'string', description: '语言，例如 中文、日语' },
          emotion: { type: 'string', description: '情感，例如 默认、开心、生气' },
        },
        required: ['text'],
      },
      returnToAI: false,
      stopOnFailure: true,
      handler: synthesizeVoice,
    },
  ];
}

export { fetchTtsModels };
