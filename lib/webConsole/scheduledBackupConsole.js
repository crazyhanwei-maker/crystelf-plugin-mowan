// 定时配置备份：每日将运行配置目录整体快照到 data/crystelf/backups/，按份数轮转。
// 备份直接复制配置 JSON（含密钥，本地文件不做脱敏——恢复入口本身要求同机），与手动导出互补。
import fsSync from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const DAY_MS = 24 * 60 * 60 * 1000;

function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createScheduledBackupConsole(options = {}) {
  const configDir = options.configDir || '';
  const backupDir = options.backupDir || '';
  const logger = options.logger || { warn: () => {}, mark: () => {} };
  const getRetentionCount = typeof options.getRetentionCount === 'function'
    ? options.getRetentionCount
    : () => 7;
  const getEnabled = typeof options.getEnabled === 'function' ? options.getEnabled : () => true;

  const state = {
    timer: null,
    lastRunAt: 0,
    lastResult: null,
    lastError: '',
  };

  function listBackups() {
    try {
      return fsSync.readdirSync(backupDir)
        .filter(name => name.startsWith('config-backup-'))
        .map(name => {
          const filePath = path.join(backupDir, name);
          const stat = fsSync.statSync(filePath);
          // 备份是目录，大小取内部 JSON 合计
          let sizeBytes = 0;
          if (stat.isDirectory()) {
            for (const child of fsSync.readdirSync(filePath)) {
              try {
                sizeBytes += fsSync.statSync(path.join(filePath, child)).size;
              } catch {}
            }
          } else {
            sizeBytes = stat.size;
          }
          return { name, sizeBytes, time: stat.mtimeMs };
        })
        .sort((a, b) => b.time - a.time);
    } catch {
      return [];
    }
  }

  async function runBackup({ trigger = 'scheduled' } = {}) {
    if (!configDir || !backupDir) {
      state.lastError = '备份目录未配置';
      return { success: false, error: state.lastError };
    }
    try {
      await fsp.mkdir(backupDir, { recursive: true });
      const stamp = `${getLocalDateKey()}-${new Date().toTimeString().slice(0, 5).replace(':', '')}`;
      const targetDir = path.join(backupDir, `config-backup-${stamp}`);
      await fsp.mkdir(targetDir, { recursive: true });

      let copiedCount = 0;
      let totalBytes = 0;
      const files = await fsp.readdir(configDir).catch(() => []);
      for (const name of files) {
        if (!name.endsWith('.json')) continue;
        const source = path.join(configDir, name);
        const stat = await fsp.stat(source).catch(() => null);
        if (!stat?.isFile()) continue;
        await fsp.copyFile(source, path.join(targetDir, name));
        copiedCount += 1;
        totalBytes += stat.size;
      }

      if (copiedCount === 0) {
        await fsp.rm(targetDir, { recursive: true, force: true }).catch(() => {});
        throw new Error('配置目录内没有可备份的 JSON 文件');
      }

      // 轮转：同一触发批次只做一次清理，超出保留份数的旧备份删除
      const retention = Math.max(1, Number(getRetentionCount()) || 7);
      const backups = fsSync.readdirSync(backupDir)
        .filter(name => name.startsWith('config-backup-'))
        .map(name => ({ name, time: fsSync.statSync(path.join(backupDir, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
      let removed = 0;
      for (const item of backups.slice(retention)) {
        await fsp.rm(path.join(backupDir, item.name), { recursive: true, force: true }).catch(() => {});
        removed += 1;
      }

      state.lastRunAt = Date.now();
      state.lastResult = {
        trigger,
        stamp,
        fileCount: copiedCount,
        totalBytes,
        removed,
        retention,
      };
      state.lastError = '';
      logger.mark?.(`[webConsole] 已完成定时配置备份：${copiedCount} 个文件 / ${Math.round(totalBytes / 1024)}KB${removed ? `，清理 ${removed} 份旧备份` : ''}`);
      return { success: true, ...state.lastResult };
    } catch (error) {
      state.lastError = error.message || '备份失败';
      logger.warn?.(`[webConsole] 定时配置备份失败: ${state.lastError}`);
      return { success: false, error: state.lastError };
    }
  }

  function shouldRunNow() {
    if (getEnabled() === false) return false;
    const todayKey = getLocalDateKey();
    const lastKey = state.lastRunAt ? getLocalDateKey(new Date(state.lastRunAt)) : '';
    return todayKey !== lastKey;
  }

  function start() {
    if (state.timer) return;
    // 每小时检查一次"今天备份了吗"，跨天首次命中即执行；错过整天（如停机）则启动后补一次
    state.timer = setInterval(() => {
      if (shouldRunNow()) {
        runBackup({ trigger: 'scheduled' }).catch(() => {});
      }
    }, 60 * 60 * 1000);
    setTimeout(() => {
      if (shouldRunNow()) {
        runBackup({ trigger: 'startup' }).catch(() => {});
      }
    }, 30 * 1000);
  }

  function stop() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function buildScheduledBackupTaskPayload() {
    const backups = listBackups();
    const enabled = getEnabled() !== false;
    const nextCheckAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const latest = backups[0] || null;
    return {
      id: 'scheduled-config-backup',
      name: '配置定时备份',
      description: `每天自动把运行配置整体快照到 ${backupDir ? 'backups 目录' : '（未配置）'}，保留 ${Math.max(1, Number(getRetentionCount()) || 7)} 份，用于误改回滚。`,
      schedule: '每日一次（跨天首查触发，错过整天会在启动后补做）',
      nextRunAt: enabled ? nextCheckAt : '',
      status: enabled ? 'enabled' : 'disabled',
      statusLabel: enabled ? (latest ? `已有 ${backups.length} 份备份` : '已启用（尚未产生备份）') : '已停用',
      detail: {
        enabledGroups: enabled ? `备份 ${backups.length} 份` : '已停用',
        sentToday: latest ? Math.max(1, backups.filter(item => getLocalDateKey(new Date(item.time)) === getLocalDateKey()).length) : 0,
        retentionDays: Math.max(1, Number(getRetentionCount()) || 7),
      },
      recentRuns: state.lastResult
        ? [{ time: new Date(state.lastRunAt).toISOString(), groupId: '', groupName: state.lastResult.stamp, status: state.lastResult.success === false ? 'failed' : 'sent' }]
        : [],
      manual: {
        supported: true,
        action: 'run-scheduled-backup',
        label: '立即备份一次',
      },
    };
  }

  return {
    start,
    stop,
    runBackup,
    listBackups,
    buildScheduledBackupTaskPayload,
  };
}
