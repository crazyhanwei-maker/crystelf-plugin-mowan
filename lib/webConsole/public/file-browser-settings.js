// 编辑器「主题 / 语言 / 行尾符 / 设置」四个按钮的功能实现。
// 主题 = 编辑区深/浅色；语言 = 高亮语言覆盖（传给后端 hljs）；行尾符 = LF/CRLF 转换；
// 设置 = 自动换行 / 行号开关。主题与换行/行号偏好持久化到 localStorage。
const EDITOR_PREF_PREFIX = 'crystelf-fb-editor-';

const EDITOR_MENU_LANGUAGES = [
  ['auto', '自动检测'],
  ['plaintext', '纯文本'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['json', 'JSON'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['markdown', 'Markdown'],
  ['python', 'Python'],
  ['shell', 'Shell'],
  ['dos', 'Batch/DOS'],
  ['sql', 'SQL'],
  ['yaml', 'YAML'],
  ['xml', 'XML'],
  ['java', 'Java'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['php', 'PHP'],
];

function readEditorPref(key, fallback) {
  try {
    const value = window.localStorage?.getItem(EDITOR_PREF_PREFIX + key);
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeEditorPref(key, value) {
  try {
    window.localStorage?.setItem(EDITOR_PREF_PREFIX + key, String(value));
  } catch {
    // 隐私模式等场景写不进就算了
  }
}

function applyEditorTheme() {
  const shell = $('file-browser-editor-shell');
  shell?.classList.toggle('editor-theme-light', fileBrowserState.editorTheme === 'light');
  const button = $('file-browser-editor-theme-btn');
  if (button) {
    button.textContent = fileBrowserState.editorTheme === 'light' ? '主题 VS Light' : '主题 VS Dark';
  }
  const status = $('file-browser-editor-theme-status');
  if (status) {
    status.textContent = fileBrowserState.editorTheme === 'light' ? 'Visual Studio Light' : 'Visual Studio Dark';
  }
}

function toggleEditorTheme() {
  fileBrowserState.editorTheme = fileBrowserState.editorTheme === 'light' ? 'dark' : 'light';
  writeEditorPref('theme', fileBrowserState.editorTheme);
  applyEditorTheme();
}

function applyEditorWrap() {
  const shell = $('file-browser-editor-shell');
  shell?.classList.toggle('editor-nowrap', fileBrowserState.editorWrap === false);
  const status = $('file-browser-editor-wrap-status');
  if (status) {
    status.textContent = `自动换行：${fileBrowserState.editorWrap ? '启用' : '停用'}`;
  }
}

function toggleEditorWrap() {
  fileBrowserState.editorWrap = fileBrowserState.editorWrap !== true;
  writeEditorPref('wrap', fileBrowserState.editorWrap ? '1' : '0');
  applyEditorWrap();
}

function applyEditorGutter() {
  const shell = $('file-browser-editor-shell');
  shell?.classList.toggle('editor-gutter-off', fileBrowserState.editorGutter === false);
}

function toggleEditorGutter() {
  fileBrowserState.editorGutter = fileBrowserState.editorGutter !== true;
  writeEditorPref('gutter', fileBrowserState.editorGutter ? '1' : '0');
  applyEditorGutter();
}

// 行尾符：textarea 的 value 会被浏览器强制归一化成 LF，无法直接改值，
// 因此按钮切换的是「保存时使用的行尾符模式」，写盘时才真正转换
function toggleEditorEol() {
  if (fileBrowserState.auth?.readOnly === true || fileBrowserState.selectedFile?.editable !== true) {
    return;
  }
  fileBrowserState.editorEolMode = fileBrowserState.editorEolMode === 'crlf' ? 'lf' : 'crlf';
  renderEditorStatusbar();
  setBanner(
    fileBrowserState.editorEolMode === 'crlf'
      ? '行尾符已切换为 CRLF：保存时按 CRLF 写入。'
      : '行尾符已切换为 LF：保存时按 LF 写入。',
    'success',
  );
}

function closeEditorMenu() {
  const menu = $('file-browser-editor-menu');
  menu?.classList.add('hidden');
  fileBrowserState.editorMenuActions = [];
}

function openEditorMenu(anchorButton, items = []) {
  const menu = $('file-browser-editor-menu');
  if (!menu || !anchorButton) return;
  fileBrowserState.editorMenuActions = items.map(item => item.action);
  menu.innerHTML = items.map((item, index) => `
    <button type="button" class="file-browser-context-menu-item" data-editor-menu-index="${index}">
      <span class="file-browser-context-menu-label">${escapeHtml(`${item.checked ? '✓' : '·'} ${item.label}`)}</span>
    </button>
  `).join('');
  menu.classList.remove('hidden');
  menu.style.minWidth = '170px';
  const rect = anchorButton.getBoundingClientRect();
  menu.style.top = `${Math.max(8, rect.bottom + 6)}px`;
  const menuWidth = menu.getBoundingClientRect().width || 170;
  let left = rect.right - menuWidth;
  if (left < 8) left = 8;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  menu.style.left = `${left}px`;
  menu.style.maxHeight = `${Math.max(200, window.innerHeight - rect.bottom - 20)}px`;
  menu.style.overflowY = 'auto';
}

function showEditorLanguageMenu(anchorButton) {
  const current = fileBrowserState.editorLanguageOverride || 'auto';
  const items = EDITOR_MENU_LANGUAGES.map(([value, label]) => ({
    label: `${label}${current === value ? '（当前）' : ''}`,
    checked: current === value,
    action: () => {
      fileBrowserState.editorLanguageOverride = value === 'auto' ? '' : value;
      renderEditorStatusbar();
      schedulePreviewRefresh({ immediate: true, force: true });
    },
  }));
  openEditorMenu(anchorButton, items);
}

function showEditorSettingsMenu(anchorButton) {
  openEditorMenu(anchorButton, [
    {
      label: `自动换行：${fileBrowserState.editorWrap ? '开' : '关'}`,
      checked: fileBrowserState.editorWrap === true,
      action: () => {
        toggleEditorWrap();
        showEditorSettingsMenu(anchorButton);
      },
    },
    {
      label: `显示行号：${fileBrowserState.editorGutter ? '开' : '关'}`,
      checked: fileBrowserState.editorGutter === true,
      action: () => {
        toggleEditorGutter();
        showEditorSettingsMenu(anchorButton);
      },
    },
  ]);
}

function restoreEditorPreferences() {
  const theme = readEditorPref('theme', 'dark');
  fileBrowserState.editorTheme = theme === 'light' ? 'light' : 'dark';
  const wrap = readEditorPref('wrap', '1');
  fileBrowserState.editorWrap = wrap !== '0';
  const gutter = readEditorPref('gutter', '1');
  fileBrowserState.editorGutter = gutter !== '0';
  applyEditorTheme();
  applyEditorWrap();
  applyEditorGutter();
}
