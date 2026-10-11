const helpDiyState = {
  payload: null,
  activePreview: 'home',
  templates: [],
  lastSavedPayload: null,
  history: [],
  miaoLive: { seq: 0, timer: null, rendering: false, dataUrl: '', lastText: '', lastError: '', pendingAfterRender: null },
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

const { buildHeaders, fetchJson, postJson } = window.CrystelfRequest;

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

function collectHelpDiyImages(payload = {}) {
  const normalized = normalizeHelpDiyPayload(payload);
  return new Set([
    normalized.home.image,
    normalized.categories.ai.image,
    normalized.categories.manage.image,
    normalized.categories.fun.image,
    normalized.categories.debug.image,
  ].filter(isLocalHelpDiyImage));
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

function hasUnsavedChanges() {
  return helpDiyState.lastSavedPayload
    ? normalizeForCompare(getDraft()) !== normalizeForCompare(helpDiyState.lastSavedPayload)
    : false;
}

function renderDirtyStatus(message = '') {
  const element = document.getElementById('help-diy-dirty-status');
  if (!element) return;
  if (message) {
    element.textContent = message;
    return;
  }
  const dirty = hasUnsavedChanges();
  element.textContent = dirty ? '当前状态：有未保存修改' : '当前状态：已保存';
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
  });
}

function renderPreview() {
  syncHelpDiyModeControls();
  const draft = getDraft();
  const mapping = {
    home: draft.home,
    ai: draft.categories.ai,
    manage: draft.categories.manage,
    fun: draft.categories.fun,
    debug: draft.categories.debug,
  };
  const current = mapping[helpDiyState.activePreview] || { mode: 'text', text: '', image: '' };
  const previewShell = document.getElementById('help-diy-preview-shell');
  const textPreview = document.getElementById('help-diy-preview');
  const imageWrap = document.getElementById('help-diy-image-preview-wrap');
  const imagePreview = document.getElementById('help-diy-image-preview');

  previewShell?.classList.toggle('is-image-mode', current.mode === 'image' || current.mode === 'miao');
  if (current.mode === 'miao') {
    const live = helpDiyState.miaoLive;
    if (live.dataUrl) {
      textPreview.textContent = live.rendering ? '喵喵卡片 · 内容已修改，正在重新渲染...' : '喵喵卡片实时预览';
      imagePreview.src = live.dataUrl;
      imageWrap.classList.remove('hidden');
    } else if (live.rendering) {
      textPreview.textContent = '喵喵卡片 · 正在渲染...';
      imagePreview.removeAttribute('src');
      imageWrap.classList.add('hidden');
    } else if (live.lastError) {
      textPreview.textContent = `喵喵卡片渲染失败：${live.lastError}`;
      imagePreview.removeAttribute('src');
      imageWrap.classList.add('hidden');
    } else {
      textPreview.textContent = '喵喵卡片 · 输入或修改左侧文本后将自动渲染预览；发送 #灵晶帮助 时按保存的文本实时出图。';
      imagePreview.removeAttribute('src');
      imageWrap.classList.add('hidden');
    }
    scheduleMiaoLivePreview(helpDiyState.activePreview, current.text);
    return;
  }
  previewShell?.classList.toggle('is-image-empty', current.mode === 'image' && !isLocalHelpDiyImage(current.image));
  if (current.mode === 'image') {
    const imageMessage = current.image && isLocalHelpDiyImage(current.image)
      ? current.image
      : '未填写本地上传图片地址';
    textPreview.textContent = `图片发送\n${imageMessage}`;
    if (current.image && isLocalHelpDiyImage(current.image)) {
      imagePreview.src = current.image;
      imageWrap.classList.remove('hidden');
    } else {
      imagePreview.removeAttribute('src');
      imageWrap.classList.add('hidden');
    }
    return;
  }

  textPreview.textContent = current.text || '暂无内容';
  imagePreview.removeAttribute('src');
  imageWrap.classList.add('hidden');
}

