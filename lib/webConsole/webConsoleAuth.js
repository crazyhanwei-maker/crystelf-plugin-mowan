import { consumeWebConsoleLoginTicket } from './loginTicketStore.js';

export function createWebConsoleAuth(options = {}) {
  const crypto = options.crypto;
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({ authToken: '' }));
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode = 500, message = 'Internal Server Error', code = '') => {
        const error = new Error(String(message || 'Internal Server Error'));
        error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
        if (code) error.code = String(code);
        return error;
      });
  const parseRequestBody = typeof options.parseRequestBody === 'function'
    ? options.parseRequestBody
    : (async () => ({}));
  const sendJson = typeof options.sendJson === 'function'
    ? options.sendJson
    : (() => {});
  const notifyLoginSuccess = typeof options.notifyLoginSuccess === 'function'
    ? options.notifyLoginSuccess
    : null;
  const WEB_CONSOLE_SESSION_MAX_AGE_SECONDS = Math.max(1, Number(options.sessionMaxAgeSeconds || 12 * 60 * 60) || (12 * 60 * 60));
  const WEB_CONSOLE_LOGIN_WINDOW_MS = Math.max(1, Number(options.loginWindowMs || 10 * 60 * 1000) || (10 * 60 * 1000));
  const WEB_CONSOLE_LOGIN_MAX_FAILURES = Math.max(1, Number(options.loginMaxFailures || 5) || 5);
  const WEB_CONSOLE_LOGIN_BLOCK_MS = Math.max(1, Number(options.loginBlockMs || 15 * 60 * 1000) || (15 * 60 * 1000));
  const webConsoleLoginAttempts = new Map();

  const WEB_CONSOLE_AUTH_COOKIE = 'crystelf_web_console_auth';
  
  function isSecureRequest(req) {
    const remoteAddress = String(req?.socket?.remoteAddress || '').trim();
    const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (isLoopbackAddress(remoteAddress) && forwardedProto) {
      return forwardedProto === 'https';
    }
    return Boolean(req?.socket?.encrypted);
  }
  
  function getRequestOrigin(req) {
    const remoteAddress = String(req?.socket?.remoteAddress || '').trim();
    const forwardedHost = isLoopbackAddress(remoteAddress)
      ? String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim()
      : '';
    const host = forwardedHost || String(req?.headers?.host || '').trim();
    if (!host) {
      return '';
    }
    return `${isSecureRequest(req) ? 'https' : 'http'}://${host}`;
  }
  
  function getSocketRemoteAddress(req) {
    return String(req?.socket?.remoteAddress || '').trim();
  }
  
  function getRequestClientAddress(req) {
    const socketAddress = getSocketRemoteAddress(req);
    const forwardedFor = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (isLoopbackAddress(socketAddress) && forwardedFor) {
      return forwardedFor;
    }
    return socketAddress;
  }
  
  function hasForwardedClientHeaders(req) {
    const xForwardedFor = String(req?.headers?.['x-forwarded-for'] || '').trim();
    const xRealIp = String(req?.headers?.['x-real-ip'] || '').trim();
    const forwarded = String(req?.headers?.forwarded || '').trim();
    const cfConnectingIp = String(req?.headers?.['cf-connecting-ip'] || '').trim();
    return Boolean(xForwardedFor || xRealIp || forwarded || cfConnectingIp);
  }
  
  function isLoopbackAddress(value = '') {
    const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return normalized === '127.0.0.1'
      || normalized === '::1'
      || normalized === '::ffff:127.0.0.1'
      || normalized === 'localhost';
  }
  
  function isBootstrapSetupRequest(req) {
    const { authToken } = getWebConsoleConfig();
    if (authToken) {
      return false;
    }
    // Bootstrap must come from a direct local connection, not via any proxy headers.
    if (!isLoopbackAddress(getSocketRemoteAddress(req))) {
      return false;
    }
    return !hasForwardedClientHeaders(req);
  }
  
  function isBootstrapApiPath(pathname = '') {
    const normalized = String(pathname || '').trim();
    return normalized === '/api/auth/status'
      || normalized === '/api/overview'
      || normalized === '/api/config/editable'
      || normalized === '/api/plugin-settings'
      || normalized === '/api/plugin-settings/precheck'
      || normalized === '/api/plugin-settings/save';
  }
  
  function parseCookieHeader(headerValue = '') {
    const decodeCookieValue = (value = '') => {
      try {
        return decodeURIComponent(value);
      } catch {
        return String(value || '');
      }
    };
  
    return String(headerValue || '')
      .split(';')
      .map(item => item.trim())
      .filter(Boolean)
      .reduce((acc, item) => {
        const index = item.indexOf('=');
        if (index <= 0) {
          return acc;
        }
        const key = item.slice(0, index).trim();
        const value = item.slice(index + 1).trim();
        if (key) {
          acc[key] = decodeCookieValue(value);
        }
        return acc;
      }, {});
  }
  
  function getWebConsoleAuthCookieValue(req) {
    const cookies = parseCookieHeader(req?.headers?.cookie || '');
    return String(cookies[WEB_CONSOLE_AUTH_COOKIE] || '').trim();
  }
  
  function safeTimingEqual(left = '', right = '') {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }
  
  function toBase64Url(value) {
    return Buffer.from(String(value || ''), 'utf8').toString('base64url');
  }
  
  function fromBase64Url(value) {
    return Buffer.from(String(value || ''), 'base64url').toString('utf8');
  }
  
  function getWebConsoleSessionSecret(authToken = '') {
    return crypto
      .createHash('sha256')
      .update(`crystelf-web-console|${process.cwd()}|${String(authToken || '').trim()}`)
      .digest();
  }
  
  function signWebConsoleSessionPayload(payload, authToken = '') {
    return crypto
      .createHmac('sha256', getWebConsoleSessionSecret(authToken))
      .update(String(payload || ''))
      .digest('base64url');
  }
  
  function createWebConsoleSession(authToken = '') {
    const sessionPayload = {
      v: 1,
      exp: Date.now() + (WEB_CONSOLE_SESSION_MAX_AGE_SECONDS * 1000),
      nonce: crypto.randomBytes(18).toString('base64url'),
      csrf: crypto.randomBytes(18).toString('base64url'),
    };
    const encodedPayload = toBase64Url(JSON.stringify(sessionPayload));
    const signature = signWebConsoleSessionPayload(encodedPayload, authToken);
    return `${encodedPayload}.${signature}`;
  }
  
  function parseWebConsoleSession(req) {
    const { authToken } = getWebConsoleConfig();
    const rawCookie = getWebConsoleAuthCookieValue(req);
    if (!authToken || !rawCookie) {
      return { authorized: false, session: null };
    }
  
    const [encodedPayload, signature] = String(rawCookie || '').split('.');
    if (!encodedPayload || !signature) {
      return { authorized: false, session: null };
    }
  
    const expectedSignature = signWebConsoleSessionPayload(encodedPayload, authToken);
    if (!safeTimingEqual(signature, expectedSignature)) {
      return { authorized: false, session: null };
    }
  
    try {
      const session = JSON.parse(fromBase64Url(encodedPayload));
      if (!session || typeof session !== 'object') {
        return { authorized: false, session: null };
      }
      if (Number(session.exp || 0) <= Date.now()) {
        return { authorized: false, session: null };
      }
      if (typeof session.csrf !== 'string' || !session.csrf) {
        return { authorized: false, session: null };
      }
      return { authorized: true, session };
    } catch {
      return { authorized: false, session: null };
    }
  }
  
  function buildWebConsoleAuthCookie(req, sessionValue) {
    const parts = [
      `${WEB_CONSOLE_AUTH_COOKIE}=${encodeURIComponent(String(sessionValue || '').trim())}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${WEB_CONSOLE_SESSION_MAX_AGE_SECONDS}`,
    ];
    if (isSecureRequest(req)) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }
  
  function buildWebConsoleAuthCookieClearHeader(req) {
    const parts = [
      `${WEB_CONSOLE_AUTH_COOKIE}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age=0',
    ];
    if (isSecureRequest(req)) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }
  
  function extractOriginFromHeaderValue(value = '') {
    try {
      return new URL(String(value || '').trim()).origin;
    } catch {
      return '';
    }
  }
  
  function isSameOriginRequest(req) {
    const requestOrigin = getRequestOrigin(req);
    if (!requestOrigin) {
      return false;
    }
    const originHeader = extractOriginFromHeaderValue(req?.headers?.origin || '');
    if (originHeader) {
      return originHeader === requestOrigin;
    }
    const refererOrigin = extractOriginFromHeaderValue(req?.headers?.referer || '');
    if (refererOrigin) {
      return refererOrigin === requestOrigin;
    }
    return false;
  }
  
  function requireSameOrigin(req, res) {
    if (isSameOriginRequest(req)) {
      return true;
    }
    sendJson(res, { success: false, error: '跨站请求已被拒绝' }, 403);
    return false;
  }
  
  function requireCsrf(req, res) {
    const authState = parseWebConsoleSession(req);
    if (!authState.authorized || !authState.session?.csrf) {
      sendJson(res, { success: false, error: '未登录或登录已失效' }, 401);
      return false;
    }
    const csrfHeader = String(req?.headers?.['x-crystelf-csrf'] || '').trim();
    if (!csrfHeader || !safeTimingEqual(csrfHeader, String(authState.session.csrf))) {
      sendJson(res, { success: false, error: '请求校验失败，请刷新页面后重试' }, 403);
      return false;
    }
    return true;
  }
  
  function isAuthorized(req) {
    return parseWebConsoleSession(req).authorized === true;
  }
  
  function requireAuth(req, res) {
    if (isAuthorized(req)) return true;
    sendJson(res, { success: false, error: '未登录或登录已失效' }, 401);
    return false;
  }
  
  function normalizeWebConsoleRedirectPath(value = '/index.html') {
    const normalized = String(value || '').trim();
    if (!normalized.startsWith('/') || normalized.startsWith('//')) {
      return '/index.html';
    }
    return normalized;
  }

  function buildLoginAttemptStatus(req) {
    const now = Date.now();
    const clientIp = getClientIp(req);
    const attemptState = getLoginAttemptState(clientIp, now);
    const failures = Math.max(0, Number(attemptState.failures || 0));
    const blockedUntilMs = Math.max(0, Number(attemptState.blockedUntil || 0));
    const blocked = blockedUntilMs > now;
    return {
      clientIp,
      failures,
      maxFailures: WEB_CONSOLE_LOGIN_MAX_FAILURES,
      remainingFailures: Math.max(0, WEB_CONSOLE_LOGIN_MAX_FAILURES - failures),
      blocked,
      blockedUntil: blocked ? new Date(blockedUntilMs).toISOString() : '',
      retryAfterSeconds: blocked ? Math.max(1, Math.ceil((blockedUntilMs - now) / 1000)) : 0,
      windowStartedAt: attemptState.windowStartedAt ? new Date(Number(attemptState.windowStartedAt)).toISOString() : '',
      windowMs: WEB_CONSOLE_LOGIN_WINDOW_MS,
      blockMs: WEB_CONSOLE_LOGIN_BLOCK_MS,
    };
  }
  
  function buildAuthStatusPayload(req) {
    const config = getWebConsoleConfig();
    const authState = parseWebConsoleSession(req);
    const authorized = authState.authorized === true;
    const bootstrapMode = isBootstrapSetupRequest(req);
  
    return {
      success: true,
      loginConfigured: Boolean(config.authToken),
      authorized,
      bootstrapMode,
      mustChangeToken: bootstrapMode,
      readOnly: config.readOnly === true,
      canRead: authorized || bootstrapMode,
      canWrite: bootstrapMode || (authorized && config.readOnly !== true),
      csrfToken: authorized ? String(authState.session?.csrf || '') : '',
      loginAttempts: buildLoginAttemptStatus(req),
    };
  }
  
  function getClientIp(req) {
    return getRequestClientAddress(req) || 'unknown';
  }
  
  function pruneLoginAttempts(now = Date.now()) {
    for (const [key, value] of webConsoleLoginAttempts.entries()) {
      if (!value) {
        webConsoleLoginAttempts.delete(key);
        continue;
      }
      if (Number(value.blockedUntil || 0) > now) {
        continue;
      }
      if (Number(value.windowStartedAt || 0) + WEB_CONSOLE_LOGIN_WINDOW_MS < now) {
        webConsoleLoginAttempts.delete(key);
      }
    }
  }
  
  function getLoginAttemptState(ip, now = Date.now()) {
    pruneLoginAttempts(now);
    const existing = webConsoleLoginAttempts.get(ip);
    if (!existing) {
      return {
        failures: 0,
        windowStartedAt: now,
        blockedUntil: 0,
      };
    }
    if (Number(existing.windowStartedAt || 0) + WEB_CONSOLE_LOGIN_WINDOW_MS < now) {
      return {
        failures: 0,
        windowStartedAt: now,
        blockedUntil: 0,
      };
    }
    return existing;
  }
  
  function ensureLoginAttemptAllowed(req) {
    const now = Date.now();
    const ip = getClientIp(req);
    const state = getLoginAttemptState(ip, now);
    if (Number(state.blockedUntil || 0) > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
      const error = createHttpError(429, `登录尝试过于频繁，请 ${retryAfterSeconds} 秒后再试`, 'LOGIN_RATE_LIMITED');
      error.headers = { 'Retry-After': String(retryAfterSeconds) };
      throw error;
    }
    return { ip, state, now };
  }
  
  function recordLoginFailure(ip, state, now = Date.now()) {
    const next = {
      failures: Number(state?.failures || 0) + 1,
      windowStartedAt: Number(state?.windowStartedAt || now),
      blockedUntil: 0,
    };
    if (next.failures >= WEB_CONSOLE_LOGIN_MAX_FAILURES) {
      next.blockedUntil = now + WEB_CONSOLE_LOGIN_BLOCK_MS;
    }
    webConsoleLoginAttempts.set(ip, next);
    return next;
  }
  
  function clearLoginFailures(ip) {
    webConsoleLoginAttempts.delete(ip);
  }
  
  async function loginWebConsole(req) {
    const config = getWebConsoleConfig();
    const { ip, state, now } = ensureLoginAttemptAllowed(req);
    const body = await parseRequestBody(req);
    const providedToken = String(body?.token || '').trim();
  
    if (!config.authToken) {
      throw createHttpError(400, '控制台尚未配置登录口令', 'NO_AUTH_TOKEN');
    }
    if (!providedToken) {
      throw createHttpError(400, '请输入控制台登录口令', 'TOKEN_REQUIRED');
    }
    if (!safeTimingEqual(providedToken, config.authToken)) {
      recordLoginFailure(ip, state, now);
      throw createHttpError(401, '控制台登录口令错误', 'TOKEN_INVALID');
    }
  
    clearLoginFailures(ip);
    const sessionValue = createWebConsoleSession(config.authToken);

    if (notifyLoginSuccess) {
      try {
        await notifyLoginSuccess({ req, ip, method: 'token' });
      } catch (error) {
        // 通知失败不影响登录流程
      }
    }

    return {
      payload: buildAuthStatusPayload({
        ...req,
        headers: {
          ...(req.headers || {}),
          cookie: `${WEB_CONSOLE_AUTH_COOKIE}=${encodeURIComponent(sessionValue)}`,
        },
      }),
      headers: {
        'Set-Cookie': buildWebConsoleAuthCookie(req, sessionValue),
      },
    };
  }

  async function loginWebConsoleWithTicket(req, ticket = '') {
    const config = getWebConsoleConfig();
    if (!config.authToken) {
      throw createHttpError(400, '控制台尚未配置登录口令', 'NO_AUTH_TOKEN');
    }

    const consumed = consumeWebConsoleLoginTicket(ticket);
    if (!consumed.ok) {
      throw createHttpError(
        consumed.code === 'LOGIN_TICKET_REQUIRED' ? 400 : 401,
        consumed.error || '一次性登录链接无效',
        consumed.code || 'LOGIN_TICKET_INVALID',
      );
    }

    const sessionValue = createWebConsoleSession(config.authToken);

    if (notifyLoginSuccess) {
      try {
        await notifyLoginSuccess({ req, ip: getRequestClientAddress(req), method: 'ticket' });
      } catch (error) {
        // 通知失败不影响登录流程
      }
    }

    return {
      payload: {
        ...buildAuthStatusPayload({
          ...req,
          headers: {
            ...(req.headers || {}),
            cookie: `${WEB_CONSOLE_AUTH_COOKIE}=${encodeURIComponent(sessionValue)}`,
          },
        }),
        loginTicket: {
          consumed: true,
          createdAt: consumed.createdAt || '',
          expiresAt: consumed.expiresAt || '',
        },
      },
      headers: {
        'Set-Cookie': buildWebConsoleAuthCookie(req, sessionValue),
      },
    };
  }

  return {
    isSecureRequest,
    getRequestOrigin,
    getSocketRemoteAddress,
    getRequestClientAddress,
    hasForwardedClientHeaders,
    isLoopbackAddress,
    isBootstrapSetupRequest,
    isBootstrapApiPath,
    parseWebConsoleSession,
    buildWebConsoleAuthCookie,
    buildWebConsoleAuthCookieClearHeader,
    requireSameOrigin,
    requireCsrf,
    isAuthorized,
    requireAuth,
    normalizeWebConsoleRedirectPath,
    buildLoginAttemptStatus,
    buildAuthStatusPayload,
    getClientIp,
    loginWebConsole,
    loginWebConsoleWithTicket,
  };
}
