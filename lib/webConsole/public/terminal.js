// Root 终端：会话解锁 / 命令执行 / 历史查看
(function () {
  const { fetchJson, postJson } = window.CrystelfRequest || {};
  const TERMINAL_SESSION_KEY = 'crystelf-terminal-session';
  let sessionToken = '';
  let busy = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function headers() {
    return sessionToken ? { 'X-Terminal-Session': sessionToken } : {};
  }

  function saveSession(token) {
    sessionToken = token || '';
    try {
      if (sessionToken) sessionStorage.setItem(TERMINAL_SESSION_KEY, sessionToken);
      else sessionStorage.removeItem(TERMINAL_SESSION_KEY);
    } catch {}
  }

  function loadSession() {
    try {
      sessionToken = String(sessionStorage.getItem(TERMINAL_SESSION_KEY) || '');
    } catch {
      sessionToken = '';
    }
  }

  function showPanel(unlocked, info = {}) {
    document.getElementById('terminal-lock-panel')?.classList.toggle('hidden', Boolean(unlocked));
    document.getElementById('terminal-panel')?.classList.toggle('hidden', !unlocked);
    const status = document.getElementById('terminal-status');
    if (status) {
      status.textContent = unlocked
        ? `已解锁（${info.platform || process.platformLabel || ''} · 会话 60 分钟，活跃自动续期）`
        : '未解锁：输入控制台登录口令后使用。';
    }
    const meta = document.getElementById('terminal-meta');
    if (meta && unlocked) {
      meta.textContent = `工作目录：${info.cwd || '-'} · 平台：${info.platform || '-'}`;
    }
    if (unlocked) document.getElementById('terminal-command')?.focus();
  }

  async function refreshStatus() {
    try {
      const data = await fetchJson('/api/terminal/status', { headers: headers() });
      showPanel(data.unlocked === true, data);
    } catch {
      showPanel(false);
    }
  }

  async function unlock() {
    const input = document.getElementById('terminal-password');
    const errorBox = document.getElementById('terminal-lock-error');
    const button = document.getElementById('terminal-unlock-btn');
    const password = String(input?.value || '');
    if (!password) {
      errorBox.textContent = '请输入控制台登录口令。';
      errorBox.classList.remove('hidden');
      return;
    }
    if (button) button.disabled = true;
    try {
      const result = await postJson('/api/terminal/unlock', { password });
      const data = result?.data || result || {};
      saveSession(data.token || '');
      errorBox.classList.add('hidden');
      if (input) input.value = '';
      appendOutput(`[终端已解锁，会话 60 分钟]`, 'terminal-line-info');
      await refreshStatus();
    } catch (error) {
      errorBox.textContent = error.message || '解锁失败。';
      errorBox.classList.remove('hidden');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function appendOutput(text, cls = '') {
    const box = document.getElementById('terminal-output');
    if (!box) return;
    const line = document.createElement('div');
    line.className = `terminal-line ${cls}`;
    line.textContent = text;
    box.appendChild(line);
    while (box.children.length > 500) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  async function runCommand(command) {
    if (busy) return;
    busy = true;
    const runButton = document.getElementById('terminal-run-btn');
    if (runButton) runButton.disabled = true;
    appendOutput(`$ ${command}`, 'terminal-line-command');
    try {
      const result = await postJson('/api/terminal/exec', { command }, { headers: headers() });
      const data = result?.data || result || {};
      if (data.output) appendOutput(data.output.replace(/\n$/, ''));
      appendOutput(`[退出码 ${data.code}${data.timedOut ? ' · 超时' : ''} · ${(data.elapsedMs / 1000).toFixed(1)}s]`, 'terminal-line-info');
    } catch (error) {
      if (error?.code === 'TERMINAL_BUSY') {
        appendOutput('[上一条命令还在执行中]', 'terminal-line-error');
      } else if (error?.code === 'TERMINAL_LOCKED' || /终端未解锁|会话已过期/.test(String(error.message))) {
        saveSession('');
        await refreshStatus();
        appendOutput('[终端会话已失效，请重新解锁]', 'terminal-line-error');
      } else {
        appendOutput(`[执行失败：${error.message}]`, 'terminal-line-error');
      }
    } finally {
      busy = false;
      if (runButton) runButton.disabled = false;
      document.getElementById('terminal-command')?.focus();
    }
  }

  async function showHistory() {
    const box = document.getElementById('terminal-history-box');
    if (!box) return;
    if (!box.classList.contains('hidden')) {
      box.classList.add('hidden');
      return;
    }
    try {
      const data = await fetchJson('/api/terminal/history', { headers: headers() });
      const items = Array.isArray(data.items) ? data.items : [];
      box.innerHTML = items.length > 0
        ? items.map(item => `
          <button type="button" class="terminal-history-item" data-command="${escapeHtml(item.command)}">
            <span class="terminal-history-command">${escapeHtml(item.command)}</span>
            <span class="terminal-history-meta">码 ${item.code} · ${item.time ? new Date(item.time).toLocaleTimeString('zh-CN', { hour12: false }) : ''}</span>
          </button>`).join('')
        : '<div class="terminal-history-empty">还没有执行记录。</div>';
      box.classList.remove('hidden');
    } catch {
      box.innerHTML = '<div class="terminal-history-empty">历史读取失败。</div>';
      box.classList.remove('hidden');
    }
  }

  async function lockTerminal() {
    try {
      await postJson('/api/terminal/lock', {}, { headers: headers() });
    } catch {}
    saveSession('');
    appendOutput('[终端已锁定]', 'terminal-line-info');
    await refreshStatus();
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadSession();
    refreshStatus();

    document.getElementById('terminal-unlock-btn')?.addEventListener('click', unlock);
    document.getElementById('terminal-password')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') unlock();
    });
    document.getElementById('terminal-run-btn')?.addEventListener('click', () => {
      const input = document.getElementById('terminal-command');
      const command = String(input?.value || '').trim();
      if (!command || busy) return;
      if (input) input.value = '';
      runCommand(command);
    });
    document.getElementById('terminal-command')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        const input = document.getElementById('terminal-command');
        const command = String(input?.value || '').trim();
        if (!command || busy) return;
        if (input) input.value = '';
        runCommand(command);
      }
    });
    document.getElementById('terminal-history-btn')?.addEventListener('click', showHistory);
    document.getElementById('terminal-lock-btn')?.addEventListener('click', lockTerminal);
    document.getElementById('terminal-history-box')?.addEventListener('click', event => {
      const item = event.target.closest('.terminal-history-item');
      if (!item) return;
      const input = document.getElementById('terminal-command');
      if (input) {
        input.value = item.dataset.command || '';
        input.focus();
      }
    });
  });
})();
