// QQ 模拟调试·插件命令注册表：静态解析 apps/*.js 里 Yunzai 插件的 rule 声明，
// 让模拟器的命令识别自动跟随插件命令集，而不是只依赖手工维护的白名单规则。
// 解析是字符串感知的（跳过字符串/模板/注释里的括号），仅提取字面量 reg/fnc/permission/priority/dsc；
// 模板字符串等动态 reg 无法静态求值，直接跳过。解析结果按文件 mtime 缓存。
import fs from 'fs';
import path from 'path';
import Path from '../../constants/path.js';

// 还原 JS 字符串字面量：源码里的 \\s 在运行时是 \s，正则必须用还原后的文本构造
function unescapeJsString(raw) {
  return String(raw).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|c[A-Za-z]|[\s\S])/g, (all, body) => {
    switch (body[0]) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '0': return '\0';
      case 'u': {
        if (body[1] === '{') return String.fromCodePoint(parseInt(body.slice(2, -1), 16));
        return String.fromCharCode(parseInt(body.slice(1), 16));
      }
      case 'x': return String.fromCharCode(parseInt(body.slice(1), 16));
      default: return body; // \\ \' \" \` 等 → 原字符
    }
  });
}

// 逐字符扫描：找到 rule: [ ... ] 的块（跳过字符串/模板/注释内容里的方括号）
// 返回 { text, headerIndex }：text 为括号内内容，headerIndex 为 rule 关键字位置（用于回溯插件级 priority）
function findRuleBlocks(source) {
  const blocks = [];
  const header = /(?<![\w$])rule\s*:\s*\[/g;
  let headerMatch;
  while ((headerMatch = header.exec(source)) !== null) {
    const headerIndex = headerMatch.index;
    const start = headerIndex + headerMatch[0].length - 1; // '[' 位置
    let depth = 0;
    let i = start;
    let quote = '';
    while (i < source.length) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === quote) quote = '';
        i += 1;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; i += 1; continue; }
      if (ch === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue; }
      if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2); i = i === -1 ? source.length : i + 2; continue; }
      if (ch === '[') depth += 1;
      if (ch === ']') {
        depth -= 1;
        if (depth === 0) {
          blocks.push({
            text: source.slice(start + 1, i),
            headerIndex,
            endIndex: i + 1, // ']' 之后，方法体搜索起点
          });
          break;
        }
      }
      i += 1;
    }
  }
  return blocks;
}

// 字符串感知去注释：// 与 /* */（引号内容原样保留），防止注释里的 { reg: ... } 被当成条目
function stripComments(text) {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += text[i + 1] || ''; i += 2; continue; }
      if (ch === quote) quote = '';
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i += 1; continue; }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; continue; }
    if (ch === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); i = i === -1 ? text.length : i + 2; continue; }
    out += ch;
    i += 1;
  }
  return out;
}

