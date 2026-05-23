async function initSessionDebug() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('sessionId') || '';
  const userId = params.get('userId') || '';
  if (!sessionId) {
    document.getElementById('session-debug-meta').textContent = '等待选择会话';
    document.getElementById('session-debug-cards').innerHTML = '';
    document.getElementById('session-debug-main').innerHTML = '<div class="detail-box">请先从最近会话列表打开某个会话的排查页。<div class="actions"><a class="link-btn" href="/session-center.html">返回会话列表</a></div></div>';
    ['session-debug-actions', 'session-debug-alerts', 'session-debug-summary', 'session-debug-runtime', 'session-debug-participants', 'session-debug-profiles', 'session-debug-topics', 'session-debug-expressions', 'session-debug-knowledge', 'session-debug-tool-calls', 'session-debug-prompt', 'session-debug-poke', 'session-debug-messages', 'session-debug-usage', 'session-debug-affinity'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.textContent = '';
    });
    document.getElementById('session-debug-raw').textContent = '{}';
    bindCommonActions();
    return;
  }
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
      <div>时间：${formatTime(item.time)} · 用量：${item.total_tokens || 0} · 耗时：${item.elapsed_ms || 0}ms</div>
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
  const pre = document.createElement('pre');
  pre.textContent = `对话排查加载失败: ${error?.message || String(error)}`;
  document.body.replaceChildren(pre);
});

