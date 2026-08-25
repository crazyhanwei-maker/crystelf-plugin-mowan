(() => {
  const { fetchJsonSafe } = window.CrystelfRequest;
  const ui = window.CrystelfUi || {};

  const state = {
    files: [],
    currentFile: '',
    limit: 2000,
    autoRefreshMs: 3000,
    autoRefreshTimer: null,
    windowStart: 0,
    windowEnd: 0,
    lines: [],
    truncated: false,
    prefixTruncated: false,
    readLines: 0,
    lastRefreshAt: null,
    olderLoading: false,
    searchTimer: null,
    sessionKey: 0,
  };

  const LEVEL_PATTERNS = [
    { level: 'ERROR', re: /\[(?:ERROR|FATAL|SEVERE)\]/i },
    { level: 'WARN', re: /\[(?:WARN|WARNING)\]/i },
    { level: 'INFO', re: /\[(?:INFO|NOTICE)\]/i },
    { level: 'DEBUG', re: /\[(?:DEBUG|TRACE)\]/i },
    // 无方括号格式兜底：ERROR: / FATAL: / WARN: 等
    { level: 'ERROR', re: /(?:^|[\s:])(?:ERROR|FATAL|SEVERE)\s*:/i },
    { level: 'WARN', re: /(?:^|[\s:])(?:WARN|WARNING)\s*:/i },
  ];

  function escapeHtml(value) {
    if (typeof ui.escapeHtml === 'function') {
      return ui.escapeHtml(value);
    }
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 剥离 ANSI 颜色码（\x1b[32m 等）。TRSS-Yunzai 日志文件自带颜色控制符，
  // 不剥离会被原样渲染成「口口口」方块。
  function stripAnsi(value) {
    return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '');
  }

  function formatBytes(bytes = 0) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
  }

  function formatTime(value) {
    if (!value) return '暂无';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function detectLevel(text = '') {
    for (const item of LEVEL_PATTERNS) {
      if (item.re.test(text)) return item.level;
    }
    return 'other';
  }

  function getCurrentFilter() {
    return {
      level: document.getElementById('bot-logs-level-select').value,
      keyword: document.getElementById('bot-logs-search-input').value.trim().toLowerCase(),
    };
  }

  function shouldShowLine(line, filter) {
    if (filter.level !== 'all' && line.level !== filter.level) return false;
    if (filter.keyword && !line.text.toLowerCase().includes(filter.keyword)) return false;
    return true;
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightText(text, keyword) {
    const escaped = escapeHtml(text);
    if (!keyword) return escaped;
    try {
      const pattern = new RegExp(`(${escapeRegex(escapeHtml(keyword))})`, 'gi');
      return escaped.replace(pattern, '<mark>$1</mark>');
    } catch {
      return escaped;
    }
  }

  function renderLines() {
    const container = document.getElementById('bot-logs-content');
    const filter = getCurrentFilter();
    const fragment = document.createDocumentFragment();
    let shownCount = 0;
    let shownIndex = -1;

    for (const line of state.lines) {
      if (!shouldShowLine(line, filter)) continue;
      const lineElement = document.createElement('div');
      lineElement.className = 'log-line';
      const numberElement = document.createElement('span');
      numberElement.className = 'log-line-no';
      numberElement.textContent = String(line.globalLine + 1);
      const textElement = document.createElement('span');
      textElement.className = `log-line-text level-${line.level.toLowerCase()}`;
      textElement.innerHTML = highlightText(line.text, filter.keyword);
      lineElement.appendChild(numberElement);
      lineElement.appendChild(textElement);
      fragment.appendChild(lineElement);
      shownCount += 1;
      shownIndex = line.globalLine;
    }

    container.replaceChildren(fragment);
    if (shownCount <= 0) {
      const empty = document.createElement('div');
      empty.className = 'bot-logs-empty';
      empty.textContent = state.lines.length > 0 ? '没有匹配当前筛选条件的日志行' : '暂无日志内容';
      container.appendChild(empty);
    }
    updateFilterCount(shownCount, shownIndex);
  }

  function updateFilterCount(shownCount, shownIndex) {
    const target = document.getElementById('bot-logs-filter-count');
    const filter = getCurrentFilter();
    if (filter.level === 'all' && !filter.keyword) {
      target.textContent = `共 ${shownCount} 行`;
    } else {
      target.textContent = `匹配 ${shownCount} / ${state.lines.length} 行`;
    }
    if (shownIndex >= 0) {
      target.textContent += `，最新行号 ${shownIndex + 1}`;
    }
  }

  function setStatus(text) {
    document.getElementById('bot-logs-status').textContent = text;
  }

  function setMeta(text) {
    document.getElementById('bot-logs-meta').textContent = text;
  }

  function showErrorBanner(message) {
    const container = document.getElementById('bot-logs-content');
    const banner = document.createElement('div');
    banner.className = 'bot-logs-error-banner';
    banner.textContent = message;
    container.replaceChildren(banner);
  }

  function updatePrefixNotice() {
    const notice = document.getElementById('bot-logs-prefix-notice');
    if (state.prefixTruncated || state.truncated) {
      notice.classList.remove('hidden');
      notice.textContent = state.truncated
        ? `⚠ 文件较大，仅显示尾部 ${formatBytes(3 * 1024 * 1024)} 的内容；更早的日志可通过 bot 日志文件本身查看`
        : '⚠ 前文省略（文件截断读取）';
    } else {
      notice.classList.add('hidden');
    }
  }

  function updateOlderButton() {
    const button = document.getElementById('bot-logs-older-btn');
    const hasOlder = state.windowStart > 0;
    button.disabled = !hasOlder || state.olderLoading;
    button.textContent = state.olderLoading ? '加载中...' : '加载更早';
  }

  function buildStatusLine(meta = {}) {
    const parts = [];
    if (state.lines.length > 0) {
      parts.push(`显示行 ${state.windowStart + 1} - ${state.windowStart + state.lines.length}`);
    }
    if (state.readLines > 0) {
      parts.push(`已读 ${state.readLines} 行`);
    }
    if (meta.size) {
      parts.push(`文件 ${formatBytes(meta.size)}`);
    }
    if (meta.mtime) {
      parts.push(`更新于 ${formatTime(meta.mtime)}`);
    }
    if (state.lastRefreshAt) {
      parts.push(`刷新于 ${formatTime(state.lastRefreshAt)}`);
    }
    return parts.join(' · ');
  }

  function setCurrentFileMeta(meta = {}) {
    const fileInfo = state.files.find(item => item.filePath === state.currentFile);
    const metaText = fileInfo
      ? `${fileInfo.displayPath}（${formatBytes(fileInfo.size)}${meta.mtime ? ` · ${formatTime(meta.mtime)}` : ''}）`
      : state.currentFile || '';
    setMeta(metaText);
  }

  async function loadFileList() {
    const result = await fetchJsonSafe('/api/bot-logs/files', { success: false, files: [] });
    if (result.success !== true) {
      setMeta('日志列表加载失败');
      const message = result.__errorStatus === 403
        ? '日志功能未开启：请在插件设置中开启「日志暴露」（webConsoleExposeLogs），或当前为只读模式'
        : `日志列表加载失败：${result.__error || result.error || '未知错误'}`;
      showErrorBanner(message);
      return false;
    }
    state.files = Array.isArray(result.files) ? result.files : [];
    const select = document.getElementById('bot-logs-file-select');
    select.replaceChildren();
    if (state.files.length <= 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '未发现日志文件';
      select.appendChild(option);
      select.disabled = true;
      setMeta('未发现可用日志文件（已扫描 bot 根 logs/ 与插件日志目录）');
      return false;
    }
    select.disabled = false;
    for (const file of state.files) {
      const option = document.createElement('option');
      option.value = file.filePath;
      option.textContent = `${file.displayPath} · ${formatBytes(file.size)} · ${formatTime(file.mtime)}`;
      select.appendChild(option);
    }
    const preservedIndex = Math.max(0, state.files.findIndex(item => item.filePath === state.currentFile));
    select.selectedIndex = preservedIndex >= 0 ? preservedIndex : 0;
    state.currentFile = select.value;
    return true;
  }

  async function loadTail(options = {}) {
    if (!state.currentFile) return;
    const session = state.sessionKey;
    const retried = options.retried === true;
    const result = await fetchJsonSafe(`/api/bot-logs/read?file=${encodeURIComponent(state.currentFile)}&mode=tail&limit=${state.limit}`, {});
    if (session !== state.sessionKey) return; // 已切换文件，丢弃过期响应
    if (result.success !== true) {
      const message = result.__errorStatus === 403
        ? '日志功能未开启：请在插件设置中开启「日志暴露」（webConsoleExposeLogs），或当前为只读模式'
        : `读取日志失败：${result.__error || result.error || '文件不存在或已被删除'}`;
      setStatus(message);
      if (!retried && (result.__errorStatus === 404 || /删除|不存在/.test(result.__error || result.error || ''))) {
        const previousFile = state.currentFile;
        await loadFileList();
        if (state.currentFile && state.currentFile !== previousFile) {
          await loadTail({ ...options, retried: true });
        }
      }
      return;
    }
    applyWindow(result, { scrollToBottom: options.scrollToBottom !== false });
  }

  async function loadOlder() {
    if (state.olderLoading || !state.currentFile) return;
    const nextStart = Math.max(0, state.windowStart - state.limit);
    if (nextStart >= state.windowStart) return;
    state.olderLoading = true;
    updateOlderButton();
    const wrap = document.querySelector('.bot-logs-viewer-wrap');
    const anchorOffset = wrap.scrollTop;
    const result = await fetchJsonSafe(`/api/bot-logs/read?file=${encodeURIComponent(state.currentFile)}&mode=window&startLine=${nextStart}&limit=${state.limit}`, {});
    state.olderLoading = false;
    if (result.success !== true) {
      setStatus(`加载更早失败：${result.__error || result.error || '未知错误'}`);
      updateOlderButton();
      return;
    }
    if (result.windowEnd < state.windowStart) {
      // 新旧窗口不连续（文件被截断轮转），直接整体替换
      applyWindow(result, { scrollToBottom: false });
      return;
    }
    const newLines = (result.lines || []).map((text, index) => {
      const clean = stripAnsi(text);
      return {
        text: clean,
        level: detectLevel(clean),
        globalLine: result.windowStart + index,
      };
    });
    const keptCount = Math.max(0, Math.min(state.lines.length, state.windowEnd - result.windowEnd));
    const keptLines = state.lines.slice(state.lines.length - keptCount);
    state.lines = newLines.concat(keptLines);
    state.windowStart = result.windowStart;
    state.windowEnd = result.windowEnd;
    state.truncated = result.truncated === true;
    state.prefixTruncated = result.prefixTruncated === true;
    state.readLines = result.readLines || state.readLines;
    state.lastRefreshAt = new Date().toISOString();
    renderLines();
    updateOlderButton();
    updatePrefixNotice();
    setStatus(buildStatusLine({ size: result.size, mtime: result.mtime }));
    // 恢复视口位置：内容在顶部插入后，原 anchor 行偏移 = 插入行数 * 行高
    const insertedLines = newLines.length;
    wrap.scrollTop = anchorOffset + insertedLines * 19.6;
  }

  function applyWindow(result, options = {}) {
    state.windowStart = Number(result.windowStart || 0);
    state.windowEnd = Number(result.windowEnd || 0);
    state.truncated = result.truncated === true;
    state.prefixTruncated = result.prefixTruncated === true;
    state.readLines = Number(result.readLines || 0);
    state.lastRefreshAt = new Date().toISOString();
    state.lines = (result.lines || []).map((text, index) => {
      const clean = stripAnsi(text);
      return {
        text: clean,
        level: detectLevel(clean),
        globalLine: state.windowStart + index,
      };
    });
    renderLines();
    updateOlderButton();
    updatePrefixNotice();
    setStatus(buildStatusLine({ size: result.size, mtime: result.mtime }));
    if (options.scrollToBottom) {
      const wrap = document.querySelector('.bot-logs-viewer-wrap');
      wrap.scrollTop = wrap.scrollHeight;
    }
  }

  function scheduleAutoRefresh() {
    clearAutoRefresh();
    const enabled = document.getElementById('bot-logs-auto-refresh').checked;
    if (!enabled || !state.currentFile) return;
    state.autoRefreshTimer = setInterval(() => {
      if (document.hidden) return;
      loadTail({ scrollToBottom: true });
    }, state.autoRefreshMs);
  }

  function clearAutoRefresh() {
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
  }

  async function refreshAll() {
    state.sessionKey += 1;
    const ok = await loadFileList();
    if (!ok) return;
    await loadTail({ scrollToBottom: true });
    scheduleAutoRefresh();
  }

  function bindEvents() {
    document.getElementById('bot-logs-refresh-btn').addEventListener('click', () => {
      if (state.currentFile) {
        loadTail({ scrollToBottom: true });
      } else {
        refreshAll();
      }
    });
    document.getElementById('bot-logs-file-select').addEventListener('change', (event) => {
      state.currentFile = event.target.value;
      loadTail({ scrollToBottom: true });
    });
    document.getElementById('bot-logs-older-btn').addEventListener('click', loadOlder);
    document.getElementById('bot-logs-auto-refresh').addEventListener('change', () => {
      if (document.getElementById('bot-logs-auto-refresh').checked) {
        loadTail({ scrollToBottom: true });
      }
      scheduleAutoRefresh();
    });
    document.getElementById('bot-logs-level-select').addEventListener('change', renderLines);
    document.getElementById('bot-logs-search-input').addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(renderLines, 200);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearAutoRefresh();
      } else if (document.getElementById('bot-logs-auto-refresh').checked) {
        if (state.currentFile) loadTail({ scrollToBottom: false });
        scheduleAutoRefresh();
      }
    });
  }

  async function init() {
    bindEvents();
    await refreshAll();
  }

  init();
})();
