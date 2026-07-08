async function testApiConnection() {
  try {
    showSuccess('正在使用当前页面草稿测试主 API 连接...');
    updateStatusBadge('ai-main', 'testing');
    updateDraftFromInputs();
    const result = await requestApiTargetTest('ai-main', 'primary', { refreshDraft: false });
    renderApiTargetTestResult(result);
    if (result.success) {
      showSuccess(`连接测试成功，模型: ${result.model || '未知'}，延迟: ${result.latencyMs || '?'}ms`);
      updateStatusBadge('ai-main', 'connected');
    } else {
      showRisk(`连接测试失败: ${result.error || '未知错误'}`);
      updateStatusBadge('ai-main', 'failed');
    }
  } catch (error) {
    showRisk(`测试失败: ${error.message}`);
    updateStatusBadge('ai-main', 'failed');
  }
}

function badgeIdForSection(section) {
  return `status-${section}`;
}

function updateStatusBadge(section, status) {
  const badge = $(badgeIdForSection(section));
  if (!badge) return;

  badge.className = 'status-badge';
  switch (status) {
    case 'connected':
      badge.classList.add('status-connected');
      badge.textContent = 'Connected';
      break;
    case 'failed':
      badge.classList.add('status-failed');
      badge.textContent = 'Failed';
      break;
    case 'testing':
      badge.classList.add('status-testing');
      badge.textContent = 'Testing';
      break;
    case 'configured':
      badge.classList.add('status-configured');
      badge.textContent = 'Configured';
      break;
    case 'warning':
      badge.classList.add('status-warning');
      badge.textContent = 'Check';
      break;
    case 'risk':
      badge.classList.add('status-risk');
      badge.textContent = 'Risk';
      break;
    case 'disabled':
      badge.classList.add('status-disabled');
      badge.textContent = 'Disabled';
      break;
    case 'not-configured':
      badge.classList.add('status-not-configured');
      badge.textContent = 'Not configured';
      break;
    default:
      badge.textContent = '';
      break;
  }
}

function checkInitialStatus() {
  const overview = buildApiOverview();
  const statusMap = Object.fromEntries(overview.sections.map(item => [item.key, item.status]));
  const normalizeStatus = value => {
    if (value === 'critical') return 'risk';
    if (value === 'warning') return 'warning';
    if (value === 'disabled') return 'disabled';
    return 'configured';
  };

  updateStatusBadge('ai-main', normalizeStatus(statusMap['ai-main']));
  updateStatusBadge('ai-image', normalizeStatus(statusMap['ai-image']));
  updateStatusBadge('image-monitor', normalizeStatus(statusMap['image-monitor']));
  updateStatusBadge('search', normalizeStatus(statusMap['search']));
  updateStatusBadge('meme', normalizeStatus(statusMap['meme']));
}

async function testImageApi() {
  try {
    return await fetchJson('/api/api-settings/test-image');
  } catch (error) {
    return { success: false, error: `测试接口不可用：${error.message || '未知错误'}` };
  }
}

async function testImageMonitorApi() {
  try {
    return await fetchJson('/api/api-settings/test-image-monitor');
  } catch (error) {
    return { success: false, error: `测试接口不可用：${error.message || '未知错误'}` };
  }
}

async function testSearchApi() {
  try {
    return await fetchJson('/api/api-settings/test-search');
  } catch (error) {
    return { success: false, error: `测试接口不可用：${error.message || '未知错误'}` };
  }
}

function getApiTargetName(target = '') {
  return {
    'ai-main': 'AI 主对话',
    'ai-image': '图像生成',
    'image-monitor': '图片监控',
    search: '搜索工具',
    meme: '表情包',
  }[String(target || '').trim()] || '未知接口';
}

function getApiRoleName(role = '') {
  return String(role || '').trim().toLowerCase() === 'fallback' ? '备用接口' : '主接口';
}

