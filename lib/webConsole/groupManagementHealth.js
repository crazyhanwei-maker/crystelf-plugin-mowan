export const GROUP_MANAGEMENT_HEALTH_AUTO_FIX_CODES = new Set([
  'ai_group_allow_block_conflict',
  'image_monitor_allow_block_conflict',
  'daily_summary_allow_block_conflict',
  'dangerous_action_blocked_by_safety',
  'mute_seconds_over_safety_limit',
  'auto_approve_without_conditions',
  'ai_welcome_enabled_but_welcome_disabled',
  'welcome_enabled_without_content',
]);

const GROUP_MANAGEMENT_HEALTH_CODE_BY_TITLE = {
  '控制台没有拿到 Bot 运行时实例': 'runtime_bot_unavailable',
  'Bot 运行时没有返回群列表': 'runtime_group_list_empty',
  '读取运行时群列表时出现提示': 'runtime_group_list_warning',
  '群管理总开关关闭，但有群开启了消息风控': 'global_group_management_disabled_with_content_enabled',
  '入群验证总开关关闭，但有群开启了验证或自动通过': 'global_auth_disabled_with_group_auth_enabled',
  '入群欢迎总开关关闭，但有群开启了欢迎': 'global_welcome_disabled_with_group_welcome_enabled',
  'AI 总开关关闭，但群内存在 AI 相关功能': 'global_ai_disabled_with_group_ai_features',
  'AI 接口配置不完整': 'ai_api_config_incomplete',
  '有群加入了每日总结启用列表，但当前未生效': 'daily_summary_configured_but_ineffective',
  '图片监控总开关关闭，但有群加入了监控范围': 'global_image_monitor_disabled_with_group_scope',
  '图片监控接口配置不完整': 'image_monitor_api_config_incomplete',
  '图片监控配置为自动撤回，但部分群 Bot 不是管理员': 'image_recall_requires_bot_admin',
  '有群同时在 AI 黑名单和白名单中': 'ai_group_allow_block_conflict',
  '有群同时在图片监控白名单和黑名单中': 'image_monitor_allow_block_conflict',
  '有群同时在每日总结启用和禁用列表中': 'daily_summary_allow_block_conflict',
  '有成员同时在本群黑名单和白名单中': 'moderation_member_black_white_conflict',
  '危险动作保护关闭，且有群开启了自动撤回/禁言/踢人': 'dangerous_action_without_safety_guard',
  '有群配置了危险风控动作，但安全开关未放行': 'dangerous_action_blocked_by_safety',
  '有群自动禁言时长超过安全上限': 'mute_seconds_over_safety_limit',
  '部分群配置了撤回/禁言/踢人，但 Bot 不是管理员或群主': 'dangerous_action_requires_bot_admin',
  '部分群开启了入群验证或自动通过，但 Bot 权限不足': 'auth_requires_bot_admin',
  '部分群开启了自动通过，但没有设置通过条件': 'auto_approve_without_conditions',
  '部分群开启了 AI 欢迎选项，但欢迎本身未生效': 'ai_welcome_enabled_but_welcome_disabled',
  '部分群开启了入群欢迎，但没有文案、图片或 AI 欢迎': 'welcome_enabled_without_content',
  '未发现明显配置问题': 'healthy',
};

function getGroupSample(groups = [], limit = 5) {
  return groups.slice(0, limit).map(group => ({
    groupId: group.groupId,
    name: group.displayName || group.name || '',
    botRole: group.permissions?.role || group.botRole || '',
  }));
}

function getAiReadiness(allConfigs = {}, hasConfiguredSecret = value => Boolean(String(value || '').trim())) {
  const aiConfig = allConfigs.ai || {};
  const missing = [];
  if (!String(aiConfig.baseApi || '').trim()) missing.push('主对话接口地址');
  if (!String(aiConfig.modelType || aiConfig.workingModel || '').trim()) missing.push('主对话模型');
  if (!hasConfiguredSecret(aiConfig.apiKey)) missing.push('主对话 API Key');
  return {
    ready: missing.length === 0,
    missing,
  };
}

function getImageMonitorReadiness(allConfigs = {}, hasConfiguredSecret = value => Boolean(String(value || '').trim())) {
  const imageMonitorConfig = allConfigs.imageMonitor || {};
  const missing = [];
  if (!String(imageMonitorConfig.apiBase || '').trim()) missing.push('图片监控接口地址');
  if (!String(imageMonitorConfig.model || '').trim()) missing.push('图片监控模型');
  if (!hasConfiguredSecret(imageMonitorConfig.apiKey)) missing.push('图片监控 API Key');
  return {
    ready: missing.length === 0,
    missing,
  };
}

