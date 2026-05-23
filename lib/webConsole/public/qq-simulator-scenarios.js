(function () {
  function createScenarioHandlers(deps = {}) {
    const {
      state,
      $,
      SCENARIO_STORAGE_KEY,
      SCENARIO_SERVER_SEEN_KEY,
      SCENARIO_ENDPOINT,
      MAX_SCENARIOS,
      EVENT_LABELS,
      requestJson,
      toArray,
      isPlainObject,
      stringifyItem,
      fileToText,
      normalizeGroupHistoryItems,
      normalizeAdapterFormat,
      getAdapterLabel,
      getPayload,
      setPayload,
      updateStatus,
      updateControlState,
      confirmQqSimulatorModal,
      addFlow,
      sendEvent,
      clipText,
    } = deps;

    const safeClipText = typeof clipText === 'function'
      ? clipText
      : (value = '', maxLength = 80) => {
          const chars = Array.from(String(value || '').replace(/\s+/g, ' ').trim());
          return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}...` : chars.join('');
        };

    function createScenarioId() {
      return `scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function normalizeScenarioPayload(payload = {}) {
      const source = isPlainObject(payload) ? payload : {};
      const applicant = isPlainObject(source.applicant) ? source.applicant : {};
      const voiceTranscript = String(source.voiceTranscript || source.voice?.transcript || '').trim();
      return {
        eventType: ['message', 'join_request', 'group_increase', 'poke'].includes(source.eventType) ? source.eventType : 'message',
        groupId: String(source.groupId || '').trim(),
        userId: String(source.userId || '').trim(),
        nickname: String(source.nickname || '').trim(),
        role: ['owner', 'admin', 'member'].includes(source.role) ? source.role : 'member',
        botRole: ['owner', 'admin', 'member'].includes(source.botRole) ? source.botRole : 'member',
        adapterFormat: normalizeAdapterFormat(source.adapterFormat),
        isMaster: source.isMaster === true,
        messageText: String(source.messageText || '').trim(),
        includeAt: source.includeAt !== false,
        dispatchMode: source.dispatchMode === 'replay' ? 'replay' : 'safe',
        conversationMode: source.conversationMode !== false,
        history: [],
        groupHistory: normalizeGroupHistoryItems(source.groupHistory),
        images: toArray(source.images).map(item => String(item || '').trim()).filter(Boolean).slice(0, 20),
        screenshots: [],
        voice: null,
        voiceTranscript,
        applicant: {
          qqLevel: Number.isFinite(Number(applicant.qqLevel)) ? Math.min(255, Math.max(0, Math.round(Number(applicant.qqLevel)))) : null,
          age: Number.isFinite(Number(applicant.age)) ? Math.min(150, Math.max(0, Math.round(Number(applicant.age)))) : null,
          sex: String(applicant.sex || '').trim().slice(0, 20),
          warningCount: Number.isFinite(Number(applicant.warningCount)) ? Math.min(100, Math.max(0, Math.round(Number(applicant.warningCount)))) : null,
          listStatus: ['normal', 'whitelist', 'blacklist'].includes(applicant.listStatus) ? applicant.listStatus : 'normal',
        },
        comment: String(source.comment || '').trim(),
      };
    }

    function buildScenarioName(payload = {}) {
      const eventLabel = EVENT_LABELS[payload.eventType] || payload.eventType || '场景';
      const brief = safeClipText(payload.messageText || payload.comment || payload.nickname || '测试', 18);
      return `${eventLabel} · 群${payload.groupId || '未填'} · ${brief}`;
    }

    function normalizeScenarioItem(item = {}) {
      if (!isPlainObject(item) || !isPlainObject(item.payload)) return null;
      const payload = normalizeScenarioPayload(item.payload);
      const name = safeClipText(item.name || buildScenarioName(payload), 80) || buildScenarioName(payload);
      const createdAt = item.createdAt || new Date().toISOString();
      return {
        id: String(item.id || createScenarioId()),
        name,
        createdAt,
        updatedAt: item.updatedAt || createdAt,
        source: String(item.source || '').trim().slice(0, 80),
        payload,
      };
    }

    function readStoredScenarios() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(SCENARIO_STORAGE_KEY) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeScenarioItem).filter(Boolean).slice(0, MAX_SCENARIOS);
      } catch (error) {
        return [];
      }
    }

    function writeStoredScenarios() {
      try {
        window.localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(state.scenarios.slice(0, MAX_SCENARIOS)));
        return true;
      } catch (error) {
        updateStatus(`场景保存失败：${error?.message || error}`, 'error');
        return false;
      }
    }

    function hasSeenServerScenarios() {
      try {
        return window.localStorage.getItem(SCENARIO_SERVER_SEEN_KEY) === '1';
      } catch {
        return false;
      }
    }

    function markServerScenariosSeen() {
      try {
        window.localStorage.setItem(SCENARIO_SERVER_SEEN_KEY, '1');
      } catch {}
    }

    async function fetchJson(url, options = {}) {
      return requestJson(url, options);
    }

    async function postJson(url, payload = {}) {
      return requestJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    function getScenarioConflictStrategy() {
      const value = $('qq-simulator-conflict-strategy')?.value || 'overwrite';
      return ['overwrite', 'skip', 'rename'].includes(value) ? value : 'overwrite';
    }

    function applyScenarioPayload(data = {}, fallbackMessage = '') {
      const scenarios = normalizeImportedScenarioItems(data);
      state.scenarios = scenarios.slice(0, MAX_SCENARIOS);
      state.scenarioStorageMode = 'server';
      writeStoredScenarios();
      renderScenarios();
      if (fallbackMessage || data.message) {
        updateStatus(data.message || fallbackMessage, 'success');
      }
    }

    async function loadServerScenarios(options = {}) {
      try {
        const data = await fetchJson(SCENARIO_ENDPOINT);
        const serverItems = normalizeImportedScenarioItems(data);
        const serverSeen = hasSeenServerScenarios();
        if (serverItems.length > 0) {
          applyScenarioPayload(data);
          markServerScenariosSeen();
          return true;
        }
        state.scenarioStorageMode = 'server';
        if (!serverSeen && options.migrateLocal !== false && state.scenarios.length > 0) {
          try {
            const imported = await postJson(`${SCENARIO_ENDPOINT}/import`, { scenarios: state.scenarios });
            applyScenarioPayload(imported, '已把本地场景同步到服务端。');
            markServerScenariosSeen();
            return true;
          } catch (error) {
            state.scenarioStorageMode = 'local';
            renderScenarios();
            updateStatus(`本地场景同步到服务端失败，继续使用本地缓存：${error.message}`, 'error');
            return true;
          }
        } else {
          applyScenarioPayload(data);
        }
        markServerScenariosSeen();
        return true;
      } catch (error) {
        state.scenarioStorageMode = 'local';
        renderScenarios();
        updateStatus(`服务端场景暂不可用，已使用本地场景：${error.message}`, 'error');
        return false;
      }
    }

    async function saveScenarioToServer(scenario = {}) {
      const data = await postJson(`${SCENARIO_ENDPOINT}/save`, {
        scenario,
        conflictStrategy: getScenarioConflictStrategy(),
      });
      applyScenarioPayload(data, data.message || '模拟场景已保存到服务端。');
      return data.scenario || scenario;
    }

    async function deleteScenarioFromServer(id = '') {
      const data = await postJson(`${SCENARIO_ENDPOINT}/delete`, { id });
      applyScenarioPayload(data, data.message || '模拟场景已删除。');
    }

    async function clearScenariosFromServer() {
      const data = await postJson(`${SCENARIO_ENDPOINT}/clear`, {});
      applyScenarioPayload(data, data.message || '服务端模拟场景已清空。');
    }

    async function importScenariosToServer(importedItems = []) {
      const data = await postJson(`${SCENARIO_ENDPOINT}/import`, {
        scenarios: importedItems,
        conflictStrategy: getScenarioConflictStrategy(),
      });
      applyScenarioPayload(data, data.message || '模拟场景已导入服务端。');
      return data;
    }

    async function loadScenarioBackupsFromServer() {
      const data = await fetchJson(`${SCENARIO_ENDPOINT}/backups`);
      state.scenarioBackups = Array.isArray(data.backups) ? data.backups : [];
      return state.scenarioBackups;
    }

    async function restoreScenarioBackupFromServer(id = '') {
      const data = await postJson(`${SCENARIO_ENDPOINT}/restore`, {
        id,
        conflictStrategy: getScenarioConflictStrategy() === 'overwrite' ? 'rename' : getScenarioConflictStrategy(),
      });
      applyScenarioPayload(data, data.message || '已恢复模拟场景。');
      return data;
    }

    async function runScenarioLibraryTask(task) {
      if (state.scenarioBusy) {
        updateStatus('场景库操作进行中，请稍后。', 'error');
        return undefined;
      }
      state.scenarioBusy = true;
      updateControlState();
      try {
        return await task();
      } finally {
        state.scenarioBusy = false;
        updateControlState();
      }
    }

    function getScenarioExportPayload() {
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        source: 'crystelf.qqSimulator',
        count: state.scenarios.length,
        scenarios: state.scenarios.slice(0, MAX_SCENARIOS),
      };
    }

    function buildScenarioExportFileName() {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      return `crystelf-qq-simulator-scenarios-${stamp}.json`;
    }

    function downloadTextFile(fileName = 'download.json', text = '', mimeType = 'application/json') {
      const blob = new Blob([String(text || '')], { type: `${mimeType};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportScenarios() {
      if (state.scenarios.length === 0) {
        updateStatus('当前没有可导出的场景。');
        return;
      }
      const payload = getScenarioExportPayload();
      downloadTextFile(buildScenarioExportFileName(), JSON.stringify(payload, null, 2));
      updateStatus(`已导出 ${payload.count} 个场景。`, 'success');
    }

    function normalizeImportedScenarioItems(source) {
      const root = isPlainObject(source) ? source : {};
      const rawItems = Array.isArray(source)
        ? source
        : Array.isArray(root.scenarios)
          ? root.scenarios
          : Array.isArray(root.items)
            ? root.items
            : [];
      return rawItems
        .map(normalizeScenarioItem)
        .filter(Boolean)
        .slice(0, MAX_SCENARIOS);
    }

    function renameScenarioForConflict(name = '', existingNames = new Set()) {
      const base = safeClipText(String(name || '模拟场景').replace(/\s+/g, ' ').trim(), 68) || '模拟场景';
      for (let index = 2; index <= 999; index += 1) {
        const candidate = safeClipText(`${base} (${index})`, 80);
        if (!existingNames.has(candidate)) return candidate;
      }
      return safeClipText(`${base} (${Date.now()})`, 80);
    }

    function mergeImportedScenarios(importedItems = [], conflictStrategy = 'overwrite') {
      const strategy = ['overwrite', 'skip', 'rename'].includes(conflictStrategy) ? conflictStrategy : 'overwrite';
      const merged = [...state.scenarios];
      let added = 0;
      let replaced = 0;
      let skipped = 0;
      let renamed = 0;
      for (let importIndex = importedItems.length - 1; importIndex >= 0; importIndex -= 1) {
        const item = importedItems[importIndex];
        const index = merged.findIndex(existing => existing.id === item.id || existing.name === item.name);
        const previous = index >= 0 ? merged[index] : null;
        if (previous && strategy === 'skip') {
          skipped += 1;
          continue;
        }
        const scenario = normalizeScenarioItem({
          ...item,
          id: previous
            ? (strategy === 'rename' ? createScenarioId() : previous.id)
            : item.id,
          name: previous && strategy === 'rename'
            ? renameScenarioForConflict(item.name, new Set(merged.map(existing => existing.name)))
            : item.name,
          createdAt: previous && strategy !== 'rename' ? previous.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        if (!scenario) continue;
        if (previous && strategy === 'rename') {
          renamed += 1;
        } else if (index >= 0) {
          merged.splice(index, 1);
          replaced += 1;
        } else {
          added += 1;
        }
        merged.unshift(scenario);
      }
      const dropped = Math.max(0, merged.length - MAX_SCENARIOS);
      state.scenarios = merged.slice(0, MAX_SCENARIOS);
      return { added, replaced, skipped, renamed, dropped };
    }

    function getScenarioSnapshot() {
      return normalizeScenarioPayload(getPayload());
    }

    function describeScenarioPayload(payload = {}) {
      const eventLabel = EVENT_LABELS[payload.eventType] || payload.eventType || '未知事件';
      const imageCount = toArray(payload.images).length;
      const groupHistoryCount = toArray(payload.groupHistory).length;
      const parts = [
        `${eventLabel}`,
        `群 ${payload.groupId || '未填写'}`,
        `${payload.nickname || '未填写用户'} (${payload.userId || '未填写QQ'})`,
        getAdapterLabel(payload.adapterFormat),
        payload.dispatchMode === 'replay' ? '链路回放' : '安全模拟',
        payload.includeAt ? '@机器人' : '未@机器人',
        groupHistoryCount > 0 ? `群历史${groupHistoryCount}条` : '',
        imageCount > 0 ? `图片URL ${imageCount}张` : '',
        payload.voiceTranscript ? '有语音转写' : '',
      ];
      return parts.filter(Boolean).join(' · ');
    }

    function getScenarioTags(scenario = {}) {
      const payload = scenario.payload || {};
      const tags = [payload.eventType || 'message'];
      if (/^回归/.test(String(scenario.name || ''))) tags.push('regression');
      if (scenario.source === 'group-management-log') tags.push('group-management-log');
      return tags;
    }

    function isScenarioMatched(scenario = {}) {
      const filter = state.scenarioFilter || 'all';
      const tags = getScenarioTags(scenario);
      if (filter !== 'all' && !tags.includes(filter)) return false;
      const query = String(state.scenarioSearch || '').trim().toLowerCase();
      if (!query) return true;
      const payload = scenario.payload || {};
      return [
        scenario.name,
        scenario.source,
        payload.eventType,
        payload.groupId,
        payload.userId,
        payload.nickname,
        payload.messageText,
        payload.comment,
        describeScenarioPayload(payload),
      ].some(value => String(value || '').toLowerCase().includes(query));
    }

    function renderScenarios() {
      const container = $('qq-simulator-scenario-list');
      if (!container) return;
      const searchInput = $('qq-simulator-scenario-search');
      const filterSelect = $('qq-simulator-scenario-filter');
      if (searchInput) searchInput.value = state.scenarioSearch || '';
      if (filterSelect) filterSelect.value = state.scenarioFilter || 'all';
      const matchedScenarios = state.scenarios.filter(isScenarioMatched);
      const meta = document.createElement('div');
      meta.className = 'setting-help';
      const filterText = matchedScenarios.length === state.scenarios.length
        ? ''
        : ` / 当前显示 ${matchedScenarios.length}`;
      meta.textContent = state.scenarioStorageMode === 'server'
        ? `服务端场景 ${state.scenarios.length}/${MAX_SCENARIOS} 个${filterText}`
        : `本地浏览器场景 ${state.scenarios.length}/${MAX_SCENARIOS} 个${filterText}`;
      if (state.scenarios.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'qq-simulator-scenario-empty';
        empty.textContent = '暂无保存场景';
        container.replaceChildren(meta, empty);
        return;
      }
      if (matchedScenarios.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'qq-simulator-scenario-empty';
        empty.textContent = '没有匹配的场景';
        container.replaceChildren(meta, empty);
        return;
      }
      const busy = state.isSending || state.isBatchReplaying;
      const nodes = matchedScenarios.map((scenario, index) => {
        const card = document.createElement('div');
        card.className = 'qq-simulator-scenario-card';
        card.dataset.scenarioId = scenario.id;

        const main = document.createElement('div');
        main.className = 'qq-simulator-scenario-main';
        const title = document.createElement('strong');
        title.textContent = scenario.name || `场景 ${index + 1}`;
        const meta = document.createElement('span');
        meta.textContent = describeScenarioPayload(scenario.payload);
        main.append(title, meta);

        const actions = document.createElement('div');
        actions.className = 'qq-simulator-scenario-actions';
        [
          ['load', '载入'],
          ['run', '回放'],
          ['delete', '删除'],
        ].forEach(([action, label]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = action === 'delete' ? 'mini-btn danger' : 'mini-btn';
          button.dataset.scenarioAction = action;
          button.dataset.scenarioId = scenario.id;
          button.disabled = busy;
          button.textContent = label;
          actions.appendChild(button);
        });

        card.append(main, actions);
        return card;
      });
      container.replaceChildren(meta, ...nodes);
    }

    const batchReportHandlers = window.CrystelfQqSimulatorBatchReport.createBatchReportHandlers({
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
      clipText: safeClipText,
    });

    const {
      summarizeBatchItems,
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
    } = batchReportHandlers;

    async function saveCurrentScenario() {
      if (state.isSending || state.isBatchReplaying) {
        updateStatus('模拟请求进行中，暂时不能保存场景。', 'error');
        return;
      }
      return runScenarioLibraryTask(async () => {
        const payload = getScenarioSnapshot();
        const input = $('qq-simulator-scenario-name');
        const name = safeClipText(input?.value || buildScenarioName(payload), 80) || buildScenarioName(payload);
        const existing = state.scenarios.find(item => item.name === name);
        const scenario = normalizeScenarioItem({
          id: existing?.id || createScenarioId(),
          name,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          payload,
        });
        if (!scenario) return;
        state.scenarios = [scenario, ...state.scenarios.filter(item => item.id !== scenario.id)].slice(0, MAX_SCENARIOS);
        writeStoredScenarios();
        if (state.scenarioStorageMode === 'server') {
          try {
            const saved = await saveScenarioToServer(scenario);
            if (input) input.value = saved.name || scenario.name;
            return;
          } catch (error) {
            updateStatus(`服务端保存失败，已保存在本地：${error.message}`, 'error');
          }
        }
        if (writeStoredScenarios()) {
          renderScenarios();
          if (input) input.value = scenario.name;
          updateStatus(`已保存场景：${scenario.name}`, 'success');
        }
      });
    }

    function findScenario(id = '') {
      return state.scenarios.find(item => item.id === id) || null;
    }

    function loadScenario(id = '') {
      const scenario = findScenario(id);
      if (!scenario) {
        updateStatus('未找到场景。', 'error');
        return;
      }
      setPayload(scenario.payload);
      const input = $('qq-simulator-scenario-name');
      if (input) input.value = scenario.name;
      updateStatus(`已载入场景：${scenario.name}`);
    }

    async function deleteScenario(id = '') {
      return runScenarioLibraryTask(async () => {
        const scenario = findScenario(id);
        if (!scenario) return;
        if (state.scenarioStorageMode === 'server') {
          try {
            await deleteScenarioFromServer(id);
            return;
          } catch (error) {
            updateStatus(`服务端删除失败，已保留当前场景：${error.message}`, 'error');
            return;
          }
        }
        state.scenarios = state.scenarios.filter(item => item.id !== id);
        if (writeStoredScenarios()) {
          renderScenarios();
          updateStatus(`已删除场景：${scenario.name}`);
        }
      });
    }

    async function clearScenarios() {
      return runScenarioLibraryTask(async () => {
        if (state.scenarios.length === 0) {
          updateStatus('当前没有保存的场景。');
          return;
        }
        const storageLabel = state.scenarioStorageMode === 'server' ? '服务端保存的' : '当前浏览器保存的';
        if (!await confirmQqSimulatorModal(`确定清空${storageLabel}所有模拟场景吗？\n\n服务端模式会先自动放入回收站。`, { title: '清空模拟场景' })) {
          return;
        }
        if (state.scenarioStorageMode === 'server') {
          try {
            await clearScenariosFromServer();
            return;
          } catch (error) {
            updateStatus(`服务端清空失败，已保留当前场景：${error.message}`, 'error');
            return;
          }
        }
        state.scenarios = [];
        if (writeStoredScenarios()) {
          renderScenarios();
          updateStatus('已清空保存的场景。');
        }
      });
    }

    async function importScenariosFromFile(file = null) {
      if (state.isSending || state.isBatchReplaying) {
        updateStatus('模拟请求进行中，暂时不能导入场景。', 'error');
        return;
      }
      if (!file) return;
      return runScenarioLibraryTask(async () => {
        if (!/\.json$/i.test(file.name || '') && !/json/i.test(file.type || '')) {
          updateStatus('请选择从场景库导出的文件。', 'error');
          return;
        }
        try {
          const text = await fileToText(file);
          const parsed = JSON.parse(text || 'null');
          const importedItems = normalizeImportedScenarioItems(parsed);
          if (importedItems.length === 0) {
            updateStatus('未找到有效场景，导入已取消。', 'error');
            return;
          }
          if (state.scenarioStorageMode === 'server') {
            try {
              const result = await importScenariosToServer(importedItems);
              const detailText = [
                `新增 ${result.added || 0}`,
                `更新 ${result.replaced || 0}`,
                result.skipped > 0 ? `跳过 ${result.skipped}` : '',
                result.renamed > 0 ? `重命名 ${result.renamed}` : '',
                result.dropped > 0 ? `丢弃 ${result.dropped}` : '',
              ].filter(Boolean).join('，');
              updateStatus(`已导入 ${importedItems.length} 个场景：${detailText}。`, 'success');
              return;
            } catch (error) {
              updateStatus(`服务端导入失败，将尝试本地导入：${error.message}`, 'error');
            }
          }
          const result = mergeImportedScenarios(importedItems, getScenarioConflictStrategy());
          if (!writeStoredScenarios()) return;
          renderScenarios();
          const detailText = [
            `新增 ${result.added}`,
            `更新 ${result.replaced}`,
            result.skipped > 0 ? `跳过 ${result.skipped}` : '',
            result.renamed > 0 ? `重命名 ${result.renamed}` : '',
            result.dropped > 0 ? `丢弃 ${result.dropped}` : '',
          ].filter(Boolean).join('，');
          updateStatus(`已导入 ${importedItems.length} 个场景：${detailText}。`, 'success');
        } catch (error) {
          updateStatus(`场景导入失败：${error?.message || error}`, 'error');
        }
      });
    }

    async function openScenarioBackupsModal() {
      if (state.scenarioStorageMode !== 'server') {
        updateStatus('当前使用本地场景库，回收站只在服务端场景库可用。', 'error');
        return;
      }
      await runScenarioLibraryTask(async () => {
        let backups = [];
        try {
          backups = await loadScenarioBackupsFromServer();
        } catch (error) {
          updateStatus(`读取回收站失败：${error.message}`, 'error');
          return;
        }
        const list = document.createElement('div');
        list.className = 'qq-simulator-backup-list';
        if (backups.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'qq-simulator-scenario-empty';
          empty.textContent = '回收站为空';
          list.appendChild(empty);
        } else {
          backups.forEach((backup) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'list-item qq-simulator-backup-item';
            item.dataset.backupId = backup.id;
            item.textContent = `${backup.createdAt || '未知时间'} / ${backup.action || 'unknown'} / ${backup.count || 0} 个场景`;
            list.appendChild(item);
          });
        }
        const confirmed = await confirmQqSimulatorModal('选择一个回收站备份进行恢复。恢复时默认用当前冲突策略，覆盖模式会自动改为重命名。', {
          title: '模拟场景回收站',
          extra: list,
        });
        if (!confirmed) return;
        const selected = list.querySelector('.qq-simulator-backup-item.is-selected');
        const backupId = selected?.dataset.backupId || '';
        if (!backupId) {
          updateStatus('请先选择一个要恢复的场景备份。', 'error');
          return;
        }
        await restoreScenarioBackupFromServer(backupId);
      });
    }

    async function replayScenarios(queue = []) {
      const scenarios = toArray(queue).filter(item => item && isPlainObject(item.payload));
      if (state.isSending || state.isBatchReplaying) {
        updateStatus('已有模拟事件正在发送，可以先取消当前请求。', 'error');
        return;
      }
      if (scenarios.length === 0) {
        updateStatus('没有可回放的场景。', 'error');
        return;
      }

      let successCount = 0;
      let failureCount = 0;
      let completedCount = 0;
      state.batchReport = createBatchReport(scenarios);
      renderBatchReport();
      state.isBatchReplaying = true;
      state.stopBatchReplay = false;
      updateControlState();
      addFlow({
        side: 'assistant',
        title: '场景回放',
        body: `开始回放 ${scenarios.length} 个场景。`,
      });

      try {
        for (let index = 0; index < scenarios.length; index += 1) {
          if (state.stopBatchReplay) break;
          const scenario = scenarios[index];
          setPayload(scenario.payload);
          updateStatus(`正在回放 ${index + 1}/${scenarios.length}：${scenario.name}`);
          const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
          await sendEvent(scenario.payload.eventType, { fromBatch: true });
          const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
          completedCount += 1;
          if (state.lastResponse?.success === true) {
            successCount += 1;
          } else {
            failureCount += 1;
          }
          if (state.batchReport) {
            state.batchReport.items.push(buildBatchReportItem(
              scenario,
              state.lastResponse || {},
              finishedAt - startedAt,
              index + 1
            ));
            renderBatchReport();
          }
          await new Promise(resolve => window.setTimeout(resolve, 150));
        }
      } finally {
        const stopped = state.stopBatchReplay;
        if (stopped && state.batchReport) {
          scenarios.slice(completedCount).forEach((scenario, offset) => {
            state.batchReport.items.push(buildSkippedBatchReportItem(scenario, completedCount + offset + 1));
          });
        }
        finishBatchReport(stopped ? 'stopped' : 'completed');
        state.isBatchReplaying = false;
        state.stopBatchReplay = false;
        updateControlState();
        renderScenarios();
        renderBatchReport();
        const summary = stopped
          ? `批量回放已停止：成功 ${successCount}，失败 ${failureCount}。`
          : `批量回放完成：成功 ${successCount}，失败 ${failureCount}。`;
        addFlow({
          side: 'assistant',
          title: '场景回放结果',
          body: summary,
        });
        updateStatus(summary, failureCount > 0 || stopped ? 'error' : 'success');
      }
    }

    function handleScenarioAction(event) {
      const button = event.target.closest('[data-scenario-action]');
      if (!button) return;
      const scenarioId = button.dataset.scenarioId || '';
      const action = button.dataset.scenarioAction || '';
      if (action === 'load') {
        loadScenario(scenarioId);
        return;
      }
      if (action === 'run') {
        const scenario = findScenario(scenarioId);
        if (scenario) void replayScenarios([scenario]);
        return;
      }
      if (action === 'delete') {
        void deleteScenario(scenarioId);
      }
    }

    function handleBatchReportAction(event) {
      const button = event.target.closest('[data-report-action]');
      if (!button) return;
      const action = button.dataset.reportAction || '';
      if (action === 'save-regression') {
        void saveRegressionScenarioFromReport(button.dataset.reportIndex || '');
      }
    }

    return {
      createScenarioId,
      normalizeScenarioPayload,
      buildScenarioName,
      normalizeScenarioItem,
      readStoredScenarios,
      writeStoredScenarios,
      getScenarioConflictStrategy,
      loadServerScenarios,
      saveScenarioToServer,
      renderScenarios,
      normalizeBatchReportFilter,
      renderBatchReport,
      exportScenarios,
      exportBatchReportMarkdown,
      copyBatchReport,
      clearBatchReport,
      saveCurrentScenario,
      findScenario,
      loadScenario,
      deleteScenario,
      clearScenarios,
      importScenariosFromFile,
      openScenarioBackupsModal,
      replayScenarios,
      handleScenarioAction,
      handleBatchReportAction,
      isScenarioMatched,
    };
  }

  window.CrystelfQqSimulatorScenarios = { createScenarioHandlers };
})();
