// 资源水位看门狗：周期检查磁盘 / 进程内存 / Redis 内存，超过阈值时通过 QQ（persist 队列）+ 邮件告警。
// 阈值可配置（diskPercent / memoryPercent / redisPercent），持续超限每 REMIND_INTERVAL_MS 重提醒一次，恢复后推送解除通知。
import fsSync from 'fs';
import os from 'os';

const CHECK_INTERVAL_MS = 10 * 60 * 1000;   // 常态每 10 分钟检查一次
const REMIND_INTERVAL_MS = 6 * 60 * 60 * 1000; // 持续超限最多 6 小时重提醒一次
const BOOT_GRACE_MS = 3 * 60 * 1000;

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function collectDiskUsage() {
  if (typeof fsSync.statfsSync !== 'function') return [];
  const candidates = process.platform === 'win32'
    ? Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:/`)
    : ['/', '/boot', '/data', '/home', '/www', '/opt'];
  const disks = [];
  const seenDevices = new Set();
  for (const mount of candidates) {
    try {
      const dev = fsSync.statSync(mount).dev;
      if (seenDevices.has(dev)) continue;
      seenDevices.add(dev);
      const stat = fsSync.statfsSync(mount);
      const blockSize = Number(stat.bsize || 0);
      const totalBytes = Number(stat.blocks || 0) * blockSize;
      const freeBytes = Number(stat.bfree || 0) * blockSize;
      if (!totalBytes) continue;
      const usedBytes = Math.max(totalBytes - freeBytes, 0);
      disks.push({
        mount: process.platform === 'win32' ? mount.replace(/[\/]+$/, '') : mount,
        totalBytes,
        percent: Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100))),
        usedBytes,
      });
    } catch {
      // 挂载点不存在或无权限，跳过
    }
  }
  return disks.sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 4);
}

// RSS 相对系统总内存的百分比需要系统信息；进程 RSS 只做展示，水位按系统整体内存计算。
function collectSystemMemoryPercent() {
  try {
    const total = Number(os.totalmem?.() || 0);
    const free = Number(os.freemem?.() || 0);
    if (!total) return null;
    const used = Math.max(total - free, 0);
    return { percent: Math.min(100, Math.round((used / total) * 100)), total, used };
  } catch {
    return null;
  }
}

async function collectRedisUsage() {
  const redis = typeof globalThis !== 'undefined' ? globalThis.redis : null;
  if (!redis || typeof redis.info !== 'function') return null;
  try {
    const raw = await redis.info('memory');
    const lines = String(raw || '').split(/\r?\n/);
    let used = 0;
    let max = 0;
    let policy = '';
    for (const line of lines) {
      if (line.startsWith('used_memory:')) used = Number(line.split(':')[1]) || 0;
      else if (line.startsWith('maxmemory:')) max = Number(line.split(':')[1]) || 0;
      else if (line.startsWith('maxmemory_policy:')) policy = line.split(':')[1]?.trim() || '';
    }
    if (!used) return null;
    // maxmemory=0 表示未限制，此时水位无法按百分比衡量，返回绝对用量
    const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : -1;
    return { usedBytes: used, maxBytes: max, percent, policy };
  } catch {
    return null;
  }
}

function buildAlertLines(kind, entries = []) {
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines = [`🚨 灵晶资源水位告警（${kind}）`, '━━━━━━━━━━━━━━━━━━', `时间：${now}`];
  for (const entry of entries) {
    lines.push(`  ${entry}`);
  }
  lines.push('', '请及时清理或扩容，持续超限会定期重提醒。');
  return lines.join('\n');
}

function buildRecoverLines(kind, entries = []) {
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines = [`✅ 灵晶资源水位恢复正常（${kind}）`, '━━━━━━━━━━━━━━━━━━', `时间：${now}`];
  for (const entry of entries) {
    lines.push(`  ${entry}`);
  }
  return lines.join('\n');
}

export function createResourceWatchdog(options = {}) {
  const logger = options.logger || { warn: () => {}, mark: () => {}, info: () => {} };
  const notifyMasters = typeof options.notifyMasters === 'function' ? options.notifyMasters : null;
  const sendAlertEmail = typeof options.sendAlertEmail === 'function' ? options.sendAlertEmail : null;
  const getThresholds = typeof options.getThresholds === 'function'
    ? options.getThresholds
    : () => ({ diskPercent: 90, memoryPercent: 90, redisPercent: 90 });
  const getEnabled = typeof options.getEnabled === 'function' ? options.getEnabled : () => true;

  const state = {
    timer: null,
    startedAt: 0,
    // activeAlerts: kind -> { lastRemindAt }
    activeAlerts: new Map(),
    // 最近一次评估结果（晨报等消费方同步读取）
    lastEvaluation: null,
  };

  function normalizeThresholds() {
    const raw = getThresholds() || {};
    const readPercent = (value, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) && num >= 50 && num <= 100 ? Math.round(num) : fallback;
    };
    return {
      diskPercent: readPercent(raw.diskPercent, 90),
      memoryPercent: readPercent(raw.memoryPercent, 90),
      redisPercent: readPercent(raw.redisPercent, 90),
    };
  }

  async function evaluate() {
    const thresholds = normalizeThresholds();
    const alerts = [];
    const normal = [];

    for (const disk of collectDiskUsage()) {
      if (disk.percent >= thresholds.diskPercent) {
        alerts.push(`磁盘 ${disk.mount}：${disk.percent}%（阈值 ${thresholds.diskPercent}%，总 ${formatBytes(disk.totalBytes)}）`);
      } else {
        normal.push(`磁盘 ${disk.mount}：${disk.percent}%`);
      }
    }

    const mem = collectSystemMemoryPercent();
    if (mem && mem.percent >= thresholds.memoryPercent) {
      alerts.push(`系统内存：${mem.percent}%（阈值 ${thresholds.memoryPercent}%，已用 ${formatBytes(mem.used)} / ${formatBytes(mem.total)}）`);
    } else if (mem) {
      normal.push(`系统内存：${mem.percent}%`);
    }

    const redisUsage = await collectRedisUsage();
    if (redisUsage && redisUsage.percent >= 0 && redisUsage.percent >= thresholds.redisPercent) {
      const policyText = redisUsage.policy === 'noeviction' ? '，淘汰策略 noeviction（写满会报错）' : '';
      alerts.push(`Redis 内存：${redisUsage.percent}%（阈值 ${thresholds.redisPercent}%，已用 ${formatBytes(redisUsage.usedBytes)}${redisUsage.maxBytes ? ` / 上限 ${formatBytes(redisUsage.maxBytes)}` : ''}${policyText}）`);
    } else if (redisUsage) {
      normal.push(redisUsage.percent >= 0 ? `Redis 内存：${redisUsage.percent}%` : `Redis 内存：${formatBytes(redisUsage.usedBytes)}（未设上限）`);
    }

    const result = { thresholds, alerts, normal, evaluatedAt: Date.now() };
    // 缓存最近一次评估（晨报等消费方同步读取）
    state.lastEvaluation = result;
    return result;
  }

  async function check() {
    const kind = '磁盘/内存/Redis';
    const { alerts } = await evaluate();

    if (alerts.length > 0) {
      const active = state.activeAlerts.get(kind);
      const now = Date.now();
      if (!active) {
        state.activeAlerts.set(kind, { lastRemindAt: now });
        logger.warn(`[resource-watchdog] 水位告警：${alerts.join('；')}`);
        notifyMasters?.(buildAlertLines(kind, alerts), { label: '资源水位告警', persist: true });
        sendAlertEmail?.(`🚨 灵晶资源水位告警（${kind}）`, buildAlertLines(kind, alerts));
      } else if (now - active.lastRemindAt >= REMIND_INTERVAL_MS) {
        active.lastRemindAt = now;
        logger.warn(`[resource-watchdog] 水位持续告警（重提醒）：${alerts.join('；')}`);
        notifyMasters?.(buildAlertLines(kind, alerts), { label: '资源水位重提醒', persist: true });
      }
      return;
    }

    if (state.activeAlerts.has(kind)) {
      state.activeAlerts.delete(kind);
      logger.mark('[resource-watchdog] 资源水位恢复正常');
      notifyMasters?.(buildRecoverLines(kind), { label: '资源水位恢复', persist: true });
    }
  }

  function start() {
    if (state.timer || getEnabled() === false) return;
    state.startedAt = Date.now();
    state.timer = setInterval(() => {
      // 启动宽限期内跳过，避免冷启动高内存误报
      if (Date.now() - state.startedAt < BOOT_GRACE_MS) return;
      check().catch(error => {
        logger.warn(`[resource-watchdog] 检查异常: ${error.message}`);
      });
    }, CHECK_INTERVAL_MS);
  }

  function stop() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function buildStatusPayload() {
    return {
      enabled: getEnabled() !== false,
      running: Boolean(state.timer),
      thresholds: normalizeThresholds(),
      activeAlerts: Array.from(state.activeAlerts.keys()),
    };
  }

  // 手动触发一次检查（QQ 命令 / API 用），返回评估结果不告警
  async function inspectNow() {
    return evaluate();
  }

  return { start, stop, check, inspectNow, buildStatusPayload };
}
