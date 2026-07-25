import fs from 'fs/promises';
import path from 'path';

const root = process.cwd();
const checks = [];
const FORBIDDEN_RUNTIME_PATTERNS = [
  {
    label: 'legacy-core.example.com',
    pattern: 'legacy-core.example.com',
  },
  {
    label: '旧词库接口 /api/words',
    pattern: '/api/words',
  },
  {
    label: '旧核心配置 coreUrl',
    pattern: 'coreUrl',
  },
  {
    label: '旧即梦接口 165.99.42.28',
    pattern: '165.99.42.28',
  },
];
const FORBIDDEN_RUNTIME_SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.html', '.md']);
const FORBIDDEN_RUNTIME_SCAN_EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'temp', 'data']);

function addCheck(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

function includesAll(text, patterns = []) {
  return patterns.every(pattern => text.includes(pattern));
}

async function listFilesByExtension(dir, extension) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesByExtension(fullPath, extension));
    } else if (path.extname(entry.name) === extension) {
      files.push(fullPath);
    }
  }

  return files;
}

function isSkippableHtmlResource(value = '') {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

async function findMissingPublicHtmlResources() {
  const publicRoot = path.join(root, 'lib/webConsole/public');
  const htmlFiles = await listFilesByExtension(publicRoot, '.html');
  const missing = [];
  const resourcePattern = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi;

  for (const file of htmlFiles) {
    const html = await fs.readFile(file, 'utf8');
    const htmlDir = path.dirname(file);
    const relativeHtmlPath = path.relative(root, file).replace(/\\/g, '/');
    for (const match of html.matchAll(resourcePattern)) {
      const rawValue = String(match[1] || '').trim();
      if (!rawValue || isSkippableHtmlResource(rawValue)) {
        continue;
      }

      const cleanValue = rawValue.split(/[?#]/, 1)[0];
      const target = cleanValue.startsWith('/')
        ? path.join(publicRoot, cleanValue.slice(1))
        : path.resolve(htmlDir, cleanValue);
      const relativeTargetPath = path.relative(publicRoot, target);
      if (relativeTargetPath.startsWith('..') || path.isAbsolute(relativeTargetPath)) {
        missing.push(`${relativeHtmlPath}: ${rawValue} 越过 public 目录`);
        continue;
      }

      try {
        await fs.access(target);
      } catch {
        missing.push(`${relativeHtmlPath}: ${rawValue}`);
      }
    }
  }

  return missing;
}

async function findPublicHtmlPagesMissingAuth() {
  const publicRoot = path.join(root, 'lib/webConsole/public');
  const htmlFiles = await listFilesByExtension(publicRoot, '.html');
  const publicRedirectPages = new Set(['login.html', 'plugin-catalog.html']);
  const missing = [];

  for (const file of htmlFiles) {
    const relativePath = path.relative(publicRoot, file).replace(/\\/g, '/');
    if (publicRedirectPages.has(relativePath)) {
      continue;
    }
    const html = await fs.readFile(file, 'utf8');
    if (!html.includes('src="/auth.js"')) {
      missing.push(relativePath);
    }
  }

  return missing;
}

async function findNativePublicDialogUsages() {
  const publicRoot = path.join(root, 'lib/webConsole/public');
  const jsFiles = await listFilesByExtension(publicRoot, '.js');
  const hits = [];

  for (const file of jsFiles) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    if (relativePath === 'lib/webConsole/public/auth.js') {
      continue;
    }
    const text = await fs.readFile(file, 'utf8');
    if (/\bwindow\.(?:alert|confirm)\s*\(/.test(text) || /(?<![\w.])(?:alert|confirm)\s*\(/.test(text)) {
      hits.push(relativePath);
    }
  }

  return hits;
}

async function listTextFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (FORBIDDEN_RUNTIME_SCAN_EXCLUDE_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTextFiles(fullPath));
    } else if (FORBIDDEN_RUNTIME_SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

async function findForbiddenRuntimeReferences() {
  const files = await listTextFiles(root);
  const hits = [];

  for (const file of files) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    if (relativePath === 'scripts/check-structure.mjs' || relativePath === 'lib/config/configControl.js') {
      continue;
    }
    const text = await fs.readFile(file, 'utf8');
    for (const item of FORBIDDEN_RUNTIME_PATTERNS) {
      if (text.includes(item.pattern)) {
        hits.push(`${relativePath}: ${item.label}`);
      }
    }
  }

  return hits;
}

async function findDirectPuppeteerRendererReferences() {
  const files = await listTextFiles(root);
  const hits = [];
  const allowed = new Set(['lib/system/puppeteerRenderer.js']);

  for (const file of files) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    if (allowed.has(relativePath)) {
      continue;
    }
    const text = await fs.readFile(file, 'utf8');
    if (/import\s+puppeteer\s+from\s+['"]puppeteer['"]/.test(text) || /\bpuppeteer\.launch\s*\(/.test(text)) {
      hits.push(relativePath);
    }
  }

  return hits;
}

async function main() {
  const pkg = JSON.parse(await readText('package.json'));
  addCheck('package name', pkg.name === 'crystelf-plugin', `name=${pkg.name}`);
  addCheck('encoding script exists', Boolean(pkg.scripts?.['check:encoding']));
  addCheck('structure script exists', Boolean(pkg.scripts?.['check:structure']));
  addCheck('web console e2e script exists', Boolean(pkg.scripts?.['check:webconsole:e2e']));
  addCheck('web console mobile e2e script exists', Boolean(pkg.scripts?.['check:webconsole:mobile']));
  const forbiddenRuntimeRefs = await findForbiddenRuntimeReferences();
  addCheck('no removed legacy runtime endpoints', forbiddenRuntimeRefs.length === 0, forbiddenRuntimeRefs.join('; '));
  const missingPublicHtmlResources = await findMissingPublicHtmlResources();
  addCheck('web console static resource references', missingPublicHtmlResources.length === 0, missingPublicHtmlResources.join('; '));
  const publicHtmlPagesMissingAuth = await findPublicHtmlPagesMissingAuth();
  addCheck('web console protected pages load auth script', publicHtmlPagesMissingAuth.length === 0, publicHtmlPagesMissingAuth.join('; '));
  const nativePublicDialogUsages = await findNativePublicDialogUsages();
  addCheck('web console public pages use unified dialog', nativePublicDialogUsages.length === 0, nativePublicDialogUsages.join('; '));

  const server = await readText('lib/webConsole/server.js');
  const configFeatureConsoleSuite = await readText('lib/webConsole/configFeatureConsoleSuite.js');
  const coreWebConsoleSuite = await readText('lib/webConsole/coreWebConsoleSuite.js');
  const dataLogConsoleSuite = await readText('lib/webConsole/dataLogConsoleSuite.js');
  const groupManagementConsoleSuite = await readText('lib/webConsole/groupManagementConsoleSuite.js');
  const mediaApiConsoleSuite = await readText('lib/webConsole/mediaApiConsoleSuite.js');
  const pluginSettingsConsoleSuite = await readText('lib/webConsole/pluginSettingsConsoleSuite.js');
  const sandboxSimulatorConsoleSuite = await readText('lib/webConsole/sandboxSimulatorConsoleSuite.js');
  const commandCenterConsole = await readText('lib/webConsole/commandCenterConsole.js');
  const groupSummaryDiagnosticsConsole = await readText('lib/webConsole/groupSummaryDiagnosticsConsole.js');
  const globalSearchConsole = await readText('lib/webConsole/globalSearchConsole.js');
  const consoleShellJs = await readText('lib/webConsole/public/console-shell.js');
  const publicStyles = await readText('lib/webConsole/public/styles.css');
  const consoleModernStyles = await readText('lib/webConsole/public/console-modern.css');
  const themeJs = await readText('lib/webConsole/public/theme.js');
  const webConsoleRoutes = await readText('lib/webConsole/webConsoleRoutes.js');
  const webConsoleHandlerContext = await readText('lib/webConsole/webConsoleHandlerContext.js');
  const fileBrowserRoutes = await readText('lib/webConsole/fileBrowserRoutes.js');
  const botPluginRoutes = await readText('lib/webConsole/botPluginRoutes.js');
  const pluginCatalogRoutes = await readText('lib/webConsole/pluginCatalogRoutes.js');
  const dependencyRoutes = await readText('lib/webConsole/dependencyRoutes.js');
  const userDataRoutes = await readText('lib/webConsole/userDataRoutes.js');
  const logRoutes = await readText('lib/webConsole/logRoutes.js');
  const groupManagementRoutes = await readText('lib/webConsole/groupManagementRoutes.js');
  const settingsRoutes = await readText('lib/webConsole/settingsRoutes.js');
  const helpDiyRoutes = await readText('lib/webConsole/helpDiyRoutes.js');
  const qqSimulatorRoutes = await readText('lib/webConsole/qqSimulatorRoutes.js');
  const sandboxRoutes = await readText('lib/webConsole/sandboxRoutes.js');
  const configBackupRoutes = await readText('lib/webConsole/configBackupRoutes.js');
  const mediaRoutes = await readText('lib/webConsole/mediaRoutes.js');
  const routeUtils = await readText('lib/webConsole/routeUtils.js');
  const webConsoleSurface = [
    server,
    configFeatureConsoleSuite,
    coreWebConsoleSuite,
    dataLogConsoleSuite,
    globalSearchConsole,
    groupManagementConsoleSuite,
    mediaApiConsoleSuite,
    pluginSettingsConsoleSuite,
    sandboxSimulatorConsoleSuite,
    commandCenterConsole,
    webConsoleRoutes,
    groupSummaryDiagnosticsConsole,
    fileBrowserRoutes,
    botPluginRoutes,
    pluginCatalogRoutes,
    dependencyRoutes,
    userDataRoutes,
    logRoutes,
    groupManagementRoutes,
    settingsRoutes,
    helpDiyRoutes,
    qqSimulatorRoutes,
    sandboxRoutes,
    configBackupRoutes,
    mediaRoutes,
    webConsoleHandlerContext,
  ].join('\n');
  addCheck('web console route utils module', includesAll(routeUtils, [
    'createRouteUtils',
    'rejectReadOnly',
    'sendRouteError',
    'Read-only mode',
  ]) && includesAll(webConsoleSurface, [
    'createRouteUtils',
    'rejectReadOnly',
  ]));
  addCheck('web console route modules', includesAll(webConsoleRoutes, [
    'createWebConsoleHandler',
    'createFileBrowserRoutes',
    'createBotPluginRoutes',
    '/api/version/check',
    '/api/tasks',
    '/api/command-center',
    '/api/global-search',
    'buildGlobalSearchPayload',
    '/api/group-summary/diagnostics',
    'buildGroupSummaryDiagnosticsPayload',
    'buildVersionCheckPayload',
    'buildCommandCenterPayload',
    'createPluginCatalogRoutes',
    'createDependencyRoutes',
    'createUserDataRoutes',
    'createLogRoutes',
    'createGroupManagementRoutes',
    'createSettingsRoutes',
    'createHelpDiyRoutes',
    'createQqSimulatorRoutes',
    'createSandboxRoutes',
    'createConfigBackupRoutes',
    'createMediaRoutes',
    '/api/config/diagnostics',
  ]) && includesAll(fileBrowserRoutes, [
    'createFileBrowserRoutes',
    '/api/file-browser/tree',
    '/api/file-browser/copy-file',
    '/api/file-browser/write',
  ]) && includesAll(botPluginRoutes, [
    'createBotPluginRoutes',
    '/api/bot-plugins',
    'buildBotPluginManagementPayload',
  ]) && includesAll(pluginCatalogRoutes, [
    'createPluginCatalogRoutes',
    '/api/plugin-catalog',
    '/api/plugin-catalog/install',
    'createPluginCatalogInstallTask',
    'refreshPluginCatalogRemoteSource',
  ]) && includesAll(dependencyRoutes, [
    'createDependencyRoutes',
    '/api/dependencies/install',
    '/api/dependencies/install-precheck',
    '/api/dependencies/install-missing',
    '/api/dependencies/install-history',
  ]) && includesAll(userDataRoutes, [
    'createUserDataRoutes',
    '/api/affinity',
    '/api/sessions/reset',
  ]) && includesAll(logRoutes, [
    'createLogRoutes',
    '/api/performance/api-circuit/reset',
    '/api/logs/audit',
    '/api/logs/image-monitor',
    '/api/trend/usage',
  ]) && includesAll(groupManagementRoutes, [
    'createGroupManagementRoutes',
    '/api/group-management/events',
    '/api/group-management/save',
  ]) && includesAll(settingsRoutes, [
    'createSettingsRoutes',
    '/api/api-settings/precheck',
    '/api/api-settings/save',
    '/api/api-settings/test-target',
    '/api/api-settings/test-image-runtime',
    '/api/plugin-settings/precheck',
    '/api/plugin-settings/skills-config/save',
  ]) && includesAll(helpDiyRoutes, [
    'createHelpDiyRoutes',
    '/api/help-diy/upload-image',
    '/api/help-diy/save',
  ]) && includesAll(qqSimulatorRoutes, [
    'createQqSimulatorRoutes',
    '/api/qq-simulator/scenarios/restore',
    '/api/qq-simulator/send',
  ]) && includesAll(sandboxRoutes, [
    'createSandboxRoutes',
    '/api/sandbox-chat',
    '/api/sandbox-web-read',
  ]) && includesAll(configBackupRoutes, [
    'createConfigBackupRoutes',
    '/api/config-backup',
    '/api/config-history',
    '/api/config-history/rollback',
    '/api/config-restore',
  ]) && includesAll(mediaRoutes, [
    'createMediaRoutes',
    '/api/image-proxy',
    '/console-background-image',
  ]) && includesAll(webConsoleHandlerContext, [
    'createWebConsoleHandlerContext',
    'buildBotPluginManagementPayload',
    'buildConfigDiagnosticsPayload',
    'buildGroupSummaryDiagnosticsPayload',
    'buildCommandCenterPayload',
    'buildGroupManagementPayload',
    'serveGroupManagementEventStream',
    'runSandboxChat',
  ]));
  addCheck('qq simulator scenario APIs', includesAll(webConsoleSurface, [
    '/api/qq-simulator/scenarios',
    '/api/qq-simulator/scenarios/backups',
    '/api/qq-simulator/scenarios/restore',
    'enqueueQqSimulatorScenarioTask',
    'restoreQqSimulatorScenarioBackupPayload',
  ]));
  const groupHealth = await readText('lib/webConsole/groupManagementHealth.js');
  const groupHealthFix = await readText('lib/webConsole/groupManagementHealthFix.js');
  const pluginEntry = await readText('index.js');
  const groupManagementRuntime = await readText('apps/group-management.js');
  const contentModerationRuntime = await readText('lib/groupManagement/contentModerationRuntime.js');
  addCheck('plugin class export selection', includesAll(pluginEntry, [
    'function selectPluginClass',
    'moduleExports?.default',
    'Object.values(moduleExports || {}).find(isPluginClass)',
    '没有导出有效的插件类',
  ]) && !pluginEntry.includes('ret[i].value[Object.keys(ret[i].value)[0]]') && includesAll(groupManagementRuntime, [
    'export class groupManagementRuntime extends plugin',
    'export default groupManagementRuntime',
  ]));
  addCheck('group management isolated spam listener', includesAll(groupManagementRuntime, [
    "bot.on('message.group'",
    'createGroupSpamEventSnapshot',
    'handleGroupSpamMessageEvent',
    'registerGroupSpamMessageListener',
    'setImmediate',
    "fnc: 'contentModeration'",
  ]) && includesAll(contentModerationRuntime, [
    'evaluateSpamMessageWindow',
    'handleGroupSpamModeration',
    'trackBurst: false',
    'trackRepeat: false',
  ]));
  addCheck('group management console suite module', includesAll(groupManagementConsoleSuite, [
    'createGroupManagementConsoleSuite',
    'createGroupManagementCommon',
    'createGroupWelcomeConsole',
    'groupManagementHealthFix',
    'listGroupConfigBackups',
  ]));
  addCheck('group management health fix API', includesAll(webConsoleSurface, [
    '/api/group-management/health/fix',
    'applyGroupManagementHealthFixPayload',
    'createGroupManagementHealthFix',
  ]) && includesAll(groupHealth, [
    'GROUP_MANAGEMENT_HEALTH_AUTO_FIX_CODES',
  ]) && includesAll(groupHealthFix, [
    'GROUP_MANAGEMENT_HEALTH_AUTO_FIX_CODES',
    'applyPayload',
  ]));
  const groupSettings = await readText('lib/webConsole/groupManagementSettings.js');
  addCheck('group management settings module', includesAll(webConsoleSurface, [
    'createGroupManagementSettings',
    'saveGroupManagementSafetyPayload',
    'saveGroupManagementDefaultsConfig',
  ]) && includesAll(groupSettings, [
    'createGroupManagementSettings',
    'saveSafetyPayload',
    'saveDefaultsConfig',
  ]));
  const groupBulkActions = await readText('lib/webConsole/groupManagementBulkActions.js');
  addCheck('group management bulk actions module', includesAll(webConsoleSurface, [
    'createGroupManagementBulkActions',
    'bulkEnableGroupManagementConfig',
  ]) && includesAll(groupBulkActions, [
    'createGroupManagementBulkActions',
    'bulkEnableConfig',
    'GROUP_MANAGEMENT_BULK_FEATURE_LABELS',
  ]));
  const groupJoinRequests = await readText('lib/webConsole/groupManagementJoinRequests.js');
  addCheck('group management join request module', includesAll(webConsoleSurface, [
    'createGroupManagementJoinRequests',
    'buildGroupManagementJoinRequestsPayload',
    'approveGroupManagementJoinRequestPayload',
    'rejectGroupManagementJoinRequestPayload',
  ]) && includesAll(groupJoinRequests, [
    'createGroupManagementJoinRequests',
    'approvePayload',
    'rejectPayload',
  ]));
  const groupManagementCommon = await readText('lib/webConsole/groupManagementCommon.js');
  addCheck('group management common module', includesAll(webConsoleSurface, [
    'createGroupManagementCommon',
    'normalizeGroupManagementId',
    'normalizeIntegerInRange',
  ]) && includesAll(groupManagementCommon, [
    'createGroupManagementCommon',
    'normalizeGroupIdList',
    'updateGroupIdList',
    'optionalBoolean',
  ]));
  const groupManagementMembers = await readText('lib/webConsole/groupManagementMembers.js');
  addCheck('group management members module', includesAll(webConsoleSurface, [
    'createGroupManagementMembers',
    'buildGroupManagementMembersPayload',
    'pickRuntimeGroupForManagement',
  ]) && includesAll(groupManagementMembers, [
    'createGroupManagementMembers',
    'normalizeMemberInfo',
    'collectRuntimeMembers',
    'buildPayload',
  ]));
  const groupManagementPayload = await readText('lib/webConsole/groupManagementPayload.js');
  addCheck('group management payload module', includesAll(webConsoleSurface, [
    'createGroupManagementPayload',
    'buildGroupManagementPayload',
    'collectRuntimeGroupManagementGroups',
  ]) && includesAll(groupManagementPayload, [
    'createGroupManagementPayload',
    'buildPayload',
    'selectedGroupId',
    'buildHealthPayload',
  ]));
  const groupTitleApplications = await readText('lib/webConsole/groupManagementTitleApplications.js');
  addCheck('group management title application module', includesAll(webConsoleSurface, [
    'createGroupManagementTitleApplications',
    'buildGroupManagementTitleApplicationsPayload',
    'approveGroupManagementTitleApplicationPayload',
    'rejectGroupManagementTitleApplicationPayload',
  ]) && includesAll(groupTitleApplications, [
    'createGroupManagementTitleApplications',
    'setTitleFromWebConsole',
    'approvePayload',
    'rejectPayload',
  ]));
  const groupMemberWarnings = await readText('lib/webConsole/groupManagementMemberWarnings.js');
  addCheck('group management member warning module', includesAll(webConsoleSurface, [
    'createGroupManagementMemberWarnings',
    'addGroupManagementWarningPayload',
    'clearGroupManagementWarningPayload',
  ]) && includesAll(groupMemberWarnings, [
    'createGroupManagementMemberWarnings',
    'normalizeUserId',
    'addWarningPayload',
    'clearWarningPayload',
  ]));
  const groupWelcomeConsole = await readText('lib/webConsole/groupWelcomeConsole.js');
  addCheck('group welcome console module', includesAll(webConsoleSurface, [
    'createGroupWelcomeConsole',
    'normalizeGroupWelcomeText',
    'saveGroupWelcomeImageDataUrl',
    'serveGroupWelcomeImage',
  ]) && includesAll(groupWelcomeConsole, [
    'createGroupWelcomeConsole',
    'normalizeWelcomeConfig',
    'getImagePreviewUrl',
    'saveImageDataUrl',
  ]));
  const groupEventFeed = await readText('lib/webConsole/groupManagementEventFeed.js');
  addCheck('group management SSE route', includesAll(webConsoleSurface, [
    'serveGroupManagementEventStream',
    'createGroupManagementEventFeed',
  ]) && includesAll(groupEventFeed, [
    'subscribeGroupManagementLog',
    'text/event-stream',
    'sendSseEvent',
  ]));
  const groupManagementGroupList = await readText('lib/webConsole/groupManagementGroupList.js');
  addCheck('group management group list module', includesAll(webConsoleSurface, [
    'createGroupManagementGroupList',
    'collectRuntimeGroupManagementGroups',
    'serializeGroupManagementRecord',
    'readGroupCollectionItems',
  ]) && includesAll(groupManagementGroupList, [
    'createGroupManagementGroupList',
    'getBotInstancesForGroupManagement',
    'collectConfiguredGroupManagementGroups',
    'getGroupManagementListSummary',
  ]));
  const groupManagementConfigSave = await readText('lib/webConsole/groupManagementConfigSave.js');
  addCheck('group management config save module', includesAll(webConsoleSurface, [
    'createGroupManagementConfigSave',
    'saveGroupManagementConfig',
    'rollbackGroupManagementConfigPayload',
    'buildGroupManagementAuditContext',
  ]) && includesAll(groupManagementConfigSave, [
    'createGroupManagementConfigSave',
    'buildGroupManagementRollbackWrites',
    'assertGroupManagementContentSafety',
    'ensureMainConfigFeatureEnabled',
  ]));
  const groupManagementConfigState = await readText('lib/webConsole/groupManagementConfigState.js');
  addCheck('group management config state module', includesAll(webConsoleSurface, [
    'createGroupManagementConfigState',
    'getGroupManagementConfigState',
    'buildGroupManagementConfigSnapshot',
    'normalizeAuthGroupConfig',
  ]) && includesAll(groupManagementConfigState, [
    'createGroupManagementConfigState',
    'getGroupManagementDefaultAuthConfig',
    'buildGroupManagementPermissionState',
    'getGroupManagementConfigState',
  ]));
  const groupManagementRuleDebugger = await readText('lib/webConsole/groupManagementRuleDebugger.js');
  const groupManagementRuleDebugJs = await readText('lib/webConsole/public/group-management-rule-debug.js');
  const groupManagementHtml = await readText('lib/webConsole/public/group-management.html');
  addCheck('group management rule debugger', includesAll(webConsoleSurface, [
    'createGroupManagementRuleDebugger',
    'buildGroupManagementRuleDebugPayload',
  ]) && includesAll(groupManagementRoutes, [
    '/api/group-management/rule-debug',
    'buildGroupManagementRuleDebugPayload',
  ]) && includesAll(groupManagementRuleDebugger, [
    'createGroupManagementRuleDebugger',
    'evaluateMessageRules',
    'evaluateJoinRules',
    'evaluateTitleRules',
  ]) && includesAll(groupManagementHtml, [
    'group-management-rule-debug.js',
  ]) && includesAll(groupManagementRuleDebugJs, [
    'renderRuleDebuggerPanel',
    'buildRuleDebugDraftPayload',
    '/api/group-management/rule-debug',
  ]));
  const imageMonitorConsole = await readText('lib/webConsole/imageMonitorConsole.js');
  const persistentMd5Store = await readText('lib/imageMonitor/persistentMd5Store.js');
  addCheck('image monitor console module', includesAll(webConsoleSurface, [
    'createImageMonitorConsole',
    'buildImageMonitorLogPayload',
    'cleanupImageMonitorNonMemePayload',
    'serveImageMonitorLocalImage',
  ]) && includesAll(imageMonitorConsole, [
    'createImageMonitorConsole',
    'cleanupNonMemePayload',
    'cleanupUnmatchedMemePayload',
    'serveLocalImage',
  ]));
  addCheck('image monitor persistent md5 dedup', includesAll(persistentMd5Store, [
    'createPersistentMd5Store',
    'firstSeenAt',
    'appendFileSync',
    'normalizeMd5',
  ]));
  const sandboxConsole = await readText('lib/webConsole/sandboxConsole.js');
  addCheck('sandbox console module', includesAll(webConsoleSurface, [
    'createSandboxConsole',
    'buildSandboxConfigStatusPayload',
    'runSandboxChat',
    'redactQqSimulatorMediaUrl',
  ]) && includesAll(sandboxConsole, [
    'createSandboxConsole',
    'buildSandboxPromptPreviewPayload',
    'generateKnowledgeBaseFromWebPayload',
    'normalizeSandboxImageUrls',
  ]));
  const qqSimulatorConsole = await readText('lib/webConsole/qqSimulatorConsole.js');
  addCheck('qq simulator console module', includesAll(webConsoleSurface, [
    'createQqSimulatorConsole',
    'buildQqSimulatorPreviewPayload',
    'buildQqSimulatorSendPayload',
    'enqueueQqSimulatorScenarioTask',
  ]) && includesAll(qqSimulatorConsole, [
    'createQqSimulatorConsole',
    'createQqSimulatorScenarioStore',
    'buildQqSimulatorOnebotEvent',
    'simulateQqJoinRequest',
    'simulateQqImageEditCommand',
    'would_edit_image',
    'would_fuse_images',
    'executed_image_edit',
    'confirmLiveImage',
  ]));
  const pluginSettingsConsole = await readText('lib/webConsole/pluginSettingsConsole.js');
  addCheck('plugin settings console module', includesAll(webConsoleSurface, [
    'createPluginSettingsConsole',
    'buildPluginSettingsPayload',
    'precheckPluginSettings',
    'savePluginSettings',
    'buildSkillConfigEditorPayload',
  ]) && includesAll(pluginSettingsConsole, [
    'createPluginSettingsConsole',
    'precheckPluginSettings',
    'validateSkillConfigPayload',
    'restoreMaskedSkillConfigSecrets',
    'maskDisplayUrlSecrets',
  ]));
  const overviewConsole = await readText('lib/webConsole/overviewConsole.js');
  addCheck('overview console module', includesAll(webConsoleSurface, [
    'createOverviewConsole',
    'buildOverviewPayload',
    'buildHealthPayload',
    'buildVersionCheckPayload',
    'resolvePluginsDirectory',
  ]) && includesAll(overviewConsole, [
    'createOverviewConsole',
    'getChatSnapshot',
    'buildOverviewPayload',
    'buildHealthPayload',
    'buildVersionCheckPayload',
  ]));
  const dashboardIndexHtml = await readText('lib/webConsole/public/index.html');
  const dashboardHealthJs = await readText('lib/webConsole/public/dashboard-health.js');
  const dashboardTasksJs = await readText('lib/webConsole/public/dashboard-tasks.js');
  const dashboardSecurityJs = await readText('lib/webConsole/public/dashboard-security.js');
  const dashboardAppJs = await readText('lib/webConsole/public/app.js');
  const dashboardCss = await readText('lib/webConsole/public/dashboard.css');
  addCheck('dashboard console health overview UI', includesAll(overviewConsole, [
    'webConsoleSecurity',
    'startupSelfCheck',
    'staticAssets',
    'htmlResourceVersioning',
  ]) && includesAll(dashboardIndexHtml, [
    'console-health-overview',
    '控制台健康总览',
    '需要优先处理的问题',
    '查看审计日志',
  ]) && includesAll(dashboardHealthJs, [
    'renderConsoleHealthOverview',
    'buildStartupSelfCheckHealthCard',
    'buildStaticCacheHealthCard',
    'buildSecurityHealthCard',
    'buildAuditHealthCard',
  ]) && includesAll(dashboardAppJs, [
    '/api/logs/audit?pageSize=1',
    'renderConsoleHealthOverview(overview, health, null, auditLogs, performance)',
    'renderConsoleHealthOverview(overview, health, result, auditLogs, performance)',
  ]) && includesAll(dashboardCss, [
    'console-health-overview-grid',
    'console-health-card',
    'tone-warning',
  ]));
  addCheck('dashboard operation task center UI', includesAll(webConsoleRoutes, [
    '/api/tasks',
    'buildOperationTaskCenterPayload',
    'listDependencyInstallTasks',
    'listPluginCatalogInstallTasks',
  ]) && includesAll(dashboardIndexHtml, [
    'operation-task-center',
    '操作任务中心',
    'dashboard-tasks.js',
  ]) && includesAll(dashboardTasksJs, [
    'renderOperationTaskCenter',
    'renderOperationTaskSummary',
    'renderOperationTaskItem',
    'refreshOperationTaskCenterOnly',
    'scheduleOperationTaskAutoRefresh',
    'renderOperationTaskOutput',
    'renderOperationTaskTimeline',
  ]) && includesAll(dashboardAppJs, [
    "fetchJsonSafe('/api/tasks'",
    'renderOperationTaskCenter(tasks)',
  ]) && includesAll(dashboardCss, [
    'operation-task-center-panel',
    'operation-task-summary',
    'operation-task-item',
    'operation-task-progress',
    'operation-task-output',
    'operation-task-timeline',
  ]));
  addCheck('dashboard public security panel UI', includesAll(overviewConsole, [
    'riskItems',
    'publicAccessHint',
    'writeOperationsAllowed',
  ]) && includesAll(dashboardIndexHtml, [
    'public-security-overview',
    '公网访问安全',
    'dashboard-security.js',
  ]) && includesAll(dashboardSecurityJs, [
    'renderPublicSecurityOverview',
    'copyPublicSecurityUrl',
    'enableWebConsoleReadOnlyMode',
  ]) && includesAll(dashboardAppJs, [
    "fetchJsonSafe('/api/auth/status'",
    'renderPublicSecurityOverview(overview, authStatus)',
  ]) && includesAll(dashboardCss, [
    'public-security-panel',
    'public-security-stats',
    'public-security-risk-list',
  ]));
  const publicAuthJs = await readText('lib/webConsole/public/auth.js');
  const apiSettingsPageJs = await readText('lib/webConsole/public/api-settings.js');
  const pluginSettingsPageJs = await readText('lib/webConsole/public/plugin-settings.js');
  const sharedRequestConsumerScripts = [
    await readText('lib/webConsole/public/dashboard-core.js'),
    await readText('lib/webConsole/public/usage-center.js'),
    await readText('lib/webConsole/public/collection-center.js'),
    await readText('lib/webConsole/public/dependency-check.js'),
    await readText('lib/webConsole/public/help-diy.js'),
    await readText('lib/webConsole/public/api-settings-utils.js'),
  ].join('\n');
  addCheck('web console shared request helper', includesAll(publicAuthJs, [
    'window.CrystelfRequest',
    'requestJson',
    'fetchJsonSafe',
    'downloadExport',
  ]) && includesAll(sharedRequestConsumerScripts, [
    'window.CrystelfRequest',
  ]) && !/(?:async\s+function|function)\s+(?:fetchJson|postJson|fetchJsonSafe)\s*\(/.test(sharedRequestConsumerScripts));
  addCheck('config save precheck UI', includesAll(settingsRoutes, [
    '/api/api-settings/precheck',
    '/api/plugin-settings/precheck',
  ]) && includesAll(apiSettingsPageJs, [
    '/api/api-settings/precheck',
    'confirmApiSettingsPrecheck',
    '保存 API 配置预检',
  ]) && includesAll(pluginSettingsPageJs, [
    '/api/plugin-settings/precheck',
    'confirmPluginSettingsPrecheck',
    '保存插件配置预检',
  ]));
  const webConsoleAuth = await readText('lib/webConsole/webConsoleAuth.js');
  addCheck('web console auth module', includesAll(webConsoleSurface, [
    'createWebConsoleAuth',
    'requireCsrf',
    'loginWebConsole',
    'buildAuthStatusPayload',
  ]) && includesAll(webConsoleAuth, [
    'createWebConsoleAuth',
    'parseWebConsoleSession',
    'requireSameOrigin',
    'buildLoginAttemptStatus',
    'webConsoleLoginAttempts',
  ]));
  const webConsoleConfig = await readText('lib/webConsole/webConsoleConfig.js');
  addCheck('web console config module', includesAll(webConsoleSurface, [
    'buildWebConsoleConfig',
    'createPaginator',
    'getWebConsoleDisplayUrl',
    'getPricingConfig',
  ]) && includesAll(webConsoleConfig, [
    'buildOpenAiCompatibleUrl',
    'buildWebConsoleConfig',
    'getPricingConfig',
    'createPaginator',
  ]));
  const startupSelfCheck = await readText('lib/webConsole/startupSelfCheck.js');
  const webConsoleConstants = await readText('lib/webConsole/webConsoleConstants.js');
  addCheck('web console constants module', includesAll(webConsoleSurface, [
    'WEB_CONSOLE_REQUEST_BODY_MAX_BYTES',
    'WEB_CONSOLE_AUDIT_LOG_FILE',
    'FILE_BROWSER_TEXT_EXTENSIONS',
    'SEARCH_DEBUG_LOG_FILE',
    'API_QUALITY_LOG_FILE',
    'PUBLIC_DIR',
    'QQ_SIMULATOR_ADAPTER_FORMATS',
  ]) && includesAll(webConsoleConstants, [
    'WEB_CONSOLE_DIR',
    'IMAGE_MONITOR_REVIEW_LOG',
    'GROUP_WELCOME_IMAGE_CONTENT_TYPES',
    'FILE_BROWSER_TEXT_EXTENSIONS',
  ]));
  const apiQualityLogger = await readText('lib/ai/apiQualityLogger.js');
  const apiCircuitBreaker = await readText('lib/ai/apiCircuitBreaker.js');
  const aiCaller = await readText('lib/ai/aiCaller.js');
  const imageProcessor = await readText('lib/ai/imageProcessor.js');
  const sdWebUiApi = await readText('lib/ai/sdWebUiApi.js');
  const toolRegistry = await readText('lib/ai/toolRegistry.js');
  const imageMonitorApp = await readText('apps/image-monitor.js');
  const memeCore = await readText('lib/core/meme.js');
  const ttsRegistry = await readText('lib/ai/ttsRegistry.js');
  const apiSettingsConsoleSource = await readText('lib/webConsole/apiSettingsConsole.js');
  const apiSettingsHtml = await readText('lib/webConsole/public/api-settings.html');
  const apiSettingsFormJs = await readText('lib/webConsole/public/api-settings-form.js');
  const apiSettingsImageRuntimeTestJs = await readText('lib/webConsole/public/api-settings-image-runtime-test.js');
  const aiAppSource = await readText('apps/ai.js');
  const configSourceDiagnostics = await readText('lib/webConsole/apiConfigSourceDiagnostics.js');
  const configDiagnosticsHtml = await readText('lib/webConsole/public/config-diagnostics.html');
  const configDiagnosticsJs = await readText('lib/webConsole/public/config-diagnostics.js');
  const configDiagnosticsCss = await readText('lib/webConsole/public/config-diagnostics.css');
  const frontendDiagnosticsHtml = await readText('lib/webConsole/public/frontend-diagnostics.html');
  const frontendDiagnosticsJs = await readText('lib/webConsole/public/frontend-diagnostics.js');
  const frontendDiagnosticsCss = await readText('lib/webConsole/public/frontend-diagnostics.css');
  const groupSummaryDiagnosticsHtml = await readText('lib/webConsole/public/group-summary-diagnostics.html');
  const groupSummaryDiagnosticsJs = await readText('lib/webConsole/public/group-summary-diagnostics.js');
  const groupSummaryDiagnosticsCss = await readText('lib/webConsole/public/group-summary-diagnostics.css');
  addCheck('image api mode conditional fields', includesAll(apiSettingsHtml, [
    'data-image-mode-scope="primary"',
    'data-image-mode-scope="fallback"',
    'data-image-modes="openai ark-agent-plan chat"',
    'data-image-modes="ark-agent-plan"',
    'data-image-modes="jimeng"',
    'data-image-modes="sd-webui"',
  ]) && includesAll(apiSettingsFormJs, [
    'syncImageModeFieldVisibility',
    "document.querySelectorAll('[data-image-mode-scope][data-image-modes]')",
  ]));
  addCheck('sd webui single image integration', includesAll(sdWebUiApi, [
    "IMAGE_MODE_SD_WEBUI = 'sd-webui'",
    'batch_size: 1',
    'n_iter: 1',
    'override_settings_restore_afterwards = true',
  ]) && includesAll(imageProcessor, [
    'generateOrEditImageBySdWebUi',
    "'/sdapi/v1/img2img'",
    "'/sdapi/v1/txt2img'",
  ]) && includesAll(apiSettingsHtml, [
    'image-sdWebUi-baseApi',
    'image-sdWebUi-samplerName',
    'image-fallback-sdWebUi-baseApi',
    '固定 batch_size=1、n_iter=1',
  ]));
  addCheck('image monitor storage master switch', includesAll(apiSettingsHtml, [
    'imageMonitor-storageEnabled',
    '只持久记录 MD5',
  ]) && includesAll(apiSettingsFormJs, [
    'imageMonitor.storageEnabled',
    'syncImageMonitorStorageControls',
  ]) && includesAll(apiSettingsConsoleSource, [
    'storageEnabled: imageMonitorConfig.storageEnabled === true',
    'storageEnabled: payload.imageMonitor.storageEnabled === true',
  ]));
  addCheck('explicit image edit commands', includesAll(aiAppSource, [
    "fnc: 'imageEditCommand'",
    'parseImageEditCommand',
    'collectSourceImageUrls',
    '#灵晶改图',
    '#灵晶融合',
    'requireSourceImages: true',
    'privateImageEditCommand',
    'privateCapabilities.image',
    'evaluatePrivateAiSafety',
  ]));
  addCheck('image runtime test console', includesAll(settingsRoutes, [
    '/api/api-settings/test-image-runtime',
    'testImageGenerationRuntime',
  ]) && includesAll(apiSettingsConsoleSource, [
    'testImageGenerationRuntime',
    'IMAGE_RUNTIME_TEST_MAX_SOURCE_BYTES',
    'buildImageRuntimePreview',
  ]) && includesAll(apiSettingsHtml, [
    'image-runtime-test-run-btn',
    'image-runtime-test-operation',
    'api-settings-image-runtime-test.js',
  ]) && includesAll(apiSettingsImageRuntimeTestJs, [
    'runImageRuntimeTest',
    '/api/api-settings/test-image-runtime',
    'buildApiSettingsPayloadFromDraft',
  ]));
  addCheck('external api quality logger', includesAll(apiQualityLogger, [
    'logExternalApiUsage',
    'getApiQualityLogRetentionStatus',
    'API_QUALITY_MAX_BYTES',
    'rotateApiQualityLogIfNeeded',
    'api_type',
    'api_role',
    'elapsed_ms',
  ]) && includesAll(webConsoleConstants, [
    'API_QUALITY_LOG_FILE',
    'api-quality.log',
  ]) && includesAll(memeCore, [
    'logExternalApiUsage',
    'meme_random',
    'meme_characters',
  ]) && includesAll(ttsRegistry, [
    'logExternalApiUsage',
    'tts_synthesis',
    'tts_models',
  ]));
  addCheck('api fallback circuit breaker', includesAll(apiCircuitBreaker, [
    'shouldPreferFallbackApi',
    'recordPrimaryApiFailure',
    'recordFallbackApiSuccess',
    'getApiCircuitBreakerSnapshot',
    'resetApiCircuitBreakerState',
    'failureThreshold',
    'cooldownMs',
    'buildVirtualApiCircuitConfig',
  ]) && includesAll(aiCaller, [
    'shouldPreferFallbackApi',
    'recordPrimaryApiFailure',
    'recordFallbackApiSuccess',
    '主接口处于冷却期',
  ]) && includesAll(imageProcessor, [
    'buildVirtualApiCircuitConfig',
    'image_generate',
    'recordFallbackApiSuccess',
  ]) && includesAll(imageMonitorApp, [
    'buildVirtualApiCircuitConfig',
    'image_monitor_review',
    'recordFallbackApiFailure',
    'IMAGE_MONITOR_MD5_INDEX',
    'persistentMd5Store.has(md5)',
    'persistentMd5Store.add(md5)',
    'monitorConfig.storageEnabled === true',
  ]) && includesAll(toolRegistry, [
    'buildVirtualApiCircuitConfig',
    'search_web',
    'fetch_web_markdown',
  ]) && includesAll(memeCore, [
    'buildMemeCircuitConfig',
    'sortMemeApiBasesForCircuit',
    'recordMemeCircuitResult',
  ]) && includesAll(ttsRegistry, [
    'buildTtsFallbackConfig',
    'tts_synthesis',
    'tts_models',
  ]) && includesAll(apiSettingsConsoleSource, [
    'normalizeFallbackAutoSwitch',
    'autoSwitchEnabled',
    'failureThreshold',
    'cooldownMs',
  ]) && includesAll(apiSettingsHtml, [
    'ai-fallback-autoSwitchEnabled',
    'image-fallback-failureThreshold',
    'imageMonitor-fallback-cooldownMs',
    'search-fallback-autoSwitchEnabled',
    'meme-fallback-failureThreshold',
    'data-api-test-target',
  ]) && includesAll(apiSettingsFormJs, [
    'normalizeFallbackFailureThreshold',
    'ai.fallbackApi.autoSwitchEnabled',
    'search.fallbackApi.cooldownMs',
  ]));
  addCheck('config source diagnostics page', includesAll(webConsoleSurface, [
    '/api/config/diagnostics',
    'buildConfigDiagnosticsPayload',
  ]) && includesAll(configSourceDiagnostics, [
    'createApiConfigSourceDiagnostics',
    'allFiles',
    'effectiveFields',
    'recommendations',
    'runtime-over-default',
  ]) && includesAll(configDiagnosticsHtml, [
    '配置来源诊断',
    'config-diagnostics.js',
    'config-diagnostics.css',
    'auth-guarded-page',
  ]) && includesAll(configDiagnosticsJs, [
    '/api/config/diagnostics',
    'renderEffectiveFields',
    'renderFiles',
  ]) && includesAll(configDiagnosticsCss, [
    'config-diagnostics-kpi-grid',
    'config-diagnostics-file-card',
  ]));
  const commandCenterHtml = await readText('lib/webConsole/public/command-center.html');
  const commandCenterJs = await readText('lib/webConsole/public/command-center.js');
  const commandCenterCss = await readText('lib/webConsole/public/command-center.css');
  addCheck('command center page and api', includesAll(webConsoleSurface, [
    'createCommandCenterConsole',
    'commandCenterConsole',
    '/api/command-center',
    'buildCommandCenterPayload',
  ]) && includesAll(commandCenterConsole, [
    'createCommandCenterConsole',
    'parseCommandRulesFromSource',
    'buildRisks',
    'static',
  ]) && includesAll(commandCenterHtml, [
    '命令中心',
    'command-center.js',
    'command-center.css',
    'auth-guarded-page',
  ]) && includesAll(commandCenterJs, [
    '/api/command-center',
    'renderCommandList',
    'renderRisks',
    'filterCommands',
  ]) && includesAll(commandCenterCss, [
    'command-center-kpi-grid',
    'command-center-risk-card',
    'command-center-table-wrap',
  ]));
  addCheck('global console search', includesAll(webConsoleSurface, [
    'createGlobalSearchConsole',
    'globalSearchConsole',
    '/api/global-search',
    'buildGlobalSearchPayload',
  ]) && includesAll(globalSearchConsole, [
    'createGlobalSearchConsole',
    'PAGE_ENTRIES',
    'buildCommandItems',
    'buildSettingItems',
    'buildInstalledPluginItems',
    'buildCatalogPluginItems',
  ]) && includesAll(consoleShellJs, [
    'console-global-search',
    '/api/global-search',
    'bindGlobalSearch',
    'ArrowDown',
    'aria-activedescendant',
  ]) && includesAll(publicStyles, [
    'console-global-search-panel',
    'console-global-search-item',
    'grid-column: 1 / -1',
  ]));
  addCheck('task oriented console shell', includesAll(consoleShellJs, [
    '工作台',
    '群聊运营',
    'AI 能力',
    '插件与系统',
    '诊断与调试',
    '魔丸控制台',
    'activeNavigationItem.group',
  ]) && includesAll(themeJs, [
    'console-modern.css',
    'data-console-modern-style',
    'console-shell.js',
  ]) && includesAll(consoleModernStyles, [
    'Console 3.0',
    'console-app-shell',
    'console-nav-section',
    'console-global-search',
    'task-oriented',
  ]));
  addCheck('group summary diagnostics page', includesAll(webConsoleSurface, [
    'createGroupSummaryDiagnosticsConsole',
    'groupSummaryDiagnosticsConsole',
    '/api/group-summary/diagnostics',
    'buildGroupSummaryDiagnosticsPayload',
  ]) && includesAll(groupSummaryDiagnosticsConsole, [
    'createGroupSummaryDiagnosticsConsole',
    'readDailyGroupSummaryResults',
    'listDailyGroupSummaryLocks',
    'buildRecommendations',
  ]) && includesAll(consoleShellJs, [
    '/group-summary-diagnostics.html',
    '群总结诊断',
  ]) && includesAll(globalSearchConsole, [
    'page:group-summary-diagnostics',
    '/group-summary-diagnostics.html',
    '重复发送',
  ]) && includesAll(groupSummaryDiagnosticsHtml, [
    '群总结诊断',
    'group-summary-diagnostics.js',
    'group-summary-diagnostics.css',
    'auth-guarded-page',
  ]) && includesAll(groupSummaryDiagnosticsJs, [
    '/api/group-summary/diagnostics',
    'renderRecommendations',
    'renderGroups',
    'copySummary',
  ]) && includesAll(groupSummaryDiagnosticsCss, [
    'group-summary-kpi-grid',
    'group-summary-group-card',
    'group-summary-lock-card',
  ]));
  addCheck('frontend diagnostics page', includesAll(publicAuthJs, [
    'FRONTEND_ERROR_STORAGE_KEY',
    'persistFrontendErrorState',
    'restoreFrontendErrorsFromStorage',
    'CrystelfFrontendErrors',
    'CrystelfPageLoadDiagnostics',
  ]) && includesAll(consoleShellJs, [
    '/frontend-diagnostics.html',
    '前端诊断',
  ]) && includesAll(globalSearchConsole, [
    'page:frontend-diagnostics',
    '/frontend-diagnostics.html',
    '前端错误诊断',
  ]) && includesAll(frontendDiagnosticsHtml, [
    '前端错误诊断',
    'frontend-diagnostics.js',
    'frontend-diagnostics.css',
    'auth-guarded-page',
  ]) && includesAll(frontendDiagnosticsJs, [
    'CrystelfFrontendErrors',
    'CrystelfRequest',
    'CrystelfPageLoadDiagnostics',
    'renderRecommendations',
    'clearLocalDiagnostics',
  ]) && includesAll(frontendDiagnosticsCss, [
    'frontend-diagnostics-kpi-grid',
    'frontend-diagnostics-error-card',
    'frontend-diagnostics-resource-card',
  ]));
  const performanceConsole = await readText('lib/webConsole/performanceConsole.js');
  const performancePageHtml = await readText('lib/webConsole/public/performance.html');
  const performancePageJs = await readText('lib/webConsole/public/performance.js');
  addCheck('performance api fallback quality panel', includesAll(performanceConsole, [
    'searchDebugLogFile',
    'apiQualityLogFile',
    'buildApiQualityStats',
    'buildApiQualityAlerts',
    'buildDailyApiQualityTrend',
    'buildApiFailureDiagnosis',
    'getApiCircuitBreakerSnapshot',
    'resetApiCircuitBreakerState',
    'configuredCircuitTargets',
    'getApiQualityLogRetentionStatus',
    'apiQuality',
    'normalizeSearchEntries',
    'normalizeApiQualityEntries',
    'URL 安全检查 API',
    '语音合成 API',
  ]) && includesAll(performancePageHtml, [
    'API 主备质量',
    'performance-api-quality-alerts',
    'performance-api-quality-summary',
    'performance-api-quality-retention',
    'performance-api-quality-trend',
    'performance-api-failure-diagnosis',
    'performance-api-circuit-breaker',
    'performance-api-fallback-events',
  ]) && includesAll(performancePageJs, [
    'renderApiQuality',
    'formatApiQualityAlertStatus',
    'formatCircuitStatus',
    'mergeCircuitBreakerItems',
    '/api/performance/api-circuit/reset',
    'performance-api-quality-table',
    'performance-api-role',
  ]) && includesAll(dashboardHealthJs, [
    'buildApiQualityHealthCard',
    '主备切换',
    'API 质量',
    '/performance.html',
  ]) && includesAll(dashboardAppJs, [
    "fetchJsonSafe('/api/performance?slowThresholdMs=10000'",
    'renderConsoleHealthOverview(overview, health, null, auditLogs, performance)',
  ]));
  const webConsoleRuntime = await readText('lib/webConsole/webConsoleRuntime.js');
  addCheck('web console runtime module', includesAll(webConsoleSurface, [
    'createWebConsoleRuntime',
    'webConsoleRuntime.start',
    'webConsoleRuntime.stop',
    'webConsoleRuntime.getInfo',
  ]) && includesAll(webConsoleRuntime, [
    'createWebConsoleRuntime',
    'buildStartupSelfCheckPayload',
    'formatStartupSelfCheckLines',
    'Startup self-check',
    'portAutoIncrement',
    'server.close',
    'getInfo',
  ]));
  addCheck('web console startup self check module', includesAll(server, [
    'createStartupSelfCheck',
    'startupSelfCheck',
    'buildStartupSelfCheckPayload',
  ]) && includesAll(startupSelfCheck, [
    'createStartupSelfCheck',
    'buildConfigFileChecks',
    'buildDependencySelfCheck',
    'formatStartupSelfCheckLines',
    '配置 JSON 完整性',
  ]));
  addCheck('core web console suite module', includesAll(webConsoleSurface, [
    'createCoreWebConsoleSuite',
    'httpUtils',
    'webConsoleAuth',
    'auditConsole',
    'fileBrowserConsole',
    'helpDiyConsole',
    'staticConsole',
  ]) && includesAll(coreWebConsoleSuite, [
    'createCoreWebConsoleSuite',
    'createWebConsoleHttpUtils',
    'createWebConsoleAuth',
    'createWebConsoleAuditLog',
    'createFileBrowserConsole',
    'createHelpDiyConsole',
    'createStaticConsole',
  ]));
  addCheck('data log console suite module', includesAll(webConsoleSurface, [
    'createDataLogConsoleSuite',
    'overviewConsole',
    'dependencyConsole',
    'usageTrendConsole',
    'userDataConsole',
    'logConsole',
  ]) && includesAll(dataLogConsoleSuite, [
    'createDataLogConsoleSuite',
    'createOverviewConsole',
    'createDependencyConsole',
    'createUsageTrendConsole',
    'createUserDataConsole',
    'createLogConsole',
  ]));
  addCheck('config feature console suite module', includesAll(webConsoleSurface, [
    'createConfigFeatureConsoleSuite',
    'configBackupConsole',
    'configPayloadConsole',
    'featureConfigConsole',
    'imageMonitorConsole',
    'buildConfigDiagnosticsPayload',
  ]) && includesAll(configFeatureConsoleSuite, [
    'createConfigFeatureConsoleSuite',
    'createApiConfigSourceDiagnostics',
    'createConfigBackupConsole',
    'createConfigPayloadConsole',
    'createFeatureConfigConsole',
    'createImageMonitorConsole',
    'buildConfigDiagnosticsPayload',
  ]));
  addCheck('sandbox simulator console suite module', includesAll(webConsoleSurface, [
    'createSandboxSimulatorConsoleSuite',
    'sandboxConsole',
    'qqSimulatorConsole',
    'runSandboxChat',
  ]) && includesAll(sandboxSimulatorConsoleSuite, [
    'createSandboxSimulatorConsoleSuite',
    'createSandboxConsole',
    'createQqSimulatorConsole',
    'normalizeDataUrlAttachment',
  ]));
  addCheck('plugin settings console suite module', includesAll(webConsoleSurface, [
    'createPluginSettingsConsoleSuite',
    'pluginSettingsConsole',
    'normalizePositiveNumber',
    'maskDisplayUrlSecrets',
  ]) && includesAll(pluginSettingsConsoleSuite, [
    'createPluginSettingsConsoleSuite',
    'createPluginSettingsConsole',
    'getSkillConfig',
    'normalizeSensitiveConfigKeySegment',
  ]));
  const staticConsole = await readText('lib/webConsole/staticConsole.js');
  addCheck('static console module', includesAll(webConsoleSurface, [
    'createStaticConsole',
    'serveStatic',
    'HELP_DIY_UPLOAD_DIR',
  ]) && includesAll(staticConsole, [
    'createStaticConsole',
    'serveStatic',
    'plugin-settings.html',
    'normalizeWebConsoleRedirectPath',
    'ETag',
    'Last-Modified',
    'isStaticCacheFresh',
    'injectStaticResourceVersions',
    'appendStaticResourceVersion',
  ]));
  const logFileUtils = await readText('lib/webConsole/logFileUtils.js');
  addCheck('log file utils module', includesAll(webConsoleSurface, [
    'createLogFileUtils',
    'parseJsonObjects',
    'safeReadUsageEntries',
  ]) && includesAll(logFileUtils, [
    'createLogFileUtils',
    'readTailText',
    'getDailyUsageLogFile',
    'parseJsonObjects',
  ]));
  const httpUtils = await readText('lib/webConsole/httpUtils.js');
  addCheck('web console http utils module', includesAll(webConsoleSurface, [
    'createWebConsoleHttpUtils',
    'sendJson',
    'parseRequestBody',
    'ensurePathResolvedWithinRoot',
  ]) && includesAll(httpUtils, [
    'createWebConsoleHttpUtils',
    'getSecurityHeaders',
    'REQUEST_BODY_TOO_LARGE',
    'FILE_BROWSER_PATH_OUT_OF_RANGE',
  ]));
  const botIdentityConsole = await readText('lib/webConsole/botIdentityConsole.js');
  addCheck('bot identity console module', includesAll(webConsoleSurface, [
    'createBotIdentityConsole',
    'buildBotIdentitySnapshot',
    'resolveRuntimeMemeCharacter',
  ]) && includesAll(botIdentityConsole, [
    'createBotIdentityConsole',
    'extractPersonaDisplayName',
    'isLegacyDefaultMemeCharacter',
    'replaceControlCharacters',
  ]));
  const secretUtils = await readText('lib/webConsole/secretUtils.js');
  addCheck('secret utils module', includesAll(webConsoleSurface, [
    'createSecretUtils',
    'hasConfiguredSecret',
    'maskSecretValue',
  ]) && includesAll(secretUtils, [
    'createSecretUtils',
    'isPlaceholderSecret',
    'your-api-key',
    'maskSecretValue',
  ]));
  const fileBrowserConsole = await readText('lib/webConsole/fileBrowserConsole.js');
  addCheck('file browser console module', includesAll(webConsoleSurface, [
    'createFileBrowserConsole',
    'buildFileBrowserTreePayload',
    'writeFileBrowserFile',
    'searchFileBrowserContent',
  ]) && includesAll(fileBrowserConsole, [
    'createFileBrowserConsole',
    'buildHighlightPayload',
    'buildTreePayload',
    'searchContent',
  ]));
  const configBackupConsole = await readText('lib/webConsole/configBackupConsole.js');
  addCheck('config backup console module', includesAll(webConsoleSurface, [
    'createConfigBackupConsole',
    'buildConfigBackupPayload',
    'buildConfigHistoryPayload',
    'buildConfigRestorePreviewPayload',
    'rollbackConfigHistoryPayload',
    'restoreConfigBackupPayload',
    'rollbackConfigHistory',
  ]) && includesAll(configBackupConsole, [
    'createConfigBackupConsole',
    'isSensitiveConfigKeySegment',
    'buildHistoryPayload',
    'rollbackHistoryPayload',
    'buildRestorePreviewPayload',
    'restoreBackupPayload',
  ]));
  const configPayloadConsole = await readText('lib/webConsole/configPayloadConsole.js');
  addCheck('config payload console module', includesAll(webConsoleSurface, [
    'createConfigPayloadConsole',
    'buildConfigPayload',
    'maskConfigPayloadSecrets',
  ]) && includesAll(configPayloadConsole, [
    'createConfigPayloadConsole',
    'readOnly',
    'fallbackTimeoutReply',
    'maskConfigPayloadSecrets',
  ]));
  addCheck('media api console suite module', includesAll(webConsoleSurface, [
    'createMediaApiConsoleSuite',
    'remoteImageProxy',
    'consoleBackground',
    'apiSettingsConsole',
    'memeConsole',
  ]) && includesAll(mediaApiConsoleSuite, [
    'createMediaApiConsoleSuite',
    'createRemoteImageProxy',
    'createConsoleBackground',
    'createMemeLocalPath',
    'createApiSettingsConsole',
    'createMemeConsole',
  ]));
  const remoteImageProxy = await readText('lib/webConsole/remoteImageProxy.js');
  addCheck('remote image proxy module', includesAll(webConsoleSurface, [
    'createRemoteImageProxy',
    'fetchRemoteImageResponseSafe',
    'proxyRemoteImageSafe',
    'normalizeImageContentTypeSafe',
  ]) && includesAll(remoteImageProxy, [
    'createRemoteImageProxy',
    'assertSafeTarget',
    'proxyImage',
    'normalizeImageContentType',
  ]));
  const consoleBackground = await readText('lib/webConsole/consoleBackground.js');
  addCheck('console background module', includesAll(webConsoleSurface, [
    'createConsoleBackground',
    'normalizeConsoleBackgroundSourceUrl',
    'refreshConsoleBackgroundCache',
    'serveConsoleBackgroundImage',
  ]) && includesAll(consoleBackground, [
    'createConsoleBackground',
    'buildFallbackSvg',
    'writeFallbackCache',
    'serveImage',
  ]));
  const usageTrendConsole = await readText('lib/webConsole/usageTrendConsole.js');
  addCheck('usage trend console module', includesAll(webConsoleSurface, [
    'createUsageTrendConsole',
    'buildUsageTrendPayload',
    'buildImageMonitorUsageTrendPayload',
    'buildPokeImageSummaryTrendPayload',
  ]) && includesAll(usageTrendConsole, [
    'createUsageTrendConsole',
    'buildUsageTrendPayload',
    'buildImageMonitorUsageTrendPayload',
    'buildPokeImageSummaryTrendPayload',
  ]));
  const logConsole = await readText('lib/webConsole/logConsole.js');
  addCheck('log console module', includesAll(webConsoleSurface, [
    'createLogConsole',
    'buildLogsPayload',
    'buildGroupManagementLogEntries',
    'exportDataAsText',
  ]) && includesAll(logConsole, [
    'createLogConsole',
    'sanitizeUsagePreviewText',
    'attachGroupManagementLogDisplayFields',
    'findUsageLogEntry',
  ]));
  const userDataConsole = await readText('lib/webConsole/userDataConsole.js');
  addCheck('user data console module', includesAll(webConsoleSurface, [
    'createUserDataConsole',
    'buildAffinityListPayload',
    'buildSessionDebugPayload',
    'resetSessionMessagesOnly',
  ]) && includesAll(userDataConsole, [
    'createUserDataConsole',
    'buildUserNameMap',
    'buildProfileDetailPayload',
    'resetSessionRecord',
  ]));
  const dependencyConsole = await readText('lib/webConsole/dependencyConsole.js');
  const dependencyCheckJs = await readText('lib/webConsole/public/dependency-check.js');
  const dependencyCheckRenderJs = await readText('lib/webConsole/public/dependency-check-render.js');
  const dependencyCheckCss = await readText('lib/webConsole/public/dependency-check.css');
  addCheck('dependency console module', includesAll(webConsoleSurface, [
    'createDependencyConsole',
    'buildDependencyReport',
    'createDependencyInstallTask',
    'createMissingDependencyInstallTasks',
    'precheckDependencyInstallRequest',
    'precheckMissingDependencyInstallTasks',
    'listDependencyInstallTasks',
  ]) && includesAll(dependencyConsole, [
    'createDependencyConsole',
    'buildDependencyReport',
    'collectInstallableDependencyItems',
    'precheckDependencyInstallTarget',
    'resolveDependencyInstallRequest',
    'runDependencyInstallTargetExclusive',
    'pushDependencyInstallTaskOutputEvent',
    'progressPercent',
    'outputEvents',
  ]) && includesAll(dependencyCheckJs, [
    'formatDurationMs',
    'progressPercent',
    'outputEvents',
    'latestOutputAt',
  ]) && includesAll(dependencyCheckRenderJs, [
    'renderInstallTaskProgress',
    'renderInstallTaskOutputEvents',
    'dependency-task-output-stream',
  ]) && includesAll(dependencyCheckCss, [
    'dependency-task-progress',
    'dependency-task-output-stream',
  ]));
  const botPluginConsole = await readText('lib/webConsole/botPluginConsole.js');
  const botPluginsHtml = await readText('lib/webConsole/public/bot-plugins.html');
  const botPluginsJs = await readText('lib/webConsole/public/bot-plugins.js');
  const pluginCatalogJs = await readText('lib/webConsole/public/plugin-catalog.js');
  const botPluginsCss = await readText('lib/webConsole/public/bot-plugins.css');
  const pluginCatalogAliasHtml = await readText('lib/webConsole/public/plugin-catalog.html');
  addCheck('bot plugin management console module', includesAll(webConsoleSurface, [
    'createBotPluginConsole',
    'botPluginConsole',
    'buildBotPluginManagementPayload',
    '/api/bot-plugins',
  ]) && includesAll(botPluginConsole, [
    'createBotPluginConsole',
    'readGitInfo',
    'buildPayload',
    'PLUGIN_SCAN_LIMIT',
  ]) && includesAll(botPluginsHtml, [
    'bot-plugins.js',
    '机器人插件管理',
    'bot-plugins-list',
    'installed-tab',
    'catalog-tab',
  ]) && includesAll(botPluginsJs, [
    '/api/bot-plugins',
    'renderPluginList',
    'buildFileBrowserUrl',
    'switchTopTab',
    'getInitialTab',
  ]) && includesAll(pluginCatalogJs, [
    'renderTaskProgress',
    'renderTaskOutputEvents',
    'progressPercent',
    'outputEvents',
    'install-status',
  ]) && includesAll(botPluginsCss, [
    'plugin-catalog-task-progress',
    'plugin-catalog-task-output',
  ]) && includesAll(pluginCatalogAliasHtml, [
    '/bot-plugins.html?tab=catalog',
    'window.location.replace',
  ]));
  const featureConfigConsole = await readText('lib/webConsole/featureConfigConsole.js');
  addCheck('feature config console module', includesAll(webConsoleSurface, [
    'createFeatureConfigConsole',
    'buildEditableConfigPayload',
    'manageFeatureToggle',
    'saveEditableConfig',
  ]) && includesAll(featureConfigConsole, [
    'createFeatureConfigConsole',
    'normalizeFeatureToggleBackup',
    'buildFeatureToggleHelpPreviewPayload',
    'toggleFeatureState',
  ]));
  const apiSettingsConsole = await readText('lib/webConsole/apiSettingsConsole.js');
  addCheck('api settings console module', includesAll(webConsoleSurface, [
    'createApiSettingsConsole',
    'buildApiSettingsPayload',
    'precheckApiSettings',
    'saveApiSettings',
    'testImageApiConnection',
    'testApiTargetConnection',
  ]) && includesAll(apiSettingsConsole, [
    'createApiSettingsConsole',
    'resolveSecretSaveValue',
    'precheckApiSettings',
    'testApiTargetConnection',
    'testImageMonitorApiConnection',
    'testSearchApiConnection',
  ]));
  const memeConsole = await readText('lib/webConsole/memeConsole.js');
  addCheck('meme console module', includesAll(webConsoleSurface, [
    'createMemeConsole',
    'testMemeApiConnection',
    'pullRemoteMemeToLocal',
    'buildLocalMemeScanPayload',
  ]) && includesAll(memeConsole, [
    'createMemeConsole',
    'inspectRemoteMemeImage',
    'sanitizeMemePathSegment',
    'pullRemoteToLocal',
  ]));
  const memeLocalPath = await readText('lib/webConsole/memeLocalPath.js');
  addCheck('meme local path module', includesAll(webConsoleSurface, [
    'createMemeLocalPath',
    'normalizeWebConsoleMemeLocalBaseDir',
  ]) && includesAll(memeLocalPath, [
    'createMemeLocalPath',
    'normalizeLocalBaseDir',
    'ensurePathResolvedWithinRoot',
    'MEME_LOCAL_DIR_OUT_OF_RANGE',
  ]));
  const helpDiyConsole = await readText('lib/webConsole/helpDiyConsole.js');
  addCheck('help diy console module', includesAll(webConsoleSurface, [
    'createHelpDiyConsole',
    'buildHelpDiyPayload',
    'saveHelpDiyPayload',
    'deleteHelpDiyImage',
  ]) && includesAll(helpDiyConsole, [
    'createHelpDiyConsole',
    'getTemplates',
    'buildImportPreviewPayload',
    'saveImage',
  ]));

  const groupLog = await readText('lib/groupManagement/groupManagementLog.js');
  addCheck('group management log subscription', includesAll(groupLog, [
    'subscribeGroupManagementLog',
    'emitGroupManagementLog',
    'groupManagementLogSubscribers',
  ]));

  const qqSimulator = [
    await readText('lib/webConsole/public/qq-simulator.js'),
    await readText('lib/webConsole/public/qq-simulator-scenarios.js'),
  ].join('\n');
  addCheck('qq simulator scenario UI handlers', includesAll(qqSimulator, [
    'scenarioSearch',
    'scenarioFilter',
    'getScenarioConflictStrategy',
    'openScenarioBackupsModal',
    'confirmQqSimulatorModal',
  ]));

  const groupManagement = [
    await readText('lib/webConsole/public/group-management.js'),
    await readText('lib/webConsole/public/group-management-health.js'),
    await readText('lib/webConsole/public/group-management-events.js'),
  ].join('\n');
  addCheck('group management frontend health fix and SSE', includesAll(groupManagement, [
    'applyGroupManagementHealthFix',
    'buildGroupManagementEventStreamUrl',
    'EventSource',
    'addGroupManagementEventItems',
  ]));

  const directPuppeteerRefs = await findDirectPuppeteerRendererReferences();
  const sharedPuppeteerRenderer = await readText('lib/system/puppeteerRenderer.js');
  addCheck('shared puppeteer renderer', directPuppeteerRefs.length === 0 && includesAll(sharedPuppeteerRenderer, [
    'withPuppeteerPage',
    'renderHtmlToImage',
    'closeSharedPuppeteerBrowser',
    'DEFAULT_MAX_CONCURRENT_PAGES',
  ]), directPuppeteerRefs.join(', '));

  const failed = checks.filter(item => !item.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
