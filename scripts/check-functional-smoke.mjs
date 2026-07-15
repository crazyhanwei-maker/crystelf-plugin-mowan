import fs from 'fs/promises';
import { createQqSimulatorConsole } from '../lib/webConsole/qqSimulatorConsole.js';
import { renderStatusImage } from '../lib/system/statusImageRenderer.js';
import { closeSharedPuppeteerBrowser } from '../lib/system/puppeteerRenderer.js';
import { resolveWebConsoleLoginBaseUrl } from '../lib/webConsole/publicUrlResolver.js';
import {
  buildArkAgentPlanImageRequest,
  buildArkAgentPlanImageUrl,
  normalizeImageSizeValue,
  supportsImageOperation,
} from '../lib/ai/imageApi.js';
import axios from 'axios';
import { ImageProcessor } from '../lib/ai/imageProcessor.js';
import { buildImageFallbackConfig } from '../lib/ai/apiFallback.js';
import { createApiSettingsConsole } from '../lib/webConsole/apiSettingsConsole.js';
import { createPersistentMd5Store } from '../lib/imageMonitor/persistentMd5Store.js';
import { buildChatCompletionMessages } from '../lib/ai/chatEngine.js';
import { MemoryRetrieval } from '../lib/humanize/memoryRetrieval.js';
import {
  buildSdWebUiApiUrl,
  buildSdWebUiRequest,
  normalizeSdWebUiSettings,
} from '../lib/ai/sdWebUiApi.js';

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

function checkPersistentImageMonitorMd5Store() {
  let content = '';
  const fakeFs = {
    existsSync: () => Boolean(content),
    readFileSync: () => content,
    mkdirSync: () => {},
    appendFileSync: (filePath, value) => {
      content += String(value || '');
    },
  };
  const fakePath = { dirname: () => '/memory' };
  const firstStore = createPersistentMd5Store({
    filePath: '/memory/md5-index.jsonl',
    fs: fakeFs,
    path: fakePath,
    logger: { warn: () => {} },
  });
  const md5 = '098f6bcd4621d373cade4e832627b4f6';
  assert(firstStore.has(md5) === false, '空 MD5 索引错误命中');
  assert(firstStore.add(md5) === true, '首次 MD5 没有写入索引');
  assert(firstStore.add(md5) === false, '重复 MD5 被重复写入索引');
  assert(firstStore.size() === 1, 'MD5 索引数量错误');

  const reloadedStore = createPersistentMd5Store({
    filePath: '/memory/md5-index.jsonl',
    fs: fakeFs,
    path: fakePath,
    logger: { warn: () => {} },
  });
  assert(reloadedStore.has(md5) === true, 'Bot 重启后没有重新加载持久化 MD5');
  assert(reloadedStore.size() === 1, '重新加载后的 MD5 索引数量错误');
  logPass('图片监控持久化 MD5 去重正常');
}

async function checkImageMonitorStorageConfigSave() {
  let savedImageMonitor = null;
  const apiSettingsConsole = createApiSettingsConsole({
    getAllConfigs: () => ({
      ai: {},
      coreConfig: {},
      imageMonitor: {
        enabled: true,
        storageEnabled: true,
        saveReviewImages: true,
        saveMemeImages: true,
        apiBase: 'https://example.com',
        apiKey: 'saved-key',
        model: 'vision-model',
      },
    }),
    setConfig: async (name, value) => {
      if (name === 'imageMonitor') savedImageMonitor = value;
    },
  });
  await apiSettingsConsole.saveApiSettings({
    imageMonitor: {
      enabled: true,
      storageEnabled: false,
      saveReviewImages: true,
      saveMemeImages: true,
      apiBase: 'https://example.com',
      preserveApiKey: true,
      model: 'vision-model',
      analysisTimeoutMs: 30000,
    },
  });
  assert(savedImageMonitor?.storageEnabled === false, '控制台没有保存图片本地入库总开关');
  assert(savedImageMonitor?.saveReviewImages === true, '关闭总开关时错误清除了审核图细分开关');
  assert(savedImageMonitor?.saveMemeImages === true, '关闭总开关时错误清除了表情包细分开关');
  logPass('图片监控入库总开关保存正常');
}

function createSimulator(configPatch = {}, aiConfigPatch = {}, simulatorOptions = {}) {
  const configs = {
    config: {
      ai: true,
      privateAi: true,
      privateAiWhitelist: [],
      privateAiBlacklist: [],
      privateAiSafety: { enabled: true },
      ...configPatch,
    },
    ai: aiConfigPatch,
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
    ...simulatorOptions,
  });
}

