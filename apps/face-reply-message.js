import ConfigControl from '../lib/config/configControl.js';
import YunzaiUtils from '../lib/yunzai/utils.js';
import { extractReactionEmojiEntries } from '../lib/yunzai/emojiReaction.js';
import Message from '../lib/yunzai/message.js';

export class FaceReplyMessage extends plugin {
  constructor() {
    super({
      name: 'FaceReplyMessage',
      dsc: '主动回应表情并查看 reaction ID',
      event: 'message.group',
      priority: -115,
      rule: [
        {
          reg: '^(#|/)?回应([\\s\\S]*)?$',
          fnc: 're',
        }
      ]
    });
  }

  async re(e) {
    if (!e.message_id || e.message.length === 0) return;
    const config = await ConfigControl.get('config');
    if (config?.faceReply === false) return true;

    const face = [];
    const unsupported = [];

    e.message.forEach((m) => {
      if (m.type === 'face') {
        face.push({ id: m.id, type: 'face' });
      } else if (m.type === 'text') {
        const emojiEntries = extractReactionEmojiEntries(m.text);
        if (emojiEntries.supported.length) {
          for (const emoji of emojiEntries.supported) {
            face.push({ id: emoji.id, type: 'emoji', emoji: emoji.emoji });
          }
        }
        unsupported.push(...emojiEntries.unsupported);
      }
    });

    const adapter = await YunzaiUtils.getAdapter(e);
    if (face.length) {
      for (const f of face) {
        await e.reply(`类型: ${f.type}，ID: ${f.id}${f.emoji ? `，Emoji: ${f.emoji}` : ''}`, true);
        await Message.emojiLike(e, e.message_id, String(f.id), e.group_id, adapter);
      }
    }

    if (unsupported.length) {
      await e.reply(`以下复合 Emoji 当前无法映射到单个 reaction ID，已跳过: ${unsupported.join(' ')}`, true);
    }

    return true;
  }
}
