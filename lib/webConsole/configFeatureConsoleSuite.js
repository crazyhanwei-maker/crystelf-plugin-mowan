import Path from '../../constants/path.js';
import Renderer from '../ai/renderer.js';
import { createConfigBackupConsole } from './configBackupConsole.js';
import { createConfigPayloadConsole } from './configPayloadConsole.js';
import { createFeatureConfigConsole } from './featureConfigConsole.js';
import { createImageMonitorConsole } from './imageMonitorConsole.js';
import {
  DEFAULT_CONSOLE_BACKGROUND_SOURCE_URL,
  IMAGE_MONITOR_DIR,
  IMAGE_MONITOR_MEME_DIR,
  IMAGE_MONITOR_MEME_INDEX,
  IMAGE_MONITOR_REVIEW_LOG,
} from './webConsoleConstants.js';

export function createConfigFeatureConsoleSuite(options = {}) {
  const {
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
  } = options;

  const getAllConfigs = () => ConfigControl.get() || {};
  const configBackupConsole = createConfigBackupConsole({
    getAllConfigs,
    setMultipleConfigs: files => ConfigControl.setMultiple(files),
    listConfigHistoryEntries: options => ConfigControl.getHistory(options),
    rollbackConfigHistoryEntry: id => ConfigControl.rollbackHistory(id),
    configRoot: Path.config,
    createHttpError,
    maskSecretValue,
  });

  const {
    maskConfigPayloadSecrets,
  } = configBackupConsole;

  const configPayloadConsole = createConfigPayloadConsole({
    getAllConfigs,
    getWebConsoleConfig,
    maskConfigPayloadSecrets,
  });

  const featureConfigConsole = createFeatureConfigConsole({
    getAllConfigs,
    setConfig: (name, value) => ConfigControl.set(name, value),
    safeReadJson,
    defaultConfigFile: Path.defaultConfig,
    getWebConsoleInfo,
    normalizeConsoleBackgroundSourceUrl,
    defaultConsoleBackgroundSourceUrl: DEFAULT_CONSOLE_BACKGROUND_SOURCE_URL,
    renderMarkdown: markdown => Renderer.renderMarkdown(markdown),
  });

  const {
    normalizeFeatureToggleBackup,
  } = featureConfigConsole;

  const imageMonitorConsole = createImageMonitorConsole({
    imageMonitorDir: IMAGE_MONITOR_DIR,
    reviewLogFile: IMAGE_MONITOR_REVIEW_LOG,
    memeIndexFile: IMAGE_MONITOR_MEME_INDEX,
    memeDir: IMAGE_MONITOR_MEME_DIR,
    createHttpError,
    getRealPathSafe,
    getImageMonitorConfig: () => ConfigControl.get('imageMonitor') || {},
    getPageSize: () => getWebConsoleConfig().pageSize,
    paginateItems,
    sendJson,
    sendBinary,
  });

  const {
    buildLogPayload: buildImageMonitorLogPayload,
  } = imageMonitorConsole;

  return {
    configBackupConsole,
    configPayloadConsole,
    featureConfigConsole,
    imageMonitorConsole,
    maskConfigPayloadSecrets,
    normalizeFeatureToggleBackup,
    buildImageMonitorLogPayload,
  };
}
