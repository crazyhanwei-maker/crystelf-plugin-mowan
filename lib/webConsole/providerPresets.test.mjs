import { test } from 'node:test';
import assert from 'node:assert/strict';
import './public/agent-provider-presets.js';

const groups = globalThis.AGENT_PROVIDER_PRESETS?.groups || [];
const presets = groups.flatMap(group => group.items || []);

test('供应商预设按智谱 / 其他分组，并包含自定义入口', () => {
  assert.deepEqual(groups.map(group => group.label), ['智谱', '其他']);
  const custom = presets.find(item => item.id === '__custom__');
  assert.equal(custom?.custom, true);
  assert.equal(custom?.name, '创建自定义供应商');
});

test('预设字段可直接写入供应商草稿，模型数量符合后端上限', () => {
  const allowed = new Set(['openai', 'openai-responses', 'anthropic']);
  for (const preset of presets.filter(item => !item.custom)) {
    assert.ok(preset.id, '缺少 id');
    assert.ok(preset.name && preset.name.length <= 40, `${preset.id} 名称不合法`);
    assert.ok(/^https:\/\//.test(preset.baseApi), `${preset.id} Base URL 不合法`);
    assert.ok(allowed.has(preset.protocol), `${preset.id} 协议不合法：${preset.protocol}`);
    assert.ok(Array.isArray(preset.models) && preset.models.length > 0, `${preset.id} 缺少模型`);
    assert.ok(preset.models.length <= 30, `${preset.id} 模型超过 30 个`);
  }
});

test('预设 id / 名称不重复，且覆盖 ZCode 的主要供应商', () => {
  const ids = presets.map(item => item.id);
  const names = presets.filter(item => !item.custom).map(item => item.name);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length);
  for (const id of ['bigmodel-api', 'zai-api', 'moonshot-kimi', 'minimax', 'deepseek', 'openai', 'anthropic', 'openrouter']) {
    assert.ok(ids.includes(id), `缺少预设 ${id}`);
  }
});
