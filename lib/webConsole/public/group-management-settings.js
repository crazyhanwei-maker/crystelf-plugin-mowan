function renderSafetyPanel() {
  const box = $('group-management-safety');
  if (!box) return;
  const safety = getSafetyConfig();
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  const active = safety.enabled !== false;
  const allowedDangerCount = [
    safety.allowAutoRecall === true,
    safety.allowAutoMute === true,
    safety.allowAutoKick === true,
  ].filter(Boolean).length;
  const saveButton = $('group-management-safety-save-btn');
  if (saveButton) {
    saveButton.disabled = disabled;
  }
  box.innerHTML = `
    <div class="group-management-safety-status">
      <div class="detail-tags">
        <span class="detail-tag ${active ? 'tone-success' : 'tone-error'}">${active ? '保护开启' : '保护关闭'}</span>
        <span class="detail-tag ${safety.allowAutoRecall ? 'tone-warning' : ''}">撤回 ${safety.allowAutoRecall ? '已放行' : '拦截'}</span>
        <span class="detail-tag ${safety.allowAutoMute ? 'tone-warning' : ''}">禁言 ${safety.allowAutoMute ? '已放行' : '拦截'}</span>
        <span class="detail-tag ${safety.allowAutoKick ? 'tone-error' : ''}">踢人 ${safety.allowAutoKick ? '已放行' : '拦截'}</span>
        <span class="detail-tag">禁言上限 ${escapeHtml(formatNumber(safety.maxAutoMuteSeconds || 600))} 秒</span>
      </div>
      <div class="setting-help">${active
        ? `当前已允许 ${formatNumber(allowedDangerCount)} 类高风险自动动作；未允许的动作会被拦截并改为提醒。`
        : '危险动作保护关闭后，自动撤回、禁言、踢人不会再被拦截。'}</div>
    </div>
    <div class="group-management-safety-grid">
      ${renderFeatureSwitch('gm-safety-enabled', '开启危险动作保护', active, '开启后，未放行的自动撤回、禁言、踢人会被拦截或降级。', disabled)}
      ${renderFeatureSwitch('gm-safety-allow-recall', '允许自动撤回', safety.allowAutoRecall === true, '群消息风控命中后可自动撤回消息。', disabled)}
      ${renderFeatureSwitch('gm-safety-allow-mute', '允许自动禁言', safety.allowAutoMute === true, '群消息风控命中后可自动禁言成员。', disabled)}
      ${renderFeatureSwitch('gm-safety-allow-kick', '允许自动踢人', safety.allowAutoKick === true, '风险最高，建议只在确认规则非常稳定后开启。', disabled)}
      ${renderFeatureSwitch('gm-safety-require-confirm', '危险动作保存二次确认', safety.requireConsoleConfirm !== false, '控制台保存撤回、禁言、踢人前必须再次确认。', disabled)}
      <label class="setting-item">
        <span class="kv-label">自动禁言最长秒数</span>
        <input id="gm-safety-max-mute-seconds" type="number" min="60" max="2592000" step="60" value="${escapeHtml(safety.maxAutoMuteSeconds || 600)}" ${disabledAttr} />
        <div class="setting-help">自动禁言不会超过这个时长。</div>
      </label>
    </div>
  `;
}

