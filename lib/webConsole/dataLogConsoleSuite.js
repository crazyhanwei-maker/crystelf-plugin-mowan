import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';
import Version from '../system/version.js';
import { getPokeDebugSnapshot } from '../ai/runtimePokeDebugStore.js';
import { getSessionDebugSnapshot } from '../ai/runtimeDebugStore.js';
import { GROUP_MANAGEMENT_LOG_FILE } from '../groupManagement/groupManagementLog.js';
import { createDependencyConsole } from './dependencyConsole.js';
import { createLogConsole } from './logConsole.js';
import { createOverviewConsole } from './overviewConsole.js';
import { createUsageTrendConsole } from './usageTrendConsole.js';
import { createUserDataConsole } from './userDataConsole.js';
import { createPaginator } from './webConsoleConfig.js';
import {
  AFFINITY_FILE,
  AFFINITY_LOG_FILE,
  CHAT_DB_FILE,
  PACKAGE_JSON_FILE,
  PACKAGE_LOCK_FILE,
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
  } = options;

  const overviewConsole = createOverviewConsole({
    fs,
    path,
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
  });

  const {
    buildDependencyReport,
    buildDependencyReportSummaryOnly,
  } = dependencyConsole;

  const usageTrendConsole = createUsageTrendConsole({
    usageLogFile: USAGE_LOG_FILE,
    readTailText,
    parseJsonObjects,
    getLogTailLength: () => getWebConsoleConfig().logTailLength,
    isImageMonitorReviewUsage: (...args) => isImageMonitorReviewUsage(...args),
  });

  const { buildUsageTrendPayload } = usageTrendConsole;

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
  });

  const {
    attachUsageDisplayFields,
    attachGroupManagementLogDisplayFields,
    findGroupManagementLogEntry,
  } = logConsole;

  return {
    overviewConsole,
    dependencyConsole,
    usageTrendConsole,
    userDataConsole,
    logConsole,
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
