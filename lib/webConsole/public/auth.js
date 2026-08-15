(function () {
  const AUTH_STATUS_ENDPOINT = '/api/auth/status';
  const AUTH_LOGIN_ENDPOINT = '/api/auth/login';
  const AUTH_LOGIN_TICKET_ENDPOINT = '/api/auth/login-ticket';
  const AUTH_LOGOUT_ENDPOINT = '/api/auth/logout';
  const LOGIN_PAGE = '/login.html';
  const state = {
    status: null,
    statusPromise: null,
  };

  function getRedirectPath() {
    const current = `${window.location.pathname || '/index.html'}${window.location.search || ''}${window.location.hash || ''}`;
    if (!current.startsWith('/') || current.startsWith('//') || current.startsWith(LOGIN_PAGE)) {
      return '/index.html';
    }
    return current;
  }

  function getRequestedRedirectPath() {
    const params = new URLSearchParams(window.location.search);
    const redirect = String(params.get('redirect') || '').trim();
    if (!redirect.startsWith('/') || redirect.startsWith('//') || redirect.startsWith(LOGIN_PAGE)) {
      return '/index.html';
    }
    return redirect;
  }

  function redirectToLogin(target = getRedirectPath()) {
    const redirect = target || '/index.html';
    window.location.href = `${LOGIN_PAGE}?redirect=${encodeURIComponent(redirect)}`;
  }

  function redirectToBootstrap() {
    window.location.href = '/plugin-settings.html?bootstrap=1';
  }

  function redirectAfterLogin() {
    window.location.href = getRequestedRedirectPath();
  }

  function isGuardedPage() {
    return document.body?.classList.contains('auth-guarded-page') === true;
  }

  function revealGuardedPage() {
    if (isGuardedPage()) {
      document.body.classList.add('auth-ready');
    }
  }

  function shouldSkipAuthStatusForWrite(pathname) {
    return pathname === AUTH_STATUS_ENDPOINT
      || pathname === AUTH_LOGIN_ENDPOINT
      || pathname === AUTH_LOGIN_TICKET_ENDPOINT
      || pathname === AUTH_LOGOUT_ENDPOINT;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init) {
    const originalUrl = input instanceof Request ? input.url : String(input || '');
    const resolvedUrl = new URL(originalUrl, window.location.origin);
    const method = String(
      input instanceof Request
        ? input.method
        : init?.method || 'GET',
    ).toUpperCase();
    const nextInit = {
      credentials: 'same-origin',
      ...(init || {}),
    };
    if (
      resolvedUrl.origin === window.location.origin
      && !['GET', 'HEAD', 'OPTIONS'].includes(method)
      && !state.status
      && !shouldSkipAuthStatusForWrite(resolvedUrl.pathname)
    ) {
      await fetchAuthStatus().catch(() => null);
    }

    if (
      resolvedUrl.origin === window.location.origin
      && !['GET', 'HEAD', 'OPTIONS'].includes(method)
      && state.status?.authorized
      && state.status?.csrfToken
    ) {
      const headers = new Headers(nextInit.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('X-Crystelf-CSRF')) {
        headers.set('X-Crystelf-CSRF', state.status.csrfToken);
      }
      nextInit.headers = headers;
    }
    const response = await nativeFetch(input, nextInit);
    if (
      response.status === 401
      && resolvedUrl.pathname !== AUTH_LOGIN_ENDPOINT
      && !window.location.pathname.endsWith(LOGIN_PAGE)
    ) {
      redirectToLogin();
    }
    return response;
  };

  async function fetchAuthStatus() {
    if (state.statusPromise) {
      return await state.statusPromise;
    }
    state.statusPromise = (async () => {
      let response;
      try {
        response = await nativeFetch(AUTH_STATUS_ENDPOINT, { cache: 'no-store', credentials: 'same-origin' });
      } catch (error) {
        throw normalizeRequestFailure(error, { url: AUTH_STATUS_ENDPOINT });
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw buildRequestError(AUTH_STATUS_ENDPOINT, response, data);
      }
      state.status = data;
      return data;
    })();
    try {
      return await state.statusPromise;
    } finally {
      state.statusPromise = null;
    }
  }

  async function login(token) {
    let response;
    try {
      response = await nativeFetch(AUTH_LOGIN_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: String(token || '').trim() }),
      });
    } catch (error) {
      throw normalizeRequestFailure(error, { url: AUTH_LOGIN_ENDPOINT });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw buildRequestError(AUTH_LOGIN_ENDPOINT, response, data);
    }
    state.status = data;
    return data;
  }

  async function consumeLoginTicket(ticket) {
    const value = String(ticket || '').trim();
    if (!value) {
      throw createRequestError('缺少一次性登录票据', {
        code: 'LOGIN_TICKET_REQUIRED',
        url: AUTH_LOGIN_TICKET_ENDPOINT,
      });
    }

    const url = `${AUTH_LOGIN_TICKET_ENDPOINT}?ticket=${encodeURIComponent(value)}`;
    let response;
    try {
      response = await nativeFetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch (error) {
      throw normalizeRequestFailure(error, { url });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw buildRequestError(AUTH_LOGIN_TICKET_ENDPOINT, response, data);
    }
    state.status = data;
    return data;
  }

  async function logout() {
    const csrfToken = state.status?.csrfToken || '';
    state.status = null;
    try {
      const headers = new Headers();
      if (csrfToken) {
        headers.set('X-Crystelf-CSRF', csrfToken);
      }
      await nativeFetch(AUTH_LOGOUT_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
      });
    } catch {
      // Ignore logout request failures and clear the local state anyway.
    }
  }

  function buildRequestHeaders(extra = {}) {
    if (extra instanceof Headers) {
      return Object.fromEntries(extra.entries());
    }
    if (Array.isArray(extra)) {
      return Object.fromEntries(extra);
    }
    return { ...(extra || {}) };
  }

  const REQUEST_TIMING_LIMIT = 80;
  const REQUEST_DEFAULT_SLOW_THRESHOLD_MS = 1500;
  const REQUEST_SLOW_THRESHOLD_STORAGE_KEY = 'crystelf-web-console-request-slow-threshold';
  const REQUEST_SLOW_THRESHOLD_OPTIONS = [800, 1500, 3000, 5000];
  const REQUEST_RECENT_WINDOW_MS = 60000;
  let requestSlowThresholdMs = readRequestSlowThreshold();
  const requestTimingState = {
    sequence: 0,
    activeCount: 0,
    totalCount: 0,
    successCount: 0,
    errorCount: 0,
    canceledCount: 0,
    slowCount: 0,
    items: [],
    changedAt: 0,
  };
  const FRONTEND_ERROR_LIMIT = 80;
  const FRONTEND_ERROR_RECENT_WINDOW_MS = 10 * 60 * 1000;
  const FRONTEND_ERROR_STACK_LIMIT = 3200;
  const FRONTEND_ERROR_MESSAGE_LIMIT = 480;
  const FRONTEND_ERROR_DEDUPE_WINDOW_MS = 1500;
  const FRONTEND_ERROR_STORAGE_KEY = 'crystelf-web-console-frontend-errors';
  const FRONTEND_ERROR_STORAGE_VERSION = 1;
  const PAGE_LOAD_EXPECTED_VERSION_KEY = 'crystelf-web-console-page-resource-version';
  const PAGE_LOAD_LAST_DIAGNOSTIC_KEY = 'crystelf-web-console-page-load-diagnostic';
  const PAGE_LOAD_RESOURCE_LIMIT = 120;
  const frontendErrorState = {
    sequence: 0,
    totalCount: 0,
    runtimeCount: 0,
    promiseCount: 0,
    requestCount: 0,
    resourceCount: 0,
    items: [],
    changedAt: 0,
  };
  const frontendErrorSignatures = new Map();

  function nowMs() {
    return typeof performance?.now === 'function' ? performance.now() : Date.now();
  }

  function trimFrontendErrorText(value = '', maxLength = FRONTEND_ERROR_MESSAGE_LIMIT) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  }

  function summarizePageLocation(value = '') {
    try {
      const parsed = new URL(String(value || window.location.href || ''), window.location.origin);
      const keys = Array.from(new Set(Array.from(parsed.searchParams.keys()))).slice(0, 8);
      const hash = String(parsed.hash || '').trim();
      const safeHash = hash && hash.length <= 80 && !hash.includes('=') ? hash : '';
      return `${parsed.pathname}${keys.length > 0 ? `?${keys.join('&')}` : ''}${safeHash}`;
    } catch {
      return window.location.pathname || '/';
    }
  }

  function getFrontendErrorKindLabel(kind = '') {
    const value = String(kind || '').trim();
    if (value === 'runtime') return '页面脚本';
    if (value === 'promise') return '异步任务';
    if (value === 'request') return '接口请求';
    if (value === 'resource') return '静态资源';
    return '前端异常';
  }

  function pruneFrontendErrorSignatures(now = Date.now()) {
    for (const [key, value] of frontendErrorSignatures.entries()) {
      const latestAt = typeof value === 'object' && value
        ? Number(value.latestAt || 0)
        : 0;
      if (latestAt + FRONTEND_ERROR_DEDUPE_WINDOW_MS < now) {
        frontendErrorSignatures.delete(key);
      }
    }
  }

  function getFrontendErrorSignature(error = {}, detail = {}) {
    const data = error || {};
    return [
      String(detail.url || data.url || ''),
      String(detail.status || data.status || ''),
      String(detail.code || data.code || ''),
      trimFrontendErrorText(detail.message || data.userMessage || data.message || data.reason || ''),
    ].join('|');
  }

  function safeDispatchFrontendErrorChange(type = 'change', detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent('crystelf-frontend-error-change', {
        detail: { type, ...detail, summary: getFrontendErrorSummary() },
      }));
    } catch {
      // Ignore event dispatch failures in older embedded browsers.
    }
  }

  function normalizeFrontendErrorItem(kind = 'runtime', error = {}, detail = {}) {
    const sourceUrl = detail.url || error?.url || error?.filename || '';
    const message = trimFrontendErrorText(
      detail.message
      || error?.userMessage
      || error?.message
      || error?.reason
      || String(error || '未知前端异常'),
    );
    const stack = trimFrontendErrorText(detail.stack || error?.stack || '', FRONTEND_ERROR_STACK_LIMIT);
    return {
      id: ++frontendErrorState.sequence,
      kind,
      kindLabel: getFrontendErrorKindLabel(kind),
      message: message || '未知前端异常',
      detail: trimFrontendErrorText(detail.detail || error?.detail || ''),
      stack,
      url: sourceUrl ? summarizeRequestUrl(sourceUrl) : '',
      pageUrl: summarizePageLocation(window.location.href),
      status: Number(detail.status || error?.status || 0) || 0,
      code: String(detail.code || error?.code || ''),
      method: String(detail.method || error?.requestTiming?.method || '').toUpperCase(),
      elapsedMs: Number(detail.elapsedMs || error?.elapsedMs || error?.requestTiming?.elapsedMs || 0) || 0,
      line: Number(detail.line || error?.lineno || 0) || 0,
      column: Number(detail.column || error?.colno || 0) || 0,
      count: 1,
      firstAt: new Date().toISOString(),
      latestAt: new Date().toISOString(),
      latestAtMs: Date.now(),
    };
  }

  function normalizeStoredFrontendErrorItem(item = {}) {
    const latestAtMs = Number(item.latestAtMs || Date.parse(item.latestAt || '') || Date.now()) || Date.now();
    const firstAtMs = Number(Date.parse(item.firstAt || '') || latestAtMs) || latestAtMs;
    const kind = ['runtime', 'promise', 'request', 'resource'].includes(item.kind) ? item.kind : 'runtime';
    return {
      id: Math.max(1, Number(item.id || 0) || 0),
      kind,
      kindLabel: getFrontendErrorKindLabel(kind),
      message: trimFrontendErrorText(item.message || '未知前端异常'),
      detail: trimFrontendErrorText(item.detail || ''),
      stack: trimFrontendErrorText(item.stack || '', FRONTEND_ERROR_STACK_LIMIT),
      url: trimFrontendErrorText(item.url || '', 240),
      pageUrl: trimFrontendErrorText(item.pageUrl || '/', 240),
      status: Number(item.status || 0) || 0,
      code: trimFrontendErrorText(item.code || '', 80),
      method: trimFrontendErrorText(item.method || '', 16).toUpperCase(),
      elapsedMs: Math.max(0, Number(item.elapsedMs || 0) || 0),
      line: Math.max(0, Number(item.line || 0) || 0),
      column: Math.max(0, Number(item.column || 0) || 0),
      count: Math.max(1, Number(item.count || 1) || 1),
      firstAt: new Date(firstAtMs).toISOString(),
      latestAt: new Date(latestAtMs).toISOString(),
      latestAtMs,
    };
  }

  function rebuildFrontendErrorCounters() {
    const items = frontendErrorState.items.slice(0, FRONTEND_ERROR_LIMIT);
    frontendErrorState.items = items;
    frontendErrorState.sequence = Math.max(0, ...items.map(item => Number(item.id || 0)));
    frontendErrorState.totalCount = items.reduce((sum, item) => sum + Math.max(1, Number(item.count || 1) || 1), 0);
    frontendErrorState.runtimeCount = items.filter(item => item.kind === 'runtime').length;
    frontendErrorState.promiseCount = items.filter(item => item.kind === 'promise').length;
    frontendErrorState.requestCount = items.filter(item => item.kind === 'request').length;
    frontendErrorState.resourceCount = items.filter(item => item.kind === 'resource').length;
    frontendErrorState.changedAt = items[0]?.latestAtMs || 0;
  }

  function persistFrontendErrorState() {
    try {
      window.localStorage.setItem(FRONTEND_ERROR_STORAGE_KEY, JSON.stringify({
        version: FRONTEND_ERROR_STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        items: frontendErrorState.items.slice(0, FRONTEND_ERROR_LIMIT),
      }));
    } catch {
      // Ignore storage failures; in-memory diagnostics still work for the current page.
    }
  }

  function removePersistedFrontendErrors() {
    try {
      window.localStorage.removeItem(FRONTEND_ERROR_STORAGE_KEY);
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }

  function restoreFrontendErrorsFromStorage() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(FRONTEND_ERROR_STORAGE_KEY) || '{}');
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      frontendErrorState.items = items
        .map(normalizeStoredFrontendErrorItem)
        .filter(item => item.message)
        .sort((left, right) => Number(right.latestAtMs || 0) - Number(left.latestAtMs || 0))
        .slice(0, FRONTEND_ERROR_LIMIT);
      rebuildFrontendErrorCounters();
      const now = Date.now();
      frontendErrorSignatures.clear();
      frontendErrorState.items.forEach(item => {
        if (Number(item.latestAtMs || 0) + FRONTEND_ERROR_DEDUPE_WINDOW_MS >= now) {
          frontendErrorSignatures.set(getFrontendErrorSignature(item, item), { id: item.id, latestAt: item.latestAtMs });
        }
      });
    } catch {
      frontendErrorState.items = [];
      rebuildFrontendErrorCounters();
    }
  }

  function recordFrontendError(kind = 'runtime', error = {}, detail = {}) {
    if (kind === 'request' && isCanceledError(error)) {
      return null;
    }
    const now = Date.now();
    pruneFrontendErrorSignatures(now);
    const signature = getFrontendErrorSignature(error, detail);
    const duplicateMeta = frontendErrorSignatures.get(signature);
    const duplicateId = typeof duplicateMeta === 'object' && duplicateMeta
      ? duplicateMeta.id
      : duplicateMeta;
    if (duplicateId) {
      const existing = frontendErrorState.items.find(item => item.id === duplicateId);
      if (existing) {
        existing.count = Number(existing.count || 1) + 1;
        existing.latestAt = new Date(now).toISOString();
        existing.latestAtMs = now;
        frontendErrorState.changedAt = now;
        frontendErrorSignatures.set(signature, { id: duplicateId, latestAt: now });
        persistFrontendErrorState();
        safeDispatchFrontendErrorChange('duplicate', { item: existing });
        return existing;
      }
    }

    const item = normalizeFrontendErrorItem(kind, error, detail);
    frontendErrorState.totalCount += 1;
    if (kind === 'runtime') frontendErrorState.runtimeCount += 1;
    if (kind === 'promise') frontendErrorState.promiseCount += 1;
    if (kind === 'request') frontendErrorState.requestCount += 1;
    if (kind === 'resource') frontendErrorState.resourceCount += 1;
    frontendErrorState.changedAt = now;
    frontendErrorState.items.unshift(item);
    frontendErrorState.items = frontendErrorState.items.slice(0, FRONTEND_ERROR_LIMIT);
    frontendErrorSignatures.set(signature, { id: item.id, latestAt: now });
    persistFrontendErrorState();
    safeDispatchFrontendErrorChange('record', { item });
    return item;
  }

  function getFrontendErrorSummary() {
    const now = Date.now();
    const items = frontendErrorState.items.slice();
    const recentItems = items.filter(item => Number(item.latestAtMs || 0) >= now - FRONTEND_ERROR_RECENT_WINDOW_MS);
    const requestItems = items.filter(item => item.kind === 'request');
    const runtimeItems = items.filter(item => item.kind === 'runtime');
    const promiseItems = items.filter(item => item.kind === 'promise');
    const resourceItems = items.filter(item => item.kind === 'resource');
    return {
      status: recentItems.length > 0 ? 'error' : items.length > 0 ? 'warn' : 'success',
      totalCount: frontendErrorState.totalCount,
      storedCount: items.length,
      recentCount: recentItems.length,
      runtimeCount: runtimeItems.length,
      promiseCount: promiseItems.length,
      requestCount: requestItems.length,
      resourceCount: resourceItems.length,
      latest: items[0] || null,
      recentWindowMs: FRONTEND_ERROR_RECENT_WINDOW_MS,
      changedAt: frontendErrorState.changedAt,
      items,
      recentItems,
    };
  }

  function resetFrontendErrors() {
    frontendErrorState.sequence = 0;
    frontendErrorState.totalCount = 0;
    frontendErrorState.runtimeCount = 0;
    frontendErrorState.promiseCount = 0;
    frontendErrorState.requestCount = 0;
    frontendErrorState.resourceCount = 0;
    frontendErrorState.items = [];
    frontendErrorState.changedAt = Date.now();
    frontendErrorSignatures.clear();
    removePersistedFrontendErrors();
    safeDispatchFrontendErrorChange('reset');
    return getFrontendErrorSummary();
  }

  function buildFrontendErrorDiagnostic() {
    const summary = getFrontendErrorSummary();
    return {
      generatedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent || '',
      summary: {
        status: summary.status,
        totalCount: summary.totalCount,
        storedCount: summary.storedCount,
        recentCount: summary.recentCount,
        runtimeCount: summary.runtimeCount,
        promiseCount: summary.promiseCount,
        requestCount: summary.requestCount,
        resourceCount: summary.resourceCount,
      },
      items: summary.items,
    };
  }

  function getResourceElementUrl(element) {
    if (!element) return '';
    const raw = element.getAttribute?.('src') || element.getAttribute?.('href') || '';
    try {
      return raw ? new URL(raw, window.location.href).toString() : '';
    } catch {
      return String(raw || '');
    }
  }

  function summarizePageResourceUrl(url = '') {
    try {
      const parsed = new URL(String(url || ''), window.location.origin);
      return `${parsed.pathname}${parsed.search || ''}`;
    } catch {
      return String(url || '');
    }
  }

  function getPageResourceType(element) {
    const tagName = String(element?.tagName || '').toLowerCase();
    if (tagName === 'script') return 'script';
    if (tagName === 'link') {
      const rel = String(element.getAttribute?.('rel') || '').toLowerCase();
      if (rel.includes('stylesheet')) return 'stylesheet';
      return rel || 'link';
    }
    return tagName || 'resource';
  }

  function isSameOriginPageResource(url = '') {
    try {
      return new URL(String(url || ''), window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function getPageResourceVersion(url = '') {
    try {
      return new URL(String(url || ''), window.location.href).searchParams.get('v') || '';
    } catch {
      return '';
    }
  }

  function listPageResourceItems() {
    const scripts = Array.from(document.scripts || []);
    const stylesheets = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'));
    return scripts.concat(stylesheets)
      .map(element => {
        const url = getResourceElementUrl(element);
        const sameOrigin = isSameOriginPageResource(url);
        const version = sameOrigin ? getPageResourceVersion(url) : '';
        return {
          type: getPageResourceType(element),
          url: summarizePageResourceUrl(url),
          sameOrigin,
          version,
          versioned: sameOrigin && Boolean(version),
        };
      })
      .filter(item => item.url)
      .slice(0, PAGE_LOAD_RESOURCE_LIMIT);
  }

  function readExpectedPageResourceVersion() {
    try {
      return String(window.sessionStorage.getItem(PAGE_LOAD_EXPECTED_VERSION_KEY) || '');
    } catch {
      return '';
    }
  }

  function persistExpectedPageResourceVersion(version = '') {
    try {
      const value = String(version || '').trim();
      if (value) {
        window.sessionStorage.setItem(PAGE_LOAD_EXPECTED_VERSION_KEY, value);
      }
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }

  function persistPageLoadDiagnostic(diagnostic = {}) {
    try {
      window.sessionStorage.setItem(PAGE_LOAD_LAST_DIAGNOSTIC_KEY, JSON.stringify({
        generatedAt: diagnostic.generatedAt,
        status: diagnostic.status,
        summary: diagnostic.summary,
        recommendations: diagnostic.recommendations,
      }));
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }

  function getResourceErrorItems() {
    const summary = getFrontendErrorSummary();
    return (Array.isArray(summary.items) ? summary.items : [])
      .filter(item => item.kind === 'resource')
      .slice(0, 20);
  }

  function buildPageLoadRecommendations(summary = {}, localCache = {}) {
    const recommendations = [];
    if (Number(summary.failedResourceCount || 0) > 0) {
      recommendations.push('有静态资源没有加载成功，先刷新页面；如果仍失败，重启控制台后再打开。');
    }
    if (Number(summary.versionMismatchCount || 0) > 0) {
      recommendations.push('页面脚本版本不一致，建议强制刷新。Windows 可按 Ctrl + F5，也可以先清理本机缓存。');
    }
    if (Number(summary.unversionedSameOriginCount || 0) > 0) {
      recommendations.push('有本地脚本或样式没有版本标记，刷新后仍异常时建议重启控制台，让页面重新生成资源版本。');
    }
    if (Number(localCache.count || 0) > 0) {
      recommendations.push(`当前浏览器保存了 ${localCache.count} 项控制台本机缓存。页面显示旧内容时，可以清理本机缓存后刷新。`);
    }
    if (recommendations.length <= 0) {
      recommendations.push('当前页面资源版本和加载状态看起来正常。遇到旧页面时，刷新页面即可重新确认。');
    }
    return recommendations;
  }

  function getPageLoadDiagnostics() {
    const resources = listPageResourceItems();
    const sameOriginResources = resources.filter(item => item.sameOrigin);
    const versionedResources = sameOriginResources.filter(item => item.versioned);
    const versions = Array.from(new Set(versionedResources.map(item => item.version).filter(Boolean)));
    const expectedVersion = versions.length === 1 ? versions[0] : readExpectedPageResourceVersion();
    if (versions.length === 1) {
      persistExpectedPageResourceVersion(versions[0]);
    }
    const versionMismatchItems = expectedVersion
      ? versionedResources.filter(item => item.version && item.version !== expectedVersion)
      : [];
    const unversionedSameOriginItems = sameOriginResources.filter(item => !item.versioned);
    const failedResourceItems = getResourceErrorItems();
    const localCache = getLocalCacheSummary();
    const summary = {
      totalResourceCount: resources.length,
      sameOriginResourceCount: sameOriginResources.length,
      versionedResourceCount: versionedResources.length,
      unversionedSameOriginCount: unversionedSameOriginItems.length,
      distinctVersionCount: versions.length,
      versionMismatchCount: versionMismatchItems.length,
      failedResourceCount: failedResourceItems.length,
      expectedVersion,
      cacheItemCount: Number(localCache.count || 0),
      cacheBytes: Number(localCache.totalBytes || 0),
      cacheBytesLabel: localCache.totalBytesLabel || '0 B',
    };
    const status = summary.failedResourceCount > 0 || summary.versionMismatchCount > 0
      ? 'error'
      : summary.distinctVersionCount > 1 || summary.unversionedSameOriginCount > 0
        ? 'warn'
        : 'success';
    const diagnostic = {
      generatedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent || '',
      status,
      summary,
      recommendations: buildPageLoadRecommendations(summary, localCache),
      resources,
      failedResourceItems,
      versionMismatchItems,
      unversionedSameOriginItems,
      localCache,
    };
    persistPageLoadDiagnostic(diagnostic);
    return diagnostic;
  }

  function clearPageCacheAndReload(options = {}) {
    const result = clearLocalCacheItems();
    if (options.reload !== false) {
      window.setTimeout(() => {
        window.location.reload();
      }, Number(options.delayMs || 180));
    }
    return result;
  }

  function normalizeRequestSlowThreshold(value) {
    const number = Number(value);
    return REQUEST_SLOW_THRESHOLD_OPTIONS.includes(number)
      ? number
      : REQUEST_DEFAULT_SLOW_THRESHOLD_MS;
  }

  function readRequestSlowThreshold() {
    try {
      return normalizeRequestSlowThreshold(window.localStorage.getItem(REQUEST_SLOW_THRESHOLD_STORAGE_KEY));
    } catch {
      return REQUEST_DEFAULT_SLOW_THRESHOLD_MS;
    }
  }

  function persistRequestSlowThreshold(value) {
    try {
      window.localStorage.setItem(REQUEST_SLOW_THRESHOLD_STORAGE_KEY, String(value));
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }

  function isRequestItemSlow(item = {}, thresholdMs = requestSlowThresholdMs) {
    return item.canceled !== true && Number(item.elapsedMs || 0) >= Number(thresholdMs || REQUEST_DEFAULT_SLOW_THRESHOLD_MS);
  }

  function refreshRequestSlowCount() {
    requestTimingState.slowCount = requestTimingState.items.filter(item => isRequestItemSlow(item)).length;
  }

  function summarizeRequestUrl(url) {
    try {
      const parsed = new URL(String(url || ''), window.location.origin);
      const keys = Array.from(new Set(Array.from(parsed.searchParams.keys()))).slice(0, 6);
      return `${parsed.pathname}${keys.length > 0 ? `?${keys.join('&')}` : ''}`;
    } catch {
      return String(url || '').split('?')[0] || '-';
    }
  }

  function dispatchRequestTimingEvent(type, detail = {}) {
    const payload = { type, ...detail, metrics: getRequestMetrics() };
    window.dispatchEvent(new CustomEvent(type, { detail: payload }));
    window.dispatchEvent(new CustomEvent('crystelf-request-timing-change', { detail: payload }));
  }

  function beginRequestTiming(url, init = {}) {
    requestTimingState.activeCount += 1;
    const entry = {
      id: ++requestTimingState.sequence,
      method: String(init.method || 'GET').toUpperCase(),
      url: summarizeRequestUrl(url),
      startedAt: Date.now(),
      startedAtMs: nowMs(),
    };
    requestTimingState.changedAt = entry.startedAt;
    dispatchRequestTimingEvent('crystelf-request-timing-start', { item: entry });
    return entry;
  }

  function finishRequestTiming(entry, detail = {}) {
    if (!entry) return null;
    const elapsedMs = Math.max(0, Math.round(nowMs() - Number(entry.startedAtMs || nowMs())));
    const canceled = detail.canceled === true;
    const success = detail.success === true;
    const status = Number(detail.status || 0) || 0;
    const item = {
      id: entry.id,
      method: entry.method,
      url: entry.url,
      status,
      success,
      canceled,
      code: String(detail.code || ''),
      error: String(detail.error || ''),
      elapsedMs,
      slow: !canceled && elapsedMs >= requestSlowThresholdMs,
      startedAt: entry.startedAt,
      finishedAt: Date.now(),
    };
    requestTimingState.activeCount = Math.max(0, requestTimingState.activeCount - 1);
    requestTimingState.totalCount += 1;
    if (success) requestTimingState.successCount += 1;
    if (canceled) requestTimingState.canceledCount += 1;
    if (!success && !canceled) requestTimingState.errorCount += 1;
    if (item.slow) requestTimingState.slowCount += 1;
    requestTimingState.changedAt = item.finishedAt;
    requestTimingState.items.unshift(item);
    requestTimingState.items = requestTimingState.items.slice(0, REQUEST_TIMING_LIMIT);

    if (detail.errorObject && typeof detail.errorObject === 'object') {
      detail.errorObject.elapsedMs = elapsedMs;
      detail.errorObject.requestTiming = item;
    }

    dispatchRequestTimingEvent('crystelf-request-timing', { item });
    return item;
  }

  function getRequestMetrics() {
    const thresholdMs = requestSlowThresholdMs;
    const items = requestTimingState.items.map(item => ({
      ...item,
      slow: isRequestItemSlow(item, thresholdMs),
    }));
    const completedItems = items.filter(item => !item.canceled);
    const elapsedTotal = completedItems.reduce((sum, item) => sum + Number(item.elapsedMs || 0), 0);
    const recentBoundary = Date.now() - REQUEST_RECENT_WINDOW_MS;
    const recentItems = items.filter(item => Number(item.finishedAt || 0) >= recentBoundary);
    const slowItems = items.filter(item => item.slow).slice(0, 12);
    const recentSlowItems = recentItems.filter(item => item.slow);
    const slowCount = items.filter(item => item.slow).length;
    return {
      thresholdMs,
      thresholdOptions: REQUEST_SLOW_THRESHOLD_OPTIONS.slice(),
      recentWindowMs: REQUEST_RECENT_WINDOW_MS,
      activeCount: requestTimingState.activeCount,
      totalCount: requestTimingState.totalCount,
      successCount: requestTimingState.successCount,
      errorCount: requestTimingState.errorCount,
      canceledCount: requestTimingState.canceledCount,
      slowCount,
      averageMs: completedItems.length > 0 ? Math.round(elapsedTotal / completedItems.length) : 0,
      latest: items[0] || null,
      slowItems,
      recentSlowItems,
      recentItems,
      items,
      changedAt: requestTimingState.changedAt,
    };
  }

  function resetRequestMetrics() {
    requestTimingState.sequence = 0;
    requestTimingState.activeCount = 0;
    requestTimingState.totalCount = 0;
    requestTimingState.successCount = 0;
    requestTimingState.errorCount = 0;
    requestTimingState.canceledCount = 0;
    requestTimingState.slowCount = 0;
    requestTimingState.items = [];
    requestTimingState.changedAt = Date.now();
    dispatchRequestTimingEvent('crystelf-request-timing-reset');
  }

  function setRequestSlowThreshold(value) {
    const next = normalizeRequestSlowThreshold(value);
    requestSlowThresholdMs = next;
    persistRequestSlowThreshold(next);
    refreshRequestSlowCount();
    requestTimingState.changedAt = Date.now();
    dispatchRequestTimingEvent('crystelf-request-timing-threshold-change', { thresholdMs: next });
    return getRequestMetrics();
  }

  restoreFrontendErrorsFromStorage();

  function createRequestError(message, detail = {}) {
    const error = new Error(String(message || '请求失败，请稍后重试。'));
    error.name = 'WebConsoleRequestError';
    error.userMessage = error.message;
    error.status = Number(detail.status || 0) || 0;
    error.code = String(detail.code || '');
    error.url = String(detail.url || '');
    error.detail = String(detail.detail || '');
    error.raw = detail.raw || null;
    error.cause = detail.cause || null;
    error.elapsedMs = Number(detail.elapsedMs || 0) || 0;
    return error;
  }

  function isAbortSignalAborted(signal) {
    return Boolean(signal && signal.aborted === true);
  }

  function isCanceledError(error) {
    return Boolean(
      error
      && (
        error.code === 'REQUEST_ABORTED'
        || (error.name === 'WebConsoleRequestError' && error.code === 'REQUEST_ABORTED')
        || error.name === 'AbortError'
      )
    );
  }

  function getServerErrorMessage(data = {}) {
    return String(data?.error || data?.message || '').trim();
  }

  function buildHttpErrorMessage(url, response, data = {}) {
    const status = Number(response?.status || 0);
    const serverMessage = getServerErrorMessage(data);
    const pathname = (() => {
      try {
        return new URL(url, window.location.origin).pathname;
      } catch {
        return String(url || '');
      }
    })();

    if (status === 400) return serverMessage || '提交的内容不完整或格式不正确，请检查后再试。';
    if (status === 401) {
      if (pathname === AUTH_LOGIN_ENDPOINT) {
        return serverMessage || '登录口令不正确，请重新输入。';
      }
      return serverMessage || '登录状态已失效，请重新登录控制台。';
    }
    if (status === 403) return serverMessage || '当前账号没有权限执行这个操作，请刷新页面后重试。';
    if (status === 404) return serverMessage || '没有找到对应的数据或接口，请刷新页面后重试。';
    if (status === 409) return serverMessage || '当前数据已经变化，请刷新后再操作。';
    if (status === 413) return serverMessage || '提交内容太大，请减少内容后再试。';
    if (status === 429) return serverMessage || '操作太频繁，请稍后再试。';
    if (status >= 500) return serverMessage || '控制台后端处理失败，请查看日志后重试。';
    if (status > 0) return serverMessage || `请求失败，服务器返回 HTTP ${status}。`;
    return serverMessage || '请求失败，请稍后重试。';
  }

  function normalizeRequestFailure(error, detail = {}) {
    if (error?.name === 'WebConsoleRequestError') {
      return error;
    }
    if (error?.name === 'AbortError') {
      const canceled = detail.code === 'REQUEST_ABORTED' || detail.cancelOnAbort === true;
      return createRequestError(canceled ? '请求已取消。' : '请求超时，请稍后重试。', {
        ...detail,
        code: canceled ? 'REQUEST_ABORTED' : detail.code || 'REQUEST_TIMEOUT',
        cause: error,
      });
    }
    return createRequestError('无法连接控制台后端，请确认控制台仍在运行。', {
      ...detail,
      code: detail.code || 'NETWORK_ERROR',
      detail: error?.message || '',
      cause: error,
    });
  }

  function getErrorMessage(error, fallback = '操作失败，请稍后重试。') {
    if (error?.name === 'WebConsoleRequestError') {
      return error.userMessage || error.message || fallback;
    }
    if (error?.name === 'AbortError') {
      return '请求超时，请稍后重试。';
    }
    if (error instanceof TypeError && /fetch|network|failed|load/i.test(String(error.message || ''))) {
      return '无法连接控制台后端，请确认控制台仍在运行。';
    }
    return String(error?.userMessage || error?.message || fallback);
  }

  function escapeHtml(value) {
    // 先剥离 ANSI 颜色码（\x1b[32m 等）。TRSS-Yunzai 等日志自带颜色控制符，
    // 不剥离会在网页里渲染成「口口口」方块；普通 UI 文本不含 ESC 字符，无副作用。
    const text = String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '');
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderUiState(options = {}) {
    const kind = ['loading', 'empty', 'error', 'success', 'neutral'].includes(options.kind)
      ? options.kind
      : 'neutral';
    const title = String(options.title || (kind === 'loading' ? '正在加载...' : '暂无数据'));
    const detail = String(options.detail || '');
    const actionHtml = String(options.actionHtml || '');
    const attrs = kind === 'loading'
      ? ' role="status" aria-live="polite"'
      : ' role="status"';

    return `
      <div class="web-console-state web-console-state-${kind}"${attrs}>
        <div class="web-console-state-mark" aria-hidden="true"></div>
        <div class="web-console-state-content">
          <div class="web-console-state-title">${escapeHtml(title)}</div>
          ${detail ? `<div class="web-console-state-detail">${escapeHtml(detail)}</div>` : ''}
          ${actionHtml ? `<div class="actions web-console-state-actions">${actionHtml}</div>` : ''}
        </div>
      </div>
    `;
  }

  function setUiState(target, options = {}) {
    const element = typeof target === 'string' ? document.getElementById(target) : target;
    if (!element) return null;
    element.innerHTML = renderUiState(options);
    return element;
  }

  function debounce(fn, delay = 260) {
    let timer = null;
    let lastArgs = [];
    let lastThis = null;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const run = () => {
      const args = lastArgs;
      const context = lastThis;
      timer = null;
      lastArgs = [];
      lastThis = null;
      return fn.apply(context, args);
    };
    const debounced = function debounced(...args) {
      lastArgs = args;
      lastThis = this;
      clear();
      timer = window.setTimeout(run, delay);
    };
    debounced.cancel = () => {
      clear();
      lastArgs = [];
      lastThis = null;
    };
    debounced.flush = () => {
      if (!timer) return undefined;
      clear();
      return run();
    };
    debounced.pending = () => Boolean(timer);
    return debounced;
  }

  const LOCAL_CACHE_EXACT_ITEMS = [
    { key: 'crystelf-web-console-theme', label: '主题模式' },
    { key: 'crystelf-web-console-accent', label: '主题配色' },
    { key: 'crystelf-web-console-token', label: '旧版登录缓存' },
    { key: REQUEST_SLOW_THRESHOLD_STORAGE_KEY, label: '慢请求阈值' },
    { key: FRONTEND_ERROR_STORAGE_KEY, label: '前端错误诊断记录' },
    { key: PAGE_LOAD_EXPECTED_VERSION_KEY, label: '页面资源版本' },
    { key: PAGE_LOAD_LAST_DIAGNOSTIC_KEY, label: '页面加载诊断' },
    { key: 'crystelf_web_console_file_tree_expanded_dirs', label: '文件树展开状态' },
    { key: 'crystelf_web_console_sidebar_width', label: '文件浏览器侧栏宽度' },
    { key: 'crystelf.groupManagement.healthIgnored.v1', label: '群管理健康忽略项' },
    { key: 'crystelf-knowledge-history', label: '知识库生成历史' },
    { key: 'crystelf-feature-manage-history', label: '功能管理记录' },
    { key: 'crystelf-plugin-settings-nav-collapsed', label: '插件设置侧栏状态' },
    { key: 'crystelf-plugin-settings-skills-filter', label: '工具筛选条件' },
    { key: 'crystelf-plugin-settings-skills-expanded', label: '工具展开状态' },
    { key: 'crystelf-plugin-settings-skills-search', label: '工具搜索关键词' },
    { key: 'crystelf.qqSimulator.scenarios.v1', label: '模拟调试本机场景' },
    { key: 'crystelf.qqSimulator.serverSeen.v1', label: '模拟调试同步状态' },
    { key: 'crystelf-web-sandbox-state', label: '网页对话测试草稿' },
  ];

  const LOCAL_CACHE_PREFIX_ITEMS = [
    { prefix: 'crystelf-web-console-', label: '控制台本机设置' },
    { prefix: 'crystelf_web_console_', label: '控制台页面状态' },
    { prefix: 'crystelf-plugin-settings-', label: '插件设置页面状态' },
    { prefix: 'crystelf.qqSimulator.', label: '模拟调试本机状态' },
    { prefix: 'crystelf-web-sandbox-', label: '网页对话测试本机状态' },
    { prefix: 'crystelf.groupManagement.', label: '群管理本机状态' },
  ];

  function getStorageByteLength(value = '') {
    const text = String(value || '');
    if (typeof TextEncoder === 'function') {
      return new TextEncoder().encode(text).length;
    }
    return text.length;
  }

  function formatCacheBytes(bytes = 0) {
    const value = Math.max(0, Number(bytes || 0));
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function getLocalCacheMeta(key = '') {
    const exact = LOCAL_CACHE_EXACT_ITEMS.find(item => item.key === key);
    if (exact) return exact;
    return LOCAL_CACHE_PREFIX_ITEMS.find(item => key.startsWith(item.prefix)) || null;
  }

  function listLocalCacheItems() {
    const storage = window.localStorage;
    if (!storage) {
      return { available: false, items: [], totalBytes: 0 };
    }

    const items = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      const meta = getLocalCacheMeta(key);
      if (!meta) continue;
      const value = storage.getItem(key) || '';
      items.push({
        key,
        label: meta.label || key,
        bytes: getStorageByteLength(key) + getStorageByteLength(value),
      });
    }
    items.sort((left, right) => left.key.localeCompare(right.key));
    const totalBytes = items.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    return { available: true, items, totalBytes };
  }

  function getLocalCacheSummary() {
    try {
      const result = listLocalCacheItems();
      const labels = Array.from(new Set(result.items.map(item => item.label).filter(Boolean)));
      return {
        ...result,
        count: result.items.length,
        labels,
        totalBytesLabel: formatCacheBytes(result.totalBytes),
      };
    } catch (error) {
      return {
        available: false,
        items: [],
        count: 0,
        labels: [],
        totalBytes: 0,
        totalBytesLabel: '0 B',
        error: error?.message || '浏览器缓存不可用',
      };
    }
  }

  function clearLocalCacheItems() {
    const before = getLocalCacheSummary();
    if (!before.available) {
      return { ...before, removed: [], failed: [] };
    }

    const removed = [];
    const failed = [];
    for (const item of before.items) {
      try {
        window.localStorage.removeItem(item.key);
        removed.push(item);
      } catch (error) {
        failed.push({ ...item, error: error?.message || '清理失败' });
      }
    }

    const after = getLocalCacheSummary();
    const detail = {
      before,
      after,
      removed,
      failed,
      removedCount: removed.length,
      failedCount: failed.length,
    };
    window.dispatchEvent(new CustomEvent('crystelf-local-cache-cleared', { detail }));
    return detail;
  }

  async function parseJsonResponse(response, fallback = {}) {
    try {
      return await response.json();
    } catch {
      return fallback;
    }
  }

  function buildRequestError(url, response, data = {}) {
    return createRequestError(buildHttpErrorMessage(url, response, data), {
      status: response?.status,
      code: data?.code,
      url,
      detail: getServerErrorMessage(data),
      raw: data,
    });
  }

  async function requestJson(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const headers = buildRequestHeaders(init.headers || {});
    const cancelOnAbort = init.cancelOnAbort === true;
    const fetchInit = { ...init };
    delete fetchInit.cancelOnAbort;
    const timing = beginRequestTiming(url, { method });
    let response;
    try {
      response = await window.fetch(url, {
        cache: method === 'GET' ? 'no-store' : init.cache,
        ...fetchInit,
        headers,
      });
    } catch (error) {
      const normalized = normalizeRequestFailure(error, {
        url,
        cancelOnAbort,
        code: cancelOnAbort && isAbortSignalAborted(init.signal) ? 'REQUEST_ABORTED' : '',
      });
      finishRequestTiming(timing, {
        success: false,
        canceled: isCanceledError(normalized),
        code: normalized.code,
        error: normalized.message,
        errorObject: normalized,
      });
      recordFrontendError('request', normalized, {
        url,
        method,
        code: normalized.code,
        message: normalized.message,
        detail: normalized.detail,
      });
      throw normalized;
    }
    const data = await parseJsonResponse(response, {});
    if (!response.ok || data?.success === false) {
      const error = buildRequestError(url, response, data);
      finishRequestTiming(timing, {
        success: false,
        status: response.status,
        code: error.code,
        error: error.message,
        errorObject: error,
      });
      recordFrontendError('request', error, {
        url,
        method,
        status: response.status,
        code: error.code,
        message: error.message,
        detail: error.detail,
      });
      throw error;
    }
    finishRequestTiming(timing, { success: true, status: response.status });
    return data;
  }

  function fetchJson(url, init = {}) {
    return requestJson(url, {
      ...init,
      method: init.method || 'GET',
      headers: buildRequestHeaders(init.headers || {}),
    });
  }

  function fetchJsonSafe(url, fallback = {}, init = {}) {
    return fetchJson(url, init).catch(error => ({
      ...fallback,
      __error: getErrorMessage(error),
      __errorStatus: Number(error?.status || 0) || 0,
      __errorCode: String(error?.code || ''),
      __elapsedMs: Number(error?.elapsedMs || 0) || 0,
      __canceled: isCanceledError(error),
    }));
  }

  function postJson(url, payload = {}, init = {}) {
    return requestJson(url, {
      ...init,
      method: init.method || 'POST',
      headers: buildRequestHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        ...buildRequestHeaders(init.headers || {}),
      }),
      body: init.body ?? JSON.stringify(payload || {}),
    });
  }

  async function downloadExport(type, params = {}, fileName = '') {
    const query = new URLSearchParams({ type, ...(params || {}) });
    const requestUrl = `/api/export?${query.toString()}`;
    let response;
    try {
      response = await window.fetch(requestUrl, {
        headers: buildRequestHeaders(),
      });
    } catch (error) {
      throw normalizeRequestFailure(error, { url: requestUrl });
    }
    if (!response.ok) {
      const data = await parseJsonResponse(response, {});
      throw buildRequestError(requestUrl, response, data);
    }
    const text = await response.text();
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || `${type}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function ensureAuthPanel() {
    const shell = document.querySelector('.hero-actions-shell');
    if (!shell) {
      return null;
    }
    let panel = document.getElementById('console-auth-panel');
    if (panel) {
      return panel;
    }
    panel = document.createElement('div');
    panel.id = 'console-auth-panel';
    panel.className = 'hero-action-group console-auth-panel';
    shell.prepend(panel);
    return panel;
  }

  function ensureFloatingAuthButton() {
    const inlineContainer = document.body?.classList.contains('plugin-settings-page')
      ? document.querySelector('.hero > .actions')
      : null;
    let dock = document.querySelector('.console-floating-tools');
    if (!dock && !inlineContainer) {
      dock = document.createElement('div');
      dock.className = 'console-floating-tools';
      document.body.appendChild(dock);
    }
    let button = document.getElementById('console-auth-floating-btn');
    if (button) {
      return button;
    }
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'console-auth-floating-btn';
    button.className = inlineContainer
      ? 'console-floating-btn console-auth-floating-btn console-inline-btn'
      : 'console-floating-btn console-auth-floating-btn';
    (inlineContainer || dock).appendChild(button);
    return button;
  }

  function renderAuthUi(status) {
    const panel = ensureAuthPanel();
    const floatingButton = ensureFloatingAuthButton();
    const authorized = status?.authorized === true;
    const readOnly = status?.readOnly === true;
    const canWrite = status?.canWrite === true;
    const loginConfigured = status?.loginConfigured === true;
    const bootstrapMode = status?.bootstrapMode === true;

    if (panel) {
      const stateLabel = bootstrapMode
        ? '待初始化'
        : authorized
        ? (readOnly ? '已登录 · 只读' : '已登录')
        : loginConfigured
          ? '未登录'
          : '未配置口令';
      const desc = bootstrapMode
        ? '当前还没有登录口令。正常启动会自动生成随机口令并输出在启动日志；也可以在控制台设置页手动设置。'
        : authorized
        ? (canWrite ? '当前会话已通过验证，可以继续修改配置与执行管理操作。' : '当前会话已通过验证，但控制台处于只读模式。')
        : loginConfigured
          ? '当前控制台需要先登录后才能进入管理操作。'
          : '当前控制台还没有登录口令。请查看启动日志中的自动生成口令，或在控制台设置页手动设置。';
      panel.innerHTML = `
        <div class="hero-action-label">访问状态</div>
        <div class="console-auth-row">
          <div>
            <div class="console-auth-state">${stateLabel}</div>
            <div class="console-auth-meta">${desc}</div>
          </div>
          <div class="actions hero-actions-grid">
            <button type="button" id="console-auth-action-btn">${authorized ? '退出登录' : bootstrapMode ? '前往初始化' : '前往登录'}</button>
          </div>
        </div>
      `;
      const actionButton = document.getElementById('console-auth-action-btn');
      if (actionButton) {
        actionButton.disabled = !authorized && !loginConfigured && !bootstrapMode;
        actionButton.addEventListener('click', async () => {
          if (authorized) {
            await logout();
            redirectToLogin();
            return;
          }
          if (bootstrapMode) {
            redirectToBootstrap();
            return;
          }
          redirectToLogin();
        });
      }
    }

    if (bootstrapMode && !authorized) {
      floatingButton.disabled = false;
      floatingButton.textContent = '初始化控制台';
      floatingButton.title = '可在本机控制台手动设置登录口令；正常启动会自动生成并输出在日志';
      floatingButton.onclick = () => {
        redirectToBootstrap();
      };
      return;
    }

    if (!loginConfigured && !authorized) {
      floatingButton.textContent = '未配置口令';
      floatingButton.disabled = true;
      floatingButton.title = '请查看启动日志中的自动生成口令，或在本机控制台手动设置登录口令';
      return;
    }

    floatingButton.disabled = false;
    floatingButton.textContent = authorized ? '退出登录' : '控制台登录';
    floatingButton.title = authorized ? '退出当前控制台登录状态' : '前往控制台登录页';
    floatingButton.onclick = async () => {
      if (authorized) {
        await logout();
        redirectToLogin();
        return;
      }
      redirectToLogin();
    };
  }

  function ensureConsoleDialog() {
    let mask = document.getElementById('web-console-dialog-mask');
    if (mask) {
      return mask;
    }
    mask = document.createElement('div');
    mask.id = 'web-console-dialog-mask';
    mask.className = 'modal-mask hidden web-console-dialog-mask';
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-labelledby', 'web-console-dialog-title');
    mask.innerHTML = `
      <div class="modal-card web-console-dialog-card">
        <h3 id="web-console-dialog-title">提示</h3>
        <div id="web-console-dialog-content" class="modal-content web-console-dialog-content"></div>
        <div class="actions">
          <button type="button" id="web-console-dialog-cancel-btn">取消</button>
          <button type="button" id="web-console-dialog-confirm-btn">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(mask);
    return mask;
  }

  function openConsoleDialog(options = {}) {
    const runFallback = () => options.kind === 'confirm'
      ? window.confirm(String(options.message || options.title || '确认操作？'))
      : (window.alert(String(options.message || options.title || '提示')), true);
    if (!document.body) {
      return Promise.resolve(runFallback());
    }

    const mask = ensureConsoleDialog();
    const title = document.getElementById('web-console-dialog-title');
    const content = document.getElementById('web-console-dialog-content');
    const cancelButton = document.getElementById('web-console-dialog-cancel-btn');
    const confirmButton = document.getElementById('web-console-dialog-confirm-btn');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const kind = options.kind === 'confirm' ? 'confirm' : 'alert';

    if (!title || !content || !cancelButton || !confirmButton) {
      return Promise.resolve(runFallback());
    }

    title.textContent = String(options.title || (kind === 'confirm' ? '确认操作' : '提示'));
    content.textContent = String(options.message || '');
    cancelButton.textContent = String(options.cancelText || '取消');
    confirmButton.textContent = String(options.confirmText || '确认');
    cancelButton.classList.toggle('hidden', kind !== 'confirm');
    mask.classList.remove('hidden');

    return new Promise(resolve => {
      let settled = false;
      const cleanup = result => {
        if (settled) return;
        settled = true;
        mask.classList.add('hidden');
        mask.removeEventListener('click', handleMaskClick);
        document.removeEventListener('keydown', handleKeydown);
        cancelButton.removeEventListener('click', handleCancel);
        confirmButton.removeEventListener('click', handleConfirm);
        if (previousFocus && typeof previousFocus.focus === 'function') {
          previousFocus.focus();
        }
        resolve(result);
      };
      const handleConfirm = () => cleanup(true);
      const handleCancel = () => cleanup(false);
      const handleMaskClick = event => {
        if (event.target === mask) {
          cleanup(false);
        }
      };
      const handleKeydown = event => {
        if (event.key === 'Escape') {
          cleanup(false);
        }
      };

      mask.addEventListener('click', handleMaskClick);
      document.addEventListener('keydown', handleKeydown);
      cancelButton.addEventListener('click', handleCancel);
      confirmButton.addEventListener('click', handleConfirm);
      setTimeout(() => confirmButton.focus(), 0);
    });
  }

  async function alertConsole(message, options = {}) {
    await openConsoleDialog({
      ...options,
      kind: 'alert',
      title: options.title || '提示',
      message,
    });
  }

  function confirmConsole(message, options = {}) {
    return openConsoleDialog({
      ...options,
      kind: 'confirm',
      title: options.title || '确认操作',
      message,
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      localStorage.removeItem('crystelf-web-console-token');
    } catch {
      // Ignore storage access failures in restricted browser contexts.
    }
    try {
      const status = await fetchAuthStatus();
      if (status.bootstrapMode) {
        if (window.location.pathname.endsWith(LOGIN_PAGE)) {
          redirectToBootstrap();
          return;
        }
        revealGuardedPage();
        renderAuthUi(status);
        return;
      }
      if (!window.location.pathname.endsWith(LOGIN_PAGE)) {
        renderAuthUi(status);
        if (status.authorized) {
          revealGuardedPage();
        } else if (isGuardedPage()) {
          redirectToLogin();
        }
      }
      if (window.location.pathname.endsWith(LOGIN_PAGE) && status.authorized) {
        redirectAfterLogin();
      }
    } catch (error) {
      if (window.location.pathname.endsWith(LOGIN_PAGE)) {
        return;
      }
      console.warn('[webConsoleAuth] status failed:', error.message);
      if (isGuardedPage()) {
        redirectToLogin();
      }
    }
  });

  window.addEventListener('error', event => {
    const target = event.target;
    if (target && target !== window && target instanceof HTMLElement) {
      const source = target.getAttribute('src') || target.getAttribute('href') || '';
      recordFrontendError('resource', null, {
        message: `${target.tagName || 'RESOURCE'} 加载失败`,
        url: source,
      });
      return;
    }
    recordFrontendError('runtime', event.error || null, {
      message: event.message || '',
      url: event.filename || '',
      line: event.lineno || 0,
      column: event.colno || 0,
      stack: event.error?.stack || '',
    });
  }, true);

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    recordFrontendError('promise', reason || null, {
      message: reason?.message || String(reason || '未处理的异步异常'),
      stack: reason?.stack || '',
      code: reason?.code || '',
      status: reason?.status || 0,
      url: reason?.url || '',
      detail: reason?.detail || '',
    });
  });

  window.CrystelfAuth = {
    fetchAuthStatus,
    login,
    consumeLoginTicket,
    logout,
    redirectToLogin,
    redirectToBootstrap,
    redirectAfterLogin,
    getRequestedRedirectPath,
    getCsrfToken() {
      return String(state.status?.csrfToken || '');
    },
    get status() {
      return state.status;
    },
  };

  window.CrystelfDialog = {
    alert: alertConsole,
    confirm: confirmConsole,
  };
  window.CrystelfRequest = {
    buildHeaders: buildRequestHeaders,
    requestJson,
    fetchJson,
    fetchJsonSafe,
    postJson,
    downloadExport,
    getErrorMessage,
    normalizeError: normalizeRequestFailure,
    isCanceled: isCanceledError,
    getMetrics: getRequestMetrics,
    resetMetrics: resetRequestMetrics,
    setSlowThreshold: setRequestSlowThreshold,
  };
  window.CrystelfFrontendErrors = {
    record: recordFrontendError,
    getSummary: getFrontendErrorSummary,
    reset: resetFrontendErrors,
    buildDiagnostic: buildFrontendErrorDiagnostic,
  };
  window.CrystelfPageLoadDiagnostics = {
    getSummary: getPageLoadDiagnostics,
    buildDiagnostic: getPageLoadDiagnostics,
    clearCacheAndReload: clearPageCacheAndReload,
  };
  window.CrystelfUi = {
    escapeHtml,
    renderState: renderUiState,
    renderLoadingState(title = '正在加载...', detail = '') {
      return renderUiState({ kind: 'loading', title, detail });
    },
    renderEmptyState(title = '暂无数据', detail = '') {
      return renderUiState({ kind: 'empty', title, detail });
    },
    renderErrorState(title = '加载失败', detail = '') {
      return renderUiState({ kind: 'error', title, detail });
    },
    setState: setUiState,
    debounce,
  };
  window.CrystelfLocalCache = {
    list: listLocalCacheItems,
    getSummary: getLocalCacheSummary,
    clear: clearLocalCacheItems,
    formatBytes: formatCacheBytes,
  };
  window.webConsoleAlert = alertConsole;
  window.webConsoleConfirm = confirmConsole;
})();
