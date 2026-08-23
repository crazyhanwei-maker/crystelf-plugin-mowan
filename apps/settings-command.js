import ConfigControl from '../lib/config/configControl.js';

const FEATURE_KEYS = {
  戳一戳: 'poke',
  表情回复: 'faceReply',
  早晚安: 'zwa',
  帮助: 'help',
};

const FEATURE_LABELS = {
  poke: '戳一戳',
  faceReply: '表情回复',
  zwa: '早晚安',
  help: '帮助',
};

function hasManagePermission(e = {}) {
  return Boolean(e.isMaster || ['owner', 'admin'].includes(e.sender?.role));
}

async function setFeatureEnabled(featureKey = '', enabled) {
  const config = ConfigControl.get('config') || {};
  const next = { ...config, [featureKey]: enabled };
  await ConfigControl.set('config', next, {
    action: `chat_toggle_${featureKey}`,
  });
}

export class CrystelfSettingsCommand extends plugin {
  constructor() {
    super({
      name: 'crystelf-settings-command',
      dsc: '灵晶聊天设置命令（功能开关）',
      event: 'message',
      priority: -1000,
      rule: [
        {
          reg: '^#灵晶\\s+(开启|关闭)\\s+(戳一戳|表情回复|早晚安|帮助)$',
          fnc: 'toggleFeature',
        },
        {
          reg: '^#灵晶\\s+功能状态$',
          fnc: 'showFeatureStatus',
        },
      ],
    });
  }

  async toggleFeature(e) {
    if (!hasManagePermission(e)) {
      return e.reply('只有群主、管理员或主人才能修改灵晶功能开关。', true);
    }

    const match = e.msg.match(/^#灵晶\s+(开启|关闭)\s+(戳一戳|表情回复|早晚安|帮助)$/);
    if (!match) return false;

    const action = match[1];
    const featureName = match[2];
    const featureKey = FEATURE_KEYS[featureName];
    const enabled = action === '开启';

    try {
      await setFeatureEnabled(featureKey, enabled);
      return e.reply(`已${action}「${featureName}」功能。`, true);
    } catch (error) {
      logger.error(`[crystelf-settings] 设置 ${featureKey} 失败: ${error.message}`);
      return e.reply(`设置失败：${error.message}`, true);
    }
  }

  async showFeatureStatus(e) {
    const config = ConfigControl.get('config') || {};
    const lines = ['灵晶功能开关状态', '━━━━━━━━━━━━'];
    for (const [key, label] of Object.entries(FEATURE_LABELS)) {
      const enabled = config[key] !== false;
      lines.push(`${label}：${enabled ? '已开启' : '已关闭'}`);
    }
    lines.push('', '修改：#灵晶 开启/关闭 戳一戳|表情回复|早晚安|帮助');
    return e.reply(lines.join('\n'), true);
  }
}
