export function createWebConsoleAuditLog(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const auditLogFile = String(options.auditLogFile || '');
  const auditLogMaxBytes = Math.max(64 * 1024, Number(options.auditLogMaxBytes || 2 * 1024 * 1024) || (2 * 1024 * 1024));
  const logger = options.logger || { warn: () => {} };
  const getClientIp = typeof options.getClientIp === 'function'
    ? options.getClientIp
    : (req => String(req?.socket?.remoteAddress || '').trim());

  const auditMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const skipPaths = new Set([
    '/api/dependencies/install-precheck',
    '/api/config-restore-preview',
    '/api/file-browser/highlight',
    '/api/logs/diagnose',
    '/api/sandbox-web-read',
  ]);
  const sensitivePathPattern = /(?:login|logout|save|write|delete|clear|restore|install|upload|cleanup|reset|rollback|approve|reject|fix|toggle|mkdir|rename|create|send)(?:$|[/?-])/i;

  function sanitizeHeader(value = '', maxLength = 240) {
    return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, maxLength);
  }

  function normalizeAuditPath(value = '') {
    return String(value || '').trim().replace(/\/{2,}/g, '/');
  }

  function getAuditAction(pathname = '') {
    const pathValue = normalizeAuditPath(pathname);
    if (pathValue === '/api/auth/login') return 'auth_login';
    if (pathValue === '/api/auth/logout') return 'auth_logout';
    if (pathValue.includes('/file-browser/write')) return 'file_write';
    if (pathValue.includes('/file-browser/delete')) return 'file_delete';
    if (pathValue.includes('/file-browser/rename')) return 'file_rename';
    if (pathValue.includes('/file-browser/mkdir')) return 'file_mkdir';
    if (pathValue.includes('/file-browser/create')) return 'file_create';
    if (pathValue.includes('/plugin-catalog/install')) return 'plugin_install';
    if (pathValue.includes('/bot-plugins/delete')) return 'plugin_delete';
    if (pathValue.includes('/dependencies/install')) return 'dependency_install';
    if (pathValue.includes('/config-restore')) return 'config_restore';
    if (pathValue.includes('/api-settings/save')) return 'api_settings_save';
    if (pathValue.includes('/plugin-settings')) return 'plugin_settings_change';
    if (pathValue.includes('/group-management')) return 'group_management_change';
    if (pathValue.includes('/help-diy')) return 'help_diy_change';
    if (pathValue.includes('/qq-simulator')) return 'qq_simulator_change';
    if (pathValue.includes('/logs/image-monitor/cleanup')) return 'image_monitor_cleanup';
    if (pathValue.includes('/sandbox-chat')) return 'sandbox_chat';
    return pathValue.replace(/^\/api\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'api_write';
  }

  function shouldAuditWebConsoleRequest(req, url) {
    const method = String(req?.method || 'GET').toUpperCase();
    const pathname = normalizeAuditPath(url?.pathname || '');
    if (!auditMethods.has(method) || !pathname.startsWith('/api/')) {
      return false;
    }
    if (skipPaths.has(pathname)) {
      return false;
    }
    return sensitivePathPattern.test(pathname);
  }

  function rotateAuditLogIfNeeded() {
    if (!auditLogFile || !fs.existsSync(auditLogFile)) {
      return;
    }
    const stat = fs.statSync(auditLogFile);
    if (!stat.isFile() || stat.size < auditLogMaxBytes) {
      return;
    }
    const rotatedFile = `${auditLogFile}.1`;
    try {
      if (fs.existsSync(rotatedFile)) {
        fs.unlinkSync(rotatedFile);
      }
      fs.renameSync(auditLogFile, rotatedFile);
    } catch (error) {
      logger.warn(`[webConsole] Failed to rotate audit log: ${error.message}`);
    }
  }

  function appendAuditEntry(entry = {}) {
    if (!auditLogFile) {
      return;
    }
    try {
      const dir = path.dirname(auditLogFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      rotateAuditLogIfNeeded();
      fs.appendFileSync(auditLogFile, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      logger.warn(`[webConsole] Failed to append audit log: ${error.message}`);
    }
  }

  function attachWebConsoleAudit(req, res, url) {
    if (!shouldAuditWebConsoleRequest(req, url)) {
      return false;
    }

    const startedAt = Date.now();
    const pathname = normalizeAuditPath(url.pathname);
    const method = String(req.method || 'GET').toUpperCase();
    const entry = {
      time: new Date(startedAt).toISOString(),
      action: getAuditAction(pathname),
      method,
      path: pathname,
      queryKeys: Array.from(url.searchParams.keys()).sort(),
      clientIp: sanitizeHeader(getClientIp(req), 80),
      userAgent: sanitizeHeader(req?.headers?.['user-agent'] || '', 240),
      referer: sanitizeHeader(req?.headers?.referer || '', 240),
    };

    let written = false;
    const writeFinalEntry = aborted => {
      if (written) {
        return;
      }
      written = true;
      const statusCode = Number(res.statusCode || 0);
      appendAuditEntry({
        ...entry,
        statusCode,
        result: statusCode >= 200 && statusCode < 400 && !aborted ? 'success' : 'error',
        aborted: Boolean(aborted),
        durationMs: Date.now() - startedAt,
      });
    };

    res.once('finish', () => writeFinalEntry(false));
    res.once('close', () => {
      if (!res.writableEnded) {
        writeFinalEntry(true);
      }
    });
    return true;
  }

  function readAuditEntries() {
    try {
      if (!auditLogFile || !fs.existsSync(auditLogFile)) {
        return [];
      }
      return fs.readFileSync(auditLogFile, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function paginateItems(items = [], page = 1, pageSize = 20) {
    const safePageSize = Math.max(1, Math.min(100, Number(pageSize || 20) || 20));
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const safePage = Math.max(1, Math.min(totalPages, Number(page || 1) || 1));
    const start = (safePage - 1) * safePageSize;
    return {
      items: items.slice(start, start + safePageSize),
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages,
    };
  }

  function parseFilterTime(value = '') {
    const text = String(value || '').trim();
    if (!text) {
      return 0;
    }
    const time = new Date(text).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function buildWebConsoleAuditLogEntries(filters = {}) {
    const query = String(filters.query || '').trim().toLowerCase();
    const action = String(filters.action || '').trim().toLowerCase();
    const result = String(filters.result || '').trim().toLowerCase();
    const method = String(filters.method || '').trim().toUpperCase();
    const startTime = parseFilterTime(filters.startAt);
    const endTime = parseFilterTime(filters.endAt);
    const items = readAuditEntries()
      .filter(item => !action || String(item.action || '').toLowerCase().includes(action))
      .filter(item => !result || String(item.result || '').toLowerCase() === result)
      .filter(item => !method || String(item.method || '').toUpperCase() === method)
      .filter(item => {
        const timeMs = new Date(item.time || 0).getTime();
        if (startTime && (!Number.isFinite(timeMs) || timeMs < startTime)) return false;
        if (endTime && (!Number.isFinite(timeMs) || timeMs > endTime)) return false;
        return true;
      })
      .filter(item => {
        if (!query) return true;
        return [item.action, item.method, item.path, item.clientIp, item.userAgent, item.statusCode, item.result]
          .some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));

    return {
      success: true,
      logFile: auditLogFile,
      ...paginateItems(items, filters.page, filters.pageSize),
    };
  }

  return {
    attachWebConsoleAudit,
    buildWebConsoleAuditLogEntries,
    shouldAuditWebConsoleRequest,
  };
}
