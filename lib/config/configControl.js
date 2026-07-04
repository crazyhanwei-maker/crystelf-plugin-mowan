import Path from '../../constants/path.js';
import path from 'path';
import fs from 'fs';
import fc from '../../components/json.js';

const fsp = fs.promises;
const pluginConfigPath = Path.defaultConfigPath;
const dataConfigPath = Path.config;
const configFile = path.join(dataConfigPath, 'config.json');
const configHistoryFile = path.join(dataConfigPath, 'config-history.jsonl');
const configMigrationFile = path.join(Path.data, 'config-migration.json');
const CONFIG_SCHEMA_VERSION = 1;
const CONFIG_HISTORY_LIMIT = 80;
const CONFIG_HISTORY_CHANGE_PREVIEW_LIMIT = 200;
let configCache = {};
let watchers = [];
let lastMigrationReport = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  migratedAt: '',
  changedFileCount: 0,
  changedCount: 0,
  files: [],
};
const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  mark: (...args) => console.log(...args),
};

const REMOVED_CORE_URL_KEYS = new Set(['coreUrl', '?coreUrl']);
const LEGACY_JIMENG_API_URLS = new Set([
  'http://165.99.42.28:985',
  'https://165.99.42.28:985',
]);
const AI_PLACEHOLDER_BASE_APIS = new Set([
  'https://xx.xx.com/v1',
  'http://xx.xx.com/v1',
  'https://xx.xx.com',
  'http://xx.xx.com',
]);
const AI_PLACEHOLDER_API_KEYS = new Set([
  '',
  'your api key',
  'your-api-key',
  'your_api_key',
]);
const AI_PLACEHOLDER_MODELS = new Set([
  '',
  'gpt-5.2',
]);

function normalizeConfigKey(key) {
  const normalized = String(key || '').trim();
  const lower = normalized.toLowerCase();
  if (
    !normalized
    || !/^[a-zA-Z0-9_-]+$/.test(normalized)
    || lower === '__proto__'
    || lower === 'prototype'
    || lower === 'constructor'
  ) {
    throw new Error(`非法配置文件名: ${normalized || '(empty)'}`);
  }
  return normalized;
}

function cloneConfigValue(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function stringifyConfigComparable(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flattenConfigEntries(value, prefix = '') {
  if (Array.isArray(value)) {
    if (value.some(item => item && typeof item === 'object')) {
      const entries = value.flatMap((item, index) => Object.entries(flattenConfigEntries(item, `${prefix}.${index}`)));
      return entries.length > 0 ? Object.fromEntries(entries) : { [prefix || '(root)']: [] };
    }
    return { [prefix || '(root)']: value };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0 && prefix) {
      return { [prefix]: {} };
    }
    return entries.reduce((acc, [key, item]) => {
      const nextKey = prefix ? `${prefix}.${key}` : key;
      Object.assign(acc, flattenConfigEntries(item, nextKey));
      return acc;
    }, {});
  }
  return { [prefix || '(root)']: value };
}

function buildConfigChangePreview(fileKey, beforeExists, beforeValue, afterExists, afterValue) {
  const beforeFlat = beforeExists ? flattenConfigEntries(beforeValue) : {};
  const afterFlat = afterExists ? flattenConfigEntries(afterValue) : {};
  const keys = Array.from(new Set([...Object.keys(beforeFlat), ...Object.keys(afterFlat)])).sort();
  return keys
    .filter(key => stringifyConfigComparable(beforeFlat[key]) !== stringifyConfigComparable(afterFlat[key]))
    .map(key => ({
      file: fileKey,
      key: key === '(root)' ? fileKey : `${fileKey}.${key}`,
      type: Object.prototype.hasOwnProperty.call(beforeFlat, key)
        ? (Object.prototype.hasOwnProperty.call(afterFlat, key) ? 'modified' : 'deleted')
        : 'added',
      before: beforeFlat[key],
      after: afterFlat[key],
    }));
}

async function readConfigHistoryEntries() {
  try {
    const text = await fsp.readFile(configHistoryFile, 'utf8');
    return text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(item => item && typeof item === 'object' && item.id);
  } catch {
    return [];
  }
}

async function writeConfigHistoryEntries(entries = []) {
  await fsp.mkdir(dataConfigPath, { recursive: true });
  const safeEntries = entries.slice(-CONFIG_HISTORY_LIMIT);
  const text = safeEntries.map(item => JSON.stringify(item)).join('\n');
  await fsp.writeFile(configHistoryFile, text ? `${text}\n` : '', 'utf8');
}

function buildConfigHistoryEntry(beforeFiles = {}, afterFiles = {}, options = {}) {
  const beforeKeys = Object.keys(beforeFiles);
  const afterKeys = Object.keys(afterFiles);
  const fileKeys = Array.from(new Set([...beforeKeys, ...afterKeys])).sort();
  const files = {};
  const changes = [];

  for (const key of fileKeys) {
    const beforeExists = Object.prototype.hasOwnProperty.call(beforeFiles, key);
    const afterExists = Object.prototype.hasOwnProperty.call(afterFiles, key);
    const beforeValue = beforeFiles[key];
    const afterValue = afterFiles[key];
    if (beforeExists === afterExists && stringifyConfigComparable(beforeValue) === stringifyConfigComparable(afterValue)) {
      continue;
    }
    files[key] = {
      beforeExists,
      afterExists,
      before: beforeExists ? cloneConfigValue(beforeValue) : undefined,
      after: afterExists ? cloneConfigValue(afterValue) : undefined,
    };
    changes.push(...buildConfigChangePreview(key, beforeExists, beforeValue, afterExists, afterValue));
  }

  const changedFiles = Object.keys(files);
  if (changedFiles.length === 0) {
    return null;
  }

  const createdAt = new Date().toISOString();
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    action: String(options.action || (changedFiles.length > 1 ? 'config_set_multiple' : 'config_set')),
    source: String(options.source || 'runtime'),
    files,
    fileKeys: changedFiles,
    changedCount: changes.length,
    changes: changes.slice(0, CONFIG_HISTORY_CHANGE_PREVIEW_LIMIT),
    truncatedChanges: changes.length > CONFIG_HISTORY_CHANGE_PREVIEW_LIMIT,
  };
}

