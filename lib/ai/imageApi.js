export const IMAGE_MODE_ARK_AGENT_PLAN = 'ark-agent-plan';

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function isArkAgentPlanImageMode(value = '') {
  return String(value || '').trim().toLowerCase() === IMAGE_MODE_ARK_AGENT_PLAN;
}

export function normalizeImageSizeValue(value = '') {
  const raw = String(value || '').trim().replace(/\s+/g, '');
  if (!raw || raw.toLowerCase() === 'auto') return '';
  if (/^[124]k$/i.test(raw)) return raw.toUpperCase();
  return raw.toLowerCase();
}

export function buildArkAgentPlanImageUrl(baseApi = '') {
  const base = normalizeBaseUrl(baseApi);
  if (!base) return '';
  if (/\/images\/generations$/i.test(base)) return base;
  return `${base}/images/generations`;
}

export function buildArkAgentPlanImageRequest(prompt = '', config = {}) {
  const body = {
    model: String(config.model || 'doubao-seedream-5.0-lite').trim(),
    prompt: String(prompt || ''),
    output_format: String(config.outputFormat || 'png').trim().toLowerCase(),
    response_format: String(config.responseFormat || 'url').trim().toLowerCase(),
    watermark: config.watermark === true,
  };
  const size = normalizeImageSizeValue(config.size || '2K');
  if (size) body.size = size;
  return body;
}
