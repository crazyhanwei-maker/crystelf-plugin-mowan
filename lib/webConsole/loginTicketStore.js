import crypto from 'crypto';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const TICKET_BYTES = 32;
const tickets = new Map();

function hashTicket(ticket = '') {
  return crypto
    .createHash('sha256')
    .update(String(ticket || '').trim())
    .digest('hex');
}

function pruneExpiredTickets(now = Date.now()) {
  for (const [hash, record] of tickets.entries()) {
    if (!record || Number(record.expiresAt || 0) <= now) {
      tickets.delete(hash);
    }
  }
}

function normalizeTicketMeta(meta = {}) {
  return {
    operator: String(meta.operator || '').slice(0, 80),
    source: String(meta.source || '').slice(0, 80),
    groupId: String(meta.groupId || '').slice(0, 40),
    userId: String(meta.userId || '').slice(0, 40),
  };
}

export function createWebConsoleLoginTicket(meta = {}, options = {}) {
  const now = Date.now();
  const ttlMs = Math.max(30 * 1000, Number(options.ttlMs || DEFAULT_TTL_MS) || DEFAULT_TTL_MS);
  pruneExpiredTickets(now);

  const ticket = crypto.randomBytes(TICKET_BYTES).toString('base64url');
  tickets.set(hashTicket(ticket), {
    createdAt: now,
    expiresAt: now + ttlMs,
    meta: normalizeTicketMeta(meta),
  });

  return {
    ticket,
    expiresAt: new Date(now + ttlMs).toISOString(),
    expiresInSeconds: Math.ceil(ttlMs / 1000),
  };
}

export function consumeWebConsoleLoginTicket(ticket = '') {
  const value = String(ticket || '').trim();
  if (!value) {
    return { ok: false, code: 'LOGIN_TICKET_REQUIRED', error: '缺少一次性登录票据' };
  }

  const now = Date.now();
  pruneExpiredTickets(now);
  const hash = hashTicket(value);
  const record = tickets.get(hash);
  if (!record) {
    return { ok: false, code: 'LOGIN_TICKET_INVALID', error: '一次性登录链接无效或已使用' };
  }

  tickets.delete(hash);
  if (Number(record.expiresAt || 0) <= now) {
    return { ok: false, code: 'LOGIN_TICKET_EXPIRED', error: '一次性登录链接已过期' };
  }

  return {
    ok: true,
    createdAt: new Date(Number(record.createdAt || now)).toISOString(),
    expiresAt: new Date(Number(record.expiresAt || now)).toISOString(),
    meta: record.meta || {},
  };
}

export function getWebConsoleLoginTicketStats() {
  pruneExpiredTickets();
  return {
    pendingCount: tickets.size,
  };
}
