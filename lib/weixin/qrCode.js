// 内置二维码编码器 + PNG 渲染（byte 模式，纠错级别 M/L，版本 1~9，掩码 0）
//
// 为什么自带而不用 npm 的 qrcode 包：微信 ilink 扫码登录依赖这一步，
// 而新机器上第三方依赖常缺失（实测遇到过 Cannot find package 'qrcode'），
// 一旦缺失整个登录流程就只剩一条不能扫描的链接。自带实现后零依赖可用。
//
// 实现依据 ISO/IEC 18004；正确性由 temp/test-qrcode.mjs 与 npm qrcode 包
// 在相同 版本/纠错级别/掩码 下逐模块比对（见该脚本）。
import zlib from 'zlib';

// 纠错级别的格式信息编码（非数据容量）
const EC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// 各版本每块的排布：[总码字数, 每块纠错码字, 组1块数, 组1数据码字, 组2块数, 组2数据码字]
const BLOCK_TABLE = {
  L: {
    1: [26, 7, 1, 19, 0, 0], 2: [44, 10, 1, 34, 0, 0], 3: [70, 15, 1, 55, 0, 0],
    4: [100, 20, 1, 80, 0, 0], 5: [134, 26, 1, 108, 0, 0], 6: [172, 18, 2, 68, 0, 0],
    7: [196, 20, 2, 78, 0, 0], 8: [242, 24, 2, 97, 0, 0], 9: [292, 30, 2, 116, 0, 0],
  },
  M: {
    1: [26, 10, 1, 16, 0, 0], 2: [44, 16, 1, 28, 0, 0], 3: [70, 26, 1, 44, 0, 0],
    4: [100, 18, 2, 32, 0, 0], 5: [134, 24, 2, 43, 0, 0], 6: [172, 16, 4, 27, 0, 0],
    7: [196, 18, 4, 31, 0, 0], 8: [242, 22, 2, 38, 2, 39], 9: [292, 22, 3, 36, 2, 37],
  },
};

// 校正图案中心坐标
const ALIGN_CENTERS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
};

// 版本信息（版本 7 起需要写入 18 位 BCH 码）
const VERSION_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99 };

const MAX_VERSION = 9;

// ── GF(256) 表：本原多项式 0x11D ──
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

// 生成多项式 (x - α^0)(x - α^1)...(x - α^(degree-1))
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// 对单个数据块计算纠错码字
function rsEncode(data, ecLength) {
  const gen = rsGenerator(ecLength);
  const result = new Uint8Array(ecLength);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[ecLength - 1] = 0;
    for (let i = 0; i < ecLength; i++) result[i] ^= gfMul(gen[i + 1], factor);
  }
  return result;
}

function pickVersion(byteLength, level) {
  const table = BLOCK_TABLE[level];
  for (let version = 1; version <= MAX_VERSION; version++) {
    const [, , g1Blocks, g1Data, g2Blocks, g2Data] = table[version];
    const dataCodewords = g1Blocks * g1Data + g2Blocks * g2Data;
    // 4 位模式指示 + 8 位长度（版本 1~9）+ 数据 + 至少 4 位结束符
    if (dataCodewords * 8 >= 4 + 8 + byteLength * 8 + 4) return version;
  }
  return 0;
}

