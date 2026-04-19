const WEB_THEME_KEY = 'crystelf-web-console-theme';
const WEB_CONSOLE_TOKEN_KEY = 'crystelf-web-console-token';
const WEB_CONSOLE_BG_BUTTON_ID = 'console-bg-refresh-btn';
const WEB_CONSOLE_BG_ENDPOINT = '/console-background-image';
const WEB_CONSOLE_BG_REFRESH_ENDPOINT = '/api/console-background-image/refresh';

function getWebConsoleToken() {
  return localStorage.getItem(WEB_CONSOLE_TOKEN_KEY) || '';
}

function buildConsoleBackgroundUrl(version = Date.now()) {
  const params = new URLSearchParams();
  params.set('v', String(version || Date.now()));
  return `${WEB_CONSOLE_BG_ENDPOINT}?${params.toString()}`;
}

function applyConsoleBackground(version = Date.now()) {
  document.documentElement.style.setProperty('--console-photo-image', `url("${buildConsoleBackgroundUrl(version)}")`);
}

async function refreshConsoleBackground() {
  const token = getWebConsoleToken().trim();
  const response = await fetch(WEB_CONSOLE_BG_REFRESH_ENDPOINT, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  const dock = document.createElement('div');
  dock.className = 'console-floating-tools';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = WEB_CONSOLE_BG_BUTTON_ID;
  button.className = 'console-floating-btn';
  button.textContent = '换壁纸';
  button.title = '从后台拉取一张新壁纸并保存到本地';
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
      button.title = '从后台拉取一张新壁纸并保存到本地';
    }, 1200);
  });

  dock.appendChild(button);
  document.body.appendChild(dock);
}

function getThemeToggleButtons() {
  return Array.from(document.querySelectorAll('[data-theme-toggle], #theme-toggle-btn'));
}

function applyStoredTheme() {
  const theme = localStorage.getItem(WEB_THEME_KEY) || 'light';
  document.documentElement.dataset.theme = theme;
  getThemeToggleButtons().forEach(toggle => {
    toggle.textContent = theme === 'dark' ? '浅色主题' : '深色主题';
  });
}

function toggleTheme() {
  const current = localStorage.getItem(WEB_THEME_KEY) || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(WEB_THEME_KEY, next);
  applyStoredTheme();
}

document.addEventListener('DOMContentLoaded', () => {
  applyConsoleBackground();
  ensureConsoleBackgroundButton();
  applyStoredTheme();
  getThemeToggleButtons().forEach(button => {
    button.addEventListener('click', toggleTheme);
  });
});
