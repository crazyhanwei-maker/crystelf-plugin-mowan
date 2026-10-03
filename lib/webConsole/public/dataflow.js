// 适配器数据流：轮询读取最新 Bot 日志窗口，按事件类型分类着色滚动展示。
// 数据源复用 Bot 日志查看的 /api/bot-logs/files + /api/bot-logs/read，不新建采集链路。
(function () {
  'use strict';

  const POLL_INTERVAL_MS = 2000;
  const MAX_ROWS = 600;

  const state = {
    paused: false,
    autoscroll: true,
    keyword: '',
    types: new Set(['message', 'notice', 'request', 'error', 'other']),
    fileList: null,
    activeFile: null,
    lastFileSize: 0,
    pollTimer: null,
    polling: false,
    lastError: '',
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== 事件类型识别 =====
  // Miao-Yunzai / TRSS 日志的特征：[trace][debug][info][mark][warn][error][fatal] 前缀；
  // 适配器事件行常见关键词：message sent/group、request、notice、戳一戳、召回等
  function classifyLine(line) {
    const lower = line.toLowerCase();
    if (/\[(error|fatal)\]/.test(lower) || /error:/i.test(line)) return 'error';
    if (/(message|recv|send|发消息|收到|发送)/i.test(line)) return 'message';
    if (/(notice|戳一戳|拍一拍|recall|撤回|好友申请|加群|入群|退群|group_increase|group_decrease)/i.test(line)) return 'notice';
    if (/(request|申请|邀请)/i.test(line)) return 'request';
    if (/\[(trace|debug)\]/.test(lower)) return 'debug';
    return 'other';
  }

  function isTypeVisible(type) {
    if (type === 'debug') return state.types.has('other') && false; // debug 默认归其它但日志量大，默认不算可见
    return state.types.has(type);
  }

  function renderLine(line) {
    const type = classifyLine(line);
    if (!isTypeVisible(type)) return null;
    if (state.keyword && !line.toLowerCase().includes(state.keyword)) return null;
    return `<div class="dataflow-row type-${type}">${escapeHtml(line)}</div>`;
  }

  function appendLines(lines, { reset = false } = {}) {
    const stream = el('dataflow-stream');
    if (!stream) return;
    if (reset) stream.innerHTML = '';
    const fragment = [];
    for (const line of lines) {
      const html = renderLine(line);
      if (html) fragment.push(html);
    }
    if (!fragment.length) return;
    stream.insertAdjacentHTML('beforeend', fragment.join(''));
    // 行数上限：超限从头部删
    while (stream.children.length > MAX_ROWS) stream.firstChild?.remove();
    if (state.autoscroll && !state.paused) stream.scrollTop = stream.scrollHeight;
  }

  // ===== 日志源选择与轮询 =====
  async function fetchJson(url) {
    const resp = await fetch(url);
    if (resp.status === 401) throw new Error('登录已失效，请重新登录');
    const data = await resp.json();
    if (data?.success === false) throw new Error(data?.error || '接口失败');
    return data;
  }

  async function resolveActiveFile() {
    const data = await fetchJson('/api/bot-logs/files');
    const files = Array.isArray(data?.files) ? data.files : [];
    if (!files.length) throw new Error('没有找到候选日志文件');
    // 优先级：带日期的 command.*.log（消息处理主日志）> 最新 .log（排除 .err/.out）> 第一个
    const datedCommand = files.filter(file => /command\.\d{4}-\d{2}-\d{2}\.log$/i.test(file.name || ''))
      .sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0))[0];
    const newestLog = [...files].sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0))
      .find(file => /\.log$/i.test(file.name || '') && !/\.(err|out)\.log$/i.test(file.name || ''));
    const picked = datedCommand || newestLog || files.find(file => /\.log$/i.test(file.name || '')) || files[0];
    state.fileList = files;
    state.activeFile = picked;
    state.lastFileSize = Number(picked.size || 0);
    el('dataflow-meta').textContent = `日志源：${picked.name || picked.filePath || '未知'}（每 ${POLL_INTERVAL_MS / 1000} 秒增量拉取）`;
    return picked;
  }

  function extractLines(data) {
    // readBotLogWindow 返回 { lines } 或 { content }，两种都兼容
    if (Array.isArray(data?.lines)) return data.lines.map(line => String(line));
    if (typeof data?.content === 'string') return data.content.split(/\r?\n/).filter(Boolean);
    return [];
  }

  async function pollOnce() {
    try {
      if (!state.activeFile) await resolveActiveFile();
      const file = state.activeFile;
      const query = new URLSearchParams({
        file: file.filePath || file.name || '',
        mode: 'tail',
        limit: '200',
      });
      const data = await fetchJson(`/api/bot-logs/read?${query.toString()}`);
      const lines = extractLines(data);
      const knownSize = state.lastFileSize;
      const size = Number(data?.fileSize || data?.sizeBytes || 0);
      // 无法做精确 offset：以“本轮读到的行”全量重画会闪，改为追加全部行由 MAX_ROWS 与去重兜底
      // 简化策略：tail 200 行每次覆盖式重建（行渲染很快，且行数上限 600，视觉稳定）
      appendLines(lines, { reset: true });
      if (size && knownSize && size < knownSize) {
        // 日志被轮转：重选文件
        state.activeFile = null;
      }
      state.lastFileSize = size || knownSize;
      state.lastError = '';
      el('dataflow-status').textContent = `流式更新中 · 最后刷新 ${new Date().toLocaleTimeString('zh-CN')}`;
    } catch (error) {
      state.lastError = error.message;
      el('dataflow-status').textContent = `读取失败：${error.message}`;
      // 文件失效时重选
      if (/没有找到|不存在/.test(error.message)) state.activeFile = null;
    }
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(() => {
      if (state.paused || state.polling || document.hidden) return;
      state.polling = true;
      pollOnce().finally(() => { state.polling = false; });
    }, POLL_INTERVAL_MS);
  }

  // ===== 交互绑定 =====
  function bind() {
    el('dataflow-pause-btn')?.addEventListener('click', event => {
      state.paused = !state.paused;
      const button = event.currentTarget;
      button.textContent = state.paused ? '继续' : '暂停';
      button.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
      el('dataflow-stream').classList.toggle('is-paused', state.paused);
    });
    el('dataflow-refresh-btn')?.addEventListener('click', () => {
      state.activeFile = null;
      pollOnce();
    });
    el('dataflow-keyword')?.addEventListener('input', event => {
      state.keyword = String(event.target.value || '').trim().toLowerCase();
      pollOnce();
    });
    el('dataflow-autoscroll')?.addEventListener('change', event => {
      state.autoscroll = event.target.checked === true;
    });
    document.querySelectorAll('[data-flow-filter]').forEach(box => {
      box.addEventListener('change', () => {
        const type = box.dataset.flowFilter || '';
        if (box.checked) state.types.add(type);
        else state.types.delete(type);
        pollOnce();
      });
    });
  }

  function init() {
    bind();
    pollOnce();
    startPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
