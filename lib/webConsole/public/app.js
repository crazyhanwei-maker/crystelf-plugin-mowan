const state = {
  sessionPage: 1,
  affinityPage: 1,
  profilePage: 1,
  usageLogPage: 1,
  affinityLogPage: 1,
  imageMonitorLogPage: 1,
  imageMonitorMemePage: 1,
  activeTopTab: 'usage-tab',
  refreshRequestId: 0,
  lastRefreshAt: 0,
  filterRefreshTimer: null,
};

let modalResolver = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHeaders(extra = {}) {
  return { ...extra };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store', headers: buildHeaders() });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return await response.json();
}

async function fetchJsonSafe(url, fallback) {
  try {
    return await fetchJson(url);
  } catch (error) {
    return {
      ...fallback,
      __error: error.message,
    };
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `${url} -> ${response.status}`);
  }
  return data;
}

function formatTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: Number.isInteger(number) ? 0 : 2,
  }).format(number);
}
function formatSceneLabel(scene) {
  const key = String(scene || '').trim();
  const sceneMap = {
    chat: '对话',
    chat_text: '文本对话',
    chat_multimodal: '多模态对话',
    chat_engine: '对话引擎',
    chat_engine_fallback: '对话引擎兜底',
    chat_engine_final: '对话引擎最终回复',
    poke_follow_reply: '戳一戳接话回复',
    poke_ai_reply: '戳一戳 AI 回复',
    poke_image_summary: '戳一戳图片摘要',
    image_monitor_review: '图片监控审核',
  };
  return sceneMap[key] || key || '未知场景';
}
function formatImageMonitorAction(action) {
  switch (String(action || '').trim().toLowerCase()) {
    case 'alert':
      return '告警';
    case 'recall':
      return '撤回';
    case 'record':
    default:
      return '记录';
  }
}
function formatImageMonitorRisk(level) {
  switch (String(level || '').trim().toLowerCase()) {
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    case 'low':
      return '低风险';
    case 'none':
    default:
      return '无风险';
  }
}
function getImageMonitorRiskTone(level) {
  switch (String(level || '').trim().toLowerCase()) {
    case 'high':
      return 'error';
    case 'medium':
      return 'neutral';
    default:
      return 'success';
  }
}

function renderSafeImageMonitorThumb(url, alt) {
  if (!url) {
    return '<div class="image-monitor-thumb-placeholder">无图片</div>';
  }
  const previewUrl = `/api/image-proxy?url=${encodeURIComponent(url)}`;
  return `
    <a class="image-monitor-thumb-link" href="${url}" target="_blank" rel="noopener noreferrer">
      <img class="image-monitor-thumb" src="${previewUrl}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer" />
    </a>
  `;
}

function handleImageMonitorThumbError(target) {
  if (!(target instanceof HTMLImageElement) || !target.classList.contains('image-monitor-thumb')) {
    return;
  }
  const link = target.closest('.image-monitor-thumb-link');
  if (!link) {
    return;
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'image-monitor-thumb-placeholder';
  placeholder.textContent = '图片加载失败';
  link.replaceWith(placeholder);
}

function getFilters() {
  return {
    sessionQuery: document.getElementById('session-search')?.value?.trim() || '',
    sessionId: document.getElementById('session-id-filter')?.value?.trim() || '',
    sessionUserId: document.getElementById('session-user-filter')?.value?.trim() || '',
    affinityQuery: document.getElementById('affinity-search')?.value?.trim() || '',
    affinityGroupId: document.getElementById('affinity-group-filter')?.value?.trim() || '',
    profileQuery: document.getElementById('profile-search')?.value?.trim() || '',
    profileSessionId: document.getElementById('profile-session-filter')?.value?.trim() || '',
    usageLogQuery: document.getElementById('usage-log-search')?.value?.trim() || '',
    usageLogScene: document.getElementById('usage-log-scene')?.value?.trim() || '',
    affinityLogQuery: document.getElementById('affinity-log-search')?.value?.trim() || '',
    affinityLogGroup: document.getElementById('affinity-log-group')?.value?.trim() || '',
    imageMonitorLogQuery: document.getElementById('image-monitor-log-search')?.value?.trim() || '',
    imageMonitorMemeQuery: document.getElementById('image-monitor-meme-search')?.value?.trim() || '',
  };
}

function setRefreshButtonsDisabled(disabled) {
  ['refresh-btn', 'refresh-image-monitor-btn', 'clear-filters-btn', 'mobile-refresh-btn', 'mobile-clear-filters-btn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) {
      button.disabled = disabled;
    }
  });
}

function setRefreshStatus(message, tone = 'neutral') {
  const box = document.getElementById('refresh-status');
  if (!box) return;
  box.textContent = message;
  box.className = `setting-help refresh-status tone-${tone}`;
}

function resetPagedStates(filterId) {
  const pageMap = {
    'session-search': 'sessionPage',
    'session-id-filter': 'sessionPage',
    'session-user-filter': 'sessionPage',
    'affinity-search': 'affinityPage',
    'affinity-group-filter': 'affinityPage',
    'profile-search': 'profilePage',
    'profile-session-filter': 'profilePage',
    'usage-log-search': 'usageLogPage',
    'usage-log-scene': 'usageLogPage',
    'affinity-log-search': 'affinityLogPage',
    'affinity-log-group': 'affinityLogPage',
    'image-monitor-log-search': 'imageMonitorLogPage',
    'image-monitor-meme-search': 'imageMonitorMemePage',
  };
  const pageKey = pageMap[filterId];
  if (pageKey) {
    state[pageKey] = 1;
  }
}

function buildActiveFilterItems(filters) {
  const labels = {
    sessionQuery: '会话搜索',
    sessionId: '会话 ID',
    sessionUserId: '会话用户',
    affinityQuery: '好感搜索',
    affinityGroupId: '好感群号',
    profileQuery: '画像搜索',
    profileSessionId: '画像会话',
    usageLogQuery: '用量日志搜索',
    usageLogScene: '用量场景',
    affinityLogQuery: '好感日志搜索',
    affinityLogGroup: '好感日志群号',
    imageMonitorLogQuery: '图片审核搜索',
    imageMonitorMemeQuery: '表情包搜索',
  };
  return Object.entries(filters)
    .filter(([, value]) => String(value || '').trim())
    .map(([key, value]) => ({
      key,
      label: labels[key] || key,
      value: String(value).trim(),
    }));
}

function renderActiveFilters() {
  const container = document.getElementById('active-filters');
  if (!container) return;
  const items = buildActiveFilterItems(getFilters());
  container.innerHTML = items.length > 0
    ? items.map(item => `<span class="active-filter-chip"><strong>${escapeHtml(item.label)}</strong>${escapeHtml(item.value)}</span>`).join('')
    : '<span class="active-filter-empty">当前没有启用筛选条件</span>';
}

function clearAllFilters() {
  [
    'session-search',
    'session-id-filter',
    'session-user-filter',
    'affinity-search',
    'affinity-group-filter',
    'profile-search',
    'profile-session-filter',
    'usage-log-search',
    'usage-log-scene',
    'affinity-log-search',
    'affinity-log-group',
    'image-monitor-log-search',
    'image-monitor-meme-search',
  ].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.value = '';
    }
  });

  state.sessionPage = 1;
  state.affinityPage = 1;
  state.profilePage = 1;
  state.usageLogPage = 1;
  state.affinityLogPage = 1;
  state.imageMonitorLogPage = 1;
  state.imageMonitorMemePage = 1;
  renderActiveFilters();
}

function handleClearFilters() {
  clearAllFilters();
  return refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
}
function scheduleRefresh(delay = 260) {
  if (state.filterRefreshTimer) {
    clearTimeout(state.filterRefreshTimer);
  }
  state.filterRefreshTimer = setTimeout(() => {
    state.filterRefreshTimer = null;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  }, delay);
}
function openModal(title, content, { confirmText = '确认', cancelText = '取消', showCancel = true, html = false } = {}) {
  const mask = document.getElementById('modal-mask');
  document.getElementById('modal-title').textContent = title;
  const modalContent = document.getElementById('modal-content');
  if (html) {
    modalContent.innerHTML = content;
  } else {
    modalContent.textContent = content;
  }
  document.getElementById('modal-confirm-btn').textContent = confirmText;
  document.getElementById('modal-cancel-btn').textContent = cancelText;
  document.getElementById('modal-cancel-btn').classList.toggle('hidden', !showCancel);
  mask.classList.remove('hidden');
  return new Promise(resolve => {
    state.modalResolver = resolve;
  });
}

