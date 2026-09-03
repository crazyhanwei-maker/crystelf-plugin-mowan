// 零依赖 SMTP 邮件告警：Node 内置 net + crypto 实现 STARTTLS + AUTH LOGIN 发信。
// 仅用于看门狗等"QQ 链路不可用时"的旁路告警，配置了 host+user+pass+收件人才启用。
import net from 'net';
import tls from 'tls';
import crypto from 'crypto';

const SOCKET_TIMEOUT_MS = 15 * 1000;

function armSocketTimeout(socket, message = 'SMTP 空闲超时') {
  socket.setTimeout(SOCKET_TIMEOUT_MS);
  socket.once('timeout', () => {
    socket.destroy();
  });
}

function encodeHeader(value = '') {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function parseSmtpReply(chunk = '') {
  // SMTP 回复可能是多行（250-xxx），判定码取最后一行
  const lines = String(chunk || '').trim().split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  const code = Number(last.slice(0, 3));
  return { code, lines };
}

function readSmtpReply(socket) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = fn => {
      if (settled) return;
      settled = true;
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      socket.off('timeout', onTimeout);
      fn();
    };
    const onData = data => {
      const reply = parseSmtpReply(data.toString('utf8'));
      if (reply.code) finish(() => resolve(reply));
    };
    const onError = err => finish(() => reject(err));
    const onClose = () => finish(() => reject(new Error('SMTP 连接已关闭')));
    const onTimeout = () => finish(() => reject(new Error('SMTP 响应超时')));
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.on('timeout', onTimeout);
  });
}

async function command(socket, expectedCode, text = '') {
  if (text) socket.write(`${text}\r\n`);
  const reply = await readSmtpReply(socket);
  const ok = Array.isArray(expectedCode)
    ? expectedCode.includes(reply.code)
    : reply.code === expectedCode;
  if (!ok) {
    throw new Error(`SMTP ${text || 'REPLY'} 期望 ${expectedCode} 实得 ${reply.code}：${reply.lines.join(' / ').slice(0, 160)}`);
  }
  return reply;
}

// 地址只允许 ASCII 邮箱格式：CRLF/控制字符能注入额外邮件头，配置值不可信时直接判配置无效
const EMAIL_ADDRESS_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function isValidEmailAddress(value = '') {
  return EMAIL_ADDRESS_PATTERN.test(String(value || '').trim());
}

function buildMailContent({ subject, body, from, to }) {
  if (!isValidEmailAddress(from) || !isValidEmailAddress(to)) {
    throw new Error('SMTP 发件人或收件人地址格式非法（发送前应已校验）');
  }
  const messageId = `<${crypto.randomBytes(12).toString('hex')}@crystelf-watchdog>`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
  ].join('\r\n');
  // 正文按 76 列 base64 分行
  const encoded = Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const raw = `${headers}${encoded}\r\n.\r\n`;
  return raw;
}

