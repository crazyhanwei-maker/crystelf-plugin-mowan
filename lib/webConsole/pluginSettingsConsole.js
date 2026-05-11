const SETTINGS_CATEGORY_LABELS = {
  main: '主配置',
  core: '旧核心兼容',
  ai: 'AI',
  auth: '认证',
  extension: '扩展',
  other: '其他',
};

export function createPluginSettingsConsole(options = {}) {
  const ConfigControl = options.ConfigControl || options.configControl || { get: () => ({}), set: async () => {} };
  const guobaSchema = Array.isArray(options.guobaSchema) ? options.guobaSchema : [];
  const usageLogFile = String(options.usageLogFile || '');
  const getUsageOverviewSync = typeof options.getUsageOverviewSync === 'function'
    ? options.getUsageOverviewSync
    : (() => ({}));
  const getPricingConfig = typeof options.getPricingConfig === 'function'
    ? options.getPricingConfig
    : (() => ({}));
  const getSkillConfig = typeof options.getSkillConfig === 'function'
    ? options.getSkillConfig
    : (() => ({}));
  const readDefaultSkillConfig = typeof options.readDefaultSkillConfig === 'function'
    ? options.readDefaultSkillConfig
    : (() => ({}));
  const readRuntimeSkillConfig = typeof options.readRuntimeSkillConfig === 'function'
    ? options.readRuntimeSkillConfig
    : (() => ({}));
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode = 500, message = 'Internal Server Error', code = '') => {
        const error = new Error(String(message || 'Internal Server Error'));
        error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
        if (code) error.code = String(code);
        return error;
      });
  const hasConfiguredSecret = typeof options.hasConfiguredSecret === 'function'
    ? options.hasConfiguredSecret
    : (value => Boolean(String(value || '').trim()));
  const normalizeSensitiveConfigKeySegment = typeof options.normalizeSensitiveConfigKeySegment === 'function'
    ? options.normalizeSensitiveConfigKeySegment
    : (segment => String(segment || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const isSensitiveConfigKeySegment = typeof options.isSensitiveConfigKeySegment === 'function'
    ? options.isSensitiveConfigKeySegment
    : (() => false);

  function getSettingsCategory(field = '') {
    const prefix = String(field).split('.')[0];
    if (prefix === 'config') return 'main';
    if (prefix === 'coreConfig') return 'core';
    if (prefix === 'ai') return 'ai';
    if (prefix === 'auth') return 'auth';
    if (['60s', 'music', 'poke', 'profile'].includes(prefix)) return 'extension';
    return 'other';
  }
  
  function normalizePositiveNumber(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return fallback;
    }
    return Math.round(num);
  }
  
  function isReadonlySchemaItem(item = {}) {
    return item?.componentProps?.readonly === true;
  }
  
  function isSecretSchemaItem(item = {}) {
    return item?.component === 'InputPassword';
  }
  
  function maskPluginSettingsValue(item = {}, value) {
    if (!isSecretSchemaItem(item)) {
      return value;
    }
    return String(value || '').trim() ? '******' : '';
  }
  
  function flattenConfigObject(obj, prefix = '') {
    const result = {};
    for (const [key, value] of Object.entries(obj || {})) {
      if (String(key).startsWith('?')) continue;
      const nextKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, flattenConfigObject(value, nextKey));
      } else {
        result[nextKey] = value;
      }
    }
    return result;
  }
  
  function setByPath(target, pathKey, value) {
    const segments = String(pathKey).split('.');
    let current = target;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const key = segments[i];
      if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
        current[key] = {};
      }
      current = current[key];
    }
    current[segments[segments.length - 1]] = value;
  }
  
  function deepMerge(target, source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return source;
    }
    const output = Array.isArray(target) ? [...target] : { ...(target || {}) };
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        output[key] = deepMerge(output[key], value);
      } else {
        output[key] = value;
      }
    }
    return output;
  }
  
  function buildPluginSettingsValues() {
    const allConfigs = ConfigControl.get() || {};
    const values = flattenConfigObject(allConfigs);
    const usageOverview = getUsageOverviewSync(new Date(), getPricingConfig(allConfigs));
    values['coreConfig.usageControl.dailySummary'] = usageOverview.summary || '暂无今日用量数据';
    values['coreConfig.usageControl.dailySceneSummary'] = usageOverview.sceneSummary || '暂无今日场景统计';
    values['coreConfig.usageControl.dailyModelSummary'] = usageOverview.modelSummary || '暂无今日模型统计';
    values['coreConfig.usageControl.dailyCostSummary'] = usageOverview.costSummary || '暂无今日费用统计';
    values['coreConfig.usageControl.dailyModelCostSummary'] = usageOverview.modelCostSummary || '暂无今日模型费用统计';
    values['coreConfig.usageControl.dailyLogFile'] = usageLogFile;
    values['coreConfig.usageControl.totalLogFile'] = usageLogFile;
    values['coreConfig.tools.tts.modelSummary'] = '此项用于展示当前 TTS 模型摘要，具体内容请以实际配置和控制台返回结果为准。';
    return values;
  }
  
  function normalizeSchemaValue(item, value) {
    if (item.component === 'Switch') {
      return value === true || value === 'true';
    }
    if (item.component === 'InputNumber') {
      if (value === '' || value === null || value === undefined) return value;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : value;
    }
    if (item.component === 'InputArray') {
      return Array.isArray(value) ? value.map(item => String(item)) : [];
    }
    if (item.component === 'Select' && item.componentProps?.mode === 'multiple') {
      return Array.isArray(value) ? value : [];
    }
    return value;
  }
  
  function normalizeSkillTimeoutMs(value, fallback = 15000) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(Math.max(Math.round(numeric), 1000), 60000);
  }
  
  function cloneJsonValue(value, fallback = {}) {
    try {
      return JSON.parse(JSON.stringify(value == null ? fallback : value));
    } catch {
      return fallback;
    }
  }
  
  const SKILL_MASKED_SECRET_VALUE = '******';
  const SKILL_TEMPLATE_VALUE_PATTERN = /\{\{\s*[^}]+\s*\}\}/;
  
  function isSkillJsonSchemaPropertyPath(pathSegments = []) {
    const segments = (Array.isArray(pathSegments) ? pathSegments : []).map(item => String(item));
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index] === 'parameters' && segments[index + 1] === 'properties') {
        return true;
      }
    }
    return false;
  }
  
  function isSkillSensitivePath(pathSegments = []) {
    const segments = Array.isArray(pathSegments) ? pathSegments : [];
    const key = String(segments.at(-1) || '');
    return isSensitiveConfigKeySegment(key) && !isSkillJsonSchemaPropertyPath(segments);
  }
  
  function isSkillRequestUrlPath(pathSegments = []) {
    const segments = Array.isArray(pathSegments) ? pathSegments.map(item => String(item)) : [];
    return segments.at(-1) === 'url' && segments.includes('request');
  }
  
  function isSkillMaskedSecretPlaceholder(value) {
    return typeof value === 'string' && value.trim() === SKILL_MASKED_SECRET_VALUE;
  }
  
  function hasConcreteSkillSecretValue(value) {
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return hasConfiguredSecret(trimmed)
        && !isSkillMaskedSecretPlaceholder(trimmed)
        && !SKILL_TEMPLATE_VALUE_PATTERN.test(trimmed);
    }
    if (Array.isArray(value)) {
      return value.some(item => hasConcreteSkillSecretValue(item));
    }
    if (typeof value === 'object') {
      return Object.values(value).some(item => hasConcreteSkillSecretValue(item));
    }
    return false;
  }
  
  function shouldMaskSkillConfigValue(pathSegments = [], key = '', value) {
    const nextPath = [...(Array.isArray(pathSegments) ? pathSegments : []), String(key)];
    return isSkillSensitivePath(nextPath) && hasConcreteSkillSecretValue(value);
  }
  
  function isSensitiveUrlQueryKey(key = '') {
    const normalized = normalizeSensitiveConfigKeySegment(key);
    if (!normalized) {
      return false;
    }
    return normalized === 'key'
      || isSensitiveConfigKeySegment(key)
      || normalized.endsWith('apikey')
      || normalized.endsWith('authtoken')
      || normalized.endsWith('accesstoken')
      || normalized.endsWith('refreshtoken')
      || normalized.endsWith('authorization')
      || normalized.endsWith('password')
      || normalized.endsWith('passwd')
      || normalized.endsWith('secret')
      || normalized.endsWith('privatekey')
      || normalized.endsWith('accesskey');
  }
  
  function maskSkillRequestUrlSecrets(value) {
    if (typeof value !== 'string') {
      return value;
    }
    try {
      const parsed = new URL(value);
      let changed = false;
      for (const key of Array.from(new Set(Array.from(parsed.searchParams.keys())))) {
        const values = parsed.searchParams.getAll(key);
        if (isSensitiveUrlQueryKey(key) && values.some(item => hasConcreteSkillSecretValue(item))) {
          parsed.searchParams.delete(key);
          parsed.searchParams.append(key, SKILL_MASKED_SECRET_VALUE);
          changed = true;
        }
      }
      return changed ? parsed.toString() : value;
    } catch {
      return value;
    }
  }
  
  function maskDisplayUrlSecrets(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    try {
      const parsed = new URL(raw);
      let changed = false;
  
      if (parsed.username) {
        parsed.username = SKILL_MASKED_SECRET_VALUE;
        changed = true;
      }
      if (parsed.password) {
        parsed.password = SKILL_MASKED_SECRET_VALUE;
        changed = true;
      }
  
      for (const key of Array.from(new Set(Array.from(parsed.searchParams.keys())))) {
        const values = parsed.searchParams.getAll(key);
        if (isSensitiveUrlQueryKey(key) && values.some(item => hasConcreteSkillSecretValue(item))) {
          parsed.searchParams.delete(key);
          parsed.searchParams.append(key, SKILL_MASKED_SECRET_VALUE);
          changed = true;
        }
      }
  
      return changed ? parsed.toString() : raw;
    } catch {
      return raw;
    }
  }
  
  function maskSkillConfigSecrets(value, pathSegments = []) {
    if (Array.isArray(value)) {
      return value.map((item, index) => maskSkillConfigSecrets(item, [...pathSegments, String(index)]));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
  
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      isSkillRequestUrlPath([...(Array.isArray(pathSegments) ? pathSegments : []), key])
        ? maskSkillRequestUrlSecrets(item)
        : shouldMaskSkillConfigValue(pathSegments, key, item)
          ? SKILL_MASKED_SECRET_VALUE
          : maskSkillConfigSecrets(item, [...pathSegments, key]),
    ]));
  }
  
  function getValueByPath(source, pathSegments = []) {
    let current = source;
    for (const segment of pathSegments) {
      if (current == null) {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }
  
  function getSkillSecretSourceConfigs(source = 'effective') {
    const effectiveConfig = cloneJsonValue(getSkillConfig(), {});
    const runtimeConfig = cloneJsonValue(readRuntimeSkillConfig(), {});
    const defaultConfig = cloneJsonValue(readDefaultSkillConfig(), {});
    const sourceKey = String(source || 'effective').trim().toLowerCase();
    if (sourceKey === 'runtime') {
      return [runtimeConfig, effectiveConfig, defaultConfig];
    }
    if (sourceKey === 'default') {
      return [defaultConfig, effectiveConfig, runtimeConfig];
    }
    return [effectiveConfig, runtimeConfig, defaultConfig];
  }
  
  function resolveOriginalSkillSecretValue(pathSegments = [], sourceConfigs = []) {
    for (const sourceConfig of sourceConfigs) {
      const original = getValueByPath(sourceConfig, pathSegments);
      if (original !== undefined && original !== null && !isSkillMaskedSecretPlaceholder(original)) {
        return cloneJsonValue(original, original);
      }
    }
    throw createHttpError(400, 'Skills JSON 中存在未解析的密钥占位符，请重新载入配置或填写真实值', 'SKILLS_CONFIG_MASKED_SECRET_UNRESOLVED');
  }
  
  function restoreMaskedSkillRequestUrlSecrets(value, originalValue) {
    if (typeof value !== 'string' || !value.includes(SKILL_MASKED_SECRET_VALUE)) {
      return value;
    }
    try {
      const parsed = new URL(value);
      const original = new URL(String(originalValue || ''));
      let changed = false;
      for (const key of Array.from(new Set(Array.from(parsed.searchParams.keys())))) {
        const values = parsed.searchParams.getAll(key);
        if (!isSensitiveUrlQueryKey(key) || !values.some(item => isSkillMaskedSecretPlaceholder(item))) {
          continue;
        }
        const originalValues = original.searchParams.getAll(key).filter(item => item !== undefined && item !== null);
        if (originalValues.length === 0) {
          throw createHttpError(400, `Skills URL 中存在未解析的密钥参数: ${key}`, 'SKILLS_CONFIG_MASKED_URL_SECRET_UNRESOLVED');
        }
        parsed.searchParams.delete(key);
        for (const originalItem of originalValues) {
          parsed.searchParams.append(key, originalItem);
        }
        changed = true;
      }
      return changed ? parsed.toString() : value;
    } catch (error) {
      if (error?.statusCode) {
        throw error;
      }
      return value;
    }
  }
  
  function restoreMaskedSkillConfigSecrets(value, sourceConfigs = [], pathSegments = []) {
    if (isSkillRequestUrlPath(pathSegments) && typeof value === 'string' && value.includes(SKILL_MASKED_SECRET_VALUE)) {
      return restoreMaskedSkillRequestUrlSecrets(value, resolveOriginalSkillSecretValue(pathSegments, sourceConfigs));
    }
    if (isSkillMaskedSecretPlaceholder(value) && isSkillSensitivePath(pathSegments)) {
      return resolveOriginalSkillSecretValue(pathSegments, sourceConfigs);
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => restoreMaskedSkillConfigSecrets(item, sourceConfigs, [...pathSegments, String(index)]));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
  
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      restoreMaskedSkillConfigSecrets(item, sourceConfigs, [...pathSegments, key]),
    ]));
  }
  
  function validateSkillConfigPayload(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw createHttpError(400, 'Skills 配置必须是 JSON 对象', 'SKILLS_CONFIG_INVALID');
    }
    const config = cloneJsonValue(raw, {});
    if ('enabled' in config && typeof config.enabled !== 'boolean') {
      throw createHttpError(400, 'Skills 配置的 enabled 必须是布尔值', 'SKILLS_CONFIG_INVALID');
    }
    if ('autoLoad' in config && typeof config.autoLoad !== 'boolean') {
      throw createHttpError(400, 'Skills 配置的 autoLoad 必须是布尔值', 'SKILLS_CONFIG_INVALID');
    }
    if ('defaultTimeoutMs' in config) {
      config.defaultTimeoutMs = normalizeSkillTimeoutMs(config.defaultTimeoutMs, 15000);
    }
    if ('definitions' in config && !Array.isArray(config.definitions)) {
      throw createHttpError(400, 'Skills 配置的 definitions 必须是数组', 'SKILLS_CONFIG_INVALID');
    }
    const definitionNames = new Set();
    for (const definition of Array.isArray(config.definitions) ? config.definitions : []) {
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        throw createHttpError(400, '每个 skill 定义都必须是对象', 'SKILLS_CONFIG_INVALID');
      }
      const definitionName = String(definition.name || '').trim();
      if (!definitionName) {
        throw createHttpError(400, '每个 skill 都必须提供 name', 'SKILLS_CONFIG_INVALID');
      }
      if (definitionNames.has(definitionName)) {
        throw createHttpError(400, `Skill 名称重复：${definitionName}`, 'SKILLS_CONFIG_DUPLICATE_NAME');
      }
      definitionNames.add(definitionName);
      if ('enabled' in definition && typeof definition.enabled !== 'boolean') {
        throw createHttpError(400, `Skill ${definitionName} 的 enabled 必须是布尔值`, 'SKILLS_CONFIG_INVALID');
      }
      if ('description' in definition && typeof definition.description !== 'string') {
        throw createHttpError(400, `Skill ${definitionName} 的 description 必须是字符串`, 'SKILLS_CONFIG_INVALID');
      }
      if ('allowedHosts' in definition && !Array.isArray(definition.allowedHosts)) {
        throw createHttpError(400, `Skill ${definitionName} 的 allowedHosts 必须是数组`, 'SKILLS_CONFIG_INVALID');
      }
      if ('timeoutMs' in definition) {
        definition.timeoutMs = normalizeSkillTimeoutMs(
          definition.timeoutMs,
          normalizeSkillTimeoutMs(config.defaultTimeoutMs, 15000)
        );
      }
      if ('tools' in definition && !Array.isArray(definition.tools)) {
        throw createHttpError(400, `Skill ${definitionName} 的 tools 必须是数组`, 'SKILLS_CONFIG_INVALID');
      }
      const toolNames = new Set();
      for (const tool of Array.isArray(definition.tools) ? definition.tools : []) {
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
          throw createHttpError(400, `Skill ${definitionName} 的 tool 必须是对象`, 'SKILLS_CONFIG_INVALID');
        }
        const toolName = String(tool.name || '').trim();
        if (!toolName) {
          throw createHttpError(400, `Skill ${definitionName} 下存在缺少 name 的 tool`, 'SKILLS_CONFIG_INVALID');
        }
        if (toolNames.has(toolName)) {
          throw createHttpError(400, `Skill ${definitionName} 下的 tool 名称重复：${toolName}`, 'SKILLS_CONFIG_DUPLICATE_TOOL');
        }
        toolNames.add(toolName);
        if ('enabled' in tool && typeof tool.enabled !== 'boolean') {
          throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 enabled 必须是布尔值`, 'SKILLS_CONFIG_INVALID');
        }
        if ('description' in tool && typeof tool.description !== 'string') {
          throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 description 必须是字符串`, 'SKILLS_CONFIG_INVALID');
        }
        if ('request' in tool) {
          if (!tool.request || typeof tool.request !== 'object' || Array.isArray(tool.request)) {
            throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 request 必须是对象`, 'SKILLS_CONFIG_INVALID');
          }
          if ('method' in tool.request && typeof tool.request.method !== 'string') {
            throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 request.method 必须是字符串`, 'SKILLS_CONFIG_INVALID');
          }
          if ('url' in tool.request && typeof tool.request.url !== 'string') {
            throw createHttpError(400, `Tool ${definitionName}.${toolName} 的 request.url 必须是字符串`, 'SKILLS_CONFIG_INVALID');
          }
        }
      }
    }
    return config;
  }
  
  function buildSkillConfigEditorPayload() {
    const effectiveConfig = cloneJsonValue(getSkillConfig(), {});
    const runtimeConfig = cloneJsonValue(readRuntimeSkillConfig(), {});
    const defaultConfig = cloneJsonValue(readDefaultSkillConfig(), {});
    const effectiveDefinitions = Array.isArray(effectiveConfig.definitions) ? effectiveConfig.definitions : [];
    const effectiveToolCount = effectiveDefinitions.reduce((sum, item) => sum + (Array.isArray(item?.tools) ? item.tools.length : 0), 0);
    return {
      effectiveConfig: maskSkillConfigSecrets(effectiveConfig),
      runtimeConfig: maskSkillConfigSecrets(runtimeConfig),
      defaultConfig: maskSkillConfigSecrets(defaultConfig),
      secretMasked: true,
      secretMask: SKILL_MASKED_SECRET_VALUE,
      stats: {
        effectiveDefinitionCount: effectiveDefinitions.length,
        effectiveToolCount,
        runtimeDefinitionCount: Array.isArray(runtimeConfig.definitions) ? runtimeConfig.definitions.length : 0,
        defaultDefinitionCount: Array.isArray(defaultConfig.definitions) ? defaultConfig.definitions.length : 0,
      },
    };
  }
  
  function buildSkillSettingsPayload() {
    const mergedConfig = getSkillConfig();
    const defaultConfig = readDefaultSkillConfig();
    const customConfig = readRuntimeSkillConfig();
    const defaultDefinitions = Array.isArray(defaultConfig.definitions) ? defaultConfig.definitions : [];
    const customDefinitions = Array.isArray(customConfig.definitions) ? customConfig.definitions : [];
    const defaultNameSet = new Set(defaultDefinitions.map(item => String(item?.name || '').trim()).filter(Boolean));
    const customNameSet = new Set(customDefinitions.map(item => String(item?.name || '').trim()).filter(Boolean));
    const definitions = (Array.isArray(mergedConfig.definitions) ? mergedConfig.definitions : [])
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
          timeoutMs: normalizeSkillTimeoutMs(item.timeoutMs, normalizeSkillTimeoutMs(mergedConfig.defaultTimeoutMs, 15000)),
          toolCount: tools.length,
          enabledToolCount: tools.filter(tool => tool.enabled).length,
          allowedHosts: Array.isArray(item.allowedHosts) ? item.allowedHosts.map(host => String(host || '').trim()).filter(Boolean) : [],
          origin: defaultNameSet.has(name) ? 'builtin' : 'custom',
          customized: customNameSet.has(name),
          tools,
        };
      });
  
    return {
      enabled: mergedConfig.enabled === true,
      autoLoad: mergedConfig.autoLoad !== false,
      defaultTimeoutMs: normalizeSkillTimeoutMs(mergedConfig.defaultTimeoutMs, 15000),
      definitionCount: definitions.length,
      enabledDefinitionCount: definitions.filter(item => item.enabled).length,
      toolCount: definitions.reduce((sum, item) => sum + Number(item.toolCount || 0), 0),
      enabledToolCount: definitions.reduce((sum, item) => sum + Number(item.enabledToolCount || 0), 0),
      builtinDefinitionCount: definitions.filter(item => item.origin === 'builtin').length,
      customDefinitionCount: definitions.filter(item => item.origin === 'custom').length,
      definitions,
    };
  }
  
  async function buildPluginSettingsPayload() {
    const values = buildPluginSettingsValues();
    let currentGroup = '默认分组';
    const items = [];
    for (const item of guobaSchema) {
      if (item.component === 'SOFT_GROUP_BEGIN') {
        currentGroup = item.label || '默认分组';
        continue;
      }
      if (!item.field) continue;
      items.push({
        field: item.field,
        label: item.label,
        component: item.component,
        bottomHelpMessage: item.bottomHelpMessage || '',
        required: item.required === true,
        componentProps: item.componentProps || {},
        group: currentGroup,
        category: getSettingsCategory(item.field),
        readonly: isReadonlySchemaItem(item),
        value: maskPluginSettingsValue(item, values[item.field]),
      });
    }
  
    const categoryOrder = ['main', 'core', 'ai', 'auth', 'extension', 'other'];
    const categories = categoryOrder
      .map(key => ({
        key,
        label: SETTINGS_CATEGORY_LABELS[key],
        count: items.filter(item => item.category === key).length,
      }))
      .filter(item => item.count > 0);
  
    return {
      categories,
      items,
      skills: buildSkillSettingsPayload(),
    };
  }
  
  async function savePluginSettings(payload = {}) {
    const beforeConfig = ConfigControl.get('config') || {};
    const hadLoginToken = Boolean(String(beforeConfig.webConsoleToken || '').trim());
    const raw = payload?.data || {};
    const bootstrapMode = payload?.bootstrapMode === true;
    const pendingLoginToken = String(raw['config.webConsoleToken'] || '').trim();
    if (!hadLoginToken && !pendingLoginToken) {
      throw createHttpError(400, '首次初始化必须先设置控制台登录口令', 'BOOTSTRAP_TOKEN_REQUIRED');
    }
    const bootstrapAllowedFields = new Set(['config.webConsoleToken']);
    const groupedUpdates = {};
    for (const item of guobaSchema) {
      if (!item?.field || isReadonlySchemaItem(item)) continue;
      if (!(item.field in raw)) continue;
      if (bootstrapMode && !bootstrapAllowedFields.has(item.field)) continue;
      if (isSecretSchemaItem(item) && String(raw[item.field] || '').trim() === '******') continue;
      const [configName, ...rest] = item.field.split('.');
      if (!configName || rest.length === 0) continue;
      groupedUpdates[configName] ||= {};
      setByPath(groupedUpdates[configName], rest.join('.'), normalizeSchemaValue(item, raw[item.field]));
    }
    for (const [configName, update] of Object.entries(groupedUpdates)) {
      const existing = ConfigControl.get(configName) || {};
      await ConfigControl.set(configName, deepMerge(existing, update));
    }
    const nextConfig = ConfigControl.get('config') || {};
    const hasLoginToken = Boolean(String(nextConfig.webConsoleToken || '').trim());
    if (!hadLoginToken && !hasLoginToken) {
      throw createHttpError(400, '首次初始化必须先设置控制台登录口令', 'BOOTSTRAP_TOKEN_REQUIRED');
    }
    const incomingSkills = payload?.skills;
    if (incomingSkills && typeof incomingSkills === 'object') {
      const mergedSkillConfig = getSkillConfig();
      const defaultSkillConfig = readDefaultSkillConfig();
      const currentSkillConfig = readRuntimeSkillConfig();
      const mergedDefinitions = Array.isArray(mergedSkillConfig.definitions) ? mergedSkillConfig.definitions : [];
      const customDefinitionMap = new Map(
        (Array.isArray(currentSkillConfig.definitions) ? currentSkillConfig.definitions : [])
          .filter(item => item?.name)
          .map(item => [String(item.name || '').trim(), item])
      );
      const defaultDefinitionMap = new Map(
        (Array.isArray(defaultSkillConfig.definitions) ? defaultSkillConfig.definitions : [])
          .filter(item => item?.name)
          .map(item => [String(item.name || '').trim(), item])
      );
      const requestedDefinitionMap = new Map(
        (Array.isArray(incomingSkills.definitions) ? incomingSkills.definitions : [])
          .filter(item => item?.name)
          .map(item => [String(item.name || '').trim(), item])
      );
      const nextSkillDefinitions = mergedDefinitions
        .filter(item => item?.name)
        .map((item) => {
          const name = String(item.name || '').trim();
          const requestedDefinition = requestedDefinitionMap.get(name) || null;
          const enabled = requestedDefinition ? requestedDefinition.enabled !== false : item.enabled !== false;
          const mergedTools = Array.isArray(item.tools) ? item.tools : [];
          const currentCustomDefinition = customDefinitionMap.get(name) || {};
          const defaultDefinition = defaultDefinitionMap.get(name) || {};
          const customToolMap = new Map(
            (Array.isArray(currentCustomDefinition.tools) ? currentCustomDefinition.tools : [])
              .filter(tool => tool?.name)
              .map(tool => [String(tool.name || '').trim(), tool])
          );
          const defaultToolMap = new Map(
            (Array.isArray(defaultDefinition.tools) ? defaultDefinition.tools : [])
              .filter(tool => tool?.name)
              .map(tool => [String(tool.name || '').trim(), tool])
          );
          const requestedToolMap = new Map(
            (Array.isArray(requestedDefinition?.tools) ? requestedDefinition.tools : [])
              .filter(tool => tool?.name)
              .map(tool => [String(tool.name || '').trim(), tool.enabled !== false])
          );
          const nextTools = mergedTools
            .filter(tool => tool?.name)
            .map((tool) => {
              const toolName = String(tool.name || '').trim();
              const requestedToolEnabled = requestedToolMap.has(toolName) ? requestedToolMap.get(toolName) : tool.enabled !== false;
              if (customToolMap.has(toolName)) {
                return {
                  ...customToolMap.get(toolName),
                  enabled: requestedToolEnabled,
                };
              }
              if (defaultToolMap.has(toolName)) {
                return {
                  name: toolName,
                  enabled: requestedToolEnabled,
                };
              }
              return {
                ...tool,
                enabled: requestedToolEnabled,
              };
            });
          if (customDefinitionMap.has(name)) {
            return {
              ...customDefinitionMap.get(name),
              enabled,
              tools: nextTools,
            };
          }
          if (defaultDefinitionMap.has(name)) {
            return {
              name,
              enabled,
              tools: nextTools,
            };
          }
          return {
            ...item,
            enabled,
            tools: nextTools,
          };
        });
      const nextSkills = {
        ...currentSkillConfig,
        enabled: incomingSkills.enabled === true,
        autoLoad: incomingSkills.autoLoad !== false,
        defaultTimeoutMs: normalizeSkillTimeoutMs(
          incomingSkills.defaultTimeoutMs,
          normalizeSkillTimeoutMs(mergedSkillConfig.defaultTimeoutMs, 15000)
        ),
        definitions: nextSkillDefinitions,
      };
      await ConfigControl.set('skills', nextSkills);
    }
    return {
      ...(await buildPluginSettingsPayload()),
      bootstrapCompleted: !hadLoginToken && hasLoginToken,
      runtimeLoginConfigured: hasLoginToken,
    };
  }

  return {
    normalizePositiveNumber,
    cloneJsonValue,
    maskDisplayUrlSecrets,
    buildPluginSettingsPayload,
    savePluginSettings,
    buildSkillConfigEditorPayload,
    validateSkillConfigPayload,
    getSkillSecretSourceConfigs,
    restoreMaskedSkillConfigSecrets,
  };
}
