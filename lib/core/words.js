import ConfigControl from "../config/configControl.js";
import axios from "axios";

function resolveLegacyCoreUrl(coreConfig) {
  const legacyCoreUrl = String(coreConfig?.coreUrl || '').replace(/\/+$/, '');
  if (!legacyCoreUrl) {
    throw new Error('兼容旧核心服务地址未配置');
  }
  return legacyCoreUrl;
}

const Words = {
  /**
   * 从旧核心兼容服务获取某一类型下的词库列表
   * @param type 类型s
   * @returns {Promise<axios.AxiosResponse<any>>}
   */
  async getWordsList(type){
    const coreConfig = await ConfigControl.get()?.coreConfig;
    const legacyCoreUrl = resolveLegacyCoreUrl(coreConfig);
    return await (await axios.post(`${legacyCoreUrl}/api/words/list`, {
      type: type,
    }))?.data?.data;
  },

  /**
   * 从旧核心兼容服务获取某一条词库文案
   */
  async getWord(type,name){
    const coreConfig = await ConfigControl.get()?.coreConfig;
    const legacyCoreUrl = resolveLegacyCoreUrl(coreConfig);
    return await (await axios.post(`${legacyCoreUrl}/api/words/getText`, {
      type: type,
      id: name
    }))?.data?.data;
  }
}

export default Words;
