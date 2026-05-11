import guobaSchema from '../../guoba/configSchema.js';
import { getSkillConfig, readDefaultSkillConfig, readRuntimeSkillConfig } from '../ai/httpSkillRegistry.js';
import { isSensitiveConfigKeySegment, normalizeSensitiveConfigKeySegment } from './configBackupConsole.js';
import { createPluginSettingsConsole } from './pluginSettingsConsole.js';
import { USAGE_LOG_FILE } from './webConsoleConstants.js';

export function createPluginSettingsConsoleSuite(options = {}) {
  const {
    ConfigControl,
    createHttpError,
    hasConfiguredSecret,
    getUsageOverviewSync,
    getPricingConfig,
  } = options;

  const pluginSettingsConsole = createPluginSettingsConsole({
    ConfigControl,
    guobaSchema,
    usageLogFile: USAGE_LOG_FILE,
    getUsageOverviewSync,
    getPricingConfig,
    getSkillConfig,
    readDefaultSkillConfig,
    readRuntimeSkillConfig,
    createHttpError,
    hasConfiguredSecret,
    normalizeSensitiveConfigKeySegment,
    isSensitiveConfigKeySegment,
  });

  const {
    normalizePositiveNumber,
    cloneJsonValue,
    maskDisplayUrlSecrets,
  } = pluginSettingsConsole;

  return {
    pluginSettingsConsole,
    normalizePositiveNumber,
    cloneJsonValue,
    maskDisplayUrlSecrets,
  };
}
