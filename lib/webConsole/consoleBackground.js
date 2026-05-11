import fs from 'fs';
import path from 'path';

export function createConsoleBackground(options = {}) {
  const cacheDir = options.cacheDir || path.join(process.cwd(), 'temp', 'web-console-background');
  const cacheFile = options.cacheFile || path.join(cacheDir, 'current-image.bin');
  const cacheMetaFile = options.cacheMetaFile || path.join(cacheDir, 'current-image.json');
  const defaultSourceUrl = options.defaultSourceUrl || '';
  const bundledFallbackImagePath = options.bundledFallbackImagePath || '';
  const getConfig = typeof options.getConfig === 'function' ? options.getConfig : () => ({});
  const safeReadJson = typeof options.safeReadJson === 'function' ? options.safeReadJson : (() => null);
  const safeWriteJson = typeof options.safeWriteJson === 'function' ? options.safeWriteJson : (() => {});
  const proxyRemoteImage = typeof options.proxyRemoteImage === 'function'
    ? options.proxyRemoteImage
    : async () => {
      throw new Error('Remote image proxy is not configured');
    };
  const normalizeImageContentType = typeof options.normalizeImageContentType === 'function'
    ? options.normalizeImageContentType
    : (value = '') => String(value || 'application/octet-stream');
  const sendBinary = typeof options.sendBinary === 'function'
    ? options.sendBinary
    : ((res, buffer, statusCode = 200, headers = {}) => {
      res.writeHead(statusCode, headers);
      res.end(buffer);
    });
  const logger = {
    warn: (...args) => console.warn(...args),
    ...(options.logger || {}),
  };

  function ensureCacheDir() {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  function normalizeSourceUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return '';
      }
      if (parsed.username || parsed.password) {
        return '';
      }
      return parsed.toString();
    } catch {
      return '';
    }
  }

  function getContentTypeByPath(filePath = '') {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    const contentTypeMap = {
      '.gif': 'image/gif',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    };
    return contentTypeMap[ext] || 'application/octet-stream';
  }

  function readBundledFallbackImage() {
    const filePath = String(bundledFallbackImagePath || '').trim();
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    const buffer = fs.readFileSync(filePath);
    return {
      buffer,
      contentType: getContentTypeByPath(filePath),
    };
  }

  function getSourceUrl() {
    const config = getConfig() || {};
    return normalizeSourceUrl(
      config.webConsoleBackgroundSourceUrl === undefined
        ? defaultSourceUrl
        : config.webConsoleBackgroundSourceUrl,
    );
  }

  function readCacheMeta() {
    const meta = safeReadJson(cacheMetaFile, null);
    if (!meta || !fs.existsSync(cacheFile)) {
      return null;
    }
    return meta;
  }

  async function refreshCache() {
    ensureCacheDir();
    const sourceUrl = getSourceUrl();
    if (!sourceUrl) {
      return writeFallbackCache({ reason: 'source_empty' });
    }
    const targetUrl = `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}_r=${Date.now()}`;
    try {
      const result = await proxyRemoteImage(targetUrl);
      const contentType = normalizeImageContentType(result.contentType);
      fs.writeFileSync(cacheFile, result.buffer);
      const meta = {
        sourceUrl,
        contentType,
        size: result.buffer.length,
        updatedAt: new Date().toISOString(),
        version: Date.now(),
      };
      safeWriteJson(cacheMetaFile, meta);
      return meta;
    } catch (error) {
      logger.warn(`[webConsole] 控制台壁纸源刷新失败，改用本地动态壁纸: ${error.message}`);
      return writeFallbackCache({ reason: error.message || 'remote_failed' });
    }
  }

  function buildFallbackSvg(version = Date.now()) {
    const palettes = [
      ['#f4f7fb', '#d8e9ff', '#7aa7ff', '#fb7185'],
      ['#f8fafc', '#d9f99d', '#22c55e', '#0ea5e9'],
      ['#fff7ed', '#fed7aa', '#f97316', '#2563eb'],
      ['#fdf2f8', '#fbcfe8', '#db2777', '#14b8a6'],
      ['#f5f3ff', '#ddd6fe', '#7c3aed', '#f59e0b'],
    ];
    const palette = palettes[Math.abs(Number(version || 0)) % palettes.length] || palettes[0];
    const [base, soft, primary, accent] = palette;
    const seed = Math.abs(Number(version || 0));
    const offset = seed % 220;
    const wave = 120 + (seed % 80);
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">',
      '<defs>',
      `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${soft}"/></linearGradient>`,
      `<linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${primary}" stop-opacity=".78"/><stop offset="1" stop-color="${accent}" stop-opacity=".72"/></linearGradient>`,
      '</defs>',
      '<rect width="1600" height="900" fill="url(#bg)"/>',
      `<path d="M0 ${620 - offset / 4} C260 ${460 - offset / 5}, 470 ${760 - offset / 6}, 760 ${610 + offset / 8} S1270 ${360 + offset / 3}, 1600 ${500 + offset / 7} L1600 900 L0 900 Z" fill="url(#ribbon)" opacity=".88"/>`,
      `<path d="M0 ${wave} C260 ${wave + 120}, 430 ${wave - 80}, 690 ${wave + 40} S1210 ${wave + 140}, 1600 ${wave + 20}" fill="none" stroke="${primary}" stroke-opacity=".18" stroke-width="42"/>`,
      `<path d="M180 150 L1420 ${120 + offset / 5}" stroke="${accent}" stroke-opacity=".18" stroke-width="3"/>`,
      `<circle cx="${260 + offset}" cy="${220 + (offset % 90)}" r="170" fill="${primary}" opacity=".12"/>`,
      `<circle cx="${1220 - offset / 2}" cy="${210 + (offset % 120)}" r="230" fill="${accent}" opacity=".13"/>`,
      `<rect x="${1040 - offset / 3}" y="590" width="340" height="140" rx="28" fill="#ffffff" opacity=".20"/>`,
      '</svg>',
    ].join('');
  }

  function writeFallbackCache(options = {}) {
    ensureCacheDir();
    const version = Date.now();
    const bundledFallbackImage = readBundledFallbackImage();
    const buffer = bundledFallbackImage?.buffer || Buffer.from(buildFallbackSvg(version), 'utf8');
    const contentType = bundledFallbackImage?.contentType || 'image/svg+xml';
    const meta = {
      sourceUrl: bundledFallbackImage ? 'bundled-console-wallpaper' : 'local-dynamic-fallback',
      contentType,
      size: buffer.length,
      updatedAt: new Date().toISOString(),
      version,
      fallback: true,
      fallbackType: bundledFallbackImage ? 'bundled-wallpaper' : 'svg-gradient',
      fallbackReason: String(options.reason || ''),
    };
    fs.writeFileSync(cacheFile, buffer);
    safeWriteJson(cacheMetaFile, meta);
    return meta;
  }

  async function ensureCache() {
    const cached = readCacheMeta();
    if (cached) {
      return cached;
    }
    try {
      return await refreshCache();
    } catch (error) {
      logger.warn(`[webConsole] 刷新控制台背景图缓存失败，已回退到本地默认背景图: ${error.message}`);
      return writeFallbackCache();
    }
  }

  async function readCache() {
    const meta = await ensureCache();
    return {
      meta,
      buffer: fs.readFileSync(cacheFile),
    };
  }

  async function serveImage(res) {
    const { meta, buffer } = await readCache();
    return sendBinary(res, buffer, 200, {
      'Content-Type': meta.contentType,
      'Content-Length': buffer.length,
      'X-Console-Background-Updated-At': meta.updatedAt,
      'X-Console-Background-Version': String(meta.version || ''),
    });
  }

  return {
    normalizeSourceUrl,
    getSourceUrl,
    refreshCache,
    readCache,
    serveImage,
  };
}
