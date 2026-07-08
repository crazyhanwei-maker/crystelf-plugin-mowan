(function () {
  const state = {
    data: null,
    search: '',
    status: 'all',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    if (window.CrystelfUi?.escapeHtml) {
      return window.CrystelfUi.escapeHtml(value);
    }
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value = '') {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '未知';
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function getFieldTone(source = '', cacheDrift = false) {
    if (cacheDrift) return 'warning';
    if (source === 'modified') return 'changed';
    if (source === 'runtimeOnly' || source === 'missingInRuntime' || source === 'memoryOnly') return 'warning';
    return 'ok';
  }

  function getFileTone(file = {}) {
    if (file.status === 'error') return 'error';
    if (file.status === 'warning') return 'warning';
    if (file.status === 'changed') return 'changed';
    return 'ok';
  }

  function renderKpi(label, value, meta = '', tone = '') {
    return `
      <article class="config-diagnostics-kpi ${tone ? `tone-${escapeHtml(tone)}` : ''}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <em>${escapeHtml(meta)}</em>
      </article>
    `;
  }

  function renderSummary(data = {}) {
    const summary = data.summary || {};
    const target = $('config-diagnostics-summary');
    if (!target) return;
    target.innerHTML = [
      renderKpi('配置文件', summary.configFileCount || 0, `运行 ${summary.runtimeFileCount || 0} / 默认 ${summary.defaultFileCount || 0}`),
      renderKpi('字段覆盖', summary.changedFieldCount || 0, '运行配置与默认模板不同', summary.changedFieldCount > 0 ? 'warning' : ''),
      renderKpi('仅运行配置', summary.runtimeOnlyFieldCount || 0, '默认模板中没有这些字段', summary.runtimeOnlyFieldCount > 0 ? 'warning' : ''),
      renderKpi('运行缺失', summary.missingRuntimeFieldCount || 0, '默认模板有但运行配置缺失', summary.missingRuntimeFieldCount > 0 ? 'warning' : ''),
      renderKpi('内存差异', summary.cacheDriftFieldCount || 0, '内存缓存与文件不同', summary.cacheDriftFieldCount > 0 ? 'error' : ''),
      renderKpi('JSON 错误', summary.invalidJsonCount || 0, '配置文件格式异常', summary.invalidJsonCount > 0 ? 'error' : ''),
    ].join('');
  }

  function renderRecommendations(data = {}) {
    const target = $('config-diagnostics-recommendations');
    if (!target) return;
    const items = Array.isArray(data.recommendations) ? data.recommendations : [];
    target.innerHTML = items.length > 0
      ? items.map(item => `<div class="config-diagnostics-recommendation">${escapeHtml(item)}</div>`).join('')
      : '<div class="config-diagnostics-empty">暂无建议。</div>';
  }

  function renderDirectories(data = {}) {
    const target = $('config-diagnostics-directories');
    if (!target) return;
    const dirs = data.directories || {};
    const env = Array.isArray(data.environment) ? data.environment : [];
    target.innerHTML = `
      <div class="config-diagnostics-path-list">
        <div class="config-diagnostics-path-item">
          <strong>${escapeHtml(dirs.runtime?.label || '运行配置目录')}</strong>
          <code>${escapeHtml(dirs.runtime?.path || data.runtimeDir || '-')}</code>
          <span class="setting-help">${dirs.runtime?.fromEnv ? '由 CRYSTELF_DATA_DIR 指定' : '使用默认运行数据目录'}</span>
        </div>
        <div class="config-diagnostics-path-item">
          <strong>${escapeHtml(dirs.defaults?.label || '默认模板目录')}</strong>
          <code>${escapeHtml(dirs.defaults?.path || data.defaultDir || '-')}</code>
          <span class="setting-help">插件自带模板，已有运行配置不会被它直接覆盖。</span>
        </div>
        ${env.map(item => `
          <div class="config-diagnostics-path-item">
            <strong>${escapeHtml(item.key || '环境变量')}</strong>
            <code>${escapeHtml(item.value || '-')}</code>
            <span class="setting-help">${item.configured ? '已设置' : '未设置'}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderMigration(data = {}) {
    const target = $('config-diagnostics-migration');
    if (!target) return;
    const report = data.migrationReport || {};
    const files = Array.isArray(report.files) ? report.files : [];
    target.innerHTML = `
      <div class="config-diagnostics-path-list">
        <div class="config-diagnostics-path-item">
          <strong>${report.migratedAt ? '最近迁移记录' : '暂无迁移记录'}</strong>
          <code>${escapeHtml(report.migratedAt ? formatDate(report.migratedAt) : '未记录')}</code>
          <span class="setting-help">影响文件 ${escapeHtml(report.changedFileCount || 0)} 个，字段 ${escapeHtml(report.changedCount || 0)} 个。</span>
        </div>
        ${files.slice(0, 4).map(file => `
          <div class="config-diagnostics-path-item">
            <strong>${escapeHtml(file.file || '-')}</strong>
            <code>${escapeHtml((file.reasons || []).join('，') || '自动迁移')}</code>
            <span class="setting-help">变更 ${escapeHtml(file.changedCount || 0)} 项${file.truncatedChanges ? '，还有更多未展示' : ''}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderEffectiveFields(data = {}) {
    const target = $('config-diagnostics-effective-fields');
    if (!target) return;
    const fields = Array.isArray(data.effectiveFields) ? data.effectiveFields : [];
    if (fields.length <= 0) {
      target.innerHTML = '<div class="config-diagnostics-empty">暂无关键字段。</div>';
      return;
    }
    target.innerHTML = `
      <table class="config-diagnostics-table">
        <thead>
          <tr>
            <th>字段</th>
            <th>配置文件</th>
            <th>当前生效值</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          ${fields.map(field => `
            <tr>
              <td><strong>${escapeHtml(field.label || field.key)}</strong><code>${escapeHtml(field.key || '-')}</code></td>
              <td>${escapeHtml(field.file || '-')}</td>
              <td>${escapeHtml(field.value || '-')}</td>
              <td><span class="config-diagnostics-pill tone-${field.configured ? 'ok' : 'warning'}">${escapeHtml(field.sourceLabel || field.source || '-')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function fileMatchesSearch(file = {}, query = '') {
    if (!query) return true;
    const haystack = [
      file.key,
      file.title,
      file.runtimePath,
      file.defaultPath,
      file.statusLabel,
      ...(Array.isArray(file.fields) ? file.fields.flatMap(field => [field.key, field.label, field.sourceLabel]) : []),
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  }

  function filterFields(fields = []) {
    const query = state.search;
    if (!query) return fields;
    return fields.filter(field => [
      field.key,
      field.label,
      field.sourceLabel,
      field.effectiveValue,
      field.runtimeValue,
      field.defaultValue,
    ].join(' ').toLowerCase().includes(query));
  }

  function renderFieldRows(fields = []) {
    const visibleFields = filterFields(fields);
    if (visibleFields.length <= 0) {
      return '<div class="config-diagnostics-empty">当前筛选条件下没有字段。</div>';
    }
    return `
      <div class="config-diagnostics-table-wrap">
        <table class="config-diagnostics-table">
          <thead>
            <tr>
              <th>字段</th>
              <th>状态</th>
              <th>生效值</th>
              <th>运行配置</th>
              <th>默认模板</th>
            </tr>
          </thead>
          <tbody>
            ${visibleFields.map(field => `
              <tr>
                <td><strong>${escapeHtml(field.label || field.key)}</strong><code>${escapeHtml(field.key || '-')}</code></td>
                <td>
                  <span class="config-diagnostics-pill tone-${getFieldTone(field.source, field.cacheDrift)}">
                    ${escapeHtml(field.cacheDrift ? '内存与文件不同' : field.sourceLabel || field.source || '-')}
                  </span>
                </td>
                <td>${escapeHtml(field.effectiveValue || '-')}</td>
                <td>${escapeHtml(field.runtimeValue || '-')}</td>
                <td>${escapeHtml(field.defaultValue || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderFileCard(file = {}) {
    const stats = file.fieldStats || {};
    const diff = file.diff || {};
    const counts = diff.counts || {};
    const tone = getFileTone(file);
    return `
      <article class="config-diagnostics-file-card" data-status="${escapeHtml(file.status || 'ok')}">
        <div class="config-diagnostics-file-card-head">
          <div>
            <h3>${escapeHtml(file.title || file.key || '-')}</h3>
            <div class="setting-help">${escapeHtml(file.fileName || '-')} · ${escapeHtml(file.statusLabel || '-')}</div>
          </div>
          <span class="config-diagnostics-pill tone-${tone}">${escapeHtml(file.statusLabel || '未知')}</span>
        </div>
        <div class="config-diagnostics-stat-row">
          <span>字段 ${escapeHtml(stats.total || 0)}</span>
          <span>已覆盖 ${escapeHtml(stats.modified || counts.modified || 0)}</span>
          <span>仅运行 ${escapeHtml(stats.runtimeOnly || counts.runtimeOnly || 0)}</span>
          <span>运行缺失 ${escapeHtml(stats.missingInRuntime || counts.missingInRuntime || 0)}</span>
          <span>内存差异 ${escapeHtml(stats.cacheDrift || 0)}</span>
        </div>
        <div class="config-diagnostics-file-paths">
          <div class="config-diagnostics-path-item">
            <strong>运行配置 ${file.runtime?.exists ? (file.runtime?.invalid ? '格式错误' : '存在') : '缺失'}</strong>
            <code>${escapeHtml(file.runtimePath || file.runtime?.path || '-')}</code>
            <span class="setting-help">${escapeHtml(file.runtime?.exists ? `${file.runtime?.sizeLabel || '0 B'} · ${file.runtime?.mtime ? formatDate(file.runtime.mtime) : '时间未知'}` : '未找到运行配置文件')}</span>
            ${file.runtime?.error ? `<span class="setting-help">${escapeHtml(file.runtime.error)}</span>` : ''}
          </div>
          <div class="config-diagnostics-path-item">
            <strong>默认模板 ${file.default?.exists ? (file.default?.invalid ? '格式错误' : '存在') : '缺失'}</strong>
            <code>${escapeHtml(file.defaultPath || file.default?.path || '-')}</code>
            <span class="setting-help">${escapeHtml(file.default?.exists ? `${file.default?.sizeLabel || '0 B'} · ${file.default?.mtime ? formatDate(file.default.mtime) : '时间未知'}` : '未找到默认模板文件')}</span>
            ${file.default?.error ? `<span class="setting-help">${escapeHtml(file.default.error)}</span>` : ''}
          </div>
        </div>
        <details class="config-diagnostics-details">
          <summary>查看字段明细${file.fieldsTruncated ? `（仅展示前 ${escapeHtml(file.fields?.length || 0)} 项）` : ''}</summary>
          <div class="config-diagnostics-details-body">${renderFieldRows(Array.isArray(file.fields) ? file.fields : [])}</div>
        </details>
      </article>
    `;
  }

  function renderFiles(data = {}) {
    const target = $('config-diagnostics-files');
    if (!target) return;
    const allFiles = Array.isArray(data.allFiles) ? data.allFiles : Array.isArray(data.files) ? data.files : [];
    const query = state.search.trim().toLowerCase();
    const status = state.status;
    const files = allFiles.filter(file => {
      if (status !== 'all' && file.status !== status) return false;
      return fileMatchesSearch(file, query);
    });
    target.innerHTML = files.length > 0
      ? files.map(renderFileCard).join('')
      : '<div class="config-diagnostics-empty">当前筛选条件下没有配置文件。</div>';
  }

  function render(data = {}) {
    $('config-diagnostics-meta').textContent = `诊断时间：${formatDate(data.generatedAt)}。此页面只读取配置，不保存修改。`;
    $('config-diagnostics-rule').textContent = data.note || '运行配置优先于默认模板；此页面只读，不会修改任何文件。';
    renderSummary(data);
    renderRecommendations(data);
    renderDirectories(data);
    renderMigration(data);
    renderEffectiveFields(data);
    renderFiles(data);
  }

  async function loadDiagnostics() {
    const refreshBtn = $('config-diagnostics-refresh-btn');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '刷新中...';
    }
    try {
      const result = await window.CrystelfRequest.fetchJsonSafe('/api/config/diagnostics', { success: false });
      if (!result?.success) {
        throw new Error(result?.__error || result?.error || '配置诊断加载失败');
      }
      state.data = result.data || {};
      render(state.data);
    } catch (error) {
      const message = error?.message || String(error);
      ['config-diagnostics-summary', 'config-diagnostics-recommendations', 'config-diagnostics-directories', 'config-diagnostics-effective-fields', 'config-diagnostics-files'].forEach(id => {
        const target = $(id);
        if (target) target.innerHTML = `<div class="config-diagnostics-empty">加载失败：${escapeHtml(message)}</div>`;
      });
      $('config-diagnostics-meta').textContent = `配置来源诊断加载失败：${message}`;
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '刷新诊断';
      }
    }
  }

  function bindEvents() {
    $('config-diagnostics-refresh-btn')?.addEventListener('click', loadDiagnostics);
    $('config-diagnostics-search')?.addEventListener('input', event => {
      state.search = String(event.target.value || '');
      renderFiles(state.data || {});
    });
    $('config-diagnostics-status')?.addEventListener('change', event => {
      state.status = String(event.target.value || 'all');
      renderFiles(state.data || {});
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadDiagnostics();
  });
})();
