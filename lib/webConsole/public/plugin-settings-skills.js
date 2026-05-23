function getSkillGuide(skillName) {
  return SKILL_GUIDE_MAP[String(skillName || '').trim()] || {
    scene: '通用技能',
    recommendation: '按需评估',
    recommendationTone: 'warning',
    summary: '这个 skill 没有额外的预设解说，请按工具描述自行判断是否启用。',
    when: '只在你明确知道用途时再启用',
    caution: '优先检查工具说明和 Host 白名单',
    examples: ['先看卡片下方工具说明再决定是否开启'],
    priority: 40,
  };
}

function buildSkillToolPreview(tools = []) {
  const names = (Array.isArray(tools) ? tools : [])
    .map(tool => String(tool?.name || '').trim())
    .filter(Boolean);
  if (names.length === 0) {
    return '';
  }
  return names.length > 4
    ? `${names.slice(0, 4).join('、')} 等 ${names.length} 个`
    : names.join('、');
}

function buildSkillHostSummary(hosts = []) {
  const list = (Array.isArray(hosts) ? hosts : [])
    .map(item => String(item || '').trim())
    .filter(Boolean);
  if (list.length === 0) {
    return '';
  }
  if (list.length === 1) {
    return `Host：${list[0]}`;
  }
  if (list.length === 2) {
    return `Host：${list.join('、')}`;
  }
  return `Host：${list[0]} 等 ${list.length} 个`;
}

function getSkillToolSummaryLabel(skill = {}, previewOnly = false) {
  const toolCount = Number(skill?.toolCount || 0);
  const enabledToolCount = Number(skill?.enabledToolCount || 0);
  if (toolCount > 0) {
    return `工具 ${enabledToolCount}/${toolCount}`;
  }
  return previewOnly ? '工具明细待后端支持' : '暂无工具明细';
}

function getSkillCollapsedMessage(skill = {}, previewOnly = false) {
  const toolCount = Number(skill?.toolCount || 0);
  if (toolCount > 0) {
    return `已收起 ${toolCount} 个 tool，点击上方按钮展开详情。`;
  }
  if (previewOnly) {
    return '兼容预览模式下暂不展示 tool 明细。';
  }
  return '当前没有可展示的 tool 明细。';
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSkillSearchText(value, keyword = pluginSettingsState.skillsSearchKeyword) {
  const rawText = String(value ?? '');
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) {
    return escapeHtml(rawText);
  }
  const rawKeyword = String(keyword || '').trim();
  if (!rawKeyword) {
    return escapeHtml(rawText);
  }
  const pattern = new RegExp(`(${escapeRegExp(rawKeyword)})`, 'ig');
  return rawText
    .split(pattern)
    .map(part => (
      part && part.match(pattern)
        ? `<mark>${escapeHtml(part)}</mark>`
        : escapeHtml(part)
    ))
    .join('');
}

function renderSkillExamples(examples = [], keyword = pluginSettingsState.skillsSearchKeyword) {
  const list = (Array.isArray(examples) ? examples : [])
    .map(item => String(item || '').trim())
    .filter(Boolean);
  if (list.length === 0) {
    return '';
  }
  return `
    <div class="plugin-settings-skill-examples">
      <div class="plugin-settings-skill-examples-title">适合问题示例</div>
      <div class="plugin-settings-skill-examples-list">
        ${list.map(item => `<span class="plugin-settings-skill-example-chip">${highlightSkillSearchText(item, keyword)}</span>`).join('')}
      </div>
    </div>
  `;
}

function compareSkillCards(left, right) {
  const leftGuide = getSkillGuide(left?.name);
  const rightGuide = getSkillGuide(right?.name);
  if (Boolean(left?.enabled) !== Boolean(right?.enabled)) {
    return left?.enabled ? -1 : 1;
  }
  if ((leftGuide.priority || 0) !== (rightGuide.priority || 0)) {
    return (rightGuide.priority || 0) - (leftGuide.priority || 0);
  }
  if (Number(left?.toolCount || 0) !== Number(right?.toolCount || 0)) {
    return Number(right?.toolCount || 0) - Number(left?.toolCount || 0);
  }
  return String(left?.name || '').localeCompare(String(right?.name || ''));
}

function applySkillPreset(presetName) {
  const preset = SKILL_PRESET_MAP[String(presetName || '').trim()];
  if (!preset || !pluginSettingsState.skillsDraft) {
    return;
  }
  const selected = new Set(preset.skills || []);
  pluginSettingsState.skillsDraft.definitions = (pluginSettingsState.skillsDraft.definitions || []).map((item) => {
    if (!selected.has(item.name)) {
      return item;
    }
    const tools = (Array.isArray(item.tools) ? item.tools : []).map(tool => ({
      ...tool,
      enabled: true,
    }));
    return {
      ...item,
      enabled: true,
      enabledToolCount: tools.length,
      tools,
    };
  });
}

