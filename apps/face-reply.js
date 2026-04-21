import ConfigControl from '../lib/config/configControl.js';
import Message from '../lib/yunzai/message.js';
import { extractReactionEmojiEntries } from '../lib/yunzai/emojiReaction.js';
import YunzaiUtils from '../lib/yunzai/utils.js';

export class FaceReply extends plugin {
  constructor() {
    super({
      name: 'face-reply',
      dsc: '给消息里的表情贴上回应',
      event: 'message.group',
      priority: -114,
    });
  }

  async accept(e) {
    if (!e.message_id || e.message.length === 0) return;
    const config = await ConfigControl.get('config');
    if (config?.faceReply === false) return;

    const face = [];
    e.message.forEach((m) => {
      if (m.type === 'face') {
        face.push({ id: m.id });
      } else if (m.type === 'text') {
        const emojiEntries = extractReactionEmojiEntries(m.text);
        if (emojiEntries.supported.length) {
          for (const emoji of emojiEntries.supported) {
            face.push({ id: emoji.id });
          }
        }
      }
    });

    const adapter = await YunzaiUtils.getAdapter(e);
    if (face.length) {
      for (const f of face) {
        await Message.emojiLike(e, e.message_id, String(f.id), e.group_id, adapter);
      }
    }
  }
}
