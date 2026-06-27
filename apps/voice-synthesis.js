import plugin from '../../../lib/plugins/plugin.js';
import { handleDirectVoiceEvent } from '../lib/ai/ttsSynthesisCommand.js';

export default class CrystelfVoiceSynthesis extends plugin {
  constructor() {
    super({
      name: 'crystelf-voice-synthesis',
      dsc: '群内语音合成命令',
      event: 'message.group',
      priority: -114521,
      rule: [
        {
          reg: '^(#|/)?合成语音[：:，,\\s]*([\\s\\S]*)$',
          fnc: 'synthesizeVoice',
        },
      ],
    });
  }

  async synthesizeVoice(e) {
    return handleDirectVoiceEvent(e);
  }
}
