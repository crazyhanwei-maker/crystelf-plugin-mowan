const helpDiyState = {
  payload: null,
  activePreview: 'home',
  templates: [],
  lastSavedPayload: null,
  history: [],
  miaoLive: { seq: 0, timer: null, rendering: false, dataUrl: '', lastText: '', lastError: '', pendingAfterRender: null },
  artdIcons: null,
  undo: { entries: [], index: -1, timer: null, restoring: false },
  collapsedGroups: {},
  drag: null,
  saving: false,
};

const HELP_DIY_LOCAL_IMAGE_PREFIX = '/uploads/help-diy/';
const HELP_DIY_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const HELP_HTML_SECTION_ICONS = {
  'AI 对话': '🤖',
  '群管理': '🛡️',
  '内容娱乐': '🎵',
  '调试排查': '🔧',
  '触发方式': '💬',
  '会话命令': '🧩',
  '用户数据': '👤',
  '能力': '✨',
  '群管理开关': '⚙️',
  '入群验证': '🛡️',
  '入群欢迎': '👋',
  '群运营': '📋',
  '日常互动': '☀️',
  '点歌': '🎵',
  'RSS 订阅': '📡',
  '控制台功能': '🖥️',
  '群内排查命令': '🧪',
};

const HELP_HTML_HEADER_CHIPS = {
  home: ['智能对话 🔥', '联网搜索 🌐', '多模态理解 🖼️', '语音回复 🎧'],
  ai: ['即问即答 💬', '联网搜索 🌐', '图片理解 🖼️', '表情语音 🎧'],
  manage: ['入群验证 🛡️', '欢迎文案 👋', '群总结 📋', '头衔申请 🎖️'],
  fun: ['每日早报 ☀️', '在线点歌 🎵', 'RSS 订阅 📡', '互动回应 💬'],
  debug: ['日志排查 🧪', '依赖修复 🔧', '在线更新 ⬆️', '网页控制台 🖥️'],
};

