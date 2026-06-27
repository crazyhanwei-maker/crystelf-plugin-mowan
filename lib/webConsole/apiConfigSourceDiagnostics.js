import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';

const CONFIG_SOURCE_FILES = [
  { key: 'ai', title: 'AI 接口配置' },
  { key: 'imageMonitor', title: '图片监控配置' },
  { key: 'coreConfig', title: '核心工具配置' },
];

const CONFIG_SOURCE_LABELS = {
  baseApi: 'AI 主对话 API 地址',
  apiKey: 'API Key',
  userAgent: 'LLM User-Agent',
  modelType: 'AI 主对话模型',
  workingModel: '后台工作模型',
  multimodalModel: '多模态模型',
  timeout: 'AI 超时时间',
  'imageConfig.enabled': '图像生成开关',
  'imageConfig.imageMode': '图像生成模式',
  'imageConfig.model': '图像生成模型',
  'imageConfig.baseApi': '图像生成 API 地址',
  'imageConfig.apiKey': '图像生成 API Key',
  'imageConfig.timeout': '图像生成超时',
  'memeConfig.apiBase': '表情包 API 地址',
  'memeConfig.localBaseDir': '表情包本地目录',
  enabled: '启用状态',
  saveReviewImages: '保存审核图片',
  saveMemeImages: '表情图片本地保存',
  apiBase: '接口地址',
  model: '模型',
  analysisTimeoutMs: '识别超时',
  'tools.search.enabled': '搜索工具开关',
  'tools.search.apiKey': '搜索工具 API Key',
  'tools.search.markdownApiUrl': '网页读取提交地址',
  'tools.search.markdownStatusUrl': '网页读取状态地址',
  'tools.search.timeoutMs': '搜索工具超时',
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
  { file: 'ai', key: 'imageConfig.timeout', label: '图像生成超时', fallbackValue: 60000 },
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

function readConfigJsonSafe(filePath = '') {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isSensitiveConfigPath(keyPath = '') {
  return /(^|\.)(api[_-]?key|secret|token|password|authorization|cookie)(\.|$)/i.test(String(keyPath || ''));
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
      result.set(prefix, { value: '{}', sensitive: isSensitiveConfigPath(prefix) });
    }
    for (const key of keys) {
      const keyPath = prefix ? `${prefix}.${key}` : key;
      flattenConfig(value[key], keyPath, result);
    }
    return result;
  }

  result.set(prefix, {
    value: normalizeDiffValue(value),
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

export function createApiConfigSourceDiagnostics(options = {}) {
  const runtimeConfigDir = options.runtimeConfigDir || Path.config;
  const defaultConfigDir = options.defaultConfigDir || Path.defaultConfigPath;

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

  function buildConfigDiffSummary(runtimeConfig = {}, defaultConfig = {}) {
    const runtimeMap = flattenConfig(runtimeConfig || {});
    const defaultMap = flattenConfig(defaultConfig || {});
    const allKeys = Array.from(new Set([...runtimeMap.keys(), ...defaultMap.keys()])).sort();
    const changes = [];
    const counts = {
      modified: 0,
      runtimeOnly: 0,
      missingInRuntime: 0,
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
      }
      if (!type) continue;

      counts[type] += 1;
      changes.push({
        type,
        key,
        label: CONFIG_SOURCE_LABELS[key] || key,
        sensitive: Boolean(runtimeValue?.sensitive || defaultValue?.sensitive),
      });
    }

    return {
      counts,
      total: counts.modified + counts.runtimeOnly + counts.missingInRuntime,
      changes: changes.slice(0, 20),
      truncated: changes.length > 20,
    };
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
      fallbackKey: field.fallbackKey || '',
    };
  }

  function build(allConfigs = {}) {
    const runtimeDir = path.resolve(runtimeConfigDir);
    const defaultDir = path.resolve(defaultConfigDir);
    const configsByFile = {};
    const files = CONFIG_SOURCE_FILES.map(item => {
      const runtimePath = path.join(runtimeDir, `${item.key}.json`);
      const defaultPath = path.join(defaultDir, `${item.key}.json`);
      const runtimeConfig = readConfigJsonSafe(runtimePath);
      const defaultConfig = readConfigJsonSafe(defaultPath);
      const effectiveConfig = allConfigs[item.key] || runtimeConfig || defaultConfig || {};
      configsByFile[item.key] = {
        runtime: runtimeConfig,
        default: defaultConfig,
        effective: effectiveConfig,
      };

      return {
        key: item.key,
        title: item.title,
        fileName: `${item.key}.json`,
        runtimePath: toConsolePath(runtimePath),
        defaultPath: toConsolePath(defaultPath),
        runtimeExists: runtimeConfig !== null,
        defaultExists: defaultConfig !== null,
        effectiveSource: runtimeConfig !== null ? 'runtime' : 'default-or-memory',
        diff: buildConfigDiffSummary(runtimeConfig || effectiveConfig || {}, defaultConfig || {}),
      };
    });

    return {
      priority: 'runtime-over-default',
      runtimeDir: toConsolePath(runtimeDir),
      defaultDir: toConsolePath(defaultDir),
      runtimeDirFromEnv: Boolean(process.env.CRYSTELF_DATA_DIR),
      note: '控制台读取并保存运行配置；config/*.json 只是默认模板，已有运行配置不会被模板覆盖。',
      files,
      effectiveFields: EFFECTIVE_FIELDS.map(field => resolveEffectiveField(field, configsByFile)),
    };
  }

  return {
    build,
    toConsolePath,
  };
}
