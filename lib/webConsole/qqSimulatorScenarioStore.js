import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const QQ_SIMULATOR_SCENARIO_FILE = path.join(process.cwd(), 'data', 'crystelf', 'qq-simulator', 'scenarios.json');
const QQ_SIMULATOR_SCENARIO_BACKUP_FILE = path.join(process.cwd(), 'data', 'crystelf', 'qq-simulator', 'scenario-backups.json');
const QQ_SIMULATOR_SCENARIO_LIMIT = 80;
const QQ_SIMULATOR_SCENARIO_BACKUP_LIMIT = 30;

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function createScenarioId() {
  return `scenario-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildScenarioName(payload = {}) {
  const labels = {
    message: '消息',
    join_request: '加群申请',
    group_increase: '新成员入群',
    poke: '戳一戳',
  };
  const brief = String(payload.messageText || payload.comment || payload.nickname || '测试')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
  return `${labels[payload.eventType] || '场景'} · 群${payload.groupId || '未填'} · ${brief || '测试'}`;
}

function normalizeConflictStrategy(value = '') {
  const strategy = String(value || '').trim().toLowerCase();
  return ['overwrite', 'skip', 'rename'].includes(strategy) ? strategy : 'overwrite';
}

function renameForConflict(name = '', existingNames = new Set()) {
  const base = String(name || '模拟场景').replace(/\s+/g, ' ').trim().slice(0, 68) || '模拟场景';
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base} (${index})`.slice(0, 80);
    if (!existingNames.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`.slice(0, 80);
}

function collectImportItems(source = {}) {
  if (Array.isArray(source)) return source;
  const root = isPlainObject(source) ? source : {};
  if (Array.isArray(root.scenarios)) return root.scenarios;
  if (Array.isArray(root.items)) return root.items;
  return [];
}

export function createQqSimulatorScenarioStore(options = {}) {
  const normalizeScenarioPayload = typeof options.normalizeScenarioPayload === 'function'
    ? options.normalizeScenarioPayload
    : value => (isPlainObject(value) ? value : {});
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : ((statusCode, message, code) => Object.assign(new Error(message), { statusCode, code }));
  let scenarioQueue = Promise.resolve();

  function normalizeItem(item = {}) {
    if (!isPlainObject(item)) return null;
    const sourcePayload = isPlainObject(item.payload) ? item.payload : item;
    const payload = normalizeScenarioPayload(sourcePayload);
    const createdAt = String(item.createdAt || new Date().toISOString());
    const name = String(item.name || buildScenarioName(payload)).replace(/\s+/g, ' ').trim().slice(0, 80)
      || buildScenarioName(payload);
    return {
      id: String(item.id || createScenarioId()).trim().slice(0, 120) || createScenarioId(),
      name,
      createdAt,
      updatedAt: String(item.updatedAt || new Date().toISOString()),
      payload,
      source: String(item.source || '').trim().slice(0, 80),
    };
  }

  function readStore() {
    const parsed = safeReadJson(QQ_SIMULATOR_SCENARIO_FILE, { version: 1, scenarios: [] });
    const scenarios = (Array.isArray(parsed) ? parsed : parsed.scenarios || [])
      .map(normalizeItem)
      .filter(Boolean)
      .slice(0, QQ_SIMULATOR_SCENARIO_LIMIT);
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt || ''),
      scenarios,
    };
  }

  function buildListPayload(store = readStore()) {
    return {
      success: true,
      version: store.version || 1,
      updatedAt: String(store.updatedAt || ''),
      limit: QQ_SIMULATOR_SCENARIO_LIMIT,
      count: Array.isArray(store.scenarios) ? store.scenarios.length : 0,
      scenarios: Array.isArray(store.scenarios) ? store.scenarios : [],
    };
  }

  function writeStore(scenarios = []) {
    const normalized = scenarios
      .map(normalizeItem)
      .filter(Boolean)
      .slice(0, QQ_SIMULATOR_SCENARIO_LIMIT);
    const store = {
      version: 1,
      updatedAt: new Date().toISOString(),
      scenarios: normalized,
    };
    safeWriteJson(QQ_SIMULATOR_SCENARIO_FILE, store);
    return store;
  }

  function createBackup(action = '', scenarios = [], meta = {}) {
    const normalized = (Array.isArray(scenarios) ? scenarios : [])
      .map(normalizeItem)
      .filter(Boolean)
      .slice(0, QQ_SIMULATOR_SCENARIO_LIMIT);
    if (normalized.length === 0) return null;
    const store = readBackupStore();
    const backup = {
      id: `scenario-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      action: String(action || 'unknown').trim().slice(0, 40) || 'unknown',
      createdAt: new Date().toISOString(),
      count: normalized.length,
      scenarios: normalized,
      meta: isPlainObject(meta) ? meta : {},
    };
    writeBackupStore([backup, ...store.backups].slice(0, QQ_SIMULATOR_SCENARIO_BACKUP_LIMIT));
    return backup;
  }

  function normalizeBackupItem(item = {}) {
    if (!isPlainObject(item)) return null;
    const scenarios = (Array.isArray(item.scenarios) ? item.scenarios : [])
      .map(normalizeItem)
      .filter(Boolean)
      .slice(0, QQ_SIMULATOR_SCENARIO_LIMIT);
    if (scenarios.length === 0) return null;
    return {
      id: String(item.id || `scenario-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`).trim().slice(0, 120),
      action: String(item.action || 'unknown').trim().slice(0, 40) || 'unknown',
      createdAt: String(item.createdAt || new Date().toISOString()),
      count: Number(item.count || scenarios.length) || scenarios.length,
      scenarios,
      meta: isPlainObject(item.meta) ? item.meta : {},
    };
  }

  function readBackupStore() {
    const parsed = safeReadJson(QQ_SIMULATOR_SCENARIO_BACKUP_FILE, { version: 1, backups: [] });
    const backups = (Array.isArray(parsed) ? parsed : parsed.backups || [])
      .map(normalizeBackupItem)
      .filter(Boolean)
      .slice(0, QQ_SIMULATOR_SCENARIO_BACKUP_LIMIT);
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt || ''),
      backups,
    };
  }

  function writeBackupStore(backups = []) {
    const normalized = (Array.isArray(backups) ? backups : [])
      .map(normalizeBackupItem)
      .filter(Boolean)
      .slice(0, QQ_SIMULATOR_SCENARIO_BACKUP_LIMIT);
    const store = {
      version: 1,
      updatedAt: new Date().toISOString(),
      backups: normalized,
    };
    safeWriteJson(QQ_SIMULATOR_SCENARIO_BACKUP_FILE, store);
    return store;
  }

  function buildBackupListPayload() {
    const store = readBackupStore();
    return {
      success: true,
      version: store.version,
      updatedAt: store.updatedAt,
      limit: QQ_SIMULATOR_SCENARIO_BACKUP_LIMIT,
      backups: store.backups.map(item => ({
        id: item.id,
        action: item.action,
        createdAt: item.createdAt,
        count: item.count,
        meta: item.meta,
      })),
    };
  }

  function mergeItems(current = [], incoming = [], conflictStrategy = 'overwrite') {
    const strategy = normalizeConflictStrategy(conflictStrategy);
    const merged = [...(Array.isArray(current) ? current : [])]
      .map(normalizeItem)
      .filter(Boolean);
    const originalById = new Map(merged.map(item => [item.id, item]));
    const stats = { added: 0, replaced: 0, skipped: 0, renamed: 0, replacedScenarios: [] };
    for (let importIndex = incoming.length - 1; importIndex >= 0; importIndex -= 1) {
      const item = normalizeItem(incoming[importIndex]);
      if (!item) continue;
      const index = merged.findIndex(existing => existing.id === item.id || existing.name === item.name);
      const previous = index >= 0 ? merged[index] : null;
      if (previous && strategy === 'skip') {
        stats.skipped += 1;
        continue;
      }
      let scenario = {
        ...item,
        id: previous && strategy !== 'rename' ? previous.id : item.id,
        createdAt: previous && strategy !== 'rename' ? previous.createdAt : item.createdAt,
        updatedAt: new Date().toISOString(),
      };
      if (previous && strategy === 'rename') {
        const existingNames = new Set(merged.map(existing => existing.name));
        scenario = normalizeItem({
          ...scenario,
          id: createScenarioId(),
          name: renameForConflict(scenario.name, existingNames),
          createdAt: new Date().toISOString(),
        });
        stats.renamed += 1;
      } else if (previous) {
        if (originalById.get(previous.id) === previous) {
          stats.replacedScenarios.push(previous);
        }
        merged.splice(index, 1);
        stats.replaced += 1;
      } else {
        stats.added += 1;
      }
      merged.unshift(scenario);
    }
    const dropped = Math.max(0, merged.length - QQ_SIMULATOR_SCENARIO_LIMIT);
    const droppedScenarios = merged
      .slice(QQ_SIMULATOR_SCENARIO_LIMIT)
      .filter(item => originalById.get(item.id) === item);
    return {
      scenarios: merged.slice(0, QQ_SIMULATOR_SCENARIO_LIMIT),
      dropped,
      droppedScenarios,
      ...stats,
    };
  }

  function createMergeBackup(action = '', mergeResult = {}, meta = {}) {
    const items = [
      ...(Array.isArray(mergeResult.replacedScenarios) ? mergeResult.replacedScenarios : []),
      ...(Array.isArray(mergeResult.droppedScenarios) ? mergeResult.droppedScenarios : []),
    ];
    const seen = new Set();
    const uniqueItems = items.filter((item) => {
      const normalized = normalizeItem(item);
      if (!normalized) return false;
      const key = normalized.id || `${normalized.name}:${normalized.createdAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (uniqueItems.length === 0) return null;
    return createBackup(action, uniqueItems, {
      ...meta,
      replaced: Number(mergeResult.replaced || 0),
      dropped: Number(mergeResult.dropped || 0),
    });
  }

  function savePayload(body = {}) {
    const scenario = normalizeItem(body.scenario || body);
    if (!scenario) {
      throw createHttpError(400, '模拟场景内容无效', 'QQ_SIMULATOR_SCENARIO_INVALID');
    }
    const store = readStore();
    const strategy = normalizeConflictStrategy(body.conflictStrategy || 'overwrite');
    const result = mergeItems(store.scenarios, [scenario], strategy);
    const backup = createMergeBackup('save-overwrite', result, {
      conflictStrategy: strategy,
      name: scenario.name,
    });
    const nextStore = writeStore(result.scenarios);
    const savedScenario = nextStore.scenarios.find(item => (
      item.id === scenario.id
      || item.name === scenario.name
      || item.payload?.comment === scenario.payload?.comment
    )) || nextStore.scenarios[0] || scenario;
    return {
      ...buildListPayload(nextStore),
      scenario: savedScenario,
      added: result.added,
      replaced: result.replaced,
      skipped: result.skipped,
      renamed: result.renamed,
      dropped: result.dropped,
      conflictStrategy: strategy,
      backup,
      message: result.skipped > 0 ? '模拟场景已跳过同名/同 ID 冲突' : '模拟场景已保存到服务端',
      count: nextStore.scenarios.length,
    };
  }

  function deletePayload(body = {}) {
    const id = String(body.id || '').trim();
    if (!id) {
      throw createHttpError(400, '场景 id 不能为空', 'QQ_SIMULATOR_SCENARIO_ID_EMPTY');
    }
    const store = readStore();
    const target = store.scenarios.find(item => item.id === id);
    if (target) {
      createBackup('delete', [target], { id, name: target.name });
    }
    const scenarios = store.scenarios.filter(item => item.id !== id);
    const nextStore = writeStore(scenarios);
    return {
      ...buildListPayload(nextStore),
      backup: target ? buildBackupListPayload().backups[0] : null,
      message: target ? `已删除场景：${target.name}` : '场景不存在，已刷新列表',
    };
  }

  function clearPayload() {
    const store = readStore();
    const backup = createBackup('clear', store.scenarios, { count: store.scenarios.length });
    const nextStore = writeStore([]);
    return {
      ...buildListPayload(nextStore),
      backup,
      message: '服务端模拟场景已清空',
    };
  }

  function importPayload(body = {}) {
    const imported = collectImportItems(body)
      .map(normalizeItem)
      .filter(Boolean)
      .slice(0, QQ_SIMULATOR_SCENARIO_LIMIT);
    if (imported.length === 0) {
      throw createHttpError(400, '未找到可导入的模拟场景', 'QQ_SIMULATOR_SCENARIO_IMPORT_EMPTY');
    }
    const store = readStore();
    const strategy = normalizeConflictStrategy(body.conflictStrategy || 'overwrite');
    const result = mergeItems(store.scenarios, imported, strategy);
    const backup = createMergeBackup('import-overwrite', result, {
      conflictStrategy: strategy,
      imported: imported.length,
    });
    const nextStore = writeStore(result.scenarios);
    return {
      ...buildListPayload(nextStore),
      added: result.added,
      replaced: result.replaced,
      skipped: result.skipped,
      renamed: result.renamed,
      dropped: result.dropped,
      conflictStrategy: strategy,
      backup,
      message: `已导入 ${imported.length} 个模拟场景`,
    };
  }

  function restorePayload(body = {}) {
    const id = String(body.id || '').trim();
    if (!id) {
      throw createHttpError(400, '备份 id 不能为空', 'QQ_SIMULATOR_BACKUP_ID_EMPTY');
    }
    const backupStore = readBackupStore();
    const backup = backupStore.backups.find(item => item.id === id);
    if (!backup) {
      throw createHttpError(404, '场景备份不存在', 'QQ_SIMULATOR_BACKUP_NOT_FOUND');
    }
    const store = readStore();
    const strategy = normalizeConflictStrategy(body.conflictStrategy || 'rename');
    const rollbackBackup = createBackup('restore-before', store.scenarios, {
      backupId: backup.id,
      conflictStrategy: strategy,
    });
    const result = mergeItems(store.scenarios, backup.scenarios, strategy);
    const impactBackup = createMergeBackup('restore-overwrite', result, {
      backupId: backup.id,
      conflictStrategy: strategy,
    });
    const nextStore = writeStore(result.scenarios);
    return {
      ...buildListPayload(nextStore),
      added: result.added,
      replaced: result.replaced,
      skipped: result.skipped,
      renamed: result.renamed,
      dropped: result.dropped,
      conflictStrategy: strategy,
      backup: {
        id: backup.id,
        action: backup.action,
        createdAt: backup.createdAt,
        count: backup.count,
        meta: backup.meta,
      },
      rollbackBackup,
      impactBackup,
      message: `已从回收站恢复 ${backup.scenarios.length} 个模拟场景`,
    };
  }

  function enqueueTask(task) {
    const run = scenarioQueue.then(() => task());
    scenarioQueue = run.catch(() => {});
    return run;
  }

  return {
    normalizeItem,
    listPayload: () => buildListPayload(),
    backupListPayload: buildBackupListPayload,
    savePayload,
    deletePayload,
    clearPayload,
    importPayload,
    restorePayload,
    enqueueTask,
  };
}
