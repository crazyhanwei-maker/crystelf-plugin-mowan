export function createLogFileUtils(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const logger = options.logger || { warn: () => {} };
  const normalizeUsageScene = typeof options.normalizeUsageScene === 'function'
    ? options.normalizeUsageScene
    : (entry => String(entry?.scene || 'unknown'));

  function parseJsonObjects(content = '') {
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
        if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        if (depth === 0) {
          start = i;
        }
        depth += 1;
        continue;
      }
      if (char === '}') {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          results.push(content.slice(start, i + 1));
          start = -1;
        }
      }
    }

    return results;
  }

  function readTailText(filePath, maxLength = 12000) {
    try {
      if (!fs.existsSync(filePath)) {
        return '';
      }
      const content = fs.readFileSync(filePath, 'utf8');
      return content.length > maxLength ? content.slice(-maxLength) : content;
    } catch {
      return '';
    }
  }

  function getUsageDateKey(date = new Date()) {
    return typeof date === 'string'
      ? date.slice(0, 10)
      : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function getDailyUsageLogFile(date = new Date()) {
    return path.join(process.cwd(), 'data', 'crystelf', 'debug', `ai-usage-${getUsageDateKey(date)}.log`);
  }

  function safeReadUsageEntries(date = new Date()) {
    try {
      const targetFile = getDailyUsageLogFile(date);
      if (!fs.existsSync(targetFile)) {
        return [];
      }
      const content = fs.readFileSync(targetFile, 'utf8');
      if (!content.trim()) {
        return [];
      }
      return parseJsonObjects(content)
        .map(item => {
          try {
            return JSON.parse(item);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .map(item => ({
          ...item,
          scene: normalizeUsageScene(item),
        }));
    } catch (error) {
      logger.warn(`[webConsole] Failed to read AI usage records: ${error.message}`);
      return [];
    }
  }

  return {
    parseJsonObjects,
    readTailText,
    getUsageDateKey,
    getDailyUsageLogFile,
    safeReadUsageEntries,
  };
}
