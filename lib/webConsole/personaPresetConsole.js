import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';

const PERSONA_PRESET_FIELDS = [
  'profile.nickName',
  'ai.botPersona',
  'ai.personality.states',
  'ai.personality.stateProbability',
  'ai.replyStyle.baseStyle',
  'ai.replyStyle.multipleStyles',
  'ai.replyStyle.multipleProbability',
];

const MAX_PRESET_COUNT = 50;
const MAX_NAME_LENGTH = 24;

function createPersonaPresetConsole(options = {}) {
  const logger = options.logger || console;
  const presetFile = path.join(Path.config, 'persona-presets.json');

  function readPresetStore() {
    try {
      if (!fs.existsSync(presetFile)) {
        return { version: 1, presets: {} };
      }
      const raw = JSON.parse(fs.readFileSync(presetFile, 'utf8'));
      const presets = raw && typeof raw === 'object' && raw.presets && typeof raw.presets === 'object'
        ? raw.presets
        : {};
      const cleaned = {};
      for (const [name, value] of Object.entries(presets)) {
        if (!name || !value || typeof value !== 'object' || !value.fields || typeof value.fields !== 'object') continue;
        const fields = {};
        for (const field of PERSONA_PRESET_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(value.fields, field)) {
            fields[field] = value.fields[field];
          }
        }
        cleaned[name] = { savedAt: String(value.savedAt || ''), fields };
      }
      return { version: 1, presets: cleaned };
    } catch (error) {
      logger.warn(`[persona-preset] 读取预设文件失败，按空处理: ${error.message}`);
      return { version: 1, presets: {} };
    }
  }

  function writePresetStore(store) {
    fs.mkdirSync(path.dirname(presetFile), { recursive: true });
    fs.writeFileSync(presetFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  }

  function listPersonaPresets() {
    const store = readPresetStore();
    const presets = Object.entries(store.presets)
      .map(([name, value]) => ({
        name,
        savedAt: value.savedAt,
        fieldCount: Object.keys(value.fields || {}).length,
      }))
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
    return { presets, total: presets.length };
  }

  function savePersonaPreset(payload = {}) {
    const name = String(payload?.name || '').trim();
    if (!name || Array.from(name).length > MAX_NAME_LENGTH) {
      const error = new Error(`预设名称需要 1-${MAX_NAME_LENGTH} 个字符`);
      error.code = 'INVALID_PRESET_NAME';
      throw error;
    }
    const source = payload?.fields && typeof payload.fields === 'object' ? payload.fields : {};
    const fields = {};
    for (const field of PERSONA_PRESET_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(source, field)) {
        fields[field] = source[field];
      }
    }
    if (Object.keys(fields).length === 0) {
      const error = new Error('预设内容为空，请先填写人设相关字段');
      error.code = 'EMPTY_PRESET_FIELDS';
      throw error;
    }

    const store = readPresetStore();
    const overwritten = Object.prototype.hasOwnProperty.call(store.presets, name);
    if (!overwritten && Object.keys(store.presets).length >= MAX_PRESET_COUNT) {
      const error = new Error(`预设数量已达上限 ${MAX_PRESET_COUNT} 个，请先删除不用的预设`);
      error.code = 'PRESET_LIMIT_REACHED';
      throw error;
    }
    store.presets[name] = { savedAt: new Date().toISOString(), fields };
    writePresetStore(store);
    return { name, savedAt: store.presets[name].savedAt, fieldCount: Object.keys(fields).length, overwritten };
  }

  function getPersonaPreset(payload = {}) {
    const name = String(payload?.name || '').trim();
    if (!name) {
      const error = new Error('缺少预设名称');
      error.code = 'MISSING_PRESET_NAME';
      throw error;
    }
    const store = readPresetStore();
    const preset = store.presets[name];
    if (!preset) {
      const error = new Error(`预设「${name}」不存在`);
      error.code = 'PRESET_NOT_FOUND';
      throw error;
    }
    return { name, savedAt: preset.savedAt, fields: preset.fields };
  }

  function deletePersonaPreset(payload = {}) {
    const name = String(payload?.name || '').trim();
    if (!name) {
      const error = new Error('缺少预设名称');
      error.code = 'MISSING_PRESET_NAME';
      throw error;
    }
    const store = readPresetStore();
    if (!Object.prototype.hasOwnProperty.call(store.presets, name)) {
      const error = new Error(`预设「${name}」不存在`);
      error.code = 'PRESET_NOT_FOUND';
      throw error;
    }
    delete store.presets[name];
    writePresetStore(store);
    return { name, deleted: true };
  }

  return {
    listPersonaPresets,
    savePersonaPreset,
    getPersonaPreset,
    deletePersonaPreset,
  };
}

export { createPersonaPresetConsole, PERSONA_PRESET_FIELDS };
