const groupManagementState = {
  payload: null,
  selectedGroupId: '',
  memberPayload: null,
  memberPage: 1,
  memberQuery: '',
  joinRequestPayload: null,
  joinRequestPage: 1,
  joinRequestQuery: '',
  titleApplicationPayload: null,
  titleApplicationPage: 1,
  titleApplicationQuery: '',
  titleApplicationStatus: 'pending',
  eventPayload: null,
  eventItems: [],
  eventType: 'all',
  eventCurrentGroupOnly: true,
  eventAutoRefresh: true,
  eventSince: '',
  eventTimer: null,
  eventSource: null,
  eventReconnectTimer: null,
  eventLoading: false,
  logPayload: null,
  logPage: 1,
  logQuery: '',
  refreshRequestId: 0,
  memberRequestId: 0,
  joinRequestId: 0,
  titleApplicationRequestId: 0,
  logRequestId: 0,
  eventRequestId: 0,
  refreshController: null,
  memberController: null,
  joinRequestController: null,
  titleApplicationController: null,
  logController: null,
  eventController: null,
  bulkFeature: 'ai',
  bulkSelectedGroupIds: new Set(),
  healthIgnoredKeys: new Set(),
  healthShowIgnored: false,
  eventUnreadKeys: new Set(),
  eventFailedOnly: false,
  welcomeImageFile: null,
  welcomeImagePreviewUrl: '',
  welcomeDeleteImage: false,
  modalResolve: null,
};

