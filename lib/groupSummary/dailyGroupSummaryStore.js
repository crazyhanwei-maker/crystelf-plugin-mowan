import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../utils/atomicStore.js';

export const DAILY_GROUP_SUMMARY_DIR = path.join(process.cwd(), 'data', 'crystelf', 'group-summary');
const DAILY_GROUP_SUMMARY_STATE_FILE = path.join(DAILY_GROUP_SUMMARY_DIR, 'state.json');
const DAILY_GROUP_SUMMARY_RESULT_FILE = path.join(DAILY_GROUP_SUMMARY_DIR, 'summaries.jsonl');
const DAILY_GROUP_SUMMARY_LOCK_DIR = path.join(DAILY_GROUP_SUMMARY_DIR, 'locks');
const DAILY_GROUP_SUMMARY_LOCK_STALE_MS = 30 * 60 * 1000;

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

// 群总结的"一天"与调度时刻统一按此时区（分钟偏移）计算；多数海外服务器为 UTC，
// 默认 +480（北京时间）。可从外部注入配置解析（server.js 接 timezoneOffset）。
const DEFAULT_SUMMARY_TIMEZONE_OFFSET_MINUTES = 480;
let summaryTimezoneOffsetResolver = () => DEFAULT_SUMMARY_TIMEZONE_OFFSET_MINUTES;

export function setSummaryTimezoneOffsetResolver(resolver) {
  if (typeof resolver === 'function') {
    summaryTimezoneOffsetResolver = resolver;
  }
}

function resolveSummaryTimezoneOffsetMinutes() {
  try {
    const value = summaryTimezoneOffsetResolver();
    if (value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) && num >= -720 && num <= 840 ? Math.round(num) : DEFAULT_SUMMARY_TIMEZONE_OFFSET_MINUTES;
  } catch {
    return DEFAULT_SUMMARY_TIMEZONE_OFFSET_MINUTES;
  }
}

// 把绝对时刻换算到配置时区下的"显示用日期"（仅取年月日/时分，不 new Date 环境依赖）
function toZonedParts(date = new Date()) {
  const offsetMinutes = resolveSummaryTimezoneOffsetMinutes();
  const shifted = offsetMinutes !== null
    ? new Date(date.getTime() + offsetMinutes * 60000)
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

function ensureSummaryDir() {
  if (!fs.existsSync(DAILY_GROUP_SUMMARY_DIR)) {
    fs.mkdirSync(DAILY_GROUP_SUMMARY_DIR, { recursive: true });
  }
}

function normalizeGroupId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function normalizeDateKey(value = '') {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : getDailySummaryDateKey();
}

function normalizeGroupIdList(value = []) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalizeGroupId).filter(Boolean)));
}

function readBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function readInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function readNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function trimText(value = '', maxLength = 300) {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getDailyMessageFile(dateKey = getDailySummaryDateKey()) {
  return path.join(DAILY_GROUP_SUMMARY_DIR, `${dateKey}.jsonl`);
}

function readJsonFile(filePath = '', fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath = '', value = {}) {
  ensureSummaryDir();
  writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

function readLockInfo(lockDir = '') {
  try {
    const filePath = path.join(lockDir, 'lock.json');
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isLockStale(lockDir = '', staleMs = DAILY_GROUP_SUMMARY_LOCK_STALE_MS) {
  try {
    const info = readLockInfo(lockDir);
    const lockTime = new Date(info.time || 0).getTime();
    const statTime = fs.existsSync(lockDir) ? fs.statSync(lockDir).mtimeMs : 0;
    const time = Number.isFinite(lockTime) && lockTime > 0 ? lockTime : statTime;
    return !time || Date.now() - time > staleMs;
  } catch {
    return true;
  }
}

function removeDirectoryRecursive(targetDir = '') {
  if (!fs.existsSync(targetDir)) return;
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const entryPath = path.join(targetDir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      removeDirectoryRecursive(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  }
  fs.rmdirSync(targetDir);
}

function removeLockDir(lockDir = '') {
  const resolvedLockDir = path.resolve(lockDir);
  const resolvedRoot = path.resolve(DAILY_GROUP_SUMMARY_LOCK_DIR);
  const relativePath = path.relative(resolvedRoot, resolvedLockDir);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
  removeDirectoryRecursive(resolvedLockDir);
}

function parseJsonlFile(filePath = '') {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    logger.warn(`[daily-group-summary] 读取消息记录失败: ${error.message}`);
    return [];
  }
}

function readState() {
  const state = readJsonFile(DAILY_GROUP_SUMMARY_STATE_FILE, { runs: {} });
  return {
    runs: state.runs && typeof state.runs === 'object' && !Array.isArray(state.runs) ? state.runs : {},
  };
}

function writeState(state = {}) {
  writeJsonFile(DAILY_GROUP_SUMMARY_STATE_FILE, {
    runs: state.runs && typeof state.runs === 'object' && !Array.isArray(state.runs) ? state.runs : {},
  });
}

export function normalizeDailyGroupSummaryConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const targetMode = String(source.targetMode || 'selected').trim();
  return {
    enabled: readBoolean(source.enabled, false),
    targetMode: targetMode === 'all' ? 'all' : 'selected',
    enabledGroups: normalizeGroupIdList(source.enabledGroups),
    blockedGroups: normalizeGroupIdList(source.blockedGroups),
    hour: readInteger(source.hour, 23, 0, 23),
    minute: readInteger(source.minute, 55, 0, 59),
    minMessages: readInteger(source.minMessages, 5, 1, 500),
    maxMessages: readInteger(source.maxMessages, 200, 10, 1000),
    maxMessageChars: readInteger(source.maxMessageChars, 220, 20, 1000),
    maxSummaryChars: readInteger(source.maxSummaryChars, 1200, 100, 3000),
    retentionDays: readInteger(source.retentionDays, 7, 1, 60),
    temperature: readNumber(source.temperature, 0.3, 0, 2),
    maxTokens: readInteger(source.maxTokens, 800, 100, 4000),
    includeCommands: readBoolean(source.includeCommands, false),
    imageEnabled: readBoolean(source.imageEnabled, true),
    title: trimText(source.title || '今日群聊总结', 60) || '今日群聊总结',
    prompt: trimText(source.prompt || '', 2000),
  };
}

export function getDailySummaryDateKey(date = new Date()) {
  const { year, month, day } = toZonedParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isDailySummaryScheduleDue(date = new Date(), config = {}) {
  const cfg = normalizeDailyGroupSummaryConfig(config);
  // 过了计划时刻即视为到期（>= 语义），保证 Bot 在计划时刻没运行、重启窗口错过
  // 或高负载延迟时仍能在随后补发。重复发送由 runGroupSummary 的双重去重
  // （内存 sentGroups + 持久化 hasDailyGroupSummarySent）保证不会发生。
  // 时刻按配置时区换算，服务器系统时区（常为 UTC）不影响语义。
  const { hours, minutes } = toZonedParts(date);
  const currentMinutes = hours * 60 + minutes;
  const scheduledMinutes = cfg.hour * 60 + cfg.minute;
  return currentMinutes >= scheduledMinutes;
}

export function isGroupDailySummaryEnabled(groupId = '', mainConfig = {}, aiConfig = {}) {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return false;
  if (mainConfig?.ai === false) return false;
  const cfg = normalizeDailyGroupSummaryConfig(aiConfig?.dailyGroupSummary);
  if (!cfg.enabled) return false;
  if (cfg.blockedGroups.includes(normalizedGroupId)) return false;
  if (cfg.targetMode === 'all') return true;
  return cfg.enabledGroups.includes(normalizedGroupId);
}

export function extractGroupSummaryMessageText(e = {}, config = {}) {
  const cfg = normalizeDailyGroupSummaryConfig(config);
  const segmentText = Array.isArray(e.message)
    ? e.message.map((item) => {
        if (item?.type === 'text') return String(item.text || '');
        if (item?.type === 'at') return `@${item.qq || ''}`;
        if (item?.type === 'image') return '[图片]';
        if (item?.type === 'record') return '[语音]';
        if (item?.type === 'video') return '[视频]';
        return '';
      }).join('').trim()
    : '';
  const fallbackText = String(e.msg || e.raw_message || '')
    .replace(/\[CQ:image[^\]]*\]/g, '[图片]')
    .replace(/\[CQ:record[^\]]*\]/g, '[语音]')
    .replace(/\[CQ:video[^\]]*\]/g, '[视频]')
    .replace(/\[CQ:at,qq=(\d+)[^\]]*\]/g, '@$1')
    .replace(/\[CQ:[^\]]+\]/g, '')
    .trim();
  const text = trimText(segmentText || fallbackText, cfg.maxMessageChars);
  if (!text) return '';
  if (!cfg.includeCommands && /^(#|＃|\/)/.test(text.trim())) return '';
  return text;
}

export function recordDailyGroupSummaryMessage(e = {}, config = {}) {
  const groupId = normalizeGroupId(e.group_id ?? e.groupId);
  const userId = String(e.user_id ?? e.userId ?? '').trim();
  const selfId = String(e.self_id ?? e.bot?.uin ?? e.bot_id ?? '').trim();
  if (!groupId || !userId || (selfId && userId === selfId)) return false;

  const text = extractGroupSummaryMessageText(e, config);
  if (!text) return false;

  ensureSummaryDir();
  const dateKey = getDailySummaryDateKey();
  const payload = {
    time: new Date().toISOString(),
    groupId,
    groupName: trimText(e.group_name || e.group?.info?.group_name || '', 80),
    userId,
    userName: trimText(e.sender?.card || e.sender?.nickname || e.nickname || '', 80),
    messageId: e.message_id ?? e.messageId ?? null,
    text,
  };
  fs.appendFileSync(getDailyMessageFile(dateKey), `${JSON.stringify(payload)}\n`, 'utf8');
  return true;
}

export function readDailyGroupSummaryMessages(dateKey = getDailySummaryDateKey(), groupId = '', config = {}) {
  const cfg = normalizeDailyGroupSummaryConfig(config);
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return [];
  return parseJsonlFile(getDailyMessageFile(dateKey))
    .filter(item => String(item.groupId || '') === normalizedGroupId)
    .slice(-cfg.maxMessages);
}

export function getDailyGroupSummaryTargetGroupIds(dateKey = getDailySummaryDateKey(), config = {}) {
  const cfg = normalizeDailyGroupSummaryConfig(config);
  const ids = new Set();
  for (const item of parseJsonlFile(getDailyMessageFile(dateKey))) {
    const groupId = normalizeGroupId(item.groupId);
    if (groupId) ids.add(groupId);
  }
  if (cfg.targetMode === 'selected') {
    for (const groupId of cfg.enabledGroups) ids.add(groupId);
  }
  return Array.from(ids);
}

export function getDailyGroupSummaryRun(dateKey = getDailySummaryDateKey(), groupId = '') {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return null;
  const state = readState();
  return state.runs?.[dateKey]?.[normalizedGroupId] || null;
}

export function readDailyGroupSummaryState() {
  return readState();
}

export function getDailyGroupSummaryMessageStats(dateKey = getDailySummaryDateKey(), config = {}) {
  const cfg = normalizeDailyGroupSummaryConfig(config);
  const stats = {};
  for (const item of parseJsonlFile(getDailyMessageFile(normalizeDateKey(dateKey)))) {
    const groupId = normalizeGroupId(item.groupId);
    if (!groupId) continue;
    const current = stats[groupId] || {
      groupId,
      groupName: '',
      count: 0,
      firstMessageAt: '',
      lastMessageAt: '',
      latestMessages: [],
    };
    const time = String(item.time || '').trim();
    current.count += 1;
    current.groupName = trimText(item.groupName || current.groupName || '', 80);
    if (!current.firstMessageAt || (time && Date.parse(time) < Date.parse(current.firstMessageAt))) {
      current.firstMessageAt = time;
    }
    if (!current.lastMessageAt || (time && Date.parse(time) > Date.parse(current.lastMessageAt))) {
      current.lastMessageAt = time;
    }
    current.latestMessages.push({
      time,
      userId: String(item.userId || '').trim(),
      userName: trimText(item.userName || '', 80),
      text: trimText(item.text || '', Math.min(cfg.maxMessageChars, 220)),
    });
    current.latestMessages = current.latestMessages.slice(-5);
    stats[groupId] = current;
  }
  return stats;
}

export function readDailyGroupSummaryResults(options = {}) {
  const dateKey = options.dateKey ? normalizeDateKey(options.dateKey) : '';
  const groupId = normalizeGroupId(options.groupId || '');
  const limit = readInteger(options.limit, 200, 1, 2000);
  return parseJsonlFile(DAILY_GROUP_SUMMARY_RESULT_FILE)
    .filter(item => !dateKey || String(item.dateKey || '') === dateKey)
    .filter(item => !groupId || normalizeGroupId(item.groupId) === groupId)
    .map(item => ({
      time: String(item.time || ''),
      dateKey: String(item.dateKey || ''),
      groupId: normalizeGroupId(item.groupId),
      groupName: trimText(item.groupName || '', 80),
      status: String(item.status || ''),
      messageCount: Number(item.messageCount || 0),
      summaryPreview: trimText(item.summaryPreview || '', 240),
      error: trimText(item.error || '', 240),
    }))
    .filter(item => item.groupId)
    .slice(-limit);
}

export function listDailyGroupSummaryLocks(options = {}) {
  const requestedDateKey = options.dateKey ? normalizeDateKey(options.dateKey) : '';
  const result = [];
  try {
    if (!fs.existsSync(DAILY_GROUP_SUMMARY_LOCK_DIR)) return result;
    const dateKeys = requestedDateKey
      ? [requestedDateKey]
      : fs.readdirSync(DAILY_GROUP_SUMMARY_LOCK_DIR).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name));
    for (const dateKey of dateKeys) {
      const dateDir = path.join(DAILY_GROUP_SUMMARY_LOCK_DIR, dateKey);
      if (!fs.existsSync(dateDir)) continue;
      for (const groupId of fs.readdirSync(dateDir)) {
        const normalizedGroupId = normalizeGroupId(groupId);
        if (!normalizedGroupId) continue;
        const lockDir = path.join(dateDir, groupId);
        const info = readLockInfo(lockDir);
        const stale = isLockStale(lockDir);
        result.push({
          dateKey,
          groupId: normalizedGroupId,
          stale,
          time: String(info.time || ''),
          pid: info.pid || null,
          lockId: String(info.lockId || ''),
        });
      }
    }
  } catch (error) {
    logger.warn(`[daily-group-summary] 读取总结锁失败: ${error.message}`);
  }
  return result;
}

