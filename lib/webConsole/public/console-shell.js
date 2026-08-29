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
    { group: '群聊运营', href: '/group-summary-diagnostics.html', label: '群总结诊断', icon: '▨' },
    { group: '群聊运营', href: '/image-monitor-center.html', label: '图片监控', icon: '▧' },
    { group: '群聊运营', href: '/help-diy.html', label: '帮助设计', icon: '?' },

    { group: 'AI 能力', href: '/api-settings.html', label: 'API 接口', icon: '◈' },
    { group: 'AI 能力', href: '/usage-center.html', label: 'AI 用量', icon: '▤' },
    { group: 'AI 能力', href: '/sandbox-chat.html', label: '对话测试', icon: '✦' },
    { group: 'AI 能力', href: '/agent-workbench.html', label: 'Agent 工作台', icon: '⌬' },

    { group: '插件与系统', href: '/plugin-settings.html', label: '插件设置', icon: '⚙' },
    { group: '插件与系统', href: '/bot-plugins.html', label: '插件管理', icon: '▣', match: ['/bot-plugins.html', '/plugin-catalog.html'] },
    { group: '插件与系统', href: '/dependency-check.html', label: '依赖检查', icon: '✓' },
    { group: '插件与系统', href: '/file-browser.html', label: '文件编辑', icon: '⌘' },

    { group: '诊断与调试', href: '/qq-simulator.html', label: '模拟调试', icon: '◌' },
    { group: '诊断与调试', href: '/command-center.html', label: '命令中心', icon: '⌁' },
    { group: '诊断与调试', href: '/config-diagnostics.html', label: '配置诊断', icon: '◇' },
    { group: '诊断与调试', href: '/frontend-diagnostics.html', label: '前端诊断', icon: '!' },
    { group: '诊断与调试', href: '/performance.html', label: '性能监测', icon: '▥' },
    { group: '诊断与调试', href: '/audit-log-center.html', label: '审计日志', icon: '▤' },
    { group: '诊断与调试', href: '/bot-logs.html', label: 'Bot 日志', icon: '▤' },
  ];

  function normalizePath(pathname = '') {
    if (!pathname || pathname === '/') return '/index.html';
    return pathname;
  }

  function isActive(item, currentPath) {
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
    const activeNavigationItem = navigation.find(item => isActive(item, currentPath)) || navigation[0];
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
    navigation.forEach(item => {
      const group = String(item.group || '').trim();
      if (group && group !== currentGroup) {
        currentGroup = group;
        const heading = document.createElement('div');
        heading.className = 'console-nav-section';
        heading.dataset.consoleNavGroup = group;
        heading.textContent = group;
        nav.appendChild(heading);
      }
      nav.appendChild(createNavItem(item, currentPath));
    });

    const sidebarFoot = document.createElement('div');
    sidebarFoot.className = 'console-sidebar-foot';
    const collapseButton = document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.className = 'console-sidebar-collapse';
    collapseButton.setAttribute('aria-controls', 'console-sidebar');
    sidebarFoot.appendChild(collapseButton);
    sidebar.appendChild(sidebarFoot);

    const SIDEBAR_COLLAPSE_KEY = 'crystelf-console-sidebar-collapsed';
    let sidebarCollapsed = false;
    try {
      sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
    } catch {
      sidebarCollapsed = false;
    }

    function applySidebarCollapsed(collapsed) {
      document.body.classList.toggle('console-sidebar-collapsed', collapsed);
      collapseButton.innerHTML = collapsed ? '»' : '‹<span class="console-sidebar-collapse-label">收起侧边栏</span>';
      collapseButton.title = collapsed ? '展开侧边栏' : '收起侧边栏';
      collapseButton.setAttribute('aria-label', collapseButton.title);
      collapseButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    applySidebarCollapsed(sidebarCollapsed);
    collapseButton.addEventListener('click', () => {
      sidebarCollapsed = !sidebarCollapsed;
      applySidebarCollapsed(sidebarCollapsed);
      try {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, sidebarCollapsed ? '1' : '0');
      } catch {
        // 本地存储不可用时仅当次生效
      }
    });

    sidebar.id = 'console-sidebar';

    const main = document.createElement('main');
    main.className = 'console-main';

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'console-sidebar-backdrop';
    backdrop.setAttribute('aria-label', '关闭控制台导航');

    const topbar = document.createElement('div');
    topbar.className = 'console-topbar';
    topbar.innerHTML = `
      <button type="button" class="console-sidebar-toggle" aria-label="切换控制台导航" aria-expanded="false">☰</button>
      <div class="console-topbar-title">
        <span class="console-topbar-eyebrow">魔丸控制台 / ${activeNavigationItem.group}</span>
        <strong>${activeNavigationItem.label || document.title.replace(/^魔丸控制台\s*-?\s*/, '') || '控制台'}</strong>
      </div>
      <div class="console-global-search" role="search">
        <span class="console-global-search-icon" aria-hidden="true">⌕</span>
        <input id="console-global-search-input" type="search" placeholder="搜索页面 / 命令 / 设置 / 插件" autocomplete="off" aria-label="全局搜索" aria-expanded="false" aria-controls="console-global-search-panel" />
        <button id="console-global-search-clear" class="console-global-search-clear hidden" type="button" aria-label="清空搜索">×</button>
        <div id="console-global-search-panel" class="console-global-search-panel hidden" role="listbox">
          <div class="console-global-search-empty"><strong>搜索控制台</strong><span>输入页面、命令、设置项或插件名称。</span></div>
        </div>
      </div>
      <div class="console-topbar-tools" aria-label="控制台工具"></div>
      <div class="console-topbar-status">
        <span class="console-status-dot"></span>
        <span id="console-topbar-version">灵晶</span>
      </div>
    `;

    page.parentNode.insertBefore(shell, page);
    shell.appendChild(sidebar);
    shell.appendChild(backdrop);
    shell.appendChild(main);
    main.appendChild(topbar);
    main.appendChild(page);

    const toggle = topbar.querySelector('.console-sidebar-toggle');
    toggle?.addEventListener('click', () => {
      const open = !document.body.classList.contains('console-sidebar-open');
      document.body.classList.toggle('console-sidebar-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
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
    bindGlobalSearch();
    relocateFloatingTools();
    window.setTimeout(relocateFloatingTools, 0);

    const versionBadge = topbar.querySelector('#console-topbar-version');
    fetch('/api/overview', { cache: 'no-store', credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        const version = data?.plugin?.version;
        if (versionBadge && version) {
          versionBadge.textContent = `灵晶 ${version}`;
        }
      })
      .catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureShell);
  } else {
    ensureShell();
  }
})();