function readNumber(id, fallback, min, max) {
  const value = Number($(id)?.value);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readLines(id) {
  return String($(id)?.value || '')
    .split(/\r?\n|[,，、;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function buildSafetySavePayload() {
  return {
    selectedGroupId: groupManagementState.selectedGroupId || '',
    safety: {
      enabled: $('gm-safety-enabled')?.checked !== false,
      allowAutoRecall: $('gm-safety-allow-recall')?.checked === true,
      allowAutoMute: $('gm-safety-allow-mute')?.checked === true,
      allowAutoKick: $('gm-safety-allow-kick')?.checked === true,
      maxAutoMuteSeconds: readNumber('gm-safety-max-mute-seconds', 600, 60, 2592000),
      requireConsoleConfirm: $('gm-safety-require-confirm')?.checked !== false,
    },
  };
}

function buildDefaultsSavePayload() {
  return {
    selectedGroupId: groupManagementState.selectedGroupId || '',
    auth: {
      enable: $('gm-default-auth-enable')?.checked === true,
      carbon: {
        enable: $('gm-default-auth-carbon-enable')?.checked === true,
        hint: $('gm-default-auth-carbon-hint')?.checked === true,
        'hard-mode': $('gm-default-auth-carbon-hard')?.checked === true,
      },
      timeout: readNumber('gm-default-auth-timeout', 180, 30, 1800),
      recall: $('gm-default-auth-recall')?.checked === true,
      frequency: readNumber('gm-default-auth-frequency', 5, 1, 20),
      autoApprove: {
        enable: $('gm-default-auto-approve-enable')?.checked === true,
        minQqLevel: readNumber('gm-default-auto-min-qq-level', 0, 0, 255),
        minAge: readNumber('gm-default-auto-min-age', 0, 0, 150),
        commentKeywords: readLines('gm-default-auto-comment-keywords'),
        blockedKeywords: readLines('gm-default-auto-blocked-keywords'),
        customRules: readLines('gm-default-auto-custom-rules'),
        risk: {
          enabled: $('gm-default-auto-risk-enabled')?.checked === true,
          scoreEnabled: $('gm-default-auto-risk-score-enabled')?.checked === true,
          blockBlacklistAutoApprove: $('gm-default-auto-risk-block-blacklist')?.checked === true,
          autoApproveWhitelisted: $('gm-default-auto-risk-auto-whitelist')?.checked === true,
          holdHighRisk: $('gm-default-auto-risk-hold-high')?.checked === true,
          highRiskScore: readNumber('gm-default-auto-risk-high-score', 70, 1, 100),
          warningBlockThreshold: readNumber('gm-default-auto-risk-warning-threshold', 3, 0, 100),
        },
      },
    },
    welcome: {
      enabled: $('gm-default-welcome-enabled')?.checked === true,
      text: $('gm-default-welcome-text')?.value || '',
      aiEnabled: $('gm-default-welcome-ai-enabled')?.checked === true,
    },
    moderation: {
      content: {
        enabled: $('gm-default-content-enabled')?.checked === true,
        exemptAdmins: $('gm-default-content-exempt-admins')?.checked === true,
        detectLinks: $('gm-default-content-detect-links')?.checked === true,
        urlSafety: {
          enabled: $('gm-default-content-url-safety-enabled')?.checked === true,
          riskThreshold: $('gm-default-content-url-safety-threshold')?.value || 'high',
          maxUrlsPerMessage: readNumber('gm-default-content-url-safety-max-urls', 2, 1, 5),
          markdownMaxLength: readNumber('gm-default-content-url-safety-md-length', 6000, 1000, 20000),
          timeoutMs: readNumber('gm-default-content-url-safety-timeout', 20000, 20000, 60000),
          whitelist: readLines('gm-default-content-url-safety-whitelist'),
        },
        detectBlockedKeywords: $('gm-default-content-detect-keywords')?.checked === true,
        blockedKeywords: readLines('gm-default-content-blocked-keywords'),
        repeatLimit: readNumber('gm-default-content-repeat-limit', 4, 2, 20),
        repeatWindowSeconds: readNumber('gm-default-content-repeat-window', 45, 5, 600),
        detectSpamMessages: $('gm-default-content-detect-spam')?.checked === true,
        burstLimit: readNumber('gm-default-content-burst-limit', 8, 2, 60),
        burstWindowSeconds: readNumber('gm-default-content-burst-window', 60, 5, 600),
        observeNewMembers: $('gm-default-content-observe-new')?.checked === true,
        observeMinutes: readNumber('gm-default-content-observe-minutes', 60, 1, 10080),
        observeBlockLinks: $('gm-default-content-observe-block-links')?.checked === true,
        action: $('gm-default-content-action')?.value || 'log',
        muteSeconds: readNumber('gm-default-content-mute-seconds', 600, 60, 2592000),
        addWarning: $('gm-default-content-add-warning')?.checked === true,
      },
    },
  };
}

function normalizeDiffLines(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (item && typeof item === 'object') {
        const userId = String(item.userId || item.user_id || '').trim();
        const note = String(item.note || '').trim();
        return `${userId}${note ? ` ${note}` : ''}`.trim();
      }
      return String(item ?? '').trim();
    })
    .filter(Boolean);
}

function normalizeComparableDiffValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableDiffValue);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeComparableDiffValue(value[key]);
        return result;
      }, {});
  }
  if (value === undefined) return null;
  return value;
}

