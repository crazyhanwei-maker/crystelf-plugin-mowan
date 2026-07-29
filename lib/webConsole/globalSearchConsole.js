const PAGE_ENTRIES = [
  { id: 'page:index', type: 'page', typeLabel: '页面', title: '总览', description: '运行状态、健康巡检、任务中心、日志排查和快捷入口。', href: '/index.html', badge: '工作台', keywords: ['首页', '控制台', '健康', '日志', '任务', '状态'] },
  { id: 'page:plugin-settings', type: 'page', typeLabel: '页面', title: '插件设置', description: '管理插件开关、私聊 AI、安全策略、技能配置和锅巴配置项。', href: '/plugin-settings.html', badge: '插件与系统', keywords: ['配置', '锅巴', '开关', '私聊', '安全', '技能'] },
  { id: 'page:api-settings', type: 'page', typeLabel: '页面', title: 'API 接口', description: '配置 AI、生图、图片监控、搜索、表情包与备用 API。', href: '/api-settings.html', badge: 'AI 能力', keywords: ['模型', '备用', 'LLM', '生图', '搜索', '表情包', 'UA'] },
  { id: 'page:bot-plugins', type: 'page', typeLabel: '页面', title: '插件管理', description: '查看已安装插件、插件目录、安装任务、删除和依赖状态。', href: '/bot-plugins.html', badge: '插件与系统', keywords: ['插件目录', '安装插件', '依赖', '删除插件', 'gitee'] },
  { id: 'page:group-management', type: 'page', typeLabel: '页面', title: '群管理', description: '群管理开关、入群欢迎、自动审核、风控、刷屏检测和头衔申请。', href: '/group-management.html', badge: '群聊运营', keywords: ['欢迎', '加群申请', '群头衔', '刷屏', 'URL 安全', '总结'] },
  { id: 'page:group-summary-diagnostics', type: 'page', typeLabel: '页面', title: '群总结诊断', description: '查看每日群聊总结的发送状态、重复记录、运行锁、失败原因和排查建议。', href: '/group-summary-diagnostics.html', badge: '群聊运营', keywords: ['群总结', '每日总结', '重复发送', '定时任务', '运行锁', '总结失败'] },
  { id: 'page:qq-simulator', type: 'page', typeLabel: '页面', title: '模拟调试', description: '模拟 QQ 群聊、私聊、戳一戳、入群申请、图片和语音消息。', href: '/qq-simulator.html', badge: '诊断与调试', keywords: ['QQ模拟', '私聊', '消息段', 'CQ码', 'meme', '截图'] },
  { id: 'page:sandbox-chat', type: 'page', typeLabel: '页面', title: '对话测试', description: '在网页里测试 AI 对话、提示词、知识库和工具调用。', href: '/sandbox-chat.html', badge: 'AI 能力', keywords: ['沙箱', 'AI测试', '提示词', '工具调用'] },
  { id: 'page:agent-workbench', type: 'page', typeLabel: '页面', title: 'Agent 工作台', description: '运行内置 OpenCode 的代码分析任务，并可受控授权其修改文件。', href: '/agent-workbench.html', badge: 'AI 能力', keywords: ['Agent', 'OpenCode', '代码分析', '补丁建议', '修改文件', '编程'] },
  { id: 'page:command-center', type: 'page', typeLabel: '页面', title: '命令中心', description: '扫描插件命令、排查抢占风险，并管理 LLM 命令桥接授权。', href: '/command-center.html', badge: '诊断与调试', keywords: ['指令', '优先级', '被抢', '规则', '命令列表', '桥接', 'LLM调用插件'] },
  { id: 'page:file-browser', type: 'page', typeLabel: '页面', title: '文件编辑', description: '浏览、打开、复制、编辑和备份插件文件。', href: '/file-browser.html', badge: '插件与系统', keywords: ['文件管理器', '编辑器', '复制', '备份', '打开文件'] },
  { id: 'page:dependency-check', type: 'page', typeLabel: '页面', title: '依赖检查', description: '检查插件依赖、其他插件依赖、自动修复和任务进度。', href: '/dependency-check.html', badge: '插件与系统', keywords: ['修复依赖', 'pnpm', 'npm', '缺失依赖', '安装失败'] },
  { id: 'page:config-diagnostics', type: 'page', typeLabel: '页面', title: '配置诊断', description: '查看配置来源、覆盖关系、运行时配置和建议。', href: '/config-diagnostics.html', badge: '诊断与调试', keywords: ['配置来源', 'runtime', '默认配置', '覆盖'] },
  { id: 'page:frontend-diagnostics', type: 'page', typeLabel: '页面', title: '前端错误诊断', description: '查看页面脚本异常、接口失败、资源加载失败和慢请求记录。', href: '/frontend-diagnostics.html', badge: '诊断与调试', keywords: ['前端诊断', '页面报错', 'JS错误', '404', '500', '请求失败', '资源加载'] },
  { id: 'page:performance', type: 'page', typeLabel: '页面', title: '性能监测', description: '查看 API 主备质量、耗时、熔断、请求趋势和慢请求。', href: '/performance.html', badge: '诊断与调试', keywords: ['耗时', '主备', '质量', '熔断', '慢请求', '统计'] },
  { id: 'page:usage-center', type: 'page', typeLabel: '页面', title: 'AI 用量', description: '查看 AI 使用量、费用、场景统计和趋势。', href: '/usage-center.html', badge: 'AI 能力', keywords: ['token', '费用', '用量', '统计', 'AI使用量'] },
  { id: 'page:image-monitor', type: 'page', typeLabel: '页面', title: '图片监控', description: '查看图片审核日志、本地图片、清理任务和命中记录。', href: '/image-monitor-center.html', badge: '群聊运营', keywords: ['审核', '本地图片', '表情包', '清理', '命中'] },
  { id: 'page:help-diy', type: 'page', typeLabel: '页面', title: '帮助设计', description: '编辑帮助图片、模板、分类和默认帮助样式。', href: '/help-diy.html', badge: '群聊运营', keywords: ['帮助图', '帮助系统', '模板', '默认帮助'] },
];

