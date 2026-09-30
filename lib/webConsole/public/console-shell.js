(() => {
  if (document.body?.classList.contains('login-page')) {
    return;
  }

  if (document.body?.classList.contains('file-manager-page')) {
    return;
  }

  if (document.body?.classList.contains('qq-simulator-page')) {
    return;
  }

  const navigation = [
    { group: '工作台', href: '/index.html', label: '总览', icon: '⌂', match: ['/', '/index.html'] },

    { group: '群聊运营', href: '/group-management.html', label: '群管理', icon: '◎' },
    { group: '群聊运营', href: '/image-monitor-center.html', label: '图片监控', icon: '▧' },
    { group: '群聊运营', href: '/help-diy.html', label: '帮助设计', icon: '?' },

    { group: 'AI 能力', href: '/api-settings.html', label: 'API 接口', icon: '◈' },
    { group: 'AI 能力', href: '/usage-center.html', label: 'AI 用量', icon: '▤' },
    { group: 'AI 能力', href: '/sandbox-chat.html', label: '对话测试', icon: '✦' },
    { group: 'AI 能力', href: '/agent-workbench.html', label: 'Agent 工作台', icon: '⌬' },

    { group: '插件与系统', href: '/bot-plugins.html', label: '插件管理', icon: '▣', match: ['/bot-plugins.html', '/plugin-catalog.html'] },
    { group: '插件与系统', href: '/dependency-check.html', label: '依赖检查', icon: '✓' },
    { group: '插件与系统', href: '/file-browser.html', label: '文件编辑', icon: '⌘' },

    { group: '诊断与调试', href: '/qq-simulator.html', label: '模拟调试', icon: '◌' },
    { group: '诊断与调试', href: '/command-center.html', label: '命令中心', icon: '⌁' },
    { group: '诊断与调试', href: '/config-diagnostics.html', label: '配置诊断', icon: '◇' },
    { group: '诊断与调试', href: '/frontend-diagnostics.html', label: '前端诊断', icon: '!' },
    { group: '诊断与调试', href: '/task-center.html', label: '任务中心', icon: '⏱' },
    { group: '诊断与调试', href: '/performance.html', label: '性能监测', icon: '▥' },
    { group: '诊断与调试', href: '/audit-log-center.html', label: '审计日志', icon: '▤' },
    { group: '诊断与调试', href: '/bot-logs.html', label: 'Bot 日志', icon: '▤' },

    // 灵晶设置：一级菜单，分类为二级、分组为三级（子树结构运行时从 /api/plugin-settings 构建）
    { group: '灵晶设置', href: '/plugin-settings.html', label: '灵晶设置', icon: '⚙', lingjing: true },

    // 更新日志：独立一级菜单（GIT.md 更新记录章节）

    // 独立一级导航：固定排在导航栏最后（自定义链接组之前会被重新置底）
    // 图标用圆圈感叹号 SVG（对应用户指定的 iconfont e6c8 字形；控制台未加载图标字体，字符会显示方框）
    { group: '系统设置', href: '/system-settings.html', label: '系统设置', icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10m0-2a8 8 0 1 0 0-16a8 8 0 0 0 0 16m-1-5h2v2h-2zm0-8h2v6h-2z"/></svg>' },
    { group: '更新日志', href: '/update-log.html', label: '更新日志', icon: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Zm5.707 7.707 2.828 2.829 6.364-6.364-1.414-1.415-4.95 4.95-1.414-1.414-1.414 1.414Z"/></svg>' },
  ];

  function normalizePath(pathname = '') {
    if (!pathname || pathname === '/') return '/index.html';
    return pathname;
  }

  // 灵晶设置三级导航：分类为二级、分组为三级；子树结构由 /api/plugin-settings 动态构建
  const currentSearchParams = new URLSearchParams(window.location.search);
  const currentCategory = currentSearchParams.get('category') || '';
  const currentGroup = currentSearchParams.get('group') || '';
  let lingjingTree = [];
  let lastNavItems = navigation;
  // 这些分组已迁到系统设置页渲染，侧边栏叶子直接指向系统设置页
  const MIGRATED_LINGJING_GROUPS = new Set(['本地控制台设置', '插件维护']);

  // 完整导航清单暴露给「插件设置 → 导航设置」：隐藏项不在 DOM 里，设置页必须从这里读全量
  window.CrystelfConsoleNav = navigation;

  function isActive(item, currentPath) {
    if (item.lingjingCategory !== undefined) {
      // 灵晶设置三级项：按 URL 的 category/group 参数精确匹配
      return normalizePath(currentPath) === '/plugin-settings.html'
        && item.lingjingCategory === currentCategory
        && item.lingjingGroup === currentGroup;
    }
    if (item.lingjing) {
      // 灵晶设置根项：仅在未带分组参数时视为当前
      return normalizePath(currentPath) === '/plugin-settings.html' && !currentCategory;
    }
    const matches = Array.isArray(item.match) ? item.match : [item.href];
    return matches.map(normalizePath).includes(currentPath);
  }

  function createNavItem(item, currentPath) {
    const link = document.createElement('a');
    const active = isActive(item, currentPath);
    link.className = `console-nav-link${active ? ' active' : ''}`;
    link.href = item.href;
    link.title = item.label;
    link.setAttribute('aria-label', item.label);
    if (active) link.setAttribute('aria-current', 'page');
    if (item.external) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    link.innerHTML = `
      <span class="console-nav-icon" aria-hidden="true">${item.icon}</span>
      <span class="console-nav-label">${item.label}</span>
    `;
    return link;
  }

  function relocateFloatingTools() {
    const tools = document.querySelector('.console-topbar-tools');
    const dock = document.querySelector('.console-floating-tools');
    if (!tools || !dock) {
      return;
    }
    Array.from(dock.children).forEach(child => {
      if (!(child instanceof HTMLElement)) return;
      child.classList.add('console-topbar-tool');
      tools.appendChild(child);
    });
    if (dock.children.length === 0) {
      dock.remove();
    }
  }

  const globalSearchState = {
    controller: null,
    requestId: 0,
    selectedIndex: -1,
    items: [],
    debounce: null,
  };

  function escapeHtml(value) {
    const text = String(value ?? '');
    if (window.CrystelfUi?.escapeHtml) {
      return window.CrystelfUi.escapeHtml(text);
    }
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createDebouncedTask(fn, delay = 220) {
    if (typeof window.CrystelfUi?.debounce === 'function') {
      return window.CrystelfUi.debounce(fn, delay);
    }
    let timer = null;
    const task = (...args) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        fn(...args);
      }, delay);
    };
    task.cancel = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
    };
    return task;
  }

  function getGlobalSearchElements() {
    return {
      root: document.querySelector('.console-global-search'),
      input: document.getElementById('console-global-search-input'),
      clear: document.getElementById('console-global-search-clear'),
      panel: document.getElementById('console-global-search-panel'),
    };
  }

  function abortGlobalSearchRequest() {
    try {
      globalSearchState.controller?.abort?.();
    } catch {
      // Ignore abort errors in older browser runtimes.
    }
    globalSearchState.controller = null;
  }

  function setGlobalSearchOpen(open) {
    const { root, panel, input } = getGlobalSearchElements();
    if (!root || !panel || !input) return;
    root.classList.toggle('is-open', open);
    panel.classList.toggle('hidden', !open);
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setGlobalSearchSelection(index) {
    const items = globalSearchState.items;
    if (!items.length) {
      globalSearchState.selectedIndex = -1;
      return;
    }
    const nextIndex = Math.max(0, Math.min(items.length - 1, index));
    globalSearchState.selectedIndex = nextIndex;
    const { panel, input } = getGlobalSearchElements();
    panel?.querySelectorAll('[data-global-search-index]').forEach(element => {
      const selected = Number(element.getAttribute('data-global-search-index')) === nextIndex;
      element.classList.toggle('is-selected', selected);
      if (selected) {
        input?.setAttribute('aria-activedescendant', element.id || '');
        element.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function renderGlobalSearchMessage(title, detail = '') {
    const { panel } = getGlobalSearchElements();
    if (!panel) return;
    globalSearchState.items = [];
    globalSearchState.selectedIndex = -1;
    panel.innerHTML = `
      <div class="console-global-search-empty">
        <strong>${escapeHtml(title)}</strong>
        ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
      </div>
    `;
    setGlobalSearchOpen(true);
  }

  function renderGlobalSearchResults(data = {}) {
    const { panel } = getGlobalSearchElements();
    if (!panel) return;
    const items = Array.isArray(data.items) ? data.items : [];
    globalSearchState.items = items;
    globalSearchState.selectedIndex = items.length > 0 ? 0 : -1;
    if (items.length <= 0) {
      renderGlobalSearchMessage('没有找到匹配结果', '换一个关键词试试，例如“命令”“API”“群管理”或“依赖”。');
      return;
    }
    const query = String(data.query || '').trim();
    panel.innerHTML = `
      <div class="console-global-search-head">
        <span>${query ? `搜索“${escapeHtml(query)}”` : '快捷入口'}</span>
        <small>${escapeHtml(String(data.summary?.total || items.length))} 条结果</small>
      </div>
      <div class="console-global-search-list">
        ${items.map((item, index) => `
          <a id="console-global-search-result-${index}" class="console-global-search-item${index === 0 ? ' is-selected' : ''}" href="${escapeHtml(item.href || '/index.html')}" data-global-search-index="${index}">
            <span class="console-global-search-type">${escapeHtml(item.typeLabel || '结果')}</span>
            <span class="console-global-search-copy">
              <strong>${escapeHtml(item.title || '未命名结果')}</strong>
              <small>${escapeHtml(item.description || item.href || '')}</small>
            </span>
            ${item.badge ? `<span class="console-global-search-badge">${escapeHtml(item.badge)}</span>` : ''}
          </a>
        `).join('')}
      </div>
    `;
    getGlobalSearchElements().input?.setAttribute('aria-activedescendant', 'console-global-search-result-0');
    setGlobalSearchOpen(true);
  }

  async function fetchGlobalSearch(query = '') {
    abortGlobalSearchRequest();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    globalSearchState.controller = controller;
    const url = `/api/global-search?q=${encodeURIComponent(query)}&limit=14`;
    if (typeof window.CrystelfRequest?.fetchJson === 'function') {
      return await window.CrystelfRequest.fetchJson(url, controller?.signal ? { signal: controller.signal, cancelOnAbort: true } : {});
    }
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller?.signal,
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || `全局搜索请求失败：${response.status}`);
    }
    return data;
  }

  async function runGlobalSearch(query = '') {
    const requestId = ++globalSearchState.requestId;
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      abortGlobalSearchRequest();
      renderGlobalSearchMessage('搜索控制台', '输入页面、命令、设置项或插件名称。按 / 可快速聚焦。');
      return;
    }
    renderGlobalSearchMessage('正在搜索...', '正在从页面、命令、设置和插件目录中查找。');
    try {
      const result = await fetchGlobalSearch(normalizedQuery);
      if (requestId !== globalSearchState.requestId) return;
      renderGlobalSearchResults(result?.data || result);
    } catch (error) {
      if (requestId !== globalSearchState.requestId || window.CrystelfRequest?.isCanceled?.(error)) return;
      renderGlobalSearchMessage('搜索失败', error.message || '全局搜索接口暂时不可用。');
    }
  }

  function openSelectedGlobalSearchResult() {
    const item = globalSearchState.items[globalSearchState.selectedIndex];
    if (!item?.href) return false;
    window.location.href = item.href;
    return true;
  }

  function bindGlobalSearch() {
    const { root, input, clear, panel } = getGlobalSearchElements();
    if (!root || !input || !clear || !panel) return;
    globalSearchState.debounce = createDebouncedTask(() => runGlobalSearch(input.value), 220);
    input.addEventListener('focus', () => {
      if (!input.value.trim()) {
        renderGlobalSearchMessage('搜索控制台', '输入页面、命令、设置项或插件名称。按 / 可快速聚焦。');
        return;
      }
      runGlobalSearch(input.value);
    });
    input.addEventListener('input', () => {
      clear.classList.toggle('hidden', !input.value);
      globalSearchState.debounce?.();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setGlobalSearchSelection(globalSearchState.selectedIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setGlobalSearchSelection(globalSearchState.selectedIndex - 1);
      } else if (event.key === 'Enter') {
        if (openSelectedGlobalSearchResult()) event.preventDefault();
      } else if (event.key === 'Escape') {
        setGlobalSearchOpen(false);
        input.blur();
      }
    });
    clear.addEventListener('click', () => {
      input.value = '';
      clear.classList.add('hidden');
      renderGlobalSearchMessage('搜索控制台', '输入页面、命令、设置项或插件名称。按 / 可快速聚焦。');
      input.focus();
    });
    panel.addEventListener('mousemove', event => {
      const target = event.target.closest('[data-global-search-index]');
      if (!target) return;
      setGlobalSearchSelection(Number(target.getAttribute('data-global-search-index')) || 0);
    });
    document.addEventListener('pointerdown', event => {
      if (root.contains(event.target)) return;
      setGlobalSearchOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== '/' || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      const tagName = String(target?.tagName || '').toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable) return;
      event.preventDefault();
      input.focus();
      input.select();
    });
    // Ctrl/Cmd + K 聚焦搜索（对齐 artd.pro）
    document.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || String(event.key).toLowerCase() !== 'k') return;
      event.preventDefault();
      input.focus();
      input.select();
    });
  }
  function ensureShell() {
    if (document.querySelector('.console-app-shell')) {
      return;
    }

    const page = document.querySelector('.page');
    if (!page) {
      return;
    }

    const shell = document.createElement('div');
    shell.className = 'console-app-shell';

    const sidebar = document.createElement('aside');
    sidebar.className = 'console-sidebar';
    const currentPath = normalizePath(window.location.pathname || '/index.html');
    // 顶栏面包屑：优先精确激活项；灵晶设置页（带/不带分组参数）都归属灵晶设置根项
    const activeNavigationItem = navigation.find(item => isActive(item, currentPath))
      || (normalizePath(currentPath) === '/plugin-settings.html' ? navigation.find(item => item.lingjing) : null)
      || navigation[0];
    sidebar.innerHTML = `
      <a class="console-brand" href="/index.html" aria-label="返回控制台首页">
        <span class="console-brand-mark">M</span>
        <span>
          <span class="console-brand-title">魔丸控制台</span>
          <span class="console-brand-subtitle">机器人运营中心</span>
        </span>
      </a>
      <nav class="console-nav" aria-label="控制台导航"></nav>
    `;
    const nav = sidebar.querySelector('.console-nav');
    let currentGroup = '';

    // 分组折叠：交互与样式参考 Art Design Pro（MIT License，https://www.artd.pro）。
    // 分组标题可点击收起/展开；记忆存 localStorage；无记忆时手机端默认全收起，桌面端默认全展开。
    const NAV_GROUP_COLLAPSE_KEY = 'crystelf-console-nav-group-collapsed';
    let navGroupState = {};
    try {
      const raw = JSON.parse(localStorage.getItem(NAV_GROUP_COLLAPSE_KEY) || '{}');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) navGroupState = raw;
    } catch {
      navGroupState = {};
    }

    function isMobileViewport() {
      return window.matchMedia('(max-width: 900px)').matches;
    }

    function setNavGroupCollapsed(toggle, linksBox, collapsed) {
      linksBox.classList.toggle('is-collapsed', collapsed);
      toggle.classList.toggle('is-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    const NAV_CHEVRON_SVG = '<svg class="console-nav-chevron" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const renderNavItems = items => {
      nav.innerHTML = '';
      currentGroup = '';
      let linksBox = nav;
      const groups = [];
      const groupCounts = new Map();
      items.forEach(item => {
        const group = String(item.group || '').trim();
        if (group) groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
      });
      items.forEach(item => {
        const group = String(item.group || '').trim();
        if (group && group !== currentGroup) {
          currentGroup = group;
          // 灵晶设置：三级嵌套（分组行 → 分类行 → 分组链接）
          if (item.lingjing) {
            const built = renderLingjingGroup(item, groups);
            if (built) return;
            // 结构未加载：先按普通链接渲染，数据到位后会整体重渲染
            nav.appendChild(createNavItem(item, currentPath));
            return;
          }
          // 单条目分组直接渲染为一级链接（如「系统设置」），不生成折叠分组
          if ((groupCounts.get(group) || 0) === 1) {
            nav.appendChild(createNavItem(item, currentPath));
            return;
          }
          const wrap = document.createElement('div');
          wrap.className = 'console-nav-group';
          wrap.dataset.consoleNavGroup = group;
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'console-nav-section';
          toggle.setAttribute('aria-expanded', 'true');
          // 分组图标复用该组第一个入口的图标，视觉上和 artd.pro 的菜单行对齐
          toggle.innerHTML = `<span class="console-nav-icon" aria-hidden="true">${escapeHtml(item.icon || '')}</span><span class="console-nav-section-label">${escapeHtml(group)}</span>${NAV_CHEVRON_SVG}`;
          linksBox = document.createElement('div');
          linksBox.className = 'console-nav-group-links';
          const inner = document.createElement('div');
          inner.className = 'console-nav-group-links-inner';
          linksBox.appendChild(inner);
          wrap.appendChild(toggle);
          wrap.appendChild(linksBox);
          nav.appendChild(wrap);
          groups.push({ group, toggle, linksBox, inner });
        }
        linksBox.firstChild.appendChild(createNavItem(item, currentPath));
      });
      groups.forEach(({ group, toggle, linksBox: box }) => {
        const stored = navGroupState[group];
        const collapsed = typeof stored === 'boolean'
          ? stored
          : isMobileViewport();
        setNavGroupCollapsed(toggle, box, collapsed);
        // rail 模式下该组包含当前页时，图标行高亮（对齐 artd.pro）
        if (box.querySelector('a.active')) toggle.classList.add('has-active');
        toggle.addEventListener('click', () => {
          const nowCollapsed = !box.classList.contains('is-collapsed');
          setNavGroupCollapsed(toggle, box, nowCollapsed);
          navGroupState[group] = nowCollapsed;
          try {
            localStorage.setItem(NAV_GROUP_COLLAPSE_KEY, JSON.stringify(navGroupState));
          } catch {
            // 隐私模式等 localStorage 不可用时仅本次会话生效
          }
        });
      });
    };

    // 灵晶设置分组：二级为分类（可折叠行），三级为分组链接；返回分组结构供统一的折叠逻辑处理
    function renderLingjingGroup(item, groups) {
      if (!lingjingTree.length) return null;
      const wrap = document.createElement('div');
      wrap.className = 'console-nav-group';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'console-nav-section';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.dataset.lingjingRoot = '1';
      toggle.innerHTML = `<span class="console-nav-icon" aria-hidden="true">${escapeHtml(item.icon || '')}</span><span class="console-nav-section-label">${escapeHtml(item.label)}</span>${NAV_CHEVRON_SVG}`;
      const linksBox = document.createElement('div');
      linksBox.className = 'console-nav-group-links';
      const inner = document.createElement('div');
      inner.className = 'console-nav-group-links-inner';
      linksBox.appendChild(inner);
      wrap.appendChild(toggle);
      wrap.appendChild(linksBox);
      nav.appendChild(wrap);

      lingjingTree.forEach(cat => {
        const sub = document.createElement('div');
        sub.className = 'console-nav-subgroup';
        const hasActiveLeaf = normalizePath(window.location.pathname) === normalizePath(item.href)
          && cat.key === currentCategory
          && cat.groups.includes(currentGroup);
        const subToggle = document.createElement('button');
        subToggle.type = 'button';
        subToggle.className = 'console-nav-subsection';
        subToggle.setAttribute('aria-expanded', 'false');
        subToggle.innerHTML = `<span class="console-nav-subsection-label">${escapeHtml(cat.label)}</span>${NAV_CHEVRON_SVG}`;
        const subLinks = document.createElement('div');
        subLinks.className = 'console-nav-subgroup-links';
        const subInner = document.createElement('div');
        subInner.className = 'console-nav-subgroup-links-inner';
        cat.groups.forEach(groupName => {
          // 已迁到系统设置页的分组：叶子直接指向系统设置页
          const migrated = MIGRATED_LINGJING_GROUPS.has(groupName);
          subInner.appendChild(createNavItem({
            group: item.group,
            href: migrated
              ? '/system-settings.html'
              : `/plugin-settings.html?category=${encodeURIComponent(cat.key)}&group=${encodeURIComponent(groupName)}`,
            label: groupName,
            icon: '',
            lingjingCategory: migrated ? '__system__' : cat.key,
            lingjingGroup: migrated ? '__system__' : groupName,
          }, currentPath));
        });
        subLinks.appendChild(subInner);
        sub.appendChild(subToggle);
        sub.appendChild(subLinks);
        inner.appendChild(sub);
        // 分类折叠：默认收起，仅当前所在分类展开
        const collapsed = !hasActiveLeaf;
        subLinks.classList.add('is-collapsed');
        subToggle.classList.add('is-collapsed');
        if (!collapsed) {
          subLinks.classList.remove('is-collapsed');
          subToggle.classList.remove('is-collapsed');
          subToggle.setAttribute('aria-expanded', 'true');
        }
        subToggle.addEventListener('click', () => {
          const nowCollapsed = !subLinks.classList.contains('is-collapsed');
          subLinks.classList.toggle('is-collapsed', nowCollapsed);
          subToggle.classList.toggle('is-collapsed', nowCollapsed);
          subToggle.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
        });
      });
      groups.push({ group: item.group, toggle, linksBox, inner });
      return true;
    }
    renderNavItems(navigation);

    // rail 模式（收起侧边栏）悬浮二级菜单：hover 分组图标在右侧弹出子项面板。
    // 行为与视觉对齐 Art Design Pro 的 el-menu collapse popper（MIT License）。
    const navFlyout = document.createElement('div');
    navFlyout.className = 'console-nav-flyout';
    document.body.appendChild(navFlyout);
    // 灵晶设置的第三级悬浮面板：hover 二级分类后在右侧弹出分组列表
    const navFlyoutSub = document.createElement('div');
    navFlyoutSub.className = 'console-nav-flyout console-nav-flyout-sub';
    document.body.appendChild(navFlyoutSub);
    let navFlyoutHideTimer = null;
    let navFlyoutSection = null;

    function hideNavFlyout() {
      navFlyout.classList.remove('is-open');
      navFlyoutSub.classList.remove('is-open');
      navFlyoutSection = null;
    }

    function showLingjingFlyout(sectionButton) {
      if (!lingjingTree.length) return;
      navFlyoutSection = sectionButton;
      navFlyout.innerHTML = lingjingTree.map(cat => `
        <div class="console-flyout-group" data-lingjing-cat="${escapeHtml(cat.key)}">
          <div class="console-flyout-group-row">
            <span>${escapeHtml(cat.label)}</span>
            <span class="console-flyout-more">›</span>
          </div>
        </div>
      `).join('');
      navFlyout.classList.add('is-open');
      navFlyoutSub.classList.remove('is-open');
      const rect = sectionButton.getBoundingClientRect();
      navFlyout.style.left = `${rect.right + 10}px`;
      navFlyout.style.top = `${Math.max(10, Math.min(rect.top - 6, window.innerHeight - navFlyout.offsetHeight - 10))}px`;
    }

    function showNavFlyout(sectionButton) {
      if (!document.body.classList.contains('console-sidebar-collapsed')) return;
      if (window.matchMedia('(max-width: 900px)').matches) return;
      if (sectionButton.dataset.lingjingRoot === '1') {
        showLingjingFlyout(sectionButton);
        return;
      }
      navFlyoutSub.classList.remove('is-open');
      const groupWrap = sectionButton.closest('.console-nav-group');
      const links = groupWrap ? [...groupWrap.querySelectorAll('.console-nav-group-links a')] : [];
      if (!links.length) return;
      navFlyout.innerHTML = '';
      links.forEach(link => {
        // 不克隆节点：rail 规则会隐藏 .console-nav-label，悬浮项改为纯文字重建
        const item = document.createElement('a');
        item.href = link.href;
        item.className = `console-flyout-item${link.classList.contains('active') ? ' active' : ''}`;
        item.title = link.title || '';
        if (link.target) {
          item.target = '_blank';
          item.rel = 'noopener';
        }
        item.innerHTML = `<span class="console-flyout-text">${escapeHtml(link.querySelector('.console-nav-label')?.textContent.trim() || link.textContent.trim())}</span>`;
        item.addEventListener('click', hideNavFlyout);
        navFlyout.appendChild(item);
      });
      navFlyout.classList.add('is-open');
      const rect = sectionButton.getBoundingClientRect();
      const top = Math.max(10, Math.min(rect.top - 6, window.innerHeight - navFlyout.offsetHeight - 10));
      navFlyout.style.left = `${rect.right + 10}px`;
      navFlyout.style.top = `${top}px`;
      navFlyoutSection = sectionButton;
    }

    // 悬浮面板内的灵晶分类行：hover 展开第三级分组列表（对齐 artd.pro 嵌套菜单）
    navFlyout.addEventListener('mouseover', event => {
      const row = event.target.closest('.console-flyout-group');
      if (!row) {
        navFlyoutSub.classList.remove('is-open');
        return;
      }
      const cat = lingjingTree.find(entry => entry.key === row.dataset.lingjingCat);
      if (!cat || !cat.groups.length) {
        navFlyoutSub.classList.remove('is-open');
        return;
      }
      navFlyoutSub.innerHTML = cat.groups.map(groupName => {
        const migrated = MIGRATED_LINGJING_GROUPS.has(groupName);
        const href = migrated
          ? '/system-settings.html'
          : `/plugin-settings.html?category=${encodeURIComponent(cat.key)}&group=${encodeURIComponent(groupName)}`;
        const active = !migrated
          && normalizePath(window.location.pathname) === '/plugin-settings.html'
          && cat.key === currentCategory
          && groupName === currentGroup;
        return `<a class="console-flyout-item${active ? ' active' : ''}" href="${href}"><span class="console-flyout-text">${escapeHtml(groupName)}</span></a>`;
      }).join('');
      navFlyoutSub.classList.add('is-open');
      const flyRect = navFlyout.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      navFlyoutSub.style.left = `${flyRect.right + 8}px`;
      navFlyoutSub.style.top = `${Math.max(10, Math.min(rowRect.top - 8, window.innerHeight - navFlyoutSub.offsetHeight - 10))}px`;
    });
    navFlyoutSub.addEventListener('mouseenter', () => clearTimeout(navFlyoutHideTimer));
    navFlyoutSub.addEventListener('mouseleave', () => {
      navFlyoutHideTimer = setTimeout(hideNavFlyout, 160);
    });

    nav.addEventListener('mouseover', event => {
      const sectionButton = event.target.closest('.console-nav-section');
      if (!sectionButton || sectionButton === navFlyoutSection) return;
      clearTimeout(navFlyoutHideTimer);
      showNavFlyout(sectionButton);
    });
    nav.addEventListener('mouseleave', () => {
      navFlyoutHideTimer = setTimeout(hideNavFlyout, 160);
    });
    navFlyout.addEventListener('mouseenter', () => clearTimeout(navFlyoutHideTimer));
    navFlyout.addEventListener('mouseleave', () => {
      navFlyoutHideTimer = setTimeout(hideNavFlyout, 160);
    });
    window.addEventListener('resize', hideNavFlyout);

    // 服务端导航配置（插件设置 → 导航设置）：隐藏指定项 + 追加自定义链接。
    // 当前页对应的入口即使被隐藏也保留，避免用户在当前页失去侧边栏落点。
    fetch('/api/console-nav', { cache: 'no-store' }).then(response => response.json()).then(data => {
      const conf = data?.consoleNav || {};
      const hidden = new Set(Array.isArray(conf.hidden) ? conf.hidden.map(String) : []);
      const custom = Array.isArray(conf.custom) ? conf.custom : [];
      if (!hidden.size && !custom.length) return;
      const effective = navigation
        .filter(item => !hidden.has(item.href) || isActive(item, currentPath))
        .concat(custom.map(link => ({
          group: '自定义',
          href: link.url,
          label: link.label,
          icon: '↗',
          external: true,
        })));
      // 「系统设置」「更新日志」固定排最后两位：更新日志在最末
      const sysIndex = effective.findIndex(item => item.href === '/system-settings.html');
      if (sysIndex !== -1) {
        effective.push(...effective.splice(sysIndex, 1));
      }
      const logIndex = effective.findIndex(item => item.href === '/update-log.html');
      if (logIndex !== -1) {
        effective.push(...effective.splice(logIndex, 1));
      }
      lastNavItems = effective;
      renderNavItems(effective);
    }).catch(() => { });

    // 灵晶设置子树：从插件设置接口读取分类/分组结构，就绪后重渲染侧边栏
    fetch('/api/plugin-settings', { cache: 'no-store' }).then(response => response.json()).then(data => {
      const cats = Array.isArray(data?.categories) ? data.categories : [];
      const allItems = Array.isArray(data?.items) ? data.items : [];
      lingjingTree = cats
        .map(cat => ({
          key: String(cat.key || ''),
          label: String(cat.label || cat.key || ''),
          groups: [...new Set(allItems.filter(item => item.category === cat.key).map(item => String(item.group || '')).filter(Boolean))],
        }))
        .filter(cat => cat.key && cat.groups.length > 0);
      if (lingjingTree.length && lastNavItems) {
        renderNavItems(lastNavItems);
      }
    }).catch(() => { });

    // 折叠开关已移至顶栏第一个按钮（对齐 artd.pro），侧栏底部不再放置按钮

    const SIDEBAR_COLLAPSE_KEY = 'crystelf-console-sidebar-collapsed';
    let sidebarCollapsed = false;
    try {
      sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
    } catch {
      sidebarCollapsed = false;
    }

    function applySidebarCollapsed(collapsed) {
      document.body.classList.toggle('console-sidebar-collapsed', collapsed);
      if (collapsed === false) hideNavFlyout();
    }

    applySidebarCollapsed(sidebarCollapsed);

    sidebar.id = 'console-sidebar';

    const main = document.createElement('main');
    main.className = 'console-main';

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'console-sidebar-backdrop';
    backdrop.setAttribute('aria-label', '关闭控制台导航');

    const topbar = document.createElement('div');
    topbar.className = 'console-topbar';
    // 图标取自 Remix Icon（Apache-2.0），与 Art Design Pro 的图标库一致
    const TOPBAR_ICONS = {
      menu: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 4H21V6H3V4ZM3 11H15V13H3V11ZM3 18H21V20H3V18Z"/></svg>',
      search: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748Z"/></svg>',
      settings: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.33946 17.0002C2.90721 16.2515 2.58277 15.4702 2.36133 14.6741C3.3338 14.1779 3.99972 13.1668 3.99972 12.0002C3.99972 10.8345 3.3348 9.824 2.36353 9.32741C2.81025 7.71651 3.65857 6.21627 4.86474 4.99001C5.7807 5.58416 6.98935 5.65534 7.99972 5.072C9.01009 4.48866 9.55277 3.40635 9.4962 2.31604C11.1613 1.8846 12.8847 1.90004 14.5031 2.31862C14.4475 3.40806 14.9901 4.48912 15.9997 5.072C17.0101 5.65532 18.2187 5.58416 19.1346 4.99007C19.7133 5.57986 20.2277 6.25151 20.66 7.00021C21.0922 7.7489 21.4167 8.53025 21.6381 9.32628C20.6656 9.82247 19.9997 10.8336 19.9997 12.0002C19.9997 13.166 20.6646 14.1764 21.6359 14.673C21.1892 16.2839 20.3409 17.7841 19.1347 19.0104C18.2187 18.4163 17.0101 18.3451 15.9997 18.9284C14.9893 19.5117 14.4467 20.5941 14.5032 21.6844C12.8382 22.1158 11.1148 22.1004 9.49633 21.6818C9.55191 20.5923 9.00929 19.5113 7.99972 18.9284C6.98938 18.3451 5.78079 18.4162 4.86484 19.0103C4.28617 18.4205 3.77172 17.7489 3.33946 17.0002ZM8.99972 17.1964C10.0911 17.8265 10.8749 18.8227 11.2503 19.9659C11.7486 20.0133 12.2502 20.014 12.7486 19.9675C13.1238 18.8237 13.9078 17.8268 14.9997 17.1964C16.0916 16.5659 17.347 16.3855 18.5252 16.6324C18.8146 16.224 19.0648 15.7892 19.2729 15.334C18.4706 14.4373 17.9997 13.2604 17.9997 12.0002C17.9997 10.74 18.4706 9.5632 19.2729 8.6665C19.1688 8.4405 19.0538 8.21822 18.9279 8.00021C18.802 7.78219 18.667 7.57148 18.5233 7.36842C17.3457 7.61476 16.0911 7.43414 14.9997 6.80405C13.9083 6.17395 13.1246 5.17768 12.7491 4.03455C12.2509 3.98714 11.7492 3.98646 11.2509 4.03292C10.8756 5.17671 10.0916 6.17364 8.99972 6.80405C7.9078 7.43447 6.65245 7.61494 5.47428 7.36803C5.18485 7.77641 4.93463 8.21117 4.72656 8.66637C5.52881 9.56311 5.99972 10.74 5.99972 12.0002C5.99972 13.2604 5.52883 14.4372 4.72656 15.3339C4.83067 15.5599 4.94564 15.7822 5.07152 16.0002C5.19739 16.2182 5.3324 16.4289 5.47612 16.632C6.65377 16.3857 7.90838 16.5663 8.99972 17.1964ZM11.9997 15.0002C10.3429 15.0002 8.99972 13.6571 8.99972 12.0002C8.99972 10.3434 10.3429 9.00021 11.9997 9.00021C13.6566 9.00021 14.9997 10.3434 14.9997 12.0002C14.9997 13.6571 13.6566 15.0002 11.9997 15.0002ZM11.9997 13.0002C12.552 13.0002 12.9997 12.5525 12.9997 12.0002C12.9997 11.4479 12.552 11.0002 11.9997 11.0002C11.4474 11.0002 10.9997 11.4479 10.9997 12.0002C10.9997 12.5525 11.4474 13.0002 11.9997 13.0002Z"/></svg>',
            bell: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 17h2v2H2v-2h2v-7a8 8 0 1 1 16 0zm-2 0v-7a6 6 0 0 0-12 0v7zm-9 4h6v2H9z"/></svg>',
close: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z"/></svg>',
      check: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z"/></svg>',
    };
    topbar.innerHTML = `
      <button type="button" class="console-sidebar-toggle" aria-label="切换控制台导航" aria-expanded="false">${TOPBAR_ICONS.menu}</button>
      <div class="console-topbar-title">
        <span class="console-topbar-eyebrow">魔丸控制台 / ${activeNavigationItem.group}</span>
        <strong>${activeNavigationItem.label || document.title.replace(/^魔丸控制台\s*-?\s*/, '') || '控制台'}</strong>
      </div>
      <div class="console-global-search" role="search">
        <span class="console-global-search-icon" aria-hidden="true">${TOPBAR_ICONS.search}</span>
        <input id="console-global-search-input" type="search" placeholder="搜索" autocomplete="off" aria-label="全局搜索" aria-expanded="false" aria-controls="console-global-search-panel" />
        <button id="console-global-search-clear" class="console-global-search-clear hidden" type="button" aria-label="清空搜索">×</button>
        <kbd class="console-search-kbd" aria-hidden="true">Ctrl K</kbd>
        <div id="console-global-search-panel" class="console-global-search-panel hidden" role="listbox">
          <div class="console-global-search-empty"><strong>搜索控制台</strong><span>输入页面、命令、设置项或插件名称。</span></div>
        </div>
      </div>
      <button type="button" class="console-notifications-btn" aria-label="通知">${TOPBAR_ICONS.bell}<span class="console-notifications-dot hidden"></span></button>
      <button type="button" class="console-theme-settings-btn" aria-label="主题设置">${TOPBAR_ICONS.settings}</button>
      <div class="console-topbar-tools" aria-label="控制台工具"></div>
    `;

    page.parentNode.insertBefore(shell, page);
    shell.appendChild(sidebar);
    shell.appendChild(backdrop);
    shell.appendChild(main);
    main.appendChild(topbar);
    main.appendChild(page);

    const toggle = topbar.querySelector('.console-sidebar-toggle');
    toggle?.addEventListener('click', () => {
      // 对齐 artd.pro：桌面端第一个按钮折叠/展开导航栏（rail），手机端开合抽屉
      if (window.matchMedia('(max-width: 900px)').matches) {
        const open = !document.body.classList.contains('console-sidebar-open');
        document.body.classList.toggle('console-sidebar-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      applySidebarCollapsed(!document.body.classList.contains('console-sidebar-collapsed'));
    });
    backdrop.addEventListener('click', () => {
      document.body.classList.remove('console-sidebar-open');
      toggle?.setAttribute('aria-expanded', 'false');
    });
    nav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        document.body.classList.remove('console-sidebar-open');
        toggle?.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      document.body.classList.remove('console-sidebar-open');
      toggle?.setAttribute('aria-expanded', 'false');
    });
    // 吸顶悬浮：页面滚动后加毛玻璃垫底，停在顶部时保持全透明
    const syncTopbarStuck = () => {
      topbar.classList.toggle('console-topbar-stuck', window.scrollY > 6);
    };
    syncTopbarStuck();
    window.addEventListener('scroll', syncTopbarStuck, { passive: true });
    bindGlobalSearch();
    relocateFloatingTools();
    window.setTimeout(relocateFloatingTools, 0);

    // 主题设置抽屉（结构对齐 Art Design Pro SettingsPanel，MIT License）
    const themeApi = window.CrystelfTheme || null;
    const ACCENT_DOT_COLORS = {
      cyan: '#22d3ee',
      emerald: '#10b981',
      violet: '#8b5cf6',
      rose: '#f43f5e',
      amber: '#f59e0b',
      slate: '#64748b',
    };
    const settingsRoot = document.createElement('div');
    settingsRoot.className = 'console-settings-drawer';
    settingsRoot.setAttribute('role', 'dialog');
    settingsRoot.setAttribute('aria-label', '主题设置');
    settingsRoot.innerHTML = `
      <div class="console-settings-mask"></div>
      <aside class="console-settings-panel">
        <header class="console-settings-head">
          <strong>主题设置</strong>
          <button type="button" class="console-settings-close" aria-label="关闭主题设置">${TOPBAR_ICONS.close}</button>
        </header>
        <div class="console-settings-body">
          <h4>主题风格</h4>
          <div class="console-settings-mode-grid">
            ${(themeApi?.modes || []).map(mode => `
              <button type="button" class="console-settings-mode-card" data-settings-mode="${mode.value}">
                <span class="console-mode-preview mode-${mode.value}"><i></i><i></i></span>
                <span class="console-settings-mode-label">${mode.label}</span>
              </button>`).join('')}
          </div>
          <h4>系统主题色</h4>
          <div class="console-settings-accent-grid">
            ${(themeApi?.accents || []).map(accent => `
              <button type="button" class="console-settings-accent" data-settings-accent="${accent.value}" title="${accent.label}">
                <span class="console-settings-accent-dot" style="background:${ACCENT_DOT_COLORS[accent.value] || 'var(--primary)'}">${TOPBAR_ICONS.check}</span>
              </button>`).join('')}
          </div>
          <h4>盒子样式</h4>
          <div class="console-settings-boxseg">
            <button type="button" data-settings-box="border">边框</button>
            <button type="button" data-settings-box="shadow">阴影</button>
          </div>
          <h4>壁纸</h4>
          <div class="console-settings-row">
            <span class="console-settings-row-label">随机切换控制台壁纸</span>
            <button type="button" id="console-bg-refresh-btn" class="console-settings-action-btn">换一张</button>
          </div>
        </div>
      </aside>
    `;
    document.body.appendChild(settingsRoot);

    function renderSettingsState() {
      const state = themeApi?.getState?.() || {};
      settingsRoot.querySelectorAll('[data-settings-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.settingsMode === state.mode);
      });
      settingsRoot.querySelectorAll('[data-settings-accent]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.settingsAccent === state.accent);
      });
      settingsRoot.querySelectorAll('[data-settings-box]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.settingsBox === (themeApi?.getBoxStyle?.() || 'border'));
      });
    }
    function openThemeSettings() {
      renderSettingsState();
      settingsRoot.classList.add('is-open');
    }
    function closeThemeSettings() {
      settingsRoot.classList.remove('is-open');
    }
    topbar.querySelector('.console-theme-settings-btn')?.addEventListener('click', openThemeSettings);
    settingsRoot.querySelector('.console-settings-close')?.addEventListener('click', closeThemeSettings);
    settingsRoot.querySelector('.console-settings-mask')?.addEventListener('click', closeThemeSettings);
    settingsRoot.querySelectorAll('[data-settings-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        themeApi?.setMode?.(btn.dataset.settingsMode);
        renderSettingsState();
      });
    });
    settingsRoot.querySelectorAll('[data-settings-accent]').forEach(btn => {
      btn.addEventListener('click', () => {
        themeApi?.setAccent?.(btn.dataset.settingsAccent);
        renderSettingsState();
      });
    });
    settingsRoot.querySelectorAll('[data-settings-box]').forEach(btn => {
      btn.addEventListener('click', () => {
        themeApi?.setBoxStyle?.(btn.dataset.settingsBox);
        renderSettingsState();
      });
    });
    window.addEventListener('crystelf-theme-change', renderSettingsState);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeThemeSettings();
    });

    // 壁纸按钮（对齐 artd SettingActions 的动作按钮）
    const wallpaperBtn = settingsRoot.querySelector('#console-bg-refresh-btn');
    wallpaperBtn?.addEventListener('click', async () => {
      if (wallpaperBtn.disabled) return;
      wallpaperBtn.disabled = true;
      wallpaperBtn.textContent = '切换中';
      try {
        await themeApi?.refreshBackground?.();
        wallpaperBtn.textContent = '已切换';
      } catch (error) {
        wallpaperBtn.textContent = '刷新失败';
        wallpaperBtn.title = error.message || '背景刷新失败';
      }
      window.setTimeout(() => {
        wallpaperBtn.disabled = false;
        wallpaperBtn.textContent = '换一张';
        wallpaperBtn.title = '刷新背景缓存并切换控制台壁纸';
      }, 1200);
    });

    // 通知面板：聚合健康巡检 / 版本更新 / 看门狗消息，铃铛未读红点。
    const NOTIFICATIONS_SEEN_KEY = 'crystelf-console-notifications-seen';
    const notificationsBtn = topbar.querySelector('.console-notifications-btn');
    const notificationsDot = topbar.querySelector('.console-notifications-dot');
    const notificationsPanel = document.createElement('div');
    notificationsPanel.className = 'console-notifications-panel hidden';
    notificationsPanel.setAttribute('role', 'dialog');
    notificationsPanel.setAttribute('aria-label', '通知');
    notificationsPanel.innerHTML = `
      <header class="console-notifications-head">
        <strong>通知</strong>
        <button type="button" class="console-notifications-read">全部已读</button>
      </header>
      <div class="console-notifications-list"><div class="console-notifications-empty">加载中...</div></div>
    `;
    document.body.appendChild(notificationsPanel);
    let notificationsOpen = false;
    let notificationsSeenAt = 0;
    try {
      notificationsSeenAt = Number(localStorage.getItem(NOTIFICATIONS_SEEN_KEY)) || 0;
    } catch {
      notificationsSeenAt = 0;
    }
    let notificationsLatestMs = 0;
    let notificationsItems = [];

    function setNotificationsSeen() {
      notificationsSeenAt = Date.now();
      try {
        localStorage.setItem(NOTIFICATIONS_SEEN_KEY, String(notificationsSeenAt));
      } catch {
        // 本地存储不可用时红点仅本次会话生效
      }
      updateNotificationsDot();
    }

    function updateNotificationsDot() {
      notificationsDot?.classList.toggle('hidden', notificationsLatestMs <= notificationsSeenAt);
    }

    function formatNotificationTime(value) {
      const time = new Date(value || 0);
      if (!value || Number.isNaN(time.getTime())) return '';
      const diff = Date.now() - time.getTime();
      if (diff >= 0 && diff < 60 * 1000) return '刚刚';
      if (diff >= 0 && diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
      if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
      return time.toLocaleString('zh-CN', { hour12: false });
    }

    function renderNotifications(payload = {}) {
      notificationsItems = Array.isArray(payload.items) ? payload.items : [];
      const list = notificationsPanel.querySelector('.console-notifications-list');
      if (!list) return;
      if (!notificationsItems.length) {
        list.innerHTML = '<div class="console-notifications-empty">暂无通知，一切运行正常。</div>';
        return;
      }
      const levelLabels = { error: '故障', warn: '警告', info: '更新' };
      list.innerHTML = notificationsItems.map(item => `
        <div class="console-notification-item level-${escapeHtml(item.level || 'info')}${item.link ? ' has-link' : ''}"${item.link ? ` data-link="${escapeHtml(item.link)}" title="点击前往处理"` : ''}>
          <span class="console-notification-chip">${escapeHtml(levelLabels[item.level] || '通知')}</span>
          <div class="console-notification-copy">
            <h4>${escapeHtml(item.title || '')}</h4>
            <p>${escapeHtml(item.detail || '')}</p>
            <time>${escapeHtml(formatNotificationTime(item.time))}</time>
          </div>
          ${item.link ? '<span class="console-notification-go">→</span>' : ''}
        </div>
      `).join('');
    }

    // 通知条目带 link 时点击跳转（如依赖缺失 → 依赖检查页）
    notificationsPanel.addEventListener('click', event => {
      const item = event.target.closest('.console-notification-item[data-link]');
      if (!item) return;
      const link = item.dataset.link;
      if (!link) return;
      notificationsPanel.classList.add('hidden');
      notificationsOpen = false;
      window.location.href = link;
    });

    async function refreshNotifications() {
      try {
        const payload = await fetchJson('/api/notifications');
        renderNotifications(payload);
        notificationsLatestMs = notificationsItems.reduce((latest, item) => {
          const ms = new Date(item.time || 0).getTime();
          return Number.isFinite(ms) ? Math.max(latest, ms) : latest;
        }, 0);
        updateNotificationsDot();
      } catch {
        // 通知拉取失败时静默，不打扰使用
      }
    }

    function toggleNotificationsPanel(open) {
      notificationsOpen = typeof open === 'boolean' ? open : !notificationsOpen;
      notificationsPanel.classList.toggle('hidden', !notificationsOpen);
      if (notificationsOpen) {
        const rect = notificationsBtn.getBoundingClientRect();
        const panelWidth = 320;
        notificationsPanel.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 80)}px`;
        notificationsPanel.style.right = `${Math.max(10, window.innerWidth - rect.right - 6)}px`;
        refreshNotifications();
      }
    }

    notificationsBtn?.addEventListener('click', () => toggleNotificationsPanel());
    notificationsPanel.querySelector('.console-notifications-read')?.addEventListener('click', () => {
      setNotificationsSeen();
      toggleNotificationsPanel(false);
    });
    document.addEventListener('pointerdown', event => {
      if (!notificationsOpen) return;
      if (notificationsPanel.contains(event.target) || notificationsBtn.contains(event.target)) return;
      toggleNotificationsPanel(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') toggleNotificationsPanel(false);
    });
    refreshNotifications();
    window.setInterval(refreshNotifications, 120 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureShell);
  } else {
    ensureShell();
  }
})();