function closeModal(result) {
  document.getElementById('modal-mask').classList.add('hidden');
  if (modalResolver) {
    const resolve = modalResolver;
    modalResolver = null;
    resolve(result);
  }
}

function switchTopTab(tabId) {
  state.activeTopTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.tabTarget === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== tabId);
  });
}

function renderTrendChart(data) {
  const items = data.items || [];
  document.getElementById('trend-chart').textContent = items.length > 0
    ? items.map(item => {
        const bar = '#'.repeat(Math.max(1, Math.min(30, item.requests)));
        return `${item.hour}  ${bar}  请求:${item.requests}  令牌:${item.tokens}  错误:${item.errors}`;
      }).join('\n')
    : '暂无用量趋势数据';
}
function renderImageMonitorUsageTrend(data) {
  const items = data.items || [];
  const box = document.getElementById('image-monitor-usage-trend');
  if (!box) return;
  box.textContent = items.length > 0
    ? items.map(item => {
        const bar = '#'.repeat(Math.max(1, Math.min(30, item.requests)));
        return `${item.hour}  ${bar}  请求:${item.requests}  令牌:${item.tokens}  错误:${item.errors}`;
      }).join('\n')
    : '暂无图片监控用量趋势数据';
}
function renderPokeImageSummaryTrend(data) {
  const items = data.items || [];
  const box = document.getElementById('poke-image-summary-trend');
  if (!box) return;
  box.textContent = items.length > 0
    ? ['戳一戳图片摘要趋势 / 最近 24 小时', ...items.map(item => {
        const bar = '#'.repeat(Math.max(1, Math.min(30, item.requests)));
        return `${item.hour}  ${bar}  请求:${item.requests}  令牌:${item.tokens}  错误:${item.errors}`;
      })].join('\n')
    : '暂无戳一戳图片摘要趋势数据';
}

const MEME_DELIVERY_CARD_ID = 'meme-delivery-overview-card';

function getMemeDeliverySourceLabel(source) {
  const value = String(source || '').trim().toLowerCase();
  if (value.startsWith('remote')) return '远程图';
  if (value.startsWith('local')) return '本地图';
  return '未命中';
}

function buildMemeDeliveryOverviewCard(result = null) {
  if (!result) {
    return {
      id: MEME_DELIVERY_CARD_ID,
      label: '表情 API 图链路',
      valueText: '检测中',
      valueClass: 'overview-card-value-text',
      metaHtml: [
        '<div class="detail-tags"><span class="detail-tag tone-neutral">等待检测</span></div>',
        '<div class="overview-card-meta-note">首页会异步检查远程表情 API、本地兜底目录，以及最终实际会走的发送路径。</div>',
      ].join(''),
      tag: '表情',
      size: 12,
      tone: 'accent',
      action: '<a class="link-btn" href="/api-settings.html">打开接口设置中心</a>',
    };
  }

  if (result.__error) {
    return {
      id: MEME_DELIVERY_CARD_ID,
      label: '表情 API 图链路',
      valueText: '检测失败',
      valueClass: 'overview-card-value-text',
      metaHtml: [
        '<div class="detail-tags"><span class="detail-tag tone-error">接口异常</span></div>',
        `<div class="overview-card-meta-note">读取检测接口失败: ${escapeHtml(result.__error)}</div>`,
      ].join(''),
      tag: '异常',
      size: 12,
      tone: 'error',
      action: '<a class="link-btn" href="/api-settings.html">打开接口设置中心</a>',
    };
  }

  const remoteConfigured = result.remote?.configured === true;
  const remoteUsable = result.remoteUsable === true;
  const localEnabled = result.local?.enabled !== false;
  const localUsable = result.localUsable === true;
  const preferLocal = result.local?.preferLocal === true;
  const finalSourceLabel = getMemeDeliverySourceLabel(result.final?.source);

  let valueText = '不可用';
  let tag = '异常';
  let tone = 'error';
  const chips = [];

  if (remoteUsable && String(result.final?.source || '').startsWith('remote')) {
    valueText = '远程可用';
    tag = '远程';
    tone = 'success';
    chips.push(`<span class="detail-tag tone-success">远程 ${formatNumber(result.remote?.latencyMs || 0)} ms</span>`);
  } else if (remoteUsable && localUsable && preferLocal) {
    valueText = '本地优先';
    tag = '配置';
    tone = 'accent';
    chips.push('<span class="detail-tag tone-neutral">远程可用</span>');
    chips.push('<span class="detail-tag">当前优先本地</span>');
  } else if (!remoteUsable && localUsable) {
    valueText = remoteConfigured ? '本地兜底' : '仅本地';
    tag = '本地';
    tone = 'accent';
    chips.push(`<span class="detail-tag tone-neutral">${remoteConfigured ? '远程不可用' : '未配置远程'}</span>`);
    chips.push('<span class="detail-tag tone-success">本地可用</span>');
  } else if (remoteUsable) {
    valueText = '远程可用';
    tag = '远程';
    tone = 'success';
    chips.push(`<span class="detail-tag tone-success">远程 ${formatNumber(result.remote?.latencyMs || 0)} ms</span>`);
  } else {
    chips.push(`<span class="detail-tag ${remoteConfigured ? 'tone-error' : 'tone-neutral'}">${remoteConfigured ? '远程不可用' : '未配置远程'}</span>`);
    chips.push(`<span class="detail-tag ${localEnabled ? 'tone-error' : ''}">${localEnabled ? '本地未命中' : '本地已关闭'}</span>`);
  }

  chips.push(`<span class="detail-tag">最终 ${escapeHtml(finalSourceLabel)}</span>`);

  const remoteSummary = !remoteConfigured
    ? '远程: 未配置'
    : remoteUsable
      ? `远程: HTTP ${result.remote?.httpStatus || 200} / ${result.remote?.contentType || 'image/*'} / ${formatNumber(result.remote?.latencyMs || 0)} ms`
      : `远程: ${result.remote?.error || '未通过可用性检测'}`;
  const localSummary = !localEnabled
    ? '本地: 已关闭'
    : localUsable
      ? `本地: 已命中 ${result.local?.candidateEmotion || result.final?.emotion || result.requestedEmotion || 'default'}`
      : '本地: 未找到匹配图片';
  const identitySummary = `角色: ${result.character || '暂无'} / 情绪: ${result.requestedEmotion || 'default'} / 最终: ${finalSourceLabel}`;
  const detailSummary = `结论: ${result.detail || result.error || '暂无检测详情'}`;

  return {
    id: MEME_DELIVERY_CARD_ID,
    label: '表情 API 图链路',
    valueText,
    valueClass: 'overview-card-value-text',
    metaHtml: [
      `<div class="detail-tags">${chips.join('')}</div>`,
      `<div class="overview-card-meta">${escapeHtml(identitySummary)}</div>`,
      `<div class="overview-card-meta-note">${escapeHtml(remoteSummary)}<br>${escapeHtml(localSummary)}<br>${escapeHtml(detailSummary)}</div>`,
    ].join(''),
    tag,
    size: 12,
    tone,
    action: '<a class="link-btn" href="/api-settings.html">打开接口设置中心</a>',
  };
}

function renderOverviewCard(item) {
  const valueContent = item.valueText === undefined ? formatNumber(item.value) : escapeHtml(item.valueText);
  const metaContent = item.metaHtml || escapeHtml(item.meta || '');
  const idAttr = item.id ? ` id="${escapeHtml(item.id)}"` : '';
  return `
    <div${idAttr} class="card overview-card overview-card-span-${item.size} ${item.tone ? `overview-card-${item.tone}` : ''}">
      <div class="overview-card-head">
        <h3>${escapeHtml(item.label)}</h3>
        <span class="overview-card-tag">${escapeHtml(item.tag)}</span>
      </div>
      <div class="value ${item.valueClass || ''}">${valueContent}</div>
      <div class="overview-card-meta-wrap">${metaContent}</div>
      ${item.action ? `<div class="overview-card-action">${item.action}</div>` : ''}
    </div>
  `;
}

function renderMemeDeliveryOverviewCard(result = null) {
  const container = document.getElementById('overview-cards');
  if (!container) return;
  const html = renderOverviewCard(buildMemeDeliveryOverviewCard(result));
  const existingCard = document.getElementById(MEME_DELIVERY_CARD_ID);
  if (existingCard) {
    existingCard.outerHTML = html;
    return;
  }
  container.insertAdjacentHTML('beforeend', html);
}

