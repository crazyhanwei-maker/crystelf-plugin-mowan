// Isolated ZCode runtime checks: node --experimental-vm-modules scripts/check-zcode-runtime.mjs
// 隔离风格与 check-help-diy.mjs 一致：VM SourceTextModule + 合成依赖 + scratch 目录，
// 不读写真实运行配置；子进程管道用"假 zcode.cjs"模拟上游 stream-json 输出协议。
// 真实冒烟（需要测试 key 与真实产物）另行执行，见 docs/zcode-runtime-guide.md。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-zcode-runtime-'));
const results = [];

async function loadModule(relativePath, dependencies, globals = {}) {
  const context = vm.createContext({ console, process, Buffer, setTimeout, clearTimeout, ...globals });
  const filename = path.join(projectDir, relativePath);
  const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), {
    context,
    identifier: filename,
    initializeImportMeta: meta => { meta.url = pathToFileURL(filename).href; },
  });
  await module.link(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
    const exports = dependencies[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

function check(label, callback) {
  callback();
  results.push(label);
}
async function checkAsync(label, callback) {
  await callback();
  results.push(label);
}
const plain = value => JSON.parse(JSON.stringify(value));

// 与仓库 modules/openai/protocolAdapter.js 行为一致的镜像 stub（PROTOCOLS + 别名表 + 默认 openai）
const PROTOCOLS = new Set(['openai', 'anthropic', 'grok']);
const PROTOCOL_ALIASES = new Map([
  ['gork', 'grok'], ['xai', 'grok'], ['claude', 'anthropic'], ['messages', 'anthropic'],
  ['chatgpt', 'openai'], ['', 'openai'],
]);
const normalizeAiProtocol = value => {
  const raw = String(value ?? '').trim().toLowerCase();
  return PROTOCOL_ALIASES.get(raw) || (PROTOCOLS.has(raw) ? raw : 'openai');
};

// Path stub：全部读写都落在 scratch 内，绝不触碰真实数据目录
const PathStub = {
  root: path.join(scratch, 'plugin-root'),
  data: path.join(scratch, 'data'),
};

const runtimeRoot = path.join(PathStub.data, 'agent-cli-runtime', 'zcode');

// fake CLI 上报的绝对路径（Windows 形式）；跨平台断言按当前平台的 isAbsolute 规则换算
const FAKE_ABS_FILE = 'C:\\abs\\target.md';

// 假 zcode.cjs：按 prompt 指令模拟上游 -p --output-format stream-json 的行为
const fakeCliSource = `
const fs = require('fs');
const args = process.argv.slice(2);
const promptAt = args.indexOf('-p');
const prompt = promptAt >= 0 ? String(args[promptAt + 1] || '') : '';
const dump = process.env.FAKE_ARGS_FILE;
if (dump) {
  const modeAt = args.indexOf('--mode');
  const dtIndex = args.indexOf('--disallowedTools');
  fs.writeFileSync(dump, JSON.stringify({
    prompt,
    mode: modeAt >= 0 ? args[modeAt + 1] : null,
    disallowedTools: dtIndex >= 0 ? args.slice(dtIndex + 1).filter((v, i, arr) => !v.startsWith('--')) : [],
    cwd: args[args.indexOf('--cwd') + 1] || null,
    resume: args.includes('--resume') ? args[args.indexOf('--resume') + 1] || '' : null,
  }), 'utf8');
}
const send = obj => process.stdout.write(JSON.stringify(obj) + '\\n');
if (prompt === 'HANG') { setTimeout(() => {}, 60000); return; }
if (prompt === 'FAIL_EXIT') { process.stderr.write('boom: provider auth failed\\n'); process.exit(3); }
if (prompt === 'FAIL_TURN') {
  send({ type: 'session.created', sessionId: 'sess-fail', payload: {} });
  send({ type: 'turn.failed', payload: { error: { message: '上游鉴权失败' }, turnPhase: 'model' } });
  process.exit(1);
}
if (prompt === 'RELATIVE') {
  send({ type: 'tool.updated', payload: { kind: 'scheduled', toolName: 'Write', input: { file_path: 'note.md' } } });
  send({ type: 'result', sessionId: 'sess-rel', response: 'done', projection: { status: 'complete' } });
  process.exit(0);
}
send({ type: 'session.created', sessionId: 'sess-fake-1', payload: { mode: 'plan' } });
send({ type: 'model.streaming', payload: { kind: 'text_delta', delta: '你好' } });
send({ type: 'model.streaming', payload: { kind: 'text_delta', delta: '，世界' } });
send({ type: 'tool.updated', payload: { kind: 'scheduled', toolName: 'Write', input: { file_path: ${JSON.stringify(FAKE_ABS_FILE)} } } });
send({ type: 'tool.updated', payload: { kind: 'result', toolName: 'Write', result: 'written' } });
send({ type: 'permission.requested', payload: { toolName: 'Bash', reason: 'headless deny' } });
send({ type: 'tool.updated', payload: { kind: 'scheduled', toolName: 'Bash', input: { command: 'echo hi' } } });
send({ type: 'result', sessionId: 'sess-fake-1', response: 'final answer', usage: { inputTokens: 11, outputTokens: 7 }, projection: { status: 'complete', turnCount: 1 } });
process.exit(0);
`;

function stageFakeProduct() {
  const runtimeDir = path.join(runtimeRoot, 'runtime');
  fs.mkdirSync(path.join(runtimeDir, 'provider'), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'zcode.cjs'), fakeCliSource, 'utf8');
  fs.writeFileSync(path.join(runtimeDir, 'provider', 'zcode-builtin.json'), JSON.stringify({
    schemaVersion: 1, revision: 1, config: { providerConfigRules: {}, modelConfigRules: {} },
  }), 'utf8');
  fs.writeFileSync(path.join(runtimeRoot, 'manifest.json'), JSON.stringify({
    product: 'fake', version: '3.14.3', files: [],
  }), 'utf8');
}

const aiConfig = {
  baseApi: 'https://api.example.com/v1',
  apiKey: 'sk-test-key-123',
  apiProtocol: 'openai',
  model: 'glm-5.3-flash',
};

async function main() {
  let zcode;
  try {
    zcode = await loadModule('lib/webConsole/bundledZcodeRuntime.js', {
      crypto: { default: crypto },
      fs: { default: fs },
      path: { default: path },
      child_process: { spawn },
      '../../constants/path.js': { default: PathStub },
      '../../modules/openai/protocolAdapter.js': { normalizeAiProtocol },
      // 上下文窗口查表（models.dev 缓存）：沙箱里没有缓存文件，返回 0 走默认兜底
      '../ai/modelCatalog.js': { lookupModelContextLimit: () => 0 },
    });
  } catch (error) {
    console.error('模块加载失败（需 node --experimental-vm-modules）:', error.message);
    process.exit(1);
  }

  // ---- buildZcodeConfig：纯函数行为 ----
  check('自定义渠道选择：defaultModelSelection 指向所选渠道而非主供应商', () => {
    const providers = [
      { name: '旧渠道', baseApi: 'https://old.example.com/v1', apiKey: 'k-old', apiProtocol: 'anthropic', models: [{ name: 'probe-old' }] },
      { name: '新渠道', baseApi: 'https://new.example.com/v1', apiKey: 'k-new', apiProtocol: 'openai', models: [{ name: 'probe-new' }] },
    ];
    const providerIdOf = name => {
      const slug = String(name).toLowerCase().replace(/[^a-z0-9_-]/g, '');
      let hash = 5381;
      for (const ch of String(name)) hash = ((hash << 5) + hash + ch.codePointAt(0)) >>> 0;
      return `custom-${slug || 'p'}-${hash.toString(36)}`;
    };
    const newId = providerIdOf('新渠道');
    const config = zcode.buildZcodeConfig(aiConfig, 'probe-new', {
      requestedProviderId: newId,
      modelProviders: providers,
    });
    assert.equal(config.config.defaultModelSelection.providerId, newId, '默认模型没有指向选中的渠道（仍回落主供应商）');
    assert.equal(config.config.defaultModelSelection.modelId, 'probe-new');
    // vm 沙箱里的数组原型与宿主不同，deepStrictEqual 会失败，改为比较序列化结果
    assert.equal(JSON.stringify(config.config.providerOrder), JSON.stringify([newId]), 'providerOrder 没有把选中渠道排到首位');
    // 两个渠道都要声明且互不覆盖
    const rules = config.config.providerConfigRules.providerRules;
    const newRule = rules.find(rule => rule.providerId === newId);
    const oldRule = rules.find(rule => rule.providerId === providerIdOf('旧渠道'));
    assert.ok(newRule, '选中渠道没有写入 providerRules');
    assert.equal(newRule.config.api.baseUrl, 'https://new.example.com/v1');
    assert.equal(newRule.config.api.type, 'openai-chat-completions');
    assert.ok(oldRule, '未选中的渠道丢失声明');
    assert.equal(oldRule.config.api.type, 'anthropic-messages', '渠道协议串味');
    // 按名称选择同样要命中（历史任务兼容）
    const byName = zcode.buildZcodeConfig(aiConfig, 'probe-old', { requestedProviderId: '旧渠道', modelProviders: providers });
    assert.equal(byName.config.defaultModelSelection.providerId, providerIdOf('旧渠道'), '按供应商名称选择无法命中渠道');
  });

  check('openai 协议配置：供应商规则、模型选择与 key 位置', () => {
    const config = zcode.buildZcodeConfig(aiConfig, 'GLM-5.3-Flash/试验::v1', {});
    assert.equal(config.schemaVersion, 1);
    const rule = config.config.providerConfigRules.providerRules[0];
    assert.equal(rule.providerId, 'crystelf-chat');
    assert.equal(rule.config.api.type, 'openai-chat-completions');
    assert.equal(rule.config.api.baseUrl, 'https://api.example.com/v1');
    assert.equal(rule.config.access.apiKey, 'sk-test-key-123');
    assert.deepEqual(plain(rule.config.personalModelIds), ['GLM-5.3-Flash/::v1']);
    assert.deepEqual(plain(config.config.defaultModelSelection), {
      providerId: 'crystelf-chat', modelId: 'GLM-5.3-Flash/::v1', options: { reasoningLevel: 'enabled' },
    });
    const serialized = JSON.stringify(config);
    assert.equal(serialized.split('sk-test-key-123').length - 1, 1, 'key 只允许出现在 access.apiKey 一处');
    assert.match(serialized, /"group":"standard-personal"/);
  });
  check('anthropic 协议：api.type 映射与 /v1 归一', () => {
    const config = zcode.buildZcodeConfig({ ...aiConfig, apiProtocol: 'anthropic' }, 'm', {});
    assert.equal(config.config.providerConfigRules.providerRules[0].config.api.type, 'anthropic-messages');
    assert.equal(config.config.providerConfigRules.providerRules[0].config.api.baseUrl, 'https://api.example.com/v1');
    const aliased = zcode.buildZcodeConfig({ ...aiConfig, apiProtocol: 'claude', baseApi: 'https://gw.example.com/anthropic/v1/' }, 'm', {});
    assert.equal(aliased.config.providerConfigRules.providerRules[0].config.api.baseUrl, 'https://gw.example.com/anthropic/v1');
    const grok = zcode.buildZcodeConfig({ ...aiConfig, apiProtocol: 'grok' }, 'm', {});
    assert.equal(grok.config.providerConfigRules.providerRules[0].config.api.type, 'openai-chat-completions');
  });
  check('缺地址/缺 key 抛可区分错误（含自定义 API 变体）', () => {
    for (const [input, code] of [
      [{ ...aiConfig, baseApi: '' }, 'AGENT_CHAT_API_MISSING'],
      [{ ...aiConfig, apiKey: '' }, 'AGENT_CHAT_API_KEY_MISSING'],
    ]) {
      try {
        zcode.buildZcodeConfig(input, 'm', {});
        assert.fail(code);
      } catch (error) {
        assert.equal(error.code, code);
      }
    }
    try {
      zcode.buildZcodeConfig(aiConfig, 'm', { customApi: { enabled: true, baseApi: '', apiKey: '' } });
      assert.fail('custom');
    } catch (error) {
      assert.equal(error.code, 'AGENT_CUSTOM_API_MISSING');
    }
  });
  check('自定义供应商列表与选中切换', () => {
    const config = zcode.buildZcodeConfig(aiConfig, 'their-model', {
      requestedProviderId: '友商 A',
      modelProviders: [{
        name: '友商 A', baseApi: 'https://b.example.com', apiKey: 'sk-b', models: ['their-model', 'their-mini'],
      }],
    });
    const rules = config.config.providerConfigRules.providerRules;
    assert.equal(rules.length, 2);
    const custom = rules.find(item => item.providerId.startsWith('custom-'));
    assert.equal(custom.config.personalModelIds.join(','), 'their-model,their-mini');
    assert.equal(config.config.defaultModelSelection.providerId, custom.providerId);
    assert.equal(config.config.defaultModelSelection.modelId, 'their-model');
  });
  check('manual 模型规则恒在且字段完整（decode 必填项）', () => {
    const withRule = zcode.buildZcodeConfig(aiConfig, 'm', { vision: true, contextWindow: 200000, maxOutputTokens: 32000 });
    const [manual] = withRule.config.modelConfigRules.manualProviderModelRules;
    assert.equal(manual.modelId, 'm');
    assert.equal(manual.config.properties.contextWindow, 200000);
    assert.equal(manual.config.properties.inputFormat.supportsImage, true);
    assert.deepEqual(plain(manual.config.optionSpecs.reasoningLevel), { values: ['disabled', 'enabled'], map: '{}' });
    assert.equal(manual.config.optionSpecs.maxOutputTokens.max, 32000);
    assert.equal('supportsToolCall' in manual.config.properties, false, 'supportsToolCall 不在手动白名单');
    const withoutRule = zcode.buildZcodeConfig(aiConfig, 'm', {});
    const [minimal] = withoutRule.config.modelConfigRules.manualProviderModelRules;
    assert.equal(minimal.config.properties.contextWindow, 200000, 'contextWindow 必填（decode 硬约束）');
    assert.equal(minimal.config.optionSpecs.maxOutputTokens.max, 32000, 'maxOutputTokens 必填（decode 硬约束）');
    assert.deepEqual(plain(withoutRule.config.modelConfigRules.providerModelRules), [], 'providerModelRules 必填数组');
  });
  check('userAgent 进 api.headers 且剔除换行', () => {
    const config = zcode.buildZcodeConfig({ ...aiConfig, userAgent: 'crystelf/1.0\r\nX-Evil: 1' }, 'm', {});
    assert.equal(config.config.providerConfigRules.providerRules[0].config.api.headers['User-Agent'], 'crystelf/1.0X-Evil: 1'.replace(/\r/g, '').replace(/\n/g, ''));
  });

  // ---- resolveBundledZcodeCommand ----
  check('产物缺失返回 null，假产物齐备后定位成功', () => {
    assert.equal(zcode.resolveBundledZcodeCommand({}), null);
    stageFakeProduct();
    const resolved = zcode.resolveBundledZcodeCommand({});
    assert.equal(resolved.version, '3.14.3');
    assert.equal(resolved.nodeSupported, true);
    assert.ok(resolved.command.endsWith('zcode.cjs'));
    assert.ok(fs.existsSync(resolved.builtinConfig));
  });

  // ---- buildBundledZcodeEnvironment：沙箱 env 与配置落盘 ----
  check('隔离 env：ZCODE_* 全部指向 scratch，继承的 ZCODE_*/OPENCODE_* 被剔除', () => {
    const bundled = zcode.buildBundledZcodeEnvironment({
      aiConfig, model: 'glm-5.3-flash',
      env: { ...process.env, PATH: process.env.PATH, ZCODE_HACK: '1', OPENCODE_HACK: '1' },
    });
    const { env, dirs } = bundled;
    assert.ok(env.ZCODE_DATA_BASE_DIR.startsWith(PathStub.data));
    assert.ok(env.ZCODE_STORAGE_DIR.startsWith(PathStub.data));
    assert.ok(env.ZCODE_SESSION_DB_PATH.startsWith(PathStub.data));
    assert.ok(env.ZCODE_LOG_DIR.startsWith(PathStub.data));
    assert.equal(env.HOME, dirs.home);
    assert.equal(env.USERPROFILE, dirs.home);
    assert.equal(env.ZCODE_RUNTIME_ENV, 'production');
    assert.equal(env.ZCODE_HACK, undefined);
    assert.equal(env.OPENCODE_HACK, undefined);
    assert.equal(env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, path.join(runtimeRoot, 'runtime', 'provider', 'zcode-builtin.json'));
    const personal = JSON.parse(fs.readFileSync(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, 'utf8'));
    assert.equal(personal.config.providerConfigRules.providerRules[0].config.access.apiKey, 'sk-test-key-123');
  });
  check('rg 二进制存在时注入 ZCODE_RG_BINARY', () => {
    const toolsDir = path.join(runtimeRoot, 'tools');
    fs.mkdirSync(toolsDir, { recursive: true });
    const rgName = process.platform === 'win32' ? 'rg.exe' : 'rg';
    fs.writeFileSync(path.join(toolsDir, rgName), '#!/bin/sh\n', { mode: 0o755 });
    const bundled = zcode.buildBundledZcodeEnvironment({ aiConfig, model: 'm' });
    assert.equal(bundled.env.ZCODE_RG_BINARY, path.join(toolsDir, rgName));
  });
  check('产物不完整时抛 AGENT_ZCODE_RUNTIME_MISSING', () => {
    const missing = path.join(PathStub.data, 'empty-runtime');
    try {
      zcode.buildBundledZcodeEnvironment({ aiConfig, model: 'm', runtimeRoot: missing });
      assert.fail('should throw');
    } catch (error) {
      assert.equal(error.code, 'AGENT_ZCODE_RUNTIME_MISSING');
    }
  });

  // ---- runZcodeTask：假 CLI 全管道 ----
  const workspace = path.join(scratch, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const envForTask = { PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '', FAKE_ARGS_FILE: path.join(scratch, 'fake-args.json') };
  const baseOptions = { aiConfig, model: 'glm-5.3-flash', workspaceDir: workspace, env: envForTask };

  await checkAsync('空 prompt / 非法工作区 / 非法权限档全部快速失败', async () => {
    await assert.rejects(zcode.runZcodeTask({ ...baseOptions, prompt: '  ' }), /prompt/);
    await assert.rejects(zcode.runZcodeTask({ ...baseOptions, prompt: 'x', workspaceDir: 'relative/path' }), /绝对路径/);
    await assert.rejects(zcode.runZcodeTask({ ...baseOptions, prompt: 'x', workspaceDir: path.join(scratch, 'nope') }), /不存在/);
    await assert.rejects(zcode.runZcodeTask({ ...baseOptions, prompt: 'x', permissionMode: 'chaos' }), /权限档/);
    await assert.rejects(zcode.runZcodeTask({ ...baseOptions, prompt: 'x', permissionMode: 'full' }), /完全权限档/);
  });

  const success = await zcode.runZcodeTask({ ...baseOptions, prompt: 'hello' });
  check('成功任务：事件序列、聚合与返回契约', () => {
    assert.equal(success.ok, true, success.error);
    assert.equal(success.sessionId, 'sess-fake-1');
    assert.equal(success.output, 'final answer');
    // fake CLI 发的是 Windows 绝对路径；POSIX 上它不算绝对路径，会被拼到工作区下，
    // 因此按当前平台的绝对路径规则推导预期值，保证检查在 Windows 与 Linux 都成立
    const expectedFile = path.isAbsolute(FAKE_ABS_FILE)
      ? path.resolve(FAKE_ABS_FILE)
      : path.resolve(workspace, FAKE_ABS_FILE);
    assert.ok(success.filesChanged.includes(expectedFile), `filesChanged=${JSON.stringify(success.filesChanged)} expected=${expectedFile}`);
    assert.deepEqual(plain(success.usage), { inputTokens: 11, outputTokens: 7 });
    const types = success.events.map(event => event.type);
    assert.ok(types.includes('text') && types.includes('file_edit') && types.includes('tool_result'), `types=${JSON.stringify(types)}`);
    assert.ok(types.includes('command_exec') && types.includes('permission_request'));
    assert.equal(types.at(-1), 'done');
    const text = success.events.filter(event => event.type === 'text').map(event => event.text).join('');
    assert.equal(text, '你好，世界');
    assert.ok(success.durationMs >= 0);
    // 成功后 .env 阻断文件与含 key 的状态目录都被清理
    assert.equal(fs.existsSync(path.join(workspace, '.env')), false);
    assert.ok(!fs.existsSync(path.join(PathStub.data, 'agent-cli-runtime', 'zcode-state', 'tasks', success.taskId)), '成功任务清理状态目录');
  });
  check('任务参数：plan 档的 --mode 与 disallowedTools', () => {
    const dumped = JSON.parse(fs.readFileSync(envForTask.FAKE_ARGS_FILE, 'utf8'));
    assert.equal(dumped.mode, 'plan');
    assert.ok(dumped.disallowedTools.includes('WebFetch'));
    assert.ok(dumped.disallowedTools.includes('Agent') && dumped.disallowedTools.includes('Task'));
    assert.ok(dumped.disallowedTools.includes('AskUserQuestion'), '无头运行必须禁用交互提问工具');
    assert.equal(dumped.cwd, path.resolve(workspace));
    assert.equal(dumped.resume, null, '无 resumeSessionId 时不得注入 --resume');
  });

  const capRun = await zcode.runZcodeTask({
    ...baseOptions,
    prompt: 'hello',
    keepStateOnSuccess: true,
    zcodeInstructions: '回复使用中文',
    zcodeMcpServers: JSON.stringify({ mcpServers: { srv: { type: 'stdio', command: 'node', args: ['x.js'] } } }),
  });
  check('能力配置：AGENTS.md 写入运行时 HOME、.mcp.json 任务期创建且结束清理、result 回传 contextWindow', () => {
    assert.equal(capRun.ok, true, capRun.error);
    const agentsFile = path.join(PathStub.data, 'agent-cli-runtime', 'zcode-state', 'tasks', capRun.taskId, 'home', '.zcode', 'AGENTS.md');
    assert.equal(fs.readFileSync(agentsFile, 'utf8').includes('回复使用中文'), true, 'AGENTS.md 应写入运行时 HOME');
    assert.equal(fs.existsSync(path.join(workspace, '.mcp.json')), false, '.mcp.json 任务结束应清理');
    assert.equal(capRun.contextWindow, 200000, 'result 应回传默认上下文窗口');
  });
  await checkAsync('能力配置：工作区已有 .mcp.json 时不覆盖也不删除', async () => {
    const preExisting = path.join(workspace, '.mcp.json');
    fs.writeFileSync(preExisting, JSON.stringify({ mcpServers: { keep: { type: 'stdio', command: 'node' } } }), 'utf8');
    const run = await zcode.runZcodeTask({ ...baseOptions, prompt: 'hello', zcodeMcpServers: JSON.stringify({ mcpServers: { intruder: {} } }) });
    assert.equal(run.ok, true, run.error);
    assert.equal(JSON.parse(fs.readFileSync(preExisting, 'utf8')).mcpServers.keep !== undefined, true, '用户已有 .mcp.json 不得被覆盖');
    assert.equal(fs.existsSync(preExisting), true, '非我们创建的 .mcp.json 不得删除');
  });

  const keepRun = await zcode.runZcodeTask({ ...baseOptions, prompt: 'keep', keepStateOnSuccess: true });
  check('keepStateOnSuccess：成功任务保留状态目录供会话续接', () => {
    assert.equal(keepRun.ok, true, keepRun.error);
    assert.ok(fs.existsSync(path.join(PathStub.data, 'agent-cli-runtime', 'zcode-state', 'tasks', keepRun.taskId)), 'keepStateOnSuccess 保留状态目录');
  });

  const resumeRun = await zcode.runZcodeTask({ ...baseOptions, prompt: 'resume turn', resumeSessionId: 'sess-resume-1', taskId: keepRun.taskId, keepStateOnSuccess: true });
  check('续接：--resume 注入且复用父任务状态目录', () => {
    assert.equal(resumeRun.ok, true, resumeRun.error);
    assert.equal(resumeRun.taskId, keepRun.taskId, '续接必须复用父任务状态目录');
    const dumped = JSON.parse(fs.readFileSync(envForTask.FAKE_ARGS_FILE, 'utf8'));
    assert.equal(dumped.resume, 'sess-resume-1', `resume args=${JSON.stringify(dumped)}`);
    assert.ok(fs.existsSync(path.join(PathStub.data, 'agent-cli-runtime', 'zcode-state', 'tasks', keepRun.taskId)), '续接运行保留会话库');
  });

  const buildRun = await zcode.runZcodeTask({ ...baseOptions, prompt: 'hello', permissionMode: 'build', timeoutMs: 30000 });
  check('build 档映射为 --mode edit 且禁 Bash/WebFetch/WebSearch', () => {
    assert.equal(buildRun.ok, true, buildRun.error);
    const dumped = JSON.parse(fs.readFileSync(envForTask.FAKE_ARGS_FILE, 'utf8'));
    assert.equal(dumped.mode, 'edit');
    assert.deepEqual(dumped.disallowedTools, ['AskUserQuestion', 'Bash', 'WebFetch', 'WebSearch']);
  });

  const relativeRun = await zcode.runZcodeTask({ ...baseOptions, prompt: 'RELATIVE' });
  check('相对路径文件变更按工作区解析', () => {
    assert.equal(relativeRun.ok, true, relativeRun.error);
    assert.deepEqual(plain(relativeRun.filesChanged), [path.resolve(workspace, 'note.md')]);
  });

  const failed = await zcode.runZcodeTask({ ...baseOptions, prompt: 'FAIL_TURN' });
  check('turn.failed：ok=false、错误信息透出、状态目录保留排查', () => {
    assert.equal(failed.ok, false);
    assert.match(failed.error, /上游鉴权失败/);
    assert.equal(failed.sessionId, 'sess-fail');
    assert.ok(fs.existsSync(path.join(PathStub.data, 'agent-cli-runtime', 'zcode-state', 'tasks', failed.taskId)), '失败任务保留现场');
    assert.ok(failed.events.some(event => event.type === 'error'));
  });

  const exited = await zcode.runZcodeTask({ ...baseOptions, prompt: 'FAIL_EXIT' });
  check('非零退出码：stderr 尾部并入错误', () => {
    assert.equal(exited.ok, false);
    assert.match(exited.error, /退出码 3/);
    assert.match(exited.error, /provider auth failed/);
  });

  const preExistingEnv = path.join(workspace, '.env');
  fs.writeFileSync(preExistingEnv, 'KEEP=1\n', 'utf8');
  const withEnv = await zcode.runZcodeTask({ ...baseOptions, prompt: 'hello' });
  check('工作区已有 .env 时不覆盖也不删除', () => {
    assert.equal(withEnv.ok, true, withEnv.error);
    assert.equal(fs.readFileSync(preExistingEnv, 'utf8'), 'KEEP=1\n');
  });
  fs.rmSync(preExistingEnv, { force: true });

  // 并发池三连测：默认并发 1 → 可配池放行与拒绝 → abort 中止。每个用例自备任务、结束即清池，互不依赖
  const poolProbeId = zcode.createBundledZcodeTaskId();
  const poolProbe = zcode.runZcodeTask({ ...baseOptions, prompt: 'HANG', taskId: poolProbeId });
  await new Promise(resolve => setTimeout(resolve, 800));
  await checkAsync('并发上限 1：第二个任务直接拒绝', async () => {
    await assert.rejects(zcode.runZcodeTask({ ...baseOptions, prompt: 'x' }), error => error.code === 'AGENT_ZCODE_TASK_BUSY');
  });
  await zcode.abortZcodeTask(poolProbeId);
  await poolProbe.catch(() => { });
  // finishTask 清池在子进程 exit 回调里异步完成，轮询等它落地
  for (let i = 0; i < 10 && zcode.listActiveZcodeTaskIds().length; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.deepEqual(plain(zcode.listActiveZcodeTaskIds()), [], '探针中止后池应为空');

  await checkAsync('并发池可配：maxConcurrent 2 时双任务并存，第三个拒绝', async () => {
    const idA = zcode.createBundledZcodeTaskId();
    const idB = zcode.createBundledZcodeTaskId();
    const runA = zcode.runZcodeTask({ ...baseOptions, prompt: 'HANG', taskId: idA, maxConcurrent: 2 });
    const runB = zcode.runZcodeTask({ ...baseOptions, prompt: 'HANG', taskId: idB, maxConcurrent: 2 });
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(zcode.listActiveZcodeTaskIds().filter(id => id === idA || id === idB).length, 2, '两个任务应同时存活');
    await assert.rejects(
      zcode.runZcodeTask({ ...baseOptions, prompt: 'x', maxConcurrent: 2 }),
      error => error.code === 'AGENT_ZCODE_TASK_BUSY',
    );
    await zcode.abortZcodeTask(idA);
    await runA.catch(() => { });
    await zcode.abortZcodeTask(idB);
    await runB.catch(() => { });
    for (let i = 0; i < 10 && zcode.listActiveZcodeTaskIds().length; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert.deepEqual(plain(zcode.listActiveZcodeTaskIds()), [], '用例收尾后池应为空');
  });

  const abortStart = Date.now();
  const abortTargetId = zcode.createBundledZcodeTaskId();
  const abortTarget = zcode.runZcodeTask({ ...baseOptions, prompt: 'HANG', taskId: abortTargetId });
  await new Promise(resolve => setTimeout(resolve, 800));
  const abortedTask = await (async () => {
    const abortPromise = zcode.abortZcodeTask(abortTargetId);
    return await abortTarget.then(result => ({ result, aborted: abortPromise }));
  })();
  await checkAsync('abortZcodeTask：中止任务并返回 ok=false', async () => {
    assert.equal(await abortedTask.aborted, true);
    assert.equal(abortedTask.result.ok, false);
    assert.match(abortedTask.result.error, /中止/);
    assert.ok(Date.now() - abortStart < 15000, '中止应在数秒内完成');
    assert.equal(await zcode.abortZcodeTask('zcode-not-exists'), false);
  });

  const timeoutStart = Date.now();
  const timedOut = await zcode.runZcodeTask({ ...baseOptions, prompt: 'HANG', timeoutMs: 1500 });
  check('超时强杀进程树', () => {
    assert.equal(timedOut.ok, false);
    assert.match(timedOut.error, /超时/);
    assert.ok(Date.now() - timeoutStart < 15000, '超时强杀应在数秒内完成');
  });

  // ---- cleanupZcodeStateDirs：孤儿/全量清理 ----
  await checkAsync('状态目录清理：orphans 模式保留被引用与未超龄目录，只删超龄孤儿', async () => {
    const stateRoot = path.join(scratch, 'state-cleanup');
    const tasksDir = path.join(stateRoot, 'tasks');
    for (const name of ['zcode-kept', 'zcode-fresh', 'zcode-stale']) fs.mkdirSync(path.join(tasksDir, name), { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'zcode-stale', 'sessions.sqlite'), 'x');
    // zcode-stale 人为设为 8 天前；zcode-fresh 保持当前时间
    const old = new Date(Date.now() - 8 * 86400000);
    fs.utimesSync(path.join(tasksDir, 'zcode-stale'), old, old);
    const cleaned = await zcode.cleanupZcodeStateDirs({
      stateRoot,
      keepTaskIds: ['zcode-kept'],
      maxAgeDays: 7,
    });
    // 返回值来自 vm realm，经 JSON 往返后再比较
    assert.deepEqual(plain(cleaned.removed), ['zcode-stale']);
    assert.equal(plain(cleaned.failed).length, 0);
    assert.ok(fs.existsSync(path.join(tasksDir, 'zcode-kept')), '被任务引用的目录保留');
    assert.ok(fs.existsSync(path.join(tasksDir, 'zcode-fresh')), '未超龄的孤儿保留');
    assert.equal(fs.existsSync(path.join(tasksDir, 'zcode-stale')), false);
    // 非目录条目跳过不报错
    fs.writeFileSync(path.join(tasksDir, 'a-file.txt'), 'x');
    const again = await zcode.cleanupZcodeStateDirs({ stateRoot, keepTaskIds: [], maxAgeDays: 0 });
    assert.deepEqual(plain(again.removed).sort(), ['zcode-fresh', 'zcode-kept']);
    assert.equal(fs.existsSync(path.join(tasksDir, 'a-file.txt')), true, '文件条目不动');
  });
  await checkAsync('状态目录清理：all 模式无视引用与年龄全删，不存在的根返回空', async () => {
    const stateRoot = path.join(scratch, 'state-cleanup-all');
    const tasksDir = path.join(stateRoot, 'tasks');
    fs.mkdirSync(path.join(tasksDir, 'zcode-any'), { recursive: true });
    const cleaned = await zcode.cleanupZcodeStateDirs({ stateRoot, mode: 'all', keepTaskIds: ['zcode-any'] });
    assert.deepEqual(plain(cleaned.removed), ['zcode-any']);
    assert.equal(fs.existsSync(tasksDir), true, 'tasks 目录本身保留');
    const empty = await zcode.cleanupZcodeStateDirs({ stateRoot: path.join(scratch, 'no-such-state') });
    assert.deepEqual(plain(empty), { removed: [], failed: [] });
  });

  console.log(JSON.stringify({ ok: true, results, scratch }, null, 2));
}

// #zcode 聊天锚点生命周期：apps/zcode-agent.js 只依赖 6 个模块，这里用合成依赖加载真实模块，
// 用假控制台验证“锚点被删除/无会话标识/仍在运行/创建时 404”都会安全退回新会话。
async function runChatAnchorChecks() {
  const anchorResults = [];
  const anchorCheck = (label, callback) => { callback(); anchorResults.push(label); };
  const anchorCheckAsync = async (label, callback) => { await callback(); anchorResults.push(label); };
  const replies = [];
  const payloads = [];
  let taskStore = [];
  let precheckProbeError = '';
  let anchorSeed = '';
  let sequence = 0;
  const consoleApi = {
    listTasks: ({ taskId = '' } = {}) => ({ tasks: taskId ? taskStore.filter(task => task.id === taskId) : taskStore.slice() }),
    createTask: async payload => {
      if (payload.sessionId === 'AGENT_NOT_FOUND') {
        const error = new Error('未找到需要继续的任务');
        error.code = 'AGENT_TASK_NOT_FOUND';
        throw error;
      }
      if (payload.sessionId === 'FAIL_ON_RESUME') throw new Error('模拟续接失败');
      const task = { ...payload, id: `task-${++sequence}`, status: 'success', zcodeSessionId: `sess-${sequence}` };
      payloads.push(payload);
      taskStore.push(task);
      queueMicrotask(() => { const item = taskStore.find(entry => entry.id === task.id); if (item) item.status = 'success'; });
      return task;
    },
    cancelTask: async () => ({ canceled: false }),
    probeProvider: async () => ({ available: !precheckProbeError, error: precheckProbeError || undefined }),
  };
  const chatApp = await loadModule('apps/zcode-agent.js', {
    '../lib/config/configControl.js': { default: { get: () => ({ tools: { agentWorkbench: { enabled: true, writeEnabled: true, writableWorkspaces: { plugin: true }, providers: { zcode: true } } } }), set: async () => {} } },
    '../constants/path.js': { default: PathStub },
    '../lib/webConsole/workbenchSingleton.js': { getOrCreateWorkbenchConsole: () => consoleApi },
    '../lib/webConsole/agentWorkbenchConsole.js': { normalizeAgentWorkbenchConfig: config => config },
    '../lib/agent/agentChatBridge.js': {
      formatTaskResult: task => ({ ok: true, text: String(task.prompt || '完成') }),
      pickResultText: task => String(task.prompt || ''),
    },
    '../lib/agent/agentInspection.js': {
      AGENT_TEMPLATES: [],
      findAgentTemplate: () => null,
      initAgentScheduleRunner: () => ({ rebuild: () => {}, runScheduleNow: async () => {} }),
      formatPushReport: () => '',
    },
  }, { plugin: class {} });
  const chatEvent = { isGroup: false, user_id: 10001, msg: '#zcode 回复一句话', reply: async text => { replies.push(String(text)); return true; } };
  const seedAnchor = anchorId => {
    anchorSeed = anchorId;
    // 模块内部 sessionBySender 是私有 Map，无法直接注入；先用一条消息建立锚点，再替换任务记录。
    return chatApp.CrystelfZcodeAgent.prototype.runWithMode.call({}, chatEvent, 'full');
  };

  await seedAnchor('');
  const firstTaskId = taskStore[0]?.id;
  anchorCheck('初始任务建立聊天锚点', () => {
    assert.equal(taskStore.length, 1);
    assert.equal(payloads.length, 1);
    assert.ok(String(payloads[0].title || '').startsWith('[ZCode聊]'));
    replies.length = 0;
  });

  // 任务被控制台删除：预检应清锚点，本轮直接新建会话并提示原因
  taskStore = [];
  await chatApp.CrystelfZcodeAgent.prototype.runWithMode.call({}, chatEvent, 'full');
  anchorCheckAsync('锚点任务被删除：清锚点并按新会话提交', async () => {
    assert.equal(taskStore.length, 1);
    assert.equal(payloads.at(-1).sessionId, undefined, '不得携带旧 sessionId');
    assert.ok(replies.some(text => text.includes('原会话锚点已失效')), `replies=${JSON.stringify(replies)}`);
    replies.length = 0;
  });

  // 任务仍在运行：不能续接到运行中的状态目录
  taskStore[0].status = 'running';
  await chatApp.CrystelfZcodeAgent.prototype.runWithMode.call({}, chatEvent, 'full');
  anchorCheckAsync('锚点任务运行中：丢弃运行中锚点并新建', async () => {
    assert.equal(taskStore.length, 2, `tasks=${JSON.stringify(taskStore)}`);
    assert.equal(payloads.at(-1).sessionId, undefined);
    assert.ok(replies.some(text => text.includes('原会话锚点已失效')));
    replies.length = 0;
  });

  // 任务已完成但没有 zcodeSessionId：旧版本/失败任务不能当上下文锚点
  taskStore[1].status = 'success';
  delete taskStore[1].zcodeSessionId;
  await chatApp.CrystelfZcodeAgent.prototype.runWithMode.call({}, chatEvent, 'full');
  anchorCheckAsync('锚点缺少 ZCode 会话标识：退回新会话', async () => {
    assert.equal(taskStore.length, 3);
    assert.equal(payloads.at(-1).sessionId, undefined);
    assert.ok(replies.some(text => text.includes('原会话锚点已失效')));
    replies.length = 0;
  });

  // 正常终态任务：锚点应作为 sessionId 续接，不提示失效
  const resumableId = taskStore[2].id;
  await chatApp.CrystelfZcodeAgent.prototype.runWithMode.call({}, chatEvent, 'full');
  anchorCheckAsync('正常终态任务：锚点按原会话续接', async () => {
    assert.equal(taskStore.length, 4);
    assert.equal(payloads.at(-1).sessionId, resumableId, `payload=${JSON.stringify(payloads.at(-1))}`);
    assert.ok(!replies.some(text => text.includes('原会话锚点已失效')), `replies=${JSON.stringify(replies)}`);
    replies.length = 0;
  });

  // 预检之后任务被并行删除：任务仍在列表可见（预检通过），仅创建续接时抛 404，清锚点重试一次
  const lastId = taskStore.at(-1).id;
  const originalCreate = consoleApi.createTask;
  let resumeAttempts = 0;
  consoleApi.createTask = async payload => {
    if (payload.sessionId === lastId) {
      resumeAttempts += 1;
      const error = new Error('未找到需要继续的任务');
      error.code = 'AGENT_TASK_NOT_FOUND';
      throw error;
    }
    return originalCreate(payload);
  };
  await chatApp.CrystelfZcodeAgent.prototype.runWithMode.call({}, chatEvent, 'full');
  await anchorCheckAsync('创建时并行删除：404 后清锚点重试一次', async () => {
    assert.equal(resumeAttempts, 1, `续接请求只应尝试一次，actual=${resumeAttempts}`);
    assert.equal(payloads.at(-1).sessionId, undefined, '重试必须是新会话');
    assert.ok(replies.some(text => text.includes('原会话锚点已失效')), `replies=${JSON.stringify(replies)}`);
    replies.length = 0;
  });
  consoleApi.createTask = originalCreate;

  console.log(JSON.stringify({ ok: true, anchorResults }, null, 2));
}

main().then(runChatAnchorChecks).catch(error => {
  console.error('CHECK FAILED:', error);
  process.exit(1);
});
