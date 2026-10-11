import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderHtmlToImage } from '../system/puppeteerRenderer.js';

//喵喵风格帮助图渲染：帮助文本 → 分组卡片 → n 主题出图
//渲染链路与素材提取自 miao-plugin（resources/help），沿用其主题图与图标雪碧图
const RESOURCE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resources', 'miao-help');

const assetCache = new Map();

function readAssetBase64(filename, mime) {
  if (assetCache.has(filename)) {
    return assetCache.get(filename);
  }
  const file = path.join(RESOURCE_DIR, filename);
  const value = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  assetCache.set(filename, value);
  return value;
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isGroupTitleLine(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  if (/^[-•*]\s+/.test(trimmed)) return false;
  if (/^[━─═=—\-]{3,}$/.test(trimmed)) return false;
  return true;
}

//条目拆 title/desc：优先 2+ 空格；其次首词以 #/@/*/% 开头按单空格拆；否则整行为标题
function splitHelpItem(text = '') {
  const raw = String(text || '').trim();
  const multiSpace = raw.match(/^(\S(?:.*?\S)?)\s{2,}(\S.*)$/);
  if (multiSpace) {
    return { title: multiSpace[1].trim(), desc: multiSpace[2].trim() };
  }
  const singleSpace = raw.match(/^(\S+)\s+(\S.*)$/);
  if (singleSpace && /^[#@*%~-]/.test(singleSpace[1])) {
    return { title: singleSpace[1], desc: singleSpace[2].trim() };
  }
  return { title: raw, desc: '' };
}

export function parseHelpText(text = '', options = {}) {
  const lines = String(text || '').split(/\r?\n/);
  let title = '';
  const groups = [];
  let current = null;
  let itemIndex = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[━─═=—\-]{3,}$/.test(line)) continue;

    if (!title && !/^[-•*]\s+/.test(line) && isGroupTitleLine(line) && groups.length === 0 && current === null) {
      title = line;
      continue;
    }

    const itemMatch = line.match(/^[-•*]\s+(.+)$/);
    if (itemMatch) {
      if (!current) {
        current = { group: '命令', items: [] };
        groups.push(current);
      }
      const { title: itemTitle, desc } = splitHelpItem(itemMatch[1]);
      if (!itemTitle) continue;
      itemIndex += 1;
      const icon = (itemIndex % 40) + 1;
      current.items.push({ icon, title: itemTitle, desc });
      continue;
    }

    if (isGroupTitleLine(line)) {
      current = { group: line, items: [] };
      groups.push(current);
    }
  }

  const filtered = groups
    .map(group => ({ ...group, items: group.items.filter(item => item.title) }))
    .filter(group => group.group && group.items.length);

  return {
    title: String(options.title || title || '使用帮助').slice(0, 60),
    groups: filtered,
  };
}

export async function renderMiaoHelpCard(text = '', options = {}) {
  const {
    //5 列 x 265 = 1355px 与 n 主题图原生宽度一致，主题装饰才不会错位
    colCount = 5,
    colWidth = 265,
    subtitle = '魔丸插件 · 发送 #灵晶帮助 查看帮助',
    theme = 'n',
    outputPath = '',
  } = options;

  const parsed = parseHelpText(text, { title: options.title });
  if (!parsed.groups.length) {
    throw new Error('帮助内容没有可渲染的命令条目');
  }

  const width = Math.min(2500, Math.max(800, colCount * colWidth + 30));
  const themeMain = theme === 'default'
    ? readAssetBase64('theme-default-main.png', 'image/png')
    : readAssetBase64('theme-n-main.png', 'image/png');
  const bodyBg = readAssetBase64('theme-default-bg.jpg', 'image/jpeg');
  const iconSprite = readAssetBase64('icon.png', 'image/png');
  const css = fs.readFileSync(path.join(RESOURCE_DIR, 'help.css'), 'utf8').replace(/url\("icon\.png"\)/, `url("${iconSprite}")`);

  const iconCss = icon => {
    const num = Number(icon) || 1;
    const x = (num - 1) % 10;
    const y = (num - x - 1) / 10;
    return `background-position:-${x * 50}px -${y * 50}px`;
  };

  let groupsHtml = '';
  for (const group of parsed.groups) {
    const list = group.items;
    let tds = '';
    for (let idx = 0; idx < list.length; idx++) {
      const item = list[idx];
      tds += `      <div class="td">
        <span class="help-icon" style="${iconCss(item.icon)}"></span>
        <strong class="help-title">${escapeHtml(item.title)}</strong>
        <span class="help-desc">${escapeHtml(item.desc)}</span>
      </div>\n`;
      if (idx % colCount === colCount - 1 && idx > 0 && idx < list.length - 1) {
        tds += '    </div>\n    <div class="tr">\n';
      }
    }
    for (let i = (list.length - 1) % colCount; i < colCount - 1; i++) {
      tds += '      <div class="td"></div>\n';
    }
    groupsHtml += `  <div class="cont-box">
    <div class="help-group">${escapeHtml(group.group)}</div>
    <div class="help-table">
      <div class="tr">
${tds}      </div>
    </div>
  </div>\n`;
  }

  const html = `<!doctype html>
<html><head><meta charset="UTF-8"/>
<style>${css}
.help-icon{background-image:url("${iconSprite}");}
</style>
<style>
body{margin:0;background-image:url("${bodyBg}");background-repeat:repeat;width:${width}px;}
.container{background-image:url("${themeMain}");background-size:100% auto;width:${width}px;}
.head-box{margin-top:0;}
.help-table .td,.help-table .th{width:${100 / colCount}%}
.help-title,.help-group{color:#ceb78b;text-shadow:none}
.help-desc{color:#eee;text-shadow:none}
.cont-box{background:rgba(43, 52, 61, 0.8);backdrop-filter:blur(3px)}
.help-group{background:rgba(34, 41, 51, .4)}
.help-table .tr:nth-child(odd){background:rgba(34, 41, 51, .2)}
.help-table .tr:nth-child(even){background:rgba(34, 41, 51, .4)}
</style>
</head>
<body>
<div class="container">
  <div class="info-box">
    <div class="head-box type1">
      <div class="title">${escapeHtml(parsed.title)}</div>
      <div class="label">${escapeHtml(subtitle)}</div>
    </div>
  </div>
${groupsHtml}
</div>
</body></html>`;

  if (!outputPath) {
    throw new Error('renderMiaoHelpCard 缺少 outputPath');
  }
  await renderHtmlToImage({
    html,
    outputPath,
    //初始高度尽量小：measureHeight 按内容撑起，避免视口高度撑出大片空背景
    //视口宽度与卡片一致，避免 body 背景在两侧露出
    viewport: { width, height: 220, deviceScaleFactor: 1.2 },
    minHeight: 400,
    maxHeight: 8000,
  });
  return outputPath;
}
