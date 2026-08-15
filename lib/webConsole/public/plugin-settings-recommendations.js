const CONSOLE_THEME_ACCENT_META = {
  cyan: { label: '晶蓝', desc: '默认科技蓝，适合深色后台。' },
  emerald: { label: '青绿', desc: '偏运维监控风格，状态感更强。' },
  violet: { label: '紫罗兰', desc: '更接近 Vben 的高级感。' },
  rose: { label: '绯樱', desc: '偏柔和醒目，适合浅色背景。' },
  amber: { label: '琥珀', desc: '偏警示和暖色，按钮更亮。' },
  slate: { label: '曜石', desc: '低饱和暗色，适合长时间盯屏。' },
};

const GROUP_DESCRIPTIONS = {
  '常用功能开关': '这里放最常开关的功能入口，适合先快速决定这个插件要启用哪些核心能力。',
  '本群管理': '这里主要是进群、验证、欢迎这类和群成员管理有关的功能。',
  '群管理相关': '这里主要是进群、验证、欢迎这类和群成员管理有关的功能。',
  '内容与娱乐': '这里是订阅、点歌、日报等偏内容消费和娱乐互动的功能。',
  '戳一戳回复设置': '这里集中管理机器人被戳之后的回复策略。',
  '基础回复方式': '先决定戳一戳默认回文字、表情包还是语音。',
  '多媒体回复': '这里控制表情包和语音这类更有表现力的回复方式。',
  '频率与限制': '这里控制冷却、限频和单次最多回复多少条，避免刷屏。',
  '追踪接话': '这里决定机器人回复后，要不要继续观察后续群聊并按上下文自主接话。',
  '回复风格与渲染': '这里集中管理回复气质、适用群范围，以及代码块和消息排版的展示效果。',
  '本地控制台设置': '这里是网页后台本身的相关设置。',
  '访问与安全': '这里控制后台能不能访问、是否需要登录、是否只读。',
  '网络与分页': '这里控制后台监听地址、端口和列表分页规模。',
  '日志与展示': '这里控制日志是否展示，以及后台各类详情页展示多少内容。',
  '插件维护': '这里是偏维护和调试用途的配置，普通用户一般不需要频繁改。',
  '基础设置': '这里是 AI 的基础接入信息，比如模型、接口和最基本的聊天参数。',
  '对话与会话': '这里控制聊天上下文、会话数量、历史抓取和回复相关的基础行为。',
  '故障降级': '这里设置 AI 出错、超时或联网失败时的兜底回复文案。',
  '机器人身份与人设': '这里统一设置机器人的名称、身份和回复风格。',
  '知识库': '这里管理本地知识库如何参与真实机器人聊天。',
  '表情与多模态': '这里配置表情包、多模态识图和图片相关能力。',
  '高级设置': '这里放图片生成、辅助模型和其他偏进阶的 AI 能力。',
};

const GROUP_RECOMMENDATIONS = {
  '基础回复方式': '新手建议先开启文本回复，等基础效果稳定后再逐步加语音或表情包。',
  '多媒体回复': '建议先把表情包概率、语音概率调低一些，确认群里效果自然后再慢慢提高。',
  '频率与限制': '建议保留冷却和群限频，能明显减少刷屏和高频触发。',
  '追踪接话': '建议先把继续监听时长设短一些、观察条数设低一些，先观察真实群聊效果。',
  '回复风格与渲染': '建议先只调整回复风格和群范围；代码块和消息排版更适合有明确展示需求时再改。',
  '访问与安全': '建议开启登录鉴权；如果只是自己本机调试，可以再决定要不要关闭只读模式。',
  '网络与分页': '如果只是个人调试，保持默认端口和分页通常就够用。',
  '对话与会话': '新手建议先保持默认会话上限和历史长度，先观察机器人在群里的响应是否稳定。',
  '故障降级': '建议先至少填一条通用失败回复；想更自然的话，再分别配置联网失败和超时失败。',
  '机器人身份与人设': '建议昵称保持简短明确，人设重点描述性格、语气和行为边界。',
  '知识库': '建议先少量添加高质量知识片段，确认召回效果后再逐步扩充。',
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
