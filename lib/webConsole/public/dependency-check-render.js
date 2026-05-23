function renderActiveInstallTaskCard(task) {
  const tone = task.status === 'running' ? 'success' : 'neutral';
  const output = trimText(task.stderrTail || task.stdoutTail, 260);
  const stageText = task.currentStage ? `当前阶段：${task.currentStage}` : '';
  const metaLines = [
    `状态：${formatInstallTaskStatus(task.status)}`,
    stageText,
    task.packageManager ? `包管理器：${task.packageManager}` : '',
    task.targetDir ? `目标目录：${task.targetDir}` : '',
    task.startedAt ? `开始时间：${formatTime(task.startedAt)}` : task.createdAt ? `创建时间：${formatTime(task.createdAt)}` : '',
  ].filter(Boolean);

  return `
    <div class="list-item tone-${tone} dependency-active-item">
      <h3>${escapeHtml(task.name || '-')}</h3>
      <div class="dependency-active-meta">
        ${metaLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
      </div>
      ${output ? `<pre class="dependency-active-output">${escapeHtml(output)}</pre>` : ''}
      ${renderInstallTaskActionBar(task)}
      ${renderInstallTaskDetails(task, { live: true })}
    </div>
  `;
}

function renderActiveInstallTasks() {
  const summary = document.getElementById('active-install-summary');
  const list = document.getElementById('active-install-list');
  if (!summary || !list) {
    return;
  }

  const tasks = getActiveInstallTasks();
  if (tasks.length <= 0) {
    summary.textContent = '当前无进行中的安装任务';
    list.innerHTML = '';
    return;
  }

  summary.textContent = `当前 ${formatNumber(tasks.length)} 个安装任务进行中`;
  list.innerHTML = tasks.map(task => renderActiveInstallTaskCard(task)).join('');
}

function renderInstallHistory() {
  const summary = document.getElementById('install-history-summary');
  const list = document.getElementById('install-history-list');
  if (!summary || !list) {
    return;
  }

  const sourceTasks = Array.isArray(state.installHistory) ? state.installHistory : [];
  const query = getInstallHistoryQuery();
  const statusFilter = getInstallHistoryStatus();
  const tasks = sourceTasks.filter(task => {
    if (statusFilter !== 'all' && task?.status !== statusFilter) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      task?.name,
      task?.pluginId,
      task?.targetDir,
      task?.packageManager,
      task?.error,
      task?.stdoutTail,
      task?.stderrTail,
      Array.isArray(task?.command) ? task.command.join(' ') : '',
    ].some(value => String(value || '').toLowerCase().includes(query));
  });

  if (sourceTasks.length <= 0) {
    summary.textContent = '最近暂无安装记录';
    list.innerHTML = '';
    return;
  }

  summary.textContent = query || statusFilter !== 'all'
    ? `已筛出 ${formatNumber(tasks.length)} / ${formatNumber(sourceTasks.length)} 条记录`
    : `最近记录 ${formatNumber(tasks.length)} 条`;
  list.innerHTML = tasks.length > 0
    ? tasks.map(task => renderInstallHistoryCard(task)).join('')
    : `<div class="list-item">没有匹配的安装记录</div>`;
}

function renderInstallHistoryCard(task) {
  const tone = task.status === 'success' ? 'success' : 'error';
  const summaryText = task.status === 'success'
    ? '安装完成'
    : buildInstallTaskError(task);
  const metaLines = [
    `状态：${formatInstallTaskStatus(task.status)}`,
    task.packageManager ? `包管理器：${task.packageManager}` : '',
    task.targetDir ? `目标目录：${task.targetDir}` : '',
    task.finishedAt ? `结束时间：${formatTime(task.finishedAt)}` : task.createdAt ? `创建时间：${formatTime(task.createdAt)}` : '',
  ].filter(Boolean);

  return `
    <div class="list-item tone-${tone} dependency-active-item">
      <h3>${escapeHtml(task.name || '-')}</h3>
      <div class="dependency-active-meta">
        ${metaLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
      </div>
      <div class="setting-help dependency-item-help">${escapeHtml(summaryText)}</div>
      ${renderInstallTaskActionBar(task)}
      ${renderInstallTaskDetails(task)}
    </div>
  `;
}

