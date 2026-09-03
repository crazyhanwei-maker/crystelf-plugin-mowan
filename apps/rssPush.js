import configControl from '../lib/config/configControl.js';
import rssTools from '../modules/rss/rss.js';
import path from 'path';
import screenshot from '../lib/rss/screenshot.js';
import fs from 'fs';
import rssCache from '../lib/rss/rssCache.js';
import schedule from 'node-schedule';
import tools from '../components/tool.js';
import { buildUserFacingErrorReply } from '../lib/ai/userFacingError.js';

// targetGroups 经 JSON 落盘可能是字符串，事件 group_id 是数字；统一按字符串比较
function normalizeGroupIdList(list) {
  return (Array.isArray(list) ? list : []).map(id => String(id ?? '').trim()).filter(Boolean);
}

function groupListIncludes(list, groupId) {
  const key = String(groupId ?? '').trim();
  return normalizeGroupIdList(list).includes(key);
}

function removeFromGroupList(list, groupId) {
  const key = String(groupId ?? '').trim();
  return (Array.isArray(list) ? list : []).filter(id => String(id ?? '').trim() !== key);
}

export default class RssPlugin extends plugin {
  constructor() {
    super({
      name: 'crystelf RSS订阅',
      dsc: '定时推送rss解析流',
      priority: 114,
      rule: [
        {
          reg: '^#rss添加(.+)$',
          fnc: 'addFeed',
          permission: 'master',
        },
        {
          reg: '^#rss移除(\\d+)$',
          fnc: 'removeFeed',
          permission: 'master',
        },
        {
          reg: '^#rss拉取(.+)$',
          fnc: 'pullFeedNow',
          permission: 'master',
          priority: 100,
        },
        {
          reg: '^#rss列表$',
          fnc: 'listFeeds',
          permission: 'master',
        },
        {
          reg: /(https?:\/\/\S+(?:\.atom|\/feed))/i,
          fnc: 'autoAddFeed',
          permission: 'master',
          priority: 500,
        },
      ],
    });
    global.__crystelfRssPushInstance = this;
    if (!global.__rss_job_scheduled) {
      // 默认每10分钟执行一次
      schedule.scheduleJob('*/10 * * * *', () => this.pushFeeds());
      global.__rss_job_scheduled = true;
      logger.mark('[crystelf-rss] 定时检测任务已启动');
    }
  }

