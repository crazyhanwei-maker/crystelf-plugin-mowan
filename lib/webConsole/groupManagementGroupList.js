export function createGroupManagementGroupList(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode = 500, message = 'Internal Server Error', code = '') => {
      const error = new Error(String(message || 'Internal Server Error'));
      error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
      if (code) error.code = String(code);
      return error;
    });
  const isPlainObject = typeof options.isPlainObject === 'function'
    ? options.isPlainObject
    : (value => Boolean(value && typeof value === 'object' && !Array.isArray(value)));
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : (value => String(value || '').trim());
  const normalizeGroupIdList = typeof options.normalizeGroupIdList === 'function'
    ? options.normalizeGroupIdList
    : (value => (Array.isArray(value) ? value.map(normalizeGroupId).filter(Boolean) : []));
  const normalizeDailySummaryConfig = typeof options.normalizeDailySummaryConfig === 'function'
    ? options.normalizeDailySummaryConfig
    : (value => value || {});
  const listModerationGroupIds = typeof options.listModerationGroupIds === 'function'
    ? options.listModerationGroupIds
    : (() => []);
  const getChatSnapshot = typeof options.getChatSnapshot === 'function' ? options.getChatSnapshot : () => ({});
  const getAffinitySnapshot = typeof options.getAffinitySnapshot === 'function' ? options.getAffinitySnapshot : () => ({});
  const getConfigState = typeof options.getConfigState === 'function' ? options.getConfigState : (() => ({}));
  const buildPermissionState = typeof options.buildPermissionState === 'function' ? options.buildPermissionState : (() => ({}));
  const getModerationOverview = typeof options.getModerationOverview === 'function'
    ? options.getModerationOverview
    : (() => ({ groups: 0, blacklistUsers: 0, whitelistUsers: 0, warningUsers: 0, warningPoints: 0 }));
  const runtimeTimeoutMs = Number(options.runtimeTimeoutMs || 3500);
  const getBotRoot = typeof options.getBotRoot === 'function'
    ? options.getBotRoot
    : (() => (typeof globalThis !== 'undefined' ? globalThis.Bot : null));

  function createGroupManagementRecord(groupId = '') {
    return {
      groupId,
      name: '',
      memberCount: null,
      maxMemberCount: null,
      botRole: '',
      sources: new Set(),
    };
  }

  function readFiniteCount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
  }

  function normalizeRuntimeBotRole(value = '') {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    if (['owner', '群主', 'creator', 'master', 'host'].includes(text) || text.includes('owner') || text.includes('群主')) return 'owner';
    if (['admin', 'administrator', '管理员', 'manager'].includes(text) || text.includes('admin') || text.includes('管理员')) return 'admin';
    if (['member', '成员', 'normal', 'user'].includes(text) || text.includes('member') || text.includes('成员')) return 'member';
    return '';
  }

  function getRuntimeBotRoleRank(value = '') {
    const role = normalizeRuntimeBotRole(value);
    if (role === 'owner') return 3;
    if (role === 'admin') return 2;
    if (role === 'member') return 1;
    return 0;
  }

  function readRuntimeBotRole(...values) {
    for (const value of values) {
      const role = normalizeRuntimeBotRole(value);
      if (role) return role;
    }
    return '';
  }

  function readNestedRuntimeBotRole(raw = {}, info = {}) {
    return readRuntimeBotRole(
      raw.botRole,
      raw.bot_role,
      raw.self_role,
      raw.selfRole,
      raw.self?.role,
      raw.self?.roleLabel,
      raw.me?.role,
      raw.me?.roleLabel,
      raw.member?.role,
      raw.member?.roleLabel,
      raw.memberInfo?.role,
      raw.member_info?.role,
      info.botRole,
      info.bot_role,
      info.self_role,
      info.selfRole,
      info.self?.role,
      info.me?.role,
      info.member?.role,
      raw.role,
      info.role,
    );
  }

  function normalizeRuntimeGroupInfo(value = {}, fallbackGroupId = '', source = 'runtime') {
    const raw = isPlainObject(value) ? value : {};
    const info = isPlainObject(raw.info) ? raw.info : {};
    const groupId = normalizeGroupId(
      raw.group_id
        ?? raw.groupId
        ?? raw.gid
        ?? raw.id
        ?? info.group_id
        ?? info.groupId
        ?? fallbackGroupId,
    );
    if (!groupId) {
      return null;
    }

    return {
      groupId,
      name: String(
        raw.group_name
          ?? raw.groupName
          ?? raw.name
          ?? raw.nickname
          ?? info.group_name
          ?? info.groupName
          ?? '',
      ).trim(),
      memberCount: readFiniteCount(
        raw.member_count
          ?? raw.memberCount
          ?? raw.member_num
          ?? raw.memberNum
          ?? info.member_count
          ?? info.memberCount,
      ),
      maxMemberCount: readFiniteCount(
        raw.max_member_count
          ?? raw.maxMemberCount
          ?? info.max_member_count
          ?? info.maxMemberCount,
      ),
      botRole: readNestedRuntimeBotRole(raw, info),
      source,
    };
  }

  function upsertGroupManagementRecord(records, info = {}) {
    const groupId = normalizeGroupId(info.groupId);
    if (!groupId) {
      return;
    }
    if (!records.has(groupId)) {
      records.set(groupId, createGroupManagementRecord(groupId));
    }
    const record = records.get(groupId);
    if (info.name && !record.name) record.name = String(info.name).trim();
    if (record.memberCount == null && info.memberCount != null) record.memberCount = info.memberCount;
    if (record.maxMemberCount == null && info.maxMemberCount != null) record.maxMemberCount = info.maxMemberCount;
    if (info.botRole) {
      const nextRole = normalizeRuntimeBotRole(info.botRole);
      if (nextRole && getRuntimeBotRoleRank(nextRole) > getRuntimeBotRoleRank(record.botRole)) {
        record.botRole = nextRole;
      }
    }
    if (info.source) record.sources.add(String(info.source));
  }

  function getGroupManagementBotSelfId(bot = {}) {
    const root = getBotRoot();
    return String(
      bot.uin
        ?? bot.self_id
        ?? bot.selfId
        ?? bot.account?.uin
        ?? bot.info?.uin
        ?? bot.config?.uin
        ?? root?.uin
        ?? root?.self_id
        ?? root?.selfId
        ?? '',
    ).trim();
  }

  function toGroupManagementApiId(value = '') {
    const text = String(value || '').trim();
    if (/^\d{1,15}$/.test(text)) return Number(text);
    return text;
  }

  function pickGroupManagementMapValue(collection, key = '') {
    if (!collection) return null;
    const candidates = [key, Number(key)].filter(value => value !== '' && !Number.isNaN(value));
    if (collection instanceof Map) {
      for (const candidate of candidates) {
        if (collection.has(candidate)) return collection.get(candidate);
      }
      return null;
    }
    if (isPlainObject(collection)) {
      for (const candidate of candidates) {
        if (Object.prototype.hasOwnProperty.call(collection, candidate)) return collection[candidate];
      }
    }
    return null;
  }

  function extractGroupManagementMemberRole(value = {}) {
    const raw = isPlainObject(value) ? value : {};
    const data = isPlainObject(raw.data) ? raw.data : {};
    const nested = isPlainObject(data.data) ? data.data : {};
    return readNestedRuntimeBotRole(raw, data)
      || readNestedRuntimeBotRole(data, nested)
      || readRuntimeBotRole(nested.role, nested.self_role, nested.botRole);
  }

  function resolveGroupManagementPickedRole(bot = {}, groupId = '') {
    const selfId = getGroupManagementBotSelfId(bot);
    let group = null;
    try {
      if (typeof bot.pickGroup === 'function') {
        group = bot.pickGroup(toGroupManagementApiId(groupId));
      }
    } catch {
      group = null;
    }
    if (!group) {
      group = pickGroupManagementMapValue(bot.gl, groupId)
        || pickGroupManagementMapValue(bot.gml, groupId)
        || pickGroupManagementMapValue(bot.groupList, groupId)
        || pickGroupManagementMapValue(bot.groups, groupId);
    }
    const groupRole = extractGroupManagementMemberRole(group);
    if (groupRole) return groupRole;
    if (!group || !selfId) return '';

    try {
      if (typeof group.pickMember === 'function') {
        const member = group.pickMember(toGroupManagementApiId(selfId));
        const role = extractGroupManagementMemberRole(member);
        if (role) return role;
      }
    } catch {
      // Runtime adapters differ; fall through to cached member maps.
    }

    const member = pickGroupManagementMapValue(group.members, selfId)
      || pickGroupManagementMapValue(group.memberList, selfId)
      || pickGroupManagementMapValue(group.ml, selfId)
      || pickGroupManagementMapValue(group.gml, selfId);
    return extractGroupManagementMemberRole(member);
  }

  async function resolveGroupManagementApiRole(bot = {}, groupId = '') {
    const selfId = getGroupManagementBotSelfId(bot);
    if (!selfId || typeof bot.sendApi !== 'function') return '';
    try {
      const result = await withGroupManagementTimeout(bot.sendApi('get_group_member_info', {
        group_id: toGroupManagementApiId(groupId),
        user_id: toGroupManagementApiId(selfId),
        no_cache: true,
      }), `get_group_member_info:${groupId}`);
      return extractGroupManagementMemberRole(result);
    } catch {
      return '';
    }
  }

  async function enrichGroupManagementBotRoles(records = new Map(), bots = []) {
    for (const record of records.values()) {
      if (getRuntimeBotRoleRank(record.botRole) >= getRuntimeBotRoleRank('owner')) {
        continue;
      }
      for (const bot of bots) {
        const pickedRole = resolveGroupManagementPickedRole(bot, record.groupId);
        if (pickedRole) {
          upsertGroupManagementRecord(records, {
            groupId: record.groupId,
            botRole: pickedRole,
            source: 'runtime.selfRole',
          });
          if (getRuntimeBotRoleRank(pickedRole) >= getRuntimeBotRoleRank('owner')) break;
        }
        const apiRole = await resolveGroupManagementApiRole(bot, record.groupId);
        if (apiRole) {
          upsertGroupManagementRecord(records, {
            groupId: record.groupId,
            botRole: apiRole,
            source: 'runtime.selfRole',
          });
          if (getRuntimeBotRoleRank(apiRole) >= getRuntimeBotRoleRank('owner')) break;
        }
      }
    }
  }

  function readGroupCollectionItems(collection) {
    if (!collection) {
      return [];
    }
    if (collection instanceof Map) {
      return Array.from(collection.entries()).map(([key, value]) => ({ key, value }));
    }
    if (Array.isArray(collection)) {
      return collection.map(value => ({ key: '', value }));
    }
    if (isPlainObject(collection)) {
      return Object.entries(collection).map(([key, value]) => ({ key, value }));
    }
    return [];
  }

  function collectGroupInfosFromCollection(collection, source = 'runtime') {
    const result = [];
    for (const item of readGroupCollectionItems(collection)) {
      const rawValue = isPlainObject(item.value) ? item.value : {};
      const info = normalizeRuntimeGroupInfo(rawValue, item.key, source);
      if (info) {
        result.push(info);
      }
    }
    return result;
  }

  function getBotInstancesForGroupManagement() {
    const root = getBotRoot();
    const result = [];
    const seen = new Set();

    const add = (candidate) => {
      if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) {
        return;
      }
      seen.add(candidate);
      if (
        typeof candidate.pickGroup === 'function'
        || typeof candidate.sendApi === 'function'
        || typeof candidate.getGroupList === 'function'
        || candidate.gl
        || candidate.gml
        || candidate.groupList
        || candidate.groups
      ) {
        result.push(candidate);
      }
    };

    add(root);
    for (const field of ['bots', 'clients', 'uin']) {
      const value = root?.[field];
      if (value instanceof Map) {
        for (const item of value.values()) add(item);
      } else if (Array.isArray(value) || value instanceof Set) {
        for (const item of value) add(item);
      } else if (isPlainObject(value)) {
        for (const item of Object.values(value)) add(item);
      }
    }

    return result;
  }

  async function withGroupManagementTimeout(promiseLike, label = 'runtime') {
    let timeoutHandle = null;
    try {
      return await Promise.race([
        Promise.resolve(promiseLike),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(createHttpError(504, `${label} 查询超时`, 'GROUP_RUNTIME_TIMEOUT'));
          }, runtimeTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  function extractRuntimeListResult(result) {
    if (Array.isArray(result) || result instanceof Map) {
      return result;
    }
    if (isPlainObject(result)) {
      if (Array.isArray(result.data) || result.data instanceof Map) return result.data;
      if (Array.isArray(result.data?.data) || result.data?.data instanceof Map) return result.data.data;
      if (Array.isArray(result.data?.groups) || result.data?.groups instanceof Map) return result.data.groups;
      if (Array.isArray(result.groups) || result.groups instanceof Map) return result.groups;
      if (isPlainObject(result.data)) return result.data;
      return result;
    }
    return [];
  }

  async function collectRuntimeGroupManagementGroups() {
    const bots = getBotInstancesForGroupManagement();
    const records = new Map();
    const errors = [];

    for (const bot of bots) {
      for (const field of ['gl', 'gml', 'groupList', 'groups']) {
        for (const info of collectGroupInfosFromCollection(bot[field], `runtime.${field}`)) {
          upsertGroupManagementRecord(records, info);
        }
      }

      if (typeof bot.getGroupList === 'function') {
        try {
          const result = await withGroupManagementTimeout(bot.getGroupList(), 'getGroupList');
          for (const info of collectGroupInfosFromCollection(extractRuntimeListResult(result), 'runtime.getGroupList')) {
            upsertGroupManagementRecord(records, info);
          }
        } catch (error) {
          errors.push(`getGroupList: ${error.message}`);
        }
      }

      if (typeof bot.sendApi === 'function') {
        try {
          const result = await withGroupManagementTimeout(bot.sendApi('get_group_list', {}), 'get_group_list');
          for (const info of collectGroupInfosFromCollection(extractRuntimeListResult(result), 'runtime.get_group_list')) {
            upsertGroupManagementRecord(records, info);
          }
        } catch (error) {
          errors.push(`get_group_list: ${error.message}`);
        }
      }
    }

    await enrichGroupManagementBotRoles(records, bots);

    return {
      records,
      status: {
        botAvailable: bots.length > 0,
        groupCount: records.size,
        warnings: errors.slice(0, 5),
      },
    };
  }

  function collectConfiguredGroupManagementGroups(allConfigs = {}) {
    const records = new Map();
    const aiConfig = allConfigs.ai || {};
    const dailySummaryConfig = normalizeDailySummaryConfig(aiConfig.dailyGroupSummary || {});
    const imageMonitorConfig = allConfigs.imageMonitor || {};
    const authConfig = allConfigs.auth || {};
    const newcomerConfig = allConfigs.newcomer || {};

    for (const [field, source] of [
      [aiConfig.blockGroup, 'ai.blockGroup'],
      [aiConfig.whiteGroup, 'ai.whiteGroup'],
      [dailySummaryConfig.enabledGroups, 'ai.dailyGroupSummary.enabledGroups'],
      [dailySummaryConfig.blockedGroups, 'ai.dailyGroupSummary.blockedGroups'],
      [imageMonitorConfig.allowedGroups, 'imageMonitor.allowedGroups'],
      [imageMonitorConfig.blockedGroups, 'imageMonitor.blockedGroups'],
      [Object.keys(isPlainObject(authConfig.groups) ? authConfig.groups : {}), 'auth.groups'],
      [Object.keys(isPlainObject(newcomerConfig) ? newcomerConfig : {}), 'newcomer'],
      [listModerationGroupIds(), 'groupManagement.moderation'],
    ]) {
      for (const groupId of normalizeGroupIdList(field)) {
        upsertGroupManagementRecord(records, { groupId, source });
      }
    }

    const chat = getChatSnapshot();
    const chatItems = [
      ...(Array.isArray(chat.sessions) ? chat.sessions : []),
      ...(Array.isArray(chat.messages) ? chat.messages : []),
    ];
    for (const item of chatItems) {
      const groupId = normalizeGroupId(item?.groupId ?? item?.group_id ?? (item?.type === 'group' ? item?.targetId : ''));
      if (groupId) {
        upsertGroupManagementRecord(records, {
          groupId,
          name: String(item?.groupName || item?.group_name || '').trim(),
          source: 'chat',
        });
      }
    }

    const affinity = getAffinitySnapshot();
    for (const groupId of Object.keys(isPlainObject(affinity) ? affinity : {})) {
      const normalized = normalizeGroupId(groupId);
      if (normalized) {
        upsertGroupManagementRecord(records, { groupId: normalized, source: 'affinity' });
      }
    }

    return records;
  }

  function mergeGroupManagementRecords(...recordMaps) {
    const merged = new Map();
    for (const records of recordMaps) {
      for (const record of records.values()) {
        upsertGroupManagementRecord(merged, {
          ...record,
          source: '',
        });
        const next = merged.get(record.groupId);
        for (const source of record.sources || []) {
          next.sources.add(source);
        }
      }
    }
    return merged;
  }

  function serializeGroupManagementRecord(record = {}, allConfigs = {}) {
    const sources = Array.from(record.sources || []);
    const configState = getConfigState(record.groupId, allConfigs);
    return {
      groupId: record.groupId,
      name: record.name || '',
      displayName: record.name || `群 ${record.groupId}`,
      memberCount: record.memberCount,
      maxMemberCount: record.maxMemberCount,
      botRole: record.botRole || '',
      permissions: buildPermissionState(record),
      sources,
      sourceText: sources.length > 0 ? sources.join(', ') : 'manual',
      config: configState,
    };
  }

  function getGroupManagementListSummary(groups = [], allConfigs = {}) {
    const aiConfig = allConfigs.ai || {};
    const dailySummaryConfig = normalizeDailySummaryConfig(aiConfig.dailyGroupSummary || {});
    const imageMonitorConfig = allConfigs.imageMonitor || {};
    const authConfig = allConfigs.auth || {};
    const moderationOverview = getModerationOverview();
    const authCustomGroupCount = Object.keys(isPlainObject(authConfig.groups) ? authConfig.groups : {}).filter(normalizeGroupId).length;
    const authEnabledGroupCount = groups.filter(item => item.config?.auth?.config?.enable === true).length;
    const welcomeEnabledGroupCount = groups.filter(item => item.config?.welcome?.enabled === true).length;
    const contentEnabledGroupCount = groups.filter(item => item.config?.moderation?.content?.enabled === true).length;

    return {
      groups: groups.length,
      runtimeGroups: groups.filter(item => (item.sources || []).some(source => source.startsWith('runtime'))).length,
      aiBlocked: normalizeGroupIdList(aiConfig.blockGroup).length,
      aiWhitelisted: normalizeGroupIdList(aiConfig.whiteGroup).length,
      dailySummaryEnabled: dailySummaryConfig.targetMode === 'all'
        ? groups.filter(item => item.config?.dailySummary?.effectiveEnabled === true).length
        : normalizeGroupIdList(dailySummaryConfig.enabledGroups).length,
      dailySummaryBlocked: normalizeGroupIdList(dailySummaryConfig.blockedGroups).length,
      imageAllowed: normalizeGroupIdList(imageMonitorConfig.allowedGroups).length,
      imageBlocked: normalizeGroupIdList(imageMonitorConfig.blockedGroups).length,
      authCustomGroups: authEnabledGroupCount,
      authCustomGroupCount,
      autoApproveGroups: groups.filter(item => item.config?.auth?.config?.autoApprove?.enable === true).length,
      welcomeGroups: welcomeEnabledGroupCount,
      moderationGroups: moderationOverview.groups,
      moderationBlacklistUsers: moderationOverview.blacklistUsers,
      moderationWhitelistUsers: moderationOverview.whitelistUsers,
      moderationWarningUsers: moderationOverview.warningUsers,
      moderationWarningPoints: moderationOverview.warningPoints,
      moderationContentEnabledGroups: contentEnabledGroupCount,
    };
  }

  return {
    upsertGroupManagementRecord,
    readGroupCollectionItems,
    getBotInstancesForGroupManagement,
    withGroupManagementTimeout,
    extractRuntimeListResult,
    collectRuntimeGroupManagementGroups,
    collectConfiguredGroupManagementGroups,
    mergeGroupManagementRecords,
    serializeGroupManagementRecord,
    getGroupManagementListSummary,
  };
}
