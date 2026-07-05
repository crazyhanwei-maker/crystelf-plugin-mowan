import fs from 'fs';
import paths from './../../constants/path.js';
import { renderHtmlToImage } from '../system/puppeteerRenderer.js';

const screenshot = {
  /**
   * RSS 网页截图
   * @param feedItem 对象
   * @param savePath 保存路径
   * @returns {Promise<*>}
   */
  async generateScreenshot(feedItem, savePath) {
    const htmlTemplate = fs.readFileSync(paths.rssHTML, 'utf-8');
    const html = htmlTemplate
      .replace(/{{title}}/g, feedItem.title)
      .replace(/{{author}}/g, feedItem.author)
      .replace(/{{content}}/g, feedItem.content)
      .replace(/{{link}}/g, feedItem.link)
      .replace(/{{date}}/g, new Date(feedItem.date).toLocaleString())
      .replace(/{{feedTitle}}/g, feedItem.feedTitle)
      .replace(/{{image}}/g, feedItem.image || '');

    return renderHtmlToImage({
      html,
      outputPath: savePath,
      viewport: { width: 800, height: 600, deviceScaleFactor: 2 },
      contentOptions: { waitUntil: 'domcontentloaded', timeout: 10000 },
      afterContent: async page => {
        await page.evaluate(async () => {
          const images = Array.from(document.images || []);
          if (!images.length) return;
          await Promise.race([
            Promise.all(images.map(img => img.complete ? true : new Promise(resolve => {
              img.onload = resolve;
              img.onerror = resolve;
            }))),
            new Promise(resolve => setTimeout(resolve, 3000)),
          ]);
        });
      },
      measureHeight: false,
      screenshotOptions: { fullPage: true },
    });
  },
};

export default screenshot;
