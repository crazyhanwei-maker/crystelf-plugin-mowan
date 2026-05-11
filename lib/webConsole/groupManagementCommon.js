export function createGroupManagementCommon(options = {}) {
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode = 500, message = 'Internal Server Error', code = '') => {
        const error = new Error(String(message || 'Internal Server Error'));
        error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
        if (code) error.code = String(code);
        return error;
      });

  function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function normalizeGroupManagementId(value) {
    const text = String(value ?? '').trim();
    if (!/^\d{5,20}$/.test(text)) {
      throw createHttpError(400, '群号必须是 5-20 位数字', 'GROUP_ID_INVALID');
    }
    return text;
  }

  function normalizeGroupIdValue(value) {
    const text = String(value ?? '').trim();
    return /^\d{5,20}$/.test(text) ? text : '';
  }

  function normalizeGroupIdList(value = []) {
    const source = Array.isArray(value) ? value : [];
    const ids = source.map(normalizeGroupIdValue).filter(Boolean);
    return Array.from(new Set(ids));
  }

  function updateGroupIdList(value = [], groupId = '', enabled = false) {
    const normalizedGroupId = normalizeGroupManagementId(groupId);
    const set = new Set(normalizeGroupIdList(value));
    if (enabled) {
      set.add(normalizedGroupId);
    } else {
      set.delete(normalizedGroupId);
    }
    return Array.from(set);
  }

  function optionalBoolean(value) {
    if (value === undefined) return undefined;
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return undefined;
  }

  function readBoolean(value, fallback = false) {
    const normalized = optionalBoolean(value);
    return normalized === undefined ? fallback : normalized;
  }

  function normalizeIntegerInRange(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }

  return {
    isPlainObject,
    normalizeGroupManagementId,
    normalizeGroupIdValue,
    normalizeGroupIdList,
    updateGroupIdList,
    optionalBoolean,
    readBoolean,
    normalizeIntegerInRange,
  };
}
