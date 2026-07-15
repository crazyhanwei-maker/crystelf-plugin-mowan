import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';

const FOCUSED_CONFIG_FILES = [
  { key: 'ai', title: 'AI 接口配置' },
  { key: 'imageMonitor', title: '图片监控配置' },
  { key: 'coreConfig', title: '核心工具配置' },
];

const CONFIG_SOURCE_FILE_TITLES = {
  ai: 'AI 接口配置',
  config: '插件功能开关',
  coreConfig: '核心工具配置',
  groupManagement: '群管理配置',
  imageMonitor: '图片监控配置',
  music: '点歌配置',
  tts: '语音合成配置',
};

const CONFIG_SOURCE_LABELS = {
  baseApi: 'AI 主对话 API 地址',
  apiKey: 'API Key',
  userAgent: 'LLM User-Agent',
  modelType: 'AI 主对话模型',
  workingModel: '后台工作模型',
  multimodalModel: '多模态模型',
  timeout: 'AI 超时时间',
  'fallbackApi.enabled': 'AI 主对话备用 API 开关',
  'fallbackApi.baseApi': 'AI 主对话备用 API 地址',
  'fallbackApi.apiKey': 'AI 主对话备用 API Key',
  'fallbackApi.modelType': 'AI 主对话备用模型',
  'fallbackApi.autoSwitchEnabled': 'AI 主对话备用自动切换',
  'imageConfig.enabled': '图像生成开关',
  'imageConfig.imageMode': '图像生成模式',
  'imageConfig.model': '图像生成模型',
  'imageConfig.baseApi': '图像生成 API 地址',
  'imageConfig.apiKey': '图像生成 API Key',
  'imageConfig.size': '图像生成尺寸',
  'imageConfig.responseFormat': '图像生成响应格式',
  'imageConfig.outputFormat': '图像生成输出格式',
  'imageConfig.watermark': '图像生成水印',
  'imageConfig.sdWebUi.baseApi': 'SD WebUI 地址',
  'imageConfig.sdWebUi.model': 'SD WebUI 模型',
  'imageConfig.sdWebUi.samplerName': 'SD WebUI 采样器',
  'imageConfig.sdWebUi.steps': 'SD WebUI 采样步数',
  'imageConfig.sdWebUi.cfgScale': 'SD WebUI CFG',
  'imageConfig.sdWebUi.width': 'SD WebUI 宽度',
  'imageConfig.sdWebUi.height': 'SD WebUI 高度',
  'imageConfig.timeout': '图像生成超时',
  'imageConfig.fallbackApi.enabled': '图像生成备用 API 开关',
  'imageConfig.fallbackApi.imageMode': '图像生成备用模式',
  'imageConfig.fallbackApi.baseApi': '图像生成备用 API 地址',
  'imageConfig.fallbackApi.apiKey': '图像生成备用 API Key',
  'imageConfig.fallbackApi.model': '图像生成备用模型',
  'imageConfig.fallbackApi.size': '图像生成备用尺寸',
  'imageConfig.fallbackApi.responseFormat': '图像生成备用响应格式',
  'imageConfig.fallbackApi.outputFormat': '图像生成备用输出格式',
  'imageConfig.fallbackApi.watermark': '图像生成备用水印',
  'imageConfig.fallbackApi.sdWebUi.baseApi': '备用 SD WebUI 地址',
  'imageConfig.fallbackApi.sdWebUi.model': '备用 SD WebUI 模型',
  'memeConfig.apiBase': '表情包 API 地址',
  'memeConfig.localBaseDir': '表情包本地目录',
  'memeConfig.fallbackApi.enabled': '表情包备用 API 开关',
  'memeConfig.fallbackApi.apiBase': '表情包备用 API 地址',
  enabled: '启用状态',
  storageEnabled: '图片本地入库总开关',
  saveReviewImages: '保存审核图片',
  saveMemeImages: '表情图片本地保存',
  apiBase: '接口地址',
  model: '模型',
  analysisTimeoutMs: '识别超时',
  'fallbackApi.apiBase': '备用接口地址',
  'fallbackApi.model': '备用模型',
  'tools.search.enabled': '搜索工具开关',
  'tools.search.apiKey': '搜索工具 API Key',
  'tools.search.apiUrl': '搜索提交地址',
  'tools.search.markdownApiUrl': '网页读取提交地址',
  'tools.search.markdownStatusUrl': '网页读取状态地址',
  'tools.search.timeoutMs': '搜索工具超时',
  'tools.search.fallbackApi.enabled': '搜索备用 API 开关',
  'tools.search.fallbackApi.apiUrl': '搜索备用提交地址',
  'tools.search.fallbackApi.apiKey': '搜索备用 API Key',
};