function renderOverview(data) {
  if (data.__error) {
    document.getElementById('overview-cards').innerHTML = '<div class="card">概览数据暂不可用</div>';
    document.getElementById('usage-box').textContent = '用量概览暂不可用';
    document.getElementById('image-monitor-usage-box').textContent = '图片监控概览暂不可用';
    return;
  }

  const strips = [
    {
      label: '插件',
      value: '魔丸控制台',
      meta: `v${escapeHtml(data.plugin?.version || '-')}`,
      tone: 'primary',
    },
    {
      label: '运行环境',
      value: escapeHtml(data.runtime?.node || '-'),
      meta: escapeHtml(data.runtime?.platform || '-'),
      tone: 'accent',
    },
    {
      label: '更新时间',
      value: escapeHtml(formatTime(Date.now())),
      meta: '控制台快照',
      tone: 'success',
    },
  ];

  const stripBox = document.getElementById('dashboard-strip') || document.getElementById('overview-strip');
  if (stripBox) {
    stripBox.innerHTML = strips
      .map(item => `
        <div class="dashboard-strip-item tone-${item.tone}">
          <div class="dashboard-strip-label">${item.label}</div>
          <div class="dashboard-strip-value">${item.value}</div>
          <div class="dashboard-strip-meta">${item.meta}</div>
        </div>
      `)
      .join('');
  }

  const pluginMeta = document.getElementById('plugin-meta');
  if (pluginMeta) {
    const pluginName = '魔丸控制台';
    const pluginVersion = escapeHtml(data.plugin?.version || '-');
    const runtimeNode = escapeHtml(data.runtime?.node || '-');
    const runtimePlatform = escapeHtml(data.runtime?.platform || '-');
    pluginMeta.textContent = `${pluginName} v${pluginVersion} / 运行环境 Node ${runtimeNode} / ${runtimePlatform}`;
  }

  const cards = [
    {
      label: '会话数',
      value: data.counts.sessions,
      meta: '当前已记录的会话数量',
      tag: '会话',
      size: 3,
      action: '<a class="link-btn" href="/session-center.html">查看会话</a>',
    },
    {
      label: '消息数',
      value: data.counts.messages,
      meta: '当前已保存的消息数量',
      tag: '消息',
      size: 3,
    },
    {
      label: '画像数',
      value: data.counts.profiles,
      meta: '已生成的用户画像数量',
      tag: '画像',
      size: 3,
    },
    {
      label: '好感用户',
      value: data.counts.affinityUsers,
      meta: '存在好感记录的用户数',
      tag: '好感',
      size: 3,
    },
    {
      label: 'AI 请求数',
      value: data.usage.requestCount,
      meta: `成功 ${formatNumber(data.usage.successCount)} / 失败 ${formatNumber(data.usage.errorCount)}`,
      tag: '请求',
      size: 4,
      tone: 'primary',
    },
    {
      label: '图片监控请求',
      value: data.usage.imageMonitor?.requestCount || 0,
      meta: `成功 ${formatNumber(data.usage.imageMonitor?.successCount || 0)} / 失败 ${formatNumber(data.usage.imageMonitor?.errorCount || 0)}`,
      tag: '监控',
      size: 4,
    },
    {
      label: '戳一戳图片摘要',
      value: data.usage.pokeImageSummary?.requestCount || 0,
      meta: `成功 ${formatNumber(data.usage.pokeImageSummary?.successCount || 0)} / 失败 ${formatNumber(data.usage.pokeImageSummary?.errorCount || 0)}`,
      tag: '戳图',
      size: 4,
    },
    {
      label: '图片监控令牌',
      value: data.usage.imageMonitor?.totalTokens || 0,
      meta: `均值 ${formatNumber(data.usage.imageMonitor?.averageTokens || 0)} / 占比 ${((Number(data.usage.imageMonitor?.tokenRatio || 0)) * 100).toFixed(2)}%`,
      tag: '令牌',
      size: 4,
    },
    {
      label: '戳一戳图片摘要令牌',
      value: data.usage.pokeImageSummary?.totalTokens || 0,
      meta: `均值 ${formatNumber(data.usage.pokeImageSummary?.averageTokens || 0)} / 占比 ${((Number(data.usage.pokeImageSummary?.tokenRatio || 0)) * 100).toFixed(2)}%`,
      tag: '令牌',
      size: 4,
    },
    {
      label: '总令牌',
      value: data.usage.totalTokens,
      meta: `费用 ${data.usage.currencySymbol}${Number(data.usage.totalCost || 0).toFixed(6)}`,
      tag: '总计',
      size: 4,
      tone: 'accent',
    },
    buildMemeDeliveryOverviewCard(),
  ];

  document.getElementById('overview-cards').innerHTML = cards
    .map(item => renderOverviewCard(item))
    .join('');

  document.getElementById('usage-box').textContent = [
    `请求数: ${data.usage.requestCount}`,
    `成功数: ${data.usage.successCount}`,
    `失败数: ${data.usage.errorCount}`,
    `总令牌: ${data.usage.totalTokens}`,
    `总费用: ${data.usage.currencySymbol}${Number(data.usage.totalCost || 0).toFixed(6)}`,
    '',
    '按场景统计:',
    ...Object.entries(data.usage.byScene || {}).map(([scene, item]) => `${formatSceneLabel(scene)}: ${item.requests} 次 / ${item.total_tokens} tokens`),
  ].join('\n');

  document.getElementById('image-monitor-usage-box').textContent = [
    '图片监控:',
    `请求数: ${data.usage.imageMonitor?.requestCount || 0}`,
    `成功数: ${data.usage.imageMonitor?.successCount || 0}`,
    `失败数: ${data.usage.imageMonitor?.errorCount || 0}`,
    `总令牌: ${data.usage.imageMonitor?.totalTokens || 0}`,
    `平均令牌: ${data.usage.imageMonitor?.averageTokens || 0}`,
    `令牌占比: ${((Number(data.usage.imageMonitor?.tokenRatio || 0)) * 100).toFixed(2)}%`,
    '',
    '戳一戳图片摘要:',
    `请求数: ${data.usage.pokeImageSummary?.requestCount || 0}`,
    `成功数: ${data.usage.pokeImageSummary?.successCount || 0}`,
    `失败数: ${data.usage.pokeImageSummary?.errorCount || 0}`,
    `总令牌: ${data.usage.pokeImageSummary?.totalTokens || 0}`,
    `平均令牌: ${data.usage.pokeImageSummary?.averageTokens || 0}`,
    `令牌占比: ${((Number(data.usage.pokeImageSummary?.tokenRatio || 0)) * 100).toFixed(2)}%`,
    '',
    '提示:',
    '详细数据可在对应详情页继续查看。',
  ].join('\n');
}
function renderHealth(data) {
  const summary = data.summary || {};
  const statusText = summary.status === 'error' ? '异常' : summary.status === 'warn' ? '告警' : '正常';
  document.getElementById('health-summary').innerHTML = [
    '<div class="dashboard-health-summary">',
    `<div class="dashboard-health-stat tone-${summary.status === 'error' ? 'error' : summary.status === 'warn' ? 'neutral' : 'success'}"><span>状态</span><strong>${statusText}</strong></div>`,
    `<div class="dashboard-health-stat"><span>问题数</span><strong>${summary.issueCount || 0}</strong></div>`,
    `<div class="dashboard-health-stat"><span>异常 / 告警</span><strong>${summary.errorCount || 0} / ${summary.warnCount || 0}</strong></div>`,
    `<div class="dashboard-health-stat"><span>检查时间</span><strong>${formatTime(summary.checkedAt)}</strong></div>`,
    '</div>',
  ].join('');

  document.getElementById('health-issues').innerHTML = (data.issues || []).length > 0
    ? data.issues.map(item => `
      <div class="list-item tone-${item.level === 'error' ? 'error' : item.level === 'warn' ? 'neutral' : 'success'}">
        <h3>${escapeHtml(item.title || '未命名问题')}</h3>
        <div>${escapeHtml(item.detail || '暂无详情')}</div>
      </div>
    `).join('')
    : '<div class="list-item">暂无健康问题</div>';
}
function formatDependencyStatus(status) {
  switch (String(status || '').trim()) {
    case 'missing':
      return '缺失';
    case 'version_mismatch':
      return '版本偏差';
    case 'not_installed':
      return '未安装';
    case 'ok':
    default:
      return '正常';
  }
}

