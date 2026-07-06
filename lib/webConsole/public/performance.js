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
    image_monitor_review_fallback: '图片监控审核备用',
    group_url_safety: 'URL 安全检查',
    webconsole_log_diagnosis: '日志排查',
    tts_synthesis: '语音合成',
    tts_models: '语音模型列表',
    meme_probe: '表情包探测',
    meme_random: '随机表情包',
    meme_characters: '表情包角色列表',
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

function formatApiQualityAlertStatus(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'error') return '异常';
  if (value === 'warn' || value === 'warning') return '告警';
  if (value === 'healthy' || value === 'success' || value === 'ok') return '正常';
  return '等待采样';
}

function formatCircuitStatus(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'open') return '主接口冷却中';
  if (value === 'half_open') return '等待恢复探测';
  if (value === 'closed') return '正常';
  return '未知';
}

function renderRuntime(data = {}) {
  const runtime = data.runtime || {};
  const memory = runtime.memory || {};
  const renderer = data.renderer || {};
  const cleanup = renderer.cleanup || {};
  const cleanupLast = cleanup.lastResult || {};
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
    `<div class="performance-resource-card">
      <div class="performance-resource-head">
        <span>图片渲染池</span>
        <strong>${formatNumber(renderer.activePages || 0)} 活跃 / ${formatNumber(renderer.queuedRequests || 0)} 排队</strong>
      </div>
      <small>${renderer.browserConnected ? '浏览器已连接' : renderer.browserStarting ? '浏览器启动中' : '浏览器空闲'} · 启动 ${formatNumber(renderer.browserLaunchCount || 0)} 次 · 关闭 ${formatNumber(renderer.browserCloseCount || 0)} 次</small>
    </div>`,
    `<div class="performance-resource-card">
      <div class="performance-resource-head">
        <span>渲染结果</span>
        <strong>${formatNumber(renderer.renderSuccessCount || 0)} 成功 / ${formatNumber(renderer.renderFailureCount || 0)} 失败</strong>
      </div>
      <small>平均 ${formatElapsed(renderer.averageRenderMs || 0)} · 最大 ${formatElapsed(renderer.maxRenderMs || 0)} · 最近 ${formatTime(renderer.lastRenderAt)}</small>
    </div>`,
    `<div class="performance-resource-card">
      <div class="performance-resource-head">
        <span>临时图片清理</span>
        <strong>${cleanup.running ? '清理中' : `${formatNumber(cleanup.totalRemoved || 0)} 个`}</strong>
      </div>
      <small>保留 ${formatNumber(cleanup.retentionDays || 0)} 天 / 最多 ${formatNumber(cleanup.maxFiles || 0)} 张 · 上次扫描 ${formatNumber(cleanupLast.scanned || 0)} 张 · 下次 ${formatTime(cleanup.nextCleanupAt)}</small>
    </div>`,
    renderer.lastError ? `<div class="performance-resource-card tone-error">
      <div class="performance-resource-head">
        <span>最近渲染错误</span>
        <strong>${escapeHtml(formatTime(renderer.lastErrorAt))}</strong>
      </div>
      <small>${escapeHtml(renderer.lastError)}</small>
    </div>` : '',
  ].join('');
}

