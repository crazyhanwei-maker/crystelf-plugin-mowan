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
    help: '勾选群会开启本群欢迎和 AI 欢迎；AI 接口失败时仍回退普通欢迎。',
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
      detectBlockedKeywords: true,
      blockedKeywords: [],
      repeatLimit: 6,
      repeatWindowSeconds: 60,
      burstLimit: 12,
      burstWindowSeconds: 30,
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
      detectBlockedKeywords: true,
      blockedKeywords: ['广告', '代充', '引流', '私聊', '加群'],
      repeatLimit: 4,
      repeatWindowSeconds: 45,
      burstLimit: 8,
      burstWindowSeconds: 20,
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
      detectBlockedKeywords: true,
      blockedKeywords: ['广告', '代充', '引流', '推广', '私聊', '加群', '返利'],
      repeatLimit: 3,
      repeatWindowSeconds: 40,
      burstLimit: 6,
      burstWindowSeconds: 20,
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
      detectBlockedKeywords: true,
      blockedKeywords: ['广告', '引流', '推广', '代充', '私聊', '加群', '兼职'],
      repeatLimit: 3,
      repeatWindowSeconds: 45,
      burstLimit: 6,
      burstWindowSeconds: 20,
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

async function fetchJson(url) {
  return requestJson(url);
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
    return Promise.resolve({
      confirmed: window.confirm(String(options.message || options.title || '确认操作？')),
      value: String(options.defaultValue || ''),
    });
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

function renderSafetyPanel() {
  const box = $('group-management-safety');
  if (!box) return;
  const safety = getSafetyConfig();
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  const active = safety.enabled !== false;
  const allowedDangerCount = [
    safety.allowAutoRecall === true,
    safety.allowAutoMute === true,
    safety.allowAutoKick === true,
  ].filter(Boolean).length;
  const saveButton = $('group-management-safety-save-btn');
  if (saveButton) {
    saveButton.disabled = disabled;
  }
  box.innerHTML = `
    <div class="group-management-safety-status">
      <div class="detail-tags">
        <span class="detail-tag ${active ? 'tone-success' : 'tone-error'}">${active ? '保护开启' : '保护关闭'}</span>
        <span class="detail-tag ${safety.allowAutoRecall ? 'tone-warning' : ''}">撤回 ${safety.allowAutoRecall ? '已放行' : '拦截'}</span>
        <span class="detail-tag ${safety.allowAutoMute ? 'tone-warning' : ''}">禁言 ${safety.allowAutoMute ? '已放行' : '拦截'}</span>
        <span class="detail-tag ${safety.allowAutoKick ? 'tone-error' : ''}">踢人 ${safety.allowAutoKick ? '已放行' : '拦截'}</span>
        <span class="detail-tag">禁言上限 ${escapeHtml(formatNumber(safety.maxAutoMuteSeconds || 600))} 秒</span>
      </div>
      <div class="setting-help">${active
        ? `当前已放行 ${formatNumber(allowedDangerCount)} 类高风险自动动作；未放行的动作会被运行时降级为提醒并警告。`
        : '危险动作保护关闭后，运行时不会拦截自动撤回、禁言、踢人。'}</div>
    </div>
    <div class="group-management-safety-grid">
      ${renderFeatureSwitch('gm-safety-enabled', '开启危险动作保护', active, '开启后，未放行的自动撤回、禁言、踢人会被拦截或降级。', disabled)}
      ${renderFeatureSwitch('gm-safety-allow-recall', '允许自动撤回', safety.allowAutoRecall === true, '群消息风控命中后可自动撤回消息。', disabled)}
      ${renderFeatureSwitch('gm-safety-allow-mute', '允许自动禁言', safety.allowAutoMute === true, '群消息风控命中后可自动禁言成员。', disabled)}
      ${renderFeatureSwitch('gm-safety-allow-kick', '允许自动踢人', safety.allowAutoKick === true, '风险最高，建议只在确认规则非常稳定后开启。', disabled)}
      ${renderFeatureSwitch('gm-safety-require-confirm', '危险动作保存二次确认', safety.requireConsoleConfirm !== false, '控制台保存撤回、禁言、踢人前必须再次确认。', disabled)}
      <label class="setting-item">
        <span class="kv-label">自动禁言最长秒数</span>
        <input id="gm-safety-max-mute-seconds" type="number" min="60" max="2592000" step="60" value="${escapeHtml(safety.maxAutoMuteSeconds || 600)}" ${disabledAttr} />
        <div class="setting-help">运行时会按这个上限裁剪自动禁言时长。</div>
      </label>
    </div>
  `;
}

function renderDefaultsPanel() {
  const box = $('group-management-defaults');
  if (!box) return;
  const saveButton = $('group-management-default-save-btn');
  const defaults = groupManagementState.payload?.defaults || {};
  const auth = defaults.auth || {};
  const carbon = auth.carbon || {};
  const autoApprove = auth.autoApprove || {};
  const risk = autoApprove.risk || {};
  const welcome = defaults.welcome || {};
  const moderation = defaults.moderation || {};
  const content = moderation.content || {};
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  if (saveButton) saveButton.disabled = disabled;

  box.innerHTML = `
    <div class="group-management-control-grid group-management-default-grid">
      <section class="group-management-control-block group-management-local-block">
        <h3>默认入群验证</h3>
        <div class="setting-help">没有写入 auth.groups 的群会使用这里的配置。</div>
        <div class="group-management-nested-grid">
          <div class="group-management-nested-block">
            <h4>验证流程</h4>
            ${renderFeatureSwitch('gm-default-auth-enable', '默认启用入群验证', auth.enable === true, '开启后未单独配置的群会触发入群验证。', disabled)}
            ${renderFeatureSwitch('gm-default-auth-carbon-enable', '默认使用手性碳验证', carbon.enable === true, '关闭时使用数字计算验证。', disabled)}
            ${renderFeatureSwitch('gm-default-auth-carbon-hint', '默认显示手性碳提示', carbon.hint !== false, '仅手性碳验证模式有效。', disabled)}
            ${renderFeatureSwitch('gm-default-auth-carbon-hard', '默认手性碳困难模式', carbon['hard-mode'] === true, '需要找出全部正确区域。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认验证超时（秒）</span>
                <input id="gm-default-auth-timeout" type="number" min="30" max="1800" step="10" value="${escapeHtml(auth.timeout || 180)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认答错次数</span>
                <input id="gm-default-auth-frequency" type="number" min="1" max="20" step="1" value="${escapeHtml(auth.frequency || 5)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-default-auth-recall', '默认撤回答错消息', auth.recall !== false, '验证失败时尝试撤回成员错误答案。', disabled)}
          </div>

          <div class="group-management-nested-block">
            <h4>默认加群申请自动通过</h4>
            ${renderFeatureSwitch('gm-default-auto-approve-enable', '默认启用自动通过', autoApprove.enable === true, '未单独配置的群按这些条件自动同意加群申请。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认最低 QQ 等级</span>
                <input id="gm-default-auto-min-qq-level" type="number" min="0" max="255" step="1" value="${escapeHtml(autoApprove.minQqLevel || 0)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认最低年龄</span>
                <input id="gm-default-auto-min-age" type="number" min="0" max="150" step="1" value="${escapeHtml(autoApprove.minAge || 0)}" ${disabledAttr} />
              </label>
            </div>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">默认必要关键词</span>
              <textarea id="gm-default-auto-comment-keywords" rows="3" ${disabledAttr} placeholder="一行一个关键词，留空表示不检查">${escapeHtml((autoApprove.commentKeywords || []).join('\n'))}</textarea>
            </label>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">默认拦截关键词</span>
              <textarea id="gm-default-auto-blocked-keywords" rows="3" ${disabledAttr} placeholder="命中这些词时不自动通过">${escapeHtml((autoApprove.blockedKeywords || []).join('\n'))}</textarea>
            </label>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">默认自定义条件</span>
              <textarea id="gm-default-auto-custom-rules" rows="4" ${disabledAttr} placeholder="例如：qq等级 >= 20&#10;申请理由 包含 原神">${escapeHtml((autoApprove.customRules || []).join('\n'))}</textarea>
            </label>
            ${renderFeatureSwitch('gm-default-auto-risk-enabled', '默认启用风险评分', risk.enabled === true, '申请记录会显示风险分，并接入黑白名单和警告积分。', disabled)}
            ${renderFeatureSwitch('gm-default-auto-risk-score-enabled', '默认记录风险分', risk.scoreEnabled === true, '关闭后只保留普通自动通过条件。', disabled)}
            ${renderFeatureSwitch('gm-default-auto-risk-block-blacklist', '默认黑名单不自动通过', risk.blockBlacklistAutoApprove === true, '申请人命中本群黑名单时保留人工审核。', disabled)}
            ${renderFeatureSwitch('gm-default-auto-risk-auto-whitelist', '默认白名单直接通过', risk.autoApproveWhitelisted === true, '申请人命中本群白名单时可跳过普通条件。', disabled)}
            ${renderFeatureSwitch('gm-default-auto-risk-hold-high', '默认高风险保留人工', risk.holdHighRisk === true, '风险分达到阈值时不自动通过。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认高风险阈值</span>
                <input id="gm-default-auto-risk-high-score" type="number" min="1" max="100" step="1" value="${escapeHtml(risk.highRiskScore || 70)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认警告拦截阈值</span>
                <input id="gm-default-auto-risk-warning-threshold" type="number" min="0" max="100" step="1" value="${escapeHtml(risk.warningBlockThreshold ?? 3)}" ${disabledAttr} />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section class="group-management-control-block group-management-local-block">
        <h3>默认欢迎与风控</h3>
        <div class="setting-help">未单独保存欢迎或群消息风控的群会继承这里。</div>
        <div class="group-management-nested-grid">
          <div class="group-management-nested-block">
            <h4>默认入群欢迎</h4>
            ${renderFeatureSwitch('gm-default-welcome-enabled', '默认启用入群欢迎', welcome.enabled === true, '未单独配置欢迎的群会发送默认欢迎。', disabled)}
            ${renderFeatureSwitch('gm-default-welcome-ai-enabled', '默认启用 AI 欢迎', welcome.aiEnabled === true, '接口故障时回退普通欢迎文案。', disabled)}
            <textarea id="gm-default-welcome-text" rows="5" maxlength="1000" ${disabledAttr} placeholder="输入默认新人欢迎文案">${escapeHtml(welcome.text || '')}</textarea>
          </div>

          <div class="group-management-nested-block group-management-content-block">
            <h4>默认防广告/防刷屏</h4>
            ${renderFeatureSwitch('gm-default-content-enabled', '默认启用群消息风控', content.enabled === true, '未单独配置风控的群会使用默认规则。', disabled)}
            ${renderFeatureSwitch('gm-default-content-exempt-admins', '默认跳过群主和管理员', content.exemptAdmins !== false, '避免误处理群管理人员。', disabled)}
            ${renderFeatureSwitch('gm-default-content-detect-links', '默认检测链接', content.detectLinks !== false, '命中 URL、QQ群链接、短链等会触发。', disabled)}
            ${renderFeatureSwitch('gm-default-content-detect-keywords', '默认检测关键词', content.detectBlockedKeywords !== false, '命中下方关键词会触发。', disabled)}
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">默认广告/违规关键词</span>
              <textarea id="gm-default-content-blocked-keywords" rows="4" ${disabledAttr} placeholder="一行一个关键词">${escapeHtml((content.blockedKeywords || []).join('\n'))}</textarea>
            </label>
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认重复次数</span>
                <input id="gm-default-content-repeat-limit" type="number" min="2" max="20" step="1" value="${escapeHtml(content.repeatLimit || 4)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认重复窗口秒</span>
                <input id="gm-default-content-repeat-window" type="number" min="5" max="600" step="5" value="${escapeHtml(content.repeatWindowSeconds || 45)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认刷屏条数</span>
                <input id="gm-default-content-burst-limit" type="number" min="2" max="60" step="1" value="${escapeHtml(content.burstLimit || 8)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认刷屏窗口秒</span>
                <input id="gm-default-content-burst-window" type="number" min="5" max="600" step="5" value="${escapeHtml(content.burstWindowSeconds || 20)}" ${disabledAttr} />
              </label>
            </div>
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认触发动作</span>
                <select id="gm-default-content-action" ${disabledAttr}>
                  ${renderModerationActionOptions(content.action || 'log')}
                </select>
              </label>
              <label class="setting-item">
                <span class="kv-label">默认禁言秒数</span>
                <input id="gm-default-content-mute-seconds" type="number" min="60" max="2592000" step="60" value="${escapeHtml(content.muteSeconds || 600)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-default-content-add-warning', '默认触发后增加警告积分', content.addWarning === true, '风险评分和申请审核会读取成员警告积分。', disabled)}
            ${renderFeatureSwitch('gm-default-content-observe-new', '默认启用新人观察期', content.observeNewMembers === true, '新成员入群后一段时间内应用观察期规则。', disabled)}
            ${renderFeatureSwitch('gm-default-content-observe-block-links', '默认观察期禁止链接', content.observeBlockLinks === true, '新人观察期内发链接会触发风控。', disabled)}
            <label class="setting-item">
              <span class="kv-label">默认观察时长（分钟）</span>
              <input id="gm-default-content-observe-minutes" type="number" min="1" max="10080" step="5" value="${escapeHtml(content.observeMinutes || 60)}" ${disabledAttr} />
            </label>
            ${renderContentSafetyWarning({
              action: content.action || 'log',
              muteSeconds: content.muteSeconds || 600,
            }, 'gm-default-content-safety-warning')}
          </div>
        </div>
      </section>
    </div>
  `;
}

function updateSelectedGroupModeration(moderation) {
  const group = getSelectedGroup();
  if (!group || !moderation) return;
  group.config = {
    ...(group.config || {}),
    moderation,
  };
}

function getFilteredGroups() {
  const keyword = String($('group-management-search')?.value || '').trim().toLowerCase();
  const groups = getGroups();
  if (!keyword) return groups;
  return groups.filter((item) => [
    item.groupId,
    item.name,
    item.displayName,
    item.sourceText,
  ].some(value => String(value || '').toLowerCase().includes(keyword)));
}

function getBulkFeature() {
  const value = String($('gm-bulk-feature')?.value || groupManagementState.bulkFeature || 'ai').trim();
  return GROUP_MANAGEMENT_BULK_FEATURES[value] ? value : 'ai';
}

function isGroupEnabledForBulkFeature(group = {}, feature = getBulkFeature()) {
  const config = group.config || {};
  if (feature === 'ai') return config.ai?.whitelisted === true;
  if (feature === 'imageMonitor') return config.imageMonitor?.allowed === true;
  if (feature === 'auth') return config.auth?.config?.enable === true;
  if (feature === 'autoApprove') return config.auth?.config?.autoApprove?.enable === true;
  if (feature === 'welcome') return config.welcome?.enabled === true;
  if (feature === 'aiWelcome') return config.welcome?.aiEnabled === true;
  if (feature === 'dailySummary') return config.dailySummary?.effectiveEnabled === true || config.dailySummary?.allowed === true;
  return false;
}

function getBulkSelectedGroupIds() {
  return Array.from(groupManagementState.bulkSelectedGroupIds || new Set())
    .map(normalizeGroupId)
    .filter(Boolean);
}

function setBulkSelectedGroupIds(groupIds = []) {
  groupManagementState.bulkSelectedGroupIds = new Set(
    groupIds.map(normalizeGroupId).filter(Boolean),
  );
}

function renderBulkMeta() {
  const meta = $('group-management-bulk-meta');
  const applyButton = $('group-management-bulk-apply-btn');
  if (!meta || !applyButton) return;
  const selectedCount = getBulkSelectedGroupIds().length;
  const feature = getBulkFeature();
  const featureInfo = GROUP_MANAGEMENT_BULK_FEATURES[feature] || GROUP_MANAGEMENT_BULK_FEATURES.ai;
  meta.textContent = `已选择 ${formatNumber(selectedCount)} 个群 / ${featureInfo.help}`;
  applyButton.disabled = selectedCount <= 0 || groupManagementState.payload?.readOnly === true;
}

function renderBulkPanel() {
  const box = $('group-management-bulk-list');
  if (!box) return;
  const groups = getFilteredGroups();
  const selectedSet = new Set(getBulkSelectedGroupIds());
  const feature = getBulkFeature();
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  box.innerHTML = groups.length > 0
    ? groups.map(group => {
        const isChecked = selectedSet.has(group.groupId);
        const isEnabled = isGroupEnabledForBulkFeature(group, feature);
        return `
          <label class="group-management-bulk-item ${isChecked ? 'active' : ''}">
            <input type="checkbox" data-bulk-group-id="${escapeHtml(group.groupId)}" ${isChecked ? 'checked' : ''} ${disabledAttr} />
            <span>
              <strong>${escapeHtml(group.displayName || group.groupId)}</strong>
              <small>群号 ${escapeHtml(group.groupId)} / ${isEnabled ? '当前已开启' : '当前未开启'}</small>
            </span>
          </label>
        `;
      }).join('')
    : '<div class="group-management-empty">没有匹配的群记录。</div>';
  renderBulkMeta();
}

function renderSummary() {
  const payload = groupManagementState.payload || {};
  const summary = payload.summary || {};
  const runtime = payload.runtime || {};
  const items = [
    { label: '群记录', value: summary.groups || 0, meta: `运行时 ${formatNumber(summary.runtimeGroups || 0)}` },
    { label: 'AI 黑名单', value: summary.aiBlocked || 0, meta: `白名单 ${formatNumber(summary.aiWhitelisted || 0)}` },
    { label: '图片监控', value: summary.imageAllowed || 0, meta: `黑名单 ${formatNumber(summary.imageBlocked || 0)}` },
    { label: '入群配置', value: summary.authCustomGroups || 0, meta: `自定义 ${formatNumber(summary.authCustomGroupCount || 0)} / 自动通过 ${formatNumber(summary.autoApproveGroups || 0)} / 欢迎 ${formatNumber(summary.welcomeGroups || 0)}` },
    { label: '每日总结', value: summary.dailySummaryEnabled || 0, meta: `禁用 ${formatNumber(summary.dailySummaryBlocked || 0)}` },
    { label: '群管风控', value: summary.moderationGroups || 0, meta: `消息风控 ${formatNumber(summary.moderationContentEnabledGroups || 0)} / 黑 ${formatNumber(summary.moderationBlacklistUsers || 0)} / 白 ${formatNumber(summary.moderationWhitelistUsers || 0)} / 警告 ${formatNumber(summary.moderationWarningPoints || 0)}` },
  ];
  $('group-management-summary').innerHTML = items.map(item => `
    <article class="dashboard-strip-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${formatNumber(item.value)}</strong>
      <div>${escapeHtml(item.meta)}</div>
    </article>
  `).join('');

  const warnings = (runtime.warnings || []).length > 0
    ? `，运行时提示：${runtime.warnings.slice(0, 2).join('；')}`
    : '';
  setStatus(runtime.botAvailable
    ? `已读取 ${formatNumber(runtime.groupCount || 0)} 个运行时群${warnings}`
    : '当前控制台未拿到 Bot 运行时群列表，可直接输入群号管理配置');
}

function getGroupManagementHealthLevelLabel(level = '') {
  if (level === 'error') return '错误';
  if (level === 'warning') return '警告';
  if (level === 'info') return '提示';
  if (level === 'success') return '正常';
  return '未知';
}

function getGroupManagementHealthTone(level = '') {
  if (level === 'error') return 'tone-error';
  if (level === 'warning') return 'tone-warning';
  if (level === 'success') return 'tone-success';
  return '';
}

function loadGroupManagementHealthIgnores() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HEALTH_IGNORE_STORAGE_KEY) || '[]');
    groupManagementState.healthIgnoredKeys = new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    groupManagementState.healthIgnoredKeys = new Set();
  }
}

