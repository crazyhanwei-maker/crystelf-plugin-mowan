import fs from 'fs';
import url from 'url';
import path from 'path';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.join(__dirname, '../..', 'package.json');

let cache = null;
let cacheMtime = 0;

function getPkg() {
  try {
    const mtime = fs.statSync(pkgPath).mtimeMs;
    if (!cache || mtime !== cacheMtime) {
      cache = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      cacheMtime = mtime;
    }
  } catch {
    // 读取或解析失败时沿用旧 cache，不抛异常影响调用方
  }
  return cache || {};
}

const Version = {
  get ver() {
    return getPkg().version;
  },
  get author() {
    return getPkg().author;
  },
  get name() {
    return getPkg().name;
  },
  get description() {
    return getPkg().description;
  },
};

export default Version;
