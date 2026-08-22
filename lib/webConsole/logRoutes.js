import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { createRouteUtils } from './routeUtils.js';

const execFileAsync = promisify(execFile);

function parseCsvLine(line = '') {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (const char of String(line || '')) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

async function listSystemProcesses({ query = '', limit = 400 } = {}) {
  const platform = os.platform();
  const items = [];
  if (platform === 'win32') {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15000,
    });
    stdout.split(/\r?\n/).filter(Boolean).forEach(line => {
      const [name, pid, , , memoryText] = parseCsvLine(line);
      if (!name || name === '映像名称' || name === 'Image Name') return;
      const memoryKb = Number(String(memoryText || '').replace(/[^\d.]/g, '')) || 0;
      items.push({
        pid: Number(pid) || 0,
        name: String(name || '').trim(),
        cpuPercent: null,
        memoryMB: Math.round((memoryKb / 1024) * 10) / 10,
      });
    });
  } else {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,pcpu=,pmem=,rss=,comm='], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15000,
    });
    stdout.split(/\r?\n/).filter(Boolean).forEach(line => {
      const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
      if (!match) return;
      items.push({
        pid: Number(match[1]) || 0,
        name: match[5].trim(),
        cpuPercent: Math.round(Number(match[2]) * 10) / 10,
        memoryMB: Math.round((Number(match[4]) / 1024) * 10) / 10,
      });
    });
  }
  items.sort((left, right) => (right.memoryMB || 0) - (left.memoryMB || 0));
  const keyword = String(query || '').trim().toLowerCase();
  const filtered = keyword
    ? items.filter(item => item.name.toLowerCase().includes(keyword) || String(item.pid).includes(keyword))
    : items;
  const max = Math.max(1, Math.min(1000, Number(limit) || 400));
  return {
    success: true,
    readOnly: true,
    platform,
    total: filtered.length,
    items: filtered.slice(0, max),
    generatedAt: new Date().toISOString(),
  };
}

