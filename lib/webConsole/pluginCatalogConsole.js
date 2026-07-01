import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { createPluginCatalogInstallTasks } from './pluginCatalogInstallTasks.js';

const FUNCTION_PLUGIN_INDEX_URL = 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/raw/main/Function-Plugin.md';
const FUNCTION_PLUGIN_INDEX_PAGE_URL = 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/Function-Plugin.md';
const PLUGIN_CATALOG_FETCH_TIMEOUT_MS = 12000;
const PLUGIN_CATALOG_CACHE_TTL_MS = 30 * 60 * 1000;
const PLUGIN_CATALOG_MAX_BYTES = 2 * 1024 * 1024;

const BUILTIN_PLUGIN_CATALOG = [
  {
    id: 'yunzai-blacklist-plugin',
    name: 'yunzai-blacklist-plugin',
    category: '安全管理',
    description: '黑名单、授权、自动处理黑名单成员等安全管理能力。',
    repo: 'https://gitee.com/null_334_7392/yunzai-blacklist-plugin.git',
    sourceUrl: 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/Function-Plugin.md',
    tags: ['安全', '群管理'],
  },
  {
    id: 'gamepush-plugin',
    name: 'GamePush-plugin',
    category: '游戏工具',
    description: '游戏公告、版本更新和推送类功能插件。',
    repo: 'https://gitee.com/huifeidemangguo/GamePush-plugin.git',
    sourceUrl: 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/Function-Plugin.md',
    tags: ['游戏', '推送'],
  },
  {
    id: 'voicevox-plugin',
    name: 'voicevox-plugin',
    category: '语音工具',
    description: 'VOICEVOX 语音生成相关插件。',
    repo: 'https://gitee.com/xianyunleo/voicevox-plugin.git',
    sourceUrl: 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/Function-Plugin.md',
    tags: ['语音', '生成'],
  },
  {
    id: 'notice-plugin',
    name: 'Notice-plugin',
    category: '通知公告',
    description: '公告、群发、通知相关功能插件。',
    repo: 'https://gitee.com/huangshx2001/notice-plugin.git',
    sourceUrl: 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/Function-Plugin.md',
    tags: ['通知', '群发'],
  },
  {
    id: 'group-insight',
    name: 'group-insight',
    category: '群聊分析',
    description: '群聊总结、词云、活跃度和聊天分析类能力。',
    repo: 'https://gitee.com/huifeidemangguo/group-insight.git',
    sourceUrl: 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/Function-Plugin.md',
    tags: ['总结', '词云', '群聊'],
  },
  {
    id: 'flower-plugin',
    name: 'flower-plugin',
    category: '娱乐互动',
    description: '抽卡、娱乐和群互动功能插件。',
    repo: 'https://gitee.com/Nwflower/flower-plugin.git',
    sourceUrl: 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/Function-Plugin.md',
    tags: ['娱乐', '互动'],
  },
  {
    id: 'poke-plugin',
    name: 'Poke-plugin',
    category: '娱乐互动',
    description: '戳一戳统计和互动增强插件。',
    repo: 'https://gitee.com/BlackHat007/Poke-plugin.git',
    sourceUrl: 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/Function-Plugin.md',
    tags: ['戳一戳', '互动'],
  },
  {
    id: 'trss-plugin',
    name: 'TRSS-Plugin',
    category: '综合工具',
    description: 'TRSS 生态综合工具插件。',
    repo: 'https://gitee.com/TimeRainStarSky/TRSS-Plugin.git',
    sourceUrl: 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index/blob/main/Function-Plugin.md',
    tags: ['综合', '工具'],
  },
];

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeText(value = '', maxLength = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function createCatalogId(item = {}) {
  const basis = String(item.id || item.name || item.repo || item.sourceUrl || '').trim().toLowerCase();
  return basis
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || `plugin-${Date.now()}`;
}

function normalizeRepoUrl(value = '') {
  const repo = String(value || '').trim();
  if (!repo) return '';
  if (/^https?:\/\/[^\s]+$/i.test(repo)) {
    try {
      const parsed = new URL(repo);
      if (parsed.username || parsed.password) return '';
    } catch {
      return '';
    }
    return repo;
  }
  if (/^git@[^\s:]+:[^\s]+$/i.test(repo)) {
    return repo;
  }
  return '';
}

function getRepoName(repo = '', fallback = '') {
  const raw = String(repo || '').trim();
  let text = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      text = new URL(raw).pathname;
    }
  } catch {
    text = raw;
  }
  text = String(text || '').replace(/[?#].*$/g, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const last = text.split(/[/:]/).filter(Boolean).pop();
  return String(last || fallback || '').trim();
}

function normalizePluginDirectoryName(value = '', fallback = '') {
  for (const candidate of [value, fallback]) {
    const normalized = String(candidate || '')
      .trim()
      .replace(/\.git$/i, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 80);
    if (normalized && /[A-Za-z0-9]/.test(normalized)) {
      return normalized;
    }
  }
  return '';
}

function getCatalogDefaultDirectoryName(item = {}) {
  return normalizePluginDirectoryName(
    getRepoName(item.repo || ''),
    item.directoryName || item.defaultDirectoryName || item.id || item.name || '',
  );
}

function fetchText(url = '', options = {}) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const transport = targetUrl.protocol === 'http:' ? http : https;
    const request = transport.request(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'crystelf-plugin/2.0.3',
        Accept: 'text/plain,text/markdown,*/*',
      },
    }, response => {
      const statusCode = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, targetUrl).toString();
        fetchText(nextUrl, options).then(resolve, reject);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${statusCode}`));
        return;
      }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > PLUGIN_CATALOG_MAX_BYTES) {
          request.destroy(new Error('插件目录索引过大'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    request.setTimeout(Number(options.timeoutMs || PLUGIN_CATALOG_FETCH_TIMEOUT_MS), () => {
      request.destroy(new Error('插件目录索引读取超时'));
    });
    request.on('error', reject);
    request.end();
  });
}

function stripMarkdown(value = '') {
  return String(value || '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[`*_>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMarkdownLinks(line = '') {
  const links = [];
  const pattern = /\[([^\]]+)]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(line))) {
    links.push({
      label: normalizeText(match[1], 120),
      url: normalizeText(match[2], 500),
    });
  }
  return links;
}

