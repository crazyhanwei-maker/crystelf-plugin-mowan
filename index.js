import chalk from 'chalk';
import fc from './components/json.js';
import Path from './constants/path.js';
import { crystelfInit } from './lib/system/init.js';
import updater from './lib/system/updater.js';
import { startWebConsole } from './lib/webConsole/server.js';

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),
  mark: (...args) => console.log(...args),
};

logger.info(
  chalk.rgb(134, 142, 204)('灵晶初始化开始')
);

await crystelfInit.CSH().then(() => logger.mark('[crystelf-plugin] crystelf-plugin 完成初始化'));

import ConfigControl from "./lib/config/configControl.js";
const appConfig = await ConfigControl.get('config');

if (appConfig.webConsole !== false) {
  startWebConsole().catch((err) => {
    logger.error('[crystelf-plugin] 本地控制台启动失败:', err);
  });
}

if(appConfig.autoUpdate) {
  logger.info('[crystelf-plugin] 自动更新已启用，正在自动检查更新...');
  updater.checkAndUpdate().catch((err) => {
    logger.error(err);
  });
}

const appPath = Path.apps;
const jsFiles = await fc.readDirRecursive(appPath, 'js');
const enabledApps = [];
const disabledApps = [];

for (const file of jsFiles) {
  const name = file.replace('.js', '');
  const configKey = getConfigKey(name);
  if (appConfig[configKey] === false) {
    disabledApps.push(name);
    logger.info(`[crystelf-plugin] 插件 ${name} 已禁用，跳过加载`);
  } else {
    enabledApps.push(file);
  }
}

if (disabledApps.length > 0) {
  logger.info(`[crystelf-plugin] 已跳过 ${disabledApps.length} 个禁用的插件: ${disabledApps.join(', ')}`);
}

let ret = enabledApps.map((file) => {
  return import(`./apps/${file}`);
});

ret = await Promise.allSettled(ret);

let apps = {};
const failedApps = [];
for (let i in enabledApps) {
  let name = enabledApps[i].replace('.js', '');
  if (ret[i].status !== 'fulfilled') {
    logger.error(`[crystelf-plugin] 插件 ${name} 加载失败:`, ret[i].reason);
    failedApps.push(name);
    continue;
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]];
}
if (failedApps.length === 0) {
  logger.info('灵晶已经完成初始化，没有发现异常');
} else {
  logger.warn(`[crystelf-plugin] 已加载 ${Object.keys(apps).length} 个插件，${failedApps.length} 个插件加载失败: ${failedApps.join(', ')}`);
}

export { apps };

/**
 * 将插件文件名映射到配置键名
 * @param {string} fileName
 * @returns {string}
 */
function getConfigKey(fileName) {
  const keyMap = {
    '60s': '60s',
    'ai': 'ai',
    'auth': 'auth',
    'auth-set': 'auth',
    'dependency-repair': 'dependencyRepair',
    'face-reply': 'faceReply',
    'face-reply-message': 'faceReply',
    'fanqie': 'fanqie',
    'group-title': 'groupTitle',
    'help': 'help',
    'image-monitor': 'imageMonitor',
    'log-diagnosis': 'logDiagnosis',
    'music': 'music',
    'poke': 'poke',
    'rssPush': 'rss',
    'status': 'status',
    'welcome': 'welcome',
    'welcome-set': 'welcome',
    'zwa': 'zwa'
  };
  
  return keyMap[fileName] || fileName;
}
