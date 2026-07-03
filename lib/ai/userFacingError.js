const HIDDEN_AI_FAILURE_PATTERNS = [
  /(?:备用)?模型没有产出可(?:用|发送)内容/i,
];

export function shouldHideAiFailureReason(reason = '') {
  const text = String(reason || '').trim();
  if (!text) {
    return false;
  }

  return HIDDEN_AI_FAILURE_PATTERNS.some(pattern => pattern.test(text));
}

export function getErrorMessage(error = '') {
  if (error instanceof Error) {
    return String(error.message || '').trim();
  }
  if (typeof error === 'string') {
    return error.trim();
  }
  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return String(error.message || '').trim();
  }
  return String(error || '').trim();
}

export function isGroupContext(e = {}) {
  return Boolean(e?.isGroup || e?.group_id || e?.groupId || e?.gid);
}

export function buildUserFacingErrorReply(e = {}, {
  groupMessage = '',
  prefix = '操作失败',
  error = '',
  fallbackMessage = '',
  hideDetailedReason = false,
} = {}) {
  const reason = getErrorMessage(error);
  const genericMessage = String(groupMessage || fallbackMessage || `${prefix}，请稍后重试。`).trim() || '操作失败，请稍后重试。';
  if (isGroupContext(e)) {
    return genericMessage;
  }
  if (!reason) {
    return String(fallbackMessage || genericMessage).trim() || genericMessage;
  }
  if (hideDetailedReason || shouldHideAiFailureReason(reason)) {
    return String(fallbackMessage || genericMessage).trim() || genericMessage;
  }
  return `${prefix}：${reason}`;
}
