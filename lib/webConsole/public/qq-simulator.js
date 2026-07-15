(function () {
  const {
    API_ENDPOINT,
    PREVIEW_ENDPOINT,
    SCENARIO_ENDPOINT,
    MAX_IMAGE_ATTACHMENTS,
    MAX_IMAGE_BYTES,
    MAX_VOICE_BYTES,
    MAX_HISTORY_ITEMS,
    MAX_GROUP_HISTORY_ITEMS,
    MAX_SCENARIOS,
    REQUEST_TIMEOUT_MS,
    CONTROL_REQUEST_TIMEOUT_MS,
    PREVIEW_DEBOUNCE_MS,
    SCENARIO_STORAGE_KEY,
    SCENARIO_SERVER_SEEN_KEY,
    SEND_BUTTON_IDS,
    CANCEL_BUTTON_IDS,
    REQUIRED_ELEMENT_IDS,
    EVENT_LABELS,
    ADAPTER_LABELS,
    presets,
  } = window.CrystelfQqSimulatorConfig;

  const {
    state,
    $,
    buildRequestHeaders,
    requestJson,
    renderStartupDiagnostics,
    checkStartupElements,
    nowText,
    toArray,
    isPlainObject,
    stringifyItem,
    formatBytes,
    estimateDataUrlSize,
    encodeCqValue,
    fileToDataUrl,
    fileToText,
    parseImages,
    normalizeGroupHistoryType,
    normalizeGroupHistoryItems,
    parseGroupHistoryInput,
    stringifyGroupHistory,
    readOptionalInteger,
    setOptionalInteger,
    getApplicantPayload,
    setApplicantPayload,
    buildHistory,
    getVoicePayload,
    getPayload,
  } = window.CrystelfQqSimulatorRuntime;

  const {
    normalizeMessageSegments,
    buildAdapterMessagePreview,
  } = window.CrystelfQqSimulatorSegments;

  let mediaHandlers = null;

  function clearAttachments() {
    mediaHandlers.clearAttachments();
  }

  function clearMessageComposerAfterSend(payload = {}) {
    if (payload.eventType !== 'message' && payload.eventType !== 'private_message') return;
    $('qq-simulator-message-text').value = '';
    $('qq-simulator-chat-input').value = '';
    if (toArray(payload.screenshots).length > 0 || payload.voice) {
      clearAttachments();
    }
    updateSummary();
    $('qq-simulator-chat-input')?.focus();
  }

  function setPayload(payload) {
    $('qq-simulator-event-type').value = payload.eventType || 'message';
    $('qq-simulator-group-id').value = payload.groupId || '';
    $('qq-simulator-user-id').value = payload.userId || '';
    $('qq-simulator-nickname').value = payload.nickname || '';
    $('qq-simulator-role').value = payload.role || 'member';
    $('qq-simulator-bot-role').value = ['owner', 'admin', 'member'].includes(payload.botRole) ? payload.botRole : 'member';
    $('qq-simulator-adapter-format').value = normalizeAdapterFormat(payload.adapterFormat);
    $('qq-simulator-is-master').value = payload.isMaster === true ? 'true' : 'false';
    $('qq-simulator-include-at').value = payload.includeAt !== false ? 'true' : 'false';
    $('qq-simulator-dispatch-mode').value = ['replay', 'live-image'].includes(payload.dispatchMode) ? payload.dispatchMode : 'safe';
    $('qq-simulator-conversation-mode').value = payload.conversationMode === false ? 'false' : 'true';
    $('qq-simulator-message-text').value = payload.messageText || '';
    $('qq-simulator-chat-input').value = payload.messageText || '';
    $('qq-simulator-images').value = toArray(payload.images).join('\n');
    $('qq-simulator-group-history').value = stringifyGroupHistory(payload.groupHistory || []);
    setApplicantPayload(payload.applicant || {});
    $('qq-simulator-comment').value = payload.comment || '';
    clearAttachments();
    $('qq-simulator-voice-transcript').value = String(payload.voiceTranscript || payload.voice?.transcript || '').trim();
    updateSummary();
  }

  function updateStatus(text, tone) {
    const status = $('qq-simulator-status');
    status.textContent = text;
    status.classList.toggle('tone-error', tone === 'error');
    status.classList.toggle('tone-success', tone === 'success');
  }

  function closeQqSimulatorModal(result = { confirmed: false, value: '' }) {
    const mask = $('qq-simulator-modal-mask');
    if (mask) mask.classList.add('hidden');
    const extra = $('qq-simulator-modal-extra');
    if (extra) extra.replaceChildren();
    const resolve = state.modalResolve;
    state.modalResolve = null;
    if (resolve) resolve(result);
  }

  function openQqSimulatorModal(options = {}) {
    const mask = $('qq-simulator-modal-mask');
    const title = $('qq-simulator-modal-title');
    const content = $('qq-simulator-modal-content');
    const extra = $('qq-simulator-modal-extra');
    if (!mask || !title || !content || !extra) {
      return webConsoleConfirm(String(options.message || options.title || '确认操作？')).then(confirmed => ({ confirmed }));
    }
    if (state.modalResolve) {
      closeQqSimulatorModal({ confirmed: false, value: '' });
    }
    title.textContent = options.title || '确认操作';
    content.textContent = options.message || '';
    extra.replaceChildren();
    if (options.extra instanceof Node) {
      extra.appendChild(options.extra);
    }
    mask.classList.remove('hidden');
    return new Promise(resolve => {
      state.modalResolve = resolve;
    });
  }

  async function confirmQqSimulatorModal(message = '', options = {}) {
    const result = await openQqSimulatorModal({
      title: options.title || '确认操作',
      message,
      extra: options.extra,
    });
    return result.confirmed === true;
  }

  function setButtonState(ids = [], disabled = false) {
    ids.forEach(id => {
      const button = $(id);
      if (button) {
        button.disabled = disabled;
      }
    });
  }

  function updateControlState() {
    const busy = state.isSending || state.isBatchReplaying;
    const scenarioBusy = busy || state.scenarioBusy;
    document.body?.classList.toggle('qq-simulator-is-sending', busy);
    setButtonState(SEND_BUTTON_IDS, busy);
    setButtonState(CANCEL_BUTTON_IDS, !busy);
    document.querySelectorAll('[data-scenario-action]').forEach(button => {
      button.disabled = scenarioBusy;
    });
    setButtonState([
      'qq-simulator-save-scenario-btn',
      'qq-simulator-export-scenarios-btn',
      'qq-simulator-import-scenarios-btn',
      'qq-simulator-scenario-backups-btn',
      'qq-simulator-clear-scenarios-btn',
    ], scenarioBusy);
    const sendButton = $('qq-simulator-chat-send-btn');
    if (sendButton) {
      sendButton.textContent = state.isSending ? '发送中' : state.isBatchReplaying ? '回放中' : '发送';
    }
    const runAllButton = $('qq-simulator-run-all-scenarios-btn');
    if (runAllButton) {
      runAllButton.textContent = state.isBatchReplaying ? '回放中' : '批量回放';
    }
  }

  function setSendingState(isSending) {
    state.isSending = isSending;
    updateControlState();
  }

  function clearRequestTimer() {
    if (state.requestTimeoutId) {
      window.clearTimeout(state.requestTimeoutId);
      state.requestTimeoutId = null;
    }
  }

  function cancelActiveRequest(reason = '用户取消了模拟请求') {
    if (state.isBatchReplaying) {
      state.stopBatchReplay = true;
    }
    if (!state.isSending || !state.requestController) {
      if (state.isBatchReplaying) {
        updateStatus('已请求停止批量回放。', 'error');
        updateControlState();
        return;
      }
      updateStatus('当前没有正在发送的模拟请求。');
      return;
    }
    state.abortReason = reason;
    state.requestController.abort();
    updateStatus(`${reason}。`, 'error');
  }

  function getRoleLabel(role = 'member', isMaster = false) {
    if (isMaster) return '主人';
    if (role === 'owner') return '群主';
    if (role === 'admin') return '管理员';
    return '成员';
  }

  function getBotRoleLabel(role = 'member') {
    if (role === 'owner') return '机器人群主';
    if (role === 'admin') return '机器人管理员';
    return '机器人成员';
  }

  function normalizeAdapterFormat(value = '') {
    const adapter = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(ADAPTER_LABELS, adapter) ? adapter : 'onebot';
  }

  function getAdapterLabel(value = '') {
    return ADAPTER_LABELS[normalizeAdapterFormat(value)] || ADAPTER_LABELS.onebot;
  }

  function getAvatarText(value = '') {
    const text = String(value || '').trim();
    if (!text) return '群';
    const chars = Array.from(text.replace(/^Bot\s*/i, '').trim());
    return chars.slice(0, 2).join('') || '群';
  }

  function createMemberNode(name, role, tone) {
    const row = document.createElement('div');
    row.className = 'qq-simulator-member-row';
    const avatar = document.createElement('div');
    avatar.className = `qq-simulator-member-avatar ${tone || ''}`.trim();
    avatar.textContent = getAvatarText(name);
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = name;
    const meta = document.createElement('span');
    meta.textContent = role;
    info.append(title, meta);
    row.append(avatar, info);
    return row;
  }

  function updateChatChrome(payload = getPayload()) {
    const title = $('qq-simulator-chat-title');
    const meta = $('qq-simulator-chat-meta');
    const currentUser = $('qq-simulator-current-user');
    const currentRole = $('qq-simulator-current-role');
    const memberList = $('qq-simulator-member-list');
    const sessionTitle = $('qq-simulator-session-title');
    const sessionPreview = $('qq-simulator-session-preview');
    const dockGroupName = $('qq-simulator-dock-group-name');
    const dockGroupMeta = $('qq-simulator-dock-group-meta');
    const clientStatus = $('qq-simulator-client-status');
    if (!title || !meta || !currentUser || !currentRole || !memberList) return;

    const eventLabel = EVENT_LABELS[payload.eventType] || payload.eventType || '消息';
    const roleLabel = getRoleLabel(payload.role, payload.isMaster);
    const botRoleLabel = getBotRoleLabel(payload.botRole);
    const historyCount = toArray(payload.history).length;
    const isPrivateMessage = payload.eventType === 'private_message';
    const groupName = isPrivateMessage ? `与 ${payload.nickname || '私聊用户'} 私聊` : `群 ${payload.groupId || '未填写群号'}`;
    const metaText = [
      `模拟 ${eventLabel}`,
      payload.conversationMode ? `连续对话 ${historyCount} 条历史` : '单次事件',
      isPrivateMessage ? '私聊直达' : (payload.includeAt ? '@机器人' : '未 @机器人'),
      payload.dispatchMode === 'live-image' ? '真实生图' : (payload.dispatchMode === 'replay' ? '链路回放' : '安全模拟'),
      getAdapterLabel(payload.adapterFormat),
    ].join(' · ');
    title.textContent = groupName;
    meta.textContent = metaText;
    currentUser.textContent = payload.nickname || '未填写用户';
    currentRole.textContent = roleLabel;
    if (sessionTitle) sessionTitle.textContent = groupName;
    if (sessionPreview) {
      sessionPreview.textContent = payload.messageText || payload.comment || `${eventLabel}模拟`;
    }
    if (dockGroupName) dockGroupName.textContent = groupName;
    if (dockGroupMeta) dockGroupMeta.textContent = metaText;
    if (clientStatus) clientStatus.textContent = `${payload.nickname || '测试用户'} · ${roleLabel} · ${botRoleLabel}`;
    document.querySelectorAll('.qq-simulator-session-item[data-sim-event]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.simEvent === payload.eventType);
    });
    memberList.replaceChildren(
      createMemberNode('机器人', '模拟接收者', 'bot'),
      createMemberNode(payload.nickname || '测试用户', `${roleLabel} · ${payload.userId || '未填写 QQ'}`, 'user'),
      isPrivateMessage
        ? createMemberNode('私聊会话', '不携带群上下文', 'group')
        : createMemberNode(`群 ${payload.groupId || '10001'}`, '当前模拟群', 'group'),
    );
  }

  function updateSummary(payload = getPayload()) {
    const imageCount = toArray(payload.images).length + toArray(payload.screenshots).length;
    const voice = payload.voice || null;
    const lines = [
      `事件: ${payload.eventType} (${EVENT_LABELS[payload.eventType] || '未知'})`,
      payload.eventType === 'private_message' ? '会话: 私聊，不使用群号' : `群: ${payload.groupId || '未填写'}`,
      `用户: ${payload.nickname || '未填写'} (${payload.userId || '未填写'})`,
      `角色: ${payload.role}${payload.isMaster ? ' / 主人' : ''}`,
      `机器人身份: ${payload.botRole || 'member'} (${getBotRoleLabel(payload.botRole)})`,
      `适配器格式: ${getAdapterLabel(payload.adapterFormat)} (${normalizeAdapterFormat(payload.adapterFormat)})`,
      `模拟模式: ${payload.dispatchMode === 'live-image' ? '真实生图' : (payload.dispatchMode === 'replay' ? '链路回放' : '安全模拟')}`,
      `@机器人: ${payload.eventType === 'private_message' ? '私聊无需 @' : (payload.includeAt ? '是' : '否')}`,
      `连续对话: ${payload.conversationMode ? `开，历史 ${toArray(payload.history).length} 条` : '关'}`,
      `群历史上下文: ${toArray(payload.groupHistory).length} 条`,
      `图片/截图: ${imageCount}`,
      `语音: ${voice ? `${voice.name || '语音'}${voice.transcript ? ' / 有转写' : ''}` : '无'}`,
      `申请资料: QQ等级 ${payload.applicant?.qqLevel ?? '未知'} / 年龄 ${payload.applicant?.age ?? '未知'} / 名单 ${payload.applicant?.listStatus || 'normal'}`,
      `备注: ${payload.comment || '无'}`,
    ];
    $('qq-simulator-summary').textContent = lines.join('\n');
    renderMessageSegmentPreview(payload);
    updateChatChrome(payload);
  }

  mediaHandlers = window.CrystelfQqSimulatorMedia.createMediaHandlers({
    state,
    $,
    MAX_IMAGE_ATTACHMENTS,
    MAX_IMAGE_BYTES,
    MAX_VOICE_BYTES,
    formatBytes,
    estimateDataUrlSize,
    fileToDataUrl,
    updateStatus,
    updateSummary,
  });

  function validatePayload(payload) {
    const errors = [];
    const imageCount = toArray(payload.images).length + toArray(payload.screenshots).length;
    const hasVoice = Boolean(payload.voice);
    if (!['message', 'private_message', 'join_request', 'group_increase', 'poke'].includes(payload.eventType)) {
      errors.push('事件类型不正确');
    }
    if (payload.eventType !== 'private_message' && !payload.groupId) {
      errors.push('群号不能为空');
    }
    if (!payload.userId) {
      errors.push('用户 QQ 不能为空');
    }
    if (!payload.nickname) {
      errors.push('用户昵称不能为空');
    }
    if ((payload.eventType === 'message' || payload.eventType === 'private_message') && !payload.messageText && imageCount === 0 && !hasVoice) {
      errors.push('发送消息时正文、图片或语音至少填写一项');
    }
    return errors;
  }

  function clipText(value = '', maxLength = 80) {
    const chars = Array.from(String(value || '').replace(/\s+/g, ' ').trim());
    return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}...` : chars.join('');
  }

  const scenarioHandlers = window.CrystelfQqSimulatorScenarios.createScenarioHandlers({
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
    sendEvent: (...args) => sendEvent(...args),
    clipText,
  });

  const {
    createScenarioId,
    normalizeScenarioPayload,
    readStoredScenarios,
    writeStoredScenarios,
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
    clearScenarios,
    importScenariosFromFile,
    openScenarioBackupsModal,
    replayScenarios,
    handleScenarioAction,
    handleBatchReportAction,
    isScenarioMatched,
    loadServerScenarios,
  } = scenarioHandlers;

  function describeImageForText(image = {}) {
    const label = image.label || image.name || image.url || '图片';
    const size = image.sizeBytes ? ` ${formatBytes(image.sizeBytes)}` : '';
    return `${label}${size}`;
  }

  function describeVoiceForText(voice = {}) {
    if (!voice) return '';
    const size = voice.sizeBytes ? ` ${formatBytes(voice.sizeBytes)}` : '';
    const transcript = voice.transcript ? `\n语音转写: ${voice.transcript}` : '';
    return `语音: ${voice.name || 'voice-message'}${size}${transcript}`;
  }

  function buildUserFlowBody(payload) {
    if (payload.eventType === 'poke') {
      return `${payload.nickname || '用户'} 戳了机器人一下`;
    }

    const imageLines = [
      ...toArray(payload.images).map((url, index) => `图片URL ${index + 1}: ${url}`),
      ...toArray(payload.screenshots).map((item, index) => `本地截图 ${index + 1}: ${describeImageForText(item)}`),
    ];
    const groupHistoryCount = toArray(payload.groupHistory).length;
    return [
      payload.includeAt ? '@机器人' : '',
      payload.messageText || '',
      ...imageLines,
      describeVoiceForText(payload.voice),
      groupHistoryCount > 0 ? `群历史上下文: ${groupHistoryCount} 条` : '',
      payload.comment ? `备注: ${payload.comment}` : '',
    ].filter(Boolean).join('\n') || '(无文本内容)';
  }

  function getPayloadMedia(payload) {
    if (payload.eventType !== 'message' && payload.eventType !== 'private_message') {
      return { images: [], voice: null };
    }
    const images = [
      ...toArray(payload.images).map((url, index) => ({ url, label: `图片 URL ${index + 1}` })),
      ...toArray(payload.screenshots).map((item, index) => ({
        url: item.dataUrl,
        label: item.name || `本地截图 ${index + 1}`,
        sizeBytes: item.sizeBytes,
      })),
    ];
    return {
      images,
      voice: payload.voice,
    };
  }

  function appendMediaNodes(bubble, media = {}) {
    const images = toArray(media.images).filter(item => item?.url);
    const voice = media.voice || null;
    if (images.length === 0 && !voice) return;

    const wrap = document.createElement('div');
    wrap.className = 'sandbox-media-item qq-simulator-bubble-media';

    images.forEach(image => {
      const block = document.createElement('div');
      block.className = 'qq-simulator-media-card';
      const img = document.createElement('img');
      img.className = 'sandbox-media-image';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = image.url;
      img.alt = image.label || '图片';
      const caption = document.createElement('div');
      caption.className = 'sandbox-media-url';
      caption.textContent = describeImageForText(image);
      block.append(img, caption);
      wrap.appendChild(block);
    });

    if (voice) {
      const block = document.createElement('div');
      block.className = 'qq-simulator-media-card';
      const source = voice.dataUrl || voice.audioUrl || voice.url || '';
      if (source) {
        const audio = document.createElement('audio');
        audio.className = 'sandbox-media-audio';
        audio.controls = true;
        audio.src = source;
        block.appendChild(audio);
      }
      const caption = document.createElement('div');
      caption.className = 'sandbox-media-url';
      caption.textContent = describeVoiceForText(voice) || '语音消息';
      block.appendChild(caption);
      wrap.appendChild(block);
    }

    bubble.appendChild(wrap);
  }

  function buildServerEventPreview(data = {}) {
    return {
      adapterFormat: data.preview?.adapterFormat || data.event?.adapterFormat || 'onebot',
      eventType: data.preview?.eventType || data.event?.eventType || '',
      messageShape: data.preview?.messageShape || '',
      messageCount: data.preview?.messageCount || 0,
      groupHistoryCount: data.preview?.groupHistoryCount || 0,
      adapterEventKeys: data.preview?.adapterEventKeys || Object.keys(data.event || {}),
      event: data.event || {},
      groupHistoryDebug: data.debug?.groupHistory || null,
    };
  }

  function renderSegmentPreviewPayload(preview = {}, metaText = '') {
    const previewBox = $('qq-simulator-segment-preview');
    const meta = $('qq-simulator-segment-preview-meta');
    if (!previewBox) return;
    if (meta) meta.textContent = metaText || '跟随当前适配器';
    previewBox.textContent = JSON.stringify(preview, null, 2);
  }

  function isAuthStatusPending() {
    return Boolean(window.CrystelfAuth && !window.CrystelfAuth.status);
  }

  function isBackendPreviewAllowed() {
    if (!window.CrystelfAuth) return true;
    return window.CrystelfAuth.status?.authorized === true;
  }

  async function refreshServerEventPreview(payload = {}, seq = 0) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (state.previewController) {
      state.previewController.abort();
    }
    state.previewController = controller;
    try {
      const response = await fetch(PREVIEW_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildRequestHeaders({ 'Content-Type': 'application/json' }),
        signal: controller?.signal,
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { success: false, error: `接口返回内容格式不正确，HTTP ${response.status}` };
      }
      if (seq !== state.previewSeq) return;
      if (!response.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      const preview = buildServerEventPreview(data);
      renderSegmentPreviewPayload(
        preview,
        `${getAdapterLabel(preview.adapterFormat)} · 后端事件 · ${preview.messageCount || 0} 段`
      );
    } catch (error) {
      if (error?.name === 'AbortError' || seq !== state.previewSeq) return;
      const fallback = buildAdapterMessagePreview(payload);
      fallback.preview_error = error?.message || String(error);
      renderSegmentPreviewPayload(
        fallback,
        `${getAdapterLabel(payload.adapterFormat)} · 本地预览 · 后端失败`
      );
    } finally {
      if (state.previewController === controller) {
        state.previewController = null;
      }
    }
  }

  function renderMessageSegmentPreview(payload = {}) {
    const localPreview = buildAdapterMessagePreview(payload);
    const localMessageCount = Array.isArray(localPreview.event?.message) ? localPreview.event.message.length : 0;
    renderSegmentPreviewPayload(
      localPreview,
      ['message', 'private_message'].includes(payload.eventType)
        ? `${getAdapterLabel(payload.adapterFormat)} · 本地预览 · ${localMessageCount} 段`
        : `${EVENT_LABELS[payload.eventType] || payload.eventType} · 本地预览`
    );

    state.previewSeq += 1;
    const seq = state.previewSeq;
    if (state.previewTimerId) {
      window.clearTimeout(state.previewTimerId);
      state.previewTimerId = null;
    }
    if (state.previewController) {
      state.previewController.abort();
      state.previewController = null;
    }
    if (isAuthStatusPending()) {
      state.previewTimerId = window.setTimeout(() => {
        if (seq !== state.previewSeq) return;
        if (isBackendPreviewAllowed()) {
          void refreshServerEventPreview(payload, seq);
        }
      }, Math.max(PREVIEW_DEBOUNCE_MS, 900));
      return;
    }
    if (!isBackendPreviewAllowed()) return;
    state.previewTimerId = window.setTimeout(() => {
      void refreshServerEventPreview(payload, seq);
    }, PREVIEW_DEBOUNCE_MS);
  }

  function segmentToPlainText(segment = {}) {
    if (segment.type === 'text') return String(segment.text || '');
    if (segment.type === 'at') return `@${segment.qq || 'unknown'}`;
    if (segment.type === 'image') return `[图片:${formatSegmentMediaLabel(segment.label, segment.url, 'image')}]`;
    if (segment.type === 'record') return `[语音:${formatSegmentMediaLabel(segment.label, segment.url, 'record')}]`;
    if (segment.type === 'reply') return `[回复:${segment.id || 'unknown'}]`;
    if (segment.type === 'poke') return `[戳一戳:${segment.qq || segment.id || 'unknown'}]`;
    if (segment.type === 'memory') return `[记忆:${segment.data || 'memory'}]`;
    if (segment.type === 'meme') return `[meme:${segment.character || '未知'}:${segment.emotion || 'default'}]`;
    if (segment.type === 'face') return `[表情:${segment.text || 'face'}]`;
    if (segment.type === 'cq') return `[CQ:${segment.cqType || 'unknown'}]`;
    return stringifyItem(segment);
  }

  function segmentsToPlainText(segments = []) {
    return toArray(segments).map(segmentToPlainText).join('').trim();
  }

  function normalizeRenderableMediaSource(value = '', mediaType = 'image') {
    const text = String(value || '').trim();
    if (/^base64:\/\//i.test(text)) {
      const data = text.replace(/^base64:\/\//i, '');
      return mediaType === 'audio'
        ? `data:audio/wav;base64,${data}`
        : `data:image/jpeg;base64,${data}`;
    }
    return text;
  }

  function isRenderableMediaSource(value = '', mediaType = 'image') {
    const text = normalizeRenderableMediaSource(value, mediaType);
    if (!text) return false;
    if (mediaType === 'image') {
      return /^(https?:\/\/|blob:)/i.test(text)
        || /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(text);
    }
    return /^(https?:\/\/|blob:)/i.test(text)
      || /^data:audio\/(?:wav|mpeg|ogg|webm|mp4|aac);base64,/i.test(text);
  }

  function formatSegmentMediaLabel(label = '', source = '', fallback = '媒体消息') {
    const text = String(label || source || fallback).trim();
    if (!text || /^data:/i.test(text) || /^base64:\/\//i.test(text)) {
      return fallback;
    }
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
  }

  function appendMessageSegment(container, segment = {}) {
    if (segment.type === 'text') {
      const node = document.createElement('span');
      node.textContent = segment.text || '';
      container.appendChild(node);
      return;
    }
    if (segment.type === 'at') {
      const node = document.createElement('span');
      node.className = 'qq-simulator-inline-token';
      node.textContent = `@${segment.qq || 'unknown'}`;
      container.appendChild(node);
      return;
    }
    if (segment.type === 'meme' || segment.type === 'face') {
      const node = document.createElement('span');
      node.className = 'qq-simulator-inline-token';
      node.textContent = segment.type === 'meme'
        ? `[meme:${segment.character || '未知'}:${segment.emotion || 'default'}]`
        : `[表情:${segment.text || 'face'}]`;
      container.appendChild(node);
      return;
    }
    if (segment.type === 'reply') {
      const node = document.createElement('span');
      node.className = 'qq-simulator-inline-token';
      node.textContent = `[回复:${segment.id || 'unknown'}]`;
      container.appendChild(node);
      return;
    }
    if (segment.type === 'poke' || segment.type === 'memory') {
      const node = document.createElement('span');
      node.className = 'qq-simulator-inline-token';
      node.textContent = segment.type === 'poke'
        ? `[戳一戳:${segment.qq || segment.id || 'unknown'}]`
        : `[记忆:${segment.data || 'memory'}]`;
      container.appendChild(node);
      return;
    }
    if (segment.type === 'image') {
      const block = document.createElement('div');
      block.className = 'qq-simulator-media-card qq-simulator-segment-card';
      const source = normalizeRenderableMediaSource(segment.url || '', 'image');
      if (isRenderableMediaSource(source, 'image')) {
        const img = document.createElement('img');
        img.className = 'sandbox-media-image';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.src = source;
        img.alt = segment.label || '图片';
        block.appendChild(img);
      }
      const caption = document.createElement('div');
      caption.className = 'sandbox-media-url';
      caption.textContent = formatSegmentMediaLabel(segment.label, segment.url, '图片消息');
      block.appendChild(caption);
      container.appendChild(block);
      return;
    }
    if (segment.type === 'record') {
      const block = document.createElement('div');
      block.className = 'qq-simulator-media-card qq-simulator-segment-card';
      const source = normalizeRenderableMediaSource(segment.url || '', 'audio');
      if (isRenderableMediaSource(source, 'audio')) {
        const audio = document.createElement('audio');
        audio.className = 'sandbox-media-audio';
        audio.controls = true;
        audio.src = source;
        block.appendChild(audio);
      }
      const caption = document.createElement('div');
      caption.className = 'sandbox-media-url';
      caption.textContent = formatSegmentMediaLabel(segment.label, segment.url, '语音消息');
      block.appendChild(caption);
      container.appendChild(block);
      return;
    }
    const fallback = document.createElement('span');
    fallback.textContent = segmentToPlainText(segment);
    container.appendChild(fallback);
  }

  function appendMessageSegments(container, segments = []) {
    const normalized = toArray(segments);
    if (normalized.length === 0) {
      container.textContent = '';
      return;
    }
    normalized.forEach(segment => appendMessageSegment(container, segment));
  }

  function createBubble(entry) {
    const row = document.createElement('div');
    row.className = `sandbox-bubble-row ${entry.side || 'assistant'}`;

    const avatar = document.createElement('div');
    avatar.className = `qq-simulator-message-avatar ${entry.side || 'assistant'}`;
    avatar.textContent = getAvatarText(entry.side === 'user' ? $('qq-simulator-nickname').value : '机器人');

    const stack = document.createElement('div');
    stack.className = 'qq-simulator-message-stack';

    const title = document.createElement('div');
    title.className = 'sandbox-bubble-title';
    title.textContent = entry.title || '消息';

    const bubble = document.createElement('div');
    bubble.className = `sandbox-bubble ${entry.side || 'assistant'}`;

    const body = document.createElement('div');
    body.className = 'qq-simulator-message-body';
    appendMessageSegments(body, entry.segments || normalizeMessageSegments(entry.body || ''));

    const time = document.createElement('div');
    time.className = 'sandbox-bubble-time';
    time.textContent = entry.time || nowText();

    bubble.appendChild(body);
    appendMediaNodes(bubble, entry.media || {});
    stack.append(title, bubble, time);
    row.append(avatar, stack);
    return row;
  }

  function renderFlow() {
    const container = $('qq-simulator-flow');
    if (state.flow.length === 0) {
      container.textContent = '暂无消息';
      return;
    }
    container.replaceChildren(...state.flow.map(createBubble));
    container.scrollTop = container.scrollHeight;
  }

  function addFlow(entry) {
    state.flow.push({ time: nowText(), ...entry });
    renderFlow();
  }

  function renderList(id, items, emptyText) {
    const container = $(id);
    const normalized = toArray(items);
    if (normalized.length === 0) {
      container.textContent = emptyText;
      return;
    }
    const nodes = normalized.map((item, index) => {
      const node = document.createElement('div');
      node.className = 'list-item';
      const title = document.createElement('h3');
      title.textContent = `#${index + 1}`;
      const body = document.createElement('div');
      body.textContent = stringifyItem(item);
      node.append(title, body);
      return node;
    });
    container.replaceChildren(...nodes);
  }

  function renderTimeline(items = []) {
    const container = $('qq-simulator-timeline');
    const normalized = toArray(items);
    if (normalized.length === 0) {
      container.textContent = '暂无时间线';
      return;
    }
    const nodes = normalized.map((item, index) => {
      const node = document.createElement('div');
      node.className = `qq-simulator-timeline-item tone-${item.status || 'info'}`;
      const marker = document.createElement('div');
      marker.className = 'qq-simulator-timeline-marker';
      marker.textContent = String(item.index || index + 1);
      const body = document.createElement('div');
      body.className = 'qq-simulator-timeline-body';
      const title = document.createElement('strong');
      title.textContent = item.stage || `阶段 ${index + 1}`;
      const meta = document.createElement('small');
      meta.textContent = item.status || 'info';
      const detail = document.createElement('pre');
      const detailPayload = { ...item };
      delete detailPayload.index;
      delete detailPayload.stage;
      delete detailPayload.status;
      detail.textContent = Object.keys(detailPayload).length > 0 ? stringifyItem(detailPayload) : '';
      body.append(title, meta);
      if (detail.textContent) {
        body.appendChild(detail);
      }
      node.append(marker, body);
      return node;
    });
    container.replaceChildren(...nodes);
  }

  function normalizeVoiceMessageForMedia(message = {}) {
    if (!message) return null;
    if (typeof message === 'string') {
      return { name: 'voice-message', audioUrl: message };
    }
    return {
      name: message.name || message.file || message.model || 'voice-message',
      mimeType: message.mimeType || message.type || 'audio/*',
      sizeBytes: message.sizeBytes || message.size || 0,
      dataUrl: message.dataUrl || '',
      audioUrl: message.audioUrl || message.url || '',
      transcript: message.transcript || message.text || '',
    };
  }

  function renderResponse(response) {
    const replies = toArray(response?.replies);
    const actions = toArray(response?.actions);
    const logs = toArray(response?.logs);
    const errors = toArray(response?.errors);
    const timeline = toArray(response?.timeline);
    const voiceMessages = toArray(response?.voiceMessages);

    replies.forEach(reply => {
      const segments = normalizeMessageSegments(reply);
      addFlow({
        side: 'assistant',
        title: '机器人回复',
        body: segmentsToPlainText(segments) || stringifyItem(reply),
        segments,
      });
    });

    voiceMessages.forEach(message => {
      const voice = normalizeVoiceMessageForMedia(message);
      addFlow({
        side: 'assistant',
        title: '机器人语音',
        body: describeVoiceForText(voice) || stringifyItem(message),
        media: { voice },
      });
    });

    errors.forEach(error => {
      addFlow({
        side: 'assistant',
        title: '错误',
        body: stringifyItem(error),
      });
    });

    if (replies.length === 0 && voiceMessages.length === 0 && actions.length === 0 && errors.length === 0) {
      addFlow({
        side: 'assistant',
        title: '接口响应',
        body: response?.success ? '请求成功，但没有返回 replies/actions/errors。' : '请求失败，未返回具体错误。',
      });
    }

    $('qq-simulator-result').textContent = [
      `success: ${response?.success === true ? 'true' : 'false'}`,
      `adapter: ${response?.event?.adapterFormat || state.lastRequest?.adapterFormat || 'onebot'}`,
      `event: ${stringifyItem(response?.event || {})}`,
      `replies: ${replies.length}`,
      `voiceMessages: ${voiceMessages.length}`,
      `actions: ${actions.length}`,
      `timeline: ${timeline.length}`,
      `logs: ${logs.length}`,
      `errors: ${errors.length}`,
    ].join('\n');

    renderTimeline(timeline);
    renderList('qq-simulator-actions', actions, '暂无动作');
    renderList('qq-simulator-logs', logs, '暂无日志');
    renderList('qq-simulator-errors', errors, '暂无错误');
    $('qq-simulator-debug').textContent = stringifyItem({
      request: state.lastRequest,
      response,
      debug: response?.debug,
    });
  }

  function pushConversation(role, content) {
    const text = String(content || '').trim();
    if (!text) return;
    state.conversation.push({ role, content: text.slice(0, 4000) });
    state.conversation = state.conversation.slice(-MAX_HISTORY_ITEMS);
  }

  function buildConversationUserText(payload) {
    const parts = [
      payload.messageText,
      payload.voice?.transcript ? `语音转写：${payload.voice.transcript}` : '',
      payload.voice && !payload.voice?.transcript ? '[语音消息]' : '',
      toArray(payload.images).length || toArray(payload.screenshots).length
        ? `[图片/截图 ${toArray(payload.images).length + toArray(payload.screenshots).length} 张]`
        : '',
    ];
    return parts.filter(Boolean).join('\n');
  }

  function rememberConversation(payload, response) {
    if (!['message', 'private_message'].includes(payload.eventType) || payload.conversationMode !== true || response?.success !== true) {
      return;
    }
    pushConversation('user', buildConversationUserText(payload));
    const replies = toArray(response?.replies)
      .map(reply => segmentsToPlainText(normalizeMessageSegments(reply)) || stringifyItem(reply))
      .filter(Boolean);
    replies.forEach(reply => pushConversation('assistant', reply));
    const voiceMessages = toArray(response?.voiceMessages);
    if (voiceMessages.length > 0 && replies.length === 0) {
      pushConversation('assistant', `[语音回复 ${voiceMessages.length} 条]`);
    }
    updateSummary();
  }

  function redactPayloadForDebug(payload) {
    return {
      ...payload,
      screenshots: toArray(payload.screenshots).map(item => ({
        name: item.name,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        dataUrl: item.dataUrl ? `[image data-url ${formatBytes(item.sizeBytes || estimateDataUrlSize(item.dataUrl))}]` : '',
      })),
      voice: payload.voice ? {
        name: payload.voice.name,
        mimeType: payload.voice.mimeType,
        sizeBytes: payload.voice.sizeBytes,
        durationSeconds: payload.voice.durationSeconds,
        transcript: payload.voice.transcript,
        dataUrl: payload.voice.dataUrl ? `[audio data-url ${formatBytes(payload.voice.sizeBytes || estimateDataUrlSize(payload.voice.dataUrl))}]` : '',
      } : null,
    };
  }

  async function sendEvent(eventType, options = {}) {
    if (state.isSending || (state.isBatchReplaying && options.fromBatch !== true)) {
      updateStatus('已有模拟事件正在发送，可以先取消当前请求。', 'error');
      return;
    }
    const payload = getPayload(eventType);
    $('qq-simulator-event-type').value = payload.eventType;
    updateSummary(payload);

    const validationErrors = validatePayload(payload);
    if (validationErrors.length > 0) {
      state.lastResponse = { success: false, errors: validationErrors };
      updateStatus(validationErrors.join('；'), 'error');
      renderList('qq-simulator-errors', validationErrors, '暂无错误');
      return;
    }

    if (payload.dispatchMode === 'live-image') {
      if (options.fromBatch === true) {
        const data = {
          success: false,
          errors: ['批量回放不会执行真实生图，请单独打开场景并确认执行。'],
        };
        state.lastResponse = data;
        renderResponse(data);
        updateStatus(data.errors[0], 'error');
        return;
      }
      const command = String(payload.messageText || '').trim();
      const match = command.match(/^[#＃\/]?灵晶\s*(改图|融合)(?:[：:，,\s]+)?([\s\S]*)$/);
      const minimumImages = match?.[1] === '融合' ? 2 : 1;
      const imageCount = toArray(payload.images).length + toArray(payload.screenshots).length;
      if (!match) {
        updateStatus('真实生图模式只允许 #灵晶改图 或 #灵晶融合 命令。', 'error');
        return;
      }
      if (!String(match[2] || '').trim()) {
        updateStatus('请写明图片处理要求。', 'error');
        return;
      }
      if (imageCount < minimumImages) {
        updateStatus(match[1] === '融合' ? '真实融合至少需要两张图片。' : '真实改图需要一张参考图片。', 'error');
        return;
      }
      const confirmed = await confirmQqSimulatorModal(
        `即将真实调用当前图像接口执行${match[1]}，会消耗本地算力或接口额度，并固定生成 1 张图片。是否继续？`,
        { title: '确认真实生图' },
      );
      if (!confirmed) {
        updateStatus('已取消真实生图。');
        return;
      }
      payload.confirmLiveImage = true;
    }

    state.lastRequest = redactPayloadForDebug(payload);
    addFlow({
      side: 'user',
      title: `${payload.nickname} 触发${EVENT_LABELS[payload.eventType] || payload.eventType}`,
      body: buildUserFlowBody(payload),
      media: getPayloadMedia(payload),
    });

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.requestController = controller;
    state.abortReason = '';
    setSendingState(true);
    clearRequestTimer();
    if (controller) {
      state.requestTimeoutId = window.setTimeout(() => {
        state.abortReason = `请求超过 ${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒，已自动取消`;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
    }

    updateStatus(`正在发送模拟事件，最长等待 ${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒...`);
    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildRequestHeaders({ 'Content-Type': 'application/json' }),
        signal: controller?.signal,
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (error) {
        data = {
          success: false,
          errors: [`接口返回内容格式不正确，HTTP ${response.status}`],
          debug: text,
        };
      }
      if (!response.ok && data.success !== true) {
        data.success = false;
        data.errors = toArray(data.errors);
        data.errors.unshift(`HTTP ${response.status}`);
      }
      state.lastResponse = data;
      renderResponse(data);
      rememberConversation(payload, data);
      if (data.success === true && options.fromBatch !== true) {
        clearMessageComposerAfterSend(payload);
      }
      updateStatus(data.success ? '模拟事件已完成。' : '模拟事件返回失败。', data.success ? 'success' : 'error');
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      const data = {
        success: false,
        errors: [aborted ? (state.abortReason || '模拟请求已取消') : (error?.message || String(error))],
      };
      state.lastResponse = data;
      renderResponse(data);
      updateStatus(aborted ? data.errors[0] : '请求模拟接口失败。', 'error');
    } finally {
      clearRequestTimer();
      if (state.requestController === controller) {
        state.requestController = null;
      }
      state.abortReason = '';
      setSendingState(false);
    }
  }

  function renderAttachmentPreview() {
    mediaHandlers.renderAttachmentPreview();
  }

  async function addImageFiles(files) {
    return mediaHandlers.addImageFiles(files);
  }

  async function captureScreenshot() {
    return mediaHandlers.captureScreenshot();
  }

  async function addVoiceFile(file) {
    return mediaHandlers.addVoiceFile(file);
  }

  function clearAll() {
    if (state.isSending) {
      cancelActiveRequest('清空时取消了正在发送的模拟请求');
    }
    state.flow = [];
    state.conversation = [];
    state.lastRequest = null;
    state.lastResponse = null;
    state.batchReport = null;
    clearAttachments();
    $('qq-simulator-result').textContent = '等待模拟事件。';
    $('qq-simulator-debug').textContent = '尚无排查数据';
    renderTimeline([]);
    renderList('qq-simulator-actions', [], '暂无动作');
    renderList('qq-simulator-logs', [], '暂无日志');
    renderList('qq-simulator-errors', [], '暂无错误');
    renderBatchReport();
    renderFlow();
    updateSummary();
    updateStatus('已清空消息流、连续对话历史与排查结果。');
  }

  function syncChatInputFromMessage() {
    const chatInput = $('qq-simulator-chat-input');
    const messageInput = $('qq-simulator-message-text');
    if (document.activeElement === chatInput) return;
    chatInput.value = messageInput.value;
  }

  const eventHandlers = window.CrystelfQqSimulatorEvents.createEventHandlers({
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
    sendEvent: (...args) => sendEvent(...args),
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
  });

  const {
    bindEvents,
    getStartupPayloadFromUrl,
    loadStartupScenarioFromUrl,
  } = eventHandlers;

  document.addEventListener('DOMContentLoaded', async () => {
    if (!checkStartupElements()) return;
    state.scenarios = readStoredScenarios();
    bindEvents();
    setSendingState(false);
    const startupPayload = getStartupPayloadFromUrl();
    setPayload(startupPayload || presets.message);
    if (startupPayload) {
      updateStatus('已从链接预填模拟参数。', 'success');
    }
    await loadServerScenarios({ migrateLocal: true });
    loadStartupScenarioFromUrl();
    renderScenarios();
    renderBatchReport();
    renderAttachmentPreview();
    renderFlow();
  });
})();
