import ConfigControl from '../lib/config/configControl.js';
import { renderCommandListImage } from '../lib/system/commandListImageRenderer.js';
import { resolveBotIdentity } from '../lib/system/botIdentity.js';

// 命令分类：保持与插件实际注册命令一致，新增命令时同步更新此处
function getCommandCategories() {
  return [
    {
      title: 'AI 对话',
      subtitle: '触发智能对话、会话管理与用户数据',
      tone: 'blue',
      commands: [
        { cmd: '@机器人 + 问题', desc: '艾特机器人进行 AI 对话' },
        { cmd: '机器人昵称 + 问题', desc: '呼唤昵称触发对话' },
        { cmd: '私聊直接发送', desc: '私聊直接与 AI 对话' },
        { cmd: '#重置对话', desc: '清空当前会话上下文（#重置会话 同义）' },
        { cmd: '#查看会话状态', desc: '查看当前会话上下文信息' },
        { cmd: '#查看知识命中', desc: '查看知识库检索命中情况' },
        { cmd: '#查看工具调用', desc: '查看近期工具调用记录' },
        { cmd: '#查看好感度', desc: '查看你对机器人好感度' },
        { cmd: '#重置好感度', desc: '重置好感度（管理员）' },
        { cmd: '#好感排行', desc: '查看本群好感度排行' },
        { cmd: '#查看用户画像', desc: '查看 AI 生成的用户画像' },
        { cmd: '#回应 内容', desc: '主动表情回应并查看 reaction' },
      ],
    },
    {
      title: '群管理',
      subtitle: '群管开关、入群验证、欢迎与头衔',
      tone: 'green',
      commands: [
        { cmd: '#灵晶开启群管理', desc: '开启本群风控管理' },
        { cmd: '#灵晶关闭群管理', desc: '关闭本群风控管理' },
        { cmd: '#开启验证', desc: '开启入群验证' },
        { cmd: '#关闭验证', desc: '关闭入群验证' },
        { cmd: '#切换验证模式', desc: '切换验证提示/困难模式' },
        { cmd: '#设置验证提示模式开启', desc: '开启提示模式' },
        { cmd: '#设置验证困难模式开启', desc: '开启困难模式' },
        { cmd: '#设置验证次数3', desc: '设置验证次数' },
        { cmd: '#设置撤回开启', desc: '验证消息撤回开关' },
        { cmd: '#重新验证 @某人', desc: '让某人重新通过验证' },
        { cmd: '#绕过验证 @某人', desc: '让某人直接通过验证' },
        { cmd: '#设置欢迎文案 欢迎词', desc: '设置入群欢迎文案' },
        { cmd: '#设置欢迎图片', desc: '设置入群欢迎图片' },
        { cmd: '#查看欢迎', desc: '查看当前欢迎设置' },
        { cmd: '#清除欢迎', desc: '清除欢迎设置' },
        { cmd: '#群总结', desc: '生成今日群聊总结' },
        { cmd: '#申请头衔 你的头衔', desc: '申请群头衔' },
        { cmd: '#头衔申请列表', desc: '查看头衔申请列表' },
        { cmd: '#同意头衔 编号', desc: '同意头衔申请（管理员）' },
        { cmd: '#拒绝头衔 编号 理由', desc: '拒绝头衔申请（管理员）' },
        { cmd: '#取消头衔申请', desc: '取消自己的头衔申请' },
      ],
    },
    {
      title: '内容娱乐',
      subtitle: '早报、点歌、RSS 与日常互动',
      tone: 'pink',
      commands: [
        { cmd: '60s', desc: '获取今日 60 秒早报（早报 同义）' },
        { cmd: '早安 / 早', desc: '早安问候互动' },
        { cmd: '晚安 / 安', desc: '晚安问候互动' },
        { cmd: '戳一戳机器人', desc: '戳一戳触发互动' },
        { cmd: '#点歌 歌名', desc: '搜索并点歌' },
        { cmd: '#听 歌名', desc: '直接播放指定歌曲' },
        { cmd: '#听 1', desc: '直接播放搜索结果第 N 首' },
        { cmd: '#发送 1', desc: '以文件形式发送第 N 首（#发 / #文件 同义）' },
        { cmd: '#rss添加 订阅地址', desc: '添加 RSS 订阅' },
        { cmd: '#rss列表', desc: '查看 RSS 订阅列表' },
        { cmd: '#rss移除0', desc: '按编号移除 RSS 订阅' },
        { cmd: '#rss拉取 订阅地址', desc: '立即拉取一次 RSS' },
        { cmd: '#合成语音 文字', desc: '合成并发送语音消息' },
        { cmd: '#灵晶语音模型', desc: '查看当前语音模型' },
        { cmd: '#灵晶切换语音模型', desc: '查看可切换模型列表' },
        { cmd: '#灵晶切换语音模型 名字', desc: '直接切换指定语音模型' },
        { cmd: '#灵晶重置语音模型', desc: '重置为默认语音模型' },
      ],
    },
    {
      title: '调试维护',
      subtitle: '控制台、日志、依赖与更新',
      tone: 'amber',
      commands: [
        { cmd: '#灵晶状态', desc: '查看插件运行状态图片' },
        { cmd: '#灵晶帮助', desc: '查看帮助导航（可带分类）' },
        { cmd: '#灵晶排查日志', desc: 'AI 排查近期日志' },
        { cmd: '#灵晶修复依赖', desc: '触发依赖修复' },
        { cmd: '#灵晶修复依赖状态', desc: '查看依赖修复状态' },
        { cmd: '#修复依赖', desc: '管理员准备修复依赖' },
        { cmd: '确认修复依赖', desc: '确认执行依赖修复' },
        { cmd: '取消修复依赖', desc: '取消依赖修复' },
        { cmd: '#更新灵晶', desc: '更新灵晶插件' },
        { cmd: '#强制更新灵晶', desc: '准备强制更新插件' },
        { cmd: '确认强制更新灵晶', desc: '确认强制更新' },
        { cmd: '取消强制更新灵晶', desc: '取消强制更新' },
        { cmd: '#灵晶登录', desc: '获取控制台一次性登录链接（仅私聊）' },
      ],
    },
  ];
}

function getProfileName() {
  try {
    const allConfigs = ConfigControl.get();
    return String(allConfigs?.profile?.nickName || allConfigs?.profile?.nickname || '魔丸').trim() || '魔丸';
  } catch {
    return '魔丸';
  }
}

export class CrystelfCommandList extends plugin {
  constructor() {
    super({
      name: 'crystelf-command-list',
      dsc: '灵晶插件命令列表图片',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^#灵晶命令列表$',
          fnc: 'showCommandList',
        },
      ],
    });
  }

  async showCommandList(e) {
    const profileName = getProfileName();
    const identity = resolveBotIdentity(e, profileName);
    const data = {
      ...identity,
      generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      categories: getCommandCategories(),
    };

    try {
      const imagePath = await renderCommandListImage(data);
      if (imagePath) {
        return e.reply(segment.image(imagePath), true);
      }
    } catch (err) {
      logger?.error?.(`[crystelf-command-list] 渲染命令列表图片失败：${err?.message || err}`);
    }

    return e.reply('命令列表图片生成失败，请稍后重试或查看 #灵晶帮助', true);
  }
}
