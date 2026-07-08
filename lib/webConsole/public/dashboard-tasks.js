function getOperationTaskTone(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'success') return 'success';
  if (value === 'error') return 'error';
  if (value === 'running' || value === 'pending') return 'warning';
  return 'neutral';
}

function normalizeOperationTaskProgress(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function formatOperationTaskDuration(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
  if (totalSeconds <= 0) return '0 秒';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0) parts.push(`${minutes} 分`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} 秒`);
  return parts.slice(0, 2).join('');
}

function getOperationTaskAutoRefreshLabel(data = {}) {
  const summary = data.summary || {};
  const activeCount = Number(summary.activeCount || 0);
  if (activeCount > 0) {
    return `自动刷新中，每秒更新 ${formatNumber(activeCount)} 个进行中任务`;
  }
  const checkedAt = data.checkedAt ? formatTime(data.checkedAt) : '暂无';
  return `最近检查：${checkedAt}`;
}

function renderOperationTaskSummary(data = {}) {
  const summary = data.summary || {};
  return `
    <div class="operation-task-summary">
      <div class="operation-task-summary-item">
        <span>总任务</span>
        <strong>${formatNumber(summary.total || 0)}</strong>
      </div>
      <div class="operation-task-summary-item">
        <span>进行中</span>
        <strong>${formatNumber(summary.activeCount || 0)}</strong>
      </div>
      <div class="operation-task-summary-item">
        <span>成功 / 失败</span>
        <strong>${formatNumber(summary.successCount || 0)} / ${formatNumber(summary.errorCount || 0)}</strong>
      </div>
      <div class="operation-task-summary-item">
        <span>依赖 / 插件</span>
        <strong>${formatNumber(summary.dependencyCount || 0)} / ${formatNumber(summary.pluginCount || 0)}</strong>
      </div>
    </div>
    <div class="operation-task-refresh-hint">${escapeHtml(getOperationTaskAutoRefreshLabel(data))}</div>
  `;
}

function renderOperationTaskProgress(task = {}) {
  const percent = normalizeOperationTaskProgress(task.progressPercent, task.active ? 15 : 0);
  const label = task.progressLabel || task.stage || task.statusLabel || '';
  return `
    <div class="operation-task-progress" aria-label="任务进度 ${percent}%">
      <span style="width:${percent}%"></span>
    </div>
    <div class="operation-task-progress-meta">
      <span>${formatNumber(percent)}%</span>
      <span>${escapeHtml(label || '等待进度')}</span>
    </div>
  `;
}

function renderOperationTaskOutput(task = {}) {
  const outputEvents = Array.isArray(task.outputEvents) ? task.outputEvents.slice(-4) : [];
  if (outputEvents.length <= 0) return '';
  return `
    <div class="operation-task-output">
      <div class="operation-task-subtitle">实时输出</div>
      ${outputEvents.map(event => `
        <div class="operation-task-output-line tone-${event.stream === 'stderr' ? 'error' : 'neutral'}">
          <span>${escapeHtml(event.stream === 'stderr' ? 'ERR' : 'OUT')}</span>
          <code>${escapeHtml(event.text || '')}</code>
        </div>
      `).join('')}
    </div>
  `;
}

function renderOperationTaskTimeline(task = {}) {
  const events = Array.isArray(task.events) ? task.events.slice(-4) : [];
  if (events.length <= 0) return '';
  return `
    <div class="operation-task-timeline">
      <div class="operation-task-subtitle">执行记录</div>
      ${events.map(event => `
        <div class="operation-task-timeline-row tone-${escapeHtml(event.level || 'info')}">
          <span>${escapeHtml(formatTime(event.time))}</span>
          <strong>${escapeHtml(event.stage || '任务')}</strong>
          <em>${escapeHtml(event.message || '')}</em>
        </div>
      `).join('')}
    </div>
  `;
}

function renderOperationTaskItem(task = {}) {
  const tone = getOperationTaskTone(task.status);
  const commandText = Array.isArray(task.command) && task.command.length > 0
    ? task.command.join(' ')
    : '';
  const timeText = task.finishedAt
    ? `完成：${formatTime(task.finishedAt)}`
    : task.startedAt
      ? `开始：${formatTime(task.startedAt)}`
      : `创建：${formatTime(task.createdAt)}`;
  const elapsedText = Number(task.elapsedMs || 0) > 0
    ? `耗时：${formatOperationTaskDuration(task.elapsedMs)}`
    : '';
  const latestOutputText = task.latestOutputAt
    ? `最近输出：${formatTime(task.latestOutputAt)}`
    : '';
  return `
    <a class="operation-task-item tone-${tone}" href="${escapeHtml(task.href || '#')}">
      <div class="operation-task-item-head">
        <div>
          <h3>${escapeHtml(task.title || '未命名任务')}</h3>
          <div class="setting-help">${escapeHtml(task.typeLabel || '任务')} · ${escapeHtml(task.target || '-')}</div>
        </div>
        <span class="detail-tag tone-${tone}">${escapeHtml(task.statusLabel || task.status || '未知')}</span>
      </div>
      <div class="operation-task-meta">
        <span>阶段：${escapeHtml(task.stage || '-')}</span>
        <span>${escapeHtml(timeText)}</span>
        ${elapsedText ? `<span>${escapeHtml(elapsedText)}</span>` : ''}
        ${latestOutputText ? `<span>${escapeHtml(latestOutputText)}</span>` : ''}
        ${task.timedOut ? '<span>已超时</span>' : ''}
      </div>
      ${renderOperationTaskProgress(task)}
      ${commandText ? `<div class="operation-task-command">${escapeHtml(commandText)}</div>` : ''}
      ${renderOperationTaskOutput(task)}
      ${renderOperationTaskTimeline(task)}
      ${task.error ? `<div class="setting-error">${escapeHtml(task.error)}</div>` : ''}
    </a>
  `;
}

async function refreshOperationTaskCenterOnly() {
  const target = document.getElementById('operation-task-center');
  if (!target) return null;
  try {
    const data = await fetchJsonSafe('/api/tasks', {
      summary: { total: 0, activeCount: 0, successCount: 0, errorCount: 0, dependencyCount: 0, pluginCount: 0 },
      tasks: [],
    });
    renderOperationTaskCenter(data);
    return data;
  } catch (error) {
    renderOperationTaskCenter({ __error: error.message || '任务中心刷新失败' });
    return null;
  }
}

function stopOperationTaskAutoRefresh() {
  if (state.operationTaskTimer) {
    window.clearInterval(state.operationTaskTimer);
    state.operationTaskTimer = null;
  }
}

function scheduleOperationTaskAutoRefresh(data = {}) {
  const activeCount = Number(data?.summary?.activeCount || 0);
  if (activeCount <= 0) {
    stopOperationTaskAutoRefresh();
    return;
  }
  if (state.operationTaskTimer) return;
  state.operationTaskTimer = window.setInterval(async () => {
    if (state.operationTaskRefreshing) return;
    state.operationTaskRefreshing = true;
    try {
      const latest = await refreshOperationTaskCenterOnly();
      if (Number(latest?.summary?.activeCount || 0) <= 0) {
        stopOperationTaskAutoRefresh();
      }
    } finally {
      state.operationTaskRefreshing = false;
    }
  }, 1000);
}

function renderOperationTaskCenter(data = {}) {
  const target = document.getElementById('operation-task-center');
  if (!target) return;
  if (data.__error) {
    target.innerHTML = `<div class="list-item tone-error">任务中心加载失败：${escapeHtml(data.__error)}</div>`;
    stopOperationTaskAutoRefresh();
    return;
  }
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  target.innerHTML = [
    renderOperationTaskSummary(data),
    tasks.length > 0
      ? `<div class="operation-task-list">${tasks.map(task => renderOperationTaskItem(task)).join('')}</div>`
      : '<div class="list-item">暂无依赖安装或插件安装任务</div>',
  ].join('');
  scheduleOperationTaskAutoRefresh(data);
}
