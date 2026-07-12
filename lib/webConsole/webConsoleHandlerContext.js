import {
  clearPrivateAiSafetyRecords,
  clearPrivateAiSafetyReviewCache,
  getPrivateAiSafetyManagementPayload,
  unblockPrivateAiSafetyUser,
} from '../ai/privateAiSafety.js';

function assertHandlerContext(context = {}) {
  const missing = [];
  for (const [key, value] of Object.entries(context)) {
    if (key === 'ConfigControl') {
      if (!value || typeof value.get !== 'function') missing.push(`${key}.get`);
      continue;
    }
    if (key === 'logger') {
      if (!value || typeof value.error !== 'function') missing.push(`${key}.error`);
      continue;
    }
    if (typeof value !== 'function') {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Web console handler context is missing: ${missing.join(', ')}`);
  }
}

export function createWebConsoleHandlerContext(options = {}) {
  const {
    ConfigControl,
    logger,
    getWebConsoleConfig,
    listGroupConfigBackups,
    httpUtils = {},
    webConsoleAuth = {},
    auditConsole = {},
    fileBrowserConsole = {},
    botPluginConsole = {},
    pluginCatalogConsole = {},
    dependencyConsole = {},
    userDataConsole = {},
    logConsole = {},
    logDiagnosisConsole = {
      buildSupportBundlePayload: async () => ({ success: false, error: '排障包模块不可用' }),
      diagnosePayload: async () => ({ success: false, error: '日志排查模块不可用' }),
    },
    performanceConsole = {},
    configBackupConsole = {},
    configPayloadConsole = {},
    configDiagnosticsConsole = {
      buildPayload: () => ({ success: false, error: '配置来源诊断模块不可用' }),
    },
    apiSettingsConsole = {},
    memeConsole = {},
    featureConfigConsole = {},
    imageMonitorConsole = {},
    sandboxConsole = {},
    qqSimulatorConsole = {},
    commandCenterConsole = {},
    globalSearchConsole = {
      buildPayload: async () => ({ success: false, error: '全局搜索模块不可用' }),
    },
    groupSummaryDiagnosticsConsole = {
      buildPayload: async () => ({ success: false, error: '群总结诊断模块不可用' }),
    },
    staticConsole = {},
    usageTrendConsole = {},
    overviewConsole = {},
    pluginSettingsConsole = {},
    remoteImageProxy = {},
    consoleBackground = {},
    groupManagementCommon = {},
    groupManagementEventFeed = {},
    groupWelcomeConsole = {},
    groupManagementPayload = {},
    groupManagementRuleDebugger = {},
    groupManagementMembers = {},
    groupManagementJoinRequests = {},
    groupManagementMemberWarnings = {},
    groupManagementTitleApplications = {},
    groupManagementConfigSave = {},
    groupManagementBulkActions = {},
    groupManagementSettings = {},
    groupManagementHealthFix = {},
  } = options;

  const context = {
    ConfigControl,
    logger,
    getWebConsoleConfig,
    listGroupConfigBackups,
    addGroupManagementWarningPayload: groupManagementMemberWarnings.addWarningPayload,
    applyGroupManagementHealthFixPayload: groupManagementHealthFix.applyPayload,
    attachWebConsoleAudit: auditConsole.attachWebConsoleAudit,
    approveGroupManagementJoinRequestPayload: groupManagementJoinRequests.approvePayload,
    approveGroupManagementTitleApplicationPayload: groupManagementTitleApplications.approvePayload,
    buildAffinityHistoryPayload: userDataConsole.buildAffinityHistoryPayload,
    buildAffinityListPayload: userDataConsole.buildAffinityListPayload,
    buildAffinityLogEntries: logConsole.buildAffinityLogEntries,
    buildApiSettingsPayload: apiSettingsConsole.buildApiSettingsPayload,
    buildAuthStatusPayload: webConsoleAuth.buildAuthStatusPayload,
    buildWebConsoleAuditLogEntries: auditConsole.buildWebConsoleAuditLogEntries,
    buildBotPluginManagementPayload: botPluginConsole.buildPayload,
    buildCommandCenterPayload: commandCenterConsole.buildPayload,
    buildGlobalSearchPayload: globalSearchConsole.buildPayload,
    buildPluginCatalogPayload: pluginCatalogConsole.buildPayload,
    buildConfigBackupPayload: configBackupConsole.buildBackupPayload,
    buildConfigDiagnosticsPayload: configDiagnosticsConsole.buildPayload,
    buildConfigHistoryPayload: configBackupConsole.buildHistoryPayload,
    buildConfigPayload: configPayloadConsole.buildConfigPayload,
    buildConfigRestorePreviewPayload: configBackupConsole.buildRestorePreviewPayload,
    buildDependencyReport: dependencyConsole.buildDependencyReport,
    buildEditableConfigPayload: featureConfigConsole.buildEditableConfigPayload,
    buildFeatureToggleHelpPreviewPayload: featureConfigConsole.buildFeatureToggleHelpPreviewPayload,
    buildFileBrowserHighlightPayload: fileBrowserConsole.buildHighlightPayload,
    buildFileBrowserNodePayload: fileBrowserConsole.buildNodePayload,
    buildFileBrowserTreePayload: fileBrowserConsole.buildTreePayload,
    buildGroupManagementAuditContext: groupManagementConfigSave.buildGroupManagementAuditContext,
    buildGroupManagementEventFeedPayload: groupManagementEventFeed.buildPayload,
    buildGroupManagementJoinRequestsPayload: groupManagementJoinRequests.buildPayload,
    buildGroupManagementLogEntries: logConsole.buildGroupManagementLogEntries,
    buildGroupManagementMembersPayload: groupManagementMembers.buildPayload,
    buildGroupManagementPayload: groupManagementPayload.buildPayload,
    buildGroupManagementRuleDebugPayload: groupManagementRuleDebugger.buildPayload,
    buildGroupSummaryDiagnosticsPayload: groupSummaryDiagnosticsConsole.buildPayload,
    buildGroupManagementTitleApplicationsPayload: groupManagementTitleApplications.buildPayload,
    buildHealthPayload: overviewConsole.buildHealthPayload,
    buildHelpDiyHistoryPayload: options.helpDiyConsole?.buildHistoryPayload,
    buildHelpDiyImportPreviewPayload: options.helpDiyConsole?.buildImportPreviewPayload,
    buildHelpDiyPayload: options.helpDiyConsole?.buildPayload,
    buildImageMonitorLogPayload: imageMonitorConsole.buildLogPayload,
    buildImageMonitorUsageTrendPayload: usageTrendConsole.buildImageMonitorUsageTrendPayload,
    buildLocalMemeScanPayload: memeConsole.buildLocalScanPayload,
    buildLogsPayload: logConsole.buildLogsPayload,
    diagnoseBotLogsPayload: logDiagnosisConsole.diagnosePayload,
    buildOverviewPayload: overviewConsole.buildOverviewPayload,
    buildPerformancePayload: performanceConsole.buildPayload,
    buildPluginSettingsPayload: pluginSettingsConsole.buildPluginSettingsPayload,
    buildPrivateAiSafetyPayload: async () => {
      const allConfigs = ConfigControl.get() || {};
      return { success: true, data: getPrivateAiSafetyManagementPayload(allConfigs?.config?.privateAiSafety || {}) };
    },
    buildPokeImageSummaryTrendPayload: usageTrendConsole.buildPokeImageSummaryTrendPayload,
    buildProfileDetailPayload: userDataConsole.buildProfileDetailPayload,
    buildProfilesPayload: userDataConsole.buildProfilesPayload,
    buildQqSimulatorPreviewPayload: qqSimulatorConsole.buildQqSimulatorPreviewPayload,
    buildQqSimulatorScenarioBackupListPayload: qqSimulatorConsole.buildQqSimulatorScenarioBackupListPayload,
    buildQqSimulatorSendPayload: qqSimulatorConsole.buildQqSimulatorSendPayload,
    buildSandboxConfigStatusPayload: sandboxConsole.buildSandboxConfigStatusPayload,
    buildSandboxPromptPreviewPayload: sandboxConsole.buildSandboxPromptPreviewPayload,
    buildSandboxWebReadPayload: sandboxConsole.buildSandboxWebReadPayload,
    buildSessionDebugPayload: userDataConsole.buildSessionDebugPayload,
    buildSessionListPayload: userDataConsole.buildSessionListPayload,
    buildSkillConfigEditorPayload: pluginSettingsConsole.buildSkillConfigEditorPayload,
    buildSupportBundlePayload: logDiagnosisConsole.buildSupportBundlePayload,
    buildUsageLogEntries: logConsole.buildUsageLogEntries,
    buildUsageTrendPayload: usageTrendConsole.buildUsageTrendPayload,
    buildVersionCheckPayload: overviewConsole.buildVersionCheckPayload,
    buildWebConsoleAuthCookieClearHeader: webConsoleAuth.buildWebConsoleAuthCookieClearHeader,
    bulkEnableGroupManagementConfig: groupManagementBulkActions.bulkEnableConfig,
    cleanupImageMonitorNonMemePayload: imageMonitorConsole.cleanupNonMemePayload,
    cleanupImageMonitorUnmatchedMemePayload: imageMonitorConsole.cleanupUnmatchedMemePayload,
    clearDependencyInstallHistory: dependencyConsole.clearDependencyInstallHistory,
    clearGroupManagementWarningPayload: groupManagementMemberWarnings.clearWarningPayload,
    clearHelpDiyHistory: options.helpDiyConsole?.clearHistory,
    clearPrivateAiSafetyRecordsPayload: async (payload = {}) => {
      clearPrivateAiSafetyRecords({ clearBlacklist: payload?.clearBlacklist === true });
      const allConfigs = ConfigControl.get() || {};
      return { success: true, data: getPrivateAiSafetyManagementPayload(allConfigs?.config?.privateAiSafety || {}) };
    },
    clearPrivateAiSafetyReviewCachePayload: async () => {
      const removed = clearPrivateAiSafetyReviewCache();
      const allConfigs = ConfigControl.get() || {};
      return { success: true, removed, data: getPrivateAiSafetyManagementPayload(allConfigs?.config?.privateAiSafety || {}) };
    },
    clearQqSimulatorScenariosPayload: qqSimulatorConsole.clearQqSimulatorScenariosPayload,
    cancelPluginCatalogInstallTask: pluginCatalogConsole.cancelInstallTask,
    convertGroupManagementLogToScenarioPayload: qqSimulatorConsole.convertGroupManagementLogToScenarioPayload,
    createDependencyInstallTask: dependencyConsole.createDependencyInstallTask,
    createMissingDependencyInstallTasks: dependencyConsole.createMissingDependencyInstallTasks,
    createPluginCatalogInstallTask: pluginCatalogConsole.createInstallTask,
    createFileBrowserDirectory: fileBrowserConsole.createDirectory,
    createFileBrowserFile: fileBrowserConsole.createFile,
    deleteBotPlugin: botPluginConsole.deletePlugin,
    deleteFileBrowserNode: fileBrowserConsole.deleteNode,
    deleteHelpDiyHistoryItem: options.helpDiyConsole?.deleteHistoryItem,
    deleteHelpDiyImage: options.helpDiyConsole?.deleteImage,
    deleteQqSimulatorScenarioPayload: qqSimulatorConsole.deleteQqSimulatorScenarioPayload,
    deleteUserProfile: userDataConsole.deleteUserProfile,
    enqueueQqSimulatorScenarioTask: qqSimulatorConsole.enqueueQqSimulatorScenarioTask,
    exportDataAsText: logConsole.exportDataAsText,
    findAffinityLogEntry: logConsole.findAffinityLogEntry,
    findImageMonitorLogEntry: imageMonitorConsole.findLogEntry,
    findUsageLogEntry: logConsole.findUsageLogEntry,
    generateKnowledgeBaseFromWebPayload: sandboxConsole.generateKnowledgeBaseFromWebPayload,
    getDependencyInstallTask: dependencyConsole.getDependencyInstallTask,
    getPluginCatalogInstallTask: pluginCatalogConsole.getTask,
    getHelpDiyTemplates: options.helpDiyConsole?.getTemplates,
    generateHelpDiyImage: options.helpDiyConsole?.generateImage,
    getHttpErrorStatus: httpUtils.getHttpErrorStatus,
    getSkillSecretSourceConfigs: pluginSettingsConsole.getSkillSecretSourceConfigs,
    importQqSimulatorScenariosPayload: qqSimulatorConsole.importQqSimulatorScenariosPayload,
    isBootstrapApiPath: webConsoleAuth.isBootstrapApiPath,
    isBootstrapSetupRequest: webConsoleAuth.isBootstrapSetupRequest,
    isLogExportType: logConsole.isLogExportType,
    listDependencyInstallTasks: dependencyConsole.listDependencyInstallTasks,
    listPluginCatalogInstallTasks: pluginCatalogConsole.listTasks,
    listQqSimulatorScenariosPayload: qqSimulatorConsole.listQqSimulatorScenariosPayload,
    loginWebConsole: webConsoleAuth.loginWebConsole,
    loginWebConsoleWithTicket: webConsoleAuth.loginWebConsoleWithTicket,
    manageFeatureToggle: featureConfigConsole.manageFeatureToggle,
    normalizeGroupManagementId: groupManagementCommon.normalizeGroupManagementId,
    normalizeImageContentTypeSafe: remoteImageProxy.normalizeImageContentType,
    parseRequestBody: httpUtils.parseRequestBody,
    precheckApiSettings: apiSettingsConsole.precheckApiSettings,
    precheckDependencyInstallRequest: dependencyConsole.precheckDependencyInstallRequest,
    precheckMissingDependencyInstallTasks: dependencyConsole.precheckMissingDependencyInstallTasks,
    precheckPluginCatalogInstallTask: pluginCatalogConsole.precheckInstallTask,
    precheckPluginSettings: pluginSettingsConsole.precheckPluginSettings,
    proxyRemoteImageSafe: remoteImageProxy.proxyImage,
    pullRemoteMemeToLocal: memeConsole.pullRemoteToLocal,
    readFileBrowserFile: fileBrowserConsole.readFile,
    refreshConsoleBackgroundCache: consoleBackground.refreshCache,
    rejectGroupManagementJoinRequestPayload: groupManagementJoinRequests.rejectPayload,
    rejectGroupManagementTitleApplicationPayload: groupManagementTitleApplications.rejectPayload,
    renameFileBrowserNode: fileBrowserConsole.renameNode,
    recordWebConsoleOperation: auditConsole.recordWebConsoleOperation,
    requireAuth: webConsoleAuth.requireAuth,
    requireCsrf: webConsoleAuth.requireCsrf,
    requireLogsExposed: logConsole.requireLogsExposed,
    requireSameOrigin: webConsoleAuth.requireSameOrigin,
    refreshPluginCatalogRemoteSource: pluginCatalogConsole.refreshRemoteCatalog,
    resetAffinityRecord: userDataConsole.resetAffinityRecord,
    resetPerformanceApiCircuitBreaker: performanceConsole.resetCircuitBreaker,
    resetSessionMessagesOnly: userDataConsole.resetSessionMessagesOnly,
    resetSessionRecord: userDataConsole.resetSessionRecord,
    restoreConfigBackupPayload: configBackupConsole.restoreBackupPayload,
    rollbackConfigHistoryPayload: configBackupConsole.rollbackHistoryPayload,
    restoreMaskedSkillConfigSecrets: pluginSettingsConsole.restoreMaskedSkillConfigSecrets,
    restoreQqSimulatorScenarioBackupPayload: qqSimulatorConsole.restoreQqSimulatorScenarioBackupPayload,
    rollbackGroupManagementConfigPayload: groupManagementConfigSave.rollbackGroupManagementConfigPayload,
    runSandboxChat: sandboxConsole.runSandboxChat,
    saveApiSettings: apiSettingsConsole.saveApiSettings,
    saveBase64Image: options.helpDiyConsole?.saveImage,
    saveEditableConfig: featureConfigConsole.saveEditableConfig,
    saveGroupManagementConfig: groupManagementConfigSave.saveGroupManagementConfig,
    saveGroupManagementDefaultsConfig: groupManagementSettings.saveDefaultsConfig,
    saveGroupManagementSafetyPayload: groupManagementSettings.saveSafetyPayload,
    saveHelpDiyPayload: options.helpDiyConsole?.savePayload,
    savePluginSettings: pluginSettingsConsole.savePluginSettings,
    saveQqSimulatorScenarioPayload: qqSimulatorConsole.saveQqSimulatorScenarioPayload,
    searchFileBrowserContent: fileBrowserConsole.searchContent,
    sendBinary: httpUtils.sendBinary,
    sendJson: httpUtils.sendJson,
    sendText: httpUtils.sendText,
    serializeDependencyInstallTask: dependencyConsole.serializeDependencyInstallTask,
    serializePluginCatalogInstallTask: pluginCatalogConsole.serializeTask,
    serveConsoleBackgroundImage: consoleBackground.serveImage,
    serveGroupManagementEventStream: groupManagementEventFeed.serveStream,
    serveGroupWelcomeImage: groupWelcomeConsole.serveImage,
    serveImageMonitorLocalImage: imageMonitorConsole.serveLocalImage,
    serveStatic: staticConsole.serveStatic,
    testApiTargetConnection: apiSettingsConsole.testApiTargetConnection,
    testApiConnection: apiSettingsConsole.testApiConnection,
    testImageApiConnection: apiSettingsConsole.testImageApiConnection,
    testImageGenerationRuntime: apiSettingsConsole.testImageGenerationRuntime,
    testImageMonitorApiConnection: apiSettingsConsole.testImageMonitorApiConnection,
    testMemeApiConnection: memeConsole.testMemeApiConnection,
    testSearchApiConnection: apiSettingsConsole.testSearchApiConnection,
    toggleFeatureState: featureConfigConsole.toggleFeatureState,
    unblockPrivateAiSafetyPayload: async (payload = {}) => {
      const userId = String(payload?.userId || '').trim();
      if (!/^[1-9]\d{4,12}$/.test(userId)) {
        const error = new Error('请输入正确的 QQ 号');
        error.statusCode = 400;
        throw error;
      }
      const existed = unblockPrivateAiSafetyUser(userId);
      const allConfigs = ConfigControl.get() || {};
      return { success: true, existed, data: getPrivateAiSafetyManagementPayload(allConfigs?.config?.privateAiSafety || {}) };
    },
    validateSkillConfigPayload: pluginSettingsConsole.validateSkillConfigPayload,
    writeFileBrowserFile: fileBrowserConsole.writeFile,
  };

  assertHandlerContext(context);
  return context;
}
