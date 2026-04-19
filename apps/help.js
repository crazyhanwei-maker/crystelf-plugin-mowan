import ConfigControl from '../lib/config/configControl.js';
import fs from 'fs';
import path from 'path';
import Path from '../constants/path.js';

const HELP_DIY_FILE = path.join(Path.config, 'help-diy.json');
const LEGACY_HELP_DIY_FILE = path.join(process.cwd(), 'data', 'crystelf', 'help-diy.json');

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
  return {
    home: {
      mode: 'text',
      text: [
        '灵晶帮助',
        '',
        '发送以下命令查看分类帮助：',
        '1. #灵晶帮助 AI',
        '2. #灵晶帮助 管理',
        '3. #灵晶帮助 娱乐',
        '4. #灵晶帮助 调试',
        '',
        '常用入口：',
        '- #灵晶帮助 AI',
        '- #灵晶帮助 管理',
        '- #灵晶帮助 调试',
        '',
        '说明',
        '如需更完整说明，请查看插件 README.md',
      ].join('\n'),
      image: '',
    },
    categories: {
      ai: {
        mode: 'text',
        text: [
          '灵晶帮助 · AI',
          '',
          '触发方式',
          '1. @机器人 直接对话',
          '2. 昵称开头直接对话',
          '',
          '支持能力',
          '- 联网搜索',
          '- 网页正文读取',
          '- 表情包',
          '- 语音',
          '- 多模态图片理解',
          '- Markdown 与代码渲染',
          '',
          '使用说明',
          '使用前请先确认 AI 与工具配置可用',
        ].join('\n'),
        image: '',
      },
      manage: {
        mode: 'text',
        text: [
          '灵晶帮助 · 管理',
          '',
          '验证功能',
          '1. #开启验证',
          '2. #关闭验证',
          '3. #切换验证模式',
          '4. #重新验证@某人',
          '5. #绕过验证@某人',
          '',
          '欢迎功能',
          '6. #设置欢迎文案+欢迎词',
          '7. #设置欢迎图片',
          '8. #查看欢迎',
          '9. #清除欢迎',
        ].join('\n'),
        image: '',
      },
      fun: {
        mode: 'text',
        text: [
          '灵晶帮助 · 娱乐',
          '',
          '基础功能',
          '1. 60s / 早报',
          '2. 早安 / 晚安',
          '3. #回应+emoji',
          '',
          'RSS 功能',
          '4. #rss添加+订阅地址',
          '5. #rss移除+id',
          '6. #rss拉取+订阅地址',
          '',
          '点歌功能',
          '7. #点歌 歌名',
          '8. #听 歌名',
          '9. #听 1',
        ].join('\n'),
        image: '',
      },
      debug: {
        mode: 'text',
        text: [
          '灵晶帮助 · 调试',
          '',
          '本地控制台',
          '- 地址：http://127.0.0.1:27891/',
          '- 可查看健康状态、日志、画像、好感和会话',
          '',
          '网页调试沙箱',
          '- 可进行提示词调试',
          '- 可查看工具调用时间线',
          '- 可进行网页阅读测试',
          '- 可查看表情包与语音结果',
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
          reg: '^#灵晶帮助(?:\s*(.+))?$',
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
      const imageSource = String(block.image || '').startsWith('/uploads/help-diy/')
        ? path.join(process.cwd(), 'lib', 'webConsole', 'public', String(block.image || '').replace(/^\//, '').replace(/\//g, path.sep))
        : block.image;
      return e.reply(segment.image(imageSource));
    }
    return e.reply(block?.text || '未找到帮助内容。', true);
  }

  normalizeHelpBlock(block, fallbackText = '') {
    if (typeof block === 'string') {
      return { mode: 'text', text: block || fallbackText, image: '' };
    }
    return {
      mode: block?.mode === 'image' && String(block?.image || '').trim() ? 'image' : 'text',
      text: String(block?.text || fallbackText || '').trim(),
      image: String(block?.image || '').trim(),
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
    if (['ai', '智能', '对话'].includes(raw)) return 'ai';
    if (['管理', 'admin', 'group'].includes(raw)) return 'manage';
    if (['娱乐', 'music', 'rss', 'fun'].includes(raw)) return 'fun';
    if (['调试', 'webui', '控制台', 'sandbox'].includes(raw)) return 'debug';
    return '';
  }

  buildCategoryHelp(category, content = this.getHelpContent()) {
    return content?.categories?.[category] || { mode: 'text', text: '未找到对应帮助分类。', image: '' };
  }
}
