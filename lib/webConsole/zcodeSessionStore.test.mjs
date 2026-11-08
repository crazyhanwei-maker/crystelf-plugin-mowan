import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readZcodeSessionState, readZcodeLastTurnUsage } from './zcodeSessionStore.js';

function openDbWithSchema(dbPath) {
  const db = new DatabaseSync(dbPath);
  // 真实 schema：上游 0005 迁移已把 session_target_next 重命名为 session_target，
  // 目标用量列就挂在 session_target 上，不能再按表名判断新旧。
  db.exec(`
    create table session_target (
      session_id text primary key,
      target_id text not null,
      objective text not null,
      status text not null,
      token_budget integer,
      tokens_used integer not null default 0,
      time_used_seconds integer not null default 0,
      time_created integer not null,
      time_updated integer not null
    );
    create table session_entry (
      id text primary key,
      session_id text not null,
      type text not null,
      time_created integer not null,
      time_updated integer not null,
      data text not null
    );
    create table turn_usage (
      session_id text not null,
      turn_id text not null,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      reasoning_tokens integer not null default 0,
      cache_creation_input_tokens integer not null default 0,
      cache_read_input_tokens integer not null default 0,
      computed_total_tokens integer not null default 0,
      tool_call_count integer not null default 0,
      primary key (session_id, turn_id)
    );
  `);
  return db;
}