function getImageViolationAction(cfg = {}) {
  const action = String(cfg.violationAction || '').trim().toLowerCase();
  if (['record', 'alert', 'recall'].includes(action)) return action;
  return cfg.autoRecallViolation ? 'recall' : 'record';
}

function isAutoApproveOpen(auth = {}) {
  const autoApprove = auth.autoApprove || {};
  const hasCondition = Number(autoApprove.minQqLevel || 0) > 0
    || Number(autoApprove.minAge || 0) > 0
    || (Array.isArray(autoApprove.commentKeywords) && autoApprove.commentKeywords.length > 0)
    || (Array.isArray(autoApprove.customRules) && autoApprove.customRules.length > 0);
  return autoApprove.enable === true && !hasCondition;
}

function getBlackWhiteConflictGroups(groups = []) {
  return groups.filter(group => {
    const moderation = group.config?.moderation || {};
    const blackIds = new Set((moderation.blacklist || [])
      .map(item => String(item.userId || item.user_id || '').trim())
      .filter(Boolean));
    return (moderation.whitelist || [])
      .some(item => blackIds.has(String(item.userId || item.user_id || '').trim()));
  });
}

export function buildGroupManagementHealthFixAction(code = '', groups = []) {
  if (GROUP_MANAGEMENT_HEALTH_AUTO_FIX_CODES.has(code)) {
    return {
      type: 'auto_fix',
      label: '自动修复样本群',
      code,
      groupIds: getGroupSample(groups).map(group => group.groupId).filter(Boolean),
    };
  }
  if (code.includes('api_config')) return { type: 'open_page', target: 'api-settings', label: '打开 API 设置' };
  if (code.startsWith('global_')) return { type: 'open_page', target: 'plugin-settings', label: '打开插件设置' };
  if (code.includes('safety') || code.includes('dangerous_action')) return { type: 'open_panel', target: 'safety', label: '打开安全开关' };
  if (Array.isArray(groups) && groups.length > 0) {
    return {
      type: 'open_group',
      label: '打开首个群',
      groupId: String(groups[0]?.groupId || '').trim(),
    };
  }
  return { type: 'scan', label: '重新扫描' };
}

