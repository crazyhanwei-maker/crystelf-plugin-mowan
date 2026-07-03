import fs from 'fs';

export function createFeatureConfigConsole(options = {}) {
  const getAllConfigs = typeof options.getAllConfigs === 'function' ? options.getAllConfigs : () => ({});
  const setConfig = typeof options.setConfig === 'function' ? options.setConfig : async () => {};
  const safeReadJson = typeof options.safeReadJson === 'function' ? options.safeReadJson : (() => ({}));
  const defaultConfigFile = options.defaultConfigFile || '';
  const getWebConsoleInfo = typeof options.getWebConsoleInfo === 'function' ? options.getWebConsoleInfo : () => null;
  const normalizeConsoleBackgroundSourceUrl = typeof options.normalizeConsoleBackgroundSourceUrl === 'function'
    ? options.normalizeConsoleBackgroundSourceUrl
    : (value = '') => String(value || '').trim();
  const defaultConsoleBackgroundSourceUrl = options.defaultConsoleBackgroundSourceUrl || '';
  const renderMarkdown = typeof options.renderMarkdown === 'function'
    ? options.renderMarkdown
    : async () => '';

  function buildEditableConfigPayload() {
    const allConfigs = getAllConfigs() || {};
    const config = allConfigs.config || {};
    const runtimeInfo = getWebConsoleInfo();
    const readOnly = config.webConsoleReadOnly === true;
    return {
      webConsole: {
        webConsole: config.webConsole !== false,
        webConsoleReadOnly: readOnly,
        webConsoleHost: readOnly ? '' : config.webConsoleHost || '0.0.0.0',
        webConsolePublicUrl: readOnly ? '' : String(config.webConsolePublicUrl || '').trim(),
        webConsolePort: readOnly ? 0 : Number(config.webConsolePort || 27891),
        webConsolePageSize: Number(config.webConsolePageSize || 20),
        webConsoleMaxPageSize: Number(config.webConsoleMaxPageSize || 100),
        webConsoleBackgroundSourceUrl: readOnly ? '' : normalizeConsoleBackgroundSourceUrl(
          config.webConsoleBackgroundSourceUrl === undefined
            ? defaultConsoleBackgroundSourceUrl
            : config.webConsoleBackgroundSourceUrl,
        ),
        webConsoleExposeLogs: config.webConsoleExposeLogs !== false,
        webConsoleLogTailLength: Number(config.webConsoleLogTailLength || 12000),
        webConsoleMaskSensitiveConfig: config.webConsoleMaskSensitiveConfig !== false,
        webConsoleProfileRecentMessagesLimit: Number(config.webConsoleProfileRecentMessagesLimit || 20),
        webConsoleAffinityHistoryLimit: Number(config.webConsoleAffinityHistoryLimit || 50),
        runtimeRunning: !!runtimeInfo,
        runtimeUrl: readOnly ? '' : runtimeInfo?.url || '',
        runtimeLoginConfigured: Boolean(String(config.webConsoleToken || '').trim()),
      },
    };
  }

  async function toggleFeatureState(feature, enabled) {
    const allConfigs = getAllConfigs() || {};
    if (['ai', 'privateAi', 'privateAiImage', 'privateAiVoice', 'privateAiMeme', 'privateAiSkills', 'music', 'rss', 'auth', 'welcome', 'groupManagement', 'groupTitle', 'poke', 'status', 'webConsole', 'voiceModel'].includes(feature)) {
      const currentConfig = allConfigs.config || {};
      const nextConfig = { ...currentConfig, [feature]: enabled };
      await setConfig('config', nextConfig);
      return true;
    }
    if (['affinity', 'userProfile'].includes(feature)) {
      const currentAi = allConfigs.ai || {};
      const nextAi = {
        ...currentAi,
        [feature]: {
          ...(currentAi[feature] || {}),
          enabled,
        },
      };
      await setConfig('ai', nextAi);
      return true;
    }
    if (feature === 'tts') {
      const currentCore = allConfigs.coreConfig || {};
      const nextCore = {
        ...currentCore,
        tools: {
          ...(currentCore.tools || {}),
          tts: {
            ...(currentCore.tools?.tts || {}),
            enabled,
          },
        },
      };
      await setConfig('coreConfig', nextCore);
      return true;
    }
    throw new Error('Unsupported managed feature');
  }

  function getManagedFeatureKeys() {
    return ['poke', 'status', '60s', 'zwa', 'rss', 'help', 'welcome', 'faceReply', 'imageMonitor', 'ai', 'privateAi', 'privateAiImage', 'privateAiVoice', 'privateAiMeme', 'privateAiSkills', 'music', 'voiceModel', 'auth', 'groupManagement', 'groupTitle', 'autoUpdate'];
  }

  function extractManagedFeatureConfig(config = {}) {
    const result = {};
    for (const key of getManagedFeatureKeys()) {
      result[key] = config[key];
    }
    return result;
  }

  function buildDefaultManagedFeatureConfig() {
    const defaults = safeReadJson(defaultConfigFile, {});
    return extractManagedFeatureConfig(defaults);
  }

  function normalizeFeatureToggleBackup(raw = {}) {
    if (!raw || typeof raw !== 'object') {
      return { config: {}, savedAt: '' };
    }
    if (raw.config && typeof raw.config === 'object') {
      return { config: extractManagedFeatureConfig(raw.config), savedAt: String(raw.savedAt || '') };
    }
    return { config: extractManagedFeatureConfig(raw), savedAt: '' };
  }

  async function manageFeatureToggle(action = '') {
    const allConfigs = getAllConfigs() || {};
    const currentConfig = allConfigs.config || {};
    const nextConfig = { ...currentConfig };
    const actionMap = {
      enable_all: () => Object.assign(nextConfig, Object.fromEntries(getManagedFeatureKeys().map(key => [key, true]))),
      disable_all: () => Object.assign(nextConfig, Object.fromEntries(getManagedFeatureKeys().map(key => [key, false]))),
      reset: () => Object.assign(nextConfig, buildDefaultManagedFeatureConfig()),
      export_current: async () => ({
        message: 'Exported current feature toggle config.',
        exportText: JSON.stringify(extractManagedFeatureConfig(currentConfig), null, 2),
      }),
      export_backup: async () => {
        const backup = normalizeFeatureToggleBackup(allConfigs.featureToggleBackup || {});
        return {
          message: backup.savedAt ? `Exported feature toggle backup from ${backup.savedAt}` : 'No feature toggle backup found.',
          exportText: JSON.stringify(backup.config || {}, null, 2),
          backup,
        };
      },
      backup: async () => {
        const payload = { savedAt: new Date().toISOString(), config: extractManagedFeatureConfig(currentConfig) };
        await setConfig('featureToggleBackup', payload);
        return { message: `Feature toggle backup saved at ${payload.savedAt}`, backup: payload };
      },
      restore: async () => {
        const backup = normalizeFeatureToggleBackup(allConfigs.featureToggleBackup || {});
        if (!Object.keys(backup.config || {}).length) throw new Error('No feature toggle backup available.');
        Object.assign(nextConfig, backup.config);
        await setConfig('config', nextConfig);
        return {
          message: backup.savedAt ? `Feature toggle backup restored from ${backup.savedAt}` : 'Feature toggle backup restored.',
          config: nextConfig,
        };
      },
    };

    if (!actionMap[action]) {
      throw new Error('Unsupported feature toggle action');
    }

    if (['backup', 'restore', 'export_current', 'export_backup'].includes(action)) {
      return await actionMap[action]();
    }

    actionMap[action]();
    await setConfig('config', nextConfig);
    return { message: 'Feature toggle config updated.', config: nextConfig };
  }

  function buildFeatureToggleHelpMarkdown() {
    return [
      '# Feature Toggle Guide',
      '',
      '> Use the web console or command entry points to quickly enable, disable, backup, or restore common plugin features.',
      '',
      '## Common Actions',
      '- Enable all managed features',
      '- Disable all managed features',
      '- Reset managed features to default config',
      '- Export current feature toggle config',
      '- Export saved feature toggle backup',
      '- Create a feature toggle backup',
      '- Restore feature toggle backup',
      '',
      '## Notes',
      '- This only affects managed feature switches listed by the console.',
      '- Backup and restore operate on the managed subset, not every config file.',
      '- Review generated preview before sharing externally.',
    ].join('\n');
  }

  async function buildFeatureToggleHelpPreviewPayload() {
    const imagePath = await renderMarkdown(buildFeatureToggleHelpMarkdown());
    if (!imagePath || !fs.existsSync(imagePath)) {
      throw new Error('Failed to render feature toggle help preview.');
    }
    const buffer = fs.readFileSync(imagePath);
    return {
      dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    };
  }

  async function saveEditableConfig(payload = {}) {
    const allConfigs = getAllConfigs() || {};
    const currentConfig = allConfigs.config || {};
    const nextConfig = {
      ...currentConfig,
      ...(payload.webConsole || {}),
    };
    await setConfig('config', nextConfig);
    return buildEditableConfigPayload();
  }

  return {
    buildEditableConfigPayload,
    toggleFeatureState,
    normalizeFeatureToggleBackup,
    manageFeatureToggle,
    buildFeatureToggleHelpPreviewPayload,
    saveEditableConfig,
  };
}
