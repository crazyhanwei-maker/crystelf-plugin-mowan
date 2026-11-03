import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePokeContextConfig,
  needsLiveHistory,
  needsSessionHistory,
  mergePokeContextHistory,
  formatPokeContextLine,
  describePokeContextSource,
  normalizePokeTimestamp,
  POKE_CONTEXT_DEFAULTS,
} from './pokeContext.js';

test('resolvePokeContextConfig: 缺省为 live / 6 / 3', () => {
  assert.deepEqual(resolvePokeContextConfig({}), {
    source: POKE_CONTEXT_DEFAULTS.source,
    messageLimit: POKE_CONTEXT_DEFAULTS.messageLimit,
    lineLimit: POKE_CONTEXT_DEFAULTS.lineLimit,
  });
});

test('resolvePokeContextConfig: 未知来源回退 live', () => {
  assert.equal(resolvePokeContextConfig({ contextSource: 'unknown' }).source, 'live');
  assert.equal(resolvePokeContextConfig({ contextSource: '' }).source, 'live');
});

test('resolvePokeContextConfig: 数字被夹紧到合法区间', () => {
  assert.equal(resolvePokeContextConfig({ contextMessageLimit: 999 }).messageLimit, 30);
  assert.equal(resolvePokeContextConfig({ contextMessageLimit: -5 }).messageLimit, 0);
  assert.equal(resolvePokeContextConfig({ contextLines: 99 }).lineLimit, 10);
  assert.equal(resolvePokeContextConfig({ contextLines: -1 }).lineLimit, 0);
  // 0 是合法值，语义是“不读/不注入”，不能被当成缺省
  assert.equal(resolvePokeContextConfig({ contextLines: 0 }).lineLimit, 0);
  assert.equal(resolvePokeContextConfig({ contextMessageLimit: 0 }).messageLimit, 0);
});

test('resolvePokeContextConfig: 非数字回退默认值', () => {
  assert.equal(resolvePokeContextConfig({ contextLines: 'abc' }).lineLimit, 3);
  assert.equal(resolvePokeContextConfig({ contextMessageLimit: null }).messageLimit, 6);
});

test('resolvePokeContextConfig: 读取条数为 0 时注入条数也归零', () => {
  const cfg = resolvePokeContextConfig({ contextMessageLimit: 0, contextLines: 5 });
  assert.equal(cfg.messageLimit, 0);
  assert.equal(cfg.lineLimit, 0);
});

test('needsLiveHistory / needsSessionHistory: 三种来源组合正确', () => {
  assert.deepEqual([needsLiveHistory('live'), needsSessionHistory('live')], [true, false]);
  assert.deepEqual([needsLiveHistory('session'), needsSessionHistory('session')], [false, true]);
  assert.deepEqual([needsLiveHistory('hybrid'), needsSessionHistory('hybrid')], [true, true]);
});

test('mergePokeContextHistory: 过滤机器人自己并保留最近 lineLimit 条', () => {
  const liveHistory = [
    { userId: '1', nickname: 'A', text: 'a1', time: 1 },
    { userId: '999', nickname: 'Bot', text: 'bot', time: 2 },
    { userId: '2', nickname: 'B', text: 'b1', time: 3 },
  ];
  const merged = mergePokeContextHistory({ liveHistory, selfId: '999', lineLimit: 2 });
  assert.deepEqual(merged.map(item => item.text), ['a1', 'b1']);
});

test('mergePokeContextHistory: lineLimit=0 时不返回任何上下文', () => {
  const liveHistory = [{ userId: '1', text: 'a', time: 1 }];
  assert.deepEqual(mergePokeContextHistory({ liveHistory, lineLimit: 0 }), []);
});

test('mergePokeContextHistory: 合并会话与实时消息并按时间排序', () => {
  const sessionHistory = [{ userId: '1', text: '早期', time: 10 }];
  const liveHistory = [{ userId: '2', text: '刚刚', time: 20 }];
  const merged = mergePokeContextHistory({ sessionHistory, liveHistory, lineLimit: 5 });
  assert.deepEqual(merged.map(item => item.text), ['早期', '刚刚']);
});

