const SENSITIVE_CONFIG_KEY_SEGMENTS = new Set([
  'apikey',
  'token',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearertoken',
  'authorization',
  'password',
  'passwd',
  'secret',
  'credential',
  'credentials',
  'privatekey',
  'accesskey',
]);

function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

export function normalizeSensitiveConfigKeySegment(segment = '') {
  return String(segment || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

export function isSensitiveConfigKeySegment(segment = '') {
  const rawSegment = String(segment || '').trim();
  if (!rawSegment || rawSegment.startsWith('?')) {
    return false;
  }
  const normalized = normalizeSensitiveConfigKeySegment(rawSegment);
  if (!normalized) {
    return false;
  }
  if (SENSITIVE_CONFIG_KEY_SEGMENTS.has(normalized)) {
    return true;
  }
  return normalized.endsWith('apikey')
    || normalized.endsWith('authtoken')
    || normalized.endsWith('accesstoken')
    || normalized.endsWith('refreshtoken')
    || normalized.endsWith('idtoken')
    || normalized.endsWith('bearertoken')
    || normalized.endsWith('authorization')
    || normalized.endsWith('password')
    || normalized.endsWith('passwd')
    || normalized.endsWith('secret')
    || normalized.endsWith('credential')
    || normalized.endsWith('credentials')
    || normalized.endsWith('privatekey')
    || normalized.endsWith('accesskey')
    || normalized.endsWith('token');
}

function flattenConfigEntries(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenConfigEntries(value, nextKey));
    } else {
      result[nextKey] = value;
    }
  }
  return result;
}

function isSensitiveConfigPreviewKey(key = '') {
  return String(key || '').split('.').some(segment => isSensitiveConfigKeySegment(segment));
}

function maskConfigRestorePreviewValue(key = '', value) {
  if (!isSensitiveConfigPreviewKey(key)) {
    return value;
  }
  if (value === undefined || value === null) {
    return value;
  }
  return String(value || '').trim() ? '******' : '';
}

function normalizeConfigBackupFileKey(key = '', createHttpError = createHttpErrorFallback) {
  const normalized = String(key || '').trim();
  const lower = normalized.toLowerCase();
  if (
    !normalized
    || !/^[a-zA-Z0-9_-]+$/.test(normalized)
    || lower === '__proto__'
    || lower === 'prototype'
    || lower === 'constructor'
  ) {
    throw createHttpError(400, `非法配置文件名: ${normalized || '(empty)'}`, 'CONFIG_BACKUP_INVALID_FILE_KEY');
  }
  return normalized;
}

function normalizeConfigBackupFiles(files = {}, createHttpError = createHttpErrorFallback) {
  const normalizedFiles = {};
  for (const [key, value] of Object.entries(files || {})) {
    const normalizedKey = normalizeConfigBackupFileKey(key, createHttpError);
    if (Object.prototype.hasOwnProperty.call(normalizedFiles, normalizedKey)) {
      throw createHttpError(400, `重复配置文件名: ${normalizedKey}`, 'CONFIG_BACKUP_DUPLICATE_FILE_KEY');
    }
    normalizedFiles[normalizedKey] = value;
  }
  return normalizedFiles;
}

export function createConfigBackupConsole(options = {}) {
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const setMultipleConfigs = typeof options.setMultipleConfigs === 'function' ? options.setMultipleConfigs : async () => {};
  const configRoot = options.configRoot || '';
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const maskSecretValue = typeof options.maskSecretValue === 'function'
    ? options.maskSecretValue
    : value => (String(value || '').trim() ? '******' : '');

  function buildBackupPayload() {
    const allConfigs = getAllConfigs() || {};
    return {
      exportedAt: new Date().toISOString(),
      source: 'crystelf-web-console-config-backup',
      configRoot,
      files: allConfigs,
    };
  }

  function maskConfigPayloadSecretValue(value) {
    if (value === undefined || value === null) {
      return value;
    }
    if (typeof value === 'string') {
      return maskSecretValue(value);
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? '******' : [];
    }
    if (typeof value === 'object') {
      return Object.keys(value).length > 0 ? '******' : {};
    }
    return String(value || '').trim() ? '******' : value;
  }

  function maskConfigPayloadSecrets(value) {
    if (Array.isArray(value)) {
      return value.map(item => maskConfigPayloadSecrets(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveConfigKeySegment(key)
        ? maskConfigPayloadSecretValue(item)
        : maskConfigPayloadSecrets(item),
    ]));
  }

  function buildRestorePreviewPayload(payload = {}) {
    const files = payload?.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
      throw new Error('配置备份数据格式不正确，缺少有效的 files 字段');
    }
    const normalizedFiles = normalizeConfigBackupFiles(files, createHttpError);
    const currentFiles = getAllConfigs() || {};
    const currentFlat = flattenConfigEntries(currentFiles);
    const incomingFlat = flattenConfigEntries(normalizedFiles);
    const allKeys = Array.from(new Set([...Object.keys(currentFlat), ...Object.keys(incomingFlat)])).sort();
    const changes = allKeys
      .filter(key => JSON.stringify(currentFlat[key]) !== JSON.stringify(incomingFlat[key]))
      .map(key => ({
        key,
        file: key.split('.')[0] || 'unknown',
        type: key in currentFlat ? (key in incomingFlat ? 'modified' : 'deleted') : 'added',
        current: maskConfigRestorePreviewValue(key, currentFlat[key]),
        next: maskConfigRestorePreviewValue(key, incomingFlat[key]),
        sensitive: isSensitiveConfigPreviewKey(key),
      }));
    const groups = Object.entries(changes.reduce((acc, item) => {
      acc[item.file] ||= [];
      acc[item.file].push(item);
      return acc;
    }, {})).map(([file, items]) => ({ file, count: items.length, items: items.slice(0, 40) }));
    return {
      success: true,
      changedCount: changes.length,
      changedKeys: changes.slice(0, 120),
      restoredKeys: Object.keys(normalizedFiles),
      groups,
    };
  }

  async function restoreBackupPayload(payload = {}) {
    const files = payload?.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
      throw new Error('配置备份数据格式不正确，缺少有效的 files 字段');
    }
    const normalizedFiles = normalizeConfigBackupFiles(files, createHttpError);
    const selectedFiles = Array.isArray(payload?.selectedFiles)
      ? payload.selectedFiles
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .map(item => normalizeConfigBackupFileKey(item, createHttpError))
      : [];
    const selectedFileSet = new Set(selectedFiles);
    const filesToRestore = selectedFiles.length > 0
      ? Object.fromEntries(Object.entries(normalizedFiles).filter(([key]) => selectedFileSet.has(key)))
      : normalizedFiles;
    if (Object.keys(filesToRestore).length === 0) {
      throw new Error('没有可恢复的配置文件，请检查 selectedFiles 或备份内容');
    }
    await setMultipleConfigs(filesToRestore);
    return {
      success: true,
      restoredKeys: Object.keys(filesToRestore),
      count: Object.keys(filesToRestore).length,
    };
  }

  return {
    buildBackupPayload,
    buildRestorePreviewPayload,
    restoreBackupPayload,
    maskConfigPayloadSecrets,
  };
}
