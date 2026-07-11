function normalizeId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}
function getInstanceId(bot = {}) {
  return normalizeId(
    bot?.uin
      ?? bot?.self_id
      ?? bot?.selfId
      ?? bot?.user_id
      ?? bot?.account?.uin
      ?? bot?.info?.uin
      ?? '',
  );
}

function getRuntimeBotInstances(event = {}) {
  const root = globalThis.Bot;
  const bots = [];
  const seen = new Set();
  const add = (bot) => {
    if (!bot || typeof bot !== 'object' || seen.has(bot)) return;
    seen.add(bot);
    bots.push(bot);
  };

  add(event.bot);
  add(root);
  for (const field of ['bots', 'clients', 'uin']) {
    const value = root?.[field];
    if (value instanceof Map) {
      for (const bot of value.values()) add(bot);
    } else if (Array.isArray(value) || value instanceof Set) {
      for (const bot of value) add(bot);
    } else if (value && typeof value === 'object') {
      for (const bot of Object.values(value)) add(bot);
    }
  }
  return bots;
}

function sanitizeName(value = '', fallback = '魔丸') {
  return String(value || fallback || '魔丸')
    .replace(/[\r\n\t\0-\x1F\x7F]+/g, ' ')
    .trim()
    .slice(0, 40) || '魔丸';
}

function getAvatarText(name = '魔丸') {
  const chars = Array.from(String(name || '').trim());
  if (!chars.length) return '魔';
  return chars.slice(0, Math.min(2, chars.length)).join('');
}

export function resolveBotIdentity(event = {}, fallbackName = '魔丸') {
  const requestedId = normalizeId(
    event.self_id
      ?? event.bot_id
      ?? event.bot?.uin
      ?? event.bot?.self_id
      ?? '',
  );
  const bots = getRuntimeBotInstances(event);
  const bot = bots.find(item => getInstanceId(item) === requestedId)
    || bots.find(item => getInstanceId(item))
    || event.bot
    || null;
  const botId = requestedId || getInstanceId(bot);
  const candidates = [
    event.bot?.nickname,
    event.bot?.nickName,
    event.bot?.name,
    event.bot?.info?.nickname,
    event.bot?.account?.nickname,
    bot?.nickname,
    bot?.nickName,
    bot?.name,
    bot?.info?.nickname,
    bot?.account?.nickname,
    globalThis.Bot?.nickname,
    fallbackName,
  ];
  const botName = sanitizeName(
    candidates.find(value => String(value || '').trim()),
    fallbackName,
  );

  return {
    botId,
    botName,
    avatarText: getAvatarText(botName),
    avatarUrl: botId
      ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(botId)}&s=640`
      : '',
  };
}
