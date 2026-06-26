import plugin from '../../../lib/plugins/plugin.js'
import updater from '../lib/system/updater.js'

let isUpdating = false
const FORCE_CONFIRM_TIMEOUT_MS = 3 * 60 * 1000
const pendingForceUpdates = new Map()

function getConfirmKey(e = {}) {
  return `${String(e.group_id || 'private')}:${String(e.user_id || '')}`
}

function pruneExpiredForceUpdates() {
  const now = Date.now()
  for (const [key, pending] of pendingForceUpdates.entries()) {
    if (!pending || Number(pending.expiresAt || 0) <= now) {
      pendingForceUpdates.delete(key)
    }
  }
}

function shortHash(hash = '') {
  return String(hash || '').slice(0, 8) || '-'
}

export default class CrystelfUpdatePlugin extends plugin {
  constructor() {
    super({
      name: '灵晶更新',
      dsc: '手动更新灵晶插件',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#更新灵晶$', fnc: 'updatePlugin' },
        { reg: '^#强制更新灵晶$', fnc: 'prepareForceUpdatePlugin' },
        { reg: '^#?确认强制更新灵晶$', fnc: 'confirmForceUpdatePlugin' },
        { reg: '^#?取消强制更新灵晶$', fnc: 'cancelForceUpdatePlugin' },
      ],
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

  async prepareForceUpdatePlugin(e) {
    pruneExpiredForceUpdates()
    if (!e.isMaster) {
      return e.reply('只有主人才能强制更新灵晶。', true)
    }
    if (isUpdating) {
      return e.reply('灵晶更新任务正在执行，请稍后再试。', true)
    }

    try {
      if (!(await updater.isGitRepo())) {
        return e.reply('当前插件目录不是 Git 仓库，无法强制更新。', true)
      }
      const status = await updater.getUpdateStatus()
      pendingForceUpdates.set(getConfirmKey(e), {
        createdAt: Date.now(),
        expiresAt: Date.now() + FORCE_CONFIRM_TIMEOUT_MS,
        status,
      })
      return e.reply([
        '即将强制更新灵晶插件。',
        '这会丢弃插件目录内所有未提交的本地修改，并删除未跟踪文件，然后覆盖为远端版本。',
        '',
        `远端：${status.upstream?.ref || 'origin/main'}`,
        `当前：${shortHash(status.local)}`,
        `目标：${shortHash(status.remote)}`,
        `状态：${status.state || '-'}`,
        '',
        '确认执行请在 3 分钟内发送：确认强制更新灵晶',
        '取消请发送：取消强制更新灵晶',
      ].join('\n'), true)
    } catch (err) {
      logger.error('[crystelf-plugin] 强制更新预检失败:', err)
      return e.reply(`灵晶强制更新预检失败：${err.message}`, true)
    }
  }

  async confirmForceUpdatePlugin(e) {
    pruneExpiredForceUpdates()
    if (!e.isMaster) {
      return e.reply('只有主人才能确认强制更新灵晶。', true)
    }
    if (isUpdating) {
      return e.reply('灵晶更新任务正在执行，请稍后再试。', true)
    }

    const key = getConfirmKey(e)
    const pending = pendingForceUpdates.get(key)
    if (!pending) {
      return e.reply('没有待确认的强制更新任务，或确认已过期。请重新发送 #强制更新灵晶。', true)
    }
    pendingForceUpdates.delete(key)

    isUpdating = true
    try {
      await e.reply('已确认强制更新，开始覆盖本地修改并拉取远端版本...', true)
      const result = await updater.forceUpdate({ confirmed: true })
      return e.reply([
        '灵晶强制更新完成。',
        `版本：${shortHash(result.from)} -> ${shortHash(result.to)}`,
        result.manifestChanged ? '依赖清单有变化，请检查依赖后重启 Yunzai。' : '依赖清单未变化。',
        '为确保新代码完全生效，建议重启 Yunzai。',
      ].join('\n'), true)
    } catch (err) {
      logger.error('[crystelf-plugin] 强制更新失败:', err)
      return e.reply(`灵晶强制更新失败：${err.message}`, true)
    } finally {
      isUpdating = false
    }
  }

  async cancelForceUpdatePlugin(e) {
    pruneExpiredForceUpdates()
    const key = getConfirmKey(e)
    if (!pendingForceUpdates.has(key)) {
      return e.reply('没有待取消的强制更新确认。', true)
    }
    pendingForceUpdates.delete(key)
    return e.reply('已取消强制更新，未修改本地文件。', true)
  }
}
