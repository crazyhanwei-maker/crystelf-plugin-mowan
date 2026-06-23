/**
 * AI 接口调用重试工具。
 * 仅对「可重试错误」（网络错误/超时/429/5xx）做指数退避重试；
 * 4xx 鉴权/参数错误不重试，避免对永久性错误浪费配额与时间。
 */

/** 网络层错误码，命中即视为可重试 */
const RETRYABLE_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ECONNABORTED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * 判断错误是否值得重试。
 * @param {Error|any} error
 * @returns {boolean}
 */
export function isRetryableError(error) {
  if (!error) return false;

  const code = String(error?.code || '').trim();
  const name = String(error?.name || '').trim();
  const message = String(error?.message || error || '').trim();
  const combined = `${name} ${code} ${message}`;

  // 1. 网络层错误码
  if (RETRYABLE_NETWORK_CODES.has(code)) return true;

  // 2. 超时类（消息匹配）
  if (/超时|timeout|timed out|time out|abort/i.test(combined)) return true;

  // 3. HTTP 状态码：429 / 5xx 可重试，4xx 不可重试
  const status = Number(error?.status || error?.response?.status || 0);
  if (status === 429 || (status >= 500 && status <= 599)) return true;

  return false;
}

/**
 * 计算第 attempt 次重试（从 1 开始）的退避间隔。
 * 指数退避：baseDelay * 2^(attempt-1)，封顶于 maxDelay。
 */
function computeBackoff(attempt, baseDelay, maxDelay) {
  const raw = baseDelay * Math.pow(2, attempt - 1);
  return Math.min(raw, maxDelay);
}

/**
 * 通用重试包裹器。
 *
 * @param {() => Promise<any>} fn 要执行的异步操作
 * @param {object} options
 * @param {number} [options.retries=0] 重试次数（不含首次），0 即不重试
 * @param {(result:any)=>boolean|null} [options.isFailureResult=null] 可选，用于「返回失败结果而非抛异常」型调用；返回 true 表示需重试
 * @param {number} [options.baseDelay=500] 初始退避间隔 ms
 * @param {number} [options.maxDelay=8000] 退避上限 ms
 * @param {(ms:number)=>Promise<void>} [options.sleep] 休眠函数（可注入便于测试）
 * @param {(info:{attempt:number,delay:number,error:any})=>void} [options.onRetry=null] 重试回调
 * @returns {Promise<any>}
 */
export async function withRetry(fn, {
  retries = 0,
  isFailureResult = null,
  baseDelay = 500,
  maxDelay = 8000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onRetry = null,
} = {}) {
  // 0 次重试：直接执行，零开销
  const maxRetries = Number(retries) > 0 ? Number(retries) : 0;
  if (maxRetries <= 0) return fn();

  const isResolveFailure = (result) =>
    typeof isFailureResult === 'function' && isFailureResult(result) === true;

  let lastError = null;
  let lastResult;
  let threw = false;

  // 首次执行
  try {
    lastResult = await fn();
    if (!isResolveFailure(lastResult)) return lastResult;
    threw = false;
  } catch (error) {
    // 不可重试错误立即抛出
    if (!isRetryableError(error)) throw error;
    lastError = error;
    threw = true;
  }

  // 重试循环
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const delay = computeBackoff(attempt, baseDelay, maxDelay);
    if (typeof onRetry === 'function') {
      onRetry({ attempt, delay, error: threw ? lastError : null });
    }
    await sleep(delay);
    try {
      lastResult = await fn();
      threw = false;
      lastError = null;
      if (!isResolveFailure(lastResult)) return lastResult;
    } catch (error) {
      // 不可重试错误立即抛出
      if (!isRetryableError(error)) throw error;
      lastError = error;
      threw = true;
    }
  }

  // 重试耗尽
  if (threw) throw lastError;
  return lastResult;
}