function checkChatEngineUserMessageCompatibility() {
  const targetMessage = { content: '帮我查询今天的天气' };
  const cases = [
    buildChatCompletionMessages({ prompt: '系统提示', targetMessage }),
    buildChatCompletionMessages({
      prompt: '系统提示',
      targetMessage,
      imageUrls: ['https://example.com/source.png'],
    }),
    buildChatCompletionMessages({ prompt: '工具结果', targetMessage, phase: 'tool_followup' }),
    buildChatCompletionMessages({ prompt: '保底提示', targetMessage, phase: 'fallback' }),
    buildChatCompletionMessages({ prompt: '最终提示', targetMessage, phase: 'final' }),
  ];

  for (const messages of cases) {
    const userMessage = messages.find(message => message.role === 'user');
    assert(userMessage, '聊天引擎请求缺少 user 消息');
    if (Array.isArray(userMessage.content)) {
      assert(userMessage.content.some(item => item.type === 'text' && String(item.text || '').trim()), '聊天引擎多模态 user 消息缺少文本');
    } else {
      assert(String(userMessage.content || '').trim(), '聊天引擎 user 消息内容为空');
    }
  }

  assert(cases[0][1].content === targetMessage.content, '聊天引擎文本首轮没有保留真实用户消息');
  assert(cases[1][1].content.some(item => item.type === 'image_url'), '聊天引擎图片首轮没有保留图片消息段');
  logPass('聊天引擎 user 消息兼容保护正常');
}

async function checkMemoryRetrievalUserMessageCompatibility() {
  const requests = [];
  let completionIndex = 0;
  const ai = {
    complete: async options => {
      requests.push({
        ...options,
        messages: structuredClone(options.messages),
      });
      completionIndex += 1;
      if (completionIndex === 1) {
        return {
          content: '',
          toolCalls: [{
            id: 'call-search',
            name: 'search_chat_history',
            arguments: JSON.stringify({ keyword: '测试记录' }),
          }],
          raw: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call-search',
              type: 'function',
              function: {
                name: 'search_chat_history',
                arguments: JSON.stringify({ keyword: '测试记录' }),
              },
            }],
          },
        };
      }
      return {
        content: '',
        toolCalls: [{
          id: 'call-finish',
          name: 'found_answer',
          arguments: JSON.stringify({ answer: '找到测试记录', found: true }),
        }],
        raw: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call-finish',
            type: 'function',
            function: {
              name: 'found_answer',
              arguments: JSON.stringify({ answer: '找到测试记录', found: true }),
            },
          }],
        },
      };
    },
  };
  const db = {
    searchMessages: () => [{
      timestamp: Date.now(),
      userName: '测试用户',
      content: '这是需要找到的测试记录',
    }],
    getMessagesByUser: () => [],
  };
  const retrieval = new MemoryRetrieval(ai, {
    modelType: 'test-model',
    memory: { enabled: true, maxIterations: 3, timeoutMs: 5000 },
  }, db);

  const answer = await retrieval.reactSearch('group:10001', '之前的测试记录是什么？');
  assert(answer === '找到测试记录', '记忆检索工具循环没有返回预期结果');
  assert(requests.length === 2, '记忆检索工具循环请求次数错误');
  assert(requests[0].messages.some(message => message.role === 'user' && String(message.content || '').includes('之前的测试记录')), '记忆检索首轮缺少有效 user 消息');
  assert(requests[1].messages.some(message => message.role === 'assistant' && Array.isArray(message.tool_calls)), '记忆检索续轮缺少 assistant 工具调用消息');
  assert(requests[1].messages.some(message => message.role === 'tool' && message.tool_call_id === 'call-search'), '记忆检索续轮缺少工具结果消息');
  assert(!requests[1].messages.some(message => message.role === 'assistant' && !String(message.content || '').trim() && !message.tool_calls?.length), '记忆检索续轮包含无效空 assistant 消息');
  logPass('记忆检索 user 消息兼容保护正常');
}

async function checkGroupManagementRawMessageListener() {
  const previousBot = globalThis.Bot;
  const previousPlugin = globalThis.plugin;
  const registrations = [];
  globalThis.Bot = {
    on: (event, handler) => registrations.push({ event, handler }),
  };
  globalThis.plugin = class {
    constructor(config = {}) {
      this.config = config;
      this.rule = config.rule || [];
    }
  };

  try {
    const module = await import(`../apps/group-management.js?functional-smoke=${Date.now()}`);
    const messageListener = registrations.find(item => item.event === 'message.group');
    assert(typeof messageListener?.handler === 'function', '群管理没有注册原始群消息监听器');

    const handled = [];
    let rawMessageHandler = null;
    const registered = module.registerGroupManagementMessageListener({
      on: (event, handler) => {
        if (event === 'message.group') rawMessageHandler = handler;
      },
    }, {
      getMainConfig: () => ({ groupManagement: true }),
      handleContentModeration: async event => handled.push(event.message_id),
      logger: { warn: () => {} },
    });
    assert(registered === true && typeof rawMessageHandler === 'function', '群管理原始消息监听器无法独立注册');
    await Promise.all(Array.from({ length: 13 }, (_, index) => rawMessageHandler({
      group_id: 701380759,
      user_id: 1420354365,
      message_id: index + 1,
      msg: String(index + 1),
    })));
    assert(handled.length === 13, `高速连续群消息只进入风控 ${handled.length}/13 条`);

    await module.handleGroupManagementMessageEvent({ message_id: 14 }, {
      getMainConfig: () => ({ groupManagement: false }),
      handleContentModeration: async event => handled.push(event.message_id),
      logger: { warn: () => {} },
    });
    assert(handled.length === 13, '群管理总开关关闭后仍执行消息风控');

    const runtime = new module.groupManagementRuntime();
    assert(runtime.rule.length === 1, '群管理插件规则仍包含全消息处理入口');
    assert(runtime.rule[0]?.fnc === 'toggleGroupManagement', '群管理插件命令规则被意外修改');
  } finally {
    if (previousBot === undefined) delete globalThis.Bot;
    else globalThis.Bot = previousBot;
    if (previousPlugin === undefined) delete globalThis.plugin;
    else globalThis.plugin = previousPlugin;
  }

  logPass('群管理原始消息监听与高速刷屏计数入口正常');
}

