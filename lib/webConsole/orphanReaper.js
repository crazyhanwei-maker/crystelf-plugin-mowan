// 孤儿 opencode 进程回收。
// 背景：opencode serve 是 Yunzai 的子进程，每次 pm2 restart 都会把它们留成 PPID=1 的孤儿；
// 插件内存态的运行时注册表重启后不认识这些孤儿，空闲回收（runtimeIdleTimeoutMs）够不着，
// 于是一个个堆积（每个约 500MB RSS）。本模块在插件启动时扫描一次并回收。
//
// 识别条件（全部满足才杀，宁可漏杀不可误杀）：
//   1. 仅 Linux（Windows 开发机跳过）；
//   2. PPID === 1（父进程已死，即孤儿）；
//   3. 命令行包含本插件 node_modules 下的 opencode-ai 运行时；
//   4. 是 serve 常驻进程；
//   5. 存活超过 60 秒（避免与刚拉起的实例竞态）。
// 注意：若同一插件目录被多个 Yunzai 实例共享，实例 B 启动会回收实例 A 的 serve——
// 当前部署不存在这种形态，如未来出现需先排除本机其他 Yunzai 进程的子进程。
import { execFileSync } from 'child_process';

export function reapOrphanOpenCodeServers({ pluginRoot = '', logger = console } = {}) {
  const empty = { scanned: false, killed: [] };
  if (process.platform !== 'linux') return empty;
  const rootToken = String(pluginRoot || '').replace(/\/+$/, '');
  if (!rootToken) return empty;

  let lines = '';
  try {
    lines = execFileSync('ps', ['-eo', 'pid,ppid,etimes,args', '--no-headers'], { timeout: 5000, encoding: 'utf8' });
  } catch (error) {
    logger.warn?.(`[orphan-reaper] 进程扫描失败（跳过回收）：${error.message}`);
    return empty;
  }

  const candidates = [];
  for (const line of lines.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const etimes = Number(parts[2]);
    const args = parts.slice(3).join(' ');
    if (!Number.isInteger(pid) || pid <= 1) continue;
    if (ppid !== 1) continue;
    if (!args.includes(`${rootToken}/node_modules/opencode-ai`)) continue;
    if (!args.includes(' serve ')) continue;
    if (!Number.isFinite(etimes) || etimes < 60) continue;
    candidates.push(pid);
  }

  const killed = [];
  for (const pid of candidates) {
    try {
      process.kill(pid, 'SIGTERM');
      killed.push(pid);
    } catch (error) {
      logger.warn?.(`[orphan-reaper] SIGTERM ${pid} 失败：${error.message}`);
    }
  }

  if (killed.length) {
    logger.warn?.(`[orphan-reaper] 已回收 ${killed.length} 个孤儿 opencode 进程（PID：${killed.join(', ')}），5 秒后复查强杀`);
    const recheck = setTimeout(() => {
      for (const pid of killed) {
        try {
          process.kill(pid, 0); // 仍存活
          try {
            process.kill(pid, 'SIGKILL');
            logger.warn?.(`[orphan-reaper] ${pid} 未响应 SIGTERM，已 SIGKILL`);
          } catch { }
        } catch { } // 已自行退出
      }
    }, 5000);
    recheck.unref?.();
  }

  return { scanned: true, killed };
}
