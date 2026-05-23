import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';

const root = process.cwd();
const publicRoot = path.join(root, 'lib', 'webConsole', 'public');
const ignoredDirNames = new Set(['.git', 'node_modules', 'temp']);

async function walk(currentDir, output) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirNames.has(entry.name)) {
        await walk(fullPath, output);
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(fullPath);
    }
  }
}

function toRelative(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function summarizeOutput(output = '') {
  const lines = String(output)
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean);

  return lines.slice(0, 8).join('\n');
}

async function main() {
  const files = [];

  try {
    await walk(publicRoot, files);
  } catch (error) {
    console.error(`控制台前端目录不可用：${toRelative(publicRoot)}`);
    console.error(error?.message || error);
    process.exit(1);
  }

  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });

    if (result.status !== 0) {
      failures.push({
        file,
        output: summarizeOutput(result.stderr || result.stdout),
      });
    }
  }

  if (failures.length > 0) {
    console.error(`控制台前端 JS 语法检查失败：${failures.length}/${files.length}`);
    for (const failure of failures) {
      console.error(`\n- ${toRelative(failure.file)}`);
      if (failure.output) {
        console.error(failure.output);
      }
    }
    process.exit(1);
  }

  console.log(`控制台前端 JS 语法检查通过：${files.length} 个文件`);
}

main();
