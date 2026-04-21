const Group = {
  getGlobalBot() {
    return typeof globalThis !== 'undefined' ? globalThis.Bot : undefined;
  },

  getBot(e) {
    return e?.bot || this.getGlobalBot();
  },

  async callBotApi(e, api, params) {
    const bot = this.getBot(e);
    if (typeof bot?.sendApi === 'function') {
      return await bot.sendApi(api, params);
    }
    logger.warn(`[crystelf-group] 当前环境不支持 sendApi: ${api}`);
    return null;
  },

  /**
   * 群戳一戳
   * @param e
   * @param user_id 被戳的用户
   * @param group_id 群号
   * @returns {Promise<*>}
   */
  async groupPoke(e, user_id, group_id) {
    return await this.callBotApi(e, 'group_poke', {
      group_id: group_id,
      user_id: user_id,
    });
  },

  /**
   * 群踢人
   * @param e
   * @param user_id 要踢的人
   * @param group_id 群号
   * @param ban 是否允许再次加群
   * @returns {Promise<*>}
   */
  async groupKick(e, user_id, group_id, ban) {
    return await this.callBotApi(e, 'set_group_kick', {
      user_id: user_id,
      group_id: group_id,
      reject_add_request: ban,
    });
  },

  /**
   * 发送群语音
   * @param e
   * @param group_id
   * @param file 本地文件：file://,网络文件:https://
   * @param adapter nc/lgr
   * @returns {Promise<void>}
   */
  async sendGroupRecord(e,group_id,file,adapter='nc'){
    const resolvedAdapter = adapter === 'lgr' ? 'lgr' : 'nc';
    if(resolvedAdapter === 'nc'){
      return await this.callBotApi(e, 'send_group_msg', {
        group_id:group_id,
        message: [
          {
            type: "record",
            data: {
              file : file,
            }
          }
        ]
      });
    } else if(resolvedAdapter === 'lgr'){
      return await this.callBotApi(e, 'send_group_msg', {
        group_id: group_id,
        message:{
          type: "dict",
          data:{
            file:file
          }
        }
      });
    }
  },

  /**
   * 发送群文件
   * @param e
   * @param group_id
   * @param file file://
   * @param name 文件名
   * @param adapter nc/lgr
   * @returns {Promise<void>}
   */
  async sendGroupFile(e,group_id,file,name,adapter='nc'){
    const resolvedAdapter = adapter === 'lgr' ? 'lgr' : 'nc';
    if(resolvedAdapter === 'nc'){
      return await this.callBotApi(e, 'upload_group_file', {
        group_id: group_id,
        file: file,
        name: name
      });
    }
    else if(resolvedAdapter === 'lgr'){
      return await this.callBotApi(e, 'upload_group_file', {
        group_id:group_id,
        file:file,
        name:name
      });
    }
  }
};
export default Group;
