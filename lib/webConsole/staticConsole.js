export function createStaticConsole(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const publicDir = String(options.publicDir || '');
  const helpDiyUploadDir = String(options.helpDiyUploadDir || '');
  const sendText = typeof options.sendText === 'function' ? options.sendText : (() => {});
  const sendBinary = typeof options.sendBinary === 'function' ? options.sendBinary : (() => {});
  const sendRedirect = typeof options.sendRedirect === 'function' ? options.sendRedirect : (() => {});
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

  function serveStatic(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
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
    const mimeMap = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml; charset=utf-8',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    if (mimeMap[ext]) {
      sendText(res, fs.readFileSync(targetPath, 'utf8'), 200, contentType);
      return;
    }
    sendBinary(res, fs.readFileSync(targetPath), 200, {
      'Content-Type': contentType,
    });
  }

  return {
    serveStatic,
  };
}
