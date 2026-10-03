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
  const activeCount = Number(summary.activeCount || 0);
  // 紧凑徽片行：替代四张大块摘要 + 独立提示框
  const chips = [
    { label: '总任务', value: formatNumber(summary.total || 0) },
    { label: '进行中', value: formatNumber(activeCount), tone: activeCount > 0 ? 'warning' : 'success' },
    { label: '成功 / 失败', value: `${formatNumber(summary.successCount || 0)} / ${formatNumber(summary.errorCount || 0)}`, tone: Number(summary.errorCount || 0) > 0 ? 'error' : 'success' },
    { label: '依赖 / 插件', value: `${formatNumber(summary.dependencyCount || 0)} / ${formatNumber(summary.pluginCount || 0)}` },
  ];
  return `
    <div class="operation-task-summary">
      ${chips.map(chip => `<span class="operation-task-chip${chip.tone ? ` tone-${chip.tone}` : ''}"><em>${escapeHtml(chip.label)}</em><strong>${escapeHtml(chip.value)}</strong></span>`).join('')}
      <span class="operation-task-refresh-hint">${escapeHtml(getOperationTaskAutoRefreshLabel(data))}</span>
    </div>
  `;
}

function renderOperationTaskProgress(task = {}) {
  // 已完成任务不渲染进度条（0%/complete 是噪音），只保留进行中的实时进度
  if (!task.active) return '';
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
  const isActive = task.active === true;
  // 已完成任务：单行元信息（时间/耗时）；进行中任务额外展示阶段与实时细节
  const timeText = task.finishedAt
    ? `完成 ${formatTime(task.finishedAt)}`
    : task.startedAt
      ? `开始 ${formatTime(task.startedAt)}`
      : `创建 ${formatTime(task.createdAt)}`;
  const metaParts = isActive
    ? [`阶段 ${task.stage || '-'}`, timeText, ...(Number(task.elapsedMs || 0) > 0 ? [`耗时 ${formatOperationTaskDuration(task.elapsedMs)}`] : []), ...(task.latestOutputAt ? [`最近输出 ${formatTime(task.latestOutputAt)}`] : []), ...(task.timedOut ? ['已超时'] : [])]
    : [timeText, ...(Number(task.elapsedMs || 0) > 0 ? [`耗时 ${formatOperationTaskDuration(task.elapsedMs)}`] : [])];
  const tooltip = `${task.title || '未命名任务'} · ${task.typeLabel || '任务'} · ${task.target || '-'} · ${task.statusLabel || task.status || ''}`;
  return `
    <a class="operation-task-item tone-${tone}" href="${escapeHtml(task.href || '#')}" title="${escapeHtml(tooltip)}">
      <span class="operation-task-status-dot" aria-hidden="true"></span>
      <div class="operation-task-item-main">
        <h3>${escapeHtml(task.title || '未命名任务')}</h3>
        <small class="operation-task-item-meta">${metaParts.map(part => escapeHtml(part)).join(' · ')}</small>
        ${isActive ? renderOperationTaskProgress(task) : ''}
        ${isActive && commandText ? `<div class="operation-task-command">${escapeHtml(commandText)}</div>` : ''}
        ${isActive ? renderOperationTaskOutput(task) : ''}
        ${isActive ? renderOperationTaskTimeline(task) : ''}
        ${task.error ? `<div class="setting-error">${escapeHtml(task.error)}</div>` : ''}
      </div>
      <span class="detail-tag tone-${tone}">${escapeHtml(task.statusLabel || task.status || '未知')}</span>
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
  // 首页只展示最近 6 条，其余引导到依赖任务/插件任务专页
  const MAX_VISIBLE_TASKS = 6;
  const visibleTasks = tasks.slice(0, MAX_VISIBLE_TASKS);
  const overflowCount = tasks.length - visibleTasks.length;
  target.innerHTML = [
    renderOperationTaskSummary(data),
    visibleTasks.length > 0
      ? `<div class="operation-task-list">${visibleTasks.map(task => renderOperationTaskItem(task)).join('')}</div>`
      : '<div class="list-item">暂无依赖安装或插件安装任务</div>',
    overflowCount > 0
      ? `<div class="operation-task-overflow">其余 ${formatNumber(overflowCount)} 个历史任务见「依赖任务」「插件任务」专页。</div>`
      : '',
  ].join('');
  scheduleOperationTaskAutoRefresh(data);
}
