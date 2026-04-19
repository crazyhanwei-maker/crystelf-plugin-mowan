function getAuthToken() {
  return '';
}

const sessionDebugViewState = {
  currentData: null,
};

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return await response.json();
}

function formatTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatSceneLabel(scene) {
  const key = String(scene || '').trim();
  const sceneMap = {
    chat: '通用对话',
    chat_text: '文本对话',
    chat_multimodal: '多模态对话',
    chat_engine: '对话引擎',
    chat_engine_fallback: '对话降级处理',
    chat_engine_final: '对话最终生成',
    poke_follow_reply: '戳一戳跟随回复',
    poke_ai_reply: '戳一戳 AI 回复',
    poke_image_summary: '戳一戳图片摘要',
    image_monitor_review: '图片监控审核',
  };
  return sceneMap[key] || key || '未知';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeListText(value, separator = '、') {
  if (Array.isArray(value)) {
    return value.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).filter(Boolean).join(separator);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => `${key}:${typeof item === 'object' ? JSON.stringify(item) : String(item)}`).join(separator);
  }
  return String(value || '');
}

function setRawJson(data) {
  document.getElementById('session-debug-raw').textContent = JSON.stringify(data, null, 2);
}

function openConfirm(message) {
  return window.confirm(message);
}

function renderCards(cards) {
  document.getElementById('session-debug-cards').innerHTML = cards.map(item => `
    <div class="card ${item.tone ? `tone-${item.tone}` : ''}">
      <h3>${item.label}</h3>
      <div class="value detail-value">${item.value}</div>
    </div>
  `).join('');
}

function renderKeyValues(items) {
  document.getElementById('session-debug-main').innerHTML = items.map(item => `
    <div class="kv-item">
      <div class="kv-label">${item.label}</div>
      <div class="kv-value">${item.value}</div>
    </div>
  `).join('');
}

function renderActions(items) {
  document.getElementById('session-debug-actions').innerHTML = items.map(item => item.href
    ? `<a class="link-btn" href="${item.href}">${item.label}</a>`
    : `<button data-copy-value="${escapeHtml(item.copyValue || '')}">${item.label}</button>`).join('');
}

function renderList(containerId, items, emptyText, renderer) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.length > 0 ? items.map(renderer).join('') : `<div class="list-item">${emptyText}</div>`;
}

function formatDecisionSource(source) {
  const sourceMap = {
    direct: '直接触发',
    nickname: '昵称触发',
    follow_up: '连续对话接话',
    cooldown_replay: '冷却后补处理',
    delayed_batch: '延迟聚合处理',
    queued_replay: '队列补处理',
  };
  return sourceMap[String(source || '').trim()] || String(source || '未知');
}

function formatDecisionStatus(status) {
  const statusMap = {
    running: '运行中',
    generated: '已生成候选结果',
    success: '已成功发送',
    fallback: '进入兜底回复',
    invalid: '运行异常',
  };
  return statusMap[String(status || '').trim()] || String(status || '未知');
}

function formatResponseStyle(style) {
  const styleMap = {
    normal: '正常',
    concise: '简洁',
    detailed: '详细',
  };
  return styleMap[String(style || '').trim()] || String(style || '正常');
}

