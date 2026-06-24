import fs from 'fs';
import path from 'path';

export const DAILY_GROUP_SUMMARY_DIR = path.join(process.cwd(), 'data', 'crystelf', 'group-summary');
const DAILY_GROUP_SUMMARY_STATE_FILE = path.join(DAILY_GROUP_SUMMARY_DIR, 'state.json');
const DAILY_GROUP_SUMMARY_RESULT_FILE = path.join(DAILY_GROUP_SUMMARY_DIR, 'summaries.jsonl');

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

function ensureSummaryDir() {
  if (!fs.existsSync(DAILY_GROUP_SUMMARY_DIR)) {
    fs.mkdirSync(DAILY_GROUP_SUMMARY_DIR, { recursive: true });
  }
}

function normalizeGroupId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
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
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isDailySummaryScheduleDue(date = new Date(), config = {}) {
  const cfg = normalizeDailyGroupSummaryConfig(config);
  // 过了计划时刻即视为到期（>= 语义），保证 Bot 在计划时刻没运行、重启窗口错过
  // 或高负载延迟时仍能在随后补发。重复发送由 runGroupSummary 的双重去重
  // （内存 sentGroups + 持久化 hasDailyGroupSummarySent）保证不会发生。
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
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
  } catch (error) {
    logger.warn(`[daily-group-summary] 清理旧记录失败: ${error.message}`);
  }
}
