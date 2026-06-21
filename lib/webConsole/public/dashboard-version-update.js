'use strict';

const VERSION_IGNORE_STORAGE_KEY = 'crystelf:ignored-versions';
const versionUpdateState = {
  shown: false,
  inFlight: false,
  lastResult: null,
};

function loadIgnoredVersions() {
  try {
    const raw = localStorage.getItem(VERSION_IGNORE_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveIgnoredVersions(set) {
  try {
    localStorage.setItem(VERSION_IGNORE_STORAGE_KEY, JSON.stringify(Array.from(set || []).filter(Boolean).slice(-50)));
  } catch {
    // ignore quota
  }
}

function addIgnoredVersion(commit) {
  const key = String(commit || '').trim();
  if (!key) return;
  const set = loadIgnoredVersions();
  set.add(key);
  saveIgnoredVersions(set);
}

function isVersionIgnored(commit) {
  const key = String(commit || '').trim();
  if (!key) return false;
  return loadIgnoredVersions().has(key);
}

function escapeHtmlSafe(value = '') {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderReleaseNotesBody(body = '') {
  const safe = escapeHtmlSafe(String(body || '').trim());
  if (!safe) return '';
  // 简易 Markdown：把 - / * 开头的行渲染为列表项；其他行用 <p>
  const lines = safe.split(/\r?\n/);
  const out = [];
  let listOpen = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/u, '');
    const listMatch = line.match(/^\s*(?:[-*])\s+(.*)$/u);
    if (listMatch) {
      if (!listOpen) { out.push('<ul>'); listOpen = true; }
      out.push(`<li>${listMatch[1]}</li>`);
      continue;
    }
    if (listOpen) { out.push('</ul>'); listOpen = false; }
    if (line.trim() === '') {
      out.push('');
      continue;
    }
    out.push(`<p>${line}</p>`);
  }
  if (listOpen) out.push('</ul>');
  return out.filter(Boolean).join('');
}

function renderLocalChangelogBody(localChangelog = []) {
  const items = Array.isArray(localChangelog) ? localChangelog : [];
  if (items.length === 0) return '';
  const top = items[0];
  if (!top) return '';
  const heading = top.version
    ? `<h4>v${escapeHtmlSafe(top.version)}${top.date ? ` <span class="version-update-modal-date">${escapeHtmlSafe(top.date)}</span>` : ''}</h4>`
    : '';
  const list = Array.isArray(top.items) && top.items.length > 0
    ? `<ul>${top.items.map(item => `<li>${escapeHtmlSafe(item)}</li>`).join('')}</ul>`
    : '<p>没有具体改动条目。</p>';
  return `${heading}${list}`;
}

function formatVersionCheckTime(checkedAt) {
  try {
    const date = new Date(checkedAt || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN');
  } catch {
    return '';
  }
}

function buildVersionUpdateModalHtml(result) {
  const localVersion = String(result?.localVersion || '').trim();
  const localShort = String(result?.localCommitShort || '').trim();
  const remoteShort = String(result?.remoteCommitShort || '').trim();
  const remoteRef = String(result?.remoteRef || '').trim();
  const branch = String(result?.branch || '').trim();
  const releaseNotes = result?.releaseNotes || null;
  const localChangelog = Array.isArray(result?.localChangelog) ? result.localChangelog : [];

  const remoteVersionLabel = releaseNotes?.tagName
    ? `<strong>${escapeHtmlSafe(releaseNotes.tagName)}</strong>${remoteShort ? ` <span class="version-update-modal-hash">${escapeHtmlSafe(remoteShort)}</span>` : ''}`
    : (remoteShort ? `<strong>${escapeHtmlSafe(remoteShort)}</strong>` : '<strong>未知</strong>');

  const meta = `
    <div class="version-update-modal-meta">
      <div>当前版本 <strong>v${escapeHtmlSafe(localVersion || '?')}</strong>${localShort ? ` <span class="version-update-modal-hash">${escapeHtmlSafe(localShort)}</span>` : ''}</div>
      <div>远端版本 ${remoteVersionLabel}</div>
      ${branch ? `<div>分支 <strong>${escapeHtmlSafe(branch)}</strong></div>` : ''}
      <div>检查时间 ${escapeHtmlSafe(formatVersionCheckTime(result?.checkedAt))}</div>
    </div>
  `;

  let changelogHtml = '';
  if (releaseNotes && releaseNotes.body) {
    const heading = releaseNotes.name || releaseNotes.tagName
      ? `<h4>${escapeHtmlSafe(releaseNotes.name || releaseNotes.tagName)}${releaseNotes.publishedAt ? ` <span class="version-update-modal-date">${escapeHtmlSafe(formatVersionCheckTime(releaseNotes.publishedAt))}</span>` : ''}</h4>`
      : '';
    changelogHtml = `${heading}${renderReleaseNotesBody(releaseNotes.body)}`;
  }
  if (!changelogHtml) {
    changelogHtml = renderLocalChangelogBody(localChangelog);
  }
  if (!changelogHtml) {
    const fallbackUrl = releaseNotes?.htmlUrl || result?.remoteUrl || '';
    changelogHtml = fallbackUrl
      ? `<p>没有抓到更新日志，可以前往 <a href="${escapeHtmlSafe(fallbackUrl)}" target="_blank" rel="noopener">${escapeHtmlSafe(fallbackUrl)}</a> 查看。</p>`
      : '<p>没有抓到更新日志，远端仅检测到代码已变化。</p>';
  }

  const dirtyWarn = result?.dirty
    ? '<div class="version-update-modal-warning">⚠️ 检测到本地工作区有未提交改动，自动更新会被拒绝。请先提交或暂存改动后再尝试。</div>'
    : '';

  const releaseLink = releaseNotes?.htmlUrl
    ? `<div class="version-update-modal-link"><a href="${escapeHtmlSafe(releaseNotes.htmlUrl)}" target="_blank" rel="noopener">在 Gitee 查看完整发布说明 →</a></div>`
    : '';

  return `
    <div class="version-update-modal">
      ${meta}
      <div class="version-update-modal-changelog">${changelogHtml}</div>
      ${releaseLink}
      ${dirtyWarn}
    </div>
  `;
}

function buildVersionUpdateModalTitle(result) {
  const tag = result?.releaseNotes?.tagName || '';
  if (tag) return `发现新版本 ${tag}`;
  const remoteShort = String(result?.remoteCommitShort || '').trim();
  return remoteShort ? `发现新版本 ${remoteShort}` : '发现新版本';
}

async function maybeShowVersionUpdateModal(result, options = {}) {
  versionUpdateState.lastResult = result || versionUpdateState.lastResult || null;
  const usingResult = versionUpdateState.lastResult;
  if (!usingResult) return;
  const force = options.force === true;

  // 插件目录不是独立 git 仓库：仅在用户主动触发时给出明确提示，自动检查时静默。
  if (usingResult.status === 'not_a_git_repo') {
    if (!force) return;
    await openModal('无法检查更新',
      usingResult.error || '插件目录不是独立的 Git 仓库，无法检查更新。请改用 git clone 部署，或下载新版后手动覆盖。',
      { showCancel: false, confirmText: '知道了' });
    return;
  }

  if (!usingResult.updateAvailable && !force) return;
  const remoteCommit = String(usingResult.remoteCommit || '').trim();
  if (!force) {
    if (versionUpdateState.shown) return;
    if (isVersionIgnored(remoteCommit)) return;
  }
  versionUpdateState.shown = true;

  const html = buildVersionUpdateModalHtml(usingResult);
  const title = buildVersionUpdateModalTitle(usingResult);
  const confirmed = await openModal(title, html, {
    html: true,
    confirmText: '立即更新',
    cancelText: '忽略此版本',
  });

  if (confirmed) {
    triggerVersionUpdate(usingResult).catch(error => {
      openModal('更新失败', error?.message || String(error), { showCancel: false, confirmText: '关闭' });
    });
  } else {
    if (remoteCommit) addIgnoredVersion(remoteCommit);
  }
}

function buildCsrfHeaders() {
  try {
    if (typeof window !== 'undefined' && window.CrystelfRequest && typeof window.CrystelfRequest.csrfHeaders === 'function') {
      return window.CrystelfRequest.csrfHeaders() || {};
    }
  } catch {
    // ignore
  }
  return {};
}

async function triggerVersionUpdate(result) {
  if (versionUpdateState.inFlight) {
    return openModal('更新进行中', '已有一个更新任务在执行，请稍候。', { showCancel: false, confirmText: '知道了' });
  }
  const ok = await openModal('确认更新',
    '即将执行 git pull --ff-only 拉取远端最新代码。\n更新过程可能需要 1-2 分钟，期间不要关闭浏览器。\n更新完成后建议手动重启 Yunzai 进程，让新代码加载到内存。',
    { confirmText: '开始更新', cancelText: '取消', showCancel: true });
  if (!ok) return;

  versionUpdateState.inFlight = true;
  await openModal('正在更新',
    '正在执行 git pull --ff-only，请稍候...\n（更新结果会在完成后弹出，本提示框可以保持打开）',
    { showCancel: false, confirmText: '知道了' });

  try {
    const resp = await fetch('/api/version/update', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...buildCsrfHeaders() },
      body: JSON.stringify({}),
    });
    let data = null;
    try { data = await resp.json(); } catch { data = null; }
    if (!resp.ok || !data || data.success !== true) {
      const msg = data?.error || `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    if (data.alreadyUpToDate) {
      await openModal('更新结果', '远端没有新提交，已经是最新代码了。', { showCancel: false, confirmText: '知道了' });
      versionUpdateState.shown = true;
      return;
    }
    const fromTo = `${String(data.fromHash || '').slice(0, 8)} → ${String(data.toHash || '').slice(0, 8)}`;
    const lines = [
      `已成功拉取最新代码：${fromTo}`,
      data.manifestChanged ? '依赖清单（package.json / lockfile）有变化，建议重启前先执行 npm install。' : '依赖清单未变化，可以直接重启。',
      '',
      '请重启 Yunzai 进程让新代码生效。',
    ];
    await openModal('更新完成', lines.join('\n'), { showCancel: false, confirmText: '知道了' });
    versionUpdateState.shown = true;
  } catch (error) {
    const message = error?.message || String(error);
    let hint = '';
    if (/WORKTREE_DIRTY|未提交改动/.test(message)) {
      hint = '\n\n本地有未提交的改动，请先提交或暂存改动后再尝试自动更新。';
    } else if (/DIVERGED|分叉/.test(message)) {
      hint = '\n\n本地分支与远端分叉，需要手动处理（git rebase 或 git reset 等）。';
    } else if (/LOCAL_AHEAD|领先/.test(message)) {
      hint = '\n\n本地分支领先远端，无需更新。';
    }
    await openModal('更新失败', `${message}${hint}`, { showCancel: false, confirmText: '关闭' });
  } finally {
    versionUpdateState.inFlight = false;
  }
}

if (typeof window !== 'undefined') {
  window.maybeShowVersionUpdateModal = maybeShowVersionUpdateModal;
  window.triggerVersionUpdate = triggerVersionUpdate;
  window.versionUpdateState = versionUpdateState;
}