async function appendConfigHistory(beforeFiles = {}, afterFiles = {}, options = {}) {
  if (options.recordHistory === false) {
    return null;
  }
  const entry = buildConfigHistoryEntry(beforeFiles, afterFiles, options);
  if (!entry) {
    return null;
  }
  try {
    const entries = await readConfigHistoryEntries();
    entries.push(entry);
    await writeConfigHistoryEntries(entries);
  } catch (error) {
    logger.warn(`[crystelf-plugin] 配置历史记录写入失败: ${error.message}`);
  }
  return entry;
}

function sanitizeMigrationChanges(changes = []) {
  return (Array.isArray(changes) ? changes : []).map(item => ({
    key: String(item?.key || ''),
    file: String(item?.file || ''),
    type: String(item?.type || ''),
  }));
}

function buildMigrationReportFile(fileKey = '', beforeData, afterData, reasons = []) {
  const changes = buildConfigChangePreview(fileKey, true, beforeData, true, afterData);
  if (changes.length === 0) return null;
  return {
    file: fileKey,
    reasons: Array.from(new Set((Array.isArray(reasons) ? reasons : []).map(item => String(item || '').trim()).filter(Boolean))),
    changedCount: changes.length,
    changes: sanitizeMigrationChanges(changes).slice(0, CONFIG_HISTORY_CHANGE_PREVIEW_LIMIT),
    truncatedChanges: changes.length > CONFIG_HISTORY_CHANGE_PREVIEW_LIMIT,
  };
}

