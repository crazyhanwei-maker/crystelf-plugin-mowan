export const IMAGE_MODE_ARK_AGENT_PLAN = 'ark-agent-plan';
export const IMAGE_MODE_SENSENOVA = 'sensenova';
export { IMAGE_MODE_SD_WEBUI, isSdWebUiImageMode } from './sdWebUiApi.js';

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function isArkAgentPlanImageMode(value = '') {
  return String(value || '').trim().toLowerCase() === IMAGE_MODE_ARK_AGENT_PLAN;
}

export function isSenseNovaImageMode(value = '') {
  return String(value || '').trim().toLowerCase() === IMAGE_MODE_SENSENOVA;
}

export function supportsImageOperation(imageMode = '', operation = 'generate') {
  const normalizedMode = String(imageMode || '').trim().toLowerCase();
  const normalizedOperation = String(operation || 'generate').trim().toLowerCase();
  const capabilities = {
    openai: ['generate', 'edit'],
    chat: ['generate', 'edit'],
    jimeng: ['generate', 'edit'],
    [IMAGE_MODE_ARK_AGENT_PLAN]: ['generate', 'edit'],
    [IMAGE_MODE_SENSENOVA]: ['generate', 'edit'],
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

//SenseNova U1.5 系列生图地址：baseApi 末尾 /v1 可带可不带，最终统一拼 /v1/images/{generations,edits}
export function buildSenseNovaImageUrl(baseApi = '', operation = 'generate') {
  const base = normalizeBaseUrl(baseApi).replace(/\/v1$/i, '');
  if (!base) return '';
  if (/\/images\/generations$/i.test(base)) return base;
  if (/\/images\/edits$/i.test(base)) return base;
  return `${base}${String(operation).trim().toLowerCase() === 'edit' ? '/v1/images/edits' : '/v1/images/generations'}`;
}

//SenseNova 生成与编辑都是 JSON body：编辑用 images[].image_url（公网 URL 或 data:base64），最多 5 张
export function buildSenseNovaImageRequest(prompt = '', config = {}, sourceImages = []) {
  const responseFormat = String(config.responseFormat || 'b64_json').trim().toLowerCase();
  const outputFormat = String(config.outputFormat || 'png').trim().toLowerCase();
  const body = {
    model: String(config.model || 'sensenova-u1.5-lite').trim(),
    prompt: String(prompt || ''),
    n: 1,
    response_format: responseFormat === 'url' ? 'url' : 'b64_json',
    output_format: ['png', 'jpeg', 'jpg', 'webp'].includes(outputFormat) ? outputFormat : 'png',
    //文档默认 true 且公测后可能改默认值，按文档建议总是显式下发
    watermark: config.watermark === true,
  };
  const size = normalizeImageSizeValue(config.size || 'auto');
  if (size) body.size = size;
  const normalizedImages = (Array.isArray(sourceImages) ? sourceImages : [sourceImages])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 5);
  if (normalizedImages.length) {
    body.images = normalizedImages.map(imageUrl => ({ image_url: imageUrl }));
  }
  return body;
}
