export const IMAGE_MODE_ARK_AGENT_PLAN = 'ark-agent-plan';
export { IMAGE_MODE_SD_WEBUI, isSdWebUiImageMode } from './sdWebUiApi.js';

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function isArkAgentPlanImageMode(value = '') {
  return String(value || '').trim().toLowerCase() === IMAGE_MODE_ARK_AGENT_PLAN;
}

export function supportsImageOperation(imageMode = '', operation = 'generate') {
  const normalizedMode = String(imageMode || '').trim().toLowerCase();
  const normalizedOperation = String(operation || 'generate').trim().toLowerCase();
  const capabilities = {
    openai: ['generate', 'edit'],
    chat: ['generate', 'edit'],
    jimeng: ['generate', 'edit'],
    [IMAGE_MODE_ARK_AGENT_PLAN]: ['generate', 'edit'],
    'sd-webui': ['generate', 'edit'],
  };
  return (capabilities[normalizedMode] || ['generate', 'edit']).includes(normalizedOperation);
}

export function normalizeImageSizeValue(value = '') {
  const raw = String(value || '').trim().replace(/\s+/g, '');
  if (!raw || raw.toLowerCase() === 'auto') return '';
  if (/^[234]k$/i.test(raw)) return raw.toUpperCase();
  return raw.toLowerCase();
}

export function buildArkAgentPlanImageUrl(baseApi = '') {
  const base = normalizeBaseUrl(baseApi);
  if (!base) return '';
  if (/\/images\/generations$/i.test(base)) return base;
  return `${base}/images/generations`;
}

export function buildArkAgentPlanImageRequest(prompt = '', config = {}, sourceImages = []) {
  const body = {
    model: String(config.model || 'doubao-seedream-5.0-lite').trim(),
    prompt: String(prompt || ''),
    output_format: String(config.outputFormat || 'png').trim().toLowerCase(),
    response_format: String(config.responseFormat || 'url').trim().toLowerCase(),
    watermark: config.watermark === true,
  };
  if (config.webSearch === true) {
    body.tools = [{ type: 'web_search' }];
  }
  const normalizedImages = (Array.isArray(sourceImages) ? sourceImages : [sourceImages])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 14);
  if (normalizedImages.length === 1) body.image = normalizedImages[0];
  if (normalizedImages.length > 1) body.image = normalizedImages;
  const size = normalizeImageSizeValue(config.size || '2K');
  if (size) body.size = size;
  return body;
}
