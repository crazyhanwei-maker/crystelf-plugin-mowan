// 控制台文件管理的 ZIP 打包/解压（零依赖实现）。
// deflate 借助内置 zlib，压不小就回退存储模式；只覆盖常规场景：普通文件 + 目录条目、
// UTF-8 文件名（置 general-purpose flag bit 11）。不支持 zip64，超出上限直接报错，
// 因此 total/entries 上限必须留足余量（都远小于 4GB/65535 的 zip32 边界）。
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const CRC32_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let value = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    value = CRC32_TABLE[(value ^ buffer[index]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ -1) >>> 0;
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function writeUint16(buffer, offset, value) {
  buffer.writeUInt16LE(value & 0xffff, offset);
}

function writeUint32(buffer, offset, value) {
  buffer.writeUInt32LE(value >>> 0, offset);
}

function isPathInsideRoot(targetPath = '', rootPath = '') {
  const resolveSafe = value => {
    const resolved = path.resolve(String(value || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const target = resolveSafe(targetPath);
  const root = resolveSafe(rootPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export const FILE_ARCHIVE_DEFAULT_LIMITS = {
  maxArchiveBytes: 512 * 1024 * 1024, // 生成的 zip / 待解压 zip 的大小上限
  maxSourceTotalBytes: 512 * 1024 * 1024, // 压缩源内容总字节上限
  maxSourceFileBytes: 256 * 1024 * 1024, // 单个源文件上限（超限跳过并报告）
  maxExtractTotalBytes: 1024 * 1024 * 1024, // 解压产出总字节上限
  maxEntries: 20000, // 条目数上限（zip32 硬边界 65535，留余量）
};

function normalizeLimits(limits = {}) {
  return { ...FILE_ARCHIVE_DEFAULT_LIMITS, ...(limits || {}) };
}

// 递归收集目录条目；shouldSkipSegment 命中的目录/文件名整支跳过（如 .git、node_modules）
function collectSources(sources = [], { shouldSkipSegment, limits, skipped }) {
  const files = [];
  const directories = [];
  let totalBytes = 0;
  let entryCount = 0;
  // 多选源文件可能重名：归档内名字自动加 -2/-3 后缀去重
  const usedArchiveNames = new Set();
  const uniquifyArchiveName = (name) => {
    if (!usedArchiveNames.has(name)) {
      usedArchiveNames.add(name);
      return name;
    }
    const extension = path.extname(name);
    const stem = name.slice(0, name.length - extension.length);
    for (let index = 2; ; index += 1) {
      const candidate = `${stem}-${index}${extension}`;
      if (!usedArchiveNames.has(candidate)) {
        usedArchiveNames.add(candidate);
        return candidate;
      }
    }
  };

  const walk = (absolutePath, rawArchiveName) => {
    if (entryCount >= limits.maxEntries) {
      skipped.push({ name: rawArchiveName, reason: '条目数超出上限' });
      return;
    }
    const archiveName = uniquifyArchiveName(rawArchiveName);
    let stat = null;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch {
      skipped.push({ name: archiveName, reason: '无法读取' });
      return;
    }
    if (stat.isSymbolicLink()) {
      skipped.push({ name: archiveName, reason: '跳过符号链接' });
      return;
    }
    if (stat.isDirectory()) {
      entryCount += 1;
      directories.push({ absolutePath, archiveName });
      let children = [];
      try {
        children = fs.readdirSync(absolutePath, { withFileTypes: true });
      } catch {
        skipped.push({ name: archiveName, reason: '目录无法读取' });
        return;
      }
      for (const child of children) {
        if (shouldSkipSegment(child.name)) continue;
        walk(path.join(absolutePath, child.name), `${archiveName}/${child.name}`);
      }
      return;
    }
    if (!stat.isFile()) {
      skipped.push({ name: archiveName, reason: '不支持的文件类型' });
      return;
    }
    if (stat.size > limits.maxSourceFileBytes) {
      skipped.push({ name: archiveName, reason: '文件超过单文件上限' });
      return;
    }
    if (totalBytes + stat.size > limits.maxSourceTotalBytes) {
      skipped.push({ name: archiveName, reason: '总大小超出上限' });
      return;
    }
    if (entryCount >= limits.maxEntries) {
      skipped.push({ name: archiveName, reason: '条目数超出上限' });
      return;
    }
    entryCount += 1;
    totalBytes += stat.size;
    files.push({ absolutePath, archiveName, size: stat.size, mtime: stat.mtime });
  };

  for (const source of sources) {
    if (shouldSkipSegment(path.basename(String(source.archiveName || '')))) {
      skipped.push({ name: source.archiveName, reason: '目标不允许打包' });
      continue;
    }
    walk(source.absolutePath, String(source.archiveName || path.basename(source.absolutePath)).replace(/\\/g, '/'));
  }

  return { files, directories, totalBytes, entryCount, skipped };
}

// sources: [{ absolutePath, archiveName }]；输出 zip 到 outputPath（须不存在）
export function buildZipArchive({ sources = [], outputPath = '', shouldSkipSegment = null, limits = {} } = {}) {
  const effectiveLimits = normalizeLimits(limits);
  const skip = typeof shouldSkipSegment === 'function' ? shouldSkipSegment : () => false;
  const skipped = [];
  const collected = collectSources(sources, { shouldSkipSegment: skip, limits: effectiveLimits, skipped });

  if (!collected.files.length && !collected.directories.length) {
    throw new Error('没有可打包的内容（全部被跳过）');
  }

  const localBlocks = [];
  const centralBlocks = [];
  let offset = 0;

  const pushEntry = ({ name, method, crc, compressedSize, uncompressedSize, dosTime, dosDate, isDirectory }) => {
    const nameBuffer = Buffer.from(name, 'utf8');
    const flags = 0x0800; // UTF-8 文件名
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    writeUint16(localHeader, 4, 20); // version needed
    writeUint16(localHeader, 6, flags);
    writeUint16(localHeader, 8, method);
    writeUint16(localHeader, 10, dosTime);
    writeUint16(localHeader, 12, dosDate);
    writeUint32(localHeader, 14, crc);
    writeUint32(localHeader, 18, compressedSize);
    writeUint32(localHeader, 22, uncompressedSize);
    writeUint16(localHeader, 26, nameBuffer.length);
    writeUint16(localHeader, 28, 0); // extra len
    nameBuffer.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    writeUint16(centralHeader, 4, 20); // version made by
    writeUint16(centralHeader, 6, 20); // version needed
    writeUint16(centralHeader, 8, flags);
    writeUint16(centralHeader, 10, method);
    writeUint16(centralHeader, 12, dosTime);
    writeUint16(centralHeader, 14, dosDate);
    writeUint32(centralHeader, 16, crc);
    writeUint32(centralHeader, 20, compressedSize);
    writeUint32(centralHeader, 24, uncompressedSize);
    writeUint16(centralHeader, 28, nameBuffer.length);
    writeUint16(centralHeader, 30, 0); // extra
    writeUint16(centralHeader, 32, 0); // comment
    writeUint16(centralHeader, 34, 0); // disk start
    writeUint16(centralHeader, 36, 0); // internal attrs
    writeUint32(centralHeader, 38, isDirectory ? 0x10 : 0); // external attrs
    writeUint32(centralHeader, 42, offset);
    nameBuffer.copy(centralHeader, 46);

    localBlocks.push(localHeader);
    if (!isDirectory && compressedSize > 0) {
      localBlocks.push(contentBuffers.get(name) ?? Buffer.alloc(0));
    }
    centralBlocks.push(centralHeader);
    offset += localHeader.length + (isDirectory ? 0 : compressedSize);
  };

  const contentBuffers = new Map();

  for (const directory of collected.directories) {
    const { dosTime, dosDate } = toDosDateTime(fs.statSync(directory.absolutePath).mtime);
    pushEntry({
      name: `${directory.archiveName}/`,
      method: 0,
      crc: 0,
      compressedSize: 0,
      uncompressedSize: 0,
      dosTime,
      dosDate,
      isDirectory: true,
    });
  }

  for (const file of collected.files) {
    const content = fs.readFileSync(file.absolutePath);
    const crc = crc32(content);
    const { dosTime, dosDate } = toDosDateTime(file.mtime);
    let method = 0; // stored
    let payload = content;
    if (content.length > 0) {
      try {
        const deflated = zlib.deflateRawSync(content, { level: 6 });
        if (deflated.length < content.length) {
          method = 8; // deflate
          payload = deflated;
        }
      } catch {
        // deflate 失败回退存储模式
      }
    }
    contentBuffers.set(file.archiveName, payload);
    pushEntry({
      name: file.archiveName,
      method,
      crc,
      compressedSize: payload.length,
      uncompressedSize: content.length,
      dosTime,
      dosDate,
      isDirectory: false,
    });
  }

  const centralSize = centralBlocks.reduce((sum, block) => sum + block.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  writeUint16(eocd, 8, centralBlocks.length);
  writeUint16(eocd, 10, centralBlocks.length);
  writeUint32(eocd, 12, centralSize);
  writeUint32(eocd, 16, offset);
  eocd.writeUInt16LE(0, 20);

  const output = Buffer.concat([...localBlocks.filter(Boolean), ...centralBlocks, eocd]);
  fs.writeFileSync(outputPath, output);
  contentBuffers.clear();

  return {
    sizeBytes: output.length,
    fileCount: collected.files.length,
    dirCount: collected.directories.length,
    totalUncompressedBytes: collected.totalBytes,
    skipped,
  };
}

// 解压 zip 到 outputDir（必须已存在且为空目录语义由调用方保证）。
// 防护：zip-slip 路径校验、拒绝绝对路径/盘符、跳过 shouldSkipSegment 命中的条目、
// 已存在的文件一律跳过（永不覆盖）、CRC 校验失败跳过并报告。
export function extractZipArchive({ archivePath = '', outputDir = '', shouldSkipSegment = null, limits = {} } = {}) {
  const effectiveLimits = normalizeLimits(limits);
  const skip = typeof shouldSkipSegment === 'function' ? shouldSkipSegment : () => false;
  const stat = fs.statSync(archivePath);
  if (stat.size > effectiveLimits.maxArchiveBytes) {
    throw new Error('压缩包大小超出解压上限');
  }
  const buffer = fs.readFileSync(archivePath);

  // 定位 End of Central Directory（注释最长 65535，从尾部扫描）
  let eocdOffset = -1;
  const scanStart = Math.max(0, buffer.length - 22 - 65535);
  for (let index = buffer.length - 22; index >= scanStart; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('不是有效的 ZIP 文件（未找到目录结束标记）');
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  const decodedName = (raw, flags) => (flags & 0x0800 ? raw.toString('utf8') : raw.toString('latin1'));
  const normalizeEntryPath = (name) => {
    const normalized = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (/^[a-zA-Z]:/.test(normalized) || normalized.includes('..')) {
      return { unsafe: true, value: normalized };
    }
    return { unsafe: false, value: path.posix.normalize(normalized) };
  };

  let fileCount = 0;
  let dirCount = 0;
  let totalExtractedBytes = 0;
  const skipped = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      skipped.push({ name: `#${index}`, reason: '目录损坏' });
      break;
    }
    const flags = buffer.readUInt16LE(centralOffset + 8);
    const method = buffer.readUInt16LE(centralOffset + 10);
    const expectedCrc = buffer.readUInt32LE(centralOffset + 16);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = decodedName(buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength), flags);
    centralOffset += 46 + nameLength + extraLength + commentLength;

    const entryPath = normalizeEntryPath(name);
    if (entryPath.unsafe || !entryPath.value) {
      skipped.push({ name, reason: '不安全的压缩路径' });
      continue;
    }
    const segments = entryPath.value.split('/').filter(Boolean);
    if (segments.some(segment => skip(segment))) {
      skipped.push({ name: entryPath.value, reason: '包含受保护目录或隐藏文件' });
      continue;
    }
    const isDirectory = entryPath.value.endsWith('/') || (flags & 0x10) !== 0;
    const targetPath = path.resolve(outputDir, ...segments);
    if (!isPathInsideRoot(targetPath, outputDir)) {
      skipped.push({ name: entryPath.value, reason: '解压路径越界' });
      continue;
    }

    if (isDirectory) {
      fs.mkdirSync(targetPath, { recursive: true });
      dirCount += 1;
      continue;
    }

    if (fs.existsSync(targetPath)) {
      skipped.push({ name: entryPath.value, reason: '目标已存在，未覆盖' });
      continue;
    }
    if (totalExtractedBytes + uncompressedSize > effectiveLimits.maxExtractTotalBytes) {
      skipped.push({ name: entryPath.value, reason: '解压总大小超出上限' });
      continue;
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    let content = null;
    if (method === 0) {
      content = buffer.subarray(dataStart, dataStart + compressedSize);
    } else if (method === 8) {
      try {
        content = zlib.inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize));
      } catch {
        skipped.push({ name: entryPath.value, reason: '解压数据损坏' });
        continue;
      }
    } else {
      skipped.push({ name: entryPath.value, reason: '不支持的压缩算法' });
      continue;
    }
    if (crc32(content) !== expectedCrc) {
      skipped.push({ name: entryPath.value, reason: 'CRC 校验失败' });
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
    totalExtractedBytes += content.length;
    fileCount += 1;
  }

  return { fileCount, dirCount, totalExtractedBytes, skipped };
}
