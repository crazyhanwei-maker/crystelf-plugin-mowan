import { getWebConsoleDisplayUrl } from './webConsoleConfig.js';

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
  const isLoopbackAddress = typeof options.isLoopbackAddress === 'function'
    ? options.isLoopbackAddress
    : (() => false);

  let serverInstance = null;
  let currentInfo = null;

  async function start() {
    if (serverInstance && currentInfo) {
      return currentInfo;
    }

    const appConfig = getWebConsoleConfig();
    if (appConfig.enabled === false) {
      return null;
    }
    if (!isLoopbackAddress(appConfig.host) && !appConfig.authToken) {
      throw new Error('非本机地址启动控制台前必须先设置 webConsoleToken');
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
    currentInfo = info;
    logger.info(`[webConsole] Web console is running at ${info.url}`);
    return info;
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
