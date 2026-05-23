const SECRET_SENTINEL = '******';

const apiSettingsState = {
  config: null,
  draft: {},
  activeSection: 'ai-main',
  testResults: {},
  batchTest: {
    running: false,
    startedAt: '',
    finishedAt: '',
    durationMs: 0,
    results: [],
  },
  localMemeScan: null,
  memeTestResult: null,
  memePullResult: null,
};

const { buildHeaders, fetchJson, postJson } = window.CrystelfRequest;

function $(id) {
  return document.getElementById(id);
}

function maskApiKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text === SECRET_SENTINEL) return SECRET_SENTINEL;
  if (text.length <= 10) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 6)}***${text.slice(-4)}`;
}

function hasSecretValue(value, configured = false) {
  const text = String(value || '').trim();
  return Boolean(text && text !== SECRET_SENTINEL) || configured === true || text === SECRET_SENTINEL;
}

function getSecretDisplayText(value, configured = false, emptyText = '(未配置)') {
  const text = String(value || '').trim();
  if (text && text !== SECRET_SENTINEL) {
    return maskApiKey(text);
  }
  if (configured || text === SECRET_SENTINEL) {
    return `${SECRET_SENTINEL} (已配置，前端脱敏)`;
  }
  return emptyText;
}

function syncSecretInput(id, value, configured, placeholder) {
  const input = $(id);
  if (!(input instanceof HTMLInputElement)) return;
  const normalizedValue = String(value || '').trim();
  input.value = configured && normalizedValue === SECRET_SENTINEL ? '' : normalizedValue;
  input.placeholder = configured
    ? `${placeholder}，留空表示保持当前密钥`
    : placeholder;
}

function normalizePositiveNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.round(num);
}

function readNumberInput(id, fallback) {
  const input = $(id);
  if (!(input instanceof HTMLInputElement)) return fallback;
  return normalizePositiveNumber(input.value, fallback);
}

function normalizeStringList(value = []) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean)));
  }
  return Array.from(new Set(String(value || '')
    .split(/[\n,，;；]+/)
    .map(item => item.trim())
    .filter(Boolean)));
}

function formatListInput(value = []) {
  return normalizeStringList(value).join('\n');
}

function readListInput(id) {
  const input = $(id);
  if (!(input instanceof HTMLTextAreaElement) && !(input instanceof HTMLInputElement)) return [];
  return normalizeStringList(input.value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showRisk(message) {
  const el = $('api-settings-risk');
  const success = $('api-settings-success');
  if (!el || !success) return;
  el.textContent = message;
  el.classList.remove('hidden');
  success.classList.add('hidden');
}

function showSuccess(message) {
  const el = $('api-settings-success');
  const risk = $('api-settings-risk');
  if (!el || !risk) return;
  el.textContent = message;
  el.classList.remove('hidden');
  risk.classList.add('hidden');
}

function hideMessages() {
  $('api-settings-risk')?.classList.add('hidden');
  $('api-settings-success')?.classList.add('hidden');
}

