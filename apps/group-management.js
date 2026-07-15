import {
  handleGroupContentModeration,
  rememberGroupNewMember,
} from '../lib/groupManagement/contentModerationRuntime.js';
import ConfigControl from '../lib/config/configControl.js';
import { appendGroupManagementLog } from '../lib/groupManagement/groupManagementLog.js';
import {
  getGroupModerationState,
  saveGroupModerationState,
} from '../lib/groupManagement/memberModerationStore.js';
import { buildUserFacingErrorReply } from '../lib/ai/userFacingError.js';

const logger = globalThis.logger || {
  warn: (...args) => console.warn(...args),
};

function normalizeGroupId(value = '') {
  const text = String(value ?? '').trim();
  return /^\d{5,20}$/.test(text) ? text : '';
}

function isGroupManager(e = {}) {
  const role = String(e.sender?.role || '').trim();
  return e.isMaster === true || role === 'owner' || role === 'admin';
}

function getCommandOperator(e = {}) {
  return String(e.user_id ?? e.userId ?? e.sender?.user_id ?? 'groupCommand').trim() || 'groupCommand';
}

globalThis.Bot?.on?.('notice.group.increase', async (e) => {
  rememberGroupNewMember(e);
});

export async function handleGroupManagementMessageEvent(e, dependencies = {}) {
  const getMainConfig = dependencies.getMainConfig || (() => ConfigControl.get('config') || {});
  const moderate = dependencies.handleContentModeration || handleGroupContentModeration;
  const runtimeLogger = dependencies.logger || logger;
  try {
    const mainConfig = getMainConfig() || {};
    if (mainConfig.groupManagement === false) return false;
    await moderate(e);
  } catch (error) {
    runtimeLogger.warn(`[group-management] 群消息风控处理失败: ${error.message}`);
  }
  return false;
}

export function registerGroupManagementMessageListener(bot = globalThis.Bot, dependencies = {}) {
  if (typeof bot?.on !== 'function') return false;
  bot.on('message.group', async (e) => {
    await handleGroupManagementMessageEvent(e, dependencies);
  });
  return true;
}

registerGroupManagementMessageListener();

export class groupManagementRuntime extends plugin {
  constructor() {
    super({
      name: 'group-management-runtime',
      dsc: '群管理运行时风控',
      event: 'message.group',
      priority: -20,
      rule: [
        { reg: '^#灵晶\\s*(开启|关闭)群管理$', fnc: 'toggleGroupManagement' },
      ],
    });
  }

  async toggleGroupManagement(e) {
    const match = String(e.msg || '').trim().match(/^#灵晶\s*(开启|关闭)群管理$/);
    const enabled = match?.[1] === '开启';
    const groupId = normalizeGroupId(e.group_id ?? e.groupId ?? e.gid);
    const operator = getCommandOperator(e);

    if (!groupId) {
      await e.reply?.('只能在群聊里设置群管理。', true);
      return true;
    }
    if (!isGroupManager(e)) {
      await e.reply?.('只有群主、管理员或主人可以设置本群群管理。', true);
      return true;
    }

    try {
      const changes = [];
      const sections = ['moderation'];
      const mainConfig = ConfigControl.get('config') || {};
      if (enabled && mainConfig.groupManagement === false) {
        await ConfigControl.set('config', {
          ...mainConfig,
          groupManagement: true,
        });
        sections.unshift('config');
        changes.push('已开启插件群管理总开关');
      }

      const current = getGroupModerationState(groupId);
      const result = saveGroupModerationState(groupId, {
        settings: {
          ...(current.settings || {}),
          enabled,
          scoreEnabled: enabled,
        },
        content: {
          ...(current.content || {}),
          enabled,
        },
      }, {
        operator,
      });
      changes.push(...(result.changes || []));

      appendGroupManagementLog({
        action: enabled ? 'command_enable_group_management' : 'command_disable_group_management',
        source: 'groupCommand',
        success: true,
        group_id: groupId,
        user_id: operator,
        operator,
        sections,
        changes,
        summary: {
          enabled,
          settingsEnabled: enabled,
          contentEnabled: enabled,
        },
      });

      await e.reply?.(
        enabled
          ? [
              '已开启本群群管理基础能力。',
              '- 插件群管理总开关：开启',
              '- 本群入群风险评分：开启',
              '- 本群消息风控：开启',
              '自动通过、欢迎、头衔等细项仍可在控制台群管理里继续调整。',
            ].join('\n')
          : [
              '已关闭本群群管理基础能力。',
              '- 本群入群风险评分：关闭',
              '- 本群消息风控：关闭',
              '该操作不影响其他群；如需关闭插件总开关，主人可用 #关闭群管理。',
            ].join('\n'),
        true,
      );
    } catch (error) {
      appendGroupManagementLog({
        action: enabled ? 'command_enable_group_management_failed' : 'command_disable_group_management_failed',
        source: 'groupCommand',
        success: false,
        group_id: groupId,
        user_id: operator,
        operator,
        error: error.message,
        sections: ['moderation'],
      });
      logger.warn(`[group-management] 命令切换群管理失败: ${error.message}`);
      await e.reply?.(buildUserFacingErrorReply(e, {
        groupMessage: '群管理设置失败，请稍后重试或去控制台检查。',
        prefix: '群管理设置失败',
        error,
      }), true);
    }
    return true;
  }

}
