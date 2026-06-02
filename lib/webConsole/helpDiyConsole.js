import fs from 'fs';
import path from 'path';

function defaultCreateHttpError(statusCode = 500, message = 'Internal Server Error', code = '') {
  const error = new Error(String(message || 'Internal Server Error'));
  error.statusCode = Math.min(599, Math.max(400, Number(statusCode || 500)));
  if (code) {
    error.code = String(code);
  }
  return error;
}

function defaultReplaceControlCharacters(value = '', replacement = ' ') {
  return Array.from(String(value || ''))
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127 ? replacement : char;
    })
    .join('');
}

export function createHelpDiyConsole(options = {}) {
  const helpDiyFile = options.helpDiyFile || '';
  const legacyHelpDiyFile = options.legacyHelpDiyFile || '';
  const uploadDir = options.uploadDir || path.join(process.cwd(), 'lib', 'webConsole', 'public', 'uploads', 'help-diy');
  const historyFile = options.historyFile || path.join(process.cwd(), 'data', 'crystelf', 'help-diy-history.json');
  const defaultImage = options.defaultImage || '';
  const imageMaxBytes = Number(options.imageMaxBytes || 5 * 1024 * 1024);
  const createHttpError = typeof options.createHttpError === 'function'
    ? options.createHttpError
    : defaultCreateHttpError;
  const safeReadJson = typeof options.safeReadJson === 'function' ? options.safeReadJson : (() => null);
  const safeWriteJson = typeof options.safeWriteJson === 'function' ? options.safeWriteJson : (() => {});
  const getStoredConfig = typeof options.getStoredConfig === 'function' ? options.getStoredConfig : (() => null);
  const setStoredConfig = typeof options.setStoredConfig === 'function' ? options.setStoredConfig : async () => {};
  const ensurePathResolvedWithinRoot = typeof options.ensurePathResolvedWithinRoot === 'function'
    ? options.ensurePathResolvedWithinRoot
    : (() => {});
  const getRealPathSafe = typeof options.getRealPathSafe === 'function'
    ? options.getRealPathSafe
    : ((targetPath = '') => targetPath);
  const isPathInsideRoot = typeof options.isPathInsideRoot === 'function'
    ? options.isPathInsideRoot
    : (() => true);
  const getWebConsoleDisplayUrl = typeof options.getWebConsoleDisplayUrl === 'function'
    ? options.getWebConsoleDisplayUrl
    : (() => 'http://127.0.0.1:27891/');
  const replaceControlCharacters = typeof options.replaceControlCharacters === 'function'
    ? options.replaceControlCharacters
    : defaultReplaceControlCharacters;

  function sanitizeUploadPrefix(prefix = 'help') {
    const safePrefix = String(prefix || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    return safePrefix || 'help';
  }

  function saveImage(dataUrl = '', prefix = 'help') {
    const matched = String(dataUrl || '').match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
    if (!matched) {
      throw new Error('图片数据格式不正确');
    }
    const mime = matched[1].toLowerCase();
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
    const base64 = matched[3];
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length <= 0) {
      throw new Error('图片数据为空');
    }
    if (buffer.length > imageMaxBytes) {
      throw new Error(`图片过大，最大允许 ${Math.round(imageMaxBytes / 1024 / 1024)}MB`);
    }
    const safePrefix = sanitizeUploadPrefix(prefix);
    const fileName = `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.resolve(uploadDir, fileName);
    ensurePathResolvedWithinRoot(filePath, uploadDir, { allowMissing: true });
    fs.writeFileSync(filePath, buffer);
    return `/uploads/help-diy/${fileName}`;
  }

  function deleteImage(urlPath = '') {
    const normalized = String(urlPath || '').trim();
    if (!normalized.startsWith('/uploads/help-diy/')) {
      throw createHttpError(400, '只允许删除 help DIY 上传目录中的图片', 'HELP_DIY_IMAGE_DELETE_FORBIDDEN');
    }
    const relativeUploadPath = path.posix.normalize(`/${normalized.slice('/uploads/help-diy/'.length)}`).replace(/^\/+/, '');
    if (!relativeUploadPath || relativeUploadPath.startsWith('..')) {
      throw createHttpError(400, '图片路径越界，拒绝删除', 'HELP_DIY_IMAGE_PATH_OUT_OF_RANGE');
    }
    const filePath = path.resolve(uploadDir, relativeUploadPath.replace(/\//g, path.sep));
    ensurePathResolvedWithinRoot(filePath, uploadDir, { allowMissing: true });
    if (fs.existsSync(filePath)) {
      const realFilePath = getRealPathSafe(filePath) || filePath;
      if (!isPathInsideRoot(realFilePath, getRealPathSafe(uploadDir) || uploadDir)) {
        throw createHttpError(400, '图片路径越界，拒绝删除', 'HELP_DIY_IMAGE_PATH_OUT_OF_RANGE');
      }
      fs.unlinkSync(realFilePath);
    }
    return true;
  }

  function getDefaultPayload() {
    return {
      enabled: false,
      updatedAt: '',
      home: {
        mode: 'image',
        text: [
          '灵晶插件帮助导航',
          '━━━━━━━━━━━━',
          '',
          '发送分类命令查看完整说明：',
          '- #灵晶帮助 AI      对话、工具、画像与好感',
          '- #灵晶帮助 管理    验证、欢迎、总结与头衔',
          '- #灵晶帮助 娱乐    早报、点歌、RSS 与互动',
          '- #灵晶帮助 调试    控制台、日志与排查入口',
          '',
          '常用入口',
          '- @机器人 直接对话',
          '- #群总结',
          '- #申请头衔 你的头衔',
          '- #rss列表',
          '- #查看会话状态',
          '',
          '控制台',
          `- ${getWebConsoleDisplayUrl()}`,
          '- 用户帮助 DIY 可以改这里的文案或图片',
        ].join('\n'),
        image: defaultImage,
      },
      categories: {
        ai: {
          mode: 'text',
          text: [
            '灵晶帮助 · AI 对话',
            '━━━━━━━━━━━━',
            '',
            '触发',
            '- @机器人 + 问题',
            '- 机器人昵称 + 问题',
            '- 私聊直接发送问题',
            '',
            '会话命令',
            '- #重置对话 / #重置会话',
            '- #查看会话状态',
            '- #查看知识命中',
            '- #查看工具调用',
            '',
            '用户数据',
            '- #查看好感度',
            '- #好感排行',
            '- #查看用户画像',
            '',
            '能力',
            '- 联网搜索',
            '- 网页正文读取',
            '- 多模态图片理解',
            '- 表情包与语音回复',
            '- HTTP skills 工具调用',
            '',
            '提示',
            '- 使用前请确认 AI 接口、模型和工具配置可用',
          ].join('\n'),
          image: '',
        },
        manage: {
          mode: 'text',
          text: [
            '灵晶帮助 · 群管理',
            '━━━━━━━━━━━━',
            '',
            '本群群管',
            '- #灵晶开启群管理',
            '- #灵晶关闭群管理',
            '',
            '入群验证',
            '- #开启验证',
            '- #关闭验证',
            '- #切换验证模式',
            '- #设置验证提示模式开启',
            '- #设置验证困难模式开启',
            '- #设置验证次数3',
            '- #重新验证 @某人',
            '- #绕过验证 @某人',
            '',
            '入群欢迎',
            '- #设置欢迎文案 欢迎词',
            '- #设置欢迎图片',
            '- #查看欢迎',
            '- #清除欢迎',
            '',
            '群运营',
            '- #群总结',
            '- #申请头衔 你的头衔',
            '- #头衔申请列表',
            '- #同意头衔 编号',
            '- #拒绝头衔 编号 理由',
            '- #取消头衔申请',
            '',
            '说明',
            '- 群管理命令通常需要群主或管理员权限',
            '- 群头衔发放需要机器人具备对应群权限',
          ].join('\n'),
          image: '',
        },
        fun: {
          mode: 'text',
          text: [
            '灵晶帮助 · 内容娱乐',
            '━━━━━━━━━━━━',
            '',
            '日常互动',
            '- 60s / 早报',
            '- 早安 / 晚安',
            '- 戳一戳机器人',
            '- #回应 内容',
            '',
            '点歌',
            '- #点歌 歌名',
            '- #听 歌名',
            '- #听 1',
            '',
            'RSS',
            '- #rss添加 订阅地址',
            '- #rss列表',
            '- #rss移除0',
            '- #rss拉取 订阅地址',
            '',
            '提示',
            '- RSS 和点歌需要对应功能开关启用',
          ].join('\n'),
          image: '',
        },
        debug: {
          mode: 'text',
          text: [
            '灵晶帮助 · 调试排查',
            '━━━━━━━━━━━━',
            '',
            '控制台',
            `- 地址：${getWebConsoleDisplayUrl()}`,
            '- 配置、日志、会话、画像、好感和用量',
            '- 图片监控、群管理、Help DIY 与 Skills 设置',
            '',
            '群内排查',
            '- #查看会话状态',
            '- #查看知识命中',
            '- #查看工具调用',
            '- #灵晶排查日志',
            '- #灵晶修复依赖',
            '- #灵晶修复依赖状态',
            '- #更新灵晶',
            '',
            '建议',
            '- 接口异常先看控制台日志和 AI 用量日志',
            '- 外网控制台务必设置强口令并限制访问来源',
          ].join('\n'),
          image: '',
        },
      },
    };
  }

  function normalizeBlock(block, fallbackText = '') {
    if (typeof block === 'string') {
      return { mode: 'text', text: String(block || fallbackText || '').trim(), image: '' };
    }
    return {
      mode: block?.mode === 'image' && String(block?.image || '').trim() ? 'image' : 'text',
      text: String(block?.text || fallbackText || '').trim(),
      image: String(block?.image || '').trim(),
    };
  }

  function buildTextBlock(lines = []) {
    return {
      mode: 'text',
      text: Array.isArray(lines) ? lines.join('\n') : String(lines || ''),
      image: '',
    };
  }

  function getTemplates() {
    const webConsoleUrl = getWebConsoleDisplayUrl();
    return [
      {
        key: 'simple',
        label: '清爽导航版',
        description: '适合普通群使用，入口短、分类清楚，群员不用读长说明。',
        payload: {
          enabled: true,
          home: buildTextBlock([
            '灵晶帮助',
            '━━━━━━━━━━━━',
            '',
            '#灵晶帮助 AI      对话与工具',
            '#灵晶帮助 管理    入群与群运营',
            '#灵晶帮助 娱乐    早报、点歌、RSS',
            '#灵晶帮助 调试    状态与控制台',
            '',
            '常用',
            '- @机器人 直接聊天',
            '- #群总结',
            '- #rss列表',
          ]),
          categories: {
            ai: buildTextBlock(['AI 对话', '━━━━━━━━━━━━', '', '- @机器人 提问', '- #重置对话', '- #查看会话状态', '- #查看知识命中', '- #查看工具调用']),
            manage: buildTextBlock(['群管理', '━━━━━━━━━━━━', '', '- #灵晶开启群管理 / #灵晶关闭群管理', '- #开启验证 / #关闭验证', '- #设置欢迎文案 欢迎词', '- #群总结', '- #申请头衔 你的头衔']),
            fun: buildTextBlock(['内容娱乐', '━━━━━━━━━━━━', '', '- 60s / 早报', '- #点歌 歌名', '- #听 1', '- #rss列表']),
            debug: buildTextBlock(['调试入口', '━━━━━━━━━━━━', '', `- 控制台 ${webConsoleUrl}`, '- #查看会话状态', '- #查看工具调用', '- #灵晶修复依赖']),
          },
        },
      },
      {
        key: 'full',
        label: '完整默认版',
        description: '直接恢复为当前内置的完整默认帮助内容。',
        payload: {
          ...getDefaultPayload(),
          enabled: true,
        },
      },
      {
        key: 'admin',
        label: '群管运维版',
        description: '适合管理员群，突出验证、欢迎、头衔、总结和控制台排障。',
        payload: {
          enabled: true,
          home: buildTextBlock([
            '灵晶群管帮助',
            '━━━━━━━━━━━━',
            '',
            '群管理',
            '- #灵晶帮助 管理',
            '- #群总结',
            '- #头衔申请列表',
            '',
            'AI 与排查',
            '- #灵晶帮助 AI',
            '- #灵晶帮助 调试',
            `- 控制台 ${webConsoleUrl}`,
          ]),
          categories: {
            ai: buildTextBlock(['AI 与用户数据', '━━━━━━━━━━━━', '', '- @机器人 直接对话', '- #查看会话状态', '- #查看知识命中', '- #查看工具调用', '- #查看用户画像', '- #好感排行']),
            manage: buildTextBlock(['群管理命令', '━━━━━━━━━━━━', '', '- #灵晶开启群管理 / #灵晶关闭群管理', '- #开启验证 / #关闭验证', '- #切换验证模式', '- #重新验证 @某人', '- #绕过验证 @某人', '- #设置欢迎文案 欢迎词', '- #群总结', '- #申请头衔 你的头衔', '- #同意头衔 编号']),
            fun: buildTextBlock(['内容娱乐', '━━━━━━━━━━━━', '', '- 60s / 早报', '- #点歌 歌名', '- #听 1', '- #rss添加 订阅地址', '- #rss列表', '- #rss移除0']),
            debug: buildTextBlock(['控制台与排查', '━━━━━━━━━━━━', '', `- 控制台 ${webConsoleUrl}`, '- #查看会话状态', '- #查看知识命中', '- #查看工具调用', '- #灵晶排查日志', '- #灵晶修复依赖', '- #灵晶修复依赖状态', '- #更新灵晶']),
          },
        },
      },
    ];
  }

  async function getStoredPayload() {
    const cached = getStoredConfig();
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      return cached;
    }

    const local = safeReadJson(helpDiyFile, null);
    if (local && typeof local === 'object' && !Array.isArray(local)) {
      return local;
    }

    const legacy = safeReadJson(legacyHelpDiyFile, null);
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      await setStoredConfig(legacy);
      return legacy;
    }

    return null;
  }

  async function buildPayload() {
    const defaults = getDefaultPayload();
    let payload = await getStoredPayload();

    if (!payload) {
      payload = {
        ...defaults,
        updatedAt: new Date().toISOString(),
      };
      await setStoredConfig(payload);
    }

    return {
      ...defaults,
      ...payload,
      home: normalizeBlock(payload?.home, defaults.home.text),
      categories: {
        ai: normalizeBlock(payload?.categories?.ai, defaults.categories.ai.text),
        manage: normalizeBlock(payload?.categories?.manage, defaults.categories.manage.text),
        fun: normalizeBlock(payload?.categories?.fun, defaults.categories.fun.text),
        debug: normalizeBlock(payload?.categories?.debug, defaults.categories.debug.text),
      },
    };
  }

  function sanitizeHistoryNote(value = '') {
    return replaceControlCharacters(value, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function buildHistoryPayload() {
    const items = safeReadJson(historyFile, null);
    if (Array.isArray(items)) {
      return items.map(item => ({
        ...item,
        note: sanitizeHistoryNote(item?.note),
      }));
    }
    safeWriteJson(historyFile, []);
    return [];
  }

  function pushHistorySnapshot(payload = {}, note = '') {
    const current = buildHistoryPayload();
    const next = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        savedAt: new Date().toISOString(),
        note: sanitizeHistoryNote(note),
        payload,
      },
      ...current,
    ].slice(0, 20);
    safeWriteJson(historyFile, next);
    return next;
  }

  function deleteHistoryItem(id = '') {
    const current = buildHistoryPayload();
    const next = current.filter(item => item?.id !== String(id || '').trim());
    safeWriteJson(historyFile, next);
    return next;
  }

  function clearHistory() {
    safeWriteJson(historyFile, []);
    return [];
  }

  async function savePayload(payload = {}) {
    const current = await buildPayload();
    const next = {
      ...current,
      enabled: payload.enabled === true,
      updatedAt: new Date().toISOString(),
      home: normalizeBlock(payload.home, current.home.text),
      categories: {
        ai: normalizeBlock(payload?.categories?.ai, current.categories.ai.text),
        manage: normalizeBlock(payload?.categories?.manage, current.categories.manage.text),
        fun: normalizeBlock(payload?.categories?.fun, current.categories.fun.text),
        debug: normalizeBlock(payload?.categories?.debug, current.categories.debug.text),
      },
    };
    await setStoredConfig(next);
    pushHistorySnapshot(next, payload?.historyNote);
    return next;
  }

  async function buildImportPreviewPayload(payload = {}) {
    const current = await buildPayload();
    const next = {
      enabled: payload.enabled === true,
      home: normalizeBlock(payload.home, ''),
      categories: {
        ai: normalizeBlock(payload?.categories?.ai, ''),
        manage: normalizeBlock(payload?.categories?.manage, ''),
        fun: normalizeBlock(payload?.categories?.fun, ''),
        debug: normalizeBlock(payload?.categories?.debug, ''),
      },
    };

    const changes = [];
    if (current.enabled !== next.enabled) changes.push('帮助自定义开关已变更');
    if (JSON.stringify(current.home || {}) !== JSON.stringify(next.home || {})) changes.push('首页帮助内容已变更');
    for (const key of ['ai', 'manage', 'fun', 'debug']) {
      if (JSON.stringify(current.categories?.[key] || {}) !== JSON.stringify(next.categories?.[key] || {})) {
        changes.push(`分类帮助内容已变更: ${key}`);
      }
    }

    return {
      success: true,
      changedCount: changes.length,
      changes,
      next,
    };
  }

  return {
    getTemplates,
    buildPayload,
    buildHistoryPayload,
    deleteHistoryItem,
    clearHistory,
    buildImportPreviewPayload,
    saveImage,
    deleteImage,
    savePayload,
  };
}
