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
    { group: '核心', href: '/index.html', label: '总览', icon: '⌂', match: ['/', '/index.html'] },
    { group: '核心', href: '/plugin-settings.html', label: '插件设置', icon: '⚙' },
    { group: '核心', href: '/api-settings.html', label: 'API 接口', icon: '◈' },
    { group: '核心', href: '/bot-plugins.html', label: '插件管理', icon: '▣', match: ['/bot-plugins.html', '/plugin-catalog.html'] },
    { group: '核心', href: '/group-management.html', label: '群管理', icon: '◎' },
    { group: '工具', href: '/qq-simulator.html', label: 'QQ 模拟器', icon: '◌' },
    { group: '工具', href: '/sandbox-chat.html', label: '对话测试', icon: '✦' },
    { group: '工具', href: '/file-browser.html', label: '文件编辑', icon: '⌘' },
    { group: '工具', href: '/dependency-check.html', label: '依赖检查', icon: '✓' },
    { group: '数据', href: '/performance.html', label: '性能监测', icon: '▥' },
    { group: '数据', href: '/usage-center.html', label: 'AI 用量', icon: '▤' },
    { group: '数据', href: '/image-monitor-center.html', label: '图片监控', icon: '▧' },
    { group: '数据', href: '/help-diy.html', label: '帮助 DIY', icon: '?' },
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
    link.className = `console-nav-link${isActive(item, currentPath) ? ' active' : ''}`;
    link.href = item.href;
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
    sidebar.innerHTML = `
      <a class="console-brand" href="/index.html" aria-label="返回控制台首页">
        <span class="console-brand-mark">C</span>
        <span>
          <span class="console-brand-title">Crystelf</span>
          <span class="console-brand-subtitle">Control Console</span>
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
        heading.textContent = group;
        nav.appendChild(heading);
      }
      nav.appendChild(createNavItem(item, currentPath));
    });

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
        <span class="console-topbar-eyebrow">魔丸控制台</span>
        <strong>${document.title.replace(/^魔丸控制台\s*-?\s*/, '') || '控制台'}</strong>
      </div>
      <div class="console-topbar-status">
        <span class="console-status-dot"></span>
        <span>本地控制台</span>
      </div>
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
    relocateFloatingTools();
    window.setTimeout(relocateFloatingTools, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureShell);
  } else {
    ensureShell();
  }
})();
