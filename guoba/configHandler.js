import ConfigControl from '../lib/config/configControl.js';
import UserConfigManager from '../lib/ai/userConfigManager.js';
import { getUsageOverviewSync } from '../lib/ai/usageLogger.js';
import { getTtsModelSummarySync, refreshTtsModelsAndGetSummary } from '../lib/ai/ttsRegistry.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isDeepStrictEqual } from 'util';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (isPlainObject(value)) {
    const cloned = {};
    for (const [key, item] of Object.entries(value)) {
      cloned[key] = cloneValue(item);
    }
    return cloned;
  }

  return value;
}

function setByPath(target, keyPath, value) {
  const parts = String(keyPath).split('.');
  let current = target;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = cloneValue(value);
}

function mergeDeep(base, patch) {
  const result = isPlainObject(base) ? cloneValue(base) : {};

  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeDeep(result[key], value);
    } else if (isPlainObject(value)) {
      result[key] = mergeDeep({}, value);
    } else {
      result[key] = cloneValue(value);
    }
  }

  return result;
}

function flattenObject(obj, prefix = '') {
  const result = {};

  for (const [key, value] of Object.entries(obj || {})) {
    if (key === '//' || key.startsWith('?')) continue;

    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, nextKey));
    } else {
      result[nextKey] = value;
    }
  }

  return result;
}

function expandFlatConfig(data = {}) {
  const configUpdates = {};

  for (const [fieldPath, value] of Object.entries(data || {})) {
    const parts = String(fieldPath).split('.');
    const configName = parts[0];

    if (!configName || configName === 'feeds' || configName === 'newcomer') continue;

    if (parts.length === 1) {
      configUpdates[configName] = value;
      continue;
    }

    if (
      !configUpdates[configName] ||
      typeof configUpdates[configName] !== 'object' ||
      Array.isArray(configUpdates[configName])
    ) {
      configUpdates[configName] = {};
    }

    setByPath(configUpdates[configName], parts.slice(1).join('.'), value);
  }

  return configUpdates;
}

function pushRangeError(errors, value, min, max, message) {
  if (value === undefined) return;
  const num = Number(value);
  if (Number.isNaN(num) || num < min || num > max) {
    errors.push(message);
  }
}

function pushMinError(errors, value, min, message) {
  if (value === undefined) return;
  const num = Number(value);
  if (Number.isNaN(num) || num < min) {
    errors.push(message);
  }
}

function normalizeMusicUrlsValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(/\r?\n|,|;/)
    .map(item => item.trim())
    .filter(Boolean);
}

function formatMusicUrlsValue(value) {
  return normalizeMusicUrlsValue(value).join('\n');
}

export async function getConfigData() {
  const allConfigs = ConfigControl.get();
  const result = {};

  for (const [configName, configData] of Object.entries(allConfigs || {})) {
    if (configName === 'feeds' || configName === 'newcomer') continue;
    Object.assign(result, flattenObject(configData, configName));
  }

  const musicConfig = allConfigs?.music || {};
  result['music.urls'] = formatMusicUrlsValue(musicConfig.urls ?? musicConfig.url ?? '');

  const usagePricing = allConfigs?.coreConfig?.usageControl
    ? {
        enabled: allConfigs.coreConfig.usageControl.pricingEnabled !== false,
        currencySymbol: allConfigs.coreConfig.usageControl.currencySymbol || '$',
        promptPricePer1M: Number(allConfigs.coreConfig.usageControl.promptPricePer1M || 0),
        completionPricePer1M: Number(allConfigs.coreConfig.usageControl.completionPricePer1M || 0),
        modelPricing: allConfigs.coreConfig.usageControl.modelPricing || '',
      }
    : {};

  const usageOverview = getUsageOverviewSync(new Date(), usagePricing);
  result['coreConfig.usageControl.dailySummary'] = usageOverview.summary_text;
  result['coreConfig.usageControl.dailySceneSummary'] = usageOverview.scene_text;
  result['coreConfig.usageControl.dailyModelSummary'] = usageOverview.model_text;
  result['coreConfig.usageControl.dailyCostSummary'] = usageOverview.cost_text;
  result['coreConfig.usageControl.dailyModelCostSummary'] = usageOverview.model_cost_text;
  result['coreConfig.usageControl.dailyLogFile'] = usageOverview.daily_log_file;
  result['coreConfig.usageControl.totalLogFile'] = usageOverview.all_log_file;
  result['coreConfig.tools.tts.modelSummary'] = '';

  const ttsConfig = allConfigs?.coreConfig?.tools?.tts;
  if (ttsConfig?.modelsUrl) {
    const refreshResult = await refreshTtsModelsAndGetSummary();
    if (!refreshResult.success && refreshResult.error) {
      result['coreConfig.tools.tts.modelSummary'] =
        refreshResult.summary || `模型列表刷新失败: ${refreshResult.error}`;
    } else {
      result['coreConfig.tools.tts.modelSummary'] =
        refreshResult.summary || getTtsModelSummarySync();
    }
  }

  return result;
}

