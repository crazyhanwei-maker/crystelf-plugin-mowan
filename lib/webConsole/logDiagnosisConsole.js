import AiCaller from '../ai/aiCaller.js';
import {
  getCandidateDirectories,
  getDisplayPath,
  listCandidateLogFiles,
  normalizeInteger,
  readLogTailText,
} from './logFileDiscovery.js';

const ERROR_LINE_PATTERN = /(\berror\b|\berr\b|exception|traceback|unhandled|failed|failure|fatal|typeerror|referenceerror|syntaxerror|rangeerror|eacces|eaddrinuse|econn|etimedout|timeout|cannot|crash|失败|错误|异常|报错|崩溃|超时|拒绝|无法|未找到|调用失败|加载失败)/i;
const WARN_LINE_PATTERN = /(\bwarn\b|warning|deprecated|retry|slow|告警|警告|重试|过慢|弃用)/i;
const MAX_PROMPT_CHARS = 32000;
const MAX_EXCERPT_CHARS = 42000;
const SUPPORT_BUNDLE_MAX_STRING_LENGTH = 12000;
const SUPPORT_BUNDLE_MAX_ARRAY_LENGTH = 120;
const SUPPORT_BUNDLE_MAX_OBJECT_DEPTH = 8;
const SUPPORT_BUNDLE_KIND = 'crystelf-web-console-support-bundle';
const SENSITIVE_KEY_PATTERN = /^(?:api[_-]?key|apikey|access[_-]?token|accesstoken|auth[_-]?token|authtoken|webconsoletoken|csrf[_-]?token|csrftoken|password|passwd|pwd|secret|cookie|authorization)$/i;

function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(String(message || 'Internal Server Error'));
  error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
  if (code) error.code = String(code);
  return error;
}