function isRepositoryUrl(url = '') {
  return /^https?:\/\/(gitee\.com|github\.com|gitlab\.com|kkgithub\.com)\//i.test(String(url || ''))
    || /^git@[^\s:]+:[^\s]+$/i.test(String(url || ''));
}

function parseFunctionPluginMarkdown(markdown = '') {
  const lines = String(markdown || '').split(/\r?\n/);
  const items = [];
  let category = '未分类';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      category = stripMarkdown(heading[1]) || category;
      continue;
    }
    const links = parseMarkdownLinks(line);
    if (links.length <= 0) continue;
    const repoLink = links.find(link => isRepositoryUrl(link.url)) || links[0];
    const repo = normalizeRepoUrl(repoLink.url);
    if (!repo) continue;
    const description = stripMarkdown(line.replace(/\[([^\]]+)]\(([^)]+)\)/g, '').replace(/^[-*+]\s*/, ''));
    const name = normalizeText(repoLink.label || getRepoName(repo), 100);
    items.push({
      id: createCatalogId({ name, repo }),
      name,
      category,
      description,
      repo,
      sourceUrl: FUNCTION_PLUGIN_INDEX_PAGE_URL,
      readmeUrl: repo,
      installType: 'git',
      tags: [category].filter(Boolean),
    });
  }
  return items;
}

