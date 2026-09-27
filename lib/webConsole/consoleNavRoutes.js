// 控制台侧边栏导航配置：隐藏指定导航项 + 自定义外部链接。
// 存储在 ConfigControl 'config' 的 consoleNav 键，所有设备共享同一套。
import { createRouteUtils } from './routeUtils.js';

const MAX_HIDDEN = 100;
const MAX_CUSTOM_LINKS = 30;
const MAX_LABEL_LENGTH = 40;
const MAX_URL_LENGTH = 500;

function normalizeNavConfig(raw = {}) {
  const hidden = Array.isArray(raw?.hidden)
    ? raw.hidden.map(value => String(value || '').trim()).filter(Boolean).slice(0, MAX_HIDDEN)
    : [];
  const custom = (Array.isArray(raw?.custom) ? raw.custom : [])
    .slice(0, MAX_CUSTOM_LINKS)
    .map(item => ({
      label: String(item?.label || '').trim().slice(0, MAX_LABEL_LENGTH),
      url: String(item?.url || '').trim().slice(0, MAX_URL_LENGTH),
    }))
    .filter(item => item.label && /^https?:\/\//i.test(item.url));
  return { hidden, custom };
}

export function createConsoleNavRoutes(options = {}) {
  const { ConfigControl, parseRequestBody, sendJson } = options;
  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  function readNavConfig() {
    let raw = {};
    try {
      raw = ConfigControl.get('config')?.consoleNav || {};
    } catch {
      raw = {};
    }
    return normalizeNavConfig(raw);
  }

  function writeNavConfig(payload = {}) {
    const config = ConfigControl.get('config') || {};
    ConfigControl.set('config', { ...config, consoleNav: normalizeNavConfig(payload) });
    return readNavConfig();
  }

  async function handle(req, res, url) {
    if (url.pathname !== '/api/console-nav') return false;
    if (req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, { success: true, consoleNav: writeNavConfig(body) });
      } catch (error) {
        sendRouteError(res, error, 500);
      }
      return true;
    }
    sendJson(res, { success: true, consoleNav: readNavConfig() });
    return true;
  }

  return { handle };
}