function scheduleMiaoLivePreview(slot = '', text = '') {
  const live = helpDiyState.miaoLive;
  const body = String(text || '').trim();
  if (!body) {
    live.dataUrl = '';
    live.lastText = '';
    return;
  }
  if (live.timer) clearTimeout(live.timer);
  live.timer = setTimeout(async () => {
    live.timer = null;
    const styleFingerprint = JSON.stringify(normalizeMiaoStyleFront(helpDiyState.miaoStyle));
    const fingerprint = `${slot}\u0000${body}\u0000${styleFingerprint}`;
    if (fingerprint === live.lastText && live.dataUrl) return;
    if (live.rendering) {
      //上一张还在渲染：记下待渲染内容，渲染完成的 finally 里自动补一轮
      live.pendingAfterRender = { slot, text: body };
      return;
    }
    const seq = ++live.seq;
    live.rendering = true;
    renderPreview();
    try {
      const result = await postJson('/api/help-diy/preview-miao-image', { slot, text: body, style: normalizeMiaoStyleFront(helpDiyState.miaoStyle) });
      if (seq !== live.seq) return;
      live.dataUrl = result.dataUrl || '';
      live.lastText = fingerprint;
      live.lastError = '';
    } catch (error) {
      if (seq !== live.seq) return;
      live.dataUrl = '';
      live.lastText = '';
      live.lastError = error.message || '未知错误';
      document.getElementById('help-diy-status').textContent = `喵喵卡片实时预览失败：${error.message}`;
    } finally {
      if (seq === live.seq) {
        live.rendering = false;
        renderPreview();
      }
      //渲染期间有新输入：补一轮渲染，保证预览最终对齐最新文本
      const pending = live.pendingAfterRender;
      live.pendingAfterRender = null;
      if (pending) {
        scheduleMiaoLivePreview(pending.slot, pending.text);
      }
    }
  }, 600);
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
};

function normalizeMiaoStyleFront(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const color = (value, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(value || '').trim()) ? String(value).trim() : fallback);
  const align = (value, fallback) => (['left', 'center', 'right'].includes(String(value || '').trim().toLowerCase()) ? String(value).trim().toLowerCase() : fallback);
  return {
    subtitle: String(source.subtitle ?? MIAO_STYLE_FRONT_DEFAULTS.subtitle).trim().slice(0, 120) || MIAO_STYLE_FRONT_DEFAULTS.subtitle,
    titleColor: color(source.titleColor, MIAO_STYLE_FRONT_DEFAULTS.titleColor),
    subtitleColor: color(source.subtitleColor, MIAO_STYLE_FRONT_DEFAULTS.subtitleColor),
    groupColor: color(source.groupColor, MIAO_STYLE_FRONT_DEFAULTS.groupColor),
    descColor: color(source.descColor, MIAO_STYLE_FRONT_DEFAULTS.descColor),
    titleAlign: align(source.titleAlign, MIAO_STYLE_FRONT_DEFAULTS.titleAlign),
    subtitleAlign: align(source.subtitleAlign, MIAO_STYLE_FRONT_DEFAULTS.subtitleAlign),
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
    const itemMatch = line.match(/^[-•*]\s+(.+)$/);
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
    const iconMatch = rest.match(/^\[icon:(\d{1,3})\]\s*/i);
    if (iconMatch) {
      icon = Math.min(Math.max(parseInt(iconMatch[1], 10) || 0, 1), MIAO_ICON_COUNT);
      rest = rest.slice(iconMatch[0].length);
    }
    itemIndex += 1;
    let title = rest;
    let desc = '';
    const multiSpace = rest.match(/^(\S(?:.*?\S)?)\s{2,}(\S.*)$/);
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
      const iconTag = Number(item.icon) > 0 ? `[icon:${Math.floor(Number(item.icon))}] ` : '';
      lines.push(desc ? `- ${iconTag}${title}  ${desc}` : `- ${iconTag}${title}`);
    }
  }
  return lines.join('\n');
}

function miaoItemIconCss(icon) {
  const num = Number(icon) || 1;
  const x = (num - 1) % 10;
  const y = (num - x - 1) / 10;
  return `background-position:-${x * 50}px -${y * 50}px`;
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
  renderPreview();
  renderDirtyStatus();
}

