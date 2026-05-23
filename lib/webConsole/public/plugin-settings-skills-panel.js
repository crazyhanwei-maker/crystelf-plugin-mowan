function buildSkillsPayloadFromEditorConfig(editorPayload = {}) {
  const effectiveConfig = clonePayload(editorPayload?.effectiveConfig) || {};
  const runtimeConfig = clonePayload(editorPayload?.runtimeConfig) || {};
  const defaultConfig = clonePayload(editorPayload?.defaultConfig) || {};
  const effectiveDefinitions = Array.isArray(effectiveConfig.definitions) ? effectiveConfig.definitions : [];
  const runtimeDefinitions = Array.isArray(runtimeConfig.definitions) ? runtimeConfig.definitions : [];
  const defaultDefinitions = Array.isArray(defaultConfig.definitions) ? defaultConfig.definitions : [];
  const runtimeNameSet = new Set(runtimeDefinitions.map(item => String(item?.name || '').trim()).filter(Boolean));
  const defaultNameSet = new Set(defaultDefinitions.map(item => String(item?.name || '').trim()).filter(Boolean));
  const defaultTimeoutMs = Number(
    effectiveConfig.defaultTimeoutMs
    || runtimeConfig.defaultTimeoutMs
    || defaultConfig.defaultTimeoutMs
    || 15000
  );
  const definitions = effectiveDefinitions
    .filter(item => item?.name)
    .map((item) => {
      const name = String(item.name || '').trim();
      const tools = (Array.isArray(item.tools) ? item.tools : [])
        .filter(tool => tool?.name)
        .map((tool) => {
          const properties = tool?.parameters?.properties;
          return {
            name: String(tool.name || '').trim(),
            enabled: tool.enabled !== false,
            description: String(tool.description || '').trim(),
            method: String(tool?.request?.method || 'GET').trim().toUpperCase(),
            parameterCount: properties && typeof properties === 'object' ? Object.keys(properties).length : 0,
            requiredParameters: Array.isArray(tool?.parameters?.required)
              ? tool.parameters.required.map(entry => String(entry || '').trim()).filter(Boolean)
              : [],
          };
        });
      return {
        name,
        enabled: item.enabled !== false,
        description: String(item.description || '').trim(),
        timeoutMs: Number(item.timeoutMs || defaultTimeoutMs || 15000),
        toolCount: tools.length,
        enabledToolCount: tools.filter(tool => tool.enabled).length,
        allowedHosts: Array.isArray(item.allowedHosts)
          ? item.allowedHosts.map(host => String(host || '').trim()).filter(Boolean)
          : [],
        origin: defaultNameSet.has(name) ? 'builtin' : 'custom',
        customized: runtimeNameSet.has(name),
        tools,
      };
    });

  return {
    enabled: effectiveConfig.enabled === true,
    autoLoad: effectiveConfig.autoLoad !== false,
    defaultTimeoutMs,
    definitionCount: definitions.length,
    enabledDefinitionCount: definitions.filter(item => item.enabled).length,
    toolCount: definitions.reduce((sum, item) => sum + Number(item.toolCount || 0), 0),
    enabledToolCount: definitions.reduce((sum, item) => sum + Number(item.enabledToolCount || 0), 0),
    builtinDefinitionCount: definitions.filter(item => item.origin === 'builtin').length,
    customDefinitionCount: definitions.filter(item => item.origin === 'custom').length,
    definitions,
  };
}

function syncSkillsDraftFromPayload() {
  const payload = clonePayload(pluginSettingsState.payload?.skills) || {};
  const editorFallback = buildSkillsPayloadFromEditorConfig(pluginSettingsState.skillsEditorPayload || {});
  const bundledFallback = (!pluginSettingsState.payload?.skills && pluginSettingsState.skillsEditorPayload?.supported === false)
    ? clonePayload(BUNDLED_SKILL_FALLBACK_CONFIG)
    : null;
  const payloadDefinitions = Array.isArray(payload.definitions) ? payload.definitions : [];
  const fallbackDefinitions = Array.isArray(editorFallback.definitions) ? editorFallback.definitions : [];
  const bundledDefinitions = Array.isArray(bundledFallback?.definitions) ? bundledFallback.definitions : [];
  const definitions = payloadDefinitions.length > 0 ? payloadDefinitions : fallbackDefinitions.length > 0 ? fallbackDefinitions : bundledDefinitions;
  const enabled = typeof payload.enabled === 'boolean'
    ? payload.enabled
    : (typeof editorFallback.enabled === 'boolean' ? editorFallback.enabled : bundledFallback?.enabled === true);
  const autoLoad = typeof payload.autoLoad === 'boolean'
    ? payload.autoLoad
    : (typeof editorFallback.autoLoad === 'boolean' ? editorFallback.autoLoad : bundledFallback?.autoLoad !== false);
  const defaultTimeoutMs = Number(payload.defaultTimeoutMs || editorFallback.defaultTimeoutMs || bundledFallback?.defaultTimeoutMs || 15000);
  pluginSettingsState.skillsDraft = {
    enabled,
    autoLoad,
    defaultTimeoutMs,
    previewOnly: bundledFallback?.previewOnly === true && payloadDefinitions.length === 0 && fallbackDefinitions.length === 0,
    previewReason: bundledFallback?.previewReason || '',
    definitionCount: definitions.length,
    enabledDefinitionCount: definitions.filter(item => item?.enabled).length,
    toolCount: definitions.reduce((sum, item) => sum + Number(item?.toolCount || 0), 0),
    enabledToolCount: definitions.reduce((sum, item) => sum + Number(item?.enabledToolCount || 0), 0),
    builtinDefinitionCount: definitions.filter(item => item?.origin === 'builtin').length,
    customDefinitionCount: definitions.filter(item => item?.origin === 'custom').length,
    definitions,
  };
}

function syncSkillsEditorFromSource(source = pluginSettingsState.skillsEditorSource || 'effective') {
  const payload = pluginSettingsState.skillsEditorPayload || {};
  const sourceMap = {
    effective: payload.effectiveConfig || {},
    runtime: payload.runtimeConfig || {},
    default: payload.defaultConfig || {},
  };
  pluginSettingsState.skillsEditorSource = source in sourceMap ? source : 'effective';
  pluginSettingsState.skillsEditorText = formatPrettyJson(sourceMap[pluginSettingsState.skillsEditorSource] || {});
}

function getParsedSkillsEditorConfig() {
  const text = String(pluginSettingsState.skillsEditorText || '').trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`原始工具配置格式错误：${error.message}`);
  }
}
