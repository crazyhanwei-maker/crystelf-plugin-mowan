import child_process from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import Path from '../../constants/path.js';

const GIT_DIR = path.join(Path.root, '.git');
const GIT_TIMEOUT_MS = 2 * 60 * 1000;
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
};

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

function parseUpstreamRef(ref = '') {
  const normalized = String(ref || '').trim();
  const separatorIndex = normalized.indexOf('/');
  if (!normalized || separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    return null;
  }

  return {
    remote: normalized.slice(0, separatorIndex),
    branch: normalized.slice(separatorIndex + 1),
    ref: normalized,
  };
}

const Updater = {
  async isGitRepo() {
    return fs.existsSync(GIT_DIR);
  },

  async getBranch() {
    return execGit(['symbolic-ref', '--short', 'HEAD']);
  },

  async getLocalHash() {
    return execGit(['rev-parse', 'HEAD']);
  },

  async getRemoteHash(ref = 'origin/main') {
    return execGit(['rev-parse', String(ref || 'origin/main').trim()]);
  },

  async isWorkingTreeClean() {
    const status = await runGit(['status', '--porcelain'], { timeout: 30000 });
    return !status.stdout;
  },

  async getUpstream() {
    try {
      const upstreamRef = execGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
      const parsed = parseUpstreamRef(upstreamRef);
      if (parsed) {
        return parsed;
      }
    } catch {}

    const branch = await this.getBranch();
    return {
      remote: 'origin',
      branch,
      ref: `origin/${branch}`,
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

  async getUpdateStatus() {
    try {
      const upstream = await this.getUpstream();
      await runGit(['fetch', '--prune', upstream.remote]);

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
    execGit(['pull', '--ff-only', '--no-rebase', resolvedStatus.upstream.remote, resolvedStatus.upstream.branch], {
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
