import fs from 'fs';
import path from 'path';

export const GROUP_MANAGEMENT_LOG_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'group-management.log');

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

const groupManagementLogSubscribers = new Set();

function ensureLogDir(filePath = '') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function truncateText(value = '', maxLength = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeStringList(value = [], maxItems = 20) {
  return Array.isArray(value)
    ? value.map(item => truncateText(item, 160)).filter(Boolean).slice(0, maxItems)
    : [];
}

function normalizeSummary(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => {
        if (typeof item === 'string') return [key, truncateText(item, 160)];
        if (typeof item === 'number' || typeof item === 'boolean' || item === null) return [key, item];
        if (Array.isArray(item)) return [key, normalizeStringList(item, 12)];
        if (item && typeof item === 'object') return [key, normalizeSummary(item)];
        return [key, String(item)];
      }),
  );
}

export function subscribeGroupManagementLog(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  groupManagementLogSubscribers.add(listener);
  return () => groupManagementLogSubscribers.delete(listener);
}

function emitGroupManagementLog(payload = {}) {
  for (const listener of Array.from(groupManagementLogSubscribers)) {
    try {
      listener(payload);
    } catch (error) {
      logger.warn(`[group-management] 推送群管理日志事件失败: ${error.message}`);
    }
  }
}

export function appendGroupManagementLog(entry = {}) {
  try {
    ensureLogDir(GROUP_MANAGEMENT_LOG_FILE);
    const payload = {
      time: new Date().toISOString(),
      source: 'runtime',
      success: entry.success !== false,
      ...entry,
      group_id: String(entry.group_id ?? entry.groupId ?? '').trim(),
      user_id: String(entry.user_id ?? entry.userId ?? '').trim(),
      action: String(entry.action || entry.type || 'unknown').trim() || 'unknown',
      changes: normalizeStringList(entry.changes || [], 40),
      sections: normalizeStringList(entry.sections || [], 20),
      reason: truncateText(entry.reason || '', 240),
      error: truncateText(entry.error || '', 240),
      nickname: truncateText(entry.nickname || '', 80),
      comment_preview: truncateText(entry.comment_preview || entry.comment || '', 160),
      client_ip: truncateText(entry.client_ip || entry.clientIp || '', 80),
      user_agent: truncateText(entry.user_agent || entry.userAgent || '', 160),
      summary: normalizeSummary(entry.summary || {}),
    };
    fs.appendFileSync(GROUP_MANAGEMENT_LOG_FILE, `${JSON.stringify(payload)}\n`, 'utf8');
    emitGroupManagementLog(payload);
  } catch (error) {
    logger.warn(`[group-management] 写入群管理日志失败: ${error.message}`);
  }
}