const HEALTH_IGNORE_STORAGE_KEY = 'crystelf.groupManagement.healthIgnored.v1';
const GROUP_MANAGEMENT_REQUEST_TIMEOUT_MS = 60000;
const WELCOME_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const WELCOME_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const WELCOME_IMAGE_MIME_BY_EXT = {
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const GROUP_MANAGEMENT_BULK_FEATURES = {
  ai: {
    label: 'AI 白名单',
    help: '用于限制 AI 只在白名单群内工作；勾选群会加入 AI 白名单。',
  },
  imageMonitor: {
    label: '图片监控白名单',
    help: '用于限制图片监控只在白名单群内工作；勾选群会加入监控白名单。',
  },
  auth: {
    label: '入群验证',
    help: '勾选群会开启本群入群验证，并保留原有验证参数。',
  },
  autoApprove: {
    label: '加群申请自动通过',
    help: '勾选群会开启自动通过开关，并保留原有等级、关键词等条件。',
  },
  welcome: {
    label: '入群欢迎',
    help: '勾选群会开启本群普通欢迎，可在单群详情里编辑欢迎文案和图片。',
  },
  aiWelcome: {
    label: 'AI 入群欢迎',
    help: '勾选群会开启普通欢迎和 AI 欢迎；AI 生成失败时会改用普通欢迎文案。',
  },
  dailySummary: {
    label: '每日群聊总结',
    help: '勾选群会开启每日群聊总结，并写入总结启用群列表。',
  },
};

const GROUP_MANAGEMENT_SAFETY_DEFAULTS = {
  enabled: true,
  allowAutoRecall: false,
  allowAutoMute: false,
  allowAutoKick: false,
  maxAutoMuteSeconds: 600,
  requireConsoleConfirm: true,
};

const GROUP_MANAGEMENT_REQUIRED_ELEMENT_IDS = [
  'gm-bulk-feature',
  'group-management-bulk-apply-btn',
  'group-management-bulk-list',
  'group-management-bulk-meta',
  'group-management-default-save-btn',
  'group-management-defaults',
  'group-management-detail',
  'group-management-direct-id',
  'group-management-event-current-group',
  'group-management-event-failed-only',
  'group-management-event-meta',
  'group-management-event-read-btn',
  'group-management-event-refresh-btn',
  'group-management-event-stream',
  'group-management-event-toggle-btn',
  'group-management-event-type',
  'group-management-health',
  'group-management-health-meta',
  'group-management-health-scan-btn',
  'group-management-list',
  'group-management-list-meta',
  'group-management-log-list',
  'group-management-log-meta',
  'group-management-log-pagination',
  'group-management-log-refresh-btn',
  'group-management-log-search',
  'group-management-modal-content',
  'group-management-modal-input',
  'group-management-modal-mask',
  'group-management-modal-title',
  'group-management-open-id-btn',
  'group-management-refresh-btn',
  'group-management-risk',
  'group-management-safety',
  'group-management-safety-save-btn',
  'group-management-save-btn',
  'group-management-search',
  'group-management-status',
  'group-management-success',
  'group-management-summary',
];

const GROUP_MANAGEMENT_ACTION_LABELS = {
  log: '只记录',
  warn: '提醒并警告',
  recall: '撤回并警告',
  mute: '禁言并警告',
  kick: '踢出并警告',
};

const GROUP_MANAGEMENT_DANGEROUS_ACTION_LABELS = {
  recall: '自动撤回',
  mute: '自动禁言',
  kick: '自动踢人',
};

const GROUP_MANAGEMENT_RULE_TEMPLATES = {
  relaxed: {
    label: '宽松群',
    help: '只保留风险记录，不主动处理成员消息。',
    autoApprove: {
      enable: false,
      minQqLevel: 0,
      minAge: 0,
      commentKeywords: [],
      blockedKeywords: [],
      customRules: [],
      risk: { enabled: true, holdHighRisk: false, highRiskScore: 80, warningBlockThreshold: 5 },
    },
    content: {
      enabled: false,
      detectLinks: true,
      urlSafety: { enabled: false, riskThreshold: 'high', maxUrlsPerMessage: 2, markdownMaxLength: 6000, timeoutMs: 20000, whitelist: [] },
      detectBlockedKeywords: true,
      blockedKeywords: [],
      repeatLimit: 6,
      repeatWindowSeconds: 60,
      detectSpamMessages: false,
      burstLimit: 12,
      burstWindowSeconds: 60,
      action: 'log',
      addWarning: false,
      observeNewMembers: true,
      observeMinutes: 30,
      observeBlockLinks: false,
    },
  },
  normal: {
    label: '普通群',
    help: '记录广告和刷屏，触发后提醒并增加警告积分。',
    autoApprove: {
      enable: false,
      minQqLevel: 15,
      minAge: 0,
      commentKeywords: [],
      blockedKeywords: ['广告', '代充', '引流'],
      customRules: [],
      risk: { enabled: true, holdHighRisk: true, highRiskScore: 70, warningBlockThreshold: 3 },
    },
    content: {
      enabled: true,
      detectLinks: true,
      urlSafety: { enabled: false, riskThreshold: 'high', maxUrlsPerMessage: 2, markdownMaxLength: 6000, timeoutMs: 20000, whitelist: [] },
      detectBlockedKeywords: true,
      blockedKeywords: ['广告', '代充', '引流', '私聊', '加群'],
      repeatLimit: 4,
      repeatWindowSeconds: 45,
      detectSpamMessages: true,
      burstLimit: 8,
      burstWindowSeconds: 60,
      action: 'warn',
      addWarning: true,
      observeNewMembers: true,
      observeMinutes: 60,
      observeBlockLinks: true,
    },
  },
  strict: {
    label: '严格群',
    help: '更严格的新人和刷屏策略，默认仍不踢人。',
    autoApprove: {
      enable: false,
      minQqLevel: 25,
      minAge: 0,
      commentKeywords: [],
      blockedKeywords: ['广告', '代充', '引流', '推广', '私聊'],
      customRules: [],
      risk: { enabled: true, holdHighRisk: true, highRiskScore: 55, warningBlockThreshold: 2 },
    },
    content: {
      enabled: true,
      detectLinks: true,
      urlSafety: { enabled: false, riskThreshold: 'high', maxUrlsPerMessage: 2, markdownMaxLength: 6000, timeoutMs: 20000, whitelist: [] },
      detectBlockedKeywords: true,
      blockedKeywords: ['广告', '代充', '引流', '推广', '私聊', '加群', '返利'],
      repeatLimit: 3,
      repeatWindowSeconds: 40,
      detectSpamMessages: true,
      burstLimit: 6,
      burstWindowSeconds: 60,
      action: 'warn',
      addWarning: true,
      observeNewMembers: true,
      observeMinutes: 180,
      observeBlockLinks: true,
    },
  },
  antiAd: {
    label: '新群防广告',
    help: '适合刚拉起来的新群，重点限制新人链接和引流词。',
    autoApprove: {
      enable: false,
      minQqLevel: 20,
      minAge: 0,
      commentKeywords: [],
      blockedKeywords: ['广告', '引流', '推广', '代充'],
      customRules: [],
      risk: { enabled: true, holdHighRisk: true, highRiskScore: 60, warningBlockThreshold: 2 },
    },
    content: {
      enabled: true,
      detectLinks: true,
      urlSafety: { enabled: false, riskThreshold: 'high', maxUrlsPerMessage: 2, markdownMaxLength: 6000, timeoutMs: 20000, whitelist: [] },
      detectBlockedKeywords: true,
      blockedKeywords: ['广告', '引流', '推广', '代充', '私聊', '加群', '兼职'],
      repeatLimit: 3,
      repeatWindowSeconds: 45,
      detectSpamMessages: true,
      burstLimit: 6,
      burstWindowSeconds: 60,
      action: 'warn',
      addWarning: true,
      observeNewMembers: true,
      observeMinutes: 360,
      observeBlockLinks: true,
    },
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
  const timeoutMs = Number(options.timeoutMs || GROUP_MANAGEMENT_REQUEST_TIMEOUT_MS);
  const cancelOnAbort = options.cancelOnAbort === true;
  const fetchOptions = { ...options };
  delete fetchOptions.timeoutMs;
  delete fetchOptions.cancelOnAbort;
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
      if (cancelOnAbort && fetchOptions.signal?.aborted === true) {
        const abortError = new Error('请求已取消。');
        abortError.name = 'WebConsoleRequestError';
        abortError.userMessage = abortError.message;
        abortError.code = 'REQUEST_ABORTED';
        abortError.url = url;
        throw abortError;
      }
      const timeoutError = new Error(`请求超时，已等待 ${Math.round(timeoutMs / 1000)} 秒`);
      timeoutError.code = 'REQUEST_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function createGroupManagementAbortController() {
  return typeof AbortController === 'function' ? new AbortController() : null;
}

function abortGroupManagementController(controller) {
  try {
    controller?.abort?.();
  } catch {
    // Ignore abort failures in older browser runtimes.
  }
}

function replaceGroupManagementRequestController(key) {
  abortGroupManagementController(groupManagementState[key]);
  const controller = createGroupManagementAbortController();
  groupManagementState[key] = controller;
  return controller;
}

function clearGroupManagementRequestController(key, controller) {
  if (groupManagementState[key] === controller) {
    groupManagementState[key] = null;
  }
}

function getCancelableGroupManagementRequestOptions(controller) {
  return controller?.signal ? { signal: controller.signal, cancelOnAbort: true } : {};
}

function isGroupManagementRequestCanceled(error) {
  return window.CrystelfRequest?.isCanceled?.(error) === true
    || error?.code === 'REQUEST_ABORTED'
    || error?.name === 'AbortError';
}

function renderStartupDiagnostics(missingIds = []) {
  const page = document.querySelector('.page') || document.body;
  const box = document.createElement('section');
  box.className = 'risk-box';
  const title = document.createElement('strong');
  title.textContent = '群管理页面结构不完整';
  const detail = document.createElement('div');
  detail.textContent = `缺少 ${missingIds.length} 个关键节点：${missingIds.slice(0, 16).join('、')}${missingIds.length > 16 ? ' ...' : ''}`;
  box.append(title, detail);
  page.prepend(box);
}

function checkStartupElements() {
  const missing = GROUP_MANAGEMENT_REQUIRED_ELEMENT_IDS.filter(id => !$(id));
  if (missing.length === 0) return true;
  renderStartupDiagnostics(missing);
  return false;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeCssString(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(String(value ?? ''));
  }
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: Number.isInteger(number) ? 0 : 2 }).format(number);
}