async function readMigrationReport() {
  try {
    const data = JSON.parse(await fsp.readFile(configMigrationFile, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('invalid migration report');
    }
    return {
      schemaVersion: Number(data.schemaVersion || CONFIG_SCHEMA_VERSION),
      migratedAt: String(data.migratedAt || ''),
      changedFileCount: Number(data.changedFileCount || 0),
      changedCount: Number(data.changedCount || 0),
      files: Array.isArray(data.files) ? data.files : [],
    };
  } catch {
    return {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      migratedAt: '',
      changedFileCount: 0,
      changedCount: 0,
      files: [],
    };
  }
}

async function writeMigrationReport(files = []) {
  const safeFiles = (Array.isArray(files) ? files : []).filter(Boolean);
  const report = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    migratedAt: new Date().toISOString(),
    changedFileCount: safeFiles.length,
    changedCount: safeFiles.reduce((sum, item) => sum + Number(item.changedCount || 0), 0),
    files: safeFiles,
  };
  await fsp.mkdir(path.dirname(configMigrationFile), { recursive: true });
  await fsp.writeFile(configMigrationFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  lastMigrationReport = report;
  return report;
}

async function writeRuntimeConfigFile(configKey, value) {
  const filePath = path.join(dataConfigPath, `${configKey}.json`);
  await fsp.mkdir(dataConfigPath, { recursive: true });
  await fc.writeJSON(filePath, value);
}

async function deleteRuntimeConfigFile(configKey) {
  const filePath = path.join(dataConfigPath, `${configKey}.json`);
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

function normalizeConfigText(value) {
  return String(value || '').trim();
}

function isPlaceholderAiBaseApi(value) {
  const text = normalizeConfigText(value).replace(/\/+$/, '').toLowerCase();
  return AI_PLACEHOLDER_BASE_APIS.has(text) || text.includes('xx.xx.com');
}

function isPlaceholderAiApiKey(value) {
  return AI_PLACEHOLDER_API_KEYS.has(normalizeConfigText(value).toLowerCase());
}

function isPlaceholderAiModel(value) {
  return AI_PLACEHOLDER_MODELS.has(normalizeConfigText(value).toLowerCase());
}

function normalizeAiBaseApiComparable(value) {
  return normalizeConfigText(value).replace(/\/+$/, '').toLowerCase();
}

function migrateRuntimeConfig(name, data, pluginData = null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { data, changed: false };
  }

  let changed = false;
  const next = data;

  if (name === 'coreConfig') {
    for (const key of REMOVED_CORE_URL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
        changed = true;
      }
    }
  }

  if (name === 'ai') {
    const defaults = pluginData && typeof pluginData === 'object' && !Array.isArray(pluginData)
      ? pluginData
      : {};
    const hasPlaceholderBaseApi = isPlaceholderAiBaseApi(next.baseApi);
    const hasPlaceholderApiKey = isPlaceholderAiApiKey(next.apiKey);
    const usesDefaultApi = normalizeAiBaseApiComparable(next.baseApi)
      && normalizeAiBaseApiComparable(next.baseApi) === normalizeAiBaseApiComparable(defaults.baseApi);
    const usesDefaultKey = normalizeConfigText(next.apiKey) && normalizeConfigText(next.apiKey) === normalizeConfigText(defaults.apiKey);
    const shouldMigrateDefaultModels = hasPlaceholderBaseApi || hasPlaceholderApiKey || (usesDefaultApi && usesDefaultKey);
    if (hasPlaceholderBaseApi && normalizeConfigText(defaults.baseApi)) {
      next.baseApi = defaults.baseApi;
      changed = true;
    }
    if ((hasPlaceholderBaseApi || hasPlaceholderApiKey) && normalizeConfigText(defaults.apiKey)) {
      next.apiKey = defaults.apiKey;
      changed = true;
    }
    if (shouldMigrateDefaultModels && isPlaceholderAiModel(next.modelType) && normalizeConfigText(defaults.modelType)) {
      next.modelType = defaults.modelType;
      changed = true;
    }
    if (shouldMigrateDefaultModels && isPlaceholderAiModel(next.workingModel) && normalizeConfigText(defaults.workingModel)) {
      next.workingModel = defaults.workingModel;
      changed = true;
    }
    if (shouldMigrateDefaultModels && isPlaceholderAiModel(next.multimodalModel) && normalizeConfigText(defaults.multimodalModel)) {
      next.multimodalModel = defaults.multimodalModel;
      changed = true;
    }

    const imageConfig = next.imageConfig;
    if (imageConfig && typeof imageConfig === 'object' && !Array.isArray(imageConfig)) {
      const jimengApiUrl = String(imageConfig.jimengApiUrl || '').trim().replace(/\/+$/, '');
      if (LEGACY_JIMENG_API_URLS.has(jimengApiUrl)) {
        imageConfig.jimengApiUrl = '';
        changed = true;
      }
    }
  }

  return { data: next, changed };
}

/**
 * 初始化配置
 */
