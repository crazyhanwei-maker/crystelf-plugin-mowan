import plugin from '../../../lib/plugins/plugin.js'
import updater from '../lib/system/updater.js'

let isUpdating = false

export default class CrystelfUpdatePlugin extends plugin {
  constructor() {
    super({
      name: '灵晶更新',
      dsc: '手动更新灵晶插件',
      event: 'message',
      priority: 5000,
      rule: [{ reg: '^#更新灵晶$', fnc: 'updatePlugin' }],
    })
  }

  async updatePlugin(e) {
    if (!e.isMaster) {
      return e.reply('只有主人才能更新灵晶。', true)
    }

    if (isUpdating) {
      return e.reply('灵晶更新任务正在执行，请稍后再试。', true)
    }

    isUpdating = true

    try {
      if (!(await updater.isGitRepo())) {
        return e.reply('当前插件目录不是 Git 仓库，无法更新。', true)
      }

      await e.reply('开始检查灵晶插件更新...', true)

      if (!(await updater.hasUpdate())) {
        return e.reply('当前已经是最新版本。', true)
      }

      await e.reply('检测到新版本，正在拉取更新...', true)
      await updater.update()
      return e.reply('灵晶插件更新完成。为确保新代码完全生效，建议重启 Yunzai。', true)
    } catch (err) {
      logger.error('[crystelf-plugin] 手动更新失败:', err)
      return e.reply(`灵晶插件更新失败：${err.message}`, true)
    } finally {
      isUpdating = false
    }
  }
}
