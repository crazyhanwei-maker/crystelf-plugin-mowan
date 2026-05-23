function bindCommonActions() {
  document.getElementById('toggle-session-debug-raw-btn').addEventListener('click', () => {
    document.getElementById('session-debug-raw').classList.toggle('hidden');
  });
  document.getElementById('copy-session-debug-json-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('session-debug-raw').textContent).catch(() => {});
  });
  document.getElementById('reset-session-messages-debug-btn').addEventListener('click', async () => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('sessionId') || '';
    if (!sessionId) return;
    const confirmed = await openConfirm(`确认仅清空会话 ${sessionId} 的消息吗？画像、表达和主题数据会保留。`);
    if (!confirmed) return;
    try {
      const response = await fetch('/api/sessions/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId, mode: 'messages_only' }),
      });
      if (!response.ok) {
        throw new Error(`/api/sessions/reset -> ${response.status}`);
      }
      await webConsoleAlert(`会话 ${sessionId} 的消息已清空，画像/表达/主题仍保留。稍后将返回首页。`);
      location.href = '/';
    } catch (error) {
      webConsoleAlert(`清空失败：${error.message}`);
    }
  });
  document.getElementById('reset-session-debug-btn').addEventListener('click', async () => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('sessionId') || '';
    if (!sessionId) return;
    const confirmed = await openConfirm(`确认重置会话 ${sessionId} 吗？这会清空该会话记录、画像、表达和主题数据。`);
    if (!confirmed) return;
    try {
      const response = await fetch('/api/sessions/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        throw new Error(`/api/sessions/reset -> ${response.status}`);
      }
      await webConsoleAlert(`会话 ${sessionId} 已清空，稍后将返回首页。`);
      location.href = '/';
    } catch (error) {
      webConsoleAlert(`重置失败：${error.message}`);
    }
  });
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.copyValue !== undefined) {
      navigator.clipboard.writeText(target.dataset.copyValue).catch(() => {});
    }
  });
  document.getElementById('session-debug-apply-filter-btn').addEventListener('click', () => {
    const params = new URLSearchParams(location.search);
    const userId = document.getElementById('session-debug-user-filter').value.trim();
    if (userId) {
      params.set('userId', userId);
    } else {
      params.delete('userId');
    }
    location.search = params.toString();
  });
  ['session-debug-knowledge-filter', 'session-debug-tool-filter', 'session-debug-prompt-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      if (sessionDebugViewState.currentData) {
        renderRuntimePanels(sessionDebugViewState.currentData);
      }
    });
  });
  document.getElementById('session-debug-log-filter')?.addEventListener('input', () => {
    if (sessionDebugViewState.currentData) {
      renderFullDebugLog(sessionDebugViewState.currentData);
    }
  });
  document.getElementById('session-debug-knowledge-export-btn')?.addEventListener('click', () => {
    const items = sessionDebugViewState.currentData?.debugDigest?.runtimeKnowledgeMatches || [];
    exportDebugPanel(items, 'session-debug-knowledge');
  });
  document.getElementById('session-debug-tool-export-btn')?.addEventListener('click', () => {
    const items = sessionDebugViewState.currentData?.debugDigest?.runtimeToolCalls || [];
    exportDebugPanel(items, 'session-debug-tool-calls');
  });
  document.getElementById('session-debug-prompt-export-btn')?.addEventListener('click', () => {
    const item = sessionDebugViewState.currentData?.debugDigest?.runtimePromptSummary || {};
    exportDebugPanel(item, 'session-debug-prompt');
  });
  document.getElementById('session-debug-poke-export-btn')?.addEventListener('click', () => {
    const item = sessionDebugViewState.currentData?.debugDigest?.pokeDebug || {};
    exportDebugPanel(item, 'session-debug-poke');
  });
  document.getElementById('session-debug-log-copy-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('session-debug-log').textContent).catch(() => {});
  });
  document.getElementById('session-debug-log-export-btn')?.addEventListener('click', () => {
    const text = buildFullDebugLog(sessionDebugViewState.currentData || {});
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `session-debug-log-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}
