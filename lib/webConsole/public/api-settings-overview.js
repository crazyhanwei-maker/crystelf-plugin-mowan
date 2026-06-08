function buildPreviewData() {
  const d = apiSettingsState.draft;

  return {
    'AI 主对话': {
      基础接入: {
        baseApi: d['ai.baseApi'] || '(未配置)',
        apiKey: getSecretDisplayText(d['ai.apiKey'], d['ai.apiKeyConfigured']),
        modelType: d['ai.modelType'] || '(未配置)',
        workingModel: d['ai.workingModel'] || '(未配置)',
        multimodalModel: d['ai.multimodalModel'] || '(未配置)',
      },
      超时: {
        timeout: d['ai.timeout'] || 60000,
      },
      备用API: {
        enabled: d['ai.fallbackApi.enabled'],
        baseApi: d['ai.fallbackApi.baseApi'] || '(未配置)',
        apiKey: getSecretDisplayText(d['ai.fallbackApi.apiKey'], d['ai.fallbackApi.apiKeyConfigured']),
        modelType: d['ai.fallbackApi.modelType'] || '(未配置)',
        workingModel: d['ai.fallbackApi.workingModel'] || '(复用备用文本模型或未配置)',
        multimodalModel: d['ai.fallbackApi.multimodalModel'] || '(未配置)',
      },
    },
    图像生成: {
      基础接入: {
        enabled: d['ai.imageConfig.enabled'],
        imageMode: d['ai.imageConfig.imageMode'],
        model: d['ai.imageConfig.model'] || '(未配置)',
        baseApi: d['ai.imageConfig.baseApi'] || '(复用主 API 或未配置)',
        jimengApiUrl: d['ai.imageConfig.jimengApiUrl'] || '(未配置)',
        apiKey: getSecretDisplayText(
          d['ai.imageConfig.apiKey'],
          d['ai.imageConfig.apiKeyConfigured'],
          '(复用主密钥或未配置)'
        ),
        size: d['ai.imageConfig.size'] || '1024x1024',
        quality: d['ai.imageConfig.quality'] || 'high',
        responseFormat: d['ai.imageConfig.responseFormat'] || 'b64_json',
        background: d['ai.imageConfig.background'] || '(不传)',
      },
      超时与保底: {
        timeout: d['ai.imageConfig.timeout'] || 60000,
        fallbackReply: d['ai.imageConfig.fallbackReply'] || '(默认保底)',
        fallbackTimeoutReply: d['ai.imageConfig.fallbackTimeoutReply'] || '(默认超时保底)',
      },
      备用API: {
        enabled: d['ai.imageConfig.fallbackApi.enabled'],
        imageMode: d['ai.imageConfig.fallbackApi.imageMode'] || 'openai',
        model: d['ai.imageConfig.fallbackApi.model'] || '(未配置)',
        baseApi: d['ai.imageConfig.fallbackApi.baseApi'] || '(未配置)',
        jimengApiUrl: d['ai.imageConfig.fallbackApi.jimengApiUrl'] || '(未配置)',
        apiKey: getSecretDisplayText(d['ai.imageConfig.fallbackApi.apiKey'], d['ai.imageConfig.fallbackApi.apiKeyConfigured']),
      },
    },
    图片监控: {
      基础接入: {
        enabled: d['imageMonitor.enabled'],
        apiBase: d['imageMonitor.apiBase'] || '(未配置)',
        apiKey: getSecretDisplayText(d['imageMonitor.apiKey'], d['imageMonitor.apiKeyConfigured']),
        model: d['imageMonitor.model'] || '(未配置)',
      },
      超时与保底: {
        analysisTimeoutMs: d['imageMonitor.analysisTimeoutMs'] || 30000,
        fallbackReply: d['imageMonitor.fallbackReply'] || '(静默)',
        fallbackTimeoutReply: d['imageMonitor.fallbackTimeoutReply'] || '(静默)',
      },
      备用API: {
        enabled: d['imageMonitor.fallbackApi.enabled'],
        apiBase: d['imageMonitor.fallbackApi.apiBase'] || '(未配置)',
        apiKey: getSecretDisplayText(d['imageMonitor.fallbackApi.apiKey'], d['imageMonitor.fallbackApi.apiKeyConfigured']),
        model: d['imageMonitor.fallbackApi.model'] || '(未配置)',
      },
      本地保存与入库: {
        saveReviewImages: d['imageMonitor.saveReviewImages'],
        saveMemeImages: d['imageMonitor.saveMemeImages'],
        saveMemeCharacters: d['imageMonitor.saveMemeCharacters']?.length ? d['imageMonitor.saveMemeCharacters'] : '(不限)',
        saveMemeKeywords: d['imageMonitor.saveMemeKeywords']?.length ? d['imageMonitor.saveMemeKeywords'] : '(不限)',
      },
    },
    搜索工具: {
      基础接入: {
        enabled: d['search.enabled'],
        apiUrl: d['search.apiUrl'] || '(未配置)',
        apiKey: getSecretDisplayText(d['search.apiKey'], d['search.apiKeyConfigured']),
        markdownApiUrl: d['search.markdownApiUrl'] || '(未配置)',
        markdownStatusUrl: d['search.markdownStatusUrl'] || '(未配置)',
      },
      超时: {
        timeoutMs: d['search.timeoutMs'] || 60000,
      },
      备用API: {
        enabled: d['search.fallbackApi.enabled'],
        apiUrl: d['search.fallbackApi.apiUrl'] || '(未配置)',
        apiKey: getSecretDisplayText(d['search.fallbackApi.apiKey'], d['search.fallbackApi.apiKeyConfigured']),
        markdownApiUrl: d['search.fallbackApi.markdownApiUrl'] || '(未配置)',
        markdownStatusUrl: d['search.fallbackApi.markdownStatusUrl'] || '(未配置)',
      },
    },
    表情包: {
      基础接入: {
        apiBase: d['ai.memeConfig.apiBase'] || '(未配置)',
        fallbackEnabled: d['ai.memeConfig.fallbackApi.enabled'],
        fallbackApiBase: d['ai.memeConfig.fallbackApi.apiBase'] || '(未配置)',
      },
      本地目录: {
        localEnabled: d['ai.memeConfig.localEnabled'],
        preferLocal: d['ai.memeConfig.preferLocal'],
        localBaseDir: d['ai.memeConfig.localBaseDir'] || 'data/chat/meme',
      },
    },
  };
}

