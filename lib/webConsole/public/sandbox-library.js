function renderCustomTemplates() {
  const container = document.getElementById('sandbox-custom-template-list');
  container.innerHTML = sandboxState.customTemplates.length > 0
    ? sandboxState.customTemplates.map(item => `
      <div class="list-item">
        <h3>${escapeHtml(item.name)}</h3>
        <div>测试输入：${escapeHtml((item.prompt || '').slice(0, 80) || '空')}</div>
        <div>系统提示词：${item.systemPrompt ? '已设置' : '留空'}</div>
        <div class="actions">
          <button data-template-action="load" data-template-name="${escapeHtml(item.name)}">加载</button>
          <button class="danger" data-template-action="delete" data-template-name="${escapeHtml(item.name)}">删除</button>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无自定义模板</div>';
  document.getElementById('sandbox-template-status').textContent = `当前自定义模板：${sandboxState.customTemplates.length} 个`;
}

function renderKnowledgeLibraries() {
  const container = document.getElementById('sandbox-knowledge-library-list');
  if (!container) return;
  container.innerHTML = sandboxState.knowledgeLibraries.length > 0
    ? sandboxState.knowledgeLibraries.map(item => `
      <div class="list-item">
        <h3>${escapeHtml(item.name)}</h3>
        <div>保存时间：${escapeHtml(item.savedAt || '未知')}</div>
        <div>片段数：${parseKnowledgeRows(item.payload?.knowledgeBase || '').length} · topK：${escapeHtml(item.payload?.knowledgeTopK || '3')}</div>
        <div class="actions">
          <button data-knowledge-library-action="load" data-knowledge-library-name="${escapeHtml(item.name)}">加载</button>
          <button class="danger" data-knowledge-library-action="delete" data-knowledge-library-name="${escapeHtml(item.name)}">删除</button>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无知识库保存项</div>';
  document.getElementById('sandbox-knowledge-library-status').textContent = `当前知识库库：${sandboxState.knowledgeLibraries.length} 个`;
}

function collectKnowledgeLibraryPayload() {
  return {
    knowledgeBase: document.getElementById('sandbox-knowledge-base').value,
    knowledgeTopK: document.getElementById('sandbox-knowledge-topk').value.trim(),
  };
}

function applyKnowledgeLibraryPayload(payload = {}) {
  document.getElementById('sandbox-knowledge-base').value = payload.knowledgeBase || '';
  document.getElementById('sandbox-knowledge-topk').value = payload.knowledgeTopK || '';
  syncKnowledgeEditorFromText();
}

function saveCurrentAsKnowledgeLibrary() {
  const name = document.getElementById('sandbox-knowledge-library-name').value.trim();
  if (!name) return;
  const payload = collectKnowledgeLibraryPayload();
  const next = sandboxState.knowledgeLibraries.filter(item => item.name !== name);
  next.unshift({ name, savedAt: new Date().toLocaleString('zh-CN', { hour12: false }), payload });
  sandboxState.knowledgeLibraries = next.slice(0, 50);
  renderKnowledgeLibraries();
  persistSandboxState();
}

function applyKnowledgeLibrary(name) {
  const item = sandboxState.knowledgeLibraries.find(entry => entry.name === name);
  if (!item) return;
  applyKnowledgeLibraryPayload(item.payload || {});
  persistSandboxState();
  refreshSystemPromptPreview().catch(() => {});
}

function deleteKnowledgeLibrary(name) {
  sandboxState.knowledgeLibraries = sandboxState.knowledgeLibraries.filter(item => item.name !== name);
  renderKnowledgeLibraries();
  persistSandboxState();
}

function exportKnowledgeLibraries() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    source: 'crystelf-web-sandbox-knowledge-libraries',
    knowledgeLibraries: sandboxState.knowledgeLibraries,
  }, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sandbox-knowledge-library.json';
  link.click();
  URL.revokeObjectURL(url);
}

