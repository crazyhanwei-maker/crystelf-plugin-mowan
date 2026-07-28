import fs from 'fs/promises';
import path from 'path';
import Path from '../../constants/path.js';
import {
  getYunzaiCommandBridgeSnapshot,
  saveYunzaiCommandBridgeConfig,
} from '../ai/yunzaiCommandBridge.js';

const MODULE_META = {
  '60s.js': { label: '60 秒早报', category: '内容娱乐', featureKey: '60s' },
  'ai.js': { label: 'AI 对话', category: 'AI 对话', featureKey: 'ai' },
  'auth-set.js': { label: '入群验证设置', category: '群管理', featureKey: 'auth' },
  'auth.js': { label: '入群验证', category: '群管理', featureKey: 'auth' },
  'command-list.js': { label: '命令列表', category: '调试维护', featureKey: 'help' },
  'dependency-repair.js': { label: '依赖修复', category: '调试维护', featureKey: 'dependencyRepair' },
  'face-reply-message.js': { label: '表情回应命令', category: '内容娱乐', featureKey: 'faceReply' },
  'face-reply.js': { label: '表情回应监听', category: '内容娱乐', featureKey: 'faceReply' },
  'group-management.js': { label: '群消息风控', category: '群管理', featureKey: 'groupManagement' },
  'group-summary.js': { label: '群聊总结', category: '群管理', featureKey: 'groupManagement' },
  'group-title.js': { label: '群头衔申请', category: '群管理', featureKey: 'groupTitle' },
  'help.js': { label: '帮助系统', category: '调试维护', featureKey: 'help' },
  'image-monitor.js': { label: '图片监控', category: '群管理', featureKey: 'imageMonitor' },
  'log-diagnosis.js': { label: '日志排查', category: '调试维护', featureKey: 'logDiagnosis' },
  'music.js': { label: '点歌', category: '内容娱乐', featureKey: 'music' },
  'poke.js': { label: '戳一戳', category: '内容娱乐', featureKey: 'poke' },
  'rssPush.js': { label: 'RSS 订阅', category: '内容娱乐', featureKey: 'rss' },
  'status.js': { label: '运行状态', category: '调试维护', featureKey: 'status' },
  'update-plugin.js': { label: '插件更新', category: '调试维护', featureKey: 'autoUpdate' },
  'voice-model.js': { label: '语音模型切换', category: '内容娱乐', featureKey: 'voiceModel' },
  'voice-synthesis.js': { label: '语音合成', category: '内容娱乐', featureKey: 'ai' },
  'web-console-login.js': { label: '控制台登录', category: '调试维护', featureKey: 'webConsole' },
  'welcome-set.js': { label: '入群欢迎设置', category: '群管理', featureKey: 'welcome' },
  'welcome.js': { label: '入群欢迎', category: '群管理', featureKey: 'welcome' },
  'zwa.js': { label: '早晚安', category: '内容娱乐', featureKey: 'zwa' },
};

const FEATURE_LABELS = {
  '60s': '60 秒早报',
  ai: 'AI 对话',
  auth: '入群验证',
  autoUpdate: '自动更新',
  dependencyRepair: '依赖修复',
  faceReply: '表情回应',
  groupManagement: '群管理',
  groupTitle: '群头衔',
  help: '帮助系统',
  imageMonitor: '图片监控',
  logDiagnosis: '日志排查',
  music: '点歌',
  poke: '戳一戳',
  privateAi: '私聊 AI',
  rss: 'RSS 订阅',
  status: '状态图',
  voiceModel: '语音模型',
  webConsole: '控制台',
  welcome: '入群欢迎',
  zwa: '早晚安',
};

const KNOWN_COMMAND_DESCRIPTIONS = [
  [/灵晶帮助/, '查看帮助导航或指定分类帮助'],
  [/灵晶状态/, '查看插件运行状态图片'],
  [/灵晶命令列表/, '在 QQ 内查看命令列表图片'],
  [/灵晶登录/, '私聊获取控制台一次性登录链接'],
  [/灵晶排查日志/, '使用 AI 排查近期 Bot 日志'],
  [/灵晶修复依赖|修复依赖/, '检查并修复缺失依赖'],
  [/更新灵晶|强制更新灵晶/, '更新插件代码'],
  [/合成语音/, '合成并发送语音消息'],
  [/语音模型|切换语音模型|重置语音模型/, '查看或切换语音模型'],
  [/点歌|听|发送|文件/, '搜索、播放或上传歌曲'],
  [/群总结/, '生成本群群聊总结'],
  [/申请头衔|头衔申请|同意头衔|拒绝头衔/, '申请或审核群头衔'],
  [/开启群管理|关闭群管理/, '开启或关闭本群群管理能力'],
  [/开启验证|关闭验证|切换验证|重新验证|绕过验证/, '管理入群验证流程'],
  [/设置欢迎|查看欢迎|清除欢迎/, '管理入群欢迎文案和图片'],
  [/rss/i, '管理或拉取 RSS 订阅'],
  [/60s|早报/, '获取 60 秒早报'],
  [/早安|早上好|晚安|睡觉/, '早晚安互动'],
  [/回应/, '主动触发表情回应'],
  [/好感|用户画像|会话状态|知识命中|工具调用/, 'AI 会话、画像和调试命令'],
  [/私聊安全|私聊黑名单/, '管理私聊 AI 安全策略'],
];

