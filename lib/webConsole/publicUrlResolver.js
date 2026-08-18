import net from 'net';
import os from 'os';
import {
  buildWebConsoleConfig,
  getWebConsoleDisplayUrl,
} from './webConsoleConfig.js';

const PUBLIC_IP_PROVIDERS = Object.freeze([
  { name: 'ipify', url: 'https://api.ipify.org?format=json', json: true },
  { name: 'ifconfig.me', url: 'https://ifconfig.me/ip', json: false },
  { name: 'ipify-v6', url: 'https://api64.ipify.org?format=json', json: true },
  { name: 'icanhazip', url: 'https://icanhazip.com', json: false },
]);
const PUBLIC_IP_TIMEOUT_MS = 3500;
const PUBLIC_IP_CACHE_TTL_MS = 5 * 60 * 1000;
let publicIpCache = null;
let publicIpCacheAt = 0;
let publicIpInFlight = null;

export function normalizeWebConsoleBaseUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}
function normalizeAddress(value = '') {
  return String(value || '')
    .trim()
    .replace(/^\[|\]$/g, '');
}

function stripIpv6Zone(address = '') {
  return normalizeAddress(address).split('%')[0].toLowerCase();
}

function classifyIpv4(address = '') {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  const [a, b] = parts;
  if (a === 0 || a === 127 || a >= 224) return { usable: false, public: false, score: 0 };
  if (a === 169 && b === 254) return { usable: false, public: false, score: 0 };
  if (
    a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
  ) {
    return { usable: true, public: false, score: 300 };
  }
  return { usable: true, public: true, score: 520 };
}

function classifyIpv6(address = '') {
  const normalized = stripIpv6Zone(address);
  if (!normalized || normalized === '::' || normalized === '::1') {
    return { usable: false, public: false, score: 0 };
  }
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return { usable: false, public: false, score: 0 };
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return { usable: true, public: false, score: 260 };
  }
  if (normalized.startsWith('2001:db8')) {
    return { usable: false, public: false, score: 0 };
  }
  const firstBlock = Number.parseInt(normalized.split(':')[0] || '0', 16);
  if (firstBlock >= 0x2000 && firstBlock <= 0x3fff) {
    return { usable: true, public: true, score: 500 };
  }
  return { usable: true, public: false, score: 220 };
}

function classifyAddress(address = '', internal = false) {
  if (internal) return { usable: false, public: false, score: 0, family: 0 };
  const normalized = normalizeAddress(address);
  const family = net.isIP(stripIpv6Zone(normalized));
  if (family === 4) return { ...classifyIpv4(normalized), family };
  if (family === 6) return { ...classifyIpv6(normalized), family };
  return { usable: false, public: false, score: 0, family: 0 };
}

function formatAddressForUrl(address = '') {
  const normalized = normalizeAddress(address);
  if (net.isIP(stripIpv6Zone(normalized)) === 6) {
    return `[${normalized.replace(/%/g, '%25')}]`;
  }
  return normalized;
}

function buildAddressBaseUrl(address = '', port = 27891, protocol = 'http:') {
  const host = formatAddressForUrl(address);
  if (!host) return '';
  const safePort = Math.min(65535, Math.max(1, Number(port || 27891)));
  const omitPort = (protocol === 'https:' && safePort === 443) || (protocol === 'http:' && safePort === 80);
  return `${protocol}//${host}${omitPort ? '' : `:${safePort}`}`;
}

