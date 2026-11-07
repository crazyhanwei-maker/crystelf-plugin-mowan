import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { syncZcodeSessionModelSelection } from './zcodeSessionSelection.js';

function createStore(dbPath, sessionId, data) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    create table if not exists session_entry (
      id text primary key,
      session_id text not null,
      type text not null,
      time_created integer not null,
      time_updated integer not null,
      data text not null
    )
  `);
  db.prepare('insert or replace into session_entry (id, session_id, type, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)')
    .run(`${sessionId}:runtime-model-selection`, sessionId, 'runtime/model_selection', Date.now(), Date.now(), JSON.stringify(data));
  db.close();
}

function readSelection(dbPath, sessionId) {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare('select data from session_entry where id = ?').get(`${sessionId}:runtime-model-selection`);
    return row ? JSON.parse(row.data).modelSelection : null;
  } finally {
    db.close();
  }
}

test('syncZcodeSessionModelSelection: 把新模型/思考档位写回会话库', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-zcode-selection-'));
  const dbPath = path.join(dir, 'zcode-sessions.sqlite');
  try {
    createStore(dbPath, 'sess_1', {
      modelSelection: { providerId: 'crystelf-chat', modelId: 'model-a', options: { reasoningLevel: 'low' } },
    });
    const changed = await syncZcodeSessionModelSelection({
      dbPath,
      sessionId: 'sess_1',
      selection: { providerId: 'crystelf-chat', modelId: 'model-a', options: { reasoningLevel: 'high' } },
    });
    assert.equal(changed, true);
    assert.deepEqual(readSelection(dbPath, 'sess_1'), {
      providerId: 'crystelf-chat', modelId: 'model-a', options: { reasoningLevel: 'high' },
    });

    const unchanged = await syncZcodeSessionModelSelection({
      dbPath,
      sessionId: 'sess_1',
      selection: { providerId: 'crystelf-chat', modelId: 'model-a', options: { reasoningLevel: 'high' } },
    });
    assert.equal(unchanged, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('syncZcodeSessionModelSelection: 模型切换时同时更新 provider 与 modelId', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-zcode-selection-'));
  const dbPath = path.join(dir, 'zcode-sessions.sqlite');
  try {
    createStore(dbPath, 'sess_2', {
      modelSelection: { providerId: 'crystelf-chat', modelId: 'model-a', options: { reasoningLevel: 'enabled' } },
    });
    await syncZcodeSessionModelSelection({
      dbPath,
      sessionId: 'sess_2',
      selection: { providerId: 'custom-hello-4bj995', modelId: 'glm-5.3-flash', options: { reasoningLevel: 'medium' } },
    });
    assert.deepEqual(readSelection(dbPath, 'sess_2'), {
      providerId: 'custom-hello-4bj995', modelId: 'glm-5.3-flash', options: { reasoningLevel: 'medium' },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('syncZcodeSessionModelSelection: 无数据库/无条目/缺参数时安全返回 false', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-zcode-selection-'));
  const dbPath = path.join(dir, 'empty.sqlite');
  try {
    assert.equal(await syncZcodeSessionModelSelection({ dbPath, sessionId: 'sess_x', selection: { providerId: 'p', modelId: 'm' } }), false);
    const db = new DatabaseSync(dbPath);
    db.exec('create table session_entry (id text primary key, session_id text not null, type text not null, time_created integer not null, time_updated integer not null, data text not null)');
    db.close();
    assert.equal(await syncZcodeSessionModelSelection({ dbPath, sessionId: 'sess_x', selection: { providerId: 'p', modelId: 'm' } }), false);
    assert.equal(await syncZcodeSessionModelSelection({ dbPath, sessionId: '', selection: { providerId: 'p', modelId: 'm' } }), false);
    assert.equal(await syncZcodeSessionModelSelection({ dbPath, sessionId: 'sess_x', selection: {} }), false);
    assert.equal(await syncZcodeSessionModelSelection({ dbPath: path.join(dir, 'missing.sqlite'), sessionId: 'sess_x', selection: { providerId: 'p', modelId: 'm' } }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
