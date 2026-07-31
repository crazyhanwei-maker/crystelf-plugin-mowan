import path from 'path';
import {
  getCandidateDirectories,
  listCandidateLogFiles,
  readLogFileWindow,
} from './logFileDiscovery.js';

function createHttpErrorFallback(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(String(message || 'Internal Server Error'));
  error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
  if (code) error.code = String(code);
  return error;
}

/**
 * Bot 运行日志查看模块：自动扫描候选日志目录并读取日志窗口。
 */
export function createBotLogsConsole(options = {}) {
  const logger = options.logger || { warn: () => {} };
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : createHttpErrorFallback;

  function buildFileList() {
    const files = listCandidateLogFiles('all', logger).map(file => ({
      filePath: file.filePath,
      displayPath: file.displayPath,
      name: file.name,
      size: file.size,
      mtime: file.mtime,
      mtimeMs: file.mtimeMs,
    }));
    return {
      success: true,
      scannedAt: new Date().toISOString(),
      candidates: getCandidateDirectories('all'),
      files,
    };
  }

  function readLogWindow(params = {}) {
    const rawFile = String(params.file || '').trim();
    if (!rawFile) {
      throw createHttpError(400, '缺少日志文件参数', 'BOT_LOGS_MISSING_FILE');
    }
    // 白名单校验：只允许读取自动扫描出的候选日志文件，防止任意文件读取
    const allowedPaths = new Set(
      listCandidateLogFiles('all', logger).map(file => path.resolve(file.filePath).toLowerCase()),
    );
    const targetPath = path.resolve(rawFile).toLowerCase();
    if (!allowedPaths.has(targetPath)) {
      throw createHttpError(400, '日志文件不在候选列表内', 'BOT_LOGS_NOT_ALLOWED');
    }
    const payload = readLogFileWindow(rawFile, {
      mode: params.mode,
      startLine: params.startLine,
      limit: params.limit,
    });
    if (payload.success === false) {
      throw createHttpError(404, `读取日志文件失败: ${payload.error || '文件不存在或已被删除'}`, 'BOT_LOGS_READ_FAILED');
    }
    return { success: true, ...payload };
  }

  return {
    buildFileList,
    readLogWindow,
  };
}
