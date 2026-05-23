function buildSandboxPayload() {
  return {
    sessionId: document.getElementById('sandbox-session-id').value.trim() || 'default',
    userId: document.getElementById('sandbox-user-id').value.trim(),
    groupId: document.getElementById('sandbox-group-id').value.trim(),
    userName: document.getElementById('sandbox-user-name').value.trim(),
    botName: document.getElementById('sandbox-bot-name').value.trim(),
    isMaster: document.getElementById('sandbox-is-master').value.trim(),
    model: document.getElementById('sandbox-model').value.trim(),
    temperature: document.getElementById('sandbox-temperature').value.trim(),
    maxTokens: document.getElementById('sandbox-max-tokens').value.trim(),
    contextNote: document.getElementById('sandbox-context-note').value,
    groupHistory: document.getElementById('sandbox-group-history').value,
    memories: document.getElementById('sandbox-memories').value,
    knowledgeBase: document.getElementById('sandbox-knowledge-base').value,
    knowledgeTopK: document.getElementById('sandbox-knowledge-topk').value.trim(),
    knowledgeFilterTags: document.getElementById('sandbox-knowledge-filter-tags')?.value.trim() || '',
    systemPrompt: document.getElementById('sandbox-system-prompt').value,
    prompt: document.getElementById('sandbox-input').value.trim(),
  };
}

async function refreshSystemPromptPreview() {
  try {
    const data = await postJson('/api/sandbox-prompt-preview', buildSandboxPayload());
    document.getElementById('sandbox-system-prompt-preview').textContent = data.systemPrompt || '暂无系统提示词';
    renderRagMatches(data.knowledgeMatches || []);
    renderRagDebug(data);
  } catch (error) {
    document.getElementById('sandbox-system-prompt-preview').textContent = `生成失败：${error.message}`;
  }
}

async function runWebRead() {
  const url = document.getElementById('sandbox-web-read-url').value.trim();
  const maxLength = document.getElementById('sandbox-web-read-max-length').value.trim();
  if (!url) return;
  document.getElementById('sandbox-web-read-status').textContent = '正在读取网页正文，请稍候...';
  document.getElementById('sandbox-web-read-result').textContent = '正在读取网页...';
  try {
    const data = await postJson('/api/sandbox-web-read', {
      url,
      maxLength,
    });
    sandboxState.webReadResult = data.markdown || '';
    document.getElementById('sandbox-web-read-status').textContent = `读取成功：${data.url} · task=${data.taskId || '未知'} · size=${data.size || 0}`;
    document.getElementById('sandbox-web-read-result').textContent = data.markdown || '未返回正文';
    persistSandboxState();
  } catch (error) {
    document.getElementById('sandbox-web-read-status').textContent = `读取失败：${error.message}`;
    document.getElementById('sandbox-web-read-result').textContent = `读取失败：${error.message}`;
  }
}

function injectWebReadIntoInput() {
  const markdown = String(sandboxState.webReadResult || '').trim();
  if (!markdown) {
    document.getElementById('sandbox-web-read-status').textContent = '当前没有可注入的网页正文，请先读取网页。';
    return;
  }
  const input = document.getElementById('sandbox-input');
  const injected = [
    '请基于以下网页正文内容回答我的问题：',
    '',
    markdown,
    '',
    '我的问题是：',
  ].join('\n');
  input.value = injected;
  document.getElementById('sandbox-web-read-status').textContent = '已将网页正文注入当前对话输入框，可直接继续提问。';
  persistSandboxState();
}

async function refreshConfigStatus() {
  try {
    const sessionId = document.getElementById('sandbox-session-id').value.trim();
    const userId = document.getElementById('sandbox-user-id').value.trim();
    const groupId = document.getElementById('sandbox-group-id').value.trim();
    const query = new URLSearchParams();
    if (sessionId) query.set('sessionId', sessionId);
    if (userId) query.set('userId', userId);
    if (groupId) query.set('groupId', groupId);
    const data = await fetchJson(`/api/sandbox-config-status${query.toString() ? `?${query.toString()}` : ''}`);
    renderConfigStatus(data);
  } catch (error) {
    document.getElementById('sandbox-config-status').textContent = `读取失败：${error.message}`;
  }
}

async function runCompare() {
  const prompt = document.getElementById('sandbox-input').value.trim();
  if (!prompt) return;
  const basePayload = buildSandboxPayload();
  const maxTokens = document.getElementById('sandbox-max-tokens').value.trim();
  const history = sandboxState.history.map(item => ({ role: item.role, content: item.content }));
  const requestA = {
    prompt,
    ...basePayload,
    history,
    model: document.getElementById('sandbox-compare-model-a').value.trim() || document.getElementById('sandbox-model').value.trim(),
    temperature: document.getElementById('sandbox-compare-temp-a').value.trim() || document.getElementById('sandbox-temperature').value.trim(),
    maxTokens,
  };
  const requestB = {
    prompt,
    ...basePayload,
    history,
    model: document.getElementById('sandbox-compare-model-b').value.trim() || document.getElementById('sandbox-model').value.trim(),
    temperature: document.getElementById('sandbox-compare-temp-b').value.trim() || document.getElementById('sandbox-temperature').value.trim(),
    maxTokens,
  };
  const [a, b] = await Promise.all([
    postJson('/api/sandbox-chat', requestA).catch(error => ({ error: error.message, request: requestA })),
    postJson('/api/sandbox-chat', requestB).catch(error => ({ error: error.message, request: requestB })),
  ]);
  sandboxState.compareResult = { a, b };
  renderCompareResult();
  persistSandboxState();
}

async function sendSandboxMessage() {
  const input = document.getElementById('sandbox-input');
  const basePayload = buildSandboxPayload();
  const prompt = input.value.trim();
  if (!prompt) return;
  const history = sandboxState.history.map(item => ({ role: item.role, content: item.content }));
  sandboxState.history.push({ role: 'user', content: prompt, time: Date.now() });
  renderHistory();
  persistSandboxState();
  try {
    const data = await postJson('/api/sandbox-chat', {
      prompt,
      ...basePayload,
      history,
    });
    sandboxState.history.push({ role: 'assistant', content: data.reply || '', time: Date.now() });
    renderHistory();
    renderSummary(data);
    focusSandboxResultArea();
    input.value = '';
    persistSandboxState();
  } catch (error) {
    sandboxState.history.push({ role: 'assistant', content: `请求失败：${error.message}`, time: Date.now() });
    renderHistory();
    focusSandboxResultArea();
    persistSandboxState();
  }
}
