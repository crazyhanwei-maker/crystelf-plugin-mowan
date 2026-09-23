// 未知适配器的 warn 每条消息都会触发，改为按适配器名只提示一次
const unknownAdapterWarned = new Set();

export default class YunzaiUtils {
  /**
   * 获取消息中的图片
   * @param e
   * @param limit 限制
   * @param limited 是否只返回引用或发送图片
   * @returns {Promise<string[]>}
   */
  static async getImages(e, limit = 1,limited = false) {
    let imgUrls = [];
    const me = `https://q1.qlogo.cn/g?b=qq&s=640&nk=${e.user_id}`;

    // 获取引用消息
    if (e.source || e.reply_id) {
      let reply;
      if (e.getReply) reply = await e.getReply();
      else if (e.source?.seq || e.source?.time) {
        const history = await (e.isGroup ? e.group : e.friend).getChatHistory(
          e.isGroup ? e.source?.seq : e.source?.time,
          1
        );
        reply = history?.pop();
      }

      if (reply) {
        const msgArr = Array.isArray(reply) ? reply : reply.message || [];
        imgUrls = msgArr.filter((m) => m.type === 'image').map((m) => m.url);
      }
    }
    if (!imgUrls.length && e.message) {
      imgUrls = e.message.filter((m) => m.type === 'image').map((m) => m.url);
    }
    if (!imgUrls.length && !limited) imgUrls = [me];
    if(imgUrls.length === 0) return null;
    return imgUrls.slice(0, limit);
  }

  /**
   * 看看使用的是哪个适配器
   * @param e
   * @returns {Promise<*>}
   */
  static async getAdapter(e) {
    const adapter = String(
      e?.bot?.version?.app_name
      || e?.adapter_name
      || e?.bot?.adapter?.name
      || ''
    ).trim();
    const normalized = adapter.toLowerCase();
    if (
      normalized === 'napcat.onebot'
      || normalized === 'llonebot'
      || normalized === 'llonebot.onebot'
      || normalized === 'onebot'
      || normalized === 'go-cqhttp'
    ) {
      return 'nc';
    } else if (normalized === 'lagrange.onebot') {
      return 'lgr';
    } else if (normalized === 'icqq' || normalized === 'oicq') {
      // icqq/oicq 是进程内协议端，没有 OneBot sendApi：返回空串让调用方走通用回退（e.reply / segment.record 等）
      return '';
    }
    if (!unknownAdapterWarned.has(normalized)) {
      unknownAdapterWarned.add(normalized);
      logger.warn(`[crystelf-utils] 未识别的适配器: ${adapter || 'unknown'}（部分表情/历史功能受限，仅提示一次）`);
    }
    return '';
  }
}
