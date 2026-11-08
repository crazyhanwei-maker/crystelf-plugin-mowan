// 更新日志页：读取 /api/update-log（GIT.md 更新记录章节），artd 时间线风格渲染；
// 同时提供「检查更新 / 一键更新」，复用总览页同款 /api/version/check + /api/version/update 接口。
(function () {
  'use strict';

  const updateState = {
    checking: false,
    updating: false,
    result: null,
    readOnly: false,
  };

  function escapeHtml(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(value = '') {
    try {
      const date = new Date(value || Date.now());
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('zh-CN');
    } catch {
      return '';
    }
  }

  function detectChangeType(item) {
    const match = String(item).match(/^(新增|修复|优化|调整|重构|移除|安全|性能|官网)[:：]/);
    if (!match) return { type: '', text: item };
    const labels = {
      新增: '新增',
      修复: '修复',
      优化: '优化',
      调整: '调整',
      重构: '重构',
      移除: '移除',
      安全: '安全',
      性能: '性能',
      官网: '官网',
    };
    return { type: labels[match[1]] || '', text: String(item).slice(match[0].length).trim() };
  }

  function renderTimeline(versions, currentVersion) {
    const box = document.getElementById('update-log-timeline');
    if (!box) return;
    if (!versions.length) {
      box.innerHTML = '<div class="setting-status">暂无更新记录。GIT.md 中未找到更新记录章节。</div>';
      return;
    }
    box.innerHTML = versions.map((version, index) => {
      const isLatest = version.version === currentVersion || (index === 0 && !currentVersion);
      const items = (version.items || []).map(raw => {
        const { type, text } = detectChangeType(raw);
        const chip = type ? `<span class="update-log-chip update-log-chip-${encodeURIComponent(type)}">${escapeHtml(type)}</span>` : '';
        return `<div class="update-log-item">${chip}<span>${escapeHtml(text || raw)}</span></div>`;
      }).join('');
      return `
        <div class="update-log-version${isLatest ? ' is-latest' : ''}">
          <div class="update-log-version-node"><span class="update-log-version-dot"></span></div>
          <div class="update-log-version-body">
            <div class="update-log-version-head">
              <strong>v${escapeHtml(version.version)}</strong>
              ${isLatest ? '<span class="update-log-current-tag">当前版本</span>' : ''}
            </div>
            <div class="update-log-items">${items}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function setUpdateBadge(text = '', tone = '') {
    const badge = document.getElementById('update-log-update-badge');
    if (!badge) return;
    badge.textContent = String(text || '');
    badge.className = `tag update-log-update-badge${tone ? ` update-log-badge-${tone}` : ''}`.trim();
    badge.classList.toggle('hidden', !text);
  }

  function renderReleaseNoteSummary(result = {}) {
    const notes = result.releaseNotes || null;
    const lines = String(notes?.body || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!lines.length) return '';
    const items = lines.map(line => `<div>· ${escapeHtml(line)}</div>`).join('');
    const more = String(notes.body || '').split(/\r?\n/).filter(Boolean).length > lines.length
      ? '<div>…</div>'
      : '';
    const title = notes.name || notes.tagName
      ? `<div class="update-log-release-title">${escapeHtml(notes.name || notes.tagName)}</div>`
      : '';
    return `<div class="update-log-release-note">${title}${items}${more}</div>`;
  }

  function renderRemoteChangelog(result = {}) {
    const versions = Array.isArray(result.remoteChangelog) ? result.remoteChangelog : [];
    if (!versions.length) return '';
    const blocks = versions.map((version) => {
      const items = (version.items || []).map(raw => {
        const { type, text } = detectChangeType(raw);
        const chip = type ? `<span class="update-log-chip update-log-chip-${encodeURIComponent(type)}">${escapeHtml(type)}</span>` : '';
        return `<div class="update-log-item">${chip}<span>${escapeHtml(text || raw)}</span></div>`;
      }).join('');
      return `
        <div class="update-log-remote-version">
          <div class="update-log-remote-version-head">v${escapeHtml(version.version)}</div>
          <div class="update-log-remote-version-items">${items || '<div class="update-log-item"><span>没有具体改动条目。</span></div>'}</div>
        </div>`;
    }).join('');
    return `
      <div class="update-log-remote-changelog">
        <div class="update-log-remote-head">更新内容</div>
        ${blocks}
      </div>`;
  }

  function renderUpdateStatus(result = null, options = {}) {
    const box = document.getElementById('update-log-update-status');
    if (!box) return;
    if (options.loadingText) {
      box.classList.remove('hidden');
      box.className = 'update-log-update-status';
      box.textContent = String(options.loadingText);
      return;
    }
    if (!result) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const time = escapeHtml(formatTime(result.checkedAt));
    const branch = escapeHtml(result.branch || '');
    const localShort = escapeHtml(result.localCommitShort || '');
    const metaBase = `当前 v${escapeHtml(result.localVersion || '?')}${localShort ? `（${localShort}）` : ''}`
      + (branch ? ` · 分支 ${branch}` : '')
      + (time ? ` · 检查时间 ${time}` : '');

    if (result.status === 'not_a_git_repo') {
      box.className = 'update-log-update-status';
      box.innerHTML = `
        <div class="update-log-update-status-head">无法检查更新</div>
        <div class="update-log-update-status-note">${escapeHtml(result.error || '插件目录不是独立的 Git 仓库。')}</div>`;
      return;
    }
    if (result.status === 'check_failed') {
      box.className = 'update-log-update-status tone-error';
      box.innerHTML = `
        <div class="update-log-update-status-head">检查更新失败</div>
        <div class="update-log-update-status-note">${escapeHtml(result.error || '未知错误')}</div>`;
      return;
    }
    if (result.status === 'local_ahead' || result.status === 'diverged') {
      const title = result.status === 'local_ahead' ? '本地版本已领先远端' : '本地与远端已分叉';
      const note = result.status === 'local_ahead'
        ? '本地分支领先公开仓库，无需更新；推送并合并后这里会恢复正常比对。'
        : '本地分支与远端分叉，需要手动处理，暂不提供一键更新。';
      box.className = 'update-log-update-status';
      box.innerHTML = `
        <div class="update-log-update-status-head">${title}</div>
        <div class="update-log-update-status-meta">${metaBase}</div>
        <div class="update-log-update-status-note">${note}</div>`;
      return;
    }
    if (!result.updateAvailable) {
      box.className = 'update-log-update-status tone-success';
      box.innerHTML = `
        <div class="update-log-update-status-head">已是最新版本</div>
        <div class="update-log-update-status-meta">${metaBase}</div>
        ${result.dirty ? '<div class="update-log-update-status-note">本地工作区有未提交改动。</div>' : ''}`;
      return;
    }

    const remoteLabel = escapeHtml(result.releaseNotes?.tagName || result.remoteCommitShort || '');
    const readOnlyNote = updateState.readOnly
      ? '<div class="update-log-update-status-note">当前控制台为只读模式，无法执行更新。</div>'
      : '';
    const dirtyWarn = result.dirty
      ? '<div class="update-log-update-status-note">⚠️ 本地工作区有未提交改动，更新会被拒绝；请先提交或暂存后再试。</div>'
      : '';
    box.className = 'update-log-update-status tone-update';
    box.innerHTML = `
      <div class="update-log-update-status-head">发现新版本 ${remoteLabel}</div>
      <div class="update-log-update-status-meta">
        <div>本地 v${escapeHtml(result.localVersion || '?')}${localShort ? `（${localShort}）` : ''} → 远端 ${escapeHtml(result.remoteCommitShort || '')}</div>
        ${branch ? `<div>分支 ${branch}</div>` : ''}
        ${time ? `<div>检查时间 ${time}</div>` : ''}
      </div>
      ${renderRemoteChangelog(result) || renderReleaseNoteSummary(result)}
      ${dirtyWarn}
      ${readOnlyNote}
      <button id="update-log-update-btn" type="button" class="link-btn update-log-update-btn"${updateState.readOnly ? ' disabled' : ''}>一键更新</button>`;
  }

  function mapUpdateErrorHint(message = '') {
    if (/WORKTREE_DIRTY|未提交改动/.test(message)) return '\n\n本地有未提交改动，请先提交或暂存后再尝试自动更新。';
    if (/DIVERGED|分叉/.test(message)) return '\n\n本地分支与远端分叉，需要手动处理。';
    if (/LOCAL_AHEAD|领先/.test(message)) return '\n\n本地分支领先远端，无需更新。';
    if (/Read-only|只读/.test(message)) return '\n\n当前控制台为只读模式，无法执行更新。';
    return '';
  }

  function setButtonsDisabled(disabled) {
    const checkBtn = document.getElementById('update-log-check-btn');
    if (checkBtn) checkBtn.disabled = disabled;
    const updateBtn = document.getElementById('update-log-update-btn');
    if (updateBtn) updateBtn.disabled = disabled || updateState.readOnly;
  }

  async function checkUpdate() {
    if (updateState.checking || updateState.updating) return;
    updateState.checking = true;
    const checkBtn = document.getElementById('update-log-check-btn');
    if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = '检查中...'; }
    renderUpdateStatus(null, { loadingText: '正在检查更新...' });
    try {
      const data = await fetch('/api/version/check?force=1', { cache: 'no-store' }).then(r => r.json());
      updateState.result = data || null;
      if (data?.status === 'update_available') setUpdateBadge('可更新', 'warn');
      else if (data?.status === 'up_to_date' || data?.status === 'local_ahead') setUpdateBadge('最新', 'ok');
      else if (data?.status === 'diverged') setUpdateBadge('分叉', 'error');
      else setUpdateBadge('', '');
      renderUpdateStatus(updateState.result);
    } catch (error) {
      updateState.result = null;
      setUpdateBadge('', '');
      renderUpdateStatus({ status: 'check_failed', error: error?.message || String(error), checkedAt: new Date().toISOString() });
    } finally {
      updateState.checking = false;
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = '检查更新'; }
    }
  }

  async function runUpdate() {
    if (updateState.updating || updateState.checking) return;
    const result = updateState.result;
    if (!result?.updateAvailable) return;
    if (updateState.readOnly) return;
    const target = result.releaseNotes?.tagName || result.remoteCommitShort || '';
    let confirmed = false;
    try {
      confirmed = await window.webConsoleConfirm(
        `即将执行 git pull --ff-only 更新到 ${target || '远端最新'}。\n`
        + '过程中请不要关闭页面；完成后需要重启 Yunzai 进程，新代码才会生效。',
        { title: '确认更新', confirmText: '开始更新' },
      );
    } catch {
      confirmed = false;
    }
    if (!confirmed) return;

    updateState.updating = true;
    setButtonsDisabled(true);
    renderUpdateStatus(null, { loadingText: '正在执行 git pull --ff-only，请稍候...' });
    try {
      const request = window.CrystelfRequest || {};
      const data = await request.postJson('/api/version/update', {});
      if (data?.alreadyUpToDate) {
        window.webConsoleAlert?.('远端没有新提交，已经是最新代码。');
      } else {
        const fromTo = `${String(data?.fromHash || '').slice(0, 8)} → ${String(data?.toHash || '').slice(0, 8)}`;
        const lines = [
          `已成功拉取最新代码：${fromTo}`,
          data?.manifestChanged
            ? '依赖清单（package.json / lockfile）有变化，建议重启前先执行 npm install。'
            : '依赖清单未变化，直接重启即可。',
          '请重启 Yunzai 进程让新代码生效。',
        ];
        window.webConsoleAlert?.(lines.join('\n'));
      }
    } catch (error) {
      const message = error?.message || String(error);
      window.webConsoleAlert?.(`更新失败：${message}${mapUpdateErrorHint(message)}`);
    } finally {
      updateState.updating = false;
      setButtonsDisabled(false);
      await checkUpdate();
    }
  }

  async function load() {
    const box = document.getElementById('update-log-timeline');
    try {
      const data = await fetch('/api/update-log', { cache: 'no-store' }).then(r => r.json());
      if (!data?.success) throw new Error(data?.error || '加载失败');
      const tag = document.getElementById('update-log-version-tag');
      if (tag) tag.textContent = `当前版本 v${data.currentVersion || '?'}`;
      renderTimeline(data.versions || [], data.currentVersion || '');
    } catch (error) {
      if (box) box.innerHTML = `<div class="setting-status tone-error">更新日志加载失败：${escapeHtml(error.message || error)}</div>`;
    }
    // 只读控制台不能执行更新：预取一次授权状态，供状态条禁用按钮
    try {
      const auth = await fetch('/api/auth/status', { cache: 'no-store' }).then(r => r.json());
      updateState.readOnly = auth?.readOnly === true;
    } catch {
      updateState.readOnly = false;
    }
  }

  function bind() {
    document.getElementById('update-log-check-btn')?.addEventListener('click', () => {
      checkUpdate().catch(() => {});
    });
    document.getElementById('update-log-update-status')?.addEventListener('click', event => {
      if (event.target.closest?.('#update-log-update-btn')) {
        runUpdate().catch(() => {});
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bind();
      load();
    });
  } else {
    bind();
    load();
  }
})();
