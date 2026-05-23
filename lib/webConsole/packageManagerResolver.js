import fs from 'fs';
import path from 'path';

const SUPPORTED_PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn']);

export function normalizePackageManager(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_PACKAGE_MANAGERS.has(normalized) ? normalized : '';
}

export function resolvePackageManagerBinary(manager = '') {
  const normalized = normalizePackageManager(manager);
  if (!normalized) return '';
  return process.platform === 'win32' ? `${normalized}.cmd` : normalized;
}

function readManifestPackageManager(manifest = null) {
  const raw = String(manifest?.packageManager || '').trim();
  return normalizePackageManager(raw.split('@')[0]);
}

function addCandidate(candidates, value = '') {
  const normalized = normalizePackageManager(value);
  if (normalized && !candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

export function resolvePreferredPackageManagers(targetDir = '', options = {}) {
  const candidates = [];
  addCandidate(candidates, readManifestPackageManager(options.manifest));

  const lockfileChecks = [
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'package-lock.json', manager: 'npm' },
    { file: 'yarn.lock', manager: 'yarn' },
  ];
  const candidateDirs = Array.from(new Set(
    [targetDir, ...(Array.isArray(options.rootDirs) ? options.rootDirs : [])]
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .map(item => path.resolve(item))
  ));

  for (const dirPath of candidateDirs) {
    for (const item of lockfileChecks) {
      if (fs.existsSync(path.join(dirPath, item.file))) {
        addCandidate(candidates, item.manager);
      }
    }
  }

  addCandidate(candidates, options.fallback || 'npm');
  return candidates;
}

export function buildPackageInstallCommand(manager = '') {
  const normalized = normalizePackageManager(manager) || 'npm';
  return {
    manager: normalized,
    command: resolvePackageManagerBinary(normalized),
    args: ['install', '--ignore-scripts'],
    displayCommand: [normalized, 'install', '--ignore-scripts'],
  };
}

export async function resolveAvailablePackageManager(targetDir = '', options = {}) {
  const candidates = resolvePreferredPackageManagers(targetDir, options);
  const runProcess = options.runProcess;
  if (typeof runProcess !== 'function') {
    const manager = candidates[0] || 'npm';
    return {
      manager,
      command: resolvePackageManagerBinary(manager),
      version: '',
      candidates,
    };
  }

  let lastFailureMessage = '';
  let lastError = null;
  for (const manager of candidates) {
    const command = resolvePackageManagerBinary(manager);
    try {
      const result = await runProcess(command, ['--version'], {
        cwd: targetDir,
        env: options.env || process.env,
        timeoutMs: Number(options.timeoutMs || 15000),
      });
      if (result?.status === 0) {
        return {
          manager,
          command,
          version: String(result.stdoutTail || '').trim().split(/\s+/)[0] || '',
          candidates,
        };
      }
      if (result?.error) {
        lastError = result.error;
      }
      lastFailureMessage = result?.stderrTail || result?.stdoutTail || `exit ${result?.status ?? 'unknown'}`;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError && String(lastError.code || '').trim() && String(lastError.code || '').trim() !== 'ENOENT') {
    throw new Error(`检测包管理器失败: ${String(lastError.message || lastError.code).trim()}`);
  }
  if (lastFailureMessage) {
    throw new Error(`检测包管理器失败: ${lastFailureMessage}`);
  }
  throw new Error('未检测到可用的包管理器，请先安装 npm、pnpm 或 yarn');
}
