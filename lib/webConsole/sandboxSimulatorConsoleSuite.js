import UserConfigManager from '../ai/userConfigManager.js';
import { runChat } from '../ai/chatEngine.js';
import { loadAutoSessionSkills } from '../ai/httpSkillRegistry.js';
import { fetchWebMarkdown, searchWeb } from '../ai/toolRegistry.js';
import { EmojiAgent } from '../humanize/index.js';
import { SkillSessionManager } from '../ai/sessionManager.js';
import { createQqSimulatorConsole } from './qqSimulatorConsole.js';
import { createSandboxConsole } from './sandboxConsole.js';
import {
  QQ_SIMULATOR_ADAPTER_FORMATS,
  QQ_SIMULATOR_GROUP_HISTORY_LIMIT,
  QQ_SIMULATOR_GROUP_HISTORY_TEXT_LIMIT,
  QQ_SIMULATOR_VOICE_DATA_MAX_BYTES,
  SANDBOX_CHAT_IMAGE_DATA_MAX_BYTES,
  SANDBOX_CHAT_MAX_IMAGES,
} from './webConsoleConstants.js';

export function createSandboxSimulatorConsoleSuite(options = {}) {
  const {
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
  } = options;

  const sandboxConsole = createSandboxConsole({
    UserConfigManager,
    ConfigControl,
    fetchWebMarkdown,
    searchWeb,
    runChat,
    EmojiAgent,
    SkillSessionManager,
    loadAutoSessionSkills,
    logger,
    createHttpError,
    maskDisplayUrlSecrets,
    buildOpenAiCompatibleUrl,
    maxImages: SANDBOX_CHAT_MAX_IMAGES,
    imageDataMaxBytes: SANDBOX_CHAT_IMAGE_DATA_MAX_BYTES,
  });

  const {
    sanitizeSandboxHistory,
    estimateDataUrlBytes,
    getDataUrlMediaType,
    normalizeDataUrlAttachment,
    normalizeSandboxImageUrls,
    redactQqSimulatorMediaUrl,
    runSandboxChat,
  } = sandboxConsole;

  const qqSimulatorConsole = createQqSimulatorConsole({
    ConfigControl,
    createHttpError,
    isPlainObject,
    normalizeGroupIdValue,
    normalizeGroupIdList,
    readBoolean,
    sanitizeSandboxHistory,
    normalizeSandboxImageUrls,
    getDataUrlMediaType,
    normalizeDataUrlAttachment,
    estimateDataUrlBytes,
    redactQqSimulatorMediaUrl,
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
    runSandboxChat,
    voiceDataMaxBytes: QQ_SIMULATOR_VOICE_DATA_MAX_BYTES,
    adapterFormats: Array.from(QQ_SIMULATOR_ADAPTER_FORMATS),
    groupHistoryLimit: QQ_SIMULATOR_GROUP_HISTORY_LIMIT,
    groupHistoryTextLimit: QQ_SIMULATOR_GROUP_HISTORY_TEXT_LIMIT,
  });

  return {
    sandboxConsole,
    qqSimulatorConsole,
  };
}
