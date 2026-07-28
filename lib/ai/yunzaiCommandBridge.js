import crypto from 'crypto';
import path from 'path';
import { pathToFileURL } from 'url';
import ConfigControl from '../config/configControl.js';

const MAX_ALLOWED_COMMANDS = 50;
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60000;
const DEFAULT_MAX_COMMAND_LENGTH = 200;
const pendingConfirmations = new Map();
let loaderPromise = null;

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

function normalizeText(value = '', maxLength = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeMode(value = '') {
  return String(value || '').trim().toLowerCase() === 'direct' ? 'direct' : 'confirm';
}

function cloneRegex(regex) {
  if (regex instanceof RegExp) {
    return new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''));
  }
  try {
    return new RegExp(String(regex || ''));
  } catch {
    return null;
  }
}

function getRegexSource(regex) {
  return regex instanceof RegExp ? regex.source : String(regex || '').trim();
}

function getPluginId(key = '') {
  return normalizeText(String(key || '').replace(/\\/g, '/').split('/')[0] || '', 100);
}

function isCrystelfPlugin(pluginId = '', key = '') {
  return /^(crystelf-plugin|灵晶|魔丸)$/i.test(String(pluginId || '').trim())
    || String(key || '').replace(/\\/g, '/').startsWith('crystelf-plugin/');
}

function isBroadPattern(pattern = '') {
  const value = String(pattern || '').trim();
  return !value
    || value.includes('[\\s\\S]*')
    || value === '^.*$'
    || value === '.*'
    || !value.startsWith('^')
    || !value.endsWith('$');
}

function inferRiskMode(command = {}) {
  const context = `${command.pattern} ${command.fnc} ${command.pluginName} ${command.pluginId}`;
  if (command.permission && command.permission !== 'all') return 'confirm';
  if (/(更新|升级|重启|修复|安装|卸载|删除|清空|移除|禁言|踢|封禁|授权|密码|登录|update|upgrade|restart|repair|install|remove|delete|ban|kick|exec|shell)/i.test(context)) {
    return 'confirm';
  }
  return 'direct';
}

function isForbiddenCommand(command = {}) {
  const context = `${command.pattern} ${command.fnc} ${command.pluginName}`;
  return /(执行(?:系统|终端|shell|cmd|命令)|运行(?:终端|shell|cmd)|powershell|command[_-]?exec|shell[_-]?exec|eval\s*js|执行js|执行代码)/i.test(context);
}

function createCommandId(command = {}) {
  const source = [command.pluginId, command.key, command.fnc, command.pattern].join('\n');
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 20);
}

function normalizePolicy(policy = {}) {
  const id = normalizeText(policy.id, 80);
  if (!id) return null;
  return {
    id,
    enabled: policy.enabled !== false,
    mode: normalizeMode(policy.mode),
  };
}

export function normalizeCommandBridgeConfig(value = {}) {
  const policies = Array.isArray(value?.policies)
    ? value.policies.map(normalizePolicy).filter(Boolean).slice(0, MAX_ALLOWED_COMMANDS)
    : [];
  return {
    enabled: value?.enabled === true,
    confirmationTimeoutMs: normalizeInteger(
      value?.confirmationTimeoutMs,
      DEFAULT_CONFIRMATION_TIMEOUT_MS,
      10000,
      300000,
    ),
    maxCommandLength: normalizeInteger(
      value?.maxCommandLength,
      DEFAULT_MAX_COMMAND_LENGTH,
      20,
      500,
    ),
    policies,
  };
}

async function importYunzaiPluginLoader() {
  if (loaderPromise) return loaderPromise;
  loaderPromise = (async () => {
    const candidates = [
      path.join(process.cwd(), 'lib', 'plugins', 'loader.js'),
      path.join(process.cwd(), 'lib', 'plugins', 'index.js'),
    ];
    for (const candidate of candidates) {
      try {
        const module = await import(pathToFileURL(candidate).href);
        const loader = module?.default || module?.PluginsLoader || module?.pluginLoader;
        if (loader && Array.isArray(loader.priority)) return loader;
      } catch {}
    }
    return null;
  })();
  return loaderPromise;
}