const EFFECTIVE_FIELDS = [
  { file: 'ai', key: 'baseApi', label: 'AI 主对话 API 地址' },
  { file: 'ai', key: 'userAgent', label: 'LLM User-Agent' },
  { file: 'ai', key: 'modelType', label: 'AI 主对话模型' },
  { file: 'ai', key: 'workingModel', label: '后台工作模型', fallbackKey: 'modelType' },
  { file: 'ai', key: 'multimodalModel', label: '多模态模型' },
  { file: 'ai', key: 'timeout', label: 'AI 超时时间' },
  { file: 'ai', key: 'imageConfig.imageMode', label: '图像生成模式' },
  { file: 'ai', key: 'imageConfig.model', label: '图像生成模型' },
  { file: 'ai', key: 'imageConfig.baseApi', label: '图像生成 API 地址', fallbackKey: 'baseApi' },
  { file: 'ai', key: 'imageConfig.size', label: '图像生成尺寸' },
  { file: 'ai', key: 'imageConfig.responseFormat', label: '图像生成响应格式' },
  { file: 'ai', key: 'imageConfig.outputFormat', label: '图像生成输出格式' },
  { file: 'ai', key: 'imageConfig.watermark', label: '图像生成水印' },
  { file: 'ai', key: 'imageConfig.sdWebUi.baseApi', label: 'SD WebUI 地址' },
  { file: 'ai', key: 'imageConfig.sdWebUi.model', label: 'SD WebUI 模型' },
  { file: 'ai', key: 'imageConfig.sdWebUi.samplerName', label: 'SD WebUI 采样器' },
  { file: 'ai', key: 'imageConfig.sdWebUi.steps', label: 'SD WebUI 采样步数' },
  { file: 'ai', key: 'imageConfig.sdWebUi.cfgScale', label: 'SD WebUI CFG' },
  { file: 'ai', key: 'imageConfig.sdWebUi.width', label: 'SD WebUI 宽度' },
  { file: 'ai', key: 'imageConfig.sdWebUi.height', label: 'SD WebUI 高度' },
  { file: 'ai', key: 'imageConfig.timeout', label: '图像生成超时', fallbackValue: 60000 },
  { file: 'ai', key: 'imageConfig.fallbackApi.enabled', label: '图像生成备用 API 开关' },
  { file: 'ai', key: 'imageConfig.fallbackApi.imageMode', label: '图像生成备用模式' },
  { file: 'ai', key: 'imageConfig.fallbackApi.model', label: '图像生成备用模型' },
  { file: 'ai', key: 'imageConfig.fallbackApi.baseApi', label: '图像生成备用 API 地址' },
  { file: 'ai', key: 'imageConfig.fallbackApi.size', label: '图像生成备用尺寸' },
  { file: 'ai', key: 'imageConfig.fallbackApi.responseFormat', label: '图像生成备用响应格式' },
  { file: 'ai', key: 'imageConfig.fallbackApi.outputFormat', label: '图像生成备用输出格式' },
  { file: 'ai', key: 'imageConfig.fallbackApi.watermark', label: '图像生成备用水印' },
  { file: 'ai', key: 'imageConfig.fallbackApi.sdWebUi.baseApi', label: '备用 SD WebUI 地址' },
  { file: 'ai', key: 'imageConfig.fallbackApi.sdWebUi.model', label: '备用 SD WebUI 模型' },
  { file: 'ai', key: 'memeConfig.apiBase', label: '表情包 API 地址' },
  { file: 'imageMonitor', key: 'enabled', label: '图片监控开关' },
  { file: 'imageMonitor', key: 'apiBase', label: '图片监控 API 地址' },
  { file: 'imageMonitor', key: 'model', label: '图片监控模型' },
  { file: 'imageMonitor', key: 'analysisTimeoutMs', label: '图片监控识别超时', fallbackValue: 30000 },
  { file: 'coreConfig', key: 'tools.search.enabled', label: '搜索工具开关' },
  { file: 'coreConfig', key: 'tools.search.markdownApiUrl', label: '网页读取提交地址' },
  { file: 'coreConfig', key: 'tools.search.markdownStatusUrl', label: '网页读取状态地址' },
  { file: 'coreConfig', key: 'tools.search.timeoutMs', label: '搜索工具超时', fallbackValue: 60000 },
];

