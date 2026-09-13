// 微信 ilink bot 官方接口协议层（微信 ClawBot 开放通道）
// 参考：getUpdates 长轮询 / sendMessage / 媒体上传 / 扫码登录，均为微信官方开放能力
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Path from '../../constants/path.js';

const ILINK_API_BASE = 'https://ilinkai.weixin.qq.com';
const LONG_POLL_TIMEOUT_MS = 40000;
const REQUEST_TIMEOUT_MS = 15000;
const LOGIN_STATE_FILE = path.join(Path.data, 'weixin-ilink-credentials.json');

const LOGIN_STATES = { WAIT: 'wait', SCANNED: 'scaned', EXPIRED: 'expired', CONFIRMED: 'confirmed' };

function buildHeaders(token = '') {
  // X-WECHAT-UIN：随机 uint32 的 base64，官方客户端每次请求重新生成
  const uinBuffer = crypto.randomBytes(4);
  const headers = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': uinBuffer.toString('base64'),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function requestJson(pathname, { method = 'GET', token = '', body = null, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ILINK_API_BASE}${pathname}`, {
      method,
      headers: buildHeaders(token),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!response.ok) {
      const error = new Error(`ilink ${pathname} HTTP ${response.status}: ${String(text).slice(0, 200)}`);
      error.statusCode = response.status;
      throw error;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function loadCredentials() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOGIN_STATE_FILE, 'utf8'));
    return raw && raw.botToken ? raw : null;
  } catch {
    return null;
  }
}

function saveCredentials(credentials) {
  const payload = {
    botToken: String(credentials.botToken || ''),
    botId: String(credentials.botId || ''),
    savedAt: new Date().toISOString(),
  };
  if (!payload.botToken) throw new Error('ilink 凭证缺少 botToken');
  fs.mkdirSync(path.dirname(LOGIN_STATE_FILE), { recursive: true });
  fs.writeFileSync(LOGIN_STATE_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function clearCredentials() {
  try { fs.unlinkSync(LOGIN_STATE_FILE); } catch { }
}

// 扫码登录：拿二维码 → 轮询状态（expired 自动刷新，最多 3 次）→ confirmed 返回凭证
async function loginByQrcode({ logger = console, onState = () => { } } = {}) {
  let refreshCount = 0;
  while (refreshCount <= 3) {
    const create = await requestJson('/ilink/bot/get_bot_qrcode', { method: 'POST' });
    const qrcodeUrl = create?.qrcode_url || create?.qrcodeUrl || '';
    const qrcodeContent = create?.qrcode_content || create?.qrcodeContent || qrcodeUrl;
    if (!qrcodeContent) throw new Error('ilink 登录：未返回二维码');
    onState({ state: LOGIN_STATES.WAIT, qrcodeUrl, qrcodeContent, refreshCount });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      let status;
      try {
        status = await requestJson('/ilink/bot/get_qrcode_status', { method: 'POST', body: { uuid: create?.uuid || create?.uUid || '' } });
      } catch (error) {
        logger?.warn?.(`[weixin-ilink] 轮询扫码状态失败：${error.message}`);
        continue;
      }
      const state = String(status?.status || '').toLowerCase();
      if (state === LOGIN_STATES.SCANNED) onState({ state: LOGIN_STATES.SCANNED, refreshCount });
      if (state === LOGIN_STATES.EXPIRED) break;
      if (state === LOGIN_STATES.CONFIRMED) {
        const credentials = {
          botToken: status?.bot_token || status?.botToken || '',
          botId: status?.ilink_bot_id || status?.botId || status?.uin || '',
        };
        saveCredentials(credentials);
        onState({ state: LOGIN_STATES.CONFIRMED, botId: credentials.botId });
        return credentials;
      }
    }
    refreshCount += 1;
  }
  throw new Error('ilink 登录：二维码多次过期，未完成扫码确认');
}

// 发送文本消息；contextToken 必须来自该会话最近一条收到的消息
async function sendTextMessage({ token, toUserId, content, contextToken }) {
  if (!token) throw new Error('ilink 未登录：缺少 bot token');
  if (!toUserId || !content) throw new Error('ilink 发消息缺少目标或内容');
  const body = {
    msg: {
      from_user_id: '',
      to_user_id: String(toUserId),
      content: String(content),
      msg_type: 'TEXT',
    },
    context_token: String(contextToken || ''),
  };
  return requestJson('/ilink/bot/sendmessage', { method: 'POST', token, body, timeoutMs: 20000 });
}

// 长轮询：hold 约 35s，超时（AbortError）属正常，返回空数组继续
async function longPollUpdates({ token, cursorBuf, timeoutMs = LONG_POLL_TIMEOUT_MS }) {
  if (!token) throw new Error('ilink 未登录：缺少 bot token');
  const body = { get_updates_buf: cursorBuf || '' };
  try {
    const response = await requestJson('/ilink/bot/getupdates', { method: 'POST', token, body, timeoutMs });
    const updates = Array.isArray(response?.msgs) ? response.msgs : (Array.isArray(response?.updates) ? response.updates : []);
    return { updates, cursorBuf: response?.get_updates_buf || cursorBuf || '' };
  } catch (error) {
    if (error?.name === 'AbortError') return { updates: [], cursorBuf };
    throw error;
  }
}

// 媒体上传：先取预签名 URL 再 PUT
async function uploadMedia({ token, fileBuffer, fileName, mimeType }) {
  const urlResponse = await requestJson('/ilink/bot/getuploadurl', {
    method: 'POST',
    token,
    body: { file_name: String(fileName || 'file.bin'), file_type: String(mimeType || 'application/octet-stream') },
  });
  const uploadUrl = urlResponse?.upload_url || urlResponse?.uploadUrl || '';
  if (!uploadUrl) throw new Error('ilink 上传：未返回上传地址');
  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType || 'application/octet-stream' },
    body: fileBuffer,
  });
  if (!putResponse.ok) throw new Error(`ilink 上传失败：HTTP ${putResponse.status}`);
  return urlResponse?.file_id || urlResponse?.fileId || uploadUrl;
}

// 触发"正在输入"状态
async function sendTyping({ token, toUserId, contextToken }) {
  try {
    await requestJson('/ilink/bot/sendtyping', {
      method: 'POST',
      token,
      body: { to_user_id: String(toUserId || ''), context_token: String(contextToken || ''), status: 'TYPING' },
    });
  } catch {
    // 状态接口失败不影响主流程
  }
}

export {
  ILINK_API_BASE,
  LOGIN_STATES,
  buildHeaders,
  requestJson,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  loginByQrcode,
  sendTextMessage,
  longPollUpdates,
  uploadMedia,
  sendTyping,
  LOGIN_STATE_FILE,
};
