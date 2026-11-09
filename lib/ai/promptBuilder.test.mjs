import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './promptBuilder.js';
import { shouldForceSearch, buildChatCompletionMessages, evaluateSearchCall, MAX_SEARCH_CALLS_PER_TURN } from './chatEngine.js';
import { EmojiAgent } from '../humanize/emojiAgent.js';

const baseContext = {
  config: {},
  botNickname: 'TestBot',
  targetMessage: {
    content: '你好',
    timestamp: Date.now(),
    userName: 'tester',
    userId: '10001',
    userRole: 'member',
  },
  chatHistory: [],
};

test('搜索可用时注入时效规则，且不写死知识截止日期', () => {
  const prompt = buildSystemPrompt({ ...baseContext, searchToolsEnabled: true });
  assert.match(prompt, /### Built-in Tools/);
  assert.match(prompt, /### Time-Sensitive Information/);
  assert.match(prompt, /call search_web before answering/);
  assert.doesNotMatch(prompt, /2024[-年/]?0?5/);
});

test('搜索禁用时不再宣传 search_web，并明确告知模型不要调用', () => {
  const prompt = buildSystemPrompt({ ...baseContext, searchToolsEnabled: false });
  assert.doesNotMatch(prompt, /### Time-Sensitive Information/);
  assert.doesNotMatch(prompt, /You can call the built-in tool search_web/);
  assert.match(prompt, /Web search and page reading are disabled for this session/);
});

test('forceSearch 只在搜索可用时注入 Mandatory Search', () => {
  const on = buildSystemPrompt({ ...baseContext, searchToolsEnabled: true, forceSearch: true });
  const off = buildSystemPrompt({ ...baseContext, searchToolsEnabled: false, forceSearch: true });
  assert.match(on, /### Mandatory Search/);
  assert.doesNotMatch(off, /### Mandatory Search/);
});

test('语音未启用时不宣传 speak_text', () => {
  const prompt = buildSystemPrompt({ ...baseContext, searchToolsEnabled: true, allowAiVoice: false });
  assert.doesNotMatch(prompt, /You can call the built-in tool speak_text/);
});

test('shouldForceSearch 覆盖日期/截止/日程类提问，稳定知识不触发', () => {
  assert.equal(shouldForceSearch({ content: '这个活动截止到什么时候' }), true);
  assert.equal(shouldForceSearch({ content: '下周赛程出来了吗' }), true);
  assert.equal(shouldForceSearch({ content: '解释一下 JavaScript 闭包' }), false);
  assert.equal(shouldForceSearch({ content: '当前灵晶插件版本是多少' }), false);
});

function createEmojiAgent(characters = ['芙宁娜', '罗小黑'], emotions = { 芙宁娜: ['happy'], 罗小黑: ['sad'] }) {
  return {
    getAvailableCharacters: () => characters,
    getAvailableEmotions: character => emotions[character] || [],
  };
}

test('设置角色有效时只注入锁定角色与该角色情绪', () => {
  const prompt = buildSystemPrompt({
    ...baseContext,
    config: { memeConfig: { character: '芙宁娜' } },
    emojiAgent: createEmojiAgent(),
  });
  assert.match(prompt, /Character \(locked by settings\): 芙宁娜/);
  assert.doesNotMatch(prompt, /Available characters:/);
  assert.match(prompt, /Available emotions: happy/);
  assert.doesNotMatch(prompt, /Available emotions:.*sad/);
});

test('未设置角色时保留全量角色列表供模型自选', () => {
  const prompt = buildSystemPrompt({
    ...baseContext,
    config: {},
    emojiAgent: createEmojiAgent(),
  });
  assert.match(prompt, /Preferred character:/);
  assert.match(prompt, /Available characters: 芙宁娜, 罗小黑/);
  assert.match(prompt, /Available emotions: happy, sad/);
});

test('设置角色不存在时回退到全量列表，不产生无效锁定', () => {
  const prompt = buildSystemPrompt({
    ...baseContext,
    config: { memeConfig: { character: '已删除角色' } },
    emojiAgent: createEmojiAgent(),
  });
  assert.doesNotMatch(prompt, /locked by settings/);
  assert.match(prompt, /Available characters: 芙宁娜, 罗小黑/);
});

test('EmojiAgent：设置角色不存在时回退到第一个可用角色', () => {
  const agent = new EmojiAgent(null, { memeConfig: { character: '已删除角色' }, nickName: '芙宁娜' }, null);
  agent.cachedCharacters = ['罗小黑', '芙宁娜'];
  assert.equal(agent.getPreferredCharacter(), '罗小黑');
  // 模型显式请求的合法角色可以覆盖无效设置
  assert.equal(agent.getPreferredCharacter('芙宁娜'), '芙宁娜');
});

test('目标消息正文只在 user message 出现，系统段只保留元信息', () => {
  const target = { ...baseContext.targetMessage, content: '这是一段需要回答的用户消息', messageId: 'm1' };
  const prompt = buildSystemPrompt({ ...baseContext, targetMessage: target });
  assert.doesNotMatch(prompt, /这是一段需要回答的用户消息/);
  assert.match(prompt, /## >>> Target Message/);
  assert.match(prompt, /tester/);

  const initial = buildChatCompletionMessages({ prompt, targetMessage: target, phase: 'initial' });
  assert.equal(initial.find(m => m.role === 'user').content, target.content);
  assert.doesNotMatch(initial.find(m => m.role === 'system').content, /这是一段需要回答的用户消息/);

  const fallback = buildChatCompletionMessages({ prompt, targetMessage: target, phase: 'fallback' });
  const fallbackUser = fallback.find(m => m.role === 'user').content;
  assert.match(fallbackUser, /这是一段需要回答的用户消息/);
  assert.match(fallbackUser, /不要再次调用工具/);
});

test('Active Skills 通用策略只注入一次，且不再包含 30 类目长句', () => {
  const skillContext = [
    '## Active Skills',
    '- weather: 查询天气',
    '  weather.get_weather: 查询某地天气',
  ].join('\n');
  const prompt = buildSystemPrompt({ ...baseContext, skillContext });
  assert.equal((prompt.match(/prefer that skill before search_web/g) || []).length, 1);
  assert.doesNotMatch(prompt, /Prefer structured skills for weather, tracking/);
  assert.match(prompt, /### Active Skill Guidance/);
  assert.match(prompt, /weather\.get_weather/);
});

test('search_web 每轮最多两次，且 query 不能重复', () => {
  assert.equal(MAX_SEARCH_CALLS_PER_TURN, 2);
  const usedQueries = new Set();
  const first = evaluateSearchCall({ query: 'A', usedQueries, attempts: 0 });
  assert.equal(first.allowed, true);
  usedQueries.add(first.normalized);

  const same = evaluateSearchCall({ query: '  a  ', usedQueries, attempts: 1 });
  assert.equal(same.allowed, false);
  assert.match(same.reason, /相同关键词/);

  const second = evaluateSearchCall({ query: 'B', usedQueries, attempts: 1 });
  assert.equal(second.allowed, true);
  usedQueries.add(second.normalized);

  const third = evaluateSearchCall({ query: 'C', usedQueries, attempts: 2 });
  assert.equal(third.allowed, false);
  assert.match(third.reason, /已达上限/);
});

test('提示词告知 search_web 每轮最多两次', () => {
  const prompt = buildSystemPrompt({ ...baseContext, searchToolsEnabled: true });
  assert.match(prompt, /up to twice per turn/);
  assert.match(prompt, /retry once with a different query/);
});


