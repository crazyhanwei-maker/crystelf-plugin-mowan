import plugin from '../../../lib/plugins/plugin.js';
import ConfigControl from '../lib/config/configControl.js';
import { createWebConsoleLoginTicket } from '../lib/webConsole/loginTicketStore.js';
import { getWebConsoleInfo } from '../lib/webConsole/server.js';
import { buildWebConsoleConfig, getWebConsoleDisplayUrl } from '../lib/webConsole/webConsoleConfig.js';

const LOGIN_TICKET_TTL_MS = 5 * 60 * 1000;

function normalizeBaseUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function getConfiguredPublicUrl(config = {}) {
  return normalizeBaseUrl(config.webConsolePublicUrl);
}

function getRuntimeFallbackUrl(config = {}) {
  const runtimeUrl = normalizeBaseUrl(getWebConsoleInfo()?.url || '');
  if (runtimeUrl) return runtimeUrl;
  return normalizeBaseUrl(getWebConsoleDisplayUrl(buildWebConsoleConfig(config)));
}

function buildLoginUrl(baseUrl = '', ticket = '') {
  const url = new URL('/login.html', `${baseUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('ticket', ticket);
  url.searchParams.set('redirect', '/index.html');
  return url.toString();
}

async function sendPrivateMessage(e, message) {
  const rawUserId = String(e?.user_id || '').trim();
  const userId = Number(rawUserId) || rawUserId;
  const bot = e?.bot || globalThis.Bot;
  if (!userId || !bot) {
    throw new Error('当前适配器无法获取 Bot 实例');
  }

  const failures = [];
  const candidates = [
    {
      name: 'event.friend.sendMsg',
      enabled: typeof e?.friend?.sendMsg === 'function',
      run: () => e.friend.sendMsg(message),
    },
    {
      name: 'bot.pickUser.sendMsg',
      enabled: typeof bot.pickUser === 'function',
      run: async () => {
        const user = bot.pickUser(userId);
        if (!user || typeof user.sendMsg !== 'function') {
          throw new Error('无法获取主人私聊对象');
        }
        return user.sendMsg(message);
      },
    },
    {
      name: 'bot.pickFriend.sendMsg',
      enabled: typeof bot.pickFriend === 'function',
      run: async () => {
        const friend = bot.pickFriend(userId);
        if (!friend || typeof friend.sendMsg !== 'function') {
          throw new Error('无法获取主人好友对象');
        }
        return friend.sendMsg(message);
      },
    },
    {
      name: 'send_private_msg',
      enabled: typeof bot.sendApi === 'function',
      run: () => bot.sendApi('send_private_msg', {
        user_id: userId,
        message,
      }),
    },
    {
      name: 'send_msg.private',
      enabled: typeof bot.sendApi === 'function',
      run: () => bot.sendApi('send_msg', {
        message_type: 'private',
        user_id: userId,
        message,
      }),
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.enabled) continue;
    try {
      return await candidate.run();
    } catch (error) {
      failures.push(`${candidate.name}: ${error.message}`);
    }
  }

  throw new Error(failures.length ? failures.join(' | ') : '当前适配器没有可用的私聊发送能力');
}

export default class CrystelfWebConsoleLogin extends plugin {
  constructor() {
    super({
      name: 'crystelf-web-console-login',
      dsc: 'QQ 内获取魔丸控制台一次性登录链接',
      event: 'message',
      priority: -114522,
      rule: [
        { reg: '^#灵晶登录$', fnc: 'sendWebConsoleLoginLink' },
      ],
    });
  }

  async sendWebConsoleLoginLink(e) {
    if (!e.isMaster) {
      return e.reply('只有主人可以获取控制台登录入口。', true);
    }

    const config = ConfigControl.get('config') || {};
    if (config.webConsole === false) {
      return e.reply('控制台功能当前已关闭，请先在配置里开启 webConsole。', true);
    }

    const publicUrl = getConfiguredPublicUrl(config);
    const baseUrl = publicUrl || getRuntimeFallbackUrl(config);
    if (!baseUrl) {
      return e.reply('暂时无法生成控制台地址，请确认控制台已经启动。', true);
    }

    const ticketState = createWebConsoleLoginTicket({
      operator: 'qq-master',
      source: 'command:#灵晶登录',
      groupId: e.group_id,
      userId: e.user_id,
    }, {
      ttlMs: LOGIN_TICKET_TTL_MS,
    });

    const loginUrl = buildLoginUrl(baseUrl, ticketState.ticket);
    const lines = [
      '魔丸控制台一次性登录入口：',
      loginUrl,
      '',
      '有效期：5 分钟',
      '打开后自动失效，请不要转发给其他人。',
    ];
    if (!publicUrl) {
      lines.push('', '当前未配置 webConsolePublicUrl，如果这个地址不是公网可访问，请在控制台设置里填写公网访问地址。');
    }

    try {
      await sendPrivateMessage(e, lines.join('\n'));
      if (e.message_type === 'private') {
        return true;
      }
      return e.reply('已将控制台一次性登录入口私聊给主人。', true);
    } catch (error) {
      logger.warn(`[crystelf-plugin] 私聊发送控制台登录入口失败: ${error.message}`);
      return e.reply('私聊发送失败，请确认已添加好友或允许临时会话。', true);
    }
  }
}
