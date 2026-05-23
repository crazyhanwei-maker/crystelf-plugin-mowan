function loadKnowledgeHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KNOWLEDGE_HISTORY_STORAGE_KEY) || '[]');
    pluginSettingsState.knowledgeHistory = Array.isArray(parsed) ? parsed : [];
  } catch {
    pluginSettingsState.knowledgeHistory = [];
  }
}

function persistKnowledgeHistory() {
  localStorage.setItem(KNOWLEDGE_HISTORY_STORAGE_KEY, JSON.stringify(pluginSettingsState.knowledgeHistory.slice(0, 20)));
}

function createKnowledgeHistoryEntry({ action, content, sources = [], query = '', mode = '', note = '' }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    content,
    query,
    mode,
    note,
    sources,
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  };
}

function pushKnowledgeHistory(entry) {
  pluginSettingsState.knowledgeHistory.unshift(entry);
  pluginSettingsState.knowledgeHistory = pluginSettingsState.knowledgeHistory.slice(0, 20);
  persistKnowledgeHistory();
}

function applyGeneratedKnowledgePreview() {
  const previewSegments = parseKnowledgePreview(pluginSettingsState.knowledgeGeneratePreview || '')
    .filter(segment => pluginSettingsState.knowledgeSelectedPreviewIds.length === 0 || pluginSettingsState.knowledgeSelectedPreviewIds.includes(segment.id));
  const preview = stringifyKnowledgeSegments(previewSegments).trim();
  if (!preview) {
    pluginSettingsState.knowledgeGenerateStatus = '当前没有可应用的生成结果';
    renderForm();
    return;
  }
  const field = 'ai.knowledgeBase';
  const current = String(pluginSettingsState.draft[field] || '').trim();
  if (current) {
    pushKnowledgeHistory(createKnowledgeHistoryEntry({
      action: 'before_apply',
      content: current,
      note: '应用生成结果前的知识库快照',
    }));
  }
  const next = pluginSettingsState.knowledgeGenerateMode === 'append' && current
    ? `${current}\n\n${preview}`
    : preview;
  pluginSettingsState.draft[field] = next;
  pushKnowledgeHistory(createKnowledgeHistoryEntry({
    action: 'apply_generated',
    content: next,
    query: pluginSettingsState.knowledgeGenerateQuery,
    mode: pluginSettingsState.knowledgeGenerateMode,
    sources: pluginSettingsState.knowledgeGenerateSources,
    note: '已将联网生成结果应用到知识库草稿',
  }));
  pluginSettingsState.knowledgeGenerateStatus = `已按“${pluginSettingsState.knowledgeGenerateMode === 'append' ? '追加' : '覆盖'}”模式应用生成结果，记得保存配置。`;
  pluginSettingsState.knowledgeGeneratePreview = '';
  pluginSettingsState.knowledgeSelectedPreviewIds = [];
  renderForm();
}

function restoreKnowledgeHistory(id) {
  const target = pluginSettingsState.knowledgeHistory.find(item => item.id === id);
  if (!target) return;
  pluginSettingsState.draft['ai.knowledgeBase'] = target.content || '';
  pluginSettingsState.knowledgeGenerateStatus = `已恢复版本：${target.createdAt}`;
  renderForm();
}

async function generateKnowledgeBaseFromWeb() {
  const query = String(pluginSettingsState.knowledgeGenerateQuery || '').trim();
  if (!query) {
    pluginSettingsState.knowledgeGenerateStatus = '请输入要联网生成的主题';
    renderForm();
    return;
  }
  pluginSettingsState.knowledgeGenerateLoading = true;
  pluginSettingsState.knowledgeGenerateStatus = '正在联网搜索并整理知识库，请稍候...';
  renderForm();
  try {
    const result = await postJson('/api/plugin-settings/knowledge-generate', { query });
    pluginSettingsState.knowledgeGeneratePreview = result.generatedKnowledgeBase || '';
    pluginSettingsState.knowledgeSelectedPreviewIds = parseKnowledgePreview(result.generatedKnowledgeBase || '').map(item => item.id);
    pluginSettingsState.knowledgeGenerateSources = Array.isArray(result.sources) ? result.sources : [];
    pushKnowledgeHistory(createKnowledgeHistoryEntry({
      action: 'generated',
      content: result.generatedKnowledgeBase || '',
      query,
      mode: pluginSettingsState.knowledgeGenerateMode,
      sources: pluginSettingsState.knowledgeGenerateSources,
      note: '联网生成的候选知识库结果',
    }));
    pluginSettingsState.knowledgeGenerateStatus = `已生成 ${parseKnowledgePreview(result.generatedKnowledgeBase || '').length} 条知识片段，请先预览，再决定追加或覆盖。`;
  } catch (error) {
    pluginSettingsState.knowledgeGenerateStatus = `生成失败：${error.message}`;
  } finally {
    pluginSettingsState.knowledgeGenerateLoading = false;
    renderForm();
  }
}

function parseKnowledgePreview(value = '') {
  return String(value || '')
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const [title = `知识片段${index + 1}`, maybeTags = '', ...rest] = lines;
      const hasTagsLine = /^标签[:：]/.test(maybeTags);
      return {
        id: `segment-${index + 1}`,
        title,
        tags: hasTagsLine ? maybeTags.replace(/^标签[:：]/, '').split(/[，,]/).map(item => item.trim()).filter(Boolean) : [],
        content: (hasTagsLine ? rest : [maybeTags, ...rest]).join('\n').trim(),
      };
    });
}

function stringifyKnowledgeSegments(segments = []) {
  return (segments || []).map(segment => [
    segment.title || '',
    Array.isArray(segment.tags) && segment.tags.length > 0 ? `标签:${segment.tags.join(',')}` : '',
    segment.content || '',
  ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}

function buildKnowledgeDiffSummary(current = '', target = '') {
  const currentSegments = parseKnowledgePreview(current);
  const targetSegments = parseKnowledgePreview(target);
  const currentTitles = new Set(currentSegments.map(item => item.title));
  const targetTitles = new Set(targetSegments.map(item => item.title));
  const added = targetSegments.filter(item => !currentTitles.has(item.title)).map(item => item.title);
  const removed = currentSegments.filter(item => !targetTitles.has(item.title)).map(item => item.title);
  return { added, removed, currentCount: currentSegments.length, targetCount: targetSegments.length };
}

function buildKnowledgeDemoText() {
  return [
    '验证功能',
    '标签:群管理,验证',
    '新成员进群后可开启验证，管理员可手动重置或绕过验证。',
    '',
    '欢迎功能',
    '标签:群管理,欢迎',
    '支持欢迎文案与欢迎图片配置。',
  ].join('\n');
}
