import fs from 'fs';
import path from 'path';
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import axios from 'axios';
import Path from '../../constants/path.js';

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_RESULT_TEXT_LENGTH = 4000;
const MAX_RESULT_ARRAY_ITEMS = 10;
const MAX_RESULT_OBJECT_KEYS = 30;
const MAX_SANITIZE_DEPTH = 4;
const ALLOWED_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SKILL_SPLIT_INDEX_FILE_NAMES = new Set(['index.json', 'list.json']);
const SKILL_LOG_MASKED_SECRET_VALUE = '******';
const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
const FULL_TEMPLATE_TOKEN_PATTERN = /^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/;

function normalizeSegment(value, fallback = 'tool') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function buildExportedToolName(skillName, toolName) {
  const prefix = `skill__${normalizeSegment(skillName, 'skill')}__${normalizeSegment(toolName, 'tool')}`;
  return prefix.slice(0, MAX_TOOL_NAME_LENGTH);
}

function normalizeTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(numeric), 1000), 60000);
}

function getByPath(source, pathValue) {
  const pathText = String(pathValue || '').trim();
  if (!pathText) {
    return source;
  }

  return pathText.split('.').reduce((current, key) => {
    if (current == null) {
      return undefined;
    }
    return current[key];
  }, source);
}

function tryParseStructuredString(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  const looksLikeObject = trimmed.startsWith('{') && trimmed.endsWith('}');
  const looksLikeArray = trimmed.startsWith('[') && trimmed.endsWith(']');
  if (!looksLikeObject && !looksLikeArray) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function resolveTemplateValue(keyPath, args = {}, globalConfig = {}) {
  const normalizedPath = String(keyPath || '').trim();
  if (!normalizedPath) {
    return undefined;
  }

  const directValue = getByPath(args, normalizedPath);
  if (directValue !== undefined && directValue !== null && directValue !== '') {
    return directValue;
  }

  if (normalizedPath.startsWith('env.')) {
    const envKey = normalizedPath.slice(4).trim();
    return envKey ? process.env[envKey] : undefined;
  }

  if (normalizedPath.startsWith('process.env.')) {
    const envKey = normalizedPath.slice('process.env.'.length).trim();
    return envKey ? process.env[envKey] : undefined;
  }

  const globalEnvValue = getByPath(globalConfig, normalizedPath);
  if (globalEnvValue !== undefined && globalEnvValue !== null && globalEnvValue !== '') {
    return globalEnvValue;
  }

  return process.env[normalizedPath];
}

function applyTemplate(value, args = {}, options = {}) {
  if (Array.isArray(value)) {
    return value.map(item => applyTemplate(item, args, options));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, applyTemplate(item, args, options)])
    );
  }

  if (typeof value !== 'string') {
    return value;
  }

  const fullTokenMatch = value.match(FULL_TEMPLATE_TOKEN_PATTERN);
  if (fullTokenMatch) {
    const resolved = resolveTemplateValue(fullTokenMatch[1], args, options.globalConfig);
    if (resolved == null || resolved === '') {
      return undefined;
    }
    return tryParseStructuredString(resolved);
  }

  return value.replace(TEMPLATE_TOKEN_PATTERN, (_, keyPath) => {
    const resolved = resolveTemplateValue(keyPath, args, options.globalConfig);
    if (resolved == null) {
      return '';
    }
    return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
  });
}

function compactDeepValue(value) {
  if (value == null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    const items = value
      .map(item => compactDeepValue(item))
      .filter(item => item !== undefined);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, compactDeepValue(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  return value;
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item !== '' && item !== undefined && item !== null)
  );
}

function sanitizeResultValue(value, depth = 0) {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > MAX_RESULT_TEXT_LENGTH ? `${value.slice(0, MAX_RESULT_TEXT_LENGTH)}...` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (depth >= MAX_SANITIZE_DEPTH) {
    return '[Truncated]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_RESULT_ARRAY_ITEMS).map(item => sanitizeResultValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_RESULT_OBJECT_KEYS)
        .map(([key, item]) => [key, sanitizeResultValue(item, depth + 1)])
    );
  }

  return String(value);
}