const FIELD_PREVIEW_LIMIT = 160;
const FILE_FIELD_LIMIT = 500;

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readConfigJsonDetailed(filePath = '') {
  const result = {
    exists: false,
    valid: false,
    invalid: false,
    data: null,
    error: '',
    size: 0,
    mtimeMs: 0,
  };

  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return result;
    }
    const stat = fs.statSync(filePath);
    const text = fs.readFileSync(filePath, 'utf8');
    return {
      ...result,
      exists: true,
      valid: true,
      data: JSON.parse(text),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    return {
      ...result,
      exists: true,
      invalid: true,
      error: error?.message || 'JSON 读取失败',
    };
  }
}

function listConfigKeysFromDir(dir = '') {
  try {
    return fs.readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => path.basename(file, '.json'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isSensitiveConfigPath(keyPath = '') {
  return String(keyPath || '')
    .split('.')
    .some(segment => /(?:api[_-]?key|apikey|secret|token|password|authorization|cookie)/i.test(segment));
}

function normalizeDiffValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(item => normalizeDiffValue(item)));
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(Object.keys(value).sort());
  }
  return JSON.stringify(value ?? null);
}

function flattenConfig(value, prefix = '', result = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length <= 0 && prefix) {
      result.set(prefix, { value: '{}', raw: {}, sensitive: isSensitiveConfigPath(prefix) });
    }
    for (const key of keys) {
      const keyPath = prefix ? `${prefix}.${key}` : key;
      flattenConfig(value[key], keyPath, result);
    }
    return result;
  }

  result.set(prefix, {
    value: normalizeDiffValue(value),
    raw: value,
    sensitive: isSensitiveConfigPath(prefix),
  });
  return result;
}

