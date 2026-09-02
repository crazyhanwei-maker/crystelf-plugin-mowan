(function () {
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

  function formatTime(value) {
    const time = new Date(value || 0);
    if (!value || Number.isNaN(time.getTime())) return '—';
    return time.toLocaleString('zh-CN', { hour12: false });
  }

  function formatRelative(value) {
    const time = new Date(value || 0).getTime();
    if (!value || !Number.isFinite(time)) return '—';
    const diff = time - Date.now();
    const abs = Math.abs(diff);
    const minutes = Math.round(abs / 60000);
    const label = minutes < 60 ? `${minutes} 分钟` : `${Math.round(minutes / 60)} 小时`;
    return diff >= 0 ? `约 ${label}后` : `约 ${label}前`;
  }

  let refreshController = null;
  let runningAction = '';

  async function fetchJson(url, init) {
    const response = await fetch(url, { cache: 'no-store', ...init });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `${url} -> ${response.status}`);
    }
    return data;
  }

  function renderRecentRuns(task) {
    const runs = Array.isArray(task.recentRuns) ? task.recentRuns : [];
    if (!runs.length) return '';
    const lines = runs.slice(0, 3).map(run => {
      const tone = String(run.status || '') === 'failed' ? 'tone-failed' : 'tone-sent';
      return `<span>${escapeHtml(formatTime(run.time))} · 群 ${escapeHtml(run.groupName || run.groupId)} · <strong class="${tone}">${escapeHtml(run.status || '-')}</strong></span>`;
    }).join('');
    return `<div class="task-center-recent"><span class="task-center-meta-line">最近执行：</span>${lines}</div>`;
  }

  function renderTaskCard(task) {
    const stateClass = String(task.status || '').startsWith('en') ? 'is-enabled' : 'is-disabled';
    const detailFacts = Object.entries(task.detail || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => {
        const labels = {
          enabledGroups: '启用范围',
          sentToday: '今日已发送',
          failedToday: '今日失败',
          retentionDays: '保留天数',
          feedCount: '订阅源数',
        };
        const label = labels[key] || key;
        const text = key === 'enabledGroups'
          ? String(value)
          : key === 'feedCount'
            ? `${value} 个`
            : key === 'retentionDays'
              ? `${value} 天`
              : `${value} 次`;
        return `<span>${label} <b>${escapeHtml(text)}</b></span>`;
      })
      .join('');
    const manual = task.manual?.supported
      ? `<button type="button" class="mini-btn task-center-run-btn" data-action="${escapeHtml(task.manual.action)}" ${runningAction === task.manual.action ? 'disabled' : ''}>${escapeHtml(task.manual.label)}</button>`
      : '';
    const nextRun = task.nextRunAt
      ? `<span class="next-run">下次运行：${escapeHtml(formatTime(task.nextRunAt))}（${escapeHtml(formatRelative(task.nextRunAt))}）</span>`
      : '';
    return `
      <div class="task-center-card ${task.status === 'enabled' ? '' : 'is-disabled'}">
        <div class="task-center-card-main">
          <div class="task-center-card-head">
            <strong>${escapeHtml(task.name || task.id)}</strong>
            <span class="task-center-state ${stateClass}">${escapeHtml(task.statusLabel || '-')}</span>
            <span class="task-center-meta-line">${escapeHtml(task.schedule || '')}</span>
          </div>
          <div class="task-center-card-desc">${escapeHtml(task.description || '')}</div>
          ${detailFacts ? `<div class="task-center-card-facts">${detailFacts}</div>` : ''}
          ${renderRecentRuns(task)}
        </div>
        <div class="task-center-card-actions">
          ${nextRun}
          ${manual}
        </div>
      </div>
    `;
  }

  function render(payload = {}) {
    const list = $('task-center-list');
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    if (!list) return;
    if (!tasks.length) {
      list.innerHTML = '<div class="task-center-empty">暂无定时任务。</div>';
      return;
    }
    list.innerHTML = tasks.map(renderTaskCard).join('');
    const meta = $('task-center-meta');
    if (meta) {
      meta.textContent = `共 ${tasks.length} 个定时任务 · 生成于 ${formatTime(payload.generatedAt)}`;
    }
  }

  async function loadTasks() {
    if (refreshController) refreshController.abort();
    refreshController = new AbortController();
    const list = $('task-center-list');
    try {
      const data = await fetchJson('/api/task-center', { signal: refreshController.signal });
      render(data);
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (list) list.innerHTML = `<div class="task-center-empty">任务状态加载失败：${escapeHtml(error.message || '未知错误')}</div>`;
    }
  }

  async function runAction(action) {
    if (!action || runningAction) return;
    runningAction = action;
    const list = $('task-center-list');
    document.querySelectorAll('.task-center-run-btn').forEach(btn => {
      btn.disabled = btn.dataset.action === action;
    });
    try {
      const result = await fetchJson('/api/task-center/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (ui.toast) {
        ui.toast(result.message || '已触发', 'success');
      } else {
        const meta = $('task-center-meta');
        if (meta) meta.textContent = result.message || '已触发';
      }
      await loadTasks();
    } catch (error) {
      if (ui.toast) {
        ui.toast(`执行失败：${error.message || '未知错误'}`, 'error');
      } else {
        const meta = $('task-center-meta');
        if (meta) meta.textContent = `执行失败：${error.message || '未知错误'}`;
      }
    } finally {
      runningAction = '';
      document.querySelectorAll('.task-center-run-btn').forEach(btn => {
        btn.disabled = false;
      });
    }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('.task-center-run-btn');
    if (target?.dataset.action) {
      runAction(target.dataset.action);
    }
  });

  $('task-center-refresh-btn')?.addEventListener('click', loadTasks);

  let reportText = '';

  async function generateHealthReport() {
    const box = $('health-report-box');
    const generateBtn = $('health-report-generate-btn');
    const copyBtn = $('health-report-copy-btn');
    if (!box || generateBtn?.disabled) return;
    if (generateBtn) generateBtn.disabled = true;
    box.textContent = '正在生成体检报告...';
    try {
      const data = await fetchJson('/api/health-report/text');
      reportText = String(data.text || '');
      box.textContent = reportText || '（空报告）';
      if (copyBtn) copyBtn.disabled = !reportText;
    } catch (error) {
      box.textContent = `体检报告生成失败：${error.message || '未知错误'}`;
      reportText = '';
      if (copyBtn) copyBtn.disabled = true;
    } finally {
      if (generateBtn) generateBtn.disabled = false;
    }
  }

  async function copyHealthReport() {
    if (!reportText) return;
    const copyBtn = $('health-report-copy-btn');
    try {
      await navigator.clipboard.writeText(reportText);
      if (copyBtn) {
        const original = copyBtn.textContent;
        copyBtn.textContent = '已复制';
        setTimeout(() => { copyBtn.textContent = original; }, 1600);
      }
    } catch {
      if (ui.toast) {
        ui.toast('复制失败，请手动选中文本复制', 'error');
      }
    }
  }

  $('health-report-generate-btn')?.addEventListener('click', generateHealthReport);
  $('health-report-copy-btn')?.addEventListener('click', copyHealthReport);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTasks);
  } else {
    loadTasks();
  }
})();
