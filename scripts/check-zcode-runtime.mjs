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
send({ type: 'tool.updated', payload: { kind: 'scheduled', toolName: 'Write', input: { file_path: 'C:\\\\abs\\\\target.md' } } });
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
    });
  } catch (error) {
    console.error('模块加载失败（需 node --experimental-vm-modules）:', error.message);
    process.exit(1);
  }

  // ---- buildZcodeConfig：纯函数行为 ----
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
    assert.ok(success.filesChanged.includes('C:\\abs\\target.md'));
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
    assert.equal(dumped.cwd, path.resolve(workspace));
  });

  const buildRun = await zcode.runZcodeTask({ ...baseOptions, prompt: 'hello', permissionMode: 'build', timeoutMs: 30000 });
  check('build 档映射为 --mode edit 且禁 Bash/WebFetch/WebSearch', () => {
    assert.equal(buildRun.ok, true, buildRun.error);
    const dumped = JSON.parse(fs.readFileSync(envForTask.FAKE_ARGS_FILE, 'utf8'));
    assert.equal(dumped.mode, 'edit');
    assert.deepEqual(dumped.disallowedTools, ['Bash', 'WebFetch', 'WebSearch']);
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

  const hangTaskId = zcode.createBundledZcodeTaskId();
  const hangPromise = zcode.runZcodeTask({ ...baseOptions, prompt: 'HANG', taskId: hangTaskId, timeoutMs: 60000 });
  await new Promise(resolve => setTimeout(resolve, 800));
  await checkAsync('并发上限 1：第二个任务直接拒绝', async () => {
    await assert.rejects(zcode.runZcodeTask({ ...baseOptions, prompt: 'x' }), error => error.code === 'AGENT_ZCODE_TASK_BUSY');
  });
  const abortStart = Date.now();
  const abortedTask = await (async () => {
    const abortPromise = zcode.abortZcodeTask(hangTaskId);
    return await hangPromise.then(result => ({ result, aborted: abortPromise }));
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


  console.log(JSON.stringify({ ok: true, results, scratch }, null, 2));
}

main().catch(error => {
  console.error('CHECK FAILED:', error);
  process.exit(1);
});
