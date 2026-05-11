import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { appendGroupManagementLog } from './groupManagementLog.js';

const JOIN_REQUEST_STORE_FILE = path.join(process.cwd(), 'data', 'crystelf', 'group-management', 'join-requests.json');
const JOIN_REQUEST_STORE_LIMIT = 1000;

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureDir(filePath = '') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeReadJoinRequests() {
  try {
    if (!fs.existsSync(JOIN_REQUEST_STORE_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(JOIN_REQUEST_STORE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    logger.warn(`[group-management] 读取加群申请列表失败: ${error.message}`);
    return [];
  }
}

function safeWriteJoinRequests(items = []) {
  ensureDir(JOIN_REQUEST_STORE_FILE);
  fs.writeFileSync(
    JOIN_REQUEST_STORE_FILE,
    JSON.stringify(items.slice(0, JOIN_REQUEST_STORE_LIMIT), null, 2),
    'utf8',
  );
}

function truncateText(value = '', maxLength = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeJoinRequestStatus(status = '') {
  const value = String(status || '').trim();
  return ['pending', 'approved', 'rejected', 'expired'].includes(value) ? value : 'pending';
}

function normalizeJoinRequestRisk(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const score = Number(value.score);
  const normalizedScore = Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : 0;
  const level = ['low', 'medium', 'high'].includes(String(value.level || '')) ? String(value.level) : normalizedScore >= 70 ? 'high' : normalizedScore >= 40 ? 'medium' : 'low';
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.map(item => truncateText(item, 160)).filter(Boolean).slice(0, 12)
    : [];
  return {
    enabled: value.enabled !== false,
    score: normalizedScore,
    level,
    reasons,
    blacklisted: value.blacklisted === true,
    whitelisted: value.whitelisted === true,
    warningCount: Number.isFinite(Number(value.warningCount)) ? Math.max(0, Math.round(Number(value.warningCount))) : 0,
    highRiskScore: Number.isFinite(Number(value.highRiskScore)) ? Math.max(1, Math.round(Number(value.highRiskScore))) : 70,
    warningBlockThreshold: Number.isFinite(Number(value.warningBlockThreshold)) ? Math.max(0, Math.round(Number(value.warningBlockThreshold))) : 3,
  };
}

function extractJoinRequestFlag(e = {}) {
  return String(e.flag ?? e.request_flag ?? e.raw?.flag ?? e.requestFlag ?? '').trim();
}

function extractJoinRequestSubType(e = {}) {
  return String(e.sub_type ?? e.subType ?? e.raw?.sub_type ?? 'add').trim() || 'add';
}

function makeJoinRequestId(record = {}) {
  const basis = [
    record.groupId,
    record.userId,
    record.flag,
    record.subType,
    record.comment,
    record.flag ? '' : record.createdAt,
  ].map(item => String(item || '')).join('|');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 24);
}

function getRuntimeBots() {
  const root = typeof globalThis !== 'undefined' ? globalThis.Bot : null;
  const result = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);
    if (typeof candidate.sendApi === 'function' || typeof candidate.setGroupAddRequest === 'function') {
      result.push(candidate);
    }
  };
  add(root);
  for (const field of ['bots', 'clients', 'uin']) {
    const value = root?.[field];
    if (value instanceof Map) {
      for (const item of value.values()) add(item);
    } else if (Array.isArray(value) || value instanceof Set) {
      for (const item of value) add(item);
    } else if (isPlainObject(value)) {
      for (const item of Object.values(value)) add(item);
    }
  }
  return result;
}

function pickBotForJoinRequest(record = {}) {
  const bots = getRuntimeBots();
  const selfId = String(record.selfId || '').trim();
  if (selfId) {
    const matched = bots.find(bot => String(bot.uin ?? bot.self_id ?? bot.user_id ?? '') === selfId);
    if (matched) return matched;
  }
  return bots[0] || null;
}

function serializeJoinRequestRecord(record = {}) {
  return {
    ...record,
    status: normalizeJoinRequestStatus(record.status),
    groupId: String(record.groupId || record.group_id || '').trim(),
    userId: String(record.userId || record.user_id || '').trim(),
    group_id: String(record.groupId || record.group_id || '').trim(),
    user_id: String(record.userId || record.user_id || '').trim(),
    flag: String(record.flag || '').trim(),
    subType: String(record.subType || record.sub_type || 'add').trim() || 'add',
    nickname: truncateText(record.nickname || '', 80),
    comment: truncateText(record.comment || '', 240),
    reason: truncateText(record.reason || '', 240),
    error: truncateText(record.error || '', 240),
    risk: normalizeJoinRequestRisk(record.risk),
  };
}

export function upsertJoinRequestRecord(e = {}, profile = {}, extra = {}) {
  const now = new Date().toISOString();
  const groupId = String(profile.groupId || e.group_id || e.groupId || e.gid || '').trim();
  const userId = String(profile.userId || e.user_id || e.userId || e.uid || '').trim();
  if (!groupId || !userId) return null;

  const nextRecord = serializeJoinRequestRecord({
    groupId,
    userId,
    flag: extractJoinRequestFlag(e),
    subType: extractJoinRequestSubType(e),
    selfId: String(e.self_id ?? e.bot?.uin ?? e.bot_id ?? '').trim(),
    nickname: profile.nickname || e.nickname || e.sender?.nickname || e.user?.nickname || '',
    comment: profile.comment ?? e.comment ?? e.reason ?? e.message ?? e.raw_message ?? '',
    age: profile.age,
    qqLevel: profile.qqLevel,
    sex: profile.sex,
    status: extra.status || 'pending',
    reason: extra.reason || '',
    error: extra.error || '',
    risk: extra.risk || null,
    createdAt: now,
    updatedAt: now,
    source: extra.source || 'request.group.add',
  });
  nextRecord.id = makeJoinRequestId(nextRecord);

  const items = safeReadJoinRequests();
  const existingIndex = items.findIndex(item => {
    if (nextRecord.flag && String(item.flag || '') === nextRecord.flag) return true;
    return String(item.groupId || item.group_id || '') === groupId
      && String(item.userId || item.user_id || '') === userId
      && normalizeJoinRequestStatus(item.status) === 'pending';
  });

  if (existingIndex >= 0) {
    const current = serializeJoinRequestRecord(items[existingIndex]);
    items[existingIndex] = {
      ...current,
      ...nextRecord,
      id: current.id || nextRecord.id,
      createdAt: current.createdAt || nextRecord.createdAt,
      updatedAt: now,
    };
  } else {
    items.unshift(nextRecord);
  }
  safeWriteJoinRequests(items);
  return existingIndex >= 0 ? serializeJoinRequestRecord(items[existingIndex]) : nextRecord;
}

export function updateJoinRequestRecord(id = '', patch = {}) {
  const targetId = String(id || '').trim();
  if (!targetId) return null;
  const items = safeReadJoinRequests();
  const index = items.findIndex(item => String(item.id || '') === targetId);
  if (index < 0) return null;
  items[index] = serializeJoinRequestRecord({
    ...items[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  safeWriteJoinRequests(items);
  return items[index];
}

export function listJoinRequestRecords(filters = {}) {
  const groupId = String(filters.groupId || '').trim();
  const userId = String(filters.userId || '').trim();
  const status = Object.prototype.hasOwnProperty.call(filters, 'status')
    ? String(filters.status || '').trim()
    : 'pending';
  const query = String(filters.query || '').trim().toLowerCase();
  return safeReadJoinRequests()
    .map(serializeJoinRequestRecord)
    .filter(item => !groupId || item.groupId === groupId)
    .filter(item => !userId || item.userId === userId)
    .filter(item => !status || item.status === status)
    .filter(item => {
      if (!query) return true;
      return [
        item.groupId,
        item.userId,
        item.nickname,
        item.comment,
        item.reason,
        item.error,
        item.status,
        item.risk?.level,
        ...(Array.isArray(item.risk?.reasons) ? item.risk.reasons : []),
      ]
        .some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

export async function approveStoredJoinRequest(id = '', options = {}) {
  const targetId = String(id || '').trim();
  const record = listJoinRequestRecords({ status: '' }).find(item => item.id === targetId);
  if (!record) {
    throw new Error('加群申请记录不存在');
  }
  if (record.status !== 'pending') {
    throw new Error('该加群申请已处理，不能重复同意');
  }
  if (!record.flag) {
    throw new Error('该加群申请缺少 flag，当前适配器无法从控制台手动同意');
  }

  const bot = pickBotForJoinRequest(record);
  if (!bot) {
    throw new Error('当前没有可用 Bot 实例处理加群申请');
  }
  const reason = truncateText(options.reason || '管理员已同意', 80);

  try {
    if (typeof bot.sendApi === 'function') {
      await bot.sendApi('set_group_add_request', {
        flag: record.flag,
        sub_type: record.subType || 'add',
        approve: true,
        reason,
      });
    } else if (typeof bot.setGroupAddRequest === 'function') {
      await bot.setGroupAddRequest(record.flag, record.subType || 'add', true, reason);
    } else {
      throw new Error('当前适配器不支持手动处理加群申请');
    }
  } catch (error) {
    updateJoinRequestRecord(targetId, {
      status: 'pending',
      error: error.message,
    });
    appendGroupManagementLog({
      action: 'join_request_manual_approve_failed',
      source: 'webConsole',
      success: false,
      group_id: record.groupId,
      user_id: record.userId,
      nickname: record.nickname,
      reason,
      error: error.message,
      comment_preview: record.comment,
      client_ip: options.client_ip || '',
      user_agent: options.user_agent || '',
    });
    throw error;
  }

  const updated = updateJoinRequestRecord(targetId, {
    status: 'approved',
    handledBy: options.operator || 'webConsole',
    handledAt: new Date().toISOString(),
    reason,
    error: '',
  });
  appendGroupManagementLog({
    action: 'join_request_manual_approved',
    source: 'webConsole',
    success: true,
    group_id: record.groupId,
    user_id: record.userId,
    nickname: record.nickname,
    reason,
    comment_preview: record.comment,
    client_ip: options.client_ip || '',
    user_agent: options.user_agent || '',
  });
  return updated;
}

export async function rejectStoredJoinRequest(id = '', options = {}) {
  const targetId = String(id || '').trim();
  const record = listJoinRequestRecords({ status: '' }).find(item => item.id === targetId);
  if (!record) {
    throw new Error('加群申请记录不存在');
  }
  if (record.status !== 'pending') {
    throw new Error('该加群申请已处理，不能重复拒绝');
  }
  if (!record.flag) {
    throw new Error('该加群申请缺少 flag，当前适配器无法从控制台手动拒绝');
  }

  const bot = pickBotForJoinRequest(record);
  if (!bot) {
    throw new Error('当前没有可用 Bot 实例处理加群申请');
  }
  const reason = truncateText(options.reason || '管理员已拒绝', 80);

  try {
    if (typeof bot.sendApi === 'function') {
      await bot.sendApi('set_group_add_request', {
        flag: record.flag,
        sub_type: record.subType || 'add',
        approve: false,
        reason,
      });
    } else if (typeof bot.setGroupAddRequest === 'function') {
      await bot.setGroupAddRequest(record.flag, record.subType || 'add', false, reason);
    } else {
      throw new Error('当前适配器不支持手动处理加群申请');
    }
  } catch (error) {
    updateJoinRequestRecord(targetId, {
      status: 'pending',
      error: error.message,
    });
    appendGroupManagementLog({
      action: 'join_request_manual_reject_failed',
      source: 'webConsole',
      success: false,
      group_id: record.groupId,
      user_id: record.userId,
      nickname: record.nickname,
      reason,
      error: error.message,
      comment_preview: record.comment,
      client_ip: options.client_ip || '',
      user_agent: options.user_agent || '',
    });
    throw error;
  }

  const updated = updateJoinRequestRecord(targetId, {
    status: 'rejected',
    handledBy: options.operator || 'webConsole',
    handledAt: new Date().toISOString(),
    reason,
    error: '',
  });
  appendGroupManagementLog({
    action: 'join_request_manual_rejected',
    source: 'webConsole',
    success: true,
    group_id: record.groupId,
    user_id: record.userId,
    nickname: record.nickname,
    reason,
    comment_preview: record.comment,
    client_ip: options.client_ip || '',
    user_agent: options.user_agent || '',
  });
  return updated;
}
