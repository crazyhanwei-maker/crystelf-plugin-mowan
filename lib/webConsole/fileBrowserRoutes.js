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
  } = options;

  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/file-browser/tree') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, buildFileBrowserTreePayload(url.searchParams.get('path') || ''));
      } catch (error) {
        sendRouteError(res, error, 500, { includeDetails: true });
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/read') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, readFileBrowserFile(url.searchParams.get('path') || ''));
      } catch (error) {
        sendRouteError(res, error, 500, { includeDetails: true });
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/node') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, buildFileBrowserNodePayload(url.searchParams.get('path') || ''));
      } catch (error) {
        sendRouteError(res, error, 500, { includeDetails: true });
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/search') {
      if (rejectReadOnly(res)) return true;
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
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, buildFileBrowserHighlightPayload(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/create-directory' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, createFileBrowserDirectory(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/rename' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, renameFileBrowserNode(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/copy-file' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, copyFileBrowserFile(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/delete' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, deleteFileBrowserNode(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/create-file' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, createFileBrowserFile(body));
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    if (url.pathname === '/api/file-browser/upload' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
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
    if (url.pathname === '/api/file-browser/write' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
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
