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
      if (window.CrystelfRequest?.requestJson) {
        return await window.CrystelfRequest.requestJson(url, {
          ...fetchOptions,
          headers: buildRequestHeaders(fetchOptions.headers),
        });
      }
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

  function normalizeAdapterFormat(value = '') {
    const adapter = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(ADAPTER_LABELS, adapter) ? adapter : 'onebot';
  }

  function getAdapterLabel(value = '') {
    return ADAPTER_LABELS[normalizeAdapterFormat(value)] || ADAPTER_LABELS.onebot;
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

  window.CrystelfQqSimulatorRuntime = {
    state,
    $,
    buildRequestHeaders,
    requestJson,
    renderStartupDiagnostics,
    checkStartupElements,
    nowText,
    toArray,
    normalizeAdapterFormat,
    getAdapterLabel,
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
  };
})();
