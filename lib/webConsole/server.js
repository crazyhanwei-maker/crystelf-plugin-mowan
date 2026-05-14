import http from 'http';
import fs from 'fs';
import ConfigControl from '../config/configControl.js';
import { getUsageOverviewSync, normalizeUsageScene } from '../ai/usageLogger.js';
import { createConfigFeatureConsoleSuite } from './configFeatureConsoleSuite.js';
import { createCoreWebConsoleSuite } from './coreWebConsoleSuite.js';
import { createDataLogConsoleSuite } from './dataLogConsoleSuite.js';
import { createGroupManagementConsoleSuite } from './groupManagementConsoleSuite.js';
import { createMediaApiConsoleSuite } from './mediaApiConsoleSuite.js';
import { createPluginSettingsConsoleSuite } from './pluginSettingsConsoleSuite.js';
import { createSandboxSimulatorConsoleSuite } from './sandboxSimulatorConsoleSuite.js';
import { createWebConsoleHandlerContext } from './webConsoleHandlerContext.js';
import { createWebConsoleRuntime } from './webConsoleRuntime.js';
import { createWebConsoleHandler } from './webConsoleRoutes.js';
import {
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
  getChatSnapshot,
  getAffinitySnapshot,
  paginateItems,
  attachGroupManagementLogDisplayFields,
  findGroupManagementLogEntry,
} = dataLogConsoleSuite;

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

function createHandler() {
  return createWebConsoleHandler(createWebConsoleHandlerContext({
    ConfigControl,
    logger,
    getWebConsoleConfig,
    listGroupConfigBackups,
    httpUtils,
    webConsoleAuth,
    fileBrowserConsole,
    botPluginConsole,
    pluginCatalogConsole,
    dependencyConsole,
    userDataConsole,
    logConsole,
    logDiagnosisConsole,
    configBackupConsole,
    configPayloadConsole,
    apiSettingsConsole,
    memeConsole,
    featureConfigConsole,
    imageMonitorConsole,
    sandboxConsole,
    qqSimulatorConsole,
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
  createHandler,
  isLoopbackAddress,
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
