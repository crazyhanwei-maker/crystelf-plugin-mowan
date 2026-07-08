import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import Path from '../../constants/path.js';
import Version from '../system/version.js';
import { getPokeDebugSnapshot } from '../ai/runtimePokeDebugStore.js';
import { getSessionDebugSnapshot } from '../ai/runtimeDebugStore.js';
import { GROUP_MANAGEMENT_LOG_FILE } from '../groupManagement/groupManagementLog.js';
import { createBotPluginConsole } from './botPluginConsole.js';
import { createDependencyConsole } from './dependencyConsole.js';
import { createLogDiagnosisConsole } from './logDiagnosisConsole.js';
import { createLogConsole } from './logConsole.js';
import { createOverviewConsole } from './overviewConsole.js';
import { createPerformanceConsole } from './performanceConsole.js';
import { createPluginCatalogConsole } from './pluginCatalogConsole.js';
import { createUsageTrendConsole } from './usageTrendConsole.js';
import { createUserDataConsole } from './userDataConsole.js';
import { createPaginator } from './webConsoleConfig.js';
import {
  AFFINITY_FILE,
  AFFINITY_LOG_FILE,
  API_QUALITY_LOG_FILE,
  CHAT_DB_FILE,
  IMAGE_USAGE_LOG_FILE,
  PACKAGE_JSON_FILE,
  PACKAGE_LOCK_FILE,
  SEARCH_DEBUG_LOG_FILE,
  USAGE_LOG_FILE,
} from './webConsoleConstants.js';