export function createSmtpAlertMailer(options = {}) {
  const logger = options.logger || { warn: () => {}, mark: () => {} };
  const getConfig = typeof options.getConfig === 'function' ? options.getConfig : () => ({});

  function loadConfig() {
    const raw = getConfig() || {};
    const host = String(raw.smtpHost || '').trim();
    const port = Number(raw.smtpPort) || 465;
    const user = String(raw.smtpUser || '').trim();
    const pass = String(raw.smtpPass || '').trim();
    const from = String(raw.smtpFrom || user).trim();
    const to = String(raw.smtpTo || '').trim();
    // 显式配置优先：smtpSecure 明确给出时按配置走；未给时按端口约定（465=SSL，其余=STARTTLS）
    let secure;
    if (raw.smtpSecure === true || raw.smtpSecure === false) {
      secure = raw.smtpSecure;
    } else {
      secure = port === 465;
    }
    const enabled = Boolean(host && user && pass && to);
    return { host, port, user, pass, from, to, secure, enabled };
  }

  function isConfigured() {
    return loadConfig().enabled;
  }

  async function send(subject = '', body = '') {
    const cfg = loadConfig();
    if (!cfg.enabled) {
      return { success: false, error: 'SMTP 未配置' };
    }
    // 地址合法性在建立连接前校验：CRLF/控制字符可注入邮件头，坏配置不应连出去
    if (!isValidEmailAddress(cfg.from)) {
      return { success: false, error: `SMTP 发件人地址格式非法：${cfg.from.slice(0, 60)}` };
    }
    if (!isValidEmailAddress(cfg.to)) {
      return { success: false, error: `SMTP 收件人地址格式非法：${cfg.to.slice(0, 60)}` };
    }
    // servername 仅对域名有意义，IP 直连时省略避免 RFC 6066 弃用警告
    const tlsOptions = {
      rejectUnauthorized: false,
      ...(/^\d{1,3}(\.\d{1,3}){3}$/.test(cfg.host) ? {} : { servername: cfg.host }),
    };

    let socket = null;
    try {
      socket = await new Promise((resolve, reject) => {
        const plain = net.connect({ host: cfg.host, port: cfg.port });
        const timer = setTimeout(() => {
          plain.destroy();
          reject(new Error(`SMTP 连接超时（${cfg.host}:${cfg.port}）`));
        }, SOCKET_TIMEOUT_MS);
        plain.once('connect', () => {
          clearTimeout(timer);
          if (cfg.secure) {
            // 465 端口：明文 socket 上直接包 TLS
            const secureSocket = tls.connect({ socket: plain, ...tlsOptions }, () => {
              secureSocket.removeAllListeners('error');
              resolve(secureSocket);
            });
            secureSocket.once('error', err => {
              clearTimeout(timer);
              reject(err);
            });
          } else {
            resolve(plain);
          }
        });
        plain.once('error', err => {
          clearTimeout(timer);
          reject(err);
        });
      });
      // 空闲超时必须监听 timeout 事件并销毁，否则挂起的 readSmtpReply 永远不返回
      armSocketTimeout(socket, `SMTP ${cfg.host}:${cfg.port} 空闲超时`);

      await command(socket, 220);                      // 服务器问候
      await command(socket, 250, `EHLO crystelf`);     // 能力列表
      if (!cfg.secure) {
        // STARTTLS 升级（587 等端口）；RFC 3207 规定其应答码为 220 而非 250
        await command(socket, 220, 'STARTTLS');
        const upgraded = await new Promise((resolve, reject) => {
          const secureSocket = tls.connect({ socket, ...tlsOptions }, () => {
            secureSocket.removeAllListeners('error');
            resolve(secureSocket);
          });
          secureSocket.once('error', reject);
        });
        socket = upgraded;
        armSocketTimeout(socket, `SMTP ${cfg.host}:${cfg.port} 空闲超时`);
        await command(socket, 250, `EHLO crystelf`);   // 加密后重新问候
      }
      await command(socket, 334, `AUTH LOGIN`);
      await command(socket, 334, encodeHeader(cfg.user));
      await command(socket, 235, encodeHeader(cfg.pass));
      await command(socket, 250, `MAIL FROM:<${cfg.from}>`);
      await command(socket, [250, 251], `RCPT TO:<${cfg.to}>`);
      await command(socket, 354, `DATA`);
      socket.write(buildMailContent({ subject, body, from: cfg.from, to: cfg.to }));
      await command(socket, 250);                     // 结束 DATA 的 '.' 应答
      socket.write('QUIT\r\n');
      logger.mark(`[watchdog] 告警邮件已发送：${subject}`);
      return { success: true };
    } catch (error) {
      logger.warn(`[watchdog] 告警邮件发送失败: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      try {
        socket?.destroy();
      } catch {}
    }
  }

  return { send, isConfigured, loadConfig };
}