export function createPluginCatalogConsole(options = {}) {
  const logger = options.logger || console;
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode, message, code = '') => {
        const error = new Error(message);
        error.statusCode = statusCode;
        error.code = code;
        return error;
      });
  const getResolvedPathSafe = typeof options.getResolvedPathSafe === 'function'
    ? options.getResolvedPathSafe
    : (targetPath = '') => path.resolve(String(targetPath || ''));
  const isSubPath = typeof options.isSubPath === 'function'
    ? options.isSubPath
    : ((parentPath = '', targetPath = '') => {
        const relativePath = path.relative(parentPath, targetPath);
        return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
      });
  const resolvePluginsDirectory = typeof options.resolvePluginsDirectory === 'function'
    ? options.resolvePluginsDirectory
    : (() => path.join(process.cwd(), 'plugins'));
  const toRelativeConsolePath = typeof options.toRelativeConsolePath === 'function'
    ? options.toRelativeConsolePath
    : (targetPath = '') => path.relative(process.cwd(), targetPath).replace(/\\/g, '/');
  const buildBotPluginManagementPayload = typeof options.buildBotPluginManagementPayload === 'function'
    ? options.buildBotPluginManagementPayload
    : (() => ({ plugins: [] }));
  const buildDependencyReport = typeof options.buildDependencyReport === 'function'
    ? options.buildDependencyReport
    : (() => ({}));
  const catalogFile = options.catalogFile || path.join(process.cwd(), 'data', 'crystelf', 'plugin-catalog.json');
  const taskStoreFile = options.taskStoreFile || path.join(process.cwd(), 'data', 'crystelf', 'plugin-install-tasks.json');
  let remoteCatalogCache = {
    fetchedAt: 0,
    items: [],
    error: '',
  };

  function readCatalogFile() {
    try {
      if (!fs.existsSync(catalogFile)) return [];
      const parsed = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.plugins)) return parsed.plugins;
      return [];
    } catch {
      return [];
    }
  }

  function normalizeCatalogItem(item = {}) {
    if (!isPlainObject(item)) return null;
    const repo = normalizeRepoUrl(item.repo || item.repository || item.url || item.sourceUrl);
    const name = normalizeText(item.name || getRepoName(repo, item.id), 100);
    if (!name && !repo) return null;
    const id = createCatalogId({ ...item, name, repo });
    const defaultDirectoryName = getCatalogDefaultDirectoryName({ ...item, id, name, repo });
    const tags = Array.isArray(item.tags)
      ? item.tags.map(value => normalizeText(value, 40)).filter(Boolean)
      : [];
    return {
      id,
      name: name || id,
      category: normalizeText(item.category || item.group || '未分类', 60),
      description: normalizeText(item.description || item.desc || '', 220),
      repo,
      defaultDirectoryName,
      sourceUrl: normalizeText(item.sourceUrl || item.source || '', 400),
      readmeUrl: normalizeText(item.readmeUrl || item.readme || '', 400),
      installType: normalizeText(item.installType || 'git', 40),
      tags,
    };
  }

  function listCatalogItems() {
    const remoteItems = remoteCatalogCache.items.length > 0 ? remoteCatalogCache.items : [];
    const merged = [...remoteItems, ...BUILTIN_PLUGIN_CATALOG, ...readCatalogFile()]
      .map(normalizeCatalogItem)
      .filter(Boolean);
    const seen = new Set();
    return merged.filter(item => {
      const key = item.id || item.repo || item.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((left, right) => String(left.category).localeCompare(String(right.category), 'zh-CN')
      || String(left.name).localeCompare(String(right.name), 'zh-CN'));
  }

  function buildLocalStateMap() {
    const map = new Map();
    const payload = buildBotPluginManagementPayload();
    const plugins = Array.isArray(payload?.plugins) ? payload.plugins : [];
    for (const plugin of plugins) {
      const keys = [
        plugin.id,
        plugin.name,
        plugin.directoryName,
        plugin.packageName,
        getRepoName(plugin.git?.remote || ''),
      ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
      for (const key of keys) {
        if (!map.has(key)) map.set(key, plugin);
      }
    }
    return map;
  }

  function getDependencySummaryByPlugin() {
    const report = buildDependencyReport({ includeOtherPlugins: true });
    const items = Array.isArray(report?.otherPluginDependencies?.items)
      ? report.otherPluginDependencies.items
      : [];
    const map = new Map();
    for (const item of items) {
      const key = String(item.pluginId || item.pluginName || '').trim().toLowerCase();
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          total: 0,
          problemCount: 0,
          installableCount: 0,
          runtimeMissingCount: 0,
          devMissingCount: 0,
        });
      }
      const summary = map.get(key);
      summary.total += 1;
      if (item.level === 'error' || item.status === 'missing' || item.status === 'version_mismatch' || item.status === 'not_installed') {
        summary.problemCount += 1;
      }
      if (item.installable) summary.installableCount += 1;
      if (item.dependencyType === 'runtime' && (item.status === 'missing' || item.status === 'not_installed')) {
        summary.runtimeMissingCount += 1;
      }
      if (item.dependencyType === 'dev' && (item.status === 'missing' || item.status === 'not_installed')) {
        summary.devMissingCount += 1;
      }
    }
    return map;
  }

  function findInstalledPlugin(catalogItem = {}, localMap = new Map()) {
    const keys = [
      catalogItem.id,
      catalogItem.name,
      getRepoName(catalogItem.repo || ''),
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
    for (const key of keys) {
      if (localMap.has(key)) return localMap.get(key);
    }
    return null;
  }

  function buildPayload() {
    const catalog = listCatalogItems();
    const localMap = buildLocalStateMap();
    const dependencyMap = getDependencySummaryByPlugin();
    const items = catalog.map(item => {
      const installed = findInstalledPlugin(item, localMap);
      const dependencyKey = String(installed?.id || installed?.directoryName || installed?.name || '').trim().toLowerCase();
      const dependencySummary = dependencyMap.get(dependencyKey) || null;
      return {
        ...item,
        localState: {
          installed: Boolean(installed),
          directoryName: installed?.directoryName || '',
          relativePath: installed?.relativePath || '',
          version: installed?.version || '',
          hasPackage: installed?.hasPackage === true,
          gitDirty: installed?.git?.status === 'dirty',
          gitStatus: installed?.git?.status || '',
          gitRemote: installed?.git?.remote || '',
        },
        installState: {
          supported: Boolean(item.repo),
          reason: item.repo ? '' : '缺少仓库地址，当前仅能查看说明。',
          defaultDirectoryName: getCatalogDefaultDirectoryName(item),
        },
        dependencySummary,
      };
    });
    const categories = Array.from(new Set(items.map(item => item.category || '未分类'))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return {
      success: true,
      generatedAt: new Date().toISOString(),
      sourceUrl: FUNCTION_PLUGIN_INDEX_PAGE_URL,
      sourceState: {
        remoteLoaded: remoteCatalogCache.items.length > 0,
        remoteCount: remoteCatalogCache.items.length,
        remoteError: remoteCatalogCache.error,
        fetchedAt: remoteCatalogCache.fetchedAt ? new Date(remoteCatalogCache.fetchedAt).toISOString() : '',
      },
      catalogFile: toRelativeConsolePath(catalogFile),
      summary: {
        total: items.length,
        installed: items.filter(item => item.localState.installed).length,
        installable: items.filter(item => item.installState.supported).length,
        categories: categories.length,
      },
      categories,
      items,
    };
  }

  async function refreshRemoteCatalog(options = {}) {
    const now = Date.now();
    if (!options.force && remoteCatalogCache.items.length > 0 && now - remoteCatalogCache.fetchedAt < PLUGIN_CATALOG_CACHE_TTL_MS) {
      return remoteCatalogCache;
    }
    try {
      const markdown = await fetchText(FUNCTION_PLUGIN_INDEX_URL, { timeoutMs: PLUGIN_CATALOG_FETCH_TIMEOUT_MS });
      const parsed = parseFunctionPluginMarkdown(markdown);
      remoteCatalogCache = {
        fetchedAt: Date.now(),
        items: parsed,
        error: parsed.length > 0 ? '' : '远程索引未解析到插件条目',
      };
    } catch (error) {
      remoteCatalogCache = {
        ...remoteCatalogCache,
        fetchedAt: remoteCatalogCache.fetchedAt || Date.now(),
        error: String(error?.message || '远程索引读取失败').trim(),
      };
    }
    return remoteCatalogCache;
  }

  function getCatalogItem(id = '') {
    const normalizedId = String(id || '').trim();
    return listCatalogItems().find(item => item.id === normalizedId) || null;
  }

  const installTasks = createPluginCatalogInstallTasks({
    logger,
    createHttpError,
    getResolvedPathSafe,
    isSubPath,
    resolvePluginsDirectory,
    toRelativeConsolePath,
    taskStoreFile,
    getCatalogItem,
    getRepoName,
    normalizePluginDirectoryName,
    getCatalogDefaultDirectoryName,
    recordWebConsoleOperation: options.recordWebConsoleOperation,
  });

  return {
    buildPayload,
    refreshRemoteCatalog,
    precheckInstallTask: installTasks.precheckInstallTask,
    createInstallTask: installTasks.createInstallTask,
    cancelInstallTask: installTasks.cancelInstallTask,
    getTask: installTasks.getTask,
    listTasks: installTasks.listTasks,
    serializeTask: installTasks.serializeTask,
  };
}
