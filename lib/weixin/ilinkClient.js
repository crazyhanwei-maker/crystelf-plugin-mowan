// 微信 ilink bot 官方接口协议层（微信 ClawBot 开放通道）
// 字段与流程对齐官方协议实现：扫码登录 GET + qrcode 参数轮询、getUpdates 长轮询、
// sendMessage 走 item_list 结构（message_type=2 BOT / message_state=2 FINISH）
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Path from '../../constants/path.js';

const ILINK_API_BASE = 'https://ilinkai.weixin.qq.com';
const LONG_POLL_TIMEOUT_MS = 35000;
const REQUEST_TIMEOUT_MS = 15000;
const LOGIN_STATE_FILE = path.join(Path.data, 'weixin-ilink-credentials.json');

const MessageType = { USER: 1, BOT: 2 };
const MessageItemType = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 };
const MessageState = { NEW: 0, GENERATING: 1, FINISH: 2 };

function randomWechatUin() {
  // 官方实现：uint32 数字字符串的 base64（不是二进制字节的 base64）
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function buildHeaders(token = '') {
  const headers = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function requestJson(pathname, { method = 'GET', token = '', body = null, timeoutMs = REQUEST_TIMEOUT_MS, extraHeaders = {} } = {}) {
  // ilink 全链路依赖全局 fetch（Node 18+）。旧 Node 上报出人话，而不是 "fetch is not defined"
  if (typeof fetch !== 'function') {
    throw new Error(`当前 Node ${process.version} 缺少全局 fetch，ilink 通道需要 Node 18 及以上`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ILINK_API_BASE}${pathname}`, {
      method,
      headers: { ...buildHeaders(token), ...extraHeaders },
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
    baseUrl: String(credentials.baseUrl || ILINK_API_BASE),
    userId: String(credentials.userId || ''),
    savedAt: new Date().toISOString(),
  };
  if (!payload.botToken) throw new Error('ilink 凭证缺少 botToken');
  fs.mkdirSync(path.dirname(LOGIN_STATE_FILE), { recursive: true });
  fs.writeFileSync(LOGIN_STATE_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function clearCredentials() {
  try { fs.unlinkSync(LOGIN_STATE_FILE); } catch { }
}

// 扫码登录：GET get_bot_qrcode?bot_type=3 → 响应 { qrcode, qrcode_img_content }
// 轮询 GET get_qrcode_status?qrcode=<qrcode>（头带 iLink-App-ClientVersion: 1）
async function loginByQrcode({ logger = console, onState = () => { } } = {}) {
  const fetchQrcode = async () => {
    const response = await requestJson(`/ilink/bot/get_bot_qrcode?bot_type=3`);
    const qrcode = String(response?.qrcode || '');
    const imgContent = String(response?.qrcode_img_content || qrcode);
    if (!qrcode) throw new Error(`ilink 登录：二维码响应异常（${JSON.stringify(response).slice(0, 200)}）`);
    return { qrcode, imgContent };
  };

  let qr = await fetchQrcode();
  onState({ state: 'wait', qrcodeUrl: qr.imgContent, refreshCount: 0 });
  const deadline = Date.now() + 8 * 60 * 1000;
  let refreshCount = 0;
  let scanedNotified = false;

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    let status = null;
    try {
      status = await requestJson(`/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}`, {
        timeoutMs: 36000,
        extraHeaders: { 'iLink-App-ClientVersion': '1' },
      });
    } catch (error) {
      if (error?.name === 'AbortError') continue; // hold 超时属正常
      logger?.warn?.(`[weixin-ilink] 轮询扫码状态失败：${error.message}`);
      continue;
    }
    const state = String(status?.status || '').toLowerCase();
    if (state === 'scaned' && !scanedNotified) {
      scanedNotified = true;
      onState({ state: 'scaned', refreshCount });
    }
    if (state === 'expired') {
      refreshCount += 1;
      if (refreshCount >= 3) throw new Error('ilink 登录：二维码多次过期，未完成扫码确认');
      onState({ state: 'expired', refreshCount });
      qr = await fetchQrcode();
      scanedNotified = false;
      onState({ state: 'wait', qrcodeUrl: qr.imgContent, refreshCount });
      continue;
    }
    if (state === 'confirmed') {
      const credentials = {
        botToken: String(status?.bot_token || ''),
        botId: String(status?.ilink_bot_id || ''),
        baseUrl: String(status?.baseurl || ILINK_API_BASE),
        userId: String(status?.ilink_user_id || ''),
      };
      if (!credentials.botToken || !credentials.botId) throw new Error('ilink 登录：确认成功但未返回 token/botId');
      saveCredentials(credentials);
      onState({ state: 'confirmed', botId: credentials.botId });
      return credentials;
    }
  }
  throw new Error('ilink 登录：8 分钟内未完成扫码确认');
}

// 连通性自检：只报告能否拿到二维码，不返回/打印二维码内容本身（那是登录凭证）
async function probeQrEndpoint({ timeoutMs = 10000 } = {}) {
  try {
    const response = await requestJson('/ilink/bot/get_bot_qrcode?bot_type=3', { timeoutMs });
    const qrcode = String(response?.qrcode || '');
    if (qrcode) return { ok: true, detail: '接口连通，已返回二维码（未展示）' };
    const keys = response && typeof response === 'object' ? Object.keys(response).join(',') : typeof response;
    return { ok: false, detail: `响应缺少 qrcode 字段（返回字段：${keys}）` };
  } catch (error) {
    return { ok: false, detail: `${error?.name || 'Error'}: ${error?.message || String(error)}` };
  }
}

// 从收到的消息提取文本（item_list 结构，含引用消息前缀）
function extractTextFromMessage(message = {}) {
  const items = Array.isArray(message?.item_list) ? message.item_list : [];
  for (const item of items) {
    if (item?.type === MessageItemType.TEXT && item?.text_item?.text) {
      const text = String(item.text_item.text);
      const refTitle = String(item?.ref_msg?.title || '').trim();
      return refTitle ? `[引用: ${refTitle}]\n${text}` : text;
    }
  }
  return '';
}

// 长轮询：hold 约 35s，AbortError 属正常，返回空数组继续
async function longPollUpdates({ token, cursorBuf, timeoutMs = LONG_POLL_TIMEOUT_MS }) {
  if (!token) throw new Error('ilink 未登录：缺少 bot token');
  try {
    const response = await requestJson('/ilink/bot/getupdates', {
      method: 'POST',
      token,
      body: { get_updates_buf: cursorBuf || '' },
      timeoutMs,
    });
    const updates = Array.isArray(response?.msgs) ? response.msgs : [];
    return { updates, cursorBuf: response?.get_updates_buf || cursorBuf || '' };
  } catch (error) {
    if (error?.name === 'AbortError') return { updates: [], cursorBuf };
    throw error;
  }
}

// 发送文本：item_list 结构 + client_id + message_type=2(BOT) + message_state=2(FINISH)
async function sendTextMessage({ token, toUserId, content, contextToken, baseUrl = '' }) {
  if (!token) throw new Error('ilink 未登录：缺少 bot token');
  if (!toUserId) throw new Error('ilink 发消息缺少目标用户');
  const clientId = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = {
    msg: {
      from_user_id: '',
      to_user_id: String(toUserId),
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      ...(String(content || '') ? { item_list: [{ type: MessageItemType.TEXT, text_item: { text: String(content).slice(0, 4000) } }] } : {}),
      context_token: String(contextToken || ''),
    },
  };
  return requestJson('/ilink/bot/sendmessage', { method: 'POST', token, body, timeoutMs: 20000 });
}

// ── 图片发送：getuploadurl → AES-128-ECB 加密 → CDN 上传 → sendmessage 引用媒体 ──

function aesEcbPaddedSize(plaintextSize) {
  return (Math.floor(plaintextSize / 16) + 1) * 16;
}

function encryptAesEcb(plaintext, key) {
  // 手动 PKCS7 + 关闭 Node auto-padding（否则 16B 整数倍输入会被再补一块，CDN 解出坏图）
  const padLen = 16 - (plaintext.length % 16);
  const padded = Buffer.concat([plaintext, Buffer.alloc(padLen, padLen)]);
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

// 发送图片（Buffer）：成功返回 sendmessage 响应；任一步失败抛错由调用方决定降级
async function sendImageMessage({ token, toUserId, contextToken, imageBuffer }) {
  if (!token) throw new Error('ilink 未登录：缺少 bot token');
  if (!toUserId) throw new Error('ilink 发图片缺少目标用户');
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) throw new Error('ilink 发图片缺少图片数据');

  const filekey = crypto.randomBytes(16).toString('hex');
  const aeskey = crypto.randomBytes(16);
  const rawsize = imageBuffer.length;
  const rawfilemd5 = crypto.createHash('md5').update(imageBuffer).digest('hex');
  const filesize = aesEcbPaddedSize(rawsize);

  const uploadResp = await requestJson('/ilink/bot/getuploadurl', {
    method: 'POST',
    token,
    body: {
      filekey,
      media_type: 1, // 1=图片
      to_user_id: String(toUserId),
      rawsize,
      rawfilemd5,
      filesize,
      no_need_thumb: true,
      aeskey: aeskey.toString('hex'), // 官方字段名是 aeskey（hex 字符串），非 aeskey_hex
      base_info: { channel_version: '1.0.2' },
    },
  });
  // 响应两种形态：upload_param（拼 CDN URL）或 upload_full_url（完整 URL 直用）
  const uploadParam = uploadResp?.upload_param || uploadResp?.uploadParam || '';
  const uploadFullUrl = uploadResp?.upload_full_url || uploadResp?.uploadFullUrl || '';
  let cdnUrl;
  if (uploadFullUrl) {
    cdnUrl = uploadFullUrl;
  } else if (uploadParam) {
    cdnUrl = `https://novac2c.cdn.weixin.qq.com/c2c/upload?${new URLSearchParams({ encrypted_query_param: uploadParam, filekey })}`;
  } else {
    throw new Error(`ilink 上传：未返回上传地址（${JSON.stringify(uploadResp).slice(0, 150)}）`);
  }
  const ciphertext = encryptAesEcb(imageBuffer, aeskey);
  const cdnResponse = await fetch(cdnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: ciphertext,
  });
  const downloadParam = cdnResponse.headers.get('x-encrypted-param');
  if (!cdnResponse.ok || !downloadParam) throw new Error(`ilink CDN 上传失败：HTTP ${cdnResponse.status}`);

  // 关键：aes_key 先转 hex 字符串再 base64
  const aesKeyBase64 = Buffer.from(aeskey.toString('hex'), 'utf-8').toString('base64');
  const body = {
    msg: {
      from_user_id: '',
      to_user_id: String(toUserId),
      client_id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: String(contextToken || ''),
      item_list: [{
        type: MessageItemType.IMAGE,
        image_item: {
          media: {
            encrypt_query_param: downloadParam,
            aes_key: aesKeyBase64,
            encrypt_type: 1,
          },
        },
      }],
    },
    base_info: { channel_version: '1.0.2' },
  };
  return requestJson('/ilink/bot/sendmessage', { method: 'POST', token, body, timeoutMs: 30000 });
}

export {
  ILINK_API_BASE,
  MessageType,
  MessageItemType,
  MessageState,
  buildHeaders,
  requestJson,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  loginByQrcode,
  probeQrEndpoint,
  extractTextFromMessage,
  longPollUpdates,
  sendTextMessage,
  sendImageMessage,
  LOGIN_STATE_FILE,
};
