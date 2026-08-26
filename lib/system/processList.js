import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

function parseCsvLine(line = '') {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (const char of String(line || '')) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export async function listSystemProcesses({ query = '', limit = 400 } = {}) {
  const platform = os.platform();
  const items = [];
  if (platform === 'win32') {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15000,
    });
    stdout.split(/\r?\n/).filter(Boolean).forEach(line => {
      const [name, pid, , , memoryText] = parseCsvLine(line);
      if (!name || name === '映像名称' || name === 'Image Name') return;
      const memoryKb = Number(String(memoryText || '').replace(/[^\d.]/g, '')) || 0;
      items.push({
        pid: Number(pid) || 0,
        name: String(name || '').trim(),
        cpuPercent: null,
        memoryMB: Math.round((memoryKb / 1024) * 10) / 10,
      });
    });
  } else {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,pcpu=,pmem=,rss=,comm='], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15000,
    });
    stdout.split(/\r?\n/).filter(Boolean).forEach(line => {
      const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
      if (!match) return;
      items.push({
        pid: Number(match[1]) || 0,
        name: match[5].trim(),
        cpuPercent: Math.round(Number(match[2]) * 10) / 10,
        memoryMB: Math.round((Number(match[4]) / 1024) * 10) / 10,
      });
    });
  }
  items.sort((left, right) => (right.memoryMB || 0) - (left.memoryMB || 0));
  const keyword = String(query || '').trim().toLowerCase();
  const filtered = keyword
    ? items.filter(item => item.name.toLowerCase().includes(keyword) || String(item.pid).includes(keyword))
    : items;
  const max = Math.max(1, Math.min(1000, Number(limit) || 400));
  return {
    success: true,
    readOnly: true,
    platform,
    total: filtered.length,
    items: filtered.slice(0, max),
    generatedAt: new Date().toISOString(),
  };
}