function buildHelpHtmlDocument({ badge, title, subtitle, intro, sections, notes, chips }) {
  const chipsHtml = (chips || []).map(chip => `<span class="chip">${chip}</span>`).join('');
  const sectionHtml = (sections || []).map(section => {
    const icon = HELP_HTML_SECTION_ICONS[section.name] || '▸';
    return `
      <div class="sec">
        <div class="sec-title"><span class="sec-bar"></span><span class="sec-icon">${icon}</span><span class="sec-name">${section.name}</span></div>
        <div class="cmd-grid">
          ${(section.items || []).map(item => `
          <div class="cmd">
            <div class="cmd-name">${item.cmd}</div>
            ${item.desc ? `<div class="cmd-desc">${item.desc}</div>` : ''}
          </div>`).join('')}
        </div>
      </div>`;
  }).join('');
  const noteHtml = (notes || []).map(note => `<div class="note">${note}</div>`).join('');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 720px;
    padding: 26px;
    background:
      radial-gradient(circle at 12% 0%, rgba(56, 189, 248, 0.14), transparent 34%),
      radial-gradient(circle at 88% 6%, rgba(129, 140, 248, 0.12), transparent 30%),
      linear-gradient(180deg, #0b0f1a 0%, #0d1220 100%);
    color: #e6edf6;
    font-family: 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif;
  }
  .hero {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 22px 24px;
    border-radius: 20px;
    background: linear-gradient(135deg, rgba(23, 32, 53, 0.92), rgba(15, 20, 34, 0.88));
    border: 1px solid rgba(94, 234, 212, 0.14);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    position: relative;
  }
  .hero::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, #38bdf8, #818cf8, transparent);
  }
  /* 想用自定义形象图：把下面 avatar 这个 div 整体换成
     <img class="avatar" src="你的图片地址" /> 即可（支持 http 链接） */
  .avatar {
    width: 104px;
    height: 104px;
    flex: none;
    border-radius: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 46px;
    background:
      radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.28), transparent 42%),
      linear-gradient(135deg, #0ea5e9, #6366f1 60%, #8b5cf6);
    box-shadow: 0 12px 30px rgba(56, 189, 248, 0.35);
    object-fit: cover;
  }
  .hero-main { flex: 1; min-width: 0; }
  .subtitle { flex: none; align-self: flex-end; color: #5b6b82; font-size: 10px; letter-spacing: 0.14em; }
  .hero-eyebrow {
    color: #5eead4;
    font-size: 10px;
    letter-spacing: 0.4em;
    font-weight: 700;
    margin-bottom: 5px;
  }
  h1 {
    font-size: 27px;
    font-weight: 800;
    color: #f4f7fc;
    letter-spacing: 0.03em;
    margin-bottom: 8px;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    padding: 4px 11px;
    border-radius: 999px;
    background: rgba(56, 189, 248, 0.1);
    border: 1px solid rgba(56, 189, 248, 0.26);
    color: #9bd7ff;
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
  }
  ${intro ? `
  .intro {
    margin-top: 14px;
    padding: 11px 14px;
    border-radius: 12px;
    background: rgba(56, 189, 248, 0.07);
    border: 1px solid rgba(56, 189, 248, 0.18);
    color: #a5d8ff;
    font-size: 12.5px;
    text-align: center;
  }` : ''}
  .sec {
    margin-top: 18px;
    padding: 16px 18px 14px;
    border-radius: 16px;
    background: rgba(17, 23, 38, 0.72);
    border: 1px solid rgba(94, 114, 155, 0.14);
  }
  .sec-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .sec-bar {
    width: 4px;
    height: 18px;
    border-radius: 99px;
    background: linear-gradient(180deg, #38bdf8, #818cf8);
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
  }
  .sec-icon { font-size: 16px; }
  .sec-name { font-size: 15px; font-weight: 800; color: #eef3fb; letter-spacing: 0.04em; }
  .cmd-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .cmd {
    padding: 9px 12px;
    border-radius: 11px;
    background: rgba(13, 18, 31, 0.85);
    border: 1px solid rgba(94, 114, 155, 0.12);
  }
  .cmd-name { font-size: 13px; font-weight: 700; color: #7dd3fc; word-break: break-all; }
  .cmd-desc { margin-top: 3px; font-size: 11px; color: #8b95a8; }
  ${noteHtml ? `
  .note {
    margin-top: 14px;
    padding: 10px 13px;
    border-radius: 11px;
    background: rgba(250, 204, 21, 0.05);
    border: 1px solid rgba(250, 204, 21, 0.2);
    color: #b7c3d6;
    font-size: 11.5px;
    line-height: 1.7;
  }` : ''}
  .footer {
    margin-top: 16px;
    padding: 12px 16px;
    border-radius: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    background: linear-gradient(90deg, rgba(14, 165, 233, 0.14), rgba(99, 102, 241, 0.12));
    border: 1px solid rgba(94, 234, 212, 0.16);
    font-size: 11.5px;
    color: #9fb3cd;
  }
  .footer .url { color: #7dd3fc; white-space: nowrap; }
</style>
</head>
<body>
  <div class="hero">
    <div class="avatar">🤖</div>
    <div class="hero-main">
      <div class="hero-eyebrow">${badge}</div>
      <h1>${title}</h1>
      <div class="chips">${chipsHtml}</div>
    </div>
    ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
  </div>
  ${intro ? `<div class="intro">${intro}</div>` : ''}
  ${sectionHtml}
  ${noteHtml}
  <div class="footer">
    <span>遇到问题？发送 #灵晶帮助 调试 或联系群管理员</span>
  </div>
</body>
</html>`;
}
function getHelpHtmlTemplate(slot = 'home') {
  const url = window.location.origin;
  const data = {
    home: {
      badge: 'HELP MENU',
      title: '灵晶插件帮助',
      subtitle: 'Crystelf Console · 用户导航',
      intro: '发送分类命令查看完整说明，或直接 @机器人 提问',
      sections: [
        {
          name: 'AI 对话',
          items: [
            { cmd: '#灵晶帮助 AI', desc: '对话、工具、画像与好感' },
            { cmd: '@机器人 + 问题', desc: '直接触发 AI 对话' },
          ],
        },
        {
          name: '群管理',
          items: [
            { cmd: '#灵晶帮助 管理', desc: '验证、欢迎、总结与头衔' },
            { cmd: '#群总结', desc: '生成群聊精华总结' },
          ],
        },
        {
          name: '内容娱乐',
          items: [
            { cmd: '#灵晶帮助 娱乐', desc: '早报、点歌、RSS 与互动' },
            { cmd: '#点歌 歌名', desc: '点一首喜欢的歌' },
          ],
        },
        {
          name: '调试排查',
          items: [
            { cmd: '#灵晶帮助 调试', desc: '控制台、日志与排查入口' },
            { cmd: '#查看会话状态', desc: '查看当前会话运行状态' },
          ],
        },
      ],
      notes: ['群头衔发放：#申请头衔 你的头衔 · RSS 订阅：#rss列表'],
    },
    ai: {
      badge: 'CATEGORY · AI',
      title: 'AI 对话',
      subtitle: 'Crystelf Console · 对话与工具',
      sections: [
        {
          name: '触发方式',
          items: [
            { cmd: '@机器人 + 问题', desc: '群里 @ 即问即答' },
            { cmd: '机器人昵称 + 问题', desc: '叫名字也能触发' },
            { cmd: '私聊直接发送', desc: '私聊无需前缀' },
          ],
        },
        {
          name: '会话命令',
          items: [
            { cmd: '#重置对话 / #重置会话', desc: '清空上下文重新开始' },
            { cmd: '#查看会话状态', desc: '当前会话信息' },
            { cmd: '#查看知识命中', desc: '知识库命中情况' },
            { cmd: '#查看工具调用', desc: '工具调用记录' },
          ],
        },
        {
          name: '用户数据',
          items: [
            { cmd: '#查看好感度', desc: '我的好感度数值' },
            { cmd: '#好感排行', desc: '群内好感排行榜' },
            { cmd: '#查看用户画像', desc: '我的用户画像' },
          ],
        },
        {
          name: '能力',
          items: [
            { cmd: '联网搜索', desc: '实时检索网页信息' },
            { cmd: '网页正文读取', desc: '读取链接内容' },
            { cmd: '多模态图片理解', desc: '发图即可问答' },
            { cmd: '表情包 / 语音回复', desc: '更生动的互动' },
            { cmd: 'HTTP Skills 工具', desc: '可扩展工具调用' },
          ],
        },
      ],
      notes: ['使用前请确认 AI 接口、模型和工具配置可用'],
    },
    manage: {
      badge: 'CATEGORY · MANAGE',
      title: '群管理',
      subtitle: 'Crystelf Console · 验证与运营',
      sections: [
        {
          name: '群管理开关',
          items: [
            { cmd: '#灵晶开启群管理', desc: '开启本群管理功能' },
            { cmd: '#灵晶关闭群管理', desc: '关闭本群管理功能' },
          ],
        },
        {
          name: '入群验证',
          items: [
            { cmd: '#开启验证 / #关闭验证', desc: '入群验证总开关' },
            { cmd: '#切换验证模式', desc: '切换验证方式' },
            { cmd: '#设置验证提示模式开启', desc: '验证提示模式' },
            { cmd: '#设置验证困难模式开启', desc: '提高验证难度' },
            { cmd: '#设置验证次数3', desc: '设置验证次数' },
            { cmd: '#重新验证 @某人', desc: '重新发起验证' },
            { cmd: '#绕过验证 @某人', desc: '跳过指定成员验证' },
          ],
        },
        {
          name: '入群欢迎',
          items: [
            { cmd: '#设置欢迎文案 欢迎词', desc: '自定义欢迎文字' },
            { cmd: '#设置欢迎图片', desc: '自定义欢迎图片' },
            { cmd: '#查看欢迎 / #清除欢迎', desc: '查看或清除欢迎配置' },
          ],
        },
        {
          name: '群运营',
          items: [
            { cmd: '#群总结', desc: '生成群聊精华总结' },
            { cmd: '#申请头衔 你的头衔', desc: '申请专属群头衔' },
            { cmd: '#头衔申请列表', desc: '查看待审批申请' },
            { cmd: '#同意头衔 / #拒绝头衔 编号', desc: '审批头衔申请' },
            { cmd: '#取消头衔申请', desc: '撤回我的申请' },
          ],
        },
      ],
      notes: ['群管理命令通常需要群主或管理员权限', '群头衔发放需要机器人具备对应群权限'],
    },
    fun: {
      badge: 'CATEGORY · FUN',
      title: '内容娱乐',
      subtitle: 'Crystelf Console · 日常互动',
      sections: [
        {
          name: '日常互动',
          items: [
            { cmd: '60s / 早报', desc: '每日新闻早报' },
            { cmd: '早安 / 晚安', desc: '日常问候互动' },
            { cmd: '戳一戳机器人', desc: '戳一下有惊喜' },
            { cmd: '#回应 内容', desc: '让机器人接一句话' },
          ],
        },
        {
          name: '点歌',
          items: [
            { cmd: '#点歌 歌名', desc: '搜索并播放歌曲' },
            { cmd: '#听 歌名', desc: '另一种点歌方式' },
            { cmd: '#听 1', desc: '选第 1 个结果' },
          ],
        },
        {
          name: 'RSS 订阅',
          items: [
            { cmd: '#rss添加 订阅地址', desc: '添加 RSS 订阅' },
            { cmd: '#rss列表', desc: '查看订阅列表' },
            { cmd: '#rss移除0', desc: '按编号移除订阅' },
            { cmd: '#rss拉取 订阅地址', desc: '手动拉取一次' },
          ],
        },
      ],
      notes: ['RSS 和点歌需要对应功能开关启用'],
    },
    debug: {
      badge: 'CATEGORY · DEBUG',
      title: '调试排查',
      subtitle: 'Crystelf Console · 运维入口',
      intro: '控制台功能需在网页端使用，入口请联系管理员获取',
      sections: [
        {
          name: '控制台功能',
          items: [
            { cmd: '配置管理', desc: '插件与功能配置可视化编辑' },
            { cmd: '日志与会话', desc: '日志、会话、画像、好感与用量' },
            { cmd: '运维工具', desc: '图片监控、群管理、Help DIY、Skills' },
          ],
        },
        {
          name: '群内排查命令',
          items: [
            { cmd: '#查看会话状态', desc: '会话运行状态' },
            { cmd: '#查看知识命中', desc: '知识库命中情况' },
            { cmd: '#查看工具调用', desc: '工具调用记录' },
            { cmd: '#灵晶排查日志', desc: '自动分析近期日志' },
            { cmd: '#灵晶修复依赖', desc: '修复缺失的依赖' },
            { cmd: '#灵晶修复依赖状态', desc: '查看修复进度' },
            { cmd: '#更新灵晶', desc: '更新到最新版本' },
            { cmd: '#强制更新灵晶', desc: '强制重新拉取更新' },
          ],
        },
      ],
      notes: ['接口异常先看控制台日志和 AI 用量日志', '外网控制台务必设置强口令并限制访问来源'],
    },
  }[slot] || null;
  if (!data) return '';
  return buildHelpHtmlDocument({ ...data, chips: HELP_HTML_HEADER_CHIPS[slot] || [] });
}

const { fetchJson, postJson } = window.CrystelfRequest;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function isLocalHelpDiyImage(value = '') {
  return String(value || '').trim().startsWith(HELP_DIY_LOCAL_IMAGE_PREFIX);
}

function normalizeHelpDiyBlock(block = {}, fallbackText = '') {
  if (typeof block === 'string') {
    return { mode: 'text', text: block || fallbackText || '', image: '' };
  }
  const image = String(block?.image || '').trim();
  const text = String(block?.text || fallbackText || '').trim();
  let mode = ['image', 'miao'].includes(block?.mode) ? block.mode : 'text';
  if (mode === 'miao' && !text) {
    mode = image ? 'image' : 'text';
  }
  return { mode, text, image };
}

function normalizeHelpDiyPayload(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    ...source,
    enabled: source.enabled === true,
    miaoStyle: normalizeMiaoStyleFront(source.miaoStyle),
    home: normalizeHelpDiyBlock(source.home),
    categories: {
      ai: normalizeHelpDiyBlock(source.categories?.ai),
      manage: normalizeHelpDiyBlock(source.categories?.manage),
      fun: normalizeHelpDiyBlock(source.categories?.fun),
      debug: normalizeHelpDiyBlock(source.categories?.debug),
    },
  };
}

function getDraft() {
  return {
    enabled: document.getElementById('help-diy-enabled').checked,
    miaoStyle: normalizeMiaoStyleFront(helpDiyState.miaoStyle),
    home: {
      mode: document.getElementById('help-diy-home-mode').value,
      text: document.getElementById('help-diy-home').value,
      image: document.getElementById('help-diy-home-image').value,
    },
    categories: {
      ai: {
        mode: document.getElementById('help-diy-ai-mode').value,
        text: document.getElementById('help-diy-ai').value,
        image: document.getElementById('help-diy-ai-image').value,
      },
      manage: {
        mode: document.getElementById('help-diy-manage-mode').value,
        text: document.getElementById('help-diy-manage').value,
        image: document.getElementById('help-diy-manage-image').value,
      },
      fun: {
        mode: document.getElementById('help-diy-fun-mode').value,
        text: document.getElementById('help-diy-fun').value,
        image: document.getElementById('help-diy-fun-image').value,
      },
      debug: {
        mode: document.getElementById('help-diy-debug-mode').value,
        text: document.getElementById('help-diy-debug').value,
        image: document.getElementById('help-diy-debug-image').value,
      },
    },
  };
}

function sanitizeComparablePayload(payload = {}) {
  const normalized = normalizeHelpDiyPayload(payload);
  return {
    enabled: normalized.enabled === true,
    miaoStyle: normalized.miaoStyle,
    home: {
      mode: normalized.home.mode || 'text',
      text: normalized.home.text || '',
      image: normalized.home.image || '',
    },
    categories: {
      ai: {
        mode: normalized.categories.ai.mode || 'text',
        text: normalized.categories.ai.text || '',
        image: normalized.categories.ai.image || '',
      },
      manage: {
        mode: normalized.categories.manage.mode || 'text',
        text: normalized.categories.manage.text || '',
        image: normalized.categories.manage.image || '',
      },
      fun: {
        mode: normalized.categories.fun.mode || 'text',
        text: normalized.categories.fun.text || '',
        image: normalized.categories.fun.image || '',
      },
      debug: {
        mode: normalized.categories.debug.mode || 'text',
        text: normalized.categories.debug.text || '',
        image: normalized.categories.debug.image || '',
      },
    },
  };
}

function normalizeForCompare(payload = {}) {
  return JSON.stringify(sanitizeComparablePayload(payload));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function incompleteHelpField(draft = getDraft()) {
  const names = { home: '总帮助', ai: 'AI 分类', manage: '管理分类', fun: '娱乐分类', debug: '调试分类' };
  for (const [slot, name] of Object.entries(names)) {
    const block = slot === 'home' ? draft.home : draft.categories[slot];
    if (block.mode !== 'miao') continue;
    const struct = ensureMiaoEditorStruct(slot).struct;
    if (!struct.title.trim()) return `请填写${name}的卡片标题。`;
    for (const [gi, group] of struct.groups.entries()) {
      if (!group.group.trim()) return `请填写${name}第 ${gi + 1} 个分组的标题。`;
      if (group.items.some(item => !item.title.trim())) return `请填写${name}第 ${gi + 1} 个分组中的空命令，或删除该行。`;
    }
  }
  return '';
}

function hasUnsavedChanges() {
  if (!helpDiyState.lastSavedPayload) return false;
  const draft = getDraft();
  return !!incompleteHelpField(draft) || normalizeForCompare(draft) !== normalizeForCompare(helpDiyState.lastSavedPayload);
}

function renderDirtyStatus(message = '') {
  const element = document.getElementById('help-diy-dirty-status');
  if (!element) return;
  const dirty = hasUnsavedChanges();
  element.textContent = message || (dirty ? '有未保存修改' : '已保存');
  element.classList.toggle('is-dirty', dirty);
  const saveButton = document.getElementById('help-diy-save-btn');
  if (saveButton) saveButton.disabled = helpDiyState.saving || !helpDiyState.lastSavedPayload;
  syncUndoButtons();
}

function syncHelpDiyModeControls() {
  ['home', 'ai', 'manage', 'fun', 'debug'].forEach(slot => {
    const modeSelect = document.getElementById(`help-diy-${slot}-mode`);
    const toolbar = modeSelect?.closest('.help-diy-mode-toolbar');
    const textInput = document.getElementById(`help-diy-${slot}`);
    const imageMode = modeSelect?.value === 'image';
    const miaoMode = modeSelect?.value === 'miao';
    toolbar?.classList.toggle('is-image-mode', imageMode || miaoMode);
    toolbar?.classList.toggle('is-text-mode', !imageMode && !miaoMode);
    textInput?.classList.toggle('is-image-mode', imageMode);
    syncHelpDiyMiaoEditorVisibility(slot);
    const description = document.querySelector(`[data-help-mode-description="${slot}"]`);
    if (description) description.textContent = miaoMode
      ? '保存后，机器人按当前内容与全局外观动态生成帮助卡片。'
      : imageMode ? '保存后发送这张固定图片，内容或外观变化需要重新生成。'
      : '保存后直接发送下方文字；也可以将文字生成固定图片。';
  });
}

function previewBlock() {
  const draft = getDraft();
  return helpDiyState.activePreview === 'home' ? draft.home : draft.categories[helpDiyState.activePreview];
}

function previewFingerprint(slot, text, style) {
  return JSON.stringify([slot, String(text || '').trim(), style]);
}

function renderPreview() {
  syncHelpDiyModeControls();
  const current = previewBlock();
  const shell = document.getElementById('help-diy-preview-shell');
  const text = document.getElementById('help-diy-preview');
  const wrap = document.getElementById('help-diy-image-preview-wrap');
  const image = document.getElementById('help-diy-image-preview');
  shell.classList.toggle('is-image-mode', current.mode !== 'text');
  shell.classList.toggle('is-image-empty', current.mode === 'image' && !isLocalHelpDiyImage(current.image));
  let src = '';
  if (current.mode === 'miao') {
    const live = helpDiyState.miaoLive;
    scheduleMiaoLivePreview(helpDiyState.activePreview, current.text);
    src = live.dataUrl;
    const ready = live.lastText === live.targetFingerprint && !!src;
    text.textContent = !current.text.trim() ? '填写内容后显示帮助卡片。'
      : live.lastError ? `渲染失败：${live.lastError}。修改内容或点击重新渲染重试。`
      : ready ? '当前草稿预览 · 保存后生效' : '正在更新预览，当前图片为上一次结果…';
    document.getElementById('help-diy-preview-shell').setAttribute('aria-busy', String(!ready && !live.lastError && !!current.text.trim()));
  } else {
    const live = helpDiyState.miaoLive;
    if (live.timer) clearTimeout(live.timer);
    live.timer = null;
    live.pendingAfterRender = null;
    live.targetFingerprint = '';
    text.textContent = current.mode === 'image' ? '固定图片预览 · 保存后生效' : current.text || '暂无内容';
    if (current.mode === 'image' && isLocalHelpDiyImage(current.image)) src = current.image;
    shell.setAttribute('aria-busy', 'false');
  }
  if (src) {
    if (image.getAttribute('src') !== src) image.src = src;
  } else image.removeAttribute('src');
  wrap.classList.toggle('hidden', !src);
  syncPreviewTools();
}

function scheduleMiaoLivePreview(slot = '', text = '', force = false) {
  const live = helpDiyState.miaoLive;
  const body = String(text || '').trim();
  const style = normalizeMiaoStyleFront(helpDiyState.miaoStyle);
  const fingerprint = previewFingerprint(slot, body, style);
  if (!force && live.targetFingerprint === fingerprint) return;
  live.targetFingerprint = fingerprint;
  live.lastError = '';
  if (live.timer) clearTimeout(live.timer);
  if (!body) {
    live.dataUrl = '';
    live.lastText = '';
    live.pendingAfterRender = null;
    live.timer = null;
    return;
  }
  const request = { slot, text: body, style, fingerprint };
  live.timer = setTimeout(() => {
    live.timer = null;
    requestMiaoPreview(request);
  }, force ? 0 : 600);
}

async function requestMiaoPreview(request) {
  const live = helpDiyState.miaoLive;
  if (request.fingerprint !== live.targetFingerprint) return;
  if (live.rendering) {
    live.pendingAfterRender = request;
    return;
  }
  live.rendering = true;
  try {
    const result = await postJson('/api/help-diy/preview-miao-image', { slot: request.slot, text: request.text, style: request.style });
    if (request.fingerprint === live.targetFingerprint) {
      live.dataUrl = result.dataUrl || '';
      live.lastText = request.fingerprint;
      live.lastError = '';
    }
  } catch (error) {
    if (request.fingerprint === live.targetFingerprint) live.lastError = error.message || '未知错误';
  } finally {
    live.rendering = false;
    renderPreview();
    const pending = live.pendingAfterRender;
    live.pendingAfterRender = null;
    if (pending) requestMiaoPreview(pending);
  }
}

function syncPreviewTools() {
  const image = document.getElementById('help-diy-image-preview');
  const src = image.getAttribute('src') || '';
  const live = helpDiyState.miaoLive;
  const ready = !!src && (previewBlock().mode !== 'miao' || live.lastText === live.targetFingerprint);
  const link = document.getElementById('help-diy-preview-download');
  link.setAttribute('aria-disabled', String(!ready));
  link.tabIndex = ready ? 0 : -1;
  if (ready) {
    link.href = src;
    const extension = src.startsWith('data:image/jpeg') || /\.jpe?g$/i.test(src) ? 'jpg' : /\.webp$/i.test(src) ? 'webp' : 'png';
    link.download = `帮助-${helpDiyState.activePreview}.${extension}`;
  } else link.removeAttribute('href');
  document.getElementById('help-diy-preview-expand').disabled = !src;
  const retry = document.getElementById('help-diy-preview-retry');
  if (retry) retry.classList.toggle('hidden', previewBlock().mode !== 'miao');
  document.getElementById('help-diy-preview-zoom').disabled = !src;
  document.getElementById('help-diy-preview-size').textContent = src && image.complete && image.naturalWidth
    ? `${image.naturalWidth} × ${image.naturalHeight} px` : '';
  applyPreviewZoom(image, document.getElementById('help-diy-preview-zoom').value);
}

function applyPreviewZoom(image, zoom = 'fit') {
  image.style.width = zoom === 'fit' ? '100%' : `${image.naturalWidth * Number(zoom)}px`;
  image.style.maxWidth = zoom === 'fit' ? '100%' : 'none';
  image.closest('.help-diy-image-preview-stage, #help-diy-dialog-stage')?.classList.toggle('is-original-size', zoom !== 'fit');
}

function bindPreviewTools() {
  const image = document.getElementById('help-diy-image-preview');
  const dialog = document.getElementById('help-diy-preview-dialog');
  const expanded = document.getElementById('help-diy-dialog-image');
  const open = () => {
    if (!image.getAttribute('src')) return;
    expanded.src = image.src;
    document.getElementById('help-diy-dialog-zoom').value = 'fit';
    applyPreviewZoom(expanded, 'fit');
    if (!dialog.open) dialog.showModal();
  };
  image.addEventListener('load', syncPreviewTools);
  document.getElementById('help-diy-preview-retry')?.addEventListener('click', () => {
    const current = previewBlock();
    if (current.mode === 'miao') { scheduleMiaoLivePreview(helpDiyState.activePreview, current.text, true); renderPreview(); }
  });
  image.addEventListener('click', open);
  image.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
  });
  document.getElementById('help-diy-preview-expand').addEventListener('click', open);
  document.getElementById('help-diy-preview-close').addEventListener('click', () => dialog.close());
  document.getElementById('help-diy-preview-zoom').addEventListener('change', event => applyPreviewZoom(image, event.target.value));
  document.getElementById('help-diy-dialog-zoom').addEventListener('change', event => applyPreviewZoom(expanded, event.target.value));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}

function syncUndoButtons() {
  const { entries, index } = helpDiyState.undo;
  const undo = document.getElementById('help-diy-undo-btn');
  const redo = document.getElementById('help-diy-redo-btn');
  if (undo) undo.disabled = index <= 0;
  if (redo) redo.disabled = index >= entries.length - 1;
}

function captureDraftSnapshot() {
  const draft = JSON.parse(JSON.stringify(getDraft()));
  draft.__editorDrafts = Object.fromEntries(['home', 'ai', 'manage', 'fun', 'debug'].map(slot => {
    const block = slot === 'home' ? draft.home : draft.categories[slot];
    const editor = helpDiyState.miaoEditors?.[slot];
    return [slot, JSON.parse(JSON.stringify(editor && editor.sourceText === block?.text
      ? editor.struct : parseMiaoTextToStruct(block?.text || '')))];
  }));
  return draft;
}

function recordDraft() {
  const history = helpDiyState.undo;
  if (history.restoring || !helpDiyState.lastSavedPayload) return;
  clearTimeout(history.timer);
  history.timer = null;
  const draft = captureDraftSnapshot();
  if (history.index >= 0 && JSON.stringify(history.entries[history.index]) === JSON.stringify(draft)) return;
  history.entries.splice(history.index + 1);
  history.entries.push(draft);
  if (history.entries.length > 60) history.entries.shift();
  history.index = history.entries.length - 1;
  syncUndoButtons();
}

function queueDraftHistory() {
  clearTimeout(helpDiyState.undo.timer);
  helpDiyState.undo.timer = setTimeout(recordDraft, 400);
}

function restoreDraftHistory(direction) {
  recordDraft();
  const history = helpDiyState.undo;
  const index = history.index + direction;
  if (index < 0 || index >= history.entries.length) return;
  history.index = index;
  history.restoring = true;
  const { __editorDrafts, ...payload } = history.entries[index];
  render(payload, { markAsSaved: false, recordHistory: false, editorDrafts: __editorDrafts, preserveDraft: true });
  history.restoring = false;
  syncUndoButtons();
  document.getElementById('help-diy-status').textContent = direction < 0 ? '已撤销上一步。' : '已重做。';
}

//——————喵喵卡片结构化编辑器（所见即所得：分组/命令/描述/图标）——————

const MIAO_ICON_SPRITE_URL = '/assets/miao-icon.png';
const MIAO_ICON_COUNT = 40;
const MIAO_STYLE_FRONT_DEFAULTS = {
  subtitle: '魔丸插件 · 发送 #灵晶帮助 查看帮助',
  titleColor: '#000000',
  subtitleColor: '#000000',
  groupColor: '#ceb78b',
  descColor: '#eeeeee',
  titleAlign: 'left',
  subtitleAlign: 'left',
  themeImage: '',
  bodyImage: '',
  colCount: 5,
  fontScale: 1,
};

function normalizeMiaoStyleFront(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const color = (value, fallback) => (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value || '').trim()) ? String(value).trim() : fallback);
  const image = value => {
    const raw = String(value || '').trim();
    const parts = raw.slice(HELP_DIY_LOCAL_IMAGE_PREFIX.length).split('/');
    return isLocalHelpDiyImage(raw) && !/[\\%?#:\u0000-\u0020\u007f]/.test(raw)
      && parts.every(part => part && part !== '.' && part !== '..') && /\.(png|jpe?g|webp|gif)$/i.test(raw) ? raw : '';
  };
  const choice = (value, values, fallback) => ['number', 'string'].includes(typeof value) && values.includes(Number(value)) ? Number(value) : fallback;
  const align = (value, fallback) => (['left', 'center', 'right'].includes(String(value || '').trim().toLowerCase()) ? String(value).trim().toLowerCase() : fallback);
  return {
    subtitle: String(source.subtitle ?? MIAO_STYLE_FRONT_DEFAULTS.subtitle).replace(/\s+/g, ' ').trim().slice(0, 120) || MIAO_STYLE_FRONT_DEFAULTS.subtitle,
    titleColor: color(source.titleColor, MIAO_STYLE_FRONT_DEFAULTS.titleColor),
    subtitleColor: color(source.subtitleColor, MIAO_STYLE_FRONT_DEFAULTS.subtitleColor),
    groupColor: color(source.groupColor, MIAO_STYLE_FRONT_DEFAULTS.groupColor),
    descColor: color(source.descColor, MIAO_STYLE_FRONT_DEFAULTS.descColor),
    titleAlign: align(source.titleAlign, MIAO_STYLE_FRONT_DEFAULTS.titleAlign),
    subtitleAlign: align(source.subtitleAlign, MIAO_STYLE_FRONT_DEFAULTS.subtitleAlign),
    themeImage: image(source.themeImage),
    bodyImage: image(source.bodyImage),
    colCount: choice(source.colCount, [2, 3, 4, 5], 5),
    fontScale: choice(source.fontScale, [.85, 1, 1.15, 1.3], 1),
  };
}

function escapeMiaoAttr(value = '') {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

//前端版解析：与后端 parseHelpText 对齐，[icon:N] 前缀 → icon 显式值
function parseMiaoTextToStruct(text = '') {
  const lines = String(text || '').split(/\r?\n/);
  const struct = { title: '', groups: [] };
  let current = null;
  let itemIndex = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[━─═=—\-]{3,}$/.test(line)) continue;
    const itemMatch = rawLine.trimStart().match(/^[-•*]\s+(.+)$/);
    if (!itemMatch) {
      if (!struct.title && struct.groups.length === 0 && current === null) {
        struct.title = line;
      } else {
        current = { group: line, items: [] };
        struct.groups.push(current);
      }
      continue;
    }
    if (!current) {
      current = { group: '命令', items: [] };
      struct.groups.push(current);
    }
    let rest = itemMatch[1];
    let icon = null;
    const iconTagMatch = rest.match(/^\[(icon:(\d{1,3})|artd:([^\]\s]+))\]\s*/i);
    if (iconTagMatch) {
      if (iconTagMatch[2]) {
        icon = Math.min(Math.max(parseInt(iconTagMatch[2], 10) || 0, 1), MIAO_ICON_COUNT);
      } else if (iconTagMatch[3]) {
        icon = `artd:${iconTagMatch[3]}`;
      }
      rest = rest.slice(iconTagMatch[0].length);
    }
    itemIndex += 1;
    let title = rest;
    let desc = '';
    const multiSpace = rest.match(/^(.*?\S)[ \t]{2,}(.*)$/);
    if (multiSpace) {
      title = multiSpace[1].trim();
      desc = multiSpace[2].trim();
    } else {
      const singleSpace = rest.match(/^(\S+)\s+(\S.*)$/);
      if (singleSpace && /^[#@*%~-]/.test(singleSpace[1])) {
        title = singleSpace[1];
        desc = singleSpace[2].trim();
      }
    }
    if (!title) continue;
    current.items.push({ icon, title, desc });
  }
  if (!struct.groups.length) {
    struct.groups.push({ group: '命令', items: [] });
  }
  return struct;
}

function flattenMiaoSpaces(value = '') {
  return String(value ?? '').replace(/\s{2,}/g, ' ').trim();
}

function serializeMiaoText(struct = {}) {
  const lines = [];
  lines.push(flattenMiaoSpaces(struct.title) || '灵晶帮助');
  lines.push('━━━━━━━━━━━━');
  for (const group of struct.groups || []) {
    lines.push('');
    lines.push(flattenMiaoSpaces(group.group) || '分组');
    for (const item of group.items || []) {
      const title = flattenMiaoSpaces(item.title);
      if (!title) continue;
      const desc = flattenMiaoSpaces(item.desc);
      const iconTag = typeof item.icon === 'string' && item.icon.startsWith('artd:')
        ? `[${item.icon}] `
        : Number(item.icon) > 0 ? `[icon:${Math.floor(Number(item.icon))}] ` : '';
      lines.push(`- ${iconTag}${title}  ${desc}`);
    }
  }
  lines.push('━━━━━━━━━━━━');
  return lines.join('\n');
}

function miaoItemIconCss(icon) {
  const num = Number(icon) || 1;
  const x = (num - 1) % 10;
  const y = (num - x - 1) / 10;
  return `background-position:-${x * 50}px -${y * 50}px`;
}

//条目图标统一渲染：artd:slug → 内联 SVG；数字 → 雪碧图；null → 按自动序号显示（半透明）
function miaoItemIconHtml(icon, autoIndex = 1) {
  if (typeof icon === 'string' && icon.startsWith('artd:')) {
    const item = (helpDiyState.artdIcons || []).find(i => `artd:${i.slug}` === icon);
    return `<span class="miao-item-icon-artd">${item ? item.svg : ''}</span>`;
  }
  const auto = Number(icon) > 0;
  const num = auto ? Number(icon) : (Number(autoIndex) || 1);
  return `<span class="miao-item-icon-img" style="${miaoItemIconCss(num)}${auto ? '' : ';opacity:.55'}"></span>`;
}

async function ensureArtdIcons() {
  if (helpDiyState.artdIcons) return helpDiyState.artdIcons;
  const result = await fetchJson('/api/help-diy/miao-artd-icons');
  helpDiyState.artdIcons = window.HelpDiyIcons.enrich(result?.items || []);
  for (const slot of ['home', 'ai', 'manage', 'fun', 'debug']) {
    const container = document.getElementById(`help-diy-${slot}-miao-editor`);
    if (container?.dataset.rendered === '1' && !container.contains(document.activeElement)) renderMiaoEditor(slot);
  }
  return helpDiyState.artdIcons;
}

function ensureMiaoEditorStruct(slot = '') {
  helpDiyState.miaoEditors = helpDiyState.miaoEditors || {};
  const textarea = document.getElementById(`help-diy-${slot}`);
  const currentText = textarea?.value || '';
  let editor = helpDiyState.miaoEditors[slot];
  //textarea 文本被外部改动（载入/恢复/导入）时重新解析
  if (!editor || editor.sourceText !== currentText) {
    editor = { sourceText: currentText, struct: parseMiaoTextToStruct(currentText) };
    helpDiyState.miaoEditors[slot] = editor;
  }
  return editor;
}

function commitMiaoEditor(slot = '') {
  const editor = helpDiyState.miaoEditors?.[slot];
  const textarea = document.getElementById(`help-diy-${slot}`);
  if (!editor || !textarea) return;
  const text = serializeMiaoText(editor.struct);
  if (text !== textarea.value) {
    textarea.value = text;
    editor.sourceText = text;
  }
  const container = document.getElementById(`help-diy-${slot}-miao-editor`);
  if (container) container.dataset.structSource = text;
  renderPreview();
  renderDirtyStatus();
}

function miaoEditorActionIcon(name) {
  const paths = {
    up: '<path d="m6 10 6-6 6 6M12 4v16"/>',
    down: '<path d="m6 14 6 6 6-6M12 20V4"/>',
    delete: '<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    collapse: '<path d="m6 9 6 6 6-6"/>',
    drag: '<path d="M8 5h1m6 0h1M8 12h1m6 0h1M8 19h1m6 0h1"/>',
    upload: '<path d="m7 8 5-5 5 5M12 3v12M4 15v5h16v-5"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function renderMiaoEditor(slot = '') {
  const container = document.getElementById(`help-diy-${slot}-miao-editor`);
  if (!container) return;
  const editor = ensureMiaoEditorStruct(slot);
  const struct = editor.struct;
  const slotName = { home: '总帮助', ai: 'AI 分类', manage: '管理分类', fun: '娱乐分类', debug: '调试分类' }[slot] || slot;
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', `${slotName}卡片编辑器`);
  container.dataset.structSource = editor.sourceText;
  container.dataset.rendered = '1';

  const groupHtml = struct.groups.map((group, groupIdx) => {
    const groupItems = group.items || [];
    const items = groupItems.map((item, itemIdx) => `
      <div class="miao-editor-item" data-gi="${groupIdx}" data-ii="${itemIdx}" data-miao-drop-item="${groupIdx}:${itemIdx}">
        <button type="button" class="miao-item-icon" data-miao-pick-icon="${groupIdx}:${itemIdx}" data-current-icon="${escapeMiaoAttr(String(item.icon || ''))}" aria-label="选择第 ${itemIdx + 1} 条命令图标" title="点击选择图标${item.icon ? `（当前 ${typeof item.icon === 'string' ? item.icon.replace('artd:', 'ART PRO ') : `icon:${item.icon}`}）` : '（自动分配）'}">
          ${miaoItemIconHtml(item.icon, (itemIdx % 40) + 1)}
        </button>
        <input type="text" class="miao-item-title" data-miao-field="title-item" data-gi="${groupIdx}" data-ii="${itemIdx}" value="${escapeMiaoAttr(item.title)}" aria-label="第 ${itemIdx + 1} 条命令" placeholder="命令，如 #点歌 歌名" />
        <input type="text" class="miao-item-desc" data-miao-field="desc" data-gi="${groupIdx}" data-ii="${itemIdx}" value="${escapeMiaoAttr(item.desc)}" aria-label="第 ${itemIdx + 1} 条描述" placeholder="描述（可留空）" />
        <span class="miao-item-ops">
          <button type="button" class="mini-btn miao-action-btn miao-drag-handle" draggable="true" data-miao-drag-item="${groupIdx}:${itemIdx}" aria-label="拖动第 ${itemIdx + 1} 条命令排序" title="拖动排序">${miaoEditorActionIcon('drag')}</button>
          <button type="button" class="mini-btn miao-action-btn" data-miao-item-copy="${groupIdx}:${itemIdx}" title="复制命令" aria-label="复制第 ${itemIdx + 1} 条命令">${miaoEditorActionIcon('copy')}</button>
          <button type="button" class="mini-btn miao-action-btn" data-miao-item-up="${groupIdx}:${itemIdx}" title="上移" aria-label="上移第 ${itemIdx + 1} 条命令"${itemIdx === 0 ? ' disabled' : ''}>${miaoEditorActionIcon('up')}</button>
          <button type="button" class="mini-btn miao-action-btn" data-miao-item-down="${groupIdx}:${itemIdx}" title="下移" aria-label="下移第 ${itemIdx + 1} 条命令"${itemIdx === groupItems.length - 1 ? ' disabled' : ''}>${miaoEditorActionIcon('down')}</button>
          <button type="button" class="mini-btn miao-action-btn danger" data-miao-item-del="${groupIdx}:${itemIdx}" title="删除" aria-label="删除第 ${itemIdx + 1} 条命令">${miaoEditorActionIcon('delete')}</button>
        </span>
      </div>`).join('');
    return `
    <div class="miao-editor-group" data-gi="${groupIdx}" role="group" aria-label="第 ${groupIdx + 1} 个命令分组">
      <div class="miao-editor-group-head">
        <button type="button" class="mini-btn miao-action-btn miao-collapse-btn" data-miao-group-collapse="${groupIdx}" aria-label="折叠或展开第 ${groupIdx + 1} 个分组" aria-expanded="${!helpDiyState.collapsedGroups[`${slot}:${groupIdx}`]}">${miaoEditorActionIcon('collapse')}</button>
        <button type="button" class="mini-btn miao-action-btn miao-drag-handle" draggable="true" data-miao-drag-group="${groupIdx}" aria-label="拖动第 ${groupIdx + 1} 个分组排序" title="拖动分组排序">${miaoEditorActionIcon('drag')}</button>
        <span class="miao-group-index" aria-hidden="true">${String(groupIdx + 1).padStart(2, '0')}</span>
        <input type="text" class="miao-group-name" data-miao-field="group" data-gi="${groupIdx}" value="${escapeMiaoAttr(group.group)}" aria-label="第 ${groupIdx + 1} 个分组标题" placeholder="分组标题" />
        <span class="miao-group-count">${groupItems.length} 条</span>
        <span class="miao-group-ops">
          <button type="button" class="mini-btn miao-action-btn" data-miao-group-copy="${groupIdx}" title="复制分组" aria-label="复制第 ${groupIdx + 1} 个分组">${miaoEditorActionIcon('copy')}</button>
          <button type="button" class="mini-btn miao-action-btn" data-miao-group-up="${groupIdx}" title="上移分组" aria-label="上移第 ${groupIdx + 1} 个分组"${groupIdx === 0 ? ' disabled' : ''}>${miaoEditorActionIcon('up')}</button>
          <button type="button" class="mini-btn miao-action-btn" data-miao-group-down="${groupIdx}" title="下移分组" aria-label="下移第 ${groupIdx + 1} 个分组"${groupIdx === struct.groups.length - 1 ? ' disabled' : ''}>${miaoEditorActionIcon('down')}</button>
          <button type="button" class="mini-btn miao-action-btn danger" data-miao-group-del="${groupIdx}" title="删除分组" aria-label="删除第 ${groupIdx + 1} 个分组">${miaoEditorActionIcon('delete')}</button>
        </span>
      </div>
      <div class="miao-group-body${helpDiyState.collapsedGroups[`${slot}:${groupIdx}`] ? ' hidden' : ''}">
      ${groupItems.length ? '<div class="miao-editor-columns" aria-hidden="true"><span>图标</span><span>命令 / 标题</span><span>描述</span><span>操作</span></div>' : ''}
      <div class="miao-editor-items">${items || '<p class="miao-editor-empty">暂无命令，添加一条开始编辑。</p>'}</div>
      <div class="miao-editor-group-foot">
        <button type="button" class="mini-btn miao-add-item-btn" data-miao-item-add="${groupIdx}">${miaoEditorActionIcon('add')}添加命令</button>
      </div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="miao-editor-settings">
      <label class="miao-editor-field"><span class="miao-editor-label">卡片标题</span>
        <input type="text" class="miao-card-title" data-miao-field="title" value="${escapeMiaoAttr(struct.title)}" placeholder="灵晶帮助" />
      </label>
    </div>
    <div class="miao-editor-section-head">
      <div><strong>命令分组</strong><span class="miao-editor-section-meta">${struct.groups.length} 个分组</span></div>
      <button type="button" class="mini-btn miao-add-group-btn" data-miao-group-add>${miaoEditorActionIcon('add')}添加分组</button>
    </div>
    <div class="miao-editor-groups">${groupHtml || '<p class="miao-editor-empty">暂无分组，点击「添加分组」开始编辑。</p>'}</div>`;
}

function syncHelpDiyMiaoEditorVisibility(slot = '') {
  const modeSelect = document.getElementById(`help-diy-${slot}-mode`);
  const textarea = document.getElementById(`help-diy-${slot}`);
  const container = document.getElementById(`help-diy-${slot}-miao-editor`);
  const isMiao = modeSelect?.value === 'miao';
  if (!textarea || !container) return;
  textarea.classList.toggle('hidden', isMiao);
  container.classList.toggle('hidden', !isMiao);
  if (isMiao) {
    const editor = ensureMiaoEditorStruct(slot);
    //只在首次、外部文本变化或结构被程序改动后重渲 DOM；正在输入时不打断
    if (container.dataset.structSource !== editor.sourceText || container.dataset.rendered !== '1') {
      const active = document.activeElement;
      const editing = container.contains(active) && active.matches?.('input');
      if (!editing) {
        renderMiaoEditor(slot);
      }
    }
  } else {
    container.dataset.rendered = '';
  }
}

function renderGlobalStyle() {
  const container = document.getElementById('help-diy-global-style');
  if (!container) return;
  const style = normalizeMiaoStyleFront(helpDiyState.miaoStyle);
  const select = (field, label, values) => `<label class="miao-editor-field"><span class="miao-editor-label">${label}</span><select data-miao-style-field="${field}">${values.map(([value, name]) => `<option value="${value}"${String(style[field]) === String(value) ? ' selected' : ''}>${name}</option>`).join('')}</select></label>`;
  container.innerHTML = `<div class="miao-editor-settings">
    <label class="miao-editor-field"><span class="miao-editor-label">统一副标题</span><input type="text" data-miao-style-field="subtitle" value="${escapeMiaoAttr(style.subtitle)}" maxlength="120" /></label>
    <div class="miao-editor-fields">
      ${select('colCount', '每行列数', [[2,'2 列 · 简洁'],[3,'3 列 · 均衡'],[4,'4 列 · 紧凑'],[5,'5 列 · 默认']])}
      ${select('fontScale', '卡片字号', [[.85,'小 · 85%'],[1,'标准 · 100%'],[1.15,'大 · 115%'],[1.3,'特大 · 130%']])}
      ${select('titleAlign', '标题对齐', [['left','左对齐'],['center','居中'],['right','右对齐']])}
      ${select('subtitleAlign', '副标题对齐', [['left','左对齐'],['center','居中'],['right','右对齐']])}
    </div>
    <div class="help-color-presets" role="group" aria-label="卡片配色预设">
      <span class="miao-editor-label">配色预设</span>
      <button type="button" class="mini-btn" data-help-color-preset="dark">深色背景</button>
      <button type="button" class="mini-btn" data-help-color-preset="light">浅色背景</button>
      <button type="button" class="mini-btn" data-help-color-preset="rose">绯樱</button>
    </div>
    <div class="miao-style-palette">${[['titleColor','标题'],['subtitleColor','副标题'],['groupColor','分组 / 命令'],['descColor','描述']].map(([field,label]) => `<label class="miao-style-color-item"><span class="miao-style-color-label">${label}</span><input type="color" data-miao-style-field="${field}" value="${escapeMiaoAttr(style[field])}" /></label>`).join('')}</div>
    <p class="miao-editor-hint">配色只改变文字颜色，请搭配相应的背景图片。更换图片后可放大检查可读性。</p>
    <div class="miao-editor-assets">${[['themeImage','主题图'],['bodyImage','背景图']].map(([field,label]) => `<div class="miao-style-asset"><span class="miao-editor-label">${label}</span>${style[field] ? `<img class="miao-style-thumb" src="${escapeMiaoAttr(style[field])}" alt="${label}缩略图" />` : '<span class="miao-style-thumb is-default">默认</span>'}<button type="button" class="mini-btn" data-miao-style-upload="${field}" aria-label="上传${label}">${miaoEditorActionIcon('upload')}上传</button>${style[field] ? `<button type="button" class="mini-btn" data-miao-style-clear="${field}" aria-label="恢复默认${label}">恢复默认</button>` : ''}</div>`).join('')}</div>
  </div>`;
}

function closeMiaoIconPicker(restoreFocus = false) {
  const picker = document.getElementById('miao-icon-picker');
  const slot = picker?.dataset.sourceSlot;
  const key = picker?.dataset.sourceItem;
  picker?.cleanup?.();
  picker?.remove();
  if (restoreFocus && slot && key) document.querySelector(`#help-diy-${slot}-miao-editor [data-miao-pick-icon="${key}"]`)?.focus({ preventScroll: true });
}

function openMiaoIconPicker(anchorEl, target = '') {
  closeMiaoIconPicker();
  const sourceSlot = resolveMiaoEditorSlot(anchorEl);
  const current = String(anchorEl.dataset.currentIcon || '');
  const [gi, ii] = target.split(':').map(Number);
  const picker = document.createElement('div');
  picker.id = 'miao-icon-picker';
  picker.dataset.sourceSlot = sourceSlot;
  picker.dataset.sourceItem = target;
  const cartoon = Array.from({length: MIAO_ICON_COUNT}, (_,i) => `<button type="button" class="miao-icon-cell${current === String(i+1) ? ' active' : ''}" data-miao-icon="${i+1}" aria-label="卡通图标 ${i+1}"><span class="miao-item-icon-img" style="${miaoItemIconCss(i+1)}"></span></button>`).join('');
  picker.innerHTML = `<div class="miao-icon-picker-panel" role="dialog" aria-modal="true" aria-label="选择命令图标" tabindex="-1">
    <div class="miao-icon-picker-head"><strong>选择命令图标</strong><span class="miao-icon-picker-actions"><button type="button" data-miao-icon-auto>恢复自动</button><button type="button" data-miao-icon-close>关闭</button></span></div>
    <div class="miao-icon-picker-tabs"><button type="button" class="miao-icon-tab active" data-miao-icon-tab="sprite" aria-pressed="true">卡通图标</button><button type="button" class="miao-icon-tab" data-miao-icon-tab="artd" aria-pressed="false">ART PRO</button></div>
    <div class="miao-icon-artd-toolbar hidden" data-icon-grid-toolbar="artd"><input type="search" class="miao-icon-search" placeholder="搜索中文或英文，如：设置、音乐" aria-label="搜索 ART PRO 图标" /><select class="miao-icon-category" aria-label="图标分类">${window.HelpDiyIcons.categories.map(item => `<option value="${item.id}">${item.label}</option>`).join('')}</select><span class="miao-icon-count"></span></div>
    <div class="miao-icon-grid" data-icon-grid="sprite">${cartoon}</div><div class="miao-icon-grid hidden" data-icon-grid="artd"></div>
    <button type="button" class="miao-icon-more hidden" data-miao-show-more>显示更多图标</button>
  </div>`;
  document.body.appendChild(picker);
  const panel = picker.firstElementChild;
  const position = () => {
    const rect = anchorEl.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth-panel.offsetWidth-8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom+8, innerHeight-panel.offsetHeight-8))}px`;
  };
  window.addEventListener('resize', position);
  picker.cleanup = () => window.removeEventListener('resize', position);
  let shown = 120;
  let items = [];
  const search = picker.querySelector('input');
  const category = picker.querySelector('select');
  const renderGrid = () => {
    const matches = window.HelpDiyIcons.filter(items, search.value, category.value);
    picker.querySelector('[data-icon-grid="artd"]').innerHTML = matches.slice(0,shown).map(item => `<button type="button" class="miao-icon-cell miao-icon-cell-artd${current === `artd:${item.slug}` ? ' active' : ''}" data-miao-artd-pick="${escapeMiaoAttr(item.slug)}" aria-label="${escapeMiaoAttr(item.name)}" title="${escapeMiaoAttr(item.name)}">${item.svg}</button>`).join('') || '<p class="miao-editor-empty">没有匹配图标</p>';
    picker.querySelector('.miao-icon-count').textContent = `共 ${items.length} 个 · 匹配 ${matches.length} 个`;
    picker.querySelector('[data-miao-show-more]').classList.toggle('hidden', matches.length <= shown || picker.dataset.tab !== 'artd');
    position();
  };
  const load = async () => {
    try { items = await ensureArtdIcons(); if (picker.isConnected) renderGrid(); }
    catch (error) { picker.querySelector('[data-icon-grid="artd"]').textContent = `加载失败：${error.message}`; }
  };
  picker.addEventListener('click', event => {
    const el = event.target.closest('button');
    if (event.target === picker || el?.hasAttribute('data-miao-icon-close')) return closeMiaoIconPicker(true);
    if (!el) return;
    if (el.hasAttribute('data-miao-icon') || el.hasAttribute('data-miao-artd-pick') || el.hasAttribute('data-miao-icon-auto')) {
      const icon = el.dataset.miaoArtdPick ? `artd:${el.dataset.miaoArtdPick}` : el.dataset.miaoIcon ? Number(el.dataset.miaoIcon) : null;
      applyMiaoIconChoice(sourceSlot, gi, ii, icon);
      if (icon) window.HelpDiyIcons.remember(icon);
      closeMiaoIconPicker(true);
    } else if (el.dataset.miaoIconTab) {
      const tab = el.dataset.miaoIconTab;
      picker.dataset.tab = tab;
      picker.querySelectorAll('[data-miao-icon-tab]').forEach(btn => { btn.classList.toggle('active', btn === el); btn.setAttribute('aria-pressed', String(btn === el)); });
      picker.querySelectorAll('[data-icon-grid]').forEach(grid => grid.classList.toggle('hidden', grid.dataset.iconGrid !== tab));
      picker.querySelector('[data-icon-grid-toolbar]').classList.toggle('hidden', tab !== 'artd');
      if (tab === 'artd') { load(); search.focus(); } else picker.querySelector('[data-miao-show-more]').classList.add('hidden');
      position();
    } else if (el.hasAttribute('data-miao-show-more')) { shown += 120; renderGrid(); }
  });
  search.addEventListener('input', () => { shown = 120; renderGrid(); });
  category.addEventListener('change', () => { shown = 120; renderGrid(); });
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMiaoIconPicker(true); }
    if (event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button,input,select')].filter(el => !el.closest('.hidden'));
      const first = controls[0], last = controls[controls.length-1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  position();
  panel.focus();
}

function applyMiaoIconChoice(slot = '', groupIdx, itemIdx, icon) {
  if (!slot) return;
  recordDraft();
  const editor = ensureMiaoEditorStruct(slot);
  const item = editor.struct.groups?.[groupIdx]?.items?.[itemIdx];
  if (!item) return;
  if (typeof icon === 'string' && icon.startsWith('artd:')) {
    item.icon = icon;
  } else {
    item.icon = Number(icon) > 0 ? Math.min(Math.max(Number(icon), 1), MIAO_ICON_COUNT) : null;
  }
  commitMiaoEditor(slot);
  renderMiaoEditor(slot);
  recordDraft();
}

//从事件目标所在编辑器容器推断板块（多个板块可同时处于喵喵模式）
function resolveMiaoEditorSlot(target = null) {
  const container = target?.closest?.('.miao-editor');
  const id = String(container?.id || '');
  const match = id.match(/^help-diy-([a-z]+)-miao-editor$/);
  return match ? match[1] : '';
}

function bindMiaoEditorEvents() {
  document.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#miao-icon-picker')) return;
    const icon = target.closest('[data-miao-pick-icon]');
    if (icon) return openMiaoIconPicker(icon, icon.dataset.miaoPickIcon);
    if (document.getElementById('miao-icon-picker')) closeMiaoIconPicker();
    const upload = target.closest('[data-miao-style-upload]');
    if (upload) {
      const field = upload.dataset.miaoStyleUpload;
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const status = document.getElementById('help-diy-status');
        const acceptResult = beginHelpImageUpdate(field);
        try {
          if (file.size > HELP_DIY_MAX_UPLOAD_BYTES) throw new Error('图片最大 5MB，请压缩后上传');
          status.textContent = '正在上传图片…';
          const result = await postJson('/api/help-diy/upload-image', { dataUrl: await readFileAsDataUrl(file), slot: field === 'bodyImage' ? 'miao-body' : 'miao-theme' });
          if (!isLocalHelpDiyImage(result.url)) throw new Error('未返回有效图片地址');
          if (!acceptResult()) return;
          recordDraft();
          helpDiyState.miaoStyle = normalizeMiaoStyleFront({ ...helpDiyState.miaoStyle, [field]: result.url });
          renderGlobalStyle(); renderPreview(); renderDirtyStatus(); recordDraft();
          status.textContent = '图片已上传，正在更新预览；保存后应用于所有帮助卡片。';
        } catch (error) { status.textContent = `上传失败：${error.message}`; }
      });
      input.click(); return;
    }
    const clear = target.closest('[data-miao-style-clear]');
    const preset = target.closest('[data-help-color-preset]');
    if (clear || preset) {
      recordDraft();
      const palettes = {
        dark: {titleColor:'#ffffff',subtitleColor:'#e2e8f0',groupColor:'#e4c590',descColor:'#eeeeee'},
        light: {titleColor:'#18212f',subtitleColor:'#334155',groupColor:'#e4c590',descColor:'#eeeeee'},
        rose: {titleColor:'#ffffff',subtitleColor:'#fce7f3',groupColor:'#f9a8d4',descColor:'#f8fafc'},
      };
      helpDiyState.miaoStyle = normalizeMiaoStyleFront({ ...helpDiyState.miaoStyle, ...(preset ? palettes[preset.dataset.helpColorPreset] : { [clear.dataset.miaoStyleClear]: '' }) });
      renderGlobalStyle(); renderPreview(); renderDirtyStatus(); recordDraft(); return;
    }
    const slot = resolveMiaoEditorSlot(target);
    if (!slot || target.closest('[data-miao-field]')) return;
    const button = target.closest('button');
    if (!button) return;
    const collapse = button.dataset.miaoGroupCollapse;
    if (collapse !== undefined) {
      const key = `${slot}:${collapse}`;
      helpDiyState.collapsedGroups[key] = !helpDiyState.collapsedGroups[key];
      renderMiaoEditor(slot); return;
    }
    if (!Object.keys(button.dataset).some(key => /miao(Item|Group)(Add|Del|Up|Down|Copy)/.test(key))) return;
    recordDraft();
    const editor = ensureMiaoEditorStruct(slot);
    const groups = editor.struct.groups;
    const action = Object.keys(button.dataset).find(key => /miao(Item|Group)(Add|Del|Up|Down|Copy)/.test(key));
    const [gi, ii] = String(button.dataset[action] || '').split(':').map(Number);
    const group = groups[gi];
    if (action === 'miaoGroupAdd') groups.push({group:'新分组',items:[]});
    else if (action === 'miaoGroupDel') groups.splice(gi,1);
    else if (action === 'miaoGroupCopy') groups.splice(gi+1,0,JSON.parse(JSON.stringify(group)));
    else if (action === 'miaoGroupUp' && gi > 0) [groups[gi-1],groups[gi]] = [groups[gi],groups[gi-1]];
    else if (action === 'miaoGroupDown' && gi < groups.length-1) [groups[gi+1],groups[gi]] = [groups[gi],groups[gi+1]];
    else if (action === 'miaoItemAdd') group.items.push({icon:null,title:'#新命令',desc:''});
    else if (action === 'miaoItemDel') group.items.splice(ii,1);
    else if (action === 'miaoItemCopy') group.items.splice(ii+1,0,JSON.parse(JSON.stringify(group.items[ii])));
    else if (action === 'miaoItemUp' && ii > 0) [group.items[ii-1],group.items[ii]] = [group.items[ii],group.items[ii-1]];
    else if (action === 'miaoItemDown' && ii < group.items.length-1) [group.items[ii+1],group.items[ii]] = [group.items[ii],group.items[ii+1]];
    helpDiyState.collapsedGroups = {};
    commitMiaoEditor(slot); renderMiaoEditor(slot); recordDraft();
  });
  document.addEventListener('input', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.matches('[data-miao-style-field]')) {
      helpDiyState.miaoStyle = normalizeMiaoStyleFront({ ...helpDiyState.miaoStyle, [target.dataset.miaoStyleField]: target.value });
      renderPreview(); renderDirtyStatus(); queueDraftHistory(); return;
    }
    if (!target.matches('[data-miao-field]')) return;
    const slot = resolveMiaoEditorSlot(target);
    const editor = ensureMiaoEditorStruct(slot);
    const field = target.dataset.miaoField;
    const gi = Number(target.dataset.gi), ii = Number(target.dataset.ii);
    if (field === 'title') editor.struct.title = target.value;
    else if (field === 'group') editor.struct.groups[gi].group = target.value;
    else editor.struct.groups[gi].items[ii][field === 'title-item' ? 'title' : 'desc'] = target.value;
    commitMiaoEditor(slot); queueDraftHistory();
  });
  document.addEventListener('dragstart', event => {
    const handle = event.target.closest?.('[data-miao-drag-item], [data-miao-drag-group]');
    if (!handle) return;
    recordDraft();
    helpDiyState.drag = { slot: resolveMiaoEditorSlot(handle), type: handle.hasAttribute('data-miao-drag-item') ? 'item' : 'group', key: handle.dataset.miaoDragItem ?? handle.dataset.miaoDragGroup };
    event.dataTransfer.setData('text/plain', JSON.stringify(helpDiyState.drag));
    event.dataTransfer.effectAllowed = 'move';
    handle.closest('.miao-editor-item, .miao-editor-group').classList.add('is-dragging');
  });
  document.addEventListener('dragover', event => {
    const drag = helpDiyState.drag;
    if (!drag || resolveMiaoEditorSlot(event.target) !== drag.slot) return;
    const target = (drag.type === 'item' && event.target.closest('.miao-editor-item')) || event.target.closest('.miao-editor-group');
    if (!target) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    target.classList.add('is-drop-target');
  });
  document.addEventListener('drop', event => {
    const drag = helpDiyState.drag;
    if (!drag || resolveMiaoEditorSlot(event.target) !== drag.slot) return;
    const target = (drag.type === 'item' && event.target.closest('.miao-editor-item')) || event.target.closest('.miao-editor-group');
    if (!target) return;
    event.preventDefault();
    const groups = ensureMiaoEditorStruct(drag.slot).struct.groups;
    const [gi,ii] = drag.key.split(':').map(Number);
    const destGi = Number(target.dataset.gi);
    const destIi = target.dataset.ii === undefined ? groups[destGi].items.length : Number(target.dataset.ii);
    if (drag.type === 'group') {
      if (gi !== destGi) groups.splice(destGi,0,groups.splice(gi,1)[0]);
    } else if (gi !== destGi || ii !== destIi) {
      const item = groups[gi].items.splice(ii,1)[0];
      groups[destGi].items.splice(destIi,0,item);
    }
    helpDiyState.collapsedGroups = {};
    commitMiaoEditor(drag.slot); renderMiaoEditor(drag.slot); recordDraft();
    helpDiyState.drag = null;
  });
  document.addEventListener('dragend', () => {
    helpDiyState.drag = null;
    document.querySelectorAll('.is-dragging, .is-drop-target').forEach(el => el.classList.remove('is-dragging','is-drop-target'));
  });
}

bindMiaoEditorEvents();

function beginHelpImageUpdate(slot) {
  helpDiyState.imageTasks = helpDiyState.imageTasks || {};
  const taskId = (helpDiyState.imageTasks[slot] || 0) + 1;
  helpDiyState.imageTasks[slot] = taskId;
  const fingerprint = () => JSON.stringify(captureDraftSnapshot());
  const initialDraft = fingerprint();
  return () => {
    if (helpDiyState.imageTasks[slot] === taskId && fingerprint() === initialDraft) return true;
    document.getElementById('help-diy-status').textContent = '图片已处理，但草稿已更改，未覆盖新编辑；请按当前草稿重新生成或上传。';
    return false;
  };
}

async function generateMiaoHelpImage(slot = '') {
  const acceptResult = beginHelpImageUpdate(slot);
  const text = document.getElementById(`help-diy-${slot}`).value;
  if (!text.trim()) throw new Error('帮助内容为空');
  const button = document.querySelector(`[data-help-generate-miao="${slot}"]`);
  button.disabled = true;
  try {
    const result = await postJson('/api/help-diy/generate-miao-image', {slot,text,style:normalizeMiaoStyleFront(helpDiyState.miaoStyle)});
    if (!isLocalHelpDiyImage(result.url)) throw new Error('未返回图片地址');
    if (!acceptResult()) return;
    recordDraft();
    document.getElementById(`help-diy-${slot}-image`).value = result.url;
    document.getElementById(`help-diy-${slot}-mode`).value = 'image';
    selectHelpSlot(slot);
    recordDraft(); renderDirtyStatus();
    document.getElementById('help-diy-status').textContent = '已生成固定图片，保存后机器人发送这张图片；后续外观修改不会自动更新它。';
  } finally { button.disabled = false; }
}

function render(payload, options = {}) {
  const { markAsSaved = true, recordHistory = true, editorDrafts = {}, preserveDraft = false } = options;
  if (recordHistory && helpDiyState.lastSavedPayload) recordDraft();
  const normalizedPayload = normalizeHelpDiyPayload(payload);
  if (preserveDraft) {
    normalizedPayload.home = { ...payload.home };
    normalizedPayload.categories = JSON.parse(JSON.stringify(payload.categories));
  }
  helpDiyState.payload = normalizedPayload;
  helpDiyState.miaoStyle = normalizeMiaoStyleFront(normalizedPayload.miaoStyle);
  ensureArtdIcons().catch(() => {});
  if (markAsSaved) {
    helpDiyState.lastSavedPayload = JSON.parse(JSON.stringify(normalizedPayload));
  }
  document.getElementById('help-diy-enabled').checked = normalizedPayload.enabled === true;
  document.getElementById('help-diy-home-mode').value = normalizedPayload.home.mode || 'text';
  document.getElementById('help-diy-home').value = normalizedPayload.home.text || '';
  document.getElementById('help-diy-home-image').value = normalizedPayload.home.image || '';
  document.getElementById('help-diy-ai-mode').value = normalizedPayload.categories.ai.mode || 'text';
  document.getElementById('help-diy-ai').value = normalizedPayload.categories.ai.text || '';
  document.getElementById('help-diy-ai-image').value = normalizedPayload.categories.ai.image || '';
  document.getElementById('help-diy-manage-mode').value = normalizedPayload.categories.manage.mode || 'text';
  document.getElementById('help-diy-manage').value = normalizedPayload.categories.manage.text || '';
  document.getElementById('help-diy-manage-image').value = normalizedPayload.categories.manage.image || '';
  document.getElementById('help-diy-fun-mode').value = normalizedPayload.categories.fun.mode || 'text';
  document.getElementById('help-diy-fun').value = normalizedPayload.categories.fun.text || '';
  document.getElementById('help-diy-fun-image').value = normalizedPayload.categories.fun.image || '';
  document.getElementById('help-diy-debug-mode').value = normalizedPayload.categories.debug.mode || 'text';
  document.getElementById('help-diy-debug').value = normalizedPayload.categories.debug.text || '';
  document.getElementById('help-diy-debug-image').value = normalizedPayload.categories.debug.image || '';
  helpDiyState.miaoEditors = {};
  for (const slot of ['home', 'ai', 'manage', 'fun', 'debug']) {
    if (!editorDrafts[slot]) continue;
    helpDiyState.miaoEditors[slot] = {
      sourceText: document.getElementById(`help-diy-${slot}`).value,
      struct: JSON.parse(JSON.stringify(editorDrafts[slot])),
    };
  }
  document.getElementById('help-diy-status').textContent = normalizedPayload.updatedAt
    ? `上次保存：${new Date(normalizedPayload.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
    : '还没有保存过自定义帮助内容';
  renderGlobalStyle();
  for (const container of document.querySelectorAll('[id$="-miao-editor"]')) container.dataset.rendered = '';
  renderPreview();
  renderDirtyStatus();
  if (recordHistory) recordDraft();
}

function renderTemplates() {
  const container = document.getElementById('help-diy-template-list');
  if (!container) return;
  container.innerHTML = (helpDiyState.templates || []).map(item => `
    <div class="setting-item">
      <div class="kv-label">${item.label}</div>
      <div class="setting-help">${item.description}</div>
      <div class="actions">
        <button data-help-template="${item.key}">套用模板</button>
      </div>
    </div>
  `).join('') || '<div class="setting-item">暂无可用模板</div>';
  container.querySelectorAll('[data-help-template]').forEach(button => {
    button.addEventListener('click', () => applyTemplate(button.dataset.helpTemplate));
  });
}

function renderHistory() {
  const container = document.getElementById('help-diy-history-list');
  if (!container) return;
  const items = helpDiyState.history || [];
  if (items.length === 0) {
    container.innerHTML = '<div class="setting-item">暂无历史版本</div>';
    return;
  }
  container.innerHTML = items.map(item => {
    const savedAt = new Date(item.savedAt).toLocaleString('zh-CN', { hour12: false });
    const title = item.note || savedAt;
    return `
      <div class="setting-item">
        <div class="kv-label">${escapeHtml(title)}</div>
        <div class="setting-help">保存时间：${escapeHtml(savedAt)}</div>
        <div class="setting-help">版本编号：${escapeHtml(item.id || '')}</div>
        <div class="actions">
          <button data-help-history="${escapeHtml(item.id || '')}">恢复此版本</button>
          <button data-help-history-delete="${escapeHtml(item.id || '')}">删除</button>
        </div>
      </div>
    `;
  }).join('');
  container.querySelectorAll('[data-help-history]').forEach(button => {
    button.addEventListener('click', () => restoreHistoryVersion(button.dataset.helpHistory));
  });
  container.querySelectorAll('[data-help-history-delete]').forEach(button => {
    button.addEventListener('click', () => deleteHistoryVersion(button.dataset.helpHistoryDelete));
  });
}

async function refresh() {
  const payload = await fetchJson('/api/help-diy');
  render(payload);
}

async function refreshTemplates() {
  const payload = await fetchJson('/api/help-diy/templates');
  helpDiyState.templates = payload.items || [];
  renderTemplates();
}

async function refreshHistory() {
  const payload = await fetchJson('/api/help-diy/history');
  helpDiyState.history = payload.items || [];
  renderHistory();
}

async function deleteHistoryVersion(historyId) {
  const ok = await webConsoleConfirm('确定删除这条历史版本吗？');
  if (!ok) return;
  const result = await postJson('/api/help-diy/history/delete', { id: historyId });
  helpDiyState.history = result.items || [];
  renderHistory();
  document.getElementById('help-diy-status').textContent = '已删除历史版本。';
}

async function clearHistoryVersions() {
  const ok = await webConsoleConfirm('确定清空全部历史版本吗？此操作不可撤销。');
  if (!ok) return;
  const result = await postJson('/api/help-diy/history/clear', {});
  helpDiyState.history = result.items || [];
  renderHistory();
  document.getElementById('help-diy-status').textContent = '已清空历史版本。';
}

async function save() {
  if (helpDiyState.saving) return;
  const incomplete = incompleteHelpField();
  if (incomplete) {
    document.getElementById('help-diy-status').textContent = incomplete;
    renderDirtyStatus();
    return;
  }
  recordDraft();
  helpDiyState.saving = true;
  const button = document.getElementById('help-diy-save-btn');
  button.disabled = true; button.textContent = '保存中…';
  const draft = getDraft();
  const snapshot = captureDraftSnapshot();
  try {
    const saved = await postJson('/api/help-diy/save', {...draft,historyNote:document.getElementById('help-diy-history-note').value});
    const payload = normalizeHelpDiyPayload(saved.data || saved);
    helpDiyState.lastSavedPayload = JSON.parse(JSON.stringify(payload));
    helpDiyState.payload = payload;
    if (JSON.stringify(captureDraftSnapshot()) === JSON.stringify(snapshot)) render(payload, { editorDrafts: snapshot.__editorDrafts });
    document.getElementById('help-diy-history-note').value = '';
    document.getElementById('help-diy-status').textContent = hasUnsavedChanges() ? '已保存提交时的内容，之后的修改尚未保存。' : '保存成功，机器人将使用已保存的帮助内容。';
    refreshHistory().catch(() => {});
  } finally {
    helpDiyState.saving = false;
    button.textContent = '保存帮助内容';
    renderDirtyStatus();
  }
}

function resetToLastSaved() {
  if (!helpDiyState.lastSavedPayload) return;
  render(JSON.parse(JSON.stringify(helpDiyState.lastSavedPayload)));
  document.getElementById('help-diy-status').textContent = '已恢复到上次保存内容。';
  renderDirtyStatus('当前状态：已恢复为已保存内容');
}

function applyTemplate(templateKey) {
  const template = (helpDiyState.templates || []).find(item => item.key === templateKey);
  if (!template) return;
  render({ ...(template.payload || {}), miaoStyle: template.payload?.miaoStyle || helpDiyState.miaoStyle }, { markAsSaved: false });
  document.getElementById('help-diy-status').textContent = `已套用模板：${template.label}。确认无误后点击“保存帮助内容”生效。`;
  renderDirtyStatus('当前状态：模板已套用，尚未保存');
}

async function restoreHistoryVersion(historyId) {
  const item = (helpDiyState.history || []).find(entry => entry.id === historyId);
  if (!item?.payload) return;
  const ok = await webConsoleConfirm('确定恢复到这个历史版本吗？当前未保存修改将丢失。');
  if (!ok) return;
  render(item.payload, { markAsSaved: false });
  document.getElementById('help-diy-status').textContent = '已恢复历史版本。确认无误后点击“保存帮助内容”生效。';
  renderDirtyStatus('当前状态：历史版本已恢复，尚未保存');
}

async function exportTemplate() {
  const incomplete = incompleteHelpField();
  if (incomplete) {
    document.getElementById('help-diy-status').textContent = incomplete;
    return;
  }
  const text = JSON.stringify({ ...getDraft(), exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `crystelf-help-diy-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importTemplate(file) {
  if (helpDiyState.saving) {
    document.getElementById('help-diy-status').textContent = '正在保存或导入帮助内容，请稍候。';
    return;
  }
  helpDiyState.saving = true;
  renderDirtyStatus();
  const initialDraft = JSON.stringify(captureDraftSnapshot());
  try {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('导入文件不是有效的帮助模板');
    }
    const preview = await postJson('/api/help-diy/import-preview', parsed);
    if ((preview.changedCount || 0) === 0) {
      document.getElementById('help-diy-status').textContent = '导入内容与已保存内容一致，当前草稿已保留。';
      return;
    }
    if (initialDraft !== JSON.stringify(captureDraftSnapshot())) {
      document.getElementById('help-diy-status').textContent = '检查模板期间草稿已更改，请重新导入。';
      return;
    }
    const ok = await webConsoleConfirm(`检测到 ${preview.changedCount} 项变更：\n${(preview.changes || []).join('\n')}\n\n是否继续导入并覆盖当前帮助内容？`, { title: '导入帮助内容' });
    if (!ok) return;
    if (initialDraft !== JSON.stringify(captureDraftSnapshot())) {
      document.getElementById('help-diy-status').textContent = '确认导入期间草稿已更改，请重新导入。';
      return;
    }
    const saved = await postJson('/api/help-diy/save', parsed);
    const payload = normalizeHelpDiyPayload(saved.data || saved);
    if (initialDraft === JSON.stringify(captureDraftSnapshot())) render(payload);
    else {
      helpDiyState.lastSavedPayload = payload;
      helpDiyState.payload = payload;
      document.getElementById('help-diy-status').textContent = '模板已导入保存，等待期间的新编辑仍保留在草稿中。';
    }
    refreshHistory().catch(() => {});
  } finally {
    helpDiyState.saving = false;
    renderDirtyStatus();
  }
}

async function uploadHelpImage(slot, file) {
  const acceptResult = beginHelpImageUpdate(slot);
  if (!String(file?.type || '').startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  if (Number(file?.size || 0) > HELP_DIY_MAX_UPLOAD_BYTES) {
    throw new Error(`图片过大，最大允许 ${Math.round(HELP_DIY_MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }
  const imageInput = document.getElementById(`help-diy-${slot}-image`);
  const dataUrl = await readFileAsDataUrl(file);
  const result = await postJson('/api/help-diy/upload-image', { slot, dataUrl });
  const url = result.url || '';
  if (!url) throw new Error('上传成功但未返回图片地址');
  if (!acceptResult()) return;
  recordDraft();
  imageInput.value = url;
  document.getElementById(`help-diy-${slot}-mode`).value = 'image';
  recordDraft();
  renderPreview();
  document.getElementById('help-diy-status').textContent = `已上传 ${slot} 帮助图片，记得保存帮助内容。`;
  renderDirtyStatus('当前状态：图片已上传，尚未保存');
}



async function clearHelpImage(slot) {
  const imageInput = document.getElementById(`help-diy-${slot}-image`);
  recordDraft();
  imageInput.value = '';
  document.getElementById(`help-diy-${slot}-mode`).value = 'text';
  recordDraft();
  renderPreview();
  document.getElementById('help-diy-status').textContent = `已清除 ${slot} 帮助图片，记得保存帮助内容。`;
  renderDirtyStatus('当前状态：图片已清除，尚未保存');
}

async function generateHelpImage(slot) {
  const acceptResult = beginHelpImageUpdate(slot);
  const textInput = document.getElementById(`help-diy-${slot}`);
  const text = String(textInput?.value || '').trim();
  if (!text) {
    document.getElementById('help-diy-status').textContent = `${slot} 帮助内容为空，无法生成图片。`;
    return;
  }
  const generateBtn = document.querySelector(`[data-help-generate="${slot}"]`);
  const previousText = generateBtn?.textContent || '';
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = '生成中...';
  }
  document.getElementById('help-diy-status').textContent = `正在生成 ${slot} 帮助图片，请稍候...`;
  try {
    const result = await postJson('/api/help-diy/generate-image', { slot, text });
    const url = result.url || '';
    if (!url) throw new Error('生成成功但未返回图片地址');
    if (!acceptResult()) return;
    const imageInput = document.getElementById(`help-diy-${slot}-image`);
    recordDraft();
    imageInput.value = url;
    document.getElementById(`help-diy-${slot}-mode`).value = 'image';
    recordDraft();
    selectHelpSlot(slot);
    document.getElementById('help-diy-status').textContent = `已生成 ${slot} 帮助图片，记得保存帮助内容。`;
    renderDirtyStatus('当前状态：图片已生成，尚未保存');
  } catch (error) {
    document.getElementById('help-diy-status').textContent = `生成失败：${error.message}`;
  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = previousText || '生成图片';
    }
  }
}

async function generateHelpHtmlImage() {
  const slot = String(document.getElementById('help-diy-html-slot')?.value || 'home');
  const acceptResult = beginHelpImageUpdate(slot);
  const html = String(document.getElementById('help-diy-html-source')?.value || '').trim();
  if (!html) {
    document.getElementById('help-diy-status').textContent = 'HTML 内容为空，无法生成图片。';
    return;
  }
  const generateBtn = document.getElementById('help-diy-html-generate-btn');
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = '生成中...';
  }
  document.getElementById('help-diy-status').textContent = '正在渲染 HTML 图片，请稍候...';
  try {
    const result = await postJson('/api/help-diy/generate-html-image', { slot, html });
    const url = result.url || '';
    if (!url) throw new Error('生成成功但未返回图片地址');
    if (!acceptResult()) return;
    if (String(document.getElementById('help-diy-html-source')?.value || '').trim() !== html
      || document.getElementById('help-diy-html-slot')?.value !== slot) {
      document.getElementById('help-diy-status').textContent = 'HTML 或目标分类已更改，未应用旧图片，请重新生成。';
      return;
    }
    const imageInput = document.getElementById(`help-diy-${slot}-image`);
    recordDraft();
    imageInput.value = url;
    document.getElementById(`help-diy-${slot}-mode`).value = 'image';
    recordDraft();
    selectHelpSlot(slot);
    document.getElementById('help-diy-status').textContent = `已生成 HTML 图片并填入 ${slot} 板块，记得保存帮助内容。`;
    renderDirtyStatus('当前状态：HTML 图片已生成，尚未保存');
  } catch (error) {
    document.getElementById('help-diy-status').textContent = `HTML 图片生成失败：${error.message}`;
  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = '生成图片';
    }
  }
}

function selectHelpSlot(slot) {
  if (slot === helpDiyState.activePreview) return renderPreview();
  helpDiyState.activePreview = slot;
  closeMiaoIconPicker();
  helpDiyState.miaoLive.dataUrl = '';
  helpDiyState.miaoLive.targetFingerprint = '';
  document.querySelectorAll('[data-help-preview]').forEach(button => {
    const selected = button.dataset.helpPreview === slot;
    button.classList.toggle('active', selected); button.setAttribute('aria-pressed',String(selected));
  });
  document.querySelectorAll('[data-help-slot]').forEach(panel => panel.classList.toggle('hidden',panel.dataset.helpSlot !== slot));
  document.getElementById('help-diy-preview-slot').textContent = {home:'总帮助',ai:'AI',manage:'管理',fun:'娱乐',debug:'调试'}[slot];
  renderPreview();
}

function scrollCurrentHelpView() {
  if (!window.matchMedia('(max-width: 960px)').matches) return;
  const panel = document.getElementById(document.body.dataset.helpView === 'preview'
    ? 'help-diy-preview-pane' : `help-diy-${helpDiyState.activePreview}-panel`);
  const bar = document.querySelector('.help-workbench-bar');
  if (!panel || !bar) return;
  panel.style.scrollMarginTop = `${(parseFloat(window.getComputedStyle(bar).top) || 0) + bar.offsetHeight + 12}px`;
  panel.scrollIntoView({ block: 'start' });
}

function bindPreviewTabs() {
  document.querySelectorAll('[data-help-preview]').forEach(button => button.addEventListener('click', () => {
    selectHelpSlot(button.dataset.helpPreview);
    scrollCurrentHelpView();
  }));
  const viewButtons = document.querySelectorAll('button[data-help-view]');
  const syncView = () => viewButtons.forEach(button => {
    const selected = button.dataset.helpView === document.body.dataset.helpView;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  viewButtons.forEach(button => button.addEventListener('click', () => {
    document.body.dataset.helpView = button.dataset.helpView;
    syncView();
    scrollCurrentHelpView();
  }));
  syncView();
}

function bindLivePreview() {
  document.querySelectorAll('.help-slot-panel textarea, .help-slot-panel input[type="text"], .help-slot-panel input[type="url"], .help-slot-panel select, #help-diy-enabled').forEach(element => {
    const handler = () => { renderPreview(); renderDirtyStatus(); queueDraftHistory(); };
    element.addEventListener('input',handler);
    element.addEventListener('change',handler);
  });
  document.getElementById('help-diy-undo-btn').addEventListener('click', () => restoreDraftHistory(-1));
  document.getElementById('help-diy-redo-btn').addEventListener('click', () => restoreDraftHistory(1));
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() === 's') { event.preventDefault(); save().catch(error => { document.getElementById('help-diy-status').textContent = error.message; }); }
    if (event.key.toLowerCase() === 'z' && !event.target.matches('input,textarea,[contenteditable]')) { event.preventDefault(); restoreDraftHistory(event.shiftKey ? 1 : -1); }
  });
}


function bindImageUpload() {
  document.querySelectorAll('[data-help-upload]').forEach(button => {
    button.addEventListener('click', () => {
      document.getElementById(`help-diy-${button.dataset.helpUpload}-upload`)?.click();
    });
  });
  ['home', 'ai', 'manage', 'fun', 'debug'].forEach(slot => {
    document.getElementById(`help-diy-${slot}-upload`)?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      uploadHelpImage(slot, file).catch(error => {
        document.getElementById('help-diy-status').textContent = `上传失败：${error.message}`;
      }).finally(() => {
        event.target.value = '';
      });
    });
  });
  document.querySelectorAll('[data-help-clear]').forEach(button => {
    button.addEventListener('click', () => {
      clearHelpImage(button.dataset.helpClear).catch(error => {
        document.getElementById('help-diy-status').textContent = `清除失败：${error.message}`;
      });
    });
  });
  document.querySelectorAll('[data-help-generate]').forEach(button => {
    button.addEventListener('click', () => {
      generateHelpImage(button.dataset.helpGenerate).catch(error => {
        document.getElementById('help-diy-status').textContent = `生成失败：${error.message}`;
      });
    });
  });
  document.querySelectorAll('[data-help-generate-miao]').forEach(button => {
    button.addEventListener('click', () => {
      generateMiaoHelpImage(button.dataset.helpGenerateMiao).catch(error => {
        document.getElementById('help-diy-status').textContent = `生成失败：${error.message}`;
      });
    });
  });
  document.getElementById('help-diy-html-generate-btn')?.addEventListener('click', () => {
    generateHelpHtmlImage().catch(error => {
      document.getElementById('help-diy-status').textContent = `生成失败：${error.message}`;
    });
  });
  document.querySelectorAll('[data-help-html-template]').forEach(button => {
    button.addEventListener('click', () => {
      const slot = button.dataset.helpHtmlTemplate;
      const html = getHelpHtmlTemplate(slot);
      if (!html) return;
      document.getElementById('help-diy-html-source').value = html;
      document.getElementById('help-diy-html-slot').value = slot;
      document.getElementById('help-diy-status').textContent = `已填入 ${slot} 内置模板，可直接生成图片或修改后生成。`;
    });
  });
}

function bindUnsavedWarning() {
  window.addEventListener('beforeunload', event => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  document.querySelector('a.link-btn[href="/"]')?.addEventListener('click', async event => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    const ok = await webConsoleConfirm('当前有未保存修改，确定离开此页面吗？');
    if (!ok) {
      return;
    }
    window.location.href = event.currentTarget.href;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('help-diy-save-btn')?.addEventListener('click', () => {
    save().catch(error => {
      document.getElementById('help-diy-status').textContent = `保存失败：${error.message}`;
    });
  });
  document.getElementById('help-diy-reset-btn')?.addEventListener('click', async () => {
    if (!hasUnsavedChanges()) {
      document.getElementById('help-diy-status').textContent = '当前没有可恢复的未保存修改。';
      return;
    }
    const ok = await webConsoleConfirm('确定恢复到上次保存内容吗？当前未保存修改将丢失。');
    if (!ok) return;
    resetToLastSaved();
  });
  document.getElementById('help-diy-export-btn')?.addEventListener('click', () => {
    exportTemplate().catch(error => {
      document.getElementById('help-diy-status').textContent = `导出失败：${error.message}`;
    });
  });
  document.getElementById('help-diy-import-btn')?.addEventListener('click', () => {
    document.getElementById('help-diy-import-input')?.click();
  });
  document.getElementById('help-diy-history-clear-btn')?.addEventListener('click', () => {
    clearHistoryVersions().catch(error => {
      document.getElementById('help-diy-status').textContent = `清空历史失败：${error.message}`;
    });
  });
  document.getElementById('help-diy-import-input')?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    importTemplate(file).catch(error => {
      document.getElementById('help-diy-status').textContent = `导入失败：${error.message}`;
    }).finally(() => {
      event.target.value = '';
    });
  });
  bindPreviewTabs();
  bindLivePreview();
  bindPreviewTools();
  bindImageUpload();
  bindUnsavedWarning();
  refreshTemplates().catch(error => {
    document.getElementById('help-diy-status').textContent = `模板加载失败：${error.message}`;
  });
  refreshHistory().catch(error => {
    document.getElementById('help-diy-status').textContent = `历史版本加载失败：${error.message}`;
  });
  // HTML 转图片：预填充当前板块的推荐模板（仅当编辑区为空，不覆盖用户已填内容）
  const htmlSource = document.getElementById('help-diy-html-source');
  const htmlSlot = document.getElementById('help-diy-html-slot');
  if (htmlSource && htmlSlot && !String(htmlSource.value || '').trim()) {
    htmlSource.value = getHelpHtmlTemplate(htmlSlot.value || 'home');
    document.getElementById('help-diy-status').textContent = '已预填入推荐帮助样式模板，可直接「生成图片」或修改后生成。';
  }
  // 切换目标板块时，若编辑区仍是上一个模板（未修改），跟随切换为对应板块的推荐模板
  htmlSlot?.addEventListener('change', () => {
    const current = String(htmlSource.value || '').trim();
    const previousTemplate = getHelpHtmlTemplate(htmlSource.dataset.lastSlot || 'home');
    // 未修改过（与上一板块模板一致或为空）才跟随切换，保护用户自定义内容
    if (!current || current === previousTemplate.trim()) {
      htmlSource.value = getHelpHtmlTemplate(htmlSlot.value || 'home');
    }
    htmlSource.dataset.lastSlot = htmlSlot.value || 'home';
  });
  if (htmlSource) htmlSource.dataset.lastSlot = htmlSlot?.value || 'home';

  refresh().catch(error => {
    document.getElementById('help-diy-status').textContent = `加载失败：${error.message}`;
  });
});