function formatApiDiagnosticValue(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatApiDiagnosticSummary(result = {}) {
  const diagnostic = result?.diagnostic || {};
  const items = [
    diagnostic.endpointOrigin ? `主机：${diagnostic.endpointOrigin}` : '',
    diagnostic.model ? `模型：${diagnostic.model}` : '',
    diagnostic.timeoutMs ? `超时：${diagnostic.timeoutMs}ms` : '',
    diagnostic.userAgent ? `UA：${diagnostic.userAgent}` : '',
    diagnostic.apiKeyConfigured === true ? '密钥：已配置' : diagnostic.apiKeyConfigured === false ? '密钥：未配置' : '',
  ].filter(Boolean);
  return items.join('，');
}

function buildApiTargetTestRequestPayload(target, role) {
  return {
    target,
    role,
    payload: buildApiSettingsPayloadFromDraft(),
  };
}

async function requestApiTargetTest(target, role = 'primary', options = {}) {
  if (options.refreshDraft !== false) {
    updateDraftFromInputs();
  }
  return await postJson('/api/api-settings/test-target', buildApiTargetTestRequestPayload(target, role));
}

function normalizeApiTargetOutcome(result = {}) {
  const detail = result.detail || result.error || '未知错误';
  const diagnosticSummary = formatApiDiagnosticSummary(result);
  return result.success
    ? {
        status: 'success',
        detail: diagnosticSummary ? `${detail}；${diagnosticSummary}` : detail,
        payload: result,
      }
    : {
        status: 'failed',
        detail: diagnosticSummary ? `${detail}；${diagnosticSummary}` : detail,
        payload: result,
      };
}

function renderApiTargetTestResult(result = {}) {
  const container = $('api-target-test-results');
  if (!container) return;
  const success = result?.success === true;
  const running = String(result?.status || '').trim().toLowerCase() === 'running';
  const targetName = result?.label || `${getApiTargetName(result?.target)} ${getApiRoleName(result?.role)}`;
  const detail = result?.detail || result?.error || (running ? '正在测试' : success ? '连接正常' : '连接失败');
  const sourceText = result?.configSourceLabel || result?.sourceLabel || '当前页面草稿';
  const diagnostic = result?.diagnostic || {};
  const rows = [
    ['测试目标', targetName],
    ['配置来源', sourceText],
    ['测试结果', running ? '测试中' : success ? '成功' : '失败'],
    ['接口延迟', result?.latencyMs ? `${result.latencyMs} ms` : '-'],
    ['HTTP 状态', result?.httpStatus || result?.statusCode || '-'],
    ['模型', result?.model || '-'],
    ['接口主机', formatApiDiagnosticValue(diagnostic.endpointOrigin)],
    ['接口类型', formatApiDiagnosticValue(diagnostic.kind)],
    ['超时时间', diagnostic.timeoutMs ? `${diagnostic.timeoutMs} ms` : '-'],
    ['User-Agent', formatApiDiagnosticValue(diagnostic.userAgent)],
    ['密钥状态', diagnostic.apiKeyConfigured === true ? '已配置' : diagnostic.apiKeyConfigured === false ? '未配置' : '-'],
    ['内容类型', result?.contentType || '-'],
    ['说明', detail],
  ];
  if (result?.markdown) {
    rows.push(['网页读取', result.markdown.detail || result.markdown.error || (result.markdown.success ? '连接正常' : '未通过')]);
  }
  container.classList.toggle('tone-success', success && !running);
  container.classList.toggle('tone-failed', !success && !running);
  container.classList.toggle('tone-running', running);
  container.innerHTML = `
    <div class="api-target-test-result-head">
      <strong>${escapeHtml(targetName)}</strong>
      <span>${running ? '测试中' : success ? '测试成功' : '测试失败'}</span>
    </div>
    <div class="api-target-test-result-rows">
      ${rows.map(([label, value]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

async function runApiTargetTest(target, role) {
  const normalizedTarget = String(target || '').trim();
  const normalizedRole = String(role || 'primary').trim().toLowerCase() === 'fallback' ? 'fallback' : 'primary';
  const button = Array.from(document.querySelectorAll('[data-api-test-target][data-api-test-role]'))
    .find(item => item.dataset.apiTestTarget === normalizedTarget && item.dataset.apiTestRole === normalizedRole);
  try {
    updateDraftFromInputs();
    button?.setAttribute('disabled', 'disabled');
    renderApiTargetTestResult({
      target: normalizedTarget,
      role: normalizedRole,
      status: 'running',
      success: false,
      label: `${getApiTargetName(normalizedTarget)} ${getApiRoleName(normalizedRole)}`,
      configSourceLabel: '当前页面草稿',
      detail: '正在使用当前页面草稿连接接口...',
    });
    updateStatusBadge(normalizedTarget, 'testing');
    const result = await requestApiTargetTest(normalizedTarget, normalizedRole, { refreshDraft: false });
    renderApiTargetTestResult(result);
    updateStatusBadge(normalizedTarget, result.success ? 'connected' : 'failed');
    if (result.success) {
      showSuccess(`${result.label || `${getApiTargetName(normalizedTarget)} ${getApiRoleName(normalizedRole)}`} 测试成功。`);
    } else {
      showRisk(`${result.label || `${getApiTargetName(normalizedTarget)} ${getApiRoleName(normalizedRole)}`} 测试失败：${result.error || result.detail || '未知错误'}`);
    }
  } catch (error) {
    renderApiTargetTestResult({
      target: normalizedTarget,
      role: normalizedRole,
      success: false,
      error: error.message,
    });
    updateStatusBadge(normalizedTarget, 'failed');
    showRisk(`单项测试失败：${error.message}`);
  } finally {
    button?.removeAttribute('disabled');
  }
}

const API_BATCH_TEST_DEFINITIONS = [
  {
    key: 'ai-main',
    name: 'AI 主对话',
    badge: 'ai-main',
    pendingDetail: '等待测试主对话接口。',
    run: async () => {
      const result = await requestApiTargetTest('ai-main', 'primary', { refreshDraft: false });
      return normalizeApiTargetOutcome(result);
    },
  },
  {
    key: 'ai-image',
    name: '图像生成',
    badge: 'ai-image',
    pendingDetail: '等待测试生图接口。',
    getSkipReason: draft => {
      const hasTarget = draft['ai.imageConfig.imageMode'] === 'jimeng'
        ? Boolean(draft['ai.imageConfig.jimengApiUrl'])
        : Boolean(draft['ai.imageConfig.baseApi'] || draft['ai.baseApi']);
      return hasTarget ? '' : '未配置可测试的图像接口地址';
    },
    run: async () => {
      const result = await requestApiTargetTest('ai-image', 'primary', { refreshDraft: false });
      return normalizeApiTargetOutcome(result);
    },
  },
  {
    key: 'image-monitor',
    name: '图片监控',
    badge: 'image-monitor',
    pendingDetail: '等待测试图片识别接口。',
    getSkipReason: draft => (draft['imageMonitor.enabled'] && draft['imageMonitor.apiBase'])
      ? ''
      : '未启用图片监控或缺少接口地址',
    run: async () => {
      const result = await requestApiTargetTest('image-monitor', 'primary', { refreshDraft: false });
      return normalizeApiTargetOutcome(result);
    },
  },
  {
    key: 'search',
    name: '搜索工具',
    badge: 'search',
    pendingDetail: '等待测试联网搜索接口。',
    getSkipReason: draft => draft['search.enabled'] ? '' : '未启用搜索工具',
    run: async () => {
      const result = await requestApiTargetTest('search', 'primary', { refreshDraft: false });
      return normalizeApiTargetOutcome(result);
    },
  },
  {
    key: 'meme',
    name: '表情包',
    badge: 'meme',
    pendingDetail: '等待测试表情包链路。',
    getSkipReason: draft => {
      if (draft['ai.memeConfig.apiBase']) return '';
      if (draft['ai.memeConfig.localEnabled'] && draft['ai.memeConfig.localBaseDir']) {
        return '仅配置了本地目录，批量连通性不探测远程 API';
      }
      return '未配置表情包 API 或本地目录';
    },
    run: async () => {
      const result = await requestApiTargetTest('meme', 'primary', { refreshDraft: false });
      return normalizeApiTargetOutcome(result);
    },
  },
];

function formatBatchDuration(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return '-';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function getBatchStatusLabel(status) {
  return {
    pending: '等待',
    running: '测试中',
    success: '成功',
    failed: '失败',
    skipped: '跳过',
  }[status] || '未知';
}

function getBatchResultClass(status) {
  return {
    pending: 'result-pending',
    running: 'result-running',
    success: 'result-success',
    failed: 'result-failed',
    skipped: 'result-skipped',
  }[status] || 'result-pending';
}

function summarizeBatchResults(results = []) {
  return {
    total: results.length,
    successCount: results.filter(item => item.status === 'success').length,
    failedCount: results.filter(item => item.status === 'failed').length,
    skippedCount: results.filter(item => item.status === 'skipped').length,
    runningCount: results.filter(item => item.status === 'running').length,
    pendingCount: results.filter(item => item.status === 'pending').length,
    completedCount: results.filter(item => ['success', 'failed', 'skipped'].includes(item.status)).length,
  };
}

function normalizeBatchPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return {};
  const normalized = {};
  [
    'success',
    'status',
    'error',
    'detail',
    'model',
    'latencyMs',
    'statusCode',
    'timeoutMs',
    'configSource',
    'configSourceLabel',
    'remoteUsable',
    'localUsable',
    'character',
    'requestedEmotion',
    'warning',
  ].forEach(key => {
    if (payload[key] !== undefined) normalized[key] = payload[key];
  });
  if (payload.diagnostic && typeof payload.diagnostic === 'object') {
    normalized.diagnostic = {
      kind: payload.diagnostic.kind,
      endpointOrigin: payload.diagnostic.endpointOrigin,
      endpointHost: payload.diagnostic.endpointHost,
      endpointPath: payload.diagnostic.endpointPath,
      model: payload.diagnostic.model,
      timeoutMs: payload.diagnostic.timeoutMs,
      userAgent: payload.diagnostic.userAgent,
      apiKeyConfigured: payload.diagnostic.apiKeyConfigured,
    };
  }
  if (payload.markdown && typeof payload.markdown === 'object') {
    normalized.markdown = {
      success: payload.markdown.success,
      error: payload.markdown.error,
      detail: payload.markdown.detail,
      statusCode: payload.markdown.statusCode,
      latencyMs: payload.markdown.latencyMs,
      diagnostic: payload.markdown.diagnostic ? {
        kind: payload.markdown.diagnostic.kind,
        endpointOrigin: payload.markdown.diagnostic.endpointOrigin,
        endpointHost: payload.markdown.diagnostic.endpointHost,
        endpointPath: payload.markdown.diagnostic.endpointPath,
        timeoutMs: payload.markdown.diagnostic.timeoutMs,
        apiKeyConfigured: payload.markdown.diagnostic.apiKeyConfigured,
      } : undefined,
    };
  }
  if (payload.remote && typeof payload.remote === 'object') {
    normalized.remote = {
      configured: payload.remote.configured,
      reachable: payload.remote.reachable,
      httpStatus: payload.remote.httpStatus,
      contentType: payload.remote.contentType,
      latencyMs: payload.remote.latencyMs,
      error: payload.remote.error,
      resolvedUrl: payload.remote.resolvedUrl,
    };
  }
  if (payload.local && typeof payload.local === 'object') {
    normalized.local = {
      enabled: payload.local.enabled,
      resolvedBaseDir: payload.local.resolvedBaseDir,
      candidatePath: payload.local.candidatePath,
    };
  }
  if (payload.final && typeof payload.final === 'object') {
    normalized.final = {
      source: payload.final.source,
      imagePath: payload.final.imagePath,
    };
  }
  return normalized;
}

function buildBatchResult(definition) {
  return {
    key: definition.key,
    name: definition.name,
    status: 'pending',
    detail: definition.pendingDetail || '等待测试。',
    startedAt: '',
    finishedAt: '',
    durationMs: 0,
    payload: null,
  };
}

function buildBatchReportConfigSnapshot() {
  const draft = apiSettingsState.draft || {};
  return {
    aiMain: {
      baseApiConfigured: Boolean(draft['ai.baseApi']),
      apiKeyConfigured: hasSecretValue(draft['ai.apiKey'], draft['ai.apiKeyConfigured']),
      modelType: draft['ai.modelType'] || '',
      timeoutMs: Number(draft['ai.timeout'] || 0) || 0,
      userAgent: draft['ai.userAgent'] || draft['ai.defaultUserAgent'] || '',
      fallbackEnabled: draft['ai.fallbackApi.enabled'] === true,
      fallbackBaseApiConfigured: Boolean(draft['ai.fallbackApi.baseApi']),
      fallbackApiKeyConfigured: hasSecretValue(draft['ai.fallbackApi.apiKey'], draft['ai.fallbackApi.apiKeyConfigured']),
      fallbackModelType: draft['ai.fallbackApi.modelType'] || '',
    },
    image: {
      mode: draft['ai.imageConfig.imageMode'] || '',
      baseApiConfigured: Boolean(draft['ai.imageConfig.baseApi'] || draft['ai.baseApi']),
      jimengApiConfigured: Boolean(draft['ai.imageConfig.jimengApiUrl']),
      model: draft['ai.imageConfig.model'] || '',
      timeoutMs: Number(draft['ai.imageConfig.timeout'] || 0) || 0,
      fallbackEnabled: draft['ai.imageConfig.fallbackApi.enabled'] === true,
      fallbackMode: draft['ai.imageConfig.fallbackApi.imageMode'] || '',
      fallbackBaseApiConfigured: Boolean(draft['ai.imageConfig.fallbackApi.baseApi']),
      fallbackJimengApiConfigured: Boolean(draft['ai.imageConfig.fallbackApi.jimengApiUrl']),
      fallbackApiKeyConfigured: hasSecretValue(draft['ai.imageConfig.fallbackApi.apiKey'], draft['ai.imageConfig.fallbackApi.apiKeyConfigured']),
      fallbackModel: draft['ai.imageConfig.fallbackApi.model'] || '',
    },
    imageMonitor: {
      enabled: draft['imageMonitor.enabled'] === true,
      apiBaseConfigured: Boolean(draft['imageMonitor.apiBase']),
      apiKeyConfigured: hasSecretValue(draft['imageMonitor.apiKey'], draft['imageMonitor.apiKeyConfigured']),
      model: draft['imageMonitor.model'] || '',
      timeoutMs: Number(draft['imageMonitor.analysisTimeoutMs'] || 0) || 0,
      fallbackEnabled: draft['imageMonitor.fallbackApi.enabled'] === true,
      fallbackApiBaseConfigured: Boolean(draft['imageMonitor.fallbackApi.apiBase']),
      fallbackApiKeyConfigured: hasSecretValue(draft['imageMonitor.fallbackApi.apiKey'], draft['imageMonitor.fallbackApi.apiKeyConfigured']),
      fallbackModel: draft['imageMonitor.fallbackApi.model'] || '',
    },
    search: {
      enabled: draft['search.enabled'] === true,
      apiUrlConfigured: Boolean(draft['search.apiUrl']),
      apiKeyConfigured: hasSecretValue(draft['search.apiKey'], draft['search.apiKeyConfigured']),
      markdownApiConfigured: Boolean(draft['search.markdownApiUrl']),
      markdownStatusConfigured: Boolean(draft['search.markdownStatusUrl']),
      timeoutMs: Number(draft['search.timeoutMs'] || 0) || 0,
      fallbackEnabled: draft['search.fallbackApi.enabled'] === true,
      fallbackApiUrlConfigured: Boolean(draft['search.fallbackApi.apiUrl']),
      fallbackApiKeyConfigured: hasSecretValue(draft['search.fallbackApi.apiKey'], draft['search.fallbackApi.apiKeyConfigured']),
      fallbackMarkdownApiConfigured: Boolean(draft['search.fallbackApi.markdownApiUrl']),
      fallbackMarkdownStatusConfigured: Boolean(draft['search.fallbackApi.markdownStatusUrl']),
    },
    meme: {
      apiBaseConfigured: Boolean(draft['ai.memeConfig.apiBase']),
      localEnabled: draft['ai.memeConfig.localEnabled'] === true,
      localBaseDirConfigured: Boolean(draft['ai.memeConfig.localBaseDir']),
      preferLocal: draft['ai.memeConfig.preferLocal'] === true,
      fallbackEnabled: draft['ai.memeConfig.fallbackApi.enabled'] === true,
      fallbackApiBaseConfigured: Boolean(draft['ai.memeConfig.fallbackApi.apiBase']),
    },
  };
}

function buildBatchTestReport() {
  const batch = apiSettingsState.batchTest || {};
  const results = Array.isArray(batch.results) ? batch.results : [];
  const summary = summarizeBatchResults(results);
  return {
    generatedAt: new Date().toISOString(),
    pageUrl: window.location.href,
    userAgent: navigator.userAgent,
    startedAt: batch.startedAt || '',
    finishedAt: batch.finishedAt || '',
    durationMs: Number(batch.durationMs || 0) || 0,
    summary,
    configuration: buildBatchReportConfigSnapshot(),
    items: results.map(item => ({
      key: item.key,
      name: item.name,
      status: item.status,
      statusLabel: getBatchStatusLabel(item.status),
      detail: item.detail || '',
      startedAt: item.startedAt || '',
      finishedAt: item.finishedAt || '',
      durationMs: Number(item.durationMs || 0) || 0,
      payload: normalizeBatchPayload(item.payload),
    })),
  };
}

function setBatchButtonState(running) {
  const button = $('api-settings-batch-test-btn');
  if (button instanceof HTMLButtonElement) {
    button.disabled = running;
    button.textContent = running ? '批量测试中...' : '批量测试全部';
  }
}

function renderBatchTestResults() {
  const panel = $('batch-test-results');
  const listContainer = $('batch-test-list');
  const meta = $('batch-test-meta');
  const progressBar = $('batch-test-progress-bar');
  const exportButton = $('api-settings-export-batch-report-btn');
  const batch = apiSettingsState.batchTest || {};
  const results = Array.isArray(batch.results) ? batch.results : [];
  const summary = summarizeBatchResults(results);
  const progress = summary.total > 0 ? Math.round((summary.completedCount / summary.total) * 100) : 0;

  panel?.classList.remove('hidden');
  if (progressBar) progressBar.style.width = `${progress}%`;
  if (exportButton instanceof HTMLButtonElement) {
    exportButton.disabled = batch.running || summary.completedCount <= 0;
  }
  if (meta) {
    meta.textContent = batch.running
      ? `正在测试 ${summary.completedCount}/${summary.total} 项，已用时 ${formatBatchDuration(performance.now() - Number(batch.startedAtMs || 0))}。`
      : `测试完成：成功 ${summary.successCount} 项，失败 ${summary.failedCount} 项，跳过 ${summary.skippedCount} 项，总耗时 ${formatBatchDuration(batch.durationMs)}。`;
  }

  if (!listContainer) return;
  const summaryHtml = `
    <div class="batch-summary">
      <span>总计 <strong>${summary.total}</strong></span>
      <span>成功 <strong>${summary.successCount}</strong></span>
      <span>失败 <strong>${summary.failedCount}</strong></span>
      <span>跳过 <strong>${summary.skippedCount}</strong></span>
      ${batch.running ? `<span>等待 <strong>${summary.pendingCount}</strong></span>` : ''}
    </div>
  `;
  const listHtml = results.map(result => `
    <div class="batch-item ${getBatchResultClass(result.status)}">
      <div class="batch-status">${escapeHtml(getBatchStatusLabel(result.status))}</div>
      <div class="batch-main">
        <div class="batch-name">${escapeHtml(result.name)}</div>
        <div class="batch-detail">${escapeHtml(result.detail || '')}</div>
        ${result.status === 'failed' ? `<div class="batch-failure">失败原因：${escapeHtml(result.detail || '未知错误')}</div>` : ''}
      </div>
      <div class="batch-time">${escapeHtml(formatBatchDuration(result.durationMs))}</div>
    </div>
  `).join('');

  listContainer.innerHTML = `${summaryHtml}<div class="batch-list">${listHtml}</div>`;
}

async function runBatchTestItem(definition, result) {
  const skipReason = definition.getSkipReason?.(apiSettingsState.draft) || '';
  if (skipReason) {
    result.status = 'skipped';
    result.detail = skipReason;
    result.startedAt = new Date().toISOString();
    result.finishedAt = result.startedAt;
    result.durationMs = 0;
    renderBatchTestResults();
    return;
  }

  result.status = 'running';
  result.detail = '正在连接并等待返回...';
  result.startedAt = new Date().toISOString();
  result.finishedAt = '';
  result.durationMs = 0;
  updateStatusBadge(definition.badge, 'testing');
  renderBatchTestResults();

  const startedAtMs = performance.now();
  try {
    const outcome = await definition.run();
    result.status = outcome.status === 'success' ? 'success' : 'failed';
    result.detail = outcome.detail || (result.status === 'success' ? '连接正常' : '未知错误');
    result.payload = outcome.payload || null;
    updateStatusBadge(definition.badge, result.status === 'success' ? 'connected' : 'failed');
  } catch (error) {
    result.status = 'failed';
    result.detail = error.message || '测试失败';
    result.payload = { success: false, error: result.detail };
    updateStatusBadge(definition.badge, 'failed');
  } finally {
    result.durationMs = Math.round(performance.now() - startedAtMs);
    result.finishedAt = new Date().toISOString();
    apiSettingsState.testResults[result.key] = {
      success: result.status === 'success',
      detail: result.detail,
      durationMs: result.durationMs,
    };
    renderBatchTestResults();
  }
}

async function batchTestAllApis() {
  if (apiSettingsState.batchTest?.running) return;

  updateDraftFromInputs();
  hideMessages();
  const startedAtMs = performance.now();
  apiSettingsState.batchTest = {
    running: true,
    startedAt: new Date().toISOString(),
    startedAtMs,
    finishedAt: '',
    durationMs: 0,
    results: API_BATCH_TEST_DEFINITIONS.map(buildBatchResult),
  };
  setBatchButtonState(true);
  renderBatchTestResults();
  showSuccess('批量测试已开始，正在使用当前页面草稿逐项测试。');

  for (const definition of API_BATCH_TEST_DEFINITIONS) {
    const result = apiSettingsState.batchTest.results.find(item => item.key === definition.key);
    if (result) {
      await runBatchTestItem(definition, result);
    }
  }

  apiSettingsState.batchTest.running = false;
  apiSettingsState.batchTest.finishedAt = new Date().toISOString();
  apiSettingsState.batchTest.durationMs = Math.round(performance.now() - startedAtMs);
  setBatchButtonState(false);
  renderBatchTestResults();

  const summary = summarizeBatchResults(apiSettingsState.batchTest.results);
  if (summary.failedCount === 0 && summary.successCount > 0) {
    showSuccess(`批量测试完成：${summary.successCount} 项连接正常，${summary.skippedCount} 项跳过。`);
  } else if (summary.failedCount > 0) {
    showRisk(`批量测试完成：${summary.successCount} 成功，${summary.failedCount} 失败，${summary.skippedCount} 跳过。`);
  } else {
    showRisk('批量测试完成，但没有可执行的测试项。');
  }
}

function downloadBatchTestReport() {
  const report = buildBatchTestReport();
  const text = JSON.stringify(report, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `api-batch-test-report-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