function renderDependencies(report) {
  const summary = report?.summary || {};
  const runtimeMissingCount = Number(summary.runtimeMissingCount || 0);
  const problemCount = Number(summary.problemCount || 0);
  const hasManifest = summary.manifestExists !== false;
  const hasMissingRuntimeDependencies = runtimeMissingCount > 0;
  const tone = !hasManifest || hasMissingRuntimeDependencies
    ? 'error'
    : summary.problemCount > 0
      ? 'neutral'
      : 'success';
  const statusText = !hasManifest
    ? '检查异常'
    : hasMissingRuntimeDependencies
      ? '存在缺失'
      : '未发现缺失';
  const note = !summary.totalCount
    ? '暂无依赖检查数据，打开独立页面后可查看完整清单。'
    : !hasManifest
      ? '未找到 package.json，无法生成完整依赖报告。'
      : hasMissingRuntimeDependencies
        ? `当前缺失 ${runtimeMissingCount} 个运行依赖，请进入依赖检查页处理。`
        : summary.problemCount > 0
          ? `运行依赖未发现缺失，但还有 ${summary.problemCount} 项开发依赖或版本偏差问题。`
          : '当前未发现依赖缺失，完整明细请进入依赖检查页查看。';
  const secondaryText = !summary.totalCount
    ? '等待首次依赖扫描完成'
    : `最近检查：${formatTime(summary.checkedAt)}`;

  document.getElementById('dependency-summary').innerHTML = [
    '<a class="dependency-status-banner-link" href="/dependency-check.html" aria-label="打开依赖检查页">',
    `<div class="dependency-status-banner tone-${tone}">`,
    '<div>',
    `<div class="dependency-status-banner-title">${escapeHtml(statusText)}</div>`,
    `<div class="dependency-status-banner-note">${escapeHtml(note)}</div>`,
    `<div class="dependency-status-banner-meta">${escapeHtml(secondaryText)}</div>`,
    '</div>',
    '<div class="dependency-status-banner-side">',
    '<div class="dependency-status-banner-tags">',
    `<span class="detail-tag tone-${tone}">运行依赖缺失 ${formatNumber(runtimeMissingCount)}</span>`,
    `<span class="detail-tag ${problemCount > 0 ? 'tone-neutral' : 'tone-success'}">其他问题 ${formatNumber(problemCount)}</span>`,
    '</div>',
    '<div class="actions">',
    '<span class="dependency-status-banner-cta">打开依赖检查页</span>',
    '</div>',
    '</div>',
    '</div>',
    '</a>',
  ].join('');
  const list = document.getElementById('dependency-list');
  if (list) {
    list.innerHTML = '';
    list.classList.add('hidden');
  }
}

function renderCollectionEntries(data) {
  const container = document.getElementById('collection-entry-grid');
  if (!container) return;
  const counts = data?.counts || {};
  const usage = data?.usage || {};
  const entries = [
    {
      title: '最近会话',
      description: '会话筛选、翻页、清空消息和重置操作已移到独立页面。',
      countLabel: '会话',
      countValue: counts.sessions || 0,
      href: '/session-center.html',
      actionLabel: '打开最近会话',
    },
    {
      title: '好感度 Top',
      description: '好感记录的筛选、历史查看和重置操作已移到独立页面。',
      countLabel: '用户',
      countValue: counts.affinityUsers || 0,
      href: '/affinity-center.html',
      actionLabel: '打开好感度 Top',
    },
    {
      title: '用户画像',
      description: '画像筛选、快速预览、详情和删除操作已移到独立页面。',
      countLabel: '画像',
      countValue: counts.profiles || 0,
      href: '/profile-center.html',
      actionLabel: '打开用户画像',
    },
    {
      title: 'AI 用量日志',
      description: 'AI 请求日志、场景筛选、趋势图和详情页已移到独立页面，方便单独排查高消耗与失败请求。',
      countLabel: '请求',
      countValue: usage.requestCount || 0,
      href: '/usage-center.html',
      actionLabel: '打开 AI 用量日志中心',
    },
  ];

  container.innerHTML = entries.map(item => `
    <div class="setting-item">
      <h3>${item.title}</h3>
      <div class="setting-help">${item.description}</div>
      <div class="detail-tags">
        <span class="detail-tag tone-success">${item.countLabel} ${formatNumber(item.countValue)}</span>
        <span class="detail-tag">独立页面</span>
      </div>
      <div class="actions">
        <a class="link-btn" href="${item.href}">${item.actionLabel}</a>
      </div>
    </div>
  `).join('');
}