export function resetYunzaiCommandBridgeRuntimeCache() {
  loaderPromise = null;
  pendingConfirmations.clear();
}

export function discoverYunzaiCommandsFromLoader(loader) {
  const commands = [];
  const entries = Array.isArray(loader?.priority) ? loader.priority : [];
  for (const entry of entries) {
    const plugin = entry?.plugin;
    const PluginClass = entry?.class;
    const key = normalizeText(entry?.key, 200);
    const pluginId = getPluginId(key);
    if (!plugin || typeof PluginClass !== 'function' || !pluginId || isCrystelfPlugin(pluginId, key)) continue;
    const rules = Array.isArray(plugin.rule) ? plugin.rule : [];
    rules.forEach((rule, ruleIndex) => {
      const fnc = normalizeText(rule?.fnc, 120);
      const pattern = getRegexSource(rule?.reg);
      if (!fnc || !pattern || typeof plugin[fnc] !== 'function') return;
      const event = normalizeText(rule?.event || plugin?.event || 'message', 80);
      if (!event.startsWith('message')) return;
      const command = {
        pluginId,
        key,
        pluginName: normalizeText(entry?.name || plugin?.name || pluginId, 160),
        description: normalizeText(plugin?.dsc, 240),
        fnc,
        pattern,
        permission: normalizeText(rule?.permission, 40),
        event,
        priority: Number(entry?.priority ?? plugin?.priority ?? 0) || 0,
        ruleIndex,
      };
      const broad = isBroadPattern(pattern);
      const forbidden = isForbiddenCommand(command);
      command.eligible = !broad && !forbidden;
      command.disabledReason = broad
        ? '仅允许首尾锚定的明确命令规则'
        : (forbidden ? '终端或代码执行类命令禁止桥接' : '');
      command.id = createCommandId(command);
      command.defaultMode = inferRiskMode(command);
      commands.push(command);
    });
  }
  return commands.sort((left, right) => (
    left.pluginId.localeCompare(right.pluginId, 'zh-CN')
    || left.priority - right.priority
    || left.pattern.localeCompare(right.pattern, 'zh-CN')
  ));
}

export async function getYunzaiCommandBridgeSnapshot(options = {}) {
  const config = normalizeCommandBridgeConfig(
    options.config || ConfigControl.get('coreConfig')?.tools?.commandBridge || {},
  );
  const loader = options.loader || await importYunzaiPluginLoader();
  const commands = discoverYunzaiCommandsFromLoader(loader);
  const policyMap = new Map(config.policies.filter(item => item.enabled).map(item => [item.id, item]));
  const enriched = commands.map(command => ({
    ...command,
    authorized: policyMap.has(command.id),
    mode: command.defaultMode === 'confirm'
      ? 'confirm'
      : (policyMap.get(command.id)?.mode || command.defaultMode),
    modeLocked: command.defaultMode === 'confirm',
  }));
  const stalePolicies = config.policies.filter(policy => !commands.some(command => command.id === policy.id));
  return {
    available: Boolean(loader),
    loaderType: loader?.constructor?.name || '',
    config,
    commands: enriched,
    stalePolicies,
    summary: {
      discovered: enriched.length,
      eligible: enriched.filter(item => item.eligible).length,
      authorized: enriched.filter(item => item.authorized).length,
      confirmationRequired: enriched.filter(item => item.authorized && item.mode === 'confirm').length,
      stale: stalePolicies.length,
    },
  };
}

function eventMatchesScope(event = {}, command = {}) {
  const declared = String(command.event || 'message');
  if (declared === 'message') return true;
  if (declared === 'message.group') return Boolean(event.group_id || event.isGroup);
  if (declared === 'message.private') return !event.group_id && (event.isPrivate || event.message_type === 'private');
  return false;
}

