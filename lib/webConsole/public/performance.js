const performanceState = {
  requestId: 0,
  controller: null,
  trendView: localStorage.getItem('crystelf-perf-trend-view') === '7d' ? '7d' : '24h',
  latestTrend: { ai: [], image: [], daily: [] },
};

const { fetchJson, postJson } = window.CrystelfRequest;
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
    <div class="performance-kpi-item tone-${escapeHtml(tone)}">
      <span class="kpi-label">${escapeHtml(title)}</span>
      <strong class="kpi-value">${escapeHtml(value)}</strong>
      <small class="kpi-detail">${escapeHtml(detail)}</small>
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
  if (value === 'configured') return '已配置，未触发切换';
  if (value === 'disabled') return '备用未启用';
  if (value === 'incomplete') return '备用配置不完整';
  if (value === 'closed') return '正常';
  return '未知';
}

function hasRuntimeCircuitState(item = {}) {
  return !item.configuredOnly && Boolean(String(item.id || '').trim());
}

function mergeCircuitBreakerItems(runtimeItems = [], configuredItems = []) {
  const map = new Map();
  for (const item of Array.isArray(configuredItems) ? configuredItems : []) {
    const scene = String(item.scene || item.title || '').trim() || 'unknown';
    map.set(scene, {
      ...item,
      scene,
      status: item.enabled
        ? (item.fallbackConfigured ? 'configured' : 'incomplete')
        : 'disabled',
      consecutivePrimaryFailures: 0,
      fallbackSuccessCount: 0,
      fallbackFailureCount: 0,
      configuredOnly: true,
    });
  }
  for (const item of Array.isArray(runtimeItems) ? runtimeItems : []) {
    const scene = String(item.scene || '').trim() || 'unknown';
    map.set(scene, {
      ...(map.get(scene) || {}),
      ...item,
      scene,
      configuredOnly: false,
    });
  }
  return Array.from(map.values()).sort((left, right) => {
    const rank = { open: 0, half_open: 1, incomplete: 2, configured: 3, closed: 4, disabled: 5 };
    const leftRank = rank[String(left.status || '').toLowerCase()] ?? 9;
    const rightRank = rank[String(right.status || '').toLowerCase()] ?? 9;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left.title || left.scene || '').localeCompare(String(right.title || right.scene || ''), 'zh-CN');
  });
}

function renderResourceCell(label, value, detail, percent = 0) {
  const percentValue = Math.max(0, Math.min(100, Number(percent || 0)));
  const bar = percentValue > 0
    ? `<div class="resource-bar tone-${percentValue >= 90 ? 'bad' : percentValue >= 70 ? 'warn' : 'ok'}"><span style="width:${percentValue}%"></span></div>`
    : '';
  return `
    <div class="performance-resource-cell">
      <span class="resource-label">${escapeHtml(label)}</span>
      <strong class="resource-value">${escapeHtml(value)}</strong>
      ${bar}
      <small class="resource-detail">${escapeHtml(detail)}</small>
    </div>
  `;
}