async function importKnowledgeLibraries(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('导入文件不是有效的模板库');
  }
  const imported = Array.isArray(parsed?.knowledgeLibraries) ? parsed.knowledgeLibraries : Array.isArray(parsed) ? parsed : [];
  if (imported.length === 0) {
    throw new Error('导入文件中没有可用知识库');
  }
  const merged = [...sandboxState.knowledgeLibraries];
  for (const item of imported) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    const library = { name, savedAt: String(item?.savedAt || ''), payload: item?.payload || {} };
    const index = merged.findIndex(existing => existing.name === name);
    if (index >= 0) merged[index] = library;
    else merged.unshift(library);
  }
  sandboxState.knowledgeLibraries = merged.slice(0, 50);
  renderKnowledgeLibraries();
  persistSandboxState();
}

function collectSnapshotPayload() {
  return {
    sessionId: document.getElementById('sandbox-session-id').value.trim(),
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
    systemPrompt: document.getElementById('sandbox-system-prompt').value,
    input: document.getElementById('sandbox-input').value,
  };
}

function applySnapshotPayload(payload = {}) {
  document.getElementById('sandbox-session-id').value = payload.sessionId || '';
  document.getElementById('sandbox-user-id').value = payload.userId || '';
  document.getElementById('sandbox-group-id').value = payload.groupId || '';
  document.getElementById('sandbox-user-name').value = payload.userName || '';
  document.getElementById('sandbox-bot-name').value = payload.botName || '';
  document.getElementById('sandbox-is-master').value = payload.isMaster || '';
  document.getElementById('sandbox-model').value = payload.model || '';
  document.getElementById('sandbox-temperature').value = payload.temperature || '';
  document.getElementById('sandbox-max-tokens').value = payload.maxTokens || '';
  document.getElementById('sandbox-context-note').value = payload.contextNote || '';
  document.getElementById('sandbox-group-history').value = payload.groupHistory || '';
  document.getElementById('sandbox-memories').value = payload.memories || '';
  document.getElementById('sandbox-knowledge-base').value = payload.knowledgeBase || '';
  document.getElementById('sandbox-knowledge-topk').value = payload.knowledgeTopK || '';
  document.getElementById('sandbox-system-prompt').value = payload.systemPrompt || '';
  document.getElementById('sandbox-input').value = payload.input || '';
  syncGroupHistoryEditorFromText();
  syncMemoryEditorFromText();
  syncKnowledgeEditorFromText();
}

