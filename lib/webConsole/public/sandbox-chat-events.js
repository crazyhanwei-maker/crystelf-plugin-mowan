['sandbox-session-id', 'sandbox-user-id', 'sandbox-group-id', 'sandbox-user-name', 'sandbox-bot-name', 'sandbox-is-master', 'sandbox-model', 'sandbox-temperature', 'sandbox-max-tokens', 'sandbox-context-note', 'sandbox-group-history', 'sandbox-memories', 'sandbox-system-prompt', 'sandbox-input', 'sandbox-knowledge-base', 'sandbox-knowledge-topk', 'sandbox-knowledge-filter-tags', 'sandbox-web-read-url', 'sandbox-web-read-max-length'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    if (id === 'sandbox-group-history') {
      syncGroupHistoryEditorFromText();
    }
    if (id === 'sandbox-memories') {
      syncMemoryEditorFromText();
    }
    persistSandboxState();
    if (['sandbox-session-id', 'sandbox-user-id', 'sandbox-group-id'].includes(id)) {
      refreshConfigStatus().catch(() => {});
    }
    refreshSystemPromptPreview().catch(() => {});
  });
});

document.getElementById('sandbox-send-btn').addEventListener('click', () => {
  sendSandboxMessage().catch(() => {});
});

document.getElementById('sandbox-web-read-btn').addEventListener('click', () => {
  runWebRead().catch(() => {});
});

document.getElementById('sandbox-web-read-inject-btn').addEventListener('click', () => {
  injectWebReadIntoInput();
});

document.getElementById('sandbox-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendSandboxMessage().catch(() => {});
  }
});

document.getElementById('sandbox-group-history-editor').addEventListener('input', () => {
  syncGroupHistoryTextFromEditor();
  persistSandboxState();
  refreshSystemPromptPreview().catch(() => {});
});

document.getElementById('sandbox-group-history-editor').addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.historyAction !== 'remove') return;
  target.closest('.sandbox-history-row')?.remove();
  if (document.querySelectorAll('.sandbox-history-row').length === 0) {
    renderGroupHistoryEditor([{ nickname: '', userId: '', type: 'text', content: '' }]);
  }
  syncGroupHistoryTextFromEditor();
  persistSandboxState();
  refreshSystemPromptPreview().catch(() => {});
});

document.getElementById('sandbox-add-history-row-btn').addEventListener('click', () => {
  const rows = getGroupHistoryRowsFromEditor();
  rows.push({ nickname: '', userId: '', type: 'text', content: '' });
  renderGroupHistoryEditor(rows);
});

document.getElementById('sandbox-memory-editor').addEventListener('input', () => {
  syncMemoryTextFromEditor();
  persistSandboxState();
  refreshSystemPromptPreview().catch(() => {});
});

document.getElementById('sandbox-knowledge-editor')?.addEventListener('input', () => {
  syncKnowledgeTextFromEditor();
  persistSandboxState();
  refreshSystemPromptPreview().catch(() => {});
});

document.getElementById('sandbox-memory-editor').addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.memoryAction !== 'remove') return;
  target.closest('.sandbox-memory-row')?.remove();
  if (document.querySelectorAll('.sandbox-memory-row').length === 0) {
    renderMemoryEditor([{ keywords: '', content: '', createdAt: '' }]);
  }
  syncMemoryTextFromEditor();
  persistSandboxState();
  refreshSystemPromptPreview().catch(() => {});
});

document.getElementById('sandbox-knowledge-editor')?.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.knowledgeAction !== 'remove') return;
  target.closest('.sandbox-knowledge-row')?.remove();
  if (document.querySelectorAll('.sandbox-knowledge-row').length === 0) {
    renderKnowledgeEditor([{ title: '', content: '' }]);
  }
  syncKnowledgeTextFromEditor();
  persistSandboxState();
  refreshSystemPromptPreview().catch(() => {});
});

document.getElementById('sandbox-add-memory-row-btn').addEventListener('click', () => {
  const rows = getMemoryRowsFromEditor();
  rows.push({ keywords: '', content: '', createdAt: '' });
  renderMemoryEditor(rows);
});

document.getElementById('sandbox-add-knowledge-row-btn')?.addEventListener('click', () => {
  const rows = getKnowledgeRowsFromEditor();
  rows.push({ title: '', content: '' });
  renderKnowledgeEditor(rows);
});

document.getElementById('sandbox-fill-knowledge-demo-btn')?.addEventListener('click', () => {
  renderKnowledgeEditor([
    { title: '验证功能', content: '新成员进群后可开启验证，管理员可手动重置或绕过验证。' },
    { title: '欢迎功能', content: '支持欢迎文案与欢迎图片配置。' },
  ]);
  syncKnowledgeTextFromEditor();
  persistSandboxState();
});

document.getElementById('sandbox-clear-knowledge-btn')?.addEventListener('click', () => {
  renderKnowledgeEditor([{ title: '', content: '' }]);
  syncKnowledgeTextFromEditor();
  renderRagMatches([]);
  renderRagDebug({});
  persistSandboxState();
});

document.getElementById('sandbox-knowledge-base')?.addEventListener('input', () => {
  syncKnowledgeEditorFromText();
  persistSandboxState();
});