function renderRuntime(data = {}) {
  const runtime = data.runtime || {};
  const memory = runtime.memory || {};
  const renderer = data.renderer || {};
  const cleanup = renderer.cleanup || {};
  const cleanupLast = cleanup.lastResult || {};
  const memoryCells = [
    renderResourceCell('物理内存', `${formatBytes(memory.usedMemoryBytes)} / ${formatBytes(memory.totalMemoryBytes)}`, formatPercent(memory.memoryPercent), memory.memoryPercent),
    renderResourceCell('Node Heap', `${formatBytes(memory.heapUsedBytes)} / ${formatBytes(memory.heapTotalBytes)}`, formatPercent(memory.heapPercent), memory.heapPercent),
    renderResourceCell('RSS', formatBytes(memory.rssBytes), '实时采样'),
    renderResourceCell('External', formatBytes(memory.externalBytes), '实时采样'),
  ].join('');
  const statusCells = [
    renderResourceCell('系统负载', (runtime.loadAverage || []).join(' / ') || '0 / 0 / 0', `${runtime.platform || '未知平台'} · ${formatNumber(runtime.cpuCount || 0)} 核`),
    renderResourceCell('只读状态', data.readOnly ? '是' : '否', '页面不会写入配置或日志'),
  ].join('');
  const rendererCells = [
    renderResourceCell('图片渲染池', `${formatNumber(renderer.activePages || 0)} 活跃 / ${formatNumber(renderer.queuedRequests || 0)} 排队`, `${renderer.browserConnected ? '浏览器已连接' : renderer.browserStarting ? '浏览器启动中' : '浏览器空闲'} · 启动 ${formatNumber(renderer.browserLaunchCount || 0)} 次 · 关闭 ${formatNumber(renderer.browserCloseCount || 0)} 次`),
    renderResourceCell('渲染结果', `${formatNumber(renderer.renderSuccessCount || 0)} 成功 / ${formatNumber(renderer.renderFailureCount || 0)} 失败`, `平均 ${formatElapsed(renderer.averageRenderMs || 0)} · 最大 ${formatElapsed(renderer.maxRenderMs || 0)} · 最近 ${formatTime(renderer.lastRenderAt)}`),
    renderResourceCell('临时图片清理', cleanup.running ? '清理中' : `${formatNumber(cleanup.totalRemoved || 0)} 个`, `保留 ${formatNumber(cleanup.retentionDays || 0)} 天 / 最多 ${formatNumber(cleanup.maxFiles || 0)} 张 · 上次扫描 ${formatNumber(cleanupLast.scanned || 0)} 张 · 下次 ${formatTime(cleanup.nextCleanupAt)}`),
    renderer.lastError ? `<div class="performance-resource-cell span-all tone-error">
      <span class="resource-label">最近渲染错误 · ${escapeHtml(formatTime(renderer.lastErrorAt))}</span>
      <small class="resource-detail">${escapeHtml(renderer.lastError)}</small>
    </div>` : '',
  ].join('');
  document.getElementById('performance-runtime-grid').innerHTML = `
    <div class="performance-runtime-group">
      <div class="performance-runtime-group-label">内存采样</div>
      <div class="performance-runtime-cells cols-4">${memoryCells}</div>
    </div>
    <div class="performance-runtime-groups-row">
      <div class="performance-runtime-group">
        <div class="performance-runtime-group-label">运行状态</div>
        <div class="performance-runtime-cells cols-2">${statusCells}</div>
      </div>
      <div class="performance-runtime-group">
        <div class="performance-runtime-group-label">图片渲染</div>
        <div class="performance-runtime-cells cols-3">${rendererCells}</div>
      </div>
    </div>
  `;
}

// 7 天 API 趋势：纯 SVG 堆叠柱状图（成功/失败/备用），不引外部图表库
function niceChartCeil(value) {
  const safe = Math.max(1, Math.ceil(Number(value) || 0));
  if (safe <= 5) return 5;
  const power = 10 ** Math.floor(Math.log10(safe));
  for (const mult of [1, 2, 5, 10]) {
    if (mult * power >= safe) return mult * power;
  }
  return 10 * power;
}

