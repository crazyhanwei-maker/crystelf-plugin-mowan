import dns from 'dns/promises';
import net from 'net';

function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function parseIpv4ToInt(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return null;
    }
    value = (value << 8) + num;
  }
  return value >>> 0;
}

function isIpv4InCidr(ip, base, prefix) {
  const ipValue = parseIpv4ToInt(ip);
  const baseValue = parseIpv4ToInt(base);
  if (ipValue === null || baseValue === null) {
    return false;
  }
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipValue & mask) === (baseValue & mask);
}

function isLoopbackHostname(value = '') {
  const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host === '0:0:0:0:0:0:0:1'
    || host.startsWith('127.');
}

function isBlockedProxyIpAddress(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const ipType = net.isIP(normalized);
  if (!ipType) {
    return false;
  }

  if (ipType === 4) {
    return isIpv4InCidr(normalized, '0.0.0.0', 8)
      || isIpv4InCidr(normalized, '10.0.0.0', 8)
      || isIpv4InCidr(normalized, '100.64.0.0', 10)
      || isIpv4InCidr(normalized, '127.0.0.0', 8)
      || isIpv4InCidr(normalized, '169.254.0.0', 16)
      || isIpv4InCidr(normalized, '172.16.0.0', 12)
      || isIpv4InCidr(normalized, '192.168.0.0', 16)
      || isIpv4InCidr(normalized, '198.18.0.0', 15);
  }

  if (normalized === '::' || normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    return net.isIP(mappedIpv4) === 4 ? isBlockedProxyIpAddress(mappedIpv4) : true;
  }
  if (/^fe[89ab]/.test(normalized)) {
    return true;
  }
  if (/^f[cd]/.test(normalized)) {
    return true;
  }
  if (/^ff/.test(normalized)) {
    return true;
  }
  return false;
}

function isBlockedProxyHostname(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) {
    return true;
  }
  if (isLoopbackHostname(normalized)) {
    return true;
  }
  return normalized.endsWith('.localhost');
}

function buildImageProxyHeaders(targetUrl) {
  let referer = targetUrl;
  let origin = '';
  try {
    const parsed = new URL(targetUrl);
    referer = `${parsed.origin}/`;
    origin = parsed.origin;
  } catch {
    // Ignore invalid URLs and fall back to the original target string.
  }
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: referer,
    ...(origin ? { Origin: origin } : {}),
  };
}

function isRedirectResponseStatusSafe(statusCode = 0) {
  return [301, 302, 303, 307, 308].includes(Number(statusCode || 0));
}

