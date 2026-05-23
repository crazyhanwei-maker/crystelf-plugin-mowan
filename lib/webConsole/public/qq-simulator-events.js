(function () {
  function createEventHandlers(deps = {}) {
    const {
      state,
      $,
      presets,
      encodeCqValue,
      normalizeScenarioPayload,
      findScenario,
      loadScenario,
      updateStatus,
      setPayload,
      updateSummary,
      syncChatInputFromMessage,
      sendEvent,
      addImageFiles,
      captureScreenshot,
      renderAttachmentPreview,
      addVoiceFile,
      cancelActiveRequest,
      clearAll,
      copyBatchReport,
      exportBatchReportMarkdown,
      clearBatchReport,
      normalizeBatchReportFilter,
      renderBatchReport,
      saveCurrentScenario,
      renderScenarios,
      exportScenarios,
      importScenariosFromFile,
      replayScenarios,
      isScenarioMatched,
      openScenarioBackupsModal,
      clearScenarios,
      handleScenarioAction,
      handleBatchReportAction,
      closeQqSimulatorModal,
    } = deps;

    const safeClearBatchReport = typeof clearBatchReport === 'function'
      ? clearBatchReport
      : () => {
          state.batchReport = null;
          if (typeof renderBatchReport === 'function') {
            renderBatchReport();
          }
          updateStatus('已清空批量回放报告。');
        };
  function getSegmentBuilderValue(id, fallback = '') {
    const value = String($(id)?.value || '').trim();
    return value || fallback;
  }

  function insertTextAtCursor(text = '') {
    const snippet = String(text || '');
    if (!snippet) return;
    const messageInput = $('qq-simulator-message-text');
    const chatInput = $('qq-simulator-chat-input');
    const target = document.activeElement === chatInput ? chatInput : messageInput;
    const current = String(target.value || '');
    const start = Number.isFinite(target.selectionStart) ? target.selectionStart : current.length;
    const end = Number.isFinite(target.selectionEnd) ? target.selectionEnd : current.length;
    const prefix = start > 0 && !/[\s\n]$/.test(current.slice(0, start)) ? ' ' : '';
    const suffix = end < current.length && !/^[\s\n]/.test(current.slice(end)) ? ' ' : '';
    const next = `${current.slice(0, start)}${prefix}${snippet}${suffix}${current.slice(end)}`;
    const cursor = start + prefix.length + snippet.length + suffix.length;
    target.value = next;
    target.focus();
    target.setSelectionRange(cursor, cursor);
    messageInput.value = next;
    chatInput.value = next;
    messageInput.dispatchEvent(new Event('input', { bubbles: true }));
    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    updateSummary();
  }

  function buildSegmentSnippet(type = '') {
    const userId = getSegmentBuilderValue('qq-simulator-segment-user-id', $('qq-simulator-user-id')?.value || '20001');
    const mediaUrl = getSegmentBuilderValue('qq-simulator-segment-media-url', 'https://example.com/image.jpg');
    const faceId = getSegmentBuilderValue('qq-simulator-segment-face-id', '14');
    const replyId = getSegmentBuilderValue('qq-simulator-segment-reply-id', '900001');
    const memeCharacter = getSegmentBuilderValue('qq-simulator-segment-meme-character', '芙宁娜');
    const memeEmotion = getSegmentBuilderValue('qq-simulator-segment-meme-emotion', 'default');
    const customCq = getSegmentBuilderValue('qq-simulator-segment-cq-code', '[CQ:poke,qq=10000]');
    if (type === 'at') return `[CQ:at,qq=${encodeCqValue(userId)}]`;
    if (type === 'image') return `[CQ:image,file=${encodeCqValue(mediaUrl)}]`;
    if (type === 'record') return `[CQ:record,file=${encodeCqValue(mediaUrl)}]`;
    if (type === 'face') return `[CQ:face,id=${encodeCqValue(faceId)}]`;
    if (type === 'reply') return `[CQ:reply,id=${encodeCqValue(replyId)}]`;
    if (type === 'meme') return `[meme:${encodeCqValue(memeCharacter)}:${encodeCqValue(memeEmotion)}]`;
    if (type === 'cq') return customCq;
    return '';
  }

  function insertMessageSegment(type = '') {
    const snippet = buildSegmentSnippet(type);
    if (!snippet) {
      updateStatus('没有可插入的消息段。', 'error');
      return;
    }
    insertTextAtCursor(snippet);
    updateStatus('已插入消息段。', 'success');
  }

  function parseUrlBoolean(params, key = '', fallback = false) {
    if (!params.has(key)) return fallback;
    const value = String(params.get(key) || '').trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', '是', '开启'].includes(value)) return true;
    if (['0', 'false', 'no', 'off', '否', '关闭'].includes(value)) return false;
    return fallback;
  }

  function getStartupPayloadFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    const supportedKeys = [
      'eventType',
      'groupId',
      'userId',
      'nickname',
      'role',
      'botRole',
      'adapterFormat',
      'messageText',
      'includeAt',
      'isMaster',
      'dispatchMode',
      'conversationMode',
      'comment',
    ];
    if (!supportedKeys.some(key => params.has(key))) return null;
    const payload = { ...presets.message };
    ['eventType', 'groupId', 'userId', 'nickname', 'role', 'botRole', 'adapterFormat', 'messageText', 'dispatchMode', 'comment'].forEach(key => {
      if (params.has(key)) payload[key] = String(params.get(key) || '').trim();
    });
    payload.includeAt = parseUrlBoolean(params, 'includeAt', payload.includeAt !== false);
    payload.isMaster = parseUrlBoolean(params, 'isMaster', payload.isMaster === true);
    payload.conversationMode = parseUrlBoolean(params, 'conversationMode', payload.conversationMode !== false);
    return normalizeScenarioPayload(payload);
  }

  function getStartupScenarioIdFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    return String(params.get('scenarioId') || '').trim();
  }

  function loadStartupScenarioFromUrl() {
    const scenarioId = getStartupScenarioIdFromUrl();
    if (!scenarioId) return false;
    const scenario = findScenario(scenarioId);
    if (!scenario) {
      updateStatus('链接指定的服务端场景不存在或尚未加载。', 'error');
      return false;
    }
    loadScenario(scenarioId);
    updateStatus(`已载入日志转换场景：${scenario.name}`, 'success');
    return true;
  }

  function bindEvents() {
    document.querySelectorAll('[data-preset]').forEach(button => {
      button.addEventListener('click', () => {
        const preset = presets[button.dataset.preset];
        if (preset) {
          setPayload(preset);
          updateStatus('已填入预设。');
        }
      });
    });

    [
      'qq-simulator-event-type',
      'qq-simulator-role',
      'qq-simulator-bot-role',
      'qq-simulator-adapter-format',
      'qq-simulator-group-id',
      'qq-simulator-user-id',
      'qq-simulator-nickname',
      'qq-simulator-is-master',
      'qq-simulator-include-at',
      'qq-simulator-dispatch-mode',
      'qq-simulator-conversation-mode',
      'qq-simulator-qq-level',
      'qq-simulator-age',
      'qq-simulator-sex',
      'qq-simulator-warning-count',
      'qq-simulator-list-status',
      'qq-simulator-message-text',
      'qq-simulator-images',
      'qq-simulator-group-history',
      'qq-simulator-voice-transcript',
      'qq-simulator-comment',
    ].forEach(id => {
      $(id).addEventListener('input', () => updateSummary());
      $(id).addEventListener('change', () => updateSummary());
    });

    $('qq-simulator-message-text').addEventListener('input', syncChatInputFromMessage);
    $('qq-simulator-chat-input').addEventListener('input', () => {
      $('qq-simulator-message-text').value = $('qq-simulator-chat-input').value;
      updateSummary();
    });
    $('qq-simulator-chat-input').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendEvent('message');
      }
    });
    document.querySelectorAll('[data-segment-insert]').forEach(button => {
      button.addEventListener('click', () => {
        insertMessageSegment(button.dataset.segmentInsert || '');
      });
    });

    $('qq-simulator-image-files').addEventListener('change', event => {
      void addImageFiles(event.target.files).finally(() => {
        event.target.value = '';
      });
    });
    $('qq-simulator-composer-image-btn').addEventListener('click', () => {
      $('qq-simulator-image-files').click();
    });
    $('qq-simulator-capture-btn').addEventListener('click', () => {
      void captureScreenshot();
    });
    $('qq-simulator-composer-capture-btn').addEventListener('click', () => {
      void captureScreenshot();
    });
    $('qq-simulator-clear-images-btn').addEventListener('click', () => {
      state.screenshots = [];
      renderAttachmentPreview();
      updateStatus('已清除本地图片。');
    });
    $('qq-simulator-voice-file').addEventListener('change', event => {
      const file = event.target.files?.[0] || null;
      void addVoiceFile(file).finally(() => {
        event.target.value = '';
      });
    });
    $('qq-simulator-composer-voice-btn').addEventListener('click', () => {
      $('qq-simulator-voice-file').click();
    });
    $('qq-simulator-clear-voice-btn').addEventListener('click', () => {
      state.voice = null;
      $('qq-simulator-voice-transcript').value = '';
      renderAttachmentPreview();
      updateStatus('已清除语音。');
    });

    document.addEventListener('paste', event => {
      const files = Array.from(event.clipboardData?.items || [])
        .filter(item => item.kind === 'file' && /^image\//i.test(item.type || ''))
        .map(item => item.getAsFile())
        .filter(Boolean);
      if (files.length > 0) {
        event.preventDefault();
        void addImageFiles(files);
      }
    });

    $('qq-simulator-history-sample-btn').addEventListener('click', () => {
      $('qq-simulator-group-history').value = [
        '花花|20001|text|刚才有人问今天群里聊了什么',
        'Lee|20002|text|我想测试 #群总结 能不能拿到上下文',
        '测试用户|20003|image|https://example.com/group-screenshot.jpg',
        '花花|20001|reply|900002',
      ].join('\n');
      updateSummary();
      updateStatus('已填入群历史上下文示例。');
    });
    $('qq-simulator-history-clear-btn').addEventListener('click', () => {
      $('qq-simulator-group-history').value = '';
      updateSummary();
      updateStatus('已清空群历史上下文。');
    });

    $('qq-simulator-send-message-btn').addEventListener('click', () => sendEvent('message'));
    $('qq-simulator-chat-send-btn').addEventListener('click', () => sendEvent('message'));
    $('qq-simulator-chat-poke-btn').addEventListener('click', () => sendEvent('poke'));
    $('qq-simulator-join-request-btn').addEventListener('click', () => sendEvent('join_request'));
    $('qq-simulator-group-increase-btn').addEventListener('click', () => sendEvent('group_increase'));
    $('qq-simulator-poke-btn').addEventListener('click', () => sendEvent('poke'));
    $('qq-simulator-cancel-btn').addEventListener('click', () => cancelActiveRequest());
    $('qq-simulator-chat-cancel-btn').addEventListener('click', () => cancelActiveRequest());
    $('qq-simulator-clear-btn').addEventListener('click', clearAll);
    $('qq-simulator-clear-top-btn').addEventListener('click', clearAll);
    $('qq-simulator-copy-report-btn').addEventListener('click', () => {
      void copyBatchReport();
    });
    $('qq-simulator-export-report-md-btn').addEventListener('click', exportBatchReportMarkdown);
    $('qq-simulator-report-filter').addEventListener('change', event => {
      state.batchReportFilter = normalizeBatchReportFilter(event.target.value);
      renderBatchReport();
    });
    $('qq-simulator-clear-report-btn').addEventListener('click', safeClearBatchReport);
    $('qq-simulator-save-scenario-btn').addEventListener('click', () => {
      void saveCurrentScenario();
    });
    $('qq-simulator-scenario-search').addEventListener('input', event => {
      state.scenarioSearch = String(event.target.value || '').trim();
      renderScenarios();
    });
    $('qq-simulator-scenario-filter').addEventListener('change', event => {
      state.scenarioFilter = String(event.target.value || 'all');
      renderScenarios();
    });
    $('qq-simulator-export-scenarios-btn').addEventListener('click', exportScenarios);
    $('qq-simulator-import-scenarios-btn').addEventListener('click', () => {
      $('qq-simulator-import-scenarios-file').click();
    });
    $('qq-simulator-import-scenarios-file').addEventListener('change', event => {
      const file = event.target.files?.[0] || null;
      void importScenariosFromFile(file).finally(() => {
        event.target.value = '';
      });
    });
    $('qq-simulator-run-all-scenarios-btn').addEventListener('click', () => {
      void replayScenarios(state.scenarios.filter(isScenarioMatched));
    });
    $('qq-simulator-scenario-backups-btn').addEventListener('click', () => {
      void openScenarioBackupsModal();
    });
    $('qq-simulator-clear-scenarios-btn').addEventListener('click', () => {
      void clearScenarios();
    });
    $('qq-simulator-scenario-list').addEventListener('click', handleScenarioAction);
    $('qq-simulator-batch-report').addEventListener('click', handleBatchReportAction);
    document.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.id === 'qq-simulator-modal-mask') {
        closeQqSimulatorModal({ confirmed: false });
        return;
      }
      const modalAction = event.target.closest('[data-qq-modal-action]')?.dataset.qqModalAction || '';
      if (modalAction === 'cancel') {
        closeQqSimulatorModal({ confirmed: false });
        return;
      }
      if (modalAction === 'confirm') {
        closeQqSimulatorModal({ confirmed: true });
        return;
      }
      const backupItem = event.target.closest('.qq-simulator-backup-item');
      if (backupItem) {
        backupItem.parentElement?.querySelectorAll('.qq-simulator-backup-item.is-selected')
          .forEach(item => item.classList.remove('is-selected'));
        backupItem.classList.add('is-selected');
      }
    });
    document.addEventListener('keydown', (event) => {
      const modalVisible = !$('qq-simulator-modal-mask')?.classList.contains('hidden');
      if (!modalVisible) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeQqSimulatorModal({ confirmed: false });
      }
      if (event.key === 'Enter') {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('#qq-simulator-modal-extra')) return;
        if (target && target.matches('button') && target.dataset.qqModalAction !== 'confirm') return;
        event.preventDefault();
        closeQqSimulatorModal({ confirmed: true });
      }
    });
  }
    return {
      bindEvents,
      getStartupPayloadFromUrl,
      getStartupScenarioIdFromUrl,
      loadStartupScenarioFromUrl,
    };
  }

  window.CrystelfQqSimulatorEvents = {
    createEventHandlers,
  };
})();
