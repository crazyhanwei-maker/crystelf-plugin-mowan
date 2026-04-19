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
    image_monitor_review: '图片监控审核',
  };
  return sceneMap[key] || key || '未知';
}

function setRawJson(data) {
  document.getElementById('raw-json-box').textContent = JSON.stringify(data, null, 2);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderCards(cards) {
  document.getElementById('detail-cards').innerHTML = cards.map(item => `
    <div class="card ${item.tone ? `tone-${item.tone}` : ''}">
      <h3>${item.label}</h3>
      <div class="value detail-value">${item.value}</div>
    </div>
  `).join('');
}

function renderKeyValues(items) {
  document.getElementById('detail-main').innerHTML = items.map(item => `
    <div class="kv-item">
      <div class="kv-head">
        <div class="kv-label">${item.label}</div>
        <button class="mini-btn" data-copy-value="${escapeHtml(item.value)}">复制</button>
      </div>
      <div class="kv-value">${item.value}</div>
    </div>
  `).join('');
}

function renderPreviewSections(items) {
  document.getElementById('detail-preview').innerHTML = items.map(item => `
    <div class="preview-section">
      <div class="preview-head">
        <h3>${item.label}</h3>
        <button class="mini-btn" data-copy-value="${escapeHtml(item.value)}">复制</button>
      </div>
      <pre class="preview-box">${escapeHtml(item.value || '无')}</pre>
    </div>
  `).join('');
}

function renderDetailActions(items) {
  document.getElementById('detail-actions').innerHTML = items.map(item => item.href
    ? `<a class="link-btn" href="${item.href}">${item.label}</a>`
    : `<button class="${item.danger ? 'danger' : ''}" data-copy-value="${escapeHtml(item.copyValue || '')}">${item.label}</button>`
  ).join('');
}

function renderLinkedProfileSummary(data) {
  const element = document.getElementById('linked-profile-summary');
  if (!element) return;
  const profile = data?.profile;
  if (!profile) {
    element.textContent = '未找到可关联的用户画像';
    return;
  }
  const profileHref = `/profile-detail.html?sessionId=${encodeURIComponent(profile.sessionId || '')}&userId=${encodeURIComponent(profile.userId || '')}`;
  element.innerHTML = `
    <div class="profile-summary-grid">
      <div class="summary-item summary-span-2">
        <div class="summary-label">用户</div>
        <div class="summary-value">${escapeHtml(profile.userName || profile.userId)}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">会话</div>
        <div class="summary-value">${escapeHtml(profile.sessionId || '无')}</div>
      </div>
      <div class="summary-item summary-span-4">
        <div class="summary-label">概括</div>
        <div class="summary-value">${escapeHtml(profile.summary || '暂无')}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">特征</div>
        <div class="summary-value">${escapeHtml((profile.traits || []).join('、') || '暂无')}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">说话风格</div>
        <div class="summary-value">${escapeHtml((profile.speakingStyle || []).join('、') || '暂无')}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">互动偏好</div>
        <div class="summary-value">${escapeHtml((profile.interactionPreferences || []).join('、') || '暂无')}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">常聊话题</div>
        <div class="summary-value">${escapeHtml((profile.notableTopics || []).join('、') || '暂无')}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">置信度</div>
        <div class="summary-value">${escapeHtml(profile.confidence || '中')}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">参考消息数</div>
        <div class="summary-value">${escapeHtml(profile.sourceMessageCount || 0)}</div>
      </div>
      <div class="summary-item summary-span-4">
        <div class="actions summary-actions">
          <a class="link-btn" href="${profileHref}">跳转到画像详情</a>
        </div>
      </div>
    </div>
  `;
}

async function copyRawJson() {
  const text = document.getElementById('raw-json-box').textContent;
  await navigator.clipboard.writeText(text);
}

function bindCommonActions() {
  document.getElementById('toggle-raw-btn').addEventListener('click', () => {
    document.getElementById('raw-json-box').classList.toggle('hidden');
  });
  document.getElementById('copy-json-btn').addEventListener('click', () => {
    copyRawJson().catch(() => {});
  });
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.copyValue !== undefined) {
      navigator.clipboard.writeText(target.dataset.copyValue).catch(() => {});
    }
  }, { once: true });
}