async function checkImageEditCommandSimulation() {
  const sdSimulator = createSimulator({}, {
    imageConfig: {
      enabled: true,
      imageMode: 'sd-webui',
    },
  });
  const edit = await sdSimulator.buildQqSimulatorSendPayload({
    eventType: 'message',
    groupId: '10001',
    userId: '20001',
    nickname: '测试用户',
    messageText: '#灵晶改图 把背景改成蓝色水晶宫殿',
    images: ['https://example.com/source.png'],
    includeAt: false,
    dispatchMode: 'replay',
  });
  assert(edit.success === true, '改图命令模拟失败');
  assert(edit.replies.some(item => item.includes('SD WebUI') && item.includes('固定返回 1 张图片')), '改图命令没有显示 SD WebUI 单图结果');
  assert(edit.actions.some(item => item.type === 'would_edit_image' && item.singleImageOutput === true), '改图命令没有生成图片编辑动作');
  assert(edit.timeline.some(item => item.stage === 'ai.imageEditCommand' && item.status === 'matched'), '改图命令没有写入链路时间线');

  const fusion = await sdSimulator.buildQqSimulatorSendPayload({
    eventType: 'message',
    groupId: '10001',
    userId: '20001',
    nickname: '测试用户',
    messageText: '#灵晶融合 合成自然合影',
    images: ['https://example.com/1.png', 'https://example.com/2.png'],
    includeAt: false,
    dispatchMode: 'safe',
  });
  const fusionAction = fusion.actions.find(item => item.type === 'would_fuse_images');
  assert(fusionAction?.sourceImageCount === 1, 'SD WebUI 融合模拟没有限制为第一张参考图');
  assert(fusionAction?.ignoredImageCount === 1, 'SD WebUI 融合模拟没有记录忽略图片数量');
  assert(fusion.replies.some(item => item.includes('只会使用第一张参考图')), 'SD WebUI 多图限制没有提示用户');

  const missingSource = await sdSimulator.buildQqSimulatorSendPayload({
    eventType: 'message',
    groupId: '10001',
    userId: '20001',
    messageText: '#灵晶改图 修改背景',
    images: [],
    includeAt: false,
  });
  assert(missingSource.actions.some(item => item.type === 'would_reject_image_edit_missing_source'), '改图命令缺少图片时没有被拦截');
  assert(missingSource.replies.some(item => item.includes('请在消息中附带图片')), '改图命令缺少图片时提示错误');

  const missingFusionSource = await sdSimulator.buildQqSimulatorSendPayload({
    eventType: 'message',
    groupId: '10001',
    userId: '20001',
    messageText: '#灵晶融合 合成自然合影',
    images: ['https://example.com/1.png'],
    includeAt: false,
  });
  assert(missingFusionSource.actions.some(item => item.type === 'would_reject_image_edit_missing_source'), '融合命令只有一张图片时没有被拦截');
  assert(missingFusionSource.replies.some(item => item.includes('至少两张图片')), '融合命令图片不足提示错误');

  const disabledSimulator = createSimulator({}, { imageConfig: { enabled: false, imageMode: 'sd-webui' } });
  const disabled = await disabledSimulator.buildQqSimulatorSendPayload({
    eventType: 'message',
    groupId: '10001',
    userId: '20001',
    messageText: '#灵晶改图 修改背景',
    images: ['https://example.com/source.png'],
    includeAt: false,
  });
  assert(disabled.actions.some(item => item.type === 'would_reject_image_edit_disabled'), '图像功能关闭时改图命令没有被拦截');
  logPass('模拟调试改图与融合命令规则正常');
}

