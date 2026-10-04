// 告警中心：聚合 /api/notifications（健康巡检/QQ 看门狗/版本更新），
// 浏览器本地维护历史快照（去重合并最近 100 条）、已读状态与按来源静音。
(function () {
  'use strict';

  const STORE_KEY = 'crystelf-alerts-center-v1';
  const MAX_HISTORY = 100;
  const POLL_INTERVAL_MS = 30000;

  const state = {
    history: [],   // [{ id, level, title, detail, time }]
    readIds: new Set(),
    mutedPrefixes: new Set(),
    filter: 'all',
    polling: false,
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

  function formatTime(value) {
    const ts = Date.parse(value || '');
    if (!Number.isFinite(ts)) return '—';
    const date = new Date(ts);
    const pad = input => String(input).padStart(2, '0');
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // ===== 本地存储 =====
  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      state.history = Array.isArray(raw.history) ? raw.history.slice(0, MAX_HISTORY) : [];
      state.readIds = new Set(Array.isArray(raw.readIds) ? raw.readIds : []);
      state.mutedPrefixes = new Set(Array.isArray(raw.mutedPrefixes) ? raw.mutedPrefixes : []);
    } catch {
      state.history = [];
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        history: state.history,
        readIds: [...state.readIds].slice(0, MAX_HISTORY),
        mutedPrefixes: [...state.mutedPrefixes],
      }));
    } catch {
      // 存储不可用时仅内存态
    }
  }

  function normalizeLevel(level) {
    const value = String(level || '').toLowerCase();
    if (value === 'error' || value === 'fatal') return 'error';
    if (value === 'warn' || value === 'warning') return 'warn';
    return 'info';
  }

  // ===== 历史合并：实时项按 id 去重并入（新条目插头部）=====
  function mergeIntoHistory(items) {
    const knownIds = new Set(state.history.map(item => item.id));
    let added = 0;
    for (const item of items) {
      if (!item?.id || knownIds.has(item.id)) continue;
      knownIds.add(item.id);
      state.history.unshift({
        id: String(item.id),
        level: normalizeLevel(item.level),
        title: String(item.title || '告警'),
        detail: String(item.detail || ''),
        time: String(item.time || new Date().toISOString()),
      });
      added += 1;
    }
    if (added) {
      state.history = state.history.slice(0, MAX_HISTORY);
      saveStore();
    }
    return added;
  }

  function isMuted(item) {
    return [...state.mutedPrefixes].some(prefix => item.id.startsWith(prefix));
  }

  // ===== 渲染 =====
  function visibleItems() {
    return state.history.filter(item => {
      if (isMuted(item)) return false;
      if (state.filter === 'unread') return !state.readIds.has(item.id);
      if (state.filter === 'all') return true;
      return item.level === state.filter;
    });
  }

  function renderCounts() {
    const counts = { all: 0, error: 0, warn: 0, info: 0, unread: 0 };
    for (const item of state.history) {
      if (isMuted(item)) continue;
      counts.all += 1;
      counts[item.level] += 1;
      if (!state.readIds.has(item.id)) counts.unread += 1;
    }
    document.querySelectorAll('[data-alerts-count]').forEach(span => {
      span.textContent = `(${counts[span.dataset.alertsCount] ?? 0})`;
    });
    const unreadBadge = window.parent?.document;
    void unreadBadge;
    return counts;
  }

  function renderList() {
    const list = el('alerts-list');
    if (!list) return;
    const counts = renderCounts();
    const items = visibleItems();
    el('alerts-status').textContent = `共 ${counts.all} 条告警 · 未读 ${counts.unread} · 历史保存在本浏览器（最近 ${MAX_HISTORY} 条）`;
    if (!items.length) {
      list.innerHTML = '<div class="alerts-empty">没有符合条件的告警。</div>';
      return;
    }
    list.innerHTML = items.map(item => {
      const unread = !state.readIds.has(item.id);
      const source = item.id.startsWith('health-') ? '健康巡检'
        : item.id.startsWith('watchdog-') ? 'QQ 看门狗'
          : item.id.startsWith('version-') ? '版本更新' : '其它';
      return `<div class="alert-item tone-${item.level}${unread ? ' is-unread' : ''}" data-alert-id="${escapeHtml(item.id)}">
        <span class="alert-dot" aria-hidden="true"></span>
        <div class="alert-main">
          <div class="alert-head"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(source)} · ${escapeHtml(formatTime(item.time))}${unread ? ' · 未读' : ''}</small></div>
          ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ''}
        </div>
        <button type="button" class="mini-btn" data-alert-read="${escapeHtml(item.id)}">${unread ? '标为已读' : '已读'}</button>
      </div>`;
    }).join('');
  }

  function renderAll() {
    renderCounts();
    renderList();
  }

  // ===== 拉取与动作 =====
  async function fetchOnce() {
    try {
      const resp = await fetch('/api/notifications');
      const data = await resp.json();
      const added = mergeIntoHistory(Array.isArray(data?.items) ? data.items : []);
      if (added > 0) renderAll();
      else renderCounts();
      el('alerts-status').textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN')} · ${el('alerts-status').textContent.split(' · ').pop()}`;
    } catch (error) {
      el('alerts-status').textContent = `拉取失败：${error.message}`;
    }
  }

  function markRead(id) {
    state.readIds.add(id);
    saveStore();
    renderAll();
  }

  function bind() {
    el('alerts-refresh-btn')?.addEventListener('click', fetchOnce);
    el('alerts-readall-btn')?.addEventListener('click', () => {
      state.history.forEach(item => state.readIds.add(item.id));
      saveStore();
      renderAll();
    });
    el('alerts-clear-btn')?.addEventListener('click', () => {
      state.history = [];
      state.readIds.clear();
      saveStore();
      renderAll();
    });
    document.querySelectorAll('[data-alerts-filter]').forEach(button => {
      button.addEventListener('click', () => {
        state.filter = button.dataset.alertsFilter || 'all';
        document.querySelectorAll('[data-alerts-filter]').forEach(item => item.classList.toggle('is-active', item === button));
        renderAll();
      });
    });
    document.querySelectorAll('[data-mute-prefix]').forEach(box => {
      box.addEventListener('change', () => {
        const prefix = box.dataset.mutePrefix || '';
        if (box.checked) state.mutedPrefixes.add(prefix);
        else state.mutedPrefixes.delete(prefix);
        saveStore();
        renderAll();
      });
    });
    el('alerts-list')?.addEventListener('click', event => {
      const button = event.target.closest?.('[data-alert-read]');
      if (button) markRead(button.dataset.alertRead || '');
    });
  }

  function init() {
    loadStore();
    // 恢复静音勾选态
    document.querySelectorAll('[data-mute-prefix]').forEach(box => {
      box.checked = state.mutedPrefixes.has(box.dataset.mutePrefix || '');
    });
    bind();
    fetchOnce();
    setInterval(() => {
      if (!document.hidden && !state.polling) {
        state.polling = true;
        fetchOnce().finally(() => { state.polling = false; });
      }
    }, POLL_INTERVAL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