const SHORTCUT_ENTRIES = [
  { id: 'shortcut:log-diagnosis', type: 'shortcut', typeLabel: '快捷入口', title: '日志排查', description: '在总览页使用 LLM 排查 Bot 日志错误。', href: '/index.html#log-diagnosis-result', badge: '排查', keywords: ['#灵晶排查日志', '#排查日志', '错误日志', 'AI排查'] },
  { id: 'shortcut:tasks', type: 'shortcut', typeLabel: '快捷入口', title: '操作任务中心', description: '查看插件安装、依赖修复等后台任务进度。', href: '/index.html#operation-task-center', badge: '任务', keywords: ['安装进度', '依赖任务', '实时进度'] },
  { id: 'shortcut:api-quality', type: 'shortcut', typeLabel: '快捷入口', title: 'API 主备质量', description: '查看主 API 与备用 API 的成功率、失败原因和切换情况。', href: '/performance.html#performance-api-quality-summary', badge: 'API', keywords: ['备用API', '失败率', '质量统计'] },
  { id: 'shortcut:group-rules', type: 'shortcut', typeLabel: '快捷入口', title: '群管理规则调试器', description: '验证群管理规则、入群申请条件和 URL 安全策略。', href: '/group-management.html#group-management-rule-debugger', badge: '群管理', keywords: ['规则调试', '加群条件', 'URL安全'] },
];

const TYPE_PRIORITY = {
  page: 100,
  shortcut: 92,
  command: 86,
  setting: 78,
  installedPlugin: 68,
  catalogPlugin: 58,
};

const GLOBAL_SEARCH_CACHE_TTL_MS = 8000;

function normalizeText(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeSearchText(value = '') {
  return normalizeText(value).toLowerCase();
}

function normalizeLimit(value, fallback = 14) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(40, Math.round(number)));
}

