function setLoginMessage(message, tone = 'neutral') {
  const box = document.getElementById('login-message');
  if (!box) return;
  box.textContent = message;
  box.className = `login-message tone-${tone}`;
}

function setLoginSubmitState(loading) {
  const button = document.getElementById('login-submit-btn');
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? '登录中...' : '登录控制台';
}

async function bootstrapLoginPage() {
  const auth = window.CrystelfAuth;
  const form = document.getElementById('login-form');
  const tokenInput = document.getElementById('login-token');
  const directLink = document.getElementById('login-direct-link');
  const subtitle = document.getElementById('login-subtitle');

  try {
    const status = await auth.fetchAuthStatus();
    if (status.accessProtected && status.authorized) {
      auth.redirectAfterLogin();
      return;
    }
    if (!status.loginEnabled) {
      form.classList.add('hidden');
      directLink.classList.remove('hidden');
      if (status.requireAuth) {
        subtitle.textContent = '控制台已开启强制登录，但当前没有可用登录口令，请先在配置中设置 webConsoleToken。';
        setLoginMessage('未检测到可用的控制台登录口令，当前无法通过网页登录。', 'error');
      } else {
        subtitle.textContent = '当前控制台未启用登录，可直接进入控制台。';
        setLoginMessage('无需登录，直接进入即可。', 'success');
      }
      return;
    }
  } catch (error) {
    setLoginMessage(error.message || '读取登录状态失败', 'error');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = String(tokenInput.value || '').trim();
    if (!token) {
      setLoginMessage('请输入控制台登录口令。', 'error');
      tokenInput.focus();
      return;
    }
    try {
      setLoginSubmitState(true);
      setLoginMessage('正在验证登录口令...', 'neutral');
      await auth.login(token);
      setLoginMessage('登录成功，正在跳转控制台...', 'success');
      window.setTimeout(() => auth.redirectAfterLogin(), 240);
    } catch (error) {
      setLoginMessage(error.message || '登录失败', 'error');
      tokenInput.select();
    } finally {
      setLoginSubmitState(false);
    }
  });
}

document.addEventListener('DOMContentLoaded', bootstrapLoginPage);