export async function setConfigData(data, { Result }) {
  try {
    const normalizedInput = { ...(data || {}) };
    if (Object.prototype.hasOwnProperty.call(normalizedInput, 'music.urls')) {
      normalizedInput['music.urls'] = normalizeMusicUrlsValue(normalizedInput['music.urls']);
    }

    const configUpdates = expandFlatConfig(normalizedInput);
    const pendingUpdates = [];

    for (const [configName, newConfigData] of Object.entries(configUpdates)) {
      const existingConfig = ConfigControl.get(configName) || {};
      const updatedConfig = mergeDeep(existingConfig, newConfigData);
      const isChanged = !isDeepStrictEqual(updatedConfig, existingConfig);

      if (!isChanged) continue;
      const validationResult = validateConfig(configName, updatedConfig);
      if (!validationResult.valid) {
        return Result.error({}, `配置验证失败: ${validationResult.errors.join(', ')}`);
      }
      pendingUpdates.push([configName, updatedConfig]);
    }

    for (const [configName, updatedConfig] of pendingUpdates) {
      await ConfigControl.set(configName, updatedConfig);
    }
    UserConfigManager.clearCache();

    return Result.ok({}, '保存成功~');
  } catch (error) {
    logger.error('[crystelf-plugin] 保存配置失败:', error);
    return Result.error({}, '保存配置失败: ' + error.message);
  }
}

export async function resetConfig({ Result }) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const pluginDir = path.dirname(__filename);
    const configDir = path.join(pluginDir, '..', 'config');
    const dataConfigPath = path.join(process.cwd(), 'data', 'crystelf');

    if (!fs.existsSync(dataConfigPath)) {
      fs.mkdirSync(dataConfigPath, { recursive: true });
    }

    const configFiles = fs.readdirSync(configDir).filter((file) => file.endsWith('.json'));
    const defaultConfigs = {};

    for (const file of configFiles) {
      const configName = path.basename(file, '.json');
      const sourcePath = path.join(configDir, file);
      const targetPath = path.join(dataConfigPath, file);

      try {
        const configContent = fs.readFileSync(sourcePath, 'utf8');
        defaultConfigs[configName] = JSON.parse(configContent);
        fs.writeFileSync(targetPath, configContent, 'utf8');
      } catch (error) {
        logger.error(`[crystelf-ai] 复制配置文件失败 ${file}: ${error.message}`);
        return Result.error({}, `复制配置文件失败 ${file}: ${error.message}`);
      }
    }

    await ConfigControl.setMultiple(defaultConfigs);
    UserConfigManager.clearCache();

    return Result.ok({}, '重置成功~');
  } catch (error) {
    logger.error(`[crystelf-ai] 重置配置失败: ${error.message}`);
    return Result.error({}, `重置失败: ${error.message}`);
  }
}

export async function exportConfig({ Result }) {
  try {
    const config = await getConfigData();
    return Result.ok({ config }, '导出成功~');
  } catch (error) {
    logger.error(`[crystelf-ai] 导出配置失败: ${error.message}`);
    return Result.error({}, `导出失败: ${error.message}`);
  }
}