function renderApiTrendChart(days = []) {
  if (!Array.isArray(days) || days.length === 0) {
    return '<div class="setting-help">暂无 7 天 API 趋势数据。</div>';
  }
  const width = 720;
  const height = 190;
  const gutterLeft = 44;
  const gutterRight = 10;
  const top = 20;
  const bottom = 26;
  const plotWidth = width - gutterLeft - gutterRight;
  const plotHeight = height - top - bottom;
  const yMax = niceChartCeil(Math.max(1, ...days.map(item => Number(item.requestCount || 0))));
  const slotWidth = plotWidth / days.length;
  const columnWidth = Math.min(52, Math.max(16, slotWidth * 0.55));
  const gridLines = 5; // niceChartCeil 的档位(1/2/5×10^n)都能被 5 整除，刻度标签保持整数
  const parts = [];
  // 渐变填充 + 备用接管斜纹（与成功/失败是重叠统计，用叠加不用堆叠）
  parts.push(`<defs>
    <linearGradient id="perf-grad-success" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#059669"/></linearGradient>
    <linearGradient id="perf-grad-error" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f87171"/><stop offset="1" stop-color="#dc2626"/></linearGradient>
    <pattern id="perf-fallback-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="perf-chart-hatch-line"/></pattern>
  </defs>`);
  for (let index = 0; index <= gridLines; index++) {
    const y = top + plotHeight - (plotHeight * index) / gridLines;
    parts.push(`<line class="perf-chart-gridline" x1="${gutterLeft}" y1="${y}" x2="${width - gutterRight}" y2="${y}"/>`);
    if (index > 0) {
      parts.push(`<text class="perf-chart-ylabel" x="${gutterLeft - 6}" y="${y + 3.5}">${formatNumber((yMax * index) / gridLines)}</text>`);
    }
  }
  days.forEach((item, index) => {
    const total = Math.max(0, Number(item.requestCount || 0));
    const success = Math.max(0, Math.min(total, Math.round((total * Number(item.successRate || 0)) / 100)));
    const error = Math.max(0, Math.min(total - success, Math.round((total * Number(item.errorRate || 0)) / 100)));
    const fallback = Math.max(0, Math.min(total, Number(item.fallbackCount || 0)));
    const center = gutterLeft + slotWidth * index + slotWidth / 2;
    const x = (center - columnWidth / 2).toFixed(1);
    const baseline = top + plotHeight;
    const label = escapeHtml(item.label || item.date || '-');
    if (total > 0) {
      const columnHeight = Math.max(3, (total / yMax) * plotHeight);
      const columnTop = baseline - columnHeight;
      const successHeight = columnHeight * (success / total);
      // 圆角顶部用 clipPath 实现：只有柱体顶端圆角，分段交界保持平直
      parts.push(`<clipPath id="perf-col-clip-${index}"><rect x="${x}" y="${columnTop.toFixed(1)}" width="${columnWidth.toFixed(1)}" height="${(columnHeight + 8).toFixed(1)}" rx="7"/></clipPath>`);
      parts.push(`<g class="perf-chart-column" clip-path="url(#perf-col-clip-${index})">`);
      if (success > 0) {
        parts.push(`<rect class="perf-chart-seg seg-success" x="${x}" y="${(baseline - successHeight).toFixed(1)}" width="${columnWidth.toFixed(1)}" height="${successHeight.toFixed(1)}" fill="url(#perf-grad-success)"><title>${label} 成功 ${formatNumber(success)} 次</title></rect>`);
      }
      if (error > 0) {
        parts.push(`<rect class="perf-chart-seg seg-error" x="${x}" y="${(baseline - successHeight - columnHeight + successHeight).toFixed(1)}" width="${columnWidth.toFixed(1)}" height="${(columnHeight - successHeight).toFixed(1)}" fill="url(#perf-grad-error)"><title>${label} 失败 ${formatNumber(error)} 次</title></rect>`);
      }
      if (fallback > 0) {
        parts.push(`<rect class="perf-chart-fallback" x="${x}" y="${columnTop.toFixed(1)}" width="${columnWidth.toFixed(1)}" height="${columnHeight.toFixed(1)}" fill="url(#perf-fallback-hatch)"><title>${label} 备用接管 ${formatNumber(fallback)} 次</title></rect>`);
      }
      parts.push('</g>');
      parts.push(`<text class="perf-chart-value" x="${center.toFixed(1)}" y="${(columnTop - 7).toFixed(1)}">${formatNumber(total)}</text>`);
    } else {
      // 零请求日：基线小圆点占位，避免一排空荡
      parts.push(`<rect class="perf-chart-empty" x="${(center - 3).toFixed(1)}" y="${(baseline - 3).toFixed(1)}" width="6" height="3" rx="1.5"/>`);
    }
    parts.push(`<text class="perf-chart-xlabel" x="${center.toFixed(1)}" y="${height - 8}">${label}</text>`);
  });
  return `
    <div class="perf-chart-wrap">
      <svg class="perf-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="7 天 API 请求堆叠柱状图">${parts.join('')}</svg>
      <div class="perf-chart-legend">
        <span><i class="seg-dot dot-success"></i>成功</span>
        <span><i class="seg-dot dot-error"></i>失败</span>
        <span><i class="seg-dot dot-fallback"></i>备用接管</span>
      </div>
    </div>
  `;
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
    trendTarget.innerHTML = renderApiTrendChart(days);
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
    const circuits = mergeCircuitBreakerItems(
      data.apiQuality?.circuitBreaker,
      data.apiQuality?.configuredCircuitTargets,
    );
    const hasResettableCircuit = circuits.some(hasRuntimeCircuitState);
    circuitTarget.innerHTML = circuits.length > 0
      ? `
        <div class="performance-api-circuit-head">
          <div>
            <strong>自动主备切换状态</strong>
            <span>主接口连续失败后会短时间优先使用备用 API，冷却结束后自动探测主接口。手动复位只清除内存熔断状态，不修改配置或日志。</span>
          </div>
          <button type="button" class="performance-circuit-reset-all" data-api-circuit-reset-all ${hasResettableCircuit ? '' : 'disabled'}>全部复位</button>
        </div>
        <div class="performance-api-circuit-list">
          ${circuits.map(item => {
            const canReset = hasRuntimeCircuitState(item);
            return `
            <div class="performance-api-circuit-card tone-${escapeHtml(item.status || 'closed')}">
              <div class="performance-api-circuit-card-head">
                <div>
                  <strong>${escapeHtml(item.title || formatSceneLabel(item.scene || 'chat'))}</strong>
                  <span>${escapeHtml(formatCircuitStatus(item.status))}</span>
                </div>
                ${canReset ? `<button type="button" class="performance-circuit-reset" data-api-circuit-reset="${escapeHtml(item.id)}" data-api-circuit-name="${escapeHtml(item.title || formatSceneLabel(item.scene || 'chat'))}">复位</button>` : ''}
              </div>
              <small>${escapeHtml(formatSceneLabel(item.scene || 'chat'))} · 连续主失败 ${formatNumber(item.consecutivePrimaryFailures || 0)} 次 / 备用成功 ${formatNumber(item.fallbackSuccessCount || 0)} 次 / 备用失败 ${formatNumber(item.fallbackFailureCount || 0)} 次${item.remainingMs > 0 ? ` / 剩余 ${formatDuration(item.remainingMs)}` : ''}</small>
              ${item.configuredOnly ? `<em>自动切换 ${item.autoSwitchEnabled === false ? '关闭' : '开启'} / 阈值 ${formatNumber(item.failureThreshold || 0)} 次 / 冷却 ${formatDuration(item.cooldownMs || 0)} / 主接口${item.primaryConfigured ? '已配置' : '未配置'} / 备用${item.fallbackConfigured ? '已配置' : '未配置'}</em>` : ''}
              ${item.lastError ? `<em>${escapeHtml(item.lastErrorCategoryLabel || '最近错误')}：${escapeHtml(item.lastError)}</em>` : ''}
            </div>
          `; }).join('')}
        </div>
      `
      : '<div class="setting-help">当前没有启用备用 API，也没有主接口熔断记录。</div>';
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

// Catmull-Rom 转三次贝塞尔，生成平滑曲线（image-2 风格的 24 小时活跃度双曲线）
function buildSmoothPath(points = []) {
  if (points.length < 2) return '';
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] || points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

function renderHourlyActivityChart(aiHourly = [], imageHourly = []) {
  const ai = Array.isArray(aiHourly) ? aiHourly : [];
  const image = Array.isArray(imageHourly) ? imageHourly : [];
  const container = document.getElementById('performance-hourly-chart');
  if (!container) return;
  if (ai.length === 0 && image.length === 0) {
    container.innerHTML = '<div class="setting-help">暂无 24 小时趋势数据。</div>';
    setText('performance-trend-summary', '');
    return;
  }
  const hours = ai.length >= image.length ? ai : image;
  const valueAt = (list, index) => Number(list[index]?.requestCount || 0);
  const width = 860;
  const height = 240;
  const gutterLeft = 46;
  const gutterRight = 52;
  const top = 16;
  const bottom = 26;
  const plotWidth = width - gutterLeft - gutterRight;
  const plotHeight = height - top - bottom;
  const baseline = top + plotHeight;
  const aiMax = niceChartCeil(Math.max(1, ...ai.map(item => Number(item.requestCount || 0))));
  const imageMax = niceChartCeil(Math.max(1, ...image.map(item => Number(item.requestCount || 0))));
  const xAt = index => gutterLeft + (hours.length <= 1 ? plotWidth / 2 : (index / (hours.length - 1)) * plotWidth);
  const aiPoints = hours.map((item, index) => ({
    x: xAt(index),
    y: baseline - (valueAt(ai, index) / aiMax) * plotHeight,
    item: ai[index],
  }));
  const imagePoints = hours.map((item, index) => ({
    x: xAt(index),
    y: baseline - (valueAt(image, index) / imageMax) * plotHeight,
    item: image[index],
  }));
  const parts = [];
  // 网格线 + 左轴（AI 请求）+ 右轴（生图请求）
  const gridLines = 5;
  for (let index = 0; index < gridLines; index += 1) {
    const ratio = index / (gridLines - 1);
    const y = baseline - ratio * plotHeight;
    parts.push(`<line class="perf-chart-gridline" x1="${gutterLeft}" y1="${y.toFixed(1)}" x2="${(width - gutterRight)}" y2="${y.toFixed(1)}"/>`);
    parts.push(`<text class="perf-chart-ylabel" x="${gutterLeft - 8}" y="${(y + 3.5).toFixed(1)}">${formatNumber(Math.round(aiMax * ratio))}</text>`);
    parts.push(`<text class="perf-chart-ylabel perf-chart-ylabel-right" x="${(width - gutterRight + 8)}" y="${(y + 3.5).toFixed(1)}">${formatNumber(Math.round(imageMax * ratio))}</text>`);
  }
  // X 轴标签每 3 小时一个
  hours.forEach((item, index) => {
    if (index % 3 !== 0 && index !== hours.length - 1) return;
    parts.push(`<text class="perf-chart-xlabel" x="${xAt(index).toFixed(1)}" y="${height - 8}">${escapeHtml(item.hour || '')}</text>`);
  });
  // AI 面积渐变 + 双曲线
  const aiPath = buildSmoothPath(aiPoints);
  const imagePath = buildSmoothPath(imagePoints);
  parts.push('<defs>');
  parts.push(`<linearGradient id="perf-hourly-grad-ai" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--primary)" stop-opacity="0.28"/><stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/></linearGradient>`);
  parts.push('</defs>');
  if (aiPath) {
    parts.push(`<path class="perf-hourly-area" d="${aiPath} L ${aiPoints[aiPoints.length - 1].x.toFixed(1)} ${baseline} L ${aiPoints[0].x.toFixed(1)} ${baseline} Z"/>`);
    parts.push(`<path class="perf-hourly-line perf-hourly-line-ai" d="${aiPath}"/>`);
  }
  if (imagePath) {
    parts.push(`<path class="perf-hourly-line perf-hourly-line-image" d="${imagePath}"/>`);
  }
  // 悬停热区：透明圆点带 <title> 明细
  aiPoints.forEach(point => {
    if (!point.item) return;
    parts.push(`<circle class="perf-hourly-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="7"><title>${escapeHtml(point.item.hour || '')} · AI 请求 ${formatNumber(point.item.requestCount || 0)} / 错误 ${formatNumber(point.item.errorCount || 0)} / 均耗时 ${formatElapsed(point.item.averageElapsedMs || 0)}</title></circle>`);
  });
  imagePoints.forEach(point => {
    if (!point.item) return;
    parts.push(`<circle class="perf-hourly-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="7"><title>${escapeHtml(point.item.hour || '')} · 生图请求 ${formatNumber(point.item.requestCount || 0)} / 均耗时 ${formatElapsed(point.item.averageElapsedMs || 0)}</title></circle>`);
  });
  container.innerHTML = `<svg class="perf-chart perf-chart-hourly" viewBox="0 0 ${width} ${height}" role="img" aria-label="24 小时活跃度双曲线图">${parts.join('')}</svg>`;
  writeHourlyTrendSummary(ai, image);
}

function writeHourlyTrendSummary(ai = [], image = []) {
  const peakAi = Math.max(0, ...(Array.isArray(ai) ? ai : []).map(item => Number(item.requestCount || 0)));
  const peakImage = Math.max(0, ...(Array.isArray(image) ? image : []).map(item => Number(item.requestCount || 0)));
  const totalErrors = (Array.isArray(ai) ? ai : []).reduce((sum, item) => sum + Number(item.errorCount || 0), 0);
  const peakBox = document.getElementById('performance-trend-summary');
  if (peakBox) {
    peakBox.innerHTML = `<span>AI 峰值 <b>${formatNumber(peakAi)}</b> 请求</span><span>生图峰值 <b>${formatNumber(peakImage)}</b></span><span>错误 <b class="${totalErrors > 0 ? 'tone-warn' : ''}">${formatNumber(totalErrors)}</b></span>`;
  }
}

function writeDailyTrendSummary(daily = []) {
  const list = Array.isArray(daily) ? daily : [];
  const peakBox = document.getElementById('performance-trend-summary');
  if (!peakBox) return;
  const total = list.reduce((sum, item) => sum + Number(item.requestCount || 0), 0);
  const fallback = list.reduce((sum, item) => sum + Number(item.fallbackCount || 0), 0);
  const withTraffic = list.filter(item => Number(item.requestCount || 0) > 0);
  const avgRate = withTraffic.length > 0
    ? withTraffic.reduce((sum, item) => sum + Number(item.successRate || 0), 0) / withTraffic.length
    : 0;
  peakBox.innerHTML = `<span>7 天合计 <b>${formatNumber(total)}</b> 请求</span><span>日均成功率 <b>${formatPercent(avgRate)}</b></span><span>备用接管 <b>${formatNumber(fallback)}</b> 次</span>`;
}

// 请求趋势面板视图切换：近 24 小时（双曲线）/ 近 7 天（堆叠柱状），选择记忆在 localStorage
function applyTrendView(view = '24h') {
  const normalized = view === '7d' ? '7d' : '24h';
  performanceState.trendView = normalized;
  try {
    localStorage.setItem('crystelf-perf-trend-view', normalized);
  } catch {
    // 隐私模式下 localStorage 不可用时忽略
  }
  document.querySelectorAll('[data-trend-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.trendView === normalized);
  });
  const hourly = document.getElementById('performance-hourly-chart');
  const daily = document.getElementById('performance-api-quality-trend');
  if (hourly) hourly.classList.toggle('hidden', normalized !== '24h');
  if (daily) daily.classList.toggle('hidden', normalized !== '7d');
  const help = document.getElementById('performance-trend-help');
  if (help) {
    help.textContent = normalized === '7d'
      ? '近 7 天按天汇总全部 API 请求：成功 / 失败堆叠与备用接管。'
      : '按小时汇总 AI 与生图请求数，双曲线对比；悬停曲线节点可看该小时明细。';
  }
  if (normalized === '7d') {
    writeDailyTrendSummary(performanceState.latestTrend.daily);
  } else {
    writeHourlyTrendSummary(performanceState.latestTrend.ai, performanceState.latestTrend.image);
  }
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
    renderHourlyActivityChart(data.ai?.hourly || [], data.image?.hourly || []);
    performanceState.latestTrend = {
      ai: Array.isArray(data.ai?.hourly) ? data.ai.hourly : [],
      image: Array.isArray(data.image?.hourly) ? data.image.hourly : [],
      daily: Array.isArray(data.apiQuality?.dailyTrend) ? data.apiQuality.dailyTrend : [],
    };
    applyTrendView(performanceState.trendView);
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

async function resetApiCircuitBreaker(payload = {}, button = null) {
  const targetName = String(button?.dataset?.apiCircuitName || '').trim();
  const message = payload.all === true
    ? '确认复位全部 API 主备切换运行状态？这只清除内存中的熔断/冷却记录，不会修改配置和日志。'
    : `确认复位 ${targetName || '该 API'} 的主备切换运行状态？`;
  const confirmed = await webConsoleConfirm(message, { title: '复位主备切换' });
  if (!confirmed) return;

  if (button) {
    button.disabled = true;
    button.textContent = '复位中...';
  }
  try {
    const result = await postJson('/api/performance/api-circuit/reset', payload);
    await refreshPerformance();
    setText('performance-refresh-status', `已复位 ${formatNumber(result.resetCount || 0)} 条主备切换运行状态。`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = payload.all === true ? '全部复位' : '复位';
    }
  }
}

const processViewerState = {
  items: [],
  loaded: false,
};

function getProcessViewerElements() {
  return {
    window: document.getElementById('process-viewer-window'),
    head: document.getElementById('process-viewer-head'),
    meta: document.getElementById('process-viewer-meta'),
    search: document.getElementById('process-viewer-search'),
    tbody: document.getElementById('process-viewer-tbody'),
  };
}

function renderProcessViewerRows() {
  const { tbody, meta } = getProcessViewerElements();
  if (!tbody) return;
  const keyword = String(getProcessViewerElements().search?.value || '').trim().toLowerCase();
  const items = processViewerState.items.filter(item => !keyword
    || item.name.toLowerCase().includes(keyword)
    || String(item.pid).includes(keyword));
  tbody.innerHTML = items.length > 0
    ? items.map(item => `
        <tr data-pid="${escapeHtml(item.pid)}" data-name="${escapeHtml(item.name)}">
          <td>${escapeHtml(item.pid)}</td>
          <td title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</td>
          <td>${formatNumber(item.memoryMB || 0, 1)}</td>
          <td>${item.cpuPercent == null ? '-' : escapeHtml(item.cpuPercent)}</td>
          <td><button type="button" class="process-kill-btn" data-kill-pid="${escapeHtml(item.pid)}" title="结束进程 ${escapeHtml(item.name)}">结束</button></td>
        </tr>
      `).join('')
    : '<tr><td colspan="5">没有匹配的进程</td></tr>';
  if (meta) {
    meta.textContent = processViewerState.loaded
      ? `共 ${formatNumber(items.length)} 个进程${keyword ? `（匹配自 ${formatNumber(processViewerState.items.length)}）` : ''}`
      : '';
  }
}

async function loadProcessViewerProcesses() {
  const { meta, tbody } = getProcessViewerElements();
  if (meta) meta.textContent = '正在读取进程列表...';
  if (tbody) tbody.innerHTML = '<tr><td colspan="5">正在加载...</td></tr>';
  try {
    const data = await fetchJson('/api/performance/processes?limit=400');
    processViewerState.items = Array.isArray(data?.items) ? data.items : [];
    processViewerState.loaded = true;
    renderProcessViewerRows();
  } catch (error) {
    processViewerState.loaded = false;
    processViewerState.items = [];
    if (meta) meta.textContent = `加载失败：${error.message}`;
    if (tbody) tbody.innerHTML = `<tr><td colspan="5">进程列表加载失败：${escapeHtml(error.message)}</td></tr>`;
  }
}

async function killProcessByPid(pid, name) {
  const { meta } = getProcessViewerElements();
  const confirmed = window.confirm(`确定结束进程「${name}」（PID ${pid}）吗？\n该操作立即生效且无法撤销，进程内的未保存数据会丢失。`);
  if (!confirmed) return;
  if (meta) meta.textContent = `正在结束进程 ${name}（PID ${pid}）...`;
  try {
    const result = await postJson('/api/performance/processes/kill', { pid: Number(pid) });
    if (meta) meta.textContent = `已结束进程：${result?.name || name}（PID ${result?.pid || pid}）`;
    await loadProcessViewerProcesses();
  } catch (error) {
    if (meta) meta.textContent = `结束进程失败：${error.message}`;
    window.alert(`结束进程失败：${error.message}`);
  }
}

function bindProcessKillButtons() {
  const { tbody } = getProcessViewerElements();
  tbody?.addEventListener('click', event => {
    const button = event.target.closest('button[data-kill-pid]');
    if (!button) return;
    const pid = button.dataset.killPid;
    const row = button.closest('tr');
    const name = row?.dataset.name || '';
    button.disabled = true;
    killProcessByPid(pid, name).finally(() => {
      button.disabled = false;
    });
  });
}

function openProcessViewer() {
  const { window } = getProcessViewerElements();
  if (!window) return;
  window.classList.remove('hidden');
  if (!processViewerState.loaded) {
    loadProcessViewerProcesses();
  }
}

function bindProcessViewerDrag() {
  const { window, head } = getProcessViewerElements();
  if (!window || !head) return;
  head.addEventListener('mousedown', event => {
    if (event.target.closest('button, input')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = window.getBoundingClientRect();
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    const style = window.style;
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.right = 'auto';
    const move = moveEvent => {
      const nextX = Math.max(0, Math.min(window.innerWidth - rect.width, moveEvent.clientX - offsetX));
      const nextY = Math.max(0, Math.min(window.innerHeight - 40, moveEvent.clientY - offsetY));
      style.left = `${nextX}px`;
      style.top = `${nextY}px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('process-viewer-btn')?.addEventListener('click', openProcessViewer);
  document.getElementById('process-viewer-close-btn')?.addEventListener('click', () => {
    getProcessViewerElements().window?.classList.add('hidden');
  });
  document.getElementById('process-viewer-refresh-btn')?.addEventListener('click', loadProcessViewerProcesses);
  document.getElementById('process-viewer-search')?.addEventListener('input', renderProcessViewerRows);
  bindProcessKillButtons();
  bindProcessViewerDrag();
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    getProcessViewerElements().window?.classList.add('hidden');
  });
  document.getElementById('performance-refresh-btn')?.addEventListener('click', () => {
    refreshPerformance().catch(error => webConsoleAlert(error.message));
  });
  document.querySelectorAll('[data-trend-view]').forEach(btn => {
    btn.addEventListener('click', () => applyTrendView(btn.dataset.trendView));
  });
  document.getElementById('performance-slow-threshold')?.addEventListener('change', () => {
    refreshPerformance().catch(error => webConsoleAlert(error.message));
  });
  document.getElementById('performance-api-circuit-breaker')?.addEventListener('click', event => {
    const resetAllButton = event.target.closest?.('[data-api-circuit-reset-all]');
    if (resetAllButton) {
      resetApiCircuitBreaker({ all: true }, resetAllButton).catch(error => webConsoleAlert(error.message));
      return;
    }
    const resetButton = event.target.closest?.('[data-api-circuit-reset]');
    if (resetButton) {
      resetApiCircuitBreaker({ id: resetButton.dataset.apiCircuitReset || '' }, resetButton).catch(error => webConsoleAlert(error.message));
    }
  });
  refreshPerformance().catch(error => {
    document.body.innerHTML = `<pre>性能监测初始化失败：${escapeHtml(error.message)}</pre>`;
  });
});