// 组装最终码字序列（数据 + 纠错，按块交错）
function buildCodewords(bytes, version, level) {
  const [, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = BLOCK_TABLE[level][version];
  const totalDataCodewords = g1Blocks * g1Data + g2Blocks * g2Data;

  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);          // byte 模式
  push(bytes.length, 8);    // 字符计数（版本 1~9 为 8 位）
  for (const byte of bytes) push(byte, 8);
  for (let i = 0; i < 4 && bits.length < totalDataCodewords * 8; i++) bits.push(0); // 结束符
  while (bits.length % 8 !== 0) bits.push(0);                                      // 补齐字节
  const padBytes = [0xec, 0x11];
  for (let i = 0; bits.length < totalDataCodewords * 8; i++) push(padBytes[i % 2], 8);

  const dataCodewords = new Uint8Array(totalDataCodewords);
  for (let i = 0; i < dataCodewords.length; i++) {
    let value = 0;
    for (let b = 0; b < 8; b++) value = (value << 1) | bits[i * 8 + b];
    dataCodewords[i] = value;
  }

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  const sizes = [...Array(g1Blocks).fill(g1Data), ...Array(g2Blocks).fill(g2Data)];
  for (const size of sizes) {
    const block = dataCodewords.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }

  const result = [];
  const maxData = Math.max(...dataBlocks.map(block => block.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

// 构建模块矩阵：true = 深色
function buildMatrix(text, level = 'M') {
  const bytes = Array.from(Buffer.from(String(text || ''), 'utf8'));
  const version = pickVersion(bytes.length, level);
  if (!version) throw new Error(`二维码内容过长（${bytes.length} 字节），超出内置编码器支持范围`);
  return buildMatrixForVersion(bytes, version, level);
}

function buildMatrixForVersion(bytes, version, level) {
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setModule = (row, col, dark) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    matrix[row][col] = dark;
    reserved[row][col] = true;
  };

  // 定位图案 + 分隔符
  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setModule(row + r, col + c, inRing || inCore);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // 定时图案
  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }

  // 校正图案
  const centers = ALIGN_CENTERS[version] || [];
  for (const row of centers) {
    for (const col of centers) {
      // 与定位图案重叠的位置跳过
      const nearFinder = (row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8);
      if (nearFinder) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          setModule(row + r, col + c, dark);
        }
      }
    }
  }

  // 固定深色模块（必须在格式信息之后写入，否则会被格式位覆盖）
  setModule(size - 8, 8, true);

  // 格式信息占位：先把这 30 个格子标记为已占用，数据填充时跳过。
  // 注意不能顺手清掉第 6 行/第 6 列的定时图案
  const FORMAT_BIT_CELLS = [];
  for (let i = 0; i < 15; i++) {
    // 竖直条（第 8 列，含左上的 0~5 行与左下的 size-7~size-1 行）
    FORMAT_BIT_CELLS.push(i < 6 ? [i, 8] : (i < 8 ? [i + 1, 8] : [size - 15 + i, 8]));
    // 水平条（第 8 行，右侧 bits0~7、左侧 bits9~14、bit8 落在 (8,7)）
    FORMAT_BIT_CELLS.push(i < 8 ? [8, size - 1 - i] : (i < 9 ? [8, 7] : [8, 15 - i - 1]));
  }
  for (const [row, col] of FORMAT_BIT_CELLS) {
    if (row < size && col < size) {
      matrix[row][col] = false;
      reserved[row][col] = true;
    }
  }

  // 版本信息（版本 7 起）
  if (VERSION_INFO[version]) {
    const bits = VERSION_INFO[version];
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1;
      const row = Math.floor(i / 3);
      const col = i % 3;
      setModule(size - 11 + col, row, dark);
      setModule(row, size - 11 + col, dark);
    }
  }

  // 数据放置：自右下角起，两列一组蛇形填充，跳过第 6 列
  const codewords = buildCodewords(bytes, version, level);
  const dataBits = [];
  for (const codeword of codewords) {
    for (let i = 7; i >= 0; i--) dataBits.push((codeword >> i) & 1);
  }
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        const bit = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
        bitIndex += 1;
        matrix[row][col] = bit;
      }
    }
    upward = !upward;
  }

  // 掩码 0：(row + col) % 2 === 0 的模块取反（跳过功能模块）
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (reserved[row][col]) continue;
      if ((row + col) % 2 === 0) matrix[row][col] = !matrix[row][col];
    }
  }

  // 格式信息：纠错级别 + 掩码 0，BCH(15,5) + 固定掩码 0x5412
  const formatData = (EC_FORMAT_BITS[level] << 3) | 0;
  let formatBits = formatData << 10;
  for (let i = 14; i >= 10; i--) {
    if ((formatBits >> i) & 1) formatBits ^= 0x537 << (i - 10);
  }
  formatBits = ((formatData << 10) | formatBits) ^ 0x5412;

  for (let i = 0; i < 15; i++) {
    const dark = ((formatBits >> i) & 1) === 1;
    for (const [row, col] of [FORMAT_BIT_CELLS[i * 2], FORMAT_BIT_CELLS[i * 2 + 1]]) {
      if (row < size && col < size) matrix[row][col] = dark;
    }
  }
  // 固定深色模块（规格要求恒为深色，写在格式位之后避免被覆盖）
  matrix[size - 8][8] = true;

  return { size, matrix, version };
}

// ── 最小 PNG 编码（灰度 8 位），避免依赖 canvas/png 库 ──
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodeGrayscalePng(pixels, width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // 位深
  ihdr[9] = 0;   // 灰度
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // 过滤器：无
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 生成二维码 PNG 缓冲。
 * @param {string} text 内容
 * @param {{ scale?: number, width?: number, margin?: number, level?: 'L'|'M' }} options
 *   scale = 每模块像素（显式指定时优先）；width = 目标像素宽（按内容尺寸反推每模块像素）
 */
export function renderQrPng(text, { scale = 0, width = 480, margin = 4, level = 'M' } = {}) {
  const { size, matrix } = buildMatrix(text, level);
  const moduleCount = size + margin * 2;
  const moduleScale = scale > 0 ? Math.round(scale) : Math.max(2, Math.floor(width / moduleCount));
  const side = moduleCount * moduleScale;
  const pixels = Buffer.alloc(side * side, 0xff);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!matrix[row][col]) continue;
      const startY = (row + margin) * moduleScale;
      const startX = (col + margin) * moduleScale;
      for (let y = 0; y < moduleScale; y++) {
        pixels.fill(0x00, (startY + y) * side + startX, (startY + y) * side + startX + moduleScale);
      }
    }
  }
  return encodeGrayscalePng(pixels, side, side);
}

export { buildMatrix };
export default { renderQrPng, buildMatrix };
