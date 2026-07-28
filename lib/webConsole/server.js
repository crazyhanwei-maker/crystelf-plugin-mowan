import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import Path from '../../constants/path.js';
import ConfigControl from '../config/configControl.js';
import { getUsageOverviewSync, normalizeUsageScene } from '../ai/usageLogger.js';
import { createConfigFeatureConsoleSuite } from './configFeatureConsoleSuite.js';
import { createCoreWebConsoleSuite } from './coreWebConsoleSuite.js';
import { createDataLogConsoleSuite } from './dataLogConsoleSuite.js';
import { createGroupManagementConsoleSuite } from './groupManagementConsoleSuite.js';
import { createMediaApiConsoleSuite } from './mediaApiConsoleSuite.js';
import { createPluginSettingsConsoleSuite } from './pluginSettingsConsoleSuite.js';
import { createSandboxSimulatorConsoleSuite } from './sandboxSimulatorConsoleSuite.js';
import { createCommandCenterConsole } from './commandCenterConsole.js';
import { createAgentWorkbenchConsole } from './agentWorkbenchConsole.js';
import { createGlobalSearchConsole } from './globalSearchConsole.js';
import { createGroupSummaryDiagnosticsConsole } from './groupSummaryDiagnosticsConsole.js';
import { createWebConsoleHandlerContext } from './webConsoleHandlerContext.js';
import { createWebConsoleRuntime } from './webConsoleRuntime.js';
import { createWebConsoleHandler } from './webConsoleRoutes.js';
import { createStartupSelfCheck } from './startupSelfCheck.js';
import {
  PACKAGE_JSON_FILE,
  PACKAGE_LOCK_FILE,
  PUBLIC_DIR,
} from './webConsoleConstants.js';
import {
  buildOpenAiCompatibleUrl,
  buildWebConsoleConfig,
  getPricingConfig,
} from './webConsoleConfig.js';

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),
  mark: (...args) => console.log(...args),
};

const coreWebConsoleSuite = createCoreWebConsoleSuite({
  ConfigControl,
  logger,
  getWebConsoleConfig,
  normalizeUsageScene,
});

const {
  httpUtils,
  fileBrowserConsole,
  helpDiyConsole,
  webConsoleAuth,
  auditConsole,
  staticConsole,
  getSecurityHeaders,
  sendJson,
  sendBinary,
  createHttpError,
  getHttpErrorStatus,
  safeReadJson,
  safeWriteJson,
  isPathInsideRoot,
  getRealPathSafe,
  ensurePathResolvedWithinRoot,
  buildBotIdentitySnapshot,
  resolveRuntimeMemeCharacter,
  replaceControlCharacters,
  parseJsonObjects,
  readTailText,
  safeReadUsageEntries,
  isLoopbackAddress,
  getClientIp,
  hasConfiguredSecret,
  maskSecretValue,
} = coreWebConsoleSuite;

const mediaApiConsoleSuite = createMediaApiConsoleSuite({
  ConfigControl,
  createHttpError,
  safeReadJson,
  safeWriteJson,
  sendBinary,
  logger,
  isPathInsideRoot,
  ensurePathResolvedWithinRoot,
  buildBotIdentitySnapshot,
  resolveRuntimeMemeCharacter,
  normalizePositiveNumber: (...args) => normalizePositiveNumber(...args),
  replaceControlCharacters,
  buildOpenAiCompatibleUrl,
  hasConfiguredSecret,
  getHttpErrorStatus,
});

const {
  remoteImageProxy,
  consoleBackground,
  apiSettingsConsole,
  memeConsole,
  normalizeConsoleBackgroundSourceUrl,
  getConsoleBackgroundSourceUrl,
} = mediaApiConsoleSuite;

function getWebConsoleConfig() {
  return buildWebConsoleConfig(ConfigControl.get('config') || {}, {
    getBackgroundSourceUrl: getConsoleBackgroundSourceUrl,
  });
}

async function ensureWebConsoleAuthToken() {
  const config = ConfigControl.get('config') || {};
  const currentToken = String(config.webConsoleToken || '').trim();
  if (currentToken) {
    return { token: currentToken, generated: false };
  }

  const token = `crystelf-${crypto.randomBytes(12).toString('base64url')}`;
  await ConfigControl.set('config', {
    ...config,
    webConsoleToken: token,
  });
  return { token, generated: true };
}