export function createLogRoutes(options = {}) {
  const {
    buildAffinityLogEntries,
    buildWebConsoleAuditLogEntries,
    buildBotLogFileList,
    buildGroupManagementLogEntries,
    buildImageMonitorLogPayload,
    buildImageMonitorUsageTrendPayload,
    buildSupportBundlePayload,
    diagnoseBotLogsPayload,
    buildLogsPayload,
    buildPerformancePayload,
    buildPokeImageSummaryTrendPayload,
    buildFreeChatUsagePayload,
    buildUsageLogEntries,
    buildUsageTrendPayload,
    cleanupImageMonitorNonMemePayload,
    cleanupImageMonitorUnmatchedMemePayload,
    exportDataAsText,
    findAffinityLogEntry,
    findImageMonitorLogEntry,
    findUsageLogEntry,
    getHttpErrorStatus,
    isLogExportType,
    parseRequestBody,
    readBotLogWindow,
    requireLogsExposed,
    resetPerformanceApiCircuitBreaker,
    sendJson,
    sendText,
    serveImageMonitorLocalImage,
  } = options;

  const { rejectReadOnly } = createRouteUtils(options);

  async function handle(req, res, url) {
    if (url.pathname === '/api/bot-logs/files') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildBotLogFileList());
      return true;
    }
    if (url.pathname === '/api/bot-logs/read') {
      if (!requireLogsExposed(res)) return true;
      try {
        sendJson(res, readBotLogWindow({
          file: url.searchParams.get('file'),
          mode: url.searchParams.get('mode'),
          startLine: url.searchParams.get('startLine'),
          limit: url.searchParams.get('limit'),
        }));
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildLogsPayload());
      return true;
    }
    if (url.pathname === '/api/logs/usage') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildUsageLogEntries({
        query: url.searchParams.get('query'),
        scene: url.searchParams.get('scene'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/performance') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildPerformancePayload({
        slowThresholdMs: url.searchParams.get('slowThresholdMs'),
      }));
      return true;
    }
    if (url.pathname === '/api/performance/processes') {
      if (!requireLogsExposed(res)) return true;
      try {
        sendJson(res, await listSystemProcesses({
          query: url.searchParams.get('query'),
          limit: url.searchParams.get('limit'),
        }));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/performance/api-circuit/reset' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, resetPerformanceApiCircuitBreaker(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs/affinity') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildAffinityLogEntries({
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/logs/audit') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildWebConsoleAuditLogEntries({
        query: url.searchParams.get('query'),
        action: url.searchParams.get('action'),
        method: url.searchParams.get('method'),
        result: url.searchParams.get('result'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/logs/group-management') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildGroupManagementLogEntries({
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        userId: url.searchParams.get('userId'),
        action: url.searchParams.get('action'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildImageMonitorLogPayload({
        query: url.searchParams.get('query'),
        type: url.searchParams.get('type'),
        risk: url.searchParams.get('risk'),
        isMeme: url.searchParams.get('isMeme'),
        groupId: url.searchParams.get('groupId'),
        userId: url.searchParams.get('userId'),
        alerted: url.searchParams.get('alerted'),
        recalled: url.searchParams.get('recalled'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
      }));
      return true;
    }
    if (url.pathname === '/api/logs/diagnose' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await diagnoseBotLogsPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/support-bundle' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const payload = await buildSupportBundlePayload(body);
        sendText(res, JSON.stringify(payload, null, 2), 200, 'application/json; charset=utf-8');
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor/cleanup-non-meme' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, cleanupImageMonitorNonMemePayload());
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor/cleanup-unmatched-meme' && req.method === 'POST') {
      if (!requireLogsExposed(res)) return true;
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, cleanupImageMonitorUnmatchedMemePayload());
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor/detail') {
      if (!requireLogsExposed(res)) return true;
      const entryId = url.searchParams.get('id');
      const type = url.searchParams.get('type') || 'review';
      const payload = findImageMonitorLogEntry(type, entryId);
      if (!payload) {
        sendJson(res, { success: false, error: 'Not found' }, 404);
        return true;
      }
      sendJson(res, payload);
      return true;
    }
    if (url.pathname === '/api/logs/image-monitor/local-image') {
      if (!requireLogsExposed(res)) return true;
      const entryId = url.searchParams.get('id');
      const type = url.searchParams.get('type') || 'review';
      try {
        serveImageMonitorLocalImage(res, type, entryId);
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/logs/usage/detail') {
      if (!requireLogsExposed(res)) return true;
      const entryId = url.searchParams.get('id');
      const payload = findUsageLogEntry(entryId);
      if (!payload) {
        sendJson(res, { success: false, error: 'Not found' }, 404);
        return true;
      }
      sendJson(res, payload);
      return true;
    }
    if (url.pathname === '/api/logs/affinity/detail') {
      if (!requireLogsExposed(res)) return true;
      const entryId = url.searchParams.get('id');
      const payload = findAffinityLogEntry(entryId);
      if (!payload) {
        sendJson(res, { success: false, error: 'Not found' }, 404);
        return true;
      }
      sendJson(res, payload);
      return true;
    }
    if (url.pathname === '/api/export') {
      if (rejectReadOnly(res)) return true;
      const type = url.searchParams.get('type');
      if (isLogExportType(type) && !requireLogsExposed(res)) return true;
      const text = exportDataAsText(type, {
        query: url.searchParams.get('query'),
        groupId: url.searchParams.get('groupId'),
        userId: url.searchParams.get('userId'),
        sessionId: url.searchParams.get('sessionId'),
        action: url.searchParams.get('action'),
        method: url.searchParams.get('method'),
        result: url.searchParams.get('result'),
        scene: url.searchParams.get('scene'),
        risk: url.searchParams.get('risk'),
        isMeme: url.searchParams.get('isMeme'),
        alerted: url.searchParams.get('alerted'),
        recalled: url.searchParams.get('recalled'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
      });
      sendText(res, text, 200, 'application/json; charset=utf-8');
      return true;
    }
    if (url.pathname === '/api/trend/usage') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildUsageTrendPayload());
      return true;
    }
    if (url.pathname === '/api/usage/free-chat') {
      sendJson(res, await buildFreeChatUsagePayload({
        force: url.searchParams.get('force') === '1',
      }));
      return true;
    }
    if (url.pathname === '/api/trend/image-monitor-usage') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildImageMonitorUsageTrendPayload());
      return true;
    }
    if (url.pathname === '/api/trend/poke-image-summary') {
      if (!requireLogsExposed(res)) return true;
      sendJson(res, buildPokeImageSummaryTrendPayload());
      return true;
    }
    return false;
  }

  return {
    handle,
  };
}