test('readZcodeSessionState: 读取目标、检查点与累计用量', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-zcode-store-'));
  const dbPath = path.join(dir, 'zcode-sessions.sqlite');
  try {
    const db = openDbWithSchema(dbPath);
    db.prepare('insert into session_target (session_id, target_id, objective, status, token_budget, tokens_used, time_used_seconds, time_created, time_updated) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('sess-1', 'target-1', '修复登录', 'active', 50000, 1234, 90, 1700000000000, 1700000100000);
    const insertEntry = db.prepare('insert into session_entry (id, session_id, type, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)');
    insertEntry.run('cp-1', 'sess-1', 'runtime/workspace_checkpoint', 1700000001000, 1700000001000, JSON.stringify({
      payload: { checkpointId: 'checkpoint_cp1', scope: 'workspace', fileCount: 2, messageId: 'msg-1', targetMessageId: 'msg-1' },
    }));
    insertEntry.run('cp-2', 'sess-1', 'runtime/workspace_checkpoint', 1700000002000, 1700000002000, JSON.stringify({
      payload: { checkpointId: 'checkpoint_cp2', scope: 'workspace', fileCount: 1, messageId: 'msg-2', targetMessageId: 'msg-2' },
    }));
    const insertUsage = db.prepare('insert into turn_usage (session_id, turn_id, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens, tool_call_count) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertUsage.run('sess-1', 'turn-1', 100, 20, 5, 10, 30, 160, 2);
    insertUsage.run('sess-1', 'turn-2', 200, 40, 10, 0, 50, 300, 1);
    db.close();

    const state = await readZcodeSessionState({ dbPath, sessionId: 'sess-1' });
    assert.equal(state.goal.objective, '修复登录');
    assert.equal(state.goal.status, 'active');
    assert.equal(state.goal.tokensUsed, 1234);
    assert.equal(state.goal.tokenBudget, 50000);
    assert.deepEqual(state.checkpoints.map(item => item.id), ['checkpoint_cp2', 'checkpoint_cp1']);
    assert.equal(state.checkpoints[0].fileCount, 1);
    assert.deepEqual(state.usage, {
      turns: 2, input: 300, output: 60, reasoning: 15, cacheRead: 80, cacheWrite: 10, total: 460, toolCalls: 3,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readZcodeSessionState: 旧库回退 session_target，无目标/用量返回 null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-zcode-store-'));
  const dbPath = path.join(dir, 'old.sqlite');
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      create table session_target (
        session_id text primary key,
        target_id text not null,
        objective text not null,
        status text not null,
        time_created integer not null,
        time_updated integer not null
      );
      create table session_entry (id text primary key, session_id text not null, type text not null, time_created integer not null, time_updated integer not null, data text not null);
      create table turn_usage (session_id text not null, turn_id text not null, input_tokens integer not null default 0, output_tokens integer not null default 0, reasoning_tokens integer not null default 0, cache_creation_input_tokens integer not null default 0, cache_read_input_tokens integer not null default 0, computed_total_tokens integer not null default 0, tool_call_count integer not null default 0, primary key (session_id, turn_id));
    `);
    db.prepare('insert into session_target (session_id, target_id, objective, status, time_created, time_updated) values (?, ?, ?, ?, ?, ?)')
      .run('sess-old', 'target-old', '旧目标', 'paused', 1700000000000, 1700000001000);
    db.close();
    const state = await readZcodeSessionState({ dbPath, sessionId: 'sess-old' });
    assert.equal(state.goal.objective, '旧目标');
    assert.equal(state.goal.status, 'paused');
    assert.equal(state.goal.tokenBudget, null);
    assert.deepEqual(state.checkpoints, []);
    assert.equal(state.usage, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readZcodeSessionState: 迁移中的 session_target_next 优先于旧 session_target', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-zcode-store-'));
  const dbPath = path.join(dir, 'migrating.sqlite');
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      create table session_target (
        session_id text primary key,
        target_id text not null,
        objective text not null,
        status text not null,
        time_created integer not null,
        time_updated integer not null
      );
      create table session_target_next (
        session_id text primary key,
        target_id text not null,
        objective text not null,
        status text not null,
        token_budget integer,
        tokens_used integer not null default 0,
        time_used_seconds integer not null default 0,
        time_created integer not null,
        time_updated integer not null
      );
      create table session_entry (id text primary key, session_id text not null, type text not null, time_created integer not null, time_updated integer not null, data text not null);
      create table turn_usage (session_id text not null, turn_id text not null, input_tokens integer not null default 0, output_tokens integer not null default 0, reasoning_tokens integer not null default 0, cache_creation_input_tokens integer not null default 0, cache_read_input_tokens integer not null default 0, computed_total_tokens integer not null default 0, tool_call_count integer not null default 0, primary key (session_id, turn_id));
    `);
    db.prepare('insert into session_target (session_id, target_id, objective, status, time_created, time_updated) values (?, ?, ?, ?, ?, ?)')
      .run('sess-mid', 'target-old', '旧表目标', 'paused', 1700000000000, 1700000001000);
    db.prepare('insert into session_target_next (session_id, target_id, objective, status, token_budget, tokens_used, time_used_seconds, time_created, time_updated) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('sess-mid', 'target-new', '迁移后目标', 'active', 1000, 321, 12, 1700000002000, 1700000003000);
    db.close();

    const state = await readZcodeSessionState({ dbPath, sessionId: 'sess-mid' });
    assert.equal(state.goal.objective, '迁移后目标');
    assert.equal(state.goal.tokensUsed, 321);
    assert.equal(state.goal.tokenBudget, 1000);
    assert.equal(state.goal.timeUsedSeconds, 12);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readZcodeSessionState: 目标表读取失败时返回 goal undefined，避免误清空', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-zcode-store-'));
  const dbPath = path.join(dir, 'broken.sqlite');
  try {
    const db = new DatabaseSync(dbPath);
    // 缺少 time_created/time_updated：列探测能看到 objective，但真实 select 会失败
    db.exec(`
      create table session_target (
        session_id text primary key,
        objective text not null,
        status text not null
      );
      create table session_entry (id text primary key, session_id text not null, type text not null, time_created integer not null, time_updated integer not null, data text not null);
      create table turn_usage (session_id text not null, turn_id text not null, input_tokens integer not null default 0, output_tokens integer not null default 0, reasoning_tokens integer not null default 0, cache_creation_input_tokens integer not null default 0, cache_read_input_tokens integer not null default 0, computed_total_tokens integer not null default 0, tool_call_count integer not null default 0, primary key (session_id, turn_id));
    `);
    db.prepare('insert into session_target (session_id, objective, status) values (?, ?, ?)')
      .run('sess-broken', '不应被清空的目标', 'active');
    db.close();

    const state = await readZcodeSessionState({ dbPath, sessionId: 'sess-broken' });
    assert.equal(state.goal, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readZcodeLastTurnUsage: 返回最新一轮并把 reasoning 并入 completion', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-zcode-store-'));
  const dbPath = path.join(dir, 'last-turn.sqlite');
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      create table turn_usage (
        session_id text not null,
        turn_id text not null,
        input_tokens integer not null default 0,
        output_tokens integer not null default 0,
        reasoning_tokens integer not null default 0,
        cache_creation_input_tokens integer not null default 0,
        cache_read_input_tokens integer not null default 0,
        computed_total_tokens integer not null default 0,
        started_at integer not null default 0,
        primary key (session_id, turn_id)
      );
    `);
    const insert = db.prepare('insert into turn_usage (session_id, turn_id, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens, started_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run('sess-last', 'turn-old', 100, 10, 5, 1, 2, 115, 1000);
    insert.run('sess-last', 'turn-new', 200, 20, 7, 3, 4, 230, 2000);
    db.close();

    const latest = await readZcodeLastTurnUsage({ dbPath, sessionId: 'sess-last' });
    assert.deepEqual(latest, {
      input: 200,
      output: 27,
      reasoning: 7,
      total: 230,
      cacheRead: 4,
      cacheWrite: 3,
      startedAt: 2000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readZcodeSessionState: 数据库不存在返回 null', async () => {
  assert.equal(await readZcodeSessionState({ dbPath: path.join(os.tmpdir(), 'missing-zcode.sqlite'), sessionId: 'sess-x' }), null);
});