export function createDataLogConsoleSuite(options = {}) {
  const {
    ConfigControl,
    logger,
    getWebConsoleConfig,
    safeReadJson,
    safeReadUsageEntries,
    safeWriteJson,
    getUsageOverviewSync,
    getPricingConfig,
    normalizeUsageScene,
    normalizeFeatureToggleBackup,
    getWebConsoleInfo,
    createHttpError,
    sendJson,
    readTailText,
    parseJsonObjects,
    buildImageMonitorLogPayload,
    buildWebConsoleAuditLogEntries = () => ({ success: true, items: [], page: 1, pageSize: 0, total: 0, totalPages: 1 }),
    recordWebConsoleOperation = () => {},
  } = options;

  const overviewConsole = createOverviewConsole({
    fs,
    path,
    childProcess: { spawn },
    Path,
    ConfigControl,
    Version,
    chatDbFile: CHAT_DB_FILE,
    affinityFile: AFFINITY_FILE,
    usageLogFile: USAGE_LOG_FILE,
    affinityLogFile: AFFINITY_LOG_FILE,
    safeReadJson,
    safeReadUsageEntries,
    getUsageOverviewSync,
    getPricingConfig,
    normalizeFeatureToggleBackup: (...args) => normalizeFeatureToggleBackup(...args),
    isImageMonitorReviewUsage: (...args) => isImageMonitorReviewUsage(...args),
    getWebConsoleInfo,
    getWebConsoleConfig,
    buildDependencyReport: (...args) => buildDependencyReport(...args),
    buildDependencyReportSummaryOnly: report => buildDependencyReportSummaryOnly(report),
  });

  const {
    getChatSnapshot,
    getAffinitySnapshot,
    buildEntryId,
    readJsonFileSafe,
    getResolvedPathSafe,
    resolvePluginsDirectory,
    toRelativeConsolePath,
    isSubPath,
  } = overviewConsole;

  const dependencyConsole = createDependencyConsole({
    rootDir: Path.root,
    yunzaiDir: Path.yunzai,
    packageJsonFile: PACKAGE_JSON_FILE,
    packageLockFile: PACKAGE_LOCK_FILE,
    createHttpError,
    logger,
    readJsonFileSafe,
    getResolvedPathSafe,
    resolvePluginsDirectory,
    toRelativeConsolePath,
    isSubPath,
    recordWebConsoleOperation,
  });

  const botPluginConsole = createBotPluginConsole({
    rootDir: Path.root,
    yunzaiDir: Path.yunzai,
    resolvePluginsDirectory,
    getResolvedPathSafe,
    toRelativeConsolePath,
    recordWebConsoleOperation,
  });

  const {
    buildDependencyReport,
    buildDependencyReportSummaryOnly,
  } = dependencyConsole;

  const pluginCatalogConsole = createPluginCatalogConsole({
    logger,
    createHttpError,
    getResolvedPathSafe,
    resolvePluginsDirectory,
    toRelativeConsolePath,
    isSubPath,
    buildBotPluginManagementPayload: () => botPluginConsole.buildPayload(),
    buildDependencyReport: (...args) => buildDependencyReport(...args),
    recordWebConsoleOperation,
  });

  const usageTrendConsole = createUsageTrendConsole({
    usageLogFile: USAGE_LOG_FILE,
    readTailText,
    parseJsonObjects,
    getLogTailLength: () => getWebConsoleConfig().logTailLength,
    isImageMonitorReviewUsage: (...args) => isImageMonitorReviewUsage(...args),
  });

  const { buildUsageTrendPayload } = usageTrendConsole;

  const performanceConsole = createPerformanceConsole({
    usageLogFile: USAGE_LOG_FILE,
    imageUsageLogFile: IMAGE_USAGE_LOG_FILE,
    searchDebugLogFile: SEARCH_DEBUG_LOG_FILE,
    apiQualityLogFile: API_QUALITY_LOG_FILE,
    readTailText,
    parseJsonObjects,
    getWebConsoleConfig,
    getAllConfigs: () => ConfigControl.get() || {},
  });

  const { paginateItems } = createPaginator({
    getMaxPageSize: () => getWebConsoleConfig().maxPageSize,
  });

  const userDataConsole = createUserDataConsole({
    getAllConfigs: () => ConfigControl.get() || {},
    getChatSnapshot,
    getAffinitySnapshot,
    getWebConsoleConfig,
    paginateItems,
    readTailText,
    parseJsonObjects,
    attachUsageDisplayFields: (...args) => attachUsageDisplayFields(...args),
    normalizeUsageScene,
    buildEntryId,
    getSessionDebugSnapshot,
    getPokeDebugSnapshot,
    safeWriteJson,
    usageLogFile: USAGE_LOG_FILE,
    affinityLogFile: AFFINITY_LOG_FILE,
    chatDbFile: CHAT_DB_FILE,
    affinityFile: AFFINITY_FILE,
  });

  const {
    buildAffinityListPayload,
    buildProfilesPayload,
  } = userDataConsole;

  function isImageMonitorReviewUsage(entry = {}) {
    return logConsole.isImageMonitorReviewUsage(entry);
  }

  const logConsole = createLogConsole({
    usageLogFile: USAGE_LOG_FILE,
    affinityLogFile: AFFINITY_LOG_FILE,
    groupManagementLogFile: GROUP_MANAGEMENT_LOG_FILE,
    getWebConsoleConfig,
    sendJson,
    readTailText,
    parseJsonObjects,
    normalizeUsageScene,
    buildEntryId,
    paginateItems,
    buildProfilesPayload,
    buildAffinityListPayload,
    buildImageMonitorLogPayload: (...args) => buildImageMonitorLogPayload(...args),
    buildUsageTrendPayload: (...args) => buildUsageTrendPayload(...args),
    buildWebConsoleAuditLogEntries: (...args) => buildWebConsoleAuditLogEntries(...args),
  });

  const logDiagnosisConsole = createLogDiagnosisConsole({
    fs,
    path,
    Path,
    logger,
    getWebConsoleConfig,
    getWebConsoleInfo,
    createHttpError,
    readTailText,
    buildOverviewPayload: (...args) => overviewConsole.buildOverviewPayload(...args),
    buildHealthPayload: (...args) => overviewConsole.buildHealthPayload(...args),
    buildDependencyReport: (...args) => buildDependencyReport(...args),
    buildWebConsoleAuditLogEntries: (...args) => buildWebConsoleAuditLogEntries(...args),
  });

  const {
    attachUsageDisplayFields,
    attachGroupManagementLogDisplayFields,
    findGroupManagementLogEntry,
  } = logConsole;

  return {
    overviewConsole,
    botPluginConsole,
    pluginCatalogConsole,
    dependencyConsole,
    performanceConsole,
    usageTrendConsole,
    userDataConsole,
    logConsole,
    logDiagnosisConsole,
    getChatSnapshot,
    getAffinitySnapshot,
    buildEntryId,
    readJsonFileSafe,
    getResolvedPathSafe,
    resolvePluginsDirectory,
    toRelativeConsolePath,
    isSubPath,
    buildDependencyReport,
    buildDependencyReportSummaryOnly,
    buildUsageTrendPayload,
    paginateItems,
    buildAffinityListPayload,
    buildProfilesPayload,
    isImageMonitorReviewUsage,
    attachUsageDisplayFields,
    attachGroupManagementLogDisplayFields,
    findGroupManagementLogEntry,
  };
}
