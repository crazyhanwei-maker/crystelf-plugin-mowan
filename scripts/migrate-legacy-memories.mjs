// 旧记忆一次性迁移：data/crystelf/memories/<群号>/<QQ>.json → 新记忆库（data/chat/chat.json 的 memories 表）
// 用法：在 Yunzai 根目录执行
//   node plugins/crystelf-plugin/scripts/migrate-legacy-memories.mjs            # 执行迁移
//   node plugins/crystelf-plugin/scripts/migrate-legacy-memories.mjs --dry-run # 只统计不写入
// 可重复执行：同会话+同用户下内容相同的条目会自动跳过，不会产生重复记忆。

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has('--dry-run');

globalThis.logger ||= {
  info: (...args) => console.log('[info]', ...args),
  warn: (...args) => console.log('[warn]', ...args),
  error: (...args) => console.log('[error]', ...args),
  mark: (...args) => console.log('[mark]', ...args),
};

const { migrateLegacyMemories } = await import('../lib/ai/memoryLibrary.js');
const { initDatabase } = await import('../lib/ai/chatDatabase.js');
const summary = await migrateLegacyMemories({ dryRun });

// 聊天库是 500ms 防抖落盘：脚本进程马上退出，必须显式 flush，否则刚迁移的记忆会丢
if (!dryRun && summary.legacyDirExists) {
  const db = await initDatabase();
  db.flush?.();
}

if (!summary.legacyDirExists) {
  console.log(`没有找到旧记忆目录（${summary.legacyDir}），无需迁移。`);
  process.exit(0);
}

console.log(JSON.stringify({
  dryRun,
  旧记忆目录: summary.legacyDir,
  群数量: summary.groups,
  文件数: summary.files,
  旧条目总数: summary.found,
  本次导入: summary.imported,
  跳过重复: summary.skippedDuplicate,
  跳过空内容: summary.skippedEmpty,
  已过期但仍导入: summary.expiredCount,
}, null, 2));

console.log(dryRun
  ? 'dry-run 结束：未写入任何数据。去掉 --dry-run 再执行即可真正迁移。'
  : '迁移完成：旧记忆已写入新记忆库（来源标记 legacy-import），可在控制台「记忆与人设」页查看/编辑。');
process.exit(0);
