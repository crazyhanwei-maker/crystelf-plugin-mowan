export function createStaticConsole(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const publicDir = String(options.publicDir || '');
  const vendorRoots = Object.fromEntries(Object.entries(options.vendorRoots || {})
    .map(([key, value]) => [String(key || '').trim(), path.resolve(String(value || ''))])
    .filter(([key, value]) => key && value));
  const helpDiyUploadDir = String(options.helpDiyUploadDir || '');
  const sendText = typeof options.sendText === 'function' ? options.sendText : (() => {});
  const sendBinary = typeof options.sendBinary === 'function' ? options.sendBinary : (() => {});
  const sendRedirect = typeof options.sendRedirect === 'function' ? options.sendRedirect : (() => {});
  const getSecurityHeaders = typeof options.getSecurityHeaders === 'function'
    ? options.getSecurityHeaders
    : (() => ({}));
  const isPathInsideRoot = typeof options.isPathInsideRoot === 'function'
    ? options.isPathInsideRoot
    : (() => false);
  const isBootstrapSetupRequest = typeof options.isBootstrapSetupRequest === 'function'
    ? options.isBootstrapSetupRequest
    : (() => false);
  const isAuthorized = typeof options.isAuthorized === 'function' ? options.isAuthorized : (() => false);
  const normalizeWebConsoleRedirectPath = typeof options.normalizeWebConsoleRedirectPath === 'function'
    ? options.normalizeWebConsoleRedirectPath
    : (() => '/index.html');
  const cacheableStaticExtensions = new Set([
    '.css', '.js', '.mjs', '.map', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf',
  ]);

  function getContentType(ext = '') {
    const mimeMap = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.map': 'application/json; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }

  function isTextStaticContent(ext = '') {
    return ['.html', '.css', '.js', '.mjs', '.json', '.svg'].includes(ext);
  }

  function isVersionableHtmlResource(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.startsWith('#')) {
      return false;
    }
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(normalized)) {
      return false;
    }
    const resourcePath = normalized.split(/[?#]/, 1)[0];
    const ext = path.extname(resourcePath).toLowerCase();
    return ext === '.css' || ext === '.js' || ext === '.mjs';
  }

  function getStaticResourceVersion(value = '') {
    if (!isVersionableHtmlResource(value)) {
      return '';
    }

    const cleanValue = String(value || '').trim().split(/[?#]/, 1)[0];
    const candidatePath = cleanValue.startsWith('/')
      ? path.join(publicDir, cleanValue.slice(1))
      : path.join(publicDir, cleanValue);
    const targetPath = path.normalize(candidatePath);
    if (!isPathInsideRoot(targetPath, publicDir) || !fs.existsSync(targetPath)) {
      return '';
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
      return '';
    }
    return `${Math.floor(Number(stat.mtimeMs || 0)).toString(36)}-${Number(stat.size || 0).toString(36)}`;
  }

  function appendStaticResourceVersion(value = '') {
    const normalized = String(value || '').trim();
    const version = getStaticResourceVersion(normalized);
    if (!version) {
      return value;
    }

    const hashIndex = normalized.indexOf('#');
    const base = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
    const hash = hashIndex >= 0 ? normalized.slice(hashIndex) : '';
    const [pathAndQuery, existingQuery = ''] = base.split('?', 2);
    const params = new URLSearchParams(existingQuery);
    params.set('v', version);
    return `${pathAndQuery}?${params.toString()}${hash}`;
  }

  function injectStaticResourceVersions(html = '') {
    return String(html || '').replace(
      /\b(src|href)=(["'])([^"']+\.(?:css|js|mjs)(?:[?#][^"']*)?)\2/gi,
      (match, attribute, quote, value) => {
        const versionedValue = appendStaticResourceVersion(value);
        if (versionedValue === value) {
          return match;
        }
        return `${attribute}=${quote}${versionedValue}${quote}`;
      },
    );
  }

  function createWeakEtag(stat) {
    const size = Number(stat?.size || 0).toString(16);
    const mtime = Math.floor(Number(stat?.mtimeMs || 0)).toString(16);
    return `W/"${size}-${mtime}"`;
  }

  function etagMatches(headerValue = '', etag = '') {
    if (!headerValue || !etag) {
      return false;
    }
    return String(headerValue)
      .split(',')
      .map(item => item.trim())
      .some(item => item === '*' || item === etag);
  }

  function isStaticCacheFresh(req, stat, etag = '') {
    const ifNoneMatch = String(req?.headers?.['if-none-match'] || '').trim();
    if (ifNoneMatch) {
      return etagMatches(ifNoneMatch, etag);
    }

    const ifModifiedSince = String(req?.headers?.['if-modified-since'] || '').trim();
    if (!ifModifiedSince) {
      return false;
    }
    const sinceTime = Date.parse(ifModifiedSince);
    if (!Number.isFinite(sinceTime)) {
      return false;
    }
    return Math.floor(Number(stat?.mtimeMs || 0) / 1000) * 1000 <= sinceTime;
  }

  function buildStaticHeaders(req, targetPath, contentType, stat) {
    const ext = path.extname(targetPath).toLowerCase();
    const cacheable = cacheableStaticExtensions.has(ext);
    const privateCache = isPathInsideRoot(targetPath, helpDiyUploadDir);
    // css/js/mjs 的引用 URL 带 mtime+size 版本号（文件一变 URL 即变），可安全走长缓存；
    // 其余可缓存资源（图片/字体）无版本化机制，维持 no-cache + ETag 协商
    const immutableVersioned = ['.css', '.js', '.mjs'].includes(ext);
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': !cacheable
        ? 'no-store'
        : immutableVersioned
          ? `${privateCache ? 'private' : 'public'}, max-age=86400`
          : `${privateCache ? 'private' : 'public'}, no-cache, must-revalidate`,
      ...getSecurityHeaders(contentType),
    };
    if (cacheable) {
      headers.ETag = createWeakEtag(stat);
      headers['Last-Modified'] = stat.mtime.toUTCString();
      headers.Vary = 'Accept-Encoding';
    }
    return headers;
  }

  function sendNotModified(res, headers = {}) {
    const { 'Content-Type': _contentType, ...notModifiedHeaders } = headers;
    res.writeHead(304, notModifiedHeaders);
    res.end();
  }

  function resolveVendorPath(pathname = '') {
    const match = String(pathname || '').match(/^\/vendor\/([A-Za-z0-9_-]+)\/(.+)$/);
    if (!match) return '';
    const root = vendorRoots[match[1]];
    if (!root) return '';
    let relativePath = '';
    try {
      relativePath = decodeURIComponent(match[2]);
    } catch {
      return '';
    }
    if (!relativePath || relativePath.includes('\0')) return '';
    const targetPath = path.normalize(path.join(root, relativePath));
    return isPathInsideRoot(targetPath, root) ? targetPath : '';
  }

  function serveStatic(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const vendorPath = resolveVendorPath(pathname);
    if (vendorPath) {
      if (!isAuthorized(req)) {
        sendText(res, 'Unauthorized', 401);
        return;
      }
      if (!fs.existsSync(vendorPath) || fs.statSync(vendorPath).isDirectory()) {
        sendText(res, 'Not Found', 404);
        return;
      }
      const stat = fs.statSync(vendorPath);
      const ext = path.extname(vendorPath).toLowerCase();
      const headers = buildStaticHeaders(req, vendorPath, getContentType(ext), stat);
      if (headers.ETag && isStaticCacheFresh(req, stat, headers.ETag)) {
        sendNotModified(res, headers);
        return;
      }
      if (isTextStaticContent(ext)) {
        sendText(res, fs.readFileSync(vendorPath, 'utf8'), 200, getContentType(ext), headers);
      } else {
        sendBinary(res, fs.readFileSync(vendorPath), 200, headers);
      }
      return;
    }
    let resolvedPathname = pathname;
    if (!path.extname(resolvedPathname)) {
      const htmlCandidate = path.join(publicDir, `${resolvedPathname}.html`);
      if (fs.existsSync(htmlCandidate) && fs.statSync(htmlCandidate).isFile()) {
        resolvedPathname = `${resolvedPathname}.html`;
      }
    }
    const targetPath = path.normalize(path.join(publicDir, resolvedPathname));
    if (!isPathInsideRoot(targetPath, publicDir)) {
      sendText(res, 'Forbidden', 403);
      return;
    }
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      sendText(res, 'Not Found', 404);
      return;
    }

    const ext = path.extname(targetPath).toLowerCase();
    const bootstrapMode = isBootstrapSetupRequest(req);
    if (isPathInsideRoot(targetPath, helpDiyUploadDir) && !isAuthorized(req)) {
      sendText(res, 'Unauthorized', 401);
      return;
    }
    if (ext === '.html' && bootstrapMode) {
      if (resolvedPathname !== '/plugin-settings.html') {
        sendRedirect(res, '/plugin-settings.html?bootstrap=1');
        return;
      }
    }
    if (ext === '.html' && !bootstrapMode && resolvedPathname !== '/login.html' && !isAuthorized(req)) {
      const redirectTarget = normalizeWebConsoleRedirectPath(`${pathname}${url.search || ''}`);
      sendRedirect(res, `/login.html?redirect=${encodeURIComponent(redirectTarget)}`);
      return;
    }
    if (ext === '.html' && resolvedPathname === '/login.html' && isAuthorized(req)) {
      sendRedirect(res, normalizeWebConsoleRedirectPath(url.searchParams.get('redirect') || '/index.html'));
      return;
    }
    const stat = fs.statSync(targetPath);
    const contentType = getContentType(ext);
    const headers = buildStaticHeaders(req, targetPath, contentType, stat);
    if (headers.ETag && isStaticCacheFresh(req, stat, headers.ETag)) {
      sendNotModified(res, headers);
      return;
    }

    if (isTextStaticContent(ext)) {
      const content = fs.readFileSync(targetPath, 'utf8');
      sendText(res, ext === '.html' ? injectStaticResourceVersions(content) : content, 200, contentType, headers);
      return;
    }
    sendBinary(res, fs.readFileSync(targetPath), 200, headers);
  }

  return {
    serveStatic,
  };
}
