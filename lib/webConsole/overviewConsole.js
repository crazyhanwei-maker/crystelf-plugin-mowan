export function createOverviewConsole(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const Path = options.Path || {};
  const ConfigControl = options.ConfigControl || options.configControl || { get: () => ({}) };
  const Version = options.Version || {};
  const chatDbFile = options.chatDbFile || '';
  const affinityFile = options.affinityFile || '';
  const usageLogFile = options.usageLogFile || '';
  const affinityLogFile = options.affinityLogFile || '';
  const safeReadJson = typeof options.safeReadJson === 'function'
    ? options.safeReadJson
    : (() => ({}));
  const safeReadUsageEntries = typeof options.safeReadUsageEntries === 'function'
    ? options.safeReadUsageEntries
    : (() => []);
  const getUsageOverviewSync = typeof options.getUsageOverviewSync === 'function'
    ? options.getUsageOverviewSync
    : (() => ({}));
  const getPricingConfig = typeof options.getPricingConfig === 'function'
    ? options.getPricingConfig
    : (() => ({}));
  const normalizeFeatureToggleBackup = typeof options.normalizeFeatureToggleBackup === 'function'
    ? options.normalizeFeatureToggleBackup
    : (value => value || {});
  const isImageMonitorReviewUsage = typeof options.isImageMonitorReviewUsage === 'function'
    ? options.isImageMonitorReviewUsage
    : (() => false);
  const getWebConsoleInfo = typeof options.getWebConsoleInfo === 'function'
    ? options.getWebConsoleInfo
    : (() => null);
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({}));
  const buildDependencyReport = typeof options.buildDependencyReport === 'function'
    ? options.buildDependencyReport
    : (() => ({ summary: {}, problemItems: [] }));
  const buildDependencyReportSummaryOnly = typeof options.buildDependencyReportSummaryOnly === 'function'
    ? options.buildDependencyReportSummaryOnly
    : (report => report);

  function getChatSnapshot() {
    return safeReadJson(chatDbFile, {
      sessions: [],
      messages: [],
      topics: [],
      expressions: [],
      profiles: [],
    });
  }
  
  function getAffinitySnapshot() {
    return safeReadJson(affinityFile, {});
  }
  
  function buildUserNameMap() {
    const chat = getChatSnapshot();
    const map = new Map();
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
  
    for (const item of messages) {
      if (item?.userId && item?.userName) {
        map.set(`${item.groupId || item.sessionId || ''}:${item.userId}`, item.userName);
        map.set(`:${item.userId}`, item.userName);
      }
    }
  
    for (const item of profiles) {
      if (item?.userId && item?.userName) {
        map.set(`${item.sessionId || ''}:${item.userId}`, item.userName);
        map.set(`:${item.userId}`, item.userName);
      }
    }
  
    return map;
  }
  
  function resolveDisplayName(nameMap, groupId, sessionId, userId, fallback = '') {
    return nameMap.get(`${groupId || sessionId || ''}:${userId}`)
      || nameMap.get(`:${userId}`)
      || fallback
      || String(userId || '未知用户');
  }
  
  function buildEntryId(prefix, entry = {}, index = 0) {
    return [prefix, entry.time || 'unknown', entry.group_id || '', entry.user_id || '', entry.scene || '', entry.model || '', index]
      .join('::');
  }
  
  function buildOverviewPayload() {
    const allConfigs = ConfigControl.get() || {};
    const appConfig = allConfigs.config || {};
    const aiConfig = allConfigs.ai || {};
    const featureToggleBackup = normalizeFeatureToggleBackup(allConfigs.featureToggleBackup || {});
    const usageOverview = getUsageOverviewSync(new Date(), getPricingConfig(allConfigs));
    const imageMonitorUsage = usageOverview?.by_scene?.image_monitor_review || { requests: 0, total_tokens: 0 };
    const pokeImageSummaryUsage = usageOverview?.by_scene?.poke_image_summary || { requests: 0, total_tokens: 0 };
    const usageEntries = safeReadUsageEntries(new Date());
    const imageMonitorEntries = usageEntries.filter(item => isImageMonitorReviewUsage(item));
    const pokeImageSummaryEntries = usageEntries.filter(item => String(item?.scene || '') === 'poke_image_summary');
    const imageMonitorSuccessCount = imageMonitorEntries.filter(item => item?.stage === 'success').length;
    const imageMonitorErrorCount = imageMonitorEntries.filter(item => item?.stage === 'error' || item?.stage === 'empty_response').length;
    const pokeImageSummarySuccessCount = pokeImageSummaryEntries.filter(item => item?.stage === 'success').length;
    const pokeImageSummaryErrorCount = pokeImageSummaryEntries.filter(item => item?.stage === 'error' || item?.stage === 'empty_response').length;
    const totalTokens = Number(usageOverview.total_tokens || 0);
    const imageMonitorTokens = Number(imageMonitorUsage.total_tokens || 0);
    const pokeImageSummaryTokens = Number(pokeImageSummaryUsage.total_tokens || 0);
    const chat = getChatSnapshot();
    const affinity = getAffinitySnapshot();
    const affinityRecords = Object.values(affinity || {});
    const profiles = Array.isArray(chat?.profiles) ? chat.profiles : [];
    const runtimeInfo = getWebConsoleInfo();
  
    return {
      plugin: {
        name: Version.name,
        version: Version.ver,
        author: Version.author,
        description: Version.description,
      },
      runtime: {
        now: new Date().toISOString(),
        node: process.version,
        platform: process.platform,
      },
      webConsoleRuntime: {
        configuredEnabled: appConfig.webConsole !== false,
        running: !!runtimeInfo,
        host: runtimeInfo?.host || null,
        port: runtimeInfo?.port || null,
        url: runtimeInfo?.url || null,
      },
      featureToggleBackup: {
        savedAt: featureToggleBackup.savedAt || '',
        hasBackup: Object.keys(featureToggleBackup.config || {}).length > 0,
      },
      features: {
        ai: appConfig.ai !== false,
        music: appConfig.music !== false,
        rss: appConfig.rss !== false,
        auth: appConfig.auth !== false,
        welcome: appConfig.welcome !== false,
        groupManagement: appConfig.groupManagement !== false,
        groupTitle: appConfig.groupTitle !== false,
        poke: appConfig.poke !== false,
        status: appConfig.status !== false,
        webConsole: appConfig.webConsole !== false,
        affinity: aiConfig?.affinity?.enabled !== false,
        userProfile: aiConfig?.userProfile?.enabled !== false,
        tts: allConfigs?.coreConfig?.tools?.tts?.enabled !== false,
      },
      counts: {
        sessions: Array.isArray(chat?.sessions) ? chat.sessions.length : 0,
        messages: Array.isArray(chat?.messages) ? chat.messages.length : 0,
        topics: Array.isArray(chat?.topics) ? chat.topics.length : 0,
        expressions: Array.isArray(chat?.expressions) ? chat.expressions.length : 0,
        profiles: profiles.length,
        affinityUsers: affinityRecords.length,
      },
      usage: {
        requestCount: usageOverview.request_count,
        successCount: usageOverview.success_count,
        errorCount: usageOverview.error_count,
        totalTokens: usageOverview.total_tokens,
        totalCost: usageOverview.total_cost,
        currencySymbol: getPricingConfig(allConfigs).currencySymbol || '$',
        byScene: usageOverview.by_scene || {},
        imageMonitor: {
          requestCount: Number(imageMonitorUsage.requests || 0),
          successCount: imageMonitorSuccessCount,
          errorCount: imageMonitorErrorCount,
          totalTokens: imageMonitorTokens,
          tokenRatio: totalTokens > 0 ? imageMonitorTokens / totalTokens : 0,
          averageTokens: Number(imageMonitorUsage.requests || 0) > 0 ? Math.round(imageMonitorTokens / Number(imageMonitorUsage.requests || 0)) : 0,
        },
        pokeImageSummary: {
          requestCount: Number(pokeImageSummaryUsage.requests || 0),
          successCount: pokeImageSummarySuccessCount,
          errorCount: pokeImageSummaryErrorCount,
          totalTokens: pokeImageSummaryTokens,
          tokenRatio: totalTokens > 0 ? pokeImageSummaryTokens / totalTokens : 0,
          averageTokens: Number(pokeImageSummaryUsage.requests || 0) > 0 ? Math.round(pokeImageSummaryTokens / Number(pokeImageSummaryUsage.requests || 0)) : 0,
        },
      },
    };
  }
  
  function getFileStatSafe(filePath) {
    try {
      return fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    } catch {
      return null;
    }
  }
  
  function readJsonFileSafe(filePath, fallback = null) {
    try {
      if (!fs.existsSync(filePath)) {
        return fallback;
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }
  
  function getResolvedPathSafe(targetPath = '') {
    try {
      if (!targetPath) {
        return '';
      }
      if (typeof fs.realpathSync.native === 'function') {
        return fs.realpathSync.native(targetPath);
      }
      return fs.realpathSync(targetPath);
    } catch {
      return path.resolve(targetPath || '');
    }
  }
  
  function resolvePluginsDirectory() {
    const candidates = [
      path.join(process.cwd(), 'plugins'),
      path.join(Path.yunzai, 'plugins'),
    ];
  
    for (const candidate of candidates) {
      try {
        if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch {
        // Ignore inaccessible candidate directories and continue probing.
      }
    }
  
    return '';
  }
  
  function toRelativeConsolePath(targetPath = '') {
    if (!targetPath) {
      return '';
    }
    return path.relative(process.cwd(), targetPath).replace(/\\/g, '/');
  }
  
  function isSubPath(parentPath = '', targetPath = '') {
    if (!parentPath || !targetPath) {
      return false;
    }
    const relativePath = path.relative(parentPath, targetPath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  }

  function buildHealthPayload() {
    const allConfigs = ConfigControl.get() || {};
    const aiConfig = allConfigs.ai || {};
    const coreConfig = allConfigs.coreConfig || {};
    const dependencyReport = buildDependencyReport();
    const usageOverview = getUsageOverviewSync(new Date(), getPricingConfig(allConfigs));
    const chat = getChatSnapshot();
    const issues = [];
    const now = Date.now();
  
    const pushIssue = (level, title, detail) => {
      issues.push({ level, title, detail });
    };
  
    const baseApi = String(aiConfig.baseApi || '').trim();
    const modelType = String(aiConfig.modelType || aiConfig.workingModel || '').trim();
    const apiKey = String(aiConfig.apiKey || '').trim();
    if (!baseApi || !modelType || !apiKey || apiKey === 'your-api-key' || apiKey === 'your api key') {
      pushIssue('error', 'AI 配置不完整', '请检查主对话接口地址、模型名称和 API Key。');
    }
  
    const searchApiUrl = String(
      coreConfig?.tools?.search?.apiUrl || coreConfig?.tools?.search?.baseUrl || ''
    ).trim();
    if (coreConfig?.tools?.search?.enabled && !searchApiUrl) {
      pushIssue('warn', '搜索工具缺少接口地址', '搜索工具已开启，但 apiUrl/baseUrl 为空。');
    }
  
    const ttsApiUrl = String(
      coreConfig?.tools?.tts?.apiUrl || coreConfig?.tools?.tts?.baseUrl || ''
    ).trim();
    if (coreConfig?.tools?.tts?.enabled && !ttsApiUrl) {
      pushIssue('warn', '语音合成缺少接口地址', '语音合成已开启，但 apiUrl/baseUrl 为空。');
    }
  
    const requestCount = Number(usageOverview.request_count || 0);
    const errorCount = Number(usageOverview.error_count || 0);
    const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
    if (requestCount >= 5 && errorRate >= 0.3) {
      pushIssue('error', 'AI 请求失败率偏高', `近期请求 ${requestCount} 次，失败 ${errorCount} 次。`);
    } else if (errorCount > 0) {
      pushIssue('warn', 'AI 最近存在失败请求', `近期失败请求 ${errorCount} 次。`);
    }
  
    const usageStat = getFileStatSafe(usageLogFile);
    if (!usageStat) {
      pushIssue('warn', '未找到用量日志', '当前还没有发现用量日志文件。');
    } else if (now - usageStat.mtimeMs > 30 * 60 * 1000) {
      pushIssue('warn', '用量日志长时间未更新', '用量日志已超过 30 分钟没有更新。');
    }
  
    const affinityStat = getFileStatSafe(affinityLogFile);
    if (affinityStat && now - affinityStat.mtimeMs > 24 * 60 * 60 * 1000) {
      pushIssue('warn', '好感度日志长时间未更新', '好感度日志已超过 24 小时没有更新。');
    }
  
    if (!dependencyReport.summary.manifestExists) {
      pushIssue('error', '缺少 package.json', '依赖巡检和依赖安装功能当前不可用。');
    }
  
    if (dependencyReport.summary.runtimeMissingCount > 0) {
      const names = dependencyReport.problemItems
        .filter(item => item.group === 'runtime' && item.status === 'missing')
        .map(item => item.name)
        .slice(0, 6);
      pushIssue(
        'error',
        '运行依赖缺失',
        `缺少 ${dependencyReport.summary.runtimeMissingCount} 个运行依赖${names.length ? `（${names.join('、')}）` : ''}。`
      );
    } else if (dependencyReport.summary.runtimeMismatchCount > 0) {
      const names = dependencyReport.problemItems
        .filter(item => item.group === 'runtime' && item.status === 'version_mismatch')
        .map(item => item.name)
        .slice(0, 6);
      pushIssue(
        'warn',
        '运行依赖版本与锁文件不一致',
        `有 ${dependencyReport.summary.runtimeMismatchCount} 个运行依赖版本不一致${names.length ? `（${names.join('、')}）` : ''}。`
      );
    }
  
    if (dependencyReport.summary.devMissingCount > 0) {
      pushIssue('warn', '开发依赖缺失', `缺少 ${dependencyReport.summary.devMissingCount} 个开发依赖。`);
    }
  
    const messageCount = Array.isArray(chat?.messages) ? chat.messages.length : 0;
    const profileCount = Array.isArray(chat?.profiles) ? chat.profiles.length : 0;
    const sessionCount = Array.isArray(chat?.sessions) ? chat.sessions.length : 0;
    if (messageCount > 5000) {
      pushIssue('warn', '聊天历史数据较大', `当前消息记录 ${messageCount} 条。`);
    }
    if (sessionCount > 300) {
      pushIssue('warn', '会话数量较多', `当前会话 ${sessionCount} 个。`);
    }
    if (messageCount > 0 && profileCount === 0) {
      pushIssue('warn', '缺少用户画像数据', '已经存在聊天消息，但没有发现用户画像数据。');
    }
  
    const webConsoleConfig = getWebConsoleConfig();
    const normalizedWebConsoleHost = String(webConsoleConfig.host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    const isPublicHost = !['127.0.0.1', 'localhost', '::1'].includes(normalizedWebConsoleHost);
    if (isPublicHost && !webConsoleConfig.authToken) {
      pushIssue('error', '公网控制台未配置登录口令', `控制台监听地址 ${webConsoleConfig.host} 可能被外部访问，但当前没有配置登录口令。`);
    }
    if (isPublicHost && webConsoleConfig.readOnly !== true) {
      pushIssue('warn', '公网控制台允许写操作', `控制台监听地址 ${webConsoleConfig.host} 允许修改配置；如果暴露到公网，建议开启只读模式。`);
    }
  
    const summary = {
      status: issues.some(item => item.level === 'error') ? 'error' : issues.length > 0 ? 'warn' : 'healthy',
      issueCount: issues.length,
      errorCount: issues.filter(item => item.level === 'error').length,
      warnCount: issues.filter(item => item.level === 'warn').length,
      checkedAt: new Date().toISOString(),
    };
  
    return {
      summary,
      issues,
      dependencyReport: webConsoleConfig.readOnly ? buildDependencyReportSummaryOnly(dependencyReport) : dependencyReport,
    };
  }

  return {
    getChatSnapshot,
    getAffinitySnapshot,
    buildUserNameMap,
    resolveDisplayName,
    buildEntryId,
    buildOverviewPayload,
    getFileStatSafe,
    readJsonFileSafe,
    getResolvedPathSafe,
    resolvePluginsDirectory,
    toRelativeConsolePath,
    isSubPath,
    buildHealthPayload,
  };
}

