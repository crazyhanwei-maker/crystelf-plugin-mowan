// ZCode 会话级模型/思考档位同步。
// 上游 --resume 会优先读取会话库里持久化的 modelSelection（见 restorePersistedModelSelection），
// 只改 provider_config 的 defaultModelSelection 对续接轮次无效。这里在每次续接前，
// 把控制台任务记录里的新选型写回 session_entry，下一轮才会真正使用新的模型与思考强度。
import fs from 'fs';

const MODEL_SELECTION_ENTRY_TYPE = 'runtime/model_selection';

function normalizeSelection(selection = {}) {
  const providerId = String(selection.providerId || '').trim();
  const modelId = String(selection.modelId || '').trim();
  if (!providerId || !modelId) return null;
  const options = selection.options && typeof selection.options === 'object' && !Array.isArray(selection.options)
    ? { ...selection.options }
    : {};
  return { providerId, modelId, ...(Object.keys(options).length ? { options } : {}) };
}

function parseEntryData(value) {
  try {
    return JSON.parse(String(value || '{}')) || {};
  } catch {
    return {};
  }
}

function sameSelection(current, next) {
  return Boolean(current)
    && current.providerId === next.providerId
    && current.modelId === next.modelId
    && String(current.options?.reasoningLevel ?? '') === String(next.options?.reasoningLevel ?? '');
}

// 返回 true 表示确实改写了会话库；false 表示无需同步（无数据库/无条目/值未变化）
export async function syncZcodeSessionModelSelection(options = {}) {
  const dbPath = String(options.dbPath || '').trim();
  const sessionId = String(options.sessionId || '').trim();
  const selection = normalizeSelection(options.selection);
  if (!dbPath || !sessionId || !selection || !fs.existsSync(dbPath)) return false;

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (error) {
    throw Object.assign(new Error('当前 Node 无法加载 node:sqlite，不能同步 ZCode 会话的模型/思考档位'), {
      code: 'AGENT_ZCODE_SQLITE_UNAVAILABLE',
      cause: error,
    });
  }

  const entryId = `${sessionId}:runtime-model-selection`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let db = null;
    try {
      db = new DatabaseSync(dbPath);
      db.exec('PRAGMA busy_timeout = 3000');
      const row = db.prepare(
        'select data from session_entry where id = ? and session_id = ? and type = ? limit 1',
      ).get(entryId, sessionId, MODEL_SELECTION_ENTRY_TYPE);
      if (!row) return false;
      const data = parseEntryData(row.data);
      const current = data?.modelSelection && typeof data.modelSelection === 'object'
        ? data.modelSelection
        : {};
      if (sameSelection(current, selection)) return false;
      const nextData = { ...data, modelSelection: selection };
      db.prepare(
        'update session_entry set data = ?, time_updated = ? where id = ? and session_id = ? and type = ?',
      ).run(JSON.stringify(nextData), Date.now(), entryId, sessionId, MODEL_SELECTION_ENTRY_TYPE);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250));
    } finally {
      try {
        db?.close();
      } catch {
        // 关闭失败不覆盖真实错误
      }
    }
  }
  throw lastError || new Error('ZCode 会话模型/思考档位同步失败');
}
