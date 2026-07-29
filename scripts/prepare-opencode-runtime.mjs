import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postinstallScript = path.join(rootDir, 'node_modules', 'opencode-ai', 'postinstall.mjs');

if (!fs.existsSync(postinstallScript)) {
  console.log('[opencode] 依赖尚未安装，跳过运行文件准备。');
  process.exit(0);
}

const result = spawnSync(process.execPath, [postinstallScript], {
  cwd: rootDir,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`[opencode] 运行文件准备失败：${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`[opencode] 运行文件准备失败，退出码：${result.status ?? -1}`);
  process.exit(result.status || 1);
}

console.log('[opencode] 运行文件准备完成。');
