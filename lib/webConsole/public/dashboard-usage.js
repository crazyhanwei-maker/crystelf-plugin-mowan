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
