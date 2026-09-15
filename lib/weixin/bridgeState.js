// 微信桥轮询状态的进程内共享点：apps/weixin-ilink.js 在轮询启停时写入，
// webConsole 通知模块读取（桥在线才允许看门狗告警走微信通道）。
let pollerRunning = false;

export function setBridgePollerRunning(value) {
  pollerRunning = Boolean(value);
}

export function isBridgePollerRunning() {
  return pollerRunning;
}