async function init() {
  try {
    // 确保数据配置目录存在
    try {
      await fsp.access(dataConfigPath);
    } catch {
      await fsp.mkdir(dataConfigPath, { recursive: true });
      logger.mark(`[crystelf-plugin] 配置目录创建成功: ${dataConfigPath}`);
    }

    // 确保默认配置目录存在
    try {
      await fsp.access(pluginConfigPath);
    } catch {
      logger.warn(`[crystelf-plugin] 默认配置目录不存在: ${pluginConfigPath}`);
    }

    // 处理主配置文件
    const pluginDefaultFile = path.join(pluginConfigPath, 'config.json');
    try {
      await fsp.access(configFile);
    } catch {
      try {
        await fsp.copyFile(pluginDefaultFile, configFile);
        logger.mark(`[crystelf-plugin] 默认配置复制成功: ${configFile}`);
      } catch (copyError) {
        logger.warn(`[crystelf-plugin] 复制默认配置失败,创建空配置: ${copyError}`);
        await fc.writeJSON(configFile, {});
      }
    }
    let pluginFiles = [];
    try {
      pluginFiles = (await fsp.readdir(pluginConfigPath)).filter((f) => f.endsWith('.json'));
    } catch (error) {
      logger.warn(`[crystelf-plugin] 读取默认配置目录失败: ${error}`);
    }

    // 复制缺失的配置文件
    for (const file of pluginFiles) {
      const pluginFilePath = path.join(pluginConfigPath, file);
      const dataFilePath = path.join(dataConfigPath, file);
      try {
        await fsp.access(dataFilePath);
      } catch {
        try {
          await fsp.copyFile(pluginFilePath, dataFilePath);
          logger.mark(`[crystelf-plugin] 配置文件缺失，已复制: ${file}`);
        } catch (copyError) {
          logger.warn(`[crystelf-plugin] 复制配置文件失败 ${file}: ${copyError}`);
        }
      }
    }

    // 读取所有配置文件
    const files = (await fsp.readdir(dataConfigPath)).filter((f) => f.endsWith('.json'));
    configCache = {};
    const migrationFiles = [];

    for (const file of files) {
      const filePath = path.join(dataConfigPath, file);
      const name = path.basename(file, '.json');
      try {
        let data = await fc.readJSON(filePath);
        const beforeMigrationData = cloneConfigValue(data);
        const migrationReasons = [];
        const pluginFilePath = path.join(pluginConfigPath, file);
        try {
          await fsp.access(pluginFilePath);
        } catch {
          configCache[name] = data;
          continue;
        }

        let shouldWriteData = false;
        let pluginDataForMigration = null;
        try {
          const pluginData = await fc.readJSON(pluginFilePath);
          pluginDataForMigration = pluginData;

          if (Array.isArray(data) && Array.isArray(pluginData)) {
            // 合并数组类型配置
            const strSet = new Set(data.map((x) => JSON.stringify(x)));
            for (const item of pluginData) {
              const str = JSON.stringify(item);
              if (!strSet.has(str)) {
                data.push(item);
                strSet.add(str);
                shouldWriteData = true;
              }
            }
          } else if (!Array.isArray(data) && !Array.isArray(pluginData)) {
            // 合并对象类型配置
            const mergedData = fc.mergeConfig(data, pluginData);
            shouldWriteData = JSON.stringify(mergedData) !== JSON.stringify(data);
            if (shouldWriteData) {
              migrationReasons.push('补齐默认配置字段');
            }
            data = mergedData;
          }
        } catch (mergeError) {
          logger.error('[crystelf-plugin] 合并配置失败。');
          logger.error(mergeError);
          // 忽略合并错误,使用现有数据
        }

        const migrated = migrateRuntimeConfig(name, data, pluginDataForMigration);
        data = migrated.data;
        if (migrated.changed) {
          migrationReasons.push('修正旧版兼容配置');
        }
        shouldWriteData = shouldWriteData || migrated.changed;

        if (shouldWriteData) {
          await fc.writeJSON(filePath, data);
          const reportFile = buildMigrationReportFile(name, beforeMigrationData, data, migrationReasons);
          if (reportFile) {
            migrationFiles.push(reportFile);
          }
        }

        configCache[name] = data;
      } catch (e) {
        logger.warn(`[crystelf-plugin] 读取配置文件 ${file} 失败:`, e);
      }
    }
    if (migrationFiles.length > 0) {
      const report = await writeMigrationReport(migrationFiles);
      logger.info(`[crystelf-plugin] 配置迁移完成：${report.changedFileCount} 个文件，${report.changedCount} 个字段。`);
    } else {
      lastMigrationReport = await readMigrationReport();
    }
  } catch (err) {
    logger.warn('[crystelf-plugin] 配置初始化失败，使用空配置。', err);
    configCache = {};
  }
}

/**
 * 配置文件热更新
 */
function watchConfigs() {
  for (const w of watchers) {
    w.close();
  }
  watchers = [];

  fsp.readdir(dataConfigPath).then((files) => {
    files
      .filter((f) => f.endsWith('.json'))
      .forEach((file) => {
        const filePath = path.join(dataConfigPath, file);
        const watcher = fs.watch(filePath, async (eventType) => {
          if (eventType === 'change') {
            try {
              const data = await fc.readJSON(filePath);
              const name = path.basename(file, '.json');
              configCache[name] = data;
              logger.info(`[crystelf-plugin] 配置热更新: ${file}`);
            } catch (e) {
              logger.warn(`[crystelf-plugin] 热更新读取失败 ${file}:`, e);
            }
          }
        });
        watchers.push(watcher);
      });
  });
}