function isSameDiffValue(left, right) {
  return JSON.stringify(normalizeComparableDiffValue(left)) === JSON.stringify(normalizeComparableDiffValue(right));
}

function formatDiffValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '空';
    const preview = value.slice(0, 5).map(item => String(item)).join('、');
    return value.length > 5 ? `${preview} 等 ${value.length} 项` : preview;
  }
  if (value === true) return '开启';
  if (value === false) return '关闭';
  if (value === null || value === undefined || value === '') return '空';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 100 ? `${text.slice(0, 100)}...` : text;
}

function addGroupSaveDiffLine(diffs, label, before, after) {
  if (isSameDiffValue(before, after)) return;
  diffs.push(`${label}: ${formatDiffValue(before)} -> ${formatDiffValue(after)}`);
}

function formatDiffSeconds(value, fallback = 0) {
  const number = Number(value);
  return `${Number.isFinite(number) ? Math.round(number) : fallback} 秒`;
}

function formatWelcomeImageDiffValue(value = {}) {
  if (!value || typeof value !== 'object') return '无';
  if (value.uploaded === true) return value.name ? `上传新图 ${value.name}` : '上传新图';
  if (value.hasImage === true) return value.name ? `已设置 ${value.name}` : '已设置';
  return '无';
}

function buildGroupSaveDiffLines(group = {}, payload = {}) {
  const config = group.config || {};
  const auth = config.auth?.config || {};
  const carbon = auth.carbon || {};
  const autoApprove = auth.autoApprove || {};
  const risk = autoApprove.risk || {};
  const welcome = config.welcome || {};
  const moderation = config.moderation || {};
  const content = moderation.content || {};
  const nextAuth = payload.auth || {};
  const nextCarbon = nextAuth.carbon || {};
  const nextAutoApprove = nextAuth.autoApprove || {};
  const nextRisk = nextAutoApprove.risk || {};
  const nextWelcome = payload.welcome || {};
  const nextModeration = payload.moderation || {};
  const nextContent = nextModeration.content || {};
  const diffs = [];

  addGroupSaveDiffLine(diffs, 'AI 黑名单', config.ai?.blocked === true, payload.ai?.blocked === true);
  addGroupSaveDiffLine(diffs, 'AI 白名单', config.ai?.whitelisted === true, payload.ai?.whitelisted === true);
  addGroupSaveDiffLine(diffs, '图片监控白名单', config.imageMonitor?.allowed === true, payload.imageMonitor?.allowed === true);
  addGroupSaveDiffLine(diffs, '图片监控黑名单', config.imageMonitor?.blocked === true, payload.imageMonitor?.blocked === true);
  addGroupSaveDiffLine(diffs, '每日总结启用群', config.dailySummary?.allowed === true, payload.dailySummary?.allowed === true);
  addGroupSaveDiffLine(diffs, '每日总结禁用群', config.dailySummary?.blocked === true, payload.dailySummary?.blocked === true);

  addGroupSaveDiffLine(diffs, '入群验证', auth.enable === true, nextAuth.enable === true);
  addGroupSaveDiffLine(diffs, '验证码验证', carbon.enable === true, nextCarbon.enable === true);
  addGroupSaveDiffLine(diffs, '验证码提示', carbon.hint === true, nextCarbon.hint === true);
  addGroupSaveDiffLine(diffs, '验证码困难模式', carbon['hard-mode'] === true, nextCarbon['hard-mode'] === true);
  addGroupSaveDiffLine(diffs, '验证超时', formatDiffSeconds(auth.timeout, 180), formatDiffSeconds(nextAuth.timeout, 180));
  addGroupSaveDiffLine(diffs, '撤回验证消息', auth.recall === true, nextAuth.recall === true);
  addGroupSaveDiffLine(diffs, '答错次数', Number(auth.frequency || 5), Number(nextAuth.frequency || 5));

  addGroupSaveDiffLine(diffs, '自动通过加群申请', autoApprove.enable === true, nextAutoApprove.enable === true);
  addGroupSaveDiffLine(diffs, '自动通过最低 QQ 等级', Number(autoApprove.minQqLevel || 0), Number(nextAutoApprove.minQqLevel || 0));
  addGroupSaveDiffLine(diffs, '自动通过最低年龄', Number(autoApprove.minAge || 0), Number(nextAutoApprove.minAge || 0));
  addGroupSaveDiffLine(diffs, '申请理由必要词', normalizeDiffLines(autoApprove.commentKeywords), normalizeDiffLines(nextAutoApprove.commentKeywords));
  addGroupSaveDiffLine(diffs, '申请理由拦截词', normalizeDiffLines(autoApprove.blockedKeywords), normalizeDiffLines(nextAutoApprove.blockedKeywords));
  addGroupSaveDiffLine(diffs, '自动通过自定义规则', normalizeDiffLines(autoApprove.customRules), normalizeDiffLines(nextAutoApprove.customRules));
  addGroupSaveDiffLine(diffs, '入群风险评分', risk.enabled === true, nextRisk.enabled === true);
  addGroupSaveDiffLine(diffs, '记录风险分', risk.scoreEnabled === true, nextRisk.scoreEnabled === true);
  addGroupSaveDiffLine(diffs, '黑名单不自动通过', risk.blockBlacklistAutoApprove === true, nextRisk.blockBlacklistAutoApprove === true);
  addGroupSaveDiffLine(diffs, '白名单直接通过', risk.autoApproveWhitelisted === true, nextRisk.autoApproveWhitelisted === true);
  addGroupSaveDiffLine(diffs, '高风险保留人工审核', risk.holdHighRisk === true, nextRisk.holdHighRisk === true);
  addGroupSaveDiffLine(diffs, '高风险分阈值', Number(risk.highRiskScore || 70), Number(nextRisk.highRiskScore || 70));
  addGroupSaveDiffLine(diffs, '警告积分拦截阈值', Number(risk.warningBlockThreshold ?? 3), Number(nextRisk.warningBlockThreshold ?? 3));

  addGroupSaveDiffLine(diffs, '群黑名单', normalizeDiffLines(moderation.blacklist), normalizeDiffLines(nextModeration.blacklist));
  addGroupSaveDiffLine(diffs, '群白名单', normalizeDiffLines(moderation.whitelist), normalizeDiffLines(nextModeration.whitelist));
  addGroupSaveDiffLine(diffs, '群消息风控', content.enabled === true, nextContent.enabled === true);
  addGroupSaveDiffLine(diffs, '跳过群主和管理员', content.exemptAdmins === true, nextContent.exemptAdmins === true);
  addGroupSaveDiffLine(diffs, '检测链接', content.detectLinks === true, nextContent.detectLinks === true);
  addGroupSaveDiffLine(diffs, '链接安全检查', content.urlSafety?.enabled === true, nextContent.urlSafety?.enabled === true);
  addGroupSaveDiffLine(diffs, 'URL 风险阈值', content.urlSafety?.riskThreshold || 'high', nextContent.urlSafety?.riskThreshold || 'high');
  addGroupSaveDiffLine(diffs, '每条消息检查 URL 数', Number(content.urlSafety?.maxUrlsPerMessage || 2), Number(nextContent.urlSafety?.maxUrlsPerMessage || 2));
  addGroupSaveDiffLine(diffs, '网页读取最大字符', Number(content.urlSafety?.markdownMaxLength || 6000), Number(nextContent.urlSafety?.markdownMaxLength || 6000));
  addGroupSaveDiffLine(diffs, 'URL 检查超时', `${Number(content.urlSafety?.timeoutMs || 20000)} ms`, `${Number(nextContent.urlSafety?.timeoutMs || 20000)} ms`);
  addGroupSaveDiffLine(diffs, 'URL 安检白名单', normalizeDiffLines(content.urlSafety?.whitelist), normalizeDiffLines(nextContent.urlSafety?.whitelist));
  addGroupSaveDiffLine(diffs, '检测关键词', content.detectBlockedKeywords === true, nextContent.detectBlockedKeywords === true);
  addGroupSaveDiffLine(diffs, '消息风控关键词', normalizeDiffLines(content.blockedKeywords), normalizeDiffLines(nextContent.blockedKeywords));
  addGroupSaveDiffLine(diffs, '重复消息阈值', Number(content.repeatLimit || 4), Number(nextContent.repeatLimit || 4));
  addGroupSaveDiffLine(diffs, '重复消息窗口', formatDiffSeconds(content.repeatWindowSeconds, 45), formatDiffSeconds(nextContent.repeatWindowSeconds, 45));
  addGroupSaveDiffLine(diffs, '刷屏检测', content.detectSpamMessages === true, nextContent.detectSpamMessages === true);
  addGroupSaveDiffLine(diffs, '短时刷屏阈值', Number(content.burstLimit || 8), Number(nextContent.burstLimit || 8));
  addGroupSaveDiffLine(diffs, '短时刷屏窗口', formatDiffSeconds(content.burstWindowSeconds, 60), formatDiffSeconds(nextContent.burstWindowSeconds, 60));
  addGroupSaveDiffLine(diffs, '新人观察期', content.observeNewMembers === true, nextContent.observeNewMembers === true);
  addGroupSaveDiffLine(diffs, '观察期时长', `${Number(content.observeMinutes || 60)} 分钟`, `${Number(nextContent.observeMinutes || 60)} 分钟`);
  addGroupSaveDiffLine(diffs, '观察期禁止链接', content.observeBlockLinks === true, nextContent.observeBlockLinks === true);
  addGroupSaveDiffLine(
    diffs,
    '风控处理动作',
    GROUP_MANAGEMENT_ACTION_LABELS[normalizeModerationAction(content.action || 'log')],
    GROUP_MANAGEMENT_ACTION_LABELS[normalizeModerationAction(nextContent.action || 'log')],
  );
  addGroupSaveDiffLine(diffs, '自动禁言时长', formatDiffSeconds(content.muteSeconds, 600), formatDiffSeconds(nextContent.muteSeconds, 600));
  addGroupSaveDiffLine(diffs, '触发后增加警告积分', content.addWarning === true, nextContent.addWarning === true);

  addGroupSaveDiffLine(diffs, '入群欢迎', welcome.enabled === true, nextWelcome.enabled === true);
  addGroupSaveDiffLine(diffs, 'AI 入群欢迎', welcome.aiEnabled === true, nextWelcome.aiEnabled === true);
  addGroupSaveDiffLine(diffs, '欢迎文案', welcome.text || '', nextWelcome.text || '');
  const beforeImage = {
    hasImage: welcome.hasImage === true,
    name: welcome.imageName || '',
  };
  const afterImage = nextWelcome.deleteImage === true
    ? { hasImage: false }
    : nextWelcome.imageDataUrl
      ? { uploaded: true, name: groupManagementState.welcomeImageFile?.name || '' }
      : beforeImage;
  addGroupSaveDiffLine(diffs, '欢迎图片', formatWelcomeImageDiffValue(beforeImage), formatWelcomeImageDiffValue(afterImage));

  return diffs;
}

