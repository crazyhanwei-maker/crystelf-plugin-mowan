// 只读 ZCode 会话库：补齐控制台事件流可能错过的目标、检查点与累计用量。
// 会话库是上游 SQLite（WAL），任务空闲时读取；失败不阻断任务，只返回 null。
import fs from 'fs';

function toNonNegativeInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
}

const GOAL_READ_FAILED = Symbol('zcode-goal-read-failed');

function readTableColumns(db, table) {
  try {
    return new Set(
      db.prepare(`pragma table_info(${table})`).all().map(row => String(row?.name || '')),
    );
  } catch {
    // 返回 null 表示探测失败（锁冲突/损坏），与“表不存在”的空集合区分开
    return null;
  }
}

function readGoal(db, sessionId) {
  // 上游 0005 迁移把 session_target_next 重命名成了 session_target：
  // 当前库里通常只有 session_target，且 token_budget/tokens_used/time_used_seconds
  // 都在这个表上；旧库的 session_target 则只有目标与时间列。
  // 先按实际列探测，避免把新库误当旧库读、丢掉目标用量。
  for (const table of ['session_target_next', 'session_target']) {
    const columns = readTableColumns(db, table);
    if (columns === null) return GOAL_READ_FAILED;
    if (!columns.has('objective')) continue;
    const hasAccounting = ['token_budget', 'tokens_used', 'time_used_seconds'].every(name => columns.has(name));
    const selected = hasAccounting
      ? 'objective, status, token_budget, tokens_used, time_used_seconds, time_created, time_updated'
      : 'objective, status, time_created, time_updated';
    try {
      const row = db.prepare(`select ${selected} from ${table} where session_id = ?`).get(sessionId);
      if (!row) continue;
      return {
        objective: String(row.objective || ''),
        status: String(row.status || 'active'),
        tokensUsed: toNonNegativeInt(row.tokens_used),
        tokenBudget: row.token_budget === null || row.token_budget === undefined ? null : toNonNegativeInt(row.token_budget),
        timeUsedSeconds: toNonNegativeInt(row.time_used_seconds),
        time: { created: Number(row.time_created) || 0, updated: Number(row.time_updated) || 0 },
      };
    } catch {
      // 表存在但查询失败（锁冲突/损坏）：明确标记不可读，不能当成“目标已清除”
      return GOAL_READ_FAILED;
    }
  }
  return null;
}

function readCheckpoints(db, sessionId) {
  try {
    const rows = db.prepare(
      'select time_created, data from session_entry where session_id = ? and type = ? order by time_created asc',
    ).all(sessionId, 'runtime/workspace_checkpoint');
    const checkpoints = [];
    for (const row of rows) {
      let parsed = null;
      try {
        parsed = JSON.parse(String(row.data || '{}'));
      } catch {
        continue;
      }
      const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
      const id = String(payload.checkpointId || '').trim();
      if (!/^checkpoint_[A-Za-z0-9_-]{1,120}$/.test(id)) continue;
      checkpoints.push({
        id,
        scope: String(payload.scope || ''),
        fileCount: toNonNegativeInt(payload.fileCount),
        messageId: String(payload.messageId || ''),
        targetMessageId: String(payload.targetMessageId || ''),
        createdAt: Number(row.time_created) || 0,
      });
    }
    // 去重（同一检查点可能被重复持久化），按时间倒序，保留最近 50 条
    const seen = new Set();
    return checkpoints
      .sort((left, right) => right.createdAt - left.createdAt)
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 50);
  } catch {
    return [];
  }
}

function readUsage(db, sessionId) {
  try {
    const row = db.prepare(`
      select
        count(*) as turns,
        coalesce(sum(input_tokens), 0) as input_tokens,
        coalesce(sum(output_tokens), 0) as output_tokens,
        coalesce(sum(reasoning_tokens), 0) as reasoning_tokens,
        coalesce(sum(cache_creation_input_tokens), 0) as cache_creation_input_tokens,
        coalesce(sum(cache_read_input_tokens), 0) as cache_read_input_tokens,
        coalesce(sum(computed_total_tokens), 0) as total_tokens,
        coalesce(sum(tool_call_count), 0) as tool_calls
      from turn_usage where session_id = ?
    `).get(sessionId);
    const turns = toNonNegativeInt(row?.turns);
    if (!turns) return null;
    return {
      turns,
      input: toNonNegativeInt(row.input_tokens),
      output: toNonNegativeInt(row.output_tokens),
      reasoning: toNonNegativeInt(row.reasoning_tokens),
      cacheRead: toNonNegativeInt(row.cache_read_input_tokens),
      cacheWrite: toNonNegativeInt(row.cache_creation_input_tokens),
      total: toNonNegativeInt(row.total_tokens),
      toolCalls: toNonNegativeInt(row.tool_calls),
    };
  } catch {
    return null;
  }
}

// 失败/取消轮次的兜底用量：result 行可能没有 usage，但会话库通常已写入 turn_usage。
// 只读取最新一轮；调用方仍需按本轮开始时间做一次归属校验，避免误取历史轮次。
export async function readZcodeLastTurnUsage(options = {}) {
  const dbPath = String(options.dbPath || '').trim();
  const sessionId = String(options.sessionId || '').trim();
  if (!dbPath || !sessionId || !fs.existsSync(dbPath)) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return null;
  }
  let db = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 1500');
    const row = db.prepare(`
      select input_tokens, output_tokens, reasoning_tokens,
             cache_creation_input_tokens, cache_read_input_tokens,
             computed_total_tokens, started_at
      from turn_usage
      where session_id = ?
      order by started_at desc, rowid desc
      limit 1
    `).get(sessionId);
    if (!row) return null;
    const input = toNonNegativeInt(row.input_tokens);
    const output = toNonNegativeInt(row.output_tokens);
    const reasoning = toNonNegativeInt(row.reasoning_tokens);
    const total = toNonNegativeInt(row.computed_total_tokens) || input + output + reasoning;
    return {
      input,
      // 与 result.usage / normalizeUsage 的口径一致：completion 含 reasoning
      output: output + reasoning,
      reasoning,
      total,
      cacheRead: toNonNegativeInt(row.cache_read_input_tokens),
      cacheWrite: toNonNegativeInt(row.cache_creation_input_tokens),
      startedAt: toNonNegativeInt(row.started_at),
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // 关闭失败不影响兜底结果
    }
  }
}

// 返回 {goal, checkpoints, usage}；数据库不存在/不可读返回 null
export async function readZcodeSessionState(options = {}) {
  const dbPath = String(options.dbPath || '').trim();
  const sessionId = String(options.sessionId || '').trim();
  if (!dbPath || !sessionId || !fs.existsSync(dbPath)) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (error) {
    throw Object.assign(new Error('当前 Node 无法加载 node:sqlite，不能读取 ZCode 会话状态'), {
      code: 'AGENT_ZCODE_SQLITE_UNAVAILABLE',
      cause: error,
    });
  }
  let db = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 3000');
    const goal = readGoal(db, sessionId);
    return {
      // undefined 表示本次读取失败（锁冲突/损坏），调用方应保留已有目标而不是清空
      goal: goal === GOAL_READ_FAILED ? undefined : goal,
      checkpoints: readCheckpoints(db, sessionId),
      usage: readUsage(db, sessionId),
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // 关闭失败不影响读取结果
    }
  }
}
