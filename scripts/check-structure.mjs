import fs from 'fs/promises';
import path from 'path';

const root = process.cwd();
const checks = [];

function addCheck(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

function includesAll(text, patterns = []) {
  return patterns.every(pattern => text.includes(pattern));
}

async function main() {
  const pkg = JSON.parse(await readText('package.json'));
  addCheck('package name', pkg.name === 'crystelf-plugin', `name=${pkg.name}`);
  addCheck('encoding script exists', Boolean(pkg.scripts?.['check:encoding']));
  addCheck('structure script exists', Boolean(pkg.scripts?.['check:structure']));

  const server = await readText('lib/webConsole/server.js');
  const configFeatureConsoleSuite = await readText('lib/webConsole/configFeatureConsoleSuite.js');
  const coreWebConsoleSuite = await readText('lib/webConsole/coreWebConsoleSuite.js');
  const dataLogConsoleSuite = await readText('lib/webConsole/dataLogConsoleSuite.js');
  const groupManagementConsoleSuite = await readText('lib/webConsole/groupManagementConsoleSuite.js');
  const mediaApiConsoleSuite = await readText('lib/webConsole/mediaApiConsoleSuite.js');
  const pluginSettingsConsoleSuite = await readText('lib/webConsole/pluginSettingsConsoleSuite.js');
  const sandboxSimulatorConsoleSuite = await readText('lib/webConsole/sandboxSimulatorConsoleSuite.js');
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
    groupManagementConsoleSuite,
    mediaApiConsoleSuite,
    pluginSettingsConsoleSuite,
    sandboxSimulatorConsoleSuite,
    webConsoleRoutes,
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
  ]) && includesAll(fileBrowserRoutes, [
    'createFileBrowserRoutes',
    '/api/file-browser/tree',
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
    '/api/dependencies/install-history',
  ]) && includesAll(userDataRoutes, [
    'createUserDataRoutes',
    '/api/affinity',
    '/api/sessions/reset',
  ]) && includesAll(logRoutes, [
    'createLogRoutes',
    '/api/logs/image-monitor',
    '/api/trend/usage',
  ]) && includesAll(groupManagementRoutes, [
    'createGroupManagementRoutes',
    '/api/group-management/events',
    '/api/group-management/save',
  ]) && includesAll(settingsRoutes, [
    'createSettingsRoutes',
    '/api/api-settings/save',
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
    '/api/config-restore',
  ]) && includesAll(mediaRoutes, [
    'createMediaRoutes',
    '/api/image-proxy',
    '/console-background-image',
  ]) && includesAll(webConsoleHandlerContext, [
    'createWebConsoleHandlerContext',
    'buildBotPluginManagementPayload',
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
  const imageMonitorConsole = await readText('lib/webConsole/imageMonitorConsole.js');
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
  ]));
  const pluginSettingsConsole = await readText('lib/webConsole/pluginSettingsConsole.js');
  addCheck('plugin settings console module', includesAll(webConsoleSurface, [
    'createPluginSettingsConsole',
    'buildPluginSettingsPayload',
    'savePluginSettings',
    'buildSkillConfigEditorPayload',
  ]) && includesAll(pluginSettingsConsole, [
    'createPluginSettingsConsole',
    'validateSkillConfigPayload',
    'restoreMaskedSkillConfigSecrets',
    'maskDisplayUrlSecrets',
  ]));
  const overviewConsole = await readText('lib/webConsole/overviewConsole.js');
  addCheck('overview console module', includesAll(webConsoleSurface, [
    'createOverviewConsole',
    'buildOverviewPayload',
    'buildHealthPayload',
    'resolvePluginsDirectory',
  ]) && includesAll(overviewConsole, [
    'createOverviewConsole',
    'getChatSnapshot',
    'buildOverviewPayload',
    'buildHealthPayload',
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
  const webConsoleConstants = await readText('lib/webConsole/webConsoleConstants.js');
  addCheck('web console constants module', includesAll(webConsoleSurface, [
    'WEB_CONSOLE_REQUEST_BODY_MAX_BYTES',
    'FILE_BROWSER_TEXT_EXTENSIONS',
    'PUBLIC_DIR',
    'QQ_SIMULATOR_ADAPTER_FORMATS',
  ]) && includesAll(webConsoleConstants, [
    'WEB_CONSOLE_DIR',
    'IMAGE_MONITOR_REVIEW_LOG',
    'GROUP_WELCOME_IMAGE_CONTENT_TYPES',
    'FILE_BROWSER_TEXT_EXTENSIONS',
  ]));
  const webConsoleRuntime = await readText('lib/webConsole/webConsoleRuntime.js');
  addCheck('web console runtime module', includesAll(webConsoleSurface, [
    'createWebConsoleRuntime',
    'webConsoleRuntime.start',
    'webConsoleRuntime.stop',
    'webConsoleRuntime.getInfo',
  ]) && includesAll(webConsoleRuntime, [
    'createWebConsoleRuntime',
    'portAutoIncrement',
    'server.close',
    'getInfo',
  ]));
  addCheck('core web console suite module', includesAll(webConsoleSurface, [
    'createCoreWebConsoleSuite',
    'httpUtils',
    'webConsoleAuth',
    'fileBrowserConsole',
    'helpDiyConsole',
    'staticConsole',
  ]) && includesAll(coreWebConsoleSuite, [
    'createCoreWebConsoleSuite',
    'createWebConsoleHttpUtils',
    'createWebConsoleAuth',
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
  ]) && includesAll(configFeatureConsoleSuite, [
    'createConfigFeatureConsoleSuite',
    'createConfigBackupConsole',
    'createConfigPayloadConsole',
    'createFeatureConfigConsole',
    'createImageMonitorConsole',
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
    'buildConfigRestorePreviewPayload',
    'restoreConfigBackupPayload',
  ]) && includesAll(configBackupConsole, [
    'createConfigBackupConsole',
    'isSensitiveConfigKeySegment',
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
  addCheck('dependency console module', includesAll(webConsoleSurface, [
    'createDependencyConsole',
    'buildDependencyReport',
    'createDependencyInstallTask',
    'listDependencyInstallTasks',
  ]) && includesAll(dependencyConsole, [
    'createDependencyConsole',
    'buildDependencyReport',
    'resolveDependencyInstallRequest',
    'runDependencyInstallTargetExclusive',
  ]));
  const botPluginConsole = await readText('lib/webConsole/botPluginConsole.js');
  const botPluginsHtml = await readText('lib/webConsole/public/bot-plugins.html');
  const botPluginsJs = await readText('lib/webConsole/public/bot-plugins.js');
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
    'Bot 插件管理',
    'bot-plugins-list',
    'installed-tab',
    'catalog-tab',
  ]) && includesAll(botPluginsJs, [
    '/api/bot-plugins',
    'renderPluginList',
    'buildFileBrowserUrl',
    'switchTopTab',
    'getInitialTab',
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
    'saveApiSettings',
    'testImageApiConnection',
  ]) && includesAll(apiSettingsConsole, [
    'createApiSettingsConsole',
    'resolveSecretSaveValue',
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

  const qqSimulator = await readText('lib/webConsole/public/qq-simulator.js');
  addCheck('qq simulator scenario UI handlers', includesAll(qqSimulator, [
    'scenarioSearch',
    'scenarioFilter',
    'getScenarioConflictStrategy',
    'openScenarioBackupsModal',
    'confirmQqSimulatorModal',
  ]));

  const groupManagement = await readText('lib/webConsole/public/group-management.js');
  addCheck('group management frontend health fix and SSE', includesAll(groupManagement, [
    'applyGroupManagementHealthFix',
    'buildGroupManagementEventStreamUrl',
    'EventSource',
    'addGroupManagementEventItems',
  ]));

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