function hasPermission(event = {}, permission = '') {
  const required = String(permission || '').trim();
  if (!required || required === 'all' || event.isMaster === true) return true;
  if (required === 'master') return false;
  const role = String(event.sender?.role || event.member?.role || '').trim();
  const isOwner = event.member?.is_owner === true || role === 'owner';
  const isAdmin = event.member?.is_admin === true || role === 'admin';
  if (required === 'owner') return isOwner;
  if (required === 'admin') return isOwner || isAdmin;
  return true;
}

function createBridgeEvent(originalEvent = {}, commandText = '') {
  const event = Object.create(originalEvent || null);
  Object.assign(event, {
    msg: commandText,
    raw_message: commandText,
    message: [{ type: 'text', text: commandText }],
    sender: originalEvent?.sender ? { ...originalEvent.sender } : originalEvent?.sender,
    member: originalEvent?.member ? { ...originalEvent.member } : originalEvent?.member,
    crystelfSynthetic: true,
    crystelfCommandBridge: true,
    crystelfBridgeDepth: Number(originalEvent?.crystelfBridgeDepth || 0) + 1,
  });
  return event;
}

function getConfirmationKey(toolCtx = {}) {
  return `${normalizeText(toolCtx.sessionId, 160)}:${normalizeText(toolCtx.userId, 80)}`;
}

function isExplicitConfirmation(text = '') {
  return /^(确认|确认执行|同意|同意执行|继续|继续执行)(?:该命令|这个命令)?[。.!！]?$/.test(String(text || '').trim());
}

async function replySafe(event, message) {
  if (typeof event?.reply !== 'function') return false;
  try {
    await event.reply(message, true);
    return true;
  } catch (error) {
    logger.warn(`[command-bridge] 回复发送失败: ${error.message}`);
    return false;
  }
}

function findRuntimeCommand(snapshot, commandId, commandText) {
  const command = snapshot.commands.find(item => item.id === commandId && item.authorized && item.eligible);
  if (!command) return null;
  const regex = cloneRegex(command.pattern);
  if (!regex || !regex.test(commandText)) return null;
  return command;
}

async function executeTargetedCommand({ loader, command, commandText, originalEvent }) {
  const entry = (loader.priority || []).find(item => (
    normalizeText(item?.key, 200) === command.key
    && getPluginId(item?.key) === command.pluginId
  ));
  if (!entry?.plugin || typeof entry.class !== 'function') {
    throw new Error('目标插件当前没有加载');
  }
  const rule = (entry.plugin.rule || [])[command.ruleIndex];
  const regex = cloneRegex(rule?.reg);
  if (!rule || normalizeText(rule.fnc, 120) !== command.fnc || !regex?.test(commandText)) {
    throw new Error('目标命令规则已变化，请在控制台重新授权');
  }
  if (!eventMatchesScope(originalEvent, command)) {
    await replySafe(originalEvent, '该命令不支持当前会话类型。');
    return { success: true, blocked: true, reason: 'scope' };
  }
  if (!hasPermission(originalEvent, rule.permission)) {
    await replySafe(originalEvent, rule.permission === 'master'
      ? '该命令仅限 Bot 主人使用。'
      : '你没有执行该命令所需的群权限。');
    return { success: true, blocked: true, reason: 'permission' };
  }

  const event = createBridgeEvent(originalEvent, commandText);
  let replyCount = 0;
  const originalReply = typeof originalEvent?.reply === 'function' ? originalEvent.reply.bind(originalEvent) : null;
  if (originalReply) {
    event.reply = async (...args) => {
      replyCount += 1;
      return await originalReply(...args);
    };
  }
  const instance = Object.assign(new entry.class(event), { e: event });
  if (typeof loader.checkDisable === 'function' && loader.checkDisable(instance) === false) {
    await replySafe(originalEvent, '目标插件在当前群已被禁用。');
    return { success: true, blocked: true, reason: 'plugin_disabled' };
  }
  if (typeof instance[command.fnc] !== 'function') {
    throw new Error('目标插件处理函数不存在');
  }
  const result = await instance[command.fnc](event);
  if (replyCount === 0 && result !== false) {
    await replySafe(originalEvent, `已执行 ${command.pluginName} 的命令：${commandText}`);
  }
  return {
    success: true,
    pluginId: command.pluginId,
    pluginName: command.pluginName,
    command: commandText,
    replyCount,
    returnedFalse: result === false,
  };
}