// 解析 rule 块内每个对象的字面量字段（对象是扁平的）；值只认字符串/数字，其余视为动态
function parseRuleEntries(blockText) {
  const entries = [];
  const clean = stripComments(blockText);
  let i = 0;
  while (i < clean.length) {
    if (clean[i] !== '{') { i += 1; continue; }
    // 字符串感知地定位对象边界（reg 里可能出现 {n,m} 量词）
    let depth = 0;
    let quote = '';
    let end = i;
    while (end < clean.length) {
      const ch = clean[end];
      if (quote) {
        if (ch === '\\') { end += 2; continue; }
        if (ch === quote) quote = '';
        end += 1;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; end += 1; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      end += 1;
    }
    const fields = extractFields(clean.slice(i + 1, end));
    if (!fields._dynamic && Object.keys(fields).length) entries.push(fields);
    i = end + 1;
  }
  return entries;
}

// 在对象文本内提取 reg/fnc/permission/priority/dsc/describe/log 的字面量值
function extractFields(objectText) {
  const fields = {};
  const fieldRe = /(?<![\w$])(reg|fnc|permission|priority|dsc|describe|log)\s*:\s*/g;
  let fieldMatch;
  while ((fieldMatch = fieldRe.exec(objectText)) !== null) {
    const key = fieldMatch[1];
    let i = fieldMatch.index + fieldMatch[0].length;
    const ch = objectText[i];
    if (ch === "'" || ch === '"') {
      let raw = '';
      i += 1;
      while (i < objectText.length && objectText[i] !== ch) {
        if (objectText[i] === '\\') { raw += objectText[i] + (objectText[i + 1] || ''); i += 2; continue; }
        raw += objectText[i];
        i += 1;
      }
      fields[key] = unescapeJsString(raw);
      fieldRe.lastIndex = i + 1;
    } else if (ch === '`') {
      fields[key] = '';
      fields._dynamic = true; // 模板字符串 reg（如 ^${nickname}...）无法静态求值
      break;
    } else if (key === 'priority' && /[-0-9]/.test(ch || '')) {
      let num = '';
      while (i < objectText.length && /[-0-9]/.test(objectText[i])) { num += objectText[i]; i += 1; }
      fields[key] = Number(num);
      fieldRe.lastIndex = i;
    } else {
      fields[key] = '';
      fields._dynamic = true; // 标识符/函数调用等动态值
      break;
    }
  }
  return fields;
}

function guessClassName(source, blockIndex) {
  const before = source.slice(Math.max(0, blockIndex - 3000), blockIndex);
  const classes = [...before.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)];
  return classes.length ? classes[classes.length - 1][1] : '';
}

