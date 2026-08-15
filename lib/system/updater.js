import child_process from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import Path from '../../constants/path.js';
import {
  PUBLIC_REPOSITORY_BRANCH,
  PUBLIC_REPOSITORY_FETCH_REFSPEC,
  PUBLIC_REPOSITORY_REF,
  PUBLIC_REPOSITORY_URL,
  PUBLIC_REPOSITORY_URL_FALLBACK,
} from './publicRepository.js';

const GIT_DIR = path.join(Path.root, '.git');
const GIT_TIMEOUT_MS = 2 * 60 * 1000;
const GIT_PLUGIN_ROOT_PARENT = path.dirname(Path.root);
const GIT_EMPTY_CONFIG = process.platform === 'win32' ? 'NUL' : '/dev/null';
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  // 防止全局 URL 重写把公开 HTTPS 地址改成 SSH；更新只使用固定公开仓库。
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GIT_EMPTY_CONFIG,
  // 防止 git 在插件目录没有 .git 时沿目录链向上找到 Yunzai 主仓的 .git
  GIT_CEILING_DIRECTORIES: GIT_PLUGIN_ROOT_PARENT,
};

function normalizePathForCompare(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function execGit(args = [], options = {}) {
  const result = child_process.execFileSync('git', args, {
    cwd: Path.root,
    env: GIT_ENV,
    timeout: options.timeout ?? GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    stdio: options.stdio || 'pipe',
  });
  return Buffer.isBuffer(result) ? result.toString().trim() : '';
}

function runGit(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    child_process.execFile('git', args, {
      cwd: Path.root,
      env: GIT_ENV,
      timeout: options.timeout ?? GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
      });
    });
  });
}

function getDependencyManifestSnapshot() {
  const files = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
  const snapshot = {};
  for (const file of files) {
    const absolutePath = path.join(Path.root, file);
    snapshot[file] = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
  }
  return snapshot;
}

function hasManifestChanged(before = {}, after = {}) {
  return Object.keys({ ...before, ...after }).some((key) => String(before[key] || '') !== String(after[key] || ''));
}

