import fs from 'fs/promises';
import path from 'path';

const rootDir = process.cwd();
const decoder = new TextDecoder('utf-8', { fatal: true });

const ignoredDirNames = new Set([
  '.git',
  '.idea',
  'node_modules',
  'temp',
]);

const textExtensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.yml',
  '.yaml',
  '.txt',
  '.toml',
  '.ini',
  '.conf',
  '.sh',
  '.ps1',
  '.py',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.sql',
  '.log',
  '.svg',
]);

const textBasenames = new Set([
  'LICENSE',
  '.gitignore',
  '.editorconfig',
  '.prettierrc',
  '.eslintrc',
]);

// Common mojibake fragments produced when UTF-8 text is misread as GBK/ANSI.
const suspiciousFragments = [
  '闈㈠悜',
  '鐢熸€',
  '澶氬姛',
  '鑱婃',
  '鍒嗛挓',
  '鎺у埗',
  '櫥褰',
  '鐧诲綍',
  '鍙ｄ护',
  '璇疯緭鍏',
  '杩斿洖',
  '鎺ㄨ崘',
  '鍚敤',
  '璇存槑',
  '鏂规硶',
  '閰嶇疆',
  '绠＄悊',
  '鏈湴',
  '缃戦〉',
  '璋冭瘯',
  '鐢熸垚',
  '琛ㄦ儏',
  '妯″瀷',
  '缇よ亰',
  '鍏朵粬',
  '姝ｅ父',
  '宸ュ叿',
  '鎴戞潵',
  '鍥炲',
  '浣犲ソ鍛€',
  '鏅氫笂濂',
  '鍙戦€',
  '璇煶',
  '鍥剧墖',
  '鑾峰彇',
  '澶辫触',
  '鎴愬姛',
  '鏈€鏂',
  '鐩存帴',
  '閲嶅惎',
  '绗竴',
  '绗簩',
  '鍒濆鍖',
  '鎺ラ€',
  '榄斾父',
  '鎵嬪姩',
];

async function walk(currentDir, output) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirNames.has(entry.name)) {
        continue;
      }
      await walk(path.join(currentDir, entry.name), output);
      continue;
    }
    output.push(path.join(currentDir, entry.name));
  }
}

function shouldCheckFile(filePath) {
  const basename = path.basename(filePath);
  if (textBasenames.has(basename)) {
    return true;
  }
  return textExtensions.has(path.extname(filePath).toLowerCase());
}

function toRelative(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

async function main() {
  const allFiles = [];
  await walk(rootDir, allFiles);

  const files = allFiles.filter(shouldCheckFile).sort();
  const issues = [];

  for (const filePath of files) {
    const bytes = await fs.readFile(filePath);
    const relativePath = toRelative(filePath);

    const hasBom = bytes.length >= 3
      && bytes[0] === 0xef
      && bytes[1] === 0xbb
      && bytes[2] === 0xbf;

    let text = '';
    try {
      text = decoder.decode(bytes);
    } catch (error) {
      issues.push({
        type: 'invalid_utf8',
        file: relativePath,
        detail: error.message,
      });
      continue;
    }

    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    if (hasBom || replacementCount > 0) {
      issues.push({
        type: 'encoding_marker',
        file: relativePath,
        bom: hasBom,
        replacementCount,
      });
    }

    if (relativePath === 'scripts/check-encoding.mjs') {
      continue;
    }

    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const fragment = suspiciousFragments.find(item => line.includes(item));
      if (!fragment) {
        continue;
      }
      issues.push({
        type: 'suspicious_mojibake',
        file: relativePath,
        line: index + 1,
        fragment,
      });
      break;
    }
  }

  if (issues.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      checkedFiles: files.length,
      issues,
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    checkedFiles: files.length,
  }, null, 2));
}

await main();
