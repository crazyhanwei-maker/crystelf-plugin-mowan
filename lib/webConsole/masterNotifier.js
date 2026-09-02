// 主人通知通道：Bot 未就绪（如刚重启、适配器未连接）时自动排队重试，超时放弃。
// 同一消息向多个主人发送时按"全部送达"判定，部分失败会整体重发（未送达方收到，已送达方可能收到重复）。
const RETRY_INTERVAL_MS = 15 * 1000;
const RETRY_DEADLINE_MS = 10 * 60 * 1000;

export function createMasterNotifier({ logger = console, loadMasterIds: customLoadMasterIds } = {}) {
  let masterIds = null;
  const queue = [];
  let timer = null;
  let startedAt = 0;
  let flushing = false;

  async function loadMasterIds() {
    if (masterIds) return masterIds;
    if (typeof customLoadMasterIds === 'function') {
      masterIds = await customLoadMasterIds();
      return masterIds;
    }
    try {
      const mod = await import('../../../../lib/config/config.js');
      const cfg = mod?.default || mod?.cfg || null;
      masterIds = Array.isArray(cfg?.masterQQ)
        ? cfg.masterQQ.map(item => String(item ?? '').trim()).filter(Boolean)
        : [];
    } catch {
      masterIds = [];
    }
    return masterIds;
  }

  async function sendToMasters(message, label) {
    const bot = typeof globalThis !== 'undefined' ? globalThis.Bot : null;
    if (!bot?.pickUser) return { sent: 0, total: 0 };
    const ids = await loadMasterIds();
    if (!ids.length) return { sent: 0, total: 0, noMasters: true };
    let sent = 0;
    for (const id of ids) {
      try {
        await bot.pickUser(id).sendMsg(message);
        sent += 1;
      } catch (error) {
        logger.warn?.(`[webConsole] ${label}发送失败 ${id}: ${error.message}`);
      }
    }
    return { sent, total: ids.length };
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function flush() {
    if (flushing || queue.length === 0) return;
    flushing = true;
    try {
      if (Date.now() - startedAt > RETRY_DEADLINE_MS) {
        for (const item of queue) {
          logger.warn?.(`[webConsole] ${item.label}重试超时（10 分钟），放弃发送`);
        }
        queue.length = 0;
        stopTimer();
        return;
      }
      for (let index = queue.length - 1; index >= 0; index--) {
        const item = queue[index];
        const { sent, total, noMasters } = await sendToMasters(item.message, item.label);
        if (noMasters) {
          logger.warn?.(`[webConsole] ${item.label}未发送：未配置 masterQQ`);
          queue.splice(index, 1);
          continue;
        }
        if (total > 0 && sent >= total) {
          queue.splice(index, 1);
        }
      }
      if (queue.length === 0) {
        stopTimer();
      }
    } finally {
      flushing = false;
    }
  }

  return {
    async notifyMasters(message, { label = '通知' } = {}) {
      const item = { message, label };
      queue.push(item);
      if (!timer) {
        startedAt = Date.now();
        timer = setInterval(() => {
          flush().catch(() => {});
        }, RETRY_INTERVAL_MS);
      }
      await flush();
      if (queue.includes(item)) {
        logger.warn?.(`[webConsole] ${label}暂未送达（Bot 未就绪或发送失败），将每 15 秒自动重试`);
        return 'queued';
      }
      return 'sent';
    },
  };
}