function renderPagination(containerId, page, totalPages, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!totalPages || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('...');
  }
  for (let i = start; i <= end; i += 1) {
    pages.push(i);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  container.innerHTML = [
    `<button data-page-target="${containerId}" data-page="${Math.max(1, page - 1)}">上一页</button>`,
    ...pages.map(item => item === '...'
      ? '<span class="page-ellipsis">...</span>'
      : `<button class="${item === page ? 'active' : ''}" data-page-target="${containerId}" data-page="${item}">${item}</button>`),
    `<button data-page-target="${containerId}" data-page="${Math.min(totalPages, page + 1)}">下一页</button>`,
  ].join('');
  container.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => onPageChange(Number(button.dataset.page)));
  });
}
function renderAffinity(data) {
  const items = data.items || [];
  const rendered = items.length > 0
    ? items.map(item => `
      <div class="list-item affinity-list-item">
        <div class="session-list-head">
          <div class="session-list-title">
            <h3>${escapeHtml(item.display_name || item.user_id || '未知用户')}</h3>
            <div class="setting-help">群 ${escapeHtml(item.group_id || '暂无')} / 用户 ${escapeHtml(item.user_id || '暂无')}</div>
          </div>
          <div class="detail-tags session-list-tags">
            <span class="detail-tag tone-success">${escapeHtml(item.level || '未知')}</span>
            <span class="detail-tag">更新于 ${escapeHtml(formatTime(item.updated_at))}</span>
          </div>
        </div>
        <div class="session-list-stats">
          <div class="session-stat-card">
            <span class="session-stat-label">好感分数</span>
            <strong>${formatNumber(item.score)}</strong>
            <div class="setting-help">当前好感累计值</div>
          </div>
          <div class="session-stat-card">
            <span class="session-stat-label">互动次数</span>
            <strong>${formatNumber(item.interaction_count)}</strong>
            <div class="setting-help">历史互动总次数</div>
          </div>
          <div class="session-stat-card">
            <span class="session-stat-label">最近原因</span>
            <strong>${escapeHtml(item.last_reason ? '已记录' : '暂无')}</strong>
            <div class="setting-help">最近一次分数变化原因</div>
          </div>
        </div>
        <div class="session-preview-block">
          <div class="session-preview-label">最近原因</div>
          <div class="session-preview-text">${escapeHtml(item.last_reason || '暂无')}</div>
        </div>
        <div class="actions">
          <a class="link-btn" href="/affinity-detail.html?groupId=${encodeURIComponent(item.group_id)}&userId=${encodeURIComponent(item.user_id)}">详情</a>
          <button data-action="show-affinity-history" data-group-id="${item.group_id}" data-user-id="${item.user_id}">历史</button>
          <button class="danger" data-action="reset-affinity" data-group-id="${item.group_id}" data-user-id="${item.user_id}">重置好感</button>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无好感记录</div>';
  document.getElementById('affinity-list').innerHTML = rendered;
  renderPagination('affinity-pagination', data.page, data.totalPages, page => {
    state.affinityPage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
}
function renderSessions(data) {
  const items = data.items || [];
  const rendered = items.length > 0
    ? items.map(item => `
      <div class="list-item session-list-item ${item.hasFallback ? 'tone-error' : ''}">
        <div class="session-list-head">
          <div class="session-list-title">
            <h3>${escapeHtml(item.sessionId || '未知会话')}</h3>
            <div class="setting-help">${escapeHtml(item.type || 'unknown')} / ${escapeHtml(item.targetId || '无目标')}</div>
          </div>
          <div class="detail-tags session-list-tags">
            ${item.hasFallback ? '<span class="detail-tag tone-error">触发兜底</span>' : '<span class="detail-tag tone-success">正常</span>'}
            <span class="detail-tag">活跃于 ${escapeHtml(formatTime(item.lastMessageTime))}</span>
          </div>
        </div>
        <div class="session-list-stats">
          <div class="session-stat-card">
            <span class="session-stat-label">消息数</span>
            <strong>${formatNumber(item.messageCount)}</strong>
            <div class="setting-help">用户 ${formatNumber(item.userMessageCount)} / 助手 ${formatNumber(item.assistantMessageCount)}</div>
          </div>
          <div class="session-stat-card">
            <span class="session-stat-label">参与用户</span>
            <strong>${formatNumber(item.participantCount)}</strong>
            <div class="setting-help">画像 ${formatNumber(item.profileCount)}</div>
          </div>
          <div class="session-stat-card">
            <span class="session-stat-label">最近角色</span>
            <strong>${escapeHtml(item.lastMessageRole === 'assistant' ? '助手' : item.lastMessageRole === 'user' ? '用户' : '未知')}</strong>
            <div class="setting-help">最后一条消息的角色</div>
          </div>
        </div>
        <div class="session-preview-block">
          <div class="session-preview-label">最近消息</div>
          <div class="session-preview-text">${escapeHtml(item.lastMessagePreview || '暂无消息')}</div>
        </div>
        <div class="session-preview-block">
          <div class="session-preview-label">参与者</div>
          <div class="session-member-list">
            ${(item.participants || []).length > 0
              ? (item.participants || []).map(participant => `<span class="session-member-chip">${escapeHtml(participant.userName || participant.userId || '未知')}</span>`).join('')
              : '<span class="active-filter-empty">暂无</span>'}
          </div>
        </div>
        ${item.hasFallback ? `<div class="session-fallback-note">兜底原因：${escapeHtml(item.fallbackReason || '未知')}</div>` : ''}
        <div class="actions">
          <a class="link-btn" href="/session-debug.html?sessionId=${encodeURIComponent(item.sessionId)}">会话调试</a>
          <button data-action="reset-session-messages" data-session-id="${item.sessionId}">清空消息</button>
          <button class="danger" data-action="reset-session" data-session-id="${item.sessionId}">重置会话</button>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无会话记录</div>';
  document.getElementById('session-list').innerHTML = rendered;
  renderPagination('session-pagination', data.page, data.totalPages, page => {
    state.sessionPage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
}
function renderProfiles(data) {
  const items = data.items || [];
  const rendered = items.length > 0
    ? items.map(item => `
      <div class="list-item profile-list-item">
        <div class="session-list-head">
          <div class="session-list-title">
            <h3>${escapeHtml(item.userName || item.userId || '未知用户')}</h3>
            <div class="setting-help">${escapeHtml(item.sessionId || '未知会话')} / 用户 ${escapeHtml(item.userId || '暂无')}</div>
          </div>
          <div class="detail-tags session-list-tags">
            <span class="detail-tag tone-success">置信度 ${escapeHtml(String(item.confidence ?? 0))}</span>
            <span class="detail-tag">消息 ${escapeHtml(String(item.sourceMessageCount ?? 0))}</span>
          </div>
        </div>
        <div class="session-preview-block">
          <div class="session-preview-label">摘要</div>
          <div class="session-preview-text">${escapeHtml(item.summary || '暂无')}</div>
        </div>
        <div class="profile-tag-group">
          <div class="profile-tag-block">
            <div class="session-preview-label">特征</div>
            <div class="session-member-list">
              ${(item.traits || []).length > 0
                ? (item.traits || []).map(tag => `<span class="session-member-chip">${escapeHtml(tag)}</span>`).join('')
                : '<span class="active-filter-empty">暂无</span>'}
            </div>
          </div>
          <div class="profile-tag-block">
            <div class="session-preview-label">风格</div>
            <div class="session-member-list">
              ${(item.speakingStyle || []).length > 0
                ? (item.speakingStyle || []).map(tag => `<span class="session-member-chip">${escapeHtml(tag)}</span>`).join('')
                : '<span class="active-filter-empty">暂无</span>'}
            </div>
          </div>
          <div class="profile-tag-block">
            <div class="session-preview-label">话题</div>
            <div class="session-member-list">
              ${(item.notableTopics || []).length > 0
                ? (item.notableTopics || []).map(tag => `<span class="session-member-chip">${escapeHtml(tag)}</span>`).join('')
                : '<span class="active-filter-empty">暂无</span>'}
            </div>
          </div>
        </div>
        <div class="actions">
          <a class="link-btn" href="/session-debug.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">会话调试</a>
          <a class="link-btn" href="/profile-detail.html?sessionId=${encodeURIComponent(item.sessionId)}&userId=${encodeURIComponent(item.userId)}">详情</a>
          <button data-action="show-profile-detail" data-session-id="${item.sessionId}" data-user-id="${item.userId}">快速预览</button>
          <button class="danger" data-action="delete-profile" data-session-id="${item.sessionId}" data-user-id="${item.userId}">删除画像</button>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无画像</div>';
  document.getElementById('profile-list').innerHTML = rendered;
  renderPagination('profile-pagination', data.page, data.totalPages, page => {
    state.profilePage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
}
async function downloadExport(type, params = {}) {
  const query = new URLSearchParams({ type, ...params });
  const response = await fetch(`/api/export?${query.toString()}`, { headers: buildHeaders() });
  if (!response.ok) throw new Error(`导出失败: ${response.status}`);
  const text = await response.text();
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${type}-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadConfigBackup() {
  const response = await fetch('/api/config-backup', { headers: buildHeaders() });
  if (!response.ok) throw new Error(`备份失败: ${response.status}`);
  const text = await response.text();
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `crystelf-config-backup-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function restoreConfigBackup(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  return await postJson('/api/config-restore', parsed);
}

async function previewRestoreConfigBackup(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  const preview = await postJson('/api/config-restore-preview', parsed);
  return { parsed, preview };
}
function summarizeFallbackConfigEnhanced(aiConfig) {
  const hasFallbackReply = !!String(aiConfig?.fallbackReply || '').trim();
  const hasSearchFallback = !!String(aiConfig?.fallbackSearchReply || '').trim();
  const hasTimeoutFallback = !!String(aiConfig?.fallbackTimeoutReply || '').trim();
  const hasGenericFallback = !!String(aiConfig?.fallbackGenericReply || '').trim();

  const parts = [];
  if (hasFallbackReply) parts.push('通用');
  if (hasSearchFallback) parts.push('搜索');
  if (hasTimeoutFallback) parts.push('超时');
  if (hasGenericFallback) parts.push('泛化');

  if (parts.length === 0) return '未配置';
  return `已配置（${parts.join('/')}）`;
}
function renderConfig(data) {
  const brief = {
    config: data.config,
    ai: {
      mode: data.ai?.mode,
      modelType: data.ai?.modelType,
      workingModel: data.ai?.workingModel,
      affinity: data.ai?.affinity?.enabled,
      userProfile: data.ai?.userProfile?.enabled,
      fallback: summarizeFallbackConfig(data.ai),
    },
    poke: {
      mode: data.poke?.mode,
      imageEnabled: data.poke?.imageEnabled,
      fallback: data.poke?.fallbackReply ? '已配置' : '未配置（回退到 ai.fallbackReply）',
    },
    coreConfig: {
      ttsEnabled: data.coreConfig?.tools?.tts?.enabled,
      searchEnabled: data.coreConfig?.tools?.search?.enabled,
      usageControl: data.coreConfig?.usageControl?.enabled,
    },
  };
  document.getElementById('config-box').textContent = JSON.stringify(brief, null, 2);
}

function summarizeFallbackConfig(aiConfig) {
  const hasFallbackReply = !!String(aiConfig?.fallbackReply || '').trim();
  const hasSearchFallback = !!String(aiConfig?.fallbackSearchReply || '').trim();
  const hasTimeoutFallback = !!String(aiConfig?.fallbackTimeoutReply || '').trim();
  const hasGenericFallback = !!String(aiConfig?.fallbackGenericReply || '').trim();

  const parts = [];
  if (hasFallbackReply) parts.push('通用');
  if (hasSearchFallback) parts.push('搜索');
  if (hasTimeoutFallback) parts.push('超时');
  if (hasGenericFallback) parts.push('泛化');

  if (parts.length === 0) return '未配置';
  return `已配置（${parts.join('/')}）`;
}

function formatConfigState(value, enabledText = '已开启', disabledText = '已关闭') {
  return {
    text: value ? enabledText : disabledText,
    tone: value ? 'tone-success' : 'tone-error',
  };
}

function formatConfigFallbackState(value) {
  return {
    text: value,
    tone: value && !String(value).includes('未配置') ? 'tone-success' : 'tone-error',
  };
}

function formatConfigDisplay(value, fallback = '未配置') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function renderConfigRows(rows) {
  return rows.map(row => {
    const state = typeof row.value === 'object' && row.value !== null
      ? row.value
      : { text: formatConfigDisplay(row.value), tone: '' };
    return `
      <div class="config-summary-row">
        <span class="config-summary-label">${escapeHtml(row.label)}</span>
        <span class="config-summary-value ${state.tone || ''}">${escapeHtml(state.text)}</span>
      </div>
    `;
  }).join('');
}

function renderConfigEnhanced(data) {
  const box = document.getElementById('config-box');
  if (!box) return;

  const editableCount = Array.isArray(data.editableFiles) ? data.editableFiles.length : 0;
  const runtimeFiles = Array.isArray(data.configFiles) ? data.configFiles.length : Object.keys(data.configFiles || {}).length;

  const aiRows = [
    { label: '运行模式', value: data.ai?.mode },
    { label: '模型类型', value: data.ai?.modelType },
    { label: '当前模型', value: data.ai?.workingModel },
    { label: '好感系统', value: formatConfigState(data.ai?.affinity?.enabled) },
    { label: '用户画像', value: formatConfigState(data.ai?.userProfile?.enabled) },
    { label: '兜底回复', value: formatConfigFallbackState(summarizeFallbackConfigEnhanced(data.ai)) },
  ];

  const pokeRows = [
    { label: '回复模式', value: data.poke?.mode },
    { label: '图片总结', value: formatConfigState(data.poke?.imageEnabled) },
    {
      label: '兜底回复',
      value: formatConfigFallbackState(
        data.poke?.fallbackReply ? '已配置' : '未配置（回退到 AI 兜底）'
      ),
    },
  ];

  const toolRows = [
    { label: 'TTS 工具', value: formatConfigState(data.coreConfig?.tools?.tts?.enabled) },
    { label: '联网搜索', value: formatConfigState(data.coreConfig?.tools?.search?.enabled) },
    { label: '用量控制', value: formatConfigState(data.coreConfig?.usageControl?.enabled) },
    { label: '每日令牌上限', value: formatConfigDisplay(data.coreConfig?.usageControl?.dailyTokenLimit, '未设置') },
    { label: '可编辑配置文件', value: formatConfigDisplay(editableCount, '0') },
    { label: '已加载配置源', value: formatConfigDisplay(runtimeFiles, '0') },
  ];

  box.innerHTML = `
    <div class="config-summary-grid">
      <section class="config-summary-card">
        <h3>AI 配置</h3>
        <div class="config-summary-list">${renderConfigRows(aiRows)}</div>
      </section>
      <section class="config-summary-card">
        <h3>戳一戳配置</h3>
        <div class="config-summary-list">${renderConfigRows(pokeRows)}</div>
      </section>
      <section class="config-summary-card">
        <h3>工具与额度</h3>
        <div class="config-summary-list">${renderConfigRows(toolRows)}</div>
      </section>
    </div>
    <div class="config-summary-note">
      这里只显示控制台最常用的运行摘要。如果你需要逐项排查配置来源或字段差异，再从对应设置页进入详情即可。
    </div>
  `;
}

summarizeFallbackConfig = summarizeFallbackConfigEnhanced;
renderConfig = renderConfigEnhanced;

function renderLogs(data) {
  const usageBox = document.getElementById('usage-log-box');
  const affinityBox = document.getElementById('affinity-log-box');
  const usageHtml = (data.usage?.items || []).length > 0
    ? data.usage.items.map(item => `
      <div class="list-item log-entry-card ${item.error ? 'tone-error' : ''}">
        <div class="log-entry-head">
          <div>
            <h3>${escapeHtml(formatSceneLabel(item.scene) || '未知场景')}</h3>
            <div class="setting-help">${escapeHtml(formatTime(item.time))}</div>
          </div>
          <div class="detail-tags">
            <span class="detail-tag ${item.error ? 'tone-error' : 'tone-success'}">${item.error ? '失败' : '成功'}</span>
            <span class="detail-tag">${escapeHtml(item.model || '未知模型')}</span>
            <span class="detail-tag">令牌 ${formatNumber(item.total_tokens || 0)}</span>
          </div>
        </div>
        <div class="log-entry-meta">
          <span>会话 ${escapeHtml(item.session_id || '暂无')}</span>
          <span>群 ${escapeHtml(item.group_id || '暂无')}</span>
          <span>用户 ${escapeHtml(item.user_id || '暂无')}</span>
        </div>
        <div class="log-entry-preview">
          <div class="log-entry-label">提示词预览</div>
          <div class="log-entry-text">${escapeHtml(item.display_prompt_preview || item.prompt_preview || '暂无')}</div>
        </div>
        <div class="log-entry-preview">
          <div class="log-entry-label">${item.error ? '错误信息' : '响应预览'}</div>
          <div class="log-entry-text">${escapeHtml(item.display_response_preview || item.response_preview || item.error || '暂无')}</div>
        </div>
        <div class="actions">
          <a class="link-btn" href="/usage-log-detail.html?id=${encodeURIComponent(item.id || '')}">详情</a>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无 AI 用量日志</div>';

  const affinityHtml = (data.affinity?.items || []).length > 0
    ? data.affinity.items.map(item => `
      <div class="list-item log-entry-card ${Number(item.delta || 0) < 0 ? 'tone-error' : ''}">
        <div class="log-entry-head">
          <div>
            <h3>${escapeHtml(item.level || '未知等级')}</h3>
            <div class="setting-help">${escapeHtml(formatTime(item.time))}</div>
          </div>
          <div class="detail-tags">
            <span class="detail-tag ${Number(item.delta || 0) < 0 ? 'tone-error' : 'tone-success'}">${Number(item.delta || 0) >= 0 ? '+' : ''}${escapeHtml(String(item.delta ?? 0))}</span>
            <span class="detail-tag">群 ${escapeHtml(item.group_id || '暂无')}</span>
            <span class="detail-tag">用户 ${escapeHtml(item.user_id || '暂无')}</span>
          </div>
        </div>
        <div class="log-entry-preview">
          <div class="log-entry-label">原因</div>
          <div class="log-entry-text">${escapeHtml(item.reason || '暂无')}${item.guard ? ` / 保护：${escapeHtml(item.guard)}` : ''}</div>
        </div>
        <div class="log-entry-preview">
          <div class="log-entry-label">关联文本</div>
          <div class="log-entry-text">${escapeHtml(item.text_preview || '暂无')}</div>
        </div>
        <div class="actions">
          <a class="link-btn" href="/affinity-log-detail.html?id=${encodeURIComponent(item.id || '')}">详情</a>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无好感日志</div>';
  if (usageBox) {
    usageBox.innerHTML = usageHtml;
    renderPagination('usage-log-pagination', data.usage?.page, data.usage?.totalPages, page => {
      state.usageLogPage = page;
      refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
    });
  }
  if (affinityBox) {
    affinityBox.innerHTML = affinityHtml;
    renderPagination('affinity-log-pagination', data.affinity?.page, data.affinity?.totalPages, page => {
      state.affinityLogPage = page;
      refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
    });
  }
}
function renderImageMonitorLogs(data) {
  const reviewBox = document.getElementById('image-monitor-log-box');
  const memeBox = document.getElementById('image-monitor-meme-box');
  if (!reviewBox || !memeBox) return;

  reviewBox.innerHTML = (data.review?.items || []).length > 0
    ? data.review.items.map(item => `
      <div class="list-item tone-${getImageMonitorRiskTone(item.riskLevel)}">
        <div class="image-monitor-card-head">
          ${renderSafeImageMonitorThumb(item.imageUrl, '图片审核预览')}
          <div class="image-monitor-card-main">
            <h3>${formatTime(item.reviewedAt)} <small>群 ${item.groupId || '暂无'} / 用户 ${item.userId || '暂无'}</small></h3>
            <div class="detail-tags">
              <span class="detail-tag tone-${getImageMonitorRiskTone(item.riskLevel)}">${formatImageMonitorRisk(item.riskLevel)}</span>
              <span class="detail-tag">${formatImageMonitorAction(item.violationAction)}</span>
              <span class="detail-tag">表情包：${item.isMeme ? '是' : '否'}</span>
              <span class="detail-tag">已告警：${item.alerted ? '是' : '否'}</span>
              <span class="detail-tag">已撤回：${item.recalled ? '是' : '否'}</span>
            </div>
            <div>消息 ID：${item.messageId || '暂无'}</div>
            <div>标签：${Array.isArray(item.memeTags) && item.memeTags.length > 0 ? item.memeTags.join(', ') : '暂无'}</div>
            <div>风险分类：${Array.isArray(item.riskCategories) && item.riskCategories.length > 0 ? item.riskCategories.join(', ') : '暂无'}</div>
            <div>摘要：${item.summary || item.error || '暂无'}</div>
            <div class="actions">
              <a class="link-btn" href="/image-monitor-detail.html?type=review&id=${encodeURIComponent(item.id || item.__line || '')}">详情</a>
            </div>
          </div>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无图片审核日志</div>';

  memeBox.innerHTML = (data.meme?.items || []).length > 0
    ? data.meme.items.map(item => `
      <div class="list-item tone-success">
        <div class="image-monitor-card-head">
          ${renderSafeImageMonitorThumb(item.sourceUrl, '表情包预览')}
          <div class="image-monitor-card-main">
            <h3>${item.fileName || '未命名文件'} <small>${formatTime(item.savedAt)}</small></h3>
            <div class="detail-tags">
              <span class="detail-tag tone-success">已保存表情包</span>
              <span class="detail-tag">角色 ${item.character || item.folder || '未知'}</span>
              <span class="detail-tag">群 ${item.groupId || '暂无'}</span>
              <span class="detail-tag">用户 ${item.userId || '暂无'}</span>
            </div>
            <div>标签：${Array.isArray(item.memeTags) && item.memeTags.length > 0 ? item.memeTags.join(', ') : '暂无'}</div>
            <div>摘要：${item.summary || '暂无'}</div>
            <div class="actions">
              <a class="link-btn" href="/image-monitor-detail.html?type=meme&id=${encodeURIComponent(item.id || item.__line || '')}">详情</a>
            </div>
          </div>
        </div>
      </div>
    `).join('')
    : '<div class="list-item">暂无已保存表情包记录</div>';

  renderPagination('image-monitor-log-pagination', data.review?.page, data.review?.totalPages, page => {
    state.imageMonitorLogPage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
  renderPagination('image-monitor-meme-pagination', data.meme?.page, data.meme?.totalPages, page => {
    state.imageMonitorMemePage = page;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
}
function renderProfileDetailPreview(data) {
  const profile = data?.profile;
  if (!profile) return '画像详情暂不可用';
  return [
    `用户：${profile.userName || profile.userId}`,
    `摘要：${profile.summary || '暂无'}`,
    `特征：${(profile.traits || []).join(', ') || '暂无'}`,
    `话题：${(profile.notableTopics || []).join(', ') || '暂无'}`,
  ].join('\n');
}
function renderAffinityHistoryPreview(data) {
  const current = data?.current;
  const first = data?.entries?.[0];
  return [
    current ? `当前分数：${current.score || 0}` : '暂无当前好感分数',
    first ? `最近变化：${first.delta ?? 0} / ${first.reason || '暂无'}` : '暂无好感历史记录',
  ].join('\n');
}
function renderRestorePreviewHtml(preview) {
  if (!preview?.changedCount) {
    return '<div class="restore-preview-empty">该备份未检测到可恢复变更。</div>';
  }
  const groups = (preview.groups || []).slice(0, 12);
  return [
    `<div class="restore-preview-summary">变更项：<strong>${preview.changedCount}</strong> / 可恢复键数：<strong>${preview.restoredKeys?.length || 0}</strong>。可在下方勾选需要恢复的文件。</div>`,
    '<div class="restore-preview-actions"><button data-restore-select="all">全选</button><button data-restore-select="none">全不选</button><button data-restore-select="changed">仅变更项</button></div>',
    ...groups.map(group => `
      <details class="restore-preview-group" open>
        <summary><label class="restore-preview-check"><input type="checkbox" data-restore-file="${escapeHtml(group.file)}" checked /> ${escapeHtml(group.file)} / ${group.count} 项</label></summary>
        <div class="restore-preview-group-body">
          ${(group.items || []).slice(0, 12).map(item => `
            <div class="restore-preview-item ${item.type}">
              <div class="restore-preview-keyword">${item.type === 'added' ? '新增' : item.type === 'deleted' ? '删除' : '修改'} / ${escapeHtml(item.key)}</div>
              <div>当前值：${escapeHtml(JSON.stringify(item.current))}</div>
              <div>恢复后：${escapeHtml(JSON.stringify(item.next))}</div>
            </div>
          `).join('')}
        </div>
      </details>
    `),
  ].join('');
}
function toggleRestoreFileSelection(mode) {
  const inputs = Array.from(document.querySelectorAll('[data-restore-file]'));
  if (mode === 'all') {
    inputs.forEach(input => {
      input.checked = true;
    });
    return;
  }
  if (mode === 'none') {
    inputs.forEach(input => {
      input.checked = false;
    });
    return;
  }
  if (mode === 'changed') {
    inputs.forEach(input => {
      input.checked = true;
    });
  }
}

async function refresh() {
  const requestId = ++state.refreshRequestId;
  const startTime = Date.now();
  renderActiveFilters();
  setRefreshButtonsDisabled(true);
  setRefreshStatus('正在刷新控制台...', 'neutral');
  await new Promise(resolve => setTimeout(resolve, 220));
  if (requestId !== state.refreshRequestId) return;

  const filters = getFilters();
  const hasUsageLogPanel = Boolean(document.getElementById('usage-log-box'));
  const memeStatusPromise = fetchJsonSafe('/api/api-settings/test-meme', { success: false, error: '表情发图链路检测接口暂不可用' });
  try {
    const [overview, health, config, usageLogs, affinityLogs, trend, imageMonitorTrend, pokeImageSummaryTrend] = await Promise.all([
      fetchJsonSafe('/api/overview', { plugin: { name: '魔丸控制台', version: '-' }, runtime: { node: '-', platform: '-' }, counts: { sessions: 0, messages: 0, profiles: 0, affinityUsers: 0 }, usage: { requestCount: 0, successCount: 0, errorCount: 0, totalTokens: 0, totalCost: 0, currencySymbol: '$', byScene: {}, imageMonitor: { requestCount: 0, successCount: 0, errorCount: 0, totalTokens: 0, tokenRatio: 0, averageTokens: 0 }, pokeImageSummary: { requestCount: 0, successCount: 0, errorCount: 0, totalTokens: 0, tokenRatio: 0, averageTokens: 0 } } }),
      fetchJsonSafe('/api/health', { summary: { status: 'error', issueCount: 1, errorCount: 1, warnCount: 0, checkedAt: new Date().toISOString() }, issues: [{ level: 'error', title: '健康检查接口不可用', detail: '读取 /api/health 失败' }] }),
      fetchJsonSafe('/api/config', { runtime: {}, editableFiles: [], configFiles: {} }),
      hasUsageLogPanel
        ? fetchJsonSafe(`/api/logs/usage?query=${encodeURIComponent(filters.usageLogQuery)}&scene=${encodeURIComponent(filters.usageLogScene)}&page=${state.usageLogPage}`, { items: [], page: 1, totalPages: 1 })
        : Promise.resolve({ items: [], page: 1, totalPages: 1 }),
      fetchJsonSafe(`/api/logs/affinity?query=${encodeURIComponent(filters.affinityLogQuery)}&groupId=${encodeURIComponent(filters.affinityLogGroup)}&page=${state.affinityLogPage}`, { items: [], page: 1, totalPages: 1 }),
      fetchJsonSafe('/api/trend/usage', { items: [] }),
      fetchJsonSafe('/api/trend/image-monitor-usage', { items: [] }),
      fetchJsonSafe('/api/trend/poke-image-summary', { items: [] }),
    ]);

    if (requestId !== state.refreshRequestId) return;

    renderOverview(overview);
    renderCollectionEntries(overview);
    renderHealth(health);
    renderDependencies(health.dependencyReport || {});
    renderConfig(config);
    renderLogs({ usage: usageLogs, affinity: affinityLogs });
    renderTrendChart(trend);
    renderImageMonitorUsageTrend(imageMonitorTrend);
    renderPokeImageSummaryTrend(pokeImageSummaryTrend);
    if (!overview.__error) {
      memeStatusPromise.then(result => {
        if (requestId !== state.refreshRequestId) return;
        renderMemeDeliveryOverviewCard(result);
      });
    }

    state.lastRefreshAt = Date.now();
    const errorCount = [overview, health, config, usageLogs, affinityLogs, trend, imageMonitorTrend, pokeImageSummaryTrend].filter(item => item && item.__error).length;
    const elapsedMs = Date.now() - startTime;
    setRefreshStatus(
      errorCount > 0
        ? `最近刷新：${formatTime(state.lastRefreshAt)} / ${elapsedMs} ms / ${errorCount} 个模块使用了回退数据`
        : `最近刷新：${formatTime(state.lastRefreshAt)} / ${elapsedMs} ms / 所有模块加载成功`,
      errorCount > 0 ? 'error' : 'success'
    );
  } catch (error) {
    if (requestId === state.refreshRequestId) {
      setRefreshStatus(`刷新失败：${error.message}`, 'error');
    }
    throw error;
  } finally {
    if (requestId === state.refreshRequestId) {
      setRefreshButtonsDisabled(false);
    }
  }
}

document.addEventListener('click', async event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.dataset.usageScene !== undefined) {
    const input = document.getElementById('usage-log-scene');
    if (input) {
      input.value = target.dataset.usageScene || '';
      state.usageLogPage = 1;
      refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
    }
    return;
  }

  if (target.dataset.restoreSelect) {
    toggleRestoreFileSelection(target.dataset.restoreSelect);
    return;
  }

  if (target.dataset.action === 'reset-affinity') {
    try {
      const confirmed = await openModal('重置好感', `确认重置 ${target.dataset.groupId} / ${target.dataset.userId} 的好感数据？`, { confirmText: '确认重置', cancelText: '取消', showCancel: true });
      if (!confirmed) return;
      await postJson('/api/affinity/reset', { groupId: target.dataset.groupId, userId: target.dataset.userId });
      await refresh();
    } catch (error) {
      await openModal('操作失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'show-affinity-history') {
    try {
      const data = await fetchJson(`/api/affinity-history?groupId=${encodeURIComponent(target.dataset.groupId || '')}&userId=${encodeURIComponent(target.dataset.userId || '')}`);
      await openModal('好感历史', renderAffinityHistoryPreview(data), { showCancel: false });
    } catch (error) {
      await openModal('加载失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'delete-profile') {
    try {
      const confirmed = await openModal('删除画像', `确认删除画像 ${target.dataset.sessionId} / ${target.dataset.userId}？`, { confirmText: '确认删除', cancelText: '取消', showCancel: true });
      if (!confirmed) return;
      await postJson('/api/profiles/delete', { sessionId: target.dataset.sessionId, userId: target.dataset.userId });
      await refresh();
    } catch (error) {
      await openModal('删除失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'show-profile-detail') {
    try {
      const data = await fetchJson(`/api/profile-detail?sessionId=${encodeURIComponent(target.dataset.sessionId || '')}&userId=${encodeURIComponent(target.dataset.userId || '')}`);
      await openModal('画像详情', renderProfileDetailPreview(data), { showCancel: false });
    } catch (error) {
      await openModal('加载失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'reset-session') {
    try {
      const confirmed = await openModal('重置会话', `确认重置会话 ${target.dataset.sessionId}？这会清空消息和相关状态。`, { confirmText: '确认重置', cancelText: '取消', showCancel: true });
      if (!confirmed) return;
      await postJson('/api/sessions/reset', { sessionId: target.dataset.sessionId });
      await refresh();
      await openModal('重置完成', `会话 ${target.dataset.sessionId} 已重置。`, { showCancel: false });
    } catch (error) {
      await openModal('操作失败', error.message, { showCancel: false });
    }
    return;
  }

  if (target.dataset.action === 'reset-session-messages') {
    try {
      const confirmed = await openModal('清空会话消息', `确认只清空会话 ${target.dataset.sessionId} 的消息记录？`, { confirmText: '确认清空', cancelText: '取消', showCancel: true });
      if (!confirmed) return;
      await postJson('/api/sessions/reset', { sessionId: target.dataset.sessionId, mode: 'messages_only' });
      await refresh();
      await openModal('清空完成', `会话 ${target.dataset.sessionId} 的消息已清空。`, { showCancel: false });
    } catch (error) {
      await openModal('操作失败', error.message, { showCancel: false });
    }
  }

});

document.addEventListener('error', event => {
  handleImageMonitorThumbError(event.target);
}, true);

['session-search', 'session-id-filter', 'session-user-filter', 'affinity-search', 'affinity-group-filter', 'profile-search', 'profile-session-filter', 'usage-log-search', 'usage-log-scene', 'affinity-log-search', 'affinity-log-group', 'image-monitor-log-search', 'image-monitor-meme-search'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    if (id.startsWith('session')) state.sessionPage = 1;
    if (id.startsWith('affinity')) state.affinityPage = 1;
    if (id.startsWith('profile')) state.profilePage = 1;
    if (id.startsWith('usage-log')) state.usageLogPage = 1;
    if (id.startsWith('affinity-log')) state.affinityLogPage = 1;
    if (id.startsWith('image-monitor-log')) state.imageMonitorLogPage = 1;
    if (id.startsWith('image-monitor-meme')) state.imageMonitorMemePage = 1;
    refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
  });
});

document.getElementById('refresh-image-monitor-btn')?.addEventListener('click', () => {
});

document.getElementById('clear-filters-btn')?.addEventListener('click', handleClearFilters);
document.getElementById('mobile-clear-filters-btn')?.addEventListener('click', handleClearFilters);
document.getElementById('mobile-refresh-btn')?.addEventListener('click', () => {
  refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
});

document.getElementById('backup-config-btn').addEventListener('click', () => {
  downloadConfigBackup()
    .then(() => openModal('备份完成', '配置备份已导出为 JSON 文件。', { showCancel: false }))
    .catch(error => openModal('备份失败', error.message, { showCancel: false }));
});

document.getElementById('restore-config-btn').addEventListener('click', async () => {
  const confirmed = await openModal('恢复配置', '恢复备份会覆盖当前设置，确认继续？', { confirmText: '确认恢复', cancelText: '取消', showCancel: true });
  if (!confirmed) return;
  document.getElementById('restore-config-input').click();
});

document.getElementById('restore-config-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  previewRestoreConfigBackup(file)
    .then(async ({ parsed, preview }) => {
      const confirmed = await openModal('恢复预览', renderRestorePreviewHtml(preview), { confirmText: '恢复所选项', cancelText: '取消', showCancel: true, html: true });
      if (!confirmed) {
        event.target.value = '';
        return;
      }
      const selectedFiles = Array.from(document.querySelectorAll('[data-restore-file]:checked')).map(input => input.getAttribute('data-restore-file')).filter(Boolean);
      const result = await postJson('/api/config-restore', { ...parsed, selectedFiles });
      await refresh();
      await openModal('恢复完成', `已恢复 ${result.count || 0} 个键：${(result.restoredKeys || []).join(', ')}`, { showCancel: false });
      event.target.value = '';
    })
    .catch(async error => {
      await openModal('恢复失败', error.message, { showCancel: false });
      event.target.value = '';
    });
});

document.getElementById('export-usage-logs-btn')?.addEventListener('click', () => {
  const filters = getFilters();
  downloadExport('usage-logs', { query: filters.usageLogQuery, scene: filters.usageLogScene })
    .catch(error => openModal('导出失败', error.message, { showCancel: false }));
});

document.getElementById('export-affinity-logs-btn').addEventListener('click', () => {
  const filters = getFilters();
  downloadExport('affinity-logs', { query: filters.affinityLogQuery, groupId: filters.affinityLogGroup })
    .catch(error => openModal('导出失败', error.message, { showCancel: false }));
});

document.getElementById('modal-cancel-btn').addEventListener('click', () => closeModal(false));
document.getElementById('modal-confirm-btn').addEventListener('click', () => closeModal(true));
document.getElementById('modal-mask').addEventListener('click', event => {
  if (event.target === event.currentTarget) {
    closeModal(false);
  }
});

document.querySelectorAll('.tab-btn').forEach(button => {
  button.addEventListener('click', () => switchTopTab(button.dataset.tabTarget));
});

switchTopTab(state.activeTopTab);

refresh().catch(error => {
  const pre = document.createElement('pre');
  pre.textContent = `控制台初始化失败: ${error?.message || String(error)}`;
  document.body.replaceChildren(pre);
});
