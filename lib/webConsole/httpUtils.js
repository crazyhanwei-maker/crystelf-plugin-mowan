export function createWebConsoleHttpUtils(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const crypto = options.crypto;
  const zlib = options.zlib;
  const requestBodyMaxBytes = Math.max(1, Number(options.requestBodyMaxBytes || 8 * 1024 * 1024) || (8 * 1024 * 1024));
  // 小于该字节数的响应不值得压缩（CPU 开销大于收益）
  const gzipMinBytes = Math.max(0, Number(options.gzipMinBytes ?? 1024));

  function getSecurityHeaders(contentType = '') {
    const headers = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };

    if (String(contentType || '').startsWith('text/html')) {
      headers['Content-Security-Policy'] = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        "connect-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join('; ');
    }

    return headers;
  }

  function acceptsGzip(res) {
    if (!zlib || typeof zlib.gzipSync !== 'function') return false;
    return /\bgzip\b/i.test(String(res?.req?.headers?.['accept-encoding'] || ''));
  }

  // 压缩只对 JSON/文本类生效；已带 Content-Encoding 的（如代理透传）跳过
  function writeBody(res, buffer, statusCode, headers, contentType) {
    let payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
    const compressible = /json|text|javascript|svg/i.test(String(contentType || ''));
    if (compressible && acceptsGzip(res) && payload.length >= gzipMinBytes && !headers['Content-Encoding']) {
      try {
        const compressed = zlib.gzipSync(payload, { level: 5 });
        if (compressed.length < payload.length) {
          res.writeHead(statusCode, {
            ...headers,
            'Content-Encoding': 'gzip',
            'Content-Length': String(compressed.length),
          });
          res.end(compressed);
          return;
        }
      } catch {
        // 压缩失败回退原文
      }
    }
    res.writeHead(statusCode, {
      ...headers,
      'Content-Length': String(payload.length),
    });
    res.end(payload);
  }

  function sendJson(res, payload, statusCode = 200, headers = {}) {
    const contentType = 'application/json; charset=utf-8';
    const body = JSON.stringify(payload, null, 2);
    writeBody(res, body, statusCode, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      ...getSecurityHeaders(contentType),
      ...headers,
    }, contentType);
  }

  function sendText(res, content, statusCode = 200, contentType = 'text/plain; charset=utf-8', headers = {}) {
    writeBody(res, String(content ?? ''), statusCode, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      ...getSecurityHeaders(contentType),
      ...headers,
    }, contentType);
  }

  function sendRedirect(res, location, statusCode = 302, headers = {}) {
    res.writeHead(statusCode, {
      Location: location,
      'Cache-Control': 'no-store',
      ...getSecurityHeaders('text/html; charset=utf-8'),
      ...headers,
    });
    res.end();
  }

  function sendBinary(res, buffer, statusCode = 200, headers = {}) {
    // 二进制（图片等）已压缩格式居多，不做 gzip，仅补 Content-Length
    const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    res.writeHead(statusCode, {
      'Cache-Control': 'no-store',
      ...getSecurityHeaders(),
      ...headers,
      'Content-Length': String(payload.length),
    });
    res.end(payload);
  }

  function createHttpError(statusCode = 500, message = 'Internal Server Error', code = '') {
    const error = new Error(String(message || 'Internal Server Error'));
    error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
    if (code) {
      error.code = String(code);
    }
    return error;
  }

  function getHttpErrorStatus(error, fallbackStatus = 500) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode >= 400 && statusCode <= 599) {
      return statusCode;
    }
    return fallbackStatus;
  }

  function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let settled = false;
      let totalBytes = 0;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      req.on('data', chunk => {
        if (settled) return;
        totalBytes += Buffer.byteLength(chunk);
        if (totalBytes > requestBodyMaxBytes) {
          const error = createHttpError(413, `请求体过大，最大允许 ${Math.round(requestBodyMaxBytes / 1024 / 1024)}MB`, 'REQUEST_BODY_TOO_LARGE');
          req.destroy(error);
          fail(error);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (settled) return;
        settled = true;
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', fail);
    });
  }

  function readRawBody(req, maxBytes = requestBodyMaxBytes) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let settled = false;
      let totalBytes = 0;
      const limit = Math.max(1, Number(maxBytes) || requestBodyMaxBytes);
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      req.on('data', chunk => {
        if (settled) return;
        totalBytes += chunk.length;
        if (totalBytes > limit) {
          const error = createHttpError(413, `请求体过大，最大允许 ${Math.round(limit / 1024 / 1024)}MB`, 'REQUEST_BODY_TOO_LARGE');
          req.destroy(error);
          fail(error);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      req.on('error', fail);
    });
  }

  function safeReadJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) {
        return fallback;
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }

  function safeWriteJson(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = path.join(
      dir,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
    );
    try {
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
      throw error;
    }
  }

  function normalizePathForComparison(value = '') {
    const normalized = path.resolve(String(value || ''));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  function isPathInsideRoot(targetPath = '', rootPath = '') {
    const normalizedTarget = normalizePathForComparison(targetPath);
    const normalizedRoot = normalizePathForComparison(rootPath);
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
  }

  function getRealPathSafe(targetPath = '') {
    try {
      return fs.realpathSync.native(targetPath);
    } catch {
      try {
        return fs.realpathSync(targetPath);
      } catch {
        return '';
      }
    }
  }

  function findNearestExistingParent(targetPath = '') {
    let current = path.resolve(String(targetPath || '.'));
    while (current) {
      if (fs.existsSync(current)) {
        return current;
      }
      const parent = path.dirname(current);
      if (!parent || parent === current) {
        return '';
      }
      current = parent;
    }
    return '';
  }

  function ensurePathResolvedWithinRoot(targetPath = '', rootPath = '', options = {}) {
    const allowMissing = options.allowMissing === true;
    const rootRealPath = getRealPathSafe(rootPath) || path.resolve(rootPath);
    const probePath = fs.existsSync(targetPath)
      ? path.resolve(targetPath)
      : allowMissing
        ? findNearestExistingParent(targetPath)
        : '';
    const resolvedProbePath = probePath
      ? (getRealPathSafe(probePath) || path.resolve(probePath))
      : path.resolve(targetPath);

    if (!isPathInsideRoot(resolvedProbePath, rootRealPath)) {
      throw createHttpError(400, '文件路径越界', 'FILE_BROWSER_PATH_OUT_OF_RANGE');
    }

    return {
      rootRealPath,
      resolvedProbePath,
    };
  }

  return {
    getSecurityHeaders,
    sendJson,
    sendText,
    sendRedirect,
    sendBinary,
    createHttpError,
    getHttpErrorStatus,
    parseRequestBody,
    readRawBody,
    safeReadJson,
    safeWriteJson,
    normalizePathForComparison,
    isPathInsideRoot,
    getRealPathSafe,
    findNearestExistingParent,
    ensurePathResolvedWithinRoot,
  };
}
