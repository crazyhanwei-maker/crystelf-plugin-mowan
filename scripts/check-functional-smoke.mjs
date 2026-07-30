import fs from 'fs/promises';
import path from 'node:path';
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
import { getImageDimensions, getImagePixelCount } from '../lib/ai/imageDimensions.js';
import { buildImageFallbackConfig } from '../lib/ai/apiFallback.js';
import { createApiSettingsConsole } from '../lib/webConsole/apiSettingsConsole.js';
import { createPersistentMd5Store } from '../lib/imageMonitor/persistentMd5Store.js';
import { evaluateSpamMessageWindow } from '../lib/groupManagement/contentModerationRuntime.js';
import { buildChatCompletionMessages } from '../lib/ai/chatEngine.js';
import { MemoryRetrieval } from '../lib/humanize/memoryRetrieval.js';
import {
  buildSdWebUiApiUrl,
  buildSdWebUiRequest,
  normalizeSdWebUiSettings,
} from '../lib/ai/sdWebUiApi.js';
import {
  discoverYunzaiCommandsFromLoader,
  executeYunzaiCommandBridge,
  getYunzaiCommandBridgeTool,
  resetYunzaiCommandBridgeRuntimeCache,
} from '../lib/ai/yunzaiCommandBridge.js';
import {
  buildAgentProcessEnv,
  buildAgentRunCommand,
  extractAgentJsonError,
  extractOpenCodeSessionId,
  getAgentWorkspaceOptions,
  normalizeAgentWorkbenchConfig,
} from '../lib/webConsole/agentWorkbenchConsole.js';
import {
  buildBundledOpenCodeEnvironment,
  isBundledOpenCodeBootstrapError,
  resolveBundledOpenCodeBootstrapCommand,
} from '../lib/webConsole/bundledOpenCodeRuntime.js';

