export function createStartupSelfCheck(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const rootDir = String(options.rootDir || process.cwd());
  const configDir = String(options.configDir || '');
  const defaultConfigDir = String(options.defaultConfigDir || '');
  const publicDir = String(options.publicDir || '');
  const packageJsonFile = String(options.packageJsonFile || '');
  const packageLockFile = String(options.packageLockFile || '');
  const buildDependencyReport = typeof options.buildDependencyReport === 'function'
    ? options.buildDependencyReport
    : (() => ({ summary: {}, problemItems: [] }));

  function trimDetail(value = '', maxLength = 240) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function normalizePathLabel(targetPath = '') {
    const raw = String(targetPath || '').trim();
    if (!raw) {
      return '';
    }
    try {
      const relative = path.relative(rootDir, raw).replace(/\\/g, '/');
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return relative || '.';
      }
    } catch {
      // Fall through to absolute path display.
    }
    return raw;
  }

  function createCheck(key, label, status = 'ok', detail = '', extra = {}) {
    return {
      key,
      label,
      status: status === 'error' ? 'error' : status === 'warn' ? 'warn' : 'ok',
      detail: trimDetail(detail),
      ...extra,
    };
  }

  function getAccessStatus(targetPath = '', mode = fs.constants.R_OK) {
    if (!targetPath) {
      return { ok: false, reason: '路径为空' };
    }
    try {
      fs.accessSync(targetPath, mode);
      return { ok: true, reason: '' };
    } catch (error) {
      return { ok: false, reason: String(error?.message || '不可访问') };
    }
  }

  function listJsonFilesSafe(dirPath = '') {
    if (!dirPath) {
      return [];
    }
    try {
      return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  function collectInvalidJsonFiles(dirPath = '', files = []) {
    const invalid = [];
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        invalid.push(`${file}: ${String(error?.message || 'JSON 解析失败')}`);
      }
    }
    return invalid;
  }

  function isPublicHost(value = '') {
    const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return !['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1'].includes(normalized);
  }

  function buildRuntimeChecks(appConfig = {}, info = {}, tokenState = {}) {
    const checks = [];
    checks.push(createCheck(
      'runtime.node',
      '运行环境',
      'ok',
      `${process.version} / ${process.platform}`,
      { value: { node: process.version, platform: process.platform } },
    ));

    const authToken = String(appConfig.authToken || '').trim();
    checks.push(createCheck(
      'webConsole.authToken',
      '控制台口令',
      authToken ? 'ok' : 'error',
      authToken
        ? tokenState.generated === true
          ? '已自动生成并保存，启动日志已输出口令'
          : '已配置'
        : '未配置，控制台拒绝启动或无法登录',
      { generated: tokenState.generated === true },
    ));

    const host = String(info.host || appConfig.host || '').trim();
    const readOnly = appConfig.readOnly === true;
    const publicHost = isPublicHost(host);
    checks.push(createCheck(
      'webConsole.listenHost',
      '监听地址',
      publicHost ? 'warn' : 'ok',
      publicHost
        ? readOnly
          ? `${host} 正在监听外部网卡，当前为只读模式，仍建议限制访问来源`
          : `${host} 正在监听外部网卡且允许写操作，请确认强口令、防火墙或反向代理访问限制`
        : `${host || '127.0.0.1'} 仅本机访问`,
      { host, publicHost, readOnly },
    ));

    const preferredPort = Number(appConfig.port || 0);
    const actualPort = Number(info.port || 0);
    checks.push(createCheck(
      'webConsole.port',
      '监听端口',
      actualPort && preferredPort && actualPort !== preferredPort ? 'warn' : actualPort ? 'ok' : 'error',
      actualPort
        ? actualPort !== preferredPort
          ? `首选端口 ${preferredPort} 不可用，已监听 ${actualPort}`
          : `已监听 ${actualPort}${appConfig.portAutoIncrement ? '，端口冲突时允许自动递增' : '，固定端口模式'}`
        : '未取得实际监听端口',
      { preferredPort, actualPort, portAutoIncrement: appConfig.portAutoIncrement === true },
    ));

    const publicDirAccess = getAccessStatus(publicDir, fs.constants.R_OK);
    checks.push(createCheck(
      'webConsole.publicDir',
      '静态资源目录',
      publicDirAccess.ok ? 'ok' : 'error',
      publicDirAccess.ok
        ? `可读取：${normalizePathLabel(publicDir)}`
        : `不可读取：${normalizePathLabel(publicDir)}，${publicDirAccess.reason}`,
    ));

    return checks;
  }

  function buildConfigFileChecks() {
    const checks = [];
    const configAccess = getAccessStatus(configDir, fs.constants.R_OK | fs.constants.W_OK);
    const defaultAccess = getAccessStatus(defaultConfigDir, fs.constants.R_OK);
    const runtimeFiles = listJsonFilesSafe(configDir);
    const defaultFiles = listJsonFilesSafe(defaultConfigDir);
    const invalidRuntimeFiles = collectInvalidJsonFiles(configDir, runtimeFiles);
    const invalidDefaultFiles = collectInvalidJsonFiles(defaultConfigDir, defaultFiles);
    const missingRuntimeFiles = defaultFiles.filter(file => !runtimeFiles.includes(file));

    checks.push(createCheck(
      'config.runtimeDir',
      '运行配置目录',
      configAccess.ok ? 'ok' : 'error',
      configAccess.ok
        ? `可读写：${normalizePathLabel(configDir)}`
        : `不可读写：${normalizePathLabel(configDir)}，${configAccess.reason}`,
    ));

    checks.push(createCheck(
      'config.defaultDir',
      '默认配置目录',
      defaultAccess.ok ? 'ok' : 'warn',
      defaultAccess.ok
        ? `可读取：${normalizePathLabel(defaultConfigDir)}`
        : `不可读取：${normalizePathLabel(defaultConfigDir)}，缺失配置将无法自动补齐`,
    ));

    const invalidFiles = [...invalidRuntimeFiles, ...invalidDefaultFiles];
    checks.push(createCheck(
      'config.jsonIntegrity',
      '配置 JSON 完整性',
      invalidFiles.length > 0 ? 'error' : 'ok',
      invalidFiles.length > 0
        ? invalidFiles.slice(0, 5).join('；')
        : `运行配置 ${runtimeFiles.length} 个，默认配置 ${defaultFiles.length} 个均可解析`,
      { invalidCount: invalidFiles.length },
    ));

    checks.push(createCheck(
      'config.coverage',
      '配置文件覆盖',
      missingRuntimeFiles.length > 0 ? 'warn' : 'ok',
      missingRuntimeFiles.length > 0
        ? `运行配置缺少默认文件：${missingRuntimeFiles.slice(0, 8).join('、')}`
        : '运行配置文件已覆盖默认配置模板',
      { missingRuntimeFiles },
    ));

    return {
      checks,
      summary: {
        configDir: normalizePathLabel(configDir),
        defaultConfigDir: normalizePathLabel(defaultConfigDir),
        runtimeFileCount: runtimeFiles.length,
        defaultFileCount: defaultFiles.length,
        invalidFileCount: invalidFiles.length,
        missingRuntimeFileCount: missingRuntimeFiles.length,
      },
    };
  }

  function buildDependencySelfCheck() {
    try {
      const report = buildDependencyReport({ includeOtherPlugins: false });
      const summary = report?.summary || {};
      const problemItems = Array.isArray(report?.problemItems) ? report.problemItems : [];
      const missingRuntimeNames = problemItems
        .filter(item => (item.group || item.dependencyType) === 'runtime' && item.status === 'missing')
        .map(item => item.name)
        .slice(0, 6);
      const mismatchRuntimeNames = problemItems
        .filter(item => (item.group || item.dependencyType) === 'runtime' && item.status === 'version_mismatch')
        .map(item => item.name)
        .slice(0, 6);

      const checks = [
        createCheck(
          'dependency.manifest',
          '依赖清单',
          summary.manifestExists ? 'ok' : 'error',
          summary.manifestExists
            ? `已读取：${normalizePathLabel(packageJsonFile)}`
            : `缺少 package.json：${normalizePathLabel(packageJsonFile)}`,
        ),
        createCheck(
          'dependency.lockfile',
          '依赖锁文件',
          summary.lockfileExists ? 'ok' : 'warn',
          summary.lockfileExists
            ? `已读取：${normalizePathLabel(packageLockFile)}`
            : `未找到 package-lock.json：${normalizePathLabel(packageLockFile)}`,
        ),
        createCheck(
          'dependency.runtime',
          '运行依赖',
          Number(summary.runtimeMissingCount || 0) > 0
            ? 'error'
            : Number(summary.runtimeMismatchCount || 0) > 0
              ? 'warn'
              : 'ok',
          Number(summary.runtimeMissingCount || 0) > 0
            ? `缺少 ${summary.runtimeMissingCount} 个运行依赖${missingRuntimeNames.length ? `：${missingRuntimeNames.join('、')}` : ''}`
            : Number(summary.runtimeMismatchCount || 0) > 0
              ? `${summary.runtimeMismatchCount} 个运行依赖与锁文件不一致${mismatchRuntimeNames.length ? `：${mismatchRuntimeNames.join('、')}` : ''}`
              : `运行依赖正常：${summary.runtimeInstalledCount || 0}/${summary.runtimeCount || 0}`,
        ),
        createCheck(
          'dependency.dev',
          '开发依赖',
          Number(summary.devMissingCount || 0) > 0 || Number(summary.devMismatchCount || 0) > 0 ? 'warn' : 'ok',
          Number(summary.devMissingCount || 0) > 0 || Number(summary.devMismatchCount || 0) > 0
            ? `缺失 ${summary.devMissingCount || 0} 个，版本不一致 ${summary.devMismatchCount || 0} 个`
            : `开发依赖正常：${summary.devInstalledCount || 0}/${summary.devCount || 0}`,
        ),
      ];

      return {
        checks,
        summary: {
          status: summary.status || 'unknown',
          totalCount: Number(summary.totalCount || 0),
          problemCount: Number(summary.problemCount || 0),
          runtimeMissingCount: Number(summary.runtimeMissingCount || 0),
          runtimeMismatchCount: Number(summary.runtimeMismatchCount || 0),
          devMissingCount: Number(summary.devMissingCount || 0),
          devMismatchCount: Number(summary.devMismatchCount || 0),
        },
      };
    } catch (error) {
      return {
        checks: [
          createCheck('dependency.report', '依赖巡检', 'warn', `依赖巡检失败：${String(error?.message || error)}`),
        ],
        summary: {
          status: 'check_failed',
          totalCount: 0,
          problemCount: 0,
        },
      };
    }
  }

  function buildSummary(checks = []) {
    const errorCount = checks.filter(item => item.status === 'error').length;
    const warnCount = checks.filter(item => item.status === 'warn').length;
    return {
      status: errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'healthy',
      checkedAt: new Date().toISOString(),
      checkCount: checks.length,
      errorCount,
      warnCount,
      okCount: checks.filter(item => item.status === 'ok').length,
    };
  }

  function buildStartupSelfCheckPayload(context = {}) {
    const configResult = buildConfigFileChecks();
    const dependencyResult = buildDependencySelfCheck();
    const checks = [
      ...buildRuntimeChecks(context.appConfig || {}, context.info || {}, context.tokenState || {}),
      ...configResult.checks,
      ...dependencyResult.checks,
    ];

    return {
      success: true,
      summary: buildSummary(checks),
      checks,
      configFiles: configResult.summary,
      dependencies: dependencyResult.summary,
    };
  }

  function formatStartupSelfCheckLines(payload = {}) {
    const summary = payload.summary || {};
    const checks = Array.isArray(payload.checks) ? payload.checks : [];
    const lines = [
      `[webConsole] Startup self-check: ${summary.status || 'unknown'} | checks=${summary.checkCount || checks.length}, errors=${summary.errorCount || 0}, warnings=${summary.warnCount || 0}`,
    ];

    for (const item of checks) {
      const marker = item.status === 'error' ? 'ERROR' : item.status === 'warn' ? 'WARN' : 'OK';
      lines.push(`[webConsole]   ${marker} ${item.label}: ${item.detail || '-'}`);
    }

    return lines;
  }

  return {
    buildStartupSelfCheckPayload,
    formatStartupSelfCheckLines,
  };
}
