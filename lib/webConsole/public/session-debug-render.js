function renderCards(cards) {
  document.getElementById('session-debug-cards').innerHTML = cards.map(item => `
    <div class="card${normalizeToneClass(item.tone)}">
      <h3>${escapeHtml(item.label)}</h3>
      <div class="value detail-value">${escapeHtml(item.value)}</div>
    </div>
  `).join('');
}

function renderKeyValues(items) {
  document.getElementById('session-debug-main').innerHTML = items.map(item => `
    <div class="kv-item">
      <div class="kv-label">${escapeHtml(item.label)}</div>
      <div class="kv-value">${escapeHtml(item.value)}</div>
    </div>
  `).join('');
}

function renderActions(items) {
  document.getElementById('session-debug-actions').innerHTML = items.map(item => {
    const label = escapeHtml(item.label);
    const href = sanitizeUrl(item.href, { allowRelative: true });
    return href
      ? `<a class="link-btn" href="${escapeHtml(href)}">${label}</a>`
      : `<button data-copy-value="${escapeHtml(item.copyValue || '')}">${label}</button>`;
  }).join('');
}

function renderList(containerId, items, emptyText, renderer) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.length > 0 ? items.map(renderer).join('') : `<div class="list-item">${emptyText}</div>`;
}