function formatUnixTime(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '暂无';
  return new Date(number * 1000).toLocaleString('zh-CN', { hour12: false });
}

function formatDateTime(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '暂无';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function normalizeGroupId(value) {
  const text = String(value || '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function resetWelcomeImageDraft() {
  groupManagementState.welcomeImageFile = null;
  groupManagementState.welcomeDeleteImage = false;
  if (groupManagementState.welcomeImagePreviewUrl) {
    URL.revokeObjectURL(groupManagementState.welcomeImagePreviewUrl);
  }
  groupManagementState.welcomeImagePreviewUrl = '';
}

function inferWelcomeImageMime(file = {}) {
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  return WELCOME_IMAGE_MIME_BY_EXT[ext] || '';
}

function getWelcomeImageMime(file = {}) {
  const mime = String(file.type || '').toLowerCase();
  if (WELCOME_IMAGE_MIME_TYPES.has(mime)) return mime;
  if (!mime || mime === 'application/octet-stream') return inferWelcomeImageMime(file);
  return '';
}

function validateWelcomeImageFile(file = null) {
  if (!file) {
    throw new Error('请选择欢迎图片。');
  }
  if (file.size <= 0) {
    throw new Error('欢迎图片为空。');
  }
  if (file.size > WELCOME_IMAGE_MAX_BYTES) {
    throw new Error('欢迎图片不能超过 5MB。');
  }
  const mime = getWelcomeImageMime(file);
  if (!WELCOME_IMAGE_MIME_TYPES.has(mime)) {
    throw new Error('欢迎图片只支持 png / jpg / webp / gif。');
  }
  return mime;
}

function readFileAsDataUrl(file = null) {
  const mime = validateWelcomeImageFile(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const commaIndex = dataUrl.indexOf(',');
      if (commaIndex < 0) {
        reject(new Error('欢迎图片读取失败。'));
        return;
      }
      const body = dataUrl.slice(commaIndex + 1);
      resolve(`data:${mime};base64,${body}`);
    };
    reader.onerror = () => reject(new Error('欢迎图片读取失败。'));
    reader.readAsDataURL(file);
  });
}

