import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenCodeConfig } from './bundledOpenCodeRuntime.js';
import { buildZcodeConfig } from './bundledZcodeRuntime.js';
import { buildAgentVariantIntelligence } from './agentWorkbenchConsole.js';
import { resolveModelProviderId, isOpenCodeZenProvider } from './modelProviderIdentity.js';

const aiConfig = {
  baseApi: 'https://main.example.com/v1',
  apiKey: 'main-key',
  apiProtocol: 'openai',
  modelType: 'main-model',
};

const zenProvider = {
  name: 'OpenCode Zen (Chat)',
  baseApi: 'https://opencode.ai/zen/v1',
  apiKey: 'zen-key',
  apiProtocol: 'openai',
  models: ['gpt-5.4'],
};

const goProvider = {
  name: 'OpenCode Go (Chat)',
  baseApi: 'https://opencode.ai/zen/go/v1',
  apiKey: 'go-key',
  apiProtocol: 'openai',
  models: ['glm-5.3'],
};

const normalProvider = {
  name: '普通渠道',
  baseApi: 'https://normal.example.com/v1',
  apiKey: 'normal-key',
  apiProtocol: 'openai',
  models: ['normal-model'],
};

test('OpenCode Zen/Go 使用 opencode 前缀，普通渠道保持 custom 前缀', () => {
  assert.equal(isOpenCodeZenProvider(zenProvider), true);
  assert.equal(isOpenCodeZenProvider(goProvider), true);
  assert.equal(isOpenCodeZenProvider(normalProvider), false);

  const zenId = resolveModelProviderId(zenProvider);
  const goId = resolveModelProviderId(goProvider);
  const normalId = resolveModelProviderId(normalProvider);
  assert.ok(zenId.startsWith('opencode-custom-'), zenId);
  assert.ok(goId.startsWith('opencode-custom-'), goId);
  assert.ok(normalId.startsWith('custom-'), normalId);
  assert.notEqual(zenId, normalId);
});

test('OpenCode 配置把 Zen 渠道声明为 opencode 前缀，运行时才会注入 x-opencode-session', () => {
  const zenId = resolveModelProviderId(zenProvider);
  const config = buildOpenCodeConfig(aiConfig, 'gpt-5.4', {
    requestedProviderId: zenId,
    modelProviders: [zenProvider, normalProvider],
  });
  assert.ok(Object.keys(config.provider).includes(zenId), '缺少 Zen provider 声明');
  assert.equal(config.model, `${zenId}/gpt-5.4`);
  assert.equal(config.small_model, `${zenId}/gpt-5.4`);
  // OpenCode 运行时按 providerID.startsWith('opencode') 注入会话头
  assert.ok(zenId.startsWith('opencode'));
});

test('ZCode 配置与前端使用同一个供应商 ID，切换 Zen 渠道不会回落到主供应商', () => {
  const zenId = resolveModelProviderId(zenProvider);
  const config = buildZcodeConfig(aiConfig, 'gpt-5.4', {
    requestedProviderId: zenId,
    modelProviders: [zenProvider],
  });
  const rules = config.config.providerConfigRules.providerRules;
  assert.ok(rules.some(rule => rule.providerId === zenId), '缺少 Zen provider 规则');
  assert.equal(config.config.defaultModelSelection.providerId, zenId);
  assert.equal(config.config.defaultModelSelection.modelId, 'gpt-5.4');
});

test('opencode-custom 渠道按自身协议映射思考档位，不跟随主接口', () => {
  const zenId = resolveModelProviderId(zenProvider);
  const intel = buildAgentVariantIntelligence({
    model: 'claude-sonnet-5',
    providerId: zenId,
    providerProtocol: 'anthropic',
    mainProtocol: 'openai',
  });
  assert.equal(intel.protocol, 'anthropic');
  assert.match(intel.variants.find(item => item.value === 'high')?.semantics || '', /thinking 预算/);
});

test('普通渠道仍按 custom 前缀生成，不改变既有行为', () => {
  const normalId = resolveModelProviderId(normalProvider);
  const config = buildOpenCodeConfig(aiConfig, 'normal-model', {
    requestedProviderId: normalId,
    modelProviders: [normalProvider],
  });
  assert.ok(Object.keys(config.provider).includes(normalId));
  assert.equal(config.model, `${normalId}/normal-model`);
  assert.ok(!normalId.startsWith('opencode'));
});
