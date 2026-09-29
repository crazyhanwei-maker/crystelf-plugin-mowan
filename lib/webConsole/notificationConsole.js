// 顶栏通知聚合：健康巡检问题 + QQ 看门狗掉线 + 版本更新，60 秒缓存。
// 只读各模块已有状态，不重复计算重量级数据。
export function createNotificationConsole(options = {}) {
  const buildHealthPayload = typeof options.buildHealthPayload === 'function' ? options.buildHealthPayload : null;
  const getVersionCheckPayload = typeof options.getVersionCheckPayload === 'function' ? options.getVersionCheckPayload : null;
  const getWatchdogStatus = typeof options.getWatchdogStatus === 'function' ? options.getWatchdogStatus : null;

  let cache = null;
  let cacheAtMs = 0;
  const CACHE_TTL_MS = 60 * 1000;

  async function buildNotificationPayload() {
    if (cache && Date.now() - cacheAtMs < CACHE_TTL_MS) {
      return cache;
    }

    const items = [];
    const now = new Date().toISOString();

    // 健康巡检问题（AI 配置缺失、请求失败、日志停滞等）
    if (buildHealthPayload) {
      try {
        const health = await buildHealthPayload();
        (health?.issues || []).forEach((issue, index) => {
          items.push({
            id: `health-${index}`,
            level: issue.level === 'error' ? 'error' : 'warn',
            title: String(issue.title || ''),
            detail: String(issue.detail || ''),
            time: now,
          });
        });
      } catch {
        // 巡检不可用时跳过该来源
      }
    }

    // QQ 适配器看门狗
    if (getWatchdogStatus) {
      try {
        const watchdog = getWatchdogStatus();
        if (watchdog?.offline) {
          const minutes = Math.max(1, Math.round(Number(watchdog.offlineDurationMs || 0) / 60000));
          items.push({
            id: 'watchdog-qq-offline',
            level: 'error',
            title: 'QQ 适配器掉线',
            detail: `已掉线约 ${minutes} 分钟，机器人无法收发消息。`,
            time: watchdog.offlineSince || now,
          });
        } else if (watchdog && Number(watchdog.onlineCount || 0) === 0) {
          items.push({
            id: 'watchdog-qq-empty',
            level: 'warn',
            title: 'QQ 适配器未连接',
            detail: '当前没有在线的协议端，机器人无法收发消息。',
            time: now,
          });
        }
      } catch {
        // 看门狗不可用时跳过
      }
    }

    // 版本更新
    if (getVersionCheckPayload) {
      try {
        const version = await getVersionCheckPayload();
        if (version?.updateAvailable) {
          items.push({
            id: 'version-update',
            level: 'info',
            title: '发现灵晶新版本',
            detail: `当前 v${version.localVersion || '?'}，远端已有更新，可到总览页执行更新。`,
            time: version.checkedAt || now,
          });
        }
      } catch {
        // 版本检查不可用时跳过
      }
    }

    const payload = {
      success: true,
      generatedAt: now,
      count: items.length,
      items,
    };
    cache = payload;
    cacheAtMs = Date.now();
    return payload;
  }

  return { buildNotificationPayload };
}
