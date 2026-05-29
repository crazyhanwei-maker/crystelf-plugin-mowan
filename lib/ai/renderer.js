import ConfigControl from '../config/configControl.js';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import markdownit from 'markdown-it';
import hljs from 'highlight.js';

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

class Renderer {
  constructor() {
    this.browser = null;
    this.config = null;
    this.isInitialized = false;
  }

  async init() {
    try {
      this.config = await ConfigControl.get('ai');
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      this.isInitialized = true;
    } catch (error) {
      logger.error(`[crystelf-renderer] 初始化失败: ${error.message}`);
    }
  }

  async renderCode(code, language) {
    if (!this.isInitialized) await this.init();
    let page = null;

    try {
      page = await this.browser.newPage();
      const html = this.getCodeTemplate(code, language, this.config?.codeRenderer || {});
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#render-complete', { timeout: 5000 });
      const rect = await page.evaluate(() => {
        const body = document.body;
        return { width: body.scrollWidth, height: body.scrollHeight };
      });
      await page.setViewport({
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      });

      const tempDir = path.join(process.cwd(), 'temp', 'html','crystelf-plugin');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const filepath = path.join(tempDir, `code_${Date.now()}.png`);

      await page.screenshot({ path: filepath, fullPage: false });
      logger.info(`[crystelf-ai] 代码渲染完成: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.error(`[crystelf-ai] 代码渲染失败: ${error.message}`);
      return null;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // Ignore close races after render failures.
        }
      }
    }
  }

  async renderMarkdown(markdown) {
    if (!this.isInitialized) await this.init();
    let page = null;
    try {
      logger.info('[crystelf-ai] Markdown渲染开始: 准备创建页面');
      page = await this.browser.newPage();
      page.on('pageerror', (error) => {
        logger.error(`[crystelf-ai] Markdown页面异常: ${error.message}`);
      });
      page.on('requestfailed', (request) => {
        logger.warn(`[crystelf-ai] Markdown请求失败: ${request.url()} | ${request.failure()?.errorText || 'unknown'}`);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          logger.error(`[crystelf-ai] Markdown控制台错误: ${msg.text()}`);
        }
      });
      await page.setCacheEnabled(false);
      const html = this.getMarkdownTemplate(markdown, this.config?.markdownRenderer || {});
      logger.info('[crystelf-ai] Markdown渲染阶段: setContent');
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
      logger.info('[crystelf-ai] Markdown渲染阶段: waitForSelector');
      await page.waitForSelector('#render-complete', { timeout: 5000 });
      logger.info('[crystelf-ai] Markdown渲染阶段: fonts-ready');
      await page.evaluate(async () => {
        if (document?.fonts?.ready) {
          try {
            await document.fonts.ready;
          } catch {}
        }
      });
      await new Promise(resolve => setTimeout(resolve, 120));
      logger.info('[crystelf-ai] Markdown渲染阶段: measure');
      const rect = await page.evaluate(() => {
        const body = document.body;
        const main = document.querySelector('.markdown-body') || body;
        const rect = main.getBoundingClientRect();
        return {
          width: Math.min(Math.ceil(rect.width + 40), 1200),
          height: Math.ceil(rect.height + 40),
        };
      });
      logger.info(`[crystelf-ai] Markdown渲染尺寸: ${rect.width}x${rect.height}`);

      logger.info('[crystelf-ai] Markdown渲染阶段: setViewport');
      await page.setViewport({
        width: rect.width,
        height: Math.min(rect.height, 3000),
        deviceScaleFactor: 2,
      });
      const tempDir = path.join(process.cwd(), 'temp', 'html','crystelf-plugin');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const filepath = path.join(tempDir, `markdown_${Date.now()}.png`);

      logger.info(`[crystelf-ai] Markdown渲染阶段: screenshot -> ${filepath}`);
      await page.screenshot({ path: filepath, fullPage: false });
      logger.info(`[crystelf-ai] Markdown渲染完成: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.error(`[crystelf-ai] Markdown渲染失败: ${error.stack || error.message}`);
      return null;
    } finally {
      if (page) {
        try {
          logger.info('[crystelf-ai] Markdown渲染阶段: close-page');
          await page.close();
        } catch {}
      }
    }
  }

  getCodeTemplate(code, language, config = {}) {
    const themeColor = '#274179';
    const fontSize = config.fontSize || 16;
    const escapedCode = this.escapeHtml(code);

    const colorMap = {
      javascript: 'from-yellow-400 to-yellow-600',
      typescript: 'from-blue-400 to-blue-600',
      python: 'from-cyan-400 to-cyan-600',
      html: 'from-orange-400 to-red-500',
      css: 'from-indigo-400 to-indigo-600',
      json: 'from-emerald-400 to-emerald-600',
      yaml: 'from-amber-400 to-amber-600',
      c: 'from-blue-300 to-blue-500',
      cpp: 'from-blue-400 to-indigo-600',
      java: 'from-red-400 to-orange-500',
      kotlin: 'from-pink-400 to-purple-500',
      csharp: 'from-violet-400 to-purple-600',
      'c#': 'from-violet-400 to-purple-600',
      dotnet: 'from-purple-400 to-indigo-600',
      bash: 'from-gray-400 to-gray-600',
      shell: 'from-gray-400 to-gray-600',
      text: 'from-slate-400 to-slate-600',
    };
    const barColor = colorMap[language.toLowerCase()] || 'from-cyan-400 to-cyan-600';

    let highlightedCode = '';
    try {
      if (hljs.getLanguage(language)) {
        highlightedCode = hljs.highlight(code, { language, ignoreIllegals: true }).value;
      } else {
        highlightedCode = hljs.highlightAuto(code).value;
      }
    } catch {
      highlightedCode = this.escapeHtml(code);
    }

    const lines = highlightedCode
      .split('\n')
      .map(
        (line, i) => `<div class="line"><span class="line-number">${i + 1}</span><span class="line-content">${line}</span></div>`
      )
      .join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Fira+Code&display=swap');
        body { background-color: ${themeColor}; margin: 0; padding: 20px; font-family: 'Fira Code', monospace; }
        .code-container {
          background-color: rgba(45,60,83,0.8);
          border-radius: 10px;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 0 20px rgba(0,0,0,0.5);
          max-width: 800px;
        }
        .code-header {
          display: flex;
          align-items: center;
          padding: 10px 15px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .language-tag {
          background-image: linear-gradient(to right, ${barColor.replace('-', ' ')});
          color: white;
          padding: 3px 8px;
          border-radius: 5px;
          font-family: sans-serif;
          font-size: 14px;
        }
        .code-body pre {
          padding: 15px;
          font-size: ${fontSize}px;
          line-height: 0.8;
          overflow-x: auto;
        }
        .line {
          display: flex;
          margin: 0;
          padding: 0;
          line-height: 1.2;
        }
        .line-number {
          text-align: right;
          margin-right: 12px;
          color: #9ca3af;
          user-select: none;
        }
      </style>
    </head>
    <body>
      <div class="code-container">
        <div class="code-header">
          <span class="language-tag">${language}</span>
        </div>
        <div class="code-body">
          <pre><code class="hljs ${language}">${lines}</code></pre>
        </div>
      </div>
      <div id="render-complete"></div>
    </body>
    </html>
  `;
  }


  getMarkdownTemplate(markdown, config = {}) {
    const themeColor = '#274179';
    const fontSize = config.fontSize || 18;
    const md = markdownit({
      html: true,
      linkify: true,
      typographer: true,
      highlight: function (str, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return (
              '<pre class="hljs"><code>' +
              hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
              '</code></pre>'
            );
          } catch (__) {}
        }
        return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
      },
    });

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          background:
            radial-gradient(circle at top left, rgba(250, 204, 21, 0.18), transparent 24%),
            radial-gradient(circle at top right, rgba(96, 165, 250, 0.2), transparent 28%),
            linear-gradient(160deg, #0b1220 0%, ${themeColor} 52%, #111827 100%);
          color: #e8edf7;
          font-family: 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif;
          font-size: ${fontSize}px;
          line-height: 1.6;
          margin: 0;
          padding: 34px;
          display: flex;
          justify-content: center;
          position: relative;
        }

        body::before,
        body::after {
          content: '';
          position: fixed;
          width: 120px;
          height: 120px;
          pointer-events: none;
          opacity: 0.5;
        }

        body::before {
          top: 16px;
          left: 16px;
          border-top: 3px solid rgba(250, 204, 21, 0.45);
          border-left: 3px solid rgba(250, 204, 21, 0.45);
          border-top-left-radius: 18px;
        }

        body::after {
          right: 16px;
          bottom: 16px;
          border-right: 3px solid rgba(125, 211, 252, 0.35);
          border-bottom: 3px solid rgba(125, 211, 252, 0.35);
          border-bottom-right-radius: 18px;
        }

        .markdown-body {
          width: 100%;
          max-width: 900px;
          box-sizing: border-box;
          position: relative;
          counter-reset: menu-section;
          background:
            linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(17, 24, 39, 0.94) 100%);
          border: 1px solid rgba(250, 204, 21, 0.42);
          border-radius: 28px;
          box-shadow:
            0 28px 70px rgba(15, 23, 42, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            inset 0 0 0 1px rgba(250, 204, 21, 0.18),
            0 0 0 1px rgba(250, 204, 21, 0.08);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          padding: 30px 34px;
        }

        .markdown-body::before {
          content: '';
          position: absolute;
          inset: 12px;
          border: 1px solid rgba(250, 204, 21, 0.16);
          border-radius: 20px;
          pointer-events: none;
        }

        .markdown-body::after {
          content: '';
          position: absolute;
          inset: 22px;
          border: 1px solid rgba(148, 163, 184, 0.08);
          border-radius: 16px;
          pointer-events: none;
        }

        .markdown-hud {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 18px;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 14px;
          border: 1px solid rgba(250, 204, 21, 0.28);
          background:
            repeating-linear-gradient(90deg, rgba(250, 204, 21, 0.06) 0 18px, transparent 18px 36px),
            linear-gradient(90deg, rgba(250, 204, 21, 0.12), rgba(15, 23, 42, 0.46));
          color: rgba(226, 232, 240, 0.78);
          font-size: 0.78em;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        .markdown-hud span:last-child {
          color: #facc15;
        }

        .markdown-hud span {
          flex: 1;
        }

        .markdown-hud span:nth-child(2) {
          text-align: center;
          color: rgba(125, 211, 252, 0.9);
        }

        .markdown-hud span:last-child {
          text-align: right;
        }

        h1, h2, h3, h4, h5, h6 {
          color: #f8fafc;
          margin-top: 1.5em;
        }

        h1 {
          margin-top: 0;
          font-size: 2.1em;
          letter-spacing: 0.08em;
          text-align: center;
          color: #f8fafc;
          background: linear-gradient(180deg, #fff8dc 0%, #facc15 48%, #f8fafc 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 0 18px rgba(96, 165, 250, 0.22);
          position: relative;
          padding-top: 22px;
          padding-bottom: 18px;
        }

        h1::before {
          content: 'MENU';
          display: inline-block;
          margin-bottom: 12px;
          padding: 4px 12px;
          border-radius: 999px;
          border: 1px solid rgba(250, 204, 21, 0.4);
          background: linear-gradient(180deg, rgba(250, 204, 21, 0.2) 0%, rgba(30, 41, 59, 0.32) 100%);
          color: #facc15;
          font-size: 0.42em;
          letter-spacing: 0.28em;
          box-shadow: 0 0 18px rgba(250, 204, 21, 0.12);
        }

        h1::after {
          content: 'SYSTEM SELECT';
          display: block;
          margin-top: 10px;
          color: rgba(226, 232, 240, 0.72);
          font-size: 0.36em;
          letter-spacing: 0.34em;
          font-weight: 600;
        }

        h2 {
          counter-increment: menu-section;
          font-size: 1.2em;
          background:
            linear-gradient(180deg, rgba(250, 204, 21, 0.16) 0%, rgba(59, 130, 246, 0.1) 100%);
          border: 1px solid rgba(250, 204, 21, 0.34);
          border-radius: 16px;
          padding: 12px 18px;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.06),
            0 8px 20px rgba(15, 23, 42, 0.18);
          letter-spacing: 0.04em;
          position: relative;
          overflow: hidden;
          text-transform: uppercase;
          margin-bottom: 14px;
          border-left: 4px solid rgba(250, 204, 21, 0.52);
        }

        h2::before {
          content: counter(menu-section, decimal-leading-zero) ' ✦';
          color: #facc15;
          margin-right: 10px;
        }

        h2::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, rgba(250, 204, 21, 0.08), transparent 45%);
          pointer-events: none;
        }

        h2 + ul {
          margin-top: 0;
          margin-bottom: 18px;
        }

        a {
          color: #7dd3fc;
          text-decoration: none;
        }
        a:hover { text-decoration: underline; }

        code {
          background-color: rgba(30, 41, 59, 0.92);
          padding: 3px 7px;
          border-radius: 8px;
        }
        pre {
          background-color: rgba(15, 23, 42, 0.95);
          padding: 15px;
          border-radius: 14px;
          overflow-x: auto;
          border: 1px solid rgba(148, 163, 184, 0.14);
        }
        blockquote {
          border: 1px solid rgba(125, 211, 252, 0.18);
          background: linear-gradient(180deg, rgba(30, 41, 59, 0.72) 0%, rgba(15, 23, 42, 0.62) 100%);
          border-left: 4px solid #facc15;
          padding: 14px 18px;
          color: #dbe7f5;
          margin: 1em 0;
          border-radius: 14px;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          margin: 1em 0;
          background-color: rgba(30, 41, 59, 0.92);
          border-radius: 14px;
          overflow: hidden;
        }
        th, td {
          border: 1px solid #334155;
          padding: 10px 12px;
          text-align: left;
        }
        th {
          background-color: #0f172a;
          color: #f1f5f9;
        }
        tr:nth-child(even) {
          background-color: #16213d;
        }

        img {
          max-width: 100%;
          border-radius: 14px;
          display: block;
          margin: 10px auto;
        }

        ul {
          padding-left: 0;
          list-style: none;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px 12px;
          counter-reset: menu-item;
        }

        li {
          counter-increment: menu-item;
          margin: 0;
          padding: 12px 16px 12px 56px;
          border-radius: 14px;
          background:
            linear-gradient(90deg, rgba(250, 204, 21, 0.06), transparent 28%),
            linear-gradient(180deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.72) 100%);
          border: 1px solid rgba(250, 204, 21, 0.18);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            inset 0 0 0 1px rgba(148, 163, 184, 0.05),
            inset 6px 0 0 rgba(250, 204, 21, 0.22),
            0 6px 18px rgba(15, 23, 42, 0.16);
          break-inside: avoid;
          position: relative;
        }

        li:nth-child(odd) {
          background:
            linear-gradient(90deg, rgba(125, 211, 252, 0.05), transparent 28%),
            linear-gradient(180deg, rgba(39, 53, 84, 0.76) 0%, rgba(15, 23, 42, 0.76) 100%);
        }

        li::after {
          content: '';
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: 0;
          height: 1px;
          background: linear-gradient(90deg, rgba(250, 204, 21, 0.26), transparent 70%);
        }

        li::before {
          content: counter(menu-item, decimal-leading-zero);
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          min-width: 28px;
          padding: 2px 6px;
          border-radius: 999px;
          border: 1px solid rgba(250, 204, 21, 0.34);
          background: linear-gradient(180deg, rgba(250, 204, 21, 0.22), rgba(30, 41, 59, 0.28));
          color: #facc15;
          font-size: 0.72em;
          font-weight: 700;
          text-align: center;
        }

        li span, li strong {
          color: #f8fafc;
        }

        li:hover {
          border-color: rgba(250, 204, 21, 0.28);
        }

        .markdown-side-ornament {
          position: absolute;
          top: 92px;
          bottom: 92px;
          width: 12px;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(250, 204, 21, 0.16), rgba(96, 165, 250, 0.08), rgba(250, 204, 21, 0.16));
          opacity: 0.8;
          pointer-events: none;
        }

        .markdown-side-ornament.left {
          left: 10px;
        }

        .markdown-side-ornament.right {
          right: 10px;
        }

        @media (max-width: 720px) {
          ul {
            grid-template-columns: 1fr;
          }

          .markdown-hud {
            font-size: 0.7em;
            letter-spacing: 0.1em;
          }

          .markdown-side-ornament {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="markdown-body">
        <div class="markdown-hud"><span>Chapter · Master Control</span><span>Mode · RPG Menu</span><span>Page 01</span></div>
        <div class="markdown-side-ornament left"></div>
        <div class="markdown-side-ornament right"></div>
        ${md.render(markdown)}
        <div id="render-complete"></div>
      </div>
    </body>
    </html>
  `;
  }


  escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.isInitialized = false;
    }
  }
}

export default new Renderer();
