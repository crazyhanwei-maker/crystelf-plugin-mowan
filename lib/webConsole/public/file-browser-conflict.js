function normalizeConflictTextLines(content = '') {
  return String(content || '').replace(/\r\n?/g, '\n').split('\n');
}

function countConflictContentLines(content = '') {
  return normalizeConflictTextLines(content).length;
}

function formatConflictLineRange(startIndex = 0, lineCount = 0) {
  const start = Math.max(1, Number(startIndex || 0) + 1);
  const end = Math.max(start, start + Math.max(0, Number(lineCount || 0)) - 1);
  return start === end ? `第 ${start} 行` : `第 ${start}-${end} 行`;
}

function buildConflictPreviewItems(lines = [], startIndex = 0, maxLines = 18) {
  const numbered = lines.map((text, index) => ({
    type: 'line',
    number: startIndex + index + 1,
    text,
  }));
  if (numbered.length <= maxLines) {
    return numbered;
  }
  const headCount = 10;
  const tailCount = 6;
  const hiddenCount = Math.max(0, numbered.length - headCount - tailCount);
  return [
    ...numbered.slice(0, headCount),
    { type: 'gap', text: `... 中间省略 ${hiddenCount} 行 ...` },
    ...numbered.slice(-tailCount),
  ];
}

function buildSaveConflictDiffHtml({
  path = '',
  localContent = '',
  diskContent = '',
  expectedMtimeMs = 0,
  actualMtimeMs = 0,
} = {}) {
  const localLines = normalizeConflictTextLines(localContent);
  const diskLines = normalizeConflictTextLines(diskContent);
  let startIndex = 0;
  while (
    startIndex < localLines.length
    && startIndex < diskLines.length
    && localLines[startIndex] === diskLines[startIndex]
  ) {
    startIndex += 1;
  }

  let localEnd = localLines.length - 1;
  let diskEnd = diskLines.length - 1;
  while (localEnd >= startIndex && diskEnd >= startIndex && localLines[localEnd] === diskLines[diskEnd]) {
    localEnd -= 1;
    diskEnd -= 1;
  }

  const localChanged = localEnd >= startIndex ? localLines.slice(startIndex, localEnd + 1) : [];
  const diskChanged = diskEnd >= startIndex ? diskLines.slice(startIndex, diskEnd + 1) : [];
  const renderPanel = (title, items, tone, lineCount, startLine) => `
    <section class="file-browser-conflict-panel tone-${tone}">
      <div class="file-browser-conflict-panel-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(formatConflictLineRange(startLine, lineCount))}</span>
      </div>
      <div class="file-browser-conflict-code">
        ${items.length ? items.map(item => {
          if (item.type === 'gap') {
            return `<div class="file-browser-conflict-gap">${escapeHtml(item.text)}</div>`;
          }
          return `
            <div class="file-browser-conflict-line">
              <span class="file-browser-conflict-line-no">${item.number}</span>
              <span class="file-browser-conflict-line-text">${escapeHtml(item.text)}</span>
            </div>
          `;
        }).join('') : '<div class="file-browser-conflict-empty">此处没有文本内容。</div>'}
      </div>
    </section>
  `;

  return `
    <div class="file-browser-conflict-summary">
      <div class="file-browser-conflict-title">${escapeHtml(path)}</div>
      <div class="file-browser-conflict-meta">
        <span>你上次载入：${escapeHtml(formatTime(expectedMtimeMs) || '-')}</span>
        <span>磁盘当前：${escapeHtml(formatTime(actualMtimeMs) || '-')}</span>
        <span>本地 ${countConflictContentLines(localContent)} 行</span>
        <span>磁盘 ${countConflictContentLines(diskContent)} 行</span>
      </div>
      <div class="file-browser-conflict-note">检测到磁盘文件在你编辑期间发生变化。确认后会用编辑器里的内容强制覆盖磁盘版本；取消则保留你当前未保存的修改。</div>
    </div>
    <div class="file-browser-conflict-grid">
      ${renderPanel('磁盘当前版本', buildConflictPreviewItems(diskChanged, startIndex), 'warning', diskChanged.length, startIndex)}
      ${renderPanel('你的编辑器版本', buildConflictPreviewItems(localChanged, startIndex), 'success', localChanged.length, startIndex)}
    </div>
  `;
}

async function openSaveConflictDialog({
  path = '',
  localContent = '',
  diskContent = '',
  expectedMtimeMs = 0,
  actualMtimeMs = 0,
} = {}) {
  return await openModal({
    title: '保存冲突确认',
    confirmText: '强制覆盖保存',
    cancelText: '取消',
    danger: true,
    html: true,
    cardClass: 'file-browser-conflict-modal',
    contentClass: 'file-browser-conflict-content',
    content: buildSaveConflictDiffHtml({
      path,
      localContent,
      diskContent,
      expectedMtimeMs,
      actualMtimeMs,
    }),
  });
}

