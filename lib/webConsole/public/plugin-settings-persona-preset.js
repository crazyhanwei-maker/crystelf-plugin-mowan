// 人设预设面板逻辑：保存当前表单为预设、从预设恢复到草稿、删除预设。
// 由 plugin-settings.html 在 plugin-settings-render.js 之后加载。

const PERSONA_PRESET_FIELD_LIST = [
  'profile.nickName',
  'ai.botPersona',
  'ai.personality.states',
  'ai.personality.stateProbability',
  'ai.replyStyle.baseStyle',
  'ai.replyStyle.multipleStyles',
  'ai.replyStyle.multipleProbability',
];

function getPersonaPresetElements() {
  return {
    select: document.getElementById('persona-preset-select'),
    nameInput: document.getElementById('persona-preset-name-input'),
    status: document.querySelector('[data-persona-preset-status]'),
  };
}

function setPersonaPresetStatus(message = '') {
  const { status } = getPersonaPresetElements();
  if (status) status.textContent = message;
  pluginSettingsState.personaPresetStatus = message;
}

function getSelectedPersonaPresetName() {
  const { select } = getPersonaPresetElements();
  return String(select?.value || '').trim();
}

async function refreshPersonaPresetPanel() {
  try {
    const data = await fetchJson('/api/persona-presets');
    pluginSettingsState.personaPresets = Array.isArray(data?.data?.presets) ? data.data.presets : [];
  } catch (error) {
    pluginSettingsState.personaPresets = [];
    setPersonaPresetStatus(`预设列表读取失败：${error.message}`);
  }
  if (typeof renderForm === 'function') {
    renderForm();
  }
}

async function saveCurrentAsPersonaPreset() {
  const { nameInput } = getPersonaPresetElements();
  const name = String(nameInput?.value || '').trim();
  if (!name) {
    setPersonaPresetStatus('请先填写预设名称。');
    return;
  }
  const fields = {};
  for (const field of PERSONA_PRESET_FIELD_LIST) {
    if (Object.prototype.hasOwnProperty.call(pluginSettingsState.draft || {}, field)) {
      fields[field] = pluginSettingsState.draft[field];
    }
  }
  try {
    const data = await postJson('/api/persona-presets/save', { name, fields });
    const result = data?.data || {};
    setPersonaPresetStatus(result.overwritten
      ? `已覆盖预设「${name}」（${result.fieldCount} 个字段）。`
      : `已保存预设「${name}」（${result.fieldCount} 个字段）。`);
    pluginSettingsState.personaPresetSelected = name;
    await refreshPersonaPresetPanel();
  } catch (error) {
    setPersonaPresetStatus(`保存预设失败：${error.message}`);
  }
}

async function applyPersonaPresetToDraft() {
  const name = getSelectedPersonaPresetName();
  if (!name) {
    setPersonaPresetStatus('请先选择要恢复的预设。');
    return;
  }
  try {
    const data = await fetchJson(`/api/persona-presets/get?name=${encodeURIComponent(name)}`);
    const fields = data?.data?.fields || {};
    let applied = 0;
    for (const field of PERSONA_PRESET_FIELD_LIST) {
      if (Object.prototype.hasOwnProperty.call(fields, field)) {
        pluginSettingsState.draft[field] = fields[field];
        applied++;
      }
    }
    if (typeof renderForm === 'function') {
      renderForm();
    }
    setPersonaPresetStatus(`已把预设「${name}」填入表单（${applied} 个字段），请检查后点击“保存设置”生效。`);
  } catch (error) {
    setPersonaPresetStatus(`读取预设失败：${error.message}`);
  }
}

async function deletePersonaPresetByName() {
  const name = getSelectedPersonaPresetName();
  if (!name) {
    setPersonaPresetStatus('请先选择要删除的预设。');
    return;
  }
  if (!window.confirm(`确定删除预设「${name}」吗？此操作不可撤销。`)) {
    return;
  }
  try {
    await postJson('/api/persona-presets/delete', { name });
    setPersonaPresetStatus(`已删除预设「${name}」。`);
    pluginSettingsState.personaPresetSelected = '';
    await refreshPersonaPresetPanel();
  } catch (error) {
    setPersonaPresetStatus(`删除预设失败：${error.message}`);
  }
}
