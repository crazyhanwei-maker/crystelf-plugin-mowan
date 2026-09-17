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
      if (content.length <= maxLength) {
        return content;
      }
      let tail = content.slice(-maxLength);
      // 尾窗可能切在某个条目中间：pretty-printed JSON 的换行只会出现在条目边界
      // （字符串内换行被转义），首个 '\n}\n' 即第一条不完整条目的结束边界。
      // 恰好切在条目起始 '{'（含单行 JSONL 的行首）时，从当前点是完整内容，原样返回。
      if (tail.startsWith('{')) {
        return tail;
      }
      const boundary = tail.indexOf('\n}\n');
      if (boundary !== -1) {
        // 从边界后的下一个条目起始 '{' 开始（跳过残缺条目的收尾 '}'）
        const nextStart = tail.indexOf('{', boundary);
        return nextStart === -1 ? '' : tail.slice(nextStart);
      }
      // 尾窗内没有条目结束边界：可能是单行 JSONL，丢掉残缺首行；彻底没有换行则整段废弃
      const firstLineEnd = tail.indexOf('\n');
      if (firstLineEnd === -1) {
        return '';
      }
      return tail.slice(firstLineEnd + 1);
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
