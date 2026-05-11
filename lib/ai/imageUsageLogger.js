import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const IMAGE_USAGE_DIR = path.join(process.cwd(), 'data', 'crystelf', 'debug');
const IMAGE_USAGE_FILE = path.join(IMAGE_USAGE_DIR, 'image-usage.log');

const fallbackLogger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

function formatLocalDateTime(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetRemainMinutes = String(absOffset % 60).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${sign}${offsetHours}:${offsetRemainMinutes}`;
}

function getDateKey(date = new Date()) {
  return typeof date === 'string'
    ? date.slice(0, 10)
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function getDailyImageUsageFile(date = new Date()) {
  return path.join(IMAGE_USAGE_DIR, `image-usage-${getDateKey(date)}.log`);
}

function sanitizeValue(value, maxLength = 240) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function extractJsonObjects(content) {
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (char === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(content.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
}

function safeReadImageUsageFileSync(date = new Date()) {
  try {
    const targetFile = getDailyImageUsageFile(date);
    if (!fsSync.existsSync(targetFile)) return [];
    const content = fsSync.readFileSync(targetFile, 'utf8');
    if (!content.trim()) return [];
    return extractJsonObjects(content)
      .map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    fallbackLogger.warn(`[imageUsageLogger] 读取生图用量日志失败: ${error.message}`);
    return [];
  }
}

export async function logImageUsage(entry = {}) {
  try {
    await fs.mkdir(IMAGE_USAGE_DIR, { recursive: true });
    const now = new Date();
    const payload = {
      time: formatLocalDateTime(now),
      stage: entry.stage || (entry.success === false ? 'error' : 'success'),
      mode: sanitizeValue(entry.mode || entry.imageMode || 'unknown', 80),
      model: sanitizeValue(entry.model || 'unknown', 160),
      prompt_preview: sanitizeValue(entry.prompt || entry.promptPreview, 240),
      elapsed_ms: Number.isFinite(Number(entry.elapsedMs)) ? Number(entry.elapsedMs) : undefined,
      source_count: Number.isFinite(Number(entry.sourceCount)) ? Number(entry.sourceCount) : undefined,
      has_image: entry.hasImage === true,
      error: sanitizeValue(entry.error, 240),
    };
    const line = `${JSON.stringify(payload, null, 2)}\n`;
    await fs.appendFile(IMAGE_USAGE_FILE, line, 'utf8');
    await fs.appendFile(getDailyImageUsageFile(now), line, 'utf8');
  } catch (error) {
    fallbackLogger.warn(`[imageUsageLogger] 生图用量日志写入失败: ${error.message}`);
  }
}

export function getDailyImageUsageSummarySync(date = new Date()) {
  const entries = safeReadImageUsageFileSync(date);
  const summary = {
    date: getDateKey(date),
    request_count: 0,
    success_count: 0,
    error_count: 0,
    total_elapsed_ms: 0,
    average_elapsed_ms: 0,
    by_model: {},
    latest: null,
    daily_log_file: getDailyImageUsageFile(date),
    all_log_file: IMAGE_USAGE_FILE,
  };

  for (const entry of entries) {
    const entryDate = String(entry?.time || '').slice(0, 10);
    if (entryDate !== summary.date) continue;
    summary.request_count += 1;
    if (entry.stage === 'success') summary.success_count += 1;
    if (entry.stage === 'error' || entry.error) summary.error_count += 1;

    const elapsed = Number(entry.elapsed_ms || 0);
    if (Number.isFinite(elapsed) && elapsed > 0) {
      summary.total_elapsed_ms += elapsed;
    }

    const model = String(entry.model || 'unknown');
    if (!summary.by_model[model]) {
      summary.by_model[model] = { requests: 0, success: 0, errors: 0 };
    }
    summary.by_model[model].requests += 1;
    if (entry.stage === 'success') summary.by_model[model].success += 1;
    if (entry.stage === 'error' || entry.error) summary.by_model[model].errors += 1;

    if (!summary.latest || String(entry.time || '').localeCompare(String(summary.latest.time || '')) > 0) {
      summary.latest = entry;
    }
  }

  summary.average_elapsed_ms = summary.request_count > 0
    ? Math.round(summary.total_elapsed_ms / summary.request_count)
    : 0;

  return summary;
}
