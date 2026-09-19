// agentWorkbenchConsole 进程级单例：
// 之前 server.js 与 agentChatBridge 各自 createAgentWorkbenchConsole，
// 产生两份独立 tasks 内存——QQ/微信桥跑的任务控制台永远看不到，且双方
// 向同一个 sessions 文件互相覆盖持久化。收敛为一份后，桥任务实时出现在
// 控制台列表，持久化也只有一个写入方。
import { createAgentWorkbenchConsole } from './agentWorkbenchConsole.js';

let shared = null;

export function getOrCreateWorkbenchConsole(options = {}) {
  if (!shared) shared = createAgentWorkbenchConsole(options);
  return shared;
}

export function getWorkbenchConsoleInstance() {
  return shared;
}
