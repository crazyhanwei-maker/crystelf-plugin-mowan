import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const PLUGIN_SCAN_LIMIT = 200;
const GIT_TIMEOUT_MS = 2500;
const BOT_PLUGIN_TRASH_DIR_NAME = '.crystelf-plugin-trash';

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readJsonFileSafe(filePath = '', fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isPlainObject(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getRealPathSafe(targetPath = '') {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    try {
      return fs.realpathSync(targetPath);
    } catch {
      return path.resolve(String(targetPath || ''));
    }
  }
}

function isSubPath(parentPath = '', targetPath = '') {
  if (!parentPath || !targetPath) return false;
  const relativePath = path.relative(parentPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function normalizeConsolePath(value = '') {
  return String(value || '').replace(/\\/g, '/');
}

function normalizePluginDirectoryName(value = '') {
  return String(value || '').trim();
}

function isSafePluginDirectoryName(value = '') {
  const directoryName = normalizePluginDirectoryName(value);
  if (!directoryName) return false;
  if (directoryName.startsWith('.') || directoryName === BOT_PLUGIN_TRASH_DIR_NAME) return false;
  if (/[\\/:*?"<>|]/.test(directoryName)) return false;
  return directoryName !== '.' && directoryName !== '..';
}

function trimText(value = '', maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function runGit(pluginDir = '', args = []) {
  try {
    const result = spawnSync('git', args, {
      cwd: pluginDir,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
      return '';
    }
    return String(result.stdout || '').trim();
  } catch {
    return '';
  }
}

function readGitInfo(pluginDir = '') {
  const gitDir = path.join(pluginDir, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      isGit: false,
      branch: '',
      remote: '',
      commit: '',
      commitMessage: '',
      status: 'none',
      dirtyCount: 0,
    };
  }

  const branch = runGit(pluginDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const remote = runGit(pluginDir, ['config', '--get', 'remote.origin.url']);
  const commit = runGit(pluginDir, ['rev-parse', '--short', 'HEAD']);
  const commitMessage = runGit(pluginDir, ['log', '-1', '--pretty=%s']);
  const porcelain = runGit(pluginDir, ['status', '--porcelain']);
  const dirtyCount = porcelain ? porcelain.split(/\r?\n/).filter(Boolean).length : 0;
  return {
    isGit: true,
    branch,
    remote,
    commit,
    commitMessage: trimText(commitMessage, 120),
    status: dirtyCount > 0 ? 'dirty' : 'clean',
    dirtyCount,
  };
}

function countDependencyEntries(manifest = {}) {
  const countObjectKeys = value => (isPlainObject(value) ? Object.keys(value).length : 0);
  return {
    runtime: countObjectKeys(manifest.dependencies),
    dev: countObjectKeys(manifest.devDependencies),
    peer: countObjectKeys(manifest.peerDependencies),
    optional: countObjectKeys(manifest.optionalDependencies),
  };
}

function inferPluginType(entryName = '', manifest = {}, pluginDir = '') {
  if (manifest.name) return 'package';
  if (fs.existsSync(path.join(pluginDir, 'index.js'))) return 'yunzai-plugin';
  if (fs.existsSync(path.join(pluginDir, 'apps'))) return 'yunzai-plugin';
  if (entryName.endsWith('-plugin') || entryName.includes('plugin')) return 'plugin';
  return 'directory';
}

export function createBotPluginConsole(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const yunzaiDir = options.yunzaiDir || process.cwd();
  const resolvePluginsDirectory = typeof options.resolvePluginsDirectory === 'function'
    ? options.resolvePluginsDirectory
    : (() => {
        const candidates = [
          path.join(process.cwd(), 'plugins'),
          path.join(yunzaiDir, 'plugins'),
        ];
        for (const candidate of candidates) {
          try {
            if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
              return candidate;
            }
          } catch {
            // Continue probing other plugin roots.
          }
        }
        return '';
      });
  const getResolvedPathSafe = typeof options.getResolvedPathSafe === 'function'
    ? options.getResolvedPathSafe
    : getRealPathSafe;
  const toRelativeConsolePath = typeof options.toRelativeConsolePath === 'function'
    ? options.toRelativeConsolePath
    : (targetPath = '') => normalizeConsolePath(path.relative(process.cwd(), targetPath));
  const recordWebConsoleOperation = typeof options.recordWebConsoleOperation === 'function'
    ? options.recordWebConsoleOperation
    : (() => {});

  function buildPluginItem(entry = {}, pluginsDir = '') {
    const pluginDir = path.join(pluginsDir, entry.name);
    const pluginRoot = getResolvedPathSafe(pluginDir);
    const root = getResolvedPathSafe(rootDir);
    const stat = fs.statSync(pluginDir);
    const manifestPath = path.join(pluginDir, 'package.json');
    const manifest = readJsonFileSafe(manifestPath, {});
    const hasPackage = isPlainObject(manifest) && Object.keys(manifest).length > 0;
    const dependencyCounts = countDependencyEntries(manifest);
    const git = readGitInfo(pluginDir);
    const relativePath = toRelativeConsolePath(pluginDir);
    const name = trimText(manifest.displayName || manifest.name || entry.name, 80);
    const description = trimText(manifest.description || '', 180);
    const isCurrentPlugin = Boolean(root && pluginRoot && isSubPath(pluginRoot, root));

    return {
      id: entry.name,
      name,
      directoryName: entry.name,
      type: inferPluginType(entry.name, manifest, pluginDir),
      version: String(manifest.version || '').trim(),
      description,
      path: pluginRoot,
      relativePath,
      hasPackage,
      packageName: String(manifest.name || '').trim(),
      packageManager: String(manifest.packageManager || '').trim(),
      main: String(manifest.main || '').trim(),
      scripts: isPlainObject(manifest.scripts) ? Object.keys(manifest.scripts).sort() : [],
      dependencyCounts,
      totalDependencies: Object.values(dependencyCounts).reduce((sum, value) => sum + Number(value || 0), 0),
      git,
      isCurrentPlugin,
      canDelete: !isCurrentPlugin && entry.name !== BOT_PLUGIN_TRASH_DIR_NAME,
      createdAt: stat.birthtime?.toISOString?.() || '',
      updatedAt: stat.mtime?.toISOString?.() || '',
      fileBrowserPath: relativePath,
    };
  }

  function buildPayload() {
    const pluginsDir = resolvePluginsDirectory();
    const pluginsRoot = getResolvedPathSafe(pluginsDir);
    const warnings = [];
    let plugins = [];
    if (!pluginsDir || !pluginsRoot || !fs.existsSync(pluginsRoot)) {
      warnings.push('未找到 Yunzai plugins 目录。');
    } else {
      try {
        plugins = fs.readdirSync(pluginsRoot, { withFileTypes: true })
          .filter(entry => entry?.isDirectory?.())
          .filter(entry => !entry.name.startsWith('.'))
          .filter(entry => entry.name !== BOT_PLUGIN_TRASH_DIR_NAME)
          .slice(0, PLUGIN_SCAN_LIMIT)
          .map(entry => buildPluginItem(entry, pluginsRoot))
          .sort((left, right) => Number(right.isCurrentPlugin) - Number(left.isCurrentPlugin)
            || String(left.name || left.directoryName).localeCompare(String(right.name || right.directoryName), 'zh-CN'));
      } catch (error) {
        warnings.push(`扫描插件目录失败：${error.message}`);
        plugins = [];
      }
    }

    const dirtyPlugins = plugins.filter(item => item.git?.status === 'dirty');
    const gitPlugins = plugins.filter(item => item.git?.isGit === true);
    const packagePlugins = plugins.filter(item => item.hasPackage);
    return {
      success: true,
      generatedAt: new Date().toISOString(),
      rootDir: pluginsRoot,
      rootRelativePath: pluginsRoot ? toRelativeConsolePath(pluginsRoot) : '',
      scanLimit: PLUGIN_SCAN_LIMIT,
      warnings,
      summary: {
        pluginCount: plugins.length,
        gitCount: gitPlugins.length,
        dirtyCount: dirtyPlugins.length,
        packageCount: packagePlugins.length,
        currentPluginCount: plugins.filter(item => item.isCurrentPlugin).length,
      },
      plugins,
    };
  }

  function deletePlugin(payload = {}) {
    const pluginsDir = resolvePluginsDirectory();
    const pluginsRoot = getResolvedPathSafe(pluginsDir);
    if (!pluginsDir || !pluginsRoot || !fs.existsSync(pluginsRoot)) {
      throw Object.assign(new Error('未找到 Yunzai plugins 目录'), {
        statusCode: 500,
        code: 'PLUGIN_ROOT_NOT_FOUND',
      });
    }

    const directoryName = normalizePluginDirectoryName(payload.directoryName || payload.id || payload.pluginId);
    if (!directoryName) {
      throw Object.assign(new Error('插件目录名不能为空'), {
        statusCode: 400,
        code: 'PLUGIN_DIRECTORY_REQUIRED',
      });
    }
    if (!isSafePluginDirectoryName(directoryName)) {
      throw Object.assign(new Error('插件目录名不合法或不允许删除'), {
        statusCode: 400,
        code: 'PLUGIN_DIRECTORY_INVALID',
      });
    }

    const targetDir = getResolvedPathSafe(path.join(pluginsRoot, directoryName));
    if (!isSubPath(pluginsRoot, targetDir) || targetDir === pluginsRoot) {
      throw Object.assign(new Error('插件删除路径越界'), {
        statusCode: 400,
        code: 'PLUGIN_DELETE_OUT_OF_RANGE',
      });
    }
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      throw Object.assign(new Error('目标插件目录不存在'), {
        statusCode: 404,
        code: 'PLUGIN_DIRECTORY_NOT_FOUND',
      });
    }

    const root = getResolvedPathSafe(rootDir);
    if (root && isSubPath(targetDir, root)) {
      throw Object.assign(new Error('不能删除当前正在运行的本插件'), {
        statusCode: 403,
        code: 'PLUGIN_DELETE_CURRENT_FORBIDDEN',
      });
    }

    const trashRoot = path.join(pluginsRoot, BOT_PLUGIN_TRASH_DIR_NAME);
    fs.mkdirSync(trashRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let trashDir = path.join(trashRoot, `${directoryName}-${stamp}`);
    let suffix = 1;
    while (fs.existsSync(trashDir)) {
      suffix += 1;
      trashDir = path.join(trashRoot, `${directoryName}-${stamp}-${suffix}`);
    }
    const resolvedTrashDir = getResolvedPathSafe(trashDir);
    if (!isSubPath(getResolvedPathSafe(trashRoot), resolvedTrashDir)) {
      throw Object.assign(new Error('插件回收路径越界'), {
        statusCode: 400,
        code: 'PLUGIN_TRASH_OUT_OF_RANGE',
      });
    }

    fs.renameSync(targetDir, trashDir);
    const result = {
      success: true,
      deleted: true,
      directoryName,
      trashPath: toRelativeConsolePath(trashDir),
      message: `插件 ${directoryName} 已移入回收站`,
    };
    recordWebConsoleOperation({
      action: 'plugin_delete_to_trash',
      method: 'TASK',
      path: 'bot-plugins:delete',
      result: 'success',
      statusCode: 200,
      details: {
        directoryName,
        targetDir: toRelativeConsolePath(targetDir),
        trashPath: result.trashPath,
      },
    });
    return result;
  }

  return {
    buildPayload,
    deletePlugin,
  };
}