function getByPath(value = {}, keyPath = '') {
  if (!keyPath) return value;
  return String(keyPath).split('.').reduce((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return current[key];
    }
    return undefined;
  }, value);
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function formatDisplayValue(value, sensitive = false) {
  if (sensitive) {
    return hasValue(value) ? '已配置' : '未配置';
  }
  if (value === undefined || value === null || value === '') return '未配置';
  if (value === true) return '开启';
  if (value === false) return '关闭';
  if (Array.isArray(value)) return value.length > 0 ? value.join('，') : '空列表';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatFileSize(bytes = 0) {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatPreviewValue(entry = null, sensitive = false) {
  if (!entry) return '未配置';
  if (sensitive || entry.sensitive) {
    return hasValue(entry.raw) ? '已配置' : '未配置';
  }
  const text = formatDisplayValue(entry.raw, false);
  return text.length > FIELD_PREVIEW_LIMIT ? `${text.slice(0, FIELD_PREVIEW_LIMIT)}...` : text;
}

function getDiffTypeLabel(type = '') {
  switch (String(type || '').trim()) {
    case 'modified':
      return '运行配置覆盖默认';
    case 'runtimeOnly':
      return '仅运行配置';
    case 'missingInRuntime':
      return '运行配置缺失';
    case 'sameAsDefault':
      return '与默认一致';
    case 'memoryOnly':
      return '仅内存缓存';
    default:
      return '未知';
  }
}

function buildConfigDiffSummary(runtimeConfig = {}, defaultConfig = {}) {
  const runtimeMap = flattenConfig(runtimeConfig || {});
  const defaultMap = flattenConfig(defaultConfig || {});
  const allKeys = Array.from(new Set([...runtimeMap.keys(), ...defaultMap.keys()])).sort();
  const changes = [];
  const counts = {
    modified: 0,
    runtimeOnly: 0,
    missingInRuntime: 0,
    sameAsDefault: 0,
  };

  for (const key of allKeys) {
    if (!key) continue;
    const runtimeValue = runtimeMap.get(key);
    const defaultValue = defaultMap.get(key);
    let type = '';
    if (!defaultValue) {
      type = 'runtimeOnly';
    } else if (!runtimeValue) {
      type = 'missingInRuntime';
    } else if (runtimeValue.value !== defaultValue.value) {
      type = 'modified';
    } else {
      type = 'sameAsDefault';
    }

    counts[type] += 1;
    if (type === 'sameAsDefault') continue;
    changes.push({
      type,
      typeLabel: getDiffTypeLabel(type),
      key,
      label: CONFIG_SOURCE_LABELS[key] || key,
      sensitive: Boolean(runtimeValue?.sensitive || defaultValue?.sensitive),
    });
  }

  return {
    counts,
    total: counts.modified + counts.runtimeOnly + counts.missingInRuntime,
    changes: changes.slice(0, 40),
    truncated: changes.length > 40,
  };
}

function buildFieldRows(runtimeConfig = {}, defaultConfig = {}, effectiveConfig = {}) {
  const runtimeMap = flattenConfig(runtimeConfig || {});
  const defaultMap = flattenConfig(defaultConfig || {});
  const effectiveMap = flattenConfig(effectiveConfig || {});
  const allKeys = Array.from(new Set([
    ...runtimeMap.keys(),
    ...defaultMap.keys(),
    ...effectiveMap.keys(),
  ])).filter(Boolean).sort();

  const rows = allKeys.map(key => {
    const runtimeValue = runtimeMap.get(key);
    const defaultValue = defaultMap.get(key);
    const effectiveValue = effectiveMap.get(key);
    let source = 'memoryOnly';
    if (runtimeValue && defaultValue) {
      source = runtimeValue.value === defaultValue.value ? 'sameAsDefault' : 'modified';
    } else if (runtimeValue) {
      source = 'runtimeOnly';
    } else if (defaultValue) {
      source = 'missingInRuntime';
    }

    const expectedFileValue = runtimeValue || defaultValue || null;
    const cacheDrift = Boolean(effectiveValue && expectedFileValue && effectiveValue.value !== expectedFileValue.value);
    const sensitive = Boolean(runtimeValue?.sensitive || defaultValue?.sensitive || effectiveValue?.sensitive);
    return {
      key,
      label: CONFIG_SOURCE_LABELS[key] || key,
      source,
      sourceLabel: getDiffTypeLabel(source),
      sensitive,
      cacheDrift,
      runtimeValue: formatPreviewValue(runtimeValue, sensitive),
      defaultValue: formatPreviewValue(defaultValue, sensitive),
      effectiveValue: formatPreviewValue(effectiveValue || runtimeValue || defaultValue, sensitive),
    };
  });

  const stats = {
    total: rows.length,
    modified: rows.filter(row => row.source === 'modified').length,
    runtimeOnly: rows.filter(row => row.source === 'runtimeOnly').length,
    missingInRuntime: rows.filter(row => row.source === 'missingInRuntime').length,
    sameAsDefault: rows.filter(row => row.source === 'sameAsDefault').length,
    memoryOnly: rows.filter(row => row.source === 'memoryOnly').length,
    cacheDrift: rows.filter(row => row.cacheDrift).length,
  };

  return { rows, stats };
}

function resolveEffectiveField(field = {}, configsByFile = {}) {
  const effectiveConfig = configsByFile[field.file]?.effective || {};
  let value = getByPath(effectiveConfig, field.key);
  let source = hasValue(value) ? 'effective' : '';
  if (!hasValue(value) && field.fallbackKey) {
    value = getByPath(effectiveConfig, field.fallbackKey);
    source = hasValue(value) ? 'fallback' : '';
  }
  if (!hasValue(value) && field.fallbackValue !== undefined) {
    value = field.fallbackValue;
    source = 'default-value';
  }

  const sensitive = isSensitiveConfigPath(field.key);
  return {
    file: field.file,
    key: field.key,
    label: field.label || CONFIG_SOURCE_LABELS[field.key] || field.key,
    value: formatDisplayValue(value, sensitive),
    configured: hasValue(value),
    sensitive,
    source: source || 'missing',
    sourceLabel: source === 'fallback'
      ? `回退自 ${field.fallbackKey || '-'}`
      : source === 'default-value'
        ? '内置默认值'
        : source === 'missing'
          ? '未读取到有效值'
          : '运行时生效值',
    fallbackKey: field.fallbackKey || '',
  };
}

function getFileStatus(file = {}) {
  if (file.runtime?.invalid) return { status: 'error', label: '运行配置格式错误' };
  if (file.default?.invalid) return { status: 'error', label: '默认模板格式错误' };
  if (!file.runtime?.exists && !file.default?.exists) return { status: 'warning', label: '仅内存配置' };
  if (!file.runtime?.exists) return { status: 'warning', label: '运行配置缺失' };
  if (file.fieldStats?.cacheDrift > 0) return { status: 'warning', label: '内存与文件不一致' };
  if (file.diff?.total > 0) return { status: 'changed', label: '运行配置已覆盖默认' };
  return { status: 'ok', label: '与默认模板一致' };
}

function buildRecommendations(summary = {}) {
  const items = [];
  if (summary.invalidJsonCount > 0) {
    items.push('发现 JSON 格式错误。先修复对应配置文件，否则插件可能继续使用旧内存配置或默认值。');
  }
  if (summary.cacheDriftFieldCount > 0) {
    items.push('发现内存配置与文件内容不一致。确认保存后仍异常时，建议重启 Bot 让运行时重新读取配置。');
  }
  if (summary.missingRuntimeFileCount > 0) {
    items.push('有默认模板存在但运行配置缺失。通常初始化会自动复制，若未复制请检查运行配置目录权限。');
  }
  if (summary.changedFieldCount > 0) {
    items.push('运行配置已覆盖默认模板，这是正常生效规则；排查接口地址时以运行配置和生效字段为准。');
  }
  if (items.length <= 0) {
    items.push('配置来源看起来正常：运行配置、默认模板和内存缓存没有发现明显冲突。');
  }
  return items;
}

export function createApiConfigSourceDiagnostics(options = {}) {
  const runtimeConfigDir = options.runtimeConfigDir || Path.config;
  const defaultConfigDir = options.defaultConfigDir || Path.defaultConfigPath;
  const getMigrationReport = typeof options.getMigrationReport === 'function'
    ? options.getMigrationReport
    : () => null;

  function toConsolePath(targetPath = '') {
    const resolved = path.resolve(String(targetPath || ''));
    const roots = [
      { root: path.resolve(runtimeConfigDir), prefix: '运行配置目录' },
      { root: path.resolve(defaultConfigDir), prefix: '默认配置目录' },
      { root: path.resolve(Path.root), prefix: '插件目录' },
    ];

    for (const item of roots) {
      const relativePath = path.relative(item.root, resolved);
      if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
        return relativePath
          ? `${item.prefix}/${relativePath.replace(/\\/g, '/')}`
          : item.prefix;
      }
    }

    return resolved.replace(/\\/g, '/');
  }

  function serializeFileState(state = {}, filePath = '') {
    return {
      path: toConsolePath(filePath),
      exists: state.exists === true,
      valid: state.valid === true,
      invalid: state.invalid === true,
      error: state.error || '',
      size: Number(state.size || 0),
      sizeLabel: formatFileSize(state.size || 0),
      mtime: state.mtimeMs ? new Date(state.mtimeMs).toISOString() : '',
    };
  }

  function buildFileDiagnostics(item = {}, allConfigs = {}) {
    const runtimeDir = path.resolve(runtimeConfigDir);
    const defaultDir = path.resolve(defaultConfigDir);
    const key = String(item.key || '').trim();
    const runtimePath = path.join(runtimeDir, `${key}.json`);
    const defaultPath = path.join(defaultDir, `${key}.json`);
    const runtimeState = readConfigJsonDetailed(runtimePath);
    const defaultState = readConfigJsonDetailed(defaultPath);
    const runtimeConfig = runtimeState.valid ? runtimeState.data : null;
    const defaultConfig = defaultState.valid ? defaultState.data : null;
    const cacheConfig = isPlainObject(allConfigs) && Object.prototype.hasOwnProperty.call(allConfigs, key)
      ? allConfigs[key]
      : undefined;
    const effectiveConfig = cacheConfig || runtimeConfig || defaultConfig || {};
    const diff = buildConfigDiffSummary(runtimeConfig || effectiveConfig || {}, defaultConfig || {});
    const fieldDiagnostics = buildFieldRows(runtimeConfig || {}, defaultConfig || {}, effectiveConfig || {});
    const file = {
      key,
      title: item.title || CONFIG_SOURCE_FILE_TITLES[key] || key,
      fileName: `${key}.json`,
      runtimePath: toConsolePath(runtimePath),
      defaultPath: toConsolePath(defaultPath),
      runtimeExists: runtimeState.exists === true && runtimeState.valid === true,
      defaultExists: defaultState.exists === true && defaultState.valid === true,
      effectiveSource: runtimeState.exists && runtimeState.valid ? 'runtime' : 'default-or-memory',
      runtime: serializeFileState(runtimeState, runtimePath),
      default: serializeFileState(defaultState, defaultPath),
      diff,
      fieldStats: fieldDiagnostics.stats,
      fields: fieldDiagnostics.rows.slice(0, FILE_FIELD_LIMIT),
      totalFields: fieldDiagnostics.rows.length,
      fieldsTruncated: fieldDiagnostics.rows.length > FILE_FIELD_LIMIT,
    };
    const status = getFileStatus(file);
    return {
      ...file,
      status: status.status,
      statusLabel: status.label,
    };
  }

  function build(allConfigs = {}) {
    const runtimeDir = path.resolve(runtimeConfigDir);
    const defaultDir = path.resolve(defaultConfigDir);
    const focusedKeys = FOCUSED_CONFIG_FILES.map(item => item.key);
    const allKeys = Array.from(new Set([
      ...focusedKeys,
      ...listConfigKeysFromDir(defaultDir),
      ...listConfigKeysFromDir(runtimeDir),
      ...Object.keys(isPlainObject(allConfigs) ? allConfigs : {}),
    ])).filter(Boolean).sort((left, right) => {
      const leftFocused = focusedKeys.indexOf(left);
      const rightFocused = focusedKeys.indexOf(right);
      if (leftFocused >= 0 || rightFocused >= 0) {
        if (leftFocused < 0) return 1;
        if (rightFocused < 0) return -1;
        return leftFocused - rightFocused;
      }
      return left.localeCompare(right);
    });

    const allFiles = allKeys.map(key => buildFileDiagnostics({
      key,
      title: CONFIG_SOURCE_FILE_TITLES[key] || key,
    }, allConfigs));
    const configsByFile = Object.fromEntries(allFiles.map(file => [
      file.key,
      {
        runtime: file.runtime?.valid ? readConfigJsonDetailed(path.join(runtimeDir, `${file.key}.json`)).data : null,
        default: file.default?.valid ? readConfigJsonDetailed(path.join(defaultDir, `${file.key}.json`)).data : null,
        effective: isPlainObject(allConfigs) && Object.prototype.hasOwnProperty.call(allConfigs, file.key)
          ? allConfigs[file.key]
          : {},
      },
    ]));
    const files = focusedKeys
      .map(key => allFiles.find(file => file.key === key))
      .filter(Boolean);
    const summary = {
      configFileCount: allFiles.length,
      focusedFileCount: files.length,
      runtimeFileCount: allFiles.filter(file => file.runtime.exists).length,
      defaultFileCount: allFiles.filter(file => file.default.exists).length,
      invalidJsonCount: allFiles.filter(file => file.runtime.invalid || file.default.invalid).length,
      missingRuntimeFileCount: allFiles.filter(file => !file.runtime.exists && file.default.exists).length,
      runtimeOnlyFileCount: allFiles.filter(file => file.runtime.exists && !file.default.exists).length,
      changedFieldCount: allFiles.reduce((sum, file) => sum + Number(file.fieldStats?.modified || 0), 0),
      runtimeOnlyFieldCount: allFiles.reduce((sum, file) => sum + Number(file.fieldStats?.runtimeOnly || 0), 0),
      missingRuntimeFieldCount: allFiles.reduce((sum, file) => sum + Number(file.fieldStats?.missingInRuntime || 0), 0),
      cacheDriftFieldCount: allFiles.reduce((sum, file) => sum + Number(file.fieldStats?.cacheDrift || 0), 0),
    };

    return {
      priority: 'runtime-over-default',
      generatedAt: new Date().toISOString(),
      runtimeDir: toConsolePath(runtimeDir),
      defaultDir: toConsolePath(defaultDir),
      runtimeDirFromEnv: Boolean(process.env.CRYSTELF_DATA_DIR),
      directories: {
        runtime: {
          label: '运行配置目录',
          path: toConsolePath(runtimeDir),
          absolutePath: runtimeDir.replace(/\\/g, '/'),
          fromEnv: Boolean(process.env.CRYSTELF_DATA_DIR),
        },
        defaults: {
          label: '默认模板目录',
          path: toConsolePath(defaultDir),
          absolutePath: defaultDir.replace(/\\/g, '/'),
        },
      },
      environment: [
        {
          key: 'CRYSTELF_DATA_DIR',
          configured: Boolean(process.env.CRYSTELF_DATA_DIR),
          value: process.env.CRYSTELF_DATA_DIR ? toConsolePath(process.env.CRYSTELF_DATA_DIR) : '未设置，使用插件默认数据目录',
        },
      ],
      summary,
      recommendations: buildRecommendations(summary),
      migrationReport: getMigrationReport(),
      note: '控制台读取并保存运行配置；config/*.json 只是默认模板，已有运行配置不会被模板覆盖。',
      files,
      allFiles,
      effectiveFields: EFFECTIVE_FIELDS.map(field => resolveEffectiveField(field, configsByFile)),
    };
  }

  return {
    build,
    toConsolePath,
  };
}
