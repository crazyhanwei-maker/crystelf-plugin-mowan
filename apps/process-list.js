import Version from '../lib/system/version.js';
import { listSystemProcesses } from '../lib/system/processList.js';
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
      dsc: '灵晶系统进程查看',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^#查看进程(\\s+[\\s\\S]+)?$',
          fnc: 'showProcessList',
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
}
