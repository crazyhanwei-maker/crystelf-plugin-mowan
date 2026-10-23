import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableError, withRetry } from './retry.js';

// ---- isRetryableError ----

test('isRetryableError: 超时类错误可重试', () => {
  assert.equal(isRetryableError(new Error('AI请求超时（60000ms）')), true);
  assert.equal(isRetryableError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), true);
  assert.equal(isRetryableError(Object.assign(new Error('aborted'), { code: 'ECONNABORTED' })), true);
  assert.equal(isRetryableError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })), true);
});

test('isRetryableError: 429 / 5xx 可重试', () => {
  assert.equal(isRetryableError(Object.assign(new Error('rate limited'), { status: 429 })), true);
  assert.equal(isRetryableError(Object.assign(new Error('server err'), { status: 500 })), true);
  assert.equal(isRetryableError(Object.assign(new Error('bad gw'), { status: 502 })), true);
  // axios 风格：error.response.status
  assert.equal(isRetryableError(Object.assign(new Error('x'), { response: { status: 503 } })), true);
});

test('isRetryableError: 4xx 鉴权/参数错误不可重试', () => {
  assert.equal(isRetryableError(Object.assign(new Error('unauthorized'), { status: 401 })), false);
  assert.equal(isRetryableError(Object.assign(new Error('forbidden'), { status: 403 })), false);
  assert.equal(isRetryableError(Object.assign(new Error('bad request'), { status: 400 })), false);
  assert.equal(isRetryableError(Object.assign(new Error('x'), { response: { status: 404 } })), false);
});

test('isRetryableError: 未知普通错误不可重试', () => {
  assert.equal(isRetryableError(new Error('something weird')), false);
});

// ---- withRetry ----

test('withRetry: retries=0 直接执行不重试', async () => {
  let calls = 0;
  const fn = async () => { calls++; return 'ok'; };
  const result = await withRetry(fn, { retries: 0 });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry: 首次成功不重试', async () => {
  let calls = 0;
  const fn = async () => { calls++; return 'ok'; };
  const result = await withRetry(fn, { retries: 3, baseDelay: 1, sleep: async () => {} });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry: 可重试错误重试到成功', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 3) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    return 'ok';
  };
  const result = await withRetry(fn, { retries: 3, baseDelay: 1, sleep: async () => {} });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withRetry: 不可重试错误立即抛出不重试', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw Object.assign(new Error('unauthorized'), { status: 401 });
  };
  await assert.rejects(() => withRetry(fn, { retries: 3, baseDelay: 1, sleep: async () => {} }), /unauthorized/);
  assert.equal(calls, 1);
});

test('withRetry: 重试耗尽抛出最后的错误', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw Object.assign(new Error('server error'), { status: 500 });
  };
  await assert.rejects(() => withRetry(fn, { retries: 2, baseDelay: 1, sleep: async () => {} }), /server error/);
  assert.equal(calls, 3); // 首次 + 2 次重试
});

test('withRetry: onRetry 回调被调用且携带尝试信息', async () => {
  const retries = [];
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 2) throw Object.assign(new Error('rate'), { status: 429 });
    return 'ok';
  };
  await withRetry(fn, {
    retries: 3, baseDelay: 1, sleep: async () => {},
    onRetry: (info) => retries.push(info),
  });
  assert.equal(retries.length, 1);
  assert.equal(retries[0].attempt, 1);
  assert.equal(retries[0].delay, 1);
  assert.match(String(retries[0].error?.message || retries[0].error), /rate/);
});

test('withRetry: 退避上限不超过 maxDelay', async () => {
  const delays = [];
  let calls = 0;
  const fn = async () => { calls++; throw Object.assign(new Error('x'), { status: 500 }); };
  await withRetry(fn, {
    retries: 5, baseDelay: 1000, maxDelay: 4000,
    sleep: async (ms) => delays.push(ms),
    onRetry: () => {},
  }).catch(() => {});
  // 退避序列：1000, 2000, 4000, 4000(cap), 4000(cap)
  assert.deepEqual(delays, [1000, 2000, 4000, 4000, 4000]);
});

test('withRetry: isFailureResult 触发重试（返回失败结果而非抛异常）', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 2) return { success: false, error: 'fail' };
    return { success: true };
  };
  const result = await withRetry(fn, {
    retries: 3, baseDelay: 1, sleep: async () => {},
    isFailureResult: (r) => r && r.success === false,
  });
  assert.equal(result.success, true);
  assert.equal(calls, 2);
});

test('withRetry: OpenAI 空内容结果可触发重试', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 2) return { choices: [{ message: { content: '' } }] };
    return { choices: [{ message: { content: 'ok' } }] };
  };
  const retries = [];
  const result = await withRetry(fn, {
    retries: 1,
    baseDelay: 1,
    sleep: async () => {},
    isFailureResult: (completion) => !String(completion?.choices?.[0]?.message?.content || '').trim(),
    onRetry: (info) => retries.push(info),
  });
  assert.equal(result.choices[0].message.content, 'ok');
  assert.equal(calls, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].error, null);
});

// ---- Node fetch（undici）网络失败：真实错误码在 error.cause 上 ----

const makeFetchFailed = (causeLike = {}) => {
  const cause = Object.assign(new Error(causeLike.message || 'connect failed'), causeLike);
  return new TypeError('fetch failed', { cause });
};

test('isRetryableError: fetch failed 的 cause 链可识别', () => {
  // 198 上实际出现的形态：undici ConnectTimeoutError
  assert.equal(isRetryableError(makeFetchFailed({
    name: 'ConnectTimeoutError',
    code: 'UND_ERR_CONNECT_TIMEOUT',
    message: 'Connect Timeout Error (attempted address: api.example.com:443, timeout: 10000ms)',
  })), true);
  // cause.code 在原有白名单里，但顶层 TypeError 无 code
  assert.equal(isRetryableError(makeFetchFailed({ code: 'ECONNRESET', message: 'read ECONNRESET' })), true);
  assert.equal(isRetryableError(makeFetchFailed({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.example.com' })), true);
  // 多层 cause 嵌套
  assert.equal(isRetryableError(new TypeError('fetch failed', {
    cause: makeFetchFailed({ code: 'EAI_AGAIN' }),
  })), true);
});

test('isRetryableError: 无 cause 的普通 TypeError 与空值不重试', () => {
  assert.equal(isRetryableError(new TypeError('x is not a function')), false);
  assert.equal(isRetryableError(new TypeError('fetch failed')), false);
  assert.equal(isRetryableError(null), false);
  assert.equal(isRetryableError(undefined), false);
});

test('withRetry: fetch failed 会按配置次数重试', async () => {
  let calls = 0;
  const retries = [];
  const fn = async () => {
    calls += 1;
    throw makeFetchFailed({ name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' });
  };
  await assert.rejects(
    () => withRetry(fn, { retries: 2, baseDelay: 1, sleep: async () => {}, onRetry: (info) => retries.push(info.attempt) }),
    /fetch failed/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(retries, [1, 2]);
});

test('withRetry: fetch failed 后重试成功即返回结果', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw makeFetchFailed({ code: 'ECONNRESET' });
    return 'recovered';
  }, { retries: 2, baseDelay: 1, sleep: async () => {} });
  assert.equal(result, 'recovered');
  assert.equal(calls, 2);
});

test('withRetry: 401 等不可重试错误仍然只调用一次', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => {
      calls += 1;
      throw Object.assign(new Error('401 Unauthorized'), { status: 401 });
    }, { retries: 2, baseDelay: 1, sleep: async () => {} }),
    /401/,
  );
  assert.equal(calls, 1);
});
