import fs from 'fs';
import path from 'path';
import { createRouteUtils } from './routeUtils.js';
import { FILE_BROWSER_MAX_UPLOAD_BYTES } from './webConsoleConstants.js';

export function createFileBrowserRoutes(options = {}) {
  const {
    buildFileBrowserHighlightPayload,
    buildFileBrowserNodePayload,
    buildFileBrowserTreePayload,
    createFileBrowserDirectory,
    createFileBrowserFile,
    copyFileBrowserFile,
    deleteFileBrowserNode,
    parseRequestBody,
    readFileBrowserFile,
    readRawBody,
    renameFileBrowserNode,
    searchFileBrowserContent,
    sendJson,
    uploadFileBrowserFile,
    writeFileBrowserFile,
    resolveFileBrowserDownload,
    compressFileBrowserPaths,
    decompressFileBrowserArchive,
    buildFileBrowserBatchDownload,
  } = options;

  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  // RFC 5987：UTF-8 文件名进 filename*，ASCII 兜底进 filename（控制字符剔除）
  function buildContentDisposition(displayName = '', type = 'attachment') {
    const safeName = String(displayName || 'download').replace(/[\r\n"]/g, '');
    const fallback = safeName.replace(/[^\x20-\x7e]/g, '_') || 'download';
    return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
  }

  // 内联预览的图片 MIME 表（含 webp/avif 新格式）
  const INLINE_IMAGE_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
  };

  async function handle(req, res, url) {
    if (url.pathname === '/api/file-browser/tree') {
      if (rejectReadOnly(req, res)) return true;
      try {
        sendJson(res, buildFileBrowserTreePayload(url.searchParams.get('path') || ''));
      } catch (error) {
        sendRouteError(res, error, 500, { includeDetails: true });
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/read') {
      if (rejectReadOnly(req, res)) return true;
      try {
        sendJson(res, readFileBrowserFile(url.searchParams.get('path') || ''));
      } catch (error) {
        sendRouteError(res, error, 500, { includeDetails: true });
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/node') {
      if (rejectReadOnly(req, res)) return true;
      try {
        sendJson(res, buildFileBrowserNodePayload(url.searchParams.get('path') || ''));
      } catch (error) {
        sendRouteError(res, error, 500, { includeDetails: true });
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/search') {
      if (rejectReadOnly(req, res)) return true;
      try {
        sendJson(res, searchFileBrowserContent(url.searchParams.get('query') || '', {
          path: url.searchParams.get('path') || '',
          caseSensitive: url.searchParams.get('caseSensitive') === '1',
          limit: url.searchParams.get('limit') || '',
        }));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/highlight' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, buildFileBrowserHighlightPayload(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/create-directory' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, createFileBrowserDirectory(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/rename' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, renameFileBrowserNode(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/copy-file' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, copyFileBrowserFile(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/delete' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, deleteFileBrowserNode(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/create-file' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, createFileBrowserFile(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/upload' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const data = await readRawBody(req, FILE_BROWSER_MAX_UPLOAD_BYTES);
        sendJson(res, uploadFileBrowserFile({
          dir: url.searchParams.get('dir') || '',
          name: url.searchParams.get('name') || '',
          overwrite: url.searchParams.get('overwrite') === '1',
          data,
        }));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/download') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const download = resolveFileBrowserDownload(url.searchParams.get('path') || '');
        // inline=1 供图片预览：按扩展名给正确 MIME；CSP sandbox 阻止内联 SVG 里的脚本执行
        const inline = url.searchParams.get('inline') === '1';
        const ext = path.extname(download.displayName || '').toLowerCase();
        const imageType = INLINE_IMAGE_TYPES[ext];
        const headers = {
          'Content-Length': String(download.size || 0),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': buildContentDisposition(download.displayName, inline && imageType ? 'inline' : 'attachment'),
        };
        if (inline && imageType) {
          headers['Content-Type'] = imageType;
          headers['Content-Security-Policy'] = 'sandbox';
        } else {
          headers['Content-Type'] = 'application/octet-stream';
        }
        res.writeHead(200, headers);
        const stream = fs.createReadStream(download.absolutePath);
        stream.on('error', () => {
          res.destroy();
        });
        stream.pipe(res);
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/compress' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, compressFileBrowserPaths(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/decompress' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, decompressFileBrowserArchive(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/download-batch' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      let tempPath = '';
      try {
        const body = await parseRequestBody(req);
        const download = buildFileBrowserBatchDownload(body);
        tempPath = download.absolutePath;
        const cleanup = () => {
          try { fs.rmSync(tempPath, { force: true }); } catch { }
        };
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': String(download.size || 0),
          'Cache-Control': 'no-store',
          'Content-Disposition': buildContentDisposition(download.displayName),
          'X-Content-Type-Options': 'nosniff',
        });
        res.on('finish', cleanup);
        res.on('close', () => {
          if (!res.writableFinished) cleanup();
        });
        const stream = fs.createReadStream(download.absolutePath);
        stream.on('error', () => {
          res.destroy();
        });
        stream.pipe(res);
      } catch (error) {
        if (tempPath) {
          try { fs.rmSync(tempPath, { force: true }); } catch { }
        }
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/write' && req.method === 'POST') {
      if (rejectReadOnly(req, res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, writeFileBrowserFile(body));
      } catch (error) {
        sendRouteError(res, error, 500, { includeDetails: true });
      }
      return true;
    }
    return false;
  }

  return {
    handle,
  };
}
