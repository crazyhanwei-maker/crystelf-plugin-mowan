import fs from 'fs';
import path from 'path';
import { withPuppeteerPage } from '../system/puppeteerRenderer.js';
import { resolveBotIdentity } from '../system/botIdentity.js';
import {
  buildBrandHero,
  buildImageThemeCss,
  resolveImageWallpaperDataUrl,
  waitForThemeImages,
} from '../system/imageTheme.js';

class MusicRenderer {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp', 'html', 'crystelf-plugin', 'music');
    this.isInitialized = false;
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * 初始化渲染器
   */
  async init() {
    try {
      this.ensureTempDir();
      this.isInitialized = true;
    } catch (error) {
      logger.error('[crystelf-music] 浏览器初始化失败:', error);
      throw error;
    }
  }

  /**
   * 渲染音乐列表图片
   * @param {Array} songs 歌曲列表
   * @param {string} query 搜索关键词
   * @param {string} groupId 群聊 ID
   * @returns {Promise<string>} 图片文件路径
   */
  async renderMusicList(songs, query, groupId, botIdentity = {}) {
    try {
      if (!this.isInitialized) {
        await this.init();
      }
      this.ensureTempDir();
      return await withPuppeteerPage(async page => {
        await page.setViewport({ width: 900, height: 400, deviceScaleFactor: 2 });
        const htmlContent = this.generateHtml(songs, query, botIdentity);
        await page.setContent(htmlContent, {
          waitUntil: 'networkidle0',
          timeout: 30000
        });
        await waitForThemeImages(page);
        const filename = `music_list_${groupId}_${Date.now()}.png`;
        const outputPath = path.join(this.tempDir, filename);
        const imageBuffer = await page.screenshot({
          type: 'png',
          fullPage: true
        });
        fs.writeFileSync(outputPath, imageBuffer);
        return outputPath;
      });
    } catch (error) {
      logger.error('[crystelf-music] 渲染音乐列表失败:', error);
      throw new Error(`渲染失败: ${error.message}`);
    }
  }

