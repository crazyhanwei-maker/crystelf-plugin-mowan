export function createMemeLocalPath(options = {}) {
  const path = options.path;
  const rootDir = String(options.rootDir || process.cwd());
  const isPathInsideRoot = typeof options.isPathInsideRoot === 'function'
    ? options.isPathInsideRoot
    : (() => false);
  const ensurePathResolvedWithinRoot = typeof options.ensurePathResolvedWithinRoot === 'function'
    ? options.ensurePathResolvedWithinRoot
    : (() => ({}));
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode = 500, message = 'Internal Server Error', code = '') => {
        const error = new Error(String(message || 'Internal Server Error'));
        error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
        if (code) error.code = String(code);
        return error;
      });

  function normalizeLocalBaseDir(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    const resolvedPath = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(rootDir, raw);
    if (!isPathInsideRoot(resolvedPath, rootDir)) {
      throw createHttpError(400, '本地表情目录必须位于项目目录内', 'MEME_LOCAL_DIR_OUT_OF_RANGE');
    }

    ensurePathResolvedWithinRoot(resolvedPath, rootDir, { allowMissing: true });
    return path.relative(rootDir, resolvedPath).replace(/\\/g, '/');
  }

  return {
    normalizeLocalBaseDir,
  };
}