const configControl = {
  async init() {
    await init();
    watchConfigs();
  },

  get(key) {
    return key ? configCache[normalizeConfigKey(key)] : configCache;
  },

  getMigrationReport() {
    return cloneConfigValue(lastMigrationReport);
  },

  async set(key, value, options = {}) {
    const configKey = normalizeConfigKey(key);
    const beforeFiles = Object.prototype.hasOwnProperty.call(configCache, configKey)
      ? { [configKey]: cloneConfigValue(configCache[configKey]) }
      : {};

    try {
      configCache[configKey] = value;
      await writeRuntimeConfigFile(configKey, value);
      await appendConfigHistory(beforeFiles, { [configKey]: cloneConfigValue(value) }, options);
    } catch (error) {
      logger.error(`[crystelf-plugin] 设置配置失败 ${configKey}: ${error}`);
      throw error;
    }
  },

  /**
   * 批量设置配置
   * @param {Object} configs - 配置对象，键为配置名，值为配置数据
   */
  async setMultiple(configs, options = {}) {
    // 确保目录存在
    await fsp.mkdir(dataConfigPath, { recursive: true });

    const entries = Object.entries(configs).map(([key, value]) => [normalizeConfigKey(key), value]);
    const beforeFiles = {};
    const afterFiles = {};
    for (const [key, value] of entries) {
      if (Object.prototype.hasOwnProperty.call(configCache, key)) {
        beforeFiles[key] = cloneConfigValue(configCache[key]);
      }
      afterFiles[key] = cloneConfigValue(value);
    }
    for (const [key, value] of entries) {
      try {
        // 更新内存中的配置
        configCache[key] = value;
        await writeRuntimeConfigFile(key, value);
      } catch (error) {
        logger.error(`[crystelf-plugin] 设置配置失败 ${key}: ${error}`);
        throw error;
      }
    }
    await appendConfigHistory(beforeFiles, afterFiles, options);
  },

  async save() {
    // 确保目录存在
    await fsp.mkdir(dataConfigPath, { recursive: true });

    for (const [key, value] of Object.entries(configCache)) {
      const filePath = path.join(dataConfigPath, `${key}.json`);

      try {
        // 直接写入配置文件
        await fc.writeJSON(filePath, value);
      } catch (error) {
        logger.error(`[crystelf-plugin] 保存配置文件失败 ${filePath}: ${error}`);
        throw error;
      }
    }
  },

  async reload() {
    await init();
    watchConfigs();
    return true;
  },

  async getHistory(options = {}) {
    const limit = Math.max(1, Math.min(100, Number(options.limit || 20) || 20));
    const entries = await readConfigHistoryEntries();
    return entries
      .slice(-limit)
      .reverse();
  },

  async rollbackHistory(id) {
    const historyId = String(id || '').trim();
    if (!historyId) {
      throw new Error('缺少配置历史记录 ID');
    }
    const entries = await readConfigHistoryEntries();
    const entry = entries.find(item => String(item.id || '') === historyId);
    if (!entry || !entry.files || typeof entry.files !== 'object') {
      throw new Error('配置历史记录不存在或已被清理');
    }

    const beforeFiles = {};
    const afterFiles = {};
    const targets = Object.entries(entry.files)
      .map(([key, snapshot]) => [normalizeConfigKey(key), snapshot || {}]);

    for (const [key] of targets) {
      if (Object.prototype.hasOwnProperty.call(configCache, key)) {
        beforeFiles[key] = cloneConfigValue(configCache[key]);
      }
    }

    for (const [key, snapshot] of targets) {
      if (snapshot.beforeExists === true) {
        const value = cloneConfigValue(snapshot.before);
        configCache[key] = value;
        afterFiles[key] = cloneConfigValue(value);
        await writeRuntimeConfigFile(key, value);
      } else {
        delete configCache[key];
        await deleteRuntimeConfigFile(key);
      }
    }

    const rollbackEntry = await appendConfigHistory(beforeFiles, afterFiles, {
      action: 'config_history_rollback',
      source: `history:${historyId}`,
    });

    return {
      success: true,
      rolledBackFrom: historyId,
      restoredKeys: targets.map(([key]) => key),
      count: targets.length,
      historyEntry: rollbackEntry,
    };
  },
};

export default configControl;
