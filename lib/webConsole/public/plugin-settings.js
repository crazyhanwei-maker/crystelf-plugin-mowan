const pluginSettingsState = {
  payload: null,
  draft: {},
  activeCategory: 'main',
  activeGroup: '',
  activeTopTab: 'plugin-settings-config-panel',
  overview: null,
  editableConfig: null,
  navCollapsed: localStorage.getItem('crystelf-plugin-settings-nav-collapsed') === 'true',
  searchKeyword: '',
  knowledgeGenerateQuery: '',
  knowledgeGenerateLoading: false,
  knowledgeGenerateStatus: '',
  knowledgeGenerateSources: [],
  knowledgeGeneratePreview: '',
  knowledgeGenerateMode: 'replace',
  knowledgeHistory: [],
  knowledgeSelectedPreviewIds: [],
  knowledgeHistoryPreviewId: '',
  recommendationStatus: '',
  recommendationUndo: null,
  featureManageStatus: '',
  featureManageHistory: [],
  helpPreviewDataUrl: '',
  helpPreviewStatus: '',
  authStatus: null,
};

const KNOWLEDGE_HISTORY_STORAGE_KEY = 'crystelf-knowledge-history';
const FEATURE_MANAGE_HISTORY_STORAGE_KEY = 'crystelf-feature-manage-history';

const GROUP_DESCRIPTIONS = {
  '常用功能开关': '这里放最常开关的功能入口，适合先快速决定这个插件要启用哪些核心能力。',
  '群管理相关': '这里主要是进群、验证、欢迎这类和群成员管理有关的功能。',
  '内容与娱乐': '这里是订阅、点歌、日报等偏内容消费和娱乐互动的功能。',
  '戳一戳回复设置': '这里集中管理机器人被戳之后的回复策略。',
  '基础回复方式': '先决定戳一戳默认回文字、表情包还是语音。',
  '多媒体回复': '这里控制表情包和语音这类更有表现力的回复方式。',
  '频率与限制': '这里控制冷却、限频和单次最多回复多少条，避免刷屏。',
  '追踪接话': '这里决定机器人回复后，要不要继续观察后续群聊并按上下文自主接话。',
  '回复风格与渲染': '这里集中管理回复气质、适用群范围，以及代码和 Markdown 的展示效果。',
  '本地控制台设置': '这里是网页后台本身的相关设置。',
  '访问与安全': '这里控制后台能不能访问、是否需要登录、是否只读。',
  '网络与分页': '这里控制后台监听地址、端口和列表分页规模。',
  '日志与展示': '这里控制日志是否展示，以及后台各类详情页展示多少内容。',
  '插件维护': '这里是偏维护和调试用途的配置，普通用户一般不需要频繁改。',
  '基础设置': '这里是 AI 的基础接入信息，比如模型、接口和最基本的聊天参数。',
  '对话与会话': '这里控制聊天上下文、会话数量、历史抓取和回复相关的基础行为。',
  '故障降级': '这里设置 AI 出错、超时或联网失败时的兜底回复文案。',
  '知识库与人设': '这里决定 AI 的人设语气，以及本地知识库怎么参与回答。',
  '表情与多模态': '这里配置表情包、多模态识图和图片相关能力。',
  '高级设置': '这里放图片生成、辅助模型和其他偏进阶的 AI 能力。',
};

const GROUP_RECOMMENDATIONS = {
  '基础回复方式': '新手建议先开启文本回复，等基础效果稳定后再逐步加语音或表情包。',
  '多媒体回复': '建议先把表情包概率、语音概率调低一些，确认群里效果自然后再慢慢提高。',
  '频率与限制': '建议保留冷却和群限频，能明显减少刷屏和高频触发。',
  '追踪接话': '建议先把继续监听时长设短一些、观察条数设低一些，先观察真实群聊效果。',
  '回复风格与渲染': '建议先只调整回复风格和群范围；代码与 Markdown 渲染项更适合有明确展示需求时再改。',
  '访问与安全': '建议开启登录鉴权；如果只是自己本机调试，可以再决定要不要关闭只读模式。',
  '网络与分页': '如果只是个人调试，保持默认端口和分页通常就够用。',
  '对话与会话': '新手建议先保持默认会话上限和历史长度，先观察机器人在群里的响应是否稳定。',
  '故障降级': '建议先至少填一条通用失败回复；想更自然的话，再分别配置联网失败和超时失败。',
  '知识库与人设': '建议先写清楚机器人人设，再逐步补充知识库内容，不要一开始就塞太多长文本。',
  '表情与多模态': '如果模型成本敏感，建议先关闭多模态，确认纯文本效果后再打开。',
  '高级设置': '这一组更适合熟悉插件后再调整，初次使用可以先保持默认值。',
};

const FIELD_RECOMMENDATIONS = {
  'poke.enableTextReply': '推荐：开启',
  'poke.memeReplyProbability': '推荐：0.2 ~ 0.35',
  'poke.voiceReplyProbability': '推荐：0.1 ~ 0.25',
  'poke.cooldownMs': '推荐：15000',
  'poke.groupRateWindowMs': '推荐：60000',
  'poke.groupRateMaxReplies': '推荐：6',
  'poke.maxReplyMessages': '推荐：1 ~ 2',
  'poke.followGroupWindowMs': '推荐：5000 ~ 10000',
  'poke.followGroupMaxReplies': '推荐：1',
  'config.webConsoleReadOnly': '推荐：按需开启',
  'config.webConsolePort': '推荐：27891',
  'config.webConsolePageSize': '推荐：20',
  'config.webConsoleMaxPageSize': '推荐：100',
  'ai.temperature': '推荐：0.8 ~ 1.0',
  'ai.maxSessions': '推荐：10 ~ 20',
  'ai.fallbackGenericReply': '推荐：至少填写 1 条',
  'ai.knowledgeTopK': '推荐：3',
  'ai.character': '推荐：按当前表情包资源选择',
  'ai.multimodalEnabled': '推荐：按模型成本决定',
};

const FIELD_RECOMMENDATION_VALUES = {
  'poke.enableTextReply': true,
  'poke.memeReplyProbability': 0.3,
  'poke.voiceReplyProbability': 0.2,
  'poke.cooldownMs': 15000,
  'poke.groupRateWindowMs': 60000,
  'poke.groupRateMaxReplies': 6,
  'poke.maxReplyMessages': 2,
  'poke.followGroupWindowMs': 8000,
  'poke.followGroupMaxReplies': 1,
  'config.webConsoleReadOnly': true,
  'config.webConsolePort': 27891,
  'config.webConsolePageSize': 20,
  'config.webConsoleMaxPageSize': 100,
  'ai.temperature': 0.9,
  'ai.maxSessions': 15,
  'ai.knowledgeTopK': 3,
};

