// 真实冒烟（可选工具）：对已构建的运行时产物跑一次 plan 任务，验证配置解码、模型选择、
// 请求链路与超时强杀。需要真实 endpoint/key 才能跑通请求；用无效 key/地址时预期以
// 连接错误或超时收口（同样验证全管道）。不触碰仓库运行配置。
//
// 用法：
//   node --experimental-vm-modules scripts/check-zcode-live.mjs \
//     --product <运行时目录> --base <API 地址> --key <API key> \
//     [--model <模型名>] [--protocol openai|anthropic] [--timeout <ms>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const optionValue = name => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : undefined;
};
const product = optionValue('--product');
const baseApi = optionValue('--base');
const apiKey = optionValue('--key');
const model = optionValue('--model') || 'glm-5.3-flash';
const apiProtocol = optionValue('--protocol') || 'openai';
const timeoutMs = Math.max(5000, Number(optionValue('--timeout')) || 120000);
if (!product || !baseApi || !apiKey) {
  console.error('用法: node --experimental-vm-modules scripts/check-zcode-live.mjs --product <dir> --base <url> --key <key> [--model m] [--protocol p] [--timeout ms]');
  process.exit(1);
}
if (!fs.existsSync(path.join(product, 'runtime', 'zcode.cjs'))) {
  console.error(`运行时产物不存在：${product}`);
  process.exit(1);
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-live-smoke-'));
const dataDir = path.join(staging, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.cpSync(product, path.join(dataDir, 'agent-cli-runtime', 'zcode'), { recursive: true });
const workspace = path.join(staging, 'workspace');
fs.mkdirSync(workspace, { recursive: true });

const context = vm.createContext({ console, process, Buffer, setTimeout, clearTimeout });
const filename = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'lib', 'webConsole', 'bundledZcodeRuntime.js');
const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), {
  context, identifier: filename,
  initializeImportMeta: meta => { meta.url = pathToFileURL(filename).href; },
});
await module.link(specifier => {
  const map = {
    crypto: { default: crypto },
    fs: { default: fs },
    path: { default: path },
    child_process: { spawn },
    '../../constants/path.js': { default: { root: staging, data: dataDir } },
    '../../modules/openai/protocolAdapter.js': { normalizeAiProtocol: value => (String(value ?? '').trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai') },
  };
  const exports = map[specifier];
  if (!exports) throw new Error(`unexpected dependency: ${specifier}`);
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
});
await module.evaluate();
const zcode = module.namespace;

const events = [];
const result = await zcode.runZcodeTask({
  prompt: '请只回复两个字：正常',
  workspaceDir: workspace,
  permissionMode: 'plan',
  timeoutMs,
  aiConfig: { baseApi, apiKey, apiProtocol, model },
  model,
  onEvent: async event => {
    events.push(event);
    if (event.type === 'text') process.stdout.write(event.text);
  },
});
console.log('\n--- 冒烟结果 ---');
console.log(JSON.stringify({
  ok: result.ok,
  sessionId: result.sessionId,
  output: result.output?.slice(0, 200),
  filesChanged: result.filesChanged,
  error: result.error && String(result.error).slice(0, 300),
  durationMs: result.durationMs,
  eventTypes: [...new Set(events.map(event => event.type))],
  stateDirKept: !result.ok && fs.existsSync(path.join(dataDir, 'agent-cli-runtime', 'zcode-state', 'tasks', result.taskId)),
}, null, 2));
