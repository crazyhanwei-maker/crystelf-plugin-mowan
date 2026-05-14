const WEB_THEME_KEY = 'crystelf-web-console-theme';
const WEB_THEME_ACCENT_KEY = 'crystelf-web-console-accent';
const WEB_CONSOLE_BG_BUTTON_ID = 'console-bg-refresh-btn';
const WEB_CONSOLE_BG_ENDPOINT = '/console-background-image';
const WEB_CONSOLE_BG_REFRESH_ENDPOINT = '/api/console-background-image/refresh';
const WEB_THEME_DEFAULT = 'dark';
const WEB_THEME_ACCENT_DEFAULT = 'cyan';

const WEB_THEME_OPTIONS = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
];

const WEB_THEME_ACCENT_OPTIONS = [
  { value: 'cyan', label: '晶蓝' },
  { value: 'emerald', label: '青绿' },
  { value: 'violet', label: '紫罗兰' },
  { value: 'rose', label: '绯樱' },
  { value: 'amber', label: '琥珀' },
  { value: 'slate', label: '曜石' },
];

function buildConsoleBackgroundUrl(version = Date.now()) {
  const params = new URLSearchParams();
  params.set('v', String(version || Date.now()));
  return `${WEB_CONSOLE_BG_ENDPOINT}?${params.toString()}`;
}

function applyConsoleBackground(version = Date.now()) {
  document.documentElement.style.setProperty('--console-photo-image', `url("${buildConsoleBackgroundUrl(version)}")`);
}

async function refreshConsoleBackground() {
  const response = await fetch(WEB_CONSOLE_BG_REFRESH_ENDPOINT, {
    method: 'POST',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `背景刷新失败: ${response.status}`);
  }
  const version = Number(data.version || Date.now());
  applyConsoleBackground(version);
  return data;
}

function ensureConsoleBackgroundButton() {
  if (document.body?.classList.contains('login-page')) {
    return;
  }
  if (document.getElementById(WEB_CONSOLE_BG_BUTTON_ID)) {
    return;
  }
  let dock = null;
  const inlineContainer = document.body?.classList.contains('plugin-settings-page')
    ? document.querySelector('.hero > .actions')
    : document.body?.classList.contains('dashboard-page')
      ? document.querySelector('.hero-action-group-links .hero-actions-grid')
      : null;
  if (!inlineContainer) {
    dock = document.createElement('div');
    dock.className = 'console-floating-tools';
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.id = WEB_CONSOLE_BG_BUTTON_ID;
  button.className = inlineContainer ? 'console-floating-btn console-inline-btn' : 'console-floating-btn';
  button.textContent = '换壁纸';
  button.title = '刷新背景缓存并切换控制台壁纸';
  button.addEventListener('click', async () => {
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    button.textContent = '保存中';
    try {
      await refreshConsoleBackground();
      button.textContent = '已切换';
    } catch (error) {
      button.textContent = '刷新失败';
      button.title = error.message || '背景刷新失败';
    }
    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = '换壁纸';
      button.title = '刷新背景缓存并切换控制台壁纸';
    }, 1200);
  });

  if (inlineContainer) {
    inlineContainer.appendChild(button);
    return;
  }
  dock.appendChild(button);
  document.body.appendChild(dock);
}

function getThemeToggleButtons() {
  return Array.from(document.querySelectorAll('[data-theme-toggle], #theme-toggle-btn'));
}

function normalizeThemeMode(value) {
  const mode = String(value || '').trim();
  return WEB_THEME_OPTIONS.some(item => item.value === mode) ? mode : WEB_THEME_DEFAULT;
}

function normalizeAccent(value) {
  const accent = String(value || '').trim();
  return WEB_THEME_ACCENT_OPTIONS.some(item => item.value === accent) ? accent : WEB_THEME_ACCENT_DEFAULT;
}

function getStoredThemeMode() {
  return normalizeThemeMode(localStorage.getItem(WEB_THEME_KEY) || WEB_THEME_DEFAULT);
}

function getStoredAccent() {
  return normalizeAccent(localStorage.getItem(WEB_THEME_ACCENT_KEY) || WEB_THEME_ACCENT_DEFAULT);
}

function resolveThemeMode(mode = getStoredThemeMode()) {
  if (mode !== 'system') {
    return mode;
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function notifyThemeChanged(state) {
  window.dispatchEvent(new CustomEvent('crystelf-theme-change', { detail: state }));
}

function getThemeState() {
  const mode = getStoredThemeMode();
  const accent = getStoredAccent();
  return {
    mode,
    resolvedMode: resolveThemeMode(mode),
    accent,
    modes: WEB_THEME_OPTIONS,
    accents: WEB_THEME_ACCENT_OPTIONS,
  };
}

function applyStoredTheme(options = {}) {
  const state = getThemeState();
  document.documentElement.dataset.theme = state.resolvedMode;
  document.documentElement.dataset.themeMode = state.mode;
  document.documentElement.dataset.accent = state.accent;
  getThemeToggleButtons().forEach(toggle => {
    toggle.textContent = state.resolvedMode === 'dark' ? '浅色主题' : '深色主题';
  });
  if (options.notify !== false) {
    notifyThemeChanged(state);
  }
  return state;
}

function toggleTheme() {
  const current = resolveThemeMode(getStoredThemeMode());
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(WEB_THEME_KEY, next);
  applyStoredTheme();
}

function setThemeMode(mode) {
  localStorage.setItem(WEB_THEME_KEY, normalizeThemeMode(mode));
  return applyStoredTheme();
}

function setThemeAccent(accent) {
  localStorage.setItem(WEB_THEME_ACCENT_KEY, normalizeAccent(accent));
  return applyStoredTheme();
}

window.CrystelfTheme = {
  getState: getThemeState,
  apply: applyStoredTheme,
  setMode: setThemeMode,
  setAccent: setThemeAccent,
  toggle: toggleTheme,
  refreshBackground: refreshConsoleBackground,
  modes: WEB_THEME_OPTIONS,
  accents: WEB_THEME_ACCENT_OPTIONS,
};

document.addEventListener('DOMContentLoaded', () => {
  applyConsoleBackground();
  ensureConsoleBackgroundButton();
  applyStoredTheme();
  getThemeToggleButtons().forEach(button => {
    button.addEventListener('click', toggleTheme);
  });
});

window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
  if (getStoredThemeMode() === 'system') {
    applyStoredTheme();
  }
});

(() => {
  if (document.body?.classList.contains('login-page')) {
    return;
  }
  if (document.querySelector('script[data-console-shell]')) {
    return;
  }
  const script = document.createElement('script');
  script.src = '/console-shell.js';
  script.defer = true;
  script.dataset.consoleShell = '1';
  document.head.appendChild(script);
})();
