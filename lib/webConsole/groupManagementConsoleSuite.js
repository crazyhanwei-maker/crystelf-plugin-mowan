import path from 'path';
import Path from '../../constants/path.js';
import { createGroupConfigBackup, findGroupConfigBackup, listGroupConfigBackups } from '../groupManagement/groupConfigBackupStore.js';
import {
  evaluateJoinRequestAutoApprove,
  getJoinRequestAutoApproveConfig,
  normalizeJoinRequestAutoApproveConfig,
} from '../groupManagement/joinRequestAutoApprove.js';
import { appendGroupManagementLog } from '../groupManagement/groupManagementLog.js';
import { approveStoredJoinRequest, listJoinRequestRecords, rejectStoredJoinRequest } from '../groupManagement/joinRequestStore.js';
import {
  addGroupListEntry,
  addGroupMemberWarning,
  clearGroupMemberWarnings,
  getGroupManagementDefaults,
  getGroupManagementSafetyConfig,
  getGroupMemberModeration,
  getGroupModerationOverview,
  getGroupModerationState,
  listGroupModerationGroupIds,
  normalizeGroupContentModerationConfig,
  restoreGroupModerationConfig,
  saveGroupManagementDefaults,
  saveGroupManagementSafetyConfig,
  saveGroupModerationState,
} from '../groupManagement/memberModerationStore.js';
import {
  findTitleApplicationById,
  listTitleApplications,
  pruneExpiredTitleApplications,
  updateTitleApplicationStatus,
} from '../groupTitle/titleApplicationStore.js';
import { normalizeDailyGroupSummaryConfig } from '../groupSummary/dailyGroupSummaryStore.js';
import { createGroupManagementBulkActions } from './groupManagementBulkActions.js';
import { createGroupManagementCommon } from './groupManagementCommon.js';
import { createGroupManagementConfigSave } from './groupManagementConfigSave.js';
import { createGroupManagementConfigState } from './groupManagementConfigState.js';
import { createGroupManagementEventFeed } from './groupManagementEventFeed.js';
import { createGroupManagementGroupList } from './groupManagementGroupList.js';
import { createGroupManagementHealth } from './groupManagementHealth.js';
import { createGroupManagementHealthFix } from './groupManagementHealthFix.js';
import { createGroupManagementJoinRequests } from './groupManagementJoinRequests.js';
import { createGroupManagementMembers } from './groupManagementMembers.js';
import { createGroupManagementMemberWarnings } from './groupManagementMemberWarnings.js';
import { createGroupManagementPayload } from './groupManagementPayload.js';
import { createGroupManagementRuleDebugger } from './groupManagementRuleDebugger.js';
import { createGroupManagementSettings } from './groupManagementSettings.js';
import { createGroupManagementTitleApplications } from './groupManagementTitleApplications.js';
import { createGroupWelcomeConsole } from './groupWelcomeConsole.js';
import {
  GROUP_MANAGEMENT_MEMBER_LIMIT,
  GROUP_MANAGEMENT_RUNTIME_TIMEOUT_MS,
  GROUP_WELCOME_IMAGE_CONTENT_TYPES,
  GROUP_WELCOME_IMAGE_MAX_BYTES,
} from './webConsoleConstants.js';

