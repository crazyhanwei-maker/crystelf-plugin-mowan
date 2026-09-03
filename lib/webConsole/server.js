import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import Path from '../../constants/path.js';
import ConfigControl from '../config/configControl.js';
import { getUsageOverviewSync, normalizeUsageScene, getUsageTrendByDaysSync } from '../ai/usageLogger.js';
import { createConfigFeatureConsoleSuite } from './configFeatureConsoleSuite.js';
import { createCoreWebConsoleSuite } from './coreWebConsoleSuite.js';
import { createDataLogConsoleSuite } from './dataLogConsoleSuite.js';
import { createTaskCenterConsole } from './taskCenterConsole.js';
import { createGroupManagementInsightsConsole } from './groupManagementInsightsConsole.js';
import { createScheduledBackupConsole } from './scheduledBackupConsole.js';
import { createHealthReportConsole } from './healthReportConsole.js';
import { createBotAdapterWatchdog } from './botAdapterWatchdog.js';
import { createSmtpAlertMailer } from './smtpAlertMailer.js';
import { createResourceWatchdog } from './resourceWatchdog.js';
import { createMorningReport } from './morningReport.js';
import { createGroupManagementConsoleSuite } from './groupManagementConsoleSuite.js';
import { GROUP_MANAGEMENT_LOG_FILE } from '../groupManagement/groupManagementLog.js';
import { createMediaApiConsoleSuite } from './mediaApiConsoleSuite.js';
import { createPluginSettingsConsoleSuite } from './pluginSettingsConsoleSuite.js';
import { createSandboxSimulatorConsoleSuite } from './sandboxSimulatorConsoleSuite.js';
import { createCommandCenterConsole } from './commandCenterConsole.js';
import { createAgentWorkbenchConsole } from './agentWorkbenchConsole.js';
import { createGlobalSearchConsole } from './globalSearchConsole.js';
import { createPersonaPresetConsole } from './personaPresetConsole.js';
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
  masterNotifier,
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

const groupManagementInsightsConsole = createGroupManagementInsightsConsole({
  groupManagementLogFile: GROUP_MANAGEMENT_LOG_FILE,
});

const scheduledBackupConsole = createScheduledBackupConsole({
  configDir: Path.config,
  backupDir: path.join(Path.config, 'backups'),
  logger,
  getRetentionCount: () => {
    const config = ConfigControl.get('config') || {};
    const value = Number(config.scheduledBackupRetention);
    return Number.isFinite(value) && value > 0 ? Math.min(value, 30) : 7;
  },
  getEnabled: () => (ConfigControl.get('config') || {}).scheduledBackupEnabled !== false,
});

const taskCenterConsole = createTaskCenterConsole({
  buildScheduledBackupTaskPayload: () => scheduledBackupConsole.buildScheduledBackupTaskPayload(),
  runScheduledBackup: scheduledBackupConsole.runBackup,
  getMainConfig: () => ConfigControl.get('config') || {},
  getAiConfig: () => ConfigControl.get('ai') || {},
  getRssFeeds: () => ConfigControl.get('feeds') || [],
  // 晨报在下方创建；此处传闭包，调用时实例已就绪
  getMorningReportTask: () => morningReport?.describeTask?.() || null,
  runMorningReport: options => morningReport?.runReport?.(options || { trigger: 'manual' }),
});

// 邮件旁路与看门狗：QQ 掉线时邮件是唯一即时告警渠道；未配置 SMTP 时邮件旁路自动禁用。
const smtpAlertMailer = createSmtpAlertMailer({
  logger,
  getConfig: () => ConfigControl.get('config') || {},
});

const botAdapterWatchdog = createBotAdapterWatchdog({
  logger,
  notifyMasters: masterNotifier.notifyMasters,
  getEnabled: () => (ConfigControl.get('config') || {}).botWatchdogEnabled !== false,
  sendAlertEmail: (...args) => smtpAlertMailer.send(...args),
});

// 资源水位看门狗：磁盘/系统内存/Redis 超阈值时 QQ+邮件告警，阈值可配置
const resourceWatchdog = createResourceWatchdog({
  logger,
  notifyMasters: masterNotifier.notifyMasters,
  sendAlertEmail: (...args) => smtpAlertMailer.send(...args),
  getEnabled: () => (ConfigControl.get('config') || {}).resourceWatchdogEnabled !== false,
  getThresholds: () => {
    const config = ConfigControl.get('config') || {};
    return {
      diskPercent: config.resourceDiskPercent,
      memoryPercent: config.resourceMemoryPercent,
      redisPercent: config.resourceRedisPercent,
    };
  },
});