async function confirmGroupSaveDiff(payload = {}) {
  const group = getSelectedGroup();
  if (!group) return true;
  const diffs = buildGroupSaveDiffLines(group, payload);
  if (diffs.length === 0) {
    return confirmGroupManagementModal(`没有检测到当前群配置变化。\n\n群号：${group.groupId}\n继续保存会刷新备份和日志，确认保存？`, {
      title: '保存当前群',
    });
  }
  const maxLines = 28;
  const visibleLines = diffs.slice(0, maxLines).map(line => `- ${line}`).join('\n');
  const hiddenCount = diffs.length - maxLines;
  const hiddenText = hiddenCount > 0 ? `\n...还有 ${hiddenCount} 项未显示` : '';
  return confirmGroupManagementModal(
    `保存前差异预览\n\n群：${group.displayName || group.groupId}\n群号：${group.groupId}\n\n${visibleLines}${hiddenText}\n\n确认保存当前群配置？`,
    { title: '保存前差异预览' },
  );
}

async function confirmGroupSaveSafety(payload = {}) {
  const content = payload?.moderation?.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return true;
  const action = normalizeModerationAction(content.action || 'log');
  if (!isDangerousModerationAction(action)) return true;
  const safety = getSafetyConfig();
  const dangerLabel = GROUP_MANAGEMENT_DANGEROUS_ACTION_LABELS[action] || GROUP_MANAGEMENT_ACTION_LABELS[action] || action;
  if (safety.enabled !== false) {
    if (!isModerationActionAllowedBySafety(action, safety)) {
      showRisk(`群管安全开关未允许${dangerLabel}，请先保存安全开关放行，或把触发动作改为“只记录/提醒并警告”。`);
      return false;
    }
    if (
      action === 'mute'
      && Number(content.muteSeconds || 0) > Number(safety.maxAutoMuteSeconds || 600)
    ) {
      showRisk(`自动禁言秒数超过安全上限 ${safety.maxAutoMuteSeconds} 秒，请降低禁言秒数或调整安全上限。`);
      return false;
    }
  }
  if (safety.enabled === false || safety.requireConsoleConfirm !== false) {
    const confirmText = safety.enabled === false
      ? `危险动作保护已关闭。确认把当前群消息风控动作保存为“${GROUP_MANAGEMENT_ACTION_LABELS[action]}”？`
      : `确认把当前群消息风控动作保存为“${GROUP_MANAGEMENT_ACTION_LABELS[action]}”？命中规则后会执行${dangerLabel}。`;
    if (!await confirmGroupManagementModal(confirmText, { title: '危险动作确认' })) {
      return false;
    }
    content.dangerConfirmed = true;
  }
  return true;
}