  /**
   * 生成 HTML 内容
   * @param {Array} songs 歌曲列表
   * @param {string} query 搜索关键词
   * @returns {string} HTML 字符串
   */
  generateHtml(songs, query, botIdentity = {}) {
    const currentTime = new Date().toLocaleString('zh-CN');
    const identity = {
      ...resolveBotIdentity({}, botIdentity.botName || '魔丸'),
      ...botIdentity,
    };
    const wallpaper = resolveImageWallpaperDataUrl();

    const songItems = songs.map((song, index) => `
    <div class="song-card">
      <div class="info">
        <div class="title">${this.escapeHtml(song.displayTitle)}</div>
        <div class="meta">
          <span class="tag artist">${this.escapeHtml(song.displayArtist)}</span>
          <span class="tag album">${this.escapeHtml(song.displayAlbum)}</span>
        </div>
        <div class="extra">
          <span>${song.duration}</span>
          <span>${song.format}</span>
        </div>
      </div>
      <div class="rank">${String(index + 1).padStart(2, '0')}</div>
    </div>
  `).join('');

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>音乐搜索结果</title>

<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: "SF Pro Display", "PingFang SC", "Segoe UI", sans-serif;
    background: linear-gradient(135deg, #1d2b64, #d9abb8);
    padding: 30px 20px;
    min-height: 100vh;
  }

  ${buildImageThemeCss({ wallpaper, width: 900 })}
  .container { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; backdrop-filter: none; }
  .music-list { padding: 18px; }
  .list { gap: 9px; }
  .song-card {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 48px;
    gap: 14px;
    align-items: center;
    min-height: 82px;
    padding: 12px 13px;
    border: 1px solid var(--theme-line);
    border-radius: 7px;
    background: rgba(255,255,255,0.64);
  }
  .song-card .info { min-width: 0; }
  .song-card .title { margin-bottom: 7px; color: var(--theme-ink); font-size: 16px; font-weight: 900; overflow-wrap: anywhere; }
  .song-card .meta { gap: 7px; margin-bottom: 7px; }
  .song-card .tag { padding: 4px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; }
  .song-card .artist { background: rgba(36,157,178,0.13); color: #176c7a; }
  .song-card .album { background: rgba(37,169,121,0.13); color: #177554; }
  .song-card .extra { gap: 12px; color: var(--theme-muted); font-size: 10px; font-weight: 800; }
  .song-card .rank { position: static; display: grid; place-items: center; width: 42px; height: 42px; padding: 0; border-radius: 6px; background: rgba(82,121,216,0.12); color: var(--theme-blue); font-size: 14px; font-weight: 900; }
  .music-help { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 12px; }
  .music-action { padding: 10px 11px; border: 1px solid var(--theme-line); border-radius: 6px; background: rgba(255,255,255,0.58); color: #4d5663; font-size: 11px; line-height: 1.45; font-weight: 700; }
  .music-action strong { color: var(--theme-ink); font-size: 12px; }

  .container {
    max-width: 900px;
    margin: auto;
    background: rgba(255,255,255,0.08);
    padding: 35px;
    border-radius: 24px;
    backdrop-filter: blur(30px);
    -webkit-backdrop-filter: blur(30px);
    box-shadow: 0 20px 45px rgba(0,0,0,0.25);
    border: 1px solid rgba(255,255,255,0.2);
  }

  .header {
    text-align: center;
    margin-bottom: 40px;
    color: #fff;
  }

  .header h1 {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 10px;
  }

  .header .sub {
    font-size: 16px;
    opacity: 0.9;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .card {
    display: flex;
    background: rgba(255,255,255,0.25);
    border-radius: 18px;
    overflow: hidden;
    padding: 18px;
    backdrop-filter: blur(15px);
    -webkit-backdrop-filter: blur(15px);
    border: 1px solid rgba(255,255,255,0.3);
    align-items: center;
    box-shadow: 0 10px 25px rgba(0,0,0,0.15);
    position: relative;
    transition: transform 0.25s ease;
  }

  .card:hover {
    transform: translateY(-4px);
  }

  .info {
    flex: 1;
  }

  .title {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 8px;
    color: #007cc9;
  }

  .meta {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }

  .tag {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 6px;
    backdrop-filter: blur(8px);
    font-weight: 500;
  }

  .artist {
    background: rgba(13,166,180,0.5);
    color: #fff;
  }

  .album {
    background: rgba(39,255,0,0.36);
    color: #1a1a1a;
  }

  .extra {
    font-size: 12px;
    opacity: 0.85;
    display: flex;
    gap: 15px;
  }

  .rank {
    position: absolute;
    right: 15px;
    top: 15px;
    background: rgba(255,255,255,0.25);
    padding: 6px 12px;
    border-radius: 10px;
    color: #fff;
    font-weight: 600;
    font-size: 15px;
    backdrop-filter: blur(10px);
  }

  @media (max-width: 600px) {
    .card {
      flex-direction: column;
      text-align: center;
    }

    .rank {
      top: 12px;
      right: 12px;
    }
  }
  .container { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
</style>

</head>
<body>

<div class="container theme-sheet">
  ${buildBrandHero({
    botName: identity.botName,
    avatarText: identity.avatarText,
    avatarUrl: identity.avatarUrl,
    badge: '点歌',
    title: '音乐搜索结果',
    subtitle: `搜索：${query}`,
    sideTitle: `${songs.length} 首结果`,
    sideText: currentTime,
  })}
  <section class="theme-panel music-list">
    <div class="theme-panel-head">
      <div class="theme-panel-title"><h2>选择歌曲</h2></div>
      <div class="theme-panel-meta">按列表编号操作</div>
    </div>
    <div class="list">${songItems}</div>
    <div class="music-help">
      <div class="music-action"><strong>听1</strong><br>转换为语音发送到群聊</div>
      <div class="music-action"><strong>发送1</strong><br>上传音乐文件到群文件</div>
    </div>
  </section>
  <footer class="theme-footer"><span>Created by 魔丸插件</span><span>${currentTime}</span></footer>
</div>

</body>
</html>
  `;
  }

  /**
   * HTML 转义
   * @param {string} text 原始文本
   * @returns {string} 转义后的文本
   */
  escapeHtml(text) {
    if (!text) return '';

    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };

    return text.toString().replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * 关闭渲染器
   */
  async close() {
    this.isInitialized = false;
  }
}

export default MusicRenderer;
