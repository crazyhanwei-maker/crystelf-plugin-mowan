export function createLogConsole(options = {}) {
  const usageLogFile = options.usageLogFile || '';
  const affinityLogFile = options.affinityLogFile || '';
  const groupManagementLogFile = options.groupManagementLogFile || '';
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({ readOnly: false, exposeLogs: true, logTailLength: 12000, pageSize: 10, maxPageSize: 100 }));
  const sendJson = typeof options.sendJson === 'function' ? options.sendJson : (() => {});
  const readTailText = typeof options.readTailText === 'function' ? options.readTailText : (() => '');
  const parseJsonObjects = typeof options.parseJsonObjects === 'function' ? options.parseJsonObjects : (() => []);
  const normalizeUsageScene = typeof options.normalizeUsageScene === 'function'
    ? options.normalizeUsageScene
    : (entry = {}) => String(entry?.scene || 'unknown');
  const buildEntryId = typeof options.buildEntryId === 'function'
    ? options.buildEntryId
    : ((prefix, entry = {}, index = 0) => [prefix, entry.time || 'unknown', index].join('::'));
  const paginateItems = typeof options.paginateItems === 'function'
    ? options.paginateItems
    : ((items = []) => ({ items, page: 1, pageSize: items.length, total: items.length, totalPages: 1 }));
  const buildProfilesPayload = typeof options.buildProfilesPayload === 'function'
    ? options.buildProfilesPayload
    : (() => ({}));
  const buildAffinityListPayload = typeof options.buildAffinityListPayload === 'function'
    ? options.buildAffinityListPayload
    : (() => ({}));
  const buildImageMonitorLogPayload = typeof options.buildImageMonitorLogPayload === 'function'
    ? options.buildImageMonitorLogPayload
    : (() => ({}));
  const buildUsageTrendPayload = typeof options.buildUsageTrendPayload === 'function'
    ? options.buildUsageTrendPayload
    : (() => ({}));
  const buildWebConsoleAuditLogEntries = typeof options.buildWebConsoleAuditLogEntries === 'function'
    ? options.buildWebConsoleAuditLogEntries
    : (() => ({ success: true, items: [], page: 1, pageSize: 0, total: 0, totalPages: 1 }));

  function buildLogsPayload() {
    const webConsole = getWebConsoleConfig();
    if (!webConsole.exposeLogs) {
      return {
        usage: '日志暴露已关闭',
        affinity: '日志暴露已关闭',
      };
    }
    return {
      usage: readTailText(usageLogFile, webConsole.logTailLength),
      affinity: readTailText(affinityLogFile, webConsole.logTailLength),
      groupManagement: readTailText(groupManagementLogFile, webConsole.logTailLength),
    };
  }

  function requireLogsExposed(res) {
    if (getWebConsoleConfig().readOnly) {
      sendJson(res, { success: false, error: 'Read-only mode' }, 403);
      return false;
    }
    if (getWebConsoleConfig().exposeLogs) {
      return true;
    }
    sendJson(res, { success: false, error: '日志暴露已关闭' }, 403);
    return false;
  }

  function isLogExportType(type = '') {
    return new Set([
      'usage-logs',
      'affinity-logs',
      'group-management-logs',
      'image-monitor-review-logs',
      'image-monitor-meme-logs',
      'audit-logs',
      'overview-trend',
    ]).has(String(type || '').trim());
  }

  function sanitizeUsagePreviewText(value = '') {
    return String(value || '')
      .replace(/\[\[\[at:\d+\]\]\]/g, '')
      .replace(/\(\(\(at:\d+\)\)\)/g, '')
      .replace(/\(\(\(\d+\)\)\)/g, '')
      .replace(/\[\[\[poke:\d+\]\]\]/g, '')
      .replace(/\(\(\(poke:\d+\)\)\)/g, '')
      .replace(/\[\[\[reply:[^\]]+\]\]\]/g, '')
      .replace(/\(\(\(reply:[^)]+\)\)\)/g, '')
      .replace(/\[\[\[memory:[^\]]+\]\]\]/g, '')
      .replace(/\[meme:[^\]]+\]/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function isImageMonitorReviewUsage(entry = {}) {
    return normalizeUsageScene(entry) === 'image_monitor_review';
  }

  function formatUsageSceneLabel(scene = '') {
    const key = String(scene || '').trim().toLowerCase();
    const sceneMap = {
      chat: '通用对话',
      chat_text: '文本对话',
      chat_multimodal: '多模态对话',
      chat_engine: '对话引擎',
      chat_engine_fallback: '对话引擎兜底',
      chat_engine_final: '对话引擎最终回复',
      humanize_generate: '拟人化生成',
      poke_follow_reply: '戳一戳接话回复',
      poke_ai_reply: '戳一戳 AI 回复',
      poke_image_summary: '戳一戳图片摘要',
      daily_group_summary: '每日群聊总结',
      image_monitor_review: '图片监控审核',
    };
    return sceneMap[key] || (key === 'unknown' ? '未知场景' : String(scene || '').trim() || '未知场景');
  }

  function attachUsageDisplayFields(entry = {}) {
    const scene = normalizeUsageScene(entry);
    const hidePromptPreview = scene === 'image_monitor_review';
    return {
      ...entry,
      scene,
      scene_label: formatUsageSceneLabel(scene),
      prompt_preview: hidePromptPreview ? '' : entry.prompt_preview,
      display_prompt_preview: hidePromptPreview ? '' : sanitizeUsagePreviewText(entry.prompt_preview || ''),
      display_response_preview: sanitizeUsagePreviewText(entry.response_preview || ''),
    };
  }

  function buildUsageLogEntries(filters = {}) {
    const query = String(filters.query || '').trim().toLowerCase();
    const scene = String(filters.scene || '').trim().toLowerCase();
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
    const content = readTailText(usageLogFile, Math.max(50000, getWebConsoleConfig().logTailLength));
    const items = parseJsonObjects(content)
      .map((item, index) => {
        try {
          const parsed = JSON.parse(item);
          return attachUsageDisplayFields({
            ...parsed,
            id: buildEntryId('usage', parsed, index),
          });
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(item => !scene || String(item.scene || '').toLowerCase().includes(scene))
      .filter(item => {
        if (!query) return true;
        return [item.scene, item.model, item.group_id, item.user_id, item.prompt_preview, item.response_preview, item.error]
          .some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));

    return paginateItems(items, page, pageSize);
  }

  function buildAffinityLogEntries(filters = {}) {
    const query = String(filters.query || '').trim().toLowerCase();
    const groupId = String(filters.groupId || '').trim();
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
    const content = readTailText(affinityLogFile, Math.max(50000, getWebConsoleConfig().logTailLength));
    const items = parseJsonObjects(content)
      .map((item, index) => {
        try {
          const parsed = JSON.parse(item);
          return {
            ...parsed,
            id: buildEntryId('affinity', parsed, index),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(item => !groupId || String(item.group_id || '') === groupId)
      .filter(item => {
        if (!query) return true;
        return [item.group_id, item.user_id, item.reason, item.guard, item.text_preview, item.level]
          .some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));

    return paginateItems(items, page, pageSize);
  }

  function formatGroupManagementActionLabel(action = '') {
    const key = String(action || '').trim();
    const labels = {
      save_config: '保存群配置',
      toggle_feature: '切换群功能',
      update_verification: '更新入群验证',
      update_welcome: '更新入群欢迎',
      update_summary: '更新群总结',
      update_title: '更新群头衔',
      clear_auth: '恢复入群验证默认配置',
      clear_welcome: '清空入群欢迎',
      save_defaults: '保存群管理默认设置',
      save_safety: '保存群管安全开关',
      rollback_config: '回滚群配置',
      bulk_enable_groups: '批量开启群功能',
      join_request_auto_approved: '自动通过加群申请',
      join_request_auto_approve_failed: '自动通过加群申请失败',
      join_request_manual_approved: '手动同意加群申请',
      join_request_manual_approve_failed: '手动同意加群申请失败',
      join_request_manual_rejected: '手动拒绝加群申请',
      join_request_manual_reject_failed: '手动拒绝加群申请失败',
      join_request_review_kept: '保留人工审核',
      member_blacklist_added: '加入群管黑名单',
      member_whitelist_added: '加入群管白名单',
      member_warning_added: '增加成员警告积分',
      member_warning_cleared: '清空成员警告积分',
      content_moderation_triggered: '群消息风控触发',
      group_welcome_pending: '入群欢迎待发送',
      group_welcome_sent: '入群欢迎已发送',
      group_welcome_failed: '入群欢迎失败',
      daily_group_summary_sent: '每日群聊总结已发送',
      daily_group_summary_failed: '每日群聊总结失败',
      daily_group_summary_skipped: '每日群聊总结已跳过',
      daily_group_summary_manual_sent: '手动群总结已发送',
      daily_group_summary_manual_failed: '手动群总结失败',
      group_title_application_created: '提交头衔申请',
      group_title_application_cancelled: '取消头衔申请',
      group_title_ai_review_unavailable: 'AI 头衔审核不可用',
      group_title_ai_review_failed: 'AI 头衔审核失败',
      group_title_ai_review_kept: 'AI 头衔审核保留人工',
      group_title_ai_approved: 'AI 通过头衔申请',
      group_title_ai_approve_failed: 'AI 通过但发放失败',
      group_title_ai_rejected: 'AI 拒绝头衔申请',
      group_title_command_approved: '群内通过头衔申请',
      group_title_command_approve_failed: '群内发放头衔失败',
      group_title_command_rejected: '群内拒绝头衔申请',
      group_title_manual_approved: '手动通过头衔申请',
      group_title_manual_approve_failed: '手动通过头衔申请失败',
      group_title_manual_rejected: '手动拒绝头衔申请',
    };
    return labels[key] || key || '未知操作';
  }

  function attachGroupManagementLogDisplayFields(entry = {}, index = 0) {
    const action = String(entry.action || entry.type || 'unknown').trim() || 'unknown';
    return {
      ...entry,
      action,
      action_label: formatGroupManagementActionLabel(action),
      id: buildEntryId('group-management', {
        time: entry.time,
        group_id: entry.group_id || entry.groupId,
        user_id: entry.user_id || entry.userId,
        scene: action,
        model: entry.source,
      }, index),
    };
  }

  function buildGroupManagementLogEntries(filters = {}) {
    const query = String(filters.query || '').trim().toLowerCase();
    const groupId = String(filters.groupId || '').trim();
    const userId = String(filters.userId || '').trim();
    const action = String(filters.action || '').trim().toLowerCase();
    const startAt = String(filters.startAt || '').trim();
    const endAt = String(filters.endAt || '').trim();
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || getWebConsoleConfig().pageSize);
    const startTime = startAt ? new Date(startAt).getTime() : 0;
    const endTime = endAt ? new Date(endAt).getTime() : 0;
    const content = readTailText(groupManagementLogFile, Math.max(80000, getWebConsoleConfig().logTailLength));
    const items = parseJsonObjects(content)
      .map((item, index) => {
        try {
          return attachGroupManagementLogDisplayFields(JSON.parse(item), index);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(item => !groupId || String(item.group_id || item.groupId || '') === groupId)
      .filter(item => !userId || String(item.user_id || item.userId || '') === userId)
      .filter(item => !action || String(item.action || '').toLowerCase().includes(action))
      .filter(item => {
        const timeMs = new Date(item.time || 0).getTime();
        if (startTime && (!Number.isFinite(timeMs) || timeMs < startTime)) return false;
        if (endTime && (!Number.isFinite(timeMs) || timeMs > endTime)) return false;
        return true;
      })
      .filter(item => {
        if (!query) return true;
        return [
          item.action,
          item.action_label,
          item.source,
          item.group_id,
          item.user_id,
          item.nickname,
          item.reason,
          item.error,
          item.comment_preview,
          item.client_ip,
          ...(Array.isArray(item.changes) ? item.changes : []),
          ...(Array.isArray(item.sections) ? item.sections : []),
        ].some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));

    return paginateItems(items, page, pageSize);
  }

  function findUsageLogEntry(entryId) {
    const items = buildUsageLogEntries({ page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }).items;
    return items.find(item => item.id === entryId) || null;
  }

  function findAffinityLogEntry(entryId) {
    const items = buildAffinityLogEntries({ page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }).items;
    return items.find(item => item.id === entryId) || null;
  }

  function findGroupManagementLogEntry(entryId = '') {
    const id = String(entryId || '').trim();
    if (!id) return null;
    const items = buildGroupManagementLogEntries({
      page: 1,
      pageSize: getWebConsoleConfig().maxPageSize * 20,
    }).items;
    return items.find(item => item.id === id) || null;
  }

  function exportDataAsText(type, filters = {}) {
    if (type === 'profiles') {
      return JSON.stringify(buildProfilesPayload({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
    }
    if (type === 'affinity') {
      return JSON.stringify(buildAffinityListPayload({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
    }
    if (type === 'usage-logs') {
      return JSON.stringify(buildUsageLogEntries({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
    }
    if (type === 'affinity-logs') {
      return JSON.stringify(buildAffinityLogEntries({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
    }
    if (type === 'group-management-logs') {
      return JSON.stringify(buildGroupManagementLogEntries({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
    }
    if (type === 'audit-logs') {
      return JSON.stringify(buildWebConsoleAuditLogEntries({ ...filters, page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
    }
    if (type === 'image-monitor-review-logs') {
      return JSON.stringify(buildImageMonitorLogPayload({ ...filters, type: 'review', page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
    }
    if (type === 'image-monitor-meme-logs') {
      return JSON.stringify(buildImageMonitorLogPayload({ ...filters, type: 'meme', page: 1, pageSize: getWebConsoleConfig().maxPageSize * 20 }), null, 2);
    }
    if (type === 'overview-trend') {
      return JSON.stringify(buildUsageTrendPayload(), null, 2);
    }
    return JSON.stringify({ error: 'unsupported export type' }, null, 2);
  }

  return {
    buildLogsPayload,
    requireLogsExposed,
    isLogExportType,
    isImageMonitorReviewUsage,
    attachUsageDisplayFields,
    buildUsageLogEntries,
    buildAffinityLogEntries,
    attachGroupManagementLogDisplayFields,
    buildGroupManagementLogEntries,
    findUsageLogEntry,
    findAffinityLogEntry,
    findGroupManagementLogEntry,
    exportDataAsText,
  };
}