function matchesSkillFilter(skill, filterName = pluginSettingsState.skillsFilter) {
  const normalizedFilter = normalizeSkillFilterValue(filterName);
  if (!skill || normalizedFilter === 'all') {
    return true;
  }
  if (normalizedFilter === 'enabled') {
    return skill.enabled === true;
  }
  if (normalizedFilter === 'disabled') {
    return skill.enabled !== true;
  }
  if (normalizedFilter === 'customized') {
    return skill.customized === true;
  }
  if (normalizedFilter === 'recommended') {
    return getSkillGuide(skill.name).recommendation === '建议常开';
  }
  if (normalizedFilter === 'daily') {
    return (SKILL_PRESET_MAP.daily.skills || []).includes(skill.name);
  }
  if (normalizedFilter === 'research') {
    return (SKILL_PRESET_MAP.research.skills || []).includes(skill.name);
  }
  return true;
}

function matchesSkillSearch(skill, keyword = pluginSettingsState.skillsSearchKeyword) {
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) {
    return true;
  }
  const guide = getSkillGuide(skill?.name);
  const haystack = [
    skill?.name,
    skill?.description,
    guide?.scene,
    guide?.summary,
    guide?.when,
    guide?.caution,
    ...(Array.isArray(guide?.examples) ? guide.examples : []),
    ...(Array.isArray(skill?.tools) ? skill.tools.flatMap(tool => [tool?.name, tool?.description]) : []),
  ]
    .map(item => String(item || '').trim().toLowerCase())
    .join(' ');
  return haystack.includes(normalizedKeyword);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function getSkillsLayoutMode(width = 0) {
  const numericWidth = Number(width || 0);
  if (!Number.isFinite(numericWidth) || numericWidth <= 0) {
    return 'triple';
  }
  if (numericWidth < 680) {
    return 'single';
  }
  if (numericWidth < 920) {
    return 'double';
  }
  return 'triple';
}

function syncSkillsLayoutMode() {
  const box = document.getElementById('plugin-settings-skills-box');
  if (!box) {
    return;
  }
  const width = Math.round(box.getBoundingClientRect().width || 0);
  box.dataset.skillsLayout = getSkillsLayoutMode(width);
}

function ensureSkillsLayoutObserver() {
  const box = document.getElementById('plugin-settings-skills-box');
  if (!box) {
    return;
  }
  if (pluginSettingsSkillsLayoutObserver) {
    pluginSettingsSkillsLayoutObserver.disconnect();
    pluginSettingsSkillsLayoutObserver = null;
  }
  if (typeof ResizeObserver === 'function') {
    pluginSettingsSkillsLayoutObserver = new ResizeObserver(() => {
      syncSkillsLayoutMode();
    });
    pluginSettingsSkillsLayoutObserver.observe(box);
  }
  window.requestAnimationFrame(() => {
    syncSkillsLayoutMode();
  });
}

function persistSkillFilter() {
  localStorage.setItem(SKILLS_FILTER_STORAGE_KEY, pluginSettingsState.skillsFilter);
}

function persistSkillsSearchKeyword() {
  localStorage.setItem(SKILLS_SEARCH_STORAGE_KEY, pluginSettingsState.skillsSearchKeyword || '');
}

function persistSkillsExpandedState() {
  localStorage.setItem(SKILLS_EXPANDED_STORAGE_KEY, JSON.stringify(pluginSettingsState.skillsExpanded || {}));
}

function isSkillExpanded(skill) {
  const skillName = String(skill?.name || '').trim();
  if (!skillName) {
    return false;
  }
  if (normalizeSearchText(pluginSettingsState.skillsSearchKeyword)) {
    return true;
  }
  const explicit = pluginSettingsState.skillsExpanded?.[skillName];
  if (typeof explicit === 'boolean') {
    return explicit;
  }
  return skill?.enabled === true;
}

function setSkillExpanded(skillName, expanded) {
  const normalizedName = String(skillName || '').trim();
  if (!normalizedName) {
    return;
  }
  pluginSettingsState.skillsExpanded = {
    ...(pluginSettingsState.skillsExpanded || {}),
    [normalizedName]: Boolean(expanded),
  };
  persistSkillsExpandedState();
}

function setSkillsExpandedByFilter(expanded, filterName = pluginSettingsState.skillsFilter) {
  const normalizedFilter = normalizeSkillFilterValue(filterName);
  const definitions = Array.isArray(pluginSettingsState.skillsDraft?.definitions)
    ? pluginSettingsState.skillsDraft.definitions
    : [];
  const nextState = {
    ...(pluginSettingsState.skillsExpanded || {}),
  };
  for (const item of definitions) {
    if (!matchesSkillFilter(item, normalizedFilter)) {
      continue;
    }
    const skillName = String(item?.name || '').trim();
    if (!skillName) {
      continue;
    }
    nextState[skillName] = Boolean(expanded);
  }
  pluginSettingsState.skillsExpanded = nextState;
  persistSkillsExpandedState();
}

function resetSkillsViewState() {
  pluginSettingsState.skillsFilter = 'all';
  pluginSettingsState.skillsSearchKeyword = '';
  pluginSettingsState.skillsExpanded = {};
  persistSkillFilter();
  persistSkillsSearchKeyword();
  persistSkillsExpandedState();
}

