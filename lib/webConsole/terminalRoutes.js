// Root 终端：网页端执行 shell 命令，需额外输入登录口令解锁会话。
// 安全会话内存放行（60 分钟），命令历史留审计日志；只读模式下禁止使用。
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { createRouteUtils } from './routeUtils.js';

const TERMINAL_SESSION_TTL_MS = 60 * 60 * 1000;
const TERMINAL_OUTPUT_MAX_CHARS = 60000;
const TERMINAL_TIMEOUT_MS = 60 * 1000;
const TERMINAL_HISTORY_MAX = 200;
const TERMINAL_AUDIT_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'terminal-audit.log');

// Windows 下用 cmd /c，类 Unix 用 sh -c（root 环境即目标服务器自身）
const isWindows = process.platform === 'win32';
const shellName = isWindows ? 'cmd.exe' : 'sh';

const terminalSessions = new Map(); // sessionToken -> { expiresAt, ip }
const terminalHistory = [];

export function createTerminalRoutes(options = {}) {
  const {
    ConfigControl,
    parseRequestBody,
    sendJson,
    getHttpErrorStatus,
    logger,
  } = options;
  const { rejectReadOnly } = createRouteUtils(options);

  function getExpectedToken() {
    return String(ConfigControl?.get('config')?.webConsoleToken || '').trim();
  }

  function pruneSessions(now = Date.now()) {
    for (const [token, session] of terminalSessions) {
      if (session.expiresAt <= now) terminalSessions.delete(token);
    }
  }

  function writeAudit(entry) {
    try {
      const line = `${JSON.stringify({ time: new Date().toISOString(), ...entry }, null, 2)}\n`;
      fs.mkdir(path.dirname(TERMINAL_AUDIT_FILE), { recursive: true })
        .then(() => fs.appendFile(TERMINAL_AUDIT_FILE, line, 'utf8'))
        .catch(() => {});
    } catch {
      // 审计失败不影响主流程
    }
  }

  async function handle(req, res, url) {
    if (url.pathname === '/api/terminal/status') {
      pruneSessions();
      const token = String(req?.headers?.['x-terminal-session'] || '');
      const session = terminalSessions.get(token);
      sendJson(res, {
        success: true,
        unlocked: Boolean(session && session.expiresAt > Date.now()),
        expiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : '',
        platform: process.platform,
        cwd: process.cwd(),
      });
      return true;
    }

    if (url.pathname === '/api/terminal/unlock' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        const password = String(body?.password || '');
        const expected = getExpectedToken();
        const leftBuffer = Buffer.from(password);
        const rightBuffer = Buffer.from(expected);
        const matched = expected && leftBuffer.length === rightBuffer.length
          && crypto.timingSafeEqual(leftBuffer, rightBuffer);
        if (!matched) {
          writeAudit({ action: 'unlock', ok: false, ip: req.socket?.remoteAddress || '' });
          sendJson(res, { success: false, error: '口令不正确，无法解锁终端。' }, 403);
          return true;
        }
        pruneSessions();
        const token = crypto.randomBytes(24).toString('base64url');
        terminalSessions.set(token, {
          expiresAt: Date.now() + TERMINAL_SESSION_TTL_MS,
          ip: req.socket?.remoteAddress || '',
        });
        writeAudit({ action: 'unlock', ok: true, ip: req.socket?.remoteAddress || '' });
        sendJson(res, {
          success: true,
          data: {
            token,
            expiresAt: new Date(Date.now() + TERMINAL_SESSION_TTL_MS).toISOString(),
          },
        });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }

    if (url.pathname === '/api/terminal/lock' && req.method === 'POST') {
      const token = String(req?.headers?.['x-terminal-session'] || '');
      terminalSessions.delete(token);
      sendJson(res, { success: true });
      return true;
    }

    if (url.pathname === '/api/terminal/exec' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        pruneSessions();
        const token = String(req?.headers?.['x-terminal-session'] || '');
        const session = terminalSessions.get(token);
        if (!session || session.expiresAt <= Date.now()) {
          sendJson(res, { success: false, error: '终端未解锁或会话已过期', code: 'TERMINAL_LOCKED' }, 403);
          return true;
        }
        // 刷新会话有效期（活跃使用自动续期）
        session.expiresAt = Date.now() + TERMINAL_SESSION_TTL_MS;

        const body = await parseRequestBody(req);
        const command = String(body?.command || '').trim();
        if (!command) {
          sendJson(res, { success: false, error: '命令不能为空。' }, 400);
          return true;
        }

        const startedAt = Date.now();
        const result = await new Promise((resolve) => {
          const child = spawn(shellName, isWindows ? ['/c', command] : ['-c', command], {
            cwd: process.cwd(),
            env: process.env,
            timeout: TERMINAL_TIMEOUT_MS,
            windowsHide: true,
          });
          let stdout = '';
          let stderr = '';
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };
          child.stdout.on('data', chunk => {
            if (stdout.length < TERMINAL_OUTPUT_MAX_CHARS) stdout += chunk.toString('utf8');
          });
          child.stderr.on('data', chunk => {
            if (stderr.length < TERMINAL_OUTPUT_MAX_CHARS) stderr += chunk.toString('utf8');
          });
          child.on('error', error => finish({ code: -1, stdout, stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`, timedOut: false }));
          child.on('close', (code, signal) => finish({
            code: Number.isFinite(code) ? code : -1,
            stdout: stdout.slice(0, TERMINAL_OUTPUT_MAX_CHARS),
            stderr: stderr.slice(0, TERMINAL_OUTPUT_MAX_CHARS),
            timedOut: signal === 'SIGTERM',
          }));
        });

        const elapsedMs = Date.now() - startedAt;
        terminalHistory.push({ time: new Date().toISOString(), command, code: result.code, elapsedMs });
        if (terminalHistory.length > TERMINAL_HISTORY_MAX) terminalHistory.splice(0, terminalHistory.length - TERMINAL_HISTORY_MAX);
        writeAudit({ action: 'exec', command: command.slice(0, 500), code: result.code, elapsedMs, ip: session.ip });

        sendJson(res, {
          success: true,
          data: {
            command,
            code: result.code,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.timedOut === true,
            elapsedMs,
          },
        });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }

    if (url.pathname === '/api/terminal/history') {
      pruneSessions();
      const token = String(req?.headers?.['x-terminal-session'] || '');
      if (!terminalSessions.has(token)) {
        sendJson(res, { success: false, error: '终端未解锁', code: 'TERMINAL_LOCKED' }, 403);
        return true;
      }
      sendJson(res, { success: true, items: terminalHistory.slice(-50).reverse() });
      return true;
    }

    return false;
  }

  if (logger) {
    logger.info?.('[webConsole] Root 终端路由已装载（口令解锁，60 分钟会话）');
  }
  return { handle };
}