function splitTerms(query = '') {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(/[\s,，;；|/]+/).filter(Boolean).slice(0, 8) : [];
}

function compactKeywords(values = []) {
  return Array.from(new Set(values
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => normalizeText(value))
    .filter(Boolean)))
    .slice(0, 12);
}

function createSearchItem(item = {}) {
  return {
    id: normalizeText(item.id || `${item.type}:${item.title}:${item.href}`),
    type: normalizeText(item.type || 'item'),
    typeLabel: normalizeText(item.typeLabel || '结果'),
    title: normalizeText(item.title || '未命名结果'),
    description: normalizeText(item.description || ''),
    href: normalizeText(item.href || '/index.html'),
    badge: normalizeText(item.badge || ''),
    keywords: compactKeywords(item.keywords || []),
  };
}

function toTextBlob(item = {}) {
  return normalizeSearchText([
    item.title,
    item.description,
    item.badge,
    item.typeLabel,
    item.href,
    ...(Array.isArray(item.keywords) ? item.keywords : []),
  ].filter(Boolean).join(' '));
}

function scoreItem(item = {}, terms = []) {
  const text = toTextBlob(item);
  if (terms.length <= 0) return TYPE_PRIORITY[item.type] || 10;
  let score = TYPE_PRIORITY[item.type] || 10;
  for (const term of terms) {
    const title = normalizeSearchText(item.title);
    const badge = normalizeSearchText(item.badge);
    const href = normalizeSearchText(item.href);
    if (title === term) score += 120;
    else if (title.startsWith(term)) score += 80;
    else if (title.includes(term)) score += 58;
    if (badge.includes(term)) score += 24;
    if (href.includes(term)) score += 18;
    if (text.includes(term)) score += 36;
    else score -= 60;
  }
  return score;
}

function filterAndRank(items = [], query = '', limit = 14) {
  const terms = splitTerms(query);
  return items
    .map(item => ({ ...item, score: scoreItem(item, terms) }))
    .filter(item => terms.length <= 0 || item.score > (TYPE_PRIORITY[item.type] || 10))
    .sort((left, right) => (right.score - left.score)
      || String(left.typeLabel).localeCompare(String(right.typeLabel), 'zh-CN')
      || String(left.title).localeCompare(String(right.title), 'zh-CN'))
    .slice(0, limit);
}

function buildCommandItems(payload = {}) {
  const commands = Array.isArray(payload?.data?.commands)
    ? payload.data.commands
    : Array.isArray(payload?.commands)
      ? payload.commands
      : [];
  return commands.map(command => createSearchItem({
    id: `command:${command.id || `${command.fileName}:${command.fnc}`}`,
    type: 'command',
    typeLabel: '命令',
    title: command.displayCommand || command.exactCommand || command.pattern || command.fnc || '未命名命令',
    description: [command.moduleLabel, command.description, command.permissionLabel ? `权限：${command.permissionLabel}` : ''].filter(Boolean).join(' / '),
    href: `/command-center.html?q=${encodeURIComponent(command.displayCommand || command.exactCommand || command.fnc || '')}`,
    badge: command.moduleLabel || command.category || '命令',
    keywords: [command.pattern, command.patternRaw, command.fnc, command.fileName, command.category, command.eventLabel, command.feature?.label, command.statusLabel],
  }));
}

function buildSettingItems(payload = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map(setting => createSearchItem({
    id: `setting:${setting.field}`,
    type: 'setting',
    typeLabel: '设置项',
    title: setting.label || setting.field,
    description: [setting.field, setting.bottomHelpMessage].filter(Boolean).join(' / '),
    href: `/plugin-settings.html?search=${encodeURIComponent(setting.label || setting.field || '')}`,
    badge: setting.group || setting.category || '设置',
    keywords: [setting.field, setting.component, setting.category, setting.group, setting.bottomHelpMessage],
  }));
}

