function buildImageMonitorUrl(type, query, page) {
  const params = new URLSearchParams({
    type,
    query,
    page: String(page),
  });

  if (type === 'review') {
    if (state.reviewRisk) params.set('risk', state.reviewRisk);
    if (state.reviewIsMeme) params.set('isMeme', state.reviewIsMeme);
    if (state.reviewAlerted) params.set('alerted', state.reviewAlerted);
    if (state.reviewRecalled) params.set('recalled', state.reviewRecalled);
    const groupId = getValue('image-monitor-log-group-filter');
    const userId = getValue('image-monitor-log-user-filter');
    const startAt = getValue('image-monitor-log-start-at');
    const endAt = getValue('image-monitor-log-end-at');
    if (groupId) params.set('groupId', groupId);
    if (userId) params.set('userId', userId);
    if (startAt) params.set('startAt', startAt);
    if (endAt) params.set('endAt', endAt);
  } else {
    const groupId = getValue('image-monitor-meme-group-filter');
    const userId = getValue('image-monitor-meme-user-filter');
    const startAt = getValue('image-monitor-meme-start-at');
    const endAt = getValue('image-monitor-meme-end-at');
    if (groupId) params.set('groupId', groupId);
    if (userId) params.set('userId', userId);
    if (startAt) params.set('startAt', startAt);
    if (endAt) params.set('endAt', endAt);
  }

  return `/api/logs/image-monitor?${params.toString()}`;
}

function updateFilterButtonState() {
  document.querySelectorAll('[data-review-risk]').forEach(button => {
    button.classList.toggle('active', (button.dataset.reviewRisk || '') === state.reviewRisk);
  });
  document.querySelectorAll('[data-review-is-meme]').forEach(button => {
    button.classList.toggle('active', (button.dataset.reviewIsMeme || '') === state.reviewIsMeme);
  });
  document.querySelectorAll('[data-review-alerted]').forEach(button => {
    button.classList.toggle('active', (button.dataset.reviewAlerted || '') === state.reviewAlerted);
  });
  document.querySelectorAll('[data-review-recalled]').forEach(button => {
    button.classList.toggle('active', (button.dataset.reviewRecalled || '') === state.reviewRecalled);
  });
}

function createDebouncedTask(fn, delay = 180) {
  if (typeof consoleUi.debounce === 'function') {
    return consoleUi.debounce(fn, delay);
  }
  let timer = null;
  const task = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
  task.cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  return task;
}

function createAbortController() {
  return typeof AbortController === 'function' ? new AbortController() : null;
}

function abortController(controller) {
  try {
    controller?.abort?.();
  } catch {
    // Ignore abort failures in older browser runtimes.
  }
}

function replaceRefreshController() {
  const previous = state.refreshController;
  abortController(previous);
  const controller = createAbortController();
  state.refreshController = controller;
  return controller;
}

function getCancelableRequestOptions(controller) {
  return controller?.signal ? { signal: controller.signal, cancelOnAbort: true } : {};
}

function isRequestCanceled(error) {
  return window.CrystelfRequest?.isCanceled?.(error) === true
    || error?.code === 'REQUEST_ABORTED'
    || error?.name === 'AbortError';
}

function handleRefreshError(error) {
  if (isRequestCanceled(error)) return;
  setRefreshStatus(`刷新失败：${error.message}`, 'error');
}

const runDebouncedRefresh = createDebouncedTask(() => {
  refresh().catch(handleRefreshError);
}, 180);

function scheduleRefresh(section) {
  if (section === 'review') state.reviewPage = 1;
  if (section === 'meme') state.memePage = 1;
  runDebouncedRefresh();
}

function clearAllFilters() {
  state.reviewPage = 1;
  state.memePage = 1;
  state.reviewRisk = '';
  state.reviewIsMeme = '';
  state.reviewAlerted = '';
  state.reviewRecalled = '';

  [
    'image-monitor-log-search',
    'image-monitor-log-group-filter',
    'image-monitor-log-user-filter',
    'image-monitor-log-start-at',
    'image-monitor-log-end-at',
    'image-monitor-meme-search',
    'image-monitor-meme-group-filter',
    'image-monitor-meme-user-filter',
    'image-monitor-meme-start-at',
    'image-monitor-meme-end-at',
  ].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });

  updateFilterButtonState();
  runDebouncedRefresh.cancel?.();
  refresh().catch(handleRefreshError);
}

async function downloadExport(type, params, fileName) {
  const query = new URLSearchParams({ type, ...params });
  const response = await fetch(`/api/export?${query.toString()}`, {
    cache: 'no-store',
    headers: buildHeaders(),
  });
  if (!response.ok) {
    throw new Error(`/api/export -> ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getReviewExportParams() {
  const params = {
    query: getValue('image-monitor-log-search'),
    groupId: getValue('image-monitor-log-group-filter'),
    userId: getValue('image-monitor-log-user-filter'),
    startAt: getValue('image-monitor-log-start-at'),
    endAt: getValue('image-monitor-log-end-at'),
  };
  if (state.reviewRisk) params.risk = state.reviewRisk;
  if (state.reviewIsMeme) params.isMeme = state.reviewIsMeme;
  if (state.reviewAlerted) params.alerted = state.reviewAlerted;
  if (state.reviewRecalled) params.recalled = state.reviewRecalled;
  return params;
}

function getMemeExportParams() {
  return {
    query: getValue('image-monitor-meme-search'),
    groupId: getValue('image-monitor-meme-group-filter'),
    userId: getValue('image-monitor-meme-user-filter'),
    startAt: getValue('image-monitor-meme-start-at'),
    endAt: getValue('image-monitor-meme-end-at'),
  };
}

async function refresh() {
  const requestId = ++state.refreshRequestId;
  const controller = replaceRefreshController();
  const requestOptions = getCancelableRequestOptions(controller);
  setRefreshStatus('正在刷新图片监控数据...', 'neutral');

  const reviewQuery = getValue('image-monitor-log-search');
  const memeQuery = getValue('image-monitor-meme-search');
  const startTime = Date.now();

  let overview;
  let review;
  let meme;
  try {
    [overview, review, meme] = await Promise.all([
      fetchJson('/api/overview', requestOptions),
      fetchJson(buildImageMonitorUrl('review', reviewQuery, state.reviewPage), requestOptions),
      fetchJson(buildImageMonitorUrl('meme', memeQuery, state.memePage), requestOptions),
    ]);
  } catch (error) {
    if (requestId !== state.refreshRequestId || isRequestCanceled(error)) {
      return null;
    }
    throw error;
  } finally {
    if (requestId === state.refreshRequestId) {
      state.refreshController = null;
    }
  }
  if (requestId !== state.refreshRequestId) return null;

  document.getElementById('page-meta').textContent =
    `灵晶插件 v${overview?.plugin?.version || '-'} / 图片监控与表情包入库记录`;

  updateFilterButtonState();
  renderSummaryCards(review, meme);
  renderReviewLogs(review);
  renderMemeLogs(meme);

  const elapsedMs = Date.now() - startTime;
  setRefreshStatus(
    `最近刷新：${formatTime(Date.now())} / ${elapsedMs} ms / 审核日志 ${formatNumber(review?.total || 0)} 条 / 入库记录 ${formatNumber(meme?.total || 0)} 条`,
    'success'
  );
  return { overview, review, meme };
}
