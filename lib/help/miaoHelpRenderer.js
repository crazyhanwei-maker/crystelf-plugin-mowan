import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderArtdIcon, getArtdIcon } from './artdIcons.js';
import { renderHtmlToImage } from '../system/puppeteerRenderer.js';
import Version from '../system/version.js';

//喵喵风格帮助图渲染：帮助文本 → 分组卡片 → n 主题出图
//渲染链路与素材提取自 miao-plugin（resources/help），沿用其主题图与图标雪碧图
const RESOURCE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resources', 'miao-help');
const HELP_DIY_UPLOAD_DIR = path.resolve(RESOURCE_DIR, '../../../webConsole/public/uploads/help-diy');
const HELP_DIY_UPLOAD_PREFIX = '/uploads/help-diy/';
const COL_COUNTS = [2, 3, 4, 5];
const FONT_SCALES = [0.85, 1, 1.15, 1.3];

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

//条目拆 title/desc：显式 2+ 空格/制表符允许空描述；旧格式再按命令前缀与单空格拆分。
function splitHelpItem(text = '') {
  const raw = String(text || '').trimStart();
  const multiSpace = raw.match(/^([\s\S]*?\S)[ \t]{2,}(.*)$/);
  if (multiSpace) {
    return { title: multiSpace[1].trim(), desc: multiSpace[2].trim() };
  }
  const singleSpace = raw.match(/^(\S+)\s+(\S.*)$/);
  if (singleSpace && /^[#@*%~-]/.test(singleSpace[1])) {
    return { title: singleSpace[1], desc: singleSpace[2].trim() };
  }
  return { title: raw.trim(), desc: '' };
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

    //条目的尾部空格可能是空描述分隔符，不能使用上面用于标题/分隔线的 trim() 结果。
    const itemMatch = rawLine.trimStart().match(/^[-•*]\s+(.+)$/);
    if (itemMatch) {
      if (!current) {
        current = { group: '命令', items: [] };
        groups.push(current);
      }
      //可选图标前缀：[icon:N]（喵喵雪碧图 1-40）或 [artd:slug]（ART PRO 矢量图标）；未指定按条目顺序自动分配
      let rest = itemMatch[1];
      let explicitIcon = null;
      const iconTagMatch = rest.match(/^\[(icon:(\d{1,3})|artd:([^\]\s]+))\]\s*/i);
      if (iconTagMatch) {
        if (iconTagMatch[2]) {
          explicitIcon = Math.min(Math.max(parseInt(iconTagMatch[2], 10) || 0, 1), 40);
        } else if (iconTagMatch[3] && getArtdIcon(iconTagMatch[3])) {
          explicitIcon = `artd:${iconTagMatch[3]}`;
        }
        rest = rest.slice(iconTagMatch[0].length);
      }
      const { title: itemTitle, desc } = splitHelpItem(rest);
      if (!itemTitle) continue;
      itemIndex += 1;
      const icon = explicitIcon ?? (itemIndex % 40) + 1;
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

//喵喵卡片默认样式（与 miao 原版观感一致），miaoStyle 配置可覆盖
export const MIAO_STYLE_DEFAULTS = {
  subtitle: '魔丸插件 · 发送 #灵晶帮助 查看帮助',
  titleColor: '#000000',
  subtitleColor: '#000000',
  groupColor: '#ceb78b',
  descColor: '#eeeeee',
  themeImage: '',
  bodyImage: '',
  titleAlign: 'left',
  subtitleAlign: 'left',
  colCount: 5,
  fontScale: 1,
};

function normalizeAlign(value = '', fallback = 'left') {
  const raw = String(value || '').trim().toLowerCase();
  return ['left', 'center', 'right'].includes(raw) ? raw : fallback;
}

const imageFileCache = new Map();

//配置只保存上传 URL；拒绝编码/反斜杠绕过、绝对路径和路径穿越，不要求文件已存在。
function normalizeHelpDiyImageUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw.startsWith(HELP_DIY_UPLOAD_PREFIX) || /[\\%?#:\u0000-\u0020\u007f]/.test(raw)) return '';
  const parts = raw.slice(HELP_DIY_UPLOAD_PREFIX.length).split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return '';
  return /\.(png|jpe?g|webp|gif)$/i.test(raw) ? raw : '';
}

function isPathInsideRoot(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

//控制台和机器人共用：同时校验逻辑路径与真实路径，拒绝指向上传目录外的符号链接。
export function resolveHelpDiyImageSource(value = '', uploadDir = HELP_DIY_UPLOAD_DIR) {
  const url = normalizeHelpDiyImageUrl(value);
  if (!url) return '';
  try {
    const rootPath = path.resolve(uploadDir);
    const targetPath = path.resolve(rootPath, ...url.slice(HELP_DIY_UPLOAD_PREFIX.length).split('/'));
    if (!isPathInsideRoot(targetPath, rootPath)) return '';
    const realRoot = fs.realpathSync(rootPath);
    const realTarget = fs.realpathSync(targetPath);
    if (!isPathInsideRoot(realTarget, realRoot) || !fs.statSync(realTarget).isFile()) return '';
    if (!/\.(png|jpe?g|webp|gif)$/i.test(realTarget)) return '';
    return realTarget;
  } catch {
    return '';
  }
}

//安全解析后按真实路径、mtime 和大小缓存，不能直接读取任意绝对路径。
function readImageFileDataUrl(imageUrl = '', uploadDir = HELP_DIY_UPLOAD_DIR) {
  const imagePath = resolveHelpDiyImageSource(imageUrl, uploadDir);
  if (!imagePath) return '';
  try {
    const stat = fs.statSync(imagePath);
    const key = `${imagePath}:${stat.mtimeMs}:${stat.size}`;
    const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png'
      : imagePath.toLowerCase().endsWith('.webp') ? 'image/webp'
        : imagePath.toLowerCase().endsWith('.gif') ? 'image/gif'
          : 'image/jpeg';
    if (!imageFileCache.has(key)) {
      imageFileCache.set(key, `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`);
      if (imageFileCache.size > 8) {
        const oldest = imageFileCache.keys().next().value;
        imageFileCache.delete(oldest);
      }
    }
    return imageFileCache.get(key);
  } catch {
    return '';
  }
}

function normalizeHexColor(value = '', fallback = '') {
  const raw = String(value || '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw) ? raw : fallback;
}

function normalizeNumericChoice(value, choices, fallback) {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  const number = Number(value);
  return choices.includes(number) ? number : fallback;
}

//持久化、导入、预览和机器人使用相同白名单；颜色预设由前端展开为实际颜色。
export function normalizeMiaoStyle(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    subtitle: String(source.subtitle ?? MIAO_STYLE_DEFAULTS.subtitle).replace(/\s+/g, ' ').trim().slice(0, 120) || MIAO_STYLE_DEFAULTS.subtitle,
    titleColor: normalizeHexColor(source.titleColor, MIAO_STYLE_DEFAULTS.titleColor),
    subtitleColor: normalizeHexColor(source.subtitleColor, MIAO_STYLE_DEFAULTS.subtitleColor),
    groupColor: normalizeHexColor(source.groupColor, MIAO_STYLE_DEFAULTS.groupColor),
    descColor: normalizeHexColor(source.descColor, MIAO_STYLE_DEFAULTS.descColor),
    themeImage: normalizeHelpDiyImageUrl(source.themeImage),
    bodyImage: normalizeHelpDiyImageUrl(source.bodyImage),
    titleAlign: normalizeAlign(source.titleAlign, MIAO_STYLE_DEFAULTS.titleAlign),
    subtitleAlign: normalizeAlign(source.subtitleAlign, MIAO_STYLE_DEFAULTS.subtitleAlign),
    colCount: normalizeNumericChoice(source.colCount, COL_COUNTS, MIAO_STYLE_DEFAULTS.colCount),
    fontScale: normalizeNumericChoice(source.fontScale, FONT_SCALES, MIAO_STYLE_DEFAULTS.fontScale),
  };
}

export async function renderMiaoHelpCard(text = '', options = {}) {
  const {
    colWidth = 265,
    outputPath = '',
    theme = 'n',
    uploadDir = HELP_DIY_UPLOAD_DIR,
  } = options;
  const style = normalizeMiaoStyle(options.style);
  //显式渲染选项优先于全局样式；非法列数回到默认值，避免行拆分/补齐异常。
  const colCount = normalizeNumericChoice(options.colCount ?? style.colCount, COL_COUNTS, MIAO_STYLE_DEFAULTS.colCount);
  const fontSize = size => Math.round(size * style.fontScale * 100) / 100;
  style.themeImage = readImageFileDataUrl(style.themeImage, uploadDir);
  style.bodyImage = readImageFileDataUrl(style.bodyImage, uploadDir);
  const subtitle = String(options.subtitle ?? style.subtitle).slice(0, 120);

  const parsed = parseHelpText(text, { title: options.title });
  if (!parsed.groups.length) {
    throw new Error('帮助内容没有可渲染的命令条目');
  }

  const width = Math.min(2500, Math.max(800, colCount * colWidth + 30));
  //自定义主题底图/页面背景优先，未设置时用内置 n 主题
  const themeMain = style.themeImage
    || (theme === 'default' ? readAssetBase64('theme-default-main.png', 'image/png') : readAssetBase64('theme-n-main.png', 'image/png'));
  const bodyBg = style.bodyImage || readAssetBase64('theme-default-bg.jpg', 'image/jpeg');
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
      const iconHtml = typeof item.icon === 'string' && item.icon.startsWith('artd:')
        ? renderArtdIcon(item.icon, 'help-icon help-icon-artd')
        : `<span class="help-icon" style="${iconCss(item.icon)}"></span>`;
      tds += `      <div class="td">
        ${iconHtml}
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
.help-icon-artd{background:none;color:#f0e6c8;display:flex;align-items:center;justify-content:center;}
.help-icon-artd svg{width:34px;height:34px;}
</style>
<style>
body{margin:0;background-image:url("${bodyBg}");background-repeat:repeat;width:${width}px;}
.container{background-image:url("${themeMain}");background-size:100% auto;width:${width}px;min-height:400px;display:flex;flex-direction:column;}
.head-box{margin-top:0;}
.head-box .title{color:${style.titleColor};text-align:${style.titleAlign};font-size:${fontSize(36)}px;line-height:${fontSize(50)}px;}
.head-box .label{color:${style.subtitleColor};text-align:${style.subtitleAlign};font-size:${fontSize(18)}px;line-height:${fontSize(24)}px;}
.help-table{table-layout:fixed;}
.help-table .td,.help-table .th{width:${100 / colCount}%;line-height:${fontSize(24)}px;overflow-wrap:anywhere;}
.help-title,.help-group{color:${style.groupColor};text-shadow:none}
.help-group{font-size:${fontSize(18)}px;line-height:${fontSize(24)}px;}
.help-title{font-size:${fontSize(16)}px;line-height:${fontSize(24)}px;}
.help-desc{color:${style.descColor};text-shadow:none;font-size:${fontSize(13)}px;line-height:${fontSize(18)}px;}
.cont-box{background:rgba(43, 52, 61, 0.8);backdrop-filter:blur(3px)}
.help-group{background:rgba(34, 41, 51, .4)}
.help-table .tr:nth-child(odd){background:rgba(34, 41, 51, .2)}
.help-table .tr:nth-child(even){background:rgba(34, 41, 51, .4)}
.help-footer{margin-top:auto;padding:4px 20px 20px;color:#eeeeee;font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:${fontSize(16)}px;line-height:${fontSize(24)}px;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,.8)}
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
  <footer class="help-footer">魔丸 v${escapeHtml(Version.ver || '0.0.0')}</footer>
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
