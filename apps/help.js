import ConfigControl from '../lib/config/configControl.js';
import fs from 'fs';
import path from 'path';
import Path from '../constants/path.js';

const HELP_DIY_FILE = path.join(Path.config, 'help-diy.json');
const LEGACY_HELP_DIY_FILE = path.join(process.cwd(), 'data', 'crystelf', 'help-diy.json');
const WEB_CONSOLE_PUBLIC_DIR = path.join(Path.lib, 'webConsole', 'public');
const HELP_DIY_UPLOAD_DIR = path.join(WEB_CONSOLE_PUBLIC_DIR, 'uploads', 'help-diy');
const DEFAULT_HELP_IMAGE = '/uploads/help-diy/default-help-navigation.png';

function normalizePathForComparison(value = '') {
  const normalized = path.resolve(String(value || ''));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathInsideRoot(targetPath, rootPath) {
  const normalizedTarget = normalizePathForComparison(targetPath);
  const normalizedRoot = normalizePathForComparison(rootPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function getRealPathSafe(targetPath) {
  try {
    if (typeof fs.realpathSync.native === 'function') {
      return fs.realpathSync.native(targetPath);
    }
    return fs.realpathSync(targetPath);
  } catch {
    return null;
  }
}

function resolveHelpDiyImageSource(value = '') {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/uploads/help-diy/')) {
    return '';
  }

  const relativeUploadPath = path.posix.normalize(`/${raw.slice('/uploads/help-diy/'.length)}`).replace(/^\/+/, '');
  if (!relativeUploadPath || relativeUploadPath.startsWith('..')) {
    return '';
  }

  const uploadRoot = getRealPathSafe(HELP_DIY_UPLOAD_DIR) || path.resolve(HELP_DIY_UPLOAD_DIR);
  const targetPath = path.resolve(HELP_DIY_UPLOAD_DIR, relativeUploadPath.split('/').join(path.sep));
  if (!isPathInsideRoot(targetPath, HELP_DIY_UPLOAD_DIR)) {
    return '';
  }
  if (!fs.existsSync(targetPath)) {
    return '';
  }

  const targetRealPath = getRealPathSafe(targetPath) || targetPath;
  if (!isPathInsideRoot(targetRealPath, uploadRoot)) {
    return '';
  }

  return targetRealPath;
}

function sanitizeHelpDiyImageValue(value = '') {
  const raw = String(value || '').trim();
  return resolveHelpDiyImageSource(raw) ? raw : '';
}

function getWebConsoleDisplayUrl() {
  const config = ConfigControl.get('config') || {};
  const rawHost = String(config.webConsoleHost || '0.0.0.0').trim() || '0.0.0.0';
  const host = rawHost === '0.0.0.0' || rawHost === '::' ? '127.0.0.1' : rawHost;
  const port = Number(config.webConsolePort) || 27891;
  return `http://${host}:${port}/`;
}

function safeReadHelpDiyFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

function getDefaultHelpContent() {
  const webConsoleUrl = getWebConsoleDisplayUrl();
  return {
    home: {
      mode: 'image',
      text: [
        '灵晶插件帮助导航',
        '━━━━━━━━━━━━',
        '',
        '发送分类命令查看完整说明：',
        '- #灵晶帮助 AI      对话、工具、画像与好感',
        '- #灵晶帮助 管理    验证、欢迎、总结与头衔',
        '- #灵晶帮助 娱乐    早报、点歌、RSS 与互动',
        '- #灵晶帮助 调试    控制台、日志与排查入口',
        '',
        '常用入口',
        '- @机器人 直接对话',
        '- #群总结',
        '- #申请头衔 你的头衔',
        '- #rss列表',
        '- #查看会话状态',
        '- #灵晶状态',
        '- #今日AI用量',
        '- #查看进程（主人）',
        '- #灵晶 功能状态',
        '',
        '控制台',
        `- ${webConsoleUrl}`,
        '- 用户帮助 DIY 可以改这里的文案或图片',
      ].join('\n'),
      image: DEFAULT_HELP_IMAGE,
    },
    categories: {
      ai: {
        mode: 'text',
        text: [
          '灵晶帮助 · AI 对话',
          '━━━━━━━━━━━━',
          '',
          '触发',
          '- @机器人 + 问题',
          '- 机器人昵称 + 问题',
          '- 私聊直接发送问题',
          '',
          '会话命令',
          '- #重置对话 / #重置会话',
          '- #查看会话状态',
          '- #查看知识命中',
          '- #查看工具调用',
          '',
          '用户数据',
          '- #查看好感度',
          '- #好感排行',
          '- #查看用户画像',
          '',
          '用量查询',
          '- #今日AI用量',
          '',
          '能力',
          '- 联网搜索',
          '- 网页正文读取',
          '- 多模态图片理解',
          '- 表情包与语音回复',
          '- HTTP skills 工具调用',
          '',
          '提示',
          '- 使用前请确认 AI 接口、模型和工具配置可用',
        ].join('\n'),
        image: '',
      },
      manage: {
        mode: 'text',
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
          '- #设置欢迎文案 欢迎词',
          '- #设置欢迎图片',
          '- #查看欢迎',
          '- #清除欢迎',
          '',
          '群运营',
          '- #群总结',
          '- #申请头衔 你的头衔',
          '- #头衔申请列表',
          '- #同意头衔 编号',
          '- #拒绝头衔 编号 理由',
          '- #取消头衔申请',
          '',
          '功能开关',
          '- #灵晶 开启/关闭 戳一戳',
          '- #灵晶 开启/关闭 表情回复',
          '- #灵晶 开启/关闭 早晚安',
          '- #灵晶 开启/关闭 帮助',
          '- #灵晶 功能状态',
          '',
          '说明',
          '- 群管理命令通常需要群主或管理员权限',
          '- 群头衔发放需要机器人具备对应群权限',
          '- 功能开关仅群主、管理员或主人可执行',
        ].join('\n'),
        image: '',
      },
      fun: {
        mode: 'text',
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
        image: '',
      },
      debug: {
        mode: 'text',
        text: [
          '灵晶帮助 · 调试排查',
          '━━━━━━━━━━━━',
          '',
          '控制台',
          `- 地址：${webConsoleUrl}`,
          '- #灵晶登录',
          '- 配置、日志、会话、画像、好感和用量',
          '- 图片监控、群管理、Help DIY 与 Skills 设置',
          '',
          '群内排查',
          '- #查看会话状态',
          '- #查看知识命中',
          '- #查看工具调用',
          '- #灵晶状态',
          '- #今日AI用量',
          '- #查看进程（主人）',
          '- #灵晶排查日志',
          '- #灵晶修复依赖',
          '- #灵晶修复依赖状态',
          '- #修复依赖',
          '- 确认修复依赖',
          '- 取消修复依赖',
          '- #更新灵晶',
          '- #强制更新灵晶',
          '- 确认强制更新灵晶',
          '- 取消强制更新灵晶',
          '',
          '建议',
          '- 接口异常先看控制台日志和 AI 用量日志',
          '- 外网控制台务必设置强口令并限制访问来源',
        ].join('\n'),
        image: '',
      },
    },
  };
}

export default class CrystelfHelp extends plugin {
  constructor() {
    super({
      name: 'crystelf-help',
      dsc: '灵晶插件帮助',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^#灵晶帮助(?:\\s*(.+))?$',
          fnc: 'showHelp',
        },
      ],
    });
  }

  async showHelp(e) {
    if (!ConfigControl.get()?.config?.help) {
      return;
    }

    const rawCategory = e.msg.replace(/^#灵晶帮助/, '').trim().toLowerCase();
    const category = this.normalizeCategory(rawCategory);
    const content = this.getHelpContent();

    if (category) {
      return this.replyHelpBlock(e, this.buildCategoryHelp(category, content));
    }

    return this.replyHelpBlock(e, content.home);
  }

  async replyHelpBlock(e, block) {
    if (block?.mode === 'image' && block?.image) {
      const imageSource = resolveHelpDiyImageSource(block.image);
      if (imageSource) {
        return e.reply(segment.image(imageSource));
      }
    }
    return e.reply(block?.text || '未找到帮助内容。', true);
  }

  normalizeHelpBlock(block, fallbackText = '') {
    if (typeof block === 'string') {
      return { mode: 'text', text: block || fallbackText, image: '' };
    }
    const image = sanitizeHelpDiyImageValue(block?.image);
    return {
      mode: block?.mode === 'image' && image ? 'image' : 'text',
      text: String(block?.text || fallbackText || '').trim(),
      image,
    };
  }

  getHelpContent() {
    const defaults = getDefaultHelpContent();
    const custom = ConfigControl.get('help-diy')
      || safeReadHelpDiyFile(HELP_DIY_FILE)
      || safeReadHelpDiyFile(LEGACY_HELP_DIY_FILE)
      || {};
    if (custom.enabled !== true) {
      return defaults;
    }
    return {
      home: this.normalizeHelpBlock(custom.home, defaults.home.text),
      categories: {
        ai: this.normalizeHelpBlock(custom?.categories?.ai, defaults.categories.ai.text),
        manage: this.normalizeHelpBlock(custom?.categories?.manage, defaults.categories.manage.text),
        fun: this.normalizeHelpBlock(custom?.categories?.fun, defaults.categories.fun.text),
        debug: this.normalizeHelpBlock(custom?.categories?.debug, defaults.categories.debug.text),
      },
    };
  }

  normalizeCategory(raw = '') {
    if (!raw) return '';
    if (['ai', '智能', '对话', '聊天', '模型', '工具'].includes(raw)) return 'ai';
    if (['管理', '群管理', 'admin', 'group', '验证', '欢迎', '总结', '头衔'].includes(raw)) return 'manage';
    if (['娱乐', '内容', 'music', 'rss', 'fun', '点歌', '早报', '互动'].includes(raw)) return 'fun';
    if (['调试', '排查', '日志', 'webui', '控制台', 'sandbox', 'debug'].includes(raw)) return 'debug';
    return '';
  }

  buildCategoryHelp(category, content = this.getHelpContent()) {
    return content?.categories?.[category] || { mode: 'text', text: '未找到对应帮助分类。', image: '' };
  }
}