const pluginSettingsConsoleSuite = createPluginSettingsConsoleSuite({
  ConfigControl,
  getUsageOverviewSync,
  getPricingConfig,
  createHttpError,
  hasConfiguredSecret,
});

const {
  pluginSettingsConsole,
  normalizePositiveNumber,
  cloneJsonValue,
  maskDisplayUrlSecrets,
} = pluginSettingsConsoleSuite;

const dataLogConsoleSuite = createDataLogConsoleSuite({
  ConfigControl,
  logger,
  getWebConsoleConfig,
  safeReadJson,
  safeReadUsageEntries,
  safeWriteJson,
  getUsageOverviewSync,
  getPricingConfig,
  normalizeUsageScene,
  normalizeFeatureToggleBackup: (...args) => normalizeFeatureToggleBackup(...args),
  getWebConsoleInfo,
  createHttpError,
  sendJson,
  readTailText,
  parseJsonObjects,
  buildImageMonitorLogPayload: (...args) => buildImageMonitorLogPayload(...args),
  buildWebConsoleAuditLogEntries: (...args) => auditConsole.buildWebConsoleAuditLogEntries(...args),
  recordWebConsoleOperation: (...args) => auditConsole.recordWebConsoleOperation(...args),
});

const {
  overviewConsole,
  botPluginConsole,
  pluginCatalogConsole,
  dependencyConsole,
  usageTrendConsole,
  userDataConsole,
  logConsole,
  logDiagnosisConsole,
  performanceConsole,
  getChatSnapshot,
  getAffinitySnapshot,
  paginateItems,
  attachGroupManagementLogDisplayFields,
  findGroupManagementLogEntry,
} = dataLogConsoleSuite;

const startupSelfCheck = createStartupSelfCheck({
  fs,
  path,
  rootDir: Path.root,
  configDir: Path.config,
  defaultConfigDir: Path.defaultConfigPath,
  publicDir: PUBLIC_DIR,
  packageJsonFile: PACKAGE_JSON_FILE,
  packageLockFile: PACKAGE_LOCK_FILE,
  buildDependencyReport: (...args) => dependencyConsole.buildDependencyReport(...args),
});

const groupManagementSuite = createGroupManagementConsoleSuite({
  ConfigControl,
  createHttpError,
  readTailText,
  attachGroupManagementLogDisplayFields,
  getWebConsoleConfig,
  getSecurityHeaders,
  cloneJsonValue,
  getChatSnapshot,
  getAffinitySnapshot,
  getClientIp,
  sendBinary,
  isPathInsideRoot,
  getRealPathSafe,
  ensurePathResolvedWithinRoot,
  paginateItems,
  hasConfiguredSecret,
});

const {
  listGroupConfigBackups,
  groupManagementCommon,
  groupManagementEventFeed,
  groupWelcomeConsole,
  groupManagementPayload,
  groupManagementRuleDebugger,
  groupManagementMembers,
  groupManagementJoinRequests,
  groupManagementMemberWarnings,
  groupManagementTitleApplications,
  groupManagementConfigSave,
  groupManagementBulkActions,
  groupManagementSettings,
  groupManagementHealthFix,
  isPlainObject,
  normalizeGroupIdValue,
  normalizeGroupIdList,
  readBoolean,
  getGroupManagementConfigState,
  saveGroupManagementConfig,
  getGroupModerationState,
  normalizeGroupContentModerationConfig,
  getJoinRequestAutoApproveConfig,
  evaluateJoinRequestAutoApprove,
  getGroupMemberModeration,
  getGroupManagementDefaultAuthConfig,
  normalizeAuthGroupConfig,
} = groupManagementSuite;

const configFeatureConsoleSuite = createConfigFeatureConsoleSuite({
  ConfigControl,
  createHttpError,
  maskSecretValue,
  getWebConsoleConfig,
  safeReadJson,
  getWebConsoleInfo,
  normalizeConsoleBackgroundSourceUrl,
  getRealPathSafe,
  paginateItems,
  sendJson,
  sendBinary,
});

const {
  configBackupConsole,
  configPayloadConsole,
  featureConfigConsole,
  imageMonitorConsole,
  normalizeFeatureToggleBackup,
  buildConfigDiagnosticsPayload,
  buildImageMonitorLogPayload,
} = configFeatureConsoleSuite;