function renderMiaoEditor(slot = '') {
  const container = document.getElementById(`help-diy-${slot}-miao-editor`);
  if (!container) return;
  const editor = ensureMiaoEditorStruct(slot);
  const struct = editor.struct;
  container.dataset.structSource = editor.sourceText;
  container.dataset.rendered = '1';

  const groupHtml = struct.groups.map((group, groupIdx) => {
    const items = (group.items || []).map((item, itemIdx) => `
      <div class="miao-editor-item" data-gi="${groupIdx}" data-ii="${itemIdx}">
        <button type="button" class="miao-item-icon" data-miao-pick-icon="${groupIdx}:${itemIdx}" data-current-icon="${Number(item.icon) || 0}" title="点击选择图标${Number(item.icon) > 0 ? `（当前 icon:${item.icon}）` : '（自动分配）'}">
          <span class="miao-item-icon-img" style="${miaoItemIconCss(item.icon || ((itemIdx % 40) + 1))}${Number(item.icon) > 0 ? '' : ';opacity:.55'}"></span>
        </button>
        <input type="text" class="miao-item-title" data-miao-field="title-item" data-gi="${groupIdx}" data-ii="${itemIdx}" value="${escapeMiaoAttr(item.title)}" placeholder="命令，如 #点歌 歌名" />
        <input type="text" class="miao-item-desc" data-miao-field="desc" data-gi="${groupIdx}" data-ii="${itemIdx}" value="${escapeMiaoAttr(item.desc)}" placeholder="描述（可留空）" />
        <span class="miao-item-ops">
          <button type="button" class="mini-btn" data-miao-item-up="${groupIdx}:${itemIdx}" title="上移">↑</button>
          <button type="button" class="mini-btn" data-miao-item-down="${groupIdx}:${itemIdx}" title="下移">↓</button>
          <button type="button" class="mini-btn danger" data-miao-item-del="${groupIdx}:${itemIdx}" title="删除">×</button>
        </span>
      </div>`).join('');
    return `
    <div class="miao-editor-group" data-gi="${groupIdx}">
      <div class="miao-editor-group-head">
        <input type="text" class="miao-group-name" data-miao-field="group" data-gi="${groupIdx}" value="${escapeMiaoAttr(group.group)}" placeholder="分组标题" />
        <span class="miao-group-ops">
          <button type="button" class="mini-btn" data-miao-group-up="${groupIdx}" title="上移分组">↑</button>
          <button type="button" class="mini-btn" data-miao-group-down="${groupIdx}" title="下移分组">↓</button>
          <button type="button" class="mini-btn danger" data-miao-group-del="${groupIdx}" title="删除分组">×</button>
        </span>
      </div>
      <div class="miao-editor-items">${items || '<p class="miao-editor-empty">这一组还没有条目，点下面「加一条」。</p>'}</div>
      <button type="button" class="mini-btn" data-miao-item-add="${groupIdx}">+ 加一条</button>
    </div>`;
  }).join('');

  const style = normalizeMiaoStyleFront(helpDiyState.miaoStyle);
  const themeThumb = style.themeImage
    ? `<img class="miao-style-thumb" src="${escapeMiaoAttr(style.themeImage)}" alt="主题图" />`
    : '<span class="miao-style-thumb is-default" title="使用内置 n 主题">默认</span>';
  const bodyThumb = style.bodyImage
    ? `<img class="miao-style-thumb" src="${escapeMiaoAttr(style.bodyImage)}" alt="背景图" />`
    : '<span class="miao-style-thumb is-default" title="使用内置背景纹理">默认</span>';
  const styleRow = `
    <div class="miao-editor-style-row">
      <label class="miao-editor-label">副标题</label>
      <input type="text" class="miao-card-subtitle" data-miao-style-field="subtitle" value="${escapeMiaoAttr(style.subtitle)}" placeholder="魔丸插件 · 发送 #灵晶帮助 查看帮助" />
      <span class="miao-style-color-item"><span class="miao-style-color-label" title="卡片标题颜色">标题</span><input type="color" data-miao-style-field="titleColor" value="${escapeMiaoAttr(style.titleColor)}" /></span>
      <span class="miao-style-color-item"><span class="miao-style-color-label" title="副标题颜色">副标</span><input type="color" data-miao-style-field="subtitleColor" value="${escapeMiaoAttr(style.subtitleColor)}" /></span>
      <span class="miao-style-color-item"><span class="miao-style-color-label" title="分组/命令标题颜色">分组</span><input type="color" data-miao-style-field="groupColor" value="${escapeMiaoAttr(style.groupColor)}" /></span>
      <span class="miao-style-color-item"><span class="miao-style-color-label" title="描述文字颜色">描述</span><input type="color" data-miao-style-field="descColor" value="${escapeMiaoAttr(style.descColor)}" /></span>
      <span class="miao-style-color-item"><span class="miao-style-color-label" title="标题水平位置">标题位</span><select class="miao-style-align" data-miao-style-field="titleAlign"><option value="left"${style.titleAlign === 'left' ? ' selected' : ''}>左</option><option value="center"${style.titleAlign === 'center' ? ' selected' : ''}>中</option><option value="right"${style.titleAlign === 'right' ? ' selected' : ''}>右</option></select></span>
      <span class="miao-style-color-item"><span class="miao-style-color-label" title="副标题水平位置">副标位</span><select class="miao-style-align" data-miao-style-field="subtitleAlign"><option value="left"${style.subtitleAlign === 'left' ? ' selected' : ''}>左</option><option value="center"${style.subtitleAlign === 'center' ? ' selected' : ''}>中</option><option value="right"${style.subtitleAlign === 'right' ? ' selected' : ''}>右</option></select></span>
    </div>
    <div class="miao-editor-style-row">
      <span class="miao-style-color-item">
        <span class="miao-style-color-label" title="卡片主题底图（覆盖卡片装饰与配色底）">主题图</span>
        ${themeThumb}
        <button type="button" class="mini-btn" data-miao-style-upload="themeImage">上传</button>
        ${style.themeImage ? '<button type="button" class="mini-btn danger" data-miao-style-clear="themeImage">默认</button>' : ''}
      </span>
      <span class="miao-style-color-item">
        <span class="miao-style-color-label" title="页面背景纹理（平铺）">背景图</span>
        ${bodyThumb}
        <button type="button" class="mini-btn" data-miao-style-upload="bodyImage">上传</button>
        ${style.bodyImage ? '<button type="button" class="mini-btn danger" data-miao-style-clear="bodyImage">默认</button>' : ''}
      </span>
    </div>`;

  container.innerHTML = `
    <div class="miao-editor-title-row">
      <label class="miao-editor-label">卡片标题</label>
      <input type="text" class="miao-card-title" data-miao-field="title" value="${escapeMiaoAttr(struct.title)}" placeholder="灵晶帮助" />
      <button type="button" class="mini-btn" data-miao-group-add>+ 加分组</button>
    </div>
    ${styleRow}
    <div class="miao-editor-groups">${groupHtml}</div>
    <p class="miao-editor-hint">图标点一下就能换；没有单独设置的图标会按顺序自动分配。副标题、颜色与背景图对所有板块的喵喵卡片生效，保存后 #灵晶帮助 出图同步。这里改动会实时更新右侧预览。</p>`;
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

function closeMiaoIconPicker() {
  document.getElementById('miao-icon-picker')?.remove();
}

function openMiaoIconPicker(anchorEl, target = '') {
  closeMiaoIconPicker();
  //弹层挂 body，记住来源板块（用户选择时可能已切走预览 tab）
  const sourceSlot = resolveMiaoEditorSlot(anchorEl);
  const [gi, ii] = String(target || '').split(':').map(n => parseInt(n, 10));
  const picker = document.createElement('div');
  picker.id = 'miao-icon-picker';
  picker.dataset.sourceSlot = sourceSlot;
  let grid = '';
  for (let icon = 1; icon <= MIAO_ICON_COUNT; icon++) {
    grid += `<button type="button" class="miao-icon-cell${Number(anchorEl?.dataset?.currentIcon) === icon ? ' active' : ''}" data-miao-icon="${icon}" title="icon:${icon}">
      <span class="miao-item-icon-img" style="${miaoItemIconCss(icon)}"></span>
    </button>`;
  }
  picker.innerHTML = `
    <div class="miao-icon-picker-panel">
      <div class="miao-icon-picker-head">
        <strong>选择命令图标</strong>
        <span class="miao-icon-picker-actions">
          <button type="button" class="mini-btn" data-miao-icon-auto>恢复自动分配</button>
          <button type="button" class="mini-btn" data-miao-icon-close>关闭</button>
        </span>
      </div>
      <div class="miao-icon-grid">${grid}</div>
    </div>`;
  document.body.appendChild(picker);
  const rect = anchorEl?.getBoundingClientRect?.();
  if (rect) {
    const panel = picker.firstElementChild;
    const panelWidth = panel.offsetWidth || 380;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - panelWidth - 8);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(Math.min(rect.bottom + 8, window.innerHeight - (panel.offsetHeight || 300) - 8))}px`;
  }
  picker.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    const slot = picker.dataset.sourceSlot || '';
    const pick = target.closest('[data-miao-icon]');
    if (pick) {
      applyMiaoIconChoice(slot, gi, ii, parseInt(pick.dataset.miaoIcon, 10));
      closeMiaoIconPicker();
      return;
    }
    if (target.closest('[data-miao-icon-auto]')) {
      applyMiaoIconChoice(slot, gi, ii, null);
      closeMiaoIconPicker();
      return;
    }
    if (target.closest('[data-miao-icon-close]') || target === picker) {
      closeMiaoIconPicker();
    }
  });
}

function applyMiaoIconChoice(slot = '', groupIdx, itemIdx, icon) {
  if (!slot) return;
  const editor = ensureMiaoEditorStruct(slot);
  const item = editor.struct.groups?.[groupIdx]?.items?.[itemIdx];
  if (!item) return;
  item.icon = Number(icon) > 0 ? Math.min(Math.max(Number(icon), 1), MIAO_ICON_COUNT) : null;
  commitMiaoEditor(slot);
  renderMiaoEditor(slot);
}

//从事件目标所在编辑器容器推断板块（多个板块可同时处于喵喵模式）
function resolveMiaoEditorSlot(target = null) {
  const container = target?.closest?.('.miao-editor');
  const id = String(container?.id || '');
  const match = id.match(/^help-diy-([a-z]+)-miao-editor$/);
  return match ? match[1] : '';
}

function bindMiaoEditorEvents() {
  document.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    if (target.closest('.miao-item-icon')) return;
    if (target.id === 'miao-icon-picker' || target.closest('#miao-icon-picker')) return;
    closeMiaoIconPicker();
  });

  document.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    const slot = resolveMiaoEditorSlot(target);
    if (!slot) return;
    const editor = ensureMiaoEditorStruct(slot);

    const iconBtn = target.closest('[data-miao-pick-icon]');
    if (iconBtn) {
      const current = Number(iconBtn.dataset.currentIcon) || 0;
      iconBtn.dataset.currentIcon = String(current);
      openMiaoIconPicker(iconBtn, iconBtn.dataset.miaoPickIcon);
      return;
    }

    const field = target.closest('[data-miao-field]');
    if (field) return; //输入事件在 input 监听里处理

    const styleUpload = target.closest('[data-miao-style-upload]');
    if (styleUpload) {
      const field = styleUpload.dataset.miaoStyleUpload;
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/webp';
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
          document.getElementById('help-diy-status').textContent = '背景图最大 5MB，请压缩后再上传。';
          return;
        }
        document.getElementById('help-diy-status').textContent = '正在上传背景图...';
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsDataURL(file);
          });
          const result = await postJson('/api/help-diy/upload-image', { dataUrl, slot: field === 'bodyImage' ? 'miao-body' : 'miao-theme' });
          helpDiyState.miaoStyle = normalizeMiaoStyleFront({ ...(helpDiyState.miaoStyle || {}), [field]: result.url || '' });
          renderPreview();
          renderDirtyStatus();
          //重渲编辑器以刷新缩略图
          const editorSlot = resolveMiaoEditorSlot(styleUpload);
          if (editorSlot) renderMiaoEditor(editorSlot);
          document.getElementById('help-diy-status').textContent = '背景图已上传，实时预览已更新，记得保存。';
        } catch (error) {
          document.getElementById('help-diy-status').textContent = `背景图上传失败：${error.message}`;
        }
      });
      fileInput.click();
      return;
    }
    const styleClear = target.closest('[data-miao-style-clear]');
    if (styleClear) {
      const field = styleClear.dataset.miaoStyleClear;
      helpDiyState.miaoStyle = normalizeMiaoStyleFront({ ...(helpDiyState.miaoStyle || {}), [field]: '' });
      renderPreview();
      renderDirtyStatus();
      const editorSlot = resolveMiaoEditorSlot(styleClear);
      if (editorSlot) renderMiaoEditor(editorSlot);
      return;
    }

    const itemAdd = target.closest('[data-miao-item-add]');
    if (itemAdd) {
      const gi = parseInt(itemAdd.dataset.miaoItemAdd, 10);
      editor.struct.groups?.[gi]?.items?.push({ icon: null, title: '#新命令', desc: '' });
      commitMiaoEditor(slot);
      renderMiaoEditor(slot);
      return;
    }
    const itemDel = target.closest('[data-miao-item-del]');
    if (itemDel) {
      const [gi, ii] = itemDel.dataset.miaoItemDel.split(':').map(n => parseInt(n, 10));
      editor.struct.groups?.[gi]?.items?.splice(ii, 1);
      commitMiaoEditor(slot);
      renderMiaoEditor(slot);
      return;
    }
    const itemUp = target.closest('[data-miao-item-up]');
    if (itemUp) {
      const [gi, ii] = itemUp.dataset.miaoItemUp.split(':').map(n => parseInt(n, 10));
      const items = editor.struct.groups?.[gi]?.items || [];
      if (ii > 0) {
        [items[ii - 1], items[ii]] = [items[ii], items[ii - 1]];
        commitMiaoEditor(slot);
        renderMiaoEditor(slot);
      }
      return;
    }
    const itemDown = target.closest('[data-miao-item-down]');
    if (itemDown) {
      const [gi, ii] = itemDown.dataset.miaoItemDown.split(':').map(n => parseInt(n, 10));
      const items = editor.struct.groups?.[gi]?.items || [];
      if (ii < items.length - 1) {
        [items[ii + 1], items[ii]] = [items[ii], items[ii + 1]];
        commitMiaoEditor(slot);
        renderMiaoEditor(slot);
      }
      return;
    }
    const groupAdd = target.closest('[data-miao-group-add]');
    if (groupAdd) {
      editor.struct.groups.push({ group: '新分组', items: [] });
      commitMiaoEditor(slot);
      renderMiaoEditor(slot);
      return;
    }
    const groupDel = target.closest('[data-miao-group-del]');
    if (groupDel) {
      const gi = parseInt(groupDel.dataset.miaoGroupDel, 10);
      editor.struct.groups.splice(gi, 1);
      commitMiaoEditor(slot);
      renderMiaoEditor(slot);
      return;
    }
    const groupUp = target.closest('[data-miao-group-up]');
    if (groupUp) {
      const gi = parseInt(groupUp.dataset.miaoGroupUp, 10);
      const groups = editor.struct.groups;
      if (gi > 0) {
        [groups[gi - 1], groups[gi]] = [groups[gi], groups[gi - 1]];
        commitMiaoEditor(slot);
        renderMiaoEditor(slot);
      }
      return;
    }
    const groupDown = target.closest('[data-miao-group-down]');
    if (groupDown) {
      const gi = parseInt(groupDown.dataset.miaoGroupDown, 10);
      const groups = editor.struct.groups;
      if (gi < groups.length - 1) {
        [groups[gi + 1], groups[gi]] = [groups[gi], groups[gi + 1]];
        commitMiaoEditor(slot);
        renderMiaoEditor(slot);
      }
    }
  });

  document.addEventListener('input', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    //样式行：副标题与颜色（全局 miaoStyle）
    if (target.matches('[data-miao-style-field]')) {
      const field = target.dataset.miaoStyleField;
      helpDiyState.miaoStyle = normalizeMiaoStyleFront({
        ...(helpDiyState.miaoStyle || {}),
        [field]: target.value,
      });
      renderPreview();
      renderDirtyStatus();
      return;
    }
    if (!target.matches('[data-miao-field]')) return;
    const slot = resolveMiaoEditorSlot(target);
    if (!slot) return;
    const editor = ensureMiaoEditorStruct(slot);
    const field = target.dataset.miaoField;
    const gi = parseInt(target.dataset.gi ?? '-1', 10);
    const ii = parseInt(target.dataset.ii ?? '-1', 10);
    if (field === 'title') {
      editor.struct.title = target.value;
    } else if (field === 'group' && editor.struct.groups?.[gi]) {
      editor.struct.groups[gi].group = target.value;
    } else if (field === 'title-item' && editor.struct.groups?.[gi]?.items?.[ii]) {
      editor.struct.groups[gi].items[ii].title = target.value;
    } else if (field === 'desc' && editor.struct.groups?.[gi]?.items?.[ii]) {
      editor.struct.groups[gi].items[ii].desc = target.value;
    }
    if (field === 'title' || field === 'group') {
      commitMiaoEditor(slot);
    }
    //条目输入不整行重渲（避免打字时 DOM 重建丢焦点），失焦/其他操作时统一提交
  });

  document.addEventListener('change', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || !target.matches('[data-miao-field="title-item"], [data-miao-field="desc"]')) return;
    const slot = resolveMiaoEditorSlot(target);
    if (!slot) return;
    commitMiaoEditor(slot);
    renderMiaoEditor(slot);
  });

  document.addEventListener('focusout', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || !target.matches('[data-miao-field="title-item"], [data-miao-field="desc"]')) return;
    const slot = resolveMiaoEditorSlot(target);
    if (!slot) return;
    commitMiaoEditor(slot);
  });
}

bindMiaoEditorEvents();

async function generateMiaoHelpImage(slot = '') {
  const text = document.getElementById(`help-diy-${slot}`)?.value || '';
  if (!text.trim()) {
    document.getElementById('help-diy-status').textContent = `${slot} 帮助内容为空，无法生成喵喵卡片。`;
    return;
  }
  const live = helpDiyState.miaoLive;
  live.dataUrl = '';
  live.lastText = '';
  renderPreview();
  const waitForLive = async () => {
    for (let i = 0; i < 200; i++) {
      if (!live.rendering) return;
      await new Promise(r => setTimeout(r, 100));
    }
  };
  await waitForLive();
  if (live.dataUrl) {
    document.getElementById('help-diy-status').textContent = '已按当前文本渲染喵喵卡片（保存后 #灵晶帮助 按同样效果发送）。';
  } else {
    document.getElementById('help-diy-status').textContent = '喵喵卡片渲染未完成，请稍后重试。';
  }
}

function render(payload, options = {}) {
  const { markAsSaved = true } = options;
  const normalizedPayload = normalizeHelpDiyPayload(payload);
  helpDiyState.payload = normalizedPayload;
  helpDiyState.miaoStyle = normalizeMiaoStyleFront(normalizedPayload.miaoStyle);
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
  document.getElementById('help-diy-status').textContent = normalizedPayload.updatedAt
    ? `上次保存：${new Date(normalizedPayload.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
    : '还没有保存过自定义帮助内容';
  renderPreview();
  renderDirtyStatus();
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
  const previousPayload = helpDiyState.lastSavedPayload
    ? JSON.parse(JSON.stringify(helpDiyState.lastSavedPayload))
    : null;
  const draft = getDraft();
  const saved = await postJson('/api/help-diy/save', {
    ...draft,
    historyNote: document.getElementById('help-diy-history-note')?.value || '',
  });
  const savedPayload = saved.data || saved;
  await cleanupRemovedImages(previousPayload, savedPayload);
  render(savedPayload);
  const noteInput = document.getElementById('help-diy-history-note');
  if (noteInput) noteInput.value = '';
  refreshHistory().catch(() => {});
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
  render(template.payload || {}, { markAsSaved: false });
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
  const response = await fetch('/api/help-diy/export', { headers: buildHeaders() });
  if (!response.ok) throw new Error(`导出失败: ${response.status}`);
  const text = await response.text();
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
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('导入文件不是有效的帮助模板');
  }
  const preview = await postJson('/api/help-diy/import-preview', parsed);
  if ((preview.changedCount || 0) === 0) {
    render(preview.next || parsed);
    return;
  }
  const ok = await webConsoleConfirm(`检测到 ${preview.changedCount} 项变更：\n${(preview.changes || []).join('\n')}\n\n是否继续导入并覆盖当前帮助内容？`, { title: '导入帮助内容' });
  if (!ok) return;
  const saved = await postJson('/api/help-diy/save', parsed);
  render(saved.data || saved);
}

async function uploadHelpImage(slot, file) {
  if (!String(file?.type || '').startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  if (Number(file?.size || 0) > HELP_DIY_MAX_UPLOAD_BYTES) {
    throw new Error(`图片过大，最大允许 ${Math.round(HELP_DIY_MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }
  const imageInput = document.getElementById(`help-diy-${slot}-image`);
  const previousImage = String(imageInput?.value || '').trim();
  const savedImages = collectHelpDiyImages(helpDiyState.lastSavedPayload || {});
  const dataUrl = await readFileAsDataUrl(file);
  const result = await postJson('/api/help-diy/upload-image', { slot, dataUrl });
  const url = result.url || '';
  if (!url) throw new Error('上传成功但未返回图片地址');
  imageInput.value = url;
  document.getElementById(`help-diy-${slot}-mode`).value = 'image';
  if (isLocalHelpDiyImage(previousImage) && !savedImages.has(previousImage) && previousImage !== url) {
    await deleteHelpDiyImage(previousImage).catch(error => {
      console.warn('[help-diy] delete replaced image failed:', error.message);
    });
  }
  renderPreview();
  document.getElementById('help-diy-status').textContent = `已上传 ${slot} 帮助图片，记得保存帮助内容。`;
  renderDirtyStatus('当前状态：图片已上传，尚未保存');
}

async function deleteHelpDiyImage(url) {
  if (!isLocalHelpDiyImage(url)) return;
  await postJson('/api/help-diy/delete-image', { url });
}

async function cleanupRemovedImages(previousPayload, nextPayload) {
  if (!previousPayload) return;
  const previousImages = collectHelpDiyImages(previousPayload);
  const nextImages = collectHelpDiyImages(nextPayload);
  await Promise.all([...previousImages]
    .filter(url => !nextImages.has(url))
    .map(url => deleteHelpDiyImage(url).catch(error => {
      console.warn('[help-diy] delete old image failed:', error.message);
    })));
}

async function clearHelpImage(slot) {
  const imageInput = document.getElementById(`help-diy-${slot}-image`);
  const previousImage = String(imageInput.value || '').trim();
  const savedImages = collectHelpDiyImages(helpDiyState.lastSavedPayload || {});
  imageInput.value = '';
  document.getElementById(`help-diy-${slot}-mode`).value = 'text';
  if (isLocalHelpDiyImage(previousImage) && !savedImages.has(previousImage)) {
    await deleteHelpDiyImage(previousImage);
  }
  renderPreview();
  document.getElementById('help-diy-status').textContent = `已清除 ${slot} 帮助图片，记得保存帮助内容。`;
  renderDirtyStatus('当前状态：图片已清除，尚未保存');
}

async function generateHelpImage(slot) {
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
    const imageInput = document.getElementById(`help-diy-${slot}-image`);
    const previousImage = String(imageInput.value || '').trim();
    const savedImages = collectHelpDiyImages(helpDiyState.lastSavedPayload || {});
    imageInput.value = url;
    document.getElementById(`help-diy-${slot}-mode`).value = 'image';
    if (isLocalHelpDiyImage(previousImage) && !savedImages.has(previousImage) && previousImage !== url) {
      await deleteHelpDiyImage(previousImage).catch(error => {
        console.warn('[help-diy] delete replaced image failed:', error.message);
      });
    }
    renderPreview();
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
    const imageInput = document.getElementById(`help-diy-${slot}-image`);
    const previousImage = String(imageInput.value || '').trim();
    const savedImages = collectHelpDiyImages(helpDiyState.lastSavedPayload || {});
    imageInput.value = url;
    document.getElementById(`help-diy-${slot}-mode`).value = 'image';
    if (isLocalHelpDiyImage(previousImage) && !savedImages.has(previousImage) && previousImage !== url) {
      await deleteHelpDiyImage(previousImage).catch(error => {
        console.warn('[help-diy] delete replaced image failed:', error.message);
      });
    }
    renderPreview();
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

function bindPreviewTabs() {
  document.querySelectorAll('[data-help-preview]').forEach(button => {
    button.addEventListener('click', () => {
      helpDiyState.activePreview = button.dataset.helpPreview;
      document.querySelectorAll('[data-help-preview]').forEach(item => item.classList.toggle('active', item === button));
      renderPreview();
    });
  });
}

function bindLivePreview() {
  document.querySelectorAll('textarea, input[type="checkbox"], input[type="text"], select').forEach(element => {
    const handler = () => {
      renderPreview();
      renderDirtyStatus();
    };
    element.addEventListener('input', handler);
    element.addEventListener('change', handler);
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
