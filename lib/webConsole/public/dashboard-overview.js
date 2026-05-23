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

function getVersionCheckText(result = null) {
  if (!result) return '版本检查中';
  if (result.status === 'update_available' || result.updateAvailable === true) {
    return `发现新版本 ${escapeHtml(result.remoteCommitShort || '')}`;
  }
  if (result.status === 'up_to_date') {
    return '已是最新';
  }
  if (result.status === 'check_failed' || result.success === false) {
    return '版本检查失败';
  }
  return '版本状态未知';
}

function getVersionCheckClass(result = null) {
  if (!result) return 'tone-neutral';
  if (result.status === 'update_available' || result.updateAvailable === true) return 'tone-warning';
  if (result.status === 'up_to_date') return 'tone-success';
  if (result.status === 'check_failed' || result.success === false) return 'tone-error';
  return 'tone-neutral';
}

function buildVersionCheckTitle(result = null) {
  if (!result) return '正在检查远端 origin 分支是否有新提交';
  const lines = [
    `检查时间：${formatTime(result.checkedAt || Date.now())}`,
    result.branch ? `分支：${result.branch}` : '',
    result.localCommitShort ? `本地：${result.localCommitShort}` : '',
    result.remoteCommitShort ? `远端：${result.remoteCommitShort}` : '',
    result.dirty ? '本地工作区有未提交改动' : '',
    result.error ? `错误：${result.error}` : '',
  ].filter(Boolean);
  return lines.join('\n') || '版本状态暂无详情';
}

function renderVersionCheck(result = null) {
  const target = document.getElementById('version-check-status');
  if (!target) return;
  target.className = `version-check-status ${getVersionCheckClass(result)}`;
  target.textContent = getVersionCheckText(result);
  target.title = buildVersionCheckTitle(result);
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
    {
      label: '今日请求',
      value: formatNumber(data.usage?.requestCount || 0),
      meta: `成功 ${formatNumber(data.usage?.successCount || 0)} / 失败 ${formatNumber(data.usage?.errorCount || 0)}`,
      tone: Number(data.usage?.errorCount || 0) > 0 ? 'danger' : 'info',
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
    pluginMeta.innerHTML = [
      `<span>${pluginName} v${pluginVersion} / 运行环境 Node ${runtimeNode} / ${runtimePlatform}</span>`,
      '<span id="version-check-status" class="version-check-status tone-neutral" title="正在检查远端 origin 分支是否有新提交">版本检查中</span>',
    ].join(' ');
    renderVersionCheck(null);
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
      label: '图片监控用量',
      value: data.usage.imageMonitor?.totalTokens || 0,
      meta: `均值 ${formatNumber(data.usage.imageMonitor?.averageTokens || 0)} / 占比 ${((Number(data.usage.imageMonitor?.tokenRatio || 0)) * 100).toFixed(2)}%`,
      tag: '用量',
      size: 4,
    },
    {
      label: '戳一戳图片摘要用量',
      value: data.usage.pokeImageSummary?.totalTokens || 0,
      meta: `均值 ${formatNumber(data.usage.pokeImageSummary?.averageTokens || 0)} / 占比 ${((Number(data.usage.pokeImageSummary?.tokenRatio || 0)) * 100).toFixed(2)}%`,
      tag: '用量',
      size: 4,
    },
    {
      label: '总用量',
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
    `总用量: ${data.usage.totalTokens}`,
    `总费用: ${data.usage.currencySymbol}${Number(data.usage.totalCost || 0).toFixed(6)}`,
    '',
    '按场景统计:',
    ...Object.entries(data.usage.byScene || {}).map(([scene, item]) => `${formatSceneLabel(scene)}: ${item.requests} 次 / 用量 ${item.total_tokens}`),
  ].join('\n');

  document.getElementById('image-monitor-usage-box').textContent = [
    '图片监控:',
    `请求数: ${data.usage.imageMonitor?.requestCount || 0}`,
    `成功数: ${data.usage.imageMonitor?.successCount || 0}`,
    `失败数: ${data.usage.imageMonitor?.errorCount || 0}`,
    `总用量: ${data.usage.imageMonitor?.totalTokens || 0}`,
    `平均用量: ${data.usage.imageMonitor?.averageTokens || 0}`,
    `用量占比: ${((Number(data.usage.imageMonitor?.tokenRatio || 0)) * 100).toFixed(2)}%`,
    '',
    '戳一戳图片摘要:',
    `请求数: ${data.usage.pokeImageSummary?.requestCount || 0}`,
    `成功数: ${data.usage.pokeImageSummary?.successCount || 0}`,
    `失败数: ${data.usage.pokeImageSummary?.errorCount || 0}`,
    `总用量: ${data.usage.pokeImageSummary?.totalTokens || 0}`,
    `平均用量: ${data.usage.pokeImageSummary?.averageTokens || 0}`,
    `用量占比: ${((Number(data.usage.pokeImageSummary?.tokenRatio || 0)) * 100).toFixed(2)}%`,
    '',
    '提示:',
    '详细数据可在对应详情页继续查看。',
  ].join('\n');
}