export function createGroupManagementConsoleSuite(options = {}) {
  const {
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
  } = options;

  const getAllConfigs = () => ConfigControl.get() || {};
  const groupManagementCommon = createGroupManagementCommon({
    createHttpError,
  });

  const {
    isPlainObject,
    normalizeGroupManagementId,
    normalizeGroupIdValue,
    normalizeGroupIdList,
    updateGroupIdList,
    optionalBoolean,
    readBoolean,
    normalizeIntegerInRange,
  } = groupManagementCommon;

  const groupManagementEventFeed = createGroupManagementEventFeed({
    readTailText,
    attachLogDisplayFields: attachGroupManagementLogDisplayFields,
    getLogTailLength: () => getWebConsoleConfig().logTailLength,
    normalizeIntegerInRange,
    getSecurityHeaders,
  });

  const groupWelcomeConsole = createGroupWelcomeConsole({
    configRoot: Path.config,
    imageMaxBytes: GROUP_WELCOME_IMAGE_MAX_BYTES,
    imageContentTypes: GROUP_WELCOME_IMAGE_CONTENT_TYPES,
    createHttpError,
    getAllConfigs,
    sendBinary,
    isPlainObject,
    readBoolean,
    normalizeGroupId: normalizeGroupManagementId,
    isPathInsideRoot,
    getRealPathSafe,
    ensurePathResolvedWithinRoot,
  });

  const {
    normalizeWelcomeText: normalizeGroupWelcomeText,
    getImagePreviewUrl: getGroupWelcomeImagePreviewUrl,
    isAiWelcomeEnabled: isAiGroupWelcomeEnabled,
    isWelcomeEnabled: isGroupWelcomeEnabled,
    normalizeWelcomeConfig: normalizeGroupWelcomeConfig,
    getDefaultWelcomeConfig: getGroupManagementDefaultWelcomeConfig,
    deleteImageFiles: deleteGroupWelcomeImageFiles,
    saveImageDataUrl: saveGroupWelcomeImageDataUrl,
  } = groupWelcomeConsole;

  const groupManagementConfigState = createGroupManagementConfigState({
    path,
    isPlainObject,
    readBoolean,
    normalizeIntegerInRange,
    normalizeJoinRequestAutoApproveConfig,
    normalizeGroupManagementId,
    normalizeGroupIdList,
    normalizeDailyGroupSummaryConfig,
    cloneJsonValue,
    getGroupModerationState,
    getGroupManagementDefaultWelcomeConfig,
    normalizeGroupWelcomeConfig,
    getGroupWelcomeImagePreviewUrl,
    isGroupWelcomeEnabled,
    isAiGroupWelcomeEnabled,
    listGroupConfigBackups,
  });

  const {
    normalizeAuthGroupConfig,
    getGroupManagementDefaultAuthConfig,
    buildGroupManagementConfigSnapshot,
    normalizeGroupManagementBotRole,
    buildGroupManagementPermissionState,
    getGroupManagementConfigState,
  } = groupManagementConfigState;

  const groupManagementGroupList = createGroupManagementGroupList({
    createHttpError,
    isPlainObject,
    normalizeGroupId: normalizeGroupIdValue,
    normalizeGroupIdList,
    normalizeDailySummaryConfig: normalizeDailyGroupSummaryConfig,
    listModerationGroupIds: listGroupModerationGroupIds,
    getChatSnapshot,
    getAffinitySnapshot,
    getConfigState: getGroupManagementConfigState,
    buildPermissionState: buildGroupManagementPermissionState,
    getModerationOverview: getGroupModerationOverview,
    runtimeTimeoutMs: GROUP_MANAGEMENT_RUNTIME_TIMEOUT_MS,
  });

  const {
    upsertGroupManagementRecord,
    readGroupCollectionItems,
    getBotInstancesForGroupManagement,
    withGroupManagementTimeout,
    extractRuntimeListResult,
    collectRuntimeGroupManagementGroups,
    collectConfiguredGroupManagementGroups,
    mergeGroupManagementRecords,
    serializeGroupManagementRecord,
    getGroupManagementListSummary,
  } = groupManagementGroupList;

  const groupManagementHealth = createGroupManagementHealth({
    getSafetyConfig: getGroupManagementSafetyConfig,
    hasConfiguredSecret,
    normalizeContentAction: (...args) => normalizeGroupContentActionValue(...args),
    normalizeBotRole: normalizeGroupManagementBotRole,
  });

  const {
    buildPayload: buildGroupManagementHealthPayload,
  } = groupManagementHealth;

  const groupManagementSettings = createGroupManagementSettings({
    createHttpError,
    getAllConfigs,
    setMultipleConfigs: writes => ConfigControl.setMultiple(writes),
    appendLog: appendGroupManagementLog,
    saveSafetyConfig: saveGroupManagementSafetyConfig,
    getDefaultAuthConfig: getGroupManagementDefaultAuthConfig,
    normalizeAuthConfig: normalizeAuthGroupConfig,
    getDefaultWelcomeConfig: getGroupManagementDefaultWelcomeConfig,
    normalizeWelcomeConfig: normalizeGroupWelcomeConfig,
    getModerationDefaults: getGroupManagementDefaults,
    saveModerationDefaults: saveGroupManagementDefaults,
    isPlainObject,
    isWelcomeEnabled: isGroupWelcomeEnabled,
    isAiWelcomeEnabled: isAiGroupWelcomeEnabled,
    readBoolean,
    normalizeGroupId: normalizeGroupIdValue,
    cloneJsonValue,
    assertContentSafety: (...args) => assertGroupManagementContentSafety(...args),
    ensureMainConfigFeatureEnabled: (...args) => ensureMainConfigFeatureEnabled(...args),
    summarizeSavePayload: (...args) => summarizeGroupManagementSavePayload(...args),
    buildGroupManagementPayload: (...args) => buildGroupManagementPayload(...args),
  });

  const {
    buildDefaultsPayload: buildGroupManagementDefaultsPayload,
  } = groupManagementSettings;

  const groupManagementPayload = createGroupManagementPayload({
    getAllConfigs,
    collectRuntimeGroups: collectRuntimeGroupManagementGroups,
    collectConfiguredGroups: collectConfiguredGroupManagementGroups,
    mergeRecords: mergeGroupManagementRecords,
    normalizeGroupId: normalizeGroupIdValue,
    upsertRecord: upsertGroupManagementRecord,
    serializeRecord: serializeGroupManagementRecord,
    getWebConsoleConfig,
    getSafetyConfig: getGroupManagementSafetyConfig,
    buildDefaultsPayload: buildGroupManagementDefaultsPayload,
    getListSummary: getGroupManagementListSummary,
    buildHealthPayload: buildGroupManagementHealthPayload,
  });

  const {
    buildPayload: buildGroupManagementPayload,
  } = groupManagementPayload;

  const groupManagementRuleDebugger = createGroupManagementRuleDebugger({
    createHttpError,
    getAllConfigs,
    getConfigState: getGroupManagementConfigState,
    getSafetyConfig: getGroupManagementSafetyConfig,
    getGroupMemberModeration,
    normalizeGroupId: normalizeGroupManagementId,
    normalizeGroupContentModerationConfig,
    normalizeJoinRequestAutoApproveConfig,
    getJoinRequestAutoApproveConfig,
    evaluateJoinRequestAutoApprove,
  });

  const groupManagementMembers = createGroupManagementMembers({
    normalizeGroupId: normalizeGroupManagementId,
    readGroupCollectionItems,
    getBotInstances: getBotInstancesForGroupManagement,
    withTimeout: withGroupManagementTimeout,
    extractRuntimeListResult,
    paginateItems,
    getPageSize: () => getWebConsoleConfig().pageSize,
    memberLimit: GROUP_MANAGEMENT_MEMBER_LIMIT,
    isPlainObject,
  });

  const {
    pickRuntimeGroup: pickRuntimeGroupForManagement,
  } = groupManagementMembers;

  const groupManagementJoinRequests = createGroupManagementJoinRequests({
    createHttpError,
    normalizeGroupId: normalizeGroupManagementId,
    paginateItems,
    listJoinRequests: listJoinRequestRecords,
    approveJoinRequest: approveStoredJoinRequest,
    rejectJoinRequest: rejectStoredJoinRequest,
    addGroupListEntry,
    appendLog: appendGroupManagementLog,
  });

  const groupManagementMemberWarnings = createGroupManagementMemberWarnings({
    createHttpError,
    normalizeGroupId: normalizeGroupManagementId,
    addWarning: addGroupMemberWarning,
    clearWarnings: clearGroupMemberWarnings,
    appendLog: appendGroupManagementLog,
  });

  const {
    normalizeUserId: normalizeGroupManagementUserId,
  } = groupManagementMemberWarnings;

  const groupManagementTitleApplications = createGroupManagementTitleApplications({
    createHttpError,
    normalizeGroupId: normalizeGroupManagementId,
    normalizeUserId: normalizeGroupManagementUserId,
    normalizeIntegerInRange,
    getTitleConfig: () => ConfigControl.get('groupTitle') || {},
    pruneExpiredApplications: pruneExpiredTitleApplications,
    listApplications: listTitleApplications,
    findApplicationById: findTitleApplicationById,
    updateApplicationStatus: updateTitleApplicationStatus,
    paginateItems,
    pickRuntimeGroup: pickRuntimeGroupForManagement,
    getBotInstances: getBotInstancesForGroupManagement,
    withTimeout: withGroupManagementTimeout,
    appendLog: appendGroupManagementLog,
  });

  const groupManagementConfigSave = createGroupManagementConfigSave({
    ConfigControl,
    createHttpError,
    normalizeGroupManagementId,
    isPlainObject,
    cloneJsonValue,
    updateGroupIdList,
    normalizeDailyGroupSummaryConfig,
    normalizeGroupIdList,
    optionalBoolean,
    normalizeIntegerInRange,
    readBoolean,
    findGroupConfigBackup,
    createGroupConfigBackup,
    buildGroupManagementConfigSnapshot,
    restoreGroupModerationConfig,
    appendGroupManagementLog,
    buildGroupManagementPayload,
    getClientIp,
    normalizeGroupWelcomeText,
    getGroupManagementSafetyConfig,
    getGroupManagementDefaultAuthConfig,
    normalizeAuthGroupConfig,
    getGroupManagementDefaultWelcomeConfig,
    deleteGroupWelcomeImageFiles,
    normalizeGroupWelcomeConfig,
    isAiGroupWelcomeEnabled,
    isGroupWelcomeEnabled,
    saveGroupWelcomeImageDataUrl,
    saveGroupModerationState,
  });

  const {
    summarizeGroupManagementSavePayload,
    normalizeGroupContentActionValue,
    assertGroupManagementContentSafety,
    ensureMainConfigFeatureEnabled,
    saveGroupManagementConfig,
  } = groupManagementConfigSave;

  const groupManagementBulkActions = createGroupManagementBulkActions({
    createHttpError,
    normalizeGroupId: normalizeGroupIdValue,
    getAllConfigs,
    setMultipleConfigs: writes => ConfigControl.setMultiple(writes),
    cloneJsonValue,
    normalizeGroupIdList,
    ensureMainConfigFeatureEnabled,
    normalizeDailySummaryConfig: normalizeDailyGroupSummaryConfig,
    getDefaultAuthConfig: getGroupManagementDefaultAuthConfig,
    normalizeAuthConfig: normalizeAuthGroupConfig,
    normalizeAutoApproveConfig: normalizeJoinRequestAutoApproveConfig,
    isPlainObject,
    appendLog: appendGroupManagementLog,
    buildGroupManagementPayload,
  });

  const groupManagementHealthFix = createGroupManagementHealthFix({
    createHttpError,
    normalizeGroupId: normalizeGroupIdValue,
    getAllConfigs,
    getGroupModerationState,
    getSafetyConfig: getGroupManagementSafetyConfig,
    getDefaultAuthConfig: getGroupManagementDefaultAuthConfig,
    normalizeAuthConfig: normalizeAuthGroupConfig,
    getDefaultWelcomeConfig: getGroupManagementDefaultWelcomeConfig,
    normalizeWelcomeConfig: normalizeGroupWelcomeConfig,
    buildGroupManagementPayload,
    saveGroupManagementConfig,
  });

  return {
    listGroupConfigBackups,
    groupManagementCommon,
    groupManagementEventFeed,
    groupWelcomeConsole,
    groupManagementConfigState,
    groupManagementGroupList,
    groupManagementHealth,
    groupManagementSettings,
    groupManagementPayload,
    groupManagementRuleDebugger,
    groupManagementMembers,
    groupManagementJoinRequests,
    groupManagementMemberWarnings,
    groupManagementTitleApplications,
    groupManagementConfigSave,
    groupManagementBulkActions,
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
  };
}