function formatMs(value) {
  const ms = Number(value || 0);
  if (!ms) return '暂无';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(ms < 600000 ? 1 : 0)} 分钟`;
  return `${(ms / 3600000).toFixed(1)} 小时`;
}

function renderDecisionExplanation(decision) {
  if (!decision || typeof decision !== 'object') {
    return '<span class="setting-help">暂无</span>';
  }

  const trigger = decision.trigger || {};
  const context = decision.context || {};
  const sessionControl = decision.sessionControl || {};
  const capabilities = decision.capabilities || {};
  const result = decision.result || {};
  const triggerTags = [
    `来源：${formatDecisionSource(trigger.source)}`,
    trigger.atBot ? '命中 @' : '',
    trigger.ruleTriggered ? '命中规则' : '',
    trigger.nicknameMentioned ? '命中昵称' : '',
    trigger.followUpActive ? '连续对话生效' : '',
  ].filter(Boolean);
  const toolNames = Array.isArray(result.toolNames) ? result.toolNames.filter(Boolean) : [];
  const knowledgeTitles = Array.isArray(context.knowledgeTitles) ? context.knowledgeTitles.filter(Boolean) : [];
  const groups = [
    {
      title: '触发',
      lines: [
        trigger.reason || '暂无',
        trigger.customReason ? `附加标记：${trigger.customReason}` : '',
        `连续对话：${trigger.followUpEnabled ? (trigger.followUpActive ? '当前生效' : '已开启但本轮未生效') : '未开启'} / ${trigger.followUpPaused ? '已暂停接话' : '未暂停'}`,
        `距上次回复：${formatMs(trigger.timeSinceLastBotMs)} / 回复后消息数：${Number(trigger.messageCountAfterBot || 0)} / ${Number(trigger.followUpMaxMessages || 0) || '未限制'}`,
      ].filter(Boolean),
    },
    {
      title: '上下文',
      lines: [
        `历史消息：${Number(context.historyCount || 0)} 条`,
        `知识库：${context.knowledgeEnabled ? `已开启，命中 ${Number(context.knowledgeMatchCount || 0)} 条` : '未开启'}`,
        knowledgeTitles.length ? `知识条目：${knowledgeTitles.join('、')}` : '',
        `记忆/好感/话题/表达/画像：${context.memoryUsed ? '记忆' : '无记忆'} / ${context.affinityUsed ? '好感' : '无好感'} / ${context.topicUsed ? '话题' : '无话题'} / ${context.expressionUsed ? '表达' : '无表达'} / ${context.userProfileUsed ? '画像' : '无画像'}`,
        `图片上下文：${Number(context.imageContextCount || 0)} 张`,
      ].filter(Boolean),
    },
    {
      title: '控制',
      lines: [
        `联网搜索：${sessionControl.disableSearch ? '已禁用' : '允许'}`,
        `知识库模式：${sessionControl.knowledgeOnly ? '只用知识库' : '正常模式'}`,
        `回复风格：${formatResponseStyle(sessionControl.responseStyle)}`,
        `自动接话：${sessionControl.pauseFollowUp ? '已暂停' : '正常'}`,
      ],
    },
    {
      title: '结果',
      lines: [
        `状态：${formatDecisionStatus(result.status)}`,
        `输出：文本 ${result.hasTextOutput ? '有' : '无'} / 语音 ${result.hasVoiceOutput ? '有' : '无'} / 表情 ${result.hasEmojiOutput ? '有' : '无'}`,
        `工具调用：${Number(result.toolCallCount || 0)} 次${toolNames.length ? `（${toolNames.join('、')}）` : ''}`,
        `能力选择：${capabilities.forceSearch ? '强制联网判定' : '无需强制联网'} / ${capabilities.multimodalInput ? '多模态输入' : '纯文本输入'} / ${capabilities.ttsAllowed ? '允许 AI 触发语音' : '未开启 AI 触发语音'}`,
        `调试提示：${capabilities.toolStatusHintsEnabled ? '工具状态提示已开' : '工具状态提示已关'} / ${capabilities.knowledgeDebugHintsEnabled ? '知识提示已开' : '知识提示已关'}`,
        result.fallbackUsed ? '本轮使用了兜底路径' : '',
        result.failureReason ? `失败原因：${result.failureReason}` : '',
      ].filter(Boolean),
    },
  ];

  return `
    <div class="session-debug-decision-tags">
      ${triggerTags.length ? triggerTags.map(item => `<span class="sandbox-rag-token">${escapeHtml(item)}</span>`).join('') : '<span class="setting-help">暂无标签</span>'}
    </div>
    <div class="session-debug-decision-grid">
      ${groups.map(group => `
        <div class="session-debug-decision-card">
          <h4>${escapeHtml(group.title)}</h4>
          ${group.lines.length ? group.lines.map(line => `<div class="setting-help">${escapeHtml(line)}</div>`).join('') : '<div class="setting-help">暂无</div>'}
        </div>
      `).join('')}
    </div>
  `;
}

function buildDecisionLogLines(decision) {
  if (!decision || typeof decision !== 'object') {
    return ['- 暂无'];
  }

  const trigger = decision.trigger || {};
  const context = decision.context || {};
  const sessionControl = decision.sessionControl || {};
  const capabilities = decision.capabilities || {};
  const result = decision.result || {};

  return [
    `- 触发来源: ${formatDecisionSource(trigger.source)}`,
    `- 触发原因: ${trigger.reason || '暂无'}`,
    trigger.customReason ? `- 附加标记: ${trigger.customReason}` : '',
    `- 连续对话: ${trigger.followUpEnabled ? (trigger.followUpActive ? '当前生效' : '已开启但未生效') : '未开启'} / ${trigger.followUpPaused ? '已暂停接话' : '未暂停'}`,
    `- 距上次回复: ${formatMs(trigger.timeSinceLastBotMs)} / 回复后消息数: ${Number(trigger.messageCountAfterBot || 0)} / ${Number(trigger.followUpMaxMessages || 0) || '未限制'}`,
    `- 历史消息: ${Number(context.historyCount || 0)} 条 / 图片上下文: ${Number(context.imageContextCount || 0)} 张`,
    `- 知识库: ${context.knowledgeEnabled ? `已开启，命中 ${Number(context.knowledgeMatchCount || 0)} 条` : '未开启'}`,
    Array.isArray(context.knowledgeTitles) && context.knowledgeTitles.length ? `- 知识条目: ${context.knowledgeTitles.join('、')}` : '',
    `- 记忆/好感/话题/表达/画像: ${context.memoryUsed ? '记忆' : '无记忆'} / ${context.affinityUsed ? '好感' : '无好感'} / ${context.topicUsed ? '话题' : '无话题'} / ${context.expressionUsed ? '表达' : '无表达'} / ${context.userProfileUsed ? '画像' : '无画像'}`,
    `- 会话控制: 联网${sessionControl.disableSearch ? '禁用' : '允许'} / ${sessionControl.knowledgeOnly ? '只用知识库' : '正常模式'} / 风格${formatResponseStyle(sessionControl.responseStyle)} / 接话${sessionControl.pauseFollowUp ? '暂停' : '正常'}`,
    `- 能力选择: ${capabilities.forceSearch ? '强制联网判定' : '无需强制联网'} / ${capabilities.multimodalInput ? '多模态输入' : '纯文本输入'} / ${capabilities.ttsAllowed ? '允许 AI 触发语音' : '未开启 AI 触发语音'}`,
    `- 调试提示: ${capabilities.toolStatusHintsEnabled ? '工具状态提示已开' : '工具状态提示已关'} / ${capabilities.knowledgeDebugHintsEnabled ? '知识提示已开' : '知识提示已关'}`,
    `- 最终状态: ${formatDecisionStatus(result.status)}`,
    `- 输出: 文本${result.hasTextOutput ? '有' : '无'} / 语音${result.hasVoiceOutput ? '有' : '无'} / 表情${result.hasEmojiOutput ? '有' : '无'}`,
    `- 工具调用: ${Number(result.toolCallCount || 0)} 次${Array.isArray(result.toolNames) && result.toolNames.length ? ` (${result.toolNames.join('、')})` : ''}`,
    result.fallbackUsed ? '- 本轮使用了兜底路径' : '',
    result.failureReason ? `- 失败原因: ${result.failureReason}` : '',
  ].filter(Boolean);
}

function renderSummary(data) {
  const session = data.session || {};
  const dominantScene = Object.entries(data.usageSummary?.byScene || {}).sort((a, b) => b[1] - a[1])[0];
  const digest = data.debugDigest || {};
  const summary = [
    `会话：${session.sessionId || '未知'}`,
    `类型：${session.type || '未知'} · 参与用户：${session.participantCount || 0}`,
    `消息：${session.messageCount || 0}（用户 ${session.userMessageCount || 0} / 助手 ${session.assistantMessageCount || 0}）`,
    `最近活跃：${formatTime(session.lastMessageTime)}`,
    `关联请求：${data.usageSummary?.requestCount || 0} · 错误：${data.usageSummary?.errorCount || 0} · Tokens：${data.usageSummary?.totalTokens || 0}`,
    dominantScene ? `主要场景：${formatSceneLabel(dominantScene[0])}（${dominantScene[1]} 次）` : '主要场景：暂无',
    session.focusUserId ? `聚焦用户：${session.focusUserId}` : '聚焦用户：未指定',
  ];
  document.getElementById('session-debug-summary').textContent = summary.join('\n');

  document.getElementById('session-debug-runtime').innerHTML = `
    <div class="session-debug-runtime-grid">
      <div class="session-debug-runtime-card">
        <div class="kv-label">最近请求</div>
        <div class="kv-value">${escapeHtml(formatTime(digest.requestTime))}</div>
        <div class="setting-help">${escapeHtml(formatSceneLabel(digest.scene || '未知场景') + ' / ' + (digest.model || '未知模型'))}</div>
      </div>
      <div class="session-debug-runtime-card ${digest.requestTime && digest.success === false ? 'tone-error' : ''}">
        <div class="kv-label">执行结果</div>
        <div class="kv-value">${escapeHtml(digest.requestTime ? (digest.success ? '成功' : '失败') : '暂无记录')}</div>
        <div class="setting-help">${escapeHtml(digest.error || '无错误信息')}</div>
      </div>
      <div class="session-debug-runtime-card">
        <div class="kv-label">最近消息</div>
        <div class="kv-value">${escapeHtml(digest.latestUserMessage ? String(digest.latestUserMessage).slice(0, 60) : '暂无')}</div>
        <div class="setting-help">助手：${escapeHtml(digest.latestAssistantMessage ? String(digest.latestAssistantMessage).slice(0, 60) : '暂无')}</div>
      </div>
      <div class="session-debug-runtime-card">
        <div class="kv-label">运行态更新时间</div>
        <div class="kv-value">${escapeHtml(digest.runtimeUpdatedAt ? formatTime(digest.runtimeUpdatedAt) : '暂无')}</div>
        <div class="setting-help">Tokens：${escapeHtml(String(digest.totalTokens || 0))}</div>
      </div>
      <div class="session-debug-runtime-card">
        <div class="kv-label">Prompt 摘要</div>
        <div class="kv-value">${escapeHtml(digest.runtimePromptSummary?.userMessage ? String(digest.runtimePromptSummary.userMessage).slice(0, 60) : '暂无')}</div>
        <div class="setting-help">知识：${escapeHtml((digest.runtimePromptSummary?.knowledgeUsed || []).slice(0, 3).join('、') || '无')}</div>
      </div>
    </div>
    <div class="session-debug-runtime-sections">
      <div class="session-debug-runtime-section">
        <h3>最近状态提示</h3>
        <div>${(digest.runtimeStatusHints || []).length ? (digest.runtimeStatusHints || []).slice(0, 5).map(item => `<span class="sandbox-rag-token">${escapeHtml(item)}</span>`).join('') : '<span class="setting-help">暂无</span>'}</div>
      </div>
      <div class="session-debug-runtime-section">
        <h3>最近知识命中</h3>
        <div>${(digest.runtimeKnowledgeMatches || []).length ? (digest.runtimeKnowledgeMatches || []).slice(0, 3).map(item => `<span class="sandbox-rag-tag">${escapeHtml(item.title)} · score ${escapeHtml(String(item.score || 0))}</span>`).join('') : '<span class="setting-help">暂无</span>'}</div>
      </div>
      <div class="session-debug-runtime-section">
        <h3>最近工具调用</h3>
        <div>${(digest.runtimeToolCalls || []).length ? (digest.runtimeToolCalls || []).slice(0, 3).map(item => `<span class="sandbox-rag-token">${escapeHtml(item.name)} · ${item.success ? '成功' : `失败(${escapeHtml(item.error || '未知')})`}</span>`).join('') : '<span class="setting-help">暂无</span>'}</div>
      </div>
      <div class="session-debug-runtime-section">
        <h3>最近失败原因</h3>
        <div class="setting-help">${escapeHtml(digest.runtimeFailureReason || '无')}</div>
      </div>
      <div class="session-debug-runtime-section ${(digest.runtimeDecisionExplanation?.result?.status && digest.runtimeDecisionExplanation?.result?.status !== 'success') ? 'tone-error' : ''}">
        <h3>回复决策解释</h3>
        ${renderDecisionExplanation(digest.runtimeDecisionExplanation)}
      </div>
    </div>
  `;
}

function renderRuntimePanels(data) {
  const digest = data.debugDigest || {};
  const knowledgeKeyword = document.getElementById('session-debug-knowledge-filter')?.value?.trim().toLowerCase() || '';
  const toolKeyword = document.getElementById('session-debug-tool-filter')?.value?.trim().toLowerCase() || '';
  const promptKeyword = document.getElementById('session-debug-prompt-filter')?.value?.trim().toLowerCase() || '';
  const knowledgeItems = (digest.runtimeKnowledgeMatches || []).filter(item => {
    if (!knowledgeKeyword) return true;
    return [item.title, item.contentPreview, ...(item.tags || [])].some(value => String(value || '').toLowerCase().includes(knowledgeKeyword));
  });
  const toolItems = (digest.runtimeToolCalls || []).filter(item => {
    if (!toolKeyword) return true;
    return [item.name, item.argsPreview, item.resultPreview, item.error].some(value => String(value || '').toLowerCase().includes(toolKeyword));
  });
  renderList('session-debug-knowledge', knowledgeItems, '最近一轮没有知识命中记录', item => `
    <div class="list-item">
      <h3>${escapeHtml(item.title || '未命名知识')}</h3>
      <div class="actions"><button data-copy-value="${escapeHtml(item.contentPreview || '')}">复制摘要</button><button data-copy-value="${escapeHtml(item.content || item.contentPreview || '')}">复制完整</button></div>
      <div>匹配分数：${escapeHtml(String(item.score || 0))}</div>
      <div>标签：${escapeHtml((item.tags || []).join('、') || '无')}</div>
      <div class="setting-help">${escapeHtml(item.contentPreview || '暂无正文预览')}</div>
      <details class="session-debug-expandable">
        <summary>展开完整正文</summary>
        <pre class="session-debug-json-block">${escapeHtml(item.content || '暂无完整正文')}</pre>
      </details>
    </div>
  `);

  renderList('session-debug-tool-calls', toolItems, '最近一轮没有工具调用记录', item => `
    <div class="list-item ${item.success ? '' : 'tone-error'}">
      <h3>${escapeHtml(item.name || '未知工具')}</h3>
      <div class="actions"><button data-copy-value="${escapeHtml(item.resultPreview || item.argsPreview || '')}">复制摘要</button><button data-copy-value="${escapeHtml(item.resultRaw || item.argsRaw || '')}">复制完整</button></div>
      <div>执行结果：${item.success ? '成功' : '失败'}</div>
      <div>参数摘要：${escapeHtml(item.argsPreview || '无')}</div>
      <div>结果摘要：${escapeHtml(item.resultPreview || item.error || '无错误信息')}</div>
      <details class="session-debug-expandable">
        <summary>展开原始 JSON</summary>
        <div class="session-debug-json-grid">
          <div>
            <div class="kv-label">Args</div>
            <pre class="session-debug-json-block">${escapeHtml(item.argsRaw || '{}')}</pre>
          </div>
          <div>
            <div class="kv-label">Result</div>
            <pre class="session-debug-json-block">${escapeHtml(item.resultRaw || '{}')}</pre>
          </div>
        </div>
      </details>
    </div>
  `);

  const prompt = digest.runtimePromptSummary || {};
  const promptItems = [prompt].filter(item => {
    if (!Object.keys(item || {}).length) return false;
    if (!promptKeyword) return true;
    return JSON.stringify(item).toLowerCase().includes(promptKeyword);
  });
  renderList('session-debug-prompt', promptItems, '最近一轮没有 Prompt 摘要记录', item => `
    <div class="list-item">
      <h3>最近一轮 Prompt 摘要</h3>
      <div class="actions"><button data-copy-value="${escapeHtml(item.userMessage || '')}">复制摘要</button><button data-copy-value="${escapeHtml(JSON.stringify(item, null, 2))}">复制完整</button></div>
      <div>用户消息：${escapeHtml(item.userMessage || '暂无')}</div>
      <div>命中知识：${escapeHtml((item.knowledgeUsed || []).join('、') || '无')}</div>
      <div>记忆上下文：${item.memoryUsed ? '已使用' : '未使用'} · 话题上下文：${item.topicUsed ? '已使用' : '未使用'}</div>
      <div>表达上下文：${item.expressionUsed ? '已使用' : '未使用'} · 用户画像：${item.userProfileUsed ? '已使用' : '未使用'}</div>
      <details class="session-debug-expandable">
        <summary>展开会话控制约束</summary>
        <pre class="session-debug-json-block">${escapeHtml(item.sessionControl || '暂无')}</pre>
      </details>
    </div>
  `,);

  const pokeDebug = digest.pokeDebug || {};
  renderList('session-debug-poke', Object.keys(pokeDebug).length ? [pokeDebug] : [], '当前没有戳一戳调试记录', item => `
    <div class="list-item">
      <h3>最近一次戳一戳运行态</h3>
      <div><strong>${escapeHtml(item.lastImageSource === 'operator_recent' ? '已命中戳人本人图片' : item.lastImageSource === 'group_recent' ? '已回退群最近图片' : '本次未使用图片')}</strong></div>
      <div>最近动作：${escapeHtml(item.lastAction || '暂无')}</div>
      <div>最近操作者：${escapeHtml(String(item.lastOperatorId || '暂无'))}</div>
      <div>最近回复：${escapeHtml(item.lastReply || '暂无')}</div>
      <div>最近观察消息：${escapeHtml(item.lastObservedMessage || '暂无')}</div>
      <div>冷却时间：${escapeHtml(String(item.cooldownMs || 0))} ms</div>
      <div>群限频：${escapeHtml(String(item.groupRateCount || 0))} / ${escapeHtml(String(item.groupRateMaxReplies || 0))}（窗口 ${escapeHtml(String(item.groupRateWindowMs || 0))} ms）</div>
      <div>多模态：${item.useMultimodal ? '已启用' : '未启用'}</div>
      <div>最近图片：${escapeHtml((item.lastImageUrls || []).join('、') || '无')}</div>
      <div>图片来源：${escapeHtml(item.lastImageSource === 'operator_recent' ? '戳人本人' : item.lastImageSource === 'group_recent' ? '群最近回退' : '无')}</div>
      <div>图片发送者：${escapeHtml(item.lastImageSenderName || item.lastImageSenderId || '暂无')}</div>
      <div>图片摘要：${escapeHtml(item.lastImageSummary || '暂无')}</div>
      <details class="session-debug-expandable">
        <summary>展开追踪窗口</summary>
        <pre class="session-debug-json-block">${escapeHtml(JSON.stringify(item.followWindow || null, null, 2))}</pre>
      </details>
      <details class="session-debug-expandable">
        <summary>展开上下文</summary>
        <pre class="session-debug-json-block">${escapeHtml(JSON.stringify(item.lastContextLines || [], null, 2))}</pre>
      </details>
    </div>
  `);
}

function exportDebugPanel(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildFullDebugLog(data) {
  const digest = data.debugDigest || {};
  const lines = [
    '=== 会话总览 ===',
    `会话 ID: ${data.session?.sessionId || '未知'}`,
    `类型: ${data.session?.type || '未知'}`,
    `目标 ID: ${data.session?.targetId || '未知'}`,
    `最近活跃: ${formatTime(data.session?.lastMessageTime)}`,
    `消息数: ${data.session?.messageCount || 0}`,
    '',
    '=== 最近请求 ===',
    `时间: ${formatTime(digest.requestTime)}`,
    `场景: ${formatSceneLabel(digest.scene)}`,
    `模型: ${digest.model || '未知'}`,
    `结果: ${digest.requestTime ? (digest.success ? '成功' : `失败(${digest.error || '未知错误'})`) : '暂无'}`,
    `Tokens: ${digest.totalTokens || 0}`,
    '',
    '=== Prompt 摘要 ===',
    `用户消息: ${digest.runtimePromptSummary?.userMessage || '暂无'}`,
    `命中知识: ${(digest.runtimePromptSummary?.knowledgeUsed || []).join('、') || '无'}`,
    `记忆上下文: ${digest.runtimePromptSummary?.memoryUsed ? '已使用' : '未使用'}`,
    `话题上下文: ${digest.runtimePromptSummary?.topicUsed ? '已使用' : '未使用'}`,
    `表达上下文: ${digest.runtimePromptSummary?.expressionUsed ? '已使用' : '未使用'}`,
    `用户画像: ${digest.runtimePromptSummary?.userProfileUsed ? '已使用' : '未使用'}`,
    `会话控制: ${digest.runtimePromptSummary?.sessionControl || '无'}`,
    '',
    '=== 回复决策解释 ===',
    ...buildDecisionLogLines(digest.runtimeDecisionExplanation),
    '',
    '=== 最近状态提示 ===',
    ...((digest.runtimeStatusHints || []).length ? digest.runtimeStatusHints.map(item => `- ${item}`) : ['- 暂无']),
    '',
    '=== 最近知识命中 ===',
    ...((digest.runtimeKnowledgeMatches || []).length
      ? digest.runtimeKnowledgeMatches.map(item => `- ${item.title} | score=${item.score || 0} | tags=${(item.tags || []).join('、') || '无'}\n${item.content || item.contentPreview || ''}`)
      : ['- 暂无']),
    '',
    '=== 最近工具调用 ===',
    ...((digest.runtimeToolCalls || []).length
      ? digest.runtimeToolCalls.map(item => `- ${item.name} | ${item.success ? '成功' : `失败(${item.error || '未知'})`}\nargs=${item.argsRaw || '{}'}\nresult=${item.resultRaw || '{}'}`)
      : ['- 暂无']),
    '',
    '=== 最近消息 ===',
    `用户: ${digest.latestUserMessage || '暂无'}`,
    `助手: ${digest.latestAssistantMessage || '暂无'}`,
    '',
    '=== 戳一戳调试 ===',
    `最近动作: ${digest.pokeDebug?.lastAction || '暂无'}`,
    `最近回复: ${digest.pokeDebug?.lastReply || '暂无'}`,
    `最近观察消息: ${digest.pokeDebug?.lastObservedMessage || '暂无'}`,
    `冷却: ${digest.pokeDebug?.cooldownMs || 0} ms`,
    `群限频: ${(digest.pokeDebug?.groupRateCount || 0)} / ${(digest.pokeDebug?.groupRateMaxReplies || 0)}`,
    '',
    '=== 消息时间线 ===',
    ...((data.messages || []).length ? data.messages.map(item => `[${formatTime(item.timestamp)}] ${item.role || 'unknown'}: ${item.content || ''}`) : ['- 暂无']),
  ];
  return lines.join('\n');
}

function renderFullDebugLog(data) {
  const keyword = document.getElementById('session-debug-log-filter')?.value?.trim().toLowerCase() || '';
  const fullLog = buildFullDebugLog(data);
  const filtered = keyword
    ? fullLog.split('\n').filter(line => line.toLowerCase().includes(keyword) || /^===/.test(line)).join('\n')
    : fullLog;
  document.getElementById('session-debug-log').textContent = filtered;
}

function renderAlerts(data) {
  renderList('session-debug-alerts', data.alerts || [], '当前没有明显异常提示', item => `
    <div class="list-item tone-${item.tone || 'neutral'}">
      <div>${escapeHtml(item.message || '无')}</div>
    </div>
  `);
}

function renderAffinitySummary(data) {
  const affinity = data.affinityHistory;
  document.getElementById('session-debug-affinity').textContent = affinity
    ? [
        affinity.current
          ? `当前分值：${affinity.current.score || 0} · 互动：${affinity.current.interaction_count || 0} · 最近原因：${affinity.current.last_reason || '无'}`
          : '当前记录：已不存在或未建立',
        '',
        '最近变化：',
        ...(affinity.entries?.length > 0
          ? affinity.entries.slice(0, 8).map(item => `${formatTime(item.time)} · ${item.delta ?? 0} · ${item.reason || '无'}`)
          : ['暂无好感历史']),
      ].join('\n')
    : '当前会话未指定群用户，暂无好感历史摘要';
}

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
    const confirmed = openConfirm(`确认仅清空会话 ${sessionId} 的消息吗？画像、表达和主题数据会保留。`);
    if (!confirmed) return;
    try {
      const token = getAuthToken();
      const response = await fetch('/api/sessions/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId, mode: 'messages_only' }),
      });
      if (!response.ok) {
        throw new Error(`/api/sessions/reset -> ${response.status}`);
      }
      window.alert(`会话 ${sessionId} 的消息已清空，画像/表达/主题仍保留。稍后将返回首页。`);
      location.href = '/';
    } catch (error) {
      window.alert(`清空失败：${error.message}`);
    }
  });
  document.getElementById('reset-session-debug-btn').addEventListener('click', async () => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('sessionId') || '';
    if (!sessionId) return;
    const confirmed = openConfirm(`确认重置会话 ${sessionId} 吗？这会清空该会话记录、画像、表达和主题数据。`);
    if (!confirmed) return;
    try {
      const token = getAuthToken();
      const response = await fetch('/api/sessions/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        throw new Error(`/api/sessions/reset -> ${response.status}`);
      }
      window.alert(`会话 ${sessionId} 已清空，稍后将返回首页。`);
      location.href = '/';
    } catch (error) {
      window.alert(`重置失败：${error.message}`);
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

async function initSessionDebug() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('sessionId') || '';
  const userId = params.get('userId') || '';
  document.getElementById('session-debug-user-filter').value = userId;
  const data = await fetchJson(`/api/session-debug?sessionId=${encodeURIComponent(sessionId)}&userId=${encodeURIComponent(userId)}`);
  sessionDebugViewState.currentData = data;
  document.getElementById('session-debug-meta').textContent = `${data.session?.sessionId || '未知会话'} · 最近活跃 ${formatTime(data.session?.lastMessageTime)}`;
  renderCards([
    { label: '消息数', value: Number(data.session?.messageCount || 0) },
    { label: '参与用户', value: Number(data.session?.participantCount || 0) },
    { label: '关联请求', value: Number(data.usageSummary?.requestCount || 0) },
    { label: '错误请求', value: Number(data.usageSummary?.errorCount || 0), tone: Number(data.usageSummary?.errorCount || 0) > 0 ? 'error' : 'success' },
  ]);
  renderAlerts(data);
  renderActions([
    { label: '复制会话 ID', copyValue: data.session?.sessionId || '' },
    ...(data.session?.focusUserId ? [{ label: '复制聚焦用户 ID', copyValue: data.session.focusUserId }] : []),
    ...(data.session?.focusUserId ? [{ label: '查看画像详情', href: `/profile-detail.html?sessionId=${encodeURIComponent(data.session.sessionId)}&userId=${encodeURIComponent(data.session.focusUserId)}` }] : []),
  ]);
  renderKeyValues([
    { label: '会话 ID', value: data.session?.sessionId || '未知' },
    { label: '会话类型', value: data.session?.type || '未知' },
    { label: '目标 ID', value: data.session?.targetId || '未知' },
    { label: '创建时间', value: formatTime(data.session?.createdAt) },
    { label: '更新时间', value: formatTime(data.session?.updatedAt) },
    { label: '首条消息', value: formatTime(data.session?.firstMessageTime) },
    { label: '最后消息', value: formatTime(data.session?.lastMessageTime) },
    { label: '压缩上下文', value: data.session?.compressedContext ? '已存在' : '暂无' },
  ]);
  renderSummary(data);
  renderRuntimePanels(data);
  renderFullDebugLog(data);
  renderList('session-debug-participants', data.participants || [], '暂无参与用户', item => `
    <div class="list-item">
      <h3>${escapeHtml(item.userName || item.userId)} <small>(${escapeHtml(item.userId || '未知')})</small></h3>
      <div>出现次数：${item.count || 0}</div>
      <div>最近时间：${formatTime(item.lastTime)}</div>
      <div class="actions">
        <a class="link-btn" href="/session-debug.html?sessionId=${encodeURIComponent(data.session?.sessionId || '')}&userId=${encodeURIComponent(item.userId || '')}">聚焦此用户</a>
      </div>
    </div>
  `);
  renderList('session-debug-profiles', data.profiles || [], '暂无关联画像', item => `
    <div class="list-item">
      <h3>${escapeHtml(item.userName || item.userId)} <small>(${escapeHtml(item.userId || '未知')})</small></h3>
      <div>概括：${escapeHtml(item.summary || '暂无')}</div>
      <div>特征：${escapeHtml(normalizeListText(item.traits, '、') || '暂无')}</div>
      <div class="actions">
        <a class="link-btn" href="/profile-detail.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">画像详情</a>
        <a class="link-btn" href="/session-debug.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">聚焦此用户</a>
      </div>
    </div>
  `);
  renderList('session-debug-topics', data.topics || [], '暂无话题记录', item => `
    <div class="list-item">
      <h3>${escapeHtml(item.title || '未命名话题')}</h3>
      <div>关键词：${escapeHtml(normalizeListText(item.keywords, '、') || '暂无')}</div>
      <div>概括：${escapeHtml(item.summary || '暂无')}</div>
      <div>消息数：${item.messageCount || 0} · 更新时间：${formatTime(item.updatedAt)}</div>
    </div>
  `);
  renderList('session-debug-expressions', data.expressions || [], '暂无表达习惯记录', item => `
    <div class="list-item">
      <h3>${escapeHtml(item.userName || item.userId || '未知用户')}</h3>
      <div>场景：${escapeHtml(item.situation || '暂无')}</div>
      <div>风格：${escapeHtml(normalizeListText(item.style, '、') || '暂无')}</div>
      <div>示例：${escapeHtml(normalizeListText(item.example, '；') || '暂无')}</div>
    </div>
  `);
  renderList('session-debug-messages', data.messages || [], '暂无消息记录', item => `
    <div class="list-item ${item.role === 'assistant' ? 'tone-success' : ''}">
      <h3>${escapeHtml(item.role === 'assistant' ? '助手' : (item.userName || item.userId || '用户'))}</h3>
      <div>${escapeHtml(item.content || '空消息')}</div>
      <div>时间：${formatTime(item.timestamp)} · 消息 ID：${escapeHtml(item.messageId || '无')}</div>
    </div>
  `);
  renderList('session-debug-usage', data.usageRequests || [], '暂无关联 AI 请求', item => `
    <div class="list-item ${item.error ? 'tone-error' : ''}">
      <h3>${escapeHtml(item.scene || '未知场景')} <small>${escapeHtml(item.model || '未知模型')}</small></h3>
      <div>时间：${formatTime(item.time)} · Tokens：${item.total_tokens || 0} · 耗时：${item.elapsed_ms || 0}ms</div>
      <div>预览：${escapeHtml(item.display_prompt_preview || item.display_response_preview || item.prompt_preview || item.response_preview || item.error || '无')}</div>
      <div class="actions">
        <a class="link-btn" href="/usage-log-detail.html?id=${encodeURIComponent(item.id || '')}">日志详情</a>
      </div>
    </div>
  `);
  renderAffinitySummary(data);
  setRawJson(data.raw || data);
  bindCommonActions();
}

initSessionDebug().catch(error => {
  document.body.innerHTML = `<pre>对话调试加载失败: ${error.message}</pre>`;
});