document.getElementById('sandbox-clear-btn').addEventListener('click', () => {
  sandboxState.history = [];
  sandboxState.compareResult = null;
  renderHistory();
  renderCompareResult();
  document.getElementById('sandbox-session-id').value = '';
  document.getElementById('sandbox-model').value = '';
  document.getElementById('sandbox-temperature').value = '';
  document.getElementById('sandbox-max-tokens').value = '';
  document.getElementById('sandbox-system-prompt').value = '';
  document.getElementById('sandbox-compare-model-a').value = '';
  document.getElementById('sandbox-compare-model-b').value = '';
  document.getElementById('sandbox-compare-temp-a').value = '';
  document.getElementById('sandbox-compare-temp-b').value = '';
  document.getElementById('sandbox-summary').textContent = '尚未发送请求';
  document.getElementById('sandbox-raw').textContent = '尚无原始响应';
  persistSandboxState();
});

document.getElementById('sandbox-save-template-btn').addEventListener('click', () => {
  saveCurrentAsTemplate();
});

document.getElementById('sandbox-custom-template-list').addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.templateAction;
  const name = target.dataset.templateName;
  if (!action || !name) return;
  if (action === 'load') applyCustomTemplate(name);
  if (action === 'delete') deleteCustomTemplate(name);
});

document.getElementById('sandbox-snapshot-list').addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.snapshotAction;
  const name = target.dataset.snapshotName;
  if (!action || !name) return;
  if (action === 'load') applySnapshot(name);
  if (action === 'delete') deleteSnapshot(name);
});

document.getElementById('sandbox-knowledge-library-list')?.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.knowledgeLibraryAction;
  const name = target.dataset.knowledgeLibraryName;
  if (!action || !name) return;
  if (action === 'load') applyKnowledgeLibrary(name);
  if (action === 'delete') deleteKnowledgeLibrary(name);
});

document.getElementById('sandbox-copy-last-btn').addEventListener('click', () => {
  const lastAssistant = [...sandboxState.history].reverse().find(item => item.role === 'assistant');
  navigator.clipboard.writeText(lastAssistant?.content || '').catch(() => {});
});

document.getElementById('sandbox-copy-prompt-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('sandbox-system-prompt-preview').textContent || '').catch(() => {});
});

document.getElementById('sandbox-refresh-prompt-btn').addEventListener('click', () => {
  refreshSystemPromptPreview().catch(() => {});
});

document.getElementById('sandbox-export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    history: sandboxState.history,
    compareResult: sandboxState.compareResult,
    summary: document.getElementById('sandbox-summary').textContent,
    raw: document.getElementById('sandbox-raw').textContent,
  }, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sandbox-chat-export.json';
  link.click();
  URL.revokeObjectURL(url);
});

document.getElementById('sandbox-export-templates-btn').addEventListener('click', () => {
  exportCustomTemplates();
});

document.getElementById('sandbox-save-snapshot-btn').addEventListener('click', () => {
  saveCurrentAsSnapshot();
});

document.getElementById('sandbox-save-knowledge-library-btn')?.addEventListener('click', () => {
  saveCurrentAsKnowledgeLibrary();
});

document.getElementById('sandbox-export-snapshots-btn').addEventListener('click', () => {
  exportSnapshots();
});

document.getElementById('sandbox-export-knowledge-library-btn')?.addEventListener('click', () => {
  exportKnowledgeLibraries();
});

document.getElementById('sandbox-import-snapshots-btn').addEventListener('click', () => {
  document.getElementById('sandbox-import-snapshots-input').click();
});

document.getElementById('sandbox-import-knowledge-library-btn')?.addEventListener('click', () => {
  document.getElementById('sandbox-import-knowledge-library-input')?.click();
});

document.getElementById('sandbox-import-templates-btn').addEventListener('click', () => {
  document.getElementById('sandbox-import-templates-input').click();
});

document.getElementById('sandbox-import-templates-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  importCustomTemplates(file)
    .then(() => {
      document.getElementById('sandbox-template-status').textContent = `模板导入成功，当前自定义模板：${sandboxState.customTemplates.length} 个`;
      event.target.value = '';
    })
    .catch(error => {
      document.getElementById('sandbox-template-status').textContent = `模板导入失败：${error.message}`;
      event.target.value = '';
    });
});

document.getElementById('sandbox-import-snapshots-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  importSnapshots(file)
    .then(() => {
      document.getElementById('sandbox-snapshot-status').textContent = `快照导入成功，当前会话快照：${sandboxState.snapshots.length} 个`;
      event.target.value = '';
    })
    .catch(error => {
      document.getElementById('sandbox-snapshot-status').textContent = `快照导入失败：${error.message}`;
      event.target.value = '';
    });
});

document.getElementById('sandbox-import-knowledge-library-input')?.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  importKnowledgeLibraries(file)
    .then(() => {
      document.getElementById('sandbox-knowledge-library-status').textContent = `知识库导入成功，当前知识库库：${sandboxState.knowledgeLibraries.length} 个`;
      event.target.value = '';
    })
    .catch(error => {
      document.getElementById('sandbox-knowledge-library-status').textContent = `知识库导入失败：${error.message}`;
      event.target.value = '';
    });
});

document.getElementById('sandbox-template-default-btn').addEventListener('click', () => applyTemplate('default'));
document.getElementById('sandbox-template-role-btn').addEventListener('click', () => applyTemplate('role'));
document.getElementById('sandbox-template-safe-btn').addEventListener('click', () => applyTemplate('safe'));
document.getElementById('sandbox-template-long-btn').addEventListener('click', () => applyTemplate('long'));
document.getElementById('sandbox-run-compare-btn').addEventListener('click', () => {
  runCompare().catch(() => {});
});

restoreSandboxState();
syncGroupHistoryEditorFromText();
syncMemoryEditorFromText();
renderHistory();
renderCompareResult();
renderCustomTemplates();
renderSnapshots();
renderKnowledgeLibraries();
refreshConfigStatus().catch(() => {});
refreshSystemPromptPreview().catch(() => {});

