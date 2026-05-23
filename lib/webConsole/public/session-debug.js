const sessionDebugViewState = {
  currentData: null,
};

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return await response.json();
}

function formatTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatSceneLabel(scene) {
  const key = String(scene || '').trim();
  const sceneMap = {
    chat: '通用对话',
    chat_text: '文本对话',
    chat_multimodal: '多模态对话',
    chat_engine: '对话引擎',
    chat_engine_fallback: '对话降级处理',
    chat_engine_final: '对话最终生成',
    poke_follow_reply: '戳一戳跟随回复',
    poke_ai_reply: '戳一戳 AI 回复',
    poke_image_summary: '戳一戳图片摘要',
    daily_group_summary: '每日群聊总结',
    image_monitor_review: '图片监控审核',
  };
  return sceneMap[key] || key || '未知';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeUrl(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const allowRelative = options.allowRelative !== false;

  try {
    if (allowRelative && /^\/(?!\/)/.test(raw)) {
      const parsed = new URL(raw, window.location.origin);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    if (!/^https?:\/\//i.test(raw)) {
      return '';
    }

    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeToneClass(value = '') {
  const tone = String(value || '').trim().toLowerCase();
  return ['success', 'error', 'neutral', 'warning'].includes(tone) ? ` tone-${tone}` : '';
}

function normalizeListText(value, separator = '、') {
  if (Array.isArray(value)) {
    return value.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).filter(Boolean).join(separator);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => `${key}:${typeof item === 'object' ? JSON.stringify(item) : String(item)}`).join(separator);
  }
  return String(value || '');
}

function setRawJson(data) {
  document.getElementById('session-debug-raw').textContent = JSON.stringify(data, null, 2);
}

function openConfirm(message) {
  return webConsoleConfirm(message);
}
