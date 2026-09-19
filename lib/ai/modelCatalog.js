// models.dev 模型表读取器：主对话请求用模型真实的输出上限做 max_tokens 默认值
// 数据源与带图校验同源（agent-cli-runtime/cache/opencode/models.json，按 mtime 失效）
import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';

const CATALOG_RELATIVE = path.join('agent-cli-runtime', 'cache', 'opencode', 'models.json');
let cache = { mtimeMs: 0, map: null };

function getCatalogMap() {
  try {
    const cachePath = path.join(Path.data, CATALOG_RELATIVE);
    const mtimeMs = fs.statSync(cachePath).mtimeMs;
    if (!cache.map || cache.mtimeMs !== mtimeMs) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const map = new Map();
      for (const provider of Object.values(data)) {
        const models = provider && typeof provider === 'object' ? provider.models : null;
        if (!models || typeof models !== 'object') continue;
        for (const [modelId, meta] of Object.entries(models)) {
          if (!meta || typeof meta !== 'object') continue;
          const shortId = String(modelId).split('/').pop().toLowerCase();
          const outputLimit = Math.max(0, Number(meta.limit?.output || 0));
          const contextLimit = Math.max(0, Number(meta.limit?.context || 0));
          const existing = map.get(shortId);
          if (!existing) {
            map.set(shortId, { outputLimit, contextLimit });
          } else {
            if (!existing.outputLimit && outputLimit) existing.outputLimit = outputLimit;
            if (!existing.contextLimit && contextLimit) existing.contextLimit = contextLimit;
          }
        }
      }
      cache = { mtimeMs, map };
    }
    return cache.map;
  } catch {
    return null;
  }
}

// 模型的最大输出 token（models.dev 查表；短名匹配；查不到返回 0）
export function lookupModelOutputLimit(modelName = '') {
  const key = String(modelName || '').trim().toLowerCase();
  if (!key) return 0;
  const map = getCatalogMap();
  return map ? Math.max(0, Number(map.get(key)?.outputLimit || 0)) : 0;
}
