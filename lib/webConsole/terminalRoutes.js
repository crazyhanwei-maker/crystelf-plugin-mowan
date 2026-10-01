// Root 终端：网页端执行 shell 命令，需额外输入登录口令解锁会话。
// 解锁时启动一个持久 shell 子进程，后续命令共享同一会话（cd / 环境变量延续）。
// 命令通过 sentinel 标记判定结束并回收退出码；只读模式下禁止使用；全程审计。
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import iconv from 'iconv-lite';
import { createRouteUtils } from './routeUtils.js';

const TERMINAL_SESSION_TTL_MS = 60 * 60 * 1000;
const TERMINAL_OUTPUT_MAX_CHARS = 60000;
const TERMINAL_COMMAND_TIMEOUT_MS = 120 * 1000;
const TERMINAL_HISTORY_MAX = 200;
const TERMINAL_AUDIT_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'terminal-audit.log');
const TERMINAL_BUFFER_MAX = 400000;

const isWindows = process.platform === 'win32';

const terminalSessions = new Map(); // token -> session
const terminalHistory = [];
let terminalSeq = 0;

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
      if (session.expiresAt <= now) {
        destroySession(token);
      }
    }
  }

  function destroySession(token) {
    const session = terminalSessions.get(token);
    if (!session) return;
    try { session.child?.kill(); } catch {}
    terminalSessions.delete(token);
    // 等中的命令立即以失效结束
    if (session.pending?.resolve) {
      clearTimeout(session.pending.timer);
      session.pending.resolve({ code: -1, output: session.pending.collected, timedOut: false, dead: true });
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

  // Windows cmd 默认 GBK：输出按 GBK 解码，命令写入前按 GBK 编码。
  // （实测 chcp 65001 会让管道模式下的 cmd 把多字节输入当坏字节挂起，不能用。）
  // iconv-lite 的流式解码器能把跨 chunk 拆分的多字节序列拼回来。
  function decodeChunk(session, chunk) {
    if (!isWindows) return chunk.toString('utf8');
    return session.gbkDecoder.write(chunk);
  }

  // 启动持久 shell 并等待首条 sentinel 同步（吞掉启动横幅/提示符）
  function startShell(session) {
    return new Promise((resolve, reject) => {
      const child = spawn(isWindows ? 'cmd.exe' : 'sh', isWindows ? ['/Q', '/K'] : [], {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
      });
      session.child = child;
      session.buffer = '';
      session.seq = 0;
      session.pending = null;
      session.gbkDecoder = iconv.getDecoder('gbk');

      const onChunk = chunk => {
        session.buffer += decodeChunk(session, chunk);
        if (session.buffer.length > TERMINAL_BUFFER_MAX) {
          session.buffer = session.buffer.slice(-TERMINAL_BUFFER_MAX / 2);
        }
        flushPending(session);
      };
      child.stdout.on('data', onChunk);
      child.stderr.on('data', onChunk);
      child.on('close', () => {
        if (session.pending?.resolve) {
          clearTimeout(session.pending.timer);
          const pending = session.pending;
          session.pending = null;
          pending.resolve({ code: -1, output: pending.collected, timedOut: false, dead: true });
        }
      });

      const readySentinel = `__TS_READY_${Date.now().toString(36)}__`;
      session.pending = {
        sentinel: readySentinel,
        resolve: value => {
          session.pending = null;
          if (value.dead) reject(new Error('终端进程启动失败'));
          else resolve();
        },
        collected: '',
        timer: setTimeout(() => {
          session.pending = null;
          reject(new Error('终端进程启动超时'));
        }, 15000),
      };
      writeToShell(session, `${isWindows ? `echo ${readySentinel} %errorlevel%` : `echo ${readySentinel} $?`}`);
    });
  }

  // Windows cmd 期望 GBK 编码的 stdin；其他平台直接写 UTF-8
  function writeToShell(session, text) {
    session.child.stdin.write(isWindows ? iconv.encode(`${text}\r\n`, 'gbk') : `${text}\n`);
  }

  // 从缓冲中查找当前 sentinel；命中则把之前的内容作为输出交付
  function flushPending(session) {
    const pending = session.pending;
    if (!pending) return;
    const marker = `${pending.sentinel} `;
    const idx = session.buffer.indexOf(marker);
    if (idx === -1) return;
    const lineEnd = session.buffer.indexOf('\n', idx);
    if (lineEnd === -1) return;
    // 去掉 cmd 回显的提示符（形如 X:\path>），再压掉首尾空行
    const output = session.buffer.slice(0, idx)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.replace(/^[A-Za-z]:\\[^>]*>/, ''))
      .join('\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
    const tail = session.buffer.slice(idx, lineEnd);
    session.buffer = session.buffer.slice(lineEnd + 1);
    clearTimeout(pending.timer);
    session.pending = null;
    const codeMatch = /(-?\d+)\s*$/.exec(tail.trim());
    pending.resolve({
      code: codeMatch ? Number(codeMatch[1]) : -1,
      output: output.slice(0, TERMINAL_OUTPUT_MAX_CHARS),
      timedOut: false,
      dead: false,
    });
  }

  function runInShell(session, command) {
    return new Promise((resolve) => {
      if (!session.child || session.child.exitCode !== null) {
        resolve({ code: -1, output: '', timedOut: false, dead: true });
        return;
      }
      if (session.pending) {
        resolve({ code: -1, output: '', timedOut: false, busy: true });
        return;
      }
      session.seq += 1;
      const sentinel = `__TS_${session.seq}_${crypto.randomBytes(4).toString('hex')}__`;
      const pending = {
        sentinel,
        collected: '',
        resolve,
        timer: setTimeout(() => {
          // 超时：杀掉 shell 强制中断（挂起的命令无法安全恢复），会话作废需重新解锁
          session.pending = null;
          try { session.child?.kill(); } catch {}
          resolve({ code: -1, output: pending.collected, timedOut: true, dead: true });
        }, TERMINAL_COMMAND_TIMEOUT_MS),
      };
      session.pending = pending;
      writeToShell(session, command);
      writeToShell(session, isWindows ? `echo ${sentinel} %errorlevel%` : `echo ${sentinel} $?`);
    });
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
        // 复用未过期的现有会话（避免重复解锁堆积 shell）
        let token = String(req?.headers?.['x-terminal-session'] || '');
        if (!token || !terminalSessions.has(token)) {
          token = crypto.randomBytes(24).toString('base64url');
        }
        let session = terminalSessions.get(token);
        if (!session) {
          session = { ip: req.socket?.remoteAddress || '' };
          terminalSessions.set(token, session);
          try {
            await startShell(session);
          } catch (error) {
            terminalSessions.delete(token);
            sendJson(res, { success: false, error: error.message }, 500);
            return true;
          }
        }
        session.expiresAt = Date.now() + TERMINAL_SESSION_TTL_MS;
        writeAudit({ action: 'unlock', ok: true, ip: session.ip });
        sendJson(res, {
          success: true,
          data: {
            token,
            expiresAt: new Date(session.expiresAt).toISOString(),
          },
        });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }

    if (url.pathname === '/api/terminal/lock' && req.method === 'POST') {
      const token = String(req?.headers?.['x-terminal-session'] || '');
      destroySession(token);
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
        session.expiresAt = Date.now() + TERMINAL_SESSION_TTL_MS;

        const body = await parseRequestBody(req);
        const command = String(body?.command || '').trim();
        if (!command) {
          sendJson(res, { success: false, error: '命令不能为空。' }, 400);
          return true;
        }

        const startedAt = Date.now();
        const result = await runInShell(session, command);

        if (result.dead) {
          terminalSessions.delete(token);
          sendJson(res, {
            success: false,
            error: result.timedOut ? '命令超时（120 秒），终端进程已被强制终止，请重新解锁。' : '终端进程已退出，请重新解锁。',
            code: 'TERMINAL_LOCKED',
          }, 403);
          return true;
        }
        if (result.busy) {
          sendJson(res, { success: false, error: '上一条命令还在执行中，请稍候。', code: 'TERMINAL_BUSY' }, 409);
          return true;
        }

        const elapsedMs = Date.now() - startedAt;
        terminalHistory.push({ time: new Date().toISOString(), command, code: result.code, elapsedMs });
        if (terminalHistory.length > TERMINAL_HISTORY_MAX) terminalHistory.splice(0, terminalHistory.length - TERMINAL_HISTORY_MAX);
        writeAudit({ action: 'exec', command: command.slice(0, 500), code: result.code, elapsedMs, ip: session.ip });

        sendJson(res, {
          success: true,
          data: {
            command,
            code: result.code,
            output: result.output,
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
    logger.info?.('[webConsole] Root 终端路由已装载（口令解锁 · 持久 shell 会话）');
  }
  return { handle };
}
