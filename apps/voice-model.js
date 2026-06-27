import plugin from '../../../lib/plugins/plugin.js';
import ConfigControl from '../lib/config/configControl.js';
import { listTtsModels } from '../lib/ai/ttsRegistry.js';
import {
  clearGroupVoiceModel,
  getGroupVoiceModelRecord,
  setGroupVoiceModel,
} from '../lib/ai/ttsGroupModelStore.js';

const PENDING_TTL_MS = 3 * 60 * 1000;
const LIST_LIMIT = 40;
const pendingSelections = new Map();

function getGroupRole(e = {}) {
  return String(e.sender?.role || e.member?.role || '').trim().toLowerCase();
}

function isGroupManager(e = {}) {
  const role = getGroupRole(e);
  return e.isMaster === true || role === 'owner' || role === 'admin';
}

function isVoiceModelEnabled() {
  const config = ConfigControl.get('config') || {};
  return config.voiceModel !== false;
}

function getGroupId(e = {}) {
  const text = String(e.group_id ?? e.groupId ?? e.gid ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function getUserId(e = {}) {
  return String(e.user_id ?? e.userId ?? e.sender?.user_id ?? '').trim();
}

function getPendingKey(e = {}) {
  return `${getGroupId(e)}:${getUserId(e)}`;
}

function prunePendingSelections() {
  const now = Date.now();
  for (const [key, pending] of pendingSelections.entries()) {
    if (!pending || Number(pending.expiresAt || 0) <= now) {
      pendingSelections.delete(key);
    }
  }
}

function normalizeLookupText(value = '') {
  return String(value || '')
    .trim()
    .replace(/[「」『』【】《》〈〉()（）\[\]_\-\s]/g, '')
    .toLowerCase();
}

function describeModel(item = {}) {
  const languages = Array.isArray(item.languages) ? item.languages : [];
  if (languages.length === 0) {
    return item.model || '-';
  }

  const first = languages[0] || {};
  const emotionText = Array.isArray(first.emotions) && first.emotions.length > 0
    ? first.emotions.slice(0, 4).join('、')
    : '默认';
  const extraLanguageCount = Math.max(0, languages.length - 1);
  const suffix = extraLanguageCount > 0 ? `，另 ${extraLanguageCount} 种语言` : '';
  return `${item.model}（${first.language || '未知'}：${emotionText}${suffix}）`;
}

function formatModelList(result = {}, currentModel = '') {
  const models = Array.isArray(result.models) ? result.models : [];
  const lines = [
    '请选择本群默认语音模型：',
    currentModel ? `当前本群：${currentModel}` : `当前本群：使用全局默认${result.defaultModel ? `（${result.defaultModel}）` : ''}`,
    '',
    ...models.slice(0, LIST_LIMIT).map((item, index) => `${index + 1}. ${describeModel(item)}`),
  ];

  if (models.length > LIST_LIMIT) {
    lines.push(`... 还有 ${models.length - LIST_LIMIT} 个模型未展示，可用完整模型名直接切换。`);
  }

  lines.push('', '回复编号即可切换，也可以发送：#灵晶切换语音模型 模型名');
  lines.push('发送 #灵晶重置语音模型 可回到全局默认。');
  return lines.join('\n');
}

function resolveModelInput(input = '', models = []) {
  const value = String(input || '').trim();
  if (!value) {
    return { ok: false, error: '请输入模型编号或模型名。' };
  }

  if (/^\d{1,3}$/.test(value)) {
    const index = Number(value);
    if (index < 1 || index > Math.min(models.length, LIST_LIMIT)) {
      return { ok: false, error: `编号超出范围，请输入 1-${Math.min(models.length, LIST_LIMIT)}。` };
    }
    return { ok: true, model: models[index - 1]?.model || '' };
  }

  const exact = models.find(item => String(item.model || '').trim() === value);
  if (exact) {
    return { ok: true, model: exact.model };
  }

  const lowerValue = value.toLowerCase();
  const caseInsensitive = models.find(item => String(item.model || '').trim().toLowerCase() === lowerValue);
  if (caseInsensitive) {
    return { ok: true, model: caseInsensitive.model };
  }

  const normalizedValue = normalizeLookupText(value);
  const normalizedMatches = models.filter(item => {
    const model = normalizeLookupText(item.model);
    return model && normalizedValue && model.includes(normalizedValue);
  });
  if (normalizedMatches.length === 1) {
    return { ok: true, model: normalizedMatches[0].model };
  }
  if (normalizedMatches.length > 1) {
    return {
      ok: false,
      error: [
        '匹配到多个模型，请输入更完整的模型名：',
        ...normalizedMatches.slice(0, 8).map((item, index) => `${index + 1}. ${item.model}`),
      ].join('\n'),
    };
  }

  return { ok: false, error: '没有找到这个语音模型，请先发送 #灵晶切换语音模型 查看列表。' };
}

async function loadModelList() {
  const result = await listTtsModels();
  if (!result?.success) {
    return {
      success: false,
      error: result?.error || '读取语音模型列表失败',
    };
  }

  return {
    success: true,
    defaultModel: result.defaultModel || '',
    models: Array.isArray(result.models) ? result.models : [],
  };
}

export default class CrystelfVoiceModel extends plugin {
  constructor() {
    super({
      name: 'crystelf-voice-model',
      dsc: '群内语音模型切换',
      event: 'message.group',
      priority: 4800,
      rule: [
        { reg: '^#灵晶语音模型$', fnc: 'showCurrentModel' },
        { reg: '^#灵晶切换语音模型$', fnc: 'showModelList' },
        { reg: '^#灵晶切换语音模型\\s+([\\s\\S]+)$', fnc: 'switchModelDirectly' },
        { reg: '^#灵晶重置语音模型$', fnc: 'resetModel' },
        { reg: '^\\d{1,3}$', fnc: 'selectPendingModel' },
      ],
    });
  }

  async showCurrentModel(e) {
    if (!isVoiceModelEnabled()) return false;

    const groupId = getGroupId(e);
    if (!groupId) {
      return e.reply('只能在群聊里查看语音模型。', true);
    }

    const record = getGroupVoiceModelRecord(groupId);
    const coreConfig = ConfigControl.get('coreConfig') || {};
    const defaultModel = String(coreConfig?.tools?.tts?.defaultModel || '').trim();
    if (!record) {
      return e.reply(`本群未单独设置语音模型，当前使用全局默认${defaultModel ? `：${defaultModel}` : '。'}`, true);
    }

    return e.reply([
      `本群语音模型：${record.model}`,
      record.updatedAt ? `设置时间：${record.updatedAt.replace('T', ' ').slice(0, 19)}` : '',
      '发送 #灵晶切换语音模型 可重新选择。',
    ].filter(Boolean).join('\n'), true);
  }

  async showModelList(e) {
    if (!isVoiceModelEnabled()) return false;

    if (!isGroupManager(e)) {
      return e.reply('只有群主、管理员或主人可以切换本群语音模型。', true);
    }

    const groupId = getGroupId(e);
    if (!groupId) {
      return e.reply('只能在群聊里切换语音模型。', true);
    }

    const result = await loadModelList();
    if (!result.success) {
      return e.reply(`语音模型列表读取失败：${result.error}`, true);
    }

    const currentModel = getGroupVoiceModelRecord(groupId)?.model || '';
    pendingSelections.set(getPendingKey(e), {
      groupId,
      userId: getUserId(e),
      models: result.models,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });

    return e.reply(formatModelList(result, currentModel), true);
  }

  async switchModelDirectly(e) {
    if (!isVoiceModelEnabled()) return false;

    if (!isGroupManager(e)) {
      return e.reply('只有群主、管理员或主人可以切换本群语音模型。', true);
    }

    const groupId = getGroupId(e);
    if (!groupId) {
      return e.reply('只能在群聊里切换语音模型。', true);
    }

    const input = String(e.msg || '').replace(/^#灵晶切换语音模型\s+/, '').trim();
    const result = await loadModelList();
    if (!result.success) {
      return e.reply(`语音模型列表读取失败：${result.error}`, true);
    }

    return this.applyModelSelection(e, groupId, input, result.models);
  }

  async selectPendingModel(e) {
    if (!isVoiceModelEnabled()) {
      pendingSelections.delete(getPendingKey(e));
      return false;
    }

    prunePendingSelections();
    const key = getPendingKey(e);
    const pending = pendingSelections.get(key);
    if (!pending) {
      return false;
    }

    if (!isGroupManager(e)) {
      pendingSelections.delete(key);
      return e.reply('只有群主、管理员或主人可以切换本群语音模型。', true);
    }

    return this.applyModelSelection(e, pending.groupId, e.msg, pending.models);
  }

  async resetModel(e) {
    if (!isVoiceModelEnabled()) return false;

    if (!isGroupManager(e)) {
      return e.reply('只有群主、管理员或主人可以重置本群语音模型。', true);
    }

    const groupId = getGroupId(e);
    if (!groupId) {
      return e.reply('只能在群聊里重置语音模型。', true);
    }

    clearGroupVoiceModel(groupId);
    pendingSelections.delete(getPendingKey(e));
    return e.reply('已重置本群语音模型，之后将使用全局默认语音模型。', true);
  }

  async applyModelSelection(e, groupId, input, models) {
    const resolved = resolveModelInput(input, models);
    if (!resolved.ok || !resolved.model) {
      return e.reply(resolved.error || '语音模型选择失败。', true);
    }

    setGroupVoiceModel(groupId, resolved.model, { operator: getUserId(e) });
    pendingSelections.delete(getPendingKey(e));
    return e.reply(`已切换本群默认语音模型：${resolved.model}`, true);
  }
}