function isRecommendationMatched(field, value) {
  if (!Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, field)) {
    return false;
  }
  const expected = FIELD_RECOMMENDATION_VALUES[field];
  if (typeof expected === 'number') {
    return Number(value) === expected;
  }
  if (typeof expected === 'boolean') {
    return Boolean(value) === expected;
  }
  if (Array.isArray(expected)) {
    return JSON.stringify(value || []) === JSON.stringify(expected);
  }
  return String(value ?? '') === String(expected);
}

function renderFieldHead(item, typeLabel) {
  const recommendation = FIELD_RECOMMENDATIONS[item.field];
  const canApplyRecommendation = Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field);
  const currentValue = pluginSettingsState.draft[item.field];
  const matched = isRecommendationMatched(item.field, currentValue);
  return `
    <div class="plugin-settings-field-head">
      <div class="kv-label">${escapeHtml(item.label)}</div>
      <div class="plugin-settings-field-tags">
        ${recommendation ? `<button type="button" class="tag ${matched ? 'plugin-settings-recommendation-tag matched' : 'plugin-settings-recommendation-tag'}" data-apply-recommendation="${escapeHtml(item.field)}" ${canApplyRecommendation ? '' : 'disabled'}>${escapeHtml(matched ? `${recommendation} · 已命中` : recommendation)}</button>` : ''}
        <span class="tag">${escapeHtml(typeLabel)}</span>
      </div>
    </div>
  `;
}

function getFieldTone(item) {
  const field = String(item.field || '').toLowerCase();
  const fieldName = field.split('.').pop() || '';
  if (item.readonly) return 'readonly';
  if (
    item.component === 'InputPassword' ||
    fieldName.endsWith('token') ||
    fieldName.endsWith('apikey') ||
    fieldName.endsWith('password') ||
    fieldName.endsWith('secret')
  ) {
    return 'danger';
  }
  if (Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field)) return 'recommended';
  return 'normal';
}

function renderFieldMeta(item) {
  const tone = getFieldTone(item);
  const toneLabelMap = {
    readonly: '只读字段',
    danger: '敏感字段',
    recommended: '推荐字段',
    normal: '普通字段',
  };
  return `
    <div class="plugin-settings-field-meta">
      <span class="plugin-settings-field-path">${escapeHtml(item.field || '')}</span>
      <span class="plugin-settings-field-tone plugin-settings-field-tone-${tone}">${escapeHtml(toneLabelMap[tone])}</span>
    </div>
  `;
}

function renderFieldNotice(item) {
  const tone = getFieldTone(item);
  if (tone === 'danger') {
    return '<div class="plugin-settings-field-notice plugin-settings-field-notice-danger">该字段包含登录口令或其他敏感凭证，建议仅在可信环境下修改，并避免直接展示给其他人。</div>';
  }
  if (tone === 'recommended') {
    const recommendation = FIELD_RECOMMENDATIONS[item.field] || '建议优先使用推荐值';
    return `<div class="plugin-settings-field-notice plugin-settings-field-notice-recommended">${escapeHtml(recommendation)}</div>`;
  }
  return '';
}

function buildFieldCardClasses(item, matched = false, extra = '') {
  const tone = getFieldTone(item);
  return ['setting-item', 'plugin-settings-field-card', `plugin-settings-field-card-${tone}`, matched ? 'plugin-settings-field-card-matched' : '', extra]
    .filter(Boolean)
    .join(' ');
}

function renderPanelMetaChips(chips = []) {
  return chips.map(chip => `<span class="plugin-settings-meta-chip ${chip.tone ? `tone-${chip.tone}` : ''}">${escapeHtml(chip.label)}</span>`).join('');
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function isMatchedBySearch(item, keyword = pluginSettingsState.searchKeyword) {
  if (!keyword) return true;
  const haystack = [
    item.category,
    item.group,
    item.label,
    item.field,
    item.bottomHelpMessage,
  ].join(' ').toLowerCase();
  return haystack.includes(keyword);
}

function buildHeaders(extra = {}) {
  return { ...extra };
}

function setPluginSettingsRisk(message = '', hidden = false) {
  const box = document.getElementById('plugin-settings-risk');
  if (!box) return;
  box.textContent = String(message || '');
  box.classList.toggle('hidden', hidden || !message);
}

async function fetchPluginSettingsAuthStatus() {
  const auth = window.CrystelfAuth;
  if (!auth?.fetchAuthStatus) {
    return pluginSettingsState.authStatus;
  }
  try {
    return await auth.fetchAuthStatus();
  } catch {
    return auth.status || pluginSettingsState.authStatus;
  }
}

function applyBootstrapModeUi() {
  const bootstrapMode = pluginSettingsState.authStatus?.bootstrapMode === true;
  const saveButton = document.getElementById('plugin-settings-save-btn');
  const meta = document.getElementById('plugin-settings-meta');
  const summary = document.getElementById('plugin-settings-summary');
  const consoleBox = document.getElementById('plugin-settings-console-box');

  document.querySelectorAll('[data-plugin-top-tab]').forEach(button => {
    button.disabled = bootstrapMode && button.dataset.pluginTopTab !== 'plugin-settings-console-panel';
  });

  consoleBox?.querySelectorAll('[data-field], [data-switch-field]').forEach(control => {
    const field = control.dataset.field || control.dataset.switchField || '';
    const tokenOnly = field === 'config.webConsoleToken';
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      control.readOnly = bootstrapMode && !tokenOnly;
      control.disabled = false;
      return;
    }
    if (control instanceof HTMLSelectElement || control instanceof HTMLButtonElement) {
      control.disabled = bootstrapMode && !tokenOnly;
    }
  });

  if (saveButton) {
    saveButton.textContent = bootstrapMode ? '保存并完成初始化' : '保存插件设置';
  }

  if (meta) {
    meta.textContent = bootstrapMode
      ? '首次初始化仅允许本机进入，请先在控制台设置登录口令，保存后再重新登录。'
      : '基于锅巴配置项渲染，按分类与分组管理。';
  }

  if (bootstrapMode) {
    pluginSettingsState.activeTopTab = 'plugin-settings-console-panel';
    switchPluginTopTab('plugin-settings-console-panel');
    if (summary) {
      summary.textContent = '首次初始化：请先设置控制台登录口令';
    }
    setPluginSettingsRisk('首次初始化仅允许本机访问。请先在“控制台设置”中填写“控制台登录口令”，保存后将跳转到登录页。');
    window.requestAnimationFrame(() => {
      document.querySelector('[data-field="config.webConsoleToken"]')?.focus();
    });
    return;
  }

  if (summary && summary.textContent === '首次初始化：请先设置控制台登录口令') {
    summary.textContent = '正在加载设置项...';
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store', headers: buildHeaders() });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return await response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(data.error || `${url} -> ${response.status}`);
  return data;
}

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

function loadFeatureManageHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FEATURE_MANAGE_HISTORY_STORAGE_KEY) || '[]');
    pluginSettingsState.featureManageHistory = Array.isArray(parsed) ? parsed : [];
  } catch {
    pluginSettingsState.featureManageHistory = [];
  }
}

