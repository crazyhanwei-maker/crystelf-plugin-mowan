// 体检报告：聚合启动自检 / 接口健康 / 依赖检查为一份可分享的纯文本报告。
// 面向"用户把报告贴给插件作者排查"的场景，脱敏由各数据源保证（自检不含密钥、健康项不含 URL 明文）。
import Version from '../system/version.js';
import os from 'os';

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatLineTime(iso = '') {
  const time = new Date(iso || 0);
  if (!iso || Number.isNaN(time.getTime())) return '—';
  return time.toLocaleString('zh-CN', { hour12: false });
}

export function createHealthReportConsole(options = {}) {
  const getStartupSelfCheckSnapshot = typeof options.getStartupSelfCheckSnapshot === 'function'
    ? options.getStartupSelfCheckSnapshot
    : null;
  const buildStartupSelfCheckPayload = typeof options.buildStartupSelfCheckPayload === 'function'
    ? options.buildStartupSelfCheckPayload
    : null;
  const buildHealthPayload = typeof options.buildHealthPayload === 'function'
    ? options.buildHealthPayload
    : null;
  const buildDependencyReport = typeof options.buildDependencyReport === 'function'
    ? options.buildDependencyReport
    : null;
  const getWebConsoleInfo = typeof options.getWebConsoleInfo === 'function' ? options.getWebConsoleInfo : () => null;

  async function buildHealthReportPayload() {
    // 启动时的自检带着真实运行上下文（口令/端口/监听地址），比现场重建更准确；快照缺失才退回现场构建。
    const snapshot = typeof getStartupSelfCheckSnapshot === 'function' ? getStartupSelfCheckSnapshot() : null;
    const [selfCheck, health, dependency] = await Promise.all([
      Promise.resolve(snapshot || (buildStartupSelfCheckPayload ? buildStartupSelfCheckPayload({}) : null)).catch(() => null),
      Promise.resolve(buildHealthPayload ? buildHealthPayload() : null).catch(() => null),
      Promise.resolve(buildDependencyReport ? buildDependencyReport() : null).catch(() => null),
    ]);

    const checkSummary = selfCheck?.summary || { status: 'unknown', checks: 0, errors: 0, warnings: 0 };
    const healthItems = Array.isArray(health?.items) ? health.items : [];
    const healthOk = healthItems.filter(item => item.tone === 'success' || item.status === 'ok').length;
    const overall = (checkSummary.status === 'error')
      ? 'error'
      : (checkSummary.status === 'warn' || healthOk < healthItems.length || dependency?.summary?.problemCount > 0)
        ? 'warn'
        : 'healthy';

    return {
      success: true,
      generatedAt: new Date().toISOString(),
      overall,
      sections: {
        selfCheck: { summary: checkSummary, checks: Array.isArray(selfCheck?.checks) ? selfCheck.checks : [] },
        health: { items: healthItems, okCount: healthOk },
        dependency: {
          summary: dependency?.summary || {},
          problems: Array.isArray(dependency?.problems) ? dependency.problems : [],
        },
      },
    };
  }

  function renderReportText(payload = {}) {
    const { overall, generatedAt, sections = {} } = payload;
    const selfCheck = sections.selfCheck || {};
    const health = sections.health || {};
    const dependency = sections.dependency || {};
    const memory = process.memoryUsage();
    const info = getWebConsoleInfo() || {};
    const lines = [];

    lines.push('🩺 灵晶插件体检报告');
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push(`生成时间：${formatLineTime(generatedAt)}`);
    lines.push(`插件版本：${Version.name} v${Version.ver}`);
    lines.push(`运行环境：Node ${process.version} / ${process.platform} ${process.arch} / 开机 ${Math.round(os.uptime() / 3600)} 小时`);
    lines.push(`进程：PID ${process.pid} / RSS ${formatBytes(memory.rss)}`);
    lines.push(`控制台：${info.url ? `${info.url}（${info.authTokenGenerated ? '口令已自动生成' : '口令已配置'}）` : '未运行'}`);
    const overallLabel = overall === 'healthy' ? '✅ 健康' : overall === 'warn' ? '⚠️ 有告警' : '❌ 有错误';
    lines.push(`总体结论：${overallLabel}`);

    lines.push('');
    lines.push('── 启动自检 ──');
    const checks = Array.isArray(selfCheck.checks) ? selfCheck.checks : [];
    const summary = selfCheck.summary || {};
    lines.push(`结论 ${summary.status || '-'}：${summary.okCount || 0} 项通过 / ${summary.warnCount || 0} 项告警 / ${summary.errorCount || 0} 项错误（共 ${summary.checkCount || checks.length} 项）`);
    for (const item of checks) {
      const marker = item.status === 'error' ? '✗' : item.status === 'warn' ? '!' : '✓';
      lines.push(`  ${marker} ${item.label}：${item.detail || '-'}`);
    }

    lines.push('');
    lines.push('── 接口健康 ──');
    const healthItems = Array.isArray(health.items) ? health.items : [];
    if (!healthItems.length) {
      lines.push('  暂无接口健康数据');
    } else {
      for (const item of healthItems) {
        const ok = item.tone === 'success' || item.status === 'ok';
        lines.push(`  ${ok ? '✓' : '!'} ${item.label}：${item.text || item.detail || (ok ? '正常' : '需要检查')}`);
      }
    }

    lines.push('');
    lines.push('── 依赖检查 ──');
    const depSummary = dependency.summary || {};
    lines.push(`依赖 ${depSummary.totalCount || 0} 个，问题 ${depSummary.problemCount || 0} 个` + (depSummary.runtimeMissingCount ? `（运行时缺失 ${depSummary.runtimeMissingCount}）` : ''));
    const problems = Array.isArray(dependency.problems) ? dependency.problems.slice(0, 8) : [];
    for (const problem of problems) {
      lines.push(`  ✗ ${problem.name || problem.package || '-'}：${problem.detail || problem.message || problem.status || '-'}`);
    }
    if (!problems.length && (depSummary.problemCount || 0) > 0) {
      lines.push('  （详见控制台依赖检查页）');
    }

    lines.push('');
    lines.push('报告由魔丸控制台生成，可直接转发给维护者协助排查。');
    return lines.join('\n');
  }

  async function buildHealthReportTextPayload() {
    const payload = await buildHealthReportPayload();
    return {
      success: true,
      text: renderReportText(payload),
    };
  }

  return {
    buildHealthReportPayload,
    buildHealthReportTextPayload,
  };
}