function truncateText(value = '', maxLength = 1000) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function redactSensitiveText(value = '') {
  return String(value || '')
    .replace(/\/\/([^:@/\s]+):([^@/\s]+)@/g, '//[REDACTED_CREDENTIAL]@')
    .replace(/(sk-(?:proj-)?[A-Za-z0-9_-]{12,})/g, '[REDACTED_API_KEY]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED_TOKEN]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|pwd|secret|cookie)\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|pwd|secret|cookie)"?\s*:\s*)("[^"]+"|'[^']+'|[^\s,;{}]+)/gi, '$1[REDACTED]')
    .replace(/\b[A-Z]:\\Users\\[^\\\s"'<>]+/gi, match => match.replace(/(\\Users\\)[^\\\s"'<>]+/i, '$1[USER]'))
    .replace(/\/(?:home|Users)\/[^/\s"'<>]+/g, match => match.replace(/\/([^/\s"'<>]+)$/, '/[USER]'))
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]')
    .replace(/\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){2,7}\b/gi, '[REDACTED_IP]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b\d{6,20}\b/g, '[REDACTED_ID]');
}

function shouldRedactDiagnosticKey(key = '') {
  const raw = String(key || '').trim();
  const compact = raw.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SENSITIVE_KEY_PATTERN.test(raw)
    || /^(?:authorization|cookie|setcookie|xcrystelfcsrf|csrftoken|csrf)$/.test(compact)
    || (compact.includes('token') && compact !== 'tokenstrength' && compact !== 'totaltokens')
    || compact.includes('apikey')
    || compact.includes('password')
    || compact.includes('secret');
}

function sanitizeDiagnosticValue(value, options = {}, depth = 0, seen = new WeakSet()) {
  const maxStringLength = normalizeInteger(
    options.maxStringLength,
    SUPPORT_BUNDLE_MAX_STRING_LENGTH,
    200,
    80000,
  );
  const maxArrayLength = normalizeInteger(
    options.maxArrayLength,
    SUPPORT_BUNDLE_MAX_ARRAY_LENGTH,
    10,
    1000,
  );

  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateText(redactSensitiveText(value), maxStringLength);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return redactSensitiveText(String(value));
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${value.length}]`;
  }
  if (typeof value !== 'object') {
    return redactSensitiveText(String(value));
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  if (depth >= SUPPORT_BUNDLE_MAX_OBJECT_DEPTH) {
    return '[TRUNCATED_DEPTH]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, maxArrayLength)
      .map(item => sanitizeDiagnosticValue(item, options, depth + 1, seen));
    if (value.length > maxArrayLength) {
      items.push({ truncated: true, omittedCount: value.length - maxArrayLength });
    }
    return items;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (shouldRedactDiagnosticKey(key)) {
      result[key] = '[REDACTED]';
      continue;
    }
    result[key] = sanitizeDiagnosticValue(item, options, depth + 1, seen);
  }
  return result;
}

function buildSupportBundleFileName(generatedAt = new Date().toISOString()) {
  const stamp = String(generatedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  return `crystelf-support-bundle-${stamp}.json`;
}

async function collectSupportSection(label = '', collector = null) {
  const startedAt = Date.now();
  if (typeof collector !== 'function') {
    return {
      success: false,
      label,
      elapsedMs: 0,
      error: '模块暂不可用',
    };
  }

  try {
    return {
      success: true,
      label,
      elapsedMs: Date.now() - startedAt,
      data: await collector(),
    };
  } catch (error) {
    return {
      success: false,
      label,
      elapsedMs: Date.now() - startedAt,
      error: redactSensitiveText(error?.message || String(error || '读取失败')),
      code: String(error?.code || ''),
    };
  }
}

function buildSupportBundleTips(bundle = {}) {
  const tips = [];
  const healthSummary = bundle.sections?.health?.data?.summary || {};
  const pageSummary = bundle.frontend?.pageCheck?.summary || {};
  const logHitCount = Number(bundle.logs?.hitCount || 0);

  if (Number(pageSummary.errorCount || 0) > 0) {
    tips.push('页面巡检发现有页面或接口没有正常返回，先看 pageCheck.items 中的失败项。');
  }
  if (Number(healthSummary.errorCount || 0) > 0) {
    tips.push('健康检查里有异常项，优先查看 sections.health.data.issues。');
  }
  if (logHitCount > 0) {
    tips.push('日志片段里命中了错误或告警关键字，优先查看 logs.excerptPreview。');
  }
  if (tips.length <= 0) {
    tips.push('当前排障包没有发现明显异常，可以结合用户复现步骤继续查看页面巡检和最近日志。');
  }
  tips.push('排障包已经自动隐藏口令、Token、API Key、Cookie、IP、邮箱、长数字 ID 和用户目录；发送前仍建议快速浏览一遍。');
  return tips;
}

export function createLogDiagnosisConsole(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const Path = options.Path || {};
  const logger = options.logger || { warn: () => {} };
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({ logTailLength: 12000 }));
  const getWebConsoleInfo = typeof options.getWebConsoleInfo === 'function'
    ? options.getWebConsoleInfo
    : (() => null);
  const buildOverviewPayload = typeof options.buildOverviewPayload === 'function'
    ? options.buildOverviewPayload
    : null;
  const buildHealthPayload = typeof options.buildHealthPayload === 'function'
    ? options.buildHealthPayload
    : null;
  const buildDependencyReport = typeof options.buildDependencyReport === 'function'
    ? options.buildDependencyReport
    : null;
  const buildWebConsoleAuditLogEntries = typeof options.buildWebConsoleAuditLogEntries === 'function'
    ? options.buildWebConsoleAuditLogEntries
    : null;
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : createHttpErrorFallback;

  function extractProblemSnippets(text = '', options = {}) {
    const includeWarnings = options.includeWarnings === true;
    const lines = String(text || '').split(/\r?\n/);
    const hitIndexes = [];
    lines.forEach((line, index) => {
      if (ERROR_LINE_PATTERN.test(line) || (includeWarnings && WARN_LINE_PATTERN.test(line))) {
        hitIndexes.push(index);
      }
    });

    const ranges = [];
    for (const index of hitIndexes) {
      const start = Math.max(0, index - 4);
      const end = Math.min(lines.length - 1, index + 10);
      const lastRange = ranges[ranges.length - 1];
      if (lastRange && start <= lastRange.end + 1) {
        lastRange.end = Math.max(lastRange.end, end);
      } else {
        ranges.push({ start, end });
      }
    }

    const snippets = ranges.map(range => lines
      .slice(range.start, range.end + 1)
      .map((line, offset) => `${range.start + offset + 1}: ${line}`)
      .join('\n'));

    return {
      hitCount: hitIndexes.length,
      lineCount: lines.length,
      snippets,
    };
  }

  function collectDiagnosisContext(payload = {}) {
    const webConsole = getWebConsoleConfig();
    const source = String(payload.source || 'auto').trim().toLowerCase();
    const includeWarnings = payload.includeWarnings !== false;
    const tailLength = normalizeInteger(
      payload.tailLength,
      Math.max(20000, Number(webConsole.logTailLength || 12000)),
      6000,
      240000,
    );
    const files = listCandidateLogFiles(['auto', 'bot', 'plugin', 'all'].includes(source) ? source : 'auto', logger);
    const selectedFiles = [];
    const sections = [];
    let totalHitCount = 0;

    for (const file of files) {
      const raw = readLogTailText(file.filePath, tailLength);
      const redacted = redactSensitiveText(raw);
      const extracted = extractProblemSnippets(redacted, { includeWarnings });
      const hasProblems = extracted.hitCount > 0;
      const fallbackRecentText = !hasProblems && sections.length === 0
        ? redacted.split(/\r?\n/).slice(-80).join('\n')
        : '';
      const snippetText = hasProblems
        ? extracted.snippets.join('\n\n---\n\n')
        : fallbackRecentText;
      if (!snippetText.trim()) continue;

      const section = [
        `# ${file.displayPath}`,
        `mtime=${file.mtime} size=${file.size} hits=${extracted.hitCount}`,
        '',
        snippetText,
      ].join('\n');
      sections.push(section);
      totalHitCount += extracted.hitCount;
      selectedFiles.push({
        displayPath: file.displayPath,
        size: file.size,
        mtime: file.mtime,
        hitCount: extracted.hitCount,
        lineCount: extracted.lineCount,
      });
      if (sections.join('\n\n').length >= MAX_EXCERPT_CHARS) break;
    }

    return {
      source,
      includeWarnings,
      tailLength,
      files: files.map(file => ({
        displayPath: file.displayPath,
        size: file.size,
        mtime: file.mtime,
        selected: selectedFiles.some(item => item.displayPath === file.displayPath),
      })),
      selectedFiles,
      totalHitCount,
      excerpt: truncateText(sections.join('\n\n====================\n\n'), MAX_EXCERPT_CHARS),
    };
  }

  function buildDiagnosisPrompt(context = {}) {
    return [
      '你是 Yunzai/TRSS-Yunzai/QQ Bot 插件运行日志排查助手。',
      '请根据下面的日志片段，用中文输出排查结论。不要泄露或复述密钥、token、cookie；如果日志中出现脱敏标记，按“敏感信息已脱敏”处理。',
      '请严格区分“日志明确显示”和“推测可能”。不要编造不存在的调用栈、文件名或接口返回。',
      '',
      '输出格式：',
      '1. 结论：一句话说明当前最可能的问题。',
      '2. 关键证据：列出 2-5 条日志证据。',
      '3. 可能原因：按可能性排序。',
      '4. 建议处理：给出可执行步骤，优先给无需改代码的检查项。',
      '5. 还需要补充：如果证据不足，说明还需要查看什么日志或配置。',
      '',
      `日志来源：${context.source}`,
      `读取文件数：${context.selectedFiles?.length || 0}`,
      `疑似错误/告警命中：${context.totalHitCount || 0}`,
      '',
      '日志片段：',
      truncateText(context.excerpt || '', MAX_PROMPT_CHARS),
    ].join('\n');
  }

  async function diagnosePayload(payload = {}) {
    const context = collectDiagnosisContext(payload);
    if (!context.excerpt.trim()) {
      return {
        success: true,
        diagnosedAt: new Date().toISOString(),
        source: context.source,
        tailLength: context.tailLength,
        files: context.files,
        selectedFiles: [],
        hitCount: 0,
        analysis: '没有找到可读取的 Bot 或插件日志文件，或日志文件为空。请确认 Bot 已启动并产生日志后再试。',
        excerptPreview: '',
      };
    }

    const prompt = buildDiagnosisPrompt(context);
    const result = await AiCaller.callAiDirect(prompt, [], [], null, [], {
      scene: 'webconsole_log_diagnosis',
      sessionId: 'webconsole:log-diagnosis',
      userId: 'webconsole',
      temperature: 0.1,
      max_tokens: normalizeInteger(payload.maxTokens, 1200, 400, 2400),
      systemPrompt: '你是严谨的中文日志排查助手，只根据给定日志分析问题，避免臆测。',
    });

    if (!result.success) {
      throw createHttpError(502, result.error || 'LLM 日志排查失败', 'LOG_DIAGNOSIS_AI_FAILED');
    }

    return {
      success: true,
      diagnosedAt: new Date().toISOString(),
      source: context.source,
      tailLength: context.tailLength,
      files: context.files,
      selectedFiles: context.selectedFiles,
      hitCount: context.totalHitCount,
      analysis: redactSensitiveText(result.response || 'LLM 未返回排查结论。'),
      excerptPreview: truncateText(context.excerpt, 6000),
      usage: result.usage || null,
    };
  }

  async function buildSupportBundlePayload(payload = {}) {
    const generatedAt = new Date().toISOString();
    const context = collectDiagnosisContext({
      source: payload.source || 'auto',
      includeWarnings: payload.includeWarnings !== false,
      tailLength: payload.tailLength,
    });
    const webConsoleConfig = getWebConsoleConfig() || {};
    const runtimeInfo = getWebConsoleInfo() || null;
    const bundle = {
      success: true,
      kind: SUPPORT_BUNDLE_KIND,
      version: 1,
      generatedAt,
      fileName: buildSupportBundleFileName(generatedAt),
      privacy: {
        redacted: true,
        redactionScope: [
          '登录口令',
          'Token',
          'API Key',
          'Cookie',
          'IP 地址',
          '邮箱',
          '长数字 ID',
          '本机用户目录',
        ],
        note: '发送前仍建议快速浏览一遍，确认里面没有你不想分享的信息。',
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        cwd: process.cwd(),
      },
      webConsole: {
        enabled: webConsoleConfig.enabled !== false,
        host: webConsoleConfig.host || '',
        port: webConsoleConfig.port || '',
        readOnly: webConsoleConfig.readOnly === true,
        exposeLogs: webConsoleConfig.exposeLogs !== false,
        maskSensitiveConfig: webConsoleConfig.maskSensitiveConfig !== false,
        running: Boolean(runtimeInfo),
        url: runtimeInfo?.url || '',
      },
      sections: {
        overview: await collectSupportSection('控制台概览', buildOverviewPayload),
        health: await collectSupportSection('健康检查', buildHealthPayload),
        dependency: await collectSupportSection('依赖检查', buildDependencyReport),
        audit: await collectSupportSection('最近审计日志', () => buildWebConsoleAuditLogEntries({
          page: 1,
          pageSize: 50,
        })),
      },
      logs: {
        source: context.source,
        includeWarnings: context.includeWarnings,
        tailLength: context.tailLength,
        files: context.files,
        selectedFiles: context.selectedFiles,
        hitCount: context.totalHitCount,
        excerptPreview: truncateText(context.excerpt, 16000),
      },
      frontend: {
        pageCheck: payload.pageCheck || null,
        pageLoadDiagnostics: payload.pageLoadDiagnostics || null,
        frontendErrors: payload.frontendErrors || null,
        requestTiming: payload.requestTiming || null,
        browser: {
          pageUrl: payload.pageUrl || '',
          userAgent: payload.userAgent || '',
        },
      },
    };
    bundle.tips = buildSupportBundleTips(bundle);
    return sanitizeDiagnosticValue(bundle, {
      maxStringLength: SUPPORT_BUNDLE_MAX_STRING_LENGTH,
      maxArrayLength: SUPPORT_BUNDLE_MAX_ARRAY_LENGTH,
    });
  }

  return {
    buildSupportBundlePayload,
    collectDiagnosisContext,
    diagnosePayload,
  };
}
