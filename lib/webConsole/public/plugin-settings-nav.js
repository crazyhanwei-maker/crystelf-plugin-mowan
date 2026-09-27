// 插件设置 → 导航设置：侧边栏显隐 + 自定义外部链接，保存到服务端 consoleNav 配置。
// 导航项清单直接从当前页侧边栏 DOM 读取（console-shell 渲染产物），避免与 shell 维护两份列表。
(function () {
  'use strict';

  const state = {
    items: [],      // { href, label, group, hidden }
    custom: [],     // { label, url }
    loaded: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message, tone = '') {
    const status = $('plugin-settings-nav-status');
    if (!status) return;
    status.textContent = message || '';
    status.className = `setting-status${tone ? ` tone-${tone}` : ''}`;
  }

  function collectSidebarItems() {
    // 优先读 shell 暴露的全量清单（隐藏项不在 DOM 里，必须从这里拿全）
    const fullList = Array.isArray(window.CrystelfConsoleNav) ? window.CrystelfConsoleNav : null;
    if (fullList?.length) {
      return fullList
        .filter(item => item.href?.startsWith('/'))
        .map(item => ({ href: item.href, label: item.label || item.href, group: item.group || '其他' }));
    }
    const nav = document.querySelector('#console-sidebar .console-nav');
    if (!nav) return [];
    const items = [];
    let group = '';
    nav.childNodes.forEach(node => {
      if (node.classList?.contains('console-nav-section')) {
        group = node.textContent.trim();
        return;
      }
      if (node.tagName !== 'A') return;
      const href = node.getAttribute('href') || '';
      if (!href || !href.startsWith('/')) return; // 自定义外部链接不入显隐清单
      items.push({ href, label: node.querySelector('.console-nav-label')?.textContent?.trim() || href, group });
    });
    return items;
  }

  async function fetchNavConfig() {
    const response = await fetch('/api/console-nav', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `加载导航配置失败（${response.status}）`);
    }
    return data.consoleNav || {};
  }

  function renderItems() {
    const box = $('plugin-settings-nav-items');
    if (!box) return;
    if (!state.items.length) {
      box.textContent = '未读到侧边栏导航项。';
      return;
    }
    const groups = [];
    state.items.forEach(item => {
      let bucket = groups.find(entry => entry.group === item.group);
      if (!bucket) {
        bucket = { group: item.group, items: [] };
        groups.push(bucket);
      }
      bucket.items.push(item);
    });
    box.innerHTML = groups.map(bucket => `
      <div style="border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;">
        <div class="kv-label">${bucket.group}</div>
        ${bucket.items.map(item => `
          <label style="display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 13px;">
            <input type="checkbox" data-nav-show-href="${item.href}" ${item.hidden ? '' : 'checked'} />
            <span>${item.label}</span>
            <span style="color: var(--soft-text); font-size: 11px;">${item.href}</span>
          </label>
        `).join('')}
      </div>
    `).join('');
  }

  function renderCustom() {
    const list = $('plugin-settings-nav-custom-list');
    if (!list) return;
    if (!state.custom.length) {
      list.innerHTML = '<div class="setting-status">还没有自定义链接。</div>';
      return;
    }
    list.innerHTML = state.custom.map((link, index) => `
      <div style="display: flex; gap: 6px; align-items: center; width: 100%;">
        <input type="text" value="${link.label.replace(/"/g, '&quot;')}" data-nav-custom-label="${index}" placeholder="名称" style="flex: 0 0 180px; min-height: 32px;" />
        <input type="text" value="${link.url.replace(/"/g, '&quot;')}" data-nav-custom-url="${index}" placeholder="https://…" style="flex: 1 1 auto; min-height: 32px; min-width: 0;" />
        <button type="button" class="mini-btn" data-nav-custom-remove="${index}" style="flex: none;">删除</button>
      </div>
    `).join('');
  }

  function applyLoadedConfig(conf) {
    const hidden = new Set(Array.isArray(conf.hidden) ? conf.hidden : []);
    state.items = collectSidebarItems().map(item => ({ ...item, hidden: hidden.has(item.href) }));
    state.custom = Array.isArray(conf.custom) ? conf.custom.slice(0, 30) : [];
    state.loaded = true;
    renderItems();
    renderCustom();
    setStatus('');
  }

  async function load() {
    try {
      applyLoadedConfig(await fetchNavConfig());
    } catch (error) {
      setStatus(error.message || '导航配置加载失败', 'error');
    }
  }

  function readEdits() {
    // 勾选状态
    document.querySelectorAll('[data-nav-show-href]').forEach(checkbox => {
      const item = state.items.find(entry => entry.href === checkbox.dataset.navShowHref);
      if (item) item.hidden = !checkbox.checked;
    });
    // 自定义链接编辑
    state.custom = state.custom.map((link, index) => ({
      label: (document.querySelector(`[data-nav-custom-label="${index}"]`)?.value || link.label).trim(),
      url: (document.querySelector(`[data-nav-custom-url="${index}"]`)?.value || link.url).trim(),
    })).filter(link => link.label || link.url);
  }

  async function save() {
    if (!state.loaded) return;
    readEdits();
    const saveButton = $('plugin-settings-nav-save');
    if (saveButton) saveButton.disabled = true;
    setStatus('正在保存...', '');
    try {
      const response = await fetch('/api/console-nav', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hidden: state.items.filter(item => item.hidden).map(item => item.href),
          custom: state.custom,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.error || `保存失败（${response.status}）`);
      }
      setStatus('已保存：刷新任意控制台页面即可看到新导航。', 'success');
      applyLoadedConfig(data.consoleNav || {});
    } catch (error) {
      setStatus(error.message || '保存失败', 'error');
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  function bind() {
    $('plugin-settings-nav-custom-add')?.addEventListener('click', () => {
      if (state.custom.length >= 30) {
        setStatus('自定义链接最多 30 个', 'error');
        return;
      }
      readEdits();
      state.custom.push({ label: '', url: 'https://' });
      renderCustom();
    });

    $('plugin-settings-nav-custom-list')?.addEventListener('click', event => {
      const button = event.target.closest('[data-nav-custom-remove]');
      if (!button) return;
      readEdits();
      state.custom.splice(Number(button.dataset.navCustomRemove), 1);
      renderCustom();
    });

    $('plugin-settings-nav-save')?.addEventListener('click', save);
  }

  function init() {
    bind();
    // 面板切到“导航设置”时才加载（侧边栏此时已由 shell 渲染完成）
    const observer = new MutationObserver(() => {
      const panel = $('plugin-settings-nav-panel');
      if (panel && !panel.classList.contains('hidden') && !state.loaded) {
        load();
      }
    });
    const panel = $('plugin-settings-nav-panel');
    if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    if (panel && !panel.classList.contains('hidden') && !state.loaded) load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
