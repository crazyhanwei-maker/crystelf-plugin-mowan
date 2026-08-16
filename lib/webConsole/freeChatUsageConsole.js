const FREE_CHAT_USAGE_URL = 'https://chat.furina.info/freechatapi/relay-ip-usage?key=free';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_TTL_MS = 30000;

function normalizeNumber(value = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizeQuota(source = {}) {
  return {
    used: normalizeNumber(source.used),
    count: normalizeNumber(source.count),
    limit: normalizeNumber(source.limit),
    remaining: normalizeNumber(source.remaining),
    percent: Math.min(100, normalizeNumber(source.percent)),
    exceeded: source.exceeded === true,
    limitEnabled: source.limit_enabled !== false,
  };
}

export function createFreeChatUsageConsole(options = {}) {
  const fetchFn = typeof options.fetch === 'function' ? options.fetch : ((...args) => fetch(...args));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const cacheTtlMs = Math.max(0, Number(options.cacheTtlMs) || DEFAULT_CACHE_TTL_MS);
  let cachedPayload = null;
  let cachedAt = 0;
  let inFlight = null;

  async function requestUsage() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(FREE_CHAT_USAGE_URL, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'crystelf-plugin/free-chat-usage',
        },
      });
      if (!response.ok) {
        throw new Error(`FREE CHAT 用量接口返回 HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data || data.ok !== true) {
        throw new Error(String(data?.error || 'FREE CHAT 用量接口返回异常'));
      }

      const tokens = normalizeQuota(data.tokens);
      const requests = normalizeQuota(data.requests);
      requests.success = normalizeNumber(data.requests?.success);
      requests.failed = normalizeNumber(data.requests?.failed);

      return {
        success: true,
        service: 'FREE CHAT',
        generatedAt: String(data.generatedAt || ''),
        timezone: String(data.timezone || ''),
        period: {
          type: String(data.period?.type || ''),
          date: String(data.period?.date || ''),
          resetAt: String(data.period?.resetAt || ''),
        },
        tokens,
        requests,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`FREE CHAT 用量接口请求超时（${timeoutMs}ms）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function buildPayload(options = {}) {
    const force = options.force === true;
    const now = Date.now();
    if (!force && cachedPayload && now - cachedAt < cacheTtlMs) {
      return { ...cachedPayload, cached: true };
    }
    if (!force && inFlight) return inFlight;

    inFlight = requestUsage()
      .then(payload => {
        cachedPayload = payload;
        cachedAt = Date.now();
        return payload;
      })
      .catch(error => ({
        success: false,
        service: 'FREE CHAT',
        error: error?.message || String(error),
        checkedAt: new Date().toISOString(),
      }))
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return {
    buildPayload,
  };
}
