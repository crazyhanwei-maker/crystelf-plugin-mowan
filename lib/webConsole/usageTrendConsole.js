export function createUsageTrendConsole(options = {}) {
  const readTailText = typeof options.readTailText === 'function' ? options.readTailText : () => '';
  const getUsageTrendByDaysSync = typeof options.getUsageTrendByDaysSync === 'function'
    ? options.getUsageTrendByDaysSync
    : null;
  const parseJsonObjects = typeof options.parseJsonObjects === 'function' ? options.parseJsonObjects : () => [];
  const getLogTailLength = typeof options.getLogTailLength === 'function' ? options.getLogTailLength : () => 12000;
  const usageLogFile = options.usageLogFile || '';
  const isImageMonitorReviewUsage = typeof options.isImageMonitorReviewUsage === 'function'
    ? options.isImageMonitorReviewUsage
    : (() => false);

  function readUsageTrendItems(filter = null) {
    const content = readTailText(usageLogFile, Math.max(120000, Number(getLogTailLength()) || 0));
    return parseJsonObjects(content)
      .map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(item => (typeof filter === 'function' ? filter(item) : true));
  }

  function buildHourlyTrendPayload(filter = null) {
    const items = readUsageTrendItems(filter);
    const buckets = new Map();
    for (const item of items) {
      const time = new Date(item.time || Date.now());
      if (Number.isNaN(time.getTime())) continue;
      const key = `${time.getHours().toString().padStart(2, '0')}:00`;
      if (!buckets.has(key)) {
        buckets.set(key, { hour: key, requests: 0, tokens: 0, errors: 0 });
      }
      const bucket = buckets.get(key);
      bucket.requests += 1;
      bucket.tokens += Number(item.total_tokens || 0);
      if (item.stage === 'error' || item.stage === 'empty_response' || item.error) {
        bucket.errors += 1;
      }
    }

    return {
      items: Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour)).slice(-24),
    };
  }

  function buildUsageTrendPayload() {
    return buildHourlyTrendPayload();
  }

  function buildImageMonitorUsageTrendPayload() {
    return buildHourlyTrendPayload(item => isImageMonitorReviewUsage(item));
  }

  function buildPokeImageSummaryTrendPayload() {
    return buildHourlyTrendPayload(item => String(item.scene || '') === 'poke_image_summary');
  }

  function buildUsageTrendByDaysPayload(days = 7) {
    if (!getUsageTrendByDaysSync) {
      return { items: [] };
    }
    const max = Math.min(Math.max(Number(days) || 7, 1), 90);
    return {
      days: max,
      items: getUsageTrendByDaysSync(max),
    };
  }

  return {
    buildUsageTrendPayload,
    buildUsageTrendByDaysPayload,
    buildImageMonitorUsageTrendPayload,
    buildPokeImageSummaryTrendPayload,
  };
}