// Yunzai 语义：派发优先级声明在插件级（super({...}) 的 priority 字段），rule 条目一般不带。
// 从 rule: [ 位置向前找最近的一个 priority: <数字>，即所属插件对象的优先级。
function guessPluginPriority(source, blockHeaderIndex) {
  const before = source.slice(Math.max(0, blockHeaderIndex - 800), blockHeaderIndex);
  const matches = [...before.matchAll(/(?<![\w$])priority\s*:\s*(-?\d+)\s*,?\s*(?=$)/g)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : null;
}

// 权限守卫推断：很多插件的 master 校验不写在 rule.permission，而是函数体开头的
// `if (!e.isMaster) return ...` 守卫（本仓库 14 个文件用这种写法，声明式只有 2 个文件）。
// 保守策略：只看方法体第一个 if 的条件，含 isMaster 即推断为 master 限定。
function inferFncMasterGuard(source, fncName, searchFrom) {
  const escaped = fncName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const methodRe = new RegExp(`(?<![\\w$])(?:async\\s+)?${escaped}\\s*\\([^)]*\\)\\s*{`);
  const methodMatch = source.slice(searchFrom).match(methodRe);
  if (!methodMatch) return '';
  const bodyStart = searchFrom + methodMatch.index + methodMatch[0].length;
  const body = source.slice(bodyStart, bodyStart + 600);
  const ifIdx = body.search(/(?<![\w$])if\s*\(/);
  if (ifIdx === -1) return '';
  // 条件里出现 isMaster（无论写法）即认定该命令有主人守卫
  const conditionStart = body.indexOf('(', ifIdx);
  let depth = 0;
  let i = conditionStart;
  while (i < body.length && i - conditionStart < 300) {
    if (body[i] === '(') depth += 1;
    if (body[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
    i += 1;
  }
  const condition = body.slice(conditionStart, i + 1);
  return condition.includes('isMaster') ? 'master' : '';
}

const registryCache = new Map(); // appsDir -> { mtimes: Map, result }

// 供测试/调试直接验证解析行为
export { findRuleBlocks, parseRuleEntries, unescapeJsString };

export function extractPluginCommands({ appsDir = Path.apps, logger = console } = {}) {
  let files;
  try {
    files = fs.readdirSync(appsDir).filter(f => f.endsWith('.js')).sort();
  } catch (error) {
    return { commands: [], stats: { files: 0, entries: 0, skipped: 0, error: error.message } };
  }

  const mtimes = new Map();
  for (const file of files) {
    try { mtimes.set(file, fs.statSync(path.join(appsDir, file)).mtimeMs); } catch { /* 读取时再兜底 */ }
  }
  const cached = registryCache.get(appsDir);
  if (cached && cached.mtimes.size === mtimes.size
    && [...mtimes].every(([file, mtime]) => cached.mtimes.get(file) === mtime)) {
    return cached.result;
  }

  const commands = [];
  let skipped = 0;
  for (const file of files) {
    let source = '';
    try {
      source = fs.readFileSync(path.join(appsDir, file), 'utf8');
    } catch {
      skipped += 1;
      continue;
    }
    const blocks = findRuleBlocks(source);
    for (const { text: blockText, headerIndex, endIndex } of blocks) {
      const className = guessClassName(source, headerIndex);
      const pluginPriority = guessPluginPriority(source, headerIndex);
      for (const fields of parseRuleEntries(blockText)) {
        if (fields._dynamic || !fields.reg || !fields.fnc) { skipped += 1; continue; }
        let pattern;
        try {
          pattern = new RegExp(fields.reg);
        } catch {
          skipped += 1;
          continue;
        }
        // 万能规则（如 ai.js 聊天入口 ^[\s\S]*$）不进注册表：会吞掉所有模拟消息
        if (pattern.test('')) { skipped += 1; continue; }
        const declaredPermission = fields.permission || '';
        const inferredPermission = declaredPermission ? '' : inferFncMasterGuard(source, fields.fnc, endIndex);
        commands.push({
          reg: fields.reg,
          pattern,
          fnc: fields.fnc,
          permission: declaredPermission || inferredPermission,
          permissionSource: declaredPermission ? 'declared' : inferredPermission ? 'inferred' : '',
          priority: Number.isFinite(fields.priority) ? fields.priority
            : Number.isFinite(pluginPriority) ? pluginPriority : 0,
          dsc: fields.dsc || fields.describe || '',
          log: fields.log || '',
          pluginFile: file,
          pluginClass: className,
        });
      }
    }
  }

  // Yunzai 语义：priority 小者优先派发；同值保持扫描顺序（稳定）
  commands.sort((a, b) => a.priority - b.priority);
  const result = {
    commands,
    stats: { files: files.length, entries: commands.length, skipped },
  };
  registryCache.set(appsDir, { mtimes, result });
  void logger;
  return result;
}

// 模拟器入口：仅当文本带命令前缀（#＃/）时才查注册表，
// 避免闲聊文本被 ai.js 的宽规则抢走（那些规则已按「匹配空串」过滤，双保险）
export function createQqSimulatorCommandRegistry({ appsDir = Path.apps, logger = console } = {}) {
  function matchCommand(text) {
    const source = String(text || '').trim();
    if (!/^[#＃/]/.test(source)) return null;
    const { commands } = extractPluginCommands({ appsDir, logger });
    for (const command of commands) {
      if (command.pattern.test(source)) return command;
    }
    return null;
  }

  function checkCommandPermission(command, payload = {}) {
    const permission = String(command?.permission || '').toLowerCase();
    if (!permission) return { ok: true, note: '' };
    const isMaster = payload.isMaster === true;
    const role = String(payload.role || '');
    if (permission === 'master') {
      return { ok: isMaster, note: '需要主人权限' };
    }
    if (permission === 'admin') {
      return { ok: isMaster || role === 'admin' || role === 'owner', note: '需要管理员及以上权限' };
    }
    if (permission === 'owner') {
      return { ok: isMaster || role === 'owner', note: '需要群主权限' };
    }
    return { ok: true, note: `需要 ${permission} 权限` };
  }

  return { matchCommand, checkCommandPermission };
}