/**
 * 判断某群在某天是否已「成功发送」过每日总结。
 * 与 getDailyGroupSummaryRun 区别：本函数只在 status === 'sent' 时返回 true，
 * 这样 skipped / failed 的记录不会阻断后续补发。
 */
export function hasDailyGroupSummarySent(dateKey = getDailySummaryDateKey(), groupId = '') {
  const run = getDailyGroupSummaryRun(dateKey, groupId);
  return Boolean(run && run.status === 'sent');
}

export function markDailyGroupSummaryRun(dateKey = getDailySummaryDateKey(), groupId = '', run = {}) {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return;
  const state = readState();
  state.runs[dateKey] = state.runs[dateKey] && typeof state.runs[dateKey] === 'object' ? state.runs[dateKey] : {};
  state.runs[dateKey][normalizedGroupId] = {
    time: new Date().toISOString(),
    status: String(run.status || 'sent'),
    messageCount: Number(run.messageCount || 0),
    error: trimText(run.error || '', 240),
  };
  writeState(state);
}

export function acquireDailyGroupSummaryRunLock(dateKey = getDailySummaryDateKey(), groupId = '', options = {}) {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return { acquired: false, reason: 'invalid_group' };

  const normalizedDateKey = normalizeDateKey(dateKey);
  const lockDir = path.join(DAILY_GROUP_SUMMARY_LOCK_DIR, normalizedDateKey, normalizedGroupId);
  const lockId = `${process.pid || 'unknown'}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const staleMs = readInteger(options.staleMs, DAILY_GROUP_SUMMARY_LOCK_STALE_MS, 60 * 1000, 24 * 60 * 60 * 1000);

  ensureSummaryDir();
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'lock.json'), JSON.stringify({
        lockId,
        time: new Date().toISOString(),
        pid: process.pid || null,
        dateKey: normalizedDateKey,
        groupId: normalizedGroupId,
      }, null, 2), 'utf8');
      return {
        acquired: true,
        lockDir,
        lockId,
        dateKey: normalizedDateKey,
        groupId: normalizedGroupId,
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      if (!isLockStale(lockDir, staleMs)) {
        return {
          acquired: false,
          reason: 'running',
          lockDir,
          dateKey: normalizedDateKey,
          groupId: normalizedGroupId,
          lock: readLockInfo(lockDir),
        };
      }
      removeLockDir(lockDir);
    }
  }

  return {
    acquired: false,
    reason: 'running',
    lockDir,
    dateKey: normalizedDateKey,
    groupId: normalizedGroupId,
    lock: readLockInfo(lockDir),
  };
}

export function releaseDailyGroupSummaryRunLock(lock = {}) {
  try {
    if (!lock?.acquired || !lock.lockDir || !lock.lockId) return;
    const info = readLockInfo(lock.lockDir);
    if (info.lockId && info.lockId !== lock.lockId) return;
    removeLockDir(lock.lockDir);
  } catch (error) {
    logger.warn(`[daily-group-summary] 释放总结锁失败: ${error.message}`);
  }
}

export function appendDailyGroupSummaryResult(entry = {}) {
  ensureSummaryDir();
  const payload = {
    time: new Date().toISOString(),
    dateKey: String(entry.dateKey || getDailySummaryDateKey()),
    groupId: normalizeGroupId(entry.groupId),
    groupName: trimText(entry.groupName || '', 80),
    status: String(entry.status || 'sent'),
    messageCount: Number(entry.messageCount || 0),
    summaryPreview: trimText(entry.summary || '', 240),
    error: trimText(entry.error || '', 240),
  };
  fs.appendFileSync(DAILY_GROUP_SUMMARY_RESULT_FILE, `${JSON.stringify(payload)}\n`, 'utf8');
}

export function cleanupDailyGroupSummaryFiles(retentionDays = 7) {
  try {
    ensureSummaryDir();
    const keepDays = readInteger(retentionDays, 7, 1, 60);
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(DAILY_GROUP_SUMMARY_DIR)) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match) continue;
      const time = new Date(`${match[1]}T00:00:00`).getTime();
      if (Number.isFinite(time) && time < cutoff) {
        fs.unlinkSync(path.join(DAILY_GROUP_SUMMARY_DIR, file));
      }
    }

    const state = readState();
    state.runs = Object.fromEntries(Object.entries(state.runs || {}).filter(([dateKey]) => {
      const time = new Date(`${dateKey}T00:00:00`).getTime();
      return !Number.isFinite(time) || time >= cutoff;
    }));
    writeState(state);

    if (fs.existsSync(DAILY_GROUP_SUMMARY_LOCK_DIR)) {
      for (const dateKey of fs.readdirSync(DAILY_GROUP_SUMMARY_LOCK_DIR)) {
        const lockDateDir = path.join(DAILY_GROUP_SUMMARY_LOCK_DIR, dateKey);
        const time = new Date(`${dateKey}T00:00:00`).getTime();
        if (Number.isFinite(time) && time < cutoff) {
          removeLockDir(lockDateDir);
        }
      }
    }
  } catch (error) {
    logger.warn(`[daily-group-summary] 清理旧记录失败: ${error.message}`);
  }
}
