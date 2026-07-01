import { getWebConsoleDisplayUrl } from './webConsoleConfig.js';

export function maskLoginTokenForLog(token = '') {
  const value = String(token || '').trim();
  if (!value) {
    return '(empty)';
  }
  const crystelfPrefix = 'crystelf-';
  if (value.startsWith(crystelfPrefix)) {
    const rest = value.slice(crystelfPrefix.length);
    if (rest.length <= 4) {
      return `${crystelfPrefix}****`;
    }
    return `${crystelfPrefix}${rest.slice(0, 4)}****`;
  }
  if (value.length <= 6) {
    return `****(len=${value.length})`;
  }
  return `${value.slice(0, 2)}****(len=${value.length})`;
}

export function createWebConsoleRuntime(options = {}) {
  const http = options.http;
  const fs = options.fs;
  const publicDir = String(options.publicDir || '');
  const logger = options.logger || { info: () => {} };
  const getWebConsoleConfig = typeof options.getWebConsoleConfig === 'function'
    ? options.getWebConsoleConfig
    : (() => ({ enabled: false }));
  const createHandler = typeof options.createHandler === 'function'
    ? options.createHandler
    : (() => ((req, res) => res.end()));
  const ensureWebConsoleAuthToken = typeof options.ensureWebConsoleAuthToken === 'function'
    ? options.ensureWebConsoleAuthToken
    : (async () => ({ token: '', generated: false }));
  const buildStartupSelfCheckPayload = typeof options.buildStartupSelfCheckPayload === 'function'
    ? options.buildStartupSelfCheckPayload
    : null;
  const formatStartupSelfCheckLines = typeof options.formatStartupSelfCheckLines === 'function'
    ? options.formatStartupSelfCheckLines
    : null;

  let serverInstance = null;
  let currentInfo = null;

  function logStartupSelfCheck(payload = {}) {
    const lines = typeof formatStartupSelfCheckLines === 'function'
      ? formatStartupSelfCheckLines(payload)
      : [];
    const fallbackLines = lines.length > 0
      ? lines
      : [`[webConsole] Startup self-check: ${payload?.summary?.status || 'unknown'}`];

    for (const line of fallbackLines) {
      if (/\bERROR\b/.test(line)) {
        logger.error(line);
      } else if (/\bWARN\b/.test(line) || /warnings=[1-9]/.test(line)) {
        logger.warn(line);
      } else {
        logger.info(line);
      }
    }
  }

  async function start() {
    if (serverInstance && currentInfo) {
      return currentInfo;
    }

    let appConfig = getWebConsoleConfig();
    if (appConfig.enabled === false) {
      return null;
    }
    const tokenState = await ensureWebConsoleAuthToken();
    if (!appConfig.authToken && tokenState.token) {
      appConfig = {
        ...appConfig,
        authToken: tokenState.token,
      };
    }
    if (!appConfig.authToken) {
      throw new Error('控制台启动前必须先设置 webConsoleToken');
    }

    await fs.promises.mkdir(publicDir, { recursive: true });
    const host = appConfig.host;
    const preferredPort = appConfig.port;

    const server = http.createServer(createHandler());
    const info = await new Promise((resolve, reject) => {
      const tryListen = (port) => {
        server.once('error', (error) => {
          if (error?.code === 'EADDRINUSE') {
            if (!appConfig.portAutoIncrement) {
              reject(error);
              return;
            }
            server.removeAllListeners('error');
            tryListen(port + 1);
            return;
          }
          reject(error);
        });
        server.listen(port, host, () => {
          const address = server.address();
          resolve({
            host,
            port: address?.port || port,
            url: getWebConsoleDisplayUrl({ host, port: address?.port || port }),
          });
        });
      };
      tryListen(preferredPort);
    });

    serverInstance = server;
    currentInfo = {
      ...info,
      authTokenGenerated: tokenState.generated === true,
    };
    logger.info(`[webConsole] Web console is running at ${info.url}`);
    logger.info(`[webConsole] Listen host: ${host}`);
    logger.info(`[webConsole] Login token: ${maskLoginTokenForLog(appConfig.authToken)}`);
    if (tokenState.generated) {
      logger.info('[webConsole] Login token was generated automatically and saved to config.webConsoleToken');
    }
    if (buildStartupSelfCheckPayload) {
      try {
        const startupSelfCheck = await buildStartupSelfCheckPayload({
          appConfig,
          info: currentInfo,
          tokenState,
          publicDir,
        });
        currentInfo = {
          ...currentInfo,
          startupSelfCheck,
        };
        logStartupSelfCheck(startupSelfCheck);
      } catch (error) {
        logger.warn(`[webConsole] Startup self-check failed: ${error.message}`);
      }
    }
    return currentInfo;
  }

  async function stop() {
    if (!serverInstance) {
      return;
    }
    const server = serverInstance;
    serverInstance = null;
    currentInfo = null;
    await new Promise(resolve => server.close(() => resolve()));
  }

  function getInfo() {
    return currentInfo;
  }

  return {
    start,
    stop,
    getInfo,
  };
}