async function buildSavePayload() {
  const group = getSelectedGroup();
  if (!group) {
    throw new Error('请先选择群');
  }
  const welcome = {
    enabled: $('gm-welcome-enabled')?.checked === true,
    text: $('gm-welcome-text')?.value || '',
    aiEnabled: $('gm-welcome-ai-enabled')?.checked === true,
  };
  if (groupManagementState.welcomeDeleteImage) {
    welcome.deleteImage = true;
  }
  if (groupManagementState.welcomeImageFile) {
    welcome.imageDataUrl = await readFileAsDataUrl(groupManagementState.welcomeImageFile);
  }
  return {
    groupId: group.groupId,
    ai: {
      blocked: $('gm-ai-blocked')?.checked === true,
      whitelisted: $('gm-ai-whitelisted')?.checked === true,
    },
    imageMonitor: {
      allowed: $('gm-image-allowed')?.checked === true,
      blocked: $('gm-image-blocked')?.checked === true,
    },
    dailySummary: {
      allowed: $('gm-summary-allowed')?.checked === true,
      blocked: $('gm-summary-blocked')?.checked === true,
    },
    auth: {
      enable: $('gm-auth-enable')?.checked === true,
      carbon: {
        enable: $('gm-auth-carbon-enable')?.checked === true,
        hint: $('gm-auth-carbon-hint')?.checked === true,
        'hard-mode': $('gm-auth-carbon-hard')?.checked === true,
      },
      timeout: readNumber('gm-auth-timeout', 180, 30, 1800),
      recall: $('gm-auth-recall')?.checked === true,
      frequency: readNumber('gm-auth-frequency', 5, 1, 20),
      autoApprove: {
        enable: $('gm-auto-approve-enable')?.checked === true,
        minQqLevel: readNumber('gm-auto-min-qq-level', 0, 0, 255),
        minAge: readNumber('gm-auto-min-age', 0, 0, 150),
        commentKeywords: readLines('gm-auto-comment-keywords'),
        blockedKeywords: readLines('gm-auto-blocked-keywords'),
        customRules: readLines('gm-auto-custom-rules'),
        risk: {
          enabled: $('gm-auto-risk-enabled')?.checked === true,
          scoreEnabled: $('gm-auto-risk-score-enabled')?.checked === true,
          blockBlacklistAutoApprove: $('gm-auto-risk-block-blacklist')?.checked === true,
          autoApproveWhitelisted: $('gm-auto-risk-auto-whitelist')?.checked === true,
          holdHighRisk: $('gm-auto-risk-hold-high')?.checked === true,
          highRiskScore: readNumber('gm-auto-risk-high-score', 70, 1, 100),
          warningBlockThreshold: readNumber('gm-auto-risk-warning-threshold', 3, 0, 100),
        },
      },
    },
    moderation: {
      blacklist: readLines('gm-moderation-blacklist'),
      whitelist: readLines('gm-moderation-whitelist'),
      content: {
        enabled: $('gm-content-enabled')?.checked === true,
        exemptAdmins: $('gm-content-exempt-admins')?.checked === true,
        detectLinks: $('gm-content-detect-links')?.checked === true,
        urlSafety: {
          enabled: $('gm-content-url-safety-enabled')?.checked === true,
          riskThreshold: $('gm-content-url-safety-threshold')?.value || 'high',
          maxUrlsPerMessage: readNumber('gm-content-url-safety-max-urls', 2, 1, 5),
          markdownMaxLength: readNumber('gm-content-url-safety-md-length', 6000, 1000, 20000),
          timeoutMs: readNumber('gm-content-url-safety-timeout', 20000, 20000, 60000),
          whitelist: readLines('gm-content-url-safety-whitelist'),
        },
        detectBlockedKeywords: $('gm-content-detect-keywords')?.checked === true,
        blockedKeywords: readLines('gm-content-blocked-keywords'),
        repeatLimit: readNumber('gm-content-repeat-limit', 4, 2, 20),
        repeatWindowSeconds: readNumber('gm-content-repeat-window', 45, 5, 600),
        detectSpamMessages: $('gm-content-detect-spam')?.checked === true,
        burstLimit: readNumber('gm-content-burst-limit', 8, 2, 60),
        burstWindowSeconds: readNumber('gm-content-burst-window', 60, 5, 600),
        observeNewMembers: $('gm-content-observe-new')?.checked === true,
        observeMinutes: readNumber('gm-content-observe-minutes', 60, 1, 10080),
        observeBlockLinks: $('gm-content-observe-block-links')?.checked === true,
        action: $('gm-content-action')?.value || 'log',
        muteSeconds: readNumber('gm-content-mute-seconds', 600, 60, 2592000),
        addWarning: $('gm-content-add-warning')?.checked === true,
      },
    },
    welcome,
  };
}