function saveGroupManagementHealthIgnores() {
  try {
    localStorage.setItem(HEALTH_IGNORE_STORAGE_KEY, JSON.stringify(Array.from(groupManagementState.healthIgnoredKeys || [])));
  } catch {}
}

function getGroupManagementHealthIgnoreKey(item = {}) {
  const groupIds = (Array.isArray(item.groups) ? item.groups : [])
    .map(group => String(group.groupId || '').trim())
    .filter(Boolean)
    .join(',');
  if (item.code) {
    return [item.code, item.scope, groupIds].map(value => String(value || '').trim()).join('|');
  }
  return [
    item.title,
    item.level,
    item.scope,
    item.groupCount,
    groupIds,
    item.detail,
  ].map(value => String(value || '').trim()).join('|');
}

function isGroupManagementHealthIgnored(item = {}) {
  return groupManagementState.healthIgnoredKeys.has(getGroupManagementHealthIgnoreKey(item));
}

function findGroupManagementHealthItemByKey(key = '') {
  const items = Array.isArray(groupManagementState.payload?.health?.items)
    ? groupManagementState.payload.health.items
    : [];
  return items.find(item => getGroupManagementHealthIgnoreKey(item) === key) || null;
}

function toggleGroupManagementHealthIgnored(key = '', ignored = true) {
  if (!key) return;
  if (ignored) groupManagementState.healthIgnoredKeys.add(key);
  else groupManagementState.healthIgnoredKeys.delete(key);
  saveGroupManagementHealthIgnores();
  renderHealthPanel();
}

function getGroupManagementHealthActionType(item = {}) {
  if (item.fixAction?.type) return String(item.fixAction.type || '');
  const text = `${item.title || ''} ${item.detail || ''} ${item.suggestion || ''}`;
  if (/API|接口|密钥|模型/i.test(text)) return 'api-settings';
  if (/安全|危险|禁言|撤回|踢人/.test(text)) return 'safety';
  if (/总开关|插件设置|groupManagement|auth|welcome|imageMonitor|ai/.test(text)) return 'plugin-settings';
  if ((item.groups || []).length > 0) return 'group';
  return 'scan';
}

function getGroupManagementHealthActionLabel(actionType = '') {
  if (actionType === 'auto_fix') return '自动修复';
  if (actionType === 'open_page') return '打开设置';
  if (actionType === 'open_panel') return '打开面板';
  if (actionType === 'open_group') return '打开群';
  if (actionType === 'api-settings') return '打开 API 设置';
  if (actionType === 'safety') return '打开安全开关';
  if (actionType === 'plugin-settings') return '打开插件设置';
  if (actionType === 'group') return '打开首个群';
  return '重新扫描';
}

function renderGroupManagementHealthActions(item = {}, ignored = false) {
  const key = escapeHtml(getGroupManagementHealthIgnoreKey(item));
  const actionType = getGroupManagementHealthActionType(item);
  const actionLabel = item.fixAction?.label || getGroupManagementHealthActionLabel(actionType);
  const hasGroups = Array.isArray(item.groups) && item.groups.length > 0;
  return `
    <div class="group-management-health-actions">
      <button type="button" class="mini-btn" data-action="handle-health-item" data-health-key="${key}" data-health-action="${escapeHtml(actionType)}">${escapeHtml(actionLabel)}</button>
      ${hasGroups ? `<button type="button" class="mini-btn" data-action="load-health-groups" data-health-key="${key}">载入样本群</button>` : ''}
      <button type="button" class="mini-btn" data-action="${ignored ? 'unignore-health-item' : 'ignore-health-item'}" data-health-key="${key}">${ignored ? '取消忽略' : '忽略'}</button>
    </div>
  `;
}

function renderGroupManagementHealthGroups(item = {}) {
  const groups = Array.isArray(item.groups) ? item.groups : [];
  if (groups.length === 0) {
    return '<div class="setting-help">影响范围：全局配置</div>';
  }
  const hiddenCount = Math.max(0, Number(item.groupCount || 0) - groups.length);
  return `
    <div class="group-management-health-groups">
      ${groups.map(group => `
        <button type="button" class="detail-tag group-management-health-group" data-group-id="${escapeHtml(group.groupId || '')}">
          ${escapeHtml(group.name || group.groupId || '未知群')}
          <span>${escapeHtml(group.groupId || '')}</span>
        </button>
      `).join('')}
      ${hiddenCount > 0 ? `<span class="detail-tag">还有 ${escapeHtml(formatNumber(hiddenCount))} 个群</span>` : ''}
    </div>
  `;
}

function renderHealthPanel() {
  const box = $('group-management-health');
  const meta = $('group-management-health-meta');
  const scanButton = $('group-management-health-scan-btn');
  const ignoredToggle = document.querySelector('[data-action="toggle-health-ignored"]');
  if (!box) return;
  if (scanButton) scanButton.disabled = false;
  if (ignoredToggle) ignoredToggle.textContent = groupManagementState.healthShowIgnored ? '隐藏忽略项' : '显示忽略项';
  const health = groupManagementState.payload?.health || null;
  if (!health) {
    box.innerHTML = '<div class="group-management-empty">暂无健康检查结果，请刷新群数据。</div>';
    if (meta) meta.textContent = '等待扫描群管理配置。';
    return;
  }
  const summary = health.summary || {};
  const rawItems = Array.isArray(health.items) ? health.items : [];
  const ignoredCount = rawItems.filter(item => isGroupManagementHealthIgnored(item)).length;
  const items = rawItems.filter(item => groupManagementState.healthShowIgnored || !isGroupManagementHealthIgnored(item));
  const statusText = health.status === 'healthy'
    ? '未发现明显问题'
    : health.status === 'error'
      ? '存在需要处理的问题'
      : '存在建议优化项';
  if (meta) {
    meta.textContent = `${statusText} / ${formatDateTime(health.generatedAt)} / 显示 ${formatNumber(items.length)} 项 / 已忽略 ${formatNumber(ignoredCount)} 项`;
  }
  const summaryCards = [
    { label: '错误', value: summary.errors || 0, level: 'error' },
    { label: '警告', value: summary.warnings || 0, level: 'warning' },
    { label: '提示', value: summary.infos || 0, level: 'info' },
    { label: '正常', value: summary.success || 0, level: 'success' },
  ];
  box.innerHTML = `
    <div class="group-management-health-summary">
      ${summaryCards.map(item => `
        <div class="group-management-health-summary-item ${escapeHtml(getGroupManagementHealthTone(item.level))}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(formatNumber(item.value))}</strong>
        </div>
      `).join('')}
    </div>
    <div class="group-management-health-list">
      ${items.length > 0 ? items.map(item => {
        const ignored = isGroupManagementHealthIgnored(item);
        return `
        <article class="group-management-health-item ${escapeHtml(getGroupManagementHealthTone(item.level))} ${ignored ? 'is-ignored' : ''}">
          <div class="group-management-health-item-head">
            <div>
              <strong>${escapeHtml(item.title || '未命名检查项')}</strong>
              <span>${escapeHtml(getGroupManagementHealthLevelLabel(item.level))} / ${escapeHtml(item.scope === 'group' ? `影响 ${formatNumber(item.groupCount || 0)} 个群` : '全局')}${ignored ? ' / 已忽略' : ''}</span>
            </div>
            <span class="detail-tag ${escapeHtml(getGroupManagementHealthTone(item.level))}">${escapeHtml(getGroupManagementHealthLevelLabel(item.level))}</span>
          </div>
          <div class="group-management-health-detail">${escapeHtml(item.detail || '暂无详情')}</div>
          ${item.suggestion ? `<div class="group-management-health-suggestion">${escapeHtml(item.suggestion)}</div>` : ''}
          ${renderGroupManagementHealthGroups(item)}
          ${renderGroupManagementHealthActions(item, ignored)}
        </article>
      `;}).join('') : '<div class="group-management-empty">暂无未忽略的健康检查结果。</div>'}
    </div>
  `;
}

