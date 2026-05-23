function createDashboardAbortController() {
  return typeof AbortController === 'function' ? new AbortController() : null;
}

function abortDashboardController(controller) {
  try {
    controller?.abort?.();
  } catch {
    // Ignore abort failures in older browser runtimes.
  }
}

function replaceDashboardRefreshController() {
  abortDashboardController(state.refreshController);
  const controller = createDashboardAbortController();
  state.refreshController = controller;
  return controller;
}

function getCancelableDashboardRequestOptions(controller) {
  return controller?.signal ? { signal: controller.signal, cancelOnAbort: true } : {};
}

function isDashboardRequestCanceled(error) {
  return window.CrystelfRequest?.isCanceled?.(error) === true || error?.code === 'REQUEST_ABORTED';
}

function getDashboardRequestTimingHint() {
  const metrics = window.CrystelfRequest?.getMetrics?.();
  if (!metrics) return '';
  const recentSlowItems = Array.isArray(metrics.recentSlowItems) ? metrics.recentSlowItems : [];
  if (recentSlowItems.length <= 0) return '';
  const slowest = recentSlowItems
    .slice()
    .sort((left, right) => Number(right.elapsedMs || 0) - Number(left.elapsedMs || 0))[0];
  return ` / 慢请求 ${formatNumber(recentSlowItems.length)} 个，最慢 ${formatNumber(slowest?.elapsedMs || 0)} ms`;
}

async function refresh() {
  const requestId = ++state.refreshRequestId;
  const controller = replaceDashboardRefreshController();
  const requestOptions = getCancelableDashboardRequestOptions(controller);
  const startTime = Date.now();
  renderActiveFilters();
  setRefreshButtonsDisabled(true);
  setRefreshStatus('正在刷新控制台...', 'neutral');
  await new Promise(resolve => setTimeout(resolve, 220));
  if (requestId !== state.refreshRequestId) return;

  const filters = getFilters();
  const hasUsageLogPanel = Boolean(document.getElementById('usage-log-box'));
  const memeStatusPromise = fetchJsonSafe('/api/api-settings/test-meme', { success: false, error: '表情发图链路检测接口暂不可用' }, requestOptions);
  try {
    const [overview, health, authStatus, config, configHistory, usageLogs, affinityLogs, auditLogs, tasks, trend, imageMonitorTrend, pokeImageSummaryTrend] = await Promise.all([
      fetchJsonSafe('/api/overview', { plugin: { name: '魔丸控制台', version: '-' }, runtime: { node: '-', platform: '-' }, counts: { sessions: 0, messages: 0, profiles: 0, affinityUsers: 0 }, usage: { requestCount: 0, successCount: 0, errorCount: 0, totalTokens: 0, totalCost: 0, currencySymbol: '$', byScene: {}, imageMonitor: { requestCount: 0, successCount: 0, errorCount: 0, totalTokens: 0, tokenRatio: 0, averageTokens: 0 }, pokeImageSummary: { requestCount: 0, successCount: 0, errorCount: 0, totalTokens: 0, tokenRatio: 0, averageTokens: 0 } } }, requestOptions),
      fetchJsonSafe('/api/health', { summary: { status: 'error', issueCount: 1, errorCount: 1, warnCount: 0, checkedAt: new Date().toISOString() }, issues: [{ level: 'error', title: '健康检查接口不可用', detail: '读取 /api/health 失败' }] }, requestOptions),
      fetchJsonSafe('/api/auth/status', { loginConfigured: false, authorized: false, readOnly: false, canWrite: false, loginAttempts: { failures: 0, maxFailures: 0, remainingFailures: 0 } }, requestOptions),
      fetchJsonSafe('/api/config', { runtime: {}, editableFiles: [], configFiles: {} }, requestOptions),
      fetchJsonSafe('/api/config-history?limit=10', { items: [] }, requestOptions),
      hasUsageLogPanel
        ? fetchJsonSafe(`/api/logs/usage?query=${encodeURIComponent(filters.usageLogQuery)}&scene=${encodeURIComponent(filters.usageLogScene)}&page=${state.usageLogPage}`, { items: [], page: 1, totalPages: 1 }, requestOptions)
        : Promise.resolve({ items: [], page: 1, totalPages: 1 }),
      fetchJsonSafe(`/api/logs/affinity?query=${encodeURIComponent(filters.affinityLogQuery)}&groupId=${encodeURIComponent(filters.affinityLogGroup)}&page=${state.affinityLogPage}`, { items: [], page: 1, totalPages: 1 }, requestOptions),
      fetchJsonSafe('/api/logs/audit?pageSize=1', { items: [], total: 0, page: 1, totalPages: 1 }, requestOptions),
      fetchJsonSafe('/api/tasks', { summary: { total: 0, activeCount: 0, successCount: 0, errorCount: 0, dependencyCount: 0, pluginCount: 0 }, tasks: [] }, requestOptions),
      fetchJsonSafe('/api/trend/usage', { items: [] }, requestOptions),
      fetchJsonSafe('/api/trend/image-monitor-usage', { items: [] }, requestOptions),
      fetchJsonSafe('/api/trend/poke-image-summary', { items: [] }, requestOptions),
    ]);

    if (requestId !== state.refreshRequestId) return;

    renderOverview(overview);
    renderCollectionEntries(overview);
    renderHealth(health);
    renderConsoleHealthOverview(overview, health, null, auditLogs);
    renderOperationTaskCenter(tasks);
    renderPublicSecurityOverview(overview, authStatus);
    renderDependencies(health.dependencyReport || {});
    renderConfig(config);
    renderConfigHistory(configHistory);
    renderLogs({ usage: usageLogs, affinity: affinityLogs });
    renderTrendChart(trend);
    renderImageMonitorUsageTrend(imageMonitorTrend);
    renderPokeImageSummaryTrend(pokeImageSummaryTrend);
    if (!overview.__error) {
      fetchJsonSafe('/api/version/check', { success: false, status: 'check_failed', error: '版本检查接口暂不可用' }, requestOptions)
        .then(result => {
          if (requestId !== state.refreshRequestId) return;
          renderVersionCheck(result);
          renderConsoleHealthOverview(overview, health, result, auditLogs);
        });
      memeStatusPromise.then(result => {
        if (requestId !== state.refreshRequestId) return;
        renderMemeDeliveryOverviewCard(result);
      });
    }

    state.lastRefreshAt = Date.now();
    const errorCount = [overview, health, authStatus, config, configHistory, usageLogs, affinityLogs, auditLogs, tasks, trend, imageMonitorTrend, pokeImageSummaryTrend].filter(item => item && item.__error).length;
    const elapsedMs = Date.now() - startTime;
    setRefreshStatus(
      errorCount > 0
        ? `最近刷新：${formatTime(state.lastRefreshAt)} / ${elapsedMs} ms / ${errorCount} 个模块使用了回退数据${getDashboardRequestTimingHint()}`
        : `最近刷新：${formatTime(state.lastRefreshAt)} / ${elapsedMs} ms / 所有模块加载成功${getDashboardRequestTimingHint()}`,
      errorCount > 0 ? 'error' : 'success'
    );
  } catch (error) {
    if (requestId !== state.refreshRequestId || isDashboardRequestCanceled(error)) {
      return null;
    }
    setRefreshStatus(`刷新失败：${error.message}`, 'error');
    throw error;
  } finally {
    if (requestId === state.refreshRequestId) {
      setRefreshButtonsDisabled(false);
    }
  }
}