const sandboxSimulatorConsoleSuite = createSandboxSimulatorConsoleSuite({
  ConfigControl,
  createHttpError,
  isPlainObject,
  normalizeGroupIdValue,
  normalizeGroupIdList,
  readBoolean,
  findGroupManagementLogEntry,
  getGroupManagementConfigState,
  saveGroupManagementConfig,
  getGroupModerationState,
  normalizeGroupContentModerationConfig,
  getJoinRequestAutoApproveConfig,
  evaluateJoinRequestAutoApprove,
  getGroupMemberModeration,
  getGroupManagementDefaultAuthConfig,
  normalizeAuthGroupConfig,
  logger,
  maskDisplayUrlSecrets,
  buildOpenAiCompatibleUrl,
});

const {
  sandboxConsole,
  qqSimulatorConsole,
} = sandboxSimulatorConsoleSuite;

const commandCenterConsole = createCommandCenterConsole({
  ConfigControl,
  logger,
});

const agentWorkbenchConsole = createAgentWorkbenchConsole({
  ConfigControl,
  logger,
  pluginRoot: Path.root,
  yunzaiRoot: Path.yunzai,
  recordWebConsoleOperation: (...args) => auditConsole.recordWebConsoleOperation(...args),
});

const groupSummaryDiagnosticsConsole = createGroupSummaryDiagnosticsConsole({
  ConfigControl,
  logger,
});


const globalSearchConsole = createGlobalSearchConsole({
  logger,
  buildCommandCenterPayload: (...args) => commandCenterConsole.buildPayload(...args),
  buildPluginSettingsPayload: (...args) => pluginSettingsConsole.buildPluginSettingsPayload(...args),
  buildBotPluginManagementPayload: (...args) => botPluginConsole.buildPayload(...args),
  buildPluginCatalogPayload: (...args) => pluginCatalogConsole.buildPayload(...args),
});
function createHandler() {
  return createWebConsoleHandler(createWebConsoleHandlerContext({
    ConfigControl,
    logger,
    getWebConsoleConfig,
    listGroupConfigBackups,
    httpUtils,
    webConsoleAuth,
    auditConsole,
    fileBrowserConsole,
    botPluginConsole,
    pluginCatalogConsole,
    dependencyConsole,
    userDataConsole,
    logConsole,
    logDiagnosisConsole,
    performanceConsole,
    configBackupConsole,
    configPayloadConsole,
    configDiagnosticsConsole: { buildPayload: buildConfigDiagnosticsPayload },
    apiSettingsConsole,
    memeConsole,
    featureConfigConsole,
    imageMonitorConsole,
    sandboxConsole,
    qqSimulatorConsole,
    commandCenterConsole,
    agentWorkbenchConsole,
    globalSearchConsole,
    groupSummaryDiagnosticsConsole,
    staticConsole,
    usageTrendConsole,
    overviewConsole,
    pluginSettingsConsole,
    remoteImageProxy,
    consoleBackground,
    groupManagementCommon,
    groupManagementEventFeed,
    groupWelcomeConsole,
    groupManagementPayload,
    groupManagementRuleDebugger,
    groupManagementMembers,
    groupManagementJoinRequests,
    groupManagementMemberWarnings,
    groupManagementTitleApplications,
    groupManagementConfigSave,
    groupManagementBulkActions,
    groupManagementSettings,
    groupManagementHealthFix,
    helpDiyConsole,
  }));
}

const webConsoleRuntime = createWebConsoleRuntime({
  http,
  fs,
  publicDir: PUBLIC_DIR,
  logger,
  getWebConsoleConfig,
  ensureWebConsoleAuthToken,
  createHandler,
  buildStartupSelfCheckPayload: startupSelfCheck.buildStartupSelfCheckPayload,
  formatStartupSelfCheckLines: startupSelfCheck.formatStartupSelfCheckLines,
});

export async function startWebConsole() {
  return webConsoleRuntime.start();
}

export async function stopWebConsole() {
  return webConsoleRuntime.stop();
}

export function getWebConsoleInfo() {
  return webConsoleRuntime.getInfo();
}

export function getDependencyConsole() {
  return dependencyConsole;
}
