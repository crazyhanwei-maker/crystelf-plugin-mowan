// 构建 ZCode 运行时产物：clone/checkout zai-org/ZCode 定版 tag → pnpm 构建 apps/zcode-cli →
// 收集 dist/zcode.cjs + provider 资产到运行时目录，生成带 sha256 的 manifest。
// 产物与构建缓存默认放在 Path.data 对应的数据目录（仓库外），不进 git。
//
// 用法：
//   node scripts/build-zcode-runtime.mjs [--tag v3.14.3] [--upstream <dir>] [--out <dir>]
//        [--dist <已构建的 dist 目录>] [--skip-clone] [--skip-install] [--skip-rg] [--keep-src]
// 环境变量：ZCODE_UPSTREAM_URL 覆盖上游仓库地址（镜像场景）。
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 与 constants/path.js 的 dataRoot 解析规则保持一致
const DATA_ROOT = process.env.CRYSTELF_DATA_DIR
  ? path.resolve(process.env.CRYSTELF_DATA_DIR)
  : path.resolve(REPO_ROOT, '../../data/crystelf');

const DEFAULT_TAG = 'v3.14.3';
const DEFAULT_UPSTREAM_URL = 'https://github.com/zai-org/ZCode.git';
// 上游 pinned 搜索工具：只带 rg 单文件（bfs/ugrep 缺失仅降级搜索类工具，不影响 -p 主链路）
const RIPGREP_VERSION = '14.1.1';
const RIPGREP_ASSETS = {
  win32: `ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`,
  linux: `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
  darwin: `ripgrep-${RIPGREP_VERSION}-aarch64-apple-darwin.tar.gz`,
};

const args = process.argv.slice(2);
const optionValue = name => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : undefined;
};
const hasFlag = name => args.includes(name);

const TAG = optionValue('--tag') || DEFAULT_TAG;
const VERSION = TAG.replace(/^v/, '');
const UPSTREAM_URL = process.env.ZCODE_UPSTREAM_URL || DEFAULT_UPSTREAM_URL;
const runtimeRoot = path.resolve(optionValue('--out')
  || path.join(DATA_ROOT, 'data', 'agent-cli-runtime', 'zcode'));
const upstreamDir = path.resolve(optionValue('--upstream')
  || path.join(DATA_ROOT, 'data', 'agent-cli-runtime', 'zcode-build', `ZCode-${TAG}`));
const distOverride = optionValue('--dist') ? path.resolve(optionValue('--dist')) : null;

const log = message => console.log(`[zcode-runtime] ${message}`);
const fail = message => {
  console.error(`[zcode-runtime] ${message}`);
  process.exit(1);
};

// 构建环境必须剥离宿主 ZCode 的变量：本机若装有 ZCode CLI（ZCODE_BUILTIN_PROVIDER_CONFIG_FILE 等），
// 原样继承会让上游构建脚本读到宿主缓存而非仓库自带配置
const buildEnv = { ...process.env };
for (const key of Object.keys(buildEnv)) {
  if (key.startsWith('ZCODE_') || key.startsWith('OPENCODE_')) delete buildEnv[key];
}

const run = (command, options = {}) => {
  log(`$ ${command}`);
  const result = spawnSync(command, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32',
    encoding: 'utf8',
    cwd: options.cwd || REPO_ROOT,
    env: options.env || buildEnv,
  });
  if (result.error) fail(`命令执行失败：${command}（${result.error.message}）`);
  if (result.status !== 0) fail(`命令退出码 ${result.status}：${command}`);
  return result;
};

const sha256 = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

// Windows 系统自带 bsdtar 可解 zip；Linux/macOS 用 tar 解 tgz
const extractArchive = (archivePath, targetDir) => {
  fs.mkdirSync(targetDir, { recursive: true });
  run(`tar -xf "${archivePath}" -C "${targetDir}"`);
};

const downloadRipgrep = targetToolsDir => {
  const asset = RIPGREP_ASSETS[process.platform];
  if (!asset) {
    log(`平台 ${process.platform} 无预置 rg 资产，跳过（搜索类工具将回退 PATH）`);
    return;
  }
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${asset}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-rg-'));
  const archivePath = path.join(tempDir, asset);
  log(`下载 ripgrep ${RIPGREP_VERSION}：${url}`);
  run(`curl -L --fail --retry 3 -o "${archivePath}" "${url}"`);
  extractArchive(archivePath, path.join(tempDir, 'extract'));
  const rgName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const findRg = dir => {
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === rgName) return full;
      }
    }
    return null;
  };
  const rgBinary = findRg(path.join(tempDir, 'extract'));
  if (!rgBinary) fail(`ripgrep 压缩包中未找到 ${rgName}`);
  fs.mkdirSync(targetToolsDir, { recursive: true });
  const target = path.join(targetToolsDir, rgName);
  fs.copyFileSync(rgBinary, target);
  fs.chmodSync(target, 0o755);
  fs.rmSync(tempDir, { recursive: true, force: true });
  log(`rg 已就位：${target}`);
};

// ---- 1. 上游源码 ----
if (!hasFlag('--skip-clone')) {
  if (fs.existsSync(path.join(upstreamDir, '.git'))) {
    log(`上游源码已存在：${upstreamDir}`);
  } else {
    fs.mkdirSync(path.dirname(upstreamDir), { recursive: true });
    run(`git clone --depth 1 --branch ${TAG} ${UPSTREAM_URL} "${upstreamDir}"`);
  }
}
if (!fs.existsSync(path.join(upstreamDir, 'apps', 'zcode-cli', 'packages', 'cli'))) {
  fail(`上游源码不完整：${upstreamDir}`);
}

// ---- 2. 构建（dist 已提供时跳过）----
let distDir = distOverride;
if (!distDir) {
  if (!hasFlag('--skip-install')) {
    run('pnpm install', { cwd: upstreamDir });
  }
  // turbo 的 bin 位置随 hoisted 布局落在仓库根或 apps/zcode-cli 下，两个候选都找
  const turboName = process.platform === 'win32' ? 'turbo.CMD' : 'turbo';
  const turboCandidates = [
    path.join(upstreamDir, 'node_modules', '.bin', turboName),
    path.join(upstreamDir, 'apps', 'zcode-cli', 'node_modules', '.bin', turboName),
  ];
  const turboBin = turboCandidates.find(fs.existsSync);
  if (!turboBin) fail(`turbo 未安装：${turboCandidates.join(' 或 ')}（先执行 pnpm install）`);
  run(`"${turboBin}" run build --filter=!@zcode/cli`, { cwd: path.join(upstreamDir, 'apps', 'zcode-cli') });
  run('pnpm --dir apps/zcode-cli/packages/cli build', { cwd: upstreamDir });
  distDir = path.join(upstreamDir, 'apps', 'zcode-cli', 'packages', 'cli', 'dist');
}
if (!fs.existsSync(path.join(distDir, 'zcode.cjs'))) {
  fail(`dist 中未找到 zcode.cjs：${distDir}`);
}

// ---- 3. 收集产物 ----
const outRuntimeDir = path.join(runtimeRoot, 'runtime');
fs.rmSync(outRuntimeDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outRuntimeDir, 'provider'), { recursive: true });
const copied = [];
const copyFile = (source, relativeTarget) => {
  const target = path.join(outRuntimeDir, relativeTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied.push(relativeTarget);
};
copyFile(path.join(distDir, 'zcode.cjs'), 'zcode.cjs');
for (const relative of ['zcode.cjs.map', 'THIRD-PARTY-NOTICES.md']) {
  if (fs.existsSync(path.join(distDir, relative))) copyFile(path.join(distDir, relative), relative);
}
const builtinSource = path.join(distDir, 'provider', 'zcode-builtin.json')
  || path.join(upstreamDir, 'config', 'provider', 'zcode-builtin.json');
if (!fs.existsSync(builtinSource)) fail('未找到 zcode-builtin.json（provider 配置基线）');
copyFile(builtinSource, path.join('provider', 'zcode-builtin.json'));

if (!hasFlag('--skip-rg')) {
  downloadRipgrep(path.join(runtimeRoot, 'tools'));
} else {
  log('跳过 rg 下载（--skip-rg）');
}

// ---- 4. manifest（sha256 校验清单，resolveBundledZcodeCommand 消费 version 字段）----
let commit = '';
try {
  commit = run('git rev-parse HEAD', { cwd: upstreamDir, capture: true }).stdout.trim();
} catch {
  commit = '';
}
const files = [];
for (const relative of copied) {
  const full = path.join(outRuntimeDir, relative);
  files.push({ path: path.join('runtime', relative), sha256: sha256(full), size: fs.statSync(full).size });
}
const toolsDir = path.join(runtimeRoot, 'tools');
if (fs.existsSync(toolsDir)) {
  for (const entry of fs.readdirSync(toolsDir)) {
    const full = path.join(toolsDir, entry);
    if (!fs.statSync(full).isFile()) continue;
    files.push({ path: path.join('tools', entry), sha256: sha256(full), size: fs.statSync(full).size });
  }
}
const manifest = {
  product: 'crystelf-bundled-zcode',
  version: VERSION,
  tag: TAG,
  upstreamUrl: UPSTREAM_URL,
  commit,
  platform: `${process.platform}-${process.arch}`,
  nodeRequirement: '>=22',
  builtAt: new Date().toISOString(),
  files,
};
fs.writeFileSync(path.join(runtimeRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// ---- 5. 校验 ----
const manifestCheck = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'manifest.json'), 'utf8'));
for (const file of manifestCheck.files) {
  const full = path.join(runtimeRoot, file.path);
  if (!fs.existsSync(full)) fail(`manifest 文件缺失：${file.path}`);
  if (sha256(full) !== file.sha256) fail(`manifest sha256 不匹配：${file.path}`);
}
log(`构建完成：${runtimeRoot}`);
log(`文件数：${manifestCheck.files.length}，版本：${manifestCheck.version}`);
