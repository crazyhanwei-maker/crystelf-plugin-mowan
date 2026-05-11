(function () {
  const API_ENDPOINT = '/api/qq-simulator/send';
  const PREVIEW_ENDPOINT = '/api/qq-simulator/preview';
  const SCENARIO_ENDPOINT = '/api/qq-simulator/scenarios';
  const MAX_IMAGE_ATTACHMENTS = 3;
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const MAX_VOICE_BYTES = 3 * 1024 * 1024;
  const MAX_HISTORY_ITEMS = 20;
  const MAX_GROUP_HISTORY_ITEMS = 30;
  const MAX_SCENARIOS = 80;
  const REQUEST_TIMEOUT_MS = 120000;
  const CONTROL_REQUEST_TIMEOUT_MS = 60000;
  const PREVIEW_DEBOUNCE_MS = 360;
  const SCENARIO_STORAGE_KEY = 'crystelf.qqSimulator.scenarios.v1';
  const SCENARIO_SERVER_SEEN_KEY = 'crystelf.qqSimulator.serverSeen.v1';
  const SEND_BUTTON_IDS = [
    'qq-simulator-send-message-btn',
    'qq-simulator-chat-send-btn',
    'qq-simulator-chat-poke-btn',
    'qq-simulator-join-request-btn',
    'qq-simulator-group-increase-btn',
    'qq-simulator-poke-btn',
    'qq-simulator-run-all-scenarios-btn',
  ];
  const CANCEL_BUTTON_IDS = [
    'qq-simulator-cancel-btn',
    'qq-simulator-chat-cancel-btn',
  ];
  const REQUIRED_ELEMENT_IDS = [
    'qq-simulator-actions',
    'qq-simulator-adapter-format',
    'qq-simulator-age',
    'qq-simulator-batch-report',
    'qq-simulator-bot-role',
    'qq-simulator-cancel-btn',
    'qq-simulator-capture-btn',
    'qq-simulator-chat-cancel-btn',
    'qq-simulator-chat-input',
    'qq-simulator-chat-meta',
    'qq-simulator-chat-poke-btn',
    'qq-simulator-chat-send-btn',
    'qq-simulator-chat-title',
    'qq-simulator-clear-btn',
    'qq-simulator-clear-images-btn',
    'qq-simulator-clear-report-btn',
    'qq-simulator-clear-scenarios-btn',
    'qq-simulator-clear-top-btn',
    'qq-simulator-clear-voice-btn',
    'qq-simulator-client-status',
    'qq-simulator-comment',
    'qq-simulator-composer-capture-btn',
    'qq-simulator-composer-image-btn',
    'qq-simulator-composer-voice-btn',
    'qq-simulator-conflict-strategy',
    'qq-simulator-conversation-mode',
    'qq-simulator-copy-report-btn',
    'qq-simulator-current-role',
    'qq-simulator-current-user',
    'qq-simulator-debug',
    'qq-simulator-dispatch-mode',
    'qq-simulator-dock-group-meta',
    'qq-simulator-dock-group-name',
    'qq-simulator-errors',
    'qq-simulator-event-type',
    'qq-simulator-export-report-md-btn',
    'qq-simulator-export-scenarios-btn',
    'qq-simulator-flow',
    'qq-simulator-group-history',
    'qq-simulator-group-id',
    'qq-simulator-group-increase-btn',
    'qq-simulator-history-clear-btn',
    'qq-simulator-history-sample-btn',
    'qq-simulator-image-files',
    'qq-simulator-image-preview',
    'qq-simulator-images',
    'qq-simulator-import-scenarios-btn',
    'qq-simulator-import-scenarios-file',
    'qq-simulator-include-at',
    'qq-simulator-is-master',
    'qq-simulator-join-request-btn',
    'qq-simulator-list-status',
    'qq-simulator-logs',
    'qq-simulator-member-list',
    'qq-simulator-message-text',
    'qq-simulator-modal-content',
    'qq-simulator-modal-extra',
    'qq-simulator-modal-mask',
    'qq-simulator-modal-title',
    'qq-simulator-nickname',
    'qq-simulator-poke-btn',
    'qq-simulator-qq-level',
    'qq-simulator-report-filter',
    'qq-simulator-result',
    'qq-simulator-role',
    'qq-simulator-run-all-scenarios-btn',
    'qq-simulator-save-scenario-btn',
    'qq-simulator-scenario-backups-btn',
    'qq-simulator-scenario-filter',
    'qq-simulator-scenario-list',
    'qq-simulator-scenario-name',
    'qq-simulator-scenario-search',
    'qq-simulator-segment-cq-code',
    'qq-simulator-segment-face-id',
    'qq-simulator-segment-media-url',
    'qq-simulator-segment-meme-character',
    'qq-simulator-segment-meme-emotion',
    'qq-simulator-segment-preview',
    'qq-simulator-segment-preview-meta',
    'qq-simulator-segment-reply-id',
    'qq-simulator-segment-user-id',
    'qq-simulator-send-message-btn',
    'qq-simulator-session-preview',
    'qq-simulator-session-title',
    'qq-simulator-sex',
    'qq-simulator-status',
    'qq-simulator-summary',
    'qq-simulator-timeline',
    'qq-simulator-user-id',
    'qq-simulator-voice-file',
    'qq-simulator-voice-preview',
    'qq-simulator-voice-transcript',
    'qq-simulator-warning-count',
  ];

  const EVENT_LABELS = {
    message: '消息',
    join_request: '加群申请',
    group_increase: '新成员入群',
    poke: '戳一戳',
  };

  const ADAPTER_LABELS = {
    onebot: 'OneBot',
    icqq: 'icqq',
    'go-cqhttp': 'go-cqhttp',
    napcat: 'NapCat',
  };

  const state = {
    flow: [],
    conversation: [],
    screenshots: [],
    voice: null,
    lastRequest: null,
    lastResponse: null,
    isSending: false,
    isBatchReplaying: false,
    stopBatchReplay: false,
    requestController: null,
    requestTimeoutId: null,
    abortReason: '',
    scenarios: [],
    batchReport: null,
    batchReportFilter: 'all',
    previewTimerId: null,
    previewController: null,
    previewSeq: 0,
    scenarioStorageMode: 'local',
    scenarioBusy: false,
    scenarioSearch: '',
    scenarioFilter: 'all',
    scenarioBackups: [],
    modalResolve: null,
  };

  const presets = {
    message: {
      eventType: 'message',
      groupId: '10001',
      userId: '20001',
      nickname: '测试用户',
      role: 'member',
      botRole: 'admin',
      adapterFormat: 'onebot',
      isMaster: false,
      includeAt: true,
      dispatchMode: 'safe',
      conversationMode: true,
      messageText: '你好，帮我测试一下当前回复链路。',
      images: [],
      groupHistory: [],
      applicant: {},
      comment: '普通群聊消息预设',
    },
    join_request: {
      eventType: 'join_request',
      groupId: '10001',
      userId: '30001',
      nickname: '申请入群的人',
      role: 'member',
      botRole: 'admin',
      adapterFormat: 'onebot',
      isMaster: false,
      includeAt: false,
      dispatchMode: 'safe',
      conversationMode: true,
      messageText: '',
      images: [],
      groupHistory: [],
      applicant: {
        qqLevel: 25,
        age: 18,
        sex: 'unknown',
        warningCount: 0,
        listStatus: 'normal',
      },
      comment: '想加入群聊一起交流',
    },
    group_increase: {
      eventType: 'group_increase',
      groupId: '10001',
      userId: '30002',
      nickname: '新成员',
      role: 'member',
      botRole: 'admin',
      adapterFormat: 'onebot',
      isMaster: false,
      includeAt: false,
      dispatchMode: 'safe',
      conversationMode: true,
      messageText: '',
      images: [],
      groupHistory: [],
      applicant: {},
      comment: '新成员已通过审核入群',
    },
    poke: {
      eventType: 'poke',
      groupId: '10001',
      userId: '20002',
      nickname: '戳戳用户',
      role: 'member',
      botRole: 'admin',
      adapterFormat: 'onebot',
      isMaster: false,
      includeAt: false,
      dispatchMode: 'safe',
      conversationMode: true,
      messageText: '',
      images: [],
      groupHistory: [],
      applicant: {},
      comment: '模拟用户戳了 Bot 一下',
    },
    master: {
      eventType: 'message',
      groupId: '10001',
      userId: '99999',
      nickname: '主人',
      role: 'owner',
      botRole: 'owner',
      adapterFormat: 'napcat',
      isMaster: true,
      includeAt: true,
      dispatchMode: 'replay',
      conversationMode: true,
      messageText: '测试主人权限消息。',
      images: [],
      groupHistory: [
        { nickname: '花花', userId: '20001', type: 'text', content: '刚才有人问群总结', messageId: 900001 },
        { nickname: '测试用户', userId: '20002', type: 'image', content: 'https://example.com/test-image.jpg', messageId: 900002 },
      ],
      applicant: {},
      comment: '主人身份消息预设',
    },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function buildRequestHeaders(headers = {}) {
    const next = new Headers(headers || {});
    if (!next.has('Accept')) {
      next.set('Accept', 'application/json');
    }
    return next;
  }

  async function requestJson(url, options = {}) {
    const timeoutMs = Number(options.timeoutMs || CONTROL_REQUEST_TIMEOUT_MS);
    const fetchOptions = { ...options };
    delete fetchOptions.timeoutMs;
    let timeoutId = null;
    let controller = null;
    if (!fetchOptions.signal && timeoutMs > 0 && typeof AbortController === 'function') {
      controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      fetchOptions.signal = controller.signal;
    }
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...fetchOptions,
        headers: buildRequestHeaders(fetchOptions.headers),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.error || `${url} -> ${response.status}`);
      }
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`请求超时，已等待 ${Math.round(timeoutMs / 1000)} 秒`);
      }
      throw error;
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  function renderStartupDiagnostics(missingIds = []) {
    const page = document.querySelector('.page') || document.body;
    const box = document.createElement('section');
    box.className = 'risk-box';
    const title = document.createElement('strong');
    title.textContent = 'QQ 模拟器页面结构不完整';
    const detail = document.createElement('div');
    detail.textContent = `缺少 ${missingIds.length} 个关键节点：${missingIds.slice(0, 16).join('、')}${missingIds.length > 16 ? ' ...' : ''}`;
    box.append(title, detail);
    page.prepend(box);
  }

  function checkStartupElements() {
    const missing = REQUIRED_ELEMENT_IDS.filter(id => !$(id));
    if (missing.length === 0) return true;
    renderStartupDiagnostics(missing);
    return false;
  }

  function nowText() {
    return new Date().toLocaleString('zh-CN', { hour12: false });
  }

  function toArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value == null || value === '') {
      return [];
    }
    return [value];
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function stringifyItem(item) {
    if (typeof item === 'string') {
      return item;
    }
    try {
      return JSON.stringify(item, null, 2);
    } catch (error) {
      return String(item);
    }
  }

  function formatBytes(bytes = 0) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value >= 1024 * 1024) {
      return `${(value / 1024 / 1024).toFixed(2)}MB`;
    }
    if (value >= 1024) {
      return `${Math.ceil(value / 1024)}KB`;
    }
    return `${value}B`;
  }

  function estimateDataUrlSize(dataUrl = '') {
    const text = String(dataUrl || '');
    const commaIndex = text.indexOf(',');
    if (commaIndex < 0) return text.length;
    const data = text.slice(commaIndex + 1).replace(/\s/g, '');
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
  }

  function encodeCqValue(value = '') {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/\[/g, '&#91;')
      .replace(/\]/g, '&#93;')
      .replace(/,/g, '&#44;');
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function fileToText(file) {
    if (file && typeof file.text === 'function') {
      return file.text();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
      reader.readAsText(file, 'utf-8');
    });
  }

  function parseImages() {
    return $('qq-simulator-images').value
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function normalizeGroupHistoryType(value = '') {
    const type = String(value || '').trim().toLowerCase();
    return ['text', 'image', 'record', 'at', 'reply'].includes(type) ? type : 'text';
  }

  function normalizeGroupHistoryItems(items = []) {
    return toArray(items)
      .map((item, index) => {
        if (!isPlainObject(item)) return null;
        const content = String(item.content ?? item.text ?? item.message ?? '').trim();
        if (!content) return null;
        const messageId = Number(item.messageId ?? item.message_id ?? item.seq ?? item.messageSeq ?? 0);
        return {
          nickname: String(item.nickname || item.senderName || item.name || `成员${index + 1}`).trim().slice(0, 60) || `成员${index + 1}`,
          userId: String(item.userId ?? item.user_id ?? item.qq ?? `2000${index + 1}`).trim().slice(0, 24) || `2000${index + 1}`,
          type: normalizeGroupHistoryType(item.type || item.messageType),
          content: content.slice(0, 600),
          messageId: Number.isFinite(messageId) && messageId > 0 ? Math.round(messageId) : 900000 + index + 1,
        };
      })
      .filter(Boolean)
      .slice(-MAX_GROUP_HISTORY_ITEMS);
  }

  function parseGroupHistoryInput() {
    return normalizeGroupHistoryItems(
      $('qq-simulator-group-history').value
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          const parts = line.split('|');
          if (parts.length >= 4) {
            return {
              nickname: parts[0],
              userId: parts[1],
              type: parts[2],
              content: parts.slice(3).join('|'),
              messageId: 900000 + index + 1,
            };
          }
          if (parts.length === 3) {
            return {
              nickname: parts[0],
              userId: parts[1],
              type: 'text',
              content: parts[2],
              messageId: 900000 + index + 1,
            };
          }
          return {
            nickname: `成员${index + 1}`,
            userId: `2000${index + 1}`,
            type: 'text',
            content: line,
            messageId: 900000 + index + 1,
          };
        })
    );
  }

  function stringifyGroupHistory(items = []) {
    return normalizeGroupHistoryItems(items)
      .map(item => `${item.nickname}|${item.userId}|${item.type}|${item.content}`)
      .join('\n');
  }

  function readOptionalInteger(id, min, max) {
    const element = $(id);
    const raw = String(element?.value || '').trim();
    if (!raw) return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  function setOptionalInteger(id, value) {
    const element = $(id);
    if (!element) return;
    element.value = value === null || value === undefined || value === '' ? '' : String(value);
  }

  function getApplicantPayload() {
    const listStatus = $('qq-simulator-list-status')?.value || 'normal';
    const normalizedListStatus = ['normal', 'whitelist', 'blacklist'].includes(listStatus) ? listStatus : 'normal';
    return {
      qqLevel: readOptionalInteger('qq-simulator-qq-level', 0, 255),
      age: readOptionalInteger('qq-simulator-age', 0, 150),
      sex: String($('qq-simulator-sex')?.value || '').trim().slice(0, 20),
      warningCount: readOptionalInteger('qq-simulator-warning-count', 0, 100),
      listStatus: normalizedListStatus,
    };
  }

  function setApplicantPayload(applicant = {}) {
    const source = applicant && typeof applicant === 'object' ? applicant : {};
    setOptionalInteger('qq-simulator-qq-level', source.qqLevel);
    setOptionalInteger('qq-simulator-age', source.age);
    setOptionalInteger('qq-simulator-warning-count', source.warningCount);
    $('qq-simulator-sex').value = source.sex || '';
    $('qq-simulator-list-status').value = ['normal', 'whitelist', 'blacklist'].includes(source.listStatus)
      ? source.listStatus
      : 'normal';
  }

  function buildHistory() {
    return state.conversation
      .filter(item => item && (item.role === 'user' || item.role === 'assistant') && item.content)
      .slice(-MAX_HISTORY_ITEMS)
      .map(item => ({
        role: item.role,
        content: String(item.content || '').slice(0, 4000),
      }));
  }

  function getVoicePayload() {
    const transcript = $('qq-simulator-voice-transcript').value.trim();
    if (state.voice) {
      return {
        ...state.voice,
        transcript,
      };
    }
    if (transcript) {
      return {
        name: 'voice-transcript',
        mimeType: 'text/plain',
        sizeBytes: 0,
        durationSeconds: 0,
        transcript,
        dataUrl: '',
      };
    }
    return null;
  }

  function getPayload(eventType) {
    const selectedEvent = eventType || $('qq-simulator-event-type').value || 'message';
    const isMessageEvent = selectedEvent === 'message';
    const conversationMode = $('qq-simulator-conversation-mode').value !== 'false';
    const screenshots = state.screenshots.map(item => ({
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      dataUrl: item.dataUrl,
    }));
    return {
      eventType: selectedEvent,
      groupId: $('qq-simulator-group-id').value.trim(),
      userId: $('qq-simulator-user-id').value.trim(),
      nickname: $('qq-simulator-nickname').value.trim(),
      role: $('qq-simulator-role').value || 'member',
      botRole: $('qq-simulator-bot-role').value || 'member',
      adapterFormat: normalizeAdapterFormat($('qq-simulator-adapter-format')?.value),
      isMaster: $('qq-simulator-is-master').value === 'true',
      messageText: isMessageEvent ? $('qq-simulator-message-text').value.trim() : '',
      includeAt: isMessageEvent && $('qq-simulator-include-at').value !== 'false',
      dispatchMode: $('qq-simulator-dispatch-mode').value || 'safe',
      conversationMode,
      history: conversationMode ? buildHistory() : [],
      groupHistory: parseGroupHistoryInput(),
      images: isMessageEvent ? parseImages() : [],
      screenshots: isMessageEvent ? screenshots : [],
      voice: isMessageEvent ? getVoicePayload() : null,
      voiceTranscript: isMessageEvent ? $('qq-simulator-voice-transcript').value.trim() : '',
      applicant: getApplicantPayload(),
      comment: $('qq-simulator-comment').value.trim(),
    };
  }

  function clearAttachments() {
    state.screenshots = [];
    state.voice = null;
    $('qq-simulator-voice-transcript').value = '';
    renderAttachmentPreview();
  }

  function clearMessageComposerAfterSend(payload = {}) {
    if (payload.eventType !== 'message') return;
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
    $('qq-simulator-dispatch-mode').value = payload.dispatchMode === 'replay' ? 'replay' : 'safe';
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
      return Promise.resolve({ confirmed: window.confirm(String(options.message || options.title || '确认操作？')) });
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
    if (role === 'owner') return 'Bot群主';
    if (role === 'admin') return 'Bot管理员';
    return 'Bot成员';
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
    const groupName = `群 ${payload.groupId || '未填写群号'}`;
    const metaText = [
      `模拟 ${eventLabel}`,
      payload.conversationMode ? `连续对话 ${historyCount} 条历史` : '单次事件',
      payload.includeAt ? '@Bot' : '未 @Bot',
      payload.dispatchMode === 'replay' ? '链路回放' : '安全模拟',
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
      createMemberNode('Bot', '模拟接收者', 'bot'),
      createMemberNode(payload.nickname || '测试用户', `${roleLabel} · ${payload.userId || '未填写 QQ'}`, 'user'),
      createMemberNode(`群 ${payload.groupId || '10001'}`, '当前模拟群', 'group'),
    );
  }

  function updateSummary(payload = getPayload()) {
    const imageCount = toArray(payload.images).length + toArray(payload.screenshots).length;
    const voice = payload.voice || null;
    const lines = [
      `事件: ${payload.eventType} (${EVENT_LABELS[payload.eventType] || '未知'})`,
      `群: ${payload.groupId || '未填写'}`,
      `用户: ${payload.nickname || '未填写'} (${payload.userId || '未填写'})`,
      `角色: ${payload.role}${payload.isMaster ? ' / 主人' : ''}`,
      `Bot身份: ${payload.botRole || 'member'} (${getBotRoleLabel(payload.botRole)})`,
      `适配器格式: ${getAdapterLabel(payload.adapterFormat)} (${normalizeAdapterFormat(payload.adapterFormat)})`,
      `模拟模式: ${payload.dispatchMode === 'replay' ? '链路回放' : '安全模拟'}`,
      `@Bot: ${payload.includeAt ? '是' : '否'}`,
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

  function validatePayload(payload) {
    const errors = [];
    const imageCount = toArray(payload.images).length + toArray(payload.screenshots).length;
    const hasVoice = Boolean(payload.voice);
    if (!['message', 'join_request', 'group_increase', 'poke'].includes(payload.eventType)) {
      errors.push('事件类型不正确');
    }
    if (!payload.groupId) {
      errors.push('groupId 不能为空');
    }
    if (!payload.userId) {
      errors.push('userId 不能为空');
    }
    if (!payload.nickname) {
      errors.push('nickname 不能为空');
    }
    if (payload.eventType === 'message' && !payload.messageText && imageCount === 0 && !hasVoice) {
      errors.push('发送消息时正文、图片或语音至少填写一项');
    }
    return errors;
  }

  function clipText(value = '', maxLength = 80) {
    const chars = Array.from(String(value || '').replace(/\s+/g, ' ').trim());
    return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}...` : chars.join('');
  }

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
    const brief = clipText(payload.messageText || payload.comment || payload.nickname || '测试', 18);
    return `${eventLabel} · 群${payload.groupId || '未填'} · ${brief}`;
  }

  function normalizeScenarioItem(item = {}) {
    if (!isPlainObject(item) || !isPlainObject(item.payload)) return null;
    const payload = normalizeScenarioPayload(item.payload);
    const name = clipText(item.name || buildScenarioName(payload), 80) || buildScenarioName(payload);
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
    const base = clipText(String(name || '模拟场景').replace(/\s+/g, ' ').trim(), 68) || '模拟场景';
    for (let index = 2; index <= 999; index += 1) {
      const candidate = clipText(`${base} (${index})`, 80);
      if (!existingNames.has(candidate)) return candidate;
    }
    return clipText(`${base} (${Date.now()})`, 80);
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
      payload.includeAt ? '@Bot' : '未@Bot',
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
      '# QQ 模拟器批量回放报告',
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
    updateStatus('已导出 Markdown 批量回放报告。', 'success');
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

  async function saveCurrentScenario() {
    if (state.isSending || state.isBatchReplaying) {
      updateStatus('模拟请求进行中，暂时不能保存场景。', 'error');
      return;
    }
    return runScenarioLibraryTask(async () => {
      const payload = getScenarioSnapshot();
      const input = $('qq-simulator-scenario-name');
      const name = clipText(input?.value || buildScenarioName(payload), 80) || buildScenarioName(payload);
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
        updateStatus('请选择 JSON 场景文件。', 'error');
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
      return `${payload.nickname || '用户'} 戳了 Bot 一下`;
    }

    const imageLines = [
      ...toArray(payload.images).map((url, index) => `图片URL ${index + 1}: ${url}`),
      ...toArray(payload.screenshots).map((item, index) => `本地截图 ${index + 1}: ${describeImageForText(item)}`),
    ];
    const groupHistoryCount = toArray(payload.groupHistory).length;
    return [
      payload.includeAt ? '@Bot' : '',
      payload.messageText || '',
      ...imageLines,
      describeVoiceForText(payload.voice),
      groupHistoryCount > 0 ? `群历史上下文: ${groupHistoryCount} 条` : '',
      payload.comment ? `备注: ${payload.comment}` : '',
    ].filter(Boolean).join('\n') || '(无文本内容)';
  }

  function getPayloadMedia(payload) {
    if (payload.eventType !== 'message') {
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

  function decodeCqValue(value = '') {
    return String(value || '')
      .replace(/&#44;/g, ',')
      .replace(/&#91;/g, '[')
      .replace(/&#93;/g, ']')
      .replace(/&amp;/g, '&');
  }

  function parseCqParams(raw = '') {
    const params = {};
    String(raw || '')
      .replace(/^,/, '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => {
        const index = item.indexOf('=');
        if (index <= 0) return;
        const key = item.slice(0, index).trim();
        const value = item.slice(index + 1);
        params[key] = decodeCqValue(value);
      });
    return params;
  }

  function normalizeSegmentObject(value = {}) {
    const source = isPlainObject(value) ? value : {};
    const data = isPlainObject(source.data) ? source.data : {};
    const type = String(source.type || source.messageType || source.message_type || '').trim().toLowerCase();
    if (Array.isArray(source.message) || typeof source.message === 'string') {
      return normalizeMessageSegments(source.message);
    }
    if (Array.isArray(source.segments)) {
      return normalizeMessageSegments(source.segments);
    }
    if (type === 'text' || (!type && (source.text || source.content))) {
      return [{ type: 'text', text: String(data.text ?? source.text ?? source.content ?? '') }];
    }
    if (type === 'at') {
      return [{ type: 'at', qq: String(data.qq ?? source.qq ?? source.userId ?? source.user_id ?? '').trim() }];
    }
    if (['image', 'img'].includes(type)) {
      return [{
        type: 'image',
        url: String(data.url ?? source.url ?? data.file ?? source.file ?? source.imageUrl ?? '').trim(),
        label: String(data.file ?? source.file ?? data.url ?? source.url ?? '图片').trim(),
      }];
    }
    if (['record', 'voice', 'audio'].includes(type)) {
      return [{
        type: 'record',
        url: String(data.url ?? source.url ?? data.file ?? source.file ?? source.audioUrl ?? '').trim(),
        label: String(data.file ?? source.file ?? data.url ?? source.url ?? '语音').trim(),
      }];
    }
    if (type === 'reply') {
      return [{ type: 'reply', id: String(data.id ?? source.id ?? source.messageId ?? source.message_id ?? '').trim() }];
    }
    if (type === 'poke') {
      const qq = String(data.qq ?? data.id ?? source.qq ?? source.id ?? source.userId ?? source.user_id ?? '').trim();
      return [{ type: 'poke', qq, id: qq }];
    }
    if (type === 'memory') {
      return [{
        type: 'memory',
        data: String(data.data ?? source.data ?? source.text ?? '').trim(),
        key: Array.isArray(source.key) ? source.key : Array.isArray(data.key) ? data.key : [],
        timeout: Number(data.timeout ?? source.timeout ?? 0) || 0,
      }];
    }
    if (type === 'face') {
      return [{ type: 'face', text: String(data.id ?? source.id ?? source.text ?? '').trim() }];
    }
    if (type === 'meme') {
      return [{
        type: 'meme',
        character: String(data.character ?? source.character ?? source.name ?? '').trim(),
        emotion: String(data.emotion ?? source.emotion ?? source.variant ?? 'default').trim(),
      }];
    }
    if (type === 'cq' || source.cqType) {
      return [{
        type: 'cq',
        cqType: String(source.cqType || data.type || 'cq').trim() || 'cq',
        data: isPlainObject(source.data) ? { ...source.data } : {},
      }];
    }
    return [{ type: 'text', text: stringifyItem(source) }];
  }

  function normalizeCqToken(token = '') {
    const control = String(token || '');
    const atMarker = control.match(/^\[\[\[at:(\d+)\]\]\]$/i)
      || control.match(/^\(\(\(at:(\d+)\)\)\)$/i)
      || control.match(/^\(\(\((\d+)\)\)\)$/);
    if (atMarker) {
      return [{ type: 'at', qq: String(atMarker[1] || '').trim() }];
    }
    const pokeMarker = control.match(/^\[\[\[poke:(\d+)\]\]\]$/i)
      || control.match(/^\(\(\(poke:(\d+)\)\)\)$/i);
    if (pokeMarker) {
      const qq = String(pokeMarker[1] || '').trim();
      return [{ type: 'poke', qq, id: qq }];
    }
    const replyMarker = control.match(/^\[\[\[reply:([^\]]+)\]\]\]$/i)
      || control.match(/^\(\(\(reply:([^)]+)\)\)\)$/i);
    if (replyMarker) {
      return [{ type: 'reply', id: String(replyMarker[1] || '').trim() }];
    }
    const memoryMarker = control.match(/^\[\[\[memory:([^:]+):([^:]+):(\d+)\]\]\]$/i);
    if (memoryMarker) {
      return [{
        type: 'memory',
        data: String(memoryMarker[1] || '').trim(),
        key: String(memoryMarker[2] || '').split(',').map(item => item.trim()).filter(Boolean),
        timeout: Number(memoryMarker[3] || 0) || 0,
      }];
    }
    const cq = String(token || '').match(/^\[CQ:([a-zA-Z0-9_-]+)([\s\S]*)\]$/);
    if (cq) {
      const type = cq[1].toLowerCase();
      const params = parseCqParams(cq[2]);
      if (!['at', 'image', 'record', 'voice', 'audio', 'face', 'reply', 'poke'].includes(type)) {
        return [{ type: 'cq', cqType: type, data: params }];
      }
      return normalizeSegmentObject({ type, data: params });
    }
    const meme = String(token || '').match(/^\[meme:([^:\]]+)(?::([^\]]+))?\]$/);
    if (meme) {
      return [{
        type: 'meme',
        character: decodeCqValue(meme[1]),
        emotion: decodeCqValue(meme[2] || 'default'),
      }];
    }
    return [{ type: 'text', text: token }];
  }

  function normalizeTextSegments(text = '') {
    const source = String(text ?? '');
    const segments = [];
    const tokenPattern = /(\[CQ:[^\]]+\]|\[meme:[^\]]+\]|\[\[\[(?:at|poke):\d+\]\]\]|\[\[\[reply:[^\]]+\]\]\]|\[\[\[memory:[^\]]+\]\]\]|\(\(\((?:at|poke):\d+\)\)\)|\(\(\(reply:[^)]+\)\)\)|\(\(\(\d+\)\)\))/gi;
    let lastIndex = 0;
    let match;
    while ((match = tokenPattern.exec(source)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', text: source.slice(lastIndex, match.index) });
      }
      segments.push(...normalizeCqToken(match[0]));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < source.length) {
      segments.push({ type: 'text', text: source.slice(lastIndex) });
    }
    return segments.filter(segment => segment.type !== 'text' || segment.text);
  }

  function normalizeMessageSegments(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.flatMap(item => normalizeMessageSegments(item));
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return normalizeTextSegments(String(value));
    }
    if (isPlainObject(value)) {
      return normalizeSegmentObject(value);
    }
    return [{ type: 'text', text: String(value) }];
  }

  function getDataUrlMediaType(value = '') {
    const match = String(value || '').match(/^data:([^;,]+)[;,]/i);
    return match ? match[1].toLowerCase() : '';
  }

  function redactPreviewMediaSource(value = '', fallbackType = 'media') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^data:/i.test(text)) {
      const mediaType = getDataUrlMediaType(text) || fallbackType;
      return `[${mediaType}; ${formatBytes(estimateDataUrlSize(text))} data-url]`;
    }
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  }

  function collectPreviewImageSources(payload = {}) {
    const items = [];
    const append = value => {
      if (Array.isArray(value)) {
        value.forEach(append);
        return;
      }
      if (isPlainObject(value)) {
        append(value.dataUrl || value.url || value.imageUrl || value.name || '');
        return;
      }
      const text = String(value || '').trim();
      if (text) items.push(text);
    };
    append(payload.images);
    append(payload.screenshots);
    return items;
  }

  function getPreviewBotId() {
    return '<bot-self-id>';
  }

  function getPreviewBotName() {
    return 'Bot';
  }

  function getSegmentFaceId(segment = {}) {
    return String(segment.id || segment.text || '').trim();
  }

  function stringifyPreviewSegmentPlain(segment = {}) {
    if (segment.type === 'text') return String(segment.text || '');
    if (segment.type === 'at') return `@${segment.qq || 'unknown'}`;
    if (segment.type === 'image') return '[图片]';
    if (segment.type === 'record') return '[语音]';
    if (segment.type === 'face') return `[表情:${getSegmentFaceId(segment) || 'face'}]`;
    if (segment.type === 'reply') return `[回复:${segment.id || 'unknown'}]`;
    if (segment.type === 'poke') return `[戳一戳:${segment.qq || segment.id || 'unknown'}]`;
    if (segment.type === 'memory') return `[记忆:${segment.data || 'memory'}]`;
    if (segment.type === 'meme') return `[meme:${segment.character || '未知'}:${segment.emotion || 'default'}]`;
    if (segment.type === 'cq') return `[CQ:${segment.cqType || 'unknown'}]`;
    return stringifyItem(segment);
  }

  function stringifyPreviewSegmentCq(segment = {}) {
    if (segment.type === 'text') return encodeCqValue(segment.text || '');
    if (segment.type === 'at') return `[CQ:at,qq=${encodeCqValue(segment.qq || '')}]`;
    if (segment.type === 'image') return `[CQ:image,file=${encodeCqValue(segment.url || segment.label || '')}]`;
    if (segment.type === 'record') return `[CQ:record,file=${encodeCqValue(segment.url || segment.label || '')}]`;
    if (segment.type === 'face') return `[CQ:face,id=${encodeCqValue(getSegmentFaceId(segment))}]`;
    if (segment.type === 'reply') return `[CQ:reply,id=${encodeCqValue(segment.id || '')}]`;
    if (segment.type === 'poke') return `[CQ:poke,qq=${encodeCqValue(segment.qq || segment.id || '')}]`;
    if (segment.type === 'memory') return '';
    if (segment.type === 'meme') return `[meme:${encodeCqValue(segment.character || '未知')}:${encodeCqValue(segment.emotion || 'default')}]`;
    if (segment.type === 'cq') {
      const params = Object.entries(segment.data || {})
        .map(([key, value]) => `${key}=${encodeCqValue(value)}`)
        .join(',');
      return `[CQ:${segment.cqType || 'unknown'}${params ? `,${params}` : ''}]`;
    }
    return encodeCqValue(stringifyItem(segment));
  }

  function toOnebotPreviewSegment(segment = {}) {
    if (segment.type === 'text') return { type: 'text', data: { text: segment.text || '' } };
    if (segment.type === 'at') return { type: 'at', data: { qq: String(segment.qq || '') } };
    if (segment.type === 'image') {
      const source = redactPreviewMediaSource(segment.url || segment.label || '', 'image');
      return { type: 'image', data: { file: source, url: source } };
    }
    if (segment.type === 'record') {
      const source = redactPreviewMediaSource(segment.url || segment.label || '', 'audio');
      return { type: 'record', data: { file: source, url: source } };
    }
    if (segment.type === 'face') return { type: 'face', data: { id: getSegmentFaceId(segment) } };
    if (segment.type === 'reply') return { type: 'reply', data: { id: String(segment.id || '') } };
    if (segment.type === 'poke') return { type: 'poke', data: { qq: String(segment.qq || segment.id || '') } };
    if (segment.type === 'memory') return { type: 'memory', data: { data: String(segment.data || ''), key: segment.key || [], timeout: segment.timeout || 0 } };
    if (segment.type === 'meme') {
      return { type: 'meme', data: { character: segment.character || '', emotion: segment.emotion || 'default' } };
    }
    if (segment.type === 'cq') return { type: segment.cqType || 'cq', data: segment.data || {} };
    return { type: 'text', data: { text: stringifyPreviewSegmentPlain(segment) } };
  }

  function toIcqqPreviewSegment(segment = {}) {
    if (segment.type === 'text') return { type: 'text', text: segment.text || '' };
    if (segment.type === 'at') return { type: 'at', qq: String(segment.qq || ''), text: `@${segment.qq || 'unknown'}` };
    if (segment.type === 'image') {
      const source = redactPreviewMediaSource(segment.url || segment.label || '', 'image');
      return { type: 'image', file: source, url: source };
    }
    if (segment.type === 'record') {
      const source = redactPreviewMediaSource(segment.url || segment.label || '', 'audio');
      return { type: 'record', file: source, url: source };
    }
    if (segment.type === 'face') return { type: 'face', id: getSegmentFaceId(segment) };
    if (segment.type === 'reply') return { type: 'reply', id: String(segment.id || '') };
    if (segment.type === 'poke') return { type: 'poke', qq: String(segment.qq || segment.id || '') };
    if (segment.type === 'memory') return { type: 'memory', data: String(segment.data || ''), key: segment.key || [], timeout: segment.timeout || 0 };
    if (segment.type === 'meme') return { type: 'meme', character: segment.character || '', emotion: segment.emotion || 'default' };
    if (segment.type === 'cq') return { type: segment.cqType || 'cq', data: segment.data || {} };
    return { type: 'text', text: stringifyPreviewSegmentPlain(segment) };
  }

  function buildOnebotPreviewMessage(payload = {}) {
    const message = [];
    if (payload.includeAt) {
      message.push({ type: 'at', data: { qq: getPreviewBotId() } });
    }
    message.push(...normalizeMessageSegments(payload.messageText).map(toOnebotPreviewSegment));
    collectPreviewImageSources(payload).forEach(source => {
      const redacted = redactPreviewMediaSource(source, 'image');
      message.push({ type: 'image', data: { file: redacted, url: redacted } });
    });
    if (payload.voice) {
      const redacted = payload.voice.dataUrl ? redactPreviewMediaSource(payload.voice.dataUrl, 'audio') : '';
      message.push({
        type: 'record',
        data: {
          file: payload.voice.name || 'voice-message',
          url: redacted,
          mime_type: payload.voice.mimeType || 'audio/*',
        },
      });
    }
    return message;
  }

  function buildIcqqPreviewMessage(payload = {}) {
    const message = [];
    if (payload.includeAt) {
      message.push({ type: 'at', qq: getPreviewBotId(), text: `@${getPreviewBotName()}` });
    }
    message.push(...normalizeMessageSegments(payload.messageText).map(toIcqqPreviewSegment));
    collectPreviewImageSources(payload).forEach(source => {
      const redacted = redactPreviewMediaSource(source, 'image');
      message.push({ type: 'image', file: redacted, url: redacted });
    });
    if (payload.voice) {
      message.push({
        type: 'record',
        file: payload.voice.name || 'voice-message',
        url: payload.voice.dataUrl ? redactPreviewMediaSource(payload.voice.dataUrl, 'audio') : '',
        mimeType: payload.voice.mimeType || 'audio/*',
        transcript: payload.voice.transcript || '',
      });
    }
    return message;
  }

  function buildPreviewRawMessage(payload = {}) {
    const parts = [];
    if (payload.includeAt) parts.push(`@${getPreviewBotName()}`);
    const text = normalizeMessageSegments(payload.messageText).map(stringifyPreviewSegmentPlain).join('');
    if (text) parts.push(text);
    if (payload.voice?.transcript) parts.push(payload.voice.transcript);
    if (payload.voice && !payload.voice?.transcript) parts.push('[语音消息]');
    const imageCount = collectPreviewImageSources(payload).length;
    if (imageCount > 0) parts.push(`[图片 ${imageCount} 张]`);
    return parts.join(' ').trim();
  }

  function buildPreviewCqMessage(payload = {}) {
    const parts = [];
    if (payload.includeAt) {
      parts.push(`[CQ:at,qq=${encodeCqValue(getPreviewBotId())}]`);
    }
    parts.push(...normalizeMessageSegments(payload.messageText).map(stringifyPreviewSegmentCq));
    collectPreviewImageSources(payload).forEach(source => {
      parts.push(`[CQ:image,file=${encodeCqValue(redactPreviewMediaSource(source, 'image'))}]`);
    });
    if (payload.voice) {
      const source = payload.voice.dataUrl
        ? redactPreviewMediaSource(payload.voice.dataUrl, 'audio')
        : payload.voice.name || 'voice-message';
      parts.push(`[CQ:record,file=${encodeCqValue(source)}]`);
    }
    return parts.join('');
  }

  function buildAdapterMessagePreview(payload = {}) {
    const adapterFormat = normalizeAdapterFormat(payload.adapterFormat);
    const message = payload.eventType === 'message'
      ? adapterFormat === 'icqq'
        ? buildIcqqPreviewMessage(payload)
        : buildOnebotPreviewMessage(payload)
      : [];
    const plainMessage = payload.eventType === 'message' ? buildPreviewRawMessage(payload) : String(payload.comment || '');
    const cqMessage = payload.eventType === 'message' ? buildPreviewCqMessage(payload) : String(payload.comment || '');
    return {
      adapterFormat,
      eventType: payload.eventType,
      event: {
        adapterFormat,
        eventType: payload.eventType,
        post_type: payload.eventType === 'message'
          ? 'message'
          : payload.eventType === 'join_request'
            ? 'request'
            : 'notice',
        message_type: payload.eventType === 'message' ? 'group' : undefined,
        group_id: payload.groupId || '<group-id>',
        user_id: payload.userId || '<user-id>',
        sender: {
          user_id: payload.userId || '<user-id>',
          nickname: payload.nickname || '测试用户',
          role: payload.role || 'member',
        },
        bot_role: payload.botRole || 'member',
        isMaster: payload.isMaster === true,
        message,
        raw_message: adapterFormat === 'icqq' ? plainMessage : cqMessage,
        msg: plainMessage,
        group_history: toArray(payload.groupHistory),
        comment: payload.comment || '',
      },
      note: payload.eventType === 'message'
        ? '<bot-self-id> 会在发送时由后端替换为真实 Bot QQ。'
        : '当前事件不是群消息事件，真实事件里通常没有 message 数组。',
    };
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
        data = { success: false, error: `接口返回了非 JSON 内容，HTTP ${response.status}` };
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
      payload.eventType === 'message'
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
    avatar.textContent = getAvatarText(entry.side === 'user' ? $('qq-simulator-nickname').value : 'Bot');

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
        title: 'Bot 回复',
        body: segmentsToPlainText(segments) || stringifyItem(reply),
        segments,
      });
    });

    voiceMessages.forEach(message => {
      const voice = normalizeVoiceMessageForMedia(message);
      addFlow({
        side: 'assistant',
        title: 'Bot 语音',
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
    if (payload.eventType !== 'message' || payload.conversationMode !== true || response?.success !== true) {
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
          errors: [`接口返回了非 JSON 内容，HTTP ${response.status}`],
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
    const imageBox = $('qq-simulator-image-preview');
    if (state.screenshots.length === 0) {
      imageBox.textContent = '暂无本地截图';
    } else {
      const nodes = state.screenshots.map(item => {
        const card = document.createElement('div');
        card.className = 'qq-simulator-attachment-card';
        const img = document.createElement('img');
        img.className = 'qq-simulator-preview-image';
        img.src = item.dataUrl;
        img.alt = item.name;
        const meta = document.createElement('div');
        meta.textContent = `${item.name} / ${formatBytes(item.sizeBytes)}`;
        card.append(img, meta);
        return card;
      });
      imageBox.replaceChildren(...nodes);
    }

    const voiceBox = $('qq-simulator-voice-preview');
    if (!state.voice) {
      voiceBox.textContent = '暂无语音';
    } else {
      const card = document.createElement('div');
      card.className = 'qq-simulator-attachment-card';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = state.voice.dataUrl;
      const meta = document.createElement('div');
      meta.textContent = `${state.voice.name} / ${formatBytes(state.voice.sizeBytes)}`;
      card.append(audio, meta);
      voiceBox.replaceChildren(card);
    }
    updateSummary();
  }

  async function addImageFiles(files) {
    const selected = Array.from(files || []).filter(file => file && /^image\//i.test(file.type || ''));
    if (selected.length === 0) return;
    const availableSlots = MAX_IMAGE_ATTACHMENTS - state.screenshots.length;
    if (availableSlots <= 0) {
      updateStatus(`最多同时附加 ${MAX_IMAGE_ATTACHMENTS} 张本地截图。`, 'error');
      return;
    }
    const accepted = selected.slice(0, availableSlots);
    const skipped = selected.length - accepted.length;
    const nextItems = [];
    for (const file of accepted) {
      if (file.size > MAX_IMAGE_BYTES) {
        updateStatus(`${file.name} 超过 ${formatBytes(MAX_IMAGE_BYTES)}，已跳过。`, 'error');
        continue;
      }
      const dataUrl = await fileToDataUrl(file);
      nextItems.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || `image-${Date.now()}`,
        mimeType: file.type || 'image/*',
        sizeBytes: file.size || estimateDataUrlSize(dataUrl),
        dataUrl,
      });
    }
    state.screenshots.push(...nextItems);
    renderAttachmentPreview();
    if (nextItems.length > 0) {
      updateStatus(skipped > 0 ? `已添加 ${nextItems.length} 张图片，另有 ${skipped} 张超过数量限制。` : `已添加 ${nextItems.length} 张图片。`, 'success');
    }
  }

  async function captureScreenshot() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      updateStatus('当前浏览器不支持屏幕截取。', 'error');
      return;
    }
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise(resolve => requestAnimationFrame(resolve));

      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      const scale = Math.min(1, 1280 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      const sizeBytes = estimateDataUrlSize(dataUrl);
      if (sizeBytes > MAX_IMAGE_BYTES) {
        updateStatus(`截屏超过 ${formatBytes(MAX_IMAGE_BYTES)}，请改用较小截图文件。`, 'error');
        return;
      }
      state.screenshots.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes,
        dataUrl,
      });
      state.screenshots = state.screenshots.slice(-MAX_IMAGE_ATTACHMENTS);
      renderAttachmentPreview();
      updateStatus('已添加屏幕截图。', 'success');
    } catch (error) {
      updateStatus(error?.message || '截屏失败。', 'error');
    } finally {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    }
  }

  async function addVoiceFile(file) {
    if (!file) return;
    if (!/^audio\//i.test(file.type || '')) {
      updateStatus('请选择音频文件。', 'error');
      return;
    }
    if (file.size > MAX_VOICE_BYTES) {
      updateStatus(`语音超过 ${formatBytes(MAX_VOICE_BYTES)}，已跳过。`, 'error');
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    state.voice = {
      name: file.name || `voice-${Date.now()}`,
      mimeType: file.type || 'audio/*',
      sizeBytes: file.size || estimateDataUrlSize(dataUrl),
      durationSeconds: 0,
      dataUrl,
    };
    renderAttachmentPreview();
    updateStatus('已添加语音。', 'success');
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
    $('qq-simulator-debug').textContent = '尚无调试数据';
    renderTimeline([]);
    renderList('qq-simulator-actions', [], '暂无动作');
    renderList('qq-simulator-logs', [], '暂无日志');
    renderList('qq-simulator-errors', [], '暂无错误');
    renderBatchReport();
    renderFlow();
    updateSummary();
    updateStatus('已清空消息流、连续对话历史与调试结果。');
  }

  function syncChatInputFromMessage() {
    const chatInput = $('qq-simulator-chat-input');
    const messageInput = $('qq-simulator-message-text');
    if (document.activeElement === chatInput) return;
    chatInput.value = messageInput.value;
  }

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
    $('qq-simulator-clear-report-btn').addEventListener('click', clearBatchReport);
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
