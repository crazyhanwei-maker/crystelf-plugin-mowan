(function () {
  const state = {
    payload: null,
    requestId: 0,
    controller: null,
    search: '',
    status: 'all',
  };

  const ui = window.CrystelfUi || {};

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    if (typeof ui.escapeHtml === 'function') return ui.escapeHtml(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return new Intl.NumberFormat('zh-CN').format(number);
  }

  function formatTime(value) {
    if (!value) return '暂无';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function formatDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getElementValue(id, fallback = '') {
    return String($(id)?.value ?? fallback).trim();
  }

  function setText(id, text) {
    const element = $(id);
    if (element) element.textContent = text;
  }

  function showMessage(message, options = {}) {
    if (typeof window.webConsoleAlert === 'function') {
      window.webConsoleAlert(message, options);
      return;
    }
    setText('group-summary-diagnostics-meta', message);
  }

  function createAbortController() {
    return typeof AbortController === 'function' ? new AbortController() : null;
  }

  function replaceController() {
    try {
      state.controller?.abort?.();
    } catch {}
    state.controller = createAbortController();
    return state.controller;
  }

  function getCancelableOptions(controller) {
    return controller?.signal ? { signal: controller.signal, cancelOnAbort: true } : {};
  }

  function isCanceled(error) {
    return window.CrystelfRequest?.isCanceled?.(error) === true || error?.code === 'REQUEST_ABORTED' || error?.name === 'AbortError';
  }

  async function requestJson(url, options = {}) {
    if (typeof window.CrystelfRequest?.fetchJson === 'function') {
      return window.CrystelfRequest.fetchJson(url, options);
    }
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || `请求失败：HTTP ${response.status}`);
    }
    return data;
  }

  function normalizePayload(result = {}) {
    if (result?.success === false) throw new Error(result.error || '群总结诊断接口返回失败');
    const data = result?.data || result;
    return {
      checkedAt: data.checkedAt || result.checkedAt || '',
      config: data.config || {},
      summary: data.summary || {},
      recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
      groups: Array.isArray(data.groups) ? data.groups : [],
      recentResults: Array.isArray(data.recentResults) ? data.recentResults : [],
      locks: Array.isArray(data.locks) ? data.locks : [],
    };
  }

  function renderKpiCard(label, value, detail, tone = 'neutral') {
    return `
      <article class="group-summary-kpi-card tone-${escapeHtml(tone)}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(detail)}</small>
      </article>
    `;
  }

  function renderKpis(summary = {}) {
    const target = $('group-summary-kpis');
    if (!target) return;
    target.innerHTML = [
      renderKpiCard('纳入诊断', formatNumber(summary.groupCount || 0), `消息群 ${formatNumber(summary.messageGroupCount || 0)} 个`, 'neutral'),
      renderKpiCard('今日已发', formatNumber(summary.sentCount || 0), `跳过 ${formatNumber(summary.skippedCount || 0)} 个`, summary.sentCount > 0 ? 'success' : 'neutral'),
      renderKpiCard('失败记录', formatNumber(summary.failedCount || 0), '今日自动总结失败数', summary.failedCount > 0 ? 'error' : 'success'),
      renderKpiCard('重复发送', formatNumber(summary.duplicateGroupCount || 0), '同群同日多次成功记录', summary.duplicateGroupCount > 0 ? 'warning' : 'success'),
      renderKpiCard('运行锁', formatNumber(summary.activeLockCount || 0), `过期锁 ${formatNumber(summary.staleLockCount || 0)} 个`, summary.activeLockCount > 0 || summary.staleLockCount > 0 ? 'warning' : 'success'),
      renderKpiCard('记录消息', formatNumber(summary.totalMessages || 0), `阈值 ${formatNumber(summary.minMessages || 0)} 条`, 'neutral'),
    ].join('');
  }

  function getToneClass(tone = 'neutral') {
    if (tone === 'error') return 'tone-error';
    if (tone === 'warning' || tone === 'warn') return 'tone-warning';
    if (tone === 'success') return 'tone-success';
    if (tone === 'muted' || tone === 'disabled') return 'tone-muted';
    return 'tone-neutral';
  }

  function renderPill(text, tone = 'neutral') {
    return `<span class="group-summary-pill ${getToneClass(tone)}">${escapeHtml(text)}</span>`;
  }

  function renderRecommendations(payload = {}) {
    const target = $('group-summary-recommendations');
    if (!target) return;
    const items = Array.isArray(payload.recommendations) ? payload.recommendations : [];
    target.innerHTML = items.length > 0
      ? items.map(item => `<div class="group-summary-recommendation">${escapeHtml(item)}</div>`).join('')
      : '<div class="group-summary-empty">暂无排查建议。</div>';
  }

  function groupMatchesStatus(group = {}, status = 'all') {
    if (status === 'all') return true;
    if (status === 'duplicate') return Number(group.sentCount || 0) > 1;
    if (status === 'disabled') return ['disabled', 'blocked', 'not_target'].includes(group.status);
    if (status === 'failed') return group.status === 'failed' || group.run?.status === 'failed' || group.latestResult?.status === 'failed';
    if (status === 'sent') return group.status === 'sent';
    if (status === 'running') return group.status === 'running';
    if (status === 'due') return group.status === 'due' || group.status === 'waiting';
    if (status === 'insufficient') return group.status === 'insufficient';
    return true;
  }

  function groupMatchesSearch(group = {}, query = '') {
    if (!query) return true;
    const text = [
      group.groupId,
      group.groupName,
      group.statusLabel,
      group.reason,
      group.run?.error,
      group.latestResult?.error,
      group.latestResult?.summaryPreview,
      ...(Array.isArray(group.latestMessages) ? group.latestMessages.map(item => `${item.userName} ${item.userId} ${item.text}`) : []),
    ].join(' ').toLowerCase();
    return text.includes(query);
  }

  function getFilteredGroups(payload = {}) {
    const query = String(state.search || '').trim().toLowerCase();
    const status = String(state.status || 'all');
    return (Array.isArray(payload.groups) ? payload.groups : []).filter(group => groupMatchesStatus(group, status) && groupMatchesSearch(group, query));
  }

  function renderMessagePreview(messages = []) {
    const list = Array.isArray(messages) ? messages.slice(-3) : [];
    if (list.length === 0) return '<div class="group-summary-message-empty">暂无最近消息片段</div>';
    return `
      <div class="group-summary-message-preview">
        ${list.map(item => `
          <div class="group-summary-message-item">
            <span>${escapeHtml(item.userName || item.userId || '群员')}</span>
            <small>${escapeHtml(formatTime(item.time))}</small>
            <p>${escapeHtml(item.text || '')}</p>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderGroupCard(group = {}) {
    const title = group.groupName ? `${group.groupName}（${group.groupId}）` : group.groupId || '未知群';
    const run = group.run || {};
    const duplicate = Number(group.sentCount || 0) > 1;
    const lockText = group.lock?.active ? '锁定中' : group.lock?.stale ? '过期锁' : '无锁';
    return `
      <article class="group-summary-group-card ${getToneClass(group.tone)}${duplicate ? ' is-duplicate' : ''}">
        <div class="group-summary-group-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(group.reason || '暂无诊断说明')}</p>
          </div>
          <div class="group-summary-group-badges">
            ${renderPill(group.statusLabel || group.status || '未知', group.tone)}
            ${duplicate ? renderPill('重复发送', 'warning') : ''}
            ${group.selected ? renderPill('单独启用', 'success') : ''}
            ${group.blocked ? renderPill('禁用群', 'muted') : ''}
          </div>
        </div>
        <div class="group-summary-stat-row">
          <span>消息 ${escapeHtml(formatNumber(group.messageCount || 0))}</span>
          <span>成功 ${escapeHtml(formatNumber(group.sentCount || 0))}</span>
          <span>失败 ${escapeHtml(formatNumber(group.failedCount || 0))}</span>
          <span>${escapeHtml(lockText)}</span>
          <span>最近消息 ${escapeHtml(formatTime(group.lastMessageAt))}</span>
          <span>最近执行 ${escapeHtml(formatTime(run.time || group.latestResult?.time))}</span>
        </div>
        ${run.error || group.latestResult?.error ? `<div class="group-summary-error-text">${escapeHtml(run.error || group.latestResult?.error)}</div>` : ''}
        ${group.latestResult?.summaryPreview ? `<div class="group-summary-summary-preview">${escapeHtml(group.latestResult.summaryPreview)}</div>` : ''}
        ${renderMessagePreview(group.latestMessages)}
      </article>
    `;
  }

  function renderGroups(payload = {}) {
    const target = $('group-summary-group-list');
    if (!target) return;
    const groups = getFilteredGroups(payload);
    const total = Array.isArray(payload.groups) ? payload.groups.length : 0;
    setText('group-summary-list-meta', `当前显示 ${formatNumber(groups.length)} / ${formatNumber(total)} 个群。筛选不会修改任何配置。`);
    target.innerHTML = groups.length > 0
      ? groups.map(renderGroupCard).join('')
      : '<div class="group-summary-empty">当前筛选条件下没有群总结任务记录。</div>';
  }

  function renderRecentResults(payload = {}) {
    const target = $('group-summary-recent-results');
    if (!target) return;
    const items = Array.isArray(payload.recentResults) ? payload.recentResults.slice(0, 18) : [];
    if (items.length === 0) {
      target.innerHTML = '<div class="group-summary-empty">所选日期暂无群总结结果记录。</div>';
      return;
    }
    target.innerHTML = items.map(item => {
      const failed = String(item.status || '').includes('fail');
      const tone = failed ? 'error' : item.status === 'sent' || item.status === 'manual' ? 'success' : 'neutral';
      return `
        <article class="group-summary-result-card ${getToneClass(tone)}">
          <div class="group-summary-result-head">
            <strong>${escapeHtml(item.groupName || item.groupId || '未知群')}</strong>
            ${renderPill(item.status || '未知', tone)}
          </div>
          <div class="group-summary-stat-row">
            <span>${escapeHtml(formatTime(item.time))}</span>
            <span>消息 ${escapeHtml(formatNumber(item.messageCount || 0))}</span>
            <span>${escapeHtml(item.groupId || '-')}</span>
          </div>
          ${item.error ? `<div class="group-summary-error-text">${escapeHtml(item.error)}</div>` : ''}
          ${item.summaryPreview ? `<p>${escapeHtml(item.summaryPreview)}</p>` : ''}
        </article>
      `;
    }).join('');
  }

  function renderLocks(payload = {}) {
    const target = $('group-summary-locks');
    if (!target) return;
    const items = Array.isArray(payload.locks) ? payload.locks : [];
    if (items.length === 0) {
      target.innerHTML = '<div class="group-summary-empty">所选日期没有运行锁。</div>';
      return;
    }
    target.innerHTML = items.map(item => {
      const tone = item.stale ? 'warning' : 'success';
      return `
        <article class="group-summary-lock-card ${getToneClass(tone)}">
          <div class="group-summary-result-head">
            <strong>${escapeHtml(item.groupId || '未知群')}</strong>
            ${renderPill(item.stale ? '过期锁' : '运行中', tone)}
          </div>
          <div class="group-summary-stat-row">
            <span>${escapeHtml(item.dateKey || '-')}</span>
            <span>${escapeHtml(formatTime(item.time))}</span>
            <span>PID ${escapeHtml(item.pid || '-')}</span>
          </div>
          ${item.lockId ? `<code>${escapeHtml(item.lockId)}</code>` : ''}
        </article>
      `;
    }).join('');
  }

  function renderPayload(payload = {}) {
    state.payload = payload;
    const summary = payload.summary || {};
    const config = payload.config || {};
    const mode = config.targetMode === 'all' ? '全部群' : '指定群';
    setText('group-summary-diagnostics-meta', `诊断日期 ${summary.dateKey || '-'}，计划时间 ${summary.scheduleTime || '-'}，范围 ${mode}，生成于 ${formatTime(payload.checkedAt)}。`);
    renderKpis(summary);
    renderRecommendations(payload);
    renderGroups(payload);
    renderRecentResults(payload);
    renderLocks(payload);
  }

  function setLoading() {
    $('group-summary-kpis').innerHTML = renderKpiCard('读取中', '...', '正在读取本地群总结记录', 'neutral');
    setText('group-summary-recommendations', '正在分析状态...');
    setText('group-summary-group-list', '正在加载群任务...');
    setText('group-summary-recent-results', '正在加载最近结果...');
    setText('group-summary-locks', '正在加载运行锁...');
  }

  async function refreshDiagnostics() {
    const requestId = ++state.requestId;
    const controller = replaceController();
    const date = getElementValue('group-summary-date', formatDateKey());
    const url = `/api/group-summary/diagnostics?date=${encodeURIComponent(date)}&limit=160`;
    const button = $('group-summary-refresh-btn');
    if (button) {
      button.disabled = true;
      button.textContent = '刷新中...';
    }
    setLoading();
    try {
      const result = await requestJson(url, getCancelableOptions(controller));
      if (requestId !== state.requestId) return null;
      const payload = normalizePayload(result);
      const dateInput = $('group-summary-date');
      if (dateInput && !dateInput.value && payload.summary?.dateKey) {
        dateInput.value = payload.summary.dateKey;
      }
      renderPayload(payload);
      return payload;
    } catch (error) {
      if (requestId !== state.requestId || isCanceled(error)) return null;
      setText('group-summary-diagnostics-meta', `群总结诊断加载失败：${error.message}`);
      const target = $('group-summary-group-list');
      if (target) target.innerHTML = `<div class="setting-error">${escapeHtml(error.message)}</div>`;
      throw error;
    } finally {
      if (requestId === state.requestId) {
        state.controller = null;
        if (button) {
          button.disabled = false;
          button.textContent = '刷新诊断';
        }
      }
    }
  }

  function copySummary() {
    const payload = state.payload;
    if (!payload) {
      showMessage('还没有可复制的诊断摘要。');
      return;
    }
    const summary = payload.summary || {};
    const recommendations = Array.isArray(payload.recommendations) ? payload.recommendations : [];
    const duplicateGroups = (payload.groups || []).filter(item => Number(item.sentCount || 0) > 1).map(item => item.groupName ? `${item.groupName}(${item.groupId})` : item.groupId);
    const failedGroups = (payload.groups || []).filter(item => item.status === 'failed' || item.run?.status === 'failed').map(item => item.groupName ? `${item.groupName}(${item.groupId})` : item.groupId);
    const text = [
      `群总结诊断：${summary.dateKey || '-'}`,
      `总群数：${summary.groupCount || 0}，已发：${summary.sentCount || 0}，失败：${summary.failedCount || 0}，重复：${summary.duplicateGroupCount || 0}`,
      `消息记录：${summary.totalMessages || 0} 条，运行锁：${summary.activeLockCount || 0}，过期锁：${summary.staleLockCount || 0}`,
      duplicateGroups.length ? `重复群：${duplicateGroups.join('、')}` : '重复群：无',
      failedGroups.length ? `失败群：${failedGroups.join('、')}` : '失败群：无',
      '建议：',
      ...recommendations.map((item, index) => `${index + 1}. ${item}`),
    ].join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      showMessage('群总结诊断摘要已复制。');
    }).catch(() => {
      showMessage(text, { title: '群总结诊断摘要' });
    });
  }

  function bindEvents() {
    $('group-summary-refresh-btn')?.addEventListener('click', () => {
      refreshDiagnostics().catch(error => showMessage(error.message || String(error)));
    });
    $('group-summary-today-btn')?.addEventListener('click', () => {
      const input = $('group-summary-date');
      if (input) input.value = formatDateKey();
      refreshDiagnostics().catch(error => showMessage(error.message || String(error)));
    });
    $('group-summary-copy-btn')?.addEventListener('click', copySummary);
    $('group-summary-date')?.addEventListener('change', () => {
      refreshDiagnostics().catch(error => showMessage(error.message || String(error)));
    });
    $('group-summary-search')?.addEventListener('input', event => {
      state.search = String(event.target.value || '');
      renderGroups(state.payload || {});
    });
    $('group-summary-status-filter')?.addEventListener('change', event => {
      state.status = String(event.target.value || 'all');
      renderGroups(state.payload || {});
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const dateInput = $('group-summary-date');
    if (dateInput && !dateInput.value) dateInput.value = formatDateKey();
    bindEvents();
    refreshDiagnostics().catch(error => {
      document.body.innerHTML = `<pre>群总结诊断初始化失败：${escapeHtml(error.message || String(error))}</pre>`;
    });
  });
})();
