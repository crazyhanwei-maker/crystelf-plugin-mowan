export const IMAGE_MODE_SD_WEBUI = 'sd-webui';

function cleanString(value = '') {
  return String(value || '').trim();
}

function normalizeBaseUrl(value = '') {
  return cleanString(value).replace(/\/+$/, '');
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeDimension(value, fallback) {
  const normalized = clampInteger(value, fallback, 64, 4096);
  return Math.max(64, Math.round(normalized / 8) * 8);
}

export function isSdWebUiImageMode(value = '') {
  return cleanString(value).toLowerCase() === IMAGE_MODE_SD_WEBUI;
}

export function buildSdWebUiApiUrl(baseApi = '', endpoint = '') {
  const base = normalizeBaseUrl(baseApi);
  if (!base) return '';
  const path = `/${cleanString(endpoint).replace(/^\/+/, '')}`;
  return `${base}${path}`;
}

export function buildSdWebUiAuthHeaders(config = {}) {
  const settings = config.sdWebUi || config;
  const username = cleanString(settings.username);
  const password = cleanString(settings.password);
  if (!username && !password) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`,
  };
}

export function normalizeSdWebUiSettings(config = {}) {
  const settings = config.sdWebUi || {};
  return {
    baseApi: normalizeBaseUrl(settings.baseApi || config.baseApi),
    model: cleanString(settings.model || config.model),
    username: cleanString(settings.username),
    password: cleanString(settings.password),
    samplerName: cleanString(settings.samplerName || 'DPM++ 2M'),
    scheduler: cleanString(settings.scheduler || 'Karras'),
    steps: clampInteger(settings.steps, 20, 1, 150),
    cfgScale: clampNumber(settings.cfgScale, 7, 1, 30),
    width: normalizeDimension(settings.width, 1024),
    height: normalizeDimension(settings.height, 1024),
    negativePrompt: cleanString(settings.negativePrompt),
    seed: clampInteger(settings.seed, -1, -1, 2147483647),
    denoisingStrength: clampNumber(settings.denoisingStrength, 0.7, 0, 1),
  };
}

export function buildSdWebUiRequest(prompt = '', config = {}, initImageBase64 = '') {
  const settings = normalizeSdWebUiSettings(config);
  const body = {
    prompt: String(prompt || ''),
    negative_prompt: settings.negativePrompt,
    sampler_name: settings.samplerName,
    steps: settings.steps,
    cfg_scale: settings.cfgScale,
    width: settings.width,
    height: settings.height,
    seed: settings.seed,
    batch_size: 1,
    n_iter: 1,
    save_images: false,
    send_images: true,
  };

  if (settings.scheduler) body.scheduler = settings.scheduler;
  if (settings.model) {
    body.override_settings = { sd_model_checkpoint: settings.model };
    body.override_settings_restore_afterwards = true;
  }
  if (initImageBase64) {
    body.init_images = [String(initImageBase64).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')];
    body.denoising_strength = settings.denoisingStrength;
  }
  return body;
}
