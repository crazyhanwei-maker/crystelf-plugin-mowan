function normalizeLoginTone(tone = 'neutral') {
  const value = String(tone || '').trim();
  return ['success', 'error', 'neutral'].includes(value) ? value : 'neutral';
}

function setLoginMessage(message, tone = 'neutral') {
  const box = document.getElementById('login-message');
  if (!box) return;
  box.textContent = message;
  box.className = `login-message tone-${normalizeLoginTone(tone)}`;
}

function setLoginSubmitState(loading) {
  const button = document.getElementById('login-submit-btn');
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? '\u767b\u5f55\u4e2d...' : '\u767b\u5f55\u63a7\u5236\u53f0';
}

async function bootstrapLoginPage() {
  const auth = window.CrystelfAuth;
  const form = document.getElementById('login-form');
  const tokenInput = document.getElementById('login-token');
  const directLink = document.getElementById('login-direct-link');
  const subtitle = document.getElementById('login-subtitle');

  try {
    const status = await auth.fetchAuthStatus();
    if (status.authorized) {
      auth.redirectAfterLogin();
      return;
    }

    if (!status.loginConfigured) {
      form.classList.add('hidden');
      const canBootstrapHere = status.bootstrapMode === true;
      directLink.classList.toggle('hidden', !canBootstrapHere);

      if (canBootstrapHere) {
        const link = directLink.querySelector('a');
        if (link) {
          link.href = '/plugin-settings.html?bootstrap=1';
          link.textContent = '\u524d\u5f80\u624b\u52a8\u8bbe\u7f6e\u9875\u9762';
        }
        subtitle.textContent = '当前控制台还没有可用登录口令。正常启动会自动生成随机口令并输出在启动日志，也可以前往手动设置页面填写。';
        setLoginMessage('\u672a\u68c0\u6d4b\u5230\u53ef\u7528\u7684\u63a7\u5236\u53f0\u767b\u5f55\u53e3\u4ee4\uff0c\u8bf7\u5148\u67e5\u770b\u542f\u52a8\u65e5\u5fd7\u6216\u5728\u672c\u673a\u624b\u52a8\u8bbe\u7f6e\u3002', 'error');
      } else {
        subtitle.textContent = '\u5f53\u524d\u63a7\u5236\u53f0\u8fd8\u6ca1\u6709\u53ef\u7528\u767b\u5f55\u53e3\u4ee4\uff0c\u8bf7\u5148\u5728\u673a\u5668\u542f\u52a8\u65e5\u5fd7\u4e2d\u67e5\u627e\u81ea\u52a8\u751f\u6210\u7684\u53e3\u4ee4\uff0c\u6216\u5728\u672c\u673a\u624b\u52a8\u8bbe\u7f6e\u3002';
        setLoginMessage('\u63a7\u5236\u53f0\u5c1a\u672a\u914d\u7f6e\u53e3\u4ee4\uff0c\u8bf7\u5148\u67e5\u770b\u542f\u52a8\u65e5\u5fd7\u6216\u5728\u672c\u673a\u8bbe\u7f6e\u540e\u518d\u767b\u5f55\u3002', 'error');
      }
      return;
    }
  } catch (error) {
    setLoginMessage(error.message || '\u8bfb\u53d6\u767b\u5f55\u72b6\u6001\u5931\u8d25', 'error');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = String(tokenInput.value || '').trim();
    if (!token) {
      setLoginMessage('\u8bf7\u8f93\u5165\u63a7\u5236\u53f0\u767b\u5f55\u53e3\u4ee4\u3002', 'error');
      tokenInput.focus();
      return;
    }

    try {
      setLoginSubmitState(true);
      setLoginMessage('\u6b63\u5728\u9a8c\u8bc1\u767b\u5f55\u53e3\u4ee4...', 'neutral');
      await auth.login(token);
      setLoginMessage('\u767b\u5f55\u6210\u529f\uff0c\u6b63\u5728\u8df3\u8f6c\u63a7\u5236\u53f0...', 'success');
      window.setTimeout(() => auth.redirectAfterLogin(), 240);
    } catch (error) {
      setLoginMessage(error.message || '\u767b\u5f55\u5931\u8d25', 'error');
      tokenInput.select();
    } finally {
      setLoginSubmitState(false);
    }
  });
}

document.addEventListener('DOMContentLoaded', bootstrapLoginPage);