async function initUsageLogDetail() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || '';
  const data = await fetchJson(`/api/logs/usage/detail?id=${encodeURIComponent(id)}`);
  document.getElementById('detail-meta').textContent = `${formatSceneLabel(data.scene) || '未知场景'} · ${formatTime(data.time)}`;
  renderCards([
    { label: '请求数', value: 1 },
    { label: '总 Tokens', value: Number(data.total_tokens || 0) },
    { label: '耗时(ms)', value: Number(data.elapsed_ms || 0) },
    { label: '状态', value: data.error ? '失败' : '成功', tone: data.error ? 'error' : 'success' },
  ]);
  renderDetailActions([
    data.session_id && data.user_id
      ? { label: '对话调试', href: `/session-debug.html?sessionId=${encodeURIComponent(data.session_id)}&userId=${encodeURIComponent(data.user_id)}` }
      : null,
    data.session_id && data.user_id
      ? { label: '查看用户画像', href: `/profile-detail.html?sessionId=${encodeURIComponent(data.session_id)}&userId=${encodeURIComponent(data.user_id)}` }
      : null,
    data.group_id && data.user_id
      ? { label: '查看好感历史', href: `/affinity-detail.html?groupId=${encodeURIComponent(data.group_id)}&userId=${encodeURIComponent(data.user_id)}` }
      : null,
    { label: '复制用户 ID', copyValue: data.user_id || '' },
    { label: '复制会话 ID', copyValue: data.session_id || '' },
  ].filter(Boolean));
  renderKeyValues([
    { label: '时间', value: formatTime(data.time) },
    { label: '场景', value: formatSceneLabel(data.scene) },
    { label: '模型', value: data.model || '未知' },
    { label: '提供方', value: data.provider || '未知' },
    { label: '会话', value: data.session_id || '无' },
    { label: '群号', value: data.group_id || '无' },
    { label: '用户', value: data.user_id || '无' },
    { label: '工具数', value: data.tool_count ?? 0 },
    { label: 'Prompt Tokens', value: data.prompt_tokens ?? 0 },
    { label: 'Completion Tokens', value: data.completion_tokens ?? 0 },
  ]);
  renderPreviewSections([
    { label: 'Prompt 预览', value: data.display_prompt_preview || data.prompt_preview || '无' },
    { label: 'Response 预览', value: data.display_response_preview || data.response_preview || '无' },
    { label: '错误信息', value: data.error || '无' },
  ]);
  if (data.session_id && data.user_id) {
    try {
      const profile = await fetchJson(`/api/profile-detail?sessionId=${encodeURIComponent(data.session_id)}&userId=${encodeURIComponent(data.user_id)}`);
      renderLinkedProfileSummary(profile);
    } catch {
      renderLinkedProfileSummary(null);
    }
  } else {
    renderLinkedProfileSummary(null);
  }
  setRawJson(data);
  bindCommonActions();
}

async function initAffinityLogDetail() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || '';
  const data = await fetchJson(`/api/logs/affinity/detail?id=${encodeURIComponent(id)}`);
  document.getElementById('detail-meta').textContent = `${data.group_id || '未知群'} / ${data.user_id || '未知用户'} · ${formatTime(data.time)}`;
  renderCards([
    { label: '变化值', value: Number(data.delta ?? 0), tone: Number(data.delta ?? 0) > 0 ? 'success' : Number(data.delta ?? 0) < 0 ? 'error' : 'neutral' },
    { label: '结果分', value: Number(data.current_score ?? 0) },
    { label: '档位', value: data.level || '未知' },
    { label: '互动数', value: Number(data.interaction_count ?? 0) },
  ]);
  renderDetailActions([
    data.group_id && data.user_id
      ? { label: '查看好感历史', href: `/affinity-detail.html?groupId=${encodeURIComponent(data.group_id)}&userId=${encodeURIComponent(data.user_id)}` }
      : null,
    { label: '复制群号', copyValue: data.group_id || '' },
    { label: '复制用户 ID', copyValue: data.user_id || '' },
    { label: '复制原因', copyValue: data.reason || '' },
  ].filter(Boolean));
  renderKeyValues([
    { label: '时间', value: formatTime(data.time) },
    { label: '群号', value: data.group_id || '无' },
    { label: '用户', value: data.user_id || '无' },
    { label: '原因', value: data.reason || '无' },
    { label: '保护', value: data.guard || '无' },
    { label: '匹配关键词', value: data.matched_keyword || '无' },
    { label: '上次分值', value: data.previous_score ?? 0 },
    { label: '当前分值', value: data.current_score ?? 0 },
    { label: '分值变化说明', value: `${data.previous_score ?? 0} → ${data.current_score ?? 0} (${Number(data.delta ?? 0) > 0 ? '+' : ''}${Number(data.delta ?? 0)})` },
  ]);
  renderPreviewSections([
    { label: '文本预览', value: data.text_preview || '无' },
    { label: '原因说明', value: data.reason || '无' },
    { label: '保护状态', value: data.guard || '无' },
  ]);
  if (data.group_id && data.user_id) {
    try {
      const sessionId = `group:${data.group_id}`;
      const profile = await fetchJson(`/api/profile-detail?sessionId=${encodeURIComponent(sessionId)}&userId=${encodeURIComponent(data.user_id)}`);
      renderLinkedProfileSummary(profile);
    } catch {
      renderLinkedProfileSummary(null);
    }
  } else {
    renderLinkedProfileSummary(null);
  }
  setRawJson(data);
  bindCommonActions();
}

const runner = location.pathname.includes('usage-log-detail') ? initUsageLogDetail : initAffinityLogDetail;
runner().catch(error => {
  document.body.innerHTML = `<pre>日志详情加载失败: ${error.message}</pre>`;
});
