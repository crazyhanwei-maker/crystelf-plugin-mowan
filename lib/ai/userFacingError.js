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