// 每日运维晨报：聚合看门狗/用量/备份/水位，每天定时推送主人
const morningReport = createMorningReport({
  logger,
  notifyMasters: masterNotifier.notifyMasters,
  getEnabled: () => (ConfigControl.get('config') || {}).morningReportEnabled !== false,
  getHour: () => (ConfigControl.get('config') || {}).morningReportHour,
  getWatchdogEvents: () => botAdapterWatchdog.getRecentEvents(),
  getYesterdayUsage: () => {
    // 取趋势序列的最后一个完整天（今天之前的最后一天）
    const trend = getUsageTrendByDaysSync(2);
    return trend.length >= 2 ? trend[trend.length - 2] : null;
  },
  getBackupStatus: () => {
    const backups = scheduledBackupConsole.listBackups();
    return { count: backups.length, latest: backups[0] || null };
  },
  getResourceStatus: () => resourceWatchdog.buildStatusPayload().lastEvaluation || null,
});

const dataLogConsoleSuite = createDataLogConsoleSuite({
  ConfigControl,
  logger,
  getWebConsoleConfig,
  safeReadJson,
  safeReadUsageEntries,
  safeWriteJson,
  getUsageOverviewSync,
  getUsageTrendByDaysSync,
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
  freeChatUsageConsole,
  userDataConsole,
  logConsole,
  logDiagnosisConsole,
  botLogsConsole,
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

const personaPresetConsole = createPersonaPresetConsole({ logger });

// 群聊命令与 HTTP 路由共用一份体检报告实例；快照/健康/依赖都只存函数引用，启动后再调用。
const healthReportConsole = createHealthReportConsole({
  getStartupSelfCheckSnapshot,
  buildStartupSelfCheckPayload: (...args) => startupSelfCheck.buildStartupSelfCheckPayload(...args),
  buildHealthPayload: () => {
    const { overviewConsole: oc } = dataLogConsoleSuite;
    return oc?.buildHealthPayload ? oc.buildHealthPayload() : null;
  },
  buildDependencyReport: (...args) => dependencyConsole.buildDependencyReport(...args),
  getWebConsoleInfo,
});

function createHandler() {
  return createWebConsoleHandler(createWebConsoleHandlerContext({
    healthReportConsole,
    groupManagementInsightsConsole,
    getBotAdapterWatchdogStatus,
    scheduledBackupConsole,
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
    taskCenterConsole,
    logDiagnosisConsole,
    botLogsConsole,
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
    freeChatUsageConsole,
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
    personaPresetConsole,
  }));
}

const webConsoleRuntime = createWebConsoleRuntime({
  http,
  fs,
  publicDir: PUBLIC_DIR,
  logger,
  notifyMaster: masterNotifier.notifyMasters,
  getWebConsoleConfig,
  ensureWebConsoleAuthToken,
  createHandler,
  buildStartupSelfCheckPayload: startupSelfCheck.buildStartupSelfCheckPayload,
  formatStartupSelfCheckLines: startupSelfCheck.formatStartupSelfCheckLines,
});

export async function startWebConsole() {
  const info = await webConsoleRuntime.start();
  scheduledBackupConsole.start();
  botAdapterWatchdog.start();
  resourceWatchdog.start();
  morningReport.start();
  return info;
}

export function getMorningReportTaskForChat() {
  return morningReport.describeTask();
}

export async function runMorningReportForChat() {
  return morningReport.runReport({ trigger: 'qq-command' });
}

export function buildMorningReportTextForChat() {
  return morningReport.buildReportText();
}

export function getBotAdapterWatchdogStatus() {
  return botAdapterWatchdog.buildStatusPayload();
}

export function getResourceWatchdogStatus() {
  return resourceWatchdog.buildStatusPayload();
}

export async function inspectResourceWatchdog() {
  return resourceWatchdog.inspectNow();
}

export function isSmtpAlertConfigured() {
  return smtpAlertMailer.isConfigured();
}

export function getStartupSelfCheckSnapshot() {
  return webConsoleRuntime.getStartupSelfCheckSnapshot();
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

// ── 群聊运维命令（apps/ops-commands.js）复用入口：不依赖 HTTP 服务运行，模块加载即可用 ──

export async function buildHealthReportForChat() {
  return healthReportConsole.buildHealthReportTextPayload();
}

export function listScheduledBackupsForChat() {
  return scheduledBackupConsole.listBackups();
}

export async function runScheduledBackupForChat() {
  return scheduledBackupConsole.runBackup({ trigger: 'qq-command' });
}

export function buildGroupManagementInsightsForChat(days = 7) {
  return groupManagementInsightsConsole.buildGroupManagementInsightsPayload(days);
}

export function buildTaskCenterForChat() {
  return taskCenterConsole.buildTaskCenterPayload();
}