function renderPreview() {
  const preview = buildPreviewData();
  $('api-settings-preview').textContent = JSON.stringify(preview, null, 2);
}

function buildApiOverview() {
  const d = apiSettingsState.draft;
  const sections = [];

  const mainIssues = [];
  if (!d['ai.baseApi']) mainIssues.push('还没有填写主对话服务地址');
  if (!hasSecretValue(d['ai.apiKey'], d['ai.apiKeyConfigured'])) mainIssues.push('还没有填写主对话密钥');
  if (!d['ai.modelType']) mainIssues.push('还没有填写主对话模型');
  const mainFallbackWarnings = [];
  if (d['ai.fallbackApi.enabled']) {
    if (!d['ai.fallbackApi.baseApi']) mainFallbackWarnings.push('主对话备用 API 已开启但缺少地址');
    if (!hasSecretValue(d['ai.fallbackApi.apiKey'], d['ai.fallbackApi.apiKeyConfigured'])) mainFallbackWarnings.push('主对话备用 API 已开启但缺少密钥');
    if (!d['ai.fallbackApi.modelType']) mainFallbackWarnings.push('主对话备用 API 已开启但缺少文本模型');
  }
  sections.push({
    key: 'ai-main',
    title: 'AI 主对话',
    status: mainIssues.length > 0 ? 'critical' : (mainFallbackWarnings.length > 0 ? 'warning' : 'healthy'),
    summary: mainIssues.length > 0
      ? '聊天服务还没配置完整'
      : (mainFallbackWarnings.length > 0 ? '聊天服务可用，备用 API 还需要补齐' : '聊天服务已可使用'),
    tags: [
      d['ai.modelType'] ? `主对话模型 ${d['ai.modelType']}` : '未配置主对话模型',
      d['ai.workingModel'] ? `后台工作模型 ${d['ai.workingModel']}` : '后台任务复用主对话模型',
      `超时 ${d['ai.timeout'] || 60000}ms`,
      d['ai.multimodalModel'] ? `图片理解模型 ${d['ai.multimodalModel']}` : '未单独配置图片理解模型',
      d['ai.fallbackApi.enabled'] ? '备用 API 已开启' : '备用 API 已关闭',
    ],
    issues: [...mainIssues, ...mainFallbackWarnings],
  });

  if (d['ai.imageConfig.enabled'] === false) {
    sections.push({
      key: 'ai-image',
      title: '图像生成',
      status: 'disabled',
      summary: '图像生成功能已关闭',
      tags: ['已禁用'],
      issues: [],
    });
  } else {
    const imageIssues = [];
    const imageWarnings = [];
    const imageMode = d['ai.imageConfig.imageMode'] || 'openai';
    const hasMainBaseApi = Boolean(d['ai.baseApi']);
    const hasMainApiKey = hasSecretValue(d['ai.apiKey'], d['ai.apiKeyConfigured']);
    const hasImageApiKey = hasSecretValue(d['ai.imageConfig.apiKey'], d['ai.imageConfig.apiKeyConfigured']);

    if (!d['ai.imageConfig.model']) imageIssues.push('缺少图像模型');
    if (imageMode === 'jimeng') {
      if (!d['ai.imageConfig.jimengApiUrl']) imageIssues.push('即梦模式还没有填写服务地址');
    } else {
      if (!d['ai.imageConfig.baseApi'] && !hasMainBaseApi) {
        imageIssues.push('还没有填写生图服务地址，也无法复用主对话地址');
      }
      if (!hasImageApiKey && !hasMainApiKey) {
        imageIssues.push('还没有填写生图密钥，也无法复用主对话密钥');
      }
    }
    if (!d['ai.imageConfig.fallbackReply']) imageWarnings.push('还没有单独设置生图失败提示');
    if (!d['ai.imageConfig.fallbackTimeoutReply']) imageWarnings.push('还没有单独设置生图超时提示');
    if (d['ai.imageConfig.fallbackApi.enabled']) {
      const fallbackMode = d['ai.imageConfig.fallbackApi.imageMode'] || imageMode;
      if (fallbackMode === 'jimeng') {
        if (!d['ai.imageConfig.fallbackApi.jimengApiUrl']) imageWarnings.push('生图备用 API 已开启但缺少备用即梦地址');
      } else {
        if (!d['ai.imageConfig.fallbackApi.baseApi']) imageWarnings.push('生图备用 API 已开启但缺少备用地址');
        if (!d['ai.imageConfig.fallbackApi.model']) imageWarnings.push('生图备用 API 已开启但缺少备用模型');
      }
      if (!hasSecretValue(d['ai.imageConfig.fallbackApi.apiKey'], d['ai.imageConfig.fallbackApi.apiKeyConfigured'])) {
        imageWarnings.push('生图备用 API 已开启但缺少备用密钥');
      }
    }

    sections.push({
      key: 'ai-image',
      title: '图像生成',
      status: imageIssues.length > 0 ? 'critical' : (imageWarnings.length > 0 ? 'warning' : 'healthy'),
      summary: imageIssues.length > 0
        ? '生图服务还没配置完整'
        : (imageWarnings.length > 0 ? '生图服务可用，失败提示还可以补齐' : '生图服务已配置完整'),
      tags: [
        `模式 ${imageMode}`,
        `超时 ${d['ai.imageConfig.timeout'] || 60000}ms`,
        imageMode === 'jimeng'
          ? '即梦接口'
          : (d['ai.imageConfig.baseApi'] ? '单独生图地址' : (hasMainBaseApi ? '复用主对话地址' : '未配置地址')),
        imageMode === 'jimeng'
          ? (hasImageApiKey ? '已配置即梦密钥' : '未配置即梦密钥')
          : (hasImageApiKey ? '单独生图密钥' : (hasMainApiKey ? '复用主对话密钥' : '未配置密钥')),
        d['ai.imageConfig.fallbackApi.enabled'] ? '备用 API 已开启' : '备用 API 已关闭',
        `质量 ${d['ai.imageConfig.quality'] || 'high'}`,
        `格式 ${d['ai.imageConfig.responseFormat'] || 'b64_json'}`,
      ],
      issues: [...imageIssues, ...imageWarnings],
    });
  }

  if (!d['imageMonitor.enabled']) {
    sections.push({
      key: 'image-monitor',
      title: '图片监控',
      status: 'disabled',
      summary: '图片监控未启用',
      tags: ['已禁用'],
      issues: [],
    });
  } else {
    const monitorIssues = [];
    const monitorWarnings = [];
    if (!d['imageMonitor.apiBase']) monitorIssues.push('还没有填写图片识别服务地址');
    if (!hasSecretValue(d['imageMonitor.apiKey'], d['imageMonitor.apiKeyConfigured'])) monitorIssues.push('还没有填写图片识别密钥');
    if (!d['imageMonitor.model']) monitorIssues.push('还没有填写图片识别模型');
    if (!d['imageMonitor.fallbackReply']) monitorWarnings.push('识别失败时不会在群里提示');
    if (!d['imageMonitor.fallbackTimeoutReply']) monitorWarnings.push('识别超时时不会在群里提示');
    if (d['imageMonitor.fallbackApi.enabled']) {
      if (!d['imageMonitor.fallbackApi.apiBase']) monitorWarnings.push('图片监控备用 API 已开启但缺少备用地址');
      if (!hasSecretValue(d['imageMonitor.fallbackApi.apiKey'], d['imageMonitor.fallbackApi.apiKeyConfigured'])) monitorWarnings.push('图片监控备用 API 已开启但缺少备用密钥');
      if (!d['imageMonitor.fallbackApi.model']) monitorWarnings.push('图片监控备用 API 已开启但缺少备用模型');
    }

    sections.push({
      key: 'image-monitor',
      title: '图片监控',
      status: monitorIssues.length > 0 ? 'critical' : (monitorWarnings.length > 0 ? 'warning' : 'healthy'),
      summary: monitorIssues.length > 0
        ? '图片监控还没配置完整'
        : (monitorWarnings.length > 0 ? '图片监控可用，失败提示还可以补齐' : '图片监控已配置完整'),
      tags: [
        `超时 ${d['imageMonitor.analysisTimeoutMs'] || 30000}ms`,
        d['imageMonitor.enabled'] ? '已启用' : '未启用',
        d['imageMonitor.fallbackApi.enabled'] ? '备用 API 已开启' : '备用 API 已关闭',
        d['imageMonitor.saveReviewImages'] ? '保存审核预览图' : '不保存审核预览图',
        d['imageMonitor.saveMemeImages'] ? '表情包入库开启' : '表情包入库关闭',
      ],
      issues: [...monitorIssues, ...monitorWarnings],
    });
  }

  if (!d['search.enabled']) {
    sections.push({
      key: 'search',
      title: '搜索工具',
      status: 'disabled',
      summary: '联网搜索未启用',
      tags: ['已禁用'],
      issues: [],
    });
  } else {
    const searchWarnings = [];
    if (!hasSecretValue(d['search.apiKey'], d['search.apiKeyConfigured'])) searchWarnings.push('还没有填写搜索密钥，部分服务可能无法使用');
    if (!d['search.apiUrl']) searchWarnings.push('还没有填写搜索接口地址');
    if (!d['search.markdownApiUrl']) searchWarnings.push('还没有填写网页读取提交地址');
    if (!d['search.markdownStatusUrl']) searchWarnings.push('还没有填写网页读取状态查询地址');
    if (d['search.fallbackApi.enabled']) {
      if (!d['search.fallbackApi.apiUrl']) searchWarnings.push('搜索备用 API 已开启但缺少备用搜索接口地址');
      if (!d['search.fallbackApi.markdownApiUrl']) searchWarnings.push('搜索备用 API 已开启但缺少备用网页读取提交地址');
      if (!d['search.fallbackApi.markdownStatusUrl']) searchWarnings.push('搜索备用 API 已开启但缺少备用状态查询地址');
    }

    sections.push({
      key: 'search',
      title: '搜索工具',
      status: searchWarnings.length > 0 ? 'warning' : 'healthy',
      summary: searchWarnings.length > 0 ? '搜索已开启，但网页读取配置还不完整' : '搜索工具已配置完整',
      tags: [
        `超时 ${d['search.timeoutMs'] || 60000}ms`,
        d['search.enabled'] ? '已启用' : '未启用',
        d['search.apiUrl'] ? '搜索接口已配置' : '搜索接口未配置',
        d['search.fallbackApi.enabled'] ? '备用 API 已开启' : '备用 API 已关闭',
      ],
      issues: searchWarnings,
    });
  }

  const memeRemoteConfigured = Boolean(d['ai.memeConfig.apiBase']);
  const memeLocalEnabled = d['ai.memeConfig.localEnabled'] !== false;
  const memeLocalConfigured = memeLocalEnabled && Boolean(String(d['ai.memeConfig.localBaseDir'] || '').trim());
  const memeIssues = [];
  if (!memeRemoteConfigured && !memeLocalConfigured) {
    memeIssues.push('远程服务和本地目录至少需要配置一个');
  }
  if (d['ai.memeConfig.fallbackApi.enabled'] && !d['ai.memeConfig.fallbackApi.apiBase']) {
    memeIssues.push('表情包备用 API 已开启但缺少备用地址');
  }
  sections.push({
    key: 'meme',
    title: '表情包',
    status: memeIssues.length > 0 ? 'warning' : 'healthy',
    summary: memeIssues.length > 0 ? '表情包来源还没配置完整' : '表情包远程或本地来源可用',
    tags: [
      memeRemoteConfigured ? '远程服务已配置' : '远程服务未配置',
      d['ai.memeConfig.fallbackApi.enabled'] ? '备用 API 已开启' : '备用 API 已关闭',
      memeLocalEnabled ? `本地目录 ${d['ai.memeConfig.preferLocal'] ? '优先' : '兜底'}` : '本地目录已关闭',
    ],
    issues: memeIssues,
  });

  const counts = {
    healthy: sections.filter(item => item.status === 'healthy').length,
    warning: sections.filter(item => item.status === 'warning').length,
    critical: sections.filter(item => item.status === 'critical').length,
    disabled: sections.filter(item => item.status === 'disabled').length,
  };

  return { sections, counts };
}