  /**
   * 添加rss
   */
  async addFeed(e) {
    const url = e.msg.replace(/^#rss添加/, '').trim();
    if (!url) return e.reply('请输入有效的 RSS 链接。', true);

    const feeds = configControl.get('feeds') || [];
    const groupId = e.group_id;

    const exists = feeds.find((f) => f.url === url);
    if (exists) {
      if (!groupListIncludes(exists.targetGroups, groupId)) {
        exists.targetGroups.push(String(groupId));
        await configControl.set('feeds', feeds);
        return e.reply('该群已添加到这个 RSS 订阅中。', true);
      }
      return e.reply('这个 RSS 已存在，且已包含当前群聊。', true);
    }

    feeds.push({ url, targetGroups: [String(groupId)], screenshot: true });
    await configControl.set('feeds', feeds);
    return e.reply('RSS 订阅添加成功。', true);
  }

  /**
   * 自动添加
   */
  async autoAddFeed(e) {
    if (!configControl.get()?.config?.rss) {
      return;
    }
    const url = e.msg.match(/(https?:\/\/\S+(?:\.atom|\/feed))/i)?.[1];
    if (!url) return false;
    e.msg = `#rss添加 ${url}`;
    return await this.addFeed(e);
  }

  /**
   * 查看当前群组订阅列表
   */
  async listFeeds(e) {
    const feeds = configControl.get('feeds') || [];
    const groupId = e.group_id;
    const currentGroupFeeds = feeds
      .map((feed, index) => ({ index, ...feed }))
      .filter((feed) => groupListIncludes(feed.targetGroups, groupId));

    if (currentGroupFeeds.length === 0) {
      return e.reply('当前群组暂无任何 RSS 订阅。', true);
    }

    const msg = [
      `当前群组订阅列表 (${currentGroupFeeds.length})`,
      ...currentGroupFeeds.map((f) => `[${f.index}] ${f.url}`),
      '----------------',
      '提示：使用 #rss移除+索引号 取消订阅'
    ].join('\n');

    return e.reply(msg);
  }

  /**
   * 移除rss
   */
  async removeFeed(e) {
    const match = e.msg.match(/#rss移除\s*(\d+)/);
    if (!match || !match[1]) {
      return e.reply('请指定要移除的订阅索引，例如：#rss移除0', true);
    }

    const index = parseInt(match[1], 10);
    const feeds = configControl.get('feeds') || [];
    const groupId = e.group_id;
    if (isNaN(index) || index < 0 || index >= feeds.length) {
      return e.reply('索引无效，请发送 #rss列表 查看正确索引。', true);
    }

    const targetFeed = feeds[index];
    if (!targetFeed) return e.reply('未找到对应配置。', true);
    if (!Array.isArray(targetFeed.targetGroups)) {
      targetFeed.targetGroups = [];
    }
    if (!groupListIncludes(targetFeed.targetGroups, groupId)) {
      return e.reply('当前群组未订阅此源，无需移除。', true);
    }
    targetFeed.targetGroups = removeFromGroupList(targetFeed.targetGroups, groupId);
    await configControl.set('feeds', feeds);

    return await e.reply(`已取消订阅：${targetFeed.title || targetFeed.url}`);
  }

  async pullFeedNow(e) {
    const url = e.msg.replace(/^#rss拉取/, '').trim();
    if (!url) return e.reply('请提供 RSS 链接。', true);

    let latest;
    try {
      latest = await rssTools.fetchFeed(url);
    } catch (err) {
      logger.error(`[crystelf-rss] 手动拉取失败: ${err.message}`);
      return await e.reply(buildUserFacingErrorReply(e, {
        groupMessage: 'RSS 拉取失败，请稍后重试或检查订阅地址。',
        prefix: '拉取失败',
        error: err,
      }), true);
    }

    if (!latest || !latest.length) {
      return await e.reply('拉取成功，但没有内容。', true);
    }

    const post = latest[0];
    const tempPath = path.join(process.cwd(), 'data', `rss-test-${Date.now()}.png`);

    try {
      await e.reply(`最新文章：${post.title}\n正在生成预览…`);
      await screenshot.generateScreenshot(post, tempPath);
      await e.reply([segment.image(tempPath)]);
    } catch (err) {
      logger.error(`[crystelf-rss] 截图失败: ${err}`);
      await e.reply('生成预览图失败。', true);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }
  async pushFeeds() {
    const feeds = configControl.get('feeds') || [];

    for (const feed of feeds) {
      let latest;
      try {
        latest = await rssTools.fetchFeed(feed.url);
      } catch (error) {
        logger.warn(`[RSS] 自动检查 ${feed.url} 失败: ${error.message}，跳过`);
        continue;
      }

      if (!latest || !latest.length) continue;

      const newItems = [];
      const checkLimit = Math.min(latest.length, 3);

      for (let i = 0; i < checkLimit; i++) {
        const item = latest[i];
        if (!item.link) continue;
        const isCached = await rssCache.has(feed.url, item.link);

        if (!isCached) {
          const pubDate = item.date ? new Date(item.date).getTime() : Date.now();
          if (!item.date || (Date.now() - pubDate < 172800000)) {
            newItems.push(item);
          }
        }
      }

      if (newItems.length > 0) {
        newItems.reverse();
        for (const post of newItems) {
          // 写入缓存
          await rssCache.set(feed.url, post.link);

          for (const groupId of feed.targetGroups) {
            await tools.sleep(2000);

            const tempPath = path.join(process.cwd(), 'data', `rss-${Date.now()}.png`);
            try {
              if (feed.screenshot) {
                logger.info(`[crystelf-rss] 推送更新: ${post.title} -> 群 ${groupId}`);
                // 先发个文字提示
                await Bot.pickGroup(groupId)?.sendMsg(
                  `[RSS] ${post.feedTitle || '订阅更新'}\n${post.title}`
                );

                // 再发图片
                await screenshot.generateScreenshot(post, tempPath);
                await Bot.pickGroup(groupId)?.sendMsg([segment.image(tempPath)]);
              } else {
                await Bot.pickGroup(groupId)?.sendMsg(`[RSS推送]\n${post.title}\n${post.link}`);
              }
            } catch (err) {
              logger.error(`[crystelf-rss] 推送消息异常: ${err.message}`);
            } finally {
              if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
              }
            }
          }
        }
      }
    }
  }
}
