document.getElementById('refresh-btn')?.addEventListener('click', () => {
  runDebouncedRefresh.cancel?.();
  refresh().catch(handleRefreshError);
});

document.getElementById('refresh-image-monitor-btn')?.addEventListener('click', () => {
  runDebouncedRefresh.cancel?.();
  refresh().catch(handleRefreshError);
});

document.getElementById('clear-all-filters-btn')?.addEventListener('click', clearAllFilters);

[
  'image-monitor-log-search',
  'image-monitor-log-group-filter',
  'image-monitor-log-user-filter',
  'image-monitor-log-start-at',
  'image-monitor-log-end-at',
].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => scheduleRefresh('review'));
});

[
  'image-monitor-meme-search',
  'image-monitor-meme-group-filter',
  'image-monitor-meme-user-filter',
  'image-monitor-meme-start-at',
  'image-monitor-meme-end-at',
].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => scheduleRefresh('meme'));
});

document.querySelectorAll('[data-review-risk]').forEach(button => {
  button.addEventListener('click', () => {
    state.reviewRisk = button.dataset.reviewRisk || '';
    state.reviewPage = 1;
    updateFilterButtonState();
    runDebouncedRefresh.cancel?.();
    refresh().catch(handleRefreshError);
  });
});

document.querySelectorAll('[data-review-is-meme]').forEach(button => {
  button.addEventListener('click', () => {
    state.reviewIsMeme = button.dataset.reviewIsMeme || '';
    state.reviewPage = 1;
    updateFilterButtonState();
    runDebouncedRefresh.cancel?.();
    refresh().catch(handleRefreshError);
  });
});

document.querySelectorAll('[data-review-alerted]').forEach(button => {
  button.addEventListener('click', () => {
    state.reviewAlerted = button.dataset.reviewAlerted || '';
    state.reviewPage = 1;
    updateFilterButtonState();
    runDebouncedRefresh.cancel?.();
    refresh().catch(handleRefreshError);
  });
});

document.querySelectorAll('[data-review-recalled]').forEach(button => {
  button.addEventListener('click', () => {
    state.reviewRecalled = button.dataset.reviewRecalled || '';
    state.reviewPage = 1;
    updateFilterButtonState();
    runDebouncedRefresh.cancel?.();
    refresh().catch(handleRefreshError);
  });
});

document.getElementById('export-review-btn')?.addEventListener('click', async () => {
  try {
    await downloadExport(
      'image-monitor-review-logs',
      getReviewExportParams(),
      `image-monitor-review-${Date.now()}.json`
    );
    setRefreshStatus('审核日志导出完成', 'success');
  } catch (error) {
    handleRefreshError(error);
  }
});

document.getElementById('cleanup-non-meme-btn')?.addEventListener('click', async () => {
  const confirmed = await webConsoleConfirm('确认清理审核日志中的非表情包图片记录？会删除 isMeme=false 的审核记录，并清理同 hash 的非表情包本地入库文件。', { title: '清理非表情包记录' });
  if (!confirmed) return;
  try {
    setRefreshStatus('正在清理非表情包记录...', 'neutral');
    const result = await postJson('/api/logs/image-monitor/cleanup-non-meme');
    state.reviewPage = 1;
    state.memePage = 1;
    await refresh();
    setRefreshStatus(
      `清理完成：移除审核记录 ${formatNumber(result.removedReviewRecords || 0)} 条 / 入库记录 ${formatNumber(result.removedMemeRecords || 0)} 条 / 删除文件 ${formatNumber(result.deletedFiles || 0)} 个`,
      result.failedFiles > 0 ? 'error' : 'success'
    );
  } catch (error) {
    handleRefreshError(error);
  }
});

document.getElementById('export-meme-btn')?.addEventListener('click', async () => {
  try {
    await downloadExport(
      'image-monitor-meme-logs',
      getMemeExportParams(),
      `image-monitor-meme-${Date.now()}.json`
    );
    setRefreshStatus('表情包入库记录导出完成', 'success');
  } catch (error) {
    handleRefreshError(error);
  }
});

document.getElementById('cleanup-unmatched-meme-btn')?.addEventListener('click', async () => {
  const confirmed = await webConsoleConfirm('确认清理未命中当前入库角色/关键词白名单的表情包？会删除对应入库记录、本地图片文件，并清理空目录。请先确认白名单配置正确。', { title: '清理未命中表情包' });
  if (!confirmed) return;
  try {
    setRefreshStatus('正在清理未命中白名单的表情包...', 'neutral');
    const result = await postJson('/api/logs/image-monitor/cleanup-unmatched-meme');
    state.memePage = 1;
    await refresh();
    if (result.skipped) {
      setRefreshStatus(result.message || '未配置入库白名单，已跳过清理', 'neutral');
      return;
    }
    setRefreshStatus(
      `清理完成：移除入库记录 ${formatNumber(result.removedMemeRecords || 0)} 条 / 删除文件 ${formatNumber(result.deletedFiles || 0)} 个 / 清理空目录 ${formatNumber(result.removedEmptyDirs || 0)} 个`,
      result.failedFiles > 0 || result.failedEmptyDirs > 0 ? 'error' : 'success'
    );
  } catch (error) {
    handleRefreshError(error);
  }
});

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.dataset.previewType && target.dataset.previewId) {
    openDetailModal(target.dataset.previewType, target.dataset.previewId).catch(handleRefreshError);
  }
});

document.addEventListener('error', event => {
  handleImageMonitorThumbError(event.target);
}, true);

document.getElementById('detail-modal-close-btn')?.addEventListener('click', closeDetailModal);
document.getElementById('detail-modal-close-top')?.addEventListener('click', closeDetailModal);
document.getElementById('detail-modal-mask')?.addEventListener('click', event => {
  if (event.target === event.currentTarget) {
    closeDetailModal();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeDetailModal();
  }
});

refresh().catch(error => {
  const pre = document.createElement('pre');
  pre.textContent = `图片监控中心加载失败: ${error?.message || String(error)}`;
  document.body.replaceChildren(pre);
});
