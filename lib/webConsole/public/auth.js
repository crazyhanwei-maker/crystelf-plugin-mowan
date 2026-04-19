(function () {
  const AUTH_STATUS_ENDPOINT = '/api/auth/status';
  const AUTH_LOGIN_ENDPOINT = '/api/auth/login';
  const AUTH_LOGOUT_ENDPOINT = '/api/auth/logout';
  const LOGIN_PAGE = '/login.html';
  const state = {
    status: null,
  };

  function getRedirectPath() {
    const current = `${window.location.pathname || '/index.html'}${window.location.search || ''}${window.location.hash || ''}`;
    if (!current.startsWith('/') || current.startsWith('//') || current.startsWith(LOGIN_PAGE)) {
      return '/index.html';
    }
    return current;
  }

  function getRequestedRedirectPath() {
    const params = new URLSearchParams(window.location.search);
    const redirect = String(params.get('redirect') || '').trim();
    if (!redirect.startsWith('/') || redirect.startsWith('//') || redirect.startsWith(LOGIN_PAGE)) {
      return '/index.html';
    }
    return redirect;
  }

  function redirectToLogin(target = getRedirectPath()) {
    const redirect = target || '/index.html';
    window.location.href = `${LOGIN_PAGE}?redirect=${encodeURIComponent(redirect)}`;
  }

  function redirectAfterLogin() {
    window.location.href = getRequestedRedirectPath();
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init) {
    const originalUrl = input instanceof Request ? input.url : String(input || '');
    const resolvedUrl = new URL(originalUrl, window.location.origin);
    const response = await nativeFetch(input, init);
    if (
      response.status === 401
      && resolvedUrl.pathname !== AUTH_LOGIN_ENDPOINT
      && !window.location.pathname.endsWith(LOGIN_PAGE)
    ) {
      redirectToLogin();
    }
    return response;
  };

  async function fetchAuthStatus() {
    const response = await nativeFetch(AUTH_STATUS_ENDPOINT, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `auth status -> ${response.status}`);
    }
    state.status = data;
    return data;
  }

  async function login(token) {
    const response = await nativeFetch(AUTH_LOGIN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: String(token || '').trim() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `auth login -> ${response.status}`);
    }
    state.status = data;
    return data;
  }

  async function logout() {
    state.status = null;
    try {
      await nativeFetch(AUTH_LOGOUT_ENDPOINT, { method: 'POST' });
    } catch {
      // Ignore logout request failures and clear the local state anyway.
    }
  }

  function ensureAuthPanel() {
    const shell = document.querySelector('.hero-actions-shell');
    if (!shell) {
      return null;
    }
    let panel = document.getElementById('console-auth-panel');
    if (panel) {
      return panel;
    }
    panel = document.createElement('div');
    panel.id = 'console-auth-panel';
    panel.className = 'hero-action-group console-auth-panel';
    shell.prepend(panel);
    return panel;
  }

  function ensureFloatingAuthButton() {
    let dock = document.querySelector('.console-floating-tools');
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'console-floating-tools';
      document.body.appendChild(dock);
    }
    let button = document.getElementById('console-auth-floating-btn');
    if (button) {
      return button;
    }
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'console-auth-floating-btn';
    button.className = 'console-floating-btn console-auth-floating-btn';
    dock.appendChild(button);
    return button;
  }

  function renderAuthUi(status) {
    const panel = ensureAuthPanel();
    const floatingButton = ensureFloatingAuthButton();
    const authorized = status?.authorized === true;
    const readOnly = status?.readOnly === true;
    const canWrite = status?.canWrite === true;
    const loginConfigured = status?.loginConfigured === true;

    if (panel) {
      const stateLabel = authorized
        ? (readOnly ? '已登录 · 只读' : '已登录')
        : loginConfigured
          ? '未登录'
          : '未配置口令';
      const desc = authorized
        ? (canWrite ? '当前会话已通过验证，可以继续修改配置与执行管理操作。' : '当前会话已通过验证，但控制台处于只读模式。')
        : loginConfigured
          ? '当前控制台需要先登录后才能进入管理操作。'
          : '当前控制台尚未设置登录口令，请先在配置文件中填写 webConsoleToken。';
      panel.innerHTML = `
        <div class="hero-action-label">访问状态</div>
        <div class="console-auth-row">
          <div>
            <div class="console-auth-state">${stateLabel}</div>
            <div class="console-auth-meta">${desc}</div>
          </div>
          <div class="actions hero-actions-grid">
            <button type="button" id="console-auth-action-btn">${authorized ? '退出登录' : '前往登录'}</button>
          </div>
        </div>
      `;
      const actionButton = document.getElementById('console-auth-action-btn');
      if (actionButton) {
        actionButton.disabled = !authorized && !loginConfigured;
        actionButton.addEventListener('click', async () => {
          if (authorized) {
            await logout();
            redirectToLogin();
            return;
          }
          redirectToLogin();
        });
      }
    }

    if (!loginConfigured && !authorized) {
      floatingButton.textContent = '未配置口令';
      floatingButton.disabled = true;
      floatingButton.title = '请先在配置文件中设置 webConsoleToken';
      return;
    }

    floatingButton.disabled = false;
    floatingButton.textContent = authorized ? '退出登录' : '控制台登录';
    floatingButton.title = authorized ? '退出当前控制台登录状态' : '前往控制台登录页';
    floatingButton.onclick = async () => {
      if (authorized) {
        await logout();
        redirectToLogin();
        return;
      }
      redirectToLogin();
    };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      localStorage.removeItem('crystelf-web-console-token');
    } catch {
      // Ignore storage access failures in restricted browser contexts.
    }
    try {
      const status = await fetchAuthStatus();
      if (!window.location.pathname.endsWith(LOGIN_PAGE)) {
        renderAuthUi(status);
      }
      if (window.location.pathname.endsWith(LOGIN_PAGE) && status.authorized) {
        redirectAfterLogin();
      }
    } catch (error) {
      if (window.location.pathname.endsWith(LOGIN_PAGE)) {
        return;
      }
      console.warn('[webConsoleAuth] status failed:', error.message);
    }
  });

  window.CrystelfAuth = {
    fetchAuthStatus,
    login,
    logout,
    redirectToLogin,
    redirectAfterLogin,
    getRequestedRedirectPath,
    get status() {
      return state.status;
    },
  };
})();
