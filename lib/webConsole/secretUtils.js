export function createSecretUtils(options = {}) {
  const maskedValue = String(options.maskedValue || '******');
  const placeholderValues = new Set(
    (Array.isArray(options.placeholderValues) && options.placeholderValues.length > 0
      ? options.placeholderValues
      : ['your-api-key', 'your api key'])
      .map(item => String(item || '').trim().toLowerCase())
      .filter(Boolean),
  );

  function isPlaceholderSecret(value = '') {
    return placeholderValues.has(String(value || '').trim().toLowerCase());
  }

  function hasConfiguredSecret(value = '') {
    const trimmed = String(value || '').trim();
    return Boolean(trimmed) && !isPlaceholderSecret(trimmed);
  }

  function maskSecretValue(value = '') {
    return hasConfiguredSecret(value) ? maskedValue : '';
  }

  return {
    isPlaceholderSecret,
    hasConfiguredSecret,
    maskSecretValue,
  };
}
