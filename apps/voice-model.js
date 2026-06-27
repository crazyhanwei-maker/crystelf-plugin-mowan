import plugin from '../../../lib/plugins/plugin.js';
import {
  resetVoiceModel,
  selectPendingVoiceModel,
  showCurrentVoiceModel,
  showVoiceModelList,
  switchVoiceModelDirectly,
} from '../lib/ai/ttsVoiceModelCommand.js';

export default class CrystelfVoiceModel extends plugin {
  constructor() {
    super({
      name: 'crystelf-voice-model',
      dsc: '群内语音模型切换',
      event: 'message.group',
      priority: 4800,
      rule: [
        { reg: '^[#＃/]?灵晶\\s*语音模型\\s*$', fnc: 'showCurrentModel' },
        { reg: '^[#＃/]?灵晶\\s*切换语音模型\\s*$', fnc: 'showModelList' },
        { reg: '^[#＃/]?灵晶\\s*切换语音模型\\s+([\\s\\S]+)$', fnc: 'switchModelDirectly' },
        { reg: '^[#＃/]?灵晶\\s*重置语音模型\\s*$', fnc: 'resetModel' },
        { reg: '^\\d{1,3}$', fnc: 'selectPendingModel' },
      ],
    });
  }

  async showCurrentModel(e) {
    return showCurrentVoiceModel(e);
  }

  async showModelList(e) {
    return showVoiceModelList(e);
  }

  async switchModelDirectly(e) {
    return switchVoiceModelDirectly(e);
  }

  async selectPendingModel(e) {
    return selectPendingVoiceModel(e);
  }

  async resetModel(e) {
    return resetVoiceModel(e);
  }
}
