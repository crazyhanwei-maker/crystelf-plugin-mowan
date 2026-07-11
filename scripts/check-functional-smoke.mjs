import fs from 'fs/promises';
import { createQqSimulatorConsole } from '../lib/webConsole/qqSimulatorConsole.js';
import { renderStatusImage } from '../lib/system/statusImageRenderer.js';
import { closeSharedPuppeteerBrowser } from '../lib/system/puppeteerRenderer.js';
import { resolveWebConsoleLoginBaseUrl } from '../lib/webConsole/publicUrlResolver.js';

globalThis.logger ||= {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logPass(message) {
  console.log(`✓ ${message}`);
}

function createSimulator(configPatch = {}) {
  const configs = {
    config: {
      ai: true,
      privateAi: true,
      privateAiWhitelist: [],
      privateAiBlacklist: [],
      privateAiSafety: { enabled: true },
      ...configPatch,
    },
    ai: {},
    profile: { nickName: '魔丸' },
  };
  return createQqSimulatorConsole({
    ConfigControl: { get: () => configs },
    runSandboxChat: async payload => ({
      success: true,
      reply: `模拟回复：${payload.prompt ? '收到' : '空输入'}`,
      elapsedMs: 1,
      sessionId: payload.sessionId || 'functional-smoke',
    }),
  });
}

async function checkPrivateSimulatorPreview() {
  const simulator = createSimulator();
  const preview = simulator.buildQqSimulatorPreviewPayload({
    eventType: 'private_message',
    groupId: '10001',
    userId: '20001',
    nickname: '私聊用户',
    messageText: '你好',
    adapterFormat: 'onebot',
    conversationMode: true,
  });
  assert(preview.success === true, '私聊预览没有成功');
  assert(preview.event?.message_type === 'private', '私聊预览没有生成 private message_type');
  assert(!Object.prototype.hasOwnProperty.call(preview.event || {}, 'group_id'), '私聊预览不应该携带 group_id');
  logPass('模拟调试私聊预览正常');
}

async function checkPrivateAccessLists() {
  const deniedSimulator = createSimulator({ privateAiBlacklist: ['20001'] });
  const denied = await deniedSimulator.buildQqSimulatorSendPayload({
    eventType: 'private_message',
    userId: '20001',
    nickname: '黑名单用户',
    messageText: '你好',
    adapterFormat: 'onebot',
    conversationMode: true,
  });
  assert(denied.success === true, '黑名单模拟请求失败');
  assert(denied.actions.some(item => item.type === 'private_ai_access_denied'), '黑名单用户没有被私聊 AI 权限拦截');
  assert(denied.replies.includes('你暂时没有使用私聊 AI 的权限。'), '黑名单拦截回复不符合预期');

  const allowedSimulator = createSimulator({ privateAiWhitelist: ['20001'] });
  const allowed = await allowedSimulator.buildQqSimulatorSendPayload({
    eventType: 'private_message',
    userId: '20001',
    nickname: '白名单用户',
    messageText: '你好',
    adapterFormat: 'onebot',
    conversationMode: true,
  });
  assert(allowed.success === true, '白名单模拟请求失败');
  assert(!allowed.actions.some(item => item.type === 'private_ai_access_denied'), '白名单用户被错误拦截');
  assert(allowed.replies.length > 0, '白名单用户没有进入沙箱回复流程');
  logPass('私聊 AI 白名单/黑名单链路正常');
}

async function checkStatusImageRender() {
  const imagePath = await renderStatusImage({
    botName: '魔丸',
    avatarText: '魔',
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    rows: [
      { label: '插件版本', value: 'crystelf-plugin v2.1.0' },
      { label: 'Bot', value: '10000' },
      { label: '运行时长', value: '1分' },
      { label: 'Node', value: process.version },
      { label: '平台', value: `${process.platform} ${process.arch}` },
      { label: '控制台', value: '烟测' },
    ],
    features: [
      ['私聊AI', true],
      ['模拟调试', true],
    ],
    health: [
      { label: '配置', value: '正常', tone: 'success' },
      { label: '渲染', value: '正常', tone: 'success' },
    ],
    aiUsage: { requestCount: 1, successCount: 1, errorCount: 0 },
    imageUsage: { requestCount: 0, successCount: 0, errorCount: 0 },
    resources: {
      cpuPercent: 1,
      memoryPercent: 1,
      heapPercent: 1,
      usedMemoryBytes: 128 * 1024 * 1024,
      totalMemoryBytes: 1024 * 1024 * 1024,
      heapUsedBytes: 32 * 1024 * 1024,
      heapTotalBytes: 64 * 1024 * 1024,
      rssBytes: 96 * 1024 * 1024,
      loadAvg: '0.00 / 0.00 / 0.00',
    },
  });
  const stat = await fs.stat(imagePath);
  assert(stat.size > 1024, '状态图渲染结果过小，可能是空图');
  await fs.unlink(imagePath).catch(() => {});
  logPass('状态图渲染正常');
}

function checkWebConsolePublicUrlResolution() {
  const automatic = resolveWebConsoleLoginBaseUrl({
    config: {
      webConsoleHost: '0.0.0.0',
      webConsolePort: 27891,
      webConsolePublicUrl: '',
    },
    runtimeInfo: {
      host: '0.0.0.0',
      port: 27901,
      url: 'http://127.0.0.1:27901/',
    },
    networkInterfaces: {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [
        { address: '192.168.10.5', family: 'IPv4', internal: false },
        { address: '240e:39a:a78:4cc0:20c:29ff:fed2:c294', family: 'IPv6', internal: false },
      ],
    },
  });
  assert(automatic.source === 'auto-public', '没有优先选择自动检测到的公网地址');
  assert(
    automatic.url === 'http://[240e:39a:a78:4cc0:20c:29ff:fed2:c294]:27901',
    `公网 IPv6 登录基础地址格式错误：${automatic.url}`,
  );
  assert(!automatic.url.includes('0.0.0.0'), '登录地址不应包含监听通配地址 0.0.0.0');
  assert(!automatic.url.includes('127.0.0.1'), '存在公网地址时不应回退 127.0.0.1');

  const configured = resolveWebConsoleLoginBaseUrl({
    config: {
      webConsolePublicUrl: 'https://console.example.com/',
      webConsolePort: 27891,
    },
    runtimeInfo: { host: '0.0.0.0', port: 27901 },
    networkInterfaces: {},
  });
  assert(configured.source === 'configured', '手动公网地址没有获得最高优先级');
  assert(configured.url === 'https://console.example.com', '手动公网地址规范化错误');
  logPass('控制台一次性登录公网地址解析正常');
}

async function main() {
  try {
    await checkPrivateSimulatorPreview();
    await checkPrivateAccessLists();
    await checkStatusImageRender();
    checkWebConsolePublicUrlResolution();
    console.log('功能 smoke test 通过');
  } finally {
    await closeSharedPuppeteerBrowser().catch(() => {});
  }
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