function renderApiQuality(data = {}) {
  const today = data.apiQuality?.today || {};
  const last24h = data.apiQuality?.last24h || {};
  const alertsState = data.apiQuality?.alerts || {};
  const retention = data.apiQuality?.retention || {};
  const total = today.total || {};
  const fallback = today.fallback || {};
  const fallback24 = last24h.fallback || {};
  const alertItems = Array.isArray(alertsState.alerts) ? alertsState.alerts : [];
  const alertStatus = String(alertsState.status || 'neutral').toLowerCase();
  const alertsTarget = document.getElementById('performance-api-quality-alerts');
  if (alertsTarget) {
    alertsTarget.innerHTML = `
      <div class="performance-api-quality-alert tone-${escapeHtml(alertStatus)}">
        <div>
          <strong>${escapeHtml(formatApiQualityAlertStatus(alertStatus))}</strong>
          <span>${escapeHtml(alertsState.summary || '正在等待 API 主备质量采样。')}</span>
        </div>
        <small>近24小时请求 ${formatNumber(last24h.total?.requestCount || 0)} 次，备用接管 ${formatNumber(fallback24.requestCount || 0)} 次。</small>
      </div>
      ${alertItems.length > 0 ? `
        <div class="performance-api-quality-alert-list">
          ${alertItems.map(item => `
            <div class="performance-api-quality-alert-item tone-${escapeHtml(item.level || 'warn')}">
              <strong>${escapeHtml(item.title || 'API 质量提醒')}</strong>
              <span>${escapeHtml(item.detail || '')}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  }

  const summaryItems = [
    ['今日总请求', formatNumber(total.requestCount || 0), `主备合计，成功率 ${formatPercent(total.successRate || 0)}`],
    ['备用接管', formatNumber(fallback.requestCount || 0), `占比 ${formatPercent(today.fallbackShare || 0)} / 近24小时 ${formatNumber(fallback24.requestCount || 0)} 次`],
    ['备用成功率', formatPercent(today.fallbackSuccessRate || 0), `失败 ${formatNumber(fallback.errorCount || 0)} / 慢请求 ${formatNumber(fallback.slowCount || 0)}`],
    ['备用平均耗时', formatElapsed(fallback.averageElapsedMs || 0), `P95 ${formatElapsed(fallback.p95ElapsedMs || 0)} / 最大 ${formatElapsed(fallback.maxElapsedMs || 0)}`],
  ];
  document.getElementById('performance-api-quality-summary').innerHTML = summaryItems.map(([label, value, detail]) => `
    <div class="performance-api-quality-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `).join('');

  const retentionTarget = document.getElementById('performance-api-quality-retention');
  if (retentionTarget) {
    const current = retention.current || {};
    const backupItems = Array.isArray(retention.backups) ? retention.backups : [];
    const backupCount = backupItems.filter(item => item.exists).length;
    retentionTarget.innerHTML = `
      <div>
        <strong>质量日志保留</strong>
        <span>当前 ${current.exists ? formatBytes(current.sizeBytes || 0) : '暂未生成'} / 上限 ${formatBytes(retention.maxBytes || 0)}，使用 ${formatPercent(current.usagePercent || 0)}</span>
      </div>
      <small>最多保留 ${formatNumber(retention.backupCount || 0)} 个轮转备份，已有 ${formatNumber(backupCount)} 个；轮转检查间隔 ${formatDuration(retention.rotateCheckIntervalMs || 0)}。</small>
    `;
  }

  const trendTarget = document.getElementById('performance-api-quality-trend');
  if (trendTarget) {
    const days = Array.isArray(data.apiQuality?.dailyTrend) ? data.apiQuality.dailyTrend : [];
    const maxRequests = Math.max(1, ...days.map(item => Number(item.requestCount || 0)));
    trendTarget.innerHTML = days.length > 0
      ? days.map(item => {
        const requestWidth = Math.max(3, Math.round((Number(item.requestCount || 0) / maxRequests) * 100));
        const fallbackWidth = Math.max(0, Math.min(100, Number(item.fallbackShare || 0)));
        const errorWidth = Math.max(0, Math.min(100, Number(item.errorRate || 0)));
        return `
          <div class="performance-api-trend-row">
            <span>${escapeHtml(item.label || item.date || '-')}</span>
            <div class="performance-api-trend-bars">
              <i class="request" style="width:${requestWidth}%"></i>
              <i class="fallback" style="width:${fallbackWidth}%"></i>
              <i class="error" style="width:${errorWidth}%"></i>
            </div>
            <strong>${formatNumber(item.requestCount || 0)} 次</strong>
            <small>成功 ${formatPercent(item.successRate || 0)} / 备用 ${formatPercent(item.fallbackShare || 0)} / 失败 ${formatPercent(item.errorRate || 0)}</small>
          </div>
        `;
      }).join('')
      : '<div class="setting-help">暂无 7 天 API 趋势数据。</div>';
  }

  const diagnosisTarget = document.getElementById('performance-api-failure-diagnosis');
  if (diagnosisTarget) {
    const diagnosis = data.apiQuality?.failureDiagnosis || {};
    const categories = Array.isArray(diagnosis.categories) ? diagnosis.categories : [];
    diagnosisTarget.innerHTML = categories.length > 0
      ? `
        <div class="performance-api-diagnosis-head">
          <strong>近24小时故障归因</strong>
          <span>失败 ${formatNumber(diagnosis.totalFailureCount || 0)} 次，主要原因：${escapeHtml(diagnosis.topCategory?.label || '未分类')}</span>
        </div>
        <div class="performance-api-diagnosis-list">
          ${categories.map(item => `
            <div class="performance-api-diagnosis-card">
              <div>
                <strong>${escapeHtml(item.label || item.category || '其他错误')}</strong>
                <span>${formatNumber(item.count || 0)} 次 / 主接口 ${formatNumber(item.primaryCount || 0)} / 备用 ${formatNumber(item.fallbackCount || 0)}</span>
              </div>
              <small>${escapeHtml(item.advice || '')}</small>
              ${item.latestError ? `<em>${escapeHtml(item.latestError)}</em>` : ''}
            </div>
          `).join('')}
        </div>
      `
      : '<div class="setting-help">近24小时没有 API 失败记录。</div>';
  }

  const circuitTarget = document.getElementById('performance-api-circuit-breaker');
  if (circuitTarget) {
    const circuits = Array.isArray(data.apiQuality?.circuitBreaker) ? data.apiQuality.circuitBreaker : [];
    circuitTarget.innerHTML = circuits.length > 0
      ? `
        <div class="performance-api-circuit-head">
          <strong>自动主备切换状态</strong>
          <span>主接口连续失败后会短时间优先使用备用 API，冷却结束后自动探测主接口。</span>
        </div>
        <div class="performance-api-circuit-list">
          ${circuits.map(item => `
            <div class="performance-api-circuit-card tone-${escapeHtml(item.status || 'closed')}">
              <div>
                <strong>${escapeHtml(formatSceneLabel(item.scene || 'chat'))}</strong>
                <span>${escapeHtml(formatCircuitStatus(item.status))}</span>
              </div>
              <small>连续主失败 ${formatNumber(item.consecutivePrimaryFailures || 0)} 次 / 备用成功 ${formatNumber(item.fallbackSuccessCount || 0)} 次 / 备用失败 ${formatNumber(item.fallbackFailureCount || 0)} 次${item.remainingMs > 0 ? ` / 剩余 ${formatDuration(item.remainingMs)}` : ''}</small>
              ${item.lastError ? `<em>${escapeHtml(item.lastErrorCategoryLabel || '最近错误')}：${escapeHtml(item.lastError)}</em>` : ''}
            </div>
          `).join('')}
        </div>
      `
      : '<div class="setting-help">当前没有主接口熔断记录。</div>';
  }

  const rows = Array.isArray(today.byTypeRole) ? today.byTypeRole : [];
  document.getElementById('performance-api-quality-table').innerHTML = rows.length > 0
    ? `<table class="performance-table">
      <thead>
        <tr>
          <th>API 类型</th>
          <th>线路</th>
          <th>请求</th>
          <th>成功率</th>
          <th>平均耗时</th>
          <th>P95</th>
          <th>错误</th>
          <th>慢请求</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td>${escapeHtml(row.typeLabel || row.type || '未知 API')}</td>
            <td><span class="performance-api-role role-${escapeHtml(row.role || 'unknown')}">${escapeHtml(row.roleLabel || row.role || '未知')}</span></td>
            <td>${formatNumber(row.requestCount || 0)}</td>
            <td>${formatPercent(row.successRate || 0)}</td>
            <td>${formatElapsed(row.averageElapsedMs || 0)}</td>
            <td>${formatElapsed(row.p95ElapsedMs || 0)}</td>
            <td>${formatNumber(row.errorCount || 0)}</td>
            <td>${formatNumber(row.slowCount || 0)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`
    : '<div class="setting-help">暂无 API 主备统计数据。</div>';

  const events = Array.isArray(today.recentFallbackEvents) ? today.recentFallbackEvents : [];
  document.getElementById('performance-api-fallback-events').innerHTML = events.length > 0
    ? events.map(item => `
      <div class="performance-fallback-event ${item.stage === 'error' ? 'tone-error' : ''}">
        <div>
          <strong>${escapeHtml(item.typeLabel || item.type || '备用 API')}</strong>
          <span>${escapeHtml(formatSceneLabel(item.scene || 'unknown'))} · ${escapeHtml(item.model || '未知模型')}</span>
        </div>
        <small>${escapeHtml(formatTime(item.time))} · ${escapeHtml(item.stage === 'error' ? '失败' : '成功')} · ${formatElapsed(item.elapsedMs || 0)}${item.errorCategoryLabel ? ` · ${escapeHtml(item.errorCategoryLabel)}` : ''}</small>
        ${item.error ? `<em>${escapeHtml(item.error)}</em>` : ''}
      </div>
    `).join('')
    : '<div class="setting-help">今日还没有触发备用 API。</div>';
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

function renderFailureReasonTable(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const html = list.length > 0
    ? `<table class="performance-table performance-failure-table">
      <thead>
        <tr>
          <th>场景</th>
          <th>失败原因</th>
          <th>次数</th>
          <th>主要模型</th>
          <th>最近时间</th>
          <th>最近错误</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(row => `
          <tr>
            <td>${escapeHtml(formatSceneLabel(row.scene || 'unknown'))}</td>
            <td>${escapeHtml(row.label || row.category || '其他错误')}</td>
            <td>${formatNumber(row.count || 0)}</td>
            <td>${escapeHtml((row.topModels || []).map(item => `${item.model}(${item.count})`).join('、') || '-')}</td>
            <td>${escapeHtml(formatTime(row.latestAt))}</td>
            <td>${escapeHtml(row.latestError || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`
    : '<div class="setting-help">今日暂无 AI 失败记录。</div>';
  document.getElementById('performance-failure-table').innerHTML = html;
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
          ${item.errorCategoryLabel ? `<span>原因 ${escapeHtml(item.errorCategoryLabel)}</span>` : ''}
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
  ['performance-runtime-grid', 'performance-api-quality-alerts', 'performance-api-quality-summary', 'performance-api-quality-retention', 'performance-api-quality-trend', 'performance-api-failure-diagnosis', 'performance-api-circuit-breaker', 'performance-api-quality-table', 'performance-api-fallback-events', 'performance-ai-trend', 'performance-image-trend', 'performance-model-table', 'performance-scene-table', 'performance-failure-table', 'performance-slow-list'].forEach(id => {
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
    renderApiQuality(data);
    renderTrend('performance-ai-trend', data.ai?.hourly || [], 'averageElapsedMs');
    renderTrend('performance-image-trend', data.image?.hourly || [], 'averageElapsedMs');
    renderTable('performance-model-table', data.ai?.byModel || [], '模型');
    renderTable('performance-scene-table', data.ai?.byScene || [], '场景', formatSceneLabel);
    renderFailureReasonTable(data.ai?.failureReasonsByScene || []);
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
    ['performance-runtime-grid', 'performance-api-quality-alerts', 'performance-api-quality-summary', 'performance-api-quality-retention', 'performance-api-quality-trend', 'performance-api-failure-diagnosis', 'performance-api-circuit-breaker', 'performance-api-quality-table', 'performance-api-fallback-events', 'performance-ai-trend', 'performance-image-trend', 'performance-model-table', 'performance-scene-table', 'performance-failure-table', 'performance-slow-list'].forEach(id => {
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
