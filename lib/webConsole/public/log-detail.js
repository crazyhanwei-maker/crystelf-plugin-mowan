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
  if (!value) return '\u672a\u77e5';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatSceneLabel(scene) {
  const key = String(scene || '').trim();
  const sceneMap = {
    chat: '\u901a\u7528\u5bf9\u8bdd',
    chat_text: '\u6587\u672c\u5bf9\u8bdd',
    chat_multimodal: '\u591a\u6a21\u6001\u5bf9\u8bdd',
    chat_engine: '\u5bf9\u8bdd\u5f15\u64ce',
    chat_engine_fallback: '\u5bf9\u8bdd\u964d\u7ea7\u5904\u7406',
    chat_engine_final: '\u5bf9\u8bdd\u6700\u7ec8\u751f\u6210',
    poke_follow_reply: '\u6233\u4e00\u6233\u8ddf\u968f\u56de\u590d',
    poke_ai_reply: '\u6233\u4e00\u6233 AI \u56de\u590d',
    image_monitor_review: '\u56fe\u7247\u76d1\u63a7\u5ba1\u6838',
  };
  return sceneMap[key] || key || '\u672a\u77e5';
}

function isImageMonitorReviewUsage(data = {}) {
  return String(data.scene || '').trim().toLowerCase() === 'image_monitor_review';
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

function sanitizeUrl(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const allowRelative = options.allowRelative !== false;

  try {
    if (allowRelative && /^\/(?!\/)/.test(raw)) {
      const parsed = new URL(raw, window.location.origin);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    if (!/^https?:\/\//i.test(raw)) {
      return '';
    }

    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function renderFatalError(message) {
  const pre = document.createElement('pre');
  pre.textContent = `\u65e5\u5fd7\u8be6\u60c5\u52a0\u8f7d\u5931\u8d25: ${message}`;
  document.body.replaceChildren(pre);
}

function renderCards(cards) {
  document.getElementById('detail-cards').innerHTML = cards.map(item => `
    <div class="card ${item.tone ? `tone-${item.tone}` : ''}">
      <h3>${escapeHtml(item.label)}</h3>
      <div class="value detail-value">${escapeHtml(item.value)}</div>
    </div>
  `).join('');
}

function renderKeyValues(items) {
  document.getElementById('detail-main').innerHTML = items.map(item => `
    <div class="kv-item">
      <div class="kv-head">
        <div class="kv-label">${escapeHtml(item.label)}</div>
        <button class="mini-btn" data-copy-value="${escapeHtml(item.value)}">\u590d\u5236</button>
      </div>
      <div class="kv-value">${escapeHtml(item.value)}</div>
    </div>
  `).join('');
}

function renderPreviewSections(items) {
  document.getElementById('detail-preview').innerHTML = items.map(item => `
    <div class="preview-section">
      <div class="preview-head">
        <h3>${escapeHtml(item.label)}</h3>
        <button class="mini-btn" data-copy-value="${escapeHtml(item.value)}">\u590d\u5236</button>
      </div>
      <pre class="preview-box">${escapeHtml(item.value || '\u65e0')}</pre>
    </div>
  `).join('');
}

function renderActionItem(item) {
  const label = escapeHtml(item.label);
  const href = sanitizeUrl(item.href, { allowRelative: true });

  if (href) {
    return `<a class="link-btn" href="${escapeHtml(href)}">${label}</a>`;
  }

  return `<button class="${item.danger ? 'danger' : ''}" data-copy-value="${escapeHtml(item.copyValue || '')}">${label}</button>`;
}

function renderDetailActions(items) {
  document.getElementById('detail-actions').innerHTML = items.map(item => renderActionItem(item)).join('');
}

function renderLinkedProfileSummary(data) {
  const element = document.getElementById('linked-profile-summary');
  if (!element) return;

  const profile = data?.profile;
  if (!profile) {
    element.textContent = '\u672a\u627e\u5230\u53ef\u5173\u8054\u7684\u7528\u6237\u753b\u50cf';
    return;
  }

  const profileHref = sanitizeUrl(`/profile-detail.html?sessionId=${encodeURIComponent(profile.sessionId || '')}&userId=${encodeURIComponent(profile.userId || '')}`);
  element.innerHTML = `
    <div class="profile-summary-grid">
      <div class="summary-item summary-span-2">
        <div class="summary-label">\u7528\u6237</div>
        <div class="summary-value">${escapeHtml(profile.userName || profile.userId)}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">\u4f1a\u8bdd</div>
        <div class="summary-value">${escapeHtml(profile.sessionId || '\u65e0')}</div>
      </div>
      <div class="summary-item summary-span-4">
        <div class="summary-label">\u6982\u62ec</div>
        <div class="summary-value">${escapeHtml(profile.summary || '\u6682\u65e0')}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">\u7279\u5f81</div>
        <div class="summary-value">${escapeHtml((profile.traits || []).join('\u3001') || '\u6682\u65e0')}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">\u8bf4\u8bdd\u98ce\u683c</div>
        <div class="summary-value">${escapeHtml((profile.speakingStyle || []).join('\u3001') || '\u6682\u65e0')}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">\u4e92\u52a8\u504f\u597d</div>
        <div class="summary-value">${escapeHtml((profile.interactionPreferences || []).join('\u3001') || '\u6682\u65e0')}</div>
      </div>
      <div class="summary-item summary-span-2">
        <div class="summary-label">\u5e38\u804a\u8bdd\u9898</div>
        <div class="summary-value">${escapeHtml((profile.notableTopics || []).join('\u3001') || '\u6682\u65e0')}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">\u7f6e\u4fe1\u5ea6</div>
        <div class="summary-value">${escapeHtml(profile.confidence || '\u4e2d')}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">\u53c2\u8003\u6d88\u606f\u6570</div>
        <div class="summary-value">${escapeHtml(profile.sourceMessageCount || 0)}</div>
      </div>
      <div class="summary-item summary-span-4">
        <div class="actions summary-actions">
          <a class="link-btn" href="${escapeHtml(profileHref)}">\u8df3\u8f6c\u5230\u753b\u50cf\u8be6\u60c5</a>
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
  });
}

async function initUsageLogDetail() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || '';
  const data = await fetchJson(`/api/logs/usage/detail?id=${encodeURIComponent(id)}`);

  document.getElementById('detail-meta').textContent = `${formatSceneLabel(data.scene) || '\u672a\u77e5\u573a\u666f'} \u00b7 ${formatTime(data.time)}`;

  renderCards([
    { label: '\u8bf7\u6c42\u6570', value: 1 },
    { label: '\u603b Tokens', value: Number(data.total_tokens || 0) },
    { label: '\u8017\u65f6(ms)', value: Number(data.elapsed_ms || 0) },
    { label: '\u72b6\u6001', value: data.error ? '\u5931\u8d25' : '\u6210\u529f', tone: data.error ? 'error' : 'success' },
  ]);

  renderDetailActions([
    data.session_id && data.user_id
      ? { label: '\u5bf9\u8bdd\u8c03\u8bd5', href: `/session-debug.html?sessionId=${encodeURIComponent(data.session_id)}&userId=${encodeURIComponent(data.user_id)}` }
      : null,
    data.session_id && data.user_id
      ? { label: '\u67e5\u770b\u7528\u6237\u753b\u50cf', href: `/profile-detail.html?sessionId=${encodeURIComponent(data.session_id)}&userId=${encodeURIComponent(data.user_id)}` }
      : null,
    data.group_id && data.user_id
      ? { label: '\u67e5\u770b\u597d\u611f\u5386\u53f2', href: `/affinity-detail.html?groupId=${encodeURIComponent(data.group_id)}&userId=${encodeURIComponent(data.user_id)}` }
      : null,
    { label: '\u590d\u5236\u7528\u6237 ID', copyValue: data.user_id || '' },
    { label: '\u590d\u5236\u4f1a\u8bdd ID', copyValue: data.session_id || '' },
  ].filter(Boolean));

  renderKeyValues([
    { label: '\u65f6\u95f4', value: formatTime(data.time) },
    { label: '\u573a\u666f', value: formatSceneLabel(data.scene) },
    { label: '\u6a21\u578b', value: data.model || '\u672a\u77e5' },
    { label: '\u63d0\u4f9b\u65b9', value: data.provider || '\u672a\u77e5' },
    { label: '\u4f1a\u8bdd', value: data.session_id || '\u65e0' },
    { label: '\u7fa4\u53f7', value: data.group_id || '\u65e0' },
    { label: '\u7528\u6237', value: data.user_id || '\u65e0' },
    { label: '\u5de5\u5177\u6570', value: data.tool_count ?? 0 },
    { label: 'Prompt Tokens', value: data.prompt_tokens ?? 0 },
    { label: 'Completion Tokens', value: data.completion_tokens ?? 0 },
  ]);

  renderPreviewSections([
    ...(!isImageMonitorReviewUsage(data) ? [{ label: 'Prompt \u9884\u89c8', value: data.display_prompt_preview || data.prompt_preview || '\u65e0' }] : []),
    { label: 'Response \u9884\u89c8', value: data.display_response_preview || data.response_preview || '\u65e0' },
    { label: '\u9519\u8bef\u4fe1\u606f', value: data.error || '\u65e0' },
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

  document.getElementById('detail-meta').textContent = `${data.group_id || '\u672a\u77e5\u7fa4'} / ${data.user_id || '\u672a\u77e5\u7528\u6237'} \u00b7 ${formatTime(data.time)}`;

  renderCards([
    { label: '\u53d8\u5316\u503c', value: Number(data.delta ?? 0), tone: Number(data.delta ?? 0) > 0 ? 'success' : Number(data.delta ?? 0) < 0 ? 'error' : 'neutral' },
    { label: '\u7ed3\u679c\u5206', value: Number(data.current_score ?? 0) },
    { label: '\u6863\u4f4d', value: data.level || '\u672a\u77e5' },
    { label: '\u4e92\u52a8\u6570', value: Number(data.interaction_count ?? 0) },
  ]);

  renderDetailActions([
    data.group_id && data.user_id
      ? { label: '\u67e5\u770b\u597d\u611f\u5386\u53f2', href: `/affinity-detail.html?groupId=${encodeURIComponent(data.group_id)}&userId=${encodeURIComponent(data.user_id)}` }
      : null,
    { label: '\u590d\u5236\u7fa4\u53f7', copyValue: data.group_id || '' },
    { label: '\u590d\u5236\u7528\u6237 ID', copyValue: data.user_id || '' },
    { label: '\u590d\u5236\u539f\u56e0', copyValue: data.reason || '' },
  ].filter(Boolean));

  renderKeyValues([
    { label: '\u65f6\u95f4', value: formatTime(data.time) },
    { label: '\u7fa4\u53f7', value: data.group_id || '\u65e0' },
    { label: '\u7528\u6237', value: data.user_id || '\u65e0' },
    { label: '\u539f\u56e0', value: data.reason || '\u65e0' },
    { label: '\u4fdd\u62a4', value: data.guard || '\u65e0' },
    { label: '\u5339\u914d\u5173\u952e\u8bcd', value: data.matched_keyword || '\u65e0' },
    { label: '\u4e0a\u6b21\u5206\u503c', value: data.previous_score ?? 0 },
    { label: '\u5f53\u524d\u5206\u503c', value: data.current_score ?? 0 },
    { label: '\u5206\u503c\u53d8\u5316\u8bf4\u660e', value: `${data.previous_score ?? 0} -> ${data.current_score ?? 0} (${Number(data.delta ?? 0) > 0 ? '+' : ''}${Number(data.delta ?? 0)})` },
  ]);

  renderPreviewSections([
    { label: '\u6587\u672c\u9884\u89c8', value: data.text_preview || '\u65e0' },
    { label: '\u539f\u56e0\u8bf4\u660e', value: data.reason || '\u65e0' },
    { label: '\u4fdd\u62a4\u72b6\u6001', value: data.guard || '\u65e0' },
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
  renderFatalError(error?.message || String(error));
});