function renderInstallTaskActionBar(task) {
  if (!task) return '';
  const key = String(task.key || '').trim();
  const commandText = getInstallTaskCommandText(task);
  const hasLog = Boolean(getInstallTaskLogText(task));
  if (!key) return '';
  return `
    <div class="dependency-task-actions">
      <button type="button" class="mini-btn" data-dependency-task-action="copy-log" data-task-key="${escapeHtml(key)}" ${hasLog ? '' : 'disabled'}>复制日志</button>
      <button type="button" class="mini-btn" data-dependency-task-action="copy-command" data-task-key="${escapeHtml(key)}" ${commandText ? '' : 'disabled'}>复制命令</button>
      <button type="button" class="mini-btn" data-dependency-task-action="export-task" data-task-key="${escapeHtml(key)}">导出任务</button>
    </div>
  `;
}

function renderInstallTaskEvents(task) {
  const events = Array.isArray(task?.events) ? task.events : [];
  if (events.length <= 0) return '';
  return `
    <div class="dependency-task-event-list">
      ${events.map(event => `
        <div class="dependency-task-event tone-${event.level === 'error' ? 'error' : 'neutral'}">
          <span>${escapeHtml(formatTime(event.time))}</span>
          <strong>${escapeHtml(event.stage || '-')}</strong>
          <div>${escapeHtml(event.message || '-')}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderInstallTaskAdvice(task) {
  const advice = getInstallTaskFailureAdvice(task);
  if (advice.length <= 0) return '';
  return `
    <div class="dependency-task-advice">
      <strong>处理建议</strong>
      <ul>
        ${advice.map(item => `
          <li>
            <b>${escapeHtml(item.title)}</b>
            <span>${escapeHtml(item.detail)}</span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function renderInstallTaskDetails(task, options = {}) {
  if (!task) {
    return '';
  }

  const commandText = Array.isArray(task.command) ? task.command.join(' ') : '';
  const outputBlocks = [task.stderrTail, task.stdoutTail].filter(Boolean);
  const failedStageText = task.failedStage ? `失败阶段：${task.failedStage}` : '';
  const currentStageText = task.currentStage ? `当前阶段：${task.currentStage}` : '';
  const metaLines = [
    currentStageText,
    failedStageText,
    task.packageManager ? `包管理器：${task.packageManager}` : '',
    commandText ? `命令：${commandText}` : '',
    task.targetDir ? `目标目录：${task.targetDir}` : '',
    task.createdAt ? `创建时间：${formatTime(task.createdAt)}` : '',
    task.startedAt ? `开始时间：${formatTime(task.startedAt)}` : '',
    task.finishedAt ? `结束时间：${formatTime(task.finishedAt)}` : '',
    task.timedOut ? '执行结果：已超时' : '',
    task.error ? `错误信息：${task.error}` : '',
  ].filter(Boolean);

  const eventCount = Array.isArray(task.events) ? task.events.length : 0;
  if (metaLines.length <= 0 && outputBlocks.length <= 0 && eventCount <= 0) {
    return '';
  }

  const title = task.status === 'error'
    ? '查看失败详情'
    : options.live
      ? '查看实时日志'
      : '查看任务详情';
  return `
    <details class="dependency-task-details"${task.status === 'error' || options.live ? ' open' : ''}>
      <summary class="dependency-task-summary">${escapeHtml(title)}</summary>
      <div class="dependency-task-meta">
        ${metaLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
      </div>
      ${renderInstallTaskAdvice(task)}
      ${renderInstallTaskEvents(task)}
      ${outputBlocks.length > 0 ? `<pre class="dependency-task-log">${escapeHtml(outputBlocks.join('\n\n'))}</pre>` : ''}
    </details>
  `;
}

function renderSummary(report) {
  const summary = report?.summary || {};
  const statusText = formatDependencyReportStatus(summary.status);
  const note = !summary.totalCount
    ? '暂无依赖检查数据。'
    : summary.problemCount > 0
      ? `当前发现 ${summary.problemCount} 项依赖问题，优先处理运行依赖缺失。`
      : '当前依赖完整，未发现缺失或版本偏差。';

  document.getElementById('dependency-summary').innerHTML = [
    '<div class="config-summary-grid">',
    `<div class="config-summary-card"><h3>总体状态</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">状态</span><span class="config-summary-value tone-${summary.status === 'error' ? 'error' : summary.status === 'warn' ? 'error' : 'success'}">${statusText}</span></div><div class="config-summary-row"><span class="config-summary-label">问题数</span><span class="config-summary-value">${formatNumber(summary.problemCount || 0)}</span></div></div></div>`,
    `<div class="config-summary-card"><h3>运行依赖</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">已安装</span><span class="config-summary-value">${formatNumber(summary.runtimeInstalledCount || 0)} / ${formatNumber(summary.runtimeCount || 0)}</span></div><div class="config-summary-row"><span class="config-summary-label">缺失 / 偏差</span><span class="config-summary-value">${formatNumber(summary.runtimeMissingCount || 0)} / ${formatNumber(summary.runtimeMismatchCount || 0)}</span></div></div></div>`,
    `<div class="config-summary-card"><h3>开发依赖</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">已安装</span><span class="config-summary-value">${formatNumber(summary.devInstalledCount || 0)} / ${formatNumber(summary.devCount || 0)}</span></div><div class="config-summary-row"><span class="config-summary-label">缺失 / 偏差</span><span class="config-summary-value">${formatNumber(summary.devMissingCount || 0)} / ${formatNumber(summary.devMismatchCount || 0)}</span></div></div></div>`,
    `<div class="config-summary-card"><h3>检查时间</h3><div class="config-summary-list"><div class="config-summary-row"><span class="config-summary-label">最近一次</span><span class="config-summary-value">${escapeHtml(formatTime(summary.checkedAt))}</span></div><div class="config-summary-row"><span class="config-summary-label">清单 / 锁文件</span><span class="config-summary-value">${summary.manifestExists === false ? '缺清单' : summary.lockfileExists === false ? '缺锁文件' : '完整'}</span></div></div></div>`,
    '</div>',
    `<div class="config-summary-note">${escapeHtml(note)}</div>`,
  ].join('');
}

function renderBulkFixPanel(report) {
  const panel = document.getElementById('dependency-bulk-fix-panel');
  const title = document.getElementById('dependency-bulk-fix-title');
  const desc = document.getElementById('dependency-bulk-fix-desc');
  const button = document.getElementById('install-missing-dependencies-btn');
  const result = document.getElementById('dependency-bulk-fix-result');
  if (!panel || !title || !desc || !button) {
    return;
  }

  const installableItems = getInstallableDependencyItems(report);
  const activeCount = getActiveInstallTasks().length;
  if (installableItems.length <= 0) {
    panel.classList.remove('hidden');
    title.textContent = '当前没有可一键修复依赖';
    desc.textContent = '运行和开发依赖都没有缺失；版本不一致或可选依赖需要按实际情况手动确认。';
    button.disabled = true;
    button.textContent = '无需修复';
    renderBulkFixResult(result);
    return;
  }

  const currentCount = installableItems.filter(item => (item.installScope || 'current') === 'current').length;
  const pluginCount = installableItems.length - currentCount;
  const limitedText = installableItems.length > 80 ? '，单次最多处理前 80 个' : '';
  const activeText = activeCount > 0 ? ` 当前已有 ${formatNumber(activeCount)} 个任务在执行，将自动排队。` : '';

  panel.classList.remove('hidden');
  title.textContent = `可一键修复 ${formatNumber(installableItems.length)} 个依赖`;
  desc.textContent = `当前插件需要修复 ${formatNumber(currentCount)} 个，其他插件需要修复 ${formatNumber(pluginCount)} 个${limitedText}。${activeText}`;
  if (!state.bulkFixPromise) {
    button.disabled = false;
    button.textContent = '一键修复依赖';
  }
  renderBulkFixResult(result);
}

function renderBulkFixResult(target = document.getElementById('dependency-bulk-fix-result')) {
  if (!target) {
    return;
  }

  const summary = getBulkFixBatchSummary();
  if (!summary || summary.totalCount <= 0) {
    target.classList.add('hidden');
    target.innerHTML = '';
    return;
  }

  const done = summary.finishedCount >= summary.totalCount;
  const tone = summary.errorCount > 0 ? 'error' : done ? 'success' : 'neutral';
  const activeText = summary.activeCount > 0 ? ` / 进行中 ${formatNumber(summary.activeCount)}` : '';
  const skippedText = summary.skippedCount > 0 ? ` / 跳过 ${formatNumber(summary.skippedCount)}` : '';
  const titleText = done ? '修复结果' : '修复进度';
  const rows = [
    `总数 ${formatNumber(summary.totalCount)}`,
    `成功 ${formatNumber(summary.successCount)}`,
    `失败 ${formatNumber(summary.errorCount)}`,
    activeText.replace(/^ \/ /, ''),
    skippedText.replace(/^ \/ /, ''),
  ].filter(Boolean);

  target.className = `dependency-bulk-fix-result tone-${tone}`;
  target.innerHTML = `
    <div class="dependency-bulk-fix-result-title">${escapeHtml(titleText)}：${rows.map(item => escapeHtml(item)).join(' / ')}</div>
    <div class="dependency-bulk-fix-actions">
      <button type="button" class="mini-btn" data-dependency-bulk-action="export-report">导出修复报告</button>
      <button type="button" class="mini-btn" data-dependency-bulk-action="copy-failure-report" ${summary.failures.length > 0 ? '' : 'disabled'}>复制失败摘要</button>
    </div>
    ${summary.failures.length > 0 ? `
      <details class="dependency-bulk-fix-failures" open>
        <summary>查看失败原因</summary>
        <div class="dependency-bulk-fix-failure-list">
          ${summary.failures.map(task => `
            <div class="dependency-bulk-fix-failure-item">
              <strong>${escapeHtml(task.name || '-')}</strong>
              ${task.failedStage || task.currentStage ? `<em>${escapeHtml(task.failedStage ? `失败阶段：${task.failedStage}` : `当前阶段：${task.currentStage}`)}</em>` : ''}
              <span>${escapeHtml(buildInstallTaskError(task))}</span>
              ${getInstallTaskFailureAdvice(task).slice(0, 2).map(item => `<small>${escapeHtml(item.title)}：${escapeHtml(item.detail)}</small>`).join('')}
            </div>
          `).join('')}
        </div>
      </details>
    ` : ''}
  `;
}

function renderInstallAction(item) {
  if (!isInstallableItem(item)) {
    return '';
  }

  const payload = buildInstallPayload(item);
  const key = getInstallKey(payload);
  const task = getInstallTask(payload);
  const isInstalling = state.installingKeys.has(key);
  const baseHint = payload.scope === 'plugin'
    ? `安装到插件：${item.pluginName || item.pluginId || '-'}`
    : '安装到当前插件目录';
  const hint = !task
    ? baseHint
    : task.status === 'error'
      ? `${baseHint} · 最近失败：${buildInstallTaskError(task)}`
      : `${baseHint} · 任务状态：${formatInstallTaskStatus(task.status)}${task.packageManager ? ` (${task.packageManager})` : ''}`;
  const buttonText = isInstalling
    ? task?.status === 'pending'
      ? '排队中...'
      : '安装中...'
    : '修复/安装';
  const taskDetails = renderInstallTaskDetails(task);

  return `
    <div class="dependency-item-actions">
      <button
        class="mini-btn feature-manage-btn feature-manage-btn-safe dependency-install-btn"
        data-scope="${escapeHtml(payload.scope)}"
        data-plugin-id="${escapeHtml(payload.pluginId)}"
        data-dependency-type="${escapeHtml(payload.dependencyType)}"
        data-name="${escapeHtml(payload.name)}"
        data-declared-version="${escapeHtml(payload.declaredVersion)}"
        ${isInstalling ? 'disabled' : ''}
      >${buttonText}</button>
      <div class="setting-help dependency-item-help">${escapeHtml(hint)}</div>
    </div>
    ${taskDetails}
  `;
}

function renderDependencyCard(item) {
  const tone = item.level === 'error' ? 'error' : item.level === 'warn' ? 'neutral' : 'success';
  const versionText = item.installed
    ? `声明 ${item.declaredVersion || '-'} / 已装 ${item.installedVersion || '-'}${item.lockVersion ? ` / 锁定 ${item.lockVersion}` : ''}`
    : `声明 ${item.declaredVersion || '-'} / 当前未安装${item.lockVersion ? ` / 锁定 ${item.lockVersion}` : ''}`;

  const details = [
    `<div>${escapeHtml(item.groupLabel || item.dependencyTypeLabel || '-')} · ${escapeHtml(formatDependencyStatus(item.status))}</div>`,
    `<div>${escapeHtml(versionText)}</div>`,
  ];

  if (item.packagePath) {
    details.push(`<div><small>安装路径：${escapeHtml(item.packagePath)}</small></div>`);
  }

  return `
    <div class="list-item tone-${tone}">
      <h3>${escapeHtml(item.name || '-')}</h3>
      <div class="dependency-item-body">
        ${details.join('')}
      </div>
      ${renderInstallAction(item)}
    </div>
  `;
}

function renderItems(targetId, items, emptyText) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = items.length > 0
    ? items.map(item => renderDependencyCard(item)).join('')
    : `<div class="list-item">${escapeHtml(emptyText)}</div>`;
}

function renderOtherPluginDependencies(report) {
  const block = report?.otherPluginDependencies || {};
  const summary = block.summary || {};
  const target = document.getElementById('other-plugin-dependency-list');
  const meta = document.getElementById('other-plugin-dependency-meta');
  if (!target || !meta) return;

  const query = getOtherPluginDependencyQuery();
  const items = Array.isArray(block.items) ? [...block.items] : [];
  const filtered = items
    .filter(item => {
      if (!query) return true;
      return [
        item.pluginName,
        item.pluginId,
        item.pluginDir,
        item.manifestPath,
        item.name,
        item.declaredVersion,
        item.installedVersion,
        item.packagePath,
        item.dependencyTypeLabel,
      ].some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => {
      const typeOrder = { runtime: 0, dev: 1, peer: 2, optional: 3 };
      const pluginCompare = String(a.pluginName || a.pluginId || '').localeCompare(String(b.pluginName || b.pluginId || ''));
      if (pluginCompare !== 0) return pluginCompare;
      const typeCompare = (typeOrder[a.dependencyType] ?? 99) - (typeOrder[b.dependencyType] ?? 99);
      if (typeCompare !== 0) return typeCompare;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

  const grouped = [];
  const groupedMap = new Map();
  for (const item of filtered) {
    const key = String(item.pluginId || item.pluginName || item.pluginDir || '');
    if (!groupedMap.has(key)) {
      const group = {
        key,
        pluginId: item.pluginId || '',
        pluginName: item.pluginName || item.pluginId || '-',
        pluginDir: item.pluginDir || '',
        manifestPath: item.manifestPath || '',
        items: [],
      };
      groupedMap.set(key, group);
      grouped.push(group);
    }
    groupedMap.get(key).items.push(item);
  }

  const matchedPluginCount = grouped.length;
  if (!summary.pluginsDirExists) {
    meta.textContent = '没有找到插件目录，暂时无法查看其他插件的依赖。';
  } else if (!summary.pluginCount) {
    meta.textContent = '没有发现其他声明依赖的插件。';
  } else if (query) {
    meta.textContent = `找到 ${formatNumber(filtered.length)} 条匹配结果，来自 ${formatNumber(matchedPluginCount)} 个插件。`;
  } else {
    meta.textContent = `已查看 ${formatNumber(summary.pluginCount)} 个其他插件，共 ${formatNumber(summary.totalCount)} 条依赖；其中缺失 ${formatNumber(summary.runtimeMissingCount)} 条运行依赖。`;
  }

  target.innerHTML = grouped.length > 0
    ? grouped.map(group => {
      const problemCount = group.items.filter(item => item.status !== 'ok').length;
      const runtimeMissingCount = group.items.filter(item => item.dependencyType === 'runtime' && item.status === 'missing').length;
      const tone = runtimeMissingCount > 0 ? 'error' : problemCount > 0 ? 'neutral' : 'success';
      const summaryText = `依赖 ${formatNumber(group.items.length)} 条 · 问题 ${formatNumber(problemCount)} 项 · 运行缺失 ${formatNumber(runtimeMissingCount)} 项`;

      return `
        <section class="other-plugin-group tone-${tone}">
          <div class="other-plugin-group-head">
            <div class="other-plugin-group-title-row">
              <h3>${escapeHtml(group.pluginName)}</h3>
              <span class="tag">${escapeHtml(group.pluginId || 'unknown')}</span>
            </div>
            <div class="other-plugin-group-meta">${escapeHtml(summaryText)}</div>
            <div class="other-plugin-group-meta"><small>插件目录：${escapeHtml(group.pluginDir || '-')}</small></div>
            <div class="other-plugin-group-meta"><small>依赖清单：${escapeHtml(group.manifestPath || '-')}</small></div>
          </div>
          <div class="list other-plugin-group-list">
            ${group.items.map(item => renderDependencyCard(item)).join('')}
          </div>
        </section>
      `;
    }).join('')
    : `<div class="list-item">${escapeHtml(query ? '没有匹配的其他插件依赖。' : '暂无其他插件依赖数据。')}</div>`;
}

function renderReport(report) {
  state.report = report;
  const items = Array.isArray(report?.items) ? [...report.items] : [];
  const problemItems = items
    .filter(item => item.status !== 'ok')
    .sort((a, b) => {
      if (a.level !== b.level) {
        return a.level === 'error' ? -1 : 1;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  const allItems = items.sort((a, b) => {
    if (a.group !== b.group) {
      return a.group === 'runtime' ? -1 : 1;
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  renderSummary(report);
  renderBulkFixPanel(report);
  renderActiveInstallTasks();
  renderInstallHistory();
  renderOtherPluginDependencies(report);
  renderItems('dependency-problems', problemItems, '当前没有依赖问题');
  renderItems('dependency-list', allItems, '暂无依赖数据');

  const summary = report?.summary || {};
  setMeta(`状态：${formatDependencyReportStatus(summary.status)}，缺失运行依赖 ${summary.runtimeMissingCount || 0} 个，共 ${summary.problemCount || 0} 个问题`);
}