async function runGroupManagementHealthCheck() {
  const button = $('group-management-health-scan-btn');
  if (button) button.disabled = true;
  try {
    await refreshGroupManagement({ keepMessage: true });
    showSuccess('群管理配置健康检查已完成。');
  } catch (error) {
    showRisk(`健康检查失败：${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

function buildGroupManagementHealthExportPayload() {
  const health = groupManagementState.payload?.health || {};
  const items = Array.isArray(health.items) ? health.items : [];
  return {
    exportedAt: new Date().toISOString(),
    selectedGroupId: groupManagementState.selectedGroupId || '',
    health: {
      ...health,
      items: items.map(item => ({
        ...item,
        ignored: isGroupManagementHealthIgnored(item),
      })),
    },
  };
}

function formatGroupManagementHealthMarkdown(payload = {}) {
  const health = payload.health || {};
  const items = Array.isArray(health.items) ? health.items : [];
  const lines = [
    '# 群管理配置健康检查',
    '',
    `- 导出时间：${payload.exportedAt || new Date().toISOString()}`,
    `- 状态：${health.status || 'unknown'}`,
    `- 错误：${health.summary?.errors || 0}`,
    `- 警告：${health.summary?.warnings || 0}`,
    `- 提示：${health.summary?.infos || 0}`,
    `- 已忽略：${items.filter(item => item.ignored).length}`,
    '',
  ];
  for (const level of ['error', 'warning', 'info', 'success']) {
    const group = items.filter(item => item.level === level);
    if (group.length === 0) continue;
    lines.push(`## ${getGroupManagementHealthLevelLabel(level)}`, '');
    group.forEach((item, index) => {
      const groups = (item.groups || []).map(group => `${group.name || group.groupId}(${group.groupId})`).join('、') || '全局';
      lines.push(`${index + 1}. ${item.title}${item.ignored ? '（已忽略）' : ''}`);
      lines.push(`   - 详情：${item.detail || '暂无'}`);
      if (item.suggestion) lines.push(`   - 建议：${item.suggestion}`);
      lines.push(`   - 范围：${groups}`);
      lines.push('');
    });
  }
  return lines.join('\n');
}

function exportGroupManagementHealth(format = 'markdown') {
  const payload = buildGroupManagementHealthExportPayload();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  if (format === 'json') {
    downloadTextFile(`group-management-health-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
    showSuccess('健康检查 JSON 已导出。');
    return;
  }
  downloadTextFile(`group-management-health-${stamp}.md`, formatGroupManagementHealthMarkdown(payload), 'text/markdown');
  showSuccess('健康检查 Markdown 已导出。');
}

function handleGroupManagementHealthItem(key = '', actionType = '') {
  const item = findGroupManagementHealthItemByKey(key);
  if (!item) {
    showRisk('健康检查项已变化，请重新扫描。');
    return;
  }
  const type = actionType || getGroupManagementHealthActionType(item);
  const fixAction = item.fixAction || {};
  if (type === 'auto_fix') {
    applyGroupManagementHealthFix(item).catch(error => showRisk(`自动修复失败：${error.message}`));
    return;
  }
  if (type === 'open_page' && fixAction.target) {
    const pageMap = {
      'api-settings': '/api-settings.html',
      'plugin-settings': '/plugin-settings.html',
    };
    window.open(pageMap[fixAction.target] || `/${fixAction.target}.html`, '_blank', 'noopener');
    return;
  }
  if (type === 'open_panel' && fixAction.target === 'safety') {
    document.querySelector('.group-management-safety-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (type === 'open_group' && fixAction.groupId) {
    const button = document.querySelector(`[data-group-id="${escapeCssString(fixAction.groupId)}"]`);
    if (button instanceof HTMLElement) button.click();
    return;
  }
  if (type === 'api-settings') {
    window.open('/api-settings.html', '_blank', 'noopener');
    return;
  }
  if (type === 'plugin-settings') {
    window.open('/plugin-settings.html', '_blank', 'noopener');
    return;
  }
  if (type === 'safety') {
    document.querySelector('.group-management-safety-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const firstGroup = Array.isArray(item.groups) ? item.groups[0] : null;
  if (firstGroup?.groupId) {
    const button = document.querySelector(`[data-group-id="${escapeCssString(firstGroup.groupId)}"]`);
    if (button instanceof HTMLElement) button.click();
    return;
  }
  runGroupManagementHealthCheck().catch(error => showRisk(`健康检查失败：${error.message}`));
}

async function applyGroupManagementHealthFix(item = {}) {
  const code = String(item.code || item.fixAction?.code || '').trim();
  const sourceGroupIds = Array.isArray(item.fixAction?.groupIds)
    ? item.fixAction.groupIds
    : (Array.isArray(item.groups) ? item.groups.map(group => group.groupId) : []);
  const groupIds = sourceGroupIds
    .map(normalizeGroupId)
    .filter(Boolean);
  if (!code || groupIds.length === 0) {
    showRisk('这条检查项没有可自动修复的群样本。');
    return;
  }
  const confirmed = await confirmGroupManagementModal(
    `确认自动修复 ${groupIds.length} 个样本群？\n\n检查项：${item.title || code}\n群号：${groupIds.join('、')}`,
    { title: '自动修复健康检查项' },
  );
  if (!confirmed) return;
  const result = await postJson('/api/group-management/health/fix', {
    code,
    groupIds,
    selectedGroupId: groupManagementState.selectedGroupId,
  });
  groupManagementState.payload = result;
  groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId;
  showSuccess(result.message || '健康检查项已自动修复。');
  renderSummary();
  renderHealthPanel();
  renderSafetyPanel();
  renderDefaultsPanel();
  renderBulkPanel();
  renderGroupList();
  renderDetail();
  await refreshGroupManagementLogs(1);
  await refreshGroupManagementEventStreamNow({ reset: true });
}

function handleFirstGroupManagementHealthIssue() {
  const items = Array.isArray(groupManagementState.payload?.health?.items)
    ? groupManagementState.payload.health.items
    : [];
  const item = items.find(entry => (
    entry.level !== 'success'
    && (groupManagementState.healthShowIgnored || !isGroupManagementHealthIgnored(entry))
  ));
  if (!item) {
    showSuccess('当前没有需要处理的未忽略检查项。');
    return;
  }
  handleGroupManagementHealthItem(
    getGroupManagementHealthIgnoreKey(item),
    getGroupManagementHealthActionType(item),
  );
}

function loadHealthGroupsToBulkSelection(key = '') {
  const item = findGroupManagementHealthItemByKey(key);
  const groupIds = (item?.groups || []).map(group => normalizeGroupId(group.groupId)).filter(Boolean);
  if (groupIds.length === 0) {
    showRisk('这条检查项没有可载入的群样本。');
    return;
  }
  setBulkSelectedGroupIds(groupIds);
  renderBulkPanel();
  document.querySelector('.group-management-bulk-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showSuccess(`已载入 ${groupIds.length} 个样本群到批量选择。`);
}

function getGroupToneTags(group) {
  const config = group.config || {};
  const tags = [];
  tags.push(config.ai?.effectiveEnabled
    ? '<span class="detail-tag tone-success">AI 可用</span>'
    : '<span class="detail-tag tone-error">AI 不工作</span>');
  tags.push(config.imageMonitor?.effectiveEnabled
    ? '<span class="detail-tag tone-success">图片监控开</span>'
    : '<span class="detail-tag">图片监控关</span>');
  tags.push(config.dailySummary?.effectiveEnabled
    ? '<span class="detail-tag tone-success">每日总结开</span>'
    : '<span class="detail-tag">每日总结关</span>');
  tags.push(config.auth?.config?.enable
    ? '<span class="detail-tag tone-warning">入群验证开</span>'
    : '<span class="detail-tag">入群验证关</span>');
  if (config.auth?.config?.autoApprove?.enable) {
    tags.push('<span class="detail-tag tone-success">申请自动过</span>');
  }
  if ((config.moderation?.blacklist || []).length > 0) {
    tags.push(`<span class="detail-tag tone-error">黑名单 ${escapeHtml(formatNumber(config.moderation.blacklist.length))}</span>`);
  }
  if ((config.moderation?.warnings || []).length > 0) {
    tags.push(`<span class="detail-tag tone-warning">警告 ${escapeHtml(formatNumber(config.moderation.warnings.reduce((sum, item) => sum + Number(item.count || 0), 0)))}</span>`);
  }
  if (config.moderation?.content?.enabled === true) {
    tags.push('<span class="detail-tag tone-warning">消息风控开</span>');
  }
  if (config.welcome?.enabled === true) {
    tags.push('<span class="detail-tag tone-success">欢迎开</span>');
  } else if (config.welcome?.hasCustom) {
    tags.push('<span class="detail-tag">欢迎关</span>');
  }
  return tags.join('');
}

function buildGroupSimulatorUrl(group = {}) {
  const params = new URLSearchParams({
    groupId: String(group.groupId || ''),
    eventType: 'message',
    userId: '20001',
    nickname: '测试用户',
    role: 'member',
    botRole: String(group.permissions?.role || group.botRole || 'member'),
    adapterFormat: 'onebot',
    includeAt: 'true',
    dispatchMode: 'safe',
    conversationMode: 'true',
    messageText: '你好，帮我测试一下当前群的回复链路。',
    comment: `从群管理打开：${group.displayName || group.groupId || '未知群'}`,
  });
  return `/qq-simulator.html?${params.toString()}`;
}

function formatBotRoleLabel(role = '') {
  const text = String(role || '').trim().toLowerCase();
  if (text === 'owner' || text.includes('owner') || text.includes('群主')) return '群主';
  if (text === 'admin' || text.includes('admin') || text.includes('管理员')) return '管理员';
  if (text === 'member' || text.includes('member') || text.includes('成员')) return '成员';
  return String(role || '未知').trim() || '未知';
}

function renderGroupList() {
  const groups = getFilteredGroups();
  const selectedId = groupManagementState.selectedGroupId;
  $('group-management-list-meta').textContent = `共 ${formatNumber(groups.length)} 个群记录`;
  $('group-management-list').innerHTML = groups.length > 0
    ? groups.map(group => `
      <button type="button" class="list-item group-management-group-item ${group.groupId === selectedId ? 'active' : ''}" data-group-id="${escapeHtml(group.groupId)}">
        <div class="group-management-group-main">
          <div>
            <h3>${escapeHtml(group.displayName || group.groupId)}</h3>
            <div class="setting-help">群号 ${escapeHtml(group.groupId)} / 来源 ${escapeHtml(group.sourceText || 'manual')}</div>
          </div>
          <div class="detail-tags">${getGroupToneTags(group)}</div>
        </div>
        <div class="group-management-group-meta">
          <span>成员 ${group.memberCount == null ? '未知' : escapeHtml(formatNumber(group.memberCount))}</span>
          <span>上限 ${group.maxMemberCount == null ? '未知' : escapeHtml(formatNumber(group.maxMemberCount))}</span>
          <span>Bot ${escapeHtml(formatBotRoleLabel(group.permissions?.role || group.botRole))}</span>
        </div>
      </button>
    `).join('')
    : '<div class="list-item">没有匹配的群记录。</div>';
}

function renderFeatureSwitch(id, label, checked, help, disabled) {
  return `
    <label class="group-management-switch">
      <input id="${escapeHtml(id)}" type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      <span>
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(help)}</small>
      </span>
    </label>
  `;
}

function formatModerationListForEdit(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => `${item.userId || item.user_id || ''}${item.note ? ` ${item.note}` : ''}`.trim())
    .filter(Boolean)
    .join('\n');
}

function renderWarningList(warnings = []) {
  const items = Array.isArray(warnings) ? warnings : [];
  if (items.length === 0) {
    return '<div class="group-management-empty">暂无警告积分。</div>';
  }
  return `
    <div class="group-management-warning-list">
      ${items.slice(0, 20).map(item => {
        const latest = Array.isArray(item.items) ? item.items[0] : null;
        return `
          <div class="group-management-warning-item">
            <div>
              <strong>QQ ${escapeHtml(item.userId || item.user_id || '')}</strong>
              <div class="setting-help">${escapeHtml(latest?.reason || '暂无备注')}</div>
            </div>
            <div class="detail-tags">
              <span class="detail-tag tone-warning">${escapeHtml(formatNumber(item.count || 0))} 分</span>
              <span class="detail-tag">${escapeHtml(formatDateTime(item.updatedAt || latest?.createdAt))}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function getRiskTagTone(level = '') {
  if (level === 'high') return 'tone-error';
  if (level === 'medium') return 'tone-warning';
  return 'tone-success';
}

function getRiskLevelLabel(level = '') {
  if (level === 'high') return '高风险';
  if (level === 'medium') return '中风险';
  return '低风险';
}

function renderModerationActionOptions(value = 'log') {
  const safety = getSafetyConfig();
  const current = normalizeModerationAction(value);
  return Object.entries(GROUP_MANAGEMENT_ACTION_LABELS).map(([key, label]) => {
    const blocked = safety.enabled !== false && !isModerationActionAllowedBySafety(key, safety);
    const optionLabel = blocked ? `${label}（安全开关未放行）` : label;
    return `<option value="${key}" ${current === key ? 'selected' : ''} ${blocked && current !== key ? 'disabled' : ''}>${escapeHtml(optionLabel)}</option>`;
  }).join('');
}

function renderContentSafetyWarning(contentModeration = {}, id = 'gm-content-safety-warning') {
  const safety = getSafetyConfig();
  const action = normalizeModerationAction(contentModeration.action || 'log');
  const actionWarning = getSafetyActionWarning(action, safety);
  const muteSeconds = Number(contentModeration.muteSeconds || 600);
  const secondsWarning = safety.enabled !== false
    && action === 'mute'
    && Number.isFinite(muteSeconds)
    && muteSeconds > Number(safety.maxAutoMuteSeconds || 600)
    ? `禁言秒数超过安全上限 ${safety.maxAutoMuteSeconds} 秒，运行时会按上限裁剪；控制台保存会被拦截。`
    : '';
  const messages = [actionWarning, secondsWarning].filter(Boolean);
  return `<div id="${escapeHtml(id)}" class="group-management-safety-note ${messages.length === 0 ? 'hidden' : ''}">${messages.map(escapeHtml).join(' ')}</div>`;
}

function refreshContentSafetyWarning(id = 'gm-content-safety-warning', actionId = 'gm-content-action', muteId = 'gm-content-mute-seconds') {
  const box = $(id);
  if (!box) return;
  box.outerHTML = renderContentSafetyWarning({
    action: $(actionId)?.value || 'log',
    muteSeconds: $(muteId)?.value || 600,
  }, id);
}

function renderGroupManagementTemplateOptions() {
  return Object.entries(GROUP_MANAGEMENT_RULE_TEMPLATES)
    .map(([key, item]) => `<option value="${escapeHtml(key)}">${escapeHtml(item.label)}</option>`)
    .join('');
}

function renderPermissionSummary(group = {}) {
  const permissions = group.permissions || {};
  const warnings = Array.isArray(permissions.warnings) ? permissions.warnings : [];
  return `
    <div class="group-management-permission-panel">
      <div class="detail-tags">
        <span class="detail-tag ${permissions.role === 'owner' || permissions.role === 'admin' ? 'tone-success' : permissions.role === 'member' ? 'tone-warning' : ''}">Bot ${escapeHtml(permissions.roleLabel || group.botRole || '未知')}</span>
        <span class="detail-tag ${permissions.canRecall ? 'tone-success' : 'tone-warning'}">撤回 ${permissions.canRecall ? '可用' : '未知/不可用'}</span>
        <span class="detail-tag ${permissions.canMute ? 'tone-success' : 'tone-warning'}">禁言 ${permissions.canMute ? '可用' : '未知/不可用'}</span>
        <span class="detail-tag ${permissions.canKick ? 'tone-success' : 'tone-warning'}">踢人 ${permissions.canKick ? '可用' : '未知/不可用'}</span>
        <span class="detail-tag ${permissions.canSetTitle ? 'tone-success' : 'tone-warning'}">头衔 ${permissions.canSetTitle ? '可用' : '需要群主'}</span>
      </div>
      <div class="setting-help">${warnings.length > 0 ? escapeHtml(warnings.join('；')) : '权限满足常规群管操作。实际结果仍以当前适配器返回为准。'}</div>
    </div>
  `;
}

function formatEnabledText(value) {
  return value ? '开启' : '关闭';
}

function formatSourceText(hasCustom) {
  return hasCustom ? '本群覆盖' : '继承默认';
}

function renderEffectiveConfigSnapshot(group = {}) {
  const config = group.config || {};
  const auth = config.auth?.config || {};
  const autoApprove = auth.autoApprove || {};
  const welcome = config.welcome || {};
  const dailySummary = config.dailySummary || {};
  const imageMonitor = config.imageMonitor || {};
  const moderation = config.moderation || {};
  const content = moderation.content || {};
  const items = [
    {
      label: 'AI 回复',
      value: formatEnabledText(config.ai?.effectiveEnabled === true),
      tone: config.ai?.effectiveEnabled === true ? 'tone-success' : 'tone-error',
      meta: [
        config.ai?.whitelisted ? '白名单允许' : '',
        config.ai?.blocked ? '黑名单阻断' : '',
      ].filter(Boolean).join(' / ') || '按全局 AI 群策略判断',
    },
    {
      label: '图片监控',
      value: formatEnabledText(imageMonitor.effectiveEnabled === true),
      tone: imageMonitor.effectiveEnabled === true ? 'tone-success' : '',
      meta: [
        imageMonitor.allowed ? '监控白名单' : '',
        imageMonitor.blocked ? '监控黑名单' : '',
      ].filter(Boolean).join(' / ') || '按全局图片监控范围判断',
    },
    {
      label: '每日总结',
      value: formatEnabledText(dailySummary.effectiveEnabled === true),
      tone: dailySummary.effectiveEnabled === true ? 'tone-success' : '',
      meta: [
        `模式 ${dailySummary.targetMode || '未知'}`,
        dailySummary.allowed ? '启用群' : '',
        dailySummary.blocked ? '禁用群' : '',
      ].filter(Boolean).join(' / '),
    },
    {
      label: '入群验证',
      value: formatEnabledText(auth.enable === true),
      tone: auth.enable === true ? 'tone-warning' : '',
      meta: [
        formatSourceText(config.auth?.hasCustom),
        `超时 ${auth.timeout || 180}s`,
        `答错 ${auth.frequency || 5} 次`,
      ].join(' / '),
    },
    {
      label: '自动通过',
      value: formatEnabledText(autoApprove.enable === true),
      tone: autoApprove.enable === true ? 'tone-success' : '',
      meta: [
        `QQ等级 >= ${autoApprove.minQqLevel || 0}`,
        `年龄 >= ${autoApprove.minAge || 0}`,
        `必要词 ${(autoApprove.commentKeywords || []).length}`,
        `拦截词 ${(autoApprove.blockedKeywords || []).length}`,
      ].join(' / '),
    },
    {
      label: '入群欢迎',
      value: formatEnabledText(welcome.enabled === true),
      tone: welcome.enabled === true ? 'tone-success' : '',
      meta: [
        formatSourceText(welcome.hasCustom),
        welcome.aiEnabled ? 'AI欢迎' : '普通欢迎',
        welcome.hasImage ? '有图片' : '',
        welcome.text ? '有文案' : '',
      ].filter(Boolean).join(' / ') || '未配置欢迎内容',
    },
    {
      label: '消息风控',
      value: formatEnabledText(content.enabled === true),
      tone: content.enabled === true ? 'tone-warning' : '',
      meta: [
        formatSourceText(moderation.hasCustomContent),
        `动作 ${GROUP_MANAGEMENT_ACTION_LABELS[content.action] || content.action || 'log'}`,
        content.addWarning ? '增加警告' : '不加警告',
      ].join(' / '),
    },
    {
      label: '头衔权限',
      value: group.permissions?.canSetTitle ? '可发放' : '不可发放',
      tone: group.permissions?.canSetTitle ? 'tone-success' : 'tone-warning',
      meta: group.permissions?.canSetTitle ? 'Bot 是群主' : '需要 Bot 是群主',
    },
  ];
  return `
    <div class="group-management-effective-grid">
      ${items.map(item => `
        <div class="group-management-effective-item">
          <span>${escapeHtml(item.label)}</span>
          <strong class="${escapeHtml(item.tone || '')}">${escapeHtml(item.value)}</strong>
          <small>${escapeHtml(item.meta || '暂无详情')}</small>
        </div>
      `).join('')}
    </div>
  `;
}

function renderConfigBackups(backups = []) {
  const items = Array.isArray(backups) ? backups : [];
  if (items.length === 0) {
    return '<div class="group-management-empty">暂无配置备份；保存当前群后会自动生成。</div>';
  }
  return `
    <div class="group-management-backup-list">
      ${items.map(item => `
        <div class="group-management-backup-item">
          <div>
            <strong>${escapeHtml(formatDateTime(item.createdAt))}</strong>
            <div class="setting-help">${escapeHtml(item.note || item.action || '保存前自动备份')}</div>
          </div>
          <button type="button" class="mini-btn" data-action="rollback-config" data-backup-id="${escapeHtml(item.id || '')}">回滚</button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderDetail() {
  const group = getSelectedGroup();
  const saveButton = $('group-management-save-btn');
  if (saveButton) {
    saveButton.disabled = !group || groupManagementState.payload?.readOnly === true;
  }
  if (!group) {
    $('group-management-detail').innerHTML = '<div class="group-management-empty">请选择一个群，或直接输入群号后打开。</div>';
    return;
  }

  const config = group.config || {};
  const auth = config.auth?.config || {};
  const carbon = auth.carbon || {};
  const autoApprove = auth.autoApprove || {};
  const welcome = config.welcome || {};
  const dailySummary = config.dailySummary || {};
  const moderation = config.moderation || {};
  const contentModeration = moderation.content || {};
  const authSourceLabel = config.auth?.hasCustom ? '本群覆盖' : '继承默认';
  const welcomeSourceLabel = welcome.hasCustom ? '本群覆盖' : '继承默认';
  const contentSourceLabel = moderation.hasCustomContent ? '本群覆盖' : '继承默认';
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  const readOnlyNote = disabled ? '<div class="risk-box">控制台处于只读模式，不能保存群配置。</div>' : '';

  $('group-management-detail').innerHTML = `
    <div class="group-management-detail-head">
      <div>
        <h2>${escapeHtml(group.displayName || group.groupId)}</h2>
        <div class="setting-help">群号 ${escapeHtml(group.groupId)} / ${escapeHtml(group.sourceText || 'manual')}</div>
      </div>
      <div class="group-management-detail-actions">
        <div class="detail-tags">${getGroupToneTags(group)}</div>
        <a class="mini-btn group-management-simulator-link" href="${escapeHtml(buildGroupSimulatorUrl(group))}" target="_blank" rel="noopener">用此群测试</a>
      </div>
    </div>
    ${readOnlyNote}
    <div class="group-management-control-grid">
      <section class="group-management-control-block group-management-local-block">
        <h3>权限自检与模板</h3>
        <div class="group-management-ops-grid">
          <div class="group-management-nested-block">
            <h4>Bot 权限自检</h4>
            ${renderPermissionSummary(group)}
          </div>
          <div class="group-management-nested-block group-management-effective-block">
            <h4>当前生效配置快照</h4>
            <div class="setting-help">按默认设置和本群覆盖后的最终结果展示，只用于核对，不会写入配置。</div>
            ${renderEffectiveConfigSnapshot(group)}
          </div>
          <div class="group-management-nested-block">
            <h4>群管规则模板</h4>
            <div class="setting-help">模板只填入当前表单，确认无误后再点“保存当前群”。</div>
            <div class="group-management-template-actions">
              <select id="gm-rule-template" ${disabledAttr}>
                ${renderGroupManagementTemplateOptions()}
              </select>
              <button type="button" class="mini-btn" data-action="apply-rule-template" ${disabledAttr}>填入模板</button>
            </div>
            <div id="gm-rule-template-help" class="setting-help">${escapeHtml(GROUP_MANAGEMENT_RULE_TEMPLATES.relaxed.help)}</div>
          </div>
          <div class="group-management-nested-block">
            <h4>配置备份/回滚</h4>
            <div class="setting-help">每次保存当前群前都会自动备份一次当前配置。</div>
            ${renderConfigBackups(config.backups || [])}
          </div>
        </div>
      </section>

      <section class="group-management-control-block">
        <h3>AI 群策略</h3>
        <div class="setting-help">白名单不为空时，只有白名单群会启用 AI；黑名单会直接禁用本群 AI。</div>
        ${renderFeatureSwitch('gm-ai-blocked', '加入 AI 黑名单', config.ai?.blocked, '本群不会触发 AI 回复', disabled)}
        ${renderFeatureSwitch('gm-ai-whitelisted', '加入 AI 白名单', config.ai?.whitelisted, '白名单模式下允许本群使用 AI', disabled)}
      </section>

      <section class="group-management-control-block">
        <h3>每日群聊总结</h3>
        <div class="setting-help">全局开关和定时点在插件设置里配置；这里控制当前群是否进入每日总结启用/禁用列表。</div>
        ${renderFeatureSwitch('gm-summary-allowed', '开启本群每日总结', dailySummary.allowed, '保存后会开启每日总结全局开关，并把范围设为启用群模式', disabled)}
        ${renderFeatureSwitch('gm-summary-blocked', '禁用本群每日总结', dailySummary.blocked, '无论总结范围如何，本群都不会发送每日总结', disabled)}
      </section>

      <section class="group-management-control-block">
        <h3>图片监控</h3>
        <div class="setting-help">只调整本群在图片监控白/黑名单中的状态，不修改全局监控开关。</div>
        ${renderFeatureSwitch('gm-image-allowed', '加入监控白名单', config.imageMonitor?.allowed, '白名单模式下允许监控本群', disabled)}
        ${renderFeatureSwitch('gm-image-blocked', '加入监控黑名单', config.imageMonitor?.blocked, '本群不做图片监控', disabled)}
      </section>

      <section class="group-management-control-block group-management-local-block">
        <h3>本群管理</h3>
        <div class="setting-help">集中管理当前群的入群验证、申请自动通过和入群欢迎配置。</div>
        <div class="group-management-nested-grid">
          <div class="group-management-nested-block">
            <div class="group-management-block-head">
              <h4>入群验证</h4>
              <div class="detail-tags"><span class="detail-tag">${escapeHtml(authSourceLabel)}</span></div>
              <button type="button" class="mini-btn" data-action="clear-auth" ${disabledAttr}>恢复默认</button>
            </div>
            <div class="setting-help">未单独保存时使用默认群设置；保存差异后才会写入 auth.groups.${escapeHtml(group.groupId)}。</div>
            ${renderFeatureSwitch('gm-auth-enable', '启用本群入群验证', auth.enable, '新成员入群时触发验证流程', disabled)}
            ${renderFeatureSwitch('gm-auth-carbon-enable', '使用手性碳验证', carbon.enable, '关闭时使用数字计算验证', disabled)}
            ${renderFeatureSwitch('gm-auth-carbon-hint', '显示手性碳提示', carbon.hint !== false, '仅手性碳验证模式有效', disabled)}
            ${renderFeatureSwitch('gm-auth-carbon-hard', '手性碳困难模式', carbon['hard-mode'] === true, '需要找出全部正确区域', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">验证超时（秒）</span>
                <input id="gm-auth-timeout" type="number" min="30" max="1800" step="10" value="${escapeHtml(auth.timeout || 180)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">答错次数</span>
                <input id="gm-auth-frequency" type="number" min="1" max="20" step="1" value="${escapeHtml(auth.frequency || 5)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-auth-recall', '撤回答错消息', auth.recall !== false, '验证失败时尝试撤回成员错误答案', disabled)}
          </div>

          <div class="group-management-nested-block">
            <h4>加群申请自动通过</h4>
            <div class="setting-help">只自动同意满足条件的申请；条件不满足或适配器拿不到 QQ 等级时，会保留人工审核。</div>
            ${renderFeatureSwitch('gm-auto-approve-enable', '启用自动通过', autoApprove.enable === true, '可用于 QQ 等级、年龄、申请理由关键词等条件', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">最低 QQ 等级</span>
                <input id="gm-auto-min-qq-level" type="number" min="0" max="255" step="1" value="${escapeHtml(autoApprove.minQqLevel || 0)}" ${disabledAttr} />
                <div class="setting-help">0 表示不检查；例如 20 表示 QQ 等级大于等于 20。</div>
              </label>
              <label class="setting-item">
                <span class="kv-label">最低年龄</span>
                <input id="gm-auto-min-age" type="number" min="0" max="150" step="1" value="${escapeHtml(autoApprove.minAge || 0)}" ${disabledAttr} />
                <div class="setting-help">0 表示不检查；资料无法读取时不会自动通过。</div>
              </label>
            </div>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">申请理由必要关键词</span>
              <textarea id="gm-auto-comment-keywords" rows="4" ${disabledAttr} placeholder="一行一个关键词，留空表示不检查">${escapeHtml((autoApprove.commentKeywords || []).join('\n'))}</textarea>
            </label>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">拦截关键词</span>
              <textarea id="gm-auto-blocked-keywords" rows="4" ${disabledAttr} placeholder="命中这些词时不自动通过">${escapeHtml((autoApprove.blockedKeywords || []).join('\n'))}</textarea>
            </label>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">自定义条件</span>
              <textarea id="gm-auto-custom-rules" rows="5" ${disabledAttr} placeholder="例如：qq等级 >= 20&#10;年龄 >= 18&#10;申请理由 包含 原神">${escapeHtml((autoApprove.customRules || []).join('\n'))}</textarea>
              <div class="setting-help">支持字段：qq等级、年龄、申请理由、昵称、QQ；支持 >= <= > < = != 包含 不包含。</div>
            </label>
            ${renderFeatureSwitch('gm-auto-risk-enabled', '启用入群风险评分', autoApprove.risk?.enabled === true, '申请记录会显示风险分，并接入本群黑白名单和警告积分。', disabled)}
            ${renderFeatureSwitch('gm-auto-risk-score-enabled', '记录风险分', autoApprove.risk?.scoreEnabled === true, '关闭后只保留普通自动通过条件，不再计算风险分。', disabled)}
            ${renderFeatureSwitch('gm-auto-risk-block-blacklist', '黑名单不自动通过', autoApprove.risk?.blockBlacklistAutoApprove === true, '申请人命中本群黑名单时保留人工审核。', disabled)}
            ${renderFeatureSwitch('gm-auto-risk-auto-whitelist', '白名单直接通过', autoApprove.risk?.autoApproveWhitelisted === true, '申请人命中本群白名单时可跳过等级、年龄和申请理由条件。', disabled)}
            ${renderFeatureSwitch('gm-auto-risk-hold-high', '高风险保留人工审核', autoApprove.risk?.holdHighRisk === true, '风险分达到阈值时不自动通过。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">高风险阈值</span>
                <input id="gm-auto-risk-high-score" type="number" min="1" max="100" step="1" value="${escapeHtml(autoApprove.risk?.highRiskScore || 70)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">警告拦截阈值</span>
                <input id="gm-auto-risk-warning-threshold" type="number" min="0" max="100" step="1" value="${escapeHtml(autoApprove.risk?.warningBlockThreshold ?? 3)}" ${disabledAttr} />
                <div class="setting-help">0 表示不按警告积分拦截自动通过。</div>
              </label>
            </div>
          </div>

          <div class="group-management-nested-block group-management-moderation-block">
            <h4>黑白名单与警告积分</h4>
            <div class="setting-help">一行一个 QQ，可在 QQ 后面写备注；黑名单不会自动通过，白名单可按上方策略直接通过。</div>
            <div class="settings-grid group-management-moderation-lists">
              <label class="setting-item group-management-textarea-item">
                <span class="kv-label">黑名单</span>
                <textarea id="gm-moderation-blacklist" rows="6" ${disabledAttr} placeholder="123456789 广告号">${escapeHtml(formatModerationListForEdit(moderation.blacklist || []))}</textarea>
              </label>
              <label class="setting-item group-management-textarea-item">
                <span class="kv-label">白名单</span>
                <textarea id="gm-moderation-whitelist" rows="6" ${disabledAttr} placeholder="123456789 老成员小号">${escapeHtml(formatModerationListForEdit(moderation.whitelist || []))}</textarea>
              </label>
            </div>
            <div class="group-management-warning-editor">
              <input id="gm-warning-user-id" placeholder="QQ 号" inputmode="numeric" ${disabledAttr} />
              <input id="gm-warning-reason" placeholder="警告原因" ${disabledAttr} />
              <button type="button" class="mini-btn" data-action="add-member-warning" ${disabledAttr}>增加警告</button>
              <button type="button" class="mini-btn danger" data-action="clear-member-warning" ${disabledAttr}>清空警告</button>
            </div>
            ${renderWarningList(moderation.warnings || [])}
          </div>

          <div class="group-management-nested-block group-management-content-block">
            <h4>防广告/防刷屏</h4>
            <div class="detail-tags"><span class="detail-tag">${escapeHtml(contentSourceLabel)}</span></div>
            <div class="setting-help">未单独保存时使用默认群设置；撤回、禁言、踢出会先经过全局安全开关。</div>
            ${renderFeatureSwitch('gm-content-enabled', '启用群消息风控', contentModeration.enabled === true, '检测广告链接、关键词、重复消息和短时刷屏。', disabled)}
            ${renderFeatureSwitch('gm-content-exempt-admins', '跳过群主和管理员', contentModeration.exemptAdmins === true, '避免误处理群管理人员。', disabled)}
            ${renderFeatureSwitch('gm-content-detect-links', '检测链接', contentModeration.detectLinks === true, '命中 URL、QQ群链接、短链等会触发。', disabled)}
            ${renderFeatureSwitch('gm-content-detect-keywords', '检测关键词', contentModeration.detectBlockedKeywords === true, '命中下方关键词会触发。', disabled)}
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">广告/违规关键词</span>
              <textarea id="gm-content-blocked-keywords" rows="5" ${disabledAttr} placeholder="一行一个关键词">${escapeHtml((contentModeration.blockedKeywords || []).join('\n'))}</textarea>
            </label>
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">重复次数</span>
                <input id="gm-content-repeat-limit" type="number" min="2" max="20" step="1" value="${escapeHtml(contentModeration.repeatLimit || 4)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">重复窗口秒</span>
                <input id="gm-content-repeat-window" type="number" min="5" max="600" step="5" value="${escapeHtml(contentModeration.repeatWindowSeconds || 45)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">刷屏条数</span>
                <input id="gm-content-burst-limit" type="number" min="2" max="60" step="1" value="${escapeHtml(contentModeration.burstLimit || 8)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">刷屏窗口秒</span>
                <input id="gm-content-burst-window" type="number" min="5" max="600" step="5" value="${escapeHtml(contentModeration.burstWindowSeconds || 20)}" ${disabledAttr} />
              </label>
            </div>
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">触发动作</span>
                <select id="gm-content-action" ${disabledAttr}>
                  ${renderModerationActionOptions(contentModeration.action || 'log')}
                </select>
              </label>
              <label class="setting-item">
                <span class="kv-label">禁言秒数</span>
                <input id="gm-content-mute-seconds" type="number" min="60" max="2592000" step="60" value="${escapeHtml(contentModeration.muteSeconds || 600)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-content-add-warning', '触发后增加警告积分', contentModeration.addWarning === true, '风险评分和申请审核会读取该成员的警告积分。', disabled)}
            ${renderContentSafetyWarning(contentModeration)}
          </div>

          <div class="group-management-nested-block group-management-content-block">
            <h4>新人观察期</h4>
            <div class="setting-help">新成员入群后的一段时间内可单独限制链接，适合防小号进群即广告。</div>
            ${renderFeatureSwitch('gm-content-observe-new', '启用新人观察期', contentModeration.observeNewMembers === true, '启用后会读取新成员入群时间或运行时入群事件。', disabled)}
            ${renderFeatureSwitch('gm-content-observe-block-links', '观察期禁止链接', contentModeration.observeBlockLinks === true, '新人观察期内发送链接会触发群消息风控。', disabled)}
            <label class="setting-item">
              <span class="kv-label">观察时长（分钟）</span>
              <input id="gm-content-observe-minutes" type="number" min="1" max="10080" step="5" value="${escapeHtml(contentModeration.observeMinutes || 60)}" ${disabledAttr} />
            </label>
          </div>

          <div class="group-management-nested-block">
            <div class="group-management-block-head">
              <h4>入群欢迎</h4>
              <div class="detail-tags"><span class="detail-tag">${escapeHtml(welcomeSourceLabel)}</span></div>
              <button type="button" class="mini-btn danger" data-action="clear-welcome" ${disabledAttr}>恢复默认</button>
            </div>
            <div class="setting-help">未单独保存时使用默认欢迎；保存差异后才会写入 newcomer.${escapeHtml(group.groupId)}。</div>
            ${renderFeatureSwitch('gm-welcome-enabled', '启用本群入群欢迎', welcome.enabled === true, '关闭时即使保留文案和图片，也不会自动发送欢迎。', disabled)}
            ${renderFeatureSwitch('gm-welcome-ai-enabled', '启用 AI 入群欢迎', welcome.aiEnabled === true, '开启后 AI 会生成新人欢迎文案；接口故障或不可用时自动回退到普通欢迎。', disabled)}
            <textarea id="gm-welcome-text" rows="6" maxlength="1000" ${disabledAttr} placeholder="输入新人欢迎文案">${escapeHtml(welcome.text || '')}</textarea>
            <div class="group-management-welcome-image-editor">
              <div class="group-management-welcome-preview">
                ${groupManagementState.welcomeDeleteImage
                  ? '<div class="group-management-welcome-preview-empty">保存后删除欢迎图片</div>'
                  : (groupManagementState.welcomeImagePreviewUrl || welcome.imagePreviewUrl)
                    ? `<img src="${escapeHtml(groupManagementState.welcomeImagePreviewUrl || welcome.imagePreviewUrl)}" alt="欢迎图片预览" />`
                    : '<div class="group-management-welcome-preview-empty">未设置欢迎图片</div>'}
              </div>
              <div class="group-management-welcome-image-actions">
                <input id="gm-welcome-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" ${disabledAttr} />
                <div class="actions">
                  <button type="button" class="mini-btn danger" data-action="delete-welcome-image" ${disabledAttr} ${welcome.hasImage || groupManagementState.welcomeImageFile ? '' : 'disabled'}>删除图片</button>
                </div>
                <div class="setting-help">当前图片：${groupManagementState.welcomeImageFile ? escapeHtml(groupManagementState.welcomeImageFile.name) : welcome.hasImage ? escapeHtml(welcome.imageName || '已设置') : '未设置'}。支持 png / jpg / webp / gif，最大 5MB。</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="group-management-members-panel">
      <div class="group-management-members-head">
        <div>
          <h3>加群申请</h3>
          <div id="group-management-join-requests-meta" class="setting-help">显示已收到但尚未处理的加群申请。</div>
        </div>
        <div class="toolbar group-management-members-toolbar">
          <input id="group-management-join-request-search" placeholder="搜索 QQ / 昵称 / 申请理由" value="${escapeHtml(groupManagementState.joinRequestQuery)}" />
          <button type="button" class="mini-btn" data-action="load-join-requests">刷新申请</button>
        </div>
      </div>
      <div id="group-management-join-requests" class="list">尚未读取。</div>
      <div id="group-management-join-request-pagination" class="pagination"></div>
    </section>

    <section class="group-management-members-panel">
      <div class="group-management-members-head">
        <div>
          <h3>头衔申请</h3>
          <div id="group-management-title-applications-meta" class="setting-help">查看待审核和历史头衔申请，可在控制台手动通过或拒绝。</div>
        </div>
        <div class="toolbar group-management-members-toolbar">
          <select id="group-management-title-application-status">
            <option value="pending" ${groupManagementState.titleApplicationStatus === 'pending' ? 'selected' : ''}>待审核</option>
            <option value="failed" ${groupManagementState.titleApplicationStatus === 'failed' ? 'selected' : ''}>发放失败</option>
            <option value="approved" ${groupManagementState.titleApplicationStatus === 'approved' ? 'selected' : ''}>已通过</option>
            <option value="rejected" ${groupManagementState.titleApplicationStatus === 'rejected' ? 'selected' : ''}>已拒绝</option>
            <option value="all" ${groupManagementState.titleApplicationStatus === 'all' ? 'selected' : ''}>全部</option>
          </select>
          <input id="group-management-title-application-search" placeholder="搜索编号 / QQ / 昵称 / 头衔" value="${escapeHtml(groupManagementState.titleApplicationQuery)}" />
          <button type="button" class="mini-btn" data-action="load-title-applications">刷新头衔申请</button>
        </div>
      </div>
      <div id="group-management-title-applications" class="list">尚未读取。</div>
      <div id="group-management-title-application-pagination" class="pagination"></div>
    </section>

    <section class="group-management-members-panel">
      <div class="group-management-members-head">
        <div>
          <h3>成员列表</h3>
          <div id="group-management-members-meta" class="setting-help">点击读取成员列表。</div>
        </div>
        <div class="toolbar group-management-members-toolbar">
          <input id="group-management-member-search" placeholder="搜索 QQ / 昵称 / 群名片" value="${escapeHtml(groupManagementState.memberQuery)}" />
          <button type="button" class="mini-btn" data-action="load-members">读取成员</button>
        </div>
      </div>
      <div id="group-management-members" class="list">尚未读取。</div>
      <div id="group-management-member-pagination" class="pagination"></div>
    </section>
  `;

  renderJoinRequests();
  renderTitleApplications();
  renderMembers();
}

function readNumber(id, fallback, min, max) {
  const value = Number($(id)?.value);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readLines(id) {
  return String($(id)?.value || '')
    .split(/\r?\n|[,，、;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function buildSafetySavePayload() {
  return {
    selectedGroupId: groupManagementState.selectedGroupId || '',
    safety: {
      enabled: $('gm-safety-enabled')?.checked !== false,
      allowAutoRecall: $('gm-safety-allow-recall')?.checked === true,
      allowAutoMute: $('gm-safety-allow-mute')?.checked === true,
      allowAutoKick: $('gm-safety-allow-kick')?.checked === true,
      maxAutoMuteSeconds: readNumber('gm-safety-max-mute-seconds', 600, 60, 2592000),
      requireConsoleConfirm: $('gm-safety-require-confirm')?.checked !== false,
    },
  };
}

function buildDefaultsSavePayload() {
  return {
    selectedGroupId: groupManagementState.selectedGroupId || '',
    auth: {
      enable: $('gm-default-auth-enable')?.checked === true,
      carbon: {
        enable: $('gm-default-auth-carbon-enable')?.checked === true,
        hint: $('gm-default-auth-carbon-hint')?.checked === true,
        'hard-mode': $('gm-default-auth-carbon-hard')?.checked === true,
      },
      timeout: readNumber('gm-default-auth-timeout', 180, 30, 1800),
      recall: $('gm-default-auth-recall')?.checked === true,
      frequency: readNumber('gm-default-auth-frequency', 5, 1, 20),
      autoApprove: {
        enable: $('gm-default-auto-approve-enable')?.checked === true,
        minQqLevel: readNumber('gm-default-auto-min-qq-level', 0, 0, 255),
        minAge: readNumber('gm-default-auto-min-age', 0, 0, 150),
        commentKeywords: readLines('gm-default-auto-comment-keywords'),
        blockedKeywords: readLines('gm-default-auto-blocked-keywords'),
        customRules: readLines('gm-default-auto-custom-rules'),
        risk: {
          enabled: $('gm-default-auto-risk-enabled')?.checked === true,
          scoreEnabled: $('gm-default-auto-risk-score-enabled')?.checked === true,
          blockBlacklistAutoApprove: $('gm-default-auto-risk-block-blacklist')?.checked === true,
          autoApproveWhitelisted: $('gm-default-auto-risk-auto-whitelist')?.checked === true,
          holdHighRisk: $('gm-default-auto-risk-hold-high')?.checked === true,
          highRiskScore: readNumber('gm-default-auto-risk-high-score', 70, 1, 100),
          warningBlockThreshold: readNumber('gm-default-auto-risk-warning-threshold', 3, 0, 100),
        },
      },
    },
    welcome: {
      enabled: $('gm-default-welcome-enabled')?.checked === true,
      text: $('gm-default-welcome-text')?.value || '',
      aiEnabled: $('gm-default-welcome-ai-enabled')?.checked === true,
    },
    moderation: {
      content: {
        enabled: $('gm-default-content-enabled')?.checked === true,
        exemptAdmins: $('gm-default-content-exempt-admins')?.checked === true,
        detectLinks: $('gm-default-content-detect-links')?.checked === true,
        detectBlockedKeywords: $('gm-default-content-detect-keywords')?.checked === true,
        blockedKeywords: readLines('gm-default-content-blocked-keywords'),
        repeatLimit: readNumber('gm-default-content-repeat-limit', 4, 2, 20),
        repeatWindowSeconds: readNumber('gm-default-content-repeat-window', 45, 5, 600),
        burstLimit: readNumber('gm-default-content-burst-limit', 8, 2, 60),
        burstWindowSeconds: readNumber('gm-default-content-burst-window', 20, 5, 600),
        observeNewMembers: $('gm-default-content-observe-new')?.checked === true,
        observeMinutes: readNumber('gm-default-content-observe-minutes', 60, 1, 10080),
        observeBlockLinks: $('gm-default-content-observe-block-links')?.checked === true,
        action: $('gm-default-content-action')?.value || 'log',
        muteSeconds: readNumber('gm-default-content-mute-seconds', 600, 60, 2592000),
        addWarning: $('gm-default-content-add-warning')?.checked === true,
      },
    },
  };
}

function normalizeDiffLines(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (item && typeof item === 'object') {
        const userId = String(item.userId || item.user_id || '').trim();
        const note = String(item.note || '').trim();
        return `${userId}${note ? ` ${note}` : ''}`.trim();
      }
      return String(item ?? '').trim();
    })
    .filter(Boolean);
}

function normalizeComparableDiffValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableDiffValue);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeComparableDiffValue(value[key]);
        return result;
      }, {});
  }
  if (value === undefined) return null;
  return value;
}

function isSameDiffValue(left, right) {
  return JSON.stringify(normalizeComparableDiffValue(left)) === JSON.stringify(normalizeComparableDiffValue(right));
}

function formatDiffValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '空';
    const preview = value.slice(0, 5).map(item => String(item)).join('、');
    return value.length > 5 ? `${preview} 等 ${value.length} 项` : preview;
  }
  if (value === true) return '开启';
  if (value === false) return '关闭';
  if (value === null || value === undefined || value === '') return '空';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 100 ? `${text.slice(0, 100)}...` : text;
}

function addGroupSaveDiffLine(diffs, label, before, after) {
  if (isSameDiffValue(before, after)) return;
  diffs.push(`${label}: ${formatDiffValue(before)} -> ${formatDiffValue(after)}`);
}

function formatDiffSeconds(value, fallback = 0) {
  const number = Number(value);
  return `${Number.isFinite(number) ? Math.round(number) : fallback} 秒`;
}

function formatWelcomeImageDiffValue(value = {}) {
  if (!value || typeof value !== 'object') return '无';
  if (value.uploaded === true) return value.name ? `上传新图 ${value.name}` : '上传新图';
  if (value.hasImage === true) return value.name ? `已设置 ${value.name}` : '已设置';
  return '无';
}

function buildGroupSaveDiffLines(group = {}, payload = {}) {
  const config = group.config || {};
  const auth = config.auth?.config || {};
  const carbon = auth.carbon || {};
  const autoApprove = auth.autoApprove || {};
  const risk = autoApprove.risk || {};
  const welcome = config.welcome || {};
  const moderation = config.moderation || {};
  const content = moderation.content || {};
  const nextAuth = payload.auth || {};
  const nextCarbon = nextAuth.carbon || {};
  const nextAutoApprove = nextAuth.autoApprove || {};
  const nextRisk = nextAutoApprove.risk || {};
  const nextWelcome = payload.welcome || {};
  const nextModeration = payload.moderation || {};
  const nextContent = nextModeration.content || {};
  const diffs = [];

  addGroupSaveDiffLine(diffs, 'AI 黑名单', config.ai?.blocked === true, payload.ai?.blocked === true);
  addGroupSaveDiffLine(diffs, 'AI 白名单', config.ai?.whitelisted === true, payload.ai?.whitelisted === true);
  addGroupSaveDiffLine(diffs, '图片监控白名单', config.imageMonitor?.allowed === true, payload.imageMonitor?.allowed === true);
  addGroupSaveDiffLine(diffs, '图片监控黑名单', config.imageMonitor?.blocked === true, payload.imageMonitor?.blocked === true);
  addGroupSaveDiffLine(diffs, '每日总结启用群', config.dailySummary?.allowed === true, payload.dailySummary?.allowed === true);
  addGroupSaveDiffLine(diffs, '每日总结禁用群', config.dailySummary?.blocked === true, payload.dailySummary?.blocked === true);

  addGroupSaveDiffLine(diffs, '入群验证', auth.enable === true, nextAuth.enable === true);
  addGroupSaveDiffLine(diffs, '验证码验证', carbon.enable === true, nextCarbon.enable === true);
  addGroupSaveDiffLine(diffs, '验证码提示', carbon.hint === true, nextCarbon.hint === true);
  addGroupSaveDiffLine(diffs, '验证码困难模式', carbon['hard-mode'] === true, nextCarbon['hard-mode'] === true);
  addGroupSaveDiffLine(diffs, '验证超时', formatDiffSeconds(auth.timeout, 180), formatDiffSeconds(nextAuth.timeout, 180));
  addGroupSaveDiffLine(diffs, '撤回验证消息', auth.recall === true, nextAuth.recall === true);
  addGroupSaveDiffLine(diffs, '答错次数', Number(auth.frequency || 5), Number(nextAuth.frequency || 5));

  addGroupSaveDiffLine(diffs, '自动通过加群申请', autoApprove.enable === true, nextAutoApprove.enable === true);
  addGroupSaveDiffLine(diffs, '自动通过最低 QQ 等级', Number(autoApprove.minQqLevel || 0), Number(nextAutoApprove.minQqLevel || 0));
  addGroupSaveDiffLine(diffs, '自动通过最低年龄', Number(autoApprove.minAge || 0), Number(nextAutoApprove.minAge || 0));
  addGroupSaveDiffLine(diffs, '申请理由必要词', normalizeDiffLines(autoApprove.commentKeywords), normalizeDiffLines(nextAutoApprove.commentKeywords));
  addGroupSaveDiffLine(diffs, '申请理由拦截词', normalizeDiffLines(autoApprove.blockedKeywords), normalizeDiffLines(nextAutoApprove.blockedKeywords));
  addGroupSaveDiffLine(diffs, '自动通过自定义规则', normalizeDiffLines(autoApprove.customRules), normalizeDiffLines(nextAutoApprove.customRules));
  addGroupSaveDiffLine(diffs, '入群风险评分', risk.enabled === true, nextRisk.enabled === true);
  addGroupSaveDiffLine(diffs, '记录风险分', risk.scoreEnabled === true, nextRisk.scoreEnabled === true);
  addGroupSaveDiffLine(diffs, '黑名单不自动通过', risk.blockBlacklistAutoApprove === true, nextRisk.blockBlacklistAutoApprove === true);
  addGroupSaveDiffLine(diffs, '白名单直接通过', risk.autoApproveWhitelisted === true, nextRisk.autoApproveWhitelisted === true);
  addGroupSaveDiffLine(diffs, '高风险保留人工审核', risk.holdHighRisk === true, nextRisk.holdHighRisk === true);
  addGroupSaveDiffLine(diffs, '高风险分阈值', Number(risk.highRiskScore || 70), Number(nextRisk.highRiskScore || 70));
  addGroupSaveDiffLine(diffs, '警告积分拦截阈值', Number(risk.warningBlockThreshold ?? 3), Number(nextRisk.warningBlockThreshold ?? 3));

  addGroupSaveDiffLine(diffs, '群黑名单', normalizeDiffLines(moderation.blacklist), normalizeDiffLines(nextModeration.blacklist));
  addGroupSaveDiffLine(diffs, '群白名单', normalizeDiffLines(moderation.whitelist), normalizeDiffLines(nextModeration.whitelist));
  addGroupSaveDiffLine(diffs, '群消息风控', content.enabled === true, nextContent.enabled === true);
  addGroupSaveDiffLine(diffs, '跳过群主和管理员', content.exemptAdmins === true, nextContent.exemptAdmins === true);
  addGroupSaveDiffLine(diffs, '检测链接', content.detectLinks === true, nextContent.detectLinks === true);
  addGroupSaveDiffLine(diffs, '检测关键词', content.detectBlockedKeywords === true, nextContent.detectBlockedKeywords === true);
  addGroupSaveDiffLine(diffs, '消息风控关键词', normalizeDiffLines(content.blockedKeywords), normalizeDiffLines(nextContent.blockedKeywords));
  addGroupSaveDiffLine(diffs, '重复消息阈值', Number(content.repeatLimit || 4), Number(nextContent.repeatLimit || 4));
  addGroupSaveDiffLine(diffs, '重复消息窗口', formatDiffSeconds(content.repeatWindowSeconds, 45), formatDiffSeconds(nextContent.repeatWindowSeconds, 45));
  addGroupSaveDiffLine(diffs, '短时刷屏阈值', Number(content.burstLimit || 8), Number(nextContent.burstLimit || 8));
  addGroupSaveDiffLine(diffs, '短时刷屏窗口', formatDiffSeconds(content.burstWindowSeconds, 20), formatDiffSeconds(nextContent.burstWindowSeconds, 20));
  addGroupSaveDiffLine(diffs, '新人观察期', content.observeNewMembers === true, nextContent.observeNewMembers === true);
  addGroupSaveDiffLine(diffs, '观察期时长', `${Number(content.observeMinutes || 60)} 分钟`, `${Number(nextContent.observeMinutes || 60)} 分钟`);
  addGroupSaveDiffLine(diffs, '观察期禁止链接', content.observeBlockLinks === true, nextContent.observeBlockLinks === true);
  addGroupSaveDiffLine(
    diffs,
    '风控处理动作',
    GROUP_MANAGEMENT_ACTION_LABELS[normalizeModerationAction(content.action || 'log')],
    GROUP_MANAGEMENT_ACTION_LABELS[normalizeModerationAction(nextContent.action || 'log')],
  );
  addGroupSaveDiffLine(diffs, '自动禁言时长', formatDiffSeconds(content.muteSeconds, 600), formatDiffSeconds(nextContent.muteSeconds, 600));
  addGroupSaveDiffLine(diffs, '触发后增加警告积分', content.addWarning === true, nextContent.addWarning === true);

  addGroupSaveDiffLine(diffs, '入群欢迎', welcome.enabled === true, nextWelcome.enabled === true);
  addGroupSaveDiffLine(diffs, 'AI 入群欢迎', welcome.aiEnabled === true, nextWelcome.aiEnabled === true);
  addGroupSaveDiffLine(diffs, '欢迎文案', welcome.text || '', nextWelcome.text || '');
  const beforeImage = {
    hasImage: welcome.hasImage === true,
    name: welcome.imageName || '',
  };
  const afterImage = nextWelcome.deleteImage === true
    ? { hasImage: false }
    : nextWelcome.imageDataUrl
      ? { uploaded: true, name: groupManagementState.welcomeImageFile?.name || '' }
      : beforeImage;
  addGroupSaveDiffLine(diffs, '欢迎图片', formatWelcomeImageDiffValue(beforeImage), formatWelcomeImageDiffValue(afterImage));

  return diffs;
}

async function confirmGroupSaveDiff(payload = {}) {
  const group = getSelectedGroup();
  if (!group) return true;
  const diffs = buildGroupSaveDiffLines(group, payload);
  if (diffs.length === 0) {
    return confirmGroupManagementModal(`没有检测到当前群配置变化。\n\n群号：${group.groupId}\n继续保存会刷新备份和日志，确认保存？`, {
      title: '保存当前群',
    });
  }
  const maxLines = 28;
  const visibleLines = diffs.slice(0, maxLines).map(line => `- ${line}`).join('\n');
  const hiddenCount = diffs.length - maxLines;
  const hiddenText = hiddenCount > 0 ? `\n...还有 ${hiddenCount} 项未显示` : '';
  return confirmGroupManagementModal(
    `保存前差异预览\n\n群：${group.displayName || group.groupId}\n群号：${group.groupId}\n\n${visibleLines}${hiddenText}\n\n确认保存当前群配置？`,
    { title: '保存前差异预览' },
  );
}

async function confirmGroupSaveSafety(payload = {}) {
  const content = payload?.moderation?.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return true;
  const action = normalizeModerationAction(content.action || 'log');
  if (!isDangerousModerationAction(action)) return true;
  const safety = getSafetyConfig();
  const dangerLabel = GROUP_MANAGEMENT_DANGEROUS_ACTION_LABELS[action] || GROUP_MANAGEMENT_ACTION_LABELS[action] || action;
  if (safety.enabled !== false) {
    if (!isModerationActionAllowedBySafety(action, safety)) {
      showRisk(`群管安全开关未允许${dangerLabel}，请先保存安全开关放行，或把触发动作改为“只记录/提醒并警告”。`);
      return false;
    }
    if (
      action === 'mute'
      && Number(content.muteSeconds || 0) > Number(safety.maxAutoMuteSeconds || 600)
    ) {
      showRisk(`自动禁言秒数超过安全上限 ${safety.maxAutoMuteSeconds} 秒，请降低禁言秒数或调整安全上限。`);
      return false;
    }
  }
  if (safety.enabled === false || safety.requireConsoleConfirm !== false) {
    const confirmText = safety.enabled === false
      ? `危险动作保护已关闭。确认把当前群消息风控动作保存为“${GROUP_MANAGEMENT_ACTION_LABELS[action]}”？`
      : `确认把当前群消息风控动作保存为“${GROUP_MANAGEMENT_ACTION_LABELS[action]}”？命中规则后会执行${dangerLabel}。`;
    if (!await confirmGroupManagementModal(confirmText, { title: '危险动作确认' })) {
      return false;
    }
    content.dangerConfirmed = true;
  }
  return true;
}

async function buildSavePayload() {
  const group = getSelectedGroup();
  if (!group) {
    throw new Error('请先选择群');
  }
  const welcome = {
    enabled: $('gm-welcome-enabled')?.checked === true,
    text: $('gm-welcome-text')?.value || '',
    aiEnabled: $('gm-welcome-ai-enabled')?.checked === true,
  };
  if (groupManagementState.welcomeDeleteImage) {
    welcome.deleteImage = true;
  }
  if (groupManagementState.welcomeImageFile) {
    welcome.imageDataUrl = await readFileAsDataUrl(groupManagementState.welcomeImageFile);
  }
  return {
    groupId: group.groupId,
    ai: {
      blocked: $('gm-ai-blocked')?.checked === true,
      whitelisted: $('gm-ai-whitelisted')?.checked === true,
    },
    imageMonitor: {
      allowed: $('gm-image-allowed')?.checked === true,
      blocked: $('gm-image-blocked')?.checked === true,
    },
    dailySummary: {
      allowed: $('gm-summary-allowed')?.checked === true,
      blocked: $('gm-summary-blocked')?.checked === true,
    },
    auth: {
      enable: $('gm-auth-enable')?.checked === true,
      carbon: {
        enable: $('gm-auth-carbon-enable')?.checked === true,
        hint: $('gm-auth-carbon-hint')?.checked === true,
        'hard-mode': $('gm-auth-carbon-hard')?.checked === true,
      },
      timeout: readNumber('gm-auth-timeout', 180, 30, 1800),
      recall: $('gm-auth-recall')?.checked === true,
      frequency: readNumber('gm-auth-frequency', 5, 1, 20),
      autoApprove: {
        enable: $('gm-auto-approve-enable')?.checked === true,
        minQqLevel: readNumber('gm-auto-min-qq-level', 0, 0, 255),
        minAge: readNumber('gm-auto-min-age', 0, 0, 150),
        commentKeywords: readLines('gm-auto-comment-keywords'),
        blockedKeywords: readLines('gm-auto-blocked-keywords'),
        customRules: readLines('gm-auto-custom-rules'),
        risk: {
          enabled: $('gm-auto-risk-enabled')?.checked === true,
          scoreEnabled: $('gm-auto-risk-score-enabled')?.checked === true,
          blockBlacklistAutoApprove: $('gm-auto-risk-block-blacklist')?.checked === true,
          autoApproveWhitelisted: $('gm-auto-risk-auto-whitelist')?.checked === true,
          holdHighRisk: $('gm-auto-risk-hold-high')?.checked === true,
          highRiskScore: readNumber('gm-auto-risk-high-score', 70, 1, 100),
          warningBlockThreshold: readNumber('gm-auto-risk-warning-threshold', 3, 0, 100),
        },
      },
    },
    moderation: {
      blacklist: readLines('gm-moderation-blacklist'),
      whitelist: readLines('gm-moderation-whitelist'),
      content: {
        enabled: $('gm-content-enabled')?.checked === true,
        exemptAdmins: $('gm-content-exempt-admins')?.checked === true,
        detectLinks: $('gm-content-detect-links')?.checked === true,
        detectBlockedKeywords: $('gm-content-detect-keywords')?.checked === true,
        blockedKeywords: readLines('gm-content-blocked-keywords'),
        repeatLimit: readNumber('gm-content-repeat-limit', 4, 2, 20),
        repeatWindowSeconds: readNumber('gm-content-repeat-window', 45, 5, 600),
        burstLimit: readNumber('gm-content-burst-limit', 8, 2, 60),
        burstWindowSeconds: readNumber('gm-content-burst-window', 20, 5, 600),
        observeNewMembers: $('gm-content-observe-new')?.checked === true,
        observeMinutes: readNumber('gm-content-observe-minutes', 60, 1, 10080),
        observeBlockLinks: $('gm-content-observe-block-links')?.checked === true,
        action: $('gm-content-action')?.value || 'log',
        muteSeconds: readNumber('gm-content-mute-seconds', 600, 60, 2592000),
        addWarning: $('gm-content-add-warning')?.checked === true,
      },
    },
    welcome,
  };
}

async function refreshGroupManagement(options = {}) {
  const keepMessage = options.keepMessage === true;
  if (!keepMessage) hideMessages();
  setStatus('正在刷新群数据...');
  const previousSelectedId = groupManagementState.selectedGroupId;
  const url = previousSelectedId
    ? `/api/group-management?groupId=${encodeURIComponent(previousSelectedId)}`
    : '/api/group-management';
  const payload = await fetchJson(url);
  groupManagementState.payload = payload;
  if (!groupManagementState.selectedGroupId) {
    groupManagementState.selectedGroupId = payload.selectedGroupId || payload.groups?.[0]?.groupId || '';
  }
  if (
    groupManagementState.selectedGroupId
    && !(payload.groups || []).some(item => item.groupId === groupManagementState.selectedGroupId)
  ) {
    groupManagementState.selectedGroupId = payload.groups?.[0]?.groupId || '';
  }
  if (groupManagementState.selectedGroupId !== previousSelectedId) {
    resetWelcomeImageDraft();
  }
  renderSummary();
  renderHealthPanel();
  renderSafetyPanel();
  renderDefaultsPanel();
  renderBulkPanel();
  renderGroupList();
  renderDetail();
  await loadJoinRequests(groupManagementState.joinRequestPage);
  await loadTitleApplications(groupManagementState.titleApplicationPage);
  await refreshGroupManagementLogs(groupManagementState.logPage);
  await refreshGroupManagementEventStreamNow({ reset: true });
}

async function saveSafetySettings() {
  hideMessages();
  if (groupManagementState.payload?.readOnly === true) {
    showRisk('控制台处于只读模式，不能保存。');
    return;
  }
  const payload = buildSafetySavePayload();
  if (
    payload.safety.allowAutoKick
    && !await confirmGroupManagementModal('确认允许群消息风控自动踢人？该开关会全局生效。', { title: '放行自动踢人' })
  ) {
    return;
  }
  try {
    const result = await postJson('/api/group-management/safety/save', payload);
    groupManagementState.payload = result;
    groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId;
    showSuccess(result.message || '群管安全开关已保存');
    renderSummary();
    renderHealthPanel();
    renderSafetyPanel();
    renderDefaultsPanel();
    renderBulkPanel();
    renderGroupList();
    renderDetail();
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
  } catch (error) {
    showRisk(`保存安全开关失败：${error.message}`);
  }
}

async function saveDefaultSettings() {
  hideMessages();
  if (groupManagementState.payload?.readOnly === true) {
    showRisk('控制台处于只读模式，不能保存。');
    return;
  }
  const payload = buildDefaultsSavePayload();
  if (!await confirmGroupSaveSafety(payload)) {
    return;
  }
  try {
    const result = await postJson('/api/group-management/defaults/save', payload);
    groupManagementState.payload = result;
    groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId;
    showSuccess(result.message || '群管理默认设置已保存');
    renderSummary();
    renderHealthPanel();
    renderSafetyPanel();
    renderDefaultsPanel();
    renderBulkPanel();
    renderGroupList();
    renderDetail();
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
  } catch (error) {
    showRisk(`保存默认设置失败：${error.message}`);
  }
}

async function saveCurrentGroup(extraPayload = null) {
  hideMessages();
  if (groupManagementState.payload?.readOnly === true) {
    showRisk('控制台处于只读模式，不能保存。');
    return;
  }
  try {
    const payload = extraPayload || (await buildSavePayload());
    if (!extraPayload && !await confirmGroupSaveDiff(payload)) {
      return;
    }
    if (!await confirmGroupSaveSafety(payload)) {
      return;
    }
    const result = await postJson('/api/group-management/save', payload);
    groupManagementState.payload = result;
    groupManagementState.selectedGroupId = result.selectedGroupId || payload.groupId;
    if (payload.welcome && typeof payload.welcome === 'object' && !Array.isArray(payload.welcome)) {
      resetWelcomeImageDraft();
    }
    showSuccess(result.message || '群配置已保存');
    renderSummary();
    renderHealthPanel();
    renderSafetyPanel();
    renderDefaultsPanel();
    renderBulkPanel();
    renderGroupList();
    renderDetail();
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
  } catch (error) {
    showRisk(`保存失败：${error.message}`);
  }
}

async function applyBulkEnableGroups() {
  hideMessages();
  if (groupManagementState.payload?.readOnly === true) {
    showRisk('控制台处于只读模式，不能保存。');
    return;
  }
  const groupIds = getBulkSelectedGroupIds();
  if (groupIds.length <= 0) {
    showRisk('请先勾选要开启的群。');
    return;
  }
  const feature = getBulkFeature();
  const featureLabel = GROUP_MANAGEMENT_BULK_FEATURES[feature]?.label || '所选功能';
  if (!await confirmGroupManagementModal(`确认给 ${groupIds.length} 个群开启${featureLabel}？`, { title: '批量开启群功能' })) {
    return;
  }
  try {
    const result = await postJson('/api/group-management/bulk-enable', {
      feature,
      groupIds,
      selectedGroupId: groupManagementState.selectedGroupId,
    });
    groupManagementState.payload = result;
    groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId || groupIds[0] || '';
    showSuccess(result.message || '已批量开启所选群');
    renderSummary();
    renderHealthPanel();
    renderSafetyPanel();
    renderDefaultsPanel();
    renderBulkPanel();
    renderGroupList();
    renderDetail();
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
  } catch (error) {
    showRisk(`批量开启失败：${error.message}`);
  }
}

async function loadMembers(page = 1) {
  const group = getSelectedGroup();
  if (!group) return;
  const query = String($('group-management-member-search')?.value || '').trim();
  groupManagementState.memberQuery = query;
  groupManagementState.memberPage = page;
  groupManagementState.memberPayload = { pending: true };
  renderMembers();
  try {
    groupManagementState.memberPayload = await fetchJson(
      `/api/group-management/members?groupId=${encodeURIComponent(group.groupId)}&query=${encodeURIComponent(query)}&page=${encodeURIComponent(page)}`,
    );
  } catch (error) {
    groupManagementState.memberPayload = { success: false, error: error.message };
  }
  renderMembers();
}

async function loadJoinRequests(page = 1) {
  const group = getSelectedGroup();
  if (!group) return;
  const query = String($('group-management-join-request-search')?.value || '').trim();
  groupManagementState.joinRequestQuery = query;
  groupManagementState.joinRequestPage = page;
  groupManagementState.joinRequestPayload = { pending: true };
  renderJoinRequests();
  try {
    const params = new URLSearchParams({
      groupId: group.groupId,
      status: 'pending',
      query,
      page: String(page),
      pageSize: '10',
    });
    groupManagementState.joinRequestPayload = await fetchJson(`/api/group-management/join-requests?${params.toString()}`);
  } catch (error) {
    groupManagementState.joinRequestPayload = { success: false, error: error.message };
  }
  renderJoinRequests();
}

async function loadTitleApplications(page = 1) {
  const group = getSelectedGroup();
  if (!group) return;
  const query = String($('group-management-title-application-search')?.value || '').trim();
  const status = String($('group-management-title-application-status')?.value || groupManagementState.titleApplicationStatus || 'pending').trim();
  groupManagementState.titleApplicationQuery = query;
  groupManagementState.titleApplicationStatus = ['pending', 'failed', 'approved', 'rejected', 'cancelled', 'expired', 'all'].includes(status)
    ? status
    : 'pending';
  groupManagementState.titleApplicationPage = page;
  groupManagementState.titleApplicationPayload = { pending: true };
  renderTitleApplications();
  try {
    const params = new URLSearchParams({
      groupId: group.groupId,
      status: groupManagementState.titleApplicationStatus,
      query,
      page: String(page),
      pageSize: '10',
    });
    groupManagementState.titleApplicationPayload = await fetchJson(`/api/group-management/title-applications?${params.toString()}`);
  } catch (error) {
    groupManagementState.titleApplicationPayload = { success: false, error: error.message };
  }
  renderTitleApplications();
}

function renderPagination(containerId, page, totalPages, actionName) {
  const container = $(containerId);
  if (!container) return;
  const current = Number(page || 1);
  const total = Math.max(1, Number(totalPages || 1));
  if (total <= 1) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <button class="mini-btn" data-action="${escapeHtml(actionName)}" data-page="${Math.max(1, current - 1)}" ${current <= 1 ? 'disabled' : ''}>上一页</button>
    <span>${formatNumber(current)} / ${formatNumber(total)}</span>
    <button class="mini-btn" data-action="${escapeHtml(actionName)}" data-page="${Math.min(total, current + 1)}" ${current >= total ? 'disabled' : ''}>下一页</button>
  `;
}

function renderJoinRequests() {
  const meta = $('group-management-join-requests-meta');
  const box = $('group-management-join-requests');
  if (!meta || !box) return;
  const payload = groupManagementState.joinRequestPayload;
  if (!payload) {
    meta.textContent = '点击刷新申请列表。';
    box.innerHTML = '尚未读取。';
    $('group-management-join-request-pagination').innerHTML = '';
    return;
  }
  if (payload.pending) {
    meta.textContent = '正在读取加群申请...';
    box.innerHTML = '<div class="list-item">读取中...</div>';
    $('group-management-join-request-pagination').innerHTML = '';
    return;
  }
  if (payload.success === false) {
    meta.textContent = '加群申请读取失败';
    box.innerHTML = `<div class="list-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    $('group-management-join-request-pagination').innerHTML = '';
    return;
  }

  meta.textContent = `待处理申请 ${formatNumber(payload.total || 0)} 条`;
  box.innerHTML = (payload.items || []).length > 0
    ? payload.items.map((item) => {
        const risk = item.risk?.enabled === false ? null : item.risk || null;
        return `
          <div class="list-item group-management-join-request-item">
            <div class="group-management-join-request-main">
              <div>
                <h3>${escapeHtml(item.nickname || item.userId || item.user_id || '未知用户')}</h3>
                <div class="setting-help">QQ ${escapeHtml(item.userId || item.user_id || '暂无')} / ${escapeHtml(formatDateTime(item.createdAt || item.updatedAt))}</div>
              </div>
              <div class="detail-tags">
                <span class="detail-tag tone-warning">待审核</span>
                ${risk ? `<span class="detail-tag ${getRiskTagTone(risk.level)}">${getRiskLevelLabel(risk.level)} ${escapeHtml(formatNumber(risk.score || 0))}</span>` : ''}
                ${item.qqLevel != null ? `<span class="detail-tag">QQ等级 ${escapeHtml(item.qqLevel)}</span>` : ''}
                ${item.age != null ? `<span class="detail-tag">年龄 ${escapeHtml(item.age)}</span>` : ''}
              </div>
            </div>
            <div class="log-entry-preview">
              <div class="log-entry-label">申请理由</div>
              <div class="log-entry-text">${escapeHtml(item.comment || '暂无')}</div>
            </div>
            <div class="log-entry-preview">
              <div class="log-entry-label">保留原因</div>
              <div class="log-entry-text">${escapeHtml(item.error || item.reason || '等待人工审核')}</div>
            </div>
            ${risk && Array.isArray(risk.reasons) && risk.reasons.length > 0 ? `
              <div class="log-entry-preview">
                <div class="log-entry-label">风险信号</div>
                <div class="group-management-risk-reasons">${risk.reasons.map(reason => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
              </div>
            ` : ''}
            <div class="actions">
              <button type="button" class="mini-btn" data-action="approve-join-request" data-request-id="${escapeHtml(item.id || '')}">同意入群</button>
              <button type="button" class="mini-btn" data-action="approve-join-request-whitelist" data-request-id="${escapeHtml(item.id || '')}">同意并加白</button>
              <button type="button" class="mini-btn danger" data-action="reject-join-request" data-request-id="${escapeHtml(item.id || '')}">拒绝</button>
              <button type="button" class="mini-btn danger" data-action="reject-join-request-blacklist" data-request-id="${escapeHtml(item.id || '')}">拒绝并拉黑</button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="list-item">暂无待处理加群申请。</div>';
  renderPagination('group-management-join-request-pagination', payload.page, payload.totalPages, 'join-request-page');
}

function getTitleApplicationStatusLabel(status = '') {
  const labels = {
    pending: '待审核',
    approved: '已通过',
    rejected: '已拒绝',
    failed: '发放失败',
    cancelled: '已取消',
    expired: '已过期',
  };
  return labels[String(status || '').trim()] || '未知';
}

function getTitleApplicationStatusTone(status = '') {
  const value = String(status || '').trim();
  if (value === 'approved') return 'tone-success';
  if (value === 'pending' || value === 'failed') return 'tone-warning';
  if (value === 'rejected') return 'tone-error';
  return '';
}

function renderTitleApplications() {
  const meta = $('group-management-title-applications-meta');
  const box = $('group-management-title-applications');
  const pagination = $('group-management-title-application-pagination');
  if (!meta || !box || !pagination) return;
  const payload = groupManagementState.titleApplicationPayload;
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  if (!payload) {
    meta.textContent = '点击刷新头衔申请列表。';
    box.innerHTML = '尚未读取。';
    pagination.innerHTML = '';
    return;
  }
  if (payload.pending) {
    meta.textContent = '正在读取头衔申请...';
    box.innerHTML = '<div class="list-item">读取中...</div>';
    pagination.innerHTML = '';
    return;
  }
  if (payload.success === false) {
    meta.textContent = '头衔申请读取失败';
    box.innerHTML = `<div class="list-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    pagination.innerHTML = '';
    return;
  }

  const statusLabel = groupManagementState.titleApplicationStatus === 'all'
    ? '全部'
    : getTitleApplicationStatusLabel(groupManagementState.titleApplicationStatus);
  meta.textContent = `${statusLabel}头衔申请 ${formatNumber(payload.total || 0)} 条`;
  box.innerHTML = (payload.items || []).length > 0
    ? payload.items.map((item) => {
        const status = String(item.status || 'pending');
        const canReview = status === 'pending' || status === 'failed';
        return `
          <div class="list-item group-management-title-application-item">
            <div class="group-management-join-request-main">
              <div>
                <h3>${escapeHtml(item.title || '未命名头衔')}</h3>
                <div class="setting-help">编号 ${escapeHtml(item.id || '')} / QQ ${escapeHtml(item.userId || '')} / ${escapeHtml(item.nickname || '无昵称')}</div>
              </div>
              <div class="detail-tags">
                <span class="detail-tag ${getTitleApplicationStatusTone(status)}">${escapeHtml(getTitleApplicationStatusLabel(status))}</span>
                ${item.forbiddenKeyword ? `<span class="detail-tag tone-error">禁用词 ${escapeHtml(item.forbiddenKeyword)}</span>` : ''}
                <span class="detail-tag">${escapeHtml(formatDateTime(item.updatedAt || item.createdAt))}</span>
              </div>
            </div>
            <div class="log-entry-preview">
              <div class="log-entry-label">申请头衔</div>
              <div class="log-entry-text">${escapeHtml(item.title || '')}</div>
            </div>
            ${(item.reason || item.error || item.reviewerName) ? `
              <div class="log-entry-preview">
                <div class="log-entry-label">审核信息</div>
                <div class="log-entry-text">${escapeHtml([item.reviewerName, item.reason, item.error].filter(Boolean).join(' / ') || '暂无')}</div>
              </div>
            ` : ''}
            ${item.forbiddenKeyword ? `
              <div class="group-management-safety-note">该头衔命中禁用词“${escapeHtml(item.forbiddenKeyword)}”，控制台会阻止通过发放。</div>
            ` : ''}
            <div class="actions">
              <button type="button" class="mini-btn" data-action="approve-title-application" data-application-id="${escapeHtml(item.id || '')}" ${canReview ? disabledAttr : 'disabled'}>通过并发放</button>
              <button type="button" class="mini-btn danger" data-action="reject-title-application" data-application-id="${escapeHtml(item.id || '')}" ${canReview ? disabledAttr : 'disabled'}>拒绝</button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="list-item">暂无头衔申请。</div>';
  renderPagination('group-management-title-application-pagination', payload.page, payload.totalPages, 'title-application-page');
}

function renderMembers() {
  const meta = $('group-management-members-meta');
  const box = $('group-management-members');
  if (!meta || !box) return;
  const payload = groupManagementState.memberPayload;
  if (!payload) {
    meta.textContent = '点击读取成员列表。';
    box.innerHTML = '尚未读取。';
    $('group-management-member-pagination').innerHTML = '';
    return;
  }
  if (payload.pending) {
    meta.textContent = '正在读取成员列表...';
    box.innerHTML = '<div class="list-item">读取中...</div>';
    $('group-management-member-pagination').innerHTML = '';
    return;
  }
  if (payload.success === false) {
    meta.textContent = '成员列表读取失败';
    box.innerHTML = `<div class="list-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    $('group-management-member-pagination').innerHTML = '';
    return;
  }

  const warnings = (payload.warnings || []).length > 0 ? ` / ${payload.warnings[0]}` : '';
  meta.textContent = `成员 ${formatNumber(payload.total || 0)} 人 / 来源 ${payload.source || '未识别'}${warnings}`;
  box.innerHTML = (payload.items || []).length > 0
    ? payload.items.map(member => `
      <div class="list-item group-management-member-item">
        <div>
          <h3>${escapeHtml(member.card || member.nickname || member.userId)}</h3>
          <div class="setting-help">QQ ${escapeHtml(member.userId)} / ${escapeHtml(member.nickname || '无昵称')}</div>
        </div>
        <div class="detail-tags">
          <span class="detail-tag">${escapeHtml(member.role || 'member')}</span>
          <span class="detail-tag">入群 ${escapeHtml(formatUnixTime(member.joinTime))}</span>
          <span class="detail-tag">发言 ${escapeHtml(formatUnixTime(member.lastSentTime))}</span>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">没有成员数据或当前适配器不支持读取成员列表。</div>';
  renderPagination('group-management-member-pagination', payload.page, payload.totalPages, 'member-page');
}

function buildGroupManagementLogUrl(page = 1) {
  const params = new URLSearchParams();
  const groupId = groupManagementState.selectedGroupId;
  if (groupId) params.set('groupId', groupId);
  if (groupManagementState.logQuery) params.set('query', groupManagementState.logQuery);
  params.set('page', String(page));
  params.set('pageSize', '10');
  return `/api/logs/group-management?${params.toString()}`;
}

function renderGroupManagementLogs() {
  const meta = $('group-management-log-meta');
  const box = $('group-management-log-list');
  if (!meta || !box) return;
  const payload = groupManagementState.logPayload;
  if (!groupManagementState.selectedGroupId) {
    meta.textContent = '请选择一个群后查看对应日志。';
    box.innerHTML = '<div class="list-item">请选择一个群。</div>';
    $('group-management-log-pagination').innerHTML = '';
    return;
  }
  if (!payload) {
    meta.textContent = '正在读取群管理日志...';
    box.innerHTML = '<div class="list-item">日志加载中...</div>';
    $('group-management-log-pagination').innerHTML = '';
    return;
  }
  if (payload.pending) {
    meta.textContent = '正在读取群管理日志...';
    box.innerHTML = '<div class="list-item">日志加载中...</div>';
    $('group-management-log-pagination').innerHTML = '';
    return;
  }
  if (payload.success === false) {
    meta.textContent = '群管理日志读取失败';
    box.innerHTML = `<div class="list-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    $('group-management-log-pagination').innerHTML = '';
    return;
  }

  const groupId = groupManagementState.selectedGroupId;
  meta.textContent = `群 ${groupId} 日志 ${formatNumber(payload.total || 0)} 条 / 第 ${formatNumber(payload.page || 1)} 页`;
  box.innerHTML = (payload.items || []).length > 0
    ? payload.items.map(item => {
        const changes = Array.isArray(item.changes) && item.changes.length > 0
          ? item.changes.join('；')
          : (item.reason || item.error || '暂无详情');
        const sections = Array.isArray(item.sections) && item.sections.length > 0 ? item.sections.join(', ') : item.source || 'runtime';
        return `
          <div class="list-item group-management-log-entry ${item.success === false ? 'tone-error' : ''}">
            <div class="group-management-log-head">
              <div>
                <h3>${escapeHtml(item.action_label || item.action || '未知操作')}</h3>
                <div class="setting-help">${escapeHtml(formatDateTime(item.time))}</div>
              </div>
              <div class="detail-tags">
                <span class="detail-tag ${item.success === false ? 'tone-error' : 'tone-success'}">${item.success === false ? '失败' : '成功'}</span>
                <span class="detail-tag">${escapeHtml(sections)}</span>
              </div>
            </div>
            <div class="group-management-log-meta">
              <span>群 ${escapeHtml(item.group_id || groupId)}</span>
              <span>用户 ${escapeHtml(item.user_id || '暂无')}</span>
              <span>来源 ${escapeHtml(item.source || 'runtime')}</span>
              ${item.client_ip ? `<span>IP ${escapeHtml(item.client_ip)}</span>` : ''}
            </div>
            <div class="log-entry-preview">
              <div class="log-entry-label">详情</div>
              <div class="log-entry-text">${escapeHtml(changes)}</div>
            </div>
            ${item.comment_preview ? `
              <div class="log-entry-preview">
                <div class="log-entry-label">申请理由</div>
                <div class="log-entry-text">${escapeHtml(item.comment_preview)}</div>
              </div>
            ` : ''}
            <div class="group-management-log-actions">
              <button type="button" class="mini-btn" data-action="convert-log-scenario" data-log-id="${escapeHtml(item.id || '')}">转模拟器场景</button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="list-item">暂无群管理日志。</div>';
  renderPagination('group-management-log-pagination', payload.page, payload.totalPages, 'group-log-page');
}

async function convertGroupManagementLogToScenario(logId = '') {
  const id = String(logId || '').trim();
  if (!id) {
    showRisk('这条日志缺少可转换的 ID。');
    return;
  }
  const entry = (groupManagementState.logPayload?.items || []).find(item => item.id === id) || null;
  try {
    const result = await postJson('/api/group-management/log-to-scenario', { id, entry, save: true });
    const scenarioId = result?.scenario?.id || '';
    showSuccess(result.message || '已转为 QQ 模拟器场景。');
    if (scenarioId) {
      window.open(`/qq-simulator.html?scenarioId=${encodeURIComponent(scenarioId)}`, '_blank', 'noopener');
    }
  } catch (error) {
    showRisk(`转模拟器场景失败：${error.message}`);
  }
}

async function refreshGroupManagementLogs(page = groupManagementState.logPage) {
  if (!$('group-management-log-list')) return;
  groupManagementState.logPage = Math.max(1, Number(page || 1));
  groupManagementState.logPayload = { pending: true };
  renderGroupManagementLogs();
  if (!groupManagementState.selectedGroupId) return;
  try {
    groupManagementState.logPayload = await fetchJson(buildGroupManagementLogUrl(groupManagementState.logPage));
  } catch (error) {
    groupManagementState.logPayload = { success: false, error: error.message };
  }
  renderGroupManagementLogs();
}

function getGroupManagementEventTone(type = '', success = true) {
  if (success === false) return 'tone-error';
  const value = String(type || '').trim();
  if (value === 'moderation' || value === 'join' || value === 'title') return 'tone-warning';
  if (value === 'welcome' || value === 'summary') return 'tone-success';
  return '';
}

function getGroupManagementEventDetail(item = {}) {
  if (Array.isArray(item.changes) && item.changes.length > 0) {
    return item.changes.join('；');
  }
  if (item.reason) return item.reason;
  if (item.error) return item.error;
  if (item.comment_preview) return item.comment_preview;
  const summary = item.summary && typeof item.summary === 'object' && !Array.isArray(item.summary)
    ? Object.entries(item.summary)
        .filter(([, value]) => value !== undefined && value !== '')
        .slice(0, 4)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('、') : value}`)
        .join('；')
    : '';
  return summary || '暂无详情';
}

function getGroupManagementEventKey(item = {}) {
  return [
    item.id,
    item.time,
    item.action,
    item.group_id || item.groupId,
    item.user_id || item.userId,
    item.reason,
    item.error,
    item.comment_preview,
  ].map(value => String(value || '')).join('|');
}

function pruneGroupManagementEventUnreadKeys() {
  const visibleKeys = new Set((groupManagementState.eventItems || []).map(item => getGroupManagementEventKey(item)));
  for (const key of Array.from(groupManagementState.eventUnreadKeys || [])) {
    if (!visibleKeys.has(key)) {
      groupManagementState.eventUnreadKeys.delete(key);
    }
  }
}

function renderGroupManagementEventStream() {
  const box = $('group-management-event-stream');
  if (!box) return;
  const payload = groupManagementState.eventPayload;
  const toggleButton = $('group-management-event-toggle-btn');
  const typeSelect = $('group-management-event-type');
  const scopeCheckbox = $('group-management-event-current-group');
  const failedOnlyCheckbox = $('group-management-event-failed-only');
  if (toggleButton) {
    toggleButton.textContent = groupManagementState.eventAutoRefresh ? '暂停自动刷新' : '继续自动刷新';
  }
  if (typeSelect) typeSelect.value = groupManagementState.eventType || 'all';
  if (scopeCheckbox instanceof HTMLInputElement) scopeCheckbox.checked = groupManagementState.eventCurrentGroupOnly !== false;
  if (failedOnlyCheckbox instanceof HTMLInputElement) failedOnlyCheckbox.checked = groupManagementState.eventFailedOnly === true;

  if (payload?.pending) {
    setEventStatus('正在读取实时事件...');
    box.innerHTML = '<div class="group-management-empty">事件加载中...</div>';
    return;
  }
  if (payload?.success === false) {
    setEventStatus('实时事件读取失败');
    box.innerHTML = `<div class="group-management-event-item tone-error">${escapeHtml(payload.error || '未知错误')}</div>`;
    return;
  }

  const allItems = groupManagementState.eventItems || [];
  const items = groupManagementState.eventFailedOnly
    ? allItems.filter(item => item.success === false)
    : allItems;
  const scopeText = groupManagementState.eventCurrentGroupOnly && groupManagementState.selectedGroupId
    ? `当前群 ${groupManagementState.selectedGroupId}`
    : '全部群';
  const statusText = groupManagementState.eventAutoRefresh ? '自动刷新中' : '已暂停';
  const unreadCount = allItems.filter(item => groupManagementState.eventUnreadKeys.has(getGroupManagementEventKey(item))).length;
  const failedCount = allItems.filter(item => item.success === false).length;
  setEventStatus(`${statusText} / ${scopeText} / 显示 ${formatNumber(items.length)} 条 / 未读 ${formatNumber(unreadCount)} / 失败 ${formatNumber(failedCount)}`);
  box.innerHTML = items.length > 0
    ? items.map((item) => {
        const type = item.eventType || 'config';
        const tone = getGroupManagementEventTone(type, item.success !== false);
        const detail = getGroupManagementEventDetail(item);
        const actor = [item.nickname, item.user_id || item.userId].filter(Boolean).join(' / ') || '暂无用户';
        const sections = Array.isArray(item.sections) && item.sections.length > 0 ? item.sections.join(', ') : item.source || 'runtime';
        const unread = groupManagementState.eventUnreadKeys.has(getGroupManagementEventKey(item));
        return `
          <div class="group-management-event-item ${escapeHtml(tone)} ${unread ? 'is-unread' : ''}">
            <div class="group-management-event-line">
              <div>
                <strong>${escapeHtml(item.action_label || item.action || '未知事件')}</strong>
                <span>${escapeHtml(formatDateTime(item.time))}</span>
              </div>
              <div class="detail-tags">
                ${unread ? '<span class="detail-tag tone-warning">新</span>' : ''}
                <span class="detail-tag ${escapeHtml(tone)}">${escapeHtml(item.eventTypeLabel || '事件')}</span>
                <span class="detail-tag ${item.success === false ? 'tone-error' : 'tone-success'}">${item.success === false ? '失败' : '成功'}</span>
              </div>
            </div>
            <div class="group-management-event-meta">
              <span>群 ${escapeHtml(item.group_id || item.groupId || '暂无')}</span>
              <span>用户 ${escapeHtml(actor)}</span>
              <span>来源 ${escapeHtml(sections)}</span>
            </div>
            <div class="group-management-event-detail">${escapeHtml(detail)}</div>
          </div>
        `;
      }).join('')
    : '<div class="group-management-empty">暂无事件。开启自动刷新后，新触发的风控、申请、欢迎、总结和头衔事件会显示在这里。</div>';
}

function buildGroupManagementEventUrl(options = {}) {
  const params = new URLSearchParams();
  const incremental = options.incremental === true;
  const groupId = groupManagementState.eventCurrentGroupOnly ? groupManagementState.selectedGroupId : '';
  if (groupId) params.set('groupId', groupId);
  params.set('type', groupManagementState.eventType || 'all');
  params.set('limit', incremental ? '30' : '40');
  if (incremental && groupManagementState.eventSince) {
    params.set('since', groupManagementState.eventSince);
  }
  return `/api/group-management/events?${params.toString()}`;
}

function buildGroupManagementEventStreamUrl() {
  const params = new URLSearchParams();
  const groupId = groupManagementState.eventCurrentGroupOnly ? groupManagementState.selectedGroupId : '';
  if (groupId) params.set('groupId', groupId);
  params.set('type', groupManagementState.eventType || 'all');
  params.set('limit', '40');
  params.set('stream', '1');
  return `/api/group-management/events?${params.toString()}`;
}

function addGroupManagementEventItems(items = [], options = {}) {
  const incoming = Array.isArray(items) ? items : [];
  const seen = new Set((groupManagementState.eventItems || []).map(item => getGroupManagementEventKey(item)));
  const fresh = incoming.filter(item => {
    const key = getGroupManagementEventKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) return 0;
  if (options.unread !== false) {
    fresh.forEach(item => groupManagementState.eventUnreadKeys.add(getGroupManagementEventKey(item)));
  }
  groupManagementState.eventItems = [...fresh, ...(groupManagementState.eventItems || [])].slice(0, 80);
  pruneGroupManagementEventUnreadKeys();
  return fresh.length;
}

function resetGroupManagementEventStream(options = {}) {
  groupManagementState.eventPayload = null;
  groupManagementState.eventSince = '';
  if (options.keepItems !== true) {
    groupManagementState.eventItems = [];
  }
  if (options.keepUnread !== true) {
    groupManagementState.eventUnreadKeys.clear();
  }
  renderGroupManagementEventStream();
}

async function refreshGroupManagementEventStream(options = {}) {
  if (!$('group-management-event-stream')) return;
  if (groupManagementState.eventLoading) return;
  const reset = options.reset === true;
  const incremental = options.incremental === true && !reset;
  groupManagementState.eventLoading = true;
  if (reset) {
    groupManagementState.eventPayload = { pending: true };
    groupManagementState.eventItems = [];
    groupManagementState.eventSince = '';
    renderGroupManagementEventStream();
  }
  try {
    const payload = await fetchJson(buildGroupManagementEventUrl({ incremental }));
    const incoming = Array.isArray(payload.items) ? payload.items : [];
    if (incremental) {
      addGroupManagementEventItems(incoming, { unread: true });
    } else {
      groupManagementState.eventItems = incoming.slice(0, 80);
      groupManagementState.eventUnreadKeys.clear();
    }
    groupManagementState.eventPayload = payload;
    groupManagementState.eventSince = payload.nextSince || groupManagementState.eventSince || new Date().toISOString();
  } catch (error) {
    groupManagementState.eventPayload = { success: false, error: error.message };
  } finally {
    groupManagementState.eventLoading = false;
    renderGroupManagementEventStream();
  }
}

function stopGroupManagementEventTimer() {
  if (groupManagementState.eventTimer) {
    clearInterval(groupManagementState.eventTimer);
    groupManagementState.eventTimer = null;
  }
  if (groupManagementState.eventReconnectTimer) {
    clearTimeout(groupManagementState.eventReconnectTimer);
    groupManagementState.eventReconnectTimer = null;
  }
  if (groupManagementState.eventSource) {
    groupManagementState.eventSource.close();
    groupManagementState.eventSource = null;
  }
}

function startGroupManagementEventTimer() {
  stopGroupManagementEventTimer();
  if (groupManagementState.eventAutoRefresh !== true || !$('group-management-event-stream')) return;
  if (typeof EventSource === 'function') {
    const source = new EventSource(buildGroupManagementEventStreamUrl());
    groupManagementState.eventSource = source;
    source.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        groupManagementState.eventPayload = payload;
        groupManagementState.eventItems = Array.isArray(payload.items) ? payload.items.slice(0, 80) : [];
        groupManagementState.eventSince = payload.nextSince || groupManagementState.eventSince || new Date().toISOString();
        groupManagementState.eventUnreadKeys.clear();
        renderGroupManagementEventStream();
      } catch {}
    });
    source.addEventListener('event', (event) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if (payload.item) {
          addGroupManagementEventItems([payload.item], { unread: true });
          groupManagementState.eventSince = payload.nextSince || payload.item.time || groupManagementState.eventSince;
          groupManagementState.eventPayload = { success: true };
          renderGroupManagementEventStream();
        }
      } catch {}
    });
    source.onerror = () => {
      if (groupManagementState.eventSource !== source) return;
      source.close();
      groupManagementState.eventSource = null;
      groupManagementState.eventReconnectTimer = setTimeout(() => {
        if (groupManagementState.eventAutoRefresh === true) {
          startGroupManagementEventTimer();
        }
      }, 5000);
    };
    return;
  }
  groupManagementState.eventTimer = setInterval(() => {
    if (document.hidden) return;
    refreshGroupManagementEventStream({ incremental: true }).catch(() => {});
  }, 5000);
}

async function refreshGroupManagementEventStreamNow(options = {}) {
  if (options.reset === true) {
    stopGroupManagementEventTimer();
  }
  await refreshGroupManagementEventStream(options);
  startGroupManagementEventTimer();
}

function syncConflictCheckboxes(target) {
  const pairs = [
    ['gm-ai-blocked', 'gm-ai-whitelisted'],
    ['gm-image-allowed', 'gm-image-blocked'],
    ['gm-summary-allowed', 'gm-summary-blocked'],
  ];
  for (const [left, right] of pairs) {
    if (target.id === left && target.checked) {
      const other = $(right);
      if (other) other.checked = false;
    }
    if (target.id === right && target.checked) {
      const other = $(left);
      if (other) other.checked = false;
    }
  }
}

function setChecked(id, value) {
  const el = $(id);
  if (el instanceof HTMLInputElement) el.checked = Boolean(value);
}

function setInputValue(id, value) {
  const el = $(id);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = String(value ?? '');
  }
}

function applyRuleTemplateToForm(templateKey = '') {
  const template = GROUP_MANAGEMENT_RULE_TEMPLATES[templateKey] || GROUP_MANAGEMENT_RULE_TEMPLATES.relaxed;
  const auto = template.autoApprove || {};
  const risk = auto.risk || {};
  const content = template.content || {};

  setChecked('gm-auto-approve-enable', auto.enable === true);
  setInputValue('gm-auto-min-qq-level', auto.minQqLevel || 0);
  setInputValue('gm-auto-min-age', auto.minAge || 0);
  setInputValue('gm-auto-comment-keywords', (auto.commentKeywords || []).join('\n'));
  setInputValue('gm-auto-blocked-keywords', (auto.blockedKeywords || []).join('\n'));
  setInputValue('gm-auto-custom-rules', (auto.customRules || []).join('\n'));
  setChecked('gm-auto-risk-enabled', risk.enabled !== false);
  setChecked('gm-auto-risk-score-enabled', risk.scoreEnabled !== false);
  setChecked('gm-auto-risk-block-blacklist', risk.blockBlacklistAutoApprove !== false);
  setChecked('gm-auto-risk-auto-whitelist', risk.autoApproveWhitelisted !== false);
  setChecked('gm-auto-risk-hold-high', risk.holdHighRisk === true);
  setInputValue('gm-auto-risk-high-score', risk.highRiskScore || 70);
  setInputValue('gm-auto-risk-warning-threshold', risk.warningBlockThreshold ?? 3);

  setChecked('gm-content-enabled', content.enabled === true);
  setChecked('gm-content-exempt-admins', content.exemptAdmins !== false);
  setChecked('gm-content-detect-links', content.detectLinks !== false);
  setChecked('gm-content-detect-keywords', content.detectBlockedKeywords !== false);
  setInputValue('gm-content-blocked-keywords', (content.blockedKeywords || []).join('\n'));
  setInputValue('gm-content-repeat-limit', content.repeatLimit || 4);
  setInputValue('gm-content-repeat-window', content.repeatWindowSeconds || 45);
  setInputValue('gm-content-burst-limit', content.burstLimit || 8);
  setInputValue('gm-content-burst-window', content.burstWindowSeconds || 20);
  setInputValue('gm-content-action', content.action || 'log');
  setInputValue('gm-content-mute-seconds', content.muteSeconds || 600);
  setChecked('gm-content-add-warning', content.addWarning === true);
  setChecked('gm-content-observe-new', content.observeNewMembers !== false);
  setChecked('gm-content-observe-block-links', content.observeBlockLinks !== false);
  setInputValue('gm-content-observe-minutes', content.observeMinutes || 60);
  showSuccess(`已填入“${template.label}”模板，确认后请保存当前群。`);
}

document.addEventListener('click', async (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.id === 'group-management-modal-mask') {
    closeGroupManagementModal({ confirmed: false, value: '' });
    return;
  }
  const target = event.target.closest('button, a');
  if (!target) return;

  if (target.dataset.action === 'group-management-modal-cancel') {
    closeGroupManagementModal({ confirmed: false, value: '' });
    return;
  }

  if (target.dataset.action === 'group-management-modal-confirm') {
    closeGroupManagementModal({
      confirmed: true,
      value: $('group-management-modal-input')?.value || '',
    });
    return;
  }

  if (target.dataset.groupId) {
    const nextGroupId = target.dataset.groupId;
    if (groupManagementState.selectedGroupId !== nextGroupId) {
      resetWelcomeImageDraft();
    }
    groupManagementState.selectedGroupId = nextGroupId;
    groupManagementState.memberPayload = null;
    groupManagementState.memberPage = 1;
    groupManagementState.memberQuery = '';
    groupManagementState.joinRequestPayload = null;
    groupManagementState.joinRequestPage = 1;
    groupManagementState.joinRequestQuery = '';
    groupManagementState.titleApplicationPayload = null;
    groupManagementState.titleApplicationPage = 1;
    groupManagementState.titleApplicationQuery = '';
    groupManagementState.titleApplicationStatus = 'pending';
    groupManagementState.logPayload = null;
    groupManagementState.logPage = 1;
    resetGroupManagementEventStream();
    renderGroupList();
    renderDetail();
    await loadJoinRequests(1);
    await loadTitleApplications(1);
    await refreshGroupManagementLogs(1);
    await refreshGroupManagementEventStreamNow({ reset: true });
    return;
  }

  if (target.dataset.action === 'load-members') {
    await loadMembers(1);
    return;
  }

  if (target.dataset.action === 'load-join-requests') {
    await loadJoinRequests(1);
    return;
  }

  if (target.dataset.action === 'load-title-applications') {
    await loadTitleApplications(1);
    return;
  }

  if (target.dataset.action === 'member-page') {
    await loadMembers(Number(target.dataset.page || 1));
    return;
  }

  if (target.dataset.action === 'join-request-page') {
    await loadJoinRequests(Number(target.dataset.page || 1));
    return;
  }

  if (target.dataset.action === 'title-application-page') {
    await loadTitleApplications(Number(target.dataset.page || 1));
    return;
  }

  if (target.dataset.action === 'group-log-page') {
    await refreshGroupManagementLogs(Number(target.dataset.page || 1));
    return;
  }

  if (target.dataset.action === 'run-health-check') {
    await runGroupManagementHealthCheck();
    return;
  }

  if (target.dataset.action === 'export-health-markdown') {
    exportGroupManagementHealth('markdown');
    return;
  }

  if (target.dataset.action === 'export-health-json') {
    exportGroupManagementHealth('json');
    return;
  }

  if (target.dataset.action === 'toggle-health-ignored') {
    groupManagementState.healthShowIgnored = groupManagementState.healthShowIgnored !== true;
    renderHealthPanel();
    return;
  }

  if (target.dataset.action === 'handle-first-health-issue') {
    handleFirstGroupManagementHealthIssue();
    return;
  }

  if (target.dataset.action === 'ignore-health-item' || target.dataset.action === 'unignore-health-item') {
    toggleGroupManagementHealthIgnored(
      String(target.dataset.healthKey || ''),
      target.dataset.action === 'ignore-health-item',
    );
    return;
  }

  if (target.dataset.action === 'handle-health-item') {
    handleGroupManagementHealthItem(
      String(target.dataset.healthKey || ''),
      String(target.dataset.healthAction || ''),
    );
    return;
  }

  if (target.dataset.action === 'load-health-groups') {
    loadHealthGroupsToBulkSelection(String(target.dataset.healthKey || ''));
    return;
  }

  if (target.dataset.action === 'toggle-event-stream') {
    groupManagementState.eventAutoRefresh = groupManagementState.eventAutoRefresh !== true;
    renderGroupManagementEventStream();
    if (groupManagementState.eventAutoRefresh) {
      await refreshGroupManagementEventStreamNow({ incremental: true });
    } else {
      stopGroupManagementEventTimer();
    }
    return;
  }

  if (target.dataset.action === 'refresh-event-stream') {
    await refreshGroupManagementEventStreamNow({ reset: true });
    return;
  }

  if (target.dataset.action === 'mark-event-read') {
    groupManagementState.eventUnreadKeys.clear();
    renderGroupManagementEventStream();
    return;
  }

  if (target.dataset.action === 'convert-log-scenario') {
    await convertGroupManagementLogToScenario(String(target.dataset.logId || ''));
    return;
  }

  if (target.dataset.action === 'bulk-select-filtered') {
    const current = new Set(getBulkSelectedGroupIds());
    for (const group of getFilteredGroups()) {
      current.add(group.groupId);
    }
    setBulkSelectedGroupIds(Array.from(current));
    renderBulkPanel();
    return;
  }

  if (target.dataset.action === 'bulk-select-enabled') {
    const feature = getBulkFeature();
    setBulkSelectedGroupIds(getGroups()
      .filter(group => isGroupEnabledForBulkFeature(group, feature))
      .map(group => group.groupId));
    renderBulkPanel();
    return;
  }

  if (target.dataset.action === 'bulk-clear-selection') {
    setBulkSelectedGroupIds([]);
    renderBulkPanel();
    return;
  }

  if (target.dataset.action === 'bulk-apply') {
    await applyBulkEnableGroups();
    return;
  }

  if (target.dataset.action === 'save-safety') {
    await saveSafetySettings();
    return;
  }

  if (target.dataset.action === 'save-defaults') {
    await saveDefaultSettings();
    return;
  }

  if (target.dataset.action === 'apply-rule-template') {
    applyRuleTemplateToForm(String($('gm-rule-template')?.value || 'relaxed'));
    return;
  }

  if (target.dataset.action === 'rollback-config') {
    const backupId = String(target.dataset.backupId || '').trim();
    if (!backupId) return;
    if (!await confirmGroupManagementModal('确认回滚到这份群配置备份？当前配置会先自动备份一份。', { title: '回滚群配置' })) return;
    try {
      const result = await postJson('/api/group-management/backups/rollback', { id: backupId });
      groupManagementState.payload = result;
      groupManagementState.selectedGroupId = result.selectedGroupId || groupManagementState.selectedGroupId;
      resetWelcomeImageDraft();
      renderSummary();
      renderHealthPanel();
      renderSafetyPanel();
      renderDefaultsPanel();
      renderBulkPanel();
      renderGroupList();
      renderDetail();
      showSuccess(result.message || '群配置已回滚');
      await loadJoinRequests(groupManagementState.joinRequestPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`回滚失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'approve-join-request' || target.dataset.action === 'approve-join-request-whitelist') {
    const requestId = String(target.dataset.requestId || '').trim();
    if (!requestId) return;
    const addWhitelist = target.dataset.action === 'approve-join-request-whitelist';
    if (!await confirmGroupManagementModal(addWhitelist ? '确认同意这条加群申请，并加入本群白名单？' : '确认同意这条加群申请？', { title: '处理加群申请' })) return;
    try {
      const result = await postJson('/api/group-management/join-requests/approve', { id: requestId, whitelist: addWhitelist });
      if (result.moderation) {
        updateSelectedGroupModeration(result.moderation);
        renderGroupList();
        renderDetail();
      }
      showSuccess(result.message || '已同意加群申请');
      await loadJoinRequests(groupManagementState.joinRequestPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`同意失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'reject-join-request' || target.dataset.action === 'reject-join-request-blacklist') {
    const requestId = String(target.dataset.requestId || '').trim();
    if (!requestId) return;
    const addBlacklist = target.dataset.action === 'reject-join-request-blacklist';
    if (!await confirmGroupManagementModal(addBlacklist ? '确认拒绝这条加群申请，并加入本群黑名单？' : '确认拒绝这条加群申请？', { title: '处理加群申请' })) return;
    try {
      const result = await postJson('/api/group-management/join-requests/reject', { id: requestId, blacklist: addBlacklist });
      if (result.moderation) {
        updateSelectedGroupModeration(result.moderation);
        renderGroupList();
        renderDetail();
      }
      showSuccess(result.message || '已拒绝加群申请');
      await loadJoinRequests(groupManagementState.joinRequestPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`拒绝失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'approve-title-application') {
    const applicationId = String(target.dataset.applicationId || '').trim();
    if (!applicationId) return;
    if (!await confirmGroupManagementModal(`确认通过头衔申请 ${applicationId} 并发放群头衔？`, { title: '通过头衔申请' })) return;
    try {
      const result = await postJson('/api/group-management/title-applications/approve', { id: applicationId });
      showSuccess(result.message || '已通过头衔申请');
      await loadTitleApplications(groupManagementState.titleApplicationPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`通过头衔失败：${error.message}`);
      await loadTitleApplications(groupManagementState.titleApplicationPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    }
    return;
  }

  if (target.dataset.action === 'reject-title-application') {
    const applicationId = String(target.dataset.applicationId || '').trim();
    if (!applicationId) return;
    const reason = await promptGroupManagementModal({
      title: '拒绝头衔申请',
      message: `请输入拒绝头衔申请 ${applicationId} 的原因`,
      defaultValue: '不符合头衔规则',
    });
    if (reason === null) return;
    try {
      const result = await postJson('/api/group-management/title-applications/reject', {
        id: applicationId,
        reason: String(reason || '').trim() || '不符合头衔规则',
      });
      showSuccess(result.message || '已拒绝头衔申请');
      await loadTitleApplications(groupManagementState.titleApplicationPage);
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`拒绝头衔失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'add-member-warning') {
    const group = getSelectedGroup();
    const userId = normalizeGroupId($('gm-warning-user-id')?.value);
    const reason = String($('gm-warning-reason')?.value || '').trim();
    if (!group || !userId) {
      showRisk('请输入正确的 QQ 号。');
      return;
    }
    try {
      const result = await postJson('/api/group-management/warnings/add', {
        groupId: group.groupId,
        userId,
        reason,
      });
      updateSelectedGroupModeration(result.moderation);
      showSuccess(result.message || '已增加警告积分');
      renderGroupList();
      renderDetail();
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`增加警告失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'clear-member-warning') {
    const group = getSelectedGroup();
    const userId = normalizeGroupId($('gm-warning-user-id')?.value);
    if (!group || !userId) {
      showRisk('请输入正确的 QQ 号。');
      return;
    }
    if (!await confirmGroupManagementModal(`确认清空 QQ ${userId} 的警告积分？`, { title: '清空警告积分' })) return;
    try {
      const result = await postJson('/api/group-management/warnings/clear', {
        groupId: group.groupId,
        userId,
      });
      updateSelectedGroupModeration(result.moderation);
      showSuccess(result.message || '已清空警告积分');
      renderGroupList();
      renderDetail();
      await refreshGroupManagementLogs(1);
      await refreshGroupManagementEventStreamNow({ reset: true });
    } catch (error) {
      showRisk(`清空警告失败：${error.message}`);
    }
    return;
  }

  if (target.dataset.action === 'clear-welcome') {
    const group = getSelectedGroup();
    if (
      group
      && await confirmGroupManagementModal(`确认恢复群 ${group.groupId} 的默认欢迎配置？本群单独设置的欢迎文案和图片会被删除。`, { title: '恢复默认欢迎' })
    ) {
      await saveCurrentGroup({ groupId: group.groupId, welcome: { clear: true } });
    }
    return;
  }

  if (target.dataset.action === 'delete-welcome-image') {
    if (groupManagementState.payload?.readOnly === true) return;
    const group = getSelectedGroup();
    if (!group) return;
    const hasSavedImage = group.config?.welcome?.hasImage === true;
    groupManagementState.welcomeImageFile = null;
    if (groupManagementState.welcomeImagePreviewUrl) {
      URL.revokeObjectURL(groupManagementState.welcomeImagePreviewUrl);
    }
    groupManagementState.welcomeImagePreviewUrl = '';
    groupManagementState.welcomeDeleteImage = hasSavedImage;
    renderDetail();
    return;
  }

  if (target.dataset.action === 'clear-auth') {
    const group = getSelectedGroup();
    if (
      group
      && await confirmGroupManagementModal(`确认删除群 ${group.groupId} 的入群验证覆盖配置？`, { title: '删除入群验证覆盖配置' })
    ) {
      await saveCurrentGroup({ groupId: group.groupId, auth: { clear: true } });
    }
  }
});

document.addEventListener('change', async (event) => {
  if (event.target instanceof HTMLSelectElement && event.target.id === 'gm-bulk-feature') {
    groupManagementState.bulkFeature = getBulkFeature();
    renderBulkPanel();
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'group-management-title-application-status') {
    groupManagementState.titleApplicationStatus = String(event.target.value || 'pending');
    await loadTitleApplications(1);
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'group-management-event-type') {
    groupManagementState.eventType = String(event.target.value || 'all');
    resetGroupManagementEventStream();
    await refreshGroupManagementEventStreamNow({ reset: true });
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'gm-rule-template') {
    const template = GROUP_MANAGEMENT_RULE_TEMPLATES[String(event.target.value || 'relaxed')] || GROUP_MANAGEMENT_RULE_TEMPLATES.relaxed;
    const help = $('gm-rule-template-help');
    if (help) help.textContent = template.help || '';
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'gm-content-action') {
    refreshContentSafetyWarning();
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.id === 'gm-default-content-action') {
    refreshContentSafetyWarning('gm-default-content-safety-warning', 'gm-default-content-action', 'gm-default-content-mute-seconds');
    return;
  }
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.id === 'gm-content-mute-seconds') {
    refreshContentSafetyWarning();
  }
  if (event.target.id === 'gm-default-content-mute-seconds') {
    refreshContentSafetyWarning('gm-default-content-safety-warning', 'gm-default-content-action', 'gm-default-content-mute-seconds');
  }
  if (event.target.id === 'group-management-event-current-group') {
    groupManagementState.eventCurrentGroupOnly = event.target.checked;
    resetGroupManagementEventStream();
    await refreshGroupManagementEventStreamNow({ reset: true });
    return;
  }
  if (event.target.id === 'group-management-event-failed-only') {
    groupManagementState.eventFailedOnly = event.target.checked;
    renderGroupManagementEventStream();
    return;
  }
  if (event.target.dataset.bulkGroupId) {
    const groupId = normalizeGroupId(event.target.dataset.bulkGroupId);
    if (!groupId) return;
    const selected = new Set(getBulkSelectedGroupIds());
    if (event.target.checked) {
      selected.add(groupId);
    } else {
      selected.delete(groupId);
    }
    setBulkSelectedGroupIds(Array.from(selected));
    event.target.closest('.group-management-bulk-item')?.classList.toggle('active', event.target.checked);
    renderBulkMeta();
    return;
  }
  if (event.target.id === 'gm-welcome-image-input') {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    try {
      validateWelcomeImageFile(file);
      if (groupManagementState.welcomeImagePreviewUrl) {
        URL.revokeObjectURL(groupManagementState.welcomeImagePreviewUrl);
      }
      groupManagementState.welcomeImageFile = file;
      groupManagementState.welcomeImagePreviewUrl = URL.createObjectURL(file);
      groupManagementState.welcomeDeleteImage = false;
      hideMessages();
      renderDetail();
    } catch (error) {
      event.target.value = '';
      showRisk(error.message);
    }
    return;
  }
  if (event.target.type === 'checkbox') {
    syncConflictCheckboxes(event.target);
  }
});

document.addEventListener('keydown', async (event) => {
  const modalMask = $('group-management-modal-mask');
  const modalVisible = modalMask && !modalMask.classList.contains('hidden');
  if (modalVisible && event.key === 'Escape') {
    event.preventDefault();
    closeGroupManagementModal({ confirmed: false, value: '' });
    return;
  }
  if (modalVisible && event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.id === 'group-management-modal-input') {
    event.preventDefault();
    closeGroupManagementModal({ confirmed: true, value: event.target.value || '' });
    return;
  }
  if (event.target instanceof HTMLInputElement && event.target.id === 'group-management-member-search' && event.key === 'Enter') {
    await loadMembers(1);
  }
  if (event.target instanceof HTMLInputElement && event.target.id === 'group-management-join-request-search' && event.key === 'Enter') {
    await loadJoinRequests(1);
  }
  if (event.target instanceof HTMLInputElement && event.target.id === 'group-management-title-application-search' && event.key === 'Enter') {
    await loadTitleApplications(1);
  }
});

$('group-management-search')?.addEventListener('input', () => {
  renderBulkPanel();
  renderGroupList();
});

$('group-management-refresh-btn')?.addEventListener('click', async () => {
  try {
    await refreshGroupManagement();
  } catch (error) {
    showRisk(`刷新失败：${error.message}`);
  }
});

$('group-management-log-refresh-btn')?.addEventListener('click', async () => {
  await refreshGroupManagementLogs(1);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && groupManagementState.eventAutoRefresh === true) {
    refreshGroupManagementEventStreamNow({ incremental: true }).catch(() => {});
  }
});

window.addEventListener('beforeunload', () => {
  stopGroupManagementEventTimer();
});

let groupManagementLogSearchTimer = null;
$('group-management-log-search')?.addEventListener('input', () => {
  groupManagementState.logQuery = String($('group-management-log-search')?.value || '').trim();
  if (groupManagementLogSearchTimer) {
    clearTimeout(groupManagementLogSearchTimer);
  }
  groupManagementLogSearchTimer = setTimeout(() => {
    refreshGroupManagementLogs(1).catch(error => showRisk(`刷新日志失败：${error.message}`));
  }, 250);
});

$('group-management-save-btn')?.addEventListener('click', async () => {
  await saveCurrentGroup();
});

$('group-management-open-id-btn')?.addEventListener('click', async () => {
  const groupId = normalizeGroupId($('group-management-direct-id')?.value);
  if (!groupId) {
    showRisk('请输入 5-20 位数字群号。');
    return;
  }
  if (groupManagementState.selectedGroupId !== groupId) {
    resetWelcomeImageDraft();
  }
  groupManagementState.selectedGroupId = groupId;
  groupManagementState.memberPayload = null;
  groupManagementState.joinRequestPayload = null;
  groupManagementState.joinRequestPage = 1;
  groupManagementState.joinRequestQuery = '';
  groupManagementState.logPayload = null;
  groupManagementState.logPage = 1;
  try {
    await refreshGroupManagement();
  } catch (error) {
    showRisk(`打开群号失败：${error.message}`);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkStartupElements()) return;
  loadGroupManagementHealthIgnores();
  const params = new URLSearchParams(window.location.search);
  const groupId = normalizeGroupId(params.get('groupId'));
  if (groupId) {
    groupManagementState.selectedGroupId = groupId;
  }
  try {
    await refreshGroupManagement({ keepMessage: true });
  } catch (error) {
    setStatus('群管理数据加载失败');
    showRisk(error.message);
  }
});