async function checkLiveImageCommandSimulation() {
  const calls = [];
  const simulator = createSimulator({}, {
    imageConfig: {
      enabled: true,
      imageMode: 'sd-webui',
      timeout: 300000,
      sdWebUi: {
        baseApi: 'http://192.168.0.109:8888',
        samplerName: 'Euler a',
        steps: 8,
        cfgScale: 7,
        width: 512,
        height: 512,
        denoisingStrength: 0.7,
      },
    },
  }, {
    createImageProcessor: async () => ({
      mergeImageConfig: config => config.imageConfig,
      validateImageConfig: () => ({ isValid: true, errors: [] }),
      generateOrEditImage: async (prompt, images, config) => {
        calls.push({ prompt, images, config });
        return {
          success: true,
          imageUrl: 'data:image/png;base64,dGVzdA==',
          model: 'test-sd-model',
        };
      },
    }),
  });
  const result = await simulator.buildQqSimulatorSendPayload({
    eventType: 'message',
    groupId: '10001',
    userId: '20001',
    nickname: '测试用户',
    messageText: '#灵晶改图 把背景改成蓝色水晶宫殿',
    images: ['data:image/png;base64,dGVzdA=='],
    includeAt: false,
    dispatchMode: 'live-image',
    confirmLiveImage: true,
  });
  assert(result.success === true, `真实生图模拟执行失败：${result.errors.join('；')}`);
  assert(calls.length === 1, '真实生图模式没有调用图像处理器');
  assert(calls[0].images.length === 1, '真实生图模式参考图数量错误');
  assert(Array.isArray(result.replies[0]) && result.replies[0][0]?.type === 'image', '真实生图模式没有返回图片消息段');
  assert(result.replies[0][0]?.url === 'data:image/png;base64,dGVzdA==', '真实生图模式返回图片地址错误');
  assert(result.actions.some(item => item.type === 'executed_image_edit' && item.realImageExecution === true), '真实生图模式没有记录执行动作');
  assert(result.timeline.some(item => item.stage === 'ai.imageEditCommand.live' && item.status === 'success'), '真实生图模式没有记录成功时间线');
  assert(result.debug?.safeMode === false, '真实生图模式仍错误标记为完全安全模拟');

  const rejected = await simulator.buildQqSimulatorSendPayload({
    eventType: 'message',
    groupId: '10001',
    userId: '20001',
    messageText: '#灵晶改图 修改背景',
    images: ['data:image/png;base64,dGVzdA=='],
    includeAt: false,
    dispatchMode: 'live-image',
  });
  assert(rejected.success === false, '未确认的真实生图请求没有被拒绝');
  assert(rejected.actions.some(item => item.type === 'rejected_live_image_without_confirmation'), '未确认真实生图没有记录拒绝动作');
  assert(calls.length === 1, '未确认真实生图仍调用了图像处理器');
  logPass('模拟调试真实生图执行链路正常');
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

function checkArkAgentPlanImageRequest() {
  const endpoint = buildArkAgentPlanImageUrl('https://ark.cn-beijing.volces.com/api/plan/v3/');
  assert(
    endpoint === 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations',
    `Agent Plan 请求地址错误：${endpoint}`,
  );
  const body = buildArkAgentPlanImageRequest('测试图片', {
    model: 'doubao-seedream-5.0-lite',
    size: '2k',
    outputFormat: 'png',
    responseFormat: 'url',
    watermark: false,
    quality: 'high',
    n: 1,
  }, ['https://example.com/reference.png']);
  assert(body.size === '2K', 'Agent Plan 2K 分辨率大小写没有保留');
  assert(body.output_format === 'png', 'Agent Plan output_format 未写入');
  assert(body.response_format === 'url', 'Agent Plan response_format 未写入');
  assert(body.watermark === false, 'Agent Plan watermark=false 未写入');
  assert(body.image === 'https://example.com/reference.png', 'Agent Plan 单张参考图未写入 image');
  assert(!Object.prototype.hasOwnProperty.call(body, 'quality'), 'Agent Plan 不应携带 quality');
  assert(!Object.prototype.hasOwnProperty.call(body, 'n'), 'Agent Plan 不应携带 n');
  assert(normalizeImageSizeValue('2048x2048') === '2048x2048', '标准宽高分辨率被错误修改');
  assert(normalizeImageSizeValue('3k') === '3K', 'Agent Plan 3K 分辨率大小写没有保留');
  assert(supportsImageOperation('ark-agent-plan', 'generate') === true, 'Agent Plan 应支持文生图');
  assert(supportsImageOperation('ark-agent-plan', 'edit') === true, 'Agent Plan 应支持单图和多图生图');
  const multiImageBody = buildArkAgentPlanImageRequest('多图测试', {}, [
    'https://example.com/reference-1.png',
    'data:image/png;base64,dGVzdA==',
  ]);
  assert(Array.isArray(multiImageBody.image) && multiImageBody.image.length === 2, 'Agent Plan 多张参考图未按数组写入 image');
  logPass('火山 Agent Plan 图像请求构造正常');
}

function checkSdWebUiImageRequest() {
  const endpoint = buildSdWebUiApiUrl('http://192.168.0.109:8888/', '/sdapi/v1/txt2img');
  assert(endpoint === 'http://192.168.0.109:8888/sdapi/v1/txt2img', `SD WebUI 请求地址错误：${endpoint}`);
  const body = buildSdWebUiRequest('单图测试', {
    sdWebUi: {
      model: 'tamix_ninini.safetensors',
      samplerName: 'DPM++ 2M',
      scheduler: 'Karras',
      steps: 24,
      cfgScale: 6.5,
      width: 768,
      height: 1024,
      negativePrompt: 'low quality',
      seed: -1,
      denoisingStrength: 0.65,
      batchSize: 9,
      nIter: 9,
    },
  }, 'data:image/png;base64,dGVzdA==');
  assert(body.batch_size === 1, 'SD WebUI batch_size 没有锁定为 1');
  assert(body.n_iter === 1, 'SD WebUI n_iter 没有锁定为 1');
  assert(body.init_images?.length === 1 && body.init_images[0] === 'dGVzdA==', 'SD WebUI 图生图参考图构造错误');
  assert(body.denoising_strength === 0.65, 'SD WebUI 重绘强度未写入');
  assert(body.override_settings?.sd_model_checkpoint === 'tamix_ninini.safetensors', 'SD WebUI 单请求模型覆盖未写入');
  assert(body.override_settings_restore_afterwards === true, 'SD WebUI 模型覆盖后未设置自动恢复');
  const normalized = normalizeSdWebUiSettings({ sdWebUi: { width: 777, height: 1025, steps: 999 } });
  assert(normalized.width === 776 && normalized.height === 1024, 'SD WebUI 宽高没有按 8 的倍数规范化');
  assert(normalized.steps === 150, 'SD WebUI 采样步数没有限制上限');
  assert(supportsImageOperation('sd-webui', 'generate') === true, 'SD WebUI 应支持文生图');
  assert(supportsImageOperation('sd-webui', 'edit') === true, 'SD WebUI 应支持图生图');
  logPass('SD WebUI 单图请求构造正常');
}

async function checkSdWebUiImageRuntime() {
  const originalPost = axios.post;
  const captured = [];
  axios.post = async (url, body, options) => {
    captured.push({ url, body, options });
    return { data: { images: ['Zmlyc3Q=', 'c2Vjb25k'], info: '{}' } };
  };
  try {
    const processor = new ImageProcessor();
    const result = await processor.generateOrEditImageBySdWebUi('运行时单图测试', [], {
      imageMode: 'sd-webui',
      timeout: 60000,
      sdWebUi: {
        baseApi: 'http://192.168.0.109:8888',
        model: 'tamix_ninini.safetensors',
        samplerName: 'Euler a',
        scheduler: 'Karras',
        steps: 12,
        cfgScale: 7,
        width: 512,
        height: 512,
      },
    });
    const request = captured.at(-1);
    assert(result.success === true, 'SD WebUI 运行时没有解析成功响应');
    assert(result.imageUrl === 'data:image/png;base64,Zmlyc3Q=', 'SD WebUI 没有只读取第一张返回图');
    assert(request?.url === 'http://192.168.0.109:8888/sdapi/v1/txt2img', 'SD WebUI 文生图路径错误');
    assert(request?.body?.batch_size === 1 && request?.body?.n_iter === 1, 'SD WebUI 运行时未锁定单图参数');

    const fallback = buildImageFallbackConfig({
      imageMode: 'openai',
      fallbackApi: {
        enabled: true,
        imageMode: 'sd-webui',
        sdWebUi: {
          baseApi: 'http://192.168.0.109:8888',
          samplerName: 'DPM++ 2M',
          steps: 18,
          width: 768,
          height: 768,
        },
      },
    });
    assert(fallback?.imageMode === 'sd-webui', '备用 SD WebUI 模式未保留');
    assert(fallback?.sdWebUi?.baseApi === 'http://192.168.0.109:8888', '备用 SD WebUI 地址未生效');
    assert(fallback?.sdWebUi?.steps === 18, '备用 SD WebUI 独立参数未生效');
  } finally {
    axios.post = originalPost;
  }
  logPass('SD WebUI 单图运行时与备用接口正常');
}

function checkSdWebUiPrecheck() {
  const apiSettingsConsole = createApiSettingsConsole({
    getAllConfigs: () => ({ ai: {}, imageMonitor: {}, coreConfig: {} }),
  });
  const basePayload = {
    ai: {
      baseApi: 'https://example.com',
      apiKey: 'main-key',
      modelType: 'test-model',
      imageConfig: {
        enabled: true,
        imageMode: 'sd-webui',
        sdWebUi: {
          baseApi: 'http://192.168.0.109:8888',
          samplerName: 'DPM++ 2M',
          steps: 20,
          cfgScale: 7,
          width: 1024,
          height: 1024,
          seed: -1,
          denoisingStrength: 0.7,
        },
        fallbackApi: { enabled: false },
      },
      memeConfig: {},
    },
    imageMonitor: { enabled: false },
    coreConfig: { tools: { search: { enabled: false } } },
  };
  const valid = apiSettingsConsole.precheckApiSettings(basePayload);
  assert(!valid.errors.some(item => item.includes('SD WebUI')), `合法 SD WebUI 配置被拦截：${valid.errors.join('；')}`);
  assert(!valid.warnings.some(item => item.includes('图像生成未配置独立或主 API Key')), 'SD WebUI 被错误要求 OpenAI API Key');
  const invalid = apiSettingsConsole.precheckApiSettings({
    ...basePayload,
    ai: {
      ...basePayload.ai,
      imageConfig: {
        ...basePayload.ai.imageConfig,
        sdWebUi: { ...basePayload.ai.imageConfig.sdWebUi, width: 777 },
      },
    },
  });
  assert(invalid.errors.some(item => item.includes('宽度必须是 64-4096 之间的 8 的倍数')), 'SD WebUI 非法宽度未被预检拦截');
  logPass('SD WebUI 控制台预检正常');
}

async function checkSdWebUiConsoleSecretAndProbe() {
  const configs = {
    ai: {
      baseApi: 'https://example.com',
      apiKey: 'main-key',
      modelType: 'test-model',
      imageConfig: {
        enabled: true,
        imageMode: 'sd-webui',
        timeout: 60000,
        sdWebUi: {
          baseApi: 'http://192.168.0.109:8888',
          username: 'tester',
          password: 'saved-secret',
          samplerName: 'DPM++ 2M',
          steps: 20,
          cfgScale: 7,
          width: 1024,
          height: 1024,
          denoisingStrength: 0.7,
        },
        fallbackApi: { enabled: false },
      },
    },
    imageMonitor: {},
    coreConfig: {},
  };
  const fetchCalls = [];
  const apiSettingsConsole = createApiSettingsConsole({
    getAllConfigs: () => configs,
    setConfig: async (name, value) => {
      configs[name] = value;
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return { ok: true, status: 200 };
    },
  });
  const savedPayload = await apiSettingsConsole.saveApiSettings({
    ai: {
      ...configs.ai,
      imageConfig: {
        ...configs.ai.imageConfig,
        sdWebUi: {
          ...configs.ai.imageConfig.sdWebUi,
          password: '',
          preservePassword: true,
        },
      },
    },
  });
  assert(configs.ai.imageConfig.sdWebUi.password === 'saved-secret', 'SD WebUI 密码留空保存时没有保留旧值');
  assert(savedPayload.ai.imageConfig.sdWebUi.password === '', 'SD WebUI 密码被控制台接口明文返回');
  assert(savedPayload.ai.imageConfig.sdWebUi.passwordConfigured === true, 'SD WebUI 密码配置状态丢失');

  const probe = await apiSettingsConsole.testApiTargetConnection('ai-image', 'primary');
  assert(probe.success === true, `SD WebUI 连接探测失败：${probe.error || ''}`);
  assert(fetchCalls.at(-1)?.url === 'http://192.168.0.109:8888/sdapi/v1/sd-models', 'SD WebUI 连接探测请求了错误端点');
  const expectedAuth = `Basic ${Buffer.from('tester:saved-secret').toString('base64')}`;
  assert(fetchCalls.at(-1)?.options?.headers?.Authorization === expectedAuth, 'SD WebUI 连接探测 Basic Auth 错误');
  logPass('SD WebUI 控制台密码保护与连接探测正常');
}

async function checkImageCapabilityRouting() {
  const primaryProcessor = new ImageProcessor();
  const primaryCalls = [];
  primaryProcessor.editImage = async (prompt, sourceImages, config) => {
    primaryCalls.push(config.imageMode);
    return { success: true, imageUrl: 'https://example.com/edited.png', model: config.model };
  };
  const primaryResult = await primaryProcessor.generateOrEditImage('改图测试', ['data:image/png;base64,dGVzdA=='], {
    imageConfig: {
      enabled: true,
      imageMode: 'ark-agent-plan',
      model: 'doubao-seedream-5.0-lite',
      baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      apiKey: 'primary-key',
      fallbackApi: {
        enabled: true,
        imageMode: 'openai',
        model: 'gpt-image-2',
        baseApi: 'https://example.com/v1',
        apiKey: 'fallback-key',
      },
    },
  });
  assert(primaryResult.success === true, 'Agent Plan 主接口未处理图生图请求');
  assert(primaryCalls.join(',') === 'ark-agent-plan', `Agent Plan 图生图被错误路由：${primaryCalls.join(',')}`);

  const fallbackProcessor = new ImageProcessor();
  const fallbackCalls = [];
  fallbackProcessor.editImage = async (prompt, sourceImages, config) => {
    fallbackCalls.push(config.imageMode);
    if (config.imageMode === 'ark-agent-plan') {
      return { success: true, imageUrl: 'https://example.com/agent-edited.png', model: config.model };
    }
    return { success: false, error: '主改图接口测试失败' };
  };
  const fallbackResult = await fallbackProcessor.generateOrEditImage('改图备用测试', ['data:image/png;base64,dGVzdA=='], {
    imageConfig: {
      enabled: true,
      imageMode: 'openai',
      model: 'gpt-image-2',
      baseApi: 'https://example.com/v1',
      apiKey: 'primary-key',
      fallbackApi: {
        enabled: true,
        imageMode: 'ark-agent-plan',
        model: 'doubao-seedream-5.0-lite',
        baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        apiKey: 'fallback-key',
      },
    },
  });
  assert(fallbackResult.success === true, 'Agent Plan 备用接口未接管图生图请求');
  assert(fallbackCalls.join(',') === 'openai,ark-agent-plan', `图生图主备调用顺序错误：${fallbackCalls.join(',')}`);
  logPass('生图主备接口能力路由正常');
}

function checkArkAgentPlanFallbackPrecheck() {
  const apiSettingsConsole = createApiSettingsConsole({
    getAllConfigs: () => ({ ai: {}, imageMonitor: {}, coreConfig: {} }),
  });
  const result = apiSettingsConsole.precheckApiSettings({
    ai: {
      baseApi: 'https://example.com/v1',
      apiKey: 'main-key',
      modelType: 'test-model',
      workingModel: 'test-model',
      multimodalModel: 'test-model',
      imageConfig: {
        enabled: true,
        imageMode: 'openai',
        model: 'gpt-image-2',
        baseApi: 'https://example.com/v1',
        apiKey: 'image-key',
        size: '1024x1024',
        responseFormat: 'b64_json',
        outputFormat: 'png',
        fallbackApi: {
          enabled: true,
          imageMode: 'ark-agent-plan',
          model: 'doubao-seedream-5.0-lite',
          baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
          apiKey: 'fallback-key',
          size: '1K',
          responseFormat: 'xml',
          outputFormat: 'webp',
        },
      },
      memeConfig: {},
    },
    imageMonitor: { enabled: false },
    coreConfig: { tools: { search: { enabled: false } } },
  });
  const errorText = result.errors.join('\n');
  assert(errorText.includes('备用火山 Agent Plan 图像尺寸'), '备用 Agent Plan 非法尺寸未被预检拦截');
  assert(errorText.includes('备用火山 Agent Plan 输出格式'), '备用 Agent Plan 非法输出格式未被预检拦截');
  assert(errorText.includes('备用火山 Agent Plan 响应格式'), '备用 Agent Plan 非法响应格式未被预检拦截');
  logPass('火山 Agent Plan 备用配置预检正常');
}

async function checkArkAgentPlanImageRuntime() {
  const originalPost = axios.post;
  const captured = [];
  axios.post = async (url, body, options) => {
    captured.push({ url, body, options });
    return { data: { data: [{ url: 'https://example.com/generated.png' }] } };
  };
  try {
    const processor = new ImageProcessor();
    const result = await processor.generateImageByArkAgentPlan('运行时测试', {
      imageMode: 'ark-agent-plan',
      baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      apiKey: 'test-agent-key',
      model: 'doubao-seedream-5.0-lite',
      size: '2K',
      outputFormat: 'png',
      responseFormat: 'url',
      watermark: false,
      retryCount: 0,
    });
    assert(result.success === true, 'Agent Plan 运行时没有解析成功响应');
    assert(result.imageUrl === 'https://example.com/generated.png', 'Agent Plan 返回 URL 解析错误');
    const generationRequest = captured.at(-1);
    assert(generationRequest?.url === 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations', 'Agent Plan 运行时请求路径错误');
    assert(generationRequest?.body?.size === '2K', 'Agent Plan 运行时未发送 2K');
    assert(generationRequest?.body?.watermark === false, 'Agent Plan 运行时未发送 watermark=false');
    assert(generationRequest?.options?.headers?.Authorization === 'Bearer test-agent-key', 'Agent Plan 运行时授权头错误');

    const editResult = await processor.editImage('多图融合测试', [
      'https://example.com/reference-1.png',
      'data:image/png;base64,dGVzdA==',
    ], {
      imageMode: 'ark-agent-plan',
      baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      apiKey: 'test-agent-key',
      model: 'doubao-seedream-5.0-lite',
      size: '3K',
      outputFormat: 'jpeg',
      responseFormat: 'url',
      watermark: false,
    });
    const editRequest = captured.at(-1);
    assert(editResult.success === true, 'Agent Plan 图生图运行时没有解析成功响应');
    assert(Array.isArray(editRequest?.body?.image) && editRequest.body.image.length === 2, 'Agent Plan 多图运行时未发送 image 数组');
    assert(editRequest?.body?.size === '3K', 'Agent Plan 图生图运行时未发送 3K');

    const fallback = buildImageFallbackConfig({
      imageMode: 'openai',
      size: '1024x1024',
      responseFormat: 'b64_json',
      outputFormat: 'png',
      watermark: true,
      fallbackApi: {
        enabled: true,
        imageMode: 'ark-agent-plan',
        model: 'doubao-seedream-5.0-lite',
        baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        apiKey: 'fallback-key',
        size: '4K',
        responseFormat: 'url',
        outputFormat: 'jpeg',
        watermark: false,
      },
    });
    assert(fallback?.imageMode === 'ark-agent-plan', '备用 Agent Plan 模式未保留');
    assert(fallback?.size === '4K' && fallback?.outputFormat === 'jpeg', '备用 Agent Plan 独立参数未生效');
    assert(fallback?.watermark === false, '备用 Agent Plan 水印开关未生效');

    const openAiFallback = buildImageFallbackConfig({
      imageMode: 'openai',
      size: '1024x1024',
      responseFormat: 'b64_json',
      outputFormat: 'png',
      fallbackApi: {
        enabled: true,
        imageMode: 'openai',
        model: 'gpt-image-2',
        baseApi: 'https://example.com/v1',
        apiKey: 'test-key',
      },
    });
    assert(openAiFallback?.size === '1024x1024', 'OpenAI 备用尺寸被 Agent Plan 默认值污染');
    assert(openAiFallback?.responseFormat === 'b64_json', 'OpenAI 备用响应格式被 Agent Plan 默认值污染');

    const apiSettingsConsole = createApiSettingsConsole({
      getAllConfigs: () => ({
        ai: {
          userAgent: 'crystelf-functional-smoke',
          imageConfig: {
            enabled: true,
            imageMode: 'ark-agent-plan',
            model: 'doubao-seedream-5.0-lite',
            baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
            apiKey: 'primary-image-key',
            size: '2K',
            responseFormat: 'url',
            outputFormat: 'png',
            watermark: false,
            timeout: 60000,
            fallbackApi: {
              enabled: true,
              imageMode: 'ark-agent-plan',
              model: 'doubao-seedream-5.0-lite',
              baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
              apiKey: 'fallback-image-key',
              size: '3K',
              responseFormat: 'url',
              outputFormat: 'jpeg',
              watermark: false,
            },
          },
        },
      }),
    });
    const generationTest = await apiSettingsConsole.testImageGenerationRuntime({
      role: 'primary',
      operation: 'generate',
      prompt: '控制台文生图测试',
    });
    assert(generationTest.success === true, '控制台真实文生图测试未成功');
    assert(generationTest.previewUrl.startsWith('/api/image-proxy?url='), '控制台文生图结果未使用安全图片代理');
    const generationConsoleRequest = captured.at(-1);
    assert(generationConsoleRequest?.options?.headers?.Authorization === 'Bearer primary-image-key', '控制台文生图没有使用主接口密钥');

    const editTest = await apiSettingsConsole.testImageGenerationRuntime({
      role: 'fallback',
      operation: 'edit',
      prompt: '控制台图生图测试',
      imageDataUrl: 'data:image/png;base64,dGVzdA==',
    });
    assert(editTest.success === true, '控制台真实图生图测试未成功');
    const editConsoleRequest = captured.at(-1);
    assert(editConsoleRequest?.body?.image === 'data:image/png;base64,dGVzdA==', '控制台图生图没有发送参考图');
    assert(editConsoleRequest?.options?.headers?.Authorization === 'Bearer fallback-image-key', '控制台图生图没有使用备用接口密钥');

    const fallbackWithoutKeyConsole = createApiSettingsConsole({
      getAllConfigs: () => ({
        ai: {
          apiKey: 'main-chat-key-must-not-leak',
          baseApi: 'https://main-chat.example.com/v1',
          imageConfig: {
            imageMode: 'ark-agent-plan',
            model: 'doubao-seedream-5.0-lite',
            baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
            apiKey: 'primary-image-key',
            size: '2K',
            fallbackApi: {
              enabled: true,
              imageMode: 'ark-agent-plan',
              model: 'doubao-seedream-5.0-lite',
              baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
              apiKey: '',
              size: '2K',
            },
          },
        },
      }),
    });
    let missingFallbackKeyRejected = false;
    try {
      await fallbackWithoutKeyConsole.testImageGenerationRuntime({
        role: 'fallback',
        operation: 'generate',
        prompt: '备用密钥隔离测试',
      });
    } catch (error) {
      missingFallbackKeyRejected = /API密钥不能为空/.test(String(error?.message || ''));
    }
    assert(missingFallbackKeyRejected, '备用生图真实测试错误继承了主对话 API 密钥');
    logPass('火山 Agent Plan 图像运行时与备用配置正常');
  } finally {
    axios.post = originalPost;
  }
}

async function main() {
  try {
    checkChatEngineUserMessageCompatibility();
    await checkMemoryRetrievalUserMessageCompatibility();
    await checkGroupManagementRawMessageListener();
    await checkPrivateSimulatorPreview();
    await checkPrivateAccessLists();
    await checkImageEditCommandSimulation();
    await checkLiveImageCommandSimulation();
    checkPersistentImageMonitorMd5Store();
    await checkImageMonitorStorageConfigSave();
    await checkStatusImageRender();
    checkWebConsolePublicUrlResolution();
    checkArkAgentPlanImageRequest();
    await checkArkAgentPlanImageRuntime();
    checkSdWebUiImageRequest();
    await checkSdWebUiImageRuntime();
    checkSdWebUiPrecheck();
    await checkSdWebUiConsoleSecretAndProbe();
    await checkImageCapabilityRouting();
    checkArkAgentPlanFallbackPrecheck();
    console.log('功能 smoke test 通过');
  } finally {
    await closeSharedPuppeteerBrowser().catch(() => {});
  }
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
