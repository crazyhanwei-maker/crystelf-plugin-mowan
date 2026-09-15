import path from 'path';
import fs from 'fs/promises';
import Meme from '../core/meme.js';
import { createQqSimulatorScenarioStore } from './qqSimulatorScenarioStore.js';
import { createQqSimulatorCommandRegistry } from './qqSimulatorCommandRegistry.js';

export function createQqSimulatorConsole(options = {}) {
  const commandRegistry = createQqSimulatorCommandRegistry({ logger: options.logger || console });
  const ConfigControl = options.ConfigControl || options.configControl || { get: () => ({}) };
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode = 500, message = 'Internal Server Error', code = '') => {
        const error = new Error(String(message || 'Internal Server Error'));
        error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
        if (code) error.code = String(code);
        return error;
      });
  const isPlainObject = typeof options.isPlainObject === 'function'
    ? options.isPlainObject
    : (value => Boolean(value && typeof value === 'object' && !Array.isArray(value)));
  const normalizeGroupIdValue = typeof options.normalizeGroupIdValue === 'function'
    ? options.normalizeGroupIdValue
    : (value => /^\d{5,20}$/.test(String(value ?? '').trim()) ? String(value ?? '').trim() : '');
  const normalizeGroupIdList = typeof options.normalizeGroupIdList === 'function'
    ? options.normalizeGroupIdList
    : (value => (Array.isArray(value) ? Array.from(new Set(value.map(normalizeGroupIdValue).filter(Boolean))) : []));
  const readBoolean = typeof options.readBoolean === 'function'
    ? options.readBoolean
    : ((value, fallback = false) => {
        if (value === true || value === 'true' || value === 1 || value === '1') return true;
        if (value === false || value === 'false' || value === 0 || value === '0') return false;
        return fallback;
      });
  const sanitizeSandboxHistory = typeof options.sanitizeSandboxHistory === 'function'
    ? options.sanitizeSandboxHistory
    : (history => (Array.isArray(history) ? history : []));
  const normalizeSandboxImageUrls = typeof options.normalizeSandboxImageUrls === 'function'
    ? options.normalizeSandboxImageUrls
    : (value => (Array.isArray(value) ? value : [value]).map(item => String(item || '').trim()).filter(Boolean));
  const getDataUrlMediaType = typeof options.getDataUrlMediaType === 'function'
    ? options.getDataUrlMediaType
    : (value => (String(value || '').match(/^data:([^;,]+)[;,]/i)?.[1] || '').toLowerCase());
  const normalizeDataUrlAttachment = typeof options.normalizeDataUrlAttachment === 'function'
    ? options.normalizeDataUrlAttachment
    : (value => String(value || '').trim());
  const estimateDataUrlBytes = typeof options.estimateDataUrlBytes === 'function'
    ? options.estimateDataUrlBytes
    : (value => Buffer.byteLength(String(value || ''), 'utf8'));
  const redactQqSimulatorMediaUrl = typeof options.redactQqSimulatorMediaUrl === 'function'
    ? options.redactQqSimulatorMediaUrl
    : (value => String(value || '').trim());
  const findGroupManagementLogEntry = typeof options.findGroupManagementLogEntry === 'function'
    ? options.findGroupManagementLogEntry
    : (() => null);
  const getGroupModerationState = typeof options.getGroupModerationState === 'function'
    ? options.getGroupModerationState
    : (() => ({}));
  const normalizeGroupContentModerationConfig = typeof options.normalizeGroupContentModerationConfig === 'function'
    ? options.normalizeGroupContentModerationConfig
    : (value => value || {});
  const getJoinRequestAutoApproveConfig = typeof options.getJoinRequestAutoApproveConfig === 'function'
    ? options.getJoinRequestAutoApproveConfig
    : (() => ({ enable: false }));
  const evaluateJoinRequestAutoApprove = typeof options.evaluateJoinRequestAutoApprove === 'function'
    ? options.evaluateJoinRequestAutoApprove
    : (() => ({ passed: false, reason: 'auto approve unavailable', risk: null }));
  const getGroupMemberModeration = typeof options.getGroupMemberModeration === 'function'
    ? options.getGroupMemberModeration
    : (() => ({}));
  const getGroupManagementDefaultAuthConfig = typeof options.getGroupManagementDefaultAuthConfig === 'function'
    ? options.getGroupManagementDefaultAuthConfig
    : (() => ({}));
  const normalizeAuthGroupConfig = typeof options.normalizeAuthGroupConfig === 'function'
    ? options.normalizeAuthGroupConfig
    : ((value, fallback = {}) => ({ ...(fallback || {}), ...(value || {}) }));
  const runSandboxChat = typeof options.runSandboxChat === 'function'
    ? options.runSandboxChat
    : (async () => ({ success: false, reply: '' }));
  const createImageProcessor = typeof options.createImageProcessor === 'function'
    ? options.createImageProcessor
    : async () => {
        const { ImageProcessor } = await import('../ai/imageProcessor.js');
        return new ImageProcessor();
      };
  const QQ_SIMULATOR_VOICE_DATA_MAX_BYTES = Math.max(1, Number(options.voiceDataMaxBytes || 3 * 1024 * 1024) || (3 * 1024 * 1024));
  const QQ_SIMULATOR_ADAPTER_FORMATS = new Set(Array.isArray(options.adapterFormats) && options.adapterFormats.length > 0
    ? options.adapterFormats
    : ['onebot', 'icqq', 'go-cqhttp', 'napcat']);
  const QQ_SIMULATOR_GROUP_HISTORY_LIMIT = Math.max(1, Number(options.groupHistoryLimit || 30) || 30);
  const QQ_SIMULATOR_GROUP_HISTORY_TEXT_LIMIT = Math.max(1, Number(options.groupHistoryTextLimit || 600) || 600);
  const QQ_SIMULATOR_EVENT_TYPES = new Set(['message', 'private_message', 'join_request', 'group_increase', 'poke']);

  function isQqSimulatorMessageEvent(eventType = '') {
    return eventType === 'message' || eventType === 'private_message';
  }

  function isQqSimulatorPrivateMessageEvent(eventType = '') {
    return eventType === 'private_message';
  }

  function normalizePrivateAiAccessList(value = []) {
    const items = Array.isArray(value)
      ? value
      : String(value || '').split(/\r?\n|[,，;；\s]+/);
    return Array.from(new Set(items
      .map(item => String(item || '').trim())
      .filter(item => /^[1-9]\d{4,12}$/.test(item))));
  }

  function getQqSimulatorPrivateAccessDecision(mainConfig = {}, payload = {}) {
    if (payload.isMaster === true) {
      return { allow: true, reason: '主人身份绕过私聊名单限制' };
    }
    const userId = String(payload.userId || '').trim();
    const blacklist = normalizePrivateAiAccessList(mainConfig.privateAiBlacklist);
    if (blacklist.includes(userId)) {
      return { allow: false, reason: '命中私聊 AI 手动黑名单' };
    }
    const whitelist = normalizePrivateAiAccessList(mainConfig.privateAiWhitelist);
    if (whitelist.length > 0 && !whitelist.includes(userId)) {
      return { allow: false, reason: '不在私聊 AI 白名单' };
    }
    return { allow: true, reason: whitelist.length > 0 ? '命中私聊 AI 白名单' : '未配置私聊白名单限制' };
  }

  function collectQqSimulatorImageInputs(source = {}) {
    const inputs = [];
    const append = value => {
      if (Array.isArray(value)) {
        value.forEach(append);
        return;
      }
      if (isPlainObject(value)) {
        append(value.dataUrl || value.url || value.imageUrl || '');
        return;
      }
      const text = String(value || '').trim();
      if (text) inputs.push(text);
    };
    append(source.images);
    append(source.imageUrls);
    append(source.screenshots);
    append(source.imageAttachments);
    return inputs;
  }
  
  function normalizeQqSimulatorVoice(source = {}, fallbackTranscript = '') {
    const voice = isPlainObject(source) ? source : {};
    const transcript = String(voice.transcript ?? fallbackTranscript ?? '').trim().slice(0, 2000);
    const rawDataUrl = String(voice.dataUrl || voice.url || '').trim();
    const name = String(voice.name || 'voice-message').trim().slice(0, 120) || 'voice-message';
    const mimeType = String(voice.mimeType || voice.type || getDataUrlMediaType(rawDataUrl) || 'audio/*').trim().slice(0, 80);
    const declaredSize = Math.max(0, Number(voice.sizeBytes || voice.size || 0) || 0);
    if (!rawDataUrl && !transcript && !String(voice.name || '').trim()) {
      return null;
    }
    const dataUrl = rawDataUrl
      ? normalizeDataUrlAttachment(rawDataUrl, {
          label: '语音附件',
          allowedPattern: /^audio\//i,
          maxBytes: QQ_SIMULATOR_VOICE_DATA_MAX_BYTES,
          code: 'QQ_SIMULATOR_VOICE_INVALID',
        })
      : '';
    const sizeBytes = dataUrl ? estimateDataUrlBytes(dataUrl) : declaredSize;
    return {
      name,
      mimeType,
      sizeBytes,
      durationSeconds: Math.max(0, Number(voice.durationSeconds || voice.duration || 0) || 0),
      transcript,
      dataUrl,
    };
  }
  
  function normalizeNullableInteger(value, min = 0, max = 1000) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }
  
  function normalizeQqSimulatorApplicant(source = {}) {
    const root = isPlainObject(source) ? source : {};
    const applicant = isPlainObject(root.applicant)
      ? root.applicant
      : isPlainObject(root.applicantProfile)
        ? root.applicantProfile
        : {};
    const listStatus = String(applicant.listStatus ?? root.listStatus ?? 'normal').trim().toLowerCase();
    return {
      qqLevel: normalizeNullableInteger(applicant.qqLevel ?? root.qqLevel ?? root.level, 0, 255),
      age: normalizeNullableInteger(applicant.age ?? root.age, 0, 150),
      sex: String(applicant.sex ?? root.sex ?? '').trim().slice(0, 20),
      warningCount: normalizeNullableInteger(applicant.warningCount ?? root.warningCount, 0, 100),
      listStatus: ['normal', 'whitelist', 'blacklist'].includes(listStatus) ? listStatus : 'normal',
    };
  }
  
  function normalizeQqSimulatorRole(value = '', fallback = 'member') {
    const role = String(value || fallback || 'member').trim().toLowerCase();
    return ['owner', 'admin', 'member'].includes(role) ? role : fallback;
  }
  
  function normalizeQqSimulatorDispatchMode(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return ['replay', 'live-image'].includes(normalized) ? normalized : 'safe';
  }
  
  function normalizeQqSimulatorAdapterFormat(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return QQ_SIMULATOR_ADAPTER_FORMATS.has(normalized) ? normalized : 'onebot';
  }
  
  function normalizeQqSimulatorHistoryType(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return ['text', 'image', 'record', 'at', 'reply'].includes(normalized) ? normalized : 'text';
  }
  
  function normalizeQqSimulatorGroupHistory(source = []) {
    const rawItems = Array.isArray(source)
      ? source
      : String(source || '')
        .split(/\r?\n/)
        .map((line, index) => {
          const parts = line.split('|');
          if (parts.length >= 4) {
            return {
              nickname: parts[0],
              userId: parts[1],
              type: parts[2],
              content: parts.slice(3).join('|'),
              messageId: 900000 + index + 1,
            };
          }
          return {
            nickname: `成员${index + 1}`,
            userId: `2000${index + 1}`,
            type: 'text',
            content: line,
            messageId: 900000 + index + 1,
          };
        });
    return rawItems
      .map((item, index) => {
        if (!isPlainObject(item)) return null;
        const content = String(item.content ?? item.text ?? item.message ?? item.raw_message ?? '').trim();
        if (!content) return null;
        const messageId = normalizeNullableInteger(
          item.messageId ?? item.message_id ?? item.seq ?? item.messageSeq,
          1,
          Number.MAX_SAFE_INTEGER
        ) || (900000 + index + 1);
        return {
          nickname: String(item.nickname || item.senderName || item.card || item.name || `成员${index + 1}`).trim().slice(0, 80) || `成员${index + 1}`,
          userId: normalizeGroupIdValue(item.userId ?? item.user_id ?? item.qq) || String(item.userId ?? item.user_id ?? item.qq ?? `2000${index + 1}`).trim().slice(0, 24),
          type: normalizeQqSimulatorHistoryType(item.type || item.messageType || item.message_type),
          content: content.slice(0, QQ_SIMULATOR_GROUP_HISTORY_TEXT_LIMIT),
          messageId,
          time: normalizeNullableInteger(item.time ?? item.timestamp, 0, Number.MAX_SAFE_INTEGER) || Math.floor(Date.now() / 1000) - Math.max(1, rawItems.length - index),
        };
      })
      .filter(Boolean)
      .slice(-QQ_SIMULATOR_GROUP_HISTORY_LIMIT);
  }
  
  function redactQqSimulatorVoice(voice = null) {
    if (!voice) return null;
    return {
      name: voice.name,
      mimeType: voice.mimeType,
      sizeBytes: voice.sizeBytes,
      durationSeconds: voice.durationSeconds,
      hasTranscript: Boolean(voice.transcript),
      dataUrl: voice.dataUrl ? redactQqSimulatorMediaUrl(voice.dataUrl) : '',
    };
  }
  
  function redactQqSimulatorPayload(payload = {}) {
    return {
      ...payload,
      images: (payload.images || []).map(redactQqSimulatorMediaUrl),
      voice: redactQqSimulatorVoice(payload.voice),
      history: Array.isArray(payload.history) ? payload.history.slice(-5) : [],
      groupHistory: Array.isArray(payload.groupHistory)
        ? payload.groupHistory.slice(-5).map(item => ({
            ...item,
            content: item.type === 'image' || item.type === 'record'
              ? redactQqSimulatorMediaUrl(item.content)
              : item.content,
          }))
        : [],
    };
  }
  
  function formatQqSimulatorGroupHistoryLine(item = {}) {
    const content = item.type === 'image'
      ? '[图片]'
      : item.type === 'record'
        ? '[语音]'
        : item.type === 'at'
          ? `@${item.content}`
          : item.type === 'reply'
            ? `[回复消息 ${item.content}]`
            : item.content;
    return `[${item.nickname},id:${item.userId},seq:${item.messageId}]之前说过:${content}`;
  }
  
  function buildQqSimulatorAiPrompt(payload = {}) {
    const parts = [];
    if (isQqSimulatorPrivateMessageEvent(payload.eventType)) {
      parts.push('当前是用户私聊机器人，不携带群号、群成员身份或群聊历史。');
    }
    if (Array.isArray(payload.groupHistory) && payload.groupHistory.length > 0) {
      parts.push([
        `以下是本群最近 ${payload.groupHistory.length} 条历史消息，可作为上下文参考：`,
        ...payload.groupHistory.slice(-12).map(formatQqSimulatorGroupHistoryLine),
      ].join('\n'));
    }
    if (payload.messageText) {
      parts.push(payload.messageText);
    }
    if (payload.voice) {
      if (payload.voice.transcript) {
        parts.push(`用户发送了一条语音消息，模拟调试提供的语音转写如下：${payload.voice.transcript}`);
      } else {
        parts.push(`用户发送了一条语音消息，但模拟调试没有语音转写。语音文件：${payload.voice.name || 'voice-message'}，类型：${payload.voice.mimeType || 'audio/*'}。`);
      }
    }
    if (payload.images.length > 0) {
      parts.push(`用户同时发送了 ${payload.images.length} 张图片或截图，请结合图片内容回复。`);
    }
    return parts.join('\n\n').trim() || '用户发送了一条消息。';
  }
  
  function normalizeQqSimulatorPayload(payload = {}) {
    const source = isPlainObject(payload) ? payload : {};
    const eventType = String(source.eventType || 'message').trim();
    if (!QQ_SIMULATOR_EVENT_TYPES.has(eventType)) {
      throw createHttpError(400, '事件类型不正确', 'QQ_SIMULATOR_EVENT_INVALID');
    }
    const privateMessage = isQqSimulatorPrivateMessageEvent(eventType);
    const groupId = privateMessage ? '' : normalizeGroupIdValue(source.groupId);
    const userId = normalizeGroupIdValue(source.userId);
    if (!privateMessage && !groupId) {
      throw createHttpError(400, 'groupId 必须是 5-20 位数字', 'QQ_SIMULATOR_GROUP_INVALID');
    }
    if (!userId) {
      throw createHttpError(400, 'userId 必须是 5-20 位数字', 'QQ_SIMULATOR_USER_INVALID');
    }
    const normalizedRole = normalizeQqSimulatorRole(source.role, 'member');
    const botRole = normalizeQqSimulatorRole(source.botRole || source.bot_role, 'member');
    const images = normalizeSandboxImageUrls(collectQqSimulatorImageInputs(source));
    const voice = normalizeQqSimulatorVoice(source.voice, source.voiceTranscript);
    const messageText = String(source.messageText || '').trim().slice(0, 4000);
    const applicant = normalizeQqSimulatorApplicant(source);
    const dispatchMode = normalizeQqSimulatorDispatchMode(source.dispatchMode || source.dispatch_mode);
    const adapterFormat = normalizeQqSimulatorAdapterFormat(source.adapterFormat || source.adapter_format);
    const groupHistory = privateMessage ? [] : normalizeQqSimulatorGroupHistory(source.groupHistory || source.group_history);
    if (isQqSimulatorMessageEvent(eventType) && !messageText && images.length === 0 && !voice) {
      throw createHttpError(400, '消息事件至少需要 messageText、图片或语音', 'QQ_SIMULATOR_MESSAGE_EMPTY');
    }
    return {
      eventType,
      groupId,
      userId,
      nickname: String(source.nickname || `QQ${userId}`).trim().slice(0, 80) || `QQ${userId}`,
      role: normalizedRole,
      botRole,
      adapterFormat,
      isMaster: readBoolean(source.isMaster, false),
      includeAt: readBoolean(source.includeAt, eventType === 'message'),
      dispatchMode,
      confirmLiveImage: readBoolean(source.confirmLiveImage, false),
      messageText,
      images,
      voice,
      applicant,
      groupHistory,
      history: readBoolean(source.conversationMode, true) ? sanitizeSandboxHistory(source.history) : [],
      conversationMode: readBoolean(source.conversationMode, true),
      comment: String(source.comment || '').trim().slice(0, 500),
    };
  }
  
  function normalizeQqSimulatorScenarioPayload(payload = {}) {
    const source = isPlainObject(payload) ? payload : {};
    const eventType = String(source.eventType || 'message').trim();
    const applicant = isPlainObject(source.applicant) ? source.applicant : {};
    const normalizedEventType = QQ_SIMULATOR_EVENT_TYPES.has(eventType)
      ? eventType
      : 'message';
    const privateMessage = isQqSimulatorPrivateMessageEvent(normalizedEventType);
    return {
      eventType: normalizedEventType,
      groupId: privateMessage ? '' : (normalizeGroupIdValue(source.groupId) || String(source.groupId || '').trim().slice(0, 20)),
      userId: normalizeGroupIdValue(source.userId) || String(source.userId || '').trim().slice(0, 20),
      nickname: String(source.nickname || '').trim().slice(0, 80),
      role: normalizeQqSimulatorRole(source.role, 'member'),
      botRole: normalizeQqSimulatorRole(source.botRole || source.bot_role, 'member'),
      adapterFormat: normalizeQqSimulatorAdapterFormat(source.adapterFormat || source.adapter_format),
      isMaster: readBoolean(source.isMaster, false),
      messageText: String(source.messageText || '').trim().slice(0, 4000),
      includeAt: readBoolean(source.includeAt, normalizedEventType === 'message'),
      dispatchMode: normalizeQqSimulatorDispatchMode(source.dispatchMode || source.dispatch_mode),
      conversationMode: readBoolean(source.conversationMode, true),
      history: [],
      groupHistory: privateMessage ? [] : normalizeQqSimulatorGroupHistory(source.groupHistory || source.group_history),
      images: normalizeSandboxImageUrls(collectQqSimulatorImageInputs(source)).slice(0, 20),
      screenshots: [],
      voice: null,
      voiceTranscript: String(source.voiceTranscript || source.voice?.transcript || '').trim().slice(0, 2000),
      applicant: {
        qqLevel: normalizeNullableInteger(applicant.qqLevel ?? source.qqLevel ?? source.level, 0, 255),
        age: normalizeNullableInteger(applicant.age ?? source.age, 0, 150),
        sex: String(applicant.sex ?? source.sex ?? '').trim().slice(0, 20),
        warningCount: normalizeNullableInteger(applicant.warningCount ?? source.warningCount, 0, 100),
        listStatus: ['normal', 'whitelist', 'blacklist'].includes(String(applicant.listStatus || source.listStatus || '').trim())
          ? String(applicant.listStatus || source.listStatus).trim()
          : 'normal',
      },
      comment: String(source.comment || '').trim().slice(0, 500),
    };
  }
  
  const qqSimulatorScenarioStore = createQqSimulatorScenarioStore({
    normalizeScenarioPayload: normalizeQqSimulatorScenarioPayload,
    createHttpError,
  });
  
  const {
    normalizeItem: normalizeQqSimulatorScenarioItem,
    listPayload: listQqSimulatorScenariosPayload,
    backupListPayload: buildQqSimulatorScenarioBackupListPayload,
    savePayload: saveQqSimulatorScenarioPayload,
    deletePayload: deleteQqSimulatorScenarioPayload,
    clearPayload: clearQqSimulatorScenariosPayload,
    importPayload: importQqSimulatorScenariosPayload,
    restorePayload: restoreQqSimulatorScenarioBackupPayload,
    enqueueTask: enqueueQqSimulatorScenarioTask,
  } = qqSimulatorScenarioStore;
  function buildQqSimulatorScenarioFromGroupLog(entry = {}) {
    const action = String(entry.action || '').trim();
    const summary = isPlainObject(entry.summary) ? entry.summary : {};
    const groupId = normalizeGroupIdValue(entry.group_id || entry.groupId) || String(entry.group_id || entry.groupId || '').trim();
    const userId = normalizeGroupIdValue(entry.user_id || entry.userId) || String(entry.user_id || entry.userId || '20001').trim();
    const nickname = String(entry.nickname || summary.nickname || '日志用户').trim();
    let eventType = 'message';
    let messageText = String(entry.text_preview || summary.textPreview || summary.messageText || summary.message || '').trim();
    let comment = String(entry.comment_preview || entry.reason || entry.error || '').trim();
    const applicant = {};
  
    if (action.startsWith('join_request')) {
      eventType = 'join_request';
      messageText = '';
      comment = comment || '模拟加群申请理由';
      applicant.qqLevel = normalizeNullableInteger(summary.qqLevel ?? summary.level, 0, 255);
      applicant.age = normalizeNullableInteger(summary.age, 0, 150);
      applicant.warningCount = normalizeNullableInteger(summary.warningCount, 0, 100);
      applicant.listStatus = action.includes('blacklist') ? 'blacklist' : action.includes('whitelist') ? 'whitelist' : 'normal';
    } else if (action.startsWith('group_welcome')) {
      eventType = 'group_increase';
      messageText = '';
      comment = comment || '由入群欢迎日志生成的新成员入群场景';
    } else if (action.startsWith('daily_group_summary')) {
      messageText = '#群总结';
      comment = comment || '由群总结日志生成的手动总结场景';
    } else if (action.startsWith('group_title')) {
      const title = String(summary.title || summary.requestedTitle || entry.title || '').trim();
      messageText = action.includes('application_created')
        ? `#申请头衔 ${title || '测试头衔'}`
        : '#头衔申请列表';
      comment = comment || '由群头衔日志生成的头衔调试场景';
    } else if (action.startsWith('content_moderation')) {
      messageText = messageText || String(entry.reason || '测试风控消息').trim();
      comment = comment || '由群消息风控日志生成的消息场景';
    } else if (!messageText) {
      messageText = '#灵晶帮助';
      comment = comment || '由群管理日志生成的通用调试场景';
    }
  
    const payload = normalizeQqSimulatorScenarioPayload({
      eventType,
      groupId,
      userId,
      nickname,
      role: 'member',
      botRole: 'admin',
      adapterFormat: 'onebot',
      includeAt: eventType === 'message' && !/^#/.test(messageText),
      dispatchMode: 'safe',
      conversationMode: true,
      messageText,
      applicant,
      comment: [
        `群管理日志转换：${entry.action_label || action || '未知操作'}`,
        comment,
      ].filter(Boolean).join(' / '),
    });
    const logTime = new Date(entry.time || 0);
    const timeText = Number.isNaN(logTime.getTime()) ? '' : logTime.toISOString().slice(0, 19).replace('T', ' ');
    const shortId = String(entry.id || '').trim().slice(-8);
    return normalizeQqSimulatorScenarioItem({
      name: [
        '日志复现',
        entry.action_label || action || '群管理',
        `群${payload.groupId || '未填'}`,
        timeText,
        shortId,
      ].filter(Boolean).join(' · '),
      payload,
      source: 'group-management-log',
    });
  }
  
  function convertGroupManagementLogToScenarioPayload(body = {}) {
    const entry = findGroupManagementLogEntry(body.id) || (isPlainObject(body.entry) ? body.entry : null);
    if (!entry) {
      throw createHttpError(404, '群管理日志不存在或已不在可读取范围内', 'GROUP_LOG_NOT_FOUND');
    }
    const scenario = buildQqSimulatorScenarioFromGroupLog(entry);
    if (body.save === true) {
      const saved = saveQqSimulatorScenarioPayload({ scenario });
      return {
        success: true,
        saved: true,
        scenario: saved.scenario || scenario,
        scenarios: saved.scenarios || [],
        message: '已将群管理日志保存为模拟场景',
      };
    }
    return {
      success: true,
      saved: false,
      scenario,
    };
  }
  
  function createQqSimulatorContext(payload = {}) {
    const allConfigs = ConfigControl.get() || {};
    const botId = String(globalThis.Bot?.uin || globalThis.Bot?.self_id || '10000');
    const botName = String(allConfigs.profile?.nickName || allConfigs.profile?.nickname || 'Bot').trim() || 'Bot';
    return {
      allConfigs,
      botId,
      botName,
      replies: [],
      actions: [],
      logs: [],
      errors: [],
      timeline: [],
      voiceMessages: [],
      debug: {
        safeMode: payload.dispatchMode !== 'live-image',
        note: payload.dispatchMode === 'live-image'
          ? 'QQ simulator may call the configured image API for image edit commands, but does not send real group messages or execute QQ group operations.'
          : 'QQ simulator does not send real group messages or execute destructive QQ operations.',
        payload: redactQqSimulatorPayload(payload),
        adapterFormat: payload.adapterFormat || 'onebot',
        bot: { id: botId, name: botName, role: payload.botRole || 'member' },
      },
    };
  }
  
  function pushQqSimulatorTimeline(ctx, stage = '', status = 'info', detail = {}) {
    ctx.timeline.push({
      index: ctx.timeline.length + 1,
      stage: String(stage || '').trim() || '未命名阶段',
      status: String(status || 'info').trim() || 'info',
      ...detail,
    });
  }
  
  function pushQqSimulatorLog(ctx, level = 'info', message = '', extra = {}) {
    ctx.logs.push({
      level,
      message: String(message || '').trim(),
      ...extra,
    });
    pushQqSimulatorTimeline(ctx, `日志: ${message || level}`, level, extra);
  }
  
  function pushQqSimulatorAction(ctx, type = '', label = '', detail = {}) {
    ctx.actions.push({
      type: String(type || 'simulated_action').trim(),
      label: String(label || '').trim(),
      mode: 'safe_simulation',
      ...detail,
    });
    pushQqSimulatorTimeline(ctx, label || type || '模拟动作', 'action', {
      type: String(type || 'simulated_action').trim(),
      ...detail,
    });
  }
  
  function isQqSimulatorManager(payload = {}) {
    return payload.isMaster === true || payload.role === 'owner' || payload.role === 'admin';
  }
  
  function isQqSimulatorBotManager(payload = {}) {
    return payload.botRole === 'owner' || payload.botRole === 'admin';
  }
  
  function isQqSimulatorBotOwner(payload = {}) {
    return payload.botRole === 'owner';
  }
  
  function pushQqSimulatorBotPermissionIssue(ctx, payload = {}, action = '', required = 'admin') {
    const ok = required === 'owner' ? isQqSimulatorBotOwner(payload) : isQqSimulatorBotManager(payload);
    if (ok) return false;
    const message = required === 'owner'
      ? `Bot 当前是 ${payload.botRole || 'member'}，真实环境无法执行 ${action}，需要 Bot 是群主。`
      : `Bot 当前是 ${payload.botRole || 'member'}，真实环境无法执行 ${action}，需要 Bot 是管理员或群主。`;
    pushQqSimulatorAction(ctx, 'bot_permission_blocked', message, {
      action,
      requiredBotRole: required,
      botRole: payload.botRole || 'member',
    });
    return true;
  }
  
  function toQqSimulatorAdapterId(value = '') {
    const text = String(value || '').trim();
    if (/^\d{1,15}$/.test(text)) return Number(text);
    return text;
  }
  
  function buildQqSimulatorMessageId(payload = {}) {
    const seed = `${payload.eventType || 'event'}:${payload.groupId || ''}:${payload.userId || ''}:${payload.messageText || payload.comment || ''}`;
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = ((hash << 5) - hash + seed.charCodeAt(index)) >>> 0;
    }
    return 100000 + (hash % 900000);
  }
  
  function encodeQqSimulatorCqValue(value = '') {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/\[/g, '&#91;')
      .replace(/\]/g, '&#93;')
      .replace(/,/g, '&#44;');
  }
  
  function decodeQqSimulatorCqValue(value = '') {
    return String(value || '')
      .replace(/&#44;/g, ',')
      .replace(/&#91;/g, '[')
      .replace(/&#93;/g, ']')
      .replace(/&amp;/g, '&');
  }
  
  function parseQqSimulatorCqParams(raw = '') {
    const params = {};
    String(raw || '')
      .replace(/^,/, '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => {
        const index = item.indexOf('=');
        if (index <= 0) return;
        const key = item.slice(0, index).trim();
        const value = item.slice(index + 1);
        params[key] = decodeQqSimulatorCqValue(value);
      });
    return params;
  }
  
  function normalizeQqSimulatorCqSegment(token = '') {
    const control = String(token || '');
    const atMarker = control.match(/^\[\[\[at:(\d+)\]\]\]$/i)
      || control.match(/^\(\(\(at:(\d+)\)\)\)$/i)
      || control.match(/^\(\(\((\d+)\)\)\)$/);
    if (atMarker) {
      return [{ type: 'at', qq: String(atMarker[1] || '').trim() }];
    }
    const pokeMarker = control.match(/^\[\[\[poke:(\d+)\]\]\]$/i)
      || control.match(/^\(\(\(poke:(\d+)\)\)\)$/i);
    if (pokeMarker) {
      const qq = String(pokeMarker[1] || '').trim();
      return [{ type: 'poke', qq, id: qq }];
    }
    const replyMarker = control.match(/^\[\[\[reply:([^\]]+)\]\]\]$/i)
      || control.match(/^\(\(\(reply:([^)]+)\)\)\)$/i);
    if (replyMarker) {
      return [{ type: 'reply', id: String(replyMarker[1] || '').trim() }];
    }
    const memoryMarker = control.match(/^\[\[\[memory:([^:]+):([^:]+):(\d+)\]\]\]$/i);
    if (memoryMarker) {
      return [{
        type: 'memory',
        data: String(memoryMarker[1] || '').trim(),
        key: String(memoryMarker[2] || '').split(',').map(item => item.trim()).filter(Boolean),
        timeout: Number(memoryMarker[3] || 0) || 0,
      }];
    }
    const cq = String(token || '').match(/^\[CQ:([a-zA-Z0-9_-]+)([\s\S]*)\]$/);
    if (cq) {
      const type = cq[1].toLowerCase();
      const data = parseQqSimulatorCqParams(cq[2]);
      if (type === 'at') return [{ type: 'at', qq: String(data.qq || '').trim() }];
      if (type === 'image') {
        const source = String(data.url || data.file || '').trim();
        return [{ type: 'image', url: source, file: source }];
      }
      if (type === 'record' || type === 'voice' || type === 'audio') {
        const source = String(data.url || data.file || '').trim();
        return [{ type: 'record', url: source, file: source }];
      }
      if (type === 'face') return [{ type: 'face', id: String(data.id || '').trim() }];
      if (type === 'reply') return [{ type: 'reply', id: String(data.id || data.message_id || '').trim() }];
      if (type === 'poke') {
        const qq = String(data.qq || data.id || '').trim();
        return [{ type: 'poke', qq, id: qq }];
      }
      return [{ type: 'cq', cqType: type, data }];
    }
    const meme = String(token || '').match(/^\[meme:([^:\]]+)(?::([^\]]+))?\]$/);
    if (meme) {
      return [{
        type: 'meme',
        character: decodeQqSimulatorCqValue(meme[1]),
        emotion: decodeQqSimulatorCqValue(meme[2] || 'default'),
      }];
    }
    return [{ type: 'text', text: token }];
  }
  
  function parseQqSimulatorMessageTextSegments(text = '') {
    const source = String(text || '');
    if (!source) return [];
    const segments = [];
    const tokenPattern = /(\[CQ:[^\]]+\]|\[meme:[^\]]+\]|\[\[\[(?:at|poke):\d+\]\]\]|\[\[\[reply:[^\]]+\]\]\]|\[\[\[memory:[^\]]+\]\]\]|\(\(\((?:at|poke):\d+\)\)\)|\(\(\(reply:[^)]+\)\)\)|\(\(\(\d+\)\)\))/gi;
    let lastIndex = 0;
    let match;
    while ((match = tokenPattern.exec(source)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', text: source.slice(lastIndex, match.index) });
      }
      segments.push(...normalizeQqSimulatorCqSegment(match[0]));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < source.length) {
      segments.push({ type: 'text', text: source.slice(lastIndex) });
    }
    return segments.filter(item => item.type !== 'text' || item.text);
  }
  
  function stringifyQqSimulatorSegmentPlain(segment = {}) {
    if (segment.type === 'text') return String(segment.text || '');
    if (segment.type === 'at') return `@${segment.qq || 'unknown'}`;
    if (segment.type === 'image') return '[图片]';
    if (segment.type === 'record') return '[语音]';
    if (segment.type === 'face') return `[表情:${segment.id || 'face'}]`;
    if (segment.type === 'reply') return `[回复:${segment.id || 'unknown'}]`;
    if (segment.type === 'poke') return `[戳一戳:${segment.qq || segment.id || 'unknown'}]`;
    if (segment.type === 'memory') return `[记忆:${segment.data || 'memory'}]`;
    if (segment.type === 'meme') return `[meme:${segment.character || '未知'}:${segment.emotion || 'default'}]`;
    if (segment.type === 'cq') return `[CQ:${segment.cqType || 'unknown'}]`;
    return '';
  }
  
  function stringifyQqSimulatorSegmentCq(segment = {}) {
    if (segment.type === 'text') return encodeQqSimulatorCqValue(segment.text || '');
    if (segment.type === 'at') return `[CQ:at,qq=${encodeQqSimulatorCqValue(segment.qq || '')}]`;
    if (segment.type === 'image') return `[CQ:image,file=${encodeQqSimulatorCqValue(segment.file || segment.url || '')}]`;
    if (segment.type === 'record') return `[CQ:record,file=${encodeQqSimulatorCqValue(segment.file || segment.url || '')}]`;
    if (segment.type === 'face') return `[CQ:face,id=${encodeQqSimulatorCqValue(segment.id || '')}]`;
    if (segment.type === 'reply') return `[CQ:reply,id=${encodeQqSimulatorCqValue(segment.id || '')}]`;
    if (segment.type === 'poke') return `[CQ:poke,qq=${encodeQqSimulatorCqValue(segment.qq || segment.id || '')}]`;
    if (segment.type === 'memory') return '';
    if (segment.type === 'meme') return `[meme:${encodeQqSimulatorCqValue(segment.character || '未知')}:${encodeQqSimulatorCqValue(segment.emotion || 'default')}]`;
    if (segment.type === 'cq') {
      const params = Object.entries(segment.data || {})
        .map(([key, value]) => `${key}=${encodeQqSimulatorCqValue(value)}`)
        .join(',');
      return `[CQ:${segment.cqType || 'unknown'}${params ? `,${params}` : ''}]`;
    }
    return '';
  }
  
  function buildQqSimulatorRawMessage(payload = {}, ctx = {}) {
    const parts = [];
    if (payload.includeAt) parts.push(`@${ctx.botName || 'Bot'}`);
    const textSegments = parseQqSimulatorMessageTextSegments(payload.messageText);
    if (textSegments.length > 0) {
      parts.push(textSegments.map(stringifyQqSimulatorSegmentPlain).join(''));
    }
    if (payload.voice?.transcript) parts.push(payload.voice.transcript);
    if (payload.voice && !payload.voice?.transcript) parts.push('[语音消息]');
    if (payload.images.length > 0) parts.push(`[图片 ${payload.images.length} 张]`);
    return parts.join(' ').trim();
  }
  
  function buildQqSimulatorCqMessage(payload = {}, ctx = {}) {
    const parts = [];
    if (payload.includeAt) {
      parts.push(`[CQ:at,qq=${encodeQqSimulatorCqValue(ctx.botId)}]`);
    }
    parts.push(...parseQqSimulatorMessageTextSegments(payload.messageText).map(stringifyQqSimulatorSegmentCq));
    for (const url of payload.images) {
      parts.push(`[CQ:image,file=${encodeQqSimulatorCqValue(redactQqSimulatorMediaUrl(url))}]`);
    }
    if (payload.voice) {
      const source = payload.voice.dataUrl ? redactQqSimulatorMediaUrl(payload.voice.dataUrl) : payload.voice.name || 'voice-message';
      parts.push(`[CQ:record,file=${encodeQqSimulatorCqValue(source)}]`);
    }
    return parts.join('');
  }
  
  function toQqSimulatorOnebotSegment(segment = {}) {
    if (segment.type === 'text') return { type: 'text', data: { text: segment.text || '' } };
    if (segment.type === 'at') return { type: 'at', data: { qq: String(segment.qq || '') } };
    if (segment.type === 'image') {
      const redacted = redactQqSimulatorMediaUrl(segment.url || segment.file || '');
      return { type: 'image', data: { file: redacted, url: redacted } };
    }
    if (segment.type === 'record') {
      const redacted = redactQqSimulatorMediaUrl(segment.url || segment.file || '');
      return { type: 'record', data: { file: redacted, url: redacted } };
    }
    if (segment.type === 'face') return { type: 'face', data: { id: String(segment.id || '') } };
    if (segment.type === 'reply') return { type: 'reply', data: { id: String(segment.id || '') } };
    if (segment.type === 'poke') return { type: 'poke', data: { qq: String(segment.qq || segment.id || '') } };
    if (segment.type === 'memory') return { type: 'memory', data: { data: String(segment.data || ''), key: segment.key || [], timeout: segment.timeout || 0 } };
    if (segment.type === 'meme') {
      return { type: 'meme', data: { character: segment.character || '', emotion: segment.emotion || 'default' } };
    }
    if (segment.type === 'cq') return { type: segment.cqType || 'cq', data: segment.data || {} };
    return { type: 'text', data: { text: stringifyQqSimulatorSegmentPlain(segment) } };
  }
  
  function toQqSimulatorIcqqSegment(segment = {}, ctx = {}) {
    if (segment.type === 'text') return { type: 'text', text: segment.text || '' };
    if (segment.type === 'at') return { type: 'at', qq: String(segment.qq || ''), text: `@${segment.qq || ctx.botName || 'unknown'}` };
    if (segment.type === 'image') {
      const redacted = redactQqSimulatorMediaUrl(segment.url || segment.file || '');
      return { type: 'image', file: redacted, url: redacted };
    }
    if (segment.type === 'record') {
      const redacted = redactQqSimulatorMediaUrl(segment.url || segment.file || '');
      return { type: 'record', file: redacted, url: redacted };
    }
    if (segment.type === 'face') return { type: 'face', id: String(segment.id || '') };
    if (segment.type === 'reply') return { type: 'reply', id: String(segment.id || '') };
    if (segment.type === 'poke') return { type: 'poke', qq: String(segment.qq || segment.id || '') };
    if (segment.type === 'memory') return { type: 'memory', data: String(segment.data || ''), key: segment.key || [], timeout: segment.timeout || 0 };
    if (segment.type === 'meme') return { type: 'meme', character: segment.character || '', emotion: segment.emotion || 'default' };
    if (segment.type === 'cq') return { type: segment.cqType || 'cq', data: segment.data || {} };
    return { type: 'text', text: stringifyQqSimulatorSegmentPlain(segment) };
  }

  function splitQqSimulatorReplyMarkers(line = '') {
    return String(line || '')
      .split(/(?=\[\[\[reply:[^\]]+\]\]\]|\(\(\(reply:[^)]+\)\)\))/i)
      .filter(item => item.trim());
  }

  function resolveQqSimulatorMemeCharacter(ctx = {}, explicitCharacter = '') {
    const aiConfig = ctx.allConfigs?.ai || {};
    const memeConfig = aiConfig.memeConfig || {};
    return String(
      explicitCharacter
      || memeConfig.character
      || aiConfig.character
      || ctx.botName
      || '芙宁娜'
    ).trim() || '芙宁娜';
  }

  function getQqSimulatorMemeContextNote(ctx = {}) {
    const aiConfig = ctx.allConfigs?.ai || {};
    const memeConfig = aiConfig.memeConfig || {};
    const defaultCharacter = resolveQqSimulatorMemeCharacter(ctx);
    const emotions = Array.isArray(memeConfig.availableEmotions) && memeConfig.availableEmotions.length > 0
      ? memeConfig.availableEmotions.join('、')
      : 'happy、sad、angry、confused、shy、surprised、bye、sorry、good、default';
    return [
      '表情包发送能力：如果用户让你发表情包、贴图、meme 或角色表情，不要询问、解释或猜测 API 地址。',
      '你只需要在回复中输出 [meme:角色:情绪]，系统会自动用已配置的表情包服务或本地表情包目录解析并发送图片。',
      '不要回答“我不知道 API 地址”“我不会发图”“需要配置接口”等；这些属于系统内部处理。',
      `默认表情包角色：${defaultCharacter}`,
      `可用情绪参考：${emotions}`,
      '示例：[meme:芙宁娜:happy]',
    ].join('\n');
  }

  function resolveQqSimulatorMemeEmotionFromText(text = '') {
    const source = String(text || '').toLowerCase();
    const rules = [
      { emotion: 'happy', pattern: /(开心|高兴|快乐|笑|欢快|可爱|happy|smile|good)/i },
      { emotion: 'sad', pattern: /(难过|伤心|哭|委屈|sad|cry)/i },
      { emotion: 'angry', pattern: /(生气|愤怒|气鼓鼓|angry|mad)/i },
      { emotion: 'confused', pattern: /(疑惑|困惑|懵|不懂|confused)/i },
      { emotion: 'shy', pattern: /(害羞|脸红|羞|shy)/i },
      { emotion: 'surprised', pattern: /(惊讶|震惊|惊喜|surprised|shock)/i },
      { emotion: 'bye', pattern: /(再见|拜拜|bye)/i },
      { emotion: 'sorry', pattern: /(抱歉|对不起|sorry)/i },
      { emotion: 'goodnight', pattern: /(晚安|goodnight)/i },
      { emotion: 'goodmorning', pattern: /(早安|早上好|goodmorning)/i },
    ];
    return rules.find(rule => rule.pattern.test(source))?.emotion || 'default';
  }

  function inferQqSimulatorMemeRequest(payload = {}, ctx = {}) {
    const text = String(payload.messageText || payload.comment || '').trim();
    if (!text) return null;
    const explicit = text.match(/\[meme:([^:\]]+)(?::([^\]]+))?\]/i);
    if (explicit) {
      return {
        type: 'meme',
        character: decodeQqSimulatorCqValue(explicit[1]),
        emotion: decodeQqSimulatorCqValue(explicit[2] || 'default'),
      };
    }
    if (!/(表情包|贴图|meme|sticker|发个表情|来个表情|发表情)/i.test(text)) {
      return null;
    }
    const defaultCharacter = resolveQqSimulatorMemeCharacter(ctx);
    const candidates = Array.from(new Set([
      defaultCharacter,
      ctx.allConfigs?.ai?.memeConfig?.character,
      ctx.allConfigs?.ai?.character,
      ctx.botName,
      '芙宁娜',
      '灵晶',
      '花花',
    ].map(item => String(item || '').trim()).filter(Boolean)));
    const character = candidates.find(item => item && text.includes(item)) || defaultCharacter;
    return {
      type: 'meme',
      character,
      emotion: resolveQqSimulatorMemeEmotionFromText(text),
    };
  }

  function shouldSuppressQqSimulatorMemeText(reply = '', userText = '') {
    const text = String(reply || '').trim();
    const request = String(userText || '').trim();
    if (!text) return false;
    if (/(只发|只要|仅发|只给).{0,12}(图片|图|表情包|贴图|meme)|不要解释|别解释/i.test(request)) {
      return true;
    }
    return /(没法|无法|不能|不会).{0,16}(发|发送|直接).{0,16}(图|图片|表情包|贴图|meme)|不知道.{0,12}(api|接口|地址)|api.{0,12}(地址|接口).{0,12}(不知道|不清楚|没有)|找不到.{0,12}(表情包|图片|资源|接口)/i.test(text);
  }

  function getQqSimulatorImageMimeType(filePath = '') {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.bmp') return 'image/bmp';
    if (ext === '.avif') return 'image/avif';
    return 'image/jpeg';
  }

  async function toQqSimulatorDisplayImageUrl(imagePath = '') {
    const source = String(imagePath || '').trim();
    if (!source) return '';
    if (/^(https?:\/\/|data:image\/|blob:)/i.test(source)) return source;

    try {
      const buffer = await fs.readFile(source);
      const maxBytes = 3 * 1024 * 1024;
      if (buffer.length > maxBytes) {
        return '';
      }
      return `data:${getQqSimulatorImageMimeType(source)};base64,${buffer.toString('base64')}`;
    } catch {
      return '';
    }
  }

  async function resolveQqSimulatorMemeSegment(ctx = {}, segment = {}, options = {}) {
    const requestedCharacter = resolveQqSimulatorMemeCharacter(ctx, segment.character);
    const requestedEmotion = String(segment.emotion || 'default').trim() || 'default';
    const startedAt = Date.now();
    const timeoutMs = 8000;
    try {
      const resolved = await Promise.race([
        Meme.getResolvedMemeUrl(requestedCharacter, requestedEmotion, ['default']),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`表情包解析超时（${timeoutMs}ms）`)), timeoutMs);
        }),
      ]);
      const imagePath = resolved?.imagePath || resolved?.imageUrl || '';
      const displayUrl = await toQqSimulatorDisplayImageUrl(imagePath);
      const label = `表情包 ${resolved?.character || requestedCharacter}/${resolved?.emotion || requestedEmotion}`;
      const actionType = options.actionType || (displayUrl ? 'would_send_meme_from_ai_marker' : 'would_send_meme_unpreviewable');
      const actionMessage = options.actionMessage || (displayUrl ? 'AI 回复会发送表情包图片' : 'AI 回复会尝试发送表情包，但模拟调试无法预览图片');
      pushQqSimulatorAction(ctx, actionType, actionMessage, {
        character: resolved?.character || requestedCharacter,
        requestedCharacter,
        emotion: resolved?.emotion || requestedEmotion,
        requestedEmotion,
        source: resolved?.source || 'unknown',
        imagePath: redactQqSimulatorMediaUrl(imagePath),
        previewable: Boolean(displayUrl),
        elapsedMs: Date.now() - startedAt,
        safeMode: true,
      });
      return {
        type: 'image',
        url: displayUrl,
        label,
        meme: {
          character: resolved?.character || requestedCharacter,
          emotion: resolved?.emotion || requestedEmotion,
          requestedCharacter,
          requestedEmotion,
          source: resolved?.source || 'unknown',
          imagePath: redactQqSimulatorMediaUrl(imagePath),
        },
      };
    } catch (error) {
      pushQqSimulatorAction(ctx, options.failedActionType || 'meme_resolution_failed', options.failedActionMessage || 'AI 回复触发表情包，但解析失败', {
        character: requestedCharacter,
        emotion: requestedEmotion,
        error: error.message,
        safeMode: true,
      });
      return {
        type: 'text',
        text: `[表情包解析失败:${requestedCharacter}/${requestedEmotion}]`,
      };
    }
  }

  async function appendQqSimulatorImagePathReply(ctx = {}, imagePath = '', label = 'Bot 表情包', detail = {}) {
    const source = String(imagePath || '').trim();
    if (!source) return false;
    const displayUrl = await toQqSimulatorDisplayImageUrl(source);
    ctx.replies.push([{
      type: 'image',
      url: displayUrl,
      label,
    }]);
    pushQqSimulatorAction(ctx, displayUrl ? 'sandbox_emoji_image_reply' : 'sandbox_emoji_image_unpreviewable', displayUrl ? '聊天引擎生成了表情包图片' : '聊天引擎生成了表情包，但模拟调试无法预览图片', {
      imagePath: redactQqSimulatorMediaUrl(source),
      previewable: Boolean(displayUrl),
      safeMode: true,
      ...detail,
    });
    return true;
  }

  async function appendQqSimulatorAiReply(ctx = {}, reply = '') {
    let visibleCount = 0;
    const lines = String(reply || '').split(/\r?\n/);
    for (const line of lines) {
      const expandedLines = splitQqSimulatorReplyMarkers(line);
      for (const expandedLine of expandedLines) {
        const visibleSegments = [];
        for (const segment of parseQqSimulatorMessageTextSegments(expandedLine)) {
          if (segment.type === 'poke') {
            pushQqSimulatorAction(ctx, 'would_send_poke_from_ai_marker', 'AI 回复会触发戳一戳', {
              userId: String(segment.qq || segment.id || '').trim(),
              safeMode: true,
            });
            continue;
          }
          if (segment.type === 'memory') {
            pushQqSimulatorAction(ctx, 'would_store_memory_from_ai_marker', 'AI 回复会写入记忆', {
              data: segment.data,
              key: segment.key || [],
              timeout: segment.timeout || 0,
              safeMode: true,
            });
            continue;
          }
          if (segment.type === 'meme') {
            visibleSegments.push(await resolveQqSimulatorMemeSegment(ctx, segment));
            continue;
          }
          visibleSegments.push(segment);
        }
        const hasVisible = visibleSegments.some(segment => (
          segment.type !== 'text' || String(segment.text || '').trim()
        ));
        if (hasVisible) {
          ctx.replies.push(visibleSegments);
          visibleCount += 1;
        }
      }
    }
    return visibleCount;
  }
  
  function buildQqSimulatorOnebotSegments(payload = {}, ctx = {}) {
    const message = [];
    if (payload.includeAt) {
      message.push({ type: 'at', data: { qq: String(ctx.botId) } });
    }
    message.push(...parseQqSimulatorMessageTextSegments(payload.messageText).map(toQqSimulatorOnebotSegment));
    for (const url of payload.images) {
      const redacted = redactQqSimulatorMediaUrl(url);
      message.push({ type: 'image', data: { file: redacted, url: redacted } });
    }
    if (payload.voice) {
      const redacted = payload.voice.dataUrl ? redactQqSimulatorMediaUrl(payload.voice.dataUrl) : '';
      message.push({
        type: 'record',
        data: {
          file: payload.voice.name || 'voice-message',
          url: redacted,
          mime_type: payload.voice.mimeType || 'audio/*',
        },
      });
    }
    return message;
  }
  
  function buildQqSimulatorIcqqSegments(payload = {}, ctx = {}) {
    const message = [];
    if (payload.includeAt) {
      message.push({ type: 'at', qq: String(ctx.botId), text: `@${ctx.botName || 'Bot'}` });
    }
    message.push(...parseQqSimulatorMessageTextSegments(payload.messageText).map(segment => toQqSimulatorIcqqSegment(segment, ctx)));
    for (const url of payload.images) {
      const redacted = redactQqSimulatorMediaUrl(url);
      message.push({ type: 'image', file: redacted, url: redacted });
    }
    if (payload.voice) {
      message.push({
        type: 'record',
        file: payload.voice.name || 'voice-message',
        url: payload.voice.dataUrl ? redactQqSimulatorMediaUrl(payload.voice.dataUrl) : '',
        mimeType: payload.voice.mimeType || 'audio/*',
        transcript: payload.voice.transcript || '',
      });
    }
    return message;
  }
  
  function buildQqSimulatorSender(payload = {}, adapterFormat = 'onebot') {
    const userId = adapterFormat === 'icqq' ? String(payload.userId) : toQqSimulatorAdapterId(payload.userId);
    return {
      user_id: userId,
      nickname: payload.nickname,
      card: payload.nickname,
      role: payload.role,
      age: payload.applicant?.age,
      level: payload.applicant?.qqLevel,
      sex: payload.applicant?.sex || 'unknown',
    };
  }
  
  function buildQqSimulatorHistorySender(item = {}, adapterFormat = 'onebot') {
    const userId = adapterFormat === 'icqq' ? String(item.userId) : toQqSimulatorAdapterId(item.userId);
    return {
      user_id: userId,
      nickname: item.nickname,
      card: item.nickname,
      role: 'member',
    };
  }
  
  function buildQqSimulatorHistorySegments(item = {}, adapterFormat = 'onebot') {
    const type = normalizeQqSimulatorHistoryType(item.type);
    const content = String(item.content || '');
    if (adapterFormat === 'icqq') {
      if (type === 'image') return [{ type: 'image', file: redactQqSimulatorMediaUrl(content), url: redactQqSimulatorMediaUrl(content) }];
      if (type === 'record') return [{ type: 'record', file: redactQqSimulatorMediaUrl(content), url: redactQqSimulatorMediaUrl(content) }];
      if (type === 'at') return [{ type: 'at', qq: content, text: `@${content}` }];
      if (type === 'reply') return [{ type: 'reply', id: content }];
      return [{ type: 'text', text: content }];
    }
    if (type === 'image') {
      const redacted = redactQqSimulatorMediaUrl(content);
      return [{ type: 'image', data: { file: redacted, url: redacted } }];
    }
    if (type === 'record') {
      const redacted = redactQqSimulatorMediaUrl(content);
      return [{ type: 'record', data: { file: redacted, url: redacted } }];
    }
    if (type === 'at') return [{ type: 'at', data: { qq: content } }];
    if (type === 'reply') return [{ type: 'reply', data: { id: content } }];
    return [{ type: 'text', data: { text: content } }];
  }
  
  function buildQqSimulatorHistoryRawMessage(item = {}) {
    if (item.type === 'image') return '[图片]';
    if (item.type === 'record') return '[语音]';
    if (item.type === 'at') return `@${item.content}`;
    if (item.type === 'reply') return `[回复消息 ${item.content}]`;
    return String(item.content || '');
  }
  
  function buildQqSimulatorHistoryMessages(payload = {}, adapterFormat = 'onebot') {
    return (payload.groupHistory || []).map(item => {
      const userId = adapterFormat === 'icqq' ? String(item.userId) : toQqSimulatorAdapterId(item.userId);
      const groupId = adapterFormat === 'icqq' ? String(payload.groupId) : toQqSimulatorAdapterId(payload.groupId);
      return {
        adapterFormat,
        post_type: 'message',
        message_type: 'group',
        sub_type: 'normal',
        time: item.time,
        group_id: groupId,
        user_id: userId,
        sender: buildQqSimulatorHistorySender(item, adapterFormat),
        message_id: adapterFormat === 'napcat' ? String(item.messageId) : item.messageId,
        message_seq: item.messageId,
        seq: item.messageId,
        raw_message: buildQqSimulatorHistoryRawMessage(item),
        msg: buildQqSimulatorHistoryRawMessage(item),
        message: buildQqSimulatorHistorySegments(item, adapterFormat),
      };
    });
  }
  
  function buildQqSimulatorGroupMock(payload = {}, adapterFormat = 'onebot') {
    const history = buildQqSimulatorHistoryMessages(payload, adapterFormat);
    return {
      group_id: adapterFormat === 'icqq' ? String(payload.groupId) : toQqSimulatorAdapterId(payload.groupId),
      group_name: `群 ${payload.groupId}`,
      bot_role: payload.botRole,
      historyCount: history.length,
      getChatHistory: `[mock async function: returns ${history.length} messages]`,
      lastMessageId: history.at(-1)?.message_id || 0,
    };
  }
  
  function buildQqSimulatorBotEvent(ctx = {}, adapterFormat = 'onebot') {
    const appName = adapterFormat === 'napcat'
      ? 'NapCat.OneBot'
      : adapterFormat === 'go-cqhttp'
        ? 'go-cqhttp'
        : adapterFormat === 'icqq'
          ? 'icqq'
          : 'OneBot';
    return {
      uin: adapterFormat === 'icqq' ? String(ctx.botId) : toQqSimulatorAdapterId(ctx.botId),
      self_id: adapterFormat === 'icqq' ? String(ctx.botId) : toQqSimulatorAdapterId(ctx.botId),
      nickname: ctx.botName,
      version: { app_name: appName },
    };
  }
  
  function buildQqSimulatorOnebotEvent(payload = {}, ctx = {}, adapterFormat = 'onebot') {
    const messageId = buildQqSimulatorMessageId(payload);
    const groupId = toQqSimulatorAdapterId(payload.groupId);
    const userId = toQqSimulatorAdapterId(payload.userId);
    const selfId = toQqSimulatorAdapterId(ctx.botId);
    const groupHistory = buildQqSimulatorHistoryMessages(payload, adapterFormat);
    const privateMessage = isQqSimulatorPrivateMessageEvent(payload.eventType);
    const base = {
      adapterFormat,
      time: Math.floor(Date.now() / 1000),
      self_id: selfId,
      eventType: payload.eventType,
      ...(privateMessage ? {} : { group_id: groupId }),
      user_id: userId,
      sender: buildQqSimulatorSender(payload, adapterFormat),
      applicant: payload.applicant,
      bot: buildQqSimulatorBotEvent(ctx, adapterFormat),
      group: privateMessage ? null : buildQqSimulatorGroupMock(payload, adapterFormat),
      group_history: groupHistory,
      bot_role: payload.botRole,
      isMaster: payload.isMaster,
    };
  
    if (adapterFormat === 'go-cqhttp') {
      base.message_format = 'array';
      base.real_id = messageId;
      base.anonymous = null;
    }
    if (adapterFormat === 'napcat') {
      base.message_sent_type = 'group';
      base.original_message_id = String(messageId);
    }
  
    if (isQqSimulatorMessageEvent(payload.eventType)) {
      return {
        ...base,
        post_type: 'message',
        message_type: privateMessage ? 'private' : 'group',
        sub_type: privateMessage ? 'friend' : 'normal',
        message_id: adapterFormat === 'napcat' ? String(messageId) : messageId,
        message_seq: messageId,
        raw_message: buildQqSimulatorCqMessage(payload, ctx),
        msg: buildQqSimulatorRawMessage(payload, ctx),
        message: buildQqSimulatorOnebotSegments(payload, ctx),
        font: 0,
        comment: payload.comment,
      };
    }
  
    if (payload.eventType === 'join_request') {
      return {
        ...base,
        post_type: 'request',
        request_type: 'group',
        sub_type: 'add',
        flag: `qq-simulator-${payload.groupId}-${payload.userId}-${messageId}`,
        comment: payload.comment,
        raw_message: payload.comment,
        message: payload.comment,
      };
    }
  
    if (payload.eventType === 'group_increase') {
      return {
        ...base,
        post_type: 'notice',
        notice_type: 'group_increase',
        sub_type: 'approve',
        operator_id: userId,
        comment: payload.comment,
      };
    }
  
    return {
      ...base,
      post_type: 'notice',
      notice_type: 'notify',
      sub_type: 'poke',
      sender_id: userId,
      operator_id: userId,
      target_id: selfId,
      comment: payload.comment,
    };
  }
  
  function buildQqSimulatorIcqqEvent(payload = {}, ctx = {}) {
    const messageId = buildQqSimulatorMessageId(payload);
    const rawMessage = buildQqSimulatorRawMessage(payload, ctx);
    const groupHistory = buildQqSimulatorHistoryMessages(payload, 'icqq');
    const privateMessage = isQqSimulatorPrivateMessageEvent(payload.eventType);
    const base = {
      adapterFormat: 'icqq',
      time: Date.now(),
      self_id: String(ctx.botId),
      eventType: payload.eventType,
      ...(privateMessage ? {} : { group_id: String(payload.groupId) }),
      user_id: String(payload.userId),
      sender: buildQqSimulatorSender(payload, 'icqq'),
      member: buildQqSimulatorSender(payload, 'icqq'),
      group: privateMessage ? null : buildQqSimulatorGroupMock(payload, 'icqq'),
      group_history: groupHistory,
      bot: buildQqSimulatorBotEvent(ctx, 'icqq'),
      bot_role: payload.botRole,
      isMaster: payload.isMaster,
      applicant: payload.applicant,
    };
  
    if (isQqSimulatorMessageEvent(payload.eventType)) {
      return {
        ...base,
        post_type: 'message',
        message_type: privateMessage ? 'private' : 'group',
        sub_type: privateMessage ? 'friend' : 'normal',
        message_id: messageId,
        seq: messageId,
        rand: messageId,
        raw_message: rawMessage,
        msg: rawMessage,
        message: buildQqSimulatorIcqqSegments(payload, ctx),
        comment: payload.comment,
        atBot: payload.includeAt,
      };
    }
  
    if (payload.eventType === 'join_request') {
      return {
        ...base,
        post_type: 'request',
        request_type: 'group',
        sub_type: 'add',
        flag: `qq-simulator-${payload.groupId}-${payload.userId}-${messageId}`,
        comment: payload.comment,
        reason: payload.comment,
      };
    }
  
    if (payload.eventType === 'group_increase') {
      return {
        ...base,
        post_type: 'notice',
        notice_type: 'group_increase',
        sub_type: 'approve',
        operator_id: String(payload.userId),
        comment: payload.comment,
      };
    }
  
    return {
      ...base,
      post_type: 'notice',
      notice_type: 'notify',
      sub_type: 'poke',
      sender_id: String(payload.userId),
      operator_id: String(payload.userId),
      target_id: String(ctx.botId),
      comment: payload.comment,
    };
  }
  
  function getQqSimulatorEventPayload(payload = {}, ctx = {}) {
    const adapterFormat = normalizeQqSimulatorAdapterFormat(payload.adapterFormat);
    if (adapterFormat === 'icqq') {
      return buildQqSimulatorIcqqEvent(payload, ctx);
    }
    return buildQqSimulatorOnebotEvent(payload, ctx, adapterFormat);
  }
  
  function isQqSimulatorCommand(text = '') {
    return /^(#|＃|\/)/.test(String(text || '').trim());
  }
  
  function getQqSimulatorWelcomeConfig(newcomerConfig = {}, groupId = '') {
    const source = isPlainObject(newcomerConfig) ? newcomerConfig : {};
    if (isPlainObject(source[groupId]) && Object.keys(source[groupId]).length > 0) {
      return source[groupId];
    }
    return isPlainObject(source.default) ? source.default : {};
  }
  
  function isQqSimulatorAiWelcomeEnabled(welcomeConfig = {}) {
    return welcomeConfig?.aiEnabled === true || welcomeConfig?.ai?.enabled === true;
  }
  
  function isQqSimulatorWelcomeEnabled(welcomeConfig = {}) {
    if (!isPlainObject(welcomeConfig) || Object.keys(welcomeConfig).length === 0) return false;
    if (welcomeConfig.enabled === true) return true;
    if (welcomeConfig.enabled === false) return false;
    return Boolean(
      String(welcomeConfig.text || '').trim()
      || String(welcomeConfig.image || '').trim()
      || isQqSimulatorAiWelcomeEnabled(welcomeConfig),
    );
  }
  
  function buildQqSimulatorPlainWelcome(payload = {}, welcomeConfig = {}) {
    const text = String(welcomeConfig.text || '').trim() || '欢迎新成员。';
    const parts = [`@${payload.userId}`, text];
    if (welcomeConfig.image) {
      parts.push(`[欢迎图片: ${path.basename(String(welcomeConfig.image || ''))}]`);
    }
    return parts.join(' ');
  }
  
  function simulateQqGroupManagementCommand(payload = {}, ctx = {}) {
    const match = payload.messageText.match(/^#灵晶\s*(开启|关闭)群管理$/);
    if (!match) return false;
    const enabled = match[1] === '开启';
    if (!isQqSimulatorManager(payload)) {
      ctx.replies.push('只有群主、管理员或主人可以设置本群群管理。');
      pushQqSimulatorLog(ctx, 'warn', '群管理命令权限不足', { command: payload.messageText });
      return true;
    }
    const mainConfig = ctx.allConfigs.config || {};
    pushQqSimulatorAction(ctx, enabled ? 'would_enable_group_management' : 'would_disable_group_management', enabled ? '将开启本群群管理基础能力' : '将关闭本群群管理基础能力', {
      groupId: payload.groupId,
      configChanges: enabled
        ? {
            ...(mainConfig.groupManagement === false ? { 'config.groupManagement': true } : {}),
            'memberModeration.settings.enabled': true,
            'memberModeration.settings.scoreEnabled': true,
            'memberModeration.content.enabled': true,
          }
        : {
            'memberModeration.settings.enabled': false,
            'memberModeration.settings.scoreEnabled': false,
            'memberModeration.content.enabled': false,
          },
    });
    ctx.replies.push(enabled
      ? '模拟结果：会开启插件群管理总开关，并启用本群入群风险评分和群消息风控。'
      : '模拟结果：会关闭本群入群风险评分和群消息风控，不影响其他群。');
    pushQqSimulatorLog(ctx, 'info', '已命中群管理快捷命令', { command: payload.messageText, safeMode: true });
    return true;
  }

  function getQqSimulatorImageModeLabel(imageMode = '') {
    const labels = {
      openai: 'OpenAI 风格接口',
      'ark-agent-plan': '火山 Agent Plan',
      'sd-webui': 'SD WebUI',
      chat: '对话式生图模型',
      jimeng: '即梦接口',
    };
    const normalized = String(imageMode || 'openai').trim().toLowerCase();
    return labels[normalized] || normalized || '未知图像接口';
  }

  async function simulateQqImageEditCommand(payload = {}, ctx = {}) {
    const text = String(payload.messageText || '').trim();
    const match = text.match(/^[#＃\/]?灵晶\s*(改图|融合)(?:[：:，,\s]+)?([\s\S]*)$/);
    if (!match) return false;

    const operation = match[1] === '融合' ? 'fusion' : 'edit';
    const prompt = String(match[2] || '').trim();
    const imageCount = Array.isArray(payload.images) ? payload.images.length : 0;
    const minimumImages = operation === 'fusion' ? 2 : 1;
    const imageConfig = ctx.allConfigs.ai?.imageConfig || {};
    const imageMode = String(imageConfig.imageMode || 'openai').trim().toLowerCase();
    const imageModeLabel = getQqSimulatorImageModeLabel(imageMode);
    const actionType = operation === 'fusion' ? 'would_fuse_images' : 'would_edit_image';

    if (!prompt) {
      const example = operation === 'fusion'
        ? '#灵晶融合 把两张图片融合成自然的合影'
        : '#灵晶改图 把背景改成樱花海，保持人物不变';
      ctx.replies.push(`请写明图片处理要求。\n示例：${example}`);
      pushQqSimulatorAction(ctx, 'would_reject_image_edit_missing_prompt', '缺少图片处理要求', {
        command: text,
        operation,
        imageCount,
        safeMode: true,
      });
      return true;
    }

    if (imageConfig.enabled === false) {
      ctx.replies.push('图像生成功能当前未开启，请先在控制台启用图像生成 API。');
      pushQqSimulatorAction(ctx, 'would_reject_image_edit_disabled', '图像生成功能未开启', {
        command: text,
        operation,
        imageMode,
        safeMode: true,
      });
      return true;
    }

    if (imageCount < minimumImages) {
      ctx.replies.push(operation === 'fusion'
        ? '请在同一条消息中发送至少两张图片，或回复一条包含多张图片的消息。'
        : '请在消息中附带图片，或回复需要修改的图片。');
      pushQqSimulatorAction(ctx, 'would_reject_image_edit_missing_source', '参考图片数量不足', {
        command: text,
        operation,
        imageCount,
        minimumImages,
        safeMode: true,
      });
      return true;
    }

    if (imageCount > 14) {
      ctx.replies.push(`参考图共有 ${imageCount} 张，当前最多支持 14 张，请减少图片后重试。`);
      pushQqSimulatorAction(ctx, 'would_reject_image_edit_too_many_sources', '参考图片超过上限', {
        command: text,
        operation,
        imageCount,
        maximumImages: 14,
        safeMode: true,
      });
      return true;
    }

    if (payload.dispatchMode === 'live-image') {
      if (payload.confirmLiveImage !== true) {
        ctx.errors.push('真实生图请求未完成二次确认，已拒绝执行。');
        pushQqSimulatorAction(ctx, 'rejected_live_image_without_confirmation', '真实生图请求缺少二次确认', {
          operation,
          imageMode,
          realImageExecution: false,
          safeMode: true,
        });
        return true;
      }
      const startedAt = Date.now();
      pushQqSimulatorTimeline(ctx, 'ai.imageEditCommand.live', 'start', {
        operation,
        imageMode,
        imageCount,
        priority: -1111,
      });
      pushQqSimulatorLog(ctx, 'info', '开始执行模拟调试真实生图', {
        operation,
        imageMode,
        imageCount,
        realImageExecution: true,
      });
      try {
        const processor = await createImageProcessor();
        const runtimeConfig = processor.mergeImageConfig(ctx.allConfigs.ai || {});
        const validation = processor.validateImageConfig(runtimeConfig);
        if (!validation.isValid) {
          throw new Error(validation.errors.join('；'));
        }
        const result = await processor.generateOrEditImage(prompt, payload.images, runtimeConfig);
        if (!result?.success || !result.imageUrl) {
          throw new Error(result?.error || result?.response || '图像接口没有返回图片');
        }
        ctx.replies.push([{
          type: 'image',
          url: result.imageUrl,
          label: `真实${operation === 'fusion' ? '融合' : '改图'}结果 · ${imageModeLabel}`,
        }]);
        pushQqSimulatorAction(ctx, operation === 'fusion' ? 'executed_image_fusion' : 'executed_image_edit', operation === 'fusion' ? '已执行真实图片融合' : '已执行真实图片编辑', {
          operation,
          imageMode,
          imageModeLabel,
          imageCount,
          singleImageOutput: true,
          elapsedMs: Date.now() - startedAt,
          realImageExecution: true,
          safeMode: false,
        });
        pushQqSimulatorTimeline(ctx, 'ai.imageEditCommand.live', 'success', {
          operation,
          imageMode,
          imageCount,
          singleImageOutput: true,
          elapsedMs: Date.now() - startedAt,
        });
        pushQqSimulatorLog(ctx, 'info', '模拟调试真实生图成功', {
          operation,
          imageMode,
          elapsedMs: Date.now() - startedAt,
          realImageExecution: true,
        });
      } catch (error) {
        const message = String(error?.message || error || '未知错误').slice(0, 800);
        ctx.errors.push(`真实${operation === 'fusion' ? '融合' : '改图'}失败：${message}`);
        pushQqSimulatorTimeline(ctx, 'ai.imageEditCommand.live', 'error', {
          operation,
          imageMode,
          elapsedMs: Date.now() - startedAt,
          error: message,
        });
        pushQqSimulatorLog(ctx, 'error', '模拟调试真实生图失败', {
          operation,
          imageMode,
          elapsedMs: Date.now() - startedAt,
          error: message,
          realImageExecution: true,
        });
      }
      return true;
    }

    const sdWebUiUsesFirstImage = imageMode === 'sd-webui' && imageCount > 1;
    const sourceImageCount = imageMode === 'sd-webui' ? 1 : imageCount;
    ctx.replies.push(
      `模拟结果：会使用 ${imageModeLabel} ${operation === 'fusion' ? '融合图片' : '修改图片'}，固定返回 1 张图片。`
      + (sdWebUiUsesFirstImage ? '\n注意：SD WebUI 标准图生图只会使用第一张参考图。' : ''),
    );
    pushQqSimulatorAction(ctx, actionType, operation === 'fusion' ? '会进入图片融合流程' : '会进入图片编辑流程', {
      command: text,
      operation,
      prompt,
      imageMode,
      imageModeLabel,
      imageCount,
      sourceImageCount,
      singleImageOutput: true,
      ignoredImageCount: Math.max(0, imageCount - sourceImageCount),
      safeMode: true,
    });
    pushQqSimulatorTimeline(ctx, 'ai.imageEditCommand', 'matched', {
      operation,
      imageMode,
      imageCount,
      singleImageOutput: true,
      priority: -1111,
    });
    pushQqSimulatorLog(ctx, 'info', '已命中图片编辑命令模拟规则', {
      operation,
      imageMode,
      imageCount,
      safeMode: true,
    });
    return true;
  }
  
  // 动态命令注册表兜底：手工白名单未命中的命令，从 apps/ 插件 rule 声明实时匹配。
  // 注册表只认命令前缀文本，且已过滤 ai.js 的万能聊天规则，不会抢走闲聊链路。
  function simulateQqRegistryCommand(payload = {}, ctx = {}) {
    const hit = commandRegistry.matchCommand(payload.messageText);
    if (!hit) return false;
    const permission = commandRegistry.checkCommandPermission(hit, payload);
    const display = hit.dsc || hit.fnc;
    ctx.replies.push(permission.ok
      ? `模拟结果：命中插件命令「${display}」（${hit.pluginFile} · ${hit.fnc}）。真实执行会调用该处理器；本次为安全模拟，未真实执行。`
      : `模拟结果：命中插件命令「${display}」，但该命令${permission.note}，当前模拟身份不满足，真实环境会拒绝执行。`);
    pushQqSimulatorAction(ctx, 'would_run_plugin_command', `命中插件命令：${display}`, {
      command: payload.messageText,
      fnc: hit.fnc,
      plugin: hit.pluginFile,
      pluginClass: hit.pluginClass,
      permission: hit.permission || '',
      permissionOk: permission.ok,
      priority: hit.priority,
      reg: hit.reg,
      safeMode: true,
    });
    pushQqSimulatorLog(ctx, 'info', '已命中插件命令注册表', { command: payload.messageText, fnc: hit.fnc, plugin: hit.pluginFile });
    return true;
  }

  async function simulateQqKnownCommand(payload = {}, ctx = {}) {
    const text = payload.messageText;
    if (simulateQqGroupManagementCommand(payload, ctx)) return true;
    if (await simulateQqImageEditCommand(payload, ctx)) return true;
    if (/^#申请头衔[\s\S]*$/.test(text)) {
      const title = text.replace(/^#申请头衔/, '').trim();
      ctx.replies.push('模拟结果：会提交群头衔申请；发放头衔需要 Bot 是群主。');
      pushQqSimulatorAction(ctx, 'would_apply_group_title', '会提交群头衔申请', {
        command: text,
        title,
        botRole: payload.botRole,
        canGrantTitle: isQqSimulatorBotOwner(payload),
      });
      if (!isQqSimulatorBotOwner(payload)) {
        pushQqSimulatorBotPermissionIssue(ctx, payload, '发放群头衔', 'owner');
      }
      return true;
    }
    if (/^#(同意|拒绝)头衔(?:\s|$)[\s\S]*$/.test(text)) {
      const approving = /^#同意头衔/.test(text);
      if (!isQqSimulatorManager(payload)) {
        ctx.replies.push('模拟结果：当前用户不是群主、管理员或主人，不能审核头衔申请。');
        pushQqSimulatorAction(ctx, 'would_reject_group_title_review_permission', '头衔审核用户权限不足', {
          command: text,
          userRole: payload.role,
          isMaster: payload.isMaster,
        });
        return true;
      }
      if (approving && !isQqSimulatorBotOwner(payload)) {
        ctx.replies.push('模拟结果：审核用户有权限，但 Bot 不是群主，真实环境无法发放群头衔。');
        pushQqSimulatorBotPermissionIssue(ctx, payload, '发放群头衔', 'owner');
        return true;
      }
      ctx.replies.push(approving
        ? '模拟结果：会通过头衔申请并发放群头衔。'
        : '模拟结果：会拒绝头衔申请并通知申请人。');
      pushQqSimulatorAction(ctx, approving ? 'would_approve_group_title' : 'would_reject_group_title', approving ? '会通过头衔申请' : '会拒绝头衔申请', {
        command: text,
        botRole: payload.botRole,
      });
      return true;
    }
    if (/^#群总结$/.test(text)) {
      const historyCount = Array.isArray(payload.groupHistory) ? payload.groupHistory.length : 0;
      ctx.replies.push(historyCount > 0
        ? `模拟结果：会基于模拟调试提供的 ${historyCount} 条群历史进入群总结生成/读取流程。`
        : '模拟结果：会读取本群群聊总结；当前没有提供模拟群历史，若真实记录为空会提示暂无数据。');
      pushQqSimulatorAction(ctx, 'would_get_group_summary', '会进入群总结流程', {
        command: text,
        groupHistoryCount: historyCount,
        sample: (payload.groupHistory || []).slice(-3).map(formatQqSimulatorGroupHistoryLine),
      });
      return true;
    }
    const commandRules = [
      { pattern: /^#灵晶帮助(?:\s+[\s\S]+)?$/, reply: '模拟结果：会进入灵晶帮助系统并返回对应帮助内容。', action: 'would_render_help' },
      { pattern: /^#头衔申请列表$/, reply: '模拟结果：会读取本群待审核头衔申请列表。', action: 'would_list_group_title_applications' },
      { pattern: /^#取消头衔申请$/, reply: '模拟结果：会取消当前用户本群待处理头衔申请。', action: 'would_cancel_group_title_application' },
      { pattern: /^#(开启|关闭)验证$/, reply: '模拟结果：会修改本群入群验证配置；真实执行需要群主、管理员或主人权限。', action: 'would_toggle_auth' },
      { pattern: /^#设置欢迎(文案|图片)[\s\S]*$/, reply: '模拟结果：会修改本群入群欢迎配置。', action: 'would_save_welcome' },
      { pattern: /^#查看欢迎$/, reply: '模拟结果：会查看本群入群欢迎配置。', action: 'would_view_welcome' },
      { pattern: /^#清除欢迎$/, reply: '模拟结果：会清除本群入群欢迎配置。', action: 'would_clear_welcome' },
      { pattern: /^#(点歌|听)\s*[\s\S]+$/, reply: '模拟结果：会进入点歌流程。', action: 'would_run_music' },
      { pattern: /^#rss(添加|列表|移除|拉取)[\s\S]*$/, reply: '模拟结果：会进入 RSS 订阅流程。', action: 'would_run_rss' },
    ];
    for (const rule of commandRules) {
      if (rule.pattern.test(text)) {
        ctx.replies.push(rule.reply);
        pushQqSimulatorAction(ctx, rule.action, rule.reply, { command: text });
        return true;
      }
    }
    if (simulateQqRegistryCommand(payload, ctx)) return true;
    return false;
  }
  
  function simulateQqReplayDispatch(payload = {}, ctx = {}) {
    if (!['replay', 'live-image'].includes(payload.dispatchMode)) {
      return;
    }
    pushQqSimulatorTimeline(ctx, payload.dispatchMode === 'live-image' ? '真实生图模式' : '链路回放模式', 'start', {
      eventType: payload.eventType,
      note: payload.dispatchMode === 'live-image'
        ? '按插件事件顺序回放，并仅允许图片编辑命令真实调用图像接口；不发送真实群消息。'
        : '按插件常见事件顺序回放命中情况；保持安全模拟，不执行真实写入或群操作。',
    });
  
    if (payload.eventType === 'private_message') {
      const mainConfig = ctx.allConfigs.config || {};
      const accessDecision = getQqSimulatorPrivateAccessDecision(mainConfig, payload);
      const stages = [
        {
          name: 'ai.private.globalSwitch',
          matched: mainConfig.ai !== false && mainConfig.privateAi !== false,
          detail: { ai: mainConfig.ai !== false, privateAi: mainConfig.privateAi !== false },
        },
        {
          name: 'ai.private.userAccess',
          matched: accessDecision.allow,
          detail: { reason: accessDecision.reason },
        },
        {
          name: 'ai.private.safety',
          matched: mainConfig.privateAiSafety?.enabled !== false,
        },
        {
          name: 'ai.private.chat',
          matched: mainConfig.ai !== false && mainConfig.privateAi !== false && accessDecision.allow,
        },
      ];
      stages.forEach(stage => {
        pushQqSimulatorTimeline(ctx, stage.name, stage.matched ? 'matched' : 'skipped', stage.detail || {});
      });
      return;
    }

    if (payload.eventType === 'message') {
      const text = payload.messageText || '';
      const command = isQqSimulatorCommand(text);
      const stages = [
        {
          name: 'group-management-runtime.toggleGroupManagement',
          matched: /^#灵晶\s*(开启|关闭)群管理$/.test(text),
          priority: -20,
        },
        {
          name: 'group-title.apply/list/review/cancel',
          matched: /^#(申请头衔|头衔申请列表|同意头衔|拒绝头衔|取消头衔申请)(?:\s|$)[\s\S]*/.test(text),
        },
        {
          name: 'help.render',
          matched: /^#灵晶帮助(?:\s+[\s\S]+)?$/.test(text),
        },
        {
          name: 'group-summary.get',
          matched: /^#群总结$/.test(text),
          detail: { groupHistoryCount: payload.groupHistory?.length || 0 },
        },
        {
          name: 'ai.imageEditCommand',
          matched: /^[#＃\/]?灵晶\s*(改图|融合)(?:[：:，,\s]+)?[\s\S]*$/.test(text),
          priority: -1111,
          detail: { imageCount: payload.images.length },
        },
        {
          name: 'image-monitor.review',
          matched: payload.images.length > 0,
          detail: { imageCount: payload.images.length },
        },
        {
          name: 'group-management-runtime.contentModeration',
          matched: true,
          priority: -20,
        },
        {
          name: 'ai.chat',
          matched: !command && payload.includeAt,
          detail: { includeAt: payload.includeAt, command },
        },
      ];
      // 插件命令注册表：动态解析 apps/ rule 声明，白名单阶段未覆盖的命令在这里呈现可达性
      const registryHit = commandRegistry.matchCommand(text);
      stages.push({
        name: 'plugin-command.registry',
        matched: Boolean(registryHit),
        detail: registryHit
          ? {
              command: text,
              fnc: registryHit.fnc,
              plugin: registryHit.pluginFile,
              permission: registryHit.permission || '',
              priority: registryHit.priority,
            }
          : { command: text },
      });
      stages.forEach(stage => {
        pushQqSimulatorTimeline(ctx, stage.name, stage.matched ? 'matched' : 'skipped', {
          priority: stage.priority,
          ...(stage.detail || {}),
        });
      });
      return;
    }
  
    if (payload.eventType === 'join_request') {
      pushQqSimulatorTimeline(ctx, 'auth.joinRequestAutoApprove', 'matched', {
        botRole: payload.botRole,
        requiresBotRole: 'admin',
      });
      return;
    }
  
    if (payload.eventType === 'group_increase') {
      pushQqSimulatorTimeline(ctx, 'group-management.rememberNewMember', 'matched', {});
      pushQqSimulatorTimeline(ctx, 'welcome.newcomer', 'matched', {
        botRole: payload.botRole,
      });
      return;
    }
  
    if (payload.eventType === 'poke') {
      pushQqSimulatorTimeline(ctx, 'poke.reply', 'matched', {});
    }
  }
  
  function simulateQqImageMonitor(payload = {}, ctx = {}) {
    if (payload.eventType !== 'message') return;
    if (payload.images.length === 0) return;
    const mainConfig = ctx.allConfigs.config || {};
    const imageConfig = ctx.allConfigs.imageMonitor || {};
    const allowedGroups = normalizeGroupIdList(imageConfig.allowedGroups);
    const blockedGroups = normalizeGroupIdList(imageConfig.blockedGroups);
    const effective = mainConfig.imageMonitor !== false
      && imageConfig.enabled === true
      && !blockedGroups.includes(payload.groupId)
      && (allowedGroups.length === 0 || allowedGroups.includes(payload.groupId));
    if (!effective) {
      pushQqSimulatorLog(ctx, 'info', '图片监控未对当前群生效', {
        imageCount: payload.images.length,
        mainEnabled: mainConfig.imageMonitor !== false,
        monitorEnabled: imageConfig.enabled === true,
      });
      return;
    }
    payload.images.forEach((imageUrl, index) => {
      pushQqSimulatorAction(ctx, 'would_review_image', `会审核第 ${index + 1} 张图片`, {
        imageUrl: redactQqSimulatorMediaUrl(imageUrl),
        model: imageConfig.model || '',
        action: imageConfig.violationAction || 'record',
        safeMode: true,
      });
    });
  }
  
  function simulateQqContentModeration(payload = {}, ctx = {}) {
    if (payload.eventType !== 'message') return;
    const mainConfig = ctx.allConfigs.config || {};
    if (mainConfig.groupManagement === false) {
      pushQqSimulatorLog(ctx, 'info', '群管理总开关关闭，群消息风控不会运行');
      return;
    }
    const state = getGroupModerationState(payload.groupId);
    const content = normalizeGroupContentModerationConfig(state.content || {});
    if (!content.enabled) {
      pushQqSimulatorLog(ctx, 'info', '本群消息风控未开启');
      return;
    }
    if (content.exemptAdmins && (payload.isMaster || payload.role === 'owner' || payload.role === 'admin')) {
      pushQqSimulatorLog(ctx, 'info', '发送者是管理身份，已按配置跳过消息风控');
      return;
    }
    const signals = [];
    const text = [
      payload.messageText,
      payload.voice?.transcript || '',
      payload.voice ? `[语音:${payload.voice.name || 'voice-message'}]` : '',
      ...payload.images.map(redactQqSimulatorMediaUrl),
    ].join('\n');
    const urlPattern = /(https?:\/\/|www\.|mqqapi:|qm\.qq\.com|jq\.qq\.com|t\.cn\/|b23\.tv\/|tb\.cn\/)/i;
    if (content.detectLinks && urlPattern.test(text)) signals.push('包含链接');
    if (content.detectBlockedKeywords) {
      const matched = (content.blockedKeywords || []).find(keyword => keyword && text.includes(keyword));
      if (matched) signals.push(`命中关键词: ${matched}`);
    }
    if (signals.length === 0) {
      pushQqSimulatorLog(ctx, 'info', '本群消息风控已开启，本次消息未命中风险信号');
      return;
    }
    const reason = signals.join('；');
    const requestedAction = content.action || 'log';
    if (['recall', 'mute', 'kick'].includes(requestedAction)) {
      pushQqSimulatorBotPermissionIssue(ctx, payload, `群消息风控动作 ${requestedAction}`, 'admin');
    }
    pushQqSimulatorAction(ctx, 'would_content_moderation', `群消息风控会触发：${reason}`, {
      requestedAction,
      muteSeconds: content.muteSeconds || 600,
      addWarning: content.addWarning === true,
      botRole: payload.botRole,
      safeMode: true,
    });
    ctx.replies.push(`模拟风控提醒：${reason}`);
  }
  
  async function simulateQqAiReply(payload = {}, ctx = {}) {
    if (!isQqSimulatorMessageEvent(payload.eventType)) return;
    if (isQqSimulatorCommand(payload.messageText)) return;
    const mainConfig = ctx.allConfigs.config || {};
    const privateMessage = isQqSimulatorPrivateMessageEvent(payload.eventType);
    if (mainConfig.ai === false) {
      pushQqSimulatorLog(ctx, 'info', 'AI 总开关关闭，普通消息不会触发 AI 回复');
      return;
    }
    if (privateMessage && mainConfig.privateAi === false) {
      pushQqSimulatorLog(ctx, 'info', '私聊 AI 总开关关闭，私聊消息不会触发 AI 回复');
      return;
    }
    if (privateMessage) {
      const accessDecision = getQqSimulatorPrivateAccessDecision(mainConfig, payload);
      if (!accessDecision.allow) {
        pushQqSimulatorAction(ctx, 'private_ai_access_denied', `私聊 AI 访问被拒绝：${accessDecision.reason}`, {
          userId: payload.userId,
          safeMode: true,
        });
        ctx.replies.push('你暂时没有使用私聊 AI 的权限。');
        return;
      }
      pushQqSimulatorLog(ctx, 'info', `私聊 AI 用户范围检查通过：${accessDecision.reason}`);
    }
    if (!privateMessage && !payload.includeAt) {
      pushQqSimulatorLog(ctx, 'info', '消息未 @Bot，模拟调试按未直接触发 AI 处理');
      return;
    }
    try {
      const aiPrompt = buildQqSimulatorAiPrompt(payload);
      const sandbox = await runSandboxChat({
        prompt: aiPrompt,
        sessionId: privateMessage
          ? `qq-simulator-private-${payload.userId}`
          : `qq-simulator-${payload.groupId}-${payload.userId}`,
        userId: payload.userId,
        userName: payload.nickname,
        groupId: privateMessage ? null : payload.groupId,
        groupName: privateMessage ? '私聊' : `群 ${payload.groupId}`,
        history: payload.history,
        imageUrls: payload.images,
        contextNote: getQqSimulatorMemeContextNote(ctx),
      });
      const memeRequest = inferQqSimulatorMemeRequest(payload, ctx);
      const sandboxReply = String(sandbox.reply || '');
      const sandboxHasMeme = /\[meme:[^\]]+\]/i.test(sandboxReply) || Boolean(sandbox.emojiPath);
      const shouldForceMeme = Boolean(memeRequest && !sandboxHasMeme);
      const suppressReply = shouldForceMeme && shouldSuppressQqSimulatorMemeText(sandboxReply, payload.messageText);
      if (sandboxReply && !suppressReply) await appendQqSimulatorAiReply(ctx, sandboxReply);
      if (sandbox.emojiPath) {
        await appendQqSimulatorImagePathReply(ctx, sandbox.emojiPath, 'Bot 表情包', {
          source: 'chat_engine_emoji',
        });
      }
      if (shouldForceMeme) {
        const forcedMeme = await resolveQqSimulatorMemeSegment(ctx, memeRequest, {
          actionType: 'would_send_meme_from_user_request',
          actionMessage: '用户明确要求表情包，模拟调试已按配置补发表情包图片',
          failedActionType: 'meme_request_resolution_failed',
          failedActionMessage: '用户明确要求表情包，但模拟调试解析表情包失败',
        });
        ctx.replies.push([forcedMeme]);
      }
      if (Array.isArray(sandbox.voiceMessages) && sandbox.voiceMessages.length > 0) {
        ctx.voiceMessages.push(...sandbox.voiceMessages);
        pushQqSimulatorAction(ctx, 'sandbox_voice_messages', '沙箱 AI 生成了语音回复', {
          voiceCount: sandbox.voiceMessages.length,
        });
      }
      if (Array.isArray(sandbox.toolCalls) && sandbox.toolCalls.length > 0) {
        pushQqSimulatorAction(ctx, 'sandbox_tool_calls', '沙箱 AI 触发了工具调用', {
          toolCalls: sandbox.toolCalls,
        });
      }
      ctx.debug.sandboxChat = {
        elapsedMs: sandbox.elapsedMs,
        sessionId: sandbox.sessionId,
        toolCallCount: Array.isArray(sandbox.toolCalls) ? sandbox.toolCalls.length : 0,
        voiceMessageCount: Array.isArray(sandbox.voiceMessages) ? sandbox.voiceMessages.length : 0,
        hasEmojiPath: Boolean(sandbox.emojiPath),
        emojiPath: sandbox.emojiPath ? redactQqSimulatorMediaUrl(sandbox.emojiPath) : '',
        forcedMemeFromRequest: shouldForceMeme,
        suppressedMemeRefusalReply: suppressReply,
        inferredMemeRequest: memeRequest,
        knowledgeMatchCount: Array.isArray(sandbox.knowledgeMatches) ? sandbox.knowledgeMatches.length : 0,
        request: sandbox.request,
        note: sandbox.note,
      };
    } catch (error) {
      ctx.errors.push(`AI 沙箱回复失败：${error.message}`);
      pushQqSimulatorLog(ctx, 'warn', 'AI 沙箱回复失败，真实群聊中也可能无法完成回复', { error: error.message });
    }
  }
  
  function simulateQqJoinRequest(payload = {}, ctx = {}) {
    const authConfig = ctx.allConfigs.auth || {};
    const applicant = isPlainObject(payload.applicant) ? payload.applicant : {};
    const profile = {
      groupId: payload.groupId,
      userId: payload.userId,
      nickname: payload.nickname,
      comment: payload.comment,
      age: applicant.age,
      qqLevel: applicant.qqLevel,
      sex: applicant.sex || '',
      raw: {
        qqLevel: applicant.qqLevel,
        age: applicant.age,
        sex: applicant.sex || '',
        warningCount: applicant.warningCount,
        listStatus: applicant.listStatus || 'normal',
      },
    };
    const autoConfig = getJoinRequestAutoApproveConfig(authConfig, payload.groupId);
    const storedModeration = getGroupMemberModeration(payload.groupId, payload.userId);
    const moderation = {
      ...storedModeration,
      warning: { ...(storedModeration.warning || {}) },
    };
    if (applicant.warningCount !== null && applicant.warningCount !== undefined) {
      moderation.warningCount = Number(applicant.warningCount || 0);
      moderation.warning.count = moderation.warningCount;
    }
    if (applicant.listStatus === 'blacklist') {
      moderation.blacklisted = true;
      moderation.blacklistEntry = { userId: payload.userId, note: '模拟调试手动标记黑名单' };
      moderation.whitelisted = false;
      moderation.whitelistEntry = null;
    } else if (applicant.listStatus === 'whitelist') {
      moderation.whitelisted = true;
      moderation.whitelistEntry = { userId: payload.userId, note: '模拟调试手动标记白名单' };
      moderation.blacklisted = false;
      moderation.blacklistEntry = null;
    }
    const result = evaluateJoinRequestAutoApprove(autoConfig, profile, moderation);
    if (!autoConfig.enable) {
      pushQqSimulatorAction(ctx, 'would_keep_join_request_pending', '加群申请会保留人工审核', {
        reason: '未启用自动通过',
        profile,
        risk: result.risk,
      });
      return;
    }
    if (result.passed) {
      if (!isQqSimulatorBotManager(payload)) {
        pushQqSimulatorBotPermissionIssue(ctx, payload, '同意加群申请', 'admin');
        ctx.replies.push('模拟结果：规则满足自动通过，但 Bot 不是管理员或群主，真实环境无法同意加群申请。');
        return;
      }
      pushQqSimulatorAction(ctx, 'would_auto_approve_join_request', '会自动同意加群申请', {
        reason: result.reason,
        profile,
        risk: result.risk,
        botRole: payload.botRole,
        safeMode: true,
      });
    } else {
      pushQqSimulatorAction(ctx, 'would_keep_join_request_pending', '加群申请会保留人工审核', {
        reason: result.reason,
        profile,
        risk: result.risk,
      });
    }
    pushQqSimulatorLog(ctx, 'info', '已完成加群申请自动通过规则模拟', {
      autoApproveEnabled: autoConfig.enable,
      passed: result.passed,
      reason: result.reason,
      profile,
    });
  }
  
  function simulateQqGroupIncrease(payload = {}, ctx = {}) {
    const newcomerConfig = ctx.allConfigs.newcomer || {};
    const authConfig = ctx.allConfigs.auth || {};
    const welcomeConfig = getQqSimulatorWelcomeConfig(newcomerConfig, payload.groupId);
    if (!isQqSimulatorWelcomeEnabled(welcomeConfig)) {
      pushQqSimulatorLog(ctx, 'info', '本群入群欢迎未启用');
      return;
    }
    const authDefault = getGroupManagementDefaultAuthConfig(authConfig);
    const groupAuth = isPlainObject(authConfig.groups?.[payload.groupId])
      ? normalizeAuthGroupConfig(authConfig.groups[payload.groupId], authDefault)
      : authDefault;
    const plainWelcome = buildQqSimulatorPlainWelcome(payload, welcomeConfig);
    if (groupAuth.enable === true) {
      pushQqSimulatorAction(ctx, 'would_cache_pending_welcome', '会缓存欢迎消息，等待验证通过后发送', {
        welcome: plainWelcome,
        aiWelcome: isQqSimulatorAiWelcomeEnabled(welcomeConfig),
      });
    } else {
      ctx.replies.push(plainWelcome);
      pushQqSimulatorAction(ctx, 'would_send_welcome', '会发送入群欢迎', {
        aiWelcome: isQqSimulatorAiWelcomeEnabled(welcomeConfig),
        hasImage: Boolean(welcomeConfig.image),
        safeMode: true,
      });
    }
  }
  
  function normalizeQqSimulatorPokeReplyMode(pokeConfig = {}) {
    const mode = String(pokeConfig?.replyMode || '').trim().toLowerCase();
    if (mode === 'ai' || mode === 'normal' || mode === 'auto') return mode;
    if (pokeConfig?.aiReply === false) return 'normal';
    return 'auto';
  }

  function clampQqSimulatorProbability(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(1, Math.max(0, number));
  }

  function getQqSimulatorPokeFallbackPreview(ctx = {}, pokeConfig = {}) {
    const fallbackReplies = [
      '别戳啦，我在呢。',
      '干嘛呀，突然戳我一下。',
      '收到收到，别连戳啦。',
      '我看见啦，有事直接说。',
      '再戳我要反击啦。',
    ];
    const text = String(pokeConfig.fallbackReply || fallbackReplies[0]).trim();
    return text.slice(0, 120) || '我在。';
  }

  function renderQqSimulatorPokePrompt(template = '', vars = {}) {
    const source = String(template || '').trim()
      || '你是{{botName}}，正在群里被 {{operatorName}}(QQ:{{operatorId}}) 戳了一下。请像群友一样立刻回一句自然、短促、有点情绪的吐槽或互动话，不要解释，不要自我分析，不要使用列表，不要超过两句话。可以轻微调侃对方，但不要攻击、辱骂或过度重复。若已知群名为 {{groupName}}，可在语气上贴合群聊氛围。';
    return source.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '');
  }

  function sanitizeQqSimulatorPokeReply(text = '', maxReplies = 1) {
    const normalizedMaxReplies = Math.max(1, Number(maxReplies || 1));
    return String(text || '')
      .replace(/\r/g, '')
      .split(/\n---\n|\n{2,}/)
      .map(item => item.trim())
      .filter(Boolean)
      .flatMap(item => item.includes('\n') ? item.split('\n').map(line => line.trim()).filter(Boolean) : [item])
      .slice(0, normalizedMaxReplies)
      .join('\n\n')
      .slice(0, 120)
      .trim();
  }

  function buildQqSimulatorPokeAiPrompt(payload = {}, ctx = {}, maxReplyMessages = 1) {
    const historyLines = (payload.groupHistory || [])
      .slice(-8)
      .map(formatQqSimulatorGroupHistoryLine)
      .filter(Boolean);
    return [
      maxReplyMessages > 1
        ? `请最多输出 ${maxReplyMessages} 条短句，并使用空行或 \\n---\\n 分隔成多条消息，不要编号。`
        : '请只输出 1 条短句。',
      `${payload.nickname || `QQ${payload.userId}`} 刚刚戳了你一下，请立即回复一句。`,
      historyLines.length > 0 ? `最近群聊上下文：\n${historyLines.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
  }

  async function simulateQqPoke(payload = {}, ctx = {}) {
    const mainConfig = ctx.allConfigs.config || {};
    const pokeConfig = ctx.allConfigs.poke || {};
    if (mainConfig.poke === false) {
      pushQqSimulatorLog(ctx, 'info', '戳一戳功能关闭，不会触发回复');
      return;
    }
    const replyMode = normalizeQqSimulatorPokeReplyMode(pokeConfig);
    const maxReplyMessages = Math.max(1, Number(pokeConfig.maxReplyMessages || 1) || 1);
    const enableTextReply = pokeConfig.enableTextReply !== false;
    const enableVoiceReply = pokeConfig.enableVoiceReply === true;
    const enableMemeReply = pokeConfig.enableMemeReply === true;
    const replyPokeProbability = clampQqSimulatorProbability(pokeConfig.replyPoke, 0);
    const voiceReplyProbability = clampQqSimulatorProbability(pokeConfig.voiceReplyProbability, 0);
    const memeReplyProbability = clampQqSimulatorProbability(pokeConfig.memeReplyProbability, 0);
    const cooldownMs = Math.max(0, Number(pokeConfig.cooldownMs || 0) || 0);
    const groupRateWindowMs = Math.max(1000, Number(pokeConfig.groupRateWindowMs || 60000) || 60000);
    const groupRateMaxReplies = Math.max(1, Number(pokeConfig.groupRateMaxReplies || 6) || 6);

    pushQqSimulatorAction(ctx, 'would_handle_poke', '会进入戳一戳回复流程', {
      groupId: payload.groupId,
      userId: payload.userId,
      operatorId: payload.userId,
      targetId: ctx.botId,
      replyMode,
      enableTextReply,
      maxReplyMessages,
      cooldownMs,
      groupRateWindowMs,
      groupRateMaxReplies,
      safeMode: true,
    });
    if (enableTextReply) {
      const fallbackPreview = getQqSimulatorPokeFallbackPreview(ctx, pokeConfig);
      let aiReplied = false;
      if (replyMode !== 'normal' && mainConfig.ai !== false) {
        try {
          const systemPrompt = renderQqSimulatorPokePrompt(pokeConfig.prompt, {
            botName: ctx.botName || 'Bot',
            operatorName: payload.nickname || `QQ${payload.userId}`,
            groupName: `群 ${payload.groupId}`,
            operatorId: String(payload.userId || ''),
          });
          const sandbox = await runSandboxChat({
            prompt: buildQqSimulatorPokeAiPrompt(payload, ctx, maxReplyMessages),
            systemPrompt,
            sessionId: `qq-simulator-poke-${payload.groupId}-${payload.userId}`,
            userId: payload.userId,
            userName: payload.nickname,
            groupId: payload.groupId,
            groupName: `群 ${payload.groupId}`,
            botName: ctx.botName || 'Bot',
            history: payload.history,
            groupHistory: payload.groupHistory,
            contextNote: getQqSimulatorMemeContextNote(ctx),
            model: String(pokeConfig.model || '').trim() || undefined,
            temperature: pokeConfig.temperature ?? 0.9,
            maxTokens: pokeConfig.maxTokens ?? 80,
          });
          const reply = sanitizeQqSimulatorPokeReply(sandbox.reply, maxReplyMessages);
          if (reply) {
            await appendQqSimulatorAiReply(ctx, reply);
            aiReplied = true;
            pushQqSimulatorAction(ctx, 'sandbox_poke_ai_reply', '沙箱 AI 已生成戳一戳回复', {
              elapsedMs: sandbox.elapsedMs,
              sessionId: sandbox.sessionId,
              safeMode: true,
            });
          }
          if (sandbox.emojiPath) {
            await appendQqSimulatorImagePathReply(ctx, sandbox.emojiPath, '戳一戳表情包', {
              source: 'poke_sandbox_emoji',
            });
          }
          if (Array.isArray(sandbox.voiceMessages) && sandbox.voiceMessages.length > 0) {
            ctx.voiceMessages.push(...sandbox.voiceMessages);
          }
          ctx.debug.sandboxPoke = {
            elapsedMs: sandbox.elapsedMs,
            sessionId: sandbox.sessionId,
            request: sandbox.request,
            hasEmojiPath: Boolean(sandbox.emojiPath),
            emojiPath: sandbox.emojiPath ? redactQqSimulatorMediaUrl(sandbox.emojiPath) : '',
            note: sandbox.note,
          };
        } catch (error) {
          pushQqSimulatorLog(ctx, 'warn', '戳一戳 AI 沙箱回复失败，已使用兜底文案', { error: error.message });
        }
      }
      if (!aiReplied) {
        ctx.replies.push(fallbackPreview);
      }
    } else {
      pushQqSimulatorLog(ctx, 'info', '戳一戳文本回复关闭，本次模拟不会产生文本气泡');
    }

    if (enableVoiceReply) {
      pushQqSimulatorAction(ctx, 'maybe_send_poke_voice', '戳一戳可能发送语音回复', {
        probability: voiceReplyProbability,
        safeMode: true,
      });
    }
    if (enableMemeReply) {
      pushQqSimulatorAction(ctx, 'maybe_send_poke_meme', '戳一戳可能发送表情包回复', {
        probability: memeReplyProbability,
        emotion: pokeConfig.pokeMemeEmotion || 'default',
        safeMode: true,
      });
    }
    if (replyPokeProbability > 0) {
      pushQqSimulatorAction(ctx, 'maybe_reply_poke', '戳一戳后可能回戳操作者', {
        probability: replyPokeProbability,
        targetId: payload.userId,
        safeMode: true,
      });
    }
    if (pokeConfig.followGroupAfterPoke === true) {
      pushQqSimulatorAction(ctx, 'would_start_poke_follow_window', '戳一戳后会短暂继续监听群聊', {
        windowMs: Math.max(1000, Number(pokeConfig.followGroupWindowMs || 10000) || 10000),
        maxReplies: Math.max(0, Number(pokeConfig.followGroupMaxReplies || 1) || 0),
        safeMode: true,
      });
    }
  }
  
  async function buildQqSimulatorSendPayload(payload = {}) {
    const normalized = normalizeQqSimulatorPayload(payload);
    const ctx = createQqSimulatorContext(normalized);
    const event = getQqSimulatorEventPayload(normalized, ctx);
    ctx.debug.event = event;
    ctx.debug.adapterEventKeys = Object.keys(event || {});
    ctx.debug.groupHistory = {
      count: normalized.groupHistory.length,
      preview: normalized.groupHistory.slice(-5).map(formatQqSimulatorGroupHistoryLine),
      getChatHistoryMock: `e.group.getChatHistory(...) => ${normalized.groupHistory.length} messages`,
    };
  
    pushQqSimulatorTimeline(ctx, '接收模拟请求', 'start', {
      eventType: normalized.eventType,
      dispatchMode: normalized.dispatchMode,
      adapterFormat: normalized.adapterFormat,
      groupHistoryCount: normalized.groupHistory.length,
      userRole: normalized.role,
      botRole: normalized.botRole,
    });
  
    pushQqSimulatorLog(ctx, 'info', '已构造模拟调试事件', {
      eventType: normalized.eventType,
      groupId: normalized.groupId,
      userId: normalized.userId,
      adapterFormat: normalized.adapterFormat,
      groupHistoryCount: normalized.groupHistory.length,
    });
  
    pushQqSimulatorTimeline(ctx, '适配器事件格式', 'info', {
      adapterFormat: normalized.adapterFormat,
      messageShape: Array.isArray(event?.message)
        ? event.message.map(item => item?.type || typeof item).join(',') || 'empty-array'
        : typeof event?.message,
      groupHistoryCount: normalized.groupHistory.length,
      appName: event?.bot?.version?.app_name || 'unknown',
    });
  
    simulateQqReplayDispatch(normalized, ctx);
  
    if (isQqSimulatorMessageEvent(normalized.eventType)) {
      if (normalized.voice) {
        pushQqSimulatorAction(ctx, 'received_voice_attachment', '收到语音消息模拟输入', {
          voice: redactQqSimulatorVoice(normalized.voice),
          safeMode: true,
        });
      }
      let handledCommand = false;
      if (normalized.eventType === 'message') {
        handledCommand = await simulateQqKnownCommand(normalized, ctx);
      } else if (normalized.eventType === 'private_message') {
        // 私聊命令此前直接落进 AI 聊天（#灵晶状态 等会被当闲聊回答），注册表补上这一缺口
        handledCommand = simulateQqRegistryCommand(normalized, ctx);
      }
      if (normalized.eventType === 'message') {
        simulateQqImageMonitor(normalized, ctx);
        simulateQqContentModeration(normalized, ctx);
      }
      if (!handledCommand) {
        await simulateQqAiReply(normalized, ctx);
      }
    } else if (normalized.eventType === 'join_request') {
      simulateQqJoinRequest(normalized, ctx);
    } else if (normalized.eventType === 'group_increase') {
      simulateQqGroupIncrease(normalized, ctx);
    } else if (normalized.eventType === 'poke') {
      await simulateQqPoke(normalized, ctx);
    }
  
    return {
      success: ctx.errors.length === 0,
      event,
      replies: ctx.replies,
      actions: ctx.actions,
      voiceMessages: ctx.voiceMessages,
      timeline: ctx.timeline,
      logs: ctx.logs,
      errors: ctx.errors,
      debug: ctx.debug,
    };
  }
  
  function buildQqSimulatorPreviewPayload(payload = {}) {
    const normalized = normalizeQqSimulatorPayload(payload);
    const ctx = createQqSimulatorContext(normalized);
    const event = getQqSimulatorEventPayload(normalized, ctx);
    const messageShape = Array.isArray(event?.message)
      ? event.message.map(item => item?.type || typeof item).join(',') || 'empty-array'
      : typeof event?.message;
  
    return {
      success: true,
      event,
      preview: {
        adapterFormat: normalized.adapterFormat,
        eventType: normalized.eventType,
        messageShape,
        messageCount: Array.isArray(event?.message) ? event.message.length : 0,
        groupHistoryCount: normalized.groupHistory.length,
        adapterEventKeys: Object.keys(event || {}),
        appName: event?.bot?.version?.app_name || 'unknown',
      },
      debug: {
        payload: redactQqSimulatorPayload(normalized),
        groupHistory: {
          count: normalized.groupHistory.length,
          preview: normalized.groupHistory.slice(-5).map(formatQqSimulatorGroupHistoryLine),
          getChatHistoryMock: `e.group.getChatHistory(...) => ${normalized.groupHistory.length} messages`,
        },
      },
    };
  }

  return {
    buildQqSimulatorPreviewPayload,
    buildQqSimulatorSendPayload,
    convertGroupManagementLogToScenarioPayload,
    listQqSimulatorScenariosPayload,
    buildQqSimulatorScenarioBackupListPayload,
    saveQqSimulatorScenarioPayload,
    importQqSimulatorScenariosPayload,
    deleteQqSimulatorScenarioPayload,
    clearQqSimulatorScenariosPayload,
    restoreQqSimulatorScenarioBackupPayload,
    enqueueQqSimulatorScenarioTask,
  };
}
