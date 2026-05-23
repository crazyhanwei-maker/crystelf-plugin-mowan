function getOperationTaskTone(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'success') return 'success';
  if (value === 'error') return 'error';
  if (value === 'running' || value === 'pending') return 'warning';
  return 'neutral';
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
        ${task.timedOut ? '<span>已超时</span>' : ''}
      </div>
      ${commandText ? `<div class="operation-task-command">${escapeHtml(commandText)}</div>` : ''}
      ${task.error ? `<div class="setting-error">${escapeHtml(task.error)}</div>` : ''}
    </a>
  `;
}

function renderOperationTaskCenter(data = {}) {
  const target = document.getElementById('operation-task-center');
  if (!target) return;
  if (data.__error) {
    target.innerHTML = `<div class="list-item tone-error">任务中心加载失败：${escapeHtml(data.__error)}</div>`;
    return;
  }
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  target.innerHTML = [
    renderOperationTaskSummary(data),
    tasks.length > 0
      ? `<div class="operation-task-list">${tasks.map(task => renderOperationTaskItem(task)).join('')}</div>`
      : '<div class="list-item">暂无依赖安装或插件安装任务</div>',
  ].join('');
}
