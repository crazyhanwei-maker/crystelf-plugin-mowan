import { GROUP_MANAGEMENT_LOG_FILE, subscribeGroupManagementLog } from '../groupManagement/groupManagementLog.js';

function normalizeEventType(type = '') {
  const value = String(type || 'all').trim();
  return ['all', 'moderation', 'join', 'welcome', 'summary', 'title', 'config'].includes(value) ? value : 'all';
}

function parseJsonLogLines(content = '') {
  return String(content || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function getEventType(action = '', sections = []) {
  const key = String(action || '').trim();
  const sectionText = Array.isArray(sections) ? sections.join(',') : String(sections || '');
  if (key.startsWith('content_moderation') || /moderation/.test(sectionText)) return 'moderation';
  if (key.startsWith('join_request')) return 'join';
  if (key.startsWith('group_welcome') || /welcome/.test(sectionText)) return 'welcome';
  if (key.startsWith('daily_group_summary') || /dailySummary/.test(sectionText)) return 'summary';
  if (key.startsWith('group_title') || /groupTitle/.test(sectionText)) return 'title';
  return 'config';
}

function getEventTypeLabel(eventType = '') {
  return {
    moderation: '风控',
    join: '申请',
    welcome: '欢迎',
    summary: '总结',
    title: '头衔',
    config: '配置',
  }[eventType] || '事件';
}

function sendSseEvent(res, eventName = 'message', payload = {}) {
  if (!res || res.destroyed || res.writableEnded) return false;
  try {
    res.write(`event: ${String(eventName || 'message')}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function createGroupManagementEventFeed(options = {}) {
  const readTailText = typeof options.readTailText === 'function' ? options.readTailText : () => '';
  const attachLogDisplayFields = typeof options.attachLogDisplayFields === 'function'
    ? options.attachLogDisplayFields
    : ((entry = {}) => entry);
  const getLogTailLength = typeof options.getLogTailLength === 'function' ? options.getLogTailLength : () => 80000;
  const normalizeIntegerInRange = typeof options.normalizeIntegerInRange === 'function'
    ? options.normalizeIntegerInRange
    : ((value, fallback) => Number(value) || fallback);
  const getSecurityHeaders = typeof options.getSecurityHeaders === 'function' ? options.getSecurityHeaders : () => ({});

  function attachEventDisplayFields(item = {}, index = 0) {
    const entry = attachLogDisplayFields(item, index);
    const eventType = getEventType(entry.action, entry.sections);
    return {
      ...entry,
      eventType,
      eventTypeLabel: getEventTypeLabel(eventType),
    };
  }

  function isEventMatched(item = {}, filters = {}) {
    const groupId = String(filters.groupId || '').trim();
    const type = normalizeEventType(filters.type);
    return (!groupId || String(item.group_id || item.groupId || '') === groupId)
      && (type === 'all' || item.eventType === type);
  }

  function readEventItems() {
    const content = readTailText(GROUP_MANAGEMENT_LOG_FILE, Math.max(80000, Number(getLogTailLength()) || 0));
    return parseJsonLogLines(content)
      .map((item, index) => {
        try {
          return attachEventDisplayFields(JSON.parse(item), index);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function buildPayload(filters = {}) {
    const groupId = String(filters.groupId || '').trim();
    const type = normalizeEventType(filters.type);
    const limit = normalizeIntegerInRange(filters.limit, 30, 5, 80);
    const since = String(filters.since || '').trim();
    const sinceTime = since ? new Date(since).getTime() : 0;
    let maxTime = '';
    const items = readEventItems()
      .filter(item => isEventMatched(item, { groupId, type }))
      .filter((item) => {
        const timeMs = new Date(item.time || 0).getTime();
        if (Number.isFinite(timeMs) && (!maxTime || String(item.time || '') > maxTime)) {
          maxTime = String(item.time || '');
        }
        if (!sinceTime) return true;
        return Number.isFinite(timeMs) && timeMs > sinceTime;
      })
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
      .slice(0, limit);

    return {
      success: true,
      groupId,
      type,
      since,
      nextSince: maxTime || since || new Date().toISOString(),
      items,
    };
  }

  function serveStream(req, res, filters = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      ...getSecurityHeaders('text/event-stream; charset=utf-8'),
    });
    const normalizedFilters = {
      groupId: String(filters.groupId || '').trim(),
      type: normalizeEventType(filters.type),
    };
    let closed = false;
    let keepAlive = null;
    let unsubscribe = () => {};
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
      unsubscribe();
      unsubscribe = () => {};
    };
    if (!sendSseEvent(res, 'snapshot', buildPayload({
      ...normalizedFilters,
      limit: filters.limit || 40,
    }))) {
      cleanup();
      return;
    }
    unsubscribe = subscribeGroupManagementLog((entry) => {
      if (closed) return;
      const item = attachEventDisplayFields(entry, 0);
      if (!isEventMatched(item, normalizedFilters)) return;
      if (!sendSseEvent(res, 'event', { success: true, item, nextSince: item.time || new Date().toISOString() })) {
        cleanup();
      }
    });
    keepAlive = setInterval(() => {
      if (!res || res.destroyed || res.writableEnded) {
        cleanup();
        return;
      }
      try {
        res.write(': ping\n\n');
      } catch {
        cleanup();
      }
    }, 25000);
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  return {
    normalizeEventType,
    attachEventDisplayFields,
    isEventMatched,
    buildPayload,
    serveStream,
  };
}