function getOverviewStateLabel(status) {
  switch (status) {
    case 'healthy':
      return '健康';
    case 'warning':
      return '待检查';
    case 'critical':
      return '有风险';
    case 'disabled':
      return '已关闭';
    default:
      return '未知';
  }
}

function renderApiOverview() {
  const overview = buildApiOverview();
  $('api-settings-overview-meta').innerHTML = [
    `<span class="api-settings-overview-chip tone-healthy">健康 ${overview.counts.healthy}</span>`,
    `<span class="api-settings-overview-chip tone-warning">待确认 ${overview.counts.warning}</span>`,
    `<span class="api-settings-overview-chip tone-critical">需处理 ${overview.counts.critical}</span>`,
    `<span class="api-settings-overview-chip tone-disabled">关闭 ${overview.counts.disabled}</span>`,
  ].join('');

  $('api-settings-overview-list').innerHTML = overview.sections.map(item => `
    <article class="api-settings-overview-item tone-${item.status}">
      <div class="api-settings-overview-head">
        <div>
          <h4>${escapeHtml(item.title)}</h4>
          <div class="setting-status">${escapeHtml(item.summary)}</div>
        </div>
        <span class="api-settings-overview-state tone-${item.status}">${escapeHtml(getOverviewStateLabel(item.status))}</span>
      </div>
      <div class="api-settings-overview-tags">
        ${(item.tags || []).map(tag => `<span class="api-settings-overview-tag">${escapeHtml(tag)}</span>`).join('')}
      </div>
      ${(item.issues || []).length > 0
        ? `<ul class="api-settings-overview-issues">${item.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>`
        : '<div class="setting-status">当前没有需要特别处理的项目。</div>'}
    </article>
  `).join('');
}

function getConfigSourceDiffTypeLabel(type) {
  switch (String(type || '').trim()) {
    case 'modified':
      return '已改';
    case 'runtimeOnly':
      return '仅运行配置';
    case 'missingInRuntime':
      return '运行配置缺失';
    default:
      return '差异';
  }
}

function renderConfigSourceSummary() {
  const target = $('api-settings-source-summary');
  if (!target) {
    return;
  }

  const source = apiSettingsState.config?.configSource;
  if (!source || !Array.isArray(source.files)) {
    target.innerHTML = '<div class="setting-status">暂无配置来源信息。</div>';
    return;
  }

  const effectiveFields = Array.isArray(source.effectiveFields) ? source.effectiveFields : [];
  const fieldCards = effectiveFields.length > 0
    ? `<div class="api-settings-effective-grid">
        ${effectiveFields.map(field => `
          <article class="api-settings-effective-item ${field.configured ? 'is-configured' : 'is-missing'}">
            <div>
              <strong>${escapeHtml(field.label || field.key || '-')}</strong>
              <span>${escapeHtml(field.key || '-')}</span>
            </div>
            <div class="api-settings-effective-value">${escapeHtml(field.value || '-')}</div>
            <div class="api-settings-effective-meta">
              ${escapeHtml(field.source === 'fallback' ? `回退自 ${field.fallbackKey || '-'}` : field.source === 'default-value' ? '内置默认值' : field.source === 'missing' ? '未读取到有效值' : '运行时生效值')}
            </div>
          </article>
        `).join('')}
      </div>`
    : '<div class="setting-status">暂无字段级配置诊断。</div>';

  const fileCards = source.files.map(file => {
    const diff = file.diff || {};
    const counts = diff.counts || {};
    const changes = Array.isArray(diff.changes) ? diff.changes : [];
    const diffText = diff.total > 0
      ? `与默认模板有 ${diff.total} 处差异`
      : '与默认模板一致';
    const sourceText = file.effectiveSource === 'runtime'
      ? '当前使用运行配置'
      : '当前使用默认或内存配置';
    const changeList = changes.length > 0
      ? `<div class="api-settings-source-diff-list">
          ${changes.slice(0, 8).map(change => `
            <span class="api-settings-source-diff-item" title="${escapeHtml(change.key || '')}">
              ${escapeHtml(getConfigSourceDiffTypeLabel(change.type))} · ${escapeHtml(change.label || change.key || '-')}
              ${change.sensitive ? '<em>敏感字段不显示值</em>' : ''}
            </span>
          `).join('')}
          ${diff.truncated ? '<span class="api-settings-source-diff-item">还有更多差异未展示</span>' : ''}
        </div>`
      : '<div class="setting-status">没有发现需要特别关注的差异。</div>';

    return `
      <article class="api-settings-source-card">
        <div class="api-settings-source-card-head">
          <div>
            <h4>${escapeHtml(file.title || file.key || '-')}</h4>
            <div class="setting-status">${escapeHtml(sourceText)} · ${escapeHtml(diffText)}</div>
          </div>
          <span class="api-settings-overview-state tone-${file.runtimeExists ? 'healthy' : 'warning'}">${file.runtimeExists ? '运行配置' : '默认兜底'}</span>
        </div>
        <div class="api-settings-source-paths">
          <div><strong>运行配置</strong><span>${escapeHtml(file.runtimePath || '-')}</span></div>
          <div><strong>默认模板</strong><span>${escapeHtml(file.defaultPath || '-')}</span></div>
        </div>
        <div class="api-settings-source-counts">
          <span>已修改 ${escapeHtml(counts.modified || 0)}</span>
          <span>仅运行配置 ${escapeHtml(counts.runtimeOnly || 0)}</span>
          <span>运行缺失 ${escapeHtml(counts.missingInRuntime || 0)}</span>
        </div>
        ${changeList}
      </article>
    `;
  }).join('');

  target.innerHTML = `
    <div class="api-settings-source-note">
      <strong>生效规则</strong>
      <span>${escapeHtml(source.note || '运行配置优先于默认模板。')}</span>
    </div>
    <div class="api-settings-source-paths api-settings-source-root">
      <div><strong>运行配置目录</strong><span>${escapeHtml(source.runtimeDir || '-')}</span></div>
      <div><strong>默认模板目录</strong><span>${escapeHtml(source.defaultDir || '-')}</span></div>
    </div>
    <div class="api-settings-source-block">
      <h4>实际读取字段</h4>
      ${fieldCards}
    </div>
    <div class="api-settings-source-block">
      <h4>配置文件差异</h4>
    </div>
    <div class="api-settings-source-grid">${fileCards}</div>
  `;
}