export async function executeYunzaiCommandBridge(args = {}, toolCtx = {}, options = {}) {
  const originalEvent = toolCtx?.event;
  if (!originalEvent || originalEvent.crystelfSynthetic || Number(originalEvent.crystelfBridgeDepth || 0) > 0) {
    return { success: true, blocked: true, reason: 'invalid_event' };
  }
  const loader = options.loader || await importYunzaiPluginLoader();
  if (!loader) {
    await replySafe(originalEvent, '当前 Yunzai 分支暂不支持命令桥接。');
    return { success: true, blocked: true, reason: 'loader_unavailable' };
  }
  const snapshot = await getYunzaiCommandBridgeSnapshot({ loader, config: options.config });
  if (!snapshot.config.enabled) {
    return { success: true, blocked: true, reason: 'disabled' };
  }
  const commandId = normalizeText(args.command_id, 80);
  const commandText = normalizeText(args.command, snapshot.config.maxCommandLength);
  if (!commandId || !commandText || commandText.length > snapshot.config.maxCommandLength) {
    await replySafe(originalEvent, '命令桥接参数不完整。');
    return { success: true, blocked: true, reason: 'invalid_arguments' };
  }
  const command = findRuntimeCommand(snapshot, commandId, commandText);
  if (!command) {
    await replySafe(originalEvent, '该插件命令未授权，或命令格式与授权规则不匹配。');
    return { success: true, blocked: true, reason: 'not_authorized' };
  }
  if (!eventMatchesScope(originalEvent, command)) {
    await replySafe(originalEvent, '该命令不支持当前会话类型。');
    return { success: true, blocked: true, reason: 'scope' };
  }
  if (!hasPermission(originalEvent, command.permission)) {
    await replySafe(originalEvent, command.permission === 'master'
      ? '该命令仅限 Bot 主人使用。'
      : '你没有执行该命令所需的群权限。');
    return { success: true, blocked: true, reason: 'permission' };
  }

  const confirmationKey = getConfirmationKey(toolCtx);
  const now = Date.now();
  const pending = pendingConfirmations.get(confirmationKey);
  if (pending && pending.expiresAt <= now) pendingConfirmations.delete(confirmationKey);

  if (command.mode === 'confirm') {
    const confirmed = pending
      && pending.commandId === command.id
      && pending.commandText === commandText
      && pending.expiresAt > now
      && isExplicitConfirmation(toolCtx?.targetMessage?.content);
    if (!confirmed) {
      pendingConfirmations.set(confirmationKey, {
        commandId: command.id,
        commandText,
        expiresAt: now + snapshot.config.confirmationTimeoutMs,
      });
      await replySafe(
        originalEvent,
        `即将执行 ${command.pluginName} 的命令：${commandText}\n请在 ${Math.ceil(snapshot.config.confirmationTimeoutMs / 1000)} 秒内回复“确认执行”。`,
      );
      return { success: true, confirmationRequired: true, command: commandText };
    }
    pendingConfirmations.delete(confirmationKey);
  }

  try {
    const result = await executeTargetedCommand({ loader, command, commandText, originalEvent });
    logger.info(`[command-bridge] ${command.pluginId} ${command.fnc} executed by ${toolCtx.userId || 'unknown'}`);
    return result;
  } catch (error) {
    logger.error(`[command-bridge] 命令执行失败 ${command.pluginId}/${command.fnc}: ${error.stack || error.message}`);
    await replySafe(originalEvent, '插件命令执行失败，请稍后再试或查看 Bot 日志。');
    return { success: true, handledError: true, reason: 'execution_failed' };
  }
}