function buildInstalledPluginItems(payload = {}) {
  const plugins = Array.isArray(payload?.plugins) ? payload.plugins : [];
  return plugins.map(plugin => createSearchItem({
    id: `installed-plugin:${plugin.directoryName || plugin.id || plugin.name}`,
    type: 'installedPlugin',
    typeLabel: '已装插件',
    title: plugin.name || plugin.directoryName || plugin.id,
    description: [plugin.description, plugin.version ? `版本 ${plugin.version}` : '', plugin.git?.status ? `Git ${plugin.git.status}` : ''].filter(Boolean).join(' / '),
    href: `/bot-plugins.html?tab=installed&plugin=${encodeURIComponent(plugin.directoryName || plugin.id || '')}`,
    badge: plugin.directoryName || plugin.type || '插件',
    keywords: [plugin.id, plugin.directoryName, plugin.packageName, plugin.relativePath, plugin.git?.remote, plugin.git?.branch, plugin.type, plugin.scripts],
  }));
}

function buildCatalogPluginItems(payload = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map(plugin => createSearchItem({
    id: `catalog-plugin:${plugin.id || plugin.name}`,
    type: 'catalogPlugin',
    typeLabel: '插件目录',
    title: plugin.name || plugin.id,
    description: [plugin.description, plugin.repo].filter(Boolean).join(' / '),
    href: `/bot-plugins.html?tab=catalog&catalog=${encodeURIComponent(plugin.id || '')}`,
    badge: plugin.category || (plugin.localState?.installed ? '已安装' : '可安装'),
    keywords: [plugin.id, plugin.repo, plugin.defaultDirectoryName, plugin.installState?.defaultDirectoryName, plugin.tags, plugin.localState?.directoryName],
  }));
}

function getSummary(items = []) {
  const byType = {};
  for (const item of items) {
    byType[item.type] = (byType[item.type] || 0) + 1;
  }
  return { total: items.length, byType };
}

async function readPayload(builder, fallback = {}) {
  if (typeof builder !== 'function') return fallback;
  try {
    return await builder();
  } catch {
    return fallback;
  }
}

export function createGlobalSearchConsole(options = {}) {
  const logger = options.logger || console;

  let candidateCache = {
    expiresAt: 0,
    items: [],
  };

  async function buildCandidates() {
    const now = Date.now();
    if (candidateCache.expiresAt > now && candidateCache.items.length > 0) {
      return candidateCache.items;
    }
    const [commandPayload, settingsPayload, botPluginsPayload, catalogPayload] = await Promise.all([
      readPayload(options.buildCommandCenterPayload, { data: { commands: [] } }),
      readPayload(options.buildPluginSettingsPayload, { items: [] }),
      readPayload(options.buildBotPluginManagementPayload, { plugins: [] }),
      readPayload(options.buildPluginCatalogPayload, { items: [] }),
    ]);
    const items = [
      ...PAGE_ENTRIES,
      ...SHORTCUT_ENTRIES,
      ...buildCommandItems(commandPayload),
      ...buildSettingItems(settingsPayload),
      ...buildInstalledPluginItems(botPluginsPayload),
      ...buildCatalogPluginItems(catalogPayload),
    ].map(createSearchItem);
    candidateCache = { expiresAt: now + GLOBAL_SEARCH_CACHE_TTL_MS, items };
    return items;
  }

  async function buildPayload(params = {}) {
    const query = normalizeText(params.query || params.q || '');
    const limit = normalizeLimit(params.limit, query ? 14 : 10);
    try {
      const candidates = await buildCandidates();
      const items = filterAndRank(candidates, query, limit);
      return {
        success: true,
        data: {
          query,
          generatedAt: new Date().toISOString(),
          summary: getSummary(items),
          sourceSummary: getSummary(candidates),
          items,
        },
      };
    } catch (error) {
      logger.warn?.(`[webConsole] 全局搜索失败：${error.message}`);
      return { success: false, error: error.message || String(error) };
    }
  }

  return { buildPayload };
}