export function createRemoteImageProxy(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function' ? options.createHttpError : createHttpErrorFallback;
  const timeoutMs = Number(options.timeoutMs || 10000);
  const maxBytes = Number(options.maxBytes || 15 * 1024 * 1024);
  const maxRedirects = Number(options.maxRedirects || 3);

  async function assertSafeTarget(targetUrl) {
    let parsed;
    try {
      parsed = new URL(String(targetUrl || '').trim());
    } catch {
      throw createHttpError(400, 'Invalid image URL.', 'IMAGE_PROXY_INVALID_URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw createHttpError(400, 'Only http/https image URLs are allowed.', 'IMAGE_PROXY_INVALID_PROTOCOL');
    }
    if (parsed.username || parsed.password) {
      throw createHttpError(400, 'Image URL credentials are not allowed.', 'IMAGE_PROXY_INVALID_CREDENTIALS');
    }

    const hostname = String(parsed.hostname || '').trim().toLowerCase();
    if (!hostname) {
      throw createHttpError(400, 'Missing image host.', 'IMAGE_PROXY_MISSING_HOST');
    }
    if (isBlockedProxyHostname(hostname) || isBlockedProxyIpAddress(hostname)) {
      throw createHttpError(403, 'Refusing to proxy local or private network image URLs.', 'IMAGE_PROXY_PRIVATE_TARGET');
    }

    let records = [];
    try {
      records = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw createHttpError(502, 'Failed to resolve image host.', 'IMAGE_PROXY_DNS_LOOKUP_FAILED');
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw createHttpError(502, 'Failed to resolve image host.', 'IMAGE_PROXY_DNS_LOOKUP_FAILED');
    }
    if (records.some(record => isBlockedProxyIpAddress(record?.address))) {
      throw createHttpError(403, 'Refusing to proxy local or private network image URLs.', 'IMAGE_PROXY_PRIVATE_TARGET');
    }

    return parsed.toString();
  }

  function normalizeFetchError(error) {
    if (error?.statusCode) {
      return error;
    }
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return createHttpError(504, 'Remote image request timed out.', 'IMAGE_PROXY_TIMEOUT');
    }
    return createHttpError(502, 'Failed to fetch remote image.', 'IMAGE_PROXY_FETCH_FAILED');
  }

  async function closeResponseBody(response) {
    if (!response?.body || typeof response.body.cancel !== 'function') {
      return;
    }
    try {
      await response.body.cancel();
    } catch {
      // Ignore cancellation failures after the response has already completed.
    }
  }

  async function fetchResponse(targetUrl) {
    let currentUrl = await assertSafeTarget(targetUrl);

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      let response;
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          headers: buildImageProxyHeaders(currentUrl),
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw normalizeFetchError(error);
      }

      if (!isRedirectResponseStatusSafe(response.status)) {
        return { response, finalUrl: currentUrl };
      }

      await closeResponseBody(response);

      if (redirectCount >= maxRedirects) {
        throw createHttpError(502, 'Remote image redirected too many times.', 'IMAGE_PROXY_TOO_MANY_REDIRECTS');
      }

      const location = String(response.headers.get('location') || '').trim();
      if (!location) {
        throw createHttpError(502, 'Remote image redirect is missing a location header.', 'IMAGE_PROXY_BAD_REDIRECT');
      }

      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw createHttpError(502, 'Remote image returned an invalid redirect target.', 'IMAGE_PROXY_BAD_REDIRECT');
      }
      currentUrl = await assertSafeTarget(nextUrl);
    }

    throw createHttpError(502, 'Remote image redirected too many times.', 'IMAGE_PROXY_TOO_MANY_REDIRECTS');
  }

  async function readBuffer(response) {
    if (!response?.body || typeof response.body.getReader !== 'function') {
      try {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.length > maxBytes) {
          throw createHttpError(413, `Remote image exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit.`, 'IMAGE_PROXY_TOO_LARGE');
        }
        return buffer;
      } catch (error) {
        throw normalizeFetchError(error);
      }
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    try {
      let reading = true;
      while (reading) {
        const { done, value } = await reader.read();
        if (done) {
          reading = false;
          continue;
        }
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // Ignore cancellation errors after enforcing the size limit.
          }
          throw createHttpError(413, `Remote image exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit.`, 'IMAGE_PROXY_TOO_LARGE');
        }
        chunks.push(chunk);
      }
    } catch (error) {
      throw normalizeFetchError(error);
    } finally {
      try {
        reader.releaseLock?.();
      } catch {
        // Ignore release failures from already-closed streams.
      }
    }

    return Buffer.concat(chunks, totalBytes);
  }

  async function proxyImage(targetUrl) {
    const { response } = await fetchResponse(targetUrl);
    if (!response.ok) {
      await closeResponseBody(response);
      throw createHttpError(
        response.status >= 400 && response.status < 500 ? response.status : 502,
        `Remote image request failed with HTTP ${response.status}.`,
        'IMAGE_PROXY_BAD_STATUS',
      );
    }
    const contentType = String(response.headers.get('content-type') || 'application/octet-stream');
    return {
      buffer: await readBuffer(response),
      contentType,
    };
  }

  function normalizeImageContentType(contentType = '') {
    const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (!normalized.startsWith('image/')) {
      throw createHttpError(415, 'Remote image URL did not return image content.', 'IMAGE_PROXY_INVALID_CONTENT_TYPE');
    }
    return normalized || 'application/octet-stream';
  }

  return {
    assertSafeTarget,
    fetchResponse,
    proxyImage,
    normalizeImageContentType,
  };
}
