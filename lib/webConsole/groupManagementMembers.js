export function createGroupManagementMembers(options = {}) {
  const normalizeGroupId = typeof options.normalizeGroupId === 'function'
    ? options.normalizeGroupId
    : (value => String(value || '').trim());
  const readGroupCollectionItems = typeof options.readGroupCollectionItems === 'function'
    ? options.readGroupCollectionItems
    : (() => []);
  const getBotInstances = typeof options.getBotInstances === 'function'
    ? options.getBotInstances
    : (() => []);
  const withTimeout = typeof options.withTimeout === 'function'
    ? options.withTimeout
    : (promiseLike => Promise.resolve(promiseLike));
  const extractRuntimeListResult = typeof options.extractRuntimeListResult === 'function'
    ? options.extractRuntimeListResult
    : (value => value || []);
  const paginateItems = typeof options.paginateItems === 'function'
    ? options.paginateItems
    : ((items = []) => ({ items, page: 1, pageSize: items.length, total: items.length, totalPages: 1 }));
  const getPageSize = typeof options.getPageSize === 'function' ? options.getPageSize : () => 20;
  const memberLimit = Number(options.memberLimit || 500);
  const isPlainObject = typeof options.isPlainObject === 'function'
    ? options.isPlainObject
    : (value => Boolean(value && typeof value === 'object' && !Array.isArray(value)));

  function normalizeMemberInfo(value = {}, fallbackUserId = '') {
    const raw = isPlainObject(value) ? value : {};
    const info = isPlainObject(raw.info) ? raw.info : {};
    const userId = String(
      raw.user_id
        ?? raw.userId
        ?? raw.uid
        ?? raw.id
        ?? info.user_id
        ?? info.userId
        ?? fallbackUserId
        ?? '',
    ).trim();
    if (!/^\d{5,20}$/.test(userId)) {
      return null;
    }
    return {
      userId,
      nickname: String(raw.nickname ?? raw.nickName ?? raw.name ?? info.nickname ?? '').trim(),
      card: String(raw.card ?? raw.group_card ?? raw.title ?? info.card ?? '').trim(),
      role: String(raw.role ?? info.role ?? 'member').trim() || 'member',
      joinTime: Number(raw.join_time ?? raw.joinTime ?? info.join_time ?? 0) || 0,
      lastSentTime: Number(raw.last_sent_time ?? raw.lastSentTime ?? info.last_sent_time ?? 0) || 0,
    };
  }

  function collectMembersFromCollection(collection) {
    const result = [];
    for (const item of readGroupCollectionItems(collection)) {
      const member = normalizeMemberInfo(item.value, item.key);
      if (member) {
        result.push(member);
      }
    }
    return result;
  }

  async function pickRuntimeGroup(groupId = '') {
    const normalizedGroupId = normalizeGroupId(groupId);
    for (const bot of getBotInstances()) {
      if (typeof bot.pickGroup === 'function') {
        try {
          const group = bot.pickGroup(Number(normalizedGroupId)) || bot.pickGroup(normalizedGroupId);
          if (group) {
            return { bot, group };
          }
        } catch {
          // Try the next runtime instance.
        }
      }
    }
    return { bot: null, group: null };
  }

  async function collectRuntimeMembers(groupId = '') {
    const normalizedGroupId = normalizeGroupId(groupId);
    const { bot, group } = await pickRuntimeGroup(normalizedGroupId);
    const errors = [];

    if (group) {
      for (const field of ['memberMap', 'members', 'ml']) {
        const members = collectMembersFromCollection(group[field]);
        if (members.length > 0) {
          return { members, source: `group.${field}`, warnings: [] };
        }
      }

      for (const method of ['getMemberMap', 'getMemberList']) {
        if (typeof group[method] === 'function') {
          try {
            const result = await withTimeout(group[method](), method);
            const members = collectMembersFromCollection(extractRuntimeListResult(result));
            if (members.length > 0) {
              return { members, source: `group.${method}`, warnings: [] };
            }
          } catch (error) {
            errors.push(`${method}: ${error.message}`);
          }
        }
      }
    }

    const apiBot = bot || getBotInstances().find(item => typeof item.sendApi === 'function');
    if (typeof apiBot?.sendApi === 'function') {
      try {
        const result = await withTimeout(
          apiBot.sendApi('get_group_member_list', { group_id: Number(normalizedGroupId) }),
          'get_group_member_list',
        );
        const members = collectMembersFromCollection(extractRuntimeListResult(result));
        return { members, source: 'sendApi.get_group_member_list', warnings: errors };
      } catch (error) {
        errors.push(`get_group_member_list: ${error.message}`);
      }
    }

    return { members: [], source: '', warnings: errors };
  }

  async function buildPayload(query = {}) {
    const groupId = normalizeGroupId(query.groupId);
    const memberResult = await collectRuntimeMembers(groupId);
    const queryText = String(query.query || '').trim().toLowerCase();
    const filtered = memberResult.members
      .filter((item) => {
        if (!queryText) return true;
        return [item.userId, item.nickname, item.card, item.role]
          .some(value => String(value || '').toLowerCase().includes(queryText));
      })
      .slice(0, memberLimit);
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || getPageSize());

    return {
      success: true,
      groupId,
      source: memberResult.source,
      warnings: memberResult.warnings || [],
      limited: memberResult.members.length > memberLimit,
      ...paginateItems(filtered, page, pageSize),
    };
  }

  return {
    normalizeMemberInfo,
    collectMembersFromCollection,
    pickRuntimeGroup,
    collectRuntimeMembers,
    buildPayload,
  };
}
