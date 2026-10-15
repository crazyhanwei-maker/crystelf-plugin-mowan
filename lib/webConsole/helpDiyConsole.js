import fs from 'fs';
import path from 'path';
import { renderMiaoHelpCard, normalizeMiaoStyle } from '../help/miaoHelpRenderer.js';

function defaultCreateHttpError(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(String(message || 'Internal Server Error'));
  error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
  if (code) {
    error.code = String(code);
  }
  return error;
}

function defaultReplaceControlCharacters(value = '', replacement = ' ') {
  return Array.from(String(value || ''))
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127 ? replacement : char;
    })
    .join('');
}

export function createHelpDiyConsole(options = {}) {
  const helpDiyFile = options.helpDiyFile || '';
  const legacyHelpDiyFile = options.legacyHelpDiyFile || '';
  const uploadDir = options.uploadDir || path.join(process.cwd(), 'lib', 'webConsole', 'public', 'uploads', 'help-diy');
  const historyFile = options.historyFile || path.join(process.cwd(), 'data', 'crystelf', 'help-diy-history.json');
  const defaultImage = options.defaultImage || '';
  const imageMaxBytes = Number(options.imageMaxBytes || 5 * 1024 * 1024);
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : defaultCreateHttpError;
  const safeReadJson = typeof options.safeReadJson === 'function' ? options.safeReadJson : (() => null);
  const safeWriteJson = typeof options.safeWriteJson === 'function' ? options.safeWriteJson : (() => {});
  const getStoredConfig = typeof options.getStoredConfig === 'function' ? options.getStoredConfig : (() => null);
  const setStoredConfig = typeof options.setStoredConfig === 'function' ? options.setStoredConfig : async () => {};
  const ensurePathResolvedWithinRoot = typeof options.ensurePathResolvedWithinRoot === 'function'
    ? options.ensurePathResolvedWithinRoot
    : (() => {});
  const getRealPathSafe = typeof options.getRealPathSafe === 'function'
    ? options.getRealPathSafe
    : ((targetPath = '') => targetPath);
  const isPathInsideRoot = typeof options.isPathInsideRoot === 'function'
    ? options.isPathInsideRoot
    : (() => true);
  const getWebConsoleDisplayUrl = typeof options.getWebConsoleDisplayUrl === 'function'
    ? options.getWebConsoleDisplayUrl
    : (() => 'http://127.0.0.1:27891/');
  const replaceControlCharacters = typeof options.replaceControlCharacters === 'function'
    ? options.replaceControlCharacters
    : defaultReplaceControlCharacters;
  const renderMarkdown = typeof options.renderMarkdown === 'function' ? options.renderMarkdown : null;
  const renderHtml = typeof options.renderHtml === 'function' ? options.renderHtml : null;
  const htmlMaxChars = Number(options.htmlMaxBytes || 200 * 1024);

  function sanitizeUploadPrefix(prefix = 'help') {
    const safePrefix = String(prefix || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    return safePrefix || 'help';
  }

  function saveImage(dataUrl = '', prefix = 'help') {
    const matched = String(dataUrl || '').match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
    if (!matched) {
      throw new Error('图片数据格式不正确');
    }
    const mime = matched[1].toLowerCase();
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
    const base64 = matched[3];
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length <= 0) {
      throw new Error('图片数据为空');
    }
    if (buffer.length > imageMaxBytes) {
      throw new Error(`图片过大，最大允许 ${Math.round(imageMaxBytes / 1024 / 1024)}MB`);
    }
    const safePrefix = sanitizeUploadPrefix(prefix);
    const fileName = `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.resolve(uploadDir, fileName);
    ensurePathResolvedWithinRoot(filePath, uploadDir, { allowMissing: true });
    fs.writeFileSync(filePath, buffer);
    return `/uploads/help-diy/${fileName}`;
  }

  const HELP_DIY_SLOT_TITLES = {
    home: '灵晶帮助',
    ai: '灵晶帮助 · AI',
    manage: '灵晶帮助 · 管理',
    fun: '灵晶帮助 · 娱乐',
    debug: '灵晶帮助 · 调试',
  };

  function buildHelpDiyMarkdown(slot = '', text = '') {
    const title = HELP_DIY_SLOT_TITLES[slot] || '灵晶帮助';
    const body = String(text || '').trim();
    const lines = [
      `# ${title}`,
      '',
    ];
    if (body) {
      body.split(/\r?\n/).forEach(line => {
        if (line.startsWith('- ') || line.startsWith('• ')) {
          lines.push(line);
        } else if (/^={3,}$/.test(line.trim())) {
          lines.push('---');
        } else if (line.trim() === '') {
          lines.push('');
        } else {
          lines.push(line.trim());
        }
      });
    } else {
      lines.push('暂无帮助内容');
    }
    return lines.join('\n');
  }

  async function generateImage(slot = '', text = '') {
    if (!renderMarkdown) {
      throw createHttpError(500, '帮助图片生成能力未启用（缺少渲染器）', 'HELP_DIY_RENDERER_MISSING');
    }
    const safeSlot = sanitizeUploadPrefix(String(slot || 'help'));
    const markdown = buildHelpDiyMarkdown(String(slot || ''), text);
    const imagePath = await renderMarkdown(markdown);
    if (!imagePath || !fs.existsSync(imagePath)) {
      throw createHttpError(500, '帮助图片生成失败，渲染器未返回图片', 'HELP_DIY_RENDER_FAILED');
    }
    const buffer = fs.readFileSync(imagePath);
    if (buffer.length <= 0) {
      throw createHttpError(500, '帮助图片生成失败，图片数据为空', 'HELP_DIY_RENDER_EMPTY');
    }
    const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
    return saveImage(dataUrl, safeSlot);
  }

  async function generateMiaoImage(slot = '', text = '', style = null) {
    const safeSlot = sanitizeUploadPrefix(String(slot || 'help'));
    const body = String(text || '').trim();
    if (!body) {
      throw createHttpError(400, '帮助内容为空，无法生成帮助卡片', 'HELP_DIY_MIAO_EMPTY');
    }
    const outputDir = path.join(process.cwd(), 'temp', 'crystelf-plugin', 'help-miao');
    await fs.promises.mkdir(outputDir, { recursive: true });
    const imagePath = path.join(outputDir, `miao-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
    try {
      const normalizedStyle = normalizeMiaoStyle(style ?? (await getStoredPayload())?.miaoStyle);
      await renderMiaoHelpCard(body, { outputPath: imagePath, style: normalizedStyle, uploadDir });
      if (!fs.existsSync(imagePath)) {
        throw createHttpError(500, '帮助卡片生成失败，渲染器未返回图片', 'HELP_DIY_MIAO_RENDER_FAILED');
      }
      const buffer = fs.readFileSync(imagePath);
      if (buffer.length <= 0) {
        throw createHttpError(500, '帮助卡片生成失败，图片数据为空', 'HELP_DIY_MIAO_RENDER_EMPTY');
      }
      const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      return saveImage(dataUrl, safeSlot);
    } finally {
      fs.promises.rm(imagePath, { force: true }).catch(() => {});
    }
  }

  async function previewMiaoImage(slot = '', text = '', style = null) {
    const body = String(text || '').trim();
    if (!body) {
      throw createHttpError(400, '帮助内容为空，无法实时预览帮助卡片', 'HELP_DIY_MIAO_PREVIEW_EMPTY');
    }
    const outputDir = path.join(process.cwd(), 'temp', 'crystelf-plugin', 'help-miao');
    await fs.promises.mkdir(outputDir, { recursive: true });
    const imagePath = path.join(outputDir, `miao-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
    try {
      const normalizedStyle = normalizeMiaoStyle(style ?? (await getStoredPayload())?.miaoStyle);
      await renderMiaoHelpCard(body, { outputPath: imagePath, style: normalizedStyle, uploadDir });
      if (!fs.existsSync(imagePath)) {
        throw createHttpError(500, '帮助卡片实时预览失败，渲染器未返回图片', 'HELP_DIY_MIAO_PREVIEW_FAILED');
      }
      const buffer = await fs.promises.readFile(imagePath);
      return { dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
    } finally {
      fs.promises.rm(imagePath, { force: true }).catch(() => {});
    }
  }

  async function generateHtmlImage(slot = '', html = '') {
    if (!renderHtml) {
      throw createHttpError(500, 'HTML 图片生成能力未启用（缺少渲染器）', 'HELP_DIY_HTML_RENDERER_MISSING');
    }
    const source = String(html || '').trim();
    if (!source) {
      throw createHttpError(400, 'HTML 内容为空，无法生成图片', 'HELP_DIY_HTML_EMPTY');
    }
    if (source.length > htmlMaxChars) {
      throw createHttpError(413, `HTML 内容过大，最大允许 ${Math.round(htmlMaxChars / 1024)} KB`, 'HELP_DIY_HTML_TOO_LARGE');
    }
    const safeSlot = sanitizeUploadPrefix(String(slot || 'help'));
    const imagePath = await renderHtml(source);
    if (!imagePath || !fs.existsSync(imagePath)) {
      throw createHttpError(500, 'HTML 图片生成失败，渲染器未返回图片', 'HELP_DIY_HTML_RENDER_FAILED');
    }
    const buffer = fs.readFileSync(imagePath);
    if (buffer.length <= 0) {
      throw createHttpError(500, 'HTML 图片生成失败，图片数据为空', 'HELP_DIY_HTML_RENDER_EMPTY');
    }
    const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
    return saveImage(dataUrl, safeSlot);
  }

  function deleteImage(urlPath = '') {
    const normalized = String(urlPath || '').trim();
    if (!normalized.startsWith('/uploads/help-diy/')) {
      throw createHttpError(400, '只允许删除 help DIY 上传目录中的图片', 'HELP_DIY_IMAGE_DELETE_FORBIDDEN');
    }
    const relativeUploadPath = path.posix.normalize(`/${normalized.slice('/uploads/help-diy/'.length)}`).replace(/^\/+/, '');
    if (!relativeUploadPath || relativeUploadPath.startsWith('..')) {
      throw createHttpError(400, '图片路径越界，拒绝删除', 'HELP_DIY_IMAGE_PATH_OUT_OF_RANGE');
    }
    const filePath = path.resolve(uploadDir, relativeUploadPath.replace(/\//g, path.sep));
    ensurePathResolvedWithinRoot(filePath, uploadDir, { allowMissing: true });
    if (fs.existsSync(filePath)) {
      const realFilePath = getRealPathSafe(filePath) || filePath;
      if (!isPathInsideRoot(realFilePath, getRealPathSafe(uploadDir) || uploadDir)) {
        throw createHttpError(400, '图片路径越界，拒绝删除', 'HELP_DIY_IMAGE_PATH_OUT_OF_RANGE');
      }
      fs.unlinkSync(realFilePath);
    }
    return true;
  }

  function getDefaultPayload() {
    return {
      enabled: false,
      updatedAt: '',
      home: {
        mode: 'miao',
        text: [
          '灵晶帮助',
          '━━━━━━━━━━━━',
          '',
          '开始使用',
          '- #灵晶帮助 AI  对话、工具、画像与好感',
          '- #灵晶帮助 管理  验证、欢迎、总结与头衔',
          '- #灵晶帮助 娱乐  早报、点歌、RSS 与互动',
          '- #灵晶帮助 调试  控制台、日志与排查入口',
          '',
          'AI 对话',
          '- @机器人 问题  直接和灵晶聊天',
          '- #重置对话  清空当前会话上下文',
          '- #查看会话状态  查看会话运行状态',
          '- #查看好感度  查看当前好感度',
          '- #好感排行  查看好感排行榜',
          '- #查看用户画像  查看用户画像',
          '',
          'ZCode Agent',
          '- #zcode 任务  主人下发完整 Agent 任务（可改文件/联网）',
          '- #zcode只读 任务  只读分析档，不改文件不联网',
          '- #zcode状态 / #zcode停止  查看进展 / 中断任务',
          '',
          '群管理',
          '- #灵晶开启群管理  开启本群管理功能',
          '- #灵晶关闭群管理  关闭本群管理功能',
          '- #开启验证 / #关闭验证  入群验证开关',
          '- #切换验证模式  切换验证方式',
          '- #设置欢迎文案 欢迎词  自定义入群欢迎',
          '- #群总结  生成群聊精华总结',
          '- #申请头衔 你的头衔  申请专属群头衔',
          '',
          '内容娱乐',
          '- 早报 / 60s  每日新闻早报',
          '- 早安 / 晚安  日常问候互动',
          '- 戳一戳机器人  戳一下有惊喜',
          '- #回应 内容  让机器人接一句话',
          '- #点歌 歌名  搜索并播放歌曲',
          '- #rss列表  查看 RSS 订阅列表',
          '',
          '状态排查',
          '- #灵晶状态  查看插件运行状态',
          '- #今日AI用量  查看今日 AI 用量',
          '- #查看知识命中  查看知识库命中',
          '- #灵晶排查日志  自动分析近期日志',
          '- #灵晶修复依赖  修复缺失依赖',
          '- #更新灵晶  更新到最新版本',
          '',
          '控制台',
          '- 网页控制台  入口请联系机器人主人',
          '- 用户帮助 DIY  自定义这张帮助卡片',
        ].join('\n'),
        image: '/uploads/help-diy/lingjing-help-home.png',
      },
      categories: {
        ai: {
          mode: 'miao',
          text: [
            '灵晶帮助 · AI 对话',
            '━━━━━━━━━━━━',
            '',
            '触发',
            '- @机器人 + 问题  直接和灵晶聊天',
            '- 机器人昵称 + 问题  群里呼出灵晶',
            '- 私聊直接发送问题  无需命令前缀',
            '',
            '会话命令',
            '- #重置对话 / #重置会话  清空当前会话上下文',
            '- #查看会话状态  查看会话运行状态',
            '- #查看知识命中  查看知识库命中',
            '- #查看工具调用  查看工具调用记录',
            '',
            '用户数据',
            '- #查看好感度  查看当前好感度',
            '- #好感排行  查看好感排行榜',
            '- #查看用户画像  查看用户画像',
            '',
            '能力',
            '- 联网搜索  回答时检索最新资料',
            '- 网页正文读取  总结链接内容',
            '- 多模态图片理解  发图即可识别',
            '- 表情包与语音回复  更自然的对话',
            '- HTTP skills 工具调用  扩展自定义能力',
            '',
            'ZCode Agent（仅主人）',
            '- #zcode 任务  完整 Agent：可改文件/联网/执行命令',
            '- #zcode只读 任务  只读分析档：不改文件不联网',
            '- #zcode状态 / #zcode停止 / #zcode新会话  进展、中断与重置',
            '',
            '提示',
            '- 使用前请确认 AI 接口、模型和工具配置可用',
          ].join('\n'),
          image: '/uploads/help-diy/lingjing-help-ai.png',
        },
        manage: {
          mode: 'miao',
          text: [
            '灵晶帮助 · 群管理',
            '━━━━━━━━━━━━',
            '',
            '本群群管',
            '- #灵晶开启群管理',
            '- #灵晶关闭群管理',
            '',
            '入群验证',
            '- #开启验证',
            '- #关闭验证',
            '- #切换验证模式',
            '- #设置验证提示模式开启',
            '- #设置验证困难模式开启',
            '- #设置验证次数3',
            '- #重新验证 @某人',
            '- #绕过验证 @某人',
            '',
            '入群欢迎',
            '- #设置欢迎文案 欢迎词  自定义入群欢迎',
            '- #设置欢迎图片  自定义入群欢迎图',
            '- #查看欢迎  查看当前欢迎配置',
            '- #清除欢迎  恢复默认欢迎',
            '',
            '群运营',
            '- #群总结  生成群聊精华总结',
            '- #申请头衔 你的头衔  申请专属群头衔',
            '- #头衔申请列表  查看待审批申请',
            '- #同意头衔 编号  同意对应申请',
            '- #拒绝头衔 编号 理由  拒绝并附理由',
            '- #取消头衔申请  撤回我的申请',
            '',
            '说明',
            '- 群管理命令通常需要群主或管理员权限',
            '- 群头衔发放需要机器人具备对应群权限',
          ].join('\n'),
          image: '/uploads/help-diy/lingjing-help-manage.png',
        },
        fun: {
          mode: 'miao',
          text: [
            '灵晶帮助 · 内容娱乐',
            '━━━━━━━━━━━━',
            '',
            '日常互动',
            '- 60s / 早报',
            '- 早安 / 晚安',
            '- 戳一戳机器人',
            '- #回应 内容',
            '',
            '点歌',
            '- #点歌 歌名',
            '- #听 歌名',
            '- #听 1',
            '',
            'RSS',
            '- #rss添加 订阅地址',
            '- #rss列表',
            '- #rss移除0',
            '- #rss拉取 订阅地址',
            '',
            '提示',
            '- RSS 和点歌需要对应功能开关启用',
          ].join('\n'),
          image: '/uploads/help-diy/lingjing-help-fun.png',
        },
        debug: {
          mode: 'miao',
          text: [
            '灵晶帮助 · 调试排查',
            '━━━━━━━━━━━━',
            '',
            '控制台',
            `- 地址：${getWebConsoleDisplayUrl()}`,
            '- 配置、日志、会话、画像、好感和用量',
            '- 图片监控、群管理、Help DIY 与 Skills 设置',
            '',
            '群内排查',
            '- #查看会话状态  会话运行状态',
            '- #查看知识命中  知识库命中情况',
            '- #查看工具调用  工具调用记录',
            '- #灵晶排查日志  自动分析近期日志',
            '- #灵晶修复依赖  修复缺失依赖',
            '- #灵晶修复依赖状态  查看修复进度',
            '- #更新灵晶  更新到最新版本',
            '- #强制更新灵晶  强制重新拉取更新',
            '',
            '建议',
            '- 接口异常先看控制台日志和 AI 用量日志',
            '- 外网控制台务必设置强口令并限制访问来源',
          ].join('\n'),
          image: '/uploads/help-diy/lingjing-help-debug.png',
        },
      },
    };
  }

  function normalizeBlock(block, fallbackText = '') {
    if (typeof block === 'string') {
      return { mode: 'text', text: block.trim(), image: '' };
    }
    const source = block && typeof block === 'object' && !Array.isArray(block) ? block : {};
    const text = String(Object.hasOwn(source, 'text') ? source.text ?? '' : fallbackText).trim();
    const image = String(source.image || '').trim();
    let mode = ['image', 'miao'].includes(source.mode) ? source.mode : 'text';
    //帮助卡片（miao 模式）必须有文本可渲染，否则回退静态图或文本
    if (mode === 'miao' && !text) {
      mode = image ? 'image' : 'text';
    }
    return { mode, text, image };
  }

  function normalizeBlockUpdate(block, current) {
    if (typeof block === 'string') return normalizeBlock(block);
    const source = block && typeof block === 'object' && !Array.isArray(block) ? block : {};
    return normalizeBlock({ ...current, ...source });
  }

  function buildTextBlock(lines = []) {
    return {
      mode: 'text',
      text: Array.isArray(lines) ? lines.join('\n') : String(lines || ''),
      image: '',
    };
  }

  function getTemplates() {
    const webConsoleUrl = getWebConsoleDisplayUrl();
    return [
      {
        key: 'simple',
        label: '清爽导航版',
        description: '适合普通群使用，入口短、分类清楚，群员不用读长说明。',
        payload: {
          enabled: true,
          home: buildTextBlock([
            '灵晶帮助',
            '━━━━━━━━━━━━',
            '',
            '#灵晶帮助 AI      对话与工具',
            '#灵晶帮助 管理    入群与群运营',
            '#灵晶帮助 娱乐    早报、点歌、RSS',
            '#灵晶帮助 调试    状态与控制台',
            '',
            '常用',
            '- @机器人 直接聊天',
            '- #群总结',
            '- #rss列表',
          ]),
          categories: {
            ai: buildTextBlock(['AI 对话', '━━━━━━━━━━━━', '', '- @机器人 提问', '- #重置对话', '- #查看会话状态', '- #查看知识命中', '- #查看工具调用']),
            manage: buildTextBlock(['群管理', '━━━━━━━━━━━━', '', '- #灵晶开启群管理 / #灵晶关闭群管理', '- #开启验证 / #关闭验证', '- #设置欢迎文案 欢迎词', '- #群总结', '- #申请头衔 你的头衔']),
            fun: buildTextBlock(['内容娱乐', '━━━━━━━━━━━━', '', '- 60s / 早报', '- #点歌 歌名', '- #听 1', '- #rss列表']),
            debug: buildTextBlock(['调试入口', '━━━━━━━━━━━━', '', `- 控制台 ${webConsoleUrl}`, '- #查看会话状态', '- #查看工具调用', '- #灵晶修复依赖']),
          },
        },
      },
      {
        key: 'full',
        label: '完整默认版',
        description: '直接恢复为当前内置的完整默认帮助内容。',
        payload: {
          ...getDefaultPayload(),
          enabled: true,
        },
      },
      {
        key: 'admin',
        label: '群管运维版',
        description: '适合管理员群，突出验证、欢迎、头衔、总结和控制台排障。',
        payload: {
          enabled: true,
          home: buildTextBlock([
            '灵晶群管帮助',
            '━━━━━━━━━━━━',
            '',
            '群管理',
            '- #灵晶帮助 管理',
            '- #群总结',
            '- #头衔申请列表',
            '',
            'AI 与排查',
            '- #灵晶帮助 AI',
            '- #灵晶帮助 调试',
            `- 控制台 ${webConsoleUrl}`,
          ]),
          categories: {
            ai: buildTextBlock(['AI 与用户数据', '━━━━━━━━━━━━', '', '- @机器人 直接对话', '- #查看会话状态', '- #查看知识命中', '- #查看工具调用', '- #查看用户画像', '- #好感排行']),
            manage: buildTextBlock(['群管理命令', '━━━━━━━━━━━━', '', '- #灵晶开启群管理 / #灵晶关闭群管理', '- #开启验证 / #关闭验证', '- #切换验证模式', '- #重新验证 @某人', '- #绕过验证 @某人', '- #设置欢迎文案 欢迎词', '- #群总结', '- #申请头衔 你的头衔', '- #同意头衔 编号']),
            fun: buildTextBlock(['内容娱乐', '━━━━━━━━━━━━', '', '- 60s / 早报', '- #点歌 歌名', '- #听 1', '- #rss添加 订阅地址', '- #rss列表', '- #rss移除0']),
            debug: buildTextBlock(['控制台与排查', '━━━━━━━━━━━━', '', `- 控制台 ${webConsoleUrl}`, '- #查看会话状态', '- #查看知识命中', '- #查看工具调用', '- #灵晶排查日志', '- #灵晶修复依赖', '- #灵晶修复依赖状态', '- #更新灵晶', '- #强制更新灵晶']),
          },
        },
      },
    ];
  }

  async function getStoredPayload() {
    const cached = getStoredConfig();
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      return cached;
    }

    const local = safeReadJson(helpDiyFile, null);
    if (local && typeof local === 'object' && !Array.isArray(local)) {
      return local;
    }

    const legacy = safeReadJson(legacyHelpDiyFile, null);
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      await setStoredConfig(legacy);
      return legacy;
    }

    return null;
  }

  async function buildPayload() {
    const defaults = getDefaultPayload();
    let payload = await getStoredPayload();

    if (!payload) {
      payload = {
        ...defaults,
        updatedAt: new Date().toISOString(),
      };
      await setStoredConfig(payload);
    }

    return {
      ...defaults,
      ...payload,
      miaoStyle: normalizeMiaoStyle(payload?.miaoStyle),
      home: normalizeBlock(payload?.home, defaults.home.text),
      categories: {
        ai: normalizeBlock(payload?.categories?.ai, defaults.categories.ai.text),
        manage: normalizeBlock(payload?.categories?.manage, defaults.categories.manage.text),
        fun: normalizeBlock(payload?.categories?.fun, defaults.categories.fun.text),
        debug: normalizeBlock(payload?.categories?.debug, defaults.categories.debug.text),
      },
    };
  }

  function sanitizeHistoryNote(value = '') {
    return replaceControlCharacters(value, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function buildHistoryPayload() {
    const items = safeReadJson(historyFile, null);
    if (Array.isArray(items)) {
      return items.map(item => ({
        ...item,
        note: sanitizeHistoryNote(item?.note),
      }));
    }
    safeWriteJson(historyFile, []);
    return [];
  }

  function pushHistorySnapshot(payload = {}, note = '') {
    const current = buildHistoryPayload();
    const next = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        savedAt: new Date().toISOString(),
        note: sanitizeHistoryNote(note),
        payload,
      },
      ...current,
    ].slice(0, 20);
    safeWriteJson(historyFile, next);
    return next;
  }

  function deleteHistoryItem(id = '') {
    const current = buildHistoryPayload();
    const next = current.filter(item => item?.id !== String(id || '').trim());
    safeWriteJson(historyFile, next);
    return next;
  }

  function clearHistory() {
    safeWriteJson(historyFile, []);
    return [];
  }

  //预览与保存共用合并逻辑：仅样式的导入不覆盖内容，旧模板缺少样式时沿用当前值。
  function normalizePayloadUpdate(payload, current) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const suppliedStyle = source.miaoStyle && typeof source.miaoStyle === 'object' && !Array.isArray(source.miaoStyle)
      ? source.miaoStyle : {};
    return {
      enabled: Object.hasOwn(source, 'enabled') ? source.enabled === true : current.enabled === true,
      miaoStyle: normalizeMiaoStyle({ ...current.miaoStyle, ...suppliedStyle }),
      home: Object.hasOwn(source, 'home') ? normalizeBlockUpdate(source.home, current.home) : current.home,
      categories: Object.fromEntries(['ai', 'manage', 'fun', 'debug'].map(key => [
        key,
        Object.hasOwn(source.categories || {}, key)
          ? normalizeBlockUpdate(source.categories[key], current.categories[key])
          : current.categories[key],
      ])),
    };
  }

  let saveQueue = Promise.resolve();

  function savePayload(payload = {}) {
    //合并必须在前一笔写入完成后读取当前配置；失败不阻塞后续保存。
    const operation = saveQueue.then(async () => {
      const current = await buildPayload();
      const next = {
        ...current,
        ...normalizePayloadUpdate(payload, current),
        updatedAt: new Date().toISOString(),
      };
      await setStoredConfig(next);
      pushHistorySnapshot(next, payload?.historyNote);
      return next;
    });
    saveQueue = operation.catch(() => {});
    return operation;
  }

  async function buildImportPreviewPayload(payload = {}) {
    const current = await buildPayload();
    const next = normalizePayloadUpdate(payload, current);

    const changes = [];
    if (current.enabled !== next.enabled) changes.push('帮助自定义开关已变更');
    if (JSON.stringify(current.miaoStyle) !== JSON.stringify(next.miaoStyle)) changes.push('帮助卡片样式已变更');
    if (JSON.stringify(current.home || {}) !== JSON.stringify(next.home || {})) changes.push('首页帮助内容已变更');
    for (const key of ['ai', 'manage', 'fun', 'debug']) {
      if (JSON.stringify(current.categories?.[key] || {}) !== JSON.stringify(next.categories?.[key] || {})) {
        changes.push(`分类帮助内容已变更: ${key}`);
      }
    }

    return {
      success: true,
      changedCount: changes.length,
      changes,
      next,
    };
  }

  return {
    getTemplates,
    buildPayload,
    buildHistoryPayload,
    deleteHistoryItem,
    clearHistory,
    buildImportPreviewPayload,
    saveImage,
    deleteImage,
    savePayload,
    generateImage,
    generateHtmlImage,
    generateMiaoImage,
    previewMiaoImage,
  };
}
