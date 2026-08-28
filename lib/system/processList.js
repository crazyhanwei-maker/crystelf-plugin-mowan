import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

// 拒绝杀死的进程：bot 自身、系统关键进程
function isProtectedProcess(item = {}) {
  const pid = Number(item.pid || 0);
  if (!pid || pid <= 4) return true;
  if (pid === process.pid) return true;
  const name = String(item.name || '').toLowerCase();
  const protectedNames = [
    'system',
    'registry',
    'smss.exe',
    'csrss.exe',
    'wininit.exe',
    'winlogon.exe',
    'services.exe',
    'lsass.exe',
    'svchost.exe',
    'explorer.exe',
    'kernel_task',
    'launchd',
    'systemd',
    'init',
    'kthreadd',
    'sshd',
  ];
  return protectedNames.some(protectedName => name === protectedName || name === `${protectedName}.exe`);
}

export async function killSystemProcess({ pid = 0 } = {}) {
  const targetPid = Number(pid);
  if (!Number.isInteger(targetPid) || targetPid <= 0) {
    throw new Error('无效的进程 PID');
  }

  const processes = await listSystemProcesses({ query: '', limit: 1000 });
  const target = (processes.items || []).find(item => Number(item.pid) === targetPid);
  if (!target) {
    throw new Error('进程不存在或已退出');
  }
  if (isProtectedProcess(target)) {
    throw new Error(`禁止结束受保护进程：${target.name}（PID ${target.pid}）`);
  }

  const platform = os.platform();
  const command = platform === 'win32'
    ? { file: 'taskkill', args: ['/PID', String(targetPid), '/F', '/T'] }
    : { file: 'kill', args: ['-9', String(targetPid)] };

  try {
    await execFileAsync(command.file, command.args, {
      windowsHide: true,
      timeout: 15000,
    });
  } catch (error) {
    const message = String(error.message || error);
    // Windows 下 taskkill 失败时 stderr 会带进程名，尽量给出可读原因
    throw new Error(`结束进程失败：${message.split('\n')[0].slice(0, 160)}`);
  }

  return {
    success: true,
    pid: targetPid,
    name: target.name,
  };
}

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