function persistFeatureManageHistory() {
  localStorage.setItem(FEATURE_MANAGE_HISTORY_STORAGE_KEY, JSON.stringify(pluginSettingsState.featureManageHistory.slice(0, 10)));
}

function pushFeatureManageHistory(action, message, success = true) {
  pluginSettingsState.featureManageHistory.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    message,
    success,
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  });
  pluginSettingsState.featureManageHistory = pluginSettingsState.featureManageHistory.slice(0, 10);
  persistFeatureManageHistory();
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function getVisibleItems() {
  const items = pluginSettingsState.payload?.items || [];
  return items.filter(item => item.category === pluginSettingsState.activeCategory && item.group === pluginSettingsState.activeGroup && isMatchedBySearch(item));
}

function isAiKnowledgeField(field = '') {
  return ['ai.knowledgeBaseEnabled', 'ai.knowledgeTopK', 'ai.knowledgeBase'].includes(field);
}

function switchPluginTopTab(tabId) {
  if (pluginSettingsState.authStatus?.bootstrapMode === true && tabId !== 'plugin-settings-console-panel') {
    tabId = 'plugin-settings-console-panel';
  }
  pluginSettingsState.activeTopTab = tabId;
  document.querySelectorAll('[data-plugin-top-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.pluginTopTab === tabId);
  });
  document.querySelectorAll('#plugin-settings-config-panel, #plugin-settings-features-panel, #plugin-settings-console-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== tabId);
  });
  document.getElementById('plugin-settings-config-nav')?.classList.toggle('hidden', tabId !== 'plugin-settings-config-panel');
}

function syncNavCollapsedState() {
  document.getElementById('plugin-settings-shell')?.classList.toggle('nav-collapsed', pluginSettingsState.navCollapsed);
  const button = document.getElementById('plugin-settings-nav-toggle-btn');
  if (button) {
    button.textContent = pluginSettingsState.navCollapsed ? '展开导航' : '收起导航';
  }
}

function renderCategoryTabs() {
  const categories = pluginSettingsState.payload?.categories || [];
  const items = pluginSettingsState.payload?.items || [];
  const visibleCategories = categories.filter(category => items.some(item => item.category === category.key && isMatchedBySearch(item)));
  if (!visibleCategories.some(item => item.key === pluginSettingsState.activeCategory)) {
    pluginSettingsState.activeCategory = visibleCategories[0]?.key || categories[0]?.key || 'main';
  }
  const container = document.getElementById('plugin-settings-category-tabs');
  container.innerHTML = visibleCategories.map(item => {
    const count = items.filter(entry => entry.category === item.key && isMatchedBySearch(entry)).length;
    return `
    <button class="settings-tab-btn ${pluginSettingsState.activeCategory === item.key ? 'active' : ''}" data-settings-category="${item.key}">${escapeHtml(item.label)} (${count})</button>
  `;
  }).join('');
}

function renderGroupTabs() {
  const items = pluginSettingsState.payload?.items || [];
  const groups = [...new Set(items.filter(item => item.category === pluginSettingsState.activeCategory && isMatchedBySearch(item)).map(item => item.group))];
  if (!pluginSettingsState.activeGroup || !groups.includes(pluginSettingsState.activeGroup)) {
    pluginSettingsState.activeGroup = groups[0] || '';
  }
  const container = document.getElementById('plugin-settings-group-tabs');
  container.innerHTML = groups.map(group => {
    const count = items.filter(item => item.category === pluginSettingsState.activeCategory && item.group === group && isMatchedBySearch(item)).length;
    return `
    <button class="plugin-settings-group-btn ${pluginSettingsState.activeGroup === group ? 'active' : ''}" data-settings-group="${escapeHtml(group)}">
      <span>${escapeHtml(group)}</span>
      <span class="plugin-settings-group-count">${count}</span>
    </button>
  `;
  }).join('');
}