function isLoopbackHost(value = '') {
  const address = stripIpv6Zone(value);
  return address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

function parsePublicIp(value = '') {
  const address = normalizeAddress(value).split(/\s+/)[0].replace(/[\r\n,]+$/, '');
  const family = net.isIP(stripIpv6Zone(address));
  if (!family) return null;
  const classification = classifyAddress(address);
  if (!classification.public) return null;
  return { address, family };
}

async function fetchPublicIpProvider(provider, fetchFn, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(provider.url, {
      signal: controller.signal,
      headers: {
        Accept: provider.json ? 'application/json' : 'text/plain',
        'User-Agent': 'crystelf-plugin/public-ip-resolver',
      },
    });
    if (!response.ok) return null;
    const text = await response.text();
    let value = text;
    if (provider.json) {
      try {
        value = JSON.parse(text)?.ip || '';
      } catch {
        return null;
      }
    }
    const parsed = parsePublicIp(value);
    return parsed ? { ...parsed, source: provider.name } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchExternalPublicIp(options = {}) {
  const now = Date.now();
  if (publicIpCache && now - publicIpCacheAt < PUBLIC_IP_CACHE_TTL_MS) {
    return { ...publicIpCache, cached: true };
  }
  if (publicIpInFlight) return publicIpInFlight;

  const fetchFn = typeof options.fetch === 'function' ? options.fetch : ((...args) => fetch(...args));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || PUBLIC_IP_TIMEOUT_MS);
  publicIpInFlight = Promise.all(
    PUBLIC_IP_PROVIDERS.map(provider => fetchPublicIpProvider(provider, fetchFn, timeoutMs)),
  ).then(results => {
    const valid = results.filter(Boolean);
    const selected = valid.find(item => item.family === 4) || valid[0] || null;
    if (selected) {
      publicIpCache = selected;
      publicIpCacheAt = Date.now();
    }
    return selected;
  }).finally(() => {
    publicIpInFlight = null;
  });
  return publicIpInFlight;
}

function addCandidate(candidates, seen, item = {}) {
  const address = normalizeAddress(item.address);
  const classification = classifyAddress(address, item.internal === true);
  if (!classification.usable) return;
  const key = `${stripIpv6Zone(address)}:${item.port}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({
    address,
    family: classification.family,
    public: classification.public,
    score: classification.score + Number(item.scoreBoost || 0),
    source: item.source || 'network-interface',
    url: buildAddressBaseUrl(address, item.port, item.protocol || 'http:'),
  });
}

export function listWebConsoleAddressCandidates(options = {}) {
  const runtimeInfo = options.runtimeInfo || {};
  const config = options.config || {};
  const port = Number(runtimeInfo.port || config.webConsolePort || 27891);
  const interfaces = options.networkInterfaces || os.networkInterfaces();
  const candidates = [];
  const seen = new Set();

  addCandidate(candidates, seen, {
    address: runtimeInfo.host,
    port,
    source: 'runtime-host',
    scoreBoost: 40,
  });

  for (const entries of Object.values(interfaces || {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      addCandidate(candidates, seen, {
        address: entry?.address,
        internal: entry?.internal,
        port,
        source: 'network-interface',
      });
    }
  }

  return candidates
    .filter(item => item.url)
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}

export function resolveWebConsoleLoginBaseUrl(options = {}) {
  const config = options.config || {};
  const runtimeInfo = options.runtimeInfo || {};
  const configuredUrl = normalizeWebConsoleBaseUrl(config.webConsolePublicUrl);
  if (configuredUrl) {
    return { url: configuredUrl, source: 'configured', public: true, candidates: [] };
  }

  const candidates = listWebConsoleAddressCandidates(options);
  if (candidates.length > 0) {
    const selected = candidates[0];
    return {
      url: selected.url,
      source: selected.public ? 'auto-public' : 'auto-private',
      public: selected.public,
      address: selected.address,
      candidates,
    };
  }

  const runtimeUrl = normalizeWebConsoleBaseUrl(runtimeInfo.url);
  const fallbackUrl = runtimeUrl || normalizeWebConsoleBaseUrl(
    getWebConsoleDisplayUrl(buildWebConsoleConfig(config)),
  );
  return {
    url: fallbackUrl,
    source: 'local-fallback',
    public: false,
    candidates: [],
  };
}

export async function resolveWebConsoleLoginBaseUrlAsync(options = {}) {
  const config = options.config || {};
  const runtimeInfo = options.runtimeInfo || {};
  const configuredUrl = normalizeWebConsoleBaseUrl(config.webConsolePublicUrl);
  if (configuredUrl) {
    return { url: configuredUrl, source: 'configured', public: true, candidates: [] };
  }

  const runtimeHost = normalizeAddress(runtimeInfo.host || config.webConsoleHost || '');
  if (!isLoopbackHost(runtimeHost) && options.fetchExternal !== false) {
    const external = await fetchExternalPublicIp(options);
    if (external?.address) {
      const port = Number(runtimeInfo.port || config.webConsolePort || 27891);
      const protocol = String(runtimeInfo.protocol || '').toLowerCase() === 'https:' ? 'https:' : 'http:';
      return {
        url: buildAddressBaseUrl(external.address, port, protocol),
        source: 'auto-external-public',
        public: true,
        address: external.address,
        externalIpSource: external.source,
        candidates: [],
      };
    }
  }

  return resolveWebConsoleLoginBaseUrl(options);
}
