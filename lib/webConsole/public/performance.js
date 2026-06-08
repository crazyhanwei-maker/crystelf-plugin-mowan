const performanceState = {
  requestId: 0,
  controller: null,
};

const { fetchJson } = window.CrystelfRequest;
const ui = window.CrystelfUi || {};

function escapeHtml(value) {
  if (typeof ui.escapeHtml === 'function') {
    return ui.escapeHtml(value);
  }
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(number);
}

function formatPercent(value) {
  return `${formatNumber(value, 2)}%`;
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${formatNumber(size, size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}天`);
  if (hours) parts.push(`${hours}小时`);
  if (minutes) parts.push(`${minutes}分`);
  if (!parts.length) parts.push(`${seconds}秒`);
  return parts.join('');
}

function formatElapsed(ms = 0) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return '0ms';
  if (value >= 1000) return `${formatNumber(value / 1000, value >= 10000 ? 0 : 1)}s`;
  return `${Math.round(value)}ms`;
}

function formatTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatSceneLabel(scene = '') {
  const key = String(scene || '').trim().toLowerCase();
  const sceneMap = {
    chat: '普通对话',
    chat_text: '文本对话',
    chat_multimodal: '多模态对话',
    chat_engine: '对话引擎',
    chat_engine_fallback: '对话引擎兜底',
    chat_engine_final: '对话引擎最终回复',
    complete: '工具调用',
    direct: '直接调用',
    humanize_generate: '拟人化生成',
    poke_follow_reply: '戳一戳接话回复',
    poke_ai_reply: '戳一戳 AI 回复',
    poke_image_summary: '戳一戳图片摘要',
    daily_group_summary: '每日群聊总结',
    image_monitor_review: '图片监控审核',
  };
  return sceneMap[key] || (key === 'unknown' ? '未知场景' : String(scene || '').trim() || '未知场景');
}

function setText(id, text) {
  const target = document.getElementById(id);
  if (target) target.textContent = text;
}

function renderKpiCard(title, value, detail, tone = 'neutral') {
  return `
    <div class="performance-kpi-card tone-${escapeHtml(tone)}">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function renderKpis(data = {}) {
  const ai = data.ai?.today || {};
  const ai24 = data.ai?.last24h || {};
  const image = data.image?.today || {};
  const runtime = data.runtime || {};
  document.getElementById('performance-kpi-grid').innerHTML = [
    renderKpiCard('今日 AI 请求', formatNumber(ai.requestCount || 0), `成功率 ${formatPercent(ai.successRate || 0)} / 错误 ${formatNumber(ai.errorCount || 0)}`, ai.errorCount > 0 ? 'warn' : 'success'),
    renderKpiCard('AI 平均耗时', formatElapsed(ai.averageElapsedMs || 0), `P95 ${formatElapsed(ai.p95ElapsedMs || 0)} / 最大 ${formatElapsed(ai.maxElapsedMs || 0)}`, ai.slowCount > 0 ? 'warn' : 'neutral'),
    renderKpiCard('慢请求', formatNumber(ai.slowCount || 0), `阈值 ${formatElapsed(data.slowThresholdMs || 0)} / 近24小时 ${formatNumber(ai24.slowCount || 0)}`, ai.slowCount > 0 ? 'warn' : 'success'),
    renderKpiCard('今日生图', formatNumber(image.requestCount || 0), `平均 ${formatElapsed(image.averageElapsedMs || 0)} / 失败 ${formatNumber(image.errorCount || 0)}`, image.errorCount > 0 ? 'warn' : 'neutral'),
    renderKpiCard('Token 用量', formatNumber(ai.totalTokens || 0), `输入 ${formatNumber(ai.promptTokens || 0)} / 输出 ${formatNumber(ai.completionTokens || 0)}`, 'neutral'),
    renderKpiCard('运行时长', formatDuration(runtime.uptimeMs || 0), `${escapeHtml(runtime.nodeVersion || '')} / PID ${runtime.pid || '-'}`, 'neutral'),
  ].join('');
}

function renderRuntime(data = {}) {
  const runtime = data.runtime || {};
  const memory = runtime.memory || {};
  const items = [
    ['物理内存', `${formatBytes(memory.usedMemoryBytes)} / ${formatBytes(memory.totalMemoryBytes)}`, memory.memoryPercent],
    ['Node Heap', `${formatBytes(memory.heapUsedBytes)} / ${formatBytes(memory.heapTotalBytes)}`, memory.heapPercent],
    ['RSS', formatBytes(memory.rssBytes), 0],
    ['External', formatBytes(memory.externalBytes), 0],
  ];
  document.getElementById('performance-runtime-grid').innerHTML = [
    ...items.map(([label, value, percent]) => `
      <div class="performance-resource-card">
        <div class="performance-resource-head">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
        ${Number(percent || 0) > 0 ? `
          <div class="performance-progress"><span style="width:${Math.max(0, Math.min(100, Number(percent || 0)))}%"></span></div>
          <small>${formatPercent(percent)}</small>
        ` : '<small>实时采样</small>'}
      </div>
    `),
    `<div class="performance-resource-card">
      <div class="performance-resource-head">
        <span>系统负载</span>
        <strong>${escapeHtml((runtime.loadAverage || []).join(' / ') || '0 / 0 / 0')}</strong>
      </div>
      <small>${escapeHtml(runtime.platform || '未知平台')} · ${formatNumber(runtime.cpuCount || 0)} 核</small>
    </div>`,
    `<div class="performance-resource-card">
      <div class="performance-resource-head">
        <span>只读状态</span>
        <strong>${data.readOnly ? '是' : '否'}</strong>
      </div>
      <small>页面不会写入配置或日志</small>
    </div>`,
  ].join('');
}

function renderTrend(containerId, items = [], metric = 'averageElapsedMs') {
  const list = Array.isArray(items) ? items : [];
  const maxValue = Math.max(1, ...list.map(item => Number(item[metric] || item.requestCount || 0)));
  const html = list.length > 0
    ? list.map(item => {
        const value = Number(item[metric] || item.requestCount || 0);
        const width = Math.max(3, Math.round((value / maxValue) * 100));
        return `
          <div class="performance-trend-row">
            <span>${escapeHtml(item.hour || '-')}</span>
            <div class="performance-trend-track"><i style="width:${width}%"></i></div>
            <strong>${metric === 'averageElapsedMs' ? formatElapsed(value) : formatNumber(value)}</strong>
            <small>请求 ${formatNumber(item.requestCount || 0)} / 错误 ${formatNumber(item.errorCount || 0)}</small>
          </div>
        `;
      }).join('')
    : '<div class="setting-help">暂无趋势数据</div>';
  document.getElementById(containerId).innerHTML = html;
}

function renderTable(containerId, rows = [], keyLabel = '名称', keyFormatter = value => value) {
  const list = Array.isArray(rows) ? rows : [];
  const html = list.length > 0
    ? `<table class="performance-table">
      <thead>
        <tr>
          <th>${escapeHtml(keyLabel)}</th>
          <th>请求</th>
          <th>成功率</th>
          <th>平均耗时</th>
          <th>P95</th>
          <th>慢请求</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(row => `
          <tr>
            <td>${escapeHtml(keyFormatter(row.key || 'unknown'))}</td>
            <td>${formatNumber(row.requestCount || 0)}</td>
            <td>${formatPercent(row.successRate || 0)}</td>
            <td>${formatElapsed(row.averageElapsedMs || 0)}</td>
            <td>${formatElapsed(row.p95ElapsedMs || 0)}</td>
            <td>${formatNumber(row.slowCount || 0)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`
    : '<div class="setting-help">暂无统计数据</div>';
  document.getElementById(containerId).innerHTML = html;
}

function renderSlowList(data = {}) {
  const aiItems = Array.isArray(data.ai?.slowRequests) ? data.ai.slowRequests : [];
  const imageItems = Array.isArray(data.image?.slowRequests) ? data.image.slowRequests.map(item => ({ ...item, source: '生图' })) : [];
  const items = [
    ...aiItems.map(item => ({ ...item, source: 'AI' })),
    ...imageItems,
  ].sort((left, right) => Number(right.elapsedMs || 0) - Number(left.elapsedMs || 0)).slice(0, 30);

  const html = items.length > 0
    ? items.map(item => `
      <div class="performance-slow-card ${item.stage === 'error' ? 'tone-error' : ''}">
        <div class="performance-slow-main">
          <div>
            <h3>${escapeHtml(item.source || 'AI')} · ${escapeHtml(formatSceneLabel(item.scene))}</h3>
            <div class="setting-help">${escapeHtml(formatTime(item.time))} · ${escapeHtml(item.model || '未知模型')}</div>
          </div>
          <div class="performance-slow-badges">
            <span>${escapeHtml(item.stage === 'error' ? '错误' : '慢请求')}</span>
            <strong>${formatElapsed(item.elapsedMs || 0)}</strong>
          </div>
        </div>
        <div class="performance-slow-meta">
          <span>Token ${formatNumber(item.totalTokens || 0)}</span>
          <span>群 ${escapeHtml(item.groupId || '-')}</span>
          <span>用户 ${escapeHtml(item.userId || '-')}</span>
        </div>
        ${item.error ? `<div class="performance-slow-error">${escapeHtml(item.error)}</div>` : ''}
        ${item.promptPreview ? `<div class="performance-slow-preview">${escapeHtml(item.promptPreview)}</div>` : ''}
      </div>
    `).join('')
    : '<div class="setting-help">今日暂无慢请求或错误请求。</div>';
  document.getElementById('performance-slow-list').innerHTML = html;
}

function setLoading() {
  document.getElementById('performance-kpi-grid').innerHTML = renderKpiCard('加载中', '...', '正在读取性能数据', 'neutral');
  ['performance-runtime-grid', 'performance-ai-trend', 'performance-image-trend', 'performance-model-table', 'performance-scene-table', 'performance-slow-list'].forEach(id => {
    const target = document.getElementById(id);
    if (target) target.innerHTML = '<div class="setting-help">加载中...</div>';
  });
}

function getSlowThresholdMs() {
  return Number(document.getElementById('performance-slow-threshold')?.value || 10000) || 10000;
}

async function refreshPerformance() {
  const requestId = ++performanceState.requestId;
  try {
    performanceState.controller?.abort?.();
  } catch {}
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  performanceState.controller = controller;
  const button = document.getElementById('performance-refresh-btn');
  if (button) {
    button.disabled = true;
    button.textContent = '刷新中...';
  }
  setText('performance-refresh-status', '正在刷新性能监测数据...');
  setLoading();
  const startedAt = Date.now();
  try {
    const params = new URLSearchParams({ slowThresholdMs: String(getSlowThresholdMs()) });
    const data = await fetchJson(`/api/performance?${params.toString()}`, controller?.signal ? { signal: controller.signal, cancelOnAbort: true } : {});
    if (requestId !== performanceState.requestId) return null;
    renderKpis(data);
    renderRuntime(data);
    renderTrend('performance-ai-trend', data.ai?.hourly || [], 'averageElapsedMs');
    renderTrend('performance-image-trend', data.image?.hourly || [], 'averageElapsedMs');
    renderTable('performance-model-table', data.ai?.byModel || [], '模型');
    renderTable('performance-scene-table', data.ai?.byScene || [], '场景', formatSceneLabel);
    renderSlowList(data);
    setText('performance-meta', `监测日期 ${data.date || '-'}，生成时间 ${formatTime(data.generatedAt)}`);
    setText('performance-refresh-status', `最近刷新：${formatTime(Date.now())} / 页面请求 ${formatElapsed(Date.now() - startedAt)} / 慢请求阈值 ${formatElapsed(data.slowThresholdMs || 0)}`);
    return data;
  } catch (error) {
    if (requestId !== performanceState.requestId || window.CrystelfRequest?.isCanceled?.(error)) {
      return null;
    }
    setText('performance-meta', '性能监测加载失败');
    setText('performance-refresh-status', `加载失败：${error.message}`);
    ['performance-runtime-grid', 'performance-ai-trend', 'performance-image-trend', 'performance-model-table', 'performance-scene-table', 'performance-slow-list'].forEach(id => {
      const target = document.getElementById(id);
      if (target) target.innerHTML = `<div class="setting-error">${escapeHtml(error.message)}</div>`;
    });
    throw error;
  } finally {
    if (requestId === performanceState.requestId) {
      performanceState.controller = null;
      if (button) {
        button.disabled = false;
        button.textContent = '刷新数据';
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('performance-refresh-btn')?.addEventListener('click', () => {
    refreshPerformance().catch(error => webConsoleAlert(error.message));
  });
  document.getElementById('performance-slow-threshold')?.addEventListener('change', () => {
    refreshPerformance().catch(error => webConsoleAlert(error.message));
  });
  refreshPerformance().catch(error => {
    document.body.innerHTML = `<pre>性能监测初始化失败：${escapeHtml(error.message)}</pre>`;
  });
});
