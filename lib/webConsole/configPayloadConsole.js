export function createConfigPayloadConsole(options = {}) {
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : (() => ({}));
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({}));
  const maskConfigPayloadSecrets = typeof options.maskConfigPayloadSecrets === 'function'
    ? options.maskConfigPayloadSecrets
    : (value => value);

  function buildConfigPayload() {
    const allConfigs = getAllConfigs() || {};
    const webConsole = getWebConsoleConfig();
    if (webConsole.readOnly) {
      const aiConfig = allConfigs.ai || {};
      const pokeConfig = allConfigs.poke || {};
      const coreConfig = allConfigs.coreConfig || {};
      return {
        config: {
          ai: allConfigs.config?.ai !== false,
          music: allConfigs.config?.music !== false,
          rss: allConfigs.config?.rss !== false,
          auth: allConfigs.config?.auth !== false,
          welcome: allConfigs.config?.welcome !== false,
          groupManagement: allConfigs.config?.groupManagement !== false,
          groupTitle: allConfigs.config?.groupTitle !== false,
          poke: allConfigs.config?.poke !== false,
          status: allConfigs.config?.status !== false,
          webConsole: allConfigs.config?.webConsole !== false,
        },
        ai: {
          mode: aiConfig.mode || '',
          modelType: aiConfig.modelType || '',
          workingModel: aiConfig.workingModel || '',
          affinity: { enabled: aiConfig.affinity?.enabled !== false },
          userProfile: { enabled: aiConfig.userProfile?.enabled !== false },
          fallbackReply: String(aiConfig.fallbackReply || '').trim() ? '[configured]' : '',
          fallbackSearchReply: String(aiConfig.fallbackSearchReply || '').trim() ? '[configured]' : '',
          fallbackTimeoutReply: String(aiConfig.fallbackTimeoutReply || '').trim() ? '[configured]' : '',
          fallbackGenericReply: String(aiConfig.fallbackGenericReply || '').trim() ? '[configured]' : '',
        },
        poke: {
          mode: pokeConfig.mode || '',
          imageEnabled: pokeConfig.imageEnabled !== false,
          fallbackReply: String(pokeConfig.fallbackReply || '').trim() ? '[configured]' : '',
        },
        coreConfig: {
          tools: {
            tts: { enabled: coreConfig.tools?.tts?.enabled !== false },
            search: { enabled: coreConfig.tools?.search?.enabled !== false },
          },
          usageControl: {
            enabled: coreConfig.usageControl?.enabled !== false,
            dailyTokenLimit: coreConfig.usageControl?.dailyTokenLimit ?? '',
          },
        },
        imageMonitor: {
          enabled: allConfigs.imageMonitor?.enabled !== false,
        },
        webConsole: {
          readOnly: true,
          exposeLogs: webConsole.exposeLogs,
          maskSensitiveConfig: webConsole.maskSensitiveConfig,
        },
      };
    }

    const rawCoreConfig = { ...(allConfigs.coreConfig || {}) };
    delete rawCoreConfig.token;

    return {
      config: maskConfigPayloadSecrets(allConfigs.config || {}),
      ai: maskConfigPayloadSecrets(allConfigs.ai || {}),
      poke: maskConfigPayloadSecrets(allConfigs.poke || {}),
      coreConfig: maskConfigPayloadSecrets(rawCoreConfig),
      imageMonitor: maskConfigPayloadSecrets(allConfigs.imageMonitor || {}),
      webConsole: maskConfigPayloadSecrets(webConsole),
    };
  }

  return {
    buildConfigPayload,
  };
}
