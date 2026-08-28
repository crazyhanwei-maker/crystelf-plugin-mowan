import { renderChangelogImage, buildChangelogText } from '../lib/system/changelogRenderer.js';

export class CrystelfChangelog extends plugin {
  constructor() {
    super({
      name: 'crystelf-changelog',
      dsc: '灵晶更新日志查看',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^#灵晶查看更新日志$',
          fnc: 'showChangelog',
        },
      ],
    });
  }

  async showChangelog(e) {
    try {
      const imagePath = await renderChangelogImage();
      if (imagePath) {
        return e.reply(segment.image(imagePath), true);
      }
    } catch (error) {
      logger.warn(`[crystelf-changelog] 更新日志图片渲染失败，回退文本: ${error.message}`);
    }
    return e.reply(buildChangelogText(), true);
  }
}
