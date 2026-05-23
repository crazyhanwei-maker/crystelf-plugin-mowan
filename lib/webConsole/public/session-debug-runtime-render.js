function renderSummary(data) {
  const session = data.session || {};
  const dominantScene = Object.entries(data.usageSummary?.byScene || {}).sort((a, b) => b[1] - a[1])[0];
  const digest = data.debugDigest || {};
  const summary = [
    `会话：${session.sessionId || '未知'}`,
    `类型：${session.type || '未知'} · 参与用户：${session.participantCount || 0}`,
    `消息：${session.messageCount || 0}（用户 ${session.userMessageCount || 0} / 助手 ${session.assistantMessageCount || 0}）`,
    `最近活跃：${formatTime(session.lastMessageTime)}`,
    `关联请求：${data.usageSummary?.requestCount || 0} · 错误：${data.usageSummary?.errorCount || 0} · 用量：${data.usageSummary?.totalTokens || 0}`,
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
        <div class="setting-help">用量：${escapeHtml(String(digest.totalTokens || 0))}</div>
      </div>
      <div class="session-debug-runtime-card">
        <div class="kv-label">提示词摘要</div>
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
        <summary>展开原始数据</summary>
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
  renderList('session-debug-prompt', promptItems, '最近一轮没有提示词摘要记录', item => `
    <div class="list-item">
      <h3>最近一轮提示词摘要</h3>
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
  renderList('session-debug-poke', Object.keys(pokeDebug).length ? [pokeDebug] : [], '当前没有戳一戳排查记录', item => `
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
    `用量: ${digest.totalTokens || 0}`,
    '',
    '=== 提示词摘要 ===',
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
    '=== 戳一戳排查 ===',
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