function formatResultSummary(value, maxLength = MAX_RESULT_TEXT_LENGTH) {
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}...` : serialized;
  } catch {
    return String(value);
  }
}

function normalizeSensitiveUrlQueryKey(key = '') {
  return String(key || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function isSensitiveUrlQueryKey(key = '') {
  const normalized = normalizeSensitiveUrlQueryKey(key);
  if (!normalized) {
    return false;
  }
  return normalized === 'key'
    || normalized === 'apikey'
    || normalized === 'token'
    || normalized === 'authtoken'
    || normalized === 'accesstoken'
    || normalized === 'refreshtoken'
    || normalized === 'authorization'
    || normalized === 'password'
    || normalized === 'passwd'
    || normalized === 'secret'
    || normalized === 'privatekey'
    || normalized === 'accesskey'
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

function redactSensitiveUrlForLog(value = '') {
  try {
    const parsed = new URL(String(value || ''));
    for (const key of Array.from(new Set(Array.from(parsed.searchParams.keys())))) {
      if (isSensitiveUrlQueryKey(key) && parsed.searchParams.getAll(key).some(item => String(item || '').trim())) {
        parsed.searchParams.delete(key);
        parsed.searchParams.append(key, SKILL_LOG_MASKED_SECRET_VALUE);
      }
    }
    return parsed.toString();
  } catch {
    return String(value || '');
  }
}

function parseIpv4ToInt(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return null;
    }
    value = (value << 8) + num;
  }
  return value >>> 0;
}

function isIpv4InCidr(ip, base, prefix) {
  const ipValue = parseIpv4ToInt(ip);
  const baseValue = parseIpv4ToInt(base);
  if (ipValue === null || baseValue === null) {
    return false;
  }
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipValue & mask) === (baseValue & mask);
}

function isBlockedSkillIpAddress(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const ipType = net.isIP(normalized);
  if (!ipType) {
    return false;
  }

  if (ipType === 4) {
    return isIpv4InCidr(normalized, '0.0.0.0', 8)
      || isIpv4InCidr(normalized, '10.0.0.0', 8)
      || isIpv4InCidr(normalized, '100.64.0.0', 10)
      || isIpv4InCidr(normalized, '127.0.0.0', 8)
      || isIpv4InCidr(normalized, '169.254.0.0', 16)
      || isIpv4InCidr(normalized, '172.16.0.0', 12)
      || isIpv4InCidr(normalized, '192.168.0.0', 16)
      || isIpv4InCidr(normalized, '198.18.0.0', 15)
      || isIpv4InCidr(normalized, '224.0.0.0', 4);
  }

  if (normalized === '::' || normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    return net.isIP(mappedIpv4) === 4 ? isBlockedSkillIpAddress(mappedIpv4) : true;
  }
  if (/^fe[89ab]/.test(normalized)) {
    return true;
  }
  if (/^f[cd]/.test(normalized)) {
    return true;
  }
  if (/^ff/.test(normalized)) {
    return true;
  }
  return false;
}

function isBlockedSkillHostname(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) {
    return true;
  }
  return normalized === 'localhost' || normalized.endsWith('.localhost');
}

async function assertSafeSkillResolvedHostname(hostname = '') {
  const lookupHostname = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!lookupHostname) {
    throw new Error('skill request hostname is empty');
  }
  if (isBlockedSkillHostname(lookupHostname) || isBlockedSkillIpAddress(lookupHostname)) {
    throw new Error('skill request refused local or private network target');
  }
  if (net.isIP(lookupHostname)) {
    return;
  }

  let records = [];
  try {
    records = await dns.lookup(lookupHostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`skill hostname lookup failed: ${error.message}`);
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('skill hostname lookup failed');
  }
  if (records.some(record => isBlockedSkillIpAddress(record?.address))) {
    throw new Error('skill request refused hostname resolving to local or private network');
  }
}

function createSkillSafeLookup() {
  return async (hostname, options, callback) => {
    try {
      const lookupHostname = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
      await assertSafeSkillResolvedHostname(lookupHostname);
      const lookupOptions = {
        ...options,
        all: true,
        verbatim: true,
      };
      const records = await dns.lookup(lookupHostname, lookupOptions);
      const result = (Array.isArray(records) ? records : [records])
        .filter(record => record?.address);
      if (result.length === 0) {
        throw new Error('skill hostname lookup failed');
      }
      if (result.some(record => isBlockedSkillIpAddress(record.address))) {
        throw new Error('skill request refused hostname resolving to local or private network');
      }
      if (options?.all) {
        callback(null, result);
      } else {
        callback(null, result[0].address, result[0].family);
      }
    } catch (error) {
      callback(error);
    }
  };
}

async function validateResolvedUrl(rawUrl, resolvedUrl, allowedHosts = []) {
  let raw;
  let resolved;
  try {
    raw = new URL(String(rawUrl || ''));
    resolved = new URL(String(resolvedUrl || ''));
  } catch (error) {
    throw new Error(`invalid skill url: ${error.message}`);
  }

  if (!['http:', 'https:'].includes(resolved.protocol)) {
    throw new Error('skill url must use http or https');
  }

  if (raw.hostname && resolved.hostname !== raw.hostname && (!allowedHosts || allowedHosts.length === 0)) {
    throw new Error('resolved skill hostname changed unexpectedly');
  }

  const resolvedHostname = resolved.hostname.toLowerCase();
  const normalizedAllowedHosts = Array.isArray(allowedHosts)
    ? allowedHosts.map(host => String(host || '').trim().toLowerCase()).filter(Boolean)
    : [];

  if (
    normalizedAllowedHosts.length > 0
    && !normalizedAllowedHosts.some((hostPattern) => {
      if (!hostPattern.startsWith('*.')) {
        return resolvedHostname === hostPattern;
      }
      const suffix = hostPattern.slice(2);
      return Boolean(suffix) && resolvedHostname.endsWith(`.${suffix}`) && resolvedHostname !== suffix;
    })
  ) {
    throw new Error(`skill hostname "${resolved.hostname}" is not in allow list`);
  }

  await assertSafeSkillResolvedHostname(resolved.hostname);
  return resolved.toString();
}

function pickResponseFields(source, fields = []) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return source;
  }

  return Object.fromEntries(
    fields.map(field => [field, getByPath(source, field)])
  );
}

function safeReadJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    logger.warn(`[http-skill] 读取技能配置失败: ${filePath} | ${error.message}`);
    return null;
  }
}

function mergeOrderedNamedItems(indexItems = [], detailItems = [], keyName = 'name') {
  const result = [];
  const detailMap = new Map(
    (Array.isArray(detailItems) ? detailItems : [])
      .filter(item => item && item[keyName])
      .map(item => [item[keyName], item])
  );
  const used = new Set();

  for (const indexItem of Array.isArray(indexItems) ? indexItems : []) {
    if (!indexItem || !indexItem[keyName]) {
      continue;
    }
    const key = indexItem[keyName];
    const detailItem = detailMap.get(key) || {};
    const mergedItem = {
      ...detailItem,
      ...indexItem,
    };
    if (Array.isArray(detailItem.tools) || Array.isArray(indexItem.tools)) {
      mergedItem.tools = mergeOrderedNamedItems(indexItem.tools || [], detailItem.tools || [], 'name');
    }
    result.push(mergedItem);
    used.add(key);
  }

  for (const detailItem of Array.isArray(detailItems) ? detailItems : []) {
    if (!detailItem || !detailItem[keyName] || used.has(detailItem[keyName])) {
      continue;
    }
    result.push(detailItem);
  }

  return result;
}

function readSplitSkillDefinitions(dirPath) {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return [];
    }
    return fs.readdirSync(dirPath)
      .filter(fileName => fileName.endsWith('.json') && !SKILL_SPLIT_INDEX_FILE_NAMES.has(fileName))
      .sort((a, b) => a.localeCompare(b))
      .map((fileName) => safeReadJsonFile(path.join(dirPath, fileName)))
      .filter(item => item && typeof item === 'object' && !Array.isArray(item) && item.name);
  } catch (error) {
    logger.warn(`[http-skill] 读取分拆 skills 目录失败: ${dirPath} | ${error.message}`);
    return [];
  }
}

export function readDefaultSkillConfig() {
  const fallbackPath = path.join(Path.defaultConfigPath, 'skills.json');
  const splitDirPath = path.join(Path.defaultConfigPath, 'skills');
  const fallbackConfig = safeReadJsonFile(fallbackPath) || {};
  const splitDefinitions = readSplitSkillDefinitions(splitDirPath);
  if (splitDefinitions.length === 0) {
    return fallbackConfig;
  }

  return {
    ...fallbackConfig,
    definitions: mergeOrderedNamedItems(fallbackConfig.definitions || [], splitDefinitions, 'name'),
  };
}

export function readRuntimeSkillConfig() {
  const runtimePath = path.join(Path.config, 'skills.json');
  const splitDirPath = path.join(Path.config, 'skills');
  const runtimeConfig = safeReadJsonFile(runtimePath) || {};
  const splitDefinitions = readSplitSkillDefinitions(splitDirPath);
  if (splitDefinitions.length === 0) {
    return runtimeConfig;
  }

  return {
    ...runtimeConfig,
    definitions: mergeOrderedNamedItems(runtimeConfig.definitions || [], splitDefinitions, 'name'),
  };
}

function mergeNamedItems(defaultItems = [], customItems = [], keyName = 'name') {
  const merged = [];
  const customMap = new Map(
    (Array.isArray(customItems) ? customItems : [])
      .filter(item => item && item[keyName])
      .map(item => [item[keyName], item])
  );

  for (const defaultItem of Array.isArray(defaultItems) ? defaultItems : []) {
    if (!defaultItem || !defaultItem[keyName]) {
      continue;
    }

    const customItem = customMap.get(defaultItem[keyName]);
    if (!customItem) {
      merged.push(defaultItem);
      continue;
    }

    const mergedItem = {
      ...defaultItem,
      ...customItem,
    };

    if (Array.isArray(defaultItem.tools) || Array.isArray(customItem.tools)) {
      mergedItem.tools = mergeNamedItems(defaultItem.tools || [], customItem.tools || [], 'name');
    }

    merged.push(mergedItem);
    customMap.delete(defaultItem[keyName]);
  }

  for (const item of customMap.values()) {
    merged.push(item);
  }

  return merged;
}

function mergeSkillConfig(defaultConfig = {}, customConfig = {}) {
  const merged = {
    ...defaultConfig,
    ...customConfig,
  };

  merged.definitions = mergeNamedItems(defaultConfig.definitions || [], customConfig.definitions || [], 'name');
  return merged;
}

export function getSkillConfig() {
  const defaultConfig = readDefaultSkillConfig();
  const configFromCache = readRuntimeSkillConfig();
  if (configFromCache && typeof configFromCache === 'object' && Object.keys(configFromCache).length > 0) {
    return mergeSkillConfig(defaultConfig, configFromCache);
  }

  return defaultConfig;
}

async function executeHttpSkill(skillDefinition, toolDefinition, args = {}, globalConfig = {}) {
  const request = toolDefinition?.request || {};
  const responseConfig = toolDefinition?.response || {};
  const rawUrl = String(request.url || '').trim();
  if (!rawUrl) {
    return {
      success: false,
      error: 'skill request url is empty',
    };
  }

  const method = String(request.method || 'GET').trim().toUpperCase();
  if (!ALLOWED_HTTP_METHODS.has(method)) {
    return {
      success: false,
      error: `unsupported skill method: ${method}`,
    };
  }

  const timeoutMs = normalizeTimeout(
    toolDefinition?.timeoutMs ?? skillDefinition?.timeoutMs ?? globalConfig?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  const allowedHosts = Array.isArray(toolDefinition?.allowedHosts)
    ? toolDefinition.allowedHosts
    : Array.isArray(skillDefinition?.allowedHosts)
      ? skillDefinition.allowedHosts
      : [];

  const templateOptions = { globalConfig };
  const resolvedUrl = await validateResolvedUrl(rawUrl, applyTemplate(rawUrl, args, templateOptions), allowedHosts);
  const headers = compactObject(compactDeepValue(applyTemplate(request.headers || {}, args, templateOptions)) || {});
  const params = compactObject(compactDeepValue(applyTemplate(request.query || {}, args, templateOptions)) || {});
  const data = compactDeepValue(applyTemplate(request.body, args, templateOptions));
  const startedAt = Date.now();
  const safeLookup = createSkillSafeLookup();

  logger.info(
    `[http-skill] ${skillDefinition.name}.${toolDefinition.name} 开始 | method=${method} | url="${redactSensitiveUrlForLog(resolvedUrl)}" | timeout_ms=${timeoutMs}`
  );

  try {
    const response = await axios({
      method,
      url: resolvedUrl,
      headers,
      params,
      data,
      timeout: timeoutMs,
      maxRedirects: 0,
      httpAgent: new http.Agent({ lookup: safeLookup }),
      httpsAgent: new https.Agent({ lookup: safeLookup }),
      validateStatus: () => true,
    });

    const status = Number(response.status || 0);
    const responseData = response.data;
    if (status < 200 || status >= 300) {
      return {
        success: false,
        skill: skillDefinition.name,
        tool: toolDefinition.name,
        status,
        error: `HTTP ${status}`,
        detail: formatResultSummary(sanitizeResultValue(responseData), 1000),
      };
    }

    const source = getByPath(responseData, responseConfig.path);
    const selected = pickResponseFields(source, responseConfig.pick);
    const resultValue = sanitizeResultValue(selected);
    return {
      success: true,
      skill: skillDefinition.name,
      tool: toolDefinition.name,
      status,
      elapsed_ms: Date.now() - startedAt,
      data: resultValue,
      summary: formatResultSummary(resultValue, Number(responseConfig.maxLength || MAX_RESULT_TEXT_LENGTH)),
    };
  } catch (error) {
    return {
      success: false,
      skill: skillDefinition.name,
      tool: toolDefinition.name,
      error: error.response?.data?.message || error.message,
    };
  }
}

function normalizeToolDefinition(skillDefinition, toolDefinition = {}, globalConfig = {}) {
  if (toolDefinition?.enabled === false || !toolDefinition?.name || !toolDefinition?.description || !toolDefinition?.request?.url) {
    return null;
  }

  const exportName = buildExportedToolName(skillDefinition.name, toolDefinition.name);
  const displayName = `${skillDefinition.name}.${toolDefinition.name}`;
  return {
    name: exportName,
    displayName,
    description: String(toolDefinition.description || '').trim(),
    parameters: toolDefinition.parameters || {
      type: 'object',
      properties: {},
    },
    returnToAI: toolDefinition.returnToAI !== false,
    stopOnFailure: toolDefinition.stopOnFailure === true,
    handler: async (args = {}) => executeHttpSkill(skillDefinition, toolDefinition, args, globalConfig),
  };
}

function normalizeSkillDefinition(definition = {}, globalConfig = {}) {
  if (!definition?.enabled || !definition?.name) {
    return null;
  }

  const tools = (Array.isArray(definition.tools) ? definition.tools : [])
    .map(tool => normalizeToolDefinition(definition, tool, globalConfig))
    .filter(Boolean);

  if (tools.length === 0) {
    return null;
  }

  return {
    name: String(definition.name).trim(),
    description: String(definition.description || '').trim(),
    tools,
  };
}

export async function loadAutoSessionSkills(skillManager, sessionId) {
  if (!skillManager || !sessionId) {
    return [];
  }

  const skillConfig = getSkillConfig();
  if (skillConfig.enabled !== true || skillConfig.autoLoad === false) {
    return [];
  }

  const loaded = [];
  const existing = new Set(
    typeof skillManager.getSkillNames === 'function' ? skillManager.getSkillNames(sessionId) : []
  );
  const definitions = Array.isArray(skillConfig.definitions) ? skillConfig.definitions : [];
  for (const definition of definitions) {
    const normalized = normalizeSkillDefinition(definition, skillConfig);
    if (!normalized) {
      continue;
    }
    skillManager.loadSkill(sessionId, normalized.name, normalized.tools, {
      description: normalized.description,
    });
    loaded.push(normalized.name);
  }

  for (const skillName of existing) {
    if (!loaded.includes(skillName)) {
      skillManager.unloadSkill(sessionId, skillName);
    }
  }
  return loaded;
}
