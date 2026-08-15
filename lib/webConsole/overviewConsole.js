import { PUBLIC_REPOSITORY_BRANCH, PUBLIC_REPOSITORY_URL, PUBLIC_REPOSITORY_URL_FALLBACK } from '../system/publicRepository.js';

export function createOverviewConsole(options = {}) {
  const fs = options.fs;
  const path = options.path;
  const Path = options.Path || {};
  const childProcess = options.childProcess || {};
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
  const versionCheckTimeoutMs = Math.max(1000, Number(options.versionCheckTimeoutMs || 8000) || 8000);
  const versionCheckCacheTtlMs = Math.max(1000, Number(options.versionCheckCacheTtlMs || 5 * 60 * 1000) || (5 * 60 * 1000));
  const emptyGitConfig = process.platform === 'win32' ? 'NUL' : '/dev/null';
  let versionCheckCache = null;
  let versionCheckInFlight = null;

  function trimProcessOutput(value = '', maxLength = 4000) {
    const text = String(value || '').trim();
    return text.length <= maxLength ? text : text.slice(text.length - maxLength);
  }

  function runGit(args = []) {
    return new Promise((resolve, reject) => {
      if (typeof childProcess.spawn !== 'function') {
        reject(new Error('当前运行环境不可用 child_process.spawn'));
        return;
      }

      const pluginRoot = Path.root || process.cwd();
      // 防止 git 在插件目录没有 .git 时沿目录链向上找到 Yunzai 主仓的 .git
      const ceilingDir = (() => {
        try {
          return path?.dirname ? path.dirname(pluginRoot) : '';
        } catch {
          return '';
        }
      })();

      const child = childProcess.spawn('git', args, {
        cwd: pluginRoot,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          // 版本检查固定访问公开 HTTPS 仓库，避免全局配置改写成 SSH。
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: emptyGitConfig,
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o ConnectTimeout=5',
          ...(ceilingDir ? { GIT_CEILING_DIRECTORIES: ceilingDir } : {}),
        },
        shell: false,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        const error = new Error(`git ${args.join(' ')} 超时`);
        error.code = 'GIT_TIMEOUT';
        reject(error);
      }, versionCheckTimeoutMs);

      child.stdout?.on('data', chunk => {
        stdout = trimProcessOutput(stdout + String(chunk || ''));
      });
      child.stderr?.on('data', chunk => {
        stderr = trimProcessOutput(stderr + String(chunk || ''));
      });
      child.on('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          status: Number(code || 0),
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    });
  }

  async function readGitOutput(args = [], fallback = '') {
    const result = await runGit(args);
    return result.status === 0 ? (result.stdout.trim() || fallback) : fallback;
  }

  async function readGitOutputRequired(args = []) {
    const result = await runGit(args);
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
    }
    return result.stdout.trim();
  }

  function parseLsRemoteHead(output = '') {
    const [commit = '', ref = ''] = String(output || '').trim().split(/\s+/, 2);
    return {
      commit: commit.trim(),
      ref: ref.trim(),
    };
  }

  /**
   * 校验「插件目录本身」就是某个 git 仓库的顶层。
   * 仅判断 .git 文件夹存在是不够的：git 默认会沿目录链向上找到 Yunzai 主仓，
   * 那样后续 rev-parse / ls-remote 都会变成针对 Yunzai 主仓，结果完全错位。
   */
  async function pluginIsGitRepoTopLevel() {
    try {
      const pluginRoot = Path.root || process.cwd();
      const top = await readGitOutput(['rev-parse', '--show-toplevel'], '');
      if (!top) return false;
      const norm = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      return norm(top) === norm(pluginRoot);
    } catch {
      return false;
    }
  }

  async function fetchReleaseNotes(remoteUrl = '', timeoutMs = 6000) {
    // 根据更新源类型选择对应的 release 接口：Gitee 或 GitHub。
    const giteeMatch = String(remoteUrl).match(/gitee\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i);
    const githubMatch = String(remoteUrl).match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i);
    if (!giteeMatch && !githubMatch) return null;
    if (typeof fetch !== 'function') return null;
    const apiUrl = giteeMatch
      ? `https://gitee.com/api/v5/repos/${giteeMatch[1]}/${giteeMatch[2]}/releases/latest`
      : `https://api.github.com/repos/${githubMatch[1]}/${githubMatch[2]}/releases/latest`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1000, Number(timeoutMs) || 6000));
    try {
      const resp = await fetch(apiUrl, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': `crystelf-plugin/${String(Version.ver || '0.0.0')}`,
          'Accept': 'application/json',
        },
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data || (typeof data === 'object' && data.message && !data.tag_name)) return null;
      return {
        tagName: String(data.tag_name || '').trim(),
        name: String(data.name || '').trim(),
        body: String(data.body || '').trim(),
        htmlUrl: String(data.html_url || '').trim(),
        publishedAt: String(data.published_at || data.created_at || '').trim(),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function readLocalChangelog() {
    try {
      const filePath = path?.join?.(Path.root || '', 'guanwang/site-data.js');
      if (!filePath || !fs?.existsSync?.(filePath)) return [];
      const src = fs.readFileSync(filePath, 'utf8');
      const m = src.match(/changelog\s*:\s*(\[[\s\S]*?\n\s*\])\s*,/);
      if (!m) return [];
      const parsed = new Function(`return ${m[1]};`)();
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function buildVersionCheckPayload(options = {}) {
    const force = options.force === true;
    const now = Date.now();
    if (!force && versionCheckCache && now - Number(versionCheckCache.checkedAtMs || 0) < versionCheckCacheTtlMs) {
      return {
        ...versionCheckCache,
        cached: true,
      };
    }
    if (!force && versionCheckInFlight) {
      return versionCheckInFlight;
    }

    versionCheckInFlight = (async () => {
      const checkedAtMs = Date.now();
      const localVersion = String(Version.ver || '').trim();
      let localCommit = '';
      let branch = '';
      let remoteUrl = '';
      let dirty = false;

      // 预检查：插件目录必须是它自己的 git 仓库顶层。
      // 否则 git 会向上落到 Yunzai 主仓上，导致显示的 commit / 远端 URL 全部来自 Yunzai 主仓。
      if (!(await pluginIsGitRepoTopLevel())) {
        const payload = {
          success: false,
          status: 'not_a_git_repo',
          updateAvailable: false,
          localVersion,
          localCommit: '',
          localCommitShort: '',
          branch: '',
          remoteUrl: '',
          dirty: false,
          error: '插件目录不是独立的 Git 仓库，无法检查更新。请改用 git clone 部署，或下载新版后手动覆盖。',
          checkedAt: new Date(checkedAtMs).toISOString(),
          checkedAtMs,
          cached: false,
        };
        versionCheckCache = payload;
        return payload;
      }

      try {
        localCommit = await readGitOutputRequired(['rev-parse', 'HEAD']);
        branch = await readGitOutput(['branch', '--show-current'], PUBLIC_REPOSITORY_BRANCH);
        dirty = Boolean(await readGitOutput(['status', '--porcelain'], ''));

        // 版本检查必须与群内更新使用同一个公开仓库，不读取本地 origin 配置。
        // 第一源（Gitee）不可用时，自动尝试备用源（GitHub）。
        const repoUrls = [PUBLIC_REPOSITORY_URL];
        if (PUBLIC_REPOSITORY_URL_FALLBACK) {
          repoUrls.push(PUBLIC_REPOSITORY_URL_FALLBACK);
        }
        const remoteBranch = PUBLIC_REPOSITORY_BRANCH;
        let remote = null;
        let lastRemoteError = null;
        for (const url of repoUrls) {
          try {
            const remoteOutput = await readGitOutputRequired(['ls-remote', '--heads', url, remoteBranch]);
            const parsed = parseLsRemoteHead(remoteOutput);
            if (!parsed.commit) {
              throw new Error(`公开仓库分支 ${remoteBranch} 不存在或无法读取`);
            }
            remote = { ...parsed, url };
            break;
          } catch (error) {
            lastRemoteError = error;
          }
        }
        if (!remote) {
          throw lastRemoteError || new Error('所有更新源均不可用，无法检查更新');
        }
        remoteUrl = remote.url;

        const updateAvailable = remote.commit !== localCommit;
        let releaseNotes = null;
        if (updateAvailable) {
          releaseNotes = await fetchReleaseNotes(remote.url, Math.min(versionCheckTimeoutMs, 6000));
        }
        const localChangelog = updateAvailable ? readLocalChangelog().slice(0, 3) : [];
        const payload = {
          success: true,
          status: updateAvailable ? 'update_available' : 'up_to_date',
          updateAvailable,
          localVersion,
          localCommit,
          localCommitShort: localCommit.slice(0, 8),
          remoteCommit: remote.commit,
          remoteCommitShort: remote.commit.slice(0, 8),
          branch: remoteBranch,
          remoteRef: remote.ref || `refs/heads/${remoteBranch}`,
          remoteUrl,
          dirty,
          releaseNotes,
          localChangelog,
          checkedAt: new Date(checkedAtMs).toISOString(),
          checkedAtMs,
          cached: false,
        };
        versionCheckCache = payload;
        return payload;
      } catch (error) {
        const payload = {
          success: false,
          status: 'check_failed',
          updateAvailable: false,
          localVersion,
          localCommit,
          localCommitShort: localCommit.slice(0, 8),
          branch,
          remoteUrl,
          dirty,
          error: String(error?.message || error || '版本检查失败'),
          checkedAt: new Date(checkedAtMs).toISOString(),
          checkedAtMs,
          cached: false,
        };
        versionCheckCache = payload;
        return payload;
      }
    })();

    try {
      return await versionCheckInFlight;
    } finally {
      versionCheckInFlight = null;
    }
  }

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

  function getSecurityLevelWeight(level = '') {
    const value = String(level || '').trim().toLowerCase();
    if (value === 'error') return 3;
    if (value === 'warn' || value === 'warning') return 2;
    if (value === 'success' || value === 'ok' || value === 'healthy') return 0;
    return 1;
  }

  function normalizeSecurityLevel(level = '') {
    const value = String(level || '').trim().toLowerCase();
    if (value === 'error') return 'error';
    if (value === 'warn' || value === 'warning') return 'warn';
    if (value === 'success' || value === 'ok' || value === 'healthy') return 'success';
    return 'neutral';
  }

  function resolveHighestSecurityLevel(items = []) {
    return items.reduce((current, item) => (
      getSecurityLevelWeight(item?.level) > getSecurityLevelWeight(current) ? normalizeSecurityLevel(item?.level) : current
    ), 'success');
  }

  function normalizeConsoleListenHost(value = '') {
    return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  }

  function isLocalConsoleListenHost(value = '') {
    const host = normalizeConsoleListenHost(value);
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  }

  function isWildcardConsoleListenHost(value = '') {
    const host = normalizeConsoleListenHost(value);
    return host === '0.0.0.0' || host === '::';
  }

  function analyzeWebConsoleTokenStrength(authToken = '', options = {}) {
    const token = String(authToken || '').trim();
    const generated = options.generated === true;
    if (!token) {
      return {
        level: 'error',
        label: '未配置',
        detail: '当前没有登录口令，只适合本机初始化；不要在这个状态下开放外部访问。',
        generated,
        score: 0,
      };
    }

    const lower = token.toLowerCase();
    const commonTokens = new Set([
      'admin',
      'admin123',
      '123456',
      '12345678',
      'password',
      'qwerty',
      'test',
      'root',
      'crystelf',
      'crystelf123456',
      'moowan',
      'console',
    ]);
    const characterGroups = [
      /[a-z]/.test(token),
      /[A-Z]/.test(token),
      /\d/.test(token),
      /[^a-zA-Z0-9]/.test(token),
    ].filter(Boolean).length;
    const repeated = /^(.{1,4})\1+$/.test(token);
    const sequential = /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv)/i.test(token);
    let score = 0;
    if (token.length >= 10) score += 1;
    if (token.length >= 16) score += 1;
    if (token.length >= 24) score += 1;
    if (characterGroups >= 2) score += 1;
    if (characterGroups >= 3) score += 1;
    if (generated) score += 1;
    if (commonTokens.has(lower) || repeated || sequential) score -= 2;

    if (commonTokens.has(lower)) {
      return {
        level: 'error',
        label: '默认/常见口令',
        detail: '当前口令像默认口令或常见弱口令。公网监听时请立刻更换为至少 16 位、包含大小写字母和数字的随机口令。',
        generated,
        score,
      };
    }
    if (token.length < 10 || repeated) {
      return {
        level: 'error',
        label: '口令偏弱',
        detail: '当前口令长度或复杂度不足。建议改成至少 16 位的随机口令，再开放给外部设备访问。',
        generated,
        score,
      };
    }
    if (token.length < 16 || characterGroups < 2 || sequential) {
      return {
        level: 'warn',
        label: '建议加强',
        detail: '当前口令已配置，但强度一般。公网访问建议使用更长的随机口令，并避免连续数字、简单英文或固定短语。',
        generated,
        score,
      };
    }
    return {
      level: 'success',
      label: generated ? '随机口令' : '强度较好',
      detail: generated
        ? '当前口令由控制台自动生成，强度适合日常使用；仍建议不要把控制台暴露给不可信网络。'
        : '当前口令长度和复杂度看起来可以；仍建议配合防火墙或反向代理限制访问来源。',
      generated,
      score,
    };
  }

  function buildWebConsoleSecurityPayload(webConsoleConfig = {}, runtimeInfo = null) {
    const normalizedWebConsoleHost = normalizeConsoleListenHost(webConsoleConfig.host || '');
    const isPublicHost = !isLocalConsoleListenHost(normalizedWebConsoleHost);
    const wildcardHost = isWildcardConsoleListenHost(normalizedWebConsoleHost);
    const webConsolePort = webConsoleConfig.port || runtimeInfo?.port || null;
    const webConsoleUrlHost = wildcardHost
      ? '127.0.0.1'
      : normalizedWebConsoleHost.includes(':')
        ? `[${normalizedWebConsoleHost}]`
        : (webConsoleConfig.host || '127.0.0.1');
    const webConsoleAccessUrl = runtimeInfo?.url || (webConsolePort ? `http://${webConsoleUrlHost}:${webConsolePort}/` : '');
    const loginConfigured = Boolean(webConsoleConfig.authToken);
    const readOnly = webConsoleConfig.readOnly === true;
    const exposeLogs = webConsoleConfig.exposeLogs !== false;
    const tokenStrength = analyzeWebConsoleTokenStrength(webConsoleConfig.authToken, {
      generated: runtimeInfo?.authTokenGenerated === true,
    });
    const risks = [];
    const addRisk = (level, title, detail, action = '') => {
      risks.push({
        level: normalizeSecurityLevel(level),
        title,
        detail,
        action,
      });
    };

    if (isPublicHost) {
      addRisk(
        'warn',
        wildcardHost ? '正在监听所有网卡' : '正在监听外部地址',
        wildcardHost
          ? '0.0.0.0 / :: 会接受来自外部网卡的连接；如果服务器有公网 IP，控制台可能被外部设备访问。'
          : `监听地址 ${webConsoleConfig.host || '-'} 不是本机地址，请确认只有可信网络可以访问。`,
        '在防火墙或反向代理中限制来源 IP。',
      );
    }
    if (!loginConfigured) {
      addRisk(
        isPublicHost ? 'error' : 'warn',
        '还没有登录口令',
        '没有登录口令时，控制台只适合本机初始化；不要开放给外部设备。',
        '进入控制台设置，先设置强口令。',
      );
    } else if (tokenStrength.level === 'error') {
      addRisk(
        isPublicHost ? 'error' : 'warn',
        '登录口令偏弱',
        tokenStrength.detail,
        '更换为至少 16 位随机口令。',
      );
    } else if (tokenStrength.level === 'warn') {
      addRisk(
        'warn',
        '登录口令建议加强',
        tokenStrength.detail,
        '更换为更长的随机口令。',
      );
    }
    if (isPublicHost && !readOnly) {
      addRisk(
        'warn',
        '外部访问时仍允许写操作',
        '当前控制台可以保存配置、安装依赖、清理数据；如果必须公网访问，建议先开启只读或限制访问来源。',
        '开启只读模式，或只允许可信来源访问。',
      );
    }
    if (isPublicHost && exposeLogs) {
      addRisk(
        'warn',
        '日志接口对已登录用户可读',
        '公网访问下，日志可能包含路径、错误堆栈或运行信息。确认只让可信人员登录，或关闭日志暴露。',
        '在控制台设置里关闭日志查看能力。',
      );
    }

    const riskLevel = resolveHighestSecurityLevel(risks);
    const riskLabel = riskLevel === 'error' ? '高风险' : riskLevel === 'warn' ? '需要注意' : '看起来安全';
    const riskTitle = riskLevel === 'error'
      ? '公网访问前需要先处理安全项'
      : riskLevel === 'warn'
        ? '当前可以使用，但建议收紧访问策略'
        : '当前访问策略比较稳妥';
    const riskDescription = riskLevel === 'error'
      ? '先处理登录口令和访问来源，再把控制台暴露给外部设备。'
      : riskLevel === 'warn'
        ? '控制台具备登录保护，但仍有可收紧的地方；公网环境建议配合防火墙、反向代理或只读模式。'
        : '当前没有发现明显公网暴露风险；继续保持强口令和受控访问来源。';
    const riskItems = risks.map(item => `${item.title}：${item.detail}`);

    return {
      host: webConsoleConfig.host || '',
      port: webConsolePort,
      accessUrl: webConsoleAccessUrl,
      currentUrl: runtimeInfo?.url || '',
      publicHost: isPublicHost,
      wildcardHost,
      accessScopeLabel: isPublicHost ? (wildcardHost ? '外部设备可能可访问' : '外部地址监听') : '仅本机访问',
      loginConfigured,
      tokenStrength,
      readOnly,
      exposeLogs,
      writeOperationsAllowed: !readOnly,
      riskLevel,
      riskLabel,
      riskTitle,
      riskDescription,
      riskItems,
      riskDetails: risks,
      recommendations: risks,
      protections: {
        loginRequired: loginConfigured,
        readOnly,
        logAccessLimited: exposeLogs === false,
        sessionCookieSameSite: 'Strict',
        loginFailureLock: true,
      },
      publicAccessHint: isPublicHost
        ? '控制台正在监听外部网卡。请确认口令足够强，并在防火墙或反向代理中只放行可信来源。'
        : '当前仅本机监听，外部设备通常无法直接访问。需要远程访问时，请先设置强口令并限制来源。',
    };
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
    const webConsoleConfig = getWebConsoleConfig();
    const webConsoleSecurity = buildWebConsoleSecurityPayload(webConsoleConfig, runtimeInfo);
  
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
        startupSelfCheck: runtimeInfo?.startupSelfCheck || null,
      },
      webConsoleSecurity,
      staticAssets: {
        htmlResourceVersioning: true,
        conditionalCache: true,
        etag: true,
        lastModified: true,
        policy: 'HTML 自动注入 CSS/JS 版本号，静态资源使用 ETag 与 Last-Modified 复用缓存。',
      },
      featureToggleBackup: {
        savedAt: featureToggleBackup.savedAt || '',
        hasBackup: Object.keys(featureToggleBackup.config || {}).length > 0,
      },
      configMigration: typeof ConfigControl.getMigrationReport === 'function'
        ? ConfigControl.getMigrationReport()
        : null,
      features: {
        ai: appConfig.ai !== false,
        privateAi: appConfig.privateAi !== false,
        privateAiImage: appConfig.privateAiImage !== false,
        privateAiVoice: appConfig.privateAiVoice !== false,
        privateAiMeme: appConfig.privateAiMeme !== false,
        privateAiSkills: appConfig.privateAiSkills !== false,
        privateAiSafety: appConfig.privateAiSafety?.enabled !== false,
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
    const rootParentDir = path.dirname(Path.root);
    const rootSiblingPluginsDir = path.join(rootParentDir, 'plugins');
    const candidates = [
      path.join(process.cwd(), 'plugins'),
      path.basename(rootParentDir).toLowerCase() === 'plugins' ? rootParentDir : '',
      rootSiblingPluginsDir,
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
      pushIssue('error', 'AI 对话还没有配置完整', '请补全主对话接口地址、模型名称和 API Key。');
    }
  
    const searchApiUrl = String(
      coreConfig?.tools?.search?.apiUrl || coreConfig?.tools?.search?.baseUrl || ''
    ).trim();
    if (coreConfig?.tools?.search?.enabled && !searchApiUrl) {
      pushIssue('warn', '搜索功能还没有填写接口地址', '搜索功能已经开启，但还没有填写可用的接口地址。');
    }
  
    const ttsApiUrl = String(
      coreConfig?.tools?.tts?.apiUrl || coreConfig?.tools?.tts?.baseUrl || ''
    ).trim();
    if (coreConfig?.tools?.tts?.enabled && !ttsApiUrl) {
      pushIssue('warn', '语音合成还没有填写接口地址', '语音合成已经开启，但还没有填写可用的接口地址。');
    }
  
    const requestCount = Number(usageOverview.request_count || 0);
    const errorCount = Number(usageOverview.error_count || 0);
    const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
    if (requestCount >= 5 && errorRate >= 0.3) {
      pushIssue('error', '最近 AI 请求失败比较多', `最近共请求 ${requestCount} 次，其中 ${errorCount} 次失败。`);
    } else if (errorCount > 0) {
      pushIssue('warn', '最近有 AI 请求失败', `最近有 ${errorCount} 次请求失败。`);
    }
  
    const usageStat = getFileStatSafe(usageLogFile);
    if (!usageStat) {
      pushIssue('warn', '还没有生成用量日志', '控制台暂时没有读到用量日志，产生请求后会自动生成。');
    } else if (now - usageStat.mtimeMs > 30 * 60 * 1000) {
      pushIssue('warn', '用量日志一段时间没有更新', '用量日志已经超过 30 分钟没有新记录，可以确认机器人是否还在正常调用 AI。');
    }
  
    const affinityStat = getFileStatSafe(affinityLogFile);
    if (affinityStat && now - affinityStat.mtimeMs > 24 * 60 * 60 * 1000) {
      pushIssue('warn', '好感度日志一段时间没有更新', '好感度日志已经超过 24 小时没有新记录，可以确认相关功能是否仍在使用。');
    }
  
    if (!dependencyReport.summary.manifestExists) {
      pushIssue('error', '没有找到依赖清单', '缺少依赖清单，暂时不能检查或一键修复依赖。');
    }
  
    if (dependencyReport.summary.runtimeMissingCount > 0) {
      const names = dependencyReport.problemItems
        .filter(item => item.group === 'runtime' && item.status === 'missing')
        .map(item => item.name)
        .slice(0, 6);
      pushIssue(
        'error',
        '有运行依赖没有安装',
        `有 ${dependencyReport.summary.runtimeMissingCount} 个运行依赖没有安装${names.length ? `（${names.join('、')}）` : ''}。`
      );
    } else if (dependencyReport.summary.runtimeMismatchCount > 0) {
      const names = dependencyReport.problemItems
        .filter(item => item.group === 'runtime' && item.status === 'version_mismatch')
        .map(item => item.name)
        .slice(0, 6);
      pushIssue(
        'warn',
        '有运行依赖版本和锁文件不一致',
        `有 ${dependencyReport.summary.runtimeMismatchCount} 个运行依赖版本需要确认${names.length ? `（${names.join('、')}）` : ''}。`
      );
    }
  
    if (dependencyReport.summary.devMissingCount > 0) {
      pushIssue('warn', '有开发依赖没有安装', `有 ${dependencyReport.summary.devMissingCount} 个开发依赖没有安装。`);
    }
  
    const messageCount = Array.isArray(chat?.messages) ? chat.messages.length : 0;
    const profileCount = Array.isArray(chat?.profiles) ? chat.profiles.length : 0;
    const sessionCount = Array.isArray(chat?.sessions) ? chat.sessions.length : 0;
    if (messageCount > 5000) {
      pushIssue('warn', '聊天记录占用较多', `当前已经保存 ${messageCount} 条消息记录。`);
    }
    if (sessionCount > 300) {
      pushIssue('warn', '会话数量比较多', `当前已经保存 ${sessionCount} 个会话。`);
    }
    if (messageCount > 0 && profileCount === 0) {
      pushIssue('warn', '还没有生成用户画像数据', '已经有聊天消息，但还没有生成对应的用户画像数据。');
    }
  
    const webConsoleConfig = getWebConsoleConfig();
    const normalizedWebConsoleHost = String(webConsoleConfig.host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    const isPublicHost = !['127.0.0.1', 'localhost', '::1'].includes(normalizedWebConsoleHost);
    if (isPublicHost && !webConsoleConfig.authToken) {
      pushIssue('error', '控制台还没有设置登录口令', `控制台监听地址 ${webConsoleConfig.host} 可能被外部设备访问，但还没有设置登录口令。`);
    }
    if (isPublicHost && webConsoleConfig.readOnly !== true) {
      pushIssue('warn', '外部设备可以修改控制台配置', `控制台监听地址 ${webConsoleConfig.host} 允许保存配置；如果需要开放给外部设备，建议开启只读模式。`);
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
    buildVersionCheckPayload,
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