export async function importConfig(data, { Result }) {
  try {
    if (!data?.config || typeof data.config !== 'object') {
      return Result.error({}, '导入数据格式错误');
    }

    const importedConfigs = expandFlatConfig(data.config);
    const validationResult = validateConfig(importedConfigs);
    if (!validationResult.valid) {
      return Result.error({}, `配置验证失败: ${validationResult.errors.join(', ')}`);
    }

    await ConfigControl.setMultiple(importedConfigs);
    UserConfigManager.clearCache();

    return Result.ok({}, '导入成功~');
  } catch (error) {
    logger.error(`[crystelf-ai] 导入配置失败: ${error.message}`);
    return Result.error({}, `导入失败: ${error.message}`);
  }
}

function validateConfig(configType, config = null) {
  if (config === null) {
    const nestedConfigs = expandFlatConfig(configType);
    const mergedErrors = [];

    for (const [name, value] of Object.entries(nestedConfigs)) {
      const result = validateConfig(name, value);
      if (!result.valid) {
        mergedErrors.push(...result.errors.map((error) => `${name}: ${error}`));
      }
    }

    return {
      valid: mergedErrors.length === 0,
      errors: mergedErrors,
    };
  }

  const errors = [];

  switch (configType) {
    case 'ai':
      if (!config.baseApi) errors.push('AI API 地址不能为空，应类似 https://xx.xx.com/v1');
      if (!config.mode) errors.push('对话模式不能为空');
      if (!config.apiKey) errors.push('AI API Key 不能为空');
      if (!config.modelType) errors.push('文本模型不能为空');
      if (config.multimodalEnabled && !String(config.multimodalModel || '').trim()) {
        errors.push('启用多模态时，多模态模型不能为空');
      }
      if (config.character !== undefined && typeof config.character !== 'string') {
        errors.push('表情包角色必须是字符串');
      }
      ['localEnabled', 'preferLocal'].forEach((field) => {
        if (config.memeConfig?.[field] !== undefined && typeof config.memeConfig[field] !== 'boolean') {
          errors.push(`本地表情包配置 ${field} 必须是布尔值`);
        }
      });
      if (config.memeConfig?.localBaseDir !== undefined && typeof config.memeConfig.localBaseDir !== 'string') {
        errors.push('本地表情包目录必须是字符串');
      }
      if (config.botPersona !== undefined && typeof config.botPersona !== 'string') {
        errors.push('机器人设定必须是字符串');
      }

      pushRangeError(errors, config.temperature, 0, 2, '聊天温度必须在 0-2 之间');
      pushMinError(errors, config.maxMix, 1, '混合模式阈值必须大于 0');
      pushMinError(errors, config.timeout, 1, 'AI 调用超时时间必须大于 0');
      pushMinError(errors, config.maxSessions, 1, '最大会话数必须大于 0');
      if (config.maxIterations !== undefined && Number(config.maxIterations) < -1) {
        errors.push('最大推理轮次不能小于 -1');
      }
      pushRangeError(errors, config.chatHistory, 1, 100, '聊天历史长度必须在 1-100 之间');
      pushRangeError(errors, config.getChatHistoryLength, 1, 100, '抓取群历史条数必须在 1-100 之间');
      pushMinError(errors, config.maxMessageLength, 1, '最大消息长度必须大于 0');

      if (config.blockGroup !== undefined && !Array.isArray(config.blockGroup)) {
        errors.push('禁用群聊必须是数组');
      }
      if (config.whiteGroup !== undefined && !Array.isArray(config.whiteGroup)) {
        errors.push('白名单群聊必须是数组');
      }
      if (config.dailyGroupSummary !== undefined) {
        const daily = config.dailyGroupSummary || {};
        if (daily.enabled !== undefined && typeof daily.enabled !== 'boolean') {
          errors.push('每日群聊总结开关必须是布尔值');
        }
        if (daily.targetMode !== undefined && !['selected', 'all'].includes(String(daily.targetMode))) {
          errors.push('每日群聊总结范围必须是 selected 或 all');
        }
        if (daily.enabledGroups !== undefined && !Array.isArray(daily.enabledGroups)) {
          errors.push('每日群聊总结启用群必须是数组');
        }
        if (daily.blockedGroups !== undefined && !Array.isArray(daily.blockedGroups)) {
          errors.push('每日群聊总结禁用群必须是数组');
        }
        pushRangeError(errors, daily.hour, 0, 23, '每日群聊总结小时必须在 0-23 之间');
        pushRangeError(errors, daily.minute, 0, 59, '每日群聊总结分钟必须在 0-59 之间');
        pushRangeError(errors, daily.minMessages, 1, 500, '每日群聊总结最低消息数必须在 1-500 之间');
        pushRangeError(errors, daily.maxMessages, 10, 1000, '每日群聊总结消息上限必须在 10-1000 之间');
        pushRangeError(errors, daily.maxMessageChars, 20, 1000, '每日群聊总结单条消息长度必须在 20-1000 之间');
        pushRangeError(errors, daily.maxSummaryChars, 100, 3000, '每日群聊总结文本长度必须在 100-3000 之间');
        pushRangeError(errors, daily.retentionDays, 1, 60, '每日群聊总结记录保留天数必须在 1-60 之间');
        pushRangeError(errors, daily.temperature, 0, 2, '每日群聊总结温度必须在 0-2 之间');
        pushRangeError(errors, daily.maxTokens, 100, 4000, '每日群聊总结输出 token 必须在 100-4000 之间');
        if (daily.includeCommands !== undefined && typeof daily.includeCommands !== 'boolean') {
          errors.push('每日群聊总结命令消息开关必须是布尔值');
        }
        if (daily.imageEnabled !== undefined && typeof daily.imageEnabled !== 'boolean') {
          errors.push('每日群聊总结图片模式开关必须是布尔值');
        }
        ['title', 'prompt'].forEach((field) => {
          if (daily[field] !== undefined && typeof daily[field] !== 'string') {
            errors.push(`每日群聊总结 ${field} 必须是字符串`);
          }
        });
      }
      if (config.fallbackReply !== undefined && typeof config.fallbackReply !== 'string') {
        errors.push('模型故障降级回复必须是字符串');
      }
      ['fallbackSearchReply', 'fallbackTimeoutReply', 'fallbackGenericReply'].forEach((field) => {
        if (config[field] !== undefined && typeof config[field] !== 'string') {
          errors.push(`AI 配置 ${field} 必须是字符串`);
        }
      });

      pushRangeError(
        errors,
        config.userProfile?.minMessagesToBuild,
        3,
        100,
        '用户画像生成门槛必须在 3-100 之间'
      );
      pushRangeError(
        errors,
        config.userProfile?.maxProfileItems,
        1,
        10,
        '画像条目上限必须在 1-10 之间'
      );
      if (
        config.affinity?.minScore !== undefined &&
        config.affinity?.maxScore !== undefined &&
        Number(config.affinity.minScore) >= Number(config.affinity.maxScore)
      ) {
        errors.push('好感度最小值必须小于最大值');
      }
      ['positiveKeywords', 'strongPositiveKeywords', 'negativeKeywords', 'strongNegativeKeywords'].forEach((field) => {
        if (config.affinity?.[field] !== undefined && typeof config.affinity[field] !== 'string') {
          errors.push(`好感度配置 ${field} 必须是字符串`);
        }
      });
      pushMinError(errors, config.affinity?.keywordCooldownMs, 0, '关键词冷却时间不能小于 0');
      pushMinError(errors, config.affinity?.duplicateTextCooldownMs, 0, '重复文本冷却时间不能小于 0');
      pushRangeError(
        errors,
        config.affinity?.streakAttenuationThreshold,
        1,
        20,
        '连续衰减阈值必须在 1-20 之间'
      );
      pushRangeError(
        errors,
        config.affinity?.streakAttenuationFactor,
        0,
        1,
        '连续衰减系数必须在 0-1 之间'
      );

      pushMinError(errors, config.followUp?.windowMs, 0, '回复后继续监听时长不能小于 0');
      pushRangeError(
        errors,
        config.followUp?.maxMessages,
        1,
        20,
        '回复后继续监听的观察条数必须在 1-20 之间'
      );
      pushRangeError(
        errors,
        config.personality?.stateProbability,
        0,
        1,
        '人格状态触发概率必须在 0-1 之间'
      );
      if (config.personality?.states !== undefined && !Array.isArray(config.personality.states)) {
        errors.push('人格状态列表必须是数组');
      }
      pushRangeError(
        errors,
        config.replyStyle?.multipleProbability,
        0,
        1,
        '特殊回复风格触发概率必须在 0-1 之间'
      );
      if (config.replyStyle?.multipleStyles !== undefined && !Array.isArray(config.replyStyle.multipleStyles)) {
        errors.push('特殊回复风格列表必须是数组');
      }
      pushRangeError(errors, config.codeRenderer?.fontSize, 10, 24, '代码字体大小必须在 10-24 之间');
      pushRangeError(errors, config.markdownRenderer?.fontSize, 10, 24, 'Markdown 字体大小必须在 10-24 之间');
      if (config.imageConfig?.modalities !== undefined && !Array.isArray(config.imageConfig.modalities)) {
        errors.push('图像输出模态必须是数组');
      }
      ['fallbackReply', 'fallbackTimeoutReply'].forEach((field) => {
        if (config.imageConfig?.[field] !== undefined && typeof config.imageConfig[field] !== 'string') {
          errors.push(`图像配置 ${field} 必须是字符串`);
        }
      });
      break;

    case '60s':
    case 'auth':
      if (!config.url) {
        errors.push('URL 不能为空');
      }
      if (config.default !== undefined) {
        if (!isPlainObject(config.default)) {
          errors.push('默认入群验证配置必须是对象');
          break;
        }
        ['enable', 'recall'].forEach((field) => {
          if (config.default[field] !== undefined && typeof config.default[field] !== 'boolean') {
            errors.push(`默认入群验证 ${field} 必须是布尔值`);
          }
        });
        if (config.default.carbon !== undefined) {
          if (!isPlainObject(config.default.carbon)) {
            errors.push('默认手性碳验证配置必须是对象');
          } else {
            ['enable', 'hint', 'hard-mode'].forEach((field) => {
              if (config.default.carbon[field] !== undefined && typeof config.default.carbon[field] !== 'boolean') {
                errors.push(`默认手性碳验证 ${field} 必须是布尔值`);
              }
            });
          }
        }
        pushRangeError(errors, config.default.timeout, 30, 1800, '默认验证超时时间必须在 30-1800 秒之间');
        pushRangeError(errors, config.default.frequency, 1, 24, '默认验证次数必须在 1-24 之间');
        if (config.default.autoApprove !== undefined) {
          if (!isPlainObject(config.default.autoApprove)) {
            errors.push('默认加群申请自动通过配置必须是对象');
          } else {
            const auto = config.default.autoApprove;
            if (auto.enable !== undefined && typeof auto.enable !== 'boolean') {
              errors.push('默认加群申请自动通过开关必须是布尔值');
            }
            pushRangeError(errors, auto.minQqLevel, 0, 255, '默认最低 QQ 等级必须在 0-255 之间');
            pushRangeError(errors, auto.minAge, 0, 150, '默认最低年龄必须在 0-150 之间');
            ['commentKeywords', 'blockedKeywords', 'customRules'].forEach((field) => {
              if (auto[field] !== undefined && !Array.isArray(auto[field])) {
                errors.push(`默认自动通过 ${field} 必须是数组`);
              }
            });
            if (auto.risk !== undefined) {
              if (!isPlainObject(auto.risk)) {
                errors.push('默认入群风险评分配置必须是对象');
              } else {
                ['enabled', 'scoreEnabled', 'blockBlacklistAutoApprove', 'autoApproveWhitelisted', 'holdHighRisk'].forEach((field) => {
                  if (auto.risk[field] !== undefined && typeof auto.risk[field] !== 'boolean') {
                    errors.push(`默认入群风险评分 ${field} 必须是布尔值`);
                  }
                });
                pushRangeError(errors, auto.risk.highRiskScore, 1, 100, '默认高风险阈值必须在 1-100 之间');
                pushRangeError(errors, auto.risk.warningBlockThreshold, 0, 100, '默认警告拦截阈值必须在 0-100 之间');
              }
            }
          }
        }
      }
      break;

    case 'music':
      if (!Array.isArray(config.urls) && !String(config.url || '').trim()) {
        errors.push('音乐服务地址不能为空');
      }
      if (config.urls !== undefined && !Array.isArray(config.urls)) {
        errors.push('音乐源地址必须是数组');
      }
      if (!config.quality) {
        errors.push('音乐质量不能为空');
      }
      break;

    case 'poke':
      pushRangeError(errors, config.replyPoke, 0, 1, '戳一戳概率必须在 0-1 之间');
      if (config.replyMode !== undefined && !['ai', 'normal', 'auto'].includes(String(config.replyMode))) {
        errors.push('戳一戳回复模式必须是 ai、normal 或 auto');
      }
      pushRangeError(errors, config.temperature, 0, 2, '戳一戳温度必须在 0-2 之间');
      pushRangeError(errors, config.maxTokens, 1, 1024, '戳一戳最大输出长度必须在 1-1024 之间');
      ['memeReplyProbability', 'voiceReplyProbability'].forEach((field) => {
        pushRangeError(errors, config[field], 0, 1, `戳一戳配置 ${field} 必须在 0-1 之间`);
      });
      pushMinError(errors, config.cooldownMs, 0, '戳一戳用户冷却时间不能小于 0');
      pushMinError(errors, config.groupRateWindowMs, 1000, '戳一戳群限频窗口不能小于 1000 毫秒');
      pushMinError(errors, config.groupRateMaxReplies, 1, '戳一戳群窗口回复上限不能小于 1');
      pushRangeError(errors, config.maxReplyMessages, 1, 10, '戳一戳最大回复条数必须在 1-10 之间');
      pushMinError(errors, config.followGroupWindowMs, 1000, '戳一戳监听时长不能小于 1000 毫秒');
      pushMinError(errors, config.followGroupMaxReplies, 0, '戳一戳追踪回复上限不能小于 0');
      ['enableTextReply', 'enableMemeReply', 'enableVoiceReply'].forEach((field) => {
        if (config[field] !== undefined && typeof config[field] !== 'boolean') {
          errors.push(`戳一戳配置 ${field} 必须是布尔值`);
        }
      });
      if (config.followGroupAfterPoke !== undefined && typeof config.followGroupAfterPoke !== 'boolean') {
        errors.push('戳一戳继续监听群聊配置必须是布尔值');
      }
      break;

    case 'profile':
      if (!config.nickName) {
        errors.push('机器人昵称不能为空');
      }
      break;

    case 'groupTitle':
      if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
        errors.push('群头衔申请开关必须是布尔值');
      }
      if (config.autoApprove !== undefined && typeof config.autoApprove !== 'boolean') {
        errors.push('群头衔自动通过开关必须是布尔值');
      }
      if (config.allowedGroups !== undefined && !Array.isArray(config.allowedGroups)) {
        errors.push('群头衔申请允许群必须是数组');
      }
      if (config.blockedGroups !== undefined && !Array.isArray(config.blockedGroups)) {
        errors.push('群头衔申请禁止群必须是数组');
      }
      if (config.approvalRoles !== undefined) {
        if (!Array.isArray(config.approvalRoles)) {
          errors.push('群头衔申请审核身份必须是数组');
        } else if (config.approvalRoles.some(role => !['owner', 'admin'].includes(String(role)))) {
          errors.push('群头衔申请审核身份只能是 owner 或 admin');
        }
      }
      if (config.forbiddenKeywords !== undefined) {
        if (!Array.isArray(config.forbiddenKeywords)) {
          errors.push('群头衔禁用词必须是数组');
        } else if (config.forbiddenKeywords.some(keyword => typeof keyword !== 'string')) {
          errors.push('群头衔禁用词必须是字符串数组');
        } else if (config.forbiddenKeywords.length > 200) {
          errors.push('群头衔禁用词最多 200 个');
        }
      }
      pushRangeError(errors, config.maxDisplayWidth, 2, 24, '群头衔长度上限必须在 2-24 之间');
      pushRangeError(errors, config.pendingExpireHours, 1, 720, '群头衔申请过期时间必须在 1-720 小时之间');
      if (config.aiReview !== undefined) {
        if (!isPlainObject(config.aiReview)) {
          errors.push('群头衔 AI 审核配置必须是对象');
        } else {
          if (config.aiReview.enabled !== undefined && typeof config.aiReview.enabled !== 'boolean') {
            errors.push('群头衔 AI 审核开关必须是布尔值');
          }
          if (
            config.aiReview.autoRejectIllegal !== undefined
            && typeof config.aiReview.autoRejectIllegal !== 'boolean'
          ) {
            errors.push('群头衔 AI 自动拒绝开关必须是布尔值');
          }
          ['model', 'policy'].forEach((field) => {
            if (config.aiReview[field] !== undefined && typeof config.aiReview[field] !== 'string') {
              errors.push(`群头衔 AI 审核 ${field} 必须是字符串`);
            }
          });
          pushRangeError(errors, config.aiReview.temperature, 0, 2, '群头衔 AI 审核温度必须在 0-2 之间');
          pushRangeError(
            errors,
            config.aiReview.maxTokens,
            100,
            1000,
            '群头衔 AI 审核输出 token 必须在 100-1000 之间'
          );
        }
      }
      break;

    case 'coreConfig':
      pushMinError(errors, config.usageControl?.dailyTokenLimit, 0, '每日 Token 上限不能小于 0');
      pushMinError(errors, config.usageControl?.dailyRequestLimit, 0, '每日请求上限不能小于 0');
      pushMinError(errors, config.usageControl?.promptPricePer1M, 0, '输入 token 单价不能小于 0');
      pushMinError(errors, config.usageControl?.completionPricePer1M, 0, '输出 token 单价不能小于 0');
      if (config.usageControl?.modelPricing !== undefined && typeof config.usageControl.modelPricing !== 'string') {
        errors.push('按模型单价配置必须是字符串');
      }
      pushMinError(errors, config.tools?.tts?.maxTextLength, 1, '语音最大文本长度必须大于 0');
      pushMinError(errors, config.tools?.tts?.maxAutoVoiceTextLength, 1, '自动语音最大长度必须大于 0');
      break;

    case 'imageMonitor':
      ['enabled', 'saveReviewImages', 'saveMemeImages', 'autoRecallViolation', 'monitorQuotedImages'].forEach((field) => {
        if (config[field] !== undefined && typeof config[field] !== 'boolean') {
          errors.push(`图片监控配置 ${field} 必须是布尔值`);
        }
      });
      if (config.apiBase !== undefined && typeof config.apiBase !== 'string') {
        errors.push('图片监控模型地址必须是字符串');
      }
      if (config.apiKey !== undefined && typeof config.apiKey !== 'string') {
        errors.push('图片监控模型密钥必须是字符串');
      }
      if (config.model !== undefined && typeof config.model !== 'string') {
        errors.push('图片监控模型名称必须是字符串');
      }
      if (config.prompt !== undefined && typeof config.prompt !== 'string') {
        errors.push('图片监控提示词必须是字符串');
      }
      ['fallbackReply', 'fallbackTimeoutReply'].forEach((field) => {
        if (config[field] !== undefined && typeof config[field] !== 'string') {
          errors.push(`图片监控配置 ${field} 必须是字符串`);
        }
      });
      pushRangeError(errors, config.temperature, 0, 1, '图片监控温度必须在 0-1 之间');
      pushRangeError(errors, config.maxImagesPerMessage, 1, 10, '单条消息最大图片数必须在 1-10 之间');
      pushMinError(errors, config.duplicateWindowMs, 0, '图片监控去重窗口不能小于 0');
      pushMinError(errors, config.analysisTimeoutMs, 1000, '图片监控识别超时不能小于 1000 毫秒');
      if (config.violationAction !== undefined && !['record', 'alert', 'recall'].includes(String(config.violationAction))) {
        errors.push('图片监控处理方式必须是 record、alert 或 recall');
      }
      if (config.riskThreshold !== undefined && !['low', 'medium', 'high'].includes(String(config.riskThreshold))) {
        errors.push('图片监控违规阈值必须是 low、medium 或 high');
      }
      if (config.allowedGroups !== undefined && !Array.isArray(config.allowedGroups)) {
        errors.push('图片监控白名单群必须是数组');
      }
      if (config.blockedGroups !== undefined && !Array.isArray(config.blockedGroups)) {
        errors.push('图片监控黑名单群必须是数组');
      }
      if (config.saveMemeCharacters !== undefined && !Array.isArray(config.saveMemeCharacters)) {
        errors.push('图片监控入库角色白名单必须是数组');
      }
      if (config.saveMemeKeywords !== undefined && !Array.isArray(config.saveMemeKeywords)) {
        errors.push('图片监控入库关键词白名单必须是数组');
      }
      break;

    case 'config':
      [
        'autoUpdate',
        'poke',
        '60s',
        'zwa',
        'rss',
        'help',
        'dependencyRepair',
        'welcome',
        'faceReply',
        'imageMonitor',
        'ai',
        'music',
        'auth',
        'groupManagement',
        'groupTitle',
        'webConsole',
        'webConsoleReadOnly',
        'webConsolePortAutoIncrement',
        'webConsoleExposeLogs',
        'webConsoleMaskSensitiveConfig',
      ].forEach((field) => {
        if (config[field] !== undefined && typeof config[field] !== 'boolean') {
          errors.push(`配置开关 ${field} 必须是布尔值`);
        }
      });
      pushRangeError(errors, config.maxFeed, 1, 50, '最长订阅数量必须在 1-50 之间');
      pushRangeError(errors, config.webConsolePageSize, 1, 100, '控制台每页数量必须在 1-100 之间');
      pushRangeError(errors, config.webConsoleMaxPageSize, 1, 500, '控制台最大每页数量必须在 1-500 之间');
      if (
        config.webConsolePageSize !== undefined &&
        config.webConsoleMaxPageSize !== undefined &&
        Number(config.webConsolePageSize) > Number(config.webConsoleMaxPageSize)
      ) {
        errors.push('控制台每页数量不能大于最大每页数量');
      }
      if (config.webConsoleToken !== undefined && typeof config.webConsoleToken !== 'string') {
        errors.push('控制台登录口令必须是字符串');
      }
      if (config.webConsoleHost !== undefined && typeof config.webConsoleHost !== 'string') {
        errors.push('控制台地址必须是字符串');
      }
      if (config.webConsoleBackgroundSourceUrl !== undefined) {
        if (typeof config.webConsoleBackgroundSourceUrl !== 'string') {
          errors.push('控制台壁纸源必须是字符串');
        } else if (config.webConsoleBackgroundSourceUrl.trim()) {
          try {
            const parsed = new URL(config.webConsoleBackgroundSourceUrl.trim());
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
              errors.push('控制台壁纸源必须是 http/https 地址，且不能包含账号密码');
            }
          } catch {
            errors.push('控制台壁纸源 URL 格式不正确');
          }
        }
      }
      pushRangeError(errors, config.webConsolePort, 1, 65535, '控制台端口必须在 1-65535 之间');
      pushRangeError(errors, config.webConsoleLogTailLength, 1000, 200000, '日志读取长度必须在 1000-200000 之间');
      pushRangeError(errors, config.webConsoleProfileRecentMessagesLimit, 0, 100, '画像消息条数必须在 0-100 之间');
      pushRangeError(errors, config.webConsoleAffinityHistoryLimit, 1, 500, '好感历史条数必须在 1-500 之间');
      break;

    default:
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