export function createGroupManagementHealth(options = {}) {
  const getSafetyConfig = typeof options.getSafetyConfig === 'function' ? options.getSafetyConfig : () => ({});
  const hasConfiguredSecret = typeof options.hasConfiguredSecret === 'function'
    ? options.hasConfiguredSecret
    : value => Boolean(String(value || '').trim());
  const normalizeContentAction = typeof options.normalizeContentAction === 'function'
    ? options.normalizeContentAction
    : value => (['log', 'warn', 'recall', 'mute', 'kick'].includes(String(value || '').trim()) ? String(value || '').trim() : 'log');
  const normalizeBotRole = typeof options.normalizeBotRole === 'function'
    ? options.normalizeBotRole
    : value => String(value || '').trim();
  const dangerousActionLabels = options.dangerousActionLabels || {
    recall: '自动撤回',
    mute: '自动禁言',
    kick: '自动踢人',
  };

  function isDangerActionAllowed(action = '', safety = {}) {
    const normalized = normalizeContentAction(action);
    if (safety.enabled === false) return true;
    if (normalized === 'recall') return safety.allowAutoRecall === true;
    if (normalized === 'mute') return safety.allowAutoMute === true;
    if (normalized === 'kick') return safety.allowAutoKick === true;
    return true;
  }

  function canBotModerate(group = {}) {
    const role = normalizeBotRole(group.permissions?.role || group.botRole);
    return role === 'owner' || role === 'admin';
  }

  function buildPayload(groups = [], allConfigs = {}, runtimeStatus = {}) {
    const mainConfig = allConfigs.config || {};
    const imageMonitorConfig = allConfigs.imageMonitor || {};
    const safety = getSafetyConfig();
    const aiReadiness = getAiReadiness(allConfigs, hasConfiguredSecret);
    const imageMonitorReadiness = getImageMonitorReadiness(allConfigs, hasConfiguredSecret);
    const items = [];
    let sequence = 0;

    const pushItem = (level, title, detail, itemOptions = {}) => {
      const affectedGroups = Array.isArray(itemOptions.groups) ? itemOptions.groups : [];
      const code = String(itemOptions.code || GROUP_MANAGEMENT_HEALTH_CODE_BY_TITLE[title] || `legacy_${sequence + 1}`).trim();
      items.push({
        id: `gm-health-${code}`,
        code,
        level,
        title,
        detail,
        suggestion: itemOptions.suggestion || '',
        scope: itemOptions.scope || (affectedGroups.length > 0 ? 'group' : 'global'),
        groupCount: affectedGroups.length,
        groups: getGroupSample(affectedGroups),
        fixAction: itemOptions.fixAction === null ? null : (itemOptions.fixAction || buildGroupManagementHealthFixAction(code, affectedGroups)),
      });
      sequence += 1;
    };

    if (!runtimeStatus.botAvailable) {
      pushItem(
        'warning',
        '控制台没有拿到 Bot 运行时实例',
        '群列表、Bot 权限和成员数据可能不完整，真实环境仍以 bot 端运行时为准。',
        { suggestion: '确认 bot 已启动，并从 bot 端控制台访问或刷新本页面。' },
      );
    } else if (Number(runtimeStatus.groupCount || 0) <= 0) {
      pushItem(
        'warning',
        'Bot 运行时没有返回群列表',
        '当前页面只能基于已配置群号检查，无法完整判断每个群的 Bot 权限。',
        { suggestion: '检查当前适配器是否支持 getGroupList，或直接输入群号单独检查。' },
      );
    }

    if (Array.isArray(runtimeStatus.warnings) && runtimeStatus.warnings.length > 0) {
      pushItem(
        'info',
        '读取运行时群列表时出现提示',
        runtimeStatus.warnings.slice(0, 3).join('；'),
        { suggestion: '如果群数量明显不对，查看 bot 端适配器日志。' },
      );
    }

    const contentEnabledGroups = groups.filter(group => group.config?.moderation?.content?.enabled === true);
    if (mainConfig.groupManagement === false && contentEnabledGroups.length > 0) {
      pushItem(
        'error',
        '群管理总开关关闭，但有群开启了消息风控',
        '这些群的防广告/防刷屏配置不会真正运行。',
        {
          groups: contentEnabledGroups,
          suggestion: '在插件设置里开启 groupManagement，或用 #灵晶开启群管理 开启当前群能力。',
        },
      );
    }

    const authEnabledGroups = groups.filter(group => {
      const auth = group.config?.auth?.config || {};
      return auth.enable === true || auth.autoApprove?.enable === true;
    });
    if (mainConfig.auth === false && authEnabledGroups.length > 0) {
      pushItem(
        'error',
        '入群验证总开关关闭，但有群开启了验证或自动通过',
        '加群申请和入群验证相关配置不会按预期生效。',
        { groups: authEnabledGroups, suggestion: '在插件设置里开启 auth，或关闭这些群的入群验证/自动通过。' },
      );
    }

    const welcomeEnabledGroups = groups.filter(group => group.config?.welcome?.enabled === true);
    if (mainConfig.welcome === false && welcomeEnabledGroups.length > 0) {
      pushItem(
        'error',
        '入群欢迎总开关关闭，但有群开启了欢迎',
        '新人入群时不会发送欢迎内容。',
        { groups: welcomeEnabledGroups, suggestion: '在插件设置里开启 welcome，或关闭这些群的欢迎配置。' },
      );
    }

    const aiDependentGroups = groups.filter(group => (
      group.config?.ai?.effectiveEnabled === true
      || group.config?.dailySummary?.effectiveEnabled === true
      || (group.config?.welcome?.enabled === true && group.config?.welcome?.aiEnabled === true)
    ));
    if (mainConfig.ai === false && aiDependentGroups.length > 0) {
      pushItem(
        'error',
        'AI 总开关关闭，但群内存在 AI 相关功能',
        'AI 回复、AI 入群欢迎和每日群聊总结都会受到影响。',
        { groups: aiDependentGroups, suggestion: '在插件设置里开启 ai，或关闭这些群的 AI 相关功能。' },
      );
    } else if (!aiReadiness.ready && aiDependentGroups.length > 0) {
      pushItem(
        'error',
        'AI 接口配置不完整',
        `缺少：${aiReadiness.missing.join('、')}。AI 回复、AI 欢迎或群总结可能失败。`,
        { groups: aiDependentGroups, suggestion: '到 API 设置里补齐主对话接口、模型和密钥后再测试。' },
      );
    }

    const dailySummaryConfiguredGroups = groups.filter(group => group.config?.dailySummary?.allowed === true);
    const dailySummaryDisabledGroups = dailySummaryConfiguredGroups.filter(group => group.config?.dailySummary?.effectiveEnabled !== true);
    if (dailySummaryDisabledGroups.length > 0) {
      pushItem(
        'warning',
        '有群加入了每日总结启用列表，但当前未生效',
        '通常是每日总结全局开关关闭、AI 总开关关闭，或该群同时在禁用列表中。',
        { groups: dailySummaryDisabledGroups, suggestion: '检查每日总结全局开关、启用/禁用列表和 AI 配置。' },
      );
    }

    const imageMonitorGroups = groups.filter(group => (
      group.config?.imageMonitor?.effectiveEnabled === true
      || group.config?.imageMonitor?.allowed === true
    ));
    if ((mainConfig.imageMonitor === false || imageMonitorConfig.enabled !== true) && imageMonitorGroups.length > 0) {
      pushItem(
        'error',
        '图片监控总开关关闭，但有群加入了监控范围',
        '这些群不会触发图片审核。',
        { groups: imageMonitorGroups, suggestion: '在插件设置或 API 设置中开启图片监控，或移出监控白名单。' },
      );
    } else if (!imageMonitorReadiness.ready && imageMonitorGroups.length > 0) {
      pushItem(
        'error',
        '图片监控接口配置不完整',
        `缺少：${imageMonitorReadiness.missing.join('、')}。图片审核和表情包识别可能失败。`,
        { groups: imageMonitorGroups, suggestion: '到 API 设置里补齐图片监控接口、模型和密钥。' },
      );
    }

    if (getImageViolationAction(imageMonitorConfig) === 'recall') {
      const imageRecallPermissionGroups = imageMonitorGroups.filter(group => !canBotModerate(group));
      if (imageRecallPermissionGroups.length > 0) {
        pushItem(
          'warning',
          '图片监控配置为自动撤回，但部分群 Bot 不是管理员',
          '命中违规图片时可能只能记录或提示，无法撤回。',
          { groups: imageRecallPermissionGroups, suggestion: '给 Bot 管理员权限，或把图片监控违规动作改为仅记录/告警。' },
        );
      }
    }

    const aiListConflictGroups = groups.filter(group => group.config?.ai?.blocked === true && group.config?.ai?.whitelisted === true);
    if (aiListConflictGroups.length > 0) {
      pushItem('error', '有群同时在 AI 黑名单和白名单中', '黑白名单冲突会导致 AI 生效结果难以判断。', {
        groups: aiListConflictGroups,
        suggestion: '只保留一种 AI 群策略后保存。',
      });
    }

    const imageListConflictGroups = groups.filter(group => group.config?.imageMonitor?.allowed === true && group.config?.imageMonitor?.blocked === true);
    if (imageListConflictGroups.length > 0) {
      pushItem('error', '有群同时在图片监控白名单和黑名单中', '图片监控范围冲突会导致审核不生效。', {
        groups: imageListConflictGroups,
        suggestion: '只保留白名单或黑名单其中一种状态后保存。',
      });
    }

    const summaryListConflictGroups = groups.filter(group => group.config?.dailySummary?.allowed === true && group.config?.dailySummary?.blocked === true);
    if (summaryListConflictGroups.length > 0) {
      pushItem('error', '有群同时在每日总结启用和禁用列表中', '禁用列表会阻断每日总结发送。', {
        groups: summaryListConflictGroups,
        suggestion: '只保留启用或禁用其中一种状态后保存。',
      });
    }

    const blackWhiteConflictGroups = getBlackWhiteConflictGroups(groups);
    if (blackWhiteConflictGroups.length > 0) {
      pushItem('error', '有成员同时在本群黑名单和白名单中', '同一个 QQ 同时命中黑白名单会影响自动审核判断。', {
        groups: blackWhiteConflictGroups,
        suggestion: '打开对应群，整理黑白名单后保存。',
      });
    }

    const dangerousContentGroups = contentEnabledGroups.filter(group => {
      const action = normalizeContentAction(group.config?.moderation?.content?.action || 'log');
      return Object.prototype.hasOwnProperty.call(dangerousActionLabels, action);
    });
    if (dangerousContentGroups.length > 0 && safety.enabled === false) {
      pushItem(
        'warning',
        '危险动作保护关闭，且有群开启了自动撤回/禁言/踢人',
        '命中风控规则后会直接执行高风险动作。',
        { groups: dangerousContentGroups, suggestion: '建议开启危险动作保护，或把群消息风控动作改为只记录/提醒并警告。' },
      );
    }

    const safetyBlockedGroups = dangerousContentGroups.filter(group => {
      const action = group.config?.moderation?.content?.action || 'log';
      return !isDangerActionAllowed(action, safety);
    });
    if (safetyBlockedGroups.length > 0) {
      pushItem(
        'error',
        '有群配置了危险风控动作，但安全开关未放行',
        '保存会被控制台拦截，运行时也会降级处理。',
        { groups: safetyBlockedGroups, suggestion: '在安全开关里放行对应动作，或把触发动作改为提醒并警告。' },
      );
    }

    const muteOverLimitGroups = dangerousContentGroups.filter(group => {
      const content = group.config?.moderation?.content || {};
      return normalizeContentAction(content.action) === 'mute'
        && Number(content.muteSeconds || 0) > Number(safety.maxAutoMuteSeconds || 600);
    });
    if (muteOverLimitGroups.length > 0) {
      pushItem(
        'error',
        '有群自动禁言时长超过安全上限',
        `当前安全上限为 ${safety.maxAutoMuteSeconds || 600} 秒，超过后保存会被拦截或运行时裁剪。`,
        { groups: muteOverLimitGroups, suggestion: '降低群消息风控禁言秒数，或调整安全开关里的禁言上限。' },
      );
    }

    const dangerousPermissionGroups = dangerousContentGroups.filter(group => !canBotModerate(group));
    if (dangerousPermissionGroups.length > 0) {
      pushItem(
        'warning',
        '部分群配置了撤回/禁言/踢人，但 Bot 不是管理员或群主',
        '真实环境中这些动作可能失败。',
        { groups: dangerousPermissionGroups, suggestion: '给 Bot 管理员权限，或把触发动作改为只记录/提醒。' },
      );
    }

    const authPermissionGroups = authEnabledGroups.filter(group => !canBotModerate(group));
    if (authPermissionGroups.length > 0) {
      pushItem(
        'warning',
        '部分群开启了入群验证或自动通过，但 Bot 权限不足',
        '处理加群申请、撤回验证消息或管理未通过成员时可能失败。',
        { groups: authPermissionGroups, suggestion: '给 Bot 管理员权限，或关闭这些群的自动处理能力。' },
      );
    }

    const openAutoApproveGroups = authEnabledGroups.filter(group => isAutoApproveOpen(group.config?.auth?.config || {}));
    if (openAutoApproveGroups.length > 0) {
      pushItem(
        'warning',
        '部分群开启了自动通过，但没有设置通过条件',
        '除拦截词、黑名单或高风险策略外，普通申请可能被直接同意。',
        { groups: openAutoApproveGroups, suggestion: '建议设置 QQ 等级、年龄、申请理由必要词或自定义条件。' },
      );
    }

    const aiWelcomeDisabledGroups = groups.filter(group => (
      group.config?.welcome?.aiEnabled === true
      && group.config?.welcome?.enabled !== true
    ));
    if (aiWelcomeDisabledGroups.length > 0) {
      pushItem(
        'info',
        '部分群开启了 AI 欢迎选项，但欢迎本身未生效',
        'AI 欢迎需要入群欢迎生效后才会触发。',
        { groups: aiWelcomeDisabledGroups, suggestion: '开启入群欢迎，或关闭 AI 欢迎选项避免误解。' },
      );
    }

    const emptyWelcomeGroups = welcomeEnabledGroups.filter(group => {
      const welcome = group.config?.welcome || {};
      return !String(welcome.text || '').trim() && welcome.hasImage !== true && welcome.aiEnabled !== true;
    });
    if (emptyWelcomeGroups.length > 0) {
      pushItem(
        'warning',
        '部分群开启了入群欢迎，但没有文案、图片或 AI 欢迎',
        '新人入群时可能只发送非常简短的默认欢迎或没有有效内容。',
        { groups: emptyWelcomeGroups, suggestion: '补充欢迎文案、欢迎图片，或开启 AI 欢迎。' },
      );
    }

    if (items.length === 0) {
      pushItem(
        'success',
        '未发现明显配置问题',
        '当前群管理配置通过基础健康检查。',
        { suggestion: '上传 bot 前仍建议用模拟调试回放关键场景。' },
      );
    }

    const summary = {
      errors: items.filter(item => item.level === 'error').length,
      warnings: items.filter(item => item.level === 'warning').length,
      infos: items.filter(item => item.level === 'info').length,
      success: items.filter(item => item.level === 'success').length,
    };
    const status = summary.errors > 0 ? 'error' : summary.warnings > 0 ? 'warning' : 'healthy';
    const rank = { error: 0, warning: 1, info: 2, success: 3 };
    items.sort((left, right) => (rank[left.level] ?? 9) - (rank[right.level] ?? 9));
    return {
      generatedAt: new Date().toISOString(),
      status,
      summary,
      integrations: {
        ai: aiReadiness,
        imageMonitor: imageMonitorReadiness,
      },
      items,
    };
  }

  return {
    buildPayload,
  };
}
