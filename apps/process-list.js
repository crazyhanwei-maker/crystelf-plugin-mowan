import Version from '../lib/system/version.js';
import { listSystemProcesses, killSystemProcess } from '../lib/system/processList.js';
import { renderProcessListImage } from '../lib/system/processListImageRenderer.js';

function buildProcessText(data = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  const lines = ['系统进程列表（按内存降序）', '━━━━━━━━━━━━'];
  for (const item of items.slice(0, 30)) {
    const cpu = item.cpuPercent === null || item.cpuPercent === undefined
      ? '—'
      : `${item.cpuPercent}%`;
    lines.push(`${item.pid}  ${item.name}  ${item.memoryMB}MB  CPU ${cpu}`);
  }
  if (items.length > 30) lines.push(`……其余 ${items.length - 30} 个进程见图片`);
  lines.push(`共 ${data.total ?? items.length} 个进程`);
  lines.push(`生成时间：${data.generatedAt || ''}`);
  return lines.join('\n');
}

export class CrystelfProcessList extends plugin {
  constructor() {
    super({
      name: 'crystelf-process-list',
      dsc: '灵晶系统进程查看与管理',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^#查看进程(\\s+[\\s\\S]+)?$',
          fnc: 'showProcessList',
        },
        {
          reg: '^#[杀死结束]{1,2}(进程)?\\s*(?:PID\\s*)?([1-9]\\d{1,9})\\s*$',
          fnc: 'killProcess',
        },
      ],
    });
  }

  async showProcessList(e) {
    if (!e.isMaster) {
      return e.reply('该命令仅限主人使用。', true);
    }

    const match = String(e.msg || '').match(/^#查看进程(?:\s+([\s\S]+))?$/);
    const query = match?.[1]?.trim() || '';

    let data;
    try {
      data = await listSystemProcesses({ query, limit: 60 });
    } catch (error) {
      logger.error(`[crystelf-process] 进程列表读取失败: ${error.message}`);
      return e.reply(`进程列表读取失败：${error.message}`, true);
    }
    data.query = query;

    try {
      const imagePath = await renderProcessListImage(data);
      if (imagePath) {
        return e.reply(segment.image(imagePath), true);
      }
    } catch (error) {
      logger.warn(`[crystelf-process] 进程图片渲染失败，回退文本: ${error.message}`);
    }
    return e.reply(buildProcessText(data), true);
  }

  async killProcess(e) {
    if (!e.isMaster) {
      return e.reply('该命令仅限主人使用。', true);
    }

    const match = String(e.msg || '').match(/^#[杀死结束]{1,2}(?:进程)?\s*(?:PID\s*)?([1-9]\d{1,9})\s*$/);
    const pid = Number(match?.[1] || 0);
    if (!pid) {
      return e.reply('用法：#杀死PID 1234（先用 #查看进程 查 PID）', true);
    }

    // 先查进程信息用于确认展示，查不到说明已退出
    let target = null;
    try {
      const list = await listSystemProcesses({ query: '', limit: 1000 });
      target = (list.items || []).find(item => Number(item.pid) === pid) || null;
    } catch (error) {
      logger.warn(`[crystelf-process] 结束前查询进程失败: ${error.message}`);
    }

    if (!target) {
      return e.reply(`未找到 PID ${pid} 对应的进程，可能已退出。可先发 #查看进程 核对。`, true);
    }

    try {
      const result = await killSystemProcess({ pid });
      logger.mark(`[crystelf-process] 主人 ${e.user_id} 结束进程: PID ${pid} (${result.name})`);
      return e.reply(`已结束进程：${result.name}（PID ${result.pid}）`, true);
    } catch (error) {
      return e.reply(`结束进程失败：${error.message}`, true);
    }
  }
}
