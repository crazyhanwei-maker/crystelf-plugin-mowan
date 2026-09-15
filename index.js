import chalk from 'chalk';
import fc from './components/json.js';
import Path from './constants/path.js';
import { crystelfInit } from './lib/system/init.js';
import updater from './lib/system/updater.js';
import { startWebConsole } from './lib/webConsole/server.js';
import { reapOrphanOpenCodeServers } from './lib/webConsole/orphanReaper.js';

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

// 启动时异步刷新一次 TTS 模型列表，避免缓存长期不更新导致 bot 看不到远端新加的角色。
// fetchTtsModels 内部会自行校验 tts.enabled / modelsUrl，未启用时直接 no-op。
import('./lib/ai/ttsRegistry.js')
  .then(({ fetchTtsModels }) => fetchTtsModels())
  .then((result) => {
    if (result?.success) {
      logger.info(`[crystelf-plugin] TTS 模型列表已刷新，共 ${result.count} 个模型`);
    } else if (result?.error && result.error !== '内置语音工具未启用' && result.error !== '未配置语音模型列表地址') {
      logger.warn(`[crystelf-plugin] TTS 模型列表刷新失败: ${result.error}`);
    }
  })
  .catch((err) => {
    logger.warn(`[crystelf-plugin] TTS 模型列表刷新异常: ${err?.message || err}`);
  });

const appPath = Path.apps;

// 孤儿 opencode 回收：pm2 重启会把 serve 进程留成 PPID=1 的孤儿，插件空闲回收够不着。
// 延迟 60 秒（等运行时注册表先有机会拉起自己的 serve，且孤儿判定要求存活 >60 秒，互不冲突）。
setTimeout(() => {
  try {
    const result = reapOrphanOpenCodeServers({ pluginRoot: Path.root, logger });
    if (result.killed?.length) {
      logger.mark(`[crystelf-plugin] 孤儿 opencode 进程回收完成：${result.killed.length} 个`);
    }
  } catch (error) {
    logger.warn(`[crystelf-plugin] 孤儿 opencode 回收异常: ${error.message}`);
  }
}, 60000).unref?.();

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

function isPluginClass(value) {
  if (typeof value !== 'function') return false;
  try {
    return /^class\s/.test(Function.prototype.toString.call(value));
  } catch {
    return false;
  }
}

function selectPluginClasses(moduleExports = {}) {
  const classes = [];
  const seen = new Set();
  if (isPluginClass(moduleExports?.default)) {
    classes.push({ exportName: 'default', pluginClass: moduleExports.default });
    seen.add(moduleExports.default);
  }
  for (const [exportName, value] of Object.entries(moduleExports || {})) {
    if (exportName === 'default' || !isPluginClass(value) || seen.has(value)) continue;
    classes.push({ exportName, pluginClass: value });
    seen.add(value);
  }
  return classes;
}

for (let i in enabledApps) {
  let name = enabledApps[i].replace('.js', '');
  if (ret[i].status !== 'fulfilled') {
    logger.error(`[crystelf-plugin] 插件 ${name} 加载失败:`, ret[i].reason);
    failedApps.push(name);
    continue;
  }
  const pluginClasses = selectPluginClasses(ret[i].value);
  if (pluginClasses.length === 0) {
    logger.error(`[crystelf-plugin] 插件 ${name} 没有导出有效的插件类，已跳过加载`);
    failedApps.push(name);
    continue;
  }
  for (const [classIndex, { exportName, pluginClass }] of pluginClasses.entries()) {
    const appName = classIndex === 0 ? name : `${name}-${exportName}`;
    apps[appName] = pluginClass;
  }
  if (pluginClasses.length > 1) {
    logger.info(`[crystelf-plugin] 插件 ${name} 注册了 ${pluginClasses.length} 个插件类: ${pluginClasses.map(({ exportName }, index) => index === 0 ? name : `${name}-${exportName}`).join(', ')}`);
  }
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
    'voice-model': 'voiceModel',
    'voice-synthesis': 'voiceModel',
    'welcome': 'welcome',
    'welcome-set': 'welcome',
    'zwa': 'zwa'
  };
  
  return keyMap[fileName] || fileName;
}