const Updater = {
  async isGitRepo() {
    // 仅判断 .git 存在是不够的，git 会向上找到 Yunzai 主仓；
    // 必须确认 rev-parse --show-toplevel 等于插件目录本身。
    if (!fs.existsSync(GIT_DIR)) return false;
    try {
      const top = execGit(['rev-parse', '--show-toplevel']);
      return normalizePathForCompare(top) === normalizePathForCompare(Path.root);
    } catch {
      return false;
    }
  },

  async getBranch() {
    return execGit(['symbolic-ref', '--short', 'HEAD']);
  },

  async getLocalHash() {
    return execGit(['rev-parse', 'HEAD']);
  },

  async getRemoteHash(ref = PUBLIC_REPOSITORY_REF) {
    return execGit(['rev-parse', String(ref || PUBLIC_REPOSITORY_REF).trim()]);
  },

  async isWorkingTreeClean() {
    const status = await runGit(['status', '--porcelain'], { timeout: 30000 });
    return !status.stdout;
  },

  async getUpstream() {
    return {
      remote: 'crystelf-public',
      branch: PUBLIC_REPOSITORY_BRANCH,
      ref: PUBLIC_REPOSITORY_REF,
      url: this._workingUrl || PUBLIC_REPOSITORY_URL,
    };
  },

  async isAncestor(ancestor, descendant) {
    try {
      await runGit(['merge-base', '--is-ancestor', ancestor, descendant], { timeout: 30000 });
      return true;
    } catch (error) {
      if (error?.code === 1 || error?.status === 1) {
        return false;
      }
      throw error;
    }
  },

  /** 尝试从多个更新源逐一拉取，返回第一个可用的 URL */
  async _resolveWorkingUrl() {
    const urls = [PUBLIC_REPOSITORY_URL];
    if (PUBLIC_REPOSITORY_URL_FALLBACK) {
      urls.push(PUBLIC_REPOSITORY_URL_FALLBACK);
    }
    let lastError = null;
    for (const url of urls) {
      try {
        await runGit(['fetch', '--quiet', url, PUBLIC_REPOSITORY_FETCH_REFSPEC]);
        this._workingUrl = url;
        return url;
      } catch (err) {
        lastError = err;
        logger.warn(`[crystelf-plugin] 更新源不可用: ${url} — ${err.message}`);
      }
    }
    throw lastError || new Error('所有更新源均不可用，无法检查更新');
  },

  async getUpdateStatus() {
    try {
      const upstream = await this.getUpstream();
      // 直接拉取固定公开地址，不读取或修改 Bot 端可能被改坏的 origin。
      // 如果第一源（Gitee）不可用，自动切换到备用源（GitHub）。
      const workingUrl = await this._resolveWorkingUrl();

      const local = await this.getLocalHash();
      const remote = await this.getRemoteHash(upstream.ref);

      if (local === remote) {
        return { hasUpdate: false, state: 'up-to-date', upstream, local, remote };
      }

      if (await this.isAncestor(local, remote)) {
        return { hasUpdate: true, state: 'behind', upstream, local, remote };
      }

      if (await this.isAncestor(remote, local)) {
        return { hasUpdate: false, state: 'local-ahead', upstream, local, remote };
      }

      return { hasUpdate: false, state: 'diverged', upstream, local, remote };
    } catch (err) {
      logger.error('[crystelf-plugin] 检查更新失败', err);
      throw err;
    }
  },

  async hasUpdate() {
    const status = await this.getUpdateStatus();
    return status.hasUpdate;
  },

  async update(status = null) {
    const resolvedStatus = status || await this.getUpdateStatus();
    if (!resolvedStatus.hasUpdate) {
      if (resolvedStatus.state === 'local-ahead') {
        logger.info('[crystelf-plugin] 本地分支已领先上游，跳过自动更新');
      } else if (resolvedStatus.state === 'diverged') {
        logger.warn('[crystelf-plugin] 本地分支与上游已分叉，跳过自动更新');
      } else {
        logger.info('[crystelf-plugin] 当前已是最新版本，无需更新');
      }
      return false;
    }

    const beforeSnapshot = getDependencyManifestSnapshot();
    logger.mark(chalk.cyan('[crystelf-plugin] 检测到插件有更新，自动执行 fast-forward 更新'));
    const pullUrl = this._workingUrl || PUBLIC_REPOSITORY_URL;
    execGit(['pull', '--ff-only', '--no-rebase', pullUrl, PUBLIC_REPOSITORY_BRANCH], {
      stdio: 'inherit',
      timeout: 3 * 60 * 1000,
    });
    const afterSnapshot = getDependencyManifestSnapshot();
    if (hasManifestChanged(beforeSnapshot, afterSnapshot)) {
      logger.warn('[crystelf-plugin] 检测到依赖清单已变化，请手动安装依赖后再继续运行');
    }
    logger.mark(chalk.green('[crystelf-plugin] 插件已自动更新完成'));
    return true;
  },

  async forceUpdate(options = {}) {
    if (!options.confirmed) {
      const error = new Error('强制更新需要确认后才能执行');
      error.code = 'FORCE_UPDATE_CONFIRMATION_REQUIRED';
      throw error;
    }

    if (!await this.isGitRepo()) {
      const error = new Error('当前插件目录不是 Git 仓库，无法强制更新');
      error.code = 'NOT_GIT_REPO';
      throw error;
    }

    const upstream = await this.getUpstream();
    const beforeSnapshot = getDependencyManifestSnapshot();
    const beforeHash = await this.getLocalHash();

    // 强制更新同样直接拉取公开仓库，避免误用本地 origin 或私有地址。
    // 第一源不可用时自动切换到备用源。
    const forceUrl = await this._resolveWorkingUrl();
    const remoteHash = await this.getRemoteHash(upstream.ref);

    logger.warn(chalk.yellow(`[crystelf-plugin] 即将强制覆盖本地修改并更新到 ${upstream.ref}`));
    execGit(['reset', '--hard', remoteHash], {
      stdio: 'inherit',
      timeout: 2 * 60 * 1000,
    });
    execGit(['clean', '-fd'], {
      stdio: 'inherit',
      timeout: 2 * 60 * 1000,
    });

    const afterSnapshot = getDependencyManifestSnapshot();
    const manifestChanged = hasManifestChanged(beforeSnapshot, afterSnapshot);
    if (manifestChanged) {
      logger.warn('[crystelf-plugin] 检测到依赖清单已变化，请确认依赖是否需要重新安装');
    }
    logger.mark(chalk.green('[crystelf-plugin] 插件已完成强制更新'));
    return {
      from: beforeHash,
      to: remoteHash,
      upstream,
      manifestChanged,
    };
  },

  async checkAndUpdate() {
    if (!(await this.isGitRepo())) {
      logger.warn('[crystelf-plugin] 当前目录不是 Git 仓库，自动更新功能已禁用');
      return;
    }

    try {
      if (!(await this.isWorkingTreeClean())) {
        logger.warn('[crystelf-plugin] 工作区存在未提交改动，已跳过自动更新');
        return;
      }

      const status = await this.getUpdateStatus();
      if (status.hasUpdate) {
        await this.update(status);
      } else if (status.state === 'local-ahead') {
        logger.info('[crystelf-plugin] 本地分支已领先上游，跳过自动更新');
      } else if (status.state === 'diverged') {
        logger.warn('[crystelf-plugin] 本地分支与上游已分叉，跳过自动更新');
      } else {
        logger.info('[crystelf-plugin] 当前已是最新版本，无需更新');
      }
    } catch (err) {
      logger.error('[crystelf-plugin] 自动更新失败:', err);
    }
  },
};

export default Updater;
