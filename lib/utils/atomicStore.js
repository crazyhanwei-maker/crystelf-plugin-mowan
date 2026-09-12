// 原子化 JSON 文件写入工具：
// - writeJsonAtomic：临时文件 + rename，写一半崩溃不会损坏原文件
// - 可选防抖：高频写入（聊天库、任务库等）在窗口期内合并为最后一次
import fs from 'node:fs';
import path from 'node:path';

const pendingWrites = new Map();

export function writeFileAtomic(filePath, content) {
  const tmpPath = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function writeJsonAtomic(filePath, value, options = {}) {
  const debounceMs = Math.max(0, Number(options.debounceMs) || 0);
  const pretty = options.pretty === true;
  const content = JSON.stringify(value, null, pretty ? 2 : 0);
  if (debounceMs <= 0) {
    const pending = pendingWrites.get(filePath);
    if (pending) {
      clearTimeout(pending.timer);
      pendingWrites.delete(filePath);
    }
    writeFileAtomic(filePath, content);
    return;
  }
  const existing = pendingWrites.get(filePath);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pendingWrites.delete(filePath);
    try {
      writeFileAtomic(filePath, content);
    } catch (error) {
      const logger = globalThis.logger;
      if (logger?.warn) logger.warn(`[atomic-store] 写入 ${path.basename(filePath)} 失败: ${error.message}`);
      else console.warn(`[atomic-store] 写入 ${path.basename(filePath)} 失败: ${error.message}`);
    }
  }, debounceMs);
  pendingWrites.set(filePath, { timer, content });
}

// 立即落盘指定文件的待写内容（关停前兜底用）
export function flushJsonAtomic(filePath) {
  const pending = pendingWrites.get(filePath);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingWrites.delete(filePath);
  writeFileAtomic(filePath, pending.content);
  return true;
}
