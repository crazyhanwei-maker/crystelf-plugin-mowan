function renderHistory() {
  const container = document.getElementById('sandbox-history');
  container.innerHTML = sandboxState.history.length > 0
    ? sandboxState.history.map(item => `
      <div class="sandbox-bubble-row ${item.role === 'assistant' ? 'assistant' : 'user'}">
        <div class="sandbox-bubble ${item.role === 'assistant' ? 'assistant' : 'user'}">
          <div class="sandbox-bubble-title">${item.role === 'assistant' ? '沙箱回复' : '网页输入'}</div>
          <div>${escapeHtml(item.content)}</div>
          <div class="sandbox-bubble-time">${formatTime(item.time)}</div>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无测试记录</div>';
}

function renderRagMatches(matches = []) {
  const container = document.getElementById('sandbox-rag-matches');
  if (!container) return;
  if (!Array.isArray(matches) || matches.length === 0) {
    container.innerHTML = '<div class="list-item">当前未命中任何知识片段</div>';
    return;
  }
  container.innerHTML = matches.map((item, index) => `
    <div class="list-item sandbox-media-item sandbox-rag-match-card">
      <div class="sandbox-rag-match-head">
        <h3>命中 ${index + 1} · ${escapeHtml(item.title || '未命名片段')}</h3>
        <span class="sandbox-rag-score">score ${escapeHtml(item.score ?? '未知')}</span>
      </div>
      ${(item.tags || []).length > 0 ? `<div class="sandbox-rag-token-list">${item.tags.map(tag => `<span class="sandbox-rag-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      ${(item.tags || []).length > 0 ? `<div class="sandbox-rag-token-list">${item.tags.map(tag => `<span class="sandbox-rag-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      <div class="sandbox-rag-token-list">${(item.matchedTokens || []).length > 0 ? (item.matchedTokens || []).map(token => `<span class="sandbox-rag-token">${escapeHtml(token)}</span>`).join('') : '<span class="sandbox-rag-token">无匹配词</span>'}</div>
      <div class="detail-box sandbox-tool-call-box sandbox-rag-content">${highlightMatchedText(item.content || '', item.matchedTokens || [])}</div>
    </div>
  `).join('');
}

function renderRagDebug(data = {}) {
  const container = document.getElementById('sandbox-rag-debug');
  if (!container) return;
  const payload = {
    debugKnowledgeBase: data.debugKnowledgeBase || '',
    debugKnowledgeItems: data.debugKnowledgeItems || [],
    debugQueryTokens: data.debugQueryTokens || [],
    knowledgeMatches: data.knowledgeMatches || [],
  };
  container.textContent = JSON.stringify(payload, null, 2) || '当前尚无知识库排查数据';
}

function renderRagDebugSummary(data = {}) {
  const container = document.getElementById('sandbox-summary');
  if (!container) return;
  const matches = Array.isArray(data.knowledgeMatches) ? data.knowledgeMatches : [];
  const tokens = Array.isArray(data.debugQueryTokens) ? data.debugQueryTokens : [];
  const summaryLines = [
    `知识库召回：${matches.length > 0 ? `命中 ${matches.length} 条` : '未命中'}`,
    `查询切词：${tokens.length > 0 ? tokens.join('、') : '空'}`,
  ];
  if (matches[0]) {
    summaryLines.push(`Top1：${matches[0].title || '未命名片段'} · score=${matches[0].score ?? '未知'}`);
  }
  container.textContent = `${summaryLines.join('\n')}\n\n${container.textContent || ''}`.trim();
}

function focusSandboxResultArea() {
  document.getElementById('sandbox-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function summarizeToolResult(result) {
  if (result === undefined || result === null) return '无返回结果';
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return text.length > 600 ? `${text.slice(0, 600)}...` : text;
}

function renderToolCalls(toolCalls = [], finalReply = '') {
  const container = document.getElementById('sandbox-tool-calls');
  const timelineItems = [];
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    timelineItems.push(...toolCalls.map((item, index) => `
    <div class="sandbox-tool-call-item ${item.result?.success === false ? 'tool-failed' : 'tool-success'}">
      <div class="sandbox-tool-call-head">
        <div class="sandbox-tool-call-step">步骤 ${index + 1}</div>
        <div class="sandbox-tool-call-title">${escapeHtml(item.name || '未知工具')}</div>
        <div class="sandbox-tool-call-state">${item.result?.success === false ? '失败' : '成功或已处理'}</div>
      </div>
      <div>参数</div>
      <pre class="detail-box sandbox-tool-call-box">${escapeHtml(JSON.stringify(item.args || {}, null, 2))}</pre>
      <div>结果摘要</div>
      <pre class="detail-box sandbox-tool-call-box">${escapeHtml(summarizeToolResult(item.result))}</pre>
    </div>
  `));
  }

  if (String(finalReply || '').trim()) {
    timelineItems.push(`
      <div class="sandbox-tool-call-item sandbox-final-answer-item tool-success">
        <div class="sandbox-tool-call-head">
          <div class="sandbox-tool-call-step">步骤 ${timelineItems.length + 1}</div>
          <div class="sandbox-tool-call-title">final_answer</div>
          <div class="sandbox-tool-call-state">最终回答</div>
        </div>
        <div>回答内容</div>
        <pre class="detail-box sandbox-tool-call-box">${escapeHtml(finalReply)}</pre>
      </div>
    `);
  }

  if (timelineItems.length === 0) {
    container.innerHTML = '<div class="list-item">尚未触发工具调用，也暂无最终回答</div>';
    return;
  }

  container.innerHTML = `<div class="sandbox-tool-timeline">${timelineItems.join('')}</div>`;
}

function renderMediaResult(data = {}) {
  const container = document.getElementById('sandbox-media-result');
  const parts = [];
  if (data.emojiPath) {
    const emojiPath = String(data.emojiPath || '').trim();
    const safeEmojiPath = sanitizeUrl(emojiPath, { allowRelative: true, allowDataImage: true });
    parts.push(`
      <div class="list-item sandbox-media-item">
        <h3>表情包</h3>
        ${safeEmojiPath ? `<img class="sandbox-media-image" src="${escapeHtml(safeEmojiPath)}" alt="表情包结果" />` : '<div class="detail-box">表情包路径已拦截</div>'}
        <div class="sandbox-media-url">${escapeHtml(emojiPath)}</div>
      </div>
    `);
  }
  const voiceMessages = Array.isArray(data.voiceMessages) ? data.voiceMessages : [];
  if (voiceMessages.length > 0) {
    parts.push(...voiceMessages.map((item, index) => {
      const audioUrl = String(item.audioUrl || '').trim();
      const safeAudioUrl = sanitizeUrl(audioUrl, { allowRelative: true });
      return `
        <div class="list-item sandbox-media-item">
          <h3>语音 ${index + 1}</h3>
          ${safeAudioUrl ? `<audio class="sandbox-media-audio" controls src="${escapeHtml(safeAudioUrl)}"></audio>` : '<div class="detail-box">语音地址已拦截</div>'}
          <div>文本：${escapeHtml(item.text || '无')}</div>
          <div>模型：${escapeHtml(item.model || '未知')} · 语言：${escapeHtml(item.language || '未知')} · 情感：${escapeHtml(item.emotion || '未知')}</div>
          <div class="sandbox-media-url">${escapeHtml(audioUrl)}</div>
        </div>
      `;
    }));
  }
  container.innerHTML = parts.length > 0 ? parts.join('') : '<div class="list-item">当前尚无表情包或语音结果</div>';
}

function renderSummary(data) {
  const usage = data.usage || {};
  const request = data.request || {};
  const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : [];
  const voiceMessages = Array.isArray(data.voiceMessages) ? data.voiceMessages : [];
  document.getElementById('sandbox-summary').textContent = [
    `会话标识：${data.sessionId || '未知'}`,
    `提示：${data.note || '无'}`,
    `耗时：${data.elapsedMs ?? '未知'} ms`,
    `模型：${request.model || '未知'}`,
    `温度：${request.temperature ?? '未知'}`,
    `最大输出长度：${request.maxTokens ?? '未设置'}`,
    `历史条数：${request.historyCount ?? '未知'}`,
    `系统提示词长度：${request.systemPromptLength ?? '未知'}`,
    `配置来源：${request.configSource || '未知'}`,
    `解析用户标识：${request.resolvedUserId || '未知'}`,
    `模拟群号：${request.groupId || '未设置'}`,
    `模拟用户昵称：${request.userName || '未设置'}`,
    `模拟机器人昵称：${request.botName || '未设置'}`,
    `工具调用：${toolCalls.length > 0 ? toolCalls.map(item => item.name).join('、') : '未触发'}`,
    `表情包结果：${data.emojiPath ? '有' : '无'}`,
    `语音结果：${voiceMessages.length}`,
    `输入用量：${usage.prompt_tokens ?? '未知'}`,
    `输出用量：${usage.completion_tokens ?? '未知'}`,
    `总用量：${usage.total_tokens ?? '未知'}`,
  ].join('\n');
  document.getElementById('sandbox-raw').textContent = data.rawResponse || '无原始响应';
  document.getElementById('sandbox-system-prompt-preview').textContent = data.systemPrompt || '暂无系统提示词';
  renderToolCalls(toolCalls, data.reply || '');
  renderMediaResult(data);
  renderRagMatches(data.knowledgeMatches || []);
  renderRagDebug(data);
  renderRagDebugSummary(data);
}

function renderConfigStatus(data) {
  document.getElementById('sandbox-config-status').textContent = [
    `有效配置：${data.valid ? '是' : '否'}`,
    `当前模型：${data.modelType || '未知'}`,
    `当前接口：${data.baseApi || '未知'}`,
    `配置来源：${data.configSource || '未知'}`,
    `解析用户标识：${data.resolvedUserId || '未知'}`,
    `模拟群号：${data.groupId || '未设置'}`,
    `API key：${data.apiKeyConfigured ? '已配置' : '未配置'}`,
    `是否为示例数据：${data.isPlaceholder ? '是' : '否'}`,
  ].join('\n');
}

function renderCompareResult() {
  const container = document.getElementById('sandbox-compare-result');
  const diffContainer = document.getElementById('sandbox-compare-diff');
  const promptContainer = document.getElementById('sandbox-compare-prompt');
  const result = sandboxState.compareResult;
  if (!result) {
    container.innerHTML = '<div class="detail-box">尚未运行对比</div><div class="detail-box">尚未运行对比</div>';
    diffContainer.textContent = '尚未运行对比';
    promptContainer.innerHTML = '<pre class="detail-box">尚未运行对比</pre><pre class="detail-box">尚未运行对比</pre>';
    return;
  }
  const diffLines = [];
  if (!result.a?.error && !result.b?.error) {
    if ((result.a.request?.model || '') !== (result.b.request?.model || '')) {
      diffLines.push(`模型差异：A=${result.a.request?.model || '未知'} / B=${result.b.request?.model || '未知'}`);
    }
    if (String(result.a.request?.temperature ?? '') !== String(result.b.request?.temperature ?? '')) {
      diffLines.push(`温度差异：A=${result.a.request?.temperature ?? '未知'} / B=${result.b.request?.temperature ?? '未知'}`);
    }
    if ((result.a.request?.configSource || '') !== (result.b.request?.configSource || '')) {
      diffLines.push(`配置来源差异：A=${result.a.request?.configSource || '未知'} / B=${result.b.request?.configSource || '未知'}`);
    }
    if (String(result.a.request?.systemPromptLength ?? '') !== String(result.b.request?.systemPromptLength ?? '')) {
      diffLines.push(`提示词长度差异：A=${result.a.request?.systemPromptLength ?? '未知'} / B=${result.b.request?.systemPromptLength ?? '未知'}`);
    }
    if (String(result.a.usage?.total_tokens ?? '') !== String(result.b.usage?.total_tokens ?? '')) {
      diffLines.push(`总用量差异：A=${result.a.usage?.total_tokens ?? '未知'} / B=${result.b.usage?.total_tokens ?? '未知'}`);
    }
  }
  diffContainer.textContent = diffLines.length > 0 ? diffLines.join('\n') : '本次对比未发现关键参数差异，主要可观察回复内容差异。';
  const replyA = result.a?.reply || (result.a?.error ? `对比请求失败：${result.a.error}` : '无回复');
  const replyB = result.b?.reply || (result.b?.error ? `对比请求失败：${result.b.error}` : '无回复');
  const replyLinesA = String(replyA).split('\n');
  const replyLinesB = String(replyB).split('\n');
  const replyLineCount = Math.max(replyLinesA.length, replyLinesB.length);
  const renderReplyDiff = (item, lines, otherLines) => {
    const header = item.error
      ? `对比请求失败：${escapeHtml(item.error)}`
      : [
          `模型：${escapeHtml(item.request?.model || '未知')}`,
          `温度：${item.request?.temperature ?? '未知'}`,
          `耗时：${item.elapsedMs ?? '未知'} ms`,
          `用量：${item.usage?.total_tokens ?? '未知'}`,
          `提示词长度：${item.request?.systemPromptLength ?? '未知'}`,
          `配置来源：${escapeHtml(item.request?.configSource || '未知')}`,
        ].join('<br>');
    const body = Array.from({ length: replyLineCount }, (_, index) => {
      const line = lines[index] || '';
      const isDiff = line !== (otherLines[index] || '');
      return `<div class="sandbox-diff-line ${isDiff ? 'changed' : ''}">${escapeHtml(line || ' ')}</div>`;
    }).join('');
    return `<div class="detail-box sandbox-diff-box"><div class="sandbox-diff-meta">${header}</div><div class="sandbox-diff-content">${body}</div></div>`;
  };
  container.innerHTML = [
    renderReplyDiff(result.a, replyLinesA, replyLinesB),
    renderReplyDiff(result.b, replyLinesB, replyLinesA),
  ].join('');
  const promptA = result.a?.systemPrompt || (result.a?.error ? `对比请求失败：${result.a.error}` : '无最终提示词');
  const promptB = result.b?.systemPrompt || (result.b?.error ? `对比请求失败：${result.b.error}` : '无最终提示词');
  const linesA = String(promptA).split('\n');
  const linesB = String(promptB).split('\n');
  const lineCount = Math.max(linesA.length, linesB.length);
  const renderPromptDiff = (lines, otherLines) => Array.from({ length: lineCount }, (_, index) => {
    const line = lines[index] || '';
    const isDiff = line !== (otherLines[index] || '');
    return `<div class="sandbox-diff-line ${isDiff ? 'changed' : ''}">${escapeHtml(line || ' ')}</div>`;
  }).join('');
  promptContainer.innerHTML = `
    <div class="detail-box sandbox-diff-box">${renderPromptDiff(linesA, linesB)}</div>
    <div class="detail-box sandbox-diff-box">${renderPromptDiff(linesB, linesA)}</div>
  `;
}
