// 网页调试对话状态与编辑器数据转换。由 sandbox-chat.html 在 sandbox-chat.js 前加载。

const sandboxState = {
  history: [],
  compareResult: null,
  customTemplates: [],
  snapshots: [],
  knowledgeLibraries: [],
  webReadResult: '',
};

function parseGroupHistoryRows(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [nickname = '', userId = '', type = 'text', content = ''] = line.split('|');
      return {
        nickname: nickname.trim(),
        userId: userId.trim(),
        type: type.trim() || 'text',
        content: content.trim(),
      };
    });
}

function parseMemoryRows(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [keywords = '', content = '', createdAt = ''] = line.split('|');
      return {
        keywords: keywords.trim(),
        content: content.trim(),
        createdAt: createdAt.trim(),
      };
    });
}

function stringifyGroupHistoryRows(rows = []) {
  return rows
    .map(item => [item.nickname || '', item.userId || '', item.type || 'text', item.content || ''].join('|'))
    .join('\n');
}

function stringifyMemoryRows(rows = []) {
  return rows
    .map(item => [item.keywords || '', item.content || '', item.createdAt || ''].join('|'))
    .join('\n');
}

function parseKnowledgeRows(value = '') {
  return String(value || '')
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const [title = '', maybeTags = '', ...rest] = lines;
      const hasTagsLine = /^标签[:：]/.test(maybeTags);
      return {
        title,
        tags: hasTagsLine ? maybeTags.replace(/^标签[:：]/, '').trim() : '',
        content: (hasTagsLine ? rest : [maybeTags, ...rest]).join('\n').trim(),
      };
    });
}

function stringifyKnowledgeRows(rows = []) {
  return rows
    .filter(item => item.title || item.content)
    .map(item => [item.title || '', item.tags ? `标签:${item.tags}` : '', item.content || ''].filter(Boolean).join('\n'))
    .join('\n\n');
}

function getGroupHistoryRowsFromEditor() {
  return Array.from(document.querySelectorAll('.sandbox-history-row')).map(row => ({
    nickname: row.querySelector('[data-history-field="nickname"]')?.value.trim() || '',
    userId: row.querySelector('[data-history-field="userId"]')?.value.trim() || '',
    type: row.querySelector('[data-history-field="type"]')?.value.trim() || 'text',
    content: row.querySelector('[data-history-field="content"]')?.value.trim() || '',
  })).filter(item => item.nickname || item.userId || item.content);
}

function renderGroupHistoryEditor(rows) {
  const container = document.getElementById('sandbox-group-history-editor');
  const list = rows.length > 0 ? rows : [{ nickname: '', userId: '', type: 'text', content: '' }];
  container.innerHTML = list.map((item, index) => `
    <div class="sandbox-history-row" data-history-index="${index}">
      <input data-history-field="nickname" placeholder="昵称" value="${escapeHtml(item.nickname || '')}" />
      <input data-history-field="userId" placeholder="用户ID" value="${escapeHtml(item.userId || '')}" />
      <select data-history-field="type">
        <option value="text" ${item.type === 'text' ? 'selected' : ''}>文本</option>
        <option value="at" ${item.type === 'at' ? 'selected' : ''}>@</option>
        <option value="image" ${item.type === 'image' ? 'selected' : ''}>图片</option>
      </select>
      <input data-history-field="content" placeholder="内容 / @目标" value="${escapeHtml(item.content || '')}" />
      <button class="danger" data-history-action="remove">删除</button>
    </div>
  `).join('');
}

function syncGroupHistoryTextFromEditor() {
  document.getElementById('sandbox-group-history').value = stringifyGroupHistoryRows(getGroupHistoryRowsFromEditor());
}

function syncGroupHistoryEditorFromText() {
  renderGroupHistoryEditor(parseGroupHistoryRows(document.getElementById('sandbox-group-history').value));
}

function getMemoryRowsFromEditor() {
  return Array.from(document.querySelectorAll('.sandbox-memory-row')).map(row => ({
    keywords: row.querySelector('[data-memory-field="keywords"]')?.value.trim() || '',
    content: row.querySelector('[data-memory-field="content"]')?.value.trim() || '',
    createdAt: row.querySelector('[data-memory-field="createdAt"]')?.value.trim() || '',
  })).filter(item => item.keywords || item.content || item.createdAt);
}

function renderMemoryEditor(rows) {
  const container = document.getElementById('sandbox-memory-editor');
  const list = rows.length > 0 ? rows : [{ keywords: '', content: '', createdAt: '' }];
  container.innerHTML = list.map((item, index) => `
    <div class="sandbox-history-row sandbox-memory-row" data-memory-index="${index}">
      <input data-memory-field="keywords" placeholder="关键词" value="${escapeHtml(item.keywords || '')}" />
      <input data-memory-field="createdAt" placeholder="创建时间" value="${escapeHtml(item.createdAt || '')}" />
      <input data-memory-field="content" class="sandbox-memory-content" placeholder="记忆内容" value="${escapeHtml(item.content || '')}" />
      <button class="danger" data-memory-action="remove">删除</button>
    </div>
  `).join('');
}

function syncMemoryTextFromEditor() {
  document.getElementById('sandbox-memories').value = stringifyMemoryRows(getMemoryRowsFromEditor());
}

function syncMemoryEditorFromText() {
  renderMemoryEditor(parseMemoryRows(document.getElementById('sandbox-memories').value));
}

function getKnowledgeRowsFromEditor() {
  return Array.from(document.querySelectorAll('.sandbox-knowledge-row')).map(row => ({
    title: row.querySelector('[data-knowledge-field="title"]')?.value.trim() || '',
    tags: row.querySelector('[data-knowledge-field="tags"]')?.value.trim() || '',
    content: row.querySelector('[data-knowledge-field="content"]')?.value.trim() || '',
  })).filter(item => item.title || item.content);
}

function renderKnowledgeEditor(rows) {
  const container = document.getElementById('sandbox-knowledge-editor');
  const list = rows.length > 0 ? rows : [{ title: '', content: '' }];
  container.innerHTML = list.map((item, index) => `
    <div class="sandbox-history-row sandbox-knowledge-row" data-knowledge-index="${index}">
      <input data-knowledge-field="title" placeholder="片段标题" value="${escapeHtml(item.title || '')}" />
      <input data-knowledge-field="tags" placeholder="标签，多个用逗号分隔" value="${escapeHtml(item.tags || '')}" />
      <textarea data-knowledge-field="content" class="sandbox-input sandbox-knowledge-content" placeholder="片段正文">${escapeHtml(item.content || '')}</textarea>
      <button class="danger" data-knowledge-action="remove">删除</button>
    </div>
  `).join('');
}

function syncKnowledgeTextFromEditor() {
  document.getElementById('sandbox-knowledge-base').value = stringifyKnowledgeRows(getKnowledgeRowsFromEditor());
}

function syncKnowledgeEditorFromText() {
  renderKnowledgeEditor(parseKnowledgeRows(document.getElementById('sandbox-knowledge-base').value));
}