test('mergePokeContextHistory: 同一人同一句话在两路里只保留一条', () => {
  const sessionHistory = [{ userId: '1', text: '重复的话', time: 10 }];
  const liveHistory = [{ userId: '1', text: '重复的话', time: 10 }];
  const merged = mergePokeContextHistory({ sessionHistory, liveHistory, lineLimit: 5 });
  assert.equal(merged.length, 1);
});

test('mergePokeContextHistory: 纯图片消息不去重', () => {
  const liveHistory = [
    { userId: '1', text: '', imageUrls: ['u1'], time: 1 },
    { userId: '1', text: '', imageUrls: ['u2'], time: 2 },
  ];
  const merged = mergePokeContextHistory({ liveHistory, lineLimit: 5 });
  assert.equal(merged.length, 2);
});

test('mergePokeContextHistory: 缺少 userId 的记录被丢弃', () => {
  const liveHistory = [{ text: 'no user', time: 1 }, { userId: '1', text: 'ok', time: 2 }];
  const merged = mergePokeContextHistory({ liveHistory, lineLimit: 5 });
  assert.deepEqual(merged.map(item => item.text), ['ok']);
});

test('formatPokeContextLine: 文本 / 图片 / 空消息三种形态', () => {
  assert.equal(formatPokeContextLine({ userId: '1', nickname: '小明', text: '在吗' }), '小明：在吗');
  assert.equal(formatPokeContextLine({ userId: '1', nickname: '小明', text: '', imageUrls: ['u'] }), '小明：[发了一张图片]');
  assert.equal(formatPokeContextLine({ userId: '1', nickname: '小明', text: '' }), '小明：[无文本内容]');
  assert.equal(formatPokeContextLine({ userId: '1', text: 'hi' }), 'QQ1：hi');
});

test('describePokeContextSource: 来源可读文案', () => {
  assert.equal(describePokeContextSource('live'), '实时群消息');
  assert.equal(describePokeContextSource('session'), '会话记录');
  assert.equal(describePokeContextSource('hybrid'), '会话与实时消息');
  assert.equal(describePokeContextSource('other'), '实时群消息');
});

test('normalizePokeTimestamp: 秒级与毫秒级统一到毫秒', () => {
  assert.equal(normalizePokeTimestamp(1700000000), 1700000000000);
  assert.equal(normalizePokeTimestamp(1700000000000), 1700000000000);
  assert.equal(normalizePokeTimestamp(0), 0);
  assert.equal(normalizePokeTimestamp(null), 0);
  assert.equal(normalizePokeTimestamp('abc'), 0);
});

test('mergePokeContextHistory: 秒级实时消息与毫秒级会话消息按真实时间排序', () => {
  // 会话消息更早，实时消息更晚；若不做单位归一，秒级值会被当成极小值排到最前
  const sessionHistory = [{ userId: '1', text: '会话里的旧消息', time: 1700000000000 }];
  const liveHistory = [{ userId: '2', text: '刚发的实时消息', time: 1700000100 }];
  const merged = mergePokeContextHistory({ sessionHistory, liveHistory, lineLimit: 5 });
  assert.deepEqual(merged.map(item => item.text), ['会话里的旧消息', '刚发的实时消息']);
});

test('mergePokeContextHistory: 单位归一后取最近 N 条不会漏掉实时消息', () => {
  const sessionHistory = [
    { userId: '1', text: 's1', time: 1700000000000 },
    { userId: '1', text: 's2', time: 1700000001000 },
  ];
  const liveHistory = [{ userId: '2', text: 'live1', time: 1700000100 }];
  const merged = mergePokeContextHistory({ sessionHistory, liveHistory, lineLimit: 2 });
  assert.deepEqual(merged.map(item => item.text), ['s2', 'live1']);
});