function renderField(item) {
  const value = pluginSettingsState.draft[item.field];
  const props = item.componentProps || {};
  const readonly = item.readonly ? 'readonly' : '';
  const typeLabel = item.readonly ? '只读' : item.component;
  const matched = isRecommendationMatched(item.field, value);
  if (item.component === 'Switch') {
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
        <div class="plugin-settings-field-head">
          <div class="kv-label">${escapeHtml(item.label)}</div>
          <span class="tag">${escapeHtml(typeLabel)}</span>
        </div>
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <button class="plugin-settings-switch ${value ? '' : 'off'}" data-switch-field="${item.field}">${value ? '已开启' : '已关闭'}</button>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  if (item.component === 'InputTextArea') {
    if (item.field === 'ai.knowledgeBase') {
      const segments = parseKnowledgePreview(value ?? '');
      const previewSegments = parseKnowledgePreview(pluginSettingsState.knowledgeGeneratePreview || '');
      const historyPreview = pluginSettingsState.knowledgeHistory.find(item => item.id === pluginSettingsState.knowledgeHistoryPreviewId);
      const diffSummary = historyPreview ? buildKnowledgeDiffSummary(pluginSettingsState.draft['ai.knowledgeBase'] || '', historyPreview.content || '') : null;
      return `
        <div class="${buildFieldCardClasses(item, matched, 'plugin-settings-knowledge-card')}">
          <div class="plugin-settings-field-head">
            <div class="kv-label">${escapeHtml(item.label)}</div>
            <span class="tag">${escapeHtml(typeLabel)}</span>
          </div>
          ${renderFieldMeta(item)}
          ${renderFieldNotice(item)}
          <div class="plugin-settings-knowledge-toolbar">
            <input data-knowledge-generator-query placeholder="输入主题，例如：崩坏星穹铁道角色培养" value="${escapeHtml(pluginSettingsState.knowledgeGenerateQuery || '')}" />
            <button type="button" data-knowledge-generator-action="generate">${pluginSettingsState.knowledgeGenerateLoading ? '生成中...' : '联网生成知识库'}</button>
            <select data-knowledge-generate-mode>
              <option value="replace" ${pluginSettingsState.knowledgeGenerateMode === 'replace' ? 'selected' : ''}>覆盖模式</option>
              <option value="append" ${pluginSettingsState.knowledgeGenerateMode === 'append' ? 'selected' : ''}>追加模式</option>
            </select>
            <button type="button" data-knowledge-generator-action="apply">应用生成结果</button>
            <button type="button" data-knowledge-editor-action="fill-demo">填入示例</button>
            <button type="button" data-knowledge-editor-action="clear">清空内容</button>
            <span class="setting-status">共 ${segments.length} 条知识片段</span>
          </div>
          <div class="setting-help">${escapeHtml(pluginSettingsState.knowledgeGenerateStatus || '可输入主题后点击“联网生成知识库”，让后台搜索资料并自动整理为 RAG 知识。')}</div>
          ${pluginSettingsState.knowledgeGenerateSources.length > 0 ? `<div class="plugin-settings-knowledge-preview">${pluginSettingsState.knowledgeGenerateSources.map((item, index) => `<div class="plugin-settings-knowledge-segment"><div class="plugin-settings-knowledge-segment-head"><strong>来源 ${index + 1}. ${escapeHtml(item.title || '未命名来源')}</strong></div><div class="plugin-settings-knowledge-content">${escapeHtml(item.snippet || item.url || '')}</div></div>`).join('')}</div>` : ''}
          ${previewSegments.length > 0 ? `<div class="plugin-settings-knowledge-preview plugin-settings-knowledge-preview-pending"><div class="setting-status">生成结果预览（尚未写入知识库草稿）</div>${previewSegments.map((segment, index) => `<label class="plugin-settings-knowledge-segment plugin-settings-knowledge-selectable"><div class="plugin-settings-knowledge-segment-head"><strong>${index + 1}. ${escapeHtml(segment.title || '未命名片段')}</strong><input type="checkbox" data-knowledge-preview-id="${escapeHtml(segment.id)}" ${pluginSettingsState.knowledgeSelectedPreviewIds.includes(segment.id) ? 'checked' : ''} /></div>${segment.tags.length > 0 ? `<div class="plugin-settings-knowledge-tags">${segment.tags.map(tag => `<span class="sandbox-rag-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}<div class="plugin-settings-knowledge-content">${escapeHtml(segment.content || '（无正文）')}</div></label>`).join('')}</div>` : ''}
          <textarea data-field="${item.field}" rows="${props.rows || 12}" placeholder="${escapeHtml(props.placeholder || '')}" ${readonly}>${escapeHtml(value ?? '')}</textarea>
          <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
          <div class="plugin-settings-knowledge-preview">
            ${segments.length > 0 ? segments.map((segment, index) => `
              <div class="plugin-settings-knowledge-segment">
                <div class="plugin-settings-knowledge-segment-head">
                  <strong>${index + 1}. ${escapeHtml(segment.title || '未命名片段')}</strong>
                  ${segment.tags.length > 0 ? `<div class="plugin-settings-knowledge-tags">${segment.tags.map(tag => `<span class="sandbox-rag-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
                </div>
                <div class="plugin-settings-knowledge-content">${escapeHtml(segment.content || '（无正文）')}</div>
              </div>
            `).join('') : '<div class="setting-status">当前还没有配置知识片段</div>'}
          </div>
          <div class="plugin-settings-knowledge-history">
            <div class="plugin-settings-field-head">
              <div class="kv-label">知识库版本历史</div>
              <span class="tag">最近 ${pluginSettingsState.knowledgeHistory.length} 条</span>
            </div>
            ${pluginSettingsState.knowledgeHistory.length > 0 ? pluginSettingsState.knowledgeHistory.map(item => `<div class="plugin-settings-knowledge-history-item"><div><strong>${escapeHtml(item.createdAt)}</strong> · ${escapeHtml(item.note || item.action || '历史版本')}</div><div class="setting-help">${escapeHtml(item.query ? `主题：${item.query}` : '手动/应用生成结果形成的版本')}</div><div class="plugin-settings-knowledge-tags">${item.mode ? `<span class="sandbox-rag-tag">${escapeHtml(item.mode === 'append' ? '追加' : '覆盖')}</span>` : ''}${Array.isArray(item.sources) ? item.sources.slice(0, 3).map(source => `<span class="sandbox-rag-token">${escapeHtml(source.title || '来源')}</span>`).join('') : ''}</div><div class="plugin-settings-knowledge-history-actions"><button type="button" data-knowledge-history-action="preview" data-knowledge-history-id="${escapeHtml(item.id)}">预览差异</button><button type="button" data-knowledge-history-action="restore" data-knowledge-history-id="${escapeHtml(item.id)}">恢复此版本</button></div></div>`).join('') : '<div class="setting-status">当前还没有知识库版本历史</div>'}
            ${historyPreview ? `<div class="plugin-settings-knowledge-preview plugin-settings-knowledge-history-preview"><div class="setting-status">版本预览：${escapeHtml(historyPreview.createdAt)}</div><div class="setting-help">当前草稿 ${diffSummary?.currentCount ?? 0} 条 → 历史版本 ${diffSummary?.targetCount ?? 0} 条；新增 ${diffSummary?.added.length ?? 0} 条，移除 ${diffSummary?.removed.length ?? 0} 条。</div>${diffSummary?.added.length ? `<div class="plugin-settings-knowledge-tags">${diffSummary.added.map(item => `<span class="sandbox-rag-tag">新增：${escapeHtml(item)}</span>`).join('')}</div>` : ''}${diffSummary?.removed.length ? `<div class="plugin-settings-knowledge-tags">${diffSummary.removed.map(item => `<span class="sandbox-rag-token">移除：${escapeHtml(item)}</span>`).join('')}</div>` : ''}<div class="plugin-settings-knowledge-content">${escapeHtml(historyPreview.content || '（无内容）')}</div></div>` : ''}
          </div>
        </div>
      `;
    }
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
        ${renderFieldHead(item, typeLabel)}
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <textarea data-field="${item.field}" rows="${props.rows || 4}" placeholder="${escapeHtml(props.placeholder || '')}" ${readonly}>${escapeHtml(value ?? '')}</textarea>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  if (item.component === 'Select') {
    const multiple = props.mode === 'multiple';
    const currentValues = multiple ? (Array.isArray(value) ? value : []) : [value];
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
        ${renderFieldHead(item, multiple ? '多选' : typeLabel)}
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <select data-field="${item.field}" ${multiple ? 'multiple' : ''} ${readonly}>
          ${(props.options || []).map(option => `<option value="${escapeHtml(option.value)}" ${currentValues.includes(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
        </select>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  if (item.component === 'InputArray') {
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
      ${renderFieldHead(item, '列表')}
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <textarea data-field="${item.field}" rows="4" placeholder="每行一项" ${readonly}>${escapeHtml((Array.isArray(value) ? value : []).join('\n'))}</textarea>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  const type = item.component === 'InputPassword' ? 'password' : 'text';
  const inputHtml = `<input type="${type}" data-field="${item.field}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(props.placeholder || '')}" ${type === 'password' ? 'autocomplete="new-password"' : ''} ${readonly} />`;
  return `
    <div class="${buildFieldCardClasses(item, matched)}">
      ${renderFieldHead(item, typeLabel)}
      ${renderFieldMeta(item)}
      ${renderFieldNotice(item)}
      ${type === 'password'
        ? `<form class="inline-field-form" onsubmit="return false;">
            <input class="visually-hidden" type="text" autocomplete="username" tabindex="-1" aria-hidden="true" />
            ${inputHtml}
          </form>`
        : inputHtml}
      <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
    </div>
  `;
}

function renderForm() {
  const items = getVisibleItems();
  const knowledgeItems = pluginSettingsState.activeCategory === 'ai' ? items.filter(item => isAiKnowledgeField(item.field)) : [];
  const normalItems = pluginSettingsState.activeCategory === 'ai' ? items.filter(item => !isAiKnowledgeField(item.field)) : items;
  const category = (pluginSettingsState.payload?.categories || []).find(item => item.key === pluginSettingsState.activeCategory);
  const recommendableItems = normalItems.filter(item => Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field));
  const knowledgePanel = knowledgeItems.length > 0 ? `
    <section class="plugin-settings-special-panel plugin-settings-knowledge-panel">
      <div class="plugin-settings-special-panel-head">
        <div>
          <h3>RAG 知识库面板</h3>
          <div class="setting-status">集中管理真实机器人聊天使用的本地知识库开关、召回条数与正文内容。</div>
        </div>
      </div>
      <div class="plugin-settings-special-panel-grid">
        ${knowledgeItems.map(renderField).join('')}
      </div>
    </section>
  ` : '';
  document.getElementById('plugin-settings-form').innerHTML = (knowledgePanel || '') + (normalItems.length > 0
    ? normalItems.map(renderField).join('')
    : '<div class="setting-item">当前分组暂无可展示配置项</div>');
  const summaryEl = document.getElementById('plugin-settings-summary');
  if (recommendableItems.length > 0) {
    summaryEl.innerHTML = `${escapeHtml(category?.label || pluginSettingsState.activeCategory)} / ${escapeHtml(pluginSettingsState.activeGroup)} / ${items.length} 项 <button type="button" class="tag" data-apply-group-recommendation="1">应用本组推荐配置</button>`;
  } else {
    summaryEl.textContent = `${category?.label || pluginSettingsState.activeCategory} / ${pluginSettingsState.activeGroup} / ${items.length} 项`;
  }
  document.getElementById('plugin-settings-group-title').textContent = pluginSettingsState.activeGroup || '配置项';
  const groupDescription = GROUP_DESCRIPTIONS[pluginSettingsState.activeGroup] || '当前分组下集中展示同一类配置，方便按使用场景快速调整。';
  const groupRecommendation = GROUP_RECOMMENDATIONS[pluginSettingsState.activeGroup] || '';
  document.getElementById('plugin-settings-group-desc').textContent = `${groupDescription}${groupRecommendation ? ` 新手建议：${groupRecommendation}` : ''} 当前共 ${items.length} 项。${pluginSettingsState.searchKeyword ? ` 当前搜索：${pluginSettingsState.searchKeyword}` : ''}`;
  document.getElementById('plugin-settings-search-status').textContent = pluginSettingsState.recommendationStatus || (pluginSettingsState.searchKeyword
    ? `当前搜索：${pluginSettingsState.searchKeyword}，已按结果过滤分类、分组和字段。`
    : '可搜索分类、分组、字段名和说明。');
  document.getElementById('plugin-settings-config-meta').innerHTML = renderPanelMetaChips([
    { label: `分类：${category?.label || pluginSettingsState.activeCategory || '未选择'}` },
    { label: `分组：${pluginSettingsState.activeGroup || '未选择'}` },
    { label: `字段：${items.length} 项`, tone: 'info' },
    ...(pluginSettingsState.searchKeyword ? [{ label: `搜索：${pluginSettingsState.searchKeyword}`, tone: 'warning' }] : []),
  ]);
}

function renderFeatureSection() {
  const data = pluginSettingsState.overview || {};
  const runtime = data.webConsoleRuntime || {};
  const backup = data.featureToggleBackup || {};
  const descriptions = {
    ai: '群聊 AI 主功能',
    music: '点歌与音乐能力',
    rss: 'RSS 推送能力',
    auth: '入群验证能力',
    poke: '戳一戳能力',
    webConsole: '本地控制台入口',
    affinity: '好感度系统',
    userProfile: '用户画像系统',
    tts: '语音工具能力',
  };
  const actionPanel = `
    <div class="plugin-settings-feature-toolbox">
      <div class="setting-item plugin-settings-feature-panel-card">
        <div class="plugin-settings-feature-panel-head">
          <div class="kv-label">功能开关工具面板</div>
          <div class="setting-status">按操作类型分区，避免把危险操作、备份操作和预览操作混在一起。</div>
        </div>
        <div class="plugin-settings-feature-action-groups">
          <div class="plugin-settings-feature-action-group">
            <div class="plugin-settings-feature-action-title">开关操作</div>
            <div class="actions plugin-settings-feature-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-feature-manage="enable_all">全部开启</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-danger" data-feature-manage="disable_all">全部关闭</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-warning" data-feature-manage="reset">重置默认</button>
            </div>
            <div class="setting-help">适合快速切换当前插件的整体启用状态，危险操作已保留确认提示。</div>
          </div>
          <div class="plugin-settings-feature-action-group">
            <div class="plugin-settings-feature-action-title">备份与导出</div>
            <div class="actions plugin-settings-feature-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="backup">备份</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="restore">恢复</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="export_current">导出当前</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="export_backup">导出备份</button>
            </div>
            <div class="setting-help">${escapeHtml(backup.hasBackup ? `当前备份时间：${backup.savedAt || '未知'}` : '当前还没有功能开关备份。')}</div>
          </div>
          <div class="plugin-settings-feature-action-group">
            <div class="plugin-settings-feature-action-title">帮助图预览</div>
            <div class="actions plugin-settings-feature-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-help-preview="1">预览帮助图</button>
              ${pluginSettingsState.helpPreviewDataUrl ? '<button type="button" data-feature-help-open="1">新窗口打开</button><button type="button" data-feature-help-download="1">下载 PNG</button>' : ''}
            </div>
            <div class="setting-help">${escapeHtml(pluginSettingsState.helpPreviewStatus || '可直接在后台生成最新主人功能开关帮助图预览。')}</div>
          </div>
        </div>
        <div class="setting-help">${escapeHtml(pluginSettingsState.featureManageStatus || '这里提供网页后台的一键功能开关管理。')}</div>
      </div>
      <div class="setting-item plugin-settings-feature-panel-card">
        <div class="plugin-settings-feature-panel-head">
          <div class="kv-label">帮助图预览</div>
          <div class="setting-status">这里展示当前生成出的主人功能开关帮助图，可直接打开或下载。</div>
        </div>
        ${pluginSettingsState.helpPreviewDataUrl
          ? `<div class="plugin-settings-help-preview"><img src="${pluginSettingsState.helpPreviewDataUrl}" alt="帮助图预览" /></div>`
          : '<div class="plugin-settings-help-preview plugin-settings-help-preview-empty"><div class="setting-help">当前还没有生成帮助图预览，点击上方“预览帮助图”即可生成。</div></div>'}
      </div>
      <div class="setting-item plugin-settings-feature-panel-card">
        <div class="plugin-settings-feature-panel-head">
          <div class="kv-label">最近操作记录</div>
          <div class="setting-status">保留最近的功能开关操作结果，方便回看刚刚做了什么。</div>
        </div>
        <div class="plugin-settings-feature-history">
          ${pluginSettingsState.featureManageHistory.length > 0
            ? pluginSettingsState.featureManageHistory.map(item => `
              <div class="plugin-settings-feature-history-item ${item.success ? '' : 'tone-error'}">
                <div><strong>${escapeHtml(item.createdAt)}</strong> · ${escapeHtml(item.action)}</div>
                <div class="setting-help">${escapeHtml(item.message)}</div>
              </div>
            `).join('')
            : '<div class="setting-help">当前还没有操作记录。</div>'}
        </div>
      </div>
    </div>
  `;
  document.getElementById('plugin-settings-feature-list').innerHTML = actionPanel + Object.entries(data.features || {})
    .map(([key, enabled]) => `
      <div class="feature-toggle-card ${enabled ? '' : 'off'}">
        <div class="feature-toggle-head">
          <span class="feature-toggle-name">${escapeHtml(key)}</span>
          <span class="feature-toggle-state">${enabled ? '开启' : '关闭'}</span>
        </div>
        <div class="feature-toggle-desc">${escapeHtml(descriptions[key] || '功能开关')}</div>
        ${key === 'webConsole' ? `<div class="feature-toggle-source">运行状态：${runtime.running ? `已运行（${escapeHtml(runtime.url || '')}）` : '未运行或需重启后生效'}</div>` : ''}
      </div>
    `).join('');
  document.getElementById('plugin-settings-features-meta').innerHTML = renderPanelMetaChips([
    { label: `功能：${Object.keys(data.features || {}).length} 个`, tone: 'info' },
    { label: runtime.running ? '控制台：运行中' : '控制台：未运行', tone: runtime.running ? 'success' : 'warning' },
    { label: backup.hasBackup ? `备份：${backup.savedAt || '已存在'}` : '备份：暂无', tone: backup.hasBackup ? 'success' : 'warning' },
  ]);
}

function renderConsoleSection() {
  const runtime = pluginSettingsState.editableConfig?.webConsole || {};
  const itemMap = new Map((pluginSettingsState.payload?.items || []).map(item => [item.field, item]));
  const renderConsoleFieldSection = (title, description, fields) => {
    const sectionItems = fields.map(field => itemMap.get(field)).filter(Boolean);
    if (sectionItems.length === 0) return '';
    return `
      <section class="plugin-settings-special-panel">
        <div class="plugin-settings-special-panel-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <div class="setting-status">${escapeHtml(description)}</div>
          </div>
          <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
            { label: `字段：${sectionItems.length} 项`, tone: 'info' },
          ])}</div>
        </div>
        <div class="plugin-settings-special-panel-grid">
          ${sectionItems.map(renderField).join('')}
        </div>
      </section>
    `;
  };

  const runtimeSection = `
    <section class="plugin-settings-special-panel">
      <div class="plugin-settings-special-panel-head">
        <div>
          <h3>运行状态</h3>
          <div class="setting-status">先确认控制台当前是否真的跑起来，再决定是否调整访问参数。</div>
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: runtime.runtimeRunning ? '当前：已运行' : '当前：未运行', tone: runtime.runtimeRunning ? 'success' : 'warning' },
        ])}</div>
      </div>
      <div class="plugin-settings-special-panel-grid">
        <div class="setting-item">
          <div class="kv-label">运行状态</div>
          <div class="kv-value">${escapeHtml(runtime.runtimeRunning ? `已运行（${runtime.runtimeUrl || '地址未知'}）` : '未运行或需重启后生效')}</div>
          <div class="setting-help">这里展示的是当前控制台服务实例的实际运行状态，不等于仅配置层状态。</div>
        </div>
      </div>
    </section>
  `;

  const sections = [
    runtimeSection,
    renderConsoleFieldSection('访问与安全', '控制台是否启用、是否只读，以及登录口令等安全项。控制台网页始终要求登录。', [
      'config.webConsole',
      'config.webConsoleReadOnly',
      'config.webConsoleToken',
    ]),
    renderConsoleFieldSection('网络与分页', '控制台监听地址、端口冲突处理，以及列表分页规模。', [
      'config.webConsoleHost',
      'config.webConsolePort',
      'config.webConsolePortAutoIncrement',
      'config.webConsolePageSize',
      'config.webConsoleMaxPageSize',
    ]),
    renderConsoleFieldSection('日志与展示', '控制日志是否暴露、敏感信息是否脱敏，以及详情页展示上限。', [
      'config.webConsoleExposeLogs',
      'config.webConsoleMaskSensitiveConfig',
      'config.webConsoleLogTailLength',
      'config.webConsoleProfileRecentMessagesLimit',
      'config.webConsoleAffinityHistoryLimit',
    ]),
    renderConsoleFieldSection('API 超时', '常用接口的请求超时时间。优先先调这里，再决定是否补保底文案。', [
      'ai.timeout',
      'ai.imageConfig.timeout',
      'imageMonitor.analysisTimeoutMs',
      'coreConfig.tools.search.timeoutMs',
    ]),
    renderConsoleFieldSection('API 保底文案', '接口失败或超时后的兜底文案。图像生成支持回退到 AI 通用保底，图片监控留空则保持静默。', [
      'ai.imageConfig.fallbackReply',
      'ai.imageConfig.fallbackTimeoutReply',
      'imageMonitor.fallbackReply',
      'imageMonitor.fallbackTimeoutReply',
    ]),
  ].filter(Boolean);

  document.getElementById('plugin-settings-console-box').innerHTML = sections.join('');
  document.getElementById('plugin-settings-console-meta').innerHTML = renderPanelMetaChips([
    { label: runtime.runtimeRunning ? '运行状态：已运行' : '运行状态：未运行', tone: runtime.runtimeRunning ? 'success' : 'warning' },
    { label: `主机：${runtime.runtimeHost || runtime.webConsoleHost || '127.0.0.1'}` },
    { label: `端口：${runtime.runtimePort || runtime.webConsolePort || '未设置'}`, tone: 'info' },
    { label: '鉴权：必须登录', tone: 'success' },
    { label: runtime.runtimeLoginConfigured ? '口令：已设置' : '口令：未设置', tone: runtime.runtimeLoginConfigured ? 'success' : 'warning' },
    { label: '分组：5 类', tone: 'info' },
  ]);
}

function syncDraftFromPayload() {
  const next = {};
  for (const item of pluginSettingsState.payload?.items || []) {
    next[item.field] = item.value;
  }
  pluginSettingsState.draft = next;
}

async function refreshPluginSettings() {
  const [payload, overview, editableConfig, authStatus] = await Promise.all([
    fetchJson('/api/plugin-settings'),
    fetchJson('/api/overview'),
    fetchJson('/api/config/editable'),
    fetchPluginSettingsAuthStatus(),
  ]);
  pluginSettingsState.payload = payload;
  pluginSettingsState.overview = overview;
  pluginSettingsState.editableConfig = editableConfig;
  pluginSettingsState.authStatus = authStatus || pluginSettingsState.authStatus;
  if (!pluginSettingsState.activeCategory && payload.categories?.[0]) {
    pluginSettingsState.activeCategory = payload.categories[0].key;
  }
  syncDraftFromPayload();
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  switchPluginTopTab(pluginSettingsState.activeTopTab);
  syncNavCollapsedState();
  applyBootstrapModeUi();
}

async function savePluginSettings() {
  const result = await postJson('/api/plugin-settings/save', { data: pluginSettingsState.draft });
  pluginSettingsState.payload = result.data;
  const [editableConfig, authStatus] = await Promise.all([
    fetchJson('/api/config/editable'),
    fetchPluginSettingsAuthStatus(),
  ]);
  pluginSettingsState.editableConfig = editableConfig;
  pluginSettingsState.authStatus = authStatus || pluginSettingsState.authStatus;
  syncDraftFromPayload();
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  applyBootstrapModeUi();
  document.getElementById('plugin-settings-summary').textContent = result.data?.bootstrapCompleted
    ? '首次初始化完成，正在跳转到登录页...'
    : '保存成功，部分配置可能需要重启后完全生效';
  if (result.data?.bootstrapCompleted) {
    setPluginSettingsRisk('首次初始化完成，请使用刚设置的控制台登录口令重新登录。');
    window.setTimeout(() => {
      window.location.href = `/login.html?redirect=${encodeURIComponent('/plugin-settings.html')}`;
    }, 500);
  } else {
    setPluginSettingsRisk('', true);
  }
}

async function manageFeatureToggles(action) {
  const result = await postJson('/api/plugin-settings/feature-manage', { action });
  pluginSettingsState.payload = result.settings;
  pluginSettingsState.overview = result.overview;
  syncDraftFromPayload();
  pluginSettingsState.featureManageStatus = result.data?.message || '功能开关操作已完成';
  if (result.data?.exportText) {
    try {
      await navigator.clipboard.writeText(result.data.exportText);
      pluginSettingsState.featureManageStatus += '，已复制到剪贴板';
    } catch {
      pluginSettingsState.featureManageStatus += '，复制到剪贴板失败，可直接使用下载文件';
    }
  }
  pushFeatureManageHistory(action, pluginSettingsState.featureManageStatus, true);
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  return result;
}

async function loadFeatureHelpPreview() {
  pluginSettingsState.helpPreviewStatus = '正在生成帮助图预览...';
  renderFeatureSection();
  const result = await fetchJson('/api/plugin-settings/help-preview');
  pluginSettingsState.helpPreviewDataUrl = result.data?.dataUrl || '';
  pluginSettingsState.helpPreviewStatus = pluginSettingsState.helpPreviewDataUrl ? '帮助图预览已更新。' : '帮助图预览生成失败。';
  renderFeatureSection();
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(filename, dataUrl) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.undoRecommendation) {
    const undo = pluginSettingsState.recommendationUndo;
    if (undo?.fields) {
      Object.entries(undo.fields).forEach(([field, value]) => {
        pluginSettingsState.draft[field] = value;
      });
      pluginSettingsState.recommendationStatus = undo.message || '已恢复推荐配置应用前的值';
      pluginSettingsState.recommendationUndo = null;
      renderForm();
      renderConsoleSection();
      return;
    }
  }
  if (target.dataset.applyGroupRecommendation) {
    const groupItems = getVisibleItems().filter(item => !isAiKnowledgeField(item.field));
    const previous = {};
    const appliedLabels = [];
    groupItems.forEach(item => {
      if (Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field)) {
        previous[item.field] = pluginSettingsState.draft[item.field];
        pluginSettingsState.draft[item.field] = FIELD_RECOMMENDATION_VALUES[item.field];
        appliedLabels.push(item.label);
      }
    });
    pluginSettingsState.recommendationUndo = {
      fields: previous,
      message: '已撤销本组推荐配置，恢复到应用前的值',
    };
    pluginSettingsState.recommendationStatus = appliedLabels.length > 0
      ? `已应用本组推荐配置：${appliedLabels.join('、')}`
      : '当前分组没有可应用的推荐配置';
    renderForm();
    renderConsoleSection();
    return;
  }
  if (target.dataset.applyRecommendation) {
    const field = target.dataset.applyRecommendation;
    if (Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, field)) {
      const item = (pluginSettingsState.payload?.items || []).find(entry => entry.field === field);
      pluginSettingsState.recommendationUndo = {
        fields: { [field]: pluginSettingsState.draft[field] },
        message: `已撤销推荐值：${item?.label || field}`,
      };
      pluginSettingsState.draft[field] = FIELD_RECOMMENDATION_VALUES[field];
      pluginSettingsState.recommendationStatus = `已应用推荐值：${item?.label || field}`;
      renderForm();
      renderConsoleSection();
      return;
    }
  }
  if (target.dataset.featureManage) {
    const action = target.dataset.featureManage;
    const confirmTextMap = {
      disable_all: '确认要关闭全部功能吗？',
      reset: '确认要把功能开关重置为默认配置吗？',
      restore: '确认要从备份恢复当前功能开关吗？',
    };
    if (confirmTextMap[action] && !window.confirm(confirmTextMap[action])) {
      return;
    }
    manageFeatureToggles(action).then(result => {
      if (result?.data?.exportText) {
        const filename = action === 'export_backup' ? 'feature-toggle-backup.json' : 'feature-toggle-current.json';
        downloadTextFile(filename, result.data.exportText);
      }
    }).catch(error => {
      pluginSettingsState.featureManageStatus = `操作失败：${error.message}`;
      pushFeatureManageHistory(action, pluginSettingsState.featureManageStatus, false);
      renderFeatureSection();
    });
    return;
  }
  if (target.dataset.featureHelpPreview) {
    loadFeatureHelpPreview().catch(error => {
      pluginSettingsState.helpPreviewStatus = `帮助图预览失败：${error.message}`;
      renderFeatureSection();
    });
    return;
  }
  if (target.dataset.featureHelpOpen) {
    if (pluginSettingsState.helpPreviewDataUrl) {
      window.open(pluginSettingsState.helpPreviewDataUrl, '_blank');
    }
    return;
  }
  if (target.dataset.featureHelpDownload) {
    if (pluginSettingsState.helpPreviewDataUrl) {
      downloadDataUrl('feature-toggle-help-preview.png', pluginSettingsState.helpPreviewDataUrl);
    }
    return;
  }
  if (target.dataset.knowledgeEditorAction) {
    const field = 'ai.knowledgeBase';
    if (target.dataset.knowledgeEditorAction === 'fill-demo') {
      pluginSettingsState.draft[field] = buildKnowledgeDemoText();
    }
    if (target.dataset.knowledgeEditorAction === 'clear') {
      pluginSettingsState.draft[field] = '';
    }
    renderForm();
    return;
  }
  if (target.dataset.knowledgeGeneratorAction === 'generate') {
    generateKnowledgeBaseFromWeb().catch(() => {});
    return;
  }
  if (target.dataset.knowledgeGeneratorAction === 'apply') {
    applyGeneratedKnowledgePreview();
    return;
  }
  if (target.dataset.knowledgeHistoryAction === 'preview') {
    pluginSettingsState.knowledgeHistoryPreviewId = target.dataset.knowledgeHistoryId || '';
    renderForm();
    return;
  }
  if (target.dataset.knowledgeHistoryAction === 'restore') {
    restoreKnowledgeHistory(target.dataset.knowledgeHistoryId);
    return;
  }
  if (target.dataset.settingsCategory) {
    pluginSettingsState.activeCategory = target.dataset.settingsCategory;
    pluginSettingsState.recommendationStatus = '';
    pluginSettingsState.recommendationUndo = null;
    renderCategoryTabs();
    renderGroupTabs();
    renderForm();
  }
  if (target.dataset.settingsGroup) {
    pluginSettingsState.activeGroup = target.dataset.settingsGroup;
    pluginSettingsState.recommendationStatus = '';
    pluginSettingsState.recommendationUndo = null;
    renderGroupTabs();
    renderForm();
  }
  if (target.dataset.switchField) {
    const field = target.dataset.switchField;
    pluginSettingsState.draft[field] = !pluginSettingsState.draft[field];
    renderForm();
    renderConsoleSection();
  }
  if (target.dataset.pluginTopTab) {
    switchPluginTopTab(target.dataset.pluginTopTab);
  }
});

document.getElementById('plugin-settings-nav-toggle-btn').addEventListener('click', () => {
  pluginSettingsState.navCollapsed = !pluginSettingsState.navCollapsed;
  localStorage.setItem('crystelf-plugin-settings-nav-collapsed', String(pluginSettingsState.navCollapsed));
  syncNavCollapsedState();
});

document.getElementById('plugin-settings-search').addEventListener('input', event => {
  pluginSettingsState.searchKeyword = normalizeSearchText(event.target.value);
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
});

document.getElementById('plugin-settings-search-clear-btn').addEventListener('click', () => {
  pluginSettingsState.searchKeyword = '';
  document.getElementById('plugin-settings-search').value = '';
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
});

document.addEventListener('input', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.dataset.knowledgeGeneratorQuery !== undefined) {
    pluginSettingsState.knowledgeGenerateQuery = target.value;
    return;
  }
  if (!(target instanceof HTMLElement) || !target.dataset.field) return;
  const field = target.dataset.field;
  if (target instanceof HTMLTextAreaElement) {
    const item = (pluginSettingsState.payload?.items || []).find(entry => entry.field === field);
    if (item?.component === 'InputArray') {
      pluginSettingsState.draft[field] = target.value.split('\n').map(line => line.trim()).filter(Boolean);
    } else {
      pluginSettingsState.draft[field] = target.value;
    }
    renderConsoleSection();
  }
  if (target instanceof HTMLInputElement) {
    pluginSettingsState.draft[field] = target.value;
    renderConsoleSection();
  }
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.dataset.knowledgePreviewId) {
    const id = target.dataset.knowledgePreviewId;
    if (target.checked) {
      if (!pluginSettingsState.knowledgeSelectedPreviewIds.includes(id)) {
        pluginSettingsState.knowledgeSelectedPreviewIds.push(id);
      }
    } else {
      pluginSettingsState.knowledgeSelectedPreviewIds = pluginSettingsState.knowledgeSelectedPreviewIds.filter(item => item !== id);
    }
    return;
  }
  if (target instanceof HTMLSelectElement && target.dataset.knowledgeGenerateMode !== undefined) {
    pluginSettingsState.knowledgeGenerateMode = target.value || 'replace';
    return;
  }
  if (!(target instanceof HTMLSelectElement) || !target.dataset.field) return;
  const field = target.dataset.field;
  if (target.multiple) {
    pluginSettingsState.draft[field] = Array.from(target.selectedOptions).map(option => option.value);
  } else {
    pluginSettingsState.draft[field] = target.value;
  }
  renderConsoleSection();
});

document.getElementById('plugin-settings-save-btn').addEventListener('click', () => {
  savePluginSettings().catch(error => {
    setPluginSettingsRisk(`保存失败：${error.message}`);
  });
});

refreshPluginSettings().catch(error => {
  setPluginSettingsRisk(`加载失败：${error.message}`);
});

loadKnowledgeHistory();
loadFeatureManageHistory();