function isIdentifierChar(char = '') {
  return /[\w$]/.test(char);
}

function skipString(text, index, quote) {
  let i = index + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === quote) return i;
    i += 1;
  }
  return text.length - 1;
}

function skipLineComment(text, index) {
  const next = text.indexOf('\n', index + 2);
  return next < 0 ? text.length - 1 : next;
}

function skipBlockComment(text, index) {
  const next = text.indexOf('*/', index + 2);
  return next < 0 ? text.length - 1 : next + 1;
}

function getPreviousNonSpace(text, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return '';
}

function isLikelyRegexStart(text, index) {
  const previous = getPreviousNonSpace(text, index);
  return !previous || /[(:,=[{!&|?;]/.test(previous);
}

function skipRegexLiteral(text, index) {
  let inClass = false;
  let i = index + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '[') inClass = true;
    if (char === ']') inClass = false;
    if (char === '/' && !inClass) {
      while (/[a-z]/i.test(text[i + 1] || '')) i += 1;
      return i;
    }
    i += 1;
  }
  return text.length - 1;
}

function findMatching(text, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(text, i, char);
      continue;
    }
    if (char === '/' && next === '/') {
      i = skipLineComment(text, i);
      continue;
    }
    if (char === '/' && next === '*') {
      i = skipBlockComment(text, i);
      continue;
    }
    if (char === '/' && isLikelyRegexStart(text, i)) {
      i = skipRegexLiteral(text, i);
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function decodeLiteralValue(value = '') {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function findPropertyValueStart(text, propertyName) {
  const pattern = new RegExp(`(?:^|[^\\w$])${propertyName}\\s*:`, 'g');
  const match = pattern.exec(text);
  if (!match) return -1;
  let index = match.index + match[0].length;
  while (/\s/.test(text[index] || '')) index += 1;
  return index;
}

function readValue(text, valueStart) {
  if (valueStart < 0) return { raw: '', value: '', type: 'missing' };
  const char = text[valueStart];
  if (char === '"' || char === "'" || char === '`') {
    const end = skipString(text, valueStart, char);
    const rawBody = text.slice(valueStart + 1, end);
    return {
      raw: text.slice(valueStart, end + 1),
      value: decodeLiteralValue(rawBody),
      type: char === '`' ? 'template' : 'string',
    };
  }
  if (char === '/' && isLikelyRegexStart(text, valueStart)) {
    const end = skipRegexLiteral(text, valueStart);
    return {
      raw: text.slice(valueStart, end + 1).trim(),
      value: text.slice(valueStart, end + 1).trim(),
      type: 'regex',
    };
  }
  const match = text.slice(valueStart).match(/^-?\d+(?:\.\d+)?/);
  if (match) {
    return { raw: match[0], value: Number(match[0]), type: 'number' };
  }
  const word = text.slice(valueStart).match(/^[\w$?.]+/);
  return {
    raw: word?.[0] || '',
    value: word?.[0] || '',
    type: 'expression',
  };
}

function readProperty(text, propertyName) {
  return readValue(text, findPropertyValueStart(text, propertyName));
}

function extractSuperBlocks(source = '') {
  const blocks = [];
  const pattern = /super\s*\(\s*\{/g;
  let match;
  while ((match = pattern.exec(source))) {
    const openIndex = source.indexOf('{', match.index);
    const closeIndex = findMatching(source, openIndex, '{', '}');
    if (openIndex < 0 || closeIndex < 0) continue;
    const before = source.slice(0, match.index);
    const classMatch = Array.from(before.matchAll(/class\s+([A-Za-z_$][\w$]*)\s+extends\s+plugin/g)).pop();
    blocks.push({
      className: classMatch?.[1] || '',
      start: openIndex,
      end: closeIndex,
      body: source.slice(openIndex + 1, closeIndex),
    });
    pattern.lastIndex = closeIndex + 1;
  }
  return blocks;
}

function extractRuleObjects(superBody = '') {
  const valueStart = findPropertyValueStart(superBody, 'rule');
  if (valueStart < 0 || superBody[valueStart] !== '[') return [];
  const end = findMatching(superBody, valueStart, '[', ']');
  if (end < 0) return [];
  const body = superBody.slice(valueStart + 1, end);
  const objects = [];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '{') continue;
    const objectEnd = findMatching(body, i, '{', '}');
    if (objectEnd < 0) break;
    objects.push(body.slice(i + 1, objectEnd));
    i = objectEnd;
  }
  return objects;
}

function getMethodBody(source = '', methodName = '') {
  if (!methodName) return '';
  const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:async\\s+)?${escaped}\\s*\\([^)]*\\)\\s*\\{`, 'g');
  const match = pattern.exec(source);
  if (!match) return '';
  const openIndex = source.indexOf('{', match.index);
  const closeIndex = findMatching(source, openIndex, '{', '}');
  if (closeIndex < 0) return '';
  return source.slice(openIndex + 1, closeIndex);
}

function inferPermissionLabel(source = '', fnc = '', explicitPermission = '') {
  const explicit = String(explicitPermission || '').trim();
  if (explicit === 'master') return '主人';
  if (explicit) return explicit;

  const body = getMethodBody(source, fnc);
  if (/isGroupManager\s*\(\s*e\s*\)/.test(body) || /群主、管理员|群主或管理员/.test(body)) {
    return '主人/群主/管理员';
  }
  if (/isMasterUser\s*\(\s*e\s*\)/.test(body) || /e\.isMaster/.test(body)) {
    return '主人';
  }
  if (/role\s*===\s*['"]owner['"]|role\s*===\s*['"]admin['"]/.test(body)) {
    return '群主/管理员';
  }
  return '所有人';
}

function normalizePriority(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getEventLabel(event = '') {
  const value = String(event || '').trim();
  const labels = {
    message: '消息',
    'message.group': '群消息',
    'notice.group.poke': '群戳一戳',
    'notice.group.increase': '新人入群',
  };
  return labels[value] || value || '未声明';
}

function getPatternKind(pattern = '', event = '') {
  const value = String(pattern || '').trim();
  if (!value && event.includes('notice')) return '事件监听';
  if (!value) return '自定义监听';
  if (/^\^?\[\\s\\S\]\*\$?$/.test(value) || value.includes('[\\s\\S]*')) return '兜底监听';
  if (/https?:/.test(value)) return '内容匹配';
  if (/\\d\{1,3\}|\(\[1-9\]\|1\\d\|20\)/.test(value)) return '数字选择';
  if (/#[\u4e00-\u9fa5A-Za-z0-9]/.test(value) || /灵晶|合成语音|点歌|rss|回应/.test(value)) return '指令';
  return '文本匹配';
}

function simplifyPattern(pattern = '', event = '', fnc = '') {
  const raw = String(pattern || '').trim();
  if (!raw && event === 'notice.group.poke') return '戳一戳机器人';
  if (!raw && event === 'notice.group.increase') return '新人入群';
  if (!raw) return fnc || '自定义监听';
  if (raw.startsWith('/')) return raw;
  return raw
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\(\#\|\/\)\?/g, '#或/')
    .replace(/\[\#＃\/\]\?/g, '#/＃/可选')
    .replace(/\[\\s\\S\]\*/g, '任意内容')
    .replace(/\.\+/g, '内容')
    .replace(/\\s\*/g, ' ')
    .replace(/\\s\+/g, ' ')
    .replace(/\\d\+/g, '数字')
    .replace(/\\d\{1,3\}/g, '数字')
    .replace(/\(\?:/g, '(')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function inferDescription(pattern = '', fnc = '', moduleLabel = '') {
  const source = `${pattern} ${fnc} ${moduleLabel}`;
  const found = KNOWN_COMMAND_DESCRIPTIONS.find(([regex]) => regex.test(source));
  if (found) return found[1];
  if (getPatternKind(pattern).includes('兜底')) return '监听消息并进入模块运行时判断';
  return `${moduleLabel || '模块'}：${fnc || '处理函数'}`;
}

function isBroadRule(pattern = '', event = '') {
  const value = String(pattern || '').trim();
  if (!value && String(event || '').includes('notice')) return false;
  return !value
    || value.includes('[\\s\\S]*')
    || /^\^?\\d\{1,3\}\$?$/.test(value)
    || (event === 'message' && value.includes('任意内容'));
}

function extractExactCommand(pattern = '') {
  const raw = String(pattern || '').trim();
  if (!raw.startsWith('^') || !raw.endsWith('$')) return '';
  if (/[()[\]|?+*\\]/.test(raw.replace(/^#?[\u4e00-\u9fa5A-Za-z0-9]+/, ''))) return '';
  return raw.slice(1, -1).replace(/\\/g, '');
}

function getFeatureState(config = {}, featureKey = '') {
  if (!featureKey) {
    return {
      key: '',
      label: '未绑定开关',
      enabled: true,
      stateLabel: '随模块启用',
      tone: 'neutral',
    };
  }
  if (!Object.prototype.hasOwnProperty.call(config, featureKey)) {
    return {
      key: featureKey,
      label: FEATURE_LABELS[featureKey] || featureKey,
      enabled: true,
      stateLabel: '未在主开关中声明',
      tone: 'warning',
    };
  }
  const enabled = config[featureKey] !== false;
  return {
    key: featureKey,
    label: FEATURE_LABELS[featureKey] || featureKey,
    enabled,
    stateLabel: enabled ? '已开启' : '已关闭',
    tone: enabled ? 'success' : 'disabled',
  };
}

function parseCommandRulesFromSource(fileName = '', source = '', config = {}) {
  const meta = MODULE_META[fileName] || {
    label: fileName.replace(/\.js$/i, ''),
    category: '其他',
    featureKey: '',
  };
  const commands = [];
  const blocks = extractSuperBlocks(source);
  for (const block of blocks) {
    const pluginName = readProperty(block.body, 'name').value || block.className || fileName;
    const pluginDsc = readProperty(block.body, 'dsc').value || '';
    const event = String(readProperty(block.body, 'event').value || '').trim();
    const pluginPriority = normalizePriority(readProperty(block.body, 'priority').value, 0);
    const ruleObjects = extractRuleObjects(block.body);
    const normalizedRuleObjects = ruleObjects.length > 0 ? ruleObjects : [''];

    normalizedRuleObjects.forEach((ruleBody, ruleIndex) => {
      const reg = readProperty(ruleBody, 'reg');
      const fnc = String(readProperty(ruleBody, 'fnc').value || '').trim();
      const rulePriority = readProperty(ruleBody, 'priority');
      const permission = readProperty(ruleBody, 'permission');
      const effectivePriority = normalizePriority(rulePriority.value, pluginPriority);
      const feature = getFeatureState(config, meta.featureKey);
      const pattern = String(reg.value || '').trim();
      const displayCommand = simplifyPattern(pattern, event, fnc);
      const kind = getPatternKind(pattern, event);
      const permissionLabel = inferPermissionLabel(source, fnc, permission.value);
      const exactCommand = extractExactCommand(pattern);
      const broad = isBroadRule(pattern, event);

      commands.push({
        id: `${fileName}:${block.className || pluginName}:${ruleIndex}:${fnc || 'accept'}`,
        fileName,
        filePath: `apps/${fileName}`,
        className: block.className || '',
        pluginName,
        pluginDsc,
        moduleLabel: meta.label,
        category: meta.category,
        event,
        eventLabel: getEventLabel(event),
        priority: effectivePriority,
        pluginPriority,
        rulePriority: rulePriority.type === 'missing' ? null : normalizePriority(rulePriority.value, pluginPriority),
        permission: String(permission.value || '').trim(),
        permissionLabel,
        feature,
        enabled: feature.enabled,
        statusLabel: feature.enabled ? '可用' : '主开关关闭',
        statusTone: feature.enabled ? 'success' : 'disabled',
        pattern,
        patternRaw: reg.raw || '',
        patternType: reg.type,
        displayCommand,
        exactCommand,
        kind,
        fnc: fnc || 'accept',
        description: inferDescription(pattern, fnc, meta.label),
        broad,
      });
    });
  }
  return commands;
}

function buildRisks(commands = []) {
  const risks = [];
  const broadRules = commands
    .filter(item => item.broad)
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 16);
  if (broadRules.length > 0) {
    risks.push({
      type: 'broad-rule',
      level: broadRules.some(item => item.priority >= 0) ? 'warning' : 'info',
      title: '存在兜底或宽泛监听',
      message: '这些规则会匹配大量消息，排查命令被抢时应优先查看它们的优先级。',
      items: broadRules.map(item => ({
        command: item.displayCommand,
        moduleLabel: item.moduleLabel,
        fileName: item.fileName,
        priority: item.priority,
        fnc: item.fnc,
      })),
    });
  }

  const exactMap = new Map();
  commands.forEach(item => {
    if (!item.exactCommand) return;
    const key = item.exactCommand.toLowerCase();
    exactMap.set(key, [...(exactMap.get(key) || []), item]);
  });
  const duplicates = Array.from(exactMap.values())
    .filter(items => items.length > 1)
    .map(items => items.sort((left, right) => right.priority - left.priority));
  if (duplicates.length > 0) {
    risks.push({
      type: 'duplicate-command',
      level: 'warning',
      title: '存在重复精确命令',
      message: '这些命令在多个模块里注册，实际会受优先级和插件加载顺序影响。',
      items: duplicates.flatMap(items => items.map(item => ({
        command: item.exactCommand,
        moduleLabel: item.moduleLabel,
        fileName: item.fileName,
        priority: item.priority,
        fnc: item.fnc,
      }))).slice(0, 20),
    });
  }

  return risks;
}

function buildFilters(commands = []) {
  const pick = key => Array.from(new Set(commands.map(item => item[key]).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
  return {
    categories: pick('category'),
    events: pick('eventLabel'),
    permissions: pick('permissionLabel'),
    modules: pick('moduleLabel'),
    featureStates: Array.from(new Set(commands.map(item => item.feature?.stateLabel).filter(Boolean))).sort(),
  };
}

function buildSummary(commands = [], risks = []) {
  const enabledCount = commands.filter(item => item.enabled).length;
  const broadCount = commands.filter(item => item.broad).length;
  return {
    total: commands.length,
    enabledCount,
    disabledCount: commands.length - enabledCount,
    moduleCount: new Set(commands.map(item => item.moduleLabel)).size,
    fileCount: new Set(commands.map(item => item.fileName)).size,
    broadCount,
    riskCount: risks.reduce((sum, item) => sum + (Array.isArray(item.items) ? item.items.length : 1), 0),
    highPriorityCount: commands.filter(item => item.priority >= 1000).length,
  };
}

export function createCommandCenterConsole(options = {}) {
  const ConfigControl = options.ConfigControl || { get: () => ({}) };
  const logger = options.logger || console;
  const appsDir = options.appsDir || Path.apps;

  async function buildPayload() {
    try {
      const bridge = await getYunzaiCommandBridgeSnapshot().catch(error => ({
        available: false,
        error: error.message || String(error),
        config: {
          enabled: false,
          confirmationTimeoutMs: 60000,
          maxCommandLength: 200,
          policies: [],
        },
        commands: [],
        stalePolicies: [],
        summary: {
          discovered: 0,
          eligible: 0,
          authorized: 0,
          confirmationRequired: 0,
          stale: 0,
        },
      }));
      const mainConfig = ConfigControl.get('config') || {};
      const entries = await fs.readdir(appsDir, { withFileTypes: true });
      const files = entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
        .map(entry => entry.name)
        .sort((left, right) => left.localeCompare(right, 'zh-CN'));
      const commands = [];
      const scanErrors = [];
      for (const fileName of files) {
        const filePath = path.join(appsDir, fileName);
        try {
          const source = await fs.readFile(filePath, 'utf8');
          commands.push(...parseCommandRulesFromSource(fileName, source, mainConfig));
        } catch (error) {
          scanErrors.push({ fileName, error: error.message || String(error) });
        }
      }
      commands.sort((left, right) => (
        (right.priority - left.priority)
        || left.category.localeCompare(right.category, 'zh-CN')
        || left.moduleLabel.localeCompare(right.moduleLabel, 'zh-CN')
        || left.displayCommand.localeCompare(right.displayCommand, 'zh-CN')
      ));
      const risks = buildRisks(commands);
      return {
        success: true,
        data: {
          generatedAt: new Date().toISOString(),
          source: {
            appsDir,
            scanMode: 'static',
            note: '静态扫描 apps/*.js 中的 super({ rule })，不会执行插件代码。',
          },
          summary: buildSummary(commands, risks),
          filters: buildFilters(commands),
          commands,
          risks,
          scanErrors,
          bridge,
        },
      };
    } catch (error) {
      logger.warn?.(`[webConsole] 命令中心扫描失败：${error.message}`);
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  async function saveBridgeConfig(payload = {}) {
    try {
      return {
        success: true,
        data: await saveYunzaiCommandBridgeConfig(payload),
      };
    } catch (error) {
      logger.warn?.(`[webConsole] 命令桥接配置保存失败：${error.message}`);
      throw error;
    }
  }

  return {
    buildPayload,
    saveBridgeConfig,
  };
}