globalThis.logger ||= {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const root = process.cwd();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logPass(message) {
  console.log(`✓ ${message}`);
}

async function checkYunzaiCommandBridge() {
  const replies = [];
  let queryRuns = 0;
  let updateRuns = 0;
  class MockTargetPlugin {
    constructor() {
      this.name = 'miao-plugin';
      this.dsc = '测试目标插件';
      this.event = 'message';
      this.priority = 500;
      this.rule = [
        { reg: /^#查询面板$/, fnc: 'queryPanel' },
        { reg: /^#更新面板$/, fnc: 'updatePanel', permission: 'master' },
        { reg: /^#执行终端命令 (.+)$/, fnc: 'executeShell', permission: 'master' },
        { reg: /^[\s\S]*$/, fnc: 'broadListener' },
      ];
    }

    async queryPanel(e) {
      queryRuns += 1;
      await e.reply('面板查询成功');
      return true;
    }

    async updatePanel(e) {
      updateRuns += 1;
      await e.reply('面板更新成功');
      return true;
    }

    async broadListener() {
      throw new Error('宽泛监听不应被桥接调用');
    }

    async executeShell() {
      throw new Error('终端命令不应被桥接调用');
    }
  }
  class MockCrystelfPlugin extends MockTargetPlugin {}
  const targetPlugin = new MockTargetPlugin();
  const loader = {
    priority: [
      {
        key: 'miao-plugin/index.js',
        name: 'miao-plugin',
        plugin: targetPlugin,
        class: MockTargetPlugin,
        priority: 500,
      },
      {
        key: 'crystelf-plugin/index.js',
        name: 'crystelf-plugin',
        plugin: new MockCrystelfPlugin(),
        class: MockCrystelfPlugin,
        priority: -1111,
      },
    ],
  };
  const commands = discoverYunzaiCommandsFromLoader(loader);
  assert(commands.length === 4, '命令桥接没有读取目标插件规则或错误读取了灵晶自身规则');
  const queryCommand = commands.find(item => item.fnc === 'queryPanel');
  const updateCommand = commands.find(item => item.fnc === 'updatePanel');
  const broadCommand = commands.find(item => item.fnc === 'broadListener');
  const shellCommand = commands.find(item => item.fnc === 'executeShell');
  assert(queryCommand?.eligible === true, '明确查询命令没有标记为可授权');
  assert(updateCommand?.defaultMode === 'confirm', '主人更新命令没有默认要求二次确认');
  assert(broadCommand?.eligible === false, '宽泛监听被错误标记为可授权');
  assert(shellCommand?.eligible === false, '终端执行命令被错误标记为可授权');

  const config = {
    enabled: true,
    confirmationTimeoutMs: 60000,
    maxCommandLength: 200,
    policies: [
      { id: queryCommand.id, enabled: true, mode: 'direct' },
      { id: updateCommand.id, enabled: true, mode: 'direct' },
    ],
  };
  const baseEvent = {
    msg: '帮我查询面板',
    raw_message: '帮我查询面板',
    message: [{ type: 'text', text: '帮我查询面板' }],
    message_type: 'group',
    post_type: 'message',
    group_id: 10001,
    user_id: 20002,
    isGroup: true,
    isMaster: true,
    sender: { role: 'owner', nickname: '测试用户' },
    member: { is_owner: true, is_admin: false },
    reply: async message => replies.push(String(message)),
  };
  const toolCtx = {
    sessionId: 'group:10001',
    groupId: 10001,
    userId: 20002,
    event: baseEvent,
    targetMessage: { content: '帮我查询面板' },
  };
  const tool = await getYunzaiCommandBridgeTool(toolCtx, { loader, config });
  assert(tool?.name === 'run_yunzai_command', '启用且已授权时没有注册命令桥接工具');
  assert(tool.parameters.properties.command_id.enum.length === 2, '命令桥接工具暴露了未授权规则');

  const directResult = await executeYunzaiCommandBridge({
    command_id: queryCommand.id,
    command: '#查询面板',
  }, toolCtx, { loader, config });
  assert(directResult.success === true && queryRuns === 1, '直接桥接命令没有执行目标插件函数');
  assert(baseEvent.msg === '帮我查询面板', '桥接命令污染了原始消息事件');
  assert(replies.includes('面板查询成功'), '目标插件回复没有发送到原会话');

  const deniedResult = await executeYunzaiCommandBridge({
    command_id: updateCommand.id,
    command: '#更新面板',
  }, {
    ...toolCtx,
    userId: 30003,
    event: {
      ...baseEvent,
      user_id: 30003,
      isMaster: false,
      sender: { role: 'member', nickname: '普通用户' },
      member: { is_owner: false, is_admin: false },
    },
    targetMessage: { content: '帮我更新面板' },
  }, { loader, config });
  assert(deniedResult.reason === 'permission' && updateRuns === 0, '普通用户绕过了目标命令权限检查');

  const prepareResult = await executeYunzaiCommandBridge({
    command_id: updateCommand.id,
    command: '#更新面板',
  }, { ...toolCtx, targetMessage: { content: '帮我更新面板' } }, { loader, config });
  assert(prepareResult.confirmationRequired === true && updateRuns === 0, '高风险命令没有等待用户二次确认');
  const confirmEvent = { ...baseEvent, msg: '确认执行', reply: baseEvent.reply };
  const confirmResult = await executeYunzaiCommandBridge({
    command_id: updateCommand.id,
    command: '#更新面板',
  }, {
    ...toolCtx,
    event: confirmEvent,
    targetMessage: { content: '确认执行' },
  }, { loader, config });
  assert(confirmResult.success === true && updateRuns === 1, '同一用户明确确认后没有执行高风险命令');
  resetYunzaiCommandBridgeRuntimeCache();
  logPass('Yunzai LLM 命令桥接隔离、授权与二次确认正常');
}

function checkAgentWorkbenchSafety() {
  const config = normalizeAgentWorkbenchConfig({});
  assert(config.enabled === false, 'Agent 工作台安全默认值不是关闭');
  assert(config.writeEnabled === false, 'Agent 实际修改默认值不是关闭');
  assert(config.allowNetwork === false && config.allowAllDirectories === false, 'Agent 高权限默认值不是关闭');
  assert(config.maxConcurrentTasks === 1, 'Agent 工作台默认并发不是 1');
  assert(config.writableWorkspaces.plugin === true && config.writableWorkspaces.plugins === false && config.writableWorkspaces.yunzai === false, 'Agent 写入目录默认授权范围错误');
  const workspaces = getAgentWorkspaceOptions({
    pluginRoot: root,
    yunzaiRoot: root,
    pluginsRoot: path.join(root, 'plugins'),
  });
  assert(workspaces.length >= 1 && workspaces[0].id === 'plugin', 'Agent 工作目录白名单没有包含插件目录');
  const command = buildAgentRunCommand({
    providerId: 'opencode',
    workspacePath: root,
    mode: 'patch',
    prompt: '检查测试文件并给出补丁建议',
    title: 'Agent 安全烟测',
    model: 'provider/model',
  });
  const argsText = command.args.join('\n');
  assert(command.providerId === 'opencode', 'Agent 提供方规范化失败');
  assert(argsText.includes('--pure') && argsText.includes('--agent') && argsText.includes('plan'), 'Agent 没有固定使用 pure plan 模式');
  assert(!argsText.includes('--auto') && !argsText.includes('--dangerously-skip-permissions'), 'Agent 命令包含自动批准危险参数');
  assert(argsText.includes('不要实际应用补丁'), '补丁建议模式没有禁止直接应用补丁');
  const privilegedCommand = buildAgentRunCommand({
    providerId: 'opencode',
    workspacePath: root,
    mode: 'analyze',
    prompt: '联网检查指定文档并对比工作目录外的配置',
    allowNetwork: true,
    allowAllDirectories: true,
  });
  const privilegedArgsText = privilegedCommand.args.join('\n');
  assert(privilegedArgsText.includes('已授予联网权限') && privilegedArgsText.includes('已授予全目录权限'), 'Agent 高权限提示没有传入任务');
  assert(!argsText.includes('--session'), '新 Agent 会话不应携带续接参数');
  const continuedCommand = buildAgentRunCommand({
    providerId: 'opencode',
    workspacePath: root,
    mode: 'analyze',
    prompt: '继续检查上一轮提到的文件',
    sessionId: 'ses_056f03688ffeNUpq71A0wFRNwd',
  });
  const continuedArgsText = continuedCommand.args.join('\n');
  assert(continuedArgsText.includes('--session') && continuedArgsText.includes('ses_056f03688ffeNUpq71A0wFRNwd'), 'Agent 多轮会话没有使用 OpenCode session ID');
  assert(!continuedArgsText.includes('--title'), '续接 OpenCode 会话时不应重新设置标题');
  assert(extractOpenCodeSessionId('{"type":"text","sessionID":"ses_056f03688ffeNUpq71A0wFRNwd","part":{"type":"text","text":"完成"}}') === 'ses_056f03688ffeNUpq71A0wFRNwd', 'OpenCode session ID 没有从 JSONL 输出中提取');
  let invalidSessionRejected = false;
  try {
    buildAgentRunCommand({
      providerId: 'opencode',
      workspacePath: root,
      mode: 'analyze',
      prompt: '非法会话测试',
      sessionId: 'ses_invalid;command',
    });
  } catch (error) {
    invalidSessionRejected = error?.code === 'AGENT_SESSION_ID_INVALID';
  }
  assert(invalidSessionRejected, '非法 OpenCode session ID 没有被拒绝');
  const editCommand = buildAgentRunCommand({
    providerId: 'opencode',
    workspacePath: root,
    mode: 'edit',
    prompt: '修复测试文件中的错误',
    title: 'Agent 写入烟测',
  });
  const editArgsText = editCommand.args.join('\n');
  assert(editArgsText.includes('--agent') && editArgsText.includes('build'), '实际修改模式没有使用 OpenCode build Agent');
  assert(editArgsText.includes('直接在当前工作目录内创建或修改'), '实际修改模式没有写入安全提示');
  assert(!editArgsText.includes('--auto') && !editArgsText.includes('--dangerously-skip-permissions'), '实际修改模式包含自动批准危险参数');
  const processEnv = buildAgentProcessEnv({
    HOME: path.join(root, 'temp', 'missing-agent-home'),
    USERPROFILE: path.join(root, 'temp', 'missing-agent-home'),
    PATH: process.env.PATH || '',
  }, {
    fallbackRoot: path.join(root, 'temp', 'agent-workbench-smoke'),
  });
  assert(processEnv.XDG_CONFIG_HOME?.endsWith(path.join('agent-workbench-smoke', 'agent-cli-runtime', 'config')), 'Agent CLI 不可写配置目录没有切换到插件私有目录');
  assert(processEnv.XDG_DATA_HOME?.endsWith(path.join('agent-workbench-smoke', 'agent-cli-runtime', 'data')), 'Agent CLI 不可写数据目录没有切换到插件私有目录');
  assert(processEnv.XDG_STATE_HOME?.endsWith(path.join('agent-workbench-smoke', 'agent-cli-runtime', 'state')), 'Agent CLI 不可写状态目录没有切换到插件私有目录');
  assert(processEnv.XDG_CACHE_HOME?.endsWith(path.join('agent-workbench-smoke', 'agent-cli-runtime', 'cache')), 'Agent CLI 不可写缓存目录没有切换到插件私有目录');
  const forcedPrivateEnv = buildAgentProcessEnv({
    HOME: root,
    USERPROFILE: root,
    PATH: process.env.PATH || '',
  }, {
    fallbackRoot: path.join(root, 'temp', 'agent-workbench-smoke', 'forced'),
    forcePrivateRuntime: true,
  });
  assert(forcedPrivateEnv.XDG_CONFIG_HOME?.includes(path.join('forced', 'agent-cli-runtime', 'config')), '内置 OpenCode 探测没有强制使用插件私有配置目录');
  assert(forcedPrivateEnv.HOME?.includes(path.join('forced', 'agent-cli-runtime', 'home')), '内置 OpenCode 探测没有强制使用插件私有 HOME 目录');
  assert(forcedPrivateEnv.USERPROFILE === forcedPrivateEnv.HOME, '内置 OpenCode 的 Windows 用户目录没有隔离');
  assert(extractAgentJsonError('{"type":"error","error":{"data":{"message":"Unsupported OpenCode model"}}}') === 'Unsupported OpenCode model', 'Agent JSON 错误事件没有被识别');
  const bundledRuntime = buildBundledOpenCodeEnvironment({
    aiConfig: {
      baseApi: 'https://chat.example.com/v1',
      apiKey: 'test-key',
      modelType: 'gpt-5.4-mini',
      userAgent: 'crystelf-agent-smoke',
    },
    runtimeRoot: path.join(root, 'temp', 'agent-workbench-smoke', 'runtime'),
  });
  assert(bundledRuntime.config.model === 'crystelf-chat/gpt-5.4-mini', '内置 OpenCode 默认模型路由错误');
  assert(bundledRuntime.config.provider['crystelf-chat'].options.baseURL === 'https://chat.example.com/v1', '内置 OpenCode 没有使用聊天 API 地址');
  assert(bundledRuntime.env.OPENCODE_CONFIG_CONTENT.includes('crystelf-agent-smoke'), '内置 OpenCode 没有传入自定义 User-Agent');
  assert(bundledRuntime.env.HOME?.endsWith(path.join('runtime', 'home')), '内置 OpenCode 没有使用插件私有 HOME 目录');
  assert(bundledRuntime.env.USERPROFILE === bundledRuntime.env.HOME, '内置 OpenCode 的 USERPROFILE 没有隔离');
  assert(bundledRuntime.config.permission.edit === 'deny' && bundledRuntime.config.permission.write === 'deny', '只读 Agent 没有禁用 edit/write 权限');
  const customRuntime = buildBundledOpenCodeEnvironment({
    aiConfig: {
      baseApi: 'https://default-chat.example.com/v1',
      apiKey: 'default-key',
      modelType: 'default-model',
    },
    customApi: {
      enabled: true,
      baseApi: 'https://custom-agent.example.com/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      userAgent: 'custom-agent-smoke',
    },
    runtimeRoot: path.join(root, 'temp', 'agent-workbench-smoke', 'custom-runtime'),
  });
  assert(customRuntime.config.provider['crystelf-chat'].options.baseURL === 'https://custom-agent.example.com/v1', 'Agent 自定义 API 地址没有覆盖默认聊天 API');
  assert(customRuntime.config.provider['crystelf-chat'].options.apiKey === 'custom-key', 'Agent 自定义 API 密钥没有生效');
  assert(customRuntime.config.model === 'crystelf-chat/custom-model', 'Agent 自定义 API 默认模型没有生效');
  assert(customRuntime.env.OPENCODE_CONFIG_CONTENT.includes('custom-agent-smoke'), 'Agent 自定义 API User-Agent 没有生效');
  assert(isBundledOpenCodeBootstrapError("Error: opencode-ai's postinstall script was not run") === true, 'OpenCode 缺失运行文件错误没有被识别');
  assert(isBundledOpenCodeBootstrapError('普通网络连接失败') === false, '普通错误被误判为 OpenCode 运行文件缺失');
  assert(resolveBundledOpenCodeBootstrapCommand({ rootPath: path.join(root, 'temp', 'missing-opencode') }) === null, '缺少 OpenCode 安装脚本时不应创建补全命令');
  const writableRuntime = buildBundledOpenCodeEnvironment({
    aiConfig: { baseApi: 'https://chat.example.com/v1', apiKey: 'test-key', modelType: 'gpt-5.4-mini' },
    writeMode: true,
    runtimeRoot: path.join(root, 'temp', 'agent-workbench-smoke', 'write-runtime'),
  });
  assert(writableRuntime.config.permission.edit === 'allow' && writableRuntime.config.permission.write === 'allow', '实际修改 Agent 没有开放文件编辑权限');
  assert(writableRuntime.config.permission.bash === 'deny' && writableRuntime.config.permission.external_directory === 'deny', '实际修改 Agent 没有禁用终端或外部目录');
  const privilegedRuntime = buildBundledOpenCodeEnvironment({
    aiConfig: { baseApi: 'https://chat.example.com/v1', apiKey: 'test-key', modelType: 'gpt-5.4-mini' },
    writeMode: true,
    allowNetwork: true,
    allowAllDirectories: true,
    runtimeRoot: path.join(root, 'temp', 'agent-workbench-smoke', 'privileged-runtime'),
  });
  assert(privilegedRuntime.config.permission.webfetch === 'allow' && privilegedRuntime.config.permission.websearch === 'allow', 'Agent 联网权限没有开放网页工具');
  assert(privilegedRuntime.config.permission.external_directory === 'allow', 'Agent 全目录权限没有开放外部目录');
  assert(privilegedRuntime.config.permission.bash === 'deny', 'Agent 高权限配置意外开放了终端命令');
  logPass('Agent 工作台分析、受控写入、目录白名单与安全默认值正常');
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

async function checkIsolatedGroupSpamListener() {
  const spamConfig = {
    detectSpamMessages: true,
    burstLimit: 12,
    burstWindowSeconds: 60,
  };
  const baseTime = Date.now();
  const groupId = `70138${String(baseTime).slice(-4)}`;
  const userId = `14203${String(baseTime + 1).slice(-5)}`;
  for (let index = 0; index < 12; index += 1) {
    const result = evaluateSpamMessageWindow(groupId, userId, spamConfig, baseTime + index);
    assert(result.triggered === false, `刷屏检测在第 ${index + 1} 条消息提前触发`);
  }
  const threshold = evaluateSpamMessageWindow(groupId, userId, spamConfig, baseTime + 12);
  assert(threshold.triggered === true && threshold.count === 13, '刷屏检测没有在超过 12 条时触发');
  const duplicate = evaluateSpamMessageWindow(groupId, userId, spamConfig, baseTime + 13);
  assert(duplicate.triggered === false, '同一刷屏窗口重复触发处罚');
  const disabled = evaluateSpamMessageWindow('701380001', '142030001', {
    ...spamConfig,
    detectSpamMessages: false,
  }, baseTime);
  assert(disabled.triggered === false && disabled.count === 0, '刷屏检测关闭后仍记录或触发');

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
    const module = await import(`../apps/group-management.js?spam-smoke=${Date.now()}`);
    assert(registrations.some(item => item.event === 'message.group'), '群管理没有注册隔离刷屏监听器');

    const tasks = [];
    const handled = [];
    let rawHandler = null;
    const bot = {
      on: (event, handler) => {
        if (event === 'message.group') rawHandler = handler;
      },
    };
    const dependencies = {
      getMainConfig: () => ({ groupManagement: true }),
      handleSpamModeration: async event => handled.push(event),
      logger: { warn: () => {} },
      schedule: task => tasks.push(task),
    };
    assert(module.registerGroupSpamMessageListener(bot, dependencies) === true, '隔离刷屏监听器注册失败');
    assert(module.registerGroupSpamMessageListener(bot, dependencies) === false, '同一 Bot 重复注册刷屏监听器');

    const originalMessage = Object.freeze([{ type: 'text', text: '高速消息' }]);
    const originalEvent = {
      group_id: 701380759,
      user_id: 1420354365,
      self_id: 2292379750,
      message_id: 987654321,
      raw_message: '高速消息',
      message: originalMessage,
      sender: Object.freeze({ role: 'member', nickname: '测试用户' }),
    };
    const originalKeys = Object.keys(originalEvent);
    rawHandler(originalEvent);
    assert(handled.length === 0, '刷屏风控没有延迟到原消息调度之后');
    assert(tasks.length === 1, '刷屏监听没有生成独立任务');
    assert(JSON.stringify(Object.keys(originalEvent)) === JSON.stringify(originalKeys), '刷屏监听修改了原事件字段');
    originalEvent.isMaster = true;
    await tasks[0]();
    assert(handled.length === 1, '独立刷屏任务没有执行');
    assert(handled[0] !== originalEvent, '刷屏风控直接使用并可能修改原事件');
    assert(handled[0].message !== originalMessage, '刷屏事件消息段没有隔离复制');
    assert(handled[0].isMaster === true, '刷屏快照没有等待 TRSS 完成事件标准化');

    const runtime = new module.groupManagementRuntime();
    assert(runtime.rule.some(item => item.fnc === 'contentModeration'), '原有群消息风控规则被移除');
  } finally {
    if (previousBot === undefined) delete globalThis.Bot;
    else globalThis.Bot = previousBot;
    if (previousPlugin === undefined) delete globalThis.plugin;
    else globalThis.plugin = previousPlugin;
  }

  logPass('隔离刷屏监听、高速计数与单窗口去重正常');
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
      { label: '插件版本', value: 'crystelf-plugin v2.2.0' },
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
    webSearch: true,
    quality: 'high',
    n: 1,
  }, ['https://example.com/reference.png']);
  assert(body.size === '2K', 'Agent Plan 2K 分辨率大小写没有保留');
  assert(body.output_format === 'png', 'Agent Plan output_format 未写入');
  assert(body.response_format === 'url', 'Agent Plan response_format 未写入');
  assert(body.watermark === false, 'Agent Plan watermark=false 未写入');
  assert(Array.isArray(body.tools) && body.tools.length === 1 && body.tools[0]?.type === 'web_search', 'Agent Plan 联网搜索工具未写入');
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
  assert(!Object.prototype.hasOwnProperty.call(multiImageBody, 'tools'), 'Agent Plan 联网搜索关闭时不应发送 tools');
  logPass('火山 Agent Plan 图像请求构造正常');
}

function checkImageDimensionParser() {
  const png = Buffer.alloc(24);
  png[0] = 0x89;
  png[1] = 0x50;
  png[2] = 0x4e;
  png[3] = 0x47;
  png.writeUInt32BE(1920, 16);
  png.writeUInt32BE(1920, 20);
  const dimensions = getImageDimensions(png);
  assert(dimensions?.width === 1920 && dimensions?.height === 1920, 'PNG 图片尺寸解析错误');
  assert(getImagePixelCount(dimensions) === 3686400, '图片像素数计算错误');
  logPass('图生图图片尺寸预检解析正常');
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
      webSearch: true,
      retryCount: 0,
    });
    assert(result.success === true, 'Agent Plan 运行时没有解析成功响应');
    assert(result.imageUrl === 'https://example.com/generated.png', 'Agent Plan 返回 URL 解析错误');
    const generationRequest = captured.at(-1);
    assert(generationRequest?.url === 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations', 'Agent Plan 运行时请求路径错误');
    assert(generationRequest?.body?.size === '2K', 'Agent Plan 运行时未发送 2K');
    assert(generationRequest?.body?.watermark === false, 'Agent Plan 运行时未发送 watermark=false');
    assert(generationRequest?.body?.tools?.[0]?.type === 'web_search', 'Agent Plan 运行时未发送联网搜索工具');
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

    const lowResolutionPng = Buffer.alloc(24);
    lowResolutionPng[0] = 0x89;
    lowResolutionPng[1] = 0x50;
    lowResolutionPng[2] = 0x4e;
    lowResolutionPng[3] = 0x47;
    lowResolutionPng.writeUInt32BE(640, 16);
    lowResolutionPng.writeUInt32BE(480, 20);
    const requestCountBeforePrecheck = captured.length;
    const lowResolutionResult = await processor.editImage('低分辨率预检', [
      `data:image/png;base64,${lowResolutionPng.toString('base64')}`,
    ], {
      imageMode: 'ark-agent-plan',
      baseApi: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      apiKey: 'test-agent-key',
      model: 'doubao-seedream-5.0-lite',
      size: '2K',
      outputFormat: 'png',
      responseFormat: 'url',
      watermark: false,
    });
    assert(lowResolutionResult.success === false, '低分辨率参考图没有被预检拦截');
    assert(String(lowResolutionResult.error).includes('参考图像素不足'), '低分辨率预检提示不明确');
    assert(captured.length === requestCountBeforePrecheck, '低分辨率预检后仍然请求了上游接口');

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
        webSearch: true,
      },
    });
    assert(fallback?.imageMode === 'ark-agent-plan', '备用 Agent Plan 模式未保留');
    assert(fallback?.size === '4K' && fallback?.outputFormat === 'jpeg', '备用 Agent Plan 独立参数未生效');
    assert(fallback?.watermark === false, '备用 Agent Plan 水印开关未生效');
    assert(fallback?.webSearch === true, '备用 Agent Plan 联网搜索开关未生效');

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
    await checkIsolatedGroupSpamListener();
    await checkPrivateSimulatorPreview();
    await checkPrivateAccessLists();
    await checkImageEditCommandSimulation();
    await checkLiveImageCommandSimulation();
    checkPersistentImageMonitorMd5Store();
    await checkImageMonitorStorageConfigSave();
    await checkStatusImageRender();
    checkWebConsolePublicUrlResolution();
    checkArkAgentPlanImageRequest();
    checkImageDimensionParser();
    await checkArkAgentPlanImageRuntime();
    checkSdWebUiImageRequest();
    await checkSdWebUiImageRuntime();
    checkSdWebUiPrecheck();
    await checkSdWebUiConsoleSecretAndProbe();
    await checkImageCapabilityRouting();
    checkArkAgentPlanFallbackPrecheck();
    await checkYunzaiCommandBridge();
    checkAgentWorkbenchSafety();
    console.log('功能 smoke test 通过');
  } finally {
    await closeSharedPuppeteerBrowser().catch(() => {});
  }
}

main().catch(error => {
  console.error(error?.message || error);
  process.exit(1);
});