function renderSnapshots() {
  const container = document.getElementById('sandbox-snapshot-list');
  container.innerHTML = sandboxState.snapshots.length > 0
    ? sandboxState.snapshots.map(item => `
      <div class="list-item">
        <h3>${escapeHtml(item.name)}</h3>
        <div>保存时间：${escapeHtml(item.savedAt || '未知')}</div>
        <div>会话：${escapeHtml(item.payload?.sessionId || '未设置')} · 模型：${escapeHtml(item.payload?.model || '跟随当前配置')}</div>
        <div class="actions">
          <button data-snapshot-action="load" data-snapshot-name="${escapeHtml(item.name)}">加载</button>
          <button class="danger" data-snapshot-action="delete" data-snapshot-name="${escapeHtml(item.name)}">删除</button>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无会话快照</div>';
  document.getElementById('sandbox-snapshot-status').textContent = `当前会话快照：${sandboxState.snapshots.length} 个`;
}

function saveCurrentAsSnapshot() {
  const name = document.getElementById('sandbox-snapshot-name').value.trim();
  if (!name) return;
  const payload = collectSnapshotPayload();
  const next = sandboxState.snapshots.filter(item => item.name !== name);
  next.unshift({ name, savedAt: new Date().toLocaleString('zh-CN', { hour12: false }), payload });
  sandboxState.snapshots = next.slice(0, 50);
  renderSnapshots();
  persistSandboxState();
}

function applySnapshot(name) {
  const snapshot = sandboxState.snapshots.find(item => item.name === name);
  if (!snapshot) return;
  applySnapshotPayload(snapshot.payload || {});
  persistSandboxState();
  refreshConfigStatus().catch(() => {});
  refreshSystemPromptPreview().catch(() => {});
}

function deleteSnapshot(name) {
  sandboxState.snapshots = sandboxState.snapshots.filter(item => item.name !== name);
  renderSnapshots();
  persistSandboxState();
}

function exportSnapshots() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    source: 'crystelf-web-sandbox-snapshots',
    snapshots: sandboxState.snapshots,
  }, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sandbox-snapshot-library.json';
  link.click();
  URL.revokeObjectURL(url);
}

async function importSnapshots(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('导入文件不是有效的快照库');
  }
  const imported = Array.isArray(parsed?.snapshots) ? parsed.snapshots : Array.isArray(parsed) ? parsed : [];
  if (imported.length === 0) {
    throw new Error('导入文件中没有可用快照');
  }
  const merged = [...sandboxState.snapshots];
  for (const item of imported) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    const snapshot = { name, savedAt: String(item?.savedAt || ''), payload: item?.payload || {} };
    const index = merged.findIndex(existing => existing.name === name);
    if (index >= 0) merged[index] = snapshot;
    else merged.unshift(snapshot);
  }
  sandboxState.snapshots = merged.slice(0, 50);
  renderSnapshots();
  persistSandboxState();
}

function persistSandboxState() {
  localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify({
    history: sandboxState.history,
    compareResult: sandboxState.compareResult,
    customTemplates: sandboxState.customTemplates,
    snapshots: sandboxState.snapshots,
    knowledgeLibraries: sandboxState.knowledgeLibraries,
    sessionId: document.getElementById('sandbox-session-id').value.trim(),
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
    input: document.getElementById('sandbox-input').value,
    systemPrompt: document.getElementById('sandbox-system-prompt').value,
    compareModelA: document.getElementById('sandbox-compare-model-a').value.trim(),
    compareModelB: document.getElementById('sandbox-compare-model-b').value.trim(),
    compareTempA: document.getElementById('sandbox-compare-temp-a').value.trim(),
    compareTempB: document.getElementById('sandbox-compare-temp-b').value.trim(),
    knowledgeBase: document.getElementById('sandbox-knowledge-base').value,
    knowledgeTopK: document.getElementById('sandbox-knowledge-topk').value.trim(),
    webReadUrl: document.getElementById('sandbox-web-read-url').value.trim(),
    webReadMaxLength: document.getElementById('sandbox-web-read-max-length').value.trim(),
    webReadResult: sandboxState.webReadResult,
    summary: document.getElementById('sandbox-summary').textContent,
    raw: document.getElementById('sandbox-raw').textContent,
  }));
}

function restoreSandboxState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SANDBOX_STORAGE_KEY) || '{}');
    sandboxState.history = Array.isArray(saved.history) ? saved.history : [];
    sandboxState.compareResult = saved.compareResult || null;
    sandboxState.customTemplates = Array.isArray(saved.customTemplates) ? saved.customTemplates : [];
    sandboxState.snapshots = Array.isArray(saved.snapshots) ? saved.snapshots : [];
    sandboxState.knowledgeLibraries = Array.isArray(saved.knowledgeLibraries) ? saved.knowledgeLibraries : [];
    document.getElementById('sandbox-session-id').value = saved.sessionId || '';
    document.getElementById('sandbox-user-id').value = saved.userId || '';
    document.getElementById('sandbox-group-id').value = saved.groupId || '';
    document.getElementById('sandbox-user-name').value = saved.userName || '';
    document.getElementById('sandbox-bot-name').value = saved.botName || '';
    document.getElementById('sandbox-is-master').value = saved.isMaster || '';
    document.getElementById('sandbox-model').value = saved.model || '';
    document.getElementById('sandbox-temperature').value = saved.temperature || '';
    document.getElementById('sandbox-max-tokens').value = saved.maxTokens || '';
    document.getElementById('sandbox-context-note').value = saved.contextNote || '';
    document.getElementById('sandbox-group-history').value = saved.groupHistory || '';
    document.getElementById('sandbox-memories').value = saved.memories || '';
    document.getElementById('sandbox-input').value = saved.input || '';
    document.getElementById('sandbox-system-prompt').value = saved.systemPrompt || '';
    document.getElementById('sandbox-compare-model-a').value = saved.compareModelA || '';
    document.getElementById('sandbox-compare-model-b').value = saved.compareModelB || '';
    document.getElementById('sandbox-compare-temp-a').value = saved.compareTempA || '';
    document.getElementById('sandbox-compare-temp-b').value = saved.compareTempB || '';
    document.getElementById('sandbox-knowledge-base').value = saved.knowledgeBase || '';
    document.getElementById('sandbox-knowledge-topk').value = saved.knowledgeTopK || '';
    document.getElementById('sandbox-web-read-url').value = saved.webReadUrl || '';
    document.getElementById('sandbox-web-read-max-length').value = saved.webReadMaxLength || '';
    sandboxState.webReadResult = saved.webReadResult || '';
    document.getElementById('sandbox-web-read-result').textContent = sandboxState.webReadResult || '尚未读取网页';
    document.getElementById('sandbox-summary').textContent = saved.summary || '尚未发送请求';
    document.getElementById('sandbox-raw').textContent = saved.raw || '尚无原始响应';
    syncGroupHistoryEditorFromText();
    syncMemoryEditorFromText();
    syncKnowledgeEditorFromText();
    renderRagMatches([]);
    renderRagDebug({});
  } catch {
    sandboxState.history = [];
    sandboxState.compareResult = null;
    sandboxState.customTemplates = [];
    sandboxState.snapshots = [];
    sandboxState.knowledgeLibraries = [];
    sandboxState.webReadResult = '';
  }
}

function applyTemplate(name) {
  const preset = SANDBOX_TEMPLATES[name];
  if (!preset) return;
  document.getElementById('sandbox-input').value = preset.prompt;
  document.getElementById('sandbox-system-prompt').value = preset.systemPrompt;
  persistSandboxState();
}

function applyCustomTemplate(name) {
  const preset = sandboxState.customTemplates.find(item => item.name === name);
  if (!preset) return;
  document.getElementById('sandbox-input').value = preset.prompt || '';
  document.getElementById('sandbox-system-prompt').value = preset.systemPrompt || '';
  persistSandboxState();
}

function saveCurrentAsTemplate() {
  const name = document.getElementById('sandbox-custom-template-name').value.trim();
  if (!name) return;
  const prompt = document.getElementById('sandbox-input').value;
  const systemPrompt = document.getElementById('sandbox-system-prompt').value;
  const next = sandboxState.customTemplates.filter(item => item.name !== name);
  next.unshift({ name, prompt, systemPrompt });
  sandboxState.customTemplates = next.slice(0, 20);
  renderCustomTemplates();
  renderSnapshots();
  persistSandboxState();
}

function deleteCustomTemplate(name) {
  sandboxState.customTemplates = sandboxState.customTemplates.filter(item => item.name !== name);
  renderCustomTemplates();
  persistSandboxState();
}

function normalizeImportedTemplates(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => ({
      name: String(item?.name || '').trim(),
      prompt: String(item?.prompt || ''),
      systemPrompt: String(item?.systemPrompt || ''),
    }))
    .filter(item => item.name)
    .slice(0, 50);
}

function exportCustomTemplates() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    source: 'crystelf-web-sandbox-templates',
    templates: sandboxState.customTemplates,
  }, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sandbox-template-library.json';
  link.click();
  URL.revokeObjectURL(url);
}

async function importCustomTemplates(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('导入文件不是有效的知识库');
  }
  const imported = normalizeImportedTemplates(parsed?.templates ?? parsed);
  if (imported.length === 0) {
    throw new Error('导入文件中没有可用模板');
  }
  const merged = [...sandboxState.customTemplates];
  for (const item of imported) {
    const index = merged.findIndex(existing => existing.name === item.name);
    if (index >= 0) {
      merged[index] = item;
    } else {
      merged.unshift(item);
    }
  }
  sandboxState.customTemplates = merged.slice(0, 50);
  renderCustomTemplates();
  persistSandboxState();
}