function buildToolDescription(commands = []) {
  const lines = [
    '调用用户已在控制台授权的 Yunzai 插件命令。只能从下列命令中选择，不得编造命令或 command_id。',
    '需要确认的命令首次调用只会请求用户确认；只有同一用户下一条真实消息明确回复“确认执行”时才能再次调用。',
  ];
  commands.slice(0, MAX_ALLOWED_COMMANDS).forEach(command => {
    lines.push(`- ${command.id} | ${command.pluginName} | /${command.pattern}/ | ${command.mode === 'confirm' ? '需要确认' : '直接执行'}`);
  });
  return lines.join('\n').slice(0, 12000);
}

export async function getYunzaiCommandBridgeTool(toolCtx = {}, options = {}) {
  if (!toolCtx?.event || toolCtx.event.crystelfSynthetic) return null;
  const configured = normalizeCommandBridgeConfig(
    options.config || ConfigControl.get('coreConfig')?.tools?.commandBridge || {},
  );
  if (!configured.enabled) return null;
  const snapshot = await getYunzaiCommandBridgeSnapshot({ ...options, config: configured });
  if (!snapshot.available || !snapshot.config.enabled) return null;
  const commands = snapshot.commands.filter(command => (
    command.authorized
    && command.eligible
    && eventMatchesScope(toolCtx.event, command)
  ));
  if (commands.length === 0) return null;
  return {
    name: 'run_yunzai_command',
    displayName: 'Yunzai 插件命令桥接',
    description: buildToolDescription(commands),
    parameters: {
      type: 'object',
      properties: {
        command_id: {
          type: 'string',
          enum: commands.map(command => command.id),
          description: '控制台授权命令的唯一 ID',
        },
        command: {
          type: 'string',
          description: '需要执行的完整 Yunzai 命令，必须匹配对应授权规则',
          maxLength: snapshot.config.maxCommandLength,
        },
      },
      required: ['command_id', 'command'],
      additionalProperties: false,
    },
    returnToAI: false,
    stopOnFailure: false,
    handler: (args) => executeYunzaiCommandBridge(args, toolCtx, { loader: options.loader, config: options.config }),
  };
}

export async function saveYunzaiCommandBridgeConfig(payload = {}, options = {}) {
  const loader = options.loader || await importYunzaiPluginLoader();
  const commands = discoverYunzaiCommandsFromLoader(loader);
  const commandMap = new Map(commands.map(command => [command.id, command]));
  const requestedPolicies = Array.isArray(payload.policies) ? payload.policies : [];
  if (requestedPolicies.length > MAX_ALLOWED_COMMANDS) {
    throw Object.assign(new Error(`最多允许授权 ${MAX_ALLOWED_COMMANDS} 条插件命令`), { statusCode: 400 });
  }
  const policies = requestedPolicies.map(normalizePolicy).filter(Boolean).map(policy => {
    const command = commandMap.get(policy.id);
    if (!command || !command.eligible) {
      throw Object.assign(new Error('授权列表包含不存在或不安全的命令规则，请刷新后重试'), { statusCode: 400 });
    }
    return {
      ...policy,
      mode: command.defaultMode === 'confirm' ? 'confirm' : policy.mode,
    };
  });
  const nextConfig = normalizeCommandBridgeConfig({
    enabled: payload.enabled === true,
    confirmationTimeoutMs: payload.confirmationTimeoutMs,
    maxCommandLength: payload.maxCommandLength,
    policies,
  });
  const coreConfig = ConfigControl.get('coreConfig') || {};
  const nextCoreConfig = {
    ...coreConfig,
    tools: {
      ...(coreConfig.tools || {}),
      commandBridge: nextConfig,
    },
  };
  await ConfigControl.set('coreConfig', nextCoreConfig, {
    action: 'command_bridge_save',
    source: 'web_console',
  });
  pendingConfirmations.clear();
  return await getYunzaiCommandBridgeSnapshot({ loader, config: nextConfig });
}