async function fetchJson(url, options = {}) {
  return requestJson(url, options);
}

async function postJson(url, payload) {
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function showRisk(message) {
  const risk = $('group-management-risk');
  const success = $('group-management-success');
  if (!risk || !success) return;
  risk.textContent = message;
  risk.classList.remove('hidden');
  success.classList.add('hidden');
}

function showSuccess(message) {
  const risk = $('group-management-risk');
  const success = $('group-management-success');
  if (!risk || !success) return;
  success.textContent = message;
  success.classList.remove('hidden');
  risk.classList.add('hidden');
}

function hideMessages() {
  $('group-management-risk')?.classList.add('hidden');
  $('group-management-success')?.classList.add('hidden');
}

function closeGroupManagementModal(result = { confirmed: false, value: '' }) {
  const mask = $('group-management-modal-mask');
  if (mask) mask.classList.add('hidden');
  const input = $('group-management-modal-input');
  if (input) {
    input.classList.add('hidden');
    input.value = '';
  }
  const resolve = groupManagementState.modalResolve;
  groupManagementState.modalResolve = null;
  if (resolve) resolve(result);
}

function openGroupManagementModal(options = {}) {
  const mask = $('group-management-modal-mask');
  const title = $('group-management-modal-title');
  const content = $('group-management-modal-content');
  const input = $('group-management-modal-input');
  if (!mask || !title || !content || !input) {
    return webConsoleConfirm(String(options.message || options.title || '确认操作？')).then(confirmed => ({
      confirmed,
      value: String(options.defaultValue || ''),
    }));
  }
  if (groupManagementState.modalResolve) {
    closeGroupManagementModal({ confirmed: false, value: '' });
  }
  title.textContent = options.title || '确认操作';
  content.textContent = options.message || '';
  input.classList.toggle('hidden', options.input !== true);
  input.value = String(options.defaultValue || '');
  input.placeholder = String(options.placeholder || '');
  mask.classList.remove('hidden');
  if (options.input === true) {
    setTimeout(() => input.focus(), 0);
  }
  return new Promise(resolve => {
    groupManagementState.modalResolve = resolve;
  });
}

async function confirmGroupManagementModal(message = '', options = {}) {
  const result = await openGroupManagementModal({
    title: options.title || '确认操作',
    message,
  });
  return result.confirmed === true;
}

async function promptGroupManagementModal(options = {}) {
  const result = await openGroupManagementModal({
    title: options.title || '请输入内容',
    message: options.message || '',
    input: true,
    defaultValue: options.defaultValue || '',
    placeholder: options.placeholder || '',
  });
  return result.confirmed === true ? String(result.value || '') : null;
}

function downloadTextFile(fileName = 'download.txt', text = '', mimeType = 'text/plain') {
  const blob = new Blob([String(text || '')], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setStatus(text) {
  const el = $('group-management-status');
  if (el) el.textContent = text;
}

function setEventStatus(text) {
  const el = $('group-management-event-meta');
  if (el) el.textContent = text;
}

function getGroups() {
  return groupManagementState.payload?.groups || [];
}

function getSelectedGroup() {
  const selectedId = groupManagementState.selectedGroupId;
  return getGroups().find(item => item.groupId === selectedId) || null;
}

function getSafetyConfig() {
  return {
    ...GROUP_MANAGEMENT_SAFETY_DEFAULTS,
    ...(groupManagementState.payload?.safety || {}),
  };
}

function normalizeModerationAction(value = '') {
  const action = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(GROUP_MANAGEMENT_ACTION_LABELS, action) ? action : 'log';
}

function isDangerousModerationAction(action = '') {
  return Object.prototype.hasOwnProperty.call(
    GROUP_MANAGEMENT_DANGEROUS_ACTION_LABELS,
    normalizeModerationAction(action),
  );
}

function isModerationActionAllowedBySafety(action = '', safety = getSafetyConfig()) {
  const normalized = normalizeModerationAction(action);
  if (safety.enabled === false) return true;
  if (normalized === 'recall') return safety.allowAutoRecall === true;
  if (normalized === 'mute') return safety.allowAutoMute === true;
  if (normalized === 'kick') return safety.allowAutoKick === true;
  return true;
}

function getSafetyActionWarning(action = '', safety = getSafetyConfig()) {
  const normalized = normalizeModerationAction(action);
  if (!isDangerousModerationAction(normalized)) return '';
  if (safety.enabled === false) {
    return '危险动作保护已关闭，保存后运行时会直接执行该动作。';
  }
  if (!isModerationActionAllowedBySafety(normalized, safety)) {
    return `安全开关未允许${GROUP_MANAGEMENT_DANGEROUS_ACTION_LABELS[normalized]}，运行时会降级为提醒并警告；控制台保存也会被拦截。`;
  }
  return safety.requireConsoleConfirm !== false
    ? '该动作已被安全开关放行，保存时仍需要二次确认。'
    : '该动作已被安全开关放行，保存后会自动执行。';
}
