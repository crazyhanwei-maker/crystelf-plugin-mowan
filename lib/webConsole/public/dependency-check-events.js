document.addEventListener('click', event => {
  const taskAction = event.target.closest('[data-dependency-task-action]');
  if (taskAction) {
    event.preventDefault();
    handleDependencyTaskAction(taskAction).catch(error => {
      setRefreshStatus(`任务操作失败：${error.message}`, 'error');
    });
    return;
  }

  const bulkAction = event.target.closest('[data-dependency-bulk-action]');
  if (bulkAction) {
    event.preventDefault();
    handleDependencyBulkAction(bulkAction).catch(error => {
      setRefreshStatus(`批量报告操作失败：${error.message}`, 'error');
    });
    return;
  }

  const button = event.target.closest('.dependency-install-btn');
  if (!button) {
    return;
  }
  event.preventDefault();
  handleInstallButtonClick(button).catch(() => {});
});

async function handleDependencyTaskAction(button) {
  const action = button.dataset.dependencyTaskAction || '';
  const task = findInstallTaskByKey(button.dataset.taskKey || '');
  if (!task) {
    throw new Error('没有找到对应的安装任务');
  }

  if (action === 'copy-log') {
    const text = getInstallTaskLogText(task);
    if (!text) throw new Error('当前任务还没有可复制的日志');
    await copyDependencyText(text);
    setRefreshStatus(`已复制 ${task.name || '依赖'} 的安装日志`, 'neutral');
    return;
  }

  if (action === 'copy-command') {
    const text = getInstallTaskCommandText(task);
    if (!text) throw new Error('当前任务还没有安装命令');
    await copyDependencyText(text);
    setRefreshStatus(`已复制 ${task.name || '依赖'} 的安装命令`, 'neutral');
    return;
  }

  if (action === 'export-task') {
    downloadDependencyJson(buildInstallTaskDiagnostic(task), 'dependency-install-task');
    setRefreshStatus(`已导出 ${task.name || '依赖'} 的安装任务诊断`, 'neutral');
    return;
  }
}

async function handleDependencyBulkAction(button) {
  const action = button.dataset.dependencyBulkAction || '';
  const summary = getBulkFixBatchSummary();
  if (!summary) {
    throw new Error('当前没有一键修复批次');
  }

  if (action === 'export-report') {
    downloadBulkFixDiagnostic();
    setRefreshStatus('已导出依赖一键修复报告', 'neutral');
    return;
  }

  if (action === 'copy-failure-report') {
    const failures = Array.isArray(summary.failures) ? summary.failures : [];
    if (failures.length <= 0) {
      throw new Error('当前没有失败项');
    }
    const lines = [
      '依赖一键修复失败摘要',
      `生成时间：${formatTime(new Date().toISOString())}`,
      `失败数量：${formatNumber(summary.errorCount || failures.length)}`,
      '',
      ...failures.map((task, index) => [
        `${index + 1}. ${task.name || '-'}`,
        task.failedStage || task.currentStage ? `阶段：${task.failedStage || task.currentStage}` : '',
        `原因：${buildInstallTaskError(task)}`,
        ...getInstallTaskFailureAdvice(task).map((item, adviceIndex) => `建议 ${adviceIndex + 1}：${item.title} - ${item.detail}`),
        task.targetDir ? `目标：${task.targetDir}` : '',
      ].filter(Boolean).join('\n')),
    ];
    await copyDependencyText(lines.join('\n\n'));
    setRefreshStatus('已复制依赖一键修复失败摘要', 'neutral');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const createDebouncedTask = (fn, delay = 140) => {
    if (typeof window.CrystelfUi?.debounce === 'function') {
      return window.CrystelfUi.debounce(fn, delay);
    }
    let timer = null;
    const task = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        fn();
      }, delay);
    };
    task.cancel = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
    };
    return task;
  };
  const renderOtherPluginDependenciesDebounced = createDebouncedTask(() => {
    if (state.report) {
      renderOtherPluginDependencies(state.report);
    }
  }, 140);
  const renderInstallHistoryDebounced = createDebouncedTask(() => {
    renderInstallHistory();
  }, 140);

  setRefreshButtonState(false);
  renderActiveInstallTasks();
  renderInstallHistory();
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    Promise.all([refreshDependencies(), refreshInstallHistory()])
      .then(() => restoreActiveInstallTasks())
      .catch(() => {});
  });

  document.getElementById('install-missing-dependencies-btn')?.addEventListener('click', () => {
    installMissingDependencies().catch(() => {});
  });

  document.getElementById('other-plugin-dependency-search')?.addEventListener('input', () => {
    renderOtherPluginDependenciesDebounced();
  });

  document.getElementById('clear-other-plugin-search-btn')?.addEventListener('click', () => {
    const input = document.getElementById('other-plugin-dependency-search');
    if (input) {
      input.value = '';
    }
    renderOtherPluginDependenciesDebounced.cancel?.();
    if (state.report) {
      renderOtherPluginDependencies(state.report);
    }
  });

  document.getElementById('install-history-search')?.addEventListener('input', () => {
    renderInstallHistoryDebounced();
  });

  document.getElementById('install-history-status')?.addEventListener('change', () => {
    renderInstallHistoryDebounced.cancel?.();
    renderInstallHistory();
  });

  document.getElementById('clear-install-history-search-btn')?.addEventListener('click', () => {
    const searchInput = document.getElementById('install-history-search');
    const statusSelect = document.getElementById('install-history-status');
    if (searchInput) {
      searchInput.value = '';
    }
    if (statusSelect) {
      statusSelect.value = 'all';
    }
    renderInstallHistoryDebounced.cancel?.();
    renderInstallHistory();
  });

  document.getElementById('clear-install-history-btn')?.addEventListener('click', () => {
    clearInstallHistory().catch(error => {
      setRefreshStatus(`清空安装记录失败：${error.message}`, 'error');
    });
  });

  Promise.all([refreshDependencies(), refreshInstallHistory()])
    .then(() => restoreActiveInstallTasks())
    .catch(() => {});
});

