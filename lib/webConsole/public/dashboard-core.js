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
  refreshController: null,
  lastRefreshAt: 0,
};

let modalResolver = null;
const { fetchJson, fetchJsonSafe, postJson } = window.CrystelfRequest;
const consoleUi = window.CrystelfUi || {};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function formatTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatHealthStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'error') return '异常';
  if (value === 'warn' || value === 'warning') return '告警';
  if (value === 'healthy' || value === 'success' || value === 'ok') return '正常';
  return '未知';
}

function getHealthIssueLevelLabel(level) {
  const value = String(level || '').trim().toLowerCase();
  if (value === 'error') return '异常';
  if (value === 'warn' || value === 'warning') return '告警';
  if (value === 'info') return '提示';
  if (value === 'success' || value === 'healthy' || value === 'ok') return '正常';
  return '未知';
}

function translateHealthIssueText(text) {
  const value = String(text || '').trim();
  const exactMap = {
    'AI config is incomplete': 'AI 对话还没有配置完整',
    'Check baseApi, model name, and apiKey.': '请补全主对话接口地址、模型名称和 API Key。',
    'Search tool missing apiUrl': '搜索功能还没有填写接口地址',
    'Search is enabled but apiUrl/baseUrl is empty.': '搜索功能已经开启，但还没有填写可用的接口地址。',
    'TTS missing apiUrl': '语音合成还没有填写接口地址',
    'TTS is enabled but apiUrl/baseUrl is empty.': '语音合成已经开启，但还没有填写可用的接口地址。',
    'High AI error rate': '最近 AI 请求失败比较多',
    'AI has recent failures': '最近有 AI 请求失败',
    'Usage log not found': '还没有生成用量日志',
    'No usage log file was found yet.': '控制台暂时没有读到用量日志，产生请求后会自动生成。',
    'Usage log is stale': '用量日志一段时间没有更新',
    'Usage log has not been updated for more than 30 minutes.': '用量日志已经超过 30 分钟没有新记录，可以确认机器人是否还在正常调用 AI。',
    'Affinity log is stale': '好感度日志一段时间没有更新',
    'Affinity log has not been updated for more than 24 hours.': '好感度日志已经超过 24 小时没有新记录，可以确认相关功能是否仍在使用。',
    'package.json is missing': '没有找到依赖清单',
    'Dependency inspection and install features are unavailable.': '缺少依赖清单，暂时不能检查或一键修复依赖。',
    'Runtime dependencies are missing': '有运行依赖没有安装',
    'Runtime dependency versions mismatch lockfile': '有运行依赖版本和锁文件不一致',
    'Dev dependencies are missing': '有开发依赖没有安装',
    'Chat history is large': '聊天记录占用较多',
    'Too many sessions': '会话数量比较多',
    'User profiles are missing': '还没有生成用户画像数据',
    'Messages exist but no profile data was found.': '已经有聊天消息，但还没有生成对应的用户画像数据。',
    'Public console has no login token': '控制台还没有设置登录口令',
    'Public console is writable': '外部设备可以修改控制台配置',
  };
  if (exactMap[value]) return exactMap[value];

  let match = value.match(/^Recent requests:\s*(\d+),\s*errors:\s*(\d+)\.$/i);
  if (match) return `最近共请求 ${match[1]} 次，其中 ${match[2]} 次失败。`;
  match = value.match(/^Recent failed requests:\s*(\d+)\.$/i);
  if (match) return `最近有 ${match[1]} 次请求失败。`;
  match = value.match(/^Missing runtime dependencies:\s*(\d+)(?:\s*\(([^)]+)\))?\.$/i);
  if (match) return `有 ${match[1]} 个运行依赖没有安装${match[2] ? `（${match[2].split(',').map(item => item.trim()).filter(Boolean).join('、')}）` : ''}。`;
  match = value.match(/^Mismatched runtime dependencies:\s*(\d+)(?:\s*\(([^)]+)\))?\.$/i);
  if (match) return `有 ${match[1]} 个运行依赖版本需要确认${match[2] ? `（${match[2].split(',').map(item => item.trim()).filter(Boolean).join('、')}）` : ''}。`;
  match = value.match(/^Missing dev dependencies:\s*(\d+)\.$/i);
  if (match) return `有 ${match[1]} 个开发依赖没有安装。`;
  match = value.match(/^Message count:\s*(\d+)\.$/i);
  if (match) return `当前已经保存 ${match[1]} 条消息记录。`;
  match = value.match(/^Session count:\s*(\d+)\.$/i);
  if (match) return `当前已经保存 ${match[1]} 个会话。`;
  match = value.match(/^Web console host\s+(.+?)\s+is publicly reachable without a configured login token\.$/i);
  if (match) return `控制台监听地址 ${match[1]} 可能被外部设备访问，但还没有设置登录口令。`;
  match = value.match(/^Web console host\s+(.+?)\s+allows write operations\. Consider enabling read-only mode for internet exposure\.$/i);
  if (match) return `控制台监听地址 ${match[1]} 允许保存配置；如果需要开放给外部设备，建议开启只读模式。`;
  return value;
}

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: Number.isInteger(number) ? 0 : 2,
  }).format(number);
}
function formatSceneLabel(scene) {
  const key = String(scene || '').trim().toLowerCase();
  const sceneMap = {
    chat: '对话',
    chat_text: '文本对话',
    chat_multimodal: '多模态对话',
    chat_engine: '对话引擎',
    chat_engine_fallback: '对话引擎兜底',
    chat_engine_final: '对话引擎最终回复',
    humanize_generate: '拟人化生成',
    poke_follow_reply: '戳一戳接话回复',
    poke_ai_reply: '戳一戳 AI 回复',
    poke_image_summary: '戳一戳图片摘要',
    image_monitor_review: '图片监控审核',
  };
  return sceneMap[key] || (key === 'unknown' ? '未知场景' : String(scene || '').trim() || '未知场景');
}

function isImageMonitorReviewUsage(item = {}) {
  return String(item.scene || '').trim().toLowerCase() === 'image_monitor_review';
}

function renderUsagePromptPreview(item = {}) {
  if (isImageMonitorReviewUsage(item)) {
    return '';
  }
  return `
        <div class="log-entry-preview">
          <div class="log-entry-label">提示词预览</div>
          <div class="log-entry-text">${escapeHtml(item.display_prompt_preview || item.prompt_preview || '暂无')}</div>
        </div>`;
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

function normalizeRefreshTone(tone = 'neutral') {
  const value = String(tone || '').trim();
  return ['success', 'error', 'neutral'].includes(value) ? value : 'neutral';
}

function setRefreshStatus(message, tone = 'neutral') {
  const box = document.getElementById('refresh-status');
  if (!box) return;
  box.textContent = message;
  box.className = `setting-help refresh-status tone-${normalizeRefreshTone(tone)}`;
}

function createDebouncedTask(fn, delay = 260) {
  if (typeof consoleUi.debounce === 'function') {
    return consoleUi.debounce(fn, delay);
  }
  let timer = null;
  const task = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
  task.cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  return task;
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
  scheduleRefresh.cancel?.();
  return refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
}
const scheduleRefresh = createDebouncedTask(() => {
  refresh().catch(error => openModal('刷新失败', error.message, { showCancel: false }));
}, 260);
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
    modalResolver = resolve;
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
