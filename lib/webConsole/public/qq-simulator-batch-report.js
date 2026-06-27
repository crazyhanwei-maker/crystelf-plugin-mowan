(function () {
  function createBatchReportHandlers(deps = {}) {
    const {
      state,
      $,
      MAX_SCENARIOS,
      toArray,
      stringifyItem,
      normalizeScenarioPayload,
      normalizeScenarioItem,
      createScenarioId,
      writeStoredScenarios,
      saveScenarioToServer,
      renderScenarios,
      runScenarioLibraryTask,
      downloadTextFile,
      updateStatus,
      clipText,
    } = deps;
    function summarizeBatchItems(items = []) {
      const normalized = toArray(items);
      return normalized.reduce((acc, item) => {
        acc.total += 1;
        if (item.status === 'success') acc.success += 1;
        else if (item.status === 'skipped') acc.skipped += 1;
        else acc.failed += 1;
        acc.durationMs += Number(item.durationMs || 0);
        return acc;
      }, { total: 0, success: 0, failed: 0, skipped: 0, durationMs: 0 });
    }

    function getTimelineSummary(timeline = []) {
      return toArray(timeline)
        .slice(0, 8)
        .map(item => `${item.stage || '阶段'}:${item.status || 'info'}`)
        .join(' / ');
    }

    function getActionSummary(actions = []) {
      return toArray(actions)
        .slice(0, 6)
        .map(item => item.label || item.type || stringifyItem(item))
        .filter(Boolean)
        .join(' / ');
    }

    function getBatchReportScenarioPayload(scenario = {}) {
      try {
        return normalizeScenarioPayload(scenario.payload || {});
      } catch {
        return null;
      }
    }

    function buildBatchReportItem(scenario = {}, response = {}, durationMs = 0, index = 1) {
      const payload = scenario.payload || {};
      const errors = toArray(response?.errors);
      const actions = toArray(response?.actions);
      const timeline = toArray(response?.timeline);
      return {
        index,
        id: scenario.id || '',
        name: scenario.name || `场景 ${index}`,
        status: response?.success === true ? 'success' : 'failed',
        success: response?.success === true,
        durationMs: Math.max(0, Math.round(Number(durationMs || 0))),
        eventType: payload.eventType || response?.event?.eventType || 'message',
        adapterFormat: payload.adapterFormat || response?.event?.adapterFormat || 'onebot',
        groupId: payload.groupId || '',
        userId: payload.userId || '',
        messageText: clipText(payload.messageText || payload.comment || '', 80),
        groupHistoryCount: toArray(payload.groupHistory).length || toArray(response?.event?.group_history).length,
        actionCount: actions.length,
        errorCount: errors.length,
        timelineCount: timeline.length,
        actionSummary: getActionSummary(actions),
        timelineSummary: getTimelineSummary(timeline),
        errors: errors.map(item => stringifyItem(item)).slice(0, 6),
        scenarioPayload: getBatchReportScenarioPayload(scenario),
      };
    }

    function buildSkippedBatchReportItem(scenario = {}, index = 1) {
      const payload = scenario.payload || {};
      return {
        index,
        id: scenario.id || '',
        name: scenario.name || `场景 ${index}`,
        status: 'skipped',
        success: false,
        durationMs: 0,
        eventType: payload.eventType || 'message',
        adapterFormat: payload.adapterFormat || 'onebot',
        groupId: payload.groupId || '',
        userId: payload.userId || '',
        messageText: clipText(payload.messageText || payload.comment || '', 80),
        groupHistoryCount: toArray(payload.groupHistory).length,
        actionCount: 0,
        errorCount: 0,
        timelineCount: 0,
        actionSummary: '',
        timelineSummary: '',
        errors: ['批量回放停止，未执行该场景。'],
        scenarioPayload: getBatchReportScenarioPayload(scenario),
      };
    }

    function createBatchReport(queue = []) {
      const scenarios = toArray(queue);
      return {
        id: `batch-${Date.now()}`,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: '',
        total: scenarios.length,
        items: [],
      };
    }

    function finishBatchReport(status = 'completed') {
      if (!state.batchReport) return;
      state.batchReport.status = status;
      state.batchReport.finishedAt = new Date().toISOString();
      const summary = summarizeBatchItems(state.batchReport.items);
      state.batchReport.summary = summary;
    }

    function formatBatchReportStatus(status = '') {
      if (status === 'running') return '回放中';
      if (status === 'stopped') return '已停止';
      return '已完成';
    }

    function normalizeBatchReportFilter(value = '') {
      const filter = String(value || 'all').trim();
      return ['all', 'success', 'failed', 'skipped'].includes(filter) ? filter : 'all';
    }

    function getBatchReportFilterLabel(value = '') {
      const filter = normalizeBatchReportFilter(value);
      if (filter === 'success') return '只看成功';
      if (filter === 'failed') return '只看失败';
      if (filter === 'skipped') return '只看跳过';
      return '全部结果';
    }

    function getFilteredBatchReportItems(items = [], filter = state.batchReportFilter) {
      const normalizedFilter = normalizeBatchReportFilter(filter);
      const normalizedItems = toArray(items);
      if (normalizedFilter === 'all') return normalizedItems;
      return normalizedItems.filter(item => item?.status === normalizedFilter);
    }

    function renderBatchReport() {
      const container = $('qq-simulator-batch-report');
      const copyButton = $('qq-simulator-copy-report-btn');
      const exportMarkdownButton = $('qq-simulator-export-report-md-btn');
      const clearButton = $('qq-simulator-clear-report-btn');
      const filterSelect = $('qq-simulator-report-filter');
      if (!container) return;
      const report = state.batchReport;
      const hasItems = Boolean(report && toArray(report.items).length > 0);
      if (copyButton) copyButton.disabled = !hasItems;
      if (exportMarkdownButton) exportMarkdownButton.disabled = !hasItems;
      if (clearButton) clearButton.disabled = !report;
      if (filterSelect) {
        filterSelect.value = normalizeBatchReportFilter(state.batchReportFilter);
        filterSelect.disabled = !hasItems;
      }
      if (!report) {
        container.textContent = '暂无批量回放报告';
        return;
      }

      const summary = summarizeBatchItems(report.items);
      const filteredItems = getFilteredBatchReportItems(report.items);
      const summaryNode = document.createElement('div');
      summaryNode.className = 'qq-simulator-report-summary';
      [
        ['状态', formatBatchReportStatus(report.status)],
        ['总数', String(report.total || summary.total)],
        ['成功', String(summary.success)],
        ['失败', String(summary.failed)],
        ['跳过', String(summary.skipped)],
        ['显示', `${getBatchReportFilterLabel(state.batchReportFilter)} / ${filteredItems.length}`],
        ['耗时', `${summary.durationMs}ms`],
      ].forEach(([label, value]) => {
        const item = document.createElement('div');
        const labelNode = document.createElement('span');
        labelNode.textContent = label;
        const valueNode = document.createElement('strong');
        valueNode.textContent = value;
        item.append(labelNode, valueNode);
        summaryNode.appendChild(item);
      });

      const list = document.createElement('div');
      list.className = 'qq-simulator-report-list';
      if (report.items.length === 0) {
        list.textContent = '等待场景回放结果...';
      } else if (filteredItems.length === 0) {
        list.textContent = `当前筛选没有结果：${getBatchReportFilterLabel(state.batchReportFilter)}`;
      } else {
        const nodes = filteredItems.map(item => {
          const card = document.createElement('div');
          card.className = `qq-simulator-report-item status-${item.status}`;
          const head = document.createElement('div');
          head.className = 'qq-simulator-report-head';
          const title = document.createElement('strong');
          title.textContent = `${item.index}. ${item.name}`;
          const badge = document.createElement('span');
          badge.textContent = item.status === 'success' ? '成功' : item.status === 'skipped' ? '跳过' : '失败';
          head.append(title, badge);

          const meta = document.createElement('div');
          meta.className = 'qq-simulator-report-meta';
          meta.textContent = [
            item.adapterFormat,
            item.eventType,
            `群 ${item.groupId || '未填'}`,
            `用户 ${item.userId || '未填'}`,
            `耗时 ${item.durationMs}ms`,
            `群历史 ${item.groupHistoryCount || 0} 条`,
            `动作 ${item.actionCount || 0}`,
            `时间线 ${item.timelineCount || 0}`,
          ].join(' · ');

          const detail = document.createElement('pre');
          detail.textContent = [
            item.messageText ? `输入: ${item.messageText}` : '',
            item.actionSummary ? `动作: ${item.actionSummary}` : '',
            item.timelineSummary ? `时间线: ${item.timelineSummary}` : '',
            item.errors?.length ? `错误: ${item.errors.join('；')}` : '',
          ].filter(Boolean).join('\n') || '无额外摘要';
          card.append(head, meta, detail);
          if (item.status !== 'success' && item.scenarioPayload) {
            const actions = document.createElement('div');
            actions.className = 'qq-simulator-report-card-actions';
            const saveButton = document.createElement('button');
            saveButton.type = 'button';
            saveButton.className = 'mini-btn';
            saveButton.dataset.reportAction = 'save-regression';
            saveButton.dataset.reportIndex = String(item.index || '');
            saveButton.disabled = state.isSending || state.isBatchReplaying;
            saveButton.textContent = '保存为回归场景';
            actions.appendChild(saveButton);
            card.appendChild(actions);
          }
          return card;
        });
        list.replaceChildren(...nodes);
      }

      container.replaceChildren(summaryNode, list);
    }

    function serializeBatchReport() {
      if (!state.batchReport) return '';
      return JSON.stringify({
        ...state.batchReport,
        summary: summarizeBatchItems(state.batchReport.items),
        filter: normalizeBatchReportFilter(state.batchReportFilter),
        filteredItems: getFilteredBatchReportItems(state.batchReport.items),
      }, null, 2);
    }

    function escapeMarkdownTableCell(value = '') {
      return String(value ?? '')
        .replace(/\r?\n/g, '<br>')
        .replace(/\|/g, '\\|');
    }

    function serializeBatchReportMarkdown() {
      if (!state.batchReport) return '';
      const report = state.batchReport;
      const summary = summarizeBatchItems(report.items);
      const filteredItems = getFilteredBatchReportItems(report.items);
      const lines = [
        '# 模拟调试批量回放报告',
        '',
        `- 状态：${formatBatchReportStatus(report.status)}`,
        `- 开始：${report.startedAt || '未知'}`,
        `- 结束：${report.finishedAt || '未结束'}`,
        `- 总数：${report.total || summary.total}`,
        `- 成功：${summary.success}`,
        `- 失败：${summary.failed}`,
        `- 跳过：${summary.skipped}`,
        `- 耗时：${summary.durationMs}ms`,
        `- 当前筛选：${getBatchReportFilterLabel(state.batchReportFilter)} / ${filteredItems.length} 条`,
        '',
        '| # | 状态 | 场景 | 适配器 | 事件 | 群 | 用户 | 耗时 | 摘要 |',
        '|---|---|---|---|---|---|---|---:|---|',
      ];
      if (filteredItems.length === 0) {
        lines.push('| - | - | 当前筛选没有结果 | - | - | - | - | - | - |');
      } else {
        filteredItems.forEach(item => {
          const status = item.status === 'success' ? '成功' : item.status === 'skipped' ? '跳过' : '失败';
          const detail = [
            item.messageText ? `输入: ${item.messageText}` : '',
            item.actionSummary ? `动作: ${item.actionSummary}` : '',
            item.timelineSummary ? `时间线: ${item.timelineSummary}` : '',
            item.errors?.length ? `错误: ${item.errors.join('；')}` : '',
          ].filter(Boolean).join('<br>') || '无额外摘要';
          lines.push([
            item.index,
            status,
            escapeMarkdownTableCell(item.name),
            escapeMarkdownTableCell(item.adapterFormat),
            escapeMarkdownTableCell(item.eventType),
            escapeMarkdownTableCell(item.groupId || '未填'),
            escapeMarkdownTableCell(item.userId || '未填'),
            `${item.durationMs || 0}ms`,
            escapeMarkdownTableCell(detail),
          ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
        });
      }
      lines.push('');
      return lines.join('\n');
    }

    function exportBatchReportMarkdown() {
      const markdown = serializeBatchReportMarkdown();
      if (!markdown) {
        updateStatus('当前没有可导出的批量回放报告。');
        return;
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      downloadTextFile(`crystelf-qq-simulator-batch-report-${stamp}.md`, markdown, 'text/markdown');
      updateStatus('已导出批量回放报告。', 'success');
    }

    async function copyBatchReport() {
      const text = serializeBatchReport();
      if (!text) {
        updateStatus('当前没有可复制的批量回放报告。');
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const input = document.createElement('textarea');
          input.value = text;
          input.setAttribute('readonly', 'readonly');
          input.style.position = 'fixed';
          input.style.left = '-9999px';
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          input.remove();
        }
        updateStatus('已复制批量回放报告。', 'success');
      } catch (error) {
        updateStatus(`复制报告失败：${error?.message || error}`, 'error');
      }
    }

    function clearBatchReport() {
      state.batchReport = null;
      renderBatchReport();
      updateStatus('已清空批量回放报告。');
    }

    function findBatchReportItem(index = '') {
      const reportItems = toArray(state.batchReport?.items);
      return reportItems.find(item => String(item.index || '') === String(index || '')) || null;
    }

    async function saveRegressionScenarioFromReport(index = '') {
      if (state.isSending || state.isBatchReplaying) {
        updateStatus('模拟请求进行中，暂时不能保存回归场景。', 'error');
        return;
      }
      return runScenarioLibraryTask(async () => {
        const item = findBatchReportItem(index);
        if (!item || item.status === 'success' || !item.scenarioPayload) {
          updateStatus('没有可保存的失败回归场景。', 'error');
          return;
        }
        const payload = normalizeScenarioPayload(item.scenarioPayload);
        const label = item.status === 'skipped' ? '回归跳过' : '回归失败';
        const name = clipText(`${label} - ${item.name || `场景 ${item.index || ''}`}`, 80) || `${label}场景`;
        const existing = state.scenarios.find(scenario => scenario.name === name);
        const scenario = normalizeScenarioItem({
          id: existing?.id || createScenarioId(),
          name,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          payload,
        });
        if (!scenario) {
          updateStatus('回归场景保存失败：场景内容无效。', 'error');
          return;
        }
        state.scenarios = [scenario, ...state.scenarios.filter(existingItem => existingItem.id !== scenario.id)].slice(0, MAX_SCENARIOS);
        writeStoredScenarios();
        if (state.scenarioStorageMode === 'server') {
          try {
            const saved = await saveScenarioToServer(scenario);
            const input = $('qq-simulator-scenario-name');
            if (input) input.value = saved.name || scenario.name;
            return;
          } catch (error) {
            updateStatus(`服务端保存回归场景失败，已保存在本地：${error.message}`, 'error');
          }
        }
        if (writeStoredScenarios()) {
          const input = $('qq-simulator-scenario-name');
          if (input) input.value = scenario.name;
          renderScenarios();
          updateStatus(`已保存回归场景：${scenario.name}`, 'success');
        }
      });
    }
    return {
      summarizeBatchItems,
      getBatchReportScenarioPayload,
      buildBatchReportItem,
      buildSkippedBatchReportItem,
      createBatchReport,
      finishBatchReport,
      normalizeBatchReportFilter,
      renderBatchReport,
      exportBatchReportMarkdown,
      copyBatchReport,
      clearBatchReport,
      saveRegressionScenarioFromReport,
    };
  }

  window.CrystelfQqSimulatorBatchReport = {
    createBatchReportHandlers,
  };
})();
